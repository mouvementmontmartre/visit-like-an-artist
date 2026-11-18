-- ============================================================
-- ARTDIVE : mise à jour n° 2 (cartes de membre)
--
-- Pour une base où schema.sql et maj-01 sont DÉJÀ installés. À coller
-- en entier dans Supabase > SQL Editor, puis « Run ». Tout passe ou
-- rien ne passe. (Une base neuve n'en a pas besoin.)
--
-- Ajoute les adhésions (remplies par Stripe ou à la main) et les liens
-- personnels vers les cartes de membre. Personne ne peut lire la liste
-- depuis le navigateur. Ensuite : relancer supabase/test-droits.sql.
-- ============================================================

begin;

do $$
begin
  if to_regclass('public.experiences') is null then
    raise exception 'Installer d''abord schema.sql.';
  end if;
  if not exists (select 1 from information_schema.columns
                 where table_schema = 'public' and table_name = 'experiences'
                   and column_name = 'a_valider') then
    raise exception 'Installer d''abord maj-01-guides-autonomes.sql.';
  end if;
  if to_regclass('public.adhesions') is not null then
    raise exception 'Cette mise à jour est déjà faite.';
  end if;
end $$;

-- ============================================================
-- ADHÉSIONS ET CARTES DE MEMBRE
-- Les adhésions viennent de Stripe (webhook, fonctions Netlify) ou sont
-- ajoutées à la main par l'association. La liste ne sort jamais de la
-- base : le navigateur n'en lit rien. Un adhérent voit SA carte grâce
-- à un jeton secret (lien reçu par email ou après le paiement), dont
-- seule l'empreinte SHA-256 est gardée ici.
-- ============================================================

create table public.adhesions (
  id            uuid primary key default gen_random_uuid(),
  email         text not null check (email = lower(email) and email ~ '^[^\s@]+@[^\s@]+\.[^\s@]+$'
                                     and length(email) <= 254),
  nom           text check (length(nom) <= 120),
  formule       text not null default 'adhesion' check (formule in ('adhesion', 'bienfaiteur')),
  source        text not null check (source in ('stripe_abonnement', 'stripe_ponctuel', 'manuelle')),
  stripe_customer       text,
  stripe_subscription   text unique,
  stripe_payment_intent text unique,
  debut         timestamptz not null,
  valide_jusqua timestamptz not null,
  statut        text not null default 'active' check (statut in ('active', 'arretee', 'remboursee')),
  note          text check (length(note) <= 500),
  cree_le       timestamptz not null default now(),
  maj_le        timestamptz not null default now(),
  check (valide_jusqua >= debut),
  check (source <> 'stripe_abonnement' or stripe_subscription is not null),
  check (source <> 'stripe_ponctuel' or stripe_payment_intent is not null)
);
create index adhesions_email on public.adhesions (email);
create trigger adhesions_maj before update on public.adhesions
  for each row execute function interne.touche_maj();

-- Liens personnels vers une carte (le jeton n'existe que chez l'adhérent).
create table public.cartes_liens (
  jeton_hash    text primary key check (jeton_hash ~ '^[0-9a-f]{64}$'),
  email         text not null check (email = lower(email)),
  origine       text not null check (origine in ('paiement', 'email', 'admin')),
  cree_le       timestamptz not null default now(),
  dernier_usage timestamptz,
  revoque_le    timestamptz
);
create index cartes_liens_email on public.cartes_liens (email);

-- Codes à usage unique pour lancer l'import des adhésions Stripe.
create table public.codes_import (
  code_hash  text primary key check (code_hash ~ '^[0-9a-f]{64}$'),
  expire_le  timestamptz not null,
  utilise_le timestamptz
);

-- ---- Fonctions réservées au serveur (clé secrète) ----

-- Abonnement Stripe (adhésion annuelle ou bienfaiteur mensuel) : crée ou
-- met à jour la ligne. p_valide_jusqua vide = garder la date actuelle.
create function public.enregistrer_adhesion_abonnement(
  p_subscription text, p_customer text, p_email text, p_nom text, p_formule text,
  p_debut timestamptz, p_valide_jusqua timestamptz, p_statut text
) returns jsonb
language plpgsql set search_path = ''
as $$
declare
  a public.adhesions;
  v_email text := lower(btrim(coalesce(p_email, '')));
begin
  if coalesce(p_subscription, '') = '' then raise exception 'ABONNEMENT_MANQUANT'; end if;
  select * into a from public.adhesions where stripe_subscription = p_subscription for update;
  if not found then
    if p_valide_jusqua is null then raise exception 'DATE_MANQUANTE'; end if;
    insert into public.adhesions (email, nom, formule, source, stripe_customer, stripe_subscription,
                                  debut, valide_jusqua, statut)
    values (v_email, nullif(btrim(coalesce(p_nom, '')), ''), coalesce(p_formule, 'adhesion'),
            'stripe_abonnement', p_customer, p_subscription,
            least(p_debut, p_valide_jusqua), p_valide_jusqua, coalesce(p_statut, 'active'))
    returning * into a;
  else
    update public.adhesions set
      email         = case when v_email <> '' then v_email else email end,
      nom           = coalesce(nom, nullif(btrim(coalesce(p_nom, '')), '')),  -- le nom saisi à l'adhésion reste
      formule       = coalesce(p_formule, formule),
      stripe_customer = coalesce(p_customer, stripe_customer),
      valide_jusqua = greatest(coalesce(p_valide_jusqua, valide_jusqua), debut),
      statut        = coalesce(p_statut, statut)
    where id = a.id
    returning * into a;
  end if;
  return jsonb_build_object('id', a.id, 'email', a.email, 'valide_jusqua', a.valide_jusqua, 'statut', a.statut);
end $$;

-- Paiement ponctuel : valable un an à partir de la date de paiement.
create function public.enregistrer_adhesion_ponctuelle(
  p_payment_intent text, p_customer text, p_email text, p_nom text, p_formule text, p_paye_le timestamptz
) returns jsonb
language plpgsql set search_path = ''
as $$
declare
  a public.adhesions;
begin
  if coalesce(p_payment_intent, '') = '' or p_paye_le is null then raise exception 'PAIEMENT_MANQUANT'; end if;
  insert into public.adhesions (email, nom, formule, source, stripe_customer, stripe_payment_intent,
                                debut, valide_jusqua)
  values (lower(btrim(coalesce(p_email, ''))), nullif(btrim(coalesce(p_nom, '')), ''),
          coalesce(p_formule, 'adhesion'), 'stripe_ponctuel', p_customer, p_payment_intent,
          p_paye_le, p_paye_le + interval '1 year')
  on conflict (stripe_payment_intent) do update set
    nom = coalesce(public.adhesions.nom, excluded.nom)
  returning * into a;
  return jsonb_build_object('id', a.id, 'email', a.email, 'valide_jusqua', a.valide_jusqua, 'statut', a.statut);
end $$;

-- Paiement ponctuel remboursé : la carte n'est plus valable.
create function public.adhesion_remboursee(p_payment_intent text) returns integer
language plpgsql set search_path = ''
as $$
declare n integer;
begin
  update public.adhesions set statut = 'remboursee', valide_jusqua = greatest(debut, least(valide_jusqua, now()))
   where stripe_payment_intent = p_payment_intent and statut <> 'remboursee';
  get diagnostics n = row_count;
  return n;
end $$;

-- Ce que montre une carte : uniquement pour le jeton de son adhérent.
create function public.carte_par_jeton(p_jeton_hash text) returns jsonb
language plpgsql set search_path = ''
as $$
declare
  l public.cartes_liens;
  r record;
begin
  select * into l from public.cartes_liens
   where jeton_hash = p_jeton_hash and revoque_le is null;
  if not found then return null; end if;

  select
    (array_agg(nom order by (statut = 'active') desc, valide_jusqua desc) filter (where nom is not null))[1] as nom,
    max(valide_jusqua) filter (where statut <> 'remboursee') as valide_jusqua,
    min(debut) filter (where statut <> 'remboursee') as membre_depuis,
    bool_or(formule = 'bienfaiteur' and statut <> 'remboursee' and valide_jusqua > now()) as bienfaiteur
  into r
  from public.adhesions where email = l.email;

  if r.valide_jusqua is null then return null; end if;
  update public.cartes_liens set dernier_usage = now() where jeton_hash = l.jeton_hash;
  return jsonb_build_object(
    'nom', r.nom,
    'formule', case when r.bienfaiteur then 'bienfaiteur' else 'adhesion' end,
    'membre_depuis', r.membre_depuis,
    'valide_jusqua', r.valide_jusqua,
    'valide', r.valide_jusqua > now());
end $$;

-- Enregistre un lien de carte, seulement si l'email a une adhésion.
-- Pour les demandes par email : 3 par heure au plus pour une même adresse.
-- Répond sans dire si l'adresse est adhérente quand elle ne l'est pas
-- (le serveur répond toujours « email envoyé si vous êtes adhérent »).
create function public.carte_creer_lien(p_email text, p_jeton_hash text, p_origine text) returns text
language plpgsql set search_path = ''
as $$
declare
  v_email text := lower(btrim(coalesce(p_email, '')));
begin
  if not exists (select 1 from public.adhesions where email = v_email and statut <> 'remboursee') then
    return 'inconnu';
  end if;
  if p_origine = 'email' and (select count(*) from public.cartes_liens
        where email = v_email and origine = 'email' and cree_le > now() - interval '1 hour') >= 3 then
    return 'trop_de_demandes';
  end if;
  insert into public.cartes_liens (jeton_hash, email, origine) values (p_jeton_hash, v_email, p_origine);
  return 'cree';
end $$;

-- Import : vérifie et consomme un code à usage unique.
create function public.code_import_utiliser(p_code_hash text) returns boolean
language plpgsql set search_path = ''
as $$
declare n integer;
begin
  update public.codes_import set utilise_le = now()
   where code_hash = p_code_hash and utilise_le is null and expire_le > now();
  get diagnostics n = row_count;
  return n = 1;
end $$;

-- ---- Fonctions de l'association (SQL Editor, ou admin connecté) ----

-- Crée un code d'import valable 30 minutes. Le code n'est affiché qu'une fois.
create function public.code_import_creer() returns text
language plpgsql security definer set search_path = ''
as $$
declare v_code text;
begin
  if (select auth.uid()) is not null and not interne.est_admin() then raise exception 'RESERVE_ADMIN'; end if;
  v_code := replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
  insert into public.codes_import (code_hash, expire_le)
  values (encode(sha256(convert_to(v_code, 'UTF8')), 'hex'), now() + interval '30 minutes');
  return v_code;
end $$;

-- Ajoute une adhésion payée hors Stripe (espèces, virement, mécénat).
create function public.ajouter_adhesion_manuelle(
  p_email text, p_nom text, p_valide_jusqua date,
  p_formule text default 'adhesion', p_note text default null, p_debut date default current_date
) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare a public.adhesions;
begin
  if (select auth.uid()) is not null and not interne.est_admin() then raise exception 'RESERVE_ADMIN'; end if;
  insert into public.adhesions (email, nom, formule, source, debut, valide_jusqua, note)
  values (lower(btrim(p_email)), nullif(btrim(coalesce(p_nom, '')), ''), coalesce(p_formule, 'adhesion'),
          'manuelle', p_debut, (p_valide_jusqua + 1)::timestamptz, p_note)
  returning * into a;
  insert into public.journal_admin (acteur, action, cible_table, cible_id, details)
  values ((select auth.uid()), 'adhesion_manuelle', 'adhesions', a.id,
          jsonb_build_object('valide_jusqua', a.valide_jusqua, 'formule', a.formule));
  return jsonb_build_object('id', a.id, 'email', a.email, 'valide_jusqua', a.valide_jusqua);
end $$;


-- Adhésions et cartes : lecture par l'admin seulement, écriture par le serveur.
alter table public.adhesions    enable row level security;
alter table public.cartes_liens enable row level security;
alter table public.codes_import enable row level security;
create policy "admin lit" on public.adhesions for select to authenticated
  using ((select interne.est_admin()));

-- Droits : fermés par défaut, puis le strict nécessaire.
revoke all on public.adhesions, public.cartes_liens, public.codes_import
  from public, anon, authenticated;
revoke all on function public.enregistrer_adhesion_abonnement(text, text, text, text, text, timestamptz, timestamptz, text),
  public.enregistrer_adhesion_ponctuelle(text, text, text, text, text, timestamptz),
  public.adhesion_remboursee(text), public.carte_par_jeton(text),
  public.carte_creer_lien(text, text, text), public.code_import_utiliser(text),
  public.code_import_creer(), public.ajouter_adhesion_manuelle(text, text, date, text, text, date)
  from public, anon, authenticated;
grant all on public.adhesions, public.cartes_liens, public.codes_import to service_role;
grant execute on function public.enregistrer_adhesion_abonnement(text, text, text, text, text, timestamptz, timestamptz, text),
  public.enregistrer_adhesion_ponctuelle(text, text, text, text, text, timestamptz),
  public.adhesion_remboursee(text), public.carte_par_jeton(text),
  public.carte_creer_lien(text, text, text), public.code_import_utiliser(text),
  public.code_import_creer(), public.ajouter_adhesion_manuelle(text, text, date, text, text, date)
  to service_role;
grant select on public.adhesions to authenticated;
grant execute on function public.code_import_creer() to authenticated;
grant execute on function public.ajouter_adhesion_manuelle(text, text, date, text, text, date) to authenticated;

commit;

select 'mise à jour n° 2 faite' as resultat;
