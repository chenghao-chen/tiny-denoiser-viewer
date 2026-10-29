/* Static image-comparison viewer.
 *
 * Knows nothing about any project: everything it shows comes from
 * data/index.js and data/scenes/*.js, which tools/scan.py generates from
 * the folder convention. All paths are relative, nothing is fetched.
 */
'use strict';

const IDX = window.VIEWER_INDEX || null;
const $ = (s, r) => (r || document).querySelector(s);
const el = (t, cls, txt) => { const n = document.createElement(t);
  if (cls) n.className = cls; if (txt != null) n.textContent = txt; return n; };

if (!IDX || !IDX.collections || !IDX.collections.length) {
  const m = $('#missing'); if (m) m.hidden = false;
} else {
  start();
}

function start() {
  const P = IDX.project || {};
  const AX = Object.assign({ collectionGroup: 'Group', config: 'Config',
    method: 'Method', variant: 'Variant' }, P.axis || {});
  const MET = Object.assign({ name: 'value', unit: '', higherIsBetter: true,
    decimals: 2 }, P.metric || {});
  const CH = Object.assign({ xLog: false }, P.chart || {});

  document.title = P.title || document.title;
  $('#title').textContent = P.title || 'Image comparison viewer';
  $('#subtitle').textContent = P.subtitle || '';

  const byId = {};
  IDX.collections.forEach(c => { byId[c.id] = c; });
  const groups = IDX.groups && IDX.groups.length ? IDX.groups
    : Array.from(new Set(IDX.collections.map(c => c.group)));

  const S = {               // the whole UI state; mirrored in the URL hash
    group: null, config: null, tab: 'compare', scene: null,
    variant: null, method: null, zoom: 0, cols: 4,
    sort: false, showMetric: true, diff: false, amp: 8,
    tags: new Set(), query: '', ab: false, abA: null, abB: null, abSplit: 50,
  };
  let pinned = null;        // {u, v} normalised zoom centre
  let hover = null;

  // ------------------------------------------------------------ helpers

  const coll = () => byId[S.config] || null;
  const fmt = v => (v == null || isNaN(v)) ? '' : Number(v).toFixed(MET.decimals);
  const unit = MET.unit ? ' ' + MET.unit : '';
  const collsInGroup = g => IDX.collections.filter(c => c.group === g);

  function sceneKey() { return S.config + '__' + S.scene; }

  function loadScene(key, done) {
    const cache = window.VIEWER_SCENES || {};
    if (cache[key]) return done(cache[key]);
    const s = document.createElement('script');
    s.src = 'data/scenes/' + key + '.js';
    s.onload = () => done((window.VIEWER_SCENES || {})[key] || null);
    s.onerror = () => done(null);
    document.head.appendChild(s);
  }

  function variantsOf(c) { return c ? c.variants : []; }
  function variantById(c, id) { return variantsOf(c).find(v => v.id === id) || null; }

  function metricFor(sc, method, variant) {
    if (!sc || !sc.metrics) return null;
    const row = sc.metrics[method];
    if (!row) return null;
    const v = row[variant != null ? variant : ''];
    return v == null ? (row[''] != null ? row[''] : null) : v;
  }

  function inputMetric(sc) { return metricFor(sc, '_input', ''); }

  // ------------------------------------------------------------ the hash

  function writeHash() {
    const p = new URLSearchParams();
    p.set('g', S.group); p.set('c', S.config); p.set('t', S.tab);
    if (S.scene) p.set('s', S.scene);
    if (S.variant) p.set('v', S.variant);
    if (S.method) p.set('m', S.method);
    if (S.zoom) p.set('z', String(S.zoom));
    history.replaceState(null, '', '#' + p.toString());
  }

  function readHash() {
    const p = new URLSearchParams(location.hash.replace(/^#/, ''));
    return {
      group: p.get('g'), config: p.get('c'), tab: p.get('t'),
      scene: p.get('s'), variant: p.get('v'), method: p.get('m'),
      zoom: p.get('z') ? Number(p.get('z')) : null,
    };
  }

  // ------------------------------------------------------- state changes

  function setGroup(g, keep) {
    S.group = groups.includes(g) ? g : groups[0];
    const list = collsInGroup(S.group);
    if (!list.length) { S.config = null; return; }
    const stay = keep && list.some(c => c.id === S.config);
    if (!stay) S.config = list[0].id;
    reconcile();
  }

  /** Keep scene / method / variant across a switch where they still exist. */
  function reconcile() {
    const c = coll();
    if (!c) return;
    if (!c.scenes.some(s => s.id === S.scene)) S.scene = c.scenes[0].id;
    if (!c.methods.includes(S.method)) S.method = c.methods[0] || null;
    const vs = variantsOf(c);
    if (!vs.some(v => v.id === S.variant)) S.variant = vs.length ? vs[0].id : null;
    if (!c.scenes.some(s => (s.tags || []).some(t => S.tags.has(t)))) {
      // a tag filter that matches nothing here would hide every scene
      S.tags.forEach(t => { if (!c.tags.includes(t)) S.tags.delete(t); });
    }
  }

  // ----------------------------------------------------------- the chrome

  function renderGroups() {
    const box = $('#groups'); box.textContent = '';
    groups.forEach(g => {
      const n = collsInGroup(g).length;
      const b = el('button', '', n ? g : g + ' — not available');
      b.setAttribute('aria-selected', String(g === S.group));
      b.disabled = !n;
      b.onclick = () => { setGroup(g, true); renderAll(); };
      box.appendChild(b);
    });
  }

  function renderConfig() {
    const sel = $('#config'); sel.textContent = '';
    collsInGroup(S.group).forEach(c => {
      const o = el('option', '', c.label); o.value = c.id;
      o.selected = c.id === S.config; sel.appendChild(o);
    });
    sel.onchange = () => { S.config = sel.value; reconcile(); renderAll(); };
    const lab = sel.parentElement.firstChild;   // the label's text node
    if (lab && lab.nodeType === 3) lab.textContent = AX.config + ' ';
  }

  function renderTabs() {
    document.querySelectorAll('.tab').forEach(b => {
      b.setAttribute('aria-selected', String(b.dataset.tab === S.tab));
      b.onclick = () => { S.tab = b.dataset.tab; renderAll(); };
    });
  }

  function renderSidebar() {
    const c = coll(); if (!c) return;
    const tagbox = $('#tags'); tagbox.textContent = '';
    c.tags.forEach(t => {
      const b = el('button', 'chip', t);
      b.setAttribute('aria-pressed', String(S.tags.has(t)));
      b.onclick = () => { S.tags.has(t) ? S.tags.delete(t) : S.tags.add(t);
        renderSidebar(); };
      tagbox.appendChild(b);
    });

    const q = S.query.trim().toLowerCase();
    const list = $('#scenes'); list.textContent = '';
    c.scenes.filter(s =>
      (!S.tags.size || (s.tags || []).some(t => S.tags.has(t))) &&
      (!q || s.id.toLowerCase().includes(q) ||
        (s.tags || []).join(' ').toLowerCase().includes(q))
    ).forEach(s => {
      const li = el('li');
      li.setAttribute('aria-current', String(s.id === S.scene));
      if (s.thumb) { const im = el('img'); im.src = s.thumb; im.alt = '';
        im.loading = 'lazy'; li.appendChild(im); }
      const box = el('div');
      box.appendChild(el('div', 'sid', s.id));
      if (s.tags && s.tags.length) box.appendChild(el('div', 'stags', s.tags.join(' · ')));
      li.appendChild(box);
      li.onclick = () => { S.scene = s.id; renderAll(); };
      list.appendChild(li);
    });
  }

  function renderPicker() {
    const c = coll(); const wrap = $('#picker-wrap'); wrap.textContent = '';
    if (S.tab === 'compare') {
      wrap.appendChild(el('span', '', AX.variant));
      const sel = el('select');
      variantsOf(c).forEach(v => {
        const o = el('option', '', v.label + (v.badge ? ' — ' + v.badge : ''));
        o.value = v.id; o.selected = v.id === S.variant; sel.appendChild(o);
      });
      sel.onchange = () => { S.variant = sel.value; renderStage(); };
      wrap.appendChild(sel);
      wrap.appendChild(stepper(() => step('variant', -1), () => step('variant', 1)));
    } else {
      wrap.appendChild(el('span', '', AX.method));
      const sel = el('select');
      c.methods.forEach(m => {
        const o = el('option', '', m); o.value = m;
        o.selected = m === S.method; sel.appendChild(o);
      });
      sel.onchange = () => { S.method = sel.value; renderStage(); };
      wrap.appendChild(sel);
      wrap.appendChild(stepper(() => step('method', -1), () => step('method', 1)));
    }
  }

  function stepper(prev, next) {
    const w = el('span');
    const a = el('button', '', '‹'); a.onclick = prev;
    const b = el('button', '', '›'); b.onclick = next;
    w.append(a, b); return w;
  }

  function step(what, d) {
    const c = coll();
    if (what === 'variant') {
      const ids = variantsOf(c).map(v => v.id);
      if (!ids.length) return;
      S.variant = ids[(ids.indexOf(S.variant) + d + ids.length) % ids.length];
    } else if (what === 'method') {
      const ids = c.methods;
      if (!ids.length) return;
      S.method = ids[(ids.indexOf(S.method) + d + ids.length) % ids.length];
    } else if (what === 'scene') {
      const ids = c.scenes.map(s => s.id);
      S.scene = ids[(ids.indexOf(S.scene) + d + ids.length) % ids.length];
      renderSidebar();
    }
    renderStage(); writeHash();
  }

  // -------------------------------------------------------------- panels

  /** One panel. `src` null means the combination does not exist. */
  function panel(name, src, value, badge, tagForSave) {
    const p = el('div', 'panel' + (src ? '' : ' missing'));
    p.dataset.name = name;
    if (src) p.dataset.src = src;
    const head = el('div', 'head');
    const nm = el('div', 'name', name);
    if (badge) nm.appendChild(el('span', 'badge', badge));
    head.appendChild(nm);
    if (S.showMetric) {
      const v = el('div', 'val');
      if (value == null) v.textContent = src ? '—' : 'not available';
      else {
        v.appendChild(el('b', '', fmt(value) + unit));
        const base = tagForSave && tagForSave.base;
        if (base != null && isFinite(base)) {
          const d = value - base;
          const up = MET.higherIsBetter ? d > 0 : d < 0;
          v.appendChild(el('span', 'delta ' + (up ? 'up' : 'down'),
            (d >= 0 ? '+' : '') + fmt(d)));
        }
      }
      head.appendChild(v);
    }
    p.appendChild(head);

    const wrap = el('div', 'imgwrap');
    if (src) {
      const img = el('img'); img.src = src; img.alt = name; img.loading = 'lazy';
      wrap.appendChild(img);
      const lo = el('div', 'loupe'); wrap.appendChild(lo);
      wireZoom(wrap, src);
    } else {
      wrap.appendChild(el('div', 'none', 'not available'));
    }
    p.appendChild(wrap);
    p.addEventListener('contextmenu', ev => { ev.preventDefault();
      openMenu(ev.clientX, ev.clientY, p); });
    return p;
  }

  function wireZoom(wrap, src) {
    wrap.addEventListener('mousemove', ev => {
      if (!S.zoom || pinned) return;
      const r = wrap.getBoundingClientRect();
      hover = { u: (ev.clientX - r.left) / r.width, v: (ev.clientY - r.top) / r.height };
      applyZoom();
    });
    wrap.addEventListener('mouseleave', () => { if (!pinned) { hover = null; applyZoom(); } });
    wrap.addEventListener('click', ev => {
      if (!S.zoom) return;
      const r = wrap.getBoundingClientRect();
      pinned = pinned ? null
        : { u: (ev.clientX - r.left) / r.width, v: (ev.clientY - r.top) / r.height };
      applyZoom();
    });
  }

  /** Every panel shows the same region at once -- that is the point. */
  function applyZoom() {
    const at = pinned || hover;
    document.querySelectorAll('#grid .imgwrap').forEach(w => {
      const lo = w.querySelector('.loupe');
      if (!lo) return;
      if (!S.zoom || !at) { w.classList.remove('zoomed', 'pinned'); return; }
      w.classList.add('zoomed');
      w.classList.toggle('pinned', !!pinned);
      const src = w.parentElement.dataset.src;
      if (!src) return;
      const z = S.zoom;
      lo.style.backgroundImage = 'url("' + src.replace(/"/g, '\\"') + '")';
      lo.style.backgroundSize = (z * 100) + '% ' + (z * 100) + '%';
      lo.style.backgroundPosition = (at.u * 100) + '% ' + (at.v * 100) + '%';
    });
  }

  // --------------------------------------------------------- difference

  /** |panel - reference| * amp, drawn in the browser. Needs pixel access. */
  function applyDiff(sc) {
    if (!S.diff || !sc.reference) return;
    const ref = new Image();
    ref.onload = () => {
      document.querySelectorAll('#grid .panel').forEach(p => {
        const src = p.dataset.src;
        if (!src || src === sc.reference) return;
        const im = new Image();
        im.onload = () => {
          try {
            const w = im.naturalWidth, h = im.naturalHeight;
            const ca = document.createElement('canvas'); ca.width = w; ca.height = h;
            const cx = ca.getContext('2d', { willReadFrequently: true });
            cx.drawImage(im, 0, 0);
            const a = cx.getImageData(0, 0, w, h);
            const cb = document.createElement('canvas'); cb.width = w; cb.height = h;
            const bx = cb.getContext('2d', { willReadFrequently: true });
            bx.drawImage(ref, 0, 0, w, h);
            const b = bx.getImageData(0, 0, w, h);
            const amp = S.amp;
            for (let i = 0; i < a.data.length; i += 4) {
              for (let k = 0; k < 3; k++) {
                a.data[i + k] = Math.min(255, Math.abs(a.data[i + k] - b.data[i + k]) * amp);
              }
            }
            cx.putImageData(a, 0, 0);
            const wrap = p.querySelector('.imgwrap');
            const old = wrap.querySelector('img');
            if (old) old.replaceWith(ca);
          } catch (e) {
            note('The difference view needs pixel access to the images, which '
               + 'the browser blocks on file:// URLs. Serve the folder with '
               + '"python -m http.server" and reload.');
          }
        };
        im.src = src;
      });
    };
    ref.src = sc.reference;
  }

  function note(msg) { const w = $('#warn'); w.hidden = false; w.textContent = msg; }

  // ----------------------------------------------------------- the stage

  function renderStage() {
    const c = coll(); if (!c) return;
    $('#warn').hidden = true;
    renderPicker();
    const grid = $('#grid');
    grid.textContent = '';
    grid.className = 'grid' + (S.tab === 'scale' ? ' row' : '');
    grid.style.setProperty('--cols', S.cols);
    grid.style.setProperty('--rowwidth', Math.max(140, Math.round(1100 / S.cols)) + 'px');
    $('#chartwrap').hidden = S.tab !== 'scale';

    loadScene(sceneKey(), sc => {
      if (!sc) { grid.appendChild(el('p', 'warn', 'scene data did not load')); return; }
      const base = inputMetric(sc);
      const items = [];

      if (sc.input) items.push({ name: 'input', src: sc.input, value: base });

      if (S.tab === 'compare') {
        c.methods.forEach(m => {
          const src = (sc.images[m] || {})[S.variant] || null;
          items.push({ name: m, src, value: metricFor(sc, m, S.variant) });
        });
      } else {
        variantsOf(c).forEach(v => {
          const src = (sc.images[S.method] || {})[v.id] || null;
          items.push({ name: v.label, src, value: metricFor(sc, S.method, v.id),
            badge: v.badge, vid: v.id });
        });
      }
      if (sc.reference) items.push({ name: 'reference', src: sc.reference, value: null });

      const body = items.filter(i => i.name !== 'input' && i.name !== 'reference');
      if (S.sort) body.sort((a, b) => {
        const av = a.value == null ? -Infinity : a.value;
        const bv = b.value == null ? -Infinity : b.value;
        return MET.higherIsBetter ? bv - av : av - bv;
      });
      const ordered = []
        .concat(items.filter(i => i.name === 'input'), body,
                items.filter(i => i.name === 'reference'));

      ordered.forEach(i => {
        const p = panel(i.name, i.src, i.value, i.badge, { base });
        if (i.vid) p.dataset.vid = i.vid;
        grid.appendChild(p);
      });

      if (S.tab === 'scale') renderChart(c, sc);
      renderCaption(c, sc);
      applyZoom();
      applyDiff(sc);
      if (S.ab) renderAB(c, sc);
      writeHash();
    });
  }

  function renderCaption(c, sc) {
    const bits = [];
    if (c.caption) bits.push(c.caption);
    if (sc.caption) bits.push(sc.caption);
    bits.push('Scene ' + sc.id + '.');
    if (MET.name && MET.name !== 'value') {
      bits.push('Metric: ' + MET.name + (MET.unit ? ' (' + MET.unit + ')' : '') +
        ', ' + (MET.higherIsBetter ? 'higher is better' : 'lower is better') + '.');
    }
    if (sc.gain != null) bits.push('Display gain ×' + sc.gain + '.');
    if (sc.meta) {
      const m = Object.keys(sc.meta).map(k => k + ' ' + sc.meta[k]).join(', ');
      if (m) bits.push(m + '.');
    }
    $('#caption').textContent = bits.join(' ');
  }

  // ------------------------------------------------------------- chart

  function renderChart(c, sc) {
    const box = $('#chart'); box.textContent = '';
    const vs = variantsOf(c).filter(v => v.value != null);
    const pts = vs.map(v => ({ x: v.value, y: metricFor(sc, S.method, v.id), id: v.id,
      label: v.label })).filter(p => p.y != null);
    if (pts.length < 2) { box.appendChild(el('p', 'muted',
      'Not enough points to plot for this scene.')); return; }

    const curve = (c.curves || []).filter(k => k.method === S.method)
      .map(k => { const v = variantById(c, k.variant);
        return v && v.value != null ? { x: v.value, y: k.value } : null; })
      .filter(Boolean).sort((a, b) => a.x - b.x);

    const W = 680, H = 300, M = { l: 56, r: 16, t: 14, b: 42 };
    const all = pts.concat(curve);
    const base = inputMetric(sc);
    const xs = all.map(p => p.x), ys = all.map(p => p.y).concat(base == null ? [] : [base]);
    const lg = !!CH.xLog;
    const fx = v => lg ? Math.log10(Math.max(v, 1e-9)) : v;
    const x0 = Math.min.apply(null, xs.map(fx)), x1 = Math.max.apply(null, xs.map(fx));
    let y0 = Math.min.apply(null, ys), y1 = Math.max.apply(null, ys);
    const pad = (y1 - y0) * 0.12 || 1; y0 -= pad; y1 += pad;
    const X = v => M.l + (x1 === x0 ? 0.5 : (fx(v) - x0) / (x1 - x0)) * (W - M.l - M.r);
    const Y = v => H - M.b - (y1 === y0 ? 0.5 : (v - y0) / (y1 - y0)) * (H - M.t - M.b);

    const NS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
    svg.setAttribute('width', W); svg.setAttribute('height', H);
    const add = (tag, attrs, text) => {
      const n = document.createElementNS(NS, tag);
      for (const k in attrs) n.setAttribute(k, attrs[k]);
      if (text != null) n.textContent = text;
      svg.appendChild(n); return n;
    };

    add('rect', { x: 0, y: 0, width: W, height: H, fill: '#fff' });
    add('line', { x1: M.l, y1: H - M.b, x2: W - M.r, y2: H - M.b, stroke: '#d8dce2' });
    add('line', { x1: M.l, y1: M.t, x2: M.l, y2: H - M.b, stroke: '#d8dce2' });
    for (let i = 0; i <= 4; i++) {
      const v = y0 + (y1 - y0) * i / 4;
      add('line', { x1: M.l, y1: Y(v), x2: W - M.r, y2: Y(v), stroke: '#f0f2f5' });
      add('text', { x: M.l - 8, y: Y(v) + 4, 'text-anchor': 'end',
        'font-size': 11, fill: '#666c76' }, fmt(v));
    }
    pts.forEach(p => add('text', { x: X(p.x), y: H - M.b + 16, 'text-anchor': 'middle',
      'font-size': 11, fill: '#666c76' }, p.label));
    add('text', { x: (M.l + W - M.r) / 2, y: H - 6, 'text-anchor': 'middle',
      'font-size': 12, fill: '#16181d' }, AX.variant + (lg ? ' (log scale)' : ''));
    add('text', { x: 14, y: (M.t + H - M.b) / 2, 'font-size': 12, fill: '#16181d',
      transform: 'rotate(-90 14 ' + ((M.t + H - M.b) / 2) + ')',
      'text-anchor': 'middle' }, MET.name + unit);

    if (base != null) {
      add('line', { x1: M.l, y1: Y(base), x2: W - M.r, y2: Y(base),
        stroke: '#999', 'stroke-dasharray': '6 4' });
      add('text', { x: W - M.r - 4, y: Y(base) - 5, 'text-anchor': 'end',
        'font-size': 11, fill: '#777' }, 'input');
    }
    if (curve.length > 1) {
      add('polyline', { fill: 'none', stroke: '#9bb8e8', 'stroke-width': 2,
        points: curve.map(p => X(p.x) + ',' + Y(p.y)).join(' ') });
      add('text', { x: X(curve[curve.length - 1].x) - 4,
        y: Y(curve[curve.length - 1].y) - 7, 'text-anchor': 'end',
        'font-size': 11, fill: '#6f8fc4' }, 'all scenes');
    }
    const sorted = pts.slice().sort((a, b) => a.x - b.x);
    add('polyline', { fill: 'none', stroke: '#1f5fd0', 'stroke-width': 2.2,
      points: sorted.map(p => X(p.x) + ',' + Y(p.y)).join(' ') });
    sorted.forEach(p => {
      const dot = add('circle', { cx: X(p.x), cy: Y(p.y), r: 5, fill: '#1f5fd0',
        class: 'pt' });
      dot.addEventListener('click', () => {
        document.querySelectorAll('#grid .panel').forEach(n =>
          n.classList.toggle('highlight', n.dataset.vid === p.id));
      });
      const t = document.createElementNS(NS, 'title');
      t.textContent = p.label + ': ' + fmt(p.y) + unit;
      dot.appendChild(t);
    });
    box.appendChild(svg);
  }

  // ---------------------------------------------------------------- A/B

  function renderAB(c, sc) {
    const bar = $('#abbar'); bar.hidden = false;
    const opts = [];
    if (sc.input) opts.push(['input', sc.input]);
    if (S.tab === 'compare') c.methods.forEach(m => {
      const s = (sc.images[m] || {})[S.variant]; if (s) opts.push([m, s]); });
    else variantsOf(c).forEach(v => {
      const s = (sc.images[S.method] || {})[v.id]; if (s) opts.push([v.label, s]); });
    if (sc.reference) opts.push(['reference', sc.reference]);
    if (opts.length < 2) { bar.hidden = true; return; }

    [['#abA', 0], ['#abB', 1]].forEach(([sel, def]) => {
      const n = $(sel); n.textContent = '';
      opts.forEach(([label, src]) => {
        const o = el('option', '', label); o.value = src; n.appendChild(o);
      });
      const want = sel === '#abA' ? S.abA : S.abB;
      n.value = (want && opts.some(o => o[1] === want)) ? want : opts[Math.min(def, opts.length - 1)][1];
      if (sel === '#abA') S.abA = n.value; else S.abB = n.value;
      n.onchange = () => { if (sel === '#abA') S.abA = n.value; else S.abB = n.value; drawAB(); };
    });
    $('#absplit').oninput = () => { S.abSplit = Number($('#absplit').value); drawAB(); };
    $('#abclose').onclick = () => { S.ab = false; bar.hidden = true;
      const s = $('#abstage'); if (s) s.remove(); };
    drawAB();

    function drawAB() {
      let stage = $('#abstage');
      if (!stage) { stage = el('div', 'abstage'); stage.id = 'abstage';
        $('#grid').before(stage); }
      stage.textContent = '';
      stage.style.aspectRatio = '1 / 1';
      const a = el('div', 'layer'); const ia = el('img'); ia.src = S.abA; a.appendChild(ia);
      const b = el('div', 'layer'); const ib = el('img'); ib.src = S.abB; b.appendChild(ib);
      b.style.clipPath = 'inset(0 0 0 ' + S.abSplit + '%)';
      const d = el('div', 'divider'); d.style.left = S.abSplit + '%';
      stage.append(a, b, d);
    }
  }

  // --------------------------------------------------------------- save

  const SCALE = 2;                       // integer upscale for saved images

  function panelsForSave() {
    return Array.from(document.querySelectorAll('#grid .panel'))
      .filter(p => p.dataset.src);
  }

  function loadImages(srcs, done) {
    const out = {}; let left = srcs.length;
    if (!left) return done(out);
    srcs.forEach(s => {
      const im = new Image();
      im.onload = im.onerror = () => { out[s] = im.complete && im.naturalWidth ? im : null;
        if (!--left) done(out); };
      im.src = s;
    });
  }

  /** Compose the current view onto a canvas: titles, panels, caption. */
  function composeCanvas(crops, done) {
    const panels = panelsForSave();
    if (!panels.length) return done(null);
    const srcs = Array.from(new Set(panels.map(p => p.dataset.src)));
    loadImages(srcs, imgs => {
      const first = imgs[srcs[0]];
      if (!first) return done(null);
      const at = pinned || hover || { u: 0.5, v: 0.5 };
      const iw = first.naturalWidth, ih = first.naturalHeight;
      const z = crops ? (S.zoom || 4) : 1;
      const cw = Math.round(iw / z), chh = Math.round(ih / z);
      const pw = cw * SCALE, ph = chh * SCALE;

      const cols = S.tab === 'scale'
        ? Math.min(panels.length, Math.max(2, S.cols))
        : Math.min(panels.length, S.cols);
      const rows = Math.ceil(panels.length / cols);
      const PAD = 14, HEAD = 46, TITLE = 34;
      const capLines = wrapText($('#caption').textContent, 110);
      const chartSvg = (S.tab === 'scale') ? $('#chart svg') : null;
      const chartH = chartSvg ? 320 : 0;

      const W = PAD + cols * (pw + PAD);
      const H = TITLE + rows * (ph + HEAD + PAD) + chartH + capLines.length * 18 + 2 * PAD;
      const cv = document.createElement('canvas');
      cv.width = W; cv.height = H;
      const cx = cv.getContext('2d');
      cx.fillStyle = '#fff'; cx.fillRect(0, 0, W, H);
      cx.imageSmoothingEnabled = false;
      cx.fillStyle = '#16181d';
      cx.font = '600 17px system-ui, sans-serif';
      cx.textBaseline = 'top';
      const c = coll();
      cx.fillText([c.group, c.label, S.scene,
        S.tab === 'compare' ? (variantById(c, S.variant) || {}).label : S.method]
        .filter(Boolean).join(' · ') + (crops ? '  (zoom crops)' : ''), PAD, PAD);

      panels.forEach((p, i) => {
        const r = Math.floor(i / cols), col = i % cols;
        const x = PAD + col * (pw + PAD);
        const y = TITLE + r * (ph + HEAD + PAD);
        cx.fillStyle = '#16181d';
        cx.font = '600 15px system-ui, sans-serif';
        cx.fillText(p.dataset.name, x, y);
        const val = p.querySelector('.val');
        if (val) { cx.fillStyle = '#444'; cx.font = '14px system-ui, sans-serif';
          cx.fillText(val.textContent, x, y + 19); }
        const im = imgs[p.dataset.src];
        if (im) {
          const sx = crops ? Math.max(0, Math.min(iw - cw, Math.round(at.u * iw - cw / 2))) : 0;
          const sy = crops ? Math.max(0, Math.min(ih - chh, Math.round(at.v * ih - chh / 2))) : 0;
          cx.drawImage(im, sx, sy, cw, chh, x, y + HEAD - 6, pw, ph);
        }
        cx.strokeStyle = '#d8dce2';
        cx.strokeRect(x + .5, y + HEAD - 6 + .5, pw - 1, ph - 1);
      });

      const afterPanels = TITLE + rows * (ph + HEAD + PAD);
      const finish = () => {
        cx.fillStyle = '#555';
        cx.font = '14px system-ui, sans-serif';
        capLines.forEach((line, i) =>
          cx.fillText(line, PAD, afterPanels + chartH + i * 18));
        done(cv);
      };
      if (chartSvg) {
        const xml = new XMLSerializer().serializeToString(chartSvg);
        const im = new Image();
        im.onload = () => { cx.drawImage(im, PAD, afterPanels, 680, 300); finish(); };
        im.onerror = finish;
        im.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(xml);
      } else finish();
    });
  }

  function wrapText(s, n) {
    const words = (s || '').split(/\s+/); const out = []; let line = '';
    words.forEach(w => {
      if ((line + ' ' + w).trim().length > n) { out.push(line.trim()); line = w; }
      else line += ' ' + w;
    });
    if (line.trim()) out.push(line.trim());
    return out;
  }

  function saveName(suffix) {
    const c = coll();
    return [c.group, c.label, S.tab, S.scene,
      S.tab === 'compare' ? S.variant : S.method, suffix]
      .filter(Boolean).join('_')
      .replace(/[^A-Za-z0-9._-]+/g, '-').toLowerCase() + '.png';
  }

  function download(cv, name) {
    if (!cv) { note('Nothing to save in this view.'); return; }
    try {
      const url = cv.toDataURL('image/png');
      const a = document.createElement('a');
      a.href = url; a.download = name; a.click();
    } catch (e) {
      note('Saving needs pixel access to the images, which the browser blocks '
         + 'on file:// URLs. Serve the folder with "python -m http.server" '
         + 'and reload, then Save PNG works.');
    }
  }

  $('#save').onclick = () => composeCanvas(false, cv => download(cv, saveName('')));
  $('#savecrops').onclick = () => composeCanvas(true, cv => download(cv, saveName('zoom')));
  $('#copy').onclick = () => composeCanvas(false, cv => {
    if (!cv || !navigator.clipboard || !window.ClipboardItem) {
      note('This browser cannot copy images to the clipboard; use Save PNG.');
      return;
    }
    cv.toBlob(b => {
      if (!b) { note('Could not render the view for copying.'); return; }
      navigator.clipboard.write([new ClipboardItem({ 'image/png': b })])
        .then(() => note('Copied the current view to the clipboard.'))
        .catch(() => note('The browser refused clipboard access.'));
    });
  });

  // ---------------------------------------------------------- panel menu

  function openMenu(x, y, p) {
    const m = $('#menu'); m.textContent = ''; m.hidden = false;
    m.style.left = x + 'px'; m.style.top = y + 'px';
    const b = el('button', '', 'Save this panel');
    b.onclick = () => {
      m.hidden = true;
      loadImages([p.dataset.src], imgs => {
        const im = imgs[p.dataset.src];
        if (!im) return;
        const cv = document.createElement('canvas');
        cv.width = im.naturalWidth * SCALE; cv.height = im.naturalHeight * SCALE;
        const cx = cv.getContext('2d');
        cx.imageSmoothingEnabled = false;
        cx.drawImage(im, 0, 0, cv.width, cv.height);
        download(cv, saveName(p.dataset.name));
      });
    };
    m.appendChild(b);
  }
  document.addEventListener('click', ev => {
    const m = $('#menu');
    if (!m.hidden && !m.contains(ev.target)) m.hidden = true;
  });

  // ------------------------------------------------------------ controls

  $('#cols').oninput = e => { S.cols = Number(e.target.value); renderStage(); };
  $('#zoom').onchange = e => { S.zoom = Number(e.target.value); pinned = null; applyZoom(); writeHash(); };
  $('#sort').onchange = e => { S.sort = e.target.checked; renderStage(); };
  $('#showmetric').onchange = e => { S.showMetric = e.target.checked; renderStage(); };
  $('#diff').onchange = e => { S.diff = e.target.checked;
    $('#ampwrap').hidden = !S.diff; renderStage(); };
  $('#amp').oninput = e => { S.amp = Number(e.target.value); if (S.diff) renderStage(); };
  $('#search').oninput = e => { S.query = e.target.value; renderSidebar(); };
  $('#ab').onclick = () => { S.ab = !S.ab;
    if (!S.ab) { $('#abbar').hidden = true; const s = $('#abstage'); if (s) s.remove(); }
    renderStage(); };
  $('#help').onclick = () => $('#helpbox').showModal();

  document.addEventListener('keydown', ev => {
    if (/^(INPUT|SELECT|TEXTAREA)$/.test(ev.target.tagName)) return;
    if (ev.key === 'Escape') { pinned = null; applyZoom(); return; }
    const k = ev.key.toLowerCase();
    if (k === 'arrowleft') step('scene', -1);
    else if (k === 'arrowright') step('scene', 1);
    else if (k === 'arrowup') step(S.tab === 'compare' ? 'variant' : 'method', -1);
    else if (k === 'arrowdown') step(S.tab === 'compare' ? 'variant' : 'method', 1);
    else if (k === '1' || k === '2') { S.tab = k === '1' ? 'compare' : 'scale'; renderAll(); }
    else if (k === 'g') { const i = groups.indexOf(S.group);
      setGroup(groups[(i + 1) % groups.length], true); renderAll(); }
    else if (k === 'c') { const list = collsInGroup(S.group);
      const i = list.findIndex(c => c.id === S.config);
      S.config = list[(i + 1) % list.length].id; reconcile(); renderAll(); }
    else if (k === 'z') { const o = [0, 2, 4, 8];
      S.zoom = o[(o.indexOf(S.zoom) + 1) % o.length];
      $('#zoom').value = String(S.zoom); pinned = null; applyZoom(); writeHash(); }
    else if (k === 's') { ev.preventDefault();
      ev.shiftKey ? $('#savecrops').click() : $('#save').click(); }
    else return;
    ev.preventDefault();
  });

  // ------------------------------------------------------------- startup

  function renderAll() {
    renderGroups(); renderConfig(); renderTabs(); renderSidebar(); renderStage();
  }

  const h = readHash();
  setGroup(h.group || groups[0], false);
  if (h.config && byId[h.config]) { S.config = h.config; S.group = byId[h.config].group; }
  if (h.tab === 'compare' || h.tab === 'scale') S.tab = h.tab;
  reconcile();
  if (h.scene && coll().scenes.some(s => s.id === h.scene)) S.scene = h.scene;
  if (h.variant && variantById(coll(), h.variant)) S.variant = h.variant;
  if (h.method && coll().methods.includes(h.method)) S.method = h.method;
  if (h.zoom) { S.zoom = h.zoom; $('#zoom').value = String(h.zoom); }

  $('#app').hidden = false;
  renderAll();
}
