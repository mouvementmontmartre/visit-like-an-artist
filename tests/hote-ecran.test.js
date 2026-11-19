/* Page d'un intervenant (avec et sans vidéo), mention de traduction automatique, vidéo dans l'administration.
   node tests/hote-ecran.test.js <dépôt> [captures] */
const { chromium } = require("playwright");
const http = require("http"), fs = require("fs"), path = require("path");
const RACINE = process.argv[2], OUT = process.argv[3];
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".jpg": "image/jpeg", ".svg": "image/svg+xml", ".woff2": "font/woff2" };
const srv = http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, "http://x").pathname); if (p === "/") p = "/index.html";
  const f = path.join(RACINE, p);
  if (!f.startsWith(RACINE) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { "Content-Type": types[path.extname(f)] || "application/octet-stream" }); fs.createReadStream(f).pipe(res);
}).listen(8774);
let ok = 0, ko = 0;
const v = (n, c, d) => { if (c) { ok++; console.log("OK     " + n); } else { ko++; console.log("ÉCHEC  " + n + (d ? "  → " + String(d).slice(0, 300) : "")); } };
const EXPS = [
  { slug: "circuit", type: "visite_guidee", titre: { fr: "Circuit des Peintres", en: "Painters walk" }, accroche: { fr: "Dans les pas de Lautrec" }, description: {}, point_rdv: {}, prix_centimes: 5000, intervenant_id: "i-1", langues_relues: ["fr"] },
  { slug: "dames", type: "visite_guidee", titre: { fr: "Les Dames" }, accroche: {}, description: {}, point_rdv: {}, prix_centimes: 5000, intervenant_id: "i-2", langues_relues: ["fr"] },
];
const INTS = {
  "i-1": { id: "i-1", nom: "Sylvain Lesecq", role: { fr: "Historien de l'art" }, bio: { fr: "Guide depuis vingt ans." }, langues: ["fr", "en"], video_url: "http://localhost:8774/v.mp4", sous_titres_url: null, langues_relues: ["fr"] },
  "i-2": { id: "i-2", nom: "Joshua Cook", role: {}, bio: {}, langues: ["en"], video_url: null, langues_relues: ["fr"] },
};

