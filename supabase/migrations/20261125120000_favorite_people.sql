create table public.favorite_people (
  user_id uuid not null references auth.users(id) on delete cascade,
  tmdb_person_id integer not null check (tmdb_person_id > 0),
  name text not null,
  profile_path text,
  created_at timestamptz not null default now(),
  primary key (user_id, tmdb_person_id)
);

alter table public.favorite_people enable row level security;
alter table public.favorite_people force row level security;
revoke all on public.favorite_people from public, anon, authenticated;
grant select, insert, delete on public.favorite_people to odin_api;

create policy favorite_people_select on public.favorite_people for select to odin_api
  using (user_id = nullif(current_setting('app.user_id', true), '')::uuid);
create policy favorite_people_insert on public.favorite_people for insert to odin_api
  with check (user_id = nullif(current_setting('app.user_id', true), '')::uuid);
create policy favorite_people_delete on public.favorite_people for delete to odin_api
  using (user_id = nullif(current_setting('app.user_id', true), '')::uuid);
