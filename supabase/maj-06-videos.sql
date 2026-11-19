-- ============================================================
-- ARTDIVE : mise à jour n° 6 (vidéos des intervenants)
--
-- Pour une base où maj-05 est DÉJÀ installée. À coller en entier dans
-- Supabase > SQL Editor, puis « Run ». Ensuite : relancer
-- supabase/test-droits.sql.
-- ============================================================

begin;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects'
                 and policyname = 'artdive photos : intervenant envoie dans son dossier') then
    raise exception 'Installer d''abord maj-05-photos-intervenants.sql.';
  end if;
  if exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects'
             and policyname = 'artdive videos : admin gère') then
    raise exception 'Cette mise à jour est déjà faite.';
  end if;
end $$;

-- Vidéos des intervenants (étape 6.5, facultatives) : dossier « videos » du stockage,
-- lecture publique, 50 Mo au plus (MP4, MOV, WebM ; sous-titres WebVTT).
-- Envoi par l'admin, ou par l'intervenant dans SON dossier videos/intervenants/<son id>/.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('videos', 'videos', true, 52428800, array['video/mp4', 'video/quicktime', 'video/webm', 'text/vtt'])
on conflict (id) do update set public = true, file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;
create policy "artdive videos : admin gère" on storage.objects for all to authenticated
  using (bucket_id = 'videos' and (select interne.est_admin()))
  with check (bucket_id = 'videos' and (select interne.est_admin()));
create policy "artdive videos : intervenant envoie dans son dossier" on storage.objects for insert to authenticated
  with check (bucket_id = 'videos'
              and split_part(name, '/', 1) = 'intervenants'
              and split_part(name, '/', 2) = (select interne.mon_intervenant_id())::text);

commit;

select 'mise à jour n° 6 faite' as resultat;
