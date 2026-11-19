begin;
create extension if not exists pgtap with schema extensions;
select plan(8);
grant usage on schema extensions to odin_api;
insert into auth.users (id,email) values
 ('11111111-1111-4111-8111-111111111111','first@example.test'),
 ('22222222-2222-4222-8222-222222222222','second@example.test');
select is((select visibility from public.profiles where user_id = '11111111-1111-4111-8111-111111111111'), 'private', 'new profiles start private');
select is((select setup_complete from public.profiles where user_id = '11111111-1111-4111-8111-111111111111'), false, 'new accounts require setup');
set local role odin_api;
select set_config('app.user_id','11111111-1111-4111-8111-111111111111', true);
select is((select count(*) from public.profiles), 1::bigint, 'other incomplete profile is hidden');
select lives_ok($$update public.profiles set handle='Jack', display_name='Jack', setup_complete=true, visibility='public'
  where user_id='11111111-1111-4111-8111-111111111111'$$, 'account owner can complete setup');
select is((select handle from public.profiles where user_id='11111111-1111-4111-8111-111111111111'), 'Jack', 'username capitalization is retained');
select set_config('app.user_id','22222222-2222-4222-8222-222222222222', true);
select throws_ok($$update public.profiles set handle='jack', setup_complete=true where user_id='22222222-2222-4222-8222-222222222222'$$, '23505', null, 'username collision ignores case');
select lives_ok($$update public.profiles set handle='Jack2', setup_complete=true, visibility='private' where user_id='22222222-2222-4222-8222-222222222222'$$, 'another distinct username is allowed');
select is((select count(*) from public.profiles), 2::bigint, 'completed profiles are visible to signed-in users');
select * from finish();
rollback;
