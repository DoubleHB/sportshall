// Robot-v-robot rally simulator for the balance tests.
import { STEP, step, len } from '../src/physics.js';
import { Referee, P, O, other } from '../src/rules.js';
import { Bot } from '../src/ai.js';

export function rng32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const simStats = { fallbacks: 0 };

// Plays one point. Returns { winner, reason, shots }.
export function simulateRally(levelP, levelO, server, rng, { casualServe = false } = {}) {
  const bots = { P: new Bot(levelP, { side: 1, rng }), O: new Bot(levelO, { side: -1, rng }) };
  const ref = new Referee(server, { casualServe });
  let now = 0, shots = 0, lastEvent = 0;
  let ball = bots[server].startServe(now);
  const ev = [];
  while (now < 30) {
    step(ball, STEP, ev);
    now += STEP;
    if (Math.abs(ball.p.z) > 6 || Math.abs(ball.p.x) > 5) ev.push({ type: 'out' });
    if (now - lastEvent > 4) ev.push({ type: 'stall' });
    for (const e of ev) {
      lastEvent = now;
      const res = ref.event(e);
      if (res?.retoss) { ball = bots[server].startServe(now); continue; }
      if (res) return { ...res, shots };
    }
    ev.length = 0;
    bots.P.update(STEP, now); bots.O.update(STEP, now);
    const due = ref.due;
    if (due) {
      const shot = bots[due].tryHit(ball, now, { playerX: bots[other(due)].pad.x, incomingSpeed: len(ball.v) });
      if (shot) {
        if (shot.fallback) { simStats.fallbacks++; simStats.last = { p: { ...ball.p }, due, now }; }
        ball.v = shot.v; ball.w = shot.w;
        shots++; lastEvent = now;
        const res = ref.event({ type: 'hit', who: due, t: now, p: { ...ball.p } });
        if (res) return { ...res, shots };
        bots[other(due)].planReturn(ball, now);
      }
    }
  }
  return { winner: null, reason: 'timeout', shots };
}
