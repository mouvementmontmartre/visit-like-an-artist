-- ============================================================
-- ARTDIVE : mise à jour n° 16
-- Expériences créées par les intervenants (visite, atelier, escape game), prix net fixé par l'intervenant.
--
-- Pour une base où maj-15-validations.sql est DÉJÀ installée. À coller en entier
-- dans Supabase > SQL Editor, puis « Run ». Ensuite : relancer
-- supabase/test-droits.sql. Ne modifie aucune donnée existante.
-- ============================================================

begin;

do $$
begin
  if not exists (select 1 from information_schema.columns where table_schema = 'public'
                 and table_name = 'candidatures' and column_name = 'motif_refus') then
    raise exception 'Installer d''abord maj-15-validations.sql.';
  end if;
  if exists (select 1 from information_schema.columns where table_schema = 'public'
             and table_name = 'experiences' and column_name = 'refusee_le' and exists (select 1 from pg_trigger where tgname = 'experiences_alerte')) then
    raise exception 'Cette mise à jour est déjà faite.';
  end if;
end $$;

-- ---- Expériences créées par les intervenants (maj-16, lot du 22/11, E11.6) ----
-- L'intervenant saisit tout lui-même : type (visite, atelier, escape game),
-- titre, description (200 caractères), photo, durée, places, langues, point
-- de rendez-vous et SON prix par personne, réglé à lui sur place. Plus de
-- pré-réservation de 5 € : le prix affiché est le prix net. L'expérience
-- arrive « à valider » ; l'association la valide (en ligne) ou la refuse
-- avec un motif. Refusée, il peut la corriger et la renvoyer.
-- Escape game proposé par un intervenant : jeu animé, daté, réservé aux
-- adhérents comme une visite (prix par personne réglé sur place).
create or replace function interne.experiences_garde() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  restreint boolean := (select auth.uid()) is not null and not interne.est_admin();
  moi uuid;
  libres text[] := array['photo_url', 'description', 'accroche', 'bon_a_savoir',
    'duree_minutes', 'langues', 'point_rdv', 'point_rdv_lat', 'point_rdv_lng',
    'capacite_max', 'participants_min', 'langues_relues', 'nb_etapes', 'maj_le', 'prix_centimes'];
begin
  if not restreint then return new; end if;
  moi := interne.mon_intervenant_id();
  if moi is null then raise exception 'Réservé aux intervenants.'; end if;

  if tg_op = 'INSERT' then
    if new.type not in ('visite_guidee', 'atelier', 'escape_game') then
      raise exception 'Un intervenant peut proposer une visite, un atelier ou un escape game.';
    end if;
    if new.prix_centimes is null or new.prix_centimes < 0 or new.prix_centimes > 100000 then
      raise exception 'Prix par personne manquant.';
    end if;
    if new.capacite_max is null then raise exception 'Nombre de places manquant.'; end if;
    if length(coalesce(new.description->>'fr', '')) > 200 then raise exception 'Description : 200 caractères maximum.'; end if;
    new.intervenant_id := moi;
    select localite_id into new.localite_id from public.intervenants where id = moi;
    new.slug := interne.slugifier(new.titre->>'fr') || '-'
                || substr(replace(gen_random_uuid()::text, '-', ''), 1, 4);
    new.theme := null;
    new.lieu_id := null;
    new.prereservation_centimes := 0;          -- plus de frais de réservation : prix net
    new.prix_libre_min_centimes := null;
    new.option_audioguide_centimes := null;
    new.delai_annulation_heures := 48;
    new.frais_annulation_tardive_centimes := 1000;
    new.delai_frais_heures := 24;
    new.telephone_obligatoire := true;
    new.privatisable := false;
    new.age_minimum := null;
    new.nb_etapes := 0;
    new.langues_relues := '{fr}';
    new.ordre := 0;
    new.actif := true;
    new.publie := false;
    new.a_valider := true;
    new.validee_le := null;
    new.refusee_le := null;
    new.motif_refus := null;
    new.cree_le := now();
    new.maj_le := now();
    return new;
  end if;

  -- Tant que l'expérience n'est pas en ligne : titre et type aussi.
  if not old.publie then libres := libres || array['titre', 'type']; end if;
  -- Refusée : il la corrige puis la renvoie (« à valider » de nouveau).
  if old.refusee_le is not null and not old.publie and new.a_valider and new.refusee_le is null and new.motif_refus is null then
    libres := libres || array['a_valider', 'refusee_le', 'motif_refus'];
  end if;
  if (to_jsonb(new) - libres) is distinct from (to_jsonb(old) - libres) then
    raise exception 'Seule l''association peut modifier la publication, le titre d''une expérience en ligne et les règles d''annulation.';
  end if;
  if new.type not in ('visite_guidee', 'atelier', 'escape_game') then
    raise exception 'Un intervenant peut proposer une visite, un atelier ou un escape game.';
  end if;
  if new.prix_centimes is null or new.prix_centimes < 0 or new.prix_centimes > 100000 then
    raise exception 'Prix par personne manquant.';
  end if;
  if new.description is distinct from old.description and length(coalesce(new.description->>'fr', '')) > 200 then
    raise exception 'Description : 200 caractères maximum.';
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

