/**
 * 测试用的临时目录:**造得出来,也要收得回去**。
 *
 * 为什么要有这个文件(2026-09-11 实测的教训):四份套件每轮都 `mkdtempSync` 一堆
 * 「工作区 + DSH_HOME + 世界线副本」,从来不删。跑到第 N 轮时 `/tmp`(16G 的 tmpfs)
 * 的 **inode 用满了**——1048576 个 inode 只剩 2 个,连 `df` 都跑不起来,报的却是
 * 「no space left on device」(磁盘明明还有 1.7T)。这类故障最难查的地方在于:
 * 它不是测试失败,是**环境被测试慢慢吃掉**。
 *
 * 所以纪律改成两条:
 *   · 测试只经 `tempDir()` 造临时目录,统一登记;
 *   · 进程退出时(含断言失败后的退出)一次性收干净——用 `process.on('exit')`,
 *     它是同步的,`rmSync` 在这里跑得完。
 */
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const created = []

/** 造一个登记在册的临时目录。 */
export function tempDir(prefix) {
	const dir = mkdtempSync(join(tmpdir(), prefix))
	created.push(dir)
	return dir
}

/** 造一个登记在册的临时目录,并先建好里面的子路径。 */
export function tempTree(prefix, ...segments) {
	const dir = join(tempDir(prefix), ...segments)
	mkdirSync(dir, { recursive: true })
	return dir
}

/** 把外面已有的路径也纳入回收(比如建在 tmpdir 下的固定名字目录)。 */
export function trackTemp(path) {
	created.push(path)
	return path
}

export function cleanupTempDirs() {
	for (const dir of created.splice(0)) {
		try {
			rmSync(dir, { recursive: true, force: true })
		} catch {
			// 收不掉就算了:清理失败不该让测试红(它只是卫生问题,不是断言)。
		}
	}
}

process.on('exit', cleanupTempDirs)
process.on('SIGINT', () => {
	cleanupTempDirs()
	process.exit(130)
})
