-- ============================================================
-- ARTDIVE : test des droits d'accès
--
-- À coller EN ENTIER dans Supabase > SQL Editor APRÈS schema.sql,
-- puis « Run ». Le résultat est un tableau : chaque ligne doit
-- afficher OK. Les lignes en ÉCHEC, s'il y en a, sont en haut.
--
-- Le test crée de fausses données (comptes, expériences, séances,
-- réservations), se fait passer pour un visiteur, deux intervenants,
-- l'admin et le serveur, puis ANNULE tout : il ne reste rien dans
-- la base. Il peut être relancé autant de fois que voulu.
-- ============================================================

-- Exécute une requête dans la peau d'un rôle et rend ce qui s'est passé :
-- un nombre de lignes, ou « REFUS (raison) ».
create or replace function pg_temp.essai(p_role text, p_uid uuid, p_sql text) returns text
language plpgsql as $$
declare
  v_res text;
  v_n bigint;
begin
  perform set_config('request.jwt.claims',
    case when p_role is null then ''
         else jsonb_build_object('role', p_role, 'sub', p_uid)::text end, true);
  if p_role is not null then execute format('set local role %I', p_role); end if;
  begin
    if p_sql ~* '^\s*select' then
      execute 'select count(*) from (' || p_sql || ') q' into v_n;
    else
      execute p_sql;
      get diagnostics v_n = row_count;
    end if;
    v_res := v_n::text;
  exception when others then
    v_res := 'REFUS (' || left(sqlerrm, 70) || ')';
  end;
  execute 'reset role';
  perform set_config('request.jwt.claims', '', true);
  return v_res;
end $$;

-- Le test lui-même : rend la liste des essais et de leurs résultats.
create or replace function pg_temp.test_droits() returns jsonb
language plpgsql as $test$
declare
  res jsonb := '[]'::jsonb;
  v text;
  -- comptes
  u_admin uuid := gen_random_uuid();
  u_a uuid := gen_random_uuid();
  u_b uuid := gen_random_uuid();
  -- données
  l_pub uuid := gen_random_uuid();  l_cache uuid := gen_random_uuid();
  i_a uuid := gen_random_uuid();    i_b uuid := gen_random_uuid();   i_cache uuid := gen_random_uuid();
  x_a uuid := gen_random_uuid();    x_b uuid := gen_random_uuid();   x_cache uuid := gen_random_uuid();
  x_auto uuid := gen_random_uuid(); x_escape uuid := gen_random_uuid();
  e3 uuid := gen_random_uuid();
  s_a uuid := gen_random_uuid();    s_a_brouillon uuid := gen_random_uuid();
  s_b uuid := gen_random_uuid();
  r_bloquee uuid := gen_random_uuid();
  p_a uuid := gen_random_uuid();
  s_loin uuid := gen_random_uuid();  s_tot uuid := gen_random_uuid();  s_min uuid := gen_random_uuid();
  s_passee uuid := gen_random_uuid(); s_rappel uuid := gen_random_uuid();
  r_loin uuid := gen_random_uuid();  r_tot uuid := gen_random_uuid();  r_tot_sans uuid := gen_random_uuid();
  r_min uuid := gen_random_uuid();   r_passee uuid := gen_random_uuid(); r_rappel uuid := gen_random_uuid();
  v_etape text := 'creation';
