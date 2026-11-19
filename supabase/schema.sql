-- ============================================================
-- ARTDIVE : schéma de la base (étape 4)
--
-- À coller EN ENTIER dans Supabase > SQL Editor, sur une base vide,
-- puis cliquer sur « Run ». Tout passe ou rien ne passe : en cas
-- d'erreur, rien n'est créé.
-- Ensuite : lancer supabase/test-droits.sql pour vérifier les droits.
--
-- Principes de sécurité
--  1. Le visiteur (clé publiable) ne fait que LIRE le contenu publié.
--  2. Réservations, paiements et formulaires sont écrits uniquement
--     par les fonctions Netlify (clé secrète), jamais par le navigateur.
--  3. Un intervenant (lien magique) ne voit que ses séances et ses
--     inscrits. Il modifie lui-même ses visites (textes, image, durée,
--     langues, point de départ, jauge) et propose de nouvelles visites,
--     que l'association valide. Il ne touche ni aux prix, ni à la
--     publication, ni aux remboursements.
--  4. Tout est fermé par défaut : un droit n'existe que s'il est
--     écrit plus bas (section 9).
--
-- Montants en centimes d'euro. Textes traduits en jsonb :
-- {"fr": "...", "en": "..."} ; la colonne langues_relues liste les
-- langues relues par une personne (les autres portent la mention
-- « traduction automatique » dans l'app).
-- ============================================================

begin;

-- Garde-fou : ne rien faire si le schéma est déjà installé.
do $$
begin
  if to_regclass('public.experiences') is not null
     or to_regclass('public.reservations') is not null then
    raise exception 'Le schéma est déjà installé : ce fichier est prévu pour une base vide.';
  end if;
end $$;

-- Schéma technique : fonctions d'aide, non exposé par l'API.
create schema if not exists interne;

-- ============================================================
-- 1. TABLES DE BASE
-- ============================================================

create table public.localites (
  id   text primary key check (id ~ '^[a-z0-9-]+$'),   -- = id de js/config.js
  nom  text not null,
  actif boolean not null default true
);
insert into public.localites (id, nom) values ('montmartre', 'Montmartre');

-- Lieux de l'écosystème (pins de la carte et recherche)
create table public.lieux (
  id           uuid primary key default gen_random_uuid(),
  localite_id  text not null references public.localites(id),
  slug         text not null unique check (slug ~ '^[a-z0-9-]+$'),
  nom          text not null,
  famille      text not null check (famille in ('culture', 'sortir', 'reperes')),
  categorie    text not null,                 -- clé de l'icône (PIN_ICONS dans app.js)
  visibilite   text not null default 'invite'
               check (visibilite in ('adherent', 'public', 'invite')),
  adresse      text,
  lat          double precision check (lat between -90 and 90),
  lng          double precision check (lng between -180 and 180),
  description  jsonb not null default '{}',
  site         text,
  instagram    text,
  facebook     text,
  telephone    text,                          -- téléphone PUBLIC du lieu
  photo_url    text,
  langues_relues text[] not null default '{fr}',
  publie       boolean not null default false,
  cree_le      timestamptz not null default now(),
  maj_le       timestamptz not null default now()
);

-- Intervenants : guides, artistes, lieux partenaires (fiche publique)
create table public.intervenants (
  id           uuid primary key default gen_random_uuid(),
  localite_id  text not null references public.localites(id),
  slug         text not null unique check (slug ~ '^[a-z0-9-]+$'),
  type         text not null check (type in ('guide', 'artiste', 'lieu', 'autre')),
  nom          text not null,
  role         jsonb not null default '{}',   -- « Historien de l'art »
  bio          jsonb not null default '{}',
  photo_url    text,
  video_url    text,
  sous_titres_url text,
  langues      text[] not null default '{fr}',  -- langues parlées
  instagram    text,
  liens        jsonb not null default '{}',
  lieu_id      uuid references public.lieux(id) on delete set null,
  langues_relues text[] not null default '{fr}',
  ordre        integer not null default 0,
  publie       boolean not null default false,
  cree_le      timestamptz not null default now(),
  maj_le       timestamptz not null default now()
);

-- Comptes : un par personne qui se connecte (lien magique).
-- Les acheteurs n'ont PAS de compte.
create table public.profils (
  user_id        uuid primary key references auth.users(id) on delete cascade,
  role           text not null check (role in ('admin', 'intervenant')),
  intervenant_id uuid references public.intervenants(id) on delete set null,
  cree_le        timestamptz not null default now(),
  check (role = 'admin' or intervenant_id is not null)
);
create unique index profils_un_compte_par_intervenant
  on public.profils (intervenant_id) where intervenant_id is not null;

-- ============================================================
-- 2. FONCTIONS D'AIDE (utilisées par les règles d'accès)
-- ============================================================

create function interne.est_admin() returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.profils
    where user_id = (select auth.uid()) and role = 'admin'
  );
$$;

create function interne.mon_intervenant_id() returns uuid
language sql stable security definer set search_path = ''
as $$
  select intervenant_id from public.profils where user_id = (select auth.uid());
$$;

-- Référence lisible d'une réservation, ex. AD-2K7F9Q (sans 0, O, 1, I)
create function interne.nouvelle_reference() returns text
language sql volatile set search_path = ''
as $$
  select 'AD-' || string_agg(
           substr('23456789ABCDEFGHJKLMNPQRSTUVWXYZ', (get_byte(b, i) % 32) + 1, 1), '')
  from (select uuid_send(gen_random_uuid()) as b) x, generate_series(0, 5) as i;
$$;

-- « Camille Durand » devient « Camille D. » (liste des inscrits)
create function interne.nom_court(p text) returns text
language sql immutable set search_path = ''
as $$
  select case
           when n = '' then ''
           when position(' ' in n) = 0 then n
           else split_part(n, ' ', 1) || ' ' || upper(left(regexp_replace(n, '^.* ', ''), 1)) || '.'
         end
  from (select btrim(regexp_replace(coalesce(p, ''), '\s+', ' ', 'g')) as n) x;
$$;

create function interne.touche_maj() returns trigger
language plpgsql set search_path = ''
as $$
begin
  new.maj_le := now();
  return new;
end $$;

create trigger lieux_maj before update on public.lieux
  for each row execute function interne.touche_maj();
create trigger intervenants_maj before update on public.intervenants
  for each row execute function interne.touche_maj();

-- ============================================================
-- 3. EXPÉRIENCES ET ÉTAPES
-- ============================================================

create table public.experiences (
  id            uuid primary key default gen_random_uuid(),
  localite_id   text not null references public.localites(id),
  slug          text not null unique check (slug ~ '^[a-z0-9-]+$'),
  type          text not null check (type in
                  ('visite_guidee', 'autoguidee', 'atelier', 'soiree', 'escape_game')),
  theme         text,                   -- relie deux formats d'un même thème (E2)
  titre         jsonb not null check (jsonb_typeof(titre) = 'object'),
  accroche      jsonb not null default '{}',
  description   jsonb not null default '{}',
  bon_a_savoir  jsonb not null default '{}',
  duree_minutes integer check (duree_minutes > 0),
  langues       text[] not null default '{fr}',
  photo_url     text,
  intervenant_id uuid references public.intervenants(id) on delete set null,
  lieu_id       uuid references public.lieux(id) on delete set null,
  point_rdv     jsonb not null default '{}',     -- rendez-vous PUBLIC (approximatif)
  point_rdv_lat double precision check (point_rdv_lat between -90 and 90),
  point_rdv_lng double precision check (point_rdv_lng between -180 and 180),

  -- Argent (admin uniquement)
  prix_centimes               integer check (prix_centimes >= 0),
      -- visite, atelier, soirée : prix complet par personne ; escape game : prix par équipe
  prereservation_centimes     integer check (prereservation_centimes >= 0),
      -- visite, atelier : part payée en ligne par personne (5 €)
  prix_libre_min_centimes     integer check (prix_libre_min_centimes >= 0),
      -- autoguidée : minimum du prix libre (5 €)
  option_audioguide_centimes  integer check (option_audioguide_centimes >= 0),
      -- autoguidée : audioguide en option (4 €) ; vide = pas d'option

  -- Jauge (modifiable par l'intervenant de la visite)
  capacite_max        integer check (capacite_max > 0),
  participants_min    integer not null default 1 check (participants_min >= 1),
  delai_annulation_heures integer not null default 48 check (delai_annulation_heures >= 0),
  telephone_obligatoire boolean not null default false,
  privatisable        boolean not null default false,
  age_minimum         integer check (age_minimum between 1 and 99),   -- soirées : âge minimum à confirmer
  frais_annulation_tardive_centimes integer not null default 1000 check (frais_annulation_tardive_centimes >= 0),
      -- par personne, en plus de la pré-réservation, si annulation tardive ou absence
  delai_frais_heures  integer not null default 24 check (delai_frais_heures >= 0),

  nb_etapes     integer not null default 0,      -- tenu à jour automatiquement
  langues_relues text[] not null default '{fr}',
  ordre         integer not null default 0,
  actif         boolean not null default true,   -- coupe-circuit sans dépublier
  publie        boolean not null default false,
  a_valider     boolean not null default false,  -- proposée par un intervenant
  cree_le       timestamptz not null default now(),
  maj_le        timestamptz not null default now(),

  constraint experiences_min_max check (capacite_max is null or participants_min <= capacite_max),

  -- Impossible de publier une expérience dont les prix sont incomplets
  constraint experiences_prix_complets check (
    not publie or case type
      when 'visite_guidee' then prix_centimes is not null and capacite_max is not null
                                and prereservation_centimes is not null
                                and prereservation_centimes <= prix_centimes
      when 'atelier'       then prix_centimes is not null and capacite_max is not null
                                and prereservation_centimes is not null
                                and prereservation_centimes <= prix_centimes
      when 'soiree'        then prix_centimes is not null and capacite_max is not null
      when 'escape_game'   then prix_centimes is not null
      when 'autoguidee'    then prix_libre_min_centimes is not null
    end
  )
);
create index experiences_intervenant on public.experiences (intervenant_id);
create trigger experiences_maj before update on public.experiences
  for each row execute function interne.touche_maj();

-- ---- Visites gérées par leur intervenant ----
-- L'intervenant modifie lui-même sa visite (image, textes, durée,
-- langues, point de départ, jauge minimum et maximum), sans validation.
-- Il peut aussi proposer une nouvelle visite : elle arrive non publiée,
-- marquée « à valider », sans prix. L'association fixe le prix et publie.
-- Prix, pré-réservation, publication, type et règles d'annulation
-- restent réservés à l'association. Chaque changement est journalisé.

create or replace function interne.slugifier(p text) returns text
language sql immutable set search_path = ''
as $$
  select coalesce(nullif(trim(both '-' from regexp_replace(
           translate(lower(coalesce(p, '')),
             'àâäáãçéèêëíìîïñóòôöõúùûüýÿœ''’',
             'aaaaaceeeeiiiinooooouuuuyyo--'),
           '[^a-z0-9]+', '-', 'g')), ''), 'visite');
$$;

create or replace function interne.experiences_garde() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  restreint boolean := (select auth.uid()) is not null and not interne.est_admin();
  moi uuid;
  libres text[] := array['photo_url', 'description', 'accroche', 'bon_a_savoir',
    'duree_minutes', 'langues', 'point_rdv', 'point_rdv_lat', 'point_rdv_lng',
    'capacite_max', 'participants_min', 'langues_relues', 'nb_etapes', 'maj_le'];
