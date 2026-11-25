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
  if (id === "accueil") peindreAdhesionAccueil();
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
    case "membre":          showScreen("membre"); renderMembre(); break;
    case "espace":          showScreen("espace"); renderEspace(); break;
    case "compte":          showScreen("compte"); renderCompte(); break;
    case "infos":           renderInfos(); showScreen("infos"); break;
    case "menu":            renderMenu(); showScreen("menu"); break;
    case "langue":          renderLangue(); showScreen("langue"); break;
    case "infos-festival":  renderInfosFestival(); showScreen("infos-festival"); break;
    case "visite":          renderVisite(arg); showScreen("visite"); break;
    case "carte-visite":    renderCarteVisite(arg); showScreen("carte-visite"); break;
    case "demande":         showScreen("demande"); renderDemande(arg); break;         // js/formulaires.js
    case "rejoindre":       showScreen("demande"); renderRejoindre(arg); break;
    case "hote":            showScreen("hote"); renderHote(arg); break;               // js/formulaires.js
    case "parcours":        showScreen("parcours"); renderParcours(arg); break;       // js/parcours.js
  }
}

document.addEventListener("click", (e) => {
  // Logo ArtDive (en haut à gauche) : retour à l'accueil, sans recharger la page.
  const logo = e.target.closest("[data-accueil]");
  if (logo) { e.preventDefault(); showScreen("accueil"); return; }
  const scroller = e.target.closest("[data-scroll]");
  if (scroller) {
    const el = document.getElementById(scroller.dataset.scroll);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
    return;
  }
  if (e.target.closest("[data-compte]")) { ouvrirMonCompte(); return; }
  const opener = e.target.closest("[data-open]");
  if (opener) { openTarget(opener.dataset.open, opener.dataset.arg); return; }
  const back = e.target.closest("[data-back]");
  if (back) {
    // Depuis le formulaire de réservation, « retour » ramène à la fiche.
    if ($("#screen-reserver") && $("#screen-reserver").classList.contains("active") && back.closest("#screen-reserver")) { showScreen("visite"); return; }
    goBack(); return;
  }
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
  /* Étape numérotée : pastille ocre (famille "reperes") avec un chiffre en Fraunces. */
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
/* Pins de la carte ArtDive : 29 glyphes pleins (design system ArtDive, planches E26 à E29).
   Pastille ronde de 30 px, anneau crème, glyphe de 19 px. Trois familles de couleur :
   culture et création (outremer, glyphe crème), sortir (vermillon, glyphe crème),
   repères (ocre, glyphe brun nuit) ; voir .map-pin.culture / .sortir / .reperes dans le thème.
   La clé est la valeur de la colonne Type des Sheets ; un type inconnu retombe sur "info". */
const PIN_ICONS = {
  "info": '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9.5" fill="#14100D"/><rect x="10.8" y="10.4" width="2.4" height="6.4" rx="1.2" fill="#C08A2E"/><circle cx="12" cy="7.5" r="1.5" fill="#C08A2E"/></svg>',
  "depart": '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="#14100D" d="M5.2 3h2v18h-2z"/><path fill="#14100D" d="M7.2 4.2h11.6l-3.2 4.3 3.2 4.3H7.2z"/></svg>',
  "arrivee": '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5.2" y="3" width="2" height="18" fill="#14100D"/><rect x="7.2" y="4" width="12.4" height="9" fill="#14100D"/><rect x="7.20" y="4" width="2.48" height="3" fill="#C08A2E"/><rect x="7.20" y="10" width="2.48" height="3" fill="#C08A2E"/><rect x="9.68" y="7" width="2.48" height="3" fill="#C08A2E"/><rect x="12.16" y="4" width="2.48" height="3" fill="#C08A2E"/><rect x="12.16" y="10" width="2.48" height="3" fill="#C08A2E"/><rect x="14.64" y="7" width="2.48" height="3" fill="#C08A2E"/><rect x="17.12" y="4" width="2.48" height="3" fill="#C08A2E"/><rect x="17.12" y="10" width="2.48" height="3" fill="#C08A2E"/></svg>',
  "musee": '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="#14100D" d="M12 2.6 2.4 8.4v1.9h19.2V8.4z"/><rect x="4.4" y="11.6" width="2.8" height="6.6" fill="#14100D"/><rect x="8.8" y="11.6" width="2.8" height="6.6" fill="#14100D"/><rect x="12.4" y="11.6" width="2.8" height="6.6" fill="#14100D"/><rect x="16.8" y="11.6" width="2.8" height="6.6" fill="#14100D"/><rect x="2.4" y="19.2" width="19.2" height="2.2" rx=".6" fill="#14100D"/></svg>',
  "espace-art": '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5.4" y="3.2" width="13.2" height="9.6" rx="1.2" fill="#14100D"/><path d="M8.2 10.6c1.4-3 2.8-3 4-1.2s2.2 1 3.4-1.4" stroke="#C08A2E" stroke-width="1.6" fill="none" stroke-linecap="round"/><path d="M8.6 13.6 6 21M15.4 13.6 18 21M12 13.6V21" stroke="#14100D" stroke-width="1.9" stroke-linecap="round"/></svg>',
  "boutique": '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="#14100D" d="M4.2 4.4h15.6l1.3 5a2.7 2.7 0 0 1-5.3 1 2.7 2.7 0 0 1-4.6 0 2.7 2.7 0 0 1-4.6 0 2.7 2.7 0 0 1-5.3-1z"/><path fill="#14100D" d="M5.4 12.4h13.2V20.6H5.4z"/><rect x="10" y="15.4" width="4" height="5.2" fill="#C08A2E"/></svg>',
  "toilettes": '<svg viewBox="0 0 24 24" aria-hidden="true"><g fill="#14100D"><circle cx="6.5" cy="3.6" r="1.8"/><rect x="4.9" y="5.6" width="3.2" height="5.6" rx="1.6"/><rect x="4.9" y="11" width="1.5" height="8.5" rx=".75"/><rect x="7" y="11" width="1.5" height="8.5" rx=".75"/><circle cx="17.5" cy="3.6" r="1.8"/><path d="M16.1 5.6h2.8l2.4 8.3c0 .4-.3.7-.7.7h-6.2c-.4 0-.7-.3-.7-.7z"/><rect x="16" y="14" width="1.4" height="5.5" rx=".7"/><rect x="18.1" y="14" width="1.4" height="5.5" rx=".7"/></g></svg>',
  "metro": '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9.5" fill="#14100D"/><path d="M8 16.4V8l4 4.4L16 8v8.4" stroke="#C08A2E" stroke-width="2.2" fill="none" stroke-linejoin="round" stroke-linecap="round"/></svg>',
  "librairie": '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="#14100D" d="M12 6C10.4 4.6 7.4 4.2 4.2 4.8v13.8c3.2-.6 6.2-.1 7.8 1.2 1.6-1.3 4.6-1.8 7.8-1.2V4.8C16.6 4.2 13.6 4.6 12 6z"/><path d="M12 6.4v13" stroke="#C08A2E" stroke-width="1.5"/></svg>',
  "ecole": '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="#14100D" d="M1.8 8.6 12 3.4l10.2 5.2L12 13.8z"/><path fill="#14100D" d="M5.6 11.8v4.6c0 2 3 3.6 6.4 3.6s6.4-1.6 6.4-3.6v-4.6L12 15.1z"/><rect x="20.4" y="9.4" width="1.7" height="6.4" rx=".85" fill="#14100D"/></svg>',
  "presse": '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.2" y="4.8" width="14.6" height="14.8" rx="1.4" fill="#14100D"/><path d="M17.8 8.6h3.2v8.8a2.2 2.2 0 0 1-2.2 2.2h-1z" fill="#14100D"/><path d="M6.4 8.6h8.2M6.4 11.8h8.2M6.4 15h5" stroke="#C08A2E" stroke-width="1.6" stroke-linecap="round"/></svg>',
  "vue": '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="#14100D" d="M1.8 12c3.2-5.8 6.8-7.8 10.2-7.8s7 2 10.2 7.8c-3.2 5.8-6.8 7.8-10.2 7.8S5 17.8 1.8 12z"/><circle cx="12" cy="12" r="4" fill="#C08A2E"/><circle cx="12" cy="12" r="2" fill="#14100D"/></svg>',
  "atelier-artiste": '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="#EFE7D9" d="M12 3C6.8 3 2.8 6.9 2.8 11.8c0 3.3 2.4 4.4 4.3 3.9 1-.3 1.8.6 1.2 1.5-.7 1.1-.1 2.5 1.6 2.7 5.8.6 11.3-3 11.3-8.4C21.2 6.5 17.2 3 12 3z"/><circle cx="7.6" cy="10" r="1.4" fill="#2B3E8F"/><circle cx="11.6" cy="7.4" r="1.4" fill="#2B3E8F"/><circle cx="16.2" cy="9.4" r="1.4" fill="#2B3E8F"/></svg>',
  "espace-membre": '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="#EFE7D9" d="M12 3.2 2.6 11.2h2.9V20.5h5v-5.6h3v5.6h5V11.2h2.9z"/></svg>',
  "cinema": '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.4" y="10.2" width="17.2" height="10.4" rx="1.6" fill="#EFE7D9"/><path fill="#EFE7D9" d="M3.5 8.8 4.5 4.3l15.4 3.2-.8 3.6z"/><path d="M8.6 5.2 7.7 9.6M12.8 6.1l-.9 4.3M17 7l-.9 4.3" stroke="#2B3E8F" stroke-width="1.5" fill="none"/></svg>',
  "concert": '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="#EFE7D9" d="M8.6 4.4l11-1.9v12.7a3.4 3.4 0 1 1-2-3.1V6l-7 1.2v10.4a3.4 3.4 0 1 1-2-3.1z"/></svg>',
  "exposition": '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.2" y="4.2" width="17.6" height="14" rx="1.8" fill="#EFE7D9"/><circle cx="8.6" cy="9" r="1.6" fill="#2B3E8F"/><path fill="#2B3E8F" d="M5.2 16.2l4-4.2 3.4 3.2 2.8-2.4 3.4 3.4z"/><rect x="8" y="19.6" width="8" height="1.8" rx=".9" fill="#EFE7D9"/></svg>',
  "galerie": '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="2.8" y="4.8" width="11.4" height="12.4" rx="1.6" fill="#EFE7D9"/><circle cx="6.6" cy="9.2" r="1.4" fill="#2B3E8F"/><path fill="#2B3E8F" d="M4 15.4l3.4-3.6 2.8 2.7 1.5-1.4 1.6 2.3z"/><rect x="15.8" y="8.2" width="5.4" height="8.8" rx="1.3" fill="#EFE7D9"/><rect x="2.8" y="19.2" width="18.4" height="1.8" rx=".9" fill="#EFE7D9"/></svg>',
  "studio": '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="8.8" y="2.8" width="6.4" height="11.4" rx="3.2" fill="#EFE7D9"/><path d="M5.8 11.2a6.2 6.2 0 0 0 12.4 0" stroke="#EFE7D9" stroke-width="2" fill="none" stroke-linecap="round"/><path d="M12 17.6V21M8.8 21h6.4" stroke="#EFE7D9" stroke-width="2" stroke-linecap="round"/></svg>',
  "theatre": '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="#EFE7D9" d="M4.6 4.4c2.7 1.2 12.1 1.2 14.8 0V12c0 5-3.6 8.6-7.4 8.6S4.6 17 4.6 12z"/><circle cx="9" cy="10" r="1.3" fill="#2B3E8F"/><circle cx="15" cy="10" r="1.3" fill="#2B3E8F"/><path d="M8.2 14.2c1 2.2 6.6 2.2 7.6 0" stroke="#2B3E8F" stroke-width="1.8" fill="none" stroke-linecap="round"/></svg>',
  "disquaire": '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9.5" fill="#EFE7D9"/><circle cx="12" cy="12" r="6" fill="none" stroke="#2B3E8F" stroke-width=".9"/><circle cx="12" cy="12" r="3" fill="#2B3E8F"/><circle cx="12" cy="12" r=".9" fill="#EFE7D9"/></svg>',
  "createur": '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="6.8" cy="6.4" r="3" fill="#EFE7D9"/><circle cx="6.8" cy="6.4" r="1.2" fill="#2B3E8F"/><circle cx="6.8" cy="17.6" r="3" fill="#EFE7D9"/><circle cx="6.8" cy="17.6" r="1.2" fill="#2B3E8F"/><path d="M9 8l11.4 10.4M9 16 20.4 5.6" stroke="#EFE7D9" stroke-width="2.4" stroke-linecap="round"/></svg>',
  "media": '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="#EFE7D9" d="M3.3 8a2.2 2.2 0 0 1 2.2-2.2h2l1.3-2h6.4l1.3 2h2A2.2 2.2 0 0 1 20.7 8v10a2.2 2.2 0 0 1-2.2 2.2h-13A2.2 2.2 0 0 1 3.3 18z"/><circle cx="12" cy="12.9" r="4" fill="#C42E18"/><circle cx="12" cy="12.9" r="2.2" fill="#EFE7D9"/></svg>',
  "ar": '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="#EFE7D9" d="M12 2.4l8.6 5v9.2l-8.6 5-8.6-5V7.4z"/><path d="M12 12v9.4M12 12l8.3-4.8M12 12 3.7 7.2" stroke="#C42E18" stroke-width="1.6" fill="none" stroke-linecap="round"/></svg>',
  "bar": '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="#EFE7D9" d="M3.2 3.8h17.6L13 13.4V19h4.3v2.2H6.7V19H11v-5.6z"/><circle cx="17.6" cy="5.8" r="0" fill="#C42E18"/></svg>',
  "cafe": '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="#EFE7D9" d="M3.8 8.2h12.6v6.3a4.6 4.6 0 0 1-4.6 4.6H8.4a4.6 4.6 0 0 1-4.6-4.6z"/><path d="M16.4 9.6h1.3a2.6 2.6 0 0 1 0 5.2h-1.3" stroke="#EFE7D9" stroke-width="2" fill="none"/><path d="M7.6 3.2c-.9.9-.9 1.9 0 2.8M11.6 3.2c-.9.9-.9 1.9 0 2.8" stroke="#EFE7D9" stroke-width="1.7" fill="none" stroke-linecap="round"/><rect x="5" y="20" width="10" height="1.6" rx=".8" fill="#EFE7D9"/></svg>',
  "restaurant": '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="#EFE7D9" d="M4.8 3h1.6v5.4h.8V3h1.6v5.4h.8V3h1.6v6.1a3.2 3.2 0 0 1-2.5 3.1V21H7.3v-8.8a3.2 3.2 0 0 1-2.5-3.1z"/><path fill="#EFE7D9" d="M17.6 3c-2.3 1.6-3 5-2.6 8 .2 1.5 1.3 2.1 2.6 2.1V21h1.8V3z"/></svg>',
  "cabaret": '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="#EFE7D9" stroke="#EFE7D9" stroke-width="1.6" stroke-linejoin="round" d="M12.00 2.60 L14.53 9.12 L21.51 9.51 L16.09 13.93 L17.88 20.69 L12.00 16.90 L6.12 20.69 L7.91 13.93 L2.49 9.51 L9.47 9.12z"/></svg>',
  "standup": '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9.5" fill="#EFE7D9"/><circle cx="8.9" cy="10" r="1.3" fill="#C42E18"/><circle cx="15.1" cy="10" r="1.3" fill="#C42E18"/><path fill="#C42E18" d="M7.2 13.2h9.6c0 3-2.2 5-4.8 5s-4.8-2-4.8-5z"/></svg>',
};
/* Famille de couleur de chaque pin : culture et création (outremer), sortir (vermillon), repères (ocre). */
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

/* Fiches : lues dans Supabase (administration, étape 6.2) dès qu'au moins une y est publiée ;
   sinon, en secours, dans la Sheet « Visites » (décision du 19/11 : la Sheet est abandonnée
   une fois les fiches reprises). Les fiches Supabase sont converties au format des lignes de
   la Sheet pour que l'accueil, la fiche et la carte n'aient qu'une seule façon de les lire. */
async function loadVisites() {
  if (VISITES_CACHE) return VISITES_CACHE;
  let rows = null;
  try { rows = await loadFichesSupabase(); } catch (e) { rows = null; }
  if (!rows || !rows.length) {
    rows = (await loadCSV(CONFIG.sources.visites, "visites"))
      .filter(v => (v["Actif"] || "").toLowerCase() === "oui" && v["id"] && inLocalite(v));
  }
  VISITES_CACHE = rows;
  return VISITES_CACHE;
}

const TYPE_LIBELLE_SHEET = { visite_guidee: "Visite", autoguidee: "Visite", atelier: "Atelier", soiree: "Soirée", escape_game: "Escape game" };
function prixAffiche(e) {
  const c = e.type === "autoguidee" ? e.prix_libre_min_centimes : e.prix_centimes;
  if (c == null) return "";
  const m = new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", minimumFractionDigits: c % 100 ? 2 : 0 }).format(c / 100);
  return e.type === "autoguidee" ? tx("card.des", { m }) : m;
}
function dureeAffichee(min) {
  if (!min) return "";
  const h = Math.floor(min / 60), m = min % 60;
  return h ? h + " h" + (m ? " " + String(m).padStart(2, "0") : "") : m + " min";
}
/** Texte affiché dans une langue traduite automatiquement et pas encore relue par l'association ? */
function traductionAuto(v) {
  const l = getLang();
  return v && v._source === "supabase" && l !== "fr" && !(v._relues || []).includes(l) && !!v["Nom_" + l.toUpperCase()];
}

async function loadFichesSupabase() {
  const loc = (currentLocalite() || {}).id || CONFIG.localiteParDefaut;
  const exps = await supa("experiences?select=id,slug,type,titre,accroche,description,duree_minutes,photo_url,point_rdv,prix_centimes,prix_libre_min_centimes,option_audioguide_centimes,nb_etapes,intervenant_id,langues_relues" +
    "&publie=eq.true&actif=eq.true&localite_id=eq." + encodeURIComponent(loc) + "&order=ordre.asc,cree_le.asc");
  if (!exps.length) return [];
  const ids = [...new Set(exps.map(e => e.intervenant_id).filter(Boolean))];
  const ints = ids.length ? await supa("intervenants?select=id,nom&id=in.(" + ids.join(",") + ")").catch(() => []) : [];
  const ligne = (champ, base, o) => { ["fr", "en", "es", "zh", "ar", "ru"].forEach(l => { if (champ && champ[l]) o[base + (l === "fr" ? "" : "_" + l.toUpperCase())] = champ[l]; }); };
  return exps.map(e => {
    const o = { id: e.slug, Type: TYPE_LIBELLE_SHEET[e.type] || "Visite", Actif: "Oui",
      Guide: (ints.find(i => i.id === e.intervenant_id) || {}).nom || "",
      "Tarif direct": prixAffiche(e), "Durée": dureeAffichee(e.duree_minutes), Photo: e.photo_url || "",
      "Rendez-vous": (e.point_rdv && e.point_rdv.fr) || "", _source: "supabase", _relues: e.langues_relues || ["fr"],
      _intervenant: ints.some(i => i.id === e.intervenant_id) ? e.intervenant_id : null,   // page de l'intervenant, s'il est publié
      _exp: { id: e.id, type: e.type, prix_libre_min_centimes: e.prix_libre_min_centimes, option_audioguide_centimes: e.option_audioguide_centimes, nb_etapes: e.nb_etapes } };
    ligne(e.titre, "Nom", o);
    ligne(Object.keys(e.description || {}).length ? e.description : e.accroche, "Description", o);
    ligne(e.accroche, "Accroche", o);   // phrase courte des cartes d'accueil
    return o;
  });
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
  return found ? found.src : (IMAGES_PAR_TYPE[offreTypeOf(v)] || "");
}
/** Image de fond par type d'expérience, quand une fiche n'a pas sa propre photo.
    Visites et escape game : en attente des images de l'association. */
const IMAGES_PAR_TYPE = {
  atelier: "icons/fond-atelier.jpg",
  diner: "icons/fond-soiree.jpg",
};

/** Rangée de logos des partenaires (CONFIG.partenaires), sur l'accueil et le festival.
    Liste vide : la rangée et son titre restent masqués. blocId : id du bloc. */
function renderPartenaires(blocId) {
  const bloc = $("#" + blocId);
  if (!bloc) return;
  const liste = (CONFIG.partenaires || []).filter(p => p && p.logo);
  bloc.hidden = liste.length === 0;
  bloc.querySelector(".partenaires-list").innerHTML = liste.map(p =>
    '<a class="partenaire" href="' + esc(p.lien || "#") + '" target="_blank" rel="noopener sponsored">' +
      '<img src="' + esc(p.logo) + '" alt="' + esc(p.nom || "") + '" loading="lazy"></a>'
  ).join("");
}

/** Liens « Faire un don » écrits dans index.html : adresse unique CONFIG.liens.don. */
function brancherLiensDon(racine) {
  (racine || document).querySelectorAll("a[data-don]").forEach(a => {
    a.href = CONFIG.liens.don;
    a.target = "_blank";
    a.rel = "noopener";
  });
}

/** Panneau d'adhésion de l'accueil (E1.1) : repeint à chaque retour sur l'accueil
    (la carte de membre peut avoir changé entre-temps). */
function peindreAdhesionAccueil() {
  const el = $("#accueil-adhesion");
  if (el) el.innerHTML = adhesionMenuHtml(statutAppareil(), "accueil");
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

let offreActive = "tout";

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
  renderPartenaires("partenaires-accueil");
  peindreAdhesionAccueil();
  renderLocalitePicker();

  /* Bloc d'accroche de la localité (texte venant de CONFIG.localites) */
  const loc = currentLocalite() || {};
  const lang = getLang();
  if ($("#hero-loc")) $("#hero-loc").textContent = [loc.nom, loc.precision].filter(Boolean).join(", ");
  if ($("#hero-h1")) {
    const acc = parLangue(loc.accroche) || [t("hero.title")];
    $("#hero-h1").innerHTML = esc(acc[0] || "") + (acc[1] ? " <em>" + esc(acc[1]) + "</em>" : "");
  }
  if ($("#hero-sous")) $("#hero-sous").textContent = tx("hero.sous", { localite: loc.nom || "" });

  const list = $("#visites-list");
  const visites = await loadVisites();
  if (visites.length === 0) {
    list.innerHTML = '<div class="load-error">' + t("errors.visitesIndispo") + '</div>';
    return;
  }
  /* Carte d'expérience (canvas E1.1) : photo en fond sous un voile sombre, badge du type en haut,
     titre et prix dans la couleur du type. Sans photo : panneau sombre uni. */
  const card = (v) => {
    const bannerSrc = visiteBannerSrc(v);
    const guide = trField(v, "Guide");
    const prix = v["Tarif direct"] || "";
    const nom = trField(v, "Nom");
    const desc = trField(v, "Accroche") || trField(v, "Description");
    const type = offreTypeOf(v);
    const x = INFOS_CARTES[v["id"]] || {};
    const metier = x.role ? parLangue(x.role) || "" : "";
    const ligneGroupe = x.groupe || v["Durée"] || "";
    return (
      '<button class="act-card' + (bannerSrc ? '' : ' act-card-plain') + '" data-type="' + type + '" data-open="visite" data-arg="' + esc(v["id"]) + '">' +
        (bannerSrc ? '<img class="act-fond" src="' + esc(bannerSrc) + '" alt="" loading="lazy"><span class="act-voile"></span>' : '') +
        offreBadgeHtml(type) +
        '<span class="act-corps">' +
          '<span class="act-name">' + esc(nom) + '</span>' +
          (desc ? '<span class="act-desc">' + esc(desc) + '</span>' : '') +
          (guide ? '<span class="act-by">' + esc(t("card.with")) + ' <b>' + esc(guide) + '</b>' + (metier ? ', ' + esc(metier) : '') + '</span>' : '') +
          (ligneGroupe ? '<span class="act-meta">' + esc(ligneGroupe) + '</span>' : '') +
          ((prix || x.prochain) ? '<span class="act-foot"><span class="act-next">' + esc(x.prochain || "") + '</span>' +
            (prix ? '<span class="act-price">' + esc(prix) + '</span>' : '') + '</span>' : '') +
        '</span>' +
      '</button>'
    );
  };
  /* Catégories : visites (guidées + autoguidées), ateliers, escape game, soirées partenaires.
     La colonne optionnelle "Type" du Sheet les distingue ; vide = visite (voir offreTypeOf). */
  const typeOf = offreTypeOf;
  const cats = [
    { k: "tout", label: t("chip.tout"), always: true },
    { k: "visite", label: t("chip.visites"), always: true },
    { k: "atelier", label: t("chip.ateliers"), always: true },
    { k: "escape", label: t("chip.escape"), always: true },
    { k: "diner", label: t("chip.soirees"), always: false }, // visible seulement s'il y en a de programmées
  ].filter(c => c.always || visites.some(v => typeOf(v) === c.k));
  if (!cats.some(c => c.k === offreActive)) offreActive = "tout";

  const paint = () => {
    $("#offre-chips").innerHTML = cats.map(c =>
      '<button class="chip' + (c.k === offreActive ? ' active' : '') + '" role="tab" data-offre="' + c.k + '">' + esc(c.label) + '</button>'
    ).join("");
    $$("#offre-chips .chip").forEach(ch => ch.addEventListener("click", () => { offreActive = ch.dataset.offre; paint(); }));
    const items = offreActive === "tout" ? visites : visites.filter(v => typeOf(v) === offreActive);
    list.innerHTML = items.length
      ? items.map(card).join("")
      : '<div class="act-empty">' + t("empty.bientot") + '</div>';
  };
  paint();
  completerCartes(visites).then((change) => { if (change) paint(); });
}

/* Lignes des cartes d'accueil venant de Supabase (canvas E1.1) : métier de l'intervenant,
   taille du groupe, prochaine date. Seulement pour les fiches publiées dans la base
   (même identifiant que la Sheet) ; sinon la carte garde la durée de la Sheet. */
const INFOS_CARTES = {};
async function completerCartes(visites) {
  const slugs = visites.map((v) => v["id"]).filter((id) => /^[a-z0-9-]+$/.test(id || ""));
  if (!slugs.length) return false;
  try {
    const exps = await supa("experiences?select=id,slug,type,capacite_max,intervenant_id&publie=eq.true&actif=eq.true&slug=in.(" + slugs.join(",") + ")");
    if (!exps.length) return false;
    const ids = exps.map((e) => e.id).join(",");
    const intIds = [...new Set(exps.map((e) => e.intervenant_id).filter(Boolean))].join(",");
    const [seances, ints] = await Promise.all([
      supa("seances_publiques?select=experience_id,debut,places_restantes&statut=eq.publiee&experience_id=in.(" + ids + ")&debut=gt." +
        encodeURIComponent(new Date().toISOString()) + "&order=debut.asc").catch(() => []),
      intIds ? supa("intervenants?select=id,role&id=in.(" + intIds + ")").catch(() => []) : Promise.resolve([]),
    ]);
    exps.forEach((e) => {
      const prochaine = seances.find((s) => s.experience_id === e.id && s.places_restantes > 0);
      const role = (ints.find((i) => i.id === e.intervenant_id) || {}).role;
      const n = e.capacite_max;
      const groupe = e.type === "autoguidee" ? t("card.aTonRythme")
        : e.type === "escape_game" ? (n ? tx("card.equipe", { n }) : "")
        : (e.type === "visite_guidee" || e.type === "atelier") && n ? tx("card.petitGroupe", { n }) : "";
      INFOS_CARTES[e.slug] = {
        role: role && Object.keys(role).length ? role : null,
        groupe,
        prochain: prochaine ? tx("card.prochain", { d: new Date(prochaine.debut).toLocaleDateString(localeResa(),
          { timeZone: "Europe/Paris", weekday: "short", day: "numeric", month: "short" }) }) : "",
      };
    });
    return true;
  } catch (e) { return false; }   // hors ligne ou base pas prête : les cartes restent comme avant
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
  renderPartenaires("partenaires-festival");

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

/* ---------- Partage d'une expérience (22/11) ---------- */
const ICONE_PARTAGE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v12M7 8l5-5 5 5"/><path d="M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6"/></svg>';
/** Lien court d'une expérience : https://artdive.app/e/<slug> (aperçu avec photo et titre sur les réseaux). */
const lienExperience = (slug) => window.location.origin + "/e/" + slug;
/** Partage du téléphone (WhatsApp, messages…) quand il existe, sinon copie du lien. */
async function partagerLien(url, titre, note) {
  try {
    if (navigator.share) { await navigator.share({ title: titre, url }); return; }
  } catch (e) { if (e && e.name === "AbortError") return; }
  try { await navigator.clipboard.writeText(url); if (note) note.textContent = t("partage.copie"); }
  catch (e) { if (note) note.textContent = url; }
}

async function renderVisite(id) {
  const visites = await loadVisites();
  // Lien partagé sans les 4 caractères ajoutés à l'adresse d'une expérience d'intervenant (ex. studio-nomade → studio-nomade-a3f9).
  let v = visites.find(x => x["id"] === id);
  if (!v) { const proches = visites.filter((x) => new RegExp("^" + String(id).replace(/[^a-z0-9-]/g, "") + "-[a-z0-9]{4}$").test(x["id"] || "")); if (proches.length === 1) { v = proches[0]; id = v["id"]; } }
  const body = $("#visite-body");
  if (!v) { body.innerHTML = '<div class="load-error">Visite introuvable.</div>'; return; }

  /* Fond de l'écran selon le type d'expérience (visite marron, atelier vert depuis le 22/11, soirée lie-de-vin, escape violet). */
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
      (traductionAuto(v) ? '<p class="trad-auto">' + esc(t("trad.auto")) + '</p>' : '') +
      (v._source === "supabase" ? '<button type="button" class="partage-btn" id="fiche-partager">' + ICONE_PARTAGE + '<span>' + esc(t("partage.bouton")) + '</span></button>' +
        '<span class="member-note partage-note" id="fiche-partager-note" role="status"></span>' : '') +
    '</div>' +
    (guide && v._intervenant
      ? '<button type="button" class="fiche-host fiche-host-lien" data-open="hote" data-arg="' + esc(v._intervenant) + '"><span class="fiche-avatar" aria-hidden="true">' + esc(initiales) + '</span>' +
        '<span class="fiche-host-corps"><span class="fiche-host-label">' + esc(t("fiche.host")) + '</span><span class="fiche-host-name">' + esc(guide) + '</span></span>' +
        '<span class="fiche-host-voir">' + esc(t("cta.voir")) + '</span></button>'
      : guide
      ? '<div class="fiche-host"><div class="fiche-avatar" aria-hidden="true">' + esc(initiales) + '</div>' +
        '<div><div class="fiche-host-label">' + esc(t("fiche.host")) + '</div><div class="fiche-host-name">' + esc(guide) + '</div></div></div>'
      : '') +
    rows.map(r => '<div class="info-row"><span class="k">' + esc(r[0]) + '</span><span class="v">' + esc(r[1]) + '</span></div>').join("") +
    '<div id="visite-seances"></div>' +
    (v["Lien réservation"]
      ? '<a class="cta cta-externe" style="text-decoration:none;" href="' + esc(v["Lien réservation"]) + '" target="_blank" rel="noopener">' + t("cta.reserve") + (v["Tarif direct"] ? " · " + esc(v["Tarif direct"]) : "") + '</a>'
      : "") +
    (v._exp && v._exp.type === "autoguidee" ? '<div id="parcours-fiche"></div>' : '') +   // parcours payé par lien d'accès (partie 3)
    (v._source === "supabase" ? '' : isVisiteUnlocked(id)
      ? '<div class="member-note" style="text-align:center;">' + t("unlock.done") + '</div>'
      : '<div class="mini-label" style="margin-top:20px;">' + t("unlock.title") + '</div>' +
        '<div class="member-note" style="margin-top:4px;">' + t("unlock.desc") + '</div>' +
        '<input class="input-field" id="libre-email" type="email" inputmode="email" autocomplete="email" placeholder="' + t("unlock.emailPlaceholder") + '" style="margin-top:10px;">' +
        montantChipsHtml("") +
        '<input class="input-field" id="libre-montant" type="number" inputmode="decimal" min="5" step="1" value="5" aria-label="Montant en euros" style="display:none;">' +
        '<button class="cta fee" id="btn-libre" data-visite="' + esc(id) + '">' + t("cta.unlockFull") + '</button>' +
        '<div class="member-note" id="paiement-note" style="display:none;"></div>') +
    (["visite", "atelier"].includes(offreTypeOf(v)) && !/autoguid|rythme/i.test(v["Type"] || "") && !(v._exp && v._exp.type === "autoguidee")
      ? '<button class="cta ghost" data-open="demande" data-arg="' + esc(id) + '">' + esc(offreTypeOf(v) === "atelier" ? t("form.demanderAtelier") : t("form.demanderVisite")) + '</button>' : '') +
    (v._source === "supabase" ? '' :   // l'ancienne carte des points (Sheet) ne sert qu'aux fiches de la Sheet
    '<button class="cta ghost" data-open="carte-visite" data-arg="' + esc(id) + '">' +
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 21 C12 21 5 14 5 9 A7 7 0 0 1 19 9 C19 14 12 21 12 21 Z"/><circle cx="12" cy="9" r="2.5"/></svg>' +
      t("cta.seeRouteOnMap") +
    '</button>');
  if (v._exp && v._exp.type === "autoguidee" && typeof renderParcoursFiche === "function") renderParcoursFiche(v);   // js/parcours.js

  const btnLibre = $("#btn-libre");
  if (btnLibre) btnLibre.addEventListener("click", () => startCheckout(id, "libre"));
  const btnPartage = $("#fiche-partager");
  if (btnPartage) btnPartage.addEventListener("click", () => partagerLien(lienExperience(id), trField(v, "Nom"), $("#fiche-partager-note")));
  attachMontantChips("");
  RESA = null;
  afficherSeances(id, guide);
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
   RÉSERVATION (visites, ateliers, soirées)
   Les dates et les places viennent de Supabase (vue publique
   seances_publiques, jamais en cache). Le paiement, l'annulation et
   le lien personnel passent par les fonctions Netlify « reserver »
   et « reservation ». Les prix affichés ici ne sont qu'indicatifs :
   le montant payé est toujours recalculé par la base.
   ============================================================ */

const RESA_TYPES = ["visite_guidee", "atelier", "soiree"];
const LANGUE_SEANCE = { fr: "français", en: "english", es: "español", zh: "中文", ar: "العربية", ru: "русский" };
let RESA = null;   // { exp, seances, seance, personnes, guide, adherent: { valide_jusqua } | null }

async function supa(chemin) {
  const res = await fetch(CONFIG.supabase.url + "/rest/v1/" + chemin, {
    headers: { apikey: CONFIG.supabase.cle }, cache: "no-store",
  });
  if (!res.ok) throw new Error("Supabase " + res.status);
  return res.json();
}
function localeResa() {
  return ({ fr: "fr-FR", en: "en-GB", es: "es-ES", zh: "zh-CN", ar: "ar", ru: "ru-RU" })[getLang()] || "fr-FR";
}
function euros(c) {
  return new Intl.NumberFormat(localeResa(), { style: "currency", currency: "EUR",
    minimumFractionDigits: (c || 0) % 100 ? 2 : 0 }).format((c || 0) / 100);
}
function tx(cle, vars) {
  let s = t(cle);
  Object.keys(vars || {}).forEach((k) => { s = s.split("{" + k + "}").join(vars[k]); });
  return s;
}
function heureResa(iso) {
  return new Date(iso).toLocaleTimeString(localeResa(), { timeZone: "Europe/Paris", hour: "2-digit", minute: "2-digit" });
}
function dateLongueResa(iso) {
  return new Date(iso).toLocaleDateString(localeResa(), { timeZone: "Europe/Paris", weekday: "long", day: "numeric", month: "long" }) +
    ", " + heureResa(iso);
}
const estVisiteResa = (type) => type === "visite_guidee" || type === "atelier" || type === "escape_game";   // escape game daté (22/11) : comme une visite
const titreResa = (o) => (o && (o[getLang()] || o.fr)) || "";

/** Sur la fiche : les prochaines dates, si l'expérience est réservable dans Supabase. */
async function afficherSeances(slug, guideNom) {
  const zone = $("#visite-seances");
  if (!zone) return;
  let exp;
  try {
    exp = (await supa("experiences?select=id,type,titre,prix_centimes,prereservation_centimes,frais_annulation_tardive_centimes,telephone_obligatoire,age_minimum" +
      "&slug=eq." + encodeURIComponent(slug) + "&publie=eq.true&actif=eq.true"))[0];
  } catch (e) { return; }                        // hors ligne ou pas encore dans la base : la fiche reste comme avant
  if (!exp || !RESA_TYPES.includes(exp.type) || exp.prix_centimes == null) return;
  let seances = [];
  try {
    seances = await supa("seances_publiques?select=*&experience_id=eq." + exp.id + "&statut=eq.publiee&debut=gt." +
      encodeURIComponent(new Date().toISOString()) + "&order=debut.asc&limit=12");
  } catch (e) { /* liste vide */ }
  $$("#visite-body .cta-externe").forEach((el) => el.remove());   // l'ancien lien externe laisse place à la réservation
  RESA = { exp, seances, seance: seances.find((s) => s.places_restantes > 0) || null, personnes: 1, guide: guideNom || "", slug };
  peindreSeances();
}

function seanceHtml(s, choisie) {
  const d = new Date(s.debut);
  const jour = d.toLocaleDateString(localeResa(), { timeZone: "Europe/Paris", weekday: "short" });
  const num = d.toLocaleDateString(localeResa(), { timeZone: "Europe/Paris", day: "numeric" });
  const mois = d.toLocaleDateString(localeResa(), { timeZone: "Europe/Paris", month: "short" });
  const complet = s.places_restantes <= 0;
  let etat, barre = "";
  if (complet) etat = t("resa.full");
  else if (s.confirmee || !estVisiteResa(RESA.exp.type)) {
    etat = (estVisiteResa(RESA.exp.type) ? t("resa.confirmed") + " · " : "") + tx("resa.left", { n: s.places_restantes, max: s.capacite_max });
  } else {
    etat = tx("resa.toGo", { n: s.inscrits, min: s.participants_min });
    barre = '<span class="seance-barre" aria-hidden="true"><span style="inline-size:' +
      Math.min(100, Math.round(100 * s.inscrits / s.participants_min)) + '%"></span></span>';
  }
  return '<button type="button" class="seance' + (choisie ? " choisie" : "") + '" data-seance="' + esc(s.id) + '"' +
    (complet ? " disabled" : "") + ' aria-pressed="' + (choisie ? "true" : "false") + '">' +
    '<span class="seance-jour"><span>' + esc(jour) + '</span><b>' + esc(num) + '</b><span>' + esc(mois) + '</span></span>' +
    '<span class="seance-info"><span class="seance-heure">' + esc(heureResa(s.debut)) + ' · ' + esc(LANGUE_SEANCE[s.langue] || s.langue) + '</span>' +
    '<span class="seance-etat">' + esc(etat) + '</span>' + barre + '</span></button>';
}

/* Prix (modèle 5 €, v2) : visites et ateliers sont réservés aux adhérents. Le prix
   affiché est le prix net réglé sur place à l'intervenant (prix de la séance, sinon celui
   de l'expérience). En ligne : 0 € pour un adhérent, sinon l'adhésion (5 € par an,
   une seule fois, quel que soit le nombre de personnes). */
const ADHESION_CENTIMES = 500;
function unitaireResa() {
  const e = RESA.exp, s = RESA.seance;
  if (s && s.prix_centimes != null) return s.prix_centimes;   // prix net de la séance (vue seances_publiques, 22/11)
  if (!estVisiteResa(e.type)) return e.prix_centimes;
  return e.prix_centimes - (e.prereservation_centimes || 0);   // anciennes fiches : prix net
}
const estAdherentResa = () => !!(RESA && RESA.adherent);
const pourAdherentsResa = () => estVisiteResa(RESA.exp.type) || !!(RESA.seance && RESA.seance.reservee_adherents);
const aPayerResa = () => estVisiteResa(RESA.exp.type) ? 0 : unitaireResa() * RESA.personnes;
const guideResa = () => RESA.guide ? tx("resa.to", { g: RESA.guide }) : "";

/** Sur la fiche (E2.2, E3) : prix net, « Réservez votre place pour 5 € », « Déjà adhérent : 0 € ». */
function prixHtml() {
  const e = RESA.exp, n = RESA.personnes, u = unitaireResa(), total = u * n;
  if (!estVisiteResa(e.type)) {
    return '<div class="resa-prix"><div class="resa-ligne"><span>' + esc(n + " × " + euros(u)) + '</span><b class="resa-gros">' + esc(euros(total)) + '</b></div>' +
      (pourAdherentsResa() ? '<p class="member-note">' + esc(t("resa.soireeAdherents")) + '</p>' : '') + '</div>';
  }
  return '<div class="resa-prix">' +
    '<div class="resa-ligne"><span>' + esc(t(e.type === "atelier" ? "resa.prixAtelier" : "resa.fullPrice")) + '<br><span class="resa-mono">' + esc(n + " × " + euros(u)) + '</span></span><b class="resa-gros">' + esc(euros(total)) + '</b></div>' +
    '<div class="resa-accent">' + esc(tx("resa.bookFor", { m: euros(ADHESION_CENTIMES) })) + '</div>' +
    '<div class="member-note">' + esc(t("resa.adhesionExplique")) + '</div>' +
    '<p class="resa-reste"><b>' + esc(tx("resa.resteAdh", { m: euros(total), g: guideResa() })) + '</b> ' + esc(t("resa.cash")) + '</p></div>';
}

function stepperHtml(idPrefix) {
  const max = RESA.seance ? Math.min(RESA.seance.places_restantes, RESA.seance.capacite_max) : 1;
  return '<div class="mini-label">' + esc(t("resa.people")) + '</div>' +
    '<div class="resa-stepper"><span>' + esc(RESA.personnes === 1 ? t("resa.person1") : tx("resa.personN", { n: RESA.personnes })) + '</span>' +
    '<span class="resa-stepper-btns"><button type="button" id="' + idPrefix + '-moins" aria-label="−"' + (RESA.personnes <= 1 ? " disabled" : "") + '>−</button>' +
    '<b aria-live="polite">' + RESA.personnes + '</b>' +
    '<button type="button" id="' + idPrefix + '-plus" aria-label="+"' + (RESA.personnes >= max ? " disabled" : "") + '>+</button></span></div>';
}
function brancherStepper(idPrefix, repeindre) {
  const m = $("#" + idPrefix + "-moins"), p = $("#" + idPrefix + "-plus");
  if (m) m.addEventListener("click", () => { RESA.personnes = Math.max(1, RESA.personnes - 1); repeindre(); });
  if (p) p.addEventListener("click", () => { RESA.personnes += 1; repeindre(); });
}

/** La carte de membre gardée sur ce téléphone (vérifiée par code ou par le paiement) est-elle valable ? */
function adhesionLocaleValide() {
  const c = carteLue();
  return !!(c && c.carte && c.email && new Date(c.carte.valide_jusqua) > new Date());
}
/** Adhérent reconnu = la carte de CE téléphone, pour SON email (jamais une adresse tapée). */
function adherentDeLaCarte() {
  if (!adhesionLocaleValide()) return null;
  const c = carteLue();
  return { valide_jusqua: c.carte.valide_jusqua, numero: c.carte.numero, email: c.email, carte: c.carte.renouvelable };
}

/** Message affiché une fois en haut des dates de la fiche (séance devenue indisponible après l'adhésion). */
let noteFiche = null;
function noteFicheHtml() {
  const n = noteFiche; noteFiche = null;
  return n ? '<div class="resa-etat">' + esc(n) + '</div>' : '';
}

function peindreSeances() {
  const zone = $("#visite-seances");
  if (!zone || !RESA) return;
  if (!RESA.seances.length) {
    zone.innerHTML = noteFicheHtml() + '<div class="mini-label">' + esc(t("resa.chooseDate")) + '</div><div class="member-note">' + esc(t("resa.noDate")) + '</div>';
    return;
  }
  if (RESA.seance) RESA.personnes = Math.min(RESA.personnes, Math.max(1, RESA.seance.places_restantes));
  const visite = estVisiteResa(RESA.exp.type);
  zone.innerHTML = noteFicheHtml() +
    '<div class="mini-label">' + esc(t(RESA.exp.type === "atelier" ? "resa.chooseSession" : "resa.chooseDate")) + '</div>' +
    '<div class="seances">' + RESA.seances.map((s) => seanceHtml(s, RESA.seance && s.id === RESA.seance.id)).join("") + '</div>' +
    (visite ? '<div class="member-note">' + esc(t(RESA.exp.type === "atelier" ? "resa.minNoteAtelier" : "resa.minNote")) + '</div>' : '') +
    (RESA.seance ? stepperHtml("fiche") + prixHtml() +
      '<button type="button" class="cta fee" id="btn-reserver">' + esc(visite
        ? (adhesionLocaleValide() ? t("resa.reserverGratuit") : tx("resa.reserverAdhesion", { m: euros(ADHESION_CENTIMES) }))
        : tx("resa.payNowBtn", { m: euros(aPayerResa()) })) + '</button>' +
      (visite ? '<div class="member-note resa-centre">' + esc(t("resa.dejaAdherent")) + '</div>' +
        '<div class="mini-label">' + esc(t("resa.bonASavoir")) + '</div><ul class="resa-bon">' +
        ["resa.bon1", "resa.bon2", RESA.exp.type === "visite_guidee" ? "resa.bon3" : ""].filter(Boolean).map((k) => '<li>' + esc(t(k)) + '</li>').join("") + '</ul>' : '') : '');
  $$("#visite-seances .seance").forEach((b) => b.addEventListener("click", () => {
    RESA.seance = RESA.seances.find((s) => s.id === b.dataset.seance); peindreSeances();
  }));
  brancherStepper("fiche", peindreSeances);
  const go = $("#btn-reserver");
  if (go) go.addEventListener("click", () => ouvrirReservation(pourAdherentsResa() && !adhesionLocaleValide() && estVisiteResa(RESA.exp.type) ? "adhesion" : "reservation"));
}

/** Textes près du bouton (CGV) : rétractation, non-remboursement, âge, photos. Pas de case en plus. */
function infosLegalesResa() {
  const e = RESA.exp;
  if (!estVisiteResa(e.type)) return '';
  return '<p class="resa-mention">' + esc(t("resa.infoRetract")) + (e.age_minimum ? ' ' + esc(tx("resa.infoAge", { n: e.age_minimum })) : '') +
    ' ' + esc(t("resa.infoPhotos")) + ' <a href="cgv.html" target="_blank" rel="noopener">' + esc(t("resa.cgvLink")) + '</a></p>';
}

/** Case 2 (réservation) : visites et ateliers ; soirée : sa case unique (E8.3), âge compris. */
function caseConditionsHtml() {
  const e = RESA.exp, lien = '<a href="cgv.html" target="_blank" rel="noopener">' + esc(t("resa.conditionsLien")) + '</a>';
  const texte = estVisiteResa(e.type)
    ? esc(t("resa.case2a")) + ' ' + lien + esc(t("resa.case2b"))
    : esc(t("resa.caseSoireeA")) + ' ' + '<a href="cgv.html" target="_blank" rel="noopener">' + esc(t("resa.cgvFull").toLowerCase()) + '</a>' +
      esc(t("resa.caseSoireeB")) + (e.age_minimum ? ' ' + esc(tx("resa.caseSoireeAge", { n: e.age_minimum })) : '');
  return '<label class="resa-case"><input type="checkbox" id="resa-c-conditions"><span>' + texte + '</span></label>';
}

/** Case 1 (adhésion) : statuts, règlement, politique de confidentialité. */
function caseAdhesionHtml(id) {
  const l = CONFIG.liens || {};
  const lien = (url, k) => url ? '<a href="' + esc(url) + '" target="_blank" rel="noopener">' + esc(t(k)) + '</a>' : esc(t(k));
  return '<label class="resa-case"><input type="checkbox" id="' + id + '"><span>' + esc(t("adh.case1a")) + ' ' +
    lien(l.statuts, "adh.statuts") + esc(t("adh.case1b")) + ' ' + lien(l.reglement, "adh.reglement") + ' ' + esc(t("adh.case1c")) + ' ' +
    lien(l.confidentialite, "adh.confidentialite") + '.</span></label>';
}

const appelReserver = (corps) => fetch("/.netlify/functions/reserver", { method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify(corps) }).then(async (r) => ({ ok: r.ok, status: r.status, d: await r.json().catch(() => ({})) }));
const erreurResa = (d) => d.code === "COMPLET" ? t("resa.err.full") : d.code === "SEANCE_INDISPONIBLE" ? t("resa.err.gone")
  : ["PARAMETRES", "TELEPHONE_REQUIS"].includes(d.code) ? t("resa.err.form")
  : ["CONDITIONS_NON_ACCEPTEES", "ACCORD_ADHESION"].includes(d.code) ? t("resa.err.cgv") : t("resa.err.pay");

/** Fin de réservation : confirmation tout de suite (carte de l'adhésion), sinon Stripe. */
function suiteResa(d, note) {
  if (d.url) { window.location.href = d.url; return true; }
  if (d.jeton && d.reservation) {
    try { localStorage.removeItem("resaEnCours"); } catch (e) { /* rien */ }
    peindreReservation(d.reservation, d.jeton, d.reservation.statut === "confirmee" ? t("resa.ok.title") : null, nouvelAdherentLu());
    showScreen("reservation");
    return true;
  }
  if (note) note.textContent = t("resa.err.pay");
  return false;
}

/** Écran de réservation. mode : « adhesion » (E8.0), « reservation » (E8.1, E8.2, soirée),
    « finaliser » (retour du paiement de l'adhésion : la place retenue devient une réservation). */
function ouvrirReservation(mode) {
  if (!RESA || !RESA.seance) return;
  const e = RESA.exp, s = RESA.seance, visite = estVisiteResa(e.type);
  if ($("#screen-reserver")) $("#screen-reserver").dataset.offre = offreDeResa(e.type);
  const champs = (window.__resaChamps = window.__resaChamps || { nom: "", email: "", tel: "" });
  RESA.mode = mode || "reservation";
  if (RESA.mode !== "finaliser") {
    RESA.adherent = adherentDeLaCarte();
    if (RESA.adherent && !champs.email) champs.email = RESA.adherent.email;
    if (RESA.adherent && !champs.nom && (carteLue().carte || {}).nom) champs.nom = carteLue().carte.nom;
  }
  const resume = (avecPersonnes) => '<div class="resa-resume"><b>' + esc(titreResa(e.titre)) + (RESA.guide && visite ? esc(tx("resa.avec", { g: RESA.guide })) : '') + '</b><span>' + esc(dateLongueResa(s.debut)) +
    (avecPersonnes ? " · " + (RESA.personnes === 1 ? t("resa.person1") : tx("resa.personN", { n: RESA.personnes })) : '') + '</span>' +
    (avecPersonnes ? '' : '<span>' + esc((LANGUE_SEANCE[s.langue] || s.langue) + (s.point_rdv ? " · " + s.point_rdv : "")) + '</span>') + '</div>';
  const champsHtml = () =>
    '<label class="resa-champ"><span>' + esc(t("resa.name")) + '</span><input class="input-field" id="resa-nom" autocomplete="name" required value="' + esc(champs.nom) + '"></label>' +
    '<label class="resa-champ"><span>' + esc(t("resa.email")) + '</span><input class="input-field" id="resa-email" type="email" inputmode="email" autocomplete="email" required value="' + esc(champs.email) + '"></label>' +
    '<label class="resa-champ"><span>' + esc(e.telephone_obligatoire || visite ? t("resa.phone") : t("resa.phoneOpt")) + '</span><input class="input-field" id="resa-tel" type="tel" inputmode="tel" autocomplete="tel"' + (e.telephone_obligatoire ? " required" : "") + ' value="' + esc(champs.tel) + '"></label>';
  const garder = () => {
    champs.nom = ($("#resa-nom") || {}).value || champs.nom;
    champs.email = ($("#resa-email") || {}).value || champs.email;
    champs.tel = ($("#resa-tel") || {}).value || champs.tel;
  };
  const champsValides = () => {
    const email = champs.email.trim().toLowerCase();
    return champs.nom.trim() && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && (!e.telephone_obligatoire || champs.tel.trim().length >= 6);
  };
  const sous = (k, vars) => { const el = $("#screen-reserver .back-sub"); if (el) el.textContent = tx(k, vars || {}); };

  // ---- E8.0 : adhésion (place retenue 15 minutes pendant le paiement) ----
  const peindreAdhesion = () => {
    sous("resa.sousAdhesion");
    $("#reserver-body").innerHTML = resume(true) +
      '<div class="adh-prix"><b>' + esc(euros(ADHESION_CENTIMES)) + '</b><span>' + esc(t("adh.parAn")) + '</span></div>' +
      '<p class="adh-phrase">' + esc(t("adh.phrase")) + '</p>' +
      '<p class="member-note">' + esc(t("adh.deja")) + ' <button type="button" class="lien-bouton" id="adh-connecter">' + esc(t("adh.meConnecter")) + '</button></p>' +
      '<form id="adh-form" novalidate>' + champsHtml() + caseAdhesionHtml("adh-c-statuts") + caseConditionsHtml() + infosLegalesResa() +
        '<button type="submit" class="cta fee" id="adh-payer">' + esc(tx("adh.payer", { m: euros(ADHESION_CENTIMES) })) + '</button>' +
        '<div id="resa-note" class="resa-erreur" role="alert"></div>' +
        '<div class="member-note resa-centre">' + esc(t("adh.renouvelee")) + '<br>' + esc(t("adh.securise")) + '</div>' +
      '</form>';
    $("#adh-connecter").addEventListener("click", () => { garder(); RESA.codeDemande = true; ouvrirReservation("reservation"); });
    $("#adh-form").addEventListener("submit", async (ev) => {
      ev.preventDefault(); garder();
      const note = $("#resa-note"), btn = $("#adh-payer");
      if (!champsValides()) { note.textContent = t("resa.err.form"); return; }
      if (!$("#adh-c-statuts").checked || !$("#resa-c-conditions").checked) { note.textContent = t("resa.err.cgv"); return; }
      btn.disabled = true; note.textContent = "";
      try {
        const { ok, d } = await appelReserver({ action: "adhesion", seance_id: s.id, personnes: RESA.personnes, nom: champs.nom.trim(),
          email: champs.email.trim().toLowerCase(), telephone: champs.tel.trim(), langue: getLang(), accord_adhesion: true,
          consentements: { conditions: true } });
        if (ok && d.url) {
          try {
            localStorage.setItem("resaEnCours", JSON.stringify({ reservation_id: d.reservation_id, exp: e, seance: s, personnes: RESA.personnes,
              guide: RESA.guide, slug: RESA.slug || "", champs: { nom: champs.nom, email: champs.email, tel: champs.tel }, bloque_jusqua: d.bloque_jusqua,
              conditions: true }));
          } catch (err) { /* sans stockage : l'adhésion est faite, la réservation sera à refaire */ }
          window.location.href = d.url; return;
        }
        if (d.code === "DEJA_ADHERENT") { RESA.codeDemande = true; ouvrirReservation("reservation"); return; }
        note.textContent = erreurResa(d);
      } catch (err) { note.textContent = t("resa.err.pay"); }
      btn.disabled = false;
    });
  };

  // ---- E8.1, E8.2 (adhérent, 0 € maintenant) et soirée ----
  const peindre = () => {
    const finaliser = RESA.mode === "finaliser";
    if (finaliser && RESA.bloqueJusqua) {
      const reste = Math.max(0, Math.round((new Date(RESA.bloqueJusqua) - Date.now()) / 1000));
      sous("resa.sousRetenu", { t: Math.floor(reste / 60) + ":" + String(reste % 60).padStart(2, "0") });
    } else sous("resa.sub");
    const n = RESA.personnes, u = unitaireResa(), total = u * n;
    const adh = RESA.adherent;
    const carteInfo = adh && adh.carte
      ? '<div class="resa-carte-adh"><b>' + esc(t("resa.carteAdhesion")) + '</b><span>' + esc(t("resa.aucunDebit")) + '</span></div>'
      : '<div class="resa-carte-adh"><b>' + esc(t("resa.carteAEnregistrer")) + '</b><span>' + esc(t("resa.aucunDebit")) + '</span></div>';
    $("#reserver-body").innerHTML = resume(false) +
      (finaliser ? '' : stepperHtml("form")) +
      '<div class="member-note">' + esc(tx("resa.holdLeft", { n: s.places_restantes, max: s.capacite_max })) + '</div>' +
      (e.type === "atelier" ? '<div class="resa-min"><b>' + esc(tx("resa.atelierMin", { n: s.participants_min })) + '</b><span>' +
        esc(t("resa.atelierMinNote")) + '</span></div>' : '') +
      '<form id="resa-form" novalidate>' +
        '<div class="mini-label">' + esc(t("resa.contact")) + '</div>' + champsHtml() +
        (visite && adh ? '<div class="resa-adherent"><span class="resa-adh-titre">' + esc(t("resa.adhReconnu")) + '</span><span class="member-note">' +
          esc((adh.numero ? tx("resa.carteNo", { n: adh.numero }) + " · " : "") + tx("resa.valableJusqua", { date: new Date(adh.valide_jusqua).toLocaleDateString(localeResa(), { timeZone: "Europe/Paris" }) })) + '</span></div>' : '') +
        (visite && !adh ? '<p class="member-note resa-indice">' + esc(t("resa.adhHint1")) + ' <b>' + esc(t("resa.adhHintB")) + '</b>' + esc(t("resa.adhHintC")) + '</p>' : '') +
        (visite
          ? '<div class="resa-prix resa-prix-form">' +
              '<div class="resa-ligne"><span>' + esc(t(e.type === "atelier" ? "resa.prixAtelier" : "resa.fullPrice")) + '<br><span class="resa-mono">' + esc(n + " × " + euros(u)) +
                '</span></span><b class="resa-gros">' + esc(euros(total)) + '</b></div>' +
              '<p class="resa-reste"><b>' + esc(tx("resa.resteAdh", { m: euros(total), g: guideResa() })) + '</b> ' + esc(t("resa.cash")) + '</p>' +
              (e.frais_annulation_tardive_centimes > 0 ? carteInfo : '') +
              '<div class="resa-ligne resa-total"><span>' + esc(t("resa.total")) + '</span><b>' + esc(euros(0)) + '</b></div></div>'
          : prixHtml() + '<div class="resa-ligne resa-total"><span>' + esc(t("resa.totalSoiree")) + '</span><b>' + esc(euros(aPayerResa())) + '</b></div>' +
            '<div class="member-note">' + esc(t("resa.vat")) + '</div>') +
        (RESA.codeDemande ? panneauCodeHtml() : '') +
        caseConditionsHtml() + infosLegalesResa() +
        '<button type="submit" class="cta fee" id="resa-payer">' + esc(visite ? t("resa.btnGratuit") : tx("resa.payer", { m: euros(aPayerResa()) })) + '</button>' +
        '<div id="resa-note" class="resa-erreur" role="alert"></div>' +
        '<div class="member-note resa-centre">' + esc(visite ? t("resa.aucunDebit") : t("resa.m.secure")) + '</div>' +
      '</form>';
    if (!finaliser) brancherStepper("form", () => { garder(); peindre(); });
    // L'email d'une carte enregistrée ne se change pas ici (« Utiliser une autre adresse » sur la carte de membre).
    if (adh && !finaliser && $("#resa-email")) $("#resa-email").readOnly = true;
    if (RESA.codeDemande) brancherCode();
    $("#resa-form").addEventListener("submit", envoyer);
    $$("#resa-form input").forEach((i) => i.addEventListener("input", () => { $("#resa-note").textContent = ""; }));
  };

  /* « Déjà adhérent ? Me connecter » ou adresse d'adhérent sans carte sur ce téléphone :
     code reçu par email, puis la carte est enregistrée et la réservation continue en adhérent. */
  const panneauCodeHtml = () => '<div class="resa-code" id="resa-code"><b>' + esc(t("resa.codeTitre")) + '</b>' +
    '<p class="member-note">' + esc(t("resa.codeTexte")) + '</p>' +
    '<button type="button" class="cta ghost" id="resa-code-envoyer">' + esc(t("member.recevoirCode")) + '</button>' +
    '<div id="resa-code-saisie" hidden><label class="resa-champ"><span>' + esc(t("member.codeLabel")) + '</span>' +
    '<input class="input-field mb-code" id="resa-code-valeur" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="000000"></label>' +
    '<button type="button" class="cta fee" id="resa-code-valider">' + esc(t("resa.codeValider")) + '</button></div>' +
    '<div class="member-note" id="resa-code-note" role="status"></div></div>';
  const brancherCode = () => {
    const note = $("#resa-code-note");
    $("#resa-code-envoyer").addEventListener("click", async () => {
      garder();
      const email = champs.email.trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { note.textContent = t("member.emailInvalid"); return; }
      note.textContent = t("member.loading");
      const etat = await demanderCode(email).catch(() => "erreur");
      note.textContent = messageEnvoiCode(etat);
      if (etat === "envoye") $("#resa-code-saisie").hidden = false;
    });
    $("#resa-code-valider").addEventListener("click", async () => {
      garder();
      note.textContent = t("member.loading");
      const r = await validerCode(champs.email.trim().toLowerCase(), $("#resa-code-valeur").value).catch(() => ({ ok: false, message: t("member.error") }));
      if (!r.ok) { note.textContent = r.message; return; }
      RESA.codeDemande = false;
      ouvrirReservation("reservation");
    });
  };

  const envoyer = async (ev) => {
    ev.preventDefault(); garder();
    const note = $("#resa-note"), btn = $("#resa-payer");
    if (!champsValides()) { note.textContent = t("resa.err.form"); return; }
    if (!$("#resa-c-conditions").checked) { note.textContent = t("resa.err.cgv"); return; }
    btn.disabled = true; note.textContent = "";
    const commun = { nom: champs.nom.trim(), email: champs.email.trim().toLowerCase(), telephone: champs.tel.trim(), langue: getLang(),
      consentements: { conditions: true }, jeton: (carteLue() || {}).jeton };
    try {
      const { ok, d } = await appelReserver(RESA.mode === "finaliser"
        ? Object.assign({ action: "finaliser", reservation_id: RESA.reservationId }, commun)
        : Object.assign({ seance_id: s.id, personnes: RESA.personnes }, commun));
      if (ok && suiteResa(d, note)) return;
      if (RESA.mode === "finaliser" && ["COMPLET", "SEANCE_INDISPONIBLE", "RESERVATION_INTROUVABLE"].includes(d.code)) {
        try { localStorage.removeItem("resaEnCours"); localStorage.removeItem("nouvelAdherent"); } catch (x) { /* rien */ }
        noteFiche = t("resa.apresAdhesionIndispo");
        if (RESA.slug) { openTarget("visite", RESA.slug); return; }
        note.textContent = noteFiche; noteFiche = null;
        btn.disabled = false; return;
      }
      if (d.code === "ADHESION_REQUISE" && estVisiteResa(e.type)) { ouvrirReservation("adhesion"); return; }
      if (d.code === "VERIFICATION_REQUISE") { RESA.codeDemande = true; peindre(); $("#resa-code").scrollIntoView({ block: "center" }); return; }
      note.textContent = d.code === "ADHESION_REQUISE" ? t("resa.err.adhesion") : erreurResa(d);
    } catch (err) { note.textContent = t("resa.err.pay"); }
    btn.disabled = false;
  };

  if (RESA.mode === "adhesion") peindreAdhesion(); else peindre();
  // La carte d'abonnement (pour l'affichage « Carte de votre adhésion ») : demandée avec le jeton, jamais avec un email tapé.
  if (RESA.adherent && RESA.mode !== "adhesion" && (carteLue() || {}).jeton) {
    appelReserver({ action: "adherent", jeton: carteLue().jeton }).then(({ ok, d }) => {
      if (!ok || !d.adherent || !RESA.adherent || RESA.mode === "adhesion") return;
      const avant = RESA.adherent.carte;
      Object.assign(RESA.adherent, { carte: d.carte, numero: d.numero || RESA.adherent.numero });
      if (avant !== d.carte && $("#resa-form")) { garder(); peindre(); }
    }).catch(() => {});
  }
  showScreen("reserver");
}

/** Retour du paiement de l'adhésion avec une place retenue (?adhesion=cs_…&resa=…) : la réservation continue (E8.1). */
async function reprendreReservationApresAdhesion(reservationId, carte) {
  let ctx = null;
  try { ctx = JSON.parse(localStorage.getItem("resaEnCours") || "null"); } catch (e) { ctx = null; }
  if (!ctx || ctx.reservation_id !== reservationId) return false;
  RESA = { exp: ctx.exp, seances: [ctx.seance], seance: ctx.seance, personnes: ctx.personnes, guide: ctx.guide || "", slug: ctx.slug || "",
    reservationId, bloqueJusqua: ctx.bloque_jusqua,
    adherent: { valide_jusqua: carte && carte.valide_jusqua, numero: carte && carte.numero, carte: true } };
  try {
    localStorage.setItem("nouvelAdherent", JSON.stringify({ reservation_id: reservationId, valide_jusqua: (carte && carte.valide_jusqua) || null,
      participants_min: (ctx.seance && ctx.seance.participants_min) || null, le: Date.now() }));
  } catch (e) { /* sans stockage : confirmation habituelle */ }
  window.__resaChamps = Object.assign({ nom: "", email: "", tel: "" }, ctx.champs || {});
  if (ctx.conditions && await finaliserApresAdhesion()) return true;
  ouvrirReservation("finaliser");   // repli : la case est demandée ici (ancien parcours, ou erreur passagère)
  return true;
}

/** La place retenue devient une réservation dès le retour du paiement de l'adhésion, sans autre étape.
    true : c'est réglé (confirmation, ou retour à la fiche si la séance n'est plus disponible). */
async function finaliserApresAdhesion() {
  const champs = window.__resaChamps || {};
  showScreen("reservation");
  if ($("#screen-reservation")) $("#screen-reservation").dataset.offre = offreDeResa(RESA.exp.type);
  $("#reservation-body").innerHTML = '<div class="loading">' + esc(t("member.loading")) + '</div>';
  try {
    const { ok, d } = await appelReserver({ action: "finaliser", reservation_id: RESA.reservationId, nom: String(champs.nom || "").trim(),
      email: String(champs.email || "").trim().toLowerCase(), telephone: String(champs.tel || "").trim(), langue: getLang(),
      consentements: { conditions: true }, jeton: (carteLue() || {}).jeton });
    RESA.mode = "finaliser";
    if (ok && suiteResa(d, null)) return true;
    if (["COMPLET", "SEANCE_INDISPONIBLE", "RESERVATION_INTROUVABLE"].includes(d.code)) {
      try { localStorage.removeItem("resaEnCours"); localStorage.removeItem("nouvelAdherent"); } catch (x) { /* rien */ }
      noteFiche = t("resa.apresAdhesionIndispo");
      if (RESA.slug) { openTarget("visite", RESA.slug); return true; }
    }
  } catch (e) { /* repli sur le formulaire */ }
  return false;
}

/** Adhésion payée dans ce parcours de réservation (moins d'une heure) : lue une seule fois. */
function nouvelAdherentLu() {
  let n = null;
  try { n = JSON.parse(localStorage.getItem("nouvelAdherent") || "null"); localStorage.removeItem("nouvelAdherent"); } catch (e) { n = null; }
  return n && Date.now() - (n.le || 0) < 3600e3 ? n : null;
}

/** Paiement de l'adhésion abandonné (?reservation_abandonnee=1&resa=…) : la place retenue est libérée,
    retour à l'étape de l'adhésion (E8.0) avec un message. Rien n'a été payé, aucun compte n'est créé. */
async function reprendreApresAbandonAdhesion(reservationId) {
  let ctx = null;
  try { ctx = JSON.parse(localStorage.getItem("resaEnCours") || "null"); } catch (e) { ctx = null; }
  if (!ctx || ctx.reservation_id !== reservationId) return false;
  try { localStorage.removeItem("resaEnCours"); } catch (e) { /* rien */ }
  appelReserver({ action: "abandonner", reservation_id: reservationId }).catch(() => {});   // place libérée tout de suite
  RESA = { exp: ctx.exp, seances: [ctx.seance], seance: ctx.seance, personnes: ctx.personnes, guide: ctx.guide || "", slug: ctx.slug || "" };
  window.__resaChamps = Object.assign({ nom: "", email: "", tel: "" }, ctx.champs || {});
  ouvrirReservation("adhesion");
  const note = $("#resa-note");
  if (note) note.textContent = t("resa.adhAbandon");
  return true;
}

/** Type d'affichage (couleurs du thème) d'une expérience Supabase : visite, atelier, diner (soirée) ou escape. */
function offreDeResa(type) {
  const k = String(type || "");
  return /atelier/.test(k) ? "atelier" : /soiree/.test(k) ? "diner" : /escape/.test(k) ? "escape" : "visite";
}

/** Bloc « Adhésion active » de la confirmation d'un nouvel adhérent (E9.1b, E9.2b).
    La date de fin vient de la carte (période de l'abonnement Stripe), jamais calculée ici. */
function blocNouvelAdherentHtml(fin) {
  if (!fin) return '<div class="resa-adh-nouvelle" id="resa-adh-nouvelle"><div class="resa-adh-eyebrow">' + esc(t("resa.adhEnCours")) + '</div>' +
    '<p class="member-note">' + esc(t("resa.adhEnCoursTexte")) + '</p></div>';
  const date = new Date(fin).toLocaleDateString(localeResa(), { timeZone: "Europe/Paris", day: "numeric", month: "long", year: "numeric" });
  return '<div class="resa-adh-nouvelle" id="resa-adh-nouvelle"><div class="resa-adh-eyebrow">' + esc(t("resa.adhActiveEyebrow")) + '</div>' +
    '<h2>' + esc(t("resa.adhVousEtes")) + '</h2>' +
    '<p>' + esc(tx("resa.adhValable", { date })) + '</p>' +
    '<p class="member-note">' + esc(t("resa.adhFacture")) + '</p>' +
    '<button type="button" class="lien-bouton resa-adh-carte" data-open="membre">' + esc(t("resa.adhVoirCarte")) + ' ›</button></div>';
}

/** Activation pas encore visible (webhook en retard) : l'état est relu quelques fois, puis le bloc se met à jour. */
function suivreActivation(essai) {
  const bloc = $("#resa-adh-nouvelle");
  const c = carteLue();
  if (!bloc || !c || !c.jeton || essai > 12) return;
  setTimeout(async () => {
    try {
      const v = await appelCarte({ action: "voir", jeton: c.jeton });
      if (v.status === 200 && v.data.carte && v.data.carte.valide_jusqua && new Date(v.data.carte.valide_jusqua) > new Date()) {
        carteEcrite({ jeton: c.jeton, carte: v.data.carte, email: v.data.email || c.email, maj: Date.now() });
        if ($("#resa-adh-nouvelle")) $("#resa-adh-nouvelle").outerHTML = blocNouvelAdherentHtml(v.data.carte.valide_jusqua);
        return;
      }
    } catch (e) { /* on réessaie */ }
    suivreActivation(essai + 1);
  }, 5000);
}

/** Écran E9 : confirmation, ou page du lien personnel (« Je ne peux plus venir »).
    nouvel : adhésion payée dans ce parcours ({ valide_jusqua, participants_min }) → E9.1b / E9.2b. */
function peindreReservation(r, jeton, intro, nouvel) {
  const corps = $("#reservation-body");
  if ($("#screen-reservation")) $("#screen-reservation").dataset.offre = offreDeResa(r && r.type);
  if (!r) { corps.innerHTML = '<div class="member-note">' + esc(intro || t("resa.linkInvalid")) + '</div>' + boutonAccueilResa(); return; }
  nouvel = nouvel && r.statut === "confirmee" && estVisiteResa(r.type) ? nouvel : null;
  const lignes = [
    [t("resa.date"), r.debut ? dateLongueResa(r.debut) : ""], [t("resa.people"), String(r.personnes)],
    [t("resa.host"), r.intervenant], [t("resa.meet"), r.point_rdv_precis || r.point_rdv],
    nouvel ? [t("resa.paid"), euros(ADHESION_CENTIMES), t("resa.adhUneFois")] : [t("resa.paid"), euros(r.paye_en_ligne_centimes || 0)],
    [t("resa.ref"), r.reference],
  ].filter((l) => l[1]);
  const atelier = r.type === "atelier";
  const texteIntro = nouvel
    ? tx(atelier ? "resa.nouvelIntroAtelier" : "resa.nouvelIntro", { m: euros(r.reste_sur_place_centimes || 0),
        g: r.intervenant || t(atelier ? "resa.lArtiste" : "resa.leGuide") }) +
      (atelier ? " " + tx("resa.nouvelAtelierMin", { n: nouvel.participants_min || 4 }) : " " + t("resa.ok.text"))
    : t("resa.ok.text");
  let etat = "";
  if (r.statut === "annulee" || r.statut === "remboursee") {
    etat = '<div class="resa-etat">' + esc(r.seance_statut === "annulee" ? t("resa.sessionCancelled")
      : r.frais_centimes > 0 ? tx("resa.cancelledFee", { m: euros(r.frais_centimes) }) : t("resa.cancelled")) + '</div>';
  }
  corps.innerHTML =
    (intro ? '<div class="resa-ok"><span aria-hidden="true">✓</span><h1>' + esc(intro) + '</h1><p>' + esc(texteIntro) + '</p></div>' : '') +
    etat +
    '<div class="resa-carte"><b class="resa-titre">' + esc(titreResa(r.titre)) + '</b>' +
      lignes.map((l) => '<div class="info-row"><span class="k">' + esc(l[0]) + (l[2] ? '<small class="resa-k-sous">' + esc(l[2]) + '</small>' : '') + '</span><span class="v">' + esc(l[1]) + '</span></div>').join("") +
      (estVisiteResa(r.type) && r.reste_sur_place_centimes > 0 && r.statut === "confirmee"
        ? '<p class="resa-reste"><b>' + esc(tx("resa.restOnSite", { m: euros(r.reste_sur_place_centimes), g: r.intervenant ? tx("resa.to", { g: r.intervenant }) : "" })) + '</b> ' + esc(t("resa.cash")) + '</p>' : '') +
      (estVisiteResa(r.type) && r.statut === "confirmee" ? '<p class="member-note">' + esc(t("resa.annulationRegle")) + '</p>' : '') +
      (r.message_inscrits && r.statut === "confirmee" ? '<p class="member-note">« ' + esc(r.message_inscrits) + ' »</p>' : '') +
    '</div>' +
    (nouvel ? blocNouvelAdherentHtml(nouvel.valide_jusqua) : '') +
    (r.absent ? '<div class="resa-etat">' + esc(r.absence_contestee ? t("resa.absenceContestee")
      : r.absence_contestable ? tx("resa.absenceSignalee", { m: euros(r.frais_centimes || 0) }) : t("resa.absenceNotee")) + '</div>' : '') +
    (r.absence_contestable ? '<button type="button" class="cta fee" id="resa-present">' + esc(t("resa.present")) + '</button><div class="resa-erreur" id="resa-present-note" role="alert"></div>' : '') +
    (r.peut_annuler ? '<button type="button" class="cta ghost" id="resa-annuler">' + esc(t("resa.cancelBtn")) + '</button><div id="resa-annuler-zone"></div>' : '') +
    boutonAccueilResa() +
    (r.statut === "confirmee" ? '<p class="resa-don">' + esc(t("resa.donQuestion")) + ' <a href="' + esc(CONFIG.liens.don) + '" target="_blank" rel="noopener">' +
      esc(t("compte.soutenir")) + '</a></p>' : '');
  if (nouvel && !nouvel.valide_jusqua) suivreActivation(0);
  const pr = $("#resa-present");
  if (pr) pr.addEventListener("click", async () => {
    pr.disabled = true;
    try {
      const res = await fetch("/.netlify/functions/reservation", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "present", jeton }) });
      const d = await res.json().catch(() => ({}));
      if (res.ok && d.reservation) { peindreReservation(d.reservation, jeton); return; }
      $("#resa-present-note").textContent = t("resa.err.pay");
    } catch (e) { $("#resa-present-note").textContent = t("resa.err.pay"); }
    pr.disabled = false;
  });
  const b = $("#resa-annuler");
  if (b) b.addEventListener("click", () => {
    $("#resa-annuler-zone").innerHTML =
      '<div class="member-note">' + esc(r.frais_si_annulation_centimes > 0 ? tx("resa.cancelFee", { m: euros(r.frais_si_annulation_centimes) }) : t("resa.cancelFree")) + '</div>' +
      '<button type="button" class="cta fee" id="resa-annuler-ok">' + esc(t("resa.cancelSure")) + '</button><div class="resa-erreur" id="resa-annuler-note" role="alert"></div>';
    $("#resa-annuler-ok").addEventListener("click", async (ev) => {
      ev.target.disabled = true;
      try {
        const res = await fetch("/.netlify/functions/reservation", { method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action: "annuler", jeton }) });
        const d = await res.json().catch(() => ({}));
        if (res.ok && d.reservation) { peindreReservation(d.reservation, jeton); return; }
        $("#resa-annuler-note").textContent = t("resa.err.pay");
      } catch (e) { $("#resa-annuler-note").textContent = t("resa.err.pay"); }
      ev.target.disabled = false;
    });
  });
}
const boutonAccueilResa = () => '<button type="button" class="cta ghost" data-back>' + esc(t("resa.back")) + '</button>';

