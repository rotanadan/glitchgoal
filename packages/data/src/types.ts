/** A player's persistent profile. */
export interface Profile {
  id: string;
  username: string;
  mmr: number;
  wins: number;
  losses: number;
}

/** A leaderboard row (subset of Profile). */
export interface LeaderboardEntry {
  id: string;
  username: string;
  mmr: number;
  wins: number;
  losses: number;
}

/** A completed match, as persisted. */
export interface MatchRecord {
  player0: string;
  player1: string;
  score0: number;
  score1: number;
  winner: 0 | 1;
  seed: number;
}

export const STARTING_MMR = 1000;
