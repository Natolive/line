// Connection to the multiplayer server, through /ws on the same host as the game (Traefik or the Vite proxy).
// JSON for control messages, binary frames for cars and traffic.
import type { ClientMessage, ServerMessage } from './protocol.ts';

export class Net {
  onMessage: (m: ServerMessage) => void = () => {};
  onBinary: (buf: Uint8Array) => void = () => {};
  onClose: () => void = () => {};
  private ws: WebSocket;
  private ready: Promise<void>;

  constructor() {
    const scheme = location.protocol === 'https:' ? 'wss' : 'ws';
    this.ws = new WebSocket(`${scheme}://${location.host}/ws`);
    this.ws.binaryType = 'arraybuffer';
    this.ready = new Promise((resolve, reject) => {
      this.ws.addEventListener('open', () => resolve(), { once: true });
      this.ws.addEventListener('error', () => reject(new Error("Can't reach the multiplayer server. Is it running? (docker compose up)")), { once: true });
    });
    this.ws.addEventListener('message', (e) => {
      if (e.data instanceof ArrayBuffer) this.onBinary(new Uint8Array(e.data));
      else this.onMessage(JSON.parse(e.data));
    });
    this.ws.addEventListener('close', () => this.onClose());
  }

  /** Resolves once connected; rejects with a readable message if the server can't be reached. */
  connected() {
    return this.ready;
  }

  send(m: ClientMessage | Uint8Array<ArrayBuffer>) {
    if (this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(m instanceof Uint8Array ? m : JSON.stringify(m));
  }

  close() {
    this.onClose = () => {};
    this.ws.close();
  }
}
