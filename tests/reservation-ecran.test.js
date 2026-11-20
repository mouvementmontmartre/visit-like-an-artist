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

  // 1. Fiche : dates, choix, personnes, prix
  let { pg, ctx, st } = await page({ fonctions: (f, c) => f === "reserver" ? [200, { url: "https://checkout.stripe.test/cs_test_1" }] : [404, {}] });
  await ouvrir(pg, "circuit-test");
  v("fiche : les dates s'affichent", await attendre(pg, "#visite-seances", "Choisissez une date"));
  v("fiche : séance confirmée avec places restantes", await attendre(pg, "#visite-seances", "Confirmée · 5 places restantes sur 10"));
  v("fiche : séance pas encore confirmée, barre du minimum", await attendre(pg, "#visite-seances", "2 inscrits, 4 minimum pour partir") && (await pg.$(".seance-barre")) !== null);
  v("fiche : séance complète non cliquable", await pg.$eval('[data-seance="aaaaaaaa-0000-0000-0000-000000000003"]', (b) => b.disabled));
  v("fiche : l'ancien lien externe a disparu", (await pg.$(".cta-externe")) === null);
  v("fiche : prix par défaut 1 personne, réservez pour 5 €", await attendre(pg, "#visite-seances", "Réservez votre place pour 5"));
  await pg.click("#fiche-plus");
  v("fiche : 2 personnes → 100 €, 10 € maintenant, 90 € à Sylvain", await attendre(pg, "#visite-seances", "100") && await attendre(pg, "#visite-seances", "Réservez votre place pour 10") && await attendre(pg, "#visite-seances", "se règle à Sylvain Lesecq sur place"));
  await pg.click('[data-seance="aaaaaaaa-0000-0000-0000-000000000002"]');
  v("fiche : choisir une autre date", await pg.$eval('[data-seance="aaaaaaaa-0000-0000-0000-000000000002"]', (b) => b.classList.contains("choisie")));
  await pg.$eval("#visite-seances", (e) => e.scrollIntoView());
  await pg.screenshot({ path: OUT + "/resa-fiche.png" });

  // 2. Formulaire
  await pg.click("#btn-reserver");
  v("formulaire : ouvert avec le résumé", await attendre(pg, "#reserver-body", "Circuit des Peintres") && await attendre(pg, "#reserver-body", "english"));
  v("formulaire : case d'autorisation avec 10 € par personne, soit 20 € pour 2", await attendre(pg, "#reserver-body", "par personne inscrite, soit au plus 20"));
  v("formulaire : mention « vendue par Sylvain Lesecq, guide ou artiste indépendant »", await attendre(pg, "#reserver-body", "vendue par Sylvain Lesecq, guide ou artiste indépendant"));
  v("formulaire : bouton avec obligation de paiement", await attendre(pg, "#resa-payer", "Payer 10 € et réserver (commande avec obligation de paiement)") || await attendre(pg, "#resa-payer", "(commande avec obligation de paiement)"));
  v("formulaire : 5 cases, aucune pré-cochée, photos facultative", (await pg.$$eval("#resa-form input[type=checkbox]", (l) => l.length + ":" + l.filter((c) => c.checked).length)) === "5:0" && await attendre(pg, "#reserver-body", "(facultatif) J'accepte que des photos"));
  v("formulaire : lien vers la page des CGV", (await pg.$('#resa-form a[href="cgv.html"]')) !== null);
  await pg.click("#resa-payer");
  v("formulaire : champs vides signalés", await attendre(pg, "#resa-note", "Vérifiez votre nom"));
  await pg.fill("#resa-nom", "Camille Durand"); await pg.fill("#resa-email", "Camille@Exemple.invalid"); await pg.fill("#resa-tel", "0612345678");
  await pg.click("#resa-payer");
  v("formulaire : cases non cochées signalées", await attendre(pg, "#resa-note", "Cochez les conditions"));
  await pg.check("#resa-c-cgv"); await pg.check("#resa-c-non_remboursable"); await pg.check("#resa-c-sans_retractation");
  await pg.click("#resa-payer");
  v("formulaire : sans l'autorisation de prélèvement, refus", await attendre(pg, "#resa-note", "Cochez les conditions"));
  await pg.check("#resa-c-prelevement");
  await pg.screenshot({ path: OUT + "/resa-formulaire.png", fullPage: true });
  await pg.click("#resa-payer");
  await pg.waitForURL("https://checkout.stripe.test/**", { timeout: 8000 }).catch(() => {});
  const envoi = st.appels.find((a) => a.f === "reserver" && !a.corps.action);
  v("paiement : envoi vers Stripe avec les bonnes données", pg.url().startsWith("https://checkout.stripe.test/") && envoi && envoi.corps.personnes === 2 && envoi.corps.email === "camille@exemple.invalid" && JSON.stringify(envoi.corps.consentements) === JSON.stringify({ cgv: true, non_remboursable: true, sans_retractation: true, prelevement: true }) && envoi.corps.seance_id === "aaaaaaaa-0000-0000-0000-000000000002", JSON.stringify(envoi));
  v("aucune erreur JavaScript", st.erreurs.length === 0, st.erreurs.join(" | "));
  await ctx.close();

  // 2 bis. Adhérent reconnu par son email : pré-réservation offerte, carte enregistrée sans débit (E8.1.1)
  ({ pg, ctx, st } = await page({ fonctions: (f, c) => f === "reserver" && c.action === "adherent" ? [200, { adherent: c.email === "ada@exemple.invalid", valide_jusqua: "2027-06-30T00:00:00Z" }]
    : f === "reserver" ? [200, { url: "https://checkout.stripe.test/cs_test_adh", adherent: true }] : [404, {}] }));
  await ouvrir(pg, "circuit-test");
  await attendre(pg, "#visite-seances", "Réservez votre place");
  await pg.click("#btn-reserver");
  v("adhérent : invitation à saisir l'email d'adhésion", await attendre(pg, "#reserver-body", "Saisissez votre email d'adhésion"));
  await pg.fill("#resa-nom", "Ada Lovelace"); await pg.fill("#resa-email", "Ada@Exemple.invalid"); await pg.fill("#resa-tel", "0612345678");
  await pg.$eval("#resa-email", (i) => i.dispatchEvent(new Event("change")));
  v("adhérent : « Adhérent reconnu », pré-réservation offerte", await attendre(pg, "#reserver-body", "Adhérent reconnu") && await attendre(pg, "#reserver-body", "Pré-réservation offerte"));
  v("adhérent : 0 € maintenant, bouton « Réserver gratuitement », carte sans débit", await attendre(pg, "#resa-payer", "Réserver gratuitement") &&
    await attendre(pg, "#reserver-body", "Carte enregistrée par Stripe") && await attendre(pg, "#screen-reserver .back-sub", "Adhérent"));
  v("adhérent : les champs saisis sont gardés", (await pg.$eval("#resa-nom", (i) => i.value)) === "Ada Lovelace");
  v("adhérent : pas de case « pré-réservation non remboursable »", (await pg.$("#resa-c-non_remboursable")) === null);
  await pg.screenshot({ path: OUT + "/resa-adherent.png", fullPage: true });
  await pg.check("#resa-c-cgv"); await pg.check("#resa-c-sans_retractation"); await pg.check("#resa-c-prelevement");
  await pg.click("#resa-payer");
  await pg.waitForURL("https://checkout.stripe.test/**", { timeout: 8000 }).catch(() => {});
  const envoiAdh = st.appels.find((a) => a.f === "reserver" && !a.corps.action);
  v("adhérent : réservation envoyée (la base recalcule tout)", envoiAdh && envoiAdh.corps.email === "ada@exemple.invalid" && envoiAdh.corps.consentements.prelevement === true && !envoiAdh.corps.consentements.non_remboursable);
  v("adhérent : aucune erreur JavaScript", st.erreurs.length === 0, st.erreurs.join(" | "));
  await ctx.close();

  // 3. Retour arrière depuis le formulaire, et erreur « complet »
  ({ pg, ctx, st } = await page({ fonctions: (f) => f === "reserver" ? [409, { code: "COMPLET" }] : [404, {}] }));
  await ouvrir(pg, "circuit-test"); await attendre(pg, "#visite-seances", "Choisissez");
  await pg.click("#btn-reserver");
  await pg.click("#screen-reserver [data-back]");
  v("retour depuis le formulaire : on revient à la fiche", await pg.$eval("#screen-visite", (e) => e.classList.contains("active")));
  await pg.click("#btn-reserver");
  await pg.fill("#resa-nom", "A B"); await pg.fill("#resa-email", "a@exemple.invalid"); await pg.fill("#resa-tel", "0612345678");
  for (const c of ["cgv", "non_remboursable", "sans_retractation", "prelevement"]) await pg.check("#resa-c-" + c);
  await pg.click("#resa-payer");
  v("plus de places : message clair", await attendre(pg, "#resa-note", "plus assez de places"));
  await ctx.close();

  // 4. Soirée : prix entier, pas de case de frais, téléphone facultatif
  ({ pg, ctx, st } = await page({ fonctions: (f) => f === "reserver" ? [200, { url: "https://checkout.stripe.test/cs_test_2" }] : [404, {}] }));
  await ouvrir(pg, "soiree-test");
  v("soirée : 12 places restantes sur 40, sans « confirmée »", await attendre(pg, "#visite-seances", "12 places restantes sur 40") && !(await pg.$eval("#visite-seances", (e) => e.textContent.includes("Confirmée"))));
  await pg.click("#btn-reserver");
  v("soirée : pas de case de frais, téléphone facultatif, case d'âge 18 ans", (await pg.$("#resa-c-prelevement")) === null && await attendre(pg, "#reserver-body", "Téléphone (facultatif)") && await attendre(pg, "#reserver-body", "âge minimum requis (18 ans)"));
  v("soirée : mention du prix total payé à l'association", await attendre(pg, "#reserver-body", "Vous payez en ligne le prix total de 25"));
  await pg.fill("#resa-nom", "Lou"); await pg.fill("#resa-email", "lou@exemple.invalid");
  for (const c of ["cgv", "non_remboursable", "sans_retractation", "age"]) await pg.check("#resa-c-" + c);
  await pg.click("#resa-payer");
  await pg.waitForURL("https://checkout.stripe.test/**", { timeout: 8000 }).catch(() => {});
  v("soirée : paiement avec les cases de la soirée, sans prélèvement", st.appels.some((a) => a.f === "reserver" && a.corps.consentements.age === true && !a.corps.consentements.prelevement));
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

  // 7. Anglais
  ({ pg, ctx, st } = await page({ lang: "en" }));
  await ouvrir(pg, "circuit-test");
  v("anglais : dates et prix traduits", await attendre(pg, "#visite-seances", "Choose a date") && await attendre(pg, "#visite-seances", "Book your spot for"));
  await pg.click("#btn-reserver");
  v("anglais : bouton « order with obligation to pay »", await attendre(pg, "#resa-payer", "order with obligation to pay"));
  v("anglais : aucune erreur JavaScript", st.erreurs.length === 0, st.erreurs.join(" | "));
  await ctx.close();

  await b.close(); srv.close();
  console.log("\n" + ok + " réussis, " + ko + " en échec"); process.exit(ko ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
