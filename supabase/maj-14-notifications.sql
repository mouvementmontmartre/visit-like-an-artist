-- ============================================================
-- ARTDIVE : mise à jour n° 14
-- Notifications d'information (association et intervenants), « notification non envoyée » dans l'administration.
--
-- Pour une base où maj-13-code-carte.sql est DÉJÀ installée. À coller en entier
-- dans Supabase > SQL Editor, puis « Run ». Ensuite : relancer
-- supabase/test-droits.sql. Ne modifie aucune donnée existante.
-- ============================================================

begin;

do $$
begin
  if not exists (select 1 from information_schema.columns where table_schema = 'public'
                 and table_name = 'codes_carte' and column_name = 'code_hash') then
    raise exception 'Installer d''abord maj-13-code-carte.sql.';
  end if;
  if exists (select 1 from information_schema.columns where table_schema = 'public'
             and table_name = 'envois' and column_name = 'cible_table') then
    raise exception 'Cette mise à jour est déjà faite.';
  end if;
end $$;

-- ---- Notifications d'information (maj-14, lot du 22/11) ----
-- Emails à l'association (nouvelle candidature, expérience à valider,
-- séances publiées) et aux intervenants (accès, validation, refus), mis en
-- file comme les autres. Chaque email garde ce qu'il concerne (cible) :
-- un envoi qui échoue n'empêche jamais l'enregistrement, il est journalisé
-- et affiché « notification non envoyée » dans l'administration, avec un
-- bouton pour réessayer.
alter table public.envois
  add column cible_table text check (cible_table in ('candidatures', 'demandes_groupes', 'experiences', 'intervenants', 'seances')),
  add column cible_id uuid;
create index envois_cible on public.envois (cible_table, cible_id);

-- Met un email d'information en file (sans réservation) et rend son numéro.
create function interne.notifier(p_type text, p_destinataire text, p_langue text, p_donnees jsonb,
                                 p_cible_table text default null, p_cible_id uuid default null) returns bigint
language plpgsql set search_path = ''
as $$
declare v_id bigint;
begin
  if coalesce(p_destinataire, '') !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' then return null; end if;
  insert into public.envois (type, destinataire, langue, donnees, cible_table, cible_id)
  values (p_type, lower(btrim(p_destinataire)), coalesce(p_langue, 'fr'), coalesce(p_donnees, '{}'::jsonb), p_cible_table, p_cible_id)
  returning id into v_id;
  return v_id;
end $$;

-- Même chose pour l'association (le serveur l'envoie à NOTIFY_EMAIL si cette variable existe).
create function interne.notifier_association(p_type text, p_donnees jsonb,
                                             p_cible_table text default null, p_cible_id uuid default null) returns bigint
language sql set search_path = ''
as $$
  select interne.notifier(p_type, interne.email_association(), 'fr',
                          coalesce(p_donnees, '{}'::jsonb) || jsonb_build_object('pour_association', true),
                          p_cible_table, p_cible_id);
$$;

-- Administration : notifications pas encore parties (échec, ou nouvel essai en cours), 30 derniers jours.
create function public.notifications_non_envoyees() returns table (
  id bigint, type text, destinataire text, cree_le timestamptz, statut text, tentatives integer,
  erreur text, cible_table text, cible_id uuid)
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not interne.est_admin() then raise exception 'RESERVE_ADMIN'; end if;
  return query
    select v.id, v.type, v.destinataire, v.cree_le, v.statut, v.tentatives, v.erreur, v.cible_table, v.cible_id
      from public.envois v
     where v.cree_le > now() - interval '30 days'
       and (v.statut = 'echec' or (v.statut in ('a_envoyer', 'en_cours') and v.tentatives > 0))
     order by v.cree_le desc
     limit 100;
end $$;

-- Administration : renvoyer une notification qui a échoué.
create function public.notification_reessayer(p_id bigint) returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if not interne.est_admin() then raise exception 'RESERVE_ADMIN'; end if;
  update public.envois set statut = 'a_envoyer', tentatives = 0, erreur = null, pris_le = null
   where id = p_id and statut in ('echec', 'a_envoyer');
end $$;

-- File des emails : les annonces de séances groupées attendent 2 minutes
-- (une répétition « tous les dimanches » crée plusieurs séances d'un coup).
create or replace function public.envois_a_traiter(p_limite integer default 20) returns setof public.envois
language sql set search_path = ''
as $$
  update public.envois set statut = 'en_cours', tentatives = tentatives + 1, pris_le = now()
   where id in (select id from public.envois
                 where (statut = 'a_envoyer' or (statut = 'en_cours' and pris_le < now() - interval '30 minutes'))
                   and tentatives < 5
                   and not (type = 'alerte_seances_publiees' and cree_le > now() - interval '2 minutes')
                 order by cree_le limit p_limite for update skip locked)
  returning *;
$$;

revoke all on function interne.notifier(text, text, text, jsonb, text, uuid),
  interne.notifier_association(text, jsonb, text, uuid),
  public.notifications_non_envoyees(), public.notification_reessayer(bigint) from public, anon, authenticated;
grant execute on function interne.notifier(text, text, text, jsonb, text, uuid),
  interne.notifier_association(text, jsonb, text, uuid) to service_role;
grant execute on function public.notifications_non_envoyees(), public.notification_reessayer(bigint) to authenticated, service_role;

commit;
