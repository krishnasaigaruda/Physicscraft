// User interface: toolbar, sidebar (basics / periodic table / containers / discoveries), drag & drop into
// the 3D workspace, properties panel for materials and live entities, settings drawer, help, toasts,
// hover probe, HUD, minimap and keyboard/camera controls.
(function (PC) {
  'use strict';
  const $ = (s, r = document) => r.querySelector(s);
  const h = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const esc = (s) => PC.escapeHtml(String(s));
  const { SOLID, POWDER, LIQUID, GAS } = PC.PHASE;

  function fmt(v) {
    if (v == null || Number.isNaN(v)) return '—';
    if (v >= 1e8) return '∞';
    const a = Math.abs(v);
    if (a >= 1e5) return v.toExponential(2).replace('e+', 'e');
    if (a >= 100) return v.toFixed(0);
    if (a >= 10) return v.toFixed(1);
    if (a >= 1) return v.toFixed(2);
    if (a === 0) return '0';
    if (a < 0.001) return v.toExponential(1);
    return v.toFixed(3);
  }
  const kToC = (k) => k - 273.15;
  const PHASE_LABEL = ['Solid', 'Powder', 'Liquid', 'Gas'];
  const PHASE_COLORS = ['#8fa3c7', '#d8b878', '#4c9dff', '#dfe8ff'];
  const fmtKg = (kg) => (kg >= 1000 ? fmt(kg / 1000) + ' t' : kg >= 1 ? fmt(kg) + ' kg' : fmt(kg * 1000) + ' g');

  function toSlider(v, d) {
    if (d.log) { const a = Math.log(d.min), b = Math.log(d.max); return 1000 * (Math.log(clamp(v, d.min, d.max)) - a) / (b - a); }
    return 1000 * (clamp(v, d.min, d.max) - d.min) / (d.max - d.min);
  }
  function fromSlider(t, d) {
    let v = d.log ? Math.exp(Math.log(d.min) + (Math.log(d.max) - Math.log(d.min)) * t / 1000) : d.min + (d.max - d.min) * t / 1000;
    if (d.step) v = Math.round(v / d.step) * d.step;
    if (d.int) v = Math.round(v);
    return v;
  }

  const PROP_SCHEMA = [
    { section: 'Physical', key: 'density', label: 'Density', unit: 'g/cm³', min: 0.01, max: 30, log: true },
    { section: 'Physical', key: 'massScale', label: 'Mass multiplier', unit: '×', min: 0.05, max: 20, log: true },
    { section: 'Physical', key: 'gravity', label: 'Gravity scale', unit: '×', min: -1, max: 3, step: 0.05 },
    { section: 'Physical', key: 'friction', label: 'Friction', unit: 'μ', min: 0, max: 1, step: 0.01 },
    { section: 'Physical', key: 'restitution', label: 'Bounciness', unit: 'e', min: 0, max: 0.95, step: 0.01, particles: true },
    { section: 'Physical', key: 'viscosity', label: 'Viscosity', unit: '', min: 0, max: 0.9, step: 0.01, particles: true },
    { section: 'Physical', key: 'stiffness', label: 'Stiffness (frozen)', unit: '', min: 0.05, max: 1, step: 0.01, particles: true },
    { section: 'Physical', key: 'strength', label: 'Tensile strength', unit: '', min: 0, max: 3, step: 0.01 },
    { section: 'Physical', key: 'cohesion', label: 'Surface tension', unit: '×', min: 0, max: 5, step: 0.05, particles: true },
    { section: 'Physical', key: 'pressure', label: 'Incompressibility', unit: '×', min: 0.2, max: 4, step: 0.05, particles: true },
    { section: 'Physical', key: 'drag', label: 'Air drag', unit: '×', min: 0, max: 10, step: 0.1, particles: true },
    { section: 'Thermal', key: 'mp', label: 'Melting point', unit: 'K', min: 0, max: 8000, step: 1, inf: true },
    { section: 'Thermal', key: 'bp', label: 'Boiling point', unit: 'K', min: 0, max: 8000, step: 1, inf: true },
    { section: 'Thermal', key: 'ignite', label: 'Ignition point', unit: 'K', min: 1, max: 5000, step: 1, when: (m) => !!m.burn },
    { section: 'Thermal', key: 'heatCap', label: 'Specific heat', unit: 'J/g·K', min: 0.05, max: 10, log: true },
    { section: 'Thermal', key: 'cond', label: 'Thermal conductivity', unit: '', min: 0, max: 2, step: 0.01 },
    { section: 'Chemical', key: 'reactivity', label: 'Reactivity', unit: '×', min: 0, max: 10, step: 0.05 },
    { section: 'Chemical', key: 'explosive', label: 'Explosive yield', unit: '×', min: 0, max: 20, step: 0.1, when: (m) => (m.burn && m.burn.explode) || m.fissile || (m.el && m.el.reactivity >= 2) || m.id === 'antimatter' },
    { section: 'Chemical', key: 'radioactivity', label: 'Decay / fission rate', unit: '×', min: 0, max: 50, step: 0.1, when: (m) => m.radioactive || m.fissile },
    { section: 'Visual', key: 'color', label: 'Colour', type: 'color' },
    { section: 'Visual', key: 'opacity', label: 'Opacity', unit: '', min: 0.1, max: 1, step: 0.01, particles: true },
    { section: 'Visual', key: 'glow', label: 'Glow', unit: '', min: 0, max: 3, step: 0.05, particles: true },
    { section: 'Visual', key: 'pinned', label: 'Pinned (static in place)', type: 'toggle' },
  ];

  const SETTINGS_SCHEMA = {
    Graphics: [
      { key: 'quality', label: 'Quality preset', type: 'presets' },
      { key: 'environment', label: 'Environment', type: 'select', options: [['garden', 'Japanese garden (HDRI photo)'], ['day', 'Clear day (procedural sky)'], ['sunset', 'Sunset'], ['night', 'Night'], ['studio', 'Studio lab']] },
      { key: 'sunElevation', label: 'Sun elevation (procedural sky)', unit: '°', min: 2, max: 88, step: 1 },
      { key: 'sunAzimuth', label: 'Sun azimuth (procedural sky)', unit: '°', min: 0, max: 360, step: 1 },
      { key: 'exposure', label: 'Exposure', unit: '×', min: 0.2, max: 3, step: 0.05 },
      { key: 'renderMode', label: 'Render mode', type: 'select', options: [['realistic', 'Realistic'], ['thermal', 'Thermal camera']] },
      { key: 'renderScale', label: 'Resolution scale', unit: '×', min: 0.4, max: 1.5, step: 0.05 },
      { key: 'shadows', label: 'Shadows', type: 'select', options: [['off', 'Off'], ['low', 'Low (1024)'], ['high', 'High (2048)'], ['ultra', 'Ultra (4096)']] },
      { key: 'fluidQuality', label: 'Liquid surface resolution', unit: '×', min: 0.5, max: 2, step: 0.1 },
      { key: 'fluidSmoothing', label: 'Liquid surface smoothing', unit: 'passes', min: 0, max: 6, step: 1 },
      { key: 'ripples', label: 'Wind ripples on liquids', type: 'toggle' },
      { key: 'bloom', label: 'Bloom / glow', type: 'toggle' },
      { key: 'bloomStrength', label: 'Bloom strength', unit: '×', min: 0, max: 2, step: 0.05 },
      { key: 'fog', label: 'Atmospheric fog', type: 'toggle' },
      { key: 'scenery', label: 'Garden scenery (rocks, ferns, grass)', type: 'toggle' },
      { key: 'grid', label: 'Measuring grid on the terrace', type: 'toggle' },
      { key: 'showLabels', label: 'Floating labels', type: 'toggle' },
      { key: 'showStats', label: 'Stats overlay', type: 'toggle' },
      { key: 'showMinimap', label: 'Minimap', type: 'toggle' },
      { key: 'autoQuality', label: 'Lower quality automatically when slow', type: 'toggle' },
      { key: 'sound', label: 'Sound effects', type: 'toggle' },
      { key: 'volume', label: 'Volume', unit: '', min: 0, max: 1, step: 0.05 },
    ],
    Simulation: [
      { key: 'gravity', label: 'Gravity', unit: 'g', min: -1, max: 3, step: 0.05 },
      { key: 'timeScale', label: 'Time scale', unit: '×', min: 0.05, max: 3, step: 0.05 },
      { key: 'substeps', label: 'Minimum substeps', unit: '', min: 1, max: 6, step: 1 },
      { key: 'solverIters', label: 'Fluid solver iterations', unit: '', min: 1, max: 8, step: 1 },
      { key: 'fluidDamping', label: 'Liquid damping', unit: '/s', min: 0, max: 2, step: 0.02 },
      { key: 'surfaceTension', label: 'Surface tension', unit: '×', min: 0, max: 5, step: 0.05 },
      { key: 'airDrag', label: 'Air resistance', unit: '×', min: 0, max: 10, step: 0.1 },
      { key: 'ambientT', label: 'Ambient temperature', unit: 'K', min: 1, max: 3000, step: 1 },
      { key: 'conduction', label: 'Heat conduction', unit: '×', min: 0, max: 5, step: 0.05 },
      { key: 'ambientExchange', label: 'Heat loss to ambient', unit: '×', min: 0, max: 10, step: 0.1 },
      { key: 'reactions', label: 'Chemical reactions & combustion', type: 'toggle' },
      { key: 'reactionSpeed', label: 'Reaction speed', unit: '×', min: 0.1, max: 5, step: 0.1 },
      { key: 'fusion', label: 'Nuclear fusion (> 10⁷ K)', type: 'toggle' },
      { key: 'fission', label: 'Nuclear fission (critical mass)', type: 'toggle' },
      { key: 'radioactivity', label: 'Radioactive decay', type: 'toggle' },
      { key: 'decaySpeed', label: 'Decay speed', unit: '×', min: 0.1, max: 200, log: true },
    ],
    Tools: [
      { key: 'brushRadius', label: 'Tool radius', unit: 'm', min: 0.05, max: 1.5, step: 0.01 },
      { key: 'heatRate', label: 'Heat / cool tool power', unit: 'K/tick', min: 1, max: 1e6, log: true },
      { key: 'explodePower', label: 'Blast yield', unit: '', min: 1, max: 300, log: true },
      { key: 'pourRate', label: 'Pour rate', unit: '×', min: 0.2, max: 5, step: 0.1 },
      { key: 'worldWidth', label: 'Workspace length', type: 'select', options: [[16, '16 m'], [30, '30 m'], [50, '50 m']], hint: 'Changing the size or particle budget resets the workspace.' },
      { key: 'maxParticles', label: 'Particle budget', type: 'select', options: [[10000, '10 000'], [20000, '20 000'], [30000, '30 000'], [40000, '40 000']] },
      { key: 'openCeiling', label: 'Open sky (gases escape upward)', type: 'toggle' },
    ],
  };

  const QUALITY = {
    low: { renderScale: 0.6, shadows: 'low', fluidQuality: 0.6, fluidSmoothing: 2, bloom: false, scenery: false },
    medium: { renderScale: 0.8, shadows: 'low', fluidQuality: 0.8, fluidSmoothing: 3, bloom: true, scenery: true },
    high: { renderScale: 1, shadows: 'high', fluidQuality: 1, fluidSmoothing: 3, bloom: true, scenery: true },
    ultra: { renderScale: 1.25, shadows: 'ultra', fluidQuality: 1.4, fluidSmoothing: 4, bloom: true, scenery: true },
  };

  const TOOLS = [
    { id: 'stir', label: 'Stir', key: '1', tip: 'Stir — drag through liquids to push them; click anything to inspect it' },
    { id: 'grab', label: 'Grab', key: '2', tip: 'Grab & throw — drag objects, liquids or whole containers' },
    { id: 'wind', label: 'Wind', key: '3', tip: 'Wind — drag to blow a gust in that direction (makes waves on water)' },
    { id: 'heat', label: 'Heat', key: '4', tip: 'Heat — hold to raise temperature' },
    { id: 'cool', label: 'Cool', key: '5', tip: 'Cool — hold to lower temperature' },
    { id: 'explode', label: 'Blast', key: '6', tip: 'Explosion — click to detonate' },
    { id: 'erase', label: 'Erase', key: '7', tip: 'Erase particles and objects' },
    { id: 'pour', label: 'Pour', key: '8', tip: 'Pour the selected material from the cursor (choose one with “Pour this” in its panel)' },
  ];

  const SVG = {
    play: '<svg viewBox="0 0 24 24"><path d="M7 5 L19 12 L7 19z" fill="currentColor"/></svg>',
    pause: '<svg viewBox="0 0 24 24"><rect x="6" y="5" width="4" height="14" rx="1" fill="currentColor"/><rect x="14" y="5" width="4" height="14" rx="1" fill="currentColor"/></svg>',
    step: '<svg viewBox="0 0 24 24"><path d="M6 5 L15 12 L6 19z" fill="currentColor"/><rect x="16" y="5" width="3" height="14" rx="1" fill="currentColor"/></svg>',
    clear: '<svg viewBox="0 0 24 24"><path d="M5 7 h14 M9 7 V5 h6 v2 M7 7 l1 13 h8 l1 -13" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>',
    shot: '<svg viewBox="0 0 24 24"><rect x="3" y="7" width="18" height="13" rx="3" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="13.5" r="3.5" fill="none" stroke="currentColor" stroke-width="2"/><path d="M8 7 l2 -3 h4 l2 3" fill="none" stroke="currentColor" stroke-width="2"/></svg>',
    help: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2"/><path d="M9.5 9.5 a2.5 2.5 0 1 1 3.5 2.3 c-.8 .4 -1 1 -1 2" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><circle cx="12" cy="17" r="1.2" fill="currentColor"/></svg>',
    gear: '<svg viewBox="0 0 24 24"><path d="M12 8.5 a3.5 3.5 0 1 0 0 7 a3.5 3.5 0 1 0 0 -7z M19.4 13 l1.9 1.5 -2 3.4 -2.3 -.9 a7.6 7.6 0 0 1 -1.9 1.1 L14.8 21 h-4 l-.3 -2.4 a7.6 7.6 0 0 1 -1.9 -1.1 l-2.3 .9 -2 -3.4 L6.2 13 a7 7 0 0 1 0 -2 L4.3 9.5 l2 -3.4 2.3 .9 a7.6 7.6 0 0 1 1.9 -1.1 L10.8 3.5 h4 l.3 2.4 a7.6 7.6 0 0 1 1.9 1.1 l2.3 -.9 2 3.4 L19.4 11 a7 7 0 0 1 0 2z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>',
    windflag: '<svg viewBox="0 0 24 24"><circle cx="9" cy="8" r="3.2" fill="#ffcf5a"/><path d="M7 21 c0 -7 4 -11 12 -12 c-1 8 -5 12 -12 12z" fill="#5fd068"/><path d="M7 21 c3 -4 6 -7 10 -9" stroke="#2f8a3d" stroke-width="1.4" fill="none"/></svg><span>Nature</span>',
  };

  class UI {
    constructor(app) {
      this.app = app;
      this.s = app.settings;
      this.tab = 'basics';
      this.templates = {};
      this.panel = null;
      this.pourEntry = null;
      this.newKeys = new Set();
      this.keys = {};
      this.mouse = { sx: 0, sy: 0, over: false, down: false, point: null, normal: [0, 1, 0], entity: null, lastPoint: null };
      this.buildEntries();
      this.buildToolbar();
      this.buildSidebar();
      this.bindCanvas();
      this.bindKeys();
      this.renderSettings();
      this.renderHelp();
      this.instruments = new PC.Instruments(this);
      // Touch screens have no hover: tap the sidebar's edge to slide it out, tap the workspace to hide it.
      $('#sidebar').addEventListener('pointerdown', (e) => { if (e.pointerType === 'touch' && innerWidth <= 640) $('#sidebar').classList.add('open'); });
      this.app.canvas.addEventListener('pointerdown', () => $('#sidebar').classList.remove('open'));
      this.onboarding = new PC.Onboarding(this);
      this.projects = new PC.Projects(this);
      this.renderHelp();
      $('#help').classList.add('hidden'); // the home screen comes first; Help is one click (H) away
      setTimeout(() => this.upgradeCustoms(), 1500);
    }

    get sim() { return this.app.sim; }
    get view() { return this.app.view; }

    // ------------------------------------------------------------------ entries
    buildEntries() {
      this.basics = PC.BASICS.map((b) => Object.assign({ kind: 'basic', icon: b.key }, b));
      this.elements = PC.ELEMENTS.map((el) => ({ kind: 'element', key: el.sym, mat: el.sym, label: el.name, T: 293, el }));
      this.containers = PC.CONTAINERS.map((c) => ({ kind: 'container', key: c.key, label: c.label, def: c, icon: c.key }));
      this.compounds = PC.MATS.filter((m) => m.kind === 'compound').map((m) => ({ kind: 'compound', key: m.id, mat: m.id, label: m.name, T: this.roomTempFor(m) }));
      this.inventions = PC.INVENTIONS.map((i) => ({ kind: 'invention', key: 'inv_' + i.key, inv: i.key, mat: PC.INVENTION_MAT[i.key], label: i.label }));
      // Materials the user found with Search (saved in this browser).
      this.extras = [{ kind: 'dummy', key: 'dummy', mat: 'plastic', label: 'Crash-test dummy' }];
      this.customs = [];
      try { this.customs = JSON.parse(localStorage.getItem('pc.custom3d') || '[]').filter((c) => c && c.key && PC.MAT[c.mat]); } catch (e) { this.customs = []; }
      const capLim = Math.min(this.s.worldWidth, this.s.worldDepth) / 2 * 0.85;
      for (const c of this.customs) if (c.modelDims) { const m = Math.max(c.modelDims[0], c.modelDims[2], c.modelDims[1] / 1.5); if (m > capLim) c.modelDims = c.modelDims.map((v) => v * capLim / m); }
      for (const c of this.customs) { if (c.cls === 'gas' && c.props && c.props.opacity === 1) c.props.opacity = 0.12; PC.CUSTOM[c.key] = c; }
      this.entryByKey = {};
      for (const e of [...this.basics, ...this.elements, ...this.containers, ...this.compounds, ...this.inventions, ...this.customs, ...this.extras]) this.entryByKey[e.key] = e;
    }
    // Realistic rendered icon (3D model photo) with the drawn SVG as a placeholder until it is ready.
    iconHtml(entry) {
      const icons = this.view && this.view.icons;
      const m = entry.mat ? PC.MAT[entry.mat] : null;
      if (entry.img) return `<img class="ic3d photo" src="${esc(entry.img)}" alt="" referrerpolicy="no-referrer">`;
      const url = icons ? icons.get(entry) : null;
      if (url) return `<img class="ic3d" src="${url}" alt="">`;
      const fallback = entry.el ? `<div class="mini-tile" style="--c:${PC.CATEGORIES[entry.el.cat].color}">${entry.el.sym}</div>` : PC.icon(entry.icon || '', m);
      return `<span class="icwrap" data-ik="${esc(entry.key)}">${fallback}</span>`;
    }
    bindIcons() {
      if (!this.view.icons || this.iconsBound) return;
      this.iconsBound = true;
      this.view.icons.onReady((k, url) => {
        for (const el of document.querySelectorAll(`[data-ik="${CSS.escape(k)}"]`)) el.outerHTML = `<img class="ic3d" src="${url}" alt="">`;
        for (const el of document.querySelectorAll(`[data-pk="${CSS.escape(k)}"]`)) { el.style.backgroundImage = `url(${url})`; el.classList.add('has'); }
      });
    }

    roomTempFor(m) {
      if (m.life) return m.id === 'smoke' || m.id === 'p4o10' ? 500 : 293;
      if (m.mp === m.bp && m.mp > 100 && m.mp < 293) return m.mp - 45;
      return 293;
    }
    isDiscovered(id) {
      for (const k of this.sim.discovered) if (k === id || k.startsWith(id + ':')) return true;
      return false;
    }

    // ------------------------------------------------------------------ toolbar
    buildToolbar() {
      const tools = $('#tools');
      for (const t of TOOLS) {
        const b = h('button', 'tb-btn tool-btn', PC.icon('tool_' + t.id) + `<span class="kbd">${t.key}</span>`);
        b.title = `${t.tip} (${t.key})`;
        b.dataset.tool = t.id;
        b.onclick = () => this.setTool(t.id);
        tools.appendChild(b);
      }
      $('#btnStep').innerHTML = SVG.step;
      $('#btnClear').innerHTML = SVG.clear;
      $('#btnShot').innerHTML = SVG.shot;
      $('#btnHelp').innerHTML = SVG.help;
      $('#btnSettings').innerHTML = SVG.gear + '<span>Settings</span>';
      $('#btnWind').innerHTML = SVG.windflag;
      $('#btnPlay').onclick = () => this.togglePause();
      for (const [id, ic] of [['btnUndo', 'undo'], ['btnRedo', 'redo'], ['btnRewind', 'rewind'], ['btnSave', 'save'], ['btnOpen', 'open'], ['btnRec', 'record'], ['btnInstr', 'chart']]) $('#' + id).innerHTML = PC.ico(ic);
      document.querySelector('#tabs [data-tab="web"]').innerHTML = PC.ico('globe') + ' Search';
      $('#btnUndo').onclick = () => this.undo();
      $('#btnRedo').onclick = () => this.redo();
      $('#btnRewind').onclick = () => this.rewind(5);
      $('#btnSave').onclick = () => this.saveScene();
      $('#btnOpen').onclick = () => $('#sceneFile').click();
      $('#sceneFile').onchange = (e) => { const file = e.target.files[0]; e.target.value = ''; if (file) this.projects.importFile(file); };
      $('#projBtn').onclick = () => this.projects.show();
      document.querySelector('#topbar .brand').onclick = () => this.projects.show();
      $('#btnRec').onclick = () => this.toggleRecording();
      $('#btnInstr').onclick = () => this.instruments.toggle();
      const syncSound = () => { $('#btnSound').innerHTML = PC.ico(this.s.sound ? 'soundOn' : 'soundOff'); if (this.app.audio) { this.app.audio.setEnabled(this.s.sound); this.app.audio.setVolume(this.s.volume); } };
      $('#btnSound').onclick = () => { this.s.sound = !this.s.sound; syncSound(); this.app.save(); this.refreshSettingsValues(); };
      this.syncSound = syncSound;
      $('#btnStep').onclick = () => { this.app.paused = true; this.app.stepOnce = true; this.syncPlay(); };
      $('#speedSel').onchange = (e) => { this.s.timeScale = +e.target.value; this.app.save(); this.refreshSettingsValues(); };
      $('#btnClear').onclick = () => this.clearWorld();
      $('#btnShot').onclick = () => this.screenshot();
      $('#btnHelp').onclick = () => this.toggleHelp();
      $('#btnSettings').onclick = () => this.toggleSettings();
      $('#btnWind').onclick = () => this.toggleNature();
      const scen = $('#scenarioSel');
      for (const [k, sc] of Object.entries(PC.SCENARIOS || {})) if (!sc.hidden) scen.appendChild(new Option(sc.label, k));
      scen.onchange = () => { if (scen.value) { this.app.loadScenario(scen.value); scen.value = ''; } };
      const ws = $('#windSpeed');
      const syncWind = () => { $('#windOut').textContent = (+this.s.windSpeed).toFixed(1) + ' m/s'; ws.value = this.s.windSpeed; };
      ws.oninput = () => { this.s.windSpeed = +ws.value; syncWind(); this.app.save(); this.refreshSettingsValues(); };
      this.syncWind = syncWind;
      syncWind();
      const bs = $('#brushSize');
      bs.value = this.s.brushRadius;
      bs.oninput = () => { this.s.brushRadius = +bs.value; $('#brushOut').textContent = (this.s.brushRadius * 100).toFixed(0) + ' cm'; this.app.save(); };
      $('#brushOut').textContent = (this.s.brushRadius * 100).toFixed(0) + ' cm';
      this.setTool('stir');
      this.syncPlay();
    }

    setTool(id) {
      this.sim.input.tool = id;
      for (const b of document.querySelectorAll('.tool-btn')) b.classList.toggle('active', b.dataset.tool === id);
      if (id === 'pour' && !this.pourEntry) {
        this.pourEntry = this.entryByKey.water;
        this.toast({ title: 'Pour', name: 'Pouring water', sub: 'Open any material and press “Pour this” to change it', info: true });
      }
      this.sim.input.entry = this.pourEntry;
      this.sim.input.entryProps = this.pourEntry ? this.templateFor(this.pourEntry).props : null;
      if (id !== 'grab') { this.sim.bodies.endGrab(); this.sim.grabParticles = null; }
    }

    togglePause() { this.app.paused = !this.app.paused; this.syncPlay(); }
    syncPlay() {
      $('#btnPlay').innerHTML = this.app.paused ? SVG.play : SVG.pause;
      $('#pausedBadge').classList.toggle('hidden', !this.app.paused);
    }
    clearWorld() { this.mark('Clear'); this.sim.clear(); this.view.selected = null; this.closePanel(); }

    // ------------------------------------------------------------------ undo / rewind / scenes / video
    get history() { return this.app.history; }
    mark(label) { if (this.history) this.history.mark(label); }
    afterRestore() { this.view.selected = null; this.closePanel(); this.view.syncBodies(); }
    undo() { this.instruments.detachAll(); const l = this.history.undoLast(); if (l) { this.afterRestore(); this.toast({ title: 'Undone', name: l, info: true }); } else this.toast({ title: 'Nothing to undo', name: '', info: true }); }
    redo() { this.instruments.detachAll(); const l = this.history.redoLast(); if (l) { this.afterRestore(); this.toast({ title: 'Redone', name: l, info: true }); } else this.toast({ title: 'Nothing to redo', name: '', info: true }); }
    rewind(sec) { this.instruments.detachAll(); if (this.history.rewind(sec)) { this.afterRestore(); this.toast({ title: 'Rewound', name: `${sec} seconds`, info: true }); } else this.toast({ title: 'Nothing to rewind yet', name: '', info: true }); }
    download(name, blob) {
      const url = URL.createObjectURL(blob), a = document.createElement('a');
      a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
    }
    stamp() { return new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-'); }
    sceneJSON() {
      const snap = PC.captureWorld(this.sim);
      // Searched materials the scene uses travel with it, so it opens the same on another computer.
      const keys = new Set();
      for (const b of snap.bodies) if (PC.CUSTOM[b.entryKey]) keys.add(b.entryKey);
      for (const g of snap.groups) if (g && PC.CUSTOM[g.entryKey]) keys.add(g.entryKey);
      const nature = {};
      for (const k of ['timeOfDay', 'dayLength', 'weather', 'cloudCover', 'rain', 'snow', 'fog', 'lightning', 'windSpeed', 'windDir', 'ambientT', 'gravity']) nature[k] = this.s[k];
      return PC.sceneToJSON(snap, { customs: [...keys].map((k) => PC.CUSTOM[k]), nature, camera: { pos: this.view.camera.position.toArray(), target: this.view.controls.target.toArray() } });
    }
    saveScene() { this.projects.save(false); }
    exportScene() { this.projects.exportFile(null); this.toast({ title: 'Exported', name: (this.projects.current ? this.projects.current.name : 'scene') + '.physicslab', sub: 'Check your Downloads folder', info: true }); }
    async openScene(file) {
      try {
        const { snap, file: o } = PC.sceneFromJSON(await file.text());
        for (const c of o.customs || []) if (c && c.key && PC.MAT[c.mat]) { PC.CUSTOM[c.key] = c; if (!this.entryByKey[c.key]) { this.customs.push(c); this.entryByKey[c.key] = c; } }
        this.saveCustoms();
        if (o.nature) { Object.assign(this.s, o.nature); this.app.save(); this.refreshSettingsValues(); if (this.syncWind) this.syncWind(); }
        this.mark('Open scene');
        this.instruments.detachAll();
        PC.restoreWorld(this.sim, snap);
        this.history.clearRing();
        if (o.camera) { this.view.camera.position.fromArray(o.camera.pos); this.view.controls.target.fromArray(o.camera.target); this.view.controls.update(); }
        this.afterRestore();
        this.renderSidebar();
        this.toast({ title: 'Scene opened', name: file.name, sub: `${snap.N.toLocaleString()} particles · ${snap.bodies.length} objects`, info: true });
      } catch (e) {
        this.toast({ title: 'Could not open scene', name: file.name, sub: String(e.message || e), info: true });
      }
    }
    toggleRecording() {
      const btn = $('#btnRec');
      if (this.recorder) { this.recorder.stop(); return; }
      if (!window.MediaRecorder || !this.app.canvas.captureStream) { this.toast({ title: 'Recording not supported', name: 'This browser cannot record the canvas', info: true }); return; }
      const stream = this.app.canvas.captureStream(30);
      const type = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm', 'video/mp4'].find((t) => MediaRecorder.isTypeSupported(t)) || '';
      const rec = new MediaRecorder(stream, type ? { mimeType: type, videoBitsPerSecond: 12e6 } : undefined);
      const chunks = [];
      rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
      rec.onstop = () => {
        this.recorder = null; btn.classList.remove('rec');
        const blob = new Blob(chunks, { type: rec.mimeType || 'video/webm' });
        this.download(`physicscraft-${this.stamp()}.${/mp4/.test(blob.type) ? 'mp4' : 'webm'}`, blob);
        this.toast({ title: 'Video saved', name: `${(blob.size / 1e6).toFixed(1)} MB`, sub: 'Check your Downloads folder', info: true });
      };
      rec.start(500);
      this.recorder = rec; btn.classList.add('rec');
      this.toast({ title: 'Recording…', name: 'Click the record button again to stop', info: true });
    }
    screenshot() {
      this.app.captureNext = (dataUrl) => {
        const a = document.createElement('a');
        a.href = dataUrl;
        a.download = `physicscraft-${new Date().toISOString().replace(/[:.]/g, '-')}.png`;
        a.click();
      };
    }

    // ------------------------------------------------------------------ sidebar
    buildSidebar() {
      for (const b of document.querySelectorAll('#tabs button')) b.onclick = () => { this.tab = b.dataset.tab; $('#search').value = ''; this.renderSidebar(); };
      $('#search').oninput = () => this.renderSidebar();
      const sb = $('#sidebar');
      try { const w = +localStorage.getItem('pc.sidebar'); if (w > 250) sb.style.width = w + 'px'; } catch (e) { /* storage unavailable */ }
      $('#sbResize').onpointerdown = (e) => {
        e.preventDefault();
        const x0 = e.clientX, w0 = sb.offsetWidth;
        const move = (ev) => { sb.style.width = clamp(w0 - (ev.clientX - x0), 280, window.innerWidth * 0.7) + 'px'; this.app.resize(); };
        const up = () => {
          window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up);
          try { localStorage.setItem('pc.sidebar', sb.offsetWidth); } catch (err) { /* ignore */ }
        };
        window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
      };
      this.renderSidebar();
      this.updateDiscCount();
    }

    renderSidebar() {
      const body = $('#sbBody');
      body.innerHTML = '';
      for (const b of document.querySelectorAll('#tabs button')) b.classList.toggle('active', b.dataset.tab === this.tab);
      const q = $('#search').value.trim().toLowerCase();
      if (q) return this.renderSearch(body, q);
      if (this.tab === 'basics') {
        body.appendChild(h('div', 'sec-title', 'Materials'));
        body.appendChild(this.cardGrid(this.basics));
        body.appendChild(h('div', 'sec-title', 'Tips'));
        body.appendChild(h('div', 'hint', 'Put an <b>Aquarium</b> or <b>Stone Pond</b> down first (Containers tab), fill it with <b>Water</b>, then drop things in. Try <b>Sodium</b>/<b>Potassium</b> (Periodic tab), a burning <b>Wood</b> plank, or turn up the <b>wind</b> to make waves.'));
      } else if (this.tab === 'periodic') {
        body.appendChild(this.periodicTable());
      } else if (this.tab === 'web') {
        this.renderWeb(body);
      } else if (this.tab === 'inventions') {
        const inv = this.sim.inventions, n = this.inventions.filter((e) => inv.isDiscovered(e.inv)).length;
        body.appendChild(h('div', 'sec-title', `Inventions — ${n} / ${this.inventions.length}`));
        body.appendChild(h('div', 'hint', 'Gather the ingredients <b>close together</b> in the workspace (within ~50 cm, or in the same container). Nothing builds itself — when everything is there, press <b>Build</b> to put the device together from them. Once invented, you can also drag it out from here.'));
        const grid = h('div', 'cards');
        const can = inv.buildable();
        this.invSig = JSON.stringify(can);
        for (const e of this.inventions) {
          const def = PC.INVENTION[e.inv], known = inv.isDiscovered(e.inv);
          const recipe = def.recipe.map((slot) => slot.map((id) => (PC.MAT[id] ? (PC.MAT[id].el ? id : PC.MAT[id].name) : id)).join('/')).join(' + ');
          const card = h('div', 'card inv' + (known ? '' : ' locked'));
          card.innerHTML = known
            ? `<div class="ic">${this.iconHtml(e)}</div><div class="nm">${esc(e.label)}</div><div class="sub">${esc(recipe)}</div>`
            : `<div class="ic"><div class="lock">?</div></div><div class="nm">${esc(def.label)}</div><div class="sub" data-recipe="${esc(recipe)}">${esc(def.hint)}</div>`;
          if (known) this.attachDrag(card, e);
          else card.onclick = () => { const sub = card.querySelector('.sub'); sub.textContent = sub.dataset.recipe; card.classList.add('revealed'); };
          if (can[e.inv]) {
            const b = h('button', 'btn primary build', PC.ico('wrench') + ' Build');
            b.title = 'Ingredients found together in the workspace — assemble them';
            b.onpointerdown = (ev) => ev.stopPropagation();
            b.onclick = (ev) => { ev.stopPropagation(); this.mark('Build ' + e.label); this.sim.inventions.build(e.inv); this.renderSidebar(); };
            card.classList.add('ready');
            card.appendChild(b);
          }
          grid.appendChild(card);
        }
        body.appendChild(grid);
        body.appendChild(h('div', 'hint', 'Click a locked invention to reveal its recipe. Rockets and fireworks launch when heated (or press <b>Launch</b> in their panel); bulbs light near a battery or a sunlit solar panel; magnets pull iron, nickel, cobalt and steel.'));
      } else if (this.tab === 'containers') {
        body.appendChild(h('div', 'sec-title', 'Vessels & structures'));
        body.appendChild(this.cardGrid(this.containers));
        body.appendChild(h('div', 'sec-title', 'Characters'));
        body.appendChild(this.cardGrid(this.extras));
        body.appendChild(h('div', 'hint', 'Containers are fixed in place. Move one with the <b>Grab</b> tool, or un-pin it in its properties so it can tip over and fall.'));
      } else {
        const found = this.compounds.filter((e) => this.isDiscovered(e.mat));
        body.appendChild(h('div', 'sec-title', `Discovered compounds — ${found.length} / ${this.compounds.length}`));
        if (!found.length) body.appendChild(h('div', 'empty', 'Nothing yet.<br>Mix materials in the workspace to discover new compounds —<br>try <b>Earth + Water</b>, <b>Lava + Water</b> or <b>Sodium + Chlorine</b>.'));
        else body.appendChild(this.cardGrid(found));
      }
    }

    cardGrid(entries) {
      const grid = h('div', 'cards');
      for (const e of entries) {
        const card = h('div', 'card' + (this.newKeys.has(e.key) ? ' new' : ''));
        const m = e.mat ? PC.MAT[e.mat] : null;
        // Searched materials show what they really are, not the built-in material they borrow behaviour from.
        const sub = e.kind === 'custom' ? (e.formula || (e.cls === e.phase ? e.phase : `${e.cls} · ${e.phase}`)) : m ? m.formula : this.containerSize(e.def);
        card.innerHTML = `<div class="ic">${this.iconHtml(e)}</div><div class="nm">${esc(e.label)}</div><div class="sub">${esc(sub)}</div>`;
        const cr = e.kind === 'custom' && this.creditInfo(e);
        if (cr) card.title = `3D model: ${cr.text} · ${cr.lic} (${cr.site})`;
        this.attachDrag(card, e);
        grid.appendChild(card);
      }
      return grid;
    }
    containerSize(def) {
      if (!def) return '';
      if (def.shape === 'cup') return `⌀${(def.R * 200).toFixed(0)} × ${(def.H * 100).toFixed(0)} cm`;
      if (def.shape === 'openbox') return `${(def.ix * 2).toFixed(1)} × ${(def.iz * 2).toFixed(1)} m`;
      return `${((def.hx || 0.5) * 2).toFixed(1)} m`;
    }

    periodicTable() {
      const wrap = h('div');
      const grid = h('div', 'ptable');
      const cells = [];
      for (let row = 1; row <= 10; row++) {
        if (row === 8) { grid.appendChild(h('div', 'pgap')); continue; }
        for (let col = 1; col <= 18; col++) {
          const el = PC.ELEMENTS.find((e) => e.row === row && e.col === col);
          if (el) {
            const t = h('div', 'ptile' + (el.state === 'Gas' ? ' gas' : el.state === 'Liquid' ? ' liquid' : ''));
            t.style.setProperty('--c', PC.CATEGORIES[el.cat].color);
            const url = this.view.icons ? this.view.icons.get(this.entryByKey[el.sym]) : null;
            t.innerHTML = `<span class="pimg${url ? ' has' : ''}" data-pk="${el.sym}" style="${url ? `background-image:url(${url})` : ''}"></span><span class="z">${el.Z}</span><span class="s">${el.sym}</span>`;
            t.dataset.cat = el.cat;
            this.attachDrag(t, this.entryByKey[el.sym]);
            t.onmouseenter = (ev) => this.showTip(ev, el);
            t.onmouseleave = () => this.hideTip();
            grid.appendChild(t);
            cells.push(t);
          } else if ((row === 6 || row === 7) && col === 3) grid.appendChild(h('div', 'pmarker', row === 6 ? '57–71' : '89–103'));
          else if (row >= 9 && col < 3) grid.appendChild(h('div', col === 2 ? 'pmarker' : '', col === 2 ? (row === 9 ? 'La' : 'Ac') : ''));
          else grid.appendChild(h('div'));
        }
      }
      wrap.appendChild(grid);
      const legend = h('div', 'legend');
      for (const [k, c] of Object.entries(PC.CATEGORIES)) {
        const s = h('span', '', `<i style="--c:${c.color}"></i>${c.label}`);
        s.onmouseenter = () => cells.forEach((t) => t.classList.toggle('dim', t.dataset.cat !== k));
        s.onmouseleave = () => cells.forEach((t) => t.classList.remove('dim'));
        legend.appendChild(s);
      }
      wrap.appendChild(legend);
      wrap.appendChild(h('div', 'state-key', '<span>Symbol colour at 20 °C:</span><span style="color:#fff">■ solid</span><span style="color:#9fd4ff">■ liquid</span><span style="color:#cfe8ff">■ gas</span>'));
      return wrap;
    }

    renderSearch(body, q) {
      const match = (e) => {
        const m = e.mat ? PC.MAT[e.mat] : null;
        return e.label.toLowerCase().includes(q) || e.key.toLowerCase() === q || (m && m.formula.toLowerCase().includes(q)) || (e.el && String(e.el.Z) === q);
      };
      const res = [...this.basics.filter(match), ...this.elements.filter(match), ...this.containers.filter(match), ...this.compounds.filter((e) => this.isDiscovered(e.mat) && match(e))].slice(0, 80);
      const mine = this.customs.filter((e) => e.label.toLowerCase().includes(q));
      res.unshift(...mine);
      body.appendChild(h('div', 'sec-title', `${res.length} result${res.length === 1 ? '' : 's'}`));
      const webBtn = h('button', 'btn primary web-btn', `${PC.ico('globe')} Find “${esc(q)}” on the web — any material on Earth or in space`);
      webBtn.onclick = () => { const raw = $('#search').value.trim(); $('#search').value = ''; this.tab = 'web'; this.webQuery = raw; this.renderSidebar(); this.runWebSearch(raw); };
      body.appendChild(webBtn);
      if (!res.length) { body.appendChild(h('div', 'empty', 'Nothing in the built-in library. Use the web search above to fetch it (real properties, photo and 3D look).')); return; }
      for (const e of res) {
        const row = h('div', 'list-row');
        const m = e.mat ? PC.MAT[e.mat] : null;
        const icon = `<div class="ic">${this.iconHtml(e)}</div>`;
        const sub = e.el ? `${PC.CATEGORIES[e.el.cat].label} · Z ${e.el.Z} · ${e.el.mass} u` : m ? m.formula : this.containerSize(e.def);
        row.innerHTML = `${icon}<div><div class="nm">${esc(e.label)}</div><div class="sub">${esc(sub)}</div></div>`;
        this.attachDrag(row, e);
        body.appendChild(row);
      }
    }

    // ------------------------------------------------------------------ web material search
    // Give saved materials a real 3D model if they don't have one yet (or were made before a model fix).
    async upgradeCustoms() {
      const THREE = this.view && this.view.THREE, A = this.view && this.view.A;
      if (!THREE) return;
      let changed = false;
      // Materials saved by an older version are rebuilt from fresh data with the current rules.
      for (let k = 0; k < this.customs.length; k++) {
        const c = this.customs[k];
        if (c.ver === 10 || !/^wd_Q\d+$/.test(c.key)) continue;
        try {
          const fresh = await PC.buildCustomMaterial(await PC.fetchMaterialFacts(c.key.slice(3)));
          await this.sizeCustomModel(fresh);
          PC.CUSTOM[fresh.key] = fresh; this.entryByKey[fresh.key] = fresh; this.customs[k] = fresh;
          delete this.templates[fresh.key];
          changed = true;
        } catch (e) {
          // Not a physical thing (an idea, software…): drop it. Network errors just wait for the next start.
          if (/not a physical/.test(e.message)) { delete PC.CUSTOM[c.key]; delete this.entryByKey[c.key]; this.customs.splice(k, 1); k--; changed = true; }
        }
      }
      for (const c of this.customs.slice()) {
        try {
          if (!['object', 'organic', 'rock', 'metal', 'glass'].includes(c.cls)) continue;
          if (c.model && c.dimsV === 2) continue;
          if (!c.model && !c.stl) {
            const facts = { label: c.label, description: c.description || '', classes: [], extract: c.extract || '' };
            const ph = await PC.matchPolyHaven(facts, c.cls);
            if (ph.model) c.model = ph.model;
            else { const stl = await PC.matchCommonsModel(facts); if (stl) c.stl = stl; }
          }
          if (c.model) { const m = await PC.loadPolyHavenModel(THREE, A, c.model); c.modelDims = m.half.map((v) => Math.max(0.005, v)); c.dimsV = 2; changed = true; }
          else if (c.stl && !c.modelDims) { const m = await PC.loadSTLModel(THREE, A, c.stl.url); const k = 0.09 / Math.max(...m.half); c.modelDims = m.half.map((v) => Math.max(0.004, v * k)); changed = true; }
        } catch (e) { /* offline: try again next start */ }
      }
      if (changed) { this.saveCustoms(); if (this.tab === 'web') this.renderSidebar(); }
    }

    // Who made the 3D model (shown when hovering an object and in its panel).
    creditInfo(cu) {
      if (!cu) return null;
      if (cu.sf) return { text: `“${cu.sf.name}” by ${cu.sf.author}`, lic: cu.sf.license, url: cu.sf.url, site: 'Sketchfab' };
      if (cu.model) return { text: 'Poly Haven 3D scan', lic: 'CC0', url: 'https://polyhaven.com/a/' + cu.model, site: 'Poly Haven' };
      if (cu.stl) return { text: cu.stl.title.replace(/\.stl$/i, ''), lic: 'Wikimedia Commons', url: cu.stl.page, site: 'Wikimedia Commons' };
      return null;
    }
    creditLine(cu) {
      const c = this.creditInfo(cu);
      return c ? `<div class="credit">3D model: ${esc(c.text)} · ${esc(c.lic)}</div>` : '';
    }

    // Switch a searched object to another 3D model; objects already in the world are rebuilt with it.
    bindAlts(body, cu, reopen) {
      for (const b of body.querySelectorAll('.cu-alt')) b.onclick = async () => {
        const alt = cu.sf.alts[+b.dataset.alt];
        if (!alt || alt.uid === cu.sf.uid) return;
        b.classList.add('busy');
        const prev = cu.sf;
        cu.sf = Object.assign({}, alt, { alts: prev.alts });
        await this.sizeCustomModel(cu);
        if (!cu.sf) { cu.sf = prev; b.classList.remove('busy'); this.toast({ title: 'Model failed to load', name: alt.name, info: true }); return; }
        this.saveCustoms();
        for (const e of this.sim.bodies.list) {
          if (e.entryKey !== cu.key) continue;
          const rec = this.view.meshes.get(e.id);
          if (rec) { this.view.scene.remove(rec.group); this.view.meshes.delete(e.id); }
          e.baseDims = cu.modelDims.slice();
          e.baseVolume = 8 * e.baseDims[0] * e.baseDims[1] * e.baseDims[2];
          e.scale = -1; // force the collision box to be rebuilt
          this.sim.bodies.rescale(e, e.baseVolume); // keep physics in step with the new shape
        }
        reopen();
      };
    }

    saveCustoms() { try { localStorage.setItem('pc.custom3d', JSON.stringify(this.customs)); } catch (e) { /* storage full or blocked */ } }

    renderWeb(body) {
      body.appendChild(h('div', 'sec-title', 'Search 3D models'));
      body.appendChild(h('div', 'hint', 'Search real 3D models from <b>Sketchfab</b> and <b>Poly Haven</b>. Press <b>Add</b> on the one you want: its real properties (density, melting point, how it burns) are looked up separately on <b>Wikidata</b>. Liquids, powders and gases are in the other tabs.'));
      const form = h('form', 'web-form');
      form.innerHTML = `<input type="text" id="webq" placeholder="Printer, banana, granite, guitar…" autocomplete="off"><button class="btn primary" type="submit">Search</button>`;
      body.appendChild(form);
      const input = form.querySelector('#webq');
      input.value = this.webQuery || '';
      form.onsubmit = (ev) => { ev.preventDefault(); this.webQuery = input.value.trim(); if (this.webQuery) this.runWebSearch(this.webQuery); };
      const out = h('div', 'web-results');
      out.id = 'webResults';
      body.appendChild(out);
      if (this.webState) this.drawWebResults(out);
      body.appendChild(h('div', 'sec-title', `Your materials — ${this.customs.length}`));
      if (!this.customs.length) body.appendChild(h('div', 'empty', 'Materials you create appear here. Drag them into the workspace like any other.'));
      else {
        const grid = this.cardGrid(this.customs);
        [...grid.children].forEach((card, k) => {
          const x = h('button', 'card-del', '×');
          x.title = 'Remove from my materials';
          x.onpointerdown = (ev) => ev.stopPropagation();
          x.onclick = (ev) => { ev.stopPropagation(); const c = this.customs[k]; this.customs.splice(k, 1); delete this.entryByKey[c.key]; this.saveCustoms(); this.renderSidebar(); };
          card.appendChild(x);
        });
        body.appendChild(grid);
      }
      setTimeout(() => { if (!this.webQuery) input.focus(); }, 0);
    }

    async runWebSearch(q) {
      this.webState = { q, status: 'searching', results: [] };
      this.refreshWeb();
      try {
        const models = await PC.searchModels(q);
        if (this.webState.q !== q) return;
        this.webState = { q, status: models.length ? 'done' : 'empty', models };
      } catch (e) { this.webState = { q, status: 'error', error: String(e.message || e), results: [] }; }
      this.refreshWeb();
    }
    refreshWeb() { const out = document.getElementById('webResults'); if (out) this.drawWebResults(out); }

    drawWebResults(out) {
      const st = this.webState;
      out.innerHTML = '';
      if (!st) return;
      if (st.status === 'searching') { out.appendChild(h('div', 'web-status', `Searching for “${esc(st.q)}”…`)); return; }
      if (st.status === 'error') { out.appendChild(h('div', 'web-status err', `Couldn't reach the material databases (${esc(st.error)}). Check your internet connection and try again.`)); return; }
      if (st.status === 'empty') { out.appendChild(h('div', 'web-status', `No results for “${esc(st.q)}”. Try another name or spelling.`)); return; }
      out.appendChild(h('div', 'web-status', `${st.models.length} real 3D models for “${esc(st.q)}”`));
      const grid = h('div', 'model-grid');
      for (const m of st.models) {
        const have = this.entryByKey['mdl_' + m.uid], busy = st.busy === m.uid;
        const card = h('div', 'model-card');
        card.innerHTML = `<a class="mc-thumb" href="${esc(m.url)}" target="_blank" rel="noopener" title="View on ${m.source === 'polyhaven' ? 'Poly Haven' : 'Sketchfab'}">${m.thumb ? `<img src="${esc(m.thumb)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : ''}</a>
          <div class="mc-name" title="${esc(m.name)}">${esc(m.name)}</div><div class="mc-by">${esc(m.author)} · ${esc(m.license)}</div>`;
        const b = h('button', 'btn ' + (have ? '' : 'primary'), have ? PC.ico('check') + ' Added' : busy ? 'Adding…' : 'Add');
        b.disabled = !!have || !!st.busy;
        b.onclick = () => this.addModel(m);
        card.appendChild(b);
        grid.appendChild(card);
      }
      out.appendChild(grid);
    }

    // Load the material's 3D model once to learn its proportions and give it a real-world size.
    async sizeCustomModel(entry) {
      await this.sizeCustomModelRaw(entry);
      // Never bigger than the tiled floor: scale the whole model down to fit inside it (with a margin).
      if (entry.modelDims) {
        const lim = Math.min(this.s.worldWidth, this.s.worldDepth) / 2 * 0.85, m = Math.max(entry.modelDims[0], entry.modelDims[2], entry.modelDims[1] / 1.5);
        if (m > lim) entry.modelDims = entry.modelDims.map((v) => v * lim / m);
      }
    }
    async sizeCustomModelRaw(entry) {
      // Real-size 3D model: use the model's own dimensions (Poly Haven assets are at real-world scale).
      if (entry.model) {
        try { const m = await PC.loadPolyHavenModel(this.view.THREE, this.view.A, entry.model); entry.modelDims = m.half.map((v) => Math.max(0.005, v)); entry.dimsV = 2; } catch (e) { entry.model = null; }
      }
      if (!entry.model && entry.sf) {
        try {
          const m = await PC.loadGLBModel(this.view.THREE, this.view.A, entry.sf.glb);
          // Real size from Wikidata when known, otherwise a typical size for this kind of thing.
          const t = (entry.label + ' ' + (entry.query || '') + ' ' + entry.description).toLowerCase();
          // Typical full length (m) of common animals; otherwise a size for the kind of object.
          const ANIMAL = [[/elephant/, 5.5], [/giraffe/, 4.5], [/horse|cow|cattle|camel|bison|moose/, 2.3], [/bear|lion|tiger|deer|zebra/, 2], [/dolphin|shark/, 2.5], [/whale/, 15], [/pig|sheep|goat|wolf|kangaroo/, 1.2], [/\bdog\b|dobermann|retriever|shepherd/, 0.95], [/fox|monkey/, 0.8], [/cat\b|rabbit|duck|chicken|owl|eagle/, 0.5], [/bird|parrot|pigeon|crow/, 0.35], [/fish|frog|rat\b|squirrel/, 0.3], [/mouse|hamster/, 0.1], [/insect|bee|ant\b|beetle|butterfly|spider/, 0.03]];
          const animal = entry.cls === 'creature' ? (ANIMAL.find(([re]) => re.test(t)) || [null, 0.6])[1] : 0;
          const sample = ['rock', 'metal', 'glass'].includes(entry.cls) ? (/gem|diamond|ruby|sapphire|emerald|crystal/.test(t) ? 0.06 : 0.16) : 0; // a hand sample of a raw material
          const person = /\b(people|person|human|man|men|woman|women|girl|boy|child|crowd|pedestrian|soldier|character)\b/.test(t) ? 1.75 : 0;
          const guess = person ? person : animal ? animal : sample ? sample : /car|vehicle|truck|boat|piano|sofa|bed|wardrobe|refrigerator|fridge/.test(t) ? 1.6 : /table|chair|desk|bicycle|guitar|television|tv/.test(t) ? 0.9 : /printer|microwave|monitor|computer|lamp|vase|bucket/.test(t) ? 0.45 : /phone|cup|mug|fruit|apple|egg|ball|tool|hammer|bottle|book|shoe/.test(t) ? 0.2 : 0.35;
          const full = entry.realSize || guess, k = full / 2 / Math.max(...m.half);
          entry.modelDims = m.half.map((v) => Math.max(0.004, v * k));
        } catch (e) { entry.sf = null; }
      }
      if (!entry.model && !entry.sf && entry.stl) {
        // Scans have no reliable units: keep the true proportions at a hand-held size (largest half-extent 9 cm).
        try { const m = await PC.loadSTLModel(this.view.THREE, this.view.A, entry.stl.url); const k = 0.09 / Math.max(...m.half); entry.modelDims = m.half.map((v) => Math.max(0.004, v * k)); } catch (e) { entry.stl = null; }
      }
    }

    // Add a chosen 3D model to the game; its physical properties come from a separate Wikidata lookup.
    async addModel(m) {
      const st = this.webState;
      st.busy = m.uid; this.refreshWeb();
      try {
        const facts = await PC.propertiesFor(st.q);
        const entry = await PC.buildCustomMaterial(facts, { model: m, alts: st.models, query: st.q, label: m.name });
        if (!entry.description) entry.description = st.q;
        await this.sizeCustomModel(entry);
        if (!entry.sf && !entry.model) throw new Error('This model could not be downloaded. Try another one.');
        PC.CUSTOM[entry.key] = entry;
        this.customs = this.customs.filter((c) => c.key !== entry.key);
        this.customs.unshift(entry);
        this.entryByKey[entry.key] = entry;
        this.saveCustoms();
        this.toast({ title: 'Added', name: entry.label, sub: facts.id ? `Properties of ${facts.label}: ${fmt(entry.props.density)} g/cm³` : 'Properties estimated', icon: this.iconHtml(entry) });
        st.busy = null;
        this.renderSidebar();
        this.openMaterial(entry);
      } catch (e) {
        st.busy = null;
        this.toast({ title: 'Could not add model', name: m.name, sub: String(e.message || e), info: true });
        this.refreshWeb();
      }
    }

    async createCustom(r) {
      const st = this.webState;
      st.busy = r.id; this.refreshWeb();
      try {
        const facts = await PC.fetchMaterialFacts(r.id);
        const entry = await PC.buildCustomMaterial(facts);
        await this.sizeCustomModel(entry);
        PC.CUSTOM[entry.key] = entry;
        this.customs = this.customs.filter((c) => c.key !== entry.key);
        this.customs.unshift(entry);
        this.entryByKey[entry.key] = entry;
        this.saveCustoms();
        this.toast({ title: 'Material created', name: entry.label, sub: `${entry.phase} · ${fmt(entry.props.density)} g/cm³ · melts ${fmt(entry.props.mp)} K`, icon: this.iconHtml(entry) });
        st.busy = null;
        this.renderSidebar();
        this.openMaterial(entry);
      } catch (e) {
        st.busy = null;
        this.toast({ title: 'Could not create material', name: r.label, sub: String(e.message || e), info: true });
        this.refreshWeb();
      }
    }

    customFacts(cu) {
      const F = cu.facts || {}, src = (v) => (v != null ? '' : ' <span class="est">est.</span>');
      const row = (k, v) => `<div><span>${k}</span><span>${v}</span></div>`;
      return `<div class="facts custom-facts">
        ${cu.img ? `<img class="cu-photo" src="${esc(cu.img)}" alt="" referrerpolicy="no-referrer">` : ''}
        <div class="grid">
          ${row('Kind', esc(cu.cls) + ' · ' + esc(cu.phase) + ' at 20 °C')}
          ${cu.formula ? row('Formula', esc(cu.formula)) : ''}
          ${row('Density', fmt(cu.props.density) + ' g/cm³' + src(F.density))}
          ${cu.props.mp >= 9000 ? row('Heat', 'chars or burns, does not melt') : row('Melts', fmt(cu.props.mp) + ' K' + src(F.mp))}
          ${cu.props.mp >= 9000 ? '' : row('Boils', fmt(cu.props.bp) + ' K' + src(F.bp))}
          ${F.hardness != null ? row('Mohs hardness', fmt(F.hardness)) : ''}
          ${F.autoignite != null ? row('Autoignition', fmt(F.autoignite) + ' K') : F.flash != null ? row('Flash point', fmt(F.flash) + ' K') : ''}
          ${F.molarMass != null ? row('Molar mass', fmt(F.molarMass) + ' g/mol') : ''}
          ${row('Behaves like', esc(PC.MAT[cu.mat].name))}
          ${row('3D model', cu.sf ? 'Sketchfab (real model)' : cu.model ? 'Poly Haven scan' : cu.stl ? 'Wikimedia Commons scan' : cu.humanoid ? 'Jointed body (ragdoll)' : ['liquid', 'gas', 'powder'].includes(cu.cls) ? 'Simulated ' + cu.cls : 'None found online — stand-in shape')}
        </div>
        ${cu.sf && cu.sf.alts && cu.sf.alts.length > 1 ? `<div class="cu-alts-t">3D model — click to switch</div><div class="cu-alts">${cu.sf.alts.map((a, k) => `<button class="cu-alt${a.uid === cu.sf.uid ? ' on' : ''}" data-alt="${k}" title="${esc(a.name)} by ${esc(a.author)}">${a.thumb ? `<img src="${esc(a.thumb)}" alt="" referrerpolicy="no-referrer">` : esc(a.name)}</button>`).join('')}</div>` : ''}
        ${cu.sf ? `<div class="cu-credit">3D model <a href="${esc(cu.sf.url)}" target="_blank" rel="noopener">“${esc(cu.sf.name)}”</a> by <a href="${esc(cu.sf.authorUrl || cu.sf.url)}" target="_blank" rel="noopener">${esc(cu.sf.author)}</a> · ${esc(cu.sf.license)} · via Objaverse</div>` : ''}
        <div class="cu-src">Data: <a href="${esc(cu.source)}" target="_blank" rel="noopener">Wikidata</a>${cu.wiki ? ` · <a href="https://en.wikipedia.org/wiki/${encodeURIComponent(cu.wiki)}" target="_blank" rel="noopener">Wikipedia</a>` : ''}${cu.model ? ` · <a href="https://polyhaven.com/a/${esc(cu.model)}" target="_blank" rel="noopener">model</a>` : cu.stl ? ` · <a href="${esc(cu.stl.page)}" target="_blank" rel="noopener">3D scan</a>` : cu.texture ? ` · <a href="https://polyhaven.com/a/${esc(cu.texture)}" target="_blank" rel="noopener">texture</a>` : ''}</div>
      </div>`;
    }

    showTip(ev, el) {
      const t = $('#tooltip');
      t.innerHTML = `<div class="tn">${el.name} <span class="tm">${el.sym} · ${el.Z}</span></div><div class="tm">${el.mass} u · ${PC.CATEGORIES[el.cat].label}</div><div class="tm">${el.state} at 20 °C · ρ ${fmt(el.density)} g/cm³</div><div class="tm">mp ${fmt(el.mp)} K · bp ${fmt(el.bp)} K</div>`;
      t.classList.remove('hidden');
      const r = ev.currentTarget.getBoundingClientRect();
      t.style.left = Math.max(8, Math.min(window.innerWidth - 250, r.left - 100)) + 'px';
      t.style.top = (r.bottom + 8) + 'px';
    }
    hideTip() { $('#tooltip').classList.add('hidden'); }
    // Re-render the Inventions tab when the set of buildable devices changes.
    refreshInventions() {
      if (this.tab !== 'inventions' || $('#search').value.trim()) return;
      if (JSON.stringify(this.sim.inventions.buildable()) !== this.invSig) this.renderSidebar();
    }

    updateDiscCount() {
      $('#discCount').textContent = this.compounds.filter((e) => this.isDiscovered(e.mat)).length;
      const ic = $('#invCount'); if (ic) ic.textContent = this.inventions.filter((e) => this.sim.inventions.isDiscovered(e.inv)).length;
    }

    // ------------------------------------------------------------------ drag & drop
    attachDrag(node, entry) {
      node.addEventListener('pointerdown', (e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        const x0 = e.clientX, y0 = e.clientY;
        let dragging = false;
        const ghost = $('#ghost');
        const move = (ev) => {
          if (!dragging && Math.hypot(ev.clientX - x0, ev.clientY - y0) > 6) {
            dragging = true;
            this.hideTip();
            const m = entry.mat ? PC.MAT[entry.mat] : null;
            ghost.innerHTML = this.iconHtml(entry); void m;
            ghost.dataset.label = entry.label;
            ghost.classList.remove('hidden');
            document.body.classList.add('dragging');
          }
          if (dragging) {
            ghost.style.left = ev.clientX + 'px'; ghost.style.top = ev.clientY + 'px';
            this.dragging = this.overCanvas(ev);
            if (this.dragging) { const p = this.local(ev); this.mouse.sx = p.sx; this.mouse.sy = p.sy; this.mouse.over = true; this.mouse.moved = true; }
          }
        };
        const up = (ev) => {
          window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up);
          ghost.classList.add('hidden');
          document.body.classList.remove('dragging');
          this.dragging = false;
          if (dragging) {
            if (this.overCanvas(ev)) {
              const p = this.local(ev);
              const hit = this.view.raycast(p.sx, p.sy, { noParticles: entry.kind === 'container' });
              if (hit) this.drop(entry, hit.point);
            }
          } else this.openMaterial(entry);
        };
        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', up);
      });
    }
    overCanvas(ev) {
      const r = this.app.canvas.getBoundingClientRect();
      if (ev.clientX < r.left || ev.clientX > r.right || ev.clientY < r.top || ev.clientY > r.bottom) return false;
      const el = document.elementFromPoint(ev.clientX, ev.clientY);
      return el === this.app.canvas || el === $('#ghost') || !!(el && el.closest && el.closest('#labels'));
    }
    local(ev) { const r = this.app.canvas.getBoundingClientRect(); return { sx: ev.clientX - r.left, sy: ev.clientY - r.top }; }

    templateFor(entry) {
      let t = this.templates[entry.key];
      if (!t) {
        const m = entry.mat ? PC.MAT[entry.mat] : null;
        t = this.templates[entry.key] = { count: 0, size: 1, T: entry.T != null ? entry.T : 293, shape: 'auto', props: m ? Object.assign(PC.defaultProps(m), entry.props || {}) : {} };
      }
      return t;
    }
    drop(entry, point) {
      this.mark('Add ' + (entry.label || 'item'));
      if (entry.kind === 'container') return this.sim.spawn(entry, point);
      const t = this.templateFor(entry);
      return this.sim.spawn(entry, point, { count: t.count || undefined, size: t.size, T: t.T, shape: t.shape, props: Object.assign({}, t.props) });
    }

    // ------------------------------------------------------------------ canvas input
    bindCanvas() {
      const cv = this.app.canvas;
      let downInfo = null;
      cv.addEventListener('contextmenu', (e) => e.preventDefault());
      cv.addEventListener('pointerdown', (e) => {
        const p = this.local(e);
        this.mouse.sx = p.sx; this.mouse.sy = p.sy;
        if (e.button !== 0) return;
        if (this.instruments && this.instruments.placing) { this.instruments.handleClick(this.view.raycast(p.sx, p.sy)); return; }
        cv.setPointerCapture(e.pointerId);
        this.mark(this.sim.input.tool);
        const hit = this.view.raycast(p.sx, p.sy);
        this.mouse.down = true;
        const inp = this.sim.input;
        inp.down = true; inp.pressed = true;
        if (hit) { this.mouse.point = hit.point; this.mouse.normal = hit.normal; this.mouse.entity = hit.entity; this.mouse.hit = hit; }
        inp.hitEntity = hit ? hit.entity : null;
        inp.point = hit ? hit.point : null;
        this.grabAnchor = hit ? hit.point.slice() : null;
        downInfo = { sx: p.sx, sy: p.sy, t: performance.now(), hit };
      });
      cv.addEventListener('pointermove', (e) => {
        const p = this.local(e);
        this.mouse.sx = p.sx; this.mouse.sy = p.sy; this.mouse.over = true;
        this.mouse.moved = true;
      });
      const end = (e) => {
        if (!this.mouse.down) return;
        this.mouse.down = false;
        const inp = this.sim.input;
        inp.down = false; inp.released = true;
        if (downInfo && e && e.type === 'pointerup') {
          const moved = Math.hypot(this.mouse.sx - downInfo.sx, this.mouse.sy - downInfo.sy);
          if (moved < 5 && performance.now() - downInfo.t < 350 && (inp.tool === 'stir' || inp.tool === 'grab')) {
            const ent = downInfo.hit ? this.sim.entityAt(downInfo.hit.point, downInfo.hit.entity) : null;
            if (ent) this.openEntity(ent); else if (this.panel && this.panel.mode === 'entity') this.closePanel();
          }
        }
        downInfo = null;
      };
      cv.addEventListener('pointerup', end);
      cv.addEventListener('pointercancel', end);
      cv.addEventListener('pointerleave', () => { this.mouse.over = false; $('#probe').classList.add('hidden'); });
      cv.addEventListener('pointerenter', () => { this.mouse.over = true; });

      const mm = $('#minimapWrap');
      const seek = (e) => { const r = mm.getBoundingClientRect(); const x = ((e.clientX - r.left) / r.width - 0.5) * this.s.worldWidth; const t = this.view.controls.target; this.view.focus(x, t.y, t.z); };
      mm.addEventListener('pointerdown', (e) => {
        mm.setPointerCapture(e.pointerId); seek(e);
        const mv = (ev) => seek(ev);
        const up = () => { mm.removeEventListener('pointermove', mv); mm.removeEventListener('pointerup', up); };
        mm.addEventListener('pointermove', mv); mm.addEventListener('pointerup', up);
      });
      $('#zoomIn').onclick = () => this.dolly(0.8);
      $('#zoomOut').onclick = () => this.dolly(1.25);
      $('#zoomReset').onclick = () => { const t = this.view.controls.target; this.view.camera.position.set(t.x, t.y + 1.55, t.z + 4.2); };
    }
    dolly(f) {
      const cam = this.view.camera, t = this.view.controls.target;
      cam.position.sub(t).multiplyScalar(f).add(t);
    }

    bindKeys() {
      window.addEventListener('keydown', (e) => {
        const tag = (e.target.tagName || '').toLowerCase();
        if (tag === 'input' || tag === 'select' || tag === 'textarea') { if (e.key === 'Escape') e.target.blur(); return; }
        const mod = e.metaKey || e.ctrlKey;
        if (mod) {
          const k = e.key.toLowerCase();
          if (k === 'z' && !e.shiftKey) { e.preventDefault(); this.undo(); return; }
          if ((k === 'z' && e.shiftKey) || k === 'y') { e.preventDefault(); this.redo(); return; }
          if (k === 's') { e.preventDefault(); if (e.shiftKey) this.exportScene(); else this.saveScene(); return; }
          if (k === 'o') { e.preventDefault(); $('#sceneFile').click(); return; }
          return;
        }
        this.keys[e.key.toLowerCase()] = true;
        if (e.key === 'r' || e.key === 'R') { this.rewind(5); return; }
        if (e.key === 'i' || e.key === 'I') { this.instruments.toggle(); return; }
        const t = TOOLS.find((x) => x.key === e.key);
        if (t) { this.setTool(t.id); return; }
        switch (e.key) {
          case ' ': e.preventDefault(); this.togglePause(); break;
          case 'p': case 'P': this.togglePause(); break;
          case '.': this.app.paused = true; this.app.stepOnce = true; this.syncPlay(); break;
          case '+': case '=': this.dolly(0.85); break;
          case '-': case '_': this.dolly(1.18); break;
          case '0': $('#zoomReset').click(); break;
          case 'h': case 'H': case '?': this.toggleHelp(); break;
          case '/': e.preventDefault(); $('#search').focus(); break;
          case 'Escape': this.closePanel(); $('#settings').classList.add('hidden'); $('#nature').classList.add('hidden'); $('#help').classList.add('hidden'); break;
          case 'n': case 'N': this.toggleNature(); break;
          case 'Delete': case 'Backspace': if (this.panel && this.panel.entity) { this.sim.remove(this.panel.entity); this.closePanel(); } break;
          case 'f': case 'F': if (this.panel && this.panel.entity) { const st = this.sim.stats(this.panel.entity); if (st.count) this.view.focus(st.cx, st.cy, st.cz); } break;
        }
      });
      window.addEventListener('keyup', (e) => { this.keys[e.key.toLowerCase()] = false; });
      window.addEventListener('blur', () => { this.keys = {}; });
    }

    // Per-frame: keyboard panning, raycast under the cursor, tool input for the simulation.
    frameInput(frameDt) {
      const k = this.keys, sp = 0.06 * frameDt * (k.shift ? 3 : 1) * Math.max(1, this.view.camera.position.distanceTo(this.view.controls.target) / 4);
      let dx = 0, dz = 0;
      if (k.a || k.arrowleft) dx -= sp;
      if (k.d || k.arrowright) dx += sp;
      if (k.w || k.arrowup) dz += sp;
      if (k.s || k.arrowdown) dz -= sp;
      if (dx || dz) this.view.pan(dx, dz);
      const inp = this.sim.input, m = this.mouse;
      if (m.over && (m.moved || m.down || this.view.frame % 4 === 0)) {
        m.moved = false;
        const hit = this.view.raycast(m.sx, m.sy, { noParticles: inp.tool === 'grab' && m.down });
        m.point = hit ? hit.point : null;
        m.normal = hit ? hit.normal : [0, 1, 0];
        m.entity = hit ? hit.entity : null;
        m.hit = hit;
      }
      inp.over = m.over && !this.dragging;
      inp.point = m.point; inp.normal = m.normal;
      const lp = this.lastInputPoint;
      inp.move = lp && m.point ? [m.point[0] - lp[0], m.point[1] - lp[1], m.point[2] - lp[2]] : [0, 0, 0];
      if (m.point && Math.hypot(inp.move[0], inp.move[2]) > 0.002) {
        const L = Math.hypot(inp.move[0], inp.move[2]);
        inp.dir = [inp.move[0] / L, 0, inp.move[2] / L];
      } else if (!inp.dir) {
        const f = new this.view.THREE.Vector3(); this.view.camera.getWorldDirection(f); inp.dir = [f.x, 0, f.z];
      }
      // Cursor moving across a liquid surface sends out ripples.
      if (m.hit && m.hit.particle != null && this.sim.fluid.phase[m.hit.particle] === LIQUID && (inp.tool === 'stir' || inp.tool === 'wind')) {
        const mv = Math.hypot(inp.move[0], inp.move[2]);
        if (mv > 0.004) this.view.addRipple(m.point[0], m.point[2], 0.05 + Math.min(0.08, mv), Math.min(0.012, mv * 0.08) * (m.down ? 2 : 1));
      }
      this.lastInputPoint = m.point;
      if (inp.tool === 'grab' && m.down && this.grabAnchor) inp.grabPoint = this.view.dragPoint(m.sx, m.sy, this.grabAnchor);
      this.view.mouse = { point: m.point, normal: m.normal, over: m.over || this.dragging, tool: inp.tool };
    }
    afterFrame() { this.sim.input.pressed = false; this.sim.input.released = false; }

    updateProbe() {
      const pr = $('#probe'), m = this.mouse;
      if (!m.over || m.down || this.dragging || !m.hit) { pr.classList.add('hidden'); return; }
      const p = this.sim.probe(m.hit.particle != null || m.entity ? m.point : null, m.entity);
      if (!p) { pr.classList.add('hidden'); return; }
      const plasma = p.phase === GAS && p.T > 6000;
      const sw = p.entity && p.entity.props ? p.entity.props.color : p.mat.color;
      pr.innerHTML = `<div class="pn"><i class="sw" style="background:${sw}"></i>${esc(plasma ? p.mat.name + ' plasma' : p.name)}</div>
        <div class="kv"><span>Phase</span><span>${plasma ? 'Plasma' : p.body ? 'Solid object' : PHASE_LABEL[p.phase]}</span></div>
        <div class="kv"><span>Temp</span><span>${fmt(p.T)} K · ${fmt(kToC(p.T))} °C</span></div>
        <div class="kv"><span>Speed</span><span>${fmt(p.v)} m/s</span></div>
        ${p.rho != null && p.phase === LIQUID ? `<div class="kv"><span>Pressure</span><span>${fmt(p.rho)} ρ₀</span></div>` : ''}
        ${this.creditLine(p.entity && PC.CUSTOM[p.entity.entryKey])}`;
      pr.classList.remove('hidden');
      const stage = $('#stage').getBoundingClientRect();
      let x = m.sx + 18, y = m.sy + 18;
      if (x + 200 > stage.width) x = m.sx - 210;
      if (y + 130 > stage.height) y = m.sy - 130;
      pr.style.left = x + 'px'; pr.style.top = y + 'px';
    }

    updateHud(fps) {
      const hud = $('#hud');
      hud.classList.toggle('hidden', !this.s.showStats);
      if (!this.s.showStats) return;
      const sim = this.sim, f = sim.fluid, t = this.view.controls.target;
      const groups = f.groups.filter((g) => g.count > 0).length;
      hud.innerHTML = `<b>${fps.toFixed(0)}</b> fps · <b>${f.count.toLocaleString()}</b> particles · <b>${sim.bodies.list.length}</b> objects · <b>${groups}</b> substances<br>` +
        `substeps <b>${f.lastSubsteps || 1}</b> · wind <b>${(+this.s.windSpeed).toFixed(1)}</b> m/s · t = <b>${sim.time.toFixed(1)}</b> s<br>` +
        `view x <b>${t.x.toFixed(1)}</b> m${this.mouse.point ? ` · cursor (${this.mouse.point.map((v) => v.toFixed(2)).join(', ')}) m` : ''}`;
    }

    // ------------------------------------------------------------------ world events
    onWorldEvent(e) {
      if (e.type === 'achieve') { this.onboarding.onAchieve(e.key); return; }
      if (e.type === 'bodyRemoved' && this.panel && this.panel.entity === e.entity) { this.closePanel(); return; }
      if (e.type === 'invention') {
        if (e.first) this.toast({ title: 'New invention!', name: e.inv.label, sub: e.inv.desc, icon: this.iconHtml(this.entryByKey['inv_' + e.inv.key]) });
        else this.toast({ title: 'Assembled', name: e.inv.label, info: true });
        this.updateDiscCount();
        if (this.tab === 'inventions') this.renderSidebar();
        this.app.save();
        return;
      }
      if (e.type !== 'discover' || e.x == null) return;
      const m = e.mat;
      if (m.kind === 'compound') {
        const first = !this.newKeys.has(m.id) && ![...this.sim.discovered].some((k) => k !== e.key && (k === m.id || k.startsWith(m.id + ':')));
        if (first) {
          this.newKeys.add(m.id);
          this.toast({ title: 'New discovery!', name: PC.phaseName(m, e.phase), sub: m.formula, icon: PC.icon('', m) });
          this.updateDiscCount();
          if (this.tab === 'discovered') this.renderSidebar();
          this.app.save();
        }
      } else if (m.phaseNames) {
        this.toast({ title: 'Phase change', name: PC.phaseName(m, e.phase), sub: `${m.name} · ${PHASE_LABEL[e.phase]}`, info: true });
        this.app.save();
      }
    }

    toast({ title, name, sub, icon, info }) {
      const wrap = $('#toasts');
      while (wrap.children.length > 3) wrap.firstChild.remove();
      const t = h('div', 'toast' + (info ? ' info' : ''));
      t.innerHTML = `${icon ? `<div class="ti">${icon}</div>` : ''}<div><div class="tt">${esc(title)}</div><div class="tn">${esc(name)}</div>${sub ? `<div class="tf">${esc(sub)}</div>` : ''}</div>`;
      wrap.appendChild(t);
      t.animate([{ transform: 'translateY(-20px) scale(.9)', opacity: 0 }, { transform: 'translateY(0) scale(1.03)', opacity: 1, offset: 0.6 }, { transform: 'none', opacity: 1 }], { duration: 450, easing: 'cubic-bezier(.2,.9,.3,1.2)' });
      setTimeout(() => {
        const a = t.animate([{ opacity: 1, transform: 'none' }, { opacity: 0, transform: 'translateY(-12px)' }], { duration: 350, easing: 'ease-in' });
        a.onfinish = () => t.remove();
      }, info ? 2600 : 4200);
    }

    // ------------------------------------------------------------------ properties panel
    closePanel() {
      $('#panel').classList.add('hidden');
      $('#panel').innerHTML = '';
      if (this.atom) this.atom.stop();
      this.panel = null;
      if (this.view) this.view.selected = null;
    }

    customHeader(cu) {
      return `<div class="p-head"><div class="p-icon">${this.iconHtml(cu)}</div><div><div class="p-title">${esc(cu.label)}</div>
        <div class="p-sub">${esc(cu.formula || cu.description || '')}</div><span class="chip" style="--c:#7cc4ff">${PC.ico('globe')} From the web</span> <span class="chip mode">${esc(cu.cls)} · ${esc(cu.phase)}</span></div>
        <button class="p-close" title="Close (Esc)">×</button></div>`;
    }

    panelHeader(label, icon, mat, modeLabel) {
      const el = mat && mat.el;
      const ent = this.entryByKey[icon] || (el && this.entryByKey[el.sym]) || (mat && this.entryByKey[mat.id]) || { key: icon || (mat && mat.id) || label, mat: mat && mat.id, icon, label };
      const iconHtml = el ? `<div class="big-tile" style="--c:${PC.CATEGORIES[el.cat].color}"><div class="bt-img">${this.iconHtml(ent)}</div><span class="z">${el.Z}</span><span class="s">${el.sym}</span><span class="m">${el.mass}</span></div>`
        : `<div class="p-icon">${this.iconHtml(ent)}</div>`;
      const catColor = el ? PC.CATEGORIES[el.cat].color : mat ? mat.color : '#7cc4ff';
      const chip = el ? PC.CATEGORIES[el.cat].label : mat ? (mat.kind === 'compound' ? 'Compound' : 'Material') : 'Container';
      return `<div class="p-head">${iconHtml}<div><div class="p-title">${esc(label)}</div>
        <div class="p-sub">${esc(mat ? mat.formula : '')}${el ? ` · ${el.mass} u` : mat ? ` · ${fmt(mat.M)} g/mol` : ''}</div>
        <span class="chip" style="--c:${catColor}">${esc(chip)}</span> <span class="chip mode">${modeLabel}</span></div>
        <button class="p-close" title="Close (Esc)">×</button></div>`;
    }

    facts(mat) {
      const el = mat.el;
      if (!el) {
        return `<div class="facts wide">
          <div><span>Density</span><span>${fmt(mat.density)} g/cm³</span></div><div><span>Molar mass</span><span>${fmt(mat.M)} g/mol</span></div>
          <div><span>Melts</span><span>${mat.mp >= 1e8 ? '—' : fmt(mat.mp) + ' K'}</span></div><div><span>Boils</span><span>${mat.bp >= 1e8 ? '—' : fmt(mat.bp) + ' K'}</span></div>
          ${mat.burn ? `<div><span>Ignites</span><span>${fmt(mat.burn.ignite)} K</span></div>` : ''}${mat.burn && mat.burn.explode ? '<div><span>Explosive</span><span>yes</span></div>' : ''}
        </div>`;
      }
      return `<div class="atom-wrap"><canvas class="atom"></canvas><div class="facts">
          <div><span>Atomic no.</span><span>${el.Z}</span></div>
          <div><span>Mass</span><span>${el.mass} u</span></div>
          <div><span>Group · Period</span><span>${el.row >= 9 ? 'f' : el.col} · ${el.row >= 9 ? el.row - 3 : el.row}</span></div>
          <div><span>Density</span><span>${fmt(el.density)}</span></div>
          <div><span>Melts</span><span>${fmt(el.mp)} K</span></div>
          <div><span>Boils</span><span>${fmt(el.bp)} K</span></div>
          <div><span>At 20 °C</span><span>${el.state}</span></div>
          ${el.radioactive ? `<div><span>Radioactive</span><span style="color:#9dff7a">${PC.ico('radiation')} yes</span></div>` : ''}
          ${mat.fissile ? `<div><span>Critical mass</span><span>${mat.fissile.criticalKg} kg</span></div>` : ''}
        </div></div><div class="config">${esc(el.config)}</div>`;
    }

    openMaterial(entry) {
      if (this.atom) this.atom.stop();
      const p = $('#panel');
      p.classList.remove('hidden');
      this.view.selected = null;
      this.panel = { mode: 'material', entry };
      if (entry.kind === 'container') return this.openContainerEntry(entry);
      if (entry.kind === 'invention') return this.openInventionEntry(entry);
      const cu = PC.CUSTOM[entry.key];
      const mat = PC.MAT[entry.mat];
      const t = this.templateFor(entry);
      p.innerHTML = (cu ? this.customHeader(cu) : this.panelHeader(entry.label, entry.icon, mat, 'Spawn template')) + '<div class="p-body"></div>';
      p.querySelector('.p-close').onclick = () => this.closePanel();
      const body = p.querySelector('.p-body');
      if (cu) { body.insertAdjacentHTML('beforeend', `<div class="p-desc">${esc(cu.extract || cu.description || '')}</div>` + this.customFacts(cu)); this.bindAlts(body, cu, () => this.openMaterial(entry)); }
      else body.insertAdjacentHTML('beforeend', `<div class="p-desc">${esc(mat.desc || '')}</div>` + this.facts(mat));
      if (mat.el && !cu) { this.atom = new PC.AtomView(body.querySelector('.atom')); this.atom.show(mat.el, PC.CATEGORIES[mat.el.cat].color); }
      const btns = h('div', 'btns');
      const spawnBtn = h('button', 'btn primary', 'Drop in view');
      spawnBtn.onclick = () => {
        const tg = this.view.controls.target;
        const hit = this.view.raycast(this.view.cssW / 2, this.view.cssH / 2) || { point: [tg.x, 0, tg.z] };
        this.drop(entry, hit.point);
      };
      const pourBtn = h('button', 'btn', 'Pour this');
      pourBtn.onclick = () => { this.pourEntry = entry; this.setTool('pour'); };
      const resetBtn = h('button', 'btn', 'Reset');
      resetBtn.onclick = () => { delete this.templates[entry.key]; this.openMaterial(entry); };
      btns.append(spawnBtn, pourBtn, resetBtn);
      body.appendChild(btns);

      const vol = (n) => n * Math.pow(this.sim.fluid.sp, 3);
      const isBody = () => this.sim.isBodyEntry(entry, t.T, t.props);
      this.section(body, 'Spawn', [
        this.sliderRow({ label: 'Amount (liquids / powders / gases)', unit: 'particles', min: 10, max: 5000, log: true, int: true }, () => t.count || this.defaultCount(mat, t), (v) => { t.count = v; }, (v) => `≈ ${(vol(v) * 1000).toFixed(1)} L · ${fmtKg(vol(v) * mat.density * 1000)}`),
        this.sliderRow({ label: 'Size (solid objects)', unit: '×', min: 0.25, max: 6, log: true }, () => t.size, (v) => { t.size = v; }, () => (isBody() ? 'Spawns as a rigid object' : 'Spawns as particles at this temperature')),
        this.sliderRow({ label: 'Temperature', unit: 'K', min: 1, max: 1e8, log: true }, () => t.T, (v) => { t.T = v; }, (v) => `${fmt(kToC(v))} °C · ${this.phaseAt(mat, v, t.props, entry)}`),
        this.selectRow('Shape (particles)', [['auto', 'Automatic'], ['blob', 'Blob'], ['block', 'Block'], ['column', 'Column'], ['sheet', 'Sheet'], ['cloud', 'Cloud'], ['rain', 'Rain']], () => t.shape, (v) => { t.shape = v; }),
      ]);
      this.propSections(body, mat, t.props, () => { if (this.pourEntry === entry) this.sim.input.entryProps = t.props; }, false);
    }

    openContainerEntry(entry) {
      const p = $('#panel');
      const mat = PC.MAT[entry.def.mat];
      p.innerHTML = this.panelHeader(entry.label, entry.icon, null, 'Container') + '<div class="p-body"></div>';
      p.querySelector('.p-close').onclick = () => this.closePanel();
      const body = p.querySelector('.p-body');
      body.insertAdjacentHTML('beforeend', `<div class="p-desc">${esc(entry.label)} made of <b>${esc(mat.name)}</b> — ${this.containerSize(entry.def)}. Drag it onto the terrace; it sits on the ground where you drop it.</div>`);
      const btns = h('div', 'btns');
      const b = h('button', 'btn primary', 'Place in view');
      b.onclick = () => { const t = this.view.controls.target; this.drop(entry, [t.x, 0, t.z]); };
      btns.appendChild(b);
      body.appendChild(btns);
    }

    openInventionEntry(entry) {
      const p = $('#panel'), def = PC.INVENTION[entry.inv];
      p.innerHTML = this.panelHeader(entry.label, null, null, 'Invention') + '<div class="p-body"></div>';
      p.querySelector('.p-close').onclick = () => this.closePanel();
      const body = p.querySelector('.p-body');
      const recipe = def.recipe.map((slot) => slot.map((id) => (PC.MAT[id] ? PC.MAT[id].name : id)).join(' or ')).join('  +  ');
      body.insertAdjacentHTML('beforeend', `<div class="p-desc">${esc(def.desc)}</div><div class="p-desc"><b>Recipe:</b> ${esc(recipe)}</div>`);
      const btns = h('div', 'btns');
      const b = h('button', 'btn primary', 'Drop in view');
      b.onclick = () => { const t = this.view.controls.target; this.drop(entry, [t.x, 0, t.z]); };
      btns.appendChild(b);
      body.appendChild(btns);
    }

    defaultCount(mat, t) {
      const ph = mat.life ? GAS : t.T < t.props.mp ? SOLID : t.T < t.props.bp ? LIQUID : GAS;
      return ph === GAS ? 300 : ph === LIQUID ? 700 : 400;
    }
    phaseAt(mat, T, props, entry) {
      if (mat.life) return mat.name;
      const ph = T < props.mp ? (mat.powder ? POWDER : SOLID) : T < props.bp ? LIQUID : GAS;
      if (ph === GAS && T > 6000) return 'Plasma';
      return PC.phaseName(mat, ph === POWDER ? SOLID : ph) + (ph === POWDER ? ' (powder)' : ph === SOLID && entry && this.sim.isBodyEntry(entry, T, props) ? ' (solid object)' : '');
    }

    openEntity(ent) {
      if (this.atom) this.atom.stop();
      const p = $('#panel');
      p.classList.remove('hidden');
      this.panel = { mode: 'entity', entity: ent };
      this.view.selected = ent;
      const mat = PC.MATS[ent.mat], isBody = ent.kind === 'body';
      const icon = ent.container || (PC.BASICS.find((b) => b.mat === mat.id) || {}).key;
      const cuE = PC.CUSTOM[ent.entryKey];
      p.innerHTML = (cuE ? this.customHeader(cuE) : this.panelHeader(ent.name, icon, mat, ent.container ? 'Container' : isBody ? 'Rigid object' : 'Live substance')) + '<div class="p-body"></div>';
      p.querySelector('.p-close').onclick = () => this.closePanel();
      const body = p.querySelector('.p-body');
      body.insertAdjacentHTML('beforeend', `<div class="stats">
          <div class="stat"><div class="k">${isBody ? 'Volume' : 'Particles'}</div><div class="v" data-s="count">–</div></div>
          <div class="stat"><div class="k">Mass</div><div class="v" data-s="mass">–</div></div>
          <div class="stat"><div class="k">Amount</div><div class="v" data-s="mol">–</div></div>
          <div class="stat"><div class="k">Temp</div><div class="v" data-s="T">–</div></div>
          <div class="stat"><div class="k">°C</div><div class="v" data-s="C">–</div></div>
          <div class="stat"><div class="k">Speed</div><div class="v" data-s="v">–</div></div>
        </div>
        ${isBody ? '' : `<div class="phasebar">${PHASE_LABEL.map((_, k) => `<i data-ph="${k}" style="background:${PHASE_COLORS[k]};width:0"></i>`).join('')}</div>
        <div class="phase-key">${PHASE_LABEL.map((l, k) => `<span><i style="background:${PHASE_COLORS[k]}"></i>${l}</span>`).join('')}</div>`}`);
      if (cuE) { body.insertAdjacentHTML('beforeend', this.customFacts(cuE)); this.bindAlts(body, cuE, () => this.openEntity(ent)); }
      else if (mat.el) { body.insertAdjacentHTML('beforeend', this.facts(mat)); this.atom = new PC.AtomView(body.querySelector('.atom')); this.atom.show(mat.el, PC.CATEGORIES[mat.el.cat].color); }

      const sim = this.sim;
      const btns = h('div', 'btns');
      const mk = (label, cls, fn) => { const b = h('button', 'btn ' + cls, label); b.onclick = () => { this.mark(label.replace(/^[^A-Za-z]+/, '')); fn(); }; btns.appendChild(b); return b; };
      if (ent.container && ent.bindId != null) {
        body.insertAdjacentHTML('beforeend', `<div class="p-desc" data-s="pressure"></div>`);
        mk(ent.props.sealed ? 'Take lid off' : 'Put lid on', '', () => { ent.props.sealed = !ent.props.sealed; this.openEntity(ent); });
      }
      if (ent.inv) {
        const def = PC.INVENTION[ent.invention];
        body.insertAdjacentHTML('beforeend', `<div class="p-desc">${PC.ico('gear')} ${esc(def.desc)}</div>`);
        if (ent.invention === 'rocket' || ent.invention === 'firework') mk(PC.ico('rocket') + ' Launch', 'primary', () => { ent.inv.launch = true; });
        if (ent.invention === 'campfire') mk(PC.ico('flame') + ' Light', 'warn', () => { if (ent.inv.fuel > 0) ent.T = Math.max(ent.T, 700); });
        if (['thermometer', 'bulb', 'solar'].includes(ent.invention)) { const r = h('div', 'p-desc'); r.dataset.s = 'reading'; body.appendChild(r); }
      }
      if (mat.burn && !ent.inv) mk('Ignite', 'warn', () => sim.ignite(ent));
      // Things that don't melt (wood, food, plastics, devices) get Heat instead of Melt/Boil.
      const melts = ent.props.mp < 8000;
      if (melts) mk('Melt', '', () => sim.setTemperature(ent, Math.min(ent.props.bp - 5, ent.props.mp + 250)));
      if (melts && ent.props.bp < 8000) mk('Boil', '', () => sim.setTemperature(ent, ent.props.bp + 80));
      if (!melts) mk('Heat', '', () => sim.setTemperature(ent, Math.max(ent.T + 150, mat.burn ? ent.props.ignite + 20 : 600)));
      mk('Freeze', '', () => sim.setTemperature(ent, Math.max(1, Math.min(ent.props.mp - 30, 20))));
      mk('Explode', 'warn', () => sim.explodeEntity(ent, Math.max(6, Math.sqrt(sim.stats(ent).kg + 1) * 4)));
      mk('Duplicate', '', () => { const n = sim.duplicate(ent); if (n) this.openEntity(n); });
      mk('Focus (F)', '', () => { const s = sim.stats(ent); if (s.count) this.view.focus(s.cx, s.cy, s.cz); });
      mk('Delete', 'danger', () => { sim.remove(ent); this.closePanel(); });
      body.appendChild(btns);

      const rows = [];
      if (isBody && !ent.container && !ent.dummy) rows.push(this.sliderRow({ label: 'Size', unit: '×', min: 0.2, max: 6, log: true },
        () => sim.sizeOf(this.panel && this.panel.entity || ent),
        (v) => { const cur = this.panel && this.panel.entity; if (!cur || cur.kind !== 'body') return; const n = sim.resizeTo(cur, v); if (n !== cur) { this.panel.entity = n; this.view.selected = n; } }));
      if (!isBody) rows.push(this.sliderRow({ label: 'Amount', unit: 'particles', min: 1, max: 6000, log: true, int: true, defer: true }, () => sim.stats(ent).count, (v) => sim.fluid.setGroupAmount(ent, v)));
      rows.push(this.sliderRow({ label: 'Set temperature', unit: 'K', min: 1, max: 1e8, log: true }, () => sim.stats(ent).T, (v) => sim.setTemperature(ent, v), (v) => `${fmt(kToC(v))} °C`));
      this.section(body, 'State', rows);
      this.propSections(body, mat, ent.props, () => sim.refresh(ent), isBody);
      this.refreshEntityStats();
    }

    refreshEntityStats() {
      if (!this.panel || this.panel.mode !== 'entity') return;
      const ent = this.panel.entity, p = $('#panel');
      const st = this.sim.stats(ent);
      const set = (k, v) => { const e = p.querySelector(`[data-s="${k}"]`); if (e) e.textContent = v; };
      set('count', ent.kind === 'body' ? (ent.volume * 1000).toFixed(2) + ' L' : st.count.toLocaleString());
      set('mass', fmtKg(st.kg));
      set('mol', fmt(st.moles) + ' mol');
      set('T', fmt(st.T) + ' K');
      set('C', fmt(kToC(st.T)) + '°');
      set('v', fmt(st.speed) + ' m/s');
      if (ent.container && ent.bindId != null) {
        const P = ent.pressure || 101325, lim = { glass: 6, ceramic: 10, steel: 60, concrete: 20 }[PC.MATS[ent.mat].id] || 10;
        set('pressure', ent.props.sealed ? `Lid on · pressure ${(P / 1e5).toFixed(2)} bar (bursts above ~${lim} bar)` : 'Open top · gases escape, pressure 1.01 bar');
      }
      if (ent.inv && ent.invention === 'thermometer') set('reading', `Reading: ${fmt(kToC(ent.inv.reading || ent.T))} °C (${fmt(ent.inv.reading || ent.T)} K)`);
      if (ent.inv && ent.invention !== 'thermometer' && (ent.invention === 'bulb' || ent.invention === 'solar')) set('reading', ent.inv.lit ? '● Powered' : '○ No power');
      const tot = Math.max(1, st.count);
      for (const i of p.querySelectorAll('.phasebar i')) i.style.width = (100 * st.phases[+i.dataset.ph] / tot) + '%';
    }

    propSections(body, mat, props, onChange, isBody) {
      const bySec = {};
      for (const d of PROP_SCHEMA) {
        if (d.when && !d.when(mat)) continue;
        if (isBody && d.particles) continue;
        (bySec[d.section] = bySec[d.section] || []).push(d);
      }
      for (const [sec, defs] of Object.entries(bySec)) {
        const rows = defs.map((d) => {
          if (d.type === 'color') return this.colorRow(d.label, () => props.color, (v) => { props.color = v; onChange(); });
          if (d.type === 'toggle') return this.toggleRow(d.label, () => props[d.key], (v) => { props[d.key] = v; onChange(); });
          return this.sliderRow(d, () => props[d.key], (v) => { props[d.key] = v; onChange(); });
        });
        this.section(body, sec, rows, sec !== 'Physical');
      }
    }

    section(body, title, rows, collapsed) {
      const t = h('div', 'group-title' + (collapsed ? ' collapsed' : ''), `<span class="car">▼</span>${esc(title)}`);
      const box = h('div');
      rows.forEach((r) => box.appendChild(r));
      if (collapsed) box.classList.add('hidden');
      t.onclick = () => { t.classList.toggle('collapsed'); box.classList.toggle('hidden'); };
      body.append(t, box);
    }

    sliderRow(d, get, set, extra) {
      const row = h('div', 'row');
      const id = 'r' + Math.random().toString(36).slice(2);
      row.innerHTML = `<label for="${id}">${esc(d.label)}</label><div class="val"><input type="number" step="any"><span class="unit">${esc(d.unit || '')}</span></div><input id="${id}" type="range" min="0" max="1000" step="1">${extra ? '<div class="hint dyn"></div>' : ''}${d.hint ? `<div class="hint">${esc(d.hint)}</div>` : ''}`;
      const num = row.querySelector('input[type=number]'), rng = row.querySelector('input[type=range]'), hint = row.querySelector('.hint.dyn');
      const show = (v) => {
        num.value = v >= 1e8 && d.inf ? '' : +(+v).toPrecision(5);
        num.placeholder = v >= 1e8 ? '∞' : '';
        rng.value = toSlider(v >= 1e8 && d.inf ? d.max : v, d);
        if (hint) hint.textContent = extra(v);
      };
      show(get());
      let pending = null;
      rng.oninput = () => {
        let v = fromSlider(+rng.value, d);
        if (d.inf && +rng.value >= 1000) v = 1e9;
        show(v);
        // Heavy settings update a few times a second while dragging, and once more when the drag settles.
        if (d.defer) {
          const now = performance.now();
          clearTimeout(pending);
          if (now - (row.lastSet || 0) > 80) { row.lastSet = now; set(v); } else pending = setTimeout(() => { row.lastSet = performance.now(); set(v); }, 90);
        } else set(v);
        this.app.save();
      };
      num.onchange = () => { const v = num.value === '' && d.inf ? 1e9 : +num.value; if (Number.isFinite(v)) { set(v); show(v); } };
      row.refresh = () => show(get());
      return row;
    }
    selectRow(label, options, get, set) {
      const row = h('div', 'row');
      row.innerHTML = `<label>${esc(label)}</label><select>${options.map(([v, l]) => `<option value="${v}">${esc(l)}</option>`).join('')}</select>`;
      const sel = row.querySelector('select');
      sel.value = String(get());
      sel.onchange = () => { const v = sel.value; set(v === '' || Number.isNaN(+v) ? v : +v); };
      row.refresh = () => { sel.value = String(get()); };
      return row;
    }
    toggleRow(label, get, set) {
      const row = h('div', 'row');
      row.innerHTML = `<label>${esc(label)}</label><button class="toggle" type="button" aria-label="${esc(label)}"></button>`;
      const b = row.querySelector('button');
      const sync = () => { b.classList.toggle('on', !!get()); b.setAttribute('aria-pressed', !!get()); };
      b.onclick = () => { set(!get()); sync(); };
      sync();
      row.refresh = sync;
      return row;
    }
    colorRow(label, get, set) {
      const row = h('div', 'row');
      row.innerHTML = `<label>${esc(label)}</label><input type="color">`;
      const c = row.querySelector('input');
      c.value = get();
      c.oninput = () => set(c.value);
      return row;
    }

    // ------------------------------------------------------------------ settings drawer
    toggleSettings() {
      const d = $('#settings');
      d.classList.toggle('hidden');
      $('#nature').classList.add('hidden');
      if (!d.classList.contains('hidden')) this.renderSettings();
    }
    renderSettings() {
      const d = $('#settings');
      const tabs = Object.keys(SETTINGS_SCHEMA);
      this.settingsTab = this.settingsTab || 'Graphics';
      d.innerHTML = `<div class="d-head"><h2>Settings</h2><button class="p-close" style="position:static">×</button></div>
        <div class="d-tabs">${tabs.map((t) => `<button data-t="${t}" class="${t === this.settingsTab ? 'active' : ''}">${t}</button>`).join('')}</div><div class="d-body"></div>`;
      d.querySelector('.p-close').onclick = () => d.classList.add('hidden');
      for (const b of d.querySelectorAll('.d-tabs button')) b.onclick = () => { this.settingsTab = b.dataset.t; this.renderSettings(); };
      const body = d.querySelector('.d-body');
      this.settingRows = [];
      for (const def of SETTINGS_SCHEMA[this.settingsTab]) {
        let row;
        const set = (v) => this.applySetting(def.key, v);
        if (def.type === 'presets') {
          row = h('div');
          row.innerHTML = `<div class="presets">${Object.keys(QUALITY).map((q) => `<button data-q="${q}" class="${this.s.quality === q ? 'active' : ''}">${q[0].toUpperCase() + q.slice(1)}</button>`).join('')}</div>`;
          for (const b of row.querySelectorAll('button')) b.onclick = () => { for (const [k, v] of Object.entries(QUALITY[b.dataset.q])) this.applySetting(k, v, true); this.s.quality = b.dataset.q; this.app.save(); this.renderSettings(); };
        } else if (def.type === 'toggle') row = this.toggleRow(def.label, () => this.s[def.key], set);
        else if (def.type === 'select') row = this.selectRow(def.label, def.options, () => this.s[def.key], set);
        else row = this.sliderRow(Object.assign({ defer: ['renderScale', 'fluidQuality', 'sunElevation', 'sunAzimuth'].includes(def.key) }, def), () => this.s[def.key], set);
        if (def.hint && def.type) row.appendChild(h('div', 'hint', esc(def.hint)));
        body.appendChild(row);
        this.settingRows.push(row);
      }
      if (this.settingsTab === 'Tools') {
        const btns = h('div', 'btns');
        const reset = h('button', 'btn', 'Reset all settings');
        reset.onclick = () => { for (const [k, v] of Object.entries(PC.DEFAULT_SETTINGS)) if (k !== 'maxParticles' && k !== 'worldWidth') this.applySetting(k, v, true); this.app.save(); this.renderSettings(); };
        const forget = h('button', 'btn danger', 'Forget discoveries');
        forget.onclick = () => { this.sim.discovered.clear(); this.newKeys.clear(); this.app.save(); this.updateDiscCount(); this.renderSidebar(); };
        btns.append(reset, forget);
        body.appendChild(btns);
      }
    }
    refreshSettingsValues() { for (const r of this.settingRows || []) if (r.refresh) r.refresh(); }

    applySetting(key, v, quiet) {
      const s = this.s, view = this.view;
      s[key] = v;
      if (!quiet && ['renderScale', 'shadows', 'fluidQuality', 'fluidSmoothing', 'bloom', 'scenery'].includes(key)) s.quality = 'custom';
      if (key === 'renderScale' || key === 'fluidQuality') this.app.resize();
      if (key === 'shadows') view.applyShadowQuality();
      if (key === 'environment' || key === 'fog' || ((key === 'sunElevation' || key === 'sunAzimuth') && s.environment === 'day')) view.applyEnvironment();
      if (key === 'scenery') { if (v) view.loadScenery(); if (view.sceneryGroup) view.sceneryGroup.visible = !!v; }
      if (key === 'worldWidth' || key === 'maxParticles') this.app.rebuild();
      if (key === 'timeScale') $('#speedSel').value = String(v);
      if (key === 'brushRadius') { $('#brushSize').value = v; $('#brushOut').textContent = (v * 100).toFixed(0) + ' cm'; }
      if (key === 'windSpeed' && this.syncWind) this.syncWind();
      if ((key === 'sound' || key === 'volume') && this.syncSound) this.syncSound();
      this.app.save();
    }

    // ------------------------------------------------------------------ nature drawer
    toggleNature() {
      const d = $('#nature');
      d.classList.toggle('hidden');
      if (!d.classList.contains('hidden')) { $('#settings').classList.add('hidden'); this.renderNature(); }
    }
    renderNature() {
      const d = $('#nature'), s = this.s;
      const hhmm = (h) => `${String(Math.floor(h)).padStart(2, '0')}:${String(Math.floor((h % 1) * 60)).padStart(2, '0')}`;
      const icons = { clear: PC.ico('sun'), cloudy: PC.ico('cloud'), rain: PC.ico('rain'), storm: PC.ico('storm'), snow: PC.ico('snow'), fog: PC.ico('fog') };
      d.innerHTML = `<div class="d-head"><h2>Nature</h2><button class="p-close" style="position:static">×</button></div><div class="d-body"></div>`;
      d.querySelector('.p-close').onclick = () => d.classList.add('hidden');
      const body = d.querySelector('.d-body');
      this.natureRows = [];
      const push = (r) => { body.appendChild(r); this.natureRows.push(r); return r; };
      // Time of day.
      body.appendChild(h('div', 'group-title', '<span class="car">▼</span>Time of day'));
      const clock = h('div', 'clock', `<div class="clock-time">${hhmm(s.timeOfDay)}</div><div class="clock-sub">${s.timeOfDay < 5.5 || s.timeOfDay > 19 ? 'Night' : s.timeOfDay < 8 ? 'Sunrise' : s.timeOfDay > 17 ? 'Evening' : 'Day'}</div>`);
      body.appendChild(clock);
      this.natureClock = clock;
      push(this.sliderRow({ label: 'Time', unit: 'h', min: 0, max: 23.99, step: 0.05 }, () => s.timeOfDay, (v) => { s.timeOfDay = v; this.app.save(); }));
      const quick = h('div', 'presets');
      for (const [l, t] of [['Dawn', 6.2], ['Noon', 12], ['Sunset', 18.4], ['Night', 23]]) { const b = h('button', '', l); b.onclick = () => { s.timeOfDay = t; this.refreshNature(); this.app.save(); }; quick.appendChild(b); }
      body.appendChild(quick);
      push(this.selectRow('Day / night cycle', [[0, 'Paused'], [2, '2 minutes per day'], [5, '5 minutes per day'], [10, '10 minutes per day'], [30, '30 minutes per day']], () => s.dayLength, (v) => { s.dayLength = v; this.app.save(); }));
      // Weather.
      body.appendChild(h('div', 'group-title', '<span class="car">▼</span>Weather'));
      const wp = h('div', 'weather-grid');
      for (const [k, p] of Object.entries(PC.WEATHER_PRESETS)) {
        const b = h('button', s.weather === k ? 'active' : '', `<span class="wi">${icons[k]}</span>${k[0].toUpperCase() + k.slice(1)}`);
        b.onclick = () => { s.weather = k; Object.assign(s, p); if (k !== 'snow' && s.ambientT < 273) s.ambientT = 293; if (this.syncWind) this.syncWind(); this.app.save(); this.renderNature(); };
        wp.appendChild(b);
      }
      body.appendChild(wp);
      push(this.sliderRow({ label: 'Cloud cover', unit: '%', min: 0, max: 1, step: 0.01 }, () => s.cloudCover, (v) => { s.cloudCover = v; this.app.save(); }));
      push(this.sliderRow({ label: 'Rain', unit: '', min: 0, max: 1, step: 0.01 }, () => s.rain, (v) => { s.rain = v; this.app.save(); }));
      push(this.sliderRow({ label: 'Snow', unit: '', min: 0, max: 1, step: 0.01 }, () => s.snow, (v) => { s.snow = v; this.app.save(); }));
      push(this.sliderRow({ label: 'Fog', unit: '', min: 0, max: 1, step: 0.01 }, () => s.fog, (v) => { s.fog = v; this.app.save(); }));
      push(this.toggleRow('Lightning (during rain)', () => s.lightning, (v) => { s.lightning = v; this.app.save(); }));
      push(this.toggleRow('Rain fills open containers', () => s.rainFills, (v) => { s.rainFills = v; this.app.save(); }));
      const strike = h('div', 'btns');
      const sb = h('button', 'btn warn', PC.ico('bolt') + ' Strike lightning now');
      sb.onclick = () => this.view.weather.strike(this.mouse.point || null);
      strike.appendChild(sb);
      body.appendChild(strike);
      // Wind.
      body.appendChild(h('div', 'group-title', '<span class="car">▼</span>Wind'));
      const dial = h('div', 'wind-dial');
      dial.innerHTML = `<svg viewBox="0 0 140 140"><circle cx="70" cy="70" r="62" class="ring"/>${['N', 'E', 'S', 'W'].map((t, k) => `<text x="${70 + Math.sin(k * Math.PI / 2) * 50}" y="${74 - Math.cos(k * Math.PI / 2) * 50}" text-anchor="middle">${t}</text>`).join('')}<g class="arrow"><line x1="70" y1="70" x2="70" y2="22"/><path d="M70 14 L62 30 L78 30z"/></g><circle cx="70" cy="70" r="5" class="hub"/></svg><div class="dial-info"><b class="dial-dir"></b><span>Drag to set where the wind blows towards</span></div>`;
      body.appendChild(dial);
      const svg = dial.querySelector('svg'), arrow = dial.querySelector('.arrow'), info = dial.querySelector('.dial-dir');
      // Screen-up on the dial = −z in the world (away from the default camera); windDir is measured from +x.
      const dialAngle = () => (s.windDir + 90) % 360;
      const syncDial = () => { arrow.setAttribute('transform', `rotate(${dialAngle()} 70 70)`); info.textContent = `${Math.round(s.windDir)}° · ${(+s.windSpeed).toFixed(1)} m/s`; };
      const setFrom = (ev) => {
        const r = svg.getBoundingClientRect(), x = ev.clientX - r.left - r.width / 2, y = ev.clientY - r.top - r.height / 2;
        const ang = (Math.atan2(x, -y) * 180 / Math.PI + 360) % 360;
        s.windDir = (ang - 90 + 360) % 360; syncDial(); this.app.save();
      };
      svg.addEventListener('pointerdown', (ev) => { svg.setPointerCapture(ev.pointerId); setFrom(ev); const mv = (e2) => setFrom(e2); const up = () => { svg.removeEventListener('pointermove', mv); svg.removeEventListener('pointerup', up); }; svg.addEventListener('pointermove', mv); svg.addEventListener('pointerup', up); });
      syncDial();
      this.syncDial = syncDial;
      push(this.sliderRow({ label: 'Wind speed', unit: 'm/s', min: 0, max: 30, step: 0.1 }, () => s.windSpeed, (v) => { s.windSpeed = v; syncDial(); if (this.syncWind) this.syncWind(); this.app.save(); }));
      push(this.sliderRow({ label: 'Gustiness', unit: '', min: 0, max: 1.5, step: 0.05 }, () => s.windGust, (v) => { s.windGust = v; this.app.save(); }));
      push(this.sliderRow({ label: 'Wind ↔ water coupling', unit: '×', min: 0, max: 5, step: 0.1 }, () => s.windWater, (v) => { s.windWater = v; this.app.save(); }));
      // Temperature.
      body.appendChild(h('div', 'group-title', '<span class="car">▼</span>Air temperature'));
      push(this.sliderRow({ label: 'Outdoor temperature', unit: '°C', min: -60, max: 60, step: 0.5 }, () => s.ambientT - 273.15, (v) => { s.ambientT = v + 273.15; this.app.save(); }, (v) => (v < 0 ? 'Below freezing — water outside will freeze' : v > 40 ? 'Hot day' : 'Mild')));
    }
    refreshNature() {
      if ($('#nature').classList.contains('hidden')) return;
      for (const r of this.natureRows || []) if (r.refresh) r.refresh();
      if (this.syncDial) this.syncDial();
      if (this.natureClock) {
        const h2 = this.s.timeOfDay;
        this.natureClock.querySelector('.clock-time').textContent = `${String(Math.floor(h2)).padStart(2, '0')}:${String(Math.floor((h2 % 1) * 60)).padStart(2, '0')}`;
        this.natureClock.querySelector('.clock-sub').textContent = h2 < 5.5 || h2 > 19 ? 'Night' : h2 < 8 ? 'Sunrise' : h2 > 17 ? 'Evening' : 'Day';
      }
    }

    // ------------------------------------------------------------------ help
    renderHelp() {
      const m = $('#help');
      m.innerHTML = `<div class="modal-card"><h2>Welcome to PhysicsCraft</h2>
        <p>A 3D physics &amp; chemistry lab in a Japanese garden. Drag elements, materials and containers from the sidebar onto the stone terrace. The ground is the floor of the world; the terrace stretches left and right like a long whiteboard.</p>
        <div class="help-grid">
          <div><span>Spawn something</span><span>drag a card into the view</span></div>
          <div><span>Edit a material</span><span>click its card</span></div>
          <div><span>Inspect an object</span><span>click it (Stir / Grab)</span></div>
          <div><span>Orbit camera</span><span><kbd>right-drag</kbd></span></div>
          <div><span>Pan</span><span><kbd>middle-drag</kbd> · <kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> · minimap</span></div>
          <div><span>Zoom</span><span><kbd>scroll</kbd> · <kbd>+</kbd>/<kbd>−</kbd></span></div>
          <div><span>Tools</span><span><kbd>1</kbd>–<kbd>8</kbd></span></div>
          <div><span>Wind</span><span>flag button / Wind tool <kbd>3</kbd></span></div>
          <div><span>Pause / step</span><span><kbd>Space</kbd> · <kbd>.</kbd></span></div>
          <div><span>Delete / focus selected</span><span><kbd>Del</kbd> · <kbd>F</kbd></span></div>
          <div><span>Undo / redo</span><span><kbd>Ctrl</kbd><kbd>Z</kbd> · <kbd>Ctrl</kbd><kbd>Shift</kbd><kbd>Z</kbd></span></div>
          <div><span>Rewind 5 seconds</span><span><kbd>R</kbd></span></div>
          <div><span>Save / open scene</span><span><kbd>Ctrl</kbd><kbd>S</kbd> · <kbd>Ctrl</kbd><kbd>O</kbd></span></div>
          <div><span>Instruments</span><span><kbd>I</kbd></span></div>
        </div>
        ${this.onboarding ? this.onboarding.listHtml() : ''}
        <p>Start with an <b>Aquarium</b> or <b>Stone Pond</b>, fill it with <b>Water</b> and watch it settle perfectly still — then raise the wind, drop in sodium, float a wood plank, melt an ice cube, or pour lava in. Settings → Graphics has environment, quality, shadows and the thermal camera.</p>
        <div class="btns"><button class="btn" id="helpTour">Take the tour</button><button class="btn primary" id="helpClose">Start experimenting</button></div></div>`;
      m.onclick = (e) => { if (e.target === m) m.classList.add('hidden'); };
      m.querySelector('#helpClose').onclick = () => m.classList.add('hidden');
      m.querySelector('#helpTour').onclick = () => { m.classList.add('hidden'); this.onboarding.start(); };
    }
    toggleHelp() { const m = $('#help'); if (m.classList.contains('hidden')) this.renderHelp(); m.classList.toggle('hidden'); }
  }

  PC.UI = UI;
})(window.PC);
