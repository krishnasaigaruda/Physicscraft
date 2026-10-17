// Rigid bodies (cannon-es): solid chunks, ingots, planks, ice, containers and structures.
// Couples to the particle engine through colliders, buoyancy from the liquid surface, heat exchange,
// chemistry at the surface, melting into liquid, burning, fracture and critical-mass fission.
(function (PC) {
  'use strict';
  const { SOLID, POWDER, LIQUID, GAS } = PC.PHASE;

  // Visual/physical archetype for a solid material.
  function archetype(mat, entryKey) {
    const spec = PC.modelSpec(mat, entryKey);
    return { kind: spec.shape, dims: spec.dims, look: spec.look };
  }
  PC.bodyArchetype = archetype;

  class Bodies {
    constructor(sim, settings, CANNON) {
      this.sim = sim;
      this.s = settings;
      this.C = CANNON;
      const w = this.world = new CANNON.World({ gravity: new CANNON.Vec3(0, -9.81, 0) });
      w.broadphase = new CANNON.SAPBroadphase(w);
      w.allowSleep = true;
      w.solver.iterations = 14;
      w.defaultContactMaterial.friction = 0.55;
      w.defaultContactMaterial.restitution = 0.15;
      w.defaultContactMaterial.contactEquationStiffness = 1e8;
      w.defaultContactMaterial.contactEquationRelaxation = 3;
      const ground = new CANNON.Body({ mass: 0, shape: new CANNON.Plane() });
      ground.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
      w.addBody(ground);
      this.ground = ground;
      // Invisible walls around the tiled floor so objects can't roll, slide or be thrown off it.
      const W = settings.worldWidth, D = settings.worldDepth, Hh = 3, t = 0.5;
      for (const [x, z, hx, hz] of [[W / 2 + t, 0, t, D / 2 + 2 * t], [-W / 2 - t, 0, t, D / 2 + 2 * t], [0, D / 2 + t, W / 2 + 2 * t, t], [0, -D / 2 - t, W / 2 + 2 * t, t]]) {
        const wall = new CANNON.Body({ mass: 0, type: CANNON.Body.STATIC });
        wall.addShape(new CANNON.Box(new CANNON.Vec3(hx, Hh, hz)));
        wall.position.set(x, Hh, z);
        w.addBody(wall);
      }
      this.list = [];
      this.nextId = 1;
      this.mouse = null;
    }

    // ------------------------------------------------------------------ creation
    makeEntity(mat, props, name, extra) {
      const e = Object.assign({
        id: 'b' + this.nextId++, kind: 'body', mat: mat.index, name: name || mat.name,
        props: Object.assign(PC.defaultProps(mat), props || {}), T: 293, contacts: [], parts: [], colliders: [],
        scale: 1, volume: 0, baseVolume: 0, age: 0, deleted: false, burnt: 0, charge: 0,
      }, extra || {});
      return e;
    }

    // A dynamic solid chunk (box or sphere) at position p.
    spawnSolid(entry, mat, p, opts) {
      const C = this.C;
      const arch = archetype(mat, entry.key);
      const size = opts.size || 1;
      const d = (opts.dims || arch.dims).map((v) => v * size);
      const e = this.makeEntity(mat, opts.props, entry.label || mat.name, { entryKey: entry.key, arch: arch.kind });
      e.T = opts.T != null ? opts.T : 293;
      e.dims = d.slice();
      e.baseDims = d.slice();
      e.volume = e.baseVolume = 8 * d[0] * d[1] * d[2];
      const body = new C.Body({ mass: this.massOf(e), linearDamping: 0.02, angularDamping: 0.05, allowSleep: true, sleepSpeedLimit: 0.05, sleepTimeLimit: 1.5 });
      body.addShape(new C.Box(new C.Vec3(d[0], d[1], d[2])));
      body.position.set(p[0], Math.max(p[1], d[1] + 0.01), p[2]);
      const yaw = opts.yaw != null ? opts.yaw : (Math.random() - 0.5) * 0.6;
      body.quaternion.setFromEuler((Math.random() - 0.5) * 0.3, yaw, (Math.random() - 0.5) * 0.3);
      if (opts.v) body.velocity.set(opts.v[0], opts.v[1], opts.v[2]);
      e.cb = body;
      e.parts = [{ type: 'box', off: [0, 0, 0], q: [0, 0, 0, 1], hx: d[0], hy: d[1], hz: d[2] }];
      if (e.props.pinned) this.setPinned(e, true);
      body.addEventListener('collide', (ev) => this.onCollide(e, ev));
      this.world.addBody(body);
      this.list.push(e);
      return e;
    }

    // A rock frozen out of particles: compound body of boxes following the clump; the view builds a matching
    // smooth rock surface from e.shapePts.
    spawnCluster(mat, pts, T) {
      const C = this.C, sp = this.sim.fluid.sp, r = this.sim.fluid.r;
      let cx = 0, cy = 0, cz = 0;
      for (const p of pts) { cx += p[0]; cy += p[1]; cz += p[2]; }
      cx /= pts.length; cy /= pts.length; cz /= pts.length;
      const local = pts.map((p) => [p[0] - cx, p[1] - cy, p[2] - cz]);
      let mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9];
      for (const p of local) for (let a = 0; a < 3; a++) { mn[a] = Math.min(mn[a], p[a] - r); mx[a] = Math.max(mx[a], p[a] + r); }
      const e = this.makeEntity(mat, null, mat.name, { entryKey: 'solidified', arch: 'cluster' });
      e.cluster = true;
      e.T = T;
      e.shapePts = local;
      // Collision: voxel boxes over the clump (coarser for big clumps).
      let cell = sp * 2;
      let cells;
      for (;;) {
        cells = new Map();
        for (const p of local) {
          const k = [Math.floor((p[0] - mn[0]) / cell), Math.floor((p[1] - mn[1]) / cell), Math.floor((p[2] - mn[2]) / cell)].join(',');
          if (!cells.has(k)) cells.set(k, [1e9, 1e9, 1e9, -1e9, -1e9, -1e9]);
          const b = cells.get(k);
          for (let a = 0; a < 3; a++) { b[a] = Math.min(b[a], p[a] - r * 0.9); b[a + 3] = Math.max(b[a + 3], p[a] + r * 0.9); }
        }
        if (cells.size <= 48) break;
        cell *= 1.5;
      }
      const body = new C.Body({ mass: 1, linearDamping: 0.02, angularDamping: 0.08, allowSleep: true, sleepSpeedLimit: 0.05, sleepTimeLimit: 1 });
      e.parts = [];
      e.baseParts = [];
      for (const b of cells.values()) {
        const hx = (b[3] - b[0]) / 2, hy = (b[4] - b[1]) / 2, hz = (b[5] - b[2]) / 2, ox = (b[3] + b[0]) / 2, oy = (b[4] + b[1]) / 2, oz = (b[5] + b[2]) / 2;
        body.addShape(new C.Box(new C.Vec3(hx, hy, hz)), new C.Vec3(ox, oy, oz));
        e.parts.push({ type: 'box', off: [ox, oy, oz], q: [0, 0, 0, 1], hx, hy, hz });
        e.baseParts.push([ox, oy, oz, hx, hy, hz]);
      }
      e.dims = [(mx[0] - mn[0]) / 2, (mx[1] - mn[1]) / 2, (mx[2] - mn[2]) / 2];
      e.baseDims = e.dims.slice();
      e.volume = e.baseVolume = pts.length * sp * sp * sp;
      body.mass = this.massOf(e);
      body.updateMassProperties();
      body.position.set(cx, cy, cz);
      e.cb = body;
      body.addEventListener('collide', (ev) => this.onCollide(e, ev));
      this.world.addBody(body);
      this.list.push(e);
      return e;
    }

    // Crash-test dummy: ten plastic body parts joined by ball joints (a ragdoll).
    spawnDummy(p, id, style, label) {
      style = style || 'dummy';
      const C = this.C, mat = style === 'human' ? PC.MAT.flesh : PC.MAT.plastic, dummy = id || 'd' + this.nextId;
      const P = PC.HUMAN_PARTS, parts = {}; // both are real rigged models on the same skeleton
      for (const [name, d] of Object.entries(P)) {
        const e = this.spawnSolid({ key: style + '_' + name, label: label || 'Crash-test dummy' }, mat, [p[0] + d.at[0], p[1] + d.at[1], p[2] + d.at[2]], { size: 1, dims: d.half, T: 293, yaw: 0 });
        e.cb.quaternion.set(0, 0, 0, 1);
        e.cb.position.set(p[0] + d.at[0], p[1] + d.at[1], p[2] + d.at[2]);
        e.cb.angularDamping = 0.35; e.cb.linearDamping = 0.05;
        e.dummy = { id: dummy, part: name, style };
        e.name = label || 'Crash-test dummy';
        parts[name] = e;
      }
      this.linkDummy(parts);
      return parts.chest;
    }
    linkDummy(parts) {
      const C = this.C;
      for (const [a, b] of PC.DUMMY_JOINTS) {
        const A = parts[a], B = parts[b];
        if (!A || !B) continue;
        const human = true, P = PC.HUMAN_PARTS;
        // Joint at the real joint for the human, else midway between the two parts' rest positions.
        const pa = P[a].at, pb = P[b].at, mid = human && PC.HUMAN_PIVOTS[a + '|' + b] || [(pa[0] + pb[0]) / 2, (pa[1] + pb[1]) / 2, (pa[2] + pb[2]) / 2];
        const ca = new C.Vec3(mid[0] - pa[0], mid[1] - pa[1], mid[2] - pa[2]), cb = new C.Vec3(mid[0] - pb[0], mid[1] - pb[1], mid[2] - pb[2]);
        const c = new C.PointToPointConstraint(A.cb, ca, B.cb, cb, 400);
        c.collideConnected = false;
        this.world.addConstraint(c);
        (A.constraints || (A.constraints = [])).push(c); (B.constraints || (B.constraints = [])).push(c);
      }
    }

    // Containers & structures. Local origin at the outside bottom centre.
    buildContainer(def, p) {
      const C = this.C;
      const mat = PC.MAT[def.mat];
      const e = this.makeEntity(mat, { pinned: true }, def.label, { entryKey: def.key, container: def.key, arch: def.shape, def });
      if (def.shape === 'openbox' || def.shape === 'cup') e.bindId = this.nextBind = (this.nextBind || 0) + 1;
      const body = new C.Body({ mass: 0, type: C.Body.STATIC });
      const parts = [];
      const addBox = (ox, oy, oz, hx, hy, hz, q) => {
        const quat = q ? new C.Quaternion(q[0], q[1], q[2], q[3]) : undefined;
        body.addShape(new C.Box(new C.Vec3(hx, hy, hz)), new C.Vec3(ox, oy, oz), quat);
        return { type: 'box', off: [ox, oy, oz], q: q || [0, 0, 0, 1], hx, hy, hz };
      };
      let vol = 0;
      if (def.shape === 'openbox') {
        const { ix, iz, H, t } = def;
        const tc = Math.max(t, 0.04);
        // Floor collider extends down into the ground so small fast pieces can't tunnel through a thin glass bottom.
        const tf = Math.max(t, 0.08);
        addBox(0, t - tf / 2, 0, ix + t, tf / 2, iz + t);
        addBox(ix + tc / 2, H / 2, 0, tc / 2, H / 2, iz + tc);
        addBox(-ix - tc / 2, H / 2, 0, tc / 2, H / 2, iz + tc);
        addBox(0, H / 2, iz + tc / 2, ix + tc, H / 2, tc / 2);
        addBox(0, H / 2, -iz - tc / 2, ix + tc, H / 2, tc / 2);
        parts.push({ type: 'openbox', off: [0, 0, 0], q: [0, 0, 0, 1], ix, iz, H, t });
        vol = (2 * (ix + t)) * (2 * (iz + t)) * H - 4 * ix * iz * (H - t);
      } else if (def.shape === 'cup') {
        const { R, H, t } = def;
        const tc = Math.max(t, 0.03), n = 14;
        const tf = Math.max(t, 0.06);
        body.addShape(new C.Cylinder(R + t, R + t, tf, 16), new C.Vec3(0, t - tf / 2, 0));
        for (let k = 0; k < n; k++) {
          const a = (k / n) * Math.PI * 2, cr = R + tc / 2;
          const half = Math.sin(a / 2), q = new C.Quaternion(0, Math.sin(-a / 2), 0, Math.cos(-a / 2));
          void half;
          body.addShape(new C.Box(new C.Vec3(tc / 2, H / 2, (Math.PI * cr / n) * 1.05)), new C.Vec3(Math.cos(a) * cr, H / 2, Math.sin(a) * cr), q);
        }
        parts.push({ type: 'cup', off: [0, 0, 0], q: [0, 0, 0, 1], R, H, t });
        vol = Math.PI * ((R + t) * (R + t) - R * R) * H + Math.PI * R * R * t;
      } else if (def.shape === 'ramp') {
        const a = def.angle || 0.35, q = [Math.sin(a / 2) * 0, 0, Math.sin(a / 2), Math.cos(a / 2)];
        parts.push(addBox(0, def.hy + Math.sin(a) * def.hx, 0, def.hx, def.hy, def.hz, q));
        vol = 8 * def.hx * def.hy * def.hz;
      } else if (def.shape === 'table') {
        const { hx, hz, Ht } = def, top = 0.03, leg = 0.035;
        parts.push(addBox(0, Ht - top, 0, hx, top, hz));
        for (const sx of [-1, 1]) for (const sz of [-1, 1]) parts.push(addBox(sx * (hx - leg * 1.5), (Ht - top * 2) / 2, sz * (hz - leg * 1.5), leg, (Ht - top * 2) / 2, leg));
        vol = 8 * hx * top * hz + 4 * 8 * leg * leg * (Ht / 2);
      } else {
        parts.push(addBox(0, def.hy, 0, def.hx, def.hy, def.hz));
        vol = 8 * def.hx * def.hy * def.hz;
      }
      e.parts = parts;
      e.volume = e.baseVolume = vol;
      body.position.set(p[0], Math.max(0, p[1] < 0.3 ? 0 : p[1]), p[2]);
      body.quaternion.setFromEuler(0, 0, 0);
      e.cb = body;
      e.massKg = vol * mat.density * 1000;
      body.addEventListener('collide', (ev) => this.onCollide(e, ev));
      this.world.addBody(body);
      this.list.push(e);
      return e;
    }

    massOf(e) { return Math.max(0.01, e.volume * e.props.density * 1000 * e.props.massScale * (PC.MATS[e.mat].densitySolid ? PC.MATS[e.mat].densitySolid / PC.MATS[e.mat].density : 1)); }

    setPinned(e, pinned) {
      const C = this.C, b = e.cb;
      e.props.pinned = pinned;
      if (pinned) { b.type = C.Body.STATIC; b.mass = 0; b.velocity.setZero(); b.angularVelocity.setZero(); }
      else {
        b.type = C.Body.DYNAMIC;
        b.mass = e.container ? Math.max(1, (e.massKg || 10) * e.props.massScale) : this.massOf(e);
        b.wakeUp();
      }
      b.updateMassProperties();
    }

    remove(e) {
      if (e.deleted) return;
      e.deleted = true;
      if (this.mouse && this.mouse.entity === e) this.endGrab();
      if (e.constraints) for (const c of e.constraints) this.world.removeConstraint(c);
      this.world.removeBody(e.cb);
      this.list = this.list.filter((x) => x !== e);
      this.sim.emit({ type: 'bodyRemoved', entity: e });
    }

    // Uniformly rescale a (single-box) body after it dissolves, burns or is resized.
    rescale(e, volume, force) {
      if (e.container || e.deleted) return;
      e.volume = Math.max(1e-6, volume);
      const s = Math.cbrt(e.volume / e.baseVolume);
      if (!force && Math.abs(s - e.scale) < 0.02 && s > 0.05) return;
      e.scale = s;
      const d = e.baseDims.map((v) => v * s);
      e.dims = d;
      if (e.cluster) {
        e.cb.shapes.forEach((sh, k) => {
          const [ox, oy, oz, hx, hy, hz] = e.baseParts[k];
          sh.halfExtents.set(hx * s, hy * s, hz * s); sh.updateConvexPolyhedronRepresentation(); sh.updateBoundingSphereRadius();
          e.cb.shapeOffsets[k].set(ox * s, oy * s, oz * s);
          Object.assign(e.parts[k], { off: [ox * s, oy * s, oz * s], hx: hx * s, hy: hy * s, hz: hz * s });
        });
        e.cb.updateBoundingRadius();
        if (!e.props.pinned) { e.cb.mass = this.massOf(e); e.cb.updateMassProperties(); }
        e.cb.aabbNeedsUpdate = true;
        return;
      }
      const shape = e.cb.shapes[0];
      shape.halfExtents.set(d[0], d[1], d[2]);
      shape.updateConvexPolyhedronRepresentation();
      shape.updateBoundingSphereRadius();
      e.cb.updateBoundingRadius();
      if (!e.props.pinned) { e.cb.mass = this.massOf(e); e.cb.updateMassProperties(); }
      e.parts[0].hx = d[0]; e.parts[0].hy = d[1]; e.parts[0].hz = d[2];
      e.cb.aabbNeedsUpdate = true;
    }

    // ------------------------------------------------------------------ per-frame coupling
    preStep() {
      this.world.gravity.set(0, -9.81 * this.s.gravity, 0);
      this.updateMouse();
    }

    // External forces are cleared after every internal cannon step, so they are applied per fixed substep.
    applyForces(dt) {
      const sim = this.sim, g = 9.81 * this.s.gravity;
      const W = [0, 0, 0], p = [0, 0, 0];
      for (const e of this.list) {
        const b = e.cb;
        if (b.type !== this.C.Body.DYNAMIC) continue;
        if (e.props.gravity !== 1) b.applyForce(new this.C.Vec3(0, b.mass * g * (1 - e.props.gravity), 0));
        // Buoyancy + drag from the liquid surface map, sampled over the body's volume.
        const d = e.dims, samples = 3;
        const lvl = sim.surface.levelAround(b.position.x, b.position.z, Math.max(d[0], d[2]) * 1.6 + 0.15);
        if (lvl && lvl.top > b.position.y - Math.max(d[0], d[1], d[2]) * 1.8) {
          const dv = e.volume / (samples * samples * samples), rho = lvl.rho * 1000, slab = Math.max(d[0], d[1], d[2]) / samples;
          // A thin film can't float anything: buoyancy needs liquid at least as deep as the object is tall.
          const thin = Math.min(1, Math.max(0, (lvl.top - lvl.bottom) / (Math.max(d[0], d[1], d[2]) * 2)));
          let sub = 0;
          for (let a = 0; a < samples; a++) for (let c = 0; c < samples; c++) for (let k = 0; k < samples; k++) {
            const lx = ((a + 0.5) / samples * 2 - 1) * d[0], ly = ((c + 0.5) / samples * 2 - 1) * d[1], lz = ((k + 0.5) / samples * 2 - 1) * d[2];
            PC.qrot(b.quaternion.x, b.quaternion.y, b.quaternion.z, b.quaternion.w, lx, ly, lz, p);
            const wy = b.position.y + p[1];
            // Fraction of this sample slab below the surface (smooth, so floating bodies don't jitter).
            const frac = Math.min(1, Math.max(0, (lvl.top - wy) / (2 * slab) + 0.5));
            if (frac <= 0) continue;
            sub += frac;
            const rel = new this.C.Vec3(p[0], p[1], p[2]);
            const vp = b.velocity.clone().vadd(b.angularVelocity.cross(rel));
            // Viscous melts (lava, honey-like liquids) resist motion far more than water.
            let drag = rho * dv * 6 * (1 + (lvl.visc || 0) * (lvl.visc || 0) * 40);
            // Stable explicit drag: never remove more than ~80% of this sample's share of the body's momentum per
            // step (otherwise strong lava drag on a light plank overshoots and flings it into the air).
            const dragMax = 0.8 * b.mass / (samples * samples * samples * Math.max(dt, 1e-4));
            if (drag > dragMax) drag = dragMax;
            b.applyForce(new this.C.Vec3(-vp.x * drag * frac, (rho * dv * g * thin - vp.y * drag) * frac, -vp.z * drag * frac), rel);
          }
          const was = e.submerged || 0;
          e.submerged = sub / (samples * samples * samples);
          if (was === 0 && e.submerged > 0 && b.velocity.y < -0.8) this.sim.emit({ type: 'splash', x: b.position.x, y: b.position.y, z: b.position.z, v: -b.velocity.y, size: e.volume });
          if (sub) { b.angularVelocity.scale(1 - 0.8 * dt * e.submerged, b.angularVelocity); b.wakeUp(); }
        } else e.submerged = 0;
        // Wind drag on the exposed area.
        if (sim.wind.active) {
          sim.windAt(b.position.x, b.position.y, b.position.z, sim.time, W);
          const rx = W[0] - b.velocity.x, ry = W[1] * 0.2 - b.velocity.y, rz = W[2] - b.velocity.z, sp = Math.hypot(rx, ry, rz);
          if (sp > 0.5) {
            const A = 4 * (d[0] * d[1] + d[1] * d[2]) * 0.5, k = 0.5 * 1.2 * 1.05 * A * sp * (1 - (e.submerged || 0));
            b.applyForce(new this.C.Vec3(rx * k, ry * k, rz * k));
            if (sp > 2) b.wakeUp();
          }
        }
      }
    }

    // Reaction impulses from powder grains (accumulated by the particle solver) → body velocity.
    applyGrainImpulses() {
      const C = this.C;
      for (const e of this.list) {
        const J = e.pj;
        if (!J) continue;
        e.pj = null;
        const b = e.cb;
        if (b.type !== C.Body.DYNAMIC || !(b.mass > 0)) continue;
        // Never more than enough to stop the body and hold it against a few frames of gravity.
        const lim = b.mass * (Math.hypot(b.velocity.x, b.velocity.y, b.velocity.z) + 9.81 * this.s.gravity * (1 / 60) * 1.5);
        const L = Math.hypot(J[0], J[1], J[2]), k = (L > lim ? lim / L : 1) * 0.5;
        // Sand is a lossy, frictional bed: resting in it bleeds off motion instead of bouncing.
        b.velocity.scale(0.8, b.velocity); b.angularVelocity.scale(0.8, b.angularVelocity);
        b.velocity.x += J[0] * k / b.mass; b.velocity.y += J[1] * k / b.mass; b.velocity.z += J[2] * k / b.mass;
        const t = new C.Vec3(J[3] * k, J[4] * k, J[5] * k), w = new C.Vec3();
        b.invInertiaWorld.vmult(t, w);
        b.angularVelocity.x += w.x * 0.5; b.angularVelocity.y += w.y * 0.5; b.angularVelocity.z += w.z * 0.5;
      }
    }

    stepPhysics(dt) {
      if (dt <= 0) return;
      const n = Math.min(8, Math.max(1, Math.ceil(dt * 120 - 1e-6))), h = dt / n;
      for (let k = 0; k < n; k++) { this.applyForces(h); this.world.step(h); }
    }

    // Builds particle-engine colliders from bodies (world-space transforms of each part).
    colliders() {
      const out = [], q = [0, 0, 0], tmp = [0, 0, 0];
      for (const e of this.list) {
        const b = e.cb, bq = b.quaternion;
        e.contacts.length = 0;
        const dynamic = b.type === this.C.Body.DYNAMIC;
        for (const part of e.parts) {
          PC.qrot(bq.x, bq.y, bq.z, bq.w, part.off[0], part.off[1], part.off[2], tmp);
          // Compose quaternions: bq * part.q
          const [px, py, pz, pw] = part.q;
          const cq = [
            bq.w * px + bq.x * pw + bq.y * pz - bq.z * py,
            bq.w * py - bq.x * pz + bq.y * pw + bq.z * px,
            bq.w * pz + bq.x * py - bq.y * px + bq.z * pw,
            bq.w * pw - bq.x * px - bq.y * py - bq.z * pz,
          ];
          const col = {
            type: part.type, cx: b.position.x + tmp[0], cy: b.position.y + tmp[1], cz: b.position.z + tmp[2], q: cq,
            hx: part.hx, hy: part.hy, hz: part.hz, R: part.R, H: part.H, t: part.t, ix: part.ix, iz: part.iz,
            dynamic, fric: e.props.friction, body: e,
            vx: b.velocity.x, vy: b.velocity.y, vz: b.velocity.z, wx: b.angularVelocity.x, wy: b.angularVelocity.y, wz: b.angularVelocity.z,
          };
          if (part.type === 'box') col.bound = Math.hypot(part.hx, part.hy, part.hz);
          else if (part.type === 'openbox') { col.bound = Math.hypot(part.ix + 0.05, part.H, part.iz + 0.05); col.cy = col.cy; }
          else if (part.type === 'cup') col.bound = Math.hypot(part.R + 0.05, part.H);
          // Containers: bounding sphere centred on the part's middle height.
          if (part.type === 'openbox' || part.type === 'cup') {
            PC.qrot(cq[0], cq[1], cq[2], cq[3], 0, part.H / 2, 0, q);
            col.bcx = col.cx + q[0]; col.bcy = col.cy + q[1]; col.bcz = col.cz + q[2];
          }
          out.push(col);
        }
        void dynamic;
      }
      return out;
    }

    // After the particle step: heat exchange, surface chemistry, melting, burning, decay, fission.
    postStep(dt, fdt) {
      const f = this.sim.fluid, s = this.s;
      const Tamb = s.ambientT;
      for (const e of this.list.slice()) {
        if (e.deleted) continue;
        const m = PC.MATS[e.mat], b = e.cb;
        e.age += dt;
        const capJ = Math.max(1, (e.massKg || b.mass || this.massOf(e)) * 1000 * e.props.heatCap); // J/K
        // Heat exchange with touching particles (bounded to avoid overshoot).
        // Radiant heat from glowing material nearby (lava, flames, molten metal): Stefan–Boltzmann, falling off
        // with distance. This is what makes wood floating on lava burst into flames without touching it.
        if (!e.container) {
          const bp = b.position, R = Math.max(e.dims[0], e.dims[1], e.dims[2]) * 1.2 + f.sp * 3, T4b = e.T * e.T * e.T * e.T;
          let qr = 0, touchingHot = false;
          const near2 = Math.pow(Math.max(e.dims[0], e.dims[1], e.dims[2]) * 1.05 + f.sp * 1.2, 2);
          f.forEachNear(bp.x, bp.y, bp.z, R, (j, d2) => {
            const Tj = f.T[j];
            if (Tj < 700 || f.phase[j] === 0) return;
            const fall = 1 - Math.sqrt(d2) / R;
            qr += 5.67e-8 * 0.9 * (Tj * Tj * Tj * Tj - T4b) * f.sp * f.sp * fall * fall;
            if (Tj > 900 && d2 < near2) touchingHot = true;
          });
          if (qr > 0) e.T += Math.min(qr * dt * 6 * s.conduction / capJ, 60 * dt);
          // Surface ignition: a flammable object touching something glowing hot catches fire within about half a second,
          // long before the whole piece has warmed through.
          if (m.burn && !m.burn.explode && e.props.ignite > 0) {
            e.hotTouch = touchingHot ? (e.hotTouch || 0) + dt : 0;
            if (e.hotTouch > 0.5 && e.T < e.props.ignite) e.T = e.props.ignite + 5;
          }
        }
        const seen = new Set();
        let wetContacts = 0;
        const frozen = m.mp < 300 && e.T < e.props.mp;
        for (const i of e.contacts) {
          if (seen.has(i) || !f.alive[i]) continue;
          seen.add(i);
          const pc = f.gHeatCap[f.grp[i]] * f.kg(i) * 1000;
          // Convective contact h ≈ 3e4·k W/m²K over one particle's footprint (≈20× faster than reality for playability).
          const hA = Math.min(e.props.cond, f.gCond[f.grp[i]]) * 1.2e5 * s.conduction * f.sp * f.sp;
          const dT = (f.T[i] - e.T);
          let q = hA * dT * dt;
          const maxQ = Math.abs(dT) * pc * capJ / (pc + capJ) * 0.5;
          if (q > maxQ) q = maxQ; else if (q < -maxQ) q = -maxQ;
          e.T += q / capJ; f.T[i] -= q / pc;
          // Flames radiate: they heat what they lick far more than their tiny mass would suggest.
          const ho = f.matHeatOut[f.mat[i]];
          if (ho && e.T < 1250) e.T += ho * 4000 * s.conduction * dt * Math.pow(f.sp, 2) * 1e3 / capJ * 60;
          if (f.phase[i] === LIQUID && f.matIsWater[f.mat[i]]) wetContacts++;
          // A frozen liquid (ice, frozen oil…) is inert until it melts — ice on soil does not make mud.
          if (s.reactions && !(frozen && PC.MATS[f.mat[i]].id !== 'antimatter')) this.surfaceReaction(e, i, fdt);
          if (e.deleted) break;
        }
        if (e.deleted) continue;
        // Water douses a burning object: it cools fast and the water flashes to steam.
        if (wetContacts >= 2 && m.burn && e.T > Tamb + 20) {
          e.T = Math.max(Tamb, e.T - wetContacts * 25 * fdt);
          if (e.T < e.props.ignite && e.burning) { e.burning = false; this.sim.emit({ type: 'label', x: b.position.x, y: b.position.y + 0.2, z: b.position.z, text: 'Extinguished', color: '#9fd6ff' }); }
        }
        // Ambient + radiative cooling (surface/volume scaling: small things cool faster).
        const size = Math.cbrt(e.volume) || 0.1;
        e.T += (Tamb - e.T) * Math.min(1, 0.0006 * s.ambientExchange * fdt / size * 0.1);
        if (e.T > 900) e.T -= Math.min(e.T - Tamb, 3e-14 * Math.pow(e.T, 4) * fdt / Math.max(0.2, e.props.heatCap) / (size * 10));
        if (e.T < 0.1) e.T = 0.1;
        if (s.reactions && m.burn && e.T >= e.props.ignite && !(e.doused > this.sim.time)) { this.burnStep(e, m, dt); if (e.deleted) continue; }
        if (e.T >= e.props.mp && !m.life) { this.meltStep(e, m, capJ); if (e.deleted) continue; }
        if (!s.reactions) continue;
        if (m.radioactive && s.radioactivity) {
          const rate = (0.693 / (m.radioactive.halfLife * 60)) * s.decaySpeed * e.props.radioactivity * fdt;
          if (Math.random() < rate * 30) { this.sim.emit({ type: 'decay', x: b.position.x, y: b.position.y + e.dims[1], z: b.position.z, color: '#9dff7a' }); e.T += 2; }
          if (Math.random() < rate * 0.05) this.transmute(e, m.radioactive.into);
        }
        if (m.fissile && s.fission) this.checkCritical(e, m);
      }
    }

    // Body surface meets particle i: generic reaction table plus the alkali-metal special case.
    surfaceReaction(e, i, fdt) {
      const f = this.sim.fluid, NM = f.NM, table = f.reactionTable, me = e.mat, mp = f.mat[i];
      let r = table[me * NM + mp], bodyIsA = true;
      if (!r) return;
      if (r < 0) { bodyIsA = false; r = -r; }
      let rule = PC.REACTIONS[r - 1];
      if (rule.fusion) return;
      if (rule.minT && Math.max(e.T, f.T[i]) < rule.minT) { if (!rule.alt) return; rule = rule.alt; }
      if (rule.special === 'annihilate') {
        const kg = f.kg(i) * 2;
        this.sim.annihilate(f.x[i], f.y[i], f.z[i], kg);
        f.kill(i);
        this.rescale(e, e.volume - Math.pow(f.sp, 3));
        if (e.volume < e.baseVolume * 0.05) this.remove(e);
        return;
      }
      const pv = Math.pow(f.sp, 3);
      const x = f.x[i], y = f.y[i], z = f.z[i];
      if (rule.special === 'metalWater') {
        const el = PC.MATS[me].el;
        let rx = (el ? el.reactivity : 1) * e.props.reactivity;
        if (el && el.cat === 'alkaline' && e.T < 330) rx *= 0.15;
        if (Math.random() > 0.006 * rx * this.s.reactionSpeed * fdt) return;
        f.convert(i, 'H');
        f.T[i] = Math.max(f.T[i], 380 + 120 * rx);
        f.vy[i] += 0.8;
        if (Math.random() < 0.3) { const j = f.add(PC.matIndex(el && el.cat === 'alkali' ? 'lye' : 'slaked_lime'), x, y, z, 330, null); void j; }
        e.T += 25 * rx;
        this.rescale(e, e.volume - pv * 0.03 * rx);
        const mat = PC.MATS[me];
        if (mat.emit && rx >= 1.5 && Math.random() < 0.4) f.spawnFlame(x, y + 0.05, z, me);
        this.sim.emit({ type: 'flash', x, y, z, color: mat.emit || '#ffffff', size: 0.08 + 0.04 * rx });
        if (rx >= 2.5 && Math.random() < 0.08 * rx) this.sim.explode(x, y, z, 0.8 * rx * e.props.explosive, { color: mat.emit });
        e.cb.wakeUp();
        e.cb.applyImpulse(new this.C.Vec3((Math.random() - 0.5) * 0.3 * rx, 0.2 * rx, (Math.random() - 0.5) * 0.3 * rx));
        if (e.volume < e.baseVolume * 0.04) this.remove(e);
        return;
      }
      if (Math.random() > rule.rate * 0.5 * (e.props.reactivity + f.gReact[f.grp[i]]) * this.s.reactionSpeed * 0.5) return;
      const [pa, pb] = rule.intoIdx;
      const pBody = bodyIsA ? pa : pb, pPart = bodyIsA ? pb : pa;
      const heat = rule.heat || 0;
      // Particle side.
      if (pPart === -1) f.kill(i); else { if (pPart >= 0) f.convert(i, pPart); f.T[i] = Math.max(1, f.T[i] + (bodyIsA ? (rule.heatB != null ? rule.heatB : heat) : (rule.heatA != null ? rule.heatA : heat))); }
      // Body side: consumed material leaves as a product particle at the surface.
      if (pBody !== -2) {
        if (pBody >= 0) f.add(pBody, x + (Math.random() - 0.5) * 0.02, y + 0.02, z + (Math.random() - 0.5) * 0.02, e.T + heat, null);
        this.rescale(e, e.volume - pv * 0.5);
      }
      e.T += heat * 0.02;
      if (rule.flash) this.sim.emit({ type: 'flash', x, y, z, color: rule.flash, size: 0.12 });
      if (rule.explode) this.sim.explode(x, y, z, rule.explode * e.props.explosive, { color: rule.flash });
      if (rule.name && Math.random() < 0.03) this.sim.emit({ type: 'label', x, y: y + 0.15, z, text: rule.name, color: rule.flash || '#ffffff' });
      if (e.volume < e.baseVolume * 0.04) this.remove(e);
    }

    // Melting with latent heat: heat above the melting point is spent turning the surface into liquid,
    // so the body shrinks gradually (an ice cube melts from the outside in).
    meltStep(e, m, capJ) {
      const f = this.sim.fluid, b = e.cb;
      const latent = (m.id === 'water' ? 334 : m.metallic ? 230 : 300) * 1000; // J/kg
      e.meltJ = (e.meltJ || 0) + (e.T - e.props.mp) * capJ;
      e.T = e.props.mp;
      const rho = e.props.density * 1000, pv = Math.pow(f.sp, 3), pkg = pv * rho;
      const kgMelted = e.meltJ / latent;
      if (e.container || e.volume < pv * 6 || e.T > e.props.bp) { if (kgMelted > e.volume * rho * 0.3 || e.T > e.props.bp) this.melt(e); return; }
      const n = Math.floor(kgMelted / pkg);
      if (n < 1) return;
      e.meltJ -= n * pkg * latent;
      const target = m.meltInto ? PC.MAT[m.meltInto] : m;
      const d = e.dims, tmp = [0, 0, 0];
      for (let k = 0; k < Math.min(n, 40); k++) {
        // Drip from the lower surface.
        const lx = (Math.random() * 2 - 1) * d[0], lz = (Math.random() * 2 - 1) * d[2];
        PC.qrot(b.quaternion.x, b.quaternion.y, b.quaternion.z, b.quaternion.w, lx, -d[1] - f.r, lz, tmp);
        f.add(target.index, b.position.x + tmp[0], Math.max(f.r, b.position.y + tmp[1]), b.position.z + tmp[2], e.props.mp + 1, null, b.velocity.x, b.velocity.y, b.velocity.z);
      }
      this.rescale(e, e.volume - n * pv);
      if (e.volume < e.baseVolume * 0.05) this.melt(e);
    }

    // Melting: the body becomes a volume of hot liquid particles.
    melt(e) {
      const f = this.sim.fluid, m = PC.MATS[e.mat], b = e.cb;
      if (e.container && e.T < e.props.mp) return;
      const pts = this.volumePoints(e, 3500);
      const target = m.meltInto ? PC.MAT[m.meltInto] : m;
      const g = f.createGroup(target, target === m ? Object.assign({}, e.props, { pinned: false }) : null, target === m ? PC.phaseName(m, LIQUID) : target.name);
      for (const [x, y, z] of pts) {
        const i = f.add(target.index, x, y, z, e.T, g, b.velocity.x, b.velocity.y, b.velocity.z);
        if (i < 0) break;
      }
      this.sim.emit({ type: 'label', x: b.position.x, y: b.position.y + 0.2, z: b.position.z, text: `${e.name} melted`, color: '#ffb36b' });
      this.remove(e);
    }

    // Converts a body into particles of a material (used for melting, shattering into rubble, ash).
    volumePoints(e, cap) {
      const f = this.sim.fluid, b = e.cb, sp = f.sp, out = [], tmp = [0, 0, 0];
      for (const part of e.parts) {
        let pts = [];
        if (part.type === 'box') {
          const nx = Math.max(1, Math.round(part.hx * 2 / sp)), ny = Math.max(1, Math.round(part.hy * 2 / sp)), nz = Math.max(1, Math.round(part.hz * 2 / sp));
          for (let a = 0; a < nx; a++) for (let c = 0; c < ny; c++) for (let k = 0; k < nz; k++) pts.push([((a + 0.5) / nx * 2 - 1) * part.hx, ((c + 0.5) / ny * 2 - 1) * part.hy, ((k + 0.5) / nz * 2 - 1) * part.hz]);
          if (!pts.length) pts.push([0, 0, 0]);
          pts = pts.map(([x, y, z]) => { PC.qrot(part.q[0], part.q[1], part.q[2], part.q[3], x, y, z, tmp); return [tmp[0] + part.off[0], tmp[1] + part.off[1], tmp[2] + part.off[2]]; });
        } else if (part.type === 'openbox') {
          const { ix, iz, H, t } = part, tt = Math.max(t, sp);
          for (let x = -ix - tt; x <= ix + tt; x += sp) for (let z = -iz - tt; z <= iz + tt; z += sp) pts.push([x, tt / 2, z]);
          for (let y = tt; y < H; y += sp) {
            for (let x = -ix; x <= ix; x += sp) { pts.push([x, y, iz + tt / 2]); pts.push([x, y, -iz - tt / 2]); }
            for (let z = -iz; z <= iz; z += sp) { pts.push([ix + tt / 2, y, z]); pts.push([-ix - tt / 2, y, z]); }
          }
        } else if (part.type === 'cup') {
          const { R, H } = part;
          for (let y = sp / 2; y < H; y += sp) { const n = Math.max(6, Math.round(2 * Math.PI * R / sp)); for (let k = 0; k < n; k++) { const a = k / n * Math.PI * 2; pts.push([Math.cos(a) * (R + sp / 2), y, Math.sin(a) * (R + sp / 2)]); } }
          for (let x = -R; x <= R; x += sp) for (let z = -R; z <= R; z += sp) if (x * x + z * z <= R * R) pts.push([x, sp / 2, z]);
        }
        for (const p of pts) {
          PC.qrot(b.quaternion.x, b.quaternion.y, b.quaternion.z, b.quaternion.w, p[0], p[1], p[2], tmp);
          out.push([b.position.x + tmp[0], Math.max(f.r, b.position.y + tmp[1]), b.position.z + tmp[2]]);
        }
      }
      if (out.length > cap) { out.sort(() => Math.random() - 0.5); out.length = cap; }
      return out;
    }

    burnStep(e, m, dt) {
      const f = this.sim.fluid, b = e.cb, burn = m.burn;
      if (burn.explode) { this.detonate(e); return; }
      const d = e.dims, tmp = [0, 0, 0];
      const flames = Math.ceil(4 + e.volume * 25000 * dt);
      for (let k = 0; k < flames; k++) {
        if (Math.random() > burn.flame * 1.5) continue;
        const lx = (Math.random() * 2 - 1) * d[0], lz = (Math.random() * 2 - 1) * d[2];
        PC.qrot(b.quaternion.x, b.quaternion.y, b.quaternion.z, b.quaternion.w, lx, d[1], lz, tmp);
        f.spawnFlame(b.position.x + tmp[0], b.position.y + Math.abs(tmp[1]) + 0.02, b.position.z + tmp[2], m.emit ? m.index : -1);
      }
      if (m.id === 'wood') this.sim.achieve('burnwood');
      // Burning wood sits at flame temperature (≈1100–1300 K); it chars and is consumed in ~15 s.
      e.burning = true;
      e.T = Math.min(1300, Math.max(e.T, e.props.ignite + 150));
      e.burnt = Math.min(1, e.burnt + burn.rate * dt * 9);
      this.rescale(e, e.volume * (1 - burn.rate * dt * 10));
      if (e.volume < e.baseVolume * 0.25) {
        const into = burn.into.filter((p) => p !== 'fire');
        e.burning = false;
        const pts = this.volumePoints(e, 400);
        for (const [x, y, z] of pts) f.add(PC.matIndex(into[(Math.random() * into.length) | 0] || 'ash'), x, y, z, e.T * 0.8, null);
        this.remove(e);
      }
    }

    detonate(e) {
      const m = PC.MATS[e.mat], b = e.cb;
      this.sim.achieve('detonate');
      const kg = b.mass || this.massOf(e);
      const P = Math.min(160, (m.burn ? m.burn.explode : 3) * 5 * Math.pow(kg, 0.6) * e.props.explosive);
      const pos = b.position;
      this.remove(e);
      this.sim.explode(pos.x, pos.y, pos.z, P, { color: m.burn && m.burn.flash });
    }

    transmute(e, id) {
      const m = PC.MAT[id];
      if (!m) return;
      e.mat = m.index;
      e.name = m.name;
      e.props.color = m.color;
      this.sim.emit({ type: 'label', x: e.cb.position.x, y: e.cb.position.y + 0.2, z: e.cb.position.z, text: `→ ${m.name}`, color: '#9dff7a' });
      this.sim.discover(m.index, SOLID, e.cb.position.x, e.cb.position.y, e.cb.position.z);
    }

    checkCritical(e, m) {
      let kg = e.cb.mass || this.massOf(e);
      const others = [];
      for (const o of this.list) {
        if (o === e || o.deleted || o.mat !== e.mat) continue;
        const d = o.cb.position.distanceTo(e.cb.position);
        if (d < Math.max(...e.dims) + Math.max(...o.dims) + 0.08) { kg += o.cb.mass || this.massOf(o); others.push(o); }
      }
      if (kg < m.fissile.criticalKg / Math.max(0.05, e.props.radioactivity)) return;
      const p = e.cb.position.clone();
      const f = this.sim.fluid;
      for (const o of [e, ...others]) {
        for (const [x, y, z] of this.volumePoints(o, 120)) f.add(PC.matIndex(Math.random() < 0.5 ? 'Ba' : 'Kr'), x, y, z, 3e4, null);
        this.remove(o);
      }
      this.sim.emit({ type: 'label', x: p.x, y: p.y + 0.5, z: p.z, text: 'Supercritical!', color: '#b6ff8a' });
      this.sim.explode(p.x, p.y, p.z, Math.min(400, 60 + kg * 2), { nuclear: true, color: '#e8ffd0' });
    }

    onCollide(e, ev) {
      if (e.deleted) return;
      const m = PC.MATS[e.mat];
      const v = Math.abs(ev.contact.getImpactVelocityAlongNormal());
      if (m.shock && v > m.shock * 0.5 && e.age > 0.3 && this.s.reactions) { setTimeout(() => !e.deleted && this.detonate(e), 0); return; }
      // Sound for any noticeable knock (throttled per object).
      const now = this.sim.time;
      // Deep-frozen soft things (fruit, rubber, wood…) turn brittle and shatter on a hard knock.
      if (e.T < 150 && v > 3.5 && !e.container && !e.cluster && !e.dummy && (m.burn || PC.CUSTOM && PC.CUSTOM[e.entryKey]) && e.age > 0.3) { setTimeout(() => { if (!e.deleted) { this.sim.emit({ type: 'shatter', mat: 'glass', x: e.cb.position.x, y: e.cb.position.y, z: e.cb.position.z }); this.fracture(e, { x: e.cb.position.x, y: e.cb.position.y, z: e.cb.position.z }, 20); } }, 0); return; }
      if (v > 0.6 && now - (e.lastKnock || 0) > 0.08) { e.lastKnock = now; this.sim.emit({ type: 'impact', entity: e, mat: m.id, v, x: e.cb.position.x, y: e.cb.position.y, z: e.cb.position.z }); }
    }

    // Explosion hits bodies: impulse, heat, fracture, shattering glass containers.
    blast(ex, R, P) {
      const C = this.C;
      for (const e of this.list.slice()) {
        if (e.deleted) continue;
        const b = e.cb;
        const dx = b.position.x - ex.x, dy = b.position.y - ex.y, dz = b.position.z - ex.z;
        const d = Math.hypot(dx, dy, dz) || 0.01, reach = R + (e.dims ? Math.max(...e.dims) : 0.5);
        if (d > reach) continue;
        const fall = Math.max(0, 1 - d / reach), m = PC.MATS[e.mat];
        e.T += P * 25 * fall * (ex.nuclear ? 20 : 1);
        if (m.tags.has('static')) continue;
        if (e.container) {
          if (P * fall > (m.id === 'glass' ? 6 : 60)) this.shatter(e, ex, P * fall);
          continue;
        }
        if (m.burn && m.burn.explode && P * fall > 2) { setTimeout(() => !e.deleted && this.detonate(e), 30); continue; }
        const brittle = !m.metallic && e.props.strength < 0.55;
        if (brittle && P * fall > e.props.strength * 60 && e.volume > 2e-4) { this.fracture(e, ex, P * fall); continue; }
        const J = Math.min(80, P * 2.2 * fall) * Math.sqrt(Math.max(0.1, b.mass || 1));
        const n = new C.Vec3(dx / d, dy / d + 0.35, dz / d);
        const off = new C.Vec3((Math.random() - 0.5) * 0.05, (Math.random() - 0.5) * 0.05, (Math.random() - 0.5) * 0.05);
        b.wakeUp();
        if (b.type === C.Body.DYNAMIC) b.applyImpulse(n.scale(J), off);
      }
    }

    // Split a brittle box into eight pieces (or rubble particles when already small).
    fracture(e, ex, energy) {
      const b = e.cb, d = e.dims, m = PC.MATS[e.mat];
      const pos = b.position.clone(), vel = b.velocity.clone(), q = b.quaternion;
      this.remove(e);
      if (d[0] < 0.04 && d[1] < 0.04) {
        const f = this.sim.fluid;
        for (const [x, y, z] of this.volumePoints(e, 60)) f.add(m.index, x, y, z, e.T, null, (x - ex.x) * 4, 2, (z - ex.z) * 4);
        return;
      }
      const tmp = [0, 0, 0];
      for (let a = -1; a <= 1; a += 2) for (let c = -1; c <= 1; c += 2) for (let k = -1; k <= 1; k += 2) {
        PC.qrot(q.x, q.y, q.z, q.w, a * d[0] / 2, c * d[1] / 2, k * d[2] / 2, tmp);
        const p = [pos.x + tmp[0], pos.y + tmp[1], pos.z + tmp[2]];
        const entry = { key: e.entryKey, label: e.name };
        const unit = archetype(m, e.entryKey).dims[0];
        const piece = this.spawnSolid(entry, m, p, { size: (d[0] / unit) * 0.5 * (0.85 + Math.random() * 0.25), T: e.T, props: Object.assign({}, e.props) });
        const dir = [p[0] - ex.x, p[1] - ex.y, p[2] - ex.z], L = Math.hypot(...dir) || 1;
        const sp = Math.min(12, 1 + energy * 0.15);
        piece.cb.velocity.set(vel.x + dir[0] / L * sp, vel.y + dir[1] / L * sp + 1.5, vel.z + dir[2] / L * sp);
        piece.cb.angularVelocity.set((Math.random() - 0.5) * 12, (Math.random() - 0.5) * 12, (Math.random() - 0.5) * 12);
      }
      this.sim.emit({ type: 'sparks', x: pos.x, y: pos.y, z: pos.z, color: '#d8d2c8', n: 10 });
    }

    shatter(e, ex, energy) {
      const f = this.sim.fluid, m = PC.MATS[e.mat];
      this.sim.emit({ type: 'shatter', mat: m.id, x: e.cb.position.x, y: e.cb.position.y, z: e.cb.position.z, size: e.volume || 0.001 });
      const pts = this.volumePoints(e, 900);
      const g = f.createGroup(m, { pinned: false }, `${e.name} shards`);
      for (const [x, y, z] of pts) {
        const dx = x - ex.x, dy = y - ex.y, dz = z - ex.z, L = Math.hypot(dx, dy, dz) || 1, sp = Math.min(10, energy * 0.3 / (L + 0.3));
        f.add(m.index, x, y, z, e.T, g, dx / L * sp, dy / L * sp + 1, dz / L * sp);
      }
      this.sim.emit({ type: 'label', x: e.cb.position.x, y: e.cb.position.y + 0.4, z: e.cb.position.z, text: 'Shattered!', color: '#bfe7f2' });
      this.remove(e);
    }

    // ------------------------------------------------------------------ grabbing
    startGrab(e, point) {
      const C = this.C, b = e.cb;
      this.endGrab();
      const local = b.pointToLocalFrame(new C.Vec3(point[0], point[1], point[2]));
      if (b.type !== C.Body.DYNAMIC) { this.mouse = { entity: e, kinematic: true, off: [b.position.x - point[0], b.position.y - point[1], b.position.z - point[2]], target: point.slice() }; return; }
      const mb = new C.Body({ mass: 0, type: C.Body.KINEMATIC });
      mb.position.set(point[0], point[1], point[2]);
      mb.collisionFilterGroup = 0; mb.collisionFilterMask = 0;
      this.world.addBody(mb);
      const cons = new C.PointToPointConstraint(b, local, mb, new C.Vec3(0, 0, 0), Math.max(50, b.mass * 60));
      this.world.addConstraint(cons);
      b.wakeUp();
      b.angularDamping = 0.6;
      this.mouse = { entity: e, body: mb, cons, target: point.slice() };
    }
    moveGrab(point) { if (this.mouse) this.mouse.target = point.slice(); }
    updateMouse() {
      const m = this.mouse;
      if (!m) return;
      if (m.entity.deleted) { this.endGrab(); return; }
      if (m.kinematic) {
        const b = m.entity.cb;
        b.position.set(m.target[0] + m.off[0], Math.max(0, m.target[1] + m.off[1]), m.target[2] + m.off[2]);
        b.aabbNeedsUpdate = true;
        return;
      }
      m.body.position.set(m.target[0], Math.max(0.02, m.target[1]), m.target[2]);
    }
    endGrab() {
      const m = this.mouse;
      if (!m) return;
      if (m.cons) { this.world.removeConstraint(m.cons); this.world.removeBody(m.body); m.entity.cb.angularDamping = 0.05; }
      this.mouse = null;
    }

    clear() {
      this.endGrab();
      for (const e of this.list.slice()) this.remove(e);
    }
  }

  PC.Bodies = Bodies;
})(window.PC);
