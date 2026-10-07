// A paddle played with a mouse: it sits where you point (on a plane just behind
// your end of the table) and swings by itself when the ball arrives. side = +1
// for the near end (you), -1 for the far end (a friend on a PC).
import * as THREE from 'three';
import { TABLE as TB, predict } from './physics.js';

export const DESK_Z = 1.62;

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
  }

  // Point the paddle at a spot on its plane (world x, y).
  aim(x, y) {
    this.target.set(THREE.MathUtils.clamp(x, -1.1, 1.1), THREE.MathUtils.clamp(y, TB.top + 0.04, 1.6), this.side * DESK_Z);
  }

  // Autoplay helper: go to where the ball will cross the paddle plane.
  plan(ball, key) {
    if (this.planKey === key || this.swing >= 0) return;
    this.planKey = key;
    const s = this.side;
    const q = predict(ball, { maxT: 1.5 }).samples.find(p => p.p.z * s >= 1.5 && p.v.z * s > 0);
    if (q) this.aim(q.p.x, q.p.y);
  }

  // Where a ball waiting to be tossed sits.
  // A little below the paddle, so the toss rises past it and falls back onto it.
  heldPos() { return { x: this.target.x - 0.03 * this.side, y: Math.max(TB.top + 0.1, this.target.y - 0.2), z: this.target.z }; }

  // ctx: { ball, inPlay (live or tossed), due (our ball to hit), tossed (it's our toss) }
  update(dt, { ball = null, inPlay = false, due = false, tossed = false } = {}) {
    const s = this.side, tg = this.target;
    if (this.swing < 0 && ball && inPlay && due) {
      const dz = s * (tg.z - ball.p.z), dx = Math.abs(ball.p.x - tg.x), dy = Math.abs(ball.p.y - tg.y);
      // A toss: swing as it falls back to paddle height. A rally ball: as it arrives.
      const coming = tossed ? ball.v.y < 0 && ball.p.y < tg.y + 0.04 : ball.v.z * s > 0;
      if (coming && dz < 0.42 && dz > -0.05 && dx < 0.32 && dy < 0.35) this.swing = 0;
    }
    // The swing: forward and upwards through the ball, a gentle topspin stroke.
    let fz = 0.12, fy = -0.08;
    if (this.swing >= 0) {
      this.swing += dt / 0.16;
      const t = Math.min(1, this.swing);
      fz = 0.12 - 0.42 * t; fy = -0.08 + 0.18 * t;
      if (this.swing > 1.8) this.swing = -1;
    }
    // The blade centre is 13 cm up the paddle; keep it at the aim point.
    this.outer.position.set(tg.x, tg.y + fy - 0.13, tg.z + s * fz);
    // Face the middle of the far half, tilted open a little (Rz tips the face up).
    const d = new THREE.Vector3(-tg.x * 0.8, 0, -s * 1.2 - tg.z).normalize();
    const phi = Math.atan2(-d.x, -d.z);
    this.outer.rotation.set(0, Math.PI / 2 + phi, 0.28, 'YXZ');
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
    if (!this.valid || dt <= 0) { this.pc.copy(this.c); this.pn.copy(this.n); this.pq.copy(this.q); }
    this.valid = true;
    const k = 1 / Math.max(dt, 1e-3);
    this.vel = { x: (this.c.x - this.pc.x) * k, y: (this.c.y - this.pc.y) * k, z: (this.c.z - this.pc.z) * k };
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
    return { prevC: lerp(this.pc, this.c, f0), c: lerp(this.pc, this.c, f1), prevN: nl(this.pn, this.n, f0), n: nl(this.pn, this.n, f1), vel: this.vel, ang: this.ang };
  }
}
