// main.js — EMBERLINE bootstrap and game loop. Wires the modules together:
// fixed-step simulation (60 Hz) kept apart from rendering, hitscan gunplay
// with headshots and recoil, the bomb objective, the buy phase, and the
// round/match flow. Shot modes (?shot=start|play|buy|end) stage the game for
// screenshots without pointer lock.
import * as THREE from 'three';
import { buildWorld } from './world.js';
import { createState, PHASE, MATCH } from './state.js';
import { createPlayer, stepPlayer, applyCamera, cameraDir, eyeHeight } from './player.js';
import { WEAPONS, GRENADE, createLoadout, buyWeapon, buyGrenade, currentSpread, damageAtRange, createGrenade } from './weapons.js';
import { createBot, placeBot, stepBot, botTakeDamage } from './bots.js';
import { createAudio } from './audio.js';
import { createHud } from './hud.js';

const STEP = 1 / 60;
const params = new URLSearchParams(location.search);
const SHOT = params.get('shot'); // start | play | buy | end | null

const state = createState();
const audio = createAudio();
const hud = createHud();
const loadout = createLoadout();
const player = createPlayer();

// --- renderer / scene ---
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
document.getElementById('app').appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(75, innerWidth / innerHeight, 0.08, 200);
const world = buildWorld(scene);
const ray = new THREE.Raycaster();
ray.far = 120;

// --- viewmodel: a low-poly gun in the player's hands ---
const gunGroup = new THREE.Group();
{
  const dark = new THREE.MeshStandardMaterial({ color: 0x22262c, roughness: 0.55, metalness: 0.4 });
  const accent = new THREE.MeshStandardMaterial({ color: 0xffb347, roughness: 0.5, metalness: 0.3 });
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.13, 0.52), dark);
  const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.3), dark);
  barrel.position.set(0, 0.03, -0.38);
  const grip = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.18, 0.1), dark);
  grip.position.set(0, -0.13, 0.16);
  grip.rotation.x = 0.35;
  const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.095, 0.02, 0.3), accent);
  stripe.position.set(0, 0.075, -0.08);
  gunGroup.add(body, barrel, grip, stripe);
  gunGroup.scale.setScalar(0.8);
  gunGroup.position.set(0.3, -0.27, -0.55);
  camera.add(gunGroup);
  scene.add(camera);
}
let gunKick = 0;
let gunDip = 0; // reload dip

// --- bomb charge mesh (hidden until planted) ---
const bombMesh = new THREE.Group();
{
  const box = new THREE.Mesh(
    new THREE.BoxGeometry(0.55, 0.28, 0.4),
    new THREE.MeshStandardMaterial({ color: 0x1a1d22, roughness: 0.6 }),
  );
  const lamp = new THREE.Mesh(
    new THREE.SphereGeometry(0.07, 10, 8),
    new THREE.MeshBasicMaterial({ color: 0xff2222 }),
  );
  lamp.position.set(0.2, 0.18, 0);
  lamp.name = 'lamp';
  bombMesh.add(box, lamp);
  bombMesh.visible = false;
  scene.add(bombMesh);
}

// --- tracers and impact flashes (pooled: no allocation in hot loops) ---
const tracers = [];
for (let i = 0; i < 24; i++) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
  const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0xffd34d, transparent: true, opacity: 0 }));
  line.visible = false;
  line.frustumCulled = false;
  scene.add(line);
  tracers.push({ line, life: 0 });
}
let tracerIdx = 0;
const flashes = [];
for (let i = 0; i < 8; i++) {
  const m = new THREE.Mesh(
    new THREE.SphereGeometry(0.09, 8, 6),
    new THREE.MeshBasicMaterial({ color: 0xffe08a, transparent: true, opacity: 0 }),
  );
  m.visible = false;
  scene.add(m);
  flashes.push({ mesh: m, life: 0 });
}
let flashIdx = 0;
const explosionLight = new THREE.PointLight(0xff8833, 0, 22, 1.6);
scene.add(explosionLight);

