-- Retain TV history independently of saved library entries.
create sequence public.watched_episode_order_seq;
alter table public.watched_episodes add column watch_order bigint;
with ranked as (
  select ctid, row_number() over (order by watched_at, user_id, saved_title_id, season_number, episode_number) as n
  from public.watched_episodes
)
update public.watched_episodes w set watch_order = ranked.n from ranked where w.ctid = ranked.ctid;
select setval('public.watched_episode_order_seq', greatest(coalesce((select max(watch_order) from public.watched_episodes), 0), 1), true);
alter table public.watched_episodes alter column watch_order set default nextval('public.watched_episode_order_seq');
alter table public.watched_episodes alter column watch_order set not null;
grant usage, select on sequence public.watched_episode_order_seq to odin_api;
alter table public.watched_episodes add column tmdb_id bigint;
update public.watched_episodes w set tmdb_id = s.tmdb_id
  from public.saved_titles s where s.id = w.saved_title_id;
alter table public.watched_episodes alter column tmdb_id set not null;
alter table public.watched_episodes add constraint watched_episodes_tmdb_id_check check (tmdb_id > 0);
alter table public.watched_episodes drop constraint watched_episodes_saved_title_id_user_id_media_type_fkey;
alter table public.watched_episodes drop constraint watched_episodes_pkey;
alter table public.watched_episodes drop column saved_title_id;
alter table public.watched_episodes drop column media_type;
alter table public.watched_episodes add primary key (user_id, tmdb_id, season_number, episode_number);
grant update (watched_at, watch_order) on public.watched_episodes to odin_api;
create policy watched_episodes_update_own on public.watched_episodes for update to odin_api
  using (user_id = nullif(current_setting('app.user_id', true), '')::uuid)
  with check (user_id = nullif(current_setting('app.user_id', true), '')::uuid);

-- Permit half stars and longer reviews.
alter table public.posts drop constraint posts_rating_check;
alter table public.posts alter column rating type numeric;
alter table public.posts add constraint posts_rating_check check (rating between 0.5 and 5 and rating * 2 = trunc(rating * 2));
alter table public.posts drop constraint posts_review_check;
alter table public.posts add constraint posts_review_check check (review is null or length(review) <= 2000);

-- A private account becoming public approves all pending requests atomically.
create function public.approve_requests_on_public() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if old.visibility = 'private' and new.visibility = 'public' then
    update public.follows set status = 'following' where followee_id = new.user_id and status = 'requested';
  end if;
  return new;
end;
$$;
create trigger profiles_approve_requests after update of visibility on public.profiles
for each row execute function public.approve_requests_on_public();
