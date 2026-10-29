# Hillpulse Mesh

A responsive, Arunachal Pradesh-focused prototype with a searchable hospital and blood-service enquiry directory.

## Run

Open `index.html` in a browser or run a local static server from this directory. Browser geolocation requires HTTPS or `localhost` and your explicit permission.

## Prototype boundary

**This is not a live healthcare service. It does not notify hospitals, dispatch ambulances, verify providers, confirm blood availability, or verify identities. In an emergency, call 112.** Directory entries and approximate coordinates are unverified references, not confirmation that any facility provides ambulance or blood-donation services. Contact facilities directly. Distances are straight-line estimates, not road distances or response times.

There is no backend or shared database in this repository. Demo profiles, provider listings, and requests are stored in the browser's local storage on the device where they were submitted. Browser data is not transmitted to the website author or other users. GPS coordinates and camera images are not stored or transmitted; camera or photo access happens only after the person actively chooses the optional upload control.

Hospital, doctor, and nurse access applications are demo records saved locally and are not reviewed or activated. Blood-request records are also local only: they do not represent genuine clinical requests and never alert a facility, donor, or administrator. Do not enter real professional, patient, or contact details in this prototype.

The profile form collects a name and date of birth for the local demo. Never collect or store a government-ID number, Aadhaar OTP, or identity document in this client-only prototype. Genuine Aadhaar verification requires an appropriately authorised service and its compliant authentication flow. PAN and ABHA are different identifiers and should only be verified through their respective authorised services. Do not claim Indian citizenship based on a public profile form.

Before a real-world launch, this prototype needs a secure backend and properly governed shared database; authorised identity-verification partners where appropriate; independently verified providers, registrations, inventory, and operating hours; consent-based, secure dispatch and appointment workflows; staffed incident handling; accessibility and local-language support; privacy notices, retention controls, and security review; and field testing for Arunachal Pradesh road access and connectivity. A straight-line radius is not a road-time or serviceability guarantee.