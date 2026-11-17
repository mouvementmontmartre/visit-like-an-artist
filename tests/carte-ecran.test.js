const { chromium } = require("playwright");
const http = require("http"), fs = require("fs"), path = require("path");
const RACINE = process.argv[2], OUT = process.argv[3];
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".jpg": "image/jpeg", ".json": "application/json" };
const srv = http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, "http://x").pathname); if (p === "/") p = "/index.html";
  const f = path.join(RACINE, p);
  if (!f.startsWith(RACINE) || !fs.existsSync(f)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { "Content-Type": types[path.extname(f)] || "application/octet-stream" }); fs.createReadStream(f).pipe(res);
}).listen(8765);
const JETON = "A".repeat(43);
const carte = (o) => Object.assign({ nom: "Camille Durand", formule: "adhesion", membre_depuis: "2025-06-10T10:00:00Z", valide_jusqua: "2027-06-10T10:00:00Z", valide: true }, o);
let ok = 0, ko = 0, appels = [];
const v = (n, c, d) => { if (c) { ok++; console.log("OK     " + n); } else { ko++; console.log("ÉCHEC  " + n + (d ? "  → " + d : "")); } };
(async () => {
  const b = await chromium.launch();
  async function page(etat) {
    const ctx = await b.newContext({ serviceWorkers: "block", viewport: { width: 390, height: 844 } });
    const pg = await ctx.newPage();
    const erreurs = []; pg.on("pageerror", (e) => erreurs.push(e.message));
    await pg.route("**/*", (r) => {
      const u = r.request().url();
      if (u.startsWith("http://localhost:8765/.netlify/functions/carte")) {
        const corps = JSON.parse(r.request().postData() || "{}"); appels.push(corps);
        const rep = etat(corps);
        return r.fulfill({ status: rep[0], contentType: "application/json", body: JSON.stringify(rep[1]) });
      }
      if (u.startsWith("http://localhost:8765/")) return r.continue();
      return r.abort();   // Google Sheets, polices, Leaflet : bloqués dans ce conteneur
    });
    return { pg, ctx, erreurs };
  }
  const attendre = (pg, sel, txt) => pg.waitForFunction(([s, t]) => { const e = document.querySelector(s); return e && e.textContent.includes(t); }, [sel, txt], { timeout: 8000 }).then(() => true, () => false);

  // 1. Lien de l'email
  let { pg, ctx, erreurs } = await page((c) => c.action === "voir" && c.jeton === JETON ? [200, { carte: carte() }] : [404, {}]);
  await pg.goto("http://localhost:8765/#carte=" + JETON);
  v("lien email : la carte s'affiche", await attendre(pg, "#membre-result", "Camille Durand"));
  v("lien email : le jeton disparaît de l'adresse", !pg.url().includes(JETON), pg.url());
  v("lien email : le formulaire est caché", await pg.$eval("#membre-form", (f) => f.hidden));
  v("lien email : textes de la carte", await attendre(pg, "#membre-result", "Valable jusqu'au 10 juin 2027"));
  const garde = await pg.evaluate(() => JSON.parse(localStorage.getItem("carteMembre")));
  v("la carte est gardée sur le téléphone", garde && garde.jeton === "A".repeat(43) && garde.carte.nom === "Camille Durand");
  await pg.screenshot({ path: OUT + "/carte-valide.png" });
  // hors ligne
  await pg.unroute("**/*"); await pg.route("**/*", (r) => r.request().url().startsWith("http://localhost:8765/") ? r.continue() : r.abort()); await pg.route("**/.netlify/functions/carte", (r) => r.abort());
  await pg.evaluate(() => renderMembre());
  v("hors ligne : la carte gardée reste affichée", await attendre(pg, "#membre-result", "Hors ligne"));
  // oublier
  await pg.click("#membre-oublier");
  v("retirer la carte : le formulaire revient", !(await pg.$eval("#membre-form", (f) => f.hidden)) && !(await pg.evaluate(() => localStorage.getItem("carteMembre"))));
  v("pas d'erreur JavaScript", erreurs.length === 0, erreurs.join(" | "));
  await ctx.close();

  // 2. Retour de paiement
  ({ pg, ctx, erreurs } = await page((c) => c.action === "session" ? [200, { jeton: JETON, carte: carte({ formule: "bienfaiteur", nom: "Bea B." }) }] : c.action === "voir" ? [200, { carte: carte({ formule: "bienfaiteur", nom: "Bea B." }) }] : [400, {}]));
  await pg.goto("http://localhost:8765/?adhesion=cs_live_abc123");
  v("retour de paiement : bienvenue et carte", await attendre(pg, "#membre-result", "Bienvenue au Mouvement Montmartre"));
  v("retour de paiement : formule bienfaiteur", await attendre(pg, "#membre-result", "Bienfaiteur·rice de Montmartre"));
  v("retour de paiement : adresse nettoyée", !pg.url().includes("cs_live"), pg.url());
  await ctx.close();
  ({ pg, ctx, erreurs } = await page(() => [500, {}]));
  await pg.goto("http://localhost:8765/?adhesion=cs_live_abc123");
  v("retour de paiement : serveur en retard → message d'attente", await attendre(pg, "#membre-result", "Paiement reçu"));
  await ctx.close();

  // 3. Demande de lien
  appels = [];
  ({ pg, ctx, erreurs } = await page((c) => c.action === "lien" ? [200, { ok: true }] : [404, {}]));
  await pg.goto("http://localhost:8765/");
  await pg.waitForTimeout(2500);
  await pg.evaluate(() => openTarget("membre"));
  await pg.fill("#membre-email", "pas-un-email");
  await pg.click("#membre-check");
  v("demande : email invalide signalé", await attendre(pg, "#membre-form-note", "adresse email valide"));
  await pg.fill("#membre-email", " Camille@Exemple.invalid ");
  await pg.click("#membre-check");
  v("demande : message neutre après envoi", await attendre(pg, "#membre-form-note", "Si cette adresse correspond"));
  v("demande : email envoyé en minuscules avec la langue", appels.some((a) => a.action === "lien" && a.email === "camille@exemple.invalid" && a.langue === "fr"), JSON.stringify(appels));
  await pg.screenshot({ path: OUT + "/demande.png" });
  await ctx.close();
  ({ pg, ctx } = await page(() => [503, {}]));
  await pg.goto("http://localhost:8765/"); await pg.waitForTimeout(2500);
  await pg.evaluate(() => openTarget("membre")); await pg.fill("#membre-email", "a@exemple.invalid"); await pg.click("#membre-check");
  v("demande : envoi pas encore configuré → message d'attente", await attendre(pg, "#membre-form-note", "revient très bientôt"));
  await ctx.close();

  // 4. Carte expirée, en anglais
  ({ pg, ctx, erreurs } = await page((c) => [200, { carte: carte({ valide_jusqua: "2025-01-01T00:00:00Z", valide: false }) }]));
  await pg.addInitScript(() => { try { localStorage.setItem("lang", "en"); } catch (e) {} });
  await pg.goto("http://localhost:8765/#carte=" + JETON);
  const en = await attendre(pg, "#membre-result", "Expired since");
  v("expirée (anglais) : « Expired since » et bouton de renouvellement", en && (await pg.$('#membre-result a[href="https://buy.stripe.com/7sY5kC7kdfaygOU9mbawo0C"]')) !== null, await pg.$eval("#membre-result", (e) => e.textContent));
  await pg.screenshot({ path: OUT + "/carte-expiree-en.png" });
  await ctx.close();

  // 5. Jeton révoqué
  ({ pg, ctx } = await page(() => [404, {}]));
  await pg.goto("http://localhost:8765/#carte=" + JETON);
  v("jeton révoqué : message et formulaire", await attendre(pg, "#membre-result", "n'est plus valable") && !(await pg.$eval("#membre-form", (f) => f.hidden)));
  await ctx.close();

  // 6. L'ancienne liste en cache est effacée, plus d'appel à la Sheet
  ({ pg, ctx } = await page(() => [404, {}]));
  const demandes = []; pg.on("request", (r) => demandes.push(r.url()));
  await pg.addInitScript(() => { if (!sessionStorage.getItem("x")) { sessionStorage.setItem("x", 1); localStorage.setItem("csv:membres", "Nom,Email\\nX,x@y.z"); } });
  await pg.goto("http://localhost:8765/"); await pg.waitForTimeout(1500);
  v("ancienne liste des adhérents effacée du téléphone", (await pg.evaluate(() => localStorage.getItem("csv:membres"))) === null);
  v("plus aucun appel à la Sheet des adhérents", !demandes.some((u) => u.includes("438910386")));
  await ctx.close();

  await b.close(); srv.close();
  console.log("\n" + ok + " réussis, " + ko + " en échec"); process.exit(ko ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
