// Measuring instruments: thermometer, pH meter, pressure gauge and scale. Click one in the Instruments drawer, then
// click in the workspace to place it (on a container it measures the contents, on an object it measures the object).
// Each sensor shows a live reading in the scene and a graph in the drawer; readings export as CSV.
(function (PC) {
  'use strict';
  const LIQUID = 2, GAS = 3;

  const TYPES = {
    thermo: { label: 'Thermometer', unit: '°C', color: '#ff7a59', icon: 'thermometer' },
    ph: { label: 'pH meter', unit: 'pH', color: '#7dff8a', icon: 'flask' },
    pressure: { label: 'Pressure gauge', unit: 'bar', color: '#7cc4ff', icon: 'gauge' },
    scale: { label: 'Scale', unit: 'kg', color: '#ffd36b', icon: 'scale' },
  };
  // Acid/base strength used by the pH meter (mol/L of H⁺ or OH⁻ a pure particle of it contributes).
  const ACIDITY = { acid: 1, hcl: 1, vinegar: 0.004, so2: 0.01, co2: 0.0001 };
  const BASICITY = { lye: 1, acetate: 0.000008, baking_soda: 0.003, slaked_lime: 0.02, quicklime: 0.05, ammonia: 0.004 };

  class Instruments {
    constructor(ui) {
      this.ui = ui; this.sensors = []; this.nextId = 1; this.placing = null; this.t = 0; this.acc = 0;
      this.build();
    }
    get sim() { return this.ui.sim; }
    get view() { return this.ui.view; }

    build() {
      const el = document.createElement('div');
      el.id = 'instruments'; el.className = 'hidden';
      el.innerHTML = `<div class="ins-head"><b>Instruments</b><button class="ins-x" title="Close">×</button></div>
        <div class="ins-add">${Object.entries(TYPES).map(([k, t]) => `<button class="btn" data-add="${k}" title="Place a ${t.label.toLowerCase()}">${PC.ico(t.icon)} ${t.label}</button>`).join('')}</div>
        <div class="ins-hint">Pick an instrument, then click in the workspace to place it. On a container it measures what is inside.</div>
        <div class="ins-list"></div>
        <div class="ins-foot"><button class="btn" data-csv>Export CSV</button><button class="btn" data-clear>Remove all</button></div>`;
      document.getElementById('stage').appendChild(el);
      this.el = el;
      el.querySelector('.ins-x').onclick = () => this.toggle(false);
      for (const b of el.querySelectorAll('[data-add]')) b.onclick = () => this.startPlacing(b.dataset.add);
      el.querySelector('[data-csv]').onclick = () => this.exportCSV();
      el.querySelector('[data-clear]').onclick = () => { for (const s of this.sensors.slice()) this.remove(s); };
      this.labels = document.getElementById('labels');
    }
    toggle(on) {
      const show = on != null ? on : this.el.classList.contains('hidden');
      this.el.classList.toggle('hidden', !show);
      if (!show) this.placing = null;
      this.renderList();
    }
    startPlacing(type) {
      this.placing = type;
      for (const b of this.el.querySelectorAll('[data-add]')) b.classList.toggle('primary', b.dataset.add === type);
      this.ui.toast({ title: 'Place ' + TYPES[type].label.toLowerCase(), name: 'Click in the workspace', info: true });
    }
    // Called by the UI on a workspace click; returns true if it placed a sensor.
    handleClick(hit) {
      if (!this.placing || !hit) return false;
      const type = this.placing;
      this.placing = null;
      for (const b of this.el.querySelectorAll('[data-add]')) b.classList.remove('primary');
      if (!PC.onTiles(this.sim.s, hit.point[0], hit.point[2])) { this.ui.toast({ title: 'Place it on the tiles', name: '', info: true }); return true; }
      const ent = hit.entity && hit.entity.kind === 'body' ? hit.entity : null;
      const s = { id: this.nextId++, type, point: hit.point.slice(), ent, off: null, data: [], mesh: null, label: null };
      if (ent) { const b = ent.cb.position; s.off = [hit.point[0] - b.x, hit.point[1] - b.y, hit.point[2] - b.z]; }
      this.sensors.push(s);
      this.makeMarker(s);
      this.renderList();
      return true;
    }
    remove(s) {
      this.sensors = this.sensors.filter((x) => x !== s);
      if (s.mesh) this.view.scene.remove(s.mesh);
      if (s.label) s.label.remove();
      this.renderList();
    }

    makeMarker(s) {
      const THREE = this.view.THREE, t = TYPES[s.type];
      const g = new THREE.Group();
      const metal = new THREE.MeshStandardMaterial({ color: 0xc6ccd2, metalness: 1, roughness: 0.3 });
      const head = new THREE.MeshStandardMaterial({ color: new THREE.Color(t.color), emissive: new THREE.Color(t.color), emissiveIntensity: 0.6, roughness: 0.4 });
      const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.16, 10), metal); stem.position.y = 0.08;
      const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.014, 16, 12), head); bulb.position.y = 0.17;
      g.add(stem, bulb);
      for (const m of [stem, bulb]) { m.castShadow = true; }
      this.view.scene.add(g);
      s.mesh = g;
      const lab = document.createElement('div');
      lab.className = 'ins-label';
      lab.style.setProperty('--c', t.color);
      this.labels.appendChild(lab);
      s.label = lab;
    }

    // ------------------------------------------------------------------ readings
    pos(s) {
      if (s.ent && !s.ent.deleted) { const b = s.ent.cb.position; return [b.x + s.off[0], b.y + s.off[1], b.z + s.off[2]]; }
      if (s.ent && s.ent.deleted) { s.point = this.pos({ ent: null, point: s.point }); s.ent = null; }
      return s.point;
    }
    // Particles the sensor measures: a container's contents, or those within reach of the tip.
    particles(s, p, R) {
      const f = this.sim.fluid, out = [];
      if (s.ent && s.ent.container && s.ent.bindId != null) {
        for (let k = 0; k < f.nAct; k++) { const i = f.act[k]; if (f.alive[i] && f.bind[i] === s.ent.bindId) out.push(i); }
        if (out.length) return out;
      }
      f.forEachNear(p[0], p[1], p[2], R, (j) => out.push(j));
      return out;
    }
    read(s) {
      const f = this.sim.fluid, p = this.pos(s);
      switch (s.type) {
        case 'thermo': {
          if (s.ent && !s.ent.container && !s.ent.deleted) return s.ent.T - 273.15;
          const ps = this.particles(s, p, 0.12);
          if (!ps.length) return this.sim.s.ambientT - 273.15;
          let t = 0; for (const i of ps) t += f.T[i];
          return t / ps.length - 273.15;
        }
        case 'ph': {
          const ps = this.particles(s, p, 0.15).filter((i) => f.phase[i] === LIQUID);
          if (!ps.length) return null;
          let h = 0;
          for (const i of ps) { const id = PC.MATS[f.mat[i]].id; h += (ACIDITY[id] || 0) - (BASICITY[id] || 0); }
          h /= ps.length;
          if (Math.abs(h) < 1e-7) return 7;
          return h > 0 ? Math.max(0, -Math.log10(h)) : Math.min(14, 14 + Math.log10(-h));
        }
        case 'pressure': {
          if (s.ent && s.ent.container && s.ent.pressure) return s.ent.pressure / 1e5;
          const lvl = this.sim.surface.levelAround(p[0], p[2], 0.1);
          const depth = lvl && lvl.top > p[1] ? lvl.top - p[1] : 0;
          return (101325 + (lvl ? lvl.rho * 1000 : 0) * 9.81 * depth) / 1e5;
        }
        case 'scale': {
          // Everything resting on a 25 cm-radius pan at the sensor (a container's contents and the container itself).
          let kg = 0;
          if (s.ent && !s.ent.deleted) kg += s.ent.cb.mass || 0;
          const ps = s.ent && s.ent.container ? this.particles(s, p, 0) : [];
          if (!ps.length) for (let k = 0; k < f.nAct; k++) { const i = f.act[k]; if (!f.alive[i] || f.phase[i] === GAS) continue; const dx = f.x[i] - p[0], dz = f.z[i] - p[2]; if (dx * dx + dz * dz < 0.0625 && f.y[i] > p[1] - 0.05) kg += f.kg(i); }
          else for (const i of ps) if (f.phase[i] !== GAS) kg += f.kg(i);
          if (!s.ent) for (const e of this.sim.bodies.list) { if (e.deleted || e.container) continue; const b = e.cb.position, dx = b.x - p[0], dz = b.z - p[2]; if (dx * dx + dz * dz < 0.0625 && b.y > p[1] - 0.05 && e.cb.mass) kg += e.cb.mass; }
          return kg;
        }
      }
      return null;
    }
    fmt(s, v) {
      if (v == null || !isFinite(v)) return '—';
      if (s.type === 'thermo') return v.toFixed(1) + ' °C';
      if (s.type === 'ph') return 'pH ' + v.toFixed(2);
      if (s.type === 'pressure') return v.toFixed(3) + ' bar';
      return v < 1 ? (v * 1000).toFixed(1) + ' g' : v.toFixed(2) + ' kg';
    }

    // Per frame: move markers/labels; 4 Hz sampling into the graphs.
    update(dtSec, simTime) {
      if (!this.sensors.length) return;
      const v = this.view, THREE = v.THREE, P = new THREE.Vector3();
      this.acc += dtSec;
      const sample = this.acc >= 0.25;
      if (sample) this.acc = 0;
      for (const s of this.sensors) {
        const p = this.pos(s);
        s.mesh.position.set(p[0], p[1], p[2]);
        if (sample) {
          // After undo/rewind the clock goes back: drop readings from the undone future.
          while (s.data.length && s.data[s.data.length - 1][0] > simTime) s.data.pop();
          const val = this.read(s);
          s.last = val;
          s.data.push([simTime, val]);
          if (s.data.length > 1200) s.data.shift(); // last 5 minutes
        }
        P.set(p[0], p[1] + 0.2, p[2]).project(v.camera);
        const on = P.z < 1 && Math.abs(P.x) < 1.1 && Math.abs(P.y) < 1.1;
        s.label.style.display = on ? '' : 'none';
        if (on) { s.label.style.left = ((P.x + 1) / 2 * v.cssW) + 'px'; s.label.style.top = ((1 - P.y) / 2 * v.cssH) + 'px'; }
        if (sample) s.label.innerHTML = `${PC.ico(TYPES[s.type].icon)} ${this.fmt(s, s.last)}`;
      }
      if (sample && !this.el.classList.contains('hidden')) this.drawGraphs();
    }

    renderList() {
      const list = this.el.querySelector('.ins-list');
      if (!this.sensors.length) { list.innerHTML = '<div class="ins-empty">No instruments placed yet.</div>'; return; }
      list.innerHTML = '';
      for (const s of this.sensors) {
        const t = TYPES[s.type], row = document.createElement('div');
        row.className = 'ins-row';
        row.innerHTML = `<div class="ins-top"><span class="ins-name" style="--c:${t.color}">${PC.ico(t.icon)} ${t.label} ${s.id}${s.ent ? ` · <i>${(s.ent.name || '').replace(/</g, '&lt;')}</i>` : ''}</span><span class="ins-val"></span><button class="ins-del" title="Remove">×</button></div><canvas class="ins-graph" width="300" height="70"></canvas>`;
        row.querySelector('.ins-del').onclick = () => this.remove(s);
        s.row = row;
        list.appendChild(row);
      }
      this.drawGraphs();
    }
    drawGraphs() {
      const css = getComputedStyle(document.documentElement);
      for (const s of this.sensors) {
        if (!s.row) continue;
        s.row.querySelector('.ins-val').textContent = this.fmt(s, s.last);
        const cv = s.row.querySelector('canvas'), g = cv.getContext('2d'), W = cv.width, H = cv.height;
        g.clearRect(0, 0, W, H);
        const pts = s.data.filter((d) => d[1] != null && isFinite(d[1])).slice(-240); // last minute
        g.strokeStyle = 'rgba(255,255,255,0.08)'; g.lineWidth = 1;
        for (let k = 1; k < 4; k++) { g.beginPath(); g.moveTo(0, (H * k) / 4); g.lineTo(W, (H * k) / 4); g.stroke(); }
        if (pts.length < 2) continue;
        let lo = Infinity, hi = -Infinity;
        for (const d of pts) { lo = Math.min(lo, d[1]); hi = Math.max(hi, d[1]); }
        if (hi - lo < 1e-6) { hi += 0.5; lo -= 0.5; }
        const pad = (hi - lo) * 0.12; lo -= pad; hi += pad;
        const t0 = pts[0][0], t1 = pts[pts.length - 1][0] || t0 + 1;
        const X = (t) => ((t - t0) / Math.max(1e-6, t1 - t0)) * (W - 4) + 2, Y = (v) => H - 4 - ((v - lo) / (hi - lo)) * (H - 8);
        const col = TYPES[s.type].color;
        g.beginPath(); g.moveTo(X(pts[0][0]), H);
        for (const d of pts) g.lineTo(X(d[0]), Y(d[1]));
        g.lineTo(X(pts[pts.length - 1][0]), H); g.closePath();
        g.fillStyle = col + '22'; g.fill();
        g.beginPath();
        pts.forEach((d, k) => (k ? g.lineTo(X(d[0]), Y(d[1])) : g.moveTo(X(d[0]), Y(d[1]))));
        g.strokeStyle = col; g.lineWidth = 2; g.stroke();
        const last = pts[pts.length - 1];
        g.fillStyle = col; g.beginPath(); g.arc(X(last[0]), Y(last[1]), 3, 0, 6.283); g.fill();
        g.fillStyle = css.getPropertyValue('--ins-axis') || '#8ea2b8'; g.font = '10px ui-monospace, monospace';
        g.fillText(this.fmt(s, hi - pad), 4, 11); g.fillText(this.fmt(s, lo + pad), 4, H - 3);
      }
    }
    exportCSV() {
      if (!this.sensors.length) { this.ui.toast({ title: 'No instruments to export', name: '', info: true }); return; }
      const lines = ['sensor,type,time_s,value,unit'];
      for (const s of this.sensors) for (const [t, v] of s.data) lines.push(`${s.id},${TYPES[s.type].label},${t.toFixed(2)},${v == null ? '' : v},${TYPES[s.type].unit}`);
      this.ui.download(`physicscraft-readings-${this.ui.stamp()}.csv`, new Blob([lines.join('\n')], { type: 'text/csv' }));
      this.ui.toast({ title: 'Readings exported', name: `${lines.length - 1} samples`, sub: 'Check your Downloads folder', info: true });
    }
    // After undo/rewind/open, objects are new: keep sensors where they were.
    detachAll() { for (const s of this.sensors) if (s.ent) { s.point = this.pos(s); s.ent = null; } }
  }
  PC.Instruments = Instruments;
})(window.PC);
