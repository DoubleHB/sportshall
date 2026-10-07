// A paddle played with a mouse: it sits where you point (on a plane just behind
// your end of the table) and swings by itself when the ball arrives. side = +1
// for the near end (you), -1 for the far end (a friend on a PC).
import * as THREE from 'three';
import { TABLE as TB, predict } from './physics.js';

export const DESK_Z = 1.62;

// Swing shapes: forward (fz) and up (fy) offsets from start to finish, how open
// the face is (tilt), how long the swing takes, and how far in front it starts.
// A mouse can't do a wrist brush, so `spin` adds what the stroke would give
// (rad/s about x for a ball going away: negative = topspin). Screen only; in
// the headset spin comes purely from how you swing.
export const DESK_STYLES = {
  drive: { fz: [0.12, -0.30], fy: [-0.08, 0.10], tilt: 0.28, time: 0.16, reach: 0.42, cross: 1.5, spin: 0 },
  topspin: { fz: [0.12, -0.30], fy: [-0.10, 0.14], tilt: 0.14, time: 0.16, reach: 0.42, cross: 1.5, spin: -150 },
  push: { fz: [0.02, -0.62], fy: [0.05, -0.04], tilt: 1.05, time: 0.24, reach: 0.85, cross: 1.05, spin: 75 },
  // A proper serve: chop down and forward so it bounces on your side first.
  serve: { fz: [0.10, -0.30], fy: [0.08, -0.12], tilt: -0.25, time: 0.14, reach: 0.42, cross: 1.5, spin: 0 },
};

export class DeskPaddle {
  constructor(side = 1) {
    this.side = side;
    this.outer = new THREE.Group();
    this.inner = new THREE.Group();
    this.inner.rotation.x = Math.PI / 2;     // grip space -Z (the blade) points up
    this.outer.add(this.inner);
    this.target = new THREE.Vector3(0.25 * side, 1.0, side * DESK_Z);
    this.swing = -1;
    this.planKey = null;
    this.style = 'drive';
  }
  get S() { return DESK_STYLES[this.style] ?? DESK_STYLES.drive; }

  // Point the paddle at a spot on its plane (world x, y).
  aim(x, y) {
    this.target.set(THREE.MathUtils.clamp(x, -1.1, 1.1), THREE.MathUtils.clamp(y, TB.top + 0.04, 1.6), this.side * DESK_Z);
  }

  // Autoplay helper: go to where the ball will cross the paddle plane.
  plan(ball, key) {
    if (this.planKey === key || this.swing >= 0) return;
    this.planKey = key;
    const s = this.side;
    const cross = this.S.cross;
    const q = predict(ball, { maxT: 1.5 }).samples.find(p => p.p.z * s >= cross && p.v.z * s > 0);
    if (q) this.aim(q.p.x, q.p.y);
  }

  // Where a ball waiting to be tossed sits.
  // A little below the paddle, so the toss rises past it and falls back onto it.
  heldPos() { return { x: this.target.x - 0.03 * this.side, y: Math.max(TB.top + 0.1, this.target.y - 0.2), z: this.target.z }; }

  // ctx: { ball, inPlay (live or tossed), due (our ball to hit), tossed (it's our toss) }
  // properServe: the toss is hit with the downward serve stroke.
  update(dt, { ball = null, inPlay = false, due = false, tossed = false, properServe = false } = {}) {
    const s = this.side, tg = this.target;
    const S = tossed ? DESK_STYLES[properServe ? 'serve' : 'drive'] : this.S;
    if (this.swing < 0 && ball && inPlay && due) {
      const dz = s * (tg.z - ball.p.z), dx = Math.abs(ball.p.x - tg.x), dy = Math.abs(ball.p.y - tg.y);
      // A toss: swing as it falls back to paddle height. A rally ball: as it arrives.
      const coming = tossed ? ball.v.y < 0 && ball.p.y < tg.y + 0.04 : ball.v.z * s > 0;
      if (coming && dz < S.reach && dz > -0.05 && dx < 0.32 && dy < 0.35) this.swing = 0;
    }
    // The swing (see DESK_STYLES): by default forward and a little upwards.
    let fz = S.fz[0], fy = S.fy[0];
    if (this.swing >= 0) {
      this.swing += dt / S.time;
      const t = Math.min(1, this.swing);
      fz = S.fz[0] + (S.fz[1] - S.fz[0]) * t; fy = S.fy[0] + (S.fy[1] - S.fy[0]) * t;
      if (this.swing > 1.8) this.swing = -1;
    }
    // The blade centre is 13 cm up the paddle; keep it at the aim point.
    this.outer.position.set(tg.x, tg.y + fy - 0.13, tg.z + s * fz);
    // Face the middle of the far half, tilted open a little (Rz tips the face up).
    const d = new THREE.Vector3(-tg.x * 0.8, 0, -s * 1.2 - tg.z).normalize();
    const phi = Math.atan2(-d.x, -d.z);
    this.outer.rotation.set(0, Math.PI / 2 + phi, S.tilt, 'YXZ');
  }

