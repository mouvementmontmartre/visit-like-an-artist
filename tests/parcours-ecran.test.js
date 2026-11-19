/* Parcours autoguidé dans Chromium : fiche, achat, retour du paiement, circuit, étape par code ou sur place,
   éditeur des étapes. Supabase et la fonction « parcours » simulés.
   node tests/parcours-ecran.test.js <dépôt> [captures] */
const { chromium } = require("playwright");
const http = require("http"), fs = require("fs"), path = require("path");
const RACINE = process.argv[2], OUT = process.argv[3];
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".jpg": "image/jpeg", ".svg": "image/svg+xml", ".woff2": "font/woff2" };
const srv = http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, "http://x").pathname); if (p === "/") p = "/index.html";
  const f = path.join(RACINE, p);
  if (!f.startsWith(RACINE) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { "Content-Type": types[path.extname(f)] || "application/octet-stream" }); fs.createReadStream(f).pipe(res);
}).listen(8775);
let ok = 0, ko = 0;
const v = (n, c, d) => { if (c) { ok++; console.log("OK     " + n); } else { ko++; console.log("ÉCHEC  " + n + (d ? "  → " + String(d).slice(0, 300) : "")); } };
const EXP = { id: "x-1", slug: "circuit-libre", type: "autoguidee", titre: { fr: "Circuit des Peintres, à votre rythme" }, accroche: {}, description: {}, point_rdv: {},
  prix_libre_min_centimes: 500, option_audioguide_centimes: 400, nb_etapes: 3, intervenant_id: null, langues_relues: ["fr"] };
const JETON = "cd".repeat(32);
const ETAPES = () => [
  { id: "e1", ordre: 1, type: "depart", nom: { fr: "Square Suzanne Buisson" }, lat: 48.8867, lng: 2.3431, rayon_m: 30, code: false, ouverte: true, texte: { fr: "Le départ." }, audio: { fr: "http://localhost:8775/a.mp3" } },
  { id: "e2", ordre: 2, type: "etape", nom: { fr: "Le Maquis" }, lat: 48.887, lng: 2.34, rayon_m: 30, code: false, ouverte: false },
  { id: "e3", ordre: 3, type: "etape", nom: { fr: "Le Bateau-Lavoir" }, lat: 48.886, lng: 2.338, rayon_m: 30, code: true, ouverte: false },
];

