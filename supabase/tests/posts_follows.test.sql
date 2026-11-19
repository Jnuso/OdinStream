begin;
create extension if not exists pgtap with schema extensions;
select plan(33);
-- pgTAP helpers must be visible after switching to the backend role.
grant usage on schema extensions to odin_api;

select ok(not has_table_privilege('authenticated', 'public.posts', 'SELECT'), 'clients have no direct post access');
select ok(not has_table_privilege('authenticated', 'public.posts', 'INSERT'), 'clients cannot insert posts');
select ok(not has_table_privilege('anon', 'public.follows', 'SELECT'), 'anonymous role cannot read follows');
select ok(not has_table_privilege('anon', 'public.profiles', 'UPDATE'), 'anonymous role cannot update profiles');

insert into auth.users (id, email) values
  ('11111111-1111-4111-8111-111111111111', 'ada@example.test'),
  ('22222222-2222-4222-8222-222222222222', 'grace@example.test');

select is((select count(*) from public.profiles where user_id in
  ('11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222')),
  2::bigint, 'a profile is created for every new account');

select throws_ok($$insert into public.profiles (user_id, display_name, handle)
  values ('33333333-3333-4333-8333-333333333333', 'Nobody', 'nobody.000000')$$,
  '23503', null, 'a profile needs an account');

select set_config('app.user_id', '11111111-1111-4111-8111-111111111111', true);
set local role odin_api;

select lives_ok($$insert into public.posts (user_id, media_type, tmdb_id, title_name, rating, review)
  values ('11111111-1111-4111-8111-111111111111', 'movie', 693134, 'Dune: Part Two', 5, 'Still thinking about it.')$$,
  'a user can publish their own rating');
select throws_ok($$insert into public.posts (user_id, media_type, tmdb_id, title_name, rating)
  values ('22222222-2222-4222-8222-222222222222', 'movie', 603, 'The Matrix', 4)$$,
  '42501', null, 'a user cannot publish for another account');
select throws_ok($$insert into public.posts (user_id, media_type, tmdb_id, title_name, rating)
  values ('11111111-1111-4111-8111-111111111111', 'movie', 603, 'The Matrix', 0)$$,
  '23514', null, 'a zero rating is rejected');
select throws_ok($$insert into public.posts (user_id, media_type, tmdb_id, title_name, rating)
  values ('11111111-1111-4111-8111-111111111111', 'movie', 603, 'The Matrix', 6)$$,
  '23514', null, 'a rating above five is rejected');
select throws_ok($$insert into public.posts (user_id, media_type, tmdb_id, title_name, rating, review)
  values ('11111111-1111-4111-8111-111111111111', 'tv', 1396, 'Breaking Bad', 5, repeat('x', 1001))$$,
  '23514', null, 'an overlong review is rejected');
select throws_ok($$insert into public.posts (user_id, media_type, tmdb_id, title_name, rating)
  values ('11111111-1111-4111-8111-111111111111', 'movie', 693134, 'Dune: Part Two', 3)$$,
  '23505', null, 'a user has one post per title');
select lives_ok($$update public.posts set rating = 4, review = 'Revised after a second watch.'
  where media_type = 'movie' and tmdb_id = 693134$$, 'the author can edit their post');
select is((select rating from public.posts where tmdb_id = 693134), 4::smallint, 'the edited rating is stored');
select is((select count(*) from public.posts), 1::bigint, 'the author sees their own post');

select set_config('app.user_id', '22222222-2222-4222-8222-222222222222', true);
select is((select count(*) from public.posts), 1::bigint, 'other signed-in users can read public posts');
select is((select count(*) from public.posts where user_id = '11111111-1111-4111-8111-111111111111'), 1::bigint, 'public posts are readable across accounts');
select lives_ok($$update public.posts set rating = 1 where tmdb_id = 693134$$, 'updating another post is a no-op');
select is((select rating from public.posts where tmdb_id = 693134), 4::smallint, 'another user cannot change a rating');
select lives_ok($$delete from public.posts where tmdb_id = 693134$$, 'deleting another post is a no-op');
select is((select count(*) from public.posts), 1::bigint, 'another user cannot delete a post');

select throws_ok($$insert into public.follows (follower_id, followee_id)
  values ('22222222-2222-4222-8222-222222222222', '22222222-2222-4222-8222-222222222222')$$,
  '23514', null, 'a user cannot follow themselves');
select throws_ok($$insert into public.follows (follower_id, followee_id)
  values ('11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222')$$,
  '42501', null, 'a user cannot follow on behalf of another account');
select lives_ok($$insert into public.follows (follower_id, followee_id)
  values ('22222222-2222-4222-8222-222222222222', '11111111-1111-4111-8111-111111111111')$$, 'a user can follow another account');
select throws_ok($$insert into public.follows (follower_id, followee_id)
  values ('22222222-2222-4222-8222-222222222222', '11111111-1111-4111-8111-111111111111')$$,
  '23505', null, 'following twice is rejected');
select is((select count(*) from public.follows), 1::bigint, 'follows are readable for feeds');

select lives_ok($$update public.profiles set display_name = 'Not Ada' where user_id = '11111111-1111-4111-8111-111111111111'$$, 'updating another profile is a no-op');
select is((select display_name from public.profiles where user_id = '11111111-1111-4111-8111-111111111111'), 'Ada', 'another user cannot rename a profile');
select lives_ok($$update public.profiles set display_name = 'Grace H.', bio = 'Watches everything twice.'
  where user_id = '22222222-2222-4222-8222-222222222222'$$, 'a user can edit their own profile');
select is((select bio from public.profiles where user_id = '22222222-2222-4222-8222-222222222222'), 'Watches everything twice.', 'the profile bio is stored');

reset role;
delete from auth.users where id = '11111111-1111-4111-8111-111111111111';
select is((select count(*) from public.posts), 0::bigint, 'deleting an account removes its posts');
select is((select count(*) from public.follows), 0::bigint, 'deleting an account removes its follows');
select is((select count(*) from public.profiles where user_id = '11111111-1111-4111-8111-111111111111'), 0::bigint, 'deleting an account removes its profile');

select * from finish();
rollback;
