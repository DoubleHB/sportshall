// Extras: confetti, the robot's speech bubble, the champion's trophy and a
// simple human avatar (for two-player games).
import * as THREE from 'three';
import { TABLE } from './physics.js';
import { CanvasBoard, roundRect, FONT } from './panel.js';

// ----------------------------------------------------------------- confetti --
export function createConfetti(scene, max = 420) {
  const mesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.035, 0.02), new THREE.MeshBasicMaterial({ side: THREE.DoubleSide, toneMapped: false }), max);
  mesh.frustumCulled = false;
  const colors = [0xff3b5c, 0xffd23f, 0x2fb8ff, 0x58d68d, 0xb057ff, 0xff8c42, 0xffffff];
  const parts = [];
  const col = new THREE.Color(), m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), p = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1), zero = new THREE.Vector3();
  for (let i = 0; i < max; i++) {
    parts.push({ live: 0, p: new THREE.Vector3(), v: new THREE.Vector3(), r: new THREE.Vector3(), rv: new THREE.Vector3() });
    mesh.setColorAt(i, col.setHex(colors[i % colors.length]));
    mesh.setMatrixAt(i, m.compose(p, q, zero));
  }
  scene.add(mesh);
  let next = 0, active = false;
  return {
    // Shoot `n` pieces up and out from `origin` ({x,y,z}).
    burst(origin, n = 200, power = 1) {
      for (let k = 0; k < n; k++) {
        const c = parts[next]; next = (next + 1) % max;
        c.live = 3.5 + Math.random() * 1.5;
        c.p.set(origin.x + (Math.random() - 0.5) * 0.3, origin.y, origin.z + (Math.random() - 0.5) * 0.3);
        const a = Math.random() * Math.PI * 2, out = (0.6 + Math.random() * 1.6) * power;
        c.v.set(Math.cos(a) * out, (3 + Math.random() * 3) * power, Math.sin(a) * out);
        c.r.set(Math.random() * 6, Math.random() * 6, Math.random() * 6);
        c.rv.set((Math.random() - 0.5) * 14, (Math.random() - 0.5) * 14, (Math.random() - 0.5) * 14);
      }
      active = true;
    },
    update(dt) {
      if (!active) return;
      let any = false;
      parts.forEach((c, i) => {
        if (c.live <= 0) return;
        c.live -= dt;
        // Paper flutters: strong drag, a little sideways wobble.
        c.v.y -= 6 * dt;
        c.v.multiplyScalar(Math.pow(0.12, dt));
        c.v.x += Math.sin(c.live * 7 + i) * 0.6 * dt;
        c.p.addScaledVector(c.v, dt);
        if (c.p.y < 0.01) { c.p.y = 0.01; c.v.set(0, 0, 0); c.rv.set(0, 0, 0); }
        c.r.addScaledVector(c.rv, dt);
        const s = c.live > 0.5 ? 1 : Math.max(0, c.live * 2);
        mesh.setMatrixAt(i, m.compose(c.p, q.setFromEuler(e.set(c.r.x, c.r.y, c.r.z)), p.set(s, s, s)));
        if (c.live <= 0) mesh.setMatrixAt(i, m.compose(c.p, q, zero));
        any = true;
      });
      mesh.instanceMatrix.needsUpdate = true;
      active = any;
    },
  };
}

