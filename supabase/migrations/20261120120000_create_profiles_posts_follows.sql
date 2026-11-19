-- Social layer: public profiles, ratings/reviews, and follow relationships.
-- FastAPI verifies the Supabase token, sets app.user_id for the transaction and
-- scopes every write to that user. Browser roles get no direct table access.

create table public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null check (length(btrim(display_name)) between 1 and 60),
  handle text not null unique check (handle ~ '^[a-z0-9_.]{3,30}$'),
  bio text not null default '' check (length(bio) <= 280),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.posts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(user_id) on delete cascade,
  media_type text not null check (media_type in ('movie', 'tv')),
  tmdb_id bigint not null check (tmdb_id > 0),
  title_name text not null check (length(btrim(title_name)) between 1 and 200),
  poster_path text,
  release_date text,
  rating smallint not null check (rating between 1 and 5),
  review text check (review is null or length(review) <= 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint posts_user_title_unique unique (user_id, media_type, tmdb_id)
);

create table public.follows (
  follower_id uuid not null references public.profiles(user_id) on delete cascade,
  followee_id uuid not null references public.profiles(user_id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (follower_id, followee_id),
  constraint follows_no_self check (follower_id <> followee_id)
);

create index posts_created_at_idx on public.posts (created_at desc, id desc);
create index posts_title_idx on public.posts (media_type, tmdb_id);
create index follows_followee_idx on public.follows (followee_id);

create function public.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_set_updated_at
before update on public.profiles
for each row execute function public.touch_updated_at();

create trigger posts_set_updated_at
before update on public.posts
for each row execute function public.touch_updated_at();

-- Every account needs a public profile for feeds and profiles to render.
create function public.create_profile_for_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  local_part text;
  base_handle text;
begin
  local_part := split_part(coalesce(new.email, 'viewer'), '@', 1);
  base_handle := left(lower(regexp_replace(local_part, '[^a-zA-Z0-9]+', '', 'g')), 20);
  if length(base_handle) < 3 then
    base_handle := 'viewer';
  end if;
  insert into public.profiles (user_id, display_name, handle)
  values (
    new.id,
    left(initcap(local_part), 60),
    base_handle || '.' || left(replace(new.id::text, '-', ''), 6)
  )
  on conflict (user_id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.create_profile_for_new_user();

-- Existing accounts get a profile too.
insert into public.profiles (user_id, display_name, handle)
select
  account.id,
  left(initcap(split_part(coalesce(account.email, 'viewer'), '@', 1)), 60),
  left(lower(regexp_replace(split_part(coalesce(account.email, 'viewer'), '@', 1), '[^a-zA-Z0-9]+', '', 'g')), 20)
    || '.' || left(replace(account.id::text, '-', ''), 6)
from auth.users as account
where not exists (select 1 from public.profiles as profile where profile.user_id = account.id);

alter table public.profiles enable row level security;
alter table public.posts enable row level security;
alter table public.posts force row level security;
alter table public.follows enable row level security;
alter table public.follows force row level security;

revoke all on public.profiles from public, anon, authenticated;
revoke all on public.posts from public, anon, authenticated;
revoke all on public.follows from public, anon, authenticated;

grant select, insert, update on public.profiles to odin_api;
grant select, insert, update, delete on public.posts to odin_api;
grant select, insert, delete on public.follows to odin_api;

-- Profiles are public to signed-in readers; only the owner may change one.
create policy profiles_select_public on public.profiles
  for select to odin_api using (true);
create policy profiles_insert_own on public.profiles
  for insert to odin_api
  with check (user_id = nullif(current_setting('app.user_id', true), '')::uuid);
create policy profiles_update_own on public.profiles
  for update to odin_api
  using (user_id = nullif(current_setting('app.user_id', true), '')::uuid)
  with check (user_id = nullif(current_setting('app.user_id', true), '')::uuid);

-- Posts are public to signed-in readers; only the author may change one.
create policy posts_select_public on public.posts
  for select to odin_api using (true);
create policy posts_insert_own on public.posts
  for insert to odin_api
  with check (user_id = nullif(current_setting('app.user_id', true), '')::uuid);
create policy posts_update_own on public.posts
  for update to odin_api
  using (user_id = nullif(current_setting('app.user_id', true), '')::uuid)
  with check (user_id = nullif(current_setting('app.user_id', true), '')::uuid);
create policy posts_delete_own on public.posts
  for delete to odin_api
  using (user_id = nullif(current_setting('app.user_id', true), '')::uuid);

-- Follow relationships are readable so feeds and profiles can resolve them;
-- a user may only create or remove their own follow rows.
create policy follows_select_public on public.follows
  for select to odin_api using (true);
create policy follows_insert_own on public.follows
  for insert to odin_api
  with check (follower_id = nullif(current_setting('app.user_id', true), '')::uuid);
create policy follows_delete_own on public.follows
  for delete to odin_api
  using (follower_id = nullif(current_setting('app.user_id', true), '')::uuid);