/** Retour de Stripe (?reservation=cs_…), paiement interrompu, ou lien de l'email (#reservation=…). */
async function handleReservationRetour() {
  const params = new URLSearchParams(window.location.search);
  const session = params.get("reservation");
  const abandon = params.has("reservation_abandonnee");
  const m = (window.location.hash || "").match(/^#reservation=([0-9a-f]{64})$/);
  if (!session && !abandon && !m) return;
  history.replaceState(null, "", window.location.pathname);    // le jeton ne reste pas dans l'adresse
  if (abandon && /^[0-9a-f-]{36}$/.test(params.get("resa") || "") && await reprendreApresAbandonAdhesion(params.get("resa"))) return;
  showScreen("reservation");
  const corps = $("#reservation-body");
  if (abandon) { corps.innerHTML = '<div class="member-note">' + esc(t("resa.abandoned")) + '</div>' + boutonAccueilResa(); return; }
  corps.innerHTML = '<div class="loading">' + esc(t("member.loading")) + '</div>';
  const appel = (corpsReq) => fetch("/.netlify/functions/reservation", { method: "POST",
    headers: { "Content-Type": "application/json" }, body: JSON.stringify(corpsReq) }).then(async (r) => ({ ok: r.ok, d: await r.json().catch(() => ({})) }));
  try {
    if (session && /^cs_(live|test)_[A-Za-z0-9]+$/.test(session)) {
      const { ok, d } = await appel({ action: "session", session_id: session });
      if (ok && d.reservation && d.reservation.statut === "confirmee") { peindreReservation(d.reservation, d.jeton, t("resa.ok.title"), nouvelAdherentLu()); return; }
      if (ok && d.reservation) { peindreReservation(d.reservation, d.jeton); return; }
      peindreReservation(null, null, t("resa.wait"));
      return;
    }
    if (m) {
      const { ok, d } = await appel({ action: "voir", jeton: m[1] });
      peindreReservation(ok ? d.reservation : null, m[1]);
    }
  } catch (e) {
    peindreReservation(null, null, t("resa.err.pay"));
  }
}

/* ============================================================
   ESPACE INTERVENANTS ET ADMINISTRATION : CONNEXION (E11)
   Connexion sans mot de passe : un lien valable 15 minutes est
   envoyé par email (Supabase Auth). Seuls les comptes créés par
   l'association peuvent se connecter (inscriptions fermées).
   Au retour, Supabase place la session dans l'adresse après « # » ;
   elle est gardée sur ce téléphone puis retirée de l'adresse.
   Les droits réels sont appliqués par la base (règles RLS) : cet
   écran ne fait qu'aiguiller vers l'espace correspondant au rôle.
   ============================================================ */

const SESSION_CLE = "sessionEspace";
let noteEspace = null;   // message à afficher au prochain affichage de l'écran
function sessionLue() {
  try { const s = JSON.parse(localStorage.getItem(SESSION_CLE) || "null"); return s && s.access_token ? s : null; }
  catch (e) { return null; }
}
function sessionEcrite(s) {
  try { if (s) localStorage.setItem(SESSION_CLE, JSON.stringify(s)); else localStorage.removeItem(SESSION_CLE); }
  catch (e) { /* stockage indisponible */ }
}

async function authAppel(chemin, opts = {}) {
  const h = Object.assign({ apikey: CONFIG.supabase.cle, "Content-Type": "application/json" }, opts.headers || {});
  const res = await fetch(CONFIG.supabase.url + chemin, { method: opts.method || "GET", headers: h,
    body: opts.body ? JSON.stringify(opts.body) : undefined, cache: "no-store" });
  let data = null;
  try { data = await res.json(); } catch (e) { /* réponse vide */ }
  return { ok: res.ok, status: res.status, data };
}

/** Session valide (renouvelée si elle expire dans moins d'une minute), ou null. */
async function sessionValide() {
  const s = sessionLue();
  if (!s) return null;
  if (s.expires_at && s.expires_at - 60 > Date.now() / 1000) return s;
  const r = await authAppel("/auth/v1/token?grant_type=refresh_token", { method: "POST", body: { refresh_token: s.refresh_token } });
  if (!r.ok || !r.data || !r.data.access_token) { sessionEcrite(null); return null; }
  const n = { access_token: r.data.access_token, refresh_token: r.data.refresh_token,
    expires_at: r.data.expires_at || Math.floor(Date.now() / 1000) + (r.data.expires_in || 3600) };
  sessionEcrite(n);
  return n;
}

/** Lecture de la base au nom de la personne connectée (les règles RLS s'appliquent). */
async function supaConnecte(chemin) {
  const s = await sessionValide();
  if (!s) throw new Error("SESSION");
  const r = await authAppel("/rest/v1/" + chemin, { headers: { Authorization: "Bearer " + s.access_token } });
  if (!r.ok) throw new Error("Supabase " + r.status);
  return r.data;
}

/** Demande du lien de connexion. Réponse identique que le compte existe ou non. */
async function demanderLienConnexion(email) {
  const retour = window.location.origin + "/";
  try {
    await authAppel("/auth/v1/otp?redirect_to=" + encodeURIComponent(retour), { method: "POST",
      body: { email, create_user: false } });
  } catch (e) { /* même message affiché */ }
}

/** Retour du lien de l'email : #access_token=… ou #error=… */
function handleConnexionRetour() {
  const h = window.location.hash || "";
  if (!/^#(access_token|error)=|&(access_token|error)=/.test(h)) return false;
  const p = new URLSearchParams(h.slice(1));
  history.replaceState(null, "", window.location.pathname);   // la session ne reste pas dans l'adresse
  if (p.get("access_token") && p.get("refresh_token")) {
    sessionEcrite({ access_token: p.get("access_token"), refresh_token: p.get("refresh_token"),
      expires_at: Number(p.get("expires_at")) || Math.floor(Date.now() / 1000) + (Number(p.get("expires_in")) || 3600) });
    openTarget("espace");
  } else {
    noteEspace = p.get("error_code") === "otp_expired" ? t("espace.expire") : t("espace.lienInvalide");
    openTarget("espace");
  }
  return true;
}

async function deconnecter() {
  const s = sessionLue();
  sessionEcrite(null);
  if (s) authAppel("/auth/v1/logout", { method: "POST", headers: { Authorization: "Bearer " + s.access_token } }).catch(() => {});
  renderEspace();
}

/** Écran de l'espace : formulaire de connexion, ou accueil selon le rôle. */
async function renderEspace(note) {
  const corps = $("#espace-body");
  if (!corps) return;
  note = note || noteEspace; noteEspace = null;
  let s = null;
  try { s = await sessionValide(); } catch (e) { s = sessionLue(); }
  if (!s) {
    corps.innerHTML =
      '<div class="cpt-eyebrow">' + esc(t("espace.sous")) + '</div>' +
      '<h1 class="espace-titre">' + esc(t("espace.titre")) + '</h1>' +
      '<p class="espace-texte">' + esc(t("espace.texte")) + '</p>' +
      (note ? '<div class="resa-etat">' + esc(note) + '</div>' : '') +
      connexionHtml("esp") +
      '<p class="espace-texte">' + esc(t("espace.pasEncore")) + ' <button type="button" class="lien-bouton" data-open="rejoindre">' + esc(t("form.nousRejoindre")) + ' →</button></p>';
    // Code bon : l'espace s'il y a un compte ; sinon (adhérent sans espace) Mon compte, avec un mot.
    brancherConnexion("esp", (d) => {
      if (d.session) { renderEspace(); return; }
      noteCompte = t("compte.pasEspace");
      openTarget("compte");
    });
    return;
  }
  corps.innerHTML = '<div class="loading">' + esc(t("member.loading")) + '</div>';
  let profil = null, nom = "";
  try {
    const user = (await authAppel("/auth/v1/user", { headers: { Authorization: "Bearer " + s.access_token } })).data || {};
    profil = (await supaConnecte("profils?select=role,intervenant_id&user_id=eq." + encodeURIComponent(user.id || "")))[0] || null;
    nom = user.email || "";
    if (profil && profil.intervenant_id) {
      const i = (await supaConnecte("intervenants?select=nom&id=eq." + encodeURIComponent(profil.intervenant_id)))[0];
      if (i) nom = i.nom;
    }
  } catch (e) {
    if (e.message === "SESSION") { renderEspace(t("espace.expire")); return; }
    corps.innerHTML = '<div class="member-note">' + esc(t("member.error")) + '</div>';
    return;
  }
  const role = profil ? profil.role : null;
  if ((role === "admin" || role === "intervenant") && typeof renderAdmin === "function") { renderAdmin(corps, nom, role, profil.intervenant_id); return; }   // js/admin.js
  corps.innerHTML =
    '<h1 class="espace-titre">' + esc(tx("espace.bonjour", { nom })) + '</h1>' +
    '<p class="espace-texte">' + esc(role === "admin" ? t("espace.admin") : role === "intervenant" ? t("espace.intervenant") : t("espace.sansRole")) + '</p>' +
    (role ? '<div class="resa-etat">' + esc(t("espace.bientot")) + '</div>' : '') +
    '<button type="button" class="cta ghost" id="espace-deconnexion">' + esc(t("espace.deconnexion")) + '</button>';
  $("#espace-deconnexion").addEventListener("click", deconnecter);
}

/* ============================================================
   CONNEXION UNIQUE (22/11) ET MON COMPTE (E15.2, E15.3)
   Un seul code à 6 chiffres par email pour tout le monde (fonction
   « carte », actions email puis code). Le serveur rend la carte de
   membre si l'adresse est adhérente, et la session de l'espace si elle a
   un compte d'intervenant ou d'association. Routage : adhérent seul →
   Mon compte ; intervenant seul → espace ; les deux → Mon compte, avec
   l'entrée « Espace intervenants ». Les emails aux intervenants
   contiennent un lien de connexion directe (#connexion=…, 7 jours).
   ============================================================ */

let noteCompte = null;   // message à afficher au prochain affichage de Mon compte

/** Formulaire de connexion par code (email, puis code). p : préfixe des identifiants. */
function connexionHtml(p) {
  return '<form class="cx-form" id="' + p + '-form" novalidate>' +
      '<label class="resa-champ"><span>' + esc(t("compte.email")) + '</span>' +
        '<input class="input-field" id="' + p + '-email" type="email" inputmode="email" autocomplete="email" placeholder="' + esc(t("compte.emailExemple")) + '" required></label>' +
      '<button type="submit" class="cta fee" id="' + p + '-envoyer">' + esc(t("compte.recevoirCode")) + '</button>' +
      '<div class="cx-code" id="' + p + '-code-zone" hidden>' +
        '<label class="resa-champ"><span>' + esc(t("compte.code")) + '</span>' +
          '<input class="input-field cx-code-champ" id="' + p + '-code" inputmode="numeric" autocomplete="one-time-code" maxlength="7"></label>' +
        '<button type="button" class="cta fee" id="' + p + '-valider">' + esc(t("compte.seConnecter")) + '</button>' +
      '</div>' +
      '<div class="member-note" id="' + p + '-note" role="status" aria-live="polite"></div>' +
    '</form>' +
    '<div class="member-note cx-aide">' + esc(t("compte.codeDuree")) + '</div>';
}

function brancherConnexion(p, quandConnecte) {
  const note = (m) => { $("#" + p + "-note").textContent = m; };
  const emailSaisi = () => ($("#" + p + "-email").value || "").trim().toLowerCase();
  $("#" + p + "-form").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const email = emailSaisi(), b = $("#" + p + "-envoyer");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { note(t("member.emailInvalid")); return; }
    b.disabled = true; note(t("member.loading"));
    try {
      const etat = await demanderCode(email);
      note(etat === "envoye" ? t("compte.codeEnvoye") : messageEnvoiCode(etat));
      if (etat === "envoye") {
        $("#" + p + "-code-zone").hidden = false; $("#" + p + "-code").focus();
        b.textContent = t("compte.renvoyerCode"); b.classList.remove("fee"); b.classList.add("ghost");
      }
    } catch (e) { note(t("member.error")); }
    b.disabled = false;
  });
  const valider = async () => {
    const email = emailSaisi(), b = $("#" + p + "-valider");
    b.disabled = true; note(t("member.loading"));
    try {
      const r = await appelCarte({ action: "code", email, code: ($("#" + p + "-code").value || "").replace(/\s/g, "") });
      if (r.status === 200) { appliquerConnexion(r.data, email); quandConnecte(r.data); return; }
      note(r.status === 400 ? t("member.codeFaux") : r.status === 429 ? t("member.codeTropEssais")
        : r.status === 410 ? t("member.codeExpire") : r.status === 404 ? t("compte.inconnu") : t("member.error"));
    } catch (e) { note(t("member.error")); }
    b.disabled = false;
  };
  $("#" + p + "-valider").addEventListener("click", valider);
  $("#" + p + "-code").addEventListener("keydown", (ev) => { if (ev.key === "Enter") { ev.preventDefault(); valider(); } });
}

