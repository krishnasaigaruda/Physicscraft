// Resting powders (sand, soil, salt, ash…) rendered the way terrain is: a height-field mesh rebuilt from the grains
// every frame, smoothed in space and time (so piles never "bubble"), dressed in photo-scanned PBR textures, with
// thousands of individual grains scattered over the surface so close up you can see the sand grains themselves.
(function (PC) {
  'use strict';

  const STYLES = {
    sand: { tex: 'sand_01', pbr: true, uv: 1.6, grain: '#d9bd84' },
    soil: { tex: 'brown_mud_02', pbr: true, uv: 1.3, grain: '#5e4a36' },
    fine: { tex: 'sand_01', pbr: false, uv: 3.0, grain: null },
    // Mud: wet soil — darker, with a damp sheen.
    mud: { tex: 'brown_mud_02', pbr: true, uv: 1.3, grain: '#3a2a1c', wet: true },
  };
  const MAX_V = 120000, MAX_GRAINS = 150000;

  function hash(n) { n = (n ^ 61) ^ (n >>> 16); n = (n + (n << 3)) | 0; n ^= n >>> 4; n = Math.imul(n, 0x27d4eb2d); n ^= n >>> 15; return (n >>> 0) / 4294967296; }

  class PileSurfaces {
    constructor(view) {
      const THREE = view.THREE;
      this.view = view; this.T = THREE;
      this.cell = 0.025;
      this.layers = {};
      for (const key in STYLES) {
        const st = STYLES[key];
        const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, metalness: 0, vertexColors: true });
        if (st.pbr) view.tex.applyPBR(mat, st.tex, 1, { res: '2k', normalScale: 1.6, roughness: st.wet ? 0.38 : 1 });
        else view.tex.applyGrainTexture(mat, st.tex, 1);
        const geo = new THREE.BufferGeometry();
        const pos = new Float32Array(MAX_V * 3), nor = new Float32Array(MAX_V * 3), uv = new Float32Array(MAX_V * 2), col = new Float32Array(MAX_V * 3), idx = new Uint32Array(MAX_V * 6);
        geo.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
        geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3).setUsage(THREE.DynamicDrawUsage));
        geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2).setUsage(THREE.DynamicDrawUsage));
        geo.setAttribute('color', new THREE.BufferAttribute(col, 3).setUsage(THREE.DynamicDrawUsage));
        geo.setIndex(new THREE.BufferAttribute(idx, 1).setUsage(THREE.DynamicDrawUsage));
        geo.setDrawRange(0, 0);
        const mesh = new THREE.Mesh(geo, mat);
        mesh.castShadow = true; mesh.receiveShadow = true; mesh.frustumCulled = false;
        view.scene.add(mesh);
        // Individual grains on the surface.
        const gg = new THREE.BufferGeometry();
        const gp = new Float32Array(MAX_GRAINS * 3), gc = new Float32Array(MAX_GRAINS * 3);
        gg.setAttribute('position', new THREE.BufferAttribute(gp, 3).setUsage(THREE.DynamicDrawUsage));
        gg.setAttribute('color', new THREE.BufferAttribute(gc, 3).setUsage(THREE.DynamicDrawUsage));
        gg.setDrawRange(0, 0);
        const grains = new THREE.Points(gg, new THREE.PointsMaterial({ size: 0.0032, sizeAttenuation: true, vertexColors: true }));
        grains.frustumCulled = false;
        view.scene.add(grains);
        this.layers[key] = { st, mesh, geo, pos, nor, uv, col, idx, grains, gp, gc, hist: new Map() };
      }
    }

    // lists: { style: [particle indices] } — resting powder grains of each surface style.
    update(lists) {
      for (const key in this.layers) this.build(this.layers[key], lists[key] || []);
    }

    build(L, ids) {
      const f = this.view.sim.fluid, sp = f.sp, r = f.r;
      if (!ids.length) { L.geo.setDrawRange(0, 0); L.grains.geometry.setDrawRange(0, 0); L.hist.clear(); return; }
      const Rs = sp * 0.85;
      let x0 = 1e9, x1 = -1e9, z0 = 1e9, z1 = -1e9;
      for (const i of ids) { const x = f.x[i], z = f.z[i]; if (x < x0) x0 = x; if (x > x1) x1 = x; if (z < z0) z0 = z; if (z > z1) z1 = z; }
      let c = this.cell;
      const area = (x1 - x0 + 2 * Rs + 14 * c) * (z1 - z0 + 2 * Rs + 14 * c);
      if (area / (c * c) > MAX_V * 0.9) c = Math.sqrt(area / (MAX_V * 0.9));
      const gx0 = Math.floor((x0 - Rs) / c) - 6, gz0 = Math.floor((z0 - Rs) / c) - 6;
      const nx = Math.ceil((x1 + Rs) / c) + 7 - gx0, nz = Math.ceil((z1 + Rs) / c) + 7 - gz0, N = nx * nz;
      if (!this.top || this.top.length < N) {
        this.top = new Float32Array(N * 2); this.bot = new Float32Array(N * 2); this.tmp = new Float32Array(N * 2);
        this.cr = new Float32Array(N * 2); this.cg = new Float32Array(N * 2); this.cb = new Float32Array(N * 2); this.cn = new Float32Array(N * 2);
        this.vid = new Int32Array(N * 2); this.state = new Uint8Array(N * 2);
      }
      const top = this.top, bot = this.bot, tmp = this.tmp, cr = this.cr, cg = this.cg, cb = this.cb, cn = this.cn, state = this.state, vid = this.vid;
      top.fill(-1e9, 0, N); bot.fill(1e9, 0, N); cr.fill(0, 0, N); cg.fill(0, 0, N); cb.fill(0, 0, N); cn.fill(0, 0, N); state.fill(0, 0, N);
      const C = [0, 0, 0, 0, 0, 0], R2 = Rs * Rs, view = this.view;
      // Splat every grain as a rounded cap into the height grid.
      for (const i of ids) {
        const x = f.x[i], y = f.y[i], z = f.z[i];
        view.particleColor(i, C);
        const i0 = Math.max(0, Math.floor((x - Rs) / c) - gx0), i1 = Math.min(nx - 1, Math.ceil((x + Rs) / c) - gx0);
        const k0 = Math.max(0, Math.floor((z - Rs) / c) - gz0), k1 = Math.min(nz - 1, Math.ceil((z + Rs) / c) - gz0);
        for (let k = k0; k <= k1; k++) {
          const dz = (gz0 + k) * c - z;
          for (let j = i0; j <= i1; j++) {
            const dx = (gx0 + j) * c - x, d2 = dx * dx + dz * dz;
            if (d2 >= R2) continue;
            const q = k * nx + j, h = y + Math.sqrt(R2 - d2) * 0.7;
            if (h > top[q]) top[q] = h;
            if (y - r < bot[q]) bot[q] = y - r;
            const w = 1 - d2 / R2;
            cr[q] += C[0] * w; cg[q] += C[1] * w; cb[q] += C[2] * w; cn[q] += w;
            state[q] = 1;
          }
        }
      }
      // Rim: up to 4 rings of uncovered cells around the pile slope down to the pile's base, so its edge tapers to
      // nothing like real sand instead of ending in a cliff. The outermost ring is pinned to the base.
      const RINGS = 4;
      for (let ring = 1; ring <= RINGS; ring++) {
        for (let k = 0; k < nz; k++) for (let j = 0; j < nx; j++) {
          const q = k * nx + j;
          if (state[q]) continue;
          let b = 1e9, found = false;
          for (let bb = -1; bb <= 1; bb++) { const kk = k + bb; if (kk < 0 || kk >= nz) continue; for (let a = -1; a <= 1; a++) { const jj = j + a; if (jj < 0 || jj >= nx) continue; const qq = kk * nx + jj; if (state[qq] && state[qq] <= ring) { found = true; if (bot[qq] < b) b = bot[qq]; } } }
          // The outer ring dips just below what the pile rests on, so its silhouette is where the slope meets the ground.
          if (found) { state[q] = ring + 1; bot[q] = b; top[q] = ring === RINGS ? b - 0.03 : Math.max(0.001, b + 0.002); }
        }
      }
      // Spatial smoothing over covered cells (removes the per-grain bumps), twice with a 5×5 box.
      for (let pass = 0; pass < 3; pass++) {
        for (let k = 0; k < nz; k++) for (let j = 0; j < nx; j++) {
          const q = k * nx + j;
          if (!state[q] || state[q] === RINGS + 1) { tmp[q] = top[q]; continue; }
          let s = 0, n = 0;
          for (let b = -2; b <= 2; b++) { const kk = k + b; if (kk < 0 || kk >= nz) continue; for (let a = -2; a <= 2; a++) { const jj = j + a; if (jj < 0 || jj >= nx) continue; const qq = kk * nx + jj; if (state[qq]) { s += top[qq]; n++; } } }
          tmp[q] = s / n;
        }
        top.set(tmp.subarray(0, N));
      }
      // Temporal smoothing keyed by world cell, so a settling pile glides instead of flickering.
      const hist = L.hist, next = new Map();
      for (let k = 0; k < nz; k++) for (let j = 0; j < nx; j++) {
        const q = k * nx + j;
        if (!state[q]) continue;
        const key = (gx0 + j + 400000) * 1000000 + (gz0 + k + 400000);
        const prev = hist.get(key);
        let h = top[q];
        // Ignore millimetre jitter; ease real changes in.
        if (prev !== undefined && Math.abs(prev - h) < 0.08) h = Math.abs(h - prev) < 0.004 ? prev : prev + (h - prev) * 0.15;
        top[q] = h;
        next.set(key, h);
      }
      L.hist = next;
      // Rim cells have no grains of their own: spread the pile's colour outward ring by ring (else they render black).
      for (let pass = 0; pass < RINGS + 1; pass++) {
        for (let k = 0; k < nz; k++) for (let j = 0; j < nx; j++) {
          const q = k * nx + j;
          if (!state[q] || cn[q] > 0) continue;
          let R = 0, G = 0, Bc = 0, W = 0;
          for (let bb = -1; bb <= 1; bb++) for (let a = -1; a <= 1; a++) {
            const kk = k + bb, jj = j + a;
            if (kk < 0 || kk >= nz || jj < 0 || jj >= nx) continue;
            const qq = kk * nx + jj, w = cn[qq];
            if (w > 0) { R += cr[qq] / w; G += cg[qq] / w; Bc += cb[qq] / w; W++; }
          }
          if (W) { cr[q] = R / W * 1e-3; cg[q] = G / W * 1e-3; cb[q] = Bc / W * 1e-3; cn[q] = 1e-3; }
        }
      }
      // Vertices.
      const st = L.st, pos = L.pos, uv = L.uv, col = L.col, idx = L.idx, nor = L.nor;
      let nv = 0;
      for (let k = 0; k < nz; k++) for (let j = 0; j < nx; j++) {
        const q = k * nx + j;
        if (!state[q] || nv >= MAX_V) { vid[q] = -1; continue; }
        vid[q] = nv;
        const x = (gx0 + j) * c, z = (gz0 + k) * c;
        pos[nv * 3] = x; pos[nv * 3 + 1] = top[q]; pos[nv * 3 + 2] = z;
        uv[nv * 2] = x * st.uv; uv[nv * 2 + 1] = z * st.uv;
        if (st.pbr) { const w = st.wet ? 0.55 : 1; col[nv * 3] = w; col[nv * 3 + 1] = w * 0.95; col[nv * 3 + 2] = w * 0.9; }
        else {
          // Neighbouring skirt cells borrow the colour of the pile next to them.
          let w = cn[q], R = cr[q], G = cg[q], B = cb[q];
          if (w <= 0) { for (let bb = -1; bb <= 1; bb++) for (let a = -1; a <= 1; a++) { const kk = k + bb, jj = j + a; if (kk < 0 || kk >= nz || jj < 0 || jj >= nx) continue; const qq = kk * nx + jj; R += cr[qq]; G += cg[qq]; B += cb[qq]; w += cn[qq]; } }
          w = w || 1;
          col[nv * 3] = Math.min(1, R / w); col[nv * 3 + 1] = Math.min(1, G / w); col[nv * 3 + 2] = Math.min(1, B / w);
        }
        nv++;
      }
      // Triangles (quads whose corners all exist and touch the pile).
      let ni = 0;
      for (let k = 0; k < nz - 1; k++) for (let j = 0; j < nx - 1; j++) {
        const q = k * nx + j, a = vid[q], b = vid[q + 1], d = vid[q + nx], e = vid[q + nx + 1];
        if (a < 0 || b < 0 || d < 0 || e < 0) continue;
        idx[ni++] = a; idx[ni++] = d; idx[ni++] = b;
        idx[ni++] = b; idx[ni++] = d; idx[ni++] = e;
      }
      // Normals from the height grid (central differences).
      for (let k = 0; k < nz; k++) for (let j = 0; j < nx; j++) {
        const q = k * nx + j, v = vid[q];
        if (v < 0) continue;
        const hl = j > 0 && vid[q - 1] >= 0 ? top[q - 1] : top[q], hr = j < nx - 1 && vid[q + 1] >= 0 ? top[q + 1] : top[q];
        const hd = k > 0 && vid[q - nx] >= 0 ? top[q - nx] : top[q], hu = k < nz - 1 && vid[q + nx] >= 0 ? top[q + nx] : top[q];
        let ax = (hl - hr), ay = 2 * c, az = (hd - hu);
        const l = Math.hypot(ax, ay, az);
        nor[v * 3] = ax / l; nor[v * 3 + 1] = ay / l; nor[v * 3 + 2] = az / l;
      }
      const g = L.geo;
      g.setDrawRange(0, ni);
      for (const name of ['position', 'normal', 'uv', 'color']) { const at = g.attributes[name]; at.needsUpdate = true; at.updateRanges = [{ start: 0, count: nv * at.itemSize }]; }
      g.index.needsUpdate = true; g.index.updateRanges = [{ start: 0, count: ni }];
      g.boundingSphere = null;
      this.sprinkle(L, nx, nz, gx0, gz0, c);
    }

    // Loose grains lying on the surface near the camera: varied shades like real mineral sand.
    sprinkle(L, nx, nz, gx0, gz0, c) {
      const cam = this.view.camera.position, top = this.top, state = this.state, gp = L.gp, gc = L.gc, st = L.st;
      const base = st.grain ? new this.T.Color(st.grain) : null;
      let n = 0;
      const per = 4;
      for (let k = 1; k < nz - 1 && n < MAX_GRAINS - per; k++) {
        const z = (gz0 + k) * c;
        for (let j = 1; j < nx - 1; j++) {
          const q = k * nx + j;
          if (state[q] !== 1) continue;
          const x = (gx0 + j) * c, h = top[q];
          const dx = x - cam.x, dy = h - cam.y, dz = z - cam.z;
          if (dx * dx + dy * dy + dz * dz > 9) continue;
          const sx = (top[q + 1] - top[q - 1]) / (2 * c), sz = (top[q + nx] - top[q - nx]) / (2 * c);
          let R, G, B;
          if (base) { R = base.r; G = base.g; B = base.b; }
          else { const w = this.cn[q] || 1; R = this.cr[q] / w; G = this.cg[q] / w; B = this.cb[q] / w; }
          const key = (gx0 + j) * 92837111 ^ (gz0 + k) * 689287499;
          for (let t = 0; t < per; t++) {
            const u = hash(key + t * 7919) - 0.5, v = hash(key + t * 104729 + 3) - 0.5, s = hash(key + t * 31337 + 11);
            const ox = u * c, oz = v * c;
            gp[n * 3] = x + ox; gp[n * 3 + 1] = h + sx * ox + sz * oz + 0.0012; gp[n * 3 + 2] = z + oz;
            // Most grains near the base colour; some dark (feldspar, magnetite) and some bright (quartz) ones.
            const sh = s < 0.08 ? 0.35 : s > 0.93 ? 1.5 : 0.75 + s * 0.45;
            gc[n * 3] = Math.min(1, R * sh); gc[n * 3 + 1] = Math.min(1, G * sh); gc[n * 3 + 2] = Math.min(1, B * sh);
            n++;
          }
        }
      }
      const g = L.grains.geometry;
      g.setDrawRange(0, n);
      g.attributes.position.needsUpdate = true; g.attributes.color.needsUpdate = true;
      g.attributes.position.updateRanges = [{ start: 0, count: n * 3 }]; g.attributes.color.updateRanges = [{ start: 0, count: n * 3 }];
    }
  }

  PC.PileSurfaces = PileSurfaces;
})(window.PC);
