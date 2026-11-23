begin;
create extension if not exists pgtap with schema extensions;
select plan(7);
grant usage on schema extensions to odin_api;
insert into auth.users (id, email) values
  ('11111111-1111-4111-8111-111111111111', 'first@example.test'),
  ('22222222-2222-4222-8222-222222222222', 'second@example.test');

select ok(not has_table_privilege('authenticated', 'public.favorite_titles', 'select'),
          'browser role cannot read favorite titles directly');
set local role odin_api;
select set_config('app.user_id', '11111111-1111-4111-8111-111111111111', true);
insert into public.favorite_titles (user_id, media_type, tmdb_id, name) values
  ('11111111-1111-4111-8111-111111111111', 'movie', 10, 'Film'),
  ('11111111-1111-4111-8111-111111111111', 'tv', 10, 'Show');
select is((select count(*) from public.favorite_titles), 2::bigint, 'movie and TV IDs are distinct');
select throws_ok($$insert into public.favorite_titles (user_id, media_type, tmdb_id, name)
  values ('11111111-1111-4111-8111-111111111111', 'movie', 10, 'Duplicate')$$, '23505', null,
  'same movie cannot be favorited twice');

select set_config('app.user_id', '22222222-2222-4222-8222-222222222222', true);
select is((select count(*) from public.favorite_titles), 0::bigint, 'other account cannot see favorites');
select throws_ok($$insert into public.favorite_titles (user_id, media_type, tmdb_id, name)
  values ('11111111-1111-4111-8111-111111111111', 'movie', 11, 'Other account')$$, '42501', null,
  'other account cannot insert favorites');
delete from public.favorite_titles;
select set_config('app.user_id', '11111111-1111-4111-8111-111111111111', true);
select is((select count(*) from public.favorite_titles), 2::bigint, 'other account cannot delete favorites');

reset role;
delete from auth.users where id = '11111111-1111-4111-8111-111111111111';
select is((select count(*) from public.favorite_titles), 0::bigint, 'account deletion cascades to favorites');
select * from finish();
rollback;
