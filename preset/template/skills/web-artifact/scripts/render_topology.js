#!/usr/bin/env node
/* 拓扑检查件生成器 —— ELK 算几何，原生 SVG 渲染，产出零外部请求的单文件 HTML。
 *
 *   node render_topology.js --elk-input in.json --out topology.html --title "流程拓扑检查"
 *   node render_topology.js --elk-output laid-out.json --out topology.html
 *
 * 数据无关：节点与边上除 ELK 必需字段之外的属性原样透传给渲染器，有就在侧栏展示。
 * 本脚本不要求输入数据带任何自定义字段。
 */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const VERSION = '1.0.0';
const HERE = __dirname;
const ASSETS = path.join(HERE, '..', 'assets');

function parseArgs(argv) {
  const out = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith('--')) { out[key] = next; i++; } else { out[key] = true; }
  }
  return out;
}

function usage() {
  console.log([
    '用法：',
    '  --elk-input <file>    ELK 输入 JSON；给了就先在本地跑 elkjs',
    '  --elk-output <file>   ELK 输出 JSON；作为输入时直接渲染，作为输出时留盘备查',
    '  --out <file>          产出的 HTML（必填）',
    '  --title <text>        页面标题',
    '  --source <path>       源数据路径，用于页脚自陈来历并算摘要',
    '  --proves <text>       这份东西证明了什么',
    '  --not-proves <text>   它不证明什么',
    '  --annotations <file>  预置已有标注，形状同导出的 annotations.json',
    '',
    'ELK 输入与输出都留盘，是为了让布局问题与渲染问题能分开定位。'
  ].join('\n'));
}

/* ── ELK：只在本地 vendor 里找，不下载 ── */
async function runElk(input) {
  const bundle = path.join(ASSETS, 'vendor', 'elkjs', 'elk.bundled.js');
  if (!fs.existsSync(bundle)) {
    throw new Error('缺少 ' + bundle + '（见同目录 UPSTREAM.md 的获取步骤）');
  }
  const ELK = require(bundle);
  return new ELK().layout(input);
}

/* ── ELK 输出 → 渲染器数据 ── */
const NODE_RESERVED = new Set(['id', 'x', 'y', 'width', 'height', 'labels', 'properties', 'layoutOptions', 'children', 'ports', 'edges']);
const EDGE_RESERVED = new Set(['id', 'sources', 'targets', 'sections', 'labels', 'properties', 'source', 'target', 'container', 'junctionPoints']);
const ROLES = new Set(['main', 'branch', 'seed', 'recycle', 'utility', 'unknown']);

function labelOf(o, i) {
  if (!o) return undefined;
  if (i === 0 && typeof o.label === 'string') return o.label;
  if (i === 1 && typeof o.sub === 'string') return o.sub;
  const L = o.labels || [];
  return L[i] && typeof L[i].text === 'string' ? L[i].text : undefined;
}

function passthrough(obj, reserved) {
  const extra = {};
  Object.keys(obj || {}).forEach(k => {
    if (reserved.has(k) || k === 'label' || k === 'sub') return;
    if (k.charAt(0) === '$') return;              // elkjs 转译产物的内部字段
    const v = obj[k];
    if (v == null || typeof v === 'function') return;
    extra[k] = v;
  });
  Object.keys((obj && obj.properties) || {}).forEach(k => {
    const v = obj.properties[k];
    if (v == null) return;
    if (typeof k === 'string' && k.indexOf('elk.') === 0) return;   // ELK 自己的布局属性不外泄
    extra[k] = v;
  });
  return extra;
}

function edgePoints(edge) {
  const s = (edge.sections || [])[0];
  if (!s) return [];
  const pts = [];
  if (s.startPoint) pts.push([s.startPoint.x, s.startPoint.y]);
  (s.bendPoints || []).forEach(p => pts.push([p.x, p.y]));
  if (s.endPoint) pts.push([s.endPoint.x, s.endPoint.y]);
  return pts;
}

function toGraph(layout) {
  const nodes = (layout.children || []).map(c => {
    const n = {
      id: c.id,
      x: c.x || 0, y: c.y || 0,
      width: c.width || 120, height: c.height || 40,
      label: labelOf(c, 0) || c.id
    };
    const sub = labelOf(c, 1);
    if (sub) n.sub = sub;
    Object.assign(n, passthrough(c, NODE_RESERVED));
    return n;
  });

  const edges = (layout.edges || []).map(e => {
    const props = e.properties || {};
    // 显式声明的 role 才采用。缺失时不伪造 unknown——「作者说不确定」与
    // 「这张图不用 role 语义」是两回事，混为一谈会把极简图全报成存疑。
    const role = ROLES.has(props.role) ? props.role : (ROLES.has(e.role) ? e.role : null);
    const o = {
      id: e.id,
      source: (e.sources || [e.source])[0],
      target: (e.targets || [e.target])[0],
      points: edgePoints(e)
    };
    if (role) o.role = role;
    const lab = (e.labels || [])[0];
    const text = labelOf(e, 0);
    if (text) {
      o.label = text;
      if (lab && lab.x != null) {
        o.labelX = lab.x + (lab.width || 0) / 2;
        o.labelY = lab.y + (lab.height || 0) / 2 + 3;
      }
    }
    Object.assign(o, passthrough(e, EDGE_RESERVED));
    if (role) o.role = role; else delete o.role;
    return o;
  });

  return { nodes, edges };
}

