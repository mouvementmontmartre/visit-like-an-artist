/* ============================================================
   PARCOURS AUTOGUIDÉS (partie 3) : fiche (canvas E2.1), achat (E8.5),
   confirmation (E9.5), circuit, étape ouverte (E2.1.2) ou fermée (E2.1.3).
   Écran #screen-parcours. Le serveur (fonction « parcours ») ne donne le
   contenu d'une étape qu'à un accès payé, et seulement sur place (rayon
   de l'étape) ou avec le code affiché sur le lieu. Le lien personnel
   (#parcours=<jeton>) est gardé sur le téléphone, par parcours.
   Chargé après app.js.
   ============================================================ */

const PARC = { jeton: null, data: null, achat: null };
const CLE_ACCES = "parcoursAcces";

function accesGardes() { try { return JSON.parse(localStorage.getItem(CLE_ACCES) || "{}"); } catch (e) { return {}; } }
function garderAcces(slug, jeton) { try { const a = accesGardes(); a[slug] = jeton; localStorage.setItem(CLE_ACCES, JSON.stringify(a)); } catch (e) { /* rien */ } }
const appelParcours = (corps) => fetch("/.netlify/functions/parcours", { method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify(corps) }).then(async (r) => ({ ok: r.ok, status: r.status, d: await r.json().catch(() => ({})) }));
const eurosP = (c) => new Intl.NumberFormat(localeResa(), { style: "currency", currency: "EUR", minimumFractionDigits: c % 100 ? 2 : 0 }).format(c / 100);
const txtP = (champ) => parLangue(champ) || "";

/* ---------- Fiche du parcours (E2.1) ---------- */

function choixPrix(e) {
  const min = e.prix_libre_min_centimes || 500;
  return [min, min + 300, min + 500];
}
function prixParcoursHtml(e, etat) {
  const choix = choixPrix(e), autre = !choix.includes(etat.montant);
  return '<div class="mini-label">' + esc(t("parc.choisirPrix")) + '</div>' +
    '<div class="parc-prix" role="radiogroup">' + choix.map((c) =>
      '<button type="button" class="parc-chip' + (c === etat.montant ? " active" : "") + '" data-prix="' + c + '" role="radio" aria-checked="' + (c === etat.montant) + '">' + esc(eurosP(c)) + '</button>').join("") +
      '<button type="button" class="parc-chip' + (autre ? " active" : "") + '" data-prix="autre">' + esc(t("parc.autre")) + '</button></div>' +
    (autre ? '<input class="input-field" id="parc-autre" inputmode="decimal" value="' + esc(String(etat.montant / 100)) + '" aria-label="' + esc(t("parc.montantLibre")) + '">' : '') +
    '<p class="member-note">' + esc(tx("parc.prixAide", { m: eurosP(e.prix_libre_min_centimes || 500) })) + '</p>' +
    (e.option_audioguide_centimes != null
      ? '<label class="parc-option"><input type="checkbox" id="parc-audio"' + (etat.audio ? " checked" : "") + '><span class="parc-option-corps"><b>' + esc(t("parc.audioguide")) + '</b>' +
        '<span>' + esc(t("parc.audioguideTexte")) + '</span></span><span class="parc-option-prix">+ ' + esc(eurosP(e.option_audioguide_centimes)) + '</span></label>' : '');
}
const totalP = (e, etat) => etat.montant + (etat.audio && e.option_audioguide_centimes ? e.option_audioguide_centimes : 0);
function brancherPrix(zone, e, etat, repeindre) {
  zone.querySelectorAll("[data-prix]").forEach((b) => b.addEventListener("click", () => {
    etat.montant = b.dataset.prix === "autre" ? (e.prix_libre_min_centimes || 500) + 700 : Number(b.dataset.prix);   // « Autre » propose 12 €, modifiable
    repeindre();
  }));
  const a = zone.querySelector("#parc-autre");
  if (a) a.addEventListener("change", () => { const c = Math.round(parseFloat(String(a.value).replace(",", ".")) * 100); if (isFinite(c) && c > 0) { etat.montant = c; repeindre(); } });
  const au = zone.querySelector("#parc-audio");
  if (au) au.addEventListener("change", () => { etat.audio = au.checked; repeindre(); });
}

