-- ============================================================
-- ARTDIVE : mise à jour n° 15
-- Validation des candidatures et des expériences (motif de refus), fiche publiée par l'intervenant, suppression d'un intervenant.
--
-- Pour une base où maj-14-notifications.sql est DÉJÀ installée. À coller en entier
-- dans Supabase > SQL Editor, puis « Run ». Ensuite : relancer
-- supabase/test-droits.sql. Ne modifie aucune donnée existante.
-- ============================================================

begin;

do $$
begin
  if not exists (select 1 from information_schema.columns where table_schema = 'public'
                 and table_name = 'envois' and column_name = 'cible_table') then
    raise exception 'Installer d''abord maj-14-notifications.sql.';
  end if;
  if exists (select 1 from information_schema.columns where table_schema = 'public'
             and table_name = 'candidatures' and column_name = 'motif_refus') then
    raise exception 'Cette mise à jour est déjà faite.';
  end if;
end $$;

-- ---- Validations par l'association (maj-15, lot du 22/11) ----
-- Trois statuts distincts : la candidature (nouvelle, acceptee, refusee),
-- l'expérience (a_valider, puis validee_le ou refusee_le) et la séance
-- (publiée directement, sans validation). L'association valide la
-- candidature puis chaque expérience, avec un motif en cas de refus ; un
-- email part à chaque décision. Les décisions passent par la fonction
-- Netlify « validations » (qui vérifie que l'appel vient de l'admin).
alter table public.candidatures
  add column motif_refus    text check (length(motif_refus) <= 1000),
  add column traitee_le     timestamptz,
  add column traitee_par    uuid,
  add column intervenant_id uuid references public.intervenants(id) on delete set null;

alter table public.experiences
  add column validee_le  timestamptz,
  add column refusee_le  timestamptz,
  add column motif_refus text check (length(motif_refus) <= 1000);

-- Candidature acceptée : fiche d'intervenant (non publiée), contact, profil
-- relié au compte de connexion créé par le serveur, email d'accès.
create function public.accepter_candidature(p_id uuid, p_user_id uuid, p_acteur uuid) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  c public.candidatures;
  p public.profils;
  v_int uuid;
  v_envoi bigint;
begin
  select * into c from public.candidatures where id = p_id for update;
  if not found then raise exception 'CANDIDATURE_INTROUVABLE'; end if;
  if c.statut = 'acceptee' then
    return jsonb_build_object('deja', true, 'intervenant_id', c.intervenant_id, 'email', c.email);
  end if;
  select * into p from public.profils where user_id = p_user_id;
  if found and p.role = 'admin' then raise exception 'COMPTE_ADMIN'; end if;

  if found then
    v_int := p.intervenant_id;            -- déjà intervenant : on garde sa fiche
  else
    insert into public.intervenants (localite_id, slug, type, nom, publie)
    values (coalesce((select id from public.localites where id = 'montmartre'), (select id from public.localites order by id limit 1)),
            interne.slugifier(c.nom) || '-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 4),
            c.type, btrim(c.nom), false)
    returning id into v_int;
    insert into public.profils (user_id, role, intervenant_id) values (p_user_id, 'intervenant', v_int);
  end if;
  insert into public.intervenants_contacts (intervenant_id, email, telephone)
  values (v_int, lower(btrim(c.email)), c.telephone)
  on conflict (intervenant_id) do update set email = excluded.email,
    telephone = coalesce(public.intervenants_contacts.telephone, excluded.telephone), maj_le = now();

  update public.candidatures set statut = 'acceptee', traitee_le = now(), traitee_par = p_acteur,
         motif_refus = null, intervenant_id = v_int
   where id = c.id;
  insert into public.journal_admin (acteur, action, cible_table, cible_id, details)
  values (p_acteur, 'candidature_acceptee', 'candidatures', c.id, jsonb_build_object('intervenant_id', v_int));
  v_envoi := interne.notifier('acces_intervenant', c.email, 'fr',
               jsonb_build_object('nom', c.nom, 'connexion', true, 'vers', 'espace'), 'candidatures', c.id);
  return jsonb_build_object('deja', false, 'intervenant_id', v_int, 'email', c.email, 'envoi_id', v_envoi);
end $$;

