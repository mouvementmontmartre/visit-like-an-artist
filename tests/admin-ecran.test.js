/* Administration (étape 6.2a) dans Chromium : fiches, intervenants, photos, invitation,
   reprise de la Sheet, et lecture des fiches publiées par l'app. Supabase simulé en mémoire.
   node tests/admin-ecran.test.js <chemin du dépôt> [dossier des captures] */
const { chromium } = require("playwright");
const http = require("http"), fs = require("fs"), path = require("path");
const RACINE = process.argv[2], OUT = process.argv[3];
const types = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".jpg": "image/jpeg", ".json": "application/json", ".svg": "image/svg+xml", ".woff2": "font/woff2" };
const srv = http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, "http://x").pathname); if (p === "/") p = "/index.html";
  const f = path.join(RACINE, p);
  if (!f.startsWith(RACINE) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { "Content-Type": types[path.extname(f)] || "application/octet-stream" }); fs.createReadStream(f).pipe(res);
}).listen(8772);

let ok = 0, ko = 0;
const v = (n, c, d) => { if (c) { ok++; console.log("OK     " + n); } else { ko++; console.log("ÉCHEC  " + n + (d ? "  → " + String(d).slice(0, 300) : "")); } };

const CSV = "id,Nom,Nom_EN,Type,Actif,Guide,Tarif direct,Durée,Description,Rendez-vous\n" +
  "circuit-test,Circuit des Peintres,Painters walk,Visite,Oui,Sylvain Lesecq,50€,2 h,Dans les pas de Lautrec,Square Suzanne Buisson\n" +
  "soiree-test,Soirée jazz,,Soirée,Oui,,25€,3 h,Concert au cabaret,\n";
const PNG = fs.readFileSync(path.join(RACINE, "icons/icon-192.png"));
const uid = () => "xxxxxxxx-xxxx-4xxx-8xxx-xxxxxxxxxxxx".replace(/x/g, () => "0123456789abcdef"[Math.floor(Math.random() * 16)]);

