/* ============================================================
   ADMINISTRATION (étape 6.2a) : fiches et intervenants
   Écrans du canvas E12, dans l'espace intervenants, pour le rôle admin.
   Toutes les écritures passent par Supabase avec la session de
   l'administratrice : ce sont les règles de la base (RLS) qui
   autorisent, pas cet écran. Photos : dossier « photos » du stockage
   Supabase, réduites sur le téléphone avant l'envoi. Invitation d'un
   intervenant : fonction Netlify « inviter » (crée le compte, envoie
   le lien par email).
   Chargé après app.js, dont il reprend les outils ($, esc, t, tx,
   supaConnecte, sessionValide, authAppel, loadCSV…).
   ============================================================ */

const ADM = { onglet: "fiches", exps: [], ints: [], contacts: {}, comptes: {}, nom: "" };
const ADM_TYPES_EXP = ["visite_guidee", "autoguidee", "atelier", "soiree", "escape_game"];
const ADM_TYPES_INT = ["guide", "artiste", "lieu", "autre"];
const ADM_LANGUES = ["fr", "en", "es", "zh", "ar", "ru"];
const ADM_TRAD = ["en", "es"];   // traductions : automatiques par Claude (fonction « traduire »), modifiables à la main

/** Écriture dans la base au nom de la personne connectée. */
async function supaEcrire(methode, chemin, corps, prefer) {
  const s = await sessionValide();
  if (!s) throw new Error("SESSION");
  const r = await authAppel("/rest/v1/" + chemin, { method: methode, body: corps,
    headers: { Authorization: "Bearer " + s.access_token, Prefer: prefer || "return=representation" } });
  if (!r.ok) {
    const e = new Error((r.data && r.data.message) || ("Supabase " + r.status));
    e.code = r.data && r.data.code; e.status = r.status;
    throw e;
  }
  return r.data;
}

/** Message lisible pour une erreur d'enregistrement. */
function admErreur(e) {
  if (!e) return t("adm.erreur");
  if (e.message === "SESSION") return t("espace.expire");
  if (e.message === "PHOTO_FORMAT") return t("adm.photoFormat");
  if (/experiences_prix_complets/.test(e.message)) return t("adm.erreurPublier");
  if (/experiences_min_max/.test(e.message)) return t("adm.erreurMinMax");
  if (e.code === "23505") return t("adm.erreurDoublon");
  if (e.code === "42501" || e.status === 401 || e.status === 403) return t("adm.erreurDroits");
  return t("adm.erreur");
}

/* ---------- Outils ---------- */

function admSlug(texte, pris) {
  let base = String(texte || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "fiche";
  let s = base, i = 2;
  while (pris.includes(s)) s = base + "-" + i++;
  return s;
}
const admEuros = (c) => (c == null ? "" : String(c / 100).replace(".", ","));
function admCentimes(v) {
  const x = String(v == null ? "" : v).replace(",", ".").replace(/[^\d.]/g, "");
  return x === "" ? null : Math.round(parseFloat(x) * 100);
}
const admEntier = (v) => { const n = parseInt(String(v || "").replace(/\D/g, ""), 10); return isFinite(n) ? n : null; };
function admMinutes(txt) {
  const s = String(txt || "").toLowerCase().replace(",", ".");
  const h = s.match(/(\d+(?:\.\d+)?)\s*h/), m = s.match(/(\d+)\s*(?:min|$)/);
  let total = 0;
  if (h) total += Math.round(parseFloat(h[1]) * 60);
  const apresH = h ? s.slice(s.indexOf("h") + 1).match(/(\d+)/) : null;
  if (apresH) total += parseInt(apresH[1], 10);
  else if (!h && m) total += parseInt(m[1], 10);
  return total > 0 ? total : null;
}
const admVal = (id) => { const el = document.getElementById(id); return el ? el.value.trim() : ""; };
const admCoche = (id) => { const el = document.getElementById(id); return !!(el && el.checked); };
function admTraduit(base) {
  const o = {};
  ["fr"].concat(ADM_TRAD).forEach((l) => { const v = admVal(base + "-" + l); if (v) o[l] = v; });
  return o;
}

/** Réduit une photo sur le téléphone (1600 px, JPEG) puis l'envoie dans le stockage. Rend son adresse publique. */
async function admReduire(fichier) {
  let image;
  try { image = await createImageBitmap(fichier, { imageOrientation: "from-image" }); }
  catch (e) { image = await createImageBitmap(fichier); }
  const r = Math.min(1, 1600 / Math.max(image.width, image.height));
  const c = document.createElement("canvas");
  c.width = Math.round(image.width * r); c.height = Math.round(image.height * r);
  c.getContext("2d").drawImage(image, 0, 0, c.width, c.height);
  return await new Promise((ok) => c.toBlob(ok, "image/jpeg", 0.85));
}
async function admEnvoyerPhoto(fichier, dossier) {
  let blob = null;
  try { blob = await admReduire(fichier); } catch (e) { blob = null; }
  if (!blob) {   // navigateur incapable de la réduire : l'original passe s'il est dans les formats et la taille admis
    if (!/^image\/(jpeg|png|webp)$/.test(fichier.type) || fichier.size > 5242880) throw new Error("PHOTO_FORMAT");
    blob = fichier;
  }
  const ext = blob.type === "image/png" ? ".png" : blob.type === "image/webp" ? ".webp" : ".jpg";
  const chemin = dossier + "/" + (crypto.randomUUID ? crypto.randomUUID() : Date.now() + "-" + Math.random().toString(36).slice(2)) + ext;
  const s = await sessionValide();
  if (!s) throw new Error("SESSION");
  const res = await fetch(CONFIG.supabase.url + "/storage/v1/object/photos/" + chemin, { method: "POST",
    headers: { apikey: CONFIG.supabase.cle, Authorization: "Bearer " + s.access_token, "Content-Type": blob.type || "image/jpeg" }, body: blob });
  if (!res.ok) { const e = new Error("Photo " + res.status); e.status = res.status; throw e; }
  return CONFIG.supabase.url + "/storage/v1/object/public/photos/" + chemin;
}

/** Envoi d'un fichier dans un dossier du stockage (photos, videos). Rend son adresse publique. */
async function admEnvoyerFichier(fichier, dossierStockage, chemin) {
  const s = await sessionValide();
  if (!s) throw new Error("SESSION");
  const res = await fetch(CONFIG.supabase.url + "/storage/v1/object/" + dossierStockage + "/" + chemin, { method: "POST",
    headers: { apikey: CONFIG.supabase.cle, Authorization: "Bearer " + s.access_token, "Content-Type": fichier.type || "application/octet-stream" }, body: fichier });
  if (!res.ok) { const e = new Error("Fichier " + res.status); e.status = res.status; throw e; }
  return CONFIG.supabase.url + "/storage/v1/object/public/" + dossierStockage + "/" + chemin;
}
const admNomFichier = (ext) => (crypto.randomUUID ? crypto.randomUUID() : Date.now() + "-" + Math.random().toString(36).slice(2)) + ext;

/** Vidéo facultative d'un intervenant (verticale 9:16, 50 Mo au plus) et ses sous-titres (admin). */
function admVideoHtml(id, url, sousTitres, avecSousTitres) {
  return '<div class="adm-champ"><span>' + esc(t("adm.video")) + '</span>' +
    '<div id="' + id + '" data-url="' + esc(url || "") + '" data-st="' + esc(sousTitres || "") + '">' +
      (url ? '<video class="adm-video" src="' + esc(url) + '" controls playsinline preload="metadata"></video>' : '<span class="member-note">' + esc(t("adm.videoAucune")) + '</span>') + '</div>' +
    '<label class="cta ghost adm-photo-btn">' + esc(url ? t("adm.videoRemplacer") : t("adm.videoChoisir")) +
      '<input type="file" accept="video/mp4,video/quicktime,video/webm" id="' + id + '-fichier" hidden></label>' +
    (url ? '<button type="button" class="lien-bouton" id="' + id + '-retirer">' + esc(t("adm.videoRetirer")) + '</button>' : '') +
    (avecSousTitres ? '<label class="lien-bouton adm-photo-btn">' + esc(sousTitres ? t("adm.stRemplacer") : t("adm.stAjouter")) +
      '<input type="file" accept=".vtt,text/vtt" id="' + id + '-st" hidden></label>' : '') +
    '<small class="member-note">' + esc(t("adm.videoAide")) + '</small>' +
    '<div class="member-note" id="' + id + '-note" role="status"></div></div>';
}
function admBrancherVideo(id, dossier) {
  const zone = document.getElementById(id), note = document.getElementById(id + "-note");
  document.getElementById(id + "-fichier").addEventListener("change", async (ev) => {
    const f = ev.target.files && ev.target.files[0];
    if (!f) return;
    if (f.size > 52428800) { note.textContent = t("adm.videoTropLourde"); return; }
    if (!/^video\/(mp4|quicktime|webm)$/.test(f.type)) { note.textContent = t("adm.videoFormat"); return; }
    note.textContent = t("adm.videoEnvoi");
    try {
      const url = await admEnvoyerFichier(f, "videos", dossier + "/" + admNomFichier(f.type === "video/webm" ? ".webm" : f.type === "video/quicktime" ? ".mov" : ".mp4"));
      zone.dataset.url = url;
      zone.innerHTML = '<video class="adm-video" src="' + esc(url) + '" controls playsinline preload="metadata"></video>';
      note.textContent = t("adm.videoOk");
    } catch (e) { note.textContent = e.status === 413 ? t("adm.videoTropLourde") : admErreur(e); }
  });
  const retirer = document.getElementById(id + "-retirer");
  if (retirer) retirer.addEventListener("click", () => {
    zone.dataset.url = ""; zone.dataset.st = "";
    zone.innerHTML = '<span class="member-note">' + esc(t("adm.videoRetiree")) + '</span>'; retirer.remove();
  });
  const st = document.getElementById(id + "-st");
  if (st) st.addEventListener("change", async () => {
    const f = st.files && st.files[0];
    if (!f) return;
    note.textContent = t("adm.videoEnvoi");
    try {
      zone.dataset.st = await admEnvoyerFichier(new File([f], "st.vtt", { type: "text/vtt" }), "videos", dossier + "/" + admNomFichier(".vtt"));
      note.textContent = t("adm.stOk");
    } catch (e) { note.textContent = admErreur(e); }
  });
}

/** Traduction automatique (Claude, fonction « traduire ») des champs dont le français est rempli.
    tout = false : seulement les langues encore vides. Rend true si quelque chose a été traduit. */
async function admTraduireChamps(bases, tout) {
  const textes = {};
  bases.forEach((b) => {
    const fr = admVal(b + "-fr");
    if (fr && (tout || ADM_TRAD.some((l) => !admVal(b + "-" + l)))) textes[b.replace(/-/g, "_")] = fr;
  });
  if (!Object.keys(textes).length) return false;
  const s = await sessionValide();
  if (!s) return false;
  const res = await fetch("/.netlify/functions/traduire", { method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + s.access_token },
    body: JSON.stringify({ textes, langues: ADM_TRAD }) });
  if (!res.ok) return false;
  const d = await res.json();
  let fait = false;
  Object.keys(textes).forEach((k) => ADM_TRAD.forEach((l) => {
    const champ = document.getElementById(k.replace(/_/g, "-") + "-" + l);
    if (champ && d[l] && d[l][k] && (tout || !champ.value.trim())) { champ.value = d[l][k]; fait = true; }
  }));
  return fait;
}
function admBoutonTraduire(id) {
  return '<button type="button" class="cta ghost" id="' + id + '">' + esc(t("adm.traduire")) + '</button>' +
    '<div class="member-note" id="' + id + '-note" role="status"></div>';
}
function admBrancherTraduire(id, bases) {
  document.getElementById(id).addEventListener("click", async (ev) => {
    const b = ev.currentTarget, note = document.getElementById(id + "-note");
    b.disabled = true; note.textContent = t("adm.traductionEnCours");
    const ok = await admTraduireChamps(bases, true).catch(() => false);
    note.textContent = ok ? t("adm.traductionFaite") : t("adm.traductionIndispo");
    $$("details.adm-trad").forEach((d) => { if (ok) d.open = true; });
    b.disabled = false;
  });
}

/* Ouvrir « Traduire en anglais et espagnol » lance la traduction des langues encore vides. */
document.addEventListener("toggle", (ev) => {
  const d = ev.target;
  if (!d.matches || !d.matches("details.adm-trad[data-base]") || !d.open || d.dataset.traduit) return;
  d.dataset.traduit = "1";
  const s = d.querySelector("summary"), libelle = s.textContent;
  s.textContent = t("adm.traductionEnCours");
  admTraduireChamps([d.dataset.base], false).catch(() => false).finally(() => { s.textContent = libelle; });
}, true);

/** Bloc photo d'un formulaire : aperçu + bouton d'envoi. La valeur est gardée dans data-url. */
function admPhotoHtml(id, url) {
  return '<div class="adm-champ"><span>' + esc(t("adm.photo")) + '</span>' +
    '<div class="adm-photo" id="' + id + '" data-url="' + esc(url || "") + '">' +
      (url ? '<img src="' + esc(url) + '" alt="">' : '<span class="adm-photo-vide">' + esc(t("adm.photoAucune")) + '</span>') +
    '</div>' +
    '<label class="cta ghost adm-photo-btn">' + esc(t("adm.photoChoisir")) +
      '<input type="file" accept="image/*" id="' + id + '-fichier" hidden></label>' +
    '<div class="member-note" id="' + id + '-note" role="status"></div></div>';
}
/* Recadrage (22/11) : quand la photo n'a pas le format voulu (4:3 pour une expérience, carré pour un
   portrait), une fenêtre permet de la déplacer et de zoomer dans le cadre avant l'envoi.
   Rend le fichier recadré (JPEG), le fichier tel quel s'il a déjà le bon format, ou null si annulé. */
function admRecadrer(fichier, ratio, ideal) {
  return new Promise(async (fin) => {
    let img;
    try { img = await createImageBitmap(fichier, { imageOrientation: "from-image" }); }
    catch (e) { try { img = await createImageBitmap(fichier); } catch (e2) { fin(fichier); return; } }
    if (Math.abs(img.width / img.height - ratio) / ratio < 0.01) { fin(fichier); return; }
    const boite = document.createElement("div");
    boite.className = "adm-recadrage";
    boite.setAttribute("role", "dialog"); boite.setAttribute("aria-modal", "true");
    const petite = Math.min(img.width, img.height * ratio) < ideal;
    boite.innerHTML = '<div class="adm-recadrage-boite"><h2 class="adm-titre">' + esc(t("adm.recadrerTitre")) + '</h2>' +
      '<p class="member-note">' + esc(t(ratio === 1 ? "adm.recadrerAideCarre" : "adm.recadrerAide")) + '</p>' +
      (petite ? '<p class="member-note adm-recadrage-petite">' + esc(tx("adm.recadrerPetite", { w: ideal, h: Math.round(ideal / ratio) })) + '</p>' : '') +
      '<canvas class="adm-recadrage-toile"></canvas>' +
      '<label class="adm-champ"><span>' + esc(t("adm.recadrerZoom")) + '</span><input type="range" min="1" max="4" step="0.01" value="1" class="adm-recadrage-zoom"></label>' +
      '<div class="adm-boutons"><button type="button" class="cta ghost" data-r="annuler">' + esc(t("adm.recadrerAnnuler")) + '</button>' +
      '<button type="button" class="cta ocre" data-r="ok">' + esc(t("adm.recadrerOk")) + '</button></div></div>';
    document.body.appendChild(boite);
    const toile = boite.querySelector("canvas"), ctx = toile.getContext("2d"), zoom = boite.querySelector("input");
    toile.width = 800; toile.height = Math.round(800 / ratio);
    const couvre = Math.max(toile.width / img.width, toile.height / img.height);
    let z = 1, cx = img.width / 2, cy = img.height / 2;
    const borner = () => {
      const e = couvre * z, dx = toile.width / 2 / e, dy = toile.height / 2 / e;
      cx = Math.min(img.width - dx, Math.max(dx, cx)); cy = Math.min(img.height - dy, Math.max(dy, cy));
    };
    const peindre = () => {
      borner();
      const e = couvre * z;
      ctx.fillStyle = "#000"; ctx.fillRect(0, 0, toile.width, toile.height);
      ctx.drawImage(img, toile.width / 2 - cx * e, toile.height / 2 - cy * e, img.width * e, img.height * e);
    };
    peindre();
    let pris = null;
    toile.addEventListener("pointerdown", (ev) => { pris = { x: ev.clientX, y: ev.clientY }; toile.setPointerCapture(ev.pointerId); });
    toile.addEventListener("pointermove", (ev) => {
      if (!pris) return;
      const f = toile.width / toile.clientWidth / (couvre * z);
      cx -= (ev.clientX - pris.x) * f; cy -= (ev.clientY - pris.y) * f;
      pris = { x: ev.clientX, y: ev.clientY }; peindre();
    });
    const lacher = () => { pris = null; };
    toile.addEventListener("pointerup", lacher); toile.addEventListener("pointercancel", lacher);
    zoom.addEventListener("input", () => { z = +zoom.value; peindre(); });
    const fermer = (resultat) => { boite.remove(); document.removeEventListener("keydown", clavier); fin(resultat); };
    const clavier = (ev) => { if (ev.key === "Escape") fermer(null); };
    document.addEventListener("keydown", clavier);
    boite.querySelector('[data-r="annuler"]').addEventListener("click", () => fermer(null));
    boite.querySelector('[data-r="ok"]').addEventListener("click", () => {
      const e = couvre * z, lw = toile.width / e, lh = toile.height / e;
      const w = Math.round(Math.min(ideal, lw)), h = Math.round(w / ratio);
      const c = document.createElement("canvas"); c.width = w; c.height = h;
      c.getContext("2d").drawImage(img, cx - lw / 2, cy - lh / 2, lw, lh, 0, 0, w, h);
      c.toBlob((b) => fermer(b || fichier), "image/jpeg", 0.88);
    });
  });
}

