-- ============================================================
-- ARTDIVE : mise à jour n° 13
-- Code de vérification de l'email : seul l'adhérent affiche sa carte et réserve en adhérent.
--
-- Pour une base où maj-12-reservation-adherents.sql est DÉJÀ installée. À coller en entier
-- dans Supabase > SQL Editor, puis « Run ». Ensuite : relancer
-- supabase/test-droits.sql. Ne modifie aucune donnée existante.
-- ============================================================

begin;

do $$
begin
  if not exists (select 1 from information_schema.columns where table_schema = 'public'
                 and table_name = 'reservations' and column_name = 'attente_adhesion') then
    raise exception 'Installer d''abord maj-12-reservation-adherents.sql.';
  end if;
  if exists (select 1 from information_schema.columns where table_schema = 'public'
             and table_name = 'codes_carte' and column_name = 'code_hash') then
    raise exception 'Cette mise à jour est déjà faite.';
  end if;
end $$;

-- ---- Code de vérification de l'email (maj-13, décision du 21/11) ----
-- Seul l'adhérent peut afficher sa carte : un code à 6 chiffres, valable
-- 15 minutes, est envoyé à son adresse ; 5 essais par code, 3 codes par
-- heure et par adresse. Code bon : un lien de carte (jeton) est créé pour
-- ce téléphone. La réservation d'un adhérent exige ce jeton (vérifié par
-- le serveur). Seule l'empreinte du code est gardée, jamais le code.
alter table public.cartes_liens drop constraint cartes_liens_origine_check;
alter table public.cartes_liens add constraint cartes_liens_origine_check
  check (origine in ('paiement', 'email', 'admin', 'code'));

create table public.codes_carte (
  id         bigint generated always as identity primary key,
  email      text not null check (email = lower(email)),
  code_hash  text not null check (code_hash ~ '^[0-9a-f]{64}$'),
  cree_le    timestamptz not null default now(),
  expire_le  timestamptz not null,
  essais     integer not null default 0,
  utilise_le timestamptz
);
create index codes_carte_email on public.codes_carte (email, cree_le desc);
alter table public.codes_carte enable row level security;   -- aucune règle : serveur seulement

-- Nouveau code pour une adresse qui a (ou a eu) une adhésion. Rend 'cree',
-- 'inconnu' (le serveur répond pareil) ou 'trop_de_demandes'.
create function public.carte_code_creer(p_email text, p_code_hash text) returns text
language plpgsql set search_path = ''
as $$
declare v_email text := lower(btrim(coalesce(p_email, '')));
begin
  delete from public.codes_carte where cree_le < now() - interval '1 day';
  if not exists (select 1 from public.adhesions where email = v_email and statut <> 'remboursee') then
    return 'inconnu';
  end if;
  if (select count(*) from public.codes_carte where email = v_email and cree_le > now() - interval '1 hour') >= 3 then
    return 'trop_de_demandes';
  end if;
  insert into public.codes_carte (email, code_hash, expire_le) values (v_email, p_code_hash, now() + interval '15 minutes');
  return 'cree';
end $$;

-- Vérifie le dernier code de l'adresse. Rend 'ok' (lien de carte créé pour
-- p_jeton_hash), 'invalide', 'expire' ou 'trop_essais'.
create function public.carte_code_verifier(p_email text, p_code_hash text, p_jeton_hash text) returns text
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
  insert into public.cartes_liens (jeton_hash, email, origine) values (p_jeton_hash, v_email, 'code');
  return 'ok';
end $$;

-- Email vérifié d'un lien de carte (réservation d'un adhérent : le jeton prouve l'adresse).
create function public.carte_email(p_jeton_hash text) returns text
language sql stable set search_path = ''
as $$ select email from public.cartes_liens where jeton_hash = p_jeton_hash and revoque_le is null; $$;

revoke all on table public.codes_carte from public, anon, authenticated;
grant all on table public.codes_carte to service_role;
revoke all on function public.carte_code_creer(text, text), public.carte_code_verifier(text, text, text),
  public.carte_email(text) from public, anon, authenticated;
grant execute on function public.carte_code_creer(text, text), public.carte_code_verifier(text, text, text),
  public.carte_email(text) to service_role;

commit;