/** Garde sur cet appareil la carte (adhérent) et la session de l'espace (intervenant, association). */
function appliquerConnexion(d, email) {
  if (d.jeton && d.carte) carteEcrite({ jeton: d.jeton, carte: d.carte, email: d.email || email, maj: Date.now() });
  if (d.session && d.session.access_token) sessionEcrite(d.session);
}

/** Après la connexion. vers : « espace » ou « seance » (lien d'un email aux intervenants). */
function routerApresConnexion(vers) {
  const carte = carteLue(), session = sessionLue();
  if (session && (vers === "espace" || vers === "seance" || !(carte && carte.jeton))) {
    if (typeof ADM !== "undefined") { ADM.ongletVoulu = "seances"; ADM.nouvelleSeance = vers === "seance"; }
    openTarget("espace");
    return;
  }
  openTarget("compte");
}

/** Lien de connexion directe d'un email (#connexion=…&vers=…). */
async function connexionParLien(jeton, vers) {
  showScreen("compte");
  $("#compte-body").innerHTML = '<div class="loading">' + esc(t("member.loading")) + '</div>';
  try {
    const r = await appelCarte({ action: "connexion", jeton });
    if (r.status === 200) { appliquerConnexion(r.data, r.data.email); routerApresConnexion(vers); return; }
    noteCompte = r.data && r.data.code === "UTILISE" ? t("compte.lienUtilise") : t("compte.lienExpire");
  } catch (e) { noteCompte = t("member.error"); }
  renderCompte();
}

