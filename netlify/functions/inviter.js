/* ============================================================
   FONCTION NETLIFY — inviter
   POST { intervenant_id }, avec l'en-tête Authorization: Bearer <session>
   de l'administratrice connectée dans l'app.
   Ouvre l'espace d'un intervenant : crée son compte de connexion s'il
   n'existe pas (les inscriptions libres restent fermées), le relie à sa
   fiche (profil « intervenant ») et lui envoie par Brevo un email ArtDive
   avec un lien de connexion. Réservé à l'admin : vérifié ici à partir de
   la session, pas sur la parole de l'app.
   ============================================================ */

const { json, table, authAdmin, appelant, envoyerBrevo, emailValide, SITE_URL } = require("../lib/commun");
const { redigerInvitation } = require("../lib/emails");

const uuidValide = (x) => typeof x === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(x);

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return json(405, { error: "POST attendu" });
  let p;
  try { p = JSON.parse(event.body || "{}"); } catch (e) { return json(400, { error: "Corps invalide" }); }

  try {
    const qui = await appelant(event);
    if (!qui || qui.role !== "admin") return json(403, { error: "RESERVE_ADMIN" });
    if (!uuidValide(p.intervenant_id)) return json(400, { error: "Intervenant invalide" });

    const fiche = (await table("GET", "intervenants?select=id,nom&id=eq." + p.intervenant_id))[0];
    if (!fiche) return json(404, { error: "INTERVENANT_INCONNU" });
    const contact = (await table("GET", "intervenants_contacts?select=email&intervenant_id=eq." + p.intervenant_id))[0];
    const email = contact && String(contact.email || "").trim().toLowerCase();
    if (!emailValide(email)) return json(400, { error: "EMAIL_MANQUANT" });

    // Compte de connexion : créé s'il n'existe pas encore (email déjà confirmé : c'est l'association qui l'invite).
    const cree = await authAdmin("POST", "admin/users", { email, email_confirm: true });
    if (!cree.ok && cree.status !== 422 && cree.status !== 400) throw new Error("Création du compte : " + cree.status);

    // Lien de connexion, et identifiant du compte (nouveau ou existant).
    const lien = await authAdmin("POST", "admin/generate_link", { type: "magiclink", email, redirect_to: SITE_URL + "/" });
    if (!lien.ok || !lien.data) throw new Error("Lien de connexion : " + lien.status);
    const d = lien.data;
    const userId = d.id || (d.user && d.user.id);
    const action = d.action_link || (d.properties && d.properties.action_link);
    if (!uuidValide(userId) || !action) throw new Error("Lien de connexion incomplet");

    // Profil : un compte = un rôle. On ne transforme jamais l'admin ni le compte d'un autre intervenant.
    const profil = (await table("GET", "profils?select=role,intervenant_id&user_id=eq." + userId))[0];
    if (profil && profil.role === "admin") return json(409, { error: "COMPTE_ADMIN" });
    if (profil && profil.intervenant_id !== p.intervenant_id) return json(409, { error: "COMPTE_AUTRE_INTERVENANT" });
    const autre = (await table("GET", "profils?select=user_id&intervenant_id=eq." + p.intervenant_id))[0];
    if (autre && autre.user_id !== userId) return json(409, { error: "FICHE_DEJA_RELIEE" });
    if (!profil) await table("POST", "profils", { user_id: userId, role: "intervenant", intervenant_id: p.intervenant_id }, { Prefer: "return=minimal" });

    await envoyerBrevo(email, redigerInvitation({ nom: fiche.nom, lien: action }), ["invitation"]);
    return json(200, { ok: true, email });
  } catch (e) {
    console.error("inviter :", e.message);
    return json(500, { error: "ERREUR" });
  }
};