/** Dans la fiche d'un parcours venu de Supabase : prix libre, option, aperçu, bouton. */
async function renderParcoursFiche(v) {
  const zone = $("#parcours-fiche");
  if (!zone) return;
  const e = v._exp, jeton = accesGardes()[v["id"]];
  const etat = PARC.achat && PARC.achat.slug === v["id"] ? PARC.achat : { slug: v["id"], exp: e, titre: trField(v, "Nom"), montant: choixPrix(e)[0], audio: false };
  PARC.achat = etat;
  let apercu = [];
  try { apercu = await supa("etapes?select=ordre,type,nom,resume&apercu=eq.true&experience_id=eq." + e.id + "&order=ordre.asc"); } catch (err) { apercu = []; }
  const peindre = () => {
    zone.innerHTML = (jeton
      ? '<button type="button" class="cta fee" data-open="parcours" data-arg="' + esc(v["id"]) + '">' + esc(t("parc.ouvrir")) + '</button>'
      : prixParcoursHtml(e, etat) +
        '<div class="parc-total"><span>' + esc(e.option_audioguide_centimes != null && etat.audio ? tx("parc.detail", { c: eurosP(etat.montant), a: eurosP(e.option_audioguide_centimes) }) : t("parc.total")) + '</span><b>' + esc(eurosP(totalP(e, etat))) + '</b></div>') +
      (apercu.length || e.nb_etapes ? '<div class="mini-label">' + esc(t("parc.apercu")) + ' · ' + esc(tx("parc.nEtapes", { n: e.nb_etapes || apercu.length })) + '</div>' +
        '<div class="adm-liste">' + apercu.map((x) => '<div class="adm-ligne"><span class="parc-num">' + esc(String(x.ordre)) + '</span><span class="adm-ligne-corps">' +
          '<span class="adm-ligne-titre">' + esc(txtP(x.nom)) + '</span>' + (txtP(x.resume) ? '<span class="adm-ligne-meta">' + esc(txtP(x.resume)) + '</span>' : '') + '</span></div>').join("") +
          (e.nb_etapes > apercu.length ? '<div class="member-note">' + esc(tx("parc.autres", { n: e.nb_etapes - apercu.length })) + '</div>' : '') + '</div>' : '') +
      (jeton ? '' : '<button type="button" class="cta fee" id="parc-debloquer">' + esc(tx("parc.debloquer", { m: eurosP(totalP(e, etat)) })) + '</button>') +
      (jeton ? '' : '<button type="button" class="lien-bouton" id="parc-lien-perdu">' + esc(t("parc.dejaAchete")) + '</button>');
    brancherPrix(zone, e, etat, peindre);
    const b = $("#parc-debloquer");
    if (b) b.addEventListener("click", () => { if (totalP(e, etat) < (e.prix_libre_min_centimes || 500)) return; showScreen("parcours"); peindreAchat(); });
    const l = $("#parc-lien-perdu");
    if (l) l.addEventListener("click", () => { showScreen("parcours"); peindreLienPerdu(); });
  };
  peindre();
}

/* ---------- Achat (E8.5) ---------- */

