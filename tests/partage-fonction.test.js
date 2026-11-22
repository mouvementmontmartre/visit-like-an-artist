/* Fonction « partage » (lien court d'une expérience), Supabase simulé.
   node tests/partage-fonction.test.js <chemin du dépôt> */
const path = require("path");
process.env.SUPABASE_SECRET_KEY = "sb_secret_essai"; process.env.SITE_URL = "https://artdive.app";
let ok = 0, ko = 0, appels = [];
const v = (n, c, d) => { if (c) { ok++; console.log("OK     " + n); } else { ko++; console.log("ÉCHEC  " + n + (d ? "  → " + String(d).slice(0, 300) : "")); } };
const rep = (status, body) => ({ ok: status < 300, status, text: async () => JSON.stringify(body), json: async () => body });
global.fetch = async (url) => {
  const u = new URL(url); appels.push(u.pathname + u.search);
  if (u.searchParams.get("slug") === "like.atelier-macro-____") return rep(200, [{ slug: "atelier-macro-a3f9", type: "atelier", titre: { fr: "Atelier macro" }, accroche: {}, description: {}, photo_url: null }]);
  if (u.searchParams.get("slug") === "eq.studio-nomade") return rep(200, [{ slug: "studio-nomade", type: "atelier", titre: { fr: "Studio Nomade" },
    accroche: {}, description: { fr: "Un studio <b>sans murs</b> pour artistes en mouvement" }, photo_url: "https://exemple.invalid/p.jpg" }]);
  return rep(200, []);
};
const { handler } = require(path.join(process.argv[2], "netlify/functions/partage.js"));
(async () => {
  let r = await handler({ queryStringParameters: { slug: "studio-nomade" } });
  v("aperçu : titre, description, photo de l'expérience", r.statusCode === 200 && r.body.includes('og:title" content="Studio Nomade · ArtDive"') &&
    r.body.includes('og:image" content="https://exemple.invalid/p.jpg"') && r.body.includes("Atelier à Montmartre.") && r.body.includes("&lt;b&gt;sans murs"), r.body.slice(0, 300));
  v("puis la fiche dans l'app", r.body.includes('location.replace("https://artdive.app/#visite=studio-nomade")') && r.body.includes('url=https://artdive.app/#visite=studio-nomade'));
  v("seulement une expérience publiée, active, non supprimée", appels.some((a) => /publie=eq.true/.test(a) && /actif=eq.true/.test(a) && /supprimee_le=is.null/.test(a)));
  r = await handler({ path: "/.netlify/functions/partage/studio-nomade", queryStringParameters: {} });
  v("adresse passée par le chemin (redirection Netlify /e/…)", r.statusCode === 200 && r.body.includes("Studio Nomade · ArtDive"));
  r = await handler({ path: "/e/atelier-macro", queryStringParameters: {} });
  v("lien sans les 4 caractères de fin : retrouve l'expérience de l'intervenant", r.statusCode === 200 && r.body.includes("Atelier macro · ArtDive") && r.body.includes("#visite=atelier-macro-a3f9"));
  r = await handler({ queryStringParameters: { slug: "inconnue" } });
  v("expérience inconnue : aperçu ArtDive, la personne arrive quand même sur l'app", r.statusCode === 200 && r.body.includes("ArtDive · Mouvement Montmartre") && r.body.includes("#visite=inconnue"));
  r = await handler({ queryStringParameters: { slug: "<script>" } });
  v("adresse invalide : renvoi à l'accueil", r.statusCode === 302 && r.headers.Location === "https://artdive.app/");
  console.log("\n" + ok + " réussis, " + ko + " en échec"); process.exit(ko ? 1 : 0);
})();
