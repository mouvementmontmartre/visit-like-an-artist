-- ============================================================
-- ARTDIVE : mise à jour n° 21
-- Suppression d'une expérience ou d'une séance (admin et intervenant).
--
-- Pour une base où maj-20-candidatures-acceptees.sql est DÉJÀ installée. À coller en entier
-- dans Supabase > SQL Editor, puis « Run ». Ensuite : relancer
-- supabase/test-droits.sql. Ne modifie aucune donnée existante.
-- ============================================================

begin;

do $$
begin
  if not exists (select 1 from pg_proc where proname = 'annuler_seance' and pronargs = 3) then
    raise exception 'Installer d''abord maj-19 et maj-20.';
  end if;
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'seances' and column_name = 'supprimee_le') then
    raise exception 'Cette mise à jour est déjà faite.';
  end if;
end $$;

-- ---- Suppression d'une expérience ou d'une séance (maj-21, décision du 22/11) ----
-- L'admin et l'intervenant (pour les siennes) suppriment une expérience ou
-- une séance. Sans aucune réservation : effacée pour de bon. Avec un
-- historique (réservations passées, annulées ou expirées, paiements,
-- accès) : retirée de l'app et des listes (supprimee_le), gardée en base.
-- Refusée tant qu'une séance à venir a des inscrits : il faut d'abord
-- l'annuler (les inscrits sont alors prévenus par email).
alter table public.experiences add column supprimee_le timestamptz;
alter table public.seances add column supprimee_le timestamptz;

-- Qui peut supprimer : l'admin, ou l'intervenant de l'expérience.
create function interne.peut_supprimer(p_exp public.experiences) returns boolean
language sql stable security definer set search_path = ''
as $$ select interne.est_admin() or (p_exp.intervenant_id is not null and p_exp.intervenant_id = interne.mon_intervenant_id()); $$;

-- Une séance à venir a-t-elle des inscrits confirmés ?
create function interne.seance_avec_inscrits(p_seance public.seances) returns boolean
language sql stable security definer set search_path = ''
as $$ select p_seance.statut <> 'annulee' and p_seance.debut > now()
         and exists (select 1 from public.reservations r where r.seance_id = p_seance.id and r.statut = 'confirmee'); $$;

-- Supprime (ou retire) une séance déjà verrouillée. Rend 'effacee' ou 'retiree'.
create function interne.supprimer_une_seance(s public.seances) returns text
language plpgsql security definer set search_path = ''
as $$
begin
  if not exists (select 1 from public.reservations where seance_id = s.id) then
    delete from public.seances where id = s.id;
    return 'effacee';
  end if;
  perform set_config('artdive.annulation', 'oui', true);   -- la garde des séances laisse passer
  update public.seances set supprimee_le = now(),
         statut = case when statut = 'publiee' and debut > now() then 'annulee' else statut end,
         annulee_le = case when statut = 'publiee' and debut > now() then now() else annulee_le end,
         motif_annulation = case when statut = 'publiee' and debut > now() then 'intervenant_empeche' else motif_annulation end
   where id = s.id;
  -- Places seulement retenues (paiement en cours) : libérées.
  update public.reservations set statut = 'expiree', bloque_jusqua = null
   where seance_id = s.id and statut = 'en_attente';
  perform set_config('artdive.annulation', '', true);
  return 'retiree';
end $$;

create function public.supprimer_seance(p_id uuid) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  s public.seances;
  e public.experiences;
  v_etat text;
begin
  select * into s from public.seances where id = p_id for update;
  if not found or s.supprimee_le is not null then raise exception 'SEANCE_INTROUVABLE'; end if;
  select * into e from public.experiences where id = s.experience_id;
  if not interne.peut_supprimer(e) then raise exception 'RESERVE_INTERVENANT'; end if;
  if interne.seance_avec_inscrits(s) then raise exception 'SEANCE_AVEC_INSCRITS'; end if;
  v_etat := interne.supprimer_une_seance(s);
  insert into public.journal_admin (acteur, action, cible_table, cible_id, details)
  values ((select auth.uid()), 'seance_supprimee', 'seances', s.id, jsonb_build_object('etat', v_etat, 'debut', s.debut));
  return jsonb_build_object('etat', v_etat);