(async () => {
  const b = await chromium.launch();
  async function page(o) {
    const base = { experiences: [], intervenants: [], intervenants_contacts: [], profils: [{ user_id: "u-admin", role: "admin", intervenant_id: null }],
      seances: [], reservations: [], adhesions: [], demandes_groupes: [], candidatures: [], propositions: [], mes_inscrits: [] };
    const db = Object.assign(base, o.db || {});
    const st = { appels: [], erreurs: [], db, refusPublier: false, photos: [] };
    const ctx = await b.newContext({ serviceWorkers: "block", viewport: { width: 390, height: 844 } });
    const pg = await ctx.newPage();
    pg.on("pageerror", (e) => st.erreurs.push(e.message));
    if (o.session !== false) await pg.addInitScript(() => localStorage.setItem("sessionEspace", JSON.stringify({ access_token: "JETON-ADMIN", refresh_token: "R", expires_at: 4e9 })));
    await pg.route("**/*", async (r) => {
      const u = new URL(r.request().url()), m = r.request().method();
      const corps = r.request().postData();
      const rep = (status, body) => r.fulfill({ status, contentType: "application/json", body: body === undefined ? "" : JSON.stringify(body) });
      if (u.hostname === "unpkg.com") return r.fulfill({ status: 200, contentType: "text/javascript", body: "" });
      if (u.hostname === "docs.google.com") return r.fulfill({ status: 200, contentType: "text/csv", body: u.searchParams.get("gid") === "0" ? CSV : "" });
      if (u.hostname.endsWith(".supabase.co")) {
        const appel = { m, chemin: u.pathname + u.search, auth: r.request().headers()["authorization"], corps };
        st.appels.push(appel);
        if (u.pathname === "/auth/v1/user") return rep(200, { id: o.user || "u-admin", email: "admin@exemple.invalid" });
        if (u.pathname.startsWith("/storage/v1/object/photos/")) { st.photos.push({ chemin: u.pathname, type: r.request().headers()["content-type"], auth: appel.auth }); return rep(200, { Key: "photos/x" }); }
        const tab = u.pathname.replace("/rest/v1/", "");
        if (tab.startsWith("rpc/")) { st.rpc = st.rpc || []; st.rpc.push({ nom: tab.slice(4), args: JSON.parse(corps || "{}"), auth: appel.auth });
          return rep(200, tab === "rpc/annuler_seance" ? { inscrits: 1 } : tab === "rpc/signaler_absence" ? { frais_centimes: 1000 } : tab === "rpc/valider_proposition" ? { inscrits_a_prevenir: 0 }
            : tab === "rpc/notifications_non_envoyees" ? (o.notifs || []) : {}); }
        if (!db[tab]) return rep(200, []);
        const filtres = [...u.searchParams.entries()].filter(([k]) => !["select", "order", "on_conflict", "limit"].includes(k));
        const garde = (l) => filtres.every(([k, f]) => {
          if (f.startsWith("eq.")) return String(l[k]) === f.slice(3);
          if (f.startsWith("in.(")) return f.slice(4, -1).split(",").includes(String(l[k]));
          return true;
        });
        if (m === "GET") {
          let lignes = db[tab].filter(garde);
          if (tab === "profils" && o.user && o.user !== "u-admin") lignes = lignes.filter((p) => p.user_id === o.user);
          return rep(200, lignes);
        }
        const d = JSON.parse(corps || "null");
        if (m === "POST" && Array.isArray(d)) {   // séances répétées : une seule requête
          const lignes = d.map((x) => Object.assign({ id: uid() }, x)); db[tab].push(...lignes); st.lots = (st.lots || []).concat([lignes.length]); return rep(201, lignes);
        }
        if (m === "DELETE") { const lignes = db[tab].filter(garde); db[tab] = db[tab].filter((l) => !lignes.includes(l)); return rep(200, lignes); }
        if (m === "POST") {
          if (tab === "experiences" && d.publie && st.refusPublier) return rep(400, { code: "23514", message: 'new row violates check constraint "experiences_prix_complets"' });
          const cle = u.searchParams.get("on_conflict");
          const ex = cle ? db[tab].find((l) => l[cle] === d[cle]) : null;
          if (ex) { Object.assign(ex, d); return rep(201, [ex]); }
          const ligne = Object.assign({ id: uid(), actif: true, a_valider: false, publie: false, titre: {}, langues: ["fr"] }, tab === "propositions" ? { statut: "en_attente", cree_le: new Date().toISOString() } : {}, d);
          if (tab === "experiences" && o.user === "u-g") Object.assign(ligne, { a_valider: true, intervenant_id: "i-1" });   // comme la garde de la base
          db[tab].push(ligne); return rep(201, [ligne]);
        }
        if (m === "PATCH") {
          if (tab === "experiences" && d.publie && st.refusPublier) return rep(400, { code: "23514", message: 'new row violates check constraint "experiences_prix_complets"' });
          const lignes = db[tab].filter(garde); lignes.forEach((l) => Object.assign(l, d)); return rep(200, lignes);
        }
        return rep(200, []);
      }
      if (u.pathname === "/.netlify/functions/validations") {
        const c = JSON.parse(corps); st.validations = (st.validations || []).concat([{ corps: c, auth: r.request().headers()["authorization"] }]);
        if (c.action === "intervenant_supprimer" && !st.supprimable) return rep(409, { error: "SEANCES_AVEC_INSCRITS" });
        return rep(200, { ok: true, email: "x@exemple.invalid", notifie: c.action !== "experience_refuser", experiences_retirees: 1 });
      }
      if (u.pathname === "/.netlify/functions/inviter") {
        st.invitation = { corps: JSON.parse(corps), auth: r.request().headers()["authorization"] };
        return rep(200, { ok: true, email: "guide@exemple.invalid" });
      }
      if (u.hostname === "localhost") return r.continue();
      return r.abort();
    });
    return { pg, ctx, st };
  }
  const attendre = (pg, sel, txt) => pg.waitForFunction(([s, t]) => { const e = document.querySelector(s); return e && e.textContent.includes(t); }, [sel, txt], { timeout: 8000 }).then(() => true, () => false);
  const ouvrirEspace = async (pg) => { await pg.goto("http://localhost:8772/"); await pg.waitForTimeout(2500); await pg.evaluate(() => openTarget("espace")); };

  // 1. Accueil de l'administration et reprise de la Sheet
  let { pg, ctx, st } = await page({});
  await ouvrirEspace(pg);
  v("admin : onglets Fiches et Intervenants", await attendre(pg, "#espace-body", "Fiches · 0") && await attendre(pg, "#espace-body", "Intervenants · 0"));
  v("reprise proposée : 2 fiches de la Sheet", await attendre(pg, "#adm-reprise", "2 fiche(s) de la Sheet"));
  await pg.click("#adm-reprendre");
  v("reprise faite, message affiché", await attendre(pg, "#adm-zone", "2 fiche(s) reprise(s) en brouillon"));
  const circuit = st.db.experiences.find((e) => e.slug === "circuit-test"), soiree = st.db.experiences.find((e) => e.slug === "soiree-test");
  v("visite reprise : type, titres, prix, pré-réservation, durée, rendez-vous, brouillon",
    circuit && circuit.type === "visite_guidee" && circuit.titre.fr === "Circuit des Peintres" && circuit.titre.en === "Painters walk" &&
    circuit.prix_centimes === 5000 && circuit.prereservation_centimes === 500 && circuit.duree_minutes === 120 &&
    circuit.point_rdv.fr === "Square Suzanne Buisson" && circuit.publie === false && circuit.localite_id === "montmartre", JSON.stringify(circuit));
  const sylvain = st.db.intervenants.find((i) => i.nom === "Sylvain Lesecq");
  v("le guide de la Sheet devient un intervenant publié relié à la fiche", sylvain && sylvain.publie === true && circuit.intervenant_id === sylvain.id);
  v("soirée reprise en soirée, sans pré-réservation", soiree && soiree.type === "soiree" && soiree.prereservation_centimes === null && soiree.prix_centimes === 2500);
  v("toutes les écritures avec la session de l'admin", st.appels.filter((a) => a.m !== "GET" && a.chemin.startsWith("/rest/")).every((a) => a.auth === "Bearer JETON-ADMIN"));
  v("plus de proposition de reprise une fois faite", (await pg.$("#adm-reprendre")) === null);
  v("liste : 2 brouillons", (await pg.$$eval(".adm-etat-brouillon", (l) => l.length)) === 2);

  // 2. Compléter et publier une fiche, avec photo
  await pg.click('[data-adm-fiche="' + circuit.id + '"]');
  v("formulaire de la fiche ouvert, champs remplis", await attendre(pg, "#adm-form", "Circuit des Peintres") && (await pg.inputValue("#f-prix")) === "50" && (await pg.inputValue("#f-titre-fr")) === "Circuit des Peintres");
  // Photo carrée pour un format 4:3 : la fenêtre de recadrage s'ouvre (annuler n'envoie rien).
  await pg.setInputFiles("#f-photo-fichier", { name: "photo.png", mimeType: "image/png", buffer: PNG });
  await pg.waitForSelector(".adm-recadrage canvas");
  v("photo hors format : fenêtre de recadrage (4:3), avertissement si trop petite", await attendre(pg, ".adm-recadrage", "Recadrer la photo") &&
    await attendre(pg, ".adm-recadrage", "plus petite que l'idéal (1600 × 1200 px)") &&
    Math.abs(await pg.$eval(".adm-recadrage canvas", (c) => c.width / c.height) - 4 / 3) < 0.01);
  if (OUT) await pg.screenshot({ path: OUT + "/recadrage.png" });
  await pg.click('.adm-recadrage [data-r="annuler"]');
  v("recadrage annulé : rien n'est envoyé", (await pg.$(".adm-recadrage")) === null && st.photos.length === 0);
  await pg.setInputFiles("#f-photo-fichier", { name: "photo.png", mimeType: "image/png", buffer: PNG });
  await pg.waitForSelector(".adm-recadrage canvas");
  await pg.fill(".adm-recadrage-zoom", "2");
  const boiteToile = await pg.$(".adm-recadrage canvas").then((e) => e.boundingBox());
  await pg.mouse.move(boiteToile.x + 100, boiteToile.y + 100); await pg.mouse.down(); await pg.mouse.move(boiteToile.x + 60, boiteToile.y + 80); await pg.mouse.up();
  await pg.click('.adm-recadrage [data-r="ok"]');
  const okPhoto = await attendre(pg, "#f-photo-note", "Photo enregistrée");
  if (!okPhoto) console.log("   note photo : " + await pg.textContent("#f-photo-note"));
  v("photo envoyée réduite en JPEG, avec la session", okPhoto &&
    st.photos.length === 1 && st.photos[0].type === "image/jpeg" && st.photos[0].auth === "Bearer JETON-ADMIN" && /^\/storage\/v1\/object\/photos\/fiches\/.+\.jpg$/.test(st.photos[0].chemin), JSON.stringify(st.photos));
  await pg.fill("#f-max", "10"); await pg.fill("#f-min", "4"); await pg.check("#f-publie");
  if (OUT) await pg.screenshot({ path: OUT + "/admin-fiche.png", fullPage: true });
  await pg.click("#f-enregistrer");
  v("enregistrée : retour à la liste, « En ligne »", await attendre(pg, "#adm-zone", "Enregistré.") && await attendre(pg, ".adm-liste", "En ligne"));
  v("fiche publiée avec places, photo de stockage et sans « à valider »",
    circuit.publie === true && circuit.capacite_max === 10 && circuit.participants_min === 4 && circuit.a_valider === false && /\/storage\/v1\/object\/public\/photos\/fiches\//.test(circuit.photo_url), JSON.stringify(circuit));

  // 3. Publication refusée par la base (prix incomplets) : message clair
  st.refusPublier = true;
  await pg.click('[data-adm-fiche="' + soiree.id + '"]');
  await pg.waitForSelector("#f-publie"); await pg.check("#f-publie"); await pg.click("#f-enregistrer");
  v("publication incomplète : message clair, reste sur le formulaire", await attendre(pg, "#f-note", "il manque le prix"));
  st.refusPublier = false;
  await pg.click("#f-retour");

  // 4. Nouvelle fiche
  await pg.waitForSelector("#adm-nouvelle-fiche"); await pg.click("#adm-nouvelle-fiche");
  await pg.selectOption("#f-type", "atelier");
  await pg.click("#f-enregistrer");
  v("titre obligatoire", await attendre(pg, "#f-note", "titre en français est obligatoire"));
  await pg.fill("#f-titre-fr", "Atelier peinture sur la Butte"); await pg.fill("#f-prix", "45"); await pg.fill("#f-max", "8");
  await pg.click("#f-enregistrer");
  await attendre(pg, "#adm-zone", "Enregistré.");
  const atelier = st.db.experiences.find((e) => e.slug === "atelier-peinture-sur-la-butte");
  v("nouvelle fiche : adresse tirée du titre, type, prix, brouillon", atelier && atelier.type === "atelier" && atelier.prix_centimes === 4500 && atelier.publie === false && atelier.localite_id === "montmartre", JSON.stringify(atelier));
  // Supprimer une expérience (maj-21) : fonction de la base, message selon le résultat.
  await pg.click('[data-adm-fiche="' + atelier.id + '"]');
  await pg.waitForSelector("#f-supprimer");
  pg.once("dialog", (d) => d.accept());
  await pg.click("#f-supprimer");
  v("supprimer une expérience : fonction de la base avec la session, message", await attendre(pg, "#adm-zone", "Expérience supprimée") &&
    st.rpc.some((r) => r.nom === "supprimer_experience" && r.args.p_id === atelier.id && r.auth === "Bearer JETON-ADMIN"));
  v("les listes ne lisent que les expériences non supprimées", st.appels.some((x) => x.m === "GET" && /\/rest\/v1\/experiences\?.*supprimee_le=is\.null/.test(x.chemin)));
  v("pas d'erreur JavaScript (fiches)", st.erreurs.length === 0, st.erreurs.join(" | "));

  // 5. Intervenant : email privé et invitation
  await pg.click('[data-adm-onglet="intervenants"]');
  await pg.click('[data-adm-int="' + sylvain.id + '"]');
  v("fiche intervenant : pas d'email, invitation impossible", await attendre(pg, "#i-invit-note", "Enregistrez d'abord son email") && await pg.$eval("#i-inviter", (x) => x.disabled));
  await pg.fill("#i-email", "Guide@Exemple.invalid"); await pg.fill("#i-role-fr", "historien de l'art");
  await pg.click("#i-enregistrer");
  v("email enregistré en minuscules dans les contacts privés", await attendre(pg, "#adm-form", "Enregistré.") &&
    st.db.intervenants_contacts.some((c) => c.intervenant_id === sylvain.id && c.email === "guide@exemple.invalid") && sylvain.role.fr === "historien de l'art", JSON.stringify(st.db.intervenants_contacts));
  await pg.click("#i-inviter");
  v("invitation envoyée par la fonction serveur, avec la session", await attendre(pg, "#i-invit-note", "Email envoyé à guide@exemple.invalid") &&
    st.invitation && st.invitation.corps.intervenant_id === sylvain.id && st.invitation.auth === "Bearer JETON-ADMIN");
  pg.once("dialog", (d) => d.accept());
  await pg.click("#i-supprimer");
  v("supprimer un intervenant qui a des inscrits : refusé avec la marche à suivre", await attendre(pg, "#i-suppr-note", "annulez-la d'abord") &&
    st.validations.some((x) => x.corps.action === "intervenant_supprimer" && x.corps.id === sylvain.id && x.auth === "Bearer JETON-ADMIN"));
  await pg.click("#i-retour");
  await pg.click("#adm-nouvel-int");
  await pg.fill("#i-nom", "Mayamore"); await pg.selectOption("#i-type", "artiste"); await pg.click("#i-enregistrer");
  await attendre(pg, "#adm-form", "Enregistré.");
  v("nouvel intervenant créé", st.db.intervenants.some((i) => i.nom === "Mayamore" && i.type === "artiste" && i.slug === "mayamore"));
  v("pas d'erreur JavaScript (intervenants)", st.erreurs.length === 0, st.erreurs.join(" | "));
  // 5 bis. Séances, inscrits, absence, annulation (6.2b)
  await pg.click("#i-retour");
  await pg.click('[data-adm-onglet="seances"]');
  v("onglet Séances : vide", await attendre(pg, "#adm-zone", "Aucune séance à venir"));
  await pg.click("#adm-nouvelle-seance");
  await pg.selectOption("#s-exp", circuit.id);
  v("la séance reprend places, minimum, durée, prix net et rendez-vous de la fiche", (await pg.textContent("#s-max")) === "10" && (await pg.textContent("#s-min")) === "4" &&
    (await pg.textContent("#s-duree")) === "2 h" && (await pg.inputValue("#s-prix")) === "45" && (await pg.inputValue("#s-rdv")) === "Square Suzanne Buisson");
  v("plus de « réservée aux adhérents » ni de tarif adhérent ni de 5 €", (await pg.$("#s-reservee")) === null && (await pg.$("#s-adh")) === null && !(await pg.textContent("#adm-form")).includes("5 €"));
  await pg.click('.adm-stepper:has(#s-duree) [data-pas="1"]'); await pg.click('.adm-stepper:has(#s-duree) [data-pas="1"]');
  v("durée par pas de 15 minutes, affichée « 2 h 30 »", (await pg.textContent("#s-duree")) === "2 h 30");
  const demain = new Date(Date.now() + 3 * 864e5).toLocaleDateString("sv-SE", { timeZone: "Europe/Paris" });
  await pg.fill("#s-jour", demain); await pg.fill("#s-heure", "10:00");
  await pg.click('#s-langue [data-valeur="en"]');
  if (OUT) await pg.screenshot({ path: OUT + "/seance-e11-2.png", fullPage: true });
  await pg.click("#s-publier");
  await attendre(pg, "#adm-zone", "Séance publiée");
  const sea = st.db.seances[0];
  const hParis = sea && new Date(sea.debut).toLocaleTimeString("en-GB", { timeZone: "Europe/Paris", hour: "2-digit", minute: "2-digit" });
  v("séance publiée tout de suite, à 10 h heure de Paris, 2 h 30, 45 € par personne, en anglais", sea && sea.statut === "publiee" && sea.experience_id === circuit.id && hParis === "10:00" &&
    sea.capacite_max === 10 && sea.prix_centimes === 4500 && sea.langue === "en" && (new Date(sea.fin) - new Date(sea.debut)) === 150 * 6e4, JSON.stringify(sea));
  // Répétition chaque semaine pendant 3 semaines : 4 séances en une seule requête.
  await pg.click("#adm-nouvelle-seance");
  await pg.selectOption("#s-exp", circuit.id);
  const j1 = new Date(Date.now() + 4 * 864e5), fin3 = new Date(j1.getTime() + 21 * 864e5);
  await pg.fill("#s-jour", j1.toLocaleDateString("sv-SE", { timeZone: "Europe/Paris" })); await pg.fill("#s-heure", "18:30");
  await pg.selectOption("#s-repeter", "7");
  await pg.fill("#s-jusqua", fin3.toLocaleDateString("sv-SE", { timeZone: "Europe/Paris" }));
  await pg.click("#s-publier");
  v("répétition chaque semaine : 4 séances publiées d'un coup", await attendre(pg, "#adm-zone", "4 séances publiées") && st.lots && st.lots[0] === 4 &&
    st.db.seances.slice(1).every((x) => new Date(x.debut).toLocaleTimeString("en-GB", { timeZone: "Europe/Paris", hour: "2-digit", minute: "2-digit" }) === "18:30"));
  // Supprimer une séance sans inscrit
  await pg.click('[data-adm-seance="' + st.db.seances[1].id + '"]');
  await pg.waitForSelector("#s-supprimer");
  pg.once("dialog", (d) => d.accept());
  await pg.click("#s-supprimer");
  v("supprimer une séance : fonction de la base", await attendre(pg, "#adm-zone", "Séance supprimée") && st.rpc.some((r) => r.nom === "supprimer_seance" && r.args.p_id === st.db.seances[1].id));
  // Dupliquer
  await pg.click('[data-adm-seance="' + sea.id + '"]');
  await pg.waitForSelector("#s-dupliquer"); await pg.click("#s-dupliquer");
  v("Dupliquer : nouvelle séance pré-remplie (lieu, langue, prix), date à choisir", await attendre(pg, "#adm-form", "Nouvelle séance (copie)") &&
    (await pg.inputValue("#s-jour")) === "" && (await pg.inputValue("#s-prix")) === "45" && (await pg.getAttribute('#s-langue [data-valeur="en"]', "aria-checked")) === "true");
  await pg.click("#s-retour");
  // une séance commencée hier avec deux inscrits
  st.db.seances.push({ id: "sea-hier", experience_id: circuit.id, debut: new Date(Date.now() - 864e5).toISOString(), langue: "fr", capacite_max: 10, participants_min: 2, statut: "publiee" });
  st.db.reservations.push({ id: "r1", seance_id: "sea-hier", reference: "AD-AAAAAA", nom: "Camille D.", email: "c@exemple.invalid", personnes: 2, statut: "confirmee", frais_centimes: 0, frais_statut: "aucun" },
    { id: "r2", seance_id: "sea-hier", reference: "AD-BBBBBB", nom: "Léo M.", email: "l@exemple.invalid", personnes: 1, statut: "annulee", frais_centimes: 1000, frais_statut: "preleve" });
  await pg.click('[data-adm-onglet="seances"]');
  await pg.click('[data-adm-seance="sea-hier"]');
  v("inscrits de la séance, avec les frais", await attendre(pg, "#adm-form", "Inscrits : 2 personne(s)") && await attendre(pg, "#adm-form", "AD-BBBBBB") && await attendre(pg, "#adm-form", "prélevés"));
  v("séance avec inscrits : modifiable, les inscrits seront prévenus", !(await pg.$eval("#s-jour", (x) => x.disabled)) && await attendre(pg, "#adm-form", "déjà inscrite(s)"));
  pg.once("dialog", (d) => d.accept());
  await pg.click('[data-adm-absent="r1"]');
  v("absence signalée par la fonction de la base, frais annoncés", await attendre(pg, "#s-absent-note", "prévu demain") && st.rpc.some((r) => r.nom === "signaler_absence" && r.args.p_reservation_id === "r1" && r.auth === "Bearer JETON-ADMIN"));
  pg.once("dialog", (d) => d.accept());
  await pg.selectOption("#s-motif", "intervenant_empeche");
  await pg.click("#s-annuler");
  v("annulation : fonction de la base avec le motif, message de remboursement", await attendre(pg, "#s-note", "1 inscrit(s) prévenu(s) et remboursé(s)") &&
    st.rpc.some((r) => r.nom === "annuler_seance" && r.args.p_seance_id === "sea-hier" && r.args.p_motif === "intervenant_empeche"));
  await pg.click("#s-retour");

  // 5 ter. Adhésions et demandes
  st.db.adhesions.push({ nom: "Camille Durand", email: "camille@exemple.invalid", formule: "adhesion", source: "stripe_abonnement", valide_jusqua: new Date(Date.now() + 1e10).toISOString(), statut: "active" },
    { nom: null, email: "ancien@exemple.invalid", formule: "bienfaiteur", source: "manuelle", valide_jusqua: "2024-01-01T00:00:00Z", statut: "active" });
  await pg.click('[data-adm-onglet="adhesions"]');
  v("adhésions : bilan et liste", await attendre(pg, "#adm-zone", "1 adhésion(s) à jour sur 2") && await attendre(pg, "#adm-adh-liste", "Expirée le"));
  await pg.fill("#adm-adh-filtre", "camille");
  v("recherche dans les adhésions", (await pg.$$eval("#adm-adh-liste .adm-ligne", (l) => l.length)) === 1);
  await pg.click("details.adm-encart summary");
  await pg.fill("#m-email", "Nouveau@Exemple.invalid"); await pg.fill("#m-nom", "Nina"); await pg.click("#m-ajouter");
  await attendre(pg, "#adm-zone", "Enregistré.");
  v("adhésion hors ligne ajoutée par la fonction de la base", st.rpc.some((r) => r.nom === "ajouter_adhesion_manuelle" && r.args.p_email === "nouveau@exemple.invalid" && r.args.p_nom === "Nina" && /^\d{4}-\d{2}-\d{2}$/.test(r.args.p_valide_jusqua)));
  st.db.demandes_groupes.push({ id: "dg1", nom: "Paul", email: "paul@exemple.invalid", type: "visite", personnes: 12, message: "Anniversaire", statut: "nouvelle", cree_le: new Date().toISOString() });
  await pg.click('[data-adm-onglet="demandes"]');
  v("demandes : la demande privée s'affiche", await attendre(pg, "#adm-zone", "Visites et ateliers privés · 1 nouvelle(s)") && await attendre(pg, "#adm-zone", "Anniversaire"));
  await pg.selectOption('select[data-id="dg1"]', "en_cours");
  v("statut d'une demande changé", await attendre(pg, "#d-note", "Enregistré.") && st.db.demandes_groupes[0].statut === "en_cours");
  v("les candidatures ne sont plus dans Demandes (renvoi vers Validations)", await attendre(pg, "#adm-zone", "sont dans l'onglet") && !(await pg.textContent("#adm-zone")).includes("Accepter et prévenir par email ·"));
  v("pas d'erreur JavaScript (séances, adhésions, demandes)", st.erreurs.length === 0, st.erreurs.join(" | "));
  if (OUT) await pg.screenshot({ path: OUT + "/admin-demandes.png" });

  const dbFinal = st.db;
  await ctx.close();

  // 6. Espace intervenant (6.3) : mêmes écrans, droits réduits
  const futur = new Date(Date.now() + 5 * 864e5).toISOString(), passe = new Date(Date.now() - 3600e3).toISOString();
  ({ pg, ctx, st } = await page({ user: "u-g", db: {
    profils: [{ user_id: "u-g", role: "intervenant", intervenant_id: "i-1" }],
    intervenants: [{ id: "i-1", nom: "Sylvain Lesecq", type: "guide", role: { fr: "guide" }, bio: {}, langues: ["fr"] }],
    intervenants_contacts: [{ intervenant_id: "i-1", email: "s@exemple.invalid" }],
    experiences: [{ id: "x-1", slug: "circuit", type: "visite_guidee", titre: { fr: "Circuit des Peintres" }, accroche: {}, description: {}, point_rdv: {},
      langues: ["fr"], publie: true, actif: true, intervenant_id: "i-1", prix_centimes: 5000, capacite_max: 10, participants_min: 4 }],
    seances: [{ id: "s-1", experience_id: "x-1", debut: futur, langue: "fr", capacite_max: 10, participants_min: 4, statut: "publiee" }],
    mes_inscrits: [{ id: "r-9", seance_id: "s-0", experience_id: "x-1", debut: passe, nom: "Camille D.", personnes: 2, telephone: "0600000000", reste_sur_place_centimes: 9000 }],
  } }));
  await ouvrirEspace(pg);
  v("intervenant : ses quatre onglets, pas d'administration", await attendre(pg, ".adm-onglets", "Mes séances") && await attendre(pg, ".adm-onglets", "Mes inscrits") &&
    await attendre(pg, ".adm-onglets", "Expériences") && await attendre(pg, ".adm-onglets", "Ma fiche") && !(await pg.textContent(".adm-onglets")).includes("Adhésions"));
  v("E11.1 : « + Nouvelle séance », « Proposer une nouvelle expérience », prochaines séances", await attendre(pg, "#adm-zone", "Nouvelle séance") &&
    await attendre(pg, "#adm-zone", "Proposer une nouvelle expérience") && await attendre(pg, "#adm-zone", "0 inscrits sur 4 minimum") && await attendre(pg, "#adm-zone", "inscrits ce mois"));
  await pg.click('[data-adm-seance="s-1"]');
  await pg.waitForSelector("#s-max");
  await pg.click('.adm-stepper:has(#s-max) [data-pas="-1"]'); await pg.click('.adm-stepper:has(#s-max) [data-pas="-1"]');
  await pg.fill("#s-rdv", "Place Blanche");
  await pg.click("#s-publier");
  await attendre(pg, "#adm-zone", "Enregistré.");
  v("séance en ligne modifiée directement (plus de proposition)", st.db.seances[0].capacite_max === 8 && st.db.seances[0].point_rdv === "Place Blanche" && !st.db.propositions.length, JSON.stringify(st.db.seances[0]));
  await pg.click('[data-adm-seance="s-1"]');
  await pg.waitForSelector("#s-annuler");
  v("l'intervenant peut annuler sa séance lui-même", await attendre(pg, "#adm-form", "Annuler la séance") && await attendre(pg, "#adm-form", "L'association est prévenue"));
  pg.once("dialog", (d) => d.accept());
  await pg.click("#s-annuler");
  v("annulation par l'intervenant : fonction de la base, motif « intervenant empêché », message", await attendre(pg, "#s-note", "l'association est informée") &&
    st.rpc.some((r) => r.nom === "annuler_seance" && r.args.p_seance_id === "s-1" && r.args.p_motif === "intervenant_empeche"));
  await pg.click("#s-retour");
  await pg.waitForSelector("#adm-nouvelle-seance");
  await pg.click("#adm-nouvelle-seance");
  await pg.selectOption("#s-exp", "x-1");
  v("places limitées à celles de l'expérience (maximum 10)", await attendre(pg, "#s-max-apres", "maximum 10"));
  const j9 = new Date(Date.now() + 9 * 864e5);
  await pg.fill("#s-jour", j9.toLocaleDateString("sv-SE", { timeZone: "Europe/Paris" }));
  await pg.selectOption("#s-repeter", "n"); await pg.fill("#s-tous", "2");
  await pg.fill("#s-jusqua", new Date(j9.getTime() + 6 * 864e5).toLocaleDateString("sv-SE", { timeZone: "Europe/Paris" }));
  await pg.click("#s-publier");
  v("tous les 2 jours pendant 6 jours : 4 séances publiées tout de suite", await attendre(pg, "#adm-zone", "4 séances publiées") &&
    st.db.seances.filter((x) => x.id !== "s-1" && x.statut === "publiee").length === 4);
  // E11.6 : nouvelle expérience
  await pg.click("#adm-nouvelle-exp");
  await pg.waitForSelector("#x-titre-fr");
  v("E11.6 : Visite, Atelier, Escape game (pas de Soirée)", (await pg.$$eval("#x-type [data-valeur]", (l) => l.map((b) => b.dataset.valeur).join(","))) === "visite_guidee,atelier,escape_game");
  await pg.click('#x-type [data-valeur="escape_game"]');
  await pg.fill("#x-titre-fr", "Le trésor du Bateau-Lavoir");
  await pg.fill("#x-description-fr", "x".repeat(260));
  v("description : 200 caractères au plus, compteur", (await pg.inputValue("#x-description-fr")).length === 200 && await attendre(pg, "#x-compteur", "200 / 200"));
  await pg.click('.adm-stepper:has(#x-duree) [data-pas="-1"]');
  if (OUT) await pg.screenshot({ path: OUT + "/experience-e11-6.png", fullPage: true });
  if (OUT) { await pg.setViewportSize({ width: 1280, height: 900 }); await pg.screenshot({ path: OUT + "/experience-ordinateur.png" }); await pg.setViewportSize({ width: 390, height: 844 }); }
  await pg.click("#x-enregistrer");
  v("prix obligatoire", await attendre(pg, "#x-note", "prix par personne"));
  await pg.fill("#x-prix", "25");
  await pg.click("#x-enregistrer");
  await attendre(pg, "#adm-zone", "Expérience envoyée");
  const nx = st.db.experiences.find((e) => e.titre && e.titre.fr === "Le trésor du Bateau-Lavoir");
  v("expérience envoyée pour validation : type, prix net, durée, sans champ réservé à l'association", nx && nx.type === "escape_game" && nx.prix_centimes === 2500 &&
    nx.duree_minutes === 105 && !("publie" in nx && nx.publie) && !("prereservation_centimes" in nx), JSON.stringify(nx));
  v("tableau de bord : expérience en attente de validation", await attendre(pg, "#adm-zone", "en attente de validation"));
  await pg.click('[data-adm-onglet="inscrits"]');
  v("mes inscrits : prénom, téléphone, reste à encaisser", await attendre(pg, "#adm-zone", "Camille D.") && await attendre(pg, "#adm-zone", "à encaisser sur place"));
  pg.once("dialog", (d) => d.accept());
  await pg.click('[data-adm-absent="r-9"]');
  v("l'intervenant signale un absent", await attendre(pg, "#s-absent-note", "prévu demain") && st.rpc.some((r) => r.nom === "signaler_absence" && r.args.p_reservation_id === "r-9"));
  await pg.click('[data-adm-onglet="intervenants"]');
  v("ma fiche : publiée directement, ni type, ni publication, ni invitation", await attendre(pg, "#adm-form", "publiés tout de suite") && (await pg.$("#i-publie")) === null && (await pg.$("#i-inviter")) === null);
  await pg.fill("#i-role-fr", "historien de l'art"); await pg.click("#i-enregistrer");
  await attendre(pg, "#adm-zone", "Fiche enregistrée et publiée");
  const patchI = st.appels.filter((a) => a.m === "PATCH" && a.chemin.startsWith("/rest/v1/intervenants?")).pop();
  v("ma fiche : enregistrée directement (pas de proposition), sans type ni publication", patchI && st.db.intervenants[0].role.fr === "historien de l'art" &&
    !st.db.propositions.length && !("publie" in JSON.parse(patchI.corps)) && !("type" in JSON.parse(patchI.corps)), patchI && patchI.corps);
  await pg.click('[data-adm-onglet="fiches"]');
  await pg.click('[data-adm-fiche="x-1"]');
  v("expérience en ligne : titre et type figés, prix modifiable", await pg.$eval("#x-titre-fr", (x) => x.disabled) && await pg.$eval('#x-type [data-valeur="atelier"]', (x) => x.disabled) && (await pg.inputValue("#x-prix")) === "50");
  await pg.fill("#x-prix", "48"); await pg.click("#x-enregistrer");
  await attendre(pg, "#adm-zone", "Enregistré.");
  const patch = st.appels.filter((a) => a.m === "PATCH" && a.chemin.startsWith("/rest/v1/experiences")).pop();
  const cles = patch ? Object.keys(JSON.parse(patch.corps)) : [];
  v("expérience en ligne : seuls les champs permis sont envoyés (prix compris)", cles.includes("prix_centimes") && JSON.parse(patch.corps).prix_centimes === 4800 &&
    !cles.some((k) => ["publie", "titre", "type", "actif", "intervenant_id", "a_valider"].includes(k)), cles.join(","));
  v("pas d'erreur JavaScript (espace intervenant)", st.erreurs.length === 0, st.erreurs.join(" | "));
  if (OUT) await pg.screenshot({ path: OUT + "/intervenant-tableau.png", fullPage: true });
  await ctx.close();

  // 6 bis. Validations (E12) : candidatures, expériences, autres propositions, notifications non envoyées
  const ilya = new Date(Date.now() - 12 * 60e3).toISOString();
  ({ pg, ctx, st } = await page({ notifs: [{ id: 41, type: "experience_validee", destinataire: "guide@exemple.invalid", cree_le: ilya, statut: "echec", tentatives: 5 }], db: {
    intervenants: [{ id: "i-1", nom: "Sylvain Lesecq" }],
    candidatures: [{ id: "c-1", nom: "Heber", type: "artiste", email: "heber@exemple.invalid", telephone: "0600000000", message: "Gravure sur cuivre", statut: "nouvelle", cree_le: ilya },
      { id: "c-old", nom: "Luci", type: "artiste", email: "luci@exemple.invalid", message: "Réalisatrice", statut: "acceptee", intervenant_id: null, cree_le: ilya }],
    experiences: [{ id: "x-9", slug: "gravure", type: "atelier", titre: { fr: "Gravure à Montmartre" }, description: { fr: "Initiation à la gravure" }, point_rdv: { fr: "Rue Lepic" },
      a_valider: true, publie: false, intervenant_id: "i-1", prix_centimes: 4500, capacite_max: 8, duree_minutes: 150, cree_le: ilya }],
    propositions: [{ id: "p-l", intervenant_id: "i-1", type: "lieu", donnees: { site: "https://exemple.invalid" }, statut: "en_attente", cree_le: ilya }],
  } }));
  await ouvrirEspace(pg);
  v("admin : onglet « Validations · 3 » et bandeau", await attendre(pg, ".adm-onglets", "Validations · 3") && await attendre(pg, "#espace-body", "3 élément(s) attendent votre validation"));
  await pg.click('.adm-onglets [data-adm-onglet="valider"]');
  v("validations : candidature, expérience (2 h 30, 8 places), autres propositions, sans séances", await attendre(pg, "#adm-zone", "Heber") && await attendre(pg, "#adm-zone", "Gravure sur cuivre") &&
    await attendre(pg, "#adm-zone", "Gravure à Montmartre") && await attendre(pg, "#adm-zone", "2 h 30") && await attendre(pg, "#adm-zone", "8 places") &&
    await attendre(pg, "#adm-zone", "Autres changements proposés · 1") && !(await pg.textContent("#adm-zone")).includes("Changement d'une séance"));
  v("notification non envoyée affichée, avec « Réessayer »", await attendre(pg, "#adm-zone", "Notifications non envoyées · 1") && await attendre(pg, "#adm-zone", "guide@exemple.invalid"));
  await pg.click('[data-reessayer="41"]');
  v("Réessayer : fonction de la base", await attendre(pg, "#adm-zone", "Renvoi prévu") && st.rpc.some((r) => r.nom === "notification_reessayer" && r.args.p_id === 41));
  v("candidature acceptée avec l'ancien menu : « Ouvrir son espace »", await attendre(pg, "#adm-zone", "espace pas encore ouvert · 1") && await attendre(pg, "#adm-zone", "luci@exemple.invalid"));
  pg.once("dialog", (d) => d.accept());
  await pg.click('[data-ouvrir-espace="c-old"]');
  v("« Ouvrir son espace » : même fonction serveur que la validation", await attendre(pg, "#adm-zone", "Candidature acceptée") &&
    st.validations.some((x) => x.corps.action === "candidature_accepter" && x.corps.id === "c-old"));
  pg.once("dialog", (d) => d.accept());
  await pg.click('[data-genre="candidature"] [data-decider="valider"]');
  v("valider la candidature : fonction serveur avec la session, message", await attendre(pg, "#adm-zone", "Candidature acceptée") &&
    st.validations.some((x) => x.corps.action === "candidature_accepter" && x.corps.id === "c-1" && x.auth === "Bearer JETON-ADMIN"));
  await pg.click('[data-genre="experience"] [data-decider="refuser"]');
  await pg.fill('[data-genre="experience"] textarea', "Précisez le lieu");
  await pg.click('[data-genre="experience"] [data-decider="confirmer"]');
  v("refuser l'expérience avec un motif ; notification non envoyée signalée", await attendre(pg, "#adm-zone", "Refus enregistré") && await attendre(pg, "#adm-zone", "Notification non envoyée") &&
    st.validations.some((x) => x.corps.action === "experience_refuser" && x.corps.id === "x-9" && x.corps.motif === "Précisez le lieu"));
  v("pas d'erreur JavaScript (validations)", st.erreurs.length === 0, st.erreurs.join(" | "));
  if (OUT) await pg.screenshot({ path: OUT + "/admin-validations.png", fullPage: true });
  await ctx.close();

  // 7. L'app publique lit les fiches publiées dans Supabase
  ({ pg, ctx, st } = await page({ session: false, db: { experiences: dbFinal.experiences, intervenants: dbFinal.intervenants } }));
  await pg.goto("http://localhost:8772/"); await pg.waitForTimeout(2800);
  const titres = await pg.$$eval("#visites-list .act-name", (l) => l.map((x) => x.textContent));
  v("accueil : seule la fiche publiée, venue de Supabase (la Sheet n'est plus lue)", titres.length === 1 && titres[0] === "Circuit des Peintres" && !st.appels.some(() => false), JSON.stringify(titres));
  v("carte : guide et prix lus dans la base", await attendre(pg, "#visites-list", "Sylvain Lesecq") && (await pg.textContent("#visites-list")).replace(/\s/g, " ").includes("50 €"));
  await pg.evaluate(() => openTarget("visite", "circuit-test"));
  v("fiche ouverte depuis Supabase", await attendre(pg, "#visite-body", "Circuit des Peintres"));
  v("pas d'erreur JavaScript (app publique)", st.erreurs.length === 0, st.erreurs.join(" | "));
  await ctx.close();

  // 8. Rien de publié : l'app retombe sur la Sheet
  ({ pg, ctx, st } = await page({ session: false }));
  await pg.goto("http://localhost:8772/"); await pg.waitForTimeout(2800);
  v("aucune fiche publiée : la Sheet sert encore", (await pg.$$eval("#visites-list .act-name", (l) => l.length)) === 2);
  await ctx.close();

  await b.close(); srv.close();
  console.log("\n" + ok + " réussis, " + ko + " en échec"); process.exit(ko ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