(async () => {
  const b = await chromium.launch();
  async function page(o = {}) {
    const ctx = await b.newContext({ serviceWorkers: "block", viewport: { width: 390, height: 844 } });
    const pg = await ctx.newPage();
    const st = { erreurs: [], appels: [] };
    pg.on("pageerror", (e) => st.erreurs.push(e.message));
    if (o.lang) await pg.addInitScript((l) => localStorage.setItem("lang", l), o.lang);
    if (o.admin) await pg.addInitScript(() => localStorage.setItem("sessionEspace", JSON.stringify({ access_token: "JETON", refresh_token: "R", expires_at: 4e9 })));
    await pg.route("**/*", (r) => {
      const u = new URL(r.request().url()), m = r.request().method();
      const rep = (x) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(x) });
      if (u.hostname === "docs.google.com") return r.fulfill({ status: 200, contentType: "text/csv", body: "" });
      if (u.hostname.endsWith(".supabase.co")) {
        st.appels.push({ m, chemin: u.pathname + u.search, type: r.request().headers()["content-type"] });
        if (u.pathname === "/auth/v1/user") return rep({ id: "u-admin", email: "a@exemple.invalid" });
        if (u.pathname === "/rest/v1/profils") return rep([{ role: "admin", intervenant_id: null }]);
        if (u.pathname.startsWith("/storage/v1/object/videos/")) return rep({ Key: "x" });
        if (u.pathname === "/rest/v1/experiences") return rep(o.admin ? [] : EXPS);
        if (u.pathname === "/rest/v1/intervenants") {
          const f = u.searchParams.get("id") || "";
          const ids = f.startsWith("in.(") ? f.slice(4, -1).split(",") : [f.replace("eq.", "")];
          return rep(o.admin ? [Object.assign({ type: "guide", publie: true, slug: "s" }, INTS["i-2"])] : ids.map((i) => INTS[i]).filter(Boolean));
        }
        return rep([]);
      }
      if (u.pathname === "/v.mp4") return r.fulfill({ status: 200, contentType: "video/mp4", body: "" });
      if (u.pathname === "/.netlify/functions/traduire") { st.traduire = JSON.parse(r.request().postData()); return rep({ en: { i_bio: "Guide for twenty years." }, es: { i_bio: "Guía desde hace veinte años." } }); }
      if (u.hostname === "localhost") return r.continue();
      return r.abort();
    });
    return { pg, ctx, st };
  }
  const attendre = (pg, sel, txt) => pg.waitForFunction(([s, t]) => { const e = document.querySelector(s); return e && e.textContent.includes(t); }, [sel, txt], { timeout: 8000 }).then(() => true, () => false);

  // 1. Avec vidéo
  let { pg, ctx, st } = await page();
  await pg.goto("http://localhost:8774/"); await pg.waitForTimeout(2600);
  await pg.evaluate(() => openTarget("visite", "circuit"));
  v("fiche : l'hôte est un lien vers sa page", (await pg.$('#visite-body [data-open="hote"][data-arg="i-1"]')) !== null);
  await pg.click('#visite-body [data-open="hote"]');
  v("page de l'intervenant : nom, métier, langues, à propos, propositions", await attendre(pg, "#hote-body", "Historien de l'art") &&
    await attendre(pg, "#hote-body", "Guide depuis vingt ans.") && await attendre(pg, "#hote-body", "Circuit des Peintres") && await attendre(pg, "#hote-body", "English"));
  v("avec vidéo : aperçu carré", (await pg.$("#hote-video")) !== null);
  if (OUT) await pg.screenshot({ path: OUT + "/hote-video.png", fullPage: true });
  await pg.click("#hote-video");
  v("plein écran : vidéo et bouton fermer", (await pg.$(".video-plein video")) !== null && (await pg.$(".video-fermer")) !== null);
  await pg.click(".video-fermer");
  v("fermer la vidéo", (await pg.$(".video-plein")) === null);
  await ctx.close();

  // 2. Sans vidéo ni texte : aucun bloc vide
  ({ pg, ctx, st } = await page());
  await pg.goto("http://localhost:8774/"); await pg.waitForTimeout(2600);
  await pg.evaluate(() => openTarget("hote", "i-2"));
  await attendre(pg, "#hote-body", "Joshua");
  const texte = await pg.textContent("#hote-body");
  v("sans vidéo : ni aperçu, ni légende, ni « À propos » vide", (await pg.$("#hote-video")) === null && !texte.includes("plein écran") && !texte.includes("À propos") && texte.includes("Les Dames"), texte);
  if (OUT) await pg.screenshot({ path: OUT + "/hote-sans-video.png", fullPage: true });
  v("pas d'erreur JavaScript (pages publiques)", st.erreurs.length === 0, st.erreurs.join(" | "));
  await ctx.close();

  // 3. Traduction automatique signalée en anglais, pas en français
  ({ pg, ctx, st } = await page({ lang: "en" }));
  await pg.goto("http://localhost:8774/"); await pg.waitForTimeout(2600);
  await pg.evaluate(() => openTarget("visite", "circuit"));
  v("en anglais : titre traduit et mention « Automatic translation »", await attendre(pg, "#visite-body", "Painters walk") && await attendre(pg, "#visite-body", "Automatic translation"));
  await ctx.close();

  // 4. Administration : vidéo trop lourde refusée, vidéo envoyée, traduction automatique à l'enregistrement
  ({ pg, ctx, st } = await page({ admin: true }));
  await pg.goto("http://localhost:8774/"); await pg.waitForTimeout(2600);
  await pg.evaluate(() => openTarget("espace"));
  await pg.waitForSelector('[data-adm-onglet="intervenants"]'); await pg.click('[data-adm-onglet="intervenants"]');
  await pg.click('[data-adm-int="i-2"]');
  v("formulaire : vidéo facultative, « pas de vidéo » expliqué", await attendre(pg, "#adm-form", "Pas de vidéo"));
  await pg.evaluate(() => { const i = document.getElementById("i-video-fichier");
    Object.defineProperty(i, "files", { value: [new File([new Uint8Array(10)], "big.mp4", { type: "video/mp4" })], configurable: true });
    Object.defineProperty(i.files[0], "size", { value: 60 * 1024 * 1024 }); i.dispatchEvent(new Event("change")); delete i.files; });
  v("vidéo de plus de 50 Mo refusée avant l'envoi", await attendre(pg, "#i-video-note", "dépasse 50 Mo") && !st.appels.some((a) => a.chemin.startsWith("/storage/")));
  await pg.setInputFiles("#i-video-fichier", { name: "presentation.mp4", mimeType: "video/mp4", buffer: Buffer.alloc(2048) });
  v("vidéo envoyée dans « videos/intervenants/<id>/ »", await attendre(pg, "#i-video-note", "Vidéo envoyée") &&
    st.appels.some((a) => /^\/storage\/v1\/object\/videos\/intervenants\/i-2\/.+\.mp4$/.test(a.chemin) && a.type === "video/mp4"));
  await pg.fill("#i-bio-fr", "Guide depuis vingt ans.");
  await pg.click("#i-enregistrer");
  await attendre(pg, "#adm-form", "Enregistré.");
  const patch = st.appels.filter((a) => a.m === "PATCH" && a.chemin.startsWith("/rest/v1/intervenants")).pop();
  v("traduction demandée à l'enregistrement, pour les champs remplis", st.traduire && st.traduire.textes.i_bio === "Guide depuis vingt ans." && !("i_role" in st.traduire.textes));
  v("pas d'erreur JavaScript (administration)", st.erreurs.length === 0, st.erreurs.join(" | "));
  await ctx.close();
  await b.close(); srv.close();
  console.log("\n" + ok + " réussis, " + ko + " en échec"); process.exit(ko ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
