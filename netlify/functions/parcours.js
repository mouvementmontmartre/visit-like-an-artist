/* ============================================================
   FONCTION NETLIFY — parcours (visites autoguidées, partie 3)
   POST { action, … } :
   - "acheter" { slug, montant_centimes, audioguide, email, langue, cases }
       crée l'accès (prix libre calculé et vérifié par la base, creer_acces)
       et la session de paiement Stripe ; rend { url }.
   - "session" { session_id } : au retour du paiement, active l'accès si le
       webhook n'est pas encore passé et rend le jeton du lien personnel.
   - "voir" { jeton } : le circuit (étapes, celles déjà ouvertes en entier).
   - "etape" { jeton, etape_id, lat, lng, precision | code } : ouvre une
       étape si l'on est sur place (rayon de l'étape) ou avec le code affiché.
   - "lien" { email } : renvoie un lien d'accès (nouveau jeton, l'ancien
       lien cesse de marcher). Réponse identique que l'adresse ait un accès ou non.
   Le contenu payant ne quitte le serveur que pour un accès actif.
   ============================================================ */

const { json, rpc, table, stripe, stripePost, emailValide, sha256hex, SITE_URL, CGV_VERSION } = require("../lib/commun");
const { nouveauJetonHex, activerAcces, envoyerLienAcces, accesParJeton, distanceM } = require("../lib/parcours");

const CASES = ["cgv", "acces_immediat", "renonciation"];   // CGV art. 16.3 : deux cases + les CGV

