alter table public.profiles
  add column picture_jpeg bytea
  check (octet_length(picture_jpeg) between 4 and 45000);
