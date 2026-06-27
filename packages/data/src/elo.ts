/**
 * Standard Elo rating update. Pure and deterministic so it can run identically
 * on the server (authoritative) and be unit-tested without a database.
 */

const K = 32;

/** Expected score (win probability) of rating `a` against rating `b`. */
export function expectedScore(a: number, b: number): number {
  return 1 / (1 + 10 ** ((b - a) / 400));
}

/**
 * New ratings after a game. `scoreA` is the actual result for player A:
 * 1 = A won, 0 = A lost, 0.5 = draw. Results are rounded to integers.
 */
export function updateRatings(
  ratingA: number,
  ratingB: number,
  scoreA: number,
  k: number = K,
): [number, number] {
  const ea = expectedScore(ratingA, ratingB);
  const newA = Math.round(ratingA + k * (scoreA - ea));
  const newB = Math.round(ratingB + k * (1 - scoreA - (1 - ea)));
  return [newA, newB];
}
