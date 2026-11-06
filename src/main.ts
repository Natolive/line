import './ui/style.css';
import { Game } from './core/game.ts';
import { buildWorld } from './world/assets.ts';
import { buildFleet } from './world/vehicles/fleet.ts';

// Every car and prop is built from scratch in code: nothing to download.
new Game(document.getElementById('app')!, buildFleet(), buildWorld()).run();