function spawnTracer(from, to) {
  const t = tracers[tracerIdx];
  tracerIdx = (tracerIdx + 1) % tracers.length;
  const pos = t.line.geometry.attributes.position;
  pos.setXYZ(0, from.x, from.y, from.z);
  pos.setXYZ(1, to.x, to.y, to.z);
  pos.needsUpdate = true;
  t.line.material.opacity = 0.95;
  t.line.visible = true;
  t.life = 0.09;
}
function spawnFlash(at) {
  const f = flashes[flashIdx];
  flashIdx = (flashIdx + 1) % flashes.length;
  f.mesh.position.copy(at);
  f.mesh.material.opacity = 0.95;
  f.mesh.visible = true;
  f.life = 0.07;
}

// --- bots ---
const enemies = [];
const allies = [];
for (let i = 0; i < 4; i++) enemies.push(createBot(scene, 'them', i, 0.3));
for (let i = 0; i < 2; i++) allies.push(createBot(scene, 'us', i, 0.3));
const allBots = [...enemies, ...allies];

// --- input ---
const input = { f: false, b: false, l: false, r: false, fire: false, quiet: false };
let firingEdge = false;
let fireTimer = 0;
let reloadTimer = 0;
let heat = 0;
let zoomed = false;
let shakeTime = 0;
let shakeMag = 0;
let spectate = null;
const noises = []; // {pos, radius, time}
const grenades = [];
const keys = {};

addEventListener('keydown', (e) => {
  if (e.repeat) return;
  keys[e.code] = true;
  if (e.code === 'KeyW') input.f = true;
  if (e.code === 'KeyS') input.b = true;
  if (e.code === 'KeyA') input.l = true;
  if (e.code === 'KeyD') input.r = true;
  if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') input.quiet = true;
  if (e.code === 'KeyC' || e.code === 'ControlLeft') player.crouched = !player.crouched;
  if (e.code === 'KeyR') startReload();
  if (e.code === 'KeyG') throwGrenade();
  if (e.code === 'KeyB') toggleBuy();
  if (e.code.startsWith('Digit')) {
    const n = e.code.slice(5);
    if (n === '5' && state.phase === PHASE.BUY) { tryBuyOrSwitch('grenade'); return; }
    const w = Object.values(WEAPONS).find((x) => x.key === n);
    if (w) tryBuyOrSwitch(w.id);
  }
});
addEventListener('keyup', (e) => {
  keys[e.code] = false;
  if (e.code === 'KeyW') input.f = false;
  if (e.code === 'KeyS') input.b = false;
  if (e.code === 'KeyA') input.l = false;
  if (e.code === 'KeyD') input.r = false;
  if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') input.quiet = false;
});
addEventListener('mousedown', (e) => {
  if (e.button === 0) { input.fire = true; firingEdge = true; }
  if (e.button === 2) zoomed = true;
});
addEventListener('mouseup', (e) => {
  if (e.button === 0) input.fire = false;
  if (e.button === 2) zoomed = false;
});
addEventListener('contextmenu', (e) => e.preventDefault());
addEventListener('mousemove', (e) => {
  if (document.pointerLockElement !== renderer.domElement) return;
  if (state.phase !== PHASE.ROUND || !player.alive) return;
  player.yaw -= e.movementX * 0.0021;
  player.pitch -= e.movementY * 0.0021;
  player.pitch = Math.max(-1.45, Math.min(1.45, player.pitch));
});
addEventListener('wheel', () => {
  if (state.phase !== PHASE.ROUND) return;
  const owned = Object.values(WEAPONS).filter((w) => loadout.owned[w.id]);
  const i = owned.findIndex((w) => w.id === loadout.current);
  loadout.current = owned[(i + 1) % owned.length].id;
  cancelReload();
});
renderer.domElement.addEventListener('click', () => {
  audio.unlock();
  if (state.phase === PHASE.ROUND && player.alive && !SHOT) {
    renderer.domElement.requestPointerLock();
  }
});
document.addEventListener('pointerlockchange', () => {
  if (document.pointerLockElement !== renderer.domElement && state.phase === PHASE.ROUND && player.alive && !SHOT) {
    hud.hint('Click the game to capture the mouse');
  } else if (state.phase === PHASE.ROUND) {
    hud.hint('');
  }
});
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

// --- buttons ---
document.getElementById('deployBtn').addEventListener('click', () => {
  audio.unlock();
  startMatch();
});
document.getElementById('buyDoneBtn').addEventListener('click', () => startRound());
document.getElementById('buySkipBtn').addEventListener('click', () => startRound());
document.getElementById('nextRoundBtn').addEventListener('click', () => {
  if (state.matchOver) return showMatchEnd();
  startBuyPhase();
});
document.getElementById('againBtn').addEventListener('click', () => startMatch());

