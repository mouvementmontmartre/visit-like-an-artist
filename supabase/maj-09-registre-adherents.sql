-- ============================================================
-- ARTDIVE : mise à jour n° 9
-- Registre des adhérents (numéro de membre, téléphone, consentement), export, conservation, carte avec numéro.
--
-- Pour une base où maj-08-adherents.sql est DÉJÀ installée. À coller en entier
-- dans Supabase > SQL Editor, puis « Run ». Ensuite : relancer
-- supabase/test-droits.sql. Ne modifie aucune donnée existante.
-- ============================================================

begin;

do $$
begin
  if not exists (select 1 from information_schema.columns where table_schema = 'public'
                 and table_name = 'reservations' and column_name = 'adherent') then
    raise exception 'Installer d''abord maj-08-adherents.sql.';
  end if;
  if exists (select 1 from information_schema.columns where table_schema = 'public'
             and table_name = 'adherents' and column_name = 'numero') then
    raise exception 'Cette mise à jour est déjà faite.';
  end if;
end $$;

-- ---- Registre des adhérents (maj-09, décision du 21/11) ----
-- Une ligne par personne : numéro de membre attribué une fois pour toutes
-- (MM-0001…), nom, email, téléphone, identifiants Stripe, preuve du
-- consentement (date, version du texte, email). Le début, la fin et le
-- statut se lisent dans « adhesions » (une ligne par période payée).
create sequence public.adherents_numero_seq;
create table public.adherents (
  id            uuid primary key default gen_random_uuid(),
  numero        text not null unique
                default 'MM-' || lpad(nextval('public.adherents_numero_seq')::text, 4, '0'),
  email         text not null unique check (email = lower(email) and length(email) <= 254),
  nom           text check (length(nom) <= 120),
  telephone     text check (length(telephone) <= 30),
  langue        text not null default 'fr',
  stripe_customer     text,
  stripe_subscription text,
  consentement_le      timestamptz,
  consentement_version text,
  consentement_email   text,
  cree_le       timestamptz not null default now(),
  maj_le        timestamptz not null default now(),
  anonymise_le  timestamptz
);
create trigger adherents_maj before update on public.adherents
  for each row execute function interne.touche_maj();
alter table public.adherents enable row level security;
create policy "admin lit" on public.adherents for select to authenticated
  using ((select interne.est_admin()));

-- Crée ou complète la fiche d'un adhérent (jamais d'effacement : une valeur vide ne remplace rien).
create function interne.adherent_noter(
  p_email text, p_nom text default null, p_telephone text default null,
  p_customer text default null, p_subscription text default null, p_langue text default null,
  p_consentement_le timestamptz default null, p_consentement_version text default null
) returns public.adherents
language plpgsql security definer set search_path = ''
as $$
declare
  a public.adherents;
  v_email text := lower(btrim(coalesce(p_email, '')));
begin
  if v_email !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' then return null; end if;
  insert into public.adherents (email, nom, telephone, langue, stripe_customer, stripe_subscription,
                                consentement_le, consentement_version, consentement_email)
  values (v_email, nullif(btrim(coalesce(p_nom, '')), ''), nullif(btrim(coalesce(p_telephone, '')), ''),
          coalesce(nullif(p_langue, ''), 'fr'), p_customer, p_subscription,
          p_consentement_le, p_consentement_version, case when p_consentement_le is not null then v_email end)
  on conflict (email) do update set
    nom                 = coalesce(public.adherents.nom, excluded.nom),
    telephone           = coalesce(excluded.telephone, public.adherents.telephone),
    langue              = case when p_langue is not null then excluded.langue else public.adherents.langue end,
    stripe_customer     = coalesce(excluded.stripe_customer, public.adherents.stripe_customer),
    stripe_subscription = coalesce(excluded.stripe_subscription, public.adherents.stripe_subscription),
    consentement_le      = coalesce(excluded.consentement_le, public.adherents.consentement_le),
    consentement_version = coalesce(excluded.consentement_version, public.adherents.consentement_version),
    consentement_email   = coalesce(excluded.consentement_email, public.adherents.consentement_email)
  returning * into a;
  return a;
end $$;

-- Chaque adhésion enregistrée (webhook, import, ajout manuel) a sa fiche au registre.
create function interne.adhesions_vers_registre() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  perform interne.adherent_noter(new.email, new.nom, null, new.stripe_customer, new.stripe_subscription);
  return new;
