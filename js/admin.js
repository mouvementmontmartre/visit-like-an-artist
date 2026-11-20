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
function admBrancherPhoto(id, dossier) {
  const input = document.getElementById(id + "-fichier");
  input.addEventListener("change", async () => {
    const f = input.files && input.files[0];
    if (!f) return;
    const note = document.getElementById(id + "-note");
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
      supaConnecte("experiences?select=*&order=ordre.asc,cree_le.desc" + (inter ? "&intervenant_id=eq." + ADM.moi : "")),
      supaConnecte("intervenants?select=*&order=nom.asc" + (inter ? "&id=eq." + ADM.moi : "")),
      supaConnecte("intervenants_contacts?select=intervenant_id,email"),
      inter ? Promise.resolve([]) : supaConnecte("profils?select=intervenant_id&role=eq.intervenant"),
      supaConnecte("propositions?select=*&statut=eq.en_attente&order=cree_le.asc"),
      inter ? Promise.resolve([]) : supaConnecte("demandes_groupes?select=id&statut=eq.nouvelle"),
      inter ? Promise.resolve([]) : supaConnecte("candidatures?select=id&statut=eq.nouvelle"),
    ]);
    ADM.props = props;
    ADM.nonTraitees = (dNouvelles || []).length + (cNouvelles || []).length;
    ADM.exps = exps; ADM.ints = ints;
    ADM.contacts = {}; contacts.forEach((c) => { ADM.contacts[c.intervenant_id] = c.email; });
    ADM.comptes = {}; profils.forEach((p) => { if (p.intervenant_id) ADM.comptes[p.intervenant_id] = true; });
  } catch (e) {
    if (e.message === "SESSION") { renderEspace(t("espace.expire")); return; }
    corps.innerHTML = '<div class="member-note">' + esc(t("member.error")) + '</div>';
    return;
  }
  peindreAdmin(corps);
}

function admEtatFiche(e) {
  if (e.a_valider) return ["avalider", t("adm.etatAValider")];
  if (e.publie && e.actif) return ["enligne", t("adm.etatEnLigne")];
  if (e.publie) return ["suspendue", t("adm.etatSuspendue")];
  return ["brouillon", t("adm.etatBrouillon")];
}

function peindreAdmin(corps) {
  const aValider = ADM.exps.filter((e) => e.a_valider).length;
  const ongletSimple = (k, libelle) => '<button type="button" class="chip' + (ADM.onglet === k ? " active" : "") + '" data-adm-onglet="' + k + '">' + esc(libelle) + '</button>';
  const onglet = (k, libelle, n) => '<button type="button" class="chip' + (ADM.onglet === k ? " active" : "") + '" data-adm-onglet="' + k + '">' +
    esc(libelle) + ' · ' + n + '</button>';
  const inter = ADM.role === "intervenant", nProps = (ADM.props || []).length;
  corps.innerHTML =
    '<h1 class="espace-titre">' + esc(tx("espace.bonjour", { nom: ADM.nom })) + '</h1>' +
    '<div class="adm-sous">' + esc(inter ? t("adm.sousIntervenant") : t("adm.sous")) + '</div>' +
    (inter ? (nProps ? '<div class="resa-etat">' + esc(tx("adm.enAttenteNote", { n: nProps })) + '</div>' : '')
      : (aValider ? '<div class="resa-etat">' + esc(tx("adm.aValiderNote", { n: aValider })) + '</div>' : '') +
        (ADM.nonTraitees ? '<button type="button" class="resa-etat adm-a-traiter" data-adm-onglet="demandes">' + esc(tx("adm.nonTraitees", { n: ADM.nonTraitees })) + '</button>' : '')) +
    '<div class="filter-chips adm-onglets" role="tablist">' +
      (inter
        ? ongletSimple("seances", t("adm.mesSeances")) + ongletSimple("inscrits", t("adm.mesInscrits")) +
          ongletSimple("intervenants", t("adm.maFiche")) + ongletSimple("fiches", t("adm.mesVisites"))
        : (nProps ? onglet("valider", t("adm.aValider"), nProps) : '') +
          onglet("fiches", t("adm.fiches"), ADM.exps.length) + ongletSimple("seances", t("adm.seances")) +
          onglet("intervenants", t("adm.intervenants"), ADM.ints.length) + ongletSimple("adhesions", t("adm.adhesions")) +
          (ADM.nonTraitees ? onglet("demandes", t("adm.demandes"), ADM.nonTraitees).replace('class="chip', 'class="chip adm-onglet-alerte') : ongletSimple("demandes", t("adm.demandes")))) +
    '</div>' +
    '<div id="adm-zone"></div>' +
    '<button type="button" class="cta ghost" id="espace-deconnexion">' + esc(t("espace.deconnexion")) + '</button>';
  $$("[data-adm-onglet]").forEach((b) => b.addEventListener("click", () => { ADM.onglet = b.dataset.admOnglet; peindreAdmin(corps); }));
  $("#espace-deconnexion").addEventListener("click", deconnecter);
  if (inter && ADM.onglet === "intervenants") { peindreFormIntervenant(corps, ADM.ints[0] || null); return; }
  ({ fiches: peindreListeFiches, seances: peindreListeSeances, intervenants: peindreListeIntervenants, inscrits: peindreMesInscrits,
     adhesions: peindreAdhesions, demandes: peindreDemandes, valider: peindreValidations }[ADM.onglet] || peindreListeFiches)(corps);
}

