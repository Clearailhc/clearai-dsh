/** 电解液配方的真实响应(长程任务六);只给模拟器与判分用,模型看不到。 */

/** 线性衰减速率(每圈容量损失的百分点):快测只看得到这一部分。 */
export function fadeRate({ c, a, b, Tf }) {
	return 0.035 * (1 + 0.6 * (c - 1.2) ** 2) * Math.exp(-0.35 * b) * (1 - 0.06 * a) * (1 + 0.0008 * (Tf - 40) ** 2)
}

/**
 * 拐点(突然跳水的圈数):添加剂 B 越多越早耗尽,除非 B 与 A 大致按 0.4 的比例搭配。
 * 拐点在第 100 圈之后才出现,所以快测完全看不到它。
 */
export function kneeCycle({ a, b }) {
	return 500 + 250 * a * Math.exp(-((b - 0.4 * a) ** 2) / 0.25)
}

/** 第 n 圈的容量保持率(%):拐点之前线性衰减,之后每圈多掉 0.15 个百分点。 */
export function capacityAt(input, n) {
	const rate = fadeRate(input)
	const knee = kneeCycle(input)
	return 100 - rate * n - (n > knee ? 0.15 * (n - knee) : 0)
}

/** 真实寿命:容量掉到 80% 的圈数(按圈数逐圈找)。`linear` 是只看线性衰减外推的寿命,快测给的就是它。 */
export function truth(input) {
	const rate = fadeRate(input)
	const knee = kneeCycle(input)
	let n = 0
	while (n < 5000 && capacityAt(input, n + 1) >= 80) n += 1
	return { rate, linear: 20 / rate, knee, life: n }
}

/** 第 100 圈附近的内阻增长(%):比例偏离 0.4 越远、B 越多,涨得越快。它是拐点的早期征兆。 */
export function dcirRise({ a, b }) {
	return 4 + 14 * (1 - Math.exp(-((b - 0.4 * a) ** 2) / 0.25)) * (b / 3)
}
