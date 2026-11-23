-- The API checks new selections against TMDB's US provider catalog.
alter table public.user_preferences
  drop constraint user_preferences_services_allowed,
  add constraint user_preferences_services_no_nulls
    check (array_position(streaming_services, null) is null);
