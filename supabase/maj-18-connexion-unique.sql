-- ============================================================
-- ARTDIVE : mise à jour n° 18
-- Connexion unique par code (adhérents, intervenants, association), lien de connexion des emails, Mon compte.
--
-- Pour une base où maj-17-seances-intervenants.sql est DÉJÀ installée. À coller en entier
-- dans Supabase > SQL Editor, puis « Run ». Ensuite : relancer
-- supabase/test-droits.sql. Ne modifie aucune donnée existante.
-- ============================================================

begin;

do $$
begin
  if not exists (select 1 from information_schema.columns where table_schema = 'public'
                 and table_name = 'seances' and column_name = 'modifiee_le') then
    raise exception 'Installer d''abord maj-17-seances-intervenants.sql.';
  end if;
  if exists (select 1 from information_schema.columns where table_schema = 'public'
             and table_name = 'connexions_liens' and column_name = 'jeton_hash') then
    raise exception 'Cette mise à jour est déjà faite.';
  end if;
end $$;

-- ---- Connexion unique et « Mon compte » (maj-18, lot du 22/11, E15.2, E15.3) ----
-- Un seul code à 6 chiffres par email pour tout le monde : l'adhérent
-- retrouve sa carte et ses réservations, l'intervenant et l'association
-- ouvrent leur espace (le serveur crée alors la session de connexion).
-- Les emails aux intervenants (accès, expérience validée) contiennent un
-- lien de connexion directe, valable 7 jours et une seule fois.

-- Compte de connexion (intervenant ou association) d'une adresse : serveur seulement.
create function public.compte_par_email(p_email text) returns jsonb
language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object('user_id', u.id, 'role', p.role, 'intervenant_id', p.intervenant_id)
    from auth.users u join public.profils p on p.user_id = u.id
   where lower(u.email) = lower(btrim(coalesce(p_email, '')))
   order by (p.role = 'admin') desc
   limit 1;
$$;

-- Code demandé : pour une adresse adhérente OU qui a un compte d'espace.
create or replace function public.carte_code_creer(p_email text, p_code_hash text) returns text
language plpgsql set search_path = ''
as $$
declare v_email text := lower(btrim(coalesce(p_email, '')));
begin
  delete from public.codes_carte where cree_le < now() - interval '1 day';
  if not exists (select 1 from public.adhesions where email = v_email and statut <> 'remboursee')
     and public.compte_par_email(v_email) is null then
    return 'inconnu';
  end if;
  if (select count(*) from public.codes_carte where email = v_email and cree_le > now() - interval '1 hour') >= 3 then
    return 'trop_de_demandes';
  end if;
  insert into public.codes_carte (email, code_hash, expire_le) values (v_email, p_code_hash, now() + interval '15 minutes');
  return 'cree';
end $$;

-- Code vérifié : lien de carte créé seulement si l'adresse a une adhésion.
create or replace function public.carte_code_verifier(p_email text, p_code_hash text, p_jeton_hash text) returns text
language plpgsql set search_path = ''
as $$
declare
  v_email text := lower(btrim(coalesce(p_email, '')));
  c public.codes_carte;
begin
  select * into c from public.codes_carte
   where email = v_email and utilise_le is null order by cree_le desc limit 1 for update;
  if not found or c.expire_le <= now() then return 'expire'; end if;
  if c.essais >= 5 then return 'trop_essais'; end if;
  if c.code_hash <> p_code_hash then
    update public.codes_carte set essais = essais + 1 where id = c.id;
    return case when c.essais + 1 >= 5 then 'trop_essais' else 'invalide' end;
  end if;
  update public.codes_carte set utilise_le = now() where id = c.id;
  if exists (select 1 from public.adhesions where email = v_email and statut <> 'remboursee') then
    insert into public.cartes_liens (jeton_hash, email, origine) values (p_jeton_hash, v_email, 'code');
  end if;
  return 'ok';
end $$;

