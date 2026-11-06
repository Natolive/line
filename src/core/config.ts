// All gameplay tuning lives here. Units: meters, seconds, radians.

export const LANE_WIDTH = 3.6; // real motorway lane
export const LANE_COUNT = 4;
export const LANES = Array.from({ length: LANE_COUNT }, (_, i) => (i - (LANE_COUNT - 1) / 2) * LANE_WIDTH);
export const CARRIAGEWAY_HALF = (LANE_COUNT * LANE_WIDTH) / 2; // solid edge lines
export const GUARDRAIL_X = CARRIAGEWAY_HALF + 2.5; // hard shoulder, then the rail
// Hard shoulder: drivable, but no points and rumble-strip drag, so it is never a shortcut past traffic; now and then a broken-down car.
export const SHOULDER = {
  x: (CARRIAGEWAY_HALF + GUARDRAIL_X) / 2, // m, where broken-down cars stand (either side)
  drag: 3, // m/s² of extra deceleration with the car's centre past the edge line
  breakdownGap: [3000, 1500] as [left: number, right: number], // m on average between broken-down cars per side, randomised ±50%, never bunched
};

export const SUSPENSION = {
  frequency: 1.6, // Hz, how fast the body bounces
  damping: 0.35, // < 1 rebounds a little (visible), 1 = no overshoot
  pitchPerAccel: 0.004, // rad per m/s²: squat when accelerating, dive when braking
  rollPerAccel: 0.005, // rad per m/s² of cornering
  maxTilt: 0.07, // rad
  bumpEvery: 25, // m between road imperfections, randomised
  bumpKick: 0.25, // m/s of vertical kick per bump at 108 km/h
};

// Standing start behind a line with traffic lights; meanwhile the garage car cruises down the road.
export const START = {
  line: 3.5, // m ahead of the front row (d = 0): the chequered line and the lights
  rowGap: 14, // m between rows of the online grid (rules/grid.ts): four abreast, front row at d = 0
  red: 1.5, // s of red before amber (solo; online the server's countdown is red until its last second)
  amber: 1, // s of amber before green
  menuKmh: 70, // the garage car's cruising speed
  menuLane: 2, // the lane it cruises in
};

export const TRAFFIC = {
  laneSpeedsKmh: [130, 115, 100, 85], // left lane is the fast lane
  speedJitterKmh: 10,
  truckKmh: 85,
  heavyChance: 0.3, // vans and trucks, right two lanes only
  spawnAhead: -300,
  spawnBehind: 60,
  startClear: 600, // m past the start where no traffic comes up from behind: the grid gets away in peace
  despawnAhead: -360,
  despawnBehind: 90,
  densityStart: 10,
  densityMax: 26,
  densityPerKm: 2,
  laneChangePerSec: 0.04, // spontaneous lane changes, per car
  blockedLaneChangePerSec: 0.6, // when stuck behind someone slower
  laneChangeSpeed: 1.6, // lateral m/s, on average: the move is an S, eased in and out
  laneChangeLean: 3, // × the body roll of a lane change, so it reads at a glance (arcade)
  blinkerTime: 1.4,
  minGap: 7,
  headwaySec: 1.3,
  accel: 2.2,
  brake: 7,
  curveAccel: 3, // m/s²: drivers slow down for bends that would push them sideways harder than this
  mergeAhead: 450, // m: from this far before a closed lane, its drivers work their way over to an open one
  mergePerSec: 2, // tries per second to move over, then (vans and lorries too, into any open lane)
};

