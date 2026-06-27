/**
 * GGPO-style rollback session for a 1v1 deterministic sim.
 *
 * The model, each fixed tick:
 *   1. The local player's input for the frame is registered (and emitted to the
 *      peer via onLocalInput).
 *   2. The remote player's input is used if it has arrived; otherwise we PREDICT
 *      it (repeat their last known input) and simulate forward optimistically.
 *   3. When a remote input later arrives for an already-simulated frame and it
 *      disagrees with what we predicted, we ROLL BACK: restore the snapshot from
 *      that frame and re-simulate every frame since with the corrected inputs.
 *
 * Because the sim is deterministic (proven by the sim package's determinism
 * harness), re-simulating from a snapshot with the same inputs reproduces state
 * exactly — so once every remote input has been delivered and reconciled, both
 * peers converge on identical state.
 *
 * Transport is out of scope here: feed remote inputs via onRemoteInput and ship
 * local inputs via the onLocalInput callback. That keeps this layer testable
 * with simulated latency/jitter and reusable over WebRTC (step 5).
 */

import { EMPTY_INPUT, type PlayerInput } from '@glitchgoal/sim';
import type { FrameChecksum, PlayerIndex, SessionConfig } from './types.js';

export class RollbackSession<S> {
  /** Next frame to be simulated. */
  private frame = 0;

  private readonly localPlayer: PlayerIndex;
  private readonly remotePlayer: PlayerIndex;
  private readonly inputDelay: number;
  private readonly maxRollback: number;

  private readonly saveState: () => S;
  private readonly loadState: (s: S) => void;
  private readonly advance: (inputs: [PlayerInput, PlayerInput]) => void;
  private readonly onLocalInput?: (frame: number, input: PlayerInput) => void;
  private readonly checksumSnapshot?: (s: S) => number;
  private readonly onDesync?: (frame: number, local: number, remote: number) => void;

  /** Confirmed inputs by frame. local[] is always known; remote[] arrives late. */
  private readonly local: PlayerInput[] = [];
  private readonly remote: PlayerInput[] = [];
  /** What we actually simulated each frame (for detecting prediction errors). */
  private readonly used: Array<[PlayerInput, PlayerInput]> = [];
  /** Snapshot captured at the start of each frame, for rollback restore. */
  private readonly snapshots = new Map<number, S>();

  /** Highest remote frame confirmed so far (drives prediction). */
  private lastRemoteFrame = -1;
  /** Largest frame f such that remote inputs for 0..f are all confirmed. */
  private confirmedThrough = -1;
  /** Earliest frame needing re-simulation, or null. */
  private pendingRollbackTo: number | null = null;

  /** Diagnostics. */
  rollbackCount = 0;
  predictionErrors = 0;

  constructor(cfg: SessionConfig<S>) {
    this.localPlayer = cfg.localPlayer;
    this.remotePlayer = (cfg.localPlayer === 0 ? 1 : 0) as PlayerIndex;
    this.inputDelay = cfg.inputDelay ?? 0;
    this.maxRollback = cfg.maxRollbackFrames ?? 12;
    this.saveState = cfg.saveState;
    this.loadState = cfg.loadState;
    this.advance = cfg.advanceFrame;
    if (cfg.onLocalInput) this.onLocalInput = cfg.onLocalInput;
    if (cfg.checksumSnapshot) this.checksumSnapshot = cfg.checksumSnapshot;
    if (cfg.onDesync) this.onDesync = cfg.onDesync;

    // Pre-seed the input-delay window with empty inputs so early frames have a
    // local input to read before any delayed input has matured.
    for (let f = 0; f < this.inputDelay; f++) this.local[f] = EMPTY_INPUT;
  }

  /** The frame that will be simulated next. */
  get currentFrame(): number {
    return this.frame;
  }

  /**
   * How many frames we have simulated past the last confirmed remote input —
   * i.e. how many frames are currently running on prediction. Each of these is a
   * potential rollback, so we keep it bounded with shouldStall().
   */
  get framesAhead(): number {
    return Math.max(0, this.frame - 1 - this.lastRemoteFrame);
  }

  /**
   * GGPO-style time sync: returns true when we're too far ahead of confirmed
   * remote inputs and should skip advancing this tick, letting the peer catch up
   * and keeping rollback depth (and the snapshot window) bounded on laggy links.
   */
  shouldStall(maxFramesAhead: number): boolean {
    return this.framesAhead > maxFramesAhead;
  }

  /**
   * A checksum of the simulation through the highest fully-confirmed frame, for
   * desync detection. Returns null if checksums aren't configured or the
   * confirmed snapshot is no longer in the window. Read this AFTER advanceFrame()
   * so any pending rollback has been reconciled into the snapshots.
   */
  confirmedChecksum(): FrameChecksum | null {
    if (!this.checksumSnapshot) return null;
    const f = Math.min(this.confirmedThrough, this.frame - 1);
    if (f < 0) return null;
    const snap = this.stateAfter(f);
    if (snap === undefined) return null;
    return { frame: f, checksum: this.checksumSnapshot(snap) };
  }

