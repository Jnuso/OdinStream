begin;
create extension if not exists pgtap with schema extensions;
select plan(15);
-- pgTAP helpers live in extensions; grant access only in this rolled-back test.
grant usage on schema extensions to odin_api;

select ok(not has_table_privilege('anon', 'public.saved_titles', 'SELECT'), 'anonymous clients cannot read saved titles');
select ok(not has_table_privilege('authenticated', 'public.saved_titles', 'INSERT'), 'authenticated clients cannot insert saved titles directly');
select ok(not (select rolbypassrls from pg_roles where rolname = 'odin_api'), 'backend role cannot bypass RLS');
select ok(not (select rolcanlogin from pg_roles where rolname = 'odin_api'), 'backend role cannot log in directly');

insert into auth.users (id, email) values
  ('11111111-1111-4111-8111-111111111111', 'user-a@example.test'),
  ('22222222-2222-4222-8222-222222222222', 'user-b@example.test');

set local role odin_api;
select is((select count(*) from public.saved_titles), 0::bigint, 'no identity sees no records');
select throws_ok($$insert into public.saved_titles (user_id, media_type, tmdb_id, status)
  values ('11111111-1111-4111-8111-111111111111', 'movie', 42, 'watchlist')$$, '42501', null, 'no identity cannot insert');
select set_config('app.user_id', '11111111-1111-4111-8111-111111111111', true);
select lives_ok($$insert into public.saved_titles (user_id, media_type, tmdb_id, status)
  values ('11111111-1111-4111-8111-111111111111', 'movie', 42, 'watchlist')$$, 'owner can insert');
select throws_ok($$insert into public.saved_titles (user_id, media_type, tmdb_id, status)
  values ('22222222-2222-4222-8222-222222222222', 'movie', 42, 'watchlist')$$, '42501', null, 'cannot insert another user record');
select throws_ok($$update public.saved_titles set user_id = '22222222-2222-4222-8222-222222222222'$$, '42501', null, 'cannot transfer record');
select lives_ok($$update public.saved_titles set status = 'watched'$$, 'owner can update status');
select is((select status from public.saved_titles), 'watched', 'updated status persists');
select set_config('app.user_id', '22222222-2222-4222-8222-222222222222', true);
select is((select count(*) from public.saved_titles), 0::bigint, 'other user cannot read record');
select lives_ok($$delete from public.saved_titles$$, 'other user cannot delete record');
select lives_ok($$insert into public.saved_titles (user_id, media_type, tmdb_id, status)
  values ('22222222-2222-4222-8222-222222222222', 'movie', 42, 'watchlist')$$, 'other user can independently save title');
reset role;
select is((select count(*) from public.saved_titles where user_id in ('11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222')), 2::bigint, 'both users records remain');

select * from finish();
rollback;
