// The robot opponent and the practice ball machine. Both live at the -z end.
// The robot predicts where your shot will go with the same physics engine, glides
// its paddle there (limited by reaction time and speed), then picks a return:
// where to aim, how fast and with what spin, with some mistakes per level.

import { TABLE, BALL_R, GRAVITY, predict, aimShot, solveShot, makeBall, vec, len, sub } from './physics.js';

export const LEVELS = {
  easy:   { name: 'Easy',   react: 0.30, speed: 2.2, spread: 0.24, pace: [4.5, 6.5],  spin: [0, 60],    errRate: 0.10, early: 0.0, aggression: 0.10, smash: 0 },
  medium: { name: 'Medium', react: 0.22, speed: 3.0, spread: 0.18, pace: [5.5, 8.0],  spin: [30, 130],  errRate: 0.06, early: 0.3, aggression: 0.30, smash: 0.3 },
  hard:   { name: 'Hard',   react: 0.16, speed: 3.8, spread: 0.12, pace: [7.0, 10.5], spin: [60, 220],  errRate: 0.035, early: 0.5, aggression: 0.55, smash: 0.6 },
  pro:    { name: 'Pro',    react: 0.11, speed: 4.8, spread: 0.07, pace: [8.5, 13],   spin: [100, 320], errRate: 0.02, early: 0.7, aggression: 0.80, smash: 0.9 },
};

const rand = (rng, a, b) => a + (b - a) * rng();
const gauss = rng => { let s = 0; for (let i = 0; i < 4; i++) s += rng(); return (s - 2) / 0.577; };
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

// Topspin (positive mag) or backspin (negative) for a ball travelling along z in
// direction dirZ, plus some side spin.
export const spinFor = (dirZ, mag, side = 0) => ({ x: dirZ * mag, y: side, z: 0 });

export class Bot {
  constructor(level = 'medium', { side = -1, rng = Math.random } = {}) {
    this.side = side;
    this.rng = rng;
    this.setLevel(level);
    this.home = { x: 0, y: TABLE.top + 0.22, z: side * (TABLE.halfL + 0.45) };
    this.pad = { ...this.home };
    this.plan = null;
    this.swing = 0;          // 0..1 swing animation, set on a hit
    this.mood = 0;           // >0 happy, <0 sad, for the face
  }

  setLevel(level) { this.levelKey = level; this.L = LEVELS[level] ?? LEVELS.medium; }

  reset() { this.plan = null; this.pad = { ...this.home }; }

  // The other player has hit: work out where to meet the ball.
  // `now` is the game clock. Returns the plan (or null if the ball won't need
  // hitting because it's going out or into the net).
  planReturn(ball, now) {
    const r = predict(ball, { maxT: 2.5, sampleEvery: 0.01, stopAt: ['floor', 'edge'] });
    const s = this.side, T = TABLE;
    // The bounce on our side (a serve bounces on the server's side first).
    const iBounce = r.events.findIndex(e => e.type === 'table' && e.side === s);
    const bounce = r.events[iBounce];
    if (!bounce || r.events.slice(0, iBounce).some(e => e.type === 'net' && !e.cord)) {
      this.plan = { idle: true };
      return null;
    }
    const after = r.samples.filter(q => q.t > bounce.t + 0.04 && q.p.y > T.top + 0.03 && q.p.z * s > T.halfL - 0.3
      && q.p.z * s < T.halfL + 1.8 && Math.abs(q.p.x) < 2.2);
    if (!after.length) { this.plan = { idle: true }; return null; }
    let peak = 0;
    after.forEach((q, i) => { if (q.p.y > after[peak].p.y) peak = i; });
    // Pro levels take it early (near the end line), easy ones wait for the top.
    const firstDeep = after.findIndex(q => q.p.z * s > T.halfL - 0.15);
    const early = firstDeep >= 0 ? Math.min(peak, firstDeep) : peak;
    const idx = Math.round(peak + (early - peak) * this.L.early);
    // Take the first point from there that the paddle can get to in time.
    const canReach = q => len(sub(q.p, this.pad)) / this.L.speed <= q.t - this.L.react;
    let k = idx;
    while (k < after.length && !canReach(after[k])) k++;
    const reachable = k < after.length;
    const q = after[reachable ? k : idx];
    this.plan = { t: now + q.t, p: { ...q.p }, start: now + this.L.react, reachable, hit: false };
    return this.plan;
  }