begin
  if not restreint then return new; end if;
  moi := interne.mon_intervenant_id();
  if moi is null then raise exception 'Réservé aux intervenants.'; end if;

  if tg_op = 'INSERT' then
    if new.type not in ('visite_guidee', 'atelier') then
      raise exception 'Un intervenant peut proposer une visite guidée ou un atelier.';
    end if;
    new.intervenant_id := moi;
    select localite_id into new.localite_id from public.intervenants where id = moi;
    new.slug := interne.slugifier(new.titre->>'fr') || '-'
                || substr(replace(gen_random_uuid()::text, '-', ''), 1, 4);
    new.theme := null;
    new.lieu_id := null;
    new.prix_centimes := null;                 -- fixé par l'association
    new.prereservation_centimes := 500;
    new.prix_libre_min_centimes := null;
    new.option_audioguide_centimes := null;
    new.delai_annulation_heures := 48;
    new.telephone_obligatoire := true;
    new.privatisable := false;
    new.nb_etapes := 0;
    new.langues_relues := '{fr}';
    new.ordre := 0;
    new.actif := true;
    new.publie := false;
    new.a_valider := true;
    new.cree_le := now();
    new.maj_le := now();
    return new;
  end if;

  -- Modification : tant que la visite n'est pas en ligne, le titre aussi.
  if not old.publie then libres := libres || array['titre']; end if;
  if (to_jsonb(new) - libres) is distinct from (to_jsonb(old) - libres) then
    raise exception 'Seule l''association peut modifier le prix, la pré-réservation, la publication, le titre d''une visite en ligne et les règles d''annulation.';
  end if;
  if new.capacite_max is not null and new.participants_min > new.capacite_max then
    raise exception 'Le minimum (%) dépasse le nombre de places (%).', new.participants_min, new.capacite_max;
  end if;
  -- Textes changés : les traductions seront à refaire puis à relire.
  if new.titre is distinct from old.titre or new.description is distinct from old.description
     or new.accroche is distinct from old.accroche or new.bon_a_savoir is distinct from old.bon_a_savoir
     or new.point_rdv is distinct from old.point_rdv then
    new.langues_relues := array['fr'];
  end if;
  return new;
end $$;

create or replace function interne.experiences_journal() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  avant jsonb := case when tg_op = 'UPDATE' then to_jsonb(old) else '{}'::jsonb end;
  apres jsonb := to_jsonb(new);
  v_details jsonb;
begin
  if (select auth.uid()) is null or interne.est_admin() then return null; end if;
  select coalesce(jsonb_object_agg(k, jsonb_build_object('avant', avant->k, 'apres', apres->k)), '{}')
    into v_details
    from jsonb_object_keys(apres) as k
   where k not in ('maj_le', 'cree_le', 'langues_relues')
     and (tg_op = 'INSERT' or apres->k is distinct from avant->k);
  if tg_op = 'UPDATE' and v_details = '{}'::jsonb then return null; end if;
  insert into public.journal_admin (acteur, action, cible_table, cible_id, details)
  values ((select auth.uid()),
          case tg_op when 'INSERT' then 'visite_proposee' else 'visite_modifiee' end,
          'experiences', new.id, v_details);
  return null;
end $$;

drop trigger if exists experiences_garde on public.experiences;
create trigger experiences_garde before insert or update on public.experiences
  for each row execute function interne.experiences_garde();
drop trigger if exists experiences_journal on public.experiences;
create trigger experiences_journal after insert or update on public.experiences
  for each row execute function interne.experiences_journal();

-- Étapes d'un circuit (autoguidé, escape game).
-- Le visiteur ne lit que les étapes « apercu » ; les autres sont
-- servies par le serveur après vérification de l'achat.
create table public.etapes (
  id            uuid primary key default gen_random_uuid(),
  experience_id uuid not null references public.experiences(id) on delete cascade,
  ordre         integer not null check (ordre >= 0),
  type          text not null default 'etape' check (type in ('depart', 'etape', 'ar')),
  apercu        boolean not null default false,   -- offerte avant l'achat
  nom           jsonb not null check (jsonb_typeof(nom) = 'object'),
  resume        jsonb not null default '{}',
  texte         jsonb not null default '{}',
  a_reperer     jsonb not null default '{}',
  lat           double precision check (lat between -90 and 90),
  lng           double precision check (lng between -180 and 180),
  rayon_deblocage_m integer not null default 30 check (rayon_deblocage_m > 0),
  media_url     text,
  media_credit  text,
  audio         jsonb not null default '{}',      -- {"fr": "url", "en": "url"}
  ar            jsonb not null default '{}',      -- réglages 8th Wall (étape 7)
  langues_relues text[] not null default '{fr}',
  unique (experience_id, ordre)
);

-- Codes affichés sur place (E2.1.3 « Saisir le code ») : jamais lisibles
-- par le navigateur, le serveur compare.
create table public.etapes_codes (
  etape_id uuid primary key references public.etapes(id) on delete cascade,
  code     text not null check (length(code) between 3 and 40)
);

create function interne.recompte_etapes() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  update public.experiences e
     set nb_etapes = (select count(*) from public.etapes t where t.experience_id = e.id)
   where e.id in (
     case when tg_op <> 'INSERT' then old.experience_id end,
     case when tg_op <> 'DELETE' then new.experience_id end);
  return null;
end $$;
create trigger etapes_recompte after insert or delete or update of experience_id on public.etapes
  for each row execute function interne.recompte_etapes();

-- ============================================================
-- 4. SÉANCES ET RÉSERVATIONS
-- ============================================================

create table public.seances (
  id            uuid primary key default gen_random_uuid(),
  experience_id uuid not null references public.experiences(id) on delete restrict,
  debut         timestamptz not null,
  fin           timestamptz,
  langue        text not null default 'fr' check (langue in ('fr', 'en', 'es', 'zh', 'ar', 'ru')),
  capacite_max     integer not null check (capacite_max > 0),
  participants_min integer not null check (participants_min >= 1),
  point_rdv        text,            -- PUBLIC
  point_rdv_precis text,            -- envoyé par email aux inscrits seulement
  message_inscrits text,            -- « je porte un chapeau gris »
  statut        text not null default 'brouillon'
                check (statut in ('brouillon', 'en_attente', 'publiee', 'annulee')),
  annulee_le       timestamptz,
  motif_annulation text,
  minimum_verifie_le timestamptz,   -- minimum atteint au moment du contrôle (48 h avant)
  cree_par      uuid default auth.uid(),
  cree_le       timestamptz not null default now(),
  maj_le        timestamptz not null default now(),
  check (fin is null or fin > debut),
  check (participants_min <= capacite_max)
);
create index seances_experience_debut on public.seances (experience_id, debut);

-- Garde-fou des séances : remplit la jauge depuis l'expérience et empêche
-- un intervenant de sortir de ce qu'il a le droit de faire, même s'il
-- envoie d'autres valeurs depuis son navigateur. Le minimum d'une séance
-- est choisi par l'intervenant ; la séance n'est mise en ligne que par
-- l'association.
create function interne.seances_garde() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  e public.experiences;
  restreint boolean := (select auth.uid()) is not null and not interne.est_admin();
begin
  select * into e from public.experiences where id = new.experience_id;
  if e.type not in ('visite_guidee', 'atelier', 'soiree') then
    raise exception 'Ce type d''expérience n''a pas de séances datées.';
  end if;

  if new.capacite_max is null then new.capacite_max := e.capacite_max; end if;
  if new.participants_min is null then new.participants_min := e.participants_min; end if;

  if restreint then
    if new.capacite_max > e.capacite_max then
      raise exception 'Nombre de places : % maximum pour cette expérience.', e.capacite_max;
    end if;
    if new.statut not in ('brouillon', 'en_attente') then
      raise exception 'Seule l''association peut publier ou annuler une séance.';
    end if;
    new.annulee_le := null;
    new.motif_annulation := null;
    if tg_op = 'UPDATE' then
      if new.experience_id <> old.experience_id then
        raise exception 'Une séance ne peut pas changer d''expérience.';
      end if;
      new.cree_par := old.cree_par;
      new.cree_le := old.cree_le;
    else
      new.cree_par := (select auth.uid());
    end if;
  end if;

  new.maj_le := now();
  return new;
end $$;
create trigger seances_garde before insert or update on public.seances
  for each row execute function interne.seances_garde();

create table public.reservations (
  id            uuid primary key default gen_random_uuid(),
  reference     text not null unique default interne.nouvelle_reference(),
  seance_id     uuid not null references public.seances(id) on delete restrict,
  experience_id uuid not null references public.experiences(id) on delete restrict,
  nom           text not null check (length(btrim(nom)) between 1 and 120),
  email         text not null check (email = lower(email) and email ~ '^[^\s@]+@[^\s@]+\.[^\s@]+$'
                                     and length(email) <= 254),
  telephone     text check (length(telephone) <= 30),
  telephone_efface_le timestamptz,
  langue        text not null default 'fr',
  personnes     integer not null check (personnes > 0),
  statut        text not null default 'en_attente'
                check (statut in ('en_attente', 'confirmee', 'expiree', 'annulee', 'remboursee')),
  bloque_jusqua timestamptz,                      -- blocage 15 minutes
  -- Montants figés au moment de la réservation
  prix_unitaire_centimes   integer not null check (prix_unitaire_centimes >= 0),
  total_centimes           integer not null check (total_centimes >= 0),
  paye_en_ligne_centimes   integer not null check (paye_en_ligne_centimes >= 0),
  reste_sur_place_centimes integer not null check (reste_sur_place_centimes >= 0),
  cgv_acceptees_le timestamptz not null,
  stripe_session_id     text unique,
  stripe_payment_intent text unique,
  cree_le       timestamptz not null default now(),
  confirmee_le  timestamptz,
  annulee_le    timestamptz,
  motif_annulation text,
  -- Carte enregistrée (accord donné au paiement) pour les frais d'annulation tardive
  stripe_customer       text,
  stripe_payment_method text,
  accord_frais_le       timestamptz,
  cgv_version   text,                     -- version des CGV acceptée
  consentements jsonb not null default '{}',  -- cases cochées et leur heure
  carte_retiree_le timestamptz,           -- carte retirée de Stripe (CGV art. 10.4)
  annulee_par   text check (annulee_par in ('client', 'organisation', 'minimum', 'paiement_tardif', 'expiration')),
  absent_le     timestamptz,
  rappel_envoye_le timestamptz,
  frais_centimes integer not null default 0 check (frais_centimes >= 0),
  frais_statut  text not null default 'aucun'
                check (frais_statut in ('aucun', 'a_prelever', 'en_cours', 'preleve', 'a_payer', 'echec')),
  frais_payment_intent text unique,
  frais_tentatives integer not null default 0,
  frais_pris_le timestamptz,
  check (total_centimes = paye_en_ligne_centimes + reste_sur_place_centimes)
);
create index reservations_seance_statut on public.reservations (seance_id, statut);
create index reservations_email on public.reservations (email);

-- Accès aux contenus sans date : circuit autoguidé, escape game.
create table public.acces (
  id            uuid primary key default gen_random_uuid(),
  reference     text not null unique default interne.nouvelle_reference(),
  experience_id uuid not null references public.experiences(id) on delete restrict,
  email         text not null check (email = lower(email) and email ~ '^[^\s@]+@[^\s@]+\.[^\s@]+$'
                                     and length(email) <= 254),
  nom_equipe    text check (length(nom_equipe) <= 80),
  langue        text not null default 'fr',
  audioguide    boolean not null default false,
  montant_centimes integer not null check (montant_centimes >= 0),
  statut        text not null default 'en_attente'
                check (statut in ('en_attente', 'actif', 'rembourse')),
  -- Empreinte SHA-256 du jeton du lien d'accès. Le jeton lui-même
  -- n'existe que dans l'email de l'acheteur.
  jeton_hash    text not null unique check (jeton_hash ~ '^[0-9a-f]{64}$'),
  progression   jsonb not null default '{}',
  cgv_acceptees_le timestamptz not null,
  stripe_session_id     text unique,
  stripe_payment_intent text unique,
  cree_le       timestamptz not null default now(),
  active_le     timestamptz
);
create index acces_email on public.acces (email);

-- ============================================================
-- 5. ARGENT
-- ============================================================

