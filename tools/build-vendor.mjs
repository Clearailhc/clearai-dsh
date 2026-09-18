/**
 * build-vendor —— 把 @xyflow/react 打成插件自己的模块行。
 *
 * 为什么需要它:客户端半由宿主的模块系统装载,`require` 只认**平台种子词**
 * (react / react/jsx-runtime)与**已注册的行**。npm 上的包不在种子里,
 * 所以要么内联、要么注册成一个行。注册成行更干净:client.js 照常
 * `require('@xyflow/react')`,与 `require('react')` 同一个姿势。
 *
 * 产物:`ui/vendor/xyflow.js` —— 一个自执行的注册脚本,build-package 会拷进
 * `dist/clearai-dsh/lib/vendor/xyflow.js`,cordis.patch.yml 的客户端注入表带它。
 * react / react/jsx-runtime 标成 external(宿主提供,不是我们的事)。
 */
import { build } from 'esbuild'
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const PORT = join(HERE, '..')
const OUT_DIR = join(PORT, 'ui', 'vendor')
const OUT = join(OUT_DIR, 'xyflow.js')

/**
 * 跑一次打包。**导出成函数**是为了让 `build-package.mjs` 能直接调它:
 * 产物是生成物(不入库),所以「构建」这一步必须自己保证它是新的——
 * 靠人记得先跑另一个命令,迟早会拼出一份少了图的 client.js。
 */
export async function buildVendor() {
mkdirSync(OUT_DIR, { recursive: true })

/** 先让 esbuild 打出纯 CJS(react 外部),再裹进模块注册壳。 */
const result = await build({
	entryPoints: [join(PORT, 'node_modules', '@xyflow', 'react', 'dist', 'esm', 'index.js')],
	bundle: true,
	format: 'cjs',
	platform: 'browser',
	external: ['react', 'react/jsx-runtime'],
	minify: true,
	write: false,
})

const body = result.outputFiles[0].text
/**
 * **CSS 也要跟着走**:React Flow 的节点/边/控件样式住在 `dist/style.css` 里,
 * 缺了它图能渲染但布局是散的(节点堆在左上角、MiniMap 没有边框)。
 * 模块系统的约定是「模块体的副作用(含 CSS 注入)都发生在 factory 闭包内」,
 * 所以这里把它读成字符串、在 materialize 那一刻插一个 `<style>`(只插一次)。
 */
const css = readFileSync(join(PORT, 'node_modules', '@xyflow', 'react', 'dist', 'style.css'), 'utf8')
const xyflowVersion = JSON.parse(readFileSync(join(PORT, 'node_modules', '@xyflow', 'react', 'package.json'), 'utf8')).version
const banner = `/**
 * 这一文件由 tools/build-vendor.mjs 生成,**不要手改**。
 * 它把 @xyflow/react(${xyflowVersion})的 CJS 体声明成**同一脚本作用域里的一个函数**,
 * 主文件(client.js)的工厂闭包直接调它。
 *
 * 为什么不用「注册成模块行」:模块系统的 \`require\` 只认**平台种子字**与**启动图里的行**,
 * 而一个运行时动态 \`load()\` 的行不在启动图里——那正是「图组件不可用」那次的原因。
 * 声明成函数就绕开了整张表:它的 \`require('react')\` 绑定到调用方传进来的那个 require
 * (也就是宿主给工厂的那个),所以依赖面依然只有种子字。
 */
function __clearaiXyflow(require) {
	/** 样式只注入一次(这个函数可能被重新求值,幂等要有保证)。 */
	if (typeof document !== 'undefined' && document.querySelector('style[data-clearai="xyflow"]') === null) {
		const style = document.createElement('style')
		style.setAttribute('data-clearai', 'xyflow')
		style.textContent = ${JSON.stringify(css)}
		document.head.appendChild(style)
	}
	var module = { exports: {} }
	var exports = module.exports
	Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })
${body}
	return module.exports
}
`
writeFileSync(OUT, banner)
const kb = Math.round(banner.length / 1024)
console.log(`【vendor】@xyflow/react@${xyflowVersion} → ui/vendor/xyflow.js(JS+CSS,${kb} KB · 函数形式,react 外部化)`)
return OUT
}

/** 直接 `node tools/build-vendor.mjs` 时跑一次(独立可跑,便于排查)。 */
if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1]) await buildVendor()