  // Serve: returns the ball to toss. The robot then hits it on the way down.
  startServe(now) {
    const s = this.side;
    const x = rand(this.rng, -0.45, 0.45);
    const p = { x, y: TABLE.top + 0.12, z: s * (TABLE.halfL + 0.12) };
    const vy = 2.3;
    // Hit when it has fallen back to about 18 cm above the table.
    const hitY = TABLE.top + 0.18;
    const tHit = (vy + Math.sqrt(vy * vy - 2 * GRAVITY * (hitY - p.y))) / GRAVITY;
    this.pad = { x: x + 0.05, y: hitY, z: p.z };
    this.plan = { t: now + tHit, p: { x, y: hitY, z: p.z }, start: now, reachable: true, hit: false, serve: true };
    return makeBall(p, { x: 0, y: vy, z: 0 });
  }

  // Move the paddle. dt seconds, now = game clock.
  update(dt, now) {
    this.swing = Math.max(0, this.swing - dt * 4);
    this.mood *= Math.pow(0.3, dt);
    let target = this.home;
    if (this.plan && !this.plan.idle && !this.plan.hit && now >= this.plan.start) target = this.plan.p;
    const d = sub(target, this.pad);
    const dist = len(d);
    const maxStep = this.L.speed * dt * (target === this.home ? 0.6 : 1);
    if (dist > 1e-4) {
      const k = Math.min(1, maxStep / dist);
      this.pad = { x: this.pad.x + d.x * k, y: this.pad.y + d.y * k, z: this.pad.z + d.z * k };
    }
  }

  // Called every physics substep while the robot is due to hit. Returns a shot
  // { v, w } to put on the ball, or null.
  tryHit(ball, now, ctx = {}) {
    const pl = this.plan;
    if (!pl || pl.idle || pl.hit || now < pl.t) return null;
    if (now > pl.t + 0.08) { pl.hit = true; pl.missed = true; return null; }
    if (len(sub(this.pad, pl.p)) > 0.12 || len(sub(ball.p, pl.p)) > 0.25) return null;
    pl.hit = true;
    this.swing = 1;
    this.pad = { ...ball.p, z: ball.p.z + this.side * 0.03 };
    return pl.serve ? this.serveShot(ball) : this.returnShot(ball, ctx);
  }

  returnShot(ball, { playerX = 0, incomingSpeed = 6 } = {}) {
    const L = this.L, rng = this.rng, s = this.side, T = TABLE;
    const dirZ = -s;
    // Where to aim: anywhere, or (when attacking) away from the player.
    let aimX = rand(rng, -0.5, 0.5);
    if (rng() < L.aggression) aimX = -Math.sign(playerX || rand(rng, -1, 1)) * rand(rng, 0.35, 0.6);
    let tx = clamp(aimX + gauss(rng) * L.spread, -T.halfW + 0.06, T.halfW - 0.06);
    let tz = dirZ * clamp(T.halfL - rand(rng, 0.15, 0.75) + gauss(rng) * L.spread * 0.5, 0.25, T.halfL - 0.05);
    let pace = rand(rng, L.pace[0], L.pace[1]);
    const high = ball.p.y > T.top + 0.32;
    if (high && rng() < L.smash) pace = L.pace[1] * 1.2;
    const chop = !high && rng() < 0.18;
    let w = spinFor(dirZ, chop ? -rand(rng, 40, 120) : rand(rng, L.spin[0], L.spin[1]), gauss(rng) * 20);
    if (chop) pace *= 0.75;

    // Mistakes: more likely against fast incoming balls.
    const err = L.errRate * (1 + Math.max(0, incomingSpeed - 8) * 0.25);
    if (rng() < err) {
      const kind = rng();
      if (kind < 0.4) tz = dirZ * (T.halfL + rand(rng, 0.1, 0.4));                 // long
      else if (kind < 0.7) tx = Math.sign(tx || 1) * (T.halfW + rand(rng, 0.1, 0.3)); // wide
      else {                                                                     // net
        const v = solveShot(ball.p, { x: tx * 0.3, y: T.top + 0.06, z: 0 }, 0.25, w);
        return { v, w, error: 'net' };
      }
      const v = solveShot(ball.p, { x: tx, y: T.top + BALL_R, z: tz }, Math.hypot(tz - ball.p.z, tx - ball.p.x) / pace, w);
      return { v, w, error: 'out' };
    }
    const shot = aimShot(ball.p, tx, tz, pace, w);
    return { v: shot.v, w, target: { x: tx, z: tz } };
  }

