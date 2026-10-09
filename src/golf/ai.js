// The robot golfer: tries putts on a copy of the ball, keeps the one that does
// best (allowing for its own wobble), then plays it with its wobble. Pure, so
// it runs in Node for the balance tests; in the game the search is spread over
// frames (searchPutt is a generator: one tried putt per step).
import { MAX_PUTT, rollOut, prepareHole, makeGolfBall, putt as hit } from './physics.js';
import { MAX_STROKES } from './course.js';

// How far off a robot's putts go: ang = spread of the line (radians), spd = of
// the pace (a fraction). Rookie misses plenty; Omega rarely leaves one short.
export const GOLF_SKILL = {
  rookie: { ang: 0.17, spd: 0.34 },
  bolt: { ang: 0.12, spd: 0.36 },       // hits it hard, all pace and no touch
  spinny: { ang: 0.16, spd: 0.25 },     // and the other way round
  chopper: { ang: 0.12, spd: 0.24 },
  vortex: { ang: 0.1, spd: 0.19 },
  omega: { ang: 0.065, spd: 0.12 },
  zippy: { ang: 0.1, spd: 0.2 },
};
export const golfSkill = id => GOLF_SKILL[id] ?? GOLF_SKILL.rookie;
// For the menu: what each is like with a putter.
export const GOLF_FORM = { rookie: 'wobbly', bolt: 'all power', spinny: 'all touch', chopper: 'steady', vortex: 'sharp', omega: 'deadly', zippy: 'quick' };

const H = 1 / 250;                      // the search's time step (the game uses 1/500)
const SPEEDS = [0.5, 0.8, 1.15, 1.55, 2.0, 2.55, 3.2, 4.0, 5.0];
const ANGLES = 36;

// How good a finished putt is (lower is better): in, beats near, beats far;
// water or a pit is worth a stroke and then some.
function rate(r, cup) {
  if (r.sunk) return -10 + r.t * 0.02;
  if (r.ball.hazard) return 6;
  return Math.hypot(r.x - cup[0], r.z - cup[1]);
}
const gauss = rng => (rng() + rng() + rng() - 1.5) * 1.41;

// Try putts from `ball` (x, z) on a prepared hole, struck at hole time t0.
// Each step tries one; the generator's return value is the plan { dx, dz, speed }.
export function* searchPutt(ph, ball, t0, skill, rng = Math.random) {
  const cup = ph.hole.cup, b = makeGolfBall(ball.x, ball.z);
  const tryOne = (a, s) => { hit(b, Math.cos(a), Math.sin(a), s); const r = rollOut(ph, b, { h: H, t0, rng }); b.moving = false; return rate(r, cup); };
  const base = Math.atan2(cup[1] - ball.z, cup[0] - ball.x), step = 2 * Math.PI / ANGLES;
  // 1. A coarse look all round (starting straight at the cup).
  let found = [];
  for (let i = 0; i < ANGLES; i++) {
    const a = base + step * (i % 2 ? (i + 1) / 2 : -i / 2);
    for (const s of SPEEDS) { found.push({ a, s, v: tryOne(a, s) }); yield; }
  }
  found.sort((p, q) => p.v - q.v);
  // 2. Closer in round the best few.
  const fine = [];
  for (const c of found.slice(0, 4)) {
    for (const da of [-0.33, 0, 0.33]) for (const ds of [0.92, 1, 1.08]) {
      const a = c.a + da * step, s = Math.min(MAX_PUTT, c.s * ds);
      fine.push({ a, s, v: tryOne(a, s) }); yield;
    }
  }
  fine.sort((p, q) => p.v - q.v);
  // 3. Of the best, the one that still works when it comes off a bit (as it will).
  let best = null;
  for (const c of fine.slice(0, 4)) {
    let sum = c.v;
    for (let k = 0; k < 5; k++) { sum += tryOne(c.a + gauss(rng) * skill.ang, Math.min(MAX_PUTT, c.s * (1 + gauss(rng) * skill.spd))); yield; }
    const mean = sum / 6;
    if (!best || mean < best.mean) best = { ...c, mean };
  }
  return { dx: Math.cos(best.a), dz: Math.sin(best.a), speed: best.s };
}
// The whole search in one go (tests).
export function planPutt(ph, ball, t0, skill, rng = Math.random) {
  const it = searchPutt(ph, ball, t0, skill, rng);
  for (;;) { const r = it.next(); if (r.done) return r.value; }
}
// The plan as the robot actually strikes it.
export function wobble(plan, skill, rng = Math.random) {
  const a = Math.atan2(plan.dz, plan.dx) + gauss(rng) * skill.ang;
  return { dx: Math.cos(a), dz: Math.sin(a), speed: Math.max(0.2, Math.min(MAX_PUTT, plan.speed * (1 + gauss(rng) * skill.spd))) };
}

