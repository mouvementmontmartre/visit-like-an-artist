/* Écrans de réservation dans Chromium (Playwright), sans réseau :
   la Sheet des visites, Supabase et les fonctions Netlify sont simulés.
   node tests/reservation-ecran.test.js <chemin du dépôt> <dossier des captures> */
const { chromium } = require("playwright");
const http = require("http"), fs = require("fs"), path = require("path");
const RACINE = process.argv[2], OUT = process.argv[3];
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".jpg": "image/jpeg", ".json": "application/json" };
const srv = http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, "http://x").pathname); if (p === "/") p = "/index.html";
  const f = path.join(RACINE, p);
  if (!f.startsWith(RACINE) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { "Content-Type": types[path.extname(f)] || "application/octet-stream" }); fs.createReadStream(f).pipe(res);
}).listen(8767);

const CSV = "id,Nom,Type,Actif,Guide,Tarif direct,Durée,Lien réservation,Description\n" +
  "circuit-test,Circuit des Peintres,Visite,Oui,Sylvain Lesecq,50€,2 h,https://ancien-lien.example/,Dans les pas de Lautrec\n" +
  "soiree-test,Soirée jazz,Soirée,Oui,,25€,3 h,,Concert\n";
const futur = (h) => new Date(Date.now() + h * 3600e3).toISOString();
const EXP = {
  "circuit-test": { id: "11111111-1111-1111-1111-111111111111", type: "visite_guidee", titre: { fr: "Circuit des Peintres", en: "Painters walk" },
    prix_centimes: 5000, prereservation_centimes: 500, frais_annulation_tardive_centimes: 1000, telephone_obligatoire: true },
  "soiree-test": { id: "22222222-2222-2222-2222-222222222222", type: "soiree", titre: { fr: "Soirée jazz" },
    prix_centimes: 2500, prereservation_centimes: null, frais_annulation_tardive_centimes: 1000, telephone_obligatoire: false, age_minimum: 18 },
};
const SEANCES = {
  "11111111-1111-1111-1111-111111111111": [
    { id: "aaaaaaaa-0000-0000-0000-000000000001", debut: futur(100), langue: "fr", capacite_max: 10, participants_min: 4, inscrits: 5, places_restantes: 5, confirmee: true, point_rdv: "Square Suzanne Buisson" },
    { id: "aaaaaaaa-0000-0000-0000-000000000002", debut: futur(260), langue: "en", capacite_max: 10, participants_min: 4, inscrits: 2, places_restantes: 8, confirmee: false, point_rdv: "Square Suzanne Buisson" },
    { id: "aaaaaaaa-0000-0000-0000-000000000003", debut: futur(400), langue: "fr", capacite_max: 10, participants_min: 4, inscrits: 10, places_restantes: 0, confirmee: true, point_rdv: "Square" },
  ],
  "22222222-2222-2222-2222-222222222222": [
    { id: "bbbbbbbb-0000-0000-0000-000000000001", debut: futur(80), langue: "fr", capacite_max: 40, participants_min: 1, inscrits: 28, places_restantes: 12, confirmee: true, point_rdv: "Le cabaret" },
  ],
};
const JETON = "ab".repeat(32);
const RESA = (o) => Object.assign({ reference: "AD-2K7F9Q", personnes: 2, paye_en_ligne_centimes: 1000, reste_sur_place_centimes: 9000,
  type: "visite_guidee", titre: { fr: "Circuit des Peintres" }, debut: futur(20), intervenant: "Sylvain Lesecq",
  point_rdv: "Square", point_rdv_precis: "Devant le kiosque", message_inscrits: "Je porte un chapeau gris",
  statut: "confirmee", seance_statut: "publiee", peut_annuler: true, annulation_tardive: true,
  frais_si_annulation_centimes: 2000, frais_centimes: 0 }, o);

