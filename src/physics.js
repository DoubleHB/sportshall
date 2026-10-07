// Table tennis ball physics. Everything is in "table space": metres and seconds,
// origin on the floor under the middle of the net, y up, the player's end of the
// table at +z and the opponent's end at -z. No three.js here, so the engine runs
// the same in the headset, on the desktop and in the Node tests.

export const TABLE = { halfL: 1.37, halfW: 0.7625, top: 0.76, thick: 0.03, netH: 0.1525, netOver: 0.1525 };
export const BALL_R = 0.02;
export const GRAVITY = 9.81;
export const STEP = 1 / 1000;          // physics substep

const DRAG = 0.14;                     // a = -DRAG |v| v   (Cd 0.5, 2.7 g, 40 mm)
const MAGNUS = 0.0032;                 // a = MAGNUS (w x v)
const SPIN_DECAY = 0.25;               // per second
const TABLE_E = 0.9, TABLE_MU = 0.25;
const FLOOR_E = 0.6, FLOOR_MU = 0.4;
const NET_E = 0.12, CORD_E = 0.3;
export const PADDLE = { radius: 0.082, halfThick: 0.006, e: 0.84, mu: 0.6, maxSpeed: 25 };

// ---- small vector helpers on {x, y, z} ----------------------------------------
export const vec = (x = 0, y = 0, z = 0) => ({ x, y, z });
export const add = (a, b) => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
export const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
export const scale = (a, s) => ({ x: a.x * s, y: a.y * s, z: a.z * s });
export const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
export const cross = (a, b) => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });
export const len = a => Math.hypot(a.x, a.y, a.z);
export const norm = a => { const l = len(a) || 1; return scale(a, 1 / l); };
export const lerpV = (a, b, t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t });

export function makeBall(p, v = vec(), w = vec()) {
  return { p: { ...p }, v: { ...v }, w: { ...w } };
}
export const cloneBall = b => makeBall(b.p, b.v, b.w);

// Is a point over the playing surface (ignoring height)?
export const overTable = p => Math.abs(p.x) <= TABLE.halfW && Math.abs(p.z) <= TABLE.halfL;

// Impulse bounce off a surface with normal n (pointing at the ball) that moves at
// surfVel. Restitution e on the normal part; friction (up to mu x normal impulse)
// works on the slip of the contact point, so spin grips and kicks the ball. The
// ball is a thin hollow sphere, I = 2/3 m r^2, which makes zero slip take 2/5 of
// the slip as impulse.
export function bounce(b, n, e, mu, surfVel = vec()) {
  const vrel = sub(b.v, surfVel);
  const vn = dot(vrel, n);
  if (vn >= 0) return false;
  const vt = sub(vrel, scale(n, vn));
  const rc = scale(n, -BALL_R);
  const slip = add(vt, cross(b.w, rc));
  let j = scale(slip, -1 / 2.5);
  const jMax = mu * (1 + e) * -vn;
  const jl = len(j);
  if (jl > jMax) j = scale(j, jMax / jl);
  b.v = add(add(surfVel, scale(n, -e * vn)), add(vt, j));
  b.w = add(b.w, scale(cross(rc, j), 1.5 / (BALL_R * BALL_R)));
  return true;
}

function accel(b) {
  const { v, w } = b;
  const s = len(v);
  return {
    x: -DRAG * s * v.x + MAGNUS * (w.y * v.z - w.z * v.y),
    y: -GRAVITY - DRAG * s * v.y + MAGNUS * (w.z * v.x - w.x * v.z),
    z: -DRAG * s * v.z + MAGNUS * (w.x * v.y - w.y * v.x),
  };
}

// Flight only (no collisions): used by the shot solver.
export function fly(b, h) {
  const a = accel(b);
  b.v.x += a.x * h; b.v.y += a.y * h; b.v.z += a.z * h;
  b.p.x += b.v.x * h; b.p.y += b.v.y * h; b.p.z += b.v.z * h;
  const k = 1 - SPIN_DECAY * h;
  b.w.x *= k; b.w.y *= k; b.w.z *= k;
}

