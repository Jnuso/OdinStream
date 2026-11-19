begin;
create extension if not exists pgtap with schema extensions;
select plan(7);
grant usage on schema extensions to odin_api;
insert into auth.users (id, email) values
 ('11111111-1111-4111-8111-111111111111', 'owner@example.test'),
 ('22222222-2222-4222-8222-222222222222', 'viewer@example.test');
update public.profiles set setup_complete = true, visibility = 'public';
update public.profiles set visibility = 'private' where user_id = '11111111-1111-4111-8111-111111111111';
set local role odin_api;
select set_config('app.user_id', '22222222-2222-4222-8222-222222222222', true);
insert into public.follows (follower_id, followee_id, status)
 values ('22222222-2222-4222-8222-222222222222', '11111111-1111-4111-8111-111111111111', 'requested');
select set_config('app.user_id', '11111111-1111-4111-8111-111111111111', true);
select lives_ok($$update public.profiles set visibility = 'public' where user_id = '11111111-1111-4111-8111-111111111111'$$, 'owner can make profile public');
select is((select status from public.follows), 'following', 'pending request is automatically approved');
select lives_ok($$insert into public.posts (user_id, media_type, tmdb_id, title_name, rating, review)
 values ('11111111-1111-4111-8111-111111111111', 'movie', 100, 'Title', 0.5, repeat('x', 2000))$$, 'half star and 2000 characters accepted');
select throws_ok($$insert into public.posts (user_id, media_type, tmdb_id, title_name, rating)
 values ('11111111-1111-4111-8111-111111111111', 'movie', 101, 'Title', 0.51)$$, '23514', null, 'fractional rating outside half-star increments rejected');
select throws_ok($$insert into public.posts (user_id, media_type, tmdb_id, title_name, rating, review)
 values ('11111111-1111-4111-8111-111111111111', 'movie', 101, 'Title', 4, repeat('x', 2001))$$, '23514', null, 'review over 2000 characters rejected');
select lives_ok($$update public.profiles set visibility = 'private' where user_id = '11111111-1111-4111-8111-111111111111'$$, 'profile may become private');
select is((select status from public.follows), 'following', 'existing follower is retained when becoming private');
select * from finish();
rollback;
