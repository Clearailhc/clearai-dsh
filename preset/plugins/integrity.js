import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { homedir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { contentDigest } from './audit-material.js'
import { workspacePath } from './workspace-path.js'

export const protectedMaterial = path => /^clear\/(?:evidence|goals|knowledge\/(?:facts|lessons|negatives))\//.test(path) && !path.endsWith('/INDEX.md')

// Host-side receipts detect changes at trust boundaries. This is deliberately
// not a sandbox: a process with access to DSH_HOME can alter this store too.
export function integrityStore(cwd, home = process.env.DSH_HOME || join(homedir(), '.dsh')) {
	const root = realpathSync(cwd)
	const directory = join(home, 'storages', 'clearai-integrity', contentDigest(root))
	const receiptFile = join(directory, 'receipts.json')
	const read = () => {
		if (!existsSync(receiptFile)) return { version: 1, workspace: root, files: {} }
		const data = JSON.parse(readFileSync(receiptFile, 'utf8'))
		if (data.version !== 1 || data.workspace !== root || !data.files) throw new Error('integrity-store-invalid')
		return data
	}
	const inspect = (path, receipt) => {
		const file = resolve(root, path)
		try {
			const checked = workspacePath(root, path, { mustExist: true })
			if (lstatSync(file).isSymbolicLink() || checked.relative !== path) return 'link-replaced'
			if (!receipt) return 'unregistered'
			return contentDigest(readFileSync(file)) === receipt.digest ? null : 'modified'
		} catch { return existsSync(file) ? 'unreadable-or-outside' : receipt ? 'removed' : 'unregistered' }
	}
	return {
		check() {
			const receipts = read().files, paths = new Set(Object.keys(receipts))
			const walk = directory => {
				if (!existsSync(directory)) return
				if (lstatSync(directory).isSymbolicLink()) { paths.add(relative(root, directory).replaceAll('\\', '/') + '/'); return }
				for (const entry of readdirSync(directory, { withFileTypes: true })) {
					const file = join(directory, entry.name)
					if (entry.isDirectory()) walk(file)
					else paths.add(relative(root, file).replaceAll('\\', '/'))
				}
			}
			for (const dir of ['evidence', 'goals', 'knowledge/facts', 'knowledge/lessons', 'knowledge/negatives']) walk(join(root, 'clear', dir))
			return [...paths].filter(protectedMaterial).sort().flatMap(path => { const code = inspect(path, receipts[path]); return code ? [{ path, code, expected: receipts[path]?.digest ?? null }] : [] })
		},
		write(path, content, origin) {
			if (!origin?.session || !origin?.event) throw new Error('integrity-origin-required')
			const target = workspacePath(root, path)
			if (!protectedMaterial(target.relative)) throw new Error('integrity-path-not-protected')
			mkdirSync(directory, { recursive: true })
			const lock = join(directory, 'write.lock')
			try { mkdirSync(lock) } catch { throw new Error('integrity-write-busy') }
			try {
				const data = read(), previous = data.files[target.relative]
				const issue = inspect(target.relative, previous)
				if (issue && (previous || existsSync(target.absolute))) throw new Error(`integrity-${issue}: ${target.relative}`)
				const receipt = { digest: contentDigest(content), ...origin, revision: (previous?.revision ?? 0) + 1 }
				mkdirSync(dirname(target.absolute), { recursive: true })
				const temporary = target.absolute + '.' + randomUUID() + '.tmp'
				writeFileSync(temporary, content)
				renameSync(temporary, target.absolute)
				data.files[target.relative] = receipt
				const staging = join(directory, randomUUID() + '.json')
				writeFileSync(staging, JSON.stringify(data), { mode: 0o600 })
				renameSync(staging, receiptFile)
				return { path: target.relative, ...receipt }
			} finally { rmSync(lock, { recursive: true, force: true }) }
		},
	}
}
