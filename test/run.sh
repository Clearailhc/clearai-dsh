#!/usr/bin/env bash
# 跑全部测试。三份跑源,两份跑**装出来的那一份**(宿主半与客户端半)。
#
#   test/kernel.test.mjs   状态怎么算:准入、算术、闸门、投影 fold、预算与续跑
#   test/host.test.mjs     人按下的那一下会变成什么:人门路由、消息署名、折进投影
#   test/brain.test.mjs    外脑:技能/记忆的投影、候选态、写入侧的字段与去重
#   test/client.test.mjs   客户端接线:注册在哪个插座、钥匙是什么、预设进出
#   test/ontology.test.mjs 本体:声明与折法/内核的**交叉校验**(声明了却没接线必须当场红)
#   test/truth-table.test.mjs 真值表:机制声明去问代码,并校验生成物与源同步
#   test/state-machine.test.mjs 状态机/时序图:图里的每条边折法必须认识,不多不少
#   test/docs-consistency.test.mjs 文档:写错过的句子不许再以"现在时"出现
#   test/comment-style.test.mjs   注释:四类流水账反模式的配额只能降不能升(棘轮)
#   test/authority-boundary.test.mjs 权威边界:非权威路径结构上无法产生 clearai 变更
#   test/preset-composition.test.mjs 组合:挂载表(回来了什么/仍不挂什么)与 / 命令契约
#   test/prompt-sections.test.mjs  段分类:hard/native/advisory 与内容咬合 + 原生契约不漂移
#   test/e2e-scenarios.test.mjs   长测剧本与不变量(反例必须红——断言本身也要有人管)
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
	domain="$(node "$HERE/domain-language.test.mjs" 2>&1)"
	ontology="$(node "$HERE/ontology.test.mjs" 2>&1)"
	truth="$(node "$HERE/truth-table.test.mjs" 2>&1)"
	statemachine="$(node "$HERE/state-machine.test.mjs" 2>&1)"
	docs="$(node "$HERE/docs-consistency.test.mjs" 2>&1)"
	comment="$(node "$HERE/comment-style.test.mjs" 2>&1)"
	authority="$(node "$HERE/authority-boundary.test.mjs" 2>&1)"
	composition="$(node "$HERE/preset-composition.test.mjs" 2>&1)"
	sections="$(node "$HERE/prompt-sections.test.mjs" 2>&1)"
	scenarios="$(node "$HERE/e2e-scenarios.test.mjs" 2>&1)"
	invariant="$(node "$HERE/invariant.test.mjs" 2>&1)"
	kernel_line="$(printf '%s\n' "$kernel" | grep -a '通过,' | tail -1)"
	host_line="$(printf '%s\n' "$host" | grep -a '通过,' | tail -1)"
	brain_line="$(printf '%s\n' "$brain" | grep -a '通过,' | tail -1)"
	client_line="$(printf '%s\n' "$client" | grep -a '通过,' | tail -1)"
	domain_line="$(printf '%s\n' "$domain" | grep -a '通过,' | tail -1)"
	ontology_line="$(printf '%s\n' "$ontology" | grep -a '通过,' | tail -1)"
	truth_line="$(printf '%s\n' "$truth" | grep -a '通过,' | tail -1)"
	statemachine_line="$(printf '%s\n' "$statemachine" | grep -a '通过,' | tail -1)"
	docs_line="$(printf '%s\n' "$docs" | grep -a '通过,' | tail -1)"
	comment_line="$(printf '%s\n' "$comment" | grep -a '通过,' | tail -1)"
	authority_line="$(printf '%s\n' "$authority" | grep -a '通过,' | tail -1)"
	composition_line="$(printf '%s\n' "$composition" | grep -a '通过,' | tail -1)"
	sections_line="$(printf '%s\n' "$sections" | grep -a '通过,' | tail -1)"
	scenarios_line="$(printf '%s\n' "$scenarios" | grep -a '通过,' | tail -1)"
	invariant_line="$(printf '%s\n' "$invariant" | grep -a '通过,' | tail -1)"
	# 没装插件 ⇒ 这两份自己会打印一行「· 跳过…」并以 0 退出;那不是失败,如实记成「跳过」。
	host_display="${host_line:-$(printf '%s\n' "$host" | grep -a '跳过' | head -1 | sed 's/^· //')}"
	client_display="${client_line:-$(printf '%s\n' "$client" | grep -a '跳过' | head -1 | sed 's/^· //')}"
	printf '第 %s 遍 · 内核:%s · 宿主:%s · 外脑:%s · 客户端:%s · 领域语言:%s · 本体:%s · 真值表:%s · 状态机:%s · 文档:%s · 注释:%s · 边界:%s · 组合:%s · 段:%s · 长测:%s · 不变量:%s\n' "$round" "${kernel_line:-崩溃}" "${host_display:-崩溃}" "${brain_line:-崩溃}" "${client_display:-崩溃}" "${domain_line:-崩溃}" "${ontology_line:-崩溃}" "${truth_line:-崩溃}" "${statemachine_line:-崩溃}" "${docs_line:-崩溃}" "${comment_line:-崩溃}" "${authority_line:-崩溃}" "${composition_line:-崩溃}" "${sections_line:-崩溃}" "${scenarios_line:-崩溃}" "${invariant_line:-崩溃}"
	if ! printf '%s\n' "$kernel_line" | grep -qa ',0 失败' || ! printf '%s\n' "$brain_line" | grep -qa ',0 失败' || ! printf '%s\n' "$domain_line" | grep -qa ',0 失败' || ! printf '%s\n' "$ontology_line" | grep -qa ',0 失败' || ! printf '%s\n' "$truth_line" | grep -qa ',0 失败' || ! printf '%s\n' "$statemachine_line" | grep -qa ',0 失败' || ! printf '%s\n' "$docs_line" | grep -qa ',0 失败' || ! printf '%s\n' "$comment_line" | grep -qa ',0 失败' || ! printf '%s\n' "$authority_line" | grep -qa ',0 失败' || ! printf '%s\n' "$composition_line" | grep -qa ',0 失败' || ! printf '%s\n' "$sections_line" | grep -qa ',0 失败' || ! printf '%s\n' "$scenarios_line" | grep -qa ',0 失败' || ! printf '%s\n' "$invariant_line" | grep -qa ',0 失败'; then
		FAILED=1
		printf '\n--- 内核 ---\n%s\n--- 外脑 ---\n%s\n--- 领域语言 ---\n%s\n--- 本体 ---\n%s\n--- 真值表 ---\n%s\n--- 状态机 ---\n%s\n--- 文档 ---\n%s\n--- 注释 ---\n%s\n--- 边界 ---\n%s\n--- 组合 ---\n%s\n--- 段 ---\n%s\n--- 长测 ---\n%s\n--- 不变量 ---\n%s\n' "$kernel" "$brain" "$domain" "$ontology" "$truth" "$statemachine" "$docs" "$comment" "$authority" "$composition" "$sections" "$scenarios" "$invariant"
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
