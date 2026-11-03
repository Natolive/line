// Game state machine. Wires the systems together; owns score, distance and time.
// Solo: drive until you crash. Battle royale (core/battle.ts): online, a storm wall chases the pack.
import * as THREE from 'three';
import { GARAGE } from '../data/cars/index.ts';
import { THEMES } from '../data/themes.ts';
import type { CarState } from '../net/protocol.ts';
import { Sfx } from '../platform/audio.ts';
import { Input } from '../platform/input.ts';
import { rectsOverlap } from '../rules/collision.ts';
import { multiplierFor } from '../rules/difficulty.ts';
import { themeBlend, themeIndexAt, toNextBorder } from '../rules/themes.ts';
import { measure } from '../rules/vehicle.ts';
import { Hud, type Screen } from '../ui/hud.ts';
import type { World } from '../world/assets.ts';
import { Effects } from '../world/effects.ts';
import { Environment } from '../world/environment.ts';
import { Player } from '../world/player.ts';
import { Road } from '../world/road.ts';
import { Scenery } from '../world/scenery.ts';
import { Smoke } from '../world/smoke.ts';
import { Stage } from '../world/stage.ts';
import { Traffic, type Driver } from '../world/traffic.ts';
import type { Fleet } from '../world/vehicles/fleet.ts';
import { setNight } from '../world/vehicles/lights.ts';
import { Battle } from './battle.ts';
import { BUMP, CRASH_DURATION, NEAR_MISS, START_SPEED } from './config.ts';

type State = Screen | 'crash';
const BEST_KEY = 'line-best', CAR_KEY = 'line-car', NAME_KEY = 'line-name';
const IDLE = { steer: 0, throttle: 0, brake: 0 };

export class Game {
  private state: State = 'menu';
  private stage: Stage;
  private road: Road;
  private env: Environment;
  private scenery: Scenery;
  private zone = 0;
  private player: Player;
  private traffic: Traffic;
  private fx: Effects;
  private smoke: Smoke;
  private hud = new Hud();
  private sfx = new Sfx();
  private input: Input;
  private fleet: Fleet;
  private battle: Battle | null = null;

  private score = 0;
  private dist = 0;
  private time = 0;
  private nearMisses = 0;
  private crashT = 0;
  private scrapeCooldown = 0;
  private idleT = 0;
  private best = Number(load(BEST_KEY)) || 0;
  private carIndex = Math.max(0, GARAGE.findIndex((c) => c.id === load(CAR_KEY)));

