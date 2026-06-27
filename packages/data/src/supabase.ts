/**
 * Browser-side Supabase wrapper: anonymous auth, profile management, and the
 * leaderboard. Match results are NOT written here — only the server writes those
 * (with the service-role key) so they can't be forged from the client.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { STARTING_MMR, type LeaderboardEntry, type Profile } from './types.js';

export interface GlitchData {
  client: SupabaseClient;
  /** Sign in anonymously, returning the auth user id. */
  signInAnonymously(): Promise<string>;
  /** Fetch the current user's profile, or null if none yet. */
  getMyProfile(): Promise<Profile | null>;
  /** Create (or rename) the current user's profile with a username. */
  upsertProfile(username: string): Promise<Profile>;
  /** Look up any profile by id (e.g. an opponent). */
  getProfile(id: string): Promise<Profile | null>;
  /** Top players by MMR. */
  getLeaderboard(limit?: number): Promise<LeaderboardEntry[]>;
}

export function createGlitchData(url: string, anonKey: string): GlitchData {
  const client = createClient(url, anonKey);

  const currentUserId = async (): Promise<string> => {
    const { data } = await client.auth.getUser();
    if (!data.user) throw new Error('not signed in');
    return data.user.id;
  };

  return {
    client,

    async signInAnonymously() {
      const { data, error } = await client.auth.signInAnonymously();
      if (error || !data.user) throw error ?? new Error('anonymous sign-in failed');
      return data.user.id;
    },

    async getMyProfile() {
      const id = await currentUserId();
      return this.getProfile(id);
    },

    async getProfile(id: string) {
      const { data, error } = await client
        .from('profiles')
        .select('id, username, mmr, wins, losses')
        .eq('id', id)
        .maybeSingle();
      if (error) throw error;
      return (data as Profile | null) ?? null;
    },

    async upsertProfile(username: string) {
      const id = await currentUserId();
      const { data, error } = await client
        .from('profiles')
        .upsert({ id, username, mmr: STARTING_MMR }, { onConflict: 'id', ignoreDuplicates: false })
        .select('id, username, mmr, wins, losses')
        .single();
      if (error) throw error;
      return data as Profile;
    },

    async getLeaderboard(limit = 20) {
      const { data, error } = await client
        .from('leaderboard')
        .select('id, username, mmr, wins, losses')
        .limit(limit);
      if (error) throw error;
      return (data as LeaderboardEntry[]) ?? [];
    },
  };
}
