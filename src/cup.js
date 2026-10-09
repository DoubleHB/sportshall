// The cup: an 8-player knockout (you plus seven robots). Quarter-finals and
// semi-finals are one game to 11; the final is best of three. Pure logic, no
// three.js, so it's tested in Node. Entrants are robot ids or 'you'.
import { ALL_ROBOTS, rivalById } from './rivals.js';

export const YOU = 'you';
export const FRIEND = 'friend';     // a friend on another screen (the bowling cup with a friend)
export const ROUND_NAMES = ['Quarter-final', 'Semi-final', 'Final'];
export const ROUND_GAMES = [1, 1, 3];

const match = (a = null, b = null) => ({ a, b, winner: null, score: null });

function shuffle(list, rng) {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

// A fresh draw. You and Omega (the favourite) go in opposite halves, so the
// final can be you against the champion. With a friend (friend: their name),
// you and they go in opposite halves instead, Omega anywhere else, and one
// robot sits out.
export function newCup(rng = Math.random, friend = null) {
  const others = shuffle(ALL_ROBOTS.map(r => r.id).filter(id => friend || id !== 'omega'), rng);
  const slots = new Array(8).fill(null);
  const youHalf = rng() < 0.5 ? 0 : 4;
  slots[youHalf + Math.floor(rng() * 4)] = YOU;
  slots[(4 - youHalf) + Math.floor(rng() * 4)] = friend ? FRIEND : 'omega';
  for (let i = 0; i < 8; i++) if (!slots[i]) slots[i] = others.pop();
  return {
    ...(friend ? { friend: String(friend).slice(0, 16) } : {}),
    rounds: [
      [match(slots[0], slots[1]), match(slots[2], slots[3]), match(slots[4], slots[5]), match(slots[6], slots[7])],
      [match(), match()],
      [match()],
    ],
    champion: null,
    started: Date.now(),
  };
}

// The next match to play: { r, i, m }, or null when the cup is over.
export function nextMatch(cup) {
  for (let r = 0; r < cup.rounds.length; r++) {
    for (let i = 0; i < cup.rounds[r].length; i++) {
      const m = cup.rounds[r][i];
      if (!m.winner && m.a && m.b) return { r, i, m };
    }
  }
  return null;
}

// Record a result. score: list of games as { a, b } points.
export function record(cup, r, i, winner, score) {
  const m = cup.rounds[r][i];
  m.winner = winner; m.score = score;
  if (r + 1 < cup.rounds.length) {
    const next = cup.rounds[r + 1][i >> 1];
    if (i % 2 === 0) next.a = winner; else next.b = winner;
  } else cup.champion = winner;
  return cup;
}

export const youAreOut = cup => cup.rounds.flat().some(m => m.winner && (m.a === YOU || m.b === YOU) && m.winner !== YOU);
export const involvesYou = m => m.a === YOU || m.b === YOU;
export const involvesFriend = m => m.a === FRIEND || m.b === FRIEND;
// A match a person plays in (it can't be played out for them).
export const involvesPerson = m => involvesYou(m) || involvesFriend(m);
export const friendIsOut = cup => cup.rounds.flat().some(m => m.winner && involvesFriend(m) && m.winner !== FRIEND);

// How strong a robot is, for skipped matches.
const LEVEL_RATING = { easy: 1, medium: 2, hard: 3, pro: 4 };
const NUDGE = { rookie: -0.25, bolt: 0.2, chopper: 0.15, zippy: 0.1, omega: 0.35 };
export const rating = id => (LEVEL_RATING[rivalById(id).level] ?? 2) + (NUDGE[id] ?? 0);

// A quick result for a robot-v-robot match you don't watch: each point is won
// with a probability from the two ratings, played to 11 (win by 2), best of
// `games`. Returns { winner, score: [{a, b}] }.
export function quickMatch(a, b, games = 1, rng = Math.random) {
  const pa = 1 / (1 + Math.exp(-(rating(a) - rating(b)) * 0.6));
  const need = Math.floor(games / 2) + 1;
  const score = [];
  let wa = 0, wb = 0;
  while (wa < need && wb < need) {
    let x = 0, y = 0;
    while (!((x >= 11 || y >= 11) && Math.abs(x - y) >= 2)) { if (rng() < pa) x++; else y++; }
    score.push({ a: x, b: y });
    if (x > y) wa++; else wb++;
  }
  return { winner: wa > wb ? a : b, score };
}
