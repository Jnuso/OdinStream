begin;
create extension if not exists pgtap with schema extensions;
select plan(19);
grant usage on schema extensions to odin_api;
select ok(not has_table_privilege('anon', 'public.watched_episodes', 'SELECT'), 'anonymous clients cannot read progress');
select ok(not has_table_privilege('authenticated', 'public.watched_episodes', 'INSERT'), 'browser users cannot insert progress');
select ok(not has_table_privilege('odin_api', 'public.watched_episodes', 'UPDATE'), 'API role cannot update progress rows');
insert into auth.users (id, email) values
  ('aaaa1111-1111-4111-8111-111111111111', 'episode-a@example.test'),
  ('bbbb2222-2222-4222-8222-222222222222', 'episode-b@example.test');
insert into public.saved_titles (id, user_id, media_type, tmdb_id, status) values
  ('aaaa0000-0000-4000-8000-000000000001', 'aaaa1111-1111-4111-8111-111111111111', 'tv', 42, 'watching'),
  ('aaaa0000-0000-4000-8000-000000000002', 'aaaa1111-1111-4111-8111-111111111111', 'movie', 42, 'watchlist'),
  ('bbbb0000-0000-4000-8000-000000000001', 'bbbb2222-2222-4222-8222-222222222222', 'tv', 42, 'watching');
set local role odin_api;
select is((select count(*) from public.watched_episodes), 0::bigint, 'no identity sees no progress');
select throws_ok($$insert into public.watched_episodes (user_id, saved_title_id, season_number, episode_number) values ('aaaa1111-1111-4111-8111-111111111111', 'aaaa0000-0000-4000-8000-000000000001', 1, 1)$$, '42501', null, 'no identity cannot insert');
select set_config('app.user_id', 'aaaa1111-1111-4111-8111-111111111111', true);
select lives_ok($$insert into public.watched_episodes (user_id, saved_title_id, season_number, episode_number) values ('aaaa1111-1111-4111-8111-111111111111', 'aaaa0000-0000-4000-8000-000000000001', 1, 1)$$, 'owner may mark episode');
select throws_ok($$insert into public.watched_episodes (user_id, saved_title_id, season_number, episode_number) values ('aaaa1111-1111-4111-8111-111111111111', 'aaaa0000-0000-4000-8000-000000000001', 1, 1)$$, '23505', null, 'duplicate episode rejected');
select throws_ok($$insert into public.watched_episodes (user_id, saved_title_id, season_number, episode_number) values ('bbbb2222-2222-4222-8222-222222222222', 'bbbb0000-0000-4000-8000-000000000001', 1, 1)$$, '42501', null, 'cannot insert for other owner');
select throws_ok($$insert into public.watched_episodes (user_id, saved_title_id, season_number, episode_number) values ('aaaa1111-1111-4111-8111-111111111111', 'bbbb0000-0000-4000-8000-000000000001', 1, 1)$$, '23503', null, 'cannot attach progress to another owner title');
select throws_ok($$insert into public.watched_episodes (user_id, saved_title_id, season_number, episode_number) values ('aaaa1111-1111-4111-8111-111111111111', 'aaaa0000-0000-4000-8000-000000000002', 1, 1)$$, '23503', null, 'movie cannot have episodes');
select throws_ok($$insert into public.watched_episodes (user_id, saved_title_id, season_number, episode_number) values ('aaaa1111-1111-4111-8111-111111111111', 'aaaa0000-0000-4000-8000-000000000001', -1, 1)$$, '23514', null, 'negative season rejected');
select throws_ok($$insert into public.watched_episodes (user_id, saved_title_id, season_number, episode_number) values ('aaaa1111-1111-4111-8111-111111111111', 'aaaa0000-0000-4000-8000-000000000001', 1, 0)$$, '23514', null, 'invalid episode rejected');
select set_config('app.user_id', 'bbbb2222-2222-4222-8222-222222222222', true);
select is((select count(*) from public.watched_episodes), 0::bigint, 'other owner cannot read progress');
select lives_ok($$delete from public.watched_episodes$$, 'other owner cannot delete progress');
reset role;
select is((select count(*) from public.watched_episodes where user_id = 'aaaa1111-1111-4111-8111-111111111111'), 1::bigint, 'other owner deletion left record intact');
set local role odin_api;
select set_config('app.user_id', 'aaaa1111-1111-4111-8111-111111111111', true);
select lives_ok($$insert into public.watched_episodes (user_id, saved_title_id, season_number, episode_number) values
  ('aaaa1111-1111-4111-8111-111111111111', 'aaaa0000-0000-4000-8000-000000000001', 1, 2),
  ('aaaa1111-1111-4111-8111-111111111111', 'aaaa0000-0000-4000-8000-000000000001', 2, 1)$$, 'owner can save episodes in multiple seasons');
select lives_ok($$delete from public.watched_episodes
  where user_id = 'aaaa1111-1111-4111-8111-111111111111'
    and saved_title_id = 'aaaa0000-0000-4000-8000-000000000001'
    and season_number = 1 and episode_number = any(array[1]::integer[])$$, 'owner can remove a single episode');
select results_eq($$select season_number, episode_number from public.watched_episodes order by season_number, episode_number$$,
  $$values (1, 2), (2, 1)$$, 'single episode removal preserves other episodes and seasons');
reset role;
delete from public.saved_titles where id = 'aaaa0000-0000-4000-8000-000000000001';
select is((select count(*) from public.watched_episodes where user_id = 'aaaa1111-1111-4111-8111-111111111111'), 0::bigint, 'deleting saved title cascades progress');
select * from finish();
rollback;