// ------------------------------------------------------------ speech bubble --
export function createBubble(scene) {
  const board = new CanvasBoard(1.15, 0.39, 960, 324);
  board.mesh.renderOrder = 9;
  board.mesh.material.depthTest = false;
  board.mesh.visible = false;
  scene.add(board.mesh);
  let left = 0;
  return {
    mesh: board.mesh,
    say(text, accent = '#ff7a1a', secs = null) {
      const g = board.g, w = board.w, h = board.h;
      g.clearRect(0, 0, w, h);
      // Wrap into at most three lines.
      g.font = `700 68px ${FONT}`;
      const words = text.split(' '), lines = [];
      let line = '';
      for (const word of words) {
        const tryLine = line ? `${line} ${word}` : word;
        if (g.measureText(tryLine).width > w - 110 && line) { lines.push(line); line = word; } else line = tryLine;
      }
      lines.push(line);
      const shown = lines.slice(0, 3);
      const bh = 40 + shown.length * 78;
      const top = h - 50 - bh;
      roundRect(g, 14, top, w - 28, bh, 40);
      g.fillStyle = '#ffffff'; g.fill();
      g.lineWidth = 8; g.strokeStyle = accent; g.stroke();
      // Tail pointing down and left, at the speaker's head.
      const tx = w * 0.18;
      g.beginPath(); g.moveTo(tx + 10, top + bh - 4); g.lineTo(tx - 50, h - 6); g.lineTo(tx + 70, top + bh - 4); g.closePath();
      g.fillStyle = '#ffffff'; g.fill();
      g.beginPath(); g.moveTo(tx + 10, top + bh); g.lineTo(tx - 50, h - 6); g.lineTo(tx + 70, top + bh);
      g.stroke();
      g.fillStyle = '#141a28'; g.textAlign = 'center'; g.textBaseline = 'middle';
      shown.forEach((l, i) => g.fillText(l, w / 2, top + 58 + i * 78));
      board.flush();
      left = secs ?? Math.min(5, 1.8 + text.length * 0.05);
      board.mesh.visible = true;
      board.mesh.material.opacity = 1;
    },
    // At once: a bubble that stops being updated (its robot leaves) would hang there.
    hide() { left = 0; board.mesh.visible = false; },
    // anchor: where the bubble sits (above the robot's head); camQuat: face the viewer.
    update(dt, anchor, camQuat) {
      if (!board.mesh.visible) return;
      left -= dt;
      const mat = board.mesh.material;
      if (left < 0) { mat.opacity -= dt * 3; if (mat.opacity <= 0) board.mesh.visible = false; }
      if (anchor) board.mesh.position.copy(anchor);
      if (camQuat) board.mesh.quaternion.copy(camQuat);
    },
  };
}

// ------------------------------------------------------------------ trophy --
export function buildTrophy() {
  const g = new THREE.Group();
  const gold = new THREE.MeshStandardMaterial({ color: 0xd4af37, metalness: 0.9, roughness: 0.22 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x1b2233, roughness: 0.6 });
  const plinth = new THREE.Mesh(new THREE.BoxGeometry(0.4, 1.0, 0.4), dark);
  plinth.position.y = 0.5; g.add(plinth);
  const cup = new THREE.Group();
  cup.position.y = 1.0; g.add(cup);
  const profile = [[0, 0], [0.09, 0], [0.09, 0.02], [0.03, 0.04], [0.025, 0.14], [0.05, 0.17], [0.11, 0.22], [0.13, 0.32], [0.125, 0.33], [0.1, 0.24], [0, 0.2]].map(([x, y]) => new THREE.Vector2(x, y));
  cup.add(new THREE.Mesh(new THREE.LatheGeometry(profile, 40), gold));
  for (const s of [-1, 1]) {
    const handle = new THREE.Mesh(new THREE.TorusGeometry(0.06, 0.012, 10, 24, Math.PI), gold);
    handle.position.set(s * 0.125, 0.26, 0);
    handle.rotation.z = s * -Math.PI / 2;
    cup.add(handle);
  }
  const star = new THREE.Mesh(new THREE.OctahedronGeometry(0.035), new THREE.MeshBasicMaterial({ color: 0xfff3b0 }));
  star.position.y = 0.42; cup.add(star);
  return { root: g, update(dt) { cup.rotation.y += dt * 0.6; star.rotation.y -= dt * 2; } };
}

