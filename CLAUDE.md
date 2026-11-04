# Line: rules for working on this repo

## Vision

A realistic driving survival game in the browser: free driving on a 4-lane motorway, real-ish physics, traffic that behaves like traffic.

Realism wins over arcade shortcuts, unless it makes the game unfair or unplayable.

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

Units are meters, seconds, radians. Speeds in m/s internally; km/h only for display.

The road is a real curve, a pure function of `d` and the map's seed (`rules/track.ts`: curvature, heading, position, tunnels and bridges); the land beside it is `rules/terrain.ts`.

Each race draws a new map: `setSeed()` decides the starting region, bends, structures, land and scenery. Solo draws its own seed; online the server sends one in `go`. Any randomness in the map goes through `hash()`/`randomFor()`, never `Math.random`, so a seed always gives the same map for everyone. Gameplay stays in road coordinates (`d`, lateral `x`, heading measured from the road); only drawing uses the curve.

Everything placed along the road lives under `TrackView.root` (`world/track.ts`) at its place on the curve (`place()`), never at a hand-computed z. Root is moved so the view point is at the origin facing -z: the player, camera and effects stay in that local frame.

Road, land and scenery are built in pieces by a `Ring`, which keeps them complete from behind the mirror's reach to past the fog whatever happens (driving, restart, spectating jump); never build or free them by hand.

x is lateral, + is right. Heading + means turned right.

Lanes are indexed 0 (left, fast) to 3 (right, slow).

## Themes

`THEMES` in `data/themes.ts` defines each area; `rules/themes.ts` decides which one applies at a distance and how far a blend has gone.

Sky, sun, fog and reflections blend in `world/environment.ts`; sun direction and fog colour are read from each HDRI, never hand-set. They turn with the road's heading, and give way to the lamps inside tunnels (`tunnelShade`).

Scenery fills 40 m sections far ahead in the fog (`world/scenery.ts`), standing on the land (`terrainHeight`); never spawn props in view.

Each theme also sets its land (`relief`, rock, snow line), its bends (`curves`) and what the road meets (`structures`: tunnels, viaducts, a lake bridge, overpasses, noise walls). Lengths and sizes of those live in `ROADSIDE` and `TRACK` (`core/config.ts`).

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

## Assets

Vehicles are real glTF models in `public/models/`, fetched and compressed by `scripts/fetch-assets.mjs`.

`world/vehicles/prefab.ts` normalizes each model at load time (faces -z, ground at y = 0, real size) and finds wheels by node name.

Brake lights use the model's own tail lamps (`findTailLamps()` in `world/vehicles/lights.ts`): light units named lamp/light/optics/brake/tail have their rear part cut out at load; plain red parts count only if entirely at the rear (red paint is not a lamp). Stand-in lamps are added only when nothing is found.

If a model is invisible up close or see-through, check its material first (some packs export foliage as glass): replace it, as `treeFix()` does.

If a model renders washed-out white or chrome, check its triangle winding first (`flipWinding` in its spec), not its colours.

Never bake transforms into model geometry: meshes are quantized by meshopt, so copy node matrices instead.

Only use assets whose license allows it (CC0 or CC-BY) and keep `public/models/CREDITS.md` up to date.

Some packs use specular-glossiness materials, which three.js ignores (white models): the fetch script converts every model to metal-rough.

Check a Sketchfab model before downloading: `curl -s https://api.sketchfab.com/v3/models/<id>` → `license.label` and `isDownloadable`. Editorial or no license is a hard no.

Garage cars use real specifications only (power, torque, redline, gear ratios, weight, drive, CdA, brakes); put the maker's figures in `real` and the garage test checks `measure()` lands on them. Only `driveShare` and `cdA` may be tuned to match, never power or weight.

Never read or print `.env.local`: it holds the Sketchfab token.
