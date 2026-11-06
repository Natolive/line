# Line

Drive down an endless motorway, weave through traffic, don't crash.

## Play

Start the game: `docker compose up -d --build`

Open it: http://lane.localhost

Follow the logs: `docker compose logs -f game`

Stop it: `docker compose down`

The multiplayer server runs in the `server` container, reachable at `ws://lane.localhost/ws`.

## The road

The motorway runs through eight areas in a loop: Countryside, Farmland, Lakeside, Mountains, Desert, Industrial zone, City, City by night.

Each area lasts 2.5 km; the sky, sun, fog, lights and the shape of the land blend into the next one over 600 m.

The road bends like a real motorway (eased clothoid curves), gently in the plains, tightly in the mountains: take a bend faster than your tyres can hold and you run wide into the rail. Red chevrons mark the tight ones; traffic slows down for them.

On the way: tunnels through the mountains (dark inside, lit by their lamps), viaducts over river valleys, a long bridge across the lake, local roads crossing over on bridges, noise walls in town, wind turbines and power lines across the fields, mesas and cacti in the desert. Every race is a new map: another starting region, other bends, tunnels, bridges, hills and scenery. Online, the whole room races on the same one.

Green gantries over the road tell you which area comes next and how far it is.

At night, street lamps, lit windows and headlights come on.

## Online: battle royale or race

Press `B` in the menu (or the Online button), type your name and a room code.

Share the room code: friends who type the same code join your room (up to 16 drivers).

The first player in the room is the host and starts the race with `Space`.

Everyone starts side by side; a storm wall chases the pack and keeps speeding up (80 → 260 km/h).

You're out if the storm catches you or your car is wrecked. Contact between drivers follows the same rules as with traffic (below): a shove in the side is a real tactic, ramming someone hard wrecks you both.

Once you're out, you spectate: the camera rides with the nearest driver still racing; `←` `→` (or a tap) switches driver.

The last driver on the road wins; everyone sees the final ranking, then `Space` goes back to the lobby.

In the lobby, the host picks the mode: battle royale (above) or a race of 5, 10 or 20 km. In a race there is no storm: a chequered FINISH gantry stands at that distance (just past a tunnel or bridge if it falls on one). Wrecked drivers are out; finishers drive on. Once the winner is home, the others have 60 s to finish. The ranking puts finishers by time, then the others by how far they got.

In the lobby, the host can also put everyone on the same figures (power, weight, gearing, brakes) as one garage car, so only driving makes the difference; each player keeps the look of their own car.

To try it alone, open the game in two browser windows and join the same room code.

Netcode: binary messages (19 bytes per car, stamped with when the sender simulated it), cars and traffic over UDP (a WebRTC data channel, with the WebSocket as fallback), a 60 Hz server tick sending one snapshot per room, other cars predicted to the present with smoothed corrections (as racing games do), and ping/pong clock sync; ping and prediction quality show in the race HUD.

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

Knocks are judged by how hard your car is jolted, as in crash tests, from both cars' speeds, the angle and their masses (a lorry hardly moves):

- a side swipe pushes both cars apart and may spin you a little, with sparks: harmless;
- a harder knock (say 15-50 km/h faster into someone's back, or a firm shove) damages the car; damage adds up (gauge under the speedometer);
- from 50 % the engine smokes, from 75 % it loses power and pulls to one side, at 100 % it's wrecked;
- a violent hit (about 55 km/h faster into the back of a car) wrecks it at once.

The guardrail is safe to brush along but costs a little damage while you grind it; hit it at a steep angle at speed and it can wreck you. Cars you knock brake with their hazards on, then steer back into their lane.

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

## Models

There are no model files: every car and prop is built from scratch in code, as a low-poly arcade toy.
Cars are in `src/world/vehicles/fleet.ts`, props (trees, rocks, buildings…) in `src/world/props/`, listed in `src/world/assets.ts`.

To add a garage car: add one file in `src/data/cars/` (copy an existing car), list it in `src/data/cars/index.ts`, and give it a toy design in `PLAYERS` in `src/world/vehicles/fleet.ts`.

## Project layout

`src/core/` holds the game loop and the gameplay tuning (`config.ts`).

`src/data/` holds content: one file per garage car (`cars/`) and the themes (`themes.ts`).

`src/rules/` holds pure logic: car physics and gearbox, collisions, difficulty, themes. It is the only tested part.

`src/world/` holds everything 3D: camera, sky and light (`environment.ts`), the curved road with its tunnels and bridges (`road.ts`), the land (`terrain.ts`), scenery, traffic AI, effects; cars in `world/vehicles/`. The road's shape and the land are pure functions of the distance (`rules/track.ts`, `rules/terrain.ts`), the same for every player.



`src/ui/` holds the HTML overlay: dashboard and menus.

`src/net/` holds the multiplayer messages (`protocol.ts`, shared with the server) and the connection.

`server/` holds the multiplayer server: `rooms.ts` (rooms, host, eliminations, winner) and `index.ts` (WebSocket).

`src/platform/` holds browser input and sound.

`tests/` holds the tests for `src/rules/`.

`prototype/2d.html` is the original 2D prototype, kept for quick gameplay experiments.
