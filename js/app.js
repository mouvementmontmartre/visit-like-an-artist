/* ============================================================
   APP — Mouvement Montmartre
   Navigation par sections affichées/masquées, sans état global
   partagé : chaque écran charge ses données quand on l'ouvre.
   ============================================================ */

"use strict";

/* ---------- Petites aides ---------- */

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

function esc(s) {
  return String(s || "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));
}

/* ============================================================
   MARQUE ET LOCALITÉS (valeurs lues dans config.js)
   ============================================================ */

function localitesActives() { return (CONFIG.localites || []).filter(l => l.actif !== false); }

function currentLocalite() {
  const list = localitesActives();
  let id = null;
  try { id = localStorage.getItem("localite"); } catch (e) {}
  return list.find(l => l.id === id)
      || list.find(l => l.id === CONFIG.localiteParDefaut)
      || list[0] || { id: "", nom: "", carte: CONFIG.carte };
}
function setLocalite(id) {
  try { localStorage.setItem("localite", id); } catch (e) {}
  VISITES_CACHE = null; // recalcul filtré
}
function localiteCarte() { return (currentLocalite().carte) || CONFIG.carte; }

/** Une ligne de Sheet appartient-elle à la localité active ? Colonne "Localité" vide = localité par défaut. */
function inLocalite(row) {
  const norm = s => String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
  const v = norm(row && (row["Localité"] || row["Localite"]));
  const cur = currentLocalite();
  if (!v) return cur.id === CONFIG.localiteParDefaut;
  return v === norm(cur.id) || v === norm(cur.nom);
}

/** Applique le nom de marque aux éléments d'interface et au titre de la page. */
function applyBrand() {
  const m = CONFIG.marque || {};
  if (m.nom) {
    document.title = m.nom;
    $$(".brand-word").forEach(el => { el.textContent = m.nom; });
    const og = document.querySelector('meta[property="og:site_name"]');
    if (og) og.setAttribute("content", m.nom);
  }
  $$("[data-i18n]").forEach(el => {
    const v = t(el.dataset.i18n);
    if (v) el.textContent = v;
  });
}

/** Sélecteur de localité : visible seulement s'il y en a plusieurs. */
function renderLocalitePicker() {
  const el = $("#localite-picker");
  if (!el) return;
  const list = localitesActives();
  if (list.length < 2) { el.innerHTML = ""; return; }
  const cur = currentLocalite();
  el.innerHTML = '<div class="filter-chips">' + list.map(l =>
    '<button class="chip' + (l.id === cur.id ? " active" : "") + '" data-localite="' + esc(l.id) + '">' + esc(l.nom) + '</button>'
  ).join("") + '</div>';
  $$("#localite-picker [data-localite]").forEach(b => b.addEventListener("click", () => {
    setLocalite(b.dataset.localite); applyBrand(); renderAccueil();
  }));
}

/* Convertit lat/lng en position % sur la carte, selon localiteCarte() */
/* ---------- Navigation ---------- */

const TABS = ["accueil", "carte", "agenda"];
let currentTab = "accueil";

function showScreen(id) {
  $$(".screen").forEach(s => s.classList.remove("active"));
  const el = $("#screen-" + id);
  if (el) el.classList.add("active");
  const isTab = TABS.includes(id);
  $("#bottom-nav").style.display = isTab ? "flex" : "none";
  if (isTab) {
    currentTab = id;
    $$(".nav-item").forEach(b => b.classList.toggle("active", b.dataset.tab === id));
  }
  window.scrollTo(0, 0);
  closePointSheet();
}

function goBack() { showScreen(currentTab); }

/* Ouvre un écran nommé (utilisé par les data-open) */
function openTarget(target, arg) {
  if (!CONFIG.festivalActif && /festival/.test(target)) return; // festival masqué
  switch (target) {
    case "festival":        renderFestival(); showScreen("festival"); break;
    case "carte-festival":  renderCarteFestival(); showScreen("carte-festival"); break;
    case "carte-tab":       showScreen("carte"); renderEcoMap(); break;
    case "membre":          showScreen("membre"); break;
    case "infos":           renderInfos(); showScreen("infos"); break;
    case "infos-festival":  renderInfosFestival(); showScreen("infos-festival"); break;
    case "visite":          renderVisite(arg); showScreen("visite"); break;
    case "carte-visite":    renderCarteVisite(arg); showScreen("carte-visite"); break;
  }
}

document.addEventListener("click", (e) => {
  const scroller = e.target.closest("[data-scroll]");
  if (scroller) {
    const el = document.getElementById(scroller.dataset.scroll);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
    return;
  }
  const opener = e.target.closest("[data-open]");
  if (opener) { openTarget(opener.dataset.open, opener.dataset.arg); return; }
  const back = e.target.closest("[data-back]");
  if (back) { goBack(); return; }
  const tab = e.target.closest("[data-tab]");
  if (tab) {
    showScreen(tab.dataset.tab);
    if (tab.dataset.tab === "carte") renderEcoMap();
    if (tab.dataset.tab === "agenda") renderAgenda();
  }
});

/* ---------- Bottom sheet (fiche de point) ---------- */

/** Libellé affichable d'une catégorie (badge de la fiche point). */
function typeLabel(type) {
  const key = "type." + type;
  const label = t(key);
  if (label !== key) return label; // clé trouvée dans le dictionnaire
  return type.charAt(0).toUpperCase() + type.slice(1).replace(/-/g, " ");
}

function openPointSheet(eyebrow, p) {
  $("#ps-eyebrow").textContent = eyebrow || "";
  $("#ps-title").textContent = p.nom || "";
  const tagsBox = $("#ps-tags");
  const types = p.types || (p.type ? [p.type] : []);
  tagsBox.innerHTML = types.length > 1
    ? types.map(ty => '<span class="ps-tag">' + esc(typeLabel(ty)) + '</span>').join("")
    : "";
  $("#ps-desc").textContent = [p.desc, p.adresse ? "📍 " + p.adresse : ""].filter(Boolean).join("\n\n");
  const media = $("#ps-media");
  media.innerHTML = "";
  if (p.media) {
    const img = document.createElement("img");
    img.src = p.media;
    img.alt = "";
    img.loading = "lazy";
    media.appendChild(img);
  }
  const linkBox = $("#ps-link");
  const buttons = [];
  if (p.lien) buttons.push('<a class="cta fee" style="text-decoration:none;" href="' + esc(p.lien) + '" target="_blank" rel="noopener">' + t("cta.seeSite") + '</a>');
  const icons = [];
  if (p.instagram) icons.push('<a class="icon-btn" href="' + esc(p.instagram) + '" target="_blank" rel="noopener" aria-label="Instagram"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="5.5"/><circle cx="12" cy="12" r="4.2"/><circle cx="17.2" cy="6.8" r="1.1" fill="currentColor" stroke="none"/></svg></a>');
  if (p.facebook) icons.push('<a class="icon-btn" href="' + esc(p.facebook) + '" target="_blank" rel="noopener" aria-label="Facebook"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 4.2 H13.2 A3.3 3.3 0 0 0 9.9 7.5 V10.2 H7.8 V13.4 H9.9 V20.5 H13.1 V13.4 H15.4 L15.8 10.2 H13.1 V7.9 C13.1 7 13.4 6.4 14.4 6.4 H15.8 Z"/></svg></a>');
  if (p.email) icons.push('<a class="icon-btn" href="mailto:' + esc(p.email) + '" aria-label="Email"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="5" width="18" height="14" rx="1.5"/><path d="M3 6 L12 13 L21 6"/></svg></a>');
  if (p.telephone) icons.push('<a class="icon-btn" href="tel:' + esc(p.telephone.replace(/[^\d+]/g, "")) + '" aria-label="Téléphone"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M6 3 H9 L11 8 L8.5 9.5 C9.5 12 12 14.5 14.5 15.5 L16 13 L21 15 V18 A2 2 0 0 1 19 20 C11 20 4 13 4 5 A2 2 0 0 1 6 3 Z"/></svg></a>');
  if (icons.length) buttons.push('<div class="icon-row">' + icons.join("") + '</div>');
  linkBox.innerHTML = buttons.join("");
  $("#point-sheet").classList.add("open");
}
function closePointSheet() { $("#point-sheet").classList.remove("open"); clearHighlight(); }
$("#point-sheet-close").addEventListener("click", closePointSheet);

/* ---------- Géolocalisation (point bleu approximatif) ---------- */

function attachGeoloc(buttonEl, mapEl) {
  buttonEl.addEventListener("click", () => {
    if (!navigator.geolocation) {
      buttonEl.textContent = "Géolocalisation non disponible sur cet appareil";
      buttonEl.disabled = true;
      return;
    }
    buttonEl.textContent = "Localisation…";
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude } = pos.coords;
        const c = localiteCarte();
        if (latitude < c.latMin || latitude > c.latMax || longitude < c.lngMin || longitude > c.lngMax) {
          buttonEl.textContent = "Vous êtes hors du quartier affiché";
          return;
        }
        const entry = ensureLeafletMap(mapEl);
        if (!entry) { buttonEl.textContent = t("errors.mapIndispo"); return; }
        if (entry.youMarker) entry.map.removeLayer(entry.youMarker);
        entry.youMarker = L.marker([latitude, longitude], {
          icon: L.divIcon({
            className: "map-pin-leaflet",
            html: '<div class="map-pin you"></div>',
            iconSize: [18, 18], iconAnchor: [9, 9],
          }),
          zIndexOffset: 1000,
          interactive: false,
        }).addTo(entry.map);
        entry.map.panTo([latitude, longitude]);
        buttonEl.textContent = "Position affichée (approximative)";
      },
      () => { buttonEl.textContent = "Position refusée ou indisponible"; },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  });
}

/* ---------- Rendu d'une carte à points (Leaflet + OpenStreetMap) ---------- */

const LEAFLET_MAPS = new WeakMap();

/** Crée (une seule fois par conteneur) ou récupère l'instance Leaflet associée. */
function ensureLeafletMap(mapEl) {
  if (typeof L === "undefined" || !mapEl) return null;
  let entry = LEAFLET_MAPS.get(mapEl);
  if (entry) return entry;

  const map = L.map(mapEl, { zoomControl: true, attributionControl: true, minZoom: 12 });
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    subdomains: "abc",
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors',
  }).addTo(map);
  const markersLayer = L.layerGroup().addTo(map);
  const c = localiteCarte();
  map.fitBounds([[c.latMin, c.lngMin], [c.latMax, c.lngMax]]);

  entry = { map, markersLayer, youMarker: null };
  LEAFLET_MAPS.set(mapEl, entry);
  return entry;
}