async function etapesDe(experienceId) {
  const etapes = await table("GET", "etapes?select=id,ordre,type,apercu,nom,resume,texte,a_reperer,lat,lng,rayon_deblocage_m,media_url,media_credit,audio&experience_id=eq." + experienceId + "&order=ordre.asc");
  const avecCode = etapes.length ? await table("GET", "etapes_codes?select=etape_id&etape_id=in.(" + etapes.map((x) => x.id).join(",") + ")") : [];
  return { etapes, avecCode: new Set(avecCode.map((c) => c.etape_id)) };   // le code lui-même ne sort jamais
}
const contenu = (x, audioguide) => ({ resume: x.resume, texte: x.texte, a_reperer: x.a_reperer, media_url: x.media_url,
  media_credit: x.media_credit, audio: audioguide ? x.audio : {} });

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return json(405, { error: "POST attendu" });
  let p;
  try { p = JSON.parse(event.body || "{}"); } catch (e) { return json(400, { error: "Corps invalide" }); }
  try {
    if (p.action === "acheter") {
      const email = String(p.email || "").trim().toLowerCase(), langue = ["fr", "en", "es"].includes(p.langue) ? p.langue : "fr";
      if (!emailValide(email)) return json(400, { error: "EMAIL" });
      if (!CASES.every((c) => p.cases && p.cases[c] === true)) return json(400, { error: "CASES" });
      if (!/^[a-z0-9-]{1,80}$/.test(String(p.slug || ""))) return json(400, { error: "PARCOURS" });
      const e = (await table("GET", "experiences?select=id,titre&type=eq.autoguidee&publie=eq.true&actif=eq.true&slug=eq." + p.slug))[0];
      if (!e) return json(404, { error: "PARCOURS" });
      const jeton = nouveauJetonHex();
      let a;
      try {
        a = await rpc("creer_acces", { p_experience_id: e.id, p_email: email, p_jeton_hash: sha256hex(jeton),
          p_montant_libre_centimes: Math.round(Number(p.montant_centimes)), p_audioguide: !!p.audioguide, p_langue: langue, p_cgv_acceptees: true });
      } catch (err) {
        const code = /MONTANT_TROP_BAS|MONTANT_TROP_HAUT|OPTION_INDISPONIBLE/.exec(err.message);
        if (code) return json(400, { error: code[0] });
        throw err;
      }
      const maintenant = new Date().toISOString();
      await table("PATCH", "acces?id=eq." + a.acces_id, { cgv_version: CGV_VERSION,
        consentements: Object.fromEntries(CASES.map((c) => [c, maintenant])) }, { Prefer: "return=minimal" });
      const titre = (e.titre && (e.titre[langue] || e.titre.fr)) || "ArtDive";
      const s = await stripePost("checkout/sessions", {
        mode: "payment", locale: langue, customer_email: email,
        "line_items[0][quantity]": "1",
        "line_items[0][price_data][currency]": "eur",
        "line_items[0][price_data][unit_amount]": String(a.a_payer_centimes),
        "line_items[0][price_data][product_data][name]": titre.slice(0, 250),
        "line_items[0][price_data][product_data][description]": { fr: "Parcours sur téléphone, accès immédiat", en: "Self-guided tour on your phone, instant access", es: "Recorrido en el móvil, acceso inmediato" }[langue] +
          (a.audioguide ? { fr: ", avec audioguide", en: ", with audio guide", es: ", con audioguía" }[langue] : ""),
        "metadata[acces_id]": a.acces_id, "metadata[acces_jeton]": jeton,
        "payment_intent_data[metadata][acces_id]": a.acces_id,
        "payment_intent_data[description]": "Parcours " + a.reference,
        success_url: SITE_URL + "/?parcours={CHECKOUT_SESSION_ID}",
        cancel_url: SITE_URL + "/?parcours_abandonne=1",
      }, "acces-" + a.acces_id);
      if (!s.ok) { console.error("parcours stripe", s.data && s.data.error && s.data.error.message); return json(502, { error: "STRIPE" }); }
      return json(200, { url: s.data.url });
    }

    if (p.action === "session") {
      const id = String(p.session_id || "");
      if (!/^cs_(live|test)_[A-Za-z0-9]+$/.test(id)) return json(400, { error: "SESSION" });
      const session = await stripe("checkout/sessions/" + id);
      if (!session.metadata || !session.metadata.acces_id) return json(400, { error: "SESSION" });
      if (Date.now() / 1000 - session.created > 24 * 3600) return json(400, { error: "SESSION" });
      const r = await activerAcces(session);
      if (!r) return json(409, { error: "NON_PAYE" });
      return json(200, { jeton: r.jeton, reference: r.acces.reference, montant_centimes: r.acces.montant_centimes, audioguide: r.acces.audioguide, email: r.acces.email });
    }

    if (p.action === "voir" || p.action === "etape") {
      const a = await accesParJeton(p.jeton);
      if (!a) return json(404, { error: "ACCES" });
      const e = (await table("GET", "experiences?select=id,slug,titre,nb_etapes,intervenant_id&id=eq." + a.experience_id))[0];
      const { etapes, avecCode } = await etapesDe(a.experience_id);
      const prog = a.progression || {};
      const ouverte = (x) => x.apercu || x.type === "depart" || !!prog[x.id];

      if (p.action === "etape") {
        const x = etapes.find((y) => y.id === p.etape_id);
        if (!x) return json(404, { error: "ETAPE" });
        if (!ouverte(x)) {
          let ok = false;
          if (p.code != null) {
            const c = (await table("GET", "etapes_codes?select=code&etape_id=eq." + x.id))[0];
            ok = !!c && String(c.code).trim().toLowerCase() === String(p.code).trim().toLowerCase();
            if (!ok) return json(403, { error: "CODE" });
          } else {
            const lat = Number(p.lat), lng = Number(p.lng), prec = Math.min(Math.max(Number(p.precision) || 0, 0), 50);
            if (!isFinite(lat) || !isFinite(lng) || x.lat == null) return json(400, { error: "POSITION" });
            const d = distanceM(lat, lng, x.lat, x.lng);
            if (d > x.rayon_deblocage_m + prec) return json(403, { error: "TROP_LOIN", distance_m: Math.round(d) });
          }
          prog[x.id] = new Date().toISOString();
          await table("PATCH", "acces?id=eq." + a.id, { progression: prog }, { Prefer: "return=minimal" });
        }
        return json(200, { etape: Object.assign({ id: x.id, ordre: x.ordre, nom: x.nom }, contenu(x, a.audioguide)) });
      }

      const intervenant = e && e.intervenant_id ? (await table("GET", "intervenants?select=nom&id=eq." + e.intervenant_id))[0] : null;
      return json(200, {
        parcours: { slug: e.slug, titre: e.titre, nb_etapes: etapes.length, audioguide: a.audioguide, reference: a.reference, intervenant: intervenant && intervenant.nom },
        etapes: etapes.map((x) => Object.assign({ id: x.id, ordre: x.ordre, type: x.type, nom: x.nom, lat: x.lat, lng: x.lng,
          rayon_m: x.rayon_deblocage_m, code: avecCode.has(x.id), ouverte: ouverte(x) }, ouverte(x) ? contenu(x, a.audioguide) : {})),
      });
    }

    if (p.action === "lien") {
      const email = String(p.email || "").trim().toLowerCase();
      if (!emailValide(email)) return json(400, { error: "EMAIL" });
      const accesListe = await table("GET", "acces?select=id,reference,email,langue,audioguide,montant_centimes,experience_id,lien_envoye_le&statut=eq.actif&email=eq." + encodeURIComponent(email));
      for (const a of accesListe.slice(0, 5)) {
        if (a.lien_envoye_le && Date.now() - new Date(a.lien_envoye_le).getTime() < 20 * 60e3) continue;   // un envoi toutes les 20 min
        const jeton = nouveauJetonHex();
        await table("PATCH", "acces?id=eq." + a.id, { jeton_hash: sha256hex(jeton) }, { Prefer: "return=minimal" });
        await envoyerLienAcces(a, jeton).catch((err) => console.error("lien parcours :", err.message));
      }
      await new Promise((r) => setTimeout(r, 150 + Math.random() * 250));   // même délai, qu'il y ait un accès ou non
      return json(200, { ok: true });
    }

    return json(400, { error: "ACTION" });
  } catch (e) {
    console.error("parcours :", e.message);
    return json(500, { error: "ERREUR" });
  }
};
