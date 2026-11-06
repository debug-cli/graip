/**
 * Shared settings helpers.
 *
 * This file is also loaded by ~96 pages inside stores/ (the vendored game
 * bundles), which have no settings UI at all. Every DOM lookup and every
 * GraipWisp call is therefore optional: an uncaught error here aborted the file
 * and logged on every game page, and it also stopped the cloak/theme code below
 * from running.
 */
const sections = document.querySelectorAll(".settings-section");
const buttons = document.querySelectorAll(".settings-side button");
const wispServers = document.querySelectorAll(".wisp-servers button")
const currentWisp = document.getElementById("currentWisp");
const savedWisp = (typeof GraipWisp !== "undefined" && GraipWisp.getConfiguredUrl)
    ? GraipWisp.getConfiguredUrl()
    : (localStorage.getItem("graip_wispUrl") ?? "wss://wisp.mercurywork.shop/"); // matches wisp.js PRESETS[0]
const savedCloak = localStorage.getItem("graip_cloak") ?? "";
const savedCloakIcon = localStorage.getItem("graip_cloakIcon") ?? "";
const savedCloakTitle = localStorage.getItem("graip_cloakTitle") ?? "";

const tabIcon = document.getElementById("tabIcon");
const tabTitle = document.querySelector('title');

const themeLink = document.getElementById('css-theme-link');
const savedTheme = localStorage.getItem('graip_theme') ?? 'midnight';

function freshenGraipFavicon(href) {
    if (!href) return href;
    try {
        const url = new URL(href, window.location.href);
        if (url.origin === window.location.origin && /^\/assets\/img\/fav\.(png|svg)$/.test(url.pathname)) {
            return "/assets/img/fav.png?v=12";
        }
    } catch (error) { /* leave non-URL cloak icons untouched */ }
    return href;
}

if ((savedCloakIcon || savedCloakTitle) && tabIcon) {
    tabIcon.href = freshenGraipFavicon(savedCloakIcon) || tabIcon.href;
    document.title = savedCloakTitle || document.title;
}

function setTabTitle(v) {
    document.title = v;
    localStorage.setItem("graip_cloakTitle", v);
}

function setTabIcon(v) {
    const href = `https://www.google.com/s2/favicons?domain=${v}&sz=256`;
    if (tabIcon) tabIcon.href = href;
    localStorage.setItem("graip_cloakIcon", href);
}

function applyTheme(t) {
  const href = t !== "default" ? `/assets/css/themes/${t}.css` : `/assets/css/colors.css`;
  if (themeLink) themeLink.href = href;
  localStorage.setItem("graip_theme", t !== "default" ? t : "default");
}

if (currentWisp) currentWisp.textContent = savedWisp;

buttons.forEach((btn) => {
    btn.addEventListener("click", () => {
        buttons.forEach((b) => {
            b.classList.remove("active");
        })
        btn.classList.add("active");
    });
})

wispServers.forEach((btn) => {
  btn.addEventListener("click", () => {
    wispServers.forEach((b) => {
      b.classList.remove("active");
    });
    btn.classList.add("active");
  });
});

function settingsNav(section) {
    sections.forEach((sec) => {
        sec.classList.toggle("active", sec.classList.contains(section));
    });
}

const wispStatusEl = document.getElementById("wispStatus");

function setWispStatus(text) {
    if (wispStatusEl) wispStatusEl.textContent = text;
}

/**
 * Save an endpoint and immediately check that it actually speaks wisp, so a dead
 * server is caught here instead of turning into "error code 7: Could not connect to
 * server" on every request later.
 */
function setWispServer(url, isCustom) {
    if (typeof GraipWisp === "undefined") return;
    const normalized = GraipWisp.setActiveServer(url, { custom: !!isCustom });

    if (!normalized) {
        setWispStatus("Invalid URL");
        if (typeof showToast === "function") {
            showToast("error", "That is not a valid wisp URL.", "triangle-exclamation");
        }
        return;
    }

    if (currentWisp) currentWisp.textContent = normalized;

    const input = document.getElementById("customWisp");
    if (input && input === document.activeElement) input.value = normalized;

    GraipWisp.resetCache();
    setWispStatus("Testing...");

    GraipWisp.probeWispServer(normalized).then((result) => {
        if (result.ok) {
            setWispStatus(`Online (${result.ms}ms)`);
            if (typeof showToast === "function") {
                showToast("success", `Wisp server is online (${result.ms}ms)`, "circle-check");
            }
        } else {
            setWispStatus(`Unreachable (${result.reason})`);
            if (typeof showToast === "function") {
                showToast(
                    "error",
                    "That wisp server did not answer. graip will fall back to the others automatically.",
                    "triangle-exclamation"
                );
            }
        }
    });
}

