# Hillpulse Mesh

A responsive, Arunachal Pradesh-focused prototype with a searchable hospital and blood-service enquiry directory.

## Run

Use Node.js 22.13 or newer:

```sh
npm start
```

Open `http://localhost:4173`. The server creates `data/hillpulse.sqlite` and seeds the reference facility directory on first run. Set `PORT` to change the port or `HILLPULSE_DATA_DIR` to store the database outside the project directory. Browser geolocation requires HTTPS or `localhost` and your explicit permission.

## Prototype boundary

**This is not a live healthcare service. It does not notify hospitals or donors, dispatch ambulances, verify professional credentials, confirm blood availability, or provide emergency response. In an emergency, call 112.** Blood and ambulance requests are stored in SQLite with `pending_verification` or `recorded_not_dispatched` status; no facility is contacted. Directory entries and coordinates are unverified references, not confirmation that a facility provides a listed service. Distances are straight-line estimates, not road distances or response times.

The backend provides SQLite-backed community and provider accounts, scrypt-hashed passwords, HttpOnly/SameSite session cookies, profile updates, an unverified facility directory API, authenticated request creation and retrieval, and a rate-limited public feedback endpoint. Feedback is stored privately in the `feedback` table with `pending_review` status and is not exposed to other visitors. Optional feedback email addresses are stored for follow-up. Provider accounts remain pending manual review. GPS coordinates and camera images are not stored or transmitted; camera or photo access happens only after the person actively chooses the optional upload control.

Donor profiles require an authenticated account and explicit consent. Profiles are private until an administrator reviews them, and only approved, available, opted-in donors appear in the public directory. Last donation dates are self-reported and are not medical eligibility determinations. For manual review, generate a private token with `openssl rand -hex 32`, then export it as `HILLPULSE_ADMIN_TOKEN` before `npm start`. Use `GET /api/admin/donors?status=pending_review` and `POST /api/admin/donors/{id}/review` with `Authorization: Bearer $HILLPULSE_ADMIN_TOKEN` and JSON `{"status":"verified"}` or `{"status":"rejected"}`. Keep the token secret and out of browser code.

Blood requests are published to the donor opportunity list only when the requester consents and an administrator changes their status to `open_for_donors` via `POST /api/admin/blood-requests/{id}/review`. A response is accepted only from a reviewed, available, opted-in donor with a matching blood group. Responses are private and can be reviewed using `GET /api/admin/blood-requests/{id}/responses`. These actions store records only; they do not send notifications or establish medical eligibility.

Production deployment still requires HTTPS, backups, an admin review workflow, professional credential verification, privacy and retention policy, operational hospital/donor integrations, monitoring, and security review. Do not use this prototype as an emergency dispatch service or enter patient health information. Set `COOKIE_SECURE=true` when TLS terminates at a trusted reverse proxy.

Account names, email addresses, optional dates of birth, and provider registration details are stored in the server-side SQLite database. Passwords are stored as scrypt hashes; plaintext passwords are not stored. Never collect a government-ID number, Aadhaar OTP, identity document, or patient health details in this app. Genuine Aadhaar verification requires an appropriately authorised service and compliant authentication flow. PAN and ABHA are different identifiers and should only be verified through their respective authorised services. Do not claim Indian citizenship based on an email account.

The SQLite database contains personal account and request information. Restrict server and filesystem access, configure secure HTTPS cookies behind a trusted TLS proxy, and establish backups, retention, access auditing, and deletion policies before deploying for real users.

Before a real-world launch, this prototype needs authorized identity-verification partners where appropriate; independently verified providers, registrations, inventory, and operating hours; consent-based, secure dispatch and appointment workflows; staffed incident handling; accessibility and local-language support; privacy notices, retention controls, and security review; and field testing for Arunachal Pradesh road access and connectivity. A straight-line radius is not a road-time or serviceability guarantee.