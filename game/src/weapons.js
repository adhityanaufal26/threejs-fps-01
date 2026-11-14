// weapons.js — the arsenal. Four guns plus a frag grenade. Every gun has a
// fire rate, a damage curve, a magazine, a spread that grows with movement
// and sustained fire, and a recoil kick. Damage falls with range; headshots
// double it. Nothing here touches the DOM: fire() returns a result the
// caller turns into tracers, sounds and HUD.
import * as THREE from 'three';

export const WEAPONS = {
  pistol: {
    id: 'pistol', key: '1', name: 'VK-9 SIDEARM', price: 0, kind: 'pistol',
    damage: 26, headMult: 2, rpm: 320, auto: false, mag: 12, reserve: 36,
    reloadSec: 1.1, spread: 0.011, moveSpread: 0.02, recoil: 0.011, range: 42,
    pellets: 1, desc: 'Reliable sidearm. Free, infinite respect, finite stopping power.',
  },
  rifle: {
    id: 'rifle', key: '2', name: 'AR-77 CARBINE', price: 2700, kind: 'rifle',
    damage: 33, headMult: 2, rpm: 600, auto: true, mag: 30, reserve: 90,
    reloadSec: 2.2, spread: 0.008, moveSpread: 0.026, recoil: 0.014, range: 60,
    pellets: 1, desc: 'Full-auto workhorse. Accurate when you stop, wild when you run.',
  },
  shotgun: {
    id: 'shotgun', key: '3', name: 'SG-12 BREACHER', price: 1700, kind: 'shotgun',
    damage: 14, headMult: 1.6, rpm: 70, auto: false, mag: 6, reserve: 24,
    reloadSec: 2.6, spread: 0.045, moveSpread: 0.05, recoil: 0.05, range: 22,
    pellets: 8, desc: 'Eight pellets per shell. Devastating up close, a polite cough at range.',
  },
  dmr: {
    id: 'dmr', key: '4', name: 'DMR-9 LONGSHOT', price: 3100, kind: 'dmr',
    damage: 78, headMult: 2, rpm: 95, auto: false, mag: 8, reserve: 24,
    reloadSec: 2.8, spread: 0.003, moveSpread: 0.03, recoil: 0.035, range: 90,
    pellets: 1, desc: 'Semi-auto marksman rifle. One clean headshot ends the argument.',
  },
};

export const GRENADE = { id: 'grenade', name: 'FRAG GRENADE', price: 300, damage: 95, radius: 6.5, fuse: 1.6 };

export function createLoadout() {
  return {
    owned: { pistol: true },
    ammo: { pistol: { mag: 12, reserve: 36 } },
    nades: 0,
    current: 'pistol',
  };
}

export function buyWeapon(loadout, money, id) {
  const w = WEAPONS[id];
  if (!w || loadout.owned[id]) return { ok: false, money };
  if (money < w.price) return { ok: false, money };
  loadout.owned[id] = true;
  loadout.ammo[id] = { mag: w.mag, reserve: w.reserve };
  return { ok: true, money: money - w.price };
}

export function buyGrenade(loadout, money) {
  if (money < GRENADE.price) return { ok: false, money };
  loadout.nades += 1;
  return { ok: true, money: money - GRENADE.price };
}

// Spread in radians for one shot: base + movement + heat from firing.
export function currentSpread(weapon, speed, crouched, still, heat) {
  let s = weapon.spread;
  if (speed > 0.6) s += weapon.moveSpread * Math.min(1, speed / 5);
  if (crouched) s *= 0.6;
  if (still) s *= 0.75;
  return s + heat * 0.02;
}

export function damageAtRange(weapon, dist, head) {
  const fall = dist > weapon.range * 0.6
    ? Math.max(0.45, 1 - (dist - weapon.range * 0.6) / weapon.range)
    : 1;
  let d = weapon.damage * fall;
  if (head) d *= weapon.headMult;
  return d;
}

// A thrown grenade: simple ballistic point with bounce, tracked by main.js.
export function createGrenade(origin, dir, team) {
  return {
    pos: origin.clone(),
    vel: dir.clone().multiplyScalar(13).add(new THREE.Vector3(0, 4.5, 0)),
    team,
    fuse: GRENADE.fuse,
    alive: true,
  };
}
