// Nature: time of day (sun path, colour, night), clouds, rain (streaks, splashes, ripples, wet ground,
// optional collection in containers), snow (flakes, snow cover), fog and lightning (bolts, flash,
// thunder, strikes that heat and ignite whatever they hit).
(function (PC) {
  'use strict';
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

  PC.WEATHER_PRESETS = {
    clear: { cloudCover: 0, rain: 0, snow: 0, fog: 0.05, lightning: false },
    cloudy: { cloudCover: 0.75, rain: 0, snow: 0, fog: 0.15, lightning: false },
    rain: { cloudCover: 0.85, rain: 0.6, snow: 0, fog: 0.25, lightning: false },
    storm: { cloudCover: 1, rain: 1, snow: 0, fog: 0.35, lightning: true, windSpeed: 11, windGust: 1 },
    snow: { cloudCover: 0.7, rain: 0, snow: 0.7, fog: 0.3, lightning: false, ambientT: 266 },
    fog: { cloudCover: 0.5, rain: 0, snow: 0, fog: 0.85, lightning: false },
  };

  class Weather {
    constructor(view) {
      const THREE = view.THREE;
      this.view = view; this.T = THREE; this.s = view.s; this.sim = view.sim;
      this.wet = 0; this.snowCover = 0; this.flashBoost = 0; this.nextStrike = 4;
      this.sunDir = new THREE.Vector3(); this.tmpC = new THREE.Color();
      // Rain streaks.
      const RN = this.RN = 9000;
      this.rainPos = new Float32Array(RN * 6); this.rainSeed = new Float32Array(RN * 3);
      for (let k = 0; k < RN; k++) { this.rainSeed[k * 3] = Math.random(); this.rainSeed[k * 3 + 1] = Math.random(); this.rainSeed[k * 3 + 2] = Math.random(); }
      const rg = new THREE.BufferGeometry();
      rg.setAttribute('position', new THREE.BufferAttribute(this.rainPos, 3).setUsage(THREE.DynamicDrawUsage));
      rg.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
      this.rain = new THREE.LineSegments(rg, new THREE.LineBasicMaterial({ color: 0xbfd0e0, transparent: true, opacity: 0.32, depthWrite: false }));
      this.rain.frustumCulled = false; this.rain.layers.set(1); this.rain.visible = false;
      view.scene.add(this.rain);
      // Snow flakes.
      const SN = this.SN = 6000;
      this.snowPos = new Float32Array(SN * 3); this.snowSeed = new Float32Array(SN * 3);
      for (let k = 0; k < SN; k++) { this.snowSeed[k * 3] = Math.random(); this.snowSeed[k * 3 + 1] = Math.random(); this.snowSeed[k * 3 + 2] = Math.random(); }
      const sg = new THREE.BufferGeometry();
      sg.setAttribute('position', new THREE.BufferAttribute(this.snowPos, 3).setUsage(THREE.DynamicDrawUsage));
      sg.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
      this.snow = new THREE.Points(sg, new THREE.PointsMaterial({ color: 0xffffff, size: 0.025, map: view.tex.softSprite(), transparent: true, opacity: 0.9, depthWrite: false, sizeAttenuation: true }));
      this.snow.frustumCulled = false; this.snow.layers.set(1); this.snow.visible = false;
      view.scene.add(this.snow);
      // Lightning bolt.
      const bg = new THREE.BufferGeometry();
      this.boltPos = new Float32Array(64 * 6);
      bg.setAttribute('position', new THREE.BufferAttribute(this.boltPos, 3).setUsage(THREE.DynamicDrawUsage));
      this.bolt = new THREE.LineSegments(bg, new THREE.LineBasicMaterial({ color: new THREE.Color(6, 6, 9), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
      this.bolt.frustumCulled = false; this.bolt.layers.set(1); this.bolt.visible = false;
      view.scene.add(this.bolt);
      this.boltLife = 0;
    }

    // Sun direction from the hour (06:00 sunrise in the east, 18:00 sunset in the west).
    sunFor(h) {
      const alt = Math.sin(Math.PI * (h - 6) / 12);
      const el = alt * 65 * Math.PI / 180, az = ((h - 6) / 12 * 180 + 90 + (this.s.sunAzimuth - 150)) * Math.PI / 180;
      this.sunDir.set(Math.cos(el) * Math.cos(az), Math.sin(el), Math.cos(el) * Math.sin(az)).normalize();
      return alt;
    }

    update(dt) {
      const s = this.s, v = this.view, THREE = this.T;
      if (s.dayLength > 0) s.timeOfDay = (s.timeOfDay + dt * 24 / (s.dayLength * 60)) % 24;
      if (s.environment === 'studio') { this.rain.visible = this.snow.visible = false; return; }
      const alt = this.sunFor(s.timeOfDay);
      const day = smooth(-0.1, 0.22, alt), golden = smooth(0.38, 0.02, alt) * day, cloud = s.cloudCover;
      // Sun or moon.
      const sunC = new THREE.Color(1, 0.95, 0.86).lerp(new THREE.Color(1, 0.52, 0.26), golden);
      let dir = this.sunDir.clone(), inten = 3.4 * day * (1 - 0.85 * cloud);
      if (alt < 0.02) { dir.set(-dir.x, Math.max(0.35, -dir.y), -dir.z).normalize(); sunC.setRGB(0.55, 0.64, 1); inten = 0.35 * (1 - 0.7 * cloud) * smooth(0.02, -0.15, alt); }
      if (dir.y < 0.12) { dir.y = 0.12; dir.normalize(); }
      this.flashBoost = Math.max(0, this.flashBoost - dt * 5);
      v.setSun(dir, sunC, inten + this.flashBoost * 8);
      v.sun.shadow.intensity = 1 - 0.75 * cloud;
      // Sky / environment brightness and tint.
      const env = (0.03 + 0.97 * day) * (1 - 0.4 * cloud) + this.flashBoost * 2;
      v.envIntensity = env;
      v.scene.environmentIntensity = env;
      const tint = new THREE.Color(0.06, 0.08, 0.16).lerp(new THREE.Color(1, 1, 1), day);
      tint.lerp(new THREE.Color(1, 0.72, 0.55), golden * 0.6);
      const grey = (tint.r + tint.g + tint.b) / 3;
      tint.lerp(new THREE.Color(grey, grey, grey * 1.04), cloud * 0.7).multiplyScalar(1 - 0.45 * cloud + this.flashBoost);
      if (v.skybox) v.skybox.material.color.copy(tint);
      if (v.skyMesh && v.skyMesh.material.uniforms) {
        v.skyMesh.material.uniforms.sunPosition.value.copy(this.sunDir);
        v.skyMesh.material.uniforms.rayleigh.value = 1.2 + golden * 2;
        v.skyMesh.material.uniforms.turbidity.value = 3 + cloud * 12;
      }
      // Fog.
      if (v.scene.fog) {
        const fogCol = tint.clone().multiplyScalar(0.72).lerp(new THREE.Color(0.62, 0.68, 0.74), cloud * 0.4 * day);
        v.scene.fog.color.copy(fogCol);
        v.scene.fog.near = 30 * (1 - s.fog) + 1.5;
        v.scene.fog.far = 110 * (1 - 0.92 * s.fog) + 8;
      }
      v.renderer.toneMappingExposure = s.exposure * (1 + (1 - day) * 0.9);

      this.updateRain(dt);
      this.updateSnow(dt);
      this.updateSurfaces(dt);
      this.updateLightning(dt);
    }

    area() { const t = this.view.controls.target; return [t.x, t.z]; }

    updateRain(dt) {
      const s = this.s, rain = s.rain;
      this.rain.visible = rain > 0.01;
      if (!this.rain.visible) return;
      const [cx, cz] = this.area(), P = this.rainPos, S = this.rainSeed, n = Math.round(this.RN * rain);
      const W = [0, 0, 0];
      this.sim.windAt(cx, 2, cz, this.sim.time, W);
      const t = this.sim.time + performance.now() / 1000, H = 14, B = 11;
      const fall = 9.5, len = 0.32;
      for (let k = 0; k < n; k++) {
        const sx = S[k * 3], sy = S[k * 3 + 1], sz = S[k * 3 + 2];
        const y = H - ((t * fall + sy * H * 7.3) % H);
        const drift = (H - y) / fall;
        const x = cx + (sx - 0.5) * B * 2 + W[0] * drift * 0.7, z = cz + (sz - 0.5) * B * 2 + W[2] * drift * 0.7;
        const o = k * 6;
        P[o] = x; P[o + 1] = y; P[o + 2] = z;
        P[o + 3] = x - W[0] * 0.03; P[o + 4] = y + len; P[o + 5] = z - W[2] * 0.03;
      }
      const g = this.rain.geometry;
      g.setDrawRange(0, n * 2);
      g.attributes.position.needsUpdate = true;
      g.attributes.position.updateRanges = [{ start: 0, count: n * 6 }];
      this.rain.material.opacity = 0.18 + 0.2 * rain;
      // Splashes on the ground and raindrop rings on liquids.
      const v = this.view;
      for (let k = 0; k < Math.round(rain * 14); k++) {
        const x = cx + (Math.random() - 0.5) * 12, z = cz + (Math.random() - 0.5) * 9;
        v.spark(x, 0.01, z, (Math.random() - 0.5) * 0.6, 0.6 + Math.random() * 0.8, (Math.random() - 0.5) * 0.6, 0.18, [0.7, 0.75, 0.8]);
      }
      for (let k = 0; k < Math.round(rain * 18); k++) {
        v.addRipple(cx + (Math.random() - 0.5) * 12, cz + (Math.random() - 0.5) * 8, 0.025 + Math.random() * 0.02, 0.002 + Math.random() * 0.002);
      }
      // Rain collects in open containers.
      if (s.rainFills) {
        const f = this.sim.fluid, water = PC.matIndex('water');
        for (const e of this.sim.bodies.list) {
          if (!e.bindId || !e.def) continue;
          const d = e.def, area = d.shape === 'cup' ? Math.PI * d.R * d.R : 4 * d.ix * d.iz;
          if (Math.random() > rain * area * 1.2 * dt * 60 * 0.05) continue;
          const b = e.cb.position, rx = (Math.random() - 0.5) * 2 * (d.ix || d.R) * 0.8, rz = (Math.random() - 0.5) * 2 * (d.iz || d.R) * 0.8;
          f.add(water, b.x + rx, b.y + d.H - 0.05, b.z + rz, 285, null, 0, -3, 0);
        }
      }
    }

    updateSnow(dt) {
      const s = this.s, snow = s.snow;
      this.snow.visible = snow > 0.01;
      if (!this.snow.visible) return;
      const [cx, cz] = this.area(), P = this.snowPos, S = this.snowSeed, n = Math.round(this.SN * snow);
      const W = [0, 0, 0];
      this.sim.windAt(cx, 2, cz, this.sim.time, W);
      const t = performance.now() / 1000, H = 10, B = 9;
      for (let k = 0; k < n; k++) {
        const sx = S[k * 3], sy = S[k * 3 + 1], sz = S[k * 3 + 2];
        const fall = 0.6 + sy * 0.5, y = H - ((t * fall + sy * H * 13.1) % H), age = (H - y) / fall;
        P[k * 3] = cx + (sx - 0.5) * B * 2 + Math.sin(t * 1.3 + sx * 40) * 0.25 + W[0] * age * 0.6;
        P[k * 3 + 1] = y;
        P[k * 3 + 2] = cz + (sz - 0.5) * B * 2 + Math.cos(t * 1.1 + sz * 40) * 0.25 + W[2] * age * 0.6;
      }
      const g = this.snow.geometry;
      g.setDrawRange(0, n);
      g.attributes.position.needsUpdate = true;
      g.attributes.position.updateRanges = [{ start: 0, count: n * 3 }];
      void dt;
    }

    // Wet (darker, glossy) or snow-covered terrace and ground.
    updateSurfaces(dt) {
      const s = this.s, v = this.view;
      this.wet = clamp(this.wet + (s.rain > 0.05 ? dt * s.rain * 0.08 : -dt * 0.015), 0, 1);
      this.snowCover = clamp(this.snowCover + (s.snow > 0.05 && s.ambientT < 275 ? dt * s.snow * 0.03 : -dt * 0.01), 0, 1);
      for (const mesh of [v.terrace, v.ground]) {
        const m = mesh.material;
        if (!m.userData.base) m.userData.base = { color: m.color.clone(), rough: m.roughness };
        const b = m.userData.base;
        m.color.copy(b.color).multiplyScalar(1 - 0.35 * this.wet).lerp(new this.T.Color(0.9, 0.92, 0.96), this.snowCover * 0.85);
        m.roughness = b.rough + (0.12 - b.rough) * this.wet * 0.85 * (1 - this.snowCover) + this.snowCover * 0.2;
      }
    }

    updateLightning(dt) {
      const s = this.s, v = this.view;
      if (this.boltLife > 0) {
        this.boltLife -= dt;
        this.bolt.visible = this.boltLife > 0 && (Math.random() > 0.3);
        if (this.boltLife <= 0) this.bolt.visible = false;
      }
      if (!s.lightning || s.rain < 0.2) return;
      this.nextStrike -= dt;
      if (this.nextStrike > 0) return;
      this.nextStrike = 3 + Math.random() * 9;
      this.strike();
      void v;
    }

    strike(target) {
      const v = this.view, [cx, cz] = this.area();
      // Lightning prefers tall/metal objects near the view.
      let px = cx + (Math.random() - 0.5) * 8, pz = cz + (Math.random() - 0.5) * 5, py = 0;
      const bodies = this.sim.bodies.list.filter((e) => !e.container);
      if (bodies.length && Math.random() < 0.6) {
        const e = bodies[(Math.random() * bodies.length) | 0];
        px = e.cb.position.x; pz = e.cb.position.z; py = e.cb.position.y;
      }
      if (target) [px, py, pz] = target;
      const P = this.boltPos;
      let x = px + (Math.random() - 0.5) * 6, y = 28, z = pz + (Math.random() - 0.5) * 6, k = 0;
      const segs = 40;
      for (let i = 0; i < segs; i++) {
        const t = (i + 1) / segs;
        const nx = x + (px - x) / (segs - i) + (Math.random() - 0.5) * 0.9 * (1 - t), ny = 28 + (py - 28) * t, nz = z + (pz - z) / (segs - i) + (Math.random() - 0.5) * 0.9 * (1 - t);
        P[k++] = x; P[k++] = y; P[k++] = z; P[k++] = nx; P[k++] = ny; P[k++] = nz;
        x = nx; y = ny; z = nz;
      }
      const g = this.bolt.geometry;
      g.setDrawRange(0, segs * 2);
      g.attributes.position.needsUpdate = true;
      this.bolt.visible = true;
      this.boltLife = 0.25;
      this.flashBoost = 1;
      v.flash(px, py + 0.2, pz, 2.5, '#dfe6ff', 0.3, 6000);
      const fl = document.getElementById('screenFlash');
      if (fl) { fl.style.transition = 'none'; fl.style.opacity = '0.35'; requestAnimationFrame(() => { fl.style.transition = 'opacity .5s'; fl.style.opacity = '0'; }); }
      // Physical effect: intense heat at the strike point.
      const f = this.sim.fluid;
      f.forEachNear(px, py, pz, 0.45, (j, d2) => { f.T[j] += 3500 * (1 - Math.sqrt(d2) / 0.45); });
      for (const e of this.sim.bodies.list) if (Math.hypot(e.cb.position.x - px, e.cb.position.z - pz) < 0.6) e.T += 2500;
      this.sim.explode(px, py + 0.05, pz, 2, { color: '#dfe6ff' });
      v.addRipple(px, pz, 0.4, 0.03);
      this.thunder(Math.hypot(px - v.camera.position.x, pz - v.camera.position.z));
    }

    // Synthesised thunder: low-passed noise with a delayed, rolling envelope.
    thunder(dist) {
      try {
        const ac = this.ac || (this.ac = new (window.AudioContext || window.webkitAudioContext)());
        if (ac.state === 'suspended') ac.resume();
        const len = 4, buf = ac.createBuffer(1, ac.sampleRate * len, ac.sampleRate), d = buf.getChannelData(0);
        let last = 0;
        for (let i = 0; i < d.length; i++) { last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02; d[i] = last * 3.5; }
        const src = ac.createBufferSource(); src.buffer = buf;
        const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 300;
        const gn = ac.createGain();
        const t0 = ac.currentTime + Math.min(3, dist / 343);
        gn.gain.setValueAtTime(0, t0); gn.gain.linearRampToValueAtTime(0.9, t0 + 0.05); gn.gain.exponentialRampToValueAtTime(0.01, t0 + len);
        src.connect(lp); lp.connect(gn); gn.connect(ac.destination);
        src.start(t0);
      } catch (e) { /* audio unavailable */ }
    }
  }

  PC.Weather = Weather;
})(window.PC);
