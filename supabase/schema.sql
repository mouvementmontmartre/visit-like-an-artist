-- ============================================================
-- VISIT LIKE AN ARTIST : schéma de la base (étape 4)
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

-- Référence lisible d'une réservation, ex. VLAA-2K7F9Q (sans 0, O, 1, I)
create function interne.nouvelle_reference() returns text
language sql volatile set search_path = ''
as $$
  select 'VLAA-' || string_agg(
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
  statut        text not null default 'a_faire' check (statut in ('a_faire', 'fait', 'echec')),
  stripe_refund_id text unique,
  demande_par   uuid,                   -- compte admin, vide si automatique
  note          text,
  cree_le       timestamptz not null default now(),
  fait_le       timestamptz
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

-- Bloque des places 15 minutes. La séance est verrouillée pendant le
-- calcul : deux personnes ne peuvent pas prendre la dernière place.
-- Les prix viennent de la base, jamais du navigateur.
create function public.reserver_places(
  p_seance_id uuid, p_personnes integer, p_nom text, p_email text,
  p_telephone text default null, p_langue text default 'fr',
  p_cgv_acceptees boolean default false
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
begin
  if not coalesce(p_cgv_acceptees, false) then raise exception 'CGV_NON_ACCEPTEES'; end if;

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
     cgv_acceptees_le)
  values
    (s.id, e.id, btrim(p_nom), v_email, v_tel, coalesce(p_langue, 'fr'), p_personnes,
     'en_attente', now() + interval '15 minutes',
     e.prix_centimes, v_total, v_en_ligne, v_total - v_en_ligne, now())
  returning * into r;

  return jsonb_build_object(
    'reservation_id', r.id, 'reference', r.reference,
    'a_payer_centimes', r.paye_en_ligne_centimes,
    'reste_sur_place_centimes', r.reste_sur_place_centimes,
    'bloque_jusqua', r.bloque_jusqua,
    'experience_type', e.type, 'experience_titre', e.titre);
end $$;

-- Appelée par le webhook Stripe quand le paiement est encaissé.
-- Peut être appelée deux fois sans dégât. Si le paiement arrive après
-- la fin du blocage et que la séance est pleine, elle répond
-- a_rembourser = true au lieu de vendre une place qui n'existe plus.
create function public.confirmer_reservation(
  p_reservation_id uuid, p_stripe_session_id text,
  p_stripe_payment_intent text, p_montant_centimes integer
) returns jsonb
language plpgsql set search_path = ''
as $$
declare
  r public.reservations;
  s public.seances;
  e public.experiences;
  v_ok boolean := true;
begin
  select seance_id into r.seance_id from public.reservations where id = p_reservation_id;
  if not found then raise exception 'RESERVATION_INTROUVABLE'; end if;
  select * into s from public.seances where id = r.seance_id for update;
  select * into r from public.reservations where id = p_reservation_id for update;

  if r.statut = 'confirmee' then
    return jsonb_build_object('statut', 'confirmee', 'deja_traitee', true,
                              'a_rembourser', false, 'reference', r.reference);
  end if;
  if r.stripe_payment_intent is not null then      -- déjà encaissée puis refusée
    return jsonb_build_object('statut', r.statut, 'deja_traitee', true, 'a_rembourser', true);
  end if;
  if p_montant_centimes is distinct from r.paye_en_ligne_centimes then
    raise exception 'MONTANT_INCOHERENT';
  end if;

  if s.statut <> 'publiee' or r.statut not in ('en_attente', 'expiree') then
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

  if v_ok then
    update public.reservations
       set statut = 'confirmee', confirmee_le = now(), bloque_jusqua = null,
           stripe_session_id = p_stripe_session_id,
           stripe_payment_intent = p_stripe_payment_intent
     where id = r.id;
    return jsonb_build_object('statut', 'confirmee', 'deja_traitee', false,
                              'a_rembourser', false, 'reference', r.reference);
  end if;

  update public.reservations
     set statut = 'annulee', annulee_le = now(), bloque_jusqua = null,
         motif_annulation = 'Paiement arrivé après la fin du blocage, plus de place.',
         stripe_session_id = p_stripe_session_id,
         stripe_payment_intent = p_stripe_payment_intent
   where id = r.id;
  return jsonb_build_object('statut', 'annulee', 'deja_traitee', false, 'a_rembourser', true);
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

-- Ménage : téléphones des inscrits effacés 30 jours après la séance.
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
alter table public.cartes_liens enable row level security;
alter table public.codes_import enable row level security;
create policy "admin lit" on public.adhesions for select to authenticated
  using ((select interne.est_admin()));

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
