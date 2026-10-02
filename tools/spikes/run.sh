#!/usr/bin/env bash
# 在真 DSH headless 宿主里跑一个原型验证插件(假模型按剧本出牌,不需要凭据)。
# 用法:tools/spikes/run.sh <goal-guard|human-gate|present> [额外插件行,如 tool-ask-user]
#   DSH_CLI_PREFIX  装了 @deepseek-ai/dsh 的前缀(默认用 PATH 上的 dsh)
#   环境变量原样传给插件:SPIKE_SCRIPT=ptc(配 DSH_TOOLS_MODE=ptc)、SPIKE_HUMAN=withdraw|keep|none
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd)
spike=$1; shift
[ -n "${DSH_CLI_PREFIX:-}" ] && export PATH="$DSH_CLI_PREFIX/node_modules/.bin:$PATH"
work=$(mktemp -d); export DSH_HOME="$work/home"; mkdir -p "$work/ws"
{
	printf -- '- id: agent-default-model\n  config:\n    provider: spike-scripted\n    model: script\n- insert:\n'
	printf -- '    - id: clearai-spike-%s\n      name: %s/%s.plugin.mjs\n' "$spike" "$here" "$spike"
	for row in "$@"; do printf -- "    - id: %s\n      name: '@deepseek-ai/dsh-%s'\n" "$row" "$row"; done
} > "$work/patch.yml"
cd "$work/ws"
dsh --profile headless --patch "$work/patch.yml" --json "spike $spike" > "$work/out.jsonl"
node -e '
for (const line of require("fs").readFileSync(process.argv[1], "utf8").split("\n")) {
	let event; try { event = JSON.parse(line) } catch { continue }
	if (["tool_call", "tool_result", "final", "error"].includes(event.type)) {
		const { type, ...rest } = event
		console.log(type, JSON.stringify(rest).slice(0, 300))
	}
}' "$work/out.jsonl"
echo "work=$work"
