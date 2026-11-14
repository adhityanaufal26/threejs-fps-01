// world.js — the Foundry-7 depot: one original arena built from three.js
// geometry only. Lanes, corners and sightlines are deliberate: a top lane, a
// mid hall and a bottom lane, two bomb sites, crates and furnace blocks for
// cover. Collision is a flat list of axis-aligned boxes; the same list feeds
// movement, grenades and line-of-sight.
import * as THREE from 'three';

const SLATE = 0x2a2f36;
const FLOOR = 0x23272e;
const AMBER = 0xffb347;
const TEAL = 0x2f8f86;
const RUST = 0x8a4a2b;
const CRATE = 0x6b5a33;
const CRATE2 = 0x55606b;

export function buildWorld(scene) {
  const colliders = []; // {x0,z0,x1,z1,h}
  const solids = []; // meshes the raycaster treats as blocking
  const group = new THREE.Group();
  group.name = 'foundry7';

  const mat = (c, rough = 0.9, metal = 0.05) =>
    new THREE.MeshStandardMaterial({ color: c, roughness: rough, metalness: metal });
  const floorMat = new THREE.MeshStandardMaterial({ color: FLOOR, roughness: 0.95 });

  // --- lights: dusk through the roof vents, warm furnace glow east ---
  scene.background = new THREE.Color(0x0d1015);
  scene.fog = new THREE.Fog(0x0d1015, 34, 78);
  const hemi = new THREE.HemisphereLight(0x8fa3c7, 0x1a1410, 0.85);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xffd9a0, 1.5);
  sun.position.set(-18, 26, 10);
  scene.add(sun);
  const furnace = new THREE.PointLight(0xff7a2a, 60, 30, 1.8);
  furnace.position.set(19, 4, 0);
  scene.add(furnace);
  const lampA = new THREE.PointLight(0xffb347, 25, 16, 1.8);
  lampA.position.set(17, 5, -11);
  scene.add(lampA);
  const lampB = new THREE.PointLight(0x5fd3c8, 25, 16, 1.8);
  lampB.position.set(17, 5, 11);
  scene.add(lampB);

  // --- floor: dark plates with a painted mid stripe ---
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(50, 38), floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  group.add(floor);
  const stripe = new THREE.Mesh(
    new THREE.PlaneGeometry(50, 1.2),
    new THREE.MeshStandardMaterial({ color: 0x3a3f47, roughness: 0.9 }),
  );
  stripe.rotation.x = -Math.PI / 2;
  stripe.position.y = 0.01;
  group.add(stripe);

  function box(x, z, w, d, h, color, y0 = 0) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(color));
    m.position.set(x, y0 + h / 2, z);
    group.add(m);
    solids.push(m);
    colliders.push({ x0: x - w / 2, z0: z - d / 2, x1: x + w / 2, z1: z + d / 2, h: y0 + h });
    return m;
  }
  function crate(x, z, s, color = CRATE) {
    const m = box(x, z, s, s, s, color);
    const lid = new THREE.Mesh(
      new THREE.BoxGeometry(s + 0.06, 0.08, s + 0.06),
      mat(0x3d3423),
    );
    lid.position.set(x, s + 0.04, z);
    group.add(lid);
    return m;
  }
  function plate(x, z, w, d, color, y = 0.02) {
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(w, d),
      new THREE.MeshStandardMaterial({ color, roughness: 0.85 }),
    );
    m.rotation.x = -Math.PI / 2;
    m.position.set(x, y, z);
    group.add(m);
    return m;
  }

  // --- outer walls (leave the arena 48 x 36) ---
  box(0, -18.6, 50, 1.2, 5, SLATE);
  box(0, 18.6, 50, 1.2, 5, SLATE);
  box(-24.6, 0, 1.2, 38, 5, SLATE);
  box(24.6, 0, 1.2, 38, 5, SLATE);

  // --- central furnace block: splits mid into two lanes, tall cover ---
  box(-2, 0, 7, 5, 4.2, RUST);
  box(-2, 0, 7.4, 5.4, 0.5, 0x1c1f24, 4.2);
  // furnace chimney glow strip
  const glow = new THREE.Mesh(
    new THREE.BoxGeometry(0.3, 1.6, 4.6),
    new THREE.MeshStandardMaterial({ color: 0xff6a1a, emissive: 0xff5500, emissiveIntensity: 1.6 }),
  );
  glow.position.set(1.6, 2.2, 0);
  group.add(glow);

  // --- mid hall pillars ---
  box(-10, -5.5, 1.6, 1.6, 3.6, SLATE);
  box(-10, 5.5, 1.6, 1.6, 3.6, SLATE);
  box(7, -5.5, 1.6, 1.6, 3.6, SLATE);
  box(7, 5.5, 1.6, 1.6, 3.6, SLATE);

  // --- west (attacker) side: stacked crates form a covered approach ---
  crate(-18, -9, 2.2);
  crate(-18, -6.6, 1.6, CRATE2);
  crate(-15.5, -11, 1.8);
  crate(-18, 9, 2.2, CRATE2);
  crate(-15.5, 11, 1.8);
  crate(-13, 0, 2.4);
  // --- east (defender) side: low walls guarding both sites ---
  box(13, -11, 4.5, 1, 1.3, CRATE2);
  box(13, 11, 4.5, 1, 1.3, CRATE2);
  box(22.5, -4, 1, 5, 1.3, CRATE2);
  box(22.5, 4, 1, 5, 1.3, CRATE2);
  // --- scattered mid cover ---
  crate(-6, -12, 2.0);
  crate(-6, 12, 2.0, CRATE2);
  crate(3, -12.5, 1.6);
  crate(3, 12.5, 1.6, CRATE2);
  crate(9, -1.5, 1.8);
  crate(9, 1.5, 1.8, CRATE2);
  box(12, -7.5, 1, 4, 1.2, SLATE);
  box(12, 7.5, 1, 4, 1.2, SLATE);

  // --- site plates: A north-east (amber), B south-east (teal) ---
  plate(17, -11, 8, 8, 0x4a3410);
  plate(17, 11, 8, 8, 0x0f3a36);
  const ringA = new THREE.Mesh(
    new THREE.RingGeometry(3.4, 3.7, 40),
    new THREE.MeshBasicMaterial({ color: AMBER, side: THREE.DoubleSide }),
  );
  ringA.rotation.x = -Math.PI / 2;
  ringA.position.set(17, 0.03, -11);
  group.add(ringA);
  const ringB = ringA.clone();
  ringB.material = new THREE.MeshBasicMaterial({ color: TEAL, side: THREE.DoubleSide });
  ringB.position.set(17, 0.03, 11);
  group.add(ringB);
  // site marker poles
  for (const [sx, sz, col] of [[17, -11, AMBER], [17, 11, TEAL]]) {
    const pole = new THREE.Mesh(
      new THREE.CylinderGeometry(0.09, 0.09, 3.4, 8),
      new THREE.MeshStandardMaterial({ color: col, emissive: col, emissiveIntensity: 0.7 }),
    );
    pole.position.set(sx + 3.6, 1.7, sz + 3.6);
    group.add(pole);
  }

  // --- overhead gantries: visual depth, no collision (above head height) ---
  for (const gz of [-8, 8]) {
    const beam = new THREE.Mesh(new THREE.BoxGeometry(30, 0.5, 0.8), mat(0x1c2026));
    beam.position.set(0, 5.4, gz);
    group.add(beam);
  }

  scene.add(group);

  const sites = {
    A: { name: 'A', pos: new THREE.Vector3(17, 0, -11), radius: 3.6, color: AMBER },
    B: { name: 'B', pos: new THREE.Vector3(17, 0, 11), radius: 3.6, color: TEAL },
  };
  const spawns = {
    us: [new THREE.Vector3(-21, 0, -3), new THREE.Vector3(-21, 0, 0), new THREE.Vector3(-21, 0, 3)],
    them: [
      new THREE.Vector3(21, 0, -8),
      new THREE.Vector3(21, 0, -2),
      new THREE.Vector3(21, 0, 4),
      new THREE.Vector3(21, 0, 10),
    ],
  };

  // Waypoint graph: junctions bots route through. Edges are symmetric.
  const waypoints = [
    { x: -21, z: 0 },   // 0 attacker spawn
    { x: -16, z: -8 },  // 1 top approach
    { x: -16, z: 8 },   // 2 bottom approach
    { x: -11, z: 0 },   // 3 mid west
    { x: -6, z: -14 },  // 4 top lane west
    { x: -6, z: 14 },   // 5 bottom lane west
    { x: 2, z: -8 },    // 6 mid north
    { x: 2, z: 8 },     // 7 mid south
    { x: 9, z: -14 },   // 8 top lane east
    { x: 9, z: 14 },    // 9 bottom lane east
    { x: 13, z: -7 },   // 10 A approach
    { x: 13, z: 7 },    // 11 B approach
    { x: 17, z: -11 },  // 12 site A
    { x: 17, z: 11 },   // 13 site B
    { x: 21, z: 0 },    // 14 defender spawn
    { x: 2, z: 0 },     // 15 mid (blocked by furnace, kept as a pass-through marker)
  ];
  const edges = {
    0: [1, 2, 3], 1: [0, 4, 3], 2: [0, 5, 3], 3: [0, 1, 2, 6, 7],
    4: [1, 8], 5: [2, 9], 6: [3, 8, 10], 7: [3, 9, 11],
    8: [4, 6, 10], 9: [5, 7, 11], 10: [6, 8, 12, 14], 11: [7, 9, 13, 14],
    12: [10], 13: [11], 14: [10, 11], 15: [],
  };

  return { colliders, solids, sites, spawns, waypoints, edges, group };
}