/** « Mon compte » (E13) : carte sur cet appareil → Mon compte ; session seule → espace ; sinon connexion par code. */
function ouvrirMonCompte() {
  const c = carteLue();
  if (!(c && c.jeton) && sessionLue()) {
    if (typeof ADM !== "undefined") ADM.ongletVoulu = "seances";
    openTarget("espace");
    return;
  }
  openTarget("compte");
}

/** Déconnexion de Mon compte : la carte et la session quittent cet appareil. */
function deconnecterTout() {
  const s = sessionLue();
  carteEcrite(null);
  sessionEcrite(null);
  if (s) authAppel("/auth/v1/logout", { method: "POST", headers: { Authorization: "Bearer " + s.access_token } }).catch(() => {});
}

/** Heure lisible : « 10 h 00 » en français, « 10:00 » ailleurs (heure de Paris). */
function heureLisible(iso) {
  const p = {};
  new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Paris", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
    .formatToParts(new Date(iso)).forEach((x) => { p[x.type] = x.value; });
  return getLang() === "fr" ? p.hour + " h " + p.minute : p.hour + ":" + p.minute;
}
const TYPE_COULEUR = { visite_guidee: "visite", autoguidee: "visite", atelier: "atelier", escape_game: "escape", soiree: "soiree" };
const TYPE_LIBELLE = { visite_guidee: "infos.tVisite", autoguidee: "infos.tVisite", atelier: "infos.tAtelier", escape_game: "infos.tEscape", soiree: "infos.tSoiree" };

