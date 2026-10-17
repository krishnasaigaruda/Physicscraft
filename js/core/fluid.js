// 3D particle engine (units: metres, seconds, Kelvin).
// Liquids: Position Based Fluids (Macklin & Müller 2013) with mass-weighted corrections so dense liquids sink.
// Powders: position-based contacts with Coulomb-style friction. Gases/fire: buoyant, drag-dominated particles.
// Frozen matter: particle spring networks. Colliders: rigid bodies and containers supplied by the simulation.
(function (PC) {
  'use strict';

  const SOLID = 0, POWDER = 1, LIQUID = 2, GAS = 3;
  PC.PHASE = { SOLID, POWDER, LIQUID, GAS };
  const F_FREE = 1, F_FROZE = 2, F_REACTED = 4, F_FLOOR = 8, F_BLAST = 16, F_SURF = 32, F_REST = 64;
  PC.PFLAGS = { F_FREE, F_FROZE, F_REACTED, F_FLOOR, F_BLAST, F_SURF };

  const TMP = [0, 0, 0];
  // Rotate v by quaternion q (x, y, z, w).
  function qrot(qx, qy, qz, qw, x, y, z, out) {
    const ix = qw * x + qy * z - qz * y, iy = qw * y + qz * x - qx * z, iz = qw * z + qx * y - qy * x, iw = -qx * x - qy * y - qz * z;
    out[0] = ix * qw + iw * -qx + iy * -qz - iz * -qy;
    out[1] = iy * qw + iw * -qy + iz * -qx - ix * -qz;
    out[2] = iz * qw + iw * -qz + ix * -qy - iy * -qx;
    return out;
  }
  PC.qrot = qrot;

  class Fluid {
    constructor(sim, settings) {
      this.sim = sim;
      this.s = settings;
      this.sp = 0.07;              // lattice spacing (m)
      this.r = this.sp * 0.5;      // particle radius
      this.h = this.sp * 2;        // smoothing radius
      this.cap = settings.maxParticles;
      this.frame = 0;
      this.events = sim.events;
      this.groups = [];
      this.defaultGroups = new Map();
      this.discovered = sim.discovered;
      this.reactionTable = PC.buildReactionTable();
      this.NM = PC.MATS.length;
      this.colliders = [];
      this.tune = { iters: 3, eps: 0.2, scorrK: 0.0015, cohesion: 0.06, floorFric: 0.18, xsph: 0.02 };

      const N = PC.MATS.length;
      this.matM = new Float32Array(N); this.matHeatOut = new Float32Array(N); this.matPowder = new Uint8Array(N);
      this.matFixedGas = new Uint8Array(N); this.matStatic = new Uint8Array(N); this.matSolidRatio = new Float32Array(N);
      this.matAcid = new Uint8Array(N); this.matIsWater = new Uint8Array(N);
      for (const m of PC.MATS) {
        this.matM[m.index] = m.M; this.matHeatOut[m.index] = m.heatOut; this.matPowder[m.index] = m.powder ? 1 : 0;
        this.matFixedGas[m.index] = m.life ? 1 : 0; this.matStatic[m.index] = m.tags.has('static') ? 1 : 0;
        this.matSolidRatio[m.index] = m.densitySolid ? m.densitySolid / m.density : 1;
        this.matAcid[m.index] = m.tags.has('acid') ? 1 : 0;
        this.matIsWater[m.index] = m.tags.has('water') ? 1 : 0;
      }
      this.FIRE = PC.matIndex('fire'); this.SMOKE = PC.matIndex('smoke'); this.AIR = PC.matIndex('air');

      // SPH kernels.
      const h = this.h;
      this.poly6 = 315 / (64 * Math.PI * Math.pow(h, 9));
      this.spiky = 45 / (Math.PI * Math.pow(h, 6));
      this.alloc(this.cap);
      this.hashSize = 1 << 18;
      this.head = new Int32Array(this.hashSize);
      this.calibrate();
    }

    alloc(cap) {
      const F = (n) => new Float32Array(n);
      this.x = F(cap); this.y = F(cap); this.z = F(cap); this.px = F(cap); this.py = F(cap); this.pz = F(cap);
      this.vx = F(cap); this.vy = F(cap); this.vz = F(cap); this.ovx = F(cap); this.ovy = F(cap); this.ovz = F(cap);
      this.dx = F(cap); this.dy = F(cap); this.dz = F(cap);
      this.T = F(cap); this.nd = F(cap); this.lam = F(cap); this.mass = F(cap); this.g2 = F(cap);
      this.gsx = F(cap); this.gsy = F(cap); this.gsz = F(cap); this.lqW = F(cap); this.lqM = F(cap);
      this.life = F(cap); this.maxLife = F(cap); this.age = F(cap); this.seed = F(cap);
      this.mat = new Int16Array(cap); this.tint = new Int16Array(cap).fill(-1);
      this.grp = new Int32Array(cap); this.gen = new Uint32Array(cap);
      this.phase = new Uint8Array(cap); this.flags = new Uint8Array(cap); this.still = new Uint8Array(cap); this.alive = new Uint8Array(cap);
      this.upN = new Uint8Array(cap); this.sN = new Uint8Array(cap);
      this.bind = new Int16Array(cap).fill(-1);
      this.cx = new Int32Array(cap); this.cy = new Int32Array(cap); this.cz = new Int32Array(cap);
      this.next = new Int32Array(cap);
      this.act = new Int32Array(cap); this.nAct = 0;
      this.free = new Int32Array(cap); this.freeTop = 0;
      for (let i = cap - 1; i >= 0; i--) this.free[this.freeTop++] = i;
      this.dead = new Int32Array(cap); this.nDead = 0;
      this.count = 0;
      this.pairCap = cap * 24;
      this.pI = new Int32Array(this.pairCap); this.pJ = new Int32Array(this.pairCap); this.nPairs = 0;
      this.sCap = cap * 8;
      this.sA = new Int32Array(this.sCap); this.sB = new Int32Array(this.sCap);
      this.sGA = new Uint32Array(this.sCap); this.sGB = new Uint32Array(this.sCap); this.sRest = new Float32Array(this.sCap); this.nS = 0;
    }

    calibrate() {
      const sp = this.sp, h = this.h, h2 = h * h;
      let n = 0;
      for (let a = -3; a <= 3; a++) for (let b = -3; b <= 3; b++) for (let c = -3; c <= 3; c++) {
        const d2 = (a * a + b * b + c * c) * sp * sp;
        if (d2 < h2) n += this.poly6 * Math.pow(h2 - d2, 3);
      }
      this.n0 = n * 0.98;
      // Constraint-gradient magnitude of a particle at rest, used to scale the PBF relaxation parameter.
      let g2 = 0;
      for (let a = -3; a <= 3; a++) for (let b = -3; b <= 3; b++) for (let c = -3; c <= 3; c++) {
        const d = Math.sqrt(a * a + b * b + c * c) * sp;
        if (d > 0 && d < h) { const g = this.spiky * (h - d) * (h - d) / this.n0; g2 += g * g; }
      }
      this.g2Rest = g2;
      this.epsAbs = this.tune.eps * g2;
      this.W0 = this.poly6 * Math.pow(h2, 3);
      const dq = 0.2 * h;
      this.Wdq = this.poly6 * Math.pow(h2 - dq * dq, 3);
    }

    // ------------------------------------------------------------------ groups (bodies of particles)
    createGroup(mat, props, name, extra) {
      const g = Object.assign({ id: this.groups.length, mat: mat.index, name: name || mat.name, props: Object.assign(PC.defaultProps(mat), props || {}), count: 0, kind: 'particles' }, extra || {});
      this.groups.push(g);
      this.cacheOne(g.id);
      return g;
    }
    defaultGroup(mi) {
      let g = this.defaultGroups.get(mi);
      if (!g || g.deleted) { g = this.createGroup(PC.MATS[mi], null, PC.MATS[mi].name, { auto: true }); this.defaultGroups.set(mi, g); }
      return g;
    }
    cacheGroups() {
      const n = this.groups.length;
      if (!this.gDens || this.gDens.length < n) {
        const m = Math.max(8192, n * 2), F = () => new Float32Array(m);
        this.gDens = F(); this.gGrav = F(); this.gFric = F(); this.gRest = F(); this.gVisc = F(); this.gStiff = F(); this.gStr = F();
        this.gCoh = F(); this.gPress = F(); this.gDrag = F(); this.gMp = F(); this.gBp = F(); this.gIgn = F(); this.gHeatCap = F();
        this.gCond = F(); this.gReact = F(); this.gExpl = F(); this.gRad = F(); this.gMassScale = F(); this.gPinned = new Uint8Array(m);
      }
      for (let k = 0; k < n; k++) this.cacheOne(k);
    }
    cacheOne(k) {
      if (!this.gDens || k >= this.gDens.length) { this.cacheGroups(); return; }
      {
        const p = this.groups[k].props;
        this.gDens[k] = p.density; this.gGrav[k] = p.gravity; this.gFric[k] = p.friction; this.gRest[k] = p.restitution;
        this.gVisc[k] = p.viscosity; this.gStiff[k] = p.stiffness; this.gStr[k] = p.strength; this.gCoh[k] = p.cohesion;
        this.gPress[k] = p.pressure; this.gDrag[k] = p.drag; this.gMp[k] = p.mp; this.gBp[k] = p.bp; this.gIgn[k] = p.ignite;
        this.gHeatCap[k] = p.heatCap; this.gCond[k] = p.cond; this.gReact[k] = p.reactivity; this.gExpl[k] = p.explosive;
        this.gRad[k] = p.radioactivity; this.gMassScale[k] = p.massScale; this.gPinned[k] = p.pinned ? 1 : 0;
      }
    }
    ensureCache(id) { if (!this.gDens || id >= this.gDens.length) this.cacheGroups(); }
    isPinned(i) { return this.gPinned[this.grp[i]] && !(this.flags[i] & F_FREE); }

    // ------------------------------------------------------------------ particle lifecycle
    add(mi, x, y, z, T, g, vx, vy, vz) {
      if (this.freeTop === 0) return -1;
      const i = this.free[--this.freeTop];
      const m = PC.MATS[mi];
      this.x[i] = this.px[i] = x; this.y[i] = this.py[i] = y; this.z[i] = this.pz[i] = z;
      this.vx[i] = this.ovx[i] = vx || 0; this.vy[i] = this.ovy[i] = vy || 0; this.vz[i] = this.ovz[i] = vz || 0;
      this.T[i] = T; this.mat[i] = mi; this.tint[i] = -1; this.still[i] = 0;
      const grp = g || this.defaultGroup(mi);
      this.grp[i] = grp.id; grp.count++;
      this.ensureCache(grp.id);
      this.gen[i]++; this.alive[i] = 1; this.flags[i] = 0; this.sN[i] = 0; this.upN[i] = 0; this.bind[i] = -1;
      this.age[i] = 0; this.seed[i] = Math.random();
      if (m.life) this.life[i] = this.maxLife[i] = (m.life[0] + Math.random() * (m.life[1] - m.life[0])) / 60;
      else this.life[i] = this.maxLife[i] = 0;
      this.phase[i] = this.phaseFor(i, grp.props);
      this.mass[i] = this.massFor(i, grp.props);
      this.act[this.nAct++] = i;
      this.count++;
      this.sim.discover(mi, this.phase[i]);
      return i;
    }
    kill(i) {
      if (!this.alive[i]) return;
      this.alive[i] = 0; this.gen[i]++;
      const g = this.groups[this.grp[i]];
      if (g) g.count--;
      this.dead[this.nDead++] = i;
      this.count--;
    }
    convert(i, id) {
      const mi = typeof id === 'number' ? id : PC.matIndex(id);
      if (mi < 0 || !this.alive[i] || mi === this.mat[i]) return;
      const old = this.groups[this.grp[i]];
      if (old) old.count--;
      const g = this.defaultGroup(mi);
      this.mat[i] = mi; this.grp[i] = g.id; g.count++;
      this.ensureCache(g.id);
      const m = PC.MATS[mi];
      if (m.life) this.life[i] = this.maxLife[i] = (m.life[0] + Math.random() * (m.life[1] - m.life[0])) / 60;
      else this.life[i] = this.maxLife[i] = 0;
      this.phase[i] = this.phaseFor(i, g.props);
      this.mass[i] = this.massFor(i, g.props);
      this.sim.discover(mi, this.phase[i], this.x[i], this.y[i], this.z[i]);
    }
    phaseFor(i, p) {
      const mi = this.mat[i];
      if (this.matFixedGas[mi]) return GAS;
      const T = this.T[i];
      if (T < p.mp) return this.matPowder[mi] ? POWDER : SOLID;
      if (T < p.bp) return LIQUID;
      return GAS;
    }
    massFor(i, p) {
      const mi = this.mat[i], ph = this.phase[i];
      let m = p.density * p.massScale;
      if (ph === GAS) m = (this.matM[mi] / 22414) * (293 / Math.max(this.T[i], 1)) * p.massScale;
      else if (ph <= POWDER) m *= this.matSolidRatio[mi];
      return Math.max(m, 1e-5);
    }
    kg(i) { return this.mass[i] * 1000 * this.sp * this.sp * this.sp; }

    // ------------------------------------------------------------------ springs
    addSpring(a, b) {
      if (this.nS >= this.sCap || this.sN[a] >= 14 || this.sN[b] >= 14) return;
      const k = this.nS++;
      this.sA[k] = a; this.sB[k] = b; this.sGA[k] = this.gen[a]; this.sGB[k] = this.gen[b];
      this.sRest[k] = Math.hypot(this.x[a] - this.x[b], this.y[a] - this.y[b], this.z[a] - this.z[b]);
      this.sN[a]++; this.sN[b]++;
    }
    removeSpring(k) {
      const a = this.sA[k], b = this.sB[k];
      if (this.alive[a] && this.gen[a] === this.sGA[k]) this.sN[a]--;
      if (this.alive[b] && this.gen[b] === this.sGB[k]) this.sN[b]--;
      const l = --this.nS;
      this.sA[k] = this.sA[l]; this.sB[k] = this.sB[l]; this.sGA[k] = this.sGA[l]; this.sGB[k] = this.sGB[l]; this.sRest[k] = this.sRest[l];
    }

    // ------------------------------------------------------------------ spatial hash
    compact() {
      let n = 0;
      const act = this.act, alive = this.alive;
      for (let k = 0; k < this.nAct; k++) { const i = act[k]; if (alive[i]) act[n++] = i; }
      this.nAct = n;
      for (let k = 0; k < this.nDead; k++) this.free[this.freeTop++] = this.dead[k];
      this.nDead = 0;
    }
    hash(cx, cy, cz) { return (Math.imul(cx, 92837111) ^ Math.imul(cy, 689287499) ^ Math.imul(cz, 283923481)) & (this.hashSize - 1); }
    buildGrid() {
      const head = this.head, next = this.next, act = this.act, alive = this.alive, inv = 1 / this.h;
      const x = this.x, y = this.y, z = this.z, CX = this.cx, CY = this.cy, CZ = this.cz, mask = this.hashSize - 1;
      head.fill(-1);
      for (let k = 0; k < this.nAct; k++) {
        const i = act[k];
        if (!alive[i]) continue;
        const cx = Math.floor(x[i] * inv), cy = Math.floor(y[i] * inv), cz = Math.floor(z[i] * inv);
        CX[i] = cx; CY[i] = cy; CZ[i] = cz;
        const key = (Math.imul(cx, 92837111) ^ Math.imul(cy, 689287499) ^ Math.imul(cz, 283923481)) & mask;
        next[i] = head[key]; head[key] = i;
      }
    }
    findPairs() {
      const head = this.head, next = this.next, act = this.act, alive = this.alive, mask = this.hashSize - 1;
      const x = this.x, y = this.y, z = this.z, CX = this.cx, CY = this.cy, CZ = this.cz, h2 = this.h * this.h;
      let pI = this.pI, pJ = this.pJ, np = 0;
      for (let k = 0; k < this.nAct; k++) {
        const i = act[k];
        if (!alive[i]) continue;
        const cx = CX[i], cy = CY[i], cz = CZ[i], xi = x[i], yi = y[i], zi = z[i];
        for (let ox = -1; ox <= 1; ox++) for (let oy = -1; oy <= 1; oy++) for (let oz = -1; oz <= 1; oz++) {
          const ax = cx + ox, ay = cy + oy, az = cz + oz;
          let j = head[(Math.imul(ax, 92837111) ^ Math.imul(ay, 689287499) ^ Math.imul(az, 283923481)) & mask];
          while (j !== -1) {
            if (j > i && CX[j] === ax && CY[j] === ay && CZ[j] === az) {
              const dx = x[j] - xi, dy = y[j] - yi, dz = z[j] - zi;
              if (dx * dx + dy * dy + dz * dz < h2) {
                if (np >= this.pairCap) {
                  this.pairCap *= 2;
                  const a = new Int32Array(this.pairCap), b = new Int32Array(this.pairCap);
                  a.set(pI); b.set(pJ); this.pI = pI = a; this.pJ = pJ = b;
                }
                pI[np] = i; pJ[np] = j; np++;
              }
            }
            j = next[j];
          }
        }
      }
      this.nPairs = np;
    }
    forEachNear(x0, y0, z0, R, fn) {
      const inv = 1 / this.h, mask = this.hashSize - 1, R2 = R * R;
      const c0x = Math.floor((x0 - R) * inv), c1x = Math.floor((x0 + R) * inv);
      const c0y = Math.floor((y0 - R) * inv), c1y = Math.floor((y0 + R) * inv);
      const c0z = Math.floor((z0 - R) * inv), c1z = Math.floor((z0 + R) * inv);
      if ((c1x - c0x + 1) * (c1y - c0y + 1) * (c1z - c0z + 1) > 60000) {
        for (let k = 0; k < this.nAct; k++) {
          const j = this.act[k];
          if (!this.alive[j]) continue;
          const dx = this.x[j] - x0, dy = this.y[j] - y0, dz = this.z[j] - z0, d2 = dx * dx + dy * dy + dz * dz;
          if (d2 < R2) fn(j, d2);
        }
        return;
      }
      for (let cx = c0x; cx <= c1x; cx++) for (let cy = c0y; cy <= c1y; cy++) for (let cz = c0z; cz <= c1z; cz++) {
        let j = this.head[(Math.imul(cx, 92837111) ^ Math.imul(cy, 689287499) ^ Math.imul(cz, 283923481)) & mask];
        while (j !== -1) {
          if (this.alive[j] && this.cx[j] === cx && this.cy[j] === cy && this.cz[j] === cz) {
            const dx = this.x[j] - x0, dy = this.y[j] - y0, dz = this.z[j] - z0, d2 = dx * dx + dy * dy + dz * dz;
            if (d2 < R2) fn(j, d2);
          }
          j = this.next[j];
        }
      }
    }
    nearest(x0, y0, z0, R) {
      let best = -1, bd = R * R;
      this.forEachNear(x0, y0, z0, R, (j, d2) => { if (d2 < bd) { bd = d2; best = j; } });
      return best;
    }
    occupied(x0, y0, z0, R) { let hit = false; this.forEachNear(x0, y0, z0, R, () => { hit = true; }); return hit; }

    // ------------------------------------------------------------------ step
    step(frameDt) {
      this.cacheGroups();
      this.compact();
      const dtF = frameDt / 60 * this.s.timeScale; // seconds of sim time this frame
      if (dtF <= 0) { this.buildGrid(); return; }
      let vmax2 = 0;
      for (let k = 0; k < this.nAct; k++) {
        const i = this.act[k];
        if (this.phase[i] === GAS) continue;
        const v2 = this.vx[i] * this.vx[i] + this.vy[i] * this.vy[i] + this.vz[i] * this.vz[i];
        if (v2 > vmax2) vmax2 = v2;
      }
      const need = Math.ceil((Math.sqrt(vmax2) + 0.5) * dtF / (this.r * 0.8));
      const S = Math.min(8, Math.max(this.s.substeps | 0, need, 1));
      this.lastSubsteps = S;
      const dt = dtF / S;
      for (let s = 0; s < S; s++) {
        this.integrate(dt, s === 0);
        this.buildGrid();
        this.findPairs();
        const iters = Math.max(1, this.s.solverIters | 0);
        for (let it = 0; it < iters; it++) {
          this.solveLiquids(it === 0);
          this.solveContacts();
          this.solveColliders(dt, it === iters - 1);
        }
        for (let k = 0; k < this.s.springIters; k++) this.solveSprings();
        this.applyGrab();
        this.boundaries();
        this.updateVelocities(dt);
      }
      this.thermalAndChemistry(frameDt * this.s.timeScale);
      this.perParticle(frameDt * this.s.timeScale, dtF);
      this.frame++;
    }

    integrate(dt, first) {
      const n = this.nAct, act = this.act, alive = this.alive, phase = this.phase, grp = this.grp, mat = this.mat, flags = this.flags;
      const x = this.x, y = this.y, z = this.z, px = this.px, py = this.py, pz = this.pz, vx = this.vx, vy = this.vy, vz = this.vz, T = this.T;
      const g = 9.81 * this.s.gravity, gGrav = this.gGrav, gDrag = this.gDrag, gPinned = this.gPinned, matM = this.matM;
      const air = 0.05 * this.s.airDrag, wind = this.sim.wind, W = TMP, t = this.sim.time;
      const windOn = wind.active, liqDamp = this.s.fluidDamping, windWater = this.s.windWater;
      for (let k = 0; k < n; k++) {
        const i = act[k];
        if (!alive[i]) continue;
        const gi = grp[i];
        if (gPinned[gi] && !(flags[i] & F_FREE)) { px[i] = x[i]; py[i] = y[i]; pz[i] = z[i]; vx[i] = vy[i] = vz[i] = 0; continue; }
        const ph = phase[i];
        let ay = -g * gGrav[gi], drag = air * gDrag[gi];
        if (ph === GAS) {
          const rg = (matM[mat[i]] / 22.4) * (293 / Math.max(T[i], 20));
          ay = g * gGrav[gi] * 0.5 * ((1.2 - rg) / (rg + 1.2));
          drag = 2.5 * gDrag[gi];
          const j = 0.5;
          vx[i] += (Math.random() - 0.5) * j * dt * 10; vy[i] += (Math.random() - 0.5) * j * dt * 10; vz[i] += (Math.random() - 0.5) * j * dt * 10;
          if (windOn) { this.sim.windAt(x[i], y[i], z[i], t, W); const f = 1 - Math.exp(-1.8 * dt); vx[i] += (W[0] - vx[i]) * f; vz[i] += (W[2] - vz[i]) * f; vy[i] += W[1] * f; }
        } else if (ph === LIQUID) {
          drag += liqDamp;
          if (windOn && flags[i] & F_SURF) {
            this.sim.windAt(x[i], y[i], z[i], t, W);
            // Wind stress drags the surface layer and its gusts push it down/up, which raises waves.
            const c = 0.35 * windWater * dt;
            vx[i] += (W[0] - vx[i]) * c; vz[i] += (W[2] - vz[i]) * c;
            vy[i] += W[1] * 0.6 * windWater * dt;
          }
        } else if (ph === POWDER && windOn && flags[i] & F_FLOOR) {
          this.sim.windAt(x[i], y[i], z[i], t, W);
          const sp = Math.hypot(W[0], W[2]);
          if (sp > 7) { const c = (sp - 7) * 0.02 * dt; vx[i] += W[0] * c; vz[i] += W[2] * c; vy[i] += sp * c * 0.8; }
        }
        // Buoyancy from the surrounding liquid (density difference drives layering; floats light grains).
        const lw = this.lqW[i];
        if (lw > 0 && ph !== GAS) {
          const rhoL = this.lqM[i] / lw, m = this.mass[i];
          if (ph === LIQUID) ay += g * Math.max(-1, Math.min(1, (rhoL - m) / m)) * 0.9;
          else ay += g * Math.min(3, rhoL / m) * Math.min(1, lw / (this.n0 * 0.6));
        }
        vy[i] += ay * dt;
        const f = Math.exp(-drag * dt);
        vx[i] *= f; vy[i] *= f; vz[i] *= f;
        px[i] = x[i]; py[i] = y[i]; pz[i] = z[i];
        x[i] += vx[i] * dt; y[i] += vy[i] * dt; z[i] += vz[i] * dt;
      }
      void first;
    }

    // Position Based Fluids density constraint for liquid–liquid pairs.
    solveLiquids(first) {
      const pI = this.pI, pJ = this.pJ, np = this.nPairs, act = this.act, n = this.nAct;
      const x = this.x, y = this.y, z = this.z, phase = this.phase, mass = this.mass, grp = this.grp, mat = this.mat, alive = this.alive;
      const nd = this.nd, lam = this.lam, g2 = this.g2, gsx = this.gsx, gsy = this.gsy, gsz = this.gsz, upN = this.upN;
      const DX = this.dx, DY = this.dy, DZ = this.dz, flags = this.flags, gPress = this.gPress, gCoh = this.gCoh;
      const h = this.h, h2 = h * h, poly6 = this.poly6, spiky = this.spiky, n0 = this.n0, W0 = this.W0, inv0 = 1 / n0;
      const eps = this.epsAbs, sk = this.tune.scorrK, invWdq = 1 / this.Wdq, sp5 = this.sp * 0.5;
      const coh = this.tune.cohesion * this.s.surfaceTension;
      let anyLiquid = false;
      for (let k = 0; k < n; k++) {
        const i = act[k];
        nd[i] = W0; g2[i] = 0; gsx[i] = gsy[i] = gsz[i] = 0; DX[i] = DY[i] = DZ[i] = 0;
        if (first) upN[i] = 0;
        if (phase[i] === LIQUID) anyLiquid = true;
      }
      if (!anyLiquid) return;
      if (first) {
        const lqW = this.lqW, lqM = this.lqM;
        for (let k = 0; k < n; k++) { const i = act[k]; lqW[i] = 0; lqM[i] = 0; }
        for (let p = 0; p < np; p++) {
          const i = pI[p], j = pJ[p], li = phase[i] === LIQUID, lj = phase[j] === LIQUID;
          if (!li && !lj) continue;
          const dx = x[i] - x[j], dy = y[i] - y[j], dz = z[i] - z[j], d2 = dx * dx + dy * dy + dz * dz;
          if (d2 >= h2) continue;
          const q = h2 - d2, w = poly6 * q * q * q;
          if (lj) { lqW[i] += w; lqM[i] += w * mass[j]; }
          if (li) { lqW[j] += w; lqM[j] += w * mass[i]; }
        }
      }
      for (let p = 0; p < np; p++) {
        const i = pI[p], j = pJ[p];
        if (phase[i] !== LIQUID || phase[j] !== LIQUID) continue;
        const dx = x[i] - x[j], dy = y[i] - y[j], dz = z[i] - z[j], d2 = dx * dx + dy * dy + dz * dz;
        if (d2 >= h2 || d2 < 1e-12) continue;
        const d = Math.sqrt(d2), q = h2 - d2, w = poly6 * q * q * q;
        nd[i] += w; nd[j] += w;
        const g = spiky * (h - d) * (h - d) * inv0, ux = dx / d, uy = dy / d, uz = dz / d;
        gsx[i] -= g * ux; gsy[i] -= g * uy; gsz[i] -= g * uz;
        gsx[j] += g * ux; gsy[j] += g * uy; gsz[j] += g * uz;
        g2[i] += g * g; g2[j] += g * g;
        if (first) { if (dy < -sp5) upN[i]++; else if (dy > sp5) upN[j]++; }
      }
      for (let k = 0; k < n; k++) {
        const i = act[k];
        if (phase[i] !== LIQUID) continue;
        let C = nd[i] * inv0 - 1;
        if (C < 0) C *= coh * gCoh[grp[i]];
        C *= gPress[grp[i]];
        lam[i] = -C / (g2[i] + gsx[i] * gsx[i] + gsy[i] * gsy[i] + gsz[i] * gsz[i] + eps);
        if (first) { if (upN[i] === 0 && nd[i] < n0 * 0.9) flags[i] |= F_SURF; else flags[i] &= ~F_SURF; }
      }
      for (let p = 0; p < np; p++) {
        const i = pI[p], j = pJ[p];
        if (phase[i] !== LIQUID || phase[j] !== LIQUID) continue;
        const dx = x[i] - x[j], dy = y[i] - y[j], dz = z[i] - z[j], d2 = dx * dx + dy * dy + dz * dz;
        if (d2 >= h2 || d2 < 1e-12) continue;
        const d = Math.sqrt(d2), q = h2 - d2;
        const wr = poly6 * q * q * q * invWdq;
        const scorr = -sk * wr * wr * wr * wr;
        const g = spiky * (h - d) * (h - d) * inv0;
        // Δp_i = Σ (λi + λj + s_corr) ∇W(p_i − p_j), with ∇W = −g·r̂.
        let s = -(lam[i] + lam[j] + scorr) * g;
        // Immiscible liquids: extra separation between different materials.
        if (mat[i] !== mat[j]) s += 0.006 * g * this.sp;
        const mi = mass[i], mj = mass[j], wi = 2 * mj / (mi + mj), wj = 2 * mi / (mi + mj);
        const ux = dx / d, uy = dy / d, uz = dz / d;
        DX[i] += s * ux * wi; DY[i] += s * uy * wi; DZ[i] += s * uz * wi;
        DX[j] -= s * ux * wj; DY[j] -= s * uy * wj; DZ[j] -= s * uz * wj;
      }
      const lim = this.sp * 0.3;
      for (let k = 0; k < n; k++) {
        const i = act[k];
        if (phase[i] !== LIQUID || !alive[i]) continue;
        let a = DX[i], b = DY[i], c = DZ[i];
        const l2 = a * a + b * b + c * c;
        if (l2 > lim * lim) { const f = lim / Math.sqrt(l2); a *= f; b *= f; c *= f; }
        x[i] += a; y[i] += b; z[i] += c;
      }
    }

    // Contacts for everything that is not liquid–liquid.
    solveContacts() {
      const pI = this.pI, pJ = this.pJ, np = this.nPairs;
      const x = this.x, y = this.y, z = this.z, px = this.px, py = this.py, pz = this.pz, phase = this.phase, mass = this.mass, grp = this.grp;
      const flags = this.flags, gPinned = this.gPinned, gFric = this.gFric, r = this.r;
      const cSolid = 2 * r * 0.98, cGas = 1.3 * r;
      for (let p = 0; p < np; p++) {
        const i = pI[p], j = pJ[p];
        const a = phase[i], b = phase[j];
        if (a === LIQUID && b === LIQUID) continue;
        const rr = (a === GAS || b === GAS) ? cGas : cSolid;
        let dx = x[j] - x[i], dy = y[j] - y[i], dz = z[j] - z[i];
        let d2 = dx * dx + dy * dy + dz * dz;
        if (d2 >= rr * rr) continue;
        if (d2 < 1e-12) { dx = (Math.random() - 0.5) * 1e-3; dy = 1e-3; dz = (Math.random() - 0.5) * 1e-3; d2 = dx * dx + dy * dy + dz * dz; }
        const gi = grp[i], gj = grp[j];
        const pinI = gPinned[gi] && !(flags[i] & F_FREE), pinJ = gPinned[gj] && !(flags[j] & F_FREE);
        if (pinI && pinJ) continue;
        const mi = mass[i], mj = mass[j];
        const wi = pinI ? 0 : pinJ ? 1 : mj / (mi + mj), wj = pinJ ? 0 : pinI ? 1 : mi / (mi + mj);
        const d = Math.sqrt(d2), nx = dx / d, ny = dy / d, nz = dz / d, ov = (rr - d) * (a === GAS && b === GAS ? 0.2 : 0.7);
        x[i] -= nx * ov * wi; y[i] -= ny * ov * wi; z[i] -= nz * ov * wi;
        x[j] += nx * ov * wj; y[j] += ny * ov * wj; z[j] += nz * ov * wj;
        if (a <= POWDER || b <= POWDER) {
          const fr = (a <= POWDER && b <= POWDER) ? 0.5 * (gFric[gi] + gFric[gj]) : 0.05;
          const rvx = (x[i] - px[i]) - (x[j] - px[j]), rvy = (y[i] - py[i]) - (y[j] - py[j]), rvz = (z[i] - pz[i]) - (z[j] - pz[j]);
          const vn = rvx * nx + rvy * ny + rvz * nz;
          const tx = rvx - vn * nx, ty = rvy - vn * ny, tz = rvz - vn * nz;
          // Granular contacts: near-static friction (grains lock and pile at a real angle of repose).
          const f = (a <= POWDER && b <= POWDER) ? Math.min(1, fr * 1.6) : Math.min(fr, 1) * 0.5;
          x[i] -= tx * f * wi; y[i] -= ty * f * wi; z[i] -= tz * f * wi;
          x[j] += tx * f * wj; y[j] += ty * f * wj; z[j] += tz * f * wj;
          // The upper grain of a grain-on-grain contact is resting on something.
          if (a <= POWDER && b <= POWDER) { if (ny > 0.35) flags[j] |= F_REST; else if (ny < -0.35) flags[i] |= F_REST; }
        }
      }
    }

    solveSprings() {
      const x = this.x, y = this.y, z = this.z, alive = this.alive, gen = this.gen, phase = this.phase, grp = this.grp, mass = this.mass;
      const sA = this.sA, sB = this.sB, sGA = this.sGA, sGB = this.sGB, sRest = this.sRest, gStiff = this.gStiff, gStr = this.gStr, gPinned = this.gPinned, flags = this.flags;
      for (let k = 0; k < this.nS; k++) {
        const a = sA[k], b = sB[k];
        if (!alive[a] || !alive[b] || gen[a] !== sGA[k] || gen[b] !== sGB[k] || phase[a] !== SOLID || phase[b] !== SOLID || grp[a] !== grp[b]) { this.removeSpring(k); k--; continue; }
        const dx = x[b] - x[a], dy = y[b] - y[a], dz = z[b] - z[a];
        const d = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1e-6, rest = sRest[k], g = grp[a];
        if ((d - rest) / rest > 0.12 + gStr[g] * 0.9) { this.removeSpring(k); k--; continue; }
        const pinA = gPinned[g] && !(flags[a] & F_FREE), pinB = gPinned[g] && !(flags[b] & F_FREE);
        if (pinA && pinB) continue;
        const ma = mass[a], mb = mass[b];
        const wa = pinA ? 0 : pinB ? 1 : mb / (ma + mb), wb = pinB ? 0 : pinA ? 1 : ma / (ma + mb);
        const c = gStiff[g] * (d - rest) / d;
        x[a] += dx * c * wa; y[a] += dy * c * wa; z[a] += dz * c * wa;
        x[b] -= dx * c * wb; y[b] -= dy * c * wb; z[b] -= dz * c * wb;
      }
    }

    // Projects particles out of rigid bodies / containers. Records contacts with dynamic bodies for coupling.
    solveColliders(dt, record) {
      const cols = this.colliders;
      if (!cols.length) return;
      const n = this.nAct, act = this.act, alive = this.alive, x = this.x, y = this.y, z = this.z, px = this.px, py = this.py, pz = this.pz, r = this.r;
      const L = [0, 0, 0], O = [0, 0, 0], P = [0, 0, 0];
      for (let c = 0; c < cols.length; c++) {
        const col = cols[c];
        const bx = col.cx, by = col.cy, bz = col.cz, br = col.bound + r;
        const qx = col.q[0], qy = col.q[1], qz = col.q[2], qw = col.q[3];
        for (let k = 0; k < n; k++) {
          const i = act[k];
          if (!alive[i]) continue;
          const ox = x[i] - bx, oy = y[i] - by, oz = z[i] - bz;
          if (ox > br || ox < -br || oy > br || oy < -br || oz > br || oz < -br) continue;
          if (ox * ox + oy * oy + oz * oz > br * br) continue;
          if (this.isPinned(i)) continue;
          qrot(-qx, -qy, -qz, qw, ox, oy, oz, L);
          if (col.type === 'openbox' || col.type === 'cup') {
            qrot(-qx, -qy, -qz, qw, px[i] - bx, py[i] - by, pz[i] - bz, P);
            col.prevInside = col.type === 'openbox' ? (Math.abs(P[0]) < col.ix && Math.abs(P[2]) < col.iz && P[1] > col.t * 0.5)
              : (P[0] * P[0] + P[2] * P[2] < col.R * col.R && P[1] > col.t * 0.5);
          }
          if (!collideLocal(col, L, r, O)) continue;
          // O = push vector in local space; convert to world.
          qrot(qx, qy, qz, qw, O[0], O[1], O[2], L);
          let pxw = L[0], pyw = L[1], pzw = L[2];
          // Liquid displaced by a moving object flows aside rather than being shot away: cap how far one solve
          // step can shove a liquid particle sideways (the overlap is resolved over the next steps).
          if (col.dynamic && this.phase[i] === LIQUID) {
            const lim = r * 0.35, hl = Math.hypot(pxw, pzw);
            if (hl > lim) { const k = lim / hl; pxw *= k; pzw *= k; }
          }
          x[i] += pxw; y[i] += pyw; z[i] += pzw;
          const pl = Math.sqrt(pxw * pxw + pyw * pyw + pzw * pzw) || 1;
          const nx = pxw / pl, ny = pyw / pl, nz = pzw / pl;
          // Friction relative to the collider's surface motion.
          let svx = 0, svy = 0, svz = 0;
          if (col.dynamic) {
            const rx = x[i] - bx, ry = y[i] - by, rz = z[i] - bz;
            svx = (col.vx + col.wy * rz - col.wz * ry) * dt; svy = (col.vy + col.wz * rx - col.wx * rz) * dt; svz = (col.vz + col.wx * ry - col.wy * rx) * dt;
          }
          const rvx = (x[i] - px[i]) - svx, rvy = (y[i] - py[i]) - svy, rvz = (z[i] - pz[i]) - svz;
          const vn = rvx * nx + rvy * ny + rvz * nz;
          const tx = rvx - vn * nx, ty = rvy - vn * ny, tz = rvz - vn * nz;
          const f = this.phase[i] <= POWDER ? Math.min(0.9, col.fric) : this.phase[i] === LIQUID ? 0.1 : 0.02;
          x[i] -= tx * f; y[i] -= ty * f; z[i] -= tz * f;
          if (record && col.body) col.body.contacts.push(i);
          // Grains push back: the momentum given to a powder grain is taken from the body (a sand pile holds things up).
          if (col.dynamic && col.body && this.phase[i] <= POWDER) {
            const J = col.body.pj || (col.body.pj = [0, 0, 0, 0, 0, 0]), m = this.kg(i) / dt;
            const rx = x[i] - bx, ry = y[i] - by, rz = z[i] - bz, fx = -pxw * m, fy = -pyw * m, fz = -pzw * m;
            J[0] += fx; J[1] += fy; J[2] += fz;
            J[3] += ry * fz - rz * fy; J[4] += rz * fx - rx * fz; J[5] += rx * fy - ry * fx;
          }
        }
      }
    }

    boundaries() {
      const n = this.nAct, act = this.act, alive = this.alive, x = this.x, y = this.y, z = this.z, px = this.px, pz = this.pz, flags = this.flags;
      const r = this.r, phase = this.phase, grp = this.grp, gFric = this.gFric;
      const hw = this.s.worldWidth / 2 - r, hd = this.s.worldDepth / 2 - r, walls = this.s.sideWalls, ffr = this.tune.floorFric;
      const ceiling = this.s.openCeiling ? 1e9 : 12, kill = 60;
      for (let k = 0; k < n; k++) {
        const i = act[k];
        if (!alive[i]) continue;
        flags[i] &= ~F_FLOOR;
        if (y[i] < r) {
          y[i] = r; flags[i] |= F_FLOOR;
          const f = phase[i] <= POWDER ? Math.min(0.95, gFric[grp[i]] * 1.3) : phase[i] === LIQUID ? ffr : 0.02;
          x[i] = px[i] + (x[i] - px[i]) * (1 - f); z[i] = pz[i] + (z[i] - pz[i]) * (1 - f);
        }
        if (walls) {
          if (x[i] < -hw) x[i] = -hw; else if (x[i] > hw) x[i] = hw;
          if (z[i] < -hd) z[i] = -hd; else if (z[i] > hd) z[i] = hd;
        } else if (Math.abs(x[i]) > hw + 5 || Math.abs(z[i]) > hd + 5) { this.kill(i); continue; }
        if (y[i] > ceiling) { if (phase[i] === GAS) { this.kill(i); continue; } y[i] = ceiling; }
        if (y[i] > kill) this.kill(i);
      }
      this.applyBindings();
    }

    // Particles dropped into a container stay inside it (an invisible lid holds gases in).
    applyBindings() {
      const info = this.sim.bindInfo;
      if (!info || !info.length) return;
      const n = this.nAct, act = this.act, bind = this.bind, x = this.x, y = this.y, z = this.z, r = this.r, L = TMP, phase = this.phase;
      for (let k = 0; k < n; k++) {
        const i = act[k], b = bind[i];
        if (b < 0 || !this.alive[i]) continue;
        const c = info[b];
        if (!c) { bind[i] = -1; continue; }
        if (c.tilted && phase[i] !== GAS) { bind[i] = -1; continue; }
        const q = c.q;
        qrot(-q[0], -q[1], -q[2], q[3], x[i] - c.cx, y[i] - c.cy, z[i] - c.cz, L);
        let lx = L[0], ly = L[1], lz = L[2], moved = false;
        const floor = c.t + r, top = c.H - r;
        if (c.cup) {
          const rr = c.R - r, d = Math.hypot(lx, lz);
          if (d > rr) { lx *= rr / d; lz *= rr / d; moved = true; }
        } else {
          const ax = c.ix - r, az = c.iz - r;
          if (lx > ax) { lx = ax; moved = true; } else if (lx < -ax) { lx = -ax; moved = true; }
          if (lz > az) { lz = az; moved = true; } else if (lz < -az) { lz = -az; moved = true; }
        }
        if (ly > top && !c.sealed && (phase[i] === GAS || ly > c.H + r)) { bind[i] = -1; continue; } // no lid: gas escapes, overflow spills
        if (ly < floor) { ly = floor; moved = true; } else if (ly > top) { ly = top; moved = true; }
        if (!moved) continue;
        qrot(q[0], q[1], q[2], q[3], lx, ly, lz, L);
        x[i] = c.cx + L[0]; y[i] = c.cy + L[1]; z[i] = c.cz + L[2];
      }
    }

    updateVelocities(dt) {
      const n = this.nAct, act = this.act, alive = this.alive, x = this.x, y = this.y, z = this.z, px = this.px, py = this.py, pz = this.pz;
      const vx = this.vx, vy = this.vy, vz = this.vz, flags = this.flags, grp = this.grp, gRest = this.gRest, inv = 1 / dt, phase = this.phase;
      for (let k = 0; k < n; k++) {
        const i = act[k];
        if (!alive[i]) continue;
        let a = (x[i] - px[i]) * inv, b = (y[i] - py[i]) * inv, c = (z[i] - pz[i]) * inv;
        const s2 = a * a + b * b + c * c;
        if (s2 > 900) { const f = 30 / Math.sqrt(s2); a *= f; b *= f; c *= f; }
        if (flags[i] & F_FLOOR) { const vIn = vy[i]; if (vIn < -1.5) b = -vIn * gRest[grp[i]]; else if (b < 0) b = 0; }
        // Granular sleep: a slow grain resting on others (or the floor) locks in place instead of rolling forever,
        // so piles keep a real angle of repose. Fast avalanches and impacts are untouched.
        // A grain that has been slow for a while (~0.4 s) sleeps firmly: solver nudges can no longer pop it about.
        const still = this.still;
        if (phase[i] <= POWDER && (flags[i] & (F_REST | F_FLOOR))) {
          const v2 = a * a + b * b + c * c;
          if (v2 < 0.12 * 0.12) { if (still[i] < 255) still[i]++; } else if (v2 > 0.5 * 0.5) still[i] = 0;
          if (still[i] > 24) {
            if (v2 < 0.6 * 0.6) { a = 0; b = 0; c = 0; x[i] = px[i] + (x[i] - px[i]) * 0.1; z[i] = pz[i] + (z[i] - pz[i]) * 0.1; if (y[i] > py[i]) y[i] = py[i] + (y[i] - py[i]) * 0.1; }
          } else if (v2 < 0.1 * 0.1) { a = 0; b = 0; c = 0; x[i] = px[i] + (x[i] - px[i]) * 0.2; z[i] = pz[i] + (z[i] - pz[i]) * 0.2; }
          else if (v2 < 0.3 * 0.3) { a *= 0.5; b *= 0.5; c *= 0.5; }
        } else still[i] = 0;
        // Very viscous melts (lava, molten glass) behave like a Bingham paste: slow parts stop, so a flow keeps
        // its thickness and creeps out as a lobe instead of rushing flat.
        if (phase[i] === LIQUID) {
          const vis = this.gVisc[grp[i]];
          if (vis > 0.4) {
            const k = 1 - Math.min(0.5, vis * vis * 0.12);
            a *= k; c *= k; if (b > 0) b *= k;
            const v2 = a * a + b * b + c * c, yieldV = 0.22 * vis;
            if (v2 < yieldV * yieldV && (flags[i] & F_FLOOR || b <= 0.05)) { a = 0; c = 0; x[i] = px[i] + (x[i] - px[i]) * 0.3; z[i] = pz[i] + (z[i] - pz[i]) * 0.3; }
          }
        }
        flags[i] &= ~F_REST;
        vx[i] = a; vy[i] = b; vz[i] = c;
      }
      // XSPH viscosity.
      const pI = this.pI, pJ = this.pJ, gVisc = this.gVisc, h = this.h, mat = this.mat, base = this.tune.xsph;
      for (let p = 0; p < this.nPairs; p++) {
        const i = pI[p], j = pJ[p];
        if (phase[i] !== LIQUID || phase[j] !== LIQUID) continue;
        const dx = x[j] - x[i], dy = y[j] - y[i], dz = z[j] - z[i];
        const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (d >= h) continue;
        let c = (base + 0.25 * (gVisc[grp[i]] + gVisc[grp[j]])) * (1 - d / h);
        if (mat[i] !== mat[j]) c *= 0.3;
        if (c > 0.3) c = 0.3;
        const ux = (vx[j] - vx[i]) * c * 0.5, uy = (vy[j] - vy[i]) * c * 0.5, uz = (vz[j] - vz[i]) * c * 0.5;
        vx[i] += ux; vy[i] += uy; vz[i] += uz; vx[j] -= ux; vy[j] -= uy; vz[j] -= uz;
      }
    }

    // ------------------------------------------------------------------ heat + chemistry (once per frame)
    thermalAndChemistry(fdt) {
      const pI = this.pI, pJ = this.pJ, np = this.nPairs;
      const x = this.x, y = this.y, z = this.z, T = this.T, mat = this.mat, grp = this.grp, mass = this.mass, phase = this.phase, flags = this.flags, alive = this.alive;
      const gCond = this.gCond, gHeatCap = this.gHeatCap, heatOut = this.matHeatOut, h = this.h, h2 = h * h;
      const cond0 = 0.25 * this.s.conduction * fdt, table = this.reactionTable, NM = this.NM, reactOn = this.s.reactions;
      const contact2 = Math.pow(this.sp * 1.85, 2), bond2 = Math.pow(this.sp * 1.5, 2);
      for (let p = 0; p < np; p++) {
        const i = pI[p], j = pJ[p];
        if (!alive[i] || !alive[j]) continue;
        const dx = x[j] - x[i], dy = y[j] - y[i], dz = z[j] - z[i], d2 = dx * dx + dy * dy + dz * dz;
        if (d2 >= h2) continue;
        const w = 1 - Math.sqrt(d2) / h;
        const mi = mat[i], mj = mat[j];
        const dT = T[j] - T[i];
        if (dT > 0.01 || dT < -0.01) {
          const Ci = gHeatCap[grp[i]] * Math.max(mass[i], 0.02), Cj = gHeatCap[grp[j]] * Math.max(mass[j], 0.02);
          let flux = Math.min(gCond[grp[i]], gCond[grp[j]]) * cond0 * w * dT;
          const maxFlux = Math.abs(dT) * (Ci * Cj) / (Ci + Cj) * 0.5;
          if (flux > maxFlux) flux = maxFlux; else if (flux < -maxFlux) flux = -maxFlux;
          T[i] += flux / Ci; T[j] -= flux / Cj;
        }
        if (heatOut[mi] && mj !== mi) T[j] += heatOut[mi] * w * fdt;
        if (heatOut[mj] && mj !== mi) T[i] += heatOut[mj] * w * fdt;
        if (d2 > contact2) continue;
        if (mi === mj && (flags[i] & F_FROZE || flags[j] & F_FROZE) && phase[i] === SOLID && phase[j] === SOLID && grp[i] === grp[j] && d2 < bond2) this.addSpring(i, j);
        if (reactOn) {
          const rr = table[mi * NM + mj];
          if (rr) this.tryReact(rr > 0 ? i : j, rr > 0 ? j : i, PC.REACTIONS[(rr > 0 ? rr : -rr) - 1]);
        }
      }
    }

    tryReact(i, j, rule) {
      const flags = this.flags;
      if (flags[i] & F_REACTED || flags[j] & F_REACTED) return;
      if (rule.fusion && !this.s.fusion) return;
      if (rule.minT && Math.max(this.T[i], this.T[j]) < rule.minT) { if (!rule.alt) return; rule = rule.alt; }
      if (rule.liquidB && this.phase[j] !== LIQUID) return;
      if (rule.special === 'fizz') {
        if (Math.random() > rule.rate * this.s.reactionSpeed) return;
        this.flags[i] |= F_REACTED; this.flags[j] |= F_REACTED;
        this.sim.achieve('rx:Fizz');
        const x = this.x[i], y = this.y[i], z = this.z[i];
        this.convert(i, rule.spent);
        this.T[i] += rule.heat || 0;
        if (Math.random() < rule.sodaUse) this.kill(j);
        // The CO₂ comes out as foam: a few froth particles that rise and spread.
        const FOAM = this.FOAM == null ? (this.FOAM = PC.matIndex('foam')) : this.FOAM;
        for (let k = 0; k < 2; k++) {
          const n = this.add(FOAM, x + (Math.random() - 0.5) * this.sp, y + this.sp * (0.6 + Math.random()), z + (Math.random() - 0.5) * this.sp, this.T[i], null, (Math.random() - 0.5) * 0.4, 0.6 + Math.random() * 0.6, (Math.random() - 0.5) * 0.4);
          if (n < 0) break;
        }
        if (Math.random() < 0.03) this.sim.emit({ type: 'label', x, y: y + 0.12, z, text: 'Fizz', color: '#ffffff' });
        return;
      }
      if (rule.special === 'metalWater') { this.sim.achieve('rx:Metal + water'); this.metalWater(i, j); return; }
      if (rule.special === 'annihilate') {
        const kg = this.kg(i) + this.kg(j), x = this.x[i], y = this.y[i], z = this.z[i];
        this.kill(i); this.kill(j);
        this.sim.achieve('rx:Annihilation');
        this.sim.annihilate(x, y, z, kg);
        return;
      }
      let rate = rule.rate * 0.5 * (this.gReact[this.grp[i]] + this.gReact[this.grp[j]]) * this.s.reactionSpeed;
      // Ordinary reactions speed up with temperature (roughly doubling every 10 K); combustion rules set their own thresholds.
      if (!rule.minT) rate *= Math.max(0.1, Math.min(4, Math.pow(2, (0.5 * (this.T[i] + this.T[j]) - 293) / 10)));
      if (Math.random() > rate) return;
      const cx = (this.x[i] + this.x[j]) / 2, cy = (this.y[i] + this.y[j]) / 2, cz = (this.z[i] + this.z[j]) / 2;
      const [pa, pb] = rule.intoIdx;
      flags[i] |= F_REACTED; flags[j] |= F_REACTED;
      if (rule.name) this.sim.achieve('rx:' + rule.name);
      const hA = rule.heatA != null ? rule.heatA : rule.heat || 0, hB = rule.heatB != null ? rule.heatB : rule.heat || 0;
      const expl = this.gExpl[this.grp[i]];
      if (pa === -1) this.kill(i); else { if (pa >= 0) this.convert(i, pa); this.T[i] = Math.max(1, this.T[i] + hA); }
      if (pb === -1) this.kill(j); else { if (pb >= 0) this.convert(j, pb); this.T[j] = Math.max(1, this.T[j] + hB); }
      if (rule.explode) this.sim.explode(cx, cy, cz, rule.explode * expl, { color: rule.flash });
      if (rule.flash) this.sim.emit({ type: 'flash', x: cx, y: cy, z: cz, color: rule.flash, size: 0.15 + (rule.explode || 0) * 0.05 });
      if (rule.name && Math.random() < 0.02) this.sim.emit({ type: 'label', x: cx, y: cy + 0.1, z: cz, text: rule.name, color: rule.flash || '#ffffff' });
    }

    // Alkali / alkaline-earth metal particle meets water/acid: hydrogen, hydroxide, heat, and explosions for the heavy ones.
    metalWater(i, j) {
      const m = PC.MATS[this.mat[i]], el = m.el;
      let rx = (el ? el.reactivity : 1) * this.gReact[this.grp[i]];
      if (el && el.cat === 'alkaline' && this.T[i] < 330) rx *= 0.15;
      if (this.matAcid[this.mat[j]]) rx *= 2;
      if (Math.random() > 0.02 * rx * this.s.reactionSpeed) return;
      const x = this.x[i], y = this.y[i], z = this.z[i];
      this.convert(j, 'H');
      this.T[j] = Math.max(this.T[j], 380 + 120 * rx);
      this.vy[j] += 0.5;
      if (Math.random() < 0.35) this.convert(i, el && el.cat === 'alkali' ? 'lye' : 'slaked_lime');
      this.T[i] += 160 * rx;
      this.flags[i] |= F_REACTED; this.flags[j] |= F_REACTED;
      if (m.emit && rx >= 1.5 && Math.random() < 0.5) this.spawnFlame(x, y + this.sp, z, m.index);
      if (rx >= 2.5 || (rx >= 1.8 && Math.random() < 0.08)) this.sim.explode(x, y, z, 0.35 * rx * this.gExpl[this.grp[i]], { color: m.emit });
      this.sim.emit({ type: 'flash', x, y, z, color: m.emit || '#ffffff', size: 0.1 + 0.05 * rx });
    }

    perParticle(fdt, dtSec) {
      const n = this.nAct, act = this.act, alive = this.alive, T = this.T, mat = this.mat, grp = this.grp, phase = this.phase, flags = this.flags;
      const life = this.life, age = this.age, vx = this.vx, vy = this.vy, vz = this.vz, ovx = this.ovx, ovy = this.ovy, ovz = this.ovz;
      const Tamb = this.s.ambientT, ex = 0.0015 * this.s.ambientExchange * fdt, gIgn = this.gIgn, gRad = this.gRad;
      for (let k = 0; k < n; k++) {
        const i = act[k];
        if (!alive[i]) continue;
        const mi = mat[i], m = PC.MATS[mi];
        flags[i] &= ~(F_REACTED | F_FROZE);
        age[i] += dtSec;
        if (life[i] > 0) {
          life[i] -= dtSec;
          if (life[i] <= 0) {
            if (mi === this.FIRE && Math.random() < 0.3) { this.convert(i, this.SMOKE); T[i] = 500; continue; }
            if (m.lifeInto) { this.convert(i, m.lifeInto); if (m.lifeInto === 'co2') this.life[i] = this.maxLife[i] = 0; continue; } // foam pops into CO₂ gas
            this.kill(i); continue;
          }
        }
        const ph0 = phase[i];
        // Only exposed matter loses heat to the air (and radiates); the inside of a pool or pile cools by conduction
        // through its neighbours, so a lava lake crusts over but stays molten underneath for minutes.
        const exposed = ph0 === GAS || (flags[i] & F_SURF);
        T[i] += (Tamb - T[i]) * ex * (ph0 === GAS ? 3 : exposed ? 1.5 : flags[i] & F_FLOOR ? 0.25 : 0.06);
        if (T[i] > 1000 && exposed) T[i] -= Math.min(T[i] - Tamb, 6e-14 * T[i] * T[i] * T[i] * T[i] * fdt / Math.max(this.gHeatCap[grp[i]], 0.2));
        if (T[i] < 0.1) T[i] = 0.1;
        const g = this.groups[grp[i]];
        let ph = this.phaseFor(i, g.props);
        // Water freezes from the top down: only the exposed surface can turn to ice, and each layer under existing ice
        // forms much more slowly (ice insulates), so a pond grows a skin of ice and stays liquid beneath.
        if (ph0 === LIQUID && ph <= POWDER && this.matIsWater[mi]) {
          const key = Math.round(this.x[i] / 0.12) * 100000 + Math.round(this.z[i] / 0.12);
          const layers = this.sim.iceLayers.get(key) || 0;
          const cold = Math.min(1, (g.props.mp - T[i]) / 8 + 0.1);
          if (!(flags[i] & F_SURF) || Math.random() > 0.05 * cold * fdt / (1 + layers * layers * 2)) { T[i] = g.props.mp + 0.02; ph = ph0; }
          else this.sim.iceLayers.set(key, layers + 1);
        }
        if (ph !== ph0) {
          let target = null;
          if (ph === LIQUID && ph0 <= POWDER && m.meltInto) target = m.meltInto;
          else if (ph <= POWDER && ph0 >= LIQUID && m.freezeInto) target = m.freezeInto;
          else if (ph === GAS && m.boilInto) target = m.boilInto[(Math.random() * m.boilInto.length) | 0];
          if (target) { this.convert(i, target); ph = phase[i]; }
          else { phase[i] = ph; this.sim.discover(mi, ph, this.x[i], this.y[i], this.z[i]); }
          if (ph === SOLID && ph0 !== SOLID) flags[i] |= F_FROZE;
          this.mass[i] = this.massFor(i, this.groups[grp[i]].props);
        } else if (ph === GAS) this.mass[i] = this.massFor(i, g.props);

        if (!this.s.reactions) { ovx[i] = vx[i]; ovy[i] = vy[i]; ovz[i] = vz[i]; continue; }
        const mNow = PC.MATS[mat[i]];
        const b = mNow.burn;
        if (b && T[i] >= gIgn[grp[i]]) this.burn(i, mNow, b);
        if (alive[i] && mNow.shock && age[i] > 0.3) {
          const a = vx[i] - ovx[i], c = vy[i] - ovy[i], d = vz[i] - ovz[i];
          if (a * a + c * c + d * d > mNow.shock * mNow.shock * 0.12) { T[i] = Math.max(T[i], gIgn[grp[i]] + 50); this.burn(i, mNow, mNow.burn, true); }
        }
        if (alive[i] && mNow.radioactive && this.s.radioactivity) {
          const p = (0.693 / (mNow.radioactive.halfLife * 60)) * this.s.decaySpeed * gRad[grp[i]] * fdt;
          if (Math.random() < p) this.decay(i, mNow);
        }
        if (alive[i] && mNow.fissile && this.s.fission && Math.random() < 0.02 * fdt) {
          let kg = 0;
          const mi2 = mat[i];
          this.forEachNear(this.x[i], this.y[i], this.z[i], 0.3, (j) => { if (mat[j] === mi2) kg += this.kg(j); });
          if (kg >= mNow.fissile.criticalKg && Math.random() < 0.3 * gRad[grp[i]]) this.fission(i);
        }
        ovx[i] = vx[i]; ovy[i] = vy[i]; ovz[i] = vz[i];
      }
    }

    burn(i, m, b, force) {
      if (!this.alive[i]) return;
      const x = this.x[i], y = this.y[i], z = this.z[i];
      if (b.flame && Math.random() < b.flame) this.spawnFlame(x, y + this.sp, z, m.emit ? m.index : -1);
      if (!force && Math.random() > b.rate * this.gReact[this.grp[i]] * this.s.reactionSpeed) return;
      const into = b.into[(Math.random() * b.into.length) | 0];
      const gExpl = this.gExpl[this.grp[i]];
      this.convert(i, into);
      this.T[i] += b.heat;
      if (into === 'fire') this.tint[i] = m.emit ? m.index : -1;
      if (b.explode) this.sim.explode(x, y, z, b.explode * gExpl, { color: b.flash });
      if (b.flash && Math.random() < 0.3) this.sim.emit({ type: 'flash', x, y, z, color: b.flash, size: 0.25 });
      if (b.explode || Math.random() < 0.2) this.sim.emit({ type: 'sparks', x, y, z, color: m.emit || '#ffb347', n: b.explode ? 6 : 2 });
    }
    spawnFlame(x, y, z, tintMat) {
      const j = () => (Math.random() - 0.5) * 0.04;
      const i = this.add(this.FIRE, x + j(), y, z + j(), 1300 + Math.random() * 300, null, j() * 10, 0.4 + Math.random() * 0.6, j() * 10);
      if (i >= 0) this.tint[i] = tintMat;
      return i;
    }
    decay(i, m) {
      const x = this.x[i], y = this.y[i], z = this.z[i];
      this.convert(i, m.radioactive.into);
      this.T[i] += 120;
      this.sim.emit({ type: 'decay', x, y, z, color: '#9dff7a' });
    }
    fission(i) {
      const x = this.x[i], y = this.y[i], z = this.z[i];
      this.convert(i, Math.random() < 0.5 ? 'Ba' : 'Kr');
      this.T[i] += 2e4;
      this.sim.explode(x, y, z, 30 * this.gExpl[this.grp[i]], { nuclear: true, color: '#e8ffd0' });
      this.sim.emit({ type: 'label', x, y: y + 0.3, z, text: 'Fission!', color: '#b6ff8a' });
    }

    // Particles caught in a blast.
    blast(e, R, P) {
      const n = this.nAct, act = this.act, alive = this.alive, x = this.x, y = this.y, z = this.z, vx = this.vx, vy = this.vy, vz = this.vz;
      const T = this.T, mass = this.mass, flags = this.flags, grp = this.grp, mat = this.mat;
      let chain = 0;
      for (let k = 0; k < n; k++) {
        const i = act[k];
        if (!alive[i]) continue;
        const dx = x[i] - e.x, dy = y[i] - e.y, dz = z[i] - e.z;
        if (dx > R || dx < -R || dy > R || dy < -R || dz > R || dz < -R) continue;
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 > R * R) continue;
        const d = Math.sqrt(d2) || 1e-3, f = 1 - d / R, mi = mat[i];
        if (this.matStatic[mi]) continue;
        if (this.gPinned[grp[i]] && !(flags[i] & F_FREE)) { if (P * f > 5 && this.gStr[grp[i]] < 0.3) flags[i] |= F_FREE; else continue; }
        const imp = Math.min(25, P * 1.6 * f * f / Math.sqrt(Math.max(mass[i], 0.05)));
        vx[i] += (dx / d) * imp; vy[i] += (dy / d) * imp + imp * 0.2; vz[i] += (dz / d) * imp;
        if (imp > 6) this.bind[i] = -1;
        T[i] += P * 30 * f * (e.nuclear ? 20 : 1);
        if (P * f > this.gStr[grp[i]] * 6) flags[i] |= F_BLAST;
        if (e.nuclear && PC.MATS[mi].fissile && f > 0.4 && this.s.fission && Math.random() < 0.5) { this.convert(i, Math.random() < 0.5 ? 'Ba' : 'Kr'); T[i] += 2e4; chain += 10; }
      }
      for (let k = 0; k < this.nS; k++) if (flags[this.sA[k]] & F_BLAST || flags[this.sB[k]] & F_BLAST) { this.removeSpring(k); k--; }
      for (let k = 0; k < n; k++) flags[act[k]] &= ~F_BLAST;
      return chain;
    }

    // ------------------------------------------------------------------ spawning
    spawnParticles(mat, x, y, z, opts) {
      const T = opts.T != null ? opts.T : 293;
      const g = opts.group || this.createGroup(mat, opts.props || null, opts.label || mat.name, { entryKey: opts.entryKey });
      const ph = mat.life ? GAS : T < g.props.mp ? (mat.powder ? POWDER : SOLID) : T < g.props.bp ? LIQUID : GAS;
      let count = Math.min(opts.count || (ph === GAS ? 300 : ph === LIQUID ? 700 : 400), this.freeTop);
      const shape = opts.shape && opts.shape !== 'auto' ? opts.shape : ph === GAS ? 'cloud' : 'blob';
      const pts = this.shapePoints(shape, count, ph);
      let minY = Infinity;
      for (const p of pts) minY = Math.min(minY, p[1]);
      const oy = Math.max(y, this.r - minY + 0.001);
      const ids = [];
      const v0 = opts.v || [0, 0, 0];
      for (const [dx, dy, dz] of pts) {
        let vx = v0[0], vy = v0[1], vz = v0[2];
        if (mat.index === this.AIR) { const d = Math.hypot(dx, dy, dz) || 1; vx += dx / d * 4; vy += dy / d * 4; vz += dz / d * 4; }
        const i = this.add(mat.index, x + dx, oy + dy, z + dz, T, g, vx, vy, vz);
        if (i < 0) break;
        ids.push(i);
      }
      if (ph === SOLID && ids.length > 1) this.linkAll(ids, this.sp * 1.75);
      let R = 0;
      for (const p of pts) R = Math.max(R, Math.hypot(p[0], p[1], p[2]));
      return { group: g, R: R + this.sp, y: oy, count: ids.length, ids };
    }
    linkAll(list, maxD) {
      const m2 = maxD * maxD;
      for (let a = 0; a < list.length; a++) for (let b = a + 1; b < list.length; b++) {
        const i = list[a], j = list[b];
        const dx = this.x[i] - this.x[j], dy = this.y[i] - this.y[j], dz = this.z[i] - this.z[j];
        if (dx * dx + dy * dy + dz * dz <= m2) this.addSpring(i, j);
      }
    }
    shapePoints(shape, count, ph) {
      const sp = this.sp, pts = [];
      const jit = ph >= LIQUID || ph === POWDER ? sp * 0.08 : 0;
      const J = () => (Math.random() - 0.5) * jit;
      if (shape === 'cloud' || shape === 'rain') {
        const R = Math.cbrt(count) * sp * (shape === 'rain' ? 1.6 : 1.5);
        for (let k = 0; k < count; k++) {
          const u = Math.random() * 2 - 1, a = Math.random() * Math.PI * 2, s = Math.cbrt(Math.random()) * R, q = Math.sqrt(1 - u * u);
          pts.push([Math.cos(a) * q * s, u * s * (shape === 'rain' ? 2 : 1), Math.sin(a) * q * s]);
        }
        return pts;
      }
      if (shape === 'fitbox' && this.fitDims) {
        // Fill a container's whole interior volume (gases).
        const [hx, hz, cyl, hgt] = this.fitDims;
        for (let k = 0; k < count; k++) {
          let px, pz;
          do { px = (Math.random() * 2 - 1) * hx; pz = (Math.random() * 2 - 1) * hz; } while (cyl && px * px + pz * pz > hx * hx);
          pts.push([px, Math.random() * hgt, pz]);
        }
        return pts;
      }
      if (shape === 'fit' && this.fitDims) {
        // Fill a container footprint layer by layer.
        const w = Math.max(1, Math.floor((this.fitDims[0] * 2) / sp)), d = Math.max(1, Math.floor((this.fitDims[1] * 2) / sp));
        const layers = Math.ceil(count / (w * d));
        for (let yy = 0; yy < layers; yy++) for (let xx = 0; xx < w; xx++) for (let zz = 0; zz < d; zz++) {
          if (pts.length >= count) break;
          if (this.fitDims[2] && Math.hypot((xx - (w - 1) / 2) * sp, (zz - (d - 1) / 2) * sp) > this.fitDims[0]) continue;
          pts.push([(xx - (w - 1) / 2) * sp + J(), yy * sp * 1.02 + J(), (zz - (d - 1) / 2) * sp + J()]);
        }
        return pts;
      }
      if (shape === 'block' || shape === 'column' || shape === 'sheet') {
        const base = shape === 'column' ? Math.max(2, Math.round(Math.cbrt(count / 6))) : Math.max(2, Math.round(Math.cbrt(count * (shape === 'sheet' ? 8 : 1.4))));
        const w = base, d = base, hgt = Math.ceil(count / (w * d));
        for (let yy = 0; yy < hgt; yy++) for (let xx = 0; xx < w; xx++) for (let zz = 0; zz < d; zz++) {
          if (pts.length >= count) break;
          pts.push([(xx - (w - 1) / 2) * sp + J(), yy * sp + J(), (zz - (d - 1) / 2) * sp + J()]);
        }
        return pts;
      }
      // Sphere-ish blob on a cubic lattice.
      const R = Math.cbrt((count * 3) / (4 * Math.PI)) * sp + sp * 0.5, n = Math.ceil(R / sp);
      for (let a = -n; a <= n; a++) for (let b = -n; b <= n; b++) for (let c = -n; c <= n; c++) {
        const px = a * sp, py = b * sp, pz = c * sp;
        if (px * px + py * py + pz * pz <= R * R) pts.push([px + J(), py + J(), pz + J()]);
      }
      pts.sort((p, q) => (p[0] * p[0] + p[1] * p[1] + p[2] * p[2]) - (q[0] * q[0] + q[1] * q[1] + q[2] * q[2]));
      pts.length = Math.min(pts.length, count);
      return pts;
    }

    // ------------------------------------------------------------------ tools / groups
    applyGrab() {
      const g = this.sim.grabParticles;
      if (!g) return;
      const t = this.sim.grabTarget;
      for (const [i, gen, ox, oy, oz] of g) {
        if (!this.alive[i] || this.gen[i] !== gen) continue;
        const tx = t[0] + ox, ty = Math.max(this.r, t[1] + oy), tz = t[2] + oz;
        this.x[i] += (tx - this.x[i]) * 0.25; this.y[i] += (ty - this.y[i]) * 0.25; this.z[i] += (tz - this.z[i]) * 0.25;
      }
    }
    groupParticles(g) {
      const out = [];
      for (let k = 0; k < this.nAct; k++) { const i = this.act[k]; if (this.alive[i] && this.grp[i] === g.id) out.push(i); }
      return out;
    }
    groupStats(g) {
      const ids = this.groupParticles(g);
      const st = { count: ids.length, T: 0, cx: 0, cy: 0, cz: 0, phases: [0, 0, 0, 0], speed: 0, kg: 0, moles: 0 };
      if (!ids.length) return st;
      const M = PC.MATS[g.mat].M;
      for (const i of ids) {
        st.T += this.T[i]; st.cx += this.x[i]; st.cy += this.y[i]; st.cz += this.z[i]; st.phases[this.phase[i]]++;
        st.speed += Math.hypot(this.vx[i], this.vy[i], this.vz[i]);
        st.kg += this.kg(i);
      }
      st.T /= ids.length; st.cx /= ids.length; st.cy /= ids.length; st.cz /= ids.length; st.speed /= ids.length;
      st.moles = st.kg * 1000 / M;
      return st;
    }
    setGroupAmount(g, n) {
      const ids = this.groupParticles(g);
      if (n < ids.length) { for (let k = n; k < ids.length; k++) this.kill(ids[k]); return; }
      if (!ids.length) return;
      const st = this.groupStats(g), sp = this.sp;
      let added = 0, tries = 0;
      const R = Math.cbrt(ids.length) * sp;
      while (added < n - ids.length && tries < (n - ids.length) * 20 && this.freeTop > 0) {
        tries++;
        const px = st.cx + (Math.random() - 0.5) * R * 2, py = st.cy + Math.random() * R * 2 + sp, pz = st.cz + (Math.random() - 0.5) * R * 2;
        if (this.occupied(px, py, pz, sp * 0.9)) continue;
        this.add(g.mat, px, py, pz, st.T, g);
        added++;
      }
    }
    refreshGroup(g) {
      this.cacheGroups();
      for (const i of this.groupParticles(g)) { this.phase[i] = this.phaseFor(i, g.props); this.mass[i] = this.massFor(i, g.props); }
    }
    clear() {
      for (let k = 0; k < this.nAct; k++) this.kill(this.act[k]);
      this.nAct = 0; this.nS = 0;
      for (let k = 0; k < this.nDead; k++) this.free[this.freeTop++] = this.dead[k];
      this.nDead = 0;
      this.groups = []; this.defaultGroups = new Map();
      this.sN.fill(0);
    }
  }

  // Collision of a point (local coords L) of radius r with a collider; writes push vector to O. Returns true on contact.
  function pushBox(lx, ly, lz, cx, cy, cz, hx, hy, hz, r, O) {
    const ax = lx - cx, ay = ly - cy, az = lz - cz;
    const ex = hx + r - Math.abs(ax), ey = hy + r - Math.abs(ay), ez = hz + r - Math.abs(az);
    if (ex <= 0 || ey <= 0 || ez <= 0) return false;
    if (ex <= ey && ex <= ez) { O[0] = ax >= 0 ? ex : -ex; O[1] = 0; O[2] = 0; }
    else if (ey <= ez) { O[0] = 0; O[1] = ay >= 0 ? ey : -ey; O[2] = 0; }
    else { O[0] = 0; O[1] = 0; O[2] = az >= 0 ? ez : -ez; }
    return true;
  }
  function collideLocal(col, L, r, O) {
    const lx = L[0], ly = L[1], lz = L[2];
    switch (col.type) {
      case 'box': return pushBox(lx, ly, lz, 0, 0, 0, col.hx, col.hy, col.hz, r, O);
      case 'sphere': {
        const d = Math.sqrt(lx * lx + ly * ly + lz * lz), R = col.R + r;
        if (d >= R) return false;
        const f = (R - d) / (d || 1);
        O[0] = lx * f; O[1] = (d ? ly * f : R); O[2] = lz * f;
        return true;
      }
      case 'openbox': {
        // Local origin at the outside bottom centre; inner half-sizes ix/iz, height H, wall thickness t.
        const t = Math.max(col.t, 2.4 * r), ix = col.ix, iz = col.iz, H = col.H, ft = col.t;
        if (col.prevInside) {
          // Particle was inside: clamp it to the interior (robust against thin walls).
          let hit = false;
          O[0] = O[1] = O[2] = 0;
          const lim = ix - r, limz = iz - r, floor = ft + r;
          if (ly < H + r) {
            if (lx > lim) { O[0] = lim - lx; hit = true; } else if (lx < -lim) { O[0] = -lim - lx; hit = true; }
            if (lz > limz) { O[2] = limz - lz; hit = true; } else if (lz < -limz) { O[2] = -limz - lz; hit = true; }
          }
          if (ly < floor && Math.abs(lx) < ix + t && Math.abs(lz) < iz + t) { O[1] = floor - ly; hit = true; }
          return hit;
        }
        let hit = false, best = 0, bx = 0, by = 0, bz = 0;
        const test = (cx, cy, cz, hx, hy, hz) => {
          if (pushBox(lx, ly, lz, cx, cy, cz, hx, hy, hz, r, O)) {
            const m = Math.abs(O[0]) + Math.abs(O[1]) + Math.abs(O[2]);
            if (!hit || m > best) { hit = true; best = m; bx = O[0]; by = O[1]; bz = O[2]; }
          }
        };
        test(0, ft / 2, 0, ix + t, ft / 2, iz + t);
        test(ix + t / 2, H / 2, 0, t / 2, H / 2, iz + t);
        test(-ix - t / 2, H / 2, 0, t / 2, H / 2, iz + t);
        test(0, H / 2, iz + t / 2, ix + t, H / 2, t / 2);
        test(0, H / 2, -iz - t / 2, ix + t, H / 2, t / 2);
        if (hit) { O[0] = bx; O[1] = by; O[2] = bz; }
        return hit;
      }
      case 'cup': {
        const R = col.R, t = Math.max(col.t, 2.4 * r), H = col.H, Ro = R + t, ft = col.t;
        const rho = Math.sqrt(lx * lx + lz * lz);
        if (col.prevInside) {
          let hit = false;
          O[0] = O[1] = O[2] = 0;
          if (ly < H + r && rho > R - r) { const f = (R - r) / rho; O[0] = lx * f - lx; O[2] = lz * f - lz; hit = true; }
          if (ly < ft + r && rho < Ro) { O[1] = ft + r - ly; hit = true; }
          return hit;
        }
        // Bottom disk.
        if (rho < Ro + r && ly > -r && ly < ft + r) {
          const up = ft + r - ly, down = ly + r, side = Ro + r - rho;
          if (rho < R || up < side) {
            if (up <= down) { O[0] = 0; O[1] = up; O[2] = 0; } else { O[0] = 0; O[1] = -down; O[2] = 0; }
            return true;
          }
        }
        // Wall shell.
        if (ly > 0 && ly < H + r && rho > R - r && rho < Ro + r) {
          const nx = rho > 1e-6 ? lx / rho : 1, nz = rho > 1e-6 ? lz / rho : 0;
          const inner = rho - (R - r), outer = Ro + r - rho, top = H + r - ly;
          if (top < inner && top < outer) { O[0] = 0; O[1] = top; O[2] = 0; return true; }
          if (rho < R + t * 0.5) { O[0] = -nx * inner; O[1] = 0; O[2] = -nz * inner; }
          else { O[0] = nx * outer; O[1] = 0; O[2] = nz * outer; }
          return true;
        }
        return false;
      }
    }
    return false;
  }
  PC.collideLocal = collideLocal;
  PC.Fluid = Fluid;
})(window.PC);
