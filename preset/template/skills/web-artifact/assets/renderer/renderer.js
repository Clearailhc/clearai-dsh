/* 单文件网页制品渲染器 · 零依赖零外部请求
 *
 * 输入：window.__ARTIFACT__ —— 由生成器写进 HTML 的一段 JSON。
 * 数据无关：节点与边上除渲染必需字段（id/x/y/width/height/points）之外的一切属性，
 * 原样透传到侧栏。渲染器不规定数据里必须有什么。
 */
(function () {
  'use strict';

  var A = window.__ARTIFACT__ || {};
  var G = A.graph || { nodes: [], edges: [] };
  var NODES = G.nodes || [], EDGES = G.edges || [];
  var SVGNS = 'http://www.w3.org/2000/svg';
  var RESERVED = { id: 1, x: 1, y: 1, width: 1, height: 1, points: 1, source: 1, target: 1, labelX: 1, labelY: 1 };
  var ROLES = ['main', 'branch', 'seed', 'recycle', 'utility', 'unknown'];
  var ROLE_CN = { main: '主链', branch: '支线', seed: '晶种', recycle: '返回', utility: '公用', unknown: '存疑' };

  var byId = {};
  NODES.forEach(function (n) { byId[n.id] = n; });

  var el = function (id) { return document.getElementById(id); };
  var mk = function (tag, attrs) {
    var e = document.createElementNS(SVGNS, tag);
    for (var k in attrs) if (attrs[k] != null) e.setAttribute(k, attrs[k]);
    return e;
  };

  /* ── 视图状态：四个，各自的影响都是局部的 ── */
  var view = { x: 0, y: 0, k: 1 };
  var selected = null;
  var hiddenRoles = {};
  var notes = {};
  (A.annotations || []).forEach(function (a) { if (a && a.id) notes[a.id] = a.note; });

  /* ── 建图 ── */
  var svg = el('canvas');
  var root = mk('g');
  svg.appendChild(root);

  var bb = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
  function grow(x, y) {
    if (x < bb.x0) bb.x0 = x; if (y < bb.y0) bb.y0 = y;
    if (x > bb.x1) bb.x1 = x; if (y > bb.y1) bb.y1 = y;
  }

  var gEdges = mk('g'), gNodes = mk('g');
  root.appendChild(gEdges); root.appendChild(gNodes);

  EDGES.forEach(function (e) {
    var pts = e.points || [];
    if (pts.length < 2) return;
    var cls = 'edge' + (ROLES.indexOf(e.role) >= 0 ? ' role-' + e.role : '');
    var g = mk('g', { 'class': cls, 'data-id': e.id });
    var d = 'M' + pts.map(function (p) { return p[0] + ' ' + p[1]; }).join(' L');
    pts.forEach(function (p) { grow(p[0], p[1]); });
    g.appendChild(mk('path', { d: d, 'marker-end': 'url(#arrow)' }));
    if (e.label) {
      var t = mk('text', { x: e.labelX != null ? e.labelX : pts[pts.length >> 1][0],
                           y: e.labelY != null ? e.labelY : pts[pts.length >> 1][1],
                           'text-anchor': 'middle' });
      t.textContent = e.label;
      g.appendChild(t);
    }
    gEdges.appendChild(g);
  });

  NODES.forEach(function (n) {
    var w = n.width || 120, h = n.height || 40;
    grow(n.x, n.y); grow(n.x + w, n.y + h);
    var g = mk('g', { 'class': 'node', 'data-id': n.id, tabindex: '0', role: 'button' });
    g.appendChild(mk('rect', { x: n.x, y: n.y, width: w, height: h }));
    var hasSub = !!n.sub;
    var t = mk('text', { x: n.x + w / 2, y: n.y + h / 2 + (hasSub ? -3 : 4), 'text-anchor': 'middle' });
    t.textContent = n.label || n.id;
    g.appendChild(t);
    if (hasSub) {
      var s = mk('text', { x: n.x + w / 2, y: n.y + h / 2 + 12, 'text-anchor': 'middle', 'class': 'sub' });
      s.textContent = n.sub;
      g.appendChild(s);
    }
    g.setAttribute('aria-label', (n.label || n.id) + (hasSub ? '，' + n.sub : ''));
    gNodes.appendChild(g);
  });

  var defs = mk('defs');
  var marker = mk('marker', { id: 'arrow', viewBox: '0 0 10 10', refX: '9', refY: '5',
                              markerWidth: '6', markerHeight: '6', orient: 'auto-start-reverse' });
  marker.appendChild(mk('path', { d: 'M0 0 L10 5 L0 10 z', fill: 'context-stroke' }));
  defs.appendChild(marker);
  svg.insertBefore(defs, root);

  if (!isFinite(bb.x0)) bb = { x0: 0, y0: 0, x1: 100, y1: 100 };

  /* ── 视图变换 ── */
  function apply() {
    root.setAttribute('transform', 'translate(' + view.x + ' ' + view.y + ') scale(' + view.k + ')');
    drawViewport();
  }
  // 首次取景必须等到 SVG 真有尺寸。脚本在首次布局完成前执行时
  // getBoundingClientRect() 返回 0×0，算出来的位移是 -(x0+x1)/2，
  // 表现为「打开就偏到画布外」。
  function fit() {
    var r = svg.getBoundingClientRect();
    if (!r.width || !r.height) return false;
    var w = bb.x1 - bb.x0 + 80, h = bb.y1 - bb.y0 + 80;
    view.k = Math.min(r.width / w, r.height / h, 1.6) || 1;
    view.x = (r.width - (bb.x0 + bb.x1) * view.k) / 2;
    view.y = (r.height - (bb.y0 + bb.y1) * view.k) / 2;
    apply();
    return true;
  }

  var drag = null;
  svg.addEventListener('pointerdown', function (ev) {
    if (ev.button !== 0) return;
    drag = { x: ev.clientX, y: ev.clientY, vx: view.x, vy: view.y, moved: false };
    svg.classList.add('dragging');
    svg.setPointerCapture(ev.pointerId);
  });
  svg.addEventListener('pointermove', function (ev) {
    if (!drag) return;
    var dx = ev.clientX - drag.x, dy = ev.clientY - drag.y;
    if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true;
    view.x = drag.vx + dx; view.y = drag.vy + dy;
    apply();
  });
  svg.addEventListener('pointerup', function (ev) {
    if (drag && !drag.moved) {
      var hit = ev.target.closest ? ev.target.closest('.node, .edge') : null;
      select(hit ? hit.getAttribute('data-id') : null);
    }
    drag = null; svg.classList.remove('dragging');
  });
  svg.addEventListener('wheel', function (ev) {
    ev.preventDefault();
    var r = svg.getBoundingClientRect();
    var mx = ev.clientX - r.left, my = ev.clientY - r.top;
    var k2 = Math.min(4, Math.max(0.08, view.k * (ev.deltaY < 0 ? 1.12 : 1 / 1.12)));
    view.x = mx - (mx - view.x) * (k2 / view.k);
    view.y = my - (my - view.y) * (k2 / view.k);
    view.k = k2;
    apply();
  }, { passive: false });
  svg.addEventListener('keydown', function (ev) {
    var g = ev.target.closest && ev.target.closest('.node');
    if (g && (ev.key === 'Enter' || ev.key === ' ')) { ev.preventDefault(); select(g.getAttribute('data-id')); }
  });
  document.addEventListener('keydown', function (ev) { if (ev.key === 'Escape') select(null); });

  /* ── 选中与侧栏：任意属性原样展示 ── */
  function select(id) {
    selected = (selected === id) ? null : id;
    var neighbours = {};
    if (selected) {
      neighbours[selected] = 1;
      EDGES.forEach(function (e) {
        if (e.id === selected) { neighbours[e.source] = 1; neighbours[e.target] = 1; }
        if (e.source === selected || e.target === selected) { neighbours[e.id] = 1; neighbours[e.source] = 1; neighbours[e.target] = 1; }
      });
    }
    [].forEach.call(svg.querySelectorAll('.node, .edge'), function (g) {
      var gid = g.getAttribute('data-id');
      g.classList.toggle('selected', !!selected && gid === selected);
      g.classList.toggle('dimmed', !!selected && !neighbours[gid]);
    });
    renderSide();
  }

  function renderSide() {
    var side = el('side');
    side.textContent = '';
    if (!selected) {
      side.className = 'empty';
      side.textContent = '点选任意节点或连线查看详情；再点一次取消。';
      return;
    }
    side.className = '';
    var obj = byId[selected] || EDGES.filter(function (e) { return e.id === selected; })[0];
    if (!obj) return;
    var isEdge = !byId[selected];

    var h = document.createElement('h2');
    h.textContent = obj.label || obj.id;
    side.appendChild(h);
    var kind = document.createElement('div');
    kind.className = 'kind';
    kind.textContent = (isEdge ? '连线 ' : '节点 ') + obj.id;
    side.appendChild(kind);

    var dl = document.createElement('dl');
    if (isEdge) {
      addRow(dl, '从', (byId[obj.source] || {}).label || obj.source);
      addRow(dl, '到', (byId[obj.target] || {}).label || obj.target);
    }
    Object.keys(obj).forEach(function (k) {
      if (RESERVED[k] || k === 'label' || k === 'sub') return;
      var v = obj[k];
      if (v == null || v === '') return;
      addRow(dl, k === 'role' ? '关系' : k,
             k === 'role' ? (ROLE_CN[v] || v) : (typeof v === 'object' ? JSON.stringify(v) : String(v)),
             typeof v === 'object');
    });
    if (dl.children.length) side.appendChild(dl);

    var head = document.createElement('div');
    head.className = 'note-head';
    var lab = document.createElement('strong'); lab.textContent = '我的意见';
    var hint = document.createElement('span'); hint.textContent = '会随反馈一起导出';
    head.appendChild(lab); head.appendChild(hint);
    side.appendChild(head);

    var ta = document.createElement('textarea');
    ta.value = notes[selected] || '';
    ta.setAttribute('aria-label', '对 ' + (obj.label || obj.id) + ' 的意见');
    ta.addEventListener('input', function () {
      if (ta.value.trim()) notes[selected] = ta.value; else delete notes[selected];
      refreshCounts();
    });
    side.appendChild(ta);
  }

  function addRow(dl, k, v, mono) {
    var dt = document.createElement('dt'); dt.textContent = k;
    var dd = document.createElement('dd'); dd.textContent = v;
    if (mono) dd.className = 'mono';
    dl.appendChild(dt); dl.appendChild(dd);
  }

  /* ── 按关系类别过滤 ── */
  function buildLegend() {
    var box = el('legend');
    var present = {};
    EDGES.forEach(function (e) { if (ROLES.indexOf(e.role) >= 0) present[e.role] = 1; });
    ROLES.filter(function (r) { return present[r]; }).forEach(function (r) {
      var lab = document.createElement('label');
      var cb = document.createElement('input');
      cb.type = 'checkbox'; cb.checked = true; cb.style.marginRight = '4px';
      cb.addEventListener('change', function () {
        if (cb.checked) delete hiddenRoles[r]; else hiddenRoles[r] = 1;
        lab.classList.toggle('off', !cb.checked);
        [].forEach.call(svg.querySelectorAll('.edge.role-' + r), function (g) { g.classList.toggle('hidden', !cb.checked); });
      });
      var i = document.createElement('i');
      i.style.borderTopColor = 'var(--r-' + r + ')';
      if (r === 'recycle' || r === 'utility' || r === 'unknown') i.style.borderTopStyle = 'dashed';
      lab.appendChild(cb); lab.appendChild(i);
      lab.appendChild(document.createTextNode(ROLE_CN[r]));
      box.appendChild(lab);
    });
  }

  /* ── minimap ── */
  var mmView;
  function buildMinimap() {
    var mm = el('minimap');
    var s = mk('svg', { viewBox: (bb.x0 - 20) + ' ' + (bb.y0 - 20) + ' ' + (bb.x1 - bb.x0 + 40) + ' ' + (bb.y1 - bb.y0 + 40) });
    NODES.forEach(function (n) {
      s.appendChild(mk('rect', { 'class': 'mm-node', x: n.x, y: n.y, width: n.width || 120, height: n.height || 40, rx: 2 }));
    });
    mmView = mk('rect', { 'class': 'mm-view' });
    s.appendChild(mmView);
    mm.appendChild(s);
  }
  function drawViewport() {
    if (!mmView) return;
    var r = svg.getBoundingClientRect();
    mmView.setAttribute('x', -view.x / view.k);
    mmView.setAttribute('y', -view.y / view.k);
    mmView.setAttribute('width', r.width / view.k);
    mmView.setAttribute('height', r.height / view.k);
  }

  /* ── 入口区：数据里带了什么就报什么，形状由生成器决定 ── */
  function buildEntry() {
    var box = el('entry');
    var items = (A.entry || []).filter(function (it) { return it && it.count; });
    if (!items.length) { box.remove(); return; }
    var lead = document.createElement('span');
    lead.className = 'lead'; lead.textContent = '建议从这里开始看：';
    box.appendChild(lead);
    items.forEach(function (it) {
      var b = document.createElement('button');
      b.className = 'chip';
      b.textContent = it.label + ' ' + it.count;
      b.addEventListener('click', function () {
        var ids = it.ids || [];
        if (!ids.length) return;
        var i = (b.__i || 0) % ids.length;
        b.__i = i + 1;
        selected = null; select(ids[i]);
        focusOn(ids[i]);
      });
      box.appendChild(b);
    });
  }
  function focusOn(id) {
    var n = byId[id];
    var cx, cy;
    if (n) { cx = n.x + (n.width || 120) / 2; cy = n.y + (n.height || 40) / 2; }
    else {
      var e = EDGES.filter(function (x) { return x.id === id; })[0];
      if (!e || !e.points || !e.points.length) return;
      var mid = e.points[e.points.length >> 1];
      cx = mid[0]; cy = mid[1];
    }
    var r = svg.getBoundingClientRect();
    view.k = Math.max(view.k, 0.75);
    view.x = r.width / 2 - cx * view.k;
    view.y = r.height / 2 - cy * view.k;
    apply();
  }

  /* ── 反馈导出 ── */
  function refreshCounts() {
    var n = Object.keys(notes).length;
    var btn = el('export');
    btn.textContent = n ? '导出反馈（' + n + '）' : '导出反馈';
    btn.disabled = !n;
  }
  function exportNotes() {
    var p = A.provenance || {};
    var payload = {
      artifact: A.title || '',
      source: p.source || null,
      sourceDigest: p.digest || null,
      generatedAt: p.generatedAt || null,
      exportedAt: new Date().toISOString(),
      annotations: Object.keys(notes).map(function (id) {
        var o = byId[id] || EDGES.filter(function (e) { return e.id === id; })[0] || {};
        return { id: id, label: o.label || id, kind: byId[id] ? 'node' : 'edge', note: notes[id] };
      })
    };
    var blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'annotations.json';
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  }

  /* ── 主题：跟随系统，可手动覆盖 ── */
  function toggleTheme() {
    var cur = document.documentElement.getAttribute('data-theme');
    var next = cur === 'dark' ? 'light' : cur === 'light' ? null : 'dark';
    if (next) document.documentElement.setAttribute('data-theme', next);
    else document.documentElement.removeAttribute('data-theme');
    el('theme').setAttribute('aria-pressed', next === 'dark' ? 'true' : 'false');
  }

  /* ── 启动 ── */
  el('counts').textContent = NODES.length + ' 节点 · ' + EDGES.length + ' 连线';
  buildEntry();
  buildLegend();
  buildMinimap();
  renderSide();
  refreshCounts();
  el('fit').addEventListener('click', fit);
  el('export').addEventListener('click', exportNotes);
  el('theme').addEventListener('click', toggleTheme);

  var fitted = false;
  function tryFit() { if (!fitted && fit()) fitted = true; }
  if (window.ResizeObserver) {
    new ResizeObserver(function () { tryFit(); drawViewport(); }).observe(svg);
  } else {
    window.addEventListener('resize', function () { tryFit(); drawViewport(); });
  }
  tryFit();
  if (!fitted) requestAnimationFrame(tryFit);
  window.addEventListener('load', tryFit);

  window.__RENDERED__ = { nodes: NODES.length, edges: EDGES.length, labels: EDGES.filter(function (e) { return e.label; }).length };
})();