end $$;
create trigger adhesions_registre after insert or update of email, nom, stripe_customer, stripe_subscription
  on public.adhesions for each row execute function interne.adhesions_vers_registre();

-- Reprise des adhésions déjà en base : numéros dans l'ordre d'arrivée (première adhésion).
insert into public.adherents (numero, email, nom, stripe_customer, stripe_subscription)
select 'MM-' || lpad((row_number() over (order by x.premier, x.email))::text, 4, '0'),
       x.email, x.nom, x.customer, x.subscription
  from (select email, min(debut) as premier,
               (array_agg(nom order by debut desc) filter (where nom is not null))[1] as nom,
               (array_agg(stripe_customer order by debut desc) filter (where stripe_customer is not null))[1] as customer,
               (array_agg(stripe_subscription order by debut desc) filter (where stripe_subscription is not null))[1] as subscription
          from public.adhesions group by email) x
on conflict (email) do nothing;
select setval('public.adherents_numero_seq', greatest((select count(*) from public.adherents), 1),
              (select count(*) from public.adherents) > 0);

-- Serveur : fiche complétée au paiement (téléphone, consentement).
create function public.noter_adherent(
  p_email text, p_nom text, p_telephone text, p_customer text, p_subscription text, p_langue text,
  p_consentement_le timestamptz, p_consentement_version text
) returns jsonb
language sql set search_path = ''
as $$
  select jsonb_build_object('numero', a.numero, 'email', a.email)
    from interne.adherent_noter(p_email, p_nom, p_telephone, p_customer, p_subscription, p_langue,
                                p_consentement_le, p_consentement_version) a;
$$;

-- Admin : le registre (écran Adhésions, export CSV).
create function public.registre_adherents() returns table (
  numero text, nom text, email text, telephone text, debut timestamptz, fin timestamptz,
  statut text, formule text, renouvellement_auto boolean, consentement_le timestamptz, consentement_version text
)
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not interne.est_admin() then raise exception 'RESERVE_ADMIN'; end if;
  return query
  select a.numero, a.nom, a.email, a.telephone,
         min(h.debut) filter (where h.statut <> 'remboursee'),
         max(h.valide_jusqua) filter (where h.statut <> 'remboursee'),
         case when a.anonymise_le is not null then 'anonymise'
              when max(h.valide_jusqua) filter (where h.statut <> 'remboursee') > now() then 'actif'
              else 'expire' end,
         case when bool_or(h.formule = 'bienfaiteur' and h.valide_jusqua > now()) then 'bienfaiteur' else 'adhesion' end,
         coalesce(bool_or(h.source = 'stripe_abonnement' and h.statut = 'active' and h.valide_jusqua > now()), false),
         a.consentement_le, a.consentement_version
    from public.adherents a
    left join public.adhesions h on h.email = a.email
   group by a.id
   order by a.numero;
end $$;

-- Conservation (RGPD) : 3 ans après la fin de la dernière adhésion, la fiche
-- est anonymisée (nom, email, téléphone) ; le numéro et les dates restent pour
-- les comptes de l'association. Lancé chaque mois.
create function public.anonymiser_adherents_anciens() returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  a record;
  n integer := 0;
  v_anon text;
begin
  for a in
    select ad.id, ad.email from public.adherents ad
     where ad.anonymise_le is null
       and coalesce((select max(h.valide_jusqua) from public.adhesions h where h.email = ad.email), ad.cree_le)
           < now() - interval '3 years'
  loop
    v_anon := 'anonyme-' || a.id || '@anonyme.invalid';
    delete from public.cartes_liens where email = a.email;
    -- La fiche d'abord : la mise à jour des adhésions retrouve ainsi la fiche anonyme (déclencheur du registre).
    update public.adherents set email = v_anon, nom = null, telephone = null, consentement_email = null,
           stripe_customer = null, stripe_subscription = null, anonymise_le = now()
     where id = a.id;
    update public.adhesions set email = v_anon, nom = null, note = null, stripe_customer = null where email = a.email;
    n := n + 1;
  end loop;
  return n;
end $$;

-- La carte montre aussi le numéro de membre et si l'adhésion se renouvelle seule.
create or replace function public.carte_par_jeton(p_jeton_hash text) returns jsonb
language plpgsql set search_path = ''
as $$
declare
  l public.cartes_liens;
  r record;
  v_numero text;
