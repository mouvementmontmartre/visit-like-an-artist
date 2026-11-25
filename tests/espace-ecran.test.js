/* Connexion à l'espace intervenants (E11), dans Chromium, Supabase Auth simulé.
   node tests/espace-ecran.test.js <chemin du dépôt> */
const { chromium } = require("playwright");
const http = require("http"), fs = require("fs"), path = require("path");
const RACINE = process.argv[2];
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".jpg": "image/jpeg", ".json": "application/json" };
const srv = http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, "http://x").pathname); if (p === "/") p = "/index.html";
  const f = path.join(RACINE, p);
  if (!f.startsWith(RACINE) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { "Content-Type": types[path.extname(f)] || "application/octet-stream" }); fs.createReadStream(f).pipe(res);
}).listen(8768);

let ok = 0, ko = 0;
const v = (n, c, d) => { if (c) { ok++; console.log("OK     " + n); } else { ko++; console.log("ÉCHEC  " + n + (d ? "  → " + String(d).slice(0, 300) : "")); } };

(async () => {
  const b = await chromium.launch();
  async function page(etat) {
    const ctx = await b.newContext({ serviceWorkers: "block", viewport: { width: 390, height: 844 } });
    const pg = await ctx.newPage();
    const st = { appels: [], erreurs: [] };
    pg.on("pageerror", (e) => st.erreurs.push(e.message));
    if (etat.session) await pg.addInitScript((s) => localStorage.setItem("sessionEspace", JSON.stringify(s)), etat.session);
    await pg.route("**/*", (r) => {
      const u = new URL(r.request().url());
      if (u.hostname.endsWith(".supabase.co")) {
        const appel = { chemin: u.pathname + u.search, methode: r.request().method(), corps: r.request().postData(), auth: r.request().headers()["authorization"] };
        st.appels.push(appel);
        const rep = etat.supabase(u, appel);
        return r.fulfill({ status: rep[0], contentType: "application/json", body: JSON.stringify(rep[1]) });
      }
      if (u.pathname === "/.netlify/functions/carte" && etat.carte) {   // connexion par code (22/11)
        const corps = JSON.parse(r.request().postData() || "{}");
        st.appels.push({ chemin: u.pathname, corps });
        const rep = etat.carte(corps);
        return r.fulfill({ status: rep[0], contentType: "application/json", body: JSON.stringify(rep[1]) });
      }
      if (u.hostname === "localhost") return r.continue();
      return r.abort();
    });
    return { pg, ctx, st };
  }
  const attendre = (pg, sel, txt) => pg.waitForFunction(([s, t]) => { const e = document.querySelector(s); return e && e.textContent.includes(t); }, [sel, txt], { timeout: 8000 }).then(() => true, () => false);
  const supabaseAdmin = (u) => {
    if (u.pathname === "/auth/v1/otp") return [200, {}];
    if (u.pathname === "/auth/v1/user") return [200, { id: "u-admin", email: "admin@exemple.invalid" }];
    if (u.pathname === "/rest/v1/profils") return [200, [{ role: "admin", intervenant_id: null }]];
    if (u.pathname === "/auth/v1/logout") return [204, null];
    if (u.pathname.startsWith("/rest/v1/")) return [200, []];   // administration : listes vides
    return [404, {}];
  };

  // 1. Connexion par code depuis la page Infos (22/11 : un seul code pour tout le monde)
  const carteAdmin = (c) => c.action === "email" ? [200, { ok: true }]
    : c.code === "123456" ? [200, { email: c.email, role: "admin", session: { access_token: "AAA", refresh_token: "RRR", expires_at: Math.floor(Date.now() / 1000) + 3600 } }]
    : [400, { error: "invalide", code: "INVALIDE" }];
  let { pg, ctx, st } = await page({ supabase: supabaseAdmin, carte: carteAdmin });
  await pg.goto("http://localhost:8768/"); await pg.waitForTimeout(2600);
  await pg.evaluate(() => openTarget("espace"));
  v("écran « Espace intervenants » → connexion par code", await attendre(pg, "#espace-body", "Gérez vos séances vous-même.") && await attendre(pg, "#espace-body", "code de connexion"));
  await pg.fill("#esp-email", "pas-un-email"); await pg.click("#esp-envoyer");
  v("email invalide signalé", await attendre(pg, "#esp-note", "adresse email valide"));
  await pg.fill("#esp-email", "  Admin@Exemple.invalid "); await pg.click("#esp-envoyer");
  v("message neutre après la demande, champ du code affiché", await attendre(pg, "#esp-note", "Si cette adresse est connue") && await pg.isVisible("#esp-code"));
  const dem = st.appels.find((a) => a.corps && a.corps.action === "email");
  v("demande du code : email en minuscules", dem && dem.corps.email === "admin@exemple.invalid", JSON.stringify(dem));
  await pg.fill("#esp-code", "111111"); await pg.click("#esp-valider");
  v("code faux : message clair", await attendre(pg, "#esp-note", "code"));
  await pg.fill("#esp-code", "123 456"); await pg.click("#esp-valider");
  v("code bon : connectée, accueil administration", await attendre(pg, "#espace-body", "Bonjour admin@exemple.invalid") && await attendre(pg, "#espace-body", "Expériences · 0"));
  v("session gardée sur cet appareil", (await pg.evaluate(() => JSON.parse(localStorage.getItem("sessionEspace")).refresh_token)) === "RRR");
  v("pas de lien magique demandé (plus d'envoi par Supabase)", !st.appels.some((a) => a.chemin && a.chemin.startsWith("/auth/v1/otp")));
  v("pas d'erreur JavaScript", st.erreurs.length === 0, st.erreurs.join(" | "));
  await ctx.close();

  // 1 bis. Adhérente sans espace : code bon, elle arrive sur Mon compte avec un mot.
  ({ pg, ctx, st } = await page({ supabase: () => [404, {}], carte: (c) => c.action === "email" ? [200, { ok: true }]
    : c.action === "code" ? [200, { email: c.email, jeton: "J".repeat(43), carte: { nom: "Camille Durand", valide_jusqua: new Date(Date.now() + 2e10).toISOString(), formule: "adhesion" } }]
    : c.action === "voir" ? [200, { carte: { nom: "Camille Durand", valide_jusqua: new Date(Date.now() + 2e10).toISOString(), formule: "adhesion" }, email: "camille@exemple.invalid" }]
    : c.action === "reservations" ? [200, { reservations: [] }] : [404, {}] }));
  await pg.goto("http://localhost:8768/"); await pg.waitForTimeout(2600);
  await pg.evaluate(() => openTarget("espace"));
  await pg.fill("#esp-email", "camille@exemple.invalid"); await pg.click("#esp-envoyer");
  await pg.waitForSelector("#esp-code", { state: "visible" });
  await pg.fill("#esp-code", "654321"); await pg.click("#esp-valider");
  v("adhérente sans espace : Mon compte, avec « pas encore d'espace intervenant »", await attendre(pg, "#compte-body", "pas encore d'espace intervenant") && await attendre(pg, "#compte-body", "Camille"));
  await ctx.close();

  // 2. Retour par le lien : administratrice
  ({ pg, ctx, st } = await page({ supabase: supabaseAdmin }));
  await pg.goto("http://localhost:8768/#access_token=AAA&expires_in=3600&refresh_token=RRR&token_type=bearer&type=magiclink");
  v("retour du lien : connectée, accueil administration", await attendre(pg, "#espace-body", "Bonjour admin@exemple.invalid") && await attendre(pg, "#espace-body", "Expériences · 0"));
  v("la session disparaît de l'adresse", !pg.url().includes("access_token"), pg.url());
  v("session gardée sur le téléphone", (await pg.evaluate(() => JSON.parse(localStorage.getItem("sessionEspace")).refresh_token)) === "RRR");
  v("lectures de la base au nom de la personne connectée", (() => { const priv = st.appels.filter((a) => /^\/rest\/v1\/(profils|intervenants_contacts)/.test(a.chemin)); return priv.length >= 2 && priv.every((a) => a.auth === "Bearer AAA"); })());
  await pg.click("#espace-deconnexion");
  v("déconnexion : session effacée, formulaire revenu", await attendre(pg, "#espace-body", "Gérez vos séances") && (await pg.evaluate(() => localStorage.getItem("sessionEspace"))) === null && st.appels.some((a) => a.chemin === "/auth/v1/logout"));
  await ctx.close();

  // 3. Guide
  ({ pg, ctx, st } = await page({ supabase: (u) => {
    if (u.pathname === "/auth/v1/user") return [200, { id: "u-g", email: "guide@exemple.invalid" }];
    if (u.pathname === "/rest/v1/profils") return [200, [{ role: "intervenant", intervenant_id: "11111111-1111-1111-1111-111111111111" }]];
    if (u.pathname === "/rest/v1/intervenants") return [200, [{ nom: "Sylvain Lesecq" }]];
    if (u.pathname.startsWith("/rest/v1/")) return [200, []];
    return [404, {}];
  } }));
  await pg.goto("http://localhost:8768/#access_token=GGG&expires_in=3600&refresh_token=G2&type=magiclink");
  v("guide (ancien lien encore accepté) : « Bonjour Sylvain Lesecq », tableau de bord", await attendre(pg, "#espace-body", "Bonjour Sylvain Lesecq") && await attendre(pg, "#espace-body", "Proposer une nouvelle expérience"));
  await ctx.close();

  // 4. Session expirée : renouvelée
  ({ pg, ctx, st } = await page({ session: { access_token: "VIEUX", refresh_token: "R-VIEUX", expires_at: 10 }, supabase: (u, a) => {
    if (u.pathname === "/auth/v1/token") return [200, { access_token: "NEUF", refresh_token: "R-NEUF", expires_in: 3600 }];
    return supabaseAdmin(u, a);
  } }));
  await pg.goto("http://localhost:8768/"); await pg.waitForTimeout(2600);
  await pg.evaluate(() => openTarget("espace"));
  v("session expirée : renouvelée sans redemander de lien", await attendre(pg, "#espace-body", "Bonjour") && (await pg.evaluate(() => JSON.parse(localStorage.getItem("sessionEspace")).access_token)) === "NEUF");
  const tok = st.appels.find((a) => a.chemin.startsWith("/auth/v1/token"));
  v("renouvellement avec l'ancien jeton de renouvellement", tok && JSON.parse(tok.corps).refresh_token === "R-VIEUX");
  await ctx.close();
  ({ pg, ctx } = await page({ session: { access_token: "VIEUX", refresh_token: "R-MORT", expires_at: 10 }, supabase: (u) => u.pathname === "/auth/v1/token" ? [400, { error: "invalid_grant" }] : [404, {}] }));
  await pg.goto("http://localhost:8768/"); await pg.waitForTimeout(2600);
  await pg.evaluate(() => openTarget("espace"));
  v("session révoquée : retour au formulaire", await attendre(pg, "#espace-body", "Gérez vos séances") && (await pg.evaluate(() => localStorage.getItem("sessionEspace"))) === null);
  await ctx.close();

  // 5. Lien expiré
  ({ pg, ctx } = await page({ supabase: () => [404, {}] }));
  await pg.goto("http://localhost:8768/#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired");
  v("lien expiré : message clair et formulaire", await attendre(pg, "#espace-body", "Ce lien de connexion a expiré") && !pg.url().includes("error") && await pg.isVisible("#esp-email"));
  await ctx.close();

  // 6. Compte sans rôle
  ({ pg, ctx } = await page({ supabase: (u) => u.pathname === "/auth/v1/user" ? [200, { id: "u-x", email: "x@exemple.invalid" }] : u.pathname === "/rest/v1/profils" ? [200, []] : [404, {}] }));
  await pg.goto("http://localhost:8768/#access_token=XXX&expires_in=3600&refresh_token=X2");
  v("compte sans rôle : message « pas encore d'accès »", await attendre(pg, "#espace-body", "n'a pas encore d'accès"));
  await ctx.close();

  // 7. Les autres liens (#carte=, #reservation=) ne sont pas pris pour une connexion
  ({ pg, ctx, st } = await page({ supabase: () => [404, {}] }));
  await pg.goto("http://localhost:8768/#carte=" + "A".repeat(43));
  await pg.waitForTimeout(1500);
  v("un lien de carte de membre reste un lien de carte", await pg.$eval("#screen-membre", (e) => e.classList.contains("active")));
  await ctx.close();

  await b.close(); srv.close();
  console.log("\n" + ok + " réussis, " + ko + " en échec"); process.exit(ko ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
