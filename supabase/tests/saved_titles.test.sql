begin;
create extension if not exists pgtap with schema extensions;
select plan(26);

select ok(not has_table_privilege('authenticated', 'public.saved_titles', 'SELECT'), 'clients have no direct select privilege');
select ok(not has_table_privilege('authenticated', 'public.saved_titles', 'INSERT'), 'clients cannot bypass TMDB verification with direct inserts');
select ok(not has_table_privilege('authenticated', 'public.saved_titles', 'UPDATE'), 'clients have no direct update privilege');
select ok(not has_table_privilege('authenticated', 'public.saved_titles', 'DELETE'), 'clients have no direct delete privilege');
-- Temporarily grant access only inside this rolled-back test transaction so
-- policies are tested under the non-bypass authenticated role.
grant select, insert, update, delete on public.saved_titles to authenticated;

insert into auth.users (id, email) values
  ('11111111-1111-4111-8111-111111111111', 'user-a@example.test'),
  ('22222222-2222-4222-8222-222222222222', 'user-b@example.test');

select set_config('request.jwt.claim.sub', '11111111-1111-4111-8111-111111111111', true);
set local role authenticated;
select lives_ok($$insert into public.saved_titles (user_id, media_type, tmdb_id, status)
  values ('11111111-1111-4111-8111-111111111111', 'movie', 42, 'watchlist')$$, 'owner can save a movie');
select throws_ok($$insert into public.saved_titles (user_id, media_type, tmdb_id, status)
  values ('11111111-1111-4111-8111-111111111111', 'movie', 42, 'watched')$$, '23505', null, 'duplicate rejected');
select lives_ok($$insert into public.saved_titles (user_id, media_type, tmdb_id, status)
  values ('11111111-1111-4111-8111-111111111111', 'tv', 42, 'watching')$$, 'same numeric id is distinct across media types');
select throws_ok($$insert into public.saved_titles (user_id, media_type, tmdb_id, status)
  values ('11111111-1111-4111-8111-111111111111', 'movie', 0, 'watchlist')$$, '23514', null, 'nonpositive TMDB id rejected');
select throws_ok($$insert into public.saved_titles (user_id, media_type, tmdb_id, status)
  values ('11111111-1111-4111-8111-111111111111', 'movie', 1, 'watching')$$, '23514', null, 'invalid status for movie rejected');
select throws_ok($$insert into public.saved_titles (user_id, media_type, tmdb_id, status)
  values ('22222222-2222-4222-8222-222222222222', 'tv', 1, 'watchlist')$$, '42501', null, 'cannot insert for another user');
select throws_ok($$update public.saved_titles set user_id = '22222222-2222-4222-8222-222222222222'
  where media_type = 'movie' and tmdb_id = 42$$, '42501', null, 'cannot transfer ownership');
select lives_ok($$update public.saved_titles set status = 'watched' where media_type = 'movie' and tmdb_id = 42$$, 'owner can update');
select is((select status from public.saved_titles where media_type = 'movie' and tmdb_id = 42), 'watched', 'status persisted');
select lives_ok($$update public.saved_titles set updated_at = '2000-01-01T00:00:00Z' where media_type = 'movie' and tmdb_id = 42$$, 'owner can update an entry');
select is((select updated_at from public.saved_titles where media_type = 'movie' and tmdb_id = 42), now(), 'update timestamp is set by the database');
select lives_ok($$delete from public.saved_titles where media_type = 'tv' and tmdb_id = 42$$, 'owner can delete an entry');
select is((select count(*) from public.saved_titles), 1::bigint, 'deleted entry is removed');
select lives_ok($$insert into public.saved_titles (user_id, media_type, tmdb_id, status)
  values ('11111111-1111-4111-8111-111111111111', 'tv', 42, 'watching')$$, 'owner can save a deleted title again');

select set_config('request.jwt.claim.sub', '22222222-2222-4222-8222-222222222222', true);
select is((select count(*) from public.saved_titles), 0::bigint, 'other user cannot see records');
select lives_ok($$delete from public.saved_titles$$, 'other user deletion does not raise an error');
select lives_ok($$update public.saved_titles set status = 'watched'$$, 'other user update does not raise an error');
select lives_ok($$insert into public.saved_titles (user_id, media_type, tmdb_id, status)
  values ('22222222-2222-4222-8222-222222222222', 'movie', 42, 'watchlist')$$, 'another user can save same title');
reset role;
select is((select count(*) from public.saved_titles where user_id = '11111111-1111-4111-8111-111111111111'), 2::bigint, 'other user cannot update or delete records');
select ok(not has_table_privilege('anon', 'public.saved_titles', 'SELECT'), 'anonymous role cannot select records');
delete from auth.users where id = '11111111-1111-4111-8111-111111111111';
select is((select count(*) from public.saved_titles where user_id = '11111111-1111-4111-8111-111111111111'), 0::bigint, 'deleting account cascades');
select is((select count(*) from public.saved_titles where user_id = '22222222-2222-4222-8222-222222222222'), 1::bigint, 'other user records remain');

select * from finish();
rollback;
