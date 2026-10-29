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

const demoProviders = [
  { id: "facility-trihms", name: "Tomo Riba Institute of Health and Medical Sciences", town: "Naharlagun", district: "Papum Pare", coordinates: [27.1044, 93.6950], services: ["ambulance", "blood"] },
  { id: "facility-rkmh", name: "Ramakrishna Mission Hospital", town: "Itanagar", district: "Papum Pare", coordinates: [27.0844, 93.6053], services: ["ambulance", "blood"] },
  { id: "facility-ziro", name: "District Hospital, Ziro", town: "Ziro", district: "Lower Subansiri", coordinates: [27.5467, 93.8195], services: ["ambulance", "blood"] },
  { id: "facility-tawang", name: "District Hospital, Tawang", town: "Tawang", district: "Tawang", coordinates: [27.5861, 91.8594], services: ["ambulance", "blood"] },
  { id: "facility-pasighat", name: "Bakin Pertin General Hospital", town: "Pasighat", district: "East Siang", coordinates: [28.0665, 95.3268], services: ["ambulance", "blood"] },
  { id: "facility-bomdila", name: "District Hospital, Bomdila", town: "Bomdila", district: "West Kameng", coordinates: [27.2645, 92.4159], services: ["ambulance", "blood"] },
  { id: "facility-aalo", name: "District Hospital, Aalo", town: "Aalo", district: "West Siang", coordinates: [28.1683, 94.8007], services: ["ambulance", "blood"] },
  { id: "facility-roing", name: "General Hospital, Roing", town: "Roing", district: "Lower Dibang Valley", coordinates: [28.1482, 95.8410], services: ["ambulance", "blood"] },
  { id: "facility-tezu", name: "District Hospital, Tezu", town: "Tezu", district: "Lohit", coordinates: [27.9258, 96.1650], services: ["ambulance", "blood"] },
];

const storageKey = "hillpulse-mesh-demo-v1";
const sessionKey = "hillpulse-mesh-session-v1";
const state = {
  service: "ambulance",
  locationName: "Itanagar",
  coordinates: towns.Itanagar.coordinates,
  radiusKm: 20,
  userSelectedGps: false,
  hasSelectedLocation: false,
  geoWatchId: null,
  toastTimeout: null,
};

const $ = (selector) => document.querySelector(selector);
const getSavedData = () => {
  try {
    return JSON.parse(localStorage.getItem(storageKey) || "{}") || {};
  } catch {
    return {};
  }
};
const saveData = (key, value) => {
  try {
    const data = getSavedData();
    data[key] = value;
    localStorage.setItem(storageKey, JSON.stringify(data));
    return true;
  } catch {
    showToast("Your browser couldn't save this demo record.");
    return false;
  }
};

function safeText(value) {
  const element = document.createElement("span");
  element.textContent = value;
  return element.innerHTML;
}

