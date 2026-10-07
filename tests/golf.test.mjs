// Headless tests for the mini golf course and ball physics.
import test from 'node:test';
import assert from 'node:assert/strict';
import { HOLES, wallsOf, pointInPoly, coursePar, CUP_R } from '../src/golf/course.js';
import { makeGolfBall, prepareHole, putt, rollOut, golfStep, windmillBlocked, putterContact, slopeAccel, ROLL_DECEL, speedOf } from '../src/golf/physics.js';
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

test('walls keep the ball on the green', () => {
  const rng = rng32(3);
  for (const h of HOLES) {
    const ph = prepareHole(h);
    for (let i = 0; i < 12; i++) {
      const b = makeGolfBall(h.tee[0], h.tee[1]);
      const a = rng() * Math.PI * 2;
      putt(b, Math.cos(a), Math.sin(a), 1 + rng() * 4);
      const r = rollOut(ph, b, { rng });
      assert.ok(r.sunk || pointInPoly(r.x, r.z, h.outline), `${h.name}: ended at ${r.x.toFixed(2)},${r.z.toFixed(2)}`);
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
