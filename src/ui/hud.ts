// DOM overlay: dashboard while driving, plus the menu, pause, game-over and battle royale screens.
import type { Car } from '../data/cars/index.ts';
import type { PlayerInfo } from '../net/protocol.ts';

export type Screen = 'menu' | 'play' | 'pause' | 'over' | 'mp' | 'lobby' | 'countdown' | 'out' | 'results';
export type BattleStats = { alive: number; total: number; wall: number; place: number; ping: number; delay: number; gaps: number }; // wall: meters ahead of the storm

export type Stats = { score: number; kmh: number; gear: number; rev: number; km: number; mult: number }; // rev: 0..1 of redline
export type Result = { score: number; best: number; isNew: boolean; km: number; nearMisses: number; seconds: number };

const $ = (id: string) => document.getElementById(id)!;
const fmt = new Intl.NumberFormat('en');

/** Loading screen progress, 0..1. Runs before the Hud exists. */
export function showLoading(fraction: number) {
  const pct = Math.round(fraction * 100);
  $('load-bar').style.width = `${pct}%`;
  $('load-pct').textContent = `${pct}%`;
}

export class Hud {
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
    for (const [name, el] of Object.entries(this.screens)) el.hidden = name !== screen;
    if (screen === 'mp') ($('mp-name') as HTMLInputElement).focus();
    if (!['play', 'countdown', 'out'].includes(screen)) this.setBattle(null);
  }

  // ---- battle royale ----

  onBattle(h: { open(): void; join(name: string, room: string): void; start(): void; leave(): void }) {
    const room = $('mp-room') as HTMLInputElement, name = $('mp-name') as HTMLInputElement;
    room.value = Math.random().toString(36).slice(2, 7).toUpperCase().replace(/[^A-Z0-9]/g, 'X'); // a fresh code to share
    $('to-battle').addEventListener('click', h.open);
    $('mp-form').addEventListener('submit', (e) => {
      e.preventDefault();
      h.join(name.value.trim(), room.value.trim().toUpperCase());
    });
    $('lobby-start').addEventListener('click', h.start);
    for (const id of ['lobby-leave', 'results-leave', 'mp-back']) $(id).addEventListener('click', h.leave);
  }

  setName(name: string) {
    ($('mp-name') as HTMLInputElement).value = name;
  }

  mpError(message: string) {
    $('mp-error').textContent = message;
  }

  setLobby(room: string, players: PlayerInfo[], host: string, me: string) {
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
    const net = $('b-net');
    net.textContent = `${Math.round(s.delay)} ms · ${s.gaps.toFixed(1)} gaps/s`;
    net.dataset.level = s.gaps < 0.5 ? 'good' : s.gaps < 3 ? 'ok' : 'bad';
    const danger = Math.min(1, Math.max(0, 1 - s.wall / 250)); // storm closer than 250 m: screen edges turn red
    $('b-wall-bar').style.width = `${(1 - danger) * 100}%`;
    vignette.style.opacity = String(danger * 0.85);
  }

  countdown(n: number) {
    const el = $('countdown');
    el.hidden = n <= 0;
    el.textContent = String(n);
  }

  setEliminated(place: number, reason: string) {
    $('out-title').textContent = reason === 'wall' ? 'Caught by the storm' : 'Wrecked';
    $('out-place').textContent = `${place}${place === 1 ? 'st' : place === 2 ? 'nd' : place === 3 ? 'rd' : 'th'}`;
  }

  setResults(ranking: string[], won: boolean) {
    $('results-title').textContent = won ? 'Last one standing' : 'Race over';
    $('results-list').replaceChildren(...ranking.map((name) => {
      const li = document.createElement('li');
      li.textContent = name;
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

  onPause(fn: () => void) {
    $('pause-btn').addEventListener('click', fn);
  }
}
