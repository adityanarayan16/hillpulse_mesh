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
  { id: "sample-itanagar-ambulance", name: "Example ambulance provider", town: "Itanagar", coordinates: [27.0844, 93.6053], services: ["ambulance"] },
  { id: "sample-itanagar-blood", name: "Example blood-service provider", town: "Itanagar", coordinates: [27.096, 93.613], services: ["blood"] },
  { id: "sample-naharlagun-ambulance", name: "Example ambulance provider", town: "Naharlagun", coordinates: [27.1044, 93.6950], services: ["ambulance"] },
  { id: "sample-naharlagun-blood", name: "Example blood-service provider", town: "Naharlagun", coordinates: [27.111, 93.7], services: ["blood"] },
  { id: "sample-ziro-ambulance", name: "Example ambulance provider", town: "Ziro", coordinates: [27.5467, 93.8195], services: ["ambulance"] },
  { id: "sample-ziro-blood", name: "Example blood-service provider", town: "Ziro", coordinates: [27.55, 93.825], services: ["blood"] },
  { id: "sample-tawang-ambulance", name: "Example ambulance provider", town: "Tawang", coordinates: [27.5861, 91.8594], services: ["ambulance"] },
  { id: "sample-tawang-blood", name: "Example blood-service provider", town: "Tawang", coordinates: [27.591, 91.866], services: ["blood"] },
  { id: "sample-bomdila-ambulance", name: "Example ambulance provider", town: "Bomdila", coordinates: [27.2645, 92.4159], services: ["ambulance"] },
  { id: "sample-pasighat-ambulance", name: "Example ambulance provider", town: "Pasighat", coordinates: [28.0665, 95.3268], services: ["ambulance"] },
  { id: "sample-pasighat-blood", name: "Example blood-service provider", town: "Pasighat", coordinates: [28.073, 95.333], services: ["blood"] },
  { id: "sample-aalo-ambulance", name: "Example ambulance provider", town: "Aalo", coordinates: [28.1683, 94.8007], services: ["ambulance"] },
  { id: "sample-roing-ambulance", name: "Example ambulance provider", town: "Roing", coordinates: [28.1482, 95.8410], services: ["ambulance"] },
  { id: "sample-roing-blood", name: "Example blood-service provider", town: "Roing", coordinates: [28.155, 95.849], services: ["blood"] },
  { id: "sample-tezu-ambulance", name: "Example ambulance provider", town: "Tezu", coordinates: [27.9258, 96.1650], services: ["ambulance"] },
];

