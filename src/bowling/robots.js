// The robot bowlers: each has a style (speed and hook) and a wobble. On a full
// rack they go for the pocket; on a spare they try a few lines on a copy of the
// pins and take the one that knocks most down. Pure, tested in Node.
import { LANE, PIN_SPOTS } from './lane.js';
import { launch, step, simulate } from './physics.js';

// speed m/s, spin (0 straight .. 1 big hook), start x (where they stand),
// and the wobble: x (m), ang (rad), spd (fraction).
export const BOWL_SKILL = {
  rookie: { speed: 5.6, spin: 0, start: 0.0, x: 0.12, ang: 0.035, spd: 0.15, simple: true },   // aims at whatever's in front
  bolt: { speed: 8.6, spin: 0.15, start: 0.05, x: 0.045, ang: 0.013, spd: 0.05 },    // flat out, all speed
  spinny: { speed: 6.8, spin: 1.0, start: 0.3, x: 0.03, ang: 0.008, spd: 0.05 },     // hooks it a mile
  chopper: { speed: 7.0, spin: 0.55, start: 0.2, x: 0.024, ang: 0.0065, spd: 0.04 },
  vortex: { speed: 7.5, spin: 0.8, start: 0.25, x: 0.014, ang: 0.004, spd: 0.025 },
  omega: { speed: 7.6, spin: 0.8, start: 0.25, x: 0.008, ang: 0.0024, spd: 0.015 },
  zippy: { speed: 8.0, spin: 0.5, start: 0.2, x: 0.022, ang: 0.0062, spd: 0.035 },
};
export const bowlSkill = id => BOWL_SKILL[id] ?? BOWL_SKILL.rookie;
// For the menu.
export const BOWL_STYLE = { rookie: 'slow and straight', bolt: 'all speed', spinny: 'huge hook', chopper: 'steady', vortex: 'sharp', omega: 'deadly', zippy: 'quick' };

const gauss = rng => (rng() + rng() + rng() - 1.5) * 1.41;
const POCKET = 0.065;           // a right-hander's 1-3 pocket, from the head pin

// Where a ball from x0 (speed, spin, launch angle a) crosses the head pin's line.
function crossAt(x0, speed, spin, a) {
  const b = launch(x0, Math.sin(a) * speed, -Math.cos(a) * speed, spin);
  while (b.z > LANE.headZ && b.state === 'lane') step(b, [], 1 / 300);
  return b.state === 'lane' ? b.x : Math.sign(b.x - LANE.x) * 9;
}
// The launch that sends a ball from x0 through x = hitX at the head pin.
export function aimFor(hitX, x0, speed, spin) {
  let lo = -0.2, hi = 0.2;
  for (let k = 0; k < 28; k++) {
    const a = (lo + hi) / 2;
    if (crossAt(x0, speed, spin, a) > hitX) hi = a; else lo = a;
  }
  const a = (lo + hi) / 2;
  return { x: x0, vx: Math.sin(a) * speed, vz: -Math.cos(a) * speed, spin };
}

// The line a robot means to bowl at these standing pins (indices; null = all ten).
export function planShot(id, stand = null, rng = Math.random) {
  const S = bowlSkill(id);
  const start = LANE.x + S.start;
  // A beginner: straight at the head pin, or the middle of what's left.
  if (S.simple) {
    const pins = stand ?? [0];
    const mid = pins.reduce((a, i) => a + PIN_SPOTS[i].x, 0) / pins.length;
    return aimFor(mid, start, S.speed, S.spin);
  }
  if (!stand || stand.length === 10) {
    // The pocket: a few lines into it, a few balls each with its wobble; a strike counts extra.
    let best = null;
    for (const dx of [-0.025, -0.012, 0, 0.012, 0.025]) {
      const shot = aimFor(LANE.x + POCKET + dx, start, S.speed, S.spin);
      let sum = 0;
      for (let k = 0; k < 4; k++) { const n = simulate(null, k ? wobble(shot, S, rng) : shot).down.length; sum += n + (n === 10 ? 3 : 0); }
      if (!best || sum > best.sum) best = { shot, sum };
    }
    return best.shot;
  }
  // A spare: try lines through the standing pins (a little either side of
  // each, and between neighbours), a few times each with its own wobble.
  const xs = stand.map(i => PIN_SPOTS[i].x);
  const cands = new Set();
  for (const x of xs) for (const d of [-0.07, -0.035, 0, 0.035, 0.07]) cands.add(+(x + d).toFixed(3));
  let best = null;
  for (const hx of cands) {
    // Spares go straighter: half the hook, from across the lane.
    const spin = S.spin * 0.5, x0 = LANE.x + Math.max(-0.35, Math.min(0.35, (LANE.x - hx) * 0.9));
    const shot = aimFor(hx, x0, S.speed, spin);
    let sum = 0;
    for (let k = 0; k < 3; k++) sum += simulate(stand, k ? wobble(shot, S, rng) : shot).down.length;
    if (!best || sum > best.sum) best = { shot, sum };
  }
  return best.shot;
}
// The shot as it comes out of the robot's hand.
export function wobble(shot, S, rng = Math.random) {
  const a = Math.atan2(shot.vx, -shot.vz) + gauss(rng) * S.ang;
  const v = Math.hypot(shot.vx, shot.vz) * (1 + gauss(rng) * S.spd);
  return { x: shot.x + gauss(rng) * S.x, vx: Math.sin(a) * v, vz: -Math.cos(a) * v, spin: shot.spin * (1 + gauss(rng) * 0.1) };
}
export function robotShot(id, stand = null, rng = Math.random) {
  return wobble(planShot(id, stand, rng), bowlSkill(id), rng);
}

