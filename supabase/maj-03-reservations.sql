-- ============================================================
-- VISIT LIKE AN ARTIST : mise à jour n° 3 (réservations)
--
-- Pour une base où schema.sql, maj-01 et maj-02 sont DÉJÀ installés.
-- À coller en entier dans Supabase > SQL Editor, puis « Run ». Tout
-- passe ou rien ne passe. (Une base neuve n'en a pas besoin.)
--
-- Ajoute le cycle complet des réservations : confirmation, rappel
-- 48 h avant, « Je ne peux plus venir », frais d'annulation tardive et
-- d'absence (10 € par personne, carte enregistrée avec accord et retirée
-- 7 jours après la séance), cases des CGV horodatées, séances
-- annulées si le minimum n'est pas atteint 48 h avant, remboursements
-- et emails en file. Ensuite : relancer supabase/test-droits.sql.
-- ============================================================

begin;

do $$
begin
  if to_regclass('public.adhesions') is null then
    raise exception 'Installer d''abord maj-02-cartes-membre.sql.';
  end if;
  if to_regclass('public.envois') is not null then
    raise exception 'Cette mise à jour est déjà faite.';
  end if;
end $$;

alter table public.experiences
  add column frais_annulation_tardive_centimes integer not null default 1000 check (frais_annulation_tardive_centimes >= 0),
  add column delai_frais_heures integer not null default 24 check (delai_frais_heures >= 0),
  add column age_minimum integer check (age_minimum between 1 and 99);
alter table public.seances add column minimum_verifie_le timestamptz;
alter table public.reservations
  add column stripe_customer text,
  add column stripe_payment_method text,
  add column accord_frais_le timestamptz,
  add column cgv_version text,
  add column consentements jsonb not null default '{}',
  add column carte_retiree_le timestamptz,
  add column annulee_par text check (annulee_par in ('client', 'organisation', 'minimum', 'paiement_tardif', 'expiration')),
  add column absent_le timestamptz,
  add column rappel_envoye_le timestamptz,
  add column frais_centimes integer not null default 0 check (frais_centimes >= 0),
  add column frais_statut text not null default 'aucun'
    check (frais_statut in ('aucun', 'a_prelever', 'en_cours', 'preleve', 'a_payer', 'echec')),
  add column frais_payment_intent text unique,
  add column frais_tentatives integer not null default 0,
  add column frais_pris_le timestamptz;
alter table public.remboursements drop constraint remboursements_statut_check;
alter table public.remboursements
  add constraint remboursements_statut_check check (statut in ('a_faire', 'en_cours', 'fait', 'echec')),
  add column tentatives integer not null default 0,
  add column pris_le timestamptz;

drop function public.reserver_places(uuid, integer, text, text, text, text, boolean);
drop function public.confirmer_reservation(uuid, text, text, integer);

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

-- Ménage (chaque nuit, pg_cron) : téléphones 30 jours après la séance,
-- emails envoyés gardés 90 jours, liens de réservation d'il y a plus d'un an.
create or replace function public.effacer_telephones_anciens() returns integer
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

-- Droits : fermés par défaut, puis le strict nécessaire.
revoke all on public.intervenants_contacts, public.reservations_liens, public.envois from public, anon, authenticated;
revoke all on sequence public.envois_id_seq from public, anon, authenticated;
revoke all on function public.reserver_places(uuid, integer, text, text, text, text, jsonb, text), public.confirmer_reservation(uuid, text, text, integer, text, text), public.liberer_reservation(text, uuid), public.reservation_par_jeton(text), public.annuler_par_client(text), public.annuler_seance(uuid, text), public.signaler_absence(uuid), public.verifier_minimums(), public.preparer_rappels(), public.envois_a_traiter(integer), public.envoi_resultat(bigint, boolean, text), public.remboursements_a_traiter(integer), public.remboursement_resultat(uuid, boolean, text, text), public.frais_a_traiter(integer), public.frais_resultat(uuid, text, text, text, text), public.frais_payes(uuid, text), public.lien_reservation_session(text), public.cartes_a_retirer(integer), public.carte_retiree(uuid), public.effacer_telephones_anciens() from public, anon, authenticated;
revoke all on function interne.email_association(), interne.nouveau_jeton(), interne.sha256(text), interne.donnees_reservation(uuid), interne.envoyer(text, text, text, uuid, jsonb), interne.alerter(text, uuid, jsonb), interne.lien_reservation(uuid), interne.rembourser(uuid, text) from public, anon, authenticated;
grant all on public.intervenants_contacts, public.reservations_liens, public.envois to service_role;
grant all on sequence public.envois_id_seq to service_role;
grant execute on function public.reserver_places(uuid, integer, text, text, text, text, jsonb, text), public.confirmer_reservation(uuid, text, text, integer, text, text), public.liberer_reservation(text, uuid), public.reservation_par_jeton(text), public.annuler_par_client(text), public.annuler_seance(uuid, text), public.signaler_absence(uuid), public.verifier_minimums(), public.preparer_rappels(), public.envois_a_traiter(integer), public.envoi_resultat(bigint, boolean, text), public.remboursements_a_traiter(integer), public.remboursement_resultat(uuid, boolean, text, text), public.frais_a_traiter(integer), public.frais_resultat(uuid, text, text, text, text), public.frais_payes(uuid, text), public.lien_reservation_session(text), public.cartes_a_retirer(integer), public.carte_retiree(uuid), public.effacer_telephones_anciens() to service_role;
grant execute on function interne.email_association(), interne.nouveau_jeton(), interne.sha256(text), interne.donnees_reservation(uuid), interne.envoyer(text, text, text, uuid, jsonb), interne.alerter(text, uuid, jsonb), interne.lien_reservation(uuid), interne.rembourser(uuid, text) to service_role;
grant select, insert, update, delete on public.intervenants_contacts to authenticated;
grant execute on function public.annuler_seance(uuid, text) to authenticated;
grant execute on function public.signaler_absence(uuid) to authenticated;

commit;

select 'mise à jour n° 3 faite' as resultat;