(async () => {
  const b = await chromium.launch();
  async function page(o = {}) {
    const ctx = await b.newContext({ serviceWorkers: "block", viewport: { width: 390, height: 844 }, permissions: ["geolocation"], geolocation: { latitude: 48.88701, longitude: 2.34002, accuracy: 10 } });
    const pg = await ctx.newPage();
    const st = { erreurs: [], appels: [], ecritures: [] };
    pg.on("pageerror", (e) => st.erreurs.push(e.message));
    if (o.admin) await pg.addInitScript(() => localStorage.setItem("sessionEspace", JSON.stringify({ access_token: "JETON", refresh_token: "R", expires_at: 4e9 })));
    await pg.route("**/*", (r) => {
      const u = new URL(r.request().url()), m = r.request().method();
      const rep = (x, s = 200) => r.fulfill({ status: s, contentType: "application/json", body: JSON.stringify(x) });
      if (u.hostname === "unpkg.com") return r.fulfill({ status: 200, contentType: "text/javascript", body: "" });
      if (u.hostname === "docs.google.com") return r.fulfill({ status: 200, contentType: "text/csv", body: "" });
      if (u.hostname.endsWith(".supabase.co")) {
        if (m !== "GET") { st.ecritures.push({ m, chemin: u.pathname + u.search, corps: r.request().postData() }); return rep(m === "POST" && u.pathname.endsWith("/etapes") ? [{ id: "e-neuve" }] : [], 201); }
        if (u.pathname === "/auth/v1/user") return rep({ id: "u-admin", email: "a@exemple.invalid" });
        if (u.pathname === "/rest/v1/profils") return rep([{ role: "admin", intervenant_id: null }]);
        if (u.pathname === "/rest/v1/experiences") return rep([Object.assign({ publie: true, actif: true, a_valider: false }, EXP)]);
        if (u.pathname === "/rest/v1/etapes") return rep(o.admin ? [] : [{ ordre: 2, type: "etape", nom: { fr: "Le Maquis" }, resume: { fr: "Aperçu offert" } }]);
        return rep([]);
      }
      if (u.pathname === "/.netlify/functions/parcours") {
        const c = JSON.parse(r.request().postData()); st.appels.push(c);
        if (c.action === "acheter") return rep({ url: "http://localhost:8775/?stripe=1" });
        if (c.action === "session") return rep({ jeton: JETON, reference: "AD-5R8N4W", montant_centimes: 1200, audioguide: true, email: "camille@exemple.invalid" });
        if (c.action === "voir") return rep({ parcours: { slug: "circuit-libre", titre: EXP.titre, nb_etapes: 3, audioguide: true }, etapes: ETAPES() });
        if (c.action === "etape" && c.code) return c.code === "LAPIN" ? rep({ etape: { id: "e3", ordre: 3, nom: { fr: "Le Bateau-Lavoir" }, texte: { fr: "Picasso y peint." }, audio: {} } }) : rep({ error: "CODE" }, 403);
        if (c.action === "etape") return rep({ etape: { id: c.etape_id, ordre: 2, nom: { fr: "Le Maquis" }, texte: { fr: "Une friche de cabanes." }, audio: {} } });
        return rep({ ok: true });
      }
      if (u.searchParams.get("stripe") === "1") return r.fulfill({ status: 200, contentType: "text/html", body: "<h1>Stripe</h1>" });
      if (u.hostname === "localhost") return r.continue();
      return r.abort();
    });
    return { pg, ctx, st };
  }
  const attendre = (pg, sel, txt) => pg.waitForFunction(([s, t]) => { const e = document.querySelector(s); return e && e.textContent.includes(t); }, [sel, txt], { timeout: 8000 }).then(() => true, () => false);

  // 1. Fiche et achat
  let { pg, ctx, st } = await page();
  await pg.goto("http://localhost:8775/"); await pg.waitForTimeout(2600);
  await pg.evaluate(() => openTarget("visite", "circuit-libre"));
  v("fiche : prix libre 5, 8, 10 €, audioguide, aperçu", await attendre(pg, "#parcours-fiche", "Choisissez votre prix") && await attendre(pg, "#parcours-fiche", "Audioguide") &&
    await attendre(pg, "#parcours-fiche", "Le Maquis") && await attendre(pg, "#parcours-fiche", "Et 2 autres étapes"));
  v("fiche : plus d'ancien déblocage ni d'ancienne carte", (await pg.$("#btn-libre")) === null && (await pg.$('#visite-body [data-open="carte-visite"]')) === null);
  await pg.click('#parcours-fiche [data-prix="800"]'); await pg.check("#parc-audio");
  v("8 € + audioguide = 12 €", (await pg.textContent("#parc-debloquer")).replace(/\s/g, " ").includes("12 €"));
  if (OUT) await pg.screenshot({ path: OUT + "/parcours-fiche.png", fullPage: true });
  await pg.click("#parc-debloquer");
  v("écran d'achat : récapitulatif et trois cases", await attendre(pg, "#parcours-body", "Circuit (prix libre)") && (await pg.$$("#parcours-body .resa-case")).length === 3);
  await pg.fill("#parc-email", "Camille@Exemple.invalid"); await pg.check("#parc-c-cgv"); await pg.check("#parc-c-acces_immediat");
  await pg.click("#parc-payer");
  v("sans la case de renoncement : bloqué", await attendre(pg, "#parc-note", "trois cases") && !st.appels.some((a) => a.action === "acheter"));
  await pg.check("#parc-c-renonciation"); await pg.click("#parc-payer");
  await pg.waitForURL(/stripe=1/, { timeout: 5000 }).catch(() => {});
  const achat = st.appels.find((a) => a.action === "acheter") || {};
  v("achat envoyé : 800 centimes + audioguide, email, trois cases", achat.montant_centimes === 800 && achat.audioguide === true && achat.email === "camille@exemple.invalid" &&
    achat.cases && achat.cases.renonciation === true && pg.url().includes("stripe=1"), JSON.stringify(achat));
  v("pas d'erreur JavaScript (achat)", st.erreurs.length === 0, st.erreurs.join(" | "));
  await ctx.close();

  // 2. Retour du paiement, circuit, étapes
  ({ pg, ctx, st } = await page());
  await pg.goto("http://localhost:8775/?parcours=cs_test_abc"); await pg.waitForTimeout(2800);
  v("retour : « Votre circuit est débloqué », référence, audioguide inclus", await attendre(pg, "#parcours-body", "Votre circuit est") && await attendre(pg, "#parcours-body", "AD-5R8N4W") && await attendre(pg, "#parcours-body", "Inclus"));
  v("adresse nettoyée, lien gardé sur le téléphone", !pg.url().includes("cs_test") && (await pg.evaluate(() => JSON.parse(localStorage.getItem("parcoursAcces"))["circuit-libre"])) === "cd".repeat(32));
  await pg.click("#parc-ouvrir");
  v("circuit : 1 étape ouverte sur 3", await attendre(pg, "#parcours-sous", "Étapes ouvertes : 1 sur 3"));
  await pg.click('[data-parc-etape="e1"]');
  v("étape ouverte : texte et audio", await attendre(pg, "#parcours-body", "Le départ.") && (await pg.$("#parcours-body audio")) !== null);
  await pg.click('[data-parc-aller="e2"]');
  v("étape fermée : « Rendez-vous sur place »", await attendre(pg, "#parcours-body", "Rendez-vous sur place"));
  await pg.click("#parc-surplace");
  v("sur place : position envoyée, étape ouverte", await attendre(pg, "#parcours-body", "Une friche de cabanes.") &&
    st.appels.some((a) => a.action === "etape" && a.etape_id === "e2" && Math.abs(a.lat - 48.88701) < 1e-6 && a.precision === 10));
  await pg.click('[data-parc-aller="e3"]');
  await pg.fill("#parc-code", "faux"); await pg.click("#parc-code-ok");
  v("mauvais code : message", await attendre(pg, "#parc-etape-note", "ne correspond pas"));
  await pg.fill("#parc-code", "LAPIN"); await pg.click("#parc-code-ok");
  v("bon code : étape ouverte", await attendre(pg, "#parcours-body", "Picasso y peint."));
  if (OUT) await pg.screenshot({ path: OUT + "/parcours-etape.png", fullPage: true });
  v("pas d'erreur JavaScript (circuit)", st.erreurs.length === 0, st.erreurs.join(" | "));
  await ctx.close();

  // 3. Lien personnel reçu par email
  ({ pg, ctx, st } = await page());
  await pg.goto("http://localhost:8775/#parcours=" + JETON); await pg.waitForTimeout(2800);
  v("lien de l'email : circuit ouvert, jeton retiré de l'adresse", await attendre(pg, "#parcours-body", "Square Suzanne Buisson") && !pg.url().includes(JETON));
  await ctx.close();

  // 4. Éditeur des étapes (admin)
  ({ pg, ctx, st } = await page({ admin: true }));
  await pg.goto("http://localhost:8775/"); await pg.waitForTimeout(2600);
  await pg.evaluate(() => openTarget("espace"));
  await pg.waitForSelector('[data-adm-fiche="x-1"]'); await pg.click('[data-adm-fiche="x-1"]');
  v("fiche autoguidée : option audioguide et bouton des étapes", (await pg.inputValue("#f-audio")) === "4" && await attendre(pg, "#f-etapes", "Étapes du parcours · 3"));
  await pg.click("#f-etapes");
  await pg.waitForSelector("#et-nouvelle"); await pg.click("#et-nouvelle");
  await pg.fill("#e-nom-fr", "Le Bateau-Lavoir"); await pg.fill("#e-texte-fr", "Picasso y peint."); await pg.fill("#e-code", "LAPIN"); await pg.check("#e-apercu");
  await pg.click("#e-enregistrer");
  await attendre(pg, "#adm-zone", "Enregistré.");
  const post = st.ecritures.find((x) => x.m === "POST" && x.chemin.startsWith("/rest/v1/etapes?") === false && x.chemin === "/rest/v1/etapes");
  const corpsEtape = post ? JSON.parse(post.corps) : {};
  v("étape créée : parcours, numéro 1, départ, aperçu, textes", corpsEtape.experience_id === "x-1" && corpsEtape.ordre === 1 && corpsEtape.type === "depart" && corpsEtape.apercu === true && corpsEtape.texte.fr === "Picasso y peint.", JSON.stringify(corpsEtape));
  v("code enregistré à part (table des codes)", st.ecritures.some((x) => x.chemin.startsWith("/rest/v1/etapes_codes") && JSON.parse(x.corps).code === "LAPIN" && JSON.parse(x.corps).etape_id === "e-neuve"));
  v("pas d'erreur JavaScript (éditeur)", st.erreurs.length === 0, st.erreurs.join(" | "));
  await ctx.close();
  await b.close(); srv.close();
  console.log("\n" + ok + " réussis, " + ko + " en échec"); process.exit(ko ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
