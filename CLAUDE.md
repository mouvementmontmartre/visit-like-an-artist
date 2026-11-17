# Visit Like An Artist (VLAA)

PWA de visites et d'expériences à Montmartre, du Mouvement Montmartre. JS pur (sans framework), Leaflet, service worker, Netlify, Stripe via 3 fonctions Netlify. Le contenu vient encore de Google Sheets publiés en CSV. Supabase est connecté dans `js/config.js` mais **la base est vide** et l'app ne l'appelle pas encore.

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
- `supabase/schema.sql` : **ancienne proposition**, à refaire (voir étape 4).

## État d'avancement (tout sur `dev`)
1. **Fait** : design système (29 pins, palette, couleurs par type d'expérience, badges).
2. **Fait** : cartes d'accueil et en-tête de fiche. Le prix « 5 € en ligne, le reste sur place », les dates et les places ne sont volontairement **pas affichés** : ils attendent le vrai paiement et le moteur de réservation, sinon l'app promettrait ce qu'elle ne fait pas.
3a. **Fait** : mécanisme multilingue, six langues, arabe de droite à gauche, polices à la demande, repli anglais puis français. Chinois, arabe et russe sont masqués du menu (`pret: false`) ; `?langues=toutes` les affiche pour tester.
4. **À faire** : schéma Supabase (base vide), droits d'accès (RLS), connexion par lien magique.
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

## Test local
Depuis un conteneur cloud, Google Sheets, Leaflet (unpkg) et les polices sont bloqués : tester avec des données simulées et Leaflet installé en local, jamais en modifiant le dépôt pour ça.