-- Journal des encaissements en ligne (source de l'export comptable)
create table public.paiements (
  id            uuid primary key default gen_random_uuid(),
  cree_le       timestamptz not null default now(),
  reservation_id uuid references public.reservations(id) on delete restrict,
  acces_id       uuid references public.acces(id) on delete restrict,
  experience_id  uuid not null references public.experiences(id) on delete restrict,
  experience_type text not null,
  localite_id    text not null references public.localites(id),
  intervenant_id uuid references public.intervenants(id) on delete set null,
  montant_centimes integer not null check (montant_centimes >= 0),
  devise        text not null default 'eur',
  stripe_session_id     text unique,
  stripe_payment_intent text not null unique,
  statut        text not null default 'paye'
                check (statut in ('paye', 'rembourse_partiel', 'rembourse')),
  check ((reservation_id is not null) <> (acces_id is not null))
);

create table public.remboursements (
  id            uuid primary key default gen_random_uuid(),
  paiement_id   uuid not null references public.paiements(id) on delete restrict,
  montant_centimes integer not null check (montant_centimes > 0),
  motif         text not null check (motif in
                  ('minimum_non_atteint', 'annulation_organisation', 'intervenant_empeche',
                   'changement_seance', 'paiement_tardif', 'geste_admin')),
  statut        text not null default 'a_faire' check (statut in ('a_faire', 'en_cours', 'fait', 'echec')),
  stripe_refund_id text unique,
  demande_par   uuid,                   -- compte admin, vide si automatique
  note          text,
  cree_le       timestamptz not null default now(),
  fait_le       timestamptz,
  tentatives    integer not null default 0,
  pris_le       timestamptz
);
create index remboursements_paiement on public.remboursements (paiement_id);

-- Un évènement Stripe n'est traité qu'une seule fois
create table public.webhook_evenements (
  stripe_event_id text primary key,
  type      text not null,
  recu_le   timestamptz not null default now(),
  traite_le timestamptz
);

-- ============================================================
-- 6. VALIDATIONS, FORMULAIRES, JOURNAL
-- ============================================================

-- Modifications d'un intervenant en attente de validation (E11.1, E12)
create table public.propositions (
  id             uuid primary key default gen_random_uuid(),
  intervenant_id uuid not null references public.intervenants(id) on delete cascade,
  type           text not null check (type in ('fiche', 'seance', 'lieu')),
  cible_id       uuid,                  -- la séance concernée (type « seance »)
  donnees        jsonb not null check (jsonb_typeof(donnees) = 'object'
                                       and pg_column_size(donnees) < 20000),
  statut         text not null default 'en_attente'
                 check (statut in ('en_attente', 'validee', 'refusee')),
  motif_refus    text,
  cree_le        timestamptz not null default now(),
  traitee_le     timestamptz,
  traitee_par    uuid,
  check ((type = 'seance') = (cible_id is not null))
);
create index propositions_statut on public.propositions (statut, cree_le);

-- Demandes privées de groupe (E7, E7.1)
create table public.demandes_groupes (
  id            uuid primary key default gen_random_uuid(),
  localite_id   text not null references public.localites(id),
  type          text not null check (type in ('visite', 'atelier')),
  experience_id uuid references public.experiences(id) on delete set null,
  personnes     integer check (personnes between 1 and 500),
  occasion      text check (length(occasion) <= 60),
  periode_souhaitee text check (length(periode_souhaitee) <= 200),
  langue        text not null default 'fr',
  nom           text not null check (length(btrim(nom)) between 1 and 120),
  email         text not null check (email ~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' and length(email) <= 254),
  telephone     text check (length(telephone) <= 30),
  message       text check (length(message) <= 4000),
  statut        text not null default 'nouvelle'
                check (statut in ('nouvelle', 'en_cours', 'devis_envoye', 'confirmee', 'refusee', 'close')),
  note_admin    text,
  cree_le       timestamptz not null default now()
);

-- « Nous rejoindre » (E14) et « Demander à apparaître en détail » (E10.6)
create table public.candidatures (
  id         uuid primary key default gen_random_uuid(),
  origine    text not null default 'rejoindre' check (origine in ('rejoindre', 'apparaitre_en_detail')),
  type       text not null check (type in ('guide', 'artiste', 'lieu', 'autre')),
  lieu_id    uuid references public.lieux(id) on delete set null,
  nom        text not null check (length(btrim(nom)) between 1 and 120),
  email      text not null check (email ~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' and length(email) <= 254),
  telephone  text check (length(telephone) <= 30),
  message    text check (length(message) <= 4000),
  statut     text not null default 'nouvelle' check (statut in ('nouvelle', 'acceptee', 'refusee')),
  note_admin text,
  cree_le    timestamptz not null default now()
);

-- Qui a validé, refusé ou remboursé quoi
create table public.journal_admin (
  id        bigint generated always as identity primary key,
  cree_le   timestamptz not null default now(),
  acteur    uuid,
  action    text not null,
  cible_table text,
  cible_id  uuid,
  details   jsonb not null default '{}'
);

-- ============================================================
-- ADHÉSIONS ET CARTES DE MEMBRE
-- Les adhésions viennent de Stripe (webhook, fonctions Netlify) ou sont
-- ajoutées à la main par l'association. La liste ne sort jamais de la
-- base : le navigateur n'en lit rien. Un adhérent voit SA carte grâce
-- à un jeton secret (lien reçu par email ou après le paiement), dont
-- seule l'empreinte SHA-256 est gardée ici.
-- ============================================================

create table public.adhesions (
  id            uuid primary key default gen_random_uuid(),
  email         text not null check (email = lower(email) and email ~ '^[^\s@]+@[^\s@]+\.[^\s@]+$'
                                     and length(email) <= 254),
  nom           text check (length(nom) <= 120),
  formule       text not null default 'adhesion' check (formule in ('adhesion', 'bienfaiteur')),
  source        text not null check (source in ('stripe_abonnement', 'stripe_ponctuel', 'manuelle')),
  stripe_customer       text,
  stripe_subscription   text unique,
  stripe_payment_intent text unique,
  debut         timestamptz not null,
  valide_jusqua timestamptz not null,
  statut        text not null default 'active' check (statut in ('active', 'arretee', 'remboursee')),
  note          text check (length(note) <= 500),
  cree_le       timestamptz not null default now(),
  maj_le        timestamptz not null default now(),
  check (valide_jusqua >= debut),
  check (source <> 'stripe_abonnement' or stripe_subscription is not null),
  check (source <> 'stripe_ponctuel' or stripe_payment_intent is not null)
);
create index adhesions_email on public.adhesions (email);
create trigger adhesions_maj before update on public.adhesions
  for each row execute function interne.touche_maj();

-- Liens personnels vers une carte (le jeton n'existe que chez l'adhérent).
create table public.cartes_liens (
  jeton_hash    text primary key check (jeton_hash ~ '^[0-9a-f]{64}$'),
  email         text not null check (email = lower(email)),
  origine       text not null check (origine in ('paiement', 'email', 'admin')),
  cree_le       timestamptz not null default now(),
  dernier_usage timestamptz,
  revoque_le    timestamptz
);
create index cartes_liens_email on public.cartes_liens (email);

-- Codes à usage unique pour lancer l'import des adhésions Stripe.
create table public.codes_import (
  code_hash  text primary key check (code_hash ~ '^[0-9a-f]{64}$'),
  expire_le  timestamptz not null,
  utilise_le timestamptz
);

-- ---- Fonctions réservées au serveur (clé secrète) ----

-- Abonnement Stripe (adhésion annuelle ou bienfaiteur mensuel) : crée ou
-- met à jour la ligne. p_valide_jusqua vide = garder la date actuelle.
create function public.enregistrer_adhesion_abonnement(
  p_subscription text, p_customer text, p_email text, p_nom text, p_formule text,
  p_debut timestamptz, p_valide_jusqua timestamptz, p_statut text
) returns jsonb
language plpgsql set search_path = ''
as $$
declare
  a public.adhesions;
  v_email text := lower(btrim(coalesce(p_email, '')));
begin
  if coalesce(p_subscription, '') = '' then raise exception 'ABONNEMENT_MANQUANT'; end if;
  select * into a from public.adhesions where stripe_subscription = p_subscription for update;
  if not found then
    if p_valide_jusqua is null then raise exception 'DATE_MANQUANTE'; end if;
    insert into public.adhesions (email, nom, formule, source, stripe_customer, stripe_subscription,
                                  debut, valide_jusqua, statut)
    values (v_email, nullif(btrim(coalesce(p_nom, '')), ''), coalesce(p_formule, 'adhesion'),
            'stripe_abonnement', p_customer, p_subscription,
            least(p_debut, p_valide_jusqua), p_valide_jusqua, coalesce(p_statut, 'active'))
    returning * into a;
  else
    update public.adhesions set
      email         = case when v_email <> '' then v_email else email end,
      nom           = coalesce(nom, nullif(btrim(coalesce(p_nom, '')), '')),  -- le nom saisi à l'adhésion reste
      formule       = coalesce(p_formule, formule),
      stripe_customer = coalesce(p_customer, stripe_customer),
      valide_jusqua = greatest(coalesce(p_valide_jusqua, valide_jusqua), debut),
      statut        = coalesce(p_statut, statut)
    where id = a.id
    returning * into a;
  end if;
  return jsonb_build_object('id', a.id, 'email', a.email, 'valide_jusqua', a.valide_jusqua, 'statut', a.statut);
end $$;

-- Paiement ponctuel : valable un an à partir de la date de paiement.
create function public.enregistrer_adhesion_ponctuelle(
  p_payment_intent text, p_customer text, p_email text, p_nom text, p_formule text, p_paye_le timestamptz
) returns jsonb
language plpgsql set search_path = ''
as $$
declare
  a public.adhesions;
begin
  if coalesce(p_payment_intent, '') = '' or p_paye_le is null then raise exception 'PAIEMENT_MANQUANT'; end if;
  insert into public.adhesions (email, nom, formule, source, stripe_customer, stripe_payment_intent,
                                debut, valide_jusqua)
  values (lower(btrim(coalesce(p_email, ''))), nullif(btrim(coalesce(p_nom, '')), ''),
          coalesce(p_formule, 'adhesion'), 'stripe_ponctuel', p_customer, p_payment_intent,
          p_paye_le, p_paye_le + interval '1 year')
  on conflict (stripe_payment_intent) do update set
    nom = coalesce(public.adhesions.nom, excluded.nom)
  returning * into a;
  return jsonb_build_object('id', a.id, 'email', a.email, 'valide_jusqua', a.valide_jusqua, 'statut', a.statut);
end $$;

-- Paiement ponctuel remboursé : la carte n'est plus valable.
create function public.adhesion_remboursee(p_payment_intent text) returns integer
language plpgsql set search_path = ''
as $$
declare n integer;
begin
  update public.adhesions set statut = 'remboursee', valide_jusqua = greatest(debut, least(valide_jusqua, now()))
   where stripe_payment_intent = p_payment_intent and statut <> 'remboursee';
  get diagnostics n = row_count;
  return n;
end $$;

-- Ce que montre une carte : uniquement pour le jeton de son adhérent.
create function public.carte_par_jeton(p_jeton_hash text) returns jsonb
language plpgsql set search_path = ''
as $$
declare
  l public.cartes_liens;
  r record;
begin
  select * into l from public.cartes_liens
   where jeton_hash = p_jeton_hash and revoque_le is null;
  if not found then return null; end if;

  select
    (array_agg(nom order by (statut = 'active') desc, valide_jusqua desc) filter (where nom is not null))[1] as nom,
    max(valide_jusqua) filter (where statut <> 'remboursee') as valide_jusqua,
    min(debut) filter (where statut <> 'remboursee') as membre_depuis,
    bool_or(formule = 'bienfaiteur' and statut <> 'remboursee' and valide_jusqua > now()) as bienfaiteur
  into r
  from public.adhesions where email = l.email;

  if r.valide_jusqua is null then return null; end if;
  update public.cartes_liens set dernier_usage = now() where jeton_hash = l.jeton_hash;
  return jsonb_build_object(
    'nom', r.nom,
    'formule', case when r.bienfaiteur then 'bienfaiteur' else 'adhesion' end,
    'membre_depuis', r.membre_depuis,
    'valide_jusqua', r.valide_jusqua,
    'valide', r.valide_jusqua > now());
end $$;

-- Enregistre un lien de carte, seulement si l'email a une adhésion.
-- Pour les demandes par email : 3 par heure au plus pour une même adresse.
-- Répond sans dire si l'adresse est adhérente quand elle ne l'est pas
-- (le serveur répond toujours « email envoyé si vous êtes adhérent »).
create function public.carte_creer_lien(p_email text, p_jeton_hash text, p_origine text) returns text
language plpgsql set search_path = ''
as $$
declare
  v_email text := lower(btrim(coalesce(p_email, '')));
begin
  if not exists (select 1 from public.adhesions where email = v_email and statut <> 'remboursee') then
    return 'inconnu';
  end if;
  if p_origine = 'email' and (select count(*) from public.cartes_liens
        where email = v_email and origine = 'email' and cree_le > now() - interval '1 hour') >= 3 then
    return 'trop_de_demandes';
  end if;
  insert into public.cartes_liens (jeton_hash, email, origine) values (p_jeton_hash, v_email, p_origine);
  return 'cree';
end $$;

-- Import : vérifie et consomme un code à usage unique.
create function public.code_import_utiliser(p_code_hash text) returns boolean
language plpgsql set search_path = ''
as $$
declare n integer;
begin
  update public.codes_import set utilise_le = now()
   where code_hash = p_code_hash and utilise_le is null and expire_le > now();
  get diagnostics n = row_count;
  return n = 1;
end $$;

-- ---- Fonctions de l'association (SQL Editor, ou admin connecté) ----

-- Crée un code d'import valable 30 minutes. Le code n'est affiché qu'une fois.
create function public.code_import_creer() returns text
language plpgsql security definer set search_path = ''
as $$
declare v_code text;
begin
  if (select auth.uid()) is not null and not interne.est_admin() then raise exception 'RESERVE_ADMIN'; end if;
  v_code := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
  insert into public.codes_import (code_hash, expire_le)
  values (encode(sha256(convert_to(v_code, 'UTF8')), 'hex'), now() + interval '30 minutes');
  return v_code;
end $$;

-- Ajoute une adhésion payée hors Stripe (espèces, virement, mécénat).
create function public.ajouter_adhesion_manuelle(
  p_email text, p_nom text, p_valide_jusqua date,
  p_formule text default 'adhesion', p_note text default null, p_debut date default current_date
) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare a public.adhesions;
begin
  if (select auth.uid()) is not null and not interne.est_admin() then raise exception 'RESERVE_ADMIN'; end if;
  insert into public.adhesions (email, nom, formule, source, debut, valide_jusqua, note)
  values (lower(btrim(p_email)), nullif(btrim(coalesce(p_nom, '')), ''), coalesce(p_formule, 'adhesion'),
          'manuelle', p_debut, (p_valide_jusqua + 1)::timestamptz, p_note)
  returning * into a;
  insert into public.journal_admin (acteur, action, cible_table, cible_id, details)
  values ((select auth.uid()), 'adhesion_manuelle', 'adhesions', a.id,
          jsonb_build_object('valide_jusqua', a.valide_jusqua, 'formule', a.formule));
  return jsonb_build_object('id', a.id, 'email', a.email, 'valide_jusqua', a.valide_jusqua);
end $$;


-- ============================================================
-- 7. VUES
-- ============================================================

create function interne.places_prises(p_seance_id uuid) returns integer
language sql stable set search_path = ''
as $$
  select coalesce(sum(personnes), 0)::integer
  from public.reservations
  where seance_id = p_seance_id
    and (statut = 'confirmee' or (statut = 'en_attente' and bloque_jusqua > now()));
$$;

-- Ce que le visiteur voit d'une séance : la jauge, jamais les inscrits.
create view public.seances_publiques with (security_barrier = true) as
select s.id, s.experience_id, s.debut, s.fin, s.langue,
       s.capacite_max, s.participants_min, s.point_rdv, s.statut,
       coalesce(r.inscrits, 0)::integer                             as inscrits,
       greatest(s.capacite_max - coalesce(r.prises, 0), 0)::integer as places_restantes,
       coalesce(r.inscrits, 0) >= s.participants_min                as confirmee
from public.seances s
join public.experiences e on e.id = s.experience_id and e.publie and e.actif
left join lateral (
  select sum(personnes) filter (where statut = 'confirmee') as inscrits,
         sum(personnes) filter (where statut = 'confirmee'
              or (statut = 'en_attente' and bloque_jusqua > now())) as prises
  from public.reservations where seance_id = s.id
) r on true
where s.statut in ('publiee', 'annulee')
  and s.debut > now() - interval '1 day';

-- Ce que l'intervenant voit de ses inscrits (E11.3) : prénom et initiale,
-- nombre de personnes, téléphone, reste à encaisser. Pas d'email, pas de
-- données de paiement. L'admin voit toutes les lignes.
create view public.mes_inscrits with (security_barrier = true) as
select r.id, r.seance_id, s.experience_id, s.debut,
       interne.nom_court(r.nom) as nom,
       r.personnes, r.telephone, r.langue, r.reste_sur_place_centimes
from public.reservations r
join public.seances s on s.id = r.seance_id
join public.experiences e on e.id = s.experience_id
where r.statut = 'confirmee'
  and (e.intervenant_id = (select interne.mon_intervenant_id())
       or (select interne.est_admin()));

-- ============================================================
-- 8. FONCTIONS MÉTIER
-- ============================================================

-- ---- Réservées au serveur (fonctions Netlify, clé secrète) ----

-- ============================================================
-- RÉSERVATIONS : CYCLE DE VIE COMPLET
-- Réserver (blocage 15 min), confirmer (webhook Stripe), annuler
-- (client, organisation, minimum non atteint), rappels, frais
-- d'annulation tardive et d'absence, remboursements, emails.
-- Tout ce qui touche à l'argent ou aux emails passe par une file
-- (remboursements, réservations « frais à prélever », envois) que
-- les fonctions Netlify traitent et peuvent réessayer sans doublon.
-- ============================================================

-- Contacts privés des intervenants (alertes). Jamais publics.
create table public.intervenants_contacts (
  intervenant_id uuid primary key references public.intervenants(id) on delete cascade,
  email     text check (email = lower(email) and email ~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' and length(email) <= 254),
  telephone text check (length(telephone) <= 30),
  maj_le    timestamptz not null default now()
);

-- Liens personnels vers une réservation (« Je ne peux plus venir »).
-- Seule l'empreinte SHA-256 du jeton est gardée.
create table public.reservations_liens (
  jeton_hash     text primary key check (jeton_hash ~ '^[0-9a-f]{64}$'),
  reservation_id uuid not null references public.reservations(id) on delete cascade,
  cree_le        timestamptz not null default now()
);
create index reservations_liens_reservation on public.reservations_liens (reservation_id);

-- Emails à envoyer (traités par la fonction Netlify « taches »).
create table public.envois (
  id          bigint generated always as identity primary key,
  type        text not null,
  destinataire text not null check (destinataire ~ '^[^\s@]+@[^\s@]+\.[^\s@]+$'),
  langue      text not null default 'fr',
  donnees     jsonb not null default '{}',
  reservation_id uuid references public.reservations(id) on delete set null,
  statut      text not null default 'a_envoyer' check (statut in ('a_envoyer', 'en_cours', 'envoye', 'echec')),
  tentatives  integer not null default 0,
  erreur      text,
  cree_le     timestamptz not null default now(),
  pris_le     timestamptz,
  envoye_le   timestamptz
);
create index envois_a_envoyer on public.envois (statut, cree_le);

-- ---- Outils internes ----

create function interne.email_association() returns text
language sql immutable set search_path = ''
as $$ select 'mouvementmontmartre@gmail.com'::text $$;

-- Jeton aléatoire (64 caractères hexadécimaux, 244 bits d'aléa).
create function interne.nouveau_jeton() returns text
language sql volatile set search_path = ''
as $$ select replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '') $$;

create function interne.sha256(p text) returns text
language sql immutable set search_path = ''
as $$ select encode(sha256(convert_to(p, 'UTF8')), 'hex') $$;

-- Tout ce qu'un email sur une réservation peut afficher.
create function interne.donnees_reservation(p_id uuid) returns jsonb
language sql stable set search_path = ''
as $$
  select jsonb_build_object(
    'reference', r.reference, 'nom', r.nom, 'email', r.email, 'telephone', r.telephone,
    'personnes', r.personnes,
    'paye_en_ligne_centimes', r.paye_en_ligne_centimes,
    'reste_sur_place_centimes', r.reste_sur_place_centimes,
    'total_centimes', r.total_centimes,
    'frais_centimes', r.frais_centimes,
    'type', e.type, 'titre', e.titre, 'duree_minutes', e.duree_minutes,
    'frais_par_personne_centimes', e.frais_annulation_tardive_centimes,
    'cgv_version', r.cgv_version,
    'debut', s.debut, 'fin', s.fin, 'langue_seance', s.langue,
    'point_rdv', s.point_rdv, 'point_rdv_precis', s.point_rdv_precis,
    'message_inscrits', s.message_inscrits,
    'intervenant', i.nom)
  from public.reservations r
  join public.seances s on s.id = r.seance_id
  join public.experiences e on e.id = r.experience_id
  left join public.intervenants i on i.id = e.intervenant_id
  where r.id = p_id;
$$;

-- Met un email en file. p_jeton : lien personnel (retiré après l'envoi).
create function interne.envoyer(p_type text, p_destinataire text, p_langue text,
                                p_reservation uuid, p_extra jsonb default '{}') returns void
language plpgsql set search_path = ''
as $$
begin
  if coalesce(p_destinataire, '') !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' then return; end if;
  insert into public.envois (type, destinataire, langue, donnees, reservation_id)
  values (p_type, p_destinataire, coalesce(p_langue, 'fr'),
          coalesce(interne.donnees_reservation(p_reservation), '{}'::jsonb) || coalesce(p_extra, '{}'::jsonb),
          p_reservation);
end $$;

-- Alerte à l'association et à l'intervenant de la visite.
create function interne.alerter(p_type text, p_reservation uuid, p_extra jsonb default '{}') returns void
language plpgsql set search_path = ''
as $$
declare v_guide text;
begin
  select c.email into v_guide
    from public.reservations r
    join public.experiences e on e.id = r.experience_id
    join public.intervenants_contacts c on c.intervenant_id = e.intervenant_id
   where r.id = p_reservation;
  perform interne.envoyer(p_type, interne.email_association(), 'fr', p_reservation, p_extra);
  if v_guide is not null and v_guide <> interne.email_association() then
    perform interne.envoyer(p_type, v_guide, 'fr', p_reservation, p_extra);
  end if;
end $$;

-- Crée un lien personnel vers la réservation et renvoie le jeton en clair.
create function interne.lien_reservation(p_reservation uuid) returns text
language plpgsql set search_path = ''
as $$
declare v_jeton text := interne.nouveau_jeton();
begin
  insert into public.reservations_liens (jeton_hash, reservation_id)
  values (interne.sha256(v_jeton), p_reservation);
  return v_jeton;
end $$;

-- Remboursement intégral du paiement en ligne d'une réservation (mis en file).
create function interne.rembourser(p_reservation uuid, p_motif text) returns void
language plpgsql set search_path = ''
as $$
begin
  insert into public.remboursements (paiement_id, montant_centimes, motif)
  select p.id, p.montant_centimes, p_motif
    from public.paiements p
   where p.reservation_id = p_reservation and p.montant_centimes > 0
     and not exists (select 1 from public.remboursements x where x.paiement_id = p.id);
end $$;

-- ---- Réserver et confirmer (serveur) ----

-- Bloque des places 15 minutes. La séance est verrouillée pendant le
-- calcul : deux personnes ne peuvent pas prendre la dernière place.
-- Les prix viennent de la base, jamais du navigateur. Pour une visite
-- ou un atelier, l'accord pour les frais d'annulation tardive est requis.
create function public.reserver_places(
  p_seance_id uuid, p_personnes integer, p_nom text, p_email text,
  p_telephone text default null, p_langue text default 'fr',
  p_consentements jsonb default '{}', p_cgv_version text default null
) returns jsonb
language plpgsql set search_path = ''
as $$
declare
  s public.seances;
  e public.experiences;
  r public.reservations;
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_tel   text := nullif(btrim(coalesce(p_telephone, '')), '');
  v_prises integer;
  v_total integer;
  v_en_ligne integer;
  v_frais boolean;
  v_accords jsonb;
begin
  -- Cases cochées (CGV, section 2) : chacune est gardée avec son heure.
  select coalesce(jsonb_object_agg(k, now()), '{}'::jsonb) into v_accords
    from jsonb_each(coalesce(p_consentements, '{}'::jsonb)) as c(k, v)
   where v = 'true'::jsonb
     and k in ('cgv', 'non_remboursable', 'sans_retractation', 'prelevement', 'age', 'photos');
  if not v_accords ? 'cgv' then raise exception 'CGV_NON_ACCEPTEES'; end if;
  if coalesce(p_cgv_version, '') = '' then raise exception 'CGV_VERSION_MANQUANTE'; end if;

  select * into s from public.seances where id = p_seance_id for update;
  if not found or s.statut <> 'publiee' or s.debut <= now() then
    raise exception 'SEANCE_INDISPONIBLE';
  end if;
  select * into e from public.experiences where id = s.experience_id;
  if not (e.publie and e.actif) then raise exception 'SEANCE_INDISPONIBLE'; end if;

  if p_personnes is null or p_personnes < 1 or p_personnes > s.capacite_max then
    raise exception 'NOMBRE_INVALIDE';
  end if;
  if e.telephone_obligatoire and v_tel is null then raise exception 'TELEPHONE_REQUIS'; end if;
  if not (v_accords ? 'non_remboursable' and v_accords ? 'sans_retractation') then
    raise exception 'CONSENTEMENTS_MANQUANTS';
  end if;
  if e.age_minimum is not null and not v_accords ? 'age' then raise exception 'AGE_NON_CONFIRME'; end if;
  v_frais := e.type in ('visite_guidee', 'atelier') and e.frais_annulation_tardive_centimes > 0;
  if v_frais and not v_accords ? 'prelevement' then raise exception 'ACCORD_FRAIS_REQUIS'; end if;

  v_prises := interne.places_prises(s.id);
  if v_prises + p_personnes > s.capacite_max then
    raise exception 'COMPLET' using detail = (s.capacite_max - v_prises)::text;
  end if;

  v_total := e.prix_centimes * p_personnes;
  v_en_ligne := case when e.type in ('visite_guidee', 'atelier')
                     then e.prereservation_centimes * p_personnes
                     else v_total end;

  insert into public.reservations
    (seance_id, experience_id, nom, email, telephone, langue, personnes, statut, bloque_jusqua,
     prix_unitaire_centimes, total_centimes, paye_en_ligne_centimes, reste_sur_place_centimes,
     cgv_acceptees_le, accord_frais_le, cgv_version, consentements)
  values
    (s.id, e.id, btrim(p_nom), v_email, v_tel, coalesce(p_langue, 'fr'), p_personnes,
     'en_attente', now() + interval '15 minutes',
     e.prix_centimes, v_total, v_en_ligne, v_total - v_en_ligne, now(),
     case when v_frais then now() end, p_cgv_version, v_accords)
  returning * into r;

  return jsonb_build_object(
    'reservation_id', r.id, 'reference', r.reference,
    'a_payer_centimes', r.paye_en_ligne_centimes,
    'reste_sur_place_centimes', r.reste_sur_place_centimes,
    'bloque_jusqua', r.bloque_jusqua,
    'garder_carte', v_frais, 'age_minimum', e.age_minimum,
    'frais_centimes', case when v_frais then e.frais_annulation_tardive_centimes * p_personnes else 0 end,
    'experience_type', e.type, 'experience_titre', e.titre, 'debut', s.debut);
end $$;

-- Appelée par le webhook Stripe quand le paiement est encaissé.
-- Peut être appelée plusieurs fois sans dégât. Paiement arrivé après le
-- blocage et plus de place : réservation annulée, remboursement en file.
create function public.confirmer_reservation(
  p_reservation_id uuid, p_stripe_session_id text, p_stripe_payment_intent text,
  p_montant_centimes integer, p_stripe_customer text default null,
  p_stripe_payment_method text default null
) returns jsonb
language plpgsql set search_path = ''
as $$
declare
  r public.reservations;
  s public.seances;
  e public.experiences;
  v_ok boolean := true;
  v_jeton text;
begin
  select seance_id into r.seance_id from public.reservations where id = p_reservation_id;
  if not found then raise exception 'RESERVATION_INTROUVABLE'; end if;
  select * into s from public.seances where id = r.seance_id for update;
  select * into r from public.reservations where id = p_reservation_id for update;

  if r.stripe_payment_intent is not null then
    return jsonb_build_object('statut', r.statut, 'deja_traitee', true, 'reference', r.reference);
  end if;
  if p_montant_centimes is distinct from r.paye_en_ligne_centimes then
    raise exception 'MONTANT_INCOHERENT';
  end if;

  if s.statut <> 'publiee' or s.debut <= now() or r.statut not in ('en_attente', 'expiree') then
    v_ok := false;
  elsif r.statut = 'expiree' or r.bloque_jusqua <= now() then
    v_ok := interne.places_prises(s.id) + r.personnes <= s.capacite_max;
  end if;

  select * into e from public.experiences where id = r.experience_id;
  insert into public.paiements
    (reservation_id, experience_id, experience_type, localite_id, intervenant_id,
     montant_centimes, stripe_session_id, stripe_payment_intent)
  values
    (r.id, e.id, e.type, e.localite_id, e.intervenant_id,
     p_montant_centimes, p_stripe_session_id, p_stripe_payment_intent);

  update public.reservations
     set stripe_session_id = p_stripe_session_id,
         stripe_payment_intent = p_stripe_payment_intent,
         stripe_customer = p_stripe_customer,
         stripe_payment_method = case when accord_frais_le is not null then p_stripe_payment_method end,
         bloque_jusqua = null,
         statut = case when v_ok then 'confirmee' else 'annulee' end,
         confirmee_le = case when v_ok then now() end,
         annulee_le = case when v_ok then null else now() end,
         annulee_par = case when v_ok then null else 'paiement_tardif' end,
         motif_annulation = case when v_ok then null else 'Paiement arrivé après la fin du blocage, plus de place.' end
   where id = r.id;

  if v_ok then
    v_jeton := interne.lien_reservation(r.id);
    perform interne.envoyer('confirmation', r.email, r.langue, r.id, jsonb_build_object('jeton', v_jeton));
    perform interne.alerter('alerte_inscription', r.id);
    return jsonb_build_object('statut', 'confirmee', 'deja_traitee', false, 'reference', r.reference);
  end if;

  perform interne.rembourser(r.id, 'paiement_tardif');
  perform interne.envoyer('paiement_tardif', r.email, r.langue, r.id);
  return jsonb_build_object('statut', 'annulee', 'deja_traitee', false, 'a_rembourser', true);
end $$;

-- Paiement abandonné (session Stripe expirée) : la place est libérée.
create function public.liberer_reservation(p_stripe_session_id text, p_reservation_id uuid) returns integer
language plpgsql set search_path = ''
as $$
declare n integer;
begin
  update public.reservations set statut = 'expiree', bloque_jusqua = null, annulee_par = 'expiration'
   where id = p_reservation_id and statut = 'en_attente' and stripe_payment_intent is null;
  get diagnostics n = row_count;
  return n;
end $$;

-- ---- Lien personnel : voir et annuler (serveur, avec le jeton) ----

create function public.reservation_par_jeton(p_jeton_hash text) returns jsonb
language plpgsql stable set search_path = ''
as $$
declare
  r public.reservations;
  s public.seances;
  e public.experiences;
  v_tardif boolean;
begin
  select res.* into r from public.reservations_liens l
    join public.reservations res on res.id = l.reservation_id
   where l.jeton_hash = p_jeton_hash;
  if not found then return null; end if;
  select * into s from public.seances where id = r.seance_id;
  select * into e from public.experiences where id = r.experience_id;
  v_tardif := now() > s.debut - make_interval(hours => e.delai_frais_heures);
  return interne.donnees_reservation(r.id) - 'email' - 'telephone' || jsonb_build_object(
    'statut', r.statut, 'seance_statut', s.statut,
    'peut_annuler', r.statut = 'confirmee' and s.statut = 'publiee' and s.debut > now(),
    'annulation_tardive', v_tardif,
    'frais_si_annulation_centimes',
      case when v_tardif and r.stripe_payment_method is not null
           then e.frais_annulation_tardive_centimes * r.personnes else 0 end,
    'frais_statut', r.frais_statut);
end $$;

-- « Je ne peux plus venir » : la place est libérée. Moins de 24 h avant
-- (délai de l'expérience), les frais d'annulation tardive sont mis en file.
create function public.annuler_par_client(p_jeton_hash text) returns jsonb
language plpgsql set search_path = ''
as $$
declare
  v_id uuid;
  r public.reservations;
  s public.seances;
  e public.experiences;
  v_frais integer := 0;
begin
  select reservation_id into v_id from public.reservations_liens where jeton_hash = p_jeton_hash;
  if not found then raise exception 'LIEN_INVALIDE'; end if;
  select * into r from public.reservations where id = v_id;
  select * into s from public.seances where id = r.seance_id for update;
  select * into r from public.reservations where id = v_id for update;
  select * into e from public.experiences where id = r.experience_id;

  if r.statut = 'annulee' then
    return jsonb_build_object('statut', 'annulee', 'deja_annulee', true, 'frais_centimes', r.frais_centimes);
  end if;
  if r.statut <> 'confirmee' then raise exception 'NON_ANNULABLE'; end if;
  if s.debut <= now() then raise exception 'TROP_TARD'; end if;

  if now() > s.debut - make_interval(hours => e.delai_frais_heures)
     and r.stripe_payment_method is not null and e.frais_annulation_tardive_centimes > 0 then
    v_frais := e.frais_annulation_tardive_centimes * r.personnes;
  end if;

  update public.reservations set
    statut = 'annulee', annulee_le = now(), annulee_par = 'client',
    motif_annulation = 'Annulée par le client.',
    frais_centimes = v_frais,
    frais_statut = case when v_frais > 0 then 'a_prelever' else 'aucun' end
  where id = r.id;

  perform interne.envoyer('annulation_client', r.email, r.langue, r.id);
  perform interne.alerter('alerte_annulation', r.id);
  return jsonb_build_object('statut', 'annulee', 'deja_annulee', false, 'frais_centimes', v_frais);
end $$;

-- ---- Organisation (admin, ou serveur pour le minimum) ----

-- Annule une séance : inscrits remboursés intégralement et prévenus.
create function public.annuler_seance(p_seance_id uuid, p_motif text default 'annulation_organisation') returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  s public.seances;
  r record;
  n integer := 0;
begin
  if (select auth.uid()) is not null and not interne.est_admin() then raise exception 'RESERVE_ADMIN'; end if;
  if p_motif not in ('minimum_non_atteint', 'annulation_organisation', 'intervenant_empeche') then
    raise exception 'MOTIF_INVALIDE';
  end if;
  select * into s from public.seances where id = p_seance_id for update;
  if not found then raise exception 'SEANCE_INTROUVABLE'; end if;
  if s.statut = 'annulee' then return jsonb_build_object('deja_annulee', true, 'inscrits', 0); end if;

  update public.seances set statut = 'annulee', annulee_le = now(), motif_annulation = p_motif where id = s.id;
  for r in select * from public.reservations where seance_id = s.id and statut in ('confirmee', 'en_attente') for update loop
    update public.reservations set statut = 'annulee', annulee_le = now(), bloque_jusqua = null,
           annulee_par = case when p_motif = 'minimum_non_atteint' then 'minimum' else 'organisation' end,
           motif_annulation = p_motif
     where id = r.id;
    if r.statut = 'confirmee' then
      perform interne.rembourser(r.id, p_motif);
      perform interne.envoyer('seance_annulee', r.email, r.langue, r.id, jsonb_build_object('motif', p_motif));
      n := n + 1;
    end if;
  end loop;
  -- Une seule alerte pour la séance (association et intervenant).
  if n > 0 then
    perform interne.alerter('alerte_seance_annulee',
      (select id from public.reservations where seance_id = s.id and annulee_par is not null limit 1),
      jsonb_build_object('motif', p_motif, 'inscrits_rembourses', n));
  end if;
  insert into public.journal_admin (acteur, action, cible_table, cible_id, details)
  values ((select auth.uid()), 'seance_annulee', 'seances', s.id, jsonb_build_object('motif', p_motif, 'inscrits', n));
  return jsonb_build_object('deja_annulee', false, 'inscrits', n);
end $$;

-- Absence sans prévenir, signalée par l'intervenant de la séance ou l'admin.
create function public.signaler_absence(p_reservation_id uuid) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  r public.reservations;
  s public.seances;
  e public.experiences;
  v_frais integer := 0;
begin
  select * into r from public.reservations where id = p_reservation_id for update;
  if not found then raise exception 'RESERVATION_INTROUVABLE'; end if;
  select * into s from public.seances where id = r.seance_id;
  select * into e from public.experiences where id = r.experience_id;
  if not (interne.est_admin() or e.intervenant_id = interne.mon_intervenant_id()) then
    raise exception 'RESERVE_INTERVENANT';
  end if;
  if r.statut <> 'confirmee' then raise exception 'NON_CONFIRMEE'; end if;
  if now() < s.debut then raise exception 'SEANCE_PAS_COMMENCEE'; end if;
  if now() > s.debut + interval '7 days' then raise exception 'TROP_TARD'; end if;
  if r.absent_le is not null then return jsonb_build_object('deja_signale', true); end if;

  if r.stripe_payment_method is not null and e.frais_annulation_tardive_centimes > 0 then
    v_frais := e.frais_annulation_tardive_centimes * r.personnes;
  end if;
  update public.reservations set absent_le = now(), frais_centimes = v_frais,
         frais_statut = case when v_frais > 0 then 'a_prelever' else 'aucun' end
   where id = r.id;
  insert into public.journal_admin (acteur, action, cible_table, cible_id, details)
  values ((select auth.uid()), 'absence_signalee', 'reservations', r.id, jsonb_build_object('frais_centimes', v_frais));
  return jsonb_build_object('deja_signale', false, 'frais_centimes', v_frais);
end $$;

-- ---- Tâches automatiques (serveur, fonction Netlify « taches ») ----

-- Minimum non atteint dans le délai d'annulation (48 h) : séance annulée.
create function public.verifier_minimums() returns jsonb
language plpgsql set search_path = ''
as $$
declare
  s record;
  v_annulees integer := 0;
  v_ok integer := 0;
begin
  for s in
    select se.id, se.participants_min,
           coalesce((select sum(personnes) from public.reservations
                     where seance_id = se.id and statut = 'confirmee'), 0) as inscrits
      from public.seances se
      join public.experiences e on e.id = se.experience_id
     where se.statut = 'publiee' and se.minimum_verifie_le is null and se.debut > now()
       and se.debut <= now() + make_interval(hours => e.delai_annulation_heures)
  loop
    if s.inscrits < s.participants_min then
      perform public.annuler_seance(s.id, 'minimum_non_atteint');
      v_annulees := v_annulees + 1;
    else
      update public.seances set minimum_verifie_le = now() where id = s.id;
      v_ok := v_ok + 1;
    end if;
  end loop;
  return jsonb_build_object('annulees', v_annulees, 'confirmees', v_ok);
end $$;

-- Rappels 48 h avant (CGV art. 10.5) (avec un lien « Je ne peux plus venir »).
create function public.preparer_rappels() returns integer
language plpgsql set search_path = ''
as $$
declare
  r record;
  n integer := 0;
begin
  for r in
    select res.id, res.email, res.langue, res.confirmee_le, se.debut
      from public.reservations res
      join public.seances se on se.id = res.seance_id
     where res.statut = 'confirmee' and res.rappel_envoye_le is null
       and se.statut = 'publiee' and se.debut > now() and se.debut <= now() + interval '48 hours'
     for update of res skip locked
  loop
    update public.reservations set rappel_envoye_le = now() where id = r.id;
    -- Réservé moins de 48 h avant : l'email de confirmation suffit.
    if r.confirmee_le < r.debut - interval '48 hours' then
      perform interne.envoyer('rappel', r.email, r.langue, r.id,
                              jsonb_build_object('jeton', interne.lien_reservation(r.id)));
      n := n + 1;
    end if;
  end loop;
  return n;
end $$;

-- Files : chaque appel prend des éléments et les marque « en cours ».
-- Un élément resté « en cours » plus de 30 minutes est repris.
create function public.envois_a_traiter(p_limite integer default 20) returns setof public.envois
language sql set search_path = ''
as $$
  update public.envois set statut = 'en_cours', tentatives = tentatives + 1, pris_le = now()
   where id in (select id from public.envois
                 where (statut = 'a_envoyer' or (statut = 'en_cours' and pris_le < now() - interval '30 minutes'))
                   and tentatives < 5
                 order by cree_le limit p_limite for update skip locked)
  returning *;
$$;

create function public.envoi_resultat(p_id bigint, p_ok boolean, p_erreur text default null) returns void
language sql set search_path = ''
as $$
  update public.envois set
    statut = case when p_ok then 'envoye' when tentatives >= 5 then 'echec' else 'a_envoyer' end,
    envoye_le = case when p_ok then now() end,
    erreur = left(p_erreur, 500),
    donnees = case when p_ok then donnees - 'jeton' else donnees end   -- le lien ne reste pas en base
  where id = p_id;
$$;

create function public.remboursements_a_traiter(p_limite integer default 20) returns jsonb
language sql set search_path = ''
as $$
  with pris as (
    update public.remboursements set statut = 'en_cours', tentatives = tentatives + 1, pris_le = now()
     where id in (select id from public.remboursements
                   where (statut = 'a_faire' or (statut = 'en_cours' and pris_le < now() - interval '30 minutes'))
                     and tentatives < 5
                   order by cree_le limit p_limite for update skip locked)
    returning *)
  select coalesce(jsonb_agg(jsonb_build_object('id', pris.id, 'montant_centimes', pris.montant_centimes,
                  'stripe_payment_intent', p.stripe_payment_intent, 'motif', pris.motif)), '[]'::jsonb)
    from pris join public.paiements p on p.id = pris.paiement_id;
$$;

create function public.remboursement_resultat(p_id uuid, p_ok boolean, p_stripe_refund_id text default null,
                                              p_erreur text default null) returns void
language plpgsql set search_path = ''
as $$
declare
  rb public.remboursements;
  p public.paiements;
begin
  update public.remboursements set
    statut = case when p_ok then 'fait' when tentatives >= 5 then 'echec' else 'a_faire' end,
    stripe_refund_id = coalesce(p_stripe_refund_id, stripe_refund_id),
    fait_le = case when p_ok then now() end,
    note = case when p_ok then note else left(p_erreur, 500) end
  where id = p_id returning * into rb;
  if not found then return; end if;
  select * into p from public.paiements where id = rb.paiement_id;
  if p_ok then
    update public.paiements set statut = 'rembourse' where id = p.id;
    update public.reservations set statut = 'remboursee' where id = p.reservation_id and statut = 'annulee';
  elsif rb.statut = 'echec' and p.reservation_id is not null then
    perform interne.envoyer('alerte_technique', interne.email_association(), 'fr', p.reservation_id,
                            jsonb_build_object('probleme', 'remboursement impossible', 'erreur', left(p_erreur, 300)));
  end if;
end $$;

create function public.frais_a_traiter(p_limite integer default 20) returns jsonb
language sql set search_path = ''
as $$
  with pris as (
    update public.reservations set frais_statut = 'en_cours', frais_tentatives = frais_tentatives + 1,
                                   frais_pris_le = now()
     where id in (select id from public.reservations
                   where (frais_statut = 'a_prelever'
                          or (frais_statut = 'en_cours' and frais_pris_le < now() - interval '30 minutes'))
                     and frais_tentatives < 5
                   order by annulee_le nulls last limit p_limite for update skip locked)
    returning *)
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'reference', reference, 'email', email,
                  'montant_centimes', frais_centimes, 'stripe_customer', stripe_customer,
                  'stripe_payment_method', stripe_payment_method)), '[]'::jsonb)
    from pris;
$$;

-- Résultat d'un prélèvement de frais : 'preleve', 'a_payer' (la banque
-- demande une validation : lien de paiement envoyé), ou 'echec'.
create function public.frais_resultat(p_reservation_id uuid, p_resultat text,
                                      p_payment_intent text default null, p_lien text default null,
                                      p_erreur text default null) returns void
language plpgsql set search_path = ''
as $$
declare r public.reservations;
begin
  if p_resultat not in ('preleve', 'a_payer', 'echec', 'reessayer') then raise exception 'RESULTAT_INVALIDE'; end if;
  update public.reservations set
    frais_statut = case p_resultat
                     when 'reessayer' then case when frais_tentatives >= 5 then 'echec' else 'a_prelever' end
                     else p_resultat end,
    frais_payment_intent = coalesce(p_payment_intent, frais_payment_intent)
  where id = p_reservation_id returning * into r;
  if not found then return; end if;
  if r.frais_statut = 'preleve' then
    perform interne.envoyer('frais_preleves', r.email, r.langue, r.id);
  elsif r.frais_statut = 'a_payer' and p_lien is not null then
    perform interne.envoyer('frais_a_payer', r.email, r.langue, r.id, jsonb_build_object('lien', p_lien));
  elsif r.frais_statut = 'echec' then
    perform interne.envoyer('alerte_technique', interne.email_association(), 'fr', r.id,
                            jsonb_build_object('probleme', 'frais impossibles à prélever', 'erreur', left(p_erreur, 300)));
  end if;
end $$;

-- Frais payés via le lien envoyé (webhook) : on le note.
create function public.frais_payes(p_reservation_id uuid, p_payment_intent text) returns void
language sql set search_path = ''
as $$
  update public.reservations set frais_statut = 'preleve', frais_payment_intent = p_payment_intent
   where id = p_reservation_id and frais_statut in ('a_payer', 'echec', 'en_cours');
$$;


-- Cartes à retirer de Stripe (CGV art. 10.4) : 7 jours après la séance, ou dès
-- qu'aucun frais ne peut plus être dû (annulation sans frais, frais réglés ou
-- abandonnés, remboursement, séance annulée, paiement abandonné).
create function public.cartes_a_retirer(p_limite integer default 20) returns jsonb
language sql stable set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'stripe_payment_method', x.stripe_payment_method)), '[]'::jsonb)
    from (select r.id, r.stripe_payment_method
            from public.reservations r join public.seances s on s.id = r.seance_id
           where r.stripe_payment_method is not null and r.carte_retiree_le is null
             and r.frais_statut not in ('a_prelever', 'en_cours', 'a_payer')
             and (coalesce(s.fin, s.debut) < now() - interval '7 days'
                  or s.statut = 'annulee'
                  or r.statut in ('remboursee', 'expiree')
                  or (r.statut = 'annulee' and r.frais_statut in ('aucun', 'preleve', 'echec')))
           order by r.cree_le limit p_limite) x;
