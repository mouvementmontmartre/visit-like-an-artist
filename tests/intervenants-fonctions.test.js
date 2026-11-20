/* Banc d'essai du lot du 22/11 : connexion unique par code, Mon compte,
   parcours intervenant (candidature, expérience, séances), validations,
   notifications. Supabase = vraie base PostgreSQL locale (service_role,
   et « authenticated » pour jouer l'intervenant) ; Supabase Auth, Brevo
   = faux serveurs en mémoire.
   node tests/intervenants-fonctions.test.js <dépôt> <base> */
const path = require("path");
const { Client } = require("pg");

const DEPOT = process.argv[2];
const DB = process.argv[3] || "neuf";
const db = new Client({ host: "localhost", user: "sbadmin", password: "x", database: DB });
process.env.SUPABASE_SECRET_KEY = "sb_secret_faux";
process.env.BREVO_API_KEY = "brevo-faux";
process.env.SITE_URL = "https://artdive.app";
delete process.env.NOTIFY_EMAIL;

let ok = 0, ko = 0;
const v = (nom, cond, detail) => { if (cond) { ok++; console.log("OK     " + nom); } else { ko++; console.log("ÉCHEC  " + nom + (detail !== undefined ? "  → " + String(typeof detail === "string" ? detail : JSON.stringify(detail)).slice(0, 400) : "")); } };

async function sql(q, args, role) {
  await db.query("begin");
  await db.query("set local role " + (role || "service_role"));
  try { const r = await db.query(q, args); await db.query("commit"); return r; }
  catch (e) { await db.query("rollback"); throw e; }
}
/** Requête jouée par une personne connectée (règles RLS et gardes de la base). */
async function comme(uid, q, args) {
  await db.query("begin");
  await db.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ role: "authenticated", sub: uid })]);
  await db.query("set local role authenticated");
  try { const r = await db.query(q, args); await db.query("commit"); return r; }
  catch (e) { await db.query("rollback"); throw e; }
}
const ligne = async (q, a) => (await db.query(q, a)).rows[0];

/* ---------- faux PostgREST (tables simples) et rpc ---------- */
const brevo = [];
let brevoEnPanne = false;
const authAppels = [];
async function rest(u, init, corps) {
  let m;
  if ((m = u.pathname.match(/^\/rest\/v1\/rpc\/(\w+)$/))) {
    const noms = Object.keys(corps || {});
    const appelSql = "public." + m[1] + "(" + noms.map((n, i) => n + " => $" + (i + 1)).join(", ") + ")";
    // Fonctions qui rendent des lignes (setof) : un tableau d'objets, comme PostgREST.
    const q = ["envois_a_traiter"].includes(m[1]) ? "select coalesce(jsonb_agg(to_jsonb(t)), '[]') as r from " + appelSql + " t" : "select " + appelSql + " as r";
    try { const r = await sql(q, noms.map((n) => corps[n])); return [200, r.rows[0].r]; }
    catch (e) { return [400, { message: e.message }]; }
  }
  if ((m = u.pathname.match(/^\/rest\/v1\/(\w+)$/))) {
    const t = m[1], filtres = [], args = [];
    for (const [k, val] of u.searchParams) {
      if (["select", "order", "limit", "on_conflict"].includes(k)) continue;
      const f = val.match(/^(eq|neq|gt|lt|is)\.(.*)$/);
      if (!f) continue;
      if (f[1] === "is") { filtres.push(k + " is " + (f[2] === "null" ? "null" : "not null")); continue; }
      args.push(f[2]); filtres.push(k + " " + { eq: "=", neq: "<>", gt: ">", lt: "<" }[f[1]] + " $" + args.length);
    }
    const ou = filtres.length ? " where " + filtres.join(" and ") : "";
    const cols = (u.searchParams.get("select") || "*").replace(/[^a-z_,*]/g, "");
    try {
      if (init.method === "GET" || !init.method) return [200, (await sql("select " + cols + " from public." + t + ou, args)).rows];
      if (init.method === "POST") {
        const lignes = Array.isArray(corps) ? corps : [corps], res = [];
        for (const l of lignes) {
          const k = Object.keys(l);
          const r = await sql("insert into public." + t + " (" + k.join(", ") + ") values (" + k.map((_, i) => "$" + (i + 1)).join(", ") + ") returning *",
            k.map((x) => (l[x] !== null && typeof l[x] === "object" ? JSON.stringify(l[x]) : l[x])));
          res.push(r.rows[0]);
        }
        return [201, /return=representation/.test(init.headers.Prefer || "") ? res : null];
      }
      if (init.method === "PATCH") {
        const k = Object.keys(corps);
        await sql("update public." + t + " set " + k.map((x, i) => x + " = $" + (args.length + i + 1)).join(", ") + ou, args.concat(k.map((x) => corps[x])));
        return [204, null];
      }
    } catch (e) { return [400, { message: e.message }]; }
  }
  return [404, { message: "inconnu " + u.pathname }];
}

