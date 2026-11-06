// DOM overlay: dashboard while driving, plus the menu, pause, game-over and battle royale screens.
import type { Car } from '../data/cars/index.ts';
import type { PlayerInfo, Result as Standing } from '../net/protocol.ts';

export type Screen = 'menu' | 'play' | 'pause' | 'over' | 'mp' | 'lobby' | 'countdown' | 'out' | 'results';
export type BattleStats = { alive: number; total: number; wall: number; place: number; ping: number; udp: boolean; ahead: number; fix: number }; // ahead: ms rivals are predicted past their reports; fix: m each report corrects // wall: meters ahead of the storm

export type Stats = { score: number; kmh: number; gear: number; rev: number; km: number; mult: number; damage: number }; // rev: 0..1 of redline; damage: %
export type Result = { score: number; best: number; isNew: boolean; km: number; nearMisses: number; seconds: number };

const $ = (id: string) => document.getElementById(id)!;
const fmt = new Intl.NumberFormat('en');

export class Hud {
  private goTimer = 0;
  private hud = $('hud');
  private screens: Record<Exclude<Screen, 'play' | 'countdown'>, HTMLElement> = {
    menu: $('screen-menu'),
    pause: $('screen-pause'),
    over: $('screen-over'),
    mp: $('screen-mp'),
    lobby: $('screen-lobby'),
    out: $('screen-out'),
    results: $('screen-results'),
  };

  show(screen: Screen) {
    $('screen-loading').hidden = true;
    this.hud.hidden = !['play', 'pause', 'countdown', 'out'].includes(screen);
    this.hud.dataset.screen = screen;
    for (const [name, el] of Object.entries(this.screens)) el.hidden = name !== screen;
    if (screen === 'mp') ($('mp-name') as HTMLInputElement).focus();
    if (!['play', 'countdown', 'out'].includes(screen)) this.setBattle(null);
  }

  // ---- battle royale ----

  onBattle(h: { open(): void; join(name: string, room: string): void; start(): void; leave(): void; spec(): void; back(): void }) {
    const room = $('mp-room') as HTMLInputElement, name = $('mp-name') as HTMLInputElement;
    room.value = Math.random().toString(36).slice(2, 7).toUpperCase().replace(/[^A-Z0-9]/g, 'X'); // a fresh code to share
    $('to-battle').addEventListener('click', h.open);
    $('mp-form').addEventListener('submit', (e) => {
      e.preventDefault();
      h.join(name.value.trim(), room.value.trim().toUpperCase());
    });
    $('lobby-start').addEventListener('click', h.start);
    $('lobby-spec').addEventListener('click', h.spec);
    $('results-back').addEventListener('click', h.back);
    for (const id of ['lobby-leave', 'results-leave', 'mp-back']) $(id).addEventListener('click', h.leave);
  }

  setName(name: string) {
    ($('mp-name') as HTMLInputElement).value = name;
  }

  mpError(message: string) {
    $('mp-error').textContent = message;
  }

  /** `spec`: the name of the car whose figures everyone drives with, or null (each their own). */
  setLobby(room: string, players: PlayerInfo[], host: string, me: string, spec: string | null) {
    $('lobby-code').textContent = room;
    const list = $('lobby-players');
    list.replaceChildren(...players.map((p) => {
      const li = document.createElement('li');
      li.textContent = `${p.name}${p.id === me ? ' (you)' : ''}${p.id === host ? ' · host' : ''}`;
      const car = document.createElement('span');
      car.textContent = p.car.replace('car-', '').toUpperCase();
      li.append(car);
      return li;
    }));
    const isHost = host === me;
    $('lobby-start').hidden = !isHost;
    $('lobby-wait').hidden = isHost;
    const text = spec ? `Same figures for all: ${spec}` : 'Each driver\'s own car figures';
    $('lobby-spec').hidden = !isHost;
    $('lobby-spec').textContent = `${text} ▸`;
    $('lobby-spec-info').hidden = isHost;
    $('lobby-spec-info').textContent = text;
  }

  /** Shows or hides the rear-view mirror; when shown, returns its glass (inside the frame) in CSS pixels. */
  mirror(on: boolean) {
    const el = $('mirror');
    el.hidden = !on;
    if (!on) return null;
    const r = el.getBoundingClientRect(), w = el.clientWidth, h = el.clientHeight;
    const radius = Math.min(w / 2, h / 2, Math.max(0, parseFloat(getComputedStyle(el).borderTopLeftRadius) - el.clientTop)); // inner corner
    return { x: r.left + el.clientLeft, y: r.top + el.clientTop, w, h, radius };
  }

  setFps(fps: number) {
    $('fps').textContent = String(Math.round(fps));
  }

  /** Battle HUD; null hides it. */
  setBattle(s: BattleStats | null) {
    const box = $('battle'), vignette = $('storm');
    box.hidden = !s;
    if (!s) {
      vignette.style.opacity = '0';
      return;
    }
    $('b-alive').textContent = `${s.alive}/${s.total}`;
    $('b-place').textContent = s.place ? `P${s.place}` : '—';
    $('b-wall').textContent = `${Math.max(0, Math.round(s.wall))} m`;
    const ping = $('b-ping');
    ping.textContent = s.ping ? `${Math.round(s.ping)} ms` : '—';
    ping.dataset.level = s.ping < 80 ? 'good' : s.ping < 150 ? 'ok' : 'bad';
    const link = $('b-link');
    link.textContent = s.udp ? 'UDP' : 'TCP';
    link.dataset.level = s.udp ? 'good' : 'ok';
    const net = $('b-net');
    net.textContent = s.ahead ? `${Math.round(s.ahead)} ms · ${Math.round(s.fix * 100)} cm` : '—';
    net.dataset.level = s.fix < 0.1 ? 'good' : s.fix < 0.5 ? 'ok' : 'bad';
    const danger = Math.min(1, Math.max(0, 1 - s.wall / 250)); // storm closer than 250 m: screen edges turn red
    $('b-wall-bar').style.width = `${(1 - danger) * 100}%`;
    vignette.style.opacity = String(danger * 0.85);
  }