function peindreAchat() {
  const etat = PARC.achat, e = etat.exp;
  $("#parcours-titre").textContent = t("parc.debloquerTitre");
  $("#parcours-sous").textContent = t("parc.etape1");
  const corps = $("#parcours-body");
  const peindre = () => {
    const total = totalP(e, etat), mail = (($("#parc-email") || {}).value) || etat.email || "";
    corps.innerHTML =
      '<div class="resa-resume"><b>' + esc(etat.titre) + '</b><span>' + esc(tx("parc.nEtapesSansDate", { n: e.nb_etapes || "" })) + '</span><span>' + esc(t("parc.accesImmediat")) + '</span></div>' +
      prixParcoursHtml(e, etat) +
      '<label class="adm-champ"><span>' + esc(t("parc.email")) + '</span><input class="input-field" id="parc-email" type="email" inputmode="email" autocomplete="email" value="' + esc(mail) + '"></label>' +
      '<div class="resa-prix"><div class="resa-ligne"><span>' + esc(t("parc.circuitPrixLibre")) + '</span><b>' + esc(eurosP(etat.montant)) + '</b></div>' +
        (etat.audio && e.option_audioguide_centimes != null ? '<div class="resa-ligne"><span>' + esc(t("parc.audioguide")) + '</span><b>' + esc(eurosP(e.option_audioguide_centimes)) + '</b></div>' : '') +
        '<div class="resa-total"><span>' + esc(t("parc.total")) + '</span><b>' + esc(eurosP(total)) + '</b></div><div class="member-note">' + esc(t("resa.vat")) + '</div></div>' +
      [["cgv", t("parc.c.cgv") + ' <a href="cgv.html" target="_blank" rel="noopener">' + esc(t("resa.cgvFull")) + '</a>'], ["acces_immediat", esc(t("parc.c.immediat"))], ["renonciation", esc(t("parc.c.renonciation"))]]
        .map((c) => '<label class="resa-case"><input type="checkbox" id="parc-c-' + c[0] + '"' + (etat["c_" + c[0]] ? " checked" : "") + '><span>' + c[1] + '</span></label>').join("") +
      '<button type="button" class="cta" id="parc-payer">' + esc(tx("parc.payer", { m: eurosP(total) })) + '</button>' +
      '<div class="resa-erreur" id="parc-note" role="alert"></div>' +
      '<div class="member-note" style="text-align:center">' + esc(t("parc.securise")) + '</div>';
    brancherPrix(corps, e, etat, () => { etat.email = $("#parc-email").value; peindre(); });
    ["cgv", "acces_immediat", "renonciation"].forEach((k) => $("#parc-c-" + k).addEventListener("change", (ev) => { etat["c_" + k] = ev.target.checked; }));
    $("#parc-payer").addEventListener("click", async () => {
      const note = $("#parc-note"), email = $("#parc-email").value.trim().toLowerCase(), b = $("#parc-payer");
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { note.textContent = t("member.emailInvalid"); return; }
      if (etat.montant < (e.prix_libre_min_centimes || 500)) { note.textContent = tx("parc.prixAide", { m: eurosP(e.prix_libre_min_centimes || 500) }); return; }
      if (!["cgv", "acces_immediat", "renonciation"].every((k) => $("#parc-c-" + k).checked)) { note.textContent = t("parc.cases"); return; }
      b.disabled = true; note.textContent = t("member.loading");
      const { ok, d } = await appelParcours({ action: "acheter", slug: etat.slug, montant_centimes: etat.montant, audioguide: etat.audio, email,
        langue: ["fr", "en", "es"].includes(getLang()) ? getLang() : "fr", cases: { cgv: true, acces_immediat: true, renonciation: true } }).catch(() => ({ ok: false, d: {} }));
      if (ok && d.url) { window.location.href = d.url; return; }
      note.textContent = d.error === "MONTANT_TROP_BAS" ? tx("parc.prixAide", { m: eurosP(e.prix_libre_min_centimes || 500) }) : t("form.erreur");
      b.disabled = false;
    });
  };
  peindre();
}

function peindreLienPerdu() {
  $("#parcours-titre").textContent = t("parc.lienTitre");
  $("#parcours-sous").textContent = "";
  $("#parcours-body").innerHTML = '<p class="espace-texte">' + esc(t("parc.lienTexte")) + '</p>' +
    '<label class="adm-champ"><span>' + esc(t("parc.email")) + '</span><input class="input-field" id="parc-lien-email" type="email" inputmode="email" autocomplete="email"></label>' +
    '<button type="button" class="cta fee" id="parc-lien-envoyer">' + esc(t("parc.lienBouton")) + '</button><div class="member-note" id="parc-lien-note" role="status"></div>';
  $("#parc-lien-envoyer").addEventListener("click", async () => {
    const email = $("#parc-lien-email").value.trim().toLowerCase(), note = $("#parc-lien-note");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { note.textContent = t("member.emailInvalid"); return; }
    note.textContent = t("member.loading");
    await appelParcours({ action: "lien", email }).catch(() => {});
    note.textContent = t("parc.lienEnvoye");
  });
}