/** ratio (facultatif) : format voulu, largeur / hauteur ; ideal : largeur idéale en pixels. */
function admBrancherPhoto(id, dossier, ratio, ideal) {
  const input = document.getElementById(id + "-fichier");
  input.addEventListener("change", async () => {
    let f = input.files && input.files[0];
    if (!f) return;
    const note = document.getElementById(id + "-note");
    if (ratio) {
      f = await admRecadrer(f, ratio, ideal || 1600);
      input.value = "";
      if (!f) { note.textContent = ""; return; }   // recadrage annulé : rien n'est envoyé
    }
    note.textContent = t("adm.photoEnvoi");
    try {
      const url = await admEnvoyerPhoto(f, dossier);
      const zone = document.getElementById(id);
      zone.dataset.url = url;
      zone.innerHTML = '<img src="' + esc(url) + '" alt="">';
      note.textContent = t("adm.photoOk");
    } catch (e) { note.textContent = admErreur(e); }
  });
}

/** Champs traduisibles : français visible, anglais et espagnol repliés. */
function admTexteHtml(base, libelle, valeur, long) {
  const v = valeur || {};
  const champ = (l) => long
    ? '<textarea class="input-field adm-texte" id="' + base + '-' + l + '" rows="5">' + esc(v[l] || "") + '</textarea>'
    : '<input class="input-field" id="' + base + '-' + l + '" value="' + esc(v[l] || "") + '">';
  return '<label class="adm-champ"><span>' + esc(libelle) + '</span>' + champ("fr") + '</label>' +
    '<details class="adm-trad" data-base="' + base + '"><summary>' + esc(t("adm.traductions")) + '</summary>' +
      ADM_TRAD.map((l) => '<label class="adm-champ"><span>' + esc(LANG_META[l].nom) + '</span>' + champ(l) + '</label>').join("") +
    '</details>';
}
const admSelect = (id, options, valeur) => '<select class="input-field" id="' + id + '">' +
  options.map((o) => '<option value="' + esc(o[0]) + '"' + (o[0] === (valeur == null ? "" : valeur) ? " selected" : "") + '>' + esc(o[1]) + '</option>').join("") + '</select>';
const admCase = (id, libelle, coche) => '<label class="resa-case"><input type="checkbox" id="' + id + '"' + (coche ? " checked" : "") + '><span>' + esc(libelle) + '</span></label>';
const admNombre = (id, libelle, valeur, aide) => '<label class="adm-champ"><span>' + esc(libelle) + '</span>' +
  '<input class="input-field" id="' + id + '" inputmode="decimal" value="' + esc(valeur == null ? "" : valeur) + '">' +
  (aide ? '<small class="member-note">' + esc(aide) + '</small>' : '') + '</label>';
function admLanguesHtml(id, choix) {
  return '<div class="adm-champ"><span>' + esc(t("adm.langues")) + '</span><div class="adm-puces" id="' + id + '">' +
    ADM_LANGUES.map((l) => '<label class="chip adm-puce' + ((choix || []).includes(l) ? " active" : "") + '"><input type="checkbox" value="' + l + '"' +
      ((choix || []).includes(l) ? " checked" : "") + ' hidden>' + esc(LANG_META[l].code) + '</label>').join("") + '</div></div>';
}
function admBrancherLangues(id) {
  $$("#" + id + " input").forEach((c) => c.addEventListener("change", () => c.parentElement.classList.toggle("active", c.checked)));
}
const admLanguesChoisies = (id) => $$("#" + id + " input:checked").map((c) => c.value);

/* ---------- Écran principal ---------- */

/** role : "admin" ou "intervenant" (espace intervenant, étape 6.3 : mêmes écrans, droits réduits par la base). */
async function renderAdmin(corps, nom, role, moi) {
  ADM.nom = nom || ADM.nom;
  if (role) { if (role !== ADM.role) ADM.onglet = role === "intervenant" ? "seances" : "fiches"; ADM.role = role; ADM.moi = moi || null; }
  const inter = ADM.role === "intervenant";
  // Onglet demandé par « Mon compte » ou par un lien d'email (#espace=demandes), même après la connexion.
  let voulu = ADM.ongletVoulu;
  try { voulu = voulu || localStorage.getItem("ongletVoulu"); localStorage.removeItem("ongletVoulu"); } catch (e) { /* rien */ }
  ADM.ongletVoulu = null;
  if (voulu && (inter ? ["seances", "inscrits", "intervenants", "fiches"] : ["valider", "fiches", "seances", "intervenants", "adhesions", "demandes"]).includes(voulu)) {
    ADM.onglet = voulu;
  }
  corps.innerHTML = '<div class="loading">' + esc(t("member.loading")) + '</div>';
  try {
    const [exps, ints, contacts, profils, props, dNouvelles, cNouvelles] = await Promise.all([
      supaConnecte("experiences?select=*&supprimee_le=is.null&order=ordre.asc,cree_le.desc" + (inter ? "&intervenant_id=eq." + ADM.moi : "")),
      supaConnecte("intervenants?select=*&order=nom.asc" + (inter ? "&id=eq." + ADM.moi : "")),
      supaConnecte("intervenants_contacts?select=intervenant_id,email"),
      inter ? Promise.resolve([]) : supaConnecte("profils?select=intervenant_id&role=eq.intervenant"),
      supaConnecte("propositions?select=*&statut=eq.en_attente&order=cree_le.asc"),
      inter ? Promise.resolve([]) : supaConnecte("demandes_groupes?select=id&statut=eq.nouvelle"),
      inter ? Promise.resolve([]) : supaConnecte("candidatures?select=id&statut=eq.nouvelle"),
    ]);
    ADM.props = props;
    ADM.nonTraitees = (dNouvelles || []).length;   // candidatures : onglet Validations (22/11)
    ADM.nCands = (cNouvelles || []).length;
    ADM.exps = exps; ADM.ints = ints;
    ADM.contacts = {}; contacts.forEach((c) => { ADM.contacts[c.intervenant_id] = c.email; });
    ADM.comptes = {}; profils.forEach((p) => { if (p.intervenant_id) ADM.comptes[p.intervenant_id] = true; });
  } catch (e) {
    if (e.message === "SESSION") { renderEspace(t("espace.expire")); return; }
    corps.innerHTML = '<div class="member-note">' + esc(t("member.error")) + '</div>';
    return;
  }
  await peindreAdmin(corps);
  // Lien d'email « Créez votre première séance », ou « Proposer une expérience » depuis Mon compte.
  if (inter && ADM.nouvelleSeance && ADM.exps.some(admExpValidee)) peindreFormSeance(corps, null);
  else if (inter && ADM.nouvelleExperience) peindreFormExperience(corps, null);
  ADM.nouvelleSeance = false; ADM.nouvelleExperience = false;
}

function admEtatFiche(e) {
  if (e.a_valider) return ["avalider", t("adm.etatAValider")];
  if (e.refusee_le && !e.publie) return ["suspendue", t("adm.etatARevoir")];
  if (e.publie && e.actif) return ["enligne", t("adm.etatEnLigne")];
  if (e.publie) return ["suspendue", t("adm.etatSuspendue")];
  return ["brouillon", t("adm.etatBrouillon")];
}

function peindreAdmin(corps) {
  const aValider = ADM.exps.filter((e) => e.a_valider).length + (ADM.nCands || 0) + (ADM.props || []).length;
  const ongletSimple = (k, libelle) => '<button type="button" class="chip' + (ADM.onglet === k ? " active" : "") + '" data-adm-onglet="' + k + '">' + esc(libelle) + '</button>';
  const onglet = (k, libelle, n) => '<button type="button" class="chip' + (ADM.onglet === k ? " active" : "") + '" data-adm-onglet="' + k + '">' +
    esc(libelle) + ' · ' + n + '</button>';
  const inter = ADM.role === "intervenant";
  corps.innerHTML =
    '<h1 class="espace-titre">' + esc(tx("espace.bonjour", { nom: ADM.nom })) + '</h1>' +
    '<div class="adm-sous">' + esc(inter ? t("adm.sousIntervenant") : t("adm.sous")) + '</div>' +
    (inter ? ''
      : (aValider && ADM.onglet !== "valider" ? '<button type="button" class="resa-etat adm-a-traiter" data-adm-onglet="valider">' + esc(tx("adm.aValiderNote", { n: aValider })) + '</button>' : '') +
        (ADM.nonTraitees ? '<button type="button" class="resa-etat adm-a-traiter" data-adm-onglet="demandes">' + esc(tx("adm.nonTraitees", { n: ADM.nonTraitees })) + '</button>' : '')) +
    '<div class="filter-chips adm-onglets" role="tablist">' +
      (inter
        ? ongletSimple("seances", t("adm.mesSeances")) + ongletSimple("inscrits", t("adm.mesInscrits")) +
          ongletSimple("fiches", t("adm.mesExperiences")) + ongletSimple("intervenants", t("adm.maFiche"))
        : (aValider ? onglet("valider", t("adm.validations"), aValider).replace('class="chip', 'class="chip adm-onglet-alerte') : ongletSimple("valider", t("adm.validations"))) +
          onglet("fiches", t("adm.fiches"), ADM.exps.length) + ongletSimple("seances", t("adm.seances")) +
          onglet("intervenants", t("adm.intervenants"), ADM.ints.length) + ongletSimple("adhesions", t("adm.adhesions")) +
          (ADM.nonTraitees ? onglet("demandes", t("adm.demandes"), ADM.nonTraitees).replace('class="chip', 'class="chip adm-onglet-alerte') : ongletSimple("demandes", t("adm.demandes")))) +
    '</div>' +
    '<div id="adm-zone"></div>' +
    '<button type="button" class="cta ghost" id="espace-deconnexion">' + esc(t("espace.deconnexion")) + '</button>';
  $$("[data-adm-onglet]").forEach((b) => b.addEventListener("click", () => { ADM.onglet = b.dataset.admOnglet; peindreAdmin(corps); }));
  $("#espace-deconnexion").addEventListener("click", deconnecter);
  if (inter && ADM.onglet === "intervenants") { peindreFormIntervenant(corps, ADM.ints[0] || null); return; }
  if (inter && ADM.onglet === "seances") return peindreTableauIntervenant(corps);   // promesse : les messages s'affichent après le chargement
  return ({ fiches: peindreListeFiches, seances: peindreListeSeances, intervenants: peindreListeIntervenants, inscrits: peindreMesInscrits,
     adhesions: peindreAdhesions, demandes: peindreDemandes, valider: peindreValidations }[ADM.onglet] || peindreListeFiches)(corps);
}

function peindreListeFiches(corps) {
  const zone = $("#adm-zone");
  const nomInt = (id) => (ADM.ints.find((i) => i.id === id) || {}).nom || "";
  zone.innerHTML =
    '<button type="button" class="cta fee" id="adm-nouvelle-fiche">' + esc(ADM.role === "intervenant" ? t("adm.proposerExperience") : t("adm.nouvelleFiche")) + '</button>' +
    '<div id="adm-reprise"></div>' +
    (ADM.exps.length ? '' : '<div class="member-note">' + esc(t("adm.aucuneFiche")) + '</div>') +
    '<div class="adm-liste">' + ADM.exps.map((e) => {
      const etat = admEtatFiche(e);
      return '<button type="button" class="adm-ligne" data-adm-fiche="' + esc(e.id) + '">' +
        (e.photo_url ? '<img class="adm-vignette" src="' + esc(e.photo_url) + '" alt="" loading="lazy">' : '<span class="adm-vignette"></span>') +
        '<span class="adm-ligne-corps"><span class="adm-ligne-titre">' + esc((e.titre && e.titre.fr) || e.slug) + '</span>' +
          '<span class="adm-ligne-meta">' + esc(t("adm.type." + e.type)) + (nomInt(e.intervenant_id) ? ' · ' + esc(nomInt(e.intervenant_id)) : '') + '</span></span>' +
        '<span class="adm-etat adm-etat-' + etat[0] + '">' + esc(etat[1]) + '</span>' +
      '</button>';
    }).join("") + '</div>';
  const ouvrir = ADM.role === "intervenant" ? peindreFormExperience : peindreFormFiche;
  $("#adm-nouvelle-fiche").addEventListener("click", () => ouvrir(corps, null));
  $$("[data-adm-fiche]").forEach((b) => b.addEventListener("click", () => ouvrir(corps, ADM.exps.find((e) => e.id === b.dataset.admFiche))));
  if (ADM.role !== "intervenant") proposerReprise(corps);
}

function peindreListeIntervenants(corps) {
  const zone = $("#adm-zone");
  zone.innerHTML =
    '<button type="button" class="cta fee" id="adm-nouvel-int">' + esc(t("adm.nouvelIntervenant")) + '</button>' +
    (ADM.ints.length ? '' : '<div class="member-note">' + esc(t("adm.aucunIntervenant")) + '</div>') +
    '<div class="adm-liste">' + ADM.ints.map((i) => {
      const etat = ADM.comptes[i.id] ? ["enligne", t("adm.compteOuvert")] : ["brouillon", t("adm.compteFerme")];
      return '<button type="button" class="adm-ligne" data-adm-int="' + esc(i.id) + '">' +
        (i.photo_url ? '<img class="adm-vignette rond" src="' + esc(i.photo_url) + '" alt="" loading="lazy">' :
          '<span class="adm-vignette rond adm-initiales">' + esc(String(i.nom || "?").split(/\s+/).map((m) => m[0]).join("").slice(0, 2).toUpperCase()) + '</span>') +
        '<span class="adm-ligne-corps"><span class="adm-ligne-titre">' + esc(i.nom) + '</span>' +
          '<span class="adm-ligne-meta">' + esc(t("adm.typeInt." + i.type)) + (i.publie ? '' : ' · ' + esc(t("adm.nonPublie"))) + '</span></span>' +
        '<span class="adm-etat adm-etat-' + etat[0] + '">' + esc(etat[1]) + '</span>' +
      '</button>';
    }).join("") + '</div>';
  $("#adm-nouvel-int").addEventListener("click", () => peindreFormIntervenant(corps, null));
  $$("[data-adm-int]").forEach((b) => b.addEventListener("click", () => peindreFormIntervenant(corps, ADM.ints.find((i) => i.id === b.dataset.admInt))));
}

/* ---------- Fiche (expérience) ---------- */

