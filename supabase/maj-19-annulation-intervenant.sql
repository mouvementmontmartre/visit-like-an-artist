-- ============================================================
-- ARTDIVE : mise à jour n° 19
-- Annulation d'une séance par son intervenant (inscrits et association prévenus par email).
--
-- Pour une base où maj-18-connexion-unique.sql est DÉJÀ installée. À coller en entier
-- dans Supabase > SQL Editor, puis « Run ». Ensuite : relancer
-- supabase/test-droits.sql. Ne modifie aucune donnée existante.
-- ============================================================

begin;

do $$
begin
  if not exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'connexions_liens') then
    raise exception 'Installer d''abord maj-18-connexion-unique.sql.';
  end if;
  if exists (select 1 from pg_proc where proname = 'annuler_seance' and pronargs = 3) then
    raise exception 'Cette mise à jour est déjà faite.';
  end if;
end $$;

-- ---- Annulation d'une séance par son intervenant (maj-19, décision du 22/11) ----
-- L'intervenant annule lui-même sa séance, sans l'accord de l'association,
-- avec un mot facultatif pour les inscrits. Chaque inscrit reçoit un email
-- (remboursé s'il a payé en ligne) ; l'association est toujours prévenue,
-- même sans inscrit. L'admin garde ses motifs (organisation, intervenant
-- empêché) ; le serveur, le minimum non atteint.
drop function public.annuler_seance(uuid, text);
create function public.annuler_seance(p_seance_id uuid, p_motif text default 'annulation_organisation',
                                      p_message text default null) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  s public.seances;
  e public.experiences;
  r record;
  n integer := 0;
  v_intervenant boolean := false;
  v_message text := nullif(left(btrim(coalesce(p_message, '')), 1000), '');
  v_nom text;
  v_email text;
begin
  select * into s from public.seances where id = p_seance_id for update;
  if not found then raise exception 'SEANCE_INTROUVABLE'; end if;
  select * into e from public.experiences where id = s.experience_id;
  if (select auth.uid()) is not null and not interne.est_admin() then
    -- Intervenant : seulement sa propre séance, pas encore commencée, motif « intervenant empêché ».
    if e.intervenant_id is null or e.intervenant_id is distinct from interne.mon_intervenant_id() then
      raise exception 'RESERVE_INTERVENANT';
    end if;
    if s.debut <= now() then raise exception 'SEANCE_COMMENCEE'; end if;
    v_intervenant := true;
    p_motif := 'intervenant_empeche';
  end if;
  if p_motif not in ('minimum_non_atteint', 'annulation_organisation', 'intervenant_empeche') then
    raise exception 'MOTIF_INVALIDE';
  end if;
  if s.statut = 'annulee' then return jsonb_build_object('deja_annulee', true, 'inscrits', 0); end if;

  perform set_config('artdive.annulation', 'oui', true);   -- la garde des séances laisse passer cette annulation
  update public.seances set statut = 'annulee', annulee_le = now(), motif_annulation = p_motif where id = s.id;
  perform set_config('artdive.annulation', '', true);
  for r in select * from public.reservations where seance_id = s.id and statut in ('confirmee', 'en_attente') for update loop
    update public.reservations set statut = 'annulee', annulee_le = now(), bloque_jusqua = null,
           annulee_par = case when p_motif = 'minimum_non_atteint' then 'minimum' else 'organisation' end,
           motif_annulation = p_motif
     where id = r.id;
    if r.statut = 'confirmee' then
      perform interne.rembourser(r.id, p_motif);
      perform interne.envoyer('seance_annulee', r.email, r.langue, r.id,
        jsonb_build_object('motif', p_motif) || case when v_message is null then '{}'::jsonb else jsonb_build_object('message_intervenant', v_message) end);
      n := n + 1;
    end if;
  end loop;

  if v_intervenant then
    -- Toujours une alerte à l'association (même sans inscrit), « Répondre » écrit à l'intervenant.
    select i.nom, c.email into v_nom, v_email
      from public.intervenants i left join public.intervenants_contacts c on c.intervenant_id = i.id
     where i.id = e.intervenant_id;
    perform interne.notifier_association('alerte_annulation_intervenant', jsonb_build_object(
      'titre', e.titre, 'debut', s.debut, 'point_rdv', s.point_rdv, 'intervenant', v_nom, 'repondre_a', v_email,
      'inscrits_rembourses', n, 'message', v_message), 'seances', s.id);
  elsif n > 0 then
    -- Une seule alerte pour la séance (association et intervenant).
    perform interne.alerter('alerte_seance_annulee',
      (select id from public.reservations where seance_id = s.id and annulee_par is not null limit 1),
      jsonb_build_object('motif', p_motif, 'inscrits_rembourses', n));
  end if;
  insert into public.journal_admin (acteur, action, cible_table, cible_id, details)
  values ((select auth.uid()), 'seance_annulee', 'seances', s.id,
          jsonb_build_object('motif', p_motif, 'inscrits', n, 'par_intervenant', v_intervenant));
  return jsonb_build_object('deja_annulee', false, 'inscrits', n);
end $$;
revoke all on function public.annuler_seance(uuid, text, text) from public, anon;
grant execute on function public.annuler_seance(uuid, text, text) to authenticated, service_role;

-- Garde des séances : laisse passer l'annulation faite par annuler_seance.
create or replace function interne.seances_garde() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  e public.experiences;
  -- annuler_seance (intervenant de la séance) passe par sa propre vérification
  restreint boolean := (select auth.uid()) is not null and not interne.est_admin()
                       and coalesce(current_setting('artdive.annulation', true), '') <> 'oui';
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
      raise exception 'Pour annuler une séance, utilisez le bouton « Annuler la séance ».';
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

commit;
