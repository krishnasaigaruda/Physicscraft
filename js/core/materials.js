// Material registry: every substance the simulation understands.
// Elements are generated from PC.ELEMENTS; basics, compounds and container materials are hand-authored.
(function (PC) {
  'use strict';

  const MATS = [];           // index -> material
  const BY_ID = {};          // id -> material

  function hexToRgb(hex) {
    const h = hex.replace('#', '');
    const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  function lighten(hex, f) {
    const [r, g, b] = hexToRgb(hex);
    const m = (c) => Math.round(c + (255 - c) * f);
    return '#' + [m(r), m(g), m(b)].map((c) => c.toString(16).padStart(2, '0')).join('');
  }
  PC.hexToRgb = hexToRgb;
  PC.lighten = lighten;

  const BASE = {
    kind: 'compound', formula: '', density: 1, M: 30, mp: 273, bp: 373,
    powder: false, viscosity: 0.08, stiffness: 0.55, strength: 0.25, friction: 0.35, restitution: 0.12,
    heatCap: 1, cond: 0.15, opacity: 1, gasAlpha: 0.22, metallic: false, glow: 0, emit: null,
    life: null, burn: null, meltInto: null, freezeInto: null, boilInto: null, radioactive: null,
    fissile: null, shock: 0, heatOut: 0, gravity: 1, pinnedDefault: false, tags: [],
    phaseNames: null, phaseColors: null, desc: '',
  };

  function add(def) {
    const m = Object.assign({}, BASE, def);
    m.tags = new Set(def.tags || []);
    m.index = MATS.length;
    m.phaseColors = Object.assign({ solid: m.color, liquid: m.color, gas: lighten(m.color, 0.35) }, def.phaseColors || {});
    m.rgb = {
      solid: hexToRgb(m.phaseColors.solid), liquid: hexToRgb(m.phaseColors.liquid), gas: hexToRgb(m.phaseColors.gas),
    };
    if (m.emit) m.emitRgb = hexToRgb(m.emit);
    MATS.push(m);
    BY_ID[m.id] = m;
    return m;
  }

  // ---------------- Elements ----------------
  // Densities of the condensed (liquid/solid) phase for elements that are gases at room temperature.
  const CONDENSED = { H: 0.07, He: 0.125, N: 0.807, O: 1.141, F: 1.505, Ne: 1.207, Cl: 1.56, Ar: 1.395, Kr: 2.413, Xe: 2.942, Rn: 4.4 };
  const DIATOMIC = new Set(['H', 'N', 'O', 'F', 'Cl', 'Br', 'I']);
  const POWDERS = new Set(['C', 'S', 'B', 'Se', 'As', 'P']);
  const GAS_TINT = { Cl: ['#c9ef5a', 0.45], F: ['#f3fbb0', 0.35], Br: ['#c8541c', 0.55], I: ['#a14fd6', 0.55], S: ['#f5c542', 0.3], Hg: ['#e9ecef', 0.15], Na: ['#ffd27a', 0.25] };
  const BURN = {
    H: { ignite: 850, into: ['water'], rate: 0.6, heat: 2200, explode: 1.1, flame: 0 },
    C: { ignite: 973, into: ['co2'], rate: 0.025, heat: 900, flame: 0.25 },
    Mg: { ignite: 900, into: ['mgo'], rate: 0.05, heat: 2600, flame: 0.5, flash: '#ffffff' },
    S: { ignite: 505, into: ['so2'], rate: 0.03, heat: 600, flame: 0.3 },
    P: { ignite: 307, into: ['p4o10'], rate: 0.06, heat: 900, flame: 0.45 },
    Fe: { ignite: 1500, into: ['rust'], rate: 0.01, heat: 500, flame: 0.15 },
    Al: { ignite: 1700, into: ['alumina'], rate: 0.02, heat: 1800, flame: 0.3, flash: '#ffffff' },
    Zn: { ignite: 1180, into: ['metal_oxide'], rate: 0.02, heat: 700, flame: 0.3 },
    Ti: { ignite: 1900, into: ['metal_oxide'], rate: 0.02, heat: 1500, flame: 0.4, flash: '#ffffff' },
  };
  const DESC = {
    H: 'Lightest element. Rises in air and burns explosively once ignited (~850 K).',
    He: 'Inert noble gas, far lighter than air. Fuses into carbon in extreme stellar conditions.',
    Li: 'Soft alkali metal that floats on water and reacts gently, burning crimson.',
    Na: 'Alkali metal. Reacts violently with water, releasing hydrogen and heat with a yellow flame.',
    K: 'Alkali metal. Ignites on contact with water with a lilac flame.',
    Rb: 'Alkali metal. Explodes on contact with water.',
    Cs: 'The most reactive stable alkali metal. Explodes violently in water. Melts near body temperature.',
    Fr: 'Extremely rare, radioactive and wildly reactive alkali metal.',
    Mg: 'Burns with a blinding white flame. Ignite it with heat.',
    Fe: 'Iron. Rusts slowly with water and oxygen; becomes steel with carbon at high temperature.',
    Cu: 'Conducts heat superbly. Alloys with tin (bronze) and zinc (brass) when molten.',
    Au: 'Gold. Almost completely unreactive, but dissolves into mercury as an amalgam.',
    Hg: 'The only metal that is liquid at room temperature. Very dense.',
    Ga: 'Melts just above room temperature (303 K). Warm it with the heat tool.',
    U: 'Radioactive and fissile. Gather enough of it together and it goes supercritical.',
    Pu: 'Highly fissile. Its critical mass is smaller than uranium\'s.',
    O: 'Feeds combustion. Fire in oxygen spreads violently.',
    Cl: 'Toxic yellow-green gas, heavier than air. Forms salt with sodium.',
    F: 'The most reactive element. Attacks almost everything it touches.',
    N: 'Inert-ish gas making up 78% of air. Liquid below 77 K.',
    C: 'Carbon. Burns into CO₂ when hot and turns iron into steel.',
    P: 'White phosphorus spontaneously ignites just above room temperature.',
    S: 'Brimstone. Burns with a blue flame into sulfur dioxide.',
    W: 'Tungsten. Highest melting point of any metal (3695 K).',
    Ne: 'Noble gas that glows red-orange as plasma.',
  };

  for (const el of PC.ELEMENTS) {
    const cat = PC.CATEGORIES[el.cat];
    const look = el.look || (el.metal ? lighten('#8c929b', 0.25) : '#9aa0a8');
    const gasTint = GAS_TINT[el.sym];
    const isGasAtRT = el.state === 'Gas';
    const tags = [el.cat, 'element'];
    if (el.metal) tags.push('metal');
    if (['Au', 'Pt', 'Ag', 'Cu', 'Pd', 'Ir', 'Os', 'Rh', 'Ru', 'Hg'].includes(el.sym)) tags.push('noble_metal');
    if (el.cat === 'noble') tags.push('inert');
    add({
      id: el.sym, name: el.name, formula: DIATOMIC.has(el.sym) ? el.sym + '₂' : el.sym, kind: 'element', el,
      color: look,
      phaseColors: { gas: gasTint ? gasTint[0] : lighten(look, 0.55) },
      gasAlpha: gasTint ? gasTint[1] : 0.16,
      density: CONDENSED[el.sym] || el.density,
      M: el.mass * (DIATOMIC.has(el.sym) ? 2 : 1),
      mp: el.mp, bp: Math.max(el.bp, el.mp),
      powder: POWDERS.has(el.sym),
      viscosity: el.metal ? 0.12 : 0.06,
      strength: el.metal ? 0.38 : 0.18,
      stiffness: el.metal ? 0.65 : 0.5,
      heatCap: el.metal ? 0.45 : isGasAtRT ? 1.0 : 0.8,
      cond: el.metal ? 0.8 : 0.12,
      metallic: el.metal,
      opacity: el.metal ? 1 : 0.85,
      emit: el.emission,
      burn: BURN[el.sym] || (el.cat === 'alkali' ? { ignite: el.mp + 60, into: ['metal_oxide'], rate: 0.015, heat: 500, flame: 0.35 } : null),
      radioactive: el.radioactive,
      fissile: el.sym === 'U' ? { criticalKg: 52 } : el.sym === 'Pu' ? { criticalKg: 10 } : null,
      glow: el.radioactive ? 0.25 : 0,
      tags,
      desc: DESC[el.sym] || `${cat.label}. ${el.state} at room temperature.${el.predicted ? ' Properties are theoretical predictions.' : ''}`,
    });
  }

  // ---------------- Basic materials ----------------
  add({ id: 'water', name: 'Water', formula: 'H₂O', kind: 'basic', color: '#2b8cff', density: 1.0, densitySolid: 0.917,
    phaseNames: { solid: 'Ice', liquid: 'Water', gas: 'Steam' }, phaseColors: { solid: '#cdefff', liquid: '#7fd3d6', gas: '#f1f7ff' },
    M: 18.015, mp: 273.15, bp: 373.15, viscosity: 0.06, opacity: 0.7, heatCap: 4.18, cond: 0.35, strength: 0.16, gasAlpha: 0.3,
    tags: ['water'], desc: 'Freezes at 273 K, boils at 373 K. Reacts with alkali metals, puts out fires and cools lava into obsidian.' });
  add({ id: 'earth', name: 'Earth', formula: 'Soil', kind: 'basic', color: '#7a5230', density: 1.5, M: 60, mp: 1450, bp: 3000,
    powder: true, meltInto: 'lava', friction: 0.7, heatCap: 0.8, tags: ['soil'], desc: 'Loose soil. Mix with water to get mud.' });
  add({ id: 'fire', name: 'Fire', formula: 'Flame', kind: 'basic', color: '#ff8a1e', density: 0.0003, M: 29, mp: 0, bp: 1,
    life: [16, 40], emit: '#ff7a18', glow: 1, heatOut: 14, cond: 0.4, gasAlpha: 0.9, tags: ['fire'],
    desc: 'Hot, short-lived combustion gas. Ignites anything flammable nearby.' });
  add({ id: 'air', name: 'Air', formula: 'N₂ + O₂', kind: 'basic', color: '#d8ecff', density: 0.0012, M: 28.97, mp: 60, bp: 80,
    life: [200, 360], gasAlpha: 0.1, tags: ['oxidizer', 'air'], desc: 'A gust of air. Drop it to blow things around; it feeds fires.' });
  add({ id: 'stone', name: 'Stone', formula: 'Rock', kind: 'basic', color: '#7c7f87', density: 2.6, M: 60, mp: 1473, bp: 3200,
    meltInto: 'lava', strength: 0.5, stiffness: 0.75, heatCap: 0.8, cond: 0.25, tags: ['rock'], desc: 'Solid rock. Melts into lava above 1473 K.' });
  add({ id: 'sand', name: 'Sand', formula: 'SiO₂', kind: 'basic', color: '#e0bf73', density: 1.6, M: 60, mp: 1986, bp: 2503,
    powder: true, meltInto: 'glass', friction: 0.75, heatCap: 0.83, tags: ['sand'], desc: 'Granular silica. Melt it (1986 K) and let it cool to make glass.' });
  add({ id: 'wood', name: 'Wood', formula: 'C₆H₁₀O₅', kind: 'basic', color: '#9a6a3a', density: 0.6, M: 162, mp: 1e9, bp: 1e9,
    strength: 0.45, heatCap: 1.7, cond: 0.06, burn: { ignite: 573, into: ['ash', 'charcoal', 'fire'], rate: 0.01, heat: 420, flame: 0.22 },
    tags: ['organic'], desc: 'Floats on water. Catches fire around 573 K and leaves charcoal and ash.' });
  add({ id: 'oil', name: 'Oil', formula: 'CₙH₂ₙ₊₂', kind: 'basic', color: '#4b3310', density: 0.85, M: 230, mp: 240, bp: 620,
    viscosity: 0.3, opacity: 0.93, heatCap: 2.0, cond: 0.1, burn: { ignite: 480, into: ['fire', 'smoke'], rate: 0.03, heat: 700, flame: 0.5 },
    tags: ['organic'], desc: 'Floats on water and burns fiercely once ignited.' });
  add({ id: 'lava', name: 'Lava', formula: 'Molten rock', kind: 'basic', color: '#3b2622', density: 2.8, M: 60, mp: 1000, bp: 3200,
    freezeInto: 'stone', viscosity: 0.75, heatCap: 1.0, cond: 0.3, tags: ['rock'], desc: 'Molten rock. Solidifies into stone below 1000 K; quenched by water it becomes obsidian.' });
  add({ id: 'salt', name: 'Salt', formula: 'NaCl', kind: 'basic', color: '#dcdad3', friction: 0.7, density: 2.16, M: 58.44, mp: 1074, bp: 1738,
    powder: true, phaseNames: { solid: 'Salt', liquid: 'Molten Salt', gas: 'Salt Vapor' }, phaseColors: { liquid: '#ffd9a8' },
    tags: ['salt'], desc: 'Dissolves in water to make brine and melts ice.' });
  add({ id: 'gunpowder', name: 'Gunpowder', formula: 'KNO₃+C+S', kind: 'basic', color: '#3b3b3d', density: 1.7, M: 100, mp: 1e9, bp: 1e9,
    powder: true, burn: { ignite: 600, into: ['smoke', 'fire'], rate: 0.35, heat: 900, explode: 1.2, flame: 0.4 },
    tags: ['explosive'], desc: 'Black powder. Deflagrates in a chain once lit.' });
  add({ id: 'tnt', name: 'TNT', formula: 'C₇H₅N₃O₆', kind: 'basic', color: '#c8452d', density: 1.65, M: 227, mp: 354, bp: 568,
    strength: 0.5, burn: { ignite: 560, into: ['fire', 'smoke'], rate: 0.7, heat: 1500, explode: 4.5 }, shock: 16,
    tags: ['explosive'], desc: 'High explosive. Detonates when heated or hit by another blast.' });
  add({ id: 'nitro', name: 'Nitroglycerin', formula: 'C₃H₅N₃O₉', kind: 'basic', color: '#efe7a3', density: 1.6, M: 227, mp: 286, bp: 523,
    viscosity: 0.12, opacity: 0.65, burn: { ignite: 490, into: ['fire', 'smoke'], rate: 1, heat: 1500, explode: 3.5 }, shock: 5.5,
    tags: ['explosive'], desc: 'Shock-sensitive liquid explosive. Drop it from a height and it detonates.' });
  add({ id: 'thermite', name: 'Thermite', formula: 'Al + Fe₂O₃', kind: 'basic', color: '#7d4b3b', density: 4.0, M: 213, mp: 1e9, bp: 1e9,
    powder: true, burn: { ignite: 1100, into: ['Fe', 'alumina'], rate: 0.06, heat: 1900, flame: 0.35, flash: '#fff2c4' },
    tags: ['incendiary'], desc: 'Burns at ~2800 K and leaves molten iron. Needs a very hot trigger (1100 K).' });
  add({ id: 'methane', name: 'Methane', formula: 'CH₄', kind: 'basic', color: '#e7efff', density: 0.42, M: 16.04, mp: 90.7, bp: 111.6,
    gasAlpha: 0.14, burn: { ignite: 810, into: ['co2', 'water'], rate: 0.6, heat: 1800, explode: 1.0 }, tags: ['organic', 'fuel'],
    desc: 'Natural gas, lighter than air. Explodes when it meets a flame.' });
  add({ id: 'acid', name: 'Acid', formula: 'HCl(aq)', kind: 'basic', color: '#8dff5a', density: 1.18, M: 36.46, mp: 247, bp: 383,
    boilInto: ['hcl', 'water'], viscosity: 0.08, opacity: 0.72, heatCap: 3.0, tags: ['acid'], desc: 'Hydrochloric acid. Dissolves most metals, releasing hydrogen.' });
  add({ id: 'antimatter', name: 'Antimatter', formula: 'p̄ e⁺', kind: 'basic', color: '#b94dff', density: 1.0, M: 1, mp: 0, bp: 1e9,
    viscosity: 0.05, opacity: 0.85, gravity: 0.15, emit: '#c86bff', glow: 1, tags: ['antimatter'],
    desc: 'Annihilates with any ordinary matter it touches, releasing enormous energy.' });
  add({ id: 'wall', name: 'Wall', formula: 'Static', kind: 'basic', color: '#5b6270', density: 8, M: 100, mp: 1e9, bp: 1e9,
    strength: 10, friction: 0.5, pinnedDefault: true, cond: 0.05, tags: ['inert', 'static'], desc: 'Indestructible static wall. Use it to build containers and ramps.' });

  // ---------------- Compounds (discoverable) ----------------
  add({ id: 'mud', name: 'Mud', formula: 'Soil + H₂O', color: '#5b3d24', density: 1.7, M: 60, mp: 250, bp: 373, boilInto: ['brick', 'water'],
    viscosity: 0.9, heatCap: 2.5, tags: ['soil'], desc: 'Bake it and it becomes brick.' });
  add({ id: 'brick', name: 'Brick', formula: 'Fired clay', color: '#b4533a', density: 1.9, M: 60, mp: 1900, bp: 3200, meltInto: 'lava', strength: 0.5, tags: ['rock'] });
  add({ id: 'obsidian', name: 'Obsidian', formula: 'Volcanic glass', color: '#1d1726', density: 2.4, M: 60, mp: 1273, bp: 3200, meltInto: 'lava', strength: 0.3, metallic: true, tags: ['rock'] });
  add({ id: 'glass', name: 'Glass', formula: 'SiO₂ (amorphous)', color: '#bfe7f2', density: 2.5, M: 60, mp: 1700, bp: 2500,
    phaseNames: { solid: 'Glass', liquid: 'Molten Glass', gas: 'Silica Vapor' }, phaseColors: { liquid: '#ffb466' },
    strength: 0.14, stiffness: 0.8, opacity: 0.45, viscosity: 0.6, cond: 0.1, tags: ['glass'] });
  add({ id: 'concrete', name: 'Stone', formula: 'Granite', kind: 'container', color: '#8f8b84', density: 2.6, M: 60, mp: 1500, bp: 3200, meltInto: 'lava', strength: 0.7, stiffness: 0.8, cond: 0.2, tags: ['rock'] });
  add({ id: 'ceramic', name: 'Ceramic', formula: 'Al₂O₃·SiO₂', kind: 'container', color: '#e7dccb', density: 2.4, M: 100, mp: 3000, bp: 4000, strength: 0.8, stiffness: 0.8, cond: 0.04, tags: ['rock'] });
  add({ id: 'ash', name: 'Ash', formula: 'Ash', color: '#8e8a84', density: 0.6, M: 60, mp: 1500, bp: 3000, powder: true, meltInto: 'glass', tags: ['soil'] });
  add({ id: 'charcoal', name: 'Charcoal', formula: 'C', color: '#242120', density: 0.4, M: 12, mp: 3823, bp: 4098, powder: true, heatCap: 1.0, cond: 0.1,
    burn: { ignite: 620, into: ['ash', 'co2'], rate: 0.006, heat: 600, flame: 0.08 }, tags: ['organic'], desc: 'What is left of burnt wood. Glows and smoulders when hot.' });
  add({ id: 'smoke', name: 'Smoke', formula: 'Soot', color: '#555558', density: 0.0012, M: 29, mp: 0, bp: 1, life: [140, 300], gasAlpha: 0.45 });
  add({ id: 'co2', name: 'Carbon Dioxide', formula: 'CO₂', color: '#eef3ff', density: 1.56, M: 44.01, mp: 194.7, bp: 194.7, gasAlpha: 0.1,
    phaseNames: { solid: 'Dry Ice', liquid: 'Liquid CO₂', gas: 'Carbon Dioxide' }, phaseColors: { solid: '#f4f7fa', liquid: '#e8f0f6', gas: '#eef3ff' },
    powder: true, strength: 0.15, tags: ['inert'] }); // CO₂ freezes straight out of the air as white frost (dry-ice snow)
  add({ id: 'plastic', name: 'Plastic (ABS)', formula: '(C₈H₈·C₄H₆·C₃H₃N)ₙ', color: '#f2c230', density: 1.05, M: 211, mp: 9000, bp: 9500,
    strength: 0.6, heatCap: 1.4, cond: 0.17, restitution: 0.25, burn: { ignite: 690, into: ['smoke', 'fire', 'ash'], rate: 0.012, heat: 500, flame: 0.25 },
    tags: ['organic', 'polymer'], desc: 'Tough engineering plastic (crash-test dummies, toys). Softens and burns with sooty smoke around 690 K.' });
  add({ id: 'flesh', name: 'Living tissue', formula: 'H₂O, proteins, fats', color: '#d9a07f', density: 1.01, M: 30, mp: 9000, bp: 9500,
    strength: 0.3, heatCap: 3.5, cond: 0.45, restitution: 0.05, burn: { ignite: 640, into: ['ash', 'smoke', 'fire'], rate: 0.008, heat: 300, flame: 0.18 },
    tags: ['organic'], desc: 'Bodies of people and animals: mostly water, so they float about level and char rather than melt.' });
  // Kitchen chemistry.
  add({ id: 'sugar', name: 'Sugar', formula: 'C₁₂H₂₂O₁₁', kind: 'basic', color: '#f3f0e8', density: 1.59, M: 342.3, mp: 459, bp: 900, powder: true,
    meltInto: 'caramel', friction: 0.62, heatCap: 1.24, cond: 0.15, tags: ['organic', 'food'], desc: 'Dissolves in water into syrup; melts at 459 K into caramel, which burns if pushed further.' });
  add({ id: 'syrup', name: 'Sugar Syrup', formula: 'C₁₂H₂₂O₁₁(aq)', color: '#efd38a', density: 1.33, M: 30, mp: 255, bp: 381, viscosity: 0.55, opacity: 0.78,
    boilInto: ['water', 'sugar'], heatCap: 3.3, tags: ['food'], desc: 'Sugar dissolved in water. Boil the water off and the sugar crystallises again.' });
  add({ id: 'caramel', name: 'Caramel', formula: 'Cₓ(H₂O)ᵧ', color: '#a3591a', density: 1.3, M: 300, mp: 330, bp: 9000, viscosity: 0.85, opacity: 0.97,
    heatCap: 1.5, cond: 0.15, burn: { ignite: 620, into: ['ash', 'co2', 'fire'], rate: 0.02, heat: 350, flame: 0.2 }, tags: ['organic', 'food'],
    desc: 'Melted sugar. Sets into hard candy below 330 K and burns above 620 K.' });
  add({ id: 'vinegar', name: 'Vinegar', formula: 'CH₃COOH(aq)', kind: 'basic', color: '#efe4c2', density: 1.01, M: 18.6, mp: 271, bp: 373, opacity: 0.6,
    boilInto: ['water'], heatCap: 4.0, tags: ['weak_acid'], desc: 'About 5 % acetic acid — a weak acid (pH ≈ 2.4). Fizzes with baking soda.' });
  add({ id: 'baking_soda', name: 'Baking Soda', formula: 'NaHCO₃', kind: 'basic', color: '#f6f6f3', density: 2.2, M: 84, mp: 1100, bp: 3000, powder: true,
    friction: 0.6, tags: ['base', 'weak_base'], desc: 'Sodium bicarbonate, a mild base. With vinegar or acid it releases a burst of CO₂.' });
  add({ id: 'foam', name: 'Fizz Foam', formula: 'CO₂ bubbles in liquid', color: '#f7f6ee', density: 0.12, M: 20, mp: 200, bp: 9000,
    viscosity: 0.9, opacity: 0.97, life: [150, 330], lifeInto: 'co2', heatCap: 1, tags: ['foam'],
    desc: 'Froth of CO₂ bubbles. It rises, spreads and collapses within a few seconds, releasing the gas.' });
  add({ id: 'acetate', name: 'Sodium Acetate Solution', formula: 'CH₃COONa(aq)', color: '#e9efe6', density: 1.03, M: 19, mp: 270, bp: 374, opacity: 0.6,
    boilInto: ['water'], heatCap: 4.0, tags: [], desc: 'What is left after vinegar reacts with baking soda: water with dissolved sodium acetate.' });
  add({ id: 'rust', name: 'Rust', formula: 'Fe₂O₃', color: '#a1431a', density: 5.24, M: 159.7, mp: 1838, bp: 3000, powder: true, tags: ['oxide'] });
  add({ id: 'alumina', name: 'Alumina', formula: 'Al₂O₃', color: '#f1efe8', density: 3.95, M: 102, mp: 2345, bp: 3250, powder: true, tags: ['oxide'] });
  add({ id: 'mgo', name: 'Magnesium Oxide', formula: 'MgO', color: '#ffffff', density: 3.58, M: 40.3, mp: 3125, bp: 3870, powder: true, tags: ['oxide'] });
  add({ id: 'metal_oxide', name: 'Metal Oxide', formula: 'MₓOᵧ', color: '#e6e1d6', density: 3.5, M: 80, mp: 2000, bp: 3500, powder: true, tags: ['oxide'] });
  add({ id: 'lye', name: 'Lye', formula: 'NaOH(aq)', color: '#d4ecff', density: 1.3, M: 40, mp: 262, bp: 385, boilInto: ['water', 'salt'], opacity: 0.55, tags: ['base'],
    desc: 'Caustic hydroxide solution. Neutralises acid into brine.' });
  add({ id: 'brine', name: 'Brine', formula: 'NaCl(aq)', color: '#6fb2e8', density: 1.2, M: 20, mp: 252, bp: 381, boilInto: ['water', 'salt'], opacity: 0.72,
    phaseNames: { solid: 'Brine Ice', liquid: 'Brine', gas: 'Steam' }, phaseColors: { solid: '#dff3ff', gas: '#f1f7ff' }, tags: ['water'] });
  add({ id: 'hcl', name: 'Hydrogen Chloride', formula: 'HCl', color: '#eaffda', density: 1.19, M: 36.46, mp: 159, bp: 188, gasAlpha: 0.2 });
  add({ id: 'ammonia', name: 'Ammonia', formula: 'NH₃', color: '#f3f8ff', density: 0.68, M: 17.03, mp: 195, bp: 240, gasAlpha: 0.14, tags: ['base'] });
  add({ id: 'so2', name: 'Sulfur Dioxide', formula: 'SO₂', color: '#f2f2c2', density: 1.46, M: 64.07, mp: 200, bp: 263, gasAlpha: 0.25 });
  add({ id: 'p4o10', name: 'Phosphorus Pentoxide', formula: 'P₄O₁₀', color: '#f7f7f7', density: 0.0012, M: 29, mp: 0, bp: 1, life: [200, 380], gasAlpha: 0.55 });
  add({ id: 'bronze', name: 'Bronze', formula: 'Cu + Sn', color: '#b0793a', density: 8.8, M: 70, mp: 1223, bp: 2500, metallic: true, strength: 0.5, cond: 0.6, heatCap: 0.4, tags: ['metal', 'alloy'] });
  add({ id: 'brass', name: 'Brass', formula: 'Cu + Zn', color: '#d6b24a', density: 8.5, M: 65, mp: 1173, bp: 1900, metallic: true, strength: 0.5, cond: 0.6, heatCap: 0.4, tags: ['metal', 'alloy'] });
  add({ id: 'steel', name: 'Steel', formula: 'Fe + C', color: '#8d949c', density: 7.85, M: 56, mp: 1700, bp: 3100, metallic: true, strength: 0.75, stiffness: 0.8, cond: 0.5, heatCap: 0.49, tags: ['metal', 'alloy'] });
  add({ id: 'amalgam', name: 'Gold Amalgam', formula: 'Au·Hg', color: '#d8cfa4', density: 15, M: 200, mp: 250, bp: 630, metallic: true, viscosity: 0.4, tags: ['metal', 'alloy'] });
  add({ id: 'quicklime', name: 'Quicklime', formula: 'CaO', color: '#f3efe4', density: 3.34, M: 56, mp: 2886, bp: 3120, powder: true, tags: ['oxide', 'base'] });
  add({ id: 'slaked_lime', name: 'Slaked Lime', formula: 'Ca(OH)₂', color: '#fbfbf6', density: 2.21, M: 74, mp: 853, bp: 3000, powder: true, meltInto: 'quicklime', tags: ['base'] });
  add({ id: 'metal_chloride', name: 'Metal Chloride', formula: 'MClₓ', color: '#eef1e4', density: 2.5, M: 100, mp: 1000, bp: 1700, powder: true, tags: ['salt'] });
  add({ id: 'fluoride', name: 'Metal Fluoride', formula: 'MFₓ', color: '#f5efff', density: 3, M: 80, mp: 1600, bp: 2500, powder: true, tags: ['salt'] });

  // ---------------- Lookups ----------------
  PC.MATS = MATS;
  PC.MAT = BY_ID;
  PC.matIndex = (id) => (BY_ID[id] ? BY_ID[id].index : -1);

  PC.phaseName = function (mat, phase) {
    const key = phase === 3 ? 'gas' : phase === 2 ? 'liquid' : 'solid';
    if (mat.phaseNames && mat.phaseNames[key]) return mat.phaseNames[key];
    if (mat.kind === 'element') return (key === 'solid' ? '' : key === 'liquid' ? 'Liquid ' : '') + mat.name + (key === 'gas' && mat.el.state !== 'Gas' ? ' Vapor' : '');
    return mat.name;
  };

  // Default editable per-group properties derived from a material.
  PC.defaultProps = function (mat) {
    return {
      density: mat.density, massScale: 1, gravity: mat.gravity, friction: mat.friction, restitution: mat.restitution,
      viscosity: mat.viscosity, stiffness: mat.stiffness, strength: mat.strength, cohesion: 1, pressure: 1, drag: 1,
      mp: mat.mp, bp: mat.bp, ignite: mat.burn ? mat.burn.ignite : 0, heatCap: mat.heatCap, cond: mat.cond,
      reactivity: 1, explosive: 1, radioactivity: 1, glow: mat.glow, opacity: mat.opacity, color: mat.color,
      pinned: mat.pinnedDefault,
    };
  };

  // ---------------- Sidebar palette entries ----------------
  // Each entry spawns a material at a given temperature with a default amount.
  PC.BASICS = [
    { key: 'water', mat: 'water', label: 'Water', T: 293 },
    { key: 'ice', mat: 'water', label: 'Ice', T: 255 },
    { key: 'steam', mat: 'water', label: 'Steam', T: 420 },
    { key: 'earth', mat: 'earth', label: 'Earth', T: 293 },
    { key: 'fire', mat: 'fire', label: 'Fire', T: 1400 },
    { key: 'air', mat: 'air', label: 'Air', T: 293 },
    { key: 'stone', mat: 'stone', label: 'Stone', T: 293 },
    { key: 'sand', mat: 'sand', label: 'Sand', T: 293 },
    { key: 'wood', mat: 'wood', label: 'Wood', T: 293 },
    { key: 'oil', mat: 'oil', label: 'Oil', T: 293 },
    { key: 'lava', mat: 'lava', label: 'Lava', T: 1500 },
    { key: 'salt', mat: 'salt', label: 'Salt', T: 293 },
    { key: 'sugar', mat: 'sugar', label: 'Sugar', T: 293 },
    { key: 'vinegar', mat: 'vinegar', label: 'Vinegar', T: 293 },
    { key: 'baking_soda', mat: 'baking_soda', label: 'Baking Soda', T: 293 },
    { key: 'ln2', mat: 'N', label: 'Liquid Nitrogen', T: 70 },
    { key: 'gunpowder', mat: 'gunpowder', label: 'Gunpowder', T: 293 },
    { key: 'tnt', mat: 'tnt', label: 'TNT', T: 293 },
    { key: 'nitro', mat: 'nitro', label: 'Nitroglycerin', T: 293 },
    { key: 'thermite', mat: 'thermite', label: 'Thermite', T: 293 },
    { key: 'methane', mat: 'methane', label: 'Methane', T: 293 },
    { key: 'acid', mat: 'acid', label: 'Acid', T: 293 },
    { key: 'antimatter', mat: 'antimatter', label: 'Antimatter', T: 293 },
    { key: 'wall', mat: 'wall', label: 'Wall', T: 293 },
  ];

  // Container & structure prefabs (metres). Local origin: outside bottom centre.
  PC.CONTAINERS = [
    { key: 'beaker', label: 'Glass Beaker', mat: 'glass', shape: 'cup', R: 0.13, H: 0.28, t: 0.006 },
    { key: 'testtube', label: 'Test Tube', mat: 'glass', shape: 'cup', R: 0.045, H: 0.34, t: 0.004 },
    { key: 'crucible', label: 'Crucible', mat: 'ceramic', shape: 'cup', R: 0.11, H: 0.16, t: 0.02 },
    { key: 'tank', label: 'Steel Tank', mat: 'steel', shape: 'openbox', ix: 0.5, iz: 0.32, H: 0.45, t: 0.015 },
    { key: 'aquarium', label: 'Aquarium', mat: 'glass', shape: 'openbox', ix: 0.9, iz: 0.4, H: 0.55, t: 0.01 },
    { key: 'pool', label: 'Stone Pond', mat: 'concrete', shape: 'openbox', ix: 1.8, iz: 1.1, H: 0.45, t: 0.14 },
    { key: 'ramp', label: 'Ramp', mat: 'wall', shape: 'ramp', hx: 0.8, hy: 0.03, hz: 0.35, angle: 0.35 },
    { key: 'block', label: 'Concrete Block', mat: 'wall', shape: 'box', hx: 0.4, hy: 0.2, hz: 0.25 },
    { key: 'table', label: 'Lab Table', mat: 'steel', shape: 'table', hx: 0.8, hz: 0.4, Ht: 0.8 },
  ];
})(window.PC);
