// Animated Bohr model: nucleus of protons/neutrons plus electrons orbiting in their shells.
(function (PC) {
  'use strict';

  class AtomView {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.el = null;
      this.t = 0;
      this.raf = 0;
      this.nucleus = [];
    }

    show(el, color) {
      this.el = el;
      this.color = color || '#7cc4ff';
      // Pre-place nucleons in a packed cluster.
      const n = Math.min(40, Math.round(el.mass));
      const protons = Math.min(el.Z, Math.round(n * el.Z / el.mass));
      this.nucleus = [];
      for (let k = 0; k < n; k++) {
        const a = k * 2.399963, r = Math.sqrt(k) * 2.2;
        this.nucleus.push([Math.cos(a) * r, Math.sin(a) * r, k < protons]);
      }
      this.nucleus.sort(() => Math.random() - 0.5);
      if (!this.raf) this.loop();
    }

    stop() { cancelAnimationFrame(this.raf); this.raf = 0; }

    loop() {
      this.raf = requestAnimationFrame(() => this.loop());
      if (!this.canvas.isConnected) { this.stop(); return; }
      this.t += 1;
      this.draw();
    }

    draw() {
      const c = this.canvas, ctx = this.ctx, el = this.el;
      const dpr = window.devicePixelRatio || 1;
      const W = c.clientWidth, H = c.clientHeight;
      if (c.width !== Math.round(W * dpr)) { c.width = Math.round(W * dpr); c.height = Math.round(H * dpr); }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);
      if (!el) return;
      const cx = W / 2, cy = H / 2;
      const shells = el.shells;
      const maxR = Math.min(W, H) / 2 - 8;
      const base = 16;
      const step = (maxR - base) / Math.max(1, shells.length);
      // Orbits.
      ctx.lineWidth = 1;
      for (let s = 0; s < shells.length; s++) {
        const r = base + step * (s + 1);
        ctx.strokeStyle = `rgba(150,180,255,${0.18 + 0.05 * s})`;
        ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
      }
      // Nucleus with a gentle jiggle.
      const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, 22);
      glow.addColorStop(0, this.color + 'aa'); glow.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = glow;
      ctx.beginPath(); ctx.arc(cx, cy, 22, 0, Math.PI * 2); ctx.fill();
      for (const [x, y, p] of this.nucleus) {
        const j = Math.sin(this.t * 0.15 + x * 3 + y) * 0.4;
        ctx.fillStyle = p ? '#ff6b6b' : '#b8c2d6';
        ctx.beginPath(); ctx.arc(cx + x + j, cy + y - j, 2.6, 0, Math.PI * 2); ctx.fill();
      }
      // Electrons: inner shells orbit faster (visual, not physical).
      for (let s = 0; s < shells.length; s++) {
        const r = base + step * (s + 1), n = shells[s];
        const speed = 0.03 / Math.sqrt(s + 1) * (s % 2 ? -1 : 1);
        for (let e = 0; e < n; e++) {
          const a = this.t * speed + (e / n) * Math.PI * 2 + s * 0.7;
          const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r;
          ctx.fillStyle = 'rgba(120,200,255,0.25)';
          ctx.beginPath(); ctx.arc(x, y, 4.5, 0, Math.PI * 2); ctx.fill();
          ctx.fillStyle = '#9fe0ff';
          ctx.beginPath(); ctx.arc(x, y, 2.2, 0, Math.PI * 2); ctx.fill();
        }
      }
      // Shell occupancy legend.
      ctx.fillStyle = 'rgba(200,215,255,0.7)';
      ctx.font = '10px "JetBrains Mono", monospace';
      ctx.fillText(shells.join('·'), 6, H - 6);
    }
  }

  PC.AtomView = AtomView;
})(window.PC);
