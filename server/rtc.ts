// The UDP side of a connection: a WebRTC data channel, unordered and never retransmitted, for the binary frames
// (cars, traffic). Over TCP, one lost packet holds back every frame behind it for a round trip; here it is just
// gone, and the next one (17 ms later) replaces it. The WebSocket stays for control messages, signalling, and as
// the fallback when UDP can't get through (strict firewall, no WebRTC).
// One UDP port for every player (ICE mux). Behind Docker the server only sees its container address, so it
// announces PUBLIC_IP instead, on the published port.
import { PeerConnection, type DataChannel } from 'node-datachannel';
import type { ServerMessage } from '../src/net/protocol.ts';

const PORT = Number(process.env.RTC_PORT ?? 40000);
const PUBLIC_IP = process.env.PUBLIC_IP ?? ''; // empty: announce the real local addresses (no Docker)
const BACKLOG = 16 * 1024; // bytes: past this the link is congested; drop frames rather than queue them (the next one is fresher)

export class Rtc {
  private pc: PeerConnection | null = null;
  private dc: DataChannel | null = null;
  private signal: (m: ServerMessage) => void;
  private onBinary: (buf: Uint8Array) => void;

  constructor(signal: (m: ServerMessage) => void, onBinary: (buf: Uint8Array) => void) {
    this.signal = signal;
    this.onBinary = onBinary;
  }

  /** The game's offer (already size-checked): answers it. Once per connection. */
  offer(sdp: string) {
    if (this.pc) return;
    const pc = (this.pc = new PeerConnection('p', { iceServers: [], enableIceUdpMux: true, portRangeBegin: PORT, portRangeEnd: PORT }));
    const mid = /^a=mid:(\S+)/m.exec(sdp)?.[1] ?? '0';
    pc.onLocalDescription((answer) => {
      this.signal({ t: 'rtc', sdp: answer });
      // after the answer: a candidate before it is rejected. Behind NAT (the player's) only this one works: the game reaches us here.
      if (PUBLIC_IP) this.signal({ t: 'ice', c: `candidate:1 1 UDP 2122317823 ${PUBLIC_IP} ${PORT} typ host`, mid });
    });
    pc.onLocalCandidate((c, mid) => {
      if (!PUBLIC_IP) this.signal({ t: 'ice', c, mid });
    });
    pc.onDataChannel((dc) => {
      dc.onMessage((m) => {
        if (typeof m !== 'string') this.onBinary(m instanceof Uint8Array ? m : new Uint8Array(m));
      });
      dc.onOpen(() => (this.dc = dc));
      dc.onClosed(() => (this.dc = null));
      if (dc.isOpen()) this.dc = dc;
    });
    try {
      pc.setRemoteDescription(sdp, 'offer');
    } catch {
      return this.close(); // malformed offer: stay on the WebSocket
    }
  }

  candidate(c: string, mid: string) {
    try {
      this.pc?.addRemoteCandidate(c, mid);
    } catch {
      // a candidate we can't use: ICE tries the others
    }
  }

  /** Sends a binary frame over UDP; false if the channel isn't open (send it over the WebSocket). */
  send(buf: Uint8Array) {
    const dc = this.dc;
    if (!dc?.isOpen()) return false;
    if (dc.bufferedAmount() < BACKLOG) dc.sendMessageBinary(buf);
    return true;
  }

  close() {
    this.dc = null;
    this.pc?.close();
  }
}