function peindreListeFiches(corps) {
  const zone = $("#adm-zone");
  const nomInt = (id) => (ADM.ints.find((i) => i.id === id) || {}).nom || "";
  zone.innerHTML =
    '<button type="button" class="cta fee" id="adm-nouvelle-fiche">' + esc(ADM.role === "intervenant" ? t("adm.proposerVisite") : t("adm.nouvelleFiche")) + '</button>' +
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
  $("#adm-nouvelle-fiche").addEventListener("click", () => peindreFormFiche(corps, null));
  $$("[data-adm-fiche]").forEach((b) => b.addEventListener("click", () => peindreFormFiche(corps, ADM.exps.find((e) => e.id === b.dataset.admFiche))));
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
  admBrancherPhoto("f-photo", inter ? "fiches/" + ADM.moi : "fiches");
  admBrancherTraduire("f-traduire", ["f-titre", "f-accroche", "f-description", "f-rdv"]);
  if ($("#f-etapes")) $("#f-etapes").addEventListener("click", () => peindreEtapesAdmin(corps, e));
  const pos = { lat: e.point_rdv_lat, lng: e.point_rdv_lng };
  admCarte("f-carte", pos, () => { $("#f-carte-note").textContent = t("adm.rdvPlace"); });
  $("#f-retour").addEventListener("click", () => peindreAdmin(corps));
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
        '</div>') +
      '<button type="button" class="cta ghost" id="i-retour">' + esc(t("adm.retourListe")) + '</button>' +
    '</form>';
  admBrancherLangues("i-langues");
  const inter = ADM.role === "intervenant";
  if (inter) {   // l'intervenant propose les changements de sa fiche ; l'association les valide
    ["i-type", "i-publie"].forEach((id) => { const el = document.getElementById(id); if (el) el.closest("label").remove(); });
    $$(".adm-invitation, #i-retour").forEach((x) => x.remove());
    $("#adm-form").insertAdjacentHTML("afterbegin", '<p class="member-note">' + esc(t("adm.ficheValidee")) + '</p>');
    $("#i-enregistrer").textContent = t("adm.envoyerProposition");
  }
  admBrancherPhoto("i-photo", inter ? "intervenants/" + ADM.moi : "intervenants");
  admBrancherVideo("i-video", "intervenants/" + (inter ? ADM.moi : (i.id || "nouveau")));
  admBrancherTraduire("i-traduire", ["i-role", "i-bio"]);
  if (!inter) $("#i-retour").addEventListener("click", () => peindreAdmin(corps));
  if (!n && !inter) $("#i-inviter").addEventListener("click", () => admInviter(i));
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
        await supaEcrire("POST", "propositions", { intervenant_id: ADM.moi, type: "fiche", donnees }, "return=minimal");
        if (mail && mail !== (ADM.contacts[ADM.moi] || "")) await supaEcrire("PATCH", "intervenants_contacts?intervenant_id=eq." + ADM.moi, { email: mail }, "return=minimal");
        await renderAdmin(corps);
        const z = $("#adm-zone"); if (z) z.insertAdjacentHTML("afterbegin", '<div class="resa-etat">' + esc(t("adm.propositionEnvoyee")) + '</div>');
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
    seances = await supaConnecte("seances?select=*&debut=gt." + encodeURIComponent(new Date(Date.now() - 8 * 864e5).toISOString()) + "&order=debut.asc");
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

