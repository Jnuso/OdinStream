begin;
create extension if not exists pgtap with schema extensions;
select plan(8);
grant usage on schema extensions to odin_api;

select ok(not has_table_privilege('authenticated', 'public.favorite_people', 'SELECT'), 'browser cannot read favorites');
insert into auth.users (id, email) values
  ('11111111-1111-4111-8111-111111111111', 'actor-a@example.test'),
  ('22222222-2222-4222-8222-222222222222', 'actor-b@example.test');

set local role odin_api;
select set_config('app.user_id', '11111111-1111-4111-8111-111111111111', true);
insert into public.favorite_people (user_id, tmdb_person_id, name) values
  ('11111111-1111-4111-8111-111111111111', 7, 'Actor');
insert into public.favorite_people (user_id, tmdb_person_id, name) values
  ('11111111-1111-4111-8111-111111111111', 7, 'Actor')
  on conflict (user_id, tmdb_person_id) do nothing;
select is((select count(*) from public.favorite_people), 1::bigint, 'duplicate save is idempotent');
select throws_ok($$insert into public.favorite_people (user_id, tmdb_person_id, name)
  values ('22222222-2222-4222-8222-222222222222', 7, 'Actor')$$, '42501', null, 'cannot write another account');
select set_config('app.user_id', '22222222-2222-4222-8222-222222222222', true);
select is((select count(*) from public.favorite_people), 0::bigint, 'cannot read another account');
with removed as (delete from public.favorite_people returning 1)
select is((select count(*) from removed), 0::bigint, 'cannot delete another account favorite');
insert into public.favorite_people (user_id, tmdb_person_id, name) values
  ('22222222-2222-4222-8222-222222222222', 7, 'Actor');
select is((select count(*) from public.favorite_people), 1::bigint, 'second account can save the same actor');
delete from public.favorite_people;
select is((select count(*) from public.favorite_people), 0::bigint, 'second account can remove its favorite');

reset role;
delete from auth.users where id = '11111111-1111-4111-8111-111111111111';
select is((select count(*) from public.favorite_people), 0::bigint, 'account deletion cascades');
select * from finish();
rollback;
