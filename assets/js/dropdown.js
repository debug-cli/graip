// thanks to https://waves.lat for custom dropdowns || https://gitlab.com/waveslab/waves
const appSettings = {
  backend: localStorage.getItem("graip_backend") || "Scramjet",
  searchEngine: localStorage.getItem("graip_searchEngine") || "Google",
  decoy: localStorage.getItem("decoy") || "None",
  wisp: localStorage.getItem("graip_wispUrlSelected") || "Phantom",
  theme: localStorage.getItem("graip_theme") || "midnight",
  store: localStorage.getItem("graip_gameStore") || "Classplay",
};

const searchEngineSelector = document.querySelector(".search-engine-selector");
const searchEngineSelected = searchEngineSelector.querySelector(
  ".search-engine-selected"
);
const searchEngineOptions = searchEngineSelector.querySelector(
  ".search-engine-options"
);

const decoySelector = document.querySelector(".decoy-selector");
const decoySelected = decoySelector.querySelector(".decoy-selected");
const decoyOptions = decoySelector.querySelector(".decoy-options");

const backendSelector = document.querySelector(".backend-selector");
const backendSelected = backendSelector.querySelector(".backend-selected");
const backendOptions = backendSelector.querySelector(".backend-options");

const themeSelector = document.querySelector(".theme-selector");
const themeSelected = themeSelector.querySelector(".theme-selected");
const themeOptions = themeSelector.querySelector(".theme-options");

const storeSelector = document.querySelector(".store-selector");
const storeSelected = storeSelector.querySelector(".store-selected");
const storeOptions = storeSelector.querySelector(".store-options");

/**
 * The disguise list lives in assets/js/cloak.js: it pairs a profile with the page
 * that is rendered inside an about:blank window, and the panic page uses the same
 * profiles. This file only renders it.
 */
const decoyProfiles =
  typeof GraipCloak !== "undefined" && GraipCloak.PROFILES
    ? GraipCloak.PROFILES
    : { None: { title: "graip", icon: "/assets/img/fav.png?v=12", page: "none" } };

const decoyPresets = {};
for (const [name, preset] of Object.entries(decoyProfiles)) {
  decoyPresets[name] = { title: preset.title, icon: preset.icon };
}


function closeAllSelectors() {
  document
    .querySelectorAll(
      ".backend-show, .transport-show, .search-engine-show, .decoy-show, .cloak-link-show, .wisp-show, .theme-show, .store-show"
    )
    .forEach((el) =>
      el.classList.remove(
        "backend-show",
        "transport-show",
        "search-engine-show",
        "decoy-show",
        "cloak-link-show",
        "wisp-show",
        "theme-show",
        "store-show"
      )
    );
  document
    .querySelectorAll(
      ".backend-arrow-active, .transport-arrow-active, .search-engine-arrow-active, .decoy-arrow-active, .cloak-link-arrow-active, .wisp-arrow-active, .theme-arrow-active, .store-arrow-active"
    )
    .forEach((el) =>
      el.classList.remove(
        "backend-arrow-active",
        "transport-arrow-active",
        "search-engine-arrow-active",
        "decoy-arrow-active",
        "cloak-link-arrow-active",
        "wisp-arrow-active",
        "theme-arrow-active",
        "store-arrow-active"
      )
    );
  document.querySelectorAll(".wisp-selected[aria-expanded='true']").forEach((el) => {
    el.setAttribute("aria-expanded", "false");
  });
}

const allBackendOptions = ["Ultraviolet", "Scramjet"];
const allTransportOptions = ["Epoxy", "Libcurl"];
const allSearchEngineOptions = [
  "DuckDuckGo",
  "Brave",
  "Qwant",
  "Google",
  "Bing",
  "Startpage",
];
const allDecoyOptions = Object.keys(decoyPresets);

const wispPresets = GraipWisp.PRESETS;
// Every known endpoint is selectable. The old build exposed a hardcoded
// five-name allowlist, so picking anything else (for example the RHW endpoint
// that previous versions defaulted to) was impossible from the UI even though
// the failover pool already used it.
function wispPresetList() {
  const local = typeof GraipWisp.localPreset === "function" ? GraipWisp.localPreset() : null;
  const seen = new Set();
  return [local, ...wispPresets].filter((preset) => {
    if (!preset || seen.has(preset.url)) return false;
    seen.add(preset.url);
    return true;
  });
}

const wispSelectablePresets = wispPresetList();
const customWispOption = "Custom server…";
const wispSelector = document.querySelector(".wisp-selector");
const wispSelected = wispSelector.querySelector(".wisp-selected");
const wispOptions = wispSelector.querySelector(".wisp-options");
const wispCustomSettings = document.querySelector(".wisp-custom-settings");
const wispInput = document.querySelector(".wispInput");

