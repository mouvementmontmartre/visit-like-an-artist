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
          return rep(200, tab === "rpc/annuler_seance" ? { inscrits: 1 } : tab === "rpc/signaler_absence" ? { frais_centimes: 1000 } : tab === "rpc/valider_proposition" ? { inscrits_a_prevenir: 0 } : {}); }
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
        if (m === "POST") {
          if (tab === "experiences" && d.publie && st.refusPublier) return rep(400, { code: "23514", message: 'new row violates check constraint "experiences_prix_complets"' });
          const cle = u.searchParams.get("on_conflict");
          const ex = cle ? db[tab].find((l) => l[cle] === d[cle]) : null;
          if (ex) { Object.assign(ex, d); return rep(201, [ex]); }
          const ligne = Object.assign({ id: uid(), actif: true, a_valider: false, publie: false, titre: {}, langues: ["fr"] }, tab === "propositions" ? { statut: "en_attente", cree_le: new Date().toISOString() } : {}, d);
          db[tab].push(ligne); return rep(201, [ligne]);
        }
        if (m === "PATCH") {
          if (tab === "experiences" && d.publie && st.refusPublier) return rep(400, { code: "23514", message: 'new row violates check constraint "experiences_prix_complets"' });
          const lignes = db[tab].filter(garde); lignes.forEach((l) => Object.assign(l, d)); return rep(200, lignes);
        }
        return rep(200, []);
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
  v("le guide de la Sheet devient un intervenant (non publié) relié à la fiche", sylvain && sylvain.publie === false && circuit.intervenant_id === sylvain.id);
  v("soirée reprise en soirée, sans pré-réservation", soiree && soiree.type === "soiree" && soiree.prereservation_centimes === null && soiree.prix_centimes === 2500);
  v("toutes les écritures avec la session de l'admin", st.appels.filter((a) => a.m !== "GET" && a.chemin.startsWith("/rest/")).every((a) => a.auth === "Bearer JETON-ADMIN"));
  v("plus de proposition de reprise une fois faite", (await pg.$("#adm-reprendre")) === null);
  v("liste : 2 brouillons", (await pg.$$eval(".adm-etat-brouillon", (l) => l.length)) === 2);

  // 2. Compléter et publier une fiche, avec photo
  await pg.click('[data-adm-fiche="' + circuit.id + '"]');
  v("formulaire de la fiche ouvert, champs remplis", await attendre(pg, "#adm-form", "Circuit des Peintres") && (await pg.inputValue("#f-prix")) === "50" && (await pg.inputValue("#f-titre-fr")) === "Circuit des Peintres");
  await pg.setInputFiles("#f-photo-fichier", { name: "photo.png", mimeType: "image/png", buffer: PNG });
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
  v("la séance reprend les places de la fiche", (await pg.inputValue("#s-max")) === "10" && (await pg.inputValue("#s-min")) === "4" && (await pg.inputValue("#s-rdv")) === "Square Suzanne Buisson");
  const demain = new Date(Date.now() + 3 * 864e5).toLocaleDateString("sv-SE", { timeZone: "Europe/Paris" });
  await pg.fill("#s-jour", demain); await pg.fill("#s-heure", "10:00"); await pg.check("#s-publiee");
  await pg.click("#s-enregistrer");
  await attendre(pg, "#adm-zone", "Enregistré.");
  const sea = st.db.seances[0];
  const hParis = sea && new Date(sea.debut).toLocaleTimeString("en-GB", { timeZone: "Europe/Paris", hour: "2-digit", minute: "2-digit" });
  v("séance créée en ligne, à 10 h heure de Paris", sea && sea.statut === "publiee" && sea.experience_id === circuit.id && hParis === "10:00" && sea.capacite_max === 10, JSON.stringify(sea));
  // une séance commencée hier avec deux inscrits
  st.db.seances.push({ id: "sea-hier", experience_id: circuit.id, debut: new Date(Date.now() - 864e5).toISOString(), langue: "fr", capacite_max: 10, participants_min: 2, statut: "publiee" });
  st.db.reservations.push({ id: "r1", seance_id: "sea-hier", reference: "AD-AAAAAA", nom: "Camille D.", email: "c@exemple.invalid", personnes: 2, statut: "confirmee", frais_centimes: 0, frais_statut: "aucun" },
    { id: "r2", seance_id: "sea-hier", reference: "AD-BBBBBB", nom: "Léo M.", email: "l@exemple.invalid", personnes: 1, statut: "annulee", frais_centimes: 1000, frais_statut: "preleve" });
  await pg.click('[data-adm-onglet="seances"]');
  await pg.click('[data-adm-seance="sea-hier"]');
  v("inscrits de la séance, avec les frais", await attendre(pg, "#adm-form", "Inscrits : 2 personne(s)") && await attendre(pg, "#adm-form", "AD-BBBBBB") && await attendre(pg, "#adm-form", "prélevés"));
  v("date figée quand il y a des inscrits", await pg.$eval("#s-jour", (x) => x.disabled));
  pg.once("dialog", (d) => d.accept());
  await pg.click('[data-adm-absent="r1"]');
  v("absence signalée par la fonction de la base, frais annoncés", await attendre(pg, "#s-absent-note", "Frais de 10") && st.rpc.some((r) => r.nom === "signaler_absence" && r.args.p_reservation_id === "r1" && r.auth === "Bearer JETON-ADMIN"));
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
    await attendre(pg, ".adm-onglets", "Ma fiche") && !(await pg.textContent(".adm-onglets")).includes("Adhésions"));
  await pg.click('[data-adm-seance="s-1"]');
  await pg.waitForSelector("#s-max"); await pg.fill("#s-max", "8"); await pg.click("#s-enregistrer");
  await attendre(pg, "#adm-zone", "Envoyé.");
  const propS = st.db.propositions.find((x) => x.type === "seance");
  v("séance en ligne : changement envoyé en proposition, séance intacte", propS && propS.cible_id === "s-1" && propS.donnees.capacite_max === 8 && propS.intervenant_id === "i-1" &&
    st.db.seances[0].capacite_max === 10 && !("statut" in propS.donnees), JSON.stringify(propS));
  v("note « modification en attente »", await attendre(pg, "#espace-body", "1 modification(s) en attente"));
  await pg.click("#adm-nouvelle-seance");
  await pg.selectOption("#s-exp", "x-1"); await pg.fill("#s-jour", new Date(Date.now() + 9 * 864e5).toLocaleDateString("sv-SE", { timeZone: "Europe/Paris" }));
  await pg.check("#s-publiee"); await pg.click("#s-enregistrer");
  await attendre(pg, "#adm-zone", "Enregistré.");
  v("nouvelle séance : envoyée à l'association (en attente), pas mise en ligne", st.db.seances.some((x) => x.id !== "s-1" && x.statut === "en_attente"));
  await pg.click('[data-adm-onglet="inscrits"]');
  v("mes inscrits : prénom, téléphone, reste à encaisser", await attendre(pg, "#adm-zone", "Camille D.") && await attendre(pg, "#adm-zone", "à encaisser sur place"));
  pg.once("dialog", (d) => d.accept());
  await pg.click('[data-adm-absent="r-9"]');
  v("l'intervenant signale un absent", await attendre(pg, "#s-absent-note", "Frais de 10") && st.rpc.some((r) => r.nom === "signaler_absence" && r.args.p_reservation_id === "r-9"));
  await pg.click('[data-adm-onglet="intervenants"]');
  v("ma fiche : ni type, ni publication, ni invitation", await attendre(pg, "#adm-form", "publiés après validation") && (await pg.$("#i-publie")) === null && (await pg.$("#i-inviter")) === null);
  await pg.fill("#i-role-fr", "historien de l'art"); await pg.click("#i-enregistrer");
  await attendre(pg, "#adm-zone", "Envoyé.");
  const propF = st.db.propositions.find((x) => x.type === "fiche");
  v("ma fiche : proposition envoyée, fiche intacte", propF && propF.donnees.role.fr === "historien de l'art" && !("publie" in propF.donnees) &&
    st.db.intervenants[0].role.fr === "guide" && !st.appels.some((a) => a.m === "PATCH" && a.chemin.startsWith("/rest/v1/intervenants?")), JSON.stringify(propF));
  await pg.click('[data-adm-onglet="fiches"]');
  await pg.click('[data-adm-fiche="x-1"]');
  v("ma visite : pas de prix ni de publication, titre figé (en ligne)", (await pg.$("#f-prix")) === null && (await pg.$("#f-publie")) === null && await pg.$eval("#f-titre-fr", (x) => x.disabled));
  await pg.fill("#f-duree", "150"); await pg.click("#f-enregistrer");
  await attendre(pg, "#adm-zone", "Enregistré.");
  const patch = st.appels.filter((a) => a.m === "PATCH" && a.chemin.startsWith("/rest/v1/experiences")).pop();
  const cles = patch ? Object.keys(JSON.parse(patch.corps)) : [];
  v("ma visite : seuls les champs permis sont envoyés", cles.includes("duree_minutes") && !cles.some((k) => ["prix_centimes", "publie", "titre", "type", "actif", "intervenant_id"].includes(k)), cles.join(","));
  v("pas d'erreur JavaScript (espace intervenant)", st.erreurs.length === 0, st.erreurs.join(" | "));
  const props = st.db.propositions;
  await ctx.close();

  // 6 bis. L'administration valide les propositions
  ({ pg, ctx, st } = await page({ db: { propositions: props, intervenants: [{ id: "i-1", nom: "Sylvain Lesecq" }] } }));
  await ouvrirEspace(pg);
  v("admin : onglet « À valider · 2 » en premier", await attendre(pg, ".adm-onglets", "À valider · 2"));
  await pg.click('[data-adm-onglet="valider"]');
  v("propositions détaillées", await attendre(pg, "#adm-zone", "Changement d'une séance en ligne") && await attendre(pg, "#adm-zone", "historien de l'art"));
  await pg.click('[data-valider="' + props[0].id + '"]');
  v("valider passe par la fonction de la base", await attendre(pg, "#adm-zone", "Enregistré.") && st.rpc.some((r) => r.nom === "valider_proposition" && r.args.p_id === props[0].id));
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
