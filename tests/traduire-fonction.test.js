/* Fonction « traduire » (Claude), Supabase et l'API Anthropic simulés.
   NODE_PATH=<dossier avec @anthropic-ai/sdk 1.5.0> node tests/traduire-fonction.test.js <dépôt> */
const path = require("path");
process.env.SUPABASE_SECRET_KEY = "sb_secret_essai";
let ok = 0, ko = 0;
const v = (n, c, d) => { if (c) { ok++; console.log("OK     " + n); } else { ko++; console.log("ÉCHEC  " + n + (d ? "  → " + String(d).slice(0, 300) : "")); } };
let st = {};
const rep = (status, body) => ({ ok: status < 300, status, text: async () => JSON.stringify(body), json: async () => body });
global.fetch = async (url, o = {}) => {
  const u = new URL(url);
  if (u.pathname === "/auth/v1/user") return (o.headers.Authorization || "").endsWith("SESSION-VALIDE-0123456789") ? rep(200, { id: "u1" }) : rep(401, {});
  if (u.pathname === "/rest/v1/profils") return rep(200, [{ role: st.role }]);
  if (u.hostname === "api.anthropic.com") {
    const h = new Headers(o.headers);
    st.claude = { corps: JSON.parse(o.body), cle: h.get("x-api-key") || String(h.get("authorization") || "").replace(/^Bearer /, ""), beta: h.get("anthropic-beta") };
    const txt = JSON.stringify({ en: { f_titre: "Painters — walk", pirate: "x" }, es: { f_titre: "Paseo de los pintores" } });
    return new Response(JSON.stringify({ id: "msg_1", type: "message", role: "assistant", model: "claude-opus-5-5", stop_reason: "end_turn",
      content: [{ type: "text", text: txt }], usage: { input_tokens: 10, output_tokens: 10 } }), { status: 200, headers: { "content-type": "application/json" } });
  }
  return rep(404, {});
};
const { handler } = require(path.join(process.argv[2], "netlify/functions/traduire.js"));
const appel = (corps, jeton = "SESSION-VALIDE-0123456789") => handler({ httpMethod: "POST", headers: { authorization: "Bearer " + jeton }, body: JSON.stringify(corps) })
  .then((r) => ({ status: r.statusCode, body: JSON.parse(r.body) }));
(async () => {
  let r = await appel({ textes: { f_titre: "Circuit des Peintres" } });
  v("sans clé Anthropic : indisponible, sans planter", r.status === 503 && r.body.error === "INDISPONIBLE");
  process.env.ANTHROPIC_API_KEY = "sk-ant-essai";
  st = { role: "admin" };
  r = await appel({ textes: { f_titre: "Circuit des Peintres" }, langues: ["en", "es"] });
  v("admin : traductions rendues par langue", r.status === 200 && r.body.en.f_titre && r.body.es.f_titre === "Paseo de los pintores", JSON.stringify(r.body));
  v("longs tirets retirés, clés inattendues ignorées", !/[—–]/.test(r.body.en.f_titre) && !("pirate" in r.body.en));
  v("clé Anthropic dans l'en-tête, jamais dans la réponse", st.claude.cle === "sk-ant-essai" && !JSON.stringify(r.body).includes("sk-ant"));
  v("Claude Opus 5.5, effort bas, format JSON imposé, repli en cas de refus", st.claude.corps.model === "claude-opus-5-5" && st.claude.corps.output_config.effort === "low" &&
    st.claude.corps.output_config.format.type === "json_schema" && st.claude.corps.fallbacks === "default" && /server-side-fallback/.test(st.claude.beta || ""), JSON.stringify(st.claude.corps).slice(0, 300));
  st = { role: "intervenant" };
  r = await appel({ textes: { i_bio: "Je suis guide" } });
  v("intervenant : autorisé", r.status === 200);
  st = { role: null };
  r = await appel({ textes: { f_titre: "x" } });
  v("compte sans rôle : refusé", r.status === 403);
  r = await appel({ textes: { f_titre: "x" } }, "faux-jeton-bien-forme-00000");
  v("sans session valide : refusé", r.status === 403);
  st = { role: "admin" };
  r = await appel({ textes: { f_titre: "x".repeat(13000) } });
  v("texte trop long : refusé avant OpenAI", r.status === 400 && r.body.error === "TROP_LONG");
  console.log("\n" + ok + " réussis, " + ko + " en échec"); process.exit(ko ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
