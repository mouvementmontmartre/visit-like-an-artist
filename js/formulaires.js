/* ============================================================
   FORMULAIRES PUBLICS (étape 6.4) : demande privée (E7) et
   « Nous rejoindre » (E14). Écran #screen-demande. L'envoi passe par
   la fonction Netlify « demande » (jamais d'écriture directe dans la
   base depuis le navigateur). Chargé après app.js.
   ============================================================ */

const FORM = { ouvert: 0 };

function formChips(id, options, actif) {
  return '<div class="adm-puces" id="' + id + '" role="radiogroup">' + options.map((o) =>
    '<button type="button" class="chip' + (o[0] === actif ? " active" : "") + '" role="radio" aria-checked="' + (o[0] === actif) + '" data-v="' + esc(o[0]) + '">' + esc(o[1]) + '</button>').join("") + '</div>';
}
function formBrancherChips(id, quandChange) {
  $$("#" + id + " .chip").forEach((b) => b.addEventListener("click", () => {
    $$("#" + id + " .chip").forEach((x) => { x.classList.toggle("active", x === b); x.setAttribute("aria-checked", x === b); });
    if (quandChange) quandChange(b.dataset.v);
  }));
}
const formChoix = (id) => { const b = $("#" + id + " .chip.active"); return b ? b.dataset.v : ""; };
const formChamp = (id, libelle, attrs) => '<label class="adm-champ"><span>' + esc(libelle) + '</span><input class="input-field" id="' + id + '" ' + (attrs || "") + '></label>';

async function envoyerDemande(corps, note, bouton) {
  bouton.disabled = true; note.textContent = t("member.loading");
  try {
    const res = await fetch("/.netlify/functions/demande", { method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(Object.assign(corps, { duree_ms: Date.now() - FORM.ouvert, site_web: ($("#form-site") || {}).value || "" })) });
    const d = await res.json().catch(() => ({}));
    if (res.ok) return true;
    note.textContent = t({ NOM: "form.erreurNom", EMAIL: "member.emailInvalid", MESSAGE: "form.erreurMessage", TROP: "form.erreurTrop" }[d.error] || "form.erreur");
  } catch (e) { note.textContent = t("form.erreur"); }
  bouton.disabled = false;
  return false;
}

function formEnvoye(titre, texte) {
  window.scrollTo(0, 0);
  $("#demande-body").innerHTML =
    '<div class="resa-ok"><span aria-hidden="true">✓</span></div>' +
    '<h1 class="espace-titre">' + esc(titre) + '</h1><p class="espace-texte">' + esc(texte) + '</p>' +
    '<button type="button" class="cta ghost" data-back>' + esc(t("resa.back")) + '</button>';
}

/* Champ piège invisible pour les robots (ne pas remplir). */
const formPiege = '<div class="visually-hidden" aria-hidden="true"><label>Site web<input id="form-site" tabindex="-1" autocomplete="off"></label></div>';

