import { existsSync, realpathSync } from 'node:fs'
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path'

export class MaterialError extends Error {
	constructor(code, path) { super(`${code}: ${String(path)}`); this.code = code; this.path = path }
}

const outside = (base, file) => { const rel = relative(base, file); return rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel) }

// Check both the lexical path and the nearest existing ancestor. The latter also
// protects planned outputs which do not exist yet under a symlinked directory.
export function workspacePath(cwd, value, { mustExist = false } = {}) {
	if (!cwd || typeof value !== 'string' || !value.trim() || value.includes('\0')) throw new MaterialError('invalid-material-path', value)
	const root = realpathSync(cwd)
	const file = resolve(cwd, value)
	if (outside(resolve(cwd), file)) throw new MaterialError('outside-workspace', value)
	let ancestor = file
	while (!existsSync(ancestor) && dirname(ancestor) !== ancestor) ancestor = dirname(ancestor)
	if (outside(root, realpathSync(ancestor))) throw new MaterialError('outside-workspace', value)
	if (mustExist && !existsSync(file)) throw new MaterialError('missing-or-unreadable', value)
	const canonical = existsSync(file) ? realpathSync(file) : resolve(realpathSync(ancestor), relative(ancestor, file))
	return { absolute: canonical, relative: relative(root, canonical).split(sep).join('/') }
}
