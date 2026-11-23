create table public.favorite_titles (
  user_id uuid not null references auth.users(id) on delete cascade,
  media_type text not null check (media_type in ('movie', 'tv')),
  tmdb_id integer not null check (tmdb_id > 0),
  name text not null,
  release_date text,
  poster_path text,
  genre_ids integer[] not null default '{}',
  created_at timestamptz not null default now(),
  primary key (user_id, media_type, tmdb_id)
);

alter table public.favorite_titles enable row level security;
alter table public.favorite_titles force row level security;
revoke all on public.favorite_titles from public, anon, authenticated;
grant select, insert, delete on public.favorite_titles to odin_api;

create policy favorite_titles_select on public.favorite_titles for select to odin_api
  using (user_id = nullif(current_setting('app.user_id', true), '')::uuid);
create policy favorite_titles_insert on public.favorite_titles for insert to odin_api
  with check (user_id = nullif(current_setting('app.user_id', true), '')::uuid);
create policy favorite_titles_delete on public.favorite_titles for delete to odin_api
  using (user_id = nullif(current_setting('app.user_id', true), '')::uuid);