function peindreFormFiche(corps, e) {
  const n = !e;
  e = e || { type: "visite_guidee", titre: {}, accroche: {}, description: {}, langues: ["fr"], point_rdv: {}, participants_min: 1,
    prereservation_centimes: 500, frais_annulation_tardive_centimes: 1000, actif: true, publie: false };
  const zone = $("#adm-zone");
  window.scrollTo(0, 0);
  zone.innerHTML =
    '<form id="adm-form" class="adm-form" novalidate>' +
      '<h2 class="adm-titre">' + esc(n ? t("adm.nouvelleFiche") : ((e.titre && e.titre.fr) || e.slug)) + '</h2>' +
      (e.a_valider ? '<div class="resa-etat">' + esc(t("adm.proposeeParIntervenant")) + '</div>' : '') +
      '<label class="adm-champ"><span>' + esc(t("adm.typeFiche")) + '</span>' +
        admSelect("f-type", ADM_TYPES_EXP.map((k) => [k, t("adm.type." + k)]), e.type) + '</label>' +
      admTexteHtml("f-titre", t("adm.titreFiche"), e.titre) +
      admTexteHtml("f-accroche", t("adm.accroche"), e.accroche) +
      admTexteHtml("f-description", t("adm.description"), e.description, true) +
      '<label class="adm-champ"><span>' + esc(t("adm.intervenant")) + '</span>' +
        admSelect("f-int", [["", t("adm.aucun")]].concat(ADM.ints.map((i) => [i.id, i.nom])), e.intervenant_id || "") + '</label>' +
      admNombre("f-duree", t("adm.duree"), e.duree_minutes, t("adm.dureeAide")) +
      admLanguesHtml("f-langues", e.langues) +
      admPhotoHtml("f-photo", e.photo_url) +
      admTexteHtml("f-rdv", t("adm.rdv"), e.point_rdv) +
      '<div class="adm-champ"><span>' + esc(t("adm.rdvCarte")) + '</span><div class="adm-carte" id="f-carte"></div>' +
        '<small class="member-note" id="f-carte-note">' + esc(e.point_rdv_lat != null ? t("adm.rdvPlace") : t("adm.rdvAide")) + '</small></div>' +
      '<h3 class="adm-sous-titre">' + esc(t("adm.prixEtPlaces")) + '</h3>' +
      '<div class="adm-grille">' +
        admNombre("f-prix", t("adm.prix"), admEuros(e.prix_centimes)) +
        admNombre("f-preresa", t("adm.prereservation"), admEuros(e.prereservation_centimes)) +
        admNombre("f-libre", t("adm.prixLibreMin"), admEuros(e.prix_libre_min_centimes)) +
        admNombre("f-audio", t("adm.optionAudio"), admEuros(e.option_audioguide_centimes)) +
        admNombre("f-frais", t("adm.fraisTardifs"), admEuros(e.frais_annulation_tardive_centimes)) +
        admNombre("f-max", t("adm.placesMax"), e.capacite_max) +
        admNombre("f-min", t("adm.participantsMin"), e.participants_min) +
        admNombre("f-age", t("adm.ageMin"), e.age_minimum) +
      '</div>' +
      admCase("f-tel", t("adm.telObligatoire"), e.telephone_obligatoire) +
      admCase("f-privat", t("adm.privatisable"), e.privatisable) +
      '<h3 class="adm-sous-titre adm-admin">' + esc(t("adm.visibilite")) + '</h3>' +
      admCase("f-publie", t("adm.publier"), e.publie) +
      admCase("f-relues", t("adm.relues"), (e.langues_relues || []).includes("en")) +
      (n ? '' : admCase("f-actif", t("adm.actif"), e.actif)) +
      '<div class="member-note adm-admin">' + esc(t("adm.publierAide")) + '</div>' +
      (!n && e.type === "autoguidee" && ADM.role !== "intervenant"
        ? '<button type="button" class="cta ghost" id="f-etapes">' + esc(tx("adm.etapesBouton", { n: e.nb_etapes || 0 })) + '</button>' : '') +
      admBoutonTraduire("f-traduire") +
      '<button type="submit" class="cta fee" id="f-enregistrer">' + esc(t("adm.enregistrer")) + '</button>' +
      '<div class="resa-erreur" id="f-note" role="alert"></div>' +
(n ? '' : '<div class="adm-encart adm-suppression"><b>' + esc(t("adm.supprimerExp")) + '</b><p class="member-note">' + esc(t("adm.supprimerExpAide")) + '</p>' +
        '<button type="button" class="cta ghost adm-danger" id="f-supprimer">' + esc(t("adm.supprimerExp")) + '</button>' +
        '<div class="resa-erreur" id="f-suppr-note" role="alert"></div></div>') +
            '<button type="button" class="cta ghost" id="f-retour">' + esc(t("adm.retourListe")) + '</button>' +
    '</form>';
  admBrancherLangues("f-langues");
  const inter = ADM.role === "intervenant";
  if (inter) {   // l'association garde le prix, la pré-réservation, la publication et le titre d'une visite en ligne
    $$(".adm-admin").forEach((x) => x.remove());
    ["f-int", "f-prix", "f-preresa", "f-libre", "f-frais", "f-age", "f-tel", "f-privat", "f-publie", "f-actif", "f-relues", "f-audio"].forEach((id) => {
      const el = document.getElementById(id); if (el) el.closest("label").remove(); });
    $$("#f-type option").forEach((o) => { if (!["visite_guidee", "atelier"].includes(o.value)) o.remove(); });
    if (!n) $("#f-type").disabled = true;
    if (e.publie) $$("[id^=f-titre-]").forEach((x) => { x.disabled = true; });
    if (n) $("#f-enregistrer").textContent = t("adm.envoyerProposition");
  }
  admBrancherPhoto("f-photo", inter ? "fiches/" + ADM.moi : "fiches", 4 / 3, 1600);
  admBrancherTraduire("f-traduire", ["f-titre", "f-accroche", "f-description", "f-rdv"]);
  if ($("#f-etapes")) $("#f-etapes").addEventListener("click", () => peindreEtapesAdmin(corps, e));
  const pos = { lat: e.point_rdv_lat, lng: e.point_rdv_lng };
  admCarte("f-carte", pos, () => { $("#f-carte-note").textContent = t("adm.rdvPlace"); });
  $("#f-retour").addEventListener("click", () => peindreAdmin(corps));
  if (!n) admBrancherSuppressionExp(corps, e, "f");
  $("#adm-form").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const note = $("#f-note"), b = $("#f-enregistrer");
    if (!admVal("f-titre-fr")) { note.textContent = t("adm.titreManquant"); return; }
    $("#f-enregistrer").disabled = true; note.textContent = t("adm.traductionEnCours");
    await admTraduireChamps(["f-titre", "f-accroche", "f-description", "f-rdv"], false).catch(() => false);   // une seule fois, à l'enregistrement
    const titre = admTraduit("f-titre");
    const publie = admCoche("f-publie");
    const donnees = {
      type: admVal("f-type"), titre, accroche: admTraduit("f-accroche"), description: admTraduit("f-description"),
      intervenant_id: admVal("f-int") || null, duree_minutes: admEntier(admVal("f-duree")),
      langues: admLanguesChoisies("f-langues").length ? admLanguesChoisies("f-langues") : ["fr"],
      photo_url: $("#f-photo").dataset.url || null, point_rdv: admTraduit("f-rdv"),
      point_rdv_lat: pos.lat == null ? null : pos.lat, point_rdv_lng: pos.lng == null ? null : pos.lng,
      prix_centimes: admCentimes(admVal("f-prix")), prereservation_centimes: admCentimes(admVal("f-preresa")),
      prix_libre_min_centimes: admCentimes(admVal("f-libre")), option_audioguide_centimes: admCentimes(admVal("f-audio")),
      frais_annulation_tardive_centimes: admCentimes(admVal("f-frais")) == null ? 1000 : admCentimes(admVal("f-frais")),
      capacite_max: admEntier(admVal("f-max")), participants_min: admEntier(admVal("f-min")) || 1,
      age_minimum: admEntier(admVal("f-age")), telephone_obligatoire: admCoche("f-tel"), privatisable: admCoche("f-privat"),
      publie,
    };
    if (!n && !inter) donnees.actif = admCoche("f-actif");
    if (!inter) donnees.langues_relues = admCoche("f-relues") ? ["fr", "en", "es"] : ["fr"];
    if (publie) donnees.a_valider = false;   // publier une proposition, c'est la valider
    if (inter) {   // seuls les champs que la base laisse à l'intervenant (interne.experiences_garde)
      const libres = ["photo_url", "description", "accroche", "duree_minutes", "langues", "point_rdv", "point_rdv_lat", "point_rdv_lng",
        "capacite_max", "participants_min"].concat(n ? ["type", "titre"] : e.publie ? [] : ["titre"]);
      Object.keys(donnees).forEach((k) => { if (!libres.includes(k)) delete donnees[k]; });
    }
    b.disabled = true; note.textContent = t("member.loading");
    try {
      if (n) {
        if (!inter) {   // pour un intervenant, la base fixe l'adresse, la localité et l'état « à valider »
          donnees.slug = admSlug(titre.fr, ADM.exps.map((x) => x.slug));
          donnees.localite_id = (currentLocalite() || {}).id || CONFIG.localiteParDefaut;
        }
        await supaEcrire("POST", "experiences", donnees);
      } else {
        await supaEcrire("PATCH", "experiences?id=eq." + e.id, donnees);
      }
      VISITES_CACHE = null;   // l'accueil relira les fiches
      await renderAdmin(corps);
      const ok = $("#adm-zone"); if (ok) ok.insertAdjacentHTML("afterbegin", '<div class="resa-etat">' + esc(t("adm.enregistre")) + '</div>');
    } catch (err) {
      note.textContent = admErreur(err);
      b.disabled = false;
    }
  });
}

/** Petite carte pour placer le point de rendez-vous d'un geste. */
function admCarte(id, pos, quandPlace) {
  const el = document.getElementById(id);
  if (!el || typeof L === "undefined") { if (el) el.textContent = t("errors.mapIndispo"); return; }
  const loc = currentLocalite() || {};
  const centre = pos.lat != null ? [pos.lat, pos.lng]
    : loc.centre ? [loc.centre.lat, loc.centre.lng] : [48.8867, 2.3431];
  const carte = L.map(el, { zoomControl: true, attributionControl: true }).setView(centre, 16);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, subdomains: "abc",
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>' }).addTo(carte);
  let repere = pos.lat != null ? L.marker(centre, { icon: mapPinDivIcon("depart") }).addTo(carte) : null;
  carte.on("click", (ev) => {
    pos.lat = Math.round(ev.latlng.lat * 1e6) / 1e6; pos.lng = Math.round(ev.latlng.lng * 1e6) / 1e6;
    if (repere) repere.setLatLng(ev.latlng); else repere = L.marker(ev.latlng, { icon: mapPinDivIcon("depart") }).addTo(carte);
    quandPlace();
  });
  setTimeout(() => carte.invalidateSize(), 80);
}

/* ---------- Intervenant ---------- */

function peindreFormIntervenant(corps, i) {
  const n = !i;
  i = i || { type: "guide", role: {}, bio: {}, langues: ["fr"], publie: false };
  const email = n ? "" : (ADM.contacts[i.id] || "");
  const zone = $("#adm-zone");
  window.scrollTo(0, 0);
  zone.innerHTML =
    '<form id="adm-form" class="adm-form" novalidate>' +
      '<h2 class="adm-titre">' + esc(n ? t("adm.nouvelIntervenant") : i.nom) + '</h2>' +
      '<label class="adm-champ"><span>' + esc(t("adm.typeIntervenant")) + '</span>' +
        admSelect("i-type", ADM_TYPES_INT.map((k) => [k, t("adm.typeInt." + k)]), i.type) + '</label>' +
      '<label class="adm-champ"><span>' + esc(t("adm.nom")) + '</span><input class="input-field" id="i-nom" value="' + esc(i.nom || "") + '" required></label>' +
      admTexteHtml("i-role", t("adm.metier"), i.role) +
      admTexteHtml("i-bio", t("adm.bio"), i.bio, true) +
      admPhotoHtml("i-photo", i.photo_url) +
      admVideoHtml("i-video", i.video_url, i.sous_titres_url, ADM.role !== "intervenant") +
      admLanguesHtml("i-langues", i.langues) +
      '<label class="adm-champ"><span>' + esc(t("adm.instagram")) + '</span><input class="input-field" id="i-insta" value="' + esc(i.instagram || "") + '" placeholder="@"></label>' +
      '<h3 class="adm-sous-titre">' + esc(t("adm.contact")) + '</h3>' +
      '<label class="adm-champ"><span>' + esc(t("adm.emailContact")) + '</span>' +
        '<input class="input-field" id="i-email" type="email" inputmode="email" autocomplete="off" value="' + esc(email) + '">' +
        '<small class="member-note">' + esc(t("adm.emailAide")) + '</small></label>' +
      admCase("i-publie", t("adm.publierIntervenant"), i.publie) +
      admBoutonTraduire("i-traduire") +
      '<button type="submit" class="cta fee" id="i-enregistrer">' + esc(t("adm.enregistrer")) + '</button>' +
      '<div class="resa-erreur" id="i-note" role="alert"></div>' +
      (n ? '' :
        '<div class="adm-invitation">' +
          '<h3 class="adm-sous-titre">' + esc(t("adm.espace")) + '</h3>' +
          '<p class="member-note">' + esc(ADM.comptes[i.id] ? t("adm.espaceOuvert") : t("adm.espaceFerme")) + '</p>' +
          '<button type="button" class="cta ghost" id="i-inviter"' + (email ? '' : ' disabled') + '>' +
            esc(ADM.comptes[i.id] ? t("adm.renvoyerLien") : t("adm.inviter")) + '</button>' +
          '<div class="member-note" id="i-invit-note" role="status">' + esc(email ? "" : t("adm.inviterSansEmail")) + '</div>' +
        '</div>' +
        '<div class="adm-encart adm-suppression"><b>' + esc(t("adm.supprimerInt")) + '</b><p class="member-note">' + esc(t("adm.supprimerIntAide")) + '</p>' +
          '<button type="button" class="cta ghost adm-danger" id="i-supprimer">' + esc(t("adm.supprimerInt")) + '</button>' +
          '<div class="resa-erreur" id="i-suppr-note" role="alert"></div></div>') +
      '<button type="button" class="cta ghost" id="i-retour">' + esc(t("adm.retourListe")) + '</button>' +
    '</form>';
  admBrancherLangues("i-langues");
  const inter = ADM.role === "intervenant";
  if (inter) {   // 22/11 : l'intervenant publie sa fiche directement (type, publication et sous-titres restent à l'association)
    ["i-type", "i-publie"].forEach((id) => { const el = document.getElementById(id); if (el) el.closest("label").remove(); });
    $$(".adm-invitation, .adm-suppression, #i-retour").forEach((x) => x.remove());
    $("#adm-form").insertAdjacentHTML("afterbegin", '<p class="member-note">' + esc(t("adm.ficheDirecte")) + '</p>');
    $("#i-enregistrer").textContent = t("adm.enregistrerFiche");
    if (i.publie) $("#i-enregistrer").insertAdjacentHTML("afterend", '<button type="button" class="cta ghost" id="i-voir">' + esc(t("adm.voirPagePublique")) + '</button>');
    if ($("#i-voir")) $("#i-voir").addEventListener("click", () => openTarget("hote", i.id));
  }
  admBrancherPhoto("i-photo", inter ? "intervenants/" + ADM.moi : "intervenants", 1, 1000);
  admBrancherVideo("i-video", "intervenants/" + (inter ? ADM.moi : (i.id || "nouveau")));
  admBrancherTraduire("i-traduire", ["i-role", "i-bio"]);
  if (!inter) $("#i-retour").addEventListener("click", () => peindreAdmin(corps));
  if (!n && !inter) $("#i-inviter").addEventListener("click", () => admInviter(i));
  if (!n && !inter) $("#i-supprimer").addEventListener("click", () => admSupprimerIntervenant(corps, i));
  $("#adm-form").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const note = $("#i-note"), b = $("#i-enregistrer");
    const nom = admVal("i-nom");
    const mail = admVal("i-email").toLowerCase();
    if (!nom) { note.textContent = t("adm.nomManquant"); return; }
    await admTraduireChamps(["i-role", "i-bio"], false).catch(() => false);
    if (mail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mail)) { note.textContent = t("member.emailInvalid"); return; }
    const donnees = { type: admVal("i-type"), nom, role: admTraduit("i-role"), bio: admTraduit("i-bio"),
      photo_url: $("#i-photo").dataset.url || null, langues: admLanguesChoisies("i-langues").length ? admLanguesChoisies("i-langues") : ["fr"],
      instagram: admVal("i-insta") || null, publie: admCoche("i-publie"), video_url: $("#i-video").dataset.url || null };
    if (!inter) donnees.sous_titres_url = (donnees.video_url && $("#i-video").dataset.st) || null;
    b.disabled = true; note.textContent = t("member.loading");
    if (inter) {
      try {
        delete donnees.type; delete donnees.publie;
        await supaEcrire("PATCH", "intervenants?id=eq." + ADM.moi, donnees, "return=minimal");
        if (mail && mail !== (ADM.contacts[ADM.moi] || "")) await supaEcrire("PATCH", "intervenants_contacts?intervenant_id=eq." + ADM.moi, { email: mail }, "return=minimal");
        VISITES_CACHE = null;
        await renderAdmin(corps);
        const z = $("#adm-zone"); if (z) z.insertAdjacentHTML("afterbegin", '<div class="resa-etat">' + esc(t("adm.fichePubliee")) + '</div>');
      } catch (err) { note.textContent = admErreur(err); b.disabled = false; }
      return;
    }
    try {
      let id = n ? null : i.id;
      if (n) {
        donnees.slug = admSlug(nom, ADM.ints.map((x) => x.slug));
        donnees.localite_id = (currentLocalite() || {}).id || CONFIG.localiteParDefaut;
        id = (await supaEcrire("POST", "intervenants", donnees))[0].id;
      } else {
        await supaEcrire("PATCH", "intervenants?id=eq." + id, donnees);
      }
      if (mail !== (ADM.contacts[id] || "")) {
        if (mail) await supaEcrire("POST", "intervenants_contacts?on_conflict=intervenant_id", { intervenant_id: id, email: mail },
          "resolution=merge-duplicates,return=minimal");
        else await supaEcrire("PATCH", "intervenants_contacts?intervenant_id=eq." + id, { email: null }, "return=minimal");
      }
      VISITES_CACHE = null;
      await renderAdmin(corps);
      const fiche = ADM.ints.find((x) => x.id === id);
      if (fiche) peindreFormIntervenant(corps, fiche);
      const z = $("#adm-form"); if (z) z.insertAdjacentHTML("afterbegin", '<div class="resa-etat">' + esc(t("adm.enregistre")) + '</div>');
    } catch (err) {
      note.textContent = admErreur(err);
      b.disabled = false;
    }
  });
}

async function admInviter(i) {
  const b = $("#i-inviter"), note = $("#i-invit-note");
  b.disabled = true; note.textContent = t("member.loading");
  try {
    const s = await sessionValide();
    if (!s) throw new Error("SESSION");
    const res = await fetch("/.netlify/functions/inviter", { method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer " + s.access_token },
      body: JSON.stringify({ intervenant_id: i.id }) });
    const d = await res.json().catch(() => ({}));
    if (res.ok) {
      ADM.comptes[i.id] = true;
      note.textContent = tx("adm.invitationEnvoyee", { email: d.email || "" });
    } else {
      note.textContent = t({ EMAIL_MANQUANT: "adm.inviterSansEmail", COMPTE_ADMIN: "adm.inviterAdmin",
        COMPTE_AUTRE_INTERVENANT: "adm.inviterAutre", FICHE_DEJA_RELIEE: "adm.inviterRelie", RESERVE_ADMIN: "adm.erreurDroits" }[d.error] || "adm.erreur");
    }
  } catch (e) { note.textContent = admErreur(e); }
  b.disabled = false;
}

/* ---------- Reprise de la Sheet « Visites » (une seule fois) ---------- */

async function lignesSheetARepredre() {
  let rows = [];
  try { rows = await loadCSV(CONFIG.sources.visites, "visites"); } catch (e) { return []; }
  const pris = ADM.exps.map((e) => e.slug);
  return rows.filter((v) => v["id"] && /^[a-z0-9-]+$/.test(String(v["id"]).trim()) && !pris.includes(String(v["id"]).trim()));
}

async function proposerReprise(corps) {
  const zone = $("#adm-reprise");
  if (!zone || !CONFIG.sources.visites) return;
  const lignes = await lignesSheetARepredre();
  if (!lignes.length || !$("#adm-reprise")) return;
  zone.innerHTML = '<div class="adm-encart"><b>' + esc(tx("adm.repriseTitre", { n: lignes.length })) + '</b>' +
    '<p class="member-note">' + esc(t("adm.repriseTexte")) + '</p>' +
    '<button type="button" class="cta ghost" id="adm-reprendre">' + esc(t("adm.repriseBouton")) + '</button>' +
    '<div class="member-note" id="adm-reprise-note" role="status"></div></div>';
  $("#adm-reprendre").addEventListener("click", async () => {
    const b = $("#adm-reprendre"), note = $("#adm-reprise-note");
    b.disabled = true; note.textContent = t("member.loading");
    try {
      const n = await reprendreSheet(lignes);
      await renderAdmin(corps);
      const z = $("#adm-zone"); if (z) z.insertAdjacentHTML("afterbegin", '<div class="resa-etat">' + esc(tx("adm.repriseFaite", { n })) + '</div>');
    } catch (e) { note.textContent = admErreur(e); b.disabled = false; }
  });
}