$$;

-- La carte est retirée : plus aucun frais ne pourra être prélevé.
create function public.carte_retiree(p_reservation_id uuid) returns void
language sql set search_path = ''
as $$
  update public.reservations set carte_retiree_le = now(), stripe_payment_method = null
   where id = p_reservation_id and carte_retiree_le is null;
$$;

-- Lien pour l'écran de confirmation, au retour du paiement (session Stripe vérifiée).
create function public.lien_reservation_session(p_stripe_session_id text) returns jsonb
language plpgsql set search_path = ''
as $$
declare r public.reservations;
begin
  select * into r from public.reservations where stripe_session_id = p_stripe_session_id;
  if not found then return null; end if;
  return jsonb_build_object('jeton', interne.lien_reservation(r.id), 'statut', r.statut);
end $$;


-- Prépare un accès sans date (autoguidé à prix libre, escape game).
create function public.creer_acces(
  p_experience_id uuid, p_email text, p_jeton_hash text,
  p_montant_libre_centimes integer default null, p_audioguide boolean default false,
  p_nom_equipe text default null, p_langue text default 'fr',
  p_cgv_acceptees boolean default false
) returns jsonb
language plpgsql set search_path = ''
as $$
declare
  e public.experiences;
  a public.acces;
  v_montant integer;
  v_audio boolean := false;
