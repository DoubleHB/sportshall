// Spare practice: the leaves bowlers most often have to pick up, set up on
// their own, one ball at each. Pins are indices into PIN_SPOTS (0 = the 1 pin,
// 6 = the 7 pin on the left, 9 = the 10 pin on the right). Pure, tested in Node.

export const SPARES = [
  { id: '10', name: 'The 10 pin', pins: [9], tip: 'Stand on the left and roll it across the lane' },
  { id: '7', name: 'The 7 pin', pins: [6], tip: 'Stand on the right and roll it across the lane' },
  { id: '6-10', name: '6-10', pins: [5, 9], tip: 'Hit the 6 on its left side' },
  { id: '3-6-10', name: '3-6-10', pins: [2, 5, 9], tip: 'Through the 3 and the 6: aim between them' },
  { id: '2-4-5-8', name: 'The bucket (2-4-5-8)', pins: [1, 3, 4, 7], tip: 'Into the middle of the 2 and the 5' },
  { id: '5', name: 'The 5 pin', pins: [4], tip: 'Straight down the middle' },
  { id: '3-10', name: '3-10 (baby split)', pins: [2, 9], tip: 'Clip the 3 on its left so it slides into the 10' },
  { id: '7-10', name: '7-10 split', pins: [6, 9], tip: 'The hardest one: pick one side, or hope' },
];
export const spareById = id => SPARES.find(s => s.id === id) ?? null;
export const ROUND_SPARES = 10;

// A round: ten spares, the common ones more often (the 7-10 once at most).
export function spareRound(rng = Math.random, n = ROUND_SPARES) {
  const weights = { '10': 3, '7': 3, '6-10': 2, '3-6-10': 2, '2-4-5-8': 2, '5': 2, '3-10': 1.5, '7-10': 0.6 };
  const out = [];
  while (out.length < n) {
    const pool = SPARES.filter(s => !(s.id === '7-10' && out.includes('7-10')) && s.id !== out[out.length - 1]);
    const total = pool.reduce((a, s) => a + weights[s.id], 0);
    let x = rng() * total, pick = pool[pool.length - 1];
    for (const s of pool) { x -= weights[s.id]; if (x < 0) { pick = s; break; } }
    out.push(pick.id);
  }
  return out;
}