/** Ligne de la Sheet → fiche Supabase en brouillon (prix et places à compléter avant publication). */
async function reprendreSheet(lignes) {
  const loc = (currentLocalite() || {}).id || CONFIG.localiteParDefaut;
  const ints = ADM.ints.slice();
  let faites = 0;
  for (const v of lignes) {
    const type0 = offreTypeOf(v);
    const guide = String(v["Guide"] || "").trim();
    const type = type0 === "atelier" ? "atelier" : type0 === "escape" ? "escape_game" : type0 === "diner" ? "soiree"
      : guide ? "visite_guidee" : "autoguidee";
    let intervenant_id = null;
    if (guide) {
      let it = ints.find((x) => x.nom.toLowerCase() === guide.toLowerCase());
      if (!it) {
        it = (await supaEcrire("POST", "intervenants", { nom: guide, type: type === "atelier" ? "artiste" : "guide",
          slug: admSlug(guide, ints.map((x) => x.slug)), localite_id: loc, publie: true }))[0];   // publié : son nom reste sur les cartes
        ints.push(it);
      }
      intervenant_id = it.id;
    }
    const traduit = (base) => { const o = {}; [["fr", ""], ["en", "_EN"], ["es", "_ES"], ["zh", "_ZH"], ["ar", "_AR"], ["ru", "_RU"]]
      .forEach(([l, suf]) => { const x = String(v[base + suf] || "").trim(); if (x) o[l] = x; }); return o; };
    const prix = admCentimes(v["Tarif direct"]);
    const visuel = typeof visiteBannerSrc === "function" ? visiteBannerSrc(v) : (v["Photo"] || "");
    await supaEcrire("POST", "experiences", {
      slug: String(v["id"]).trim(), localite_id: loc, type, titre: Object.keys(traduit("Nom")).length ? traduit("Nom") : { fr: v["id"] },
      accroche: traduit("Description"), description: traduit("Description"),
      duree_minutes: admMinutes(v["Durée"]), intervenant_id,
      photo_url: visuel && !/icons\/fond-/.test(visuel) ? new URL(visuel, location.href).href : null,
      point_rdv: String(v["Rendez-vous"] || "").trim() ? { fr: String(v["Rendez-vous"]).trim() } : {},
      prix_centimes: type === "autoguidee" ? null : prix,
      prix_libre_min_centimes: type === "autoguidee" ? (prix || 500) : null,
      prereservation_centimes: (type === "visite_guidee" || type === "atelier") ? 500 : null,
      publie: false,
    }, "return=minimal");
    faites++;
  }
  ints.length !== ADM.ints.length && (ADM.ints = ints);
  return faites;
}

/* ============================================================
   ÉTAPE 6.2b : séances, inscrits et absences, adhésions, demandes
   ============================================================ */

const admTitreExp = (id) => { const e = ADM.exps.find((x) => x.id === id); return e ? ((e.titre && e.titre.fr) || e.slug) : ""; };
const admDate = (iso, o) => new Date(iso).toLocaleDateString(localeResa(), Object.assign({ timeZone: "Europe/Paris" }, o));
const admHeure = (iso) => new Date(iso).toLocaleTimeString(localeResa(), { timeZone: "Europe/Paris", hour: "2-digit", minute: "2-digit" });
const admZone = () => $("#adm-zone");
const admChargement = () => { admZone().innerHTML = '<div class="loading">' + esc(t("member.loading")) + '</div>'; };

