/**
 * Authoritative match recording + MMR update.
 *
 * The two peers each report their final score to the server. We only record a
 * result when BOTH reported and AGREE (the deterministic sim guarantees they
 * should), and only when the score is a valid finished game. The actual database
 * access is abstracted behind DbPort so this orchestration is unit-testable
 * without Supabase and so the trust-sensitive Elo math runs server-side only.
 */

import { updateRatings, STARTING_MMR, type MatchRecord } from '@glitchgoal/data';
import { WIN_GOALS } from '@glitchgoal/sim';

export interface DbProfile {
  mmr: number;
  wins: number;
  losses: number;
}

export interface DbPort {
  getProfile(userId: string): Promise<DbProfile | null>;
  insertMatch(record: MatchRecord): Promise<void>;
  updateProfile(userId: string, patch: DbProfile): Promise<void>;
}

export interface MatchOutcome {
  winnerId: string;
  loserId: string;
  newMmr: { [userId: string]: number };
}

/** True if [score0, score1] is a valid finished game (one side reached WIN_GOALS). */
export function isValidFinalScore(score0: number, score1: number): boolean {
  if (score0 < 0 || score1 < 0) return false;
  if (score0 === score1) return false;
  return Math.max(score0, score1) === WIN_GOALS;
}

/**
 * Validate, persist, and update MMR for a completed match. Returns the outcome,
 * or throws if the score is invalid. Missing profiles default to STARTING_MMR so
 * a result is never lost just because a profile row was absent.
 */
export async function recordMatch(
  db: DbPort,
  args: { player0: string; player1: string; score0: number; score1: number; seed: number },
): Promise<MatchOutcome> {
  const { player0, player1, score0, score1, seed } = args;
  if (!isValidFinalScore(score0, score1)) {
    throw new Error(`invalid final score ${score0}-${score1}`);
  }

  const winner: 0 | 1 = score0 > score1 ? 0 : 1;
  const record: MatchRecord = { player0, player1, score0, score1, winner, seed };
  await db.insertMatch(record);

  const p0 = (await db.getProfile(player0)) ?? defaultProfile();
  const p1 = (await db.getProfile(player1)) ?? defaultProfile();

  // scoreA is player0's result: 1 if player0 won, else 0.
  const [mmr0, mmr1] = updateRatings(p0.mmr, p1.mmr, winner === 0 ? 1 : 0);

  await db.updateProfile(player0, {
    mmr: mmr0,
    wins: p0.wins + (winner === 0 ? 1 : 0),
    losses: p0.losses + (winner === 0 ? 0 : 1),
  });
  await db.updateProfile(player1, {
    mmr: mmr1,
    wins: p1.wins + (winner === 1 ? 1 : 0),
    losses: p1.losses + (winner === 1 ? 0 : 1),
  });

  return {
    winnerId: winner === 0 ? player0 : player1,
    loserId: winner === 0 ? player1 : player0,
    newMmr: { [player0]: mmr0, [player1]: mmr1 },
  };
}

function defaultProfile(): DbProfile {
  return { mmr: STARTING_MMR, wins: 0, losses: 0 };
}
