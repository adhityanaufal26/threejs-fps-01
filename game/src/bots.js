// bots.js — the two squads. One bot class serves both teams: FROST defenders
// who hold the sites and rotate on noise, and EMBER allies who push the lanes
// beside the player. A bot routes over the world's waypoint graph, holds a
// position and scans, engages with burst fire when it has line of sight, and
// a living defender runs to defuse a planted charge. Skill (reaction time,
// burst accuracy) rises a little every round.
import * as THREE from 'three';
import { findRoute, nearestWaypoint, blockedAt } from './world.js';

const BODY_H = 1.05;
const HEAD_H = 0.42;
const RADIUS = 0.42;

const NAMES_US = ['Vex', 'Mara'];
const NAMES_THEM = ['Rook', 'Sable', 'Hex', 'Onyx'];

export function createBot(scene, team, index, skill) {
  const color = team === 'us' ? 0xffb347 : 0x3fd3c8;
  const group = new THREE.Group();
  const bodyMat = new THREE.MeshStandardMaterial({ color, roughness: 0.7 });
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x1d2126, roughness: 0.8 });
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.34, BODY_H, 4, 10), bodyMat);
  body.position.y = 0.95;
  body.name = 'body';
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.36, HEAD_H, 0.36), darkMat);
  head.position.y = 1.78;
  head.name = 'head';
  const visor = new THREE.Mesh(
    new THREE.BoxGeometry(0.3, 0.09, 0.05),
    new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.9 }),
  );
  visor.position.set(0, 1.8, 0.19);
  const gun = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.1, 0.72), darkMat);
  gun.position.set(0.22, 1.15, 0.35);
  gun.name = 'gun';
  group.add(body, head, visor, gun);
  scene.add(group);

  return {
    group, body, head,
    team,
    name: (team === 'us' ? NAMES_US : NAMES_THEM)[index % 4],
    skill,
    pos: group.position, // alias: group.position IS the position
    yaw: 0,
    health: 100,
    alive: true,
    state: 'route', // route | hold | engage | defuse | investigate
    route: [],
    routeIdx: 0,
    holdPos: null,
    holdUntil: 0,
    target: null, // bot or 'player'
    targetPos: new THREE.Vector3(),
    lastSeen: 0,
    reactAt: 0,
    nextBurst: 0,
    burstLeft: 0,
    burstAt: 0,
    strafeDir: 1,
    strafeAt: 0,
    investigatePos: null,
    defuseAt: 0,
    speed: 3.1 + skill * 0.25,
    shotCooldown: 0,
  };
}

export function placeBot(bot, x, z, yaw) {
  bot.pos.set(x, 0, z);
  bot.yaw = yaw;
  bot.group.rotation.y = yaw;
  bot.health = 100;
  bot.alive = true;
  bot.group.visible = true;
  bot.state = 'route';
  bot.route = [];
  bot.target = null;
  bot.investigatePos = null;
  bot.defuseAt = 0;
}

export function botTakeDamage(bot, dmg) {
  if (!bot.alive) return false;
  bot.health -= dmg;
  if (bot.health <= 0) {
    bot.alive = false;
    bot.group.visible = false;
    return true;
  }
  return false;
}

// --- perception ---------------------------------------------------------
function hasLos(ctx, from, to) {
  const dir = new THREE.Vector3().subVectors(to, from);
  const dist = dir.length();
  if (dist < 0.01) return true;
  dir.normalize();
  ctx.ray.set(from, dir);
  ctx.ray.far = dist;
  const hits = ctx.ray.intersectObjects(ctx.world.solids, false);
  return hits.length === 0;
}

function enemyEye(ctx, bot) {
  // nearest living enemy of this bot, with a position to aim at
  const list = bot.team === 'us' ? ctx.enemies : ctx.allies;
  let best = null;
  let bd = Infinity;
  for (const e of list) {
    if (!e.alive) continue;
    const d = bot.pos.distanceTo(e.pos);
    if (d < bd) { bd = d; best = e; }
  }
  if (ctx.player.alive && bot.team === 'them') {
    const d = bot.pos.distanceTo(ctx.player.pos);
    if (d < bd) { bd = d; best = 'player'; }
  }
  return { target: best, dist: bd };
}

