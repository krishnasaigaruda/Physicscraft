// Per-material 3D grain models. Each simulation particle of a powder or loose solid is drawn as a
// clump of small pieces whose shape and surface match the substance: salt cubes, sand grains, soil
// clods, charcoal granules, metal filings, rust flakes, ice chips, glass shards, rubble…
(function (PC) {
  'use strict';

  // Material id / tag → grain style.
  PC.grainStyle = function (m) {
    const id = m.id;
    if (['salt', 'metal_chloride', 'fluoride'].includes(id)) return 'fine';
    if (id === 'charcoal') return 'granule';
    if (id === 'S') return 'fine';
    if (id === 'I' || id === 'P') return 'crystal';
    if (id === 'sand' || id === 'glass_sand') return 'sand';
    if (id === 'earth' || id === 'mud' || id === 'brick') return 'soil';
    if (id === 'ash' || id === 'p4o10') return 'fine';
    if (id === 'gunpowder' || id === 'C' || id === 'B' || id === 'Se' || id === 'As') return 'granule';
    if (['thermite', 'rust', 'alumina', 'mgo', 'metal_oxide', 'quicklime', 'slaked_lime'].includes(id)) return 'fine';
    if (id === 'water' || id === 'brine' || id === 'co2') return 'ice';
    if (id === 'glass') return 'shard';
    if (m.metallic || (m.el && m.el.metal)) return 'metal';
    if (m.tags.has('rock')) return 'rock';
    // Frozen liquids and gases (solid nitrogen, oxygen ice, frozen oil…) look like clear crystalline ice.
    if ((m.el && m.el.state !== 'Solid') || ['oil', 'acid', 'lye', 'nitro', 'methane', 'ammonia', 'hcl', 'so2', 'antimatter'].includes(id)) return 'ice';
    return 'rock';
  };

  const STYLES = {
    crystal: { pieces: 9, size: [0.012, 0.022], shape: 'box', spread: 0.032, mat: { roughness: 0.4, clearcoat: 0.2, clearcoatRoughness: 0.3, envMapIntensity: 0.4, physical: true } },
    // Fine materials: soft overlapping mounds wearing photo-scanned grain textures (real grain scale).
    sand: { pieces: 3, size: [0.07, 0.085], shape: 'mound', spread: 0.014, tex: 'coast_sand_01', mat: { roughness: 1, envMapIntensity: 0.35 } },
    soil: { pieces: 3, size: [0.07, 0.085], shape: 'mound', spread: 0.014, tex: 'farm_soil', mat: { roughness: 1, envMapIntensity: 0.3 } },
    fine: { pieces: 3, size: [0.07, 0.085], shape: 'mound', spread: 0.014, tex: 'coast_sand_01', gray: true, mat: { roughness: 0.75, envMapIntensity: 0.4 } },
    ash: { pieces: 16, size: [0.006, 0.014], shape: 'flake', spread: 0.035, mat: { roughness: 1, envMapIntensity: 0.3 } },
    granule: { pieces: 18, size: [0.006, 0.011], shape: 'pebble', spread: 0.035, mat: { roughness: 0.75, envMapIntensity: 0.45 } },
    powder: { pieces: 26, size: [0.005, 0.009], shape: 'clod', spread: 0.036, mat: { roughness: 1, envMapIntensity: 0.3 } },
    ice: { pieces: 4, size: [0.02, 0.03], shape: 'chunk', spread: 0.022, mat: { roughness: 0.06, clearcoat: 1, envMapIntensity: 0.9, physical: true } },
    shard: { pieces: 6, size: [0.012, 0.026], shape: 'shard', spread: 0.028, mat: { roughness: 0.04, clearcoat: 1, envMapIntensity: 1.1, physical: true } },
    metal: { pieces: 7, size: [0.01, 0.02], shape: 'chunk', spread: 0.028, mat: { roughness: 0.38, metalness: 1, envMapIntensity: 0.9 } },
    rock: { pieces: 5, size: [0.016, 0.028], shape: 'chunk', spread: 0.026, mat: { roughness: 0.92, envMapIntensity: 0.4 } },
  };
  PC.GRAIN_STYLES = Object.keys(STYLES);
  PC.grainTexture = (style) => STYLES[style] && STYLES[style].tex ? { id: STYLES[style].tex, gray: !!STYLES[style].gray } : null;

  function rng(seed) { let s = seed >>> 0 || 1; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }

  // Builds one merged clump geometry (non-indexed) for a style.
  PC.grainGeometry = function (THREE, style) {
    const st = STYLES[style], R = rng(style.length * 977 + 13), parts = [];
    for (let k = 0; k < st.pieces; k++) {
      const sz = st.size[0] + R() * (st.size[1] - st.size[0]);
      let g;
      switch (st.shape) {
        case 'box': g = new THREE.BoxGeometry(sz, sz * (0.8 + R() * 0.4), sz * (0.8 + R() * 0.4)); break;
        case 'mound': g = smoothBlob(THREE, sz * 0.6, 3, R, 0.1); g.scale(1, 0.62, 1); break;
        case 'pebble': g = smoothBlob(THREE, sz * 0.6, 2, R, 0.12); g.scale(1, 0.7 + R() * 0.3, 0.85 + R() * 0.3); break;
        case 'clod': g = smoothBlob(THREE, sz * 0.6, 2, R, 0.3); g.scale(1 + R() * 0.3, 0.7 + R() * 0.3, 1); break;
        case 'flake': g = new THREE.BoxGeometry(sz, sz * 0.18, sz * (0.6 + R() * 0.6)); break;
        case 'shard': g = new THREE.TetrahedronGeometry(sz * 0.7, 0); g.scale(1, 0.35 + R() * 0.3, 1.6); break;
        default: g = smoothBlob(THREE, sz * 0.6, 2, R, 0.22); g.scale(1, 0.85, 1);
      }
      if (g.index) g = g.toNonIndexed();
      if (!g.attributes.normal || st.shape === 'box' || st.shape === 'flake' || st.shape === 'shard') g.computeVertexNormals();
      g.rotateX(R() * 6.28); g.rotateY(R() * 6.28); g.rotateZ(R() * 6.28);
      // Pieces spread in a flattened ball so neighbouring clumps knit into a continuous pile.
      const a = R() * 6.28, u = R() * 2 - 1, d = Math.cbrt(R()) * st.spread;
      g.translate(Math.cos(a) * Math.sqrt(1 - u * u) * d, u * d * 0.7, Math.sin(a) * Math.sqrt(1 - u * u) * d);
      parts.push(g);
    }
    let count = 0;
    for (const g of parts) count += g.attributes.position.count;
    const pos = new Float32Array(count * 3), nor = new Float32Array(count * 3), uv = new Float32Array(count * 2);
    let o = 0, u = 0;
    for (const g of parts) {
      pos.set(g.attributes.position.array, o); nor.set(g.attributes.normal.array, o); o += g.attributes.position.array.length;
      if (g.attributes.uv) uv.set(g.attributes.uv.array, u);
      u += g.attributes.position.count * 2;
      g.dispose();
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.computeBoundingSphere();
    return geo;
  };

  // Smooth, gently irregular pebble: noise-displaced sphere with smooth (radial) normals.
  function smoothBlob(THREE, r, detail, R, amp) {
    const g = new THREE.IcosahedronGeometry(r, detail), p = g.attributes.position, n = new Float32Array(p.count * 3);
    const ph = [R() * 9, R() * 9, R() * 9];
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i) / r, y = p.getY(i) / r, z = p.getZ(i) / r;
      const f = 1 + amp * (Math.sin(x * 2.3 + ph[0]) * Math.sin(y * 2.9 + ph[1]) * Math.sin(z * 2.1 + ph[2]));
      p.setXYZ(i, x * r * f, y * r * f, z * r * f);
      n[i * 3] = x; n[i * 3 + 1] = y; n[i * 3 + 2] = z;
    }
    g.setAttribute('normal', new THREE.BufferAttribute(n, 3));
    return g;
  }

  PC.grainMaterial = function (THREE, style) {
    const m = STYLES[style].mat;
    const opts = { roughness: m.roughness, metalness: m.metalness || 0, envMapIntensity: m.envMapIntensity };
    if (m.physical) return new THREE.MeshPhysicalMaterial(Object.assign(opts, { clearcoat: m.clearcoat || 0, clearcoatRoughness: m.clearcoatRoughness || 0.1 }));
    return new THREE.MeshStandardMaterial(opts);
  };

  // 128 random rotation matrices (3×3, row-major) for per-instance variety.
  PC.grainRotations = (function () {
    const out = [], R = rng(4242);
    for (let k = 0; k < 128; k++) {
      let x = R() * 2 - 1, y = R() * 2 - 1, z = R() * 2 - 1, w = R() * 2 - 1;
      const l = Math.hypot(x, y, z, w) || 1; x /= l; y /= l; z /= l; w /= l;
      out.push([1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w), 2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w), 2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)]);
    }
    return out;
  })();
})(window.PC);
