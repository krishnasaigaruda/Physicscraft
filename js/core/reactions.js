// Reaction rules. Matchers: 'id' | ['id', ...] | '#tag' | '#tag!excludedTag' | '*' (any reactive matter).
// into: [productOfA, productOfB]; undefined = unchanged, null = consumed.
(function (PC) {
  'use strict';

  const R = [
    // Annihilation first so nothing else claims antimatter pairs.
    { a: 'antimatter', b: '*', rate: 1, into: [null, null], special: 'annihilate', name: 'Annihilation' },

    // Fusion (needs the fusion toggle and stellar temperatures).
    { a: 'H', b: 'H', minT: 1e7, rate: 0.05, into: ['He', null], heat: 4e6, explode: 3, flash: '#fff6d8', fusion: true, name: 'Hydrogen fusion' },
    { a: 'He', b: 'He', minT: 1e8, rate: 0.03, into: ['C', null], heat: 6e6, explode: 3, flash: '#ffffff', fusion: true, name: 'Triple-alpha process' },

    // Alkali and alkaline-earth metals with water / acids.
    { a: '#alkali', b: ['water', 'acid', 'brine', 'lye'], special: 'metalWater', name: 'Metal + water' },
    { a: ['Ca', 'Sr', 'Ba', 'Ra', 'Mg'], b: ['water', 'acid', 'brine'], special: 'metalWater', name: 'Alkaline earth + water' },

    // Halogens.
    { a: 'Na', b: 'Cl', rate: 0.25, into: ['salt', null], heat: 900, flash: '#ffcf5a', name: 'Salt synthesis' },
    { a: ['#alkali', '#alkaline'], b: ['Cl', 'Br', 'I'], rate: 0.2, into: ['metal_chloride', null], heat: 800, flash: '#ffe6a0' },
    { a: 'F', b: '#metal', rate: 0.35, into: [null, 'fluoride'], heat: 1400, flash: '#f6ffb0', name: 'Fluorination' },
    { a: 'F', b: '*', rate: 0.25, into: [null, 'fire'], heat: 900, flash: '#f6ffb0' },
    { a: 'H', b: 'Cl', minT: 450, rate: 0.3, into: ['hcl', 'hcl'], heat: 500, flash: '#e9ffb5' },

    // Hydrogen / oxygen chemistry.
    { a: 'H', b: 'O', minT: 800, rate: 0.6, into: ['water', null], heat: 2600, explode: 1.0, flash: '#bfe3ff', name: 'Hydrogen combustion',
      // Below ignition the gases still combine (catalysed), slowly and gently, into liquid water.
      alt: { rate: 0.05, into: ['water', null], heat: 40, flash: '#bfe3ff', name: '2H₂ + O₂ → 2H₂O' } },
    { a: 'hcl', b: 'water', rate: 0.25, into: [null, 'acid'], heat: 60 },
    { a: 'N', b: 'H', minT: 700, rate: 0.04, into: ['ammonia', null], heat: 150, name: 'Haber process' },

    // Combustion helpers.
    { a: 'fire', b: 'water', rate: 0.5, into: [null, undefined], heatB: 70, name: 'Extinguish' },
    { a: 'fire', b: 'O', rate: 0.5, into: ['fire', 'fire'], heat: 350 },
    { a: 'fire', b: 'air', rate: 0.12, into: ['fire', 'fire'], heat: 150 },
    { a: 'C', b: 'O', minT: 900, rate: 0.2, into: ['co2', null], heat: 900, flash: '#ffb070' },
    { a: 'S', b: 'O', minT: 480, rate: 0.2, into: ['so2', null], heat: 600, flash: '#6d8cff' },
    { a: 'P', b: 'O', minT: 300, rate: 0.3, into: ['p4o10', null], heat: 900, flash: '#ffffff' },
    { a: 'Ca', b: 'O', minT: 800, rate: 0.1, into: ['quicklime', null], heat: 700, flash: '#ff8a40' },
    { a: 'Mg', b: 'water', minT: 700, rate: 0.2, into: ['mgo', 'H'], heat: 600, flash: '#ffffff' },
    { a: '#metal!noble_metal', b: 'O', minT: 700, rate: 0.05, into: ['metal_oxide', null], heat: 600, flash: '#ffd08a' },

    // Oxidation / corrosion.
    { a: 'Fe', b: 'O', rate: 0.004, into: ['rust', null], heat: 20, name: 'Rusting' },
    { a: 'Fe', b: ['water', 'brine'], rate: 0.0012, into: ['rust', undefined], name: 'Rusting' },
    { a: 'Fe', b: 'air', rate: 0.0015, into: ['rust', undefined], name: 'Rusting' },
    { a: 'Al', b: 'rust', minT: 1200, rate: 0.3, into: ['Fe', 'alumina'], heat: 2000, flash: '#fff2c4', name: 'Thermite reaction' },

    // Acids and bases.
    { a: 'acid', b: '#metal!noble_metal', rate: 0.03, into: ['H', 'metal_chloride'], heat: 150, name: 'Acid attack' },
    // NaHCO₃ + acid → CO₂ foam + salt solution. Vinegar is only ~5 % acid: a particle of it neutralises ~1/20 of a
    // particle of soda (by volume), so extra soda is left undissolved; strong acid neutralises far more.
    { a: 'acid', b: 'baking_soda', rate: 0.3, special: 'fizz', spent: 'brine', sodaUse: 0.4, heat: 20, name: 'Fizz' },
    { a: 'vinegar', b: 'baking_soda', rate: 0.35, special: 'fizz', spent: 'acetate', sodaUse: 0.05, heat: -12, name: 'Fizz' },
    { a: 'vinegar', b: '#base', rate: 0.15, into: ['water', 'water'], heat: 60, name: 'Neutralisation' },
    { a: 'acid', b: '#base', rate: 0.25, into: ['brine', 'water'], heat: 220, name: 'Neutralisation' },
    { a: 'quicklime', b: 'water', rate: 0.1, into: ['slaked_lime', null], heat: 380, name: 'Slaking lime' },

    // Geology and materials.
    { a: 'lava', b: 'water', rate: 0.09, into: ['obsidian', undefined], heatB: 450, liquidB: true, name: 'Quenching' }, // liquid water only, not steam
    { a: 'earth', b: 'water', rate: 0.03, into: ['mud', null], name: 'Mud' },
    { a: 'salt', b: 'water', rate: 0.02, into: [null, 'brine'], heat: -12, name: 'Dissolving' },
    { a: 'sugar', b: 'water', rate: 0.015, into: [null, 'syrup'], heat: -5, name: 'Dissolving' },

    // Metallurgy.
    { a: 'Cu', b: 'Sn', minT: 1300, rate: 0.1, into: ['bronze', 'bronze'], name: 'Bronze' },
    { a: 'Cu', b: 'Zn', minT: 1200, rate: 0.1, into: ['brass', 'brass'], name: 'Brass' },
    { a: 'Fe', b: 'C', minT: 1700, rate: 0.1, into: ['steel', null], name: 'Steelmaking' },
    { a: 'Hg', b: 'Au', rate: 0.02, into: ['amalgam', 'amalgam'], name: 'Amalgamation' },
  ];

  function matcher(spec) {
    if (Array.isArray(spec)) {
      const set = new Set(spec.map((id) => PC.matIndex(id)));
      return (m) => set.has(m.index);
    }
    if (spec === '*') return (m) => !m.tags.has('static') && !m.tags.has('inert') && m.id !== 'antimatter' && m.id !== 'fire';
    if (spec[0] === '#') {
      const [tag, not] = spec.slice(1).split('!');
      return (m) => m.tags.has(tag) && !(not && m.tags.has(not));
    }
    const idx = PC.matIndex(spec);
    return (m) => m.index === idx;
  }

  // Precomputes an N×N lookup: +k means rule k-1 with (i as A), -k means rule k-1 with roles swapped.
  PC.buildReactionTable = function () {
    const mats = PC.MATS, N = mats.length;
    const table = new Int16Array(N * N);
    R.forEach((rule, r) => {
      const A = mats.filter(matcher(rule.a)), B = mats.filter(matcher(rule.b));
      for (const a of A) for (const b of B) {
        if (!table[a.index * N + b.index]) table[a.index * N + b.index] = r + 1;
        if (!table[b.index * N + a.index]) table[b.index * N + a.index] = -(r + 1);
      }
      rule.intoIdx = (rule.into || []).map((p) => (p === undefined ? -2 : p === null ? -1 : PC.matIndex(p)));
      if (rule.alt) rule.alt.intoIdx = (rule.alt.into || []).map((p) => (p === undefined ? -2 : p === null ? -1 : PC.matIndex(p)));
    });
    return table;
  };
  PC.REACTIONS = R;
})(window.PC);