-- Liens de connexion directe envoyés par email (seule l'empreinte est gardée).
create table public.connexions_liens (
  jeton_hash text primary key check (jeton_hash ~ '^[0-9a-f]{64}$'),
  email      text not null check (email = lower(email)),
  cree_le    timestamptz not null default now(),
  expire_le  timestamptz not null,
  utilise_le timestamptz
);
alter table public.connexions_liens enable row level security;   -- aucune règle : serveur seulement

create function public.connexion_lien_creer(p_email text, p_jeton_hash text) returns void
language sql set search_path = ''
as $$
  delete from public.connexions_liens where expire_le < now() - interval '30 days';
  insert into public.connexions_liens (jeton_hash, email, expire_le)
  values (p_jeton_hash, lower(btrim(p_email)), now() + interval '7 days');
$$;

-- Rend l'email du lien s'il est encore valable (et le marque utilisé), sinon 'expire' ou 'utilise'.
create function public.connexion_lien_utiliser(p_jeton_hash text) returns jsonb
language plpgsql set search_path = ''
as $$
declare l public.connexions_liens;
begin
  select * into l from public.connexions_liens where jeton_hash = p_jeton_hash for update;
  if not found or l.expire_le <= now() then return jsonb_build_object('etat', 'expire'); end if;
  if l.utilise_le is not null then return jsonb_build_object('etat', 'utilise'); end if;
  update public.connexions_liens set utilise_le = now() where jeton_hash = p_jeton_hash;
  return jsonb_build_object('etat', 'ok', 'email', l.email);
end $$;

-- « Mon compte » (E15.2) : expériences réservées à venir de l'adresse vérifiée par la carte du téléphone.
create function public.reservations_a_venir(p_jeton_hash text) returns jsonb
language sql stable set search_path = ''
as $$
  select coalesce(jsonb_agg(x order by x->>'debut'), '[]'::jsonb) from (
    select jsonb_build_object(
      'id', r.id, 'reference', r.reference, 'personnes', r.personnes, 'debut', s.debut, 'fin', s.fin,
      'type', e.type, 'titre', e.titre, 'point_rdv', coalesce(s.point_rdv, e.point_rdv->>'fr'),
      'intervenant', i.nom, 'delai_frais_heures', e.delai_frais_heures,
      'seance_modifiee', s.modifiee_le is not null and s.modifiee_le > coalesce(r.confirmee_le, r.cree_le)) as x
      from public.cartes_liens l
      join public.reservations r on r.email = l.email and r.statut = 'confirmee'
      join public.seances s on s.id = r.seance_id and s.debut > now() - interval '3 hours'
      join public.experiences e on e.id = r.experience_id
      left join public.intervenants i on i.id = e.intervenant_id
     where l.jeton_hash = p_jeton_hash and l.revoque_le is null
     order by s.debut limit 20) t;
$$;

-- « Voir » une réservation depuis Mon compte : lien personnel (même page que l'email).
create function public.lien_reservation_compte(p_jeton_hash text, p_reservation_id uuid) returns text
language plpgsql set search_path = ''
as $$
declare v_id uuid;
begin
  select r.id into v_id
    from public.cartes_liens l join public.reservations r on r.email = l.email
   where l.jeton_hash = p_jeton_hash and l.revoque_le is null and r.id = p_reservation_id;
  if v_id is null then return null; end if;
  return interne.lien_reservation(v_id);
end $$;

revoke all on table public.connexions_liens from public, anon, authenticated;
grant all on table public.connexions_liens to service_role;
revoke all on function public.compte_par_email(text), public.carte_code_creer(text, text),
  public.carte_code_verifier(text, text, text), public.connexion_lien_creer(text, text),
  public.connexion_lien_utiliser(text), public.reservations_a_venir(text),
  public.lien_reservation_compte(text, uuid) from public, anon, authenticated;
grant execute on function public.compte_par_email(text), public.carte_code_creer(text, text),
  public.carte_code_verifier(text, text, text), public.connexion_lien_creer(text, text),
  public.connexion_lien_utiliser(text), public.reservations_a_venir(text),
  public.lien_reservation_compte(text, uuid) to service_role;

commit;
