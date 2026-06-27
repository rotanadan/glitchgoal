/**
 * WebRTC DataChannel transport for gameplay inputs, desync checksums, and
 * reconnection state-resyncs. The channel is unreliable + unordered
 * (maxRetransmits: 0, ordered: false) — GGPO-over-UDP semantics. The initiator
 * creates the channel + offer; the other peer answers.
 */

import { SignalingClient } from './signaling.js';
import {
  ICE_SERVERS,
  Tag,
  decodeMessage,
  encodeChecksum,
  encodeInputs,
  encodeState,
  type InputEntry,
} from './protocol.js';

export class WebRtcTransport {
  private readonly pc: RTCPeerConnection;
  private channel?: RTCDataChannel;
  private pendingReady?: () => void;

  onInput?: (frame: number, input: number) => void;
  onChecksum?: (frame: number, checksum: number) => void;
  onState?: (frame: number, snapshot: Int32Array) => void;

  constructor(
    private readonly signaling: SignalingClient,
    private readonly initiator: boolean,
  ) {
    this.pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    this.pc.onicecandidate = (e) => {
      if (e.candidate) this.signaling.sendSignal({ candidate: e.candidate });
    };
    this.pc.ondatachannel = (e) => this.attachChannel(e.channel);
    this.signaling.onSignal = (data) => void this.handleSignal(data);
  }

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.initiator) {
        const ch = this.pc.createDataChannel('inputs', { ordered: false, maxRetransmits: 0 });
        this.attachChannel(ch, resolve);
        void this.pc
          .createOffer()
          .then((offer) => this.pc.setLocalDescription(offer))
          .then(() => this.signaling.sendSignal({ sdp: this.pc.localDescription }))
          .catch(reject);
      } else {
        this.pendingReady = resolve;
      }
    });
  }

  private attachChannel(ch: RTCDataChannel, onOpen?: () => void): void {
    ch.binaryType = 'arraybuffer';
    this.channel = ch;
    const open = onOpen ?? this.pendingReady;
    ch.onopen = () => open?.();
    ch.onmessage = (e) => {
      const msg = decodeMessage(e.data as ArrayBuffer);
      if (!msg) return;
      if (msg.tag === Tag.Inputs) for (const en of msg.entries) this.onInput?.(en.frame, en.input);
      else if (msg.tag === Tag.Checksum) this.onChecksum?.(msg.frame, msg.checksum);
      else if (msg.tag === Tag.State) this.onState?.(msg.frame, msg.snapshot);
    };
  }

  private async handleSignal(data: unknown): Promise<void> {
    const sig = data as { sdp?: RTCSessionDescriptionInit; candidate?: RTCIceCandidateInit };
    if (sig.sdp) {
      await this.pc.setRemoteDescription(sig.sdp);
      if (sig.sdp.type === 'offer') {
        const answer = await this.pc.createAnswer();
        await this.pc.setLocalDescription(answer);
        this.signaling.sendSignal({ sdp: this.pc.localDescription });
      }
    } else if (sig.candidate) {
      try {
        await this.pc.addIceCandidate(sig.candidate);
      } catch {
        /* candidate may arrive before remote description; ignore */
      }
    }
  }

  private get isOpen(): boolean {
    return this.channel?.readyState === 'open';
  }

  sendInputs(entries: InputEntry[]): void {
    if (this.isOpen && entries.length > 0) this.channel!.send(encodeInputs(entries));
  }

  sendChecksum(frame: number, checksum: number): void {
    if (this.isOpen) this.channel!.send(encodeChecksum(frame, checksum));
  }

  /** Ship full state to a reconnecting peer for resync. */
  sendState(frame: number, snapshot: Int32Array): void {
    if (this.isOpen) this.channel!.send(encodeState(frame, snapshot));
  }

  close(): void {
    this.channel?.close();
    this.pc.close();
  }
}
