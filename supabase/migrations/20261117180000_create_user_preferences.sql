-- Favorite genres and streaming services for the signed-in user.
-- FastAPI verifies the Supabase access token, then writes as odin_api with
-- app.user_id set to that token's subject. Direct browser roles have no access.

do $$
begin
  create role odin_api nologin nobypassrls;
exception
  when duplicate_object then null;
end
$$;

grant odin_api to postgres;
grant usage on schema public to odin_api;

create table public.user_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  favorite_genres text[] not null default '{}',
  streaming_services text[] not null default '{}',
  updated_at timestamptz not null default now(),
  constraint user_preferences_genres_allowed check (
    favorite_genres <@ array[
      'Action',
      'Animation',
      'Comedy',
      'Documentary',
      'Drama',
      'Fantasy',
      'Horror',
      'Romance',
      'Science Fiction',
      'Thriller'
    ]::text[]
  ),
  constraint user_preferences_services_allowed check (
    streaming_services <@ array[
      'Netflix',
      'Max',
      'Apple TV+',
      'Hulu',
      'Disney+'
    ]::text[]
  )
);

create function public.set_user_preferences_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger user_preferences_set_updated_at
before update on public.user_preferences
for each row execute function public.set_user_preferences_updated_at();

alter table public.user_preferences enable row level security;
alter table public.user_preferences force row level security;
revoke all on public.user_preferences from public, anon, authenticated;
grant select, insert, update, delete on public.user_preferences to odin_api;

create policy user_preferences_select_own on public.user_preferences
  for select to odin_api
  using (user_id = nullif(current_setting('app.user_id', true), '')::uuid);
create policy user_preferences_insert_own on public.user_preferences
  for insert to odin_api
  with check (user_id = nullif(current_setting('app.user_id', true), '')::uuid);
create policy user_preferences_update_own on public.user_preferences
  for update to odin_api
  using (user_id = nullif(current_setting('app.user_id', true), '')::uuid)
  with check (user_id = nullif(current_setting('app.user_id', true), '')::uuid);
create policy user_preferences_delete_own on public.user_preferences
  for delete to odin_api
  using (user_id = nullif(current_setting('app.user_id', true), '')::uuid);