begin
  select * into l from public.cartes_liens
   where jeton_hash = p_jeton_hash and revoque_le is null;
  if not found then return null; end if;

  select
    (array_agg(nom order by (statut = 'active') desc, valide_jusqua desc) filter (where nom is not null))[1] as nom,
    max(valide_jusqua) filter (where statut <> 'remboursee') as valide_jusqua,
    min(debut) filter (where statut <> 'remboursee') as membre_depuis,
    bool_or(formule = 'bienfaiteur' and statut <> 'remboursee' and valide_jusqua > now()) as bienfaiteur,
    coalesce(bool_or(source = 'stripe_abonnement' and statut = 'active' and valide_jusqua > now()), false) as renouvelable
  into r
  from public.adhesions where email = l.email;

  if r.valide_jusqua is null then return null; end if;
  select numero into v_numero from public.adherents where email = l.email;
  update public.cartes_liens set dernier_usage = now() where jeton_hash = l.jeton_hash;
  return jsonb_build_object(
    'nom', r.nom,
    'formule', case when r.bienfaiteur then 'bienfaiteur' else 'adhesion' end,
    'membre_depuis', r.membre_depuis,
    'valide_jusqua', r.valide_jusqua,
    'valide', r.valide_jusqua > now(),
    'numero', v_numero,
    'renouvelable', r.renouvelable);
end $$;

-- Formulaire de réservation : adhésion valable, numéro de membre, date de fin.
create or replace function public.adhesion_pour_reservation(p_email text) returns jsonb
language sql stable set search_path = ''
as $$
  select jsonb_build_object('adherent', x.v is not null, 'valide_jusqua', x.v,
         'numero', case when x.v is not null then (select numero from public.adherents
                                                   where email = lower(btrim(coalesce(p_email, '')))) end)
    from (select interne.adhesion_valide_jusqua(p_email) as v) x;
$$;

-- Carte de l'adhésion (prélèvements hors session) : client et abonnement Stripe de l'adhésion en cours.
create function public.adhesion_carte(p_email text) returns jsonb
language sql stable set search_path = ''
as $$
  select jsonb_build_object('stripe_customer', h.stripe_customer, 'stripe_subscription', h.stripe_subscription)
    from public.adhesions h
   where h.email = lower(btrim(coalesce(p_email, ''))) and h.statut <> 'remboursee'
     and h.valide_jusqua > now() and h.stripe_customer is not null
   order by (h.stripe_subscription is not null) desc, h.valide_jusqua desc
   limit 1;
$$;

-- Import des anciens adhérents (règle du 21/11) : une adhésion déjà finie est
-- gardée active jusqu'au 31/12/2026, le temps de passer à l'abonnement.
create function public.prolonger_anciens_adherents(p_ids uuid[], p_jusqua timestamptz) returns integer
language plpgsql set search_path = ''
as $$
declare n integer;
begin
  update public.adhesions set valide_jusqua = p_jusqua
   where id = any(p_ids) and statut <> 'remboursee' and valide_jusqua < p_jusqua;
  get diagnostics n = row_count;
  return n;
end $$;

revoke all on table public.adherents from public, anon, authenticated;
revoke all on sequence public.adherents_numero_seq from public, anon, authenticated;
grant all on table public.adherents to service_role;
grant all on sequence public.adherents_numero_seq to service_role;
grant select on table public.adherents to authenticated;
revoke all on function interne.adherent_noter(text, text, text, text, text, text, timestamptz, text),
  interne.adhesions_vers_registre(), public.noter_adherent(text, text, text, text, text, text, timestamptz, text),
  public.registre_adherents(), public.anonymiser_adherents_anciens(), public.adhesion_carte(text),
  public.prolonger_anciens_adherents(uuid[], timestamptz) from public, anon, authenticated;
grant execute on function interne.adherent_noter(text, text, text, text, text, text, timestamptz, text),
  interne.adhesions_vers_registre(), public.noter_adherent(text, text, text, text, text, text, timestamptz, text),
  public.registre_adherents(), public.anonymiser_adherents_anciens(), public.adhesion_carte(text),
  public.prolonger_anciens_adherents(uuid[], timestamptz) to service_role;
grant execute on function public.registre_adherents() to authenticated;

commit;

-- Conservation (RGPD) : anonymisation mensuelle des fiches finies depuis 3 ans.
do $$
begin
  perform cron.schedule('artdive-anonymiser-adherents', '41 4 2 * *', 'select public.anonymiser_adherents_anciens()');
exception when others then
  raise notice 'Anonymisation mensuelle non programmée (%). À lancer à la main : select public.anonymiser_adherents_anciens();', sqlerrm;
end $$;