// One substep with table, net and floor collisions. Collision events are pushed to
// `events` as { type: 'table' | 'net' | 'edge' | 'floor', ... }.
export function step(b, h, events) {
  const p0 = { ...b.p };
  fly(b, h);
  const p = b.p, T = TABLE;

  // Net: a thin wall at z = 0 from the table top up to netH, with a cord on top.
  const crossing = (p0.z > 0) !== (p.z > 0) || Math.abs(p.z) < BALL_R;
  if (crossing && Math.abs(p.x) < T.halfW + T.netOver + BALL_R && p.y > T.top - BALL_R && p.y < T.top + T.netH + BALL_R) {
    const s0 = p0.z !== 0 ? Math.sign(p0.z) : -Math.sign(b.v.z) || 1;
    if (b.v.z * s0 < 0) {
      const cordY = T.top + T.netH;
      if (p.y <= cordY) {
        p.z = s0 * BALL_R;
        b.v = { x: b.v.x * 0.6, y: b.v.y * 0.6, z: -b.v.z * NET_E };
        b.w = scale(b.w, 0.5);
        events?.push({ type: 'net', cord: false, p: { ...p } });
      } else {
        const dy = p.y - cordY;
        const n = norm({ x: 0, y: dy, z: s0 * Math.sqrt(Math.max(BALL_R * BALL_R - dy * dy, 0)) });
        const vn = dot(b.v, n);
        if (vn < 0) {
          b.v = sub(b.v, scale(n, (1 + CORD_E) * vn));
          b.v = scale(b.v, 0.85);
          events?.push({ type: 'net', cord: true, p: { ...p } });
        }
      }
    }
  }

  // Table top.
  if (p.y - BALL_R < T.top && b.v.y < 0 && overTable(p) && p0.y - BALL_R >= T.top - 0.025) {
    p.y = T.top + BALL_R;
    bounce(b, { x: 0, y: 1, z: 0 }, TABLE_E, TABLE_MU);
    events?.push({ type: 'table', side: p.z > 0 ? 1 : -1, p: { ...p } });
  } else if (p.y < T.top && p.y > T.top - T.thick - BALL_R
    && Math.abs(p.x) < T.halfW + BALL_R && Math.abs(p.z) < T.halfL + BALL_R && !overTable(p0)) {
    // The side or end of the table slab: knock it back out. Counts as a miss.
    const px = T.halfW + BALL_R - Math.abs(p.x), pz = T.halfL + BALL_R - Math.abs(p.z);
    if (px < pz) { p.x = Math.sign(p.x) * (T.halfW + BALL_R); b.v.x = -b.v.x * 0.5; }
    else { p.z = Math.sign(p.z) * (T.halfL + BALL_R); b.v.z = -b.v.z * 0.5; }
    events?.push({ type: 'edge', p: { ...p } });
  }

  // Floor.
  if (p.y - BALL_R < 0 && b.v.y < 0) {
    p.y = BALL_R;
    bounce(b, { x: 0, y: 1, z: 0 }, FLOOR_E, FLOOR_MU);
    if (Math.abs(b.v.y) < 0.15) b.v.y = 0;
    events?.push({ type: 'floor', p: { ...p } });
  }
}

