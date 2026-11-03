# Line

Drive down an endless motorway, weave through traffic, don't crash.

## Play

Start the game: `docker compose up -d --build`

Open it: http://lane.localhost

Follow the logs: `docker compose logs -f game`

Stop it: `docker compose down`

The multiplayer server runs in the `server` container, reachable at `ws://lane.localhost/ws`.

## The road

The motorway runs through three areas in a loop: Countryside, City, City by night.

Each area lasts 2.5 km; the sky, sun, fog and lights blend into the next one over 600 m.

Green gantries over the road tell you which area comes next and how far it is.

At night, street lamps, lit windows and headlights come on.

## Battle royale (online)

Press `B` in the menu (or the Battle royale button), type your name and a room code.

Share the room code: friends who type the same code join your room (up to 16 drivers).

The first player in the room is the host and starts the race with `Space`.

Everyone starts side by side; a storm wall chases the pack and keeps speeding up (80 → 260 km/h).

You're out if the storm catches you, if you hit traffic, or if you ram another driver (45 km/h closing speed or more).

Lighter contact between drivers just shoves you aside, with sparks.

The last driver on the road wins; everyone sees the final ranking, then `Space` goes back to the lobby.

To try it alone, open the game in two browser windows and join the same room code.

Netcode: binary messages (19 bytes per car, stamped with when the sender simulated it), a 30 Hz server tick sending one snapshot per room, other cars predicted to the present with smoothed corrections (as racing games do), and ping/pong clock sync; ping and prediction quality show in the race HUD.

## Garage

Pick your car in the menu with `←` `→` or the arrow buttons.

Each car drives with its real specifications: engine power and torque, redline, gear ratios, weight, drive type, aerodynamics and brakes.

The garage shows them, plus the 0–100 km/h, top speed and 100–0 braking the physics actually produce.

Your choice is remembered next time.

## Controls

Accelerate: `↑` or `W`

Brake: `↓` or `S`

Steer: `←` `→` or `A` `D`

Start, resume, retry: `Space`

Pause: `P` or `Esc`

Mute: `M`

On touch screens, hold the left or right edge to steer and the middle to brake; throttle is automatic.

## Scoring

Distance earns points.

Speed multiplies them: ×2 above 150 km/h, ×3 above 200, ×4 above 250.

Passing a car within 1 m earns a near-miss bonus.

Hitting the guardrail slows you down; hitting a car ends the run.

## Production

Every push to `main` deploys automatically: GitHub Actions tests, builds the image (`ghcr.io/natolive/line:<commit>`), then runs `/srv/line/deploy.sh <commit>` on the server.

Live at https://line.natolive.fr (http redirects to https), or http://57.129.174.3:8000 by IP on networks that filter natolive.fr (8000 passes filters that block less common ports).

One container serves the game and the multiplayer server (`compose.prod.yml`); Caddy in front adds HTTPS.

Roll back by hand on the server: `/srv/line/deploy.sh <older commit sha>`.

Health check: `/health`.

## Develop without Docker

Use Node 22: `nvm use`

Install dependencies: `npm install`

Run the dev server: `npm run dev`

Run the multiplayer server next to it: `npm run server` (Vite forwards `/ws` to it).

Check types: `npm run typecheck`

Run the tests: `npm test`

Build for production: `npm run build`

## Assets

Cars, traffic, buildings and trees are real 3D models from Sketchfab, licensed CC-BY.

Skies (HDRI photos) and ground and road textures come from Poly Haven, licensed CC0.

Authors and links are in `public/models/CREDITS.md`; keep that file when you ship.

To re-download them, put your Sketchfab API token in `.env.local` as `SKETCHFAB_TOKEN=...`.

Then run: `node scripts/fetch-assets.mjs` (it fetches Poly Haven files too, no account needed).

To swap a model, change its id at the top of `scripts/fetch-assets.mjs`, delete the old `.glb`, and run the script again.

To add a garage car: add its model to `MODELS` in the fetch script, add one file in `src/data/cars/` (copy an existing car), list it in `src/data/cars/index.ts`, and describe its model file in `PLAYER_SPECS` in `src/world/vehicles/fleet.ts`.

A model is usable only if Sketchfab shows a Download button and a CC0 or CC Attribution license; "Editorial" or no license means no.

## Project layout

`src/core/` holds the game loop and the gameplay tuning (`config.ts`).

`src/data/` holds content: one file per garage car (`cars/`) and the themes (`themes.ts`).

`src/rules/` holds pure logic: car physics and gearbox, collisions, difficulty, themes. It is the only tested part.

`src/world/` holds everything 3D: camera, sky and light (`environment.ts`), road, scenery, traffic AI, effects; cars in `world/vehicles/`.



`src/ui/` holds the HTML overlay: dashboard and menus.

`src/net/` holds the multiplayer messages (`protocol.ts`, shared with the server) and the connection.

`server/` holds the multiplayer server: `rooms.ts` (rooms, host, eliminations, winner) and `index.ts` (WebSocket).

`src/platform/` holds browser input and sound.

`tests/` holds the tests for `src/rules/`.

`prototype/2d.html` is the original 2D prototype, kept for quick gameplay experiments.
