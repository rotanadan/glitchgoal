import { createSignalingServer } from './signaling.js';
import { createSupabaseDb } from './supabaseAdapter.js';

const port = Number(process.env.PORT ?? 8080);
const db = createSupabaseDb(); // null if SUPABASE_* env vars are unset

createSignalingServer(port, db).then((srv) => {
  // eslint-disable-next-line no-console
  console.log(
    `GlitchGoal signaling server listening on ws://localhost:${srv.port}` +
      (db ? ' (match recording: ON)' : ' (match recording: OFF — no Supabase env)'),
  );
});