// Events on the road (rules/events.ts): roadworks, a lost load and accidents stand at fixed spots of the map;
// a wide-load convoy and police chases are traffic (world/traffic.ts), simulated by whoever runs the traffic.
export const EVENTS = {
  every: 1100, // m between candidate spots for a roadworks, lost load or accident
  chance: 0.6, // share of those spots that get one
  firstAt: 1200, // m: none before this, past the start line
  worksLength: [250, 450] as [min: number, max: number], // m of closed lanes
  taper: 60, // m over which the cones lead traffic out of the closed lanes
  coneEvery: 8, // m between cones along a closure
  signsAhead: [400, 200], // m before roadworks and accidents: warning signs on the shoulder
  loadLength: 40, // m of road strewn with boxes and tyres
  trianglesAhead: 60, // m: a warning triangle before an accident
  // footprint (m) and mass (kg) of what stands on the road; light things are knocked flying, solid ones don't budge
  things: {
    cone: { w: 0.45, l: 0.45, mass: 5 },
    sign: { w: 1.2, l: 0.3, mass: 15 },
    triangle: { w: 0.6, l: 0.2, mass: 2 },
    tyre: { w: 0.8, l: 0.8, mass: 12 },
    box: { w: 1.1, l: 1.1, mass: 45 },
    arrow: { w: 2.2, l: 3.2, mass: 1e9 }, // the flashing arrow trailer that opens roadworks
    wreck: { w: 1.9, l: 4.5, mass: 1e9 },
    truck: { w: 2.5, l: 9, mass: 1e9 }, // the lorry that lost its load, on the shoulder
    digger: { w: 2.6, l: 6.5, mass: 1e9 }, // site machines parked in the closed lanes
    roller: { w: 2.2, l: 4.6, mass: 1e9 },
    dumper: { w: 2.5, l: 7.5, mass: 1e9 },
  },
  machines: [1, 3] as [min: number, max: number], // site machines per roadworks
  // what you knock flying: thrown ahead at this share of your speed, up at up to `lift` m/s, tumbling
  fling: { share: 0.7, lift: 6, spin: 9, bounce: 0.3, rollDrag: 6 }, // share, m/s, rad/s, kept on a bounce, m/s² of slide
  // moving events: how often (s on average) the traffic sends one, and how they drive
  policeEverySec: 70,
  convoyEverySec: 100,
  policeKmh: 185, // at least; and always this much faster than the fastest player:
  policeOverKmh: 40,
  convoyKmh: 60,
  convoyClearAhead: 2500, // m of road with both right lanes open that a wide load needs before it is sent
  escortGap: 28, // m between the wide load and each of its motorbike escorts
  yieldDistance: 150, // m: traffic ahead of a police car in its lane moves over
  announceAhead: 450, // m: the HUD warns of an event this far ahead
  announceSec: 3.5, // s the warning stays on screen
};

// The progress line on the right, online (rules/progress.ts): it zooms on the pack.
export const PROGRESS = {
  minSpan: 1000, // m of road it shows at least
  pad: 150, // m of road kept beyond the first and last driver
  tick: 100, // m between the marks that scroll down it as you drive
};

// Rear-view mirror: its frame warns of what comes up behind.
export const MIRROR = {
  warnGap: 40, // m: a vehicle in my path behind, closing in, nearer than this lights the frame red (brighter the nearer)
  minClosing: 1.5, // m/s it must be gaining on me to count
  policeRange: 150, // m: a police car this close behind flashes the frame red and blue
};

export const NEAR_MISS = { gap: 1.0, minSpeed: 25, points: 250 };
export const SCORE_TIERS: [kmh: number, multiplier: number][] = [[250, 4], [200, 3], [150, 2], [0, 1]];
// The wreck (rules/crash.ts): it slides on, spins and, at speed, rolls over.
export const CRASH = {
  duration: 3.5, // s of crash scene before the game-over screen or spectating
  keep: 0.55, // share of the speed the wreck keeps after the impact
  sideKick: 0.25, // lateral m/s per forward m/s, thrown to a random side
  fullSpeed: 50, // m/s (180 km/h): the speed the figures below are given for; the crash scales with speed (×2 at most)
  spin: 4, // rad/s of yaw, randomised
  spinDamp: 1.5, // 1/s, yaw slowing while it scrapes the ground
  rollSpeed: 25, // m/s (90 km/h): faster impacts start to tip the car, rolling it more the faster they are
  launch: 4.5, // m/s upward, randomised
  rollRate: 8, // rad/s, randomised
  rollDamp: 1.2, // 1/s, roll slowing on the ground
  settleRate: 2.5, // rad/s: below this it can't tip over again and settles on its wheels or roof
  friction: 0.8, // × g, sliding on tyres, body or roof
  bounce: 0.3, // vertical speed kept at each landing
  landingSpeed: 2, // m/s downward: a landing hard enough to bounce (and throw debris)
  slowMo: 0.3, // time scale right at the impact (at fullSpeed; none at a standstill)
  slowMoTime: 0.8, // s (real) to ease back to full speed
};