/** Date et heure saisies à l'heure de Paris → instant ISO (juste aussi depuis un téléphone réglé ailleurs). */
function admParisVersIso(jour, heure) {
  const [a, mo, j] = jour.split("-").map(Number), [h, mi] = heure.split(":").map(Number);
  let t0 = Date.UTC(a, mo - 1, j, h, mi);
  for (let i = 0; i < 2; i++) {
    const p = {}; new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(t0)).forEach((x) => { p[x.type] = x.value; });
    const vu = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute);
    t0 += Date.UTC(a, mo - 1, j, h, mi) - vu;
  }
  return new Date(t0).toISOString();
}
const admJourParis = (iso) => new Date(iso).toLocaleDateString("sv-SE", { timeZone: "Europe/Paris" });
const admHeureParis = (iso) => new Date(iso).toLocaleTimeString("en-GB", { timeZone: "Europe/Paris", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

/* ---------- Séances ---------- */

async function peindreListeSeances(corps) {
  admChargement();
  let seances = [], resas = [];
  try {
    seances = await supaConnecte("seances?select=*&supprimee_le=is.null&debut=gt." + encodeURIComponent(new Date(Date.now() - 8 * 864e5).toISOString()) + "&order=debut.asc");
    if (seances.length) resas = await supaConnecte("reservations?select=seance_id,personnes,statut&statut=eq.confirmee&seance_id=in.(" + seances.map((x) => x.id).join(",") + ")");
  } catch (e) { admZone().innerHTML = '<div class="member-note">' + esc(t("member.error")) + '</div>'; return; }
  const inscrits = (id) => resas.filter((r) => r.seance_id === id).reduce((n, r) => n + r.personnes, 0);
  const etat = (x) => x.statut === "annulee" ? ["suspendue", t("adm.sAnnulee")] : x.statut === "publiee" ? ["enligne", t("adm.sEnLigne")]
    : x.statut === "en_attente" ? ["avalider", t("adm.etatAValider")] : ["brouillon", t("adm.etatBrouillon")];
  admZone().innerHTML =
    '<button type="button" class="cta fee" id="adm-nouvelle-seance">' + esc(t("adm.nouvelleSeance")) + '</button>' +
    (seances.length ? '' : '<div class="member-note">' + esc(t("adm.aucuneSeance")) + '</div>') +
    '<div class="adm-liste">' + seances.map((x) => {
      const e = etat(x), n = inscrits(x.id);
      return '<button type="button" class="adm-ligne" data-adm-seance="' + esc(x.id) + '">' +
        '<span class="adm-jour"><span>' + esc(admDate(x.debut, { weekday: "short" })) + '</span><b>' + esc(admDate(x.debut, { day: "numeric" })) + '</b><span>' + esc(admDate(x.debut, { month: "short" })) + '</span></span>' +
        '<span class="adm-ligne-corps"><span class="adm-ligne-titre">' + esc(admTitreExp(x.experience_id)) + '</span>' +
          '<span class="adm-ligne-meta">' + esc(admHeure(x.debut) + " · " + (LANGUE_SEANCE[x.langue] || x.langue) + " · " +
            tx("adm.inscritsSur", { n, min: x.participants_min, max: x.capacite_max })) + '</span></span>' +
        '<span class="adm-etat adm-etat-' + e[0] + '">' + esc(e[1]) + '</span></button>';
    }).join("") + '</div>';
  $("#adm-nouvelle-seance").addEventListener("click", () => peindreFormSeance(corps, null));
  $$("[data-adm-seance]").forEach((b) => b.addEventListener("click", () => peindreFormSeance(corps, seances.find((x) => x.id === b.dataset.admSeance))));
}

/* E11.2 (22/11) : séance programmée par l'intervenant (ou l'admin), publiée tout de suite.
   Durée par pas de 15 minutes, prix par personne réglé sur place, minimum pour partir choisi
   par l'intervenant ; répétition (chaque semaine, tous les N jours) ou « Dupliquer ».
   Séance avec inscrits : tout reste modifiable, les inscrits sont prévenus par email (la base
   s'en charge) et peuvent annuler sans frais. x : séance existante ; modele : séance à dupliquer. */
async function peindreFormSeance(corps, x, modele) {
  const n = !x;
  const inter = ADM.role === "intervenant";
  let resas = [];
  if (!n) { admChargement(); try { resas = inter
    // l'intervenant ne voit que la vue mes_inscrits : prénom et initiale, personnes, téléphone, reste à encaisser
    ? (await supaConnecte("mes_inscrits?select=id,nom,personnes,telephone,reste_sur_place_centimes,adherent,absent_le,frais_centimes,frais_statut&seance_id=eq." + x.id)).map((r) => Object.assign({ statut: "confirmee" }, r))
    : await supaConnecte("reservations?select=id,reference,nom,email,telephone,personnes,statut,annulee_par,absent_le,frais_centimes,frais_statut,reste_sur_place_centimes,paye_en_ligne_centimes,adherent&seance_id=eq." + x.id + "&order=cree_le.asc"); } catch (e) { resas = []; } }
  const confirmees = resas.filter((r) => r.statut === "confirmee");
  const nInscrits = confirmees.reduce((k, r) => k + r.personnes, 0);
  const base = x || modele || { langue: "fr", statut: "brouillon" };
  const annulee = base.statut === "annulee" && !n;
  const publiee = !n && x.statut === "publiee";
  const exps = ADM.exps.filter((e) => ADM_TYPES_SEANCE.includes(e.type) && (inter ? admExpValidee(e) && e.type !== "soiree" : true));
  const expDe = (id) => ADM.exps.find((e) => e.id === id) || null;
  let exp = expDe(base.experience_id) || (exps.length === 1 ? exps[0] : null);
  const netExp = (e) => e && e.prix_centimes != null ? e.prix_centimes - (["soiree"].includes(e.type) ? 0 : (e.prereservation_centimes || 0)) : null;
  const dureeBase = base.fin && base.debut ? Math.round((new Date(base.fin) - new Date(base.debut)) / 6e4) : (exp && exp.duree_minutes) || 120;
  const commencee = !n && new Date(x.debut) <= new Date(), finAbsences = !n && Date.now() < new Date(x.debut).getTime() + 7 * 864e5;
  const titre = n ? (modele ? t("adm.dupliquerTitre") : t("adm.nouvelleSeance")) : t("adm.modifierSeance");
  window.scrollTo(0, 0);
  admZone().innerHTML =
    '<form id="adm-form" class="adm-form adm-form-large" novalidate>' +
      '<h2 class="adm-titre">' + esc(titre) + '</h2>' +
      (!n ? '<div class="adm-sous">' + esc(admTitreExp(x.experience_id) + " · " + admDate(x.debut, { weekday: "short", day: "numeric", month: "short" })) + '</div>' : '') +
      (annulee ? '<div class="resa-etat">' + esc(t("adm.sAnnuleeNote")) + '</div>' : '') +
      (nInscrits && !annulee ? '<div class="adm-bandeau adm-bandeau-info"><span>' + esc(tx("adm.sInscritsPrevenus", { n: nInscrits })) + '</span></div>' : '') +
      (inter && !exps.length && n ? '<div class="adm-bandeau"><span>' + esc(t("adm.seanceApresValidation")) + '</span></div>' : '') +
      '<label class="adm-champ"><span>' + esc(t("adm.experience")) + '</span>' +
        admSelect("s-exp", [["", t("adm.choisir")]].concat((n ? exps : ADM.exps.filter((e) => e.id === base.experience_id))
          .map((e) => [e.id, ((e.titre && e.titre.fr) || e.slug) + ", " + t("adm.typeCourt." + e.type).toLowerCase()])), exp ? exp.id : "") + '</label>' +
      '<div class="adm-grille">' +
        '<label class="adm-champ"><span>' + esc(t("adm.jour")) + '</span><input class="input-field" type="date" id="s-jour" value="' + esc(x ? admJourParis(x.debut) : "") + '"></label>' +
        '<label class="adm-champ"><span>' + esc(t("adm.heure")) + '</span><input class="input-field" type="time" step="900" id="s-heure" value="' + esc(base.debut ? admHeureParis(base.debut) : "10:00") + '"></label>' +
      '</div>' +
      '<label class="adm-champ"><span>' + esc(t("adm.rdv")) + '</span><input class="input-field" id="s-rdv" value="' + esc(base.point_rdv || (exp && exp.point_rdv && exp.point_rdv.fr) || "") + '"></label>' +
      '<div class="adm-champ"><span>' + esc(t("adm.langueVisite")) + '</span>' +
        admChoixHtml("s-langue", ADM_LANGUES.map((l) => [l, LANG_META[l].nom]), base.langue || "fr") + '</div>' +
      admStepperHtml("s-max", t("adm.placesNombre"), base.capacite_max || (exp && exp.capacite_max) || 8, "", " ") +
      admStepperHtml("s-min", t("adm.minimumPartir"), base.participants_min || (exp && exp.participants_min) || 1, t("adm.minimumAide")) +
      admStepperHtml("s-duree", t("adm.dureeCourt"), dureeBase, "", t("adm.pas15")) +
      admPrixHtml("s-prix", t(exp && exp.type === "soiree" ? "adm.prixSoireeSeance" : "adm.prixPersonne"),
        base.prix_centimes != null ? base.prix_centimes : netExp(exp), exp && exp.type === "soiree" ? "" : t("adm.prixPersonneAide")) +
      '<label class="adm-champ"><span>' + esc(t("adm.rdvPrecis")) + '</span><input class="input-field" id="s-precis" value="' + esc(base.point_rdv_precis || "") + '"><small class="member-note">' + esc(t("adm.rdvPrecisAide")) + '</small></label>' +
      '<label class="adm-champ"><span>' + esc(t("adm.message")) + '</span><textarea class="input-field" id="s-message" rows="2">' + esc(base.message_inscrits || "") + '</textarea></label>' +
      (n ? '<div class="adm-encart adm-repeter"><label class="adm-champ"><span>' + esc(t("adm.repeter")) + '</span>' +
          admSelect("s-repeter", [["", t("adm.repeterNon")], ["7", t("adm.repeterSemaine")], ["n", t("adm.repeterJours")]], "") + '</label>' +
          '<div class="adm-grille" id="s-repeter-detail" hidden>' +
            '<label class="adm-champ" id="s-tous-champ" hidden><span>' + esc(t("adm.repeterTous")) + '</span><input class="input-field" id="s-tous" inputmode="numeric" value="2"></label>' +
            '<label class="adm-champ"><span>' + esc(t("adm.repeterJusqua")) + '</span><input class="input-field" type="date" id="s-jusqua"></label>' +
          '</div><small class="member-note" id="s-repeter-note"></small></div>' : '') +
      (annulee ? '' :
        '<button type="submit" class="cta ocre" id="s-publier">' + esc(publiee ? t("adm.enregistrerChangements") : t("adm.publierSeance")) + '</button>' +
        '<div class="member-note adm-centre">' + esc(publiee ? (nInscrits ? t("adm.inscritsSerontPrevenus") : t("adm.sEnLigneNote")) : inter ? t("adm.publieeToutDeSuite") : t("adm.publieeToutDeSuiteAdmin")) + '</div>' +
        (publiee ? '' : '<button type="button" class="cta ghost" id="s-brouillon">' + esc(t("adm.enregistrerBrouillon")) + '</button>')) +
      '<div class="resa-erreur" id="s-note" role="alert"></div>' +
      (n ? '' : '<div class="adm-boutons"><button type="button" class="cta ghost" id="s-dupliquer">' + esc(t("adm.dupliquer")) + '</button>' +
        (nInscrits && !annulee && !commencee ? '' : '<button type="button" class="cta ghost adm-danger" id="s-supprimer">' + esc(t("adm.supprimerSeance")) + '</button>') + '</div>' +
        (nInscrits && !annulee && !commencee ? '<div class="member-note">' + esc(t("adm.supprimerSeanceInscrits")) + '</div>' : '')) +
      (n ? '' :
        '<h3 class="adm-sous-titre">' + esc(tx("adm.inscritsTitre", { n: nInscrits })) + '</h3>' +
        (resas.length ? '<div class="adm-liste adm-inscrits">' + resas.map((r) => {
          const absent = r.absent_le ? t("adm.absentSignale") : "";
          const etatR = r.statut === "confirmee" ? (absent || t("adm.rConfirmee")) : t("adm.r." + r.statut);
          return '<div class="adm-ligne"><span class="adm-ligne-corps"><span class="adm-ligne-titre">' + esc(r.nom) + ' · ' + esc(tx("adm.pers", { n: r.personnes })) + '</span>' +
            '<span class="adm-ligne-meta">' + esc([r.reference, r.telephone, r.email, etatR, r.statut === "confirmee" ? tx("adm.resteSurPlace", { m: euros(r.reste_sur_place_centimes || 0) }) : ""].filter(Boolean).join(" · ")) + '</span>' +
            (r.frais_centimes ? '<span class="adm-ligne-meta">' + esc(tx("adm.frais", { m: euros(r.frais_centimes), s: t("adm.f." + r.frais_statut) })) + '</span>' : '') + '</span>' +
            (r.statut === "confirmee" && !r.absent_le && commencee && finAbsences ? '<button type="button" class="chip" data-adm-absent="' + esc(r.id) + '">' + esc(t("adm.absent")) + '</button>' : '') +
          '</div>';
        }).join("") + '</div>' : '<div class="member-note">' + esc(t("adm.aucunInscrit")) + '</div>') +
        '<div class="member-note" id="s-absent-note" role="status"></div>' +
        (annulee || (inter && commencee) ? '' : inter
          // 22/11 : l'intervenant annule lui-même ; inscrits et association prévenus par email automatiquement.
          ? '<div class="adm-encart"><b>' + esc(t("adm.annulerSeance")) + '</b><p class="member-note">' + esc(t(nInscrits ? "adm.annulerIntervenantAide" : "adm.annulerIntervenantSansInscrit")) + '</p>' +
            (nInscrits ? '<label class="adm-champ"><span>' + esc(t("adm.annulerMot")) + '</span><textarea class="input-field" id="s-mot" rows="2" maxlength="1000" placeholder="' + esc(t("adm.annulerMotAide")) + '"></textarea></label>' : '') +
            '<button type="button" class="cta ghost adm-danger" id="s-annuler">' + esc(t("adm.annulerSeance")) + '</button>' +
            '<div class="resa-erreur" id="s-annuler-note" role="alert"></div></div>'
          : '<div class="adm-encart"><b>' + esc(t("adm.annulerSeance")) + '</b><p class="member-note">' + esc(t("adm.annulerAide")) + '</p>' +
            admSelect("s-motif", [["annulation_organisation", t("adm.motifOrga")], ["intervenant_empeche", t("adm.motifIntervenant")]], "annulation_organisation") +
            '<button type="button" class="cta ghost" id="s-annuler">' + esc(t("adm.annulerSeance")) + '</button>' +
            '<div class="resa-erreur" id="s-annuler-note" role="alert"></div></div>')) +
      '<button type="button" class="cta ghost" id="s-retour">' + esc(t("adm.retour")) + '</button>' +
    '</form>';
  if (!n) $("#s-exp").disabled = true;
  admBrancherChoix("s-langue");
  const maxExp = () => { const e = expDe(admVal("s-exp")); return inter && e && e.capacite_max ? e.capacite_max : 500; };
  const majApres = () => { const el = $("#s-max-apres"); if (el) el.textContent = inter && expDe(admVal("s-exp")) ? tx("adm.maximumN", { n: maxExp() }) : ""; };
  const places = admBrancherStepper("s-max", { pas: 1, min: Math.max(1, nInscrits), max: maxExp, change: (v) => { if (minimum.valeur() > v) minimum.fixer(v); } });
  const minimum = admBrancherStepper("s-min", { pas: 1, min: 1, max: () => places.valeur() });
  const duree = admBrancherStepper("s-duree", { pas: 15, min: 15, max: 24 * 60, format: dureeAffichee });
  majApres();
  // Une nouvelle séance reprend les places, la durée, le prix et le rendez-vous de l'expérience choisie.
  $("#s-exp").addEventListener("change", () => {
    const e = expDe(admVal("s-exp"));
    if (!e) return;
    if (e.capacite_max) places.fixer(e.capacite_max);
    minimum.fixer(e.participants_min || 1);
    if (e.duree_minutes) duree.fixer(e.duree_minutes);
    if (netExp(e) != null) $("#s-prix").value = admEuros(netExp(e));
    if (e.point_rdv && e.point_rdv.fr) $("#s-rdv").value = e.point_rdv.fr;
    majApres();
  });
  if (n) {
    const majRepeter = () => {
      const v = admVal("s-repeter");
      $("#s-repeter-detail").hidden = !v; $("#s-tous-champ").hidden = v !== "n";
      $("#s-repeter-note").textContent = v ? t("adm.repeterAide") : "";
    };
    $("#s-repeter").addEventListener("change", majRepeter);
  }
  $("#s-retour").addEventListener("click", () => peindreAdmin(corps));
  $$("[data-adm-absent]").forEach((b) => b.addEventListener("click", async () => {
    if (!confirm(t("adm.absentConfirmer"))) return;
    b.disabled = true;
    try {
      const r = await supaEcrire("POST", "rpc/signaler_absence", { p_reservation_id: b.dataset.admAbsent });
      $("#s-absent-note").textContent = r && r.frais_centimes ? tx("adm.absentPrevu", { m: euros(r.frais_centimes) }) : t("adm.absentSansFrais");
      b.remove();
    } catch (e) { $("#s-absent-note").textContent = admErreur(e); b.disabled = false; }
  }));
  if (!n) $("#s-dupliquer").addEventListener("click", () => peindreFormSeance(corps, null, Object.assign({}, x, { id: undefined, statut: "brouillon" })));
  if ($("#s-supprimer")) $("#s-supprimer").addEventListener("click", async () => {
    if (!confirm(t("adm.supprimerSeanceConfirmer"))) return;
    try {
      // Sans réservation : effacée ; avec un historique : retirée des listes et de l'app, gardée en base.
      const r = await supaEcrire("POST", "rpc/supprimer_seance", { p_id: x.id });
      ADM.onglet = "seances";
      await peindreAdmin(corps);
      admZone().insertAdjacentHTML("afterbegin", '<div class="resa-etat">' + esc(t(r && r.etat === "retiree" ? "adm.seanceRetiree" : "adm.seanceSupprimee")) + '</div>');
    } catch (e) { $("#s-note").textContent = /SEANCE_AVEC_INSCRITS/.test(e.message) ? t("adm.supprimerSeanceInscrits") : admErreur(e); }
  });
  if ($("#s-annuler")) $("#s-annuler").addEventListener("click", async () => {
    if (!confirm(inter ? tx("adm.annulerConfirmerIntervenant", { n: nInscrits }) : tx("adm.annulerConfirmer", { n: confirmees.length }))) return;
    const note = $("#s-annuler-note"), b = $("#s-annuler");
    b.disabled = true; note.textContent = t("member.loading");
    try {
      const r = await supaEcrire("POST", "rpc/annuler_seance", inter
        ? { p_seance_id: x.id, p_motif: "intervenant_empeche", p_message: admVal("s-mot") || null }
        : { p_seance_id: x.id, p_motif: admVal("s-motif") });
      await peindreFormSeance(corps, Object.assign({}, x, { statut: "annulee" }));
      $("#s-note").textContent = inter ? tx("adm.annuleeIntervenant", { n: (r && r.inscrits) || 0 }) : tx("adm.annuleeFaite", { n: (r && r.inscrits) || 0 });
    } catch (e) { note.textContent = /SEANCE_COMMENCEE/.test(e.message) ? t("adm.annulerTropTard") : admErreur(e); b.disabled = false; }
  });
  if (annulee) return;
  const enregistrer = async (statut) => {
    const note = $("#s-note");
    const jour = admVal("s-jour"), heure = admVal("s-heure"), prix = admPrixSaisi("s-prix");
    if (!admVal("s-exp") || !/^\d{4}-\d{2}-\d{2}$/.test(jour) || !/^\d{2}:\d{2}$/.test(heure)) { note.textContent = t("adm.sIncomplete"); return; }
    if (prix == null || isNaN(prix)) { note.textContent = t("adm.prixManquant"); return; }
    const debut = admParisVersIso(jour, heure);
    if ((n || new Date(debut).getTime() !== new Date(x.debut).getTime()) && new Date(debut) < new Date()) { note.textContent = t("adm.sPassee"); return; }
    const d = { capacite_max: places.valeur(), participants_min: Math.min(minimum.valeur(), places.valeur()), langue: admChoix("s-langue") || "fr",
      point_rdv: admVal("s-rdv") || null, point_rdv_precis: admVal("s-precis") || null, message_inscrits: admVal("s-message") || null,
      prix_centimes: prix, debut, fin: new Date(new Date(debut).getTime() + duree.valeur() * 6e4).toISOString(), statut };
    // Répétition : une séance par date, jusqu'à la date choisie (52 au plus), à la même heure de Paris.
    let lignes = [d];
    if (n && admVal("s-repeter")) {
      const pas = admVal("s-repeter") === "7" ? 7 : admEntier(admVal("s-tous")), fin = admVal("s-jusqua");
      if (!pas || pas < 1 || !/^\d{4}-\d{2}-\d{2}$/.test(fin) || fin <= jour) { note.textContent = t("adm.repeterIncomplet"); return; }
      lignes = [];
      for (let j = new Date(jour + "T12:00:00Z"); j.toISOString().slice(0, 10) <= fin && lignes.length < 52; j = new Date(j.getTime() + pas * 864e5)) {
        const deb = admParisVersIso(j.toISOString().slice(0, 10), heure);
        lignes.push(Object.assign({}, d, { debut: deb, fin: new Date(new Date(deb).getTime() + duree.valeur() * 6e4).toISOString() }));
      }
    }
    if (n) lignes.forEach((l) => { l.experience_id = admVal("s-exp"); });
    $$("#adm-form button").forEach((b) => { b.disabled = true; });
    note.textContent = t("member.loading");
    try {
      if (n) await supaEcrire("POST", "seances", lignes.length === 1 ? lignes[0] : lignes, "return=minimal");
      else await supaEcrire("PATCH", "seances?id=eq." + x.id, d, "return=minimal");
      ADM.onglet = "seances";
      await peindreAdmin(corps);
      const msg = statut === "brouillon" ? t("adm.enregistre") : n ? (lignes.length > 1 ? tx("adm.seancesPubliees", { n: lignes.length }) : t("adm.seancePubliee"))
        : nInscrits ? tx("adm.inscritsPrevenus", { n: nInscrits }) : t("adm.enregistre");
      admZone().insertAdjacentHTML("afterbegin", '<div class="resa-etat">' + esc(msg) + '</div>');
    } catch (e) {
      note.textContent = /d'abord être validée/.test(e.message) ? t("adm.sExpNonValidee") : /déjà inscrites/.test(e.message) ? t("adm.sPlacesInscrits")
        : /maximum pour cette/.test(e.message) ? tx("adm.maximumN", { n: maxExp() }) : /a des inscrits/.test(e.message) ? t("adm.sDepublierInscrits")
        : /participants_min|check/.test(e.message) ? t("adm.erreurMinMax") : admErreur(e);
      $$("#adm-form button").forEach((b) => { b.disabled = false; });
    }
  };
  $("#adm-form").addEventListener("submit", (ev) => { ev.preventDefault(); enregistrer("publiee"); });
  if ($("#s-brouillon")) $("#s-brouillon").addEventListener("click", () => enregistrer("brouillon"));
}

/* ---------- Adhésions ---------- */

/** Registre (maj-09) : numéro, nom, email, téléphone, dates, statut ; export CSV pour le bureau. */
function admExporterRegistre(registre) {
  const champ = (v) => '"' + String(v == null ? "" : v).replace(/"/g, '""') + '"';
  const jour = (d) => d ? new Date(d).toISOString().slice(0, 10) : "";
  const lignes = [["numero", "nom", "email", "telephone", "debut", "fin", "statut", "formule", "renouvellement_auto", "consentement_le", "consentement_version"]]
    .concat(registre.map((a) => [a.numero, a.nom, a.email, a.telephone, jour(a.debut), jour(a.fin), a.statut, a.formule,
      a.renouvellement_auto ? "oui" : "non", a.consentement_le || "", a.consentement_version || ""]));
  const blob = new Blob(["\ufeff" + lignes.map((l) => l.map(champ).join(";")).join("\r\n")], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob); a.download = "registre-adherents-" + new Date().toISOString().slice(0, 10) + ".csv";
  document.body.appendChild(a); a.click(); a.remove();
}

async function peindreAdhesions(corps) {
  admChargement();
  let registre = null;
  try { registre = await supaEcrire("POST", "rpc/registre_adherents", {}); } catch (e) { registre = null; }   // avant maj-09 : liste simple
  if (Array.isArray(registre)) {
    const dessinerR = (filtre) => {
      const f = filtre.trim().toLowerCase();
      const vues = registre.filter((a) => !f || (a.nom || "").toLowerCase().includes(f) || (a.email || "").includes(f) || (a.numero || "").toLowerCase().includes(f));
      $("#adm-adh-liste").innerHTML = vues.length ? vues.map((a) =>
        '<div class="adm-ligne"><span class="adm-ligne-corps"><span class="adm-ligne-titre">' + esc((a.numero ? a.numero + " · " : "") + (a.nom || a.email)) + '</span>' +
          '<span class="adm-ligne-meta">' + esc([a.nom ? a.email : "", a.telephone, a.renouvellement_auto ? t("adm.renouvAuto") : ""].filter(Boolean).join(" · ")) + '</span>' +
          '<span class="adm-ligne-meta">' + esc(a.fin ? tx(a.statut === "actif" ? "adm.valideJusqua" : "adm.expireeLe", { d: admDate(a.fin, { day: "numeric", month: "long", year: "numeric" }) }) : "") + '</span></span>' +
          '<span class="adm-etat adm-etat-' + (a.statut === "actif" ? "enligne" : "brouillon") + '">' + esc(a.statut === "actif" ? t("adm.aJour") : t("adm.expiree")) + '</span></div>').join("")
        : '<div class="member-note">' + esc(t("adm.aucuneAdhesion")) + '</div>';
    };
    admZone().innerHTML =
      '<div class="resa-etat">' + esc(tx("adm.adhesionsBilan", { n: registre.filter((a) => a.statut === "actif").length, total: registre.length })) + '</div>' +
      '<button type="button" class="cta ghost" id="adm-export">' + esc(t("adm.exporterRegistre")) + '</button>' +
      '<input class="input-field" id="adm-adh-filtre" type="search" placeholder="' + esc(t("adm.chercher")) + '">' +
      '<div class="adm-liste" id="adm-adh-liste"></div>' + admFormManuelle();
    dessinerR("");
    $("#adm-adh-filtre").addEventListener("input", (ev) => dessinerR(ev.target.value));
    $("#adm-export").addEventListener("click", () => admExporterRegistre(registre));
    admBrancherManuelle(corps);
    return;
  }
  let liste = [];
  try { liste = await supaConnecte("adhesions?select=nom,email,formule,source,valide_jusqua,statut&order=valide_jusqua.desc"); }
  catch (e) { admZone().innerHTML = '<div class="member-note">' + esc(t("member.error")) + '</div>'; return; }
  const valide = (a) => a.statut === "active" && new Date(a.valide_jusqua) > new Date();
  const dessiner = (filtre) => {
    const f = filtre.trim().toLowerCase();
    const vues = liste.filter((a) => !f || (a.nom || "").toLowerCase().includes(f) || a.email.includes(f));
    $("#adm-adh-liste").innerHTML = vues.length ? vues.map((a) =>
      '<div class="adm-ligne"><span class="adm-ligne-corps"><span class="adm-ligne-titre">' + esc(a.nom || a.email) + '</span>' +
        '<span class="adm-ligne-meta">' + esc([a.nom ? a.email : "", t("adm.formule." + a.formule), t("adm.source." + a.source)].filter(Boolean).join(" · ")) + '</span>' +
        '<span class="adm-ligne-meta">' + esc(tx(valide(a) ? "adm.valideJusqua" : "adm.expireeLe", { d: admDate(a.valide_jusqua, { day: "numeric", month: "long", year: "numeric" }) })) + '</span></span>' +
        '<span class="adm-etat adm-etat-' + (valide(a) ? "enligne" : "brouillon") + '">' + esc(valide(a) ? t("adm.aJour") : t("adm.expiree")) + '</span></div>').join("")
      : '<div class="member-note">' + esc(t("adm.aucuneAdhesion")) + '</div>';
  };
  admZone().innerHTML =
    '<div class="resa-etat">' + esc(tx("adm.adhesionsBilan", { n: liste.filter(valide).length, total: liste.length })) + '</div>' +
    '<input class="input-field" id="adm-adh-filtre" type="search" placeholder="' + esc(t("adm.chercher")) + '">' +
    '<div class="adm-liste" id="adm-adh-liste"></div>' + admFormManuelle();
  dessiner("");
  $("#adm-adh-filtre").addEventListener("input", (ev) => dessiner(ev.target.value));
  admBrancherManuelle(corps);
}
function admFormManuelle() {
  return '<details class="adm-encart"><summary><b>' + esc(t("adm.adhManuelle")) + '</b></summary>' +
      '<p class="member-note">' + esc(t("adm.adhManuelleAide")) + '</p>' +
      '<label class="adm-champ"><span>' + esc(t("adm.emailContact")) + '</span><input class="input-field" id="m-email" type="email"></label>' +
      '<label class="adm-champ"><span>' + esc(t("adm.nom")) + '</span><input class="input-field" id="m-nom"></label>' +
      '<label class="adm-champ"><span>' + esc(t("adm.jusquau")) + '</span><input class="input-field" id="m-fin" type="date" value="' +
        esc(new Date(Date.now() + 365 * 864e5).toISOString().slice(0, 10)) + '"></label>' +
      '<button type="button" class="cta ghost" id="m-ajouter">' + esc(t("adm.ajouter")) + '</button><div class="member-note" id="m-note" role="status"></div>' +
    '</details>';
}
function admBrancherManuelle(corps) {
  $("#m-ajouter").addEventListener("click", async () => {
    const email = admVal("m-email").toLowerCase(), note = $("#m-note");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !admVal("m-fin")) { note.textContent = t("member.emailInvalid"); return; }
    try {
      await supaEcrire("POST", "rpc/ajouter_adhesion_manuelle", { p_email: email, p_nom: admVal("m-nom") || null, p_valide_jusqua: admVal("m-fin") });
      await peindreAdhesions(corps);
      admZone().insertAdjacentHTML("afterbegin", '<div class="resa-etat">' + esc(t("adm.enregistre")) + '</div>');
    } catch (e) { note.textContent = admErreur(e); }
  });
}

/* ---------- Demandes (visites privées, candidatures) ---------- */

/** Après un changement de statut : le compteur « non traitées » suit (onglet et bandeau). */
function peindreDemandesCompteur(sel, corps) {
  const avant = sel.dataset.statut || "nouvelle";
  if (avant === "nouvelle" && sel.value !== "nouvelle") ADM.nonTraitees = Math.max(0, (ADM.nonTraitees || 0) - 1);
  else if (avant !== "nouvelle" && sel.value === "nouvelle") ADM.nonTraitees = (ADM.nonTraitees || 0) + 1;
  sel.dataset.statut = sel.value;
  const ong = document.querySelector('[data-adm-onglet="demandes"].chip');
  if (ong) ong.textContent = t("adm.demandes") + (ADM.nonTraitees ? " · " + ADM.nonTraitees : "");
  const bandeau = document.querySelector(".adm-a-traiter");
  if (bandeau) { if (ADM.nonTraitees) bandeau.textContent = tx("adm.nonTraitees", { n: ADM.nonTraitees }); else bandeau.remove(); }
}

async function peindreDemandes(corps) {
  admChargement();
  let groupes = [], cands = [];
  try {
    [groupes, cands] = await Promise.all([
      supaConnecte("demandes_groupes?select=*&order=cree_le.desc&limit=100"),
      Promise.resolve([]),   // candidatures : onglet Validations (22/11)
    ]);
  } catch (e) { admZone().innerHTML = '<div class="member-note">' + esc(t("member.error")) + '</div>'; return; }
  const STATUTS_G = ["nouvelle", "en_cours", "devis_envoye", "confirmee", "refusee", "close"], STATUTS_C = ["nouvelle", "acceptee", "refusee"];
  const carte = (d, table, statuts, lignes) =>
    '<div class="adm-ligne adm-demande"><span class="adm-ligne-corps">' +
      '<span class="adm-ligne-titre">' + esc(d.nom) + '</span>' +
      lignes.filter(Boolean).map((l) => '<span class="adm-ligne-meta">' + esc(l) + '</span>').join("") +
      (d.message ? '<span class="adm-message">' + esc(d.message) + '</span>' : '') +
      '<span class="adm-actions"><a href="mailto:' + esc(d.email) + '">' + esc(d.email) + '</a>' + (d.telephone ? ' · <a href="tel:' + esc(d.telephone) + '">' + esc(d.telephone) + '</a>' : '') + '</span>' +
      admSelect("d-" + d.id, statuts.map((k) => [k, t("adm.d." + k)]), d.statut).replace("<select ", '<select data-table="' + table + '" data-id="' + esc(d.id) + '" data-statut="' + esc(d.statut) + '" ') +
      (d.statut === "nouvelle" ? '<button type="button" class="cta gaz adm-accepter" data-accepter="' + table + '" data-id="' + esc(d.id) + '">' + esc(t("adm.accepterPrevenir")) + '</button>' : '') +
    '</span></div>';
  admZone().innerHTML =
    '<h3 class="adm-sous-titre">' + esc(tx("adm.demandesPrivees", { n: groupes.filter((g) => g.statut === "nouvelle").length })) + '</h3>' +
    (groupes.length ? '<div class="adm-liste">' + groupes.map((g) => carte(g, "demandes_groupes", STATUTS_G, [
      admDate(g.cree_le, { day: "numeric", month: "short" }) + " · " + t("adm.typeDemande." + g.type) + (g.experience_id ? " · " + admTitreExp(g.experience_id) : ""),
      [g.personnes ? tx("adm.pers", { n: g.personnes }) : "", g.periode_souhaitee, g.occasion].filter(Boolean).join(" · ")])).join("") + '</div>'
      : '<div class="member-note">' + esc(t("adm.aucuneDemande")) + '</div>') +
    '<p class="member-note">' + esc(t("adm.candidaturesDansValidations")) + ' <button type="button" class="lien-bouton" data-adm-onglet="valider">' + esc(t("adm.validations")) + ' ›</button></p>' +
    '<div class="member-note" id="d-note" role="status"></div>';
  ADM.nonTraitees = groupes.filter((g) => g.statut === "nouvelle").length;
  $$("#adm-zone [data-adm-onglet]").forEach((b) => b.addEventListener("click", () => { ADM.onglet = b.dataset.admOnglet; peindreAdmin(corps); }));
  $$("select[data-table]").forEach((sel) => sel.addEventListener("change", async () => {
    try {
      await supaEcrire("PATCH", sel.dataset.table + "?id=eq." + sel.dataset.id, { statut: sel.value }, "return=minimal");
      $("#d-note").textContent = t("adm.enregistre");
      peindreDemandesCompteur(sel, corps);
    } catch (e) { $("#d-note").textContent = admErreur(e); }
  }));
  $$("[data-accepter]").forEach((b) => b.addEventListener("click", async () => {
    if (!confirm(t("adm.accepterConfirmer"))) return;
    b.disabled = true;
    const note = $("#d-note");
    note.textContent = t("member.loading");
    try {
      const s = await sessionValide();
      const res = await fetch("/.netlify/functions/accepter", { method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + (s && s.access_token) },
        body: JSON.stringify({ table: b.dataset.accepter, id: b.dataset.id }) });
      if (!res.ok) throw new Error(String(res.status));
      note.textContent = t("adm.accepterOk");
      peindreDemandes(corps);
    } catch (e) { note.textContent = t("adm.accepterErreur"); b.disabled = false; }
  }));
}

/* ---------- Espace intervenant : mes inscrits (canvas E11.3) ---------- */

async function peindreMesInscrits(corps) {
  admChargement();
  let liste = [];
  try { liste = await supaConnecte("mes_inscrits?select=*&debut=gt." + encodeURIComponent(new Date(Date.now() - 7 * 864e5).toISOString()) + "&order=debut.asc"); }
  catch (e) { admZone().innerHTML = '<div class="member-note">' + esc(t("member.error")) + '</div>'; return; }
  const parSeance = {};
  liste.forEach((r) => { (parSeance[r.seance_id] = parSeance[r.seance_id] || []).push(r); });
  const ids = Object.keys(parSeance);
  admZone().innerHTML = ids.length ? ids.map((id) => {
    const rs = parSeance[id], d = rs[0].debut, commencee = new Date(d) <= new Date();
    const reste = rs.reduce((k, r) => k + (r.reste_sur_place_centimes || 0), 0);
    return '<h3 class="adm-sous-titre">' + esc(admTitreExp(rs[0].experience_id) + " · " + admDate(d, { weekday: "short", day: "numeric", month: "short" }) + " · " + admHeure(d)) + '</h3>' +
      '<div class="member-note">' + esc(tx("adm.aEncaisser", { n: rs.reduce((k, r) => k + r.personnes, 0), m: euros(reste) })) + '</div>' +
      '<div class="adm-liste adm-inscrits">' + rs.map((r) =>
        '<div class="adm-ligne"><span class="adm-ligne-corps"><span class="adm-ligne-titre">' + esc(r.nom) + '</span>' +
          '<span class="adm-ligne-meta">' + esc(tx("adm.pers", { n: r.personnes })) + ' · ' + (r.telephone ? '<a href="tel:' + esc(r.telephone) + '">' + esc(r.telephone) + '</a> · ' : '') +
            '<b>' + esc(tx("adm.resteSurPlace", { m: euros(r.reste_sur_place_centimes || 0) })) + '</b></span>' +
          (r.absent_le ? '<span class="adm-ligne-meta adm-absent">' + esc(r.frais_statut === "a_prelever" && r.frais_centimes ? tx("adm.absentPrevu", { m: euros(r.frais_centimes) })
            : r.frais_centimes ? tx("adm.absentEtat", { m: euros(r.frais_centimes) }) : t("adm.absentSansPrelevement")) + '</span>' : '') +
          '<span class="adm-actions-inscrit">' + (r.telephone ? '<a class="chip" href="tel:' + esc(r.telephone) + '">' + esc(t("adm.appeler")) + '</a>' : '') +
          (commencee && !r.absent_le ? '<button type="button" class="chip" data-adm-absent="' + esc(r.id) + '">' + esc(t("adm.absent")) + '</button>' : '') + '</span></span></div>').join("") + '</div>';
  }).join("") + '<div class="member-note adm-absent-aide">' + esc(t("adm.absentAide")) + '</div><div class="member-note" id="s-absent-note" role="status"></div>'
    : '<div class="member-note">' + esc(t("adm.aucunInscrit")) + '</div>';
  $$("[data-adm-absent]").forEach((b) => b.addEventListener("click", async () => {
    if (!confirm(t("adm.absentConfirmer"))) return;
    b.disabled = true;
    try {
      const r = await supaEcrire("POST", "rpc/signaler_absence", { p_reservation_id: b.dataset.admAbsent });
      $("#s-absent-note").textContent = r && r.frais_centimes ? tx("adm.absentPrevu", { m: euros(r.frais_centimes) }) : t("adm.absentSansFrais");
      b.textContent = t("adm.absentSignale");
    } catch (e) { $("#s-absent-note").textContent = admErreur(e); b.disabled = false; }
  }));
}

/* ---------- Administration : changements proposés par les intervenants (canvas E12) ---------- */

/** Propositions encore en attente (lieu, anciennes propositions de séance), dans l'onglet Validations. */
function peindrePropositions(corps, zone) {
  const nomInt = (id) => (ADM.ints.find((i) => i.id === id) || {}).nom || "";
  const CHAMPS = { nom: "adm.nom", role: "adm.metier", bio: "adm.bio", photo_url: "adm.photo", instagram: "adm.instagram", langues: "adm.langues",
    debut: "adm.jour", fin: "adm.duree", langue: "adm.langue", capacite_max: "adm.placesMax", participants_min: "adm.participantsMin",
    point_rdv: "adm.rdv", point_rdv_precis: "adm.rdvPrecis", message_inscrits: "adm.message", prix_adherent_centimes: "adm.tarifAdh" };
  const valeur = (k, v) => v == null || v === "" ? "–" : k === "prix_adherent_centimes" ? euros(v) : k === "debut" || k === "fin" ? admDate(v, { weekday: "short", day: "numeric", month: "short" }) + " " + admHeure(v)
    : Array.isArray(v) ? v.join(", ") : typeof v === "object" ? (v.fr || "") : String(v);
  zone.innerHTML = '<div class="adm-liste">' + (ADM.props || []).map((p) =>
    '<div class="adm-ligne adm-demande"><span class="adm-ligne-corps">' +
      '<span class="adm-ligne-titre">' + esc(nomInt(p.intervenant_id)) + '</span>' +
      '<span class="adm-ligne-meta">' + esc(admDate(p.cree_le, { day: "numeric", month: "short" }) + " · " + t("adm.prop." + p.type)) + '</span>' +
      Object.keys(p.donnees || {}).filter((k) => CHAMPS[k] && !(k === "photo_url" && !p.donnees[k])).map((k) =>
        '<span class="adm-message"><b>' + esc(t(CHAMPS[k])) + ' :</b> ' + (k === "photo_url" ? '<img class="adm-vignette" src="' + esc(p.donnees[k]) + '" alt="">' : esc(valeur(k, p.donnees[k]))) + '</span>').join("") +
      '<span class="adm-actions"><button type="button" class="chip active" data-valider="' + esc(p.id) + '">' + esc(t("adm.valider")) + '</button> ' +
        '<button type="button" class="chip" data-refuser="' + esc(p.id) + '">' + esc(t("adm.refuser")) + '</button></span>' +
    '</span></div>').join("") + '</div><div class="member-note" id="p-note" role="status"></div>';
  const agir = (fn, id) => async () => {
    try {
      const r = await supaEcrire("POST", "rpc/" + fn, fn === "valider_proposition" ? { p_id: id } : { p_id: id, p_motif: null });
      ADM.onglet = "valider";
      await renderAdmin(corps);
      const msg = r && r.inscrits_a_prevenir ? tx("adm.validePrevenir", { n: r.inscrits_a_prevenir }) : t("adm.enregistre");
      admZone().insertAdjacentHTML("afterbegin", '<div class="resa-etat">' + esc(msg) + '</div>');
    } catch (e) { $("#p-note").textContent = /CAPACITE|MINIMUM/.test(e.message) ? t("adm.erreurMinMax") : admErreur(e); }
  };
  $$("[data-valider]").forEach((b) => b.addEventListener("click", agir("valider_proposition", b.dataset.valider)));
  $$("[data-refuser]").forEach((b) => b.addEventListener("click", agir("refuser_proposition", b.dataset.refuser)));
}

/* ============================================================
   ÉTAPES D'UN PARCOURS AUTOGUIDÉ (partie 3) : liste et formulaire
   ============================================================ */

async function peindreEtapesAdmin(corps, exp) {
  admChargement();
  let etapes = [], codes = [];
  try {
    etapes = await supaConnecte("etapes?select=*&experience_id=eq." + exp.id + "&order=ordre.asc");
    if (etapes.length) codes = await supaConnecte("etapes_codes?select=etape_id,code&etape_id=in.(" + etapes.map((x) => x.id).join(",") + ")");
  } catch (e) { admZone().innerHTML = '<div class="member-note">' + esc(t("member.error")) + '</div>'; return; }
  const code = (id) => (codes.find((c) => c.etape_id === id) || {}).code || "";
  window.scrollTo(0, 0);
  admZone().innerHTML =
    '<h2 class="adm-titre">' + esc(tx("adm.etapesTitre", { titre: (exp.titre && exp.titre.fr) || exp.slug })) + '</h2>' +
    '<p class="member-note">' + esc(t("adm.etapesAide")) + '</p>' +
    '<button type="button" class="cta fee" id="et-nouvelle">' + esc(t("adm.nouvelleEtape")) + '</button>' +
    '<div class="adm-liste">' + etapes.map((x) =>
      '<button type="button" class="adm-ligne" data-adm-etape="' + esc(x.id) + '"><span class="parc-num ouverte">' + esc(String(x.ordre)) + '</span>' +
        '<span class="adm-ligne-corps"><span class="adm-ligne-titre">' + esc((x.nom && x.nom.fr) || "") + '</span>' +
        '<span class="adm-ligne-meta">' + esc([x.type === "depart" ? t("adm.etDepart") : "", x.apercu ? t("adm.etApercu") : "", x.lat == null ? t("adm.etSansPoint") : "",
          code(x.id) ? t("adm.etAvecCode") : "", x.audio && x.audio.fr ? t("adm.etAvecAudio") : ""].filter(Boolean).join(" · ")) + '</span></span></button>').join("") + '</div>' +
    '<button type="button" class="cta ghost" id="et-retour">' + esc(t("adm.retourFiche")) + '</button>';
  $("#et-nouvelle").addEventListener("click", () => peindreEtapeForm(corps, exp, null, etapes, ""));
  $("#et-retour").addEventListener("click", async () => { await renderAdmin(corps); const f = ADM.exps.find((y) => y.id === exp.id); if (f) peindreFormFiche(corps, f); });
  $$("[data-adm-etape]").forEach((b) => b.addEventListener("click", () => {
    const x = etapes.find((y) => y.id === b.dataset.admEtape); peindreEtapeForm(corps, exp, x, etapes, code(x.id)); }));
}

function admAudioHtml(id, url, libelle) {
  return '<div class="adm-champ"><span>' + esc(libelle) + '</span><div id="' + id + '" data-url="' + esc(url || "") + '">' +
    (url ? '<audio controls preload="none" src="' + esc(url) + '" class="parc-audio"></audio>' : '<span class="member-note">' + esc(t("adm.audioAucun")) + '</span>') + '</div>' +
    '<label class="lien-bouton adm-photo-btn">' + esc(url ? t("adm.audioRemplacer") : t("adm.audioAjouter")) +
    '<input type="file" accept="audio/mpeg,audio/mp4,audio/x-m4a,audio/aac,.mp3,.m4a" id="' + id + '-fichier" hidden></label>' +
    '<div class="member-note" id="' + id + '-note" role="status"></div></div>';
}
function admBrancherAudio(id, dossier) {
  const zone = document.getElementById(id), note = document.getElementById(id + "-note");
  document.getElementById(id + "-fichier").addEventListener("change", async (ev) => {
    const f = ev.target.files && ev.target.files[0];
    if (!f) return;
    if (f.size > 52428800) { note.textContent = t("adm.videoTropLourde"); return; }
    const type = /\.m4a$/i.test(f.name) ? "audio/mp4" : (f.type || "audio/mpeg");
    note.textContent = t("adm.videoEnvoi");
    try {
      const url = await admEnvoyerFichier(new File([f], f.name, { type }), "videos", dossier + "/" + admNomFichier(type === "audio/mp4" ? ".m4a" : ".mp3"));
      zone.dataset.url = url;
      zone.innerHTML = '<audio controls preload="none" src="' + esc(url) + '" class="parc-audio"></audio>';
      note.textContent = t("adm.videoOk");
    } catch (e) { note.textContent = admErreur(e); }
  });
}

function peindreEtapeForm(corps, exp, x, etapes, codeActuel) {
  const n = !x;
  x = x || { ordre: (etapes.reduce((m, y) => Math.max(m, y.ordre), 0) + 1), type: etapes.length ? "etape" : "depart", apercu: false,
    nom: {}, resume: {}, texte: {}, a_reperer: {}, audio: {}, rayon_deblocage_m: 30 };
  window.scrollTo(0, 0);
  admZone().innerHTML =
    '<form id="adm-form" class="adm-form" novalidate>' +
      '<h2 class="adm-titre">' + esc(n ? t("adm.nouvelleEtape") : tx("adm.etapeN", { n: x.ordre })) + '</h2>' +
      '<div class="adm-grille">' + admNombre("e-ordre", t("adm.etOrdre"), x.ordre) +
        '<label class="adm-champ"><span>' + esc(t("adm.typeFiche")) + '</span>' + admSelect("e-type", [["depart", t("adm.etDepart")], ["etape", t("adm.etEtape")]], x.type) + '</label></div>' +
      admTexteHtml("e-nom", t("adm.etNom"), x.nom) +
      admTexteHtml("e-resume", t("adm.etResume"), x.resume) +
      admTexteHtml("e-texte", t("adm.etTexte"), x.texte, true) +
      admTexteHtml("e-areperer", t("adm.etAReperer"), x.a_reperer) +
      admPhotoHtml("e-photo", x.media_url) +
      '<label class="adm-champ"><span>' + esc(t("adm.etCredit")) + '</span><input class="input-field" id="e-credit" value="' + esc(x.media_credit || "") + '" placeholder="Photo : …"></label>' +
      admAudioHtml("e-audio-fr", x.audio && x.audio.fr, t("adm.etAudioFr")) +
      admAudioHtml("e-audio-en", x.audio && x.audio.en, t("adm.etAudioEn")) +
      '<div class="adm-champ"><span>' + esc(t("adm.etPoint")) + '</span><div class="adm-carte" id="e-carte"></div>' +
        '<small class="member-note" id="e-carte-note">' + esc(x.lat != null ? t("adm.rdvPlace") : t("adm.etPointAide")) + '</small></div>' +
      '<div class="adm-grille">' + admNombre("e-rayon", t("adm.etRayon"), x.rayon_deblocage_m) +
        '<label class="adm-champ"><span>' + esc(t("adm.etCode")) + '</span><input class="input-field" id="e-code" value="' + esc(codeActuel || "") + '" autocomplete="off"></label></div>' +
      '<small class="member-note">' + esc(t("adm.etCodeAide")) + '</small>' +
      admCase("e-apercu", t("adm.etApercuCase"), x.apercu) +
      admBoutonTraduire("e-traduire") +
      '<button type="submit" class="cta fee" id="e-enregistrer">' + esc(t("adm.enregistrer")) + '</button>' +
      '<div class="resa-erreur" id="e-note" role="alert"></div>' +
      (n ? '' : '<button type="button" class="lien-bouton" id="e-supprimer">' + esc(t("adm.etSupprimer")) + '</button>') +
      '<button type="button" class="cta ghost" id="e-retour">' + esc(t("adm.retourEtapes")) + '</button>' +
    '</form>';
  admBrancherPhoto("e-photo", "fiches");
  admBrancherAudio("e-audio-fr", "parcours/" + exp.id); admBrancherAudio("e-audio-en", "parcours/" + exp.id);
  admBrancherTraduire("e-traduire", ["e-nom", "e-resume", "e-texte", "e-areperer"]);
  const pos = { lat: x.lat, lng: x.lng };
  admCarte("e-carte", pos, () => { $("#e-carte-note").textContent = t("adm.rdvPlace"); });
  $("#e-retour").addEventListener("click", () => peindreEtapesAdmin(corps, exp));
  if (!n) $("#e-supprimer").addEventListener("click", async () => {
    if (!confirm(t("adm.etSupprimerConfirmer"))) return;
    try { await supaEcrire("DELETE", "etapes?id=eq." + x.id, undefined, "return=minimal"); peindreEtapesAdmin(corps, exp); }
    catch (e) { $("#e-note").textContent = admErreur(e); }
  });
  $("#adm-form").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const note = $("#e-note"), b = $("#e-enregistrer");
    if (!admVal("e-nom-fr")) { note.textContent = t("adm.titreManquant"); return; }
    b.disabled = true; note.textContent = t("adm.traductionEnCours");
    await admTraduireChamps(["e-nom", "e-resume", "e-texte", "e-areperer"], false).catch(() => false);
    const audio = {}; ["fr", "en"].forEach((l) => { const u = $("#e-audio-" + l).dataset.url; if (u) audio[l] = u; });
    const d = { ordre: admEntier(admVal("e-ordre")) || x.ordre, type: admVal("e-type"), nom: admTraduit("e-nom"), resume: admTraduit("e-resume"),
      texte: admTraduit("e-texte"), a_reperer: admTraduit("e-areperer"), media_url: $("#e-photo").dataset.url || null, media_credit: admVal("e-credit") || null,
      audio, lat: pos.lat == null ? null : pos.lat, lng: pos.lng == null ? null : pos.lng, rayon_deblocage_m: admEntier(admVal("e-rayon")) || 30, apercu: admCoche("e-apercu") };
    try {
      let id = x.id;
      if (n) id = (await supaEcrire("POST", "etapes", Object.assign({ experience_id: exp.id }, d)))[0].id;
      else await supaEcrire("PATCH", "etapes?id=eq." + id, d, "return=minimal");
      const code = admVal("e-code");
      if (code) await supaEcrire("POST", "etapes_codes?on_conflict=etape_id", { etape_id: id, code }, "resolution=merge-duplicates,return=minimal");
      else if (codeActuel) await supaEcrire("DELETE", "etapes_codes?etape_id=eq." + id, undefined, "return=minimal");
      await peindreEtapesAdmin(corps, exp);
      admZone().insertAdjacentHTML("afterbegin", '<div class="resa-etat">' + esc(t("adm.enregistre")) + '</div>');
    } catch (e) {
      note.textContent = e.code === "23505" ? t("adm.etOrdrePris") : e.code === "23514" ? t("adm.etCodeLongueur") : admErreur(e);
      b.disabled = false;
    }
  });
}