// A whole hole, robot alone (the balance tests): strokes taken, with the same
// limit and penalties as the game.
export function playHole(hole, id, rng = Math.random) {
  const ph = prepareHole(hole), skill = golfSkill(id);
  let ball = makeGolfBall(hole.tee[0], hole.tee[1]), strokes = 0, t = 0;
  while (strokes < MAX_STROKES) {
    const p = wobble(planPutt(ph, ball, t, skill, rng), skill, rng);
    hit(ball, p.dx, p.dz, p.speed);
    strokes++;
    const r = rollOut(ph, ball, { h: 1 / 500, t0: t, rng });
    t += r.t + 4;
    if (r.sunk) return strokes;
    if (r.ball.hazard) { strokes++; ball.moving = false; continue; }      // replay from where it was hit
    ball = makeGolfBall(r.x, r.z);
  }
  return MAX_STROKES + 1;
}

// ------------------------------------------------- robot v robot, quickly --
// A cup match between two robots you don't play: putting every putt out would
// take half a minute on a headset, so each hole is scored from how the robot
// usually does (strokes over par per hole, from the balance runs), with a
// spread. A tie goes to sudden death on the course's last hole.
export const GOLF_BIAS = { rookie: 1.25, bolt: 1.05, spinny: 0.9, chopper: 0.35, zippy: 0.1, vortex: -0.25, omega: -0.6 };
export function quickHole(id, par, rng = Math.random) {
  return Math.max(1, Math.min(MAX_STROKES + 1, Math.round(par + (GOLF_BIAS[id] ?? 0.5) + gauss(rng) * 0.8)));
}
// Returns { winner, score: [{ a, b }] } (score = the two totals; a playoff adds
// a second entry with the sudden-death holes' strokes).
export function simulateRound(a, b, holes, rng = Math.random) {
  let ta = 0, tb = 0;
  for (const h of holes) { ta += quickHole(a, h.par, rng); tb += quickHole(b, h.par, rng); }
  const score = [{ a: ta, b: tb }];
  if (ta !== tb) return { winner: ta < tb ? a : b, score };
  const last = holes[holes.length - 1];
  let pa = 0, pb = 0;
  for (let k = 0; k < 20 && pa === pb; k++) { pa = quickHole(a, last.par, rng); pb = quickHole(b, last.par, rng); }
  if (pa === pb) pa -= rng() < 0.5 ? 1 : -1;
  score.push({ a: pa, b: pb });
  return { winner: pa < pb ? a : b, score };
}
// Which course each round of the golf cup is played on.
export const CUP_COURSES = ['classic', 'classic', 'trick'];

