/**
 * MMR-based matchmaking.
 *
 * Players wait in a queue with their rating. We pair the two closest-rated
 * players whose rating gap fits within a tolerance that WIDENS the longer
 * someone has waited — so a tight gap is found quickly when possible, but nobody
 * waits forever. Pure and time-injected, so it's fully unit-testable.
 *
 * Generic over a `ref` so the signaling layer can attach its socket without this
 * module knowing about WebSockets.
 */

export interface QueueEntry<T> {
  id: string;
  mmr: number;
  joinedAt: number;
  ref: T;
}

export interface MatchmakerOptions {
  /** Rating gap accepted immediately (ms-0 wait). Default 50. */
  baseTolerance?: number;
  /** Additional accepted gap per second of waiting. Default 100. */
  tolerancePerSecond?: number;
}

export class Matchmaker<T> {
  private readonly queue: QueueEntry<T>[] = [];
  private readonly base: number;
  private readonly perSecond: number;

  constructor(opts: MatchmakerOptions = {}) {
    this.base = opts.baseTolerance ?? 50;
    this.perSecond = opts.tolerancePerSecond ?? 100;
  }

  get size(): number {
    return this.queue.length;
  }

  add(entry: QueueEntry<T>): void {
    if (!this.queue.some((e) => e.id === entry.id)) this.queue.push(entry);
  }

  remove(id: string): void {
    const i = this.queue.findIndex((e) => e.id === id);
    if (i >= 0) this.queue.splice(i, 1);
  }

  /** Tolerance an entry will currently accept. */
  private tolerance(e: QueueEntry<T>, now: number): number {
    return this.base + (this.perSecond * Math.max(0, now - e.joinedAt)) / 1000;
  }

  /**
   * Find the best matchable pair right now, remove them from the queue, and
   * return them. A pair is matchable if its rating gap is within EITHER player's
   * (widening) tolerance — i.e. one of them has waited long enough to accept it.
   * Among all matchable pairs we choose the smallest gap.
   */
  tryMatch(now: number): [QueueEntry<T>, QueueEntry<T>] | null {
    if (this.queue.length < 2) return null;

    // Closest gaps are between adjacent entries once sorted by rating.
    const sorted = [...this.queue].sort((a, b) => a.mmr - b.mmr);
    let best: { a: QueueEntry<T>; b: QueueEntry<T>; gap: number } | null = null;
    for (let i = 0; i + 1 < sorted.length; i++) {
      const a = sorted[i]!;
      const b = sorted[i + 1]!;
      const gap = b.mmr - a.mmr;
      const accept = Math.max(this.tolerance(a, now), this.tolerance(b, now));
      if (gap <= accept && (best === null || gap < best.gap)) best = { a, b, gap };
    }

    if (!best) return null;
    this.remove(best.a.id);
    this.remove(best.b.id);
    return [best.a, best.b];
  }
}