// --- weapons ------------------------------------------------------------
function tryBuyOrSwitch(id) {
  if (state.phase === PHASE.BUY) {
    if (id === 'grenade') {
      const res = buyGrenade(loadout, state.money);
      if (res.ok) {
        state.money = res.money;
        audio.buy();
        hud.renderShop(loadout, state.money, tryBuyOrSwitch);
      }
      return;
    }
    if (!loadout.owned[id]) {
      const res = buyWeapon(loadout, state.money, id);
      if (res.ok) {
        state.money = res.money;
        audio.buy();
        hud.renderShop(loadout, state.money, tryBuyOrSwitch);
        loadout.current = id;
      }
      return;
    }
  }
  if (loadout.owned[id] && state.phase === PHASE.ROUND) {
    loadout.current = id;
    cancelReload();
  }
}

function toggleBuy() {
  if (state.phase === PHASE.BUY) startRound();
}

function startReload() {
  if (state.phase !== PHASE.ROUND || !player.alive) return;
  const w = WEAPONS[loadout.current];
  const a = loadout.ammo[loadout.current];
  if (!a || reloadTimer > 0 || a.mag >= w.mag || a.reserve <= 0) return;
  reloadTimer = w.reloadSec;
  gunDip = 1;
  audio.reload();
}

function cancelReload() { reloadTimer = 0; gunDip = 0; }

function throwGrenade() {
  if (state.phase !== PHASE.ROUND || !player.alive || loadout.nades <= 0) return;
  loadout.nades -= 1;
  const dir = cameraDir(player);
  grenades.push(createGrenade(
    new THREE.Vector3(player.pos.x, eyeHeight(player) - 0.1, player.pos.z),
    dir, 'us',
  ));
  audio.grenadeThrow();
  noises.push({ pos: player.pos.clone(), radius: 20, time: state.time });
}

function fireWeapon() {
  const w = WEAPONS[loadout.current];
  const a = loadout.ammo[loadout.current];
  if (!a) return;
  if (reloadTimer > 0) return;
  if (a.mag <= 0) { audio.dryClick(); startReload(); return; }
  a.mag -= 1;
  state.shotsFired += 1;
  fireTimer = 60 / w.rpm;
  heat = Math.min(1, heat + 0.14);
  player.recoil = Math.min(0.12, player.recoil + w.recoil);
  player.yaw += (Math.random() - 0.5) * w.recoil * 0.25;
  gunKick = 1;
  audio.shot(w.kind);

  const eye = new THREE.Vector3(player.pos.x, eyeHeight(player), player.pos.z);
  const spread = currentSpread(w, player.speed2d, player.crouched, !player.moving, heat) * (zoomed ? 0.55 : 1);
  const muzzle = eye.clone().add(cameraDir(player).multiplyScalar(0.6));
  muzzle.y -= 0.12;
  let anyHit = false;
  for (let p = 0; p < w.pellets; p++) {
    const dir = cameraDir(player);
    dir.x += (Math.random() - 0.5) * 2 * spread;
    dir.y += (Math.random() - 0.5) * 2 * spread;
    dir.z += (Math.random() - 0.5) * 2 * spread;
    dir.normalize();
    const hit = hitscan(eye, dir, w.range, 'us');
    spawnTracer(muzzle, hit.point);
    if (hit.bot) {
      anyHit = true;
      const dmg = damageAtRange(w, hit.dist, hit.head);
      const died = botTakeDamage(hit.bot, dmg);
      state.shotsHit += 1;
      if (hit.head) state.headshots += 1;
      hud.hitmarker(died);
      if (died) onKill(hit.bot, 'player', hit.head);
      else audio.hit();
      spawnFlash(hit.point);
    } else if (hit.world) {
      spawnFlash(hit.point);
    }
  }
  if (anyHit) noises.push({ pos: player.pos.clone(), radius: 30, time: state.time });
  else noises.push({ pos: player.pos.clone(), radius: 22, time: state.time });
  if (a.mag === 0) startReload();
}

