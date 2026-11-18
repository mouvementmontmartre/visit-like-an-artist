-- ============================================================
-- ARTDIVE : mise à jour n° 1 (guides autonomes)
--
-- Pour une base où schema.sql est DÉJÀ installé. À coller en entier
-- dans Supabase > SQL Editor, puis « Run ». Tout passe ou rien ne passe.
-- (Une base neuve n'en a pas besoin : schema.sql contient déjà tout.)
--
-- Ce qui change :
--  - l'intervenant modifie lui-même ses visites : image, textes, durée,
--    langues, point de départ, nombre de places minimum et maximum ;
--  - il choisit le minimum de ses séances ;
--  - il peut proposer une nouvelle visite, que l'association valide
--    (prix et publication restent réservés à l'association) ;
--  - chaque changement fait par un intervenant est noté au journal.
-- Ensuite : relancer supabase/test-droits.sql.
-- ============================================================

begin;

do $$
begin
  if to_regclass('public.experiences') is null then
    raise exception 'Installer d''abord schema.sql.';
  end if;
  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'experiences'
               and column_name = 'a_valider') then
    raise exception 'Cette mise à jour est déjà faite.';
  end if;
end $$;

alter table public.experiences
  add column a_valider boolean not null default false;
alter table public.experiences
  add constraint experiences_min_max check (capacite_max is null or participants_min <= capacite_max);

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

-- L'intervenant propose et modifie ses visites (les champs permis sont
-- filtrés par interne.experiences_garde) et retire une proposition non publiée.
create policy "intervenant propose" on public.experiences for insert to authenticated
  with check (intervenant_id = (select interne.mon_intervenant_id()) and not publie);
create policy "intervenant modifie les siennes" on public.experiences for update to authenticated
  using (intervenant_id = (select interne.mon_intervenant_id()))
  with check (intervenant_id = (select interne.mon_intervenant_id()));
create policy "intervenant retire sa proposition" on public.experiences for delete to authenticated
  using (intervenant_id = (select interne.mon_intervenant_id()) and not publie and a_valider);

-- Fonctions techniques : jamais appelables depuis le navigateur.
revoke all on function interne.slugifier(text), interne.experiences_garde(),
  interne.experiences_journal() from public, anon, authenticated;
grant execute on function interne.slugifier(text), interne.experiences_garde(),
  interne.experiences_journal() to service_role;

commit;

select 'mise à jour n° 1 faite' as resultat;
