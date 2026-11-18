begin;
create extension if not exists pgtap with schema extensions;
select plan(16);
-- pgTAP helpers must be visible after switching to the backend role.
grant usage on schema extensions to odin_api;

select ok(not has_table_privilege('authenticated', 'public.user_preferences', 'SELECT'), 'clients have no direct select privilege');
select ok(not has_table_privilege('authenticated', 'public.user_preferences', 'INSERT'), 'clients cannot write preferences directly');
select ok(not has_table_privilege('authenticated', 'public.user_preferences', 'UPDATE'), 'clients have no direct update privilege');
select ok(not has_table_privilege('anon', 'public.user_preferences', 'SELECT'), 'anonymous role cannot select preferences');

insert into auth.users (id, email) values
  ('11111111-1111-4111-8111-111111111111', 'user-a@example.test'),
  ('22222222-2222-4222-8222-222222222222', 'user-b@example.test');

select set_config('app.user_id', '11111111-1111-4111-8111-111111111111', true);
set local role odin_api;
select throws_ok($$insert into public.user_preferences (user_id, favorite_genres)
  values ('11111111-1111-4111-8111-111111111111', array['Not a genre'])$$, '23514', null, 'unknown genre rejected');
select throws_ok($$insert into public.user_preferences (user_id, streaming_services)
  values ('11111111-1111-4111-8111-111111111111', array['Not a service'])$$, '23514', null, 'unknown service rejected');
select lives_ok($$insert into public.user_preferences (user_id, favorite_genres, streaming_services)
  values ('11111111-1111-4111-8111-111111111111', array['Drama', 'Science Fiction'], array['Netflix'])$$, 'owner can save preferences');
select throws_ok($$insert into public.user_preferences (user_id, favorite_genres)
  values ('22222222-2222-4222-8222-222222222222', array['Drama'])$$, '42501', null, 'cannot insert another user preferences');
select lives_ok($$update public.user_preferences set streaming_services = array['Max', 'Hulu']
  where user_id = '11111111-1111-4111-8111-111111111111'$$, 'owner can update preferences');
select is((select streaming_services from public.user_preferences), array['Max', 'Hulu']::text[], 'services persisted');
select lives_ok($$update public.user_preferences set updated_at = '2000-01-01T00:00:00Z'
  where user_id = '11111111-1111-4111-8111-111111111111'$$, 'owner can update the timestamp column');
select is((select updated_at from public.user_preferences), now(), 'update timestamp is set by the database');

select set_config('app.user_id', '22222222-2222-4222-8222-222222222222', true);
select is((select count(*) from public.user_preferences), 0::bigint, 'other user cannot see preferences');
select lives_ok($$insert into public.user_preferences (user_id, favorite_genres)
  values ('22222222-2222-4222-8222-222222222222', array['Comedy'])$$, 'another user can save their own preferences');
reset role;
select is((select count(*) from public.user_preferences where user_id in ('11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222')), 2::bigint, 'both preference rows remain');
delete from auth.users where id = '11111111-1111-4111-8111-111111111111';
select is((select count(*) from public.user_preferences where user_id = '11111111-1111-4111-8111-111111111111'), 0::bigint, 'deleting account cascades');

select * from finish();
rollback;