// Raycast against the world and every living bot. Returns the nearest hit.
function hitscan(origin, dir, maxDist, shooterTeam) {
  ray.set(origin, dir);
  ray.far = maxDist;
  const worldHits = ray.intersectObjects(world.solids, false);
  const worldDist = worldHits.length ? worldHits[0].distance : Infinity;
  let best = null;
  for (const b of allBots) {
    if (!b.alive || b.team === shooterTeam) continue;
    const headHits = ray.intersectObject(b.head, false);
    const bodyHits = ray.intersectObject(b.body, false);
    const h = headHits.length ? { dist: headHits[0].distance, head: true, point: headHits[0].point } : null;
    const bd = bodyHits.length ? { dist: bodyHits[0].distance, head: false, point: bodyHits[0].point } : null;
    const pick = h && (!bd || h.dist < bd.dist) ? h : bd;
    if (pick && pick.dist < worldDist && (!best || pick.dist < best.dist)) {
      best = { ...pick, bot: b };
    }
  }
  if (best) return { point: best.point, dist: best.dist, bot: best.bot, head: best.head, world: false };
  if (worldHits.length) return { point: worldHits[0].point, dist: worldHits[0].distance, bot: null, head: false, world: true };
  return { point: origin.clone().add(dir.clone().multiplyScalar(maxDist)), dist: maxDist, bot: null, head: false, world: false };
}

// --- bots shooting ------------------------------------------------------
const botCtx = {
  get time() { return state.time; },
  get state() { return state; },
  get world() { return world; },
  get player() { return player; },
  get ray() { return ray; },
  get enemies() { return enemies; },
  get allies() { return allies; },
  get noises() { return noises; },
  botShoot(bot, targetPoint, dist) {
    const eye = new THREE.Vector3(bot.pos.x, 1.5, bot.pos.z);
    const toTarget = new THREE.Vector3().subVectors(targetPoint, eye);
    const len = toTarget.length();
    toTarget.normalize();
    // error grows with distance and target speed, shrinks with skill
    const targetSpeed = bot.target === 'player' ? player.speed2d : 2;
    const err = (0.028 + dist * 0.0011 + targetSpeed * 0.004) * (1.25 - bot.skill * 0.45);
    toTarget.x += (Math.random() - 0.5) * 2 * err;
    toTarget.y += (Math.random() - 0.5) * 2 * err;
    toTarget.z += (Math.random() - 0.5) * 2 * err;
    toTarget.normalize();
    const muzzle = eye.clone().add(toTarget.clone().multiplyScalar(0.5));
    // resolve against the player first, then allied bots, then the world
    ray.set(eye, toTarget);
    ray.far = 70;
    const worldHits = ray.intersectObjects(world.solids, false);
    const worldDist = worldHits.length ? worldHits[0].distance : Infinity;
    let end = worldHits.length ? worldHits[0].point : eye.clone().add(toTarget.clone().multiplyScalar(70));
    if (bot.target === 'player' && player.alive) {
      const d = eye.distanceTo(new THREE.Vector3(player.pos.x, 1.4, player.pos.z));
      const hitChance = Math.max(0, 1 - (len * err * 2.2));
      if (d < worldDist && Math.random() < 0.35 + hitChance * 0.5) {
        const dmg = Math.max(6, 15 - dist * 0.09) * (0.85 + Math.random() * 0.3);
        damagePlayer(dmg, bot);
        end = new THREE.Vector3(player.pos.x, 1.4, player.pos.z);
      }
    } else if (bot.target && bot.target !== 'player') {
      const t = bot.target;
      if (t.alive) {
        const d = eye.distanceTo(t.pos);
        if (d < worldDist && Math.random() < 0.55) {
          const dmg = Math.max(6, 14 - dist * 0.08);
          if (botTakeDamage(t, dmg)) onKill(t, bot, false);
          end = new THREE.Vector3(t.pos.x, 1.3, t.pos.z);
        }
      }
    }
    spawnTracer(muzzle, end);
    if (bot.pos.distanceTo(player.pos) < 26) audio.distantShot();
  },
  onDefused(bot) {
    endRound('them', `FROST defused the charge — ${bot.name} cut the wires in time.`);
  },
};