function compteResaHtml(r) {
  const jour = (o) => new Date(r.debut).toLocaleDateString(localeResa(), Object.assign({ timeZone: "Europe/Paris" }, o));
  const titreR = (r.titre && (r.titre[getLang()] || r.titre.fr)) || "";
  return '<div class="cpt-resa" style="--p:var(--type-' + (TYPE_COULEUR[r.type] || "visite") + ')">' +
    '<div class="cpt-resa-haut">' +
      '<span class="adm-jour"><span>' + esc(jour({ weekday: "short" })) + '</span><b>' + esc(jour({ day: "numeric" })) + '</b><span>' + esc(jour({ month: "short" })) + '</span></span>' +
      '<span class="cpt-resa-corps"><span class="cpt-badge">' + esc(t(TYPE_LIBELLE[r.type] || "infos.tVisite")) + '</span>' +
        '<span class="cpt-resa-titre">' + esc(titreR + (r.intervenant ? tx("compte.avec", { g: r.intervenant }) : "")) + '</span>' +
        '<span class="cpt-resa-meta">' + esc([heureLisible(r.debut), r.point_rdv].filter(Boolean).join(" · ")) + '</span></span>' +
    '</div>' +
    '<div class="cpt-resa-bas"><span>' + esc((r.personnes === 1 ? t("resa.person1") : tx("resa.personN", { n: r.personnes })) + " · " +
        (r.seance_modifiee ? t("compte.annulationModifiee") : tx("compte.annulationGratuite", { h: r.delai_frais_heures || 24 }))) + '</span>' +
      '<button type="button" class="cpt-voir" data-cpt-voir="' + esc(r.id) + '">' + esc(t("compte.voir")) + ' ›</button></div>' +
  '</div>';
}

