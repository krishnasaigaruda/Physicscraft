// Procedural sound: every effect is synthesised live with Web Audio (no sound files). One-shot sounds come from world
// events (explosions, impacts, splashes, shattering, spawns, fireworks); continuous beds follow the world state (fire
// crackle, boiling/sizzling, lava rumble, wind, rain). Sounds fade with distance from the camera.
(function (PC) {
  'use strict';

  class Audio {
    constructor(view) {
      this.view = view; this.ctx = null; this.enabled = true; this.volume = 0.7;
      const start = () => this.init();
      window.addEventListener('pointerdown', start, { once: true });
      window.addEventListener('keydown', start, { once: true });
    }
    init() {
      if (this.ctx) return;
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      const ctx = this.ctx = new AC();
      this.master = ctx.createGain(); this.master.gain.value = this.enabled ? this.volume : 0;
      const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -14; comp.ratio.value = 6;
      this.master.connect(comp); comp.connect(ctx.destination);
      // Noise sources.
      const len = ctx.sampleRate * 2, white = ctx.createBuffer(1, len, ctx.sampleRate), brown = ctx.createBuffer(1, len, ctx.sampleRate);
      const w = white.getChannelData(0), b = brown.getChannelData(0);
      let last = 0;
      for (let i = 0; i < len; i++) { w[i] = Math.random() * 2 - 1; last = (last + 0.02 * w[i]) / 1.02; b[i] = last * 3.5; }
      this.white = white; this.brown = brown;
      // Continuous beds: looping noise → filter → gain.
      const bed = (buf, type, freq, q) => {
        const src = ctx.createBufferSource(); src.buffer = buf; src.loop = true;
        const fl = ctx.createBiquadFilter(); fl.type = type; fl.frequency.value = freq; fl.Q.value = q || 0.7;
        const g = ctx.createGain(); g.gain.value = 0;
        src.connect(fl); fl.connect(g); g.connect(this.master); src.start();
        return { g, fl };
      };
      this.beds = {
        sizzle: bed(white, 'highpass', 3200, 0.5),
        boil: bed(brown, 'bandpass', 380, 1.2),
        rumble: bed(brown, 'lowpass', 120, 0.8),
        wind: bed(brown, 'lowpass', 500, 0.5),
        rain: bed(white, 'bandpass', 5200, 0.4),
        fire: bed(brown, 'bandpass', 900, 0.8),
      };
    }
    setEnabled(on) { this.enabled = on; if (this.master) this.master.gain.setTargetAtTime(on ? this.volume : 0, this.ctx.currentTime, 0.05); }
    setVolume(v) { this.volume = v; if (this.master && this.enabled) this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.05); }

    // Distance attenuation from the camera.
    near(x, y, z) {
      const c = this.view.camera.position, d = Math.hypot(c.x - x, c.y - y, c.z - z);
      return 1 / (1 + d * d * 0.08);
    }
    noise(dur, type, freq, q, gain, sweepTo, brown) {
      const ctx = this.ctx, t = ctx.currentTime;
      const src = ctx.createBufferSource(); src.buffer = brown ? this.brown : this.white;
      const fl = ctx.createBiquadFilter(); fl.type = type; fl.frequency.setValueAtTime(freq, t); fl.Q.value = q;
      if (sweepTo) fl.frequency.exponentialRampToValueAtTime(sweepTo, t + dur);
      const g = ctx.createGain(); g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      src.connect(fl); fl.connect(g); g.connect(this.master);
      src.start(t, Math.random() * 1.5); src.stop(t + dur + 0.05);
    }
    tone(freq, dur, gain, type, decayTo) {
      const ctx = this.ctx, t = ctx.currentTime;
      const o = ctx.createOscillator(); o.type = type || 'sine'; o.frequency.setValueAtTime(freq, t);
      if (decayTo) o.frequency.exponentialRampToValueAtTime(decayTo, t + dur);
      const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(gain, t + 0.005); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g); g.connect(this.master); o.start(t); o.stop(t + dur + 0.05);
    }

    // ------------------------------------------------------------------ one-shots
    event(e) {
      if (!this.ctx || !this.enabled) return;
      const k = e.x != null ? this.near(e.x, e.y || 0, e.z || 0) : 0.5;
      if (k < 0.01) return;
      switch (e.type) {
        case 'explosion': {
          const P = Math.min(1, Math.sqrt(e.power || 1) / 8);
          if (e.annihilation) { this.tone(1800, 0.6, 0.5 * k, 'sine', 120); this.noise(1.2, 'highpass', 2000, 0.5, 0.6 * k); break; }
          this.noise(0.6 + 2.2 * P, 'lowpass', 2400, 0.6, (0.5 + 0.6 * P) * k, 90, true);
          this.tone(70, 0.5 + P, (0.4 + 0.5 * P) * k, 'sine', 32);
          this.noise(0.25, 'highpass', 1500, 0.5, 0.35 * k);
          break;
        }
        case 'impact': {
          const v = Math.min(1, e.v / 8), g = (0.08 + 0.5 * v) * k;
          const m = PC.MAT[e.mat] || {};
          if (m.metallic || (m.el && m.el.metal)) { this.tone(1400 + Math.random() * 900, 0.5, g * 0.35, 'triangle'); this.tone(3100 + Math.random() * 600, 0.3, g * 0.2, 'sine'); this.noise(0.05, 'highpass', 2500, 0.7, g * 0.6); }
          else if (e.mat === 'glass' || e.mat === 'water') { this.tone(2600 + Math.random() * 1200, 0.25, g * 0.35, 'sine'); this.noise(0.04, 'highpass', 4000, 0.7, g * 0.5); }
          else if (e.mat === 'wood' || (m.tags && m.tags.has('organic'))) { this.noise(0.12, 'bandpass', 520, 3, g); this.tone(240, 0.1, g * 0.4, 'triangle'); }
          else { this.noise(0.14, 'lowpass', 900, 1, g * 1.2, 200, true); this.tone(110, 0.12, g * 0.5, 'sine', 60); }
          break;
        }
        case 'splash': {
          const g = Math.min(0.8, 0.15 + e.v * 0.08) * k;
          this.noise(0.5, 'bandpass', 1800, 0.8, g, 300);
          this.noise(0.25, 'lowpass', 400, 1, g * 0.7, 80, true);
          break;
        }
        case 'shatter': {
          this.noise(0.4, 'highpass', 3000, 0.6, 0.5 * k);
          for (let n = 0; n < 9; n++) setTimeout(() => this.ctx && this.tone(2500 + Math.random() * 4500, 0.12 + Math.random() * 0.25, 0.12 * k, 'sine'), n * (20 + Math.random() * 40));
          break;
        }
        case 'spawn': this.noise(0.25, 'bandpass', 900, 1.5, 0.08 * k, 2600); break;
        case 'firework': this.noise(1.4, 'lowpass', 3000, 0.5, 0.6 * k, 120, true); for (let n = 0; n < 14; n++) setTimeout(() => this.ctx && this.noise(0.05, 'highpass', 3000, 1, 0.15 * k), 300 + n * 60 * Math.random() * 3); break;
        case 'invention': this.tone(660, 0.15, 0.15, 'triangle'); setTimeout(() => this.ctx && this.tone(990, 0.3, 0.15, 'triangle'), 120); break;
        case 'label': if (e.text && /^Burst/.test(e.text)) this.noise(0.5, 'lowpass', 1800, 0.7, 0.6 * k, 150, true); break;
      }
    }

    // ------------------------------------------------------------------ continuous beds (call ~10×/s)
    ambience() {
      if (!this.ctx || !this.enabled) return;
      const v = this.view, f = v.sim.fluid, s = v.s, cam = v.camera.position;
      let fire = 0, boil = 0, sizzle = 0, lava = 0;
      const FIRE = f.FIRE;
      // Sample up to ~2000 particles for speed, weighted by distance to the camera.
      const step = Math.max(1, Math.floor(f.nAct / 2000));
      for (let k = 0; k < f.nAct; k += step) {
        const i = f.act[k];
        if (!f.alive[i]) continue;
        const dx = f.x[i] - cam.x, dy = f.y[i] - cam.y, dz = f.z[i] - cam.z, w = step / (1 + (dx * dx + dy * dy + dz * dz) * 0.08);
        const mi = f.mat[i], ph = f.phase[i], T = f.T[i];
        if (mi === FIRE) fire += w;
        else if (f.matIsWater[mi] && ph === 2 && T > 365) boil += w;
        else if (f.matIsWater[mi] && ph === 3 && T > 400 && f.age[i] < 0.6) sizzle += w;
        else if (ph === 2 && T > 900 && !PC.MATS[mi].metallic) lava += w;
      }
      const t = this.ctx.currentTime, set = (b, val) => this.beds[b].g.gain.setTargetAtTime(val, t, 0.25);
      set('fire', Math.min(0.35, fire * 0.004));
      set('boil', Math.min(0.3, boil * 0.003));
      set('sizzle', Math.min(0.25, sizzle * 0.01));
      set('rumble', Math.min(0.35, lava * 0.0015));
      set('wind', Math.min(0.25, Math.max(0, s.windSpeed - 0.5) * 0.02));
      set('rain', Math.min(0.3, (s.rain || 0) * 0.3));
      // Crackle: random pops while something burns.
      if (fire > 2 && Math.random() < Math.min(0.9, fire * 0.01)) this.noise(0.02 + Math.random() * 0.03, 'highpass', 1500 + Math.random() * 3000, 1, Math.min(0.25, 0.05 + fire * 0.001));
    }
  }
  PC.Audio = Audio;
})(window.PC);