/** Demande privée. arg : identifiant (slug) d'une fiche pour la présélectionner. */
async function renderDemande(arg) {
  FORM.ouvert = Date.now();
  $("#demande-titre").textContent = t("form.priveTitreEcran");
  $("#demande-sous").textContent = t("form.priveSousEcran");
  const corps = $("#demande-body");
  corps.innerHTML = '<div class="loading">' + esc(t("member.loading")) + '</div>';
  let visites = [];
  try { visites = (await loadVisites()).filter((v) => ["visite", "atelier"].includes(offreTypeOf(v)) && !(v._exp && v._exp.type === "autoguidee")); } catch (e) { visites = []; }
  const choisie = visites.find((v) => v["id"] === arg);
  let type = choisie ? offreTypeOf(choisie) : "visite";
  const options = () => [["", t("form.pasDePreference")]].concat(visites.filter((v) => offreTypeOf(v) === type)
    .map((v) => [v["id"], trField(v, "Nom") + (v["Guide"] ? ", " + t("card.with").toLowerCase() + " " + v["Guide"] : "")]));
  corps.innerHTML =
    '<h1 class="espace-titre" id="f-titre-prive"></h1>' +
    '<p class="espace-texte">' + esc(t("form.priveTexte")) + '</p>' +
    '<form id="form-prive" class="adm-form" novalidate>' + formPiege +
      formChips("f-type", [["visite", t("badge.visite")], ["atelier", t("badge.atelier")]], type) +
      '<label class="adm-champ"><span>' + esc(t("form.quelleProposition")) + '</span><select class="input-field" id="f-exp"></select>' +
        '<small class="member-note">' + esc(t("form.conseil")) + '</small></label>' +
      formChamp("f-personnes", t("form.personnes"), 'type="number" inputmode="numeric" min="1" max="500" value="2"') +
      '<div class="adm-champ"><span>' + esc(t("form.occasion")) + '</span>' +
        formChips("f-occasion", ["anniversaire", "famille", "entreprise", "ecole", "amis", "autre"].map((k) => [k, t("form.occ." + k)]), "") + '</div>' +
      formChamp("f-periode", t("form.periode"), 'placeholder="' + esc(t("form.periodeExemple")) + '" maxlength="200"') +
      '<div class="adm-champ"><span>' + esc(t("adm.langue")) + '</span>' +
        formChips("f-langue", [["fr", "Français"], ["en", "English"], ["es", "Español"]], getLang() === "en" || getLang() === "es" ? getLang() : "fr") + '</div>' +
      '<h3 class="adm-sous-titre">' + esc(t("form.coordonnees")) + '</h3>' +
      formChamp("f-nom", t("resa.name"), 'autocomplete="name" maxlength="120"') +
      formChamp("f-email", t("form.email"), 'type="email" inputmode="email" autocomplete="email"') +
      formChamp("f-tel", t("form.telephone"), 'type="tel" inputmode="tel" autocomplete="tel" maxlength="30"') +
      '<label class="adm-champ"><span>' + esc(t("form.message")) + '</span><textarea class="input-field adm-texte" id="f-message" rows="4" maxlength="4000" placeholder="' + esc(t("form.messageExemple")) + '"></textarea></label>' +
      '<button type="submit" class="cta fee" id="f-envoyer">' + esc(t("form.envoyer")) + '</button>' +
      '<div class="member-note">' + esc(t("form.reponseEmail")) + '</div>' +
      '<div class="resa-erreur" id="f-note" role="alert"></div>' +
    '</form>';
  const remplir = () => { $("#f-exp").innerHTML = options().map((o) => '<option value="' + esc(o[0]) + '"' + (choisie && o[0] === choisie["id"] ? " selected" : "") + '>' + esc(o[1]) + '</option>').join(""); };
  const titrer = () => { $("#f-titre-prive").innerHTML = esc(t(type === "atelier" ? "form.priveTitreAtelier" : "form.priveTitre")) + ' <em>' + esc(t("form.priveTitreFin")) + '</em>'; };
  remplir(); titrer();
  formBrancherChips("f-type", (v) => { type = v; remplir(); titrer(); });
  formBrancherChips("f-occasion"); formBrancherChips("f-langue");
  $("#form-prive").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const note = $("#f-note"), email = $("#f-email").value.trim().toLowerCase();
    if (!$("#f-nom").value.trim()) { note.textContent = t("form.erreurNom"); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { note.textContent = t("member.emailInvalid"); return; }
    const ok = await envoyerDemande({ formulaire: "prive", type, experience: $("#f-exp").value, personnes: $("#f-personnes").value,
      occasion: formChoix("f-occasion"), periode: $("#f-periode").value, langue: formChoix("f-langue"),
      nom: $("#f-nom").value, email, telephone: $("#f-tel").value, message: $("#f-message").value }, note, $("#f-envoyer"));
    if (ok) formEnvoye(t("form.envoyeTitre"), t("form.priveEnvoye"));
  });
}

