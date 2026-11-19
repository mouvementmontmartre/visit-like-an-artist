/* ============================================================
   FONCTION NETLIFY — traduire (étape 6.5)
   POST { textes: { cle: "texte en français", … }, langues: ["en", "es"] }
   avec la session de l'admin ou d'un intervenant (Authorization: Bearer).
   Traduit une seule fois, au moment de l'enregistrement d'une fiche
   (décision : pas de traduction à chaque visite). Réponse :
   { en: { cle: "…" }, es: { … } }. Les textes traduits restent marqués
   « traduction automatique » tant que l'association ne les a pas relus
   (colonne langues_relues).
   Variables Netlify : OPENAI_API_KEY (secrète), OPENAI_MODEL (facultative).
   ============================================================ */

const { json, appelant } = require("../lib/commun");

const MODELE = process.env.OPENAI_MODEL || "gpt-4o-mini";
const NOMS = { en: "English (British spelling)", es: "Spanish (Spain, informal tú)", zh: "Simplified Chinese", ar: "Modern Standard Arabic", ru: "Russian" };

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return json(405, { error: "POST attendu" });
  if (!process.env.OPENAI_API_KEY) return json(503, { error: "INDISPONIBLE" });
  let p;
  try { p = JSON.parse(event.body || "{}"); } catch (e) { return json(400, { error: "Corps invalide" }); }
  try {
    const qui = await appelant(event);
    if (!qui || !["admin", "intervenant"].includes(qui.role)) return json(403, { error: "RESERVE" });
    const textes = {};
    Object.entries(p.textes || {}).forEach(([k, v]) => { if (/^[a-z_]{1,40}$/.test(k) && typeof v === "string" && v.trim()) textes[k] = v.trim(); });
    const langues = (Array.isArray(p.langues) ? p.langues : ["en", "es"]).filter((l) => NOMS[l]);
    const taille = Object.values(textes).reduce((n, v) => n + v.length, 0);
    if (!Object.keys(textes).length || !langues.length) return json(400, { error: "VIDE" });
    if (taille > 12000 || Object.keys(textes).length > 20) return json(400, { error: "TROP_LONG" });

    const consigne = "You translate texts of ArtDive, an app of guided tours, artists' workshops and evenings in Montmartre (Paris), " +
      "from French into: " + langues.map((l) => l + " = " + NOMS[l]).join("; ") + ". Keep the tone warm, short and precise. " +
      "Keep proper names, place names and street names as they are (Lapin Agile, Sacré-Cœur, place du Tertre). " +
      "Never use long dashes. Reply with JSON only: an object whose keys are the language codes, each holding an object " +
      "with exactly the same keys as the input.";
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: "Bearer " + process.env.OPENAI_API_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ model: MODELE, temperature: 0.2, response_format: { type: "json_object" },
        messages: [{ role: "system", content: consigne }, { role: "user", content: JSON.stringify(textes) }] }),
    });
    if (!res.ok) { console.error("OpenAI", res.status, (await res.text()).slice(0, 200)); return json(502, { error: "SERVICE" }); }
    const brut = JSON.parse(((await res.json()).choices || [{}])[0].message.content || "{}");
    const sortie = {};
    langues.forEach((l) => {   // on ne garde que les clés demandées, en texte, sans longs tirets
      sortie[l] = {};
      Object.keys(textes).forEach((k) => {
        const v = brut[l] && brut[l][k];
        if (typeof v === "string" && v.trim()) sortie[l][k] = v.trim().replace(/\s*[—–]\s*/g, ", ").slice(0, 8000);
      });
    });
    return json(200, sortie);
  } catch (e) {
    console.error("traduire :", e.message);
    return json(500, { error: "ERREUR" });
  }
};
