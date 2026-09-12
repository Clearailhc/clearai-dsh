#!/usr/bin/env bash
# 跑全部测试。三份跑源,两份跑**装出来的那一份**(宿主半与客户端半)。
#
#   test/kernel.test.mjs   状态怎么算:准入、算术、闸门、投影 fold、预算与续跑
#   test/host.test.mjs     人按下的那一下会变成什么:人门路由、消息署名、折进投影
#   test/brain.test.mjs    外脑:技能/记忆的投影、候选态、写入侧的字段与去重
#   test/client.test.mjs   客户端接线:注册在哪个插座、钥匙是什么、预设进出
#   test/ontology.test.mjs 本体:声明与折法/内核的**交叉校验**(声明了却没接线必须当场红)
#
# 宿主半与客户端半跑的是**部署出去的那一份**(zod 只在 DSH 的模块回退层里解析得到),
# 所以它们先做逐字节比对——部署落后于源就直接红。
# 那个 DSH_HOME 里没装插件时,这两份**如实跳过**(不是失败);要真正跑到它们:
#
#   bash install.sh                                   # 开发形态:仓库的源摊进 ~/.dsh
#   node tools/install-native.mjs --profile web       # 产品形态:装构建出来的包
#
# 跑法:bash test/run.sh [遍数]
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROUNDS="${1:-1}"
FAILED=0

for round in $(seq 1 "$ROUNDS"); do
	kernel="$(node "$HERE/kernel.test.mjs" 2>&1)"
	host="$(node "$HERE/host.test.mjs" 2>&1)"
	brain="$(node "$HERE/brain.test.mjs" 2>&1)"
	client="$(node "$HERE/client.test.mjs" 2>&1)"
	ontology="$(node "$HERE/ontology.test.mjs" 2>&1)"
	kernel_line="$(printf '%s\n' "$kernel" | grep -a '通过,' | tail -1)"
	host_line="$(printf '%s\n' "$host" | grep -a '通过,' | tail -1)"
	brain_line="$(printf '%s\n' "$brain" | grep -a '通过,' | tail -1)"
	client_line="$(printf '%s\n' "$client" | grep -a '通过,' | tail -1)"
	ontology_line="$(printf '%s\n' "$ontology" | grep -a '通过,' | tail -1)"
	# 没装插件 ⇒ 这两份自己会打印一行「· 跳过…」并以 0 退出;那不是失败,如实记成「跳过」。
	host_display="${host_line:-$(printf '%s\n' "$host" | grep -a '跳过' | head -1 | sed 's/^· //')}"
	client_display="${client_line:-$(printf '%s\n' "$client" | grep -a '跳过' | head -1 | sed 's/^· //')}"
	printf '第 %s 遍 · 内核:%s · 宿主:%s · 外脑:%s · 客户端:%s · 本体:%s\n' "$round" "${kernel_line:-崩溃}" "${host_display:-崩溃}" "${brain_line:-崩溃}" "${client_display:-崩溃}" "${ontology_line:-崩溃}"
	if ! printf '%s\n' "$kernel_line" | grep -qa ',0 失败' || ! printf '%s\n' "$brain_line" | grep -qa ',0 失败' || ! printf '%s\n' "$ontology_line" | grep -qa ',0 失败'; then
		FAILED=1
		printf '\n--- 内核 ---\n%s\n--- 外脑 ---\n%s\n--- 本体 ---\n%s\n' "$kernel" "$brain" "$ontology"
	fi
	# 跳过不算失败,但**不能被当成通过**;有通过行就必须是 0 失败。
	if [ -n "$host_line" ] && ! printf '%s\n' "$host_line" | grep -qa ',0 失败'; then
		FAILED=1
		printf '\n--- 宿主 ---\n%s\n' "$host"
	elif [ -z "$host_line" ] && ! printf '%s\n' "$host" | grep -qa '跳过'; then
		FAILED=1
		printf '\n--- 宿主 ---\n%s\n' "$host"
	fi
	if [ -n "$client_line" ] && ! printf '%s\n' "$client_line" | grep -qa ',0 失败'; then
		FAILED=1
		printf '\n--- 客户端 ---\n%s\n' "$client"
	elif [ -z "$client_line" ] && ! printf '%s\n' "$client" | grep -qa '跳过'; then
		FAILED=1
		printf '\n--- 客户端 ---\n%s\n' "$client"
	fi
done

if [ "$FAILED" -ne 0 ]; then
	echo '有失败。'
	exit 1
fi
echo "全绿(${ROUNDS} 遍)。"
