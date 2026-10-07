// Paddle feel in a link: ?feel=82_86_60_105_0_-10 is sweet spot (mm radius),
// bounce %, spin grip %, swing power %, smoothing tenths and paddle angle.

export const FEEL_LIMITS = {
  size: [0.066, 0.11], bounce: [0.7, 0.96], grip: [0.3, 0.9], power: [0.7, 1.5], smooth: [0, 0.7], angle: [-60, 60],
};
const clamp = (v, [a, b]) => Math.min(b, Math.max(a, v));

export function encodeFeel(feel, angle = 0) {
  return [Math.round(feel.size * 1000), Math.round(feel.bounce * 100), Math.round(feel.grip * 100),
    Math.round(feel.power * 100), Math.round(feel.smooth * 10), Math.round(angle)].join('_');
}

// Returns { feel, angle } or null if the text isn't a feel code.
export function decodeFeel(text) {
  if (typeof text !== 'string' || !/^-?\d+(_-?\d+){5}$/.test(text)) return null;
  const [s, b, g, p, m, a] = text.split('_').map(Number);
  const L = FEEL_LIMITS;
  return {
    feel: { size: clamp(s / 1000, L.size), bounce: clamp(b / 100, L.bounce), grip: clamp(g / 100, L.grip), power: clamp(p / 100, L.power), smooth: clamp(m / 10, L.smooth) },
    angle: clamp(a, L.angle),
  };
}

export const feelLink = (base, feel, angle) => `${base}?feel=${encodeFeel(feel, angle)}`;