let ACTIVE_HIGHLIGHT_ENTRY = null; // entry {markersLayer} dont un marqueur est actuellement grisé/mis en avant

/** Met en avant un marqueur : au premier plan, agrandi avec un anneau (classe pin-selected).
    Pas d'effet d'opacité sur les autres pins (règle du design de la carte). */
function highlightMarker(entry, marker) {
  clearHighlight();
  marker.setZIndexOffset(1000);
  const el = marker.getElement();
  if (el) el.classList.add("pin-selected");
  ACTIVE_HIGHLIGHT_ENTRY = entry;
}
/** Réaffiche tous les marqueurs du calque actuellement grisé (fermeture de la fiche). */
function clearHighlight() {
  if (!ACTIVE_HIGHLIGHT_ENTRY) return;
  ACTIVE_HIGHLIGHT_ENTRY.markersLayer.eachLayer(m => {
    m.setZIndexOffset(0);
    const el = m.getElement();
    if (el) el.classList.remove("pin-selected");
  });
  ACTIVE_HIGHLIGHT_ENTRY = null;
}

/** Découpe une colonne Type "concert, bar, restaurant" en tableau ["concert","bar","restaurant"].
    types[0] reste la catégorie "principale" (icône affichée sur la carte). */
function parseTypes(raw) {
  const list = String(raw || "info").split(",").map(s => s.trim().toLowerCase()).filter(Boolean);
  return list.length ? list : ["info"];
}

function mapPinDivIcon(type, num) {
  /* Étape numérotée : toujours crème (famille "reperes"), comme dans le design. */
  const color = (num != null) ? "reperes" : (PIN_COLORS[type] || "reperes");
  const inner = (num != null)
    ? '<span class="pin-num">' + esc(String(num)) + '</span>'
    : (PIN_ICONS[type] || PIN_ICONS["info"]);
  return L.divIcon({
    className: "map-pin-leaflet",
    html: '<div class="map-pin ' + color + '">' + inner + '</div>',
    iconSize: [30, 30],
    iconAnchor: [15, 15],
  });
}

/**
 * points : [{ nom, lat, lng, type, desc, media, num? , onTap? }]
 * onTap facultatif : remplace l'ouverture de la fiche par une action.
 */
function renderMap(mapEl, points, eyebrowLabel) {
  const entry = ensureLeafletMap(mapEl);
  if (!entry) {
    mapEl.innerHTML = '<div class="load-error" style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;">' + t("errors.mapIndispo") + '</div>';
    return;
  }
  const { map, markersLayer } = entry;
  markersLayer.clearLayers();

  const bounds = [];
  points.forEach((p) => {
    const lat = parseFloat(p.lat), lng = parseFloat(p.lng);
    if (!isFinite(lat) || !isFinite(lng)) return; // ligne incomplète : on ignore
    bounds.push([lat, lng]);
    const marker = L.marker([lat, lng], { icon: mapPinDivIcon(p.type, p.num) });
    marker._pointData = p;
    marker.on("click", () => {
      if (p.onTap) { p.onTap(); return; }
      highlightMarker(entry, marker);
      openPointSheet(eyebrowLabel, p);
    });
    markersLayer.addLayer(marker);
  });

  if (bounds.length) {
    map.fitBounds(bounds, { padding: [26, 26], maxZoom: 17 });
    // Avec beaucoup de points étalés, le cadrage automatique peut trop dézoomer
    // et rendre les noms de rues illisibles : on impose un zoom minimum confortable.
    if (map.getZoom() < 15) map.setZoom(15);
  } else {
    const c = localiteCarte();
    map.fitBounds([[c.latMin, c.lngMin], [c.latMax, c.lngMax]]);
    if (map.getZoom() < 15) map.setZoom(15);
  }
  // Le conteneur peut avoir été masqué (autre onglet actif) lors de l'init : on force le recalcul de taille.
  setTimeout(() => map.invalidateSize(), 60);
}
/* Pins de la carte : 29 icônes pleines (design « Pins système », planches E26 à E29).
   Pastille ronde de 30 px, glyphe plein de 19 px en noir chaud, trois familles de couleur
   (voir .map-pin.culture / .sortir / .reperes dans style.css). La clé est la valeur de la
   colonne Type des Sheets ; un type inconnu retombe sur "info". */
