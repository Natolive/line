// Game state machine. Wires the systems together; owns score, distance and time.
// Solo: drive until you crash. Online (core/battle.ts): a battle royale where a storm wall chases the pack, or a
// race to a finish line.
import * as THREE from 'three';
import { GARAGE } from '../data/cars/index.ts';
import { THEMES } from '../data/themes.ts';
import { RACE_GRACE_MS, type CarState } from '../net/protocol.ts';
import { Sfx } from '../platform/audio.ts';
import { Input } from '../platform/input.ts';
import { impact, massOf, type Hit } from '../rules/impact.ts';
import { rectsOverlap } from '../rules/collision.ts';
import { crashSeverity, shunt, type Wreck, type WreckEvents } from '../rules/crash.ts';
import { mirrorWarning, multiplierFor } from '../rules/difficulty.ts';
import { raceWindow, stormWindow } from '../rules/progress.ts';
import { blocksIn, eventsIn, type EventKind } from '../rules/events.ts';
import { themeBlend, themeIndexAt } from '../rules/themes.ts';
import { curvatureAt, finishLineAt, setSeed, tunnelShade } from '../rules/track.ts';
import { measure } from '../rules/vehicle.ts';
import { Hud, ordinal, raceClock, type ProgressView, type Screen } from '../ui/hud.ts';
import type { World } from '../world/assets.ts';
import { Effects } from '../world/effects.ts';
import { Events } from '../world/events.ts';
import { Environment } from '../world/environment.ts';
import { Player } from '../world/player.ts';
import type { Rival } from '../world/rivals.ts';
import { Road } from '../world/road/road.ts';
import { Scenery } from '../world/scenery/scenery.ts';
import { Smoke } from '../world/smoke.ts';
import { Stage } from '../world/stage.ts';
import { StartLine } from '../world/startline.ts';
import { Terrain } from '../world/terrain.ts';
import { TrackView } from '../world/track.ts';
import { Traffic, type Driver } from '../world/traffic.ts';
import type { Fleet } from '../world/vehicles/fleet.ts';
import { setNight } from '../world/vehicles/lights.ts';
import { Battle } from './battle.ts';
import type { Car } from '../data/cars/index.ts';
import { CRASH, EVENTS, IMPACT, LANES, MIRROR, NEAR_MISS, START } from './config.ts';

type State = Screen | 'crash';
const BEST_KEY = 'line-best', CAR_KEY = 'line-car', NAME_KEY = 'line-name';
const IDLE = { steer: 0, throttle: 0, brake: 0 };

export class Game {
  private state: State = 'menu';
  private stage: Stage;
  private track: TrackView;
  private road: Road;
  private terrain: Terrain;
  private env: Environment;
  private scenery: Scenery;
  private startLine: StartLine;
  private finishLine: StartLine;
  private goal: number | null = null; // a race: road position of the finish line on this map
  private home: { place: number; time: number } | null = null; // a race: I crossed the line
  private events: Events;
  private announced = new Set<number>(); // road events already announced this race
  private lightsLeft = 0; // s before green, on the solo grid
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
  private crashClock = 0; // real seconds since the impact, for the slow motion
  private crashSlowMo = 1; // time scale at the impact: slower the harder the crash
  private wreckD = 0; // road position where I crashed: the world may scroll on with someone else (spectating)
  private watching: string | null = null; // the rival the camera follows once I'm out
  private scrapeCooldown = 0;
  private idleT = 0;
  private best = Number(load(BEST_KEY)) || 0;
  private carIndex = Math.max(0, GARAGE.findIndex((c) => c.id === load(CAR_KEY)));

