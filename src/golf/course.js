// The Sports Hall mini golf course: six holes laid out on the hall floor.
// Metres, seen from above: x across, z along (the tee is usually at +z and you
// putt towards -z, like the table tennis player's view). Pure data.

export const GOLF_BALL_R = 0.0214;
export const CUP_R = 0.054;
export const MAX_STROKES = 6;          // after six you pick up and score 7

const rect = (x0, z0, x1, z1) => [[x0, z0], [x1, z0], [x1, z1], [x0, z1]];

export const HOLES = [
  {
    name: 'Warm Up', par: 2,
    tee: [0, 1.8], cup: [0, -1.8],
    outline: rect(-0.5, 2.2, 0.5, -2.2),
  },
  {
    name: 'Dog Leg', par: 3,
    tee: [0, 1.8], cup: [1.75, -1.7],
    outline: [[-0.5, 2.2], [0.5, 2.2], [0.5, -1.15], [2.2, -1.15], [2.2, -2.25], [-0.5, -2.25]],
    bumpers: [{ x: 0.5, z: -1.15, r: 0.05 }],
  },
  {
    name: 'Bumper Alley', par: 2,
    tee: [0, 2.1], cup: [0.1, -2.1],
    outline: rect(-0.6, 2.5, 0.6, -2.5),
    // One sits right on the straight line from tee to cup.
    bumpers: [{ x: -0.22, z: 1.0, r: 0.08 }, { x: 0.25, z: 0.4, r: 0.08 }, { x: 0.05, z: -0.35, r: 0.08 }, { x: 0.32, z: -0.95, r: 0.08 }, { x: -0.2, z: -1.4, r: 0.08 }],
  },
  {
    name: 'The Hill', par: 3,
    tee: [0, 2.1], cup: [0, -2.0],
    outline: rect(-0.6, 2.5, 0.6, -2.5),
    // Uphill (pushes the ball back towards the tee), then downhill to the cup.
    slopes: [
      { kind: 'tilt', poly: rect(-0.6, 0.6, 0.6, -0.6), a: [0, 1.1] },
      { kind: 'tilt', poly: rect(-0.6, -0.6, 0.6, -1.6), a: [0, -0.5] },
    ],
  },
  {
    name: 'Windmill', par: 3,
    tee: [0, 2.1], cup: [0.3, -2.0],
    outline: rect(-0.8, 2.5, 0.8, -2.5),
    // A wall across the middle with a gap; the windmill's blades sweep the gap,
    // and the gap is a short tunnel through the windmill's house.
    walls: [[-0.8, 0, -0.15, 0], [0.15, 0, 0.8, 0], [-0.15, 0, -0.15, -0.4], [0.15, 0, 0.15, -0.4],
      [-0.8, -0.4, -0.15, -0.4], [0.15, -0.4, 0.8, -0.4]],
    windmill: { x: 0, z: 0, gap: 0.15, speed: 1.2 },
  },
  {
    name: 'The Bowl', par: 2,
    tee: [0, 2.0], cup: [0, -0.85],
    outline: [[-0.45, 2.4], [0.45, 2.4], [0.45, 0.55], [1.0, 0.35], [1.4, -0.3], [1.4, -1.3], [1.0, -1.95], [0.3, -2.25],
      [-0.3, -2.25], [-1.0, -1.95], [-1.4, -1.3], [-1.4, -0.3], [-1.0, 0.35], [-0.45, 0.55]],
    // A funnel round the cup: a decent putt drops about two times in three.
    slopes: [{ kind: 'bowl', x: 0, z: -0.85, r: 0.9, a: 0.8 }],
  },
];