// ---------------------------------------------------------------- talk --
// Moments: start; the robot's own hole: ace, under (birdie or better), par,
// over (bogey), bad (worse, or picked up), splash (water or a pit); yours:
// pGood (birdie or better), pBad (double bogey or worse); the end: win, pWin.
const LINES = {
  nice: {
    start: ['Mini golf! I love the little windmill!', 'Is it the small hole or the big one? The small one?'],
    ace: ['In one?! I\'m telling everyone!'], under: ['Ooh, under par! Is that good?'], par: ['Par! That\'s the right number!'],
    over: ['Oopsie. One too many.'], bad: ['That hole was very tricky.', 'I\'ll get the next one!'], splash: ['Splash! Poor ball!'],
    pGood: ['Wow, great putting!', 'You\'re really good at this!'], pBad: ['Unlucky! That one\'s hard.'],
    win: ['I won? Thank you for the round!'], pWin: ['You beat me! Well played!'],
  },
  hyper: {
    start: ['FULL POWER PUTTING!', 'Golf but FAST! Let\'s GO!'],
    ace: ['HOLE IN ONE! SPEED WINS!'], under: ['UNDER PAR! ZOOM!'], par: ['Par! Could\'ve been faster.'],
    over: ['Too much power. Again.'], bad: ['The ball went to SPACE.', 'That cup is TOO SMALL!'], splash: ['SPLASH! It wanted a swim!'],
    pGood: ['Hey! Slow down!', 'Whoa, nice one!'], pBad: ['Ha! Need more power!'],
    win: ['FASTEST ROUND EVER!'], pWin: ['Rematch! REMATCH!'],
  },
  cheeky: {
    start: ['Try not to lose your ball.', 'Bet you a windmill I win.'],
    ace: ['One. Write it down. In pen.'], under: ['Under par. You\'re welcome.'], par: ['Par. Bored now.'],
    over: ['The green\'s wonky.', 'Meant to do that.'], bad: ['Who designed this hole?'], splash: ['The water was in the way.'],
    pGood: ['Lucky bounce.', 'Hmph. Fine.'], pBad: ['That\'s a lot of putts!', 'Need a map?'],
    win: ['Out-putted! Ha!'], pWin: ['You got me. Respect.'],
  },
  dry: {
    start: ['The ball is round. So is the hole.', 'Take your time. I will.'],
    ace: ['One stroke. As planned.'], under: ['Under par. Steady.'], par: ['Par.'],
    over: ['Hm. Noted.'], bad: ['Recalculating.'], splash: ['Wet. Noted.'],
    pGood: ['Good. Again.'], pBad: ['Patience.', 'Breathe.'],
    win: ['Round complete. Mine.'], pWin: ['Well putted. Truly.'],
  },
  cocky: {
    start: ['Watch and learn.', 'I don\'t miss putts. Ever.'],
    ace: ['Hole in one. Obviously.'], under: ['Too easy.'], par: ['Par. Slow day.'],
    over: ['That cup moved.'], bad: ['Faulty ball.', 'I demand a recount.'], splash: ['Who put water there?!'],
    pGood: ['Lucky.', 'Beginner\'s luck.'], pBad: ['Ha! Need lessons?'],
    win: ['Champion of the green. As always.'], pWin: ['Impossible. Rematch.'],
  },
  cold: {
    start: ['Course mapped. Every slope.', 'I have computed this round.'],
    ace: ['Optimal.'], under: ['Below par. Expected.'], par: ['Par. Acceptable.'],
    over: ['Error in pace.'], bad: ['Anomaly.'], splash: ['Water. Unforeseen.'],
    pGood: ['Noted.', 'Improving.'], pBad: ['Inefficient.'],
    win: ['Round complete. You are outclassed.'], pWin: ['Outcome unexpected. Recalibrating.'],
  },
};
export const GOLF_TALK_CHANCE = { start: 1, ace: 1, under: 0.9, par: 0.4, over: 0.6, bad: 0.9, splash: 1, pGood: 0.8, pBad: 0.6, win: 1, pWin: 1 };
let lastLine = null;
export function golfLine(rival, moment, rng = Math.random) {
  const set = LINES[rival.voice]?.[moment];
  if (!set?.length) return null;
  let line = set[Math.floor(rng() * set.length)];
  if (line === lastLine && set.length > 1) line = set[(set.indexOf(line) + 1) % set.length];
  lastLine = line;
  return line;
}
