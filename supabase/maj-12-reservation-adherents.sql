-- ============================================================
-- ARTDIVE : mise à jour n° 12
-- Réservation réservée aux adhérents, place retenue pendant l'adhésion (E8.0), 2 cases, absence prélevée le lendemain et contestable.
--
-- Pour une base où maj-11-seances-reservees.sql est DÉJÀ installée. À coller en entier
-- dans Supabase > SQL Editor, puis « Run ». Ensuite : relancer
-- supabase/test-droits.sql. Ne modifie aucune donnée existante.
-- ============================================================

begin;

do $$
begin
  if not exists (select 1 from information_schema.columns where table_schema = 'public'
                 and table_name = 'seances' and column_name = 'reservee_adherents') then
    raise exception 'Installer d''abord maj-11-seances-reservees.sql.';
  end if;
  if exists (select 1 from information_schema.columns where table_schema = 'public'
             and table_name = 'reservations' and column_name = 'attente_adhesion') then
    raise exception 'Cette mise à jour est déjà faite.';
  end if;
end $$;

-- ---- Réservation réservée aux adhérents (maj-12, décision du 21/11) ----
-- Visites guidées, ateliers et séances « réservées aux adhérents » : il
-- faut une adhésion en cours. Un non-adhérent retient sa place 15 minutes
-- (E8.0), paie l'adhésion (abonnement 5 €/an), puis termine sa réservation.
-- L'adhérent ne paie rien en ligne : le reste se règle sur place, sa carte
-- (celle de l'abonnement, sinon une carte enregistrée sans débit) sert aux
-- frais d'absence ou d'annulation à moins de 24 h. Deux cases au plus dans
-- tout le parcours : adhésion (registre) et conditions de réservation.
-- Absence : email, prélèvement le lendemain midi, contestable avant.
alter table public.reservations
  add column attente_adhesion boolean not null default false,
  add column frais_prevu_le timestamptz,
  add column absence_contestee_le timestamptz,
  alter column cgv_acceptees_le drop not null,
  add constraint reservations_conditions_acceptees
    check (cgv_acceptees_le is not null or statut in ('en_attente', 'expiree'));

-- Séance qui exige une adhésion.
create function interne.seance_pour_adherents(p_seance public.seances, p_exp public.experiences) returns boolean
language sql immutable set search_path = ''
as $$ select p_exp.type in ('visite_guidee', 'atelier') or p_seance.reservee_adherents; $$;

-- Prix par personne réglé sur place par un adhérent : prix de la fiche moins
-- les 5 € (adhésion), ou le tarif adhérent de la séance s'il est plus bas.
create function interne.prix_adherent(p_seance public.seances, p_exp public.experiences) returns integer
language sql immutable set search_path = ''
as $$
  select least(coalesce(p_seance.prix_adherent_centimes, p_exp.prix_centimes - coalesce(p_exp.prereservation_centimes, 0)),
               p_exp.prix_centimes - coalesce(p_exp.prereservation_centimes, 0));
$$;

create or replace function public.reserver_places(
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
  v_unitaire integer;
  v_total integer;
  v_en_ligne integer;
  v_frais boolean;
  v_visite boolean;
  v_adherent boolean;
  v_accords jsonb;
begin
  -- Une seule case : les conditions de réservation (frais, rétractation, âge, non-remboursement y sont).
  select coalesce(jsonb_object_agg(k, now()), '{}'::jsonb) into v_accords
    from jsonb_each(coalesce(p_consentements, '{}'::jsonb)) as c(k, v)
   where v = 'true'::jsonb and k = 'conditions';
  if not v_accords ? 'conditions' then raise exception 'CONDITIONS_NON_ACCEPTEES'; end if;
  if coalesce(p_cgv_version, '') = '' then raise exception 'CGV_VERSION_MANQUANTE'; end if;

  select * into s from public.seances where id = p_seance_id for update;
  if not found or s.statut <> 'publiee' or s.debut <= now() then
    raise exception 'SEANCE_INDISPONIBLE';
  end if;
  select * into e from public.experiences where id = s.experience_id;
  if not (e.publie and e.actif) then raise exception 'SEANCE_INDISPONIBLE'; end if;
  v_visite := e.type in ('visite_guidee', 'atelier');

  if p_personnes is null or p_personnes < 1 or p_personnes > s.capacite_max then
    raise exception 'NOMBRE_INVALIDE';
  end if;
  if e.telephone_obligatoire and v_tel is null then raise exception 'TELEPHONE_REQUIS'; end if;

  v_adherent := interne.adhesion_valide_jusqua(v_email) is not null;
  if interne.seance_pour_adherents(s, e) and not v_adherent then raise exception 'ADHESION_REQUISE'; end if;
  v_frais := v_visite and e.frais_annulation_tardive_centimes > 0;

  v_prises := interne.places_prises(s.id);
  if v_prises + p_personnes > s.capacite_max then
    raise exception 'COMPLET' using detail = (s.capacite_max - v_prises)::text;
  end if;

  v_unitaire := case when v_visite then interne.prix_adherent(s, e) else e.prix_centimes end;
  v_total := v_unitaire * p_personnes;
  v_en_ligne := case when v_visite then 0 else v_total end;

  insert into public.reservations
    (seance_id, experience_id, nom, email, telephone, langue, personnes, statut, bloque_jusqua,
     prix_unitaire_centimes, total_centimes, paye_en_ligne_centimes, reste_sur_place_centimes,
     cgv_acceptees_le, accord_frais_le, cgv_version, consentements, adherent)
  values
    (s.id, e.id, btrim(p_nom), v_email, v_tel, coalesce(p_langue, 'fr'), p_personnes,
     'en_attente', now() + interval '15 minutes',
     v_unitaire, v_total, v_en_ligne, v_total - v_en_ligne, now(),
     case when v_frais then now() end, p_cgv_version, v_accords, v_adherent)
  returning * into r;

  return jsonb_build_object(
    'reservation_id', r.id, 'reference', r.reference,
    'a_payer_centimes', r.paye_en_ligne_centimes,
    'reste_sur_place_centimes', r.reste_sur_place_centimes,
    'bloque_jusqua', r.bloque_jusqua,
    'garder_carte', v_frais, 'age_minimum', e.age_minimum, 'adherent', v_adherent,
    'frais_centimes', case when v_frais then least(e.frais_annulation_tardive_centimes * p_personnes, v_total - v_en_ligne) else 0 end,
    'experience_type', e.type, 'experience_titre', e.titre, 'debut', s.debut);
end $$;

-- E8.0 : un non-adhérent retient sa place 15 minutes le temps de payer son adhésion.
-- Aucune condition n'est encore acceptée : elles le seront à la fin (finaliser).
create function public.retenir_pour_adhesion(
  p_seance_id uuid, p_personnes integer, p_nom text, p_email text,
  p_telephone text default null, p_langue text default 'fr'
) returns jsonb
language plpgsql set search_path = ''
as $$
declare
  s public.seances;
  e public.experiences;
  r public.reservations;
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_prises integer;
  v_unitaire integer;
begin
  if v_email !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' or length(btrim(coalesce(p_nom, ''))) not between 1 and 120 then
    raise exception 'PARAMETRES';
  end if;
  select * into s from public.seances where id = p_seance_id for update;
  if not found or s.statut <> 'publiee' or s.debut <= now() then raise exception 'SEANCE_INDISPONIBLE'; end if;
  select * into e from public.experiences where id = s.experience_id;
  if not (e.publie and e.actif) then raise exception 'SEANCE_INDISPONIBLE'; end if;
  -- Visites et ateliers seulement (une soirée réservée aux adhérents se paie en ligne : adhérer d'abord).
  if e.type not in ('visite_guidee', 'atelier') then raise exception 'ADHESION_INUTILE'; end if;
  if interne.adhesion_valide_jusqua(v_email) is not null then raise exception 'DEJA_ADHERENT'; end if;
  if p_personnes is null or p_personnes < 1 or p_personnes > s.capacite_max then raise exception 'NOMBRE_INVALIDE'; end if;
  v_prises := interne.places_prises(s.id);
  if v_prises + p_personnes > s.capacite_max then
    raise exception 'COMPLET' using detail = (s.capacite_max - v_prises)::text;
  end if;
  v_unitaire := interne.prix_adherent(s, e);
  insert into public.reservations
    (seance_id, experience_id, nom, email, telephone, langue, personnes, statut, bloque_jusqua,
     prix_unitaire_centimes, total_centimes, paye_en_ligne_centimes, reste_sur_place_centimes, attente_adhesion)
  values
    (s.id, e.id, btrim(p_nom), v_email, nullif(btrim(coalesce(p_telephone, '')), ''), coalesce(p_langue, 'fr'), p_personnes,
     'en_attente', now() + interval '15 minutes', v_unitaire, v_unitaire * p_personnes, 0, v_unitaire * p_personnes, true)
  returning * into r;
  return jsonb_build_object('reservation_id', r.id, 'reference', r.reference, 'bloque_jusqua', r.bloque_jusqua);
end $$;

-- Après le paiement de l'adhésion : la place retenue devient une réservation
-- (case « conditions » cochée, adhésion vérifiée, places revérifiées si le délai est passé).
create function public.finaliser_reservation_adherent(
  p_reservation_id uuid, p_email text, p_consentements jsonb, p_cgv_version text
) returns jsonb
language plpgsql set search_path = ''
as $$
declare
  r public.reservations;
  s public.seances;
  e public.experiences;
  v_frais boolean;
begin
  if not (coalesce(p_consentements, '{}'::jsonb) -> 'conditions') = 'true'::jsonb then
    raise exception 'CONDITIONS_NON_ACCEPTEES';
  end if;
  if coalesce(p_cgv_version, '') = '' then raise exception 'CGV_VERSION_MANQUANTE'; end if;
  select seance_id into r.seance_id from public.reservations where id = p_reservation_id;
  if not found then raise exception 'RESERVATION_INTROUVABLE'; end if;
  select * into s from public.seances where id = r.seance_id for update;
  select * into r from public.reservations where id = p_reservation_id for update;
  if r.email <> lower(btrim(coalesce(p_email, ''))) or not r.attente_adhesion then raise exception 'RESERVATION_INTROUVABLE'; end if;
  if r.statut not in ('en_attente', 'expiree') then raise exception 'RESERVATION_INTROUVABLE'; end if;
  if interne.adhesion_valide_jusqua(r.email) is null then raise exception 'ADHESION_REQUISE'; end if;
  if s.statut <> 'publiee' or s.debut <= now() then raise exception 'SEANCE_INDISPONIBLE'; end if;
  if (r.statut = 'expiree' or r.bloque_jusqua <= now())
     and interne.places_prises(s.id) + r.personnes > s.capacite_max then
    raise exception 'COMPLET';
  end if;
  select * into e from public.experiences where id = r.experience_id;
  v_frais := e.type in ('visite_guidee', 'atelier') and e.frais_annulation_tardive_centimes > 0;
  update public.reservations set
    statut = 'en_attente', bloque_jusqua = now() + interval '15 minutes', annulee_par = null,
    attente_adhesion = false, adherent = true,
    cgv_acceptees_le = now(), cgv_version = p_cgv_version,
    consentements = jsonb_build_object('conditions', now()),
    accord_frais_le = case when v_frais then now() end
  where id = r.id returning * into r;
  return jsonb_build_object(
    'reservation_id', r.id, 'reference', r.reference,
    'a_payer_centimes', r.paye_en_ligne_centimes, 'reste_sur_place_centimes', r.reste_sur_place_centimes,
    'bloque_jusqua', r.bloque_jusqua, 'garder_carte', v_frais, 'adherent', true,
    'experience_type', e.type, 'experience_titre', e.titre, 'debut', s.debut);
end $$;

-- Confirmation : une réservation sans paiement se confirme avec une carte
-- (celle de l'adhésion, ou une carte enregistrée sans débit).
create or replace function public.confirmer_reservation(
  p_reservation_id uuid, p_stripe_session_id text, p_stripe_payment_intent text,
  p_montant_centimes integer, p_stripe_customer text default null,
  p_stripe_payment_method text default null, p_stripe_setup_intent text default null
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

  if r.stripe_payment_intent is not null or r.stripe_setup_intent is not null or r.statut = 'confirmee' then
    return jsonb_build_object('statut', r.statut, 'deja_traitee', true, 'reference', r.reference);
  end if;
  if r.attente_adhesion or r.cgv_acceptees_le is null then raise exception 'CONDITIONS_NON_ACCEPTEES'; end if;
  if p_montant_centimes is distinct from r.paye_en_ligne_centimes then
    raise exception 'MONTANT_INCOHERENT';
  end if;
  if (r.paye_en_ligne_centimes > 0 and p_stripe_payment_intent is null)
     or (r.paye_en_ligne_centimes = 0 and p_stripe_setup_intent is null and p_stripe_payment_method is null) then
    raise exception 'PAIEMENT_INCOMPLET';
  end if;

  if s.statut <> 'publiee' or s.debut <= now() or r.statut not in ('en_attente', 'expiree') then
    v_ok := false;
  elsif r.statut = 'expiree' or r.bloque_jusqua <= now() then
    v_ok := interne.places_prises(s.id) + r.personnes <= s.capacite_max;
  end if;

  select * into e from public.experiences where id = r.experience_id;
  if p_montant_centimes > 0 then
    insert into public.paiements
      (reservation_id, experience_id, experience_type, localite_id, intervenant_id,
       montant_centimes, stripe_session_id, stripe_payment_intent)
    values
      (r.id, e.id, e.type, e.localite_id, e.intervenant_id,
       p_montant_centimes, p_stripe_session_id, p_stripe_payment_intent);
  end if;

  update public.reservations
     set stripe_session_id = p_stripe_session_id,
         stripe_payment_intent = p_stripe_payment_intent,
         stripe_setup_intent = p_stripe_setup_intent,
         stripe_customer = p_stripe_customer,
         stripe_payment_method = case when accord_frais_le is not null then p_stripe_payment_method end,
         bloque_jusqua = null,
         statut = case when v_ok then 'confirmee' else 'annulee' end,
         confirmee_le = case when v_ok then now() end,
         annulee_le = case when v_ok then null else now() end,
         annulee_par = case when v_ok then null else 'paiement_tardif' end,
         motif_annulation = case when v_ok then null else 'Confirmation arrivée après la fin du blocage, plus de place.' end
   where id = r.id;

  if v_ok then
    v_jeton := interne.lien_reservation(r.id);
    perform interne.envoyer('confirmation', r.email, r.langue, r.id, jsonb_build_object('jeton', v_jeton));
    perform interne.alerter('alerte_inscription', r.id);
    return jsonb_build_object('statut', 'confirmee', 'deja_traitee', false, 'reference', r.reference);
  end if;

  perform interne.rembourser(r.id, 'paiement_tardif');
  perform interne.envoyer('paiement_tardif', r.email, r.langue, r.id);
  return jsonb_build_object('statut', 'annulee', 'deja_traitee', false, 'a_rembourser', p_montant_centimes > 0);
end $$;

-- Lien personnel d'une réservation confirmée sans passer par Stripe (carte de l'adhésion).
create function public.lien_reservation_par_id(p_reservation_id uuid) returns jsonb
language plpgsql set search_path = ''
as $$
declare r public.reservations;
begin
  select * into r from public.reservations where id = p_reservation_id;
  if not found then return null; end if;
  return jsonb_build_object('jeton', interne.lien_reservation(r.id), 'statut', r.statut);
end $$;

-- Données des emails : date prévue du prélèvement d'absence.
create or replace function interne.donnees_reservation(p_id uuid) returns jsonb
language sql stable set search_path = ''
as $$
  select jsonb_build_object(
    'reference', r.reference, 'nom', r.nom, 'email', r.email, 'telephone', r.telephone,
    'personnes', r.personnes,
    'paye_en_ligne_centimes', r.paye_en_ligne_centimes,
    'reste_sur_place_centimes', r.reste_sur_place_centimes,
    'total_centimes', r.total_centimes,
    'prix_unitaire_centimes', r.prix_unitaire_centimes,
    'frais_centimes', r.frais_centimes,
    'frais_prevu_le', r.frais_prevu_le,
    'adherent', r.adherent,
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

-- Absence (E9.6, E11.3) : marquée après l'heure de la séance, par l'intervenant
-- de la séance (ou l'admin). Email tout de suite, prélèvement le lendemain à
-- midi (heure de Paris), annulable par « Je me suis présenté(e) » avant.
create or replace function public.signaler_absence(p_reservation_id uuid) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  r public.reservations;
  s public.seances;
  e public.experiences;
  v_frais integer := 0;
  v_prevu timestamptz;
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

  v_frais := interne.frais_dus(r.id);
  v_prevu := (date_trunc('day', now() at time zone 'Europe/Paris') + interval '1 day 12 hours') at time zone 'Europe/Paris';
  update public.reservations set absent_le = now(), frais_centimes = v_frais,
         frais_statut = case when v_frais > 0 then 'a_prelever' else 'aucun' end,
         frais_prevu_le = case when v_frais > 0 then v_prevu end
   where id = r.id;
  if v_frais > 0 then
    perform interne.envoyer('absence', r.email, r.langue, r.id,
      jsonb_build_object('jeton', interne.lien_reservation(r.id), 'frais_centimes', v_frais, 'frais_prevu_le', v_prevu));
  end if;
  insert into public.journal_admin (acteur, action, cible_table, cible_id, details)
  values ((select auth.uid()), 'absence_signalee', 'reservations', r.id, jsonb_build_object('frais_centimes', v_frais));
  return jsonb_build_object('deja_signale', false, 'frais_centimes', v_frais,
                            'frais_prevu_le', case when v_frais > 0 then v_prevu end);
end $$;

-- « Je me suis présenté(e) » : avant l'heure du prélèvement, les frais sont annulés
-- et l'association et l'intervenant sont prévenus.
create function public.signaler_presence(p_jeton_hash text) returns jsonb
language plpgsql set search_path = ''
as $$
declare
  v_id uuid;
  r public.reservations;
begin
  select reservation_id into v_id from public.reservations_liens where jeton_hash = p_jeton_hash;
  if not found then raise exception 'LIEN_INVALIDE'; end if;
  select * into r from public.reservations where id = v_id for update;
  if r.absent_le is null then return jsonb_build_object('statut', 'non_absent'); end if;
  if r.absence_contestee_le is not null then return jsonb_build_object('statut', 'deja_signale'); end if;
  if r.frais_statut <> 'a_prelever' or r.frais_prevu_le is null or r.frais_prevu_le <= now() then
    return jsonb_build_object('statut', 'trop_tard');
  end if;
  update public.reservations set frais_statut = 'aucun', frais_centimes = 0, frais_prevu_le = null,
         absence_contestee_le = now()
   where id = r.id;
  perform interne.alerter('alerte_presence', r.id, jsonb_build_object('frais_annules_centimes', r.frais_centimes));
  return jsonb_build_object('statut', 'annule');
end $$;

-- File des frais : une absence n'est prélevée qu'à l'heure prévue.
create or replace function public.frais_a_traiter(p_limite integer default 20) returns jsonb
language sql set search_path = ''
as $$
  with pris as (
    update public.reservations set frais_statut = 'en_cours', frais_tentatives = frais_tentatives + 1,
                                   frais_pris_le = now()
     where id in (select id from public.reservations
                   where ((frais_statut = 'a_prelever' and (frais_prevu_le is null or frais_prevu_le <= now()))
                          or (frais_statut = 'en_cours' and frais_pris_le < now() - interval '30 minutes'))
                     and frais_tentatives < 5
                   order by annulee_le nulls last limit p_limite for update skip locked)
    returning *)
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'reference', reference, 'email', email,
                  'montant_centimes', frais_centimes, 'stripe_customer', stripe_customer,
                  'stripe_payment_method', stripe_payment_method,
                  'motif', case when absent_le is not null then 'absence' else 'annulation_tardive' end)), '[]'::jsonb)
    from pris;
$$;

-- Lien personnel : état de l'absence (bouton « Je me suis présenté(e) »).
create or replace function public.reservation_par_jeton(p_jeton_hash text) returns jsonb
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
    'frais_si_annulation_centimes', case when v_tardif then interne.frais_dus(r.id) else 0 end,
    'frais_statut', r.frais_statut, 'adherent', r.adherent,
    'absent', r.absent_le is not null,
    'absence_contestee', r.absence_contestee_le is not null,
    'absence_contestable', r.absent_le is not null and r.frais_statut = 'a_prelever'
                           and r.frais_prevu_le > now() and r.absence_contestee_le is null);
end $$;

-- Inscrits (E11.3) : état du prélèvement d'absence.
create or replace view public.mes_inscrits with (security_barrier = true) as
select r.id, r.seance_id, s.experience_id, s.debut,
       interne.nom_court(r.nom) as nom,
       r.personnes, r.telephone, r.langue, r.reste_sur_place_centimes,
       r.adherent, r.absent_le, r.frais_centimes, r.frais_statut, r.frais_prevu_le
from public.reservations r
join public.seances s on s.id = r.seance_id
join public.experiences e on e.id = s.experience_id
where r.statut = 'confirmee'
  and (e.intervenant_id = (select interne.mon_intervenant_id())
       or (select interne.est_admin()));

revoke all on function interne.seance_pour_adherents(public.seances, public.experiences),
  interne.prix_adherent(public.seances, public.experiences),
  public.retenir_pour_adhesion(uuid, integer, text, text, text, text),
  public.finaliser_reservation_adherent(uuid, text, jsonb, text),
  public.lien_reservation_par_id(uuid), public.signaler_presence(text) from public, anon, authenticated;
grant execute on function interne.seance_pour_adherents(public.seances, public.experiences),
  interne.prix_adherent(public.seances, public.experiences),
  public.retenir_pour_adhesion(uuid, integer, text, text, text, text),
  public.finaliser_reservation_adherent(uuid, text, jsonb, text),
  public.lien_reservation_par_id(uuid), public.signaler_presence(text) to service_role;

-- Carte de l'adhésion (ni paiement ni carte enregistrée pour la réservation) :
-- on la « libère » pour la réservation sans jamais la retirer de Stripe, sinon
-- l'abonnement d'adhésion ne pourrait plus se renouveler.
create or replace function public.cartes_a_retirer(p_limite integer default 20) returns jsonb
language sql stable set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'stripe_payment_method', x.stripe_payment_method,
                                               'carte_adhesion', x.carte_adhesion)), '[]'::jsonb)
    from (select r.id, r.stripe_payment_method,
                 (r.stripe_payment_intent is null and r.stripe_setup_intent is null) as carte_adhesion
            from public.reservations r join public.seances s on s.id = r.seance_id
           where r.stripe_payment_method is not null and r.carte_retiree_le is null
             and r.frais_statut not in ('a_prelever', 'en_cours', 'a_payer')
             and (coalesce(s.fin, s.debut) < now() - interval '7 days'
                  or s.statut = 'annulee'
                  or r.statut in ('remboursee', 'expiree')
                  or (r.statut = 'annulee' and r.frais_statut in ('aucun', 'preleve', 'echec')))
           order by r.cree_le limit p_limite) x;
$$;

commit;
