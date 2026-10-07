// The dartboard: regulation sizes (metres), what scores where, and where to
// aim for each bed. Board coordinates: x to the right and y up from the bull,
// as you face the board.

export const R = { bull: 0.00635, outer: 0.0159, trebleIn: 0.099, trebleOut: 0.107, doubleIn: 0.162, doubleOut: 0.170, board: 0.2255 };
// Clockwise from the top.
export const NUMBERS = [20, 1, 18, 4, 13, 6, 10, 15, 2, 17, 3, 19, 7, 16, 8, 11, 14, 9, 12, 5];
const SEG = Math.PI / 10;
const TAU = Math.PI * 2;

// Where the board hangs in the hall (table space: the table tennis table is
// put away for darts), and the throw line 2.37 m from the face of the board.
export const BOARD = { x: 0, y: 1.73, z: -0.6, face: 0.04 };
export const FACE_Z = BOARD.z + BOARD.face;
export const OCHE = 2.37;
export const OCHE_Z = FACE_Z + OCHE;
// The cabinet round the board (half its width) and the stage wall behind it.
export const CABINET = 0.47;
export const WALL = { z: BOARD.z - 0.05, halfW: 1.6, top: 2.7 };

// The number whose segment holds (x, y).
export function segmentAt(x, y) {
  const a = ((Math.atan2(x, y) + SEG / 2) % TAU + TAU) % TAU;
  return NUMBERS[Math.floor(a / SEG) % 20];
}

export function labelOf(n, mult) {
  if (!n) return 'Miss';
  if (n === 25) return mult === 2 ? 'Bull' : '25';
  return (mult === 3 ? 'T' : mult === 2 ? 'D' : '') + n;
}
const hit = (n, mult) => ({ n, mult, score: n * mult, label: labelOf(n, mult) });
export const MISS = Object.freeze({ n: 0, mult: 0, score: 0, label: 'Miss' });

// What a dart at (x, y) scores: { n, mult, score, label }. The bull (50) is a
// double (n 25, mult 2); the outer bull is 25.
export function scoreAt(x, y) {
  const r = Math.hypot(x, y);
  if (r <= R.bull) return hit(25, 2);
  if (r <= R.outer) return hit(25, 1);
  if (r > R.doubleOut) return MISS;
  const n = segmentAt(x, y);
  return hit(n, r >= R.doubleIn ? 2 : r >= R.trebleIn && r <= R.trebleOut ? 3 : 1);
}

// 'T20', 'D16', '20' (or 'S20'), 'Bull', '25' -> { n, mult }.
export function parseLabel(label) {
  if (label === 'Bull') return { n: 25, mult: 2 };
  if (label === '25') return { n: 25, mult: 1 };
  const m = /^([TDS]?)(\d+)$/.exec(label);
  if (!m) return { n: 0, mult: 0 };
  return { n: +m[2], mult: m[1] === 'T' ? 3 : m[1] === 'D' ? 2 : 1 };
}

// The middle of a bed: where you'd aim for it. Singles aim at the big outer
// single, between the treble and double rings.
export function aimPoint(label) {
  const { n, mult } = parseLabel(label);
  if (n === 25) return mult === 2 ? { x: 0, y: 0 } : { x: 0, y: (R.bull + R.outer) / 2 };
  const a = NUMBERS.indexOf(n) * SEG;
  const r = mult === 3 ? (R.trebleIn + R.trebleOut) / 2 : mult === 2 ? (R.doubleIn + R.doubleOut) / 2 : (R.trebleOut + R.doubleIn) / 2;
  return { x: r * Math.sin(a), y: r * Math.cos(a) };
}

// The angle (radians, clockwise from the top) of a number's segment centre.
export const segmentAngle = n => NUMBERS.indexOf(n) * SEG;

// How far (m) a point is from the nearest wire: the rings and the spokes.
export function wireDist(x, y) {
  const r = Math.hypot(x, y);
  let d = Infinity;
  for (const w of [R.bull, R.outer, R.trebleIn, R.trebleOut, R.doubleIn, R.doubleOut]) d = Math.min(d, Math.abs(r - w));
  if (r > R.outer && r < R.doubleOut) {
    const m = ((Math.atan2(x, y) - SEG / 2) % SEG + SEG) % SEG;
    d = Math.min(d, r * Math.sin(Math.min(m, SEG - m)));
  }
  return d;
}
