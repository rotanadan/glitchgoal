/**
 * Client-side mirror of the signaling protocol + the DataChannel wire formats.
 *
 * The DataChannel is UNRELIABLE + UNORDERED (like UDP). Every message starts
 * with a 1-byte tag so inputs, desync checksums, and reconnection state-resyncs
 * can share the channel. Input packets carry a window of recent inputs, so a
 * single dropped packet self-heals on the next one.
 */

export interface Identity {
  userId: string;
  username: string;
  mmr: number;
}

export interface MatchInfo {
  matchId: string;
  player: 0 | 1;
  seed: number;
  initiator: boolean;
  opponent?: { userId?: string; username?: string } | undefined;
}

export type ServerMessage =
  | {
      type: 'matched';
      matchId: string;
      player: 0 | 1;
      seed: number;
      initiator: boolean;
      opponent?: { userId?: string; username?: string };
    }
  | { type: 'signal'; data: unknown }
  | { type: 'peer-disconnected' }
  | { type: 'peer-reconnected' }
  | { type: 'peer-left' }
  | { type: 'recorded'; won: boolean; mmr: number }
  | { type: 'record-error'; message: string };

export const ICE_SERVERS: RTCIceServer[] = [{ urls: 'stun:stun.l.google.com:19302' }];

export const INPUT_REDUNDANCY = 8;

export interface InputEntry {
  frame: number;
  input: number;
}

/** DataChannel message tags. */
export const enum Tag {
  Inputs = 0,
  Checksum = 1,
  State = 2,
}

export function encodeInputs(entries: InputEntry[]): ArrayBuffer {
  const buf = new ArrayBuffer(1 + entries.length * 5);
  const dv = new DataView(buf);
  dv.setUint8(0, Tag.Inputs);
  entries.forEach((e, i) => {
    dv.setInt32(1 + i * 5, e.frame, true);
    dv.setUint8(1 + i * 5 + 4, e.input & 0xff);
  });
  return buf;
}

export function encodeChecksum(frame: number, checksum: number): ArrayBuffer {
  const buf = new ArrayBuffer(1 + 8);
  const dv = new DataView(buf);
  dv.setUint8(0, Tag.Checksum);
  dv.setInt32(1, frame, true);
  dv.setInt32(5, checksum | 0, true);
  return buf;
}

/** Reconnection resync: a frame + the serialized snapshot (Int32Array bytes). */
export function encodeState(frame: number, snapshot: Int32Array): ArrayBuffer {
  const buf = new ArrayBuffer(1 + 4 + snapshot.byteLength);
  const dv = new DataView(buf);
  dv.setUint8(0, Tag.State);
  dv.setInt32(1, frame, true);
  new Int32Array(buf, 5).set(snapshot);
  return buf;
}

export type DecodedMessage =
  | { tag: Tag.Inputs; entries: InputEntry[] }
  | { tag: Tag.Checksum; frame: number; checksum: number }
  | { tag: Tag.State; frame: number; snapshot: Int32Array };

export function decodeMessage(buf: ArrayBuffer): DecodedMessage | null {
  const dv = new DataView(buf);
  const tag = dv.getUint8(0) as Tag;
  if (tag === Tag.Inputs) {
    const n = Math.floor((buf.byteLength - 1) / 5);
    const entries: InputEntry[] = [];
    for (let i = 0; i < n; i++) {
      entries.push({ frame: dv.getInt32(1 + i * 5, true), input: dv.getUint8(1 + i * 5 + 4) });
    }
    return { tag, entries };
  }
  if (tag === Tag.Checksum) {
    return { tag, frame: dv.getInt32(1, true), checksum: dv.getInt32(5, true) >>> 0 };
  }
  if (tag === Tag.State) {
    return { tag, frame: dv.getInt32(1, true), snapshot: new Int32Array(buf.slice(5)) };
  }
  return null;
}

/** FNV-1a over a snapshot, for desync checksums. */
export function checksumSnapshot(buf: Int32Array): number {
  let h = 0x811c9dc5;
  for (const w of buf) {
    h ^= w;
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}