  constructor(root: HTMLElement, fleet: Fleet, world: World) {
    this.fleet = fleet;
    this.stage = new Stage(root);
    const s = this.stage.scene;
    this.env = new Environment(s, this.stage.renderer, world);
    this.road = new Road(s, world);
    this.scenery = new Scenery(s, world);
    this.scenery.reset(0);
    this.road.reset(0);
    this.player = new Player(s, fleet, GARAGE[this.carIndex]);
    this.traffic = new Traffic(s, fleet);
    this.fx = new Effects(s);
    this.smoke = new Smoke(s);
    this.traffic.reset(this.me);

    this.hud.setBest(this.best);
    this.hud.show('menu');
    this.showCar();
    this.input = new Input({
      action: () => this.action(),
      cycle: (dir) => { if (this.state === 'menu') this.cycleCar(dir); },
      pause: () => this.back(),
      mute: () => this.sfx.toggleMute(),
      battle: () => { if (this.state === 'menu') this.setState('mp'); },
      tap: () => { if (['menu', 'over', 'pause'].includes(this.state)) this.action(); },
    });
    this.hud.onPause(() => this.back());
    this.hud.onGarage((dir) => this.cycleCar(dir), () => this.setState('menu'));
    this.hud.onBattle({
      open: () => this.setState('mp'),
      join: (name, room) => this.join(name, room),
      start: () => this.battle?.start(),
      leave: () => this.leaveBattle(),
    });
    this.hud.setName(load(NAME_KEY) ?? '');
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && this.state === 'play' && !this.battle) this.setState('pause'); // online races don't pause
    });
  }

  run() {
    let last = performance.now(), frames = 0, fpsAt = last;
    this.stage.renderer.setAnimationLoop((now) => {
      const dt = Math.min(0.05, (now - last) / 1000); // clamp so a lag spike can't teleport cars
      last = now;
      frames++;
      if (now - fpsAt >= 500) { // refresh the counter twice a second, so it's readable
        this.hud.setFps((frames * 1000) / (now - fpsAt));
        frames = 0;
        fpsAt = now;
      }
      this.update(dt);
      this.applyTheme();
      this.stage.render(this.fx.shake);
    });
  }

  /** The local player, as traffic sees them. */
  private get me(): Driver {
    return { d: this.dist, x: this.player.state.x, speed: this.player.state.speed, rect: this.player.rect };
  }

  private setState(s: State) {
    this.state = s;
    if (s !== 'crash') this.hud.show(s);
    if (s === 'pause') this.sfx.suspend();
    else this.sfx.resume();
  }

  /** Sky, light, ground and night lights for where the car is on the road; announces each new zone. */
  private applyTheme() {
    const n = THEMES.length, b = themeBlend(this.dist, n), zone = themeIndexAt(this.dist, n);
    this.env.apply(THEMES[b.from], THEMES[b.to], b.t, this.stage.camera, this.player.state.x);
    this.road.setGround(THEMES[zone], THEMES[(zone + 1) % n], -toNextBorder(this.dist));
    const night = this.env.night;
    setNight(night);
    this.scenery.setNight(night);
    this.road.setNight(night);
    this.player.setNight(night);
    if (zone !== this.zone) {
      this.zone = zone;
      if (this.state === 'play') this.hud.announce(THEMES[zone].name);
    }
  }

  private cycleCar(dir: -1 | 1) {
    this.carIndex = (this.carIndex + dir + GARAGE.length) % GARAGE.length;
    this.player.choose(GARAGE[this.carIndex]);
    save(CAR_KEY, GARAGE[this.carIndex].id);
    this.showCar();
  }

  private showCar() {
    const car = GARAGE[this.carIndex];
    this.hud.setCar(car, measure(car.physics), this.carIndex, GARAGE.length);
  }

  /** Puts everything back on the start line; the car rolls off from road position (d, x). */
  private startRace(d = 0, x?: number) {
    this.score = this.time = this.nearMisses = 0;
    this.dist = d;
    this.zone = themeIndexAt(d, THEMES.length);
    this.scenery.reset(d);
    this.road.reset(d);
    this.player.reset(START_SPEED, x);
    this.traffic.reset(this.me);
    this.sfx.start();
  }

  private action() {
    if (this.state === 'menu' || this.state === 'over') {
      this.startRace();
      this.setState('play');
    } else if (this.state === 'pause') this.setState('play');
    else if (this.state === 'lobby' && this.battle?.isHost) this.battle.start();
    else if (this.state === 'results') this.setState('lobby');
  }

  /** Esc / P: pause solo, leave screens, or quit the room. */
  private back() {
    if (this.state === 'play' && !this.battle) this.setState('pause');
    else if (this.state === 'pause') this.setState('play');
    else if (this.state === 'over' || this.state === 'mp') this.setState('menu');
    else if (this.state === 'lobby' || this.state === 'results') this.leaveBattle();
  }

  // ---- battle royale ----

  private async join(name: string, room: string) {
    save(NAME_KEY, name);
    this.hud.mpError('');
    try {
      this.battle = await Battle.join(room, name, GARAGE[this.carIndex].model, this.stage.scene, this.fleet, this.traffic, {
        lobby: () => {
          if (this.state === 'mp') this.setState('lobby');
          this.hud.setLobby(this.battle!.room, this.battle!.players, this.battle!.host, this.battle!.me);
        },
        go: (slot) => {
          this.startRace(slot.d, slot.x);
          this.hud.setBattle({ alive: this.battle!.players.length, total: this.battle!.players.length, wall: this.dist - this.battle!.wall(), place: 0, ping: this.battle!.ping });
          this.setState('countdown');
        },
        out: (id, reason, place) => {
          const b = this.battle!;
          this.hud.popup(id === b.me ? `Out · ${ordinal(place)}` : `${b.nameOf(id)} ${reason === 'wall' ? 'caught by the storm' : reason === 'left' ? 'left' : 'crashed'}`);
          if (id === b.me) this.hud.setEliminated(place, reason);
        },
        winner: (id, ranking) => {
          const b = this.battle!;
          this.hud.setResults(ranking.map((p) => b.nameOf(p)), id === b.me);
          this.sfx.silenceLoops();
          this.setState('results');
        },
        error: (message) => {
          this.hud.mpError(message);
          this.leaveBattle(false);
        },
        closed: () => {
          this.hud.mpError('Disconnected from the server.');
          this.leaveBattle(false);
          this.setState('mp');
        },
      });
    } catch (e) {
      this.battle = null;
      this.hud.mpError((e as Error).message);
    }
  }

  private leaveBattle(toMenu = true) {
    this.battle?.leave();
    this.battle = null;
    this.traffic.reset(this.me);
    if (toMenu) this.setState('menu');
  }

  /** My car, as rivals receive it. */
  private carState(): CarState {
    const p = this.player.state;
    return { d: this.dist, x: p.x, heading: p.heading, speed: p.speed, steer: p.steer, brake: this.input.read().brake > 0, score: Math.floor(this.score) };
  }

  /** Contact with rivals: a big closing speed is a crash, a small one a shove with sparks. */
  private bumpRivals() {
    const b = this.battle!, p = this.player.state;
    for (const r of b.rivals.drivers()) {
      if (Math.abs(r.d - this.dist) > 8 || !rectsOverlap({ ...this.player.rect, z: 0 }, { ...r.rect, z: this.dist - r.d })) continue;
      const closing = Math.abs(p.speed - r.speed) * 3.6;
      if (closing > BUMP.crashKmh && r.d > this.dist) return this.crash(); // I rammed them
      const side = Math.sign(p.x - r.x) || 1, behind = r.d > this.dist;
      this.player.shove(side * BUMP.push * 0.05, behind ? r.speed - 1 : undefined);
      this.fx.burst(this.player.car.mesh.position.clone().setX((p.x + r.x) / 2).setY(0.7), [0xffb347, 0xffe08a], 6, 4);
      this.fx.shake = Math.max(this.fx.shake, 0.25);
      this.sfx.scrape();
    }
  }

  // ---- frame ----

  private update(dt: number) {
    const p = this.player.state, b = this.battle;
    switch (this.state) {
      case 'play':
        return this.tick(dt);
      case 'countdown': {
        const t = b!.raceTime();
        this.hud.countdown(Math.ceil(-t));
        b!.sync(dt, this.dist);
        b!.publish(dt, this.carState());
        this.stage.follow(p.x, p.heading, 0, dt);
        if (t >= 0) {
          this.hud.countdown(0);
          this.setState('play');
        }
        return;
      }
      case 'crash':
      case 'out':
        this.player.update(dt, IDLE);
        this.traffic.update(dt, this.me, b?.rivals.drivers() ?? [], this.dist / 1000, !b); // traffic brakes for the wreck
        if (b) {
          b.sync(dt, this.dist);
          b.publish(dt, null);
          this.hud.setBattle(this.battleStats());
        }
        this.fx.update(dt, 0);
        this.smoke.update(dt, 0);
        if (Math.random() < dt * 25) this.puff(this.player.car.mesh.position.clone().setY(0.8), 0x2b2b2b, 1.2, 4, 2.5, 0.55);
        this.stage.follow(p.x, p.heading, 0, dt);
        if (this.state === 'crash' && (this.crashT -= dt) <= 0) {
          if (b) this.setState('out');
          else this.gameOver();
        }
        return;
      default:
        this.idleT += dt;
        this.fx.update(dt, 0);
        this.smoke.update(dt, 0);
        this.stage.orbit(this.idleT, p.x);
    }
  }

  private tick(dt: number) {
    const input = this.input.read(), b = this.battle;
    const { forward, scraped } = this.player.update(dt, input);
    const p = this.player.state, kmh = p.speed * 3.6, mult = multiplierFor(kmh);
    this.time += dt;
    this.dist += forward;
    this.score += forward * mult;

    this.road.update(forward, this.dist);
    this.scenery.update(forward, this.dist);
    this.fx.update(dt, forward);
    this.smoke.update(dt, forward);
    const misses = this.traffic.update(dt, this.me, b?.rivals.drivers() ?? [], this.dist / 1000);
    for (let i = 0; i < misses; i++) {
      const pts = NEAR_MISS.points * mult;
      this.score += pts;
      this.nearMisses++;
      this.hud.popup(`Near miss +${pts}`);
      this.sfx.nearMiss();
    }

    this.scrapeCooldown -= dt;
    if (scraped && this.scrapeCooldown <= 0) {
      this.scrapeCooldown = 0.08;
      const side = Math.sign(p.x);
      this.fx.burst(this.player.car.mesh.position.clone().setX(p.x + side * 1).setY(0.6), [0xffb347, 0xffe08a], 4, 4);
      this.fx.shake = Math.max(this.fx.shake, 0.12);
      this.sfx.scrape();
    }

    const { gear, rpm } = this.player, car = this.player.model;
    const screech = Math.min(1, Math.max(0, (Math.abs(this.player.lateralAccel) / this.player.physics.grip - 0.85) / 0.15));
    this.sfx.setEngine(rpm, input.throttle, car.physics.redline, car.specs);
    this.sfx.setScreech(screech);
    // exhaust: a thin haze when cruising, thicker puffs on the throttle and at high revs
    if (Math.random() < dt * (6 + input.throttle * (10 + rpm / 300))) this.puff(this.player.exhaust(), 0xd8d8d8, 0.25, 1.4, 1.1, 0.12 + input.throttle * 0.18);
    if (screech > 0.3) for (const w of this.player.rearWheels()) if (Math.random() < dt * 40 * screech) this.puff(w, 0xf2f2f2, 0.6, 3, 1.4, 0.35 * screech);
    this.hud.setStats({ score: this.score, kmh, gear, rev: rpm / car.physics.redline, km: this.dist / 1000, mult });
    this.stage.follow(p.x, p.heading, (p.speed * 3.6) / car.physics.limiterKmh, dt);

    if (b) {
      b.sync(dt, this.dist);
      b.publish(dt, this.carState());
      this.bumpRivals();
      this.hud.setBattle(this.battleStats());
      if (this.dist < b.wall()) return this.crash('wall');
    }
    if (this.state === 'play' && this.traffic.hits(this.me)) this.crash();
  }

  private battleStats() {
    const b = this.battle!, rivals = [...b.rivals.all.values()];
    const alive = rivals.filter((r) => r.alive).length + (this.state === 'play' ? 1 : 0);
    const place = 1 + rivals.filter((r) => r.alive && r.d > this.dist).length;
    return { alive, total: rivals.length + 1, wall: this.dist - b.wall(), place: this.state === 'play' ? place : 0, ping: b.ping };
  }

  private puff(at: THREE.Vector3, color: number, size: number, grow: number, life: number, alpha: number) {
    const velocity = new THREE.Vector3((Math.random() - 0.5) * 0.6, Math.random() * 0.3, 1 + Math.random());
    this.smoke.emit(at, { color, size, grow, life, alpha, velocity });
  }

  private crash(reason: 'crash' | 'wall' = 'crash') {
    if (this.state !== 'play') return;
    const at = this.player.car.mesh.position.clone().setY(0.9);
    if (reason === 'wall') this.fx.burst(at, [0xff3030, 0x7a0000, 0x2a2a2a], 40, 6);
    else {
      this.fx.burst(at, [0x2a2a2a, 0x8a8a8a, 0xdddddd], 30, 9);
      this.fx.burst(at, [0xcfe8ff], 25, 7); // glass
    }
    this.fx.shake = 0.9;
    this.player.crash();
    this.sfx.silenceLoops();
    this.sfx.crash();
    this.battle?.eliminated(reason, this.dist);
    this.crashT = CRASH_DURATION;
    this.setState('crash');
  }

  private gameOver() {
    const score = Math.floor(this.score), isNew = score > this.best;
    if (isNew) {
      this.best = score;
      save(BEST_KEY, String(score));
      this.hud.setBest(score);
    }
    this.hud.setOver({ score, best: this.best, isNew, km: this.dist / 1000, nearMisses: this.nearMisses, seconds: Math.round(this.time) });
    this.idleT = 0;
    this.setState('over');
  }
}

const ordinal = (n: number) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th'}`;

// localStorage can throw (private mode, blocked storage): then choices last this session only.
function load(key: string) {
  try { return localStorage.getItem(key); } catch { return null; }
}
function save(key: string, value: string) {
  try { localStorage.setItem(key, value); } catch { /* session only */ }
}
