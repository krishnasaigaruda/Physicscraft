// Boot: waits for Three.js / cannon-es (ES modules from the CDN), then wires simulation, 3D view and UI,
// runs the main loop, persists settings and discoveries, and provides optional demo scenarios.
(function (PC) {
  'use strict';

  const store = {
    get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* storage unavailable */ } },
  };

  // ---------------------------------------------------------------- demo scenarios (the workspace starts empty)
  const E = (app, key) => app.ui.entryByKey[key];
  const spawn = (app, key, p, opts) => app.sim.spawn(E(app, key), p, opts || {});
  const later = (app, frames, fn) => app.timers.push({ at: app.sim.frame + frames, fn });

  PC.SCENARIOS = {
    pond: {
      label: 'Koi pond in the breeze',
      build(app, x, z) {
        spawn(app, 'pool', [x, 0, z]);
        spawn(app, 'water', [x, 0.15, z], { count: 3200, shape: 'sheet' });
        later(app, 150, () => { spawn(app, 'wood', [x - 0.6, 0.5, z]); spawn(app, 'stone', [x + 0.9, 0.5, z + 0.3]); });
        later(app, 260, () => { app.settings.windSpeed = 4; app.ui.syncWind(); });
      },
    },
    alkali: {
      label: 'Alkali metals in water',
      build(app, x, z) {
        spawn(app, 'aquarium', [x, 0, z]);
        spawn(app, 'water', [x, 0.1, z], { count: 2600, shape: 'sheet' });
        later(app, 150, () => spawn(app, 'Li', [x - 0.55, 0.6, z]));
        later(app, 210, () => spawn(app, 'Na', [x - 0.1, 0.6, z]));
        later(app, 300, () => spawn(app, 'K', [x + 0.35, 0.6, z]));
        later(app, 420, () => spawn(app, 'Cs', [x + 0.7, 0.6, z]));
      },
    },
    ice: {
      label: 'Ice cubes melting in water',
      build(app, x, z) {
        spawn(app, 'tank', [x, 0, z]);
        spawn(app, 'water', [x, 0.1, z], { count: 1600, shape: 'sheet', T: 310 });
        for (let k = 0; k < 4; k++) later(app, 120 + k * 25, () => spawn(app, 'ice', [x + (k - 1.5) * 0.25, 0.7, z + (k % 2 ? 0.1 : -0.1)], { T: 250 }));
      },
    },
    thermite: {
      label: 'Thermite in a crucible',
      build(app, x, z) {
        spawn(app, 'crucible', [x, 0, z]);
        const g = spawn(app, 'thermite', [x, 0.05, z], { count: 110 });
        later(app, 120, () => app.sim.ignite(g));
      },
    },
    lava: {
      label: 'Lava pours into water',
      build(app, x, z) {
        spawn(app, 'aquarium', [x + 0.4, 0, z]);
        spawn(app, 'water', [x + 0.4, 0.1, z], { count: 2200, shape: 'sheet' });
        for (let k = 0; k < 5; k++) later(app, 120 + k * 40, () => spawn(app, 'lava', [x - 0.2, 0.5, z], { count: 110, shape: 'column' }));
      },
    },
    hydrogen: {
      label: 'Hydrogen + oxygen detonation',
      build(app, x, z) {
        spawn(app, 'tank', [x, 0, z]);
        spawn(app, 'H', [x, 0.1, z], { count: 400, shape: 'cloud' });
        spawn(app, 'O', [x, 0.1, z], { count: 200, shape: 'cloud' });
        for (let k = 0; k < 6; k++) spawn(app, 'wall', [x - 1.4 + (k % 3) * 0.05, 0, z - 0.4 + k * 0.15], { size: 0.5 });
        later(app, 60, () => spawn(app, 'fire', [x, 0.1, z], { count: 30 }));
      },
    },
    critical: {
      label: 'Critical mass (uranium)',
      build(app, x, z) {
        spawn(app, 'U', [x, 0, z]);
        later(app, 90, () => spawn(app, 'U', [x, 0.9, z]));
      },
    },
    density: {
      label: 'Density column',
      build(app, x, z) {
        spawn(app, 'tank', [x, 0, z]);
        spawn(app, 'Hg', [x, 0.05, z], { count: 500, shape: 'sheet' });
        later(app, 90, () => spawn(app, 'water', [x, 0.3, z], { count: 700, shape: 'sheet' }));
        later(app, 190, () => spawn(app, 'oil', [x, 0.5, z], { count: 500, shape: 'sheet' }));
        later(app, 330, () => spawn(app, 'Fe', [x - 0.2, 0.7, z]));
        later(app, 360, () => spawn(app, 'wood', [x + 0.2, 0.7, z]));
        later(app, 390, () => spawn(app, 'Au', [x, 0.8, z + 0.1]));
      },
    },
    acid: {
      label: 'Metals in acid',
      build(app, x, z) {
        ['Mg', 'Zn', 'Fe', 'Cu', 'Au'].forEach((m, k) => {
          const bx = x + (k - 2) * 0.45;
          spawn(app, 'beaker', [bx, 0, z]);
          spawn(app, 'acid', [bx, 0.05, z], { count: 150, shape: 'column' });
          later(app, 120 + k * 20, () => spawn(app, m, [bx, 0.5, z], { size: 0.5 }));
        });
      },
    },
  };

  function fail(msg) {
    const el = document.getElementById('loading');
    if (el) { el.classList.remove('hidden'); el.querySelector('.ld-msg').textContent = msg; el.querySelector('.ld-bar').style.display = 'none'; }
  }

  function start() {
    const THREE = window.THREE, A = window.THREE_ADDONS, CANNON = window.CANNON;
    if (!THREE || !CANNON) { fail('Could not load the 3D engine (Three.js / cannon-es) from the CDN. Check your internet connection and reload.'); return; }
    const SETTINGS_VERSION = 4;
    let saved = store.get('pc.settings3d') || {};
    if (saved._v !== SETTINGS_VERSION) saved = { _v: SETTINGS_VERSION };
    const settings = Object.assign({}, PC.DEFAULT_SETTINGS, saved, { _v: SETTINGS_VERSION });
    const canvas = document.getElementById('view');
    const stage = document.getElementById('stage');

    const app = {
      settings, canvas, paused: false, stepOnce: false, timers: [], captureNext: null,
      save() {
        clearTimeout(this._saveT);
        this._saveT = setTimeout(() => {
          store.set('pc.settings3d', settings);
          store.set('pc.discovered3d', [...this.sim.discovered]);
        }, 300);
      },
      resize() {
        const w = Math.max(50, stage.clientWidth), h = Math.max(50, stage.clientHeight);
        this.view.resize(w, h);
      },
      rebuild() {
        store.set('pc.settings3d', settings);
        store.set('pc.discovered3d', [...this.sim.discovered]);
        location.reload();
      },
      loadScenario(key) {
        const sc = PC.SCENARIOS[key];
        if (!sc) return;
        this.history.mark('Scenario');
        this.sim.clear();
        this.timers = [];
        this.ui.closePanel();
        const t = this.view.controls.target;
        this.history.clearRing();
        sc.build(this, Math.round(t.x * 10) / 10, 0);
        this.ui.toast({ title: 'Scenario', name: sc.label, info: true });
        this.paused = false;
        this.ui.syncPlay();
      },
    };

    app.sim = new PC.Sim(settings, CANNON);
    app.history = new PC.History(app.sim);
    for (const k of store.get('pc.discovered3d') || []) app.sim.discovered.add(k);
    try {
      app.view = new PC.View3D(canvas, app.sim, settings, THREE, A);
    } catch (err) {
      console.error(err);
      fail('WebGL 2 is required. Your browser or GPU could not create a 3D context.');
      return;
    }
    try { app.view.icons = new PC.IconFactory(app.view); } catch (err) { console.warn('3D icons unavailable', err); }
    app.audio = new PC.Audio(app.view);
    app.ui = new PC.UI(app);
    app.ui.syncSound();
    app.ui.bindIcons();
    app.view.onStatus = (msg) => app.ui.toast({ title: 'Environment', name: msg, info: true });
    app.resize();
    window.addEventListener('resize', () => app.resize());
    new ResizeObserver(() => app.resize()).observe(stage);
    document.getElementById('speedSel').value = String(settings.timeScale);
    // First-run guidance is the home screen + guided tour now (Help stays one keypress away).

    const mini = document.getElementById('minimap'), miniWrap = document.getElementById('minimapWrap'), miniCtx = mini.getContext('2d');
    let last = performance.now(), fps = 60, first = true;

    function frame(now) {
      requestAnimationFrame(frame);
      const dtMs = Math.min(100, now - last);
      last = now;
      fps += (1000 / Math.max(dtMs, 1) - fps) * 0.05;
      const frameDt = Math.min(2, Math.max(0.25, dtMs / 16.667));
      const { sim, view, ui } = app;

      ui.frameInput(frameDt);
      if (!app.paused || app.stepOnce) {
        sim.step(app.stepOnce ? 1 : frameDt);
        app.stepOnce = false;
        app.history.tick();
        for (let k = app.timers.length - 1; k >= 0; k--) if (sim.frame >= app.timers[k].at) { const t = app.timers.splice(k, 1)[0]; t.fn(); }
      } else sim.step(0);
      view.consumeEvents((e) => { ui.onWorldEvent(e); app.audio.event(e); });
      if (view.frame % 6 === 0) app.audio.ambience();
      view.render(app.paused ? 0 : dtMs / 1000);
      ui.instruments.update(dtMs / 1000, sim.time);
      if (app.captureNext) { const cb = app.captureNext; app.captureNext = null; cb(canvas.toDataURL('image/png')); }
      ui.afterFrame();
      if (first) { first = false; document.getElementById('loading').classList.add('hidden'); ui.projects.show(); }

      if (view.icons && view.frame > 20) view.icons.tick(view.frame < 600 ? 3 : 2);
      if (view.frame % 30 === 0) { ui.refreshNature(); ui.refreshInventions(); }
      if (view.frame % 3 === 0) ui.updateProbe();
      if (view.frame % 12 === 0) { ui.updateHud(fps); ui.refreshEntityStats(); }
      // Automatic quality: if the frame rate stays low, render at a lower resolution (down to half).
      if (settings.autoQuality && !app.paused && view.frame > 300) {
        app.slowFor = fps < 28 ? (app.slowFor || 0) + dtMs / 1000 : 0;
        if (app.slowFor > 4 && settings.renderScale > 0.55) {
          app.slowFor = 0;
          ui.applySetting('renderScale', Math.max(0.5, +(settings.renderScale - 0.15).toFixed(2)), true);
          ui.refreshSettingsValues();
          ui.toast({ title: 'Lowered render quality', name: `Resolution ${Math.round(settings.renderScale * 100)}%`, sub: 'Turn off in Settings → Graphics', info: true });
        }
      }
      miniWrap.classList.toggle('hidden', !settings.showMinimap);
      if (settings.showMinimap && view.frame % 6 === 0) {
        const w = Math.max(50, miniWrap.clientWidth | 0), h = Math.max(20, miniWrap.clientHeight | 0);
        if (mini.width !== w || mini.height !== h) { mini.width = w; mini.height = h; }
        view.drawMinimap(miniCtx, w, h);
      }
    }
    requestAnimationFrame(frame);
    window.PhysicsCraft = app;
  }

  if (window.__libsReady) start();
  else {
    window.addEventListener('libs-ready', start, { once: true });
    window.addEventListener('libs-failed', () => fail('Could not load the 3D engine from the CDN. Check your internet connection and reload.'), { once: true });
  }
})(window.PC);