  // A legal serve: first bounce on our side, then over the net onto theirs.
  serveShot(ball) {
    return serveFrom(ball.p, this.side, this.rng, this.L);
  }
}

// Search a few first-bounce points and flight times for a serve that bounces on
// the server's side then lands on the receiver's side, closest to a random target.
export function serveFrom(p, side, rng = Math.random, L = LEVELS.medium) {
  const T = TABLE, dirZ = -side;
  const want = { x: rand(rng, -0.5, 0.5), z: dirZ * rand(rng, 0.5, 1.15) };
  const mag = rand(rng, L.spin[0], L.spin[1]) * (rng() < 0.4 ? -0.6 : 1);
  const sideSpin = gauss(rng) * 30;
  // If nothing works with the chosen spin, try gentler spin.
  for (const k of [1, 0.5, 0.2]) {
    const s = searchServe(p, side, want, spinFor(dirZ, mag * k, sideSpin * k));
    if (s) return s;
  }
  // Fallback: a gentle serve straight down the middle.
  return { v: solveShot(p, { x: 0, y: T.top + BALL_R, z: side * T.halfL * 0.5 }, 0.3, vec()), w: vec(), fallback: true };
}

function searchServe(p, side, want, w) {
  const T = TABLE;
  let best = null;
  // Try a grid of launch speeds (along the line to the target, and up/down) and
  // keep the legal serve that lands nearest the target with room to spare.
  const dx = want.x - p.x, dz = want.z - p.z, dl = Math.hypot(dx, dz);
  for (const vh of [2.5, 3, 3.5, 4, 4.5, 5, 5.5, 6, 7]) {
    for (const vy of [-4, -3.2, -2.5, -1.8, -1.2, -0.6, 0, 0.6, 1.2]) {
      const v = { x: dx / dl * vh, y: vy, z: dz / dl * vh };
      const r = predict(makeBall(p, v, w), { maxT: 1.3, stopAt: ['floor', 'edge'] });
      const tables = r.events.filter(e => e.type === 'table');
      const net = r.events.some(e => e.type === 'net');
      if (net || tables.length < 2 || tables[0].side !== side || tables[1].side !== -side) continue;
      // Prefer serves with room to spare: away from the net, end line and sides.
      const l = tables[1].p;
      const margin = Math.min(Math.abs(l.z) - 0.1, T.halfL - Math.abs(l.z), T.halfW - Math.abs(l.x));
      const miss = Math.hypot(l.x - want.x, l.z - want.z) + (margin < 0.12 ? 1 : 0);
      if (!best || miss < best.miss) best = { v, w, miss };
    }
  }
  return best && { v: best.v, w: best.w };
}

// Practice ball machine at the -z end.
export const MACHINE = {
  pace: { slow: [3.5, 4.5], medium: [5, 6.5], fast: [7, 9.5] },
  spin: { none: [0, 0], top: [60, 160], back: [-140, -50] },
};

export class Machine {
  constructor({ pace = 'medium', spin = 'none', place = 'mix', hand = 'right', rng = Math.random } = {}) {
    Object.assign(this, { pace, spin, place, hand, rng });
    this.mouth = { x: 0, y: TABLE.top + 0.32, z: -(TABLE.halfL + 0.2) };
  }

  // Returns { ball, v, w } for the next ball.
  feed() {
    const rng = this.rng, T = TABLE;
    const fore = this.hand === 'right' ? 1 : -1;
    let x;
    switch (this.place) {
      case 'forehand': x = fore * rand(rng, 0.25, 0.6); break;
      case 'backhand': x = -fore * rand(rng, 0.25, 0.6); break;
      case 'middle': x = rand(rng, -0.15, 0.15); break;
      default: x = rand(rng, -0.6, 0.6);
    }
    const z = rand(rng, 0.55, 1.15);
    const pr = MACHINE.pace[this.pace] ?? MACHINE.pace.medium;
    const spinKey = this.spin === 'mix' ? ['none', 'top', 'back'][Math.floor(rng() * 3)] : this.spin;
    const sr = MACHINE.spin[spinKey] ?? MACHINE.spin.none;
    const w = spinFor(1, rand(rng, sr[0], sr[1]), 0);
    const shot = aimShot(this.mouth, x, z, rand(rng, pr[0], pr[1]), w);
    return { ball: makeBall(this.mouth, shot.v, w), v: shot.v, w, spin: spinKey };
  }
}