/** « Nous rejoindre » : guides, artistes et lieux. */
function renderRejoindre(typeVoulu) {
  FORM.ouvert = Date.now();
  $("#demande-titre").textContent = t("form.rejoindreTitreEcran");
  $("#demande-sous").textContent = t("espace.sous");
  $("#demande-body").innerHTML =
    '<h1 class="espace-titre">' + esc(t("form.rejoindreTitre")) + ' <em>' + esc(t("form.rejoindreTitreFin")) + '</em></h1>' +
    '<p class="espace-texte">' + esc(t("form.rejoindreTexte")) + '</p>' +
    '<form id="form-rejoindre" class="adm-form" novalidate>' + formPiege +
      '<div class="adm-champ"><span>' + esc(t("form.vousEtes")) + '</span>' +
        formChips("r-type", ["guide", "artiste", "lieu", "autre"].map((k) => [k, t("adm.typeInt." + k)]), ["guide", "artiste", "lieu", "autre"].includes(typeVoulu) ? typeVoulu : "guide") + '</div>' +
      formChamp("r-nom", t("form.nomOuLieu"), 'autocomplete="name" maxlength="120"') +
      formChamp("r-email", t("form.email"), 'type="email" inputmode="email" autocomplete="email"') +
      formChamp("r-tel", t("form.telephone"), 'type="tel" inputmode="tel" autocomplete="tel" maxlength="30"') +
      '<label class="adm-champ"><span>' + esc(t("form.proposez")) + '</span><textarea class="input-field adm-texte" id="r-message" rows="5" maxlength="4000" placeholder="' + esc(t("form.proposezExemple")) + '"></textarea></label>' +
      '<div class="member-note adm-encart">' + esc(t("form.rejoindreNote")) + '</div>' +
      '<button type="submit" class="cta fee" id="r-envoyer">' + esc(t("form.envoyer")) + '</button>' +
      '<div class="resa-erreur" id="r-note" role="alert"></div>' +
    '</form>';
  formBrancherChips("r-type");
  $("#form-rejoindre").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const note = $("#r-note"), email = $("#r-email").value.trim().toLowerCase();
    if (!$("#r-nom").value.trim()) { note.textContent = t("form.erreurNom"); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { note.textContent = t("member.emailInvalid"); return; }
    if (!$("#r-message").value.trim()) { note.textContent = t("form.erreurMessage"); return; }
    const ok = await envoyerDemande({ formulaire: "rejoindre", type: formChoix("r-type"), nom: $("#r-nom").value, email,
      telephone: $("#r-tel").value, message: $("#r-message").value }, note, $("#r-envoyer"));
    if (ok) formEnvoye(t("form.envoyeTitre"), t("form.rejoindreEnvoye"));
  });
}

/* ============================================================
   PAGE D'UN INTERVENANT (canvas E6.1, étape 6.5)
   Photo, métier, langues, vidéo FACULTATIVE (aperçu carré, plein écran
   vertical au toucher), présentation, ses propositions. Chaque bloc
   n'apparaît que s'il a un contenu : pas de vide sans vidéo ni texte.
   ============================================================ */

