import { describe, it, expect } from 'vitest';
import { Matchmaker } from '../src/matchmaker.js';

const entry = (id: string, mmr: number, joinedAt: number) => ({ id, mmr, joinedAt, ref: id });

describe('Matchmaker', () => {
  it('matches two close-rated players immediately', () => {
    const mm = new Matchmaker<string>({ baseTolerance: 50, tolerancePerSecond: 100 });
    mm.add(entry('a', 1000, 0));
    mm.add(entry('b', 1030, 0));
    const pair = mm.tryMatch(0);
    expect(pair).not.toBeNull();
    expect(pair!.map((e) => e.id).sort()).toEqual(['a', 'b']);
    expect(mm.size).toBe(0);
  });

  it('does NOT match far-apart players until tolerance widens with waiting', () => {
    const mm = new Matchmaker<string>({ baseTolerance: 50, tolerancePerSecond: 100 });
    mm.add(entry('a', 1000, 0));
    mm.add(entry('b', 1400, 0)); // gap 400
    expect(mm.tryMatch(0)).toBeNull(); // 400 > 50
    expect(mm.tryMatch(1000)).toBeNull(); // tol 150 still < 400
    const pair = mm.tryMatch(4000); // tol 50 + 400 = 450 >= 400
    expect(pair).not.toBeNull();
    expect(mm.size).toBe(0);
  });

  it('chooses the closest-rated pair among several waiting', () => {
    const mm = new Matchmaker<string>({ baseTolerance: 1000, tolerancePerSecond: 0 });
    mm.add(entry('low', 1000, 0));
    mm.add(entry('mid', 1500, 0));
    mm.add(entry('mid2', 1520, 0));
    mm.add(entry('high', 1900, 0));
    const pair = mm.tryMatch(0);
    expect(pair!.map((e) => e.id).sort()).toEqual(['mid', 'mid2']);
    // The other two remain queued.
    expect(mm.size).toBe(2);
  });

  it('removes a player who leaves the queue', () => {
    const mm = new Matchmaker<string>();
    mm.add(entry('a', 1000, 0));
    mm.add(entry('b', 1000, 0));
    mm.remove('a');
    expect(mm.size).toBe(1);
    expect(mm.tryMatch(0)).toBeNull();
  });

  it('is idempotent on duplicate add', () => {
    const mm = new Matchmaker<string>();
    mm.add(entry('a', 1000, 0));
    mm.add(entry('a', 1000, 0));
    expect(mm.size).toBe(1);
  });
});
