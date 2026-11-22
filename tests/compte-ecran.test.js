/* Mon compte (E15.2, E15.3), connexion unique par code et routage (lot du 22/11),
   dans Chromium ; fonctions Netlify et Supabase simulées.
   node tests/compte-ecran.test.js <chemin du dépôt> [dossier des captures] */
const { chromium } = require("playwright");
const http = require("http"), fs = require("fs"), path = require("path");
const RACINE = process.argv[2], OUT = process.argv[3];
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".jpg": "image/jpeg", ".json": "application/json", ".svg": "image/svg+xml", ".woff2": "font/woff2" };
const srv = http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, "http://x").pathname); if (p === "/") p = "/index.html";
  const f = path.join(RACINE, p);
  if (!f.startsWith(RACINE) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { "Content-Type": types[path.extname(f)] || "application/octet-stream" }); fs.createReadStream(f).pipe(res);
}).listen(8775);

let ok = 0, ko = 0;
const v = (n, c, d) => { if (c) { ok++; console.log("OK     " + n); } else { ko++; console.log("ÉCHEC  " + n + (d ? "  → " + String(d).slice(0, 300) : "")); } };
const J = "J".repeat(43);
const CARTE = { nom: "Camille Durand", valide_jusqua: new Date(Date.now() + 300 * 864e5).toISOString(), formule: "adhesion", numero: "MM-0042", renouvelable: true };
const dans = (h) => new Date(Date.now() + h * 3600e3).toISOString();
const RESAS = [
  { id: "11111111-1111-1111-1111-111111111111", reference: "AD-AAAAAA", personnes: 2, debut: dans(30), type: "visite_guidee", titre: { fr: "Circuit des Peintres", en: "Painters' walk" },
    point_rdv: "Square Suzanne Buisson", intervenant: "Sylvain", delai_frais_heures: 24, seance_modifiee: false },
  { id: "22222222-2222-2222-2222-222222222222", reference: "AD-BBBBBB", personnes: 1, debut: dans(150), type: "atelier", titre: { fr: "Peindre sur la Butte" },
    point_rdv: "L'atelier", intervenant: null, delai_frais_heures: 24, seance_modifiee: true },
];

