// DOM overlay: dashboard while driving, plus the menu, pause, game-over and online (battle royale, race) screens.
import { PROGRESS } from '../core/config.ts';
import type { Car } from '../data/cars/index.ts';
import { MAX_PLAYERS, RACE_GRACE_MS, RACE_LENGTHS, type Mode, type PlayerInfo, type Result as Ranked } from '../net/protocol.ts';

export type Screen = 'menu' | 'play' | 'pause' | 'over' | 'mp' | 'lobby' | 'countdown' | 'out' | 'results';
// wall: meters ahead of the storm; goal (a race, else null): meters left to the line, where it is, ms since the start;
// ahead: ms rivals are predicted past their reports; fix: m each report corrects
export type BattleStats = { alive: number; total: number; wall: number; goal: { left: number; length: number; time: number } | null; place: number; ping: number; udp: boolean; ahead: number; fix: number };

/**
 * The progress line on the right: the stretch of road [lo, hi] it shows (m), every driver on it, and the finish line
 * (a race) or the storm wall (battle royale). See rules/progress.ts.
 */
export type ProgressView = {
  lo: number;
  hi: number;
  drivers: { id: string; name: string; d: number; me: boolean; out: boolean }[];
  goal: number | null;
  storm: boolean;
};

export type Stats = { score: number; kmh: number; gear: number; rev: number; km: number; mult: number; damage: number }; // rev: 0..1 of redline; damage: %
export type Result = { score: number; best: number; isNew: boolean; km: number; nearMisses: number; seconds: number };

const $ = (id: string) => document.getElementById(id)!;
const fmt = new Intl.NumberFormat('en');