/* ============================================================
   LOT DU 22/11 : INTERVENANTS AUTONOMES (E11.1, E11.2, E11.6)
   ET VALIDATIONS DE L'ASSOCIATION (E12)
   - L'intervenant crée ses expériences (validées par l'association),
     puis publie lui-même ses séances (répétées ou dupliquées).
   - L'association valide les candidatures et les expériences, avec un
     motif en cas de refus (fonction Netlify « validations ») ; elle voit
     les notifications non envoyées et peut les renvoyer.
   ============================================================ */

const ADM_TYPES_INTERVENANT = ["visite_guidee", "atelier", "escape_game"];
const ADM_TYPES_SEANCE = ["visite_guidee", "atelier", "soiree", "escape_game"];
const admExpValidee = (e) => e.publie && !e.a_valider && ADM_TYPES_SEANCE.includes(e.type);

/** Compteur − valeur + (E11.2, E11.6). La valeur est gardée dans data-valeur ; format : affichage. */
function admStepperHtml(id, libelle, valeur, aide, apres) {
  return '<div class="adm-champ"><span>' + esc(libelle) + '</span>' +
    '<div class="adm-stepper"><button type="button" class="adm-stepper-btn" data-pas="-1" aria-label="−">−</button>' +
      '<b class="adm-stepper-val" id="' + id + '" data-valeur="' + esc(valeur) + '" aria-live="polite"></b>' +
      '<button type="button" class="adm-stepper-btn" data-pas="1" aria-label="+">+</button>' +
      (apres ? '<span class="adm-stepper-apres" id="' + id + '-apres">' + esc(apres) + '</span>' : '') + '</div>' +
    (aide ? '<small class="member-note">' + esc(aide) + '</small>' : '') + '</div>';
}
/** o = { pas, min, max (nombre ou fonction), format, change } */
function admBrancherStepper(id, o) {
  const el = document.getElementById(id);
  const borne = (v) => Math.max(o.min, Math.min(typeof o.max === "function" ? o.max() : o.max, v));
  const peindre = () => { el.textContent = (o.format || String)(+el.dataset.valeur); };
  el.dataset.valeur = borne(+el.dataset.valeur || o.min);
  peindre();
  el.parentElement.querySelectorAll("[data-pas]").forEach((b) => b.addEventListener("click", () => {
    el.dataset.valeur = borne(+el.dataset.valeur + (+b.dataset.pas) * o.pas);
    peindre();
    if (o.change) o.change(+el.dataset.valeur);
  }));
  return { valeur: () => +el.dataset.valeur, fixer: (v) => { el.dataset.valeur = borne(v); peindre(); } };
}
/** Puces à choix unique (type d'expérience, langue de la séance). */
function admChoixHtml(id, options, valeur, inactif) {
  return '<div class="adm-puces adm-choix" id="' + id + '" role="radiogroup">' + options.map((o) =>
    '<button type="button" class="chip' + (o[0] === valeur ? " active" : "") + '" role="radio" aria-checked="' + (o[0] === valeur) + '" data-valeur="' + esc(o[0]) + '"' +
      (inactif ? " disabled" : "") + '>' + esc(o[1]) + '</button>').join("") + '</div>';
}
function admBrancherChoix(id, change) {
  $$("#" + id + " [data-valeur]").forEach((b) => b.addEventListener("click", () => {
    $$("#" + id + " [data-valeur]").forEach((x) => { x.classList.toggle("active", x === b); x.setAttribute("aria-checked", x === b); });
    if (change) change(b.dataset.valeur);
  }));
}
const admChoix = (id) => { const b = document.querySelector("#" + id + " .active"); return b ? b.dataset.valeur : null; };
/** Montant saisi en euros → centimes (vide → null). */
function admPrixSaisi(id) {
  const v = String(admVal(id) || "").replace(/\s|€/g, "").replace(",", ".");
  if (!v) return null;
  const n = Math.round(parseFloat(v) * 100);
  return isFinite(n) && n >= 0 ? n : NaN;
}
const admPrixHtml = (id, libelle, centimes, aide) => '<label class="adm-champ"><span>' + esc(libelle) + '</span>' +
  '<span class="adm-euros"><input class="input-field" id="' + id + '" inputmode="decimal" value="' + esc(centimes == null ? "" : admEuros(centimes)) + '"><span aria-hidden="true">€</span></span>' +
  (aide ? '<small class="member-note">' + esc(aide) + '</small>' : '') + '</label>';
