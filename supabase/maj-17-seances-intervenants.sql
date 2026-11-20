-- ============================================================
-- ARTDIVE : mise à jour n° 17
-- Séances publiées directement par l'intervenant (prix, durée), inscrits prévenus d'un changement et annulation sans frais.
--
-- Pour une base où maj-16-experiences-intervenants.sql est DÉJÀ installée. À coller en entier
-- dans Supabase > SQL Editor, puis « Run ». Ensuite : relancer
-- supabase/test-droits.sql. Ne modifie aucune donnée existante.
-- ============================================================

begin;

do $$
begin
  if not exists (select 1 from information_schema.columns where table_schema = 'public'
                 and table_name = 'experiences' and column_name = 'refusee_le') then
    raise exception 'Installer d''abord maj-16-experiences-intervenants.sql.';
  end if;
  if exists (select 1 from information_schema.columns where table_schema = 'public'
             and table_name = 'seances' and column_name = 'modifiee_le') then
    raise exception 'Cette mise à jour est déjà faite.';
  end if;
end $$;

-- ---- Séances programmées par les intervenants (maj-17, lot du 22/11, E11.2) ----
-- Sur une expérience validée, l'intervenant publie ses séances lui-même
-- (aucune validation) : date, heure, lieu, langue, places, minimum pour
-- partir, durée et prix par personne (réglé à lui sur place). L'association
-- reçoit un email d'information (groupé quand plusieurs séances sont créées
-- d'un coup). Séance modifiée alors qu'il y a des inscrits (date, heure,
-- durée, lieu, langue) : chaque inscrit reçoit un email et peut annuler
-- sans frais, même à moins de 24 h.
alter table public.seances
  add column prix_centimes integer check (prix_centimes >= 0 and prix_centimes <= 100000),
      -- prix par personne réglé sur place, fixé par l'intervenant ; vide = celui de l'expérience
  add column modifiee_le timestamptz;   -- dernier changement notifié aux inscrits

-- Prix par personne réglé sur place par un adhérent : prix de la séance,
-- sinon celui de l'expérience (moins une éventuelle pré-réservation), ou
-- l'ancien tarif adhérent s'il est plus bas.
create or replace function interne.prix_adherent(p_seance public.seances, p_exp public.experiences) returns integer
language sql immutable set search_path = ''
as $$
  select least(coalesce(p_seance.prix_adherent_centimes,
                        coalesce(p_seance.prix_centimes, p_exp.prix_centimes - coalesce(p_exp.prereservation_centimes, 0))),
               coalesce(p_seance.prix_centimes, p_exp.prix_centimes - coalesce(p_exp.prereservation_centimes, 0)));
$$;

-- Une séance a-t-elle déjà eu une réservation (même expirée) ? (règle de suppression)
create function interne.seance_a_des_reservations(p_seance_id uuid) returns boolean
language sql stable security definer set search_path = ''
as $$ select exists (select 1 from public.reservations where seance_id = p_seance_id); $$;

create or replace function interne.seances_garde() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  e public.experiences;
  restreint boolean := (select auth.uid()) is not null and not interne.est_admin();
  v_prises integer;
