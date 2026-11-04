// All gameplay tuning lives here. Units: meters, seconds, radians.

export const LANE_WIDTH = 3.6; // real motorway lane
export const LANE_COUNT = 4;
export const LANES = Array.from({ length: LANE_COUNT }, (_, i) => (i - (LANE_COUNT - 1) / 2) * LANE_WIDTH);
export const CARRIAGEWAY_HALF = (LANE_COUNT * LANE_WIDTH) / 2; // solid edge lines
export const GUARDRAIL_X = CARRIAGEWAY_HALF + 2.5; // hard shoulder, then the rail
// Hard shoulder: drivable, but no points, rumble-strip drag and broken-down cars, so it is never a shortcut past traffic.
export const SHOULDER = {
  x: (CARRIAGEWAY_HALF + GUARDRAIL_X) / 2, // m, where broken-down cars stand (either side)
  drag: 3, // m/s² of extra deceleration with the car's centre past the edge line
  breakdownGap: [1200, 400] as [left: number, right: number], // m on average between broken-down cars per side, randomised ±50%
  queueGap: [20, 45] as [min: number, max: number], // m between them while someone drives on that shoulder: no gap to weave through
  queueMax: 5, // cars in such a block, then the usual spacing until the shoulder is left and taken again
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

export const START_SPEED = 25; // rolling start, m/s (90 km/h)

export const TRAFFIC = {
  laneSpeedsKmh: [130, 115, 100, 85], // left lane is the fast lane
  speedJitterKmh: 10,
  truckKmh: 85,
  heavyChance: 0.3, // vans and trucks, right two lanes only
  spawnAhead: -300,
  spawnBehind: 60,
  despawnAhead: -360,
  despawnBehind: 90,
  densityStart: 10,
  densityMax: 26,
  densityPerKm: 2,
  laneChangePerSec: 0.04, // spontaneous lane changes, per car
  blockedLaneChangePerSec: 0.6, // when stuck behind someone slower
  laneChangeSpeed: 1.6, // lateral m/s
  blinkerTime: 1.4,
  minGap: 7,
  headwaySec: 1.3,
  accel: 2.2,
  brake: 7,
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

// Player-vs-player contact: a closing speed above this is a crash, below it a shove.
export const BUMP = { crashKmh: 45, push: 4 }; // push: sideways m/s given on contact

