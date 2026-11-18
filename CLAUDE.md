# Visit Like An Artist (VLAA)

PWA de visites et d'expériences à Montmartre, du Mouvement Montmartre. JS pur (sans framework), Leaflet, service worker, Netlify, Stripe via 3 fonctions Netlify. Le contenu vient encore de Google Sheets publiés en CSV. Supabase est connecté dans `js/config.js` ; le schéma est installé (étape 4) mais l'app ne l'appelle pas encore.

La propriétaire n'est pas développeuse : réponds en français, simplement, et dis-lui exactement quoi cliquer quand une action est de son côté.

Le brief de passation (règles métier, écrans, données, paiement, AR) est fourni par la propriétaire en pièce jointe : il n'est pas stocké ici car le dépôt est public. Le design de référence est le canvas : https://claude.ai/artifact/KvhF7zdMAq3DmJFJzyBiCM (les planches E1 à E44).

## Règles absolues
- **Travaille uniquement sur la branche `dev`.** Ne touche jamais à `main`, n'ouvre aucune pull request, ne déploie rien sans accord explicite.
- Netlify est relié à GitHub : fusionner dans `main` déploie en production, et les crédits Netlify sont limités. « Branch deploys » et « Deploy Previews » sont sur « None ».
- Un commit et un envoi sur `dev` par **étape terminée**, pas par petite modification.
- Avant chaque livraison : `node --check` sur chaque fichier JS, et incrément de `CACHE_VERSION` dans `sw.js` (actuellement `mm-v85`).
- Aucune clé secrète dans le dépôt ni dans le chat (`SUPABASE_SECRET_KEY` et `STRIPE_SECRET_KEY` vivent dans les variables d'environnement Netlify). La clé publiable de `config.js` est publique par conception.
- Pas de longs tirets dans les textes affichés.
- Tout texte affiché passe par `t()` avec ses clés FR, EN, ES (jamais en dur). Dans le CSS, propriétés logiques (`margin-inline-start`, `text-align: start`, `inset-inline-end`) pour que l'arabe de droite à gauche fonctionne.

## Carte du code
- `index.html` : écrans empilés, menu des langues construit par le script.
- `js/app.js` : tout le rendu. Pins : `PIN_ICONS` et `PIN_COLORS` (29 icônes, 3 familles). Types d'expérience : `offreTypeOf()` et `offreBadgeHtml()`. Accueil : `renderAccueil()`. Fiche : `renderVisite()`.
- `js/i18n.js` : `LANG_META` (langues, sens de lecture, polices, repli), dictionnaire `I18N`, `t()`, `trField()` (colonnes `_EN`, `_ES`, `_ZH`, `_AR`, `_RU` des Sheets), `parLangue()`.
- `js/config.js` : marque, vendeur, localités, Supabase (public), sources Sheets.
- `css/style.css` (base) puis `css/theme-fumoir.css` (thème, chargé après : palette noir chaud, couleurs par type, badges, cartes, fiche, menu des langues, arabe).
- `netlify/functions/` : `create-checkout`, `verify-session`, `restore-access` (Stripe Checkout, prix libre et visite guidée relue depuis la Sheet) ; `stripe-webhook` (signature vérifiée, idempotent ; aujourd'hui adhésions, demain réservations) ; `carte` (POST : `voir`, `session`, `lien`) ; `import-adhesions` (reprise unique, code à usage unique). Outils communs : `netlify/lib/commun.js` (produits Stripe d'adhésion, appels Supabase et Stripe, signature).
- `tests/` : bancs d'essai locaux (voir `tests/LISEZMOI.md`), jamais déployés.
- Le service worker (`sw.js`) ne met jamais en cache `/.netlify/functions/`.
- `supabase/schema.sql` : schéma complet de référence (17 tables, 2 vues, droits), pour une base vide ; il refuse de tourner deux fois. `supabase/maj-NN-*.sql` : mises à jour à appliquer, dans l'ordre, sur la base déjà installée ; chaque changement de schéma se fait dans `schema.sql` ET dans un nouveau fichier `maj-NN`. `supabase/test-droits.sql` : 124 essais de droits, ne laisse rien dans la base, à relancer après chaque mise à jour.

## État d'avancement (tout sur `dev`)
1. **Fait** : design système (29 pins, palette, couleurs par type d'expérience, badges).
2. **Fait** : cartes d'accueil et en-tête de fiche. Le prix « 5 € en ligne, le reste sur place », les dates et les places ne sont volontairement **pas affichés** : ils attendent le vrai paiement et le moteur de réservation, sinon l'app promettrait ce qu'elle ne fait pas.
3a. **Fait** : mécanisme multilingue, six langues, arabe de droite à gauche, polices à la demande, repli anglais puis français. Chinois, arabe et russe sont masqués du menu (`pret: false`) ; `?langues=toutes` les affiche pour tester.
4. **Fait** (17/11) : `schema.sql` puis `maj-01-guides-autonomes.sql` installés sur la vraie base, test des droits entièrement OK (pg_cron actif), compte admin créé. Connexion réglée : inscriptions fermées, lien de connexion valable 15 min, URL du site et de redirection `https://montmartre.app`. L'ancien schéma (première proposition) a été rangé dans le schéma `ancien` (non exposé) et ses premières fiches recopiées non publiées (4 visites, 3 guides, incomplètes : prix, jauge, rendez-vous, textes).
   - Envoi des emails par Brevo : `montmartre.app` authentifié le 18/11 (montmartre.tv, autre domaine, reste non authentifié). Les emails de connexion Supabase passent encore par l'envoi intégré : brancher le SMTP Brevo à l'étape 6.
   - Schéma `ancien` à supprimer quand tout fonctionne.
5. **En cours.** Partie 1, **carte de membre branchée sur Stripe** : **écrite et testée sur `dev`, pas en ligne** (la propriétaire veut valider l'ensemble de `dev` avant toute mise en ligne). Avant : la Sheet des adhérents était publique (publication arrêtée le 17/11) ; l'app efface l'ancienne copie `csv:membres` des téléphones.
   - Base : `maj-02-cartes-membre.sql` (tables `adhesions`, `cartes_liens`, `codes_import`, fonctions serveur), à appliquer sur la vraie base puis relancer le test (125 attendus).
   - Adhésion reconnue par **produit** Stripe (`PRODUITS_ADHESION` dans `netlify/lib/commun.js`) : `prod_QtJ7IT1fz5OdTm` abonnement annuel (5 € x quantité, ancien 12 €), `prod_TOOZOTIr3wJsYq` paiement ponctuel (un an à partir du paiement, lien `plink_1SRbm0…`), `prod_Oxr9yYcyaqlt6J` « Bienfaiteur de Montmartre » mensuel (mécénat, carte « bienfaiteur »). Validité = période payée (impayé : jusqu'au début de la période impayée ; arrêt : jusqu'à la fin payée). Le nom saisi dans « Prénom Nom » est gardé.
   - Carte : retour du paiement `?adhesion={CHECKOUT_SESSION_ID}` → carte enregistrée sur le téléphone ; sinon lien par email (`/#carte=<jeton>`, 3 par heure, réponse identique pour un non-adhérent). Hors Stripe : `select public.ajouter_adhesion_manuelle('email', 'Nom', 'AAAA-MM-JJ');` dans le SQL Editor.
   - `CONFIG.liens.adhesion` = adhésion annuelle renouvelable ; `sources.membres` retiré.
   - **À faire par la propriétaire au moment de la mise en ligne** : (1) appliquer `maj-02` + test ; (2) Brevo : domaine `montmartre.app` **authentifié le 18/11** (DNS chez Netlify DNS : code Brevo, DKIM brevo1/brevo2, DMARC p=none ; le domaine est acheté chez OVH mais ses serveurs DNS sont ceux de Netlify), envoi depuis `bonjour@montmartre.app` (pas de boîte mail, réponses vers `mouvementmontmartre@gmail.com`), clé API à créer ; (3) Netlify : variables `BREVO_API_KEY`, `STRIPE_WEBHOOK_SECRET` (et vérifier `SUPABASE_SECRET_KEY`, `STRIPE_SECRET_KEY`) ; (4) Stripe : webhook vers `https://montmartre.app/.netlify/functions/stripe-webhook` avec les 6 évènements listés en tête de `stripe-webhook.js`, et lien d'adhésion `plink_1UcTjA…` réglé pour renvoyer vers `https://montmartre.app/?adhesion={CHECKOUT_SESSION_ID}` ; (5) après mise en ligne : `select public.code_import_creer();` puis ouvrir `https://montmartre.app/.netlify/functions/import-adhesions?code=…` une fois.
   - Questions ouvertes : anciens abonnements (12 € et 5 €) à garder ou non ; liens de carte jamais purgés (à prévoir).
   Partie 2, **réservation et paiement** des visites, ateliers et soirées (décisions de la propriétaire, 18/11) :
   - la source des fiches reste la Sheet tant que l'administration (étape 6) n'existe pas ; la réservation s'affiche sur une fiche dès que l'expérience correspondante (même identifiant que la Sheet = `slug`) est publiée dans Supabase avec ses séances ;
   - blocage 15 min, 5 € par personne en ligne (soirée : prix entier), confirmation par webhook, paiement tardif sans place = remboursement automatique ;
   - minimum non atteint 48 h avant : séance annulée, inscrits remboursés, emails (inscrits, guide ou artiste, `mouvementmontmartre@gmail.com`) ;
   - rappel par email **36 h avant**, avec le bouton « Je ne peux plus venir » ;
   - « Je ne peux plus venir » : place libérée, email au guide et à l'association ; **plus de 24 h avant : les 5 € sont gardés, pas de frais** ; **moins de 24 h avant : 10 € de frais en plus** (15 € perdus en tout), prélevés sur la carte enregistrée au paiement avec l'accord de la personne (texte dans les CGV) ; si la banque demande une validation, email avec un lien de paiement ;
   - absence sans prévenir : le guide signale « absent » d'un geste dans « Mes inscrits » (étape 6), mêmes frais ; l'admin aussi ;
   - emails des intervenants dans une table à part, lisible seulement par l'admin et l'intervenant ;
   - CGV : rédigées par un expert hors de Code (prompt fourni le 18/11), à ajouter à la page Infos et à la case à cocher quand la propriétaire les envoie.
   Partie 3 : accès sans date (autoguidé, escape game) par lien d'accès, remplaçant le déblocage local actuel.
6. **À faire** : espace intervenants et administration **ensemble** (décision du 18/11 : pas d'écran d'administration provisoire), demandes privées, « nous rejoindre ». Administration : créer, compléter et publier les fiches (reprise de la Sheet « Visites », incomplète), dates, prix, emails des intervenants, absences.
3b. **À faire en dernier** : traductions chinois, arabe, russe (relecture par des personnes natives), flèches « → » à remplacer par « ← » en arabe.
7. **À faire** : AR (8th Wall), chargé uniquement à l'ouverture d'une étape AR.

Ordre décidé : 4, 5, 6, 3b, 7.

## Décisions
- Les lieux « public » ont aussi un pin sur la carte, pas seulement les adhérents. Les « invité » restent trouvables par la recherche uniquement.
- Les traductions de contenu se génèrent **une seule fois à l'enregistrement**, puis sont stockées, avec le marquage « traduction automatique » jusqu'à relecture. Pas d'appel de traduction à chaque visite (coût).
- Modèle le plus puissant pour les étapes 4 et 5 (schéma, droits, paiement, relecture de sécurité), modèle courant pour le reste.
- Une session par étape pour garder les conversations courtes.
- Les intervenants sont autonomes sur leurs visites (décision de la propriétaire, 17/11, qui remplace la règle du brief « toute modification validée ») : ils modifient eux-mêmes image, textes, durée, langues, point de départ et jauge minimum et maximum, et choisissent le minimum de leurs séances. Un intervenant qui a un compte peut proposer une nouvelle visite, validée ensuite par l'association. Restent à l'association : prix, pré-réservation, publication, titre d'une visite en ligne, règles d'annulation, mise en ligne des séances.

## Base de données (règles à respecter)
- Tout est fermé par défaut : une nouvelle table ou fonction n'est accessible à personne tant qu'un `grant` et une règle RLS ne sont pas écrits (section 9 de `schema.sql`), puis vérifiés par un essai dans `test-droits.sql`.
- Le navigateur (clé publiable) ne fait que lire le contenu publié. Réservations, accès, paiements et formulaires s'écrivent uniquement depuis les fonctions Netlify (clé secrète) par `reserver_places`, `confirmer_reservation`, `creer_acces`, `activer_acces`. Les prix sont calculés dans la base, jamais reçus du navigateur.
- Le visiteur lit les séances par la vue `seances_publiques` (jauge), jamais la table `seances`. L'intervenant lit ses inscrits par la vue `mes_inscrits`.
- Visites : l'intervenant les modifie directement ; `interne.experiences_garde` filtre les champs permis et `interne.experiences_journal` note chaque changement dans `journal_admin`. Une visite proposée par un intervenant arrive non publiée avec `a_valider = true` et sans prix. Séances : brouillons par l'intervenant, mise en ligne par l'association ; une séance en ligne se modifie par `propositions`, appliquées par `valider_proposition` (liste blanche de champs).
- Les acheteurs n'ont pas de compte : lien d'accès par email, seule l'empreinte SHA-256 du jeton est en base (`acces.jeton_hash`).
- Étapes payantes d'un circuit : jamais lisibles par le navigateur (seules les étapes `apercu` le sont), à servir par une fonction Netlify après vérification de l'accès.
- Noms de tables en français (le brief les proposait en anglais) : experiences, seances, intervenants, lieux, reservations, demandes_groupes, candidatures, propositions.

## Test local
Depuis un conteneur cloud, Google Sheets, Leaflet (unpkg) et les polices sont bloqués : tester avec des données simulées et Leaflet installé en local, jamais en modifiant le dépôt pour ça.
