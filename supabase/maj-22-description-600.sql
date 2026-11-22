-- ============================================================
-- ARTDIVE : mise à jour n° 22
-- Description d'une expérience proposée par un intervenant : 600 caractères au lieu de 200.
--
-- Pour une base où maj-21-suppression.sql est DÉJÀ installée. À coller en entier
-- dans Supabase > SQL Editor, puis « Run ». Ensuite : relancer
-- supabase/test-droits.sql. Ne modifie aucune donnée existante.
-- ============================================================

begin;

do $$
begin
  if not exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'seances' and column_name = 'supprimee_le') then
    raise exception 'Installer d''abord maj-21-suppression.sql.';
  end if;
end $$;

-- ---- Description d'une expérience : 600 caractères (maj-22, décision du 22/11, au lieu de 200) ----
create or replace function interne.experiences_garde() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  -- supprimer_experience (admin ou intervenant de l'expérience) passe par sa propre vérification
  restreint boolean := (select auth.uid()) is not null and not interne.est_admin()
                       and coalesce(current_setting('artdive.suppression', true), '') <> 'oui';
  moi uuid;
  libres text[] := array['photo_url', 'description', 'accroche', 'bon_a_savoir',
    'duree_minutes', 'langues', 'point_rdv', 'point_rdv_lat', 'point_rdv_lng',
    'capacite_max', 'participants_min', 'langues_relues', 'nb_etapes', 'maj_le', 'prix_centimes'];
begin
  if not restreint then return new; end if;
  moi := interne.mon_intervenant_id();
  if moi is null then raise exception 'Réservé aux intervenants.'; end if;

  if tg_op = 'INSERT' then
    if new.type not in ('visite_guidee', 'atelier', 'escape_game') then
      raise exception 'Un intervenant peut proposer une visite, un atelier ou un escape game.';
    end if;
    if new.prix_centimes is null or new.prix_centimes < 0 or new.prix_centimes > 100000 then
      raise exception 'Prix par personne manquant.';
    end if;
    if new.capacite_max is null then raise exception 'Nombre de places manquant.'; end if;
    if length(coalesce(new.description->>'fr', '')) > 600 then raise exception 'Description : 600 caractères maximum.'; end if;
    new.intervenant_id := moi;
    select localite_id into new.localite_id from public.intervenants where id = moi;
    new.slug := interne.slugifier(new.titre->>'fr') || '-'
                || substr(replace(gen_random_uuid()::text, '-', ''), 1, 4);
    new.theme := null;
    new.lieu_id := null;
    new.prereservation_centimes := 0;          -- plus de frais de réservation : prix net
    new.prix_libre_min_centimes := null;
    new.option_audioguide_centimes := null;
    new.delai_annulation_heures := 48;
    new.frais_annulation_tardive_centimes := 1000;
    new.delai_frais_heures := 24;
    new.telephone_obligatoire := true;
    new.privatisable := false;
    new.age_minimum := null;
    new.nb_etapes := 0;
    new.langues_relues := '{fr}';
    new.ordre := 0;
    new.actif := true;
    new.publie := false;
    new.a_valider := true;
    new.validee_le := null;
    new.refusee_le := null;
    new.motif_refus := null;
    new.cree_le := now();
    new.maj_le := now();
    return new;
  end if;

  -- Tant que l'expérience n'est pas en ligne : titre et type aussi.
  if not old.publie then libres := libres || array['titre', 'type']; end if;
  -- Refusée : il la corrige puis la renvoie (« à valider » de nouveau).
  if old.refusee_le is not null and not old.publie and new.a_valider and new.refusee_le is null and new.motif_refus is null then
    libres := libres || array['a_valider', 'refusee_le', 'motif_refus'];
  end if;
  if (to_jsonb(new) - libres) is distinct from (to_jsonb(old) - libres) then
    raise exception 'Seule l''association peut modifier la publication, le titre d''une expérience en ligne et les règles d''annulation.';
  end if;
  if new.type not in ('visite_guidee', 'atelier', 'escape_game') then
    raise exception 'Un intervenant peut proposer une visite, un atelier ou un escape game.';
  end if;
  if new.prix_centimes is null or new.prix_centimes < 0 or new.prix_centimes > 100000 then
    raise exception 'Prix par personne manquant.';
  end if;
  if new.description is distinct from old.description and length(coalesce(new.description->>'fr', '')) > 600 then
    raise exception 'Description : 600 caractères maximum.';
  end if;
  if new.capacite_max is not null and new.participants_min > new.capacite_max then
    raise exception 'Le minimum (%) dépasse le nombre de places (%).', new.participants_min, new.capacite_max;
  end if;
  -- Textes changés : les traductions seront à refaire puis à relire.
  if new.titre is distinct from old.titre or new.description is distinct from old.description
     or new.accroche is distinct from old.accroche or new.bon_a_savoir is distinct from old.bon_a_savoir
     or new.point_rdv is distinct from old.point_rdv then
    new.langues_relues := array['fr'];
  end if;
  return new;
end $$;

commit;
