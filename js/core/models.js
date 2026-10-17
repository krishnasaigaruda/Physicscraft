// Model specifications: what every substance looks like as a solid object (shape, size and surface),
// based on how the real material is usually seen. Used for physics bounds (bodies.js), 3D meshes
// (render/modelkit.js) and the rendered sidebar icons.
(function (PC) {
  'use strict';

  // Base half-extents (m) for each shape.
  const DIMS = {
    ingot: [0.12, 0.04, 0.06], bar: [0.1, 0.022, 0.05], nugget: [0.05, 0.04, 0.045], lump: [0.05, 0.035, 0.045],
    cluster: [0.07, 0.07, 0.07], chunk: [0.06, 0.05, 0.06], hopper: [0.07, 0.055, 0.07], rod: [0.14, 0.02, 0.02],
    pellet: [0.035, 0.022, 0.035], sphere: [0.04, 0.04, 0.04], sponge: [0.06, 0.045, 0.055], graphite: [0.06, 0.035, 0.05],
    flakes: [0.055, 0.03, 0.05], stick: [0.1, 0.018, 0.018], coil: [0.07, 0.035, 0.07], disk: [0.05, 0.014, 0.05],
    orb: [0.035, 0.035, 0.035], rock: [0.13, 0.1, 0.12], plank: [0.28, 0.045, 0.1], icecube: [0.1, 0.1, 0.1],
    tnt: [0.12, 0.06, 0.08], block: [0.3, 0.15, 0.15], brick: [0.11, 0.035, 0.055], glassblock: [0.15, 0.03, 0.1],
    cube: [0.045, 0.045, 0.045], wafer: [0.07, 0.006, 0.07], cake: [0.07, 0.04, 0.07],
  };
  PC.MODEL_DIMS = DIMS;

  // Element → [shape, look overrides]. Looks: rough, metal, irid (iridescence), clear (clearcoat),
  // emissive (hex), tint (hex, overrides colour), flat (faceted shading), glow (radioactive glow strength).
  const E = {
    H: ['cluster', { tint: '#e9f6ff', rough: 0.05, metal: 0, clear: 1 }], He: ['sphere', { tint: '#f2f6ff', rough: 0.05, metal: 0, clear: 1 }],
    Li: ['lump', { rough: 0.5, metal: 0.8 }], Be: ['chunk', { rough: 0.35, metal: 1, flat: true }], B: ['chunk', { tint: '#3b3432', rough: 0.3, metal: 0.6, flat: true }],
    C: ['graphite', { tint: '#26272a', rough: 0.42, metal: 0.35 }], N: ['cluster', { tint: '#f4f8ff', rough: 0.05, metal: 0, clear: 1 }],
    O: ['cluster', { tint: '#bfe2ff', rough: 0.05, metal: 0, clear: 1 }], F: ['cluster', { tint: '#f4f9c4', rough: 0.05, metal: 0, clear: 1 }],
    Ne: ['sphere', { tint: '#ffd0c0', rough: 0.05, metal: 0, clear: 1 }], Na: ['lump', { rough: 0.45, metal: 0.85 }],
    Mg: ['ingot', { rough: 0.3, metal: 1 }], Al: ['ingot', { rough: 0.28, metal: 1 }], Si: ['chunk', { tint: '#5b6474', rough: 0.15, metal: 0.9, flat: true }],
    P: ['stick', { tint: '#efe6c3', rough: 0.55, metal: 0 }], S: ['cluster', { tint: '#f0cf16', rough: 0.35, metal: 0, flat: true }],
    Cl: ['cluster', { tint: '#e6f59a', rough: 0.05, metal: 0 }], Ar: ['sphere', { tint: '#efe8ff', rough: 0.05, metal: 0, clear: 1 }],
    K: ['lump', { rough: 0.55, metal: 0.75 }], Ca: ['lump', { rough: 0.6, metal: 0.6 }], Sc: ['nugget', { rough: 0.35, metal: 1 }],
    Ti: ['sponge', { rough: 0.55, metal: 1 }], V: ['bar', { rough: 0.3, metal: 1 }], Cr: ['chunk', { rough: 0.12, metal: 1, flat: true }],
    Mn: ['chunk', { rough: 0.5, metal: 1, flat: true }], Fe: ['ingot', { tint: '#6f7277', rough: 0.55, metal: 1 }],
    Co: ['nugget', { rough: 0.3, metal: 1 }], Ni: ['pellet', { rough: 0.25, metal: 1 }], Cu: ['coil', { tint: '#c86f3c', rough: 0.25, metal: 1 }],
    Zn: ['ingot', { rough: 0.35, metal: 1 }], Ga: ['cluster', { rough: 0.08, metal: 1 }], Ge: ['chunk', { rough: 0.12, metal: 1, flat: true }],
    As: ['chunk', { rough: 0.35, metal: 0.8, flat: true }], Se: ['pellet', { tint: '#3a3a3e', rough: 0.15, metal: 0.4 }],
    Br: ['sphere', { tint: '#8f2410', rough: 0.1, metal: 0 }], Kr: ['sphere', { tint: '#eef4ff', rough: 0.05, metal: 0, clear: 1 }],
    Rb: ['lump', { rough: 0.45, metal: 0.8 }], Sr: ['lump', { rough: 0.55, metal: 0.7 }], Y: ['bar', { rough: 0.35, metal: 1 }],
    Zr: ['rod', { rough: 0.3, metal: 1 }], Nb: ['rod', { tint: '#9aa2c0', rough: 0.3, metal: 1 }], Mo: ['rod', { rough: 0.3, metal: 1 }],
    Tc: ['ingot', { rough: 0.3, metal: 1, glow: 0.3 }], Ru: ['sponge', { rough: 0.35, metal: 1 }], Rh: ['pellet', { rough: 0.15, metal: 1 }],
    Pd: ['bar', { rough: 0.2, metal: 1 }], Ag: ['bar', { tint: '#e8e9eb', rough: 0.12, metal: 1 }], Cd: ['rod', { rough: 0.3, metal: 1 }],
    In: ['ingot', { rough: 0.4, metal: 1 }], Sn: ['ingot', { rough: 0.35, metal: 1 }], Sb: ['chunk', { rough: 0.2, metal: 1, flat: true }],
    Te: ['chunk', { rough: 0.2, metal: 1, flat: true }], I: ['flakes', { tint: '#3a2448', rough: 0.15, metal: 0.7 }],
    Xe: ['sphere', { tint: '#e6eeff', rough: 0.05, metal: 0, clear: 1 }], Cs: ['lump', { tint: '#dcc27a', rough: 0.35, metal: 0.9 }],
    Ba: ['lump', { rough: 0.55, metal: 0.7 }], La: ['lump', { rough: 0.45, metal: 0.9 }], Ce: ['nugget', { rough: 0.45, metal: 0.9 }],
    Pr: ['lump', { rough: 0.5, metal: 0.9 }], Nd: ['disk', { rough: 0.15, metal: 1 }], Pm: ['nugget', { rough: 0.4, metal: 0.9, glow: 0.3 }],
    Sm: ['ingot', { rough: 0.4, metal: 1 }], Eu: ['lump', { tint: '#b9b2a2', rough: 0.6, metal: 0.6 }], Gd: ['ingot', { rough: 0.3, metal: 1 }],
    Tb: ['nugget', { rough: 0.35, metal: 1 }], Dy: ['chunk', { rough: 0.3, metal: 1, flat: true }], Ho: ['nugget', { rough: 0.3, metal: 1 }],
    Er: ['bar', { tint: '#c8c4cc', rough: 0.3, metal: 1 }], Tm: ['nugget', { rough: 0.3, metal: 1 }], Yb: ['lump', { rough: 0.4, metal: 1 }],
    Lu: ['chunk', { rough: 0.3, metal: 1, flat: true }], Hf: ['bar', { rough: 0.3, metal: 1 }], Ta: ['rod', { rough: 0.35, metal: 1 }],
    W: ['rod', { tint: '#7d8085', rough: 0.4, metal: 1 }], Re: ['bar', { rough: 0.3, metal: 1 }], Os: ['chunk', { tint: '#9fb0c6', rough: 0.1, metal: 1, flat: true }],
    Ir: ['pellet', { rough: 0.12, metal: 1 }], Pt: ['bar', { tint: '#e3e2df', rough: 0.14, metal: 1 }], Au: ['ingot', { tint: '#ffc93a', rough: 0.18, metal: 1 }],
    Hg: ['sphere', { tint: '#d6d9de', rough: 0.02, metal: 1 }], Tl: ['rod', { rough: 0.4, metal: 1 }], Pb: ['ingot', { tint: '#6c7280', rough: 0.55, metal: 1 }],
    Bi: ['hopper', { tint: '#c9b8d4', rough: 0.12, metal: 1, irid: 1 }], Po: ['nugget', { rough: 0.35, metal: 1, glow: 0.6 }],
    At: ['chunk', { tint: '#303036', rough: 0.3, metal: 0.8, flat: true, glow: 0.4 }], Rn: ['sphere', { tint: '#ffd8cc', rough: 0.05, metal: 0, clear: 1 }],
    Fr: ['lump', { rough: 0.4, metal: 0.9, glow: 0.4 }], Ra: ['lump', { tint: '#e8f2e0', rough: 0.5, metal: 0.6, glow: 1, emissive: '#7dff6a' }],
    Ac: ['nugget', { rough: 0.4, metal: 1, glow: 0.9, emissive: '#7fb6ff' }], Th: ['bar', { rough: 0.45, metal: 1, glow: 0.2 }],
    Pa: ['nugget', { rough: 0.35, metal: 1, glow: 0.4 }], U: ['ingot', { tint: '#5d6252', rough: 0.45, metal: 1, glow: 0.35 }],
    Np: ['nugget', { rough: 0.35, metal: 1, glow: 0.5 }], Pu: ['pellet', { tint: '#8a8175', rough: 0.4, metal: 0.9, glow: 0.5, emissive: '#ff7a3a' }],
    Am: ['nugget', { rough: 0.35, metal: 1, glow: 0.6 }], Cm: ['sphere', { rough: 0.3, metal: 1, glow: 0.8, emissive: '#b98cff' }],
  };
  for (let z = 97; z <= 118; z++) {
    const sym = PC.ELEMENTS[z - 1].sym;
    if (!E[sym]) E[sym] = ['orb', { rough: 0.15, metal: 1, irid: 0.8, glow: 0.7 }];
  }

  // Non-element solids.
  const M = {
    stone: ['rock', {}], obsidian: ['rock', { tint: '#16121c', rough: 0.08, metal: 0, clear: 1 }], brick: ['brick', {}],
    wood: ['plank', {}], water: ['icecube', {}], brine: ['icecube', {}], co2: ['icecube', { tint: '#f4f7ff', rough: 0.6 }],
    tnt: ['tnt', {}], wall: ['block', {}], concrete: ['block', {}], glass: ['glassblock', {}], ceramic: ['block', { tint: '#e7dccb' }],
    steel: ['ingot', { tint: '#8d949c', rough: 0.3, metal: 1 }], bronze: ['ingot', { tint: '#b0793a', rough: 0.3, metal: 1 }],
    brass: ['ingot', { tint: '#d6b24a', rough: 0.25, metal: 1 }], amalgam: ['nugget', { tint: '#d8cfa4', rough: 0.2, metal: 1 }],
    salt: ['cube', { rough: 0.35, metal: 0, clear: 0.3 }], lava: ['rock', { tint: '#2a1b18' }], earth: ['cake', { rough: 1 }],
    sand: ['cake', { rough: 1 }], ash: ['cake', { rough: 1 }], nitro: ['cluster', { tint: '#efe7a3', rough: 0.1, metal: 0, clear: 1 }],
    oil: ['cake', { tint: '#2d1f0c', rough: 0.4 }], antimatter: ['orb', { tint: '#b94dff', rough: 0.05, metal: 0.2, glow: 1.5, emissive: '#c86bff' }],
  };

  // Crash-test dummy: half-extents of each part and its position relative to the feet (metres, ~1.75 m tall).
  // A real rigged human (three.js “Soldier”, a Mixamo character, 1.83 m, T-pose). Physics parts sit on its bones:
  // part → bone it drives, centre and half-extents from the model's own joint positions; joints at the real joints.
  PC.HUMAN_MODEL = 'https://cdn.jsdelivr.net/gh/mrdoob/three.js@r170/examples/models/gltf/Soldier.glb';
  // Crash-test dummy: the real rigged mannequin from the same set (same Mixamo skeleton).
  PC.DUMMY_MODEL = 'https://cdn.jsdelivr.net/gh/mrdoob/three.js@r170/examples/models/gltf/Xbot.glb';
  PC.HUMAN_PARTS = {
    head: { half: [0.09, 0.11, 0.1], at: [0, 1.68, 0.04], bone: 'Head' },
    chest: { half: [0.17, 0.16, 0.11], at: [0, 1.33, 0.02], bone: 'Spine2' },
    pelvis: { half: [0.15, 0.1, 0.1], at: [0, 1.04, 0], bone: 'Hips' },
    armL: { half: [0.115, 0.045, 0.045], at: [-0.325, 1.479, 0.057], bone: 'LeftArm' },
    armR: { half: [0.115, 0.045, 0.045], at: [0.325, 1.479, 0.057], bone: 'RightArm' },
    foreL: { half: [0.12, 0.04, 0.04], at: [-0.56, 1.479, 0.057], bone: 'LeftForeArm' },
    foreR: { half: [0.12, 0.04, 0.04], at: [0.56, 1.479, 0.057], bone: 'RightForeArm' },
    thighL: { half: [0.07, 0.215, 0.07], at: [-0.098, 0.792, -0.008], bone: 'LeftUpLeg' },
    thighR: { half: [0.07, 0.215, 0.07], at: [0.098, 0.792, -0.008], bone: 'RightUpLeg' },
    shinL: { half: [0.06, 0.28, 0.06], at: [-0.098, 0.3, 0.005], bone: 'LeftLeg' },
    shinR: { half: [0.06, 0.28, 0.06], at: [0.098, 0.3, 0.005], bone: 'RightLeg' },
  };
  // Joint pivots (model coordinates): neck, waist, shoulders, elbows, hips, knees.
  PC.HUMAN_PIVOTS = { 'head|chest': [0, 1.5, 0.05], 'chest|pelvis': [0, 1.16, 0.01], 'chest|armL': [-0.209, 1.479, 0.057], 'chest|armR': [0.209, 1.479, 0.057], 'armL|foreL': [-0.44, 1.479, 0.057], 'armR|foreR': [0.44, 1.479, 0.057], 'pelvis|thighL': [-0.098, 1.009, 0], 'pelvis|thighR': [0.098, 1.009, 0], 'thighL|shinL': [-0.099, 0.575, -0.015], 'thighR|shinR': [0.099, 0.575, -0.015] };

  PC.DUMMY_JOINTS = [['head', 'chest'], ['chest', 'pelvis'], ['chest', 'armL'], ['chest', 'armR'], ['armL', 'foreL'], ['armR', 'foreR'], ['pelvis', 'thighL'], ['pelvis', 'thighR'], ['thighL', 'shinL'], ['thighR', 'shinR']];

  PC.modelSpec = function (mat, entryKey) {
    if (entryKey && (entryKey.startsWith('dummy_') || entryKey.startsWith('human_'))) { const d = PC.HUMAN_PARTS[entryKey.slice(6)]; if (d) return { shape: 'dummy', dims: d.half.slice(), look: { rough: 0.45, metal: 0 } }; }
    const cu = PC.CUSTOM && PC.CUSTOM[entryKey];
    if (cu) return { shape: cu.shape, dims: (cu.modelDims || DIMS[cu.shape] || DIMS.chunk).slice(), look: Object.assign({ rough: 0.5, metal: 0 }, cu.look) };
    const def = mat.el ? E[mat.el.sym] : M[mat.id];
    let shape, look;
    if (def) [shape, look] = def;
    else if (mat.metallic) { shape = 'ingot'; look = { rough: 0.3, metal: 1 }; }
    else if (mat.powder) { shape = 'cake'; look = { rough: 1 }; }
    else { shape = 'chunk'; look = { rough: 0.6, metal: 0, flat: true }; }
    if (entryKey === 'ice') { shape = 'icecube'; look = {}; }
    return { shape, dims: DIMS[shape].slice(), look: Object.assign({ rough: 0.5, metal: 0 }, look) };
  };
})(window.PC);