function setCustomWispServer() {
    const input = document.getElementById("customWisp");
    if (!input || !input.value.trim()) {
        setWispStatus("Enter a URL first");
        return;
    }

    setWispServer(GraipWisp.normalizeWispUrl(input.value) || input.value, true);
}

function testWispServer() {
    if (typeof GraipWisp === "undefined") return;
    const url = GraipWisp.getConfiguredUrl();

    GraipWisp.resetCache();
    setWispStatus("Testing...");

    GraipWisp.probeWispServer(url).then((result) => {
        if (result.ok) {
            setWispStatus(`Online (${result.ms}ms)`);
        } else {
            setWispStatus(`Unreachable (${result.reason})`);
        }
    });
}

// prefill the custom box with whatever was typed in last
(function () {
    const input = document.getElementById("customWisp");
    if (!input || typeof GraipWisp === "undefined") return;
    const custom = localStorage.getItem(GraipWisp.KEYS.custom);
    if (custom) input.value = custom;
})();

function cloakMe(o) {
    if (!tabIcon) return;
    switch (o) {
        case "gclassroom":
            tabIcon.href = "/assets/img/cloaks/gclassroom.png";
            document.title = "Google Classroom";
            localStorage.setItem("graip_cloakIcon", tabIcon.href);
            localStorage.setItem("graip_cloakTitle", document.title);
            break;
        case "gdrive":
            tabIcon.href = "/assets/img/cloaks/gdrive.png";
            document.title = "My Drive - Google Drive";
            localStorage.setItem("graip_cloakIcon", tabIcon.href);
            localStorage.setItem("graip_cloakTitle", document.title);
            break;
        case "google":
            tabIcon.href = "/assets/img/cloaks/google.png";
            document.title = "Google";
            localStorage.setItem("graip_cloakIcon", tabIcon.href);
            localStorage.setItem("graip_cloakTitle", document.title);
            break;
        case "edpuzzle":
            tabIcon.href = "/assets/img/cloaks/edpuzzle.png";
            document.title = "Edpuzzle";
            localStorage.setItem("graip_cloakIcon", tabIcon.href);
            localStorage.setItem("graip_cloakTitle", document.title);
            break;
        case "iready":
            tabIcon.href = "/assets/img/cloaks/iready.png";
            document.title = "i-Ready Login";
            localStorage.setItem("graip_cloakIcon", tabIcon.href);
            localStorage.setItem("graip_cloakTitle", document.title);
            break;
        case "gmail":
            tabIcon.href = "/assets/img/cloaks/gmail.png";
            document.title = "Gmail";
            localStorage.setItem("graip_cloakIcon", tabIcon.href);
            localStorage.setItem("graip_cloakTitle", document.title);
            break;
        case "blooket":
            tabIcon.href = "/assets/img/cloaks/blooket.png";
            document.title = "Blooket - Fun Learning Games for Students";
            localStorage.setItem("graip_cloakIcon", tabIcon.href);
            localStorage.setItem("graip_cloakTitle", document.title);
            break;
        case "kahoot":
            tabIcon.href = "/assets/img/cloaks/kahoot.png";
            document.title = "Kahoot! | Learning Games | Make Learning Awesome!";
            localStorage.setItem("graip_cloakIcon", tabIcon.href);
            localStorage.setItem("graip_cloakTitle", document.title);
            break;
        case "none":
            tabIcon.href = "/assets/img/fav.png?v=12";
            document.title = "graip";
            localStorage.setItem("graip_cloakIcon", tabIcon.href);
            localStorage.setItem("graip_cloakTitle", document.title);
            break;
    }
}