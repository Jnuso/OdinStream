-- Security hardening: enforce RLS on profiles and revoke browser access to episode order sequence.

alter table public.profiles force row level security;

revoke all on sequence public.watched_episode_order_seq from public, anon, authenticated;
