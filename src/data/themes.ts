// Themes follow each other as you drive: each lasts ZONE_LENGTH meters, and neighbours blend
// (sky, sun, fog, night lights, the shape of the land) over TRANSITION_LENGTH meters centred on the border.
export type Scenery = 'forest' | 'farm' | 'lake' | 'mountain' | 'desert' | 'industrial' | 'city';
export type Theme = {
  id: string;
  name: string; // shown when you enter it
  sky: { top: number; horizon: number }; // colours of the sky gradient, overhead and at the horizon (the fog takes the horizon's)
  stars: number; // 0..1, how bright the stars are
  exposure: number;
  sun: { intensity: number; color: number; elevation: number; azimuth: number }; // rad above the horizon; rad right of straight ahead
  ambient: number;
  fog: { near: number; far: number }; // m
  ground: number; // colour of the land
  rock: number; // colour of steep slopes and cuttings
  snowLine: number; // m above the road where snow lies on gentle slopes (9999: never)
  water: { color: number; glow: number }; // glow 0..1: lava and toxic pools light themselves
  tint?: number; // every prop (trees, rocks, buildings) recoloured to this; none: their own colours
  relief: {
    hills: number; // m, height of the rolling ground beside the road
    size: number; // m across one hill
    ranges: number; // m, height of the hills or mountains further out (from ~100 m to ~600 m away)
    terraces: number; // m per step of flat-topped mesas (0: none)
  };
  curves: { minRadius: number; maxRadius: number; straight: number }; // m, m, share of straight pieces
  structures: {
    tunnels: number; // per zone, on average
    viaducts: number; // bridges over a valley, per zone on average
    rivers: boolean; // valleys have water at the bottom
    lake: boolean; // one long bridge over a lake
    overpassEvery: number; // m on average between bridges over the motorway (0: none)
    noiseWalls: number; // share of the road lined with noise walls
  };
  scenery: Scenery;
  night: number; // 0 day … 1 night: street lamps, lit windows, headlights
};

const NONE = { tunnels: 0, viaducts: 0, rivers: true, lake: false, overpassEvery: 0, noiseWalls: 0 };
const WATER = { color: 0x2fb8e8, glow: 0 };

