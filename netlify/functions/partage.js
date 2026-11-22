/* ============================================================
   FONCTION NETLIFY — partage (lien court d'une expérience, 22/11)
   https://artdive.app/e/<slug>  (redirection dans netlify.toml)

   Rend une petite page avec l'aperçu de l'expérience (titre,
   description, photo) pour WhatsApp, Instagram, Facebook, les emails…
   puis envoie aussitôt la personne sur la fiche dans l'app
   (/#visite=<slug>). Seules les expériences publiées donnent un aperçu ;
   sinon, la personne arrive quand même sur l'app.
   ============================================================ */

const { table, SITE_URL } = require("../lib/commun");

const esc = (s) => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const TYPES = { visite_guidee: "Visite guidée", atelier: "Atelier", escape_game: "Escape game", soiree: "Soirée", autoguidee: "Parcours" };

function page({ titre, description, image, cible, url }) {
  return '<!doctype html><html lang="fr"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    "<title>" + esc(titre) + "</title>" +
    '<meta name="description" content="' + esc(description) + '">' +
    '<meta property="og:type" content="website"><meta property="og:site_name" content="ArtDive">' +
    '<meta property="og:title" content="' + esc(titre) + '">' +
    '<meta property="og:description" content="' + esc(description) + '">' +
    '<meta property="og:url" content="' + esc(url) + '">' +
    '<meta property="og:image" content="' + esc(image) + '">' +
    '<meta name="twitter:card" content="summary_large_image">' +
    '<link rel="canonical" href="' + esc(url) + '">' +
    '<meta http-equiv="refresh" content="0;url=' + esc(cible) + '">' +
    '<style>body{background:#14100D;color:#EFE7D9;font-family:Arial,sans-serif;display:grid;place-items:center;min-height:100vh;margin:0}a{color:#E6C88A}</style>' +
    '</head><body><p><a href="' + esc(cible) + '">' + esc(titre) + "</a></p>" +
    "<script>location.replace(" + JSON.stringify(cible) + ");</script></body></html>";
}

exports.handler = async (event) => {
  const slug = String((event.queryStringParameters && event.queryStringParameters.slug) || "").toLowerCase();
  if (!/^[a-z0-9-]{1,120}$/.test(slug)) return { statusCode: 302, headers: { Location: SITE_URL + "/" }, body: "" };
  const cible = SITE_URL + "/#visite=" + slug, url = SITE_URL + "/e/" + slug;
  let e = null;
  try {
    e = (await table("GET", "experiences?select=slug,type,titre,accroche,description,photo_url&publie=eq.true&actif=eq.true&supprimee_le=is.null&slug=eq." + encodeURIComponent(slug)))[0] || null;
  } catch (err) { console.error("partage", err.message); }
  const titre = e ? ((e.titre && e.titre.fr) || "ArtDive") + " · ArtDive" : "ArtDive · Mouvement Montmartre";
  const texte = e ? ((e.accroche && e.accroche.fr) || (e.description && e.description.fr) || "") : "";
  const description = (e ? (TYPES[e.type] ? TYPES[e.type] + " à Montmartre. " : "") : "") +
    (texte ? texte.replace(/\s+/g, " ").slice(0, 200) : "Visites, ateliers et soirées pour découvrir Montmartre autrement.");
  const image = (e && e.photo_url) || SITE_URL + "/icons/icon-512.png";
  return {
    statusCode: 200,
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "public, max-age=300" },
    body: page({ titre, description, image, cible, url }),
  };
};
