-- Seed data for local development. Runs automatically on `supabase db reset`.
--
-- The game uses anonymous auth, so these are seeded as anonymous auth.users with
-- matching profiles (you can't "log in" as them — each real session creates its
-- own anonymous user). They exist to populate the leaderboard and give the
-- match history something to show. Idempotent: safe to re-run.

-- Fixed UUIDs so re-seeding is stable.
insert into auth.users (instance_id, id, aud, role, created_at, updated_at, raw_app_meta_data, raw_user_meta_data, is_anonymous)
values
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-0000000000a1', 'authenticated', 'authenticated', now(), now(), '{}', '{}', true),
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-0000000000a2', 'authenticated', 'authenticated', now(), now(), '{}', '{}', true),
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-0000000000a3', 'authenticated', 'authenticated', now(), now(), '{}', '{}', true),
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-0000000000a4', 'authenticated', 'authenticated', now(), now(), '{}', '{}', true),
  ('00000000-0000-0000-0000-000000000000', '00000000-0000-0000-0000-0000000000a5', 'authenticated', 'authenticated', now(), now(), '{}', '{}', true)
on conflict (id) do nothing;

insert into public.profiles (id, username, mmr, wins, losses) values
  ('00000000-0000-0000-0000-0000000000a1', 'Gretzky99',  1420, 24, 4),
  ('00000000-0000-0000-0000-0000000000a2', 'BobbyOrr4',  1310, 18, 7),
  ('00000000-0000-0000-0000-0000000000a3', 'Lemieux66',  1255, 14, 9),
  ('00000000-0000-0000-0000-0000000000a4', 'PatrickRoy', 1080,  9, 11),
  ('00000000-0000-0000-0000-0000000000a5', 'RinkRookie',  940,  2, 8)
on conflict (id) do nothing;

-- A little match history between the seeded players.
insert into public.matches (player0, player1, score0, score1, winner, seed) values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000a5', 5, 1, 0, 101),
  ('00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-0000000000a3', 5, 3, 0, 102),
  ('00000000-0000-0000-0000-0000000000a3', '00000000-0000-0000-0000-0000000000a4', 2, 5, 1, 103)
on conflict do nothing;