function damagePlayer(dmg, fromBot) {
  if (!player.alive || state.phase !== PHASE.ROUND) return;
  player.health -= dmg;
  hud.damageFlash();
  audio.hurt();
  if (player.health <= 0) {
    player.health = 0;
    player.alive = false;
    state.deaths += 1;
    document.exitPointerLock?.();
    hud.banner('YOU ARE DOWN', fromBot ? `Taken out by ${fromBot.name} — spectating ${firstAlly()?.name ?? 'no one'}.` : '');
    hud.killfeed(`<span class="teal">${fromBot ? fromBot.name : 'FROST'}</span> ▸ <span class="amber">YOU</span>`);
    spectate = firstAlly();
    checkRoundEnd();
  }
}

function firstAlly() {
  return allies.find((a) => a.alive) ?? null;
}

function onKill(bot, killer, head) {
  const killerName = killer === 'player' ? 'YOU' : killer.name;
  const killerCls = killer === 'player' || (killer !== 'player' && killer.team === 'us') ? 'amber' : 'teal';
  const victimCls = bot.team === 'us' ? 'amber' : 'teal';
  hud.killfeed(`<span class="${killerCls}">${killerName}</span> ▸ <span class="${victimCls}">${bot.name}</span>${head ? ' ☠ HEADSHOT' : ''}`);
  if (killer === 'player') {
    state.kills += 1;
    state.money += MATCH.KILL_REWARD;
    audio.kill();
  }
  checkRoundEnd();
}

function checkRoundEnd() {
  if (state.phase !== PHASE.ROUND) return;
  if (state.bombPlanted) return; // bomb decides from here
  const enemiesAlive = enemies.some((b) => b.alive);
  const usAlive = player.alive || allies.some((b) => b.alive);
  if (!enemiesAlive) endRound('us', 'FROST squad eliminated.');
  else if (!usAlive) endRound('them', 'EMBER squad eliminated.');
}

// --- grenades -----------------------------------------------------------
function stepGrenades(dt) {
  for (const g of grenades) {
    if (!g.alive) continue;
    g.vel.y -= 9.8 * dt;
    const nx = g.pos.x + g.vel.x * dt;
    const ny = g.pos.y + g.vel.y * dt;
    const nz = g.pos.z + g.vel.z * dt;
    if (ny <= 0.05) {
      g.pos.y = 0.05;
      g.vel.y = Math.abs(g.vel.y) > 1.2 ? -g.vel.y * 0.4 : 0;
      g.vel.x *= 0.7;
      g.vel.z *= 0.7;
    } else {
      g.pos.x = nx; g.pos.y = ny; g.pos.z = nz;
    }
    g.fuse -= dt;
    if (g.fuse <= 0) {
      g.alive = false;
      explodeGrenade(g);
    }
  }
}

function explodeGrenade(g) {
  audio.explosion();
  explosionLight.position.set(g.pos.x, 1.2, g.pos.z);
  explosionLight.intensity = 260;
  setTimeout(() => { explosionLight.intensity = 0; }, 120);
  const dPlayer = player.pos.distanceTo(g.pos);
  if (player.alive && dPlayer < GRENADE.radius) {
    shakeTime = 0.35;
    shakeMag = 0.12;
    damagePlayer(GRENADE.damage * (1 - dPlayer / GRENADE.radius) + 15, null);
  }
  for (const b of allBots) {
    if (!b.alive) continue;
    const d = b.pos.distanceTo(g.pos);
    if (d < GRENADE.radius) {
      const dmg = GRENADE.damage * (1 - d / GRENADE.radius) + 10;
      if (botTakeDamage(b, dmg)) onKill(b, g.team === 'us' ? 'player' : enemies[0], false);
    }
  }
  noises.push({ pos: g.pos.clone(), radius: 34, time: state.time });
}

// --- bomb ---------------------------------------------------------------
function nearestSite(pos) {
  for (const s of Object.values(world.sites)) {
    if (pos.distanceTo(s.pos) < s.radius) return s;
  }
  return null;
}

