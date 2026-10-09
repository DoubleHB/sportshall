// Headless tests for the mini golf course and ball physics.
import test from 'node:test';
import assert from 'node:assert/strict';
import { HOLES, TRICK, COURSES, wallsOf, pointInPoly, coursePar, CUP_R } from '../src/golf/course.js';
import { makeGolfBall, prepareHole, putt, rollOut, golfStep, windmillBlocked, putterContact, slopeAccel, ROLL_DECEL, speedOf, loopSpeed, sliderAt } from '../src/golf/physics.js';
import { planPutt, playHole, golfSkill, wobble, simulateRound, CUP_COURSES } from '../src/golf/ai.js';
import { rng32 } from './sim.mjs';

test('every hole: tee and cup inside the walls, par 2-3', () => {
  for (const h of HOLES) {
    assert.ok(pointInPoly(h.tee[0], h.tee[1], h.outline), `${h.name} tee`);
    assert.ok(pointInPoly(h.cup[0], h.cup[1], h.outline), `${h.name} cup`);
    assert.ok(h.par >= 2 && h.par <= 3);
    assert.ok(wallsOf(h).length >= 4);
  }
  assert.equal(coursePar(), 15);
});

test('a ball rolls to a stop at the rate of rolling friction', () => {
  const ph = prepareHole(HOLES[0]);
  const b = makeGolfBall(0, 1.8);
  putt(b, 0, -1, 1.2);
  const r = rollOut(ph, b);
  const dist = 1.8 - r.z;
  const expected = 1.2 * 1.2 / (2 * ROLL_DECEL);
  assert.ok(Math.abs(dist - expected) < 0.05, `rolled ${dist} expected ${expected}`);
});

test('the right putt drops on the straight hole; a rocket lips out', () => {
  const ph = prepareHole(HOLES[0]);
  const d = 3.6;
  const ok = rollOut(ph, (() => { const b = makeGolfBall(0, 1.8); putt(b, 0, -1, Math.sqrt(2 * ROLL_DECEL * d) + 0.2); return b; })());
  assert.ok(ok.sunk);
  const fast = rollOut(ph, (() => { const b = makeGolfBall(0, 1.8); putt(b, 0, -1, 5); return b; })(), { rng: rng32(1) });
  assert.ok(fast.events.some(e => e.type === 'lip'));
});

test('walls keep the ball on the green (both courses)', () => {
  const rng = rng32(3);
  for (const h of [...HOLES, ...TRICK]) {
    const ph = prepareHole(h);
    for (let i = 0; i < 12; i++) {
      const b = makeGolfBall(h.tee[0], h.tee[1]);
      const a = rng() * Math.PI * 2;
      putt(b, Math.cos(a), Math.sin(a), 1 + rng() * 4.5);
      const r = rollOut(ph, b, { rng });
      assert.ok(r.sunk || r.ball.hazard || pointInPoly(r.x, r.z, h.outline), `${h.name}: ended at ${r.x.toFixed(2)},${r.z.toFixed(2)}`);
      assert.ok(!r.ball.moving || h.sliders || h.spinners, `${h.name}: still rolling after 15 s`);
    }
  }
});

test('the hill needs a firm putt; the bowl funnels to the cup', () => {
  const hill = prepareHole(HOLES[3]);
  const soft = rollOut(hill, (() => { const b = makeGolfBall(0, 2.1); putt(b, 0, -1, 1.6); return b; })());
  assert.ok(soft.z > 0, 'a soft putt rolls back down the hill');
  const firm = rollOut(hill, (() => { const b = makeGolfBall(0, 2.1); putt(b, 0, -1, 3.0); return b; })(), { rng: rng32(2) });
  assert.ok(firm.z < -0.6 || firm.sunk, `firm putt got over: ${firm.z}`);
  const bowl = HOLES[5];
  const [ax, az] = slopeAccel(bowl, 0.6, -0.85);
  assert.ok(ax < 0 && Math.abs(az) < 1e-6);
  // A decent putt (aimed within 6 degrees, about the right strength) usually
  // drops, but not always.
  const ph = prepareHole(bowl);
  let sunk = 0;
  const rng = rng32(8);
  const ideal = Math.sqrt(2 * ROLL_DECEL * 2.85);
  for (let i = 0; i < 40; i++) {
    const b = makeGolfBall(0, 2.0);
    const ang = -Math.PI / 2 + (rng() - 0.5) * 0.2;
    putt(b, Math.cos(ang), Math.sin(ang), ideal * (0.95 + rng() * 0.35));
    if (rollOut(ph, b, { rng }).sunk) sunk++;
  }
  assert.ok(sunk >= 16 && sunk <= 36, `${sunk}/40 sunk in the bowl`);
});