// ---------------------------------------------------------------- talk --
// Moments: start; its own: strike, double (two in a row), turkey (three),
// spare, split, gutter, open; yours: pStrike, pSpare, pGutter; the end: win, pWin.
const LINES = {
  nice: {
    start: ['Bowling! Do I throw it or roll it?', 'The pins look so friendly!'],
    strike: ['They all fell over! Sorry, pins!'], double: ['Two in a row! Wow!'], turkey: ['Three strikes? Is that a turkey? Gobble!'],
    spare: ['Got the rest!'], split: ['Oh no, they\'re so far apart.'], gutter: ['Oops. It went in the ditch.'], open: ['Some of them are still standing.'],
    pStrike: ['Strike! Amazing!', 'Wow, all ten!'], pSpare: ['Nice spare!'], pGutter: ['Unlucky! The gutter\'s sneaky.'],
    win: ['I won? Thank you for the game!'], pWin: ['You beat me! Well bowled!'],
  },
  hyper: {
    start: ['FULL SPEED BOWLING!', 'Pins! Prepare for IMPACT!'],
    strike: ['KABOOM! STRIKE!'], double: ['DOUBLE! DOUBLE!'], turkey: ['TURKEY! GOBBLE GOBBLE!'],
    spare: ['Cleaned up! Fast!'], split: ['Too much power. Way too much.'], gutter: ['The lane moved! It MOVED!'], open: ['Needed more speed.'],
    pStrike: ['Hey! That\'s my move!'], pSpare: ['Okay, okay, nice.'], pGutter: ['Ha! Gutter!'],
    win: ['FASTEST BALL IN THE HALL!'], pWin: ['Rematch! REMATCH!'],
  },
  cheeky: {
    start: ['Try to keep it out of the gutter.', 'Watch the hook. Then cry.'],
    strike: ['Strike. Obviously.'], double: ['Double. Keep up.'], turkey: ['Turkey! Gobble, gobble, you\'re losing.'],
    spare: ['Picked it up. Easy.'], split: ['The pins cheated.'], gutter: ['Meant to do that.'], open: ['Warming up.'],
    pStrike: ['Lucky.', 'Hmph. Fine.'], pSpare: ['Spare. Not a strike though.'], pGutter: ['Gutter ball! Ha!'],
    win: ['Out-bowled! Better luck next time.'], pWin: ['You got me. Respect.'],
  },
  dry: {
    start: ['Ten pins. One ball. Simple.', 'Take your time. I will.'],
    strike: ['Strike.'], double: ['Double. As planned.'], turkey: ['Turkey. Noted.'],
    spare: ['Spare.'], split: ['Hm. A split.'], gutter: ['Gutter. Recalculating.'], open: ['Hm.'],
    pStrike: ['Good. Again.'], pSpare: ['Acceptable.'], pGutter: ['Patience.'],
    win: ['Game complete. Mine.'], pWin: ['Well bowled. Truly.'],
  },
  cocky: {
    start: ['I don\'t do spares. Only strikes.', 'Watch and learn.'],
    strike: ['Too easy.'], double: ['Double. Yawn.'], turkey: ['Turkey. Obviously.'],
    spare: ['A spare. Slow day.'], split: ['That lane is warped.'], gutter: ['Faulty ball!'], open: ['I demand a recount.'],
    pStrike: ['Lucky.', 'Beginner\'s luck.'], pSpare: ['Cute.'], pGutter: ['Ha! Need bumpers?'],
    win: ['Champion of the lanes. As always.'], pWin: ['Impossible. Rematch.'],
  },
  cold: {
    start: ['Lane conditions computed.', 'I have calculated the pocket.'],
    strike: ['Optimal.'], double: ['Repeating.'], turkey: ['Sequence complete.'],
    spare: ['Corrected.'], split: ['Anomaly.'], gutter: ['Error.'], open: ['Inefficient.'],
    pStrike: ['Noted.'], pSpare: ['Adequate.'], pGutter: ['Predictable.'],
    win: ['Game complete. You are outclassed.'], pWin: ['Outcome unexpected. Recalibrating.'],
  },
};
export const BOWL_TALK_CHANCE = { start: 1, strike: 0.7, double: 0.9, turkey: 1, spare: 0.6, split: 0.9, gutter: 1, open: 0.4, pStrike: 0.8, pSpare: 0.5, pGutter: 0.8, win: 1, pWin: 1 };
let lastLine = null;
export function bowlLine(rival, moment, rng = Math.random) {
  const set = LINES[rival.voice]?.[moment];
  if (!set?.length) return null;
  let line = set[Math.floor(rng() * set.length)];
  if (line === lastLine && set.length > 1) line = set[(set.indexOf(line) + 1) % set.length];
  lastLine = line;
  return line;
}
