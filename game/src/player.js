// player.js — the first-person controller. Acceleration-based movement with
// friction (no ice-skating, no instant stops), crouching that lowers the eye
// and tightens aim, walk-quiet that trades speed for accuracy, and per-axis
// AABB collision against the world's boxes. The camera carries recoil as a
// decaying pitch offset so firing visibly climbs.
import * as THREE from 'three';
import { blockedAt } from './world.js';

export const EYE_STAND = 1.62;
export const EYE_CROUCH = 1.08;
const RADIUS = 0.42;
const WALK_SPEED = 4.6;
const CROUCH_SPEED = 2.4;
const QUIET_SPEED = 2.0;
const ACCEL = 42;
const FRICTION = 11;

export function createPlayer() {
  return {
    pos: new THREE.Vector3(-21, 0, 0),
    vel: new THREE.Vector3(),
    yaw: -Math.PI / 2, // facing +x, down the mid lane
    pitch: 0,
    recoil: 0, // decaying extra pitch
    crouched: false,
    quiet: false,
    health: 100,
    alive: true,
    onGround: true,
    speed2d: 0,
    moving: false,
    bobPhase: 0,
  };
}

export function eyeHeight(p) {
  return p.crouched ? EYE_CROUCH : EYE_STAND;
}

// Direction the camera actually faces, from yaw/pitch/recoil.
export function cameraDir(p) {
  const pitch = p.pitch + p.recoil;
  return new THREE.Vector3(
    -Math.sin(p.yaw) * Math.cos(pitch),
    Math.sin(pitch),
    -Math.cos(p.yaw) * Math.cos(pitch),
  );
}

export function stepPlayer(p, input, dt, colliders) {
  if (!p.alive) return;
  const forward = new THREE.Vector3(-Math.sin(p.yaw), 0, -Math.cos(p.yaw));
  const right = new THREE.Vector3(Math.cos(p.yaw), 0, -Math.sin(p.yaw));
  const wish = new THREE.Vector3();
  if (input.f) wish.add(forward);
  if (input.b) wish.sub(forward);
  if (input.r) wish.add(right);
  if (input.l) wish.sub(right);
  if (wish.lengthSq() > 0) wish.normalize();

  const top = p.crouched ? CROUCH_SPEED : p.quiet ? QUIET_SPEED : WALK_SPEED;
  const target = wish.multiplyScalar(top);
  // accelerate toward the wish velocity, then friction when no input
  p.vel.x += (target.x - p.vel.x) * Math.min(1, ACCEL * dt / top * 4.6);
  p.vel.z += (target.z - p.vel.z) * Math.min(1, ACCEL * dt / top * 4.6);
  if (wish.lengthSq() === 0) {
    const f = Math.max(0, 1 - FRICTION * dt);
    p.vel.x *= f;
    p.vel.z *= f;
  }
  p.speed2d = Math.hypot(p.vel.x, p.vel.z);
  p.moving = p.speed2d > 0.6;

  // per-axis move with circle-vs-AABB resolve
  moveAxis(p, p.vel.x * dt, 0, colliders);
  moveAxis(p, 0, p.vel.z * dt, colliders);

  // recoil decays back toward zero; head bob follows speed
  p.recoil *= Math.max(0, 1 - 9 * dt);
  if (p.moving) p.bobPhase += dt * p.speed2d * 1.6;
}

function moveAxis(p, dx, dz, colliders) {
  const nx = p.pos.x + dx;
  const nz = p.pos.z + dz;
  if (!blockedAt(colliders, nx, nz, RADIUS)) {
    p.pos.x = nx;
    p.pos.z = nz;
    return;
  }
  // try sliding along the single axis that is free
  if (dx !== 0 && !blockedAt(colliders, nx, p.pos.z, RADIUS)) p.pos.x = nx;
  else if (dz !== 0 && !blockedAt(colliders, p.pos.x, nz, RADIUS)) p.pos.z = nz;
}

export function applyCamera(p, camera, time) {
  const bob = p.moving && !p.crouched ? Math.sin(p.bobPhase) * 0.028 : 0;
  camera.position.set(p.pos.x, eyeHeight(p) + bob, p.pos.z);
  camera.rotation.order = 'YXZ';
  camera.rotation.y = p.yaw;
  camera.rotation.x = p.pitch + p.recoil;
  camera.rotation.z = 0;
}
