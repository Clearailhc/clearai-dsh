/** Capture actual recorded sessions in the official DSH web app. No model requests. */
import assert from 'node:assert/strict'
import {readFileSync,writeFileSync,mkdirSync,mkdtempSync} from 'node:fs'
import {join,resolve} from 'node:path'
import {createHash} from 'node:crypto'
import {tmpdir} from 'node:os'
import {execFileSync} from 'node:child_process'
import {chromium} from 'playwright-core'
const [logPath,receiptPath,outPath]=process.argv.slice(2)
if(!outPath)throw new Error('Usage: node capture.mjs WEB_LOG REPLAY_RECEIPT OUTPUT_DIRECTORY')
const log=readFileSync(logPath,'utf8'),url=log.match(/http:\/\/127\.0\.0\.1:\d+\/\?token=\S+/)?.[0]
assert(url,'Official web URL required')
const receipt=JSON.parse(readFileSync(receiptPath)),out=resolve(outPath)
mkdirSync(out,{recursive:true})
const browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'/usr/bin/chromium',headless:true,args:['--no-sandbox']})
const errors=[],shots=[],checks=[]
const recordVideo=process.argv.includes('--video'),frames=[],frameDir=recordVideo?mkdtempSync(join(tmpdir(),'clearai-case-video-')):null
let cdp,video
const hash=bytes=>createHash('sha256').update(bytes).digest('hex')
const context=await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:'reduce'})
const page=await context.newPage();page.setDefaultTimeout(20000)
page.on('pageerror',error=>errors.push(error.message))
const shot=async name=>{await page.waitForTimeout(recordVideo?1800:400);const file=join(out,name+'.png');await page.screenshot({path:file});shots.push({file:name+'.png',sha256:hash(readFileSync(file)),viewport:page.viewportSize()})}
try{
 await page.goto(url,{waitUntil:'domcontentloaded'});await page.waitForTimeout(3000)
 const notice=page.getByRole('button',{name:'Continue',exact:true});if(await notice.isVisible())await notice.click()
 await page.getByText('真实任务回放 · 供应链追溯 / Recorded supply-chain case',{exact:true}).first().click()
 await page.getByText('Ontology',{exact:true}).first().click()
 await page.getByRole('heading',{name:'Knowledge map',exact:true}).scrollIntoViewIfNeeded()
 if(recordVideo){
  cdp=await context.newCDPSession(page)
  cdp.on('Page.screencastFrame',event=>{const file=join(frameDir,String(frames.length)+'.jpg');writeFileSync(file,Buffer.from(event.data,'base64'));frames.push({file,time:event.metadata.timestamp});void cdp.send('Page.screencastFrameAck',{sessionId:event.sessionId}).catch(()=>{})})
  await cdp.send('Page.startScreencast',{format:'jpeg',quality:85,maxWidth:1440,maxHeight:1000})
 }
 await shot('ontology-1440')
 await page.getByRole('button',{name:'Full screen',exact:true}).click()
 await page.getByRole('dialog',{name:'Knowledge map'}).waitFor()
 await shot('concepts-1440')
 const entities=page.getByRole('button',{name:/Entity graph/})
 if(await entities.count()){
  await entities.click();await page.getByRole('button',{name:'Overview',exact:true}).click();await shot('entities-1440')
  await page.getByRole('button',{name:'List',exact:true}).click()
  const row=page.locator('.clearai-directory-row').first()
  if(await row.count()){
   await row.focus();await page.keyboard.press('Enter')
   await page.locator('.clearai-graph-side .clearai-kv').waitFor()
   checks.push('keyboard-object-inspection');await shot('entity-detail-1440')
   const neighborhood=page.getByRole('button',{name:'Neighborhood',exact:true})
   await neighborhood.click();assert.equal(await neighborhood.getAttribute('aria-pressed'),'true')
   await page.getByRole('button',{name:'Overview',exact:true}).click()
   checks.push('related-claim-neighborhood');await shot('claim-neighborhood-1440')
  }
 }
 for(const width of [768,375]){
  await page.setViewportSize({width,height:1000});await page.waitForTimeout(300)
  await page.getByRole('button',{name:'Overview',exact:true}).click()
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Horizontal document overflow at '+width)
  checks.push('no-document-overflow-'+width);await shot('entity-detail-'+width)
 }
 await page.setViewportSize({width:1440,height:1000});await page.waitForTimeout(300)
 await page.getByRole('button',{name:'Overview',exact:true}).click();await page.emulateMedia({colorScheme:'dark'})
 await shot('entity-detail-dark-1440')
 await page.keyboard.press('Escape');await page.emulateMedia({colorScheme:'light'})
 await page.getByText('Explore',{exact:true}).first().click()
 await page.locator('.clearai-atlas').scrollIntoViewIfNeeded();await shot('research-1440')
 if(recordVideo){
  await cdp.send('Page.stopScreencast');assert(frames.length>1)
  const list=join(frameDir,'frames.txt')
  writeFileSync(list,frames.map((f,i)=>`file '${f.file}'\nduration ${Math.max(0.04,(frames[i+1]?.time??f.time+1.5)-f.time)}`).join('\n')+`\nfile '${frames.at(-1).file}'\n`)
  const file=join(out,'replay.webm')
  execFileSync('ffmpeg',['-y','-loglevel','error','-f','concat','-safe','0','-i',list,'-vf','scale=1440:1000:force_original_aspect_ratio=decrease,pad=1440:1000:(ow-iw)/2:(oh-ih)/2','-c:v','libvpx-vp9','-crf','35','-b:v','0','-pix_fmt','yuv420p',file],{timeout:60000})
  video={file:'replay.webm',sha256:hash(readFileSync(file)),frames:frames.length,kind:'Browser screencast of official DSH recorded-session replay; starts after opening Ontology.'}
 }
 assert.deepEqual(errors,[])
 assert.equal(JSON.parse(readFileSync(receiptPath)).blockedModelRequests,0,'Replay attempted model execution')
 const root=resolve(import.meta.dirname,'../..'),production={}
 for(const file of ['client.js','host.js','research-events.js'])production[file]=hash(readFileSync(join(root,'dist/clearai-dsh/lib',file)))
 writeFileSync(join(out,'provenance.json'),JSON.stringify({kind:receipt.kind,sourceReplay:receipt,production,shots,video,checks,errors,modelCalls:0,note:'Real acceptance session replayed through official DSH session seeding; captures show recorded state, not the original live execution.'},null,2)+'\n')
 console.log(JSON.stringify({passed:true,shots:shots.length,checks}))
}finally{await context.close();await browser.close()}
