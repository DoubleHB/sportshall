// Mini golf: draws the holes, runs the ball, and handles turns and the
// scorecard. In VR you swing a real putter (it hangs from your paddle hand's
// pointer); on a screen you pull back from the ball and let go.
import * as THREE from 'three';
import { HOLES, GOLF_BALL_R as R, CUP_R, MAX_STROKES, coursePar } from './course.js';
import * as GP from './physics.js';
import { BladeTracker } from '../desk.js';
import { CanvasBoard, roundRect, FONT, C } from '../panel.js';

const SHAFT = 0.86;                       // pointer to putter head, metres
const SCORE_NAMES = { '-3': 'Albatross!', '-2': 'Eagle!', '-1': 'Birdie!', 0: 'Par', 1: 'Bogey', 2: 'Double bogey' };

export function createGolf(ctx) {
  const { scene, camera, sfx, showBanner, setView, settings, stats, save } = ctx;
  const root = new THREE.Group();
  root.visible = false;
  scene.add(root);

  // ------------------------------------------------------------ materials --
  const felt = (() => {
    const c = document.createElement('canvas'); c.width = c.height = 256;
    const g = c.getContext('2d');
    g.fillStyle = '#2f9e4a'; g.fillRect(0, 0, 256, 256);
    for (let i = 0; i < 3000; i++) { g.fillStyle = `rgba(${Math.random() < 0.5 ? '0,0,0' : '255,255,255'},${Math.random() * 0.05})`; g.fillRect(Math.random() * 256, Math.random() * 256, 2, 2); }
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(3, 3);
    return t;
  })();
  const greenMat = new THREE.MeshStandardMaterial({ map: felt, color: 0xb4d8bb, roughness: 0.95 });   // tinted so it isn't washed out under the hall lights
  const slopeMat = new THREE.MeshStandardMaterial({ color: 0x4fc06a, roughness: 0.95, transparent: true, opacity: 0.55 });
  const wallMat = new THREE.MeshStandardMaterial({ color: 0xb98a55, roughness: 0.7 });
  const capMat = new THREE.MeshStandardMaterial({ color: 0xe9d2a9, roughness: 0.6 });
  const arrowMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.45, depthWrite: false });

  const arrowGeo = (() => {
    const s = new THREE.Shape();
    s.moveTo(0, 0.07); s.lineTo(0.05, 0.0); s.lineTo(0.018, 0.0); s.lineTo(0.018, -0.06); s.lineTo(-0.018, -0.06); s.lineTo(-0.018, 0.0); s.lineTo(-0.05, 0.0); s.closePath();
    return new THREE.ShapeGeometry(s);
  })();
  // A flat arrow on the green at (x, z) pointing along (dx, dz).
  function arrow(x, z, dx, dz) {
    const m = new THREE.Mesh(arrowGeo, arrowMat);
    m.rotation.x = -Math.PI / 2;
    m.rotation.z = Math.atan2(-dx, -dz);      // the shape points along its +y, which lies along -z on the floor
    m.position.set(x, 0.006, z);
    return m;
  }
  const shapeOf = pts => { const s = new THREE.Shape(); pts.forEach(([x, z], i) => (i ? s.lineTo(x, -z) : s.moveTo(x, -z))); s.closePath(); return s; };

  // ------------------------------------------------------------- one hole --
  function buildHole(hole, index) {
    const g = new THREE.Group();
    const green = new THREE.Mesh(new THREE.ShapeGeometry(shapeOf(hole.outline)), greenMat);
    green.rotation.x = -Math.PI / 2; green.position.y = 0.002;
    g.add(green);
    for (const s of hole.slopes ?? []) {
      if (s.kind === 'tilt') {
        const m = new THREE.Mesh(new THREE.ShapeGeometry(shapeOf(s.poly)), slopeMat);
        m.rotation.x = -Math.PI / 2; m.position.y = 0.004;
        g.add(m);
        const xs = s.poly.map(p => p[0]), zs = s.poly.map(p => p[1]);
        const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cz = (Math.min(...zs) + Math.max(...zs)) / 2;
        for (const ox of [-0.3, 0, 0.3]) g.add(arrow(cx + ox, cz, s.a[0], s.a[1]));
      } else if (s.kind === 'bowl') {
        const ring = new THREE.Mesh(new THREE.CircleGeometry(s.r, 48), slopeMat);
        ring.rotation.x = -Math.PI / 2; ring.position.set(s.x, 0.004, s.z);
        g.add(ring);
        for (let k = 0; k < 8; k++) {
          const a = k * Math.PI / 4, rr = s.r * 0.7;
          g.add(arrow(s.x + Math.cos(a) * rr, s.z + Math.sin(a) * rr, -Math.cos(a), -Math.sin(a)));
        }
      }
    }
    // Walls with a pale cap along the top.
    for (const [x0, z0, x1, z1] of GP.prepareHole(hole).segs) {
      const len = Math.hypot(x1 - x0, z1 - z0);
      const w = new THREE.Mesh(new THREE.BoxGeometry(len + 0.04, 0.07, 0.04), wallMat);
      w.position.set((x0 + x1) / 2, 0.035, (z0 + z1) / 2);
      w.rotation.y = -Math.atan2(z1 - z0, x1 - x0);
      const cap = new THREE.Mesh(new THREE.BoxGeometry(len + 0.05, 0.012, 0.05), capMat);
      cap.position.y = 0.04; w.add(cap);
      g.add(w);
    }
    for (const b of hole.bumpers ?? []) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(b.r, b.r, 0.09, 24), new THREE.MeshStandardMaterial({ color: 0xe53946, roughness: 0.4 }));
      post.position.set(b.x, 0.045, b.z);
      const band = new THREE.Mesh(new THREE.CylinderGeometry(b.r + 0.002, b.r + 0.002, 0.025, 24), new THREE.MeshStandardMaterial({ color: 0xffffff }));
      band.position.y = 0.01; post.add(band);
      g.add(post);
    }
    // Tee mat and the cup with its flag.
    const tee = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.22), new THREE.MeshStandardMaterial({ color: 0x1d6b33, roughness: 1 }));
    tee.rotation.x = -Math.PI / 2; tee.position.set(hole.tee[0], 0.005, hole.tee[1]);
    g.add(tee);
    const cup = new THREE.Mesh(new THREE.CircleGeometry(CUP_R, 32), new THREE.MeshBasicMaterial({ color: 0x06090c }));
    cup.rotation.x = -Math.PI / 2; cup.position.set(hole.cup[0], 0.006, hole.cup[1]);
    g.add(cup);
    const rim = new THREE.Mesh(new THREE.RingGeometry(CUP_R, CUP_R + 0.006, 32), new THREE.MeshBasicMaterial({ color: 0xffffff }));
    rim.rotation.x = -Math.PI / 2; rim.position.set(hole.cup[0], 0.007, hole.cup[1]);
    g.add(rim);
    const flagTex = (() => {
      const c = document.createElement('canvas'); c.width = 128; c.height = 96;
      const x = c.getContext('2d');
      x.fillStyle = '#ff3b3b'; x.fillRect(0, 0, 128, 96);
      x.fillStyle = '#fff'; x.font = `900 70px ${FONT}`; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(String(index + 1), 64, 52);
      const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
    })();
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 1.0, 8), new THREE.MeshStandardMaterial({ color: 0xffffff }));
    pole.position.set(hole.cup[0] + CUP_R * 0.45, 0.5, hole.cup[1]);
    g.add(pole);
    const flag = new THREE.Mesh(new THREE.PlaneGeometry(0.22, 0.16), new THREE.MeshBasicMaterial({ map: flagTex, side: THREE.DoubleSide }));
    flag.position.set(0.11, 0.41, 0);
    pole.add(flag);
    // The windmill: a little house over the gap, blades turning in front.
    let blades = null;
    if (hole.windmill) {
      const w = hole.windmill;
      const house = new THREE.Group();
      house.position.set(w.x, 0, w.z - 0.2);
      const red = new THREE.MeshStandardMaterial({ color: 0xc8553d, roughness: 0.7 });
      const white = new THREE.MeshStandardMaterial({ color: 0xf2efe8, roughness: 0.8 });
      for (const s of [-1, 1]) {
        const side = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.75, 0.38), white);
        side.position.set(s * (w.gap + 0.2), 0.375, 0);
        house.add(side);
      }
      const top = new THREE.Mesh(new THREE.BoxGeometry(w.gap * 2 + 0.8, 0.45, 0.38), white);
      top.position.y = 0.75 + 0.225 - 0.25; top.scale.y = 1; top.position.y = 0.97;
      house.add(top);
      const lintel = new THREE.Mesh(new THREE.BoxGeometry(w.gap * 2, 0.55, 0.38), white);
      lintel.position.y = 0.475 + 0.15; house.add(lintel);
      const roof = new THREE.Mesh(new THREE.ConeGeometry(0.75, 0.55, 4), red);
      roof.position.y = 1.47; roof.rotation.y = Math.PI / 4;
      house.add(roof);
      g.add(house);
      blades = new THREE.Group();
      blades.position.set(w.x, 0.62, w.z + 0.04);
      const bladeMat = new THREE.MeshStandardMaterial({ color: 0x8a5a33, roughness: 0.6 });
      for (let k = 0; k < 4; k++) {
        const arm = new THREE.Group();
        const b = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.62, 0.02), bladeMat);
        b.position.y = 0.31;
        arm.add(b); arm.rotation.z = -k * Math.PI / 2;
        blades.add(arm);
      }
      const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.05, 16).rotateX(Math.PI / 2), red);
      blades.add(hub);
      g.add(blades);
    }
    return { group: g, blades };
  }
  const built = HOLES.map((h, i) => { const b = buildHole(h, i); b.group.visible = false; root.add(b.group); return b; });

  // ------------------------------------------------- ball, putter, arrow --
  const ballMesh = new THREE.Mesh(new THREE.SphereGeometry(R, 24, 16), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.3 }));
  root.add(ballMesh);
  const ballShadow = new THREE.Mesh(new THREE.CircleGeometry(R * 1.3, 20), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.35, depthWrite: false }));
  ballShadow.rotation.x = -Math.PI / 2;
  root.add(ballShadow);

  // The putter, built along -Z from its holder (the pointer), face normal +X.
  function makePutter() {
    const g = new THREE.Group();
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, SHAFT - 0.05, 10).rotateX(Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0xcfd6df, metalness: 0.8, roughness: 0.25 }));
    shaft.position.z = -(SHAFT + 0.05) / 2;
    const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.013, 0.011, 0.2, 12).rotateX(Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x15171c, roughness: 0.8 }));
    grip.position.z = 0.05;
    const head = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.11, 0.032), new THREE.MeshStandardMaterial({ color: 0x9aa4b2, metalness: 0.85, roughness: 0.3 }));
    head.position.z = -SHAFT;
    const centre = new THREE.Object3D();
    centre.position.z = -SHAFT;
    g.add(shaft, grip, head, centre);
    return { group: g, centre };
  }
  const putter = makePutter();
  const tracker = new BladeTracker();

  const aimArrow = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ color: 0xffd23f, transparent: true, opacity: 0.85, depthWrite: false }));
  aimArrow.rotation.x = -Math.PI / 2;
  aimArrow.visible = false;
  root.add(aimArrow);
  const aimDots = new THREE.Points(new THREE.BufferGeometry().setFromPoints(new Array(30).fill(0).map(() => new THREE.Vector3())), new THREE.PointsMaterial({ color: 0xffffff, size: 0.02, transparent: true, opacity: 0.7 }));
  aimDots.visible = false; aimDots.frustumCulled = false;
  root.add(aimDots);

  // Scorecard and hole sign.
  const card = new CanvasBoard(1.3, 0.72, 1100, 610);
  root.add(card.mesh);

  // ---------------------------------------------------------------- state --
  const S = {
    players: [], hole: 0, turn: 0, strokes: 0, ball: null, ph: null, t: 0,
    phase: 'idle',     // idle | aim | rolling | between | done
    drag: null, aim: new THREE.Vector2(0, -1), timers: [], camT: null,
  };
  const later = (sec, fn) => S.timers.push({ t: S.t + sec, fn });

  const holeNow = () => HOLES[S.hole];
  const player = () => S.players[S.turn];

  function showHole(i) {
    built.forEach((b, k) => { b.group.visible = k === i; });
    const h = HOLES[i];
    // Card stands to the left of the tee, facing back down the hole.
    card.mesh.position.set(h.tee[0] - 1.25, 1.35, h.tee[1] - 0.2);
    card.mesh.rotation.set(0, 0.45, 0);
  }

  function start(nPlayers = 1) {
    S.players = Array.from({ length: nPlayers }, (_, i) => ({ name: nPlayers === 1 ? 'You' : `Player ${i + 1}`, scores: [] }));
    S.hole = 0; S.timers = [];
    root.visible = true;
    startHole();
  }

  function startHole() {
    showHole(S.hole);
    S.turn = 0;
    S.ph = GP.prepareHole(holeNow());
    startTurn();
  }

  function startTurn() {
    const h = holeNow();
    S.ball = GP.makeGolfBall(h.tee[0], h.tee[1]);
    S.strokes = 0;
    S.phase = 'aim';
    S.aim.set(h.cup[0] - h.tee[0], h.cup[1] - h.tee[1]).normalize();
    const who = S.players.length > 1 ? `${player().name}'s turn` : '';
    showBanner(`Hole ${S.hole + 1}: ${h.name}`, `Par ${h.par}${who ? ` · ${who}` : ''}`, '#2fb8ff', 3);
    goToBall(true);
    drawCard();
  }

  // Stand side-on to the ball, the hole on your lead side (left for a
  // right-hander), the ball just in front of you.
  function goToBall() {
    const b = S.ball, h = holeNow();
    let dx = h.cup[0] - b.x, dz = h.cup[1] - b.z;
    const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
    const right = settings.hand !== 'left';
    const fx = right ? -dz : dz, fz = right ? dx : -dx;     // facing: the hole on your left (right-handers)
    setView({ x: b.x - fx * 0.55, z: b.z - fz * 0.55, th: Math.atan2(-fx, -fz), lift: 0 });
  }

  function onPutt(speed) {
    S.strokes++;
    S.phase = 'rolling';
    sfx.play('putt', { x: S.ball.x, y: R, z: S.ball.z }, Math.min(1, speed / 4));
    ctx.haptic?.(Math.min(1, 0.3 + speed / 6), 30);
    drawCard();
  }

  function finishTurn(sunk) {
    const h = holeNow(), p = player();
    const score = sunk ? S.strokes : MAX_STROKES + 1;
    p.scores[S.hole] = score;
    S.phase = 'between';
    const diff = score - h.par;
    if (sunk && S.strokes === 1) {
      showBanner('HOLE IN ONE!', `${p.name === 'You' ? 'You' : p.name} aced ${h.name}`, '#d4af37', 3.5);
      sfx.play('fanfare'); sfx.play('cheer', null, 1); ctx.cheer?.(2); ctx.confetti?.({ x: h.cup[0], y: 0.3, z: h.cup[1] });
    } else if (sunk) {
      showBanner(SCORE_NAMES[diff] ?? `${diff > 0 ? '+' : ''}${diff}`, `${score} stroke${score > 1 ? 's' : ''} · par ${h.par}`, diff < 0 ? '#58d68d' : diff === 0 ? '#2fb8ff' : '#ff9a5a', 2.6);
      if (diff < 0) { sfx.play('cheer', null, 0.7); ctx.cheer?.(1); }
    } else {
      showBanner('Picked up', `${MAX_STROKES} strokes is the limit: ${score} on this hole`, '#ff5a5a', 2.6);
    }
    drawCard();
    later(3.0, () => {
      if (S.turn + 1 < S.players.length) { S.turn++; showBanner(`${player().name}'s turn`, 'Pass the controls over', '#2fb8ff', 2.5); later(1.2, startTurn); return; }
      if (S.hole + 1 < HOLES.length) { S.hole++; startHole(); return; }
      finishRound();
    });
  }

  function finishRound() {
    S.phase = 'done';
    const totals = S.players.map(p => p.scores.reduce((a, b) => a + b, 0));
    const par = coursePar();
    if (S.players.length === 1) {
      const t = totals[0], best = stats.golfBest;
      const isBest = !best || t < best;
      if (isBest) { stats.golfBest = t; save('sh_stats', stats); }
      showBanner(`Round over: ${t}`, `${t - par === 0 ? 'Level par' : t < par ? `${par - t} under par` : `${t - par} over par`}${isBest ? ' · new best!' : ` · best ${best}`}`, isBest ? '#d4af37' : '#2fb8ff', 5);
      if (isBest || t <= par) { sfx.play('fanfare'); ctx.confetti?.({ x: 0, y: 0.5, z: 0 }); }
    } else {
      const low = Math.min(...totals), winners = S.players.filter((_, i) => totals[i] === low).map(p => p.name);
      showBanner(winners.length > 1 ? 'A tie!' : `${winners[0]} wins!`, S.players.map((p, i) => `${p.name} ${totals[i]}`).join(' · '), '#d4af37', 5);
      sfx.play('fanfare'); sfx.play('cheer', null, 1); ctx.cheer?.(2);
    }
    drawCard();
    later(5.5, () => ctx.roundOver?.());
  }

  // ----------------------------------------------------------- scorecard --
  function drawCard() {
    const g = card.g, w = card.w, h = card.h;
    g.clearRect(0, 0, w, h);
    roundRect(g, 6, 6, w - 12, h - 12, 34);
    g.fillStyle = 'rgba(8,12,22,0.92)'; g.fill();
    g.lineWidth = 5; g.strokeStyle = '#2c3954'; g.stroke();
    const hole = holeNow();
    g.textBaseline = 'middle';
    g.textAlign = 'left'; g.fillStyle = '#58d68d'; g.font = `800 40px ${FONT}`;
    g.fillText(`MINI GOLF · HOLE ${S.hole + 1}`, 40, 56);
    g.textAlign = 'right'; g.fillStyle = C.dim; g.font = `600 32px ${FONT}`;
    g.fillText(`${hole.name} · par ${hole.par}`, w - 40, 56);
    // Grid: names + 6 holes + total.
    const x0 = 230, cw = (w - x0 - 150) / HOLES.length, y0 = 120, rh = 62;
    g.font = `700 28px ${FONT}`; g.fillStyle = C.dim; g.textAlign = 'center';
    HOLES.forEach((hh, i) => { g.fillStyle = i === S.hole ? '#ffd23f' : C.dim; g.fillText(String(i + 1), x0 + cw * (i + 0.5), y0); });
    g.fillStyle = C.dim; g.fillText('Tot', w - 85, y0);
    g.textAlign = 'left'; g.fillText('Par', 40, y0 + rh);
    g.textAlign = 'center';
    HOLES.forEach((hh, i) => g.fillText(String(hh.par), x0 + cw * (i + 0.5), y0 + rh));
    g.fillText(String(coursePar()), w - 85, y0 + rh);
    S.players.forEach((p, k) => {
      const y = y0 + rh * (k + 2);
      if (k === S.turn && S.phase !== 'done') { roundRect(g, 26, y - 26, w - 52, 52, 14); g.fillStyle = '#17284a'; g.fill(); }
      g.textAlign = 'left'; g.fillStyle = '#fff'; g.font = `700 32px ${FONT}`;
      g.fillText(p.name, 40, y);
      g.textAlign = 'center'; g.font = `800 32px ${FONT}`;
      let total = 0;
      HOLES.forEach((hh, i) => {
        const sc = p.scores[i];
        if (sc == null) { if (i === S.hole && k === S.turn && S.strokes) { g.fillStyle = '#9fd8ff'; g.fillText(`(${S.strokes})`, x0 + cw * (i + 0.5), y); } return; }
        total += sc;
        g.fillStyle = sc === 1 ? '#d4af37' : sc < hh.par ? '#7dffa8' : sc === hh.par ? '#fff' : '#ffb4a8';
        g.fillText(String(sc), x0 + cw * (i + 0.5), y);
      });
      g.fillStyle = '#ffd23f'; g.fillText(total ? String(total) : '–', w - 85, y);
    });
    g.textAlign = 'left'; g.fillStyle = C.dim; g.font = `500 26px ${FONT}`;
    g.fillText(ctx.isXR() ? 'Swing the putter · free hand trigger: go to your ball · X/Y: menu' : 'Drag back from the ball and let go to putt · Esc: menu', 40, h - 40);
    card.flush();
  }

  // ------------------------------------------------------------- screen --
  const ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  function groundAt(ndc) {
    ctx.raycaster.setFromCamera(ndc, camera);
    const p = new THREE.Vector3();
    return ctx.raycaster.ray.intersectPlane(ground, p) ? p : null;
  }
  // Pull back from the ball: the putt goes the opposite way to your drag.
  function pointerDown(ndc) {
    if (S.phase !== 'aim') return false;
    const p = groundAt(ndc);
    if (!p) return false;
    S.drag = { start: p.clone(), now: p.clone() };
    return true;
  }
  function pointerMove(ndc) {
    if (!S.drag) return;
    const p = groundAt(ndc);
    if (p) S.drag.now.copy(p);
  }
  function dragShot() {
    if (!S.drag) return null;
    const dx = S.drag.start.x - S.drag.now.x, dz = S.drag.start.z - S.drag.now.z;
    const len = Math.hypot(dx, dz);
    return { dx, dz, speed: Math.min(GP.MAX_PUTT, len * 2.6) };
  }
  function pointerUp() {
    const shot = dragShot();
    S.drag = null; aimArrow.visible = aimDots.visible = false;
    if (!shot || shot.speed < 0.12 || S.phase !== 'aim') return;
    S.aim.set(shot.dx, shot.dz).normalize();
    GP.putt(S.ball, shot.dx, shot.dz, shot.speed);
    onPutt(shot.speed);
  }

  // Screen camera: behind the ball, looking along the aim.
  const camPos = new THREE.Vector3(), camLook = new THREE.Vector3();
  function screenCamera(dt, snap) {
    const b = S.ball;
    if (!b) return;
    if (S.phase === 'aim' && !S.drag) { const h = holeNow(); S.aim.set(h.cup[0] - b.x, h.cup[1] - b.z).normalize(); }
    const tall = window.innerWidth < window.innerHeight;
    const back = tall ? 2.1 : 1.6, up = tall ? 1.9 : 1.35;
    const wantPos = new THREE.Vector3(b.x - S.aim.x * back, up, b.z - S.aim.y * back);
    const wantLook = new THREE.Vector3(b.x + S.aim.x * 1.2, 0, b.z + S.aim.y * 1.2);
    const k = snap ? 1 : Math.min(1, dt * (S.drag ? 0 : 3));
    camPos.lerp(wantPos, k); camLook.lerp(wantLook, k);
    if (snap) { camPos.copy(wantPos); camLook.copy(wantLook); }
    camera.position.copy(camPos);
    camera.lookAt(camLook);
  }

  // --------------------------------------------------------------- frame --
  const evs = [];
  function update(dt, { xr, paused, holder }) {
    if (!root.visible) return;
    // Windmill blades always turn (they're scenery even when paused).
    built.forEach((b, i) => { if (b.blades && i === S.hole) b.blades.rotation.z = -(S.t * HOLES[i].windmill.speed); });
    if (paused) { tracker.invalidate(); return; }
    S.t += dt;
    const due = S.timers.filter(t => t.t <= S.t);
    if (due.length) { S.timers = S.timers.filter(t => t.t > S.t); due.forEach(t => t.fn()); }

    tracker.sample(putter.centre, dt, xr && !!holder && holder.visible);
    const n = Math.max(1, Math.ceil(dt / 0.002)), h = dt / n;
    for (let i = 1; i <= n; i++) {
      const tt = S.t - dt + h * i;
      if (S.phase === 'aim' && tracker.valid) {
        const sp = GP.putterContact(S.ball, tracker.substep((i - 1) / n, i / n));
        if (sp > 0) onPutt(sp);
      }
      if (S.phase === 'rolling') {
        GP.golfStep(S.ball, S.ph, h, tt, evs);
        for (const e of evs) {
          if (e.type === 'wall' || e.type === 'blade') sfx.play('clack', { x: S.ball.x, y: R, z: S.ball.z }, e.speed / 3);
          else if (e.type === 'bumper') sfx.play('clack', { x: S.ball.x, y: R, z: S.ball.z }, e.speed / 2);
          else if (e.type === 'lip') sfx.play('table', { x: S.ball.x, y: R, z: S.ball.z }, 0.4);
          else if (e.type === 'cup') { sfx.play('cup', { x: S.ball.x, y: 0, z: S.ball.z }); finishTurn(true); }
          else if (e.type === 'stop') {
            if (S.strokes >= MAX_STROKES) finishTurn(false);
            else {
              S.phase = 'aim'; drawCard();
              // Bring you to the ball if it's out of reach.
              if (xr) { const v = ctx.viewerXZ(); if (Math.hypot(v.x - S.ball.x, v.z - S.ball.z) > 1.1) later(0.6, goToBall); }
            }
          }
        }
        evs.length = 0;
      }
    }

    // Ball: sinks out of sight once it's in.
    const b = S.ball;
    if (b) {
      ballMesh.visible = ballShadow.visible = !b.sunk;
      ballMesh.position.set(b.x, R + 0.003, b.z);
      ballMesh.rotation.x -= b.vz * dt / R; ballMesh.rotation.z += b.vx * dt / R;
      ballShadow.position.set(b.x + 0.006, 0.0055, b.z + 0.006);
    }
    // Screen aiming: arrow and a dotted preview of the first part of the roll.
    const shot = dragShot();
    if (shot && shot.speed > 0.05) {
      const l = 0.12 + shot.speed * 0.22, ux = shot.dx / Math.hypot(shot.dx, shot.dz), uz = shot.dz / Math.hypot(shot.dx, shot.dz);
      aimArrow.visible = true;
      aimArrow.scale.set(0.035, l, 1);
      aimArrow.position.set(b.x + ux * (l / 2 + 0.04), 0.012, b.z + uz * (l / 2 + 0.04));
      aimArrow.rotation.z = Math.atan2(-ux, -uz);
      aimArrow.material.color.setHex(shot.speed > 4.5 ? 0xff5a5a : shot.speed > 2.5 ? 0xffb03f : 0xffd23f);
      const sim = { ...b }; GP.putt(sim, shot.dx, shot.dz, shot.speed);
      const pts = []; let tt = 0;
      for (let k = 0; k < 30 && sim.moving; k++) { for (let j = 0; j < 20 && sim.moving; j++) { GP.golfStep(sim, S.ph, 0.004, S.t + tt, null); tt += 0.004; } pts.push(new THREE.Vector3(sim.x, 0.02, sim.z)); }
      while (pts.length < 30) pts.push(pts[pts.length - 1] ?? new THREE.Vector3(b.x, 0.02, b.z));
      aimDots.geometry.setFromPoints(pts.slice(0, 12));
      aimDots.visible = true;
    }
    if (!xr) screenCamera(dt, false);
  }

  return {
    putterRig: putter.group,
    get active() { return root.visible; },
    get phase() { return S.phase; },
    get state() { return S; },
    start(n) { start(n); },
    stop() { root.visible = false; S.phase = 'idle'; S.timers = []; S.drag = null; aimArrow.visible = aimDots.visible = false; },
    update, goToBall, pointerDown, pointerMove, pointerUp, drawCard,
    snapCamera() { screenCamera(0, true); },
    inProgress: () => root.visible && S.phase !== 'done' && S.phase !== 'idle',
    // For tests: jump to a hole.
    testJump(i) { S.hole = i; S.timers = []; startHole(); },
    // For tests: putt the ball from the screen in a given direction and speed.
    testPutt(dx, dz, speed) { if (S.phase !== 'aim') return false; GP.putt(S.ball, dx, dz, speed); onPutt(speed); return true; },
  };
}