begin
  if not coalesce(p_cgv_acceptees, false) then raise exception 'CGV_NON_ACCEPTEES'; end if;
  select * into e from public.experiences where id = p_experience_id;
  if not found or not (e.publie and e.actif) then raise exception 'EXPERIENCE_INDISPONIBLE'; end if;

  if e.type = 'autoguidee' then
    if p_montant_libre_centimes is null or p_montant_libre_centimes < e.prix_libre_min_centimes then
      raise exception 'MONTANT_TROP_BAS' using detail = e.prix_libre_min_centimes::text;
    end if;
    if p_montant_libre_centimes > 100000 then raise exception 'MONTANT_TROP_HAUT'; end if;
    v_montant := p_montant_libre_centimes;
    if coalesce(p_audioguide, false) then
      if e.option_audioguide_centimes is null then raise exception 'OPTION_INDISPONIBLE'; end if;
      v_audio := true;
      v_montant := v_montant + e.option_audioguide_centimes;
    end if;
  elsif e.type = 'escape_game' then
    v_montant := e.prix_centimes;                 -- par équipe, de 1 à 8
  else
    raise exception 'TYPE_AVEC_SEANCES';
  end if;

  insert into public.acces
    (experience_id, email, nom_equipe, langue, audioguide, montant_centimes, jeton_hash, cgv_acceptees_le)
  values
    (e.id, lower(btrim(coalesce(p_email, ''))), nullif(btrim(coalesce(p_nom_equipe, '')), ''),
     coalesce(p_langue, 'fr'), v_audio, v_montant, p_jeton_hash, now())
  returning * into a;

  return jsonb_build_object('acces_id', a.id, 'reference', a.reference,
    'a_payer_centimes', a.montant_centimes, 'audioguide', a.audioguide,
    'experience_type', e.type, 'experience_titre', e.titre);