// ------------------------------------------------------------ human avatar --
// A friendly figure: head (optionally wearing a headset), body, legs and an arm
// reaching for the paddle hand. Its face looks along +z of the head.
export function buildHuman({ shirt = 0x2a9df4, skin = 0xf1c6a7, hair = 0x3b2a1e, trousers = 0x22283a, headset = false } = {}) {
  const root = new THREE.Group();
  const shirtM = new THREE.MeshStandardMaterial({ color: shirt, roughness: 0.7 });
  const skinM = new THREE.MeshStandardMaterial({ color: skin, roughness: 0.6 });
  const hairM = new THREE.MeshStandardMaterial({ color: hair, roughness: 0.8 });
  const legM = new THREE.MeshStandardMaterial({ color: trousers, roughness: 0.8 });
  const darkM = new THREE.MeshStandardMaterial({ color: 0x111318, roughness: 0.3, metalness: 0.4 });

  const head = new THREE.Group();
  head.add(new THREE.Mesh(new THREE.SphereGeometry(0.11, 24, 18), skinM));
  const cap = new THREE.Mesh(new THREE.SphereGeometry(0.115, 24, 12, 0, Math.PI * 2, 0, Math.PI * 0.45), hairM);
  cap.rotation.x = -0.35; head.add(cap);
  if (headset) {
    const hs = new THREE.Mesh(new THREE.BoxGeometry(0.19, 0.095, 0.1), new THREE.MeshStandardMaterial({ color: 0xf2f4f8, roughness: 0.35 }));
    hs.position.set(0, 0.01, 0.1); head.add(hs);
    const face = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.07, 0.01), darkM);
    face.position.set(0, 0.01, 0.152); head.add(face);
    const strap = new THREE.Mesh(new THREE.TorusGeometry(0.115, 0.012, 8, 30), darkM);
    strap.rotation.x = Math.PI / 2; strap.position.y = 0.02; head.add(strap);
  } else {
    for (const s of [-1, 1]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.014, 10, 8), darkM);
      eye.position.set(s * 0.04, 0.015, 0.1); head.add(eye);
    }
    const smile = new THREE.Mesh(new THREE.TorusGeometry(0.03, 0.006, 6, 16, Math.PI), darkM);
    smile.rotation.z = Math.PI; smile.position.set(0, -0.035, 0.1); head.add(smile);
  }
  root.add(head);

  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.16, 0.36, 6, 16), shirtM);
  root.add(torso);
  const legs = [-1, 1].map(() => { const l = new THREE.Mesh(new THREE.CapsuleGeometry(0.065, 1, 4, 10), legM); root.add(l); return l; });
  const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.035, 1, 10).translate(0, 0.5, 0), shirtM);
  const hand = new THREE.Mesh(new THREE.SphereGeometry(0.045, 12, 10), skinM);
  const otherArm = new THREE.Mesh(new THREE.CapsuleGeometry(0.04, 0.5, 4, 8), shirtM);
  root.add(arm, hand, otherArm);

  const up = new THREE.Vector3(0, 1, 0), tmp = new THREE.Vector3(), sh = new THREE.Vector3(), q = new THREE.Quaternion(), yawQ = new THREE.Quaternion();
  return {
    root,
    // headPos {x,y,z}; headQuat: THREE.Quaternion (face along +z) or null; yaw used for the body.
    set(headPos, headQuat, handPos) {
      head.position.set(headPos.x, headPos.y, headPos.z);
      if (headQuat) head.quaternion.copy(headQuat);
      const f = tmp.set(0, 0, 1).applyQuaternion(head.quaternion); f.y = 0;
      const yaw = Math.atan2(f.x, f.z);
      yawQ.setFromAxisAngle(up, yaw);
      const back = 0.06;
      torso.position.set(headPos.x - Math.sin(yaw) * back, headPos.y - 0.47, headPos.z - Math.cos(yaw) * back);
      torso.quaternion.copy(yawQ);
      const hipY = Math.max(0.3, torso.position.y - 0.32);
      legs.forEach((l, i) => {
        const side = i ? 1 : -1;
        l.position.set(torso.position.x + Math.cos(yaw) * side * 0.08, hipY / 2, torso.position.z - Math.sin(yaw) * side * 0.08);
        l.scale.set(1, Math.max(0.2, hipY - 0.1), 1);
      });
      // Paddle arm from the shoulder nearest the hand; the other arm hangs.
      const right = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
      const hp = handPos ?? { x: torso.position.x + right.x * 0.3, y: torso.position.y - 0.1, z: torso.position.z + right.z * 0.3 };
      const side = (hp.x - torso.position.x) * right.x + (hp.z - torso.position.z) * right.z >= 0 ? 1 : -1;
      sh.copy(torso.position).addScaledVector(right, side * 0.2).setY(torso.position.y + 0.2);
      hand.position.set(hp.x, hp.y, hp.z);
      tmp.copy(hand.position).sub(sh);
      arm.position.copy(sh);
      arm.scale.set(1, Math.max(0.05, tmp.length()), 1);
      arm.quaternion.copy(q.setFromUnitVectors(up, tmp.normalize()));
      otherArm.position.copy(torso.position).addScaledVector(right, -side * 0.21).setY(torso.position.y - 0.05);
      otherArm.quaternion.copy(yawQ);
    },
  };
}

