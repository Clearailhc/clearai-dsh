/**
 * lang —— 系统自己写的话用哪种语言。
 *
 * 规则只有一条:**跟着人说话的语言走**(会话级)。人用中文写,工具结果、运行态卡、
 * 问人的话、系统落盘的文件都是中文;人用英文写,就都是英文。面板的界面字跟着界面语言,
 * 两者通常一致。
 *
 * 读口只有一个 `language()`:
 *   · 内核(预设插件)在处理某个会话的那一刻,用进程内共享的 AsyncLocalStorage 标出语言
 *     (挂在 `globalThis[Symbol.for('clearai.language')]` 上,因为内核与宿主半是两个插件、两份模块);
 *   · 宿主半自己算面板读数时,用 `withLanguage(state.language, …)` 同步钉住。
 * 两者都没有时是中文。
 */

const KEY = Symbol.for('clearai.language')
let pinned = null

/** 当前语言:'zh' 或 'en'。 */
export function language() {
	if (pinned !== null) return pinned
	const scope = globalThis[KEY]
	const value = typeof scope?.getStore === 'function' ? scope.getStore() : undefined
	return value === 'en' ? 'en' : 'zh'
}

/** 二选一:中文在前,英文在后。 */
export function tr(zh, en) {
	return language() === 'en' ? en : zh
}

/** 同步地把一段计算钉在某种语言上(只给同步代码用)。 */
export function withLanguage(lang, fn) {
	const previous = pinned
	pinned = lang === 'en' ? 'en' : lang === 'zh' ? 'zh' : previous
	try {
		return fn()
	} finally {
		pinned = previous
	}
}

/**
 * 一段人写的话是哪种语言:有汉字且汉字不算少 ⇒ 中文;只有拉丁字母 ⇒ 英文;两样都没有 ⇒ null(不改判)。
 * 「汉字不算少」= 汉字数 × 3 ≥ 拉丁字母数:中文句子里夹的英文术语不改判,英文句子里引一个汉字词也不改判。
 */
export function detectLanguage(text) {
	if (typeof text !== 'string') return null
	const body = text.replace(/```[\s\S]*?```/g, ' ').replace(/`[^`]*`/g, ' ').replace(/https?:\/\/\S+/g, ' ')
	const cjk = (body.match(/[㐀-鿿豈-﫿]/g) ?? []).length
	const latin = (body.match(/[A-Za-z]/g) ?? []).length
	if (cjk >= 1 && cjk * 3 >= latin) return 'zh'
	if (latin >= 2) return 'en'
	return null
}

/** 一条消息的正文(content 可能是字符串,也可能是若干块)。 */
export function messageText(message) {
	const content = message?.content
	if (typeof content === 'string') return content
	if (!Array.isArray(content)) return ''
	return content
		.filter((part) => part?.type === 'text' && typeof part.text === 'string')
		.map((part) => part.text)
		.join('\n')
}

/**
 * 双语表:表里写 `[中文, English]`,读的时候按当前语言取一边;嵌套对象一并处理。
 * 给模块级常量用(它们在装载时求值,那一刻还不知道是哪个会话)。
 */
export function bilingual(table) {
	return new Proxy(table, {
		get(target, key) {
			const value = target[key]
			if (Array.isArray(value) && value.length === 2 && typeof value[0] === 'string' && typeof value[1] === 'string') return tr(value[0], value[1])
			if (Array.isArray(value)) return value.map((item) => (item !== null && typeof item === 'object' && !Array.isArray(item) ? bilingual(item) : item))
			if (value !== null && typeof value === 'object') return bilingual(value)
			return value
		},
	})
}
