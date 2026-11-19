/* ============================================================
   FONCTION NETLIFY — demande (formulaires publics, étape 6.4)
   POST { formulaire: "prive" | "rejoindre", … }
   - « prive »     : demande de visite ou d'atelier privé (E7) → demandes_groupes
   - « rejoindre » : guide, artiste ou lieu qui veut rejoindre ArtDive (E14) → candidatures
   Les formulaires n'écrivent jamais dans la base depuis le navigateur :
   cette fonction vérifie tout, enregistre avec la clé secrète, puis
   prévient l'association par email (Brevo). Pas d'email envoyé à
   l'adresse saisie : personne ne peut se servir du formulaire pour
   écrire à un tiers. Anti-robots : champ piège invisible, délai minimum
   de remplissage, 3 demandes par adresse et par heure.
   ============================================================ */

const { json, table, envoyerBrevo, emailValide, EMAIL_REPONSE } = require("../lib/commun");
const { esc } = require("../lib/emails");

const texte = (v, max) => { const s = String(v == null ? "" : v).trim(); return s ? s.slice(0, max) : null; };
const OCCASIONS = ["anniversaire", "famille", "entreprise", "ecole", "amis", "autre"];
const TYPES_CANDIDAT = ["guide", "artiste", "lieu", "autre"];
const LANGUES = ["fr", "en", "es", "zh", "ar", "ru"];

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return json(405, { error: "POST attendu" });
  let p;
  try { p = JSON.parse(event.body || "{}"); } catch (e) { return json(400, { error: "Corps invalide" }); }

  // Robots : le champ piège doit rester vide et un humain met plus de 3 secondes à remplir.
  if (texte(p.site_web, 200) || !(Number(p.duree_ms) >= 3000)) return json(200, { ok: true });

  const nom = texte(p.nom, 120), email = String(p.email || "").trim().toLowerCase(), telephone = texte(p.telephone, 30);
  const message = texte(p.message, 4000);
  if (!nom) return json(400, { error: "NOM" });
  if (!emailValide(email)) return json(400, { error: "EMAIL" });

  try {
    const tableCible = p.formulaire === "rejoindre" ? "candidatures" : p.formulaire === "prive" ? "demandes_groupes" : null;
    if (!tableCible) return json(400, { error: "FORMULAIRE" });

    const uneHeure = new Date(Date.now() - 3600e3).toISOString();
    const recentes = await table("GET", tableCible + "?select=id&email=eq." + encodeURIComponent(email) + "&cree_le=gt." + encodeURIComponent(uneHeure));
    if (recentes.length >= 3) return json(429, { error: "TROP" });

    let ligne, sujet, lignesMail;
    if (tableCible === "candidatures") {
      const type = TYPES_CANDIDAT.includes(p.type) ? p.type : "autre";
      if (!message) return json(400, { error: "MESSAGE" });
      ligne = { origine: "rejoindre", type, nom, email, telephone, message };
      sujet = "ArtDive : nouvelle candidature (" + type + ") de " + nom;
      lignesMail = [["Profil", type], ["Nom", nom], ["Email", email], ["Téléphone", telephone]];
    } else {
      const type = p.type === "atelier" ? "atelier" : "visite";
      let experience_id = null, titre = null;
      if (typeof p.experience === "string" && /^[a-z0-9-]{1,80}$/.test(p.experience)) {
        const e = (await table("GET", "experiences?select=id,titre&publie=eq.true&slug=eq." + p.experience))[0];
        if (e) { experience_id = e.id; titre = e.titre && e.titre.fr; }
      }
      const personnes = Math.round(Number(p.personnes));
      ligne = { localite_id: "montmartre", type, experience_id,
        personnes: personnes >= 1 && personnes <= 500 ? personnes : null,
        occasion: OCCASIONS.includes(p.occasion) ? p.occasion : null,
        periode_souhaitee: texte(p.periode, 200), langue: LANGUES.includes(p.langue) ? p.langue : "fr",
        nom, email, telephone, message };
      sujet = "ArtDive : demande de " + (type === "atelier" ? "atelier" : "visite") + " privé" + (type === "atelier" ? "" : "e") + " de " + nom;
      lignesMail = [["Type", type], ["Proposition", titre || (p.experience ? p.experience : "pas de préférence")], ["Personnes", ligne.personnes],
        ["Occasion", ligne.occasion], ["Période", ligne.periode_souhaitee], ["Langue", ligne.langue],
        ["Nom", nom], ["Email", email], ["Téléphone", telephone]];
    }
    await table("POST", tableCible, ligne, { Prefer: "return=minimal" });

    // Alerte à l'association (répondre à l'email répond directement à la personne).
    const html = '<div style="font-family:Arial,sans-serif;font-size:15px;line-height:1.5;color:#14100D;max-width:560px">' +
      "<p>" + esc(sujet) + "</p><table style=\"border-collapse:collapse\">" +
      lignesMail.filter((l) => l[1] != null && l[1] !== "").map((l) => '<tr><td style="padding:3px 12px 3px 0;color:#5C5246">' + esc(l[0]) +
        "</td><td><b>" + esc(l[1]) + "</b></td></tr>").join("") + "</table>" +
      (message ? "<p style=\"white-space:pre-line\">" + esc(message) + "</p>" : "") +
      "<p>À retrouver dans l'app : Infos, Espace intervenants, onglet Demandes.</p></div>";
    await envoyerBrevo(EMAIL_REPONSE, { sujet, html, texte: html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ") }, ["demande"], { email, name: nom })
      .catch((e) => console.error("alerte demande :", e.message));   // la demande est enregistrée même si l'alerte échoue
    return json(200, { ok: true });
  } catch (e) {
    console.error("demande :", e.message);
    return json(500, { error: "ERREUR" });
  }
};