// ---------------------------------------------------- stroke demonstrator --
// Key poses for each stroke, for a right-hander standing at (0, z 1.97): the
// blade centre p, the face normal n and the direction the blade points (up).
const K = (p, n, up) => ({ p: new THREE.Vector3(...p), n: new THREE.Vector3(...n).normalize(), up: new THREE.Vector3(...up).normalize() });
export const STROKES = {
  forehand: [K([0.55, 0.9, 2.0], [-0.25, 0.1, -1], [0.45, 0.85, 0.25]), K([0.4, 1.0, 1.68], [0, 0, -1], [0.3, 0.95, 0]), K([0.08, 1.25, 1.42], [0.35, -0.15, -1], [-0.1, 0.95, -0.35])],
  backhand: [K([0.0, 0.95, 1.78], [0.3, 0.1, -1], [-0.95, 0.3, 0]), K([-0.18, 1.0, 1.6], [0, 0, -1], [-0.8, 0.55, -0.1]), K([-0.4, 1.12, 1.42], [-0.35, 0, -1], [-0.6, 0.75, -0.25])],
  topspin: [K([0.55, 0.72, 1.95], [0, -0.4, -1], [0.45, 0.85, 0.25]), K([0.42, 0.98, 1.68], [0.05, -0.35, -1], [0.25, 0.95, 0]), K([0.15, 1.45, 1.5], [0.3, -0.5, -1], [-0.1, 0.95, -0.3])],
  push: [K([0.1, 1.02, 1.72], [0, 0.85, -0.55], [0.2, 0.55, -0.8]), K([0.06, 0.97, 1.52], [0, 0.85, -0.55], [0.2, 0.55, -0.8]), K([0.03, 0.92, 1.32], [0, 0.8, -0.6], [0.2, 0.6, -0.8])],
  serve: [K([0.32, 1.08, 1.88], [0, -0.35, -1], [0.5, 0.8, 0.2]), K([0.15, 0.95, 1.75], [0, -0.45, -1], [0.35, 0.9, 0]), K([-0.02, 0.9, 1.55], [0.1, -0.5, -1], [0.2, 0.95, -0.2])],
};

