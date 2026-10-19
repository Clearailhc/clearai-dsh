/**
 * clearai-evaluator-face —— 独立评估者的**工具面**(只挂在 `clearai-evaluator` 预设里)。
 *
 * 为什么要它(issue #38,宿主 ≥0.2.1-alpha.2):`startActivation` 不再接受逐次请求的
 * toolFilter,评估者预设又只能决定「自己挂了哪些行」。可宿主 profile 在**全局层**注册的工具
 * (`write` / `edit` / `subagent` / `workflow` / `web_*` / goal 工具……)每个 agent 都继承得到 ——
 * 只换预设,评估者照样拿得到写工具。旧入口的 toolFilter 遮的正是这一层。
 *
 * 两道,缺一不可:
 *   · **可见面**:`tools.restrict({ deny })` 把白名单外的全局工具从评估者的工具清单里拿掉,
 *     模型看不见就不会去试。restriction 遮的是 agent 继承来的面(全局 + 祖先层),
 *     预设层对评估者是祖先,所以这里只能 deny 具体名字,不能 allow —— allow 会连本预设挂的 read 一起遮掉。
 *   · **硬边界**:`tools.guard` 拒绝白名单外的一切执行。guard 单调(别的 guard 放行不了它拒的),
 *     也兜住挂载之后才注册进来的全局工具 —— deny 名单只认得挂载那一刻的名字。
 *
 * 白名单与旧入口的 toolFilter 同一张:read / read_image / glob / grep + 复跑用的 shell 与后台任务;
 * `structured_output` 是宿主挂在评估者自己层上的回包通道,不在继承面里,但执行要经过 guard,所以列上。
 */

export const name = 'clearai-evaluator-face'
export const inject = ['tools']

const PRESET_ID = 'clearai-evaluator'
/** `run_code` 是 PTC 模式的呈现通道(里面的每次调用仍按原名过 guard),不是一件能力。 */
const ALWAYS = ['structured_output', 'run_code']

export function apply(ctx, config = {}) {
	const allow = new Set([...(Array.isArray(config.allow) ? config.allow : []), ...ALWAYS])
	if (allow.size === ALWAYS.length) throw new Error('clearai-evaluator-face: config.allow must list the evaluator tools')
	const tools = ctx.tools

	/**
	 * 只管评估者自己。restriction / guard 注册在预设作用域里,本来就只覆盖加入这个预设的 agent;
	 * 若宿主把这一层当成全局(作用域判断变了),再按 agent 实际加入的预设核一遍,绝不误伤主会话。
	 */
	let scoped = true
	const presets = () => {
		try { return ctx.get('agentPresets') } catch { return undefined }
	}
	const isEvaluator = (agent) => {
		if (scoped) return true
		const composed = agent?.ctx === undefined ? undefined : presets()?.composedPreset?.(agent.ctx)
		return composed === PRESET_ID
	}

	try {
		const inherited = [...(tools.view?.(undefined)?.restrictableNames ?? [])]
		const deny = inherited.filter((toolName) => !allow.has(toolName) && toolName !== 'run_code')
		if (deny.length > 0) tools.restrict({ deny })
	} catch (error) {
		const message = String(error?.message ?? error)
		if (/scoped context/.test(message)) scoped = false
		ctx.logger?.warn?.(`clearai-evaluator-face: could not hide inherited tools (${message.slice(0, 160)}); the execution guard still applies`)
	}

	tools.guard((exec) => {
		if (allow.has(exec?.name) || !isEvaluator(exec?.agent)) return undefined
		return `The ClearAI evaluator is read-only: "${exec?.name}" is outside its tool face (${[...allow].join(', ')}). Verify with the allowed tools and report the limitation in the verdict.`
	})
}
