"use strict";

const towns = {
  Itanagar: { coordinates: [27.0844, 93.6053], label: "Itanagar, Papum Pare" },
  Naharlagun: { coordinates: [27.1044, 93.6950], label: "Naharlagun, Papum Pare" },
  Ziro: { coordinates: [27.5467, 93.8195], label: "Ziro, Lower Subansiri" },
  Tawang: { coordinates: [27.5861, 91.8594], label: "Tawang, Tawang" },
  Bomdila: { coordinates: [27.2645, 92.4159], label: "Bomdila, West Kameng" },
  Pasighat: { coordinates: [28.0665, 95.3268], label: "Pasighat, East Siang" },
  Aalo: { coordinates: [28.1683, 94.8007], label: "Aalo, West Siang" },
  Roing: { coordinates: [28.1482, 95.8410], label: "Roing, Lower Dibang Valley" },
  Tezu: { coordinates: [27.9258, 96.1650], label: "Tezu, Lohit" },
};

const state = {
  service: "ambulance",
  locationName: "Itanagar",
  coordinates: towns.Itanagar.coordinates,
  radiusKm: 20,
  userSelectedGps: false,
  hasSelectedLocation: false,
  geoWatchId: null,
  facilities: [],
  donors: [],
  donorOpportunities: [],
  donorProfile: null,
  currentUser: null,
  profileMode: "signup",
  toastTimeout: null,
};

