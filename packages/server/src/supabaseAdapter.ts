/**
 * DbPort backed by Supabase using the SERVICE-ROLE key. This bypasses RLS, so
 * it must only ever run on the server — never ship the service-role key to the
 * client. Returns null (no-op recorder) if env vars are absent, so the server
 * still runs for local/anonymous play without a database.
 */

import { createClient } from '@supabase/supabase-js';
import type { MatchRecord } from '@glitchgoal/data';
import type { DbPort, DbProfile } from './matchRecorder.js';

// Requires Node 22+ (global WebSocket), which supabase-js's Realtime client
// needs. Pinned via .nvmrc / package.json "engines".

export function createSupabaseDb(): DbPort | null {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;

  const client = createClient(url, key, { auth: { persistSession: false } });

  return {
    async getProfile(userId: string): Promise<DbProfile | null> {
      const { data, error } = await client
        .from('profiles')
        .select('mmr, wins, losses')
        .eq('id', userId)
        .maybeSingle();
      if (error) throw error;
      return (data as DbProfile | null) ?? null;
    },

    async insertMatch(record: MatchRecord): Promise<void> {
      const { error } = await client.from('matches').insert(record);
      if (error) throw error;
    },

    async updateProfile(userId: string, patch: DbProfile): Promise<void> {
      const { error } = await client.from('profiles').update(patch).eq('id', userId);
      if (error) throw error;
    },
  };
}
