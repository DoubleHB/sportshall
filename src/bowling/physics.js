// The ball and the pins, on the flat (x, z) like the mini golf: the ball slides
// through the oil then hooks with its spin; pins are discs at their bellies.
// A pin hit hard enough falls: it slides off the way it was knocked and, as it
// topples, its top sweeps across the deck and can take its neighbours with it
// (that's where most strikes come from). Pure, tested in Node.
import { LANE, BALL_R, BALL_M, PIN_R, PIN_M, PIN_H, PIN_SPOTS } from './lane.js';

const ROLL_DECEL = 0.25;      // m/s²: a ball barely slows down the lane
const HOOK = 2.4;             // m/s² of sideways pull at full spin, once out of the oil
const KNOCK = 0.35;           // m/s: a pin hit softer than this stays up
const E_BALL = 0.55, E_PIN = 0.45;
const PIN_SLIDE = 2.6;        // m/s²: fallen pins skid to a stop
const TOPPLE = 0.32;          // s for a knocked pin to hit the deck
const TIP_R = 0.045;          // the falling pin's top, for sweeping its neighbours
const KICK_E = 0.6;           // how lively the kickbacks are
// (Tuned with a strike-rate run: a hooked pocket hit strikes about two times in
// three, a straight one about one in four, a head-on hit leaves a split.)

// A fresh rack, or only the pins listed (by index) for a second ball.
export function rack(stand = null) {
  return PIN_SPOTS.map((s, i) => ({
    i, x: s.x, z: s.z, vx: 0, vz: 0, down: false, gone: false, fall: 0, fx: 0, fz: -1,
    up: stand ? stand.includes(i) : true,
  })).filter(p => p.up);
}

// Let a ball go: from x on the foul line (or z, on the approach), with
// velocity (vx, vz) and spin (-1..1; + hooks to the left, as a right-hander's does).
export function launch(x, vx, vz, spin = 0, z = LANE.foulZ - 0.05) {
  return { x, z, vx, vz, spin: Math.max(-1, Math.min(1, spin)), state: 'lane', t: 0 };
}

// One step of h seconds. events gets { type: 'gutter' | 'pin' | 'bumper' | 'pit', ... }.
// opts.bumpers: rails along the gutters instead of gutters.
export function step(ball, pins, h, events = null, opts = {}) {
  if (ball) stepBall(ball, pins, h, events, opts);
  for (const p of pins) {
    if (!p.down) continue;
    if (p.fall < 1) p.fall = Math.min(1, p.fall + h / TOPPLE);
    const s = Math.hypot(p.vx, p.vz);
    if (s > 0) { const ns = Math.max(0, s - PIN_SLIDE * h); p.vx *= ns / s; p.vz *= ns / s; }
    p.x += p.vx * h; p.z += p.vz * h;
    // The kickbacks: the side walls of the pin deck send flying pins back in
    // (that's how the corner pins go down). Elsewhere a pin off the lane is gone.
    const off = p.x - LANE.x;
    if (!p.gone && Math.abs(off) > LANE.outer - PIN_R && p.z < LANE.headZ + 0.45) {
      p.x = LANE.x + Math.sign(off) * (LANE.outer - PIN_R);
      if (p.vx * off > 0) { p.vx = -p.vx * KICK_E; events?.push({ type: 'kickback' }); }
    }
    if (!p.gone && (Math.abs(off) > LANE.outer || p.z < LANE.deckEnd || p.z > LANE.headZ + 1.2)) p.gone = true;
  }
  // Pins on pins: a fallen pin's body and toppling top knock standing ones.
  for (let a = 0; a < pins.length; a++) {
    const A = pins[a];
    if (A.gone || !A.down) continue;
    for (let b = 0; b < pins.length; b++) {
      const B = pins[b];
      if (b === a || B.gone) continue;
      if (B.down && b < a) continue;                 // each fallen pair once
      collidePins(A, B, events);
    }
  }
}

function stepBall(b, pins, h, events, opts) {
  if (b.state === 'pit' || b.state === 'gone') return;
  b.t += h;
  const s = Math.hypot(b.vx, b.vz);
  if (s > 0) { const ns = Math.max(0, s - ROLL_DECEL * h); b.vx *= ns / s; b.vz *= ns / s; }
  // Past the oil the spin bites and the ball hooks, until it's rolling into the pins.
  if (b.state === 'lane' && b.z < LANE.foulZ - LANE.len * LANE.oil && b.z > LANE.headZ + 0.35) b.vx -= b.spin * HOOK * h;
  b.x += b.vx * h; b.z += b.vz * h;
  const off = b.x - LANE.x;
  if (b.state === 'lane' && Math.abs(off) > LANE.halfW) {
    if (opts.bumpers) {
      b.x = LANE.x + Math.sign(off) * LANE.halfW;
      if (b.vx * off > 0) { b.vx = -b.vx * 0.5; events?.push({ type: 'bumper', speed: Math.abs(b.vx) }); }
    } else {
      b.state = 'gutter';
      b.x = LANE.x + Math.sign(off) * (LANE.halfW + LANE.gutterW / 2);
      b.vx = 0; b.spin = 0;
      events?.push({ type: 'gutter' });
    }
  }
  if (b.state === 'lane') for (const p of pins) if (!p.gone) collideBall(b, p, events);
  if (b.z < LANE.deckEnd) { b.state = 'pit'; b.vx = b.vz = 0; events?.push({ type: 'pit' }); }
  if (Math.hypot(b.vx, b.vz) < 0.05 && b.state === 'lane') { b.state = 'gone'; events?.push({ type: 'stopped' }); }
}