// Battle royale: a storm wall chases the pack and speeds up; caught = eliminated.
export const WALL = {
  startD: -150, // m behind the start line when the race begins
  startKmh: 80,
  rampKmhPerSec: 1.5, // +90 km/h per minute
  maxKmh: 260,
};


// The road's shape (rules/track.ts): a chain of pieces, each straight or one bend eased in and out.
export const TRACK = {
  piece: 500, // m per piece
  transition: 150, // m of easing (clothoid: curvature grows linearly) at each end of a bend
  step: 5, // m between stored samples of the road's heading and position
  straightStart: 500, // m straight from the start line: the grid and the garage sit there
};

// Beside the road: the land, tunnels, bridges and signs (rules/track.ts, world/road/, world/terrain.ts).
export const ROADSIDE = {
  corridor: 16, // m from the centre line: road, shoulders and verge; the landscape starts beyond
  zoneMargin: 380, // m from a zone border inside which no tunnel or bridge starts (the landscape blends there)
  structureGap: 300, // m between two tunnels or bridges, room for their approaches
  tunnelLength: [250, 900] as [min: number, max: number], // m
  tunnelHalf: 10.6, // m from the centre to a tunnel wall
  tunnelHeight: 7.8, // m to the crown of the vault
  tunnelFade: 40, // m over which daylight gives way to the tunnel lamps, at each portal
  viaductLength: [140, 420] as [min: number, max: number], // m
  viaductDepth: [16, 36] as [min: number, max: number], // m from the deck down to the valley floor
  lakeLength: [600, 1100] as [min: number, max: number], // m of bridge over the lake
  lakeWater: 3, // m from the deck down to the lake
  overpassSlot: 300, // m between candidate spots for a bridge over the motorway
  overpassClear: 6.3, // m under it (lorries are 4 m)
  gantryEvery: 700, // m between sign gantries
  chevronRadius: 900, // m: bends tighter than this get chevron signs on the outside
  finishClear: 60, // m past a tunnel or bridge where a race's finish line stands, if its distance falls on one
};

// Impacts (rules/impact.ts): judged on how hard each car is jolted (its change of speed), as crash tests are.
export const IMPACT = {
  restitution: 0.2, // share of the closing speed that bounces back (cars crumple)
  railRestitution: 0.3,
  scratchKmh: 6, // km/h of jolt below which a touch only scrapes paint
  wreckKmh: 32, // km/h of jolt that wrecks the car outright (≈ a 55 km/h rear-end into an equal car)
  railWreckKmh: 45, // rails give: a harder jolt is needed against them
  damageAtWreck: 90, // % of damage from a jolt just under the wreck threshold (it grows with the square of the jolt)
  scrapePerSec: 2, // % of damage per second grinding along a rail at 100 km/h (more when faster)
  smokeAt: 50, // %: the engine starts smoking
  limpAt: 75, // %: it loses power and pulls to one side
  limpPower: 0.45, // share of power left at 100 %
  limpPull: 0.07, // steering pull at 100 % (share of full lock)
  slipGrip: 0.8, // × the car's grip: how fast tyres soak up a sideways shove
  spinDamp: 3, // 1/s: how fast a knock's spin dies out
  massPerM2: 160, // kg per m² of footprint, for cars and lorries alike (a car ≈ 1.4 t, a lorry ≈ 4×)
  shakenTime: 2.5, // s a traffic driver brakes, hazards on, after being hit
};
