begin;
create extension if not exists pgtap with schema extensions;
select plan(10);
grant usage on schema extensions to odin_api;
insert into auth.users (id, email) values
 ('aaaa1111-1111-4111-8111-111111111111', 'episode-a@example.test'),
 ('bbbb2222-2222-4222-8222-222222222222', 'episode-b@example.test');
insert into public.saved_titles (id, user_id, media_type, tmdb_id, status) values
 ('aaaa0000-0000-4000-8000-000000000001', 'aaaa1111-1111-4111-8111-111111111111', 'tv', 42, 'watching');
select ok(not has_table_privilege('authenticated', 'public.watched_episodes', 'SELECT'), 'browser cannot read progress directly');
set local role odin_api;
select set_config('app.user_id', 'aaaa1111-1111-4111-8111-111111111111', true);
select lives_ok($$insert into public.watched_episodes (user_id, tmdb_id, season_number, episode_number)
 values ('aaaa1111-1111-4111-8111-111111111111', 42, 1, 1)$$, 'owner can record progress');
select throws_ok($$insert into public.watched_episodes (user_id, tmdb_id, season_number, episode_number)
 values ('aaaa1111-1111-4111-8111-111111111111', 42, 1, 1)$$, '23505', null, 'duplicate episode rejected');
select throws_ok($$insert into public.watched_episodes (user_id, tmdb_id, season_number, episode_number)
 values ('bbbb2222-2222-4222-8222-222222222222', 42, 1, 1)$$, '42501', null, 'cannot write another owner progress');
select throws_ok($$insert into public.watched_episodes (user_id, tmdb_id, season_number, episode_number)
 values ('aaaa1111-1111-4111-8111-111111111111', 42, -1, 1)$$, '23514', null, 'invalid season rejected');
select set_config('app.user_id', 'bbbb2222-2222-4222-8222-222222222222', true);
select is((select count(*) from public.watched_episodes), 0::bigint, 'other user cannot see history');
select lives_ok($$delete from public.watched_episodes$$, 'other user deletion is harmless');
reset role;
delete from public.saved_titles where id = 'aaaa0000-0000-4000-8000-000000000001';
select is((select count(*) from public.watched_episodes), 1::bigint, 'removing saved title retains history');
insert into public.saved_titles (user_id, media_type, tmdb_id, status)
 values ('aaaa1111-1111-4111-8111-111111111111', 'tv', 42, 'watchlist');
select is((select count(*) from public.watched_episodes w join public.saved_titles s using (user_id, tmdb_id)), 1::bigint, 're-added show restores history');
delete from auth.users where id = 'aaaa1111-1111-4111-8111-111111111111';
select is((select count(*) from public.watched_episodes), 0::bigint, 'account deletion removes retained history');
select * from finish();
rollback;
