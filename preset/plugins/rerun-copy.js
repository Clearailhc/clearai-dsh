import { cp, lstat, mkdir, realpath, readdir, rm } from 'node:fs/promises'
import { join, relative } from 'node:path'
import { workspacePath } from './workspace-path.js'

export const RERUN_EXCLUDED = new Set(['.clearai-reruns', '.git', 'node_modules', '.venv', 'venv', '__pycache__', '.pytest_cache', '.mypy_cache', '.ruff_cache', '.cache'])
const excluded = path => path.split(/[\\/]/).some(part => RERUN_EXCLUDED.has(part))

export async function createRerunCopy(cwd, target, { required = [], signal } = {}) {
	const started = performance.now(), metrics = { files: 0, bytes: 0, elapsedMs: 0, status: 'copying' }
	let created = false
	try {
		for (const path of required) {
			const checked = workspacePath(cwd, path, { mustExist: true })
			if (excluded(checked.relative)) throw new Error(`rerun-required-input-excluded: ${path}`)
		}
		signal?.throwIfAborted()
		await mkdir(target, { recursive: false }); created = true
		const root = await realpath(cwd)
		const filter = async source => {
			signal?.throwIfAborted()
			const path = relative(root, source).replaceAll('\\', '/')
			if (excluded(path)) return false
			const stat = await lstat(source)
			if (stat.isSymbolicLink()) throw new Error(`rerun-symlink-not-supported: ${path}`)
			if (stat.isFile()) { metrics.files++; metrics.bytes += stat.size }
			return true
		}
  for (const entry of await readdir(root)) {
   if (excluded(entry)) continue
   await cp(join(root, entry), join(target, entry), { recursive: true, dereference: true, filter })
  }
		metrics.status = 'ready'
		return { directory: target, ...metrics, elapsedMs: performance.now() - started }
	} catch (error) {
		if (created) {
   try { await rm(target, { recursive: true, force: true }); metrics.cleanup = 'removed' }
   catch (cleanupError) { metrics.cleanup = String(cleanupError.message) }
  }
		return { directory: null, ...metrics, elapsedMs: performance.now() - started, status: signal?.aborted ? 'cancelled' : 'unavailable', error: String(error.message) }
	}
}
