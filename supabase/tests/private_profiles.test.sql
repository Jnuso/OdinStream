begin;
create extension if not exists pgtap with schema extensions;
select plan(17);
grant usage on schema extensions to odin_api;
insert into auth.users (id, email) values
 ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'private@example.test'),
 ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'viewer@example.test'),
 ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'third@example.test');
insert into auth.users (id, email) values
 ('dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'same@example.test'),
 ('ddddddff-dddd-4ddd-8ddd-dddddddddddd', 'same@another.test');
select is((select count(*) from public.profiles where user_id in
 ('dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'ddddddff-dddd-4ddd-8ddd-dddddddddddd')),
 2::bigint, 'similar users both receive profiles');
select is((select count(distinct handle) from public.profiles where user_id in
 ('dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'ddddddff-dddd-4ddd-8ddd-dddddddddddd')),
 2::bigint, 'generated handles differ');
update public.profiles set setup_complete = true, visibility = 'public';
update public.profiles set visibility = 'private' where user_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
insert into public.posts (user_id, media_type, tmdb_id, title_name, rating)
 values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'movie', 1, 'Private title', 5);
set local role odin_api;
select set_config('app.user_id', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', true);
select is((select count(*) from public.posts), 0::bigint, 'non-follower cannot see private posts');
select throws_ok($$insert into public.follows (follower_id, followee_id, status)
 values ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'following')$$,
 '42501', null, 'private account cannot be followed without approval');
select lives_ok($$insert into public.follows (follower_id, followee_id, status)
 values ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'requested')$$, 'request created');
select is((select count(*) from public.posts), 0::bigint, 'pending request cannot see posts');
select lives_ok($$update public.follows set status = 'following' where follower_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'$$, 'requester approval is a no-op');
select is((select status from public.follows where follower_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'), 'requested', 'requester cannot approve themselves');
select set_config('app.user_id', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', true);
select is((select count(*) from public.follows), 0::bigint, 'third party cannot see pending request');
select set_config('app.user_id', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', true);
select is((select count(*) from public.follows where status = 'requested'), 1::bigint, 'recipient can see request');
select lives_ok($$update public.follows set status = 'following' where follower_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'$$, 'recipient can approve');
select throws_ok($$update public.follows set follower_id = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'$$, '42501', null, 'recipient cannot change requester');
select set_config('app.user_id', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', true);
select is((select count(*) from public.posts), 1::bigint, 'approved follower can see private posts');
select set_config('app.user_id', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', true);
select lives_ok($$delete from public.follows where follower_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'$$, 'owner can remove follower');
select set_config('app.user_id', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', true);
select is((select count(*) from public.posts), 0::bigint, 'removed follower loses access');
select lives_ok($$insert into public.follows (follower_id, followee_id, status)
 values ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'requested')$$, 'removed follower may request again');
select lives_ok($$delete from public.follows where follower_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'$$, 'requester can cancel');
select * from finish();
rollback;
