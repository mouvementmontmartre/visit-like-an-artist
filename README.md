# App Mouvement Montmartre

Application web (PWA) du Montmartre Festival et de la vie du quartier :
programme, cartes, visites guidées, agenda culturel, carte de membre.

Fichiers statiques (HTML/CSS/JS pur, sans framework) + deux petites
fonctions Netlify pour le paiement Stripe. Tout le contenu vit dans
des Google Sheets : **mettre l'app à jour = modifier une Sheet**,
jamais le code.

---

## 1. Déployer sur Netlify (5 minutes)

1. Créez un compte gratuit sur https://app.netlify.com
2. Sur le tableau de bord : **Add new site → Deploy manually**
3. Glissez-déposez **tout le dossier** de l'app (celui qui contient
   `index.html` et `netlify.toml`) dans la zone de dépôt
4. Netlify vous donne une URL du type `nom-aleatoire.netlify.app`.
   Vous pouvez la personnaliser (Site settings → Change site name)
   ou brancher un sous-domaine comme `app.montmartrefestival.com`
   (Domain settings → Add a domain)

À chaque mise à jour du code : re-glissez le dossier au même endroit.
**Important** : après toute modification d'un fichier du code, ouvrez
`sw.js` et incrémentez `CACHE_VERSION` (mm-v1 → mm-v2) pour que les
utilisateurs qui ont déjà l'app reçoivent la mise à jour.

## 2. Mettre à jour le contenu (sans coder)

| Quoi | Où |
|---|---|
| Événements de l'agenda | Formulaire Tally (https://tally.so/r/Y5vaVv) → apparaît tout seul |
| Ajouter/retirer une visite guidée | Google Sheet Visites : une ligne par visite, `Actif` = Oui/Non |
| Étapes du parcours d'une visite | Google Sheet Points_Visites : `id` = id de la visite, `Ordre` = séquence. Le point `Type` = `depart` est public ; tous les autres sont réservés aux acheteurs |
| Programme du festival (horaires, lieux) | Google Sheet "Programme_Festival" (voir structure ci-dessous), lien à ajouter dans `js/config.js` → `sources.programmeFestival` |
| Points de la carte du festival | Google Sheet Parcours Festival |
| Adhérents (carte de membre) | Votre liste d'adhérents → onglet Carte_Membre (mis à jour par formules) |
| Thème/dates de l'édition | `js/config.js`, bloc `edition` |
| Lieux de la carte du quartier | `js/data-lieux.js` (fichier commenté, éditable au bloc-notes) |
| Programme du festival | `js/data-lieux.js`, bloc `PROGRAMME_FESTIVAL` |
| Textes des pages Infos | `js/app.js`, fonctions `renderInfos` / `renderInfosFestival` |
| Logos partenaires | Remplacer les blocs `sponsor-strip` dans `index.html` par `<img>` |

Les liens des Google Sheets sont regroupés dans `js/config.js`.
Si vous republiez une Sheet (nouveau lien CSV), remplacez-le là.

## 3. Configurer le paiement Stripe

Le paiement débloque le contenu d'une visite (points du parcours,
récits, médias) sur l'appareil de l'acheteur. Deux modes : visite
guidée au tarif de la Sheet, ou accès autoguide à prix libre (min 5 €).

1. Dans votre tableau de bord Stripe : **Développeurs → Clés API**,
   copiez la **clé secrète** (commence par `sk_live_` ; utilisez
   `sk_test_` pour essayer sans vrais paiements)
2. Dans Netlify : **Site settings → Environment variables →
   Add a variable** :
   - Key : `STRIPE_SECRET_KEY`
   - Value : votre clé secrète
3. Redéployez le site (re-glissez le dossier) pour que la variable
   soit prise en compte

C'est tout : pas de produit à créer dans Stripe, les fonctions créent
les sessions à la volée. Le prix de la visite guidée est **relu côté
serveur depuis la Sheet Visites** (colonne Tarif direct), donc
impossible à trafiquer depuis le navigateur. Les emails des acheteurs
sont visibles dans Stripe (Paiements), exportables en CSV.

Tant que la clé n'est pas configurée, l'app fonctionne normalement :
le bouton d'accès autoguide affiche simplement « momentanément
indisponible ».

À savoir, honnêtement : le déblocage est enregistré sur l'appareil
qui a payé. Quelqu'un de très déterminé qui inspecte le code peut le
contourner ; pour un contenu culturel à petit prix, c'est un
compromis raisonnable, mais ce n'est pas un coffre-fort.

## 3bis. Structure de la Sheet Programme_Festival

Une seule ligne par événement :

`Date | Heure début | Heure fin | Titre | Lieu | Description`

Format de Date libre (JJ/MM/AAAA ou AAAA-MM-JJ). Les onglets VEN/SAM/DIM
de l'écran Festival sont calculés automatiquement à partir des dates de
l'édition dans `config.js` (`edition.dateDebut` / `dateFin`), jamais
codés en dur : changez les dates dans `config.js`, les onglets suivent
tout seuls. Une fois la Sheet publiée en CSV (Fichier → Partager →
Publier sur le web → format CSV), collez le lien dans `config.js` →
`sources.programmeFestival`.

**Important à vérifier avant impression de tout support physique** :
25-26-27 septembre 2027 tombent un samedi-dimanche-lundi, pas un
vendredi-samedi-dimanche. Si le festival doit être Ven-Sam-Dim,
ajustez les dates dans `config.js`.

## 4. Changer le thème d'une édition

Dans `js/config.js`, bloc `edition` : titre, thème, dates, et
éventuellement une couleur d'accent. L'identité de base (nuit de
cabaret, vélin, fée verte, lueur de gaz, logo) ne change jamais.

## 5. Structure des fichiers

```
index.html              coquille de l'app (tous les écrans)
css/style.css           identité visuelle complète
js/config.js            ← LE fichier de configuration
js/csv.js               lecture des Google Sheets (avec cache hors-ligne)
js/data-lieux.js        lieux du quartier + programme du festival
js/app.js               logique de l'app
manifest.json           installation sur écran d'accueil
sw.js                   mode hors-ligne (CACHE_VERSION à incrémenter)
icons/                  logo et icônes
netlify.toml            configuration Netlify
netlify/functions/      les 2 fonctions de paiement Stripe
```

---

## 6. Projet tourisme : marque, vendeur, localités (étape 1)

- **Marque** : `CONFIG.marque` dans `js/config.js` (nom, nom court, slogan par langue). Les textes utilisent `{localite}`, `{marque}`, `{slogan}`. À changer aussi à la main : `<title>` et balises og de `index.html`, `manifest.json`.
- **Vendeur et bénéficiaire** : `CONFIG.vendeur` (nom, adresse, RNA, SIRET, mention TVA, compte Stripe public). Lu par la page Infos, et par les pages légales et emails à venir. Champs vides = non affichés.
- **Localités** : `CONFIG.localites` + colonne **Localité** dans les Google Sheets (vide = localité par défaut). Un sélecteur apparaît sur l'accueil dès qu'il y a 2 localités actives.
- **Stripe (compte Mouvement Montmartre)** : produits créés le 16/11/2026. « Visite autoguidée » `prod_VdmBCR5tA6QyDQ` (prix `price_1UcUdLCtjp0QuQA6vsZBE1HG`, 5 €, prix libre min. 5 € côté serveur) et « Frais de réservation visite guidée » `prod_VdmBCvLbmSs7Th` (prix `price_1UcUdNCtjp0QuQA6tEQun5Yh`, 5 €).
- **Base de données** : `supabase/schema.sql` (proposition, non connectée).
