/* ============================================================
   FONCTION NETLIFY — reservation
   POST { action, … } :
   - "session" { session_id } : au retour du paiement, vérifie la
     session auprès de Stripe, confirme si le webhook n'est pas encore
     passé, et renvoie un lien personnel + le récapitulatif ;
   - "voir"    { jeton }      : récapitulatif d'une réservation ;
   - "annuler" { jeton }      : « Je ne peux plus venir ».
   Le jeton (lien reçu par email) est le seul moyen d'agir sur une
   réservation ; seule son empreinte est en base.
   ============================================================ */

const { json, sha256hex, rpc, stripe } = require("../lib/commun");
const { confirmerSession, toutTraiter } = require("../lib/reservations");

const jetonValide = (j) => typeof j === "string" && /^[0-9a-f]{64}$/.test(j);

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return json(405, { error: "POST attendu" });
  let p;
  try { p = JSON.parse(event.body || "{}"); } catch (e) { return json(400, { error: "Corps invalide" }); }

  try {
    if (p.action === "session") {
      const id = String(p.session_id || "");
      if (!/^cs_(live|test)_[A-Za-z0-9]+$/.test(id)) return json(400, { error: "Session invalide" });
      const session = await stripe("checkout/sessions/" + id);
      if (!session.metadata || !session.metadata.reservation_id) return json(400, { error: "Session invalide" });
      if (Date.now() / 1000 - session.created > 24 * 3600) return json(400, { error: "Session expirée" });
      if (session.payment_status === "paid") {
        await confirmerSession(session);        // sans attendre le webhook, sans doublon
        await toutTraiter().catch(() => {});      // la confirmation part tout de suite
      }
      const lien = await rpc("lien_reservation_session", { p_stripe_session_id: id });
      if (!lien) return json(404, { error: "Réservation introuvable" });
      const resa = await rpc("reservation_par_jeton", { p_jeton_hash: sha256hex(lien.jeton) });
      return json(200, { jeton: lien.jeton, reservation: resa });
    }

    if (p.action === "voir") {
      if (!jetonValide(p.jeton)) return json(400, { error: "Lien invalide" });
      const resa = await rpc("reservation_par_jeton", { p_jeton_hash: sha256hex(p.jeton) });
      return resa ? json(200, { reservation: resa }) : json(404, { error: "Réservation introuvable" });
    }

    if (p.action === "annuler") {
      if (!jetonValide(p.jeton)) return json(400, { error: "Lien invalide" });
      let r;
      try { r = await rpc("annuler_par_client", { p_jeton_hash: sha256hex(p.jeton) }); }
      catch (e) {
        const code = ["LIEN_INVALIDE", "NON_ANNULABLE", "TROP_TARD"].find((k) => (e.message || "").includes(k));
        if (code) return json(code === "LIEN_INVALIDE" ? 404 : 409, { error: code, code });
        throw e;
      }
      await toutTraiter().catch(() => {});        // frais et emails sans attendre la tâche planifiée
      const resa = await rpc("reservation_par_jeton", { p_jeton_hash: sha256hex(p.jeton) });
      return json(200, { annulation: r, reservation: resa });
    }

    return json(400, { error: "Action inconnue" });
  } catch (e) {
    console.error("reservation", p && p.action, e.message);
    return json(500, { error: "Service momentanément indisponible" });
  }
};
