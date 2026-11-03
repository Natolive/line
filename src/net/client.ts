// Connection to the multiplayer server, through /ws on the same host as the game (Traefik or the Vite proxy).
// JSON for control messages, binary frames for cars and traffic. The binary frames go over UDP once a WebRTC
// data channel is up (unordered, no retransmission: a lost frame is just replaced by the next one, where TCP
// would hold every later frame back for a round trip); until then, or if UDP is blocked, over the WebSocket.
import type { ClientMessage, ServerMessage } from './protocol.ts';

const BACKLOG = 16 * 1024; // bytes waiting to go out past which binary frames are dropped, not queued (a fresher one follows)

export class Net {
  onMessage: (m: ServerMessage) => void = () => {};
  onBinary: (buf: Uint8Array) => void = () => {};
  onClose: () => void = () => {};
  private ws: WebSocket;
  private ready: Promise<void>;
  private pc: RTCPeerConnection | null = null;
  private dc: RTCDataChannel | null = null;

  constructor() {
    const scheme = location.protocol === 'https:' ? 'wss' : 'ws';
    this.ws = new WebSocket(`${scheme}://${location.host}/ws`);
    this.ws.binaryType = 'arraybuffer';
    this.ready = new Promise((resolve, reject) => {
      this.ws.addEventListener('open', () => resolve(), { once: true });
      this.ws.addEventListener('error', () => reject(new Error("Can't reach the multiplayer server. Is it running? (docker compose up)")), { once: true });
    });
    this.ws.addEventListener('message', (e) => {
      if (e.data instanceof ArrayBuffer) return this.onBinary(new Uint8Array(e.data));
      const m: ServerMessage = JSON.parse(e.data);
      if (m.t === 'rtc') this.pc?.setRemoteDescription({ type: 'answer', sdp: m.sdp }).catch(() => this.dropUdp());
      else if (m.t === 'ice') this.pc?.addIceCandidate({ candidate: m.c, sdpMid: m.mid }).catch(() => {});
      else this.onMessage(m);
    });
    this.ws.addEventListener('close', () => this.onClose());
    this.ready.then(() => this.offerUdp(), () => {});
  }

  /** Resolves once connected; rejects with a readable message if the server can't be reached. */
  connected() {
    return this.ready;
  }

  /** True once cars and traffic travel over UDP. */
  get udp() {
    return this.dc?.readyState === 'open';
  }

  send(m: ClientMessage | Uint8Array<ArrayBuffer>) {
    if (!(m instanceof Uint8Array)) {
      if (this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(m));
      return;
    }
    const link = this.udp ? this.dc! : this.ws.readyState === WebSocket.OPEN ? this.ws : null;
    if (link && link.bufferedAmount < BACKLOG) link.send(m);
  }

  close() {
    this.onClose = () => {};
    this.dropUdp();
    this.ws.close();
  }

  /** Offers the server a UDP channel. No STUN: the server has a public address, and it's the one answering. */
  private async offerUdp() {
    if (typeof RTCPeerConnection === 'undefined') return;
    const pc = (this.pc = new RTCPeerConnection());
    const dc = (this.dc = pc.createDataChannel('cars', { ordered: false, maxRetransmits: 0 }));
    dc.binaryType = 'arraybuffer';
    dc.onmessage = (e) => e.data instanceof ArrayBuffer && this.onBinary(new Uint8Array(e.data));
    pc.onicecandidate = (e) => e.candidate?.candidate && this.send({ t: 'ice', c: e.candidate.candidate, mid: e.candidate.sdpMid ?? '0' });
    pc.onconnectionstatechange = () => pc.connectionState === 'failed' && this.dropUdp(); // blocked: the WebSocket carries on
    try {
      await pc.setLocalDescription();
      this.send({ t: 'rtc', sdp: pc.localDescription!.sdp });
    } catch {
      this.dropUdp();
    }
  }

  private dropUdp() {
    this.pc?.close();
    this.pc = this.dc = null;
  }
}
