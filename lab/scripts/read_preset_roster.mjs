// 读宿主名册的运行态:boot 一个 profile,打印 agentPresets.list() 的原始结果。
//
// 为什么需要它:dsh --dump-config 是**静态**的(组合里有没有那条声明行),而
// 「预设能不能用」是**运行态**(registry 里注册成功没有、有没有 broken 诊断)。
// 探针已证明两者会分叉:preset 里放一个根本不存在的插件,boot 依然完全正常。
//
// 用法:
//   DSH_HOME=/tmp/verify-home-024 node lab/scripts/read_preset_roster.mjs
// 宿主 CLI 的位置可用 DSH_INSTALL 覆盖(默认 /tmp/dsh-cli-017)。
const install = process.env.DSH_INSTALL ?? '/tmp/dsh-cli-017'
const profile = process.env.DSH_PROFILE ?? 'web'

const { runProfile } = await import(`${install}/node_modules/@deepseek-ai/dsh/lib/profile-boot.js`)
const { createLaunchEnvironmentSnapshot } = await import(`${install}/node_modules/@deepseek-ai/dsh-launch-environment/lib/index.js`)

const environment = createLaunchEnvironmentSnapshot([{ source: 'process', values: { ...process.env } }])
console.log(`DSH_HOME=${process.env.DSH_HOME ?? '(未设置)'}  profile=${profile}`)

const { ctx, shutdown } = await runProfile({
	environment,
	profile,
	patchFiles: [],
	args: ['--port', '0', '--no-open'],
})

try {
	const service = ctx.agentPresets
	if (service === undefined) {
		console.log('✗ ctx.agentPresets 不存在(这一版的宿主没有这个服务)')
	} else {
		const list = await service.list()
		console.log('\n=== agentPresets.list() 原始结果 ===')
		console.log(JSON.stringify(list, null, 2))
		const ids = (Array.isArray(list) ? list : []).map((item) => item?.id ?? item)
		console.log('\n=== 摘要 ===')
		console.log(`条目:${ids.join(', ') || '(空)'}`)
		console.log(`含 clearai:${ids.includes('clearai')}`)
		const clearai = (Array.isArray(list) ? list : []).find((item) => item?.id === 'clearai')
		console.log(`clearai 条目原文:${JSON.stringify(clearai ?? null)}`)
	}
} finally {
	// runProfile 返回的收尾句柄在这一版里不是个函数;读名册是只读操作,
	// 拿到结果就够了,收尾失败不该把退出码弄脏(它曾把一次成功的读数变成 exit 1)。
	try {
		if (typeof shutdown === 'function') await shutdown()
	} catch {}
	process.exit(0)
}
