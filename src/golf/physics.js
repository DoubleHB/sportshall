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

// ---------------------------------------------- moving obstacles (Trickshot) --
export function sliderAt(s, t) {
  const mid = (s.x0 + s.x1) / 2, amp = (s.x1 - s.x0) / 2, w = 2 * Math.PI / s.period;
  return { x: mid + amp * Math.sin(w * t + s.phase), vx: amp * w * Math.cos(w * t + s.phase) };
}
export const spinnerAngle = (s, t) => s.speed * t;
const SLIDER_DEPTH = 0.08, SPINNER_THICK = 0.06;

// A capsule (segment a-b, radius rr) moving with velocity velAt(qx, qz) at its
// surface. Pushes the ball out and bounces it off, carrying the obstacle's speed.
function hitMoving(b, ax, az, bx, bz, rr, velAt, e) {
  const ex = bx - ax, ez = bz - az, l2 = ex * ex + ez * ez || 1e-9;
  const u = Math.max(0, Math.min(1, ((b.x - ax) * ex + (b.z - az) * ez) / l2));
  const qx = ax + ex * u, qz = az + ez * u;
  const dx = b.x - qx, dz = b.z - qz, d = Math.hypot(dx, dz);
  if (d >= R + rr || d < 1e-9) return false;
  const nx = dx / d, nz = dz / d;
  b.x = qx + nx * (R + rr); b.z = qz + nz * (R + rr);
  const [ox, oz] = velAt(qx, qz);
  let rx = b.vx - ox, rz = b.vz - oz;
  const vn = rx * nx + rz * nz;
  if (vn >= 0) return false;
  rx -= (1 + e) * vn * nx; rz -= (1 + e) * vn * nz;
  b.vx = rx + ox; b.vz = rz + oz;
  b.moving = true;
  return true;
}

// Sliders and spinners can knock even a ball that's sitting still.
function hitObstacles(b, hole, t, events) {
  const s0 = speedOf(b);
  for (const s of hole.sliders ?? []) {
    const { x, vx } = sliderAt(s, t), half = s.w / 2 - SLIDER_DEPTH / 2;
    if (hitMoving(b, x - half, s.z, x + half, s.z, SLIDER_DEPTH / 2, () => [vx, 0], 0.6)) events?.push({ type: 'bumper', speed: Math.max(s0, Math.abs(vx)) });
  }
  for (const s of hole.spinners ?? []) {
    const a = spinnerAngle(s, t), ux = Math.cos(a), uz = Math.sin(a);
    const velAt = (qx, qz) => [-s.speed * (qz - s.z), s.speed * (qx - s.x)];
    if (hitMoving(b, s.x - ux * s.len, s.z - uz * s.len, s.x + ux * s.len, s.z + uz * s.len, SPINNER_THICK / 2, velAt, 0.6)) events?.push({ type: 'bumper', speed: s0 + s.speed * 0.3 });
  }
}

const G = 9.81;
// The speed a ball needs to get right round a loop of radius r.
export const loopSpeed = r => Math.sqrt(5 * G * r);
// Where a ball is on a loop (entry point P, direction d, radius r) at angle phi.
export function loopPoint(L, phi) {
  const [dx, dz] = L.dir, sx = -dz, sz = dx;
  const off = (phi / (2 * Math.PI)) * 0.06 - 0.03;   // a slight corkscrew so the way out passes beside the way in
  return { x: L.x + dx * L.r * Math.sin(phi) + sx * off, y: L.r * (1 - Math.cos(phi)), z: L.z + dz * L.r * Math.sin(phi) + sz * off };
}

function hazard(b, kind, events) {
  b.moving = false; b.hazard = kind; b.vx = b.vz = 0; b.y = 0;
  events?.push({ type: 'hazard', kind });
}
const inAny = (x, z, polys) => (polys ?? []).some(p => pointInPoly(x, z, p));

// The ball in the middle of a loop, a jump or a pipe: moves along its path
// and comes out at the far end. Returns true while it's busy.
function stepSpecial(b, hole, h, events) {
  if (b.loop) {
    const L = b.loop;
    L.t += h;
    const k = Math.min(1, L.t / L.dur);
    const phi = L.pass ? k * 2 * Math.PI : L.phiMax * Math.sin(Math.PI * k);
    const p = loopPoint(L.def, phi);
    b.x = p.x; b.z = p.z; b.y = p.y;
    if (k >= 1) {
      const [dx, dz] = L.def.dir;
      b.y = 0; b.loop = null;
      if (L.pass) { b.x = L.def.x + dx * 0.16; b.z = L.def.z + dz * 0.16; b.vx = dx * L.v; b.vz = dz * L.v; }
      else { b.x = L.def.x - dx * 0.02; b.z = L.def.z - dz * 0.02; b.vx = -dx * L.v; b.vz = -dz * L.v; }
      events?.push({ type: 'loop', pass: L.pass });
    }
    return true;
  }
  if (b.air) {
    const A = b.air;
    A.t += h;
    const k = Math.min(1, A.t / A.dur);
    b.x = A.x0 + (A.x1 - A.x0) * k; b.z = A.z0 + (A.z1 - A.z0) * k; b.y = 4 * A.apex * k * (1 - k);
    if (k >= 1) {
      b.air = null; b.y = 0;
      if (!pointInPoly(b.x, b.z, hole.outline) || inAny(b.x, b.z, hole.pits) || inAny(b.x, b.z, hole.water)) hazard(b, inAny(b.x, b.z, hole.water) ? 'water' : 'pit', events);
      else { b.vx = A.vx; b.vz = A.vz; events?.push({ type: 'land', speed: Math.hypot(A.vx, A.vz) }); }
    }
    return true;
  }
  if (b.pipe) {
    const Pp = b.pipe;
    Pp.t += h;
    if (Pp.t >= Pp.dur) {
      b.pipe = null; b.hidden = false;
      b.x = Pp.def.out[0]; b.z = Pp.def.out[1];
      b.vx = Pp.def.dir[0] * Pp.speed; b.vz = Pp.def.dir[1] * Pp.speed;
      events?.push({ type: 'pipeOut' });
    }
    return true;
  }
  return false;
}

