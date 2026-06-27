# GlitchGoal

Multiplayer browser-based 2D hockey with a deterministic simulation and
GGPO-style rollback netcode.

## Architecture

- **`packages/sim`** — engine-agnostic deterministic simulation core. No
  rendering, no DOM, no network. Fixed-point (Q16.16) math, seeded RNG,
  serializable state. This is the foundation rollback depends on.
- **`packages/netcode`** — transport-agnostic GGPO-style rollback layer over the
  sim (prediction + rollback, sim injected via callbacks). Includes frame
  advantage time sync (bounds rollback depth), desync detection via confirmed
  checksums, and a resync entry point for reconnection.
- **`packages/client`** — PixiJS renderer + Vite app. Fixed-timestep sim with
  interpolated rendering; NES Ice Hockey-style sprites. Currently local hot-seat.
- **`packages/server`** — WebSocket signaling server: MMR-based matchmaking
  (closest-rating pairing with a widening tolerance), shared-seed assignment,
  WebRTC relay, authoritative match recording + MMR, and reconnection (holds a
  match open for an identified player to rejoin). Off the gameplay path once the
  peer-to-peer DataChannel opens.
- **`packages/data`** — Supabase wrapper (anonymous auth, profiles, leaderboard)
  + pure Elo rating math. Match writes are server-only, enforced by RLS.
- `supabase/schema.sql` — profiles + matches tables, RLS policies, leaderboard
  view. Configure via `.env` (see `.env.example`).

### Why determinism comes first

Rollback netcode requires that `step(state, inputs)` produces *bit-identical*
results on every machine. We prove this offline (determinism test harness)
before any networking exists — that's where these projects usually fail.

## Development

Requires **Node 22+** (supabase-js needs a global `WebSocket`). Use `nvm use`
(an `.nvmrc` is provided).

```bash
nvm use            # Node 22
npm install
npm run build                         # build sim (netcode tests resolve it by name)
npm test                             # determinism harness + gameplay + rollback
npm run typecheck
npm --workspace @glitchgoal/server run dev   # signaling server on :8080
npm --workspace @glitchgoal/client run dev   # then open the client, pick a mode
```

To play online locally: start the server, open the client in two browser tabs,
and click "Find online match" in both.

### Local Supabase (ranked play)

Requires Docker + the Supabase CLI. Bring up the local stack and apply the
schema, then copy the printed keys into `.env` (see `.env.example`):

```bash
npx supabase start          # Postgres/Auth/REST/Studio in Docker
npx supabase db reset       # (re)apply supabase/migrations
```

The schema lives in `supabase/schema.sql` and is mirrored into
`supabase/migrations/`. Without `.env` the game still runs (local hot-seat +
anonymous online play); with it, online matches are ranked and recorded.

## Status

Steps 1–7 complete: deterministic sim + determinism harness, full hockey physics,
GGPO-style rollback netcode (with frame-advantage time sync, desync detection,
and reconnection resync), a PixiJS client with interpolated rendering, WebRTC
peer-to-peer transport, a signaling server with MMR-based matchmaking +
reconnection, and Supabase integration (anonymous auth, profiles, leaderboard,
server-authoritative match recording + Elo MMR). First to 5 goals wins.

Online ranked play needs a Supabase project configured via `.env`; without it
the game still runs fully (local hot-seat + anonymous online play).

The correctness cores (matchmaking, time sync, desync, resync, server-side
reconnection) are unit-tested; the live in-browser reconnection *rejoin* UX is
wired through the protocol but not covered by automated headless tests.
