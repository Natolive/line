// Downloads every asset the game uses and writes public/models/CREDITS.md.
//  - Sketchfab models (CC-BY) → public/models/   needs SKETCHFAB_TOKEN in .env.local (sketchfab.com/settings/password → API token)
//  - Poly Haven skies and textures (CC0) → public/sky/, public/textures/   no account needed
// Run: node scripts/fetch-assets.mjs  (files already present are skipped; delete one to re-fetch it)
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';

// name → Sketchfab id, or [id, simplify ratio] for models too heavy for a browser
const MODELS = {
  'car-bmw': ['b53782a00cc240a191d5d7d005af1423', 0.15], // BMW M4 CSL (~1M triangles at full detail)
  'car-lambo': ['5884f95259ff411c95510cdde5ede33e', 0.5], // Lamborghini Veneno (~330k triangles)
  'car-porsche': ['78d5c47ab2554c2592b7e499179a0792', 0.5], // Porsche 911 GT3 (~240k triangles)
  'car-gtr': ['7b142ea3376e4811a326256c59bbc7a2', 0.5], // Nissan GT-R R35 (~280k triangles)
  'car-mustang': ['0eaa7a16796540f29461ddae05ecdeb3', 0.4], // Ford Mustang Shelby GT500 (~350k triangles)
  'car-f40': ['52a66c41cfcd4f999fb1b1c49bf24d70', 0.5], // Ferrari F40 (~245k triangles)
  traffic: '20f9af9b8a404d5cb022ac6fe87f21f5', // Generic passenger car pack
  van: '09d718c9cf72401b8534d265a06a803f', // Shvan '92
  truck: '3e8c5275aeab487fa37d227ce0bd1a9a', // Semi Truck Baked
  city: 'e0209ac5bb684d2d85e5ade96c92d2ff', // Low-poly City Buildings
  'city-night': 'b0035b8713b048bb8ddf311ee67c28c8', // Low Poly Night City Building Skyline
  trees: '5ff5a51e74324845a4e4905f182dfb2b', // Low Poly Forest Tree Pack
};

// Poly Haven (CC0): HDRI skies, one per theme, and PBR textures.
const SKIES = ['kloofendal_48d_partly_cloudy_puresky', 'belfast_sunset_puresky', 'kloppenheim_02_puresky'];
const TEXTURES = ['asphalt_02', 'aerial_grass_rock', 'concrete_floor_worn_001'];
const OUT = 'public/models';

const env = existsSync('.env.local') ? readFileSync('.env.local', 'utf8') : '';
const token = process.env.SKETCHFAB_TOKEN ?? env.match(/^SKETCHFAB_TOKEN=(.+)$/m)?.[1]?.trim();
if (!token) throw new Error('Missing SKETCHFAB_TOKEN: add it to .env.local');

const api = async (path, auth = false) => {
  const res = await fetch(`https://api.sketchfab.com/v3${path}`, { headers: auth ? { Authorization: `Token ${token}` } : {} });
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
  return res.json();
};

mkdirSync(OUT, { recursive: true });
const credits = ['# Model credits', '', 'All models from Sketchfab, used under their listed licenses.', ''];
for (const [name, entry] of Object.entries(MODELS)) {
  const [uid, ratio] = Array.isArray(entry) ? entry : [entry, 0];
  const info = await api(`/models/${uid}`);
  credits.push(`- **${name}**: "${info.name}" by ${info.user.displayName} (${info.user.profileUrl}), ${info.license.label}, ${info.viewerUrl}`);
  if (existsSync(`${OUT}/${name}.glb`) || existsSync(`${OUT}/${name}/scene.gltf`)) { console.log(`skip ${name} (already here)`); continue; }

  const dl = await api(`/models/${uid}/download`, true);
  if (dl.glb) {
    writeFileSync(`${OUT}/${name}.glb`, Buffer.from(await (await fetch(dl.glb.url)).arrayBuffer()));
    // compress ~10x for the web; keep node names, the game finds wheels by name
    execFileSync('node_modules/.bin/gltf-transform', ['optimize', `${OUT}/${name}.glb`, `${OUT}/${name}.glb`,
      '--compress', 'meshopt', '--texture-compress', 'webp', '--texture-size', '1024',
      '--join', 'false', '--flatten', 'false', '--instance', 'false', '--palette', 'false',
      ...(ratio ? ['--simplify', 'true', '--simplify-ratio', String(ratio), '--simplify-error', '0.001'] : ['--simplify', 'false'])]);
    console.log(`${name}.glb  ${(dl.glb.size / 1e6).toFixed(1)} MB downloaded, compressed`);
  } else {
    const zip = `${OUT}/${name}.zip`;
    writeFileSync(zip, Buffer.from(await (await fetch(dl.gltf.url)).arrayBuffer()));
    rmSync(`${OUT}/${name}`, { recursive: true, force: true });
    execFileSync('unzip', ['-q', zip, '-d', `${OUT}/${name}`]);
    rmSync(zip);
    console.log(`${name}/scene.gltf  ${(dl.gltf.size / 1e6).toFixed(1)} MB`);
  }
}
const download = async (url, file) => {
  if (existsSync(file)) return console.log(`skip ${file} (already here)`);
  writeFileSync(file, Buffer.from(await (await fetch(url)).arrayBuffer()));
  console.log(file);
};
mkdirSync('public/sky', { recursive: true });
mkdirSync('public/textures', { recursive: true });
for (const id of SKIES) {
  const files = await (await fetch(`https://api.polyhaven.com/files/${id}`)).json();
  await download(files.hdri['2k'].hdr.url, `public/sky/${id}.hdr`);
}
for (const id of TEXTURES) {
  const files = await (await fetch(`https://api.polyhaven.com/files/${id}`)).json();
  for (const [map, key] of [['color', 'Diffuse'], ['normal', 'nor_gl'], ['rough', 'Rough']]) {
    await download(files[key]['1k'].jpg.url, `public/textures/${id}_${map}.jpg`);
  }
}
credits.push('', 'Skies and textures from Poly Haven (https://polyhaven.com), CC0: ' + [...SKIES, ...TEXTURES].join(', ') + '.');

writeFileSync(`${OUT}/CREDITS.md`, credits.join('\n') + '\n');
console.log(`credits → ${OUT}/CREDITS.md`);