function stepPlant(dt) {
  const site = nearestSite(player.pos);
  const planting = player.alive && !state.bombPlanted && site && keys.KeyE;
  if (planting) {
    state.plantProgress += dt / MATCH.PLANT_SECONDS;
    hud.setPlant(Math.min(1, state.plantProgress), `PLANTING AT SITE ${site.name}…`);
    if (Math.random() < dt * 6) audio.plantTick();
    if (state.plantProgress >= 1) {
      state.bombPlanted = true;
      state.bombSite = site.name;
      state.bombTimer = MATCH.BOMB_FUSE_SECONDS;
      state.bombPlantedBy = 'player';
      state.money += MATCH.PLANT_REWARD;
      bombMesh.position.set(site.pos.x, 0.16, site.pos.z);
      bombMesh.visible = true;
      hud.setPlant(null);
      hud.banner('CHARGE PLANTED', `Site ${site.name} — ${MATCH.BOMB_FUSE_SECONDS}s to detonation. Defend it.`);
      hud.killfeed(`<span class="amber">YOU</span> planted the charge at SITE ${site.name} (+$${MATCH.PLANT_REWARD})`);
      audio.plantDone();
      noises.push({ pos: site.pos.clone(), radius: 40, time: state.time });
    }
  } else {
    if (state.plantProgress > 0) state.plantProgress = Math.max(0, state.plantProgress - dt * 2);
    if (state.plantProgress > 0) hud.setPlant(state.plantProgress, 'PLANTING…');
    else hud.setPlant(null);
  }
}

// --- round / match flow ---------------------------------------------------
function resetPositions() {
  player.pos.copy(world.spawns.us[0]);
  player.yaw = -Math.PI / 2;
  player.pitch = 0;
  player.recoil = 0;
  player.vel.set(0, 0, 0);
  player.health = 100;
  player.alive = true;
  player.crouched = false;
  spectate = null;
  const skill = Math.min(1, 0.3 + state.round * 0.09);
  enemies.forEach((b, i) => {
    b.skill = skill;
    placeBot(b, world.spawns.them[i].x, world.spawns.them[i].z, Math.PI / 2);
  });
  allies.forEach((b, i) => {
    b.skill = Math.max(0.3, skill - 0.15);
    placeBot(b, world.spawns.us[i + 1].x, world.spawns.us[i + 1].z, -Math.PI / 2);
  });
  for (const id of Object.keys(loadout.ammo)) {
    const w = WEAPONS[id];
    loadout.ammo[id] = { mag: w.mag, reserve: w.reserve };
  }
  grenades.length = 0;
  noises.length = 0;
  bombMesh.visible = false;
  fireTimer = 0;
  reloadTimer = 0;
  heat = 0;
}

function startMatch() {
  state.round = 1;
  state.scoreUs = 0;
  state.scoreThem = 0;
  state.money = MATCH.START_MONEY;
  state.kills = 0;
  state.deaths = 0;
  state.shotsFired = 0;
  state.shotsHit = 0;
  state.headshots = 0;
  state.matchOver = false;
  loadout.owned = { pistol: true };
  loadout.ammo = { pistol: { mag: 12, reserve: 36 } };
  loadout.nades = 0;
  loadout.current = 'pistol';
  hud.clearFeed();
  hud.hide('menu');
  hud.hide('matchEnd');
  hud.hide('roundEnd');
  hud.show('hud');
  startBuyPhase();
}

function startBuyPhase() {
  state.phase = PHASE.BUY;
  state.resetRound();
  state.buyTime = MATCH.BUY_SECONDS;
  resetPositions();
  hud.renderShop(loadout, state.money, tryBuyOrSwitch);
  document.getElementById('buyRound').textContent = state.round;
  hud.show('buy');
  hud.hide('roundEnd');
  document.exitPointerLock?.();
}

function startRound() {
  hud.hide('buy');
  state.phase = PHASE.ROUND;
  state.roundTime = MATCH.ROUND_SECONDS;
  audio.roundStart();
  hud.banner(`ROUND ${state.round}`, state.round === 1 ? 'Plant at A or B — or wipe FROST out.' : '');
  if (!SHOT) renderer.domElement.requestPointerLock();
}