test('the windmill opens and shuts', () => {
  const w = HOLES[4].windmill;
  let open = 0, shut = 0;
  for (let t = 0; t < 10; t += 0.01) (windmillBlocked(w, t) ? shut++ : open++);
  assert.ok(shut > 200 && open > 400, `${shut} shut / ${open} open`);
});

const trick = name => prepareHole(TRICK.find(h => h.name === name));
const from = (hole, speed, dx = 0, dz = -1) => { const b = makeGolfBall(hole.hole.tee[0], hole.hole.tee[1]); putt(b, dx, dz, speed); return b; };

test('trickshot: every hole is sound and par 18', () => {
  for (const h of TRICK) {
    assert.ok(pointInPoly(h.tee[0], h.tee[1], h.outline), `${h.name} tee`);
    assert.ok(pointInPoly(h.cup[0], h.cup[1], h.outline), `${h.name} cup`);
  }
  assert.equal(coursePar(TRICK), 18);
  assert.equal(COURSES.trick.holes, TRICK);
});

test('trickshot: the loop needs pace; too slow rolls back', () => {
  const ph = trick('Loop the Loop');
  const need = loopSpeed(0.2);
  // Pace to arrive at the loop with a bit to spare (1.75 m of green first).
  const fast = rollOut(ph, from(ph, Math.sqrt((need + 0.4) ** 2 + 2 * ROLL_DECEL * 1.75)), { rng: rng32(1) });
  assert.ok(fast.events.some(e => e.type === 'loop' && e.pass), 'made it round');
  assert.ok(fast.z < 0.1 || fast.sunk);
  const slow = rollOut(ph, from(ph, 2.4), { rng: rng32(1) });
  assert.ok(slow.events.some(e => e.type === 'loop' && !e.pass), 'rolled back');
  assert.ok(slow.z > 0.25);
});

test('trickshot: the jump clears the pit with pace and drops in short', () => {
  const ph = trick('The Jump');
  const big = rollOut(ph, from(ph, 4.2), { rng: rng32(2) });
  assert.ok(big.events.some(e => e.type === 'jump'));
  assert.ok(!big.events.some(e => e.type === 'hazard'), JSON.stringify(big.events.map(e => e.type)));
  assert.ok(big.z < -0.1 || big.sunk);
  const short = rollOut(ph, from(ph, 2.9), { rng: rng32(2) });
  assert.ok(short.events.some(e => e.type === 'hazard') || short.z > 0.5, 'short: in the pit or back down the ramp');
});

test('trickshot: sliders and the spinner shove the ball; a resting ball gets knocked', () => {
  const ph = trick('Spinner');
  const b = makeGolfBall(0.3, 0);           // right in the spinner's path
  let moved = false;
  for (let t = 0; t < 3 && !moved; t += 0.002) { golfStep(b, ph, 0.002, t, null); moved = b.moving; }
  assert.ok(moved, 'the spinner knocked a still ball');
  const s = TRICK.find(h => h.name === 'Sliders').sliders[0];
  const a = sliderAt(s, 0), c = sliderAt(s, s.period / 4);
  assert.ok(Math.abs(c.x - a.x) > 0.3);
});

test('trickshot: the pipes teleport the ball, water costs a stroke', () => {
  const pipes = trick('Pipe Dream');
  const left = makeGolfBall(-0.6, 0.6); putt(left, 0, -1, 1.4);
  const r = rollOut(pipes, left);
  assert.ok(r.events.some(e => e.type === 'pipe') && r.events.some(e => e.type === 'pipeOut'));
  assert.ok(r.z < 0 || r.sunk, `came out the far side: ${r.z}`);
  const island = trick('Island');
  const wet = makeGolfBall(0, 2.0); putt(wet, 0.35, -1, 3);
  const w = rollOut(island, wet);
  assert.ok(w.events.some(e => e.type === 'hazard' && e.kind === 'water'));
});

