/**
 * 权威边界:非权威路径**结构上**无法产生 clearai 变更。
 *
 * 这条边界是「不可表达优于不可违反」的核心:阶段 5 把 todo / 子代理 / workflow / 模型切换
 * 交还 DSH 原生之后,模型干活不设限——但不管它在探索区做什么,都**没有一条通道**能把
 * 结论写进权威账本。这份测试不看行为、看结构:
 *
 *   ① 变更字面量(`t: 'xxx/yyy'`)只出现在内核一个文件里——其它插件一件都不产;
 *   ② 投影侧 applyMutations 只有两个调用点,且都被标记把守:
 *      工具结果的 `meta.kind === 'clearai'`,或插件消息的 `clearai/ontology` 段;
 *   ③ 人门动词不走变更通道——它们没有工具 schema,模型的工具面里不存在;
 *   ④ 标记常量两侧同源(MUTATION_KIND = 'clearai'),改一侧不改另一侧会立刻红。
 *
 * 于是「交还原生能力」与「权威账本不可伪造」可以同时成立:前者是工作方式,后者由这份测试钉死。
 *
 * 跑法:node test/authority-boundary.test.mjs
 */
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const PORT = join(HERE, '..')

let passed = 0
let failed = 0
const failures = []
const check = (label, condition, detail = '') => {
	if (condition) {
		passed += 1
		console.log(`  ✓ ${label}`)
	} else {
		failed += 1
		failures.push(label)
		console.log(`  ✗ ${label}${detail === '' ? '' : ` — ${detail}`}`)
	}
}

const PLUGINS_DIR = join(PORT, 'preset', 'plugins')
const pluginFiles = readdirSync(PLUGINS_DIR).filter((name) => name.endsWith('.js'))
const KERNEL = readFileSync(join(PLUGINS_DIR, 'clearai-kernel.js'), 'utf8')
const FOLD = readFileSync(join(PORT, 'ui', 'lib', 'fold.js'), 'utf8')

/** 变更字面量的形状:`t: 'goal/set'`、`t: 'step/advanced'` 这类。 */
const MUTATION_LITERAL = /^\s*t:\s*'[a-z]+\/[a-z_]+',?\s*$/m

console.log('\n【① 只有内核生产权威变更】')
{
	const producers = pluginFiles.filter((name) => MUTATION_LITERAL.test(readFileSync(join(PLUGINS_DIR, name), 'utf8')))
	check('变更字面量只出现在 clearai-kernel.js', producers.length === 1 && producers[0] === 'clearai-kernel.js', producers.join(' '))
	check('外脑/本体/提示词插件一件变更都不产', !['brain.js', 'ontology.js', 'prompts.js'].some((name) => producers.includes(name)))
}

console.log('\n【② 投影侧只有两个变更入口,且都被标记把守】')
{
	const callSites = FOLD.split('\n').map((line, index) => ({ line, index })).filter(({ line }) => /applyMutations\(/.test(line) && !/export function applyMutations/.test(line))
	check('applyMutations 恰好两个调用点(工具结果 + 插件消息)', callSites.length === 2, `${callSites.length} 个`)
	const guards = callSites.map(({ index }) => FOLD.split('\n').slice(Math.max(0, index - 32), index + 1).join('\n'))
	check('工具结果入口被 meta.kind === MUTATION_KIND 把守', guards.some((context) => /meta\.kind === MUTATION_KIND/.test(context)))
	check('插件消息入口被 clearai/mutations 段名把守', guards.some((context) => /section\?\.name === 'clearai\/mutations'/.test(context)))
}

console.log('\n【③ 人门动词不走变更通道(没有工具 schema)】')
{
	const gateMatch = FOLD.match(/export const HUMAN_GATE_ACTIONS = \[([^\]]+)\]/)
	const gateVerbs = gateMatch === null ? [] : [...gateMatch[1].matchAll(/'([a-z_]+)'/g)].map((match) => match[1])
	check('人门白名单可解析且非空', gateVerbs.length >= 3, gateVerbs.join(' '))
	const toolsMatch = KERNEL.match(/export const MECHANISM_TOOLS = \[([\s\S]*?)\]/)
	const toolNames = toolsMatch === null ? [] : [...toolsMatch[1].matchAll(/name: '([A-Z][A-Za-z]+)'/g)].map((match) => match[1])
	const leaked = gateVerbs.filter((verb) => toolNames.some((name) => name.toLowerCase() === verb))
	check('人门动词没有一个出现在工具目录里(模型工具面不存在它们)', leaked.length === 0, leaked.join(' '))
	check('人门动词也不以 defineTool 形式存在', !gateVerbs.some((verb) => new RegExp(`defineTool\\(\\s*\\{[^}]*name: '${verb}'`).test(KERNEL)))
}

console.log('\n【④ 标记常量两侧同源】')
{
	check('内核侧 MUTATION_KIND = clearai', /const MUTATION_KIND = 'clearai'/.test(KERNEL))
	check('投影侧 MUTATION_KIND = clearai', /export const MUTATION_KIND = 'clearai'/.test(FOLD))
	check('工具结果入口认的就是这个标记(没有第二条无标记通道)', !/meta\.mutations(?![\s\S]{0,80}MUTATION_KIND)/.test(FOLD.split('applyMutations')[0]))
}

console.log('\n【⑤ 非权威写面与权威写面在文件层面就是分开的】')
{
	// 探索区产物 = 工作区普通文件(bash/write/edit,宿主沙箱管);
	// 权威账本 = clearai 变更(只有内核能产)+ clear/ 受保护目录(bash deny rules 把守)。
	// 两个写面不共享代码路径:这就是「探索随便做,结论进不来」的结构性保证。
	check('受保护目录的 deny 规则存在(clear/ 不许被普通写入)', /clear\//.test(KERNEL) && /deny|protected/i.test(KERNEL))
	check('投影只读账本:fold.js 里没有任何写文件调用', !/writeFileSync|appendFileSync/.test(FOLD))
}

console.log('\n【⑧ 平面互不依赖:预设不 import 宿主平面】')
{
	// 发行物里预设与 ui/ 的相对位置和仓库不一样;跨平面 import 在装上之后才炸
	// (浏览器里切预设报 failed to import)。共享逻辑要么各写一份(内核/fold 的先例),
	// 要么走宿主提供的服务门面。
	const crossPlane = pluginFiles.filter((name) => /from\s+['"]\.\.\/\.\.\/ui\//.test(readFileSync(join(PLUGINS_DIR, name), 'utf8')))
	check('预设插件没有任何 ../../ui/ 跨界 import', crossPlane.length === 0, crossPlane.join(','))
}

console.log(`\n结果:${passed} 通过,${failed} 失败`)
if (failures.length > 0) {
	console.log('失败项:')
	for (const failure of failures) console.log(`  - ${failure}`)
	process.exit(1)
}
