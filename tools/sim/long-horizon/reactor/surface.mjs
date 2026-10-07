/** 反应器的真实响应面(任务二);只给模拟器与判分用,模型看不到。 */
export function truth({ T, P, cat, t }) {
	// 收率沿一条斜脊:最优温度随催化剂用量下移(T0 = 195 − 25·cat)。
	const T0 = 195 - 25 * cat
	const ridge = 60 + 40 * cat - 12.8 * cat ** 2
	const yieldPct = ridge - 0.06 * (T - T0) ** 2 - 3 * (P - 3.5) ** 2 - 0.003 * (t - 75) ** 2
	const impurity = 0.1 + 0.9 * Math.max(0, cat - 1.0) + 0.02 * Math.max(0, T - 165) + 0.003 * Math.max(0, t - 70)
	return { yieldPct: Math.max(0, yieldPct), impurity }
}
