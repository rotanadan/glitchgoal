import { describe, it, expect } from 'vitest';
import { expectedScore, updateRatings } from '../src/elo.js';

describe('elo', () => {
  it('gives equal players a 50% expectation', () => {
    expect(expectedScore(1000, 1000)).toBeCloseTo(0.5, 5);
  });

  it('favors the higher-rated player', () => {
    expect(expectedScore(1200, 1000)).toBeGreaterThan(0.5);
    expect(expectedScore(1000, 1200)).toBeLessThan(0.5);
  });

  it('moves equal players by +/-16 with K=32 on a win', () => {
    const [a, b] = updateRatings(1000, 1000, 1);
    expect(a).toBe(1016);
    expect(b).toBe(984);
  });

  it('conserves total rating (zero-sum) for equal players', () => {
    const [a, b] = updateRatings(1000, 1000, 1);
    expect(a + b).toBe(2000);
  });

  it('rewards an underdog win more than a favorite win', () => {
    const underdog = updateRatings(900, 1100, 1)[0] - 900;
    const favorite = updateRatings(1100, 900, 1)[0] - 1100;
    expect(underdog).toBeGreaterThan(favorite);
  });
});
