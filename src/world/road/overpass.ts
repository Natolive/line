// Local roads crossing over the motorway on concrete bridges, from embankment to embankment.
import * as THREE from 'three';
import { GUARDRAIL_X, ROADSIDE } from '../../core/config.ts';
import { overpassesIn } from '../../rules/track.ts';
import { lampPost } from './bridges.ts';
import type { RoadPaints } from './paints.ts';
import { C, type Build } from './piece.ts';

const CLEAR = ROADSIDE.overpassClear, SPAN = 2 * (C + 8), WIDE = 10; // m under it, m long, m wide

export function overpasses(b: Build, p: RoadPaints) {
  for (const d of overpassesIn(b.d0, b.d1)) {
    const m = b.mesher(p.concrete), add = (geo: THREE.BufferGeometry, x = 0) => m.solid(geo, d, x, 0);
    add(new THREE.BoxGeometry(SPAN, 1.4, WIDE).translate(0, CLEAR + 0.7, 0));
    b.mesher(p.asphalt).solid(new THREE.BoxGeometry(SPAN, 0.04, WIDE - 1).translate(0, CLEAR + 1.42, 0), d, 0, 0);
    for (const s of [-1, 1]) {
      const edge = s * (WIDE / 2 - 0.15);
      add(new THREE.BoxGeometry(SPAN, 1, 0.3).translate(0, CLEAR + 1.9, edge)); // parapet
      add(new THREE.BoxGeometry(1.2, CLEAR, 7).translate(0, CLEAR / 2, 0), s * (GUARDRAIL_X + 1.8)); // pier in the verge
      add(new THREE.BoxGeometry(5, CLEAR + 2.4, 11).translate(0, (CLEAR + 1.4) / 2 - 0.5, 0), s * (C + 6)); // abutment
      add(new THREE.BoxGeometry(SPAN, 0.12, 0.12).translate(0, CLEAR + 2.9, edge)); // handrail on posts above the parapet
      for (let x = -SPAN / 2 + 1; x < SPAN / 2; x += 2) add(new THREE.BoxGeometry(0.1, 0.5, 0.1).translate(0, CLEAR + 2.62, edge), x);
      b.mesher(p.steel).solid(new THREE.BoxGeometry(SPAN, 0.6, 0.12).translate(0, CLEAR + 0.6, s * (WIDE / 2 + 0.05)), d, 0, 0); // coloured fascia
      lampPost(b.mesher(p.steel), b.mesher(p.streetLamp), d + s * 4.6, s * 10, CLEAR + 1.4, 0);
    }
  }
}
