/* Mise à jour v2 : en-tête, menu ☰, accueil, Infos et Mon compte dans les 4 états
   (visiteur, adhérent, intervenant, adhérent + intervenant), en français et en anglais, à 390 px.
   Serveurs simulés : Sheets, Supabase et fonctions Netlify.
   node tests/etats-ecran.test.js <chemin du dépôt> [dossier des captures] */
const { chromium } = require("playwright");
const http = require("http"), fs = require("fs"), path = require("path");
const RACINE = process.argv[2], OUT = process.argv[3];
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".jpg": "image/jpeg", ".json": "application/json", ".svg": "image/svg+xml", ".woff2": "font/woff2" };
const srv = http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, "http://x").pathname); if (p === "/") p = "/index.html";
  const f = path.join(RACINE, p);
  if (!f.startsWith(RACINE) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { "Content-Type": types[path.extname(f)] || "application/octet-stream" }); fs.createReadStream(f).pipe(res);
}).listen(8794);
let ok = 0, ko = 0;
const v = (n, c, d) => { if (c) { ok++; console.log("OK     " + n); } else { ko++; console.log("ÉCHEC  " + n + (d ? "  → " + String(d).slice(0, 300) : "")); } };
const CSV = "id,Nom,Type,Actif,Guide,Tarif direct\ncircuit,Circuit des Peintres,Visite,Oui,Sylvain Lesecq,50€\natelier-p,Atelier peinture,Atelier,Oui,Mayamore,45€\n";
const CARTE = { nom: "Camille Durand", formule: "adhesion", valide_jusqua: "2027-11-20T00:00:00Z", numero: "MM-0042", renouvelable: true };
const FUTUR = new Date(Date.now() + 5 * 864e5).toISOString();
// Textes retirés par la v2 (section 1 du document) : ils ne doivent apparaître nulle part.
const RETIRES = [/Adhérer\b/, /Deviens Espace Membre/i, /Rejoins le Mouvement/i, /Devenir partenaire/i, /Deux façons de s'engager/i,
  /Become a partner/i, /Join the movement/i, /Two ways to get involved/i, /Pré-réservation/i, /Tarif adhérent/i];