const PIN_ICONS = {
  "info": '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9.5" fill="#14100E"/><rect x="10.8" y="10.4" width="2.4" height="6.4" rx="1.2" fill="#EFE8D8"/><circle cx="12" cy="7.5" r="1.5" fill="#EFE8D8"/></svg>',
  "depart": '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="#14100E" d="M5.2 3h2v18h-2z"/><path fill="#14100E" d="M7.2 4.2h11.6l-3.2 4.3 3.2 4.3H7.2z"/></svg>',
  "arrivee": '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5.2" y="3" width="2" height="18" fill="#14100E"/><rect x="7.2" y="4" width="12.4" height="9" fill="#14100E"/><rect x="7.20" y="4" width="2.48" height="3" fill="#EFE8D8"/><rect x="7.20" y="10" width="2.48" height="3" fill="#EFE8D8"/><rect x="9.68" y="7" width="2.48" height="3" fill="#EFE8D8"/><rect x="12.16" y="4" width="2.48" height="3" fill="#EFE8D8"/><rect x="12.16" y="10" width="2.48" height="3" fill="#EFE8D8"/><rect x="14.64" y="7" width="2.48" height="3" fill="#EFE8D8"/><rect x="17.12" y="4" width="2.48" height="3" fill="#EFE8D8"/><rect x="17.12" y="10" width="2.48" height="3" fill="#EFE8D8"/></svg>',
  "musee": '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="#14100E" d="M12 2.6 2.4 8.4v1.9h19.2V8.4z"/><rect x="4.4" y="11.6" width="2.8" height="6.6" fill="#14100E"/><rect x="8.8" y="11.6" width="2.8" height="6.6" fill="#14100E"/><rect x="12.4" y="11.6" width="2.8" height="6.6" fill="#14100E"/><rect x="16.8" y="11.6" width="2.8" height="6.6" fill="#14100E"/><rect x="2.4" y="19.2" width="19.2" height="2.2" rx=".6" fill="#14100E"/></svg>',
  "espace-art": '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5.4" y="3.2" width="13.2" height="9.6" rx="1.2" fill="#14100E"/><path d="M8.2 10.6c1.4-3 2.8-3 4-1.2s2.2 1 3.4-1.4" stroke="#EFE8D8" stroke-width="1.6" fill="none" stroke-linecap="round"/><path d="M8.6 13.6 6 21M15.4 13.6 18 21M12 13.6V21" stroke="#14100E" stroke-width="1.9" stroke-linecap="round"/></svg>',
  "boutique": '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="#14100E" d="M4.2 4.4h15.6l1.3 5a2.7 2.7 0 0 1-5.3 1 2.7 2.7 0 0 1-4.6 0 2.7 2.7 0 0 1-4.6 0 2.7 2.7 0 0 1-5.3-1z"/><path fill="#14100E" d="M5.4 12.4h13.2V20.6H5.4z"/><rect x="10" y="15.4" width="4" height="5.2" fill="#EFE8D8"/></svg>',
  "toilettes": '<svg viewBox="0 0 24 24" aria-hidden="true"><g fill="#14100E"><circle cx="6.5" cy="3.6" r="1.8"/><rect x="4.9" y="5.6" width="3.2" height="5.6" rx="1.6"/><rect x="4.9" y="11" width="1.5" height="8.5" rx=".75"/><rect x="7" y="11" width="1.5" height="8.5" rx=".75"/><circle cx="17.5" cy="3.6" r="1.8"/><path d="M16.1 5.6h2.8l2.4 8.3c0 .4-.3.7-.7.7h-6.2c-.4 0-.7-.3-.7-.7z"/><rect x="16" y="14" width="1.4" height="5.5" rx=".7"/><rect x="18.1" y="14" width="1.4" height="5.5" rx=".7"/></g></svg>',
  "metro": '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9.5" fill="#14100E"/><path d="M8 16.4V8l4 4.4L16 8v8.4" stroke="#EFE8D8" stroke-width="2.2" fill="none" stroke-linejoin="round" stroke-linecap="round"/></svg>',
  "librairie": '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="#14100E" d="M12 6C10.4 4.6 7.4 4.2 4.2 4.8v13.8c3.2-.6 6.2-.1 7.8 1.2 1.6-1.3 4.6-1.8 7.8-1.2V4.8C16.6 4.2 13.6 4.6 12 6z"/><path d="M12 6.4v13" stroke="#EFE8D8" stroke-width="1.5"/></svg>',
  "ecole": '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="#14100E" d="M1.8 8.6 12 3.4l10.2 5.2L12 13.8z"/><path fill="#14100E" d="M5.6 11.8v4.6c0 2 3 3.6 6.4 3.6s6.4-1.6 6.4-3.6v-4.6L12 15.1z"/><rect x="20.4" y="9.4" width="1.7" height="6.4" rx=".85" fill="#14100E"/></svg>',
  "presse": '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.2" y="4.8" width="14.6" height="14.8" rx="1.4" fill="#14100E"/><path d="M17.8 8.6h3.2v8.8a2.2 2.2 0 0 1-2.2 2.2h-1z" fill="#14100E"/><path d="M6.4 8.6h8.2M6.4 11.8h8.2M6.4 15h5" stroke="#EFE8D8" stroke-width="1.6" stroke-linecap="round"/></svg>',
  "vue": '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="#14100E" d="M1.8 12c3.2-5.8 6.8-7.8 10.2-7.8s7 2 10.2 7.8c-3.2 5.8-6.8 7.8-10.2 7.8S5 17.8 1.8 12z"/><circle cx="12" cy="12" r="4" fill="#EFE8D8"/><circle cx="12" cy="12" r="2" fill="#14100E"/></svg>',
  "atelier-artiste": '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="#14100E" d="M12 3C6.8 3 2.8 6.9 2.8 11.8c0 3.3 2.4 4.4 4.3 3.9 1-.3 1.8.6 1.2 1.5-.7 1.1-.1 2.5 1.6 2.7 5.8.6 11.3-3 11.3-8.4C21.2 6.5 17.2 3 12 3z"/><circle cx="7.6" cy="10" r="1.4" fill="#D9B96A"/><circle cx="11.6" cy="7.4" r="1.4" fill="#D9B96A"/><circle cx="16.2" cy="9.4" r="1.4" fill="#D9B96A"/></svg>',
  "espace-membre": '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="#14100E" d="M12 3.2 2.6 11.2h2.9V20.5h5v-5.6h3v5.6h5V11.2h2.9z"/></svg>',
  "cinema": '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.4" y="10.2" width="17.2" height="10.4" rx="1.6" fill="#14100E"/><path fill="#14100E" d="M3.5 8.8 4.5 4.3l15.4 3.2-.8 3.6z"/><path d="M8.6 5.2 7.7 9.6M12.8 6.1l-.9 4.3M17 7l-.9 4.3" stroke="#D9B96A" stroke-width="1.5" fill="none"/></svg>',
  "concert": '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="#14100E" d="M8.6 4.4l11-1.9v12.7a3.4 3.4 0 1 1-2-3.1V6l-7 1.2v10.4a3.4 3.4 0 1 1-2-3.1z"/></svg>',
  "exposition": '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.2" y="4.2" width="17.6" height="14" rx="1.8" fill="#14100E"/><circle cx="8.6" cy="9" r="1.6" fill="#D9B96A"/><path fill="#D9B96A" d="M5.2 16.2l4-4.2 3.4 3.2 2.8-2.4 3.4 3.4z"/><rect x="8" y="19.6" width="8" height="1.8" rx=".9" fill="#14100E"/></svg>',
  "galerie": '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="2.8" y="4.8" width="11.4" height="12.4" rx="1.6" fill="#14100E"/><circle cx="6.6" cy="9.2" r="1.4" fill="#D9B96A"/><path fill="#D9B96A" d="M4 15.4l3.4-3.6 2.8 2.7 1.5-1.4 1.6 2.3z"/><rect x="15.8" y="8.2" width="5.4" height="8.8" rx="1.3" fill="#14100E"/><rect x="2.8" y="19.2" width="18.4" height="1.8" rx=".9" fill="#14100E"/></svg>',
  "studio": '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="8.8" y="2.8" width="6.4" height="11.4" rx="3.2" fill="#14100E"/><path d="M5.8 11.2a6.2 6.2 0 0 0 12.4 0" stroke="#14100E" stroke-width="2" fill="none" stroke-linecap="round"/><path d="M12 17.6V21M8.8 21h6.4" stroke="#14100E" stroke-width="2" stroke-linecap="round"/></svg>',
  "theatre": '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="#14100E" d="M4.6 4.4c2.7 1.2 12.1 1.2 14.8 0V12c0 5-3.6 8.6-7.4 8.6S4.6 17 4.6 12z"/><circle cx="9" cy="10" r="1.3" fill="#D9B96A"/><circle cx="15" cy="10" r="1.3" fill="#D9B96A"/><path d="M8.2 14.2c1 2.2 6.6 2.2 7.6 0" stroke="#D9B96A" stroke-width="1.8" fill="none" stroke-linecap="round"/></svg>',
  "disquaire": '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9.5" fill="#14100E"/><circle cx="12" cy="12" r="6" fill="none" stroke="#D9B96A" stroke-width=".9"/><circle cx="12" cy="12" r="3" fill="#D9B96A"/><circle cx="12" cy="12" r=".9" fill="#14100E"/></svg>',
  "createur": '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="6.8" cy="6.4" r="3" fill="#14100E"/><circle cx="6.8" cy="6.4" r="1.2" fill="#D9B96A"/><circle cx="6.8" cy="17.6" r="3" fill="#14100E"/><circle cx="6.8" cy="17.6" r="1.2" fill="#D9B96A"/><path d="M9 8l11.4 10.4M9 16 20.4 5.6" stroke="#14100E" stroke-width="2.4" stroke-linecap="round"/></svg>',
  "media": '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="#14100E" d="M3.3 8a2.2 2.2 0 0 1 2.2-2.2h2l1.3-2h6.4l1.3 2h2A2.2 2.2 0 0 1 20.7 8v10a2.2 2.2 0 0 1-2.2 2.2h-13A2.2 2.2 0 0 1 3.3 18z"/><circle cx="12" cy="12.9" r="4" fill="#C98A5A"/><circle cx="12" cy="12.9" r="2.2" fill="#14100E"/></svg>',
  "ar": '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="#14100E" d="M12 2.4l8.6 5v9.2l-8.6 5-8.6-5V7.4z"/><path d="M12 12v9.4M12 12l8.3-4.8M12 12 3.7 7.2" stroke="#C98A5A" stroke-width="1.6" fill="none" stroke-linecap="round"/></svg>',
  "bar": '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="#14100E" d="M3.2 3.8h17.6L13 13.4V19h4.3v2.2H6.7V19H11v-5.6z"/><circle cx="17.6" cy="5.8" r="0" fill="#C98A5A"/></svg>',
  "cafe": '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="#14100E" d="M3.8 8.2h12.6v6.3a4.6 4.6 0 0 1-4.6 4.6H8.4a4.6 4.6 0 0 1-4.6-4.6z"/><path d="M16.4 9.6h1.3a2.6 2.6 0 0 1 0 5.2h-1.3" stroke="#14100E" stroke-width="2" fill="none"/><path d="M7.6 3.2c-.9.9-.9 1.9 0 2.8M11.6 3.2c-.9.9-.9 1.9 0 2.8" stroke="#14100E" stroke-width="1.7" fill="none" stroke-linecap="round"/><rect x="5" y="20" width="10" height="1.6" rx=".8" fill="#14100E"/></svg>',
  "restaurant": '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="#14100E" d="M4.8 3h1.6v5.4h.8V3h1.6v5.4h.8V3h1.6v6.1a3.2 3.2 0 0 1-2.5 3.1V21H7.3v-8.8a3.2 3.2 0 0 1-2.5-3.1z"/><path fill="#14100E" d="M17.6 3c-2.3 1.6-3 5-2.6 8 .2 1.5 1.3 2.1 2.6 2.1V21h1.8V3z"/></svg>',
  "cabaret": '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="#14100E" d="M7.2 3.4h9.6l-.9 9.4H8.1z"/><rect x="3" y="12.4" width="18" height="3.6" rx="1.8" fill="#14100E"/><rect x="7.7" y="9.2" width="8.6" height="1.9" fill="#C98A5A"/></svg>',
  "standup": '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9.5" fill="#14100E"/><circle cx="8.9" cy="10" r="1.3" fill="#C98A5A"/><circle cx="15.1" cy="10" r="1.3" fill="#C98A5A"/><path fill="#C98A5A" d="M7.2 13.2h9.6c0 3-2.2 5-4.8 5s-4.8-2-4.8-5z"/></svg>',
};
/* Famille de couleur de chaque pin : culture et création (laiton), sortir (terracotta), repères (crème). */
const PIN_COLORS = {
  "info": "reperes",
  "depart": "reperes",
  "arrivee": "reperes",
  "musee": "reperes",
  "espace-art": "reperes",
  "boutique": "reperes",
  "toilettes": "reperes",
  "metro": "reperes",
  "librairie": "reperes",
  "ecole": "reperes",
  "presse": "reperes",
  "vue": "reperes",
  "atelier-artiste": "culture",
  "espace-membre": "culture",
  "cinema": "culture",
  "concert": "culture",
  "exposition": "culture",
  "galerie": "culture",
  "studio": "culture",
  "theatre": "culture",
  "disquaire": "culture",
  "createur": "culture",
  "media": "sortir",
  "ar": "sortir",
  "bar": "sortir",
  "cafe": "sortir",
  "restaurant": "sortir",
  "cabaret": "sortir",
  "standup": "sortir",
};

/* ============================================================
   ACCUEIL
   ============================================================ */

let VISITES_CACHE = null;

async function loadVisites() {
  if (VISITES_CACHE) return VISITES_CACHE;
  const rows = await loadCSV(CONFIG.sources.visites, "visites");
  VISITES_CACHE = rows.filter(v => (v["Actif"] || "").toLowerCase() === "oui" && v["id"] && inLocalite(v));
  return VISITES_CACHE;
}

/** Bannières locales par visite (secours si la colonne "Photo" du Sheet est vide).
    Ajouter une entrée ici pour toute nouvelle visite avec une image dédiée. */
const VISITE_BANNIERES_LOCALES = [
  { match: /jazzical/i, src: "icons/banniere-jazzical.jpg" },
  { match: /dames/i, src: "icons/banniere-dames.jpg" },
];
function visiteBannerSrc(v) {
  if (v["Photo"]) return v["Photo"];
  const nom = (v["Nom"] || "") + " " + (v["id"] || "");
  const found = VISITE_BANNIERES_LOCALES.find(b => b.match.test(nom));
  return found ? found.src : "";
}

/** Bandeaux sponsors (image + nom en overlay, cliquable) : rendus depuis
    CONFIG.sponsors, identiques sur Accueil et Festival. targetId : id du conteneur. */
function renderSponsors(targetId) {
  const el = $("#" + targetId);
  if (!el) return;
  const sponsors = CONFIG.sponsors || [];
  if (sponsors.length === 0) { el.innerHTML = ""; return; }
  el.innerHTML = sponsors.map(s =>
    '<a class="bandeau bandeau-sponsor" href="' + esc(s.lien) + '" target="_blank" rel="noopener sponsored">' +
      '<img class="media-photo" src="' + esc(s.logo) + '" alt="' + esc(s.nom) + '" loading="lazy">' +
      '<div class="scrim"></div>' +
      '<div class="content"><div class="e-name">' + esc(s.nom) + '</div></div>' +
    '</a>'
  ).join("");
}

/** Type d'expérience d'une ligne du Sheet Visites (colonne optionnelle "Type") :
    "visite" (par défaut), "atelier", "escape" ou "diner" (soirée partenaire). */
