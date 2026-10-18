// Projects: a home screen to create, open, rename, duplicate, export and delete labs. Everything is stored in this
// browser (IndexedDB) — no server. Projects export/import as .physicslab files.
(function (PC) {
  'use strict';

  const DB = 'physicscraft-projects', STORE = 'projects';
  function db() {
    return new Promise((res, rej) => {
      const r = indexedDB.open(DB, 1);
      r.onupgradeneeded = () => r.result.createObjectStore(STORE, { keyPath: 'id' });
      r.onerror = () => rej(r.error);
      r.onsuccess = () => res(r.result);
    });
  }
  async function tx(mode, fn) {
    const d = await db();
    return new Promise((res, rej) => {
      const t = d.transaction(STORE, mode), st = t.objectStore(STORE), q = fn(st);
      t.oncomplete = () => res(q && q.result);
      t.onerror = () => rej(t.error);
    });
  }
  const all = () => tx('readonly', (st) => st.getAll());
  const get = (id) => tx('readonly', (st) => st.get(id));
  const put = (p) => tx('readwrite', (st) => st.put(p));
  const del = (id) => tx('readwrite', (st) => st.delete(id));
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const ago = (t) => {
    const s = (Date.now() - t) / 1000;
    if (s < 60) return 'just now';
    if (s < 3600) return Math.floor(s / 60) + ' min ago';
    if (s < 86400) return Math.floor(s / 3600) + ' h ago';
    return new Date(t).toLocaleDateString();
  };

  const TEMPLATES = [
    { key: 'empty', label: 'Empty terrace', desc: 'A clean workspace.' },
    { key: 'pond', label: 'Koi pond', desc: 'A stone pool full of still water.' },
    { key: 'chem', label: 'Chemistry bench', desc: 'Beakers of water, vinegar and acid, ready to mix.' },
  ];

  class Projects {
    constructor(ui) {
      this.ui = ui; this.current = null; this.dirtyAt = 0;
      const el = this.el = document.createElement('div');
      el.id = 'home'; el.className = 'hidden';
      document.body.appendChild(el);
      // Autosave the open project every 15 s and when the tab is hidden or closed.
      setInterval(() => this.autosave(), 15000);
      document.addEventListener('visibilitychange', () => { if (document.hidden) this.save(true); });
      window.addEventListener('beforeunload', () => this.save(true));
    }
    get app() { return this.ui.app; }

    // ------------------------------------------------------------------ home screen
    async show() {
      if (this.current) await this.save(true);
      this.app.paused = true; this.ui.syncPlay && this.ui.syncPlay();
      let list = [];
      try { list = (await all()).sort((a, b) => b.updated - a.updated); } catch (e) { list = []; }
      const first = !list.length;
      this.el.innerHTML = `<div class="home-wrap">
        <header class="home-head">
          <div class="home-brand"><svg viewBox="0 0 32 32" class="logo"><g fill="none" stroke="#7cc4ff" stroke-width="2"><ellipse cx="16" cy="16" rx="13" ry="5"/><ellipse cx="16" cy="16" rx="13" ry="5" transform="rotate(60 16 16)"/><ellipse cx="16" cy="16" rx="13" ry="5" transform="rotate(-60 16 16)"/></g><circle cx="16" cy="16" r="3" fill="#ffcf5a"/></svg>
            <div><h1>PhysicsCraft</h1><p>3D physics &amp; chemistry lab</p></div></div>
          <div class="home-actions"><button class="btn" data-credits>Credits</button><button class="btn" data-import>${PC.ico('open')} Import .physicslab</button><button class="btn primary" data-new>New project</button></div>
        </header>
        ${first ? `<section class="home-welcome"><h2>Welcome</h2><p>Start by creating your first project — give it a name and pick a starting point. A short tour will show you around.</p><button class="btn primary big" data-new>Create your first project</button></section>` : ''}
        <section class="home-grid">${list.map((p) => `
          <article class="proj" data-id="${p.id}">
            <button class="proj-open" data-open="${p.id}" title="Open ${esc(p.name)}">${p.thumb ? `<img src="${p.thumb}" alt="">` : '<div class="proj-blank"></div>'}</button>
            <div class="proj-meta"><div class="proj-name">${esc(p.name)}</div><div class="proj-time">Edited ${ago(p.updated)}</div></div>
            <div class="proj-menu">
              <button class="icon-btn" data-rename="${p.id}" title="Rename">Rename</button>
              <button class="icon-btn" data-dup="${p.id}" title="Duplicate">Duplicate</button>
              <button class="icon-btn" data-export="${p.id}" title="Download as .physicslab">Export</button>
              <button class="icon-btn danger" data-del="${p.id}" title="Delete">Delete</button>
            </div>
          </article>`).join('')}</section>
        <input type="file" accept=".physicslab,.json" hidden data-file>
      </div><div class="home-modal hidden"></div>`;
      this.el.classList.remove('hidden');
      const q = (s) => this.el.querySelectorAll(s);
      for (const b of q('[data-new]')) b.onclick = () => this.newDialog();
      this.el.querySelector('[data-credits]').onclick = () => this.creditsDialog();
      for (const b of q('[data-open]')) b.onclick = () => this.open(b.dataset.open);
      for (const b of q('[data-rename]')) b.onclick = () => this.renameDialog(b.dataset.rename);
      for (const b of q('[data-dup]')) b.onclick = () => this.duplicate(b.dataset.dup);
      for (const b of q('[data-export]')) b.onclick = () => this.exportFile(b.dataset.export);
      for (const b of q('[data-del]')) b.onclick = () => this.deleteDialog(b.dataset.del);
      const file = this.el.querySelector('[data-file]');
      this.el.querySelector('[data-import]').onclick = () => file.click();
      file.onchange = () => { const f = file.files[0]; file.value = ''; if (f) this.importFile(f); };
      if (first) setTimeout(() => this.newDialog(), 300);
    }
    hide() { this.el.classList.add('hidden'); }

    modal(html, onReady) {
      const m = this.el.querySelector('.home-modal');
      m.innerHTML = `<div class="home-card">${html}</div>`;
      m.classList.remove('hidden');
      m.onclick = (e) => { if (e.target === m) m.classList.add('hidden'); };
      onReady(m, () => m.classList.add('hidden'));
    }
    async newDialog() {
      let n = 1;
      try { n = (await all()).length + 1; } catch (e) { /* ignore */ }
      this.modal(`<h2>New project</h2>
        <label class="fld"><span>Name</span><input type="text" id="projName" maxlength="60" value="My lab ${n}"></label>
        <div class="fld"><span>Start with</span><div class="tpl-grid">${TEMPLATES.map((t, k) => `<label class="tpl"><input type="radio" name="tpl" value="${t.key}"${k ? '' : ' checked'}><b>${t.label}</b><small>${t.desc}</small></label>`).join('')}</div></div>
        <div class="btns"><button class="btn" data-cancel>Cancel</button><button class="btn primary" data-ok>Create project</button></div>`, (m, close) => {
        const name = m.querySelector('#projName');
        name.focus(); name.select();
        m.querySelector('[data-cancel]').onclick = close;
        const go = () => { const tpl = m.querySelector('input[name=tpl]:checked').value; close(); this.create(name.value.trim() || 'Untitled lab', tpl); };
        m.querySelector('[data-ok]').onclick = go;
        name.onkeydown = (e) => { if (e.key === 'Enter') go(); };
      });
    }
    creditsDialog() {
      const L = (href, text) => `<a href="${href}" target="_blank" rel="noopener">${esc(text)}</a>`;
      const row = (name, what, lic, link) => `<tr><td><b>${name}</b><div class="cr-what">${what}</div></td><td>${lic}</td><td>${link}</td></tr>`;
      // 3D models the user has added from Search (each needs its author credited).
      const mine = (this.ui.customs || []).map((c) => {
        if (c.sf) return { name: c.sf.name, by: c.sf.author, lic: c.sf.license, url: c.sf.url, ok: PC.licenseOK(c.sf.license) };
        if (c.model) return { name: c.label, by: 'Poly Haven', lic: 'CC0', url: 'https://polyhaven.com/a/' + c.model, ok: true };
        if (c.stl) return { name: c.stl.title, by: 'Wikimedia Commons contributor', lic: 'See file page', url: c.stl.page, ok: true };
        return null;
      }).filter(Boolean);
      this.modal(`<h2>Credits</h2>
        <p class="cr-intro">PhysicsCraft is built on these open-source libraries and openly licensed assets. Every one of them allows use on a public website, including commercial use, as long as the credit below is kept.</p>
        <div class="cr-scroll">
        <h3>Software</h3>
        <table class="cr"><tbody>
          ${row('three.js r170', '3D rendering engine and add-ons (loaders, post-processing, controls)', 'MIT License', L('https://github.com/mrdoob/three.js/blob/dev/LICENSE', 'Copyright © 2010–2024 three.js authors'))}
          ${row('cannon-es 0.20', 'Rigid-body physics', 'MIT License', L('https://github.com/pmndrs/cannon-es/blob/master/LICENSE', 'Copyright © 2020 pmndrs; © 2015 Stefan Hedman'))}
          ${row('jsDelivr', 'Free CDN that serves the libraries and character models', 'Free open-source CDN', L('https://www.jsdelivr.com/terms', 'Terms'))}
        </tbody></table>
        <h3>Fonts</h3>
        <table class="cr"><tbody>
          ${row('Inter', 'Interface font, by Rasmus Andersson', 'SIL Open Font License 1.1', L('https://fonts.google.com/specimen/Inter/license', 'Google Fonts'))}
          ${row('JetBrains Mono', 'Numbers and readouts, by JetBrains', 'SIL Open Font License 1.1', L('https://fonts.google.com/specimen/JetBrains+Mono/license', 'Google Fonts'))}
        </tbody></table>
        <h3>3D assets, textures and environment</h3>
        <table class="cr"><tbody>
          ${row('Poly Haven', 'Garden HDRI sky (Chinese Garden), PBR textures, rocks, plants and scanned objects', 'CC0 (public domain)', L('https://polyhaven.com/license', 'polyhaven.com'))}
          ${row('Soldier &amp; X Bot characters', 'Rigged human and crash-test mannequin, from Adobe Mixamo, via the three.js examples', 'Mixamo terms: royalty-free use in projects, including commercial', L('https://helpx.adobe.com/creative-cloud/faq/mixamo-faq.html', 'Mixamo FAQ'))}
          ${row('Sketchfab community models', 'Models you add from Search (listed below with their authors)', 'Only CC BY, CC BY-SA and CC0 are offered', L('https://sketchfab.com/licenses', 'Sketchfab licences'))}
          ${row('Objaverse', 'Open mirror that serves the Sketchfab model files (Allen Institute for AI)', 'ODC-By 1.0 dataset; each model keeps its own licence', L('https://huggingface.co/datasets/allenai/objaverse', 'Hugging Face'))}
          ${row('Wikimedia Commons', '3D scans of specimens (meteorites, fossils, minerals)', 'Each file’s own free licence', L('https://commons.wikimedia.org/wiki/Commons:Licensing', 'Commons licensing'))}
        </tbody></table>
        <h3>Data</h3>
        <table class="cr"><tbody>
          ${row('Wikidata', 'Physical properties of searched materials', 'CC0 (public domain)', L('https://www.wikidata.org/wiki/Wikidata:Licensing', 'wikidata.org'))}
          ${row('Wikipedia', 'Descriptions and photos shown in material panels (each panel links its source article)', 'Text CC BY-SA 4.0; images under their own licences', L('https://en.wikipedia.org/wiki/Wikipedia:Text_of_the_Creative_Commons_Attribution-ShareAlike_4.0_International_License', 'CC BY-SA 4.0'))}
          ${row('Periodic table data', 'Element masses, densities, melting and boiling points (public scientific data)', 'Facts are not copyrightable', '—')}
        </tbody></table>
        <h3>3D models you added (${mine.length})</h3>
        ${mine.length ? `<table class="cr"><tbody>${mine.map((m) => row(esc(m.name), 'by ' + esc(m.by), esc(m.lic) + (m.ok ? '' : ' <span class="cr-bad">not allowed on a public site — remove this model</span>'), L(m.url, 'Source'))).join('')}</tbody></table>` : '<p class="cr-what">None yet. Models you add from Search are credited here and when you hover over them.</p>'}
        </div>
        <div class="btns"><button class="btn primary" data-cancel>Close</button></div>`, (m, close) => { m.querySelector('[data-cancel]').onclick = close; m.querySelector('.home-card').classList.add('wide'); });
    }

    async renameDialog(id) {
      const p = await get(id);
      this.modal(`<h2>Rename project</h2><label class="fld"><span>Name</span><input type="text" id="projName" maxlength="60" value="${esc(p.name)}"></label>
        <div class="btns"><button class="btn" data-cancel>Cancel</button><button class="btn primary" data-ok>Rename</button></div>`, (m, close) => {
        const name = m.querySelector('#projName'); name.focus(); name.select();
        m.querySelector('[data-cancel]').onclick = close;
        const go = async () => { p.name = name.value.trim() || p.name; await put(p); if (this.current && this.current.id === id) { this.current.name = p.name; this.syncTitle(); } close(); this.show(); };
        m.querySelector('[data-ok]').onclick = go;
        name.onkeydown = (e) => { if (e.key === 'Enter') go(); };
      });
    }
    async deleteDialog(id) {
      const p = await get(id);
      this.modal(`<h2>Delete “${esc(p.name)}”?</h2><p>This removes the project from this browser. Export it first if you want to keep a copy.</p>
        <div class="btns"><button class="btn" data-cancel>Cancel</button><button class="btn danger" data-ok>Delete</button></div>`, (m, close) => {
        m.querySelector('[data-cancel]').onclick = close;
        m.querySelector('[data-ok]').onclick = async () => { await del(id); if (this.current && this.current.id === id) this.current = null; close(); this.show(); };
      });
    }

    // ------------------------------------------------------------------ project lifecycle
    async create(name, tpl) {
      const sim = this.app.sim, ui = this.ui;
      sim.clear(); this.app.history.undo.length = 0; this.app.history.redo.length = 0; this.app.history.clearRing();
      ui.instruments.detachAll(); for (const s of ui.instruments.sensors.slice()) ui.instruments.remove(s);
      this.ui.view.controls.target.set(0, 0.2, 0); this.ui.view.camera.position.set(0.3, 1.6, 3.4); this.ui.view.controls.update();
      const E = (k) => ui.entryByKey[k];
      if (tpl === 'pond' && E('pool')) { sim.spawn(E('pool'), [0, 0, 0]); ui.drop(E('water'), [0, 0.1, 0]); }
      if (tpl === 'chem') {
        for (const [x, liq] of [[-0.7, 'water'], [0, 'vinegar'], [0.7, 'acid']]) { sim.spawn(E('beaker'), [x, 0, 0]); ui.drop(E(liq), [x, 0.1, 0]); }
        sim.spawn(E('testtube'), [0.35, 0, 0.5]);
      }
      this.app.history.undo.length = 0;
      const now = Date.now();
      this.current = { id: 'p' + now.toString(36) + Math.random().toString(36).slice(2, 6), name, created: now, updated: now };
      this.hide();
      this.app.paused = false; ui.syncPlay && ui.syncPlay();
      this.syncTitle();
      await this.save(true);
      let toured = false;
      try { toured = localStorage.getItem('pc.tourDone') === '1'; } catch (e) { toured = true; }
      if (!toured) setTimeout(() => ui.onboarding.start(), 600);
      else ui.toast({ title: 'Project created', name, info: true });
    }
    async open(id) {
      const p = await get(id);
      if (!p) return;
      const ui = this.ui;
      ui.instruments.detachAll(); for (const s of ui.instruments.sensors.slice()) ui.instruments.remove(s);
      try {
        const { snap, file: o } = PC.sceneFromJSON(p.scene);
        for (const c of o.customs || []) if (c && c.key && PC.MAT[c.mat]) { PC.CUSTOM[c.key] = c; if (!ui.entryByKey[c.key]) { ui.customs.push(c); ui.entryByKey[c.key] = c; } }
        if (o.nature) { Object.assign(ui.s, o.nature); ui.refreshSettingsValues(); if (ui.syncWind) ui.syncWind(); }
        PC.restoreWorld(this.app.sim, snap);
        if (o.camera) { ui.view.camera.position.fromArray(o.camera.pos); ui.view.controls.target.fromArray(o.camera.target); ui.view.controls.update(); }
      } catch (e) {
        ui.toast({ title: 'Could not open project', name: p.name, sub: String(e.message || e), info: true });
        return;
      }
      this.app.history.undo.length = 0; this.app.history.redo.length = 0; this.app.history.clearRing();
      this.current = { id: p.id, name: p.name, created: p.created, updated: p.updated };
      ui.afterRestore(); ui.renderSidebar();
      this.hide();
      this.app.paused = false; ui.syncPlay && ui.syncPlay();
      this.syncTitle();
    }
    sceneText() { return this.ui.sceneJSON(); }
    thumb() {
      try {
        const src = this.app.canvas, c = document.createElement('canvas');
        c.width = 320; c.height = 180;
        const g = c.getContext('2d');
        this.ui.view.render(0);
        g.drawImage(src, 0, 0, c.width, c.height);
        return c.toDataURL('image/jpeg', 0.7);
      } catch (e) { return null; }
    }
    async save(quiet) {
      if (!this.current) return;
      const p = Object.assign({}, this.current, { updated: Date.now(), scene: this.sceneText(), thumb: this.thumb() });
      try { await put(p); this.current.updated = p.updated; if (!quiet) this.ui.toast({ title: 'Project saved', name: p.name, info: true }); }
      catch (e) { if (!quiet) this.ui.toast({ title: 'Could not save', name: String(e.message || e), info: true }); }
    }
    autosave() { const atHome = !this.el.classList.contains('hidden'); if (this.current && !atHome && !document.hidden) this.save(true); }
    async duplicate(id) {
      const p = await get(id), now = Date.now();
      await put(Object.assign({}, p, { id: 'p' + now.toString(36) + Math.random().toString(36).slice(2, 6), name: p.name + ' copy', created: now, updated: now }));
      this.show();
    }
    async exportFile(id) {
      const p = id ? await get(id) : Object.assign({}, this.current, { scene: this.sceneText() });
      if (!p) return;
      const o = JSON.parse(p.scene); o.projectName = p.name;
      this.ui.download(`${p.name.replace(/[^\w\- ]+/g, '').trim() || 'project'}.physicslab`, new Blob([JSON.stringify(o)], { type: 'application/octet-stream' }));
    }
    async importFile(file) {
      try {
        const text = await file.text();
        const o = JSON.parse(text);
        if (o.app !== 'PhysicsCraft') throw new Error('This file is not a PhysicsCraft project.');
        const now = Date.now(), id = 'p' + now.toString(36) + Math.random().toString(36).slice(2, 6);
        await put({ id, name: o.projectName || file.name.replace(/\.(physicslab|json)$/i, ''), created: now, updated: now, scene: text, thumb: null });
        await this.open(id);
      } catch (e) {
        this.modal(`<h2>Could not import</h2><p>${esc(e.message || e)}</p><div class="btns"><button class="btn primary" data-cancel>OK</button></div>`, (m, close) => { m.querySelector('[data-cancel]').onclick = close; });
      }
    }
    syncTitle() {
      const t = document.getElementById('projTitle');
      if (t) t.textContent = this.current ? this.current.name : '';
      document.title = this.current ? `${this.current.name} · PhysicsCraft` : 'PhysicsCraft';
    }
  }
  PC.Projects = Projects;
})(window.PC);
