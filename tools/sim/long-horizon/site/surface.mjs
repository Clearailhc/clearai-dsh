/**
 * 同一现场的三道反应题(阶段二的门槛测试用;只给模拟器与判分用,模型看不到)。
 *
 * 现场的共性(经验能带过去的东西):
 *   · 同一套小试装置:控温热电偶在第 D 次之后漂移 δ,实际温度 = 设定 − δ;每第 5 次附带参考探头读数 T_ref。
 *   · 这类液相反应,温度与另一个因素沿斜脊耦合:一次只动一个因素会停在错的点。
 * 每题的漂移起点、方向与耦合的那个因素不同,所以经验能帮忙,事实不能直接照抄。
 */
export const VARIANTS = {
	s1: {
		title: '加氢(A 线)',
		factors: { T: [140, 200], P: [1, 6], cat: [0.2, 2.0], t: [20, 120] },
		center: { T: 170, P: 3, cat: 1.0, t: 60 },
		drift: { after: 20, delta: 7 },
		spec: 0.5,
		truth({ T, P, cat, t }) {
			const T0 = 190 - 22 * cat
			const ridge = 62 + 36 * cat - 11 * cat ** 2
			const yieldPct = ridge - 0.05 * (T - T0) ** 2 - 2.5 * (P - 3.5) ** 2 - 0.003 * (t - 70) ** 2
			const impurity = 0.1 + 0.8 * Math.max(0, cat - 1.1) + 0.02 * Math.max(0, T - 162) + 0.003 * Math.max(0, t - 70)
			return { yieldPct: Math.max(0, yieldPct), impurity }
		},
	},
	s2: {
		title: '酯化(B 线)',
		factors: { T: [100, 160], r: [1, 4], cat: [0.5, 3.0], t: [30, 240] },
		center: { T: 130, r: 2, cat: 1.5, t: 120 },
		drift: { after: 12, delta: -6 },
		spec: 0.6,
		truth({ T, r, cat, t }) {
			const T0 = 160 - 0.25 * t
			const ridge = 62 + 0.25 * t - 0.0006 * t ** 2
			const yieldPct = ridge - 0.05 * (T - T0) ** 2 - 2.2 * (r - 2.6) ** 2 - 1.5 * (cat - 1.8) ** 2
			const impurity = 0.15 + 0.03 * Math.max(0, T - 120) + 0.15 * Math.max(0, cat - 1.6) + 0.0015 * Math.max(0, t - 150)
			return { yieldPct: Math.max(0, yieldPct), impurity }
		},
	},
	s3: {
		title: '胺化(C 线)',
		factors: { T: [120, 180], P: [2, 10], cat: [0.5, 2.5], t: [30, 150] },
		center: { T: 150, P: 6, cat: 1.5, t: 90 },
		drift: { after: 8, delta: 8 },
		spec: 0.2,
		truth({ T, P, cat, t }) {
			const T0 = 186 - 24 * cat
			const ridge = 54 + 38 * cat - 9 * cat ** 2
			const yieldPct = ridge - 0.05 * (T - T0) ** 2 - 0.5 * (P - 7) ** 2 - 0.002 * (t - 95) ** 2
			const impurity = 0.08 + 0.25 * Math.max(0, cat - 1.6) + 0.015 * Math.max(0, T - 145) + 0.002 * Math.max(0, t - 100)
			return { yieldPct: Math.max(0, yieldPct), impurity }
		},
	},
}