begin
  select * into e from public.experiences where id = new.experience_id;
  if e.type not in ('visite_guidee', 'atelier', 'soiree', 'escape_game') then
    raise exception 'Ce type d''expérience n''a pas de séances datées.';
  end if;

  if new.capacite_max is null then new.capacite_max := e.capacite_max; end if;
  if new.participants_min is null then new.participants_min := e.participants_min; end if;
  if new.prix_adherent_centimes is not null and e.prix_centimes is not null
     and new.prix_adherent_centimes > e.prix_centimes then
    raise exception 'Tarif adhérent : il ne peut pas dépasser le prix normal (%).', e.prix_centimes;
  end if;

  if tg_op = 'UPDATE' and new.statut is distinct from old.statut and old.statut = 'publiee'
     and new.statut in ('brouillon', 'en_attente')
     and exists (select 1 from public.reservations where seance_id = old.id and statut = 'confirmee') then
    raise exception 'Cette séance a des inscrits : elle reste en ligne (l''annuler si besoin).';
  end if;
  if tg_op = 'UPDATE' and old.statut = 'publiee' and new.statut = 'publiee' then
    v_prises := interne.places_prises(old.id);
    if new.capacite_max < v_prises then
      raise exception 'Nombre de places : % personnes sont déjà inscrites.', v_prises;
    end if;
  end if;

  if restreint then
    if new.capacite_max > e.capacite_max then
      raise exception 'Nombre de places : % maximum pour cette expérience.', e.capacite_max;
    end if;
    if new.statut not in ('brouillon', 'en_attente', 'publiee') then
      raise exception 'Pour annuler une séance, écrivez à l''association.';
    end if;
    if new.statut = 'publiee' and (tg_op = 'INSERT' or old.statut <> 'publiee')
       and not (e.publie and e.actif and not e.a_valider) then
      raise exception 'Votre expérience doit d''abord être validée par l''association.';
    end if;
    new.annulee_le := null;
    new.motif_annulation := null;
    new.prix_adherent_centimes := case when tg_op = 'UPDATE' then old.prix_adherent_centimes end;
    new.reservee_adherents := case when tg_op = 'UPDATE' then old.reservee_adherents else false end;
    if tg_op = 'UPDATE' then
      if new.experience_id <> old.experience_id then
        raise exception 'Une séance ne peut pas changer d''expérience.';
      end if;
      new.cree_par := old.cree_par;
      new.cree_le := old.cree_le;
      new.minimum_verifie_le := old.minimum_verifie_le;
    else
      new.cree_par := (select auth.uid());
      new.minimum_verifie_le := null;
    end if;
  end if;

  -- Changement visible par les inscrits : noté, puis notifié par le déclencheur suivant.
  if tg_op = 'UPDATE' and old.statut = 'publiee' and new.statut = 'publiee'
     and (new.debut, new.fin, new.point_rdv, new.point_rdv_precis, new.langue)
         is distinct from (old.debut, old.fin, old.point_rdv, old.point_rdv_precis, old.langue) then
    new.modifiee_le := now();
  end if;
  new.maj_le := now();
  return new;
end $$;

-- Après l'enregistrement : inscrits prévenus d'un changement ; association
-- informée des séances publiées par un intervenant (un email groupé).
create function interne.seances_apres() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  e public.experiences;
  r record;
  v_nom text;
  v_email text;
  v_envoi bigint;
  v_ligne jsonb;
begin
  select * into e from public.experiences where id = new.experience_id;

  if tg_op = 'UPDATE' and new.modifiee_le is distinct from old.modifiee_le and new.statut = 'publiee' then
    for r in select id, email, langue from public.reservations where seance_id = new.id and statut = 'confirmee' loop
      perform interne.envoyer('seance_modifiee', r.email, r.langue, r.id, jsonb_build_object(
        'jeton', interne.lien_reservation(r.id),
        'ancien_debut', old.debut, 'ancien_point_rdv', coalesce(old.point_rdv_precis, old.point_rdv),
        'ancienne_langue', old.langue,
        'date_changee', new.debut is distinct from old.debut or new.fin is distinct from old.fin,
        'lieu_change', (new.point_rdv, new.point_rdv_precis) is distinct from (old.point_rdv, old.point_rdv_precis),
        'langue_changee', new.langue is distinct from old.langue));
    end loop;
  end if;

  if new.statut = 'publiee' and (tg_op = 'INSERT' or old.statut <> 'publiee')
     and (select auth.uid()) is not null and not interne.est_admin() then
    select i.nom, c.email into v_nom, v_email
      from public.intervenants i left join public.intervenants_contacts c on c.intervenant_id = i.id
     where i.id = e.intervenant_id;
    v_ligne := jsonb_build_object('id', new.id, 'titre', e.titre, 'debut', new.debut, 'fin', new.fin,
      'langue', new.langue, 'point_rdv', new.point_rdv, 'capacite_max', new.capacite_max,
      'participants_min', new.participants_min, 'prix_centimes', interne.prix_adherent(new, e));
    select id into v_envoi from public.envois
     where type = 'alerte_seances_publiees' and statut = 'a_envoyer' and cible_table = 'intervenants'
       and cible_id = e.intervenant_id and cree_le > now() - interval '10 minutes'
     order by cree_le desc limit 1 for update skip locked;
    if found then
      update public.envois set donnees = jsonb_set(donnees, '{seances}', coalesce(donnees->'seances', '[]'::jsonb) || jsonb_build_array(v_ligne))
       where id = v_envoi;
    else
      perform interne.notifier_association('alerte_seances_publiees', jsonb_build_object(
        'intervenant', v_nom, 'repondre_a', v_email, 'seances', jsonb_build_array(v_ligne)), 'intervenants', e.intervenant_id);
    end if;
  end if;
  return null;