-- Nouvelle expérience (ou renvoyée après correction) : email à l'association.
create function interne.experiences_alerte() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare v_nom text; v_email text;
begin
  if (select auth.uid()) is null or interne.est_admin() then return null; end if;
  if not new.a_valider or (tg_op = 'UPDATE' and old.a_valider) then return null; end if;
  select i.nom, c.email into v_nom, v_email
    from public.intervenants i left join public.intervenants_contacts c on c.intervenant_id = i.id
   where i.id = new.intervenant_id;
  perform interne.notifier_association('alerte_experience', jsonb_build_object(
    'titre', new.titre, 'type', new.type, 'description', new.description,
    'prix_centimes', new.prix_centimes, 'capacite_max', new.capacite_max, 'duree_minutes', new.duree_minutes,
    'langues', new.langues, 'point_rdv', new.point_rdv, 'intervenant', v_nom, 'repondre_a', v_email,
    'renvoyee', tg_op = 'UPDATE'), 'experiences', new.id);
  return null;
end $$;
create trigger experiences_alerte after insert or update of a_valider on public.experiences
  for each row execute function interne.experiences_alerte();

-- Escape game daté : réservé aux adhérents et réglé sur place, comme une visite.
create or replace function interne.seance_pour_adherents(p_seance public.seances, p_exp public.experiences) returns boolean
language sql immutable set search_path = ''
as $$ select p_exp.type in ('visite_guidee', 'atelier', 'escape_game') or p_seance.reservee_adherents; $$;

revoke all on function interne.experiences_alerte() from public, anon, authenticated;

-- Escape game daté : mêmes règles qu'une visite pour la réservation, les frais et l'adhésion.
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
  v_visite := e.type in ('visite_guidee', 'atelier', 'escape_game');

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

  v_unitaire := case when v_visite then interne.prix_adherent(s, e) else coalesce(s.prix_centimes, e.prix_centimes) end;
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

create or replace function public.retenir_pour_adhesion(
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
  if e.type not in ('visite_guidee', 'atelier', 'escape_game') then raise exception 'ADHESION_INUTILE'; end if;
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

create or replace function public.finaliser_reservation_adherent(
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
  v_frais := e.type in ('visite_guidee', 'atelier', 'escape_game') and e.frais_annulation_tardive_centimes > 0;
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

create or replace function interne.frais_dus(p_reservation uuid) returns integer
language sql stable set search_path = ''
as $$
  select case
    when r.stripe_payment_method is null or e.frais_annulation_tardive_centimes <= 0
         or e.type not in ('visite_guidee', 'atelier', 'escape_game') then 0
    else least(e.frais_annulation_tardive_centimes * r.personnes, r.reste_sur_place_centimes)
  end
  from public.reservations r join public.experiences e on e.id = r.experience_id
  where r.id = p_reservation;
$$;

commit;