// Arcade worlds: bold flat colours, painted skies, nothing has to look real.
export const THEMES: Theme[] = [
  {
    id: 'hills', name: 'Green Hills', sky: { top: 0x2f8cff, horizon: 0xbfe8ff }, stars: 0, exposure: 1,
    sun: { intensity: 2.6, color: 0xfff3d6, elevation: 0.9, azimuth: 0.6 }, ambient: 1.1, fog: { near: 120, far: 900 },
    ground: 0x5fd35a, rock: 0x9b8f7a, snowLine: 9999, water: WATER,
    relief: { hills: 10, size: 240, ranges: 50, terraces: 0 },
    curves: { minRadius: 900, maxRadius: 2600, straight: 0.35 },
    structures: { ...NONE, viaducts: 0.7, overpassEvery: 1100 },
    scenery: 'forest', night: 0,
  },
  {
    id: 'candy', name: 'Candy Land', sky: { top: 0x7fd8ff, horizon: 0xffd6f0 }, stars: 0, exposure: 1,
    sun: { intensity: 2.4, color: 0xfff0f8, elevation: 0.8, azimuth: -0.5 }, ambient: 1.2, fog: { near: 110, far: 850 },
    ground: 0xff9fd2, rock: 0xffe3a3, snowLine: 9999, water: { color: 0xa070ff, glow: 0.2 }, tint: 0xff6fb5,
    relief: { hills: 8, size: 300, ranges: 30, terraces: 0 },
    curves: { minRadius: 1200, maxRadius: 3200, straight: 0.5 },
    structures: { ...NONE, viaducts: 0.4, overpassEvery: 900 },
    scenery: 'farm', night: 0,
  },
  {
    id: 'lake', name: 'Tropical Lagoon', sky: { top: 0x1fa8ff, horizon: 0xc6fbff }, stars: 0, exposure: 1,
    sun: { intensity: 2.8, color: 0xffffff, elevation: 1.0, azimuth: 0.3 }, ambient: 1.1, fog: { near: 140, far: 1000 },
    ground: 0xf6dd8c, rock: 0xd9b26a, snowLine: 9999, water: { color: 0x19e0d0, glow: 0.1 },
    relief: { hills: 10, size: 300, ranges: 90, terraces: 0 },
    curves: { minRadius: 800, maxRadius: 2000, straight: 0.4 },
    structures: { ...NONE, lake: true, viaducts: 0.3, overpassEvery: 1400 },
    scenery: 'lake', night: 0,
  },
  {
    id: 'mountains', name: 'Frozen Peaks', sky: { top: 0x3b6cff, horizon: 0xe4f6ff }, stars: 0, exposure: 1,
    sun: { intensity: 2.6, color: 0xeef8ff, elevation: 0.6, azimuth: 0.9 }, ambient: 1.1, fog: { near: 160, far: 1300 },
    ground: 0xcfeeff, rock: 0x7fa6d9, snowLine: 40, water: { color: 0x8fe8ff, glow: 0 }, tint: 0x9fe6ff,
    relief: { hills: 26, size: 220, ranges: 360, terraces: 0 },
    curves: { minRadius: 480, maxRadius: 950, straight: 0.15 },
    structures: { ...NONE, tunnels: 1.7, viaducts: 1.3 },
    scenery: 'mountain', night: 0,
  },
  {
    id: 'canyon', name: 'Sunset Canyon', sky: { top: 0x6a3cff, horizon: 0xffa04a }, stars: 0.2, exposure: 1,
    sun: { intensity: 2.4, color: 0xffb26a, elevation: 0.12, azimuth: 0 }, ambient: 1, fog: { near: 150, far: 1100 },
    ground: 0xff8a4c, rock: 0xd2452e, snowLine: 9999, water: WATER,
    relief: { hills: 7, size: 360, ranges: 130, terraces: 16 },
    curves: { minRadius: 1000, maxRadius: 3000, straight: 0.55 },
    structures: { ...NONE, viaducts: 0.5, rivers: false },
    scenery: 'desert', night: 0,
  },
  {
    id: 'volcano', name: 'Volcano', sky: { top: 0x1a0610, horizon: 0xff4a1c }, stars: 0.3, exposure: 1,
    sun: { intensity: 1.6, color: 0xff7a3a, elevation: 0.25, azimuth: -0.4 }, ambient: 0.8, fog: { near: 90, far: 800 },
    ground: 0x3a2a33, rock: 0x1e1a22, snowLine: 9999, water: { color: 0xff5a10, glow: 1 }, tint: 0x5a2a2a,
    relief: { hills: 20, size: 220, ranges: 300, terraces: 0 },
    curves: { minRadius: 600, maxRadius: 1200, straight: 0.25 },
    structures: { ...NONE, tunnels: 1, viaducts: 1.5 },
    scenery: 'mountain', night: 0.5,
  },
  {
    id: 'alien', name: 'Alien Planet', sky: { top: 0x0e5a4a, horizon: 0x9dff7a }, stars: 0.5, exposure: 1,
    sun: { intensity: 2.2, color: 0xd6ff9a, elevation: 0.3, azimuth: 0.7 }, ambient: 1, fog: { near: 120, far: 950 },
    ground: 0x8a4cff, rock: 0x3fe0c8, snowLine: 9999, water: { color: 0xff40d0, glow: 0.6 }, tint: 0x3ff0ff,
    relief: { hills: 12, size: 260, ranges: 180, terraces: 10 },
    curves: { minRadius: 800, maxRadius: 2200, straight: 0.4 },
    structures: { ...NONE, viaducts: 0.8 },
    scenery: 'desert', night: 0.2,
  },
  {
    id: 'toxic', name: 'Toxic Works', sky: { top: 0x3a4a10, horizon: 0xd8ff4a }, stars: 0, exposure: 1,
    sun: { intensity: 2, color: 0xeaff9a, elevation: 0.5, azimuth: 0.2 }, ambient: 1, fog: { near: 70, far: 600 },
    ground: 0x6b7a3a, rock: 0x4a4a40, snowLine: 9999, water: { color: 0x7dff2a, glow: 0.9 }, tint: 0xc8ff6a,
    relief: { hills: 3, size: 300, ranges: 0, terraces: 0 },
    curves: { minRadius: 900, maxRadius: 2000, straight: 0.5 },
    structures: { ...NONE, overpassEvery: 700, noiseWalls: 0.3 },
    scenery: 'industrial', night: 0.3,
  },
  {
    id: 'neon', name: 'Neon City', sky: { top: 0x12002e, horizon: 0xff2fa8 }, stars: 0.8, exposure: 1.1,
    sun: { intensity: 0.4, color: 0xb070ff, elevation: 0.08, azimuth: 0 }, ambient: 0.6, fog: { near: 60, far: 520 },
    ground: 0x2a1450, rock: 0x3a1a6a, snowLine: 9999, water: { color: 0x20f0ff, glow: 0.8 }, tint: 0x8a5cff,
    relief: { hills: 2, size: 300, ranges: 0, terraces: 0 },
    curves: { minRadius: 700, maxRadius: 1600, straight: 0.4 },
    structures: { ...NONE, overpassEvery: 600, noiseWalls: 0.35 },
    scenery: 'city', night: 1,
  },
  {
    id: 'autumn', name: 'Autumn Woods', sky: { top: 0x4a90ff, horizon: 0xffe0b0 }, stars: 0, exposure: 1,
    sun: { intensity: 2.5, color: 0xffd9a0, elevation: 0.35, azimuth: -0.8 }, ambient: 1, fog: { near: 110, far: 850 },
    ground: 0xe0a040, rock: 0x9a5a3a, snowLine: 9999, water: WATER, tint: 0xff7a20,
    relief: { hills: 12, size: 260, ranges: 80, terraces: 0 },
    curves: { minRadius: 800, maxRadius: 2200, straight: 0.3 },
    structures: { ...NONE, viaducts: 0.6, overpassEvery: 1200 },
    scenery: 'forest', night: 0,
  },
  {
    id: 'midnight', name: 'Midnight Forest', sky: { top: 0x050a2a, horizon: 0x2a3a9a }, stars: 1, exposure: 1.2,
    sun: { intensity: 0.5, color: 0x9ab0ff, elevation: 0.5, azimuth: 0.5 }, ambient: 0.5, fog: { near: 50, far: 480 },
    ground: 0x1f4a6a, rock: 0x2a3050, snowLine: 9999, water: { color: 0x40a0ff, glow: 0.4 }, tint: 0x4a7aff,
    relief: { hills: 10, size: 260, ranges: 60, terraces: 0 },
    curves: { minRadius: 800, maxRadius: 2200, straight: 0.35 },
    structures: { ...NONE, viaducts: 0.6, overpassEvery: 1200 },
    scenery: 'forest', night: 1,
  },
];
export const ZONE_LENGTH = 2500;
export const TRANSITION_LENGTH = 600;
