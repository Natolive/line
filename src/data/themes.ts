// Themes follow each other as you drive: each lasts ZONE_LENGTH meters, and neighbours blend
// (sky, sun, fog, night lights) over TRANSITION_LENGTH meters centred on the border.
export type Theme = {
  id: string;
  name: string; // shown when you enter it
  sky: string; // Poly Haven HDRI id (public/sky/)
  skyGain: number; // brightness of the sky photo
  exposure: number;
  envIntensity: number; // reflections on cars
  sun: { intensity: number; color: number };
  ambient: number;
  fog: { near: number; far: number };
  ground: string; // Poly Haven texture id (public/textures/)
  groundTint: number; // multiplies the ground photo
  scenery: 'forest' | 'city';
  night: number; // 0 day … 1 night: street lamps, lit windows, headlights
};
export const THEMES: Theme[] = [
  {
    id: 'countryside', name: 'Countryside', sky: 'kloofendal_48d_partly_cloudy_puresky', skyGain: 1, exposure: 0.9, envIntensity: 0.8,
    sun: { intensity: 3, color: 0xfff1de }, ambient: 0.35, fog: { near: 90, far: 650 }, ground: 'aerial_grass_rock', groundTint: 0x9fc27a, scenery: 'forest', night: 0,
  },
  {
    id: 'city', name: 'City', sky: 'belfast_sunset_puresky', skyGain: 1, exposure: 0.95, envIntensity: 0.7,
    sun: { intensity: 2.4, color: 0xffc48a }, ambient: 0.3, fog: { near: 70, far: 560 }, ground: 'concrete_floor_worn_001', groundTint: 0xd8d4cc, scenery: 'city', night: 0,
  },
  {
    id: 'night', name: 'City by night', sky: 'kloppenheim_02_puresky', skyGain: 2.5, exposure: 1.1, envIntensity: 0.35,
    sun: { intensity: 0.25, color: 0x9fb4ff }, ambient: 0.12, fog: { near: 40, far: 430 }, ground: 'concrete_floor_worn_001', groundTint: 0xb0b0b8, scenery: 'city', night: 1,
  },
];
export const ZONE_LENGTH = 2500;
export const TRANSITION_LENGTH = 600;