function knock(p, events, speed) {
  if (p.down) return;
  p.down = true;
  const s = Math.hypot(p.vx, p.vz) || 1;
  p.fx = p.vx / s; p.fz = p.vz / s;
  events?.push({ type: 'pin', i: p.i, speed });
}

function collideBall(b, p, events) {
  const dx = p.x - b.x, dz = p.z - b.z, d = Math.hypot(dx, dz), min = BALL_R + PIN_R;
  if (d >= min || d < 1e-9) return;
  const nx = dx / d, nz = dz / d;
  // Push apart (the pin moves; a standing one is pushed only if it's knocked).
  const rel = (b.vx - p.vx) * nx + (b.vz - p.vz) * nz;
  if (rel <= 0) return;
  const j = (1 + E_BALL) * rel / (1 / BALL_M + 1 / PIN_M);
  b.vx -= j / BALL_M * nx; b.vz -= j / BALL_M * nz;
  p.vx += j / PIN_M * nx; p.vz += j / PIN_M * nz;
  p.x = b.x + nx * min; p.z = b.z + nz * min;
  if (rel > KNOCK) knock(p, events, rel); else if (!p.down) { p.vx = p.vz = 0; }
}

// A fallen (or falling) pin A against pin B.
function collidePins(A, B, events) {
  // The falling pin's top: from its base towards where it's falling.
  const reach = PIN_H * 0.8 * A.fall;
  const tx = A.x + A.fx * reach, tz = A.z + A.fz * reach;
  for (const [cx, cz, r] of [[A.x, A.z, PIN_R], [tx, tz, TIP_R]]) {
    const dx = B.x - cx, dz = B.z - cz, d = Math.hypot(dx, dz), min = r + PIN_R;
    if (d >= min || d < 1e-9) continue;
    const nx = dx / d, nz = dz / d;
    // The top moves with the pin plus its toppling sweep.
    const sweep = cx === A.x ? 0 : (PIN_H * 0.8) / TOPPLE * (A.fall < 1 ? 1 : 0);
    const avx = A.vx + A.fx * sweep, avz = A.vz + A.fz * sweep;
    const rel = (avx - B.vx) * nx + (avz - B.vz) * nz;
    if (rel <= 0) continue;
    const j = (1 + E_PIN) * rel / (2 / PIN_M);
    if (B.down || rel > KNOCK) {
      A.vx -= j / PIN_M * nx * (cx === A.x ? 1 : 0.4); A.vz -= j / PIN_M * nz * (cx === A.x ? 1 : 0.4);
      B.vx += j / PIN_M * nx; B.vz += j / PIN_M * nz;
      if (!B.down) knock(B, events, rel);
    } else if (cx === A.x) {
      // A standing pin is a post to a slow one.
      A.vx -= (1 + E_PIN) * rel * nx; A.vz -= (1 + E_PIN) * rel * nz;
    }
    B.x = cx + nx * min; B.z = cz + nz * min;
    if (!B.down) { B.x = PIN_SPOTS[B.i].x; B.z = PIN_SPOTS[B.i].z; }   // a standing pin stays on its spot
  }
}

// Has it all stopped? (The ball's gone or in the pit, the pins have settled.)
export function settled(ball, pins) {
  if (ball && (ball.state === 'lane' || ball.state === 'gutter')) return false;
  return pins.every(p => !p.down || p.gone || (p.fall >= 1 && Math.hypot(p.vx, p.vz) < 0.05));
}

// A whole ball, start to finish (robots and tests). Returns the pins knocked
// down (by index) and the ball's path's end.
export function simulate(stand, shot, opts = {}) {
  const pins = rack(stand);
  const b = launch(shot.x, shot.vx, shot.vz, shot.spin);
  const h = opts.h ?? 1 / 400;
  let t = 0;
  while (t < 6 && !settled(b, pins)) { step(b, pins, h, null, opts); t += h; }
  return { down: pins.filter(p => p.down).map(p => p.i), ball: b, pins, t };
}
