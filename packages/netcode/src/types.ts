import type { PlayerInput } from '@glitchgoal/sim';

export type PlayerIndex = 0 | 1;

/**
 * The rollback session is sim-agnostic: it drives whatever simulation you give
 * it through these three callbacks. `S` is your snapshot type (for our hockey
 * sim, an Int32Array from `serialize`).
 */
export interface SessionCallbacks<S> {
  /** Capture the current sim state so it can be restored during a rollback. */
  saveState(): S;
  /** Restore the sim to a previously saved snapshot. */
  loadState(snapshot: S): void;
  /** Advance the sim exactly one fixed timestep with both players' inputs. */
  advanceFrame(inputs: [PlayerInput, PlayerInput]): void;
}

export interface SessionConfig<S> extends SessionCallbacks<S> {
  /** Which player this client controls locally. */
  localPlayer: PlayerIndex;
  /**
   * Frames of input delay. Higher delay trades input lag for fewer rollbacks
   * (local inputs are scheduled `inputDelay` frames in the future). Default 0.
   */
  inputDelay?: number;
  /**
   * How far back we are willing to roll. Must exceed the worst-case round-trip
   * in frames or remote inputs may arrive too late to reconcile. Default 12.
   */
  maxRollbackFrames?: number;
  /**
   * Called when a local input is registered, with the frame it applies to.
   * Wire this to your transport to broadcast the input to the peer.
   */
  onLocalInput?(frame: number, input: PlayerInput): void;
  /**
   * Hash a snapshot, for desync detection. If provided, the session can produce
   * checksums of confirmed frames (confirmedChecksum) and compare a peer's
   * checksum (onRemoteChecksum) to detect divergence.
   */
  checksumSnapshot?(snapshot: S): number;
  /** Called when a remote checksum disagrees with ours at the same frame. */
  onDesync?(frame: number, localChecksum: number, remoteChecksum: number): void;
}

/** A checksum of the simulation state through a fully-confirmed frame. */
export interface FrameChecksum {
  frame: number;
  checksum: number;
}
