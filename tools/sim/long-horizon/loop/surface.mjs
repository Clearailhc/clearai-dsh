/**
 * 0.5.2 闭环序列的四道题(模拟器与判分用;模型看不到这份源码)。
 *
 * 同一现场,四题各检验闭环的一个环节:
 *   a1 A 线加氢优化:控温热电偶第 20 次后偏高 7 °C(实际 = 设定 − 7),温度与催化剂沿斜脊耦合;
 *      原料含水 w 对收率与杂质都没有影响(现场有人怀疑它,可以被检验排除)。→ 产生正、负条目
 *   a2 A 线换催化剂批次:斜脊整体右移 6 °C,耦合形状不变;同一支热电偶没修,第 1 次起就偏高 7 °C。→ 正向复用
 *   b1 B 线另一套装置:热电偶准(无漂移),各因素互不耦合;沿用 A 线的修正会多补 7 °C。→ 适用性
 *   a3 A 线量产两周收率下滑:真因是热电偶漂移从 7 °C 增大到 13 °C;第二周原料含水升高、换了班组,都是巧合。→ 负向复用
 *
 * 装置共性:每第 `refEvery` 次附带参考探头读数 T_ref;读数有约 0.7 个点的噪声。
 */

const aLine = (shift) => ({ T, P, cat, t }) => {
	const T0 = 190 + shift - 22 * cat
	const ridge = 62 + 36 * cat - 11 * cat ** 2
	const yieldPct = ridge - 0.05 * (T - T0) ** 2 - 2.5 * (P - 3.5) ** 2 - 0.003 * (t - 70) ** 2
	const impurity = 0.1 + 0.8 * Math.max(0, cat - 1.1) + 0.02 * Math.max(0, T - (162 + shift)) + 0.003 * Math.max(0, t - 70)
	return { yieldPct: Math.max(0, yieldPct), impurity }
}

const A_FACTORS = { T: [140, 200], P: [1, 6], cat: [0.2, 2.0], t: [20, 120], w: [0.1, 1.0] }

export const VARIANTS = {
	a1: { title: 'A 线加氢', line: 'a-line', factors: A_FACTORS, budget: 30, drift: { after: 20, delta: 7 }, refEvery: 5, spec: 0.5, truth: aLine(0) },
	a2: { title: 'A 线加氢(新催化剂批次)', line: 'a-line-batch2', factors: A_FACTORS, budget: 30, drift: { after: 0, delta: 7 }, refEvery: 5, spec: 0.5, truth: aLine(6) },
	b1: {
		title: 'B 线加氢',
		line: 'b-line',
		factors: { T: [140, 200], P: [1, 6], cat: [0.2, 2.0], t: [20, 120], w: [0.1, 1.0] },
		budget: 30,
		drift: { after: 0, delta: 0 },
		refEvery: 5,
		spec: 0.5,
		truth({ T, P, cat, t }) {
			const yieldPct = 89 - 0.04 * (T - 165) ** 2 - 2 * (P - 4) ** 2 - 6 * (cat - 1.0) ** 2 - 0.002 * (t - 80) ** 2
			const impurity = 0.1 + 0.02 * Math.max(0, T - 172) + 0.5 * Math.max(0, cat - 1.3) + 0.002 * Math.max(0, t - 90)
			return { yieldPct: Math.max(0, yieldPct), impurity }
		},
	},
	a3: { title: 'A 线收率下滑定位', line: 'a-line-drop', factors: A_FACTORS, budget: 12, drift: { after: 0, delta: 13 }, refEvery: 3, spec: 0.5, truth: aLine(0) },
}

/** 量产记录的确定性噪声。 */
function noise(seed) {
	const x = Math.sin(seed * 12.9898 + 78.233) * 43758.5453
	return (x - Math.floor(x)) * 2 - 1
}

/**
 * a3 的量产记录:两周、每天三班。设定配方不变(T 162、P 3.5、cat 1.3、t 70)。
 * 第一周热电偶偏高 7 °C(与 a1 相同),第二周从第 8 天起每天多偏 1 °C,到第 14 天偏 13 °C。
 * 第二周原料含水 w 升高、班组换成乙组:都与下滑同时发生,但不是原因。
 * 参考探头只在每周一校核一次(第 1 天、第 8 天)。
 */
export function productionLog() {
	const rows = [['day', 'shift', 'crew', 'T_set', 'P', 'cat', 't', 'feed_moisture_pct', 'T_ref_check', 'yield_pct', 'impurity_pct']]
	for (let day = 1; day <= 14; day += 1) {
		const drift = day <= 7 ? 7 : 7 + (day - 7) * (6 / 7)
		for (const [index, shift] of ['早', '中', '夜'].entries()) {
			const seed = day * 10 + index
			const w = +(day <= 7 ? 0.25 + 0.05 * noise(seed + 1) : 0.6 + 0.08 * noise(seed + 2)).toFixed(2)
			const crew = day <= 7 ? '甲' : '乙'
			const actual = 162 - drift
			const real = aLine(0)({ T: actual, P: 3.5, cat: 1.3, t: 70 })
			const ref = (day === 1 || day === 8) && index === 0 ? +(actual + 0.3 * noise(seed + 3)).toFixed(1) : ''
			rows.push([day, shift, crew, 162, 3.5, 1.3, 70, w, ref, +(real.yieldPct + 0.6 * noise(seed + 4)).toFixed(2), +Math.max(0.01, real.impurity + 0.01 * noise(seed + 5)).toFixed(3)])
		}
	}
	return rows.map((row) => row.join(',')).join('\n') + '\n'
}