(async () => {
  const b = await chromium.launch();
  const ETATS = {
    visiteur: {},
    adherent: { carte: true },
    intervenant: { session: true },
    "adherent+intervenant": { carte: true, session: true },
  };
  for (const lang of ["fr", "en"]) {
    for (const [nom, e] of Object.entries(ETATS)) {
      const ctx = await b.newContext({ serviceWorkers: "block", viewport: { width: 390, height: 844 } });
      await ctx.addInitScript(([e, lang, carte]) => {
        try {
          if (sessionStorage.getItem("init")) return;
          sessionStorage.setItem("init", "1");
          localStorage.setItem("lang", lang);
          if (e.carte) localStorage.setItem("carteMembre", JSON.stringify({ jeton: "J".repeat(43), carte, email: "camille@exemple.invalid", maj: Date.now() }));
          if (e.session) localStorage.setItem("sessionEspace", JSON.stringify({ access_token: "AAA", refresh_token: "RRR", expires_at: Math.floor(Date.now() / 1000) + 3600 }));
        } catch (x) { /* rien */ }
      }, [e, lang, CARTE]);
      const pg = await ctx.newPage();
      const erreurs = [];
      pg.on("pageerror", (x) => erreurs.push(x.message));
      await pg.route("**/*", (r) => {
        const u = new URL(r.request().url());
        const json = (o, s) => r.fulfill({ status: s || 200, contentType: "application/json", body: JSON.stringify(o) });
        if (u.hostname === "docs.google.com") return r.fulfill({ status: 200, contentType: "text/csv", body: u.searchParams.get("gid") === "0" ? CSV : "" });
        if (u.hostname.endsWith(".supabase.co")) {
          if (u.pathname === "/auth/v1/user") return json({ id: "u1", email: "camille@exemple.invalid" });
          if (u.pathname === "/rest/v1/profils") return json([{ role: "intervenant", intervenant_id: "i1" }]);
          if (u.pathname === "/rest/v1/experiences" && u.searchParams.get("intervenant_id")) return json([{ id: "x1", titre: { fr: "Peindre sur la Butte" }, type: "atelier" }]);
          if (u.pathname === "/rest/v1/seances" && u.searchParams.get("experience_id")) return json([{ id: "s1", experience_id: "x1", debut: FUTUR, point_rdv: "L'atelier", capacite_max: 8, participants_min: 4, statut: "publiee" }]);
          if (u.pathname === "/rest/v1/mes_inscrits") return json([{ seance_id: "s1", personnes: 3 }]);
          return json([]);
        }
        if (u.pathname === "/.netlify/functions/carte") {
          const d = JSON.parse(r.request().postData() || "{}");
          if (d.action === "voir") return json({ carte: CARTE, email: "camille@exemple.invalid" });
          if (d.action === "reservations") return json({ reservations: [] });
          return json({ ok: true });
        }
        if (u.hostname === "localhost") return r.continue();
        return r.abort();
      });
      const cle = lang.toUpperCase() + " · " + nom + " : ";
      await pg.goto("http://localhost:8794/"); await pg.waitForTimeout(2600);

      // En-tête : bouton rond « Mon compte » et ☰, plus de bouton de langue ni de « i ».
      const entete = await pg.evaluate(() => {
        const h = document.querySelector("#screen-accueil header");
        return { compte: !!h.querySelector(".header-compte"), menu: !!h.querySelector(".header-menu"), lang: !!h.querySelector(".lang-btn"), info: !!h.querySelector('[data-open="infos"]') };
      });
      v(cle + "en-tête : Mon compte et ☰, sans langue ni « i »", entete.compte && entete.menu && !entete.lang && !entete.info, JSON.stringify(entete));
      const nav = await pg.$$eval("#bottom-nav .nav-item", (l) => l.map((x) => x.dataset.tab));
      v(cle + "barre du bas : Accueil, Carte, Agenda", nav.join() === "accueil,carte-tab,agenda" || nav.length === 3, nav.join());

      // Accueil : panneau d'adhésion (visiteur) ou statut (adhérent).
      const acc = await pg.evaluate(() => ({ panneau: !!document.querySelector("#accueil-adhesion .adh-panneau"), statut: !!document.querySelector("#accueil-adhesion .cpt-adh"),
        prive: !!document.querySelector(".prive-ligne"), partenaires: document.querySelector("#partenaires-accueil").hidden }));
      v(cle + "accueil : " + (e.carte ? "statut d'adhérent" : "panneau « Devenir membre · 5 € »") + ", ligne réservation privée, partenaires masqués",
        (e.carte ? acc.statut && !acc.panneau : acc.panneau && !acc.statut) && acc.prive && acc.partenaires, JSON.stringify(acc));

      // Menu ☰ : variante selon le statut.
      await pg.click("#screen-accueil .header-menu"); await pg.waitForTimeout(300);
      const menu = await pg.evaluate(() => ({
        espace: !!document.querySelector('#menu-body [data-open="espace"]'),
        proposer: !!document.querySelector('#menu-body [data-open="rejoindre"]:not([data-arg])'),
        lieu: !!document.querySelector('#menu-body [data-open="rejoindre"][data-arg="lieu"]'),
        panneau: !!document.querySelector("#menu-body .adh-panneau"),
        statut: !!document.querySelector("#menu-body .cpt-adh"),
        don: (document.querySelector('#menu-body a[href*="donate"]') || {}).href || "",
        langue: !!document.querySelector('#menu-body [data-open="langue"]'),
        texte: document.querySelector("#menu-body").textContent }));
      v(cle + "menu : " + (e.session ? "Espace intervenants et Proposer une nouvelle expérience" : "Proposer une expérience et Référencer mon lieu"),
        e.session ? menu.espace && !menu.lieu : menu.proposer && menu.lieu && !menu.espace, JSON.stringify(menu).slice(0, 200));
      v(cle + "menu : " + (e.carte ? "ligne de statut d'adhérent" : "carte d'adhésion"), e.carte ? menu.statut && !menu.panneau : menu.panneau && !menu.statut);
      v(cle + "menu : don (lien unique), langue", /donate\.stripe\.com/.test(menu.don) && menu.langue);
      if (OUT) await pg.screenshot({ path: OUT + "/etat-" + lang + "-" + nom.replace("+", "-") + "-menu.png" });

      // Écran des langues : langue courante cochée.
      await pg.click('#menu-body [data-open="langue"]'); await pg.waitForTimeout(200);
      const coche = await pg.evaluate(() => { const x = document.querySelector('#langue-body [aria-checked="true"], #langue-body .actif, #langue-body input:checked'); return x ? x.textContent || x.value || "x" : ""; });
      v(cle + "écran Langue : langue courante cochée", !!coche, coche);

      // Infos (E13) allégée.
      await pg.evaluate(() => openTarget("infos")); await pg.waitForTimeout(200);
      const infos = await pg.textContent("#infos-body");
      v(cle + "Infos : Mouvement Montmartre et bouton Menu", infos.includes("Mouvement Montmartre") && await pg.isVisible('#infos-body [data-open="menu"]'));

      // Mon compte : connexion (visiteur), compte (adhérent), espace (intervenant seul).
      await pg.evaluate(() => ouvrirMonCompte()); await pg.waitForTimeout(900);
      const ecran = await pg.evaluate(() => (document.querySelector(".screen.active") || {}).id);
      if (nom === "visiteur") v(cle + "Mon compte : connexion par code", ecran === "screen-compte" && await pg.isVisible("#cpt-email"));
      else if (nom === "intervenant") v(cle + "Mon compte : intervenant seul → son espace", ecran === "screen-espace", ecran);
      else {
        const statuts = await pg.$$eval(".cpt-statut", (l) => l.map((x) => x.className.includes("actif")));
        v(cle + "Mon compte : pastilles Adhérent " + (e.session ? "et Intervenant actives" : "active, Intervenant non activé"),
          statuts.length === 2 && statuts[0] && statuts[1] === !!e.session, JSON.stringify(statuts));
        if (e.session) {
          const ok2 = await pg.waitForFunction(() => document.querySelector("#compte-body .cpt-liste") && document.querySelector("#compte-body").textContent.includes("Peindre sur la Butte"), null, { timeout: 5000 }).then(() => true, () => false);
          v(cle + "Mon compte : prochaines séances de l'intervenant (inscrits, minimum), « + Nouvelle séance »", ok2 &&
            /3/.test(await pg.textContent("#compte-body")) && await pg.isVisible("#cpt-nouvelle-seance"));
        } else v(cle + "Mon compte : « Vous animez des expériences ? » et Espace intervenants", await pg.isVisible('#compte-body [data-open="espace"]') && await pg.isVisible("#cpt-proposer"));
        v(cle + "Mon compte : « Soutenir l'association », lien de don", !!(await pg.$('#compte-body a[href*="donate"]')));
        if (OUT) await pg.screenshot({ path: OUT + "/etat-" + lang + "-" + nom.replace("+", "-") + "-compte.png", fullPage: true });
      }

      // Aucun texte retiré, nulle part dans la page.
      const tout = await pg.evaluate(() => document.body.innerText + " " + [...document.querySelectorAll("[data-i18n]")].map((x) => x.textContent).join(" "));
      const restes = RETIRES.filter((r) => r.test(tout)).map(String);
      v(cle + "aucun texte retiré (Adhérer, Rejoins le Mouvement, Devenir partenaire, pré-réservation…)", restes.length === 0, restes.join(", "));
      v(cle + "aucune erreur JavaScript", erreurs.length === 0, erreurs.join(" | "));
      await ctx.close();
    }
  }

  // Le rouge #D9391F a disparu des feuilles de style.
  const css = ["css/style.css", "css/theme-artdive.css"].map((f) => fs.readFileSync(path.join(RACINE, f), "utf8")).join("\n");
  v("aucun #D9391F dans les CSS", !/d9391f/i.test(css));

  console.log("\n" + ok + " réussis, " + ko + " en échec");
  await b.close(); srv.close();
  process.exit(ko ? 1 : 0);
})();