function offreTypeOf(v) {
  const k = String((v && v["Type"]) || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  return /atelier|workshop|taller/.test(k) ? "atelier"
    : /escape/.test(k) ? "escape"
    : /diner|dinner|cena|soiree|partenaire/.test(k) ? "diner"
    : "visite";
}
/** Badge de type affiché sur les cartes : pastille teintée (couleur du type) avec icône et libellé. */
const BADGE_ICONS = {
  visite: '<path d="M12 21s7-6.2 7-11a7 7 0 1 0-14 0c0 4.8 7 11 7 11z"/><circle cx="12" cy="10" r="2.5"/>',
  atelier: '<path d="M12 3a9 9 0 1 0 0 18c1.5 0 2-1 1.5-2-.5-1 0-2.5 1.5-2.5h2.5a3 3 0 0 0 3-3C20.5 7 16.5 3 12 3z"/><circle cx="7.5" cy="11" r="1"/><circle cx="10" cy="7.5" r="1"/><circle cx="14.5" cy="7.5" r="1"/>',
  escape: '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
  diner: '<path d="M12 3l2.6 5.6 6.1.7-4.5 4.2 1.2 6L12 16.5 6.6 19.5l1.2-6L3.3 9.3l6.1-.7z"/>',
};
function offreBadgeHtml(type) {
  const key = type === "diner" ? "soiree" : type;
  return '<span class="type-badge t-' + type + '">' +
    '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
    (BADGE_ICONS[type] || BADGE_ICONS.visite) + '</svg>' + esc(t("badge." + key)) + '</span>';
}

let offreActive = "visite";

async function renderAccueil() {
  if (!CONFIG.festivalActif) {
    const hero = document.querySelector("#hero-festival");
    if (hero) hero.remove();
  }
  if ($("#hero-eyebrow")) $("#hero-eyebrow").textContent = trField(CONFIG.edition, "titre");
  if ($("#hero-dates")) $("#hero-dates").textContent = CONFIG.edition.datesAffichees;
  if ($("#hero-theme")) $("#hero-theme").textContent = trField(CONFIG.edition, "theme");
  if (CONFIG.edition.accent) {
    document.documentElement.style.setProperty("--accent-edition", CONFIG.edition.accent);
  }
  renderSponsors("sponsors-list");
  renderLocalitePicker();

  /* Bloc d'accroche de la localité (texte venant de CONFIG.localites) */
  const loc = currentLocalite() || {};
  const lang = getLang();
  if ($("#hero-loc")) $("#hero-loc").textContent = [loc.nom, loc.precision].filter(Boolean).join(", ");
  if ($("#hero-h1")) {
    const acc = (loc.accroche && (loc.accroche[lang] || loc.accroche.fr)) || [t("hero.title")];
    $("#hero-h1").innerHTML = esc(acc[0] || "") + (acc[1] ? " <em>" + esc(acc[1]) + "</em>" : "");
  }

  const list = $("#visites-list");
  const visites = await loadVisites();
  if (visites.length === 0) {
    list.innerHTML = '<div class="load-error">' + t("errors.visitesIndispo") + '</div>';
    return;
  }
  const card = (v) => {
    const bannerSrc = visiteBannerSrc(v);
    const guide = trField(v, "Guide");
    const prix = v["Tarif direct"] || "";
    const nom = trField(v, "Nom");
    const desc = trField(v, "Description");
    const badge = offreBadgeHtml(offreTypeOf(v));
    const corps =
      '<div class="act-name">' + esc(nom) + '</div>' +
      (desc ? '<div class="act-desc">' + esc(desc) + '</div>' : '') +
      (guide ? '<div class="act-by">' + esc(t("card.with")) + ' <b>' + esc(guide) + '</b></div>' : '') +
      (v["Durée"] ? '<div class="act-meta">' + esc(v["Durée"]) + '</div>' : '');
    if (!bannerSrc) {
      /* Sans visuel (ex. parcours autoguidé) : carte sobre à contour */
      return (
        '<button class="act-card act-card-plain" data-open="visite" data-arg="' + esc(v["id"]) + '">' +
          '<div class="act-body">' + badge + corps + '</div>' +
          (prix ? '<span class="act-price act-price-soft">' + esc(prix) + '</span>' : '') +
        '</button>'
      );
    }
    return (
      '<button class="act-card" data-open="visite" data-arg="' + esc(v["id"]) + '">' +
        '<div class="act-media"><img class="act-thumb" src="' + esc(bannerSrc) + '" alt="" loading="lazy">' + badge + '</div>' +
        '<div class="act-body">' + corps +
          (prix ? '<div class="act-foot"><span class="act-price">' + esc(prix) + '</span></div>' : '') +
        '</div>' +
      '</button>'
    );
  };
  /* Catégories : visites (guidées + autoguidées), ateliers, escape game, soirées partenaires.
     La colonne optionnelle "Type" du Sheet les distingue ; vide = visite (voir offreTypeOf). */
  const typeOf = offreTypeOf;
  const cats = [
    { k: "visite", label: t("chip.visites"), always: true },
    { k: "atelier", label: t("chip.ateliers"), always: true },
    { k: "escape", label: t("chip.escape"), always: true },
    { k: "diner", label: t("chip.soirees"), always: false }, // visible seulement s'il y en a de programmées
  ].filter(c => c.always || visites.some(v => typeOf(v) === c.k));
  if (!cats.some(c => c.k === offreActive)) offreActive = "visite";

  const paint = () => {
    $("#offre-chips").innerHTML = cats.map(c =>
      '<button class="chip' + (c.k === offreActive ? ' active' : '') + '" role="tab" data-offre="' + c.k + '">' + esc(c.label) + '</button>'
    ).join("");
    $$("#offre-chips .chip").forEach(ch => ch.addEventListener("click", () => { offreActive = ch.dataset.offre; paint(); }));
    const items = visites.filter(v => typeOf(v) === offreActive);
    list.innerHTML = items.length
      ? items.map(card).join("")
      : '<div class="act-empty">' + t("empty.bientot") + '</div>';
  };
  paint();
}

/* ============================================================
   ÉCRAN FESTIVAL (programme)
   ============================================================ */

let festivalDay = null; // date "AAAA-MM-JJ" du jour sélectionné, calculée au premier rendu
let festivalMode = "complet";
let PROGRAMME_CACHE = null;

function getFavs() {
  try { return JSON.parse(localStorage.getItem("favs") || "[]"); }
  catch (e) { return []; }
}
function toggleFav(key) {
  const favs = getFavs();
  const i = favs.indexOf(key);
  if (i >= 0) favs.splice(i, 1); else favs.push(key);
  localStorage.setItem("favs", JSON.stringify(favs));
}

/** Génère les jours du festival (dates + libellé "VEN 25") à partir de config.js, jamais codés en dur. */
function festivalDates() {
  const start = parseFRDate(CONFIG.edition.dateDebut);
  const end = parseFRDate(CONFIG.edition.dateFin);
  if (!start || !end) return [];
  const joursFR = ["DIM", "LUN", "MAR", "MER", "JEU", "VEN", "SAM"];
  const out = [];
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    out.push({ key: dateKey(d), label: joursFR[d.getDay()] + " " + d.getDate() });
  }
  return out;
}

async function loadProgramme() {
  if (PROGRAMME_CACHE) return PROGRAMME_CACHE;
  if (!CONFIG.sources.programmeFestival) { PROGRAMME_CACHE = []; return PROGRAMME_CACHE; }
  const rows = await loadCSV(CONFIG.sources.programmeFestival, "programme-festival");
  PROGRAMME_CACHE = rows
    .filter(r => r["Titre"] && parseFRDate(r["Date"]))
    .map(r => ({
      dateKey: dateKey(parseFRDate(r["Date"])),
      heure: fmtHeure(r["Heure début"]),
      heureFin: fmtHeure(r["Heure fin"]),
      titre: trField(r, "Titre"), titreFr: r["Titre"], lieu: trField(r, "Lieu") || "", desc: trField(r, "Description") || "",
    }))
    .sort((a, b) => a.heure.localeCompare(b.heure));
  return PROGRAMME_CACHE;
}

async function renderFestival() {
  $("#festival-sub").textContent = CONFIG.edition.datesAffichees;
  renderSponsors("sponsors-festival");

  const jours = festivalDates();
  if (!festivalDay && jours.length) festivalDay = jours[0].key;

  $("#festival-days").innerHTML = jours.map(j =>
    '<button class="day-tab' + (festivalDay === j.key ? " active" : "") + '" data-day="' + j.key + '">' + esc(j.label) + '</button>'
  ).join("");
  $$("#festival-days .day-tab").forEach(b => b.addEventListener("click", () => {
    festivalDay = b.dataset.day;
    renderFestival();
  }));

  $$(".seg-toggle button").forEach(b => {
    b.classList.toggle("active", b.dataset.prog === festivalMode);
    b.onclick = () => { festivalMode = b.dataset.prog; renderFestival(); };
  });

  const wrap = $("#festival-events");
  wrap.innerHTML = '<div class="loading">Chargement du programme…</div>';

  const programme = await loadProgramme();
  if (!CONFIG.sources.programmeFestival) {
    wrap.innerHTML = '<div class="load-error">' + t("errors.programmeNonBranche") + '</div>';
    return;
  }

  const favs = getFavs();
  let events = programme.filter(ev => ev.dateKey === festivalDay);
  if (festivalMode === "perso") {
    events = events.filter(ev => favs.includes(ev.dateKey + "|" + ev.titreFr));
  }

  if (events.length === 0) {
    wrap.innerHTML = '<div class="agenda-empty">' +
      (festivalMode === "perso"
        ? "Aucun favori pour ce jour. Touchez le cœur d'un événement pour le garder ici."
        : "Programme à venir pour ce jour.") +
      '</div>';
    return;
  }
  wrap.innerHTML = events.map(ev => {
    const key = ev.dateKey + "|" + ev.titreFr;
    const on = favs.includes(key);
    const heures = ev.heure && ev.heureFin ? ev.heure + " – " + ev.heureFin : ev.heure;
    return (
      '<div class="event-card">' +
        '<button class="ev-fav' + (on ? " on" : "") + '" data-fav="' + esc(key) + '" aria-label="Favori">' + (on ? "♥" : "♡") + '</button>' +
        '<div class="ev-eyebrow">' + esc([heures, ev.lieu].filter(Boolean).join(" · ")) + '</div>' +
        '<div class="ev-title">' + esc(ev.titre) + '</div>' +
        '<div class="ev-meta">' + esc(ev.desc) + '</div>' +
      '</div>'
    );
  }).join("");
  $$("#festival-events [data-fav]").forEach(b => b.addEventListener("click", () => {
    toggleFav(b.dataset.fav);
    renderFestival();
  }));
}

/* ============================================================
   CARTE DU FESTIVAL (source CSV séparée)
   ============================================================ */

async function renderCarteFestival() {
  $("#carte-festival-sub").textContent = CONFIG.edition.datesAffichees;
  const mapEl = $("#festival-map");
  mapEl.innerHTML = '<div class="loading" style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;">' + t("loading.generic") + '</div>';
  const rows = await loadCSV(CONFIG.sources.pointsFestival, "points-festival");
  const points = rows
    .filter(r => r["Nom du point"])
    .map(r => {
      const types = parseTypes(r["Type"]);
      return {
        nom: trField(r, "Nom du point"),
        lat: r["Latitude"], lng: r["Longitude"],
        type: types[0], types,
        desc: trField(r, "Description") || "",
        media: r["Média"] || r["Media"] || "",
      };
    });
  renderMap(mapEl, points, t("nav.festival"));
}
attachGeolocLater("#festival-geoloc", "#festival-map");

/* ============================================================
   CARTE DE L'ÉCOSYSTÈME (onglet Carte)
   ============================================================ */

let ecoFilter = "tout";

