// Textures: Poly Haven CC0 PBR sets (loaded asynchronously) with procedural canvas fallbacks,
// plus procedural sprites (smoke puffs) and text labels.
(function (PC) {
  'use strict';

  const PH = 'https://dl.polyhaven.org/file/ph-assets/';
  PC.ASSETS = {
    hdri: PH + 'HDRIs/hdr/2k/chinese_garden_2k.hdr',
    tex: (id, map, res) => `${PH}Textures/jpg/${res || '1k'}/${id}/${id}_${map}_${res || '1k'}.jpg`,
    model: (id, res) => `${PH}Models/gltf/${res || '1k'}/${id}/${id}_${res || '1k'}.gltf`,
  };

  // Deterministic value noise.
  function hash(x, y) { const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return s - Math.floor(s); }
  function vnoise(x, y) {
    const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
    const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    const a = hash(xi, yi), b = hash(xi + 1, yi), c = hash(xi, yi + 1), d = hash(xi + 1, yi + 1);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  }
  function fbm(x, y, oct) { let s = 0, a = 0.5, f = 1; for (let o = 0; o < (oct || 5); o++) { s += a * vnoise(x * f, y * f); a *= 0.5; f *= 2; } return s; }
  PC.fbm = fbm;

  class Textures {
    constructor(THREE, renderer) {
      this.T = THREE;
      this.renderer = renderer;
      this.loader = new THREE.TextureLoader();
      this.loader.setCrossOrigin('anonymous');
      this.cache = new Map();
      this.maxAniso = renderer.capabilities.getMaxAnisotropy();
      this.online = true;
    }

    canvas(w, h, fn) {
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      fn(c.getContext('2d'), w, h);
      return c;
    }
    fromCanvas(c, srgb, repeat) {
      const t = new this.T.CanvasTexture(c);
      if (srgb) t.colorSpace = this.T.SRGBColorSpace;
      t.wrapS = t.wrapT = this.T.RepeatWrapping;
      if (repeat) t.repeat.set(repeat, repeat);
      t.anisotropy = this.maxAniso;
      return t;
    }

    // Height-field → tangent-space normal map.
    normalFromHeight(h, w, hh, strength) {
      return this.canvas(w, hh, (g) => {
        const img = g.createImageData(w, hh);
        for (let y = 0; y < hh; y++) for (let x = 0; x < w; x++) {
          const l = h[y * w + ((x - 1 + w) % w)], r = h[y * w + ((x + 1) % w)];
          const u = h[((y - 1 + hh) % hh) * w + x], d = h[((y + 1) % hh) * w + x];
          let nx = (l - r) * strength, ny = (u - d) * strength, nz = 1;
          const L = Math.hypot(nx, ny, nz); nx /= L; ny /= L; nz /= L;
          const o = (y * w + x) * 4;
          img.data[o] = (nx * 0.5 + 0.5) * 255; img.data[o + 1] = (ny * 0.5 + 0.5) * 255; img.data[o + 2] = (nz * 0.5 + 0.5) * 255; img.data[o + 3] = 255;
        }
        g.putImageData(img, 0, 0);
      });
    }

    // Procedural material sets (instant, offline-safe).
    procedural(kind) {
      const key = 'proc:' + kind;
      if (this.cache.has(key)) return this.cache.get(key);
      const N = 256, h = new Float32Array(N * N);
      let colorFn, rough = 0.8, strength = 3;
      if (kind === 'rock') {
        for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) h[y * N + x] = fbm(x / 32, y / 32, 6);
        colorFn = (v) => { const c = 90 + v * 90; return [c, c * 0.98, c * 0.95]; }; strength = 6;
      } else if (kind === 'wood') {
        for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
          const n = fbm(x / 64, y / 8, 4);
          h[y * N + x] = 0.5 + 0.5 * Math.sin((y / N) * 40 + n * 6);
        }
        colorFn = (v) => [120 + v * 60, 78 + v * 40, 42 + v * 20]; rough = 0.7; strength = 2;
      } else if (kind === 'brushed') {
        for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) h[y * N + x] = fbm(x / 128, y / 1.2, 3) * 0.6 + hash(x * 0.01, y) * 0.4;
        colorFn = (v) => { const c = 200 + v * 40; return [c, c, c]; }; rough = 0.35; strength = 1.2;
      } else if (kind === 'concrete') {
        for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) h[y * N + x] = fbm(x / 20, y / 20, 5) * 0.7 + hash(x, y) * 0.3;
        colorFn = (v) => { const c = 140 + v * 50; return [c, c * 0.99, c * 0.96]; }; strength = 2.5;
      } else {
        for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) h[y * N + x] = fbm(x / 24, y / 24, 6);
        colorFn = (v) => [60 + v * 50, 70 + v * 50, 40 + v * 30];
      }
      const map = this.fromCanvas(this.canvas(N, N, (g) => {
        const img = g.createImageData(N, N);
        for (let k = 0; k < N * N; k++) { const c = colorFn(h[k]); img.data[k * 4] = c[0]; img.data[k * 4 + 1] = c[1]; img.data[k * 4 + 2] = c[2]; img.data[k * 4 + 3] = 255; }
        g.putImageData(img, 0, 0);
      }), true);
      const normalMap = this.fromCanvas(this.normalFromHeight(h, N, N, strength), false);
      const set = { map, normalMap, roughness: rough };
      this.cache.set(key, set);
      return set;
    }

    // Poly Haven PBR set applied to `material` once loaded (fallback stays until then).
    applyPBR(material, id, repeat, opts) {
      opts = opts || {};
      const T = this.T;
      const load = (map, srgb) => new Promise((res) => {
        const url = PC.ASSETS.tex(id, map, opts.res);
        const key = url + '|' + repeat;
        if (this.cache.has(key)) { res(this.cache.get(key)); return; }
        this.loader.load(url, (t) => {
          t.wrapS = t.wrapT = T.RepeatWrapping;
          t.repeat.set(repeat, repeat);
          t.anisotropy = this.maxAniso;
          if (srgb) t.colorSpace = T.SRGBColorSpace;
          this.cache.set(key, t);
          res(t);
        }, undefined, () => res(null));
      });
      Promise.all([load('diff', true), load('nor_gl', false), load('arm', false)]).then(([d, n, a]) => {
        if (d) { material.map = d; if (opts.tint) material.color.set(opts.tint); else material.color.set(0xffffff); }
        if (n) { material.normalMap = n; if (opts.normalScale) material.normalScale.set(opts.normalScale, opts.normalScale); }
        if (a) { material.roughnessMap = a; material.aoMap = a; material.roughness = opts.roughness != null ? opts.roughness : 1; material.aoMapIntensity = 1; }
        material.needsUpdate = true;
        if (opts.onLoad) opts.onLoad();
      });
    }

    // Photo-scanned grain texture turned into a neutral detail map (colour comes from the material).
    applyGrainTexture(material, id, repeat) {
      const T = this.T;
      const prep = (t, srgb) => { t.wrapS = t.wrapT = T.RepeatWrapping; t.repeat.set(repeat, repeat); t.anisotropy = this.maxAniso; if (srgb) t.colorSpace = T.SRGBColorSpace; return t; };
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        const c = document.createElement('canvas');
        c.width = img.width; c.height = img.height;
        const g = c.getContext('2d');
        g.drawImage(img, 0, 0);
        const d = g.getImageData(0, 0, c.width, c.height), a = d.data;
        let sum = 0;
        for (let k = 0; k < a.length; k += 4) sum += 0.3 * a[k] + 0.59 * a[k + 1] + 0.11 * a[k + 2];
        const mean = sum / (a.length / 4), k2 = 215 / Math.max(1, mean);
        for (let k = 0; k < a.length; k += 4) {
          const l = Math.min(255, (0.3 * a[k] + 0.59 * a[k + 1] + 0.11 * a[k + 2]) * k2);
          a[k] = a[k + 1] = a[k + 2] = l;
        }
        g.putImageData(d, 0, 0);
        material.map = prep(new T.CanvasTexture(c), true);
        material.needsUpdate = true;
      };
      img.src = PC.ASSETS.tex(id, 'diff');
      this.loader.load(PC.ASSETS.tex(id, 'nor_gl'), (t) => { material.normalMap = prep(t); material.normalScale = new T.Vector2(1.4, 1.4); material.needsUpdate = true; });
      this.loader.load(PC.ASSETS.tex(id, 'arm'), (t) => { material.roughnessMap = prep(t); material.aoMap = material.roughnessMap; material.needsUpdate = true; });
    }

    smokeSprite() {
      if (this.cache.has('smoke')) return this.cache.get('smoke');
      const N = 128;
      const c = this.canvas(N, N, (g) => {
        const img = g.createImageData(N, N);
        for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
          const dx = (x - N / 2) / (N / 2), dy = (y - N / 2) / (N / 2), r = Math.sqrt(dx * dx + dy * dy);
          const n = fbm(x / 14 + 3, y / 14 + 7, 5);
          const a = Math.max(0, 1 - r) ** 1.6 * (0.45 + 0.9 * n);
          const o = (y * N + x) * 4;
          img.data[o] = img.data[o + 1] = img.data[o + 2] = 255; img.data[o + 3] = Math.min(255, a * 255);
        }
        g.putImageData(img, 0, 0);
      });
      const t = new this.T.CanvasTexture(c);
      this.cache.set('smoke', t);
      return t;
    }
    // Upright teardrop flame tongue with a hot core and turbulent edges.
    flameSprite() {
      if (this.cache.has('flame')) return this.cache.get('flame');
      const N = 128;
      const c = this.canvas(N, N, (g) => {
        const img = g.createImageData(N, N);
        for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
          const u = (x - N / 2) / (N / 2), v = (y - N * 0.62) / (N * 0.5);
          const w = v < 0 ? 0.55 + v * 0.45 : 0.55 - v * 0.2;
          const n = fbm(x / 10, y / 7, 4);
          const r = Math.abs(u) / Math.max(0.05, w) + (n - 0.5) * 0.5;
          const vert = v < 0 ? Math.max(0, 1 + v * 0.9) : Math.max(0, 1 - v * 1.6);
          const a = Math.max(0, 1 - r) * vert;
          const o = (y * N + x) * 4;
          img.data[o] = img.data[o + 1] = img.data[o + 2] = 255; img.data[o + 3] = Math.min(255, Math.pow(a, 1.3) * 255);
        }
        g.putImageData(img, 0, 0);
      });
      const t = new this.T.CanvasTexture(c);
      this.cache.set('flame', t);
      return t;
    }
    softSprite() {
      if (this.cache.has('soft')) return this.cache.get('soft');
      const c = this.canvas(64, 64, (g) => {
        const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
        grd.addColorStop(0, 'rgba(255,255,255,1)'); grd.addColorStop(0.3, 'rgba(255,255,255,0.6)'); grd.addColorStop(1, 'rgba(255,255,255,0)');
        g.fillStyle = grd; g.fillRect(0, 0, 64, 64);
      });
      const t = new this.T.CanvasTexture(c);
      this.cache.set('soft', t);
      return t;
    }
    label(text, color) {
      const c = this.canvas(256, 64, (g) => {
        g.font = '600 34px Inter, system-ui, sans-serif';
        g.textAlign = 'center'; g.textBaseline = 'middle';
        g.lineWidth = 6; g.strokeStyle = 'rgba(0,0,0,0.6)'; g.strokeText(text, 128, 32);
        g.fillStyle = color || '#fff'; g.fillText(text, 128, 32);
      });
      const t = new this.T.CanvasTexture(c);
      t.colorSpace = this.T.SRGBColorSpace;
      return t;
    }
  }

  PC.Textures = Textures;
})(window.PC);
