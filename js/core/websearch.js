// Material search: look up any substance on Earth or in space on Wikidata (real measured properties), Wikipedia
// (description + photo) and Poly Haven (photo-scanned texture or 3D model), and turn it into a playable material.
// The new material is built on the closest built-in base (metal, rock, glass, organic solid, liquid, gas, powder) so it
// behaves physically, with its own density, melting/boiling points, colour, look and name.
(function (PC) {
  'use strict';

  const WD = 'https://www.wikidata.org/w/api.php';
  const PH = 'https://api.polyhaven.com';
  const K = (x) => 'http://www.wikidata.org/entity/' + x;
  const UNIT = { kelvin: K('Q11579'), celsius: K('Q25267'), fahrenheit: K('Q42289'), gcm3: K('Q13147228'), kgm3: K('Q844211'), gL: K('Q834105'), gmol: K('Q28924753'), dalton: K('Q483261') };

  const json = (url) => fetch(url).then((r) => { if (!r.ok) throw new Error(r.status + ' ' + url); return r.json(); });
  const qs = (o) => Object.entries(o).map(([k, v]) => k + '=' + encodeURIComponent(v)).join('&');

  // ---------------------------------------------------------------- Wikidata
  PC.searchWikidata = async function (query, limit) {
    const r = await json(`${WD}?${qs({ action: 'wbsearchentities', search: query, language: 'en', uselang: 'en', type: 'item', limit: 20, format: 'json', origin: '*' })}`);
    // Rank real substances and objects above people, songs, films, places…
    const GOOD = ['chemical', 'compound', 'substance', 'material', 'mineral', 'rock', 'metal', 'alloy', 'element', 'food', 'fruit', 'vegetable', 'liquid', 'gas', 'beverage', 'drink', 'fuel', 'polymer', 'plastic', 'gemstone', 'crystal', 'meteorite', 'stone', 'product', 'ingredient', 'plant', 'wood', 'fabric', 'tool', 'object', 'oil', 'acid', 'salt', 'sweet', 'dairy', 'soil', 'regolith', 'glass', 'ceramic', 'explosive', 'drug', 'medication', 'spice', 'sugar', 'textile', 'fibre', 'fiber', 'pigment', 'ice', 'isotope', 'device', 'homo sapiens', 'animal', 'mammal', 'bird', 'fish', 'insect', 'reptile', 'organism', 'domesticated', 'pet', 'peripheral', 'machine', 'appliance', 'furniture', 'instrument', 'vessel', 'container', 'equipment', 'vehicle'];
    const BAD = ['family name', 'given name', 'single by', 'single from', 'album', 'film', 'song', 'band', 'episode', 'painting', 'publication', 'scholarly', 'article', 'village', 'city', 'town', 'company', 'video game', 'television', 'novel', 'character', 'musical', 'politician', 'actor', 'singer', 'footballer', 'river', 'mountain', 'disambiguation', 'ship', 'broadcaster', 'broadcasting', 'television channel', 'radio station', 'newspaper', 'herpesvirus', 'condition', 'virus', 'viruses', 'bacteria', 'disease', 'track', 'recording', 'song', 'studio', 'clinical', 'trial', 'research', 'patent', 'award', 'law of', 'tv series', 'web series', 'manga', 'anime', 'brand', 'record label', 'journal', 'book', 'magazine', 'school', 'street', 'township', 'county', 'commune', 'surname', 'crater', 'depression', 'pokémon', 'pokemon', 'print in', 'fictional', 'event', 'fall of', 'shower', 'list of', 'variable', 'software', 'standard', 'protocol', 'concept', 'algorithm', 'programming', 'computer program', 'file format', 'command', 'theorem', 'unit of', 'organization', 'website', 'language', 'operating system', 'library', 'framework', 'function', 'mathematical', 'theory', 'law', 'term', 'idea', 'method', 'process', 'profession', 'occupation', 'sport', 'game', 'genre', 'style', 'person', 'people', 'operator', 'worker', 'statue', 'family of', 'order of', 'taxon'];
    const q = query.toLowerCase();
    const scored = (r.search || []).map((s, k) => {
      const d = (s.description || '').toLowerCase(), l = (s.label || '').toLowerCase();
      let sc = -k * 0.15 + (l === q ? 4 : 0);
      const hit = (w) => new RegExp('\\b' + w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b').test(d); // whole words only
      for (const w of GOOD) if (hit(w)) sc += 2;
      for (const w of BAD) if (hit(w)) sc -= 8;
      return { id: s.id, label: s.label || s.id, description: s.description || '', score: sc };
    });
    scored.sort((a, b) => b.score - a.score);
    // Leave out things that clearly aren't physical (songs, broadcasters, people's names, diseases…).
    return scored.filter((r) => r.score > -2).slice(0, limit || 8);
  };

  function claimValues(ent, pid) {
    const cl = (ent.claims && ent.claims[pid]) || [];
    const pref = cl.filter((c) => c.rank === 'preferred');
    return (pref.length ? pref : cl.filter((c) => c.rank !== 'deprecated')).map((c) => c.mainsnak && c.mainsnak.datavalue && c.mainsnak.datavalue.value).filter((v) => v != null);
  }
  function toKelvin(q) {
    const a = parseFloat(q.amount);
    if (!isFinite(a)) return null;
    if (q.unit === UNIT.kelvin) return a;
    if (q.unit === UNIT.fahrenheit) return (a - 32) * 5 / 9 + 273.15;
    return a + 273.15; // degrees Celsius is by far the most common unit on Wikidata
  }
  function toGcm3(q) {
    const a = parseFloat(q.amount);
    if (!isFinite(a) || a <= 0) return null;
    if (q.unit === UNIT.kgm3 || q.unit === UNIT.gL) return a / 1000;
    if (q.unit === UNIT.gcm3) return a;
    return a > 40 ? a / 1000 : a;
  }
  const M_UNIT = { [K('Q11573')]: 1, [K('Q174728')]: 0.01, [K('Q174789')]: 0.001, [K('Q218593')]: 0.0254, [K('Q3710')]: 0.3048, [K('Q828224')]: 1000 };
  function toMetres(q) { const a = parseFloat(q.amount); const k = M_UNIT[q.unit]; return isFinite(a) && k ? a * k : null; }
  const median = (a) => { if (!a.length) return null; const s = a.slice().sort((x, y) => x - y); return s[s.length >> 1]; };

  // Full record for one Wikidata item: measured properties + words describing what it is.
  PC.fetchMaterialFacts = async function (id) {
    const r = await json(`${WD}?${qs({ action: 'wbgetentities', ids: id, props: 'labels|descriptions|claims|sitelinks', languages: 'en', sitefilter: 'enwiki', format: 'json', origin: '*' })}`);
    const ent = r.entities[id];
    const facts = {
      id, label: (ent.labels.en && ent.labels.en.value) || id, description: (ent.descriptions.en && ent.descriptions.en.value) || '',
      density: median(claimValues(ent, 'P2054').map(toGcm3).filter((v) => v)),
      mp: median(claimValues(ent, 'P2101').map(toKelvin).filter((v) => v != null)),
      bp: median(claimValues(ent, 'P2102').map(toKelvin).filter((v) => v != null)),
      flash: median(claimValues(ent, 'P2128').map(toKelvin).filter((v) => v != null)),
      autoignite: median(claimValues(ent, 'P2120').map(toKelvin).filter((v) => v != null)),
      hardness: median(claimValues(ent, 'P1088').map((q) => parseFloat(q.amount)).filter(isFinite)),
      molarMass: median(claimValues(ent, 'P2067').map((q) => parseFloat(q.amount)).filter(isFinite)),
      formula: claimValues(ent, 'P274')[0] || null,
      size: median(['P2048', 'P2049', 'P2043', 'P2386'].flatMap((pid) => claimValues(ent, pid).map(toMetres)).filter((v) => v && v > 0.001 && v < 50)),
      image: claimValues(ent, 'P18')[0] || null,
      wiki: ent.sitelinks && ent.sitelinks.enwiki ? ent.sitelinks.enwiki.title : null,
      classes: [], colors: [],
    };
    // Labels of what it is an instance/subclass of, its colour(s) and what it is made of.
    const refs = [...claimValues(ent, 'P31'), ...claimValues(ent, 'P279'), ...claimValues(ent, 'P186')].map((v) => v.id).filter(Boolean).slice(0, 30);
    const cols = claimValues(ent, 'P462').map((v) => v.id).filter(Boolean).slice(0, 5);
    const ids = [...new Set([...refs, ...cols])];
    if (ids.length) {
      const r2 = await json(`${WD}?${qs({ action: 'wbgetentities', ids: ids.join('|'), props: 'labels', languages: 'en', format: 'json', origin: '*' })}`);
      for (const q of refs) { const l = r2.entities[q] && r2.entities[q].labels.en; if (l) facts.classes.push(l.value.toLowerCase()); }
      for (const q of cols) { const l = r2.entities[q] && r2.entities[q].labels.en; if (l) facts.colors.push(l.value.toLowerCase()); }
    }
    if (facts.wiki) {
      try {
        const s = await json('https://en.wikipedia.org/api/rest_v1/page/summary/' + encodeURIComponent(facts.wiki));
        facts.extract = s.extract || '';
        if (s.thumbnail) facts.thumb = s.thumbnail.source;
      } catch (e) { /* summary is optional */ }
    }
    if (!facts.thumb && facts.image) facts.thumb = 'https://commons.wikimedia.org/wiki/Special:FilePath/' + encodeURIComponent(facts.image) + '?width=256';
    return facts;
  };

  // ---------------------------------------------------------------- Poly Haven
  let phIndex = null;
  async function polyHavenIndex() {
    // Retry once on a network hiccup, and don't cache a failure (so the next search tries again).
    if (!phIndex) phIndex = (async () => {
      for (let k = 0; k < 2; k++) { try { const [t, m] = await Promise.all([json(`${PH}/assets?t=textures`), json(`${PH}/assets?t=models`)]); return { textures: t, models: m }; } catch (e) { if (k) throw e; await new Promise((r) => setTimeout(r, 800)); } }
    })().catch((e) => { phIndex = null; throw e; });
    return phIndex;
  }
  const words = (s) => (s || '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter((w) => w.length > 2 && !['the', 'and', 'with', 'for', 'from', 'type', 'made', 'used'].includes(w));
  function bestAsset(list, terms, minScore) {
    let best = null, bestS = 0;
    for (const id in list) {
      const a = list[id], name = words(a.name + ' ' + id), tags = words((a.tags || []).join(' ') + ' ' + (a.categories || []).join(' '));
      let s = 0;
      for (const t of terms.main) { if (name.includes(t) || name.includes(t + 's') || name.includes(t + 'es') || (t.endsWith('s') && name.includes(t.slice(0, -1)))) s += 3; else if (name.some((w) => w.startsWith(t) || t.startsWith(w) && w.length > 3)) s += 2; else if (tags.includes(t)) s += 1; }
      for (const t of terms.extra) if (tags.includes(t) || name.includes(t)) s += 0.4;
      // Built surfaces (floor tiles, brick walls, planks…) are not the raw material unless that's what was asked for.
      for (const w of ['tile', 'tiles', 'floor', 'wall', 'brick', 'bricks', 'planks', 'pavement', 'road', 'cobblestone', 'roof']) if (name.includes(w) && !terms.main.includes(w)) s -= 2;
      if (s > bestS) { bestS = s; best = id; }
    }
    return bestS >= minScore ? best : null;
  }
  // A photo-scanned 3D model if Poly Haven has the object itself (a banana, a barrel, a boulder…), and a matching
  // PBR surface texture (granite, rusty metal, bark, marble…).
  PC.matchPolyHaven = async function (facts, cls) {
    let idx;
    try { idx = await polyHavenIndex(); } catch (e) { return {}; }
    const main = words(facts.label), extra = words(facts.classes.join(' ') + ' ' + cls);
    const terms = { main, extra };
    const model = cls === 'object' || cls === 'organic' ? bestAsset(idx.models, terms, 3) : null;
    // Surface textures only make sense for solids (a liquid or gas is drawn by its colour and optics).
    const texture = ['liquid', 'gas'].includes(cls) ? null : bestAsset(idx.textures, terms, main.length > 1 ? 3 : 2.5);
    return { model, texture };
  };

  // ---------------------------------------------------------------- Sketchfab models via the Objaverse mirror
  // Sketchfab's public search finds the model; Objaverse (an open mirror of ~800k Creative Commons Sketchfab models on
  // Hugging Face) serves the file without an account. The uid→file index (20 MB) is fetched once and cached in IndexedDB.
  const OBJ = 'https://huggingface.co/datasets/allenai/objaverse/resolve/main/';
  let objIndex = null;
  function idb(mode, fn) {
    return new Promise((res, rej) => {
      const r = indexedDB.open('physicscraft', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('kv');
      r.onerror = () => rej(r.error);
      r.onsuccess = () => { const tx = r.result.transaction('kv', mode), st = tx.objectStore('kv'), q = fn(st); tx.oncomplete = () => res(q && q.result); tx.onerror = () => rej(tx.error); };
    });
  }
  PC.objaverseIndex = function () {
    if (!objIndex) objIndex = (async () => {
      try { const c = await idb('readonly', (st) => st.get('objaverse-paths')); if (c) return c; } catch (e) { /* no cache */ }
      const r = await fetch(OBJ + 'object-paths.json.gz');
      if (!r.ok) throw new Error('Objaverse index ' + r.status);
      const text = await new Response(r.body.pipeThrough(new DecompressionStream('gzip'))).text();
      const paths = JSON.parse(text);
      try { await idb('readwrite', (st) => st.put(paths, 'objaverse-paths')); } catch (e) { /* cache optional */ }
      return paths;
    })().catch((e) => { objIndex = null; throw e; });
    return objIndex;
  };
  PC.matchSketchfabModel = async function (facts, query, sampleOnly) {
    const main = words(facts.label);
    if (!main.length) return null;
    let r;
    // Relevance + most-liked: the mirror is a 2022 snapshot, so popular (older) models are the ones it has.
    try {
      const base = { type: 'models', q: query || facts.label, downloadable: 'true', count: 24 };
      const [a, b] = await Promise.all([json('https://api.sketchfab.com/v3/search?' + qs(base)), json('https://api.sketchfab.com/v3/search?' + qs(Object.assign({ sort_by: '-likeCount' }, base))).catch(() => ({ results: [] }))]);
      const seen = new Set();
      r = { results: [...(a.results || []), ...(b.results || [])].filter((m) => !seen.has(m.uid) && seen.add(m.uid)) };
    } catch (e) { return null; }
    let paths;
    try { paths = await PC.objaverseIndex(); } catch (e) { return null; }
    const ctx = words(facts.description).filter((w) => !main.includes(w)).slice(0, 12);
    const cands = [];
    for (const m of r.results || []) {
      const path = paths[m.uid];
      if (!path || !PC.licenseOK(m.license && m.license.label)) continue; // newer than the mirror, or licence not allowed
      const glb = m.archives && m.archives.glb;
      if (glb && (glb.size > 25e6 || glb.faceCount > 300e3)) continue;
      // The model's own name must say what it is (tags are too loose: a fan-art scene tagged “printer”).
      const nn = words(m.name), nw = words(m.name + ' ' + (m.tags || []).map((t) => t.name).join(' '));
      if (!main.every((w) => nn.some((x) => x === w || x === w + 's' || x === w + 'es'))) continue; // whole words: “gold” ≠ “goldfish”
      // For a raw material, only a real sample of it: named just the material, or a rock/ingot/crystal/specimen of it.
      if (sampleOnly && !(m.name.trim().toLowerCase() === facts.label.toLowerCase() || /\b(rock|stone|mineral|ore|ingot|bar|nugget|sample|specimen|crystal|gem|gemstone|chunk|lump|piece|block|cube|boulder|pebble|slab|sheet|plate|rod)s?\b/i.test(m.name))) continue;
      if (sampleOnly && /\b(statue|head|bust|sculpture|character|wok|pan|knife|sword|ring|necklace|jewel|figure|fish)\b/i.test(m.name)) continue;
      if (/fan ?art|island|scene|level|map|world|city|house|building|character|avatar|\b(girl|boy|man|woman|person|lady|guy|kid|player|playing|holding|riding|with)\b/.test(m.name.toLowerCase()) && !main.some((w) => /island|scene|house|building|city/.test(w))) continue;
      const name = m.name.toLowerCase();
      let s = Math.log10(2 + (m.likeCount || 0)) + (m.staffpickedAt ? 1 : 0);
      if (/low ?poly|lowpoly|cartoon|stylized|toon|game ready|pack|set|collection|scene|room|diorama|kit/.test(name)) s -= 1.5;
      if (/ and | & |\bwith\b|\bset\b/.test(name)) s -= 2; // several things, not the one asked for
      if (name.trim() === facts.label.toLowerCase() || name.trim().endsWith(' ' + facts.label.toLowerCase())) s += 1;
      if (/realistic|scan|photogrammetr|pbr/.test(name)) s += 1;
      if (m.animationCount) s -= 0.5;
      // A qualifier that changes what the thing is ("3D printer", "toy car") unless it was asked for.
      for (const q of ['3d', 'toy', 'mini', 'lego', 'miniature', 'model kit', 'keychain', 'logo', 'icon']) if (new RegExp('\\b' + q + '\\b').test(name) && !main.includes(q)) s -= 3;
      // Words from the item's description in the model's name/tags (office printer, acoustic guitar…).
      for (const w of ctx) if (nw.includes(w)) s += 0.6;
      cands.push({ s, m, path });
    }
    cands.sort((a, b) => b.s - a.s);
    const pack = (c) => ({ glb: OBJ + c.path, uid: c.m.uid, name: c.m.name, author: c.m.user.displayName || c.m.user.username, authorUrl: c.m.user.profileUrl, license: c.m.license ? c.m.license.label : 'CC', url: c.m.viewerUrl, thumb: c.m.thumbnails && c.m.thumbnails.images && (c.m.thumbnails.images.find((i) => i.width >= 200 && i.width <= 720) || c.m.thumbnails.images[0]).url });
    if (!cands.length) return null;
    const best = pack(cands[0]);
    best.alts = cands.slice(0, 12).map(pack); // other models the user can switch to
    return best;
  };

  // Only licences that allow use on any website (commercial too) with modification: CC0, CC BY, CC BY-SA.
  // NonCommercial and NoDerivs models are never offered.
  PC.licenseOK = (label) => /^(CC Attribution|CC Attribution-ShareAlike|CC0 Public Domain)$/.test(label || '');

  // ---------------------------------------------------------------- model search (what the Search tab shows)
  // Real 3D models matching a query: Poly Haven scans first, then Sketchfab models that Objaverse can serve.
  // Whole words only, allowing plurals: “car” matches “cars” but not “cart”, “cardboard” or “carved”.
  const sameWord = (x, w) => x === w || x === w + 's' || x === w + 'es' || (w.endsWith('s') && x === w.slice(0, -1));
  PC.searchModels = async function (q) {
    const out = [], qw = words(q);
    try {
      const idx = await polyHavenIndex();
      for (const id in idx.models) {
        const a = idx.models[id], nw = words(a.name + ' ' + id + ' ' + (a.tags || []).join(' '));
        if (qw.length && qw.every((w) => nw.some((x) => sameWord(x, w)))) out.push({ source: 'polyhaven', id, uid: 'ph_' + id, name: a.name, author: (Object.keys(a.authors || {})[0]) || 'Poly Haven', license: 'CC0', url: 'https://polyhaven.com/a/' + id, thumb: `https://cdn.polyhaven.com/asset_img/thumbs/${id}.png?width=256&height=256` });
      }
    } catch (e) { /* Poly Haven optional */ }
    let res = [];
    try {
      const base = { type: 'models', q, downloadable: 'true', count: 24 };
      const [a, b] = await Promise.all([json('https://api.sketchfab.com/v3/search?' + qs(base)), json('https://api.sketchfab.com/v3/search?' + qs(Object.assign({ sort_by: '-likeCount' }, base))).catch(() => ({ results: [] }))]);
      const seen = new Set();
      res = [...(a.results || []), ...(b.results || [])].filter((m) => !seen.has(m.uid) && seen.add(m.uid));
    } catch (e) { if (!out.length) throw e; }
    let paths = {};
    try { paths = await PC.objaverseIndex(); } catch (e) { /* none */ }
    for (const m of res) {
      const path = paths[m.uid], glb = m.archives && m.archives.glb;
      if (!path || (glb && (glb.size > 25e6 || glb.faceCount > 300e3)) || !PC.licenseOK(m.license && m.license.label)) continue;
      out.push({ source: 'sketchfab', glb: OBJ + path, uid: m.uid, name: m.name, author: m.user.displayName || m.user.username, authorUrl: m.user.profileUrl, license: m.license ? m.license.label : 'CC', url: m.viewerUrl, likes: m.likeCount || 0, thumb: m.thumbnails && m.thumbnails.images && (m.thumbnails.images.find((i) => i.width >= 200 && i.width <= 720) || m.thumbnails.images[0]).url });
    }
    // Models whose own name contains the searched words first (Sketchfab also matches tags loosely).
    const named = (m) => { const nw = words(m.name); return qw.filter((w) => nw.some((x) => sameWord(x, w))).length / Math.max(1, qw.length); };
    out.forEach((m, k) => { m._r = named(m) * 100 - k; });
    out.sort((a, b) => b._r - a._r);
    return out.slice(0, 24);
  };

  // Physical properties for the thing a model shows: a separate Wikidata lookup by name (falls back to estimates).
  PC.propertiesFor = async function (q) {
    try {
      const r = await PC.searchWikidata(q, 5);
      for (const c of r) {
        const facts = await PC.fetchMaterialFacts(c.id);
        try { await PC.buildCustomMaterial(facts, { probe: true }); return facts; } catch (e) { /* not physical: try next */ }
      }
    } catch (e) { /* offline or nothing found */ }
    return { id: null, label: q, description: '', classes: [], colors: [], density: null, mp: null, bp: null };
  };

  // ---------------------------------------------------------------- Wikimedia Commons 3D scans
  // Commons hosts real 3D scans (meteorites, fossils, fruit, minerals, museum objects) as STL files, served with open
  // CORS. Only accept a file whose title names the thing itself, and prefer photogrammetry scans over game assets.
  PC.matchCommonsModel = async function (facts, scansOnly) {
    const main = words(facts.label);
    if (!main.length) return null;
    let r;
    try {
      r = await json('https://commons.wikimedia.org/w/api.php?' + qs({ action: 'query', generator: 'search', gsrnamespace: 6, gsrsearch: 'filetype:3d ' + facts.label, gsrlimit: 20, prop: 'imageinfo', iiprop: 'url|size|mime', format: 'json', origin: '*' }));
    } catch (e) { return null; }
    const pages = Object.values((r.query && r.query.pages) || {});
    let best = null, bestS = 0;
    for (const p of pages) {
      const ii = p.imageinfo && p.imageinfo[0];
      if (!ii || !/\.stl$/i.test(p.title) || ii.size < 30e3 || ii.size > 15e6) continue;
      const t = p.title.toLowerCase(), tw = words(t);
      if (!main.every((m) => tw.some((w) => w === m || w === m + 's' || w.startsWith(m)))) continue;
      let s = 1;
      const isScan = /scan|photogrammetr|specimen|museum|smithsonian/.test(t);
      if (scansOnly && !isScan) continue;
      if (isScan || /3d model/.test(t)) s += 2;
      if (/0 a\.d\.|supertuxkart|minecraft|thingiverse|lego|toy|game|keychain|cookie cutter|box|lattice|ring|statue|church|tree|figurine|logo|sign|part|bracket|mount|holder|case|adapter|printer|print/.test(t)) s -= 3;
      s -= Math.abs(Math.log10(ii.size / 3e6)) * 0.3; // a few MB: detailed but quick to load
      if (s > bestS) { bestS = s; best = { url: ii.url, title: p.title.replace(/^File:/, ''), page: 'https://commons.wikimedia.org/wiki/' + encodeURIComponent(p.title) }; }
    }
    return best;
  };

  // ---------------------------------------------------------------- classification → playable material
  // Whole-word (prefix) match, so 'ink' doesn't fire on 'drink' and 'oil' doesn't fire on 'soil'.
  const reCache = new Map();
  const has = (text, list) => list.some((w) => { let r = reCache.get(w); if (!r) { r = new RegExp('\\b' + w.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')); reCache.set(w, r); } return r.test(text); });
  const COLORS = { black: '#1d1c1b', white: '#ece9e2', grey: '#8c8c88', gray: '#8c8c88', silver: '#c6c9cc', gold: '#d4af37', golden: '#d4af37', yellow: '#e2c43c', orange: '#e0802c', red: '#b8322a', pink: '#e39aa7', purple: '#7a4a9c', violet: '#7a4a9c', blue: '#3a62b0', green: '#4c8a3c', brown: '#6e4a2c', colorless: '#e8eef0', colourless: '#e8eef0', transparent: '#e8eef0', copper: '#b87333', bronze: '#a87b45', brass: '#c8a951', brassy: '#c8a951', beige: '#d8c6a2', cyan: '#46b5c4', tan: '#c8a878' };
  function guessColor(facts, text) {
    for (const c of facts.colors) for (const k in COLORS) if (c.includes(k)) return COLORS[k];
    // Otherwise the colour word mentioned first in the description ("a white powder…", "a golden liquid…").
    let best = null, at = 1e9;
    for (const k in COLORS) { const m = new RegExp('\\b' + k + '\\b').exec(text); if (m && m.index < at) { at = m.index; best = COLORS[k]; } }
    return best;
  }

  PC.buildCustomMaterial = async function (facts, opts) {
    opts = opts || {};
    const text = (facts.label + ' ' + facts.description + ' ' + facts.classes.join(' ') + ' ' + (facts.extract || '').slice(0, 400)).toLowerCase();
    const T0 = 293;
    const organic = !!(facts.formula && /C/.test(facts.formula.replace(/Cl|Ca|Cu|Co|Cr|Cd|Ce|Cs|Cf|Cm|Cn/g, '')) && /H/.test(facts.formula));
    let mp = facts.mp, bp = facts.bp;
    // Flammable only if it is measured to be, or the item itself (not a passing word in its article) is fuel-like.
    const own = (facts.label + ' ' + facts.description + ' ' + facts.classes.join(' ')).toLowerCase();
    const flammable = facts.flash != null || facts.autoignite != null || has(own, ['flammable', 'fuel', 'combustible', 'wood', 'timber', 'paper', 'cardboard', 'wax', 'oil', 'alcohol', 'gasoline', 'petrol', 'coal', 'charcoal', 'hydrocarbon']);
    const natural = has(own, ['homo sapiens', 'animal', 'mammal', 'bird', 'organism', 'fruit', 'vegetable', 'food', 'berry', 'nut', 'plant', 'seed', 'egg', 'bone', 'skull', 'shell', 'fossil', 'animal']);
    // What kind of thing is it? Judge by the item's own description and categories first, the article text second.
    const classify = (t) => {
      // Living things: people, animals.
      if (has(t, ['homo sapiens', 'human being', 'mammal', 'animal', 'bird', 'fish', 'insect', 'reptile', 'amphibian', 'organism', 'breed', 'livestock', 'domesticated', 'pet'])) return 'creature';
      // Made things first: a chair is furniture even if its article says it's often metal.
      if (has(t, ['vessel', 'container', 'teapot', 'kettle', 'pot', 'pan', 'cup', 'mug', 'bottle', 'jar', 'bowl', 'furniture', 'machine', 'appliance', 'device', 'tool', 'instrument', 'peripheral', 'equipment', 'vehicle', 'utensil'])) return 'object';
      if (has(t, ['alloy', 'metal', 'steel', 'bronze', 'brass']) && !has(t, ['metalloid', 'organometallic', 'oxide', 'ore', 'metallic lustre'])) return 'metal';
      if (has(t, ['gas', 'vapour', 'vapor']) && !(mp && mp > T0)) return 'gas';
      if (has(t, ['liquid', 'beverage', 'drink', 'juice', 'milk', 'solvent', 'syrup', 'honey', 'sauce', 'alcohol', 'vinegar', 'wine', 'oil', 'ink', 'paint', 'dye', 'glue', 'adhesive', 'lotion', 'shampoo', 'gel', 'varnish', 'coffee', 'tea', 'soup', 'blood'])) return 'liquid';
      if (has(t, ['powder', 'flour', 'dust', 'sand', 'granular', 'pigment', 'spice', 'regolith', 'soil', 'ash', 'granulated'])) return 'powder';
      if (has(t, ['glass', 'obsidian'])) return 'glass';
      if (has(t, ['mineral', 'rock', 'stone', 'gemstone', 'gem ', 'crystal', 'ore', 'meteorite', 'granite', 'marble', 'basalt', 'igneous', 'sedimentary', 'metamorphic', 'clay', 'ceramic', 'concrete', 'allotrope'])) return 'rock';
      if (has(t, ['fruit', 'vegetable', 'food', 'tool', 'furniture', 'toy', 'instrument', 'device', 'ball', 'container', 'vessel', 'weapon', 'berry', 'nut', 'machine', 'appliance', 'computer', 'peripheral', 'equipment', 'apparatus', 'electronic', 'vehicle', 'gadget', 'phone', 'camera', 'engine', 'robot', 'printer', 'console', 'product', 'utensil', 'kitchenware', 'sports equipment', 'musical'])) return 'object';
      if (has(t, ['wood', 'plastic', 'polymer', 'rubber', 'wax', 'paper', 'fabric', 'textile', 'leather', 'fibre', 'fiber', 'cheese', 'bread'])) return 'organic';
      return null;
    };
    const primary = (facts.label + ' ' + facts.description + ' ' + facts.classes.join(' ')).toLowerCase();
    // Concepts, software and standards aren't things you can drop into a physics world.
    const ABSTRACT = ['track', 'recording', 'album', 'song', 'single by', 'broadcaster', 'film', 'episode', 'band', 'company', 'video game', 'virus', 'disease', 'patent', 'variable', 'software', 'standard', 'protocol', 'concept', 'algorithm', 'programming', 'computer program', 'file format', 'command', 'theorem', 'organization', 'website', 'language', 'operating system', 'framework', 'mathematical', 'theory', 'profession', 'occupation', 'genre', 'class of', 'unit of', 'abstract', 'field of study', 'academic discipline'];
    if (has((facts.description + ' ' + facts.classes.join(' ')).toLowerCase(), ABSTRACT) && !(facts.density || facts.mp || facts.bp))
      throw new Error(`“${facts.label}” is ${facts.description || 'an idea'}, not a physical material or object. Pick another result.`);
    let cls = classify(primary) || classify((facts.extract || '').slice(0, 300).toLowerCase()) || (organic ? 'organic' : 'rock');
    // A chemical element: use the built-in element (its real data and chemistry) and classify by its state.
    const elMat = PC.MATS.find((x) => x.el && x.el.name.toLowerCase() === facts.label.toLowerCase());
    if (elMat) {
      const e = elMat.el;
      cls = e.state === 'Gas' ? 'gas' : e.state === 'Liquid' ? 'liquid' : e.metal ? 'metal' : 'rock';
      if (mp == null) mp = elMat.mp; if (bp == null) bp = elMat.bp;
      if (!facts.density) facts.density = elMat.density;
    }
    // Fill in missing transition temperatures from what kind of thing it is.
    if (mp == null && bp == null) {
      if (cls === 'gas') { mp = 80; bp = 150; }
      else if (cls === 'liquid') { mp = 250; bp = organic ? 450 : 373; }
      else if (cls === 'metal') { mp = 1500; bp = 3000; }
      else if (cls === 'organic' || cls === 'object' || cls === 'creature') { mp = 9000; bp = 9500; } // they char/burn instead of melting
      else { mp = 1500; bp = 3000; }
    } else if (mp == null) mp = Math.min(bp - 50, cls === 'gas' ? bp - 40 : bp * 0.6);
    else if (bp == null) bp = cls === 'organic' || cls === 'object' ? mp + 400 : mp * 1.8 + 200;
    const phase = T0 < mp ? 'solid' : T0 < bp ? 'liquid' : 'gas';
    if (phase === 'liquid' && cls !== 'metal') cls = 'liquid';
    if (phase === 'gas') cls = 'gas';
    // Base material: provides behaviour (burning, reactions, granular or rigid physics).
    const base = elMat ? elMat.id : {
      metal: phase === 'liquid' ? 'Hg' : 'Au', rock: 'stone', glass: 'glass', powder: 'sand',
      // Food, plants and other once-living things char and burn when heated (like wood), they don't melt into lava.
      creature: 'flesh', organic: flammable || natural ? 'wood' : 'stone', object: flammable || natural ? 'wood' : 'stone',
      liquid: flammable || organic ? 'oil' : 'water', gas: flammable ? 'methane' : 'N',
    }[cls];
    const bm = PC.MAT[base];
    const density = facts.density || ({ creature: 1.01, metal: 7.5, rock: 2.6, glass: 2.5, powder: 1.5, organic: 0.9, object: 0.8, liquid: 1.0, gas: 0.0013 }[cls]);
    const color = (cls === 'creature' ? null : guessColor(facts, text)) || ({ creature: '#c8946e', metal: '#b9bcc0', rock: '#8a8580', glass: '#dff3ef', powder: '#d9cdb0', organic: '#a0784c', object: '#a0784c', liquid: '#c9a85a', gas: '#d6e4ee' }[cls]);
    const props = Object.assign(PC.defaultProps(bm), {
      density, mp, bp, color,
      ignite: flammable ? (facts.autoignite || facts.flash || (bm.burn ? bm.burn.ignite : 600)) : natural ? 640 : 0,
      reactivity: cls === 'metal' || cls === 'rock' || cls === 'glass' ? 0.2 : 1,
      strength: facts.hardness ? Math.min(1, facts.hardness / 10) : bm.strength,
      // Gases: most are colourless and nearly invisible; only genuinely coloured ones (chlorine, NO₂, iodine vapour…) show.
      opacity: cls === 'gas' ? (facts.colors.length && !facts.colors.some((c) => /colou?rless|transparent/.test(c)) ? 0.8 : 0.12) : cls === 'glass' ? 0.3 : cls === 'liquid' ? (has(text, ['clear', 'colourless', 'colorless', 'transparent', 'water']) ? 0.7 : 0.95) : bm.opacity,
      viscosity: cls === 'liquid' ? (has(text, ['honey', 'syrup', 'molasses', 'tar', 'glycerol', 'glycerin']) ? 0.8 : has(text, ['oil']) ? 0.35 : 0.08) : bm.viscosity,
    });
    if (opts.probe) return null; // only checking that it is a physical thing
    // The user picked a model: it is a solid object; use exactly that model.
    if (opts.model) {
      if (['liquid', 'gas', 'powder'].includes(cls) || (!elMat && !classify(primary) && !classify((facts.extract || '').slice(0, 300).toLowerCase()))) cls = 'object';
      const m = opts.model, label = opts.label || m.name;
      const fl = !!(props.ignite);
      return {
        key: 'mdl_' + m.uid, kind: 'custom', ver: 11, mat: elMat ? elMat.id : cls === 'creature' ? 'flesh' : cls === 'metal' ? 'Au' : cls === 'glass' ? 'glass' : (fl || natural || cls === 'organic') ? 'wood' : 'stone', label, T: T0, cls, phase: 'solid',
        props: Object.assign(props, { mp: Math.max(props.mp, cls === 'metal' || cls === 'rock' || cls === 'glass' ? props.mp : 9000), bp: Math.max(props.bp, 9500) }),
        shape: 'chunk', look: { rough: 0.6, metal: 0 }, texture: null,
        model: m.source === 'polyhaven' ? m.id : null, sf: m.source === 'sketchfab' ? Object.assign({}, m, { alts: (opts.alts || []).filter((a) => a.source === 'sketchfab') }) : null, stl: null,
        realSize: facts.size || null, query: opts.query, img: m.thumb || facts.thumb || null, formula: facts.formula || null,
        description: facts.description || '', extract: facts.extract || '', source: facts.id ? 'https://www.wikidata.org/wiki/' + facts.id : null, wiki: facts.wiki || null,
        facts: { density: facts.density, mp: facts.mp, bp: facts.bp, flash: facts.flash, autoignite: facts.autoignite, hardness: facts.hardness, molarMass: facts.molarMass },
      };
    }
    const ph = await PC.matchPolyHaven(facts, cls);
    // No Poly Haven scan of the object itself? Try a real 3D scan from Wikimedia Commons (solids only).
    // Commons STLs of manufactured things are mostly 3D-printing parts, so only natural specimens (rocks, minerals,
    // meteorites, fossils, fruit) use them.
    let stl = !ph.model && (cls === 'rock' || natural) ? await PC.matchCommonsModel(facts, cls !== 'rock') : null;
    // Still nothing? A community model (Sketchfab, via Objaverse) for any solid thing.
    // Only for things (a chair, a printer, an apple), never for a raw material like steel or granite.
    // A person becomes a jointed human ragdoll; other living things try for a real 3D model of that animal.
    const humanoid = cls === 'creature' && /homo sapiens|human being|\bhuman\b|\bperson\b|\bpeople\b/.test((facts.label + ' ' + facts.description).toLowerCase());
    // Every solid gets a real 3D model: the thing itself, or for a raw material a real sample of it
    // (a granite rock, a steel ingot, a diamond, a piece of obsidian).
    let sf = null;
    if (!humanoid && !ph.model && !stl && ['object', 'creature', 'organic', 'rock', 'metal', 'glass'].includes(cls)) {
      const forms = { rock: ['', ' rock', ' stone', ' mineral'], metal: ['', ' ingot', ' nugget', ' bar', ' metal'], glass: ['', ' glass'], organic: ['', ''], object: [''], creature: [''] }[cls];
      const raw = ['rock', 'metal', 'glass'].includes(cls);
      for (const suffix of forms) { sf = await PC.matchSketchfabModel(facts, facts.label + suffix, raw); if (sf) break; }
      // "stainless steel" → a steel sample: retry with the core material word.
      const core = facts.label.trim().split(/\s+/).pop();
      if (!sf && raw && core.toLowerCase() !== facts.label.trim().toLowerCase()) for (const suffix of forms) { sf = await PC.matchSketchfabModel(Object.assign({}, facts, { label: core }), core + suffix, raw); if (sf) break; }
    }
    const shape = { creature: 'chunk', metal: 'ingot', rock: 'rock', glass: 'glassblock', powder: 'cake', organic: 'chunk', object: natural ? 'chunk' : 'block', liquid: 'chunk', gas: 'chunk' }[cls];
    const look = { metal: { rough: 0.3, metal: 1 }, rock: { rough: 0.85, metal: 0 }, glass: {}, organic: { rough: 0.7, metal: 0 }, object: { rough: 0.6, metal: 0 } }[cls] || { rough: 0.6, metal: 0 };
    // Minerals with a metallic lustre (pyrite, galena, hematite…) shine like metal.
    if (cls === 'rock' && /metallic (lustre|luster)|metallic/.test(text)) { look.metal = 0.9; look.rough = 0.32; }
    return {
      key: 'wd_' + facts.id, kind: 'custom', ver: 10, mat: base, label: facts.label, T: T0, cls, phase,
      humanoid, props, shape, look, texture: sf || humanoid ? null : ph.texture || null, model: ph.model || null, stl, sf, realSize: facts.size || null,
      img: facts.thumb || null, formula: facts.formula, description: facts.description, extract: facts.extract || '',
      source: 'https://www.wikidata.org/wiki/' + facts.id, wiki: facts.wiki,
      facts: { density: facts.density, mp: facts.mp, bp: facts.bp, flash: facts.flash, autoignite: facts.autoignite, hardness: facts.hardness, molarMass: facts.molarMass },
    };
  };

  // Registry of user-made materials (persisted by the UI).
  PC.CUSTOM = PC.CUSTOM || {};
})(window.PC);