// Paddle contact during one substep. `pad` describes the blade at the start
// (prevC, prevN) and end (c, n) of the substep, plus the blade's linear velocity
// at its centre (vel) and angular velocity (ang). Both faces hit. Returns null or
// { face, speed } after bouncing the ball off the blade.
export function collidePaddle(b, prevP, pad) {
  const reach = BALL_R + PADDLE.halfThick;
  const d0 = dot(sub(prevP, pad.prevC), pad.prevN);
  const d1 = dot(sub(b.p, pad.c), pad.n);
  const crossed = (d0 > 0) !== (d1 > 0);
  if (!crossed && Math.abs(d1) > reach) return null;
  const off = sub(b.p, pad.c);
  const inPlane = sub(off, scale(pad.n, d1));
  if (len(inPlane) > (pad.radius ?? PADDLE.radius) + BALL_R * 0.5) return null;
  const vel = clampLen(pad.vel, PADDLE.maxSpeed);
  const sv = add(vel, cross(pad.ang ?? vec(), inPlane));
  // The ball is on the side it came from (if it passed through the blade this
  // substep) or the side it is on now.
  const side = (crossed ? Math.sign(d0) : Math.sign(d1)) || -Math.sign(dot(sub(b.v, sv), pad.n)) || 1;
  const nS = scale(pad.n, side);
  if (dot(sub(b.v, sv), nS) >= 0) return null;
  b.p = add(add(pad.c, inPlane), scale(nS, reach + 0.001));
  bounce(b, nS, PADDLE.e, PADDLE.mu, sv);
  return { face: side, speed: len(sub(b.v, sv)) };
}

export function clampLen(a, max) {
  const l = len(a);
  return l > max ? scale(a, max / l) : a;
}

// Run a copy of the ball forward and report what happens. Returns
// { events: [{type, side, p, t}], samples: [{t, p, v}] } with samples every
// `sampleEvery` seconds. Stops at maxT, at the first event whose type is in
// `stopAt`, or once the ball is clearly dead.
export function predict(ball, { maxT = 2, h = STEP, sampleEvery = 0.01, stopAt = ['floor', 'edge'] } = {}) {
  const b = cloneBall(ball);
  const events = [], samples = [{ t: 0, p: { ...b.p }, v: { ...b.v } }];
  let t = 0, nextSample = sampleEvery;
  const ev = [];
  while (t < maxT) {
    step(b, h, ev);
    t += h;
    if (ev.length) {
      for (const e of ev) { e.t = t; events.push(e); }
      ev.length = 0;
      if (stopAt.includes(events[events.length - 1].type)) break;
    }
    if (t >= nextSample) { samples.push({ t, p: { ...b.p }, v: { ...b.v } }); nextSample += sampleEvery; }
    if (Math.abs(b.p.z) > 8 || Math.abs(b.p.x) > 8) break;
  }
  return { events, samples, ball: b, t };
}

// Find a launch velocity from p that reaches `target` after T seconds with spin w
// (drag and Magnus included). Shooting method: start from the vacuum answer and
// correct by the miss distance a few times.
export function solveShot(p, target, T, w = vec()) {
  let v = { x: (target.x - p.x) / T, y: (target.y - p.y + 0.5 * GRAVITY * T * T) / T, z: (target.z - p.z) / T };
  const h = 1 / 400;
  for (let i = 0; i < 10; i++) {
    const b = makeBall(p, v, w);
    let t = 0;
    while (t < T - 1e-9) { const dt = Math.min(h, T - t); fly(b, dt); t += dt; }
    const e = sub(target, b.p);
    if (len(e) < 0.002) break;
    v = add(v, scale(e, 1 / T));
  }
  return v;
}

// Aim a shot from p to land at (tx, tz) on the table with a horizontal speed of
// about `speed`. Raises the arc until the ball clears the net and its first
// contact is the table on the target side. Returns { v, T, ok, landing }.
export function aimShot(p, tx, tz, speed, w = vec()) {
  const target = { x: tx, y: TABLE.top + BALL_R, z: tz };
  const dist = Math.hypot(tx - p.x, tz - p.z);
  let T = Math.max(dist / Math.max(speed, 1), 0.18);
  let best = null;
  for (let i = 0; i < 12; i++) {
    const v = solveShot(p, target, T, w);
    const r = predict(makeBall(p, v, w), { maxT: T + 0.3, stopAt: ['table', 'net', 'floor', 'edge'] });
    const first = r.events[0];
    const landing = first?.type === 'table' ? first.p : null;
    const ok = !!landing && Math.sign(landing.z) === Math.sign(tz) && Math.abs(landing.z - tz) < 0.08 && Math.abs(landing.x - tx) < 0.08;
    best = { v, T, ok, landing, first };
    if (ok) return best;
    T += 0.05;
  }
  return best;
}
