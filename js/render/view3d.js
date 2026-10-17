// 3D view: Three.js renderer, HDRI garden environment, sun + soft shadows, textured ground and scenery,
// PBR meshes for rigid bodies and containers, instanced grains, smoke/fire sprites, screen-space fluids,
// explosion lights/shockwaves/sparks, bloom and anti-aliasing.
(function (PC) {
  'use strict';
  const { SOLID, POWDER, LIQUID, GAS } = PC.PHASE;
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

  const LAYER_OPAQUE = 0, LAYER_TRANSPARENT = 1;

  function blackbody(T) {
    const t = Math.max(1000, T) / 100;
    let r, g, b;
    if (t <= 66) { r = 255; g = 99.47 * Math.log(t) - 161.12; b = t <= 19 ? 0 : 138.52 * Math.log(t - 10) - 305.04; }
    else { r = 329.7 * Math.pow(t - 60, -0.1332); g = 288.12 * Math.pow(t - 60, -0.0755); b = 255; }
    return [clamp(r, 0, 255) / 255, clamp(g, 0, 255) / 255, clamp(b, 0, 255) / 255];
  }
  const BB = []; for (let k = 0; k <= 400; k++) BB.push(blackbody(k * 50));
  const bb = (T) => BB[clamp((T / 50) | 0, 0, 400)];
  PC.blackbody = bb;
  const THERMAL = [[0, [20, 16, 60]], [100, [60, 70, 220]], [250, [70, 190, 255]], [293, [60, 210, 140]], [400, [240, 220, 60]], [800, [255, 120, 30]], [1500, [255, 40, 50]], [3000, [255, 170, 240]], [10000, [255, 255, 255]]];
  function thermal(T, out) {
    for (let k = 1; k < THERMAL.length; k++) if (T <= THERMAL[k][0]) {
      const [t0, c0] = THERMAL[k - 1], [t1, c1] = THERMAL[k], f = (T - t0) / (t1 - t0);
      out[0] = (c0[0] + (c1[0] - c0[0]) * f) / 255; out[1] = (c0[1] + (c1[1] - c0[1]) * f) / 255; out[2] = (c0[2] + (c1[2] - c0[2]) * f) / 255;
      return out;
    }
    out[0] = out[1] = out[2] = 1; return out;
  }
  PC.thermalRGB = thermal;
  const srgbToLin = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));

  class View3D {
    constructor(canvas, sim, settings, THREE, A) {
      this.canvas = canvas; this.sim = sim; this.s = settings; this.THREE = THREE; this.A = A;
      this.time = 0; this.frame = 0;
      this.meshes = new Map();
      this.selected = null;
      this.mouse = null;
      this.shake = 0;
      this.labels = [];
      this.linCache = new Map();
      this.initRenderer();
      this.tex = new PC.Textures(THREE, this.renderer);
      this.models = new PC.ModelKit(THREE, A, this.tex);
      this.initScene();
      this.initGround();
      this.initParticles();
      this.initFx();
      this.weather = new PC.Weather(this);
      this.fluid = new PC.FluidFX(this);
      this.ripples = new PC.RippleSim(this);
      // Fine powders (sand, salt, soil, ash…) render as one continuous grainy surface.
      this.powderFx = new PC.FluidFX(this, { mode: 'grain' });
      this.grainTex = {};
      this.tex.applyGrainTexture(this.grainTex, 'coast_sand_01', 1);
      this.surfaceStyle = { sand: 1, soil: 1, fine: 1 };
      this.piles = new PC.PileSurfaces(this);
      this.pileLists = { sand: [], soil: [], fine: [], mud: [] };
      // Per material: which pile surface a powder uses, whether it is a powder, whether it is mud.
      this.pileOf = PC.MATS.map((m) => (['sand', 'glass_sand'].includes(m.id) ? 'sand' : ['earth', 'brick'].includes(m.id) ? 'soil' : 'fine'));
      this.matPowder = PC.MATS.map((m) => (m.powder ? 1 : 0));
      this.matMud = PC.MATS.map((m) => (m.id === 'mud' ? 1 : 0));
      // Moving powder (pouring, falling, blown) is drawn as a haze of individual tiny grains, like real falling sand.
      {
        const cap = 90000, geo = new THREE.BufferGeometry();
        this.hazePos = new Float32Array(cap * 3); this.hazeCol = new Float32Array(cap * 3); this.hazeCap = cap;
        geo.setAttribute('position', new THREE.BufferAttribute(this.hazePos, 3).setUsage(THREE.DynamicDrawUsage));
        geo.setAttribute('color', new THREE.BufferAttribute(this.hazeCol, 3).setUsage(THREE.DynamicDrawUsage));
        geo.setDrawRange(0, 0);
        this.haze = new THREE.Points(geo, new THREE.PointsMaterial({ size: 0.0045, sizeAttenuation: true, vertexColors: true }));
        this.haze.frustumCulled = false;
        this.scene.add(this.haze);
        // Per-grain offsets inside a particle's volume (128 variants × 40 grains), plus per-grain shade.
        const R = (() => { let q = 99991; return () => { q = (q * 1664525 + 1013904223) >>> 0; return q / 4294967296; }; })();
        this.hazeOff = new Float32Array(128 * 40 * 4);
        for (let k = 0; k < 128 * 40; k++) {
          let x, y, z; do { x = R() * 2 - 1; y = R() * 2 - 1; z = R() * 2 - 1; } while (x * x + y * y + z * z > 1);
          this.hazeOff[k * 4] = x; this.hazeOff[k * 4 + 1] = y; this.hazeOff[k * 4 + 2] = z; this.hazeOff[k * 4 + 3] = 0.72 + R() * 0.5;
        }
      }
      // Invisible spheres that only render into the shadow map, so powder piles cast shadows.
      {
        const cap = this.sim.fluid.cap;
        const m = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false });
        this.powderCasters = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(this.sim.fluid.r * 1.0, 1), m, cap);
        this.powderCasters.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        this.powderCasters.castShadow = true; this.powderCasters.receiveShadow = false; this.powderCasters.frustumCulled = false; this.powderCasters.count = 0;
        this.scene.add(this.powderCasters);
      }
      this.initPost();
      this.applyEnvironment();
      if (settings.scenery) this.loadScenery();
    }

    // ------------------------------------------------------------------ setup
    initRenderer() {
      const THREE = this.THREE;
      const r = this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: false, powerPreference: 'high-performance', stencil: false });
      r.outputColorSpace = THREE.SRGBColorSpace;
      r.toneMapping = THREE.ACESFilmicToneMapping;
      r.toneMappingExposure = this.s.exposure;
      r.shadowMap.enabled = true;
      r.shadowMap.type = THREE.PCFSoftShadowMap;
      r.shadowMap.autoUpdate = false;
      r.autoClear = false;
      this.pmrem = new THREE.PMREMGenerator(r);
    }

    initScene() {
      const THREE = this.THREE, A = this.A;
      const scene = this.scene = new THREE.Scene();
      const cam = this.camera = new THREE.PerspectiveCamera(42, 1, 0.05, 400);
      cam.position.set(0, 2.4, 4.4);
      const ctl = this.controls = new A.OrbitControls(cam, this.canvas);
      ctl.target.set(0, 0.2, -0.3);
      ctl.enableDamping = true; ctl.dampingFactor = 0.08;
      ctl.mouseButtons = { LEFT: null, MIDDLE: THREE.MOUSE.PAN, RIGHT: THREE.MOUSE.ROTATE };
      ctl.touches = { ONE: null, TWO: THREE.TOUCH.DOLLY_ROTATE };
      ctl.maxPolarAngle = Math.PI * 0.49; ctl.minDistance = 0.35; ctl.maxDistance = 35;
      ctl.screenSpacePanning = false; ctl.zoomToCursor = true;
      ctl.update();

      const sun = this.sun = new THREE.DirectionalLight(0xfff1dc, 3.2);
      sun.castShadow = true;
      sun.shadow.bias = -0.0002; sun.shadow.normalBias = 0.015;
      sun.shadow.camera.layers.enable(LAYER_TRANSPARENT);
      scene.add(sun, sun.target);
      this.hemi = new THREE.HemisphereLight(0xbfd8ff, 0x3b3226, 0.15);
      scene.add(this.hemi);
      this.sunDir = new THREE.Vector3(0.4, 0.8, 0.3).normalize();
      this.sunColor = new THREE.Color(1, 0.95, 0.86);
      this.applyShadowQuality();
      this.raycaster = new THREE.Raycaster();
      this.raycaster.layers.enableAll();
    }

    applyShadowQuality() {
      const q = this.s.shadows, sz = q === 'ultra' ? 4096 : q === 'high' ? 2048 : 1024;
      this.sun.castShadow = q !== 'off';
      if (this.sun.shadow.mapSize.x !== sz) {
        this.sun.shadow.mapSize.set(sz, sz);
        if (this.sun.shadow.map) { this.sun.shadow.map.dispose(); this.sun.shadow.map = null; }
      }
      this.sun.shadow.radius = 3;
    }

    // Workspace terrace (granite tiles with an optional measuring grid) inside a mossy garden floor.
    initGround() {
      const THREE = this.THREE, s = this.s;
      const W = s.worldWidth, D = s.worldDepth;
      const proc = this.tex.procedural('concrete');
      const terraceMat = new THREE.MeshStandardMaterial({ color: 0xb9b6ae, map: proc.map, normalMap: proc.normalMap, roughness: 0.75 });
      this.gridUniforms = { uGrid: { value: s.grid ? 1 : 0 } };
      terraceMat.onBeforeCompile = (sh) => {
        sh.uniforms.uGrid = this.gridUniforms.uGrid;
        sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vWorldP;')
          .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWorldP = (modelMatrix * vec4(transformed, 1.0)).xyz;');
        sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vWorldP; uniform float uGrid;')
          .replace('#include <dithering_fragment>', `#include <dithering_fragment>
            if (uGrid > 0.5) {
              vec2 g = abs(fract(vWorldP.xz + 0.5) - 0.5) / fwidth(vWorldP.xz);
              float line = 1.0 - min(min(g.x, g.y), 1.0);
              vec2 g2 = abs(fract(vWorldP.xz * 10.0 + 0.5) - 0.5) / fwidth(vWorldP.xz * 10.0);
              float fine = (1.0 - min(min(g2.x, g2.y), 1.0)) * 0.25 * smoothstep(3.0, 1.0, length(fwidth(vWorldP.xz)) * 60.0);
              gl_FragColor.rgb = mix(gl_FragColor.rgb, vec3(0.93, 0.95, 1.0) * 0.45, clamp(line * 0.22 + fine * 0.12, 0.0, 0.3));
            }`);
      };
      const terrace = this.terrace = new THREE.Mesh(new THREE.PlaneGeometry(W + 1, D + 1), terraceMat);
      terrace.rotation.x = -Math.PI / 2;
      terrace.receiveShadow = true;
      terrace.geometry.attributes.uv.array.forEach((v, k, a) => { a[k] = k % 2 === 0 ? v * (W + 1) / 2 : v * (D + 1) / 2; });
      this.scene.add(terrace);
      this.tex.applyPBR(terraceMat, 'granite_tile', 1, { normalScale: 0.8, tint: 0xd9d6cf });
      terraceMat.map.repeat.set(1, 1);

      const gp = this.tex.procedural('ground');
      const groundMat = new THREE.MeshStandardMaterial({ color: 0x777766, map: gp.map, normalMap: gp.normalMap, roughness: 0.95 });
      const ground = this.ground = new THREE.Mesh(new THREE.CircleGeometry(70, 64), groundMat);
      ground.rotation.x = -Math.PI / 2; ground.position.y = -0.004;
      ground.receiveShadow = true;
      ground.geometry.attributes.uv.array.forEach((v, k, a) => { a[k] = v * 70; });
      this.scene.add(ground);
      this.tex.applyPBR(groundMat, 'forest_ground_04', 1, { normalScale: 1 });

      // Terrace kerb (a thin stone border) so the workspace reads as a built surface.
      const kerbMat = new THREE.MeshStandardMaterial({ color: 0x8d8a83, roughness: 0.85 });
      this.tex.applyPBR(kerbMat, 'japanese_stone_wall', 1, { tint: 0xcfcac2 });
      const kerb = new THREE.Group();
      const k1 = new THREE.BoxGeometry(W + 1.3, 0.06, 0.15), k2 = new THREE.BoxGeometry(0.15, 0.06, D + 1.3);
      for (const [g, x, z] of [[k1, 0, (D + 1.15) / 2], [k1, 0, -(D + 1.15) / 2], [k2, (W + 1.15) / 2, 0], [k2, -(W + 1.15) / 2, 0]]) {
        const m = new THREE.Mesh(g, kerbMat); m.position.set(x, 0.02, z); m.receiveShadow = true; m.castShadow = true; kerb.add(m);
      }
      this.scene.add(kerb);
    }

    // ------------------------------------------------------------------ environment
    applyEnvironment() {
      const THREE = this.THREE, A = this.A, s = this.s;
      if (this.skyMesh) { this.scene.remove(this.skyMesh); this.skyMesh = null; }
      if (this.skybox) { this.scene.remove(this.skybox); }
      this.renderer.toneMappingExposure = s.exposure;
      const env = s.environment;
      if (env === 'garden') {
        if (this.hdr) this.useHDR(this.hdr);
        else {
          this.useSky(38, 150, 'day');
          if (!this.hdrLoading) {
            this.hdrLoading = true;
            const loader = new A.RGBELoader();
            loader.setDataType(THREE.FloatType);
            loader.load(PC.ASSETS.hdri, (tex) => {
              tex.mapping = THREE.EquirectangularReflectionMapping;
              this.hdr = tex;
              this.hdrSun = this.findSun(tex);
              if (this.s.environment === 'garden') this.useHDR(tex);
              if (this.onStatus) this.onStatus('Garden environment loaded');
            }, undefined, () => { if (this.onStatus) this.onStatus('HDRI unavailable — using procedural sky'); });
          }
        }
      } else if (env === 'studio') {
        const room = new A.RoomEnvironment();
        this.setEnvMap(this.pmrem.fromScene(room, 0.04).texture);
        this.clearColor = new THREE.Color(0x1a1d24);
        this.setSun(new THREE.Vector3(0.3, 0.9, 0.35).normalize(), new THREE.Color(1, 0.98, 0.95), 2.4);
        this.envIntensity = 0.8;
      } else {
        const presets = { day: [s.sunElevation, s.sunAzimuth], sunset: [4, 250], night: [-8, 250] };
        const [el, az] = presets[env] || presets.day;
        this.useSky(el, az, env);
      }
      const fc = env === 'studio' ? 0x1a1d24 : 0x9fb4c0;
      this.scene.fog = new THREE.Fog(fc, 30, 110);
      this.envDirty = true;
    }

    setEnvMap(tex) {
      if (this.envTex && this.envTex !== tex) this.envTex.dispose();
      this.envTex = tex;
      this.scene.environment = tex;
    }
    setSun(dir, color, intensity) {
      this.sunDir.copy(dir);
      this.sunColor.copy(color);
      this.sun.color.copy(color);
      this.sun.intensity = intensity;
    }

    useHDR(tex) {
      const THREE = this.THREE, A = this.A;
      this.setEnvMap(this.pmrem.fromEquirectangular(tex).texture);
      this.skybox = new A.GroundedSkybox(tex, 5, 90, 96);
      this.skybox.material.fog = false;
      this.skybox.material.depthWrite = false;
      this.skybox.renderOrder = -10;
      this.scene.add(this.skybox);
      this.clearColor = new THREE.Color(0x000000);
      const sd = this.hdrSun || { dir: new THREE.Vector3(0.4, 0.75, 0.3).normalize(), color: new THREE.Color(1, 0.94, 0.84), strength: 1 };
      this.setSun(sd.dir, sd.color, 2.2 + 1.6 * sd.strength);
      this.envIntensity = 1;
      this.scene.environmentIntensity = 1;
    }

    // Brightest HDRI texel ≈ sun direction (so shadows agree with the photographed light).
    findSun(tex) {
      const THREE = this.THREE, img = tex.image, w = img.width, h = img.height, d = img.data;
      let best = 0, bx = 0, by = 0;
      for (let y = 0; y < h / 2; y += 2) for (let x = 0; x < w; x += 2) {
        const o = (y * w + x) * 4, l = d[o] * 0.2126 + d[o + 1] * 0.7152 + d[o + 2] * 0.0722;
        if (l > best) { best = l; bx = x; by = y; }
      }
      const u = (bx + 0.5) / w, lat = (0.5 - (by + 0.5) / h) * Math.PI, ang = (u - 0.5) * Math.PI * 2;
      const dir = new THREE.Vector3(Math.cos(ang) * Math.cos(lat), Math.sin(lat), Math.sin(ang) * Math.cos(lat));
      if (dir.y < 0.25) dir.y = 0.25;
      dir.normalize();
      const o = (by * w + bx) * 4, m = Math.max(d[o], d[o + 1], d[o + 2]) || 1;
      return { dir, color: new THREE.Color(d[o] / m, d[o + 1] / m, d[o + 2] / m).lerp(new THREE.Color(1, 0.95, 0.88), 0.5), strength: clamp(Math.log10(best + 1) / 2, 0.3, 1.2) };
    }

    useSky(elev, az, preset) {
      const THREE = this.THREE, A = this.A;
      const sky = new A.Sky();
      sky.scale.setScalar(1000);
      const u = sky.material.uniforms;
      u.turbidity.value = preset === 'sunset' ? 6 : 3;
      u.rayleigh.value = preset === 'sunset' ? 2.5 : 1.2;
      u.mieCoefficient.value = 0.005; u.mieDirectionalG.value = 0.8;
      const phi = THREE.MathUtils.degToRad(90 - elev), theta = THREE.MathUtils.degToRad(az);
      const dir = new THREE.Vector3().setFromSphericalCoords(1, phi, theta);
      u.sunPosition.value.copy(dir);
      const envScene = new THREE.Scene();
      const skyCopy = new A.Sky(); skyCopy.scale.setScalar(1000);
      Object.assign(skyCopy.material.uniforms, THREE.UniformsUtils.clone(u));
      skyCopy.material.uniforms.sunPosition.value.copy(dir);
      envScene.add(skyCopy);
      this.setEnvMap(this.pmrem.fromScene(envScene).texture);
      sky.material.depthWrite = false;
      sky.renderOrder = -10;
      this.skyMesh = sky;
      this.scene.add(sky);
      const night = elev < 0;
      const sunC = night ? new THREE.Color(0.55, 0.65, 1) : elev < 10 ? new THREE.Color(1, 0.62, 0.35) : new THREE.Color(1, 0.95, 0.86);
      const sd = dir.clone(); if (sd.y < 0.15) sd.y = 0.15; sd.normalize();
      this.setSun(sd, sunC, night ? 0.25 : elev < 10 ? 1.8 : 3.2);
      this.envIntensity = night ? 0.15 : 1;
      this.scene.environmentIntensity = night ? 0.12 : 1;
      this.clearColor = new THREE.Color(0x000000);
    }

    // ------------------------------------------------------------------ scenery (Poly Haven models)
    loadScenery() {
      const THREE = this.THREE, A = this.A;
      if (this.sceneryGroup) return;
      const group = this.sceneryGroup = new THREE.Group();
      this.scene.add(group);
      this.swayUniforms = { uTime: { value: 0 }, uWind: { value: 0 } };
      // Poly Haven serves each glTF's textures at their own URLs; map the relative paths through its file API.
      const modelCache = new Map();
      const loadModel = (id) => {
        if (!modelCache.has(id)) modelCache.set(id, fetch('https://api.polyhaven.com/files/' + id).then((r) => r.json()).then((info) => {
          const g = info.gltf['1k'].gltf, map = {};
          for (const [path, v] of Object.entries(g.include || {})) map[path] = v.url;
          const manager = new THREE.LoadingManager();
          manager.setURLModifier((url) => { for (const p in map) if (url.endsWith(p)) return map[p]; return url; });
          return new A.GLTFLoader(manager).loadAsync(g.url);
        }));
        return modelCache.get(id);
      };
      const W = this.s.worldWidth, D = this.s.worldDepth;
      let seed = 7;
      const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
      const place = (id, spots, opts) => {
        loadModel(id).then((gltf) => {
          const parts = [];
          gltf.scene.updateMatrixWorld(true);
          gltf.scene.traverse((o) => { if (o.isMesh) parts.push(o); });
          // Rock "sets" contain several rocks: pick one per spot.
          const variants = opts.set ? parts.map((p) => [p]) : [parts];
          for (let v = 0; v < variants.length; v++) {
            const mine = spots.filter((_, k) => k % variants.length === v);
            if (!mine.length) continue;
            for (const part of variants[v]) {
              const inst = new THREE.InstancedMesh(part.geometry, part.material, mine.length);
              // Keep each mesh's own rotation/scale but drop its offset inside the asset, and sit it on the ground.
              const pos = new THREE.Vector3(), q = new THREE.Quaternion(), sc = new THREE.Vector3();
              part.matrixWorld.decompose(pos, q, sc);
              const rs = new THREE.Matrix4().compose(new THREE.Vector3(), q, sc);
              const bb = part.geometry.boundingBox || (part.geometry.computeBoundingBox(), part.geometry.boundingBox);
              const box = bb.clone().applyMatrix4(rs);
              const c = new THREE.Vector3(); box.getCenter(c);
              const local = new THREE.Matrix4().makeTranslation(-c.x, -box.min.y - (opts.sink || 0), -c.z).multiply(rs);
              mine.forEach(([x, z, sc, rot], k) => {
                const m = new THREE.Matrix4().compose(new THREE.Vector3(x, 0, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, rot, 0)), new THREE.Vector3(sc, sc, sc));
                inst.setMatrixAt(k, m.multiply(local));
              });
              inst.castShadow = opts.shadow !== false; inst.receiveShadow = true;
              if (opts.sway) this.addSway(part.material);
              group.add(inst);
            }
          }
        }).catch(() => {});
      };
      const spots = (n, zMin, zMax, sMin, sMax, xSpread) => {
        const out = [];
        for (let k = 0; k < n; k++) {
          const x = (rnd() - 0.5) * (xSpread || W + 8), z = zMin + rnd() * (zMax - zMin);
          out.push([x, z, sMin + rnd() * (sMax - sMin), rnd() * Math.PI * 2]);
        }
        return out;
      };
      const back = -D / 2 - 0.9, ends = W / 2 + 1;
      place('rock_moss_set_01', spots(22, back - 3, back - 0.2, 0.5, 1.1), { set: true, sink: 0.05 });
      place('rock_moss_set_02', spots(16, back - 4.5, back - 0.8, 0.6, 1.3), { set: true, sink: 0.05 });
      place('boulder_01', spots(6, back - 7, back - 3.5, 0.5, 0.9), { sink: 0.1 });
      place('fern_02', spots(40, back - 3.5, back + 0.2, 0.9, 1.6), { sway: true });
      place('shrub_02', spots(14, back - 6, back - 2, 1, 1.8), { sway: true });
      place('grass_medium_01', spots(90, back - 5, back + 0.3, 0.8, 1.4).concat(spots(40, D / 2 + 1.2, D / 2 + 6, 0.7, 1.2)), { sway: true, shadow: false });
      // Ends of the workspace.
      const endSpots = [];
      for (let k = 0; k < 16; k++) { const side = k % 2 ? 1 : -1; endSpots.push([side * (ends + rnd() * 3), (rnd() - 0.5) * D, 1 + rnd() * 1.5, rnd() * 6.28]); }
      place('rock_moss_set_01', endSpots.map((p) => [p[0], p[1], p[2] * 0.5, p[3]]), { set: true, sink: 0.05 });
    }

    addSway(mat) {
      if (mat.userData.sway) return;
      mat.userData.sway = true;
      const U = this.swayUniforms;
      mat.onBeforeCompile = (sh) => {
        sh.uniforms.uTime = U.uTime; sh.uniforms.uWind = U.uWind;
        sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nuniform float uTime; uniform float uWind;')
          .replace('#include <begin_vertex>', `#include <begin_vertex>
            #ifdef USE_INSTANCING
              vec3 ip = instanceMatrix[3].xyz;
            #else
              vec3 ip = vec3(0.0);
            #endif
            float hgt = max(position.y, 0.0);
            float sway = sin(uTime * 1.7 + ip.x * 0.9 + ip.z * 0.6) * 0.6 + sin(uTime * 3.1 + ip.x * 2.1) * 0.25;
            transformed.x += sway * (0.012 + uWind * 0.012) * hgt * 3.0;
            transformed.z += sway * (0.006 + uWind * 0.006) * hgt * 3.0;`);
      };
      mat.needsUpdate = true;
    }

    // ------------------------------------------------------------------ particle renderers
    initParticles() {
      const THREE = this.THREE, cap = this.sim.fluid.cap, r = this.sim.fluid.r;
      const mkInst = (mat, geo) => {
        const m = new THREE.InstancedMesh(geo, mat, cap);
        m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3).setUsage(THREE.DynamicDrawUsage);
        m.count = 0; m.castShadow = true; m.receiveShadow = true; m.frustumCulled = false;
        this.scene.add(m);
        return m;
      };
      // One instanced clump model per grain style (salt crystals, sand, soil, filings…).
      this.grainMeshes = {};
      for (const st of PC.GRAIN_STYLES) {
        const mat = PC.grainMaterial(THREE, st), gt = PC.grainTexture(st);
        if (gt) this.tex.applyGrainTexture(mat, gt.id, 0.7);
        this.grainMeshes[st] = mkInst(mat, PC.grainGeometry(THREE, st));
      }
      this.grainCounts = {};
      this.matGrain = PC.MATS.map((m) => PC.grainStyle(m));
      void r;

      // Gas / smoke sprites (lit, alpha blended).
      const mkPoints = (additive, tex) => {
        const geo = new THREE.BufferGeometry();
        const pos = new Float32Array(cap * 3), col = new Float32Array(cap * 4), size = new Float32Array(cap * 2);
        geo.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
        geo.setAttribute('aCol', new THREE.BufferAttribute(col, 4).setUsage(THREE.DynamicDrawUsage));
        geo.setAttribute('aSize', new THREE.BufferAttribute(size, 2).setUsage(THREE.DynamicDrawUsage));
        geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
        const mat = new THREE.ShaderMaterial({
          transparent: true, depthWrite: false,
          blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
          uniforms: { tMap: { value: tex }, uScale: { value: 1 }, uLight: { value: new THREE.Color(1, 1, 1) }, uAmbient: { value: new THREE.Color(0.5, 0.5, 0.5) } },
          vertexShader: /* glsl */`
            uniform float uScale;
            in vec4 aCol; in vec2 aSize;
            out vec4 vCol; out float vRot;
            void main() {
              vec4 mv = modelViewMatrix * vec4(position, 1.0);
              vCol = aCol; vRot = aSize.y;
              gl_Position = projectionMatrix * mv;
              gl_PointSize = aSize.x * uScale / -mv.z;
            }`,
          fragmentShader: /* glsl */`
            uniform sampler2D tMap; uniform vec3 uLight; uniform vec3 uAmbient;
            in vec4 vCol; in float vRot;
            void main() {
              vec2 p = gl_PointCoord - 0.5;
              float c = cos(vRot), s = sin(vRot);
              p = vec2(c * p.x - s * p.y, s * p.x + c * p.y) + 0.5;
              vec4 t = texture(tMap, vec2(p.x, 1.0 - p.y));
              ${additive ? 'gl_FragColor = vec4(vCol.rgb * t.a * vCol.a, 1.0);' : 'gl_FragColor = vec4(vCol.rgb * (uAmbient + uLight * 0.65), t.a * vCol.a);'}
            }`,
        });
        const pts = new THREE.Points(geo, mat);
        pts.frustumCulled = false;
        pts.layers.set(LAYER_TRANSPARENT);
        this.scene.add(pts);
        return { pts, geo, pos, col, size, mat };
      };
      this.gas = mkPoints(false, this.tex.smokeSprite());
      this.fire = mkPoints(true, this.tex.flameSprite());
    }

    // Colour of particle i: rgb (HDR when hot), liquid opacity, metallic, emissive.
    particleColor(i, out) {
      const f = this.sim.fluid, s = this.s;
      const mi = f.mat[i], m = PC.MATS[mi], g = f.groups[f.grp[i]], ph = f.phase[i], T = f.T[i];
      if (s.renderMode === 'thermal') { thermal(T, out); out[3] = 1; out[4] = 0; out[5] = 0.3; return out; }
      const custom = g && g.props.color !== m.color;
      const key = (custom ? g.props.color : m.phaseColors[ph === GAS ? 'gas' : ph === LIQUID ? 'liquid' : 'solid']);
      let lin = this.linCache.get(key);
      if (!lin) { const c = PC.hexToRgb(key); lin = [srgbToLin(c[0] / 255), srgbToLin(c[1] / 255), srgbToLin(c[2] / 255)]; this.linCache.set(key, lin); }
      const v = 1 + (f.seed[i] - 0.5) * 0.12;
      out[0] = lin[0] * v; out[1] = lin[1] * v; out[2] = lin[2] * v;
      let emis = g ? g.props.glow : m.glow;
      if (T > 750) {
        const t = clamp((T - 750) / 1500, 0, 1), c = bb(T), k = t * t * 5;
        out[0] = out[0] * (1 - t) + c[0] * k; out[1] = out[1] * (1 - t) + c[1] * k; out[2] = out[2] * (1 - t) + c[2] * k;
      }
      const op = g ? g.props.opacity : m.opacity;
      out[3] = ph === LIQUID ? Math.pow(clamp((op - 0.6) / 0.4, 0, 1), 2) : op;
      if (ph === SOLID && f.matIsWater[mi]) out[3] = 0.55; // ice sheet: translucent white over the water
      out[4] = m.metallic ? 1 : 0;
      // Molten rock / glass: a negative 'metal' value carries how hot the melt is to the liquid shader (crust vs glow).
      // Crust-and-glowing-crack look is for molten rock only (lava, stone, obsidian) — not glass, salt or metal.
      if (!m.metallic && s.renderMode !== 'thermal' && (m.id === 'lava' || m.tags.has('rock'))) {
        // Negative 'metal' = 1 + how hot the rock is, so the shader can tell how much of a pixel is rock (≥ 1) from water.
        if (ph === LIQUID && T > 900) out[4] = -(1 + clamp((T - 650) / 850, 0, 1));
        else if (ph === SOLID && !m.powder) { out[3] = 1; out[4] = -(1 + clamp((T - 650) / 850, 0, 1)); out[5] = -1; } // set crust (negative emis flags solid)
      }
      out[5] = emis || 0;
      return out;
    }

    // A powder particle with almost no neighbours: a few stray grains, not part of any pile.
    powderLone(i) {
      const f = this.sim.fluid;
      let n = 0;
      f.forEachNear(f.x[i], f.y[i], f.z[i], f.sp * 1.5, (j) => { if (j !== i && f.phase[j] <= POWDER) n++; });
      return n < 2;
    }

    // A powder grain that is falling, sliding fast or blown about (not part of a resting pile).
    powderAirborne(i) {
      const f = this.sim.fluid, v2 = f.vx[i] * f.vx[i] + f.vy[i] * f.vy[i] + f.vz[i] * f.vz[i];
      return v2 > 0.3 * 0.3;
    }

    updateParticles() {
      const f = this.sim.fluid, s = this.s, cam = this.camera;
      const C = [0, 0, 0, 0, 0, 0];
      const GM = this.grainMeshes, GN = this.grainCounts, ROT = PC.grainRotations;
      let nCast = 0, nHaze = 0;
      const PL = this.pileLists; PL.sand.length = 0; PL.soil.length = 0; PL.fine.length = 0; PL.mud.length = 0;
      const HP = this.hazePos, HC = this.hazeCol, HO = this.hazeOff, hazeCap = this.hazeCap - 40;
      for (const st in GM) GN[st] = 0;
      const gas = this.gas, fire = this.fire;
      let ngas = 0, nfire = 0;
      this.fireCells = this.fireCells || new Map();
      this.fireCells.clear();
      const put = (A, n, x, y, z, sc, R) => { const o = n * 16; A[o] = R[0] * sc; A[o + 1] = R[3] * sc; A[o + 2] = R[6] * sc; A[o + 3] = 0; A[o + 4] = R[1] * sc; A[o + 5] = R[4] * sc; A[o + 6] = R[7] * sc; A[o + 7] = 0; A[o + 8] = R[2] * sc; A[o + 9] = R[5] * sc; A[o + 10] = R[8] * sc; A[o + 11] = 0; A[o + 12] = x; A[o + 13] = y; A[o + 14] = z; A[o + 15] = 1; };
      const r = f.r;
      for (let k = 0; k < f.nAct; k++) {
        const i = f.act[k];
        if (!f.alive[i]) continue;
        const ph = f.phase[i], x = f.x[i], y = f.y[i], z = f.z[i];
        // Melt that has frozen (stone/obsidian/glass/metal crust) is drawn with the liquid surface; mud is a wet pile.
        if ((ph === SOLID && !this.matPowder[f.mat[i]]) || (ph === LIQUID && this.matMud[f.mat[i]])) { if (ph === LIQUID && s.renderMode !== 'thermal') PL.mud.push(i); continue; }
        if (ph <= POWDER) {
          this.particleColor(i, C);
          const st = this.matGrain[f.mat[i]];
          let onSurface = f.T[i] < 1000 && s.renderMode !== 'thermal';
          const lone = onSurface && !this.powderAirborne(i) && this.powderLone(i);
          if (onSurface && (lone || this.powderAirborne(i)) && nHaze < hazeCap) {
            // Falling / flying powder: ~40 individual grains spread through the particle's volume, smeared along
            // its motion over 1/60 s like a camera shutter.
            const vx = f.vx[i], vy = f.vy[i], vz = f.vz[i], base = ((f.seed[i] * 128) | 0) * 160, sh = 1 / 60;
            for (let g = 0; g < 40; g++) {
              const o = base + g * 4, t = (HO[o + 3] - 0.97) * 2;
              const j = nHaze * 3;
              if (lone) { HP[j] = x + HO[o] * r * 2.2; HP[j + 1] = y - r * 0.92 + Math.abs(HO[o + 1]) * r * 0.12; HP[j + 2] = z + HO[o + 2] * r * 2.2; } // a sprinkle of grains on the floor
              else { HP[j] = x + HO[o] * r * 1.25 + vx * sh * t; HP[j + 1] = y + HO[o + 1] * r * 1.25 + vy * sh * t; HP[j + 2] = z + HO[o + 2] * r * 1.25 + vz * sh * t; }
              const sd = HO[o + 3];
              HC[j] = Math.min(1, C[0] * sd); HC[j + 1] = Math.min(1, C[1] * sd); HC[j + 2] = Math.min(1, C[2] * sd);
              nHaze++;
            }
            continue;
          }
          const mesh = GM[st], n = onSurface ? 0 : GN[st]++;
          const sc = 0.9 + f.seed[i] * 0.25;
          if (!onSurface) put(mesh.instanceMatrix.array, n, x, y, z, sc, ROT[(f.seed[i] * 128) | 0]);
          else {
            // A powder with its own colour (e.g. one found with Search) uses the tinted fine-grain surface.
            const g = f.groups[f.grp[i]];
            PL[g && g.props.color !== PC.MATS[f.mat[i]].color ? 'fine' : this.pileOf[f.mat[i]]].push(i);
          }
          const col = mesh.instanceColor.array;
          if (!onSurface) { col[n * 3] = Math.min(1, C[0]); col[n * 3 + 1] = Math.min(1, C[1]); col[n * 3 + 2] = Math.min(1, C[2]); }
          if (f.T[i] > 800 && s.renderMode !== 'thermal') {
            // Incandescent grains glow through the additive sprite layer (and bloom).
            const c = bb(f.T[i]), t = clamp((f.T[i] - 800) / 1500, 0, 1), o = nfire * 3;
            fire.pos[o] = x; fire.pos[o + 1] = y; fire.pos[o + 2] = z;
            fire.col[nfire * 4] = c[0] * (1 + 4 * t); fire.col[nfire * 4 + 1] = c[1] * (1 + 4 * t); fire.col[nfire * 4 + 2] = c[2] * (1 + 4 * t); fire.col[nfire * 4 + 3] = 0.25 + 0.5 * t;
            fire.size[nfire * 2] = r * 2.4; fire.size[nfire * 2 + 1] = 0;
            nfire++;
          }
        } else if (ph === GAS) {
          const mi = f.mat[i], m = PC.MATS[mi], T = f.T[i];
          const life = f.maxLife[i] > 0 ? clamp(f.life[i] / f.maxLife[i], 0, 1) : 1;
          const appear = Math.min(1, f.age[i] * 8);
          if (mi === f.FIRE || T > 6000 || (T > 1100 && s.renderMode !== 'thermal')) {
            let c;
            if (s.renderMode === 'thermal') { thermal(T, C); c = C; }
            else if (mi === f.FIRE) {
              c = T > 1500 ? [1, 0.62, 0.26] : T > 1150 ? [1, 0.36, 0.07] : T > 850 ? [0.95, 0.17, 0.02] : [0.5, 0.07, 0.01];
              if (f.tint[i] >= 0) { const e = PC.MATS[f.tint[i]].emitRgb; if (e) c = [c[0] * 0.3 + e[0] / 255 * 0.7, c[1] * 0.3 + e[1] / 255 * 0.7, c[2] * 0.3 + e[2] / 255 * 0.7]; }
            } else { const e = m.emitRgb; c = e ? [e[0] / 255, e[1] / 255, e[2] / 255] : bb(T); }
            const o = nfire * 3;
            fire.pos[o] = x; fire.pos[o + 1] = y; fire.pos[o + 2] = z;
            const inten = mi === f.FIRE ? 0.8 + 5 * life * life : 1.6;
            fire.col[nfire * 4] = c[0] * inten; fire.col[nfire * 4 + 1] = c[1] * inten; fire.col[nfire * 4 + 2] = c[2] * inten; fire.col[nfire * 4 + 3] = Math.min(1, 0.12 + 0.5 * life) * appear;
            fire.size[nfire * 2] = r * (mi === f.FIRE ? 2.6 + 3.6 * Math.sqrt(life) : 3); fire.size[nfire * 2 + 1] = (f.seed[i] - 0.5) * 0.6;
            if (mi === f.FIRE && nfire % 3 === 0) {
              // Accumulate fire light clusters on a 1.5 m grid.
              const key = Math.round(x / 1.5) * 1000 + Math.round(z / 1.5);
              let c2 = this.fireCells.get(key);
              if (!c2) { c2 = [0, 0, 0, 0]; this.fireCells.set(key, c2); }
              c2[0] += x; c2[1] += y; c2[2] += z; c2[3]++;
            }
            nfire++;
            continue;
          }
          this.particleColor(i, C);
          let a = m.gasAlpha * life * appear;
          { const g = f.groups[f.grp[i]]; if (g && g.entryKey && PC.CUSTOM[g.entryKey]) a *= g.props.opacity; } // searched gases: real visibility
          if (m.life) a *= 0.5 + 0.5 * life;
          const o = ngas * 3;
          gas.pos[o] = x; gas.pos[o + 1] = y; gas.pos[o + 2] = z;
          gas.col[ngas * 4] = C[0]; gas.col[ngas * 4 + 1] = C[1]; gas.col[ngas * 4 + 2] = C[2]; gas.col[ngas * 4 + 3] = clamp(a * (m.life ? 0.7 : 0.4), 0, 1);
          gas.size[ngas * 2] = r * (m.life ? 6 + (1 - life) * 12 : 9); gas.size[ngas * 2 + 1] = f.seed[i] * 6.28 + this.time * 0.2 * (f.seed[i] - 0.5);
          ngas++;
        }
      }
      this.powderCasters.count = nCast;
      this.piles.update(PL);
      this.haze.geometry.setDrawRange(0, nHaze);
      if (nHaze) {
        const g = this.haze.geometry;
        g.attributes.position.needsUpdate = true; g.attributes.color.needsUpdate = true;
        g.attributes.position.updateRanges = [{ start: 0, count: nHaze * 3 }]; g.attributes.color.updateRanges = [{ start: 0, count: nHaze * 3 }];
      }
      this.powderCasters.instanceMatrix.needsUpdate = true;
      this.powderCasters.instanceMatrix.updateRanges = [{ start: 0, count: nCast * 16 }];
      for (const st in GM) {
        const mesh = GM[st], n = GN[st];
        mesh.count = n;
        mesh.instanceMatrix.needsUpdate = true; mesh.instanceColor.needsUpdate = true;
        mesh.instanceMatrix.updateRanges = [{ start: 0, count: n * 16 }];
        mesh.instanceColor.updateRanges = [{ start: 0, count: n * 3 }];
      }
      for (const [P, n] of [[gas, ngas], [fire, nfire]]) {
        P.geo.setDrawRange(0, n);
        for (const k of ['position', 'aCol', 'aSize']) { const at = P.geo.attributes[k]; at.needsUpdate = true; at.updateRanges = [{ start: 0, count: n * at.itemSize }]; }
        P.mat.uniforms.uScale.value = this.renderer.domElement.height * cam.projectionMatrix.elements[5] * 0.5;
        P.mat.uniforms.uLight.value.copy(this.sunColor).multiplyScalar(this.sun.intensity / 3.2);
      }
      gas.mat.uniforms.uAmbient.value.setRGB(0.45, 0.48, 0.52).multiplyScalar(this.envIntensity || 1);
      // Flickering firelight from the biggest fire clusters.
      if (!this.fireLights) {
        this.fireLights = [];
        for (let k = 0; k < 3; k++) { const L = new this.THREE.PointLight(0xff8a3a, 0, 4.5, 2); this.scene.add(L); this.fireLights.push(L); }
      }
      const cells = [...this.fireCells.values()].sort((a, b) => b[3] - a[3]);
      this.fireLights.forEach((L, k) => {
        const c3 = cells[k];
        if (!c3 || c3[3] < 2) { L.intensity *= 0.8; return; }
        L.position.set(c3[0] / c3[3], c3[1] / c3[3] + 0.1, c3[2] / c3[3]);
        L.intensity = Math.min(14, c3[3] * 0.45) * (0.8 + 0.35 * Math.sin(this.time * 23 + k) * Math.sin(this.time * 13.7 + k * 2));
      });
    }

    // ------------------------------------------------------------------ rigid body meshes
    material(kind, m, e) {
      const THREE = this.THREE;
      const color = new THREE.Color(e.props.color);
      switch (kind) {
        case 'rock': {
          const mat = new THREE.MeshStandardMaterial({ color, roughness: m.id === 'obsidian' ? 0.12 : 0.9, metalness: 0 });
          if (m.id !== 'obsidian') { const p = this.tex.procedural('rock'); mat.map = p.map; mat.normalMap = p.normalMap; this.tex.applyPBR(mat, 'rock_boulder_dry', 1, { tint: e.props.color, normalScale: 1.2 }); }
          return mat;
        }
        case 'plank': {
          const p = this.tex.procedural('wood');
          const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, map: p.map, normalMap: p.normalMap, roughness: 0.7 });
          // One board of the plank texture: crop via a per-material texture transform.
          this.tex.applyPBR(mat, 'brown_planks_03', 1, { onLoad: () => {
            for (const k of ['map', 'normalMap', 'roughnessMap', 'aoMap']) if (mat[k]) { mat[k] = mat[k].clone(); mat[k].repeat.set(0.2, 1); mat[k].offset.set(0.4, 0); mat[k].needsUpdate = true; }
          } });
          return mat;
        }
        case 'ice': case 'glassblock':
          return new THREE.MeshPhysicalMaterial({ color: kind === 'ice' ? 0xe4f6ff : 0xdff3f7, roughness: kind === 'ice' ? 0.12 : 0.02, metalness: 0, transparent: true, opacity: kind === 'ice' ? 0.62 : 0.3, ior: kind === 'ice' ? 1.31 : 1.5, clearcoat: 1, clearcoatRoughness: 0.05, envMapIntensity: 1.6, depthWrite: false });
        case 'concrete': {
          const p = this.tex.procedural('concrete');
          const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, map: p.map, normalMap: p.normalMap, roughness: 0.9 });
          this.tex.applyPBR(mat, 'concrete_floor_worn_001', 1, {});
          return mat;
        }
        case 'brick': return new THREE.MeshStandardMaterial({ color, roughness: 0.92 });
        case 'ingot': case 'lump': {
          const p = this.tex.procedural('brushed');
          return new THREE.MeshStandardMaterial({ color, metalness: 1, roughness: kind === 'lump' ? 0.45 : 0.24, normalMap: p.normalMap, normalScale: new THREE.Vector2(0.25, 0.25), envMapIntensity: 1.2 });
        }
        case 'crystal': return new THREE.MeshPhysicalMaterial({ color, metalness: 0.2, roughness: 0.15, clearcoat: 0.8 });
        case 'tnt': return new THREE.MeshStandardMaterial({ color: 0xc8372a, roughness: 0.55 });
        default: return new THREE.MeshStandardMaterial({ color, roughness: 0.6, metalness: m.metallic ? 1 : 0 });
      }
    }

    rockGeometry(seed) {
      const THREE = this.THREE;
      const key = 'rock' + (seed % 5);
      if (this.linCache.has(key)) return this.linCache.get(key);
      const geo = new THREE.IcosahedronGeometry(1, 5);
      const p = geo.attributes.position, v = new THREE.Vector3();
      for (let k = 0; k < p.count; k++) {
        v.fromBufferAttribute(p, k);
        const n = PC.fbm(v.x * 1.7 + seed * 3.1 + 10, v.y * 1.7 + v.z * 1.3 + seed, 5);
        const flat = 1 - 0.18 * Math.max(0, Math.abs(v.y) - 0.6);
        v.multiplyScalar((0.78 + n * 0.45) * flat);
        p.setXYZ(k, v.x, v.y, v.z);
      }
      geo.computeVertexNormals();
      this.linCache.set(key, geo);
      return geo;
    }

    // People: a real rigged 3D human (skinned mesh) whose bones follow the ragdoll's physics parts.
    updateHumans() {
      const THREE = this.THREE, A = this.A;
      this.humans = this.humans || new Map();
      const groups = new Map();
      for (const e of this.sim.bodies.list) if (e.dummy && !e.deleted) (groups.get(e.dummy.id) || groups.set(e.dummy.id, {}).get(e.dummy.id))[e.dummy.part] = e;
      for (const [id, h] of this.humans) if (!groups.has(id)) { this.scene.remove(h.root); this.humans.delete(id); }
      if (!groups.size) return;
      // One real rigged model per kind: a person, or the crash-test mannequin.
      this.charAssets = this.charAssets || {};
      const asset = (style) => {
        const url = style === 'human' ? PC.HUMAN_MODEL : PC.DUMMY_MODEL, a = this.charAssets[style] || (this.charAssets[style] = { gltf: null });
        if (!a.p) a.p = new A.GLTFLoader().loadAsync(url).then((g) => { a.gltf = g; }).catch((err) => { console.warn('character model', err); a.p = null; });
        return a.gltf;
      };
      const qa = new THREE.Quaternion(), qp = new THREE.Quaternion(), v = new THREE.Vector3();
      for (const [id, parts] of groups) {
        let h = this.humans.get(id);
        if (!h) {
          const any = Object.values(parts)[0], gltf = asset(any.dummy.style || 'dummy');
          if (!gltf) continue;
          const root = A.SkeletonUtils.clone(gltf.scene);
          root.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; o.frustumCulled = false; o.userData.entity = parts.chest; if (o.material) o.material = o.material.clone(); } });
          this.scene.add(root);
          root.updateMatrixWorld(true);
          const bones = {}, rest = {};
          root.traverse((o) => { if (o.isBone) bones[o.name.replace(/^mixamorig:?/, '')] = o; });
          // Each limb bone points at its child; the physics part points away from its joint. Align the two so any
          // rest pose (T-pose, A-pose…) maps onto the ragdoll correctly.
          const CHILD = { Hips: 'Spine', Spine2: 'Neck', Head: 'HeadTop_End', LeftArm: 'LeftForeArm', LeftForeArm: 'LeftHand', RightArm: 'RightForeArm', RightForeArm: 'RightHand', LeftUpLeg: 'LeftLeg', LeftLeg: 'LeftFoot', RightUpLeg: 'RightLeg', RightLeg: 'RightFoot' };
          const PARENT = { head: 'chest', chest: 'pelvis', armL: 'chest', armR: 'chest', foreL: 'armL', foreR: 'armR', thighL: 'pelvis', thighR: 'pelvis', shinL: 'thighL', shinR: 'thighR' };
          for (const k in PC.HUMAN_PARTS) {
            const P = PC.HUMAN_PARTS[k], b = bones[P.bone], c = bones[CHILD[P.bone]];
            if (!b) continue;
            const q = b.getWorldQuaternion(new THREE.Quaternion()), p = b.getWorldPosition(new THREE.Vector3());
            let align = new THREE.Quaternion();
            if (c) {
              const boneDir = c.getWorldPosition(new THREE.Vector3()).sub(p).normalize();
              const piv = PARENT[k] && PC.HUMAN_PIVOTS[PARENT[k] + '|' + k];
              const physDir = k === 'pelvis' || k === 'chest' || k === 'head' ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(P.at[0] - piv[0], P.at[1] - piv[1], P.at[2] - piv[2]).normalize();
              if (k === 'pelvis' || k === 'chest' || k === 'head') boneDir.set(0, 1, 0); // trunk: keep the model's own lean
              align.setFromUnitVectors(boneDir, physDir);
            }
            rest[k] = { q: align.multiply(q), p };
          }
          // Drive bones parent-first so each one composes with its parent's new pose.
          const order = ['pelvis', 'chest', 'head', 'armL', 'foreL', 'armR', 'foreR', 'thighL', 'shinL', 'thighR', 'shinR'];
          h = { root, bones, rest, order };
          this.humans.set(id, h);
        }
        for (const k of h.order) {
          const e = parts[k], bone = h.bones[PC.HUMAN_PARTS[k].bone], r = h.rest[k];
          if (!e || !bone || !r) continue;
          const b = e.cb;
          // Target world rotation: the part's rotation applied to the bone's rest (T-pose) orientation.
          qa.set(b.quaternion.x, b.quaternion.y, b.quaternion.z, b.quaternion.w).multiply(r.q);
          bone.parent.getWorldQuaternion(qp);
          bone.quaternion.copy(qp.invert().multiply(qa));
          if (k === 'pelvis') {
            // Hips also carry the body's position.
            v.copy(r.p).sub(new THREE.Vector3(...PC.HUMAN_PARTS.pelvis.at)).applyQuaternion(new THREE.Quaternion(b.quaternion.x, b.quaternion.y, b.quaternion.z, b.quaternion.w)).add(new THREE.Vector3(b.position.x, b.position.y, b.position.z));
            bone.parent.updateWorldMatrix(true, false);
            bone.position.copy(bone.parent.worldToLocal(v));
          }
          bone.updateMatrixWorld(true);
        }
        // Burnt / frozen tint follows the chest part.
        const ch = parts.chest;
        if (ch) h.root.traverse((o) => { if (o.isMesh && o.material && o.material.color) { if (!o.userData.base) o.userData.base = o.material.color.clone(); const burnt = ch.burnt || 0; o.material.color.copy(o.userData.base).multiplyScalar(1 - burnt * 0.85); } });
      }
    }

    // Per-mesh setup for a body's model: entity link for picking, glass shader, transparent layer.
    prepareModel(model, e) {
      model.traverse((o) => {
        if (!o.isMesh) return;
        o.userData.entity = e;
        // Solid glass uses the same refracting glass shader as the beakers (not a frosty transparent material).
        if (o.material.userData && o.material.userData.wantsGlassShader) { o.userData.origMaterial = o.material; o.material = this.glassMaterial(); o.castShadow = false; o.renderOrder = -5; o.layers.set(LAYER_TRANSPARENT); return; }
        if (o.material.transparent) { o.layers.set(LAYER_TRANSPARENT); o.castShadow = o.material.opacity > 0.5; }
      });
    }

    makeBodyMesh(e) {
      // Models that finish downloading later get the same setup.
      if (!this.models.onLateMesh) this.models.onLateMesh = (group, obj) => {
        let g = group; while (g && !g.userData.entity) g = g.parent;
        const ent = g && g.userData.entity;
        if (!ent) return;
        this.prepareModel(obj, ent);
        const rec = this.meshes.get(ent.id);
        if (rec) obj.traverse((o) => { if (o.isMesh && !o.userData.glow) rec.mats.push(o.material); });
      };
      const THREE = this.THREE, A = this.A, m = PC.MATS[e.mat];
      const group = new THREE.Group();
      const add = (geo, mat, x, y, z, rot) => {
        const mesh = new THREE.Mesh(geo, mat);
        mesh.position.set(x || 0, y || 0, z || 0);
        if (rot) mesh.rotation.set(rot[0], rot[1], rot[2]);
        mesh.castShadow = !mat.transparent || mat.opacity > 0.5; mesh.receiveShadow = true;
        mesh.userData.entity = e;
        if (mat.transparent) mesh.layers.set(LAYER_TRANSPARENT);
        if (mat.userData && mat.userData.shaderGlass) { mesh.castShadow = false; mesh.renderOrder = -5; }
        group.add(mesh);
        return mesh;
      };
      let lid = null;
      if (e.container) {
        this.buildContainerMesh(e, group, add);
        // Lid (shown when the container is closed).
        const d = e.def, glass = PC.MATS[e.mat].id === 'glass';
        if (d.shape === 'cup' || d.shape === 'openbox') {
          const lm = glass ? this.glassMaterial() : new THREE.MeshStandardMaterial({ color: 0xb8bdc4, metalness: 1, roughness: 0.35 });
          const geo = d.shape === 'cup' ? new THREE.CylinderGeometry(d.R + d.t * 1.6, d.R + d.t * 1.6, 0.008, 48) : new THREE.BoxGeometry((d.ix + d.t) * 2 + 0.01, 0.01, (d.iz + d.t) * 2 + 0.01);
          lid = add(geo, lm, 0, d.H + 0.005, 0);
          if (d.shape === 'cup') { const knob = add(new THREE.SphereGeometry(0.012, 16, 12), lm, 0, d.H + 0.016, 0); lid.userData.knob = knob; }
          lid.visible = false;
        }
      } else {
        // Material-specific procedural model (ingot, crystal cluster, coil, hopper crystal, rock, plank…).
        const model = e.shapePts ? this.models.solidified(m, e.props, e.shapePts, this.sim.fluid.r) : this.models.build(m, e.props, e.entryKey, e.baseDims);
        this.prepareModel(model, e);
        group.add(model);
      }
      group.userData.entity = e;
      this.scene.add(group);
      const rec = { group, entity: e, mats: [], glow: [], column: null, lid };
      group.traverse((o) => {
        if (!o.isMesh) return;
        if (o.userData.glow) rec.glow.push(o);
        else if (o.userData.column) rec.column = o;
        else rec.mats.push(o.material);
      });
      rec.baseEmissive = rec.mats.map((mm) => (mm.emissive ? mm.emissive.clone() : null));
      this.meshes.set(e.id, rec);
      return rec;
    }

    // Real glass: refracts the already-rendered scene behind it, tints and darkens with path length,
    // Fresnel-reflects the environment and catches sharp sun glints.
    glassMaterial() {
      if (this.glassMat) return this.glassMat;
      const THREE = this.THREE;
      this.glassMat = new THREE.ShaderMaterial({
        transparent: true, depthWrite: false, side: THREE.DoubleSide,
        defines: { ENVMAP_TYPE_CUBE_UV: '', CUBEUV_TEXEL_WIDTH: '0.0', CUBEUV_TEXEL_HEIGHT: '0.0', CUBEUV_MAX_MIP: '0.0' },
        uniforms: { tBg: { value: null }, envMap: { value: null }, uHasEnv: { value: 0 }, uEnvI: { value: 1 }, uRes: { value: new THREE.Vector2(1, 1) },
          uSunDir: { value: new THREE.Vector3(0, 1, 0) }, uSunCol: { value: new THREE.Color(1, 1, 1) }, uTint: { value: new THREE.Color(0.93, 0.98, 0.97) } },
        vertexShader: `varying vec3 vNw; varying vec3 vPw; varying vec3 vNv; varying float vDepth;
          void main() { vec4 wp = modelMatrix * vec4(position, 1.0); vPw = wp.xyz; vNw = normalize(mat3(modelMatrix) * normal);
            vNv = normalize(normalMatrix * normal); vec4 mv = viewMatrix * wp; vDepth = -mv.z; gl_Position = projectionMatrix * mv; }`,
        fragmentShader: `uniform sampler2D envMap;
          #include <common>
          #include <cube_uv_reflection_fragment>
          uniform sampler2D tBg; uniform float uHasEnv, uEnvI; uniform vec2 uRes; uniform vec3 uSunDir, uSunCol, uTint;
          varying vec3 vNw; varying vec3 vPw; varying vec3 vNv; varying float vDepth;
          void main() {
            vec3 V = normalize(cameraPosition - vPw);
            vec3 N = normalize(vNw); if (dot(N, V) < 0.0) N = -N;
            float ndv = clamp(dot(N, V), 0.0, 1.0);
            float F = 0.04 + 0.96 * pow(1.0 - ndv, 5.0);
            vec3 nv = normalize(vNv);
            vec2 uv = gl_FragCoord.xy / uRes + nv.xy * (0.006 + 0.02 * (1.0 - ndv)) / max(vDepth, 0.3);
            vec3 bg = texture2D(tBg, uv).rgb;
            float path = pow(1.0 - ndv, 2.5);
            bg *= mix(vec3(1.0), uTint * 0.82, path);
            vec3 R = reflect(-V, N);
            vec3 refl = uHasEnv > 0.5 ? textureCubeUV(envMap, R, 0.02).rgb * uEnvI : vec3(0.6, 0.7, 0.8);
            float sp = pow(max(dot(R, uSunDir), 0.0), 600.0) * 6.0;
            gl_FragColor = vec4(mix(bg, refl, F) + uSunCol * sp, 1.0);
          }`,
      });
      this.glassMat.userData.shaderGlass = true;
      return this.glassMat;
    }

    updateGlass(bgTex) {
      const g = this.glassMat;
      if (!g) return;
      const u = g.uniforms, env = this.scene.environment;
      u.tBg.value = bgTex;
      u.uRes.value.set(this.sceneRT.width, this.sceneRT.height);
      u.uSunDir.value.copy(this.sunDir);
      u.uSunCol.value.copy(this.sunColor).multiplyScalar(this.sun.intensity / 3);
      if (env && env.image && env.image.height) {
        const hgt = env.image.height, maxMip = Math.log2(hgt) - 2, d = g.defines;
        const tw = String(1 / (3 * Math.max(Math.pow(2, maxMip), 7 * 16))), th = String(1 / hgt), mm = maxMip.toFixed(1);
        if (d.CUBEUV_TEXEL_WIDTH !== tw || d.CUBEUV_TEXEL_HEIGHT !== th || d.CUBEUV_MAX_MIP !== mm) { d.CUBEUV_TEXEL_WIDTH = tw; d.CUBEUV_TEXEL_HEIGHT = th; d.CUBEUV_MAX_MIP = mm; g.needsUpdate = true; }
        u.envMap.value = env; u.uHasEnv.value = 1; u.uEnvI.value = this.envIntensity || 1;
      }
    }

    buildContainerMesh(e, group, add) {
      const THREE = this.THREE, def = e.def, m = PC.MATS[e.mat];
      const glass = m.id === 'glass';
      if (def.shape === 'cup') {
        const { R, H, t } = def;
        const pts = [[0, 0], [R + t, 0], [R + t, H - 0.004], [R + t * 0.5, H], [R, H - 0.004], [R, t], [0, t]].map(([x, y]) => new THREE.Vector2(x, y));
        const geo = new THREE.LatheGeometry(pts, 64);
        let mat;
        if (glass) mat = this.glassMaterial();
        else { mat = new THREE.MeshStandardMaterial({ color: e.props.color, roughness: 0.75 }); }
        add(geo, mat);
        if (glass && def.key === 'beaker') {
          // Graduation marks.
          const markMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55, depthWrite: false });
          for (let k = 1; k <= 5; k++) {
            const y = t + (H - t) * k / 6.2;
            const arc = new THREE.TorusGeometry(R + t + 0.0006, 0.0009, 4, 24, k % 2 ? 0.5 : 0.8);
            const mk = add(arc, markMat, 0, y, 0, [Math.PI / 2, 0, -Math.PI / 2 - 0.3]);
            mk.castShadow = false;
          }
        }
      } else if (def.shape === 'openbox') {
        const { ix, iz, H, t } = def;
        let mat;
        if (glass) mat = this.glassMaterial();
        else if (m.id === 'concrete') { mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9 }); const p = this.tex.procedural('rock'); mat.map = p.map; mat.normalMap = p.normalMap; this.tex.applyPBR(mat, 'japanese_stone_wall', 1, {}); }
        else { const p = this.tex.procedural('brushed'); mat = new THREE.MeshStandardMaterial({ color: 0xb8bdc4, metalness: 1, roughness: 0.32, normalMap: p.normalMap }); }
        const box = (w, h, d) => {
          const g = new THREE.BoxGeometry(w, h, d);
          if (!glass) { const uv = g.attributes.uv; for (let k = 0; k < uv.count; k++) uv.setXY(k, uv.getX(k) * Math.max(w, d) * 1.2, uv.getY(k) * Math.max(h, 0.2) * 1.2); }
          return g;
        };
        add(box((ix + t) * 2, t, (iz + t) * 2), mat, 0, t / 2, 0);
        add(box(t, H, (iz + t) * 2), mat, ix + t / 2, H / 2, 0);
        add(box(t, H, (iz + t) * 2), mat, -ix - t / 2, H / 2, 0);
        add(box(ix * 2, H, t), mat, 0, H / 2, iz + t / 2);
        add(box(ix * 2, H, t), mat, 0, H / 2, -iz - t / 2);
        if (glass) {
          // Black silicone/aluminium edging like a real aquarium.
          const edge = new THREE.MeshStandardMaterial({ color: 0x15171a, roughness: 0.4, metalness: 0.6 });
          const e2 = 0.012;
          for (const sx of [-1, 1]) for (const sz of [-1, 1]) add(new THREE.BoxGeometry(e2, H, e2), edge, sx * (ix + t / 2), H / 2, sz * (iz + t / 2));
          for (const y of [e2 / 2, H - e2 / 2]) {
            for (const sz of [-1, 1]) add(new THREE.BoxGeometry((ix + t) * 2, e2, e2), edge, 0, y, sz * (iz + t / 2));
            for (const sx of [-1, 1]) add(new THREE.BoxGeometry(e2, e2, (iz + t) * 2), edge, sx * (ix + t / 2), y, 0);
          }
        }
        if (m.id === 'concrete') {
          const pebbles = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9 });
          this.tex.applyPBR(pebbles, 'ganges_river_pebbles', 1, {});
          const g = new THREE.PlaneGeometry(ix * 2, iz * 2);
          const uv = g.attributes.uv; for (let k = 0; k < uv.count; k++) uv.setXY(k, uv.getX(k) * ix * 1.6, uv.getY(k) * iz * 1.6);
          add(g, pebbles, 0, t + 0.002, 0, [-Math.PI / 2, 0, 0]);
          // Capstones.
          const cap = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85 });
          this.tex.applyPBR(cap, 'granite_tile', 1, { tint: 0xbab5ab });
          add(new THREE.BoxGeometry((ix + t) * 2 + 0.06, 0.05, t + 0.06), cap, 0, H + 0.025, iz + t / 2);
          add(new THREE.BoxGeometry((ix + t) * 2 + 0.06, 0.05, t + 0.06), cap, 0, H + 0.025, -iz - t / 2);
          add(new THREE.BoxGeometry(t + 0.06, 0.05, iz * 2), cap, ix + t / 2, H + 0.025, 0);
          add(new THREE.BoxGeometry(t + 0.06, 0.05, iz * 2), cap, -ix - t / 2, H + 0.025, 0);
        }
      } else {
        const mat = m.id === 'steel'
          ? new THREE.MeshStandardMaterial({ color: 0xb8bdc4, metalness: 1, roughness: 0.3, normalMap: this.tex.procedural('brushed').normalMap })
          : this.material('concrete', m, e);
        for (const part of e.parts) {
          const g = new THREE.BoxGeometry(part.hx * 2, part.hy * 2, part.hz * 2);
          const mesh = add(g, mat, part.off[0], part.off[1], part.off[2]);
          mesh.quaternion.set(part.q[0], part.q[1], part.q[2], part.q[3]);
        }
      }
    }

    syncBodies() {
      const THREE = this.THREE, s = this.s, live = new Set();
      const thermalMode = s.renderMode === 'thermal';
      const tmp = [0, 0, 0];
      for (const e of this.sim.bodies.list) {
        live.add(e.id);
        let rec = this.meshes.get(e.id);
        if (!rec) rec = this.makeBodyMesh(e);
        const b = e.cb, g = rec.group;
        g.position.set(b.position.x, b.position.y, b.position.z);
        g.quaternion.set(b.quaternion.x, b.quaternion.y, b.quaternion.z, b.quaternion.w);
        if (!e.container) g.scale.setScalar(e.scale);
        if (rec.lid) { const on = !!e.props.sealed; rec.lid.visible = on; if (rec.lid.userData.knob) rec.lid.userData.knob.visible = on; }
        if (e.inv) this.updateInvention(e, rec);
        // Incandescence, charring, selection glow, thermal camera.
        const hot = e.T > 750 ? clamp((e.T - 750) / 1500, 0, 1) : 0;
        const sel = this.selected === e ? 0.12 + 0.1 * Math.sin(this.time * 6) : 0;
        // Frost: anything well below freezing (that isn't ice itself) grows a pale, icy coat.
        const frost = !e.container && PC.MATS[e.mat].id !== 'water' && e.T < 255 ? clamp((255 - e.T) / 130, 0, 1) : 0;
        const wantsFx = hot > 0 || sel > 0 || thermalMode || e.burnt > 0 || frost > 0 || rec.fx;
        if (!wantsFx) continue;
        rec.fx = hot > 0 || sel > 0 || thermalMode || e.burnt > 0 || frost > 0;
        rec.mats.forEach((mat, k) => {
          if (!mat.emissive) return;
          if (!mat.userData.own) { const c = mat.clone(); c.userData.own = true; if (c.color) c.userData.baseColor = c.color.clone(); c.userData.baseRough = c.roughness; rec.group.traverse((o) => { if (o.material === mat) o.material = c; }); rec.mats[k] = c; mat = c; }
          if (mat.color && mat.userData.baseColor && !(e.burnt > 0)) { mat.color.copy(mat.userData.baseColor).lerp(this.FROST || (this.FROST = new THREE.Color(0.86, 0.93, 1.0)), frost * 0.65); if (mat.roughness != null) mat.roughness = mat.userData.baseRough + (0.85 - mat.userData.baseRough) * frost * 0.6; }
          if (thermalMode) { thermal(e.T, tmp); mat.emissive.setRGB(tmp[0], tmp[1], tmp[2]); mat.emissiveIntensity = 0.9; return; }
          const c = bb(e.T), k2 = hot * hot * 4;
          mat.emissive.setRGB(c[0] * k2 + sel * 0.4, c[1] * k2 + sel * 0.7, c[2] * k2 + sel);
          mat.emissiveIntensity = 1;
          if (e.burnt > 0 && mat.color) mat.color.setRGB(1 - e.burnt * 0.8, 1 - e.burnt * 0.85, 1 - e.burnt * 0.9);
        });
      }
      for (const [id, rec] of this.meshes) {
        if (live.has(id)) continue;
        this.scene.remove(rec.group);
        rec.group.traverse((o) => { if (o.isMesh && o.material && o.material.userData.own) o.material.dispose(); });
        this.meshes.delete(id);
      }
    }

    // Invention state → visuals: glowing filaments/tubes/embers, a light for each lit device, the mercury column.
    updateInvention(e, rec) {
      const THREE = this.THREE, inv = e.inv;
      const on = inv.lit || false;
      for (const o of rec.glow) {
        const lit = (o.userData.always && e.invention !== 'campfire') || on;
        const k = lit ? (e.invention === 'campfire' ? (o.userData.soft ? 0.25 : 0.9) * (1 + 0.35 * Math.sin(this.time * 9 + o.id) * Math.sin(this.time * 5.3)) : e.invention === 'bulb' ? 3 : e.invention === 'neon' ? 1.6 : 1.5) : 0;
        if (e.invention === 'neon' && inv.color && o.material.userData.glowColor !== inv.color) { o.material.color.set(inv.color); o.material.emissive.set(inv.color); o.material.userData.glowColor = inv.color; }
        o.material.emissiveIntensity = k;
        if (o.userData.light && lit) {
          this.invLights = this.invLights || [];
          const p = o.getWorldPosition(new THREE.Vector3());
          this.invLightReq.push({ p, color: e.invention === 'neon' ? inv.color || o.userData.light : o.userData.light, I: e.invention === 'bulb' ? 2.2 : e.invention === 'campfire' ? 3 : 0.8 });
        }
      }
      if (rec.column) {
        const T = inv.reading || e.T, c = rec.column.userData.column;
        const t = Math.max(0, Math.min(1, (T - 233) / (473 - 233)));
        rec.column.scale.y = c.base + (c.max - c.base) * t;
      }
    }

    flushInventionLights() {
      const THREE = this.THREE;
      this.invLights = this.invLights || [];
      const req = (this.invLightReq || []).slice(0, 4);
      while (this.invLights.length < req.length) { const L = new THREE.PointLight(0xffffff, 0, 3, 2); L.castShadow = false; this.scene.add(L); this.invLights.push(L); }
      this.invLights.forEach((L, k) => {
        const r = req[k];
        if (!r) { L.intensity = 0; L.visible = false; return; }
        L.visible = true; L.position.copy(r.p); L.color.set(r.color); L.intensity = r.I;
      });
      this.invLightReq = [];
    }

    // ------------------------------------------------------------------ fx
    initFx() {
      const THREE = this.THREE;
      const cap = 6000;
      const geo = new THREE.BufferGeometry();
      this.sparkPos = new Float32Array(cap * 6); this.sparkCol = new Float32Array(cap * 6);
      geo.setAttribute('position', new THREE.BufferAttribute(this.sparkPos, 3).setUsage(THREE.DynamicDrawUsage));
      geo.setAttribute('color', new THREE.BufferAttribute(this.sparkCol, 3).setUsage(THREE.DynamicDrawUsage));
      geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
      this.sparkLines = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ vertexColors: true, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, toneMapped: false }));
      this.sparkLines.frustumCulled = false;
      this.sparkLines.layers.set(LAYER_TRANSPARENT);
      this.scene.add(this.sparkLines);
      this.sparks = [];
      this.sparkCap = cap;

      // Explosion lights.
      this.lights = [];
      for (let k = 0; k < 4; k++) {
        const L = new THREE.PointLight(0xffaa55, 0, 0, 2);
        L.castShadow = false;
        this.scene.add(L);
        this.lights.push({ L, life: 0, max: 1, peak: 0 });
      }
      // Flash sprites and shockwave shells.
      const soft = this.tex.softSprite();
      this.flashes = [];
      this.flashMat = new THREE.SpriteMaterial({ map: soft, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, toneMapped: false });
      this.shockGeo = new THREE.SphereGeometry(1, 48, 24);
      this.shockMat = new THREE.ShaderMaterial({
        transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
        uniforms: { uAlpha: { value: 1 }, uColor: { value: new THREE.Color(1, 0.9, 0.7) } },
        vertexShader: 'varying vec3 vN; varying vec3 vV; void main(){ vec4 mv = modelViewMatrix*vec4(position,1.); vN = normalize(normalMatrix*normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix*mv; }',
        fragmentShader: 'uniform float uAlpha; uniform vec3 uColor; varying vec3 vN; varying vec3 vV; void main(){ float f = pow(1.0 - abs(dot(vN, vV)), 3.0); gl_FragColor = vec4(uColor * f * uAlpha * 2.0, 1.0); }',
      });
      this.shocks = [];
      // Cursor ring.
      this.cursor = new THREE.Mesh(new THREE.RingGeometry(0.93, 1, 64), new THREE.MeshBasicMaterial({ color: 0x7cc4ff, transparent: true, opacity: 0.8, depthTest: false, depthWrite: false, side: THREE.DoubleSide }));
      this.cursor.renderOrder = 999;
      this.cursor.layers.set(LAYER_TRANSPARENT);
      this.cursor.visible = false;
      this.scene.add(this.cursor);
      this.cursorDot = new THREE.Mesh(new THREE.CircleGeometry(0.012, 16), this.cursor.material);
      this.cursorDot.layers.set(LAYER_TRANSPARENT); this.cursorDot.renderOrder = 999;
      this.scene.add(this.cursorDot);
      // Selection box.
      this.selBox = new THREE.Box3Helper(new THREE.Box3(), 0x7cc4ff);
      this.selBox.layers.set(LAYER_TRANSPARENT);
      this.selBox.visible = false;
      this.scene.add(this.selBox);
      this.selRing = new THREE.Mesh(new THREE.RingGeometry(0.96, 1, 64), new THREE.MeshBasicMaterial({ color: 0x7cc4ff, transparent: true, opacity: 0.7, depthWrite: false, side: THREE.DoubleSide }));
      this.selRing.rotation.x = -Math.PI / 2; this.selRing.layers.set(LAYER_TRANSPARENT); this.selRing.visible = false;
      this.scene.add(this.selRing);
      this.labelLayer = document.getElementById('labels');
    }

    spark(x, y, z, vx, vy, vz, life, color, g) {
      if (this.sparks.length >= this.sparkCap) return;
      const c = typeof color === 'string' ? PC.hexToRgb(color).map((v) => v / 255) : color;
      this.sparks.push({ x, y, z, vx, vy, vz, life, max: life, c, g: g == null ? 9.81 : g });
    }
    flash(x, y, z, size, color, life, light) {
      const THREE = this.THREE;
      const sp = new THREE.Sprite(this.flashMat.clone());
      sp.material.color.set(color || '#ffffff').multiplyScalar(3);
      sp.position.set(x, y, z); sp.scale.setScalar(size);
      sp.layers.set(LAYER_TRANSPARENT);
      this.scene.add(sp);
      this.flashes.push({ sp, life, max: life, size });
      if (light) {
        const L = this.lights.reduce((a, b) => (a.life < b.life ? a : b));
        L.L.position.set(x, y + 0.1, z); L.L.color.set(color || '#ffaa55');
        L.peak = light; L.life = L.max = life * 1.5;
      }
    }
    label(x, y, z, text, color, big, icon) {
      if (!this.labelLayer || !this.s.showLabels) return;
      const el = document.createElement('div');
      el.className = 'wlabel' + (big ? ' big' : '');
      if (icon && PC.ico) { el.innerHTML = PC.ico(icon); el.appendChild(document.createTextNode(' ' + text)); } else el.textContent = text;
      el.style.color = color || '#fff';
      this.labelLayer.appendChild(el);
      this.labels.push({ el, x, y, z, life: big ? 2.2 : 1.4, max: big ? 2.2 : 1.4 });
      if (this.labels.length > 24) { const l = this.labels.shift(); l.el.remove(); }
    }

    consumeEvents(onEvent) {
      const ev = this.sim.events, s = this.s;
      for (const e of ev) {
        if (onEvent) onEvent(e);
        switch (e.type) {
          case 'spawn':
            this.flash(e.x, e.y, e.z, e.R * 1.6, e.color, 0.35);
            for (let k = 0; k < 20; k++) {
              const u = Math.random() * 2 - 1, a = Math.random() * 6.28, q = Math.sqrt(1 - u * u), d = e.R * 1.4;
              this.spark(e.x + Math.cos(a) * q * d, e.y + u * d, e.z + Math.sin(a) * q * d, -Math.cos(a) * q * d * 3, -u * d * 3, -Math.sin(a) * q * d * 3, 0.3, [0.6, 0.8, 1.4], 0);
            }
            if (e.label) this.label(e.x, e.y + e.R + 0.15, e.z, e.label, '#ffffff');
            break;
          case 'explosion': {
            this.ripples.addDrop(e.x, e.z, e.R * 0.6, -0.03);
            if (e.annihilation) { this.annihilationFx(e); break; }
            const P = e.power, col = e.nuclear ? '#f4ffe0' : e.color || '#ffcf70';
            this.flash(e.x, e.y, e.z, e.R * (e.nuclear ? 3 : 1.6), col, e.nuclear ? 0.9 : 0.45, Math.min(4000, 60 + P * 60) * (e.nuclear ? 6 : 1));
            this.shockwave(e.x, e.y, e.z, e.R * (e.nuclear ? 2.5 : 1.4), e.nuclear ? 1.4 : 0.45);
            const n = Math.min(260, 20 + P * 6);
            for (let k = 0; k < n; k++) {
              const u = Math.random() * 1.6 - 0.6, a = Math.random() * 6.28, q = Math.sqrt(Math.max(0, 1 - u * u)), sp = 2 + Math.random() * (4 + Math.sqrt(P) * 2);
              this.spark(e.x, e.y, e.z, Math.cos(a) * q * sp, u * sp + 1, Math.sin(a) * q * sp, 0.6 + Math.random() * 0.9, Math.random() < 0.5 ? [2.5, 2, 1.2] : [2.4, 1.1, 0.3]);
            }
            this.shake = Math.min(0.25, this.shake + Math.min(0.15, 0.01 + P * 0.003) * (e.nuclear ? 2 : 1));
            if (e.nuclear) this.label(e.x, e.y + 1, e.z, 'Nuclear detonation', '#b6ff8a', true, 'radiation');
            break;
          }
          case 'flash':
            if (this.flashes.length < 60) this.flash(e.x, e.y, e.z, (e.size || 0.1) * 2.5, e.color, 0.2, e.size > 0.2 ? 30 : 0);
            break;
          case 'sparks':
            for (let k = 0; k < (e.n || 3) * 2; k++) this.spark(e.x, e.y, e.z, (Math.random() - 0.5) * 2, 1 + Math.random() * 2.5, (Math.random() - 0.5) * 2, 0.4 + Math.random() * 0.5, e.color || '#ffb347');
            break;
          case 'decay': {
            const u = Math.random() * 2 - 1, a = Math.random() * 6.28, q = Math.sqrt(1 - u * u);
            this.spark(e.x, e.y, e.z, Math.cos(a) * q * 3, u * 3, Math.sin(a) * q * 3, 0.35, [0.5, 2, 0.5], 0);
            break;
          }
          case 'label': this.label(e.x, e.y, e.z, e.text, e.color); break;
          case 'invention':
            this.label(e.x, e.y + 0.1, e.z, e.inv.label + (e.first ? ' invented!' : ''), '#ffe38a', true, 'gear');
            for (let k = 0; k < 40; k++) {
              const u = Math.random() * 2 - 1, a = Math.random() * 6.28, q = Math.sqrt(1 - u * u);
              this.spark(e.x, e.y - 0.15, e.z, Math.cos(a) * q * 1.5, Math.abs(u) * 2 + 0.5, Math.sin(a) * q * 1.5, 0.6, [2.2, 1.9, 1.1], 0);
            }
            break;
          case 'firework': {
            const c = new this.THREE.Color(e.color);
            const col = [c.r * 3, c.g * 3, c.b * 3];
            this.flash(e.x, e.y, e.z, 1.2, e.color, 0.5, 120);
            for (let k = 0; k < 420; k++) {
              const u = Math.random() * 2 - 1, a = Math.random() * 6.28, q = Math.sqrt(1 - u * u), sp = 3 + Math.random() * 1.2;
              this.spark(e.x, e.y, e.z, Math.cos(a) * q * sp, u * sp, Math.sin(a) * q * sp, 1.4 + Math.random() * 0.8, Math.random() < 0.15 ? [3, 2.6, 2] : col);
            }
            break;
          }
          case 'discover': if (e.x != null) this.label(e.x, e.y + 0.2, e.z, PC.phaseName(e.mat, e.phase), '#ffe38a', true, 'sparkle'); break;
          case 'toolfx': this.spark(e.x, e.y, e.z, 0, e.color === '#ff7b2e' ? 0.6 : -0.2, 0, 0.5, e.color === '#ff7b2e' ? [2, 0.8, 0.3] : [0.5, 1.2, 2], 0); break;
          case 'windfx':
            for (let k = 0; k < 2; k++) this.spark(e.x + (Math.random() - 0.5) * 0.6, e.y + Math.random() * 0.4, e.z + (Math.random() - 0.5) * 0.6, e.dx * 6, 0, e.dz * 6, 0.35, [0.5, 0.55, 0.6], 0);
            break;
        }
      }
      ev.length = 0;
    }

    // Matter–antimatter annihilation: an instantaneous gamma-ray flash (no chemical fireball),
    // a violet-white plasma core, a hard pressure shell and straight gamma streaks.
    annihilationFx(e) {
      const P = e.power;
      this.flash(e.x, e.y, e.z, e.R * 3.5, '#f3eeff', 0.35, Math.min(9000, 800 + P * 90));
      this.flash(e.x, e.y, e.z, e.R * 1.2, '#b98cff', 0.9, 0);
      this.shockwave(e.x, e.y, e.z, e.R * 1.8, 0.35);
      this.shockwave(e.x, e.y, e.z, e.R * 0.9, 0.7);
      const n = Math.min(220, 40 + P * 2);
      for (let k = 0; k < n; k++) {
        const u = Math.random() * 2 - 1, a = Math.random() * 6.28, q = Math.sqrt(1 - u * u), sp = 25 + Math.random() * 30;
        this.spark(e.x, e.y, e.z, Math.cos(a) * q * sp, u * sp, Math.sin(a) * q * sp, 0.12 + Math.random() * 0.12, Math.random() < 0.5 ? [3, 2.8, 4] : [2, 1.2, 4], 0);
      }
      this.shake = Math.min(0.3, this.shake + 0.02 + P * 0.0015);
      const fl = document.getElementById('screenFlash');
      if (fl) { fl.style.transition = 'none'; fl.style.opacity = String(Math.min(0.9, 0.3 + P / 300)); requestAnimationFrame(() => { fl.style.transition = 'opacity .6s ease-out'; fl.style.opacity = '0'; }); }
      if (this.s.showLabels) this.label(e.x, e.y + 0.5, e.z, 'Annihilation · E = mc²', '#d9c8ff', true);
    }

    addRipple(x, z, radius, strength) { this.ripples.addDrop(x, z, radius, strength); }

    shockwave(x, y, z, R, life) {
      const THREE = this.THREE;
      const m = new THREE.Mesh(this.shockGeo, this.shockMat.clone());
      m.position.set(x, y, z);
      m.layers.set(LAYER_TRANSPARENT);
      this.scene.add(m);
      this.shocks.push({ m, R, life, max: life });
    }

    updateFx(dt) {
      // Sparks as short motion-blurred streaks.
      const P = this.sparkPos, C = this.sparkCol;
      let n = 0;
      const out = [];
      for (const s of this.sparks) {
        s.vy -= s.g * dt; s.vx *= 0.99; s.vz *= 0.99;
        s.x += s.vx * dt; s.y += s.vy * dt; s.z += s.vz * dt; s.life -= dt;
        if (s.y < 0.005) { s.y = 0.005; s.vy *= -0.3; s.vx *= 0.6; s.vz *= 0.6; }
        if (s.life <= 0) continue;
        out.push(s);
        const t = s.life / s.max, o = n * 6;
        P[o] = s.x; P[o + 1] = s.y; P[o + 2] = s.z;
        P[o + 3] = s.x - s.vx * 0.025; P[o + 4] = s.y - s.vy * 0.025; P[o + 5] = s.z - s.vz * 0.025;
        C[o] = s.c[0] * t; C[o + 1] = s.c[1] * t; C[o + 2] = s.c[2] * t; C[o + 3] = 0; C[o + 4] = 0; C[o + 5] = 0;
        n++;
      }
      this.sparks = out;
      const g = this.sparkLines.geometry;
      g.setDrawRange(0, n * 2);
      g.attributes.position.needsUpdate = true; g.attributes.color.needsUpdate = true;
      g.attributes.position.updateRanges = [{ start: 0, count: n * 6 }]; g.attributes.color.updateRanges = [{ start: 0, count: n * 6 }];
      for (const f of this.flashes) {
        f.life -= dt;
        const t = Math.max(0, f.life / f.max);
        f.sp.material.opacity = t;
        f.sp.scale.setScalar(f.size * (1.4 - 0.4 * t));
        if (f.life <= 0) { this.scene.remove(f.sp); f.sp.material.dispose(); }
      }
      this.flashes = this.flashes.filter((f) => f.life > 0);
      for (const L of this.lights) {
        L.life = Math.max(0, L.life - dt);
        L.L.intensity = L.max ? L.peak * Math.pow(L.life / L.max, 2) : 0;
      }
      for (const s of this.shocks) {
        s.life -= dt;
        const t = 1 - Math.max(0, s.life / s.max);
        s.m.scale.setScalar(0.05 + s.R * (1 - Math.pow(1 - t, 3)));
        s.m.material.uniforms.uAlpha.value = (1 - t) * 0.9;
        if (s.life <= 0) { this.scene.remove(s.m); s.m.material.dispose(); }
      }
      this.shocks = this.shocks.filter((s) => s.life > 0);
      // World labels (DOM).
      const v = new this.THREE.Vector3(), w = this.cssW, h = this.cssH;
      for (const l of this.labels) {
        l.life -= dt; l.y += dt * 0.12;
        v.set(l.x, l.y, l.z).project(this.camera);
        const on = v.z < 1 && l.life > 0;
        l.el.style.display = on ? '' : 'none';
        if (on) { l.el.style.transform = `translate(${(v.x * 0.5 + 0.5) * w}px, ${(-v.y * 0.5 + 0.5) * h}px) translate(-50%, -50%)`; l.el.style.opacity = Math.min(1, l.life / l.max * 3); }
      }
      this.labels = this.labels.filter((l) => { if (l.life > 0) return true; l.el.remove(); return false; });
    }

    updateCursor() {
      const m = this.mouse;
      const colors = { stir: 0x7cc4ff, grab: 0xffffff, wind: 0xbfe3ff, heat: 0xff7b2e, cool: 0x7fd8ff, explode: 0xffcc55, erase: 0xff5d73, pour: 0x9dff8a };
      if (!m || !m.point || !m.over) { this.cursor.visible = false; this.cursorDot.visible = false; return; }
      this.cursor.visible = true; this.cursorDot.visible = true;
      this.cursor.material.color.setHex(colors[m.tool] || 0xffffff);
      const n = new this.THREE.Vector3(m.normal[0], m.normal[1], m.normal[2]);
      for (const o of [this.cursor, this.cursorDot]) {
        o.position.set(m.point[0] + n.x * 0.004, m.point[1] + n.y * 0.004, m.point[2] + n.z * 0.004);
        o.lookAt(o.position.x + n.x, o.position.y + n.y, o.position.z + n.z);
      }
      this.cursor.scale.setScalar(this.s.brushRadius);
    }

    updateSelection() {
      const e = this.selected;
      this.selBox.visible = false; this.selRing.visible = false;
      if (!e) return;
      if (e.kind === 'body') {
        const rec = this.meshes.get(e.id);
        if (!rec || e.deleted) return;
        this.selBox.box.setFromObject(rec.group);
        this.selBox.visible = true;
        this.selBox.material.color.setHSL(0.57, 0.9, 0.6 + 0.15 * Math.sin(this.time * 6));
      } else {
        const st = this.sim.fluid.groupStats(e);
        if (!st.count) return;
        const R = Math.max(0.12, Math.cbrt(st.count) * this.sim.fluid.sp * 0.8);
        this.selRing.position.set(st.cx, 0.006, st.cz);
        this.selRing.scale.setScalar(R);
        this.selRing.visible = true;
        this.selRing.material.opacity = 0.5 + 0.3 * Math.sin(this.time * 6);
      }
    }

    // ------------------------------------------------------------------ post-processing
    initPost() {
      const THREE = this.THREE, A = this.A;
      this.composer = new A.EffectComposer(this.renderer, new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType }));
      this.texPass = new A.TexturePass(null);
      this.bloom = new A.UnrealBloomPass(new THREE.Vector2(4, 4), 0.35, 0.5, 2.4);
      this.output = new A.OutputPass();
      this.smaa = new A.SMAAPass(4, 4);
      this.composer.addPass(this.texPass);
      this.composer.addPass(this.bloom);
      this.composer.addPass(this.output);
      this.composer.addPass(this.smaa);
    }

    resize(w, h) {
      const THREE = this.THREE, s = this.s;
      const pr = Math.min(2, window.devicePixelRatio || 1) * s.renderScale;
      this.cssW = w; this.cssH = h; this.pr = pr;
      this.renderer.setPixelRatio(pr);
      this.renderer.setSize(w, h, false);
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
      const W = Math.max(1, Math.round(w * pr)), H = Math.max(1, Math.round(h * pr));
      if (this.sceneRT) { this.sceneRT.dispose(); this.compRT.dispose(); }
      const depth = new THREE.DepthTexture(W, H);
      depth.type = THREE.UnsignedIntType;
      this.sceneRT = new THREE.WebGLRenderTarget(W, H, { type: THREE.HalfFloatType, depthTexture: depth, depthBuffer: true });
      this.compRT = new THREE.WebGLRenderTarget(W, H, { type: THREE.HalfFloatType, depthBuffer: true });
      this.compRT.depthTexture = depth;
      if (this.glassBgRT) this.glassBgRT.dispose();
      this.glassBgRT = new THREE.WebGLRenderTarget(W, H, { type: THREE.HalfFloatType, depthBuffer: false });
      this.fluid.resize(W, H, Math.min(1, 0.6 * s.fluidQuality));
      this.powderFx.resize(W, H, Math.min(1, 0.6 * s.fluidQuality));
      if (this.compRT2) this.compRT2.dispose();
      this.compRT2 = new THREE.WebGLRenderTarget(W, H, { type: THREE.HalfFloatType, depthBuffer: true });
      this.compRT2.depthTexture = depth;
      this.composer.setPixelRatio(pr);
      this.composer.setSize(w, h);
    }

    // ------------------------------------------------------------------ picking
    raycast(sx, sy, opts) {
      const THREE = this.THREE;
      const ndc = new THREE.Vector2((sx / this.cssW) * 2 - 1, -(sy / this.cssH) * 2 + 1);
      this.raycaster.setFromCamera(ndc, this.camera);
      const ray = this.raycaster.ray;
      let best = null;
      const objs = [];
      for (const rec of this.meshes.values()) objs.push(rec.group);
      const hits = this.raycaster.intersectObjects(objs, true);
      for (const hHit of hits) {
        let o = hHit.object, ent = null;
        while (o && !ent) { ent = o.userData.entity; o = o.parent; }
        if (!ent) continue;
        const n = hHit.face ? hHit.face.normal.clone().transformDirection(hHit.object.matrixWorld) : new THREE.Vector3(0, 1, 0);
        best = { point: [hHit.point.x, hHit.point.y, hHit.point.z], normal: [n.x, n.y, n.z], entity: ent, dist: hHit.distance };
        break;
      }
      // Ground plane.
      if (ray.direction.y < -1e-4) {
        const t = -ray.origin.y / ray.direction.y;
        if (!best || t < best.dist) best = { point: [ray.origin.x + ray.direction.x * t, 0, ray.origin.z + ray.direction.z * t], normal: [0, 1, 0], entity: null, dist: t };
      }
      // Particle surfaces (march along the ray).
      const f = this.sim.fluid;
      if (f.count && !(opts && opts.noParticles)) {
        const maxT = best ? best.dist : 40, step = f.r;
        for (let t = 0.05; t < maxT; t += step) {
          const x = ray.origin.x + ray.direction.x * t, y = ray.origin.y + ray.direction.y * t, z = ray.origin.z + ray.direction.z * t;
          if (y > 12) continue;
          const i = f.nearest(x, y, z, f.r * 1.4);
          if (i >= 0) { best = { point: [x, y, z], normal: [-ray.direction.x, -ray.direction.y, -ray.direction.z], entity: null, dist: t, particle: i }; if (f.phase[i] !== GAS) { best.normal = [0, 1, 0]; break; } }
        }
      }
      return best;
    }
    // Point on a vertical plane facing the camera through `anchor` (for dragging).
    dragPoint(sx, sy, anchor) {
      const THREE = this.THREE;
      const ndc = new THREE.Vector2((sx / this.cssW) * 2 - 1, -(sy / this.cssH) * 2 + 1);
      this.raycaster.setFromCamera(ndc, this.camera);
      const n = new THREE.Vector3(); this.camera.getWorldDirection(n); n.y = 0; n.normalize();
      const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(n, new THREE.Vector3(anchor[0], anchor[1], anchor[2]));
      const p = new THREE.Vector3();
      if (!this.raycaster.ray.intersectPlane(plane, p)) return null;
      return [p.x, Math.max(0.02, p.y), p.z];
    }
    // Moves the camera target along the workspace.
    pan(dx, dz) {
      const THREE = this.THREE, ctl = this.controls;
      const fwd = new THREE.Vector3(); this.camera.getWorldDirection(fwd); fwd.y = 0; fwd.normalize();
      const right = new THREE.Vector3().crossVectors(fwd, new THREE.Vector3(0, 1, 0));
      const d = right.multiplyScalar(dx).add(fwd.multiplyScalar(dz));
      const hw = this.s.worldWidth / 2 + 2, hd = this.s.worldDepth / 2 + 2;
      const nx = clamp(ctl.target.x + d.x, -hw, hw) - ctl.target.x, nz = clamp(ctl.target.z + d.z, -hd, hd) - ctl.target.z;
      ctl.target.x += nx; ctl.target.z += nz;
      this.camera.position.x += nx; this.camera.position.z += nz;
    }
    focus(x, y, z) {
      const ctl = this.controls, dx = x - ctl.target.x, dz = z - ctl.target.z;
      ctl.target.set(x, Math.max(0.1, y), z);
      this.camera.position.x += dx; this.camera.position.z += dz;
    }

    // ------------------------------------------------------------------ frame
    render(dt) {
      const THREE = this.THREE, r = this.renderer, s = this.s, cam = this.camera;
      this.time += dt; this.frame++;
      this.controls.update();
      const ctl = this.controls;
      // Keep the camera above ground and the target inside the world.
      const hw = s.worldWidth / 2 + 2;
      if (ctl.target.x > hw || ctl.target.x < -hw) { const nx = clamp(ctl.target.x, -hw, hw), dx = nx - ctl.target.x; ctl.target.x = nx; cam.position.x += dx; }
      if (cam.position.y < 0.08) cam.position.y = 0.08;
      if (this.skybox) this.skybox.position.set(cam.position.x, 0, cam.position.z);
      if (this.skyMesh) this.skyMesh.position.copy(cam.position);
      const shakeOff = this.shake > 0.001 ? new THREE.Vector3((Math.random() - 0.5) * this.shake, (Math.random() - 0.5) * this.shake, (Math.random() - 0.5) * this.shake) : null;
      if (shakeOff) cam.position.add(shakeOff);
      this.shake *= Math.pow(0.02, dt);
      cam.updateMatrixWorld();

      this.weather.update(dt);
      this.invLightReq = [];
      this.syncBodies();
      this.updateHumans();
      this.flushInventionLights();
      this.updateParticles();
      this.updateFx(dt);
      this.updateCursor();
      this.updateSelection();
      if (this.swayUniforms) { this.swayUniforms.uTime.value = this.time; this.swayUniforms.uWind.value = clamp(s.windSpeed / 8, 0, 3); }
      this.gridUniforms.uGrid.value = s.grid ? 1 : 0;

      // Sun + shadow frustum follow the view.
      const tgt = ctl.target, dist = cam.position.distanceTo(tgt);
      const ext = clamp(dist * 0.9, 3, 16);
      this.sun.position.copy(tgt).addScaledVector(this.sunDir, 30);
      this.sun.target.position.copy(tgt);
      this.sun.target.updateMatrixWorld();
      const sc = this.sun.shadow.camera;
      if (sc.right !== ext) { sc.left = -ext; sc.right = ext; sc.top = ext; sc.bottom = -ext; sc.near = 1; sc.far = 80; sc.updateProjectionMatrix(); }
      if (s.environment === 'studio') r.toneMappingExposure = s.exposure;

      // Pass 1: opaque scene → sceneRT (HDR + depth).
      r.shadowMap.needsUpdate = s.shadows !== 'off';
      cam.layers.set(LAYER_OPAQUE);
      r.setRenderTarget(this.sceneRT);
      r.setClearColor(this.clearColor || 0x000000, 1);
      r.clear(true, true, false);
      r.render(this.scene, cam);
      r.shadowMap.needsUpdate = false;

      // Pass 2a: fine powders as a continuous granular surface → compRT2.
      let target = this.sceneRT;
      const f = this.sim.fluid;
      // Resting powders are real height-field meshes now (PileSurfaces), not a screen-space pass.
      const nPowder = 0;
      if (nPowder > 0) {
        this.powderFx.linearizeSceneDepth(r, this.sceneRT, cam);
        this.powderFx.render(r, cam, this.sceneRT, this.compRT2, {
          time: this.time, ripple: 0, windDir: new THREE.Vector2(1, 0), sunDir: this.sunDir.clone(),
          sunColor: this.sunColor.clone().multiplyScalar(this.sun.intensity / 3), ambient: new THREE.Color(0.28, 0.32, 0.36).multiplyScalar(this.envIntensity || 1),
          env: this.scene.environment, envIntensity: this.envIntensity || 1, thermal: false, grainMap: this.grainTex.map, grainNormal: this.grainTex.normalMap, sun: this.sun,
        });
        target = this.compRT2;
      }
      // Pass 2b: liquids (screen-space) → compRT (shares the depth buffer).
      // Ripple sources: floating/moving bodies in liquid.
      for (const e of this.sim.bodies.list) {
        if (!e.submerged || e.container) continue;
        const v = e.cb.velocity, sp = Math.hypot(v.x, v.y * 1.5, v.z) + e.cb.angularVelocity.length() * 0.05;
        if (sp > 0.03) this.ripples.addDrop(e.cb.position.x, e.cb.position.z, Math.max(e.dims[0], e.dims[2]) * 1.2, Math.min(0.02, sp * 0.004) * (this.frame % 2 ? 1 : -1));
      }
      this.ripples.step(r, this.fluid);
      const nLiquid = this.fluid.gather((i, out) => this.particleColor(i, out),
        (i) => (f.phase[i] === LIQUID && !this.matMud[f.mat[i]]) || (f.phase[i] === SOLID && !this.matPowder[f.mat[i]]));
      if (nLiquid > 0) {
        this.fluid.linearizeSceneDepth(r, target, cam);
        const W = [0, 0, 0];
        this.sim.windAt(tgt.x, 0.3, tgt.z, this.sim.time, W);
        const windSp = Math.hypot(W[0], W[2]);
        const sunView = this.sunDir.clone();
        this.fluid.render(r, cam, target, this.compRT, {
          time: this.time, ripple: 0.025 + Math.min(1.6, windSp * 0.14), windDir: new THREE.Vector2(W[0] || 1, W[2] || 0.3),
          sunDir: sunView, sunColor: this.sunColor.clone().multiplyScalar(this.sun.intensity / 3), ambient: new THREE.Color(0.28, 0.32, 0.36).multiplyScalar(this.envIntensity || 1),
          env: this.scene.environment, envIntensity: this.envIntensity || 1, thermal: s.renderMode === 'thermal', ripples: this.ripples,
        });
        target = this.compRT;
      }

      // Pass 3: transparent objects (glass, ice, smoke, fire, sparks, cursor). Glass refracts a copy of the frame.
      if (this.glassMat) {
        this.fluid.copyMat.uniforms.tMap.value = target.texture;
        this.fluid.fs(r, this.fluid.copyMat, this.glassBgRT);
        this.updateGlass(this.glassBgRT.texture);
      }
      cam.layers.set(LAYER_TRANSPARENT);
      r.setRenderTarget(target);
      r.render(this.scene, cam);
      cam.layers.set(LAYER_OPAQUE);
      if (shakeOff) cam.position.sub(shakeOff);

      // Post: bloom → tone mapping → SMAA.
      this.bloom.enabled = s.bloom;
      this.bloom.strength = s.bloomStrength;
      this.texPass.map = target.texture;
      r.setRenderTarget(null);
      this.composer.render(dt);
    }

    // Top-down overview for the minimap.
    drawMinimap(ctx, w, h) {
      const s = this.s, f = this.sim.fluid, W = s.worldWidth, D = s.worldDepth;
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = 'rgba(12,18,30,0.85)'; ctx.fillRect(0, 0, w, h);
      const sx = w / W, sz = h / D;
      ctx.fillStyle = 'rgba(255,255,255,0.06)';
      for (let x = 0; x < W; x++) ctx.fillRect(x * sx, 0, 1, h);
      for (let k = 0; k < f.nAct; k += 2) {
        const i = f.act[k];
        if (!f.alive[i]) continue;
        const m = PC.MATS[f.mat[i]];
        ctx.fillStyle = f.mat[i] === f.FIRE ? '#ff8a2a' : m.phaseColors[f.phase[i] === GAS ? 'gas' : f.phase[i] === LIQUID ? 'liquid' : 'solid'];
        ctx.fillRect((f.x[i] + W / 2) * sx, (f.z[i] + D / 2) * sz, 1.5, 1.5);
      }
      for (const e of this.sim.bodies.list) {
        const b = e.cb, m = PC.MATS[e.mat];
        const hx = e.container ? (e.def.ix || e.def.R || e.def.hx || 0.3) : e.dims[0], hz = e.container ? (e.def.iz || e.def.R || e.def.hz || 0.3) : e.dims[2];
        ctx.fillStyle = e.container ? 'rgba(200,230,255,0.35)' : m.color;
        ctx.fillRect((b.position.x - hx + W / 2) * sx, (b.position.z - hz + D / 2) * sz, Math.max(2, hx * 2 * sx), Math.max(2, hz * 2 * sz));
      }
      // View frustum footprint.
      const t = this.controls.target, dist = this.camera.position.distanceTo(t);
      const half = Math.tan(this.camera.fov * Math.PI / 360) * dist * this.camera.aspect;
      ctx.strokeStyle = '#7cc4ff'; ctx.lineWidth = 1.5;
      ctx.strokeRect((t.x - half + W / 2) * sx, 1, half * 2 * sx, h - 2);
      ctx.fillStyle = 'rgba(124,196,255,0.9)';
      ctx.beginPath(); ctx.arc((this.camera.position.x + W / 2) * sx, clamp((this.camera.position.z + D / 2) * sz, 3, h - 3), 3, 0, 6.28); ctx.fill();
    }
  }

  PC.View3D = View3D;
})(window.PC);
