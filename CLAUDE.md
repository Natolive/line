# Line: rules for working on this repo

## Vision

A realistic driving survival game in the browser: free driving on a 4-lane motorway, real-ish physics, traffic that behaves like traffic.

Physics stay realistic; the look is arcade: bold flat colours, cel shading, painted skies, many fantasy worlds.

## Stack

TypeScript + Three.js + Vite. No game engine, no physics library, no UI framework.

Node 22 (`.nvmrc`). The system `node` is v16 and too old: use `nvm use` or Docker.

Run via Docker + Traefik at http://lane.localhost (`docker compose up -d`).

## Architecture

Dependencies point one way: `core → world/ui/platform → rules → data`. Nothing imports `core/game.ts` except `main.ts`.

`src/data/` is plain content: one file per car in `data/cars/`, the themes in `data/themes.ts`. It imports nothing but its own types.

`src/rules/` is pure: no `three`, no DOM, no `Math.random` hidden in logic that tests rely on. Put any testable logic here.

`src/world/` owns Three.js objects. Gameplay code never builds meshes directly; cars go through `world/vehicles/` (`prefab.ts` normalizes a model, `lights.ts` drives its lights, `fleet.ts` loads the files).

`src/ui/` only touches the DOM. Game state lives in `core/game.ts`, not in the HUD.

`src/platform/` wraps browser APIs (keyboard, pointer, Web Audio).

Every gameplay tuning number lives in `src/core/config.ts`, car figures in `src/data/cars/`, theme settings in `src/data/themes.ts`, each with its unit in a comment. No magic numbers in systems.

## World conventions

Cel shading is one global patch of three's lighting chunk (`world/stage.ts`): no per-material toon setup.

Units are meters, seconds, radians. Speeds in m/s internally; km/h only for display.

The road is a real curve, a pure function of `d` and the map's seed (`rules/track.ts`: curvature, heading, position, tunnels and bridges); the land beside it is `rules/terrain.ts`.

Each race draws a new map: `setSeed()` decides the starting region, bends, structures, land and scenery. Solo draws its own seed; online the server sends one in `go`. Any randomness in the map goes through `hash()`/`randomFor()`, never `Math.random`, so a seed always gives the same map for everyone. Gameplay stays in road coordinates (`d`, lateral `x`, heading measured from the road); only drawing uses the curve.

Everything placed along the road lives under `TrackView.root` (`world/track.ts`) at its place on the curve (`place()`), never at a hand-computed z. Root is moved so the view point is at the origin facing -z: the player, camera and effects stay in that local frame.

Road, land and scenery are built in pieces by a `Ring`, which keeps them complete from behind the mirror's reach to past the fog whatever happens (driving, restart, spectating jump); never build or free them by hand.

x is lateral, + is right. Heading + means turned right.

Lanes are indexed 0 (left, fast) to 3 (right, slow).

## Themes

`THEMES` in `data/themes.ts` defines each area; `rules/themes.ts` decides which one applies at a distance and how far a blend has gone.

Sky, sun, fog and reflections blend in `world/environment.ts`: a painted gradient sky per theme (no photos), fog the colour of its horizon, reflections rendered from that sky. They turn with the road's heading, and give way to the lamps inside tunnels (`tunnelShade`).

Scenery fills 40 m sections far ahead in the fog (`world/scenery/`), standing on the land (`terrainHeight`); never spawn props in view. Each landscape kind is one function in `LANDSCAPES` (`scenery/landscapes.ts`) that places props through a `Plot` (`scenery/plot.ts`: dice from the seed, `put`, `scatter`, `landmark`).

The road is built in 80 m pieces by `world/road/road.ts`, one module per part (`carriageway`, `tunnel`, `bridges`, `overpass`), each a function of the piece's `Build` context and the shared `RoadPaints`.

Each theme also sets its colours (ground, rock, water, `tint` for props), its land (`relief`, snow line), its bends (`curves`) and what the road meets (`structures`: tunnels, viaducts, a lake bridge, overpasses, noise walls). Lengths and sizes of those live in `ROADSIDE` and `TRACK` (`core/config.ts`).

Road events: roadworks, lost loads and accidents stand at fixed spots, a pure function of the seed (`rules/events.ts`, drawn by `world/events.ts`); traffic queues behind or steers round the lanes they close (`blocksIn`), and the player hits what stands there through `impact()`. Police chases and wide-load convoys are traffic with a role (`world/traffic.ts`), so they are shared online like any traffic car.

