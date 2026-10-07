// Synthesised, positional sound effects (no audio files): the pock of the
// paddle, the tock of the table, the net, the floor, chimes and a cheering crowd.

export class Sfx {
  constructor() {
    this.ctx = null;
    this.enabled = true;
    this.master = null;
  }

  // Must be called from a user gesture (the Enter VR / Play buttons).
  unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.9;
      this.master.connect(this.ctx.destination);
      const len = this.ctx.sampleRate;
      this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this.noise.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }

  // Follow the head. m = camera matrixWorld elements (column-major).
  setListener(m) {
    const l = this.ctx?.listener;
    if (!l) return;
    const t = this.ctx.currentTime;
    if (l.positionX) {
      l.positionX.setValueAtTime(m[12], t); l.positionY.setValueAtTime(m[13], t); l.positionZ.setValueAtTime(m[14], t);
      l.forwardX.setValueAtTime(-m[8], t); l.forwardY.setValueAtTime(-m[9], t); l.forwardZ.setValueAtTime(-m[10], t);
      l.upX.setValueAtTime(m[4], t); l.upY.setValueAtTime(m[5], t); l.upZ.setValueAtTime(m[6], t);
    } else {
      l.setPosition(m[12], m[13], m[14]);
      l.setOrientation(-m[8], -m[9], -m[10], m[4], m[5], m[6]);
    }
  }

  _out(pos) {
    if (!pos) return this.master;
    const p = this.ctx.createPanner();
    p.panningModel = 'HRTF';
    p.distanceModel = 'inverse';
    p.refDistance = 1; p.rolloffFactor = 0.8;
    if (p.positionX) { p.positionX.value = pos.x; p.positionY.value = pos.y; p.positionZ.value = pos.z; }
    else p.setPosition(pos.x, pos.y, pos.z);
    p.connect(this.master);
    return p;
  }

  _tone(out, freq, dur, gain, type = 'sine', at = 0, endFreq = null) {
    const c = this.ctx, t = c.currentTime + at;
    const o = c.createOscillator(), g = c.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t);
    if (endFreq) o.frequency.exponentialRampToValueAtTime(endFreq, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.003);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(out);
    o.start(t); o.stop(t + dur + 0.02);
  }

  _noise(out, dur, gain, filter = 'bandpass', freq = 2000, q = 1, at = 0, attack = 0.002) {
    const c = this.ctx, t = c.currentTime + at;
    const s = c.createBufferSource(); s.buffer = this.noise;
    const f = c.createBiquadFilter(); f.type = filter; f.frequency.value = freq; f.Q.value = q;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f); f.connect(g); g.connect(out);
    s.start(t, Math.random() * 0.5); s.stop(t + dur + 0.05);
  }

  play(kind, pos = null, strength = 1) {
    if (!this.enabled || !this.ctx || this.ctx.state !== 'running') return;
    const k = Math.max(0.15, Math.min(1, strength));
    const out = this._out(pos);
    switch (kind) {
      case 'paddle':
        this._noise(out, 0.045, 0.5 * k, 'bandpass', 2600, 1.4);
        this._tone(out, 1150, 0.035, 0.35 * k, 'triangle');
        break;
      case 'table':
        this._tone(out, 1750, 0.05, 0.4 * k, 'sine', 0, 1450);
        this._noise(out, 0.02, 0.3 * k, 'highpass', 3000, 0.7);
        break;
      case 'net':
        this._noise(out, 0.09, 0.35 * k, 'lowpass', 500, 0.8);
        break;
      case 'floor':
        this._tone(out, 900, 0.05, 0.22 * k, 'sine', 0, 760);
        this._noise(out, 0.03, 0.12 * k, 'bandpass', 1400, 1);
        break;
      case 'toss':
        this._noise(out, 0.12, 0.06, 'bandpass', 900, 0.8, 0, 0.04);
        break;
      case 'machine':
        this._tone(out, 180, 0.08, 0.3, 'sine', 0, 90);
        this._noise(out, 0.06, 0.2, 'lowpass', 900, 0.8);
        break;
      case 'win':
        this._tone(out, 659, 0.22, 0.25, 'sine');
        this._tone(out, 988, 0.35, 0.25, 'sine', 0.12);
        break;
      case 'lose':
        this._tone(out, 392, 0.22, 0.2, 'triangle');
        this._tone(out, 294, 0.35, 0.2, 'triangle', 0.14);
        break;
      case 'target':
        this._tone(out, 1318, 0.18, 0.22, 'sine');
        this._tone(out, 1760, 0.3, 0.2, 'sine', 0.08);
        break;
      case 'click':
        this._tone(out, 1400, 0.03, 0.12, 'sine');
        break;
      case 'cheer': {
        // A crowd: a swell of filtered noise plus scattered claps.
        this._noise(out, 1.9 * k + 0.4, 0.22 * k, 'bandpass', 1100, 0.5, 0, 0.25);
        this._noise(out, 1.6 * k + 0.3, 0.12 * k, 'bandpass', 2400, 0.6, 0.05, 0.3);
        for (let i = 0; i < 26 * k; i++) this._noise(out, 0.03, 0.08 * k, 'bandpass', 1800 + Math.random() * 1500, 2, Math.random() * 1.4);
        break;
      }
      case 'groan':
        this._noise(out, 1.0, 0.12, 'lowpass', 500, 0.6, 0, 0.2);
        break;
      case 'putt':      // a crisp metal-on-ball click
        this._tone(out, 2300, 0.035, 0.3 * k, 'triangle', 0, 1800);
        this._noise(out, 0.03, 0.25 * k, 'highpass', 2500, 0.8);
        break;
      case 'clack':     // ball off a wooden wall
        this._tone(out, 700, 0.05, 0.25 * k, 'square', 0, 500);
        this._noise(out, 0.04, 0.15 * k, 'bandpass', 1200, 2);
        break;
      case 'cup':       // the ball dropping in and rattling round the cup
        this._tone(out, 520, 0.12, 0.35, 'sine', 0, 300);
        for (let i = 0; i < 4; i++) this._tone(out, 1500 + i * 120, 0.03, 0.12, 'triangle', 0.08 + i * 0.07);
        break;
      case 'splash':    // into the water
        this._noise(out, 0.5, 0.4, 'lowpass', 900, 0.7, 0, 0.01);
        for (let i = 0; i < 6; i++) this._tone(out, 300 + Math.random() * 500, 0.06, 0.08, 'sine', 0.15 + i * 0.06, 900 + Math.random() * 400);
        break;
      case 'whoosh':    // round a loop or off a ramp
        this._noise(out, 0.45, 0.18, 'bandpass', 700, 0.6, 0, 0.15);
        break;
      case 'dart':      // a dart thudding into the sisal
        this._tone(out, 210, 0.07, 0.45 * k, 'sine', 0, 120);
        this._noise(out, 0.05, 0.35 * k, 'lowpass', 1400, 0.9);
        break;
      case 'clink':     // off a wire and out
        this._tone(out, 3100, 0.06, 0.2, 'triangle', 0, 2600);
        this._tone(out, 4700, 0.04, 0.12, 'sine', 0.01);
        break;
      case 'swish':     // a dart leaving the hand
        this._noise(out, 0.16, 0.08 * k, 'bandpass', 1800, 0.9, 0, 0.03);
        break;
      case 'fanfare':
        [523, 659, 784, 1047].forEach((f, i) => this._tone(out, f, i === 3 ? 0.6 : 0.16, 0.22, 'triangle', i * 0.13));
        break;
    }
  }

  // Robot chatter: a burst of blips, one per syllable-ish, at the robot's pitch.
  babble(text, pos, pitch = 1) {
    if (!this.enabled || !this.ctx || this.ctx.state !== 'running') return;
    const out = this._out(pos);
    const n = Math.min(14, Math.max(3, Math.round(text.length / 4)));
    let at = 0;
    for (let i = 0; i < n; i++) {
      const f = (260 + Math.random() * 420) * pitch;
      const d = 0.05 + Math.random() * 0.05;
      this._tone(out, f, d, 0.09, i % 3 ? 'square' : 'triangle', at, f * (0.8 + Math.random() * 0.5));
      at += d + 0.025;
    }
  }

  // Real speech, if the browser has voices. Returns false if it couldn't.
  speak(text, { pitch = 1, rate = 1 } = {}) {
    const ss = window.speechSynthesis;
    if (!this.enabled || !ss || !ss.getVoices().length) return false;
    ss.cancel();
    const u = new SpeechSynthesisUtterance(text);
    const en = ss.getVoices().filter(v => v.lang?.startsWith('en'));
    u.voice = en.find(v => /GB|UK/.test(v.lang + v.name)) || en[0] || null;
    u.pitch = pitch; u.rate = rate; u.volume = 0.9;
    ss.speak(u);
    return true;
  }
}
