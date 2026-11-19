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
  try { visites = (await loadVisites()).filter((v) => ["visite", "atelier"].includes(offreTypeOf(v))); } catch (e) { visites = []; }
  const choisie = visites.find((v) => v["id"] === arg);
  let type = choisie ? offreTypeOf(choisie) : "visite";
  const options = () => [["", t("form.pasDePreference")]].concat(visites.filter((v) => offreTypeOf(v) === type)
    .map((v) => [v["id"], trField(v, "Nom") + (v["Guide"] ? ", " + t("card.with").toLowerCase() + " " + v["Guide"] : "")]));
  corps.innerHTML =
    '<h1 class="espace-titre">' + esc(t("form.priveTitre")) + ' <em>' + esc(t("form.priveTitreFin")) + '</em></h1>' +
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
  remplir();
  formBrancherChips("f-type", (v) => { type = v; remplir(); });
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
function renderRejoindre() {
  FORM.ouvert = Date.now();
  $("#demande-titre").textContent = t("form.rejoindreTitreEcran");
  $("#demande-sous").textContent = t("espace.sous");
  $("#demande-body").innerHTML =
    '<h1 class="espace-titre">' + esc(t("form.rejoindreTitre")) + ' <em>' + esc(t("form.rejoindreTitreFin")) + '</em></h1>' +
    '<p class="espace-texte">' + esc(t("form.rejoindreTexte")) + '</p>' +
    '<form id="form-rejoindre" class="adm-form" novalidate>' + formPiege +
      '<div class="adm-champ"><span>' + esc(t("form.vousEtes")) + '</span>' +
        formChips("r-type", ["guide", "artiste", "lieu", "autre"].map((k) => [k, t("adm.typeInt." + k)]), "guide") + '</div>' +
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
