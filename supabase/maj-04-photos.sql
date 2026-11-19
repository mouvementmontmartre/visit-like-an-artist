-- ============================================================
-- ARTDIVE : mise à jour n° 4 (photos)
--
-- Pour une base où schema.sql, maj-01, maj-02 et maj-03 sont DÉJÀ
-- installés. À coller en entier dans Supabase > SQL Editor, puis
-- « Run ». Tout passe ou rien ne passe. (Une base neuve n'en a pas
-- besoin.)
--
-- Crée le dossier « photos » où l'administration envoie les photos
-- des fiches et des intervenants depuis le téléphone. Ensuite :
-- relancer supabase/test-droits.sql.
-- ============================================================

begin;

do $$
begin
  if to_regclass('public.envois') is null then
    raise exception 'Installer d''abord maj-03-reservations.sql.';
  end if;
  if exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects'
             and policyname = 'artdive photos : admin envoie') then
    raise exception 'Cette mise à jour est déjà faite.';
  end if;
end $$;

-- Photos des fiches et des intervenants (stockage Supabase, dossier « photos »).
-- Lecture publique par leur adresse ; envoi, remplacement et suppression
-- réservés à l'admin (les intervenants viendront avec leur espace, 6.3).
-- 5 Mo au plus par photo, JPEG, PNG ou WebP (l'app les réduit avant l'envoi).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('photos', 'photos', true, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set public = true, file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create policy "artdive photos : admin liste" on storage.objects for select to authenticated
  using (bucket_id = 'photos' and (select interne.est_admin()));
create policy "artdive photos : admin envoie" on storage.objects for insert to authenticated
  with check (bucket_id = 'photos' and (select interne.est_admin()));
create policy "artdive photos : admin remplace" on storage.objects for update to authenticated
  using (bucket_id = 'photos' and (select interne.est_admin()))
  with check (bucket_id = 'photos' and (select interne.est_admin()));
create policy "artdive photos : admin supprime" on storage.objects for delete to authenticated
  using (bucket_id = 'photos' and (select interne.est_admin()));

commit;

select 'mise à jour n° 4 faite' as resultat;
