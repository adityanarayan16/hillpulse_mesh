"use strict";

const { createHash, randomBytes, scrypt, timingSafeEqual } = require("node:crypto");
const { promisify } = require("node:util");
const { createReadStream, existsSync, mkdirSync } = require("node:fs");
const { extname, resolve, sep } = require("node:path");
const { createServer } = require("node:http");
const { DatabaseSync } = require("node:sqlite");

const scryptAsync = promisify(scrypt);
const root = __dirname;
const dataDir = resolve(process.env.HILLPULSE_DATA_DIR || resolve(root, "data"));
const databasePath = resolve(dataDir, "hillpulse.sqlite");
const port = Number(process.env.PORT || 4173);
const sessionDurationMs = 12 * 60 * 60 * 1000;
const loginFailures = new Map();
const feedbackAttempts = new Map();
const mimeTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
};

mkdirSync(dataDir, { recursive: true });
const database = new DatabaseSync(databasePath);
database.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
database.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    name TEXT NOT NULL,
    date_of_birth TEXT,
    role TEXT NOT NULL CHECK (role IN ('community', 'hospital', 'doctor', 'nurse')),
    facility TEXT,
    registration_number TEXT,
    town TEXT,
    status TEXT NOT NULL DEFAULT 'unverified' CHECK (status IN ('unverified', 'pending_review', 'verified', 'suspended')),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS facilities (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    town TEXT NOT NULL,
    district TEXT NOT NULL,
    latitude REAL NOT NULL,
    longitude REAL NOT NULL,
    services TEXT NOT NULL,
    verified INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS blood_requests (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    facility_id TEXT NOT NULL REFERENCES facilities(id),
    blood_group TEXT NOT NULL,
    units INTEGER NOT NULL CHECK (units BETWEEN 1 AND 4),
    urgency TEXT NOT NULL CHECK (urgency IN ('immediate', 'within-6-hours', 'today', 'planned')),
    share_for_donors INTEGER NOT NULL DEFAULT 0 CHECK (share_for_donors IN (0, 1)),
    requester_note TEXT,
    status TEXT NOT NULL DEFAULT 'pending_verification',
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS ambulance_requests (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    town TEXT NOT NULL,
    note TEXT,
    status TEXT NOT NULL DEFAULT 'recorded_not_dispatched',
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS feedback (
    id TEXT PRIMARY KEY,
    user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
    name TEXT,
    email TEXT,
    comment TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending_review',
    created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS donors (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    display_name TEXT NOT NULL,
    blood_group TEXT NOT NULL CHECK (blood_group IN ('A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-')),
    town TEXT NOT NULL,
    last_donation_date TEXT,
    available INTEGER NOT NULL DEFAULT 1 CHECK (available IN (0, 1)),
    consent_public INTEGER NOT NULL DEFAULT 0 CHECK (consent_public IN (0, 1)),
    status TEXT NOT NULL DEFAULT 'pending_review' CHECK (status IN ('pending_review', 'verified', 'rejected', 'suspended')),
    reviewed_at TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS donor_responses (
    id TEXT PRIMARY KEY,
    blood_request_id TEXT NOT NULL REFERENCES blood_requests(id) ON DELETE CASCADE,
    donor_id TEXT NOT NULL REFERENCES donors(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'response_received',
    created_at TEXT NOT NULL,
    UNIQUE (blood_request_id, donor_id)
  );
`);

const bloodRequestColumns = database.prepare("PRAGMA table_info(blood_requests)").all();
if (!bloodRequestColumns.some((column) => column.name === "share_for_donors")) {
  database.exec("ALTER TABLE blood_requests ADD COLUMN share_for_donors INTEGER NOT NULL DEFAULT 0 CHECK (share_for_donors IN (0, 1))");
}

const seedFacilities = [
  ["facility-trihms", "Tomo Riba Institute of Health and Medical Sciences", "Naharlagun", "Papum Pare", 27.1044, 93.6950],
  ["facility-rkmh", "Ramakrishna Mission Hospital", "Itanagar", "Papum Pare", 27.0844, 93.6053],
  ["facility-ziro", "District Hospital, Ziro", "Ziro", "Lower Subansiri", 27.5467, 93.8195],
  ["facility-tawang", "District Hospital, Tawang", "Tawang", "Tawang", 27.5861, 91.8594],
  ["facility-pasighat", "Bakin Pertin General Hospital", "Pasighat", "East Siang", 28.0665, 95.3268],
  ["facility-bomdila", "District Hospital, Bomdila", "Bomdila", "West Kameng", 27.2645, 92.4159],
  ["facility-aalo", "District Hospital, Aalo", "Aalo", "West Siang", 28.1683, 94.8007],
  ["facility-roing", "General Hospital, Roing", "Roing", "Lower Dibang Valley", 28.1482, 95.8410],
  ["facility-tezu", "District Hospital, Tezu", "Tezu", "Lohit", 27.9258, 96.1650],
];
const insertFacility = database.prepare("INSERT OR IGNORE INTO facilities (id, name, town, district, latitude, longitude, services) VALUES (?, ?, ?, ?, ?, ?, ?)");
for (const [id, name, town, district, latitude, longitude] of seedFacilities) {
  insertFacility.run(id, name, town, district, latitude, longitude, JSON.stringify(["ambulance", "blood"]));
}

database.exec("CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expires_at); CREATE INDEX IF NOT EXISTS blood_requests_user ON blood_requests(user_id, created_at DESC); CREATE INDEX IF NOT EXISTS blood_requests_review ON blood_requests(status, share_for_donors, created_at); CREATE INDEX IF NOT EXISTS donors_public ON donors(status, consent_public, available, town);");

function sendJson(response, status, value, headers = {}) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...headers });
  response.end(JSON.stringify(value));
}

function readJson(request) {
  return new Promise((resolveBody, reject) => {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
      if (body.length > 65536) {
        reject(Object.assign(new Error("Request body is too large."), { status: 413 }));
        request.destroy();
      }
    });
    request.on("end", () => {
      try {
        resolveBody(JSON.parse(body || "{}"));
      } catch {
        reject(Object.assign(new Error("Request body must be valid JSON."), { status: 400 }));
      }
    });
    request.on("error", reject);
  });
}

function cleanString(value, maximum = 200) {
  return typeof value === "string" ? value.trim().slice(0, maximum) : "";
}

function safeUser(row) {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    dateOfBirth: row.date_of_birth,
    role: row.role,
    facility: row.facility,
    registrationNumber: row.registration_number,
    town: row.town,
    status: row.status,
  };
}

function getSessionToken(request) {
  const cookies = Object.fromEntries((request.headers.cookie || "").split(";").map((part) => part.trim().split(/=(.*)/s).slice(0, 2)));
  return cookies.hillpulse_session || "";
}

function getAuthenticatedUser(request) {
  const token = getSessionToken(request);
  if (!token) return null;
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const row = database.prepare(`SELECT users.* FROM sessions JOIN users ON users.id = sessions.user_id WHERE sessions.token_hash = ? AND sessions.expires_at > ?`).get(tokenHash, Date.now());
  return row || null;
}

function cookieHeaders(request, token, maxAge) {
  const secure = request.socket.encrypted || process.env.COOKIE_SECURE === "true";
  return {
    "Set-Cookie": `hillpulse_session=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}${secure ? "; Secure" : ""}`,
  };
}

async function hashPassword(password) {
  const salt = randomBytes(16);
  const hash = await scryptAsync(password, salt, 64, { N: 16384, r: 8, p: 1 });
  return `${salt.toString("hex")}:${hash.toString("hex")}`;
}

async function verifyPassword(password, encoded) {
  const [saltHex, hashHex] = encoded.split(":");
  const expected = Buffer.from(hashHex, "hex");
  const actual = await scryptAsync(password, Buffer.from(saltHex, "hex"), expected.length, { N: 16384, r: 8, p: 1 });
  return timingSafeEqual(expected, actual);
}

function loginRateLimitKey(request, email) {
  return `${request.socket.remoteAddress || "unknown"}:${email}`;
}

function isAdminRequest(request, response) {
  const expected = process.env.HILLPULSE_ADMIN_TOKEN || "";
  if (!expected) {
    sendJson(response, 503, { error: "Donor review is not configured." });
    return false;
  }
  const authorization = request.headers.authorization || "";
  const provided = authorization.startsWith("Bearer ") ? Buffer.from(authorization.slice(7)) : Buffer.alloc(0);
  const expectedBuffer = Buffer.from(expected);
  if (provided.length !== expectedBuffer.length || !timingSafeEqual(provided, expectedBuffer)) {
    sendJson(response, 403, { error: "Admin authorization required." });
    return false;
  }
  return true;
}

async function handleApi(request, response, pathname) {
  if (request.method === "POST" && pathname === "/api/feedback") {
    const body = await readJson(request);
    const name = cleanString(body.name, 80) || null;
    const email = cleanString(body.email, 254).toLowerCase() || null;
    const comment = typeof body.comment === "string" ? body.comment.trim() : "";
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return sendJson(response, 400, { error: "Enter a valid email address or leave it blank." });
    }
    if (comment.length < 10 || comment.length > 1500) {
      return sendJson(response, 400, { error: "Feedback must be between 10 and 1,500 characters." });
    }

    const now = Date.now();
    const ip = request.socket.remoteAddress || "unknown";
    const recent = (feedbackAttempts.get(ip) || []).filter((timestamp) => timestamp > now - 15 * 60 * 1000);
    if (recent.length >= 8) {
      return sendJson(response, 429, { error: "Feedback limit reached. Please try again later." });
    }
    recent.push(now);
    feedbackAttempts.set(ip, recent);
    if (feedbackAttempts.size > 1000) {
      for (const [address, timestamps] of feedbackAttempts) {
        if (!timestamps.some((timestamp) => timestamp > now - 15 * 60 * 1000)) feedbackAttempts.delete(address);
      }
    }

    const account = getAuthenticatedUser(request);
    const id = randomBytes(16).toString("hex");
    database.prepare("INSERT INTO feedback (id, user_id, name, email, comment, created_at) VALUES (?, ?, ?, ?, ?, ?)")
      .run(id, account?.id || null, name, email, comment, new Date(now).toISOString());
    return sendJson(response, 201, { received: true, id, status: "pending_review" });
  }

  if (request.method === "GET" && pathname === "/api/health") {
    return sendJson(response, 200, { ok: true });
  }

  if (request.method === "GET" && pathname === "/api/facilities") {
    const facilities = database.prepare("SELECT id, name, town, district, latitude, longitude, services, verified FROM facilities ORDER BY town, name").all().map((facility) => ({
      ...facility,
      services: JSON.parse(facility.services),
      verified: Boolean(facility.verified),
    }));
    return sendJson(response, 200, { facilities });
  }

  if (request.method === "GET" && pathname === "/api/donors") {
    const donors = database.prepare(`SELECT id, display_name AS name, blood_group AS bloodGroup, town, last_donation_date AS lastDonationDate, available FROM donors WHERE status = 'verified' AND consent_public = 1 AND available = 1 ORDER BY town, display_name`).all()
      .map((donor) => ({ ...donor, available: Boolean(donor.available) }));
    return sendJson(response, 200, { donors });
  }

  if (request.method === "GET" && pathname === "/api/donor-opportunities") {
    const viewer = getAuthenticatedUser(request);
    const opportunities = database.prepare(`SELECT blood_requests.id, blood_requests.blood_group AS bloodGroup, blood_requests.units, blood_requests.urgency, blood_requests.created_at AS createdAt, facilities.name AS facility, facilities.town, (SELECT COUNT(*) FROM donor_responses WHERE blood_request_id = blood_requests.id) AS responseCount, EXISTS (SELECT 1 FROM donor_responses JOIN donors ON donors.id = donor_responses.donor_id WHERE donor_responses.blood_request_id = blood_requests.id AND donors.user_id = ?) AS hasResponded FROM blood_requests JOIN facilities ON facilities.id = blood_requests.facility_id WHERE blood_requests.status = 'open_for_donors' AND blood_requests.share_for_donors = 1 ORDER BY CASE blood_requests.urgency WHEN 'immediate' THEN 0 WHEN 'within-6-hours' THEN 1 WHEN 'today' THEN 2 ELSE 3 END, blood_requests.created_at ASC`).all(viewer?.id || null)
      .map((opportunity) => ({ ...opportunity, hasResponded: Boolean(opportunity.hasResponded) }));
    return sendJson(response, 200, { opportunities });
  }

  if (pathname.startsWith("/api/admin/blood-requests")) {
    if (!isAdminRequest(request, response)) return;
    if (request.method === "GET" && pathname === "/api/admin/blood-requests") {
      const status = cleanString(new URL(request.url, "http://localhost").searchParams.get("status"), 24) || "pending_verification";
      if (!["pending_verification", "open_for_donors", "needs_followup", "fulfilled", "rejected"].includes(status)) {
        return sendJson(response, 400, { error: "Choose a valid blood request status filter." });
      }
      const requests = database.prepare(`SELECT blood_requests.id, blood_requests.user_id AS requesterId, blood_requests.blood_group AS bloodGroup, blood_requests.units, blood_requests.urgency, blood_requests.status, blood_requests.share_for_donors AS shareForDonors, blood_requests.created_at AS createdAt, users.name AS requesterName, users.email AS requesterEmail, facilities.id AS facilityId, facilities.name AS facility, facilities.town FROM blood_requests JOIN users ON users.id = blood_requests.user_id JOIN facilities ON facilities.id = blood_requests.facility_id WHERE blood_requests.status = ? ORDER BY blood_requests.created_at ASC`).all(status)
        .map((item) => ({ ...item, shareForDonors: Boolean(item.shareForDonors) }));
      return sendJson(response, 200, { requests });
    }
    const responsesMatch = pathname.match(/^\/api\/admin\/blood-requests\/([a-f0-9]+)\/responses$/);
    if (request.method === "GET" && responsesMatch) {
      const responses = database.prepare(`SELECT donor_responses.id, donor_responses.blood_request_id AS bloodRequestId, donor_responses.status, donor_responses.created_at AS createdAt, donors.display_name AS donorName, donors.blood_group AS bloodGroup, donors.town, users.email AS donorEmail FROM donor_responses JOIN donors ON donors.id = donor_responses.donor_id JOIN users ON users.id = donors.user_id WHERE donor_responses.blood_request_id = ? ORDER BY donor_responses.created_at`).all(responsesMatch[1]);
      return sendJson(response, 200, { responses });
    }
    const reviewMatch = pathname.match(/^\/api\/admin\/blood-requests\/([a-f0-9]+)\/review$/);
    if (request.method === "POST" && reviewMatch) {
      const body = await readJson(request);
      const status = cleanString(body.status, 24);
      if (!["open_for_donors", "needs_followup", "fulfilled", "rejected"].includes(status)) {
        return sendJson(response, 400, { error: "Choose a valid review status." });
      }
      const result = database.prepare("UPDATE blood_requests SET status = ? WHERE id = ? AND share_for_donors = 1")
        .run(status, reviewMatch[1]);
      if (result.changes === 0) return sendJson(response, 404, { error: "Consenting blood request not found." });
      return sendJson(response, 200, { id: reviewMatch[1], status });
    }
    return sendJson(response, 404, { error: "Admin blood request route not found." });
  }

  if (pathname.startsWith("/api/admin/donors")) {
    if (!isAdminRequest(request, response)) return;
    if (request.method === "GET" && pathname === "/api/admin/donors") {
      const status = cleanString(new URL(request.url, "http://localhost").searchParams.get("status"), 24) || "pending_review";
      if (!["pending_review", "verified", "rejected", "suspended"].includes(status)) {
        return sendJson(response, 400, { error: "Choose a valid donor status filter." });
      }
      const donors = database.prepare(`SELECT donors.id, donors.user_id AS userId, users.name AS applicantName, users.email, users.role, users.facility, users.registration_number AS registrationNumber, donors.display_name AS name, donors.blood_group AS bloodGroup, donors.town, donors.last_donation_date AS lastDonationDate, donors.available, donors.consent_public AS consentPublic, donors.status, donors.created_at AS createdAt FROM donors JOIN users ON users.id = donors.user_id WHERE donors.status = ? ORDER BY donors.created_at ASC`).all(status)
        .map((donor) => ({ ...donor, available: Boolean(donor.available), consentPublic: Boolean(donor.consentPublic) }));
      return sendJson(response, 200, { donors });
    }
    const reviewMatch = pathname.match(/^\/api\/admin\/donors\/([a-f0-9]+)\/review$/);
    if (request.method === "POST" && reviewMatch) {
      const body = await readJson(request);
      const status = cleanString(body.status, 24);
      if (!["verified", "rejected", "suspended"].includes(status)) {
        return sendJson(response, 400, { error: "Review status must be verified, rejected, or suspended." });
      }
      const result = database.prepare("UPDATE donors SET status = ?, reviewed_at = ?, updated_at = ? WHERE id = ?")
        .run(status, new Date().toISOString(), new Date().toISOString(), reviewMatch[1]);
      if (result.changes === 0) return sendJson(response, 404, { error: "Donor application not found." });
      return sendJson(response, 200, { id: reviewMatch[1], status });
    }
    return sendJson(response, 404, { error: "Admin donor route not found." });
  }

  if (pathname.startsWith("/api/admin/blood-requests")) {
    if (!isAdminRequest(request, response)) return;
    if (request.method === "GET" && pathname === "/api/admin/blood-requests") {
      const status = cleanString(new URL(request.url, "http://localhost").searchParams.get("status"), 24) || "pending_verification";
      if (!["pending_verification", "open_for_donors", "needs_followup", "fulfilled", "rejected"].includes(status)) {
        return sendJson(response, 400, { error: "Choose a valid blood request status filter." });
      }
      const requests = database.prepare(`SELECT blood_requests.id, blood_requests.user_id AS requesterId, blood_requests.blood_group AS bloodGroup, blood_requests.units, blood_requests.urgency, blood_requests.status, blood_requests.share_for_donors AS shareForDonors, blood_requests.created_at AS createdAt, users.name AS requesterName, users.email AS requesterEmail, facilities.id AS facilityId, facilities.name AS facility, facilities.town FROM blood_requests JOIN users ON users.id = blood_requests.user_id JOIN facilities ON facilities.id = blood_requests.facility_id WHERE blood_requests.status = ? ORDER BY blood_requests.created_at ASC`).all(status)
        .map((item) => ({ ...item, shareForDonors: Boolean(item.shareForDonors) }));
      return sendJson(response, 200, { requests });
    }
    const responsesMatch = pathname.match(/^\/api\/admin\/blood-requests\/([a-f0-9]+)\/responses$/);
    if (request.method === "GET" && responsesMatch) {
      const responses = database.prepare(`SELECT donor_responses.id, donor_responses.blood_request_id AS bloodRequestId, donor_responses.status, donor_responses.created_at AS createdAt, donors.display_name AS donorName, donors.blood_group AS bloodGroup, donors.town, users.email AS donorEmail FROM donor_responses JOIN donors ON donors.id = donor_responses.donor_id JOIN users ON users.id = donors.user_id WHERE donor_responses.blood_request_id = ? ORDER BY donor_responses.created_at`).all(responsesMatch[1]);
      return sendJson(response, 200, { responses });
    }
    const reviewMatch = pathname.match(/^\/api\/admin\/blood-requests\/([a-f0-9]+)\/review$/);
    if (request.method === "POST" && reviewMatch) {
      const body = await readJson(request);
      const status = cleanString(body.status, 24);
      if (!["open_for_donors", "needs_followup", "fulfilled", "rejected"].includes(status)) {
        return sendJson(response, 400, { error: "Choose a valid review status." });
      }
      const result = database.prepare("UPDATE blood_requests SET status = ? WHERE id = ? AND share_for_donors = 1")
        .run(status, reviewMatch[1]);
      if (result.changes === 0) return sendJson(response, 404, { error: "Consenting blood request not found." });
      return sendJson(response, 200, { id: reviewMatch[1], status });
    }
    return sendJson(response, 404, { error: "Admin blood request route not found." });
  }

  if (request.method === "POST" && pathname === "/api/auth/signup") {
    const body = await readJson(request);
    const email = cleanString(body.email, 254).toLowerCase();
    const name = cleanString(body.name, 80);
    const role = cleanString(body.role, 20);
    const password = typeof body.password === "string" ? body.password : "";
    const allowedRoles = ["community", "hospital", "doctor", "nurse"];
    if (!name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || password.length < 12 || !allowedRoles.includes(role)) {
      return sendJson(response, 400, { error: "Enter a valid name, email, account type, and password with at least 12 characters." });
    }
    const facility = cleanString(body.facility, 120);
    const registrationNumber = cleanString(body.registrationNumber, 80);
    const town = cleanString(body.town, 60);
    if (role !== "community" && (!facility || !registrationNumber || !town)) {
      return sendJson(response, 400, { error: "Provider accounts require a facility, registration number, and town." });
    }
    const id = randomBytes(16).toString("hex");
    const now = new Date().toISOString();
    try {
      const passwordHash = await hashPassword(password);
      database.prepare(`INSERT INTO users (id, email, password_hash, name, date_of_birth, role, facility, registration_number, town, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(id, email, passwordHash, name, cleanString(body.dateOfBirth, 10) || null, role, facility || null, registrationNumber || null, town || null, role === "community" ? "unverified" : "pending_review", now, now);
      const token = randomBytes(32).toString("base64url");
      const tokenHash = createHash("sha256").update(token).digest("hex");
      database.prepare("INSERT INTO sessions (token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)").run(tokenHash, id, Date.now() + sessionDurationMs, now);
      const user = database.prepare("SELECT * FROM users WHERE id = ?").get(id);
      return sendJson(response, 201, { user: safeUser(user) }, cookieHeaders(request, token, sessionDurationMs / 1000));
    } catch (error) {
      if (String(error.message).includes("UNIQUE constraint failed: users.email")) {
        return sendJson(response, 409, { error: "An account with that email already exists. Try signing in." });
      }
      throw error;
    }
  }

  if (request.method === "POST" && pathname === "/api/auth/login") {
    const body = await readJson(request);
    const email = cleanString(body.email, 254).toLowerCase();
    const key = loginRateLimitKey(request, email);
    const limiter = loginFailures.get(key);
    if (limiter && limiter.expiresAt > Date.now() && limiter.count >= 10) {
      return sendJson(response, 429, { error: "Too many sign-in attempts. Try again in 15 minutes." });
    }
    const user = database.prepare("SELECT * FROM users WHERE email = ?").get(email);
    const valid = user && typeof body.password === "string" && await verifyPassword(body.password, user.password_hash);
    if (!valid) {
      const current = limiter?.expiresAt > Date.now() ? limiter : { count: 0, expiresAt: Date.now() + 15 * 60 * 1000 };
      loginFailures.set(key, { ...current, count: current.count + 1 });
      return sendJson(response, 401, { error: "Email or password is incorrect." });
    }
    loginFailures.delete(key);
    const token = randomBytes(32).toString("base64url");
    const tokenHash = createHash("sha256").update(token).digest("hex");
    const now = new Date().toISOString();
    database.prepare("INSERT INTO sessions (token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)").run(tokenHash, user.id, Date.now() + sessionDurationMs, now);
    return sendJson(response, 200, { user: safeUser(user) }, cookieHeaders(request, token, sessionDurationMs / 1000));
  }

  if (request.method === "POST" && pathname === "/api/auth/logout") {
    const token = getSessionToken(request);
    if (token) database.prepare("DELETE FROM sessions WHERE token_hash = ?").run(createHash("sha256").update(token).digest("hex"));
    return sendJson(response, 200, { ok: true }, cookieHeaders(request, "", 0));
  }

  const user = getAuthenticatedUser(request);
  if (!user) return sendJson(response, 401, { error: "Sign in to continue." });

  if (request.method === "GET" && pathname === "/api/me") {
    return sendJson(response, 200, { user: safeUser(user) });
  }

  if (request.method === "GET" && pathname === "/api/me/donor-profile") {
    const donor = database.prepare(`SELECT id, display_name AS name, blood_group AS bloodGroup, town, last_donation_date AS lastDonationDate, available, consent_public AS consentPublic, status FROM donors WHERE user_id = ?`).get(user.id);
    return sendJson(response, 200, { donor: donor ? { ...donor, available: Boolean(donor.available), consentPublic: Boolean(donor.consentPublic) } : null });
  }

  if (["POST", "PUT"].includes(request.method) && pathname === "/api/me/donor-profile") {
    const body = await readJson(request);
    const name = cleanString(body.name, 60);
    const bloodGroup = cleanString(body.bloodGroup, 3);
    const town = cleanString(body.town, 60);
    const lastDonationDate = cleanString(body.lastDonationDate, 10) || null;
    const available = body.available === true;
    const donor = database.prepare("SELECT id FROM donors WHERE user_id = ?").get(user.id);
    if (name.length < 2 || !/^(A|B|AB|O)[+-]$/.test(bloodGroup) || !town || (!donor && body.consentPublic !== true)) {
      return sendJson(response, 400, { error: "Enter your display name, blood group, town, availability, and confirm public-listing consent." });
    }
    const allowedTowns = new Set(["itanagar", "naharlagun", "ziro", "tawang", "bomdila", "pasighat", "aalo", "roing", "tezu"]);
    if (!allowedTowns.has(town.toLowerCase())) return sendJson(response, 400, { error: "Choose a listed Arunachal Pradesh town." });
    if (lastDonationDate && (!/^\d{4}-\d{2}-\d{2}$/.test(lastDonationDate) || lastDonationDate > new Date().toISOString().slice(0, 10) || Number.isNaN(Date.parse(`${lastDonationDate}T00:00:00Z`)))) {
      return sendJson(response, 400, { error: "Last donation date must be a valid date that is not in the future." });
    }
    const now = new Date().toISOString();
    if (donor) {
      database.prepare("UPDATE donors SET display_name = ?, blood_group = ?, town = ?, last_donation_date = ?, available = ?, consent_public = ?, status = 'pending_review', reviewed_at = NULL, updated_at = ? WHERE user_id = ?")
        .run(name, bloodGroup, town, lastDonationDate, available ? 1 : 0, body.consentPublic === true ? 1 : 0, now, user.id);
    } else {
      database.prepare("INSERT INTO donors (id, user_id, display_name, blood_group, town, last_donation_date, available, consent_public, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)")
        .run(randomBytes(16).toString("hex"), user.id, name, bloodGroup, town, lastDonationDate, available ? 1 : 0, now, now);
    }
    return sendJson(response, donor ? 200 : 201, { status: "pending_review", message: "Donor profile submitted for review. It is not public until approved." });
  }

  if (request.method === "PUT" && pathname === "/api/me") {
    const body = await readJson(request);
    const name = cleanString(body.name, 80);
    const dateOfBirth = cleanString(body.dateOfBirth, 10);
    if (!name) return sendJson(response, 400, { error: "Name is required." });
    database.prepare("UPDATE users SET name = ?, date_of_birth = ?, updated_at = ? WHERE id = ?").run(name, dateOfBirth || null, new Date().toISOString(), user.id);
    return sendJson(response, 200, { user: safeUser(database.prepare("SELECT * FROM users WHERE id = ?").get(user.id)) });
  }

  if (request.method === "GET" && pathname === "/api/blood-requests") {
    const requests = database.prepare(`SELECT blood_requests.*, facilities.name AS facility_name, facilities.town AS facility_town FROM blood_requests JOIN facilities ON facilities.id = blood_requests.facility_id WHERE blood_requests.user_id = ? ORDER BY blood_requests.created_at DESC`).all(user.id);
    return sendJson(response, 200, { requests });
  }

  const donorResponseMatch = pathname.match(/^\/api\/donor-opportunities\/([a-f0-9]+)\/respond$/);
  if (request.method === "POST" && donorResponseMatch) {
    const donor = database.prepare("SELECT id, blood_group, status, consent_public, available FROM donors WHERE user_id = ?").get(user.id);
    if (!donor || donor.status !== "verified" || !donor.consent_public || !donor.available) {
      return sendJson(response, 403, { error: "Only reviewed donors who are available and opted in can respond." });
    }
    const opportunity = database.prepare("SELECT id, blood_group FROM blood_requests WHERE id = ? AND status = 'open_for_donors' AND share_for_donors = 1")
      .get(donorResponseMatch[1]);
    if (!opportunity) return sendJson(response, 404, { error: "This donor opportunity is no longer open." });
    if (donor.blood_group !== opportunity.blood_group) {
      return sendJson(response, 403, { error: "Your reviewed blood group does not match this request." });
    }
    const id = randomBytes(16).toString("hex");
    try {
      database.prepare("INSERT INTO donor_responses (id, blood_request_id, donor_id, created_at) VALUES (?, ?, ?, ?)")
        .run(id, opportunity.id, donor.id, new Date().toISOString());
    } catch (error) {
      if (String(error.message).includes("UNIQUE constraint failed")) {
        return sendJson(response, 409, { error: "You have already responded to this request." });
      }
      throw error;
    }
    return sendJson(response, 201, { response: { id, status: "response_received" }, message: "Your response was recorded. A coordinator must contact the hospital; no notification was sent." });
  }

  if (request.method === "POST" && pathname === "/api/blood-requests") {
    const body = await readJson(request);
    const bloodGroup = cleanString(body.bloodGroup, 3);
    const units = Number(body.units);
    const urgency = cleanString(body.urgency, 24);
    const facilityId = cleanString(body.facilityId, 80);
    if (!/^(A|B|AB|O)[+-]$/.test(bloodGroup) || !Number.isInteger(units) || units < 1 || units > 4 || !["immediate", "within-6-hours", "today", "planned"].includes(urgency) || body.shareForDonors !== true) {
      return sendJson(response, 400, { error: "Choose a valid blood group, 1–4 units and urgency, and consent to share the request after review." });
    }
    const facility = database.prepare("SELECT id FROM facilities WHERE id = ? AND EXISTS (SELECT 1 FROM json_each(services) WHERE value = 'blood')").get(facilityId);
    if (!facility) return sendJson(response, 400, { error: "Choose a listed blood-service enquiry facility." });
    const id = randomBytes(16).toString("hex");
    const status = "pending_verification";
    database.prepare("INSERT INTO blood_requests (id, user_id, facility_id, blood_group, units, urgency, share_for_donors, requester_note, status, created_at) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?)")
      .run(id, user.id, facilityId, bloodGroup, units, urgency, cleanString(body.note, 240) || null, status, new Date().toISOString());
    return sendJson(response, 201, { request: { id, status, bloodGroup, units, urgency, facilityId }, message: "Request stored. It has not been sent to a hospital or donor." });
  }

  if (request.method === "POST" && pathname === "/api/ambulance-requests") {
    const body = await readJson(request);
    const town = cleanString(body.town, 80);
    if (!town) return sendJson(response, 400, { error: "Choose an area for this request." });
    const id = randomBytes(16).toString("hex");
    database.prepare("INSERT INTO ambulance_requests (id, user_id, town, note, created_at) VALUES (?, ?, ?, ?, ?)")
      .run(id, user.id, town, cleanString(body.note, 240) || null, new Date().toISOString());
    return sendJson(response, 201, { request: { id, status: "recorded_not_dispatched" }, message: "Stored only. No ambulance has been dispatched." });
  }

  return sendJson(response, 404, { error: "API route not found." });
}

function serveStatic(request, response, pathname) {
  const decoded = decodeURIComponent(pathname);
  const target = resolve(root, `.${decoded === "/" ? "/index.html" : decoded}`);
  if (target !== root && !target.startsWith(`${root}${sep}`)) {
    response.writeHead(403).end("Forbidden");
    return;
  }
  if (!existsSync(target)) {
    response.writeHead(404).end("Not found");
    return;
  }
  response.writeHead(200, {
    "Content-Type": mimeTypes[extname(target)] || "application/octet-stream",
    "Cache-Control": "no-cache",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Content-Security-Policy": "default-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:; script-src 'self'; connect-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'",
  });
  createReadStream(target).pipe(response);
}

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);
    if (url.pathname.startsWith("/api/")) {
      if (["POST", "PUT", "PATCH", "DELETE"].includes(request.method) && request.headers.origin) {
        const origin = new URL(request.headers.origin);
        if (origin.host !== request.headers.host) return sendJson(response, 403, { error: "Cross-origin requests are not allowed." });
      }
      await handleApi(request, response, url.pathname);
      return;
    }
    if (request.method !== "GET" && request.method !== "HEAD") return sendJson(response, 405, { error: "Method not allowed." });
    serveStatic(request, response, url.pathname);
  } catch (error) {
    const status = error.status || 500;
    if (status === 500) console.error(error);
    if (!response.headersSent) sendJson(response, status, { error: status === 500 ? "An unexpected server error occurred." : error.message });
    else response.destroy();
  }
});

server.listen(port, "0.0.0.0", () => {
  console.log(`Hillpulse Mesh server listening on http://localhost:${port}`);
  console.log(`SQLite database: ${databasePath}`);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    database.close();
    server.close(() => process.exit(0));
  });
}
