// Stroke lessons: what each one teaches, how the ball machine feeds it, and how
// a shot is judged. Pure logic (no three.js) so it's tested in Node.
// Table space: you're at +z facing -z, so a right-hander's forehand side is +x.

export const LESSON_BALLS = 10;

export const LESSONS = [
  {
    id: 'forehand', name: 'Forehand drive', stroke: 'forehand',
    blurb: 'The basic attacking shot, on your paddle side.',
    how: ['Stand side-on, paddle back by your hip.', 'Swing forward and slightly up, finishing', 'near your forehead. Hit it at the top of the bounce.'],
    feed: { pace: 'slow', spin: 'none', place: 'forehand', depth: 'long' },
    need: { side: 'fore' },
  },
  {
    id: 'backhand', name: 'Backhand drive', stroke: 'backhand',
    blurb: 'Balls to your other side, hit in front of your body.',
    how: ['Square up to the table, paddle in front of', 'your tummy. Push forward and out from the', 'elbow, like flicking a frisbee.'],
    feed: { pace: 'slow', spin: 'none', place: 'backhand', depth: 'long' },
    need: { side: 'back' },
  },
  {
    id: 'topspin', name: 'Topspin', stroke: 'topspin',
    blurb: 'Brush up the back of the ball so it dips onto the table.',
    how: ['Start low, below the ball, face slightly closed.', 'Brush UP and forward across the back of the ball.', 'Aim for spin, not speed: it should dip and kick.'],
    feed: { pace: 'slow', spin: 'none', place: 'forehand', depth: 'long' },
    need: { side: 'fore', top: 900 },
  },
  {
    id: 'push', name: 'Backspin push', stroke: 'push',
    blurb: 'A short, safe return with backspin, for short balls.',
    how: ['Open the face (tilt it up), step in close.', 'Slide the paddle under the ball, forward', 'and a little down. Keep it short and low.'],
    feed: { pace: 'slow', spin: 'back', place: 'middle', depth: 'short' },
    need: { back: 400 },
  },
  {
    id: 'serve', name: 'Serve', stroke: 'serve', serve: true,
    blurb: 'A proper serve: bounce on your side, then theirs.',
    how: ['Toss the ball up (free hand trigger).', 'As it falls, hit it DOWN onto your own half', 'so it bounces once there, then over the net.'],
    need: {},
  },
];
export const lessonById = id => LESSONS.find(l => l.id === id) ?? null;

const RPM = 60 / (2 * Math.PI);

// Judge the hit itself, before we know where the ball goes.
// contactX: where the ball was hit (x); bodyX: your head's x; hand: 'right'|'left';
// w: the ball's spin after the hit; v: its velocity (going -z).
export function judgeHit(lesson, { contactX, bodyX = 0, hand = 'right', w }) {
  const fore = hand === 'right' ? 1 : -1;
  const side = (contactX - bodyX) * fore > -0.04 ? 'fore' : 'back';
  // Topspin on a ball travelling towards -z spins with negative x.
  const topRpm = Math.round(-w.x * RPM);
  const need = lesson.need;
  let problem = null;
  if (need.side && side !== need.side) {
    problem = need.side === 'fore'
      ? `That was a backhand. Take this one on your forehand side, to the ${hand === 'right' ? 'right' : 'left'} of your body.`
      : `That was a forehand. Let the ball come in front of you and use your backhand.`;
  } else if (need.top && topRpm < need.top) {
    problem = topRpm < 200
      ? 'Hardly any topspin. Start below the ball and brush UP the back of it.'
      : `Only ${topRpm} rpm of topspin. Start lower and brush up faster.`;
  } else if (need.back && -topRpm < need.back) {
    problem = -topRpm < 150
      ? 'No backspin. Open the paddle face and slide it under the ball.'
      : `Only ${-topRpm} rpm of backspin. Open the face more and slice under it.`;
  }
  return { side, topRpm, problem };
}

// Put the hit and where the ball went together.
// outcome: { landed: bool, reason: string|null, missed: bool (never touched it) }
export function judgeShot(lesson, hit, outcome) {
  if (outcome.missed || !hit) return { good: false, text: 'Missed the ball. Watch it right onto the paddle, and move your feet to get behind it.' };
  if (!outcome.landed) {
    const r = (outcome.reason || '').toLowerCase();
    if (r.includes('own side') || r.includes('net')) return { good: false, text: 'Into the net. Open the face a touch and swing through the ball, a little more upwards.' };
    return { good: false, text: 'It missed the table. Close the face a little, or swing a bit softer.' };
  }
  if (hit.problem) return { good: false, text: hit.problem };
  const praise = lesson.need.top ? `Great topspin: ${hit.topRpm} rpm!`
    : lesson.need.back ? `Nice push: ${-hit.topRpm} rpm of backspin.`
    : hit.side === 'fore' ? 'Good forehand!' : 'Good backhand!';
  return { good: true, text: praise };
}

// Serves are judged by the referee: legal or not, and why.
export function judgeServe(res) {
  if (!res) return null;
  if (res.landed) return { good: true, text: 'Good serve! Bounced on your side, then theirs.' };
  if (res.let) return { good: false, retry: true, text: 'Let: it touched the net. Have another go.' };
  const r = (res.reason || '').toLowerCase();
  if (r.includes('bounce on your side first')) return { good: false, text: 'It went straight over. Hit DOWN so it bounces on your own half first.' };
  if (r.includes("didn't clear")) return { good: false, text: 'It didn\'t get over the net. Hit it a bit harder, still downwards.' };
  if (r.includes('missed the table')) return { good: false, text: 'It went off the table. Hit a little softer, aiming down at your end.' };
  return { good: false, text: res.reason };
}

export const starsFor = (good, balls = LESSON_BALLS) => (good >= balls * 0.8 ? 3 : good >= balls * 0.5 ? 2 : good >= balls * 0.3 ? 1 : 0);