async function peindreFormSeance(corps, x) {
  const n = !x;
  let resas = [];
  const inter = ADM.role === "intervenant";
  if (!n) { admChargement(); try { resas = inter
    // l'intervenant ne voit que la vue mes_inscrits : prénom et initiale, personnes, téléphone, reste à encaisser
    ? (await supaConnecte("mes_inscrits?select=id,nom,personnes,telephone,reste_sur_place_centimes,adherent&seance_id=eq." + x.id)).map((r) => Object.assign({ statut: "confirmee" }, r))
    : await supaConnecte("reservations?select=id,reference,nom,email,telephone,personnes,statut,annulee_par,absent_le,frais_centimes,frais_statut,reste_sur_place_centimes,paye_en_ligne_centimes,adherent&seance_id=eq." + x.id + "&order=cree_le.asc"); } catch (e) { resas = []; } }
  const confirmees = resas.filter((r) => r.statut === "confirmee");
  const bloque = confirmees.length > 0;   // inscrits : la date et le lieu ne bougent plus (annuler puis recréer)
  x = x || { langue: "fr", statut: "brouillon" };
  const annulee = x.statut === "annulee";
  const commencee = !n && new Date(x.debut) <= new Date(), finAbsences = !n && Date.now() < new Date(x.debut).getTime() + 7 * 864e5;
  window.scrollTo(0, 0);
  admZone().innerHTML =
    '<form id="adm-form" class="adm-form" novalidate>' +
      '<h2 class="adm-titre">' + esc(n ? t("adm.nouvelleSeance") : admTitreExp(x.experience_id) + " · " + admDate(x.debut, { weekday: "long", day: "numeric", month: "long" })) + '</h2>' +
      (annulee ? '<div class="resa-etat">' + esc(t("adm.sAnnuleeNote")) + '</div>' : '') +
      '<label class="adm-champ"><span>' + esc(t("adm.fiche")) + '</span>' +
        admSelect("s-exp", [["", t("adm.choisir")]].concat(ADM.exps.filter((e) => (inter ? ["visite_guidee", "atelier"] : ["visite_guidee", "atelier", "soiree"]).includes(e.type)).map((e) => [e.id, (e.titre && e.titre.fr) || e.slug])), x.experience_id || "") + '</label>' +
      '<div class="adm-grille">' +
        '<label class="adm-champ"><span>' + esc(t("adm.jour")) + '</span><input class="input-field" type="date" id="s-jour" value="' + esc(x.debut ? admJourParis(x.debut) : "") + '"></label>' +
        '<label class="adm-champ"><span>' + esc(t("adm.heure")) + '</span><input class="input-field" type="time" id="s-heure" value="' + esc(x.debut ? admHeureParis(x.debut) : "10:00") + '"></label>' +
        admNombre("s-duree", t("adm.duree"), x.fin && x.debut ? Math.round((new Date(x.fin) - new Date(x.debut)) / 6e4) : "") +
        '<label class="adm-champ"><span>' + esc(t("adm.langue")) + '</span>' + admSelect("s-langue", ADM_LANGUES.map((l) => [l, LANG_META[l].nom]), x.langue) + '</label>' +
        admNombre("s-max", t("adm.placesMax"), x.capacite_max) + admNombre("s-min", t("adm.participantsMin"), x.participants_min) +
      '</div>' +
      admNombre("s-adh", t("adm.tarifAdh"), x.prix_adherent_centimes == null ? "" : String(x.prix_adherent_centimes / 100).replace(".", ","), t("adm.tarifAdhAide")) +
      (bloque ? '<div class="member-note">' + esc(t("adm.sBloquee")) + '</div>' : '') +
      '<label class="adm-champ"><span>' + esc(t("adm.rdv")) + '</span><input class="input-field" id="s-rdv" value="' + esc(x.point_rdv || "") + '"></label>' +
      '<label class="adm-champ"><span>' + esc(t("adm.rdvPrecis")) + '</span><input class="input-field" id="s-precis" value="' + esc(x.point_rdv_precis || "") + '"><small class="member-note">' + esc(t("adm.rdvPrecisAide")) + '</small></label>' +
      '<label class="adm-champ"><span>' + esc(t("adm.message")) + '</span><input class="input-field" id="s-message" value="' + esc(x.message_inscrits || "") + '"></label>' +
      (annulee || (inter && x.statut === "publiee") ? '' : admCase("s-publiee", inter ? t("adm.sDemander") : t("adm.sPublier"), inter ? x.statut === "en_attente" : x.statut === "publiee")) +
      (inter && x.statut === "publiee" ? '<div class="member-note">' + esc(t("adm.sModifEnLigne")) + '</div>' : '') +
      (annulee ? '' : '<button type="submit" class="cta fee" id="s-enregistrer">' + esc(t("adm.enregistrer")) + '</button>') +
      '<div class="resa-erreur" id="s-note" role="alert"></div>' +
      (n ? '' :
        '<h3 class="adm-sous-titre">' + esc(tx("adm.inscritsTitre", { n: confirmees.reduce((k, r) => k + r.personnes, 0) })) + '</h3>' +
        (resas.length ? '<div class="adm-liste adm-inscrits">' + resas.map((r) => {
          const absent = r.absent_le ? t("adm.absentSignale") : "";
          const etatR = r.statut === "confirmee" ? (absent || t("adm.rConfirmee")) : t("adm.r." + r.statut);
          return '<div class="adm-ligne"><span class="adm-ligne-corps"><span class="adm-ligne-titre">' + esc(r.nom) + ' · ' + esc(tx("adm.pers", { n: r.personnes })) +
              (r.adherent ? ' <span class="badge-adherent">' + esc(t("adm.badgeAdherent")) + '</span>' : '') + '</span>' +
            '<span class="adm-ligne-meta">' + esc([r.reference, r.telephone, r.email, etatR, r.statut === "confirmee" ? tx("adm.resteSurPlace", { m: euros(r.reste_sur_place_centimes || 0) }) : ""].filter(Boolean).join(" · ")) + '</span>' +
            (r.frais_centimes ? '<span class="adm-ligne-meta">' + esc(tx("adm.frais", { m: euros(r.frais_centimes), s: t("adm.f." + r.frais_statut) })) + '</span>' : '') + '</span>' +
            (r.statut === "confirmee" && !r.absent_le && commencee && finAbsences ? '<button type="button" class="chip" data-adm-absent="' + esc(r.id) + '">' + esc(t("adm.absent")) + '</button>' : '') +
          '</div>';
        }).join("") + '</div>' : '<div class="member-note">' + esc(t("adm.aucunInscrit")) + '</div>') +
        '<div class="member-note" id="s-absent-note" role="status"></div>' +
        (annulee ? '' : inter ? '<div class="member-note">' + esc(t("adm.annulerIntervenant")) + ' <a href="mailto:' + esc(CONFIG.contacts.general) + '">' + esc(CONFIG.contacts.general) + '</a></div>' :
          '<div class="adm-encart"><b>' + esc(t("adm.annulerSeance")) + '</b><p class="member-note">' + esc(t("adm.annulerAide")) + '</p>' +
            admSelect("s-motif", [["annulation_organisation", t("adm.motifOrga")], ["intervenant_empeche", t("adm.motifIntervenant")]], "annulation_organisation") +
            '<button type="button" class="cta ghost" id="s-annuler">' + esc(t("adm.annulerSeance")) + '</button>' +
            '<div class="resa-erreur" id="s-annuler-note" role="alert"></div></div>')) +
      '<button type="button" class="cta ghost" id="s-retour">' + esc(t("adm.retourListe")) + '</button>' +
    '</form>';
  if (bloque) ["s-exp", "s-jour", "s-heure", "s-langue", "s-rdv"].forEach((id) => { $("#" + id).disabled = true; });
  $("#s-retour").addEventListener("click", () => peindreAdmin(corps));
  $("#s-exp").addEventListener("change", () => {   // une nouvelle séance reprend les places et le rendez-vous de la fiche
    const e = ADM.exps.find((y) => y.id === admVal("s-exp"));
    if (!e || !n) return;
    if (!admVal("s-max") && e.capacite_max) $("#s-max").value = e.capacite_max;
    if (!admVal("s-min") && e.participants_min) $("#s-min").value = e.participants_min;
    if (!admVal("s-duree") && e.duree_minutes) $("#s-duree").value = e.duree_minutes;
    if (!admVal("s-rdv") && e.point_rdv && e.point_rdv.fr) $("#s-rdv").value = e.point_rdv.fr;
  });
  $$("[data-adm-absent]").forEach((b) => b.addEventListener("click", async () => {
    if (!confirm(t("adm.absentConfirmer"))) return;
    b.disabled = true;
    try {
      const r = await supaEcrire("POST", "rpc/signaler_absence", { p_reservation_id: b.dataset.admAbsent });
      $("#s-absent-note").textContent = r && r.frais_centimes ? tx("adm.absentFrais", { m: euros(r.frais_centimes) }) : t("adm.absentSansFrais");
      b.remove();
    } catch (e) { $("#s-absent-note").textContent = admErreur(e); b.disabled = false; }
  }));
  if (!n && !annulee && !inter) $("#s-annuler").addEventListener("click", async () => {
    if (!confirm(tx("adm.annulerConfirmer", { n: confirmees.length }))) return;
    const note = $("#s-annuler-note");
    try {
      const r = await supaEcrire("POST", "rpc/annuler_seance", { p_seance_id: x.id, p_motif: admVal("s-motif") });
      await peindreFormSeance(corps, Object.assign({}, x, { statut: "annulee" }));
      $("#s-note").textContent = tx("adm.annuleeFaite", { n: (r && r.inscrits) || 0 });
    } catch (e) { note.textContent = admErreur(e); }
  });
  if (annulee) return;
  $("#adm-form").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const note = $("#s-note"), b = $("#s-enregistrer");
    const jour = admVal("s-jour"), heure = admVal("s-heure"), max = admEntier(admVal("s-max")), min = admEntier(admVal("s-min")) || 1;
    if (!admVal("s-exp") || !/^\d{4}-\d{2}-\d{2}$/.test(jour) || !/^\d{2}:\d{2}$/.test(heure) || !max) { note.textContent = t("adm.sIncomplete"); return; }
    const debut = admParisVersIso(jour, heure), duree = admEntier(admVal("s-duree"));
    if (n && new Date(debut) < new Date()) { note.textContent = t("adm.sPassee"); return; }
    // Tarif adhérent : euros saisis → centimes ; vide = pas de remise ; jamais plus que le prix normal.
    const adhTexte = String(admVal("s-adh") || "").trim().replace(",", ".");
    const prixAdh = adhTexte ? Math.round(parseFloat(adhTexte) * 100) : null;
    const expSeance = ADM.exps.find((y) => y.id === (admVal("s-exp") || x.experience_id)) || {};
    if (adhTexte && !(prixAdh >= 0)) { note.textContent = t("adm.sIncomplete"); return; }
    if (prixAdh != null && expSeance.prix_centimes != null && prixAdh > expSeance.prix_centimes) {
      note.textContent = tx("adm.tarifAdhErreur", { m: euros(expSeance.prix_centimes) }); return;
    }
    const d = { capacite_max: max, participants_min: min, point_rdv_precis: admVal("s-precis") || null, message_inscrits: admVal("s-message") || null,
      statut: inter ? (x.statut === "publiee" ? "publiee" : admCoche("s-publiee") ? "en_attente" : "brouillon")
        : admCoche("s-publiee") ? "publiee" : "brouillon" };
    if (prixAdh != null || x.prix_adherent_centimes != null) d.prix_adherent_centimes = prixAdh;   // envoyé seulement s'il sert
    if (!bloque) Object.assign(d, { experience_id: admVal("s-exp"), debut, fin: duree ? new Date(new Date(debut).getTime() + duree * 6e4).toISOString() : null,
      langue: admVal("s-langue"), point_rdv: admVal("s-rdv") || null });
    if (bloque && d.statut !== "publiee") { note.textContent = t("adm.sDepublierInscrits"); return; }
    b.disabled = true; note.textContent = t("member.loading");
    try {
      if (inter && !n && x.statut === "publiee") {   // séance en ligne : changement proposé, appliqué par l'association
        delete d.statut;
        await supaEcrire("POST", "propositions", { intervenant_id: ADM.moi, type: "seance", cible_id: x.id, donnees: d }, "return=minimal");
        await renderAdmin(corps);
        admZone().insertAdjacentHTML("afterbegin", '<div class="resa-etat">' + esc(t("adm.propositionEnvoyee")) + '</div>');
        return;
      }
      if (n) await supaEcrire("POST", "seances", d, "return=minimal");
      else await supaEcrire("PATCH", "seances?id=eq." + x.id, d, "return=minimal");
      await peindreListeSeances(corps);
      admZone().insertAdjacentHTML("afterbegin", '<div class="resa-etat">' + esc(t("adm.enregistre")) + '</div>');
    } catch (e) { note.textContent = /participants_min|check/.test(e.message) ? t("adm.erreurMinMax") : admErreur(e); b.disabled = false; }
  });
}