end $$;

create function public.activer_acces(
  p_acces_id uuid, p_stripe_session_id text,
  p_stripe_payment_intent text, p_montant_centimes integer
) returns jsonb
language plpgsql set search_path = ''
as $$
declare
  a public.acces;
  e public.experiences;
begin
  select * into a from public.acces where id = p_acces_id for update;
  if not found then raise exception 'ACCES_INTROUVABLE'; end if;
  if a.statut <> 'en_attente' then
    return jsonb_build_object('statut', a.statut, 'deja_traite', true, 'reference', a.reference);
  end if;
  if p_montant_centimes is distinct from a.montant_centimes then
    raise exception 'MONTANT_INCOHERENT';
  end if;

  select * into e from public.experiences where id = a.experience_id;
  insert into public.paiements
    (acces_id, experience_id, experience_type, localite_id, intervenant_id,
     montant_centimes, stripe_session_id, stripe_payment_intent)
  values
    (a.id, e.id, e.type, e.localite_id, e.intervenant_id,
     p_montant_centimes, p_stripe_session_id, p_stripe_payment_intent);

  update public.acces
     set statut = 'actif', active_le = now(),
         stripe_session_id = p_stripe_session_id,
         stripe_payment_intent = p_stripe_payment_intent
   where id = a.id;
  return jsonb_build_object('statut', 'actif', 'deja_traite', false, 'reference', a.reference);