end $$;

create function public.supprimer_experience(p_id uuid) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  e public.experiences;
  s public.seances;
  v_etat text;
begin
  select * into e from public.experiences where id = p_id for update;
  if not found or e.supprimee_le is not null then raise exception 'EXPERIENCE_INTROUVABLE'; end if;
  if not interne.peut_supprimer(e) then raise exception 'RESERVE_INTERVENANT'; end if;
  if exists (select 1 from public.seances x where x.experience_id = e.id and interne.seance_avec_inscrits(x)) then
    raise exception 'SEANCES_AVEC_INSCRITS';
  end if;
  for s in select * from public.seances where experience_id = e.id and supprimee_le is null for update loop
    perform interne.supprimer_une_seance(s);
  end loop;
  if not exists (select 1 from public.seances where experience_id = e.id)
     and not exists (select 1 from public.reservations where experience_id = e.id)
     and not exists (select 1 from public.acces where experience_id = e.id)
     and not exists (select 1 from public.paiements where experience_id = e.id) then
    delete from public.experiences where id = e.id;
    v_etat := 'effacee';
  else
    perform set_config('artdive.suppression', 'oui', true);   -- la garde des expériences laisse passer
    update public.experiences set publie = false, actif = false, a_valider = false, supprimee_le = now() where id = e.id;
    perform set_config('artdive.suppression', '', true);
    v_etat := 'retiree';
  end if;
  insert into public.journal_admin (acteur, action, cible_table, cible_id, details)
  values ((select auth.uid()), 'experience_supprimee', 'experiences', e.id,
          jsonb_build_object('etat', v_etat, 'titre', e.titre->>'fr'));
  return jsonb_build_object('etat', v_etat);
end $$;

revoke all on function interne.peut_supprimer(public.experiences), interne.seance_avec_inscrits(public.seances),
  interne.supprimer_une_seance(public.seances) from public, anon, authenticated;
revoke all on function public.supprimer_seance(uuid), public.supprimer_experience(uuid) from public, anon;
grant execute on function public.supprimer_seance(uuid), public.supprimer_experience(uuid) to authenticated, service_role;

-- Garde des expériences : laisse passer le retrait fait par supprimer_experience.
create or replace function interne.experiences_garde() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  -- supprimer_experience (admin ou intervenant de l'expérience) passe par sa propre vérification
  restreint boolean := (select auth.uid()) is not null and not interne.est_admin()
                       and coalesce(current_setting('artdive.suppression', true), '') <> 'oui';
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

-- Le visiteur ne voit plus une séance supprimée.
create or replace view public.seances_publiques with (security_barrier = true) as
select s.id, s.experience_id, s.debut, s.fin, s.langue,
       s.capacite_max, s.participants_min, s.point_rdv, s.statut,
       coalesce(r.inscrits, 0)::integer                             as inscrits,
       greatest(s.capacite_max - coalesce(r.prises, 0), 0)::integer as places_restantes,
       coalesce(r.inscrits, 0) >= s.participants_min                as confirmee,
       s.prix_adherent_centimes,
       s.reservee_adherents or e.type in ('visite_guidee', 'atelier', 'escape_game') as reservee_adherents,
       case when e.type in ('visite_guidee', 'atelier', 'escape_game') then interne.prix_adherent(s, e)
            else coalesce(s.prix_centimes, e.prix_centimes) end   as prix_centimes
from public.seances s
join public.experiences e on e.id = s.experience_id and e.publie and e.actif
left join lateral (
  select sum(personnes) filter (where statut = 'confirmee') as inscrits,
         sum(personnes) filter (where statut = 'confirmee'
              or (statut = 'en_attente' and bloque_jusqua > now())) as prises
  from public.reservations where seance_id = s.id
) r on true
where s.statut in ('publiee', 'annulee') and s.supprimee_le is null
  and s.debut > now() - interval '1 day';

commit;