test('a putter swung through a still ball sends it the way the face points', () => {
  const b = makeGolfBall(0, 1.0);
  const R = 0.0214;
  // Head moving -z at 1.5 m/s, face normal along z, passing through the ball.
  const pad = { prevC: { x: 0, y: R, z: 1.03 }, c: { x: 0, y: R, z: 1.0 }, prevN: { x: 0, y: 0, z: 1 }, n: { x: 0, y: 0, z: 1 }, vel: { x: 0, y: 0, z: -1.5 } };
  const s = putterContact(b, pad);
  assert.ok(s > 2.5 && s < 2.8, `speed ${s}`);
  assert.ok(b.vz < -2.5 && Math.abs(b.vx) < 1e-9);
  // A moving ball can't be hit again.
  assert.equal(putterContact(b, pad), 0);
  // A head well above the ball misses.
  const c = makeGolfBall(0, 1.0);
  assert.equal(putterContact(c, { ...pad, prevC: { x: 0, y: 0.3, z: 1.03 }, c: { x: 0, y: 0.3, z: 1.0 } }), 0);
});

test('the robot golfer finds a putt that drops, and its wobble stays near it', () => {
  // A metre short of the cup on Warm Up, struck exactly as planned: in.
  const h = HOLES[0], ph = prepareHole(h);
  const ball = makeGolfBall(h.cup[0] + 0.1, h.cup[1] + 1.0);
  const plan = planPutt(ph, ball, 0, golfSkill('omega'), rng32(3));
  const b = { ...ball }; putt(b, plan.dx, plan.dz, plan.speed);
  assert.ok(rollOut(ph, b).sunk, `plan ${JSON.stringify(plan)}`);
  // Omega's wobble is a few degrees, not a different putt.
  const rng = rng32(5);
  for (let i = 0; i < 20; i++) {
    const w = wobble(plan, golfSkill('omega'), rng);
    const da = Math.abs(Math.atan2(w.dz, w.dx) - Math.atan2(plan.dz, plan.dx));
    assert.ok(da < 0.25 && Math.abs(w.speed / plan.speed - 1) < 0.45);
  }
});

// (The full balance, six robots over both courses, is a slower script: Rookie
// about 7 over par, Chopper about 2 over, Omega about 3 under.)
test('robot golfers: Omega plays the first three holes in fewer than Rookie', () => {
  const holes = HOLES.slice(0, 3), par = coursePar(holes);
  const round = (id, seed) => { const rng = rng32(seed); return holes.reduce((s, h) => s + playHole(h, id, rng), 0); };
  const omega = round('omega', 11), rookie = round('rookie', 11);
  assert.ok(omega < rookie, `omega ${omega}, rookie ${rookie}`);
  assert.ok(omega <= par + 1, `omega ${omega}`);
  assert.ok(rookie >= par, `rookie ${rookie}`);
});

test('golf cup: robot rounds played out quickly favour the better robot, ties go to a playoff', () => {
  const rng = rng32(21);
  let omega = 0, playoffs = 0;
  for (let k = 0; k < 200; k++) {
    const q = simulateRound('omega', 'rookie', HOLES, rng);
    if (q.winner === 'omega') omega++;
    if (q.score[1]) { playoffs++; assert.equal(q.score[0].a, q.score[0].b); assert.notEqual(q.score[1].a, q.score[1].b); }
    else assert.notEqual(q.score[0].a, q.score[0].b);
  }
  assert.ok(omega > 170, `omega won ${omega}/200`);
  // Closer robots: closer rounds, some level after six holes.
  let ties = 0;
  for (let k = 0; k < 200; k++) if (simulateRound('chopper', 'zippy', HOLES, rng).score[1]) ties++;
  assert.ok(ties > 10, `${ties} playoffs`);
  assert.deepEqual(CUP_COURSES, ['classic', 'classic', 'trick']);
});
