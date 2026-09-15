/**
 * brain —— 外脑的**投影层**(预设平面)。
 *
 * 第一性原理:外脑只需要四件事——落盘、有界索引、
 * 按需读全文、字节稳定。这四件在 DSH 里都有原生承载:
 *
 *   L1 索引   宿主技能目录(`skills` 服务 + `tool-skill` 的 **digest 变了才注入**)
 *   L2 全文   原生 `skill` 工具(按名字加载)
 *   L3 单条   `resourceBase` 指向目录,模型用原生 `read`(带 limit/offset)按需读
 *
 * 所以这个模块**不建索引、不做缓存、不注入任何东西**:它只是把工作区里的两类文件
 * **投影成目录条目**——
 *   · `clear/skills/<name>/SKILL.md` → 一个技能条目(ClearAI 的 19 个技能就是这个形状)
 *   · `clear/memory/**`              → **一个虚拟条目** `project-memory`:它的 L2 正文是现算的
 *     (所以不存在「INDEX.md 过期」这种状态),`resourceBase` 指向记忆目录,单条按需读。
 *
 * 自建的东西只有两件工具(`SaveSkill` / `WriteMemory`),因为「结构」只有机制保证得了:
 * 技能必须带 name/description 且**默认是候选态**(模型写的 SOP 该由人过一道);
 * 教训必须带 Context/Trigger/Action/Validation/Reuse Hint,事实必须带 Statement/Evidence/Scope/Last Verified,
 * 而且按标题跨文件去重。
 *
 * 字段契约由本模块定义并强制:lesson 与 fact 各有必填字段,按标题跨文件去重,
 * 虚拟条目的正文有界截断。
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'

/** lesson / fact 的字段契约。 */
export const LESSON_REQUIRED = ['Context', 'Trigger', 'Action', 'Validation', 'Reuse Hint']
export const FACT_REQUIRED = ['Statement', 'Evidence', 'Scope', 'Last Verified']
export const LESSON_FIELD_ORDER = ['Context', 'Trigger', 'Symptom', 'Root Cause', 'Action', 'Fix', 'Validation', 'Reuse Hint']
export const FACT_FIELD_ORDER = ['Statement', 'Evidence', 'Scope', 'Last Verified']
/** 虚拟条目的正文预算(只用来**截断**,不用于自建注入)。 */
export const MEMORY_INDEX_CHAR_BUDGET = 1500
export const MAX_TITLES_PER_FILE = 5
const ENTRY_HEADING = /^##\s+(Lesson|Fact):\s+(.+?)\s*$/gm
/** 技能名:kebab-case(目录名即名字)。 */
const SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

export function brainPaths(cwd) {
	return {
		skills: join(cwd, 'clear', 'skills'),
		memory: join(cwd, 'clear', 'memory'),
	}
}

function listDir(dir) {
	try {
		return readdirSync(dir)
	} catch {
		return []
	}
}

/**
 * 极简 frontmatter 解析:只认 `key: value` 与块标量(`|` / `>`),以及一层 `metadata:`。
 * 不为 YAML 写一个通用解析器——ClearAI 的技能 frontmatter 就是这么几件事
 * (`name` / `description`(块标量,带【触发词】与适用范围)/ `version` / `metadata.{tier,origin,created_at}`)。
 */
