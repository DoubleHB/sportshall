// Flat canvas UIs shown on planes in the 3D world: the menu (with buttons you
// point at with a controller), the scoreboard and the message banner.
import * as THREE from 'three';

export class CanvasBoard {
  constructor(widthM, heightM, pxW, pxH, { transparent = true } = {}) {
    this.canvas = document.createElement('canvas');
    this.canvas.width = pxW; this.canvas.height = pxH;
    this.g = this.canvas.getContext('2d');
    this.tex = new THREE.CanvasTexture(this.canvas);
    this.tex.colorSpace = THREE.SRGBColorSpace;
    this.tex.anisotropy = 4;
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(widthM, heightM),
      new THREE.MeshBasicMaterial({ map: this.tex, transparent, depthWrite: !transparent, toneMapped: false }));
    this.w = pxW; this.h = pxH;
  }
  flush() { this.tex.needsUpdate = true; }
}

export function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

export const FONT = 'system-ui, "Segoe UI", Roboto, sans-serif';
export const C = {
  bg: 'rgba(12,17,30,0.94)', card: '#1b2438', line: '#2c3954', text: '#eef3ff', dim: '#93a3c4',
  accent: '#ff7a1a', accent2: '#2fb8ff', sel: '#2a6df0', good: '#58d68d', bad: '#ff5a5a',
};

// A menu you build every redraw from a render function: ui.button(...) both
// draws a button and remembers where it is for hover and click.
export class Menu extends CanvasBoard {
  constructor(widthM, heightM, pxW, pxH, render, onClick) {
    super(widthM, heightM, pxW, pxH);
    this.render = render;
    this.onClick = onClick;
    this.buttons = [];
    this.hoverId = null;
  }

  redraw() {
    const g = this.g;
    this.buttons = [];
    g.clearRect(0, 0, this.w, this.h);
    roundRect(g, 4, 4, this.w - 8, this.h - 8, 36);
    g.fillStyle = C.bg; g.fill();
    g.strokeStyle = C.line; g.lineWidth = 4; g.stroke();
    this.render(this.ui());
    this.flush();
  }

  ui() {
    const g = this.g, self = this;
    return {
      g, w: this.w, h: this.h,
      text(s, x, y, { size = 36, weight = 600, color = C.text, align = 'left', base = 'alphabetic' } = {}) {
        g.font = `${weight} ${size}px ${FONT}`; g.fillStyle = color; g.textAlign = align; g.textBaseline = base;
        g.fillText(s, x, y);
      },
      button(id, x, y, w, h, label, { selected = false, primary = false, size = 34, disabled = false, sub = null } = {}) {
        const hover = self.hoverId === id && !disabled;
        roundRect(g, x, y, w, h, Math.min(22, h / 2));
        g.fillStyle = primary ? (hover ? '#ff9445' : C.accent) : selected ? C.sel : hover ? '#2a3753' : C.card;
        g.fill();
        g.lineWidth = hover || selected ? 4 : 2;
        g.strokeStyle = hover ? '#ffffff' : selected ? '#7fb0ff' : C.line;
        g.stroke();
        g.font = `${primary ? 800 : 650} ${size}px ${FONT}`;
        g.fillStyle = disabled ? '#5d6b88' : '#ffffff'; g.textAlign = 'center'; g.textBaseline = 'middle';
        g.fillText(label, x + w / 2, y + h / 2 + (sub ? -12 : 2));
        if (sub) { g.font = `500 ${Math.round(size * 0.6)}px ${FONT}`; g.fillStyle = selected ? '#d8e6ff' : C.dim; g.fillText(sub, x + w / 2, y + h / 2 + 22); }
        if (!disabled) self.buttons.push({ id, x, y, w, h });
      },
      // A row of option buttons; returns nothing, ids are `${key}:${value}`.
      options(key, x, y, w, h, opts, current, gap = 14) {
        const bw = (w - gap * (opts.length - 1)) / opts.length;
        opts.forEach(([value, label, sub], i) => this.button(`${key}:${value}`, x + i * (bw + gap), y, bw, h, label, { selected: current === value, sub, size: 30 }));
      },
    };
  }

  _at(uv) {
    const x = uv.x * this.w, y = (1 - uv.y) * this.h;
    return this.buttons.find(b => x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h)?.id ?? null;
  }

  hover(uv) {
    const id = uv ? this._at(uv) : null;
    if (id !== this.hoverId) { this.hoverId = id; this.redraw(); return true; }
    return false;
  }

  click(uv) {
    const id = this._at(uv);
    if (id) this.onClick(id);
    return id;
  }
}