/* ---------- Retour du paiement et lien personnel ---------- */

async function handleParcoursRetour() {
  const q = new URLSearchParams(window.location.search);
  const session = q.get("parcours"), abandon = q.has("parcours_abandonne");
  const m = (window.location.hash || "").match(/^#parcours=([0-9a-f]{64})$/);
  if (!session && !abandon && !m) return false;
  history.replaceState(null, "", window.location.pathname);   // le jeton ne reste pas dans l'adresse
  showScreen("parcours");
  $("#parcours-titre").textContent = t("parc.titreEcran");
  const corps = $("#parcours-body");
  if (abandon) { corps.innerHTML = '<div class="member-note">' + esc(t("parc.abandon")) + '</div><button type="button" class="cta ghost" data-back>' + esc(t("resa.back")) + '</button>'; return true; }
  corps.innerHTML = '<div class="loading">' + esc(t("member.loading")) + '</div>';
  if (m) { await ouvrirCircuit(m[1]); return true; }
  const { ok, d } = await appelParcours({ action: "session", session_id: session }).catch(() => ({ ok: false, d: {} }));
  if (!ok || !d.jeton) { corps.innerHTML = '<div class="member-note">' + esc(t("parc.attente")) + '</div><button type="button" class="cta ghost" data-back>' + esc(t("resa.back")) + '</button>'; return true; }
  const v = await appelParcours({ action: "voir", jeton: d.jeton }).catch(() => ({ ok: false, d: {} }));
  if (v.ok) { garderAcces(v.d.parcours.slug, d.jeton); PARC.jeton = d.jeton; PARC.data = v.d; }
  const p = v.ok ? v.d.parcours : {};
  corps.innerHTML =
    '<div class="resa-ok"><span aria-hidden="true">✓</span></div>' +
    '<h1 class="espace-titre">' + esc(t("parc.debloqueTitre")) + ' <em>' + esc(t("parc.debloqueFin")) + '</em></h1>' +
    '<p class="espace-texte">' + esc(tx("parc.debloqueTexte", { n: p.nb_etapes || "", email: d.email || "" })) + '</p>' +
    '<div class="resa-carte"><b class="resa-titre">' + esc(txtP(p.titre)) + '</b>' +
      '<div class="info-row"><span class="k">' + esc(t("parc.etapes")) + '</span><span class="v">' + esc(String(p.nb_etapes || "")) + '</span></div>' +
      '<div class="info-row"><span class="k">' + esc(t("parc.audioguide")) + '</span><span class="v">' + esc(d.audioguide ? t("parc.inclus") : t("parc.nonInclus")) + '</span></div>' +
      '<div class="info-row"><span class="k">' + esc(t("parc.acces")) + '</span><span class="v">' + esc(t("parc.immediatSansDate")) + '</span></div>' +
      '<div class="info-row"><span class="k">' + esc(t("resa.paid")) + '</span><span class="v">' + esc(eurosP(d.montant_centimes || 0)) + '</span></div>' +
      '<div class="member-note">' + esc(t("resa.ref")) + ' : ' + esc(d.reference || "") + '</div></div>' +
    '<button type="button" class="cta fee" id="parc-ouvrir">' + esc(t("parc.ouvrir")) + '</button>' +
    '<button type="button" class="cta ghost" data-back>' + esc(t("resa.back")) + '</button>';
  $("#parc-ouvrir").addEventListener("click", () => peindreCircuit());
  return true;
}

/* ---------- Le circuit ---------- */

async function ouvrirCircuit(jeton) {
  const corps = $("#parcours-body");
  corps.innerHTML = '<div class="loading">' + esc(t("member.loading")) + '</div>';
  const { ok, d } = await appelParcours({ action: "voir", jeton }).catch(() => ({ ok: false, d: {} }));
  if (!ok) { corps.innerHTML = '<div class="member-note">' + esc(d.error === "EXPIRE" ? t("parc.expire") : t("parc.lienInvalide")) + '</div>'; return; }
  PARC.jeton = jeton; PARC.data = d;
  garderAcces(d.parcours.slug, jeton);
  peindreCircuit();
}

function peindreCircuit() {
  const d = PARC.data, p = d.parcours, corps = $("#parcours-body");
  const ouvertes = d.etapes.filter((x) => x.ouverte).length;
  $("#parcours-titre").textContent = txtP(p.titre);
  $("#parcours-sous").textContent = tx("parc.progression", { n: ouvertes, total: d.etapes.length });
  window.scrollTo(0, 0);
  corps.innerHTML = '<div class="map-wrap" id="parcours-carte"></div>' +
    '<p class="member-note">' + esc(t("parc.aideCircuit")) + '</p>' +
    '<div class="adm-liste">' + d.etapes.map((x) =>
      '<button type="button" class="adm-ligne" data-parc-etape="' + esc(x.id) + '"><span class="parc-num' + (x.ouverte ? " ouverte" : "") + '">' + esc(String(x.ordre)) + '</span>' +
        '<span class="adm-ligne-corps"><span class="adm-ligne-titre">' + esc(txtP(x.nom)) + '</span>' +
        '<span class="adm-ligne-meta">' + esc(x.ouverte ? t("parc.ouverte") : t("parc.fermee")) + '</span></span></button>').join("") + '</div>' +
    '<button type="button" class="cta ghost" data-back>' + esc(t("resa.back")) + '</button>';
  $$("[data-parc-etape]").forEach((b) => b.addEventListener("click", () => peindreEtape(b.dataset.parcEtape)));
  const points = d.etapes.filter((x) => x.lat != null).map((x) => ({ nom: txtP(x.nom), lat: x.lat, lng: x.lng, num: x.ordre, onTap: () => peindreEtape(x.id) }));
  if (points.length && typeof renderMap === "function") renderMap($("#parcours-carte"), points, txtP(p.titre));
  else $("#parcours-carte").remove();
}

/* ---------- Une étape (E2.1.2 ouverte, E2.1.3 fermée) ---------- */

function peindreEtape(id) {
  const d = PARC.data, i = d.etapes.findIndex((x) => x.id === id), x = d.etapes[i], corps = $("#parcours-body");
  if (!x) return;
  $("#parcours-sous").textContent = tx("parc.etapeSur", { n: x.ordre, total: d.etapes.length });
  window.scrollTo(0, 0);
  const nav = '<div class="parc-nav">' +
    (i > 0 ? '<button type="button" class="cta ghost" data-parc-aller="' + esc(d.etapes[i - 1].id) + '">' + esc(t("parc.precedente")) + '</button>' : '') +
    (i < d.etapes.length - 1 ? '<button type="button" class="cta ghost" data-parc-aller="' + esc(d.etapes[i + 1].id) + '">' + esc(t("parc.suivante")) + '</button>' : '') +
    '</div><button type="button" class="lien-bouton" id="parc-toutes">' + esc(t("parc.toutes")) + '</button>';
  const itineraire = x.lat != null ? '<a class="cta ghost" style="text-decoration:none" target="_blank" rel="noopener" href="https://www.google.com/maps/dir/?api=1&travelmode=walking&destination=' + x.lat + ',' + x.lng + '">' + esc(t("parc.itineraire")) + '</a>' : '';
  if (x.ouverte) {
    const audio = txtP(x.audio);
    corps.innerHTML =
      (x.media_url ? '<figure class="parc-media"><img src="' + esc(x.media_url) + '" alt="">' + (x.media_credit ? '<figcaption>' + esc(x.media_credit) + '</figcaption>' : '') + '</figure>' : '') +
      '<div class="mini-label">' + esc(tx("parc.etapeN", { n: x.ordre })) + '</div>' +
      '<h1 class="espace-titre">' + esc(txtP(x.nom)) + '</h1>' +
      (txtP(x.texte) ? '<p class="espace-texte parc-texte">' + esc(txtP(x.texte)) + '</p>' : '') +
      (audio ? '<div class="mini-label">' + esc(t("parc.ecouter")) + '</div><audio class="parc-audio" controls preload="none" src="' + esc(audio) + '"></audio>' : '') +
      (txtP(x.a_reperer) ? '<div class="adm-encart"><b>' + esc(t("parc.aReperer")) + '</b><p class="member-note">' + esc(txtP(x.a_reperer)) + '</p></div>' : '') +
      itineraire + nav;
  } else {
    corps.innerHTML =
      '<div class="mini-label">' + esc(tx("parc.etapeN", { n: x.ordre })) + '</div>' +
      '<h1 class="espace-titre">' + esc(txtP(x.nom)) + '</h1>' +
      '<div class="parc-verrou"><b>' + esc(t("parc.verrouTitre")) + '</b><p>' + esc(tx("parc.verrouTexte", { m: x.rayon_m || 30 })) + '</p>' +
        '<div class="parc-distance" id="parc-distance" role="status"></div></div>' +
      '<button type="button" class="cta fee" id="parc-surplace">' + esc(t("parc.surPlace")) + '</button>' +
      itineraire +
      (x.code ? '<p class="member-note">' + esc(t("parc.codeAide")) + '</p><div class="parc-code"><input class="input-field" id="parc-code" autocomplete="off" autocapitalize="characters" aria-label="' + esc(t("parc.code")) + '" placeholder="' + esc(t("parc.code")) + '">' +
        '<button type="button" class="cta ghost" id="parc-code-ok">' + esc(t("parc.valider")) + '</button></div>' : '') +
      '<div class="resa-erreur" id="parc-etape-note" role="alert"></div>' + nav;
    const ouvrir = async (corpsReq) => {
      const note = $("#parc-etape-note");
      note.textContent = t("member.loading");
      const r = await appelParcours(Object.assign({ action: "etape", jeton: PARC.jeton, etape_id: x.id }, corpsReq)).catch(() => ({ ok: false, d: {} }));
      if (r.ok && r.d.etape) { Object.assign(x, r.d.etape, { ouverte: true }); peindreEtape(x.id); return; }
      note.textContent = r.d.error === "TROP_LOIN" ? tx("parc.tropLoin", { m: r.d.distance_m }) : r.d.error === "CODE" ? t("parc.mauvaisCode") : t("form.erreur");
      if (r.d.error === "TROP_LOIN") $("#parc-distance").textContent = tx("parc.distance", { m: r.d.distance_m, min: Math.max(1, Math.round(r.d.distance_m / 80)) });
    };
    $("#parc-surplace").addEventListener("click", () => {
      const note = $("#parc-etape-note");
      if (!navigator.geolocation) { note.textContent = t("parc.pasDeGeoloc"); return; }
      note.textContent = t("parc.localisation");
      navigator.geolocation.getCurrentPosition((pos) => ouvrir({ lat: pos.coords.latitude, lng: pos.coords.longitude, precision: pos.coords.accuracy }),
        () => { note.textContent = t("parc.pasDeGeoloc"); }, { enableHighAccuracy: true, timeout: 15000, maximumAge: 10000 });
    });
    const c = $("#parc-code-ok");
    if (c) c.addEventListener("click", () => { const v = $("#parc-code").value.trim(); if (v) ouvrir({ code: v }); });
  }
  $$("[data-parc-aller]").forEach((b) => b.addEventListener("click", () => peindreEtape(b.dataset.parcAller)));
  $("#parc-toutes").addEventListener("click", () => peindreCircuit());
}

/** Ouverture depuis la fiche (« Ouvrir le circuit ») avec le lien gardé sur ce téléphone. */
function renderParcours(slug) {
  $("#parcours-titre").textContent = t("parc.titreEcran");
  $("#parcours-sous").textContent = "";
  const jeton = accesGardes()[slug];
  if (jeton) ouvrirCircuit(jeton); else peindreLienPerdu();
}