/**
 * The preset the user picked. This is the *preference*, not whatever endpoint
 * failover happened to use, so the dropdown never silently shows a different
 * server than the one saved.
 */
function selectedWispPreset() {
  const selectedId = localStorage.getItem(GraipWisp.KEYS.preset);
  if (selectedId === "Custom") return null;

  const selected = wispSelectablePresets.find((preset) => preset.id === selectedId);
  if (selected) return selected;

  const configured = GraipWisp.normalizeWispUrl(GraipWisp.getConfiguredUrl());
  return wispSelectablePresets.find((preset) => preset.url === configured) || null;
}

function availableWispPresets() {
  return wispSelectablePresets;
}

function updateWispSelector() {
  const preset = selectedWispPreset();
  const activeUrl = GraipWisp.normalizeWispUrl(GraipWisp.getConfiguredUrl());
  const customUrl = GraipWisp.normalizeWispUrl(
    localStorage.getItem(GraipWisp.KEYS.custom)
  );
  const selection = localStorage.getItem(GraipWisp.KEYS.preset);
  const isCustom = selection === "Custom" && activeUrl === customUrl;
  const fallbackUrl =
    typeof GraipWisp.getFallbackUrl === "function" ? GraipWisp.getFallbackUrl() : null;
  const fallbackPreset = fallbackUrl
    ? wispSelectablePresets.find((entry) => entry.url === fallbackUrl)
    : null;
  const chosenLabel = preset
    ? preset.name
    : isCustom
      ? customWispOption
      : wispPresets[0].name;

  // Keep showing the saved choice, and append where traffic is going while an
  // automatic fallback is active. Hiding the choice behind a generic
  // "Automatic fallback" label made it look like the setting had been lost.
  const label = fallbackUrl
    ? `${chosenLabel} → ${fallbackPreset ? fallbackPreset.name : fallbackUrl}`
    : chosenLabel;

  wispSelected.textContent = label;
  wispSelected.setAttribute("aria-expanded", "false");
  wispCustomSettings.style.display = chosenLabel === customWispOption ? "block" : "none";
  if (wispInput) {
    wispInput.value = localStorage.getItem(GraipWisp.KEYS.custom) || "";
  }
  if (typeof setCurrentWispServer === "function") {
    setCurrentWispServer(activeUrl);
  }
}

function selectWisp(option) {
  if (option === customWispOption) {
    const customUrl = localStorage.getItem(GraipWisp.KEYS.custom);
    wispSelected.textContent = customWispOption;
    wispCustomSettings.style.display = "block";
    if (wispInput) wispInput.value = customUrl || "";
    if (customUrl) {
      const url = GraipWisp.setActiveServer(customUrl, { custom: true });
      if (url) {
        GraipWisp.resetCache();
        updateWispSelector();
        setWispStatus("Selected; reload Graip to use this route");
      }
    } else {
      setWispStatus("Enter a custom server URL, then select Set");
    }
    return;
  }

  const preset = wispSelectablePresets.find((entry) => entry.name === option);
  if (!preset) return;

  const url = GraipWisp.setActiveServer(preset.url);
  if (!url) return;
  // setActiveServer already saves preset ids it recognizes; this also covers
  // the deployment-local /wisp/ endpoint.
  localStorage.setItem(GraipWisp.KEYS.preset, preset.id);
  GraipWisp.resetCache();
  updateWispSelector();
  setWispStatus("Selected; reload Graip to use this route");
}

wispSelected.addEventListener("click", (event) => {
  event.stopPropagation();
  const wasOpen = wispOptions.classList.contains("wisp-show");
  closeAllSelectors();
  if (wasOpen) return;

  wispOptions.innerHTML = "";
  // filter against the saved choice, not the composed label (which may carry a
  // "→ fallback" suffix)
  const chosen = selectedWispPreset();
  const chosenName = chosen ? chosen.name : customWispOption;
  [...availableWispPresets().map((preset) => preset.name), customWispOption]
    .filter((name) => name !== chosenName)
    .forEach((name) => {
      const option = document.createElement("div");
      option.textContent = name;
      option.setAttribute("role", "option");
      option.addEventListener("click", (clickEvent) => {
        clickEvent.stopPropagation();
        closeAllSelectors();
        selectWisp(name);
      });
      wispOptions.appendChild(option);
    });
  wispOptions.classList.add("wisp-show");
  wispSelected.classList.add("wisp-arrow-active");
  wispSelected.setAttribute("aria-expanded", "true");
});

