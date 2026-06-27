/**
 * Signaling protocol shared (by convention) between the signaling server and the
 * client. Brokers the WebRTC connection, carries the end-of-match result for
 * authoritative recording, and supports reconnection of an identified player.
 * Gameplay inputs never touch the server.
 */

/** Messages a client sends to the server. */
export type ClientMessage =
  | { type: 'join'; userId?: string; username?: string; mmr?: number }
  /** Opaque WebRTC signaling payload (SDP offer/answer or ICE candidate). */
  | { type: 'signal'; data: unknown }
  /** Final score [player0, player1], reported by both peers at game over. */
  | { type: 'result'; score: [number, number] }
  /** Re-attach to an in-progress match after a disconnect (identified users). */
  | { type: 'rejoin'; matchId: string; userId: string };

/** Messages the server sends to a client. */
export type ServerMessage =
  | {
      type: 'matched';
      matchId: string;
      player: 0 | 1;
      seed: number;
      initiator: boolean;
      opponent?: { userId?: string | undefined; username?: string | undefined };
    }
  | { type: 'signal'; data: unknown }
  /** Opponent dropped but may reconnect within the grace window. */
  | { type: 'peer-disconnected' }
  /** Opponent reconnected; the surviving peer should ship state to resync. */
  | { type: 'peer-reconnected' }
  /** Opponent left permanently (grace expired, or anonymous disconnect). */
  | { type: 'peer-left' }
  | { type: 'recorded'; won: boolean; mmr: number }
  | { type: 'record-error'; message: string };