export function createGhost(scene, makePaddleFn) {
  const mat = new THREE.MeshBasicMaterial({ color: 0x7fe9ff, transparent: true, opacity: 0.5, depthWrite: false });
  const pad = makePaddleFn();
  pad.group.traverse(o => { if (o.isMesh) o.material = mat; });
  pad.group.visible = false;
  scene.add(pad.group);
  const ballMat = new THREE.MeshBasicMaterial({ color: 0xffc27a, transparent: true, opacity: 0.7, depthWrite: false });
  const ball = new THREE.Mesh(new THREE.SphereGeometry(0.02, 16, 12), ballMat);
  ball.visible = false;
  scene.add(ball);
  const N = 40;
  const trailGeo = new THREE.BufferGeometry().setFromPoints(new Array(N).fill(0).map(() => new THREE.Vector3()));
  const trailMat = new THREE.LineDashedMaterial({ color: 0x7fe9ff, dashSize: 0.03, gapSize: 0.025, transparent: true, opacity: 0.8 });
  const trail = new THREE.Line(trailGeo, trailMat);
  trail.visible = false; trail.frustumCulled = false;
  scene.add(trail);

  const LEAD = 0.9, SWING = 0.5, FOLLOW = 0.6, FADE = 0.4, CYCLE = LEAD + SWING + FOLLOW + FADE;
  let keys = null, curve = null, stroke = null, t = 0, loops = 0;
  const m = new THREE.Matrix4(), X = new THREE.Vector3(), Y = new THREE.Vector3(), Z = new THREE.Vector3(), n = new THREE.Vector3(), up = new THREE.Vector3();
  const C = new THREE.Vector3(), tmp = new THREE.Vector3();

  function poseAt(u) {
    const p = curve.getPoint(u);
    const [a, b, f] = u < 0.5 ? [keys[0], keys[1], u * 2] : [keys[1], keys[2], (u - 0.5) * 2];
    n.lerpVectors(a.n, b.n, f).normalize();
    up.lerpVectors(a.up, b.up, f);
    up.addScaledVector(n, -up.dot(n)).normalize();
    X.copy(n); Z.copy(up).negate(); Y.crossVectors(Z, X);
    m.makeBasis(X, Y, Z);
    pad.group.quaternion.setFromRotationMatrix(m);
    pad.group.position.copy(p).addScaledVector(up, -0.13);
  }

  return {
    get playing() { return loops > 0; },
    // Play a stroke `count` times, shifted to where you stand (dx, dz) and
    // mirrored for a left-hander.
    play(name, { dx = 0, dz = 0, left = false, count = 2 } = {}) {
      const s = left ? -1 : 1;
      stroke = name;
      keys = STROKES[name].map(k => ({
        p: new THREE.Vector3(k.p.x * s + dx, k.p.y, k.p.z + dz),
        n: new THREE.Vector3(k.n.x * s, k.n.y, k.n.z),
        up: new THREE.Vector3(k.up.x * s, k.up.y, k.up.z),
      }));
      curve = new THREE.CatmullRomCurve3(keys.map(k => k.p));
      C.copy(keys[1].p).addScaledVector(keys[1].n, 0.03);
      const pts = curve.getPoints(N - 1);
      trailGeo.setFromPoints(pts);
      trail.computeLineDistances();
      t = 0; loops = count;
    },
    stop() { loops = 0; pad.group.visible = ball.visible = trail.visible = false; },
    update(dt) {
      if (loops <= 0) return;
      t += dt;
      if (t >= CYCLE) { t -= CYCLE; loops--; if (loops <= 0) { this.stop(); return; } }
      pad.group.visible = ball.visible = trail.visible = true;
      const fade = t < 0.25 ? t / 0.25 : t > CYCLE - FADE ? Math.max(0, (CYCLE - t) / FADE) : 1;
      mat.opacity = 0.5 * fade; ballMat.opacity = 0.75 * fade; trailMat.opacity = 0.8 * fade;
      const u = Math.min(1, Math.max(0, (t - LEAD) / SWING));
      poseAt(u);
      // The ghost ball reaches the paddle at the middle of the swing.
      const hitT = LEAD + SWING / 2;
      if (stroke === 'serve') {
        if (t < hitT) {             // tossed up from the hand, falling back to the paddle
          const k = t / hitT, h = 0.32 * Math.sin(Math.PI * Math.min(1, k * 1.15));
          ball.position.set(C.x - 0.04, 0.86 + (C.y - 0.86) * k + h, C.z + 0.02);
        } else {                    // down onto your own half, then away
          const k = Math.min(1, (t - hitT) / 0.6);
          ball.position.set(C.x - 0.08 * k, C.y + (0.78 - C.y) * k, C.z - 0.75 * k);
        }
      } else {
        const inFrom = tmp.set(C.x * 0.6, C.y + (stroke === 'push' ? 0.12 : 0.28), C.z - (stroke === 'push' ? 0.9 : 1.4));
        if (t < hitT) {
          const k = Math.max(0, 1 - (hitT - t) / 0.55);
          ball.position.lerpVectors(inFrom, C, k);
          ball.position.y += Math.sin(Math.PI * k) * 0.08;
          ball.visible = k > 0;
        } else {
          const k = Math.min(1, (t - hitT) / 0.6);
          ball.position.set(C.x * (1 - 0.6 * k), C.y + Math.sin(Math.PI * k) * 0.25, C.z - 1.9 * k);
        }
      }
    },
  };
}

export const FLIP = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI);
export { TABLE };