end $$;

-- Ménage : blocages dépassés.
create function public.liberer_reservations_expirees() returns integer
language plpgsql set search_path = ''
as $$
declare n integer;
begin
  update public.reservations set statut = 'expiree', bloque_jusqua = null
   where statut = 'en_attente' and bloque_jusqua <= now();
  get diagnostics n = row_count;
  return n;
end $$;

-- Ménage (chaque nuit, pg_cron) : téléphones 30 jours après la séance,
-- emails envoyés gardés 90 jours, liens de réservation d'il y a plus d'un an.
create function public.effacer_telephones_anciens() returns integer
language plpgsql set search_path = ''
as $$
declare n integer;
begin
  update public.reservations r
     set telephone = null, telephone_efface_le = now()
    from public.seances s
   where s.id = r.seance_id and r.telephone is not null
     and coalesce(s.fin, s.debut) < now() - interval '30 days';
  get diagnostics n = row_count;
  delete from public.envois where statut in ('envoye', 'echec') and cree_le < now() - interval '90 days';
  delete from public.reservations_liens where cree_le < now() - interval '1 year';
  return n;
end $$;

-- ---- Réservées à l'admin connecté ----

-- Applique une proposition. Seuls les champs listés ici peuvent changer :
-- tout autre champ envoyé par l'intervenant est ignoré.
create function public.valider_proposition(p_id uuid) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  p public.propositions;
  d jsonb;
  s public.seances;
  e public.experiences;
  v_lieu uuid;
  v_inscrits integer := 0;
  v_prises integer;
  v_capacite integer;
  v_min integer;
  v_a_prevenir boolean := false;
begin
  if not interne.est_admin() then raise exception 'RESERVE_ADMIN'; end if;
  select * into p from public.propositions where id = p_id for update;
  if not found or p.statut <> 'en_attente' then raise exception 'PROPOSITION_INDISPONIBLE'; end if;
  d := p.donnees;

  if p.type = 'fiche' then
    update public.intervenants set
      nom       = coalesce(nullif(btrim(d->>'nom'), ''), nom),
      role      = case when jsonb_typeof(d->'role') = 'object' then d->'role' else role end,
      bio       = case when jsonb_typeof(d->'bio') = 'object' then d->'bio' else bio end,
      photo_url = case when d ? 'photo_url' then d->>'photo_url' else photo_url end,
      video_url = case when d ? 'video_url' then d->>'video_url' else video_url end,
      instagram = case when d ? 'instagram' then d->>'instagram' else instagram end,
      langues   = case when jsonb_typeof(d->'langues') = 'array'
                       then array(select jsonb_array_elements_text(d->'langues')) else langues end
    where id = p.intervenant_id;

  elsif p.type = 'lieu' then
    select lieu_id into v_lieu from public.intervenants where id = p.intervenant_id;
    if v_lieu is null then raise exception 'AUCUN_LIEU_LIE'; end if;
    update public.lieux set
      description = case when jsonb_typeof(d->'description') = 'object' then d->'description' else description end,
      site      = case when d ? 'site' then d->>'site' else site end,
      instagram = case when d ? 'instagram' then d->>'instagram' else instagram end,
      facebook  = case when d ? 'facebook' then d->>'facebook' else facebook end,
      telephone = case when d ? 'telephone' then d->>'telephone' else telephone end,
      photo_url = case when d ? 'photo_url' then d->>'photo_url' else photo_url end
    where id = v_lieu;

  else  -- séance
    select * into s from public.seances where id = p.cible_id for update;
    if not found then raise exception 'SEANCE_INTROUVABLE'; end if;
    select * into e from public.experiences where id = s.experience_id;
    if e.intervenant_id is distinct from p.intervenant_id then raise exception 'SEANCE_D_UN_AUTRE'; end if;

    v_prises := interne.places_prises(s.id);
    v_capacite := coalesce((d->>'capacite_max')::integer, s.capacite_max);
    if v_capacite > e.capacite_max or v_capacite < greatest(v_prises, 1) then
      raise exception 'CAPACITE_INVALIDE';
    end if;
    v_min := coalesce((d->>'participants_min')::integer, s.participants_min);
    if v_min < 1 or v_min > v_capacite then raise exception 'MINIMUM_INVALIDE'; end if;
    select coalesce(sum(personnes), 0) into v_inscrits
      from public.reservations where seance_id = s.id and statut = 'confirmee';
    v_a_prevenir := v_inscrits > 0 and (
         (d ? 'debut' and (d->>'debut')::timestamptz is distinct from s.debut)
      or (d ? 'point_rdv' and d->>'point_rdv' is distinct from s.point_rdv)
      or (d ? 'point_rdv_precis' and d->>'point_rdv_precis' is distinct from s.point_rdv_precis));

    update public.seances set
      debut  = case when d ? 'debut' then (d->>'debut')::timestamptz else debut end,
      fin    = case when d ? 'fin' then (d->>'fin')::timestamptz else fin end,
      langue = coalesce(d->>'langue', langue),
      capacite_max = v_capacite,
      participants_min = v_min,
      point_rdv        = case when d ? 'point_rdv' then d->>'point_rdv' else point_rdv end,
      point_rdv_precis = case when d ? 'point_rdv_precis' then d->>'point_rdv_precis' else point_rdv_precis end,
      message_inscrits = case when d ? 'message_inscrits' then d->>'message_inscrits' else message_inscrits end
    where id = s.id;
  end if;

  update public.propositions
     set statut = 'validee', traitee_le = now(), traitee_par = (select auth.uid())
   where id = p.id;
  insert into public.journal_admin (acteur, action, cible_table, cible_id, details)
  values ((select auth.uid()), 'proposition_validee', 'propositions', p.id,
          jsonb_build_object('type', p.type, 'cible_id', p.cible_id,
                             'inscrits_a_prevenir', case when v_a_prevenir then v_inscrits else 0 end));

  -- inscrits_a_prevenir > 0 : l'étape 5 enverra l'email avec l'option de remboursement.
  return jsonb_build_object('statut', 'validee',
    'inscrits_a_prevenir', case when v_a_prevenir then v_inscrits else 0 end);
end $$;

create function public.refuser_proposition(p_id uuid, p_motif text default null) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare n integer;
begin
  if not interne.est_admin() then raise exception 'RESERVE_ADMIN'; end if;
  update public.propositions
     set statut = 'refusee', motif_refus = p_motif, traitee_le = now(),
         traitee_par = (select auth.uid())
   where id = p_id and statut = 'en_attente';
  get diagnostics n = row_count;
  if n = 0 then raise exception 'PROPOSITION_INDISPONIBLE'; end if;
  insert into public.journal_admin (acteur, action, cible_table, cible_id, details)
  values ((select auth.uid()), 'proposition_refusee', 'propositions', p_id,
          jsonb_build_object('motif', p_motif));
  return jsonb_build_object('statut', 'refusee');
end $$;

-- ============================================================
-- 9. DROITS D'ACCÈS
-- ============================================================

-- 9.1 Sécurité par ligne activée sur TOUTES les tables.
alter table public.localites          enable row level security;
alter table public.lieux              enable row level security;
alter table public.intervenants       enable row level security;
alter table public.profils            enable row level security;
alter table public.experiences        enable row level security;
alter table public.etapes             enable row level security;
alter table public.etapes_codes       enable row level security;
alter table public.seances            enable row level security;
alter table public.reservations       enable row level security;
alter table public.acces              enable row level security;
alter table public.paiements          enable row level security;
alter table public.remboursements     enable row level security;
alter table public.webhook_evenements enable row level security;
alter table public.propositions       enable row level security;
alter table public.demandes_groupes   enable row level security;
alter table public.candidatures       enable row level security;
alter table public.journal_admin      enable row level security;

-- 9.2 On retire tous les droits, puis on ne redonne que le nécessaire.
revoke all on all tables    in schema public from public, anon, authenticated;
revoke all on all sequences in schema public from public, anon, authenticated;
revoke all on all functions in schema public from public, anon, authenticated;
revoke all on all functions in schema interne from public, anon, authenticated;

-- Les futures tables et fonctions naissent fermées elles aussi.
alter default privileges in schema public revoke all on tables    from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges in schema public revoke all on functions from anon, authenticated;
alter default privileges revoke execute on functions from public;

grant usage on schema public  to anon, authenticated, service_role;
grant usage on schema interne to anon, authenticated, service_role;

-- Serveur (clé secrète) : tout.
grant all on all tables    in schema public to service_role;
grant all on all sequences in schema public to service_role;
grant execute on all functions in schema public  to service_role;
grant execute on all functions in schema interne to service_role;

-- Fonctions d'aide appelées par les règles ci-dessous.
grant execute on function interne.est_admin()          to anon, authenticated;
grant execute on function interne.mon_intervenant_id() to anon, authenticated;
grant execute on function interne.nom_court(text)      to authenticated;

-- Visiteur et personnes connectées : lecture du contenu.
grant select on public.localites, public.lieux, public.intervenants,
                public.experiences, public.etapes, public.seances_publiques
  to anon, authenticated;

-- Personnes connectées : les règles 9.3 décident ligne par ligne.
grant insert, update, delete on public.localites, public.lieux, public.intervenants,
                                public.experiences, public.etapes to authenticated;
grant select, insert, update, delete on public.profils, public.etapes_codes,
                                        public.seances, public.propositions to authenticated;
grant select on public.reservations, public.acces, public.paiements, public.remboursements,
                public.journal_admin, public.mes_inscrits to authenticated;
grant select, update on public.demandes_groupes, public.candidatures to authenticated;
grant execute on function public.valider_proposition(uuid)       to authenticated;
grant execute on function public.refuser_proposition(uuid, text) to authenticated;
grant select on public.adhesions to authenticated;
grant select, insert, update, delete on public.intervenants_contacts to authenticated;
grant execute on function public.annuler_seance(uuid, text) to authenticated;
grant execute on function public.signaler_absence(uuid) to authenticated;
grant execute on function public.code_import_creer() to authenticated;
grant execute on function public.ajouter_adhesion_manuelle(text, text, date, text, text, date) to authenticated;
-- Rien pour webhook_evenements ni pour les fonctions de réservation
-- et de paiement : serveur uniquement.

