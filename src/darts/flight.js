// A dart in the air: a simple projectile (a dart barely slows over 2.4 m),
// where it ends up, and how fast your hand was going when you let go.
import { BOARD, FACE_Z, R, CABINET, WALL, scoreAt, wireDist, MISS } from './board.js';

export const GRAV = 9.81;

// Where a dart launched from p with velocity v is t seconds later.
export function posAt(p, v, t) {
  return { x: p.x + v.x * t, y: p.y + v.y * t - 0.5 * GRAV * t * t, z: p.z + v.z * t };
}
export function velAt(v, t) { return { x: v.x, y: v.y - GRAV * t, z: v.z }; }

// The launch velocity that reaches `target` (x, y, z) in T seconds.
export function solveLaunch(p, target, T) {
  return { x: (target.x - p.x) / T, y: (target.y - p.y + 0.5 * GRAV * T * T) / T, z: (target.z - p.z) / T };
}

// When a dart crosses the plane z = zPlane (heading towards the board), or null.
function crossTime(p, v, zPlane) {
  if (v.z >= -0.05 || p.z <= zPlane) return null;
  return (zPlane - p.z) / v.z;
}
// When it reaches the floor.
function floorTime(p, v) {
  const a = -0.5 * GRAV, b = v.y, c = p.y;
  return (-b - Math.sqrt(Math.max(0, b * b - 4 * a * c))) / (2 * a);
}

// Where a throw ends up, worked out the moment it leaves the hand:
// { kind: 'board' | 'cabinet' | 'wall' | 'floor' | 'away', t, at: {x,y,z},
//   hit: the score (MISS off the board), bx, by: board coordinates, bounce }.
// A dart that lands right on a wire bounces out now and then (rng).
export function flightOutcome(p, v, rng = Math.random) {
  const tf = floorTime(p, v);
  const tb = crossTime(p, v, FACE_Z);
  if (tb != null && tb < tf) {
    const at = posAt(p, v, tb);
    const bx = at.x - BOARD.x, by = at.y - BOARD.y;
    if (Math.hypot(bx, by) <= R.board) {
      const hit = scoreAt(bx, by);
      const bounce = hit.score > 0 && wireDist(bx, by) < 0.0003 && rng() < 0.35;
      return { kind: 'board', t: tb, at, bx, by, hit: bounce ? MISS : hit, scored: hit, bounce };
    }
    if (Math.abs(bx) <= CABINET && Math.abs(by) <= CABINET) return { kind: 'cabinet', t: tb, at, bx, by, hit: MISS };
  }
  const tw = crossTime(p, v, WALL.z);
  if (tw != null && tw < tf) {
    const at = posAt(p, v, tw);
    if (Math.abs(at.x) <= WALL.halfW && at.y <= WALL.top) return { kind: 'wall', t: tw, at, hit: MISS };
  }
  if (Number.isFinite(tf) && tf > 0 && tf < 4) return { kind: 'floor', t: tf, at: posAt(p, v, tf), hit: MISS };
  return { kind: 'away', t: 2, at: posAt(p, v, 2), hit: MISS };
}

// How fast the hand was moving when you let go: the fastest straight-line fit
// over any 50 ms of the last 120 ms of samples ({ t, x, y, z }, oldest first).
// Taking the peak forgives letting go a moment late, as the hand slows.
export function releaseVelocity(samples, window = 0.05, lookback = 0.12) {
  const n = samples.length;
  if (n < 3) return null;
  const tEnd = samples[n - 1].t;
  let best = null;
  for (let e = n - 1; e >= 2 && tEnd - samples[e].t <= lookback; e--) {
    let s = e;
    while (s > 0 && samples[e].t - samples[s].t < window) s--;
    if (e - s < 2) continue;
    const v = fit(samples, s, e);
    const sp = Math.hypot(v.x, v.y, v.z);
    if (!best || sp > best.speed) best = { ...v, speed: sp };
  }
  return best;
}
// Least-squares slope of x, y, z against t over samples[s..e].
function fit(samples, s, e) {
  let n = 0, mt = 0;
  for (let i = s; i <= e; i++) { mt += samples[i].t; n++; }
  mt /= n;
  const out = {};
  for (const k of ['x', 'y', 'z']) {
    let mv = 0;
    for (let i = s; i <= e; i++) mv += samples[i][k];
    mv /= n;
    let num = 0, den = 0;
    for (let i = s; i <= e; i++) { const dt = samples[i].t - mt; num += dt * (samples[i][k] - mv); den += dt * dt; }
    out[k] = den > 0 ? num / den : 0;
  }
  return out;
}