/* ---------- Adhésions ---------- */

async function peindreAdhesions(corps) {
  admChargement();
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
    '<div class="adm-liste" id="adm-adh-liste"></div>' +
    '<details class="adm-encart"><summary><b>' + esc(t("adm.adhManuelle")) + '</b></summary>' +
      '<p class="member-note">' + esc(t("adm.adhManuelleAide")) + '</p>' +
      '<label class="adm-champ"><span>' + esc(t("adm.emailContact")) + '</span><input class="input-field" id="m-email" type="email"></label>' +
      '<label class="adm-champ"><span>' + esc(t("adm.nom")) + '</span><input class="input-field" id="m-nom"></label>' +
      '<label class="adm-champ"><span>' + esc(t("adm.jusquau")) + '</span><input class="input-field" id="m-fin" type="date" value="' +
        esc(new Date(Date.now() + 365 * 864e5).toISOString().slice(0, 10)) + '"></label>' +
      '<button type="button" class="cta ghost" id="m-ajouter">' + esc(t("adm.ajouter")) + '</button><div class="member-note" id="m-note" role="status"></div>' +
    '</details>';
  dessiner("");
  $("#adm-adh-filtre").addEventListener("input", (ev) => dessiner(ev.target.value));
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
      supaConnecte("candidatures?select=*&order=cree_le.desc&limit=100"),
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
    '<h3 class="adm-sous-titre">' + esc(tx("adm.candidatures", { n: cands.filter((c) => c.statut === "nouvelle").length })) + '</h3>' +
    (cands.length ? '<div class="adm-liste">' + cands.map((c) => carte(c, "candidatures", STATUTS_C, [
      admDate(c.cree_le, { day: "numeric", month: "short" }) + " · " + t("adm.typeInt." + c.type)])).join("") + '</div>'
      : '<div class="member-note">' + esc(t("adm.aucuneCandidature")) + '</div>') +
    '<div class="member-note" id="d-note" role="status"></div>';
  ADM.nonTraitees = groupes.filter((g) => g.statut === "nouvelle").length + cands.filter((c) => c.statut === "nouvelle").length;
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
        '<div class="adm-ligne"><span class="adm-ligne-corps"><span class="adm-ligne-titre">' + esc(r.nom) +
            (r.adherent ? ' <span class="badge-adherent">' + esc(t("adm.badgeAdherent")) + '</span>' : '') + '</span>' +
          '<span class="adm-ligne-meta">' + esc(tx("adm.pers", { n: r.personnes })) + ' · ' + (r.telephone ? '<a href="tel:' + esc(r.telephone) + '">' + esc(r.telephone) + '</a> · ' : '') +
            '<b>' + esc(tx("adm.resteSurPlace", { m: euros(r.reste_sur_place_centimes || 0) })) + '</b></span>' +
          (r.absent_le ? '<span class="adm-ligne-meta adm-absent">' + esc(r.frais_centimes ? tx("adm.absentEtat", { m: euros(r.frais_centimes) }) : t("adm.absentSignale")) + '</span>' : '') + '</span>' +
          (commencee && !r.absent_le ? '<button type="button" class="chip" data-adm-absent="' + esc(r.id) + '">' + esc(t("adm.absent")) + '</button>' : '') + '</div>').join("") + '</div>';
  }).join("") + '<div class="member-note adm-absent-aide">' + esc(t("adm.absentAide")) + '</div><div class="member-note" id="s-absent-note" role="status"></div>'
    : '<div class="member-note">' + esc(t("adm.aucunInscrit")) + '</div>';
  $$("[data-adm-absent]").forEach((b) => b.addEventListener("click", async () => {
    if (!confirm(t("adm.absentConfirmer"))) return;
    b.disabled = true;
    try {
      const r = await supaEcrire("POST", "rpc/signaler_absence", { p_reservation_id: b.dataset.admAbsent });
      $("#s-absent-note").textContent = r && r.frais_centimes ? tx("adm.absentFrais", { m: euros(r.frais_centimes) }) : t("adm.absentSansFrais");
      b.textContent = t("adm.absentSignale");
    } catch (e) { $("#s-absent-note").textContent = admErreur(e); b.disabled = false; }
  }));
}

