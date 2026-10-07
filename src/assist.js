// Aim assist for your shots. Right after your paddle hits the ball, look where
// it's going; if it would miss the far half of the table, bend the shot towards
// the nearest good landing spot.
//   strength 1 (Full)  - every shot towards the table lands.
//   strength < 1 (Light) - near misses are rescued; wild swings stay wild.

import { TABLE, predict, aimShot, len, sub, lerpV } from './physics.js';

const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

// How much the shot may be changed (as a fraction of its speed) before Light
// assist gives up on it.
export const lightLimit = strength => 0.25 + 0.5 * strength;

// Mirror table space end for end (z -> -z). Spin is an axial vector, so its x
// and y flip instead.
const mirrorBall = b => ({ p: { ...b.p, z: -b.p.z }, v: { ...b.v, z: -b.v.z }, w: { x: -b.w.x, y: -b.w.y, z: b.w.z } });

// ball: the ball just after the hit. side: +1 if the hitter is at the +z end
// (shooting towards -z), -1 for the far end.
// Returns the corrected velocity, or null when no help is needed or wanted.
export function assistShot(ball, strength, side = 1) {
  if (side < 0) {
    const v = assistNear(mirrorBall(ball), strength);
    return v && { ...v, z: -v.z };
  }
  return assistNear(ball, strength);
}

function assistNear(ball, strength) {
  if (!(strength > 0)) return null;
  const v = ball.v, T = TABLE;
  if (v.z > -1.2) return null;                       // not really a shot at the table
  const r = predict(ball, { maxT: 2, stopAt: ['table', 'net', 'floor', 'edge'] });
  const first = r.events[0];
  if (first && first.type === 'table' && first.side === -1) return null;   // already good

  const speedH = clamp(Math.hypot(v.x, v.z), 3, 14);
  // Where along its line would it have landed? Use the event point, or pull a
  // long ball back inside the end line.
  let tz;
  if (!first) tz = -(T.halfL - 0.15);
  else if (first.type === 'net' || (first.type === 'table' && first.side === 1)) tz = -0.8;
  else tz = clamp(first.p.z, -(T.halfL - 0.12), -0.35);
  // Keep the sideways direction of the shot.
  const k = (tz - ball.p.z) / v.z;
  const tx = clamp(ball.p.x + v.x * k, -(T.halfW - 0.08), T.halfW - 0.08);
  const fixed = aimShot(ball.p, tx, tz, speedH, ball.w).v;
  if (strength >= 1) return fixed;
  // Light: full help for a near miss, fading out for bigger misses.
  const change = len(sub(fixed, v)) / Math.max(len(v), 1);
  const limit = lightLimit(strength);
  if (change <= limit) return fixed;
  if (change >= limit * 1.4) return null;
  return lerpV(v, fixed, 1 - (change - limit) / (limit * 0.4));
}
