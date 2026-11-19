/* ============================================================
   FONCTION NETLIFY — traduire (étape 6.5)
   POST { textes: { cle: "texte en français", … }, langues: ["en", "es"] }
   avec la session de l'admin ou d'un intervenant (Authorization: Bearer).
   Traduit une seule fois, au moment de l'enregistrement d'une fiche
   (décision : pas de traduction à chaque visite), avec Claude (API
   Anthropic, décision du 19/11). Réponse : { en: { cle: "…" }, es: { … } }.
   Les textes traduits restent marqués « traduction automatique » tant
   que l'association ne les a pas relus (colonne langues_relues).
   Variables Netlify : ANTHROPIC_API_KEY (secrète), CLAUDE_MODEL (facultative).
   ============================================================ */

const Anthropic = require("@anthropic-ai/sdk");
const { json, appelant } = require("../lib/commun");

const MODELE = process.env.CLAUDE_MODEL || "claude-opus-5-5";
const NOMS = { en: "English (British spelling)", es: "Spanish (Spain, informal tú)", zh: "Simplified Chinese", ar: "Modern Standard Arabic", ru: "Russian" };

exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return json(405, { error: "POST attendu" });
  if (!process.env.ANTHROPIC_API_KEY) return json(503, { error: "INDISPONIBLE" });
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

    // Réponse forcée au bon format : un objet par langue, avec exactement les clés reçues.
    const parLangue = { type: "object", additionalProperties: false, required: Object.keys(textes),
      properties: Object.fromEntries(Object.keys(textes).map((k) => [k, { type: "string" }])) };
    const schema = { type: "object", additionalProperties: false, required: langues,
      properties: Object.fromEntries(langues.map((l) => [l, parLangue])) };

    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const r = await client.beta.messages.create({
      model: MODELE,
      max_tokens: 16000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",   // si le modèle refuse, l'API essaie un autre modèle d'elle-même
      output_config: { effort: "low", format: { type: "json_schema", schema } },
      system: "You translate texts of ArtDive, an app of guided tours, artists' workshops and evenings in Montmartre (Paris), " +
        "from French into: " + langues.map((l) => l + " = " + NOMS[l]).join("; ") + ". Keep the tone warm, short and precise. " +
        "Keep proper names, place names and street names as they are (Lapin Agile, Sacré-Cœur, place du Tertre). " +
        "Never use long dashes. Return, for each language code, an object with exactly the same keys as the input.",
      messages: [{ role: "user", content: JSON.stringify(textes) }],
    });
    if (r.stop_reason === "refusal" || r.stop_reason === "max_tokens") return json(502, { error: "SERVICE" });
    const bloc = (r.content || []).find((b) => b.type === "text");
    const brut = JSON.parse((bloc && bloc.text) || "{}");
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
    console.error("traduire :", e.status || "", e.message);
    return json(e instanceof Anthropic.APIError ? 502 : 500, { error: e instanceof Anthropic.APIError ? "SERVICE" : "ERREUR" });
  }
};