let ECO_ALL_CACHE = null; // tous les points (y compris "invité"), pour la recherche

async function renderEcoMap() {
  const mapEl = $("#eco-map");

  // Lieux de l'écosystème : Sheet publiée si disponible, sinon fichier local (data-lieux.js).
  let base;
  if (CONFIG.sources.pointsEcosysteme) {
    const rows = await loadCSV(CONFIG.sources.pointsEcosysteme, "points-ecosysteme");
    base = rows
      .filter(r => r["Nom du point"])
      .map(r => {
        const types = parseTypes(r["Type"]);
        return {
          nom: trField(r, "Nom du point"),
          lat: r["Latitude"], lng: r["Longitude"],
          type: types[0], types,
          desc: trField(r, "Description") || "",
          media: r["Média"] || r["Media"] || "",
          lien: r["Lien"] || r["Site"] || "",
          adresse: r["Adresse"] || "",
          email: r["Email"] || "",
          telephone: r["Téléphone"] || r["Telephone"] || "",
          instagram: r["Instagram"] || "",
          facebook: r["Facebook"] || "",
          // "adherent" (vedette, fiche complète) | "public" (lieu connu, visible par tous) |
          // "invite" (pas encore membre : masqué de la carte, visible seulement via la recherche)
          statut: (r["Statut"] || "adherent").toLowerCase(),
        };
      });
  } else {
    base = LIEUX_ECOSYSTEME.map(l => ({ ...l, type: (l.type || "info"), types: parseTypes(l.type), statut: l.statut || "adherent" }));
  }

  // Pins de départ des visites actives (tap → ouvre la fiche visite)
  const visites = await loadVisites();
  const pts = await loadCSV(CONFIG.sources.pointsVisites, "points-visites");
  const departs = [];
  visites.forEach(v => {
    const dep = pts.find(p => p["id"] === v["id"] && (p["Type"] || "").toLowerCase() === "depart");
    if (dep) {
      departs.push({
        nom: trField(v, "Nom"),
        lat: dep["Latitude"], lng: dep["Longitude"],
        type: "depart",
        statut: "adherent",
        onTap: () => openTarget("visite", v["id"]),
      });
    }
  });

  ECO_ALL_CACHE = base.concat(departs);

  // La carte n'affiche jamais les "invités" : seuls les lieux publics et les adhérents y figurent.
  let all = ECO_ALL_CACHE.filter(p => p.statut !== "invite");
  if (ecoFilter !== "tout") all = all.filter(p => (p.types || [p.type]).includes(ecoFilter));
  renderMap(mapEl, all, t("eco.eyebrow"));
}

$$("#eco-filters .chip").forEach(chip => chip.addEventListener("click", () => {
  ecoFilter = chip.dataset.filter;
  $$("#eco-filters .chip").forEach(c => c.classList.toggle("active", c === chip));
  renderEcoMap();
}));
attachGeolocLater("#eco-geoloc", "#eco-map");

/* ---------- Recherche (voit aussi les lieux "invité", masqués de la carte) ---------- */

