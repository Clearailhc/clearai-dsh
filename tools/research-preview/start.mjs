/** Start an isolated real DSH replay. Requires an existing official DSH installation. */
import { mkdtempSync, mkdirSync, readdirSync, symlinkSync, writeFileSync, existsSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { tmpdir } from 'node:os'
import { spawn } from 'node:child_process'

const args = process.argv.slice(2)
const option = name => args[args.indexOf(name) + 1]
if (!args.includes('--host-node-modules')) throw new Error('Pass --host-node-modules <official DSH node_modules directory>')
const modules = resolve(option('--host-node-modules'))
const root = resolve(import.meta.dirname, '../..')
const cli = join(modules, '@deepseek-ai/dsh/lib/bin.js')
if (!existsSync(cli) || !existsSync(join(root, 'dist/clearai-dsh/lib/host.js'))) throw new Error('Install official DSH and run npm run build first')
const home = mkdtempSync(join(tmpdir(), 'clearai-replay-'))
const profile = join(home, 'profiles/web')
const targetModules = join(profile, 'node_modules')
mkdirSync(targetModules, { recursive: true })
for (const entry of readdirSync(modules, { withFileTypes: true })) {
  if (entry.name.startsWith('@')) {
    mkdirSync(join(targetModules, entry.name))
    for (const child of readdirSync(join(modules, entry.name))) symlinkSync(join(modules, entry.name, child), join(targetModules, entry.name, child), 'junction')
  } else if (!['clearai-dsh', 'clearai-research-preview'].includes(entry.name)) symlinkSync(join(modules, entry.name), join(targetModules, entry.name), 'junction')
}
symlinkSync(join(root, 'dist/clearai-dsh'), join(targetModules, 'clearai-dsh'), 'junction')
symlinkSync(import.meta.dirname, join(targetModules, 'clearai-research-preview'), 'junction')
writeFileSync(join(profile, 'package.json'), JSON.stringify({ name: 'clearai-example-profile', private: true, dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', 'clearai-dsh'] } } }, null, 2))
writeFileSync(join(profile, 'cordis.yml'), '[]\n')
writeFileSync(join(profile, 'cordis.patch.yml'), `- insert:
    - id: clearai-example
      name: clearai-research-preview
- id: session-title-llm
  disabled: true
- id: ui-settings-general
  config:
    welcomeNoticeVersion: '2026-09-28.1'
- id: ui-settings-models
  config:
    credentialOnboarding: false
`)
console.log(`Isolated example profile: ${home}`)
const child = spawn(process.execPath, [cli, 'web', '--port', args.includes('--port') ? option('--port') : '3091', '--no-open'], { env: { ...process.env, DSH_HOME: home }, stdio: 'inherit' })
process.on('SIGINT', () => child.kill('SIGINT'))
process.on('SIGTERM', () => child.kill('SIGTERM'))
child.on('exit', code => { process.exitCode = code ?? 1 })
