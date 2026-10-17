// Simulation orchestrator: owns the particle engine and rigid bodies, the wind field, the liquid
// surface map (buoyancy), shared explosions, spawning, interactive tools and entity queries.
(function (PC) {
  'use strict';
  const { SOLID, POWDER, LIQUID, GAS } = PC.PHASE;

  PC.DEFAULT_SETTINGS = {
    // Simulation
    gravity: 1, timeScale: 1, substeps: 2, solverIters: 3, springIters: 3, airDrag: 1, fluidDamping: 0.1, surfaceTension: 1,
    ambientT: 293, conduction: 1, ambientExchange: 1, reactions: true, reactionSpeed: 1, fusion: true, fission: true,
    radioactivity: true, decaySpeed: 1, worldWidth: 30, worldDepth: 8, sideWalls: true, openCeiling: true, maxParticles: 20000,
    // Wind
    windSpeed: 1.2, windDir: 20, windGust: 0.5, windWater: 1.5, windToolSpeed: 14,
    // Interaction
    brushRadius: 0.25, heatRate: 40, explodePower: 12, pourRate: 1, hoverStir: true, hoverStrength: 1,
    // Graphics
    quality: 'high', renderScale: 1, shadows: 'high', bloom: true, bloomStrength: 0.35, fluidQuality: 1, fluidSmoothing: 4,
    ripples: true, environment: 'garden', sunElevation: 38, sunAzimuth: 150, exposure: 1, scenery: true, grid: true,
    // Nature
    timeOfDay: 11, dayLength: 0, weather: 'clear', cloudCover: 0, rain: 0, snow: 0, fog: 0.05, lightning: false, rainFills: true,
    showLabels: true, showStats: true, showMinimap: true, sound: true, volume: 0.7, autoQuality: true, renderMode: 'realistic', ao: true,
  };

  // Height of the liquid surface over a coarse grid, used for rigid-body buoyancy.
  // The workspace is the tiled floor (worldWidth × worldDepth); nothing is placed or acted on outside it.
  PC.onTiles = (s, x, z) => Math.abs(x) <= s.worldWidth / 2 && Math.abs(z) <= s.worldDepth / 2;
  PC.clampToTiles = (s, x, z, margin) => {
    const hw = Math.max(0, s.worldWidth / 2 - (margin || 0)), hd = Math.max(0, s.worldDepth / 2 - (margin || 0));
    return [Math.max(-hw, Math.min(hw, x)), Math.max(-hd, Math.min(hd, z))];
  };

  class SurfaceMap {
    constructor(sim) { this.sim = sim; this.cell = 0.1; this.alloc(); }
    alloc() {
      const s = this.sim.s;
      this.W = s.worldWidth; this.D = s.worldDepth;
      this.gw = Math.ceil(this.W / this.cell) + 2; this.gd = Math.ceil(this.D / this.cell) + 2;
      this.top = new Float32Array(this.gw * this.gd); this.bot = new Float32Array(this.gw * this.gd); this.vs = new Float32Array(this.gw * this.gd); this.rs = new Float32Array(this.gw * this.gd); this.rc = new Uint16Array(this.gw * this.gd);
    }
    update() {
      const s = this.sim.s, f = this.sim.fluid;
      if (s.worldWidth !== this.W || s.worldDepth !== this.D) this.alloc();
      this.top.fill(-1); this.bot.fill(1e9); this.vs.fill(0); this.rs.fill(0); this.rc.fill(0);
      const inv = 1 / this.cell, hw = this.W / 2, hd = this.D / 2;
      for (let k = 0; k < f.nAct; k++) {
        const i = f.act[k];
        if (!f.alive[i] || f.phase[i] !== LIQUID) continue;
        const cx = ((f.x[i] + hw) * inv) | 0, cz = ((f.z[i] + hd) * inv) | 0;
        if (cx < 0 || cz < 0 || cx >= this.gw || cz >= this.gd) continue;
        const c = cz * this.gw + cx, t = f.y[i] + f.r;
        if (t > this.top[c]) this.top[c] = t;
        if (f.y[i] - f.r < this.bot[c]) this.bot[c] = f.y[i] - f.r;
        this.rs[c] += f.mass[i]; this.vs[c] += f.gVisc[f.grp[i]]; if (this.rc[c] < 65000) this.rc[c]++;
      }
    }
    levelAround(x, z, R) {
      const inv = 1 / this.cell, hw = this.W / 2, hd = this.D / 2;
      const c0 = Math.max(0, ((x - R + hw) * inv) | 0), c1 = Math.min(this.gw - 1, ((x + R + hw) * inv) | 0);
      const r0 = Math.max(0, ((z - R + hd) * inv) | 0), r1 = Math.min(this.gd - 1, ((z + R + hd) * inv) | 0);
      let top = -1, bottom = 1e9, rs = 0, rc = 0, vs = 0;
      for (let cz = r0; cz <= r1; cz++) for (let cx = c0; cx <= c1; cx++) {
        const c = cz * this.gw + cx;
        if (!this.rc[c]) continue;
        if (this.top[c] > top) top = this.top[c];
        if (this.bot[c] < bottom) bottom = this.bot[c];
        rs += this.rs[c]; vs += this.vs[c]; rc += this.rc[c];
      }
      return rc > 3 ? { top, bottom, rho: rs / rc, visc: vs / rc } : null;
    }
  }

  class Sim {
    constructor(settings, CANNON) {
      this.s = settings;
      this.events = [];
      this.discovered = new Set();
      this.time = 0;
      this.frame = 0;
      this.wind = { active: false };
      this.gust = null;
      this.pending = [];
      this.grabParticles = null;
      this.grabTarget = [0, 0, 0];
      this.input = { tool: 'stir', over: false, down: false, pressed: false, released: false, point: null, normal: [0, 1, 0], move: [0, 0, 0], entry: null, entryProps: null, hitEntity: null, grabPoint: null };
      this.fluid = new PC.Fluid(this, settings);
      this.bodies = new PC.Bodies(this, settings, CANNON);
      this.inventions = new PC.Inventions(this);
      this.iceLayers = new Map(); // ice thickness per (x,z) column, in particle layers
      this.surface = new SurfaceMap(this);
      this.stroke = null;
    }

    emit(e) { if (this.events.length < 600) this.events.push(e); }
    // Challenge progress: things the user has made happen at least once.
    achieve(key) { if (!this.achieved) this.achieved = new Set(); if (this.achieved.has(key)) return; this.achieved.add(key); this.emit({ type: 'achieve', key }); }

    discover(mi, phase, x, y, z) {
      const m = PC.MATS[mi];
      const key = m.phaseNames ? m.id + ':' + (phase === GAS ? 'gas' : phase === LIQUID ? 'liquid' : 'solid') : m.id;
      if (this.discovered.has(key)) return;
      this.discovered.add(key);
      this.emit({ type: 'discover', mat: m, phase, key, x, y, z });
    }

    // ------------------------------------------------------------------ wind
    windAt(x, y, z, t, out) {
      const s = this.s;
      let wx = 0, wy = 0, wz = 0;
      if (s.windSpeed > 0.05) {
        const n1 = 0.5 * Math.sin(1.3 * x - 2.1 * t + 0.7 * z) + 0.3 * Math.sin(2.9 * z + 1.7 * t - 0.4 * x) + 0.2 * Math.sin(4.7 * x + 3.3 * z - 3.9 * t);
        const n2 = 0.6 * Math.sin(3.1 * x + 1.3 * z - 4.2 * t) * Math.sin(2.3 * z - 0.9 * x + 1.1 * t) + 0.4 * Math.sin(5.3 * x - 6.1 * t);
        const a = s.windDir * Math.PI / 180 + 0.25 * s.windGust * Math.sin(0.13 * x + 0.21 * z - 0.3 * t);
        const sp = s.windSpeed * Math.max(0, 1 + s.windGust * n1);
        wx = Math.cos(a) * sp; wz = Math.sin(a) * sp;
        wy = s.windSpeed * (0.15 + s.windGust * 0.35) * n2;
      }
      const g = this.gust;
      if (g) {
        const dx = x - g.x, dy = y - g.y, dz = z - g.z;
        const along = dx * g.dx + dz * g.dz;
        const across = Math.hypot(dx - along * g.dx, dz - along * g.dz);
        if (along > -g.R * 0.3 && along < g.R * 3 && across < g.R && dy > -1 && dy < 1.2) {
          const f = (1 - across / g.R) * (1 - Math.max(0, along) / (g.R * 3)) * (1 - Math.abs(dy) / 1.2);
          const n = 0.7 + 0.3 * Math.sin(9 * x - 13 * t) * Math.sin(7 * z + 11 * t);
          wx += g.dx * g.speed * f * n; wz += g.dz * g.speed * f * n;
          wy += g.speed * f * 0.25 * Math.sin(6 * x + 5 * z - 10 * t);
        }
      }
      out[0] = wx; out[1] = wy; out[2] = wz;
      return out;
    }

    // ------------------------------------------------------------------ main step
    step(frameDt) {
      const s = this.s;
      const dt = (frameDt / 60) * s.timeScale;
      this.wind.active = s.windSpeed > 0.05 || !!this.gust;
      if (dt > 0) {
        this.bodies.preStep();
        this.bodies.stepPhysics(dt);
        this.fluid.colliders = this.bodies.colliders();
        this.updateBindings();
        this.fluid.step(frameDt);
        this.bodies.applyGrainImpulses();
        this.bodies.postStep(dt, frameDt * s.timeScale);
        this.surface.update();
        this.inventions.update(dt);
        if ((s.rain || 0) > 0.02 || (s.snow || 0) > 0.02) this.weatherEffects(dt);
        if (this.frame % 15 === 0) this.solidify();
        if (this.frame % 6 === 0) this.updatePressure();
        this.processExplosions();
        this.time += dt;
      } else {
        this.fluid.colliders = this.bodies.colliders();
        this.fluid.buildGrid();
      }
      this.applyTools(frameDt);
      this.frame++;
    }

    // ------------------------------------------------------------------ rain & snow acting on the world
    // Precipitation lands on whatever faces the sky: it chills hot surfaces (lava crusts over, hissing into steam),
    // drowns flames, and puts out burning objects. Things inside containers or under others are sheltered.
    weatherEffects(dt) {
      const s = this.s, f = this.fluid, wet = Math.min(1, (s.rain || 0) + (s.snow || 0) * 0.6), F_SURF = 32;
      const STEAM = PC.matIndex('water');
      let steamBudget = Math.random() < wet * 0.6 ? 1 : 0; // a wisp of steam now and then (it is the hiss you notice)
      for (let k = 0; k < f.nAct; k++) {
        const i = f.act[k];
        if (!f.alive[i]) continue;
        const ph = f.phase[i];
        if (f.mat[i] === f.FIRE) { if (Math.random() < wet * dt * 1.5) { f.convert(i, f.SMOKE); f.T[i] = 400; } continue; }
        if (ph === 3 || f.bind[i] >= 0) continue;
        const T = f.T[i];
        if (T < 380) continue;
        // Exposed surface of a hot liquid or solid (top layer: nothing above it).
        if (ph === 2 && !(f.flags[i] & F_SURF)) continue;
        if (ph !== 2 && f.occupied(f.x[i], f.y[i] + f.sp * 1.1, f.z[i], f.sp * 0.5)) continue;
        // Evaporating raindrops pull ~2.3 MJ/kg out of the surface: cools fast, especially a thin skin.
        // Only the skin chills: a crust forms, the interior stays molten (rock conducts heat slowly).
        f.T[i] = Math.max(300, T - wet * dt * (T > 900 ? 22 : 30));
        if (steamBudget > 0 && Math.random() < wet * dt * 1.2) {
          steamBudget--;
          const n = f.add(STEAM, f.x[i] + (Math.random() - 0.5) * f.sp, f.y[i] + f.sp, f.z[i] + (Math.random() - 0.5) * f.sp, 390, null, (Math.random() - 0.5) * 0.3, 0.8 + Math.random(), (Math.random() - 0.5) * 0.3);
          if (n >= 0 && Math.random() < 0.02) this.emit({ type: 'label', x: f.x[i], y: f.y[i] + 0.15, z: f.z[i], text: 'Hiss', color: '#dfefff' });
        }
      }
      // Burning objects out in the open.
      for (const e of this.bodies.list) {
        if (e.deleted || e.container) continue;
        if (e.burning && Math.random() < wet * dt * 0.35) {
          e.burning = false; e.T = this.s.ambientT + 40; e.doused = this.time + 6; // soaked: won't relight for a while
          f.forEachNear(e.cb.position.x, e.cb.position.y, e.cb.position.z, 0.5, (j) => { if (f.mat[j] === f.FIRE) f.convert(j, f.SMOKE); }); this.emit({ type: 'label', x: e.cb.position.x, y: e.cb.position.y + 0.2, z: e.cb.position.z, text: 'Rain put it out', color: '#9fd6ff' }); }
        else if (!e.burning && e.T > 330) e.T -= wet * dt * (e.T > 900 ? 120 : 30);
      }
    }

    // ------------------------------------------------------------------ pressure in lidded containers
    // Gas inside a lidded container pushes on it: P ≈ 1 atm × (1 + V_gas(T) / V_free). Matter that boiled inside
    // (steam from water…) expands ~30× more per particle than its gas-particle volume suggests. Past the vessel's
    // limit it bursts.
    updatePressure() {
      const f = this.fluid, info = this.bindInfo;
      if (!info || !info.length) return;
      const vp = Math.pow(f.sp, 3), acc = [];
      for (let k = 0; k < f.nAct; k++) {
        const i = f.act[k], b = f.bind[i];
        if (b < 0 || !f.alive[i] || !info[b]) continue;
        const a = acc[b] || (acc[b] = { gas: 0, cond: 0 });
        if (f.phase[i] === 3) {
          const m = PC.MATS[f.mat[i]], boiled = !m.life && m.bp > 293 ? 30 : 1;
          a.gas += vp * (f.T[i] / 293) * boiled;
        } else a.cond += vp;
      }
      for (let b = 0; b < info.length; b++) {
        const c = info[b];
        if (!c || !c.ent) continue;
        const e = c.ent, d = e.def;
        const V = d.shape === 'cup' ? Math.PI * d.R * d.R * (d.H - d.t) : 4 * d.ix * d.iz * (d.H - d.t);
        const a = acc[b] || { gas: 0, cond: 0 };
        const Vfree = Math.max(V * 0.05, V - a.cond);
        e.pressure = c.sealed ? 101325 * (1 + a.gas / Vfree) : 101325;
        const limit = { glass: 6e5, ceramic: 1e6, steel: 6e6, concrete: 2e6 }[PC.MATS[e.mat].id] || 1e6;
        if (c.sealed && e.pressure > limit) this.burst(e, b, c);
      }
    }
    burst(e, bindId, c) {
      const f = this.fluid, P = e.pressure, d = e.def, pos = e.cb.position;
      this.achieve('burst');
      e.props.sealed = false;
      const top = pos.y + d.H;
      this.emit({ type: 'label', x: pos.x, y: top + 0.25, z: pos.z, text: `Burst at ${(P / 1e5).toFixed(1)} bar!`, color: '#ffb36b' });
      // Contents blast out of the top.
      for (let k = 0; k < f.nAct; k++) {
        const i = f.act[k];
        if (f.bind[i] !== bindId) continue;
        f.bind[i] = -1;
        f.vy[i] += 3 + Math.random() * 4 * Math.min(4, P / 3e5); f.vx[i] += (Math.random() - 0.5) * 3; f.vz[i] += (Math.random() - 0.5) * 3;
      }
      this.explode(pos.x, top, pos.z, Math.min(20, (P / 1e5 - 1) * 0.8));
      if (PC.MATS[e.mat].id === 'glass') { try { this.bodies.shatter(e, [pos.x, top, pos.z], 50); } catch (err) { /* keep the vessel */ } }
    }

    // ------------------------------------------------------------------ solidification
    // Liquid that has frozen solid (lava → stone, lava quenched → obsidian, molten metal, water → ice, glass…)
    // and come to rest turns into real rigid rocks: each connected clump becomes one body shaped like the clump.
    solidify() {
      const f = this.fluid, sp = f.sp;
      if (this.grabParticles) return;
      const cand = [], mark = new Int32Array(0);
      void mark;
      for (let k = 0; k < f.nAct; k++) {
        const i = f.act[k];
        if (!f.alive[i] || f.phase[i] !== SOLID) continue;
        const m = PC.MATS[f.mat[i]];
        if (m.life || m.powder) continue;
        const v2 = f.vx[i] * f.vx[i] + f.vy[i] * f.vy[i] + f.vz[i] * f.vz[i];
        if (v2 > 0.5 * 0.5) continue;
        cand.push(i);
      }
      if (!cand.length) return;
      // Union-find over touching grains of the same material.
      const idx = new Map();
      cand.forEach((i, k) => idx.set(i, k));
      const parent = cand.map((_, k) => k);
      const find = (a) => { while (parent[a] !== a) { parent[a] = parent[parent[a]]; a = parent[a]; } return a; };
      const link = sp * 1.6;
      for (let k = 0; k < cand.length; k++) {
        const i = cand[k];
        f.forEachNear(f.x[i], f.y[i], f.z[i], link, (j) => {
          const kj = idx.get(j);
          if (kj === undefined || f.mat[j] !== f.mat[i]) return;
          const a = find(k), b = find(kj);
          if (a !== b) parent[a] = b;
        });
      }
      const clusters = new Map();
      for (let k = 0; k < cand.length; k++) { const r = find(k); if (!clusters.has(r)) clusters.set(r, []); clusters.get(r).push(cand[k]); }
      let made = 0;
      for (const ids of clusters.values()) {
        if (made >= 6) break;
        // Wait until the whole clump has stopped moving (a clump still touching hot liquid keeps growing).
        let hot = false;
        const isIce = f.matIsWater[f.mat[ids[0]]];
        for (const i of ids) { if (f.T[i] > PC.MATS[f.mat[i]].mp - (isIce ? 0.5 : 40)) { hot = true; break; } }
        if (hot) continue;
        // …and until no molten material is still flowing against it, so a whole flow sets as one rock.
        const m0 = PC.MATS[f.mat[ids[0]]], molten = m0.meltInto ? PC.MAT[m0.meltInto].index : f.mat[ids[0]];
        let wet = false;
        for (let q = 0; q < ids.length && !wet; q += 2) {
          const i = ids[q];
          f.forEachNear(f.x[i], f.y[i], f.z[i], link, (j) => { if (!wet && f.phase[j] === LIQUID && (f.mat[j] === molten || f.mat[j] === f.mat[i])) wet = true; });
        }
        if (wet) continue; // ice still touching water stays a bonded floating sheet of particles
        if (isIce && ids.length < 8) continue;
        this.bodies.spawnCluster(PC.MATS[f.mat[ids[0]]], ids.map((i) => [f.x[i], f.y[i], f.z[i]]), ids.reduce((s, i) => s + f.T[i], 0) / ids.length);
        if (PC.MATS[f.mat[ids[0]]].id === 'obsidian') this.achieve('obsidian');
        for (const i of ids) f.kill(i);
        made++;
      }
    }

    // ------------------------------------------------------------------ explosions
    explode(x, y, z, power, opts) {
      if (!(power > 0)) return;
      for (const e of this.pending) {
        const dx = e.x - x, dy = e.y - y, dz = e.z - z;
        if (dx * dx + dy * dy + dz * dz < 0.3 * 0.3) {
          const t = power / (e.power + power);
          e.x += (x - e.x) * t; e.y += (y - e.y) * t; e.z += (z - e.z) * t; e.power += power;
          if (opts && opts.nuclear) e.nuclear = true;
          return;
        }
      }
      if (this.pending.length < 24) this.pending.push({ x, y, z, power, color: opts && opts.color, nuclear: !!(opts && opts.nuclear) });
    }

    // Matter–antimatter annihilation: energy released as gamma rays; clustered per frame to stay cheap.
    annihilate(x, y, z, kg) {
      const list = this.annihilations || (this.annihilations = []);
      for (const a of list) {
        if ((a.x - x) ** 2 + (a.y - y) ** 2 + (a.z - z) ** 2 < 1) { a.kg += kg; a.n++; return; }
      }
      if (list.length < 6) list.push({ x, y, z, kg, n: 1 });
    }

    processExplosions() {
      if (this.annihilations && this.annihilations.length) {
        for (const a of this.annihilations) this.pending.push({ x: a.x, y: a.y, z: a.z, power: Math.min(260, 25 + a.kg * 70), annihilation: true, color: '#e6dcff' });
        this.annihilations.length = 0;
      }
      if (!this.pending.length) return;
      let list = this.pending;
      this.pending = [];
      if (list.length > 8) { list.sort((a, b) => b.power - a.power); list = list.slice(0, 8); }
      const f = this.fluid;
      let budget = 260;
      for (const e of list) {
        let P = Math.min(e.power, e.nuclear ? 400 : 160);
        const R = Math.min(e.nuclear ? 9 : 5, 0.35 + Math.sqrt(P) * 0.32 * (e.nuclear ? 1.6 : 1));
        const chain = f.blast(e, R, P);
        if (chain) P = Math.min(400, P + chain);
        this.bodies.blast(e, R, P);
        const nf = Math.min(budget, e.annihilation ? 24 : Math.min(80, Math.round(P * 3)));
        budget -= nf;
        for (let q = 0; q < nf; q++) {
          const u = Math.random() * 2 - 1, a = Math.random() * Math.PI * 2, sq = Math.sqrt(1 - u * u), s = Math.random() * R * 0.25;
          const sp = 1 + Math.random() * Math.min(9, 2 + P * 0.2);
          const i = f.add(f.FIRE, e.x + Math.cos(a) * sq * s, Math.max(f.r, e.y + Math.abs(u) * s), e.z + Math.sin(a) * sq * s, e.annihilation ? 20000 : 1600 + P * 40, null, Math.cos(a) * sq * sp, Math.abs(u) * sp + 0.5, Math.sin(a) * sq * sp);
          if (i < 0) break;
        }
        const ns = e.annihilation ? 0 : Math.min(budget, 50, Math.round(P * 1.2));
        budget -= ns;
        for (let q = 0; q < ns; q++) {
          const a = Math.random() * Math.PI * 2, s = Math.random() * R * 0.35;
          f.add(f.SMOKE, e.x + Math.cos(a) * s, e.y + Math.random() * R * 0.3 + 0.05, e.z + Math.sin(a) * s, 700, null, Math.cos(a) * 1.2, 0.6 + Math.random(), Math.sin(a) * 1.2);
        }
        this.emit({ type: 'explosion', x: e.x, y: e.y, z: e.z, R, power: P, color: e.color, nuclear: e.nuclear, annihilation: e.annihilation });
      }
    }

    // ------------------------------------------------------------------ spawning
    isBodyEntry(entry, T, props) {
      if (entry.kind === 'container') return false;
      if (entry.kind === 'invention' || entry.kind === 'dummy') return true;
      const m = PC.MAT[entry.mat];
      if (m.life || m.powder) return false;
      const mp = props && props.mp != null ? props.mp : m.mp;
      return T < mp;
    }

    spawn(entry, point, opts) {
      opts = opts || {};
      // Dropped beyond the tiles (on the garden, the rocks, the sky): bring it onto the nearest bit of floor.
      // Keep the whole thing on the tiles: margin = its own footprint (objects, models, containers).
      const cu = PC.CUSTOM && PC.CUSTOM[entry.key];
      const objR = cu && cu.modelDims ? Math.max(cu.modelDims[0], cu.modelDims[2]) + 0.05 : entry.kind === 'dummy' || (cu && cu.humanoid) ? 0.8 : 0.25;
      if (point && entry.kind !== 'container') {
        const [cx, cz] = PC.clampToTiles(this.s, point[0], point[2], objR);
        if (cx !== point[0] || cz !== point[2]) point = [cx, PC.onTiles(this.s, point[0], point[2]) ? point[1] : 0, cz];
      }
      if (point && !PC.onTiles(this.s, point[0], point[2])) {
        const d = entry.def, m = d ? Math.max(d.ix || 0, d.iz || 0, d.R || 0, d.hx || 0, d.hz || 0) + (d.t || 0) + 0.05 : 0.25;
        const [cx, cz] = PC.clampToTiles(this.s, point[0], point[2], m);
        point = [cx, 0, cz];
      } else if (point && entry.kind === 'container') {
        const d = entry.def, m = Math.max(d.ix || 0, d.iz || 0, d.R || 0, d.hx || 0, d.hz || 0) + (d.t || 0) + 0.05;
        const [cx, cz] = PC.clampToTiles(this.s, point[0], point[2], m);
        point = [cx, point[1], cz];
      }
      if (entry.kind === 'container') return this.buildContainer(entry.def, point);
      if (entry.kind === 'custom' && entry.humanoid) {
        const ent = this.bodies.spawnDummy([point[0], 0.02, point[2]], null, 'human', entry.label);
        for (const e of this.bodies.list) if (e.dummy && e.dummy.id === ent.dummy.id) e.searchKey = entry.key;
        this.emit({ type: 'spawn', x: point[0], y: 0.9, z: point[2], R: 1, color: '#d6a283', label: entry.label, entity: ent });
        return ent;
      }
      if (entry.kind === 'dummy') {
        const ent = this.bodies.spawnDummy([point[0], 0.02, point[2]]);
        this.emit({ type: 'spawn', x: point[0], y: 0.9, z: point[2], R: 1, color: '#f2c230', label: 'Crash-test dummy', entity: ent });
        return ent;
      }
      if (entry.kind === 'invention') {
        const box = opts.noContainer ? null : this.containerAt(point[0], point[2], opts.target);
        const inv = PC.INVENTION[entry.inv];
        const p = box ? [box.x, box.floor + inv.dims[1] + 0.03, box.z] : [point[0], point[1] + inv.dims[1] + 0.2, point[2]];
        const ent = this.inventions.spawn(entry.inv, p);
        this.emit({ type: 'spawn', x: p[0], y: p[1], z: p[2], R: Math.max(...inv.dims) * 1.8, color: '#ffe38a', label: inv.label, entity: ent });
        return ent;
      }
      const m = PC.MAT[entry.mat];
      const T = opts.T != null ? opts.T : entry.T != null ? entry.T : 293;
      const props = opts.props ? Object.assign({}, opts.props) : null;
      const [x, y, z] = point;
      const f = this.fluid, sp = f.sp;
      // Dropped onto (or into) a container: the substance goes inside and stays there.
      const box = opts.noContainer ? null : this.containerAt(x, z, opts.target);
      let ent, R;
      if (this.isBodyEntry(entry, T, props) && opts.form !== 'particles') {
        const size = opts.size || 1;
        const dims = PC.bodyArchetype(m, entry.key).dims;
        const lift = Math.max(...dims) * size + (box ? 0.03 : 0.25);
        const px = box ? box.x : x, pz = box ? box.z : z, py = box ? box.floor : y;
        ent = this.bodies.spawnSolid(entry, m, [px, py + lift, pz], { size, T, props, v: opts.v });
        R = Math.max(...ent.dims) * 1.8;
        this.emit({ type: 'spawn', x: px, y: py + lift, z: pz, R, color: m.color, label: entry.label || m.name, entity: ent });
        return ent;
      }
      let count = opts.count || undefined;
      const phase = m.life ? GAS : T < (props && props.mp != null ? props.mp : m.mp) ? POWDER : T < (props && props.bp != null ? props.bp : m.bp) ? LIQUID : GAS;
      let shape = opts.shape, sx = x, sz = z, sy;
      if (box) {
        const def = box.def, inner = def.shape === 'cup' ? Math.PI * def.R * def.R * (def.H - def.t) : 4 * def.ix * def.iz * (def.H - def.t);
        if (!count) count = Math.max(8, Math.min(6000, Math.round((inner * (phase === GAS ? 0.25 : 0.45)) / (sp * sp * sp))));
        const margin = sp * 0.6;
        const hx = box.cup ? box.R - margin : box.ix - margin, hz = box.cup ? box.R - margin : box.iz - margin;
        if (phase === GAS) { f.fitDims = [hx, hz, box.cup ? 1 : 0, Math.max(sp, def.H - def.t - sp * 1.5)]; shape = 'fitbox'; if (box.ent) box.ent.props.sealed = true; } // a gas needs the lid on to stay
        else { f.fitDims = [hx, hz, box.cup ? 1 : 0]; shape = 'fit'; }
        sx = box.x; sz = box.z; sy = box.floor + f.r + 0.005;
      } else {
        const n = count || 600;
        sy = y + Math.cbrt((n * 3) / (4 * Math.PI)) * sp + 0.12;
      }
      const res = f.spawnParticles(m, sx, sy, sz, { count, T, shape, props, label: entry.label || m.name, entryKey: entry.key, v: opts.v });
      if (box && box.ent.bindId != null) for (const i of res.ids) f.bind[i] = box.ent.bindId;
      ent = res.group;
      R = res.R;
      if (m.index === f.AIR && !box) this.airGust(x, y + 0.2, z, 1.5, 6);
      this.emit({ type: 'spawn', x: sx, y: res.y, z: sz, R: box ? Math.min(R, 0.6) : R, color: m.color, label: entry.label || m.name, entity: ent });
      return ent;
    }

    // Per-frame container interiors for particles bound inside them.
    updateBindings() {
      const info = this.bindInfo || (this.bindInfo = []);
      info.length = 0;
      for (const e of this.bodies.list) {
        if (e.bindId == null || !e.def) continue;
        const b = e.cb.position, q = e.cb.quaternion, d = e.def;
        const upY = 1 - 2 * (q.x * q.x + q.z * q.z); // world-y of the local up axis
        info[e.bindId] = { cx: b.x, cy: b.y, cz: b.z, q: [q.x, q.y, q.z, q.w], ix: d.ix, iz: d.iz, R: d.R, H: d.H, t: d.t, cup: d.shape === 'cup', tilted: upY < 0.6, sealed: !!e.props.sealed, ent: e };
      }
    }

    // Upright open container whose interior contains (x, z): returns its interior footprint.
    containerAt(x, z, target) {
      const list = target && target.container ? [target, ...this.bodies.list] : this.bodies.list;
      for (const e of list) {
        if (!e.container || !e.def || (e.def.shape !== 'openbox' && e.def.shape !== 'cup')) continue;
        if (e === target) {
          const b = e.cb.position, def = e.def;
          return def.shape === 'cup' ? { x: b.x, z: b.z, R: def.R, cup: true, floor: b.y + def.t, def, ent: e } : { x: b.x, z: b.z, ix: def.ix, iz: def.iz, floor: b.y + def.t, def, ent: e };
        }
        const b = e.cb.position, q = e.cb.quaternion;
        if (Math.abs(q.x) > 0.05 || Math.abs(q.z) > 0.05) continue;
        const def = e.def, L = [0, 0, 0];
        PC.qrot(-q.x, -q.y, -q.z, q.w, x - b.x, 0, z - b.z, L);
        if (def.shape === 'openbox' && Math.abs(L[0]) < def.ix && Math.abs(L[2]) < def.iz) return { x: b.x, z: b.z, ix: def.ix, iz: def.iz, floor: b.y + def.t, def, ent: e };
        if (def.shape === 'cup' && L[0] * L[0] + L[2] * L[2] < def.R * def.R) return { x: b.x, z: b.z, R: def.R, cup: true, floor: b.y + def.t, def, ent: e };
      }
      return null;
    }

    buildContainer(def, point) {
      const e = this.bodies.buildContainer(def, [point[0], 0, point[2]]);
      const size = def.shape === 'openbox' ? Math.max(def.ix, def.iz) : def.shape === 'cup' ? def.R : Math.max(def.hx || 0.4, def.hz || 0.4);
      this.emit({ type: 'spawn', x: point[0], y: 0.2, z: point[2], R: size * 1.4, color: PC.MAT[def.mat].color, label: def.label, entity: e });
      return e;
    }

    airGust(x, y, z, R, strength) {
      const f = this.fluid;
      f.forEachNear(x, y, z, R, (j, d2) => {
        const d = Math.sqrt(d2) || 1e-3, k = (1 - d / R) * strength;
        f.vx[j] += (f.x[j] - x) / d * k; f.vy[j] += (f.y[j] - y) / d * k * 0.5; f.vz[j] += (f.z[j] - z) / d * k;
      });
      for (const e of this.bodies.list) {
        const b = e.cb, dx = b.position.x - x, dz = b.position.z - z, d = Math.hypot(dx, dz);
        if (d < R && b.type === this.bodies.C.Body.DYNAMIC) { b.wakeUp(); b.applyImpulse(new this.bodies.C.Vec3(dx / (d || 1) * strength * b.mass * 0.2, 0, dz / (d || 1) * strength * b.mass * 0.2)); }
      }
    }

    // ------------------------------------------------------------------ tools
    applyTools(frameDt) {
      const inp = this.input, s = this.s, f = this.fluid, B = this.bodies;
      const tool = inp.tool, R = s.brushRadius, dtS = Math.max(frameDt, 0.25) / 60;
      if (tool !== 'wind' || !inp.down) this.gust = null;
      // Tools only work on the tiled floor (finishing a grab that started on it is still allowed).
      if (inp.point && !PC.onTiles(s, inp.point[0], inp.point[2]) && !(tool === 'grab' && !inp.pressed)) { this.stroke = null; return; }
      if (tool === 'grab') {
        if (inp.released) { B.endGrab(); this.grabParticles = null; }
        if (inp.pressed && inp.point) {
          if (inp.hitEntity && inp.hitEntity.kind === 'body') B.startGrab(inp.hitEntity, inp.point);
          else {
            const list = [];
            f.forEachNear(inp.point[0], inp.point[1], inp.point[2], R, (j) => list.push([j, f.gen[j], f.x[j] - inp.point[0], f.y[j] - inp.point[1], f.z[j] - inp.point[2]]));
            this.grabParticles = list.length ? list : null;
          }
        }
        if (inp.down && inp.grabPoint) { B.moveGrab(inp.grabPoint); this.grabTarget = inp.grabPoint; }
        return;
      }
      if (!inp.point || !(inp.down || inp.over)) return;
      const [px, py, pz] = inp.point;
      if (tool === 'stir') {
        if (!inp.down) {
          // Hovering over a liquid gently drags the surface along with the cursor.
          if (!s.hoverStir) return;
          const mv = inp.move, vx = mv[0] / dtS, vz = mv[2] / dtS;
          if (Math.abs(vx) + Math.abs(vz) < 0.05) return;
          const Rh = R * 0.8;
          f.forEachNear(px, py, pz, Rh, (j, d2) => {
            if (f.phase[j] !== LIQUID) return;
            const k = (1 - Math.sqrt(d2) / Rh) * 0.12 * s.hoverStrength;
            f.vx[j] += (Math.max(-3, Math.min(3, vx)) - f.vx[j]) * k;
            f.vz[j] += (Math.max(-3, Math.min(3, vz)) - f.vz[j]) * k;
          });
          return;
        }
        const mv = inp.move, vx = mv[0] / dtS, vy = mv[1] / dtS, vz = mv[2] / dtS;
        if (Math.abs(vx) + Math.abs(vy) + Math.abs(vz) < 0.01) return;
        f.forEachNear(px, py, pz, R, (j, d2) => {
          if (f.isPinned(j)) return;
          const k = (1 - Math.sqrt(d2) / R) * 0.35;
          f.vx[j] += (Math.max(-8, Math.min(8, vx)) - f.vx[j]) * k;
          f.vy[j] += (Math.max(-8, Math.min(8, vy)) - f.vy[j]) * k * 0.5;
          f.vz[j] += (Math.max(-8, Math.min(8, vz)) - f.vz[j]) * k;
        });
        for (const e of B.list) {
          const b = e.cb;
          if (b.type !== B.C.Body.DYNAMIC) continue;
          const d = Math.hypot(b.position.x - px, b.position.y - py, b.position.z - pz);
          if (d < R + Math.max(...e.dims)) { b.wakeUp(); b.applyForce(new B.C.Vec3(vx * b.mass * 2, 0, vz * b.mass * 2)); }
        }
      } else if (tool === 'wind') {
        if (!inp.down) return;
        let dx = inp.dir ? inp.dir[0] : 1, dz = inp.dir ? inp.dir[2] : 0;
        const L = Math.hypot(dx, dz) || 1;
        this.gust = { x: px - dx / L * R, y: py + 0.1, z: pz - dz / L * R, dx: dx / L, dz: dz / L, speed: s.windToolSpeed, R: Math.max(0.4, R * 2.5) };
        this.wind.active = true;
        if (Math.random() < 0.5) this.emit({ type: 'windfx', x: px, y: py + 0.1, z: pz, dx: dx / L, dz: dz / L });
      } else if (tool === 'heat' || tool === 'cool') {
        if (!inp.down) return;
        const rate = s.heatRate * frameDt * s.timeScale;
        f.forEachNear(px, py, pz, R, (j, d2) => {
          const k = 1 - Math.sqrt(d2) / R;
          if (tool === 'heat') f.T[j] += rate * k * (1 + f.T[j] * 0.002);
          else f.T[j] = Math.max(0.5, f.T[j] - rate * k - f.T[j] * 0.01 * k);
        });
        for (const e of B.list) {
          const b = e.cb, d = Math.hypot(b.position.x - px, b.position.y - py, b.position.z - pz);
          const reach = R + (e.dims ? Math.max(...e.dims) : 0.3);
          if (d > reach) continue;
          const k = (1 - d / reach) * 0.35;
          if (tool === 'heat') e.T += rate * k * (1 + e.T * 0.002);
          else e.T = Math.max(0.5, e.T - rate * k - e.T * 0.01 * k);
        }
        if (Math.random() < 0.4) this.emit({ type: 'toolfx', x: px + (Math.random() - 0.5) * R, y: py + 0.02, z: pz + (Math.random() - 0.5) * R, color: tool === 'heat' ? '#ff7b2e' : '#7fd0ff' });
      } else if (tool === 'explode') {
        if (inp.pressed || (inp.down && this.frame % 16 === 0)) this.explode(px + inp.normal[0] * 0.05, py + inp.normal[1] * 0.05, pz + inp.normal[2] * 0.05, s.explodePower, { color: '#ffcc66' });
      } else if (tool === 'erase') {
        if (!inp.down) return;
        f.forEachNear(px, py, pz, R, (j) => f.kill(j));
        for (const e of B.list.slice()) {
          const b = e.cb;
          if (Math.hypot(b.position.x - px, b.position.y - py, b.position.z - pz) < R + 0.05) B.remove(e);
        }
      } else if (tool === 'pour') {
        if (!inp.down) { this.stroke = null; return; }
        const entry = inp.entry;
        if (!entry || entry.kind === 'container') return;
        const m = PC.MAT[entry.mat];
        const T = entry.T != null ? entry.T : 293;
        if (this.isBodyEntry(entry, T, inp.entryProps)) {
          if (this.frame % 14 === 0) this.spawn(entry, [px, py + 0.2, pz], { T, props: inp.entryProps, size: 0.7 + Math.random() * 0.5 });
          return;
        }
        if (!this.stroke || this.stroke.key !== entry.key) this.stroke = { key: entry.key, group: f.createGroup(m, inp.entryProps ? Object.assign({}, inp.entryProps) : null, entry.label || m.name, { entryKey: entry.key }) };
        const n = Math.max(1, Math.round(5 * s.pourRate * frameDt));
        const oy = py + 0.35;
        for (let q = 0; q < n; q++) {
          const a = Math.random() * Math.PI * 2, rr = Math.sqrt(Math.random()) * Math.min(R, 0.12);
          const x = px + Math.cos(a) * rr, z = pz + Math.sin(a) * rr, y = oy + Math.random() * 0.05;
          if (f.occupied(x, y, z, f.sp * 0.8)) continue;
          f.add(m.index, x, y, z, T, this.stroke.group, inp.move[0] * 20, -1.2, inp.move[2] * 20);
        }
      }
    }

    // ------------------------------------------------------------------ entities (particle groups & bodies)
    entityAt(point, hitEntity) {
      if (hitEntity) return hitEntity;
      if (!point) return null;
      const i = this.fluid.nearest(point[0], point[1], point[2], this.fluid.sp * 2);
      return i >= 0 ? this.fluid.groups[this.fluid.grp[i]] : null;
    }
    stats(ent) {
      if (ent.kind === 'body') {
        const b = ent.cb, kg = b.mass || ent.massKg || this.bodies.massOf(ent);
        return { count: 1, T: ent.T, cx: b.position.x, cy: b.position.y, cz: b.position.z, phases: [1, 0, 0, 0], speed: b.velocity.length(), kg, moles: kg * 1000 / PC.MATS[ent.mat].M, alive: !ent.deleted };
      }
      const st = this.fluid.groupStats(ent);
      st.alive = st.count > 0;
      return st;
    }
    remove(ent) {
      if (ent.kind === 'body') this.bodies.remove(ent);
      else { for (const i of this.fluid.groupParticles(ent)) this.fluid.kill(i); ent.deleted = true; }
    }
    setTemperature(ent, T) {
      if (ent.kind === 'body') ent.T = T;
      else for (const i of this.fluid.groupParticles(ent)) this.fluid.T[i] = T;
    }
    ignite(ent) {
      if (ent.kind === 'body') ent.T = ent.props.ignite + 200;
      else { const ids = this.fluid.groupParticles(ent); for (let k = 0; k < Math.min(8, ids.length); k++) this.fluid.T[ids[(Math.random() * ids.length) | 0]] = ent.props.ignite + 250; }
    }
    explodeEntity(ent, P) { const st = this.stats(ent); if (st.count) this.explode(st.cx, st.cy, st.cz, P); }
    refresh(ent) {
      if (ent.kind === 'body') {
        if (!!ent.props.pinned !== (ent.cb.type === this.bodies.C.Body.STATIC)) this.bodies.setPinned(ent, !!ent.props.pinned);
        else if (!ent.props.pinned && !ent.container) { ent.cb.mass = this.bodies.massOf(ent); ent.cb.updateMassProperties(); }
        for (const s of ent.cb.shapes) void s;
        ent.cb.wakeUp();
      } else this.fluid.refreshGroup(ent);
    }
    duplicate(ent) {
      const st = this.stats(ent);
      if (!st.count) return null;
      const m = PC.MATS[ent.mat];
      const entry = { key: ent.entryKey || m.id, mat: m.id, label: ent.name, T: st.T, kind: 'basic' };
      if (ent.kind === 'body') {
        if (ent.container) return this.buildContainer(ent.def, [st.cx + 1.2, 0, st.cz]);
        const unit = PC.bodyArchetype(m, ent.entryKey).dims[0];
        return this.spawn(entry, [st.cx + 0.4, st.cy, st.cz], { size: ent.dims[0] / unit, T: st.T, props: Object.assign({}, ent.props) });
      }
      return this.spawn(entry, [st.cx + 0.5, st.cy + 0.3, st.cz], { count: st.count, T: st.T, props: Object.assign({}, ent.props) });
    }
    // Absolute size multiplier of a body relative to its material's standard model.
    sizeOf(ent) {
      if (ent.kind !== 'body' || ent.container) return 1;
      return ent.dims[0] / PC.bodyArchetype(PC.MATS[ent.mat], ent.entryKey).dims[0];
    }
    // Resize an object in place (smoothly, so a slider can drive it while being dragged).
    resizeTo(ent, size) {
      if (ent.kind !== 'body' || ent.container || ent.deleted) return ent;
      const unit = PC.bodyArchetype(PC.MATS[ent.mat], ent.entryKey).dims[0];
      const s = Math.max(0.02, (size * unit) / ent.baseDims[0]);
      this.bodies.rescale(ent, ent.baseVolume * s * s * s, true);
      const b = ent.cb, d = ent.dims;
      if (b.position.y < d[1] + 0.002) b.position.y = d[1] + 0.002; // grew into the floor: lift it out
      b.wakeUp();
      return ent;
    }

    resize(ent, factor) {
      if (ent.kind !== 'body' || ent.container) return ent;
      const st = this.stats(ent), m = PC.MATS[ent.mat];
      const unit = PC.bodyArchetype(m, ent.entryKey).dims[0];
      const entry = { key: ent.entryKey || m.id, mat: m.id, label: ent.name, T: st.T };
      this.bodies.remove(ent);
      const e = this.bodies.spawnSolid(entry, m, [st.cx, st.cy, st.cz], { size: Math.max(0.1, (ent.dims[0] / unit) * factor), T: st.T, props: ent.props, yaw: 0 });
      return e;
    }
    probe(point, hitEntity) {
      if (hitEntity && hitEntity.kind === 'body') {
        const e = hitEntity, m = PC.MATS[e.mat];
        return { mat: m, name: e.name, phase: SOLID, T: e.T, v: e.cb.velocity.length(), entity: e, body: true };
      }
      if (!point) return null;
      const f = this.fluid;
      const i = f.nearest(point[0], point[1], point[2], f.sp * 1.6);
      if (i < 0) return null;
      const m = PC.MATS[f.mat[i]];
      return { mat: m, name: PC.phaseName(m, f.phase[i]), phase: f.phase[i], T: f.T[i], v: Math.hypot(f.vx[i], f.vy[i], f.vz[i]), rho: f.nd[i] / f.n0, entity: f.groups[f.grp[i]] };
    }
    clear() {
      this.fluid.clear();
      this.bodies.clear();
      this.pending = [];
      this.grabParticles = null;
      this.gust = null;
      this.stroke = null;
    }
  }

  PC.Sim = Sim;
})(window.PC);
