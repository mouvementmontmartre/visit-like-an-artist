-- ============================================================
-- ARTDIVE : mise à jour n° 8 (adhérents, tarif adhérent, frais plafonnés)
--
-- Pour une base où maj-07 est DÉJÀ installée. À coller en entier dans
-- Supabase > SQL Editor, puis « Run ». Ensuite : relancer
-- supabase/test-droits.sql.
--
-- Décisions du 20/11 :
-- - adhérent reconnu par son email (adhésion valable) : pré-réservation
--   offerte, carte enregistrée sans débit, tarif adhérent de la séance
--   s'il existe (fixé par l'intervenant) ;
-- - frais d'annulation tardive (moins de 24 h) ou d'absence : 10 € par
--   personne par défaut, jamais plus que le solde sur place, versés à
--   l'association (mécanisme existant, seulement plafonné).
-- ============================================================

begin;

do $$
begin
  if not exists (select 1 from information_schema.columns where table_schema = 'public'
                 and table_name = 'acces' and column_name = 'consentements') then
    raise exception 'Installer d''abord maj-07-parcours.sql.';
  end if;
  if exists (select 1 from information_schema.columns where table_schema = 'public'
             and table_name = 'reservations' and column_name = 'adherent') then
    raise exception 'Cette mise à jour est déjà faite.';
  end if;
end $$;

alter table public.seances
  add column prix_adherent_centimes integer check (prix_adherent_centimes >= 0);
alter table public.reservations
  add column adherent boolean not null default false,
  add column stripe_setup_intent text unique;


create or replace view public.seances_publiques with (security_barrier = true) as
select s.id, s.experience_id, s.debut, s.fin, s.langue,
       s.capacite_max, s.participants_min, s.point_rdv, s.statut,
       coalesce(r.inscrits, 0)::integer                             as inscrits,
       greatest(s.capacite_max - coalesce(r.prises, 0), 0)::integer as places_restantes,
       coalesce(r.inscrits, 0) >= s.participants_min                as confirmee,
       s.prix_adherent_centimes
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

create or replace view public.mes_inscrits with (security_barrier = true) as
select r.id, r.seance_id, s.experience_id, s.debut,
       interne.nom_court(r.nom) as nom,
       r.personnes, r.telephone, r.langue, r.reste_sur_place_centimes,
       r.adherent, r.absent_le, r.frais_centimes
from public.reservations r
join public.seances s on s.id = r.seance_id
join public.experiences e on e.id = s.experience_id
where r.statut = 'confirmee'
  and (e.intervenant_id = (select interne.mon_intervenant_id())
       or (select interne.est_admin()));

create or replace function interne.seances_garde() returns trigger
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
  if new.prix_adherent_centimes is not null and e.prix_centimes is not null
     and new.prix_adherent_centimes > e.prix_centimes then
    raise exception 'Tarif adhérent : il ne peut pas dépasser le prix normal (%).', e.prix_centimes;
  end if;

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

create or replace function interne.adhesion_valide_jusqua(p_email text) returns timestamptz
language sql stable set search_path = ''
as $$
  select max(valide_jusqua) from public.adhesions
   where email = lower(btrim(coalesce(p_email, ''))) and statut <> 'remboursee'
     and debut <= now() and valide_jusqua > now();
$$;

create or replace function interne.frais_dus(p_reservation uuid) returns integer
language sql stable set search_path = ''
as $$
  select case
    when r.stripe_payment_method is null or e.frais_annulation_tardive_centimes <= 0
         or e.type not in ('visite_guidee', 'atelier') then 0
    else least(e.frais_annulation_tardive_centimes * r.personnes, r.reste_sur_place_centimes)
  end
  from public.reservations r join public.experiences e on e.id = r.experience_id
  where r.id = p_reservation;
$$;

create or replace function public.adhesion_pour_reservation(p_email text) returns jsonb
language sql stable set search_path = ''
as $$
  select jsonb_build_object('adherent', v is not null, 'valide_jusqua', v)
    from (select interne.adhesion_valide_jusqua(p_email) as v) x;
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
  v_adherent boolean := false;
  v_accords jsonb;
