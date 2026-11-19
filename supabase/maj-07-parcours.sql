-- ============================================================
-- ARTDIVE : mise à jour n° 7 (parcours autoguidés)
--
-- Pour une base où maj-06 est DÉJÀ installée. À coller en entier dans
-- Supabase > SQL Editor, puis « Run ». Ensuite : relancer
-- supabase/test-droits.sql.
-- ============================================================

begin;

do $$
begin
  if not exists (select 1 from storage.buckets where id = 'videos') then
    raise exception 'Installer d''abord maj-06-videos.sql.';
  end if;
  if exists (select 1 from information_schema.columns where table_schema = 'public'
             and table_name = 'acces' and column_name = 'consentements') then
    raise exception 'Cette mise à jour est déjà faite.';
  end if;
end $$;

-- Parcours autoguidés (partie 3, 19/11) : cases cochées à l'achat (CGV art. 16.3 : accès
-- immédiat demandé, renoncement à la rétractation) et version des CGV, gardées par accès ;
-- limite d'envoi des liens d'accès par email ; audios des étapes dans le dossier « videos ».
alter table public.acces
  add column consentements jsonb not null default '{}',
  add column cgv_version text,
  add column lien_envoye_le timestamptz;
update storage.buckets set allowed_mime_types = array['video/mp4', 'video/quicktime', 'video/webm', 'text/vtt',
  'audio/mpeg', 'audio/mp4', 'audio/x-m4a', 'audio/aac'] where id = 'videos';

commit;

select 'mise à jour n° 7 faite' as resultat;
