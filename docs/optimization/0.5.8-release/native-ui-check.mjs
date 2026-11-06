// Read-only historical replay in a disposable DSH UI profile; model calls must be disabled.
import assert from 'node:assert/strict'
import {chromium} from 'playwright-core'
import {readFileSync,writeFileSync} from 'node:fs'
const url=readFileSync(process.argv[2]??'/tmp/058-web.log','utf8').match(/http:\/\/127\.0\.0\.1:3080\/\?token=\S+/)?.[0]
const browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox']})
const page=await browser.newPage({viewport:{width:1440,height:1000}})
await page.goto(url);await page.waitForTimeout(2000)
if(await page.getByRole('button',{name:'Continue',exact:true}).isVisible())await page.getByRole('button',{name:'Continue',exact:true}).click()
await page.getByText(/Untitled|JEPA historical replay · 0.5.8/).first().click()
await page.getByText('Ontology',{exact:true}).waitFor()
const errors=[];page.on('pageerror',e=>errors.push(e.message))
const checks=[]
for(const panel of ['Explore','Ontology']){
 await page.setViewportSize({width:1440,height:1000});await page.getByText(panel,{exact:true}).click();await page.locator('.clearai-atlas').waitFor()
 for(const width of [375,768,1440]){await page.setViewportSize({width,height:1000});await page.waitForTimeout(150);assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));checks.push(panel+'-'+width)}
}
const buttons=name=>page.getByRole('button',{name,exact:true})
await page.getByRole('textbox',{name:'Search the graph'}).fill('jepa')
await page.locator('.clearai-directory-row').first().focus();await page.keyboard.press('Enter')
await buttons('Close').waitFor();await page.locator('.clearai-graph-side .clearai-kv').waitFor();checks.push('keyboard-search-details')
await buttons('Neighborhood').click();assert.equal(await buttons('Neighborhood').getAttribute('aria-pressed'),'true');checks.push('neighborhood')
await page.getByRole('button',{name:/Entity graph/}).click()
await buttons('List').click();await page.locator('.clearai-directory-row').first().click();await page.locator('.clearai-graph-side .clearai-kv').waitFor();checks.push('entity-list-details')
await buttons('Close').click()
const edge=page.locator('.react-flow__edge').first();await edge.focus();await page.keyboard.press('Enter');await page.locator('.clearai-graph-side .clearai-kv').waitFor();checks.push('keyboard-edge-details');await buttons('Close').click()
const viewport=()=>page.locator('.react-flow__viewport').getAttribute('style')
const beforeZoom=await viewport();await buttons('Zoom in').click();await page.waitForTimeout(350);assert.notEqual(await viewport(),beforeZoom);await buttons('Zoom out').click();checks.push('zoom')
await buttons('List').click()
let delayed=0
await page.route('**/api/clearai/inspector?*',async route=>{const response=await route.fetch();if(delayed++===0)await new Promise(r=>setTimeout(r,400));try{await route.fulfill({response})}catch{}})
await page.locator('.clearai-directory-row').first().click();await buttons('List').click()
const second=page.locator('.clearai-directory-row').nth(1),label=await second.locator('strong').innerText();await second.click()
await page.waitForTimeout(700);assert(delayed>=2);assert.equal(await page.locator('.clearai-graph-side .clearai-card-title').innerText(),label);await page.unroute('**/api/clearai/inspector?*');checks.push('async-detail-race')
await buttons('Close').click()
const nodeId=await page.evaluate(()=>{const c=document.querySelector('.clearai-graph-canvas').getBoundingClientRect();return [...document.querySelectorAll('.react-flow__node')].find(n=>{const r=n.getBoundingClientRect();return r.left>c.left+5&&r.right<c.right-5&&r.top>c.top+5&&r.bottom<c.bottom-5})?.getAttribute('data-id')})
assert(nodeId);
const target=page.locator('.react-flow__node').all();let dragged
for(const candidate of await target)if(await candidate.getAttribute('data-id')===nodeId){dragged=candidate;break}
const beforeDrag=await dragged.getAttribute('style'),box=await dragged.boundingBox();await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();await page.mouse.move(box.x+box.width/2+35,box.y+box.height/2+25,{steps:6});await page.mouse.up();await page.waitForTimeout(250);assert.notEqual(await dragged.getAttribute('style'),beforeDrag);checks.push('node-drag')
await buttons('Full screen').click();await page.getByRole('dialog',{name:'Knowledge map'}).waitFor()
await page.setViewportSize({width:375,height:900});await buttons('List').click();await page.locator('.clearai-directory-row').first().click();await page.locator('.clearai-graph-side .clearai-kv').waitFor()
const geometry=await page.evaluate(()=>({canvas:document.querySelector('.clearai-graph-canvas').getBoundingClientRect().toJSON(),side:document.querySelector('.clearai-graph-side').getBoundingClientRect().toJSON()}))
assert(geometry.canvas.width>=350);assert(geometry.side.right<=375);checks.push('narrow-fullscreen-details')
await page.keyboard.press('Escape');await page.waitForFunction(()=>!document.querySelector('.clearai-graph[role="dialog"]'));checks.push('escape')
await page.setViewportSize({width:1440,height:1000});await page.emulateMedia({colorScheme:'dark'});await page.waitForTimeout(300)
await page.screenshot({path:new URL('native-jepa-dark-details.png',import.meta.url).pathname})
assert.deepEqual(errors,[])
writeFileSync(new URL('native-ui-result.json',import.meta.url).pathname,JSON.stringify({passed:true,kind:'historical-replay-in-native-DSH',checks,geometry,errors},null,2))
console.log(JSON.stringify({passed:true,checks}))
await browser.close()