begin
  -- Cases cochées : chacune est gardée avec son heure.
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
  v_visite := e.type in ('visite_guidee', 'atelier');

  if p_personnes is null or p_personnes < 1 or p_personnes > s.capacite_max then
    raise exception 'NOMBRE_INVALIDE';
  end if;
  if e.telephone_obligatoire and v_tel is null then raise exception 'TELEPHONE_REQUIS'; end if;
  if e.age_minimum is not null and not v_accords ? 'age' then raise exception 'AGE_NON_CONFIRME'; end if;
  v_frais := v_visite and e.frais_annulation_tardive_centimes > 0;
  if v_frais and not v_accords ? 'prelevement' then raise exception 'ACCORD_FRAIS_REQUIS'; end if;

  v_prises := interne.places_prises(s.id);
  if v_prises + p_personnes > s.capacite_max then
    raise exception 'COMPLET' using detail = (s.capacite_max - v_prises)::text;
  end if;

  -- Adhérent (visites et ateliers) : pré-réservation offerte et tarif adhérent de la séance s'il existe.
  v_adherent := v_visite and interne.adhesion_valide_jusqua(v_email) is not null;
  v_unitaire := case when v_adherent and s.prix_adherent_centimes is not null
                     then least(s.prix_adherent_centimes, e.prix_centimes) else e.prix_centimes end;
  v_total := v_unitaire * p_personnes;
  v_en_ligne := case when not v_visite then v_total
                     when v_adherent then 0
                     else least(e.prereservation_centimes, v_unitaire) * p_personnes end;

  if v_en_ligne > 0 and not v_accords ? 'non_remboursable' then raise exception 'CONSENTEMENTS_MANQUANTS'; end if;
  if not v_accords ? 'sans_retractation' then raise exception 'CONSENTEMENTS_MANQUANTS'; end if;

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
    'frais_statut', r.frais_statut, 'adherent', r.adherent);
end $$;

create or replace function public.annuler_par_client(p_jeton_hash text) returns jsonb
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

  -- Moins de 24 h avant (délai de l'expérience) : frais d'annulation tardive, plafonnés au solde.
  if now() > s.debut - make_interval(hours => e.delai_frais_heures) then
    v_frais := interne.frais_dus(r.id);
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

create or replace function public.signaler_absence(p_reservation_id uuid) returns jsonb
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

  v_frais := interne.frais_dus(r.id);
  update public.reservations set absent_le = now(), frais_centimes = v_frais,
         frais_statut = case when v_frais > 0 then 'a_prelever' else 'aucun' end
   where id = r.id;
  insert into public.journal_admin (acteur, action, cible_table, cible_id, details)
  values ((select auth.uid()), 'absence_signalee', 'reservations', r.id, jsonb_build_object('frais_centimes', v_frais));
  return jsonb_build_object('deja_signale', false, 'frais_centimes', v_frais);
end $$;

create or replace function public.valider_proposition(p_id uuid) returns jsonb
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
      message_inscrits = case when d ? 'message_inscrits' then d->>'message_inscrits' else message_inscrits end,
      prix_adherent_centimes = case when d ? 'prix_adherent_centimes'
                                    then (d->>'prix_adherent_centimes')::integer else prix_adherent_centimes end
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

drop function public.confirmer_reservation(uuid, text, text, integer, text, text);

create function public.confirmer_reservation(
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

  if r.stripe_payment_intent is not null or r.stripe_setup_intent is not null then
    return jsonb_build_object('statut', r.statut, 'deja_traitee', true, 'reference', r.reference);
  end if;
  if p_montant_centimes is distinct from r.paye_en_ligne_centimes then
    raise exception 'MONTANT_INCOHERENT';
  end if;
  -- Paiement : un PaymentIntent ; adhérent (rien à payer) : une carte enregistrée (SetupIntent).
  if (r.paye_en_ligne_centimes > 0 and p_stripe_payment_intent is null)
     or (r.paye_en_ligne_centimes = 0 and p_stripe_setup_intent is null) then
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
  return jsonb_build_object('statut', 'annulee', 'deja_traitee', false, 'a_rembourser', p_montant_centimes > 0);
end $$;

-- Droits : serveur uniquement pour les nouvelles fonctions.
revoke all on function public.confirmer_reservation(uuid, text, text, integer, text, text, text),
  public.adhesion_pour_reservation(text),
  interne.adhesion_valide_jusqua(text), interne.frais_dus(uuid) from public, anon, authenticated;
grant execute on function public.confirmer_reservation(uuid, text, text, integer, text, text, text),
  public.adhesion_pour_reservation(text),
  interne.adhesion_valide_jusqua(text), interne.frais_dus(uuid) to service_role;

commit;
