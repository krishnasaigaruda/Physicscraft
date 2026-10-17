// Photographs every entry's 3D model into a small image for the sidebar: solid samples (ingots,
// crystals, coils…), liquids in glass flasks, gases glowing in discharge tubes, powders as heaps,
// flames, smoke and the containers themselves. Uses a separate small renderer and the garden HDRI.
(function (PC) {
  'use strict';

  class IconFactory {
    constructor(view) {
      const THREE = view.THREE;
      this.view = view; this.T = THREE;
      this.size = 128;
      this.canvas = document.createElement('canvas');
      this.canvas.width = this.canvas.height = this.size;
      this.r = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
      this.r.outputColorSpace = THREE.SRGBColorSpace;
      this.r.toneMapping = THREE.ACESFilmicToneMapping;
      this.r.toneMappingExposure = 1.05;
      this.r.setClearColor(0x000000, 0);
      this.scene = new THREE.Scene();
      this.cam = new THREE.PerspectiveCamera(30, 1, 0.01, 10);
      const key = new THREE.DirectionalLight(0xfff4e6, 2.2); key.position.set(1.5, 2.5, 2);
      const rim = new THREE.DirectionalLight(0xbcd4ff, 1.2); rim.position.set(-2, 1, -1.5);
      this.scene.add(key, rim);
      this.kit = new PC.ModelKit(THREE, view.A, view.tex);
      this.pmrem = new THREE.PMREMGenerator(this.r);
      this.envFrom = null;
      this.useRoomEnv();
      this.cache = new Map();
      this.queue = [];
      this.waiting = new Set();
      this.listeners = [];
    }
    useRoomEnv() { this.scene.environment = this.pmrem.fromScene(new this.view.A.RoomEnvironment(), 0.04).texture; }
    syncEnv() {
      const hdr = this.view.hdr;
      if (hdr && this.envFrom !== hdr) { this.envFrom = hdr; this.scene.environment = this.pmrem.fromEquirectangular(hdr).texture; this.cache.clear(); this.requeueAll(); }
    }
    requeueAll() { for (const k of this.known || []) if (!this.waiting.has(k)) { this.waiting.add(k); this.queue.push(k); } }

    get(entry) {
      const k = entry.key;
      if (this.cache.has(k)) return this.cache.get(k);
      this.known = this.known || new Set();
      this.known.add(k);
      this.entries = this.entries || {};
      this.entries[k] = entry;
      if (!this.waiting.has(k)) { this.waiting.add(k); this.queue.push(k); }
      return null;
    }
    onReady(fn) { this.listeners.push(fn); }

    // Renders a few icons per frame.
    tick(n) {
      this.syncEnv();
      for (let i = 0; i < n && this.queue.length; i++) {
        const k = this.queue.shift();
        this.waiting.delete(k);
        try {
          const url = this.render(this.entries[k]);
          this.cache.set(k, url);
          for (const fn of this.listeners) fn(k, url);
        } catch (e) { console.warn('icon failed', k, e); }
      }
    }

    glass() {
      const THREE = this.T;
      return new THREE.MeshPhysicalMaterial({ color: 0xffffff, metalness: 0, roughness: 0.02, transmission: 1, thickness: 0.02, ior: 1.5, transparent: true, opacity: 1, envMapIntensity: 1.4, side: THREE.DoubleSide });
    }

    objectFor(entry) {
      const THREE = this.T, g = new THREE.Group();
      if (entry.kind === 'container') {
        const e = { def: entry.def, container: entry.key, props: PC.defaultProps(PC.MAT[entry.def.mat]), mat: PC.MAT[entry.def.mat].index, parts: [] };
        if (entry.def.shape === 'ramp' || entry.def.shape === 'box' || entry.def.shape === 'table') {
          const tmp = this.view.sim.bodies;
          void tmp;
        }
        const add = (geo, m, x, y, z, rot) => { const mesh = new THREE.Mesh(geo, m); mesh.position.set(x || 0, y || 0, z || 0); if (rot) mesh.rotation.set(rot[0], rot[1], rot[2]); g.add(mesh); return mesh; };
        if (entry.def.shape === 'ramp') add(new THREE.BoxGeometry(entry.def.hx * 2, entry.def.hy * 2, entry.def.hz * 2), new THREE.MeshStandardMaterial({ color: 0x8a8a86, roughness: 0.9 }), 0, 0, 0, [0, 0, entry.def.angle]);
        else if (entry.def.shape === 'box') add(new THREE.BoxGeometry(entry.def.hx * 2, entry.def.hy * 2, entry.def.hz * 2), new THREE.MeshStandardMaterial({ color: 0x9a9890, roughness: 0.9 }));
        else if (entry.def.shape === 'table') {
          const st = new THREE.MeshStandardMaterial({ color: 0xb8bdc4, metalness: 1, roughness: 0.3 });
          add(new THREE.BoxGeometry(entry.def.hx * 2, 0.06, entry.def.hz * 2), st, 0, entry.def.Ht - 0.03, 0);
          for (const sx of [-1, 1]) for (const sz of [-1, 1]) add(new THREE.BoxGeometry(0.07, entry.def.Ht, 0.07), st, sx * (entry.def.hx - 0.05), entry.def.Ht / 2, sz * (entry.def.hz - 0.05));
        } else this.view.buildContainerMesh(e, g, add);
        // The live glass shader needs the frame behind it; icons use physical transmission glass instead.
        g.traverse((o) => { if (o.isMesh && o.material.userData && o.material.userData.shaderGlass) o.material = this.glass(); });
        return g;
      }
      if (entry.kind === 'dummy') {
        // Icon: the real mannequin model, once downloaded.
        if (!this.dummyIcon) { this.dummyIcon = new this.view.A.GLTFLoader().loadAsync(PC.DUMMY_MODEL).then((m) => { this.dummyScene = m.scene; this.cache.delete(entry.key); this.get(entry); }); }
        if (this.dummyScene) { const c = this.view.A.SkeletonUtils.clone(this.dummyScene); c.scale.setScalar(0.11); c.position.y = -0.1; g.add(c); }
        return g;
      }
      if (entry.kind === 'invention') { const o = this.kit.build(PC.MAT[entry.mat], null, entry.key); o.traverse((x) => { if (x.isMesh && x.userData.glow) x.material.emissiveIntensity = 2; }); g.add(o); return g; }
      const m = PC.MAT[entry.mat];
      const T = entry.T != null ? entry.T : 293;
      const props = PC.defaultProps(m);
      const phase = m.life ? 'gas' : T < m.mp ? 'solid' : T < m.bp ? 'liquid' : 'gas';
      if (m.id === 'fire') return this.flame(g);
      if (m.life || entry.key === 'steam' || entry.key === 'air') return this.puff(g, m, entry.key);
      if (phase === 'solid' && m.powder) return this.heap(g, m);
      if (phase === 'solid') { const o = this.kit.build(m, props, entry.key); o.traverse((x) => { if (x.isMesh && x.material.userData && x.material.userData.wantsGlassShader) x.material = this.glass(); }); g.add(o); return g; }
      if (phase === 'liquid') return this.flask(g, m, entry.key);
      return this.tube(g, m);
    }

    heap(g, m) {
      const THREE = this.T, st = PC.grainStyle(m);
      const geo = PC.grainGeometry(THREE, st), mat = PC.grainMaterial(THREE, st);
      mat.color = new THREE.Color(m.color);
      const n = 34, inst = new THREE.InstancedMesh(geo, mat, n), M4 = new THREE.Matrix4(), q = new THREE.Quaternion();
      for (let k = 0; k < n; k++) {
        const a = k * 2.4, rr = Math.sqrt(k / n) * 0.11, y = (1 - rr / 0.11) * 0.07;
        q.setFromEuler(new THREE.Euler(k, k * 2, k * 3));
        inst.setMatrixAt(k, M4.compose(new THREE.Vector3(Math.cos(a) * rr, y, Math.sin(a) * rr), q, new THREE.Vector3(1, 1, 1)));
      }
      g.add(inst);
      return g;
    }
    flask(g, m, key) {
      const THREE = this.T;
      const pts = [[0, 0], [0.05, 0], [0.055, 0.005], [0.055, 0.1], [0.05, 0.104]].map(([x, y]) => new THREE.Vector2(x, y));
      g.add(new THREE.Mesh(new THREE.LatheGeometry(pts, 48), this.glass()));
      const col = new THREE.Color(m.phaseColors.liquid);
      const opaque = m.opacity > 0.9 || m.metallic;
      const liq = new THREE.MeshPhysicalMaterial({ color: col, roughness: m.metallic ? 0.05 : 0.05, metalness: m.metallic ? 1 : 0, transmission: opaque ? 0 : 0.9, thickness: 0.08, ior: 1.33, transparent: !opaque, attenuationColor: col, attenuationDistance: 0.12 });
      if (m.id === 'lava' || key === 'lava') { liq.emissive = new THREE.Color(1, 0.35, 0.05); liq.emissiveIntensity = 1.4; liq.color.set(0x401808); }
      if (m.id === 'antimatter') { liq.emissive = new THREE.Color(0.7, 0.3, 1); liq.emissiveIntensity = 1.2; }
      const fill = new THREE.Mesh(new THREE.CylinderGeometry(0.052, 0.052, 0.065, 48), liq);
      fill.position.y = 0.037;
      g.add(fill);
      if (key === 'ln2') { const fog = this.puffMesh(new THREE.Color(1, 1, 1), 0.5); fog.position.y = 0.11; g.add(fog); }
      return g;
    }
    // Gas-discharge tube: the gas glows in its characteristic emission colour (neon red, argon violet…).
    tube(g, m) {
      const THREE = this.T;
      const glass = this.glass();
      const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.03, 0.14, 8, 32), glass);
      body.rotation.z = Math.PI / 2;
      g.add(body);
      const e = m.emitRgb ? new THREE.Color(m.emit) : new THREE.Color(m.phaseColors.gas);
      const coloured = (m.gasAlpha || 0) > 0.2;
      const core = new THREE.Mesh(new THREE.CapsuleGeometry(0.018, 0.13, 8, 24), new THREE.MeshBasicMaterial({ color: e.clone().multiplyScalar(m.emitRgb ? 2.2 : coloured ? 0.9 : 0.5), transparent: true, opacity: m.emitRgb ? 0.95 : coloured ? 0.8 : 0.25 }));
      core.rotation.z = Math.PI / 2;
      g.add(core);
      const cap = new THREE.MeshStandardMaterial({ color: 0x9aa0a8, metalness: 1, roughness: 0.3 });
      for (const sx of [-1, 1]) { const c = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.02, 24), cap); c.rotation.z = Math.PI / 2; c.position.x = sx * 0.1; g.add(c); }
      return g;
    }
    flame(g) {
      const THREE = this.T, sp = new THREE.SpriteMaterial({ map: this.view.tex.flameSprite(), color: new THREE.Color(1.8, 0.7, 0.15), blending: THREE.AdditiveBlending, transparent: true, depthWrite: false });
      for (let k = 0; k < 7; k++) { const s = new THREE.Sprite(sp); s.scale.set(0.09 - k * 0.006, 0.14 - k * 0.008, 1); s.position.set((k % 3 - 1) * 0.02, 0.06 + k * 0.006, 0); g.add(s); }
      const logs = new THREE.MeshStandardMaterial({ color: 0x4a2c15, roughness: 0.9 });
      for (const r of [0.5, -0.5]) { const l = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.13, 12), logs); l.rotation.set(0, r, Math.PI / 2); l.position.y = 0.012; g.add(l); }
      return g;
    }
    puffMesh(col, opacity) {
      const THREE = this.T;
      return new THREE.Sprite(new THREE.SpriteMaterial({ map: this.view.tex.smokeSprite(), color: col, transparent: true, opacity, depthWrite: false }));
    }
    puff(g, m, key) {
      const THREE = this.T, col = new THREE.Color(key === 'air' ? 0xcfe6ff : m.phaseColors.gas);
      for (let k = 0; k < 6; k++) { const s = this.puffMesh(col, key === 'air' ? 0.45 : 0.75); s.scale.setScalar(0.09 + k * 0.012); s.position.set((k % 3 - 1) * 0.035, 0.03 + k * 0.018, (k % 2) * 0.01); g.add(s); }
      return g;
    }

    render(entry) {
      const THREE = this.T;
      const obj = this.objectFor(entry);
      this.scene.add(obj);
      const box = new THREE.Box3().setFromObject(obj), c = box.getCenter(new THREE.Vector3()), sz = box.getSize(new THREE.Vector3());
      const R = Math.max(sz.x, sz.y, sz.z) * 0.5 || 0.05;
      const dist = R / Math.sin(this.cam.fov * Math.PI / 360) * 1.05;
      this.cam.position.set(c.x + dist * 0.55, c.y + dist * 0.5, c.z + dist * 0.66);
      this.cam.lookAt(c);
      this.r.render(this.scene, this.cam);
      const url = this.canvas.toDataURL('image/png');
      this.scene.remove(obj);
      obj.traverse((o) => { if (o.isMesh && o.geometry && !o.geometry.userData.keep) o.geometry.dispose(); });
      return url;
    }
  }

  PC.IconFactory = IconFactory;
})(window.PC);
