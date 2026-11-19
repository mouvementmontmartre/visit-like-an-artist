-- ============================================================
-- ARTDIVE : mise à jour n° 5 (photos des intervenants)
--
-- Pour une base où maj-04 est DÉJÀ installée. À coller en entier dans
-- Supabase > SQL Editor, puis « Run ». Ensuite : relancer
-- supabase/test-droits.sql.
-- ============================================================

begin;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects'
                 and policyname = 'artdive photos : admin envoie') then
    raise exception 'Installer d''abord maj-04-photos.sql.';
  end if;
  if exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects'
             and policyname = 'artdive photos : intervenant envoie dans son dossier') then
    raise exception 'Cette mise à jour est déjà faite.';
  end if;
end $$;

-- Les intervenants envoient leurs photos (fiche, visites) dans LEUR dossier seulement :
-- photos/fiches/<leur id>/… et photos/intervenants/<leur id>/… (étape 6.3).
create policy "artdive photos : intervenant envoie dans son dossier" on storage.objects for insert to authenticated
  with check (bucket_id = 'photos'
              and split_part(name, '/', 1) in ('fiches', 'intervenants')
              and split_part(name, '/', 2) = (select interne.mon_intervenant_id())::text);

commit;

select 'mise à jour n° 5 faite' as resultat;
