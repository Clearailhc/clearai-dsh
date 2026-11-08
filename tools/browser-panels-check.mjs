/** Render production panels with explicit fixture data; verify browsing, keyboard and narrow layouts. */
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { chromium } from 'playwright-core'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const output = join(root, '.tmp-audit', 'design')
mkdirSync(output, { recursive: true })
const stage = mkdtempSync(join(tmpdir(), 'clearai-panels-'))
const labels = ['催化反应', '催化剂', '反应条件', '材料结构', '产率', '选择性', '温度', '稳定性']
const nodes = labels.map((label, i) => ({ id: `term:c${i}`, ref: `c${i}`, label, kind: 'concept', layer: 'ontology', status: 'admitted', parent: i ? `c${Math.floor((i - 1) / 3)}` : undefined, x: i * 200, y: 0 }))
const edges = nodes.slice(1).map((node, i) => ({ id: `hierarchy:${i}`, from: `term:${node.parent}`, to: node.id, layer: 'ontology', kind: 'is_a', label: '包含', status: 'admitted' }))
for (const [i, label] of ['催化剂 A', '催化剂 B', '240 °C', '产率 62%', '连续运行 48h'].entries()) nodes.push({ id: `entity:${i}`, ref: `e${i}`, label, kind: i < 2 ? 'instance' : 'literal', layer: 'entity', status: 'live', facts: ['f1'], x: i * 220, y: 180 })
for (const [i, label] of ['对照', '反应温度', '测得产率', '稳定性检验'].entries()) edges.push({ id: `assertion:${i}`, from: 'entity:0', to: `entity:${i+1}`, layer: 'entity', kind: 'assertion', fact: 'f1', label, status: i === 3 ? 'pending' : 'live' })
const fixture = {
 knowledgeFlow:{summary:{currentFacts:3,loadedFacts:7,pendingFacts:1,factAssertions:34,entityRecords:301,entityAssertions:616}},
 sessionId:'preview', goal:{id:'g1',headline:'寻找更高效、更稳定的催化路径',claim:'催化剂 A 能否在保持选择性的同时提高产率？',phase:'executing',status:'open',hypotheses:[],answers:[{question:'q1',conclusion:'催化剂 A 在当前实验条件下表现出更高的产率。',basis:['三组独立重复实验显示一致趋势；稳定性尚需长时间复核。'],open:[{effect:'当前结论尚不能外推至更高温度或长期运行。'}],decide:['是否开展下一轮中试验证？']}]},
 plan:{id:'p1',steps:[{id:'s1',ordinal:1,do:'建立基线并复核测量口径',status:'advanced'},{id:'s2',ordinal:2,do:'在两档温度下重复对照实验',status:'open'}]},
 exploration:{mode:'solve',current:'q1',areas:[],questions:[{id:'q1',text:'活性提升来自材料结构，还是反应温度？',status:'open',implicit:false,counts:{examining:2},candidates:[{id:'h1',name:'材料结构主导',claim:'活性位点密度决定产率。',state:'examining',refuteWhen:'温度控制后差异消失'},{id:'h2',name:'反应温度主导',claim:'实际温度差异造成观测优势。',state:'examining',refuteWhen:'等温条件下差异仍显著'}]},{id:'q2',text:'长期运行是否改变催化剂表面结构？',status:'open',implicit:false,counts:{examining:1},candidates:[{id:'h3',name:'表面重构',claim:'高温运行改变活性位点。',state:'examining'}]}],next:{ordinal:2,do:'在两档温度下重复对照实验',predictions:[{hypothesis:'h1',name:'材料结构主导',expect:'等温后 A 的优势仍然存在'},{hypothesis:'h2',name:'反应温度主导',expect:'等温后两者差异显著缩小'}],indistinct:false}},
 anomalies:[{id:'a1',what:'第二组高温实验出现短暂的产率回落。',status:'open',touches:[]}], facts:[],lessons:[],evidence:[],audits:[],needYou:[],lexicon:{terms:[],predicates:[],conflicts:[],problems:[],graph:{nodes,edges}},
}
const light = '--dsw-alias-bg-base:#fff;--dsw-alias-bg-layer-1:#f7f8f9;--dsw-alias-label-primary:#202525;--dsw-alias-label-primary-inverted:#fff;--dsw-alias-label-secondary:#596360;--dsw-alias-label-tertiary:#737d78;--dsw-alias-border-l1:#edf0ee;--dsw-alias-border-l2:#dfe5e1;--dsw-alias-border-l3:#c6d0c9;--dsw-alias-brand-primary:#17806e;--dsw-alias-state-warn-primary:#a46c19;--dsw-alias-state-error-primary:#b65353;--dsw-alias-interactive-bg-hover:#eef3ef;'
const dark = '--dsw-alias-bg-base:#171b19;--dsw-alias-bg-layer-1:#1c211e;--dsw-alias-label-primary:#e5eae7;--dsw-alias-label-primary-inverted:#171b19;--dsw-alias-label-secondary:#b3bfb7;--dsw-alias-label-tertiary:#96a59b;--dsw-alias-border-l1:#29312b;--dsw-alias-border-l2:#354239;--dsw-alias-border-l3:#516358;--dsw-alias-brand-primary:#70baa6;--dsw-alias-state-warn-primary:#d7ae66;--dsw-alias-interactive-bg-hover:#29372f;'
let browser, server
try {
 writeFileSync(join(stage,'entry.js'), "import * as React from 'react';import * as jsx from 'react/jsx-runtime';import {createRoot} from 'react-dom/client';window.seeds={react:React,'react/jsx-runtime':jsx};window.createRoot=createRoot")
 await build({entryPoints:[join(stage,'entry.js')],bundle:true,format:'iife',outfile:join(stage,'runtime.js'),nodePaths:[join(root,'node_modules')],logLevel:'silent'})
 writeFileSync(join(stage,'client.js'),readFileSync(join(root,'dist/clearai-dsh/lib/client.js')))
 const css=readFileSync(join(root,'ui/lib/client.js'),'utf8').split('const CSS = `')[1].split('`')[0]
 writeFileSync(join(stage,'index.html'),`<!doctype html><html lang="zh"><meta charset="utf-8"><style>:root{${light}}html,body,#root{margin:0;height:100%;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary)}*{box-sizing:border-box}${css}</style><div id="root"></div><script>window.__pending=[];window.__ModuleLoader__={load:x=>window.__pending.push(x)}</script><script src="/runtime.js"></script><script src="/client.js"></script><script src="/probe.js"></script></html>`)
 writeFileSync(join(stage,'probe.js'),`
const React=window.seeds.react, h=React.createElement;
const api=window.__pending.find(x=>x.id==='clearai-dsh').factory(name=>{if(window.seeds[name])return window.seeds[name];throw Error(name)});
const dictionaries={};window.language='zh';
const locale={register:(ns,rows)=>{dictionaries[ns]=rows;return ()=>{}},bind:ns=>key=>dictionaries[ns]?.[window.language]?.[key]??key};
api.apply({get:name=>name==='locale'?locale:undefined,effect:fn=>fn(),on:(name,fn)=>{window.localeChange=fn;return ()=>{}},slots:{inject:()=>()=>{}},sessions:{list:{getSnapshot:()=>({byId:{}}),subscribe:()=>()=>{}}},sidebarRight:{}});
const fixture=${JSON.stringify(fixture)};window.fixture=fixture;
const root=window.createRoot(document.getElementById('root'));
function GraphPreview({data}){const[layer,onLayer]=React.useState('ontology');const[full,setFull]=React.useState(false);return h(api.__components.GraphBand,{lexicon:data.lexicon,data,layer,onLayer,fullscreen:full,onToggleFullscreen:()=>setFull(x=>!x),onFilter:()=>{},sessionId:'preview'})}
window.renderPanel=(name,data=fixture)=>root.render(name==='map'?h(GraphPreview,{key:name,data}):h(api.__components[name],{key:name,useProjection:()=>data,sessionId:'preview',send:()=>true}));
window.renderPanel('Atlas');
`)
 server=createServer((req,res)=>{
  const route=new URL(req.url,'http://localhost').pathname
  if(route==='/api/clearai/inspector') {res.setHeader('Content-Type','application/json');res.end(JSON.stringify({ok:true,found:true,inspector:{definition:{gloss:'用于描述催化体系中的结构与关联。此定义本身不等于已验证的事实。',basis:'研究记录中的概念定义'},relations:{},facts:[]}}));return}
  const file=join(stage,route==='/'?'index.html':route.slice(1))
  if(!existsSync(file)){res.writeHead(404);res.end();return}
  res.setHeader('Content-Type',file.endsWith('.html')?'text/html':'application/javascript');res.end(readFileSync(file))
 })
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
 browser=await chromium.launch({executablePath:process.env.CHROME_PATH??'/usr/bin/chromium',headless:true,args:['--no-sandbox']})
 const page=await browser.newPage({viewport:{width:1440,height:1050}})
 const errors=[];page.on('pageerror',error=>errors.push(error.message))
 const contrasts=[]
 const measureContrast=async(theme)=>contrasts.push({theme,...await page.evaluate(()=>{
  const rgb=s=>s.match(/[\d.]+/g)?.map(Number)??[0,0,0]
  const luminance=c=>c.slice(0,3).map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4}).reduce((n,v,i)=>n+v*[.2126,.7152,.0722][i],0)
  const rows=[...document.querySelectorAll('.clearai-atlas button,.clearai-atlas p,.clearai-atlas h1,.clearai-atlas h2,.clearai-atlas input')].filter(e=>e.getClientRects().length && !e.disabled).map(e=>{
   let bg=[255,255,255];for(let a=e;a;a=a.parentElement){const c=rgb(getComputedStyle(a).backgroundColor);if(c.length===3||c[3]===1){bg=c;break}}
   const fg=rgb(getComputedStyle(e).color),a=luminance(fg),b=luminance(bg)
   return {element:e.tagName,className:e.className,text:e.textContent.slice(0,30),fg,bg,role:e.getAttribute('aria-label'),ratio:(Math.max(a,b)+.05)/(Math.min(a,b)+.05)}
  });return {samples:rows.length,minimum:Math.min(...rows.map(r=>r.ratio)),below45:rows.filter(r=>r.ratio<4.5)}
 })})

 await page.goto(`http://127.0.0.1:${server.address().port}`)
 const settle=async()=>{
  await page.waitForFunction(()=>document.querySelector('.react-flow__node')?.getBoundingClientRect().width>0)
  await page.evaluate(()=>{window.lastViewport=null;window.stableFrames=0})
  await page.waitForFunction(()=>{const value=document.querySelector('.react-flow__viewport')?.getAttribute('style');window.stableFrames=window.lastViewport===value?(window.stableFrames??0)+1:0;window.lastViewport=value;return window.stableFrames>=10},undefined,{polling:'raf'})
 }
 await settle()
 await page.getByText('本目标事实 3', {exact:false}).waitFor()
 for(const width of [375,768,1440]){await page.setViewportSize({width,height:1050});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Knowledge summary must wrap within viewport')}
 await measureContrast('light')
 await page.screenshot({animations:'disabled',path:join(output,'ontology-desktop.png'),fullPage:true})
 await page.evaluate(()=>window.renderPanel('ExploreView'))
 await page.getByText('研究工作台',{exact:true}).waitFor()
 await page.screenshot({animations:'disabled',path:join(output,'research-desktop.png'),fullPage:true})
 for(const width of [375,768]){
  await page.setViewportSize({width,height:900})
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Research must not overflow')
  await page.screenshot({animations:'disabled',path:join(output,`research-${width}.png`),fullPage:true})
 }
 await page.setViewportSize({width:1280,height:900});await page.evaluate(()=>window.renderPanel('map'));await settle()
 // Search and keyboard-select a node; opening details must preserve scale on subsequent selections.
 await page.getByRole('textbox',{name:'搜索图谱'}).fill('选择性')
 await page.getByRole('button',{name:/选择性.*概念/}).focus();await page.keyboard.press('Enter')
 await page.getByRole('button',{name:'关闭',exact:true}).waitFor()
 assert.equal(await page.getByRole('textbox',{name:'搜索图谱'}).inputValue(),'')
 await page.getByRole('button',{name:'邻域',exact:true}).click()
 assert.equal(await page.getByRole('button',{name:'邻域',exact:true}).getAttribute('aria-pressed'),'true')
 await page.getByRole('button',{name:/实体图/}).click();await settle()
 assert(await page.locator('.clearai-star[data-kind="instance"]').count()>0,'Entity layer renders concrete objects')
 assert(await page.evaluate(()=>{const c=document.querySelector('.clearai-graph-canvas').getBoundingClientRect();return [...document.querySelectorAll('.react-flow__node')].every(node=>{const r=node.getBoundingClientRect();return r.left>=c.left&&r.right<=c.right&&r.top>=c.top&&r.bottom<=c.bottom})}),'Small entity graph fits after switching from a focused ontology node')
 await page.screenshot({animations:'disabled',path:join(output,'entities-desktop.png')})
 await page.getByRole('button',{name:'列表',exact:true}).click()
 assert.equal(await page.locator('.clearai-directory-row').count(),5)
 await page.getByRole('button',{name:/催化剂 A.*实例/}).click()
 await page.getByRole('button',{name:'全屏',exact:true}).click()
 await page.setViewportSize({width:375,height:900})
 await page.getByRole('dialog').waitFor()
 await page.waitForFunction(()=>document.querySelector('.clearai-graph-side')?.getBoundingClientRect().right<=innerWidth)
 const rects=await page.evaluate(()=>({canvas:document.querySelector('.clearai-graph-canvas').getBoundingClientRect().toJSON(),side:document.querySelector('.clearai-graph-side').getBoundingClientRect().toJSON()}))
 assert(rects.canvas.width>=350,'Narrow details must not shrink the canvas')
 assert(rects.side.width<=375,'Details stay inside viewport')
 await page.screenshot({animations:'disabled',path:join(output,'map-mobile-details.png')})
 await page.keyboard.press('Escape');await page.waitForFunction(()=>!document.querySelector('[role="dialog"]'))
 await page.setViewportSize({width:1280,height:900});await page.evaluate(()=>window.renderPanel('Atlas'));await settle()
 // Data updates and inspection do not reset the user's chosen viewport.
 await page.getByRole('button',{name:'概览',exact:true}).click()
 await page.waitForFunction(()=>{const value=document.querySelector('.react-flow__viewport')?.getAttribute('style');window.stableFrames=window.lastViewport===value?(window.stableFrames??0)+1:0;window.lastViewport=value;return window.stableFrames>=8},undefined,{polling:'raf'})
 const before=await page.locator('.react-flow__viewport').getAttribute('style')
 await page.evaluate(()=>document.querySelector('.react-flow__node')?.dispatchEvent(new MouseEvent('click',{bubbles:true})))
 await page.getByRole('button',{name:'关闭',exact:true}).waitFor()
 assert.equal(await page.locator('.react-flow__viewport').getAttribute('style'),before,'Inspection must not reset viewport')
 await page.getByRole('button',{name:'关闭',exact:true}).click()
 await page.addStyleTag({content:':root{'+dark+'}'})
 await page.waitForTimeout(200)
 await measureContrast('dark')
 await page.screenshot({animations:'disabled',path:join(output,'ontology-dark.png'),fullPage:true})
 await page.addStyleTag({content:':root{'+light+'}'})
 await page.evaluate(()=>window.renderPanel('ExploreView'))
 await page.getByText('研究工作台',{exact:true}).waitFor()
 await page.evaluate(()=>{
  const nodes=Array.from({length:50},(_,i)=>({id:'term:d'+i,ref:'d'+i,label:'研究方法 '+i+'：适用条件与证据范围',kind:'concept',layer:'ontology',x:(i%10)*260,y:Math.floor(i/10)*120}));
  const edges=nodes.slice(1).map((node,i)=>({id:'dense:'+i,from:nodes[i].id,to:node.id,layer:'ontology',kind:'predicate',label:'关联'}));
  window.renderPanel('map',{...window.fixture,lexicon:{graph:{nodes,edges},conflicts:[]}})
 })
 await settle()
 await page.waitForFunction(()=>parseFloat(document.querySelector('.react-flow__viewport').style.transform.match(/scale\(([^)]+)/)?.[1]??0)>=0.8)
 assert.equal(await page.locator('.react-flow__node').count(),50,'No silent truncation in dense graph')
 await page.screenshot({animations:'disabled',path:join(output,'dense-readable.png')})
 await page.getByRole('textbox',{name:'搜索图谱'}).fill('研究方法 49')
 assert.equal(await page.locator('.clearai-directory-row').count(),1,'Dense graph search reaches off-screen nodes')
 await page.locator('.clearai-directory-row').click()
 await page.getByRole('button',{name:'关闭',exact:true}).waitFor()
 await page.waitForFunction(()=>{const r=document.querySelector('.react-flow__node.selected')?.getBoundingClientRect();return r&&r.x>=0&&r.right<=innerWidth})
 await page.evaluate(()=>{window.language='en';window.localeChange();window.renderPanel('ExploreView')})
 await page.getByText('Research workspace',{exact:true}).waitFor()
 for(const width of [375,768,1440]) {await page.setViewportSize({width,height:1000});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'English layout must not overflow')}
 await page.evaluate(()=>window.renderPanel('Atlas'))
 await page.getByText('Facts from this goal 3',{exact:false}).waitFor()
 for(const width of [375,768,1440]){await page.setViewportSize({width,height:1000});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'English knowledge summary must wrap')}
 const started=Date.now()
 await page.evaluate(()=>{
  const nodes=Array.from({length:200},(_,i)=>({id:'term:s'+i,ref:'s'+i,label:'Long research concept '+i+' with applicability boundaries',kind:'concept',layer:'ontology'}));
  const edges=nodes.slice(1).map((node,i)=>({id:'stress:'+i,from:nodes[i].id,to:node.id,layer:'ontology',kind:'predicate',label:'relates to'}));
  edges.push({id:'self',from:nodes[0].id,to:nodes[0].id,layer:'ontology',kind:'predicate',label:'self relation'},{id:'reverse',from:nodes[1].id,to:nodes[0].id,layer:'ontology',kind:'predicate',label:'reverse relation'});
  window.stress={...window.fixture,lexicon:{graph:{nodes,edges},conflicts:[]}};window.renderPanel('map',window.stress)
 })
 await settle();assert.equal(await page.locator('.react-flow__node').count(),200)
 const stressInteractiveMs=Date.now()-started
 assert.equal(await page.locator('.react-flow__edge-relationship').count(),3,'Self and reciprocal relationships remain distinct')
 const edge=page.locator('.react-flow__edge[data-id="self"]');await edge.focus();await page.keyboard.press('Enter');await page.getByRole('button',{name:'Close',exact:true}).waitFor();await page.getByRole('button',{name:'Close',exact:true}).click()
 const update=await page.evaluate(async()=>{
  let removed=0;const observer=new MutationObserver(rows=>{for(const row of rows)for(const n of row.removedNodes)if(n.nodeType===1&&(n.matches('.react-flow__node,.react-flow__edge')||n.querySelector('.react-flow__node,.react-flow__edge')))removed++});observer.observe(document.querySelector('.react-flow'),{childList:true,subtree:true});
  const at=performance.now();for(let i=0;i<30;i++){window.renderPanel('map',{...window.stress});await new Promise(requestAnimationFrame)}observer.disconnect();return {removed,elapsedMs:performance.now()-at}
 });assert.equal(update.removed,0,'Repeated projection updates must not remount graph nodes or edges')
 await page.screenshot({animations:'disabled',path:join(output,'stress-200-en.png')})
 assert.deepEqual(errors,[],'No browser runtime errors')
 assert.ok(contrasts.length===2&&contrasts.every(row=>row.samples>0&&row.minimum>=4.5),'Sampled body/control text must meet 4.5:1 contrast in both themes')
 writeFileSync(join(output,'checks.json'),JSON.stringify({passed:true,fixture:true,contrasts,narrowDetails:rects,stressInteractiveMs,projectionUpdates:update},null,2))
 console.log('PASS: panel render, research widths, graph search, keyboard selection, neighborhood, entity layer, list browsing, fullscreen, narrow details, Escape, dark theme, stable viewport, dense graph search. Screenshots: '+output)
} finally {
 await browser?.close()
 if(server)await new Promise(resolve=>server.close(resolve))
 rmSync(stage,{recursive:true,force:true})
}
