/* ============================================================
   FONCTION NETLIFY — demande (formulaires publics, étape 6.4)
   POST { formulaire: "prive" | "rejoindre", … }
   - « prive »     : demande de visite ou d'atelier privé (E7) → demandes_groupes
   - « rejoindre » : guide, artiste ou lieu qui veut rejoindre ArtDive (E14) → candidatures
   Les formulaires n'écrivent jamais dans la base depuis le navigateur :
   cette fonction vérifie tout, enregistre avec la clé secrète, PUIS
   prévient l'association par la file des emails : adresse NOTIFY_EMAIL
   (variable Netlify, sinon mouvementmontmartre@gmail.com), « Répondre »
   écrit à la personne, lien direct vers Validations (candidature) ou
   Demandes. Si l'email échoue, la demande reste enregistrée et
   l'administration affiche « notification non envoyée ».
   Pas d'email envoyé à l'adresse saisie : personne ne peut se servir du
   formulaire pour écrire à un tiers.
   Anti-robots : champ piège invisible (demande écartée et journalisée) ;
   3 demandes par adresse et par heure. Un envoi très rapide (moins de
   3 s, possible avec le remplissage automatique du téléphone) n'est PAS
   écarté : il est enregistré et signalé « à vérifier » dans l'email.
   ============================================================ */

const { json, table, emailValide, EMAIL_REPONSE } = require("../lib/commun");
const { traiterEnvois } = require("../lib/reservations");

const texte = (v, max) => { const s = String(v == null ? "" : v).trim(); return s ? s.slice(0, max) : null; };
const OCCASIONS = ["anniversaire", "famille", "entreprise", "ecole", "amis", "autre"];
const TYPES_CANDIDAT = ["guide", "artiste", "lieu", "autre"];
const LANGUES = ["fr", "en", "es", "zh", "ar", "ru"];

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return json(405, { error: "POST attendu" });
  let p;
  try { p = JSON.parse(event.body || "{}"); } catch (e) { return json(400, { error: "Corps invalide" }); }

  // Robots : le champ piège doit rester vide. Écartée sans le dire (réponse « ok »), mais journalisée
  // (sans donnée personnelle) pour pouvoir vérifier dans Netlify > Logs qu'aucune vraie demande n'est perdue.
  const formulaire = p.formulaire === "rejoindre" || p.formulaire === "prive" ? p.formulaire : "?";
  const duree = Math.round(Number(p.duree_ms) || 0);
  if (texte(p.site_web, 200)) {
    console.warn("demande écartée", JSON.stringify({ raison: "champ_piege", formulaire, duree_ms: duree }));
    return json(200, { ok: true });
  }
  const rapide = !(duree >= 3000);
  if (rapide) console.warn("demande rapide, gardée à vérifier", JSON.stringify({ formulaire, duree_ms: duree }));

  const nom = texte(p.nom, 120), email = String(p.email || "").trim().toLowerCase(), telephone = texte(p.telephone, 30);
  const message = texte(p.message, 4000);
  if (!nom) return json(400, { error: "NOM" });
  if (!emailValide(email)) return json(400, { error: "EMAIL" });

  try {
    const tableCible = p.formulaire === "rejoindre" ? "candidatures" : p.formulaire === "prive" ? "demandes_groupes" : null;
    if (!tableCible) return json(400, { error: "FORMULAIRE" });

    const uneHeure = new Date(Date.now() - 3600e3).toISOString();
    const recentes = await table("GET", tableCible + "?select=id&email=eq." + encodeURIComponent(email) + "&cree_le=gt." + encodeURIComponent(uneHeure));
    if (recentes.length >= 3) {
      console.warn("demande écartée", JSON.stringify({ raison: "trop_de_demandes", formulaire }));
      return json(429, { error: "TROP" });
    }

    let ligne, sujet, lignesMail;   // sujet modifié ensuite si l'envoi est très rapide
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
    // 1. Enregistrement d'abord : la demande n'est jamais perdue, même si l'email échoue.
    const cree = ((await table("POST", tableCible, ligne, { Prefer: "return=representation" })) || [])[0];

    // 2. Alerte à l'association, par la file des emails (« Répondre » écrit à la personne ; lien direct
    //    vers Validations ou Demandes). Un échec est journalisé et affiché « notification non envoyée ».
    try {
      await table("POST", "envois", {
        type: tableCible === "candidatures" ? "alerte_candidature" : "alerte_demande",
        destinataire: EMAIL_REPONSE, langue: "fr",
        donnees: { pour_association: true, sujet, nom, message, a_verifier: rapide, repondre_a: email,
          lignes: lignesMail.filter((l) => l[1] != null && l[1] !== "") },
        cible_table: tableCible, cible_id: cree && cree.id,
      }, { Prefer: "return=minimal" });
      await traiterEnvois(5);
    } catch (e) { console.error("alerte demande non envoyée (demande bien enregistrée) :", e.message); }
    return json(200, { ok: true });
  } catch (e) {
    console.error("demande :", e.message);
    return json(500, { error: "ERREUR" });
  }
};
