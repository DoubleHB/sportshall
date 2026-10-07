// Mini golf ball physics, flat on the floor (x, z): rolling friction, slopes
// as pushes, walls, bumpers, the windmill's gate and the cup. Pure, tested in
// Node. Times in seconds, distances in metres.
import { GOLF_BALL_R as R, CUP_R, wallsOf, pointInPoly } from './course.js';

export const ROLL_DECEL = 0.55;     // m/s² of rolling friction on the green
const STATIC = ROLL_DECEL;          // a slope gentler than rolling friction can't start the ball rolling
const STOP_SPEED = 0.03;
const WALL_E = 0.7, BUMPER_E = 0.85;
export const CAPTURE_SPEED = 1.3;   // faster than this and it lips out
export const MAX_PUTT = 6;          // m/s

export const makeGolfBall = (x, z) => ({ x, z, vx: 0, vz: 0, moving: false, sunk: false });
export const speedOf = b => Math.hypot(b.vx, b.vz);

export function prepareHole(hole) {
  return { hole, segs: wallsOf(hole) };
}

// The push from slopes at (x, z).
export function slopeAccel(hole, x, z) {
  let ax = 0, az = 0;
  for (const s of hole.slopes ?? []) {
    if (s.kind === 'tilt' && pointInPoly(x, z, s.poly)) { ax += s.a[0]; az += s.a[1]; }
    else if (s.kind === 'bowl') {
      const dx = s.x - x, dz = s.z - z, d = Math.hypot(dx, dz);
      if (d < s.r && d > 1e-4) { ax += dx / d * s.a; az += dz / d * s.a; }
    }
  }
  return [ax, az];
}

// Is the windmill's gate shut at time t? Four blades turn; whenever one points
// straight down it blocks the gap.
export function windmillBlocked(w, t) {
  if (!w) return false;
  for (let k = 0; k < 4; k++) {
    let a = (t * w.speed + k * Math.PI / 2) % (2 * Math.PI);
    a = Math.abs(a - Math.PI);
    if (a < 0.32) return true;
  }
  return false;
}

function bounceOff(b, nx, nz, e) {
  const vn = b.vx * nx + b.vz * nz;
  if (vn >= 0) return false;
  b.vx -= (1 + e) * vn * nx; b.vz -= (1 + e) * vn * nz;
  b.vx *= 0.96; b.vz *= 0.96;
  return true;
}

function hitSegment(b, ax, az, bx, bz, e) {
  const ex = bx - ax, ez = bz - az, l2 = ex * ex + ez * ez || 1e-9;
  const t = Math.max(0, Math.min(1, ((b.x - ax) * ex + (b.z - az) * ez) / l2));
  const qx = ax + ex * t, qz = az + ez * t;
  const dx = b.x - qx, dz = b.z - qz, d = Math.hypot(dx, dz);
  if (d >= R || d < 1e-9) return false;
  const nx = dx / d, nz = dz / d;
  b.x = qx + nx * R; b.z = qz + nz * R;
  return bounceOff(b, nx, nz, e);
}