(async () => {
  const b = await chromium.launch();
  async function page(o) {
    const ctx = await b.newContext({ serviceWorkers: "block", viewport: o.viewport || { width: 390, height: 844 }, locale: "fr-FR" });
    const pg = await ctx.newPage();
    const st = { appels: [], erreurs: [] };
    pg.on("pageerror", (e) => st.erreurs.push(e.message));
    await pg.addInitScript((x) => {
      if (x.carte) localStorage.setItem("carteMembre", JSON.stringify({ jeton: x.J, carte: x.carte, email: "camille@exemple.invalid", maj: Date.now() }));
      if (x.session) localStorage.setItem("sessionEspace", JSON.stringify({ access_token: "S", refresh_token: "R", expires_at: 4e9 }));
    }, { carte: o.carte ? CARTE : null, session: !!o.session, J });
    await pg.route("**/*", (r) => {
      const u = new URL(r.request().url());
      const rep = (s, d) => r.fulfill({ status: s, contentType: "application/json", body: JSON.stringify(d) });
      if (u.pathname === "/.netlify/functions/carte") {
        const c = JSON.parse(r.request().postData() || "{}"); st.appels.push(c);
        if (c.action === "voir") return rep(200, { carte: CARTE, email: "camille@exemple.invalid" });
        if (c.action === "reservations") return rep(200, { reservations: o.resas || [] });
        if (c.action === "ouvrir") return rep(200, { jeton: "f".repeat(64) });
        if (c.action === "email") return rep(200, { ok: true });
        if (c.action === "code") return o.codeRep ? rep(200, o.codeRep) : rep(400, { code: "INVALIDE" });
        if (c.action === "connexion") return o.connexionRep ? rep(o.connexionRep[0], o.connexionRep[1]) : rep(410, { code: "EXPIRE" });
        if (c.action === "portail") return rep(200, { url: "http://localhost:8775/?portail" });
        return rep(404, {});
      }
      if (u.pathname === "/.netlify/functions/reservation") {
        st.appels.push(JSON.parse(r.request().postData() || "{}"));
        return rep(200, { reservation: { statut: "confirmee", titre: { fr: "Circuit des Peintres" }, type: "visite_guidee", debut: RESAS[0].debut, personnes: 2, reference: "AD-AAAAAA", peut_annuler: true } });
      }
      if (u.hostname.endsWith(".supabase.co")) {
        if (u.pathname === "/auth/v1/user") return rep(200, { id: "u-g", email: "guide@exemple.invalid" });
        if (u.pathname === "/rest/v1/profils") return rep(200, [{ role: "intervenant", intervenant_id: "i-1" }]);
        if (u.pathname === "/rest/v1/intervenants") return rep(200, [{ id: "i-1", nom: "Sylvain Lesecq", role: {}, bio: {}, langues: ["fr"] }]);
        return rep(200, []);
      }
      if (u.hostname === "docs.google.com") return r.fulfill({ status: 200, contentType: "text/csv", body: "" });
      if (u.hostname === "unpkg.com") return r.fulfill({ status: 200, contentType: "text/javascript", body: "" });
      if (u.hostname === "localhost") return r.continue();
      return r.abort();
    });
    return { pg, ctx, st };
  }
  const attendre = (pg, sel, txt) => pg.waitForFunction(([s, t]) => { const e = document.querySelector(s); return e && e.textContent.includes(t); }, [sel, txt], { timeout: 8000 }).then(() => true, () => false);
  const accueil = async (pg, h) => { await pg.goto("http://localhost:8775/" + (h || "")); await pg.waitForTimeout(2600); };
  const monCompte = async (pg) => { await pg.evaluate(() => openTarget("infos")); await pg.click("#infos-compte"); };

  // 1. Sans rien sur l'appareil : « Mon compte » propose la connexion par code.
  let { pg, ctx, st } = await page({ codeRep: { email: "camille@exemple.invalid", jeton: J, carte: CARTE } , resas: RESAS });
  await accueil(pg);
  await monCompte(pg);
  v("Infos → Mon compte sans session : connexion par code", await attendre(pg, "#compte-body", "Retrouvez") && await pg.isVisible("#cpt-email"));
  await pg.fill("#cpt-email", "Camille@Exemple.invalid"); await pg.click("#cpt-envoyer");
  v("code demandé (email en minuscules), champ du code affiché", await attendre(pg, "#cpt-note", "6 chiffres") && st.appels.some((c) => c.action === "email" && c.email === "camille@exemple.invalid"));
  await pg.fill("#cpt-code", "123456"); await pg.press("#cpt-code", "Enter");
  v("adhérente : Mon compte (E15.2), « Bonjour Camille »", await attendre(pg, "#compte-body", "Bonjour") && await attendre(pg, "#compte-body", "Camille") && await pg.$eval("#screen-compte", (e) => e.classList.contains("active")));
  v("bandeau d'adhésion : active, jusqu'au, numéro, « Ma carte »", await attendre(pg, ".cpt-adh", "Adhésion active") && await attendre(pg, ".cpt-adh", "MM-0042") && await attendre(pg, ".cpt-adh", "Ma carte"));
  v("mes prochaines expériences : 2 à venir, avec type, intervenant, heure, lieu", await attendre(pg, "#compte-body", "2 à venir") && await attendre(pg, ".cpt-liste", "Circuit des Peintres, avec Sylvain") &&
    await attendre(pg, ".cpt-liste", "Square Suzanne Buisson") && await attendre(pg, ".cpt-liste", "Visite") && await attendre(pg, ".cpt-liste", "Atelier") && / h \d\d/.test(await pg.textContent(".cpt-liste")));
  v("annulation gratuite jusqu'à 24 h avant ; séance modifiée signalée", await attendre(pg, ".cpt-liste", "annulation gratuite jusqu'à 24 h avant") && await attendre(pg, ".cpt-liste", "séance modifiée"));
  v("« Réserver une autre expérience », « Vous animez des expériences ? », gérer, se déconnecter", await attendre(pg, "#compte-body", "Réserver une autre expérience") &&
    await attendre(pg, "#compte-body", "Vous animez des expériences ?") && await attendre(pg, "#compte-body", "Espace intervenants") && await attendre(pg, "#compte-body", "Proposer une expérience") &&
    await pg.isVisible("#cpt-portail") && await pg.isVisible("#cpt-deconnexion"));
  if (OUT) await pg.screenshot({ path: OUT + "/compte-e15-2.png", fullPage: true });
  await pg.click('[data-cpt-voir="' + RESAS[0].id + '"]');
  v("« Voir » : la page de la réservation (lien personnel)", await attendre(pg, "#reservation-body", "Circuit des Peintres") && st.appels.some((c) => c.action === "ouvrir" && c.reservation_id === RESAS[0].id && c.jeton === J) &&
    st.appels.some((c) => c.action === "voir" && c.jeton === "f".repeat(64)));
  v("pas d'erreur JavaScript", st.erreurs.length === 0, st.erreurs.join(" | "));
  await ctx.close();

  // 2. E15.3 : aucune réservation ; déconnexion.
  ({ pg, ctx, st } = await page({ carte: true, resas: [] }));
  await accueil(pg);
  await monCompte(pg);
  v("E15.3 : « Aucune expérience réservée », « Voir les prochaines dates »", await attendre(pg, "#compte-body", "Aucune expérience") && await attendre(pg, "#compte-body", "Voir les prochaines dates") &&
    await attendre(pg, "#compte-body", "sans frais de réservation"));
  if (OUT) await pg.screenshot({ path: OUT + "/compte-e15-3.png", fullPage: true });
  await pg.click("[data-cpt-accueil]");
  v("« Voir les prochaines dates » → accueil", await pg.$eval("#screen-accueil", (e) => e.classList.contains("active")));
  await monCompte(pg);
  await pg.waitForSelector("#cpt-deconnexion"); await pg.click("#cpt-deconnexion");
  v("se déconnecter : la carte quitte l'appareil, retour à la connexion", await attendre(pg, "#compte-body", "Retrouvez") && (await pg.evaluate(() => localStorage.getItem("carteMembre"))) === null);
  await ctx.close();

  // 3. Routage : intervenant seul → espace ; les deux → Mon compte avec l'entrée Espace.
  ({ pg, ctx, st } = await page({ session: true }));
  await accueil(pg);
  await monCompte(pg);
  v("intervenant seul : « Mon compte » ouvre l'espace intervenants", await attendre(pg, "#espace-body", "Bonjour Sylvain Lesecq") && await pg.$eval("#screen-espace", (e) => e.classList.contains("active")));
  await ctx.close();
  ({ pg, ctx, st } = await page({ carte: true, session: true, resas: RESAS }));
  await accueil(pg);
  await monCompte(pg);
  v("adhérente et intervenante : Mon compte, avec l'entrée « Espace intervenants »", await attendre(pg, "#compte-body", "Bonjour") && await attendre(pg, "#compte-body", "Espace intervenants"));
  await pg.click('#compte-body [data-open="espace"]');
  v("l'entrée ouvre l'espace sans redemander de code", await attendre(pg, "#espace-body", "Bonjour Sylvain Lesecq"));
  await ctx.close();
  ({ pg, ctx, st } = await page({ codeRep: { email: "guide@exemple.invalid", role: "intervenant", session: { access_token: "S", refresh_token: "R", expires_at: 4e9 } } }));
  await accueil(pg);
  await monCompte(pg);
  await pg.fill("#cpt-email", "guide@exemple.invalid"); await pg.click("#cpt-envoyer");
  await pg.waitForSelector("#cpt-code", { state: "visible" }); await pg.fill("#cpt-code", "123456"); await pg.click("#cpt-valider");
  v("code d'un intervenant depuis Mon compte : son espace", await attendre(pg, "#espace-body", "Bonjour Sylvain Lesecq"));
  await ctx.close();

  // 4. Lien de connexion d'un email (#connexion=…&vers=seance), puis lien déjà utilisé.
  ({ pg, ctx, st } = await page({ connexionRep: [200, { email: "guide@exemple.invalid", role: "intervenant", session: { access_token: "S", refresh_token: "R", expires_at: 4e9 } }] }));
  await accueil(pg, "#connexion=" + "a".repeat(43) + "&vers=espace");
  v("lien d'email : connecté, espace, jeton retiré de l'adresse", await attendre(pg, "#espace-body", "Bonjour Sylvain Lesecq") && !pg.url().includes("connexion=") &&
    st.appels.some((c) => c.action === "connexion" && c.jeton === "a".repeat(43)));
  await ctx.close();
  ({ pg, ctx, st } = await page({ connexionRep: [410, { code: "UTILISE" }] }));
  await accueil(pg, "#connexion=" + "b".repeat(43));
  v("lien déjà utilisé : message clair et connexion par code", await attendre(pg, "#compte-body", "a déjà servi") && await pg.isVisible("#cpt-email"));
  await ctx.close();

  // 5. Pilules de filtres : une seule ligne, sur l'accueil comme sur la carte.
  ({ pg, ctx, st } = await page({}));
  await accueil(pg);
  // Rangée de démonstration (les filtres réels dépendent des données) + règle appliquée à toutes les rangées.
  const lignes = await pg.evaluate(() => {
    const z = document.createElement("div"); z.className = "filter-chips";
    z.innerHTML = ["Tout", "Visites", "Ateliers", "Soirées", "Escape games", "Parcours", "Lieux"].map((x) => '<button class="chip">' + x + "</button>").join("");
    document.querySelector("#screen-accueil .screen-inner, #screen-accueil").appendChild(z);
    const n = new Set([...z.querySelectorAll(".chip")].map((c) => c.offsetTop)).size;
    return { n, regles: [...document.querySelectorAll(".filter-chips")].map((x) => getComputedStyle(x).flexWrap) };
  });
  v("pilules de filtres : une seule ligne partout (défilement horizontal si besoin)", lignes.n === 1 && lignes.regles.every((w) => w === "nowrap"), JSON.stringify(lignes));
  await pg.evaluate(() => openTarget("infos"));
  const pastilles = await pg.evaluate(() => new Set([...document.querySelectorAll("#infos-body .infos-pastille")].map((c) => c.offsetTop)).size);
  v("Infos : les pastilles de types sur une ligne", pastilles === 1, pastilles);
  await ctx.close();

  // 6. Ordinateur : Mon compte et l'espace s'élargissent.
  ({ pg, ctx, st } = await page({ carte: true, resas: RESAS, viewport: { width: 1280, height: 900 } }));
  await accueil(pg);
  await monCompte(pg);
  await attendre(pg, ".cpt-liste", "Circuit des Peintres");
  const largeur = await pg.$eval("#compte-body", (e) => e.getBoundingClientRect().width);
  const colonnes = await pg.$eval(".cpt-liste", (e) => getComputedStyle(e).gridTemplateColumns.split(" ").length);
  v("ordinateur : même largeur que les autres pages (820 px), réservations sur deux colonnes", largeur > 700 && largeur <= 820 && colonnes === 2, largeur + " / " + colonnes);
  if (OUT) await pg.screenshot({ path: OUT + "/compte-ordinateur.png" });
  v("pas d'erreur JavaScript (ordinateur)", st.erreurs.length === 0, st.erreurs.join(" | "));
  await ctx.close();

  await b.close(); srv.close();
  console.log("\n" + ok + " réussis, " + ko + " en échec"); process.exit(ko ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