/** A race time (ms) as m:ss.t. */
export const raceClock = (ms: number) => `${Math.floor(ms / 60000)}:${((ms % 60000) / 1000).toFixed(1).padStart(4, '0')}`;
export const ordinal = (n: number) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`;
const MODES: Mode[] = [null, ...RACE_LENGTHS];
const STRIPES = ['#e2333b', '#ffcf4a', '#3ab0ff', '#4adf7a', '#c46bff', '#ff8a3a', '#f7f4ee', '#ff6ab8']; // a colour per driver on the lobby grid
const modeName = (mode: Mode) => (mode === null ? 'Battle royale' : `${mode / 1000} km race`);
const modeHint = (mode: Mode) =>
  mode === null
    ? 'A storm chases the pack and keeps speeding up. Last one on the road wins.'
    : `First across the finish line, ${mode / 1000} km away, wins. Once the winner is home, the others have ${RACE_GRACE_MS / 1000} s.`;

export class Hud {
  private goTimer = 0;
  private dots = new Map<string, HTMLElement>(); // progress line: one dot per driver
  private cars: { id: string; name: string; model: string }[] = [];
  private tiles = new Map<string, HTMLElement>(); // lobby: one tile per driver
  private copiedTimer = 0;
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
    if (!['play', 'countdown', 'out'].includes(screen)) {
      this.setBattle(null);
      this.setProgress(null);
    }
  }

  // ---- battle royale ----

  /** `cars`: the garage, for the host's car figures setting. */
  onBattle(h: { open(): void; join(name: string, room: string): void; start(): void; leave(): void; spec(car: string | null): void; mode(mode: Mode): void; back(): void }, cars: { id: string; name: string; model: string }[]) {
    this.cars = cars;
    const room = $('mp-room') as HTMLInputElement, name = $('mp-name') as HTMLInputElement;
    room.value = Math.random().toString(36).slice(2, 7).toUpperCase().replace(/[^A-Z0-9]/g, 'X'); // a fresh code to share
    $('to-battle').addEventListener('click', h.open);
    $('mp-form').addEventListener('submit', (e) => {
      e.preventDefault();
      h.join(name.value.trim(), room.value.trim().toUpperCase());
    });
    $('lobby-start').addEventListener('click', h.start);
    $('lobby-modes').replaceChildren(...MODES.map((mode) => {
      // one card per mode: the storm, or a race's distance over a chequered band
      const b = document.createElement('button');
      b.type = 'button';
      b.className = mode === null ? 'event storm' : 'event';
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-label', modeName(mode));
      b.innerHTML = mode === null
        ? '<span class="event-big">Storm</span><span class="event-name">Battle royale</span>'
        : `<span class="event-big">${mode / 1000}<small>km</small></span><span class="event-name">Race</span><span class="event-flag"></span>`;
      b.addEventListener('click', () => h.mode(mode));
      return b;
    }));
    $('lobby-copy').addEventListener('click', () => {
      const done = (text: string) => {
        $('lobby-copied').textContent = text;
        clearTimeout(this.copiedTimer);
        this.copiedTimer = window.setTimeout(() => { $('lobby-copied').textContent = ''; }, 1600);
      };
      navigator.clipboard?.writeText($('lobby-code').textContent ?? '').then(() => done('Copied'), () => done('Copy failed'));
    });
    const spec = $('lobby-spec') as HTMLSelectElement;
    spec.replaceChildren(new Option('Each driver\'s own car', ''), ...cars.map((c) => new Option(`Everyone on ${c.name}`, c.id)));
    spec.addEventListener('change', () => h.spec(spec.value || null));
    $('results-back').addEventListener('click', h.back);
    for (const id of ['lobby-leave', 'results-leave', 'mp-back']) $(id).addEventListener('click', h.leave);
  }

  setName(name: string) {
    ($('mp-name') as HTMLInputElement).value = name;
  }

  mpError(message: string) {
    $('mp-error').textContent = message;
  }

  /** `spec`: the garage car id whose figures everyone drives with, or null (each their own); `mode`: the room's. */
  setLobby(room: string, players: PlayerInfo[], host: string, me: string, spec: string | null, mode: Mode) {
    $('lobby-code').textContent = room;
    this.setTiles(players, host, me, room);
    const isHost = host === me;
    $('lobby-start').hidden = !isHost;
    $('lobby-wait').hidden = isHost;
    $('lobby-wait').textContent = `Waiting for ${players.find((p) => p.id === host)?.name ?? 'the host'} to start`;
    // the settings: the host changes them, everyone else sees them
    $('lobby-host-only').hidden = isHost;
    [...$('lobby-modes').children].forEach((b, i) => {
      (b as HTMLButtonElement).disabled = !isHost;
      b.setAttribute('aria-checked', String(MODES[i] === mode));
    });
    $('lobby-mode-hint').textContent = modeHint(mode);
    const select = $('lobby-spec') as HTMLSelectElement;
    select.value = spec ?? '';
    select.disabled = !isHost;
  }

  /** The drivers' tiles: kept from one update to the next, so only a driver who just arrived pops in. */
  private setTiles(players: PlayerInfo[], host: string, me: string, room: string) {
    for (const [id, tile] of this.tiles) if (!players.some((p) => p.id === id)) this.tiles.delete(id) && tile.remove();
    const tiles = players.map((p, i) => {
      let tile = this.tiles.get(p.id);
      if (!tile) {
        tile = document.createElement('li');
        tile.className = 'tile new';
        tile.addEventListener('animationend', () => tile!.classList.remove('new'), { once: true });
        this.tiles.set(p.id, tile);
      }
      tile.classList.toggle('me', p.id === me);
      tile.style.setProperty('--car', STRIPES[i % STRIPES.length]);
      const car = this.cars.find((c) => c.model === p.car)?.name ?? p.car;
      tile.innerHTML = `<span class="tile-name"></span><span class="tile-car"></span>${p.id === host ? '<span class="tile-host">Host</span>' : ''}`;
      tile.querySelector('.tile-name')!.textContent = p.id === me ? `${p.name} (you)` : p.name;
      tile.querySelector('.tile-car')!.textContent = car;
      return tile;
    });
    const invite = document.createElement('li');
    invite.className = 'tile invite';
    invite.innerHTML = 'Share code <b></b><br>to fill the grid';
    invite.querySelector('b')!.textContent = room;
    $('lobby-players').replaceChildren(...tiles, ...(players.length < MAX_PLAYERS ? [invite] : []));
    $('lobby-count').textContent = `${players.length} of ${MAX_PLAYERS}`;
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

  /** Lights the mirror's frame: red as something closes in behind (`danger` 0..1), red and blue for police on my tail. */
  mirrorWarning(danger: number, police: boolean) {
    const el = $('mirror');
    el.style.setProperty('--danger', danger.toFixed(2));
    el.toggleAttribute('data-police', police);
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
    if (s.goal) {
      // a race: what is left to the line, and the race clock
      $('b-meter-label').textContent = 'Finish';
      $('b-wall').textContent = s.goal.left > 0 ? `${(s.goal.left / 1000).toFixed(2)} km · ${raceClock(s.goal.time)}` : 'Home';
      $('b-wall-bar').style.width = `${Math.min(1, Math.max(0, 1 - s.goal.left / s.goal.length)) * 100}%`;
      vignette.style.opacity = '0';
    } else {
      $('b-meter-label').textContent = 'Storm';
      $('b-wall').textContent = `${Math.max(0, Math.round(s.wall))} m`;
    }
    const ping = $('b-ping');
    ping.textContent = s.ping ? `${Math.round(s.ping)} ms` : '—';
    ping.dataset.level = s.ping < 80 ? 'good' : s.ping < 150 ? 'ok' : 'bad';
    const link = $('b-link');
    link.textContent = s.udp ? 'UDP' : 'TCP';
    link.dataset.level = s.udp ? 'good' : 'ok';
    const net = $('b-net');
    net.textContent = s.ahead ? `${Math.round(s.ahead)} ms · ${Math.round(s.fix * 100)} cm` : '—';
    net.dataset.level = s.fix < 0.1 ? 'good' : s.fix < 0.5 ? 'ok' : 'bad';
    if (s.goal) return;
    const danger = Math.min(1, Math.max(0, 1 - s.wall / 250)); // storm closer than 250 m: screen edges turn red
    $('b-wall-bar').style.width = `${(1 - danger) * 100}%`;
    vignette.style.opacity = String(danger * 0.85);
  }

  /** The progress line on the right; null hides it. */
  setProgress(v: ProgressView | null) {
    const line = $('progress');
    line.hidden = !v;
    if (!v) {
      for (const d of this.dots.values()) d.remove();
      this.dots.clear();
      return;
    }
    const span = Math.max(1, v.hi - v.lo), at = (d: number) => `${Math.min(1, Math.max(0, (d - v.lo) / span)) * 100}%`;
    line.dataset.mode = v.storm ? 'storm' : 'race';
    // marks every PROGRESS.tick m, scrolling down as the window moves on
    const ticks = $('progress-ticks'), px = (line.clientHeight * PROGRESS.tick) / span;
    ticks.style.backgroundSize = `100% ${px}px`;
    ticks.style.backgroundPosition = `0 calc(100% + ${((((v.lo % PROGRESS.tick) + PROGRESS.tick) % PROGRESS.tick) / PROGRESS.tick) * px}px)`;
    // the finish line: where it is once in view, else at the top with how far it still is
    const flag = $('progress-end'), me = v.drivers.find((d) => d.me);
    if (v.goal !== null) {
      flag.style.bottom = at(v.goal);
      flag.dataset.ahead = v.goal > v.hi && me ? `▲ ${((v.goal - me.d) / 1000).toFixed(1)} km` : '';
    } else flag.dataset.ahead = '';
    for (const [id, dot] of this.dots) {
      if (v.drivers.some((d) => d.id === id)) continue;
      dot.remove();
      this.dots.delete(id);
    }
    for (const d of v.drivers) {
      let dot = this.dots.get(d.id);
      if (!dot) {
        dot = document.createElement('div');
        dot.className = 'dot';
        dot.append(document.createElement('span'));
        line.append(dot);
        this.dots.set(d.id, dot);
      }
      dot.classList.toggle('me', d.me);
      dot.classList.toggle('out', d.out);
      const gap = me && !d.me ? Math.round(d.d - me.d) : 0;
      const far = Math.abs(gap) >= 1000 ? `${(Math.abs(gap) / 1000).toFixed(1)} km` : `${Math.abs(gap)} m`;
      dot.firstElementChild!.textContent = d.me ? 'You' : `${d.name} ${gap >= 0 ? '+' : '−'}${far}`;
      dot.style.bottom = at(d.d);
    }
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
    $('out-title').textContent = reason === 'wall' ? 'Caught by the storm' : reason === 'late' ? 'Too late' : 'Wrecked';
    $('out-place').textContent = ordinal(place);
    this.setWatching(null, 0, 0);
  }

  /** A race: I crossed the line. Shown if I wreck afterwards and watch the others. */
  setFinished(place: number, time: number) {
    $('out-title').textContent = `Finished in ${raceClock(time)}`;
    $('out-place').textContent = ordinal(place);
  }

  /** Spectating: whom the camera follows (null: nobody left), at what speed, out of how many still racing. */
  setWatching(name: string | null, kmh: number, racing: number) {
    const text = name ? `Watching ${name} · ${Math.round(kmh)} km/h` : '';
    const el = $('out-watch');
    if (el.textContent !== text) el.textContent = text;
    $('out-hint').hidden = racing < 2;
  }

  /** Final ranking, winner first; `me` is highlighted; `mode`: the race's (battle royale or a race). */
  setResults(ranking: Ranked[], me: string, mode: Mode) {
    const won = ranking[0]?.id === me && (mode === null || ranking[0].time !== null); // a race is won by getting home first
    $('results-title').textContent = won ? (mode === null ? 'Last one standing' : 'You won!') : mode === null ? 'Race over' : ranking[0]?.time === null ? 'Nobody made it home' : 'Race over';
    const how = { crash: 'Wrecked', wall: 'Storm', left: 'Left', late: 'Too late', winner: 'Winner' };
    $('results-list').replaceChildren(...ranking.map((r) => {
      const li = document.createElement('li'), detail = document.createElement('span');
      li.textContent = `${r.name}${r.id === me ? ' (you)' : ''}`;
      li.classList.toggle('me', r.id === me);
      detail.textContent = r.time !== null ? raceClock(r.time) : `${(Math.max(0, r.d) / 1000).toFixed(1)} km · ${how[r.out ?? 'winner']}`;
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

  /** A message over the road for `seconds` (a near miss flashes by; a warning stays long enough to read). */
  popup(text: string, seconds = 1.2) {
    const el = document.createElement('div');
    el.className = 'popup';
    el.textContent = text;
    el.style.animationDuration = `${seconds}s`;
    $('popups').append(el);
    setTimeout(() => el.remove(), seconds * 1000);
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
