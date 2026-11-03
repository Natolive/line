import { defineConfig } from 'vite';

// Without Docker/Traefik, `npm run dev` + `npm run server`: the game reaches the multiplayer server through /ws.
export default defineConfig({
  server: { proxy: { '/ws': { target: 'ws://localhost:8080', ws: true } } },
});