/* ---------- faux Supabase Auth ---------- */
async function auth(u, init, corps) {
  authAppels.push({ m: init.method || "GET", chemin: u.pathname, corps });
  if (u.pathname === "/auth/v1/user") {
    const j = String(init.headers.Authorization || "").replace("Bearer ", "");
    const r = await db.query("select id, email from auth.users where 'session-' || id::text = $1", [j]);
    return r.rows[0] ? [200, r.rows[0]] : [401, {}];
  }
  if (u.pathname === "/auth/v1/admin/users" && init.method === "POST") {
    const deja = await db.query("select id from auth.users where lower(email) = lower($1)", [corps.email]);
    if (deja.rows[0]) return [422, { error_code: "email_exists" }];
    const r = await db.query("insert into auth.users (email) values (lower($1)) returning id", [corps.email]);
    return [200, { id: r.rows[0].id, email: corps.email }];
  }
  if ((m = u.pathname.match(/^\/auth\/v1\/admin\/users\/([0-9a-f-]{36})$/)) && init.method === "DELETE") {
    await db.query("delete from auth.users where id = $1", [m[1]]); return [200, {}];
  }
  if (u.pathname === "/auth/v1/admin/generate_link") {
    const r = await db.query("select id from auth.users where lower(email) = lower($1)", [corps.email]);
    if (!r.rows[0]) return [404, {}];
    return [200, { id: r.rows[0].id, email: corps.email, hashed_token: "hash-" + r.rows[0].id, action_link: "https://x/verify" }];
  }
  if (u.pathname === "/auth/v1/verify") {
    const id = String(corps.token_hash || "").replace("hash-", "");
    return [200, { access_token: "session-" + id, refresh_token: "r-" + id, expires_in: 3600, user: { id } }];
  }
  return [404, {}];
}
var m;
global.fetch = async (url, init = {}) => {
  init.headers = init.headers || {};
  const u = new URL(url), corps = init.body ? JSON.parse(init.body) : null;
  const reponse = (status, data) => ({ ok: status < 300, status, json: async () => data, text: async () => (data == null ? "" : JSON.stringify(data)) });
  if (u.hostname === "api.brevo.com") {
    if (brevoEnPanne) return reponse(500, { message: "panne" });
    brevo.push(corps); return reponse(201, { messageId: "m" + brevo.length });
  }
  if (u.hostname === "mepcwassmoespzzsdjxf.supabase.co") {
    if (init.headers.apikey !== "sb_secret_faux" && u.pathname !== "/auth/v1/user") return reponse(401, {});
    const [s, d] = u.pathname.startsWith("/auth/") ? await auth(u, init, corps) : await rest(u, init, corps);
    return reponse(s, d);
  }
  throw new Error("Appel réseau inattendu : " + url);
};