// One substep. ph = prepareHole(hole); t = hole clock; events gets
// { type: 'wall' | 'bumper' | 'cup' | 'lip' | 'stop', speed }.
export function golfStep(b, ph, h, t, events, rng = Math.random) {
  if (b.sunk || !b.moving) return;
  const hole = ph.hole;
  const [ax, az] = slopeAccel(hole, b.x, b.z);
  b.vx += ax * h; b.vz += az * h;
  // Rolling friction: slows the ball without ever turning it round.
  let s = speedOf(b);
  if (s > 0) {
    const ns = Math.max(0, s - ROLL_DECEL * h);
    b.vx *= ns / s; b.vz *= ns / s;
  }
  b.x += b.vx * h; b.z += b.vz * h;
  s = speedOf(b);

  for (const [x0, z0, x1, z1] of ph.segs) if (hitSegment(b, x0, z0, x1, z1, WALL_E)) events?.push({ type: 'wall', speed: s });
  for (const p of hole.bumpers ?? []) {
    const dx = b.x - p.x, dz = b.z - p.z, d = Math.hypot(dx, dz), min = R + p.r;
    if (d < min && d > 1e-9) {
      const nx = dx / d, nz = dz / d;
      b.x = p.x + nx * min; b.z = p.z + nz * min;
      if (bounceOff(b, nx, nz, BUMPER_E)) events?.push({ type: 'bumper', speed: s });
    }
  }
  const w = hole.windmill;
  if (w && windmillBlocked(w, t)) {
    // The blade sits just in front of the wall, across the gap.
    if (hitSegment(b, w.x - w.gap, w.z + 0.03, w.x + w.gap, w.z + 0.03, 0.5)) events?.push({ type: 'blade', speed: s });
  }

  // The cup.
  const [cx, cz] = hole.cup;
  const dc = Math.hypot(b.x - cx, b.z - cz);
  if (dc < CUP_R) {
    if (s < CAPTURE_SPEED) {
      b.sunk = true; b.moving = false; b.vx = b.vz = 0; b.x = cx; b.z = cz;
      events?.push({ type: 'cup', speed: s });
      return;
    }
    if (!b.lipped) {
      // Too fast: it rattles over the cup and carries on, slower and knocked off line.
      b.lipped = true;
      const turn = (rng() - 0.5) * 0.6, c = Math.cos(turn), si = Math.sin(turn);
      const vx = b.vx * c - b.vz * si, vz = b.vx * si + b.vz * c;
      b.vx = vx * 0.7; b.vz = vz * 0.7;
      events?.push({ type: 'lip', speed: s });
    }
  } else if (dc > CUP_R + R) b.lipped = false;

  if (s < STOP_SPEED && Math.hypot(ax, az) < STATIC) {
    b.vx = b.vz = 0; b.moving = false;
    events?.push({ type: 'stop' });
  }
}

// Hit the ball: direction (dx, dz) need not be unit length; speed in m/s.
export function putt(b, dx, dz, speed) {
  const l = Math.hypot(dx, dz) || 1, v = Math.min(MAX_PUTT, speed);
  b.vx = dx / l * v; b.vz = dz / l * v; b.moving = true; b.lipped = false;
}

// Run a putt to the end (for tests and the screen version's aim preview).
// Returns { sunk, x, z, t, events }.
export function rollOut(ph, ball, { h = 1 / 500, maxT = 15, t0 = 0, rng } = {}) {
  const b = { ...ball }, events = [];
  let t = 0;
  while ((b.moving) && t < maxT) { golfStep(b, ph, h, t0 + t, events, rng); t += h; }
  return { sunk: b.sunk, x: b.x, z: b.z, t, events, ball: b };
}

// The putter head meeting the ball. The head is treated as a small disc
// (radius `size`) whose face normal is `n`, moving with `vel`; it can only push
// a ball that's sitting still, and the ball rolls off along the floor.
// prevC/c: head centre before/after this substep (3D, y up). Returns the putt
// speed, or 0 for no contact.
export function putterContact(b, pad, { size = 0.06, halfThick = 0.016, e = 0.8 } = {}) {
  if (b.moving || b.sunk) return 0;
  const P = { x: b.x, y: R, z: b.z };
  const d0 = (P.x - pad.prevC.x) * pad.prevN.x + (P.y - pad.prevC.y) * pad.prevN.y + (P.z - pad.prevC.z) * pad.prevN.z;
  const d1 = (P.x - pad.c.x) * pad.n.x + (P.y - pad.c.y) * pad.n.y + (P.z - pad.c.z) * pad.n.z;
  const reach = R + halfThick;
  const crossed = (d0 > 0) !== (d1 > 0);
  if (!crossed && Math.abs(d1) > reach) return 0;
  const ox = P.x - pad.c.x - pad.n.x * d1, oy = P.y - pad.c.y - pad.n.y * d1, oz = P.z - pad.c.z - pad.n.z * d1;
  if (Math.hypot(ox, oy, oz) > size + R * 0.5) return 0;
  // The ball is on the `side` of the face it was on before this substep. It's
  // pushed that way, along the floor, at
  // (1 + e) times the head's speed towards it (a putter is far heavier).
  const side = Math.sign(d0) || Math.sign(d1) || 1;    // the ball sits still, so where it was is where it is
  let nx = pad.n.x * side, nz = pad.n.z * side;
  const nl = Math.hypot(nx, nz);
  if (nl < 0.3) return 0;               // face pointing at the floor or the ceiling
  nx /= nl; nz /= nl;
  const approach = pad.vel.x * nx + pad.vel.z * nz;
  if (approach < 0.05) return 0;
  const speed = approach * (1 + e);
  putt(b, nx, nz, speed);
  return Math.min(MAX_PUTT, speed);
}