wispSelected.addEventListener("keydown", (event) => {
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    wispSelected.click();
  }
});

updateWispSelector();

const allThemeOptions = [
  "default",
  "void",
  "ocean",
  "forest",
  "ember",
  "dunes",
  "lavendar",
  "midnight",
  "coral",
  "golden",
  "lime",
  "magenta",
  "neon",
  "royal blue",
  "sea",
  "violet",
];

const allStoreOptions = ["Classplay", "GN-Math"];

function createSelector(
  selectorType,
  selectedEl,
  optionsEl,
  allOptions,
  currentVal,
  storageKey,
  eventName,
  successMsg
) {
  selectedEl.textContent = currentVal;

  selectedEl.addEventListener("click", (e) => {
    e.stopPropagation();
    const wasOpen = optionsEl.classList.contains(`${selectorType}-show`);
    closeAllSelectors();

    if (!wasOpen) {
      optionsEl.innerHTML = "";
      allOptions.forEach((optionText) => {
        if (optionText !== selectedEl.textContent) {
          const div = document.createElement("div");
          div.textContent = optionText;
          div.addEventListener("click", function (e) {
            e.stopPropagation();
            const val = this.textContent;
            selectedEl.textContent = val;

            const storageVal =
              storageKey === "backend" || storageKey === "transport"
                ? val.toLowerCase()
                : val;

            appSettings[storageKey] = storageVal;
            localStorage.setItem(storageKey, storageVal);
            closeAllSelectors();
            if (eventName)
              document.dispatchEvent(
                new CustomEvent(eventName, {
                  detail: storageVal,
                })
              );
            if (successMsg) showToast("success", successMsg, "check-circle");
            if (window.GraipLog) {
              window.GraipLog.action("settings", `${selectorType} set to ${storageVal}`);
            }

            if (storageKey === "cloakLink") {
              runMenuCloak();
            }
          });
          optionsEl.appendChild(div);
        }
      });
      optionsEl.classList.add(`${selectorType}-show`);
      selectedEl.classList.add(`${selectorType}-arrow-active`);
    }
  });
}

/**
 * Apply the chosen disguise. cloak.js owns the profiles and the storage keys, so
 * this is a delegate (and still works if cloak.js is missing).
 *
 * @param {string} s profile name
 */
function applyDecoy(s) {
  if (typeof GraipCloak !== "undefined" && GraipCloak.applyCloak) {
    GraipCloak.applyCloak(s);
    return;
  }

  const selected = decoyPresets[s];
  const favicon = document.querySelector("link[rel*='icon']");

  if (s === "None" || !selected) {
    document.title = "graip";
    if (favicon) favicon.href = "/assets/img/fav.png?v=12";
    return;
  }

  document.title = selected.title;
  if (favicon) favicon.href = selected.icon;
}

createSelector(
  "search-engine",
  searchEngineSelected,
  searchEngineOptions,
  allSearchEngineOptions,
  appSettings.searchEngine,
  "graip_searchEngine",
  null,
  "Successfully updated Search Engine!"
);

createSelector(
  "decoy",
  decoySelected,
  decoyOptions,
  allDecoyOptions,
  appSettings.decoy,
  "decoy",
  "decoyUpdated",
  "Successfully updated cloak!"
);

createSelector(
  "backend",
  backendSelected,
  backendOptions,
  allBackendOptions,
  appSettings.backend,
  "graip_backend",
  "backendUpdated",
  "Successfully updated backend!"
);

createSelector(
  "theme",
  themeSelected,
  themeOptions,
  allThemeOptions,
  appSettings.theme,
  "graip_theme",
  "themeUpdated",
  "Theme and fog colors updated."
);

createSelector(
  "store",
  storeSelected,
  storeOptions,
  allStoreOptions,
  appSettings.store,
  "graip_gameStore",
  "storeUpdated",
  "Successfully updated game library!"
);

document.addEventListener("decoyUpdated", (e) => applyDecoy(e.detail));
document.addEventListener("themeUpdated", (e) => {
  const link = document.getElementById("css-theme-link");
  const theme = e.detail ?? "default";

  if (theme !== "default") {
    link.href = `/assets/css/themes/${theme}.css`;
  } else {
    link.href = "/assets/css/colors.css";
  }
});
document.addEventListener("wispUpdated", (e) => {
  selectWisp(e.detail);
});
document.addEventListener("graipWispServerChanged", updateWispSelector);
window.addEventListener("load", () => {
  applyDecoy(localStorage.getItem("decoy") || "None");
});
