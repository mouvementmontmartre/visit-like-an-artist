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
const ADM_TRAD = ["en", "es"];   // traductions saisies à la main en attendant ChatGPT (6.5)

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
    '<details class="adm-trad"><summary>' + esc(t("adm.traductions")) + '</summary>' +
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

async function renderAdmin(corps, nom) {
  ADM.nom = nom || ADM.nom;
  corps.innerHTML = '<div class="loading">' + esc(t("member.loading")) + '</div>';
  try {
    const [exps, ints, contacts, profils] = await Promise.all([
      supaConnecte("experiences?select=*&order=ordre.asc,cree_le.desc"),
      supaConnecte("intervenants?select=*&order=nom.asc"),
      supaConnecte("intervenants_contacts?select=intervenant_id,email"),
      supaConnecte("profils?select=intervenant_id&role=eq.intervenant"),
    ]);
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
  const onglet = (k, libelle, n) => '<button type="button" class="chip' + (ADM.onglet === k ? " active" : "") + '" data-adm-onglet="' + k + '">' +
    esc(libelle) + ' · ' + n + '</button>';
  corps.innerHTML =
    '<h1 class="espace-titre">' + esc(tx("espace.bonjour", { nom: ADM.nom })) + '</h1>' +
    '<div class="adm-sous">' + esc(t("adm.sous")) + '</div>' +
    (aValider ? '<div class="resa-etat">' + esc(tx("adm.aValiderNote", { n: aValider })) + '</div>' : '') +
    '<div class="filter-chips adm-onglets" role="tablist">' +
      onglet("fiches", t("adm.fiches"), ADM.exps.length) + onglet("intervenants", t("adm.intervenants"), ADM.ints.length) +
    '</div>' +
    '<div id="adm-zone"></div>' +
    '<button type="button" class="cta ghost" id="espace-deconnexion">' + esc(t("espace.deconnexion")) + '</button>';
  $$("[data-adm-onglet]").forEach((b) => b.addEventListener("click", () => { ADM.onglet = b.dataset.admOnglet; peindreAdmin(corps); }));
  $("#espace-deconnexion").addEventListener("click", deconnecter);
  if (ADM.onglet === "fiches") peindreListeFiches(corps); else peindreListeIntervenants(corps);
}

function peindreListeFiches(corps) {
  const zone = $("#adm-zone");
  const nomInt = (id) => (ADM.ints.find((i) => i.id === id) || {}).nom || "";
  zone.innerHTML =
    '<button type="button" class="cta fee" id="adm-nouvelle-fiche">' + esc(t("adm.nouvelleFiche")) + '</button>' +
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
  proposerReprise(corps);
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
        admNombre("f-frais", t("adm.fraisTardifs"), admEuros(e.frais_annulation_tardive_centimes)) +
        admNombre("f-max", t("adm.placesMax"), e.capacite_max) +
        admNombre("f-min", t("adm.participantsMin"), e.participants_min) +
        admNombre("f-age", t("adm.ageMin"), e.age_minimum) +
      '</div>' +
      admCase("f-tel", t("adm.telObligatoire"), e.telephone_obligatoire) +
      admCase("f-privat", t("adm.privatisable"), e.privatisable) +
      '<h3 class="adm-sous-titre">' + esc(t("adm.visibilite")) + '</h3>' +
      admCase("f-publie", t("adm.publier"), e.publie) +
      (n ? '' : admCase("f-actif", t("adm.actif"), e.actif)) +
      '<div class="member-note">' + esc(t("adm.publierAide")) + '</div>' +
      '<button type="submit" class="cta fee" id="f-enregistrer">' + esc(t("adm.enregistrer")) + '</button>' +
      '<div class="resa-erreur" id="f-note" role="alert"></div>' +
      '<button type="button" class="cta ghost" id="f-retour">' + esc(t("adm.retourListe")) + '</button>' +
    '</form>';
  admBrancherLangues("f-langues");
  admBrancherPhoto("f-photo", "fiches");
  const pos = { lat: e.point_rdv_lat, lng: e.point_rdv_lng };
  admCarte("f-carte", pos, () => { $("#f-carte-note").textContent = t("adm.rdvPlace"); });
  $("#f-retour").addEventListener("click", () => peindreAdmin(corps));
  $("#adm-form").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const note = $("#f-note"), b = $("#f-enregistrer");
    const titre = admTraduit("f-titre");
    if (!titre.fr) { note.textContent = t("adm.titreManquant"); return; }
    const publie = admCoche("f-publie");
    const donnees = {
      type: admVal("f-type"), titre, accroche: admTraduit("f-accroche"), description: admTraduit("f-description"),
      intervenant_id: admVal("f-int") || null, duree_minutes: admEntier(admVal("f-duree")),
      langues: admLanguesChoisies("f-langues").length ? admLanguesChoisies("f-langues") : ["fr"],
      photo_url: $("#f-photo").dataset.url || null, point_rdv: admTraduit("f-rdv"),
      point_rdv_lat: pos.lat == null ? null : pos.lat, point_rdv_lng: pos.lng == null ? null : pos.lng,
      prix_centimes: admCentimes(admVal("f-prix")), prereservation_centimes: admCentimes(admVal("f-preresa")),
      prix_libre_min_centimes: admCentimes(admVal("f-libre")),
      frais_annulation_tardive_centimes: admCentimes(admVal("f-frais")) == null ? 1000 : admCentimes(admVal("f-frais")),
      capacite_max: admEntier(admVal("f-max")), participants_min: admEntier(admVal("f-min")) || 1,
      age_minimum: admEntier(admVal("f-age")), telephone_obligatoire: admCoche("f-tel"), privatisable: admCoche("f-privat"),
      publie,
    };
    if (!n) donnees.actif = admCoche("f-actif");
    if (publie) donnees.a_valider = false;   // publier une proposition, c'est la valider
    b.disabled = true; note.textContent = t("member.loading");
    try {
      if (n) {
        donnees.slug = admSlug(titre.fr, ADM.exps.map((x) => x.slug));
        donnees.localite_id = (currentLocalite() || {}).id || CONFIG.localiteParDefaut;
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
      admLanguesHtml("i-langues", i.langues) +
      '<label class="adm-champ"><span>' + esc(t("adm.instagram")) + '</span><input class="input-field" id="i-insta" value="' + esc(i.instagram || "") + '" placeholder="@"></label>' +
      '<h3 class="adm-sous-titre">' + esc(t("adm.contact")) + '</h3>' +
      '<label class="adm-champ"><span>' + esc(t("adm.emailContact")) + '</span>' +
        '<input class="input-field" id="i-email" type="email" inputmode="email" autocomplete="off" value="' + esc(email) + '">' +
        '<small class="member-note">' + esc(t("adm.emailAide")) + '</small></label>' +
      admCase("i-publie", t("adm.publierIntervenant"), i.publie) +
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
  admBrancherPhoto("i-photo", "intervenants");
  $("#i-retour").addEventListener("click", () => peindreAdmin(corps));
  if (!n) $("#i-inviter").addEventListener("click", () => admInviter(i));
  $("#adm-form").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const note = $("#i-note"), b = $("#i-enregistrer");
    const nom = admVal("i-nom");
    const mail = admVal("i-email").toLowerCase();
    if (!nom) { note.textContent = t("adm.nomManquant"); return; }
    if (mail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mail)) { note.textContent = t("member.emailInvalid"); return; }
    const donnees = { type: admVal("i-type"), nom, role: admTraduit("i-role"), bio: admTraduit("i-bio"),
      photo_url: $("#i-photo").dataset.url || null, langues: admLanguesChoisies("i-langues").length ? admLanguesChoisies("i-langues") : ["fr"],
      instagram: admVal("i-insta") || null, publie: admCoche("i-publie") };
    b.disabled = true; note.textContent = t("member.loading");
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
          slug: admSlug(guide, ints.map((x) => x.slug)), localite_id: loc, publie: false }))[0];
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
