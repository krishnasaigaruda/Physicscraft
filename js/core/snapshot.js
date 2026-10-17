// World snapshots: capture and restore everything in the workspace (particles, their groups and bonds, rigid objects,
// containers, solidified rocks, inventions). Used for undo, rewind and saving scenes to a file. No server involved:
// snapshots live in memory, and saved scenes are ordinary .json files the browser downloads and opens.
(function (PC) {
  'use strict';

  const FIELDS_F = ['x', 'y', 'z', 'vx', 'vy', 'vz', 'T', 'life', 'maxLife', 'age', 'seed'];

  PC.captureWorld = function (sim) {
    const f = sim.fluid, n = f.nAct;
    const ids = [];
    for (let k = 0; k < n; k++) { const i = f.act[k]; if (f.alive[i]) ids.push(i); }
    const N = ids.length, P = {};
    for (const key of FIELDS_F) { const a = new Float32Array(N), src = f[key]; for (let k = 0; k < N; k++) a[k] = src[ids[k]]; P[key] = a; }
    P.mat = new Int16Array(N); P.grp = new Int32Array(N); P.tint = new Int16Array(N); P.bind = new Int16Array(N); P.flags = new Uint8Array(N); P.phase = new Uint8Array(N);
    if (f.ph) P.ph = new Float32Array(N);
    if (f.solute) P.solute = new Int16Array(N);
    if (f.conc) P.conc = new Float32Array(N);
    const slot = new Map();
    for (let k = 0; k < N; k++) {
      const i = ids[k];
      slot.set(i, k);
      P.mat[k] = f.mat[i]; P.grp[k] = f.grp[i]; P.tint[k] = f.tint[i]; P.bind[k] = f.bind[i]; P.flags[k] = f.flags[i]; P.phase[k] = f.phase[i];
      if (P.ph) P.ph[k] = f.ph[i];
      if (P.solute) P.solute[k] = f.solute[i];
      if (P.conc) P.conc[k] = f.conc[i];
    }
    // Springs (solid particle clumps), by snapshot slot.
    const S = [];
    for (let k = 0; k < f.nS; k++) {
      const a = f.sA[k], b = f.sB[k];
      if (!f.alive[a] || !f.alive[b] || f.gen[a] !== f.sGA[k] || f.gen[b] !== f.sGB[k]) continue;
      const sa = slot.get(a), sb = slot.get(b);
      if (sa != null && sb != null) S.push(sa, sb);
    }
    const groups = f.groups.map((g) => g && JSON.parse(JSON.stringify(g, (key, v) => (key === 'members' ? undefined : v))));
    const bodies = [];
    for (const e of sim.bodies.list) {
      if (e.deleted) continue;
      const b = e.cb;
      bodies.push({
        id: e.id, entryKey: e.entryKey, name: e.name, mat: PC.MATS[e.mat].id, props: JSON.parse(JSON.stringify(e.props)), T: e.T,
        container: e.container ? e.def.key : null, cluster: !!e.cluster, shapePts: e.shapePts || null, invention: e.invention || null,
        inv: e.inv ? JSON.parse(JSON.stringify(e.inv)) : null,
        pos: [b.position.x, b.position.y, b.position.z], quat: [b.quaternion.x, b.quaternion.y, b.quaternion.z, b.quaternion.w],
        vel: [b.velocity.x, b.velocity.y, b.velocity.z], ang: [b.angularVelocity.x, b.angularVelocity.y, b.angularVelocity.z],
        dims: e.baseDims ? e.baseDims.slice() : null, volume: e.volume, baseVolume: e.baseVolume, burnt: e.burnt || 0, burning: !!e.burning,
        meltJ: e.meltJ || 0, sleeping: b.sleepState === 2, dummy: e.dummy || null,
      });
    }
    return { v: 1, time: sim.time, N, P, S: new Int32Array(S), groups, bodies };
  };

  PC.restoreWorld = function (sim, snap) {
    const f = sim.fluid, B = sim.bodies;
    sim.clear();
    // Groups keep their ids, so particles can point back at them.
    f.groups = snap.groups.map((g) => (g ? Object.assign({}, g, { count: 0 }) : g));
    f.defaultGroups = new Map();
    for (const g of f.groups) if (g && g.auto && !g.deleted) f.defaultGroups.set(g.mat, g);
    f.cacheGroups();
    const P = snap.P, map = new Int32Array(snap.N);
    for (let k = 0; k < snap.N; k++) {
      const g = f.groups[P.grp[k]];
      const i = f.add(P.mat[k], P.x[k], P.y[k], P.z[k], P.T[k], g, P.vx[k], P.vy[k], P.vz[k]);
      map[k] = i;
      if (i < 0) continue;
      f.life[i] = P.life[k]; f.maxLife[i] = P.maxLife[k]; f.age[i] = P.age[k]; f.seed[i] = P.seed[k];
      f.tint[i] = P.tint[k]; f.bind[i] = P.bind[k]; f.flags[i] = P.flags[k]; f.phase[i] = P.phase[k];
      f.mass[i] = f.massFor(i, g ? g.props : PC.defaultProps(PC.MATS[P.mat[k]]));
      if (f.ph && P.ph) f.ph[i] = P.ph[k];
      if (f.solute && P.solute) f.solute[i] = P.solute[k];
      if (f.conc && P.conc) f.conc[i] = P.conc[k];
    }
    for (let k = 0; k < snap.S.length; k += 2) { const a = map[snap.S[k]], b = map[snap.S[k + 1]]; if (a >= 0 && b >= 0) f.addSpring(a, b); }
    // Rigid things.
    const C = B.C, dummies = {};
    for (const s of snap.bodies) {
      const mat = PC.MAT[s.mat];
      if (!mat) continue;
      let e = null;
      try {
        if (s.container) {
          const def = PC.CONTAINERS.find((c) => c.key === s.container);
          if (!def) continue;
          e = B.buildContainer(def, [s.pos[0], 0, s.pos[2]]);
          e.props = Object.assign(e.props, s.props);
          if (!s.props.pinned) B.setPinned(e, false);
        } else if (s.cluster && s.shapePts) {
          e = B.spawnCluster(mat, s.shapePts.map((p) => [p[0] + s.pos[0], p[1] + s.pos[1], p[2] + s.pos[2]]), s.T);
          e.props = Object.assign(e.props, s.props);
        } else if (s.invention) {
          e = sim.inventions.spawn(s.invention, s.pos, s.inv || {});
          if (s.inv) e.inv = s.inv;
        } else {
          e = B.spawnSolid({ key: s.entryKey, label: s.name }, mat, s.pos, { size: 1, dims: s.dims, props: s.props, T: s.T });
        }
      } catch (err) { console.warn('restore body', s.name, err); continue; }
      if (!e) continue;
      e.name = s.name; e.T = s.T; e.burnt = s.burnt; e.burning = s.burning; e.meltJ = s.meltJ;
      const b = e.cb;
      b.position.set(s.pos[0], s.pos[1], s.pos[2]);
      b.quaternion.set(s.quat[0], s.quat[1], s.quat[2], s.quat[3]);
      b.velocity.set(s.vel[0], s.vel[1], s.vel[2]);
      b.angularVelocity.set(s.ang[0], s.ang[1], s.ang[2]);
      if (!e.container && !e.cluster && s.volume && s.baseVolume) {
        e.baseVolume = s.baseVolume; e.scale = -1;
        B.rescale(e, s.volume);
      }
      if (s.sleeping && b.type === C.Body.DYNAMIC) b.sleep();
      if (s.dummy) { e.dummy = s.dummy; e.cb.angularDamping = 0.35; (dummies[s.dummy.id] || (dummies[s.dummy.id] = {}))[s.dummy.part] = e; }
    }
    for (const id in dummies) B.linkDummy(dummies[id]);
    sim.time = snap.time || sim.time;
    sim.events.length = 0;
  };

  // ---------------------------------------------------------------- scene files (.json)
  const b64 = (ta) => { const u = new Uint8Array(ta.buffer, ta.byteOffset, ta.byteLength); let s = ''; for (let k = 0; k < u.length; k += 0x8000) s += String.fromCharCode.apply(null, u.subarray(k, k + 0x8000)); return btoa(s); };
  const unb64 = (str, Type) => { const s = atob(str), u = new Uint8Array(s.length); for (let k = 0; k < s.length; k++) u[k] = s.charCodeAt(k); return new Type(u.buffer); };
  const TYPES = { Float32Array, Int16Array, Int32Array, Uint8Array };

  PC.sceneToJSON = function (snap, extra) {
    const P = {};
    for (const k in snap.P) P[k] = { t: snap.P[k].constructor.name, d: b64(snap.P[k]) };
    return JSON.stringify(Object.assign({ app: 'PhysicsCraft', format: 1, saved: new Date().toISOString(), time: snap.time, N: snap.N, P, S: b64(snap.S), groups: snap.groups, bodies: snap.bodies }, extra || {}));
  };
  PC.sceneFromJSON = function (text) {
    const o = JSON.parse(text);
    if (o.app !== 'PhysicsCraft') throw new Error('This file is not a PhysicsCraft scene.');
    const P = {};
    for (const k in o.P) P[k] = unb64(o.P[k].d, TYPES[o.P[k].t] || Float32Array);
    return { snap: { v: 1, time: o.time, N: o.N, P, S: unb64(o.S, Int32Array), groups: o.groups, bodies: o.bodies }, file: o };
  };

  // ---------------------------------------------------------------- undo / rewind history
  class History {
    constructor(sim) { this.sim = sim; this.undo = []; this.redo = []; this.ring = []; this.lastRing = 0; this.max = 30; }
    // Call before any user action that changes the world.
    mark(label) {
      const now = performance.now();
      if (this.undo.length && now - this.undo[this.undo.length - 1].at < 250 && this.undo[this.undo.length - 1].label === label) return; // coalesce bursts
      this.undo.push({ snap: PC.captureWorld(this.sim), label, at: now });
      if (this.undo.length > this.max) this.undo.shift();
      this.redo.length = 0;
    }
    undoLast() {
      const u = this.undo.pop();
      if (!u) return null;
      this.redo.push({ snap: PC.captureWorld(this.sim), label: u.label, at: performance.now() });
      PC.restoreWorld(this.sim, u.snap);
      return u.label;
    }
    redoLast() {
      const r = this.redo.pop();
      if (!r) return null;
      this.undo.push({ snap: PC.captureWorld(this.sim), label: r.label, at: performance.now() });
      PC.restoreWorld(this.sim, r.snap);
      return r.label;
    }
    // Rewind ring: one snapshot per simulated second, last 20 s.
    tick() {
      const t = this.sim.time;
      if (t - this.lastRing < 1) return;
      this.lastRing = t;
      this.ring.push({ t, snap: PC.captureWorld(this.sim) });
      if (this.ring.length > 20) this.ring.shift();
    }
    rewind(seconds) {
      if (!this.ring.length) return false;
      const target = this.sim.time - seconds;
      let pick = this.ring[0];
      for (const r of this.ring) if (r.t <= target) pick = r;
      this.mark('rewind');
      PC.restoreWorld(this.sim, pick.snap);
      this.ring = this.ring.filter((r) => r.t <= pick.t);
      this.lastRing = pick.t;
      return true;
    }
    clearRing() { this.ring.length = 0; this.lastRing = 0; }
  }
  PC.History = History;
})(window.PC);
