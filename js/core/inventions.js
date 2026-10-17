// Inventions: nothing assembles itself. When the right ingredients are together in the workspace (within
// ~50 cm, or in the same container) the user can choose to build the device from them, which consumes them.
(function (PC) {
  'use strict';

  // recipe: list of ingredient slots; each slot accepts any of the listed material ids.
  PC.INVENTIONS = [
    { key: 'battery', label: 'Battery', recipe: [['Zn'], ['Cu', 'coil'], ['acid', 'brine', 'lye']], dims: [0.05, 0.08, 0.05], desc: 'A voltaic cell: zinc and copper in an electrolyte. Powers anything it touches directly or through metal; dipped in water or brine it splits them by electrolysis.', hint: 'Two different metals in an electrolyte…' },
    { key: 'bulb', label: 'Light Bulb', recipe: [['glass'], ['W']], dims: [0.04, 0.07, 0.04], desc: 'A tungsten filament in a glass bulb. Glows when it touches a battery or sunlit solar panel, directly or through a chain of metal.', hint: 'A filament that survives white heat, inside glass…' },
    { key: 'neon', label: 'Neon Sign', recipe: [['glass'], ['Ne', 'Ar', 'Kr', 'Xe', 'He', 'Rn']], dims: [0.16, 0.03, 0.03], desc: 'A glass tube of noble gas glowing in its emission colour.', hint: 'Noble gas sealed in glass…' },
    { key: 'magnet', label: 'Magnet', recipe: [['Fe', 'steel'], ['Nd']], dims: [0.06, 0.05, 0.03], desc: 'A neodymium–iron magnet: pulls iron, nickel, cobalt and steel towards it.', hint: 'Iron and a rare-earth metal…' },
    { key: 'rocket', label: 'Rocket', recipe: [['steel', 'Al', 'Ti'], ['gunpowder', 'methane']], dims: [0.035, 0.16, 0.035], desc: 'Heat it or press Launch: it burns its propellant and flies.', hint: 'A light metal shell and something that burns fast…' },
    { key: 'firework', label: 'Firework', recipe: [['gunpowder'], ['Sr', 'Cu', 'Ba', 'Na', 'Li', 'K', 'Ca']], dims: [0.025, 0.1, 0.025], desc: 'Launches and bursts into sparks coloured by its metal salt (Sr red, Cu green, Ba lime, Na yellow, K violet).', hint: 'Black powder and a flame-test metal…' },
    { key: 'campfire', label: 'Campfire', recipe: [['wood'], ['stone']], dims: [0.22, 0.06, 0.22], desc: 'Logs stacked inside a ring of stones. It is laid unlit: light it with fire or heat, it burns for about 4 minutes, and water puts it out.', hint: 'Fuel and a ring of rock…' },
    { key: 'solar', label: 'Solar Panel', recipe: [['Si'], ['glass'], ['Al']], dims: [0.2, 0.02, 0.14], desc: 'Silicon cells under glass in an aluminium frame. Powers bulbs in daylight.', hint: 'Semiconductor, glass and a light metal frame…' },
    { key: 'thermometer', label: 'Thermometer', recipe: [['glass'], ['Hg']], dims: [0.015, 0.1, 0.015], desc: 'Mercury in glass. Shows the temperature of whatever surrounds it.', hint: 'A liquid metal in a thin glass tube…' },
  ];
  // Body material for each device (chosen so the generic burn/melt code leaves it alone).
  PC.INVENTION_MAT = { battery: 'Zn', bulb: 'glass', neon: 'glass', magnet: 'Nd', rocket: 'steel', firework: 'steel', campfire: 'stone', solar: 'Si', thermometer: 'glass' };
  PC.INVENTION = {};
  for (const inv of PC.INVENTIONS) PC.INVENTION[inv.key] = inv;
  const FLAME = { Sr: '#ff1c3c', Cu: '#3cff9c', Ba: '#b8ff4a', Na: '#ffb000', Li: '#ff2a4b', K: '#c38bff', Ca: '#ff7a30' };

  class Inventions {
    constructor(sim) { this.sim = sim; this.timer = 0; }
    isDiscovered(key) { return this.sim.discovered.has('inv:' + key); }

    // Ingredient presence: bodies and particle groups near each other.
    scan() {
      const sim = this.sim, f = sim.fluid, items = [];
      for (const e of sim.bodies.list) if (!e.container && !e.invention) items.push({ id: PC.MATS[e.mat].id, x: e.cb.position.x, y: e.cb.position.y, z: e.cb.position.z, body: e });
      for (const e of sim.bodies.list) if (e.container && e.def && PC.MATS[e.mat].id === 'glass') items.push({ id: 'glass', x: e.cb.position.x, y: e.cb.position.y, z: e.cb.position.z, body: e, isContainer: true });
      const seen = new Map();
      for (let k = 0; k < f.nAct; k += 3) {
        const i = f.act[k];
        if (!f.alive[i]) continue;
        const id = PC.MATS[f.mat[i]].id, key = id + '|' + Math.round(f.x[i] / 0.4) + '|' + Math.round(f.z[i] / 0.4);
        if (!seen.has(key)) { seen.set(key, true); items.push({ id, x: f.x[i], y: f.y[i], z: f.z[i], particles: true, mi: f.mat[i] }); }
      }
      return items;
    }

    // The ingredients for an invention if they are all present close together, else null.
    find(key, items) {
      items = items || this.scan();
      const inv = PC.INVENTION[key];
      {
        for (const anchor of items) {
          if (!inv.recipe[0].includes(anchor.id)) continue;
          const used = [anchor];
          let ok = true;
          for (let s = 1; s < inv.recipe.length && ok; s++) {
            const m = items.find((it) => !used.includes(it) && inv.recipe[s].includes(it.id) && Math.hypot(it.x - anchor.x, it.z - anchor.z) < 0.6 && Math.abs(it.y - anchor.y) < 0.6);
            if (m) used.push(m); else ok = false;
          }
          if (ok) return used;
        }
      }
      return null;
    }
    // Which inventions can be built right now.
    buildable() {
      const items = this.scan(), out = {};
      for (const inv of PC.INVENTIONS) out[inv.key] = !!this.find(inv.key, items);
      return out;
    }
    build(key) {
      const used = this.find(key);
      if (!used) return null;
      return this.assemble(PC.INVENTION[key], used);
    }

    assemble(inv, used) {
      const sim = this.sim, f = sim.fluid;
      let cx = 0, cy = 0, cz = 0;
      for (const u of used) { cx += u.x; cy += u.y; cz += u.z; }
      cx /= used.length; cy /= used.length; cz /= used.length;
      const extra = {};
      for (const u of used) {
        if (inv.key === 'firework' && FLAME[u.id]) extra.color = FLAME[u.id];
        if (inv.key === 'neon') { const m = PC.MAT[u.id]; if (m && m.emit) extra.color = m.emit; }
        if (u.body && !u.isContainer) sim.bodies.remove(u.body);
        if (u.particles) f.forEachNear(u.x, u.y, u.z, 0.45, (j) => { if (f.mat[j] === u.mi) f.kill(j); });
      }
      const e = this.spawn(inv.key, [cx, Math.max(cy, 0) + 0.15, cz], extra);
      sim.achieve('invent');
      const first = !sim.discovered.has('inv:' + inv.key);
      sim.discovered.add('inv:' + inv.key);
      sim.emit({ type: 'invention', inv, entity: e, first, x: cx, y: cy + 0.3, z: cz });
      sim.emit({ type: 'flash', x: cx, y: cy + 0.1, z: cz, color: '#ffe38a', size: 0.4 });
      return e;
    }

    spawn(key, p, extra) {
      const inv = PC.INVENTION[key], B = this.sim.bodies;
      const mat = PC.MAT[PC.INVENTION_MAT[key]];
      const e = B.spawnSolid({ key: 'inv_' + key, label: inv.label }, mat, p, { size: 1, T: 293, yaw: 0, dims: inv.dims, invention: key });
      e.invention = key;
      e.inv = Object.assign({ fuel: key === 'rocket' ? 3.5 : key === 'firework' ? 1.4 : key === 'campfire' ? 240 : 0, lit: false, launched: false, color: '#ffffff' }, extra || {});
      e.cb.quaternion.setFromEuler(0, 0, 0);
      // Rockets and fireworks stand upright on their launch stick until they fly.
      if (key === 'rocket' || key === 'firework') e.cb.angularFactor.set(0, 1, 0);
      if (key === 'campfire') inv.fuel = 0;
      return e;
    }

    // Set of bodies connected to a power source through touching conductors.
    circuit(sources) {
      const B = this.sim.bodies, out = new Set();
      if (!sources.length) return out;
      const conducts = (e) => {
        if (e.invention) return true;
        const m = PC.MATS[e.mat];
        return !!(m.metallic || (m.el && m.el.metal) || m.id === 'C' || m.id === 'graphite' || m.id === 'steel');
      };
      const cand = B.list.filter((e) => !e.deleted && !e.container);
      for (const e of cand) e.cb.updateAABB();
      const touch = (a, b) => {
        const A = a.cb.aabb, Bb = b.cb.aabb, g = 0.012;
        return A.lowerBound.x - g <= Bb.upperBound.x && Bb.lowerBound.x - g <= A.upperBound.x && A.lowerBound.y - g <= Bb.upperBound.y && Bb.lowerBound.y - g <= A.upperBound.y && A.lowerBound.z - g <= Bb.upperBound.z && Bb.lowerBound.z - g <= A.upperBound.z;
      };
      const stack = sources.slice();
      for (const s of sources) out.add(s);
      while (stack.length) {
        const a = stack.pop();
        for (const b of cand) {
          if (out.has(b) || !touch(a, b)) continue;
          out.add(b);
          if (conducts(b)) stack.push(b); // a bulb or other device gets current but non-conductors don't pass it on
        }
      }
      return out;
    }

    // A powered battery standing in a liquid splits it: water → H₂ + O₂, brine → H₂ + Cl₂ (leaving lye), acid → H₂ + Cl₂.
    electrolysis(e, dt) {
      const f = this.sim.fluid, p = e.cb.position, R = Math.max(e.dims[0], e.dims[1], e.dims[2]) + f.sp * 1.5;
      const near = [];
      f.forEachNear(p.x, p.y, p.z, R, (j) => { if (f.phase[j] === 2) near.push(j); });
      if (!near.length) return;
      let electrolyte = 0;
      for (const j of near) { const id = PC.MATS[f.mat[j]].id; if (id === 'brine' || id === 'acid' || id === 'lye' || id === 'vinegar') electrolyte++; }
      const rate = (electrolyte / near.length > 0.2 ? 4 : 0.35) * dt; // pure water barely conducts
      let n = Math.floor(rate) + (Math.random() < rate % 1 ? 1 : 0);
      while (n-- > 0) {
        const j = near[(Math.random() * near.length) | 0];
        if (!f.alive[j]) continue;
        const id = PC.MATS[f.mat[j]].id;
        let into;
        if (id === 'water') into = Math.random() < 2 / 3 ? 'H' : 'O';
        else if (id === 'brine') into = Math.random() < 0.5 ? 'H' : Math.random() < 0.5 ? 'Cl' : 'lye';
        else if (id === 'acid') into = Math.random() < 0.5 ? 'H' : 'Cl';
        else if (id === 'lye' || id === 'vinegar') into = Math.random() < 2 / 3 ? 'H' : 'O';
        else continue;
        f.convert(j, into);
        this.sim.achieve('electrolysis');
        f.T[j] = Math.max(f.T[j], 300);
        if (into !== 'lye') f.vy[j] += 0.4;
      }
      if (Math.random() < dt * 3) this.sim.emit({ type: 'sparks', x: p.x, y: p.y + e.dims[1], z: p.z, color: '#9fd6ff', n: 1 });
    }

    update(dt) {
      const sim = this.sim, f = sim.fluid, B = sim.bodies, C = B.C;
      const list = B.list.filter((e) => e.invention && !e.deleted);
      if (!list.length) return;
      // Electric circuits: current flows through objects that touch, if they conduct (metals, graphite, devices).
      const sources = list.filter((e) => e.invention === 'battery' || (e.invention === 'solar' && e.inv.lit));
      const reach = this.circuit(sources);
      const sunlit = this.sim.s.environment !== 'studio' && (this.sim.s.timeOfDay > 6.5 && this.sim.s.timeOfDay < 18.5) && this.sim.s.cloudCover < 0.9;
      for (const e of list) {
        const b = e.cb, p = b.position, inv = e.inv;
        switch (e.invention) {
          case 'solar': inv.lit = sunlit; break;
          case 'battery': inv.lit = true; this.electrolysis(e, dt); break;
          case 'bulb': inv.lit = reach.has(e); if (inv.lit) sim.achieve('bulb'); if (inv.lit) e.T = Math.min(420, e.T + dt * 20); break;
          case 'neon': inv.lit = true; break;
          case 'thermometer': {
            let sum = 0, n = 0;
            f.forEachNear(p.x, p.y, p.z, 0.35, (j) => { sum += f.T[j]; n++; });
            inv.reading = n ? sum / n : sim.s.ambientT;
            e.T += (inv.reading - e.T) * Math.min(1, dt * 2);
            break;
          }
          case 'magnet':
            for (const o of B.list) {
              if (o === e || o.deleted || o.container || o.cb.type !== C.Body.DYNAMIC) continue;
              const id = PC.MATS[o.mat].id;
              if (!['Fe', 'Ni', 'Co', 'steel', 'Nd', 'Gd'].includes(id) && o.invention !== 'magnet') continue;
              const d = o.cb.position.vsub(p), L = d.length();
              if (L > 1.2 || L < 0.02) continue;
              const F = Math.min(60, 1.2 / (L * L)) * o.cb.mass * 0.4;
              o.cb.applyForce(d.scale(-F / L));
              o.cb.wakeUp();
            }
            break;
          case 'campfire': {
            // Laid but unlit until a flame or enough heat reaches the logs; burns its wood down; water douses it.
            let wet = 0, flame = false;
            f.forEachNear(p.x, p.y, p.z, Math.max(e.dims[0], e.dims[2]) * 1.1, (j) => {
              const id = PC.MATS[f.mat[j]].id;
              if (f.phase[j] === 2 && f.matIsWater[f.mat[j]]) wet++;
              else if (id === 'fire' || f.T[j] > 700) flame = true;
            });
            if (!inv.lit && inv.fuel > 0 && (flame || e.T > 600)) { inv.lit = true; sim.emit({ type: 'label', x: p.x, y: p.y + 0.3, z: p.z, text: 'Campfire lit', color: '#ffb36b' }); }
            if (inv.lit && wet > 6) { inv.lit = false; e.T = Math.min(e.T, 340); sim.emit({ type: 'label', x: p.x, y: p.y + 0.3, z: p.z, text: 'Doused', color: '#9fd6ff' }); for (let k = 0; k < 20; k++) f.add(f.SMOKE, p.x + (Math.random() - 0.5) * 0.2, p.y + 0.08, p.z + (Math.random() - 0.5) * 0.2, 380, null, 0, 0.8, 0); }
            if (inv.lit) {
              inv.fuel -= dt;
              const k = Math.min(1, inv.fuel / 30);
              if (Math.random() < 0.7 * k) f.spawnFlame(p.x + (Math.random() - 0.5) * 0.16, p.y + 0.06, p.z + (Math.random() - 0.5) * 0.16, -1);
              f.forEachNear(p.x, p.y + 0.3, p.z, 0.6, (j, d2) => { f.T[j] += (1 - Math.sqrt(d2) / 0.6) * 6 * k * dt * 60; });
              e.T = Math.max(e.T, 600 + 300 * k);
              if (inv.fuel <= 0) { inv.lit = false; inv.burntOut = true; e.burnt = 1; sim.emit({ type: 'label', x: p.x, y: p.y + 0.3, z: p.z, text: 'Burnt out', color: '#aaa' }); }
            }
            break;
          }
          case 'rocket': case 'firework':
            if (!inv.launched && (e.T > 600 || inv.launch)) { inv.launched = true; sim.emit({ type: 'label', x: p.x, y: p.y + 0.3, z: p.z, text: 'Ignition!', color: '#ffcf70' }); }
            if (inv.launched && inv.fuel > 0) {
              inv.fuel -= dt;
              const up = new C.Vec3(0, 1, 0); b.quaternion.vmult(up, up);
              const thrust = b.mass * 9.81 * (e.invention === 'rocket' ? 3.2 : 4.5);
              b.angularFactor.set(0.2, 1, 0.2);
              b.applyForce(up.scale(thrust));
              b.wakeUp();
              const ex = p.vsub(up.scale(e.dims[1] * 1.1));
              for (let k = 0; k < 2; k++) {
                const id = f.spawnFlame(ex.x, ex.y, ex.z, -1);
                if (id >= 0) { f.vx[id] = -up.x * 6 + (Math.random() - 0.5); f.vy[id] = -up.y * 6; f.vz[id] = -up.z * 6 + (Math.random() - 0.5); f.T[id] = 1800; }
              }
              if (Math.random() < 0.6) f.add(f.SMOKE, ex.x, ex.y, ex.z, 600, null, -up.x * 2, -up.y * 2, -up.z * 2);
              if (inv.fuel <= 0 && e.invention === 'firework') {
                sim.emit({ type: 'firework', x: p.x, y: p.y, z: p.z, color: inv.color || '#ffd27a' });
                if (p.y < 2) sim.explode(p.x, p.y, p.z, 0.6, { color: inv.color }); // only a low burst can hurt anything
                B.remove(e);
              }
            }
            break;
        }
      }
    }
  }

  PC.Inventions = Inventions;
})(window.PC);
