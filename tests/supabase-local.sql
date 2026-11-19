-- Imitation locale de Supabase : rôles, schéma auth, droits par défaut.
create role anon nologin; create role authenticated nologin;
create role service_role nologin bypassrls;
create role sbadmin login createrole bypassrls password 'x';
grant anon, authenticated, service_role to sbadmin;
create database vlaa owner sbadmin;
\c vlaa
create schema auth authorization sbadmin;
grant usage on schema auth to anon, authenticated, service_role;
set role sbadmin;
create table auth.users (id uuid primary key default gen_random_uuid(), email text, aud text, role text, instance_id uuid);
create function auth.uid() returns uuid language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'))::uuid $$;
create function auth.role() returns text language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claim.role', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role'))::text $$;
grant execute on function auth.uid(), auth.role() to anon, authenticated, service_role;
reset role;
alter schema public owner to sbadmin;
grant usage on schema public to anon, authenticated, service_role;
alter default privileges for role sbadmin in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges for role sbadmin in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges for role sbadmin in schema public grant all on functions to anon, authenticated, service_role;
-- Stockage (imitation minimale de storage.buckets et storage.objects de Supabase)
create schema storage authorization sbadmin;
grant usage on schema storage to anon, authenticated, service_role;
set role sbadmin;
create table storage.buckets (id text primary key, name text not null, public boolean default false,
  file_size_limit bigint, allowed_mime_types text[]);
create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text references storage.buckets(id),
  name text, owner uuid, owner_id text, metadata jsonb, created_at timestamptz default now(), updated_at timestamptz default now());
alter table storage.objects enable row level security;
grant all on storage.buckets, storage.objects to anon, authenticated, service_role;
reset role;