/** Prochaines séances de l'intervenant connecté (Mon compte, E15.4), avec le nombre d'inscrits.
    null : pas d'intervenant (pas de session, ou compte d'administration sans fiche). */
async function chargerSeancesCompte() {
  const s = sessionLue();
  if (!s) return null;
  const user = (await authAppel("/auth/v1/user", { headers: { Authorization: "Bearer " + (await sessionValide()).access_token } })).data || {};
  const profil = (await supaConnecte("profils?select=role,intervenant_id&user_id=eq." + encodeURIComponent(user.id || "")))[0];
  if (!profil || !profil.intervenant_id) return null;
  const exps = await supaConnecte("experiences?select=id,titre,type&intervenant_id=eq." + encodeURIComponent(profil.intervenant_id));
  if (!exps.length) return { seances: [] };
  const ids = exps.map((e) => e.id).join(",");
  const seances = await supaConnecte("seances?select=id,experience_id,debut,point_rdv,capacite_max,participants_min,statut&supprimee_le=is.null&statut=eq.publiee" +
    "&experience_id=in.(" + ids + ")&debut=gt." + encodeURIComponent(new Date().toISOString()) + "&order=debut.asc&limit=6");
  const inscrits = seances.length ? await supaConnecte("mes_inscrits?select=seance_id,personnes&seance_id=in.(" + seances.map((x) => x.id).join(",") + ")") : [];
  return { seances: seances.map((x) => {
    const e = exps.find((k) => k.id === x.experience_id) || {};
    return Object.assign({}, x, { titre: e.titre, type: e.type,
      inscrits: inscrits.filter((r) => r.seance_id === x.id).reduce((k, r) => k + (r.personnes || 0), 0) });
  }) };
}

function compteSeanceHtml(x) {
  const jour = (o) => new Date(x.debut).toLocaleDateString(localeResa(), Object.assign({ timeZone: "Europe/Paris" }, o));
  const titreS = (x.titre && (x.titre[getLang()] || x.titre.fr)) || "";
  const manque = Math.max(0, x.participants_min - x.inscrits);
  return '<div class="cpt-resa" style="--p:var(--type-' + (TYPE_COULEUR[x.type] || "visite") + ')">' +
    '<div class="cpt-resa-haut">' +
      '<span class="adm-jour"><span>' + esc(jour({ weekday: "short" })) + '</span><b>' + esc(jour({ day: "numeric" })) + '</b><span>' + esc(jour({ month: "short" })) + '</span></span>' +
      '<span class="cpt-resa-corps"><span class="cpt-badge">' + esc(t(TYPE_LIBELLE[x.type] || "infos.tVisite")) + '</span>' +
        '<span class="cpt-resa-titre">' + esc(titreS) + '</span>' +
        '<span class="cpt-resa-meta">' + esc([heureLisible(x.debut), x.point_rdv].filter(Boolean).join(" · ")) + '</span></span>' +
    '</div>' +
    '<div class="cpt-resa-bas"><span>' + esc(manque
      ? tx("compte.inscritsManque", { n: x.inscrits, max: x.capacite_max, min: x.participants_min, k: manque })
      : tx("compte.inscritsAtteint", { n: x.inscrits, max: x.capacite_max, min: x.participants_min })) + '</span></div>' +
  '</div>';
}

