/* ============================================================
   CONFIGURATION — Mouvement Montmartre
   C'est LE fichier à modifier pour mettre l'app à jour.
   Aucune autre partie du code n'a besoin d'être touchée pour :
   - changer le thème d'une édition (titre + couleur d'accent)
   - changer les dates du festival
   - remplacer une source Google Sheet (lien CSV publié)
   - changer les liens externes (Tally, adhésion)
   ============================================================ */

const CONFIG = {

  /* ---- FESTIVAL : mettre true pour réafficher le Montmartre Festival (bandeau Accueil, programme, carte, infos) ---- */
  festivalActif: false,

  /* ---- MARQUE (nom de travail ; la marque mère n'est pas décidée) ----
     Ne rien écrire en dur ailleurs : tous les écrans, titres et emails
     lisent ces valeurs. {localite} est remplacé par le nom de la localité.
     Fichiers statiques à changer à la main si le nom change :
     index.html (title + balises og/twitter) et manifest.json. */
  marque: {
    nom: "Visit Like An Artist",
    nomCourt: "VLAA",
    slogan: {
      fr: "Explore {localite} comme un artiste",
      en: "Explore {localite} like an artist",
      es: "Explora {localite} como un artista",
    },
  },

  /* ---- VENDEUR ET BÉNÉFICIAIRE (pages légales, emails, reçus) ----
     Aujourd'hui : l'association. Pour passer à une autre structure,
     changer uniquement ce bloc. Champs vides = non affichés (à compléter,
     ne rien inventer). Les clés Stripe restent côté serveur (Netlify). */
  vendeur: {
    nom: "Mouvement MontmARTre",
    forme: "association loi 1901",
    adresse: "53 rue Berthe, 75018 Paris",
    rna: "W751269026",
    siret: "924 514 433 00011",
    tva: "",                         // non assujettie : laisser vide
    mentionTva: "TVA non applicable",
    email: "mouvementmontmartre@gmail.com",
    telephone: "",
    directeurPublication: "",        // à compléter
    hebergeur: "Netlify, Inc.",
    compteStripe: "acct_1NLABqCtjp0QuQA6",  // identifiant public du compte, pas une clé
  },

  /* ---- LOCALITÉS ----
     Chaque activité, guide, lieu et partenaire est rattaché à une localité
     (colonne "Localité" des Sheets, id ci-dessous ; vide = localité par défaut).
     Plusieurs localités actives = un sélecteur apparaît sur l'accueil. */
  localiteParDefaut: "montmartre",
  localites: [
    {
      id: "montmartre",
      nom: "Montmartre",
      actif: true,
      carte: { latMin: 48.879, latMax: 48.891, lngMin: 2.325, lngMax: 2.352 },
    },
  ],

  /* ---- ÉDITION EN COURS (change chaque année) ---- */
  edition: {
    titre: "4e édition",
    titre_EN: "4th edition", titre_ES: "4ª edición",  // optionnel : laisser vide "" pour ne pas traduire
    theme: "Open Air, Carnaval, Marché de Créateurs, Vide-greniers, Exposition, Projections, Performances, Ateliers",
    theme_EN: "", theme_ES: "",                        // optionnel
    accent: "#8FB33E",                       // fée verte
    dateDebut: "2026-09-25",                 // format AAAA-MM-JJ
    dateFin: "2026-09-27",
    datesAffichees: "25 — 27 SEPT. 2026",    // texte affiché tel quel sur le bandeau
  },

  /* ---- SOURCES DE DONNÉES (liens CSV "Publier sur le web") ---- */
  sources: {
    // Agenda du quartier (Tally → Google Sheet → onglet Agenda_App)
    agenda: "https://docs.google.com/spreadsheets/d/e/2PACX-1vTh_cDcZt5vylBD03STPtCM3wez5-ATPJmB5S89BufR-pUeH9mVoUhqqVMp-bgVZ-FIM6y19A4YIA_O/pub?gid=1275278197&single=true&output=csv",

    // Visites guidées (une ligne par visite, colonne Actif = Oui pour afficher)
    visites: "https://docs.google.com/spreadsheets/d/e/2PACX-1vRAdB0d0AOIKZvP61bZAOWGkxanyb0DyUL0tXzl0gTMqcKQncf8svdhwh7cyOOKH52PzQ7qgR-DKsv_/pub?gid=0&single=true&output=csv",

    // Points de parcours des visites (colonne id = id de la visite)
    pointsVisites: "https://docs.google.com/spreadsheets/d/e/2PACX-1vRAdB0d0AOIKZvP61bZAOWGkxanyb0DyUL0tXzl0gTMqcKQncf8svdhwh7cyOOKH52PzQ7qgR-DKsv_/pub?gid=1070224808&single=true&output=csv",

    // Points de la carte du festival (fichier séparé)
    pointsFestival: "https://docs.google.com/spreadsheets/d/e/2PACX-1vSq_JmjZ3cjdIknfJ3pBR97OtRD7Gioxx8-oBTex5kbNOSiz-14Q0wrQzmMhaUQ5en--1P2rqwP9BaA/pub?gid=0&single=true&output=csv",

    // Lieux de l'écosystème (espaces membres, ateliers d'artistes...) pour l'onglet Carte.
    // Change souvent : URL à remplacer dès que la Sheet est publiée. Vide = utilise data-lieux.js en secours.
    pointsEcosysteme: "https://docs.google.com/spreadsheets/d/e/2PACX-1vRz3ydAHzPC3Qy3X8AbINZtC5HpW9ytVXlg0UrUt6H1ZJy_5q6qJFwr-sVNgR2BNM9LdyBalRNIeYVw/pub?gid=2013302099&single=true&output=csv",

    // Programme du festival (colonnes : Date, Heure début, Heure fin, Titre, Lieu, Description)
    // Change souvent : URL à remplacer dès que la Sheet est créée et publiée.
    programmeFestival: "https://docs.google.com/spreadsheets/d/e/2PACX-1vQ7dYdZOylWiCdBdeTf0W7sCXXtbf07j3jSjGGuhFrBphP5iCA9sWAMoMJaY5p2BEOAL8LjyinPXUll/pub?gid=841437823&single=true&output=csv",

    // Carte de membre (onglet Carte_Membre réduit : Nom, Email, Date Adhésion, Statut)
    membres: "https://docs.google.com/spreadsheets/d/e/2PACX-1vQj_2YGaC1qdpYm2WYjnTLhvz-QkDZDG01MCYqZFhoUlvsT2uxjNnPTkOMs-lWlnh6HhbnPi2EGrqK9/pub?gid=438910386&single=true&output=csv",
  },

  /* ---- LIENS EXTERNES ---- */
  liens: {
    ajouterEvenement: "https://tally.so/r/Y5vaVv",           // formulaire Tally d'ajout à l'agenda
    adhesion: "https://donate.stripe.com/3cI14m4814vU6ag7e3awo0y",           // page pour devenir adhérent
    siteWeb: "https://montmartrefestival.com",                // site du festival
    siteAssociation: "https://www.mouvementmontmartre.org",   // site de l'association
    instagram: "https://www.instagram.com/mouvement.montmartre/",
    facebook: "https://www.facebook.com/MouvementMontmartre/",
  },

  /* ---- CONTACTS (page Infos) ---- */
  contacts: {
    general: "mouvementmontmartre@gmail.com",
    festival: "contact@montmartrefestival.com",
    kitPresse: "montmartrefestival.com/presse",
  },

  /* ---- SPONSORS / PARTENAIRES (logo cliquable, affiché sur Accueil + Festival) ---- */
  sponsors: [
    { nom: "KUBO Arts Studio", logo: "icons/sponsor-kubo.jpg", lien: "https://www.kuboartstudios.com" },
    { nom: "La Montmartroise", logo: "icons/sponsor-montmartroise.jpg", lien: "https://montmartroise.fr" },
    { nom: "3615 Radio", logo: "icons/sponsor-3615radio.png", lien: "https://3615.world" },
  ],
};

/* Cadre de la carte de la localité active (voir app.js : localiteCarte()). */
CONFIG.carte = CONFIG.localites[0].carte;