const $ = (selector) => document.querySelector(selector);
async function apiRequest(path, options = {}) {
  const response = await fetch(path, {
    credentials: "same-origin",
    ...options,
    headers: { ...(options.body ? { "Content-Type": "application/json" } : {}), ...options.headers },
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || "The server could not complete this request.");
  return result;
}

function safeText(value) {
  const element = document.createElement("span");
  element.textContent = value;
  return element.innerHTML;
}

function getProviders() {
  return state.facilities;
}

function haversineKm(from, to) {
  const radians = (degrees) => degrees * Math.PI / 180;
  const latitudeDifference = radians(to[0] - from[0]);
  const longitudeDifference = radians(to[1] - from[1]);
  const value = Math.sin(latitudeDifference / 2) ** 2
    + Math.cos(radians(from[0])) * Math.cos(radians(to[0])) * Math.sin(longitudeDifference / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
}

function matchingProviders(service) {
  return getProviders()
    .filter((provider) => provider.services.includes(service))
    .map((provider) => ({ ...provider, distance: haversineKm(state.coordinates, provider.coordinates) }))
    .filter((provider) => provider.distance <= state.radiusKm)
    .sort((left, right) => left.distance - right.distance);
}

function renderDirectory() {
  const isBloodDirectory = state.service === "blood";
  const providers = matchingProviders(state.service);
  const directory = $("#providerDirectory");
  $("#directoryTitle").textContent = isBloodDirectory ? "Blood-service enquiry points" : "Nearby hospitals";
  $("#directoryEyebrow").textContent = isBloodDirectory ? "ASK ABOUT BLOOD SERVICES" : "HOSPITAL DIRECTORY";
  $("#directoryDescription").textContent = isBloodDirectory
    ? "Contact a hospital directly to ask about blood donation services, eligibility and current availability."
    : "Hospitals near your selected area. Contact each facility to confirm emergency and ambulance services.";
  $("#directoryCount").textContent = `${providers.length} ${providers.length === 1 ? "listing" : "listings"} within ${state.radiusKm} km`;

  if (!providers.length) {
    directory.innerHTML = `<p class="directory-empty">No listed facilities within ${state.radiusKm} km of ${safeText(state.locationName)}. Try a wider search radius or select another town.</p>`;
    renderVerifiedDonors();
    renderDonorOpportunities();
    return;
  }

  directory.innerHTML = providers.map((provider) => `
    <article class="facility-card">
      <div class="facility-card-top"><span class="facility-type">${isBloodDirectory ? "BLOOD SERVICE ENQUIRY" : "HOSPITAL"}</span><span class="facility-distance">${provider.distance.toFixed(1)} km · approximate</span></div>
      <h3>${safeText(provider.name)}</h3>
      <p class="facility-location">${safeText(provider.town)} · ${safeText(provider.district || "Arunachal Pradesh")} district</p>
      <p class="facility-contact">${isBloodDirectory ? "Contact the facility to confirm donation services and availability." : "Contact the facility to confirm services and ambulance availability."}</p>
      <a class="facility-search" href="https://www.google.com/search?q=${encodeURIComponent(`${provider.name} ${provider.town} official contact`)}" target="_blank" rel="noreferrer">Find contact details <span aria-hidden="true">↗</span></a>
    </article>`).join("");
  renderVerifiedDonors();
  renderDonorOpportunities();
}

function renderVerifiedDonors() {
  const donors = state.donors.map((donor) => {
    const town = Object.keys(towns).find((name) => name.toLowerCase() === donor.town.toLowerCase());
    if (!town) return null;
    return { ...donor, distance: haversineKm(state.coordinates, towns[town].coordinates) };
  }).filter((donor) => donor && donor.distance <= state.radiusKm)
    .sort((left, right) => left.distance - right.distance);
  $("#verifiedDonorCount").textContent = `${donors.length} verified ${donors.length === 1 ? "donor" : "donors"} within ${state.radiusKm} km`;

  if (!donors.length) {
    $("#verifiedDonorList").innerHTML = '<p class="donor-empty">No verified donors have opted into a public listing within this radius yet.</p>';
    return;
  }

  $("#verifiedDonorList").innerHTML = donors.map((donor) => {
    const lastDonation = donor.lastDonationDate
      ? new Date(`${donor.lastDonationDate}T12:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })
      : "Not provided";
    return `<article class="verified-donor-card"><div class="verified-donor-card-top"><span class="verified-badge">REVIEWED PROFILE</span><span class="donor-availability-status">${donor.available ? "Open to contact" : "Unavailable"}</span></div><h4>${safeText(donor.name)}</h4><span class="donor-blood-type">${safeText(donor.bloodGroup)}</span><p>${safeText(donor.town)} · ${donor.distance.toFixed(1)} km approximate</p><p class="donor-last-date">Last donated (self-reported): <strong>${safeText(lastDonation)}</strong></p></article>`;
  }).join("");
}

function renderDonorOpportunities() {
  const opportunities = state.donorOpportunities.map((request) => {
    const town = Object.keys(towns).find((name) => name.toLowerCase() === request.town.toLowerCase());
    if (!town) return null;
    return { ...request, distance: haversineKm(state.coordinates, towns[town].coordinates) };
  }).filter((request) => request && request.distance <= state.radiusKm);
  $("#donorOpportunityCount").textContent = `${opportunities.length} open ${opportunities.length === 1 ? "request" : "requests"} within ${state.radiusKm} km`;

  if (!opportunities.length) {
    $("#donorOpportunityList").innerHTML = '<p class="donor-empty">No reviewed requests are currently open for donors in this area.</p>';
    return;
  }

  const urgencyLabels = { immediate: "As soon as possible", "within-6-hours": "Within 6 hours", today: "Within 24 hours", planned: "Planned" };
  $("#donorOpportunityList").innerHTML = opportunities.map((request) => `
    <article class="donor-opportunity-card">
      <div class="opportunity-card-top"><span class="opportunity-badge">REVIEWED REQUEST</span><span class="facility-distance">${request.distance.toFixed(1)} km · approximate</span></div>
      <div class="opportunity-main"><span class="donor-blood-type">${safeText(request.bloodGroup)}</span><div><h4>${request.units} ${request.units === 1 ? "unit" : "units"} requested</h4><p>${safeText(request.facility)} · ${safeText(request.town)}</p></div></div>
      <p class="opportunity-urgency urgency-${safeText(request.urgency)}">Needed: <strong>${safeText(urgencyLabels[request.urgency] || request.urgency)}</strong></p>
      <button class="opportunity-respond ${request.hasResponded ? "response-received" : ""}" type="button" data-donor-opportunity="${safeText(request.id)}" ${request.hasResponded ? "disabled" : ""}>${request.hasResponded ? "Response recorded" : "Respond to donate"}<span aria-hidden="true">${request.hasResponded ? "✓" : "→"}</span></button>
      <p class="opportunity-response-count">${request.responseCount} donor ${request.responseCount === 1 ? "response" : "responses"} received</p>
    </article>`).join("");
}

function showToast(message) {
  const toast = $("#toast");
  toast.textContent = message;
  toast.classList.add("visible");
  window.clearTimeout(state.toastTimeout);
  state.toastTimeout = window.setTimeout(() => toast.classList.remove("visible"), 3500);
}

function showConfirmation(message, kicker = "DEMO ONLY") {
  $("#confirmationMessage").textContent = message;
  $("#confirmationKicker").textContent = kicker;
  $("#confirmationDialog").showModal();
}

function openDialog(dialog) {
  if (!dialog.open) dialog.showModal();
}

function updateAccountUI() {
  const user = state.currentUser;
  $("#loginButton").hidden = Boolean(user);
  $("#signupButton").hidden = Boolean(user);
  $("#profileButton").hidden = !user;
  $("#logoutButton").hidden = !user;
  if (!user) return;

  const initials = user.name.split(/\s+/).slice(0, 2).map((part) => part[0] || "").join("").toUpperCase();
  $("#profileInitials").textContent = initials || "HP";
  $("#profileLabel").textContent = user.role === "community" ? "My profile" : `${user.role}${user.status === "verified" ? "" : " · pending"}`;
  $("#profileButton").setAttribute("aria-label", user.status === "verified" ? `Open ${user.role} profile` : `${user.role} account pending verification`);
}

async function loadCurrentUser() {
  try {
    state.currentUser = (await apiRequest("/api/me")).user;
  } catch (error) {
    state.currentUser = null;
    if (!error.message.includes("Sign in")) showToast(error.message);
  }
  updateAccountUI();
}

function openLogin() {
  $("#loginForm").reset();
  openDialog($("#loginDialog"));
}

function openProfileEditor() {
  const user = state.currentUser;
  const isEditing = Boolean(user);
  state.profileMode = isEditing ? "edit" : "signup";
  $("#personName").value = user?.name || "";
  $("#personDob").value = user?.dateOfBirth || "";
  $("#personEmail").value = user?.email || "";
  $("#personEmail").readOnly = isEditing;
  $("#profilePasswordField").hidden = isEditing;
  $("#personPassword").required = !isEditing;
  $("#personPassword").value = "";
  const age = calculateAge($("#personDob").value);
  $("#personAge").value = age === "" ? "" : `${age} years`;
  $("#profileTitle").textContent = isEditing ? "Edit your profile." : "Welcome to the mesh.";
  $("#profileSubmitLabel").textContent = isEditing ? "Save changes" : "Create account";
  openDialog($("#profileDialog"));
}

function calculateAge(dateOfBirth) {
  if (!dateOfBirth) return "";
  const birthDate = new Date(`${dateOfBirth}T00:00:00`);
  const today = new Date();
  let age = today.getFullYear() - birthDate.getFullYear();
  if (today.getMonth() < birthDate.getMonth() || (today.getMonth() === birthDate.getMonth() && today.getDate() < birthDate.getDate())) age -= 1;
  return age >= 0 ? age : "";
}

function setService(service) {
  state.service = service;
  document.querySelectorAll(".service-option").forEach((button) => {
    const selected = button.dataset.service === service;
    button.classList.toggle("selected", selected);
    button.setAttribute("aria-pressed", String(selected));
  });
  renderDirectory();
}

function setTown(name) {
  const townKey = Object.keys(towns).find((key) => key.toLowerCase() === name.trim().toLowerCase());
  if (!townKey) {
    showToast("Choose a listed Arunachal Pradesh town to view example results.");
    $("#locationSearch").value = state.locationName;
    return;
  }

  if (state.geoWatchId !== null) {
    navigator.geolocation.clearWatch(state.geoWatchId);
    state.geoWatchId = null;
    updateGpsButton(false);
  }
  state.locationName = townKey;
  state.coordinates = towns[townKey].coordinates;
  state.userSelectedGps = false;
  state.hasSelectedLocation = true;
  $("#locationSearch").value = townKey;
  renderDirectory();
}

function updateGpsButton(isSharing) {
  const button = $("#gpsButton");
  const label = isSharing ? "Stop sharing my live location" : "Share my live location";
  button.setAttribute("aria-label", label);
  button.title = isSharing ? "Stop sharing live location" : "Share my live location";
  button.classList.toggle("is-sharing", isSharing);
}

function stopGps(showNotice = true) {
  if (state.geoWatchId !== null) {
    navigator.geolocation.clearWatch(state.geoWatchId);
    state.geoWatchId = null;
  }
  const wasSharing = state.userSelectedGps;
  state.userSelectedGps = false;
  if (wasSharing) {
    state.locationName = "Last shared location";
    $("#locationSearch").value = state.locationName;
  }
  updateGpsButton(false);
  renderDirectory();
  if (showNotice && wasSharing) showToast("Live location sharing stopped.");
}

function startGps() {
  if (state.geoWatchId !== null) {
    stopGps();
    return;
  }
  if (!navigator.geolocation) {
    showToast("Location sharing is not available in this browser.");
    return;
  }

  $("#gpsButton").setAttribute("aria-busy", "true");
  try {
    state.geoWatchId = navigator.geolocation.watchPosition((position) => {
      const isFirstLocation = !state.userSelectedGps;
      state.coordinates = [position.coords.latitude, position.coords.longitude];
      state.userSelectedGps = true;
      state.hasSelectedLocation = true;
      state.locationName = "Your live location";
      $("#locationSearch").value = "Your live location";
      $("#gpsButton").removeAttribute("aria-busy");
      updateGpsButton(true);
      renderDirectory();
      if (isFirstLocation) showToast("Live location is shared in this browser. Select the location button to stop.");
    }, (error) => {
      if (state.geoWatchId !== null) navigator.geolocation.clearWatch(state.geoWatchId);
      state.geoWatchId = null;
      $("#gpsButton").removeAttribute("aria-busy");
      const wasSharing = state.userSelectedGps;
      state.userSelectedGps = false;
      if (wasSharing) {
        state.locationName = "Last shared location";
        $("#locationSearch").value = state.locationName;
      }
      updateGpsButton(false);
      renderDirectory();
      const message = error.code === 1 ? "Location permission wasn't granted or was revoked. Choose a town or allow location in your browser settings." : "Couldn't update your live location. Choose a town or try sharing location again.";
      showToast(message);
    }, { enableHighAccuracy: true, timeout: 20000, maximumAge: 5000 });
  } catch {
    state.geoWatchId = null;
    $("#gpsButton").removeAttribute("aria-busy");
    updateGpsButton(false);
    showToast("Couldn't start live location. Check browser permission and connection security.");
  }
}

function updateBloodProviders() {
  const select = $("#bloodHospital");
  const providers = matchingProviders("blood");
  select.innerHTML = '<option value="">Choose a nearby hospital</option>' + providers.map((provider) => `<option value="${safeText(provider.id)}">${safeText(provider.name)} · ${safeText(provider.town)} · ${provider.distance.toFixed(1)} km (approx.)</option>`).join("");
  $("#bloodRequesterDisplay").textContent = `Submitting as ${state.currentUser.name} · ${state.currentUser.role}${state.currentUser.status === "verified" ? "" : " · pending verification"}.`;
}

function openBloodRequest() {
  if (!state.currentUser) {
    showToast("Log in to submit a blood request.");
    openLogin();
    return;
  }
  setService("blood");
  updateBloodProviders();
  openDialog($("#bloodDialog"));
}

async function loadPublicDonors() {
  try {
    state.donors = (await apiRequest("/api/donors")).donors;
  } catch (error) {
    $("#verifiedDonorCount").textContent = "Donor list unavailable";
    $("#verifiedDonorList").innerHTML = `<p class="donor-empty">${safeText(error.message)}</p>`;
    return;
  }
  renderVerifiedDonors();
}

async function loadDonorOpportunities() {
  try {
    state.donorOpportunities = (await apiRequest("/api/donor-opportunities")).opportunities;
    renderDonorOpportunities();
  } catch (error) {
    $("#donorOpportunityCount").textContent = "Requests unavailable";
    $("#donorOpportunityList").innerHTML = `<p class="donor-empty">${safeText(error.message)}</p>`;
  }
}

async function openDonorProfile() {
  if (!state.currentUser) {
    showToast("Log in or create an account to register as a donor.");
    openLogin();
    return;
  }
  try {
    state.donorProfile = (await apiRequest("/api/me/donor-profile")).donor;
    const donor = state.donorProfile;
    $("#donorDisplayName").value = donor?.name || state.currentUser.name;
    $("#donorBloodGroup").value = donor?.bloodGroup || "";
    $("#donorTown").value = donor?.town || state.currentUser.town || state.locationName;
    $("#donorLastDate").value = donor?.lastDonationDate || "";
    $("#donorLastDate").max = new Date().toISOString().slice(0, 10);
    $("#donorAvailable").checked = donor ? donor.available : true;
    $("#donorPublicConsent").checked = donor ? donor.consentPublic : false;
    $("#donorPublicConsent").required = !donor;
    $("#donorFormTitle").textContent = donor ? "Update donor profile." : "Become a donor.";
    $("#donorReviewStatus").textContent = donor ? `Current listing status: ${donor.status.replaceAll("_", " ")}.` : "New profiles require review before appearing in the directory.";
    openDialog($("#donorDialog"));
  } catch (error) {
    showToast(error.message);
  }
}

async function initialize() {
  document.querySelectorAll(".service-option").forEach((button) => button.addEventListener("click", () => setService(button.dataset.service)));
  $("#locationSearch").addEventListener("change", (event) => setTown(event.target.value));
  $("#locationSearch").addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      setTown(event.currentTarget.value);
    }
  });
  $("#gpsButton").addEventListener("click", startGps);
  $("#radiusRange").addEventListener("input", (event) => {
    state.radiusKm = Number(event.target.value);
    $("#radiusValue").textContent = `${state.radiusKm} km`;
    renderDirectory();
  });

  $("#loginButton").addEventListener("click", openLogin);
  $("#signupButton").addEventListener("click", openProfileEditor);
  $("#profileButton").addEventListener("click", openProfileEditor);
  $("#logoutButton").addEventListener("click", async () => {
    try {
      await apiRequest("/api/auth/logout", { method: "POST" });
      state.currentUser = null;
      updateAccountUI();
      await loadDonorOpportunities();
      showToast("You have signed out.");
    } catch (error) {
      showToast(error.message);
    }
  });
  $("#loginForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!event.currentTarget.reportValidity()) return;
    try {
      const { user } = await apiRequest("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ email: $("#loginEmail").value.trim(), password: $("#loginPassword").value }),
      });
      state.currentUser = user;
      updateAccountUI();
      $("#loginDialog").close();
      await loadDonorOpportunities();
      showToast(user.status === "verified" ? "Signed in." : "Signed in. Your account is not verified.");
    } catch (error) {
      showToast(error.message);
    }
  });
  $("#profileForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const dateOfBirth = $("#personDob").value;
    if (dateOfBirth > new Date().toISOString().slice(0, 10)) {
      showToast("Please enter a date of birth in the past.");
      return;
    }
    if (!form.reportValidity()) return;
    const isEditing = state.profileMode === "edit";
    try {
      const result = await apiRequest(isEditing ? "/api/me" : "/api/auth/signup", {
        method: isEditing ? "PUT" : "POST",
        body: JSON.stringify(isEditing ? {
          name: $("#personName").value.trim(),
          dateOfBirth,
        } : {
          name: $("#personName").value.trim(),
          dateOfBirth,
          email: $("#personEmail").value.trim(),
          password: $("#personPassword").value,
          role: "community",
        }),
      });
      state.currentUser = result.user;
      updateAccountUI();
      $("#profileDialog").close();
      showToast(isEditing ? "Profile updated." : "Account created. You are signed in.");
    } catch (error) {
      showToast(error.message);
    }
  });
  $("#personDob").addEventListener("input", (event) => {
    const age = calculateAge(event.currentTarget.value);
    $("#personAge").value = age === "" ? "" : `${age} years`;
  });

  $("#seekerButton").addEventListener("click", () => {
    if (!state.currentUser) {
      showToast("Log in or create an account to submit a request.");
      openLogin();
      return;
    }
    if (state.service === "ambulance") {
      $("#ambulanceLocation").textContent = state.locationName;
      $("#locationConfirmStatus").textContent = state.userSelectedGps ? "Location shared" : "Area selected";
      openDialog($("#ambulanceDialog"));
    } else {
      openBloodRequest();
    }
  });
  $("#donorRequestButton").addEventListener("click", openBloodRequest);
  $("#becomeDonorButton").addEventListener("click", openDonorProfile);
  $("#donorOpportunityList").addEventListener("click", async (event) => {
    const button = event.target.closest("[data-donor-opportunity]");
    if (!button) return;
    if (!state.currentUser) {
      showToast("Log in with a reviewed donor account to respond.");
      openLogin();
      return;
    }
    button.disabled = true;
    try {
      const result = await apiRequest(`/api/donor-opportunities/${button.dataset.donorOpportunity}/respond`, { method: "POST" });
      showToast(`${result.message} Response ID: ${result.response.id.slice(0, 8)}.`);
      await loadDonorOpportunities();
    } catch (error) {
      button.disabled = false;
      showToast(error.message);
    }
  });
  $("#donorProfileForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    if (!form.reportValidity()) return;
    const isUpdating = Boolean(state.donorProfile);
    try {
      const result = await apiRequest("/api/me/donor-profile", {
        method: isUpdating ? "PUT" : "POST",
        body: JSON.stringify({
          name: $("#donorDisplayName").value.trim(),
          bloodGroup: $("#donorBloodGroup").value,
          town: $("#donorTown").value.trim(),
          lastDonationDate: $("#donorLastDate").value,
          available: $("#donorAvailable").checked,
          consentPublic: $("#donorPublicConsent").checked,
        }),
      });
      $("#donorDialog").close();
      await loadPublicDonors();
      await loadDonorOpportunities();
      const message = $("#donorPublicConsent").checked
        ? "Your donor profile is pending review. It will only appear publicly after approval."
        : "Your profile is now hidden from the public donor directory.";
      showConfirmation(message, "DONOR PROFILE UPDATED");
    } catch (error) {
      showToast(error.message);
    }
  });
  $("#ambulanceForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!event.currentTarget.reportValidity()) return;
    try {
      const { request } = await apiRequest("/api/ambulance-requests", {
        method: "POST",
        body: JSON.stringify({ town: state.locationName, note: $("#emergencyNote").value.trim() }),
      });
      $("#ambulanceDialog").close();
      event.currentTarget.reset();
      showConfirmation(`Request ${request.id.slice(0, 8)} is stored as not dispatched. No ambulance was contacted. In an emergency, call 112.`, "STORED · NOT DISPATCHED");
    } catch (error) {
      showToast(error.message);
    }
  });
  $("#emergencyPhoto").addEventListener("change", (event) => {
    if (event.currentTarget.files.length) showToast("Your photo has not been uploaded or shared.");
  });

  $("#bloodForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!event.currentTarget.reportValidity()) return;
    const selectedProvider = matchingProviders("blood").find((provider) => provider.id === $("#bloodHospital").value);
    if (!selectedProvider) {
      showToast("Choose a nearby hospital within your selected search radius.");
      return;
    }
    try {
      const result = await apiRequest("/api/blood-requests", {
        method: "POST",
        body: JSON.stringify({
          facilityId: selectedProvider.id,
          bloodGroup: $("#bloodGroup").value,
          units: Number($("#bloodUnits").value),
          urgency: $("#bloodUrgency").value,
          shareForDonors: $("#bloodShareConsent").checked,
        }),
      });
      $("#bloodDialog").close();
      event.currentTarget.reset();
      showConfirmation(`${result.message} Request ID: ${result.request.id.slice(0, 8)}. Contact the selected hospital directly; call 112 for an immediate emergency.`, result.request.status === "pending_verification" ? "STORED · PENDING VERIFICATION" : "STORED · NOT DISPATCHED");
    } catch (error) {
      showToast(error.message);
    }
  });

  $("#feedbackForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    if (!form.reportValidity()) return;
    const submitButton = form.querySelector('button[type="submit"]');
    submitButton.disabled = true;
    $("#feedbackStatus").textContent = "Sending feedback…";
    try {
      await apiRequest("/api/feedback", {
        method: "POST",
        body: JSON.stringify({
          name: $("#feedbackName").value.trim(),
          email: $("#feedbackEmail").value.trim(),
          comment: $("#feedbackComment").value.trim(),
        }),
      });
      form.reset();
      $("#feedbackStatus").textContent = "Thanks for your feedback. It was sent to the site team for review.";
    } catch (error) {
      $("#feedbackStatus").textContent = error.message;
    } finally {
      submitButton.disabled = false;
    }
  });

  $("#providerButton").addEventListener("click", () => openDialog($("#providerAccessDialog")));
  $("#accessRole").addEventListener("change", (event) => {
    const registration = {
      hospital: ["Facility registration number", "Relevant facility registration"],
      doctor: ["Medical council registration number", "Your medical council registration"],
      nurse: ["Nursing council registration number", "Your nursing council registration"],
    }[event.currentTarget.value];
    $("#accessRegistrationLabel").textContent = registration[0];
    $("#accessRegistration").placeholder = registration[1];
  });
  $("#providerAccessForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    if (!form.reportValidity()) return;
    const selectedTown = Object.keys(towns).find((town) => town.toLowerCase() === $("#accessTown").value.trim().toLowerCase());
    if (!selectedTown) {
      showToast("Choose a listed Arunachal Pradesh town.");
      return;
    }
    try {
      const { user } = await apiRequest("/api/auth/signup", {
        method: "POST",
        body: JSON.stringify({
          role: $("#accessRole").value,
          name: $("#accessName").value.trim(),
          facility: $("#accessFacility").value.trim(),
          registrationNumber: $("#accessRegistration").value.trim(),
          town: selectedTown,
          email: $("#accessEmail").value.trim(),
          password: $("#accessPassword").value,
        }),
      });
      state.currentUser = user;
      updateAccountUI();
      $("#providerAccessDialog").close();
      form.reset();
      showConfirmation("Your account is active for sign-in, but your professional status is pending independent review. Requests are stored without notifying hospitals or donors.", "ACCOUNT CREATED · PENDING REVIEW");
    } catch (error) {
      showToast(error.message);
    }
  });

  document.querySelectorAll("[data-close]").forEach((button) => button.addEventListener("click", () => button.closest("dialog").close()));
  document.querySelectorAll(".site-dialog").forEach((dialog) => {
    dialog.addEventListener("click", (event) => {
      if (event.target === dialog) dialog.close();
    });
    dialog.addEventListener("close", () => dialog.querySelector("form")?.reset());
  });
  try {
    state.facilities = (await apiRequest("/api/facilities")).facilities.map((facility) => ({
      ...facility,
      coordinates: [facility.latitude, facility.longitude],
    }));
  } catch (error) {
    showToast(`Could not load the care directory: ${error.message}`);
  }
  renderDirectory();
  await loadCurrentUser();
  await loadPublicDonors();
  await loadDonorOpportunities();
}

document.addEventListener("DOMContentLoaded", initialize);