const fn = (n) => require(path.join(DEPOT, "netlify/functions/" + n + ".js")).handler;
const carte = fn("carte"), validations = fn("validations"), demande = fn("demande"), reservation = fn("reservation");
const { traiterEnvois } = require(path.join(DEPOT, "netlify/lib/reservations.js"));
const appel = async (h, corps, jeton) => {
  const r = await h({ httpMethod: "POST", body: JSON.stringify(corps), headers: jeton ? { authorization: "Bearer " + jeton } : {} });
  return { status: r.statusCode, d: JSON.parse(r.body) };
};
const dernierMail = (a) => brevo.filter((x) => x.to[0].email === a).slice(-1)[0];
const codeDe = (mail) => (mail.subject.match(/(\d{6})/) || [])[1];
const lienDe = (mail) => (mail.htmlContent.match(/#connexion=([A-Za-z0-9_-]{43})/) || [])[1];

(async () => {
  await db.connect();
  // Ménage des essais précédents (adresses @exemple.invalid seulement).
  await db.query("delete from public.envois where destinataire like '%@exemple.invalid' or donnees->>'repondre_a' like '%@exemple.invalid'");
  await db.query("delete from public.reservations where email like '%@exemple.invalid'");
  await db.query("delete from public.seances where experience_id in (select id from public.experiences where titre->>'fr' like 'Essai 22/11%')");
  await db.query("delete from public.experiences where titre->>'fr' like 'Essai 22/11%'");
  await db.query("delete from public.candidatures where email like '%@exemple.invalid'");
  await db.query("delete from public.profils where user_id in (select id from auth.users where email like '%@exemple.invalid')");
  await db.query("delete from public.intervenants where nom like 'Essai %'");
  await db.query("delete from auth.users where email like '%@exemple.invalid'");
  await db.query("delete from public.codes_carte where email like '%@exemple.invalid'");
  await db.query("delete from public.cartes_liens where email like '%@exemple.invalid'");
  await db.query("delete from public.adhesions where email like '%@exemple.invalid'");
  const admin = (await db.query("insert into auth.users (email) values ('admin22@exemple.invalid') returning id")).rows[0].id;
  await db.query("insert into public.profils (user_id, role) values ($1, 'admin')", [admin]);
  const SESSION_ADMIN = "session-" + admin;
  await db.query("insert into public.adhesions (email, nom, source, debut, valide_jusqua) values ('camille22@exemple.invalid', 'Camille Durand', 'manuelle', now() - interval '1 day', now() + interval '200 days')");

  // 1. « Nous rejoindre » : enregistrée, puis alerte à l'association par la file.
  let r = await appel(demande, { formulaire: "rejoindre", type: "artiste", nom: "Essai Heber", email: "heber@exemple.invalid", message: "Gravure", duree_ms: 8000 });
  const cand = await ligne("select * from public.candidatures where email = 'heber@exemple.invalid'");
  let mail = dernierMail("mouvementmontmartre@gmail.com");
  v("candidature enregistrée, alerte à l'association (Répondre → candidat, lien Validations)", r.status === 200 && cand &&
    mail && mail.replyTo.email === "heber@exemple.invalid" && mail.htmlContent.includes("#espace=valider"), mail && mail.subject);

  // 2. Validation de la candidature : compte, fiche, profil, email d'accès avec lien de connexion.
  r = await appel(validations, { action: "candidature_accepter", id: cand.id }, "session-00000000-0000-0000-0000-000000000000");
  v("validations : session inconnue refusée", r.status === 403);
  r = await appel(validations, { action: "candidature_accepter", id: cand.id }, SESSION_ADMIN);
  const prof = await ligne("select p.*, i.publie, i.nom from public.profils p join auth.users u on u.id = p.user_id join public.intervenants i on i.id = p.intervenant_id where u.email = 'heber@exemple.invalid'");
  mail = dernierMail("heber@exemple.invalid");
  v("candidature acceptée : intervenant (non publié), profil, email d'accès envoyé", r.status === 200 && r.d.notifie === true && prof && prof.role === "intervenant" && !prof.publie &&
    mail && /espace intervenant/.test(mail.subject) && !!lienDe(mail), r.d);
  const heber = (await ligne("select id from auth.users where email = 'heber@exemple.invalid'")).id, iHeber = prof.intervenant_id;
  r = await appel(validations, { action: "candidature_accepter", id: cand.id }, SESSION_ADMIN);
  v("deuxième clic : rien en double", r.status === 200 && r.d.deja === true && (await ligne("select count(*)::int n from public.intervenants where nom = 'Essai Heber'")).n === 1);

  // 3. Connexion par le lien de l'email (7 jours, une fois).
  const lien = lienDe(mail);
  r = await appel(carte, { action: "connexion", jeton: lien });
  v("lien d'accès : session de l'espace, pas de carte (non adhérent)", r.status === 200 && r.d.session && r.d.session.access_token === "session-" + heber && r.d.role === "intervenant" && !r.d.carte, r.d);
  r = await appel(carte, { action: "connexion", jeton: lien });
  v("le même lien ne sert pas deux fois", r.status === 410 && r.d.code === "UTILISE");

  // 4. Connexion par code : intervenant (session), adhérent (carte), inconnu (même réponse).
  r = await appel(carte, { action: "email", email: "heber@exemple.invalid", langue: "fr" });
  mail = dernierMail("heber@exemple.invalid");
  v("code envoyé à un intervenant non adhérent", r.status === 200 && codeDe(mail) && /connecter/.test(mail.htmlContent));
  r = await appel(carte, { action: "code", email: "heber@exemple.invalid", code: codeDe(mail) });
  v("code bon : session de l'espace", r.status === 200 && r.d.session && r.d.role === "intervenant" && !r.d.jeton, r.d);
  const nAvant = brevo.length;
  r = await appel(carte, { action: "email", email: "personne@exemple.invalid", langue: "fr" });
  v("adresse inconnue : même réponse, aucun email", r.status === 200 && brevo.length === nAvant);
  r = await appel(carte, { action: "email", email: "camille22@exemple.invalid", langue: "en" });
  mail = dernierMail("camille22@exemple.invalid");
  r = await appel(carte, { action: "code", email: "camille22@exemple.invalid", code: codeDe(mail) });
  const jetonCamille = r.d.jeton;
  v("code bon pour une adhérente : sa carte, pas de session", r.status === 200 && jetonCamille && r.d.carte && !r.d.session, r.d);

  // 5. L'intervenant décrit son expérience (E11.6) : à valider, alerte à l'association.
  await comme(heber, "insert into public.experiences (type, titre, description, prix_centimes, capacite_max, duree_minutes, langues) values ('atelier', '{\"fr\":\"Essai 22/11 Gravure\"}', '{\"fr\":\"Initiation\"}', 4500, 8, 150, '{fr,en}')");
  const x = await ligne("select * from public.experiences where titre->>'fr' = 'Essai 22/11 Gravure'");
  v("expérience à valider, prix net 45 €, sans pré-réservation", x && x.a_valider && !x.publie && x.prix_centimes === 4500 && x.prereservation_centimes === 0 && x.intervenant_id === iHeber, x);
  process.env.NOTIFY_EMAIL = "alertes22@exemple.invalid";
  await traiterEnvois(50);
  mail = dernierMail("alertes22@exemple.invalid");
  v("alerte « nouvelle expérience » envoyée à NOTIFY_EMAIL, Répondre → intervenant, durée « 2 h 30 »", mail && /Nouvelle expérience à valider/.test(mail.subject) &&
    mail.replyTo.email === "heber@exemple.invalid" && mail.htmlContent.includes("2 h 30") && mail.htmlContent.includes("#espace=valider"), mail && mail.subject);
  delete process.env.NOTIFY_EMAIL;
  let err = null;
  try { await comme(heber, "insert into public.seances (experience_id, debut, statut) values ($1, now() + interval '20 days', 'publiee')", [x.id]); } catch (e) { err = e.message; }
  v("pas de séance publiée avant la validation", /validée/.test(err || ""), err);

  // 6. Refus avec motif, correction, renvoi, puis validation (E9.7).
  r = await appel(validations, { action: "experience_refuser", id: x.id, motif: "Précisez le lieu" }, SESSION_ADMIN);
  mail = dernierMail("heber@exemple.invalid");
  v("refus : email à l'intervenant avec le motif et un lien pour corriger", r.status === 200 && mail && /à revoir/.test(mail.subject) && mail.htmlContent.includes("Précisez le lieu") && !!lienDe(mail));
  await comme(heber, "update public.experiences set point_rdv = '{\"fr\":\"Rue Lepic\"}', a_valider = true, refusee_le = null, motif_refus = null where id = $1", [x.id]);
  await traiterEnvois(50);
  mail = dernierMail("mouvementmontmartre@gmail.com");
  v("renvoyée : l'association est de nouveau prévenue", mail && /corrigée/.test(mail.subject));
  r = await appel(validations, { action: "experience_valider", id: x.id }, SESSION_ADMIN);
  mail = dernierMail("heber@exemple.invalid");
  v("validée : email E9.7 « Créez votre première séance », lien direct vers la séance", r.status === 200 && r.d.notifie === true && /est validée/.test(mail.subject) &&
    mail.htmlContent.includes("Créer ma première séance") && /#connexion=[A-Za-z0-9_-]{43}&amp;vers=seance/.test(mail.htmlContent), mail && mail.subject);
  v("en ligne, fiche de l'intervenant publiée", (await ligne("select e.publie and not e.a_valider and i.publie as ok from public.experiences e join public.intervenants i on i.id = e.intervenant_id where e.id = $1", [x.id])).ok);

  // 7. Séances publiées directement (deux d'un coup) : un seul email d'information.
  await comme(heber, "insert into public.seances (experience_id, debut, fin, statut, capacite_max, participants_min, prix_centimes, point_rdv) values " +
    "($1, now() + interval '10 hours', now() + interval '12 hours 30 minutes', 'publiee', 8, 2, 4000, 'Rue Lepic'), ($1, now() + interval '8 days', now() + interval '8 days 2 hours', 'publiee', 8, 2, 4000, 'Rue Lepic')", [x.id]);
  await db.query("update public.envois set cree_le = now() - interval '3 minutes' where type = 'alerte_seances_publiees'");
  await traiterEnvois(50);
  const alertes = brevo.filter((b) => /séances publiées par Essai Heber/.test(b.subject));
  v("un seul email pour les 2 séances publiées", alertes.length === 1 && /2 séances/.test(alertes[0].subject) && /40(,00)?\s?€ par personne/.test(alertes[0].htmlContent) && alertes[0].htmlContent.includes("2 h 30"), alertes.map((a) => a.subject));
  const sProche = await ligne("select * from public.seances where experience_id = $1 order by debut limit 1", [x.id]);
  const pub = await ligne("select * from public.seances_publiques where id = $1", [sProche.id]);
  v("le visiteur voit le prix net de la séance (40 €), réservée aux adhérents", pub && pub.prix_centimes === 4000 && pub.reservee_adherents, pub);

  // 8. Réservation de l'adhérente, puis Mon compte (E15.2).
  const resa = (await sql("select public.reserver_places($1, 2, 'Camille Durand', 'camille22@exemple.invalid', '0600000000', 'fr', '{\"conditions\":true}', '2026-11-21') as r", [sProche.id])).rows[0].r;
  await sql("select public.confirmer_reservation($1, null, null, 0, 'cus_x', 'pm_x', null)", [resa.reservation_id]);
  r = await appel(carte, { action: "reservations", jeton: jetonCamille });
  const liste = r.d.reservations || [];
  v("Mon compte : la réservation à venir (titre, intervenant, 2 personnes)", r.status === 200 && liste.length === 1 && liste[0].titre.fr === "Essai 22/11 Gravure" &&
    liste[0].intervenant === "Essai Heber" && liste[0].personnes === 2 && liste[0].type === "atelier", liste);
  r = await appel(carte, { action: "reservations", jeton: "x".repeat(43) });
  v("Mon compte : un autre jeton ne voit rien", r.status === 200 && r.d.reservations.length === 0);
  r = await appel(carte, { action: "ouvrir", jeton: jetonCamille, reservation_id: resa.reservation_id });
  const jetonResa = r.d.jeton;
  v("« Voir » : lien personnel de la réservation", r.status === 200 && /^[0-9a-f]{64}$/.test(jetonResa || ""), r.d);
  r = await appel(carte, { action: "ouvrir", jeton: "x".repeat(43), reservation_id: resa.reservation_id });
  v("« Voir » refusé avec la carte de quelqu'un d'autre", r.status === 404);
  r = await appel(reservation, { action: "voir", jeton: jetonResa });
  v("à moins de 24 h : annulation tardive (avant tout changement)", r.status === 200 && r.d.reservation.annulation_tardive === true && !r.d.reservation.seance_modifiee, r.d.reservation);

  // 9. L'intervenant change le lieu : l'inscrite est prévenue et peut annuler sans frais.
  await comme(heber, "update public.seances set point_rdv = 'Place des Abbesses', langue = 'en' where id = $1", [sProche.id]);
  await traiterEnvois(50);
  mail = brevo.filter((x) => x.to[0].email === "camille22@exemple.invalid" && /Changement/.test(x.subject)).slice(-1)[0];
  v("séance modifiée : email à l'inscrite (sa langue), avant / après, bouton pour annuler", mail && /Changement pour votre réservation/.test(mail.subject) &&
    mail.htmlContent.includes("Place des Abbesses") && mail.htmlContent.includes("Rue Lepic") && mail.htmlContent.includes("anglais") && /#reservation=[0-9a-f]{64}/.test(mail.htmlContent), mail && mail.subject);
  r = await appel(reservation, { action: "voir", jeton: jetonResa });
  v("après le changement : annulation sans frais même à moins de 24 h", r.d.reservation.seance_modifiee === true && r.d.reservation.annulation_tardive === false && r.d.reservation.frais_si_annulation_centimes === 0, r.d.reservation);
  r = await appel(reservation, { action: "annuler", jeton: jetonResa });
  const annulee = await ligne("select statut, frais_centimes from public.reservations where id = $1", [resa.reservation_id]);
  v("annulée sans frais", annulee.statut === "annulee" && annulee.frais_centimes === 0, annulee);

  // 10. Notification qui échoue : la décision reste enregistrée, l'email reste en file.
  await db.query("insert into public.candidatures (type, nom, email, message) values ('guide', 'Essai Refus', 'refus22@exemple.invalid', 'Visites')");
  const c2 = await ligne("select id from public.candidatures where email = 'refus22@exemple.invalid'");
  brevoEnPanne = true;
  r = await appel(validations, { action: "candidature_refuser", id: c2.id, motif: "Hors Montmartre" }, SESSION_ADMIN);
  brevoEnPanne = false;
  const env = await ligne("select statut, tentatives, erreur from public.envois where cible_id = $1", [c2.id]);
  v("Brevo en panne : refus enregistré, « notification non envoyée », email gardé en file", r.status === 200 && r.d.notifie === false &&
    (await ligne("select statut from public.candidatures where id = $1", [c2.id])).statut === "refusee" && env.statut === "a_envoyer" && env.tentatives === 1 && /Brevo 500/.test(env.erreur), env);
  await traiterEnvois(50);
  mail = dernierMail("refus22@exemple.invalid");
  v("au prochain passage, l'email part (motif compris)", mail && mail.htmlContent.includes("Hors Montmartre"));

  // 11. Suppression d'un intervenant.
  await sql("select public.reserver_places($1, 1, 'Zoé', 'camille22@exemple.invalid', '0600000000', 'fr', '{\"conditions\":true}', '2026-11-21') as r", [
    (await ligne("select id from public.seances where experience_id = $1 order by debut desc limit 1", [x.id])).id]).then(async (q) =>
    sql("select public.confirmer_reservation($1, null, null, 0, 'cus_x', 'pm_x', null)", [q.rows[0].r.reservation_id]));
  r = await appel(validations, { action: "intervenant_supprimer", id: iHeber }, SESSION_ADMIN);
  v("suppression refusée tant qu'une séance à venir a des inscrits", r.status === 409 && r.d.error === "SEANCES_AVEC_INSCRITS", r.d);
  await db.query("update public.reservations set statut = 'annulee', annulee_le = now(), annulee_par = 'client' where email = 'camille22@exemple.invalid' and statut = 'confirmee'");
  r = await appel(validations, { action: "intervenant_supprimer", id: iHeber }, SESSION_ADMIN);
  v("intervenant supprimé : fiche, profil et compte de connexion", r.status === 200 && !(await ligne("select 1 from public.intervenants where id = $1", [iHeber])) &&
    !(await ligne("select 1 from auth.users where id = $1", [heber])) && authAppels.some((a) => a.m === "DELETE" && a.chemin.endsWith(heber)), r.d);
  v("ses expériences sont retirées de l'app, gardées pour l'historique", (await ligne("select publie, intervenant_id from public.experiences where id = $1", [x.id])).publie === false);
  r = await appel(validations, { action: "intervenant_supprimer", id: iHeber }, "session-" + heber);
  v("un intervenant ne peut pas supprimer", r.status === 403);

  console.log("\n" + ok + " réussis, " + ko + " en échec");
  await db.end();
  process.exit(ko ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
