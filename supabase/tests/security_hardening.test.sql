-- pgTAP security regression test suite for OdinStream Supabase schema.

begin;
create extension if not exists pgtap with schema extensions;
select plan(27);
grant usage on schema extensions to odin_api;

-- 1. Browser roles (anon, authenticated) must have zero table access on all 6 app tables.
select ok(not has_table_privilege('anon', 'public.saved_titles', 'SELECT'), 'anon cannot read saved_titles');
select ok(not has_table_privilege('authenticated', 'public.saved_titles', 'SELECT'), 'authenticated cannot read saved_titles');
select ok(not has_table_privilege('anon', 'public.user_preferences', 'SELECT'), 'anon cannot read user_preferences');
select ok(not has_table_privilege('authenticated', 'public.user_preferences', 'SELECT'), 'authenticated cannot read user_preferences');
select ok(not has_table_privilege('anon', 'public.watched_episodes', 'SELECT'), 'anon cannot read watched_episodes');
select ok(not has_table_privilege('authenticated', 'public.watched_episodes', 'SELECT'), 'authenticated cannot read watched_episodes');
select ok(not has_table_privilege('anon', 'public.profiles', 'SELECT'), 'anon cannot read profiles');
select ok(not has_table_privilege('authenticated', 'public.profiles', 'SELECT'), 'authenticated cannot read profiles');
select ok(not has_table_privilege('anon', 'public.posts', 'SELECT'), 'anon cannot read posts');
select ok(not has_table_privilege('authenticated', 'public.posts', 'SELECT'), 'authenticated cannot read posts');
select ok(not has_table_privilege('anon', 'public.follows', 'SELECT'), 'anon cannot read follows');
select ok(not has_table_privilege('authenticated', 'public.follows', 'SELECT'), 'authenticated cannot read follows');

-- 2. Browser roles must have zero access to the episode ordering sequence.
select ok(not has_sequence_privilege('anon', 'public.watched_episode_order_seq', 'USAGE'), 'anon has no USAGE on watched_episode_order_seq');
select ok(not has_sequence_privilege('authenticated', 'public.watched_episode_order_seq', 'USAGE'), 'authenticated has no USAGE on watched_episode_order_seq');
select ok(has_sequence_privilege('odin_api', 'public.watched_episode_order_seq', 'USAGE'), 'odin_api has USAGE on watched_episode_order_seq');

-- 3. RLS and FORCE RLS must be enabled on all 6 app tables.
select is(
  (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public'
     and c.relname in ('saved_titles', 'user_preferences', 'watched_episodes', 'profiles', 'posts', 'follows')
     and c.relrowsecurity and c.relforcerowsecurity),
  6::bigint,
  'all 6 app tables have RLS and FORCE RLS enabled'
);

-- 4. Backend role `odin_api` must be NOLOGIN and NOBYPASSRLS with least-privilege table grants.
select is(
  (select not rolcanlogin and not rolbypassrls from pg_roles where rolname = 'odin_api'),
  true,
  'odin_api is NOLOGIN and NOBYPASSRLS'
);
select ok(not has_table_privilege('odin_api', 'public.profiles', 'DELETE'), 'odin_api cannot delete profiles directly');
select ok(has_column_privilege('odin_api', 'public.follows', 'status', 'UPDATE'), 'odin_api can update follows.status');
select ok(not has_column_privilege('odin_api', 'public.follows', 'follower_id', 'UPDATE'), 'odin_api cannot update follows.follower_id');
select ok(has_column_privilege('odin_api', 'public.watched_episodes', 'watch_order', 'UPDATE'), 'odin_api can update watched_episodes.watch_order');
select ok(not has_column_privilege('odin_api', 'public.watched_episodes', 'tmdb_id', 'UPDATE'), 'odin_api cannot update watched_episodes.tmdb_id');

-- 5. Unset app.user_id must fail closed under odin_api (no rows readable or writable).
insert into auth.users (id, email) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'sec-a@example.test'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'sec-b@example.test');

set local role odin_api;
select set_config('app.user_id', '', true);

select is((select count(*) from public.saved_titles), 0::bigint, 'unset app.user_id reads zero saved_titles');
select is((select count(*) from public.user_preferences), 0::bigint, 'unset app.user_id reads zero user_preferences');
select is((select count(*) from public.watched_episodes), 0::bigint, 'unset app.user_id reads zero watched_episodes');
select throws_ok(
  $$insert into public.saved_titles (user_id, media_type, tmdb_id, status)
    values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'movie', 603, 'watchlist')$$,
  '42501',
  null,
  'unset app.user_id cannot insert saved_titles'
);

-- 6. Cross-user isolation: user B cannot insert preferences for user A.
select set_config('app.user_id', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', true);
select throws_ok(
  $$insert into public.user_preferences (user_id, favorite_genres, streaming_services)
    values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', array['Drama'], array['Netflix'])$$,
  '42501',
  null,
  'user B cannot insert preferences for user A'
);

select * from finish();
rollback;
