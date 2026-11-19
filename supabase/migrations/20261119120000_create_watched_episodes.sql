-- A progress row can only reference a TV title owned by the same user.
alter table public.saved_titles
  add constraint saved_titles_id_owner_type_unique unique (id, user_id, media_type);

create table public.watched_episodes (
  user_id uuid not null references auth.users(id) on delete cascade,
  saved_title_id uuid not null,
  media_type text not null default 'tv' check (media_type = 'tv'),
  season_number integer not null check (season_number >= 0),
  episode_number integer not null check (episode_number > 0),
  watched_at timestamptz not null default now(),
  primary key (user_id, saved_title_id, season_number, episode_number),
  foreign key (saved_title_id, user_id, media_type)
    references public.saved_titles (id, user_id, media_type) on delete cascade
);

alter table public.watched_episodes enable row level security;
alter table public.watched_episodes force row level security;
revoke all on public.watched_episodes from public, anon, authenticated;
grant select, insert, delete on public.watched_episodes to odin_api;

create policy watched_episodes_select_own on public.watched_episodes
  for select to odin_api
  using (user_id = nullif(current_setting('app.user_id', true), '')::uuid);
create policy watched_episodes_insert_own on public.watched_episodes
  for insert to odin_api
  with check (user_id = nullif(current_setting('app.user_id', true), '')::uuid);
create policy watched_episodes_delete_own on public.watched_episodes
  for delete to odin_api
  using (user_id = nullif(current_setting('app.user_id', true), '')::uuid);