  constructor(root: HTMLElement, fleet: Fleet, world: World) {
    this.fleet = fleet;
    this.stage = new Stage(root);
    const s = this.stage.scene;
    this.env = new Environment(s, this.stage.renderer);
    setSeed(newSeed());
    this.track = new TrackView(s);
    this.road = new Road(this.track);
    this.terrain = new Terrain(this.track, this.road.asphalt);
    this.scenery = new Scenery(this.track, world);
    this.startLine = new StartLine(this.track);
    this.finishLine = new StartLine(this.track, 'FINISH', false);
    this.finishLine.set(null);
    this.events = new Events(this.track, fleet);
    this.startLine.set(START.line);
    this.view(0);
    this.player = new Player(s, fleet, GARAGE[this.carIndex]);
    this.cruiseFrom();
    this.traffic = new Traffic(this.track, fleet);
    this.fx = new Effects(s);
    this.smoke = new Smoke(s);
    this.traffic.reset(this.me);

    this.hud.setBest(this.best);
    this.hud.show('menu');
    this.showCar();
    this.input = new Input({
      action: () => this.action(),
      cycle: (dir) => {
        if (this.state === 'menu') this.cycleCar(dir);
        else if (this.state === 'out') this.switchWatch(dir);
      },
      pause: () => this.back(),
      mute: () => this.sfx.toggleMute(),
      battle: () => { if (this.state === 'menu') this.setState('mp'); },
      tap: () => {
        if (['menu', 'over', 'pause'].includes(this.state)) this.action();
        else if (this.state === 'out') this.switchWatch(1);
      },
    });
    this.hud.onPause(() => this.back(), () => {
      this.sfx.silenceLoops();
      this.setState('menu');
    });
    this.hud.onGarage((dir) => this.cycleCar(dir), () => this.setState('menu'));
    this.hud.onBattle({
      open: () => this.setState('mp'),
      join: (name, room) => this.join(name, room),
      start: () => this.battle?.start(),
      leave: () => this.leaveBattle(),
      spec: (car) => { if (this.battle?.isHost) this.battle.setSpec(car); },
      mode: (mode) => { if (this.battle?.isHost) this.battle.setMode(mode); },
      back: () => this.action(),
    }, GARAGE.map((c) => ({ id: c.id, name: c.name, model: c.model })));
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
      if (this.battle) this.battle.frameAt = now;
      this.update(dt);
      this.view(dt);
      this.applyTheme();
      // rear-view mirror while driving (and on the start grid); the HUD draws its frame
      const glass = this.hud.mirror(['play', 'countdown', 'pause'].includes(this.state));
      if (glass) this.warnMirror();
      this.stage.render(this.fx.shake, glass && { camera: this.player.mirror, rect: glass });
    });
  }

  /** The local player, as traffic sees them. */
  private get me(): Driver {
    return { d: this.dist, x: this.player.state.x, speed: this.player.state.speed, rect: this.player.rect };
  }

  private setState(s: State) {
    this.state = s;
    if (s === 'menu' && this.player.wreck) this.cruiseFrom(); // the garage shows the car whole again, already rolling
    if (s !== 'crash') this.hud.show(s);
    if (s === 'pause') this.sfx.suspend();
    else this.sfx.resume();
  }

  /** The world drawn around road position `dist`: the road, the land and the scenery are kept complete around it. */
  private view(dt = 0) {
    this.track.setView(this.dist);
    this.road.update(this.dist);
    this.terrain.update(this.dist, dt);
    this.scenery.update(this.dist, dt);
    this.events.update(this.dist, dt);
  }

  /** Sky, light and night lights for where the car is on the road (dimmed in tunnels); announces each new zone. */
  private applyTheme() {
    const n = THEMES.length, b = themeBlend(this.dist, n), zone = themeIndexAt(this.dist, n), shade = tunnelShade(this.dist);
    this.env.apply(THEMES[b.from], THEMES[b.to], b.t, this.stage.camera, this.player.state.x, this.track.heading, shade);
    const night = this.env.night;
    setNight(Math.max(night, shade)); // car lights come on in tunnels
    this.scenery.setNight(night);
    this.road.setNight(night);
    this.player.setNight(Math.max(night, shade * 0.6));
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

  /**
   * Puts everything back on the start line of a new map (`seed`: a room shares one, solo draws its own); the car
   * rolls off from road position (d, x), driving with `spec`'s figures if given.
   */
  private startRace(d = 0, x?: number, spec: Car | null = null, seed = newSeed()) {
    setSeed(seed);
    this.road.clear();
    this.terrain.clear();
    this.scenery.clear();
    this.events.clear();
    this.announced.clear();
    this.score = this.time = this.nearMisses = 0;
    this.dist = d;
    this.watching = null;
    this.player.spec = spec;
    this.zone = themeIndexAt(d, THEMES.length);
    this.startLine.set(START.line);
    this.startLine.lights(START.red + START.amber, START.amber);
    const race = this.battle?.mode ?? null; // after setSeed: the line depends on the map
    this.goal = race === null ? null : finishLineAt(race);
    this.home = null;
    this.finishLine.set(this.goal);
    this.view();
    this.player.reset(0, x);
    this.traffic.reset(this.me);
    this.sfx.start();
  }

  private action() {
    if (this.state === 'menu' || this.state === 'over') {
      this.startRace();
      this.lightsLeft = START.red + START.amber;
      this.setState('countdown');
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
      this.battle = await Battle.join(room, name, GARAGE[this.carIndex].model, this.track, this.fleet, this.traffic, {
        lobby: () => {
          if (this.state === 'mp') this.setState('lobby');
          const b = this.battle!;
          this.hud.setLobby(b.room, b.players, b.host, b.me, b.spec, b.mode);
        },
        go: (slot, seed) => {
          const spec = specCar(this.battle!.spec);
          this.startRace(slot.d, slot.x, spec, seed);
          if (spec) this.hud.popup(`Everyone drives with ${spec.name} figures`);
          if (this.goal !== null) this.hud.popup(`Race to the finish line · ${(this.goal / 1000).toFixed(1)} km`);
          this.hud.setBattle(this.battleStats());
          this.hud.setProgress(this.progress());
          this.setState('countdown');
        },
        out: (id, reason, place) => {
          const b = this.battle!;
          const how = { wall: 'caught by the storm', left: 'left', late: 'too late to finish' }[reason] ?? 'crashed';
          this.hud.popup(id === b.me ? `Out · ${ordinal(place)}` : `${b.nameOf(id)} ${how}`);
          if (id === b.me) this.hud.setEliminated(place, reason);
        },
        finish: (id, place, time) => {
          const b = this.battle!;
          if (id === b.me) {
            this.home = { place, time };
            this.hud.setFinished(place, time);
            this.hud.popup(`Finished · ${ordinal(place)} · ${raceClock(time)}`, 4);
          } else this.hud.popup(`${b.nameOf(id)} finished ${ordinal(place)} · ${raceClock(time)}`);
          if (place === 1 && id !== b.me && !this.home) this.hud.popup(`${RACE_GRACE_MS / 1000} s left to finish`, 4);
        },
        winner: (ranking) => {
          this.hud.setResults(ranking, this.battle!.me, this.battle!.mode);
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
    this.player.spec = null;
    this.goal = null;
    this.finishLine.set(null);
    this.cruiseFrom(); // back from wherever spectating left the wreck, rolling again
    this.traffic.reset(this.me);
    if (toMenu) this.setState('menu');
  }

  // ---- spectating ----

  /** The rival the camera follows while I'm out: kept while it races, else the one nearest the view. */
  private watched() {
    const racing = [...this.battle!.rivals.all.values()].filter((r) => r.alive);
    const kept = racing.find((r) => r.info.id === this.watching);
    if (kept) return kept;
    const next = racing.sort((a, b) => Math.abs(a.d - this.dist) - Math.abs(b.d - this.dist))[0];
    if (next) this.watch(next);
    else this.battle!.rivals.focus(null);
    return next ?? null;
  }

  /** Cuts to rival `r`: the world is redrawn around them. */
  private watch(r: Rival) {
    this.watching = r.info.id;
    this.dist = r.d;
    this.view();
    this.battle!.rivals.focus(r.info.id);
  }

  /** ← / →: the driver ahead of or behind the one watched, looping round the field. */
  private switchWatch(dir: -1 | 1) {
    const racing = [...this.battle!.rivals.all.values()].filter((r) => r.alive).sort((a, b) => b.d - a.d);
    if (racing.length < 2) return;
    const i = racing.findIndex((r) => r.info.id === this.watching);
    this.watch(racing[(i + dir + racing.length) % racing.length]);
  }

  /** My car, as rivals receive it. */
  private carState(): CarState {
    const p = this.player.state;
    return { d: this.dist, x: p.x, heading: p.heading, speed: p.speed, steer: p.steer, brake: this.input.read().brake > 0, score: Math.floor(this.score) };
  }

  /**
   * Knocks with traffic and rivals (rules/impact.ts): each one shoves, slows and spins both cars by their masses,
   * and damages mine by how hard it was jolted. Scrapes are harmless, harder knocks add up, a violent one wrecks.
   * Rivals are judged the same way by their own game, so a contact jolts both drivers alike.
   */
  private knocks() {
    const me = this.me;
    for (const { car, moving } of this.traffic.touching(me)) {
      const hit = impact(this.player.moving, moving);
      if (!hit) continue;
      // pushed apart along the contact, split by mass (the host's traffic car moves; a mirrored one can't, so I do)
      const share = this.traffic.remote ? 1 : moving.mass / (moving.mass + this.player.moving.mass);
      this.player.state.x += hit.normal[0] * hit.depth * share;
      this.traffic.knock(car, hit.dvb, [-hit.normal[0] * hit.depth * (1 - share), -hit.normal[1] * hit.depth], hit.jolt);
      if (this.onKnock(hit, car.x)) return;
    }
    // what road events left standing: cones, boxes and signs go flying, wrecks and trailers don't budge
    for (const e of eventsIn(this.dist - 15, this.dist + 15)) {
      for (const t of e.things) {
        if (Math.abs(t.d - this.dist) > 12 || this.events.isKnocked(t.id)) continue;
        const rect = { x: t.x, z: this.dist - t.d, w: t.w, l: t.l, heading: t.yaw };
        if (!rectsOverlap(me.rect, rect)) continue;
        const hit = impact(this.player.moving, { rect, vx: 0, vz: 0, mass: t.mass });
        if (!hit) continue;
        if (t.mass < 1e6) {
          // knocked flying ahead and away from the car, with a few chips of it
          this.events.knock(t.id, t.kind, t.mass, Math.abs(this.player.state.speed), Math.sign(t.x - this.player.state.x) || 1);
          const at = this.player.car.mesh.position.clone().setX(t.x).setY(0.5);
          this.fx.burst(at, t.kind === 'box' ? [0xffa42a, 0x24252c] : t.kind === 'tyre' ? [0x1c1c22, 0x5a5a60] : [0xff6a1a, 0xf6f6f2], 4, 3);
        } else this.player.state.x += hit.normal[0] * hit.depth;
        if (this.onKnock(hit, t.x)) return;
      }
    }
    for (const r of this.battle?.rivals.drivers() ?? []) {
      if (Math.abs(r.d - this.dist) > 20) continue;
      const hit = impact(this.player.moving, { rect: { ...r.rect, z: this.dist - r.d }, vx: r.speed * Math.sin(r.rect.heading), vz: -r.speed * Math.cos(r.rect.heading), mass: massOf(r.rect.w, r.rect.l) });
      if (!hit) continue;
      this.player.state.x += hit.normal[0] * hit.depth; // they move themselves, on their own game
      if (this.onKnock(hit, r.x)) return;
    }
  }

  /** My car takes knock `hit` from something at lateral `x`: shoved, damaged, sparks and a bang. True if it wrecked me. */
  private onKnock(hit: Hit, x: number) {
    this.player.knock(hit.dva, hit.spin, hit.damage);
    if (hit.wreck || this.player.damage >= 100) {
      this.crash();
      return true;
    }
    if (hit.jolt < 1) return false;
    const p = this.player.state, at = this.player.car.mesh.position.clone().setX((p.x + x) / 2).setY(0.7), k = Math.min(1, hit.jolt / IMPACT.wreckKmh);
    this.fx.burst(at, k > 0.3 ? [0x2a2a2a, 0x8a8a8a, 0xffb347] : [0xffb347, 0xffe08a], Math.round(4 + 14 * k), 3 + 4 * k);
    this.fx.shake = Math.max(this.fx.shake, 0.15 + 0.6 * k);
    if (hit.damage > 0) {
      this.sfx.thud();
      if (hit.damage >= 3) this.hud.popup(`Damage ${Math.round(this.player.damage)} %`);
    } else this.sfx.scrape();
    return false;
  }

  // ---- frame ----

  private update(dt: number) {
    const p = this.player.state, b = this.battle;
    switch (this.state) {
      case 'play':
        return this.tick(dt);
      case 'countdown': {
        // on the grid: the lights count down; the engine can be revved
        const left = b ? -b.raceTime() : (this.lightsLeft -= dt);
        this.startLine.lights(left, START.amber);
        this.hud.countdown(left, START.amber);
        if (b) {
          b.sync(dt, this.dist);
          b.publish(dt, this.carState());
        } else this.traffic.update(dt, this.me, [], 0);
        const car = this.player.physics, throttle = this.input.read().throttle;
        this.sfx.setEngine(car.idleRpm + throttle * 0.8 * (car.redline - car.idleRpm), throttle, car.redline, this.player.driven.specs);
        this.stage.follow(p.x, p.heading, 0, dt);
        if (left <= 0) this.setState('play');
        return;
      }
      case 'crash':
      case 'out': {
        // slow motion right at the impact, easing back to full speed
        this.crashClock += dt;
        const sdt = dt * Math.min(1, this.crashSlowMo + (1 - this.crashSlowMo) * (this.crashClock / CRASH.slowMoTime) ** 2);
        const ev = this.player.update(sdt, IDLE).wreck;
        let forward = 0, cam: { x: number; heading: number; speed: number } | null = null;
        if (b) {
          b.sync(dt, this.dist);
          // out: ride with a rival still racing; the road, scenery and traffic scroll with them
          const r = this.state === 'out' ? this.watched() : null;
          if (r) {
            forward = r.d - this.dist;
            this.dist = r.d;
            b.rivals.place(this.dist);
            const limiter = (specCar(b.spec) ?? GARAGE.find((c) => c.model === r.info.car) ?? GARAGE[0]).physics.limiterKmh;
            cam = { x: r.x, heading: r.heading, speed: (r.speed * 3.6) / limiter };
            this.hud.setWatching(r.info.name, r.speed * 3.6, this.battleStats().alive);
          }
          b.publish(dt, null);
          this.hud.setBattle(this.battleStats());
          this.hud.setProgress(this.progress());
        }
        const wreck = this.placeWreck();
        // traffic stops for the wreck where it is now, and can't drive through it
        const drivers: Driver[] = b?.rivals.drivers() ?? [], w = this.player.wreck;
        if (w && Math.abs(this.wreckD + w.s - this.dist) < 300) {
          const me = { d: this.wreckD + w.s, x: w.x, speed: w.vs, rect: this.player.rect };
          drivers.push(me);
          const car = this.traffic.hits(me);
          if (car) this.collideWreck(w, car);
        }
        this.traffic.update(b ? dt : sdt, this.me, drivers, this.dist / 1000, false);
        this.fx.update(sdt, forward);
        this.smoke.update(sdt, forward);
        if (Math.abs(wreck.z) < 150) {
          if (ev) this.wreckFx(ev, wreck);
          if (Math.random() < sdt * 25) this.puff(wreck.clone().setY(0.8), 0x2b2b2b, 1.2, 4, 2.5, 0.55);
        }
        if (cam) this.stage.follow(cam.x, cam.heading, cam.speed, dt);
        else this.stage.watch(wreck, dt);
        if (this.state === 'crash' && (this.crashT -= dt) <= 0) {
          if (b) this.setState('out');
          else this.gameOver();
        }
        return;
      }
      default:
        this.idleT += dt;
        if (this.state === 'menu') this.cruise(dt);
        else if (this.player.wreck) this.player.update(dt, IDLE); // still sliding when the game-over screen comes up
        this.fx.update(dt, 0);
        this.smoke.update(dt, 0);
        if (this.player.wreck) this.placeWreck();
        const at = this.player.car.mesh.position;
        this.stage.orbit(this.idleT, at.x, at.z);
    }
  }

  /** Puts the garage car in its lane at cruising speed: it is already rolling when the garage shows. */
  private cruiseFrom() {
    this.player.reset(START.menuKmh / 3.6, LANES[START.menuLane]);
  }

  /** The garage car drives itself down its lane (moving over for road events), through bends, while you choose. */
  private cruise(dt: number) {
    // its lane, or the nearest one left open by roadworks and accidents ahead
    const closed = new Set(blocksIn(this.dist - 10, this.dist + 250).map((b) => b.lane));
    const lane = LANES.map((_, i) => i).filter((i) => !closed.has(i)).sort((a, b) => Math.abs(a - START.menuLane) - Math.abs(b - START.menuLane))[0];
    const p = this.player.state, laneX = LANES[lane];
    const steer = Math.max(-1, Math.min(1, -(p.x - laneX) * 0.4 - p.heading * 6));
    const throttle = p.speed * 3.6 < START.menuKmh ? 0.5 : 0;
    this.dist += this.player.update(dt, { steer, throttle, brake: 0 }, curvatureAt(this.dist)).forward;
    this.view(dt);
    this.traffic.update(dt, this.me, [], this.dist / 1000);
  }

  private tick(dt: number) {
    const input = this.input.read(), b = this.battle;
    const { forward, scraped, railJolt, wrecked } = this.player.update(dt, input, curvatureAt(this.dist));
    if (wrecked) return this.crash();
    if (railJolt > IMPACT.scratchKmh) {
      this.sfx.thud();
      this.fx.shake = Math.max(this.fx.shake, Math.min(1, railJolt / IMPACT.railWreckKmh));
      this.hud.popup(`Damage ${Math.round(this.player.damage)} %`);
    }
    const p = this.player.state, kmh = p.speed * 3.6, mult = multiplierFor(kmh, p.x);
    this.time += dt;
    this.dist += forward;
    this.score += forward * mult;
    if (b && this.goal !== null && !this.home && this.dist >= this.goal && forward > 0) {
      // crossed the finish line during this frame: tell the server when exactly; the car drives on
      b.finished(((this.dist - this.goal) / forward) * dt * 1000);
      this.home = { place: 0, time: 0 }; // until the server confirms
    }

    this.fx.update(dt, forward);
    this.smoke.update(dt, forward);
    const misses = this.traffic.update(dt, this.me, b?.rivals.drivers() ?? [], this.dist / 1000);
    for (let i = 0; i < misses && mult > 0; i++) { // none on the hard shoulder, where nothing scores
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

    const { gear, rpm } = this.player, car = this.player.driven;
    const screech = Math.min(1, Math.max(0, (Math.abs(this.player.lateralAccel) / this.player.physics.grip - 0.85) / 0.15));
    this.sfx.setEngine(rpm, input.throttle, car.physics.redline, car.specs);
    this.sfx.setScreech(screech);
    // exhaust: a thin haze when cruising, thicker puffs on the throttle and at high revs
    if (Math.random() < dt * (6 + input.throttle * (10 + rpm / 300))) this.puff(this.player.exhaust(), 0xd8d8d8, 0.25, 1.4, 1.1, 0.12 + input.throttle * 0.18);
    if (screech > 0.3) for (const w of this.player.rearWheels()) if (Math.random() < dt * 40 * screech) this.puff(w, 0xf2f2f2, 0.6, 3, 1.4, 0.35 * screech);
    // a damaged engine smokes, darker and thicker as it gets worse
    const engine = this.player.engineSmoke(), dmg = this.player.damage;
    if (engine && Math.random() < dt * (8 + dmg / 4)) this.puff(engine, dmg > IMPACT.limpAt ? 0x262626 : 0x8a8a8a, 0.4, 2.5, 1.6, 0.2 + dmg / 300);
    this.announce();
    this.hud.setStats({ score: this.score, kmh, gear, rev: rpm / car.physics.redline, km: this.dist / 1000, mult, damage: dmg });
    this.stage.follow(p.x, p.heading, (p.speed * 3.6) / car.physics.limiterKmh, dt);

    if (b) {
      b.sync(dt, this.dist);
      b.publish(dt, this.carState());
      this.hud.setBattle(this.battleStats());
      this.hud.setProgress(this.progress());
      if (this.dist < b.wall()) return this.crash('wall');
    }
    if (this.state === 'play') this.knocks();
  }

  /** The mirror's frame lights up for what comes up behind me: traffic, rivals, the police. */
  private warnMirror() {
    const p = this.player.state, me = { d: this.dist, x: p.x, speed: p.speed, w: this.player.car.w, l: this.player.car.l };
    const rivals = (this.battle?.rivals.drivers() ?? []).map((r) => ({ d: r.d, x: r.x, speed: r.speed, w: r.rect.w, l: r.rect.l }));
    const w = this.state === 'play' ? mirrorWarning(me, [...this.traffic.seen(this.dist - MIRROR.policeRange - 20, this.dist), ...rivals]) : { danger: 0, police: false };
    this.hud.mirrorWarning(w.danger, w.police);
  }

  /** Warns of what's coming: road events ahead, and whatever the traffic sends (a police chase, a wide load). */
  private announce() {
    for (const e of eventsIn(this.dist, this.dist + EVENTS.announceAhead)) {
      if (e.from < this.dist || e.from - this.dist > EVENTS.announceAhead || this.announced.has(e.id)) continue;
      this.announced.add(e.id);
      this.hud.popup(NEWS[e.kind], EVENTS.announceSec);
    }
    for (const news of this.traffic.news.splice(0)) this.hud.popup(news, EVENTS.announceSec);
  }

  /** The progress line: every driver, on a stretch of road zoomed on the pack (rules/progress.ts). */
  private progress(): ProgressView {
    const b = this.battle!, mine = this.state === 'play' ? this.dist : this.wreckD + (this.player.wreck?.s ?? 0);
    const drivers = [
      { id: b.me, name: 'You', d: mine, me: true, out: this.state !== 'play' && !this.home },
      ...[...b.rivals.all.values()].map((r) => ({ id: r.info.id, name: r.info.name, d: r.d, me: false, out: !r.alive })),
    ];
    const racing = drivers.filter((d) => !d.out).map((d) => d.d), ds = racing.length ? racing : [mine];
    const w = this.goal === null ? stormWindow(ds, b.wall()) : raceWindow(ds, this.goal);
    return { ...w, drivers, goal: this.goal, storm: this.goal === null };
  }

  private battleStats() {
    const b = this.battle!, rivals = [...b.rivals.all.values()];
    const alive = rivals.filter((r) => r.alive).length + (this.state === 'play' ? 1 : 0);
    const place = this.home?.place || 1 + rivals.filter((r) => r.alive && r.d > this.dist).length;
    const goal = this.goal === null ? null : { left: this.goal - this.dist, length: this.goal, time: Math.max(0, b.raceTime() * 1000) };
    return { alive, total: rivals.length + 1, wall: this.dist - b.wall(), goal, place: this.state === 'play' ? place : 0, ping: b.ping, udp: b.udp, ...b.link };
  }

  /** Draws the wreck where it is on the road (it slides on along the curve), relative to the view. */
  private placeWreck() {
    const w = this.player.wreck!, mesh = this.player.car.mesh;
    this.track.setView(this.dist);
    this.track.placeLocal(mesh, this.wreckD + w.s, w.x, w.yaw, w.y);
    mesh.rotation.z = w.roll;
    return mesh.position;
  }

  private puff(at: THREE.Vector3, color: number, size: number, grow: number, life: number, alpha: number) {
    const velocity = new THREE.Vector3((Math.random() - 0.5) * 0.6, Math.random() * 0.3, 1 + Math.random());
    this.smoke.emit(at, { color, size, grow, life, alpha, velocity });
  }

  /** The wreck and a traffic car it touches shunt each other (rules/crash.ts), with a bang if it was a real hit. */
  private collideWreck(w: Wreck, car: { d: number; speed: number; x: number; v: { l: number } }) {
    const a = { d: this.wreckD + w.s, speed: w.vs, l: this.player.car.l }, c = { d: car.d, speed: car.speed, l: car.v.l };
    const closing = Math.abs(a.speed - c.speed);
    shunt(a, c);
    w.s = a.d - this.wreckD;
    w.vs = a.speed;
    Object.assign(car, { d: c.d, speed: c.speed });
    w.vx += Math.sign(w.x - car.x || 1) * Math.min(3, closing * 0.2); // glance off sideways
    if (closing > 3) {
      this.fx.burst(this.player.car.mesh.position.clone().setY(0.8), [0x2a2a2a, 0x8a8a8a, 0xcfe8ff], 12, 5);
      this.fx.shake = Math.max(this.fx.shake, 0.4);
      this.sfx.thud();
    }
  }

  /** Sparks, dust and bangs from the tumbling wreck at `at`. */
  private wreckFx(ev: WreckEvents, at: THREE.Vector3) {
    const w = this.player.wreck!;
    if (ev.landed) {
      this.fx.burst(at.clone().setY(0.4), [0x2a2a2a, 0x8a8a8a, 0xdddddd], 14, 6);
      this.fx.shake = Math.max(this.fx.shake, 0.5);
      this.sfx.thud();
    }
    if ((ev.scrape || ev.rail) && Math.random() < 0.5) this.fx.burst(at.clone().setY(0.3), [0xffb347, 0xffe08a], 3, 5);
    if (Math.hypot(w.vx, w.vs) > 3 && w.vy === 0 && Math.random() < 0.5) this.puff(at.clone().setY(0.3), 0x9a9a9a, 1, 3, 1.2, 0.35); // dust and tyre smoke
  }

  private crash(reason: 'crash' | 'wall' = 'crash') {
    if (this.state !== 'play') return;
    // everything scales with the speed of the impact
    const at = this.player.car.mesh.position.clone().setY(0.9), k = crashSeverity(this.player.state.speed), n = (c: number) => Math.round(c * (0.2 + 0.8 * k));
    if (reason === 'wall') this.fx.burst(at, [0xff3030, 0x7a0000, 0x2a2a2a], 40, 6);
    else {
      this.fx.burst(at, [0x2a2a2a, 0x8a8a8a, 0xdddddd], n(30), 3 + 6 * k);
      this.fx.burst(at, [0xcfe8ff], n(25), 2 + 5 * k); // glass
    }
    this.fx.shake = Math.min(1.4, 0.2 + 0.7 * k);
    this.crashSlowMo = 1 - (1 - CRASH.slowMo) * Math.min(1, k);
    this.player.crash();
    this.sfx.silenceLoops();
    this.sfx.crash(k);
    this.battle?.eliminated(reason, this.dist);
    this.wreckD = this.dist;
    this.crashT = CRASH.duration;
    this.crashClock = 0;
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

const NEWS: Record<EventKind, string> = { works: 'Roadworks ahead', load: 'Lost load ahead', accident: 'Accident ahead' };

/** A new map: any 32-bit number. */
const newSeed = () => Math.floor(Math.random() * 2 ** 32);

/** The garage car a room's `spec` names (see Battle.spec), if any. */
const specCar = (id: string | null) => (id ? GARAGE.find((c) => c.id === id) ?? null : null);


// localStorage can throw (private mode, blocked storage): then choices last this session only.
function load(key: string) {
  try { return localStorage.getItem(key); } catch { return null; }
}
function save(key: string, value: string) {
  try { localStorage.setItem(key, value); } catch { /* session only */ }
}
