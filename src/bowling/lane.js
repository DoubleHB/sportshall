// The bowling lane, in hall coordinates (metres; the lane runs along -z).
// The hall's floor is 16 m long, so the lane is shorter than a real one (9.2 m
// from the foul line to the head pin, not 18.3), with real-size pins, ball,
// lane width and gutters. The far barrier makes the back of the pit.

export const LANE = {
  foulZ: 4.4,            // the foul line
  headZ: -4.8,           // the head pin's spot
  halfW: 0.527,          // the lane (41.5 inches across)
  gutterW: 0.235,
  deckEnd: -5.75,        // the back of the pin deck; the pit is behind it
  pitEnd: -5.95,
  approachEnd: 5.9,      // the back of the approach (the near barrier is at 6)
  x: 0,                  // the lane's middle
};
LANE.len = LANE.foulZ - LANE.headZ;
LANE.outer = LANE.halfW + LANE.gutterW;
// Where the oil stops and the ball starts to hook (from the foul line).
LANE.oil = 0.62;

export const BALL_R = 0.108;          // an 8.5 inch ball
export const BALL_M = 7.0;            // kg (about 15 lb)
export const PIN_R = 0.0605;          // at the belly, where pins and ball meet
export const PIN_H = 0.381;
export const PIN_M = 1.5;

// The ten pin spots: 12 inches apart in a triangle, pin 1 at the front.
const S = 0.3048, ROW = S * Math.sqrt(3) / 2;
export const PIN_SPOTS = [
  [0, 0],
  [-S / 2, -ROW], [S / 2, -ROW],
  [-S, -2 * ROW], [0, -2 * ROW], [S, -2 * ROW],
  [-1.5 * S, -3 * ROW], [-S / 2, -3 * ROW], [S / 2, -3 * ROW], [1.5 * S, -3 * ROW],
].map(([x, z]) => ({ x: LANE.x + x, z: LANE.headZ + z }));

// The aiming arrows: seven, a quarter of the way down, every five boards.
export const BOARD_W = LANE.halfW * 2 / 39;   // 39 boards across
export const ARROWS = [-15, -10, -5, 0, 5, 10, 15].map(b => ({ x: LANE.x + b * BOARD_W, z: LANE.foulZ - LANE.len * 0.27 - Math.abs(b) * 0.012 }));