// One substep. ph = prepareHole(hole); t = hole clock; events gets
// { type: 'wall' | 'bumper' | 'cup' | 'lip' | 'stop' | 'loop' | 'jump' |
//   'land' | 'pipe' | 'pipeOut' | 'hazard', ... }.
export function golfStep(b, ph, h, t, events, rng = Math.random) {
  if (b.sunk || b.hazard) return;
  const hole = ph.hole;
  if (!b.moving) {
    // Only a moving obstacle can set a resting ball going.
    if (hole.sliders || hole.spinners) hitObstacles(b, hole, t, events);
    if (!b.moving) return;
  }
  if (stepSpecial(b, hole, h, events)) return;
  const px = b.x, pz = b.z;
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
  if (hole.sliders || hole.spinners) hitObstacles(b, hole, t, events);

  // Loops: crossing the entry line inside the channel starts the ride.
  for (const L of hole.loops ?? []) {
    const [dx, dz] = L.dir;
    const a0 = (px - L.x) * dx + (pz - L.z) * dz, a1 = (b.x - L.x) * dx + (b.z - L.z) * dz;
    const lat = Math.abs((b.x - L.x) * -dz + (b.z - L.z) * dx);
    const along = b.vx * dx + b.vz * dz;
    if (a0 < 0 && a1 >= 0 && lat < L.half + R && along > 0) {
      const need = loopSpeed(L.r);
      if (along >= need) b.loop = { def: L, t: 0, dur: 2 * Math.PI * L.r / along * 1.3, pass: true, v: along * 0.8 };
      else {
        // Not enough: it climbs as far as it can and rolls back.
        const hgt = along * along / (2 * G);
        const phiMax = Math.min(Math.PI * 0.9, Math.acos(Math.max(-1, 1 - hgt / L.r)));
        b.loop = { def: L, t: 0, dur: Math.max(0.35, 2 * phiMax * L.r / Math.max(along, 0.4)), pass: false, phiMax, v: along * 0.6 };
      }
      events?.push({ type: 'loopIn', pass: b.loop.pass });
      return;
    }
  }
  // Jumps: leaving the top of a ramp launches the ball.
  for (const J of hole.jumps ?? []) {
    const [dx, dz] = J.dir;
    const a0 = px * dx + pz * dz, a1 = b.x * dx + b.z * dz, edgeA = J.edge * dz;
    const along = b.vx * dx + b.vz * dz;
    if (a0 < edgeA && a1 >= edgeA && b.x >= J.x0 && b.x <= J.x1 && along > 0.4) {
      const c = Math.cos(J.angle), si = Math.sin(J.angle);
      const tof = 2 * along * si / G, range = along * c * tof;
      const lat = b.vx * -dz + b.vz * dx;            // sideways speed carries on through the air
      b.air = {
        t: 0, dur: tof, x0: b.x, z0: b.z,
        x1: b.x + dx * range + -dz * lat * tof, z1: b.z + dz * range + dx * lat * tof,
        apex: along * along * si * si / (2 * G),
        vx: (dx * along * c - dz * lat) * 0.7, vz: (dz * along * c + dx * lat) * 0.7,
      };
      events?.push({ type: 'jump', speed: along });
      return;
    }
  }
  // Pipes: roll into a mouth and pop out somewhere else.
  for (const pp of hole.pipes ?? []) {
    if (Math.hypot(b.x - pp.in[0], b.z - pp.in[1]) < 0.075) {
      b.pipe = { def: pp, t: 0, dur: 0.8, speed: Math.min(3, Math.max(0.7, s * 0.9)) };
      b.hidden = true;
      events?.push({ type: 'pipe' });
      return;
    }
  }
  // Water and pits: penalty.
  if (inAny(b.x, b.z, hole.water)) return hazard(b, 'water', events);
  if (inAny(b.x, b.z, hole.pits)) return hazard(b, 'pit', events);

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