create function public.refuser_candidature(p_id uuid, p_motif text, p_acteur uuid) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare c public.candidatures; v_envoi bigint;
begin
  update public.candidatures set statut = 'refusee', motif_refus = nullif(btrim(coalesce(p_motif, '')), ''),
         traitee_le = now(), traitee_par = p_acteur
   where id = p_id and statut = 'nouvelle'
  returning * into c;
  if not found then raise exception 'CANDIDATURE_INDISPONIBLE'; end if;
  insert into public.journal_admin (acteur, action, cible_table, cible_id, details)
  values (p_acteur, 'candidature_refusee', 'candidatures', c.id, jsonb_build_object('motif', c.motif_refus));
  v_envoi := interne.notifier('candidature_refusee', c.email, 'fr',
               jsonb_build_object('nom', c.nom, 'motif', c.motif_refus), 'candidatures', c.id);
  return jsonb_build_object('statut', 'refusee', 'email', c.email, 'envoi_id', v_envoi);
end $$;

-- Expérience validée : en ligne tout de suite, fiche de l'intervenant publiée,
-- email « Créez votre première séance » (E9.7) avec un lien de connexion directe.
create function public.valider_experience(p_id uuid, p_acteur uuid) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  e public.experiences;
  v_email text;
  v_nom text;
  v_envoi bigint;
begin
  select * into e from public.experiences where id = p_id for update;
  if not found or not e.a_valider then raise exception 'EXPERIENCE_INDISPONIBLE'; end if;
  if e.intervenant_id is null then raise exception 'SANS_INTERVENANT'; end if;
  if e.prix_centimes is null or e.capacite_max is null then raise exception 'PRIX_OU_PLACES_MANQUANTS'; end if;
  update public.experiences set publie = true, actif = true, a_valider = false, validee_le = now(),
         refusee_le = null, motif_refus = null,
         prereservation_centimes = coalesce(prereservation_centimes, 0)
   where id = e.id;
  update public.intervenants set publie = true where id = e.intervenant_id and not publie;
  select c.email, i.nom into v_email, v_nom
    from public.intervenants i left join public.intervenants_contacts c on c.intervenant_id = i.id
   where i.id = e.intervenant_id;
  insert into public.journal_admin (acteur, action, cible_table, cible_id, details)
  values (p_acteur, 'experience_validee', 'experiences', e.id, '{}'::jsonb);
  v_envoi := interne.notifier('experience_validee', v_email, 'fr',
               jsonb_build_object('nom', v_nom, 'titre', e.titre, 'connexion', true, 'vers', 'seance'), 'experiences', e.id);
  return jsonb_build_object('statut', 'validee', 'email', v_email, 'envoi_id', v_envoi);
end $$;

create function public.refuser_experience(p_id uuid, p_motif text, p_acteur uuid) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  e public.experiences;
  v_email text;
  v_nom text;
  v_envoi bigint;
begin
  update public.experiences set a_valider = false, refusee_le = now(),
         motif_refus = nullif(btrim(coalesce(p_motif, '')), '')
   where id = p_id and a_valider
  returning * into e;
  if not found then raise exception 'EXPERIENCE_INDISPONIBLE'; end if;
  select c.email, i.nom into v_email, v_nom
    from public.intervenants i left join public.intervenants_contacts c on c.intervenant_id = i.id
   where i.id = e.intervenant_id;
  insert into public.journal_admin (acteur, action, cible_table, cible_id, details)
  values (p_acteur, 'experience_refusee', 'experiences', e.id, jsonb_build_object('motif', e.motif_refus));
  v_envoi := interne.notifier('experience_refusee', v_email, 'fr',
               jsonb_build_object('nom', v_nom, 'titre', e.titre, 'motif', e.motif_refus, 'connexion', true, 'vers', 'espace'),
               'experiences', e.id);
  return jsonb_build_object('statut', 'refusee', 'email', v_email, 'envoi_id', v_envoi);
end $$;

-- ---- « Ma fiche » publiée directement par l'intervenant (décision du 22/11) ----
-- Il modifie lui-même nom, métier, présentation, photo, vidéo, langues et
-- Instagram. Le reste (type, adresse, publication, lieu, sous-titres) reste
-- à l'association. Chaque changement est journalisé.
create function interne.intervenants_garde() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  libres text[] := array['nom', 'role', 'bio', 'photo_url', 'video_url', 'instagram', 'langues', 'liens',
                         'langues_relues', 'maj_le'];
