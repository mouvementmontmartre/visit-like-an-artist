/* Formulaires publics (demande privée, nous rejoindre) dans Chromium, fonction serveur simulée.
   node tests/demande-ecran.test.js <chemin du dépôt> [dossier des captures] */
const { chromium } = require("playwright");
const http = require("http"), fs = require("fs"), path = require("path");
const RACINE = process.argv[2], OUT = process.argv[3];
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".jpg": "image/jpeg", ".json": "application/json", ".svg": "image/svg+xml", ".woff2": "font/woff2" };
const srv = http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, "http://x").pathname); if (p === "/") p = "/index.html";
  const f = path.join(RACINE, p);
  if (!f.startsWith(RACINE) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { "Content-Type": types[path.extname(f)] || "application/octet-stream" }); fs.createReadStream(f).pipe(res);
}).listen(8773);
let ok = 0, ko = 0;
const v = (n, c, d) => { if (c) { ok++; console.log("OK     " + n); } else { ko++; console.log("ÉCHEC  " + n + (d ? "  → " + String(d).slice(0, 300) : "")); } };
const CSV = "id,Nom,Type,Actif,Guide,Tarif direct\ncircuit,Circuit des Peintres,Visite,Oui,Sylvain Lesecq,50€\natelier-p,Atelier peinture,Atelier,Oui,Mayamore,45€\n";

(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ serviceWorkers: "block", viewport: { width: 390, height: 844 } });
  const pg = await ctx.newPage();
  const st = { envois: [], erreurs: [] };
  pg.on("pageerror", (e) => st.erreurs.push(e.message));
  await pg.route("**/*", (r) => {
    const u = new URL(r.request().url());
    if (u.hostname === "docs.google.com") return r.fulfill({ status: 200, contentType: "text/csv", body: u.searchParams.get("gid") === "0" ? CSV : "" });
    if (u.hostname.endsWith(".supabase.co")) return r.fulfill({ status: 200, contentType: "application/json", body: "[]" });
    if (u.pathname === "/.netlify/functions/demande") { st.envois.push(JSON.parse(r.request().postData())); return r.fulfill({ status: st.reponse || 200, contentType: "application/json", body: JSON.stringify(st.corps || { ok: true }) }); }
    if (u.hostname === "localhost") return r.continue();
    return r.abort();
  });
  const attendre = (sel, txt) => pg.waitForFunction(([s, t]) => { const e = document.querySelector(s); return e && e.textContent.includes(t); }, [sel, txt], { timeout: 8000 }).then(() => true, () => false);

  await pg.goto("http://localhost:8773/"); await pg.waitForTimeout(2600);
  v("accueil : encart « Une réservation privée ? »", await attendre(".prive-encart", "Une réservation privée"));
  await pg.evaluate(() => openTarget("visite", "atelier-p"));
  await pg.click('#visite-body [data-open="demande"]');
  v("depuis la fiche d'un atelier : formulaire avec l'atelier choisi", await attendre("#demande-body", "Une visite rien que") &&
    (await pg.inputValue("#f-exp")) === "atelier-p" && (await pg.$eval('#f-type .chip.active', (x) => x.dataset.v)) === "atelier");
  await pg.click('#f-type [data-v="visite"]');
  v("changer de type change la liste", (await pg.$$eval("#f-exp option", (l) => l.map((o) => o.value))).join() === ",circuit");
  await pg.fill("#f-personnes", "12"); await pg.click('#f-occasion [data-v="famille"]'); await pg.fill("#f-periode", "un samedi");
  await pg.fill("#f-nom", "Camille Durand"); await pg.fill("#f-email", "pas-un-email");
  await pg.click("#f-envoyer");
  v("email invalide signalé avant l'envoi", await attendre("#f-note", "adresse email valide") && st.envois.length === 0);
  await pg.fill("#f-email", "Camille@Exemple.invalid"); await pg.waitForTimeout(3100);
  if (OUT) await pg.screenshot({ path: OUT + "/demande.png", fullPage: true });
  await pg.click("#f-envoyer");
  v("demande envoyée : écran de confirmation", await attendre("#demande-body", "Demande envoyée."));
  const d = st.envois[0] || {};
  v("contenu envoyé à la fonction", d.formulaire === "prive" && d.type === "visite" && d.personnes === "12" && d.occasion === "famille" && d.email === "camille@exemple.invalid" &&
    d.site_web === "" && d.duree_ms >= 3000, JSON.stringify(d));

  await pg.evaluate(() => openTarget("infos"));
  await pg.click('#infos-body [data-open="rejoindre"]');
  v("Infos → Nous rejoindre", await attendre("#demande-body", "Vous animez quelque chose"));
  await pg.click('#r-type [data-v="lieu"]'); await pg.fill("#r-nom", "Le cabaret"); await pg.fill("#r-email", "lieu@exemple.invalid");
  await pg.click("#r-envoyer");
  v("message obligatoire", await attendre("#r-note", "Décrivez"));
  await pg.fill("#r-message", "Un cabaret de la Butte");
  st.reponse = 429; st.corps = { error: "TROP" };
  await pg.click("#r-envoyer");
  v("trop de demandes : message clair", await attendre("#r-note", "plusieurs demandes"));
  st.reponse = 200; st.corps = null;
  await pg.click("#r-envoyer");
  v("candidature envoyée", await attendre("#demande-body", "sous 7 jours") && st.envois.slice(-1)[0].type === "lieu" && st.envois.slice(-1)[0].formulaire === "rejoindre");
  await pg.evaluate(() => openTarget("espace"));
  await pg.click('#espace-body [data-open="rejoindre"]');
  v("connexion → « Nous rejoindre »", await attendre("#demande-body", "Vous animez quelque chose"));
  v("pas d'erreur JavaScript", st.erreurs.length === 0, st.erreurs.join(" | "));
  await b.close(); srv.close();
  console.log("\n" + ok + " réussis, " + ko + " en échec"); process.exit(ko ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