  /** On the grid, `left` seconds before the start: READY (red), SET (amber, the last `amber` s), then GO! for a moment. */
  countdown(left: number, amber: number) {
    const el = $('countdown'), light = left > amber ? 'red' : left > 0 ? 'amber' : 'green';
    if (el.dataset.light === light && !el.hidden) return;
    el.dataset.light = light;
    el.textContent = { red: 'Ready', amber: 'Set', green: 'Go!' }[light];
    el.hidden = false;
    clearTimeout(this.goTimer);
    if (light === 'green') this.goTimer = window.setTimeout(() => { el.hidden = true; }, 700);
  }

  setEliminated(place: number, reason: string) {
    $('out-title').textContent = reason === 'wall' ? 'Caught by the storm' : 'Wrecked';
    $('out-place').textContent = `${place}${place === 1 ? 'st' : place === 2 ? 'nd' : place === 3 ? 'rd' : 'th'}`;
    this.setWatching(null, 0, 0);
  }

  /** Spectating: whom the camera follows (null: nobody left), at what speed, out of how many still racing. */
  setWatching(name: string | null, kmh: number, racing: number) {
    const text = name ? `Watching ${name} · ${Math.round(kmh)} km/h` : '';
    const el = $('out-watch');
    if (el.textContent !== text) el.textContent = text;
    $('out-hint').hidden = racing < 2;
  }

  /** Final ranking, winner first; `me` is highlighted. */
  setResults(ranking: Standing[], me: string) {
    $('results-title').textContent = ranking[0]?.id === me ? 'Last one standing' : 'Race over';
    const how = { crash: 'Wrecked', wall: 'Storm', left: 'Left', winner: 'Winner' };
    $('results-list').replaceChildren(...ranking.map((r) => {
      const li = document.createElement('li'), detail = document.createElement('span');
      li.textContent = `${r.name}${r.id === me ? ' (you)' : ''}`;
      li.classList.toggle('me', r.id === me);
      detail.textContent = `${(Math.max(0, r.d) / 1000).toFixed(1)} km · ${how[r.out ?? 'winner']}`;
      li.append(detail);
      return li;
    }));
  }

  setStats(s: Stats) {
    $('score').textContent = fmt.format(Math.floor(s.score));
    $('kmh').textContent = String(Math.round(s.kmh));
    $('gear').textContent = String(s.gear);
    $('dist').textContent = s.km.toFixed(1);
    $('rpm-bar').style.width = `${Math.min(1, s.rev) * 100}%`;
    const mult = $('mult');
    mult.textContent = `×${s.mult}`;
    mult.dataset.tier = String(s.mult);
    const bar = $('damage-bar'), dmg = Math.round(s.damage);
    bar.style.width = `${dmg}%`;
    bar.dataset.level = dmg >= 75 ? 'bad' : dmg >= 50 ? 'warn' : 'ok';
    $('damage').title = `Damage ${dmg} %`;
  }

  setBest(best: number) {
    $('best-hud').textContent = $('best-menu').textContent = fmt.format(best);
  }

  setOver(r: Result) {
    $('final').textContent = fmt.format(r.score);
    $('over-best').textContent = r.isNew ? 'New best' : `Best ${fmt.format(r.best)}`;
    $('over-meta').textContent = `${r.km.toFixed(1)} km · ${r.nearMisses} near misses · ${r.seconds}s`;
  }

  /** Big, slow-fading sign when entering a new zone. */
  announce(name: string) {
    const el = $('zone');
    el.textContent = name;
    el.classList.remove('show');
    void el.offsetWidth; // restart the animation
    el.classList.add('show');
    clearTimeout(this.zoneTimer);
    this.zoneTimer = setTimeout(() => el.classList.remove('show'), 3200);
  }
  private zoneTimer: ReturnType<typeof setTimeout> | undefined;

  popup(text: string) {
    const el = document.createElement('div');
    el.className = 'popup';
    el.textContent = text;
    $('popups').append(el);
    setTimeout(() => el.remove(), 1200);
  }

  /** Garage card: the selected car and its measured performance. */
  setCar(car: Car, perf: { zeroTo100: number; topKmh: number; brake100: number }, index: number, count: number) {
    const p = car.physics;
    $('car-name').textContent = car.name;
    $('car-year').textContent = `${car.year} · ${index + 1} / ${count}`;
    $('car-engine').textContent = `${car.specs.engine} · ${fmt.format(Math.round(p.powerKw * 1.341))} hp · ${p.torqueNm} Nm`;
    $('car-chassis').textContent = `${car.specs.drive} · ${car.specs.gearbox} · ${fmt.format(p.massKg)} kg`;
    $('car-top').textContent = `${Math.round(perf.topKmh)} km/h`;
    $('car-accel').textContent = `${perf.zeroTo100.toFixed(1)} s`;
    $('car-brake').textContent = `${perf.brake100.toFixed(0)} m`;
    $('car-grip').textContent = `${(p.grip / 9.81).toFixed(2)} g`;
  }

  onGarage(cycle: (dir: -1 | 1) => void, open: () => void) {
    $('car-prev').addEventListener('click', () => cycle(-1));
    $('car-next').addEventListener('click', () => cycle(1));
    $('to-garage').addEventListener('click', open);
  }

  onPause(fn: () => void, quit: () => void) {
    $('pause-btn').addEventListener('click', fn);
    $('pause-quit').addEventListener('click', quit);
  }
}