begin
  if (select auth.uid()) is null or interne.est_admin() then return new; end if;
  if new.id is distinct from interne.mon_intervenant_id() then raise exception 'Réservé à votre propre fiche.'; end if;
  if (to_jsonb(new) - libres) is distinct from (to_jsonb(old) - libres) then
    raise exception 'Seule l''association peut modifier le type, l''adresse, la publication et le lieu d''une fiche.';
  end if;
  if length(btrim(coalesce(new.nom, ''))) = 0 then raise exception 'Nom manquant.'; end if;
  if new.video_url is distinct from old.video_url then new.sous_titres_url := null; end if;
  if new.role is distinct from old.role or new.bio is distinct from old.bio then new.langues_relues := array['fr']; end if;
  insert into public.journal_admin (acteur, action, cible_table, cible_id, details)
  values ((select auth.uid()), 'fiche_modifiee', 'intervenants', new.id,
          (select coalesce(jsonb_object_agg(k, to_jsonb(new)->k), '{}'::jsonb)
             from jsonb_object_keys(to_jsonb(new)) k
            where k not in ('maj_le', 'langues_relues') and to_jsonb(new)->k is distinct from to_jsonb(old)->k));
  return new;
end $$;
create trigger intervenants_garde before update on public.intervenants
  for each row execute function interne.intervenants_garde();

create policy "intervenant modifie sa fiche" on public.intervenants for update to authenticated
  using (id = (select interne.mon_intervenant_id()))
  with check (id = (select interne.mon_intervenant_id()));

-- ---- Suppression d'un intervenant par l'association ----
-- Refusée tant qu'une séance à venir a des inscrits (l'annuler d'abord).
-- Ses expériences sont retirées de l'app (gardées pour l'historique des
-- réservations), ses séances à venir sans inscrit annulées ou supprimées,
-- son accès fermé. Rend les comptes de connexion à supprimer (serveur).
create function public.supprimer_intervenant(p_id uuid, p_acteur uuid) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  i public.intervenants;
  v_comptes uuid[];
  v_inscrits integer;
  v_exps integer;
begin
  select * into i from public.intervenants where id = p_id for update;
  if not found then raise exception 'INTERVENANT_INTROUVABLE'; end if;
  select count(distinct s.id) into v_inscrits
    from public.seances s
    join public.experiences e on e.id = s.experience_id
    join public.reservations r on r.seance_id = s.id and r.statut = 'confirmee'
   where e.intervenant_id = p_id and s.statut = 'publiee' and s.debut > now();
  if v_inscrits > 0 then raise exception 'SEANCES_AVEC_INSCRITS' using detail = v_inscrits::text; end if;

  -- Séances à venir : supprimées si personne n'a jamais réservé, sinon annulées.
  delete from public.seances s using public.experiences e
   where e.id = s.experience_id and e.intervenant_id = p_id and s.debut > now()
     and not exists (select 1 from public.reservations r where r.seance_id = s.id);
  update public.seances s set statut = 'annulee', annulee_le = now(), motif_annulation = 'intervenant_empeche'
    from public.experiences e
   where e.id = s.experience_id and e.intervenant_id = p_id and s.debut > now() and s.statut <> 'annulee';
  update public.experiences set publie = false, a_valider = false where intervenant_id = p_id;
  get diagnostics v_exps = row_count;

  select coalesce(array_agg(user_id), '{}') into v_comptes from public.profils where intervenant_id = p_id and role = 'intervenant';
  delete from public.profils where intervenant_id = p_id and role = 'intervenant';
  update public.profils set intervenant_id = null where intervenant_id = p_id and role = 'admin';
  delete from public.intervenants where id = p_id;
  insert into public.journal_admin (acteur, action, cible_table, cible_id, details)
  values (p_acteur, 'intervenant_supprime', 'intervenants', p_id,
          jsonb_build_object('nom', i.nom, 'experiences_retirees', v_exps));
  return jsonb_build_object('comptes', to_jsonb(v_comptes), 'experiences_retirees', v_exps, 'nom', i.nom);
end $$;

revoke all on function public.accepter_candidature(uuid, uuid, uuid), public.refuser_candidature(uuid, text, uuid),
  public.valider_experience(uuid, uuid), public.refuser_experience(uuid, text, uuid),
  public.supprimer_intervenant(uuid, uuid) from public, anon, authenticated;
grant execute on function public.accepter_candidature(uuid, uuid, uuid), public.refuser_candidature(uuid, text, uuid),
  public.valider_experience(uuid, uuid), public.refuser_experience(uuid, text, uuid),
  public.supprimer_intervenant(uuid, uuid) to service_role;
revoke all on function interne.intervenants_garde() from public, anon, authenticated;

commit;
