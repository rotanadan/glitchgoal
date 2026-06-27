/**
 * WebSocket signaling client. Connects, requests a match (carrying identity +
 * MMR), brokers WebRTC, relays the end-of-match result, and surfaces
 * disconnect/reconnect events for the reconnection flow.
 */

import type { Identity, MatchInfo, ServerMessage } from './protocol.js';

export interface RecordedResult {
  won: boolean;
  mmr: number;
}

export class SignalingClient {
  private ws?: WebSocket;

  onSignal?: (data: unknown) => void;
  onPeerLeft?: () => void;
  onPeerDisconnected?: () => void;
  onPeerReconnected?: () => void;
  onRecorded?: (result: RecordedResult) => void;
  onRecordError?: (message: string) => void;

  /** Connect, send `join`, and resolve once the server reports a match. */
  connect(url: string, identity?: Identity): Promise<MatchInfo> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url);
      this.ws = ws;
      ws.onopen = () =>
        ws.send(
          JSON.stringify({
            type: 'join',
            userId: identity?.userId,
            username: identity?.username,
            mmr: identity?.mmr,
          }),
        );
      ws.onerror = () => reject(new Error('signaling connection failed'));
      ws.onmessage = (ev) => this.route(JSON.parse(ev.data as string) as ServerMessage, resolve);
    });
  }

  private route(msg: ServerMessage, resolveMatch: (m: MatchInfo) => void): void {
    switch (msg.type) {
      case 'matched':
        resolveMatch({ matchId: msg.matchId, player: msg.player, seed: msg.seed, initiator: msg.initiator, opponent: msg.opponent });
        break;
      case 'signal':
        this.onSignal?.(msg.data);
        break;
      case 'peer-disconnected':
        this.onPeerDisconnected?.();
        break;
      case 'peer-reconnected':
        this.onPeerReconnected?.();
        break;
      case 'peer-left':
        this.onPeerLeft?.();
        break;
      case 'recorded':
        this.onRecorded?.({ won: msg.won, mmr: msg.mmr });
        break;
      case 'record-error':
        this.onRecordError?.(msg.message);
        break;
    }
  }

  sendSignal(data: unknown): void {
    this.ws?.send(JSON.stringify({ type: 'signal', data }));
  }

  sendResult(score: [number, number]): void {
    this.ws?.send(JSON.stringify({ type: 'result', score }));
  }

  /** Re-attach to an in-progress match after reconnecting the socket. */
  sendRejoin(matchId: string, userId: string): void {
    this.ws?.send(JSON.stringify({ type: 'rejoin', matchId, userId }));
  }

  close(): void {
    this.ws?.close();
  }
}