function compteHtml(c, resas, note, inter) {
  const valide = new Date(c.valide_jusqua) > new Date();
  const prenom = String(c.nom || "").trim().split(/\s+/)[0] || "";
  const fin = new Date(c.valide_jusqua).toLocaleDateString(localeResa(), { timeZone: "Europe/Paris", day: "2-digit", month: "2-digit", year: "numeric" });
  const session = sessionLue();
  const fleche = '<span class="infos-fleche" aria-hidden="true">›</span>';
  const ligne = (attrs, titre, sous) => '<button type="button" class="infos-ligne"' + attrs + '><span><span class="infos-ligne-t">' + titre + '</span>' +
    (sous ? '<span class="infos-ligne-s">' + esc(sous) + '</span>' : '') + '</span>' + fleche + '</button>';
  const pastille = (k, couleur) => '<span class="infos-pastille" style="--p:' + couleur + '">' + esc(t(k)) + '</span>';
  const liste = resas === null ? '<div class="loading">' + esc(t("member.loading")) + '</div>'
    : resas.length
      ? '<div class="cpt-liste">' + resas.map(compteResaHtml).join("") + '</div>' +
        '<button type="button" class="cta ocre" data-cpt-accueil>' + esc(t("compte.reserverAutre")) + '</button>'
      : '<div class="cpt-vide"><h2>' + esc(t("compte.vide1")) + ' <i>' + esc(t("compte.vide2")) + '</i></h2>' +
          '<p>' + esc(valide ? t("compte.videTexte") : t("compte.videExpire")) + '</p>' +
          '<div class="infos-pastilles">' + pastille("infos.tVisite", "var(--type-visite)") + pastille("infos.tAtelier", "var(--type-atelier)") +
            pastille("infos.tSoiree", "var(--type-soiree)") + '</div>' +
          '<button type="button" class="cta ocre" data-cpt-accueil>' + esc(t("compte.voirDates")) + '</button></div>';
  // Statut (E15.2 à E15.4) : Adhérent et Intervenant, les deux possibles.
  const interSous = !session ? t("compte.nonActive")
    : inter && inter.seances ? tx("compte.seancesAVenir", { n: inter.seances.length }) : t("compte.actif");
  const statuts = '<div class="cpt-statuts">' +
    '<span class="cpt-statut' + (valide ? ' actif' : '') + '"><b>' + esc(t("compte.statutAdherent")) + '</b><span>' + esc(valide ? tx("compte.jusquau", { date: fin }) : t("compte.adhExpiree")) + '</span></span>' +
    '<span class="cpt-statut' + (session ? ' actif' : '') + '"><b>' + esc(t("compte.statutIntervenant")) + '</b><span>' + esc(interSous) + '</span></span>' +
  '</div>';
  const sectionInter = session
    ? '<div class="infos-label">' + esc(t("compte.statutIntervenant")) + '</div>' +
      (inter && inter.seances ? '<div class="cpt-titre-liste"><h2>' + esc(t("compte.seances1")) + ' <i>' + esc(t("compte.seances2")) + '</i></h2>' +
          '<span class="cpt-mono">' + esc(tx("compte.aVenir", { n: inter.seances.length })) + '</span></div>' +
        (inter.seances.length ? '<div class="cpt-liste">' + inter.seances.map(compteSeanceHtml).join("") + '</div>'
          : '<div class="member-note">' + esc(t("adm.aucuneSeance")) + '</div>') : '') +
      '<button type="button" class="cta ocre" id="cpt-nouvelle-seance">+ ' + esc(t("adm.nouvelleSeance")) + '</button>' +
      '<div class="infos-liste">' +
        ligne(' data-open="espace"', '<b>' + esc(t("espace.entree")) + '</b>') +
        ligne(' id="cpt-proposer"', esc(t("menu.proposerNouvelle"))) +
      '</div>'
    : '<div class="infos-label">' + esc(t("compte.statutIntervenant")) + '</div>' +
      '<h2 class="cpt-sous-titre">' + esc(t("compte.animer")) + '</h2>' +
      '<p class="espace-texte">' + esc(t("compte.animerTexte")) + '</p>' +
      '<div class="infos-liste">' +
        ligne(' id="cpt-proposer"', esc(t("infos.proposerBtn"))) +
        ligne(' data-open="espace"', esc(t("compte.dejaIntervenant")) + ' <b>' + esc(t("espace.entree")) + '</b>', t("compte.espaceSous")) +
      '</div>';
  return '<div class="cpt-eyebrow">' + esc(t("compte.eyebrow")) + '</div>' +
    '<h1 class="espace-titre">' + esc(t("compte.bonjour")) + (prenom ? ' <i>' + esc(prenom) + '</i>' : '') + '</h1>' +
    statuts +
    (note ? '<div class="resa-etat">' + esc(note) + '</div>' : '') +
    '<div class="infos-label">' + esc(t("compte.statutAdherent")) + '</div>' +
    '<button type="button" class="cpt-adh' + (valide ? '' : ' expiree') + '" data-open="membre">' +
      '<span class="cpt-adh-icone" aria-hidden="true">' + (valide ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>' : '!') + '</span>' +
      '<span class="cpt-adh-corps"><b>' + esc(valide ? t("compte.adhActive") : t("compte.adhExpiree")) + '</b>' +
        '<span class="cpt-mono">' + esc(tx("compte.jusquau", { date: fin }) + (c.numero ? " · " + c.numero : "")) + '</span>' +
        (valide && c.renouvelable ? '<span class="cpt-mono">' + esc(t("compte.renouvAuto")) + '</span>' : '') + '</span>' +
      '<span class="cpt-adh-carte">' + esc(valide ? t("compte.maCarte") : t("compte.renouveler")) + ' ›</span></button>' +
    '<div class="cpt-titre-liste"><h2>' + esc(t("compte.prochaines1")) + ' <i>' + esc(t("compte.prochaines2")) + '</i></h2>' +
      (resas && resas.length ? '<span class="cpt-mono">' + esc(tx("compte.aVenir", { n: resas.length })) + '</span>' : '') + '</div>' +
    liste +
    sectionInter +
    '<div class="infos-label">' + esc(t("compte.soutenir")) + '</div>' +
    '<div class="infos-liste">' +
      '<a class="infos-ligne" href="' + esc(CONFIG.liens.don) + '" target="_blank" rel="noopener"><span><span class="infos-ligne-t">' + esc(t("cta.donate")) + '</span>' +
        '<span class="infos-ligne-s">' + esc(t("compte.donSous")) + '</span></span>' + fleche + '</a>' +
    '</div>' +
    (c.renouvelable ? '<button type="button" class="lien-bouton cpt-gerer" id="cpt-portail">' + esc(t("member.gerer")) + '</button><div class="resa-erreur" id="cpt-portail-note" role="alert"></div>' : '') +
    '<button type="button" class="lien-bouton cpt-deco" id="cpt-deconnexion">' + esc(t("compte.deconnexion")) + '</button>';
}

/** Écran « Mon compte » : connexion par code, ou l'adhérent (E15.2 avec réservations, E15.3 sans). */
async function renderCompte(note) {
  const corps = $("#compte-body");
  if (!corps) return;
  note = note || noteCompte; noteCompte = null;
  const st = carteLue();
  if (!st || !st.jeton) {
    if (sessionLue()) { openTarget("espace"); return; }   // intervenant sans adhésion : son espace
    corps.innerHTML =
      '<div class="cpt-eyebrow">' + esc(t("compte.eyebrow")) + '</div>' +
      '<h1 class="espace-titre">' + esc(t("compte.connexion1")) + ' <i>' + esc(t("compte.connexion2")) + '</i></h1>' +
      '<p class="espace-texte">' + esc(t("compte.connexionTexte")) + '</p>' +
      (note ? '<div class="resa-etat">' + esc(note) + '</div>' : '') +
      connexionHtml("cpt") +
      '<div class="infos-liste cpt-liens">' +
        '<button type="button" class="infos-ligne" data-open="membre"><span><span class="infos-ligne-t">' + esc(t("compte.pasMembre")) + '</span></span><span class="infos-fleche" aria-hidden="true">›</span></button>' +
        '<button type="button" class="infos-ligne" data-open="rejoindre"><span><span class="infos-ligne-t">' + esc(t("compte.animer")) + '</span><span class="infos-ligne-s">' + esc(t("form.nousRejoindre")) + '</span></span><span class="infos-fleche" aria-hidden="true">›</span></button>' +
      '</div>';
    brancherConnexion("cpt", () => routerApresConnexion());
    return;
  }
  let resas = null, inter = null;
  const peindre = () => {
    const s = carteLue();
    if (!s || !s.carte) { corps.innerHTML = '<div class="loading">' + esc(t("member.loading")) + '</div>'; return; }
    corps.innerHTML = compteHtml(s.carte, resas, note, inter);
    $$("[data-cpt-accueil]").forEach((b) => b.addEventListener("click", () => showScreen("accueil")));
    const nouvelle = $("#cpt-nouvelle-seance");
    if (nouvelle) nouvelle.addEventListener("click", () => {
      if (typeof ADM !== "undefined") { ADM.ongletVoulu = "seances"; ADM.nouvelleSeance = true; }
      openTarget("espace");
    });
    $("#cpt-proposer").addEventListener("click", () => {
      if (sessionLue() && typeof ADM !== "undefined") { ADM.ongletVoulu = "fiches"; ADM.nouvelleExperience = true; openTarget("espace"); }
      else openTarget("rejoindre");
    });
    $("#cpt-deconnexion").addEventListener("click", () => { deconnecterTout(); renderCompte(); });
    const portail = $("#cpt-portail");
    if (portail) portail.addEventListener("click", async () => {
      portail.disabled = true;
      try {
        const r = await appelCarte({ action: "portail", jeton: (carteLue() || {}).jeton });
        if (r.status === 200 && r.data.url) { window.location.href = r.data.url; return; }
        $("#cpt-portail-note").textContent = t("member.portailIndispo");
      } catch (e) { $("#cpt-portail-note").textContent = t("member.error"); }
      portail.disabled = false;
    });
    $$("[data-cpt-voir]").forEach((b) => b.addEventListener("click", async () => {
      b.disabled = true;
      try {
        const r = await appelCarte({ action: "ouvrir", jeton: (carteLue() || {}).jeton, reservation_id: b.dataset.cptVoir });
        if (r.status === 200 && r.data.jeton) { window.location.hash = "reservation=" + r.data.jeton; handleReservationRetour(); return; }
      } catch (e) { /* message ci-dessous */ }
      b.disabled = false; b.textContent = t("member.error");
    }));
  };
  peindre();
  // Séances de l'intervenant (s'il est connecté à son espace sur ce téléphone), sans bloquer le reste.
  if (sessionLue()) chargerSeancesCompte().then((x) => { inter = x; peindre(); }).catch(() => { /* la section garde ses liens */ });
  // Carte à jour (validité, renouvellement) et réservations à venir.
  try {
    const [v, r] = await Promise.all([appelCarte({ action: "voir", jeton: st.jeton }), appelCarte({ action: "reservations", jeton: st.jeton })]);
    if (v.status === 200 && v.data.carte) carteEcrite({ jeton: st.jeton, carte: v.data.carte, email: v.data.email || st.email, maj: Date.now() });
    else if (v.status === 404 || v.status === 400) { carteEcrite(null); renderCompte(t("member.revoked")); return; }
    resas = r.status === 200 ? (r.data.reservations || []) : [];
  } catch (e) { resas = []; note = note || t("member.offline"); }
  peindre();
}


/* ============================================================
   MENU (v2 : E1.3 visiteur, E1.4 adhérent, E1.5 intervenant) ET LANGUE (E1.2)
   Ouvert par le bouton ☰ de l'en-tête. Le contenu suit le statut de la
   personne sur cet appareil : carte de membre valable (adhérent), session de
   l'espace (intervenant ou association), les deux, ou rien (visiteur).
   ============================================================ */

function statutAppareil() {
  const c = carteLue(), s = sessionLue();
  const carte = c && c.carte;
  return { adherent: !!(carte && new Date(carte.valide_jusqua) > new Date()), carte, intervenant: !!s };
}

const ligneMenu = (attrs, titre, sous) => '<button type="button" class="infos-ligne menu-ligne"' + attrs + '><span><span class="infos-ligne-t">' + esc(titre) + '</span>' +
  (sous ? '<span class="infos-ligne-s">' + esc(sous) + '</span>' : '') + '</span><span class="infos-fleche" aria-hidden="true">›</span></button>';

/** Carte « Adhésion · 5 € par an » (menu, accueil) ou ligne de statut d'un adhérent. */
function adhesionMenuHtml(st, contexte) {
  if (st.adherent) {
    const fin = new Date(st.carte.valide_jusqua).toLocaleDateString(localeResa(), { timeZone: "Europe/Paris", day: "2-digit", month: "2-digit", year: "numeric" });
    return '<button type="button" class="cpt-adh" data-open="membre">' +
      '<span class="cpt-adh-icone" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg></span>' +
      '<span class="cpt-adh-corps"><b>' + esc(t("compte.adhActive")) + '</b><span class="cpt-mono">' + esc(tx("compte.jusquau", { date: fin }) + (st.carte.numero ? " · " + st.carte.numero : "")) + '</span></span>' +
      '<span class="cpt-adh-carte">' + esc(t("compte.maCarte")) + ' ›</span></button>';
  }
  return '<div class="adh-panneau' + (contexte === "accueil" ? " adh-panneau-accueil" : "") + '">' +
    '<div class="adh-eyebrow">' + esc(t("menu.adhEyebrow")) + '</div>' +
    (contexte === "accueil" ? '<h2 class="adh-titre">' + esc(t("accueil.adhTitre1")) + ' <i>' + esc(t("accueil.adhTitre2")) + '</i></h2>' : '') +
    '<p>' + esc(t(contexte === "accueil" ? "accueil.adhTexte" : "menu.adhTexte")) + '</p>' +
    '<button type="button" class="cta ocre" data-open="membre" data-membre-adherer>' + esc(t("member.adherer5")) + '</button>' +
    '<p class="adh-deja">' + esc(t("adh.deja")) + ' <button type="button" class="lien-bouton" data-open="membre">' + esc(t("compte.maCarte")) + ' ›</button></p>' +
  '</div>';
}

function renderMenu() {
  const corps = $("#menu-body");
  if (!corps) return;
  const st = statutAppareil();
  corps.innerHTML =
    '<div class="menu-tete"><h1 class="menu-titre" id="menu-titre">' + esc(t("menu.titre")) + '</h1>' +
      '<button type="button" class="menu-fermer" data-back aria-label="' + esc(t("menu.fermer")) + '">✕</button></div>' +
    '<div class="infos-liste menu-bloc">' +
      ligneMenu(' data-compte', t("menu.compte"), t(st.intervenant ? "menu.compteSousInter" : st.adherent ? "menu.compteSousAdh" : "menu.compteSous")) +
      (st.intervenant
        ? ligneMenu(' data-open="espace"', t("espace.entree"), t("menu.espaceSous")) +
          ligneMenu(' data-menu-proposer', t("menu.proposerNouvelle"), t("menu.proposerSous"))
        : ligneMenu(' data-open="rejoindre"', t("menu.proposer"), t("menu.proposerSous")) +
          ligneMenu(' data-open="rejoindre" data-arg="lieu"', t("menu.lieu"), t("menu.lieuSous"))) +
    '</div>' +
    adhesionMenuHtml(st, "menu") +
    '<div class="infos-liste menu-bloc">' +
      '<a class="infos-ligne menu-ligne" href="' + esc(CONFIG.liens.don) + '" target="_blank" rel="noopener"><span><span class="infos-ligne-t">' + esc(t("cta.donate")) + '</span>' +
        '<span class="infos-ligne-s">' + esc(t("menu.donSous")) + '</span></span><span class="infos-fleche" aria-hidden="true">›</span></a>' +
      ligneMenu(' data-open="langue"', t("infos.langue"), LANG_META[getLang()].nom) +
      ligneMenu(' data-open="infos"', t("menu.infos"), "") +
    '</div>' +
    '<div class="infos-pied menu-pied">' + esc(t("infos.pied")) + '<br>' + esc(t("infos.beta")) + '</div>';
  const proposer = corps.querySelector("[data-menu-proposer]");
  if (proposer) proposer.addEventListener("click", () => {
    if (typeof ADM !== "undefined") { ADM.ongletVoulu = "fiches"; ADM.nouvelleExperience = true; }
    openTarget("espace");
  });
}

function renderLangue() {
  const corps = $("#langue-body");
  if (!corps) return;
  const coche = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
  corps.innerHTML = '<div class="infos-liste langue-liste" role="radiogroup">' + languesAffichees().map((l) =>
    '<button type="button" class="infos-ligne langue-ligne' + (l === getLang() ? ' active' : '') + '" role="radio" aria-checked="' + (l === getLang()) + '" data-langue="' + l + '">' +
      '<span class="infos-ligne-t" lang="' + l + '">' + esc(LANG_META[l].nom) + '</span><span class="langue-coche" aria-hidden="true">' + (l === getLang() ? coche : '') + '</span></button>').join("") + '</div>' +
    '<p class="member-note">' + esc(t("langue.note")) + '</p>';
  corps.querySelectorAll("[data-langue]").forEach((b) => b.addEventListener("click", () => {
    if (b.dataset.langue === getLang()) { openTarget("menu"); return; }
    setLang(b.dataset.langue);
    location.reload();
  }));
}

/* ============================================================
   CARTE DE MEMBRE
   ============================================================ */

/* La carte est gardée sur ce téléphone : { jeton, carte, maj }.
   Le jeton est secret (comme un mot de passe) : il n'est jamais affiché. */
const CARTE_CLE = "carteMembre";
function carteLue() {
  try { const v = JSON.parse(localStorage.getItem(CARTE_CLE) || "null"); return v && v.jeton ? v : null; }
  catch (e) { return null; }
}
function carteEcrite(v) {
  try { if (v) localStorage.setItem(CARTE_CLE, JSON.stringify(v)); else localStorage.removeItem(CARTE_CLE); }
  catch (e) { /* stockage indisponible : la carte ne sera pas gardée */ }
}

async function appelCarte(corps) {
  const res = await fetch("/.netlify/functions/carte", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(corps),
  });
  let data = {};
  try { data = await res.json(); } catch (e) { /* réponse vide */ }
  return { status: res.status, data };
}

function dateCarte(isoDate) {
  try { return new Date(isoDate).toLocaleDateString(getLang(), { day: "numeric", month: "long", year: "numeric" }); }
  catch (e) { return String(isoDate || "").slice(0, 10); }
}

function carteHtml(c, note) {
  const valide = new Date(c.valide_jusqua) > new Date();
  const fin = dateCarte(c.valide_jusqua);
  const court = new Date(c.valide_jusqua).toLocaleDateString(localeResa(), { timeZone: "Europe/Paris", day: "2-digit", month: "2-digit", year: "2-digit" });
  const avantages = [1, 2, 3, 4, 5].map((n) => '<li>' + esc(t("member.benefit" + n)) + '</li>').join("");
  return (
    '<div class="mb-etat">' + esc(!valide ? t("member.expiree") : c.renouvelable ? tx("member.renouvelee", { date: fin }) : t("member.enCours")) + '</div>' +
    '<div class="mb-carte' + (valide ? '' : ' expired') + '">' +
      '<div class="mb-carte-haut"><div><div class="mb-eyebrow">Mouvement Montmartre</div>' +
        '<div class="mb-carte-titre">' + esc(t("member.carteDe")) + ' <i>' + esc(t("member.carteMembre")) + '</i></div></div>' +
        '<span class="mb-annee">' + esc(tx(valide ? "member.jusquau" : "member.expiredOn", { date: court }).replace("{date}", court)) + '</span></div>' +
      '<div class="mb-carte-bas"><div class="mb-carte-id">' +
        '<div class="mb-k">' + esc(t("member.titulaire")) + '</div><div class="mb-nom">' + esc(c.nom || t("member.formula.adhesion")) + '</div>' +
        (c.numero ? '<div class="mb-k mb-k-num">' + esc(t("member.numero")) + '</div><div class="mb-num">' + esc(c.numero) + '</div>' : '') +
        (c.formule === "bienfaiteur" ? '<div class="mb-v">' + esc(t("member.formula.bienfaiteur")) + '</div>' : '') +
      '</div>' +
      // QR code : affiché seulement s'il existe un jour dans les données (pas aujourd'hui).
      (c.qr_svg ? '<div class="mb-qr">' + c.qr_svg + '</div>' : '<img class="mb-logo" src="icons/logo.png" alt="">') +
    '</div></div>' +
    (note ? '<div class="member-note">' + esc(note) + '</div>' : '') +
    (!valide ? '<button type="button" class="cta ocre" id="membre-renouveler">' + esc(t("member.adherer5")) + '</button>' : '') +
    '<h2 class="mb-titre mb-titre-petit">' + esc(t("member.avantages1")) + ' <i>' + esc(t("member.avantages2")) + '</i></h2>' +
    '<ul class="mb-avantages">' + avantages + '</ul>' +
    (c.renouvelable ? '<button type="button" class="cta ocre" id="membre-portail">' + esc(t("member.gerer")) + '</button><div class="resa-erreur" id="membre-portail-note" role="alert"></div>' : '') +
    '<a class="lien-bouton mb-don" href="' + esc(CONFIG.liens.don) + '" target="_blank" rel="noopener">' + esc(t("cta.donate")) + '</a>' +
    '<button class="lien-bouton mb-autre" type="button" id="membre-oublier">' + esc(t("member.autreEmail")) + '</button>'
  );
}

