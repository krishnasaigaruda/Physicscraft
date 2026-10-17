// First-run guided tour and a list of experiment challenges that tick off as they happen in the world.
(function (PC) {
  'use strict';

  PC.CHALLENGES = [
    { key: 'rx:Hydrogen combustion', title: 'Make water from hydrogen and oxygen', hint: 'Put H and O together and heat them (Heat tool, 5).' },
    { key: 'rx:Metal + water', title: 'Drop an alkali metal in water', hint: 'Sodium or potassium from the Periodic tab into a pool.' },
    { key: 'rx:Salt synthesis', title: 'Make table salt from its elements', hint: 'Sodium meets chlorine gas.' },
    { key: 'rx:Fizz', title: 'Make a fizzing volcano', hint: 'Vinegar and baking soda.' },
    { key: 'rx:Neutralisation', title: 'Neutralise an acid', hint: 'Acid plus a base like lye. Check it with a pH meter.' },
    { key: 'rx:Dissolving', title: 'Dissolve something in water', hint: 'Salt or sugar into a beaker of water.' },
    { key: 'obsidian', title: 'Make obsidian', hint: 'Pour lava into water and let it set.' },
    { key: 'burnwood', title: 'Set wood on fire', hint: 'Drop a plank on lava or use the Heat tool.' },
    { key: 'detonate', title: 'Detonate an explosive', hint: 'TNT or nitroglycerin — heat or hit it.' },
    { key: 'electrolysis', title: 'Split water with electricity', hint: 'Build a battery (Inventions) and drop it in brine.' },
    { key: 'bulb', title: 'Light a bulb', hint: 'A bulb touching a battery, or wired through copper.' },
    { key: 'burst', title: 'Burst a sealed container', hint: 'Put the lid on a beaker of water and boil it.' },
    { key: 'invent', title: 'Build an invention', hint: 'Gather the ingredients and press Build in the Inventions tab.' },
    { key: 'rx:Annihilation', title: 'Annihilate matter', hint: 'Antimatter touches anything.' },
  ];

  const STEPS = [
    { sel: '#sbBody', title: 'Materials', text: 'Drag anything from the sidebar into the workspace. Click a card to change its properties before you drop it.' },
    { sel: '#tabs', title: 'Elements, containers and inventions', text: 'All 118 elements are under Periodic. Containers holds beakers, tanks and pools. Inventions are devices you build from ingredients.' },
    { sel: '#tabs [data-tab="web"]', title: 'Search anything', text: 'Find any material on Earth or in space. Real properties and a real 3D model are fetched for you.' },
    { sel: '#tools', title: 'Tools', text: 'Stir, grab, blow, pour, heat, cool, explode and erase — keys 1 to 8. Hovering over water makes ripples.' },
    { sel: '#btnWind', title: 'Nature', text: 'Weather, time of day and wind. Rain fills containers; lightning strikes.' },
    { sel: '#histGroup', title: 'Undo, rewind, save, record', text: 'Undo (Ctrl+Z) and rewind 5 s (R) after an accident. Save a scene to a file and open it later. Record a video. Sound on/off. Instruments (I) measure temperature, pH, pressure and mass with live graphs.' },
    { sel: '#stage', title: 'You are ready', text: 'Try the challenges in Help (H) — they tick off as you do them. Have fun!' },
  ];

  class Onboarding {
    constructor(ui) {
      this.ui = ui;
      try { const a = JSON.parse(localStorage.getItem('pc.achieved') || '[]'); this.ui.sim.achieved = new Set(a); } catch (e) { this.ui.sim.achieved = new Set(); }
      this.el = document.createElement('div');
      this.el.id = 'tour'; this.el.className = 'hidden';
      this.el.innerHTML = '<div class="tour-hole"></div><div class="tour-card" role="dialog" aria-live="polite"></div>';
      document.body.appendChild(this.el);
      window.addEventListener('resize', () => { if (!this.el.classList.contains('hidden')) this.show(); });
      let done = false;
      try { done = localStorage.getItem('pc.tourDone') === '1'; } catch (e) { done = true; }
      void done; // the tour starts after the first project is created (see projects.js)
    }
    start() { this.i = 0; this.el.classList.remove('hidden'); this.show(); }
    end() { this.el.classList.add('hidden'); try { localStorage.setItem('pc.tourDone', '1'); } catch (e) { /* ignore */ } }
    show() {
      const st = STEPS[this.i], t = document.querySelector(st.sel);
      const hole = this.el.querySelector('.tour-hole'), card = this.el.querySelector('.tour-card');
      const r = t ? t.getBoundingClientRect() : { left: innerWidth / 2 - 100, top: innerHeight / 2 - 50, width: 200, height: 100 };
      const pad = 6;
      Object.assign(hole.style, { left: r.left - pad + 'px', top: r.top - pad + 'px', width: r.width + pad * 2 + 'px', height: r.height + pad * 2 + 'px' });
      card.innerHTML = `<div class="tour-step">${this.i + 1} / ${STEPS.length}</div><h3>${st.title}</h3><p>${st.text}</p>
        <div class="tour-btns"><button class="btn" data-skip>Skip tour</button><span></span>${this.i ? '<button class="btn" data-back>Back</button>' : ''}<button class="btn primary" data-next>${this.i === STEPS.length - 1 ? 'Start' : 'Next'}</button></div>`;
      // Card next to the highlighted area, kept on screen.
      const cw = Math.min(320, innerWidth - 32);
      let x = r.left + r.width + 16, y = r.top;
      if (x + cw > innerWidth - 16) x = r.left - cw - 16;
      if (x < 16) { x = Math.max(16, Math.min(innerWidth - cw - 16, r.left)); y = r.top + r.height + 16; }
      if (y + 200 > innerHeight) y = Math.max(16, innerHeight - 220);
      Object.assign(card.style, { left: x + 'px', top: y + 'px', width: cw + 'px' });
      card.querySelector('[data-skip]').onclick = () => this.end();
      card.querySelector('[data-next]').onclick = () => { if (this.i === STEPS.length - 1) this.end(); else { this.i++; this.show(); } };
      const back = card.querySelector('[data-back]'); if (back) back.onclick = () => { this.i--; this.show(); };
      card.querySelector('[data-next]').focus();
    }
    onAchieve(key) {
      try { localStorage.setItem('pc.achieved', JSON.stringify([...this.ui.sim.achieved])); } catch (e) { /* ignore */ }
      const c = PC.CHALLENGES.find((x) => x.key === key);
      if (c) this.ui.toast({ title: 'Challenge complete!', name: c.title, sub: `${this.count()} / ${PC.CHALLENGES.length} done` });
      const list = document.querySelector('#help .challenges');
      if (list) list.outerHTML = this.listHtml();
    }
    count() { return PC.CHALLENGES.filter((c) => this.ui.sim.achieved.has(c.key)).length; }
    listHtml() {
      return `<div class="challenges"><h3>Challenges — ${this.count()} / ${PC.CHALLENGES.length}</h3>${PC.CHALLENGES.map((c) => {
        const ok = this.ui.sim.achieved.has(c.key);
        return `<div class="ch${ok ? ' ok' : ''}"><span class="ch-box">${ok ? PC.ico('check') : ''}</span><div><div class="ch-t">${c.title}</div><div class="ch-h">${c.hint}</div></div></div>`;
      }).join('')}</div>`;
    }
  }
  PC.Onboarding = Onboarding;
})(window.PC);
