/**
 * 工作区的**读数**:e2e-run 与 e2e-replay 共用同一套判据。
 *
 * 为什么要单独一份:复算一场日志时若用另一套数法(或干脆忘了算),「记忆写没写」
 * 这类断言就会在离线重判里变成假失败——长测的结论一旦有两套口径,就没人敢信了。
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

/** 记忆条数:clear/memory/*.md 里 `## ` 二级标题的个数(与内核写记忆的形状对齐)。 */
export function countMemoryEntries(workspace) {
	const dir = join(workspace, 'clear', 'memory')
	if (!existsSync(dir)) return 0
	let count = 0
	for (const name of readdirSync(dir)) {
		if (!name.endsWith('.md')) continue
		try {
			count += (readFileSync(join(dir, name), 'utf8').match(/^##\s+\S/gm) ?? []).length
		} catch {
			/* 读不了就不数 */
		}
	}
	return count
}

/** 物证判据:必须是**文件**——目录不算,这与内核准入用的是同一条判据。 */
export function artifactExists(workspace, relative) {
	try {
		return statSync(join(workspace, relative)).isFile()
	} catch {
		return false
	}
}
