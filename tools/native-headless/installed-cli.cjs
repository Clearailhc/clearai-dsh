/** Launch exactly the installed desktop CLI; no npx or alternate host fallback. */
const path = require('node:path')
const {pathToFileURL} = require('node:url')
const root = process.env.CLEARAI_DSH_RESOURCES || '/Applications/DeepSeek Harness.app/Contents/Resources/app.asar/dsh'
;(async () => {
 const {runCli} = await import(pathToFileURL(path.join(root,'node_modules/@deepseek-ai/dsh/lib/bin.js')).href)
 await runCli()
})().catch(error => { console.error(`${error.name}: ${error.message}`); process.exitCode=1 })