Night is one number (0..1) that drives lamps, lit windows, sign glow and headlights through `setNight()` on each system.

## Multiplayer

`src/net/protocol.ts` (JSON control messages) and `src/net/codec.ts` (binary cars and traffic) are the only contract between game and server: change a message there, both sides follow.

Frequent data is binary and quantised (a car = 19 bytes); never send per-frame data as JSON.

Binary frames go over UDP (a WebRTC data channel, unordered and never retransmitted: `net/client.ts`, `server/rtc.ts`), falling back to the WebSocket; so any frame may be lost, late or out of order, and receivers drop the older ones. A backed-up link drops frames, never queues them. Control messages stay on the WebSocket.

The server ticks at `NET_HZ` (60 Hz, `net/protocol.ts`) and sends one snapshot of all cars per room per tick; it never relays car messages one by one.

Every car and traffic report carries the server-clock time of the frame its sender simulated it in (the rAF timestamp, not the send time) (clamped by the server); never time samples by arrival.

Remote cars and mirrored traffic are drawn where they are now, predicted from their newest report (dead reckoning in `net/interp.ts`); a report that disagrees becomes a correction that fades out (`addReport`/`present`), never a snap. Contacts use the drawn position: what you see is what you hit.

Times on the wire are server time (ms); convert with `Battle.serverNow()` (ping/pong clock sync).

The server (`server/`) relays and referees (rooms, host, start, eliminations, winner); it never simulates cars. Validate every client input there.

Each game simulates its own car; the room host also simulates the traffic and broadcasts it (`Traffic.remote` on the others). If the host leaves, the next player takes over.

Everything shared is in road coordinates (`d` = meters from the start line), never in the local camera-relative `z`.

The storm wall is a pure function of race time (`rules/wall.ts`): never send it over the network.

A room's `mode` is a battle royale (null) or a race to one of `RACE_LENGTHS`. In a race the finish line stands at `finishLineAt()` (`rules/track.ts`, moved past a tunnel or bridge); each game reports its own crossing with the server time of that moment, and the server believes it only if the driver's last reported `d` is near the line.

## Code rules

Keep it small: no abstraction until a second use exists.

Share geometries and materials (see `cached()` and `paint()`); never create them per frame.

Use `erasableSyntaxOnly` TypeScript: no enums, no constructor parameter properties, no namespaces.

Import with explicit `.ts` extensions.

Mark deliberate shortcuts with a `ponytail:` comment that says the limit and the upgrade path.

## Tests

Tests live in `tests/`, never in `src/`.

Use `node:test` + `node:assert`. No test framework.

Any change to physics, collisions or difficulty needs a test in `tests/rules.test.ts`.

Contacts go through `rules/impact.ts`: momentum shared by mass, damage from each car's jolt (`IMPACT` in `core/config.ts`). Never end a run on a mere overlap.

Before finishing a change: `npm run typecheck && npm test && npm run build`.

## Models

No model files: every car and prop is built from scratch in code as a low-poly toy. Cars in `world/vehicles/fleet.ts` (a `Design` per car: real length, width, height, plus colour and shape), props in `world/props/` by family (`nature`, `country`, `town`, `water`; one builder each, at real size, from the `toy.ts` kit), listed in the catalogue `world/assets.ts`.

Add detail freely: every prop and car is merged into one mesh per colour at build time (`merge()` in `world/arcade.ts`), so parts cost nothing per frame. Only what moves stays apart (turbine `blades`, `wheel`s, `taillight`s).

Materials are flat colours, one shared per colour (`paint()`, `mat()`); no textures except the towers' windows (`map` by day, `emissiveMap` lit at night).

`world/vehicles/prefab.ts` fits each built car (faces -z, ground at y = 0, real size), finds wheels by the name `wheel`, and outlines it (`outline()` in `world/arcade.ts`). Tail lamps are parts named `taillight`, `lights.ts` turns them into brake lights.

Garage cars use real specifications only (power, torque, redline, gear ratios, weight, drive, CdA, brakes); put the maker's figures in `real` and the garage test checks `measure()` lands on them. Only `driveShare` and `cdA` may be tuned to match, never power or weight.

Never read or print `.env.local`: it holds a Sketchfab token (no longer used).
