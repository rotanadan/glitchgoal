-- GlitchGoal database schema.
--
-- Apply via the Supabase SQL editor or `supabase db push`. Auth is handled by
-- Supabase Auth (we use anonymous sign-in + a chosen username). Match results
-- are written ONLY by the signaling server using the service-role key, so
-- clients cannot fabricate wins or MMR — RLS forbids client writes to matches.

-- Profiles: one row per auth user.
create table if not exists public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  username    text not null unique check (char_length(username) between 2 and 20),
  mmr         integer not null default 1000,
  wins        integer not null default 0,
  losses      integer not null default 0,
  created_at  timestamptz not null default now()
);

-- Matches: append-only history of completed games.
create table if not exists public.matches (
  id          uuid primary key default gen_random_uuid(),
  player0     uuid not null references public.profiles (id),
  player1     uuid not null references public.profiles (id),
  score0      integer not null,
  score1      integer not null,
  winner      smallint not null check (winner in (0, 1)),
  seed        integer not null,
  created_at  timestamptz not null default now()
);

create index if not exists matches_player0_idx on public.matches (player0);
create index if not exists matches_player1_idx on public.matches (player1);
create index if not exists profiles_mmr_idx on public.profiles (mmr desc);

-- Leaderboard view.
create or replace view public.leaderboard as
  select id, username, mmr, wins, losses
  from public.profiles
  order by mmr desc;

-- Row Level Security ------------------------------------------------------

alter table public.profiles enable row level security;
alter table public.matches  enable row level security;

-- Anyone (incl. anon) may read profiles (for the leaderboard / opponent names).
drop policy if exists "profiles readable" on public.profiles;
create policy "profiles readable"
  on public.profiles for select using (true);

-- A user may create and update only their own profile (username, etc.).
drop policy if exists "own profile insert" on public.profiles;
create policy "own profile insert"
  on public.profiles for insert with check (auth.uid() = id);

drop policy if exists "own profile update" on public.profiles;
create policy "own profile update"
  on public.profiles for update using (auth.uid() = id) with check (auth.uid() = id);

-- Matches are readable by all; NO client insert/update policy exists, so only
-- the service-role key (which bypasses RLS) can write them.
drop policy if exists "matches readable" on public.matches;
create policy "matches readable"
  on public.matches for select using (true);

-- Table-level privileges. RLS filters rows, but the API roles still need base
-- GRANTs on tables created via migration (as the postgres owner).
grant usage on schema public to anon, authenticated;
grant select on public.profiles to anon, authenticated;
grant insert, update on public.profiles to authenticated;
grant select on public.matches to anon, authenticated;
grant select on public.leaderboard to anon, authenticated;

-- The signaling server uses the service-role key to record matches + MMR.
grant usage on schema public to service_role;
grant select, insert, update on public.profiles to service_role;
grant select, insert on public.matches to service_role;