let ok = 0, ko = 0;
const v = (n, c, d) => { if (c) { ok++; console.log("OK     " + n); } else { ko++; console.log("ÉCHEC  " + n + (d ? "  → " + String(d).slice(0, 300) : "")); } };

(async () => {
  const b = await chromium.launch();
  async function page(opts = {}) {
    const ctx = await b.newContext({ serviceWorkers: "block", viewport: { width: 390, height: 844 } });
    const pg = await ctx.newPage();
    const st = { erreurs: [], appels: [] };
    pg.on("pageerror", (e) => st.erreurs.push(e.message));
    if (opts.lang) await pg.addInitScript((l) => localStorage.setItem("lang", l), opts.lang);
    await pg.route("**/*", (r) => {
      const u = new URL(r.request().url());
      if (u.hostname === "docs.google.com" && u.searchParams.get("gid") === "0") return r.fulfill({ status: 200, contentType: "text/csv", body: CSV });
      if (u.hostname.endsWith(".supabase.co")) {
        if (u.pathname.endsWith("/experiences")) { const slug = (u.searchParams.get("slug") || "").replace("eq.", ""); return r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(EXP[slug] ? [EXP[slug]] : []) }); }
        if (u.pathname.endsWith("/seances_publiques")) { const id = (u.searchParams.get("experience_id") || "").replace("eq.", ""); return r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(SEANCES[id] || []) }); }
      }
      if (u.hostname === "localhost" && u.pathname.startsWith("/.netlify/functions/")) {
        const corps = JSON.parse(r.request().postData() || "{}"); st.appels.push({ f: u.pathname.split("/").pop(), corps });
        const rep = (opts.fonctions || (() => [404, {}]))(u.pathname.split("/").pop(), corps);
        return r.fulfill({ status: rep[0], contentType: "application/json", body: JSON.stringify(rep[1]) });
      }
      if (u.hostname === "checkout.stripe.test") return r.fulfill({ status: 200, contentType: "text/html", body: "<h1>Stripe</h1>" });
      if (u.hostname === "localhost") return r.continue();
      return r.abort();
    });
    return { pg, ctx, st };
  }
  const attendre = (pg, sel, txt) => pg.waitForFunction(([s, t]) => { const e = document.querySelector(s); return e && e.textContent.includes(t); }, [sel, txt], { timeout: 8000 }).then(() => true, () => false);
  const ouvrir = async (pg, id) => { await pg.goto("http://localhost:8767/"); await pg.waitForTimeout(2600); await pg.evaluate((x) => openTarget("visite", x), id); };

  // 1. Fiche (E2.2) : dates, choix, personnes, prix net, « Réservez votre place pour 5 € » (l'adhésion)
  let { pg, ctx, st } = await page({ fonctions: (f, c) => f === "reserver" ? [200, { url: "https://checkout.stripe.test/cs_test_1", reservation_id: "cccccccc-0000-0000-0000-000000000001", bloque_jusqua: futur(0.25) }] : [404, {}] });
  await ouvrir(pg, "circuit-test");
  v("fiche : les dates s'affichent", await attendre(pg, "#visite-seances", "Choisissez une date"));
  v("fiche : séance confirmée avec places restantes", await attendre(pg, "#visite-seances", "Confirmée · 5 places restantes sur 10"));
  v("fiche : séance pas encore confirmée, barre du minimum", await attendre(pg, "#visite-seances", "2 inscrits, 4 minimum pour partir") && (await pg.$(".seance-barre")) !== null);
  v("fiche : séance complète non cliquable", await pg.$eval('[data-seance="aaaaaaaa-0000-0000-0000-000000000003"]', (b) => b.disabled));
  v("fiche : l'ancien lien externe a disparu", (await pg.$(".cta-externe")) === null);
  v("fiche : « Réservez votre place pour 5 € », c'est l'adhésion, « Déjà adhérent : 0 € »", await attendre(pg, "#visite-seances", "Réservez votre place pour 5") &&
    await attendre(pg, "#visite-seances", "C'est votre adhésion") && await attendre(pg, "#visite-seances", "Déjà adhérent : 0"));
  await pg.click("#fiche-plus");
  v("fiche : 2 personnes → 2 × 45 € = 90 € réglés à Sylvain (prix net, 5 € de l'adhésion retirés)", await attendre(pg, "#visite-seances", "2 × 45") && await attendre(pg, "#visite-seances", "90") &&
    await attendre(pg, "#visite-seances", "se règlent à Sylvain Lesecq sur place") && await attendre(pg, "#btn-reserver", "Réserver · 5"));
  v("fiche : pas de badge, bon à savoir (adhésion non remboursable)", (await pg.$(".badge-adherent")) === null && await attendre(pg, "#visite-seances", "n'est pas remboursable"));
  await pg.click('[data-seance="aaaaaaaa-0000-0000-0000-000000000002"]');
  v("fiche : choisir une autre date", await pg.$eval('[data-seance="aaaaaaaa-0000-0000-0000-000000000002"]', (b) => b.classList.contains("choisie")));
  await pg.$eval("#visite-seances", (e) => e.scrollIntoView());
  await pg.screenshot({ path: OUT + "/resa-fiche.png" });

  // 2. E8.0 : adhésion (5 € par an, une phrase, une case), la place est retenue pendant le paiement
  await pg.click("#btn-reserver");
  v("E8.0 : 5 € par an, la phrase de l'adhésion, « Déjà adhérent ? Me connecter »", await attendre(pg, "#reserver-body", "par an") &&
    await attendre(pg, "#reserver-body", "Ces 5 € sont votre adhésion à l'association Mouvement Montmartre, valable 12 mois.") && (await pg.$("#adh-connecter")) !== null);
  v("E8.0 : une seule case (statuts, règlement, confidentialité), non cochée", (await pg.$$eval("#reserver-body input[type=checkbox]", (l) => l.length + ":" + l.filter((c) => c.checked).length)) === "1:0" &&
    await attendre(pg, "#reserver-body", "statuts") && await attendre(pg, "#reserver-body", "politique de confidentialité"));
  v("E8.0 : « Payer 5 € maintenant », renouvelée chaque année, résiliable", await attendre(pg, "#adh-payer", "Payer 5") && await attendre(pg, "#reserver-body", "résiliable à tout moment"));
  await pg.fill("#resa-nom", "Camille Durand"); await pg.fill("#resa-email", "Camille@Exemple.invalid"); await pg.fill("#resa-tel", "0612345678");
  await pg.click("#adh-payer");
  v("E8.0 : sans la case, refus", await attendre(pg, "#resa-note", "Cochez les conditions"));
  await pg.check("#adh-c-statuts");
  await pg.screenshot({ path: OUT + "/resa-adhesion.png", fullPage: true });
  await pg.click("#adh-payer");
  await pg.waitForURL("https://checkout.stripe.test/**", { timeout: 8000 }).catch(() => {});
  const envoiAdh = st.appels.find((a) => a.f === "reserver" && a.corps.action === "adhesion");
  v("E8.0 : place retenue et paiement de l'adhésion", pg.url().startsWith("https://checkout.stripe.test/") && envoiAdh && envoiAdh.corps.accord_adhesion === true &&
    envoiAdh.corps.email === "camille@exemple.invalid" && envoiAdh.corps.personnes === 2, JSON.stringify(envoiAdh));
  v("E8.0 : aucune erreur JavaScript", st.erreurs.length === 0, st.erreurs.join(" | "));
  await ctx.close();

  // 2 bis. Retour du paiement de l'adhésion : la réservation continue (E8.1, 0 € maintenant, case 2)
  ({ pg, ctx, st } = await page({ fonctions: (f, c) => {
    if (f === "carte" && c.action === "session") return [200, { jeton: "J".repeat(43), carte: { nom: "Camille Durand", valide_jusqua: "2027-11-20T00:00:00Z", valide: true, numero: "MM-0042", renouvelable: true }, email: "camille@exemple.invalid" }];
    if (f === "reserver" && c.action === "finaliser") return [200, { confirmee: true, jeton: JETON, reservation: RESA({ paye_en_ligne_centimes: 0, adherent: true }) }];
    if (f === "reserver" && c.action === "adherent") return [200, { adherent: true, carte: true, numero: "MM-0042" }];
    return [404, {}];
  } }));
  await pg.addInitScript((ctxResa) => localStorage.setItem("resaEnCours", JSON.stringify(ctxResa)), {
    reservation_id: "cccccccc-0000-0000-0000-000000000001", bloque_jusqua: futur(0.2), personnes: 2, guide: "Sylvain Lesecq",
    exp: { id: "11111111-1111-1111-1111-111111111111", type: "visite_guidee", titre: { fr: "Circuit des Peintres" }, prix_centimes: 5000, prereservation_centimes: 500, frais_annulation_tardive_centimes: 1000, telephone_obligatoire: true },
    seance: SEANCES["11111111-1111-1111-1111-111111111111"][0], champs: { nom: "Camille Durand", email: "camille@exemple.invalid", tel: "0612345678" } });
  await pg.goto("http://localhost:8767/?adhesion=cs_test_adh&resa=cccccccc-0000-0000-0000-000000000001");
  v("retour d'adhésion : la réservation reprend, créneau retenu", await attendre(pg, "#screen-reserver .back-sub", "retenu") && await attendre(pg, "#reserver-body", "Adhérent reconnu"));
  v("E8.1 : carte n°, tarif adhérent 2 × 45 € = 90 €, pré-réservation offerte, 0 € maintenant", await attendre(pg, "#reserver-body", "MM-0042") && await attendre(pg, "#reserver-body", "90") &&
    await attendre(pg, "#reserver-body", "Pré-réservation offerte") && await attendre(pg, "#reserver-body", "À payer maintenant") && await attendre(pg, "#resa-payer", "Réserver gratuitement"));
  v("E8.1 : une seule case : conditions de réservation (10 € par personne, moins de 24 h)", (await pg.$$eval("#resa-form input[type=checkbox]", (l) => l.length)) === 1 &&
    await attendre(pg, "#resa-form", "10 € par personne seront prélevés en cas d'absence ou d'annulation à moins de 24 h"));
  v("E8.1 : rétractation, âge et photos en texte près du bouton (sans case)", await attendre(pg, "#resa-form", "pas de droit de rétractation") && await attendre(pg, "#resa-form", "Photos facultatives"));
  await pg.screenshot({ path: OUT + "/resa-adherent.png", fullPage: true });
  await pg.click("#resa-payer");
  v("E8.1 : sans la case, refus", await attendre(pg, "#resa-note", "Cochez les conditions"));
  await pg.check("#resa-c-conditions");
  await pg.click("#resa-payer");
  v("E8.1 : réservation confirmée tout de suite (carte de l'adhésion)", await attendre(pg, "#reservation-body", "Votre place est réservée."));
  const fin = st.appels.find((a) => a.f === "reserver" && a.corps.action === "finaliser");
  v("E8.1 : la place retenue est terminée avec la carte (jeton) et la case", fin && fin.corps.reservation_id === "cccccccc-0000-0000-0000-000000000001" && fin.corps.jeton === "J".repeat(43) && fin.corps.consentements.conditions === true, JSON.stringify(fin));
  v("E8.1 : aucune erreur JavaScript", st.erreurs.length === 0, st.erreurs.join(" | "));
  await ctx.close();

  // 2 ter. « Déjà adhérent ? Me connecter » : code reçu par email, personne ne réserve au nom d'un adhérent
  ({ pg, ctx, st } = await page({ fonctions: (f, c) => {
    if (f === "carte" && c.action === "email") return [200, { ok: true }];
    if (f === "carte" && c.action === "code") return c.code === "123456" ? [200, { jeton: "K".repeat(43), carte: { nom: "Ada", valide_jusqua: "2027-06-30T00:00:00Z", valide: true, numero: "MM-0007" }, email: "ada@exemple.invalid" }] : [400, {}];
    if (f === "reserver" && c.action === "adherent") return [200, { adherent: true, carte: false, numero: "MM-0007" }];
    if (f === "reserver" && !c.action) return [200, { url: "https://checkout.stripe.test/cs_test_setup", carte_a_enregistrer: true }];
    return [404, {}];
  } }));
  await ouvrir(pg, "circuit-test"); await attendre(pg, "#visite-seances", "Choisissez");
  await pg.click("#btn-reserver");
  await pg.fill("#resa-email", "ada@exemple.invalid");
  await pg.click("#adh-connecter");
  v("me connecter : formulaire de réservation avec la demande de code", (await pg.$("#resa-code")) !== null && await attendre(pg, "#resa-code", "Personne ne peut réserver à votre nom"));
  await pg.click("#resa-code-envoyer");
  v("me connecter : code envoyé, champ du code", await attendre(pg, "#resa-code-note", "Si cette adresse a une adhésion") && await pg.$eval("#resa-code-saisie", (z) => !z.hidden));
  await pg.fill("#resa-code-valeur", "123456"); await pg.click("#resa-code-valider");
  v("me connecter : adhérent reconnu, email de la carte non modifiable", await attendre(pg, "#reserver-body", "Adhérent reconnu") && await attendre(pg, "#reserver-body", "MM-0007") && await pg.$eval("#resa-email", (i) => i.readOnly));
  v("me connecter : sans carte d'abonnement, « Carte bancaire à enregistrer », aucun débit", await attendre(pg, "#reserver-body", "Carte bancaire à enregistrer"));
  await pg.fill("#resa-nom", "Ada Lovelace"); await pg.fill("#resa-tel", "0612345678");
  await pg.check("#resa-c-conditions");
  await pg.click("#resa-payer");
  await pg.waitForURL("https://checkout.stripe.test/**", { timeout: 8000 }).catch(() => {});
  const envoiR = st.appels.find((a) => a.f === "reserver" && !a.corps.action);
  v("me connecter : réservation envoyée avec le jeton de la carte et la seule case", envoiR && envoiR.corps.jeton === "K".repeat(43) && envoiR.corps.email === "ada@exemple.invalid" &&
    JSON.stringify(envoiR.corps.consentements) === JSON.stringify({ conditions: true }) && pg.url().startsWith("https://checkout.stripe.test/"), JSON.stringify(envoiR));
  v("me connecter : aucune erreur JavaScript", st.erreurs.length === 0, st.erreurs.join(" | "));
  await ctx.close();

  // 3. Carte déjà sur le téléphone : « Réserver · 0 € », retour arrière, adresse d'adhérent sans preuve, « complet »
  let reponse = [409, { code: "COMPLET" }];
  ({ pg, ctx, st } = await page({ fonctions: (f, c) => f === "reserver" && c.action === "adherent" ? [200, { adherent: true, carte: true }] : f === "reserver" ? reponse : [404, {}] }));
  await pg.addInitScript(() => localStorage.setItem("carteMembre", JSON.stringify({ jeton: "L".repeat(43), email: "lou@exemple.invalid", carte: { nom: "Lou", valide_jusqua: "2027-01-01T00:00:00Z", valide: true } })));
  await ouvrir(pg, "circuit-test"); await attendre(pg, "#visite-seances", "Choisissez");
  v("carte sur le téléphone : « Réserver · 0 € maintenant »", await attendre(pg, "#btn-reserver", "Réserver · 0"));
  await pg.click("#btn-reserver");
  v("carte sur le téléphone : formulaire adhérent, email prérempli", await attendre(pg, "#reserver-body", "Adhérent reconnu") && (await pg.$eval("#resa-email", (i) => i.value)) === "lou@exemple.invalid");
  await pg.click("#screen-reserver [data-back]");
  v("retour depuis le formulaire : on revient à la fiche", await pg.$eval("#screen-visite", (e) => e.classList.contains("active")));
  await pg.click("#btn-reserver");
  await pg.fill("#resa-nom", "Lou"); await pg.fill("#resa-tel", "0612345678");
  await pg.check("#resa-c-conditions");
  await pg.click("#resa-payer");
  v("plus de places : message clair", await attendre(pg, "#resa-note", "plus assez de places"));
  reponse = [403, { code: "VERIFICATION_REQUISE" }];
  await pg.click("#resa-payer");
  v("adresse d'adhérent sans preuve : demande de code affichée", (await pg.waitForSelector("#resa-code", { timeout: 4000 }).then(() => true, () => false)));
  await ctx.close();

  // 4. Soirée (E8.3) : prix entier payé en ligne, une seule case (âge compris), téléphone facultatif
  ({ pg, ctx, st } = await page({ fonctions: (f) => f === "reserver" ? [200, { url: "https://checkout.stripe.test/cs_test_2" }] : [404, {}] }));
  await ouvrir(pg, "soiree-test");
  v("soirée : 12 places restantes sur 40, sans « confirmée »", await attendre(pg, "#visite-seances", "12 places restantes sur 40") && !(await pg.$eval("#visite-seances", (e) => e.textContent.includes("Confirmée"))));
  await pg.click("#btn-reserver");
  v("soirée : une seule case (CGV, pas de remboursement, âge 18 ans), téléphone facultatif", (await pg.$$eval("#resa-form input[type=checkbox]", (l) => l.length)) === 1 &&
    await attendre(pg, "#reserver-body", "Téléphone (facultatif)") && await attendre(pg, "#resa-form", "au moins 18 ans") && await attendre(pg, "#resa-form", "Pas de remboursement"));
  v("soirée : « Payer 25 € »", await attendre(pg, "#resa-payer", "Payer 25"));
  await pg.fill("#resa-nom", "Lou"); await pg.fill("#resa-email", "lou@exemple.invalid");
  await pg.check("#resa-c-conditions");
  await pg.click("#resa-payer");
  await pg.waitForURL("https://checkout.stripe.test/**", { timeout: 8000 }).catch(() => {});
  v("soirée : paiement avec la case unique", st.appels.some((a) => a.f === "reserver" && a.corps.consentements.conditions === true));
  await ctx.close();

  // 5. Retour du paiement
  ({ pg, ctx, st } = await page({ fonctions: (f, c) => f === "reservation" && c.action === "session" ? [200, { jeton: JETON, reservation: RESA({}) }] : [404, {}] }));
  await pg.goto("http://localhost:8767/?reservation=cs_test_abc");
  v("retour : « Votre place est réservée. »", await attendre(pg, "#reservation-body", "Votre place est réservée."));
  v("retour : rendez-vous précis, reste sur place, mot du guide", await attendre(pg, "#reservation-body", "Devant le kiosque") && await attendre(pg, "#reservation-body", "90") && await attendre(pg, "#reservation-body", "chapeau gris"));
  v("retour : l'adresse est nettoyée", !pg.url().includes("cs_test"));
  await pg.waitForTimeout(2600);
  await pg.screenshot({ path: OUT + "/resa-confirmation.png", fullPage: true });
  await ctx.close();

  // 6. Lien de l'email : « Je ne peux plus venir » à moins de 24 h
  let annule = false;
  ({ pg, ctx, st } = await page({ fonctions: (f, c) => {
    if (f !== "reservation") return [404, {}];
    if (c.action === "voir") return [200, { reservation: RESA({}) }];
    if (c.action === "annuler") { annule = c.jeton === JETON; return [200, { annulation: { frais_centimes: 2000 }, reservation: RESA({ statut: "annulee", peut_annuler: false, frais_centimes: 2000 }) }]; }
    return [404, {}];
  } }));
  await pg.goto("http://localhost:8767/#reservation=" + JETON);
  v("lien : la réservation s'affiche", await attendre(pg, "#reservation-body", "AD-2K7F9Q"));
  v("lien : le jeton disparaît de l'adresse", !pg.url().includes(JETON));
  await pg.click("#resa-annuler");
  v("annulation tardive : les 20 € de frais sont annoncés avant de confirmer", await attendre(pg, "#resa-annuler-zone", "20") && await attendre(pg, "#resa-annuler-zone", "Moins de 24 h"));
  await pg.click("#resa-annuler-ok");
  v("annulation : confirmée, frais rappelés", annule && await attendre(pg, "#reservation-body", "Annulation enregistrée. 20"));
  v("annulation : plus de bouton « Je ne peux plus venir »", (await pg.$("#resa-annuler")) === null);
  await ctx.close();
  ({ pg, ctx } = await page({ fonctions: () => [404, {}] }));
  await pg.goto("http://localhost:8767/#reservation=" + JETON);
  v("lien inconnu : message clair", await attendre(pg, "#reservation-body", "n'est plus valable"));
  await ctx.close();
  ({ pg, ctx } = await page({ fonctions: (f, c) => [200, { reservation: RESA({ statut: "remboursee", seance_statut: "annulee", peut_annuler: false }) }] }));
  await pg.goto("http://localhost:8767/#reservation=" + JETON);
  v("séance annulée par l'organisation : remboursement annoncé", await attendre(pg, "#reservation-body", "remboursé intégralement"));
  await ctx.close();
  ({ pg, ctx } = await page({}));
  await pg.goto("http://localhost:8767/?reservation_abandonnee=1");
  v("paiement interrompu : places libérées annoncées", await attendre(pg, "#reservation-body", "places ont été libérées"));
  await ctx.close();

  // 6 bis. Absence signalée : « Je me suis présenté(e) » avant le prélèvement (E9.6)
  let present = false;
  ({ pg, ctx, st } = await page({ fonctions: (f, c) => {
    if (f !== "reservation") return [404, {}];
    if (c.action === "voir") return [200, { reservation: RESA({ debut: futur(-20), peut_annuler: false, absent: true, absence_contestable: true, frais_centimes: 2000 }) }];
    if (c.action === "present") { present = c.jeton === JETON; return [200, { reservation: RESA({ debut: futur(-20), peut_annuler: false, absent: true, absence_contestee: true, frais_centimes: 0 }) }]; }
    return [404, {}];
  } }));
  await pg.goto("http://localhost:8767/#reservation=" + JETON);
  v("absence : prélèvement de 20 € annoncé pour demain 12 h, bouton « Je me suis présenté(e) »", await attendre(pg, "#reservation-body", "20") && await attendre(pg, "#reservation-body", "demain à 12 h") && (await pg.$("#resa-present")) !== null);
  await pg.click("#resa-present");
  v("absence contestée : prélèvement annulé, association et intervenant prévenus", present && await attendre(pg, "#reservation-body", "prélèvement pour absence est annulé") && (await pg.$("#resa-present")) === null);
  await ctx.close();

  // 7. Anglais
  ({ pg, ctx, st } = await page({ lang: "en" }));
  await ouvrir(pg, "circuit-test");
  v("anglais : dates et prix traduits", await attendre(pg, "#visite-seances", "Choose a date") && await attendre(pg, "#visite-seances", "Book your spot for"));
  await pg.click("#btn-reserver");
  v("anglais : adhésion « Pay €5 now », « per year »", await attendre(pg, "#adh-payer", "Pay €5 now") && await attendre(pg, "#reserver-body", "per year"));
  v("anglais : aucune erreur JavaScript", st.erreurs.length === 0, st.erreurs.join(" | "));
  await ctx.close();

  await b.close(); srv.close();
  console.log("\n" + ok + " réussis, " + ko + " en échec"); process.exit(ko ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