-- 9.3 Règles par ligne.

-- Contenu : lecture si publié (ou si c'est le sien, ou admin) ; écriture admin.
create policy "lecture" on public.localites for select to anon, authenticated
  using (actif or (select interne.est_admin()));
create policy "lecture" on public.lieux for select to anon, authenticated
  using (publie or (select interne.est_admin())
         or id = (select lieu_id from public.intervenants
                  where id = (select interne.mon_intervenant_id())));
create policy "lecture" on public.intervenants for select to anon, authenticated
  using (publie or id = (select interne.mon_intervenant_id()) or (select interne.est_admin()));
create policy "lecture" on public.experiences for select to anon, authenticated
  using ((publie and actif) or intervenant_id = (select interne.mon_intervenant_id())
         or (select interne.est_admin()));
create policy "lecture" on public.etapes for select to anon, authenticated
  using ((select interne.est_admin())
         or exists (select 1 from public.experiences e
                    where e.id = etapes.experience_id
                      and ((e.publie and e.actif and etapes.apercu)
                           or e.intervenant_id = (select interne.mon_intervenant_id()))));

create policy "admin ajoute" on public.localites for insert to authenticated
  with check ((select interne.est_admin()));
create policy "admin modifie" on public.localites for update to authenticated
  using ((select interne.est_admin())) with check ((select interne.est_admin()));
create policy "admin supprime" on public.localites for delete to authenticated
  using ((select interne.est_admin()));

create policy "admin ajoute" on public.lieux for insert to authenticated
  with check ((select interne.est_admin()));
create policy "admin modifie" on public.lieux for update to authenticated
  using ((select interne.est_admin())) with check ((select interne.est_admin()));
create policy "admin supprime" on public.lieux for delete to authenticated
  using ((select interne.est_admin()));

create policy "admin ajoute" on public.intervenants for insert to authenticated
  with check ((select interne.est_admin()));
create policy "admin modifie" on public.intervenants for update to authenticated
  using ((select interne.est_admin())) with check ((select interne.est_admin()));
create policy "admin supprime" on public.intervenants for delete to authenticated
  using ((select interne.est_admin()));

create policy "admin ajoute" on public.experiences for insert to authenticated
  with check ((select interne.est_admin()));
create policy "admin modifie" on public.experiences for update to authenticated
  using ((select interne.est_admin())) with check ((select interne.est_admin()));
create policy "admin supprime" on public.experiences for delete to authenticated
  using ((select interne.est_admin()));
-- L'intervenant propose et modifie ses visites (les champs permis sont
-- filtrés par interne.experiences_garde) et retire une proposition non publiée.
create policy "intervenant propose" on public.experiences for insert to authenticated
  with check (intervenant_id = (select interne.mon_intervenant_id()) and not publie);
create policy "intervenant modifie les siennes" on public.experiences for update to authenticated
  using (intervenant_id = (select interne.mon_intervenant_id()))
  with check (intervenant_id = (select interne.mon_intervenant_id()));
create policy "intervenant retire sa proposition" on public.experiences for delete to authenticated
  using (intervenant_id = (select interne.mon_intervenant_id()) and not publie and a_valider);

create policy "admin ajoute" on public.etapes for insert to authenticated
  with check ((select interne.est_admin()));
create policy "admin modifie" on public.etapes for update to authenticated
  using ((select interne.est_admin())) with check ((select interne.est_admin()));
create policy "admin supprime" on public.etapes for delete to authenticated
  using ((select interne.est_admin()));

create policy "admin tout" on public.etapes_codes for all to authenticated
  using ((select interne.est_admin())) with check ((select interne.est_admin()));

-- Comptes : chacun lit sa ligne ; seul l'admin attribue les rôles.
create policy "lecture de son profil" on public.profils for select to authenticated
  using (user_id = (select auth.uid()) or (select interne.est_admin()));
create policy "admin ajoute" on public.profils for insert to authenticated
  with check ((select interne.est_admin()));
create policy "admin modifie" on public.profils for update to authenticated
  using ((select interne.est_admin())) with check ((select interne.est_admin()));
create policy "admin supprime" on public.profils for delete to authenticated
  using ((select interne.est_admin()));

-- Séances : l'intervenant gère les siennes tant qu'elles ne sont pas en ligne.
create policy "lecture de ses seances" on public.seances for select to authenticated
  using ((select interne.est_admin())
         or exists (select 1 from public.experiences e
                    where e.id = seances.experience_id
                      and e.intervenant_id = (select interne.mon_intervenant_id())));
create policy "ajout de ses seances" on public.seances for insert to authenticated
  with check ((select interne.est_admin())
         or (statut in ('brouillon', 'en_attente')
             and exists (select 1 from public.experiences e
                         where e.id = seances.experience_id
                           and e.intervenant_id = (select interne.mon_intervenant_id()))));
create policy "modification de ses brouillons" on public.seances for update to authenticated
  using ((select interne.est_admin())
         or (statut in ('brouillon', 'en_attente')
             and exists (select 1 from public.experiences e
                         where e.id = seances.experience_id
                           and e.intervenant_id = (select interne.mon_intervenant_id()))))
  with check ((select interne.est_admin())
         or (statut in ('brouillon', 'en_attente')
             and exists (select 1 from public.experiences e
                         where e.id = seances.experience_id
                           and e.intervenant_id = (select interne.mon_intervenant_id()))));
create policy "suppression de ses brouillons" on public.seances for delete to authenticated
  using ((select interne.est_admin())
         or (statut = 'brouillon'
             and exists (select 1 from public.experiences e
                         where e.id = seances.experience_id
                           and e.intervenant_id = (select interne.mon_intervenant_id()))));

-- Propositions : l'intervenant dépose et suit les siennes ; l'admin tranche
-- (par valider_proposition et refuser_proposition).
create policy "lecture de ses propositions" on public.propositions for select to authenticated
  using (intervenant_id = (select interne.mon_intervenant_id()) or (select interne.est_admin()));
create policy "depot d'une proposition" on public.propositions for insert to authenticated
  with check (intervenant_id = (select interne.mon_intervenant_id())
              and statut = 'en_attente'
              and motif_refus is null and traitee_le is null and traitee_par is null
              and (type <> 'seance'
                   or exists (select 1 from public.seances s
                              join public.experiences e on e.id = s.experience_id
                              where s.id = propositions.cible_id
                                and e.intervenant_id = (select interne.mon_intervenant_id()))));
create policy "retrait d'une proposition" on public.propositions for delete to authenticated
  using ((select interne.est_admin())
         or (intervenant_id = (select interne.mon_intervenant_id()) and statut = 'en_attente'));
create policy "admin modifie" on public.propositions for update to authenticated
  using ((select interne.est_admin())) with check ((select interne.est_admin()));

-- Données des clients et argent : lecture admin seulement, écriture serveur seulement.
create policy "admin lit" on public.reservations   for select to authenticated using ((select interne.est_admin()));
create policy "admin lit" on public.acces          for select to authenticated using ((select interne.est_admin()));
create policy "admin lit" on public.paiements      for select to authenticated using ((select interne.est_admin()));
create policy "admin lit" on public.remboursements for select to authenticated using ((select interne.est_admin()));
create policy "admin lit" on public.journal_admin  for select to authenticated using ((select interne.est_admin()));

create policy "admin lit" on public.demandes_groupes for select to authenticated using ((select interne.est_admin()));
create policy "admin suit" on public.demandes_groupes for update to authenticated
  using ((select interne.est_admin())) with check ((select interne.est_admin()));
create policy "admin lit" on public.candidatures for select to authenticated using ((select interne.est_admin()));
create policy "admin suit" on public.candidatures for update to authenticated
  using ((select interne.est_admin())) with check ((select interne.est_admin()));

-- webhook_evenements : aucune règle, donc aucun accès hors serveur.

-- Adhésions et cartes : lecture par l'admin seulement, écriture par le serveur.
alter table public.adhesions    enable row level security;
alter table public.intervenants_contacts enable row level security;
alter table public.reservations_liens    enable row level security;
alter table public.envois                enable row level security;
create policy "admin et intervenant lisent" on public.intervenants_contacts for select to authenticated
  using ((select interne.est_admin()) or intervenant_id = (select interne.mon_intervenant_id()));
create policy "admin ou intervenant modifie" on public.intervenants_contacts for update to authenticated
  using ((select interne.est_admin()) or intervenant_id = (select interne.mon_intervenant_id()))
  with check ((select interne.est_admin()) or intervenant_id = (select interne.mon_intervenant_id()));
create policy "admin ajoute" on public.intervenants_contacts for insert to authenticated
  with check ((select interne.est_admin()));
create policy "admin supprime" on public.intervenants_contacts for delete to authenticated
  using ((select interne.est_admin()));
alter table public.cartes_liens enable row level security;
alter table public.codes_import enable row level security;
create policy "admin lit" on public.adhesions for select to authenticated
  using ((select interne.est_admin()));

-- 9.4 Photos des fiches et des intervenants (stockage Supabase, dossier « photos »).
-- Lecture publique par leur adresse ; envoi, remplacement et suppression
-- réservés à l'admin (les intervenants viendront avec leur espace, 6.3).
-- 5 Mo au plus par photo, JPEG, PNG ou WebP (l'app les réduit avant l'envoi).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('photos', 'photos', true, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set public = true, file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create policy "artdive photos : admin liste" on storage.objects for select to authenticated
  using (bucket_id = 'photos' and (select interne.est_admin()));
create policy "artdive photos : admin envoie" on storage.objects for insert to authenticated
  with check (bucket_id = 'photos' and (select interne.est_admin()));
create policy "artdive photos : admin remplace" on storage.objects for update to authenticated
  using (bucket_id = 'photos' and (select interne.est_admin()))
  with check (bucket_id = 'photos' and (select interne.est_admin()));
create policy "artdive photos : admin supprime" on storage.objects for delete to authenticated
  using (bucket_id = 'photos' and (select interne.est_admin()));
-- Les intervenants envoient leurs photos (fiche, visites) dans LEUR dossier seulement :
-- photos/fiches/<leur id>/… et photos/intervenants/<leur id>/… (étape 6.3).
create policy "artdive photos : intervenant envoie dans son dossier" on storage.objects for insert to authenticated
  with check (bucket_id = 'photos'
              and split_part(name, '/', 1) in ('fiches', 'intervenants')
              and split_part(name, '/', 2) = (select interne.mon_intervenant_id())::text);
-- Vidéos des intervenants (étape 6.5, facultatives) : dossier « videos » du stockage,
-- lecture publique, 50 Mo au plus (MP4, MOV, WebM ; sous-titres WebVTT).
-- Envoi par l'admin, ou par l'intervenant dans SON dossier videos/intervenants/<son id>/.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('videos', 'videos', true, 52428800, array['video/mp4', 'video/quicktime', 'video/webm', 'text/vtt'])
on conflict (id) do update set public = true, file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;
create policy "artdive videos : admin gère" on storage.objects for all to authenticated
  using (bucket_id = 'videos' and (select interne.est_admin()))
  with check (bucket_id = 'videos' and (select interne.est_admin()));
create policy "artdive videos : intervenant envoie dans son dossier" on storage.objects for insert to authenticated
  with check (bucket_id = 'videos'
              and split_part(name, '/', 1) = 'intervenants'
              and split_part(name, '/', 2) = (select interne.mon_intervenant_id())::text);

commit;

-- ============================================================
-- 10. MÉNAGE AUTOMATIQUE (facultatif, n'empêche rien s'il échoue)
-- Chaque nuit : efface les téléphones 30 jours après la séance.
-- Toutes les 5 minutes : libère les blocages dépassés.
-- ============================================================
do $$
begin
  create extension if not exists pg_cron;
  perform cron.schedule('vlaa-effacer-telephones', '17 3 * * *',
                        'select public.effacer_telephones_anciens()');
  perform cron.schedule('vlaa-liberer-blocages', '*/5 * * * *',
                        'select public.liberer_reservations_expirees()');
exception when others then
  raise notice 'Ménage automatique non programmé (%). Le test des droits le signalera.', sqlerrm;
end $$;