function normalizeSearch(s) {
  return (s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
}

document.addEventListener("DOMContentLoaded", () => {
  const input = $("#eco-search");
  const results = $("#eco-search-results");
  if (!input || !results) return;

  input.addEventListener("input", async () => {
    const q = normalizeSearch(input.value);
    if (q.length < 2) { results.classList.remove("open"); results.innerHTML = ""; return; }
    if (!ECO_ALL_CACHE) await renderEcoMap();
    const matches = (ECO_ALL_CACHE || []).filter(p => normalizeSearch(p.nom).includes(q)).slice(0, 8);

    if (matches.length === 0) {
      results.innerHTML = '<div class="search-empty">' + t("eco.searchEmpty") + '</div>';
    } else {
      results.innerHTML = matches.map((p, i) =>
        '<div class="search-result' + (p.statut === "invite" ? " invite" : "") + '" data-idx="' + i + '">' +
          '<div class="sr-nom">' + esc(p.nom) + (p.statut === "invite" ? " · " + t("eco.notMemberYet") : "") + '</div>' +
          '<div class="sr-meta">' + esc(p.adresse || "") + '</div>' +
        '</div>'
      ).join("");
      results.querySelectorAll(".search-result").forEach((el, i) => {
        el.addEventListener("click", () => {
          results.classList.remove("open");
          const p = matches[i];
          if (p.statut === "invite") {
            openInvitePointSheet(p.nom, p.adresse);
            return;
          }
          const ecoEntry = ensureLeafletMap($("#eco-map"));
          if (ecoEntry) {
            let found = null;
            ecoEntry.markersLayer.eachLayer(m => { if (m._pointData === p) found = m; });
            if (found) {
              highlightMarker(ecoEntry, found);
              ecoEntry.map.setView(found.getLatLng(), Math.max(ecoEntry.map.getZoom(), 16));
            }
          }
          openPointSheet(t("eco.eyebrow"), p);
        });
      });
    }
    results.classList.add("open");
  });

  document.addEventListener("click", (e) => {
    if (!e.target.closest(".search-wrap")) { results.classList.remove("open"); }
  });
});

/** Fiche minimale pour un lieu "invité" (pas encore adhérent) : juste nom + adresse + CTA. */
function openInvitePointSheet(nom, adresse) {
  $("#ps-eyebrow").textContent = t("eco.eyebrow");
  $("#ps-title").textContent = nom || "";
  $("#ps-desc").textContent = adresse ? "📍 " + adresse : "";
  $("#ps-media").innerHTML = "";
  $("#ps-link").innerHTML =
    '<div class="member-note">' + t("eco.inviteNote") + '</div>' +
    '<a class="cta gaz" style="text-decoration:none;" href="https://tally.so/r/xXLMoy" target="_blank" rel="noopener">' + t("eco.askToAppear") + '</a>';
  $("#point-sheet").classList.add("open");
}

function attachGeolocLater(btnSel, mapSel) {
  document.addEventListener("DOMContentLoaded", () => {
    const b = $(btnSel), m = $(mapSel);
    if (b && m) attachGeoloc(b, m);
  });
}

/* ============================================================
   FICHE VISITE + CARTE DE VISITE
   ============================================================ */

/** Ligne de montants suggérés (5€ / 10€ / 15€) au-dessus du champ libre.
    suffix distingue les deux emplacements (page visite / carte de visite). */
function montantChipsHtml(suffix) {
  return '<div class="montant-chips" id="montant-chips' + suffix + '">' +
    [5, 10, 15].map(v =>
      '<button type="button" class="chip montant-chip' + (v === 5 ? " active" : "") + '" data-amount="' + v + '">' + v + ' €</button>'
    ).join("") +
    '<button type="button" class="chip montant-chip" data-amount="autre">' + t("unlock.otherAmount") + '</button>' +
  '</div>';
}
function attachMontantChips(suffix) {
  const wrap = $("#montant-chips" + suffix);
  const input = $("#libre-montant" + suffix);
  if (!wrap || !input) return;
  wrap.querySelectorAll(".montant-chip").forEach(chip => {
    chip.addEventListener("click", () => {
      wrap.querySelectorAll(".montant-chip").forEach(c => c.classList.remove("active"));
      chip.classList.add("active");
      if (chip.dataset.amount === "autre") {
        input.style.display = "block";
        input.focus();
      } else {
        input.style.display = "none";
        input.value = chip.dataset.amount;
      }
    });
  });
  input.addEventListener("input", () => {
    wrap.querySelectorAll(".montant-chip").forEach(c => c.classList.remove("active"));
  });
}

async function renderVisite(id) {
  const visites = await loadVisites();
  const v = visites.find(x => x["id"] === id);
  const body = $("#visite-body");
  if (!v) { body.innerHTML = '<div class="load-error">Visite introuvable.</div>'; return; }

  /* Fond de l'écran selon le type d'expérience (visite vert, atelier chocolat, soirée lie-de-vin, escape violet). */
  const screenVisite = $("#screen-visite");
  if (screenVisite) screenVisite.dataset.offre = offreTypeOf(v);
  $("#visite-title").textContent = trField(v, "Nom");
  $("#visite-sub").textContent = ["Visite guidée", v["Tarif direct"]].filter(Boolean).join(" · ");

  const rows = [
    ["Durée", v["Durée"]],
    ["Tarif", v["Tarif direct"]],
    ["Rendez-vous", v["Rendez-vous"]],
  ].filter(r => r[1]);

  const banner = visiteBannerSrc(v);
  const photo = banner
    ? '<img class="media-photo" src="' + esc(banner) + '" alt="" loading="lazy">'
    : '<div class="media-bg"></div>';
  const guide = v["Guide"];
  const initiales = guide ? guide.split(/\s+/).map(w => w[0]).join("").slice(0, 2).toUpperCase() : "";
  const description = trField(v, "Description");

  body.innerHTML =
    '<div class="fiche-hero">' + photo + '</div>' +
    '<div class="fiche-head">' + offreBadgeHtml(offreTypeOf(v)) +
      '<h1 class="fiche-title">' + esc(trField(v, "Nom")) + '</h1>' +
      (description ? '<p class="fiche-desc">' + esc(description) + '</p>' : '') +
    '</div>' +
    (guide
      ? '<div class="fiche-host"><div class="fiche-avatar" aria-hidden="true">' + esc(initiales) + '</div>' +
        '<div><div class="fiche-host-label">' + esc(t("fiche.host")) + '</div><div class="fiche-host-name">' + esc(guide) + '</div></div></div>'
      : '') +
    rows.map(r => '<div class="info-row"><span class="k">' + esc(r[0]) + '</span><span class="v">' + esc(r[1]) + '</span></div>').join("") +
    (v["Lien réservation"]
      ? '<a class="cta" style="text-decoration:none;" href="' + esc(v["Lien réservation"]) + '" target="_blank" rel="noopener">' + t("cta.reserve") + (v["Tarif direct"] ? " · " + esc(v["Tarif direct"]) : "") + '</a>'
      : "") +
    (isVisiteUnlocked(id)
      ? '<div class="member-note" style="text-align:center;">' + t("unlock.done") + '</div>'
      : '<div class="mini-label" style="margin-top:20px;">' + t("unlock.title") + '</div>' +
        '<div class="member-note" style="margin-top:4px;">' + t("unlock.desc") + '</div>' +
        '<input class="input-field" id="libre-email" type="email" inputmode="email" autocomplete="email" placeholder="' + t("unlock.emailPlaceholder") + '" style="margin-top:10px;">' +
        montantChipsHtml("") +
        '<input class="input-field" id="libre-montant" type="number" inputmode="decimal" min="5" step="1" value="5" aria-label="Montant en euros" style="display:none;">' +
        '<button class="cta fee" id="btn-libre" data-visite="' + esc(id) + '">' + t("cta.unlockFull") + '</button>' +
        '<div class="member-note" id="paiement-note" style="display:none;"></div>') +
    '<button class="cta ghost" data-open="carte-visite" data-arg="' + esc(id) + '">' +
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 21 C12 21 5 14 5 9 A7 7 0 0 1 19 9 C19 14 12 21 12 21 Z"/><circle cx="12" cy="9" r="2.5"/></svg>' +
      t("cta.seeRouteOnMap") +
    '</button>';

  const btnLibre = $("#btn-libre");
  if (btnLibre) btnLibre.addEventListener("click", () => startCheckout(id, "libre"));
  attachMontantChips("");
}

/** Points de parcours locaux (secours si le Sheet "points-visites" n'a pas encore
    la visite). Ajouter une entrée ici pour toute nouvelle visite en attendant
    que le Sheet soit renseigné. Le premier point du tableau sert de "depart". */
const VISITE_POINTS_LOCAUX = [
  {
    match: /dames/i,
    points: [
      { nom: "Blanche", lat: 48.883646, lng: 2.333144, desc: "Place Blanche, point de rendez-vous au pied de la Butte." },
      { nom: "Le Moulin Blute-Fin", lat: 48.8876184, lng: 2.3363278, desc: "" },
      { nom: "Le Moulin de la Galette", lat: 48.8873961, lng: 2.3371292, desc: "" },
      { nom: "83 Rue Lepic", lat: 48.8873961, lng: 2.3371292, desc: "" },
      { nom: "Le Bateau-Lavoir", lat: 48.8860314, lng: 2.3376268, desc: "" },
      { nom: "Maison de Dalida", lat: 48.8869795, lng: 2.3370171, desc: "" },
      { nom: "12 Rue Cortot", lat: 48.8884233, lng: 2.3408907, desc: "" },
      { nom: "Vigne du Clos Montmartre", lat: 48.8883248, lng: 2.3402394, desc: "" },
      { nom: "22 Rue des Saules", lat: 48.8878209, lng: 2.3398991, desc: "" },
      { nom: "6 Pl. Saint-Pierre", lat: 48.8859857, lng: 2.3430821, desc: "" },
      { nom: "Jardin des Abbesses", lat: 48.8852271, lng: 2.33855, desc: "" },
      { nom: "Église Saint-Jean de Montmartre", lat: 48.8842083, lng: 2.337819, desc: "" },
      { nom: "Métro Abbesses", lat: 48.8844584, lng: 2.3386555, desc: "" },
    ],
  },
];
function visitePointsLocaux(v) {
  const nom = (v["Nom"] || "") + " " + (v["id"] || "");
  const found = VISITE_POINTS_LOCAUX.find(b => b.match.test(nom));
  if (!found) return [];
  return found.points.map((p, i) => ({
    "Nom du point": p.nom,
    "Latitude": p.lat, "Longitude": p.lng,
    "Type": i === 0 ? "depart" : (i === found.points.length - 1 ? "arrivee" : "info"),
    "Description": p.desc || "",
    "Ordre": String(i),
  }));
}

/**
 * Carte d'une visite : sans paiement débloqué, seul le point
 * de type "depart" est visible. Les autres restent masqués
 * derrière une invitation (le paiement arrive à l'étape suivante).
 */
async function renderCarteVisite(id) {
  const visites = await loadVisites();
  const v = visites.find(x => x["id"] === id);
  $("#carte-visite-title").textContent = v ? trField(v, "Nom") : "Visite";

  const body = $("#carte-visite-body");
  body.innerHTML = '<div class="map-wrap" id="visite-map"></div>' +
    '<button class="cta ghost" id="visite-geoloc" style="margin-top:10px;">' + t("cta.showPosition") + '</button>' +
    '<a class="cta gaz" style="text-decoration:none; margin-top:10px;" href="https://tally.so/r/wbq651" target="_blank" rel="noopener">' + t("cta.joinMovement") + '</a>' +
    '<div class="map-legend" id="visite-map-note"></div>' +
    '<div id="visite-map-unlock"></div>';
  attachGeoloc($("#visite-geoloc"), $("#visite-map"));

  const pts = await loadCSV(CONFIG.sources.pointsVisites, "points-visites");
  let mine = pts
    .filter(p => p["id"] === id && p["Nom du point"])
    .sort((a, b) => (parseInt(a["Ordre"], 10) || 0) - (parseInt(b["Ordre"], 10) || 0));

  // Rien dans le Sheet pour cette visite : on utilise le secours local, s'il existe.
  if (mine.length === 0 && v) mine = visitePointsLocaux(v);

  const unlocked = isVisiteUnlocked(id);
  const visible = unlocked ? mine : mine.filter(p => (p["Type"] || "").toLowerCase() === "depart");

  const points = visible.map(p => {
    const types = parseTypes(p["Type"]);
    return {
      nom: trField(p, "Nom du point"),
      lat: p["Latitude"], lng: p["Longitude"],
      type: types[0], types,
      desc: trField(p, "Description") || "",
      media: p["Média"] || p["Media"] || "",
      num: unlocked && !["depart", "arrivee"].includes((p["Type"] || "").toLowerCase()) ? p["Ordre"] : null,
    };
  });

  renderMap($("#visite-map"), points, v ? trField(v, "Nom") : "Visite");

  $("#visite-map-note").innerHTML = unlocked
    ? t("carteVisite.unlocked")
    : t("carteVisite.locked");

  const unlockBox = $("#visite-map-unlock");
  if (unlocked) {
    unlockBox.innerHTML = "";
  } else {
    unlockBox.innerHTML =
      '<input class="input-field" id="libre-email-carte" type="email" inputmode="email" autocomplete="email" placeholder="' + t("unlock.emailPlaceholder") + '" style="margin-top:10px;">' +
      montantChipsHtml("-carte") +
      '<input class="input-field" id="libre-montant-carte" type="number" inputmode="decimal" min="5" step="1" value="5" aria-label="Montant en euros" style="display:none;">' +
      '<button class="cta fee" id="btn-libre-carte" data-visite="' + esc(id) + '">' + t("cta.showFull") + '</button>' +
      '<div class="member-note" id="paiement-note-carte" style="display:none;"></div>' +
      '<button class="cta ghost" id="btn-restore" style="margin-top:16px;">' + t("cta.restore") + '</button>' +
      '<div id="restore-box" style="display:none; margin-top:8px;">' +
        '<input class="input-field" id="restore-email" type="email" inputmode="email" autocomplete="email" placeholder="' + t("restore.emailPlaceholder") + '">' +
        '<button class="cta ghost" id="btn-restore-confirm" style="margin-top:8px;">' + t("cta.restoreConfirm") + '</button>' +
        '<div class="member-note" id="restore-note" style="display:none;"></div>' +
      '</div>';
    const btnLibreCarte = $("#btn-libre-carte");
    if (btnLibreCarte) btnLibreCarte.addEventListener("click", () => startCheckout(id, "libre", "-carte"));
    attachMontantChips("-carte");

    const btnRestore = $("#btn-restore");
    const restoreBox = $("#restore-box");
    if (btnRestore) btnRestore.addEventListener("click", () => {
      restoreBox.style.display = restoreBox.style.display === "none" ? "block" : "none";
    });
    const btnRestoreConfirm = $("#btn-restore-confirm");
    if (btnRestoreConfirm) btnRestoreConfirm.addEventListener("click", () => restoreAccess(id));
  }
}

/** Retrouve un achat déjà payé via l'email utilisé au paiement (recherche Stripe côté serveur). */
async function restoreAccess(visiteId) {
  const emailEl = $("#restore-email");
  const note = $("#restore-note");
  const email = (emailEl?.value || "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    if (note) { note.style.display = "block"; note.textContent = t("restore.emailInvalid"); }
    return;
  }
  if (note) { note.style.display = "block"; note.textContent = t("restore.checking"); }
  try {
    const res = await fetch("/.netlify/functions/restore-access", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ visite: visiteId, email }),
    });
    const data = await res.json();
    if (res.ok && data.restored) {
      unlockVisite(visiteId);
      renderCarteVisite(visiteId);
      return;
    }
    if (note) { note.textContent = t("restore.notFound"); }
  } catch (e) {
    if (note) { note.textContent = t("restore.error"); }
  }
}

/* ---------- Paiement (Stripe Checkout via fonctions Netlify) ---------- */

function isVisiteUnlocked(id) {
  try { return JSON.parse(localStorage.getItem("unlocked") || "[]").includes(id); }
  catch (e) { return false; }
}
function unlockVisite(id) {
  try {
    const u = JSON.parse(localStorage.getItem("unlocked") || "[]");
    if (!u.includes(id)) u.push(id);
    localStorage.setItem("unlocked", JSON.stringify(u));
  } catch (e) { /* stockage indisponible : l'accès restera vérifiable via Stripe */ }
}

/** Lance une session Stripe Checkout via la fonction Netlify. */
async function startCheckout(visiteId, mode, suffix) {
  suffix = suffix || "";
  const note = $("#paiement-note" + suffix);
  const montant = mode === "libre" ? parseFloat($("#libre-montant" + suffix)?.value || "0") : null;
  const email = ($("#libre-email" + suffix)?.value || "").trim().toLowerCase();

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    if (note) { note.style.display = "block"; note.textContent = t("unlock.emailInvalid"); }
    return;
  }
  if (mode === "libre" && (!isFinite(montant) || montant < 5)) {
    if (note) { note.style.display = "block"; note.textContent = t("unlock.montantMin"); }
    return;
  }
  if (note) { note.style.display = "block"; note.textContent = t("unlock.redirecting"); }

  try {
    const res = await fetch("/.netlify/functions/create-checkout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ visite: visiteId, mode, montant, email }),
    });
    const data = await res.json();
    if (res.ok && data.url) { window.location.href = data.url; return; }
    if (note) { note.textContent = data.error || t("unlock.error"); }
  } catch (e) {
    if (note) { note.textContent = t("unlock.error"); }
  }
}

/** Au retour de Stripe : vérifie la session côté serveur, débloque, nettoie l'URL. */
async function handleCheckoutReturn() {
  const params = new URLSearchParams(window.location.search);
  const sessionId = params.get("session_id");
  const visiteId = params.get("visite");
  if (!sessionId || !visiteId) return;

  try {
    const res = await fetch("/.netlify/functions/verify-session?session_id=" + encodeURIComponent(sessionId));
    const data = await res.json();
    if (data.paid && data.visite === visiteId) {
      unlockVisite(visiteId);
      history.replaceState(null, "", window.location.pathname); // URL propre
      openTarget("carte-visite", visiteId); // directement sur le parcours débloqué
    }
  } catch (e) { /* vérification impossible : on ne débloque pas */ }
}

