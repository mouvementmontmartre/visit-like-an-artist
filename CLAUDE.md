# Visit Like An Artist (VLAA)

PWA de visites et d'expériences à Montmartre, du Mouvement Montmartre. JS pur (sans framework), Leaflet, service worker, Netlify, Stripe via 3 fonctions Netlify. Le contenu vient encore de Google Sheets publiés en CSV. Supabase est connecté dans `js/config.js` ; le schéma est installé (étape 4) mais l'app ne l'appelle pas encore.

La propriétaire n'est pas développeuse : réponds en français, simplement, et dis-lui exactement quoi cliquer quand une action est de son côté.

Le brief de passation (règles métier, écrans, données, paiement, AR) est fourni par la propriétaire en pièce jointe : il n'est pas stocké ici car le dépôt est public. Le design de référence est le canvas : https://claude.ai/artifact/KvhF7zdMAq3DmJFJzyBiCM (les planches E1 à E44).

## Règles absolues
- **Travaille uniquement sur la branche `dev`.** Ne touche jamais à `main`, n'ouvre aucune pull request, ne déploie rien sans accord explicite.
- Netlify est relié à GitHub : fusionner dans `main` déploie en production, et les crédits Netlify sont limités. « Branch deploys » et « Deploy Previews » sont sur « None ».
- Un commit et un envoi sur `dev` par **étape terminée**, pas par petite modification.
- Avant chaque livraison : `node --check` sur chaque fichier JS, et incrément de `CACHE_VERSION` dans `sw.js` (actuellement `mm-v84`).
- Aucune clé secrète dans le dépôt ni dans le chat (`SUPABASE_SECRET_KEY` et `STRIPE_SECRET_KEY` vivent dans les variables d'environnement Netlify). La clé publiable de `config.js` est publique par conception.
- Pas de longs tirets dans les textes affichés.
- Tout texte affiché passe par `t()` avec ses clés FR, EN, ES (jamais en dur). Dans le CSS, propriétés logiques (`margin-inline-start`, `text-align: start`, `inset-inline-end`) pour que l'arabe de droite à gauche fonctionne.

## Carte du code
- `index.html` : écrans empilés, menu des langues construit par le script.
- `js/app.js` : tout le rendu. Pins : `PIN_ICONS` et `PIN_COLORS` (29 icônes, 3 familles). Types d'expérience : `offreTypeOf()` et `offreBadgeHtml()`. Accueil : `renderAccueil()`. Fiche : `renderVisite()`.
- `js/i18n.js` : `LANG_META` (langues, sens de lecture, polices, repli), dictionnaire `I18N`, `t()`, `trField()` (colonnes `_EN`, `_ES`, `_ZH`, `_AR`, `_RU` des Sheets), `parLangue()`.
- `js/config.js` : marque, vendeur, localités, Supabase (public), sources Sheets.
- `css/style.css` (base) puis `css/theme-fumoir.css` (thème, chargé après : palette noir chaud, couleurs par type, badges, cartes, fiche, menu des langues, arabe).
- `netlify/functions/` : `create-checkout`, `verify-session`, `restore-access` (Stripe Checkout, prix libre et visite guidée relue depuis la Sheet).
- `supabase/schema.sql` : schéma complet de référence (17 tables, 2 vues, droits), pour une base vide ; il refuse de tourner deux fois. `supabase/maj-NN-*.sql` : mises à jour à appliquer, dans l'ordre, sur la base déjà installée ; chaque changement de schéma se fait dans `schema.sql` ET dans un nouveau fichier `maj-NN`. `supabase/test-droits.sql` : 94 essais de droits, ne laisse rien dans la base, à relancer après chaque mise à jour.

## État d'avancement (tout sur `dev`)
1. **Fait** : design système (29 pins, palette, couleurs par type d'expérience, badges).
2. **Fait** : cartes d'accueil et en-tête de fiche. Le prix « 5 € en ligne, le reste sur place », les dates et les places ne sont volontairement **pas affichés** : ils attendent le vrai paiement et le moteur de réservation, sinon l'app promettrait ce qu'elle ne fait pas.
3a. **Fait** : mécanisme multilingue, six langues, arabe de droite à gauche, polices à la demande, repli anglais puis français. Chinois, arabe et russe sont masqués du menu (`pret: false`) ; `?langues=toutes` les affiche pour tester.
4. **Presque fait** : `schema.sql` installé sur la vraie base, test des droits OK (77/77, pg_cron actif), compte admin créé. L'ancien schéma (première proposition) a été rangé dans le schéma `ancien` (non exposé) et ses premières fiches recopiées non publiées (4 visites, 3 guides). Reste côté propriétaire : appliquer `maj-01-guides-autonomes.sql` puis relancer le test (94 essais), régler la connexion (inscriptions fermées, lien 15 min, URL du site `https://montmartre.app`).
   - Envoi des emails par Brevo : aucun domaine n'y est authentifié (montmartre.tv en attente) ; garder l'envoi intégré de Supabase jusqu'à l'étape 6, puis authentifier `montmartre.app` dans Brevo et brancher le SMTP.
   - Schéma `ancien` à supprimer quand tout fonctionne.
5. **À faire** : réservation et paiement (créneaux, blocage 15 min, webhook Stripe, minimum de participants, remboursement automatique, emails).
6. **À faire** : espace intervenants, administration, demandes privées, « nous rejoindre ».
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