end $$;
create trigger seances_apres after insert or update on public.seances
  for each row execute function interne.seances_apres();

-- Règles d'accès des séances : l'intervenant crée, publie (expérience validée),
-- modifie ses séances non annulées ; il supprime une séance sans aucune réservation.
drop policy "ajout de ses seances" on public.seances;
drop policy "modification de ses brouillons" on public.seances;
drop policy "suppression de ses brouillons" on public.seances;
create policy "ajout de ses seances" on public.seances for insert to authenticated
  with check ((select interne.est_admin())
         or (statut in ('brouillon', 'en_attente', 'publiee')
             and exists (select 1 from public.experiences e
                         where e.id = seances.experience_id
                           and e.intervenant_id = (select interne.mon_intervenant_id()))));
create policy "modification de ses seances" on public.seances for update to authenticated
  using ((select interne.est_admin())
         or (statut in ('brouillon', 'en_attente', 'publiee')
             and exists (select 1 from public.experiences e
                         where e.id = seances.experience_id
                           and e.intervenant_id = (select interne.mon_intervenant_id()))))
  with check ((select interne.est_admin())
         or (statut in ('brouillon', 'en_attente', 'publiee')
             and exists (select 1 from public.experiences e
                         where e.id = seances.experience_id
                           and e.intervenant_id = (select interne.mon_intervenant_id()))));
create policy "suppression de ses seances sans reservation" on public.seances for delete to authenticated
  using ((select interne.est_admin())
         or (statut in ('brouillon', 'en_attente', 'publiee')
             and not interne.seance_a_des_reservations(id)
             and exists (select 1 from public.experiences e
                         where e.id = seances.experience_id
                           and e.intervenant_id = (select interne.mon_intervenant_id()))));

-- Ce que le visiteur voit : le prix net par personne de la séance (à la fin, pour garder l'ordre des colonnes).
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
where s.statut in ('publiee', 'annulee')
  and s.debut > now() - interval '1 day';
grant select on public.seances_publiques to anon, authenticated;
grant execute on function interne.prix_adherent(public.seances, public.experiences) to anon, authenticated;

revoke all on function interne.seances_apres(), interne.seance_a_des_reservations(uuid) from public, anon, authenticated;
grant execute on function interne.seance_a_des_reservations(uuid) to authenticated;

-- Séance modifiée après la réservation : annulation sans frais, même à moins de 24 h.
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
  if now() > s.debut - make_interval(hours => e.delai_frais_heures)
     and not (s.modifiee_le is not null and s.modifiee_le > coalesce(r.confirmee_le, r.cree_le)) then
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
  v_tardif := now() > s.debut - make_interval(hours => e.delai_frais_heures)
              and not (s.modifiee_le is not null and s.modifiee_le > coalesce(r.confirmee_le, r.cree_le));
  return interne.donnees_reservation(r.id) - 'email' - 'telephone' || jsonb_build_object(
    'statut', r.statut, 'seance_statut', s.statut,
    'seance_modifiee', s.modifiee_le is not null and s.modifiee_le > coalesce(r.confirmee_le, r.cree_le),
    'peut_annuler', r.statut = 'confirmee' and s.statut = 'publiee' and s.debut > now(),
    'annulation_tardive', v_tardif,
    'frais_si_annulation_centimes', case when v_tardif then interne.frais_dus(r.id) else 0 end,
    'frais_statut', r.frais_statut, 'adherent', r.adherent,
    'absent', r.absent_le is not null,
    'absence_contestee', r.absence_contestee_le is not null,
    'absence_contestable', r.absent_le is not null and r.frais_statut = 'a_prelever'
                           and r.frais_prevu_le > now() and r.absence_contestee_le is null);
end $$;

commit;