function getProviders() {
  const savedFacilities = getSavedData().facilities || [];
  return [...demoProviders, ...savedFacilities];
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

function updateProfileUI() {
  const profile = getSavedData().profile;
  if (!profile) return;
  const initials = profile.name.split(/\s+/).slice(0, 2).map((part) => part[0] || "").join("").toUpperCase();
  $("#profileInitials").textContent = initials || "HP";
  $("#profileLabel").textContent = profile.name.split(/\s+/)[0];
}

function getDemoAccounts() {
  const data = getSavedData();
  const accounts = [];
  if (data.profile) {
    accounts.push({ id: "community-profile", name: data.profile.name, role: "community", isProfile: true });
  }
  (data.providerApplications || []).forEach((application) => {
    accounts.push({ id: application.id, name: application.name, role: application.role, isProfile: false });
  });
  return accounts;
}

function getActiveDemoAccount() {
  try {
    const activeId = sessionStorage.getItem(sessionKey);
    return getDemoAccounts().find((account) => account.id === activeId) || null;
  } catch {
    return null;
  }
}

function setDemoSession(accountId) {
  try {
    sessionStorage.setItem(sessionKey, accountId);
    updateAccountUI();
    return true;
  } catch {
    showToast("Demo session storage is unavailable in this browser.");
    return false;
  }
}

function updateAccountUI() {
  const account = getActiveDemoAccount();
  $("#loginButton").hidden = Boolean(account);
  $("#signupButton").hidden = Boolean(account);
  $("#profileButton").hidden = !account;
  $("#logoutButton").hidden = !account;
  if (!account) return;

  const initials = account.name.split(/\s+/).slice(0, 2).map((part) => part[0] || "").join("").toUpperCase();
  $("#profileInitials").textContent = initials || "HP";
  $("#profileLabel").textContent = account.isProfile ? "My profile" : `${account.role} · demo`;
  $("#profileButton").setAttribute("aria-label", account.isProfile ? "Open your profile" : `Demo account for ${account.name}; pending verification`);
}

function openDemoLogin() {
  const accounts = getDemoAccounts();
  const select = $("#loginAccount");
  select.innerHTML = accounts.length
    ? '<option value="">Choose a local demo profile</option>' + accounts.map((account) => `<option value="${safeText(account.id)}">${safeText(account.name)} · ${safeText(account.role)}${account.isProfile ? "" : " · pending verification"}</option>`).join("")
    : '<option value="">No demo profiles found</option>';
  $("#loginSubmit").disabled = accounts.length === 0;
  openDialog($("#loginDialog"));
}

function openProfileEditor() {
  const profile = getSavedData().profile;
  const isEditing = Boolean(profile);
  $("#personName").value = profile?.name || "";
  $("#personDob").value = profile?.dateOfBirth || "";
  const age = calculateAge($("#personDob").value);
  $("#personAge").value = age === "" ? "" : `${age} years`;
  $("#personRole").value = profile?.role || "seeker";
  $("#profileTitle").textContent = isEditing ? "Edit your profile." : "Welcome to the mesh.";
  $("#profileSubmitLabel").textContent = isEditing ? "Save changes" : "Continue to the demo";
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
  updateBloodRequesters();
}

function updateBloodRequesters() {
  const select = $("#bloodRequester");
  const applications = getSavedData().providerApplications || [];
  select.innerHTML = '<option value="community">Community member</option>' + applications.map((application) => `<option value="${safeText(application.id)}">${safeText(application.name)} · ${safeText(application.role)} · pending verification</option>`).join("");
}

function openBloodRequest() {
  setService("blood");
  updateBloodProviders();
  openDialog($("#bloodDialog"));
}

function initialize() {
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

  $("#loginButton").addEventListener("click", openDemoLogin);
  $("#signupButton").addEventListener("click", () => {
    if (getSavedData().profile) {
      openDemoLogin();
      return;
    }
    openProfileEditor();
  });
  $("#profileButton").addEventListener("click", () => {
    const account = getActiveDemoAccount();
    if (account?.isProfile) {
      openProfileEditor();
      return;
    }
    if (account) showToast("Provider access is pending review and is not verified in this demo.");
  });
  $("#logoutButton").addEventListener("click", () => {
    try {
      sessionStorage.removeItem(sessionKey);
      updateAccountUI();
      showToast("You have left the demo session.");
    } catch {
      showToast("Could not clear the demo session in this browser.");
    }
  });
  $("#loginForm").addEventListener("submit", (event) => {
    event.preventDefault();
    const account = getDemoAccounts().find((candidate) => candidate.id === $("#loginAccount").value);
    if (!account) {
      showToast("Choose an existing local demo profile or sign up first.");
      return;
    }
    if (setDemoSession(account.id)) {
      $("#loginDialog").close();
      showToast("Demo session started. This is not a verified login.");
    }
  });
  $("#profileForm").addEventListener("submit", (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const dateOfBirth = $("#personDob").value;
    if (dateOfBirth > new Date().toISOString().slice(0, 10)) {
      showToast("Please enter a date of birth in the past.");
      return;
    }
    if (form.reportValidity()) {
      const isEditing = Boolean(getSavedData().profile);
      const saved = saveData("profile", { name: $("#personName").value.trim(), dateOfBirth, age: calculateAge(dateOfBirth), role: $("#personRole").value });
      if (saved) {
        $("#profileDialog").close();
        setDemoSession("community-profile");
        updateAccountUI();
        showToast(isEditing ? "Profile updated on this device." : "Demo profile saved in this browser only.");
      }
    }
  });
  $("#personDob").addEventListener("input", (event) => {
    const age = calculateAge(event.currentTarget.value);
    $("#personAge").value = age === "" ? "" : `${age} years`;
  });

  $("#seekerButton").addEventListener("click", () => {
    if (state.service === "ambulance") {
      $("#ambulanceLocation").textContent = state.locationName;
      $("#locationConfirmStatus").textContent = state.userSelectedGps ? "Location shared" : "Area selected";
      openDialog($("#ambulanceDialog"));
    } else {
      openBloodRequest();
    }
  });
  $("#donorRequestButton").addEventListener("click", openBloodRequest);
  $("#ambulanceForm").addEventListener("submit", (event) => {
    event.preventDefault();
    if (!event.currentTarget.reportValidity()) return;
    const saved = saveData("ambulanceRequests", [...(getSavedData().ambulanceRequests || []), {
      id: `DEMO-${Date.now().toString(36).toUpperCase()}`,
      town: state.locationName,
      note: $("#emergencyNote").value.trim(),
      createdAt: new Date().toISOString(),
    }]);
    if (saved) {
      $("#ambulanceDialog").close();
      event.currentTarget.reset();
      showConfirmation("A sample ambulance request was saved in this browser. It contains no GPS coordinates, was not sent to any provider, and has not arranged an ambulance. In an emergency, call 112.", "NOT SENT · DEMO ONLY");
    }
  });
  $("#emergencyPhoto").addEventListener("change", (event) => {
    if (event.currentTarget.files.length) showToast("Your photo has not been uploaded or shared.");
  });

  $("#bloodForm").addEventListener("submit", (event) => {
    event.preventDefault();
    if (!event.currentTarget.reportValidity()) return;
    const selectedProvider = matchingProviders("blood").find((provider) => provider.id === $("#bloodHospital").value);
    if (!selectedProvider) {
      showToast("Choose a nearby hospital within your selected search radius.");
      return;
    }
    const requesterId = $("#bloodRequester").value;
    const requester = (getSavedData().providerApplications || []).find((application) => application.id === requesterId);
    const saved = saveData("bloodRequests", [...(getSavedData().bloodRequests || []), {
      id: `DEMO-${Date.now().toString(36).toUpperCase()}`,
      town: state.locationName,
      bloodGroup: $("#bloodGroup").value,
      unitsNeeded: Number($("#bloodUnits").value),
      urgency: $("#bloodUrgency").value,
      provider: selectedProvider.name,
      requesterId: requester?.id || null,
      requesterRole: requester?.role || "community",
      requestStatus: "local-demo-only",
      createdAt: new Date().toISOString(),
    }]);
    if (saved) {
      $("#bloodDialog").close();
      event.currentTarget.reset();
      showConfirmation("Your demo donor request was saved only in this browser. No donor or hospital was notified, and no blood has been reserved. Contact the selected hospital directly; call 112 for an immediate emergency.", "NOT SENT · DEMO ONLY");
    }
  });

  $("#providerButton").addEventListener("click", () => openDialog($("#providerAccessDialog")));
  $("#bloodStaffSignup").addEventListener("click", () => {
    $("#bloodDialog").close();
    openDialog($("#providerAccessDialog"));
  });
  $("#accessRole").addEventListener("change", (event) => {
    const registration = {
      hospital: ["Facility registration number", "Relevant facility registration"],
      doctor: ["Medical council registration number", "Your medical council registration"],
      nurse: ["Nursing council registration number", "Your nursing council registration"],
    }[event.currentTarget.value];
    $("#accessRegistrationLabel").textContent = registration[0];
    $("#accessRegistration").placeholder = registration[1];
  });
  $("#providerAccessForm").addEventListener("submit", (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    if (!form.reportValidity()) return;
    const selectedTown = Object.keys(towns).find((town) => town.toLowerCase() === $("#accessTown").value.trim().toLowerCase());
    if (!selectedTown) {
      showToast("Choose a listed Arunachal Pradesh town.");
      return;
    }
    const application = {
      id: `DEMO-ACCESS-${Date.now().toString(36).toUpperCase()}`,
      role: $("#accessRole").value,
      name: $("#accessName").value.trim(),
      facility: $("#accessFacility").value.trim(),
      registrationNumber: $("#accessRegistration").value.trim(),
      town: selectedTown,
      workEmail: $("#accessEmail").value.trim(),
      status: "pending-verification-demo",
      createdAt: new Date().toISOString(),
    };
    const saved = saveData("providerApplications", [...(getSavedData().providerApplications || []), application]);
    if (saved) {
      $("#providerAccessDialog").close();
      form.reset();
      updateBloodRequesters();
      showConfirmation("Your provider access application was saved only in this browser. It was not sent to an administrator, verified, or activated. You cannot use this prototype to submit a genuine clinical request.", "NOT SENT · PENDING DEMO");
    }
  });
  $("#providerForm").addEventListener("submit", (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const services = [...form.querySelectorAll('input[name="service"]:checked')].map((checkbox) => checkbox.value);
    const selectedTown = Object.keys(towns).find((town) => town.toLowerCase() === $("#facilityTown").value.trim().toLowerCase());
    if (!form.reportValidity()) return;
    if (!selectedTown) {
      showToast("Choose a listed Arunachal Pradesh town.");
      return;
    }
    if (!services.length) {
      showToast("Select at least one service.");
      return;
    }
    const facility = {
      id: `demo-provider-${Date.now().toString(36)}`,
      name: $("#facilityName").value.trim(),
      registrationNumber: $("#facilityReg").value.trim(),
      town: selectedTown,
      coordinates: towns[selectedTown].coordinates,
      services,
      phone: $("#facilityPhone").value.trim(),
    };
    const saved = saveData("facilities", [...(getSavedData().facilities || []), facility]);
    if (saved) {
      $("#providerDialog").close();
      form.reset();
      renderDirectory();
      showConfirmation("Your example listing was saved in this browser only. It has not been verified, published, or shared with care seekers.", "NOT PUBLISHED · DEMO ONLY");
    }
  });

  document.querySelectorAll("[data-close]").forEach((button) => button.addEventListener("click", () => button.closest("dialog").close()));
  document.querySelectorAll(".site-dialog").forEach((dialog) => {
    dialog.addEventListener("click", (event) => {
      if (event.target === dialog) dialog.close();
    });
    dialog.addEventListener("close", () => dialog.querySelector("form")?.reset());
  });
  updateProfileUI();
}

document.addEventListener("DOMContentLoaded", initialize);