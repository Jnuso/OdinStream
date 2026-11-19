-- Preserve existing profiles while requiring setup for accounts created after this migration.
alter table public.profiles add column setup_complete boolean not null default true;
alter table public.profiles alter column setup_complete set default false;
alter table public.profiles alter column visibility set default 'private';
alter table public.profiles drop constraint profiles_handle_check;
alter table public.profiles add constraint profiles_handle_check check (handle ~ '^[A-Za-z0-9_.]{3,30}$');
-- Existing handles were lowercase, so the previous unique constraint already precludes collisions.
create unique index profiles_handle_case_insensitive on public.profiles (lower(handle));

-- A temporary profile is visible only to its owner until setup finishes.
drop policy profiles_select_public on public.profiles;
create policy profiles_select_completed_or_own on public.profiles for select to odin_api
  using (setup_complete or user_id = nullif(current_setting('app.user_id', true), '')::uuid);
