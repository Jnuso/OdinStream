-- Direct browser access remains revoked. The backend sets app.user_id from a
-- verified token for each transaction, and verifies TMDB before inserting.
alter table public.saved_titles force row level security;
grant select, insert, update, delete on public.saved_titles to odin_api;

create policy saved_titles_api_select_own on public.saved_titles
  for select to odin_api
  using (user_id = nullif(current_setting('app.user_id', true), '')::uuid);
create policy saved_titles_api_insert_own on public.saved_titles
  for insert to odin_api
  with check (user_id = nullif(current_setting('app.user_id', true), '')::uuid);
create policy saved_titles_api_update_own on public.saved_titles
  for update to odin_api
  using (user_id = nullif(current_setting('app.user_id', true), '')::uuid)
  with check (user_id = nullif(current_setting('app.user_id', true), '')::uuid);
create policy saved_titles_api_delete_own on public.saved_titles
  for delete to odin_api
  using (user_id = nullif(current_setting('app.user_id', true), '')::uuid);
