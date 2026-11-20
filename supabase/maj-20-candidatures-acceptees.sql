-- ============================================================
-- ARTDIVE : mise à jour n° 20
-- Ouvrir l'espace d'une candidature acceptée avant le 22/11 (sans fiche ni accès).
--
-- Pour une base où maj-19-annulation-intervenant.sql est DÉJÀ installée. À coller en entier
-- dans Supabase > SQL Editor, puis « Run ». Ensuite : relancer
-- supabase/test-droits.sql. Ne modifie aucune donnée existante.
-- ============================================================

begin;

do $$
begin
  if not exists (select 1 from pg_proc where proname = 'annuler_seance' and pronargs = 3) then
    raise exception 'Installer d''abord maj-19-annulation-intervenant.sql.';
  end if;
end $$;

-- ---- Candidatures acceptées avant le 22/11 (maj-20) ----
-- Dans l'ancienne version, « Acceptée » changeait seulement le statut : aucune fiche,
-- aucun accès. « Ouvrir son espace » (onglet Validations) les traite comme une
-- candidature nouvelle : fiche, profil, contact, email d'accès.
create or replace function public.accepter_candidature(p_id uuid, p_user_id uuid, p_acteur uuid) returns jsonb
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
  -- Candidature acceptée à la main avant le 22/11 (menu de statut) : pas encore de fiche, on ouvre l'espace maintenant.
  if c.statut = 'acceptee' and c.intervenant_id is not null then
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

commit;