/* ============================================================
   AGENDA (calendrier + occurrences récurrentes)
   ============================================================ */

const MOIS_FR = ["Janvier","Février","Mars","Avril","Mai","Juin","Juillet","Août","Septembre","Octobre","Novembre","Décembre"];
const JOURS_IDX = { "lundi":1, "mardi":2, "mercredi":3, "jeudi":4, "vendredi":5, "samedi":6, "dimanche":0 };
const SEMAINE_POS = { "1ère":1, "1ere":1, "2ème":2, "2eme":2, "3ème":3, "3eme":3, "4ème":4, "4eme":4, "dernière":-1, "derniere":-1 };

let agendaMonth = null;   // Date au 1er du mois affiché
let agendaSelected = null; // "AAAA-MM-JJ"
let AGENDA_OCC = null;     // occurrences calculées { "AAAA-MM-JJ": [événements] }

function dateKey(d) {
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}
function parseFRDate(s) {
  // accepte "JJ/MM/AAAA" ou "AAAA-MM-JJ"
  if (!s) return null;
  let m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return new Date(+m[3], +m[2] - 1, +m[1]);
  m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) return new Date(+m[1], +m[2] - 1, +m[3]);
  return null;
}
function fmtHeure(h) {
  if (!h) return "";
  const m = h.match(/^(\d{1,2}):(\d{2})/);
  return m ? m[1].padStart(2, "0") + ":" + m[2] : h;
}

/**
 * Récurrence HEBDOMADAIRE : une occurrence chaque semaine,
 * pour chaque jour coché, entre début et fin (bornées à la fenêtre).
 */
function occursWeekly(ev, windowStart, windowEnd) {
  const out = [];
  const jours = (ev["Jour(s)"] || "").toLowerCase().split(",").map(s => s.trim()).filter(Boolean);
  const targetDays = jours.map(j => JOURS_IDX[j]).filter(d => d !== undefined);
  if (targetDays.length === 0) return out;

  const start = parseFRDate(ev["Date"]) || windowStart;
  const end = parseFRDate(ev["Date fin"]) || windowEnd;
  const from = start > windowStart ? start : windowStart;
  const to = end < windowEnd ? end : windowEnd;

  for (let d = new Date(from); d <= to; d.setDate(d.getDate() + 1)) {
    if (targetDays.includes(d.getDay())) out.push(dateKey(d));
  }
  return out;
}

/**
 * Récurrence MENSUELLE : le Nième (ou dernier) jour-de-semaine
 * de chaque mois, entre début et fin (bornées à la fenêtre).
 */
function occursMonthly(ev, windowStart, windowEnd) {
  const out = [];
  const jourStr = (ev["Jour(s)"] || "").toLowerCase().split(",")[0].trim();
  const targetDay = JOURS_IDX[jourStr];
  if (targetDay === undefined) return out;

  const posStr = (ev["Semaine du mois"] || "").toLowerCase().trim();
  const pos = SEMAINE_POS[posStr];
  if (pos === undefined) return out;

  const start = parseFRDate(ev["Date"]) || windowStart;
  const end = parseFRDate(ev["Date fin"]) || windowEnd;
  const from = start > windowStart ? start : windowStart;
  const to = end < windowEnd ? end : windowEnd;

  // Pour chaque mois couvert par la fenêtre :
  const cursor = new Date(from.getFullYear(), from.getMonth(), 1);
  while (cursor <= to) {
    let d;
    if (pos === -1) {
      // dernier <jour> du mois : on part de la fin
      d = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0); // dernier jour du mois
      while (d.getDay() !== targetDay) d.setDate(d.getDate() - 1);
    } else {
      // Nième <jour> du mois : on part du début
      d = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
      while (d.getDay() !== targetDay) d.setDate(d.getDate() + 1);
      d.setDate(d.getDate() + (pos - 1) * 7);
      if (d.getMonth() !== cursor.getMonth()) d = null; // 5ème occurrence inexistante
    }
    if (d && d >= from && d <= to) out.push(dateKey(d));
    cursor.setMonth(cursor.getMonth() + 1);
  }
  return out;
}

async function buildAgendaOccurrences() {
  const rows = await loadCSV(CONFIG.sources.agenda, "agenda");
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const windowEnd = new Date(today); windowEnd.setDate(windowEnd.getDate() + 90);

  const occ = {};
  const push = (key, ev) => { (occ[key] = occ[key] || []).push(ev); };

  rows.forEach(ev => {
    if (!ev["Titre"]) return; // ligne incomplète : ignorée
    const type = (ev["Type"] || "").toLowerCase();

    if (type === "ponctuel") {
      const d = parseFRDate(ev["Date"]);
      if (d && d >= today && d <= windowEnd) push(dateKey(d), ev);
      // événement sur plusieurs jours (Date fin renseignée)
      const fin = parseFRDate(ev["Date fin"]);
      if (d && fin && fin > d) {
        for (let x = new Date(d); x <= fin; x.setDate(x.getDate() + 1)) {
          const k = dateKey(x);
          if (x >= today && x <= windowEnd && k !== dateKey(d)) push(k, ev);
        }
      }
    } else if (type === "récurrent" || type === "recurrent") {
      const freq = (ev["Fréquence"] || "").toLowerCase();
      const keys = freq.includes("mois")
        ? occursMonthly(ev, today, windowEnd)
        : occursWeekly(ev, today, windowEnd);
      keys.forEach(k => push(k, ev));
    }
  });

  // tri par heure dans chaque journée
  Object.values(occ).forEach(list => list.sort((a, b) => fmtHeure(a["Heure début"]).localeCompare(fmtHeure(b["Heure début"]))));
  return occ;
}

async function renderAgenda() {
  $("#agenda-add").href = CONFIG.liens.ajouterEvenement;

  if (!AGENDA_OCC) {
    $("#agenda-cal").innerHTML = '<div class="loading">Chargement de l\'agenda…</div>';
    AGENDA_OCC = await buildAgendaOccurrences();
  }
  const today = new Date(); today.setHours(0, 0, 0, 0);
  if (!agendaMonth) agendaMonth = new Date(today.getFullYear(), today.getMonth(), 1);
  if (!agendaSelected) agendaSelected = dateKey(today);

  renderCalendar();
  renderDayDetail();
}

function renderCalendar() {
  const y = agendaMonth.getFullYear();
  const m = agendaMonth.getMonth();
  const todayKey = dateKey(new Date());

  const firstDay = new Date(y, m, 1);
  const startOffset = (firstDay.getDay() + 6) % 7; // lundi = 0
  const daysInMonth = new Date(y, m + 1, 0).getDate();
  const daysPrevMonth = new Date(y, m, 0).getDate();

  let cells = "";
  const totalCells = Math.ceil((startOffset + daysInMonth) / 7) * 7;
  for (let i = 0; i < totalCells; i++) {
    let dayNum, cellDate, muted = false;
    if (i < startOffset) {
      dayNum = daysPrevMonth - startOffset + 1 + i;
      cellDate = new Date(y, m - 1, dayNum); muted = true;
    } else if (i >= startOffset + daysInMonth) {
      dayNum = i - startOffset - daysInMonth + 1;
      cellDate = new Date(y, m + 1, dayNum); muted = true;
    } else {
      dayNum = i - startOffset + 1;
      cellDate = new Date(y, m, dayNum);
    }
    const key = dateKey(cellDate);
    const has = AGENDA_OCC[key] && AGENDA_OCC[key].length > 0;
    const cls = ["cal-cell", muted ? "muted" : "", key === agendaSelected ? "selected" : "", key === todayKey ? "today" : ""].filter(Boolean).join(" ");
    cells += '<button class="' + cls + '" data-date="' + key + '"><span>' + dayNum + '</span>' +
      (has ? '<div class="cal-dots"><div class="cal-dot"></div></div>' : '<div class="cal-dots"></div>') +
      '</button>';
  }

  $("#agenda-cal").innerHTML =
    '<div class="cal-wrap">' +
      '<div class="cal-head">' +
        '<button class="cal-arrow" data-cal="-1" aria-label="Mois précédent">‹</button>' +
        '<span class="cal-month">' + MOIS_FR[m] + ' ' + y + '</span>' +
        '<button class="cal-arrow" data-cal="1" aria-label="Mois suivant">›</button>' +
      '</div>' +
      '<div class="cal-weekdays"><div>L</div><div>M</div><div>M</div><div>J</div><div>V</div><div>S</div><div>D</div></div>' +
      '<div class="cal-grid">' + cells + '</div>' +
    '</div>';

  $$("#agenda-cal [data-cal]").forEach(b => b.addEventListener("click", () => {
    agendaMonth = new Date(y, m + parseInt(b.dataset.cal, 10), 1);
    renderCalendar();
  }));
  $$("#agenda-cal [data-date]").forEach(b => b.addEventListener("click", () => {
    agendaSelected = b.dataset.date;
    renderCalendar();
    renderDayDetail();
  }));
}

function renderDayDetail() {
  const list = AGENDA_OCC[agendaSelected] || [];
  const d = parseFRDate(agendaSelected);
  const joursFR = ["Dimanche","Lundi","Mardi","Mercredi","Jeudi","Vendredi","Samedi"];
  const label = d ? joursFR[d.getDay()] + " " + d.getDate() + " " + MOIS_FR[d.getMonth()].toLowerCase() : "";

  const wrap = $("#agenda-day");
  if (list.length === 0) {
    wrap.innerHTML = '<div class="day-detail-label">' + esc(label) + '</div>' +
      '<div class="agenda-empty">Rien à l\'agenda ce jour-là. Un événement à annoncer ? Ajoutez-le !</div>';
    return;
  }
  wrap.innerHTML = '<div class="day-detail-label">' + esc(label) + '</div>' +
    list.map(ev => {
      const isRecur = (ev["Type"] || "").toLowerCase().startsWith("r");
      let recurLabel = "";
      if (isRecur) {
        const freq = (ev["Fréquence"] || "").toLowerCase();
        recurLabel = freq.includes("mois")
          ? "Récurrent · " + (ev["Semaine du mois"] || "") + " " + (ev["Jour(s)"] || "").toLowerCase() + " du mois"
          : "Récurrent · chaque " + (ev["Jour(s)"] || "").toLowerCase();
      }
      return (
        '<div class="agenda-item">' +
          '<div class="agenda-time">' + esc(fmtHeure(ev["Heure début"]) || "—") + '</div>' +
          '<div class="agenda-body">' +
            '<div class="agenda-title">' + esc(ev["Titre"]) + '</div>' +
            '<div class="agenda-meta">' + esc([fmtHeure(ev["Heure début"]) && fmtHeure(ev["Heure fin"]) ? fmtHeure(ev["Heure début"]) + " – " + fmtHeure(ev["Heure fin"]) : "", ev["Lieu"]].filter(Boolean).join(" · ")) + '</div>' +
            (ev["Structure"] ? '<div class="agenda-by">' + esc(ev["Structure"]) + '</div>' : '') +
            (recurLabel ? '<span class="badge">' + esc(recurLabel) + '</span>' : '') +
          '</div>' +
        '</div>'
      );
    }).join("");
}

