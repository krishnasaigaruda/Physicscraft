// Hand-drawn SVG icons for basic materials, containers, compounds and tools.
(function (PC) {
  'use strict';
  let uid = 0;
  // Each icon is a function so gradient ids stay unique per instance.
  const wrap = (body) => `<svg viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg">${body}</svg>`;
  const lg = (id, a, b, x2 = 0, y2 = 1) => `<linearGradient id="${id}" x1="0" y1="0" x2="${x2}" y2="${y2}"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient>`;
  const rg = (id, a, b) => `<radialGradient id="${id}" cx="0.35" cy="0.3" r="0.8"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></radialGradient>`;

  const ICONS = {
    water: () => { const i = 'g' + uid++; return wrap(`<defs>${lg(i, '#7cc8ff', '#1f6fe0')}</defs>
      <path d="M24 5 C24 5 11 20 11 29 a13 13 0 0 0 26 0 C37 20 24 5 24 5z" fill="url(#${i})" stroke="#0d4fb0" stroke-width="1.2"/>
      <path d="M17 29 a7 7 0 0 0 6 7" stroke="#e8f6ff" stroke-width="2.5" fill="none" stroke-linecap="round" opacity=".85"/>`); },
    ice: () => { const i = 'g' + uid++; return wrap(`<defs>${lg(i, '#f2fbff', '#9ad7ff')}</defs>
      <path d="M10 16 L24 8 L38 16 L38 32 L24 40 L10 32z" fill="url(#${i})" stroke="#5fb4e8" stroke-width="1.4"/>
      <path d="M10 16 L24 24 L38 16 M24 24 L24 40" stroke="#5fb4e8" stroke-width="1.2" fill="none"/>
      <path d="M15 20 l5 3" stroke="#fff" stroke-width="2" stroke-linecap="round"/>`); },
    steam: () => wrap(`<g fill="none" stroke="#dfe9f7" stroke-width="3" stroke-linecap="round">
      <path d="M14 38 c-4 -5 4 -8 0 -13 s4 -8 0 -13"/><path d="M24 40 c-4 -5 4 -8 0 -13 s4 -8 0 -13" stroke="#fff"/><path d="M34 38 c-4 -5 4 -8 0 -13 s4 -8 0 -13"/></g>`),
    earth: () => { const i = 'g' + uid++; return wrap(`<defs>${lg(i, '#8f6238', '#4e321b')}</defs>
      <path d="M6 30 Q12 22 20 25 Q27 19 34 24 Q41 22 42 30 L42 40 L6 40z" fill="url(#${i})"/>
      <path d="M8 27 l2 -5 l1 5 M14 25 l1 -6 l2 6 M30 23 l2 -6 l1 6 M37 25 l2 -4 l1 5" stroke="#5fd068" stroke-width="2" fill="none" stroke-linecap="round"/>
      <circle cx="15" cy="33" r="1.6" fill="#b38556"/><circle cx="28" cy="35" r="2" fill="#6b4526"/><circle cx="35" cy="31" r="1.3" fill="#b38556"/>`); },
    fire: () => { const i = 'g' + uid++, j = 'h' + uid++; return wrap(`<defs>${lg(i, '#ffd35c', '#ff3d1f')}${lg(j, '#fff6c9', '#ffb13b')}</defs>
      <path d="M24 4 C27 12 36 16 36 28 a12 12 0 0 1 -24 0 c0 -6 3 -9 5 -12 c0 5 2 7 4 8 c-1 -8 1 -14 3 -20z" fill="url(#${i})"/>
      <path d="M24 22 c2 4 6 6 6 11 a6 6 0 0 1 -12 0 c0 -4 3 -6 6 -11z" fill="url(#${j})"/>`); },
    air: () => wrap(`<g fill="none" stroke="#bfe0ff" stroke-width="3" stroke-linecap="round">
      <path d="M6 18 h22 a5 5 0 1 0 -5 -5"/><path d="M6 26 h30 a5 5 0 1 1 -5 5" stroke="#e3f1ff"/><path d="M10 34 h14"/></g>`),
    stone: () => { const i = 'g' + uid++; return wrap(`<defs>${lg(i, '#a7abb3', '#5b5f68', 1, 1)}</defs>
      <path d="M8 32 L12 18 L22 11 L34 14 L41 25 L37 37 L20 40z" fill="url(#${i})" stroke="#3f434b" stroke-width="1.3"/>
      <path d="M12 18 L20 24 L34 14 M20 24 L20 40 M20 24 L41 25" stroke="#484c55" stroke-width="1" fill="none" opacity=".6"/>`); },
    sand: () => { const i = 'g' + uid++; return wrap(`<defs>${lg(i, '#f3d58f', '#c99a45')}</defs>
      <path d="M4 38 Q14 22 24 30 Q32 18 44 34 L44 40 L4 40z" fill="url(#${i})"/>
      <g fill="#a87b35">${[[12, 34], [18, 31], [26, 35], [33, 30], [38, 36], [22, 38]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="1"/>`).join('')}</g>`); },
    wood: () => { const i = 'g' + uid++; return wrap(`<defs>${lg(i, '#b17a45', '#7a4b22')}</defs>
      <rect x="6" y="16" width="30" height="18" rx="3" fill="url(#${i})"/>
      <ellipse cx="36" cy="25" rx="7" ry="9" fill="#d9a86a" stroke="#7a4b22" stroke-width="1.2"/>
      <ellipse cx="36" cy="25" rx="4" ry="5.5" fill="none" stroke="#9c6a37" stroke-width="1"/><circle cx="36" cy="25" r="1.4" fill="#9c6a37"/>
      <path d="M10 21 h16 M12 29 h14" stroke="#5e3717" stroke-width="1.2" opacity=".6"/>`); },
    oil: () => { const i = 'g' + uid++; return wrap(`<defs>${lg(i, '#6d4a17', '#20150a')}</defs>
      <path d="M24 6 C24 6 12 21 12 29 a12 12 0 0 0 24 0 C36 21 24 6 24 6z" fill="url(#${i})" stroke="#0d0905" stroke-width="1.2"/>
      <path d="M18 30 a6 6 0 0 0 5 6" stroke="#e2b35a" stroke-width="2.3" fill="none" stroke-linecap="round" opacity=".8"/>`); },
    lava: () => { const i = 'g' + uid++, j = 'h' + uid++; return wrap(`<defs>${lg(i, '#6b5a55', '#2b201d')}${lg(j, '#ffe066', '#ff3b12')}</defs>
      <path d="M4 40 L18 14 L30 14 L44 40z" fill="url(#${i})"/>
      <path d="M18 14 Q24 9 30 14 L27 22 L29 30 L24 26 L20 34 L21 22z" fill="url(#${j})"/>
      <circle cx="21" cy="7" r="2" fill="#ff8a3d"/><circle cx="28" cy="5" r="1.4" fill="#ffb347"/>`); },
    salt: () => wrap(`<path d="M12 18 L24 12 L36 18 L36 32 L24 38 L12 32z" fill="#fbfbf7" stroke="#b9bcc4" stroke-width="1.3"/>
      <path d="M12 18 L24 24 L36 18 M24 24 L24 38" stroke="#c8cbd3" stroke-width="1.1" fill="none"/>
      <path d="M8 38 l4 -3 l3 3z M36 40 l3 -4 l4 4z" fill="#eceef2"/>`),
    ln2: () => { const i = 'g' + uid++; return wrap(`<defs>${lg(i, '#dff1ff', '#8fc2f0')}</defs>
      <rect x="15" y="12" width="18" height="30" rx="5" fill="#c3cad6" stroke="#6d7686" stroke-width="1.3"/>
      <rect x="18" y="20" width="12" height="19" rx="3" fill="url(#${i})"/>
      <rect x="19" y="8" width="10" height="5" rx="1.5" fill="#6d7686"/>
      <path d="M20 6 c-3 -2 1 -4 -2 -5 M28 6 c3 -2 -1 -4 2 -5" stroke="#e8f4ff" stroke-width="1.6" fill="none" stroke-linecap="round"/>`); },
    gunpowder: () => wrap(`<path d="M6 40 Q24 18 42 40z" fill="#3d3d40"/>
      <g fill="#6b6b70">${[[16, 36], [22, 32], [28, 35], [33, 38], [20, 38]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="1.2"/>`).join('')}</g>
      <path d="M24 26 l2 -6 l3 3 l1 -7" stroke="#ffc445" stroke-width="2" fill="none" stroke-linecap="round"/><circle cx="30" cy="15" r="2.5" fill="#ffe28a"/>`),
    tnt: () => wrap(`<g stroke="#6b1a0e" stroke-width="1"><rect x="8" y="16" width="9" height="24" rx="2" fill="#d6452c"/><rect x="19" y="14" width="10" height="26" rx="2" fill="#e24e33"/><rect x="31" y="16" width="9" height="24" rx="2" fill="#d6452c"/></g>
      <rect x="6" y="24" width="36" height="7" fill="#2a2a2a"/><text x="24" y="30" font-size="6" text-anchor="middle" fill="#fff" font-family="monospace" font-weight="700">TNT</text>
      <path d="M24 14 q2 -6 6 -8" stroke="#555" stroke-width="1.5" fill="none"/><circle cx="31" cy="6" r="2" fill="#ffb347"/>`),
    nitro: () => { const i = 'g' + uid++; return wrap(`<defs>${lg(i, '#fff7c2', '#e3d164')}</defs>
      <path d="M19 6 h10 v10 l9 20 a4 4 0 0 1 -4 6 h-20 a4 4 0 0 1 -4 -6 l9 -20z" fill="#eef3f8" stroke="#8a95a6" stroke-width="1.3"/>
      <path d="M15 30 h18 l3 6 a3 3 0 0 1 -3 4 h-18 a3 3 0 0 1 -3 -4z" fill="url(#${i})"/>
      <path d="M24 20 l5 9 h-10z" fill="#ffcc00" stroke="#8a6d00" stroke-width="1"/><text x="24" y="28" font-size="6" text-anchor="middle" font-weight="700">!</text>`); },
    thermite: () => wrap(`<path d="M10 22 h28 l-4 18 h-20z" fill="#8a6a5c" stroke="#4a3228" stroke-width="1.3"/>
      <ellipse cx="24" cy="22" rx="14" ry="4" fill="#7d4b3b"/><ellipse cx="24" cy="22" rx="8" ry="2.4" fill="#fff2c4"/>
      <g stroke="#ffd45c" stroke-width="1.8" stroke-linecap="round"><path d="M24 17 v-9"/><path d="M19 17 l-5 -7"/><path d="M29 17 l5 -7"/><path d="M16 19 l-8 -3"/><path d="M32 19 l8 -3"/></g>`),
    methane: () => { const i = 'g' + uid++; return wrap(`<defs>${lg(i, '#b8dcff', '#3b7cff')}</defs>
      <path d="M24 8 c3 7 10 11 10 19 a10 10 0 0 1 -20 0 c0 -8 7 -12 10 -19z" fill="url(#${i})"/>
      <path d="M24 22 c2 3 4 5 4 8 a4 4 0 0 1 -8 0 c0 -3 2 -5 4 -8z" fill="#e8f2ff"/>
      <text x="24" y="46" font-size="7" text-anchor="middle" fill="#9fc3ff" font-family="monospace">CH4</text>`); },
    acid: () => { const i = 'g' + uid++; return wrap(`<defs>${lg(i, '#c6ff8a', '#3ec41f')}</defs>
      <path d="M18 6 h12 v12 l8 18 a4 4 0 0 1 -4 6 h-20 a4 4 0 0 1 -4 -6 l8 -18z" fill="#eef3f8" stroke="#8a95a6" stroke-width="1.3"/>
      <path d="M13 29 h22 l3 7 a3 3 0 0 1 -3 4 h-22 a3 3 0 0 1 -3 -4z" fill="url(#${i})"/>
      <circle cx="20" cy="34" r="1.6" fill="#effff0"/><circle cx="27" cy="31" r="1.2" fill="#effff0"/><circle cx="30" cy="36" r="1" fill="#effff0"/>`); },
    antimatter: () => { const i = 'g' + uid++; return wrap(`<defs>${rg(i, '#ffe2ff', '#8a2be2')}</defs>
      <g fill="none" stroke="#c77dff" stroke-width="1.6"><ellipse cx="24" cy="24" rx="18" ry="7"/><ellipse cx="24" cy="24" rx="18" ry="7" transform="rotate(60 24 24)"/><ellipse cx="24" cy="24" rx="18" ry="7" transform="rotate(-60 24 24)"/></g>
      <circle cx="24" cy="24" r="5.5" fill="url(#${i})"/><text x="24" y="27" font-size="7" text-anchor="middle" fill="#4b0082" font-weight="700">−</text>`); },
    wall: () => wrap(`<g stroke="#2f343f" stroke-width="1.2"><rect x="4" y="10" width="19" height="9" fill="#6b7384"/><rect x="25" y="10" width="19" height="9" fill="#5b6270"/>
      <rect x="4" y="21" width="9" height="9" fill="#5b6270"/><rect x="15" y="21" width="19" height="9" fill="#6b7384"/><rect x="36" y="21" width="8" height="9" fill="#5b6270"/>
      <rect x="4" y="32" width="19" height="9" fill="#6b7384"/><rect x="25" y="32" width="19" height="9" fill="#5b6270"/></g>`),

    // Containers
    beaker: () => wrap(`<path d="M12 8 v28 a4 4 0 0 0 4 4 h16 a4 4 0 0 0 4 -4 v-28" fill="rgba(190,230,245,0.25)" stroke="#bfe7f2" stroke-width="2"/>
      <path d="M10 8 h4 M34 8 h4" stroke="#bfe7f2" stroke-width="2"/><path d="M13 26 h22 v10 a4 4 0 0 1 -4 4 h-14 a4 4 0 0 1 -4 -4z" fill="#3a9bff" opacity=".7"/>
      <path d="M15 14 h5 M15 19 h5 M15 24 h5" stroke="#dff4fa" stroke-width="1.2"/>`),
    tank: () => wrap(`<rect x="7" y="10" width="34" height="30" rx="2" fill="none" stroke="#9aa3ad" stroke-width="3"/>
      <rect x="9" y="22" width="30" height="16" fill="#3a9bff" opacity=".6"/><path d="M5 10 h8 M35 10 h8" stroke="#9aa3ad" stroke-width="3"/>
      <circle cx="12" cy="36" r="1" fill="#6c7580"/><circle cx="36" cy="36" r="1" fill="#6c7580"/>`),
    testtube: () => wrap(`<path d="M18 4 v32 a6 6 0 0 0 12 0 v-32" fill="rgba(190,230,245,0.25)" stroke="#bfe7f2" stroke-width="2"/>
      <path d="M19 26 h10 v10 a5 5 0 0 1 -10 0z" fill="#8dff5a" opacity=".75"/><path d="M16 4 h16" stroke="#bfe7f2" stroke-width="2"/>`),
    aquarium: () => wrap(`<rect x="4" y="14" width="40" height="26" fill="rgba(190,230,245,0.2)" stroke="#bfe7f2" stroke-width="2"/>
      <rect x="5" y="20" width="38" height="19" fill="#2b8cff" opacity=".55"/><path d="M14 30 q4 -4 8 0 q-4 4 -8 0z M22 30 l3 -2 v4z" fill="#ffb347"/>
      <path d="M36 38 q-2 -6 1 -10 M39 38 q1 -5 -1 -8" stroke="#3fcf6e" stroke-width="1.5" fill="none"/>`),
    crucible: () => wrap(`<path d="M9 16 h30 l-5 22 a3 3 0 0 1 -3 2 h-14 a3 3 0 0 1 -3 -2z" fill="#e7dccb" stroke="#a89880" stroke-width="1.6"/>
      <ellipse cx="24" cy="16" rx="15" ry="3.5" fill="#cdbfa8"/><ellipse cx="24" cy="16" rx="10" ry="2.2" fill="#ff7a1f"/>`),
    funnel: () => wrap(`<path d="M6 8 h36 l-14 18 v14 h-8 v-14z" fill="rgba(190,230,245,0.25)" stroke="#bfe7f2" stroke-width="2" stroke-linejoin="round"/>`),
    ramp: () => wrap(`<path d="M4 40 L44 12 L44 40z" fill="#6b7384" stroke="#2f343f" stroke-width="1.5"/><circle cx="16" cy="26" r="4" fill="#ffb347"/>`),
    block: () => wrap(`<rect x="6" y="18" width="36" height="14" fill="#6b7384" stroke="#2f343f" stroke-width="1.5"/><path d="M6 25 h36 M18 18 v7 M30 25 v7" stroke="#2f343f" stroke-width="1"/>`),
    shelf: () => wrap(`<rect x="4" y="22" width="40" height="5" fill="#6b7384" stroke="#2f343f" stroke-width="1.2"/><path d="M10 27 v10 M38 27 v10" stroke="#4a5160" stroke-width="3"/>`),

    pool: () => wrap(`<ellipse cx="24" cy="28" rx="20" ry="11" fill="#7d7a73"/><ellipse cx="24" cy="27" rx="16" ry="8" fill="#3a9fb0"/><path d="M14 27 q4 -2 8 0 t8 0" stroke="#bff3ff" stroke-width="1.2" fill="none"/><path d="M26 29 q3 -2 5 0 q-3 2 -5 0z" fill="#ff8a3d"/>`),
    table: () => wrap(`<rect x="5" y="16" width="38" height="5" rx="1" fill="#b8bdc4" stroke="#5c636d"/><path d="M9 21 v18 M39 21 v18 M14 21 v14 M34 21 v14" stroke="#8a919b" stroke-width="3"/>`),
    // Tools
    tool_stir: () => wrap(`<path d="M8 30 c6 -6 10 6 16 0 s10 6 16 0" stroke="currentColor" stroke-width="3" fill="none" stroke-linecap="round"/><path d="M8 20 c6 -6 10 6 16 0 s10 6 16 0" stroke="currentColor" stroke-width="3" fill="none" stroke-linecap="round" opacity=".5"/>`),
    tool_grab: () => wrap(`<path d="M16 26 v-12 a2.5 2.5 0 0 1 5 0 v8 v-11 a2.5 2.5 0 0 1 5 0 v11 v-9 a2.5 2.5 0 0 1 5 0 v10 v-6 a2.5 2.5 0 0 1 5 0 v12 c0 8 -5 13 -12 13 c-6 0 -9 -3 -12 -8 l-4 -7 a2.5 2.5 0 0 1 4 -3z" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linejoin="round"/>`),
    tool_heat: () => wrap(`<path d="M24 5 c3 8 11 12 11 23 a11 11 0 0 1 -22 0 c0 -6 3 -9 5 -12 c0 5 2 7 4 8 c-1 -8 0 -13 2 -19z" fill="currentColor"/>`),
    tool_cool: () => wrap(`<g stroke="currentColor" stroke-width="3" stroke-linecap="round"><path d="M24 5 v38 M7.5 14.5 l33 19 M7.5 33.5 l33 -19"/><path d="M19 8 l5 5 l5 -5 M19 40 l5 -5 l5 5" fill="none"/></g>`),
    tool_explode: () => wrap(`<path d="M24 3 l4 11 l11 -5 l-4 11 l11 4 l-11 4 l5 11 l-11 -4 l-5 11 l-4 -11 l-11 5 l4 -11 l-11 -4 l11 -4 l-5 -11 l11 4z" fill="currentColor"/>`),
    tool_erase: () => wrap(`<path d="M8 32 l16 -18 l14 12 l-12 14 h-10z" fill="none" stroke="currentColor" stroke-width="3" stroke-linejoin="round"/><path d="M16 23 l14 12" stroke="currentColor" stroke-width="3"/><path d="M26 40 h14" stroke="currentColor" stroke-width="3" stroke-linecap="round"/>`),
    tool_paint: () => wrap(`<path d="M34 6 l8 8 l-18 18 l-8 -8z" fill="currentColor"/><path d="M16 24 l8 8 c-2 6 -8 10 -16 10 c2 -3 2 -6 2 -9 c0 -5 3 -9 6 -9z" fill="currentColor" opacity=".75"/>`),
    tool_wind: () => wrap(`<g fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><path d="M5 17 h24 a5 5 0 1 0 -5 -5"/><path d="M5 26 h32 a5 5 0 1 1 -5 5"/><path d="M9 35 h14"/></g>`),
    tool_pour: () => wrap(`<path d="M10 8 h20 l-3 6 h-14z" fill="currentColor"/><path d="M13 14 h14 l-2 10 h-10z" fill="currentColor" opacity=".7"/><path d="M20 26 c0 4 -3 6 -3 9 a3 3 0 0 0 6 0 c0 -3 -3 -5 -3 -9z" fill="currentColor"/><circle cx="30" cy="36" r="2" fill="currentColor"/><circle cx="12" cy="39" r="1.5" fill="currentColor"/>`),
    tool_wall: () => wrap(`<g fill="currentColor"><rect x="5" y="10" width="17" height="8" rx="1"/><rect x="26" y="10" width="17" height="8" rx="1"/><rect x="5" y="21" width="8" height="8" rx="1"/><rect x="16" y="21" width="17" height="8" rx="1"/><rect x="36" y="21" width="7" height="8" rx="1"/><rect x="5" y="32" width="17" height="8" rx="1"/><rect x="26" y="32" width="17" height="8" rx="1"/></g>`),
  };

  // Generic molecule badge for compounds without a dedicated icon.
  function compoundIcon(mat) {
    const c = mat.color, dark = PC.lighten(c, -0.0);
    const id = 'c' + uid++;
    return wrap(`<defs>${rg(id, PC.lighten(c, 0.5), dark)}</defs>
      <path d="M24 5 L40 14.5 L40 33.5 L24 43 L8 33.5 L8 14.5z" fill="url(#${id})" stroke="rgba(0,0,0,0.35)" stroke-width="1.5"/>
      <text x="24" y="28" font-size="${mat.formula.length > 6 ? 7 : 9}" text-anchor="middle" font-family="Inter, sans-serif" font-weight="700" fill="${luma(c) > 150 ? '#1b1f2a' : '#ffffff'}">${escapeXml(mat.formula.slice(0, 9))}</text>`);
  }
  function luma(hex) { const [r, g, b] = PC.hexToRgb(hex); return 0.299 * r + 0.587 * g + 0.114 * b; }
  function escapeXml(s) { return s.replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c])); }

  PC.icon = function (key, mat) {
    if (ICONS[key]) return ICONS[key]();
    if (mat) return compoundIcon(mat);
    return '';
  };
  PC.luma = luma;
  PC.escapeHtml = escapeXml;
})(window.PC);

