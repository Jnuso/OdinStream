-- Privacy is enforced for every query under the API role. Existing accounts stay public.
alter table public.profiles add column visibility text not null default 'public'
  check (visibility in ('public', 'private'));
alter table public.follows add column status text not null default 'following'
  check (status in ('following', 'requested'));

-- New signups retry if a generated handle is already taken.
create or replace function public.create_profile_for_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  candidate text;
  display text;
begin
  display := coalesce(nullif(btrim(split_part(coalesce(new.email, ''), '@', 1)), ''), 'Viewer');
  loop
    candidate := 'u' || left(replace(gen_random_uuid()::text, '-', ''), 29);
    begin
      insert into public.profiles (user_id, display_name, handle)
      values (new.id, left(initcap(display), 60), candidate)
      on conflict (user_id) do nothing;
      exit;
    exception when unique_violation then
      null;
    end;
  end loop;
  return new;
end;
$$;

drop policy posts_select_public on public.posts;
create policy posts_select_visible on public.posts for select to odin_api using (
  user_id = nullif(current_setting('app.user_id', true), '')::uuid
  or exists (select 1 from public.profiles p where p.user_id = posts.user_id and p.visibility = 'public')
  or exists (select 1 from public.follows f where f.followee_id = posts.user_id
    and f.follower_id = nullif(current_setting('app.user_id', true), '')::uuid
    and f.status = 'following')
);

drop policy follows_select_public on public.follows;
create policy follows_select_visible on public.follows for select to odin_api using (
  status = 'following' or follower_id = nullif(current_setting('app.user_id', true), '')::uuid
  or followee_id = nullif(current_setting('app.user_id', true), '')::uuid
);
drop policy follows_insert_own on public.follows;
create policy follows_insert_own on public.follows for insert to odin_api with check (
  follower_id = nullif(current_setting('app.user_id', true), '')::uuid
  and ((status = 'requested' and exists (select 1 from public.profiles p where p.user_id = followee_id and p.visibility = 'private'))
    or (status = 'following' and exists (select 1 from public.profiles p where p.user_id = followee_id and p.visibility = 'public')))
);
drop policy follows_delete_own on public.follows;
create policy follows_delete_participant on public.follows for delete to odin_api using (
  follower_id = nullif(current_setting('app.user_id', true), '')::uuid
  or followee_id = nullif(current_setting('app.user_id', true), '')::uuid
);
grant update (status) on public.follows to odin_api;
create policy follows_approve on public.follows for update to odin_api
  using (followee_id = nullif(current_setting('app.user_id', true), '')::uuid and status = 'requested')
  with check (followee_id = nullif(current_setting('app.user_id', true), '')::uuid and status = 'following');