function endRound(winner, reason) {
  if (state.phase !== PHASE.ROUND) return;
  state.phase = PHASE.ROUND_END;
  state.roundWinner = winner;
  state.roundReason = reason;
  const won = winner === 'us';
  if (won) { state.scoreUs += 1; state.money += MATCH.WIN_REWARD; }
  else { state.scoreThem += 1; state.money += MATCH.LOSS_REWARD; }
  document.exitPointerLock?.();
  if (won) audio.roundWin(); else audio.roundLose();
  document.getElementById('roundEndTitle').textContent = won ? 'ROUND WON' : 'ROUND LOST';
  document.getElementById('roundEndTitle').style.color = won ? '#7fd08a' : '#ff5544';
  document.getElementById('roundEndText').textContent = reason;
  document.getElementById('reScoreUs').textContent = state.scoreUs;
  document.getElementById('reScoreThem').textContent = state.scoreThem;
  document.getElementById('roundEndMoney').textContent =
    `Round ${won ? 'win' : 'loss'} pay: $${(won ? MATCH.WIN_REWARD : MATCH.LOSS_REWARD).toLocaleString('en-US')} — balance $${state.money.toLocaleString('en-US')}`;
  hud.show('roundEnd');
  if (state.scoreUs >= MATCH.ROUNDS_TO_WIN || state.scoreThem >= MATCH.ROUNDS_TO_WIN || state.round >= MATCH.MAX_ROUNDS) {
    state.matchOver = true;
  }
}

function showMatchEnd() {
  state.phase = PHASE.MATCH_END;
  hud.hide('roundEnd');
  const won = state.scoreUs > state.scoreThem;
  document.getElementById('matchTitle').textContent = won ? 'EMBER TAKES FOUNDRY-7' : 'FROST HOLDS FOUNDRY-7';
  const acc = state.shotsFired ? Math.round((state.shotsHit / state.shotsFired) * 100) : 0;
  document.getElementById('matchText').textContent =
    `Final score EMBER ${state.scoreUs} — ${state.scoreThem} FROST. ` +
    `You: ${state.kills} eliminations, ${state.headshots} headshots, ${acc}% accuracy.`;
  hud.show('matchEnd');
}

// --- fixed-step simulation ----------------------------------------------
function sim(dt) {
  state.time += dt;
  heat = Math.max(0, heat - dt * 0.55);
  fireTimer = Math.max(0, fireTimer - dt);
  gunKick = Math.max(0, gunKick - dt * 7);
  gunDip = Math.max(0, gunDip - dt * 1.8);
  if (shakeTime > 0) shakeTime -= dt;

  // fade tracers / flashes without allocating
  for (const t of tracers) {
    if (t.life > 0) {
      t.life -= dt;
      t.line.material.opacity = Math.max(0, t.life / 0.09) * 0.95;
      if (t.life <= 0) t.line.visible = false;
    }
  }
  for (const f of flashes) {
    if (f.life > 0) {
      f.life -= dt;
      f.mesh.material.opacity = Math.max(0, f.life / 0.07) * 0.95;
      if (f.life <= 0) f.mesh.visible = false;
    }
  }

  if (state.phase === PHASE.BUY) {
    state.buyTime -= dt;
    document.getElementById('buyTimer').textContent = Math.max(0, Math.ceil(state.buyTime));
    if (state.buyTime <= 0) startRound();
    return;
  }
  if (state.phase !== PHASE.ROUND) return;

  // timers
  if (state.bombPlanted) {
    state.bombTimer -= dt;
    const lamp = bombMesh.getObjectByName('lamp');
    if (lamp) lamp.material.color.setHex(Math.sin(state.time * (state.bombTimer < 10 ? 18 : 6)) > 0 ? 0xff2222 : 0x440000);
    if (state.bombTimer <= 10 && Math.floor(state.bombTimer) !== Math.floor(state.bombTimer + dt)) audio.beep();
    if (state.bombTimer <= 0) {
      bombMesh.visible = false;
      explosionLight.position.copy(bombMesh.position).y = 1.5;
      explosionLight.intensity = 400;
      setTimeout(() => { explosionLight.intensity = 0; }, 200);
      audio.explosion();
      endRound('us', 'The charge detonated at SITE ' + state.bombSite + '.');
      return;
    }
  } else {
    state.roundTime -= dt;
    if (state.roundTime <= 0) {
      endRound('them', 'Time expired with no charge planted.');
      return;
    }
  }

  // player
  const canAct = player.alive;
  if (canAct) {
    stepPlayer(player, input, dt, world.colliders);
    stepPlant(dt);
    // firing: full-auto holds the trigger, semi-auto fires on the click edge
    // alone (a fast click must not be lost between simulation steps)
    const w = WEAPONS[loadout.current];
    if (fireTimer <= 0 && (w.auto ? input.fire : firingEdge)) fireWeapon();
    firingEdge = false;
    // reload
    if (reloadTimer > 0) {
      reloadTimer -= dt;
      if (reloadTimer <= 0) {
        const a = loadout.ammo[loadout.current];
        const need = w.mag - a.mag;
        const take = Math.min(need, a.reserve);
        a.mag += take;
        a.reserve -= take;
      }
    }
  } else {
    firingEdge = false;
  }

  // bots
  for (const b of allBots) stepBot(b, botCtx, dt);
  stepGrenades(dt);

  // prune old noises
  while (noises.length && state.time - noises[0].time > 3) noises.shift();

  // hints
  if (player.alive) {
    const site = nearestSite(player.pos);
    if (!state.bombPlanted && site) hud.hint('Hold E to plant the charge at SITE ' + site.name);
    else if (loadout.ammo[loadout.current]?.mag === 0) hud.hint('Press R to reload');
    else if (document.pointerLockElement !== renderer.domElement && !SHOT) hud.hint('Click the game to capture the mouse');
    else hud.hint('');
  }
}