/* ============================================================
   CARTE DE MEMBRE
   ============================================================ */

$("#membre-check").addEventListener("click", async () => {
  const email = ($("#membre-email").value || "").trim().toLowerCase();
  const result = $("#membre-result");
  if (!email.includes("@")) {
    result.innerHTML = '<div class="member-note">Entrez l\'adresse email utilisée pour votre adhésion.</div>';
    return;
  }
  result.innerHTML = '<div class="loading">Vérification…</div>';
  const rows = await loadCSV(CONFIG.sources.membres, "membres");

  // Lecture robuste : si la ligne d'en-têtes est correcte, on lit par nom
  // de colonne ; si elle a disparu ou changé (imperfection humaine dans la
  // Sheet), on retombe sur l'ordre des colonnes : Nom, Email, Date, Statut.
  const normalize = (r) => {
    if ("Email" in r) {
      return { nom: r["Nom"], email: r["Email"], date: r["Date Adhésion"], statut: r["Statut"] };
    }
    const vals = Object.values(r);
    return { nom: vals[0] || "", email: vals[1] || "", date: vals[2] || "", statut: vals[3] || "" };
  };
  const members = rows.map(normalize).filter(m => (m.email || "").includes("@"));
  const found = members.find(m => m.email.trim().toLowerCase() === email);

  if (!found) {
    result.innerHTML =
      '<div class="member-note">Cette adresse ne figure pas dans notre liste d\'adhérents. ' +
      'Si vous venez d\'adhérer, la liste peut mettre un peu de temps à se mettre à jour.</div>' +
      '<a class="cta ghost" style="text-decoration:none;" href="' + esc(CONFIG.liens.adhesion) + '" target="_blank" rel="noopener">Devenir adhérent·e</a>';
    return;
  }

  const active = (found.statut || "").trim().toUpperCase() === "V";
  result.innerHTML =
    '<div class="member-card"><div class="mc-inner"><div class="mc-core">' +
      '<div class="mc-eyebrow">Mouvement Montmartre</div>' +
      '<div class="mc-name">' + esc(found.nom || "Membre") + '</div>' +
      '<div class="mc-since">' +
        (active
          ? "Adhésion active" + (found.date ? " · depuis le " + esc(found.date) : "")
          : "Adhésion à renouveler") +
      '</div>' +
      '<img class="mc-logo" src="icons/logo.png" alt="">' +
    '</div></div></div>' +
    (!active
      ? '<a class="cta ghost" style="text-decoration:none;" href="' + esc(CONFIG.liens.adhesion) + '" target="_blank" rel="noopener">Renouveler mon adhésion</a>'
      : '');
});

/* ============================================================
   INFOS (association + festival)
   ============================================================ */

const ICON_TOPIC = {
  about: '<svg class="topic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><line x1="12" y1="11" x2="12" y2="16.5" stroke-linecap="round"/><circle cx="12" cy="7.3" r="1.15" fill="currentColor" stroke="none"/></svg>',
  mail: '<svg class="topic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="5" width="18" height="14" rx="1.5"/><path d="M3 6 L12 13 L21 6"/></svg>',
  legal: '<svg class="topic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 3 V21 M7 6 H17 M4 10 L7 4 L10 10 M14 10 L17 4 L20 10"/></svg>',
  shield: '<svg class="topic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 3 L20 6 V11 C20 16 16.5 19.5 12 21 C7.5 19.5 4 16 4 11 V6 Z"/></svg>',
  metro: '<svg class="topic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="5" y="4" width="14" height="13" rx="2"/><path d="M5 12 H19 M8 20 L9.5 17 M16 20 L14.5 17"/><circle cx="9" cy="14.5" r="0.8" fill="currentColor"/><circle cx="15" cy="14.5" r="0.8" fill="currentColor"/></svg>',
  food: '<svg class="topic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M7 3 V11 M4.5 3 V7.5 A2.5 2.5 0 0 0 9.5 7.5 V3 M7 11 V21 M16 3 C14 5 14 9 16 11 V21 M16 3 C18 5 18 9 16 11"/></svg>',
};

function accItem(icon, title, bodyHtml, open) {
  return (
    '<div class="acc-item' + (open ? " open" : "") + '">' +
      '<div class="acc-inner">' +
        '<button class="acc-head">' + icon +
          '<span class="acc-title">' + esc(title) + '</span>' +
          '<svg class="chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M6 9 L12 15 L18 9"/></svg>' +
        '</button>' +
        '<div class="acc-body">' + bodyHtml + '</div>' +
      '</div>' +
    '</div>'
  );
}

function bindAccordion(container) {
  container.querySelectorAll(".acc-head").forEach(h => h.addEventListener("click", () => {
    h.closest(".acc-item").classList.toggle("open");
  }));
}

function legalBlockHtml() {
  const v = CONFIG.vendeur || {};
  return [
    [v.nom, v.forme].filter(Boolean).map(esc).join(" — "),
    esc(v.adresse || ""),
    [v.rna ? "RNA " + esc(v.rna) : "", v.siret ? "SIRET " + esc(v.siret) : ""].filter(Boolean).join(" · "),
    v.mentionTva ? esc(v.mentionTva) : ""
  ].filter(Boolean).join("<br>");
}

function renderInfos() {
  const c = CONFIG.contacts;
  const l = CONFIG.liens;
  $("#infos-body").innerHTML =
    '<a class="cta ghost" style="text-decoration:none;" href="' + esc(l.siteAssociation) + '" target="_blank" rel="noopener">' +
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M3 12 H21 M12 3 C14.5 6 14.5 18 12 21 C9.5 18 9.5 6 12 3 Z"/></svg>' +
      t("cta.seeWebsite") +
    '</a>' +
    '<div class="icon-row">' +
      '<a class="icon-btn" href="' + esc(l.instagram) + '" target="_blank" rel="noopener" aria-label="Instagram">' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="5.5"/><circle cx="12" cy="12" r="4.2"/><circle cx="17.2" cy="6.8" r="1.1" fill="currentColor" stroke="none"/></svg>' +
      '</a>' +
      '<a class="icon-btn" href="' + esc(l.facebook) + '" target="_blank" rel="noopener" aria-label="Facebook">' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 4.2 H13.2 A3.3 3.3 0 0 0 9.9 7.5 V10.2 H7.8 V13.4 H9.9 V20.5 H13.1 V13.4 H15.4 L15.8 10.2 H13.1 V7.9 C13.1 7 13.4 6.4 14.4 6.4 H15.8 Z"/></svg>' +
      '</a>' +
      '<a class="icon-btn" href="mailto:' + esc(c.general) + '" aria-label="Envoyer un email">' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="5" width="18" height="14" rx="1.5"/><path d="M3 6 L12 13 L21 6"/></svg>' +
      '</a>' +
    '</div>' +
    '<a class="cta gaz" style="text-decoration:none; margin-top:10px;" href="https://tally.so/r/wbq651" target="_blank" rel="noopener">' + t("cta.joinMovement") + '</a>' +
    '<a class="cta ghost" style="text-decoration:none; margin-top:10px;" href="https://donate.stripe.com/eVadTj2nd5IP8ZWeVi" target="_blank" rel="noopener">' + t("cta.donate") + '</a>' +
    accItem(ICON_TOPIC.about, t("infos.aboutTitle"),
      "<p>" + t("infos.about1") + "</p>" +
      "<p>" + t("infos.about2") + "</p>" +
      "<p>" + t("infos.about3") + "</p>", true) +
    accItem(ICON_TOPIC.mail, t("infos.contactTitle"),
      "<p>" + t("infos.contactGeneral") + " : " + esc(c.general) +
      (CONFIG.festivalActif
        ? "<br>" + t("infos.contactFestival") + " : " + esc(c.festival) + "<br>" +
          t("infos.contactKit") + " : " + esc(c.kitPresse)
        : "") + "</p>", true) +
    accItem(ICON_TOPIC.legal, t("infos.legalTitle"),
      "<p>" + legalBlockHtml() + "</p>") +
    accItem(ICON_TOPIC.shield, t("infos.privacyTitle"),
      "<p>" + t("infos.privacyBody") + "</p>");
  bindAccordion($("#infos-body"));
}

function renderInfosFestival() {
  $("#infos-festival-body").innerHTML =
    accItem(ICON_TOPIC.metro, t("infosFestival.accessTitle"),
      "<p>" + t("infosFestival.accessBody") + "</p>", true) +
    accItem(ICON_TOPIC.shield, t("infosFestival.securityTitle"),
      "<p>" + t("infosFestival.securityBody") + "</p>") +
    accItem(ICON_TOPIC.food, t("infosFestival.foodTitle"),
      "<p>" + t("infosFestival.foodBody") + "</p>") +
    accItem(ICON_TOPIC.about, t("infosFestival.goodToKnowTitle"),
      "<p>" + t("infosFestival.goodToKnowBody") + "</p>");
  bindAccordion($("#infos-festival-body"));
}

/* ============================================================
   DÉMARRAGE
   ============================================================ */

document.addEventListener("DOMContentLoaded", () => {
  // Splash : disparaît après l'animation (ou immédiatement si reduced motion)
  const splash = $("#splash");
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  setTimeout(() => splash.classList.add("done"), reduced ? 200 : 2000);

  applyBrand();
  renderAccueil();
  handleCheckoutReturn();

  // Encadré "À propos" + lien adhésion sur l'écran "Ma carte de membre"
  const membreAbout = $("#membre-about");
  if (membreAbout) {
    membreAbout.innerHTML = accItem(ICON_TOPIC.about, t("infos.aboutTitle"),
      "<p>" + t("infos.about1") + "</p>" +
      "<p>" + t("infos.about2") + "</p>" +
      "<p>" + t("infos.about3") + "</p>", true);
    bindAccordion(membreAbout);
  }
  const membreAdherer = $("#membre-adherer");
  if (membreAdherer) membreAdherer.href = CONFIG.liens.adhesion;

  // Service worker (hors ligne)
  if ("serviceWorker" in navigator && navigator.serviceWorker) {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }
});