async function renderHote(id) {
  const corps = $("#hote-body");
  $("#hote-titre").textContent = "";
  corps.innerHTML = '<div class="loading">' + esc(t("member.loading")) + '</div>';
  let h = null, visites = [];
  try {
    h = (await supa("intervenants?select=id,nom,role,bio,photo_url,video_url,sous_titres_url,langues,instagram,langues_relues&publie=eq.true&id=eq." + encodeURIComponent(id || "")))[0];
    visites = (await loadVisites()).filter((v) => v._intervenant === id);
  } catch (e) { h = null; }
  if (!h) { corps.innerHTML = '<div class="member-note">' + esc(t("member.error")) + '</div>'; return; }
  $("#hote-titre").textContent = h.nom;
  const mots = String(h.nom).trim().split(/\s+/), fin = mots.length > 1 ? mots.pop() : "";
  const metier = parLangue(h.role) || "", bio = parLangue(h.bio) || "";
  const l = getLang(), auto = l !== "fr" && !(h.langues_relues || []).includes(l) && ((h.bio && h.bio[l]) || (h.role && h.role[l]));
  const initiales = String(h.nom).split(/\s+/).map((m) => m[0]).join("").slice(0, 2).toUpperCase();
  const priveesPossibles = visites.filter((v) => ["visite", "atelier"].includes(offreTypeOf(v)));
  // Encadré « … rien que pour vous ? » selon ce que propose l'intervenant : visites, ateliers, ou les deux.
  const ateliers = priveesPossibles.filter((v) => offreTypeOf(v) === "atelier").length;
  const sorte = !ateliers ? "" : ateliers === priveesPossibles.length ? "Atelier" : "Mixte";
  corps.innerHTML =
    '<div class="hote-tete">' +
      (h.photo_url ? '<img class="hote-photo" src="' + esc(h.photo_url) + '" alt="">' : '<span class="hote-photo hote-initiales" aria-hidden="true">' + esc(initiales) + '</span>') +
      '<h1 class="espace-titre">' + esc(mots.join(" ")) + (fin ? ' <em>' + esc(fin) + '</em>' : '') + '</h1>' +
      (metier ? '<p class="hote-metier">' + esc(metier) + '</p>' : '') +
      ((h.langues || []).length ? '<div class="adm-puces">' + h.langues.filter((x) => LANG_META[x]).map((x) => '<span class="chip">' + esc(LANG_META[x].nom) + '</span>').join("") + '</div>' : '') +
    '</div>' +
    (h.video_url
      ? '<button type="button" class="hote-video" id="hote-video" aria-label="' + esc(tx("hote.videoOuvrir", { nom: h.nom })) + '">' +
          '<video src="' + esc(h.video_url) + '#t=0.5" muted playsinline preload="metadata" aria-hidden="true"></video>' +
          '<span class="hote-play" aria-hidden="true"><svg viewBox="0 0 24 24" width="28" height="28"><path d="M8 5v14l11-7z" fill="currentColor"/></svg></span>' +
        '</button><p class="member-note">' + esc(t("hote.videoLegende")) + '</p>'
      : '') +
    (bio ? '<h2 class="adm-sous-titre">' + esc(t("hote.apropos")) + '</h2><p class="espace-texte hote-bio">' + esc(bio) + '</p>' +
      (auto ? '<p class="trad-auto">' + esc(t("trad.auto")) + '</p>' : '') : '') +
    (visites.length ? '<h2 class="adm-sous-titre">' + esc(t("hote.propositions")) + '</h2><div class="adm-liste">' + visites.map((v) =>
      '<button type="button" class="adm-ligne" data-open="visite" data-arg="' + esc(v["id"]) + '"><span class="adm-ligne-corps">' +
        '<span class="adm-ligne-titre">' + esc(trField(v, "Nom")) + '</span>' +
        ((trField(v, "Accroche") || trField(v, "Description")) ? '<span class="adm-ligne-meta">' + esc(trField(v, "Accroche") || trField(v, "Description")) + '</span>' : '') +
      '</span>' + (v["Tarif direct"] ? '<span class="act-price">' + esc(v["Tarif direct"]) + '</span>' : '') + '</button>').join("") + '</div>' : '') +
    (priveesPossibles.length ? '<div class="adm-encart prive-encart"><div class="prive-titre">' + esc(t("hote.priveTitre" + sorte)) + '</div>' +
      '<p class="member-note">' + esc(tx("hote.priveTexte" + sorte, { nom: mots[0] })) + '</p>' +
      '<button type="button" class="cta fee" data-open="demande" data-arg="' + esc(priveesPossibles[0]["id"]) + '">' +
        esc(t(sorte === "Atelier" ? "form.demanderAtelier" : sorte === "Mixte" ? "form.demanderPrive" : "form.demanderVisite")) + '</button></div>' : '') +
    (h.instagram ? '<p class="espace-texte"><a href="https://www.instagram.com/' + esc(String(h.instagram).replace(/^@/, "").replace(/[^\w.]/g, "")) + '/" target="_blank" rel="noopener">Instagram ' + esc(h.instagram) + '</a></p>' : '');
  const v = $("#hote-video");
  if (v) v.addEventListener("click", () => ouvrirVideo(h.video_url, h.sous_titres_url, h.nom));
}

/** Vidéo plein écran, verticale (canvas E6.1.1) : fermer en haut à droite, sous-titres s'il y en a. */
function ouvrirVideo(url, sousTitres, nom) {
  const fond = document.createElement("div");
  fond.className = "video-plein"; fond.setAttribute("role", "dialog"); fond.setAttribute("aria-label", nom);
  fond.innerHTML = '<video src="' + esc(url) + '" controls autoplay playsinline>' +
      (sousTitres ? '<track kind="subtitles" src="' + esc(sousTitres) + '" srclang="fr" label="Français" default>' : '') + '</video>' +
    '<button type="button" class="video-fermer" aria-label="' + esc(t("hote.fermer")) + '">✕</button>';
  document.body.appendChild(fond);
  const fermer = () => { const x = fond.querySelector("video"); if (x) x.pause(); fond.remove(); document.removeEventListener("keydown", touche); };
  const touche = (e) => { if (e.key === "Escape") fermer(); };
  fond.querySelector(".video-fermer").addEventListener("click", fermer);
  document.addEventListener("keydown", touche);
  fond.querySelector(".video-fermer").focus();
}