/* ---------- Administration : changements proposés par les intervenants (canvas E12) ---------- */

function peindreValidations(corps) {
  const nomInt = (id) => (ADM.ints.find((i) => i.id === id) || {}).nom || "";
  const CHAMPS = { nom: "adm.nom", role: "adm.metier", bio: "adm.bio", photo_url: "adm.photo", instagram: "adm.instagram", langues: "adm.langues",
    debut: "adm.jour", fin: "adm.duree", langue: "adm.langue", capacite_max: "adm.placesMax", participants_min: "adm.participantsMin",
    point_rdv: "adm.rdv", point_rdv_precis: "adm.rdvPrecis", message_inscrits: "adm.message", prix_adherent_centimes: "adm.tarifAdh" };
  const valeur = (k, v) => v == null || v === "" ? "–" : k === "prix_adherent_centimes" ? euros(v) : k === "debut" || k === "fin" ? admDate(v, { weekday: "short", day: "numeric", month: "short" }) + " " + admHeure(v)
    : Array.isArray(v) ? v.join(", ") : typeof v === "object" ? (v.fr || "") : String(v);
  admZone().innerHTML = '<div class="adm-liste">' + (ADM.props || []).map((p) =>
    '<div class="adm-ligne adm-demande"><span class="adm-ligne-corps">' +
      '<span class="adm-ligne-titre">' + esc(nomInt(p.intervenant_id)) + '</span>' +
      '<span class="adm-ligne-meta">' + esc(admDate(p.cree_le, { day: "numeric", month: "short" }) + " · " + t("adm.prop." + p.type)) + '</span>' +
      Object.keys(p.donnees || {}).filter((k) => CHAMPS[k] && !(k === "photo_url" && !p.donnees[k])).map((k) =>
        '<span class="adm-message"><b>' + esc(t(CHAMPS[k])) + ' :</b> ' + (k === "photo_url" ? '<img class="adm-vignette" src="' + esc(p.donnees[k]) + '" alt="">' : esc(valeur(k, p.donnees[k]))) + '</span>').join("") +
      '<span class="adm-actions"><button type="button" class="chip active" data-valider="' + esc(p.id) + '">' + esc(t("adm.valider")) + '</button> ' +
        '<button type="button" class="chip" data-refuser="' + esc(p.id) + '">' + esc(t("adm.refuser")) + '</button></span>' +
    '</span></div>').join("") + '</div><div class="member-note" id="v-note" role="status"></div>';
  const agir = (fn, id) => async () => {
    try {
      const r = await supaEcrire("POST", "rpc/" + fn, fn === "valider_proposition" ? { p_id: id } : { p_id: id, p_motif: null });
      await renderAdmin(corps);
      const msg = r && r.inscrits_a_prevenir ? tx("adm.validePrevenir", { n: r.inscrits_a_prevenir }) : t("adm.enregistre");
      admZone().insertAdjacentHTML("afterbegin", '<div class="resa-etat">' + esc(msg) + '</div>');
    } catch (e) { $("#v-note").textContent = /CAPACITE|MINIMUM/.test(e.message) ? t("adm.erreurMinMax") : admErreur(e); }
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
