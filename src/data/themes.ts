// Themes follow each other as you drive: each lasts ZONE_LENGTH meters, and neighbours blend
// (sky, sun, fog, night lights, the shape of the land) over TRANSITION_LENGTH meters centred on the border.
export type Scenery = 'forest' | 'farm' | 'lake' | 'mountain' | 'desert' | 'industrial' | 'city';
export type Theme = {
  id: string;
  name: string; // shown when you enter it
  sky: string; // Poly Haven HDRI id (public/sky/)
  skyGain: number; // brightness of the sky photo
  exposure: number;
  envIntensity: number; // reflections on cars
  sun: { intensity: number; color: number };
  ambient: number;
  fog: { near: number; far: number }; // m
  ground: string; // Poly Haven texture id (public/textures/)
  groundTint: number; // multiplies the ground photo
  rock: string; // texture of steep slopes and cuttings
  rockTint: number;
  snowLine: number; // m above the road where snow lies on gentle slopes (9999: never)
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
const ROCK = 'aerial_rocks_02';

export const THEMES: Theme[] = [
  {
    id: 'countryside', name: 'Countryside', sky: 'kloofendal_48d_partly_cloudy_puresky', skyGain: 1, exposure: 0.9, envIntensity: 0.8,
    sun: { intensity: 3, color: 0xfff1de }, ambient: 0.35, fog: { near: 90, far: 700 },
    ground: 'aerial_grass_rock', groundTint: 0x9fc27a, rock: ROCK, rockTint: 0xb4aca0, snowLine: 9999,
    relief: { hills: 9, size: 260, ranges: 45, terraces: 0 },
    curves: { minRadius: 900, maxRadius: 2600, straight: 0.35 },
    structures: { ...NONE, viaducts: 0.7, overpassEvery: 1100 },
    scenery: 'forest', night: 0,
  },
  {
    id: 'farmland', name: 'Farmland', sky: 'farm_field_puresky', skyGain: 1, exposure: 0.85, envIntensity: 0.8,
    sun: { intensity: 3.2, color: 0xfff4e2 }, ambient: 0.35, fog: { near: 110, far: 850 },
    ground: 'aerial_grass_rock', groundTint: 0xc9c27c, rock: ROCK, rockTint: 0xb8ab96, snowLine: 9999,
    relief: { hills: 6, size: 420, ranges: 22, terraces: 0 },
    curves: { minRadius: 1200, maxRadius: 3200, straight: 0.5 },
    structures: { ...NONE, viaducts: 0.4, overpassEvery: 900 },
    scenery: 'farm', night: 0,
  },
  {
    id: 'lake', name: 'Lakeside', sky: 'qwantani_late_afternoon_puresky', skyGain: 1, exposure: 0.85, envIntensity: 0.9,
    sun: { intensity: 2.8, color: 0xffe2b8 }, ambient: 0.35, fog: { near: 140, far: 1000 },
    ground: 'aerial_grass_rock', groundTint: 0x93b46e, rock: ROCK, rockTint: 0xa8a198, snowLine: 9999,
    relief: { hills: 12, size: 300, ranges: 110, terraces: 0 },
    curves: { minRadius: 800, maxRadius: 2000, straight: 0.4 },
    structures: { ...NONE, lake: true, viaducts: 0.3, overpassEvery: 1400 },
    scenery: 'lake', night: 0,
  },
  {
    id: 'mountains', name: 'Mountains', sky: 'pizzo_pernice_puresky', skyGain: 1, exposure: 0.8, envIntensity: 0.9,
    sun: { intensity: 3.2, color: 0xfff6ea }, ambient: 0.4, fog: { near: 160, far: 1300 },
    ground: 'aerial_grass_rock', groundTint: 0x8ea56c, rock: ROCK, rockTint: 0xaaa49c, snowLine: 190,
    relief: { hills: 26, size: 220, ranges: 360, terraces: 0 },
    curves: { minRadius: 480, maxRadius: 950, straight: 0.15 },
    structures: { ...NONE, tunnels: 1.7, viaducts: 1.3 },
    scenery: 'mountain', night: 0,
  },
  {
    id: 'desert', name: 'Desert', sky: 'lonely_road_afternoon_puresky', skyGain: 1, exposure: 0.8, envIntensity: 0.8,
    sun: { intensity: 3.4, color: 0xffe6c4 }, ambient: 0.4, fog: { near: 150, far: 1100 },
    ground: 'aerial_sand', groundTint: 0xe6c49a, rock: ROCK, rockTint: 0xc98d62, snowLine: 9999,
    relief: { hills: 7, size: 360, ranges: 130, terraces: 16 },
    curves: { minRadius: 1000, maxRadius: 3000, straight: 0.55 },
    structures: { ...NONE, viaducts: 0.5, rivers: false },
    scenery: 'desert', night: 0,
  },
  {
    id: 'industrial', name: 'Industrial zone', sky: 'industrial_sunset_02_puresky', skyGain: 1, exposure: 0.9, envIntensity: 0.7,
    sun: { intensity: 2.6, color: 0xffcf9e }, ambient: 0.32, fog: { near: 80, far: 620 },
    ground: 'gravel_ground_01', groundTint: 0xb4b0a4, rock: ROCK, rockTint: 0xa09a90, snowLine: 9999,
    relief: { hills: 3, size: 300, ranges: 0, terraces: 0 },
    curves: { minRadius: 900, maxRadius: 2000, straight: 0.5 },
    structures: { ...NONE, overpassEvery: 700, noiseWalls: 0.3 },
    scenery: 'industrial', night: 0,
  },
  {
    id: 'city', name: 'City', sky: 'belfast_sunset_puresky', skyGain: 1, exposure: 0.95, envIntensity: 0.7,
    sun: { intensity: 2.4, color: 0xffc48a }, ambient: 0.3, fog: { near: 70, far: 560 },
    ground: 'concrete_floor_worn_001', groundTint: 0xd8d4cc, rock: 'concrete_wall_008', rockTint: 0xc8c4bc, snowLine: 9999,
    relief: { hills: 2, size: 300, ranges: 0, terraces: 0 },
    curves: { minRadius: 700, maxRadius: 1600, straight: 0.4 },
    structures: { ...NONE, overpassEvery: 600, noiseWalls: 0.35 },
    scenery: 'city', night: 0,
  },
  {
    id: 'night', name: 'City by night', sky: 'kloppenheim_02_puresky', skyGain: 2.5, exposure: 1.1, envIntensity: 0.35,
    sun: { intensity: 0.25, color: 0x9fb4ff }, ambient: 0.12, fog: { near: 40, far: 430 },
    ground: 'concrete_floor_worn_001', groundTint: 0xb0b0b8, rock: 'concrete_wall_008', rockTint: 0x9a9aa0, snowLine: 9999,
    relief: { hills: 2, size: 300, ranges: 0, terraces: 0 },
    curves: { minRadius: 700, maxRadius: 1600, straight: 0.4 },
    structures: { ...NONE, overpassEvery: 600, noiseWalls: 0.35 },
    scenery: 'city', night: 1,
  },
];
export const ZONE_LENGTH = 2500;
export const TRANSITION_LENGTH = 600;
