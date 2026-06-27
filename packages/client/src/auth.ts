/**
 * Optional Supabase-backed identity for the client.
 *
 * If the VITE_SUPABASE_* env vars are set, we sign in anonymously and ensure the
 * player has a profile (username + MMR). If they're absent, the game still runs
 * fully — just anonymously, with no persistence or leaderboard.
 */

import { createGlitchData, type GlitchData, type LeaderboardEntry, type Profile } from '@glitchgoal/data';

export interface Session {
  data: GlitchData;
  profile: Profile;
  identity: { userId: string; username: string; mmr: number };
}

const URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const ANON = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export function isSupabaseConfigured(): boolean {
  return Boolean(URL && ANON);
}

/** Sign in anonymously and ensure a profile exists, prompting for a username. */
export async function signIn(promptUsername: () => Promise<string>): Promise<Session> {
  if (!URL || !ANON) throw new Error('Supabase not configured');
  const data = createGlitchData(URL, ANON);
  const userId = await data.signInAnonymously();
  let profile = await data.getMyProfile();
  if (!profile) {
    const username = (await promptUsername()).trim().slice(0, 20);
    profile = await data.upsertProfile(username || `player-${userId.slice(0, 6)}`);
  }
  return { data, profile, identity: { userId, username: profile.username, mmr: profile.mmr } };
}

export async function leaderboard(data: GlitchData): Promise<LeaderboardEntry[]> {
  return data.getLeaderboard(10);
}
