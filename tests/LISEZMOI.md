# Tests locaux (conteneur de développement, jamais en production)

Rien ici n'est déployé ni appelé par l'app. Ces fichiers servent à vérifier
la base et les fonctions Netlify avant chaque livraison.

1. Base PostgreSQL 16 locale qui imite Supabase (rôles `anon`, `authenticated`,
   `service_role`, schéma `auth`) : `tests/supabase-local.sql` (en superutilisateur),
   puis dans la base créée : `create schema extensions; create extension pgcrypto schema extensions;`,
   puis `supabase/schema.sql`, puis `supabase/test-droits.sql` (doit afficher « TOUT EST OK »).
2. Fonctions de la carte de membre contre cette base, avec de faux Stripe et Brevo :
   `npm i pg` dans un dossier à part, puis (avec `NODE_PATH=<ce dossier>/node_modules`)
   `node tests/carte-fonctions.test.js <chemin du dépôt> <nom de la base>`.
3. Écran de la carte dans Chromium (Playwright), réponses du serveur simulées :
   `node tests/carte-ecran.test.js <chemin du dépôt> <dossier des captures>`.

Données de test uniquement (adresses en `@exemple.invalid`), jamais de vraies données d'adhérents.
4. Connexion à l'espace intervenants : `node tests/espace-ecran.test.js <chemin du dépôt>`.
5. Administration (fiches, intervenants, photos, invitation, reprise de la Sheet, lecture des fiches par l'app),
   Supabase simulé en mémoire : `node tests/admin-ecran.test.js <chemin du dépôt> [dossier des captures]`.
6. Fonction d'invitation, Supabase et Brevo simulés : `node tests/inviter-fonction.test.js <chemin du dépôt>`.
La base locale imite aussi le stockage de Supabase (`storage.buckets`, `storage.objects`) pour les essais de droits des photos.
7. Formulaires publics : `node tests/demande-fonction.test.js <dépôt>` et `node tests/demande-ecran.test.js <dépôt> [captures]`.
8. Page d'un intervenant, vidéo, traductions : `node tests/hote-ecran.test.js <dépôt> [captures]` et `node tests/traduire-fonction.test.js <dépôt>`.
9. Parcours autoguidés : `NODE_PATH=<dossier avec pg> node tests/parcours-fonctions.test.js <dépôt> <base>` (vraie base locale) et `node tests/parcours-ecran.test.js <dépôt> [captures]`.
10. Lot du 22/11 (connexion unique par code, Mon compte, intervenants autonomes, validations, notifications) :
   `NODE_PATH=<dossier avec pg> node tests/intervenants-fonctions.test.js <dépôt> <base>` (vraie base locale, à jour de maj-18 ;
   faux Supabase Auth et Brevo) et `node tests/compte-ecran.test.js <dépôt> [captures]` (Mon compte, routage, lien de connexion,
   pilules sur une ligne, affichage sur ordinateur).
