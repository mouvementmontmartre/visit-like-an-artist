-- ============================================================
-- ARTDIVE : mise à jour n° 10
-- Relances 30 et 7 jours avant la fin de l'adhésion.
--
-- Pour une base où maj-09-registre-adherents.sql est DÉJÀ installée. À coller en entier
-- dans Supabase > SQL Editor, puis « Run ». Ensuite : relancer
-- supabase/test-droits.sql. Ne modifie aucune donnée existante.
-- ============================================================

begin;

do $$
begin
  if not exists (select 1 from information_schema.columns where table_schema = 'public'
                 and table_name = 'adherents' and column_name = 'numero') then
    raise exception 'Installer d''abord maj-09-registre-adherents.sql.';
  end if;
  if exists (select 1 from information_schema.columns where table_schema = 'public'
             and table_name = 'adhesions' and column_name = 'relance_30_pour') then
    raise exception 'Cette mise à jour est déjà faite.';
  end if;
end $$;

-- ---- Relances avant l'échéance de l'adhésion (maj-10) ----
-- Un email 30 jours puis 7 jours avant la fin de l'adhésion en cours :
-- « renouvelée automatiquement le … » (abonnement) ou « à renouveler » (autre).
-- Chaque relance est notée pour la date de fin concernée : un
-- renouvellement (nouvelle date de fin) remet les relances à zéro.
alter table public.adhesions
  add column relance_30_pour timestamptz,
  add column relance_7_pour  timestamptz;

create function public.preparer_relances_adhesion() returns integer
language plpgsql set search_path = ''
as $$
declare
  h record;
  n integer := 0;
  v_jours integer;
begin
  for h in
    select distinct on (x.email) x.*, ad.numero, ad.nom as nom_registre, ad.langue
      from public.adhesions x
      left join public.adherents ad on ad.email = x.email
     where x.statut <> 'remboursee' and x.formule = 'adhesion'
       and x.valide_jusqua > now() and x.valide_jusqua <= now() + interval '30 days'
       and x.email !~ '@anonyme\.invalid$'
     order by x.email, x.valide_jusqua desc
  loop
    -- Une autre adhésion du même email va plus loin : rien à rappeler.
    if exists (select 1 from public.adhesions y where y.email = h.email and y.statut <> 'remboursee'
                 and y.valide_jusqua > h.valide_jusqua) then continue; end if;
    v_jours := case when h.valide_jusqua <= now() + interval '7 days' then 7 else 30 end;
    if v_jours = 30 and h.relance_30_pour is not distinct from h.valide_jusqua then continue; end if;
    if v_jours = 7 and h.relance_7_pour is not distinct from h.valide_jusqua then continue; end if;
    insert into public.envois (type, destinataire, langue, donnees)
    values ('relance_adhesion', h.email, coalesce(h.langue, 'fr'), jsonb_build_object(
      'nom', coalesce(h.nom_registre, h.nom), 'numero', h.numero, 'fin', h.valide_jusqua, 'jours', v_jours,
      'renouvelable', h.source = 'stripe_abonnement' and h.statut = 'active'));
    update public.adhesions set
      relance_30_pour = case when v_jours = 30 then h.valide_jusqua else relance_30_pour end,
      relance_7_pour  = case when v_jours = 7 then h.valide_jusqua else relance_7_pour end
     where id = h.id;
    n := n + 1;
  end loop;
  return n;
end $$;

revoke all on function public.preparer_relances_adhesion() from public, anon, authenticated;
grant execute on function public.preparer_relances_adhesion() to service_role;

commit;