  get swingPhase() { return this.swing; }
}

// Tracks a paddle's blade from frame to frame (position, face normal, linear and
// angular velocity) for the swept collision in physics.js.
export class BladeTracker {
  constructor() {
    this.valid = false;
    this.c = new THREE.Vector3(); this.n = new THREE.Vector3(); this.q = new THREE.Quaternion();
    this.pc = new THREE.Vector3(); this.pn = new THREE.Vector3(); this.pq = new THREE.Quaternion();
    this.vel = { x: 0, y: 0, z: 0 }; this.ang = { x: 0, y: 0, z: 0 };
    this._dq = new THREE.Quaternion();
    this.power = 1;     // scales the swing speed the ball feels
    this.smooth = 0;    // 0..0.9: blend in last frame's speed to calm tracking jitter
  }
  invalidate() { this.valid = false; }
  // centre: the paddle's blade-centre Object3D (its +X is the face normal).
  sample(centre, dt, ok = true) {
    if (!ok) { this.valid = false; return; }
    this.pc.copy(this.c); this.pn.copy(this.n); this.pq.copy(this.q);
    centre.updateWorldMatrix(true, false);
    centre.getWorldPosition(this.c);
    centre.getWorldQuaternion(this.q);
    this.n.set(1, 0, 0).applyQuaternion(this.q);
    const fresh = !this.valid || dt <= 0;
    if (fresh) { this.pc.copy(this.c); this.pn.copy(this.n); this.pq.copy(this.q); }
    this.valid = true;
    const k = 1 / Math.max(dt, 1e-3);
    const raw = { x: (this.c.x - this.pc.x) * k, y: (this.c.y - this.pc.y) * k, z: (this.c.z - this.pc.z) * k };
    const sm = fresh ? 0 : this.smooth;
    this.vel = { x: raw.x + (this.vel.x - raw.x) * sm, y: raw.y + (this.vel.y - raw.y) * sm, z: raw.z + (this.vel.z - raw.z) * sm };
    const dq = this._dq.copy(this.q).multiply(this.pq.clone().invert());
    if (dq.w < 0) { dq.x = -dq.x; dq.y = -dq.y; dq.z = -dq.z; dq.w = -dq.w; }
    const angle = 2 * Math.acos(Math.min(1, dq.w));
    const s = Math.sqrt(Math.max(1 - dq.w * dq.w, 1e-9));
    this.ang = angle < 1e-5 ? { x: 0, y: 0, z: 0 } : { x: dq.x / s * angle * k, y: dq.y / s * angle * k, z: dq.z / s * angle * k };
  }
  // The blade at fraction f0 -> f1 of this frame, for one physics substep.
  substep(f0, f1) {
    const lerp = (a, b, f) => ({ x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f, z: a.z + (b.z - a.z) * f });
    const nl = (a, b, f) => { const v = lerp(a, b, f), l = Math.hypot(v.x, v.y, v.z) || 1; return { x: v.x / l, y: v.y / l, z: v.z / l }; };
    const p = this.power, v = this.vel, a = this.ang;
    return {
      prevC: lerp(this.pc, this.c, f0), c: lerp(this.pc, this.c, f1), prevN: nl(this.pn, this.n, f0), n: nl(this.pn, this.n, f1),
      vel: { x: v.x * p, y: v.y * p, z: v.z * p }, ang: { x: a.x * p, y: a.y * p, z: a.z * p },
    };
  }
}