// Breadth-first route over the waypoint graph; returns node indices.
export function findRoute(edges, from, to) {
  if (from === to) return [to];
  const prev = new Map([[from, -1]]);
  const queue = [from];
  while (queue.length) {
    const n = queue.shift();
    for (const m of edges[n] ?? []) {
      if (prev.has(m)) continue;
      prev.set(m, n);
      if (m === to) {
        const path = [to];
        let cur = to;
        while (prev.get(cur) !== -1) { cur = prev.get(cur); path.unshift(cur); }
        return path;
      }
      queue.push(m);
    }
  }
  return [to];
}

export function nearestWaypoint(waypoints, x, z) {
  let best = 0;
  let bd = Infinity;
  for (let i = 0; i < waypoints.length; i++) {
    const dx = waypoints[i].x - x;
    const dz = waypoints[i].z - z;
    const d = dx * dx + dz * dz;
    if (d < bd) { bd = d; best = i; }
  }
  return best;
}

// Point-in-collider test for a circle of radius r at (x, z).
export function blockedAt(colliders, x, z, r) {
  for (const c of colliders) {
    if (c.h < 0.4) continue;
    const cx = Math.max(c.x0, Math.min(x, c.x1));
    const cz = Math.max(c.z0, Math.min(z, c.z1));
    const dx = x - cx;
    const dz = z - cz;
    if (dx * dx + dz * dz < r * r) return c;
  }
  return null;
}