function aimPoint(ctx, bot) {
  if (bot.target === 'player') {
    return new THREE.Vector3(ctx.player.pos.x, 1.45, ctx.player.pos.z);
  }
  if (bot.target) return new THREE.Vector3(bot.target.pos.x, 1.35, bot.target.pos.z);
  return bot.targetPos;
}

// --- main step ----------------------------------------------------------
export function stepBot(bot, ctx, dt) {
  if (!bot.alive) return;
  const now = ctx.time;

  // hearing: a recent gunshot inside earshot pulls the bot to investigate
  for (const n of ctx.noises) {
    if (now - n.time > 2.5) continue;
    if (bot.pos.distanceTo(n.pos) < n.radius && bot.state !== 'engage') {
      bot.investigatePos = n.pos.clone();
      if (bot.state === 'hold' || bot.state === 'route') bot.state = 'investigate';
    }
  }

  // defuse duty: a living defender runs for a planted charge
  if (ctx.state.bombPlanted && bot.team === 'them' && bot.state !== 'engage') {
    const site = ctx.world.sites[ctx.state.bombSite];
    const d = bot.pos.distanceTo(site.pos);
    if (d < 1.6) {
      bot.state = 'defuse';
    } else if (bot.state !== 'defuse') {
      bot.state = 'route';
      routeTo(ctx, bot, site.pos);
    }
  }

  // vision: nearest enemy with line of sight becomes the target
  const { target, dist } = enemyEye(ctx, bot);
  if (target && dist < 42) {
    const eye = new THREE.Vector3(bot.pos.x, 1.6, bot.pos.z);
    const tp = target === 'player'
      ? new THREE.Vector3(ctx.player.pos.x, 1.4, ctx.player.pos.z)
      : new THREE.Vector3(target.pos.x, 1.4, target.pos.z);
    if (hasLos(ctx, eye, tp)) {
      if (bot.target !== target) {
        bot.target = target;
        bot.reactAt = now + 0.55 - bot.skill * 0.12; // better bots react faster
      }
      bot.targetPos.copy(tp);
      bot.lastSeen = now;
      if (bot.state !== 'defuse') bot.state = 'engage';
    } else if (bot.target && now - bot.lastSeen > 1.6) {
      bot.target = null;
      if (bot.state === 'engage') bot.state = bot.investigatePos ? 'investigate' : 'route';
    }
  } else if (bot.target && now - bot.lastSeen > 1.6) {
    bot.target = null;
    if (bot.state === 'engage') bot.state = bot.investigatePos ? 'investigate' : 'route';
  }

  // --- behaviour by state ---
  if (bot.state === 'defuse') {
    const site = ctx.world.sites[ctx.state.bombSite];
    faceToward(bot, site.pos, dt);
    if (bot.defuseAt === 0) bot.defuseAt = now;
    ctx.state.defuseProgress = (now - bot.defuseAt) / 4.0;
    ctx.state.defuser = bot;
    if (ctx.state.defuseProgress >= 1) ctx.onDefused(bot);
    return;
  }
  bot.defuseAt = 0;

  if (bot.state === 'engage' && bot.target) {
    const tp = aimPoint(ctx, bot);
    faceToward(bot, tp, dt);
    // strafe sideways while firing, changing direction every second or so
    if (now > bot.strafeAt) {
      bot.strafeDir *= -1;
      bot.strafeAt = now + 0.8 + Math.random() * 0.9;
    }
    const fwd = new THREE.Vector3(-Math.sin(bot.yaw), 0, -Math.cos(bot.yaw));
    const side = new THREE.Vector3(Math.cos(bot.yaw), 0, -Math.sin(bot.yaw));
    const d = bot.pos.distanceTo(tp);
    let mx = side.x * bot.strafeDir * 1.6;
    let mz = side.z * bot.strafeDir * 1.6;
    if (d > 16) { mx += fwd.x * 1.4; mz += fwd.z * 1.4; }
    else if (d < 6) { mx -= fwd.x * 1.4; mz -= fwd.z * 1.4; }
    moveBot(bot, ctx, mx * dt, mz * dt);
    // burst fire once reacted
    if (now >= bot.reactAt) {
      if (bot.burstLeft <= 0 && now >= bot.nextBurst) {
        bot.burstLeft = 3 + Math.floor(Math.random() * 3);
        bot.nextBurst = now + 0.9 + Math.random() * 0.7 - bot.skill * 0.1;
      }
      if (bot.burstLeft > 0 && now >= bot.burstAt) {
        bot.burstAt = now + 0.11;
        bot.burstLeft -= 1;
        ctx.botShoot(bot, tp, dist);
      }
    }
    return;
  }

  if (bot.state === 'hold') {
    if (now > bot.holdUntil) {
      bot.state = 'route';
      bot.route = [];
    }
    // slow scan: sweep the view
    bot.yaw += Math.sin(now * 0.7 + bot.pos.x) * 0.25 * dt;
    bot.group.rotation.y = bot.yaw;
    return;
  }

  // route / investigate: walk the waypoint path
  let dest = null;
  if (bot.state === 'investigate' && bot.investigatePos) dest = bot.investigatePos;
  else {
    if (!bot.route.length) pickObjective(ctx, bot);
    const node = ctx.world.waypoints[bot.route[bot.routeIdx]];
    if (node) dest = new THREE.Vector3(node.x, 0, node.z);
  }
  if (!dest) { bot.state = 'hold'; bot.holdUntil = now + 2; return; }
  const dx = dest.x - bot.pos.x;
  const dz = dest.z - bot.pos.z;
  const d = Math.hypot(dx, dz);
  if (d < 0.9) {
    if (bot.state === 'investigate') {
      bot.investigatePos = null;
      bot.state = 'hold';
      bot.holdUntil = now + 3 + Math.random() * 3;
      bot.holdPos = bot.pos.clone();
    } else if (bot.routeIdx < bot.route.length - 1) {
      bot.routeIdx += 1;
    } else {
      bot.state = 'hold';
      bot.holdUntil = now + 2 + Math.random() * 4;
      bot.holdPos = bot.pos.clone();
    }
    return;
  }
  const step = Math.min(d, bot.speed * dt);
  moveBot(bot, ctx, (dx / d) * step, (dz / d) * step);
  faceToward(bot, dest, dt);
}

