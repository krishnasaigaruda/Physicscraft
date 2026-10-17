// Procedural 3D models for every solid substance (see core/models.js for which shape each material uses).
// Builds a THREE.Group sized to the model's half-extents with PBR materials, textures and details.
(function (PC) {
  'use strict';

  function rng(seed) { let s = (seed >>> 0) || 7; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }

  // Merge several (possibly indexed) geometries into one non-indexed geometry with normals.
  function merge(THREE, geos) {
    const parts = geos.map((g) => (g.index ? g.toNonIndexed() : g));
    let n = 0;
    for (const g of parts) { if (!g.attributes.normal) g.computeVertexNormals(); n += g.attributes.position.count; }
    const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), uv = new Float32Array(n * 2);
    let o = 0, u = 0;
    for (const g of parts) {
      pos.set(g.attributes.position.array, o); nor.set(g.attributes.normal.array, o); o += g.attributes.position.array.length;
      if (g.attributes.uv) uv.set(g.attributes.uv.array, u);
      u += g.attributes.position.count * 2;
    }
    const out = new THREE.BufferGeometry();
    out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    out.computeBoundingSphere();
    return out;
  }
  PC.mergeGeometries = merge;

  // Poly Haven glTF loader (textures are served at their own URLs; map relative paths through the files API).
  const phModels = new Map();
  // Downloaded meshes can contain degenerate triangles whose normals come out as NaN; one NaN pixel is smeared by
  // the bloom pass into a huge black blotch. Recompute bad normals and drop invalid vertices.
  PC.sanitizeGeometry = function (geo) {
    const P = geo.attributes.position;
    if (!P) return geo;
    const p = P.array;
    for (let k = 0; k < p.length; k++) if (!Number.isFinite(p[k])) p[k] = 0;
    let N = geo.attributes.normal, bad = !N;
    if (N) for (let k = 0; k < N.array.length; k++) if (!Number.isFinite(N.array[k])) { bad = true; break; }
    if (bad) geo.computeVertexNormals();
    N = geo.attributes.normal;
    const n = N.array;
    for (let k = 0; k < n.length; k += 3) {
      const l = Math.hypot(n[k], n[k + 1], n[k + 2]);
      if (!Number.isFinite(l) || l < 1e-8) { n[k] = 0; n[k + 1] = 1; n[k + 2] = 0; } else if (Math.abs(l - 1) > 1e-3) { n[k] /= l; n[k + 1] /= l; n[k + 2] /= l; }
    }
    N.needsUpdate = true; P.needsUpdate = true;
    geo.computeBoundingSphere();
    return geo;
  };

  // Bounds of a model as it is drawn. Rigged (skinned) meshes are posed by their bones, so their extent comes from the
  // bones' world positions (padded for the flesh around them); ordinary meshes use their geometry.
  PC.measureModel = function (THREE, root) {
    root.updateMatrixWorld(true);
    const box = new THREE.Box3(), tmp = new THREE.Box3(), v = new THREE.Vector3();
    root.traverse((o) => {
      if (!o.isMesh || !o.visible) return;
      if (o.isSkinnedMesh && o.skeleton && o.skeleton.bones.length) {
        tmp.makeEmpty();
        for (const b of o.skeleton.bones) tmp.expandByPoint(b.getWorldPosition(v));
        const pad = tmp.getSize(new THREE.Vector3()).length() * 0.08;
        tmp.expandByScalar(pad);
        box.union(tmp);
        box.union(tmp.setFromObject(o)); // and the mesh's own bounds — whichever way the file is set up, cover both
      } else box.union(tmp.setFromObject(o));
    });
    return box;
  };

  // Real 3D scan from Wikimedia Commons (STL): centred, with box-projected UVs so textures can wrap it.
  const stlModels = new Map();
  PC.loadSTLModel = function (THREE, A, url) {
    if (!stlModels.has(url)) stlModels.set(url, new Promise((res, rej) => new A.STLLoader().load(url, res, undefined, rej)).then((geo) => {
      PC.sanitizeGeometry(geo);
      geo.computeBoundingBox();
      const c = geo.boundingBox.getCenter(new THREE.Vector3()), size = geo.boundingBox.getSize(new THREE.Vector3());
      geo.translate(-c.x, -c.y, -c.z);
      const P = geo.attributes.position, N = geo.attributes.normal, uv = new Float32Array(P.count * 2), m = Math.max(size.x, size.y, size.z) || 1;
      for (let i = 0; i < P.count; i++) {
        const ax = Math.abs(N.getX(i)), ay = Math.abs(N.getY(i)), az = Math.abs(N.getZ(i));
        const u = ay >= ax && ay >= az ? [P.getX(i), P.getZ(i)] : ax >= az ? [P.getZ(i), P.getY(i)] : [P.getX(i), P.getY(i)];
        uv[i * 2] = u[0] / m * 2; uv[i * 2 + 1] = u[1] / m * 2;
      }
      geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
      return { geo, half: [size.x / 2, size.y / 2, size.z / 2] };
    }));
    return stlModels.get(url);
  };

  // Any GLB (Objaverse/Sketchfab): keep the largest object, centre it, report its half-extents.
  const glbModels = new Map();
  PC.loadGLBModel = function (THREE, A, url) {
    if (!glbModels.has(url)) glbModels.set(url, new A.GLTFLoader().loadAsync(url).then((gltf) => {
      const root = gltf.scene;
      root.traverse((o) => { if (o.isMesh) PC.sanitizeGeometry(o.geometry); });
      root.updateMatrixWorld(true);
      // Drop scenery bundled with the model (sky domes, backdrops, ground planes, shadow catchers) — anything that
      // dwarfs the rest of the model and encloses it.
      const meshes = [];
      root.traverse((o) => { if (o.isMesh) meshes.push({ o, b: new THREE.Box3().setFromObject(o) }); });
      if (meshes.length > 1) {
        const sz = (b) => b.getSize(new THREE.Vector3()).length();
        const named = /sky|dome|background|backdrop|environment|env_|ground|floor|plane|shadow|studio|bg/i;
        for (const m of meshes) {
          // Bounding box of everything else in the model.
          const rest = new THREE.Box3();
          for (const n of meshes) if (n !== m) rest.union(n.b);
          const mats = [].concat(m.o.material), backside = mats.some((x) => x && x.side === THREE.BackSide);
          const encloses = m.b.containsBox(rest) && sz(m.b) > sz(rest) * 2.5; // a dome/room around the object
          const d = m.b.getSize(new THREE.Vector3()), flat = Math.min(d.x, d.y, d.z) < Math.max(d.x, d.y, d.z) * 0.02;
          const rh = rest.getSize(new THREE.Vector3()).y;
          const groundPlane = flat && sz(m.b) > sz(rest) * 1.5 && m.b.min.y <= rest.min.y + Math.max(0.05 * rh, 1e-3); // big sheet under it
          const invisible = mats.every((x) => x && x.transparent && x.opacity < 0.05); // shadow catchers, helpers
          if (invisible || encloses || (backside && sz(m.b) > sz(rest)) || (named.test(m.o.name) && (encloses || groundPlane)) || groundPlane) m.o.visible = false;
        }
        for (const m of meshes) if (!m.o.visible) m.o.parent.remove(m.o);
        root.updateMatrixWorld(true);
      }
      // Several copies of the same thing side by side (a dog in three poses, a row of printers): keep the biggest one.
      {
        const hasMesh = (o) => { let m = false; o.traverse((x) => { if (x.isMesh && x.visible) m = true; }); return m; };
        let node = root;
        for (let depth = 0; depth < 8; depth++) {
          const kids = node.children.filter(hasMesh);
          if (kids.length !== 1) break;
          node = kids[0];
        }
        const kids = node.children.filter(hasMesh);
        if (kids.length >= 2 && kids.length <= 12) {
          const info = kids.map((k) => { const b = new THREE.Box3().setFromObject(k), d = b.getSize(new THREE.Vector3()); return { k, b, v: d.x * d.y * d.z, l: d.length() }; });
          const big = info.reduce((a, b) => (b.v > a.v ? b : a));
          const similar = info.filter((x) => x.l > big.l * 0.6);
          let overlap = 0;
          for (let a = 0; a < similar.length; a++) for (let b = a + 1; b < similar.length; b++) if (similar[a].b.intersectsBox(similar[b].b)) overlap++;
          if (similar.length >= 2 && overlap === 0) for (const x of info) if (x !== big) x.k.parent.remove(x.k);
        }
        root.updateMatrixWorld(true);
      }
      root.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; o.frustumCulled = false; if (o.material && o.material.transparent && o.material.opacity > 0.95) o.material.transparent = false; } });
      root.updateMatrixWorld(true);
      const box = PC.measureModel(THREE, root), c = box.getCenter(new THREE.Vector3()), size = box.getSize(new THREE.Vector3());
      root.position.sub(c);
      const wrap = new THREE.Group(); wrap.add(root);
      return { scene: wrap, half: [size.x / 2, size.y / 2, size.z / 2] };
    }));
    return glbModels.get(url);
  };

  PC.loadPolyHavenModel = function (THREE, A, id) {
    if (!phModels.has(id)) phModels.set(id, fetch('https://api.polyhaven.com/files/' + id).then((r) => r.json()).then((info) => {
      const g = info.gltf['1k'].gltf, map = {};
      for (const [path, v] of Object.entries(g.include || {})) map[path] = v.url;
      const manager = new THREE.LoadingManager();
      manager.setURLModifier((url) => { for (const p in map) if (url.endsWith(p)) return map[p]; return url; });
      return new A.GLTFLoader(manager).loadAsync(g.url);
    }).then((gltf) => {
      // Some assets are sets (a bunch plus loose bananas, several rocks…): keep only the largest separate object.
      let root = gltf.scene;
      root.traverse((o) => { if (o.isMesh) PC.sanitizeGeometry(o.geometry); });
      root.updateMatrixWorld(true);
      const kids = root.children.filter((o) => { let m = false; o.traverse((x) => { if (x.isMesh) m = true; }); return m; });
      if (kids.length > 1) {
        let best = null, bv = -1;
        for (const k of kids) { const b = new THREE.Box3().setFromObject(k), sz = b.getSize(new THREE.Vector3()), v = sz.x * sz.y * sz.z; if (v > bv) { bv = v; best = k; } }
        const keep = new THREE.Group();
        best.updateMatrixWorld(true);
        best.matrixWorld.decompose(best.position, best.quaternion, best.scale);
        keep.add(best);
        root = keep;
      }
      // Centre the asset on its bounding box; Poly Haven models are modelled at real-world scale (metres).
      const box = new THREE.Box3().setFromObject(root), c = box.getCenter(new THREE.Vector3()), size = box.getSize(new THREE.Vector3());
      root.position.sub(c);
      const wrap = new THREE.Group(); wrap.add(root);
      return { scene: wrap, half: [size.x / 2, size.y / 2, size.z / 2] };
    }));
    return phModels.get(id);
  };

  class ModelKit {
    constructor(THREE, A, tex) { this.T = THREE; this.A = A; this.tex = tex; this.cache = new Map(); }

    displaced(seed, detail, amp, freq, flatBottom) {
      const THREE = this.T, key = `d${seed}|${detail}|${amp}|${freq}|${flatBottom}`;
      if (this.cache.has(key)) return this.cache.get(key);
      const g = new THREE.IcosahedronGeometry(1, detail), p = g.attributes.position, v = new THREE.Vector3();
      for (let k = 0; k < p.count; k++) {
        v.fromBufferAttribute(p, k);
        const n = PC.fbm(v.x * freq + seed * 3.7 + 11, v.y * freq + v.z * freq * 0.8 + seed, 5);
        v.multiplyScalar(1 - amp + n * amp * 2);
        if (flatBottom && v.y < -0.55) v.y = -0.55 - (v.y + 0.55) * 0.15;
        p.setXYZ(k, v.x, v.y, v.z);
      }
      g.computeVertexNormals();
      g.userData.keep = true;
      this.cache.set(key, g);
      return g;
    }

    // PBR material for a substance.
    material(mat, props, look, kind) {
      const THREE = this.T;
      const custom = props && props.color !== mat.color;
      const color = new THREE.Color(custom ? props.color : look.tint || mat.color);
      const phys = look.irid || look.clear;
      const opts = { color, roughness: look.rough, metalness: look.metal, flatShading: !!look.flat };
      const m = phys ? new THREE.MeshPhysicalMaterial(Object.assign(opts, { iridescence: look.irid || 0, iridescenceIOR: 1.8, iridescenceThicknessRange: [120, 480], clearcoat: look.clear || 0, clearcoatRoughness: 0.08 }))
        : new THREE.MeshStandardMaterial(opts);
      if (look.metal > 0.5 && !look.flat) { const b = this.tex.procedural('brushed'); m.normalMap = b.normalMap; m.normalScale = new THREE.Vector2(0.22, 0.22); }
      if (look.emissive) { m.emissive = new THREE.Color(look.emissive); m.emissiveIntensity = (look.glow || 0.5) * 0.6; }
      if (look.metal < 0.3 && look.rough > 0.4 && kind !== 'plank') { const r = this.tex.procedural('rock'); m.normalMap = r.normalMap; m.normalScale = new THREE.Vector2(0.4, 0.4); }
      return m;
    }

    // Builds the model; `add(geo, material, x, y, z, rot, scale)` places a part. Returns the group.
    build(mat, props, entryKey, dims) {
      if (entryKey && entryKey.startsWith('inv_')) return this.invention(entryKey.slice(4), dims);
      if (entryKey && (entryKey.startsWith('human_') || entryKey.startsWith('dummy_'))) return new this.T.Group(); // physics only: the real rigged model is drawn by the view
      if (PC.CUSTOM && PC.CUSTOM[entryKey]) return this.custom(PC.CUSTOM[entryKey], props, dims);
      const THREE = this.T, A = this.A, spec = PC.modelSpec(mat, entryKey), look = spec.look;
      const [hx, hy, hz] = dims || spec.dims;
      const group = new THREE.Group();
      const add = (geo, m, x, y, z, rot, sc) => {
        const mesh = new THREE.Mesh(geo, m);
        mesh.position.set(x || 0, y || 0, z || 0);
        if (rot) mesh.rotation.set(rot[0], rot[1], rot[2]);
        if (sc) mesh.scale.set(sc[0], sc[1], sc[2]);
        mesh.castShadow = true; mesh.receiveShadow = true;
        group.add(mesh);
        return mesh;
      };
      const seed = mat.index * 31 + 7, R = rng(seed);
      const M = () => this.material(mat, props, look, spec.shape);
      switch (spec.shape) {
        case 'ingot': case 'bar': {
          const g = new A.RoundedBoxGeometry(hx * 2, hy * 2, hz * 2, 3, Math.min(hx, hy, hz) * (spec.shape === 'bar' ? 0.25 : 0.12));
          if (spec.shape === 'ingot') {
            const p = g.attributes.position;
            for (let k = 0; k < p.count; k++) if (p.getY(k) > 0) { p.setX(k, p.getX(k) * 0.82); p.setZ(k, p.getZ(k) * 0.78); }
            g.computeVertexNormals();
          }
          const m = M();
          add(g, m);
          // Stamped panel on bullion bars.
          if (spec.shape === 'bar') add(new A.RoundedBoxGeometry(hx * 1.3, hy * 0.2, hz * 1.2, 2, hy * 0.08), m, 0, hy * 1.0, 0);
          break;
        }
        case 'nugget': add(this.displaced(seed % 9, 4, 0.32, 1.6), M(), 0, 0, 0, null, [hx, hy, hz]); break;
        case 'lump': add(this.displaced(seed % 7, 4, 0.14, 1.1, true), M(), 0, 0, 0, null, [hx, hy, hz]); break;
        case 'sponge': add(this.displaced(seed % 5, 5, 0.3, 4.5), M(), 0, 0, 0, null, [hx, hy, hz]); break;
        case 'chunk': add(this.displaced(seed % 11, 1, 0.22, 1.3), M(), 0, 0, 0, null, [hx, hy, hz]); break;
        case 'cluster': {
          const parts = [];
          const n = 7;
          for (let k = 0; k < n; k++) {
            const rad = 0.15 + R() * 0.12, len = 0.6 + R() * 0.9;
            const body = new THREE.CylinderGeometry(rad, rad, len, 6); body.translate(0, len / 2, 0);
            const tip = new THREE.ConeGeometry(rad, rad * 1.6, 6); tip.translate(0, len + rad * 0.8, 0);
            for (const g of [body, tip]) { g.rotateZ((R() - 0.5) * 1.4); g.rotateX((R() - 0.5) * 1.4); g.translate((R() - 0.5) * 0.5, -0.9, (R() - 0.5) * 0.5); parts.push(g); }
          }
          const base = new THREE.IcosahedronGeometry(0.45, 1); base.scale(1.3, 0.5, 1.3); base.translate(0, -0.85, 0); parts.push(base);
          add(merge(THREE, parts), M(), 0, 0, 0, null, [hx, hy, hz]);
          break;
        }
        case 'hopper': {
          // Bismuth hopper crystal: nested stepped square rims spiralling upward.
          const parts = [];
          for (let l = 0; l < 6; l++) {
            const s = 1 - l * 0.15, y = -0.8 + l * 0.28, t = 0.09;
            for (const [x, z, w, d] of [[0, s, s * 2, t], [0, -s, s * 2, t], [s, 0, t, s * 2], [-s, 0, t, s * 2]]) {
              const b = new THREE.BoxGeometry(w, 0.26, d); b.translate(x, y, z); b.rotateY(l * 0.12); parts.push(b);
            }
          }
          const floor = new THREE.BoxGeometry(2, 0.12, 2); floor.translate(0, -0.9, 0); parts.push(floor);
          add(merge(THREE, parts), M(), 0, 0, 0, null, [hx, hy, hz]);
          break;
        }
        case 'rod': add(new THREE.CylinderGeometry(hy, hy, hx * 2, 24), M(), 0, 0, 0, [0, 0, Math.PI / 2]); break;
        case 'pellet': {
          const m = M(), g = new THREE.CylinderGeometry(hx * 0.45, hx * 0.45, hy * 1.4, 24);
          add(g, m, -hx * 0.45, -hy * 0.25, -hz * 0.3); add(g, m, hx * 0.45, -hy * 0.25, -hz * 0.2, [0, 0.4, 0]); add(g, m, 0, -hy * 0.25, hz * 0.5, [0, 0.9, 0]);
          add(g, m, 0.1 * hx, hy * 0.45, 0, [0.25, 0.2, 0.15]);
          break;
        }
        case 'sphere': add(new THREE.SphereGeometry(1, 48, 24), M(), 0, 0, 0, null, [hx, hy, hz]); break;
        case 'orb': {
          const m = M(); m.emissive = new THREE.Color(look.emissive || '#9fb4ff'); m.emissiveIntensity = 0.35;
          add(new THREE.SphereGeometry(1, 48, 24), m, 0, 0, 0, null, [hx * 0.8, hy * 0.8, hz * 0.8]);
          const ring = new THREE.MeshStandardMaterial({ color: 0x2a2f3a, metalness: 1, roughness: 0.3 });
          add(new THREE.TorusGeometry(hx * 1.05, hx * 0.06, 12, 48), ring, 0, 0, 0, [Math.PI / 2, 0, 0]);
          break;
        }
        case 'graphite': {
          const m = M();
          for (let k = 0; k < 6; k++) add(new A.RoundedBoxGeometry(hx * (1.4 + R() * 0.5), hy * 0.28, hz * (1.3 + R() * 0.5), 1, hy * 0.05), m, (R() - 0.5) * hx * 0.3, -hy + (k + 0.5) * hy * 0.33, (R() - 0.5) * hz * 0.3, [0, R() * 0.6, 0]);
          break;
        }
        case 'flakes': {
          const m = M();
          for (let k = 0; k < 9; k++) {
            const g = new THREE.TetrahedronGeometry(1, 0); g.scale(hx * (0.5 + R() * 0.4), hy * 0.25, hz * (0.4 + R() * 0.4));
            add(g, m, (R() - 0.5) * hx, -hy * 0.6 + R() * hy * 1.2, (R() - 0.5) * hz, [R() * 0.6, R() * 6, R() * 0.6]);
          }
          break;
        }
        case 'stick': add(new THREE.CapsuleGeometry(hy, hx * 2 - hy * 2, 8, 16), M(), 0, 0, 0, [0, 0, Math.PI / 2]); break;
        case 'coil': {
          const pts = [], turns = 7;
          for (let k = 0; k <= 280; k++) { const t = k / 280, a = t * turns * Math.PI * 2; pts.push(new THREE.Vector3(Math.cos(a) * hx * 0.75, -hy + t * hy * 2, Math.sin(a) * hz * 0.75)); }
          add(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 400, Math.min(hx, hz) * 0.08, 8), M());
          break;
        }
        case 'disk': {
          const m = M();
          add(new THREE.CylinderGeometry(hx, hx, hy * 2, 48), m);
          add(new THREE.CylinderGeometry(hx * 0.4, hx * 0.4, hy * 2.02, 32), new THREE.MeshStandardMaterial({ color: 0x33363c, metalness: 0.6, roughness: 0.5 }));
          break;
        }
        case 'cube': add(new A.RoundedBoxGeometry(hx * 2, hy * 2, hz * 2, 2, hx * 0.08), M()); break;
        case 'wafer': add(new THREE.CylinderGeometry(hx, hx, hy * 2, 64), M()); break;
        case 'cake': {
          const g = this.displaced(3, 3, 0.1, 5, true); const m = M();
          add(g, m, 0, -hy * 0.4, 0, null, [hx, hy * 0.7, hz]);
          break;
        }
        case 'rock': {
          const m = new THREE.MeshStandardMaterial({ color: new THREE.Color(look.tint || props.color), roughness: look.tint ? look.rough : 0.9, metalness: 0 });
          if (!look.tint) { const p = this.tex.procedural('rock'); m.map = p.map; m.normalMap = p.normalMap; this.tex.applyPBR(m, 'rock_boulder_dry', 1, { tint: props.color, normalScale: 1.2 }); }
          else if (look.clear) { m.roughness = 0.08; }
          add(this.displaced(seed % 5, 5, 0.25, 1.7, true), m, 0, 0, 0, null, [hx * 1.12, hy * 1.12, hz * 1.12]);
          break;
        }
        case 'plank': {
          const p = this.tex.procedural('wood');
          const m = new THREE.MeshStandardMaterial({ color: 0xffffff, map: p.map, normalMap: p.normalMap, roughness: 0.7 });
          this.tex.applyPBR(m, 'brown_planks_03', 1, { onLoad: () => { for (const k of ['map', 'normalMap', 'roughnessMap', 'aoMap']) if (m[k]) { m[k] = m[k].clone(); m[k].repeat.set(0.2, 1); m[k].offset.set(0.4, 0); m[k].needsUpdate = true; } } });
          add(new A.RoundedBoxGeometry(hx * 2, hy * 2, hz * 2, 2, Math.min(hy, 0.008)), m);
          break;
        }
        case 'glassblock': {
          // A thick slab of float glass: crisp, barely rounded edges; drawn with the scene-refracting glass shader.
          const m = new THREE.MeshPhysicalMaterial({ color: 0xdff3ef, roughness: 0.02, transparent: true, opacity: 0.35, ior: 1.52, clearcoat: 1, depthWrite: false });
          m.userData.wantsGlassShader = true;
          add(new A.RoundedBoxGeometry(hx * 2, hy * 2, hz * 2, 2, Math.min(hx, hy, hz) * 0.04), m);
          break;
        }
        case 'icecube': {
          const ice = spec.shape === 'icecube';
          const m = new THREE.MeshPhysicalMaterial({ color: new THREE.Color(look.tint || (ice ? 0xe4f6ff : 0xdff3f7)), roughness: look.rough != null && look.tint ? look.rough : ice ? 0.12 : 0.02, metalness: 0, transparent: true, opacity: ice ? 0.62 : 0.3, ior: ice ? 1.31 : 1.5, clearcoat: 1, clearcoatRoughness: 0.05, envMapIntensity: 1.6, depthWrite: false });
          add(new A.RoundedBoxGeometry(hx * 2, hy * 2, hz * 2, 3, Math.min(hx, hy, hz) * (ice ? 0.18 : 0.06)), m);
          break;
        }
        case 'tnt': {
          const red = new THREE.MeshStandardMaterial({ color: 0xc8372a, roughness: 0.55 });
          const cyl = new THREE.CylinderGeometry(hz * 0.48, hz * 0.48, hx * 2, 24);
          add(cyl, red, 0, hy * 0.35, 0, [0, 0, Math.PI / 2]); add(cyl, red, 0, -hy * 0.35, hz * 0.5, [0, 0, Math.PI / 2]); add(cyl, red, 0, -hy * 0.35, -hz * 0.5, [0, 0, Math.PI / 2]);
          const tape = new THREE.MeshStandardMaterial({ color: 0x1b1b1b, roughness: 0.4 });
          add(new THREE.BoxGeometry(0.02, hy * 2.05, hz * 2.05), tape, hx * 0.4); add(new THREE.BoxGeometry(0.02, hy * 2.05, hz * 2.05), tape, -hx * 0.4);
          add(new THREE.CylinderGeometry(0.003, 0.003, 0.08), new THREE.MeshStandardMaterial({ color: 0x6b5a3e }), hx + 0.03, hy * 0.35, 0, [0, 0, Math.PI / 2.4]);
          break;
        }
        case 'brick': add(new A.RoundedBoxGeometry(hx * 2, hy * 2, hz * 2, 2, Math.min(hx, hy, hz) * 0.1), new THREE.MeshStandardMaterial({ color: new THREE.Color(props.color), roughness: 0.92, normalMap: this.tex.procedural('concrete').normalMap })); break;
        default: {
          const p = this.tex.procedural('concrete');
          const m = new THREE.MeshStandardMaterial({ color: new THREE.Color(look.tint || 0xffffff), map: p.map, normalMap: p.normalMap, roughness: 0.9 });
          if (!look.tint) this.tex.applyPBR(m, 'concrete_floor_worn_001', 1, {});
          add(new A.RoundedBoxGeometry(hx * 2, hy * 2, hz * 2, 2, Math.min(hx, hy, hz) * 0.05), m);
        }
      }
      return group;
    }

    // A rock that froze out of liquid: a smooth isosurface over the clump's grains (so it keeps the shape the melt
    // had when it set), roughened with noise and dressed as the real material (glassy obsidian, granite-like stone,
    // clear ice, metal…). Local coordinates match the body's centre of mass.
    solidified(mat, props, pts, r) {
      const THREE = this.T, A = this.A;
      let mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9];
      for (const p of pts) for (let a = 0; a < 3; a++) { mn[a] = Math.min(mn[a], p[a]); mx[a] = Math.max(mx[a], p[a]); }
      const pad = r * 2.6, size = Math.max(mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2]) + pad * 2;
      const res = Math.max(20, Math.min(64, Math.round(size / (r * 0.45))));
      const mc = new A.MarchingCubes(res, new THREE.MeshBasicMaterial(), false, false, 200000);
      mc.isolation = 80;
      mc.reset();
      const c = [(mn[0] + mx[0]) / 2, (mn[1] + mx[1]) / 2, (mn[2] + mx[2]) / 2];
      // addBall field: strength / d² − subtract (d in 0..1 cube units); a lone grain's surface sits at ≈1.1 r and
      // neighbouring grains (spacing ≈ 2 r) fuse into one smooth body.
      const subtract = 12, rr = (r * (pts.length < 8 ? 1.0 : 1.3)) / size, strength = rr * rr * (mc.isolation + subtract);
      for (const p of pts) mc.addBall((p[0] - c[0]) / size + 0.5, (p[1] - c[1]) / size + 0.5, (p[2] - c[2]) / size + 0.5, strength, subtract);
      mc.update();
      const n = mc.count, src = mc.geometry.attributes.position.array;
      // Weld the duplicated vertices so the surface shades smoothly.
      const map = new Map(), verts = [], index = new Uint32Array(n);
      for (let i = 0; i < n; i++) {
        const key = Math.round(src[i * 3] * 1e5) + ',' + Math.round(src[i * 3 + 1] * 1e5) + ',' + Math.round(src[i * 3 + 2] * 1e5);
        let v = map.get(key);
        if (v === undefined) { v = verts.length / 3; map.set(key, v); verts.push(src[i * 3], src[i * 3 + 1], src[i * 3 + 2]); }
        index[i] = v;
      }
      mc.geometry.dispose();
      const pos = new Float32Array(verts.length), seed = mat.index * 7.3;
      // Small chips get a strongly irregular, faceted look so they read as broken rock rather than beads.
      const amp = (pts.length < 8 ? 2.2 : 1) * (mat.id === 'obsidian' || mat.id === 'glass' || mat.id === 'water' ? 0.15 : 0.35);
      for (let v = 0; v < verts.length / 3; v++) {
        // MarchingCubes positions are −1..1 across the cube; map back to metres around the clump centre.
        let x = verts[v * 3] * size / 2 + c[0], y = verts[v * 3 + 1] * size / 2 + c[1], z = verts[v * 3 + 2] * size / 2 + c[2];
        const fq = pts.length < 8 ? 22 : 9, nz = PC.fbm(x * fq + seed, y * fq + z * 7, 4) - 0.5;
        const nx = x - c[0], ny = y - c[1], nzz = z - c[2], L = Math.hypot(nx, ny, nzz) || 1;
        pos[v * 3] = x + nx / L * nz * r * amp; pos[v * 3 + 1] = y + ny / L * nz * r * amp; pos[v * 3 + 2] = z + nzz / L * nz * r * amp;
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      geo.setIndex(new THREE.BufferAttribute(index, 1));
      geo.computeVertexNormals();
      // Triplanar-ish UVs from position for the rock textures.
      const uv = new Float32Array((geo.attributes.position.count) * 2), P = geo.attributes.position, N = geo.attributes.normal;
      for (let i = 0; i < P.count; i++) {
        const ax = Math.abs(N.getX(i)), ay = Math.abs(N.getY(i)), az = Math.abs(N.getZ(i));
        const u = ay > ax && ay > az ? [P.getX(i), P.getZ(i)] : ax > az ? [P.getZ(i), P.getY(i)] : [P.getX(i), P.getY(i)];
        uv[i * 2] = u[0] * 3; uv[i * 2 + 1] = u[1] * 3;
      }
      geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
      const group = new THREE.Group();
      const look = this.solidLook(mat, props);
      const mesh = new THREE.Mesh(geo, look);
      if (pts.length < 8) look.flatShading = true; // broken chips: sharp facets
      mesh.castShadow = !look.transparent; mesh.receiveShadow = true;
      group.add(mesh);
      return group;
    }

    solidLook(mat, props) {
      const THREE = this.T, color = new THREE.Color(props && props.color ? props.color : mat.color);
      switch (mat.id) {
        case 'obsidian': {
          // Volcanic glass: near-black, glossy, conchoidal sheen.
          const m = new THREE.MeshPhysicalMaterial({ color: 0x0d0b12, roughness: 0.08, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.06, envMapIntensity: 1.1, sheen: 0.4, sheenColor: new THREE.Color(0x3a2f55) });
          m.normalMap = this.tex.procedural('rock').normalMap; m.normalScale = new THREE.Vector2(0.15, 0.15);
          return m;
        }
        case 'water': case 'co2': return new THREE.MeshPhysicalMaterial({ color: 0xe4f6ff, roughness: 0.1, transparent: true, opacity: 0.6, ior: 1.31, clearcoat: 1, envMapIntensity: 1.5, depthWrite: false });
        case 'glass': return new THREE.MeshPhysicalMaterial({ color: 0xdff3f7, roughness: 0.03, transparent: true, opacity: 0.3, ior: 1.5, clearcoat: 1, envMapIntensity: 1.8, depthWrite: false });
        default: {
          if (mat.metallic && mat.id !== 'obsidian') return new THREE.MeshStandardMaterial({ color, roughness: 0.35, metalness: 1, normalMap: this.tex.procedural('brushed').normalMap, normalScale: new THREE.Vector2(0.2, 0.2) });
          // Stone / basalt / other rock: photo-scanned rock surface tinted to the material.
          // Rock that set from a melt is basalt-dark; other materials keep their own colour.
          const tint = mat.id === 'stone' ? '#5d5a57' : '#' + color.getHexString();
          const m = new THREE.MeshStandardMaterial({ color: new THREE.Color(tint), roughness: 0.92 });
          const p = this.tex.procedural('rock'); m.map = p.map; m.normalMap = p.normalMap;
          this.tex.applyPBR(m, 'rock_boulder_dry', 1, { tint, normalScale: 1.3 });
          return m;
        }
      }
    }

    // A material found with Search: its real 3D model when Poly Haven has one, otherwise a shape that suits what it is,
    // dressed in a matching photo-scanned texture or its real colour; clear crystals and glasses use the glass shader.
    custom(cu, props, dims) {
      const THREE = this.T, A = this.A;
      const spec = PC.modelSpec(PC.MAT[cu.mat], cu.key);
      const [hx, hy, hz] = dims || spec.dims;
      const group = new THREE.Group();
      if (cu.model) {
        // Stand-in shape until the real model has downloaded (first use), then swap in the scan.
        const tmp = this.customShape(cu, props, hx, hy, hz);
        group.add(tmp);
        PC.loadPolyHavenModel(THREE, A, cu.model).then((m) => {
          group.remove(tmp);
          const s = m.scene.clone(true);
          s.scale.set(hx / Math.max(m.half[0], 1e-4), hy / Math.max(m.half[1], 1e-4), hz / Math.max(m.half[2], 1e-4));
          s.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
          group.add(s);
          if (this.onLateMesh) this.onLateMesh(group, s);
        }).catch(() => {}); // keep the stand-in shape if the model can't be downloaded
        return group;
      }
      if (cu.sf) {
        const tmp = this.customShape(cu, props, hx, hy, hz);
        group.add(tmp);
        PC.loadGLBModel(THREE, A, cu.sf.glb).then((m) => {
          group.remove(tmp);
          const s = (A.SkeletonUtils ? A.SkeletonUtils.clone(m.scene) : m.scene.clone(true));
          // Fit the model exactly inside its physics box (uniform scale, centred), measured as drawn.
          s.scale.setScalar(1); s.position.set(0, 0, 0); s.updateMatrixWorld(true);
          const b = PC.measureModel(THREE, s), sz = b.getSize(new THREE.Vector3()), ctr = b.getCenter(new THREE.Vector3());
          const k = Math.min((2 * hx) / Math.max(sz.x, 1e-6), (2 * hy) / Math.max(sz.y, 1e-6), (2 * hz) / Math.max(sz.z, 1e-6));
          s.scale.setScalar(k);
          s.position.copy(ctr).multiplyScalar(-k);
          group.add(s);
          if (this.onLateMesh) this.onLateMesh(group, s);
        }).catch(() => {});
        return group;
      }
      if (cu.stl) {
        // Real scanned shape, dressed in the material's own colour/texture (the scan has no surface colour of its own).
        const tmp = this.customShape(cu, props, hx, hy, hz);
        group.add(tmp);
        PC.loadSTLModel(THREE, A, cu.stl.url).then((m) => {
          // The stand-in's material may already have been swapped by the view (e.g. to the glass shader): use the original.
          const mesh = new THREE.Mesh(m.geo, tmp.userData.origMaterial || tmp.material);
          mesh.scale.set(hx / Math.max(m.half[0], 1e-6), hy / Math.max(m.half[1], 1e-6), hz / Math.max(m.half[2], 1e-6));
          mesh.castShadow = tmp.castShadow; mesh.receiveShadow = true;
          group.remove(tmp); group.add(mesh);
          if (this.onLateMesh) this.onLateMesh(group, mesh);
        }).catch(() => {});
        return group;
      }
      group.add(this.customShape(cu, props, hx, hy, hz));
      return group;
    }

    customShape(cu, props, hx, hy, hz) {
      const THREE = this.T, A = this.A, look = cu.look || {};
      const clear = cu.cls === 'glass' || (cu.cls === 'rock' && /colou?rless|transparent|clear/.test((cu.description + ' ' + (cu.extract || '')).toLowerCase()));
      let geo;
      switch (cu.shape) {
        case 'ingot': { geo = new A.RoundedBoxGeometry(hx * 2, hy * 2, hz * 2, 3, Math.min(hx, hy, hz) * 0.12); const p = geo.attributes.position; for (let k = 0; k < p.count; k++) if (p.getY(k) > 0) { p.setX(k, p.getX(k) * 0.82); p.setZ(k, p.getZ(k) * 0.78); } geo.computeVertexNormals(); break; }
        case 'glassblock': geo = new A.RoundedBoxGeometry(hx * 2, hy * 2, hz * 2, 2, Math.min(hx, hy, hz) * 0.04); break;
        case 'block': geo = new A.RoundedBoxGeometry(hx * 2, hy * 2, hz * 2, 3, Math.min(hx, hy, hz) * 0.12); break;
        case 'cake': geo = this.displaced(5, 3, 0.12, 1.4, true); break;
        default:
          if (clear) {
            // Brilliant-cut gem: crown + pavilion cones (the glass shader gives it refraction and fire-like glints).
            const crown = new THREE.CylinderGeometry(0.62, 1, 0.42, 16, 1); crown.translate(0, 0.21, 0);
            const pav = new THREE.ConeGeometry(1, 0.86, 16, 1); pav.rotateX(Math.PI); pav.translate(0, -0.43, 0);
            geo = PC.mergeGeometries(THREE, [crown, pav]);
            geo.computeVertexNormals();
          } else geo = this.displaced((cu.key.length * 7) % 11, 4, cu.shape === 'rock' ? 0.3 : 0.16, cu.shape === 'rock' ? 1.8 : 1.3, true);
      }
      let m;
      if (clear) { m = new THREE.MeshPhysicalMaterial({ color: 0xffffff, transparent: true, opacity: 0.35, roughness: 0.02 }); m.userData.wantsGlassShader = true; }
      else {
        m = new THREE.MeshStandardMaterial({ color: new THREE.Color(props && props.color ? props.color : '#999999'), roughness: look.rough != null ? look.rough : 0.6, metalness: look.metal || 0 });
        if (cu.texture) this.tex.applyPBR(m, cu.texture, 1, { tint: props && props.color && cu.cls !== 'rock' ? props.color : null, normalScale: 1.4 });
        else if (cu.cls === 'rock') { const r = this.tex.procedural('rock'); m.map = r.map; m.normalMap = r.normalMap; this.tex.applyPBR(m, 'rock_boulder_dry', 1, { tint: props && props.color, normalScale: 1.3 }); }
        else if (look.metal > 0.5) { m.normalMap = this.tex.procedural('brushed').normalMap; m.normalScale = new THREE.Vector2(0.2, 0.2); }
        else { const r = this.tex.procedural('rock'); m.normalMap = r.normalMap; m.normalScale = new THREE.Vector2(0.4, 0.4); }
      }
      const mesh = new THREE.Mesh(geo, m);
      if (!['ingot', 'glassblock', 'block'].includes(cu.shape)) mesh.scale.set(hx, hy, hz);
      mesh.castShadow = !clear; mesh.receiveShadow = true;
      return mesh;
    }

    // Working devices assembled from ingredients (see core/inventions.js). Parts that light up are tagged
    // userData.glow (emissive colour driven by the invention's state); the thermometer's mercury is userData.column.
    invention(key, dims) {
      const THREE = this.T, A = this.A, inv = PC.INVENTION[key];
      const [hx, hy, hz] = dims || inv.dims;
      const group = new THREE.Group();
      const add = (geo, m, x, y, z, rot) => {
        const mesh = new THREE.Mesh(geo, m);
        mesh.position.set(x || 0, y || 0, z || 0);
        if (rot) mesh.rotation.set(rot[0], rot[1], rot[2]);
        mesh.castShadow = !m.transparent; mesh.receiveShadow = true;
        group.add(mesh);
        return mesh;
      };
      const std = (color, rough, metal, extra) => new THREE.MeshStandardMaterial(Object.assign({ color, roughness: rough, metalness: metal || 0 }, extra || {}));
      const glass = () => new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.03, metalness: 0, transparent: true, opacity: 0.22, clearcoat: 1, clearcoatRoughness: 0.03, ior: 1.5, envMapIntensity: 1.8, depthWrite: false, side: THREE.DoubleSide });
      const glow = (color) => { const m = std(color, 0.4, 0, { emissive: new THREE.Color(color), emissiveIntensity: 0 }); m.userData.glowColor = color; return m; };
      const brushed = this.tex.procedural('brushed').normalMap;
      const steel = std(0xc9ced4, 0.3, 1, { normalMap: brushed, normalScale: new THREE.Vector2(0.2, 0.2) });
      switch (key) {
        case 'battery': {
          // Cylindrical cell: printed wrapper, zinc can bottom, copper-plated positive nub.
          const r = hx, h = hy * 2;
          add(new THREE.CylinderGeometry(r, r, h * 0.92, 40), std(0x1d2a44, 0.35, 0.2), 0, -h * 0.02, 0);
          add(new THREE.CylinderGeometry(r * 1.004, r * 1.004, h * 0.3, 40, 1, true), std(0xd4a43a, 0.3, 0.9), 0, h * 0.27, 0);
          add(new THREE.CylinderGeometry(r * 0.96, r * 0.96, h * 0.05, 40), steel, 0, -h * 0.47, 0);
          add(new THREE.CylinderGeometry(r * 0.94, r * 0.94, h * 0.04, 40), std(0xb87333, 0.3, 1), 0, h * 0.46, 0);
          add(new THREE.CylinderGeometry(r * 0.3, r * 0.3, h * 0.06, 24), std(0xb87333, 0.25, 1), 0, h * 0.5, 0);
          const led = add(new THREE.SphereGeometry(r * 0.12, 12, 8), glow('#7fd0ff'), r * 0.98, h * 0.05, 0); led.userData.glow = true;
          break;
        }
        case 'bulb': {
          // Pear-shaped glass envelope, brass Edison screw, glowing tungsten coil.
          const pts = [];
          for (let k = 0; k <= 24; k++) { const t = k / 24, a = t * Math.PI; pts.push(new THREE.Vector2(Math.max(0.0005, Math.sin(a) * hx * (t > 0.6 ? 1 : 0.55 + 0.45 * Math.sin(t / 0.6 * Math.PI / 2))), -hy * 0.35 + hy * 1.35 * (1 - Math.cos(a)) / 2)); }
          add(new THREE.LatheGeometry(pts, 40), glass(), 0, 0, 0);
          const brass = std(0xc8a24a, 0.3, 1);
          for (let k = 0; k < 5; k++) add(new THREE.TorusGeometry(hx * 0.42, hx * 0.06, 8, 32), brass, 0, -hy * 0.42 - k * hy * 0.1, 0, [Math.PI / 2, 0, 0]);
          add(new THREE.CylinderGeometry(hx * 0.42, hx * 0.32, hy * 0.5, 32), brass, 0, -hy * 0.62, 0);
          add(new THREE.CylinderGeometry(hx * 0.14, hx * 0.14, hy * 0.08, 16), std(0x222222, 0.5), 0, -hy * 0.9, 0);
          const wire = std(0x9a9a9a, 0.4, 1);
          for (const sx of [-1, 1]) add(new THREE.CylinderGeometry(0.0006, 0.0006, hy * 0.75, 6), wire, sx * hx * 0.18, 0, 0);
          const coil = add(new THREE.TorusGeometry(hx * 0.18, 0.0012, 6, 40, Math.PI * 1.2), glow('#ffd59a'), 0, hy * 0.36, 0, [0, 0, Math.PI * -0.1]);
          coil.userData.glow = true; coil.userData.light = '#ffcf8a';
          break;
        }
        case 'neon': {
          // Bent glass tube on a dark backing plate, gas glowing in its emission colour.
          const curve = new THREE.CatmullRomCurve3([[-0.9, -0.2], [-0.6, 0.5], [-0.3, -0.4], [0, 0.5], [0.3, -0.4], [0.6, 0.5], [0.9, -0.2]].map(([x, y]) => new THREE.Vector3(x * hx, y * hy, 0)));
          const tube = new THREE.TubeGeometry(curve, 80, Math.min(hy, hz) * 0.18, 10);
          const t = add(tube, glow('#ff5030'), 0, 0, 0); t.userData.glow = true; t.userData.always = true; t.userData.light = '#ff5030';
          add(new THREE.TubeGeometry(curve, 80, Math.min(hy, hz) * 0.26, 10), glass(), 0, 0, 0);
          add(new A.RoundedBoxGeometry(hx * 2.1, hy * 2.1, hz * 0.4, 2, 0.004), std(0x111317, 0.6, 0.3), 0, 0, -hz * 0.7);
          for (const sx of [-0.9, 0.9]) add(new THREE.CylinderGeometry(hz * 0.3, hz * 0.3, hy * 0.25, 12), steel, sx * hx, -0.2 * hy - hy * 0.12, 0);
          break;
        }
        case 'magnet': {
          // Red horseshoe magnet with nickel-plated pole pieces.
          const R = hx * 0.62, r = hx * 0.3;
          add(new THREE.TorusGeometry(R, r, 20, 40, Math.PI), std(0xc0262b, 0.35, 0.3), 0, -hy * 0.1 + R * 0.2, 0, [0, 0, 0]);
          for (const sx of [-1, 1]) {
            add(new THREE.CylinderGeometry(r, r, hy * 0.7, 20), std(0xc0262b, 0.35, 0.3), sx * R, -hy * 0.38 + R * 0.2, 0);
            add(new THREE.CylinderGeometry(r * 1.01, r * 1.01, hy * 0.35, 20), steel, sx * R, -hy * 0.85 + R * 0.2, 0);
          }
          break;
        }
        case 'rocket': {
          const r = hx * 0.8, white = std(0xf1f2f4, 0.35, 0.1), red = std(0xc8272c, 0.4, 0.2);
          add(new THREE.CylinderGeometry(r, r, hy * 1.3, 32), white, 0, -hy * 0.1, 0);
          add(new THREE.CylinderGeometry(r * 1.005, r * 1.005, hy * 0.12, 32), red, 0, hy * 0.3, 0);
          add(new THREE.ConeGeometry(r, hy * 0.5, 32), red, 0, hy * 0.75, 0);
          add(new THREE.CylinderGeometry(r * 0.55, r * 0.8, hy * 0.18, 24, 1, true), std(0x3a3a3a, 0.5, 0.9, { side: THREE.DoubleSide }), 0, -hy * 0.85, 0);
          const finShape = new THREE.Shape([new THREE.Vector2(0, 0), new THREE.Vector2(hx * 1.0, -hy * 0.2), new THREE.Vector2(hx * 1.0, -hy * 0.05), new THREE.Vector2(0, hy * 0.3)]);
          const fg = new THREE.ExtrudeGeometry(finShape, { depth: 0.002, bevelEnabled: false });
          for (let k = 0; k < 4; k++) { const m = add(fg, red, 0, -hy * 0.72, 0, [0, k * Math.PI / 2, 0]); m.position.x = Math.cos(k * Math.PI / 2) * r * 0.9; m.position.z = -Math.sin(k * Math.PI / 2) * r * 0.9; }
          const port = add(new THREE.CircleGeometry(r * 0.3, 20), std(0x6fb6ff, 0.05, 0.2), 0, hy * 0.05, r * 1.002); port.rotation.set(0, 0, 0);
          break;
        }
        case 'firework': {
          const r = hx * 0.9;
          add(new THREE.CylinderGeometry(r, r, hy * 1.2, 24), std(0xb3202a, 0.7), 0, -hy * 0.1, 0);
          for (let k = 0; k < 3; k++) add(new THREE.CylinderGeometry(r * 1.01, r * 1.01, hy * 0.05, 24, 1, true), std(0xf2d27a, 0.4, 0.6), 0, -hy * 0.5 + k * hy * 0.35, 0);
          add(new THREE.ConeGeometry(r * 1.05, hy * 0.45, 24), std(0xe8e2d0, 0.8), 0, hy * 0.72, 0);
          add(new THREE.CylinderGeometry(0.0015, 0.0015, hy * 0.35), std(0x50402a, 0.9), r * 0.4, hy * 0.98, 0, [0, 0, -0.4]);
          add(new THREE.CylinderGeometry(0.002, 0.002, hy * 0.9), std(0xa98a5a, 0.9), r * 1.15, -hy * 0.6, 0);
          break;
        }
        case 'campfire': {
          // Ring of stones around crossed, charred logs.
          const stone = new THREE.MeshStandardMaterial({ color: 0x8a8780, roughness: 0.95, normalMap: this.tex.procedural('rock').normalMap });
          for (let k = 0; k < 11; k++) {
            const a = k / 11 * Math.PI * 2;
            add(this.displaced(k % 7, 2, 0.25, 1.4, true), stone, Math.cos(a) * hx * 0.85, -hy * 0.35, Math.sin(a) * hz * 0.85, [0, a, 0]).scale.set(hx * 0.16, hy * 0.55, hx * 0.13);
          }
          const bark = std(0x3b2a1c, 0.95), char = std(0x1a1512, 1, 0, { emissive: new THREE.Color('#ff5a1a'), emissiveIntensity: 0 });
          char.userData.glowColor = '#ff5a1a';
          // Log-cabin crib: two layers of two logs, the lower layer charred and glowing from beneath.
          const logGeo = new THREE.CylinderGeometry(hy * 0.2, hy * 0.24, hx * 1.15, 12);
          for (let k = 0; k < 4; k++) {
            const layer = k >> 1, side = k & 1 ? 1 : -1, yaw = layer ? Math.PI / 2 : 0;
            const x = layer ? side * hx * 0.22 : 0, z = layer ? 0 : side * hz * 0.22;
            const log = add(logGeo, layer ? bark : char, x, -hy * 0.7 + layer * hy * 0.4, z, [0, yaw, Math.PI / 2]);
            if (!layer) { log.userData.glow = true; log.userData.always = true; log.userData.soft = true; }
          }
          const embers = add(new THREE.CircleGeometry(hx * 0.45, 24), char, 0, -hy * 0.95, 0, [-Math.PI / 2, 0, 0]); embers.userData.glow = true; embers.userData.always = true; embers.userData.light = '#ff7a2a';
          break;
        }
        case 'solar': {
          // Monocrystalline cells (dark blue with silver busbars) under glass in an aluminium frame.
          const cv = document.createElement('canvas'); cv.width = 256; cv.height = 180;
          const c = cv.getContext('2d');
          c.fillStyle = '#d8dde2'; c.fillRect(0, 0, 256, 180);
          for (let i = 0; i < 6; i++) for (let j = 0; j < 4; j++) {
            const x = 6 + i * 41.5, y = 6 + j * 42;
            const gr = c.createLinearGradient(x, y, x + 40, y + 40); gr.addColorStop(0, '#16233f'); gr.addColorStop(1, '#0c1630');
            c.fillStyle = gr; c.fillRect(x, y, 39, 40);
            c.fillStyle = '#9aa6b5'; for (let b = 1; b < 4; b++) c.fillRect(x + b * 10, y, 1, 40);
            c.fillStyle = '#26365a'; for (let b = 1; b < 12; b++) c.fillRect(x, y + b * 3.4, 39, 0.5);
          }
          const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
          const cells = new THREE.MeshPhysicalMaterial({ map: tex, roughness: 0.25, metalness: 0.2, clearcoat: 1, clearcoatRoughness: 0.02, envMapIntensity: 1.2 });
          add(new THREE.BoxGeometry(hx * 1.94, hy * 1.2, hz * 1.94), cells, 0, 0, 0);
          const fr = std(0xc6ccd2, 0.35, 1, { normalMap: brushed });
          add(new THREE.BoxGeometry(hx * 2, hy * 1.6, hz * 0.06), fr, 0, 0, hz * 0.97); add(new THREE.BoxGeometry(hx * 2, hy * 1.6, hz * 0.06), fr, 0, 0, -hz * 0.97);
          add(new THREE.BoxGeometry(hx * 0.06, hy * 1.6, hz * 2), fr, hx * 0.97, 0, 0); add(new THREE.BoxGeometry(hx * 0.06, hy * 1.6, hz * 2), fr, -hx * 0.97, 0, 0);
          const led = add(new THREE.SphereGeometry(hy * 0.3, 10, 8), glow('#7dff8a'), hx * 0.9, hy * 0.9, hz * 0.9); led.userData.glow = true;
          break;
        }
        case 'thermometer': {
          const r = hx;
          add(new THREE.CylinderGeometry(r, r, hy * 1.8, 20, 1, false), glass(), 0, hy * 0.08, 0);
          add(new THREE.SphereGeometry(r * 1.35, 20, 14), glass(), 0, -hy * 0.85, 0);
          const hg = std(0xd6d9dc, 0.12, 1);
          add(new THREE.SphereGeometry(r * 1.15, 20, 14), hg, 0, -hy * 0.85, 0);
          const colGeo = new THREE.CylinderGeometry(r * 0.32, r * 0.32, 1, 10); colGeo.translate(0, 0.5, 0);
          const col = add(colGeo, hg, 0, -hy * 0.8, 0); col.userData.column = { base: hy * 0.05, max: hy * 1.65 }; col.scale.y = hy * 0.4;
          const mark = std(0x222222, 0.6);
          for (let k = 0; k < 9; k++) add(new THREE.BoxGeometry(r * (k % 2 ? 0.5 : 0.9), 0.0008, 0.0006), mark, r * 0.7, -hy * 0.6 + k * hy * 0.17, r * 0.72);
          break;
        }
      }
      return group;
    }
  }

  PC.ModelKit = ModelKit;
})(window.PC);