const storageKey = "hillpulse-mesh-demo-v1";
const state = {
  service: "ambulance",
  locationName: "Itanagar",
  coordinates: towns.Itanagar.coordinates,
  radiusKm: 20,
  userSelectedGps: false,
  hasSelectedLocation: false,
  map: null,
  markerLayer: null,
  radiusLayer: null,
  userMarker: null,
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

function formatTown(provider) {
  const savedFacilities = getSavedData().facilities || [];
  if (savedFacilities.some((facility) => facility.id === provider.id)) {
    return `${provider.town} · example listing`;
  }
  return `${provider.town} · example only`;
}

function renderResults() {
  const providers = matchingProviders(state.service);
  const serviceLabel = state.service === "ambulance" ? "ambulance" : "blood-service";
  const resultContainer = $("#providerResults");
  $("#resultsTitle").textContent = state.service === "ambulance" ? "AMBULANCE EXAMPLES" : "BLOOD SERVICE EXAMPLES";
  $("#resultsCount").textContent = `${providers.length} within ${state.radiusKm} km`;
  $("#ambulanceLegendLabel").textContent = `${state.service === "ambulance" ? "Ambulance" : "Provider"} · example`;

  if (!providers.length) {
    resultContainer.innerHTML = `<p class="no-results">No ${serviceLabel} examples within ${state.radiusKm} km of ${safeText(state.locationName)}.</p>`;
    return;
  }

  resultContainer.innerHTML = providers.slice(0, 3).map((provider) => `
    <div class="result-row">
      <span class="result-icon ${state.service === "ambulance" ? "ambulance-result-icon" : "blood-result-icon"}" aria-hidden="true">
        ${state.service === "ambulance" ? '<svg viewBox="0 0 24 24"><path d="M3 7.5h11.5v10H3zM14.5 11h3.8l2.7 3v3.5h-6.5zM7 10v5m-2.5-2.5h5"/></svg>' : '<svg viewBox="0 0 24 24"><path d="M12 3.5S5.7 10 5.7 14.5a6.3 6.3 0 0 0 12.6 0C18.3 10 12 3.5 12 3.5Z"/><path d="M9.5 15a2.5 2.5 0 0 0 2.5 2.5"/></svg>'}
      </span>
      <span class="result-copy"><strong>${safeText(provider.name)}</strong><small>${safeText(formatTown(provider))}</small></span>
      <span class="result-distance">${provider.distance.toFixed(1)} km</span>
    </div>`).join("");
}

function markerIcon(service) {
  const icon = service === "ambulance"
    ? '<svg viewBox="0 0 24 24"><path d="M3 7.5h11.5v10H3zM14.5 11h3.8l2.7 3v3.5h-6.5zM7 10v5m-2.5-2.5h5"/></svg>'
    : '<svg viewBox="0 0 24 24"><path d="M12 3.5S5.7 10 5.7 14.5a6.3 6.3 0 0 0 12.6 0C18.3 10 12 3.5 12 3.5Z"/><path d="M9.5 15a2.5 2.5 0 0 0 2.5 2.5"/></svg>';
  return L.divIcon({ className: "", html: `<span class="provider-marker ${service}-marker">${icon}</span>`, iconSize: [25, 25], iconAnchor: [12, 12], popupAnchor: [0, -13] });
}

function refreshMapAndResults() {
  renderResults();
  if (!state.map) return;

  state.markerLayer.clearLayers();
  matchingProviders("ambulance").concat(matchingProviders("blood")).forEach((provider) => {
    const service = provider.services.includes("ambulance") ? "ambulance" : "blood";
    const marker = L.marker(provider.coordinates, { icon: markerIcon(service) });
    marker.bindPopup(`<strong>${safeText(provider.name)}</strong><br>${safeText(formatTown(provider))}<br>Approx. ${provider.distance.toFixed(1)} km · example only`);
    state.markerLayer.addLayer(marker);
  });

  state.radiusLayer.setLatLng(state.coordinates);
  state.radiusLayer.setRadius(state.radiusKm * 1000);
  if (state.hasSelectedLocation) {
    state.map.setView(state.coordinates, state.userSelectedGps || state.radiusKm <= 10 ? 10 : 9);
  } else {
    state.map.fitBounds([[26.3, 91.3], [29.5, 97.5]], { padding: [30, 30], maxZoom: 7 });
  }
  if (state.userSelectedGps) {
    state.userMarker = L.marker(state.coordinates, {
      icon: L.divIcon({ className: "", html: '<span class="user-marker"></span>', iconSize: [20, 20], iconAnchor: [10, 10] }),
      keyboard: true,
      title: "Your shared location",
    }).bindPopup("Your shared location · visible only in this browser");
    state.markerLayer.addLayer(state.userMarker);
  }
  $("#mapStatus").textContent = `SHOWING EXAMPLE LOCATIONS · ${state.locationName.toUpperCase()}`;
}

function initMap() {
  if (!window.L) {
    $("#map").innerHTML = '<div class="map-fallback">The interactive map needs an internet connection to load. You can still browse the example location list.</div>';
    return;
  }

  state.map = L.map("map", { scrollWheelZoom: false, zoomControl: false, attributionControl: true });
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 18,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a>',
  }).addTo(state.map);
  L.control.zoom({ position: "bottomleft" }).addTo(state.map);
  state.markerLayer = L.featureGroup().addTo(state.map);
  state.radiusLayer = L.circle(state.coordinates, { radius: state.radiusKm * 1000, color: "#718663", fillColor: "#9aad78", fillOpacity: 0.10, weight: 1, dashArray: "5 6" }).addTo(state.map);
  refreshMapAndResults();
  window.setTimeout(() => state.map.invalidateSize(), 100);
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
  renderResults();
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
  $("#mapStatus").textContent = `SHOWING EXAMPLE LOCATIONS · ${townKey.toUpperCase()}`;
  refreshMapAndResults();
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
  refreshMapAndResults();
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
      $("#mapStatus").textContent = "LIVE LOCATION · EXAMPLE PROVIDERS ONLY";
      $("#gpsButton").removeAttribute("aria-busy");
      updateGpsButton(true);
      refreshMapAndResults();
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
      refreshMapAndResults();
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
  select.innerHTML = '<option value="">Choose an example provider</option>' + providers.map((provider) => `<option value="${safeText(provider.id)}">${safeText(provider.name)} · ${safeText(provider.town)} · ${provider.distance.toFixed(1)} km (example)</option>`).join("");
}

function initialize() {
  initMap();

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
    $(".legend-radius").innerHTML = `<i></i>${state.radiusKm} km`;
    refreshMapAndResults();
  });
  $("#mapRefresh").addEventListener("click", refreshMapAndResults);

  $("#profileButton").addEventListener("click", () => {
    const profile = getSavedData().profile;
    if (profile) {
      showToast(`Demo profile for ${profile.name}. Stored in this browser only.`);
      return;
    }
    openDialog($("#profileDialog"));
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
      const saved = saveData("profile", { name: $("#personName").value.trim(), dateOfBirth, age: calculateAge(dateOfBirth), role: $("#personRole").value });
      if (saved) {
        $("#profileDialog").close();
        updateProfileUI();
        showToast("Demo profile saved in this browser only.");
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
      updateBloodProviders();
      openDialog($("#bloodDialog"));
    }
  });
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

  $("#bloodDate").min = new Date().toISOString().slice(0, 10);
  $("#bloodForm").addEventListener("submit", (event) => {
    event.preventDefault();
    if (!event.currentTarget.reportValidity()) return;
    const selectedProvider = matchingProviders("blood").find((provider) => provider.id === $("#bloodHospital").value);
    if (!selectedProvider) {
      showToast("Choose an example provider within your selected search radius.");
      return;
    }
    const saved = saveData("bloodRequests", [...(getSavedData().bloodRequests || []), {
      id: `DEMO-${Date.now().toString(36).toUpperCase()}`,
      town: state.locationName,
      bloodGroup: $("#bloodGroup").value,
      requestedDate: $("#bloodDate").value,
      provider: selectedProvider.name,
      createdAt: new Date().toISOString(),
    }]);
    if (saved) {
      $("#bloodDialog").close();
      event.currentTarget.reset();
      showConfirmation("Your sample blood-service inquiry was saved only in this browser. It was not sent to the example provider, and no visit or inventory has been confirmed. Please call a provider directly.");
    }
  });

  $("#providerButton").addEventListener("click", () => openDialog($("#providerDialog")));
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
      refreshMapAndResults();
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