// Line icons for buttons, labels and panels (24×24, stroked in the current text colour).
(function (PC) {
  'use strict';
  const S = (d, extra) => `<svg class="ico" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"${extra || ''}>${d}</svg>`;
  const I = {
    undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-3"/>',
    redo: '<path d="m15 14 5-5-5-5"/><path d="M20 9H10a6 6 0 0 0 0 12h3"/>',
    rewind: '<path d="M11 19 2 12l9-7z"/><path d="M22 19l-9-7 9-7z"/>',
    save: '<path d="M5 3h11l3 3v13a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"/><path d="M7 3v5h8V3"/><rect x="7" y="13" width="10" height="6" rx="1"/>',
    open: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h6a2 2 0 0 1 2 2v1"/><path d="M3 7v11a1 1 0 0 0 1 1h13.5a1 1 0 0 0 1-.8L21 11H7.5a1 1 0 0 0-1 .8L4.5 19"/>',
    record: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4" fill="currentColor" stroke="none"/>',
    soundOn: '<path d="M4 9v6h4l5 4V5L8 9z"/><path d="M16.5 8.5a5 5 0 0 1 0 7"/><path d="M19 6a8.5 8.5 0 0 1 0 12"/>',
    soundOff: '<path d="M4 9v6h4l5 4V5L8 9z"/><path d="m17 9 5 6"/><path d="m22 9-5 6"/>',
    chart: '<path d="M3 3v18h18"/><path d="m7 15 4-5 3 3 5-7"/>',
    globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3a14 14 0 0 1 0 18"/><path d="M12 3a14 14 0 0 0 0 18"/>',
    thermometer: '<path d="M10 14.8V4a2 2 0 0 1 4 0v10.8a4 4 0 1 1-4 0z"/><path d="M12 9v8"/>',
    flask: '<path d="M9 3h6"/><path d="M10 3v6l-5.5 9.5A2 2 0 0 0 6.2 21h11.6a2 2 0 0 0 1.7-2.5L14 9V3"/><path d="M7.5 15h9"/>',
    gauge: '<circle cx="12" cy="13" r="8"/><path d="m12 13 4-4"/><path d="M12 5V3"/><path d="M9 3h6"/>',
    scale: '<path d="M12 3v18"/><path d="M5 21h14"/><path d="M5 7h14"/><path d="m5 7-3 7a3 3 0 0 0 6 0z"/><path d="m19 7-3 7a3 3 0 0 0 6 0z"/>',
    wrench: '<path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.5 2.5-2.5-.5-.5-2.5z"/>',
    rocket: '<path d="M5 15c-1.5 1.3-2 5-2 5s3.7-.5 5-2"/><path d="M9 12l3 3"/><path d="M12 15l-3-3a15 15 0 0 1 9-9c1.5 0 3 1.5 3 3a15 15 0 0 1-9 9z"/><path d="M9 12H5l2-4h5"/><path d="M12 15v4l4-2v-5"/>',
    flame: '<path d="M12 22a7 7 0 0 0 7-7c0-5-4-6-5-11-2 3-3 4-3 6 0 1 .5 2 1 2.5C10 12 8 11 8 9c-2 2-3 4-3 6a7 7 0 0 0 7 7z"/>',
    gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
    radiation: '<circle cx="12" cy="12" r="1.6" fill="currentColor"/><path d="M12 12 8 5a8 8 0 0 1 8 0z" fill="currentColor"/><path d="M12 12h8a8 8 0 0 1-4 6.9z" fill="currentColor"/><path d="M12 12 8 18.9A8 8 0 0 1 4 12z" fill="currentColor"/>',
    bolt: '<path d="M13 2 4 14h7l-1 8 9-12h-7z"/>',
    check: '<path d="m5 12 5 5 9-10"/>',
    sparkle: '<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/><path d="M19 17l.7 1.8 1.8.7-1.8.7L19 22l-.7-1.8-1.8-.7 1.8-.7z"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
    cloud: '<path d="M17.5 19H8a5 5 0 1 1 .9-9.9A6 6 0 0 1 20 11.5a3.8 3.8 0 0 1-2.5 7.5z"/>',
    rain: '<path d="M17.5 15H8a5 5 0 1 1 .9-9.9A6 6 0 0 1 20 7.5a3.8 3.8 0 0 1-2.5 7.5z"/><path d="M8 18l-1 3M12 18l-1 3M16 18l-1 3"/>',
    storm: '<path d="M17.5 14H8a5 5 0 1 1 .9-9.9A6 6 0 0 1 20 6.5a3.8 3.8 0 0 1-2.5 7.5z"/><path d="m13 14-3 4h4l-3 4"/>',
    snow: '<path d="M12 2v20M4 7l16 10M20 7 4 17"/><path d="m9 3 3 2 3-2M9 21l3-2 3 2"/>',
    fog: '<path d="M4 8h16M2 12h20M4 16h16M7 20h10"/>',
  };
  PC.ico = (name) => (I[name] ? S(I[name]) : '');
})(window.PC);