/** Il y a 12 min, il y a 1 h, hier… */
function admIlYa(iso) {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  try {
    const f = new Intl.RelativeTimeFormat(localeResa(), { numeric: "auto" });
    if (s < 3600) return f.format(-Math.max(1, Math.round(s / 60)), "minute");
    if (s < 86400) return f.format(-Math.round(s / 3600), "hour");
    return f.format(-Math.round(s / 86400), "day");
  } catch (e) { return admDate(iso, { day: "numeric", month: "short" }); }
}
/** Appel de la fonction Netlify « validations » avec la session de l'admin. */
async function admValidation(corpsReq) {
  const s = await sessionValide();
  if (!s) throw new Error("SESSION");
  const res = await fetch("/.netlify/functions/validations", { method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + s.access_token }, body: JSON.stringify(corpsReq) });
  const d = await res.json().catch(() => ({}));
  if (!res.ok) { const e = new Error(d.error || String(res.status)); e.code = d.error; throw e; }
  return d;
}

/* ---------- E11.1 : tableau de bord de l'intervenant ---------- */

async function peindreTableauIntervenant(corps) {
  admChargement();
  const debutMois = new Date(); debutMois.setDate(1); debutMois.setHours(0, 0, 0, 0);
  const depuis = new Date(Math.min(debutMois.getTime(), Date.now() - 864e5)).toISOString();
  let seances = [], inscrits = [];
  try {
    [seances, inscrits] = await Promise.all([
      supaConnecte("seances?select=*&supprimee_le=is.null&debut=gt." + encodeURIComponent(new Date(Date.now() - 3 * 3600e3).toISOString()) + "&order=debut.asc"),
      supaConnecte("mes_inscrits?select=seance_id,debut,personnes,reste_sur_place_centimes&debut=gt." + encodeURIComponent(depuis)),
    ]);
  } catch (e) { admZone().innerHTML = '<div class="member-note">' + esc(t("member.error")) + '</div>'; return; }
  const valides = ADM.exps.filter(admExpValidee);
  const attente = ADM.exps.filter((e) => e.a_valider), refusees = ADM.exps.filter((e) => e.refusee_le && !e.a_valider && !e.publie);
  const titreDe = (e) => (e.titre && e.titre.fr) || e.slug;
  const nInscrits = (id) => inscrits.filter((r) => r.seance_id === id).reduce((k, r) => k + r.personnes, 0);
  const aVenir = seances.filter((x) => x.statut !== "annulee");
  // Bandeau chiffré : inscrits ce mois, et à encaisser à la prochaine séance qui a des inscrits.
  const ceMois = inscrits.filter((r) => new Date(r.debut) >= debutMois && admJourParis(r.debut).slice(0, 7) === admJourParis(new Date().toISOString()).slice(0, 7))
    .reduce((k, r) => k + r.personnes, 0);
  const prochaine = inscrits.filter((r) => new Date(r.debut) > new Date()).sort((a, b) => new Date(a.debut) - new Date(b.debut))[0];
  const aEncaisser = prochaine ? inscrits.filter((r) => r.seance_id === prochaine.seance_id).reduce((k, r) => k + (r.reste_sur_place_centimes || 0), 0) : 0;
  const etat = (x) => {
    const n = nInscrits(x.id);
    if (x.statut !== "publiee") return ["brouillon", t("adm.etatBrouillon")];
    return n >= x.participants_min ? ["confirmee", t("adm.sConfirmee")] : ["attente", tx("adm.sInscritsMin", { n, min: x.participants_min })];
  };
  admZone().innerHTML =
    (valides.length ? '<button type="button" class="cta ocre" id="adm-nouvelle-seance">+ ' + esc(t("adm.nouvelleSeance")) + '</button>' : '') +
    '<button type="button" class="cta ghost" id="adm-nouvelle-exp">' + esc(t("adm.proposerExperience")) + '</button>' +
    attente.map((e) => '<div class="adm-bandeau"><span class="adm-point" aria-hidden="true"></span><span>' + esc(tx("adm.expAttente", { t: titreDe(e) })) + '</span></div>').join("") +
    refusees.map((e) => '<div class="adm-bandeau adm-bandeau-refus"><span>' + esc(tx("adm.expRefusee", { t: titreDe(e) })) +
      (e.motif_refus ? ' ' + esc(tx("adm.motifEntre", { m: e.motif_refus })) : '') + '</span>' +
      '<button type="button" class="chip" data-adm-exp="' + esc(e.id) + '">' + esc(t("adm.corriger")) + '</button></div>').join("") +
    (!valides.length && !attente.length && !refusees.length ? '<div class="member-note">' + esc(t("adm.premiereExperience")) + '</div>' : '') +
    '<div class="adm-titre-liste"><h2>' + esc(t("adm.prochaines1")) + ' <i>' + esc(t("adm.prochaines2")) + '</i></h2>' +
      '<span class="cpt-mono">' + esc(tx("compte.aVenir", { n: aVenir.length })) + '</span></div>' +
    (aVenir.length ? '<div class="adm-liste adm-seances">' + aVenir.map((x) => {
      const e = etat(x), n = nInscrits(x.id), part = Math.min(100, Math.round(100 * n / Math.max(1, x.capacite_max)));
      return '<button type="button" class="adm-ligne adm-seance" data-adm-seance="' + esc(x.id) + '">' +
        '<span class="adm-jour"><span>' + esc(admDate(x.debut, { weekday: "short" })) + '</span><b>' + esc(admDate(x.debut, { day: "numeric" })) + '</b><span>' + esc(admDate(x.debut, { month: "short" })) + '</span></span>' +
        '<span class="adm-ligne-corps"><span class="adm-ligne-titre">' + esc(admTitreExp(x.experience_id)) + '</span>' +
          '<span class="adm-ligne-meta">' + esc([heureLisible(x.debut), LANGUE_SEANCE[x.langue] || x.langue, x.point_rdv].filter(Boolean).join(" · ")) + '</span>' +
          '<span class="adm-etat adm-etat-' + e[0] + '">' + esc(e[1]) + '</span>' +
          (x.statut === "publiee" ? '<span class="adm-jauge' + (n >= x.participants_min ? ' ok' : '') + '"><span style="inline-size:' + part + '%"></span></span>' : '') +
        '</span></button>';
    }).join("") + '</div>' : '<div class="member-note">' + esc(valides.length ? t("adm.aucuneSeance") : t("adm.seanceApresValidation")) + '</div>') +
    '<div class="adm-chiffres"><div><b>' + esc(String(ceMois)) + '</b><span>' + esc(t("adm.inscritsMois")) + '</span></div>' +
      '<div><b>' + esc(euros(aEncaisser)) + '</b><span>' + esc(prochaine ? tx("adm.encaisserLe", { d: admDate(prochaine.debut, { weekday: "short", day: "numeric" }) }) : t("adm.encaisserRien")) + '</span></div></div>';
  if ($("#adm-nouvelle-seance")) $("#adm-nouvelle-seance").addEventListener("click", () => peindreFormSeance(corps, null));
  $("#adm-nouvelle-exp").addEventListener("click", () => peindreFormExperience(corps, null));
  $$("[data-adm-exp]").forEach((b) => b.addEventListener("click", () => peindreFormExperience(corps, ADM.exps.find((e) => e.id === b.dataset.admExp))));
  $$("[data-adm-seance]").forEach((b) => b.addEventListener("click", () => peindreFormSeance(corps, seances.find((x) => x.id === b.dataset.admSeance))));
}

/* ---------- E11.6 : expérience décrite par l'intervenant ---------- */