// The Trickshot course: loops, moving obstacles, a jump, pipes and water.
//   loops:   [{ x, z, dir, r, half }]  entry point, travel direction, loop radius, channel half-width
//   sliders: [{ z, x0, x1, w, period, phase }]  a block sliding across the lane between x0 and x1
//   spinners:[{ x, z, len, speed }]  a bar turning round (x, z), `len` each side
//   jumps:   [{ edge, x0, x1, dir, angle }]  a ramp ending at z = edge; launches the ball along dir
//   pits / water: polygons; roll (or land) in one and it's a penalty stroke
//   pipes:   [{ in: [x, z], out: [x, z], dir: [dx, dz] }]
export const TRICK = [
  {
    name: 'Loop the Loop', par: 3,
    tee: [0, 2.0], cup: [0, -2.0],
    outline: rect(-0.45, 2.4, 0.45, -2.4),
    // A funnel into a narrow channel through the loop, and out again.
    walls: [[-0.45, 0.8, -0.07, 0.32], [0.45, 0.8, 0.07, 0.32], [-0.07, 0.32, -0.07, 0.08], [0.07, 0.32, 0.07, 0.08],
      [-0.07, 0.08, -0.45, -0.4], [0.07, 0.08, 0.45, -0.4]],
    loops: [{ x: 0, z: 0.25, dir: [0, -1], r: 0.2, half: 0.07 }],
  },
  {
    name: 'Sliders', par: 3,
    tee: [0, 2.1], cup: [0.2, -2.1],
    outline: rect(-0.6, 2.5, 0.6, -2.5),
    sliders: [{ z: 0.8, x0: -0.38, x1: 0.38, w: 0.42, period: 2.6, phase: 0 }, { z: -0.6, x0: -0.33, x1: 0.33, w: 0.52, period: 1.8, phase: 1.3 }],
  },
  {
    name: 'The Jump', par: 3,
    tee: [0, 2.0], cup: [-0.2, -1.7],
    outline: rect(-0.5, 2.4, 0.5, -2.4),
    jumps: [{ edge: 0.5, x0: -0.5, x1: 0.5, dir: [0, -1], angle: 0.45, rampLen: 0.4 }],
    slopes: [{ kind: 'tilt', poly: rect(-0.5, 0.9, 0.5, 0.5), a: [0, 1.2] }],   // up the ramp
    pits: [rect(-0.5, 0.5, 0.5, -0.1)],
    // A low lip on the landing side: a flying ball sails over it, but a ball
    // that bounces back off the end wall can't roll back into the pit.
    walls: [[-0.5, -0.1, 0.5, -0.1]],
  },
  {
    name: 'Spinner', par: 3,
    tee: [0, 2.0], cup: [0, -1.9],
    outline: rect(-0.8, 2.4, 0.8, -2.4),
    spinners: [{ x: 0, z: 0, len: 0.5, speed: 1.4 }],   // time it, or sneak round the side
  },
  {
    name: 'Pipe Dream', par: 3,
    tee: [0, 2.0], cup: [0.45, -2.0],
    outline: rect(-0.9, 2.4, 0.9, -2.4),
    walls: [[-0.9, 0, 0.9, 0]],
    // Left pipe: out near the cup. Right pipe: back to the start (sorry).
    pipes: [{ in: [-0.6, 0.12], out: [0.45, -1.35], dir: [0, -1] }, { in: [0.6, 0.12], out: [-0.6, 2.1], dir: [0, -1] }],
  },
  {
    name: 'Island', par: 3,
    tee: [0, 2.0], cup: [0.4, -1.9],
    outline: rect(-1.0, 2.4, 1.0, -2.4),
    water: [rect(-1.0, 0.9, -0.16, -1.2), rect(0.16, 0.9, 1.0, -1.2)],
    // The bridge leans a little: aim slightly left.
    slopes: [{ kind: 'tilt', poly: rect(-0.16, 0.9, 0.16, -1.2), a: [0.2, 0] }],
  },
];

export const COURSES = {
  classic: { id: 'classic', name: 'Classic', holes: HOLES },
  trick: { id: 'trick', name: 'Trickshot', holes: TRICK },
};

export const coursePar = (holes = HOLES) => holes.reduce((n, h) => n + h.par, 0);

// Every wall as a segment [ax, az, bx, bz]: the outline (closed) plus any
// extra walls.
export function wallsOf(hole) {
  const segs = [];
  const o = hole.outline;
  for (let i = 0; i < o.length; i++) {
    const a = o[i], b = o[(i + 1) % o.length];
    segs.push([a[0], a[1], b[0], b[1]]);
  }
  for (const w of hole.walls ?? []) segs.push(w);
  return segs;
}

export function pointInPoly(x, z, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i], [xj, zj] = poly[j];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}
