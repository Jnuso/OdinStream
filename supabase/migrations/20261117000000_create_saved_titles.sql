-- The API verifies the TMDB title before inserting; the database cannot do that.
create table public.saved_titles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  media_type text not null check (media_type in ('movie', 'tv')),
  tmdb_id bigint not null check (tmdb_id > 0),
  status text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint saved_titles_user_media_unique unique (user_id, media_type, tmdb_id),
  constraint saved_titles_status_for_media check (
    (media_type = 'movie' and status in ('watchlist', 'watched')) or
    (media_type = 'tv' and status in ('watchlist', 'watching', 'completed', 'paused', 'dropped'))
  )
);

create function public.set_saved_title_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger saved_titles_set_updated_at
before update on public.saved_titles
for each row execute function public.set_saved_title_updated_at();

alter table public.saved_titles enable row level security;
revoke all on public.saved_titles from public, anon, authenticated;
-- No direct client access: the backend must verify a title with TMDB first.
-- RLS policies below are defense in depth if an authenticated server role is
-- explicitly granted access later; no client privileges are enabled here.

create policy saved_titles_select_own on public.saved_titles
  for select to authenticated using ((select auth.uid()) = user_id);
create policy saved_titles_insert_own on public.saved_titles
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy saved_titles_update_own on public.saved_titles
  for update to authenticated using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
create policy saved_titles_delete_own on public.saved_titles
  for delete to authenticated using ((select auth.uid()) = user_id);
