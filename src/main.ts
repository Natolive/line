import './ui/style.css';
import { Game } from './core/game.ts';
import { showLoading } from './ui/hud.ts';
import { loadWorld } from './world/assets.ts';
import { loadFleet } from './world/vehicles/fleet.ts';

// Everything heavy (3D models, skies, textures) loads before the game starts, behind a progress bar.
const progress = [0, 0];
const report = (i: number) => (f: number) => {
  progress[i] = f;
  showLoading((progress[0] + progress[1]) / 2);
};
const [fleet, world] = await Promise.all([loadFleet(report(0)), loadWorld(report(1))]);
new Game(document.getElementById('app')!, fleet, world).run();
