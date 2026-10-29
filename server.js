"use strict";

const { createHash, randomBytes, scrypt, timingSafeEqual } = require("node:crypto");
const { promisify } = require("node:util");
const { createReadStream, existsSync, mkdirSync } = require("node:fs");
const { extname, resolve, sep } = require("node:path");
const { createServer } = require("node:http");
const { DatabaseSync } = require("node:sqlite");

const scryptAsync = promisify(scrypt);
const root = __dirname;
const dataDir = resolve(process.env.HILLPULSE_DATA_DIR || root, "data");
const databasePath = resolve(process.env.HILLPULSE_DATA_DIR || root, "data", "hillpulse.sqlite");
const port = Number(process.env.PORT || 4173);
const sessionDurationMs = 12 * 60 * 60 * 1000;
const loginFailures = new Map();
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
`);

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

database.exec("CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expires_at); CREATE INDEX IF NOT EXISTS blood_requests_user ON blood_requests(user_id, created_at DESC);");

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

async function handleApi(request, response, pathname) {
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

  if (request.method === "POST" && pathname === "/api/blood-requests") {
    const body = await readJson(request);
    const bloodGroup = cleanString(body.bloodGroup, 3);
    const units = Number(body.units);
    const urgency = cleanString(body.urgency, 24);
    const facilityId = cleanString(body.facilityId, 80);
    if (!/^(A|B|AB|O)[+-]$/.test(bloodGroup) || !Number.isInteger(units) || units < 1 || units > 4 || !["immediate", "within-6-hours", "today", "planned"].includes(urgency)) {
      return sendJson(response, 400, { error: "Choose a valid blood group, 1–4 units, and urgency." });
    }
    const facility = database.prepare("SELECT id FROM facilities WHERE id = ? AND EXISTS (SELECT 1 FROM json_each(services) WHERE value = 'blood')").get(facilityId);
    if (!facility) return sendJson(response, 400, { error: "Choose a listed blood-service enquiry facility." });
    const id = randomBytes(16).toString("hex");
    const status = user.status === "verified" && user.role !== "community" ? "received" : "pending_verification";
    database.prepare("INSERT INTO blood_requests (id, user_id, facility_id, blood_group, units, urgency, requester_note, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
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