  /** Feed a peer's confirmed checksum; raises onDesync if ours disagrees. */
  onRemoteChecksum(frame: number, checksum: number): void {
    if (!this.checksumSnapshot) return;
    const snap = this.stateAfter(frame);
    if (snap === undefined) return; // out of window / not simulated yet
    const local = this.checksumSnapshot(snap);
    if (local !== checksum) this.onDesync?.(frame, local, checksum);
  }

  /**
   * The simulation state AFTER frame f. For an earlier frame that's the snapshot
   * captured at the start of f+1; for the most recently simulated frame it's the
   * current live state (no snapshot has been saved past it yet).
   */
  private stateAfter(f: number): S | undefined {
    if (f === this.frame - 1) return this.saveState();
    return this.snapshots.get(f + 1);
  }

  /**
   * Hard-resync to an agreed snapshot at `frame` (e.g. after a reconnection,
   * where the surviving peer ships its state to the rejoining peer). Everything
   * before `frame` is treated as confirmed; play resumes forward from here.
   */
  resyncTo(frame: number, snapshot: S): void {
    this.loadState(snapshot);
    this.frame = frame;
    this.lastRemoteFrame = frame - 1;
    this.confirmedThrough = frame - 1;
    this.pendingRollbackTo = null;
    this.snapshots.clear();
  }

  /**
   * Register this client's input for the current tick. Call exactly once per
   * tick before advanceFrame(). With inputDelay > 0 it applies to a future frame.
   */
  addLocalInput(input: PlayerInput): void {
    const f = this.frame + this.inputDelay;
    this.local[f] = input;
    this.onLocalInput?.(f, input);
  }

  /** Feed a remote input received from the peer (any frame, any order). */
  onRemoteInput(frame: number, input: PlayerInput): void {
    this.remote[frame] = input;
    if (frame > this.lastRemoteFrame) this.lastRemoteFrame = frame;
    // Extend the contiguous-confirmed prefix as far as inputs now allow.
    while (this.remote[this.confirmedThrough + 1] !== undefined) this.confirmedThrough++;

    // Did this contradict a prediction we already simulated on?
    if (frame < this.frame) {
      const usedThisFrame = this.used[frame];
      if (usedThisFrame && usedThisFrame[this.remotePlayer] !== input) {
        this.predictionErrors++;
        this.pendingRollbackTo =
          this.pendingRollbackTo === null ? frame : Math.min(this.pendingRollbackTo, frame);
      }
    }
  }

  /**
   * Advance the simulation one tick: reconcile any pending rollback, then
   * simulate the new current frame.
   */
  advanceFrame(): void {
    this.reconcile();
    this.simulateOne();
  }

  /**
   * Apply any pending rollback WITHOUT advancing to a new frame. Useful to
   * flush late-arriving inputs (e.g. at end of a match or before reading state)
   * so the visible state reflects all confirmed inputs.
   */
  reconcile(): void {
    if (this.pendingRollbackTo === null) return;
    const to = this.pendingRollbackTo;
    this.pendingRollbackTo = null;

    const snapshot = this.snapshots.get(to);
    if (snapshot === undefined) {
      // Remote input arrived older than our rollback window — unrecoverable
      // without a full state resync (handled at a higher layer in step 7).
      throw new Error(`rollback target frame ${to} is outside the window`);
    }

    const target = this.frame;
    this.loadState(snapshot);
    this.frame = to;
    this.rollbackCount++;
    while (this.frame < target) this.simulateOne();
  }

  /** Resolve the remote input for a frame: confirmed if known, else predicted. */
  private remoteInputFor(frame: number): PlayerInput {
    const confirmed = this.remote[frame];
    if (confirmed !== undefined) return confirmed;
    // Prediction: repeat the most recent confirmed remote input.
    if (this.lastRemoteFrame >= 0) return this.remote[this.lastRemoteFrame]!;
    return EMPTY_INPUT;
  }

  private order(local: PlayerInput, remote: PlayerInput): [PlayerInput, PlayerInput] {
    return this.localPlayer === 0 ? [local, remote] : [remote, local];
  }

  /** Simulate exactly the current frame and advance. */
  private simulateOne(): void {
    const f = this.frame;
    this.snapshots.set(f, this.saveState());

    const localInput = this.local[f] ?? EMPTY_INPUT;
    const remoteInput = this.remoteInputFor(f);
    const inputs = this.order(localInput, remoteInput);
    this.used[f] = inputs;

    this.advance(inputs);
    this.frame++;
    this.prune();
  }

  /** Drop snapshots older than the rollback window to bound memory. */
  private prune(): void {
    const oldest = this.frame - this.maxRollback - 1;
    if (oldest < 0) return;
    this.snapshots.delete(oldest);
  }
}