begin
  begin  -- tout ce bloc est annulé à la fin
    -- ---------- fausses données ----------
    begin
      insert into auth.users (id, email, aud, role, instance_id) values
        (u_admin, 'test-admin-' || u_admin || '@exemple.invalid', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000'),
        (u_a, 'test-a-' || u_a || '@exemple.invalid', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000'),
        (u_b, 'test-b-' || u_b || '@exemple.invalid', 'authenticated', 'authenticated', '00000000-0000-0000-0000-000000000000');
    exception when others then
      raise exception 'COMPTES_TEST: %', sqlerrm;
    end;

    insert into public.lieux (id, localite_id, slug, nom, famille, categorie, visibilite, publie) values
      (l_pub, 'montmartre', 'test-lieu-' || l_pub, 'Lieu publié', 'sortir', 'cabaret', 'adherent', true),
      (l_cache, 'montmartre', 'test-lieu-' || l_cache, 'Lieu non publié', 'sortir', 'cabaret', 'invite', false);
    insert into public.intervenants (id, localite_id, slug, type, nom, publie) values
      (i_a, 'montmartre', 'test-a-' || i_a, 'guide', 'Intervenant A', true),
      (i_b, 'montmartre', 'test-b-' || i_b, 'artiste', 'Intervenant B', true),
      (i_cache, 'montmartre', 'test-c-' || i_cache, 'guide', 'Intervenant non publié', false);
    insert into public.profils (user_id, role, intervenant_id) values
      (u_admin, 'admin', null), (u_a, 'intervenant', i_a), (u_b, 'intervenant', i_b);

    insert into public.experiences (id, localite_id, slug, type, titre, intervenant_id,
        prix_centimes, prereservation_centimes, prix_libre_min_centimes, option_audioguide_centimes,
        capacite_max, participants_min, telephone_obligatoire, publie) values
      (x_a, 'montmartre', 'test-xa-' || x_a, 'visite_guidee', '{"fr":"Visite de A"}', i_a, 5000, 500, null, null, 10, 4, true, true),
      (x_b, 'montmartre', 'test-xb-' || x_b, 'atelier', '{"fr":"Atelier de B"}', i_b, 4500, 500, null, null, 8, 4, true, true),
      (x_cache, 'montmartre', 'test-xc-' || x_cache, 'soiree', '{"fr":"Soirée non publiée"}', null, 2500, null, null, null, 40, 1, false, false),
      (x_auto, 'montmartre', 'test-xg-' || x_auto, 'autoguidee', '{"fr":"Circuit autoguidé"}', i_a, null, null, 500, 400, null, 1, false, true),
      (x_escape, 'montmartre', 'test-xe-' || x_escape, 'escape_game', '{"fr":"Escape game"}', null, 1100, null, null, null, 8, 1, false, true);

    insert into public.etapes (id, experience_id, ordre, type, apercu, nom, texte) values
      (gen_random_uuid(), x_auto, 0, 'depart', true, '{"fr":"Départ"}', '{"fr":"Texte offert"}'),
      (gen_random_uuid(), x_auto, 1, 'etape', true, '{"fr":"Étape 2"}', '{"fr":"Texte offert"}'),
      (e3, x_auto, 2, 'etape', false, '{"fr":"Étape 3"}', '{"fr":"Texte PAYANT"}');
    insert into public.etapes_codes (etape_id, code) values (e3, 'SECRET-123');

    insert into public.seances (id, experience_id, debut, langue, point_rdv, point_rdv_precis, statut) values
      (s_a, x_a, now() + interval '10 days', 'fr', 'Square', 'Adresse exacte', 'publiee'),
      (s_a_brouillon, x_a, now() + interval '20 days', 'fr', 'Square', null, 'brouillon'),
      (s_b, x_b, now() + interval '10 days', 'fr', 'Atelier', 'Adresse exacte', 'publiee');

    -- Séance de A (10 places) : 2 confirmées + 1 bloquée en cours + 3 dont le blocage est dépassé.
    insert into public.reservations (id, seance_id, experience_id, nom, email, telephone, personnes, statut,
        bloque_jusqua, prix_unitaire_centimes, total_centimes, paye_en_ligne_centimes,
        reste_sur_place_centimes, cgv_acceptees_le) values
      (gen_random_uuid(), s_a, x_a, 'Camille Durand', 'camille@exemple.invalid', '0600000001', 2, 'confirmee', null, 5000, 10000, 1000, 9000, now()),
      (r_bloquee, s_a, x_a, 'Thomas Bernard', 'thomas@exemple.invalid', '0600000002', 1, 'en_attente', now() + interval '10 minutes', 5000, 5000, 500, 4500, now()),
      (gen_random_uuid(), s_a, x_a, 'Paul Vieux', 'paul@exemple.invalid', '0600000003', 3, 'en_attente', now() - interval '1 hour', 5000, 15000, 1500, 13500, now()),
      (gen_random_uuid(), s_b, x_b, 'Ana Martin', 'ana@exemple.invalid', '0700000004', 1, 'confirmee', null, 4500, 4500, 500, 4000, now());

    -- Cycle de réservation : séances proches, loin, passée ; réservations avec carte enregistrée.
    insert into public.seances (id, experience_id, debut, langue, point_rdv, point_rdv_precis, statut, participants_min) values
      (s_loin,   x_a, now() + interval '5 days',  'fr', 'Square', 'Devant le kiosque', 'publiee', 4),
      (s_tot,    x_a, now() + interval '20 hours', 'fr', 'Square', 'Devant le kiosque', 'publiee', 1),
      (s_min,    x_a, now() + interval '40 hours', 'fr', 'Square', 'Devant le kiosque', 'publiee', 4),
      (s_passee, x_a, now() - interval '2 hours',  'fr', 'Square', 'Devant le kiosque', 'publiee', 1),
      (s_rappel, x_a, now() + interval '44 hours', 'fr', 'Square', 'Devant le kiosque', 'publiee', 1);
    insert into public.reservations (id, seance_id, experience_id, nom, email, telephone, personnes, statut,
        prix_unitaire_centimes, total_centimes, paye_en_ligne_centimes, reste_sur_place_centimes, cgv_acceptees_le,
        accord_frais_le, stripe_customer, stripe_payment_method, confirmee_le) values
      (r_loin,     s_loin,   x_a, 'Lou Loin',    'lou@exemple.invalid',    '06', 1, 'confirmee', 5000, 5000, 500, 4500, now(), now(), 'cus_l', 'pm_l', now()),
      (r_tot,      s_tot,    x_a, 'Tom Tard',    'tom@exemple.invalid',    '06', 2, 'confirmee', 5000, 10000, 1000, 9000, now(), now(), 'cus_t', 'pm_t', now()),
      (r_tot_sans, s_tot,    x_a, 'Sam Sanscarte', 'sam@exemple.invalid',  '06', 1, 'confirmee', 5000, 5000, 500, 4500, now(), null, null, null, now()),
      (r_min,      s_min,    x_a, 'Mia Minimum', 'mia@exemple.invalid',    '06', 1, 'confirmee', 5000, 5000, 500, 4500, now(), now(), 'cus_m', 'pm_m', now()),
      (r_passee,   s_passee, x_a, 'Abel Absent', 'abel@exemple.invalid',   '06', 1, 'confirmee', 5000, 5000, 500, 4500, now(), now(), 'cus_a', 'pm_a', now() - interval '3 days'),
      (r_rappel,   s_rappel, x_a, 'Rémi Rappel', 'remi@exemple.invalid',   '06', 1, 'confirmee', 5000, 5000, 500, 4500, now(), now(), 'cus_r', 'pm_r', now() - interval '3 days');
    insert into public.paiements (reservation_id, experience_id, experience_type, localite_id, intervenant_id,
        montant_centimes, stripe_payment_intent) values
      (r_min, x_a, 'visite_guidee', 'montmartre', i_a, 500, 'pi_mia'),
      (r_loin, x_a, 'visite_guidee', 'montmartre', i_a, 500, 'pi_lou');
    insert into public.reservations_liens (jeton_hash, reservation_id) values
      (interne.sha256('jeton-loin'), r_loin), (interne.sha256('jeton-tot'), r_tot),
      (interne.sha256('jeton-tot-sans'), r_tot_sans);
    insert into public.intervenants_contacts (intervenant_id, email) values
      (i_a, 'guide-a@exemple.invalid'), (i_b, 'guide-b@exemple.invalid');

    insert into public.propositions (id, intervenant_id, type, donnees) values
      (p_a, i_a, 'fiche', '{"nom":"Intervenant A corrigé","publie":false,"ordre":999}');
    insert into public.codes_import (code_hash, expire_le) values (repeat('7', 64), now() + interval '30 minutes');
    insert into public.demandes_groupes (localite_id, type, nom, email) values
      ('montmartre', 'visite', 'Groupe test', 'groupe@exemple.invalid');

    v_etape := 'essais';

    -- ---------- VISITEUR (clé publiable, sans compte) ----------
    res := res || jsonb_build_array(
      jsonb_build_array('Visiteur', 'lit les expériences publiées (4 sur 5)', '4',
        pg_temp.essai('anon', null, format('select 1 from public.experiences where slug like %L', 'test-%'))),
      jsonb_build_array('Visiteur', 'ne voit pas l''expérience non publiée', 'refus',
        pg_temp.essai('anon', null, format('select 1 from public.experiences where id = %L', x_cache))),
      jsonb_build_array('Visiteur', 'lit seulement les 2 étapes offertes sur 3', '2',
        pg_temp.essai('anon', null, format('select 1 from public.etapes where experience_id = %L', x_auto))),
      jsonb_build_array('Visiteur', 'ne lit pas les codes de déblocage', 'refus',
        pg_temp.essai('anon', null, 'select 1 from public.etapes_codes')),
      jsonb_build_array('Visiteur', 'ne lit pas la table des séances (adresse exacte)', 'refus',
        pg_temp.essai('anon', null, 'select 1 from public.seances')),
      jsonb_build_array('Visiteur', 'voit la jauge : 7 places restantes, 2 inscrits', '1',
        pg_temp.essai('anon', null, format('select 1 from public.seances_publiques where id = %L and places_restantes = 7 and inscrits = 2 and not confirmee', s_a))),
      jsonb_build_array('Visiteur', 'ne voit pas la séance en brouillon', 'refus',
        pg_temp.essai('anon', null, format('select 1 from public.seances_publiques where id = %L', s_a_brouillon))),
      jsonb_build_array('Visiteur', 'ne lit pas les réservations', 'refus',
        pg_temp.essai('anon', null, 'select 1 from public.reservations')),
      jsonb_build_array('Visiteur', 'ne lit pas la liste des inscrits', 'refus',
        pg_temp.essai('anon', null, 'select 1 from public.mes_inscrits')),
      jsonb_build_array('Visiteur', 'ne crée pas de réservation directement', 'refus',
        pg_temp.essai('anon', null, format('insert into public.reservations (seance_id, experience_id, nom, email, personnes, statut, prix_unitaire_centimes, total_centimes, paye_en_ligne_centimes, reste_sur_place_centimes, cgv_acceptees_le) values (%L, %L, %L, %L, 1, %L, 0, 0, 0, 0, now())', s_a, x_a, 'Pirate', 'pirate@exemple.invalid', 'confirmee'))),
      jsonb_build_array('Visiteur', 'n''appelle pas la fonction de réservation', 'refus',
        pg_temp.essai('anon', null, format('select public.reserver_places(%L, 1, %L, %L, %L, %L, ''{"cgv":true,"non_remboursable":true,"sans_retractation":true,"prelevement":true}'', ''2026-11-18'')', s_a, 'Pirate', 'pirate@exemple.invalid', '0600000000', 'fr'))),
      jsonb_build_array('Visiteur', 'ne confirme pas une réservation sans payer', 'refus',
        pg_temp.essai('anon', null, format('select public.confirmer_reservation(%L, %L, %L, 500)', r_bloquee, 'cs_faux', 'pi_faux'))),
      jsonb_build_array('Visiteur', 'ne s''offre pas un accès au circuit', 'refus',
        pg_temp.essai('anon', null, format('select public.activer_acces(%L, %L, %L, 0)', gen_random_uuid(), 'cs_faux', 'pi_faux'))),
      jsonb_build_array('Visiteur', 'ne lit pas les accès, paiements, demandes', 'refus',
        pg_temp.essai('anon', null, 'select 1 from public.acces union all select 1 from public.paiements union all select 1 from public.demandes_groupes')),
      jsonb_build_array('Visiteur', 'n''écrit pas de demande directement (passe par le serveur)', 'refus',
        pg_temp.essai('anon', null, format('insert into public.demandes_groupes (localite_id, type, nom, email) values (%L, %L, %L, %L)', 'montmartre', 'visite', 'Spam', 'spam@exemple.invalid'))),
      jsonb_build_array('Visiteur', 'ne lit pas les comptes', 'refus',
        pg_temp.essai('anon', null, 'select 1 from public.profils')),
      jsonb_build_array('Visiteur', 'ne change pas un prix', 'refus',
        pg_temp.essai('anon', null, format('update public.experiences set prix_centimes = 1 where id = %L', x_a))),
      jsonb_build_array('Visiteur', 'ne voit ni lieu ni intervenant non publié', 'refus',
        pg_temp.essai('anon', null, format('select 1 from public.lieux where id = %L union all select 1 from public.intervenants where id = %L', l_cache, i_cache))),
      jsonb_build_array('Visiteur', 'ne valide pas une proposition', 'refus',
        pg_temp.essai('anon', null, format('select public.valider_proposition(%L)', p_a)))
    );

    -- ---------- INTERVENANT A (connecté par lien magique) ----------
    res := res || jsonb_build_array(
      jsonb_build_array('Intervenant A', 'voit ses 7 séances, brouillon compris', '7',
        pg_temp.essai('authenticated', u_a, 'select 1 from public.seances')),
      jsonb_build_array('Intervenant A', 'ne voit pas la séance de B', 'refus',
        pg_temp.essai('authenticated', u_a, format('select 1 from public.seances where id = %L', s_b))),
      jsonb_build_array('Intervenant A', 'voit son inscrite confirmée, nom abrégé', '1',
        pg_temp.essai('authenticated', u_a, format('select 1 from public.mes_inscrits where nom = %L and telephone = %L', 'Camille D.', '0600000001'))),
      jsonb_build_array('Intervenant A', 'ne voit que ses inscrits (7 lignes, aucune de B)', '7',
        pg_temp.essai('authenticated', u_a, 'select 1 from public.mes_inscrits')),
      jsonb_build_array('Intervenant A', 'ne lit pas les réservations complètes (emails)', 'refus',
        pg_temp.essai('authenticated', u_a, 'select 1 from public.reservations')),
      jsonb_build_array('Intervenant A', 'ne lit ni paiements ni remboursements ni demandes', 'refus',
        pg_temp.essai('authenticated', u_a, 'select 1 from public.paiements union all select 1 from public.remboursements union all select 1 from public.demandes_groupes union all select 1 from public.acces')),
      jsonb_build_array('Intervenant A', 'crée un brouillon de séance sur sa visite', '1',
        pg_temp.essai('authenticated', u_a, format('insert into public.seances (experience_id, debut, langue, capacite_max, participants_min, statut) values (%L, now() + interval %L, %L, 6, 1, %L)', x_a, '30 days', 'en', 'brouillon'))),
      jsonb_build_array('Contrôle', 'le minimum choisi par l''intervenant (1) est gardé', '1',
        pg_temp.essai(null, null, format('select 1 from public.seances where experience_id = %L and capacite_max = 6 and participants_min = 1 and cree_par = %L and statut = %L', x_a, u_a, 'brouillon'))),
      jsonb_build_array('Intervenant A', 'ne publie pas une séance lui-même', 'refus',
        pg_temp.essai('authenticated', u_a, format('insert into public.seances (experience_id, debut, statut) values (%L, now() + interval %L, %L)', x_a, '31 days', 'publiee'))),
      jsonb_build_array('Intervenant A', 'ne passe pas son brouillon en ligne', 'refus',
        pg_temp.essai('authenticated', u_a, format('update public.seances set statut = %L where id = %L', 'publiee', s_a_brouillon))),
      jsonb_build_array('Intervenant A', 'ne dépasse pas la jauge de l''expérience', 'refus',
        pg_temp.essai('authenticated', u_a, format('update public.seances set capacite_max = 50 where id = %L', s_a_brouillon))),
      jsonb_build_array('Intervenant A', 'ne modifie pas directement une séance en ligne', 'refus',
        pg_temp.essai('authenticated', u_a, format('update public.seances set point_rdv = %L where id = %L', 'Ailleurs', s_a))),
      jsonb_build_array('Intervenant A', 'ne crée pas de séance sur l''atelier de B', 'refus',
        pg_temp.essai('authenticated', u_a, format('insert into public.seances (experience_id, debut, statut) values (%L, now() + interval %L, %L)', x_b, '30 days', 'brouillon'))),
      jsonb_build_array('Intervenant A', 'ne change pas son prix', 'refus',
        pg_temp.essai('authenticated', u_a, format('update public.experiences set prix_centimes = 9900, prereservation_centimes = 0 where id = %L', x_a))),
      jsonb_build_array('Intervenant A', 'ne modifie pas sa fiche sans validation', 'refus',
        pg_temp.essai('authenticated', u_a, format('update public.intervenants set nom = %L where id = %L', 'Sans validation', i_a))),
      jsonb_build_array('Intervenant A', 'ne change pas la visibilité d''un lieu', 'refus',
        pg_temp.essai('authenticated', u_a, format('update public.lieux set visibilite = %L where id = %L', 'adherent', l_pub))),
      jsonb_build_array('Intervenant A', 'dépose une proposition pour sa séance', '1',
        pg_temp.essai('authenticated', u_a, format('insert into public.propositions (intervenant_id, type, cible_id, donnees) values (%L, %L, %L, %L)', i_a, 'seance', s_a, '{"point_rdv":"Place des Abbesses","participants_min":3}'))),
      jsonb_build_array('Intervenant A', 'ne dépose pas de proposition au nom de B', 'refus',
        pg_temp.essai('authenticated', u_a, format('insert into public.propositions (intervenant_id, type, donnees) values (%L, %L, %L)', i_b, 'fiche', '{"nom":"Usurpé"}'))),
      jsonb_build_array('Intervenant A', 'ne propose pas de changer la séance de B', 'refus',
        pg_temp.essai('authenticated', u_a, format('insert into public.propositions (intervenant_id, type, cible_id, donnees) values (%L, %L, %L, %L)', i_a, 'seance', s_b, '{"point_rdv":"Chez moi"}'))),
      jsonb_build_array('Intervenant A', 'ne dépose pas une proposition déjà « validée »', 'refus',
        pg_temp.essai('authenticated', u_a, format('insert into public.propositions (intervenant_id, type, donnees, statut) values (%L, %L, %L, %L)', i_a, 'fiche', '{"nom":"X"}', 'validee'))),
      jsonb_build_array('Intervenant A', 'ne valide pas sa propre proposition', 'refus',
        pg_temp.essai('authenticated', u_a, format('select public.valider_proposition(%L)', p_a))),
      jsonb_build_array('Intervenant A', 'ne se nomme pas admin', 'refus',
        pg_temp.essai('authenticated', u_a, format('update public.profils set role = %L where user_id = %L', 'admin', u_a))),
      jsonb_build_array('Intervenant A', 'ne crée pas de compte admin', 'refus',
        pg_temp.essai('authenticated', u_a, format('insert into public.profils (user_id, role) values (%L, %L)', u_b, 'admin'))),
      jsonb_build_array('Intervenant A', 'ne lit pas le profil des autres', '1',
        pg_temp.essai('authenticated', u_a, 'select 1 from public.profils')),
      jsonb_build_array('Intervenant A', 'ne lance pas de remboursement', 'refus',
        pg_temp.essai('authenticated', u_a, format('insert into public.remboursements (paiement_id, montant_centimes, motif) values (%L, 500, %L)', gen_random_uuid(), 'geste_admin'))),
      jsonb_build_array('Intervenant A', 'ne lit pas les codes de déblocage', 'refus',
        pg_temp.essai('authenticated', u_a, 'select 1 from public.etapes_codes')),
      jsonb_build_array('Intervenant A', 'n''appelle pas les fonctions de paiement', 'refus',
        pg_temp.essai('authenticated', u_a, format('select public.confirmer_reservation(%L, %L, %L, 500)', r_bloquee, 'cs_faux', 'pi_faux'))),
      jsonb_build_array('Intervenant B', 'ne voit que son inscrite, pas celles de A', '1',
        pg_temp.essai('authenticated', u_b, 'select 1 from public.mes_inscrits')),
      jsonb_build_array('Intervenant B', 'ne voit pas les propositions de A', 'refus',
        pg_temp.essai('authenticated', u_b, 'select 1 from public.propositions'))
    );

    -- ---------- INTERVENANT A gère ses visites lui-même ----------
    res := res || jsonb_build_array(
      jsonb_build_array('Intervenant A', 'modifie image, description, durée, langues, point de départ de sa visite', '1',
        pg_temp.essai('authenticated', u_a, format('update public.experiences set photo_url = %L, description = %L, duree_minutes = 150, langues = %L, point_rdv = %L, point_rdv_lat = 48.884, point_rdv_lng = 2.332 where id = %L', 'https://exemple.invalid/photo.jpg', '{"fr":"Nouvelle description"}', '{fr,en}', '{"fr":"Place Blanche"}', x_a))),
      jsonb_build_array('Contrôle', 'changements gardés, traductions à relire', '1',
        pg_temp.essai(null, null, format('select 1 from public.experiences where id = %L and duree_minutes = 150 and point_rdv->>%L = %L and langues_relues = %L and publie and prix_centimes = 5000', x_a, 'fr', 'Place Blanche', '{fr}'))),
      jsonb_build_array('Contrôle', 'le changement est noté au journal', '1',
        pg_temp.essai(null, null, format('select 1 from public.journal_admin where acteur = %L and action = %L and details ? %L', u_a, 'visite_modifiee', 'point_rdv'))),
      jsonb_build_array('Intervenant A', 'change sa jauge : minimum 3, maximum 12', '1',
        pg_temp.essai('authenticated', u_a, format('update public.experiences set participants_min = 3, capacite_max = 12 where id = %L', x_a))),
      jsonb_build_array('Intervenant A', 'ne met pas un minimum plus grand que le maximum', 'refus',
        pg_temp.essai('authenticated', u_a, format('update public.experiences set participants_min = 15 where id = %L', x_a))),
      jsonb_build_array('Intervenant A', 'ne change pas le titre d''une visite en ligne', 'refus',
        pg_temp.essai('authenticated', u_a, format('update public.experiences set titre = %L where id = %L', '{"fr":"Autre titre"}', x_a))),
      jsonb_build_array('Intervenant A', 'ne retire pas sa visite de la publication', 'refus',
        pg_temp.essai('authenticated', u_a, format('update public.experiences set publie = false where id = %L', x_a))),
      jsonb_build_array('Intervenant A', 'ne change pas la pré-réservation', 'refus',
        pg_temp.essai('authenticated', u_a, format('update public.experiences set prereservation_centimes = 0 where id = %L', x_a))),
      jsonb_build_array('Intervenant A', 'ne modifie pas l''atelier de B', 'refus',
        pg_temp.essai('authenticated', u_a, format('update public.experiences set description = %L where id = %L', '{"fr":"Piraté"}', x_b))),
      jsonb_build_array('Intervenant B', 'ne modifie pas la visite de A', 'refus',
        pg_temp.essai('authenticated', u_b, format('update public.experiences set capacite_max = 99 where id = %L', x_a))),
      jsonb_build_array('Intervenant A', 'propose une nouvelle visite (en essayant de la publier à 1 €)', '1',
        pg_temp.essai('authenticated', u_a, format('insert into public.experiences (type, titre, publie, prix_centimes, intervenant_id) values (%L, %L, true, 100, %L)', 'visite_guidee', '{"fr":"Montmartre la nuit"}', i_b))),
      jsonb_build_array('Contrôle', 'proposition à son nom, non publiée, à valider, sans prix', '1',
        pg_temp.essai(null, null, format('select 1 from public.experiences where titre->>%L = %L and intervenant_id = %L and not publie and a_valider and prix_centimes is null and prereservation_centimes = 500 and participants_min >= 1 and slug like %L', 'fr', 'Montmartre la nuit', i_a, 'montmartre-la-nuit-%'))),
      jsonb_build_array('Visiteur', 'ne voit pas la visite proposée', 'refus',
        pg_temp.essai('anon', null, format('select 1 from public.experiences where titre->>%L = %L', 'fr', 'Montmartre la nuit'))),
      jsonb_build_array('Intervenant A', 'corrige le titre de sa proposition', '1',
        pg_temp.essai('authenticated', u_a, format('update public.experiences set titre = %L where titre->>%L = %L', '{"fr":"Montmartre by night"}', 'fr', 'Montmartre la nuit'))),
      jsonb_build_array('Intervenant A', 'ne publie pas sa proposition lui-même', 'refus',
        pg_temp.essai('authenticated', u_a, format('update public.experiences set publie = true, a_valider = false where titre->>%L = %L', 'fr', 'Montmartre by night'))),
      jsonb_build_array('Intervenant A', 'ne propose pas d''escape game', 'refus',
        pg_temp.essai('authenticated', u_a, format('insert into public.experiences (type, titre) values (%L, %L)', 'escape_game', '{"fr":"Mon escape"}'))),
      jsonb_build_array('Admin', 'fixe le prix et publie la visite proposée', '1',
        pg_temp.essai('authenticated', u_admin, format('update public.experiences set prix_centimes = 4000, capacite_max = 8, publie = true, a_valider = false where titre->>%L = %L', 'fr', 'Montmartre by night'))),
      jsonb_build_array('Visiteur', 'voit maintenant la visite validée', '1',
        pg_temp.essai('anon', null, format('select 1 from public.experiences where titre->>%L = %L', 'fr', 'Montmartre by night')))
    );

    -- ---------- ADMIN ----------
    res := res || jsonb_build_array(
      jsonb_build_array('Admin', 'lit toutes les réservations (10)', '10',
        pg_temp.essai('authenticated', u_admin, 'select 1 from public.reservations')),
      jsonb_build_array('Admin', 'voit l''expérience non publiée', '1',
        pg_temp.essai('authenticated', u_admin, format('select 1 from public.experiences where id = %L', x_cache))),
      jsonb_build_array('Admin', 'change un prix', '1',
        pg_temp.essai('authenticated', u_admin, format('update public.experiences set prix_centimes = 5500 where id = %L', x_b))),
      jsonb_build_array('Admin', 'publie le brouillon de séance', '1',
        pg_temp.essai('authenticated', u_admin, format('update public.seances set statut = %L where id = %L', 'publiee', s_a_brouillon))),
      jsonb_build_array('Admin', 'lit les demandes privées', '1',
        pg_temp.essai('authenticated', u_admin, 'select 1 from public.demandes_groupes')),
      jsonb_build_array('Admin', 'valide la proposition de fiche de A', '1',
        pg_temp.essai('authenticated', u_admin, format('select public.valider_proposition(%L)', p_a))),
      jsonb_build_array('Contrôle', 'seul le nom a changé (publie et ordre ignorés)', '1',
        pg_temp.essai(null, null, format('select 1 from public.intervenants where id = %L and nom = %L and publie and ordre = 0', i_a, 'Intervenant A corrigé'))),
      jsonb_build_array('Admin', 'valide le changement de lieu de rendez-vous', '1',
        pg_temp.essai('authenticated', u_admin, format('select 1 from (select public.valider_proposition(id) as r from public.propositions where cible_id = %L) x where (r->>%L)::int = 2', s_a, 'inscrits_a_prevenir'))),
      jsonb_build_array('Contrôle', 'lieu et minimum (3) changés', '1',
        pg_temp.essai(null, null, format('select 1 from public.seances where id = %L and point_rdv = %L and participants_min = 3', s_a, 'Place des Abbesses'))),
      jsonb_build_array('Contrôle', 'les 2 validations sont dans le journal', '2',
        pg_temp.essai(null, null, format('select 1 from public.journal_admin where acteur = %L', u_admin)))
    );

    -- ---------- SERVEUR (fonctions Netlify, clé secrète) ----------
    res := res || jsonb_build_array(
      jsonb_build_array('Serveur', 'refuse une réservation sans téléphone (visite)', 'refus',
        pg_temp.essai('service_role', null, format('select public.reserver_places(%L, 1, %L, %L, null, %L, ''{"cgv":true,"non_remboursable":true,"sans_retractation":true,"prelevement":true}'', ''2026-11-18'')', s_a, 'Sans Tel', 'sanstel@exemple.invalid', 'fr'))),
      jsonb_build_array('Serveur', 'refuse une visite sans accord pour les frais d''annulation tardive', 'refus',
        pg_temp.essai('service_role', null, format('select public.reserver_places(%L, 1, %L, %L, %L, %L, ''{"cgv":true,"non_remboursable":true,"sans_retractation":true}'', ''2026-11-18'')', s_a, 'Sans Accord', 'accord@exemple.invalid', '0611111111', 'fr'))),
      jsonb_build_array('Serveur', 'refuse sans la case « pré-réservation non remboursable »', 'refus',
        pg_temp.essai('service_role', null, format('select public.reserver_places(%L, 1, %L, %L, %L, %L, ''{"cgv":true,"sans_retractation":true,"prelevement":true}'', ''2026-11-18'')', s_a, 'Sans Case', 'case@exemple.invalid', '0611111111', 'fr'))),
      jsonb_build_array('Serveur', 'refuse sans version des CGV', 'refus',
        pg_temp.essai('service_role', null, format('select public.reserver_places(%L, 1, %L, %L, %L, %L, ''{"cgv":true,"non_remboursable":true,"sans_retractation":true,"prelevement":true}'', null)', s_a, 'Sans Version', 'version@exemple.invalid', '0611111111', 'fr'))),
      jsonb_build_array('Serveur', 'refuse sans acceptation des CGV', 'refus',
        pg_temp.essai('service_role', null, format('select public.reserver_places(%L, 1, %L, %L, %L, %L, ''{"non_remboursable":true,"sans_retractation":true,"prelevement":true}'', ''2026-11-18'')', s_a, 'Sans Cgv', 'cgv@exemple.invalid', '0611111111', 'fr'))),
      jsonb_build_array('Serveur', 'refuse 8 places quand il en reste 7', 'refus',
        pg_temp.essai('service_role', null, format('select public.reserver_places(%L, 8, %L, %L, %L, %L, ''{"cgv":true,"non_remboursable":true,"sans_retractation":true,"prelevement":true}'', ''2026-11-18'')', s_a, 'Trop Nombreux', 'trop@exemple.invalid', '0611111111', 'fr'))),
      jsonb_build_array('Serveur', 'bloque les 7 dernières places : 35 € en ligne, 315 € sur place', '1',
        pg_temp.essai('service_role', null, format('select 1 from (select public.reserver_places(%L, 7, %L, %L, %L, %L, ''{"cgv":true,"non_remboursable":true,"sans_retractation":true,"prelevement":true}'', ''2026-11-18'') as r) x where (r->>%L)::int = 3500 and (r->>%L)::int = 31500', s_a, 'Grande Famille', 'Famille@Exemple.invalid', '0611111111', 'fr', 'a_payer_centimes', 'reste_sur_place_centimes'))),
      jsonb_build_array('Serveur', 'refuse une place de plus : complet', 'refus',
        pg_temp.essai('service_role', null, format('select public.reserver_places(%L, 1, %L, %L, %L, %L, ''{"cgv":true,"non_remboursable":true,"sans_retractation":true,"prelevement":true}'', ''2026-11-18'')', s_a, 'Dernier Arrivé', 'dernier@exemple.invalid', '0611111111', 'fr'))),
      jsonb_build_array('Visiteur', 'voit maintenant 0 place restante', '1',
        pg_temp.essai('anon', null, format('select 1 from public.seances_publiques where id = %L and places_restantes = 0', s_a))),
      jsonb_build_array('Serveur', 'refuse de confirmer avec un montant faux', 'refus',
        pg_temp.essai('service_role', null, format('select public.confirmer_reservation(%L, %L, %L, 100)', r_bloquee, 'cs_test_1', 'pi_test_1'))),
      jsonb_build_array('Serveur', 'confirme la réservation payée', '1',
        pg_temp.essai('service_role', null, format('select 1 from (select public.confirmer_reservation(%L, %L, %L, 500) as r) x where r->>%L = %L', r_bloquee, 'cs_test_1', 'pi_test_1', 'statut', 'confirmee'))),
      jsonb_build_array('Serveur', 'un second appel du webhook ne change rien', '1',
        pg_temp.essai('service_role', null, format('select 1 from (select public.confirmer_reservation(%L, %L, %L, 500) as r) x where (r->>%L)::boolean', r_bloquee, 'cs_test_1', 'pi_test_1', 'deja_traitee'))),
      jsonb_build_array('Contrôle', 'un seul paiement enregistré, 5 €', '1',
        pg_temp.essai(null, null, format('select 1 from public.paiements where reservation_id = %L and montant_centimes = 500', r_bloquee))),
      jsonb_build_array('Serveur', 'refuse un prix libre sous 5 €', 'refus',
        pg_temp.essai('service_role', null, format('select public.creer_acces(%L, %L, %L, 400, false, null, %L, true)', x_auto, 'radin@exemple.invalid', repeat('a', 64), 'fr'))),
      jsonb_build_array('Serveur', 'circuit 5 € + audioguide 4 € = 9 €', '1',
        pg_temp.essai('service_role', null, format('select 1 from (select public.creer_acces(%L, %L, %L, 500, true, null, %L, true) as r) x where (r->>%L)::int = 900', x_auto, 'client@exemple.invalid', repeat('b', 64), 'fr', 'a_payer_centimes'))),
      jsonb_build_array('Serveur', 'escape game : 11 € par équipe, quel que soit le montant envoyé', '1',
        pg_temp.essai('service_role', null, format('select 1 from (select public.creer_acces(%L, %L, %L, 1, false, %L, %L, true) as r) x where (r->>%L)::int = 1100', x_escape, 'equipe@exemple.invalid', repeat('c', 64), 'Les Fantômes', 'fr', 'a_payer_centimes'))),
      jsonb_build_array('Serveur', 'libère le blocage dépassé (1 réservation)', '1',
        pg_temp.essai('service_role', null, 'select 1 from (select public.liberer_reservations_expirees() as n) x where n = 1'))
    );

    -- ---------- ADHÉSIONS ET CARTES DE MEMBRE ----------
    res := res || jsonb_build_array(
      jsonb_build_array('Serveur', 'enregistre une adhésion annuelle (abonnement Stripe)', '1',
        pg_temp.essai('service_role', null, format('select public.enregistrer_adhesion_abonnement(%L, %L, %L, %L, %L, now() - interval %L, now() + interval %L, %L)', 'sub_test_1', 'cus_test_1', 'Membre@Exemple.invalid', 'Camille Membre', 'adhesion', '10 days', '355 days', 'active'))),
      jsonb_build_array('Serveur', 'le renouvellement prolonge la même adhésion (pas de doublon)', '1',
        pg_temp.essai('service_role', null, format('select 1 from (select public.enregistrer_adhesion_abonnement(%L, %L, %L, null, %L, now(), now() + interval %L, %L) as r) x where (select count(*) from public.adhesions where stripe_subscription = %L) = 1 and (r->>%L)::timestamptz > now() + interval %L', 'sub_test_1', 'cus_test_1', 'membre@exemple.invalid', 'adhesion', '720 days', 'active', 'sub_test_1', 'valide_jusqua', '700 days'))),
      jsonb_build_array('Serveur', 'enregistre un paiement ponctuel, reçu deux fois', '2',
        pg_temp.essai('service_role', null, format('select public.enregistrer_adhesion_ponctuelle(%L, null, %L, %L, %L, now()) union all select public.enregistrer_adhesion_ponctuelle(%L, null, %L, %L, %L, now())', 'pi_adh_1', 'ponctuel@exemple.invalid', 'Paul Ponctuel', 'adhesion', 'pi_adh_1', 'ponctuel@exemple.invalid', 'Paul Ponctuel', 'adhesion'))),
      jsonb_build_array('Contrôle', 'une seule adhésion ponctuelle, valable un an', '1',
        pg_temp.essai(null, null, format('select 1 from public.adhesions where stripe_payment_intent = %L and valide_jusqua > now() + interval %L', 'pi_adh_1', '364 days'))),
      jsonb_build_array('Serveur', 'refuse un lien de carte pour un email non adhérent', '1',
        pg_temp.essai('service_role', null, format('select 1 from (select public.carte_creer_lien(%L, %L, %L) as r) x where r = %L', 'inconnu@exemple.invalid', repeat('e', 64), 'email', 'inconnu'))),
      jsonb_build_array('Serveur', 'crée le lien de carte d''un adhérent', '1',
        pg_temp.essai('service_role', null, format('select 1 from (select public.carte_creer_lien(%L, %L, %L) as r) x where r = %L', 'membre@exemple.invalid', repeat('d', 64), 'paiement', 'cree'))),
      jsonb_build_array('Serveur', 'montre la carte : nom, valable', '1',
        pg_temp.essai('service_role', null, format('select 1 from (select public.carte_par_jeton(%L) as c) x where c->>%L = %L and (c->>%L)::boolean', repeat('d', 64), 'nom', 'Camille Membre', 'valide'))),
      jsonb_build_array('Serveur', 'un jeton inconnu ne montre rien', '1',
        pg_temp.essai('service_role', null, format('select 1 from (select public.carte_par_jeton(%L) as c) x where c is null', repeat('f', 64)))),
      jsonb_build_array('Serveur', 'au-delà de 3 demandes par heure, plus d''email', '1',
        pg_temp.essai('service_role', null, format('select 1 from (select public.carte_creer_lien(%L, repeat(%L, 64), %L) a, public.carte_creer_lien(%L, repeat(%L, 64), %L) b, public.carte_creer_lien(%L, repeat(%L, 64), %L) c, public.carte_creer_lien(%L, repeat(%L, 64), %L) d) x where c = %L and d = %L', 'membre@exemple.invalid', '1', 'email', 'membre@exemple.invalid', '2', 'email', 'membre@exemple.invalid', '3', 'email', 'membre@exemple.invalid', '4', 'email', 'cree', 'trop_de_demandes'))),
      jsonb_build_array('Serveur', 'arrête l''abonnement', '1',
        pg_temp.essai('service_role', null, format('select public.enregistrer_adhesion_abonnement(%L, null, null, null, null, null, null, %L)', 'sub_test_1', 'arretee'))),
      jsonb_build_array('Contrôle', 'abonnement arrêté : carte valable jusqu''à la date payée', '1',
        pg_temp.essai(null, null, format('select 1 from public.adhesions where stripe_subscription = %L and statut = %L and valide_jusqua > now() + interval %L', 'sub_test_1', 'arretee', '700 days'))),
      jsonb_build_array('Serveur', 'note le remboursement du paiement ponctuel', '1',
        pg_temp.essai('service_role', null, format('select 1 from (select public.adhesion_remboursee(%L) as n) x where n = 1', 'pi_adh_1'))),
      jsonb_build_array('Serveur', 'paiement remboursé : plus de carte', '1',
        pg_temp.essai('service_role', null, format('select 1 from (select public.carte_creer_lien(%L, %L, %L) as l) x where l = %L', 'ponctuel@exemple.invalid', repeat('9', 64), 'admin', 'inconnu'))),
      jsonb_build_array('Serveur', 'enregistre un bienfaiteur (mensuel) et son lien de carte', '1',
        pg_temp.essai('service_role', null, format('select 1 from (select public.enregistrer_adhesion_abonnement(%L, null, %L, %L, %L, now(), now() + interval %L, %L)) x', 'sub_test_2', 'bienfaiteur@exemple.invalid', 'Bea Bienfaitrice', 'bienfaiteur', '30 days', 'active'))),
      jsonb_build_array('Serveur', 'crée le lien de carte du bienfaiteur', '1',
        pg_temp.essai('service_role', null, format('select 1 from (select public.carte_creer_lien(%L, %L, %L) as l) x where l = %L', 'bienfaiteur@exemple.invalid', repeat('8', 64), 'admin', 'cree'))),
      jsonb_build_array('Serveur', 'bienfaiteur : la carte l''indique', '1',
        pg_temp.essai('service_role', null, format('select 1 from (select public.carte_par_jeton(%L) as c) x where c->>%L = %L', repeat('8', 64), 'formule', 'bienfaiteur'))),
      jsonb_build_array('Visiteur', 'ne lit pas les adhésions ni les liens de carte', 'refus',
        pg_temp.essai('anon', null, 'select 1 from public.adhesions union all select 1 from public.cartes_liens')),
      jsonb_build_array('Visiteur', 'ne lit pas une carte directement', 'refus',
        pg_temp.essai('anon', null, format('select public.carte_par_jeton(%L)', repeat('d', 64)))),
      jsonb_build_array('Visiteur', 'ne crée pas de code d''import', 'refus',
        pg_temp.essai('anon', null, 'select public.code_import_creer()')),
      jsonb_build_array('Intervenant A', 'ne lit pas les adhésions', 'refus',
        pg_temp.essai('authenticated', u_a, 'select 1 from public.adhesions')),
      jsonb_build_array('Intervenant A', 'ne lit pas les liens de carte', 'refus',
        pg_temp.essai('authenticated', u_a, 'select 1 from public.cartes_liens')),
      jsonb_build_array('Intervenant A', 'n''ajoute pas d''adhésion', 'refus',
        pg_temp.essai('authenticated', u_a, format('select public.ajouter_adhesion_manuelle(%L, %L, current_date + 365)', 'faux@exemple.invalid', 'Faux'))),
      jsonb_build_array('Intervenant A', 'ne crée pas de code d''import', 'refus',
        pg_temp.essai('authenticated', u_a, 'select public.code_import_creer()')),
      jsonb_build_array('Intervenant A', 'ne s''enregistre pas comme adhérent', 'refus',
        pg_temp.essai('authenticated', u_a, format('select public.enregistrer_adhesion_ponctuelle(%L, null, %L, %L, %L, now())', 'pi_faux', 'faux@exemple.invalid', 'Faux', 'adhesion'))),
      jsonb_build_array('Admin', 'lit les adhésions', '3',
        pg_temp.essai('authenticated', u_admin, format('select 1 from public.adhesions where email like %L', '%@exemple.invalid'))),
      jsonb_build_array('Admin', 'ajoute une adhésion payée en espèces', '1',
        pg_temp.essai('authenticated', u_admin, format('select public.ajouter_adhesion_manuelle(%L, %L, current_date + 365, %L, %L)', 'especes@exemple.invalid', 'Eva Espèces', 'adhesion', 'payé en espèces'))),
      jsonb_build_array('Admin', 'crée un code d''import', '1',
        pg_temp.essai('authenticated', u_admin, 'select public.code_import_creer()')),
      jsonb_build_array('Intervenant A', 'n''utilise pas un code d''import', 'refus',
        pg_temp.essai('authenticated', u_a, format('select public.code_import_utiliser(%L)', repeat('7', 64)))),
      jsonb_build_array('Serveur', 'un code d''import ne sert qu''une fois', '1',
        pg_temp.essai(null, null, format('select 1 from (select public.code_import_utiliser(%L) as a) x where a', repeat('7', 64)))),
      jsonb_build_array('Serveur', 'deuxième usage du même code refusé', '1',
        pg_temp.essai('service_role', null, format('select 1 from (select public.code_import_utiliser(%L) as a) x where not a', repeat('7', 64))))
    );

    -- ---------- CYCLE DE RÉSERVATION ----------
    res := res || jsonb_build_array(
      jsonb_build_array('Serveur', 'réserve avec accord pour les frais (carte gardée)', '1',
        pg_temp.essai('service_role', null, format('select 1 from (select public.reserver_places(%L, 2, %L, %L, %L, %L, ''{"cgv":true,"non_remboursable":true,"sans_retractation":true,"prelevement":true}'', ''2026-11-18'') as r) x where (r->>%L)::boolean and (r->>%L)::int = 2000', s_loin, 'Zoé Test', 'zoe@exemple.invalid', '0612345678', 'fr', 'garder_carte', 'frais_centimes'))),
      jsonb_build_array('Serveur', 'confirme le paiement (webhook) avec la carte enregistrée', '1',
        pg_temp.essai('service_role', null, 'select 1 from (select public.confirmer_reservation((select id from public.reservations where email = ''zoe@exemple.invalid''), ''cs_zoe'', ''pi_zoe'', 1000, ''cus_z'', ''pm_z'') as r) x where r->>''statut'' = ''confirmee''')),
      jsonb_build_array('Contrôle', 'cases cochées gardées avec leur heure, et la version des CGV', '1',
        pg_temp.essai(null, null, 'select 1 from public.reservations where email = ''zoe@exemple.invalid'' and cgv_version = ''2026-11-18'' and consentements ?& array[''cgv'', ''non_remboursable'', ''sans_retractation'', ''prelevement''] and not consentements ? ''photos''')),
      jsonb_build_array('Contrôle', 'réservation confirmée, carte gardée, lien créé', '1',
        pg_temp.essai(null, null, 'select 1 from public.reservations r where r.email = ''zoe@exemple.invalid'' and r.statut = ''confirmee'' and r.stripe_payment_method = ''pm_z'' and exists (select 1 from public.reservations_liens l where l.reservation_id = r.id)')),
      jsonb_build_array('Contrôle', 'emails en file : confirmation (avec lien) et alertes association et guide', '3',
        pg_temp.essai(null, null, 'select 1 from public.envois e join public.reservations r on r.id = e.reservation_id where r.email = ''zoe@exemple.invalid'' and ((e.type = ''confirmation'' and e.destinataire = r.email and e.donnees ? ''jeton'') or (e.type = ''alerte_inscription'' and e.destinataire in (''mouvementmontmartre@gmail.com'', ''guide-a@exemple.invalid'')))')),
      jsonb_build_array('Serveur', 'webhook reçu deux fois : rien de plus', '1',
        pg_temp.essai('service_role', null, 'select 1 from (select public.confirmer_reservation((select id from public.reservations where email = ''zoe@exemple.invalid''), ''cs_zoe'', ''pi_zoe'', 1000, ''cus_z'', ''pm_z'') as r) x where (r->>''deja_traitee'')::boolean')),
      jsonb_build_array('Contrôle', 'toujours 3 emails, un seul paiement', '1',
        pg_temp.essai(null, null, 'select 1 where (select count(*) from public.envois e join public.reservations r on r.id = e.reservation_id where r.email = ''zoe@exemple.invalid'') = 3 and (select count(*) from public.paiements where stripe_payment_intent = ''pi_zoe'') = 1')),
      jsonb_build_array('Serveur', 'écran de confirmation : lien depuis la session Stripe', '1',
        pg_temp.essai('service_role', null, 'select 1 from (select public.lien_reservation_session(''cs_zoe'') as l) x where length(l->>''jeton'') = 64')),
      jsonb_build_array('Serveur', 'le lien montre la réservation, sans email ni téléphone', '1',
        pg_temp.essai('service_role', null, 'select 1 from (select public.reservation_par_jeton(interne.sha256(''jeton-loin'')) as r) x where (r->>''peut_annuler'')::boolean and not (r->>''annulation_tardive'')::boolean and not r ? ''email'' and not r ? ''telephone'' and r->>''point_rdv_precis'' = ''Devant le kiosque''')),
      jsonb_build_array('Serveur', 'annulation plus de 24 h avant : pas de frais', '1',
        pg_temp.essai('service_role', null, 'select 1 from (select public.annuler_par_client(interne.sha256(''jeton-loin'')) as r) x where (r->>''frais_centimes'')::int = 0')),
      jsonb_build_array('Contrôle', 'place libérée, 5 € gardés (pas de remboursement), email client et 2 alertes', '1',
        pg_temp.essai(null, null, format('select 1 from public.reservations r where r.id = %L and r.statut = %L and r.frais_statut = %L and not exists (select 1 from public.remboursements rb join public.paiements p on p.id = rb.paiement_id where p.reservation_id = r.id) and (select count(*) from public.envois where reservation_id = r.id and type in (%L, %L)) = 3', r_loin, 'annulee', 'aucun', 'annulation_client', 'alerte_annulation'))),
      jsonb_build_array('Serveur', 'annulation sans frais : la carte est à retirer de Stripe', '1',
        pg_temp.essai('service_role', null, 'select 1 from (select public.cartes_a_retirer(100) as l) x where l @> ''[{"stripe_payment_method": "pm_l"}]''')),
      jsonb_build_array('Serveur', 'carte retirée : plus aucun frais possible', '1',
        pg_temp.essai('service_role', null, format('select public.carte_retiree(%L)', r_loin))),
      jsonb_build_array('Contrôle', 'carte effacée de la réservation, date du retrait gardée', '1',
        pg_temp.essai(null, null, format('select 1 from public.reservations where id = %L and stripe_payment_method is null and carte_retiree_le is not null', r_loin))),
      jsonb_build_array('Serveur', 'une carte encore utile (séance à venir) n''est pas retirée', '1',
        pg_temp.essai('service_role', null, 'select 1 from (select public.cartes_a_retirer(100) as l) x where not l @> ''[{"stripe_payment_method": "pm_r"}]''')),
      jsonb_build_array('Serveur', 'annuler deux fois ne change rien', '1',
        pg_temp.essai('service_role', null, 'select 1 from (select public.annuler_par_client(interne.sha256(''jeton-loin'')) as r) x where (r->>''deja_annulee'')::boolean')),
      jsonb_build_array('Serveur', 'annulation moins de 24 h avant : 10 € par personne (2 personnes)', '1',
        pg_temp.essai('service_role', null, 'select 1 from (select public.annuler_par_client(interne.sha256(''jeton-tot'')) as r) x where (r->>''frais_centimes'')::int = 2000')),
      jsonb_build_array('Contrôle', 'frais mis en file à prélever', '1',
        pg_temp.essai(null, null, format('select 1 from public.reservations where id = %L and frais_statut = %L and frais_centimes = 2000', r_tot, 'a_prelever'))),
      jsonb_build_array('Serveur', 'annulation tardive sans carte enregistrée : pas de frais', '1',
        pg_temp.essai('service_role', null, 'select 1 from (select public.annuler_par_client(interne.sha256(''jeton-tot-sans'')) as r) x where (r->>''frais_centimes'')::int = 0')),
      jsonb_build_array('Serveur', 'lien inconnu refusé', 'refus',
        pg_temp.essai('service_role', null, format('select public.annuler_par_client(%L)', repeat('0', 64)))),
      jsonb_build_array('Serveur', 'contrôle des minimums 48 h avant', '1',
        pg_temp.essai('service_role', null, 'select 1 from (select public.verifier_minimums() as r) x where (r->>''annulees'')::int >= 1')),
      jsonb_build_array('Contrôle', 'séance sous le minimum annulée, inscrite remboursée en file et prévenue', '1',
        pg_temp.essai(null, null, format('select 1 from public.seances s where s.id = %L and s.statut = %L and exists (select 1 from public.remboursements rb join public.paiements p on p.id = rb.paiement_id where p.reservation_id = %L and rb.statut = %L and rb.montant_centimes = 500) and exists (select 1 from public.envois where reservation_id = %L and type = %L)', s_min, 'annulee', r_min, 'a_faire', r_min, 'seance_annulee'))),
      jsonb_build_array('Contrôle', 'séance au minimum atteint : maintenue', '1',
        pg_temp.essai(null, null, format('select 1 from public.seances where id = %L and statut = %L and minimum_verifie_le is not null', s_rappel, 'publiee'))),
      jsonb_build_array('Serveur', 'rappels 48 h avant', '1',
        pg_temp.essai('service_role', null, 'select 1 from (select public.preparer_rappels() as n) x where n = 1')),
      jsonb_build_array('Contrôle', 'rappel en file avec son lien « Je ne peux plus venir »', '1',
        pg_temp.essai(null, null, format('select 1 from public.envois where reservation_id = %L and type = %L and donnees ? %L', r_rappel, 'rappel', 'jeton'))),
      jsonb_build_array('Serveur', 'pas de deuxième rappel', '1',
        pg_temp.essai('service_role', null, 'select 1 from (select public.preparer_rappels() as n) x where n = 0')),
      jsonb_build_array('Serveur', 'file des remboursements : le remboursement à faire est pris', '1',
        pg_temp.essai('service_role', null, 'select 1 from (select public.remboursements_a_traiter() as l) x where l @> ''[{"stripe_payment_intent": "pi_mia"}]''')),
      jsonb_build_array('Serveur', 'note le remboursement fait', '1',
        pg_temp.essai('service_role', null, format('select public.remboursement_resultat((select rb.id from public.remboursements rb join public.paiements p on p.id = rb.paiement_id where p.reservation_id = %L), true, %L)', r_min, 're_mia'))),
      jsonb_build_array('Contrôle', 'réservation remboursée, paiement marqué remboursé', '1',
        pg_temp.essai(null, null, format('select 1 from public.reservations r join public.paiements p on p.reservation_id = r.id where r.id = %L and r.statut = %L and p.statut = %L', r_min, 'remboursee', 'rembourse'))),
      jsonb_build_array('Serveur', 'file des remboursements vide ensuite (jamais deux fois)', '1',
        pg_temp.essai('service_role', null, 'select 1 from (select public.remboursements_a_traiter() as l) x where jsonb_array_length(l) = 0')),
      jsonb_build_array('Serveur', 'file des frais : 20 € à prélever sur la carte de Tom', '1',
        pg_temp.essai('service_role', null, 'select 1 from (select public.frais_a_traiter() as l) x where l @> ''[{"stripe_payment_method": "pm_t", "montant_centimes": 2000}]''')),
      jsonb_build_array('Serveur', 'note les frais prélevés', '1',
        pg_temp.essai('service_role', null, format('select public.frais_resultat(%L, %L, %L)', r_tot, 'preleve', 'pi_frais_tom'))),
      jsonb_build_array('Contrôle', 'frais prélevés et email de reçu en file', '1',
        pg_temp.essai(null, null, format('select 1 from public.reservations r where r.id = %L and r.frais_statut = %L and exists (select 1 from public.envois where reservation_id = r.id and type = %L)', r_tot, 'preleve', 'frais_preleves'))),
      jsonb_build_array('Serveur', 'file des emails : prise des emails à envoyer', '1',
        pg_temp.essai('service_role', null, 'select 1 from (select count(*) as n from public.envois_a_traiter(100)) x where n >= 8')),
      jsonb_build_array('Serveur', 'note l''envoi de la confirmation', '1',
        pg_temp.essai('service_role', null, 'select public.envoi_resultat((select id from public.envois where type = ''confirmation'' limit 1), true)')),
      jsonb_build_array('Contrôle', 'email envoyé : le lien personnel est effacé de la base', '1',
        pg_temp.essai(null, null, 'select 1 where exists (select 1 from public.envois where type = ''confirmation'' and statut = ''envoye'') and not exists (select 1 from public.envois where statut = ''envoye'' and donnees ? ''jeton'')')),
      jsonb_build_array('Intervenant A', 'signale l''absence d''un inscrit à sa séance passée (10 € de frais)', '1',
        pg_temp.essai('authenticated', u_a, format('select 1 from (select public.signaler_absence(%L) as r) x where (r->>%L)::int = 1000', r_passee, 'frais_centimes'))),
      jsonb_build_array('Intervenant B', 'ne signale pas d''absence sur la séance de A', 'refus',
        pg_temp.essai('authenticated', u_b, format('select public.signaler_absence(%L)', r_passee))),
      jsonb_build_array('Intervenant A', 'ne signale pas d''absence avant la séance', 'refus',
        pg_temp.essai('authenticated', u_a, format('select public.signaler_absence(%L)', r_rappel))),
      jsonb_build_array('Visiteur', 'ne signale pas d''absence', 'refus',
        pg_temp.essai('anon', null, format('select public.signaler_absence(%L)', r_passee))),
      jsonb_build_array('Intervenant A', 'n''annule pas une séance lui-même', 'refus',
        pg_temp.essai('authenticated', u_a, format('select public.annuler_seance(%L)', s_loin))),
      jsonb_build_array('Admin', 'annule une séance : l''inscrite est prévenue', '1',
        pg_temp.essai('authenticated', u_admin, format('select 1 from (select public.annuler_seance(%L, %L) as r) x where (r->>%L)::int = 1', s_loin, 'intervenant_empeche', 'inscrits'))),
      jsonb_build_array('Intervenant A', 'n''appelle pas la file des emails', 'refus',
        pg_temp.essai('authenticated', u_a, 'select * from public.envois_a_traiter(1)')),
      jsonb_build_array('Intervenant A', 'n''annule pas une réservation par lien', 'refus',
        pg_temp.essai('authenticated', u_a, format('select public.annuler_par_client(%L)', interne.sha256('jeton-tot')))),
      jsonb_build_array('Visiteur', 'ne lit pas une réservation par lien directement', 'refus',
        pg_temp.essai('anon', null, format('select 1 where public.reservation_par_jeton(%L) is not null', interne.sha256('jeton-tot')))),
      jsonb_build_array('Visiteur', 'ne lit ni les emails en file, ni les liens, ni les contacts', 'refus',
        pg_temp.essai('anon', null, 'select 1 from public.envois union all select 1 from public.reservations_liens union all select 1 from public.intervenants_contacts')),
      jsonb_build_array('Intervenant A', 'ne lit pas les emails en file ni les liens', 'refus',
        pg_temp.essai('authenticated', u_a, 'select 1 from public.envois union all select 1 from public.reservations_liens')),
      jsonb_build_array('Intervenant A', 'lit son contact privé, pas celui de B', '1',
        pg_temp.essai('authenticated', u_a, 'select 1 from public.intervenants_contacts')),
      jsonb_build_array('Intervenant A', 'met à jour son email de contact', '1',
        pg_temp.essai('authenticated', u_a, format('update public.intervenants_contacts set email = %L where intervenant_id = %L', 'nouveau-a@exemple.invalid', i_a))),
      jsonb_build_array('Intervenant A', 'ne modifie pas le contact de B', 'refus',
        pg_temp.essai('authenticated', u_a, format('update public.intervenants_contacts set email = %L where intervenant_id = %L', 'pirate@exemple.invalid', i_b))),
      jsonb_build_array('Intervenant A', 'ne change pas ses frais d''annulation', 'refus',
        pg_temp.essai('authenticated', u_a, format('update public.experiences set frais_annulation_tardive_centimes = 0 where id = %L', x_a))),
      jsonb_build_array('Admin', 'envoie une photo dans « photos »', '1',
        pg_temp.essai('authenticated', u_admin, 'insert into storage.objects (bucket_id, name) values (''photos'', ''essai/admin.jpg'')')),
      jsonb_build_array('Admin', 'remplace une photo', '1',
        pg_temp.essai('authenticated', u_admin, 'update storage.objects set metadata = ''{}'' where bucket_id = ''photos'' and name = ''essai/admin.jpg''')),
      jsonb_build_array('Intervenant A', 'envoie une photo dans son dossier', '1',
        pg_temp.essai('authenticated', u_a, format('insert into storage.objects (bucket_id, name) values (%L, %L)', 'photos', 'fiches/' || i_a || '/a.jpg'))),
      jsonb_build_array('Intervenant A', 'n''envoie pas de photo dans le dossier de B', 'refus',
        pg_temp.essai('authenticated', u_a, format('insert into storage.objects (bucket_id, name) values (%L, %L)', 'photos', 'intervenants/' || i_b || '/a.jpg'))),
      jsonb_build_array('Intervenant A', 'n''envoie pas de photo hors des dossiers prévus', 'refus',
        pg_temp.essai('authenticated', u_a, format('insert into storage.objects (bucket_id, name) values (%L, %L)', 'photos', 'essai/' || i_a || '/a.jpg'))),
      jsonb_build_array('Intervenant A', 'ne supprime pas une photo', 'refus',
        pg_temp.essai('authenticated', u_a, 'delete from storage.objects where bucket_id = ''photos''')),
      jsonb_build_array('Admin', 'envoie une vidéo', '1',
        pg_temp.essai('authenticated', u_admin, format('insert into storage.objects (bucket_id, name) values (%L, %L)', 'videos', 'intervenants/' || i_b || '/v.mp4'))),
      jsonb_build_array('Intervenant A', 'envoie une vidéo dans son dossier', '1',
        pg_temp.essai('authenticated', u_a, format('insert into storage.objects (bucket_id, name) values (%L, %L)', 'videos', 'intervenants/' || i_a || '/v.mp4'))),
      jsonb_build_array('Intervenant A', 'n''envoie pas de vidéo dans le dossier de B', 'refus',
        pg_temp.essai('authenticated', u_a, format('insert into storage.objects (bucket_id, name) values (%L, %L)', 'videos', 'intervenants/' || i_b || '/v.mp4'))),
      jsonb_build_array('Visiteur', 'n''envoie pas de vidéo', 'refus',
        pg_temp.essai('anon', null, format('insert into storage.objects (bucket_id, name) values (%L, %L)', 'videos', 'intervenants/' || i_a || '/v.mp4'))),
      jsonb_build_array('Visiteur', 'n''envoie pas de photo', 'refus',
        pg_temp.essai('anon', null, 'insert into storage.objects (bucket_id, name) values (''photos'', ''essai/v.jpg'')'))
    );

    raise exception 'FIN_DU_TEST';   -- annule toutes les fausses données
  exception when others then
    if sqlerrm <> 'FIN_DU_TEST' then
      res := res || jsonb_build_array(jsonb_build_array('Test', 'déroulement du test (' || v_etape || ')', 'sans erreur', 'ERREUR : ' || sqlerrm));
    end if;
  end;

  -- ---------- contrôles de structure (hors fausses données) ----------
  select count(*)::text into v from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity;
  res := res || jsonb_build_array(jsonb_build_array('Structure', 'tables sans sécurité par ligne', '0', v));

  select count(*)::text into v from information_schema.role_table_grants
   where table_schema = 'public' and grantee = 'anon'
     and not (privilege_type = 'SELECT' and table_name in
       ('localites', 'lieux', 'intervenants', 'experiences', 'etapes', 'seances_publiques'));
  res := res || jsonb_build_array(jsonb_build_array('Structure', 'droits du visiteur en dehors de la lecture du contenu', '0', v));

  select count(*)::text into v from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and has_function_privilege('anon', p.oid, 'execute');
  res := res || jsonb_build_array(jsonb_build_array('Structure', 'fonctions appelables par le visiteur', '0', v));

  select count(*)::text into v from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and has_function_privilege('authenticated', p.oid, 'execute')
     and p.proname not in ('valider_proposition', 'refuser_proposition', 'code_import_creer', 'ajouter_adhesion_manuelle', 'annuler_seance', 'signaler_absence');
  res := res || jsonb_build_array(jsonb_build_array('Structure', 'fonctions serveur appelables par un compte connecté', '0', v));

  begin
    execute 'select count(*)::text from cron.job where jobname like ''vlaa-%''' into v;
  exception when others then v := '0';
  end;
  res := res || jsonb_build_array(jsonb_build_array('Info', 'ménage automatique programmé (2 tâches)', '2', v));

  return res;
end $test$;

-- Le tableau de résultats (dernière instruction : c'est lui qui s'affiche).
with resultats_test as (
  select o::integer as n, e->>0 as qui, e->>1 as essai, e->>2 as attendu, e->>3 as obtenu,
         case
           when e->>0 = 'Info' then case when e->>3 = e->>2 then 'OK' else 'À VOIR' end
           when e->>2 = 'refus' and (e->>3 like 'REFUS%' or e->>3 = '0') then 'OK'
           when e->>2 = e->>3 then 'OK'
           else 'ÉCHEC'
         end as verdict
  from jsonb_array_elements(pg_temp.test_droits()) with ordinality as t(e, o)
)
select verdict, qui, essai, attendu, obtenu
from (
  select 0 as n,
         case when count(*) filter (where verdict = 'ÉCHEC') = 0 then 'TOUT EST OK' else 'À CORRIGER' end as verdict,
         'BILAN' as qui,
         count(*) filter (where verdict = 'OK') || ' essais réussis sur ' || count(*) filter (where verdict <> 'À VOIR')
           || ', ' || count(*) filter (where verdict = 'ÉCHEC') || ' en échec' as essai,
         '' as attendu, '' as obtenu
  from resultats_test
  union all
  select n, verdict, qui, essai, attendu, obtenu from resultats_test
) t
order by (n = 0) desc, (verdict = 'ÉCHEC') desc, (verdict = 'À VOIR') desc, n;