export function parseFrontmatter(text) {
	if (typeof text !== 'string' || !text.startsWith('---')) return { data: {}, body: text ?? '' }
	const end = text.indexOf('\n---', 3)
	if (end < 0) return { data: {}, body: text }
	const head = text.slice(3, end).replace(/^\n/, '')
	const body = text.slice(end + 4).replace(/^\n+/, '')
	const data = {}
	let nested = null
	let blockKey = null
	let blockIndent = null
	let blockLines = []
	const flushBlock = () => {
		if (blockKey === null) return
		const value = blockLines.join('\n').trim()
		if (nested === null) data[blockKey] = value
		else data[nested] = { ...(data[nested] ?? {}), [blockKey]: value }
		blockKey = null
		blockIndent = null
		blockLines = []
	}
	for (const raw of head.split('\n')) {
		const indent = raw.length - raw.trimStart().length
		if (blockKey !== null) {
			// 块标量的缩进以**第一行内容**为准(不是固定 +1):YAML 就是这么定的。
			if (blockIndent === null && raw.trim() !== '') blockIndent = indent
			if (raw.trim() === '' || (blockIndent !== null && indent >= blockIndent)) {
				blockLines.push(raw.trim() === '' ? '' : raw.slice(blockIndent ?? indent))
				continue
			}
			flushBlock()
		}
		const line = raw.trim()
		if (line === '' || line.startsWith('#')) continue
		const match = /^([A-Za-z_][\w.-]*):\s*(.*)$/.exec(line)
		if (match === null) continue
		const [, key, rest] = match
		if (rest === '' && indent === 0 && key === 'metadata') {
			nested = 'metadata'
			data.metadata = data.metadata ?? {}
			continue
		}
		if (rest === '|' || rest === '>') {
			blockKey = key
			blockIndent = null
			blockLines = []
			continue
		}
		const value = rest.trim().replace(/^["']|["']$/g, '')
		if (nested !== null && indent > 0) data[nested] = { ...(data[nested] ?? {}), [key]: value }
		else {
			nested = null
			data[key] = value
		}
	}
	flushBlock()
	return { data, body }
}

/** 技能条目:只报**带 SKILL.md 的目录**(ClearAI 的 19 个技能都是这个形状)。 */
export function skillEntries(cwd) {
	const root = brainPaths(cwd).skills
	const entries = []
	for (const name of listDir(root)) {
		const dir = join(root, name)
		let info = null
		try {
			info = statSync(dir)
		} catch {
			continue
		}
		if (!info.isDirectory()) continue
		const file = join(dir, 'SKILL.md')
		if (!existsSync(file)) continue
		let text = ''
		try {
			text = readFileSync(file, 'utf8')
		} catch {
			continue
		}
		const { data, body } = parseFrontmatter(text)
		const declared = typeof data.name === 'string' && data.name !== '' ? data.name : name
		entries.push({
			name: declared,
			dirName: name,
			description: typeof data.description === 'string' ? data.description : '',
			status: typeof data.status === 'string' ? data.status : 'active',
			tier: data.metadata?.tier ?? null,
			version: data.version ?? null,
			dir,
			file,
			body,
			bytes: Buffer.byteLength(text, 'utf8'),
		})
	}
	return entries.sort((left, right) => left.name.localeCompare(right.name))
}

/** 记忆条目:扁平 `.md`,`## Lesson: <title>` / `## Fact: <title>` 两种块(ClearAI 的格式)。 */
export function memoryEntries(cwd) {
	const root = brainPaths(cwd).memory
	const entries = []
	for (const file of listDir(root)) {
		if (!file.endsWith('.md')) continue
		const path = join(root, file)
		let text = ''
		try {
			text = readFileSync(path, 'utf8')
		} catch {
			continue
		}
		for (const match of text.matchAll(ENTRY_HEADING)) {
			const kind = match[1].toLowerCase()
			const title = match[2].trim()
			const after = text.slice(match.index + match[0].length)
			const until = after.search(/\n##\s+(?:Lesson|Fact):/)
			const block = until < 0 ? after : after.slice(0, until)
			const summary = (block.split('\n').find((line) => line.trim().startsWith('- ')) ?? '').replace(/^-\s*/, '').trim()
			entries.push({ file, path, kind, title, summary: summary.slice(0, 160) })
		}
	}
	return entries.sort((left, right) => left.title.localeCompare(right.title))
}

/** 技能条目的目录摘要:name + description(ClearAI 的索引也只给这两样)。 */
export function skillSummaryLine(entry) {
	const tag = entry.status === 'candidate' ? '[候选·待采纳]' : ''
	return `${tag}${entry.description || '(未写 description)'}`
}

/** 记忆虚拟条目的 L1 摘要:有界(ClearAI `MEMORY_INDEX_CHAR_BUDGET` 的用意一样)。 */
export function memoryIndexDigest(entries) {
	if (entries.length === 0) return ''
	const titles = entries.map((entry) => `${entry.kind === 'lesson' ? '经验' : '事实'}:${entry.title}`)
	const head = `本项目已沉淀 ${entries.length} 条:`
	let line = head
	for (const title of titles) {
		if (line.length + title.length + 1 > 480) {
			line += '…'
			break
		}
		line += `${line === head ? '' : '、'}${title}`
	}
	return line
}

/** 记忆虚拟条目的 L2 正文(现算,所以不存在「索引过期」)。 */
export function memoryIndexBody(entries, { budget = MEMORY_INDEX_CHAR_BUDGET } = {}) {
	if (entries.length === 0) return ''
	const byFile = new Map()
	for (const entry of entries) {
		if (!byFile.has(entry.file)) byFile.set(entry.file, [])
		byFile.get(entry.file).push(entry)
	}
	const lines = [
		'# 本项目记忆(索引)',
		'',
		`共 ${entries.length} 条,分布在 ${byFile.size} 个文件里。**这一页只是索引**:读某一条用 \`read\` 打开下面标的文件(可用 offset 续读);要写新的一条用 \`WriteMemory\`(它做字段校验与标题去重)。`,
		'',
	]
	let used = lines.join('\n').length
	for (const [file, items] of byFile) {
		const shown = items.slice(0, MAX_TITLES_PER_FILE)
		const block = [`## ${file}`, ...shown.map((item) => `- [${item.kind}] ${item.title}${item.summary === '' ? '' : ` — ${item.summary}`}`)]
		if (items.length > shown.length) block.push(`- …另有 ${items.length - shown.length} 条(读该文件看全文)`)
		const text = `${block.join('\n')}\n`
		if (used + text.length > budget * 4) {
			lines.push(`## ${file}`, `- …本文件另有 ${items.length} 条(超出索引预算,读文件看全文)`, '')
			used += 40
			continue
		}
		lines.push(...block, '')
		used += text.length
	}
	lines.push('> 领域知识在 `clear/knowledge/`(按需 read);项目宪法在 `PROJECT.md`(宿主每回合注入)。')
	return lines.join('\n')
}

// ── 目录条目:技能与记忆都投影成条目,交给宿主原生的 skills 服务 ────────────────

export const BRAIN_PROVIDER = 'clearai-brain'
export const MEMORY_ENTRY = 'project-memory'

/** 指纹:目录里所有相关文件的 (路径, mtime, 大小)。变了才重算(与宿主 digest 注入同一套纪律)。 */
export function brainFingerprint(cwd) {
	const parts = []
	for (const entry of skillEntries(cwd)) parts.push(`${entry.file}:${statSync(entry.file).mtimeMs}:${entry.bytes}`)
	for (const entry of memoryEntries(cwd)) parts.push(`${entry.path}:${statSync(entry.path).mtimeMs}`)
	return parts.join('|')
}

/**
 * 造一个技能提供者。它**不缓存目录**(缓存交给宿主的目录 digest 与我们的指纹短路),
 * 只做两件事:把工作区投影成条目;把候选技能标成「模型不可调用」。
 *
 * `invalidate`(`registerProvider` 给的 `control.invalidate`)在**指纹真的变了**时被调用:
 * 宿主那边另有一层按「cwd + 作用域 + revision」做键的目录缓存,不 bump revision 的话,
 * 我们这边明明多了一条技能、它那边还会把旧表端出来——失效模式是第一回合的空目录被
 * 缓存住,模型之后一直看不到 `clear/skills`。
 * 原生 filesystem provider 靠 watcher 做这件事,我们没有 watcher,就靠指纹。
 */
export function createBrainProvider(options = {}) {
	const log = typeof options.log === 'function' ? options.log : () => {}
	const invalidate = typeof options.invalidate === 'function' ? options.invalidate : null
	let fingerprint = null
	let snapshot = { skills: [], memory: [] }
	const refresh = (cwd) => {
		const next = brainFingerprint(cwd)
		if (next === fingerprint) return snapshot
		// 第一次观测不算「变了」;之后的每一次变化都要让宿主的目录缓存失效。
		const changed = fingerprint !== null
		fingerprint = next
		snapshot = { skills: skillEntries(cwd), memory: memoryEntries(cwd) }
		if (changed && invalidate !== null) {
			try {
				invalidate()
			} catch (error) {
				log(`目录失效失败:${String(error?.message ?? error)}`)
			}
		}
		return snapshot
	}
	const candidatesFor = (cwd) => {
		if (typeof cwd !== 'string' || cwd === '') return { candidates: [], complete: true }
		let current
		try {
			current = refresh(cwd)
		} catch (error) {
			log(`外脑扫描失败:${String(error?.message ?? error)}`)
			return { candidates: [], complete: false }
		}
		const candidates = []
		for (const entry of current.skills) {
			// 候选态 = 模型看不见、人也加载不了它当 SOP;人采纳后改 frontmatter 才生效。
			// 这是 ClearAI「候选 → 收件箱采纳 → 生效」那条治理的**原生表达**(invocation 策略)。
			const invocable = entry.status !== 'candidate'
			candidates.push({
				name: entry.name,
				description: skillSummaryLine(entry),
				whenToUse: entry.description.slice(0, 500),
				invocation: { modelInvocable: invocable, userInvocable: true },
				source: entry.tier === 'system' ? 'clearai-template' : 'clearai-workspace',
				provider: BRAIN_PROVIDER,
				resourceBase: { kind: 'directory', path: entry.dir },
				rank: invocable ? 100 : 60,
				path: entry.file,
				metadata: { status: entry.status, version: entry.version, tier: entry.tier, bytes: entry.bytes },
				locator: { kind: 'skill', name: entry.name, dir: entry.dir, file: entry.file },
			})
		}
		if (current.memory.length > 0) {
			candidates.push({
				name: MEMORY_ENTRY,
				description: memoryIndexDigest(current.memory),
				invocation: { modelInvocable: true, userInvocable: true },
				source: 'clearai-memory',
				provider: BRAIN_PROVIDER,
				resourceBase: { kind: 'directory', path: brainPaths(cwd).memory },
				rank: 80,
				locator: { kind: 'memory', cwd },
			})
		}
		return { candidates, complete: true }
	}
	return {
		name: BRAIN_PROVIDER,
		async list(lookup = {}) {
			return candidatesFor(lookup?.cwd)
		},
		async get(candidate, lookup = {}) {
			const locator = candidate?.locator
			if (locator === null || typeof locator !== 'object') return undefined
			if (locator.kind === 'skill') {
				let text = ''
				try {
					text = readFileSync(locator.file, 'utf8')
				} catch {
					return undefined
				}
				const { body } = parseFrontmatter(text)
				return {
					name: candidate.name,
					description: candidate.description,
					invocation: candidate.invocation,
					source: candidate.source,
					provider: BRAIN_PROVIDER,
					resourceBase: { kind: 'directory', path: locator.dir },
					path: locator.file,
					// 正文就是 SKILL.md 的 body(宿主原生也是这么给的:`parsed.body.trim()`)。
					content: body.trim(),
				}
			}
			if (locator.kind === 'memory') {
				const cwd = typeof lookup.cwd === 'string' && lookup.cwd !== '' ? lookup.cwd : locator.cwd
				const entries = memoryEntries(cwd)
				const body = memoryIndexBody(entries)
				if (body === '') return undefined
				return {
					name: MEMORY_ENTRY,
					description: memoryIndexDigest(entries),
					invocation: { modelInvocable: true, userInvocable: true },
					source: 'clearai-memory',
					provider: BRAIN_PROVIDER,
					resourceBase: { kind: 'directory', path: brainPaths(cwd).memory },
					content: body,
				}
			}
			return undefined
		},
	}
}

/**
 * 外脑全景:面板要画的那份清单。
 *
 * 为什么由内核算而不由面板算:面板在浏览器里,**读不了盘**;而内核每次 pre-step 都在扫工作区。
 * 所以清单随投影走(变了才发),内容才走宿主路由(点开某一条时才读)。
 */
export function brainOverview(cwd) {
	const skills = skillEntries(cwd).map((entry) => ({
		name: entry.name,
		description: entry.description.slice(0, 400),
		status: entry.status,
		tier: entry.tier,
		version: entry.version,
		bytes: entry.bytes,
		// 资源文件数:技能是「目录式」的,正文之外的 workflows/templates/checklists 才是细节所在。
		resources: (() => {
			let count = 0
			const walk = (dir, depth) => {
				if (depth > 3) return
				for (const name of listDir(dir)) {
					const info = (() => {
						try {
							return statSync(join(dir, name))
						} catch {
							return null
						}
					})()
					if (info === null) continue
					if (info.isDirectory()) walk(join(dir, name), depth + 1)
					else if (name !== 'SKILL.md') count += 1
				}
			}
			walk(entry.dir, 0)
			return count
		})(),
		path: `clear/skills/${entry.dirName}/SKILL.md`,
	}))
	const memory = memoryEntries(cwd)
	return {
		skills,
		memory: {
			count: memory.length,
			files: [...new Set(memory.map((entry) => entry.file))].map((file) => ({
				file,
				path: `clear/memory/${file}`,
				entries: memory.filter((entry) => entry.file === file).map((entry) => ({ kind: entry.kind, title: entry.title })),
			})),
		},
	}
}

/**
 * 等人采纳的候选技能(面板的收件箱据此出条目)。
 * 状态锚:文件里的 `status: candidate` 在,条目就在;被采纳或被删,条目自然消失。
 */
export function candidateSkills(cwd) {
	return skillEntries(cwd)
		.filter((entry) => entry.status === 'candidate')
		.map((entry) => ({ name: entry.name, description: entry.description.slice(0, 300), dir: entry.dir }))
}

/**
 * 采纳一个候选技能:把 frontmatter 里的 `status` 改成 `active`,并记下是谁、什么时候。
 * 只改这一行——正文一个字都不动(技能是行为知识,采纳不该顺手改内容)。
 * 返回 {ok, reason?}:文件不在、本来就不是候选,都如实说,不假装采纳成功。
 */
export function promoteSkill(cwd, name, { at = null, by = 'user' } = {}) {
	const problem = validateSkillName(name)
	if (problem !== null) return { ok: false, reason: problem }
	const entry = skillEntries(cwd).find((item) => item.name === name || item.dirName === name)
	if (entry === undefined) return { ok: false, reason: 'skill_not_found' }
	if (entry.status !== 'candidate') return { ok: false, reason: 'not_a_candidate', status: entry.status }
	let text = ''
	try {
		text = readFileSync(entry.file, 'utf8')
	} catch (error) {
		return { ok: false, reason: 'read_failed' }
	}
	const end = text.indexOf('\n---', 3)
	if (end < 0) return { ok: false, reason: 'frontmatter_missing' }
	const head = text.slice(0, end)
	const rest = text.slice(end)
	const stamped = `${head.replace(/^status:\s*.*$/m, 'status: active')}\npromoted_by: ${by}\npromoted_at: ${at ?? new Date().toISOString()}`
	try {
		writeFileSync(entry.file, `${stamped}${rest}`, 'utf8')
	} catch (error) {
		return { ok: false, reason: 'write_failed' }
	}
	return { ok: true, path: entry.file, name: entry.name }
}

// ── 写入侧的两条规则(自建的两件工具就靠它们) ────────────────────────────────

/** 记忆文件名:扁平 `.md`,不许有路径分隔符或 `..`(ClearAI `validate_memory_filename`)。 */
export function validateMemoryFile(target) {
	const name = String(target ?? '').trim()
	if (name === '') return 'empty_target'
	if (name.includes('/') || name.includes('\\') || name.includes('..')) return 'path_traversal'
	if (!name.endsWith('.md')) return 'must_be_markdown'
	return null
}

/** 技能名:kebab-case(ClearAI 的目录名即名字)。 */
export function validateSkillName(name) {
	const value = String(name ?? '').trim()
	if (value === '') return 'empty_name'
	if (!SKILL_NAME.test(value)) return 'must_be_kebab_case'
	return null
}

/** 技能目录内的相对路径:不许 `..`、不许绝对路径、不许反斜杠。 */
export function validateSkillPath(target) {
	const value = String(target ?? 'SKILL.md').trim()
	if (value === '') return 'empty_path'
	if (value.startsWith('/') || value.includes('\\') || value.includes('..')) return 'path_traversal'
	return null
}

export function lessonFieldsProblem(fields) {
	const missing = LESSON_REQUIRED.filter((key) => String(fields?.[key] ?? '').trim() === '')
	return missing.length === 0 ? null : missing
}

export function factFieldsProblem(fields) {
	const missing = FACT_REQUIRED.filter((key) => String(fields?.[key] ?? '').trim() === '')
	return missing.length === 0 ? null : missing
}

/** 一条记忆块的正文格式(ClearAI `format_lesson_block` / `format_fact_block` 的逐条对齐)。 */
export function formatMemoryBlock({ kind, title, fields, source = null, order }) {
	const lines = [`## ${kind === 'lesson' ? 'Lesson' : 'Fact'}: ${String(title).trim()}`]
	const seen = new Set()
	for (const key of order) {
		const value = String(fields?.[key] ?? '').trim()
		if (value === '') continue
		lines.push(`- ${key}: ${value}`)
		seen.add(key)
	}
	for (const [key, raw] of Object.entries(fields ?? {})) {
		if (seen.has(key)) continue
		const value = String(raw ?? '').trim()
		if (value === '') continue
		lines.push(`- ${key}: ${value}`)
	}
	if (source !== null && String(source).trim() !== '') lines.push(`- Source: ${String(source).trim()}`)
	return `${lines.join('\n')}\n`
}

/** 跨文件去重:任一记忆文件里已有同标题的同类条目就跳过(ClearAI 的 `entry_heading_exists`)。 */
export function memoryTitleExists(cwd, kind, title) {
	const needle = `## ${kind === 'lesson' ? 'Lesson' : 'Fact'}: ${String(title).trim()}`
	return memoryEntries(cwd).some((entry) => `${entry.kind === 'lesson' ? 'Lesson' : 'Fact'}: ${entry.title}` === needle.replace(/^##\s*/, ''))
}

/** 追加一条记忆;返回写到的文件与是否因为重复而跳过。 */
export function appendMemory(cwd, { kind, title, fields, source = null, target = null }) {
	const file = target === null ? (kind === 'lesson' ? 'lessons.md' : 'facts.md') : validateMemoryFile(target) === null ? target : null
	if (file === null) return { ok: false, reason: 'invalid_target' }
	// 结构校验在**写入器**里,不在调用方:劝告保证不了「教训必须含那五项」,只有机制保证得了。
	const missing = kind === 'lesson' ? lessonFieldsProblem(fields) : factFieldsProblem(fields)
	if (missing !== null) return { ok: false, reason: 'missing_fields', missing }
	if (memoryTitleExists(cwd, kind, title)) return { ok: true, skipped: true, path: join(brainPaths(cwd).memory, file) }
	const dir = brainPaths(cwd).memory
	mkdirSync(dir, { recursive: true })
	const path = join(dir, file)
	let existing = ''
	try {
		existing = readFileSync(path, 'utf8')
	} catch {
		existing = ''
	}
	const block = formatMemoryBlock({ kind, title, fields, source, order: kind === 'lesson' ? LESSON_FIELD_ORDER : FACT_FIELD_ORDER })
	const separator = existing === '' ? '' : existing.endsWith('\n\n') ? '' : existing.endsWith('\n') ? '\n' : '\n\n'
	writeFileSync(path, `${existing}${separator}${block}`, 'utf8')
	return { ok: true, skipped: false, path, relative: relative(cwd, path) }
}
