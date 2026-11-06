import { readFileSync, realpathSync } from 'node:fs'
import { join, resolve, dirname } from 'node:path'
import { createHash } from 'node:crypto'

export function nativeRuntime(source = process.env) {
 const resources = source.CLEARAI_DSH_RESOURCES
 if (!resources) throw new Error('Set CLEARAI_DSH_RESOURCES to the installed DSH prefix containing node_modules; no alternate runtime is selected automatically')
 const root = realpathSync(resources)
 const manifest = name => JSON.parse(readFileSync(join(root, 'node_modules/@deepseek-ai', name, 'package.json')))
 const runtime = { node: process.version, cli: manifest('dsh').version, agent: manifest('dsh-agent').version }
 const expectedRuntime = source.CLEARAI_NATIVE_RUNTIME || '0.2.2-rc.1'
 if (runtime.cli !== expectedRuntime) throw new Error(`Expected DSH ${expectedRuntime}; installed ${runtime.cli}`)
 const entry = join(root, 'node_modules/@deepseek-ai/dsh/lib/bin.js')
 const runtimeDigest = createHash('sha256').update(JSON.stringify(runtime)).update(readFileSync(entry)).digest('hex')
 return { app: source.CLEARAI_DSH_EXECUTABLE || process.execPath, resources: root, entry, runtime, expectedRuntime, runtimeDigest }
}

export function npmCommand(args) {
 return process.platform === 'win32' ? [process.execPath, [join(dirname(process.execPath),'node_modules/npm/bin/npm-cli.js'), ...args]] : ['npm', args]
}
