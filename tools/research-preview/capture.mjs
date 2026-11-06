import { chromium } from 'playwright-core'
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
const root = new URL('../../', import.meta.url).pathname
const version = JSON.parse(readFileSync(root + 'package.json')).version
const output = process.env.CLEARAI_PREVIEW_OUTPUT || root + `docs/optimization/${version}/`
const previewLog = process.env.CLEARAI_PREVIEW_LOG || '/tmp/clearai-preview.log'
const log = readFileSync(previewLog, 'utf8')
const previewHome = log.match(/Isolated example profile: (.+)/)?.[1]
assert.ok(previewHome, 'Preview home must be recorded by the launcher')
const hashes = {}
for (const name of ['client.js', 'host.js', 'research-events.js']) {
  const source = readFileSync(root + 'dist/clearai-dsh/lib/' + name)
  assert.deepEqual(source, readFileSync(previewHome + '/profiles/web/node_modules/clearai-dsh/lib/' + name))
  hashes[name] = createHash('sha256').update(source).digest('hex')
}
mkdirSync(output, { recursive: true })
let url
for (let attempt = 0; attempt < 50 && !url; attempt++) {
  try { url = readFileSync(previewLog, 'utf8').match(new RegExp('http://127\\.0\\.0\\.1:' + (process.env.CLEARAI_PREVIEW_PORT || '3091') + '/\\?token=\\S+'))?.[0] } catch {}
  if (!url) await new Promise(resolve => setTimeout(resolve, 200))
}
if (!url) throw new Error('Preview URL not available')
const browser = await chromium.launch({ executablePath: '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] })
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, recordVideo: { dir: output + 'video', size: { width: 1440, height: 1000 } } })
const page = await context.newPage()
page.setDefaultTimeout(10000)
const errors = []
const errorStacks = []
const consoleErrors = []
page.on('websocket', socket => socket.on('framereceived', frame => { const payload = String(frame.payload); if (/error|welcomeNoticeVersion/.test(payload)) console.log('WS', payload.slice(0, 1800)) }))
page.on('pageerror', error => { errors.push(error.message); errorStacks.push(error.stack) })
page.on('console', message => { if (message.type() === 'error') { consoleErrors.push(message.text()); console.log('Browser error:', message.text().slice(0, 600)) } })
page.on('response', response => { if (response.status() >= 400) console.log('HTTP', response.status(), new URL(response.url()).pathname) })
await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 })
console.log('Loaded DSH')
await page.waitForTimeout(4000)
if (await page.getByText('Continue', { exact: true }).count()) await page.getByText('Continue', { exact: true }).click()
await page.waitForTimeout(1500)
await page.screenshot({ path: output + 'dsh-after-notice.png' })
console.log('Session list', (await page.locator('body').innerText()).slice(0, 900))
await page.getByText(/^(Untitled|比较客户流失差异|示例回放.*)$/).first().click()
await page.waitForTimeout(3000)
await page.locator('.clearai-research-event').first().waitFor()
await page.screenshot({ path: output + 'dsh-hypothesis-1440.png' })
const timings = []
for (let index = 2; index <= 8; index++) {
  const start = Date.now()
  await page.getByRole('button', { name: '播放下一事件 / Next event', exact: true }).last().click()
  await page.getByText(`示例回放 / Example replay · 无模型调用 · ${index}/8`, { exact: true }).waitFor()
  timings.push(Date.now() - start)
  await page.waitForTimeout(700)
  if (index === 5) await page.screenshot({ path: output + 'dsh-intervention-1440.png' })
}
await page.screenshot({ path: output + 'dsh-outcome-1440.png' })
await page.locator('.clearai-research-event summary').last().click()
await page.screenshot({ path: output + 'dsh-details-1440.png' })
for (const width of [768, 375]) {
  await page.setViewportSize({ width, height: 1000 })
  await page.waitForTimeout(500)
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
  await page.screenshot({ path: output + `dsh-outcome-${width}.png` })
}
await page.setViewportSize({ width: 1440, height: 1000 })
await page.reload()
await page.getByText('示例回放 / Example replay · 无模型调用 · 8/8', { exact: true }).waitFor()
assert.equal(await page.locator('.clearai-research-event').count(), 8)
assert.equal(await page.locator('.clearai-research-event[data-category=handoff]').count(), 0, 'No child exists in this example; handoff must not be claimed')
assert.equal(await page.locator('.clearai-event-objects button, .clearai-event-objects a').count(), 0)
assert.equal(await page.getByText('Object selected. Open the Ontology or Research tab to view it.', { exact: true }).count(), 0)
await page.getByText('Ontology', { exact: true }).first().click()
await page.waitForTimeout(500)
assert.ok((await page.locator('body').innerText()).includes('Knowledge map'))
await page.screenshot({ path: output + 'dsh-ontology-1440.png' })
await page.getByText('Explore', { exact: true }).first().click()
await page.waitForTimeout(300)
await page.screenshot({ path: output + 'dsh-research-1440.png' })
await page.getByText('Chat', { exact: true }).first().click()
// Exercise the previously failing release/register ordering repeatedly.
for (let index = 0; index < 10; index++) {
  await page.getByText('New Session', { exact: true }).first().click()
  await page.getByText('Standard mode', { exact: true }).waitFor()
  await page.getByText(/^示例回放：比较客户流失差异$/).first().click()
  await page.locator('.clearai-research-event').first().waitFor()
  assert.equal(await page.locator('.clearai-research-event').count(), 8)
}
const disclosure = page.locator('.clearai-research-event summary').last()
await disclosure.focus()
await page.keyboard.press('Enter')
assert.equal(await disclosure.evaluate(node => node.parentElement.open), true)
await page.keyboard.press('Enter')
assert.equal(await disclosure.evaluate(node => node.parentElement.open), false)

writeFileSync(output + 'page-text.txt', await page.locator('body').innerText())
await page.screenshot({ path: output + 'dsh-initial.png' })
console.log(JSON.stringify({ errors, text: (await page.locator('body').innerText()).slice(0, 4000) }))
await context.close()
await page.video().saveAs(output + 'preview.webm')
for (const [locale, colorScheme, name] of [['en-US', 'dark', 'en-dark'], ['zh-CN', 'light', 'zh-light']]) {
  const variant = await browser.newContext({ viewport: { width: 1440, height: 1000 }, locale, colorScheme, reducedMotion: 'reduce' })
  const variantPage = await variant.newPage()
  variantPage.on('pageerror', error => { errors.push(error.message); errorStacks.push(error.stack) })
  variantPage.setDefaultTimeout(10000)
  await variantPage.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 })
  await variantPage.waitForTimeout(1500)
  await variantPage.getByText(/^示例回放.*$/).first().click()
  await variantPage.locator('.clearai-research-event').first().waitFor()
  await variantPage.locator('.clearai-research-event').first().scrollIntoViewIfNeeded()
  await variantPage.screenshot({ path: output + `dsh-${name}-1440.png` })
  await variant.close()
}
writeFileSync(output + 'preview-checks.json', JSON.stringify({ host: '0.2.2-rc.1', version, eventCount: 8, productionRecords: 8, sessionSwitchCycles: 10, keyboardDisclosure: true, errors, errorStacks, consoleErrors, clickToVisibleMs: timings, modelCalls: 0, example: true, objectNavigation: 'not in scope; objects are static text and panes are independent', productionModuleSha256: hashes }, null, 2))
assert.deepEqual(errors, [], 'All preview contexts must be free of uncaught page errors')
await browser.close()
