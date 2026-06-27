import { describe, it, expect } from 'vitest';
import { recordMatch, isValidFinalScore, type DbPort, type DbProfile } from '../src/matchRecorder.js';
import type { MatchRecord } from '@glitchgoal/data';

/** In-memory DbPort for testing the recorder without Supabase. */
function memoryDb(initial: Record<string, DbProfile> = {}) {
  const profiles = new Map<string, DbProfile>(Object.entries(initial));
  const matches: MatchRecord[] = [];
  const db: DbPort = {
    getProfile: async (id) => profiles.get(id) ?? null,
    insertMatch: async (r) => {
      matches.push(r);
    },
    updateProfile: async (id, patch) => {
      profiles.set(id, patch);
    },
  };
  return { db, profiles, matches };
}

describe('isValidFinalScore', () => {
  it('accepts a finished game and rejects unfinished / tied / negative', () => {
    expect(isValidFinalScore(5, 3)).toBe(true);
    expect(isValidFinalScore(2, 5)).toBe(true);
    expect(isValidFinalScore(4, 3)).toBe(false); // nobody reached WIN_GOALS
    expect(isValidFinalScore(5, 5)).toBe(false); // tie impossible
    expect(isValidFinalScore(5, 6)).toBe(false); // overshoot / inconsistent
    expect(isValidFinalScore(-1, 5)).toBe(false);
  });
});

describe('recordMatch', () => {
  it('records the match, sets the winner, and updates both ratings', async () => {
    const { db, profiles, matches } = memoryDb({
      alice: { mmr: 1000, wins: 0, losses: 0 },
      bob: { mmr: 1000, wins: 0, losses: 0 },
    });

    const outcome = await recordMatch(db, {
      player0: 'alice',
      player1: 'bob',
      score0: 5,
      score1: 2,
      seed: 42,
    });

    expect(outcome.winnerId).toBe('alice');
    expect(outcome.loserId).toBe('bob');
    expect(matches).toHaveLength(1);
    expect(matches[0]).toMatchObject({ winner: 0, score0: 5, score1: 2 });

    expect(profiles.get('alice')).toEqual({ mmr: 1016, wins: 1, losses: 0 });
    expect(profiles.get('bob')).toEqual({ mmr: 984, wins: 0, losses: 1 });
  });

  it('defaults missing profiles to the starting rating', async () => {
    const { db, profiles } = memoryDb(); // no profiles seeded
    await recordMatch(db, { player0: 'x', player1: 'y', score0: 1, score1: 5, seed: 1 });
    expect(profiles.get('y')!.mmr).toBeGreaterThan(1000); // winner gained
    expect(profiles.get('x')!.mmr).toBeLessThan(1000); // loser lost
  });

  it('throws on an invalid final score and records nothing', async () => {
    const { db, matches } = memoryDb();
    await expect(
      recordMatch(db, { player0: 'a', player1: 'b', score0: 3, score1: 3, seed: 1 }),
    ).rejects.toThrow();
    expect(matches).toHaveLength(0);
  });
});
