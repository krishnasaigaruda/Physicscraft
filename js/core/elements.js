// Periodic table data: all 118 elements.
// Densities in g/cm³ (gases converted from g/L), melting/boiling points in Kelvin.
// Values for superheavy elements are predictions and flagged as such.
window.PC = window.PC || {};
(function (PC) {
  'use strict';

  PC.CATEGORIES = {
    alkali:     { label: 'Alkali metal',          color: '#ff6b6b' },
    alkaline:   { label: 'Alkaline earth metal',  color: '#ffa94d' },
    transition: { label: 'Transition metal',      color: '#fcc419' },
    post:       { label: 'Post-transition metal', color: '#69db7c' },
    metalloid:  { label: 'Metalloid',             color: '#38d9a9' },
    nonmetal:   { label: 'Reactive nonmetal',     color: '#4dabf7' },
    halogen:    { label: 'Halogen',               color: '#748ffc' },
    noble:      { label: 'Noble gas',             color: '#da77f2' },
    lanthanide: { label: 'Lanthanide',            color: '#f783ac' },
    actinide:   { label: 'Actinide',              color: '#e599f7' },
    unknown:    { label: 'Unknown properties',    color: '#adb5bd' },
  };

  // [Z, symbol, name, atomic mass, category, density, melting K, boiling K]
  const RAW = [
    [1, 'H', 'Hydrogen', 1.008, 'nonmetal', 0.0000899, 14.01, 20.28],
    [2, 'He', 'Helium', 4.0026, 'noble', 0.0001785, 0.95, 4.22],
    [3, 'Li', 'Lithium', 6.94, 'alkali', 0.534, 453.69, 1560],
    [4, 'Be', 'Beryllium', 9.0122, 'alkaline', 1.85, 1560, 2742],
    [5, 'B', 'Boron', 10.81, 'metalloid', 2.34, 2349, 4200],
    [6, 'C', 'Carbon', 12.011, 'nonmetal', 2.267, 3823, 4098],
    [7, 'N', 'Nitrogen', 14.007, 'nonmetal', 0.0012506, 63.15, 77.36],
    [8, 'O', 'Oxygen', 15.999, 'nonmetal', 0.001429, 54.36, 90.2],
    [9, 'F', 'Fluorine', 18.998, 'halogen', 0.001696, 53.53, 85.03],
    [10, 'Ne', 'Neon', 20.18, 'noble', 0.0009002, 24.56, 27.07],
    [11, 'Na', 'Sodium', 22.99, 'alkali', 0.968, 370.87, 1156],
    [12, 'Mg', 'Magnesium', 24.305, 'alkaline', 1.738, 923, 1363],
    [13, 'Al', 'Aluminium', 26.982, 'post', 2.7, 933.47, 2792],
    [14, 'Si', 'Silicon', 28.085, 'metalloid', 2.329, 1687, 3538],
    [15, 'P', 'Phosphorus', 30.974, 'nonmetal', 1.823, 317.3, 550],
    [16, 'S', 'Sulfur', 32.06, 'nonmetal', 2.067, 388.36, 717.87],
    [17, 'Cl', 'Chlorine', 35.45, 'halogen', 0.003214, 171.6, 239.11],
    [18, 'Ar', 'Argon', 39.948, 'noble', 0.0017837, 83.8, 87.3],
    [19, 'K', 'Potassium', 39.098, 'alkali', 0.862, 336.53, 1032],
    [20, 'Ca', 'Calcium', 40.078, 'alkaline', 1.55, 1115, 1757],
    [21, 'Sc', 'Scandium', 44.956, 'transition', 2.985, 1814, 3109],
    [22, 'Ti', 'Titanium', 47.867, 'transition', 4.506, 1941, 3560],
    [23, 'V', 'Vanadium', 50.942, 'transition', 6.0, 2183, 3680],
    [24, 'Cr', 'Chromium', 51.996, 'transition', 7.19, 2180, 2944],
    [25, 'Mn', 'Manganese', 54.938, 'transition', 7.21, 1519, 2334],
    [26, 'Fe', 'Iron', 55.845, 'transition', 7.874, 1811, 3134],
    [27, 'Co', 'Cobalt', 58.933, 'transition', 8.9, 1768, 3200],
    [28, 'Ni', 'Nickel', 58.693, 'transition', 8.908, 1728, 3186],
    [29, 'Cu', 'Copper', 63.546, 'transition', 8.96, 1357.77, 2835],
    [30, 'Zn', 'Zinc', 65.38, 'transition', 7.14, 692.68, 1180],
    [31, 'Ga', 'Gallium', 69.723, 'post', 5.91, 302.91, 2477],
    [32, 'Ge', 'Germanium', 72.63, 'metalloid', 5.323, 1211.4, 3106],
    [33, 'As', 'Arsenic', 74.922, 'metalloid', 5.727, 887, 887],
    [34, 'Se', 'Selenium', 78.971, 'nonmetal', 4.81, 494, 958],
    [35, 'Br', 'Bromine', 79.904, 'halogen', 3.1028, 265.8, 332],
    [36, 'Kr', 'Krypton', 83.798, 'noble', 0.003733, 115.79, 119.93],
    [37, 'Rb', 'Rubidium', 85.468, 'alkali', 1.532, 312.46, 961],
    [38, 'Sr', 'Strontium', 87.62, 'alkaline', 2.64, 1050, 1655],
    [39, 'Y', 'Yttrium', 88.906, 'transition', 4.472, 1799, 3609],
    [40, 'Zr', 'Zirconium', 91.224, 'transition', 6.52, 2128, 4682],
    [41, 'Nb', 'Niobium', 92.906, 'transition', 8.57, 2750, 5017],
    [42, 'Mo', 'Molybdenum', 95.95, 'transition', 10.28, 2896, 4912],
    [43, 'Tc', 'Technetium', 98, 'transition', 11, 2430, 4538],
    [44, 'Ru', 'Ruthenium', 101.07, 'transition', 12.45, 2607, 4423],
    [45, 'Rh', 'Rhodium', 102.91, 'transition', 12.41, 2237, 3968],
    [46, 'Pd', 'Palladium', 106.42, 'transition', 12.023, 1828.05, 3236],
    [47, 'Ag', 'Silver', 107.87, 'transition', 10.49, 1234.93, 2435],
    [48, 'Cd', 'Cadmium', 112.41, 'transition', 8.65, 594.22, 1040],
    [49, 'In', 'Indium', 114.82, 'post', 7.31, 429.75, 2345],
    [50, 'Sn', 'Tin', 118.71, 'post', 7.265, 505.08, 2875],
    [51, 'Sb', 'Antimony', 121.76, 'metalloid', 6.697, 903.78, 1860],
    [52, 'Te', 'Tellurium', 127.6, 'metalloid', 6.24, 722.66, 1261],
    [53, 'I', 'Iodine', 126.9, 'halogen', 4.933, 386.85, 457.4],
    [54, 'Xe', 'Xenon', 131.29, 'noble', 0.005887, 161.4, 165.03],
    [55, 'Cs', 'Caesium', 132.91, 'alkali', 1.93, 301.59, 944],
    [56, 'Ba', 'Barium', 137.33, 'alkaline', 3.51, 1000, 2170],
    [57, 'La', 'Lanthanum', 138.91, 'lanthanide', 6.162, 1193, 3737],
    [58, 'Ce', 'Cerium', 140.12, 'lanthanide', 6.77, 1068, 3716],
    [59, 'Pr', 'Praseodymium', 140.91, 'lanthanide', 6.77, 1208, 3793],
    [60, 'Nd', 'Neodymium', 144.24, 'lanthanide', 7.01, 1297, 3347],
    [61, 'Pm', 'Promethium', 145, 'lanthanide', 7.26, 1315, 3273],
    [62, 'Sm', 'Samarium', 150.36, 'lanthanide', 7.52, 1345, 2067],
    [63, 'Eu', 'Europium', 151.96, 'lanthanide', 5.244, 1099, 1802],
    [64, 'Gd', 'Gadolinium', 157.25, 'lanthanide', 7.9, 1585, 3546],
    [65, 'Tb', 'Terbium', 158.93, 'lanthanide', 8.23, 1629, 3503],
    [66, 'Dy', 'Dysprosium', 162.5, 'lanthanide', 8.54, 1680, 2840],
    [67, 'Ho', 'Holmium', 164.93, 'lanthanide', 8.79, 1734, 2993],
    [68, 'Er', 'Erbium', 167.26, 'lanthanide', 9.066, 1802, 3141],
    [69, 'Tm', 'Thulium', 168.93, 'lanthanide', 9.32, 1818, 2223],
    [70, 'Yb', 'Ytterbium', 173.05, 'lanthanide', 6.9, 1097, 1469],
    [71, 'Lu', 'Lutetium', 174.97, 'lanthanide', 9.841, 1925, 3675],
    [72, 'Hf', 'Hafnium', 178.49, 'transition', 13.31, 2506, 4876],
    [73, 'Ta', 'Tantalum', 180.95, 'transition', 16.69, 3290, 5731],
    [74, 'W', 'Tungsten', 183.84, 'transition', 19.25, 3695, 5828],
    [75, 'Re', 'Rhenium', 186.21, 'transition', 21.02, 3459, 5869],
    [76, 'Os', 'Osmium', 190.23, 'transition', 22.59, 3306, 5285],
    [77, 'Ir', 'Iridium', 192.22, 'transition', 22.56, 2719, 4701],
    [78, 'Pt', 'Platinum', 195.08, 'transition', 21.45, 2041.4, 4098],
    [79, 'Au', 'Gold', 196.97, 'transition', 19.3, 1337.33, 3129],
    [80, 'Hg', 'Mercury', 200.59, 'transition', 13.534, 234.32, 629.88],
    [81, 'Tl', 'Thallium', 204.38, 'post', 11.85, 577, 1746],
    [82, 'Pb', 'Lead', 207.2, 'post', 11.34, 600.61, 2022],
    [83, 'Bi', 'Bismuth', 208.98, 'post', 9.78, 544.7, 1837],
    [84, 'Po', 'Polonium', 209, 'post', 9.196, 527, 1235],
    [85, 'At', 'Astatine', 210, 'halogen', 6.4, 575, 610],
    [86, 'Rn', 'Radon', 222, 'noble', 0.00973, 202, 211.3],
    [87, 'Fr', 'Francium', 223, 'alkali', 1.87, 300, 950],
    [88, 'Ra', 'Radium', 226, 'alkaline', 5.5, 973, 2010],
    [89, 'Ac', 'Actinium', 227, 'actinide', 10.07, 1323, 3471],
    [90, 'Th', 'Thorium', 232.04, 'actinide', 11.72, 2023, 5061],
    [91, 'Pa', 'Protactinium', 231.04, 'actinide', 15.37, 1841, 4300],
    [92, 'U', 'Uranium', 238.03, 'actinide', 19.1, 1405.3, 4404],
    [93, 'Np', 'Neptunium', 237, 'actinide', 20.45, 917, 4273],
    [94, 'Pu', 'Plutonium', 244, 'actinide', 19.816, 912.5, 3501],
    [95, 'Am', 'Americium', 243, 'actinide', 12, 1449, 2880],
    [96, 'Cm', 'Curium', 247, 'actinide', 13.51, 1613, 3383],
    [97, 'Bk', 'Berkelium', 247, 'actinide', 14.78, 1259, 2900],
    [98, 'Cf', 'Californium', 251, 'actinide', 15.1, 1173, 1743],
    [99, 'Es', 'Einsteinium', 252, 'actinide', 8.84, 1133, 1269],
    [100, 'Fm', 'Fermium', 257, 'actinide', 9.7, 1800, 2500],
    [101, 'Md', 'Mendelevium', 258, 'actinide', 10.3, 1100, 2400],
    [102, 'No', 'Nobelium', 259, 'actinide', 9.9, 1100, 2300],
    [103, 'Lr', 'Lawrencium', 266, 'actinide', 14.4, 1900, 3000],
    [104, 'Rf', 'Rutherfordium', 267, 'transition', 23.2, 2400, 5800],
    [105, 'Db', 'Dubnium', 268, 'transition', 29.3, 2700, 5500],
    [106, 'Sg', 'Seaborgium', 269, 'transition', 35, 2900, 5500],
    [107, 'Bh', 'Bohrium', 270, 'transition', 37.1, 2900, 5500],
    [108, 'Hs', 'Hassium', 277, 'transition', 41, 3000, 5500],
    [109, 'Mt', 'Meitnerium', 278, 'unknown', 37.4, 2800, 5000],
    [110, 'Ds', 'Darmstadtium', 281, 'unknown', 34.8, 2500, 5000],
    [111, 'Rg', 'Roentgenium', 282, 'unknown', 28.7, 2000, 4000],
    [112, 'Cn', 'Copernicium', 285, 'unknown', 14.0, 283, 340],
    [113, 'Nh', 'Nihonium', 286, 'unknown', 16, 700, 1430],
    [114, 'Fl', 'Flerovium', 289, 'unknown', 11.4, 284, 420],
    [115, 'Mc', 'Moscovium', 290, 'unknown', 13.5, 670, 1400],
    [116, 'Lv', 'Livermorium', 293, 'unknown', 12.9, 709, 1085],
    [117, 'Ts', 'Tennessine', 294, 'unknown', 7.2, 723, 883],
    [118, 'Og', 'Oganesson', 294, 'unknown', 7.2, 325, 450],
  ];

  // How each element looks as a bulk material.
  const LOOK = {
    H: '#e8f6ff', He: '#fff4dc', Li: '#c9ccd0', Be: '#a3abb3', B: '#5d4636', C: '#2e2e30', N: '#cfe0ff',
    O: '#a8d8ff', F: '#eef7a0', Ne: '#ffd9c7', Na: '#dcdfe3', Mg: '#cdd1d6', Al: '#d6dbe0', Si: '#5f6674',
    P: '#f2e6c4', S: '#f3d40c', Cl: '#bfe35c', Ar: '#e4dcff', K: '#c4c8ce', Ca: '#e6e6dd', Sc: '#c9cbc4',
    Ti: '#a9abb0', V: '#a4a9b3', Cr: '#c3c9d2', Mn: '#9d9d9f', Fe: '#8a8d93', Co: '#8b93a8', Ni: '#b8b3a7',
    Cu: '#c8733c', Zn: '#b1b9c2', Ga: '#d2d7de', Ge: '#8e9398', As: '#707274', Se: '#7c3434', Br: '#8f2410',
    Kr: '#e9f1ff', Rb: '#cdc9c0', Sr: '#dcd6c4', Ag: '#e6e7e9', Cd: '#bcc1ca', In: '#c4c8ce', Sn: '#babec4',
    Sb: '#9da2a8', Te: '#80858b', I: '#4a2c5e', Xe: '#dbe6ff', Cs: '#e3c78d', Ba: '#c3c3b3', W: '#8e9195',
    Os: '#a7b4c4', Ir: '#e0e4e9', Pt: '#e6e5e3', Au: '#ffc93a', Hg: '#cdd0d6', Tl: '#a3a8ae', Pb: '#6f7583',
    Bi: '#c9aacb', Po: '#a5a5a5', At: '#3b3b3b', Rn: '#ffe2d4', Fr: '#d9c49a', Ra: '#eaf6e1', U: '#8b9178',
    Pu: '#8e8e8e', Th: '#9fa39c', Nb: '#a4a8b8', Mo: '#a6aab0', Ta: '#9da3b2', Re: '#b0b4ba', Rh: '#d2d5d9',
    Pd: '#cfd0cc', Ru: '#b5b8bc', Tc: '#b9bbc0', Zr: '#bcbfc3', Y: '#c7c9cb', Hf: '#b6b9bd',
  };

  // Flame-test / gas-discharge emission colours (used for flames, plasma and noble-gas glow).
  const EMISSION = {
    H: '#ff5ea8', He: '#ffb070', Ne: '#ff4a1c', Ar: '#b388ff', Kr: '#dfe6ff', Xe: '#6fa8ff', Rn: '#ff4040',
    N: '#ff79d6', O: '#e8a0ff', Li: '#ff2a4b', Na: '#ffb000', K: '#c38bff', Rb: '#d24bff', Cs: '#8a7dff',
    Cu: '#3cff9c', Ca: '#ff7a30', Sr: '#ff1c3c', Ba: '#b8ff4a', B: '#5cff6a', Mg: '#ffffff', S: '#4d7bff',
    P: '#ffffff', Fe: '#ffd08a', Al: '#ffffff', Zn: '#b0ffd8', Se: '#5ca8ff', In: '#5b7dff', Tl: '#6cff6c',
  };

  // Rough chemical reactivity used by the reaction engine (alkali / alkaline earth with water, etc.).
  const REACTIVITY = { Li: 1, Na: 2, K: 3, Rb: 4, Cs: 5, Fr: 5, Be: 0.05, Mg: 0.25, Ca: 1, Sr: 1.3, Ba: 1.6, Ra: 1.8 };

  // Half-lives (seconds of *sim* time before decay speed scaling) and the next nuclide in the chain.
  const RADIOACTIVE = {
    Tc: { halfLife: 90, into: 'Ru' }, Pm: { halfLife: 60, into: 'Sm' },
    Po: { halfLife: 20, into: 'Pb' }, At: { halfLife: 8, into: 'Po' }, Rn: { halfLife: 25, into: 'Po' },
    Fr: { halfLife: 10, into: 'Ra' }, Ra: { halfLife: 60, into: 'Rn' }, Ac: { halfLife: 40, into: 'Th' },
    Th: { halfLife: 400, into: 'Ra' }, Pa: { halfLife: 120, into: 'Ac' }, U: { halfLife: 600, into: 'Th' },
    Np: { halfLife: 200, into: 'Pa' }, Pu: { halfLife: 300, into: 'U' }, Am: { halfLife: 120, into: 'Np' },
    Cm: { halfLife: 60, into: 'Pu' }, Bk: { halfLife: 40, into: 'Am' }, Cf: { halfLife: 30, into: 'Cm' },
    Es: { halfLife: 20, into: 'Bk' }, Fm: { halfLife: 10, into: 'Cf' }, Md: { halfLife: 6, into: 'Es' },
    No: { halfLife: 4, into: 'Fm' }, Lr: { halfLife: 3, into: 'Md' },
  };
  for (let z = 104; z <= 118; z++) RADIOACTIVE[RAW[z - 1][1]] = { halfLife: 1.5, into: 'Pb' };

  // ---- Electron configuration (Madelung order with the known exceptions) ----
  const ORBITALS = ['1s', '2s', '2p', '3s', '3p', '4s', '3d', '4p', '5s', '4d', '5p', '6s', '4f', '5d', '6p', '7s', '5f', '6d', '7p'];
  const CAP = { s: 2, p: 6, d: 10, f: 14 };
  const EXCEPTIONS = {
    24: [['4s', -1], ['3d', 1]], 29: [['4s', -1], ['3d', 1]], 41: [['5s', -1], ['4d', 1]],
    42: [['5s', -1], ['4d', 1]], 44: [['5s', -1], ['4d', 1]], 45: [['5s', -1], ['4d', 1]],
    46: [['5s', -2], ['4d', 2]], 47: [['5s', -1], ['4d', 1]], 57: [['4f', -1], ['5d', 1]],
    58: [['4f', -1], ['5d', 1]], 64: [['4f', -1], ['5d', 1]], 78: [['6s', -1], ['5d', 1]],
    79: [['6s', -1], ['5d', 1]], 89: [['5f', -1], ['6d', 1]], 90: [['5f', -2], ['6d', 2]],
    91: [['5f', -1], ['6d', 1]], 92: [['5f', -1], ['6d', 1]], 93: [['5f', -1], ['6d', 1]],
    96: [['5f', -1], ['6d', 1]], 103: [['6d', -1], ['7p', 1]],
  };
  const NOBLE_CORES = [[86, 'Rn'], [54, 'Xe'], [36, 'Kr'], [18, 'Ar'], [10, 'Ne'], [2, 'He']];
  const SUP = { 0: '⁰', 1: '¹', 2: '²', 3: '³', 4: '⁴', 5: '⁵', 6: '⁶', 7: '⁷', 8: '⁸', 9: '⁹' };
  const sup = (n) => String(n).split('').map((c) => SUP[c]).join('');

  function configOf(Z) {
    const occ = {};
    let left = Z;
    for (const o of ORBITALS) {
      if (left <= 0) break;
      const n = Math.min(CAP[o[1]], left);
      occ[o] = n;
      left -= n;
    }
    for (const [o, d] of EXCEPTIONS[Z] || []) occ[o] = (occ[o] || 0) + d;
    return occ;
  }

  function configString(Z) {
    const occ = configOf(Z);
    let core = null;
    for (const [nz, sym] of NOBLE_CORES) if (nz < Z) { core = [nz, sym]; break; }
    const coreOcc = core ? configOf(core[0]) : {};
    const lOrder = 'spdf';
    const parts = Object.keys(occ)
      .filter((o) => occ[o] > 0 && occ[o] !== coreOcc[o])
      .sort((a, b) => (+a[0] - +b[0]) || (lOrder.indexOf(a[1]) - lOrder.indexOf(b[1])))
      .map((o) => o + sup(occ[o]));
    return (core ? '[' + core[1] + '] ' : '') + parts.join(' ');
  }

  function shellsOf(Z) {
    const occ = configOf(Z);
    const shells = [];
    for (const o in occ) {
      const n = +o[0];
      shells[n - 1] = (shells[n - 1] || 0) + occ[o];
    }
    for (let i = 0; i < shells.length; i++) shells[i] = shells[i] || 0;
    return shells;
  }

  // Grid position in the standard 18-column table (rows 9/10 = f-block).
  function gridPos(Z) {
    if (Z === 1) return [1, 1];
    if (Z === 2) return [18, 1];
    if (Z <= 18) {
      const start = Z <= 10 ? 3 : 11, row = Z <= 10 ? 2 : 3;
      const i = Z - start;
      return [i < 2 ? i + 1 : i + 11, row];
    }
    if (Z <= 54) {
      const start = Z <= 36 ? 19 : 37, row = Z <= 36 ? 4 : 5;
      return [Z - start + 1, row];
    }
    const base = Z <= 86 ? 55 : 87, row = Z <= 86 ? 6 : 7;
    const i = Z - base;
    if (i < 2) return [i + 1, row];
    if (i <= 16) return [i + 1, row === 6 ? 9 : 10]; // La–Lu / Ac–Lr
    return [Z - (row === 6 ? 68 : 100), row];
  }

  function stateAt(el, T) {
    if (T < el.mp) return 'Solid';
    if (T < el.bp) return 'Liquid';
    return 'Gas';
  }

  const METAL_CATS = new Set(['alkali', 'alkaline', 'transition', 'post', 'lanthanide', 'actinide']);

  PC.ELEMENTS = RAW.map(([Z, sym, name, mass, cat, density, mp, bp]) => {
    const [col, row] = gridPos(Z);
    const el = {
      Z, sym, name, mass, cat, density, mp, bp, col, row,
      metal: METAL_CATS.has(cat) || (cat === 'unknown' && Z < 118),
      look: LOOK[sym] || null,
      emission: EMISSION[sym] || null,
      reactivity: REACTIVITY[sym] || 0,
      radioactive: RADIOACTIVE[sym] || null,
      predicted: Z >= 100,
      config: configString(Z),
      shells: shellsOf(Z),
    };
    el.state = stateAt(el, 293.15);
    return el;
  });
  PC.ELEMENT_BY_SYM = {};
  for (const el of PC.ELEMENTS) PC.ELEMENT_BY_SYM[el.sym] = el;
  PC.stateAt = stateAt;
})(window.PC);