/* 入口区：只用契约内已有的语义（role=unknown），不引入新字段。
   数据里自带 entry 时以数据为准。 */
function buildEntry(src, graph) {
  if (Array.isArray(src.entry)) return src.entry;
  const unknown = graph.edges.filter(e => e.role === 'unknown').map(e => e.id);   // 只算显式声明的
  const items = [];
  if (unknown.length) items.push({ label: '关系存疑', count: unknown.length, ids: unknown });
  const isolated = graph.nodes
    .filter(n => !graph.edges.some(e => e.source === n.id || e.target === n.id))
    .map(n => n.id);
  if (isolated.length) items.push({ label: '孤立节点', count: isolated.length, ids: isolated });
  return items;
}

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function html(payload, title) {
  const css = fs.readFileSync(path.join(ASSETS, 'renderer', 'renderer.css'), 'utf8');
  const js = fs.readFileSync(path.join(ASSETS, 'renderer', 'renderer.js'), 'utf8');
  const p = payload.provenance || {};
  const data = JSON.stringify(payload).replace(/</g, '\\u003c');

  const foot = [
    p.source ? '<b>源数据</b> ' + esc(p.source) + (p.digest ? ' · ' + esc(p.digest) : '') : '',
    p.generatedAt ? '<b>生成于</b> ' + esc(p.generatedAt) : '',
    '<b>生成器</b> render_topology ' + esc(p.generator || VERSION)
  ].filter(Boolean).join(' &nbsp;·&nbsp; ');

  const claims = [
    p.proves ? '<b>证明</b>：' + esc(p.proves) : '',
    p.doesNotProve ? '<b>不证明</b>：' + esc(p.doesNotProve) : ''
  ].filter(Boolean).join('　');

  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<style>
${css}
</style>
</head>
<body>
<header>
  <h1>${esc(title)}</h1>
  <span class="counts" id="counts"></span>
  <span class="spacer"></span>
  <button class="chip" id="fit">适应窗口</button>
  <button class="chip" id="export" disabled>导出反馈</button>
  <button class="chip" id="theme" aria-pressed="false">深色</button>
</header>
<div id="entry"></div>
<main>
  <div id="stage">
    <svg id="canvas" aria-label="${esc(title)}"></svg>
    <div id="minimap" aria-hidden="true"></div>
  </div>
  <aside id="side" class="empty"></aside>
</main>
<div class="legend" id="legend"></div>
<footer>
  ${foot}
  ${claims ? '<div class="claims">' + claims + '</div>' : ''}
</footer>
<script id="artifact-data" type="application/json">${data}</script>
<script>
window.__ARTIFACT__ = JSON.parse(document.getElementById('artifact-data').textContent);
${js}
</script>
</body>
</html>
`;
}

async function main() {
  const args = parseArgs(process.argv);
  if (args.help || (!args['elk-input'] && !args['elk-output']) || !args.out) { usage(); return 1; }

  let layout;
  if (args['elk-input']) {
    const input = JSON.parse(fs.readFileSync(args['elk-input'], 'utf8'));
    layout = await runElk(input);
    if (args['elk-output'] && typeof args['elk-output'] === 'string') {
      fs.writeFileSync(args['elk-output'], JSON.stringify(layout, null, 2));
    }
  } else {
    layout = JSON.parse(fs.readFileSync(args['elk-output'], 'utf8'));
  }

  const srcRaw = args['elk-input'] ? JSON.parse(fs.readFileSync(args['elk-input'], 'utf8')) : layout;
  const graph = toGraph(layout);

  const provenance = { generatedAt: new Date().toISOString(), generator: VERSION };
  if (typeof args.source === 'string') {
    provenance.source = args.source;
    if (fs.existsSync(args.source)) {
      provenance.digest = 'sha256:' + crypto.createHash('sha256')
        .update(fs.readFileSync(args.source)).digest('hex').slice(0, 12);
    }
  }
  if (typeof args.proves === 'string') provenance.proves = args.proves;
  if (typeof args['not-proves'] === 'string') provenance.doesNotProve = args['not-proves'];

  let annotations = [];
  if (typeof args.annotations === 'string' && fs.existsSync(args.annotations)) {
    const a = JSON.parse(fs.readFileSync(args.annotations, 'utf8'));
    annotations = Array.isArray(a) ? a : (a.annotations || []);
  }

  const title = typeof args.title === 'string' ? args.title : '拓扑检查';
  const payload = { title, provenance, graph, entry: buildEntry(srcRaw, graph), annotations };

  fs.writeFileSync(args.out, html(payload, title));
  const noRole = graph.edges.filter(e => !e.role).length;
  if (noRole) {
    console.log('提示：' + noRole + '/' + graph.edges.length +
      ' 条边没有声明 properties.role，已按中性样式渲染。' +
      '工业流程拓扑里这通常是缺陷，见 references/when-drawing-a-topology.md。');
  }
  console.log('已生成 ' + args.out +
    '（' + graph.nodes.length + ' 节点 / ' + graph.edges.length + ' 连线 / ' +
    (fs.statSync(args.out).size / 1024).toFixed(0) + ' KB）');
  return 0;
}

main().then(c => process.exit(c || 0)).catch(e => { console.error(String(e && e.message || e)); process.exit(1); });
