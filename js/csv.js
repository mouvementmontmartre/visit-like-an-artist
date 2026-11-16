/* ============================================================
   CSV — lecture des Google Sheets publiées
   - parseCSV : parseur robuste (guillemets, virgules internes,
     retours à la ligne dans les champs, lignes vides)
   - loadCSV  : fetch + parse + cache localStorage, pour que
     l'app affiche les dernières données connues même hors ligne
   ============================================================ */

/**
 * Transforme un texte CSV brut en tableau d'objets,
 * en utilisant la première ligne comme noms de colonnes.
 * Ignore les lignes entièrement vides.
 */
function parseCSV(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];

    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } // guillemet échappé
        else inQuotes = false;
      } else {
        field += c;
      }
    } else {
      if (c === '"') inQuotes = true;
      else if (c === ",") { row.push(field); field = ""; }
      else if (c === "\n" || c === "\r") {
        if (c === "\r" && text[i + 1] === "\n") i++; // CRLF
        row.push(field); field = "";
        rows.push(row); row = [];
      } else {
        field += c;
      }
    }
  }
  if (field !== "" || row.length > 0) { row.push(field); rows.push(row); }

  if (rows.length === 0) return [];

  // En-têtes uniques : un en-tête vide ou dupliqué reçoit un nom
  // positionnel (_col0, _col1…) pour ne jamais écraser une colonne.
  const seen = new Set();
  const headers = rows[0].map((h, i) => {
    let name = h.trim();
    if (!name || seen.has(name)) name = "_col" + i;
    seen.add(name);
    return name;
  });
  const out = [];
  for (let r = 1; r < rows.length; r++) {
    const cells = rows[r];
    // ligne entièrement vide → on saute
    if (cells.every(c => c.trim() === "")) continue;
    const obj = {};
    headers.forEach((h, idx) => { obj[h] = (cells[idx] || "").trim(); });
    out.push(obj);
  }
  return out;
}

/**
 * Charge une source CSV.
 * - En ligne : fetch frais + mise en cache localStorage
 * - Hors ligne ou en erreur : dernière version en cache si disponible
 * Retourne toujours un tableau (vide en dernier recours).
 */
async function loadCSV(url, cacheKey) {
  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) throw new Error("HTTP " + res.status);
    const text = await res.text();
    const data = parseCSV(text);
    try { localStorage.setItem("csv:" + cacheKey, text); } catch (e) { /* stockage plein : tant pis */ }
    return data;
  } catch (err) {
    const cached = localStorage.getItem("csv:" + cacheKey);
    if (cached) return parseCSV(cached);
    return [];
  }
}