/** Affiche l'écran « Ma carte de membre » : la carte gardée, sinon le formulaire. */
async function renderMembre(note) {
  const result = $("#membre-result"), form = $("#membre-form");
  if (!result || !form) return;
  const st = carteLue();
  const afficher = (s, n) => {
    const pasEncore = $("#membre-pas-encore");
    if (pasEncore) pasEncore.hidden = !!(s && s.carte);   // la carte propose déjà « Renouveler » et ses avantages
    if (s && s.carte) {
      result.innerHTML = carteHtml(s.carte, n);
      form.hidden = true;
      $("#membre-oublier").addEventListener("click", () => { carteEcrite(null); renderMembre(); });
      const portail = $("#membre-portail");
      if (portail) portail.addEventListener("click", async () => {
        portail.disabled = true;
        try {
          const r = await appelCarte({ action: "portail", jeton: (carteLue() || {}).jeton });
          if (r.status === 200 && r.data.url) { window.location.href = r.data.url; return; }
          $("#membre-portail-note").textContent = t("member.portailIndispo");
        } catch (e) { $("#membre-portail-note").textContent = t("member.error"); }
        portail.disabled = false;
      });
      const renouveler = $("#membre-renouveler");
      if (renouveler) renouveler.addEventListener("click", () => { carteEcrite(null); renderMembre(); $("#membre-adherer").scrollIntoView({ block: "center" }); });
    } else {
      result.innerHTML = n ? '<div class="member-note">' + esc(n) + '</div>' : '';
      form.hidden = false;
    }
  };
  afficher(st, note);
  if (!st) return;

  // Mise à jour depuis le serveur (validité, renouvellement).
  try {
    const r = await appelCarte({ action: "voir", jeton: st.jeton });
    if (r.status === 200 && r.data.carte) {
      carteEcrite({ jeton: st.jeton, carte: r.data.carte, email: r.data.email || st.email, maj: Date.now() });
      afficher(carteLue(), note);
    } else if (r.status === 404 || r.status === 400) {
      carteEcrite(null);
      afficher(null, t("member.revoked"));
    }
  } catch (e) {
    if (st.carte) afficher(st, note || t("member.offline"));
  }
}

/* Code de vérification (21/11) : seul l'adhérent, qui reçoit le code à son adresse, affiche sa carte.
   Étape 1 : code envoyé (réponse identique que l'adresse soit adhérente ou non). Étape 2 : code saisi. */
async function demanderCode(email) {
  const r = await appelCarte({ action: "email", email, langue: getLang() });
  return r.status === 200 ? "envoye" : r.status === 503 ? "indisponible" : r.status === 400 ? "email" : "erreur";
}
async function validerCode(email, code) {
  const r = await appelCarte({ action: "code", email, code: String(code || "").replace(/\s/g, "") });
  if (r.status === 200 && r.data.jeton && r.data.carte) {
    carteEcrite({ jeton: r.data.jeton, carte: r.data.carte, email: r.data.email || email, maj: Date.now() });
    return { ok: true, carte: r.data.carte };
  }
  return { ok: false, message: r.status === 400 ? t("member.codeFaux") : r.status === 429 ? t("member.codeTropEssais")
    : r.status === 410 ? t("member.codeExpire") : r.status === 404 ? t("member.notFound") : t("member.error") };
}
const messageEnvoiCode = (etat) => etat === "envoye" ? t("member.codeEnvoye") : etat === "indisponible" ? t("member.unavailable")
  : etat === "email" ? t("member.emailInvalid") : t("member.error");

$("#membre-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const email = ($("#membre-email").value || "").trim().toLowerCase();
  const out = $("#membre-form-note"), bouton = $("#membre-check");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { out.textContent = t("member.emailInvalid"); return; }
  out.textContent = t("member.loading");
  bouton.disabled = true;
  try {
    const etat = await demanderCode(email);
    out.textContent = messageEnvoiCode(etat);
    if (etat === "envoye") { $("#membre-code-zone").hidden = false; $("#membre-code").focus(); }
  } catch (err) { out.textContent = t("member.error"); }
  bouton.disabled = false;
});
$("#membre-valider").addEventListener("click", async () => {
  const email = ($("#membre-email").value || "").trim().toLowerCase();
  const out = $("#membre-form-note"), bouton = $("#membre-valider");
  bouton.disabled = true; out.textContent = t("member.loading");
  try {
    const r = await validerCode(email, $("#membre-code").value);
    if (r.ok) {
      $("#membre-email").value = ""; $("#membre-code").value = ""; $("#membre-code-zone").hidden = true;
      out.textContent = ""; renderMembre(); return;
    }
    out.textContent = r.message;
  } catch (err) { out.textContent = t("member.error"); }
  bouton.disabled = false;
});

/** Arrivée par le lien de l'email (#carte=…) ou au retour du paiement d'adhésion (?adhesion=cs_…). */
async function handleCarteRetour() {
  const hash = window.location.hash || "";
  const m = hash.match(/^#carte=([A-Za-z0-9_-]{43})$/);
  const params = new URLSearchParams(window.location.search);
  const session = params.get("adhesion");
  const resaRetenue = params.get("resa");
  if (!m && !session) return;
  history.replaceState(null, "", window.location.pathname);   // le jeton ne reste pas dans l'adresse
  if (!resaRetenue) openTarget("membre");

  if (m) {
    carteEcrite({ jeton: m[1], carte: null, maj: 0 });
    renderMembre();
    return;
  }
  if (!/^cs_(live|test)_[A-Za-z0-9]+$/.test(session)) return;
  const result = $("#membre-result");
  if (result) result.innerHTML = '<div class="loading">' + esc(t("member.loading")) + '</div>';
  // Adhésion prise pendant une réservation : si Stripe n'a pas encore confirmé, la place reste retenue
  // et l'état est relu (toutes les 5 s pendant 1 min) avant d'abandonner l'attente.
  const essais = resaRetenue ? 12 : 1;
  for (let i = 0; i < essais; i++) {
    if (i === 1) attenteActivationResa();
    if (i > 0) await new Promise((ok) => setTimeout(ok, 5000));
    try {
      const r = await appelCarte({ action: "session", session_id: session });
      if (r.status === 200 && r.data.jeton) {
        carteEcrite({ jeton: r.data.jeton, carte: r.data.carte, email: r.data.email, maj: Date.now() });
        if (resaRetenue && await reprendreReservationApresAdhesion(resaRetenue, r.data.carte)) return;
        if (resaRetenue) openTarget("membre");
        renderMembre(t("member.welcome"));
        return;
      }
    } catch (e) { /* on réessaie */ }
  }
  if (resaRetenue) openTarget("membre");
  renderMembre(t("member.paymentPending"));
}

/** Écran d'attente pendant l'activation de l'adhésion (webhook ou banque en retard). */
function attenteActivationResa() {
  showScreen("reservation");
  const corps = $("#reservation-body");
  if (corps) corps.innerHTML = '<div class="resa-adh-nouvelle"><div class="resa-adh-eyebrow">' + esc(t("resa.adhEnCours")) + '</div>' +
    '<p class="member-note">' + esc(t("resa.adhEnCoursAttente")) + '</p><div class="loading"></div></div>';
}

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
    [v.nom, v.forme].filter(Boolean).map(esc).join(", "),
    esc(v.adresse || ""),
    [v.rna ? "RNA " + esc(v.rna) : "", v.siret ? "SIRET " + esc(v.siret) : ""].filter(Boolean).join(" · "),
    v.mentionTva ? esc(v.mentionTva) : "",
    '<a href="cgv.html" target="_blank" rel="noopener">' + esc(t("resa.cgvFull")) + '</a>'
  ].filter(Boolean).join("<br>");
}

function renderInfos() {
  const c = CONFIG.contacts;
  const l = CONFIG.liens;
  const fleche = '<span class="infos-fleche" aria-hidden="true">›</span>';
  const ligne = (titre, sous, attrs) => '<button type="button" class="infos-ligne"' + attrs + '><span><span class="infos-ligne-t">' + esc(titre) + '</span>' +
    (sous ? '<span class="infos-ligne-s">' + esc(sous) + '</span>' : '') + '</span>' + fleche + '</button>';
  const deplie = (titre, html) => '<details class="infos-ligne infos-deplie"><summary><span class="infos-ligne-t">' + esc(titre) + '</span>' + fleche + '</summary>' +
    '<div class="infos-ligne-corps">' + html + '</div></details>';
  $("#infos-body").innerHTML =
    '<div class="infos-hero"><h1>' + esc(t("infos.hero1")) + ' <i>' + esc(t("infos.hero2")) + '</i></h1><p>' + esc(t("infos.heroTexte")) + '</p></div>' +
    '<div class="infos-carte infos-asso">' +
      '<div class="infos-label infos-label-or">' + esc(t("infos.assoLabel")) + '</div>' +
      '<h2>' + esc(t("infos.assoTitre")) + '</h2><p>' + esc(t("infos.assoTexte")) + '</p>' +
      '<div class="infos-asso-liens">' +
        '<a class="infos-asso-lien" href="' + esc(l.rejoindreReseau) + '" target="_blank" rel="noopener">' + esc(t("infos.rejoindreReseau")) + ' ›</a>' +
        '<a class="infos-asso-lien" href="' + esc(l.don) + '" target="_blank" rel="noopener">' + esc(t("cta.donate")) + ' ›</a>' +
      '</div>' +
      '<p class="member-note">' + esc(t("infos.rejoindreReseauSous")) + '</p>' +
      '<div class="infos-asso-menu"><span>' + esc(t("infos.assoMenu")) + '</span>' +
        '<button type="button" class="infos-menu-btn" data-open="menu">' + esc(t("menu.titre")) + ' <span aria-hidden="true">☰</span></button></div>' +
    '</div>' +
    '<div class="infos-label">' + esc(t("infos.pratique")) + '</div>' +
    '<div class="infos-liste">' +
      ligne(t("infos.langue"), LANG_META[getLang()].nom, ' data-open="langue"') +
      '<a class="infos-ligne" href="cgv.html" target="_blank" rel="noopener"><span><span class="infos-ligne-t">' + esc(t("infos.conditions")) + '</span><span class="infos-ligne-s">' +
        esc(t("infos.conditionsSous")) + '</span></span>' + fleche + '</a>' +
      '<a class="infos-ligne" href="mailto:' + esc(c.general) + '"><span><span class="infos-ligne-t">' + esc(t("infos.contactPresse")) + '</span><span class="infos-ligne-s">' +
        esc(c.general) + '</span></span>' + fleche + '</a>' +
      deplie(t("infos.legalTitle"), "<p>" + legalBlockHtml() + "</p>") +
      deplie(t("infos.confidentialite"), "<p>" + t("infos.privacyBody") + "</p>") +
    '</div>' +
    '<div class="infos-reseaux">' +
      '<a class="icon-btn" href="' + esc(l.siteAssociation) + '" target="_blank" rel="noopener" aria-label="' + esc(t("infos.siteWeb")) + '"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18"/></svg></a>' +
      '<a class="icon-btn" href="' + esc(l.instagram) + '" target="_blank" rel="noopener" aria-label="Instagram"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="3.5" y="3.5" width="17" height="17" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17" cy="7" r=".8" fill="currentColor"/></svg></a>' +
      '<a class="icon-btn" href="' + esc(l.facebook) + '" target="_blank" rel="noopener" aria-label="Facebook"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M15 4.2 H13.2 A3.3 3.3 0 0 0 9.9 7.5 V10.2 H7.8 V13.4 H9.9 V20.5 H13.1 V13.4 H15.4 L15.8 10.2 H13.1 V7.9 C13.1 7 13.4 6.4 14.4 6.4 H15.8 Z"/></svg></a>' +
      '<a class="icon-btn" href="mailto:' + esc(c.general) + '" aria-label="' + esc(t("infos.ecrire")) + '"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="2.5"/><path d="M4 7l8 6 8-6"/></svg></a>' +
    '</div>' +
    '<div class="infos-pied">' + esc(t("infos.pied")) + '<br>' + esc(t("infos.beta")) + '</div>';
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

/** Liens directs à partager : https://artdive.app/#rejoindre, et #espace=demandes (emails d'alerte). */
function handleLienDirect() {
  const h = window.location.hash || "";
  const cx = h.match(/^#connexion=([A-Za-z0-9_-]{43})(?:&vers=([a-z]+))?$/);
  if (cx) {
    history.replaceState(null, "", window.location.pathname + window.location.search);   // le jeton ne reste pas dans l'adresse
    connexionParLien(cx[1], cx[2]);
    return true;
  }
  // Lien partagé d'une expérience (https://artdive.app/e/<slug> renvoie ici).
  const fiche = h.match(/^#visite=([a-z0-9-]{1,120})$/);
  if (fiche) {
    history.replaceState(null, "", window.location.pathname + window.location.search);
    openTarget("visite", fiche[1]);
    return true;
  }
  const m = h.match(/^#espace(?:=([a-z]+))?$/);
  if (h !== "#rejoindre" && h !== "#membre" && !m) return false;
  history.replaceState(null, "", window.location.pathname + window.location.search);
  if (h === "#rejoindre") { openTarget("rejoindre"); return true; }
  if (h === "#membre") { openTarget("membre"); return true; }
  if (m[1]) {
    if (typeof ADM !== "undefined") ADM.ongletVoulu = m[1];
    try { localStorage.setItem("ongletVoulu", m[1]); } catch (e) { /* rien */ }   // après la connexion par email
  }
  openTarget("espace");
  return true;
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
  brancherLiensDon();
  renderAccueil();
  handleCheckoutReturn();
  // Lien partagé ouvert alors que l'app est déjà affichée (#visite=…, #espace=…).
  window.addEventListener("hashchange", () => { handleLienDirect(); });
  const compte = $("#infos-compte");
  if (compte) compte.addEventListener("click", ouvrirMonCompte);

  // L'ancienne liste des adhérents (Sheet publique) ne doit plus rester sur les téléphones.
  try { localStorage.removeItem("csv:membres"); } catch (e) { /* rien */ }
  if (!handleConnexionRetour() && !handleLienDirect()) {
    handleCarteRetour();
    handleReservationRetour();
    if (typeof handleParcoursRetour === "function") handleParcoursRetour();
  }

  // Adhésion (E15) : abonnement 5 € par an. Premier appui : nom, email, téléphone ; ensuite, paiement.
  const caseE15 = $("#adh-e15-case");
  if (caseE15) caseE15.innerHTML = caseAdhesionHtml("adh-e15-statuts");
  const membreAdherer = $("#membre-adherer");
  if (membreAdherer) membreAdherer.addEventListener("click", async () => {
    const zone = $("#adh-e15"), note = $("#adh-e15-note");
    if (zone.hidden) { zone.hidden = false; $("#adh-nom").focus(); return; }
    const nom = $("#adh-nom").value.trim(), email = $("#adh-email").value.trim().toLowerCase();
    if (!nom || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { note.textContent = t("resa.err.form"); return; }
    if (!$("#adh-e15-statuts").checked) { note.textContent = t("resa.err.cgv"); return; }
    membreAdherer.disabled = true; note.textContent = "";
    try {
      const r = await appelCarte({ action: "adherer", nom, email, telephone: $("#adh-tel").value.trim(), langue: getLang(), accord_adhesion: true });
      if (r.status === 200 && r.data.url) { window.location.href = r.data.url; return; }
      note.textContent = r.data.code === "DEJA_ADHERENT" ? t("member.dejaAdherentCode") : t("resa.err.pay");
    } catch (e) { note.textContent = t("resa.err.pay"); }
    membreAdherer.disabled = false;
  });

  // Service worker (hors ligne)
  if ("serviceWorker" in navigator && navigator.serviceWorker) {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }
});