function routeTo(ctx, bot, pos) {
  const from = nearestWaypoint(ctx.world.waypoints, bot.pos.x, bot.pos.z);
  const to = nearestWaypoint(ctx.world.waypoints, pos.x, pos.z);
  const path = findRoute(ctx.world.edges, from, to);
  if (path.length && path[0] === from) path.shift();
  bot.route = path;
  bot.routeIdx = 0;
}

// Pick where this bot wants to go: defenders hold a site, attackers push one.
function pickObjective(ctx, bot) {
  const w = ctx.world;
  if (bot.team === 'them') {
    const site = Math.random() < 0.5 ? w.sites.A : w.sites.B;
    routeTo(ctx, bot, site.pos);
    return;
  }
  // allies push the site the player is nearest to, or a random one
  const p = ctx.player.pos;
  const dA = p.distanceTo(w.sites.A.pos);
  const dB = p.distanceTo(w.sites.B.pos);
  const site = dA < dB ? w.sites.A : w.sites.B;
  routeTo(ctx, bot, Math.random() < 0.7 ? site.pos : w.waypoints[3]);
}

function faceToward(bot, target, dt) {
  const dx = target.x - bot.pos.x;
  const dz = target.z - bot.pos.z;
  const want = Math.atan2(-dx, -dz);
  let diff = want - bot.yaw;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  bot.yaw += Math.max(-6 * dt, Math.min(6 * dt, diff));
  bot.group.rotation.y = bot.yaw;
}

function moveBot(bot, ctx, dx, dz) {
  const nx = bot.pos.x + dx;
  const nz = bot.pos.z + dz;
  if (!blockedAt(ctx.world.colliders, nx, nz, RADIUS)) {
    bot.pos.x = nx;
    bot.pos.z = nz;
  } else if (!blockedAt(ctx.world.colliders, nx, bot.pos.z, RADIUS)) {
    bot.pos.x = nx;
  } else if (!blockedAt(ctx.world.colliders, bot.pos.x, nz, RADIUS)) {
    bot.pos.z = nz;
  }
  // walk bob: subtle, sells movement at a glance
  bot.group.position.y = Math.abs(Math.sin(ctx.time * 9 + bot.pos.x)) * 0.04;
}