// --- render ---------------------------------------------------------------
function render() {
  if (player.alive) {
    applyCamera(player, camera, state.time);
    // zoom: DMR-style aim
    const targetFov = zoomed && loadout.current === 'dmr' ? 46 : 75;
    if (Math.abs(camera.fov - targetFov) > 0.1) {
      camera.fov += (targetFov - camera.fov) * 0.2;
      camera.updateProjectionMatrix();
    }
    if (shakeTime > 0) {
      camera.position.x += (Math.random() - 0.5) * shakeMag;
      camera.position.y += (Math.random() - 0.5) * shakeMag;
    }
  } else if (spectate && spectate.alive) {
    camera.position.set(spectate.pos.x, 1.62, spectate.pos.z);
    camera.rotation.order = 'YXZ';
    camera.rotation.y = spectate.yaw;
    camera.rotation.x = 0;
  }
  // viewmodel kick + reload dip
  gunGroup.position.z = -0.55 + gunKick * 0.09;
  gunGroup.position.y = -0.27 + gunDip * -0.22;
  gunGroup.rotation.x = gunKick * 0.22 + gunDip * 0.5;
  renderer.render(scene, camera);
}

// --- main loop: fixed-step sim, render every frame -------------------------
let last = performance.now();
let acc = 0;
function frame(now) {
  requestAnimationFrame(frame);
  let dt = (now - last) / 1000;
  last = now;
  if (dt > 0.25) dt = 0.25;
  acc += dt;
  let n = 0;
  while (acc >= STEP && n < 5) {
    sim(STEP);
    acc -= STEP;
    n += 1;
  }
  if (n === 5) acc = 0;
  if (state.phase === PHASE.ROUND || state.phase === PHASE.BUY) hud.update({ state, player, loadout, spreadNow: 0.012 + heat * 0.02 });
  render();
}

// --- shot modes for screenshots (no pointer lock, staged scenes) ----------
function applyShotMode() {
  if (!SHOT) return;
  hud.hide('menu');
  hud.show('hud');
  if (SHOT === 'start') {
    hud.show('menu');
    // menu overlays the live spawn view down the mid lane
  } else if (SHOT === 'play') {
    startMatch();
    hud.hide('buy');
    startRound();
    // stage a firefight down the clear north lane for the camera
    player.pos.set(-14, 0, -14);
    player.yaw = -Math.PI / 2;
    player.pitch = 0.01;
    enemies[0].pos.set(0, 0, -14);
    enemies[1].pos.set(6, 0, -8);
    allies[0].pos.set(-16, 0, -6);
    loadout.current = 'rifle';
    loadout.owned.rifle = true;
    loadout.ammo.rifle = { mag: 30, reserve: 90 };
    state.money = 5400;
    hud.banner('', '');
  } else if (SHOT === 'buy') {
    startMatch();
    state.money = 5400;
    hud.renderShop(loadout, state.money, tryBuyOrSwitch);
  } else if (SHOT === 'end') {
    startMatch();
    hud.hide('buy');
    state.scoreUs = 3;
    state.scoreThem = 2;
    startRound();
    endRound('us', 'FROST squad eliminated.');
  }
}

// --- test hooks (used by the headless playtest, not by the game) -----------
window.__game = {
  state, player, loadout, enemies, allies, scene, THREE,
  startMatch, startRound, startBuyPhase,
  version: 'emberline-1.0',
};

applyShotMode();
requestAnimationFrame(frame);