function peindreFormExperience(corps, e) {
  const n = !e;
  e = e || { type: "visite_guidee", titre: {}, description: {}, langues: ["fr"], point_rdv: {}, duree_minutes: 120, capacite_max: 8, participants_min: 1 };
  const enLigne = !!e.publie, refusee = !!e.refusee_le && !e.a_valider && !e.publie;
  const zone = admZone();
  window.scrollTo(0, 0);
  zone.innerHTML =
    '<form id="adm-form" class="adm-form adm-form-large" novalidate>' +
      '<h2 class="adm-titre">' + esc(n ? t("adm.nouvelleExperience") : ((e.titre && e.titre.fr) || e.slug)) + '</h2>' +
      (n ? '<p class="espace-texte">' + esc(t("adm.expIntro")) + '</p>' : '') +
      (e.a_valider ? '<div class="adm-bandeau"><span class="adm-point" aria-hidden="true"></span><span>' + esc(t("adm.expEnAttente")) + '</span></div>' : '') +
      (refusee ? '<div class="adm-bandeau adm-bandeau-refus"><span>' + esc(t("adm.expACorriger")) + (e.motif_refus ? ' ' + esc(tx("adm.motifEntre", { m: e.motif_refus })) : '') + '</span></div>' : '') +
      (enLigne ? '<div class="member-note">' + esc(t("adm.expEnLigne")) + '</div>' : '') +
      '<div class="adm-champ"><span>' + esc(t("adm.typeExperience")) + '</span>' +
        admChoixHtml("x-type", ADM_TYPES_INTERVENANT.map((k) => [k, t("adm.typeCourt." + k)]), e.type, enLigne) + '</div>' +
      admTexteHtml("x-titre", t("adm.titreFiche"), e.titre) +
      admTexteHtml("x-description", t("adm.description"), e.description, true) +
      '<small class="member-note">' + esc(t("adm.descriptionAide")) + '</small>' +
      admPhotoHtml("x-photo", e.photo_url) +
      '<small class="member-note">' + esc(t("adm.photoCouvertureAide")) + '</small>' +
      admStepperHtml("x-duree", t("adm.dureeCourt"), e.duree_minutes || 120, "", t("adm.pas15")) +
      admStepperHtml("x-places", t("adm.placesMaxCourt"), e.capacite_max || 8) +
      admLanguesHtml("x-langues", e.langues) +
      admTexteHtml("x-rdv", t("adm.rdvPublic"), e.point_rdv) +
      '<div class="adm-champ"><span>' + esc(t("adm.rdvCarte")) + '</span><div class="adm-carte" id="x-carte"></div>' +
        '<small class="member-note" id="x-carte-note">' + esc(e.point_rdv_lat != null ? t("adm.rdvPlace") : t("adm.rdvAide")) + '</small></div>' +
      admPrixHtml("x-prix", t("adm.prixPersonne"), e.prix_centimes == null ? null : e.prix_centimes - (e.prereservation_centimes || 0), t("adm.prixPersonneAide")) +
      '<button type="submit" class="cta ocre" id="x-enregistrer">' + esc(n ? t("adm.envoyerValidation") : refusee ? t("adm.renvoyerValidation") : t("adm.enregistrer")) + '</button>' +
      (n || refusee ? '<div class="member-note adm-centre">' + esc(t("adm.reponse48h")) + '</div>' : '') +
      '<div class="resa-erreur" id="x-note" role="alert"></div>' +
(n ? '' : '<div class="adm-encart adm-suppression"><b>' + esc(t("adm.supprimerExp")) + '</b><p class="member-note">' + esc(t("adm.supprimerExpAide")) + '</p>' +
        '<button type="button" class="cta ghost adm-danger" id="x-supprimer">' + esc(t("adm.supprimerExp")) + '</button>' +
        '<div class="resa-erreur" id="x-suppr-note" role="alert"></div></div>') +
            '<button type="button" class="cta ghost" id="x-retour">' + esc(t("adm.retour")) + '</button>' +
    '</form>';
  if (enLigne) $$("[id^=x-titre-]").forEach((x) => { x.disabled = true; });
  // Description : 200 caractères au plus, avec le compteur (« 123 / 200 »).
  const desc = $("#x-description-fr");
  desc.maxLength = 200; desc.rows = 4;
  desc.closest("label").querySelector("span").insertAdjacentHTML("beforeend", ' <small class="adm-compteur" id="x-compteur"></small>');
  const compter = () => { $("#x-compteur").textContent = desc.value.length + " / 200"; };
  desc.addEventListener("input", compter); compter();
  admBrancherChoix("x-type");
  admBrancherLangues("x-langues");
  admBrancherPhoto("x-photo", "fiches/" + ADM.moi, 4 / 3, 1600);
  const duree = admBrancherStepper("x-duree", { pas: 15, min: 15, max: 24 * 60, format: dureeAffichee });
  const places = admBrancherStepper("x-places", { pas: 1, min: 1, max: 100 });
  const pos = { lat: e.point_rdv_lat, lng: e.point_rdv_lng };
  admCarte("x-carte", pos, () => { $("#x-carte-note").textContent = t("adm.rdvPlace"); });
  $("#x-retour").addEventListener("click", () => peindreAdmin(corps));
  if (!n) admBrancherSuppressionExp(corps, e, "x");
  $("#adm-form").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const note = $("#x-note"), b = $("#x-enregistrer");
    const prix = admPrixSaisi("x-prix");
    if (!admVal("x-titre-fr")) { note.textContent = t("adm.titreManquant"); return; }
    if (prix == null || isNaN(prix)) { note.textContent = t("adm.prixManquant"); return; }
    b.disabled = true; note.textContent = t("adm.traductionEnCours");
    await admTraduireChamps(["x-titre", "x-description", "x-rdv"], false).catch(() => false);
    const d = { description: admTraduit("x-description"), duree_minutes: duree.valeur(), capacite_max: places.valeur(),
      participants_min: Math.min(e.participants_min || 1, places.valeur()),
      langues: admLanguesChoisies("x-langues").length ? admLanguesChoisies("x-langues") : ["fr"],
      photo_url: $("#x-photo").dataset.url || null, point_rdv: admTraduit("x-rdv"),
      point_rdv_lat: pos.lat == null ? null : pos.lat, point_rdv_lng: pos.lng == null ? null : pos.lng,
      prix_centimes: prix + (e.prereservation_centimes || 0) };   // prix affiché = net ; une ancienne fiche garde sa pré-réservation
    if (!enLigne) { d.type = admChoix("x-type"); d.titre = admTraduit("x-titre"); }
    if (refusee) Object.assign(d, { a_valider: true, refusee_le: null, motif_refus: null });   // renvoyée pour validation
    note.textContent = t("member.loading");
    try {
      if (n) await supaEcrire("POST", "experiences", d, "return=minimal");
      else await supaEcrire("PATCH", "experiences?id=eq." + e.id, d, "return=minimal");
      VISITES_CACHE = null;
      ADM.onglet = "seances";
      await renderAdmin(corps);
      admZone().insertAdjacentHTML("afterbegin", '<div class="resa-etat">' + esc(n || refusee ? t("adm.expEnvoyee") : t("adm.enregistre")) + '</div>');
    } catch (err) {
      note.textContent = /200 caract/.test(err.message) ? t("adm.descriptionTropLongue") : /Prix/.test(err.message) ? t("adm.prixManquant") : admErreur(err);
      b.disabled = false;
    }
  });
}

/* ---------- E12 : validations de l'association ---------- */

async function peindreValidations(corps) {
  admChargement();
  let cands = [], notifs = [], decisions = [], sansEspace = [];
  try {
    [cands, notifs, decisions, sansEspace] = await Promise.all([
      supaConnecte("candidatures?select=*&statut=eq.nouvelle&order=cree_le.asc"),
      supaEcrire("POST", "rpc/notifications_non_envoyees", {}).catch(() => []),
      supaConnecte("candidatures?select=id,nom,type,statut,motif_refus,traitee_le&statut=neq.nouvelle&order=cree_le.desc&limit=20"),
      // Acceptées avant le 22/11 avec l'ancien menu de statut : ni fiche ni accès.
      supaConnecte("candidatures?select=*&statut=eq.acceptee&intervenant_id=is.null&order=cree_le.desc"),
    ]);
  } catch (e) { admZone().innerHTML = '<div class="member-note">' + esc(t("member.error")) + '</div>'; return; }
  ADM.cands = cands;
  const exps = ADM.exps.filter((e) => e.a_valider);
  const nomInt = (id) => (ADM.ints.find((i) => i.id === id) || {}).nom || "";
  const actions = (genre, id) => '<span class="adm-actions adm-decision" data-genre="' + genre + '" data-id="' + esc(id) + '">' +
    '<button type="button" class="cta ocre adm-petit" data-decider="valider">' + esc(t("adm.valider")) + '</button>' +
    '<button type="button" class="cta ghost adm-petit" data-decider="refuser">' + esc(t("adm.refuser")) + '</button>' +
    '<span class="adm-motif" hidden><label class="adm-champ"><span>' + esc(t("adm.motif")) + '</span>' +
      '<textarea class="input-field" rows="3" maxlength="1000" placeholder="' + esc(t("adm.motifAide")) + '"></textarea></label>' +
      '<button type="button" class="cta ghost adm-petit" data-decider="confirmer">' + esc(t("adm.confirmerRefus")) + '</button></span></span>';
  const NOTIFS = ["alerte_candidature", "alerte_demande", "alerte_experience", "alerte_seances_publiees", "acces_intervenant",
    "experience_validee", "experience_refusee", "candidature_refusee", "seance_modifiee", "alerte_annulation_intervenant", "seance_annulee"];
  admZone().innerHTML =
    (notifs.length ? '<div class="adm-encart adm-notifs"><b>' + esc(tx("adm.notifsNonEnvoyees", { n: notifs.length })) + '</b>' +
      '<p class="member-note">' + esc(t("adm.notifsAide")) + '</p>' + notifs.map((v) =>
        '<div class="adm-notif"><span>' + esc((NOTIFS.includes(v.type) ? t("adm.notif." + v.type) : t("adm.notifAutre")) + " · " + v.destinataire + " · " + admIlYa(v.cree_le)) +
          (v.statut === "echec" ? '' : ' · ' + esc(t("adm.notifEssai"))) + '</span>' +
          '<button type="button" class="chip" data-reessayer="' + esc(v.id) + '">' + esc(t("adm.reessayer")) + '</button></div>').join("") + '</div>' : '') +
    '<h3 class="adm-sous-titre">' + esc(tx("adm.candidaturesAValider", { n: cands.length })) + '</h3>' +
    (cands.length ? '<div class="adm-liste">' + cands.map((c) =>
      '<div class="adm-ligne adm-demande"><span class="adm-ligne-corps">' +
        '<span class="adm-ligne-titre">' + esc(c.nom) + ' <small class="adm-quand">' + esc(admIlYa(c.cree_le)) + '</small></span>' +
        '<span class="adm-ligne-meta">' + esc(t("adm.typeInt." + c.type)) + '</span>' +
        (c.message ? '<span class="adm-message">' + esc(c.message) + '</span>' : '') +
        '<span class="adm-actions"><a href="mailto:' + esc(c.email) + '">' + esc(c.email) + '</a>' + (c.telephone ? ' · <a href="tel:' + esc(c.telephone) + '">' + esc(c.telephone) + '</a>' : '') + '</span>' +
        actions("candidature", c.id) + '</span></div>').join("") + '</div>'
      : '<div class="member-note">' + esc(t("adm.aucuneCandidatureAValider")) + '</div>') +
    (sansEspace.length ? '<h3 class="adm-sous-titre">' + esc(tx("adm.accepteesSansEspace", { n: sansEspace.length })) + '</h3>' +
      '<p class="member-note">' + esc(t("adm.accepteesSansEspaceAide")) + '</p><div class="adm-liste">' + sansEspace.map((c) =>
        '<div class="adm-ligne adm-demande"><span class="adm-ligne-corps">' +
          '<span class="adm-ligne-titre">' + esc(c.nom) + '</span><span class="adm-ligne-meta">' + esc(t("adm.typeInt." + c.type)) + '</span>' +
          '<span class="adm-actions"><a href="mailto:' + esc(c.email) + '">' + esc(c.email) + '</a></span>' +
          '<span class="adm-actions adm-ouvrir"><button type="button" class="cta ocre adm-petit" data-ouvrir-espace="' + esc(c.id) + '">' + esc(t("adm.ouvrirEspace")) + '</button></span>' +
        '</span></div>').join("") + '</div>' : '') +
    '<h3 class="adm-sous-titre">' + esc(tx("adm.experiencesAValider", { n: exps.length })) + '</h3>' +
    (exps.length ? '<div class="adm-liste">' + exps.map((e) =>
      '<div class="adm-ligne adm-demande"><span class="adm-ligne-corps">' +
        (e.photo_url ? '<img class="adm-couverture" src="' + esc(e.photo_url) + '" alt="" loading="lazy">' : '') +
        '<span class="adm-ligne-titre">' + esc((e.titre && e.titre.fr) || e.slug) + ' <small class="adm-quand">' + esc(admIlYa(e.maj_le || e.cree_le)) + '</small></span>' +
        '<span class="adm-ligne-meta">' + esc([nomInt(e.intervenant_id), t("adm.typeCourt." + e.type), dureeAffichee(e.duree_minutes),
          e.capacite_max ? tx("adm.nPlaces", { n: e.capacite_max }) : "", e.prix_centimes != null ? tx("adm.parPersonne", { m: euros(e.prix_centimes) }) : ""].filter(Boolean).join(" · ")) + '</span>' +
        (e.description && e.description.fr ? '<span class="adm-message">' + esc(e.description.fr) + '</span>' : '') +
        (e.point_rdv && e.point_rdv.fr ? '<span class="adm-ligne-meta">' + esc(t("adm.rdv") + " : " + e.point_rdv.fr) + '</span>' : '') +
        '<span class="adm-actions"><button type="button" class="lien-bouton" data-adm-fiche="' + esc(e.id) + '">' + esc(t("adm.ouvrirFiche")) + '</button></span>' +
        actions("experience", e.id) + '</span></div>').join("") + '</div>'
      : '<div class="member-note">' + esc(t("adm.aucuneExperienceAValider")) + '</div>') +
    ((ADM.props || []).length ? '<h3 class="adm-sous-titre">' + esc(tx("adm.propositionsAValider", { n: ADM.props.length })) + '</h3><div id="adm-props"></div>' : '') +
    (decisions.length ? '<details class="adm-trad"><summary>' + esc(t("adm.decisionsRecentes")) + '</summary><div class="adm-liste">' + decisions.map((c) =>
      '<div class="adm-ligne"><span class="adm-ligne-corps"><span class="adm-ligne-titre">' + esc(c.nom) + '</span><span class="adm-ligne-meta">' +
        esc([t("adm.d." + c.statut), c.traitee_le ? admDate(c.traitee_le, { day: "numeric", month: "short" }) : "", c.motif_refus].filter(Boolean).join(" · ")) + '</span></span></div>').join("") +
      '</div></details>' : '') +
    '<div class="member-note" id="v-note" role="status"></div>' +
    '<p class="member-note adm-centre">' + esc(t("adm.validationsPied")) + '</p>';
  if ($("#adm-props")) peindrePropositions(corps, $("#adm-props"));
  $$("[data-adm-fiche]").forEach((b) => b.addEventListener("click", () => peindreFormFiche(corps, ADM.exps.find((e) => e.id === b.dataset.admFiche))));
  $$("[data-ouvrir-espace]").forEach((b) => b.addEventListener("click", async () => {
    if (!confirm(t("adm.confirmerCandidature"))) return;
    b.disabled = true;
    try {
      const r = await admValidation({ action: "candidature_accepter", id: b.dataset.ouvrirEspace });
      ADM.onglet = "valider";
      await renderAdmin(corps);
      admZone().insertAdjacentHTML("afterbegin", '<div class="resa-etat">' + esc((t("adm.candidatureAcceptee") + " " +
        (r.notifie === false ? t("adm.notifNonEnvoyee") : tx("adm.emailEnvoye", { email: r.email || "" }))).trim()) + '</div>');
    } catch (e) { $("#v-note").textContent = e.code === "COMPTE_ADMIN" ? t("adm.inviterAdmin") : admErreur(e); b.disabled = false; }
  }));
  $$("[data-reessayer]").forEach((b) => b.addEventListener("click", async () => {
    b.disabled = true;
    try { await supaEcrire("POST", "rpc/notification_reessayer", { p_id: +b.dataset.reessayer }, "return=minimal"); b.textContent = t("adm.reessaiPrevu"); }
    catch (e) { $("#v-note").textContent = admErreur(e); b.disabled = false; }
  }));
  $$(".adm-decision").forEach((bloc) => {
    const genre = bloc.dataset.genre, id = bloc.dataset.id, motif = bloc.querySelector(".adm-motif");
    const decider = async (refus) => {
      const note = $("#v-note");
      Array.from(bloc.querySelectorAll("button")).forEach((x) => { x.disabled = true; });
      note.textContent = t("member.loading");
      try {
        const r = await admValidation({ action: genre + (refus ? "_refuser" : genre === "candidature" ? "_accepter" : "_valider"), id,
          motif: refus ? motif.querySelector("textarea").value : undefined });
        ADM.onglet = "valider";
        VISITES_CACHE = null;
        await renderAdmin(corps);
        const msg = tx(refus ? "adm.refusFait" : genre === "candidature" ? "adm.candidatureAcceptee" : "adm.experienceValidee", { email: r.email || "" }) +
          " " + (r.notifie === false ? t("adm.notifNonEnvoyee") : r.email ? tx("adm.emailEnvoye", { email: r.email }) : "");
        admZone().insertAdjacentHTML("afterbegin", '<div class="resa-etat">' + esc(msg.trim()) + '</div>');
      } catch (e) {
        note.textContent = { COMPTE_ADMIN: t("adm.inviterAdmin"), PRIX_OU_PLACES_MANQUANTS: t("adm.erreurPrixPlaces"), SANS_INTERVENANT: t("adm.erreurSansIntervenant"),
          RESERVE_ADMIN: t("adm.erreurDroits") }[e.code] || admErreur(e);
        Array.from(bloc.querySelectorAll("button")).forEach((x) => { x.disabled = false; });
      }
    };
    bloc.querySelector('[data-decider="valider"]').addEventListener("click", () => {
      if (confirm(t(genre === "candidature" ? "adm.confirmerCandidature" : "adm.confirmerExperience"))) decider(false);
    });
    bloc.querySelector('[data-decider="refuser"]').addEventListener("click", () => { motif.hidden = false; motif.querySelector("textarea").focus(); });
    bloc.querySelector('[data-decider="confirmer"]').addEventListener("click", () => decider(true));
  });
}

/* ---------- Suppression d'un intervenant (admin) ---------- */

async function admSupprimerIntervenant(corps, i) {
  if (!confirm(tx("adm.supprimerIntConfirmer", { nom: i.nom }))) return;
  const note = $("#i-suppr-note");
  note.textContent = t("member.loading");
  try {
    const r = await admValidation({ action: "intervenant_supprimer", id: i.id });
    ADM.onglet = "intervenants";
    VISITES_CACHE = null;
    await renderAdmin(corps);
    admZone().insertAdjacentHTML("afterbegin", '<div class="resa-etat">' + esc(tx("adm.intSupprime", { nom: i.nom, n: r.experiences_retirees || 0 })) + '</div>');
  } catch (e) {
    note.textContent = e.code === "SEANCES_AVEC_INSCRITS" ? t("adm.supprimerIntInscrits") : e.code === "RESERVE_ADMIN" ? t("adm.erreurDroits") : admErreur(e);
  }
}

/* ---------- Suppression d'une expérience (admin et intervenant, maj-21) ---------- */

/** Sans aucune réservation : effacée ; avec un historique : retirée de l'app, gardée en base.
    Refusée tant qu'une séance à venir a des inscrits (l'annuler d'abord : ils sont prévenus). */
function admBrancherSuppressionExp(corps, e, prefixe) {
  const b = document.getElementById(prefixe + "-supprimer");
  if (!b) return;
  b.addEventListener("click", async () => {
    if (!confirm(tx("adm.supprimerExpConfirmer", { t: (e.titre && e.titre.fr) || e.slug }))) return;
    const note = document.getElementById(prefixe + "-suppr-note");
    b.disabled = true; note.textContent = t("member.loading");
    try {
      const r = await supaEcrire("POST", "rpc/supprimer_experience", { p_id: e.id });
      VISITES_CACHE = null;
      ADM.onglet = "fiches";
      await renderAdmin(corps);
      admZone().insertAdjacentHTML("afterbegin", '<div class="resa-etat">' + esc(t(r && r.etat === "retiree" ? "adm.expRetiree" : "adm.expSupprimee")) + '</div>');
    } catch (err) {
      note.textContent = /SEANCES_AVEC_INSCRITS/.test(err.message) ? t("adm.supprimerExpInscrits") : admErreur(err);
      b.disabled = false;
    }
  });
}
