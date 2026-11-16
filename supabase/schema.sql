-- ============================================================
-- Schéma de données (à exécuter dans Supabase > SQL Editor)
-- Étape 1 : PROPOSITION À VALIDER, rien n'est encore connecté à l'app.
-- Principe : tout est rattaché à une localité. Les clés secrètes restent
-- côté serveur (fonctions Netlify). Le client public ne lit que les
-- données publiées ; il n'écrit jamais directement.
-- ============================================================

create extension if not exists "pgcrypto";

create type offre_type as enum
  ('autoguidee','escape_game','visite_guidee','atelier','day_trip','soiree');
create type reservation_statut as enum
  ('en_attente','confirmee','annulee','effectuee','expiree');
create type demande_statut as enum
  ('nouvelle','devis_envoye','confirmee','refusee');
create type role_utilisateur as enum ('admin','guide');

-- Localités (Montmartre aujourd'hui)
create table localites (
  id text primary key,               -- ex. 'montmartre' (= config.js)
  nom text not null,
  actif boolean not null default true
);

-- Comptes : lié à Supabase Auth (email + mot de passe)
create table profils (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role role_utilisateur not null,
  guide_id uuid,
  cree_le timestamptz not null default now()
);

-- Guides et artistes (fiche publique, validée par l'admin)
create table guides (
  id uuid primary key default gen_random_uuid(),
  localite_id text not null references localites(id),
  nom text not null,
  photo_url text,
  bio jsonb not null default '{}',          -- {"fr":"..","en":"..","es":".."}
  specialites text[] not null default '{}',
  langues text[] not null default '{}',
  liens jsonb not null default '{}',
  agree boolean not null default false,     -- guide-conférencier agréé
  publie boolean not null default false,    -- validation admin
  cree_le timestamptz not null default now()
);
alter table profils add constraint profils_guide_fk foreign key (guide_id) references guides(id);

-- Lieux et partenaires
create table lieux (
  id uuid primary key default gen_random_uuid(),
  localite_id text not null references localites(id),
  nom text not null,
  type text,
  adresse text,
  lat double precision, lng double precision,
  lien text,
  publie boolean not null default false
);

-- Activités (les six offres)
create table activites (
  id uuid primary key default gen_random_uuid(),
  localite_id text not null references localites(id),
  offre offre_type not null,
  titre jsonb not null,                      -- traductions
  description jsonb not null default '{}',
  guide_id uuid references guides(id),
  lieu_id uuid references lieux(id),
  photo_url text,
  prix_centimes integer,                     -- null = prix libre / non applicable
  prix_min_centimes integer,                 -- prix libre : 500 pour l'autoguidée
  frais_reservation_centimes integer,        -- 500 pour les visites guidées
  accepte_groupes boolean not null default false,
  groupe_min integer, groupe_max integer,
  privatisable boolean not null default false,
  politique_annulation jsonb not null default '{}',
  lien_externe text,                         -- day trips (Alma Mundi), soirées (billetterie)
  organisateur text,                         -- soirées partenaires
  actif boolean not null default true,       -- escape game désactivable
  publie boolean not null default false,
  cree_le timestamptz not null default now()
);

-- Créneaux (places limitées)
create table creneaux (
  id uuid primary key default gen_random_uuid(),
  activite_id uuid not null references activites(id) on delete cascade,
  debut timestamptz not null,
  fin timestamptz,
  langue text not null default 'fr',
  capacite_max integer not null check (capacite_max > 0),
  participants_min integer not null default 1,
  point_rdv text,
  statut text not null default 'ouvert'      -- ouvert, complet, annule
);

-- Réservations : une place est BLOQUÉE 15 min (bloque_jusqua) pendant le paiement
create table reservations (
  id uuid primary key default gen_random_uuid(),
  creneau_id uuid not null references creneaux(id),
  activite_id uuid not null references activites(id),
  localite_id text not null references localites(id),
  nom text not null,
  email text not null,
  langue text not null default 'fr',
  personnes integer not null check (personnes > 0),
  statut reservation_statut not null default 'en_attente',
  bloque_jusqua timestamptz,
  stripe_session_id text unique,
  cgv_acceptees_le timestamptz,              -- case CGV cochée avant paiement
  cree_le timestamptz not null default now()
);
create index on reservations (creneau_id, statut);

-- Journal des ventes (source de l'export CSV comptable)
create table ventes (
  id uuid primary key default gen_random_uuid(),
  date timestamptz not null default now(),
  offre offre_type not null,
  montant_centimes integer not null,
  devise text not null default 'eur',
  localite_id text not null references localites(id),
  guide_id uuid references guides(id),
  reservation_id uuid references reservations(id),
  stripe_session_id text unique,
  stripe_payment_intent text,
  statut text not null,                      -- paye, echec, rembourse
  metadata jsonb not null default '{}'       -- type d'offre, édition, localité, visite, guide, date, personnes
);

-- Idempotence du webhook : un évènement Stripe n'est traité qu'une fois
create table webhook_evenements (
  stripe_event_id text primary key,
  type text not null,
  recu_le timestamptz not null default now()
);

-- Demandes groupes / CSE et lieux partenaires (suivi admin uniquement)
create table demandes_groupes (
  id uuid primary key default gen_random_uuid(),
  organisation text not null, contact_nom text not null, contact_email text not null,
  personnes integer, date_souhaitee date, type_activite text,
  localite_id text references localites(id), message text,
  statut demande_statut not null default 'nouvelle',
  cree_le timestamptz not null default now()
);
create table candidatures_lieux (
  id uuid primary key default gen_random_uuid(),
  nom_lieu text not null, contact text not null, type_lieu text, message text,
  traitee boolean not null default false,
  cree_le timestamptz not null default now()
);

-- Sécurité : RLS activée partout. Lecture publique limitée au contenu publié,
-- toute écriture passe par les fonctions serveur (clé service_role).
alter table localites enable row level security;
alter table profils enable row level security;
alter table guides enable row level security;
alter table lieux enable row level security;
alter table activites enable row level security;
alter table creneaux enable row level security;
alter table reservations enable row level security;
alter table ventes enable row level security;
alter table webhook_evenements enable row level security;
alter table demandes_groupes enable row level security;
alter table candidatures_lieux enable row level security;

create policy "lecture publique localites" on localites for select using (actif);
create policy "lecture publique guides" on guides for select using (publie);
create policy "lecture publique lieux" on lieux for select using (publie);
create policy "lecture publique activites" on activites for select using (publie and actif);
create policy "lecture publique creneaux" on creneaux for select using (true);
-- reservations, ventes, demandes : aucune policy publique = accès serveur uniquement.
