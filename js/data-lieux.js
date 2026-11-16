/* ============================================================
   LIEUX DE L'ÉCOSYSTÈME — carte du quartier (onglet Carte)
   SECOURS uniquement : utilisé seulement si CONFIG.sources.pointsEcosysteme
   (js/config.js) est vide ou inaccessible. Une fois la Sheet "Points_Ecosysteme"
   publiée et son lien collé dans config.js, c'est elle qui fait foi — ce fichier
   ne sert plus qu'en secours hors-ligne/erreur.
   Chaque lieu a :
   - nom        : affiché sur la fiche
   - lat / lng  : coordonnées GPS (clic droit sur Google Maps
                  → les coordonnées s'affichent en premier)
   - type       : "info" | "espace-membre" | "atelier-artiste" | "bar" |
                  "restaurant" | "boutique" | "librairie" | "depart" | "arrivee" |
                  "media" | "ar" | "concert" | "exposition" | "toilettes" | "metro" |
                  "galerie" | "studio" | "theatre" | "disquaire" | "ecole" |
                  "createur" | "presse" | "vue"
   - desc       : courte description affichée dans la fiche
   - media      : URL d'une photo (optionnel, "" si aucune)
   - lien       : URL du site du lieu/membre (optionnel, "" si aucun ;
                  affiche un bouton "Voir le site" dans la fiche)
   - adresse    : adresse postale affichée dans la fiche (optionnel)
   - email      : email de contact, affiché en bouton (optionnel)
   - telephone  : téléphone, affiché en bouton (optionnel)
   - instagram  : URL Instagram, affiché en bouton (optionnel)
   - facebook   : URL Facebook, affiché en bouton (optionnel)
   ============================================================ */

const LIEUX_ECOSYSTEME = [
  {
    nom: "Square d'Anvers",
    lat: 48.8829, lng: 2.3443,
    type: "info",
    desc: "Cœur du festival. Coordonnées approximatives, à vérifier sur le terrain.",
    media: "", lien: ""
  },
  {
    nom: "Place Pigalle",
    lat: 48.8822, lng: 2.3371,
    type: "info",
    desc: "Porte d'entrée du quartier. Coordonnées approximatives, à vérifier sur le terrain.",
    media: "", lien: ""
  },
  {
    nom: "Cimetière de Montmartre",
    lat: 48.8878, lng: 2.3306,
    type: "info",
    desc: "Lieu de la balade photographique. Coordonnées approximatives, à vérifier sur le terrain.",
    media: "", lien: ""
  },
  {
    nom: "Place des Abbesses",
    lat: 48.8844, lng: 2.3384,
    type: "info",
    desc: "Coordonnées approximatives, à vérifier sur le terrain.",
    media: "", lien: ""
  },
  {
    nom: "EXEMPLE — Galerie membre",
    lat: 48.8848, lng: 2.3402,
    type: "espace-membre",
    desc: "EXEMPLE à remplacer : espace d'un membre de l'association, ouvert au public.",
    media: "", lien: "https://exemple.fr"
  },
  {
    nom: "EXEMPLE — Atelier d'artiste",
    lat: 48.8858, lng: 2.3348,
    type: "atelier-artiste",
    desc: "EXEMPLE à remplacer : atelier d'un artiste membre proposant des rencontres.",
    media: "", lien: ""
  },
];

/* Le programme du festival est désormais lu dynamiquement depuis
   une Google Sheet (CONFIG.sources.programmeFestival), voir app.js
   fonction renderFestival(). Rien à modifier ici pour le programme. */
