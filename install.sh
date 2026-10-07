#!/usr/bin/env bash
# clearai 的**开发**安装 / 重装:把仓库当前的源构建成包,用 DSH 自己的那条命令装进 profile。
#
# 宿主 ≥0.2.0 的名册只认**组合里的声明行**(`@deepseek-ai/dsh-agent-preset-registry` 不扫目录、
# 不收预设路径),所以旧的开发形态——把 preset/ 拷进 ~/.dsh/.agent-presets、把 ui/ 塞进
# profile 的 node_modules、往补丁层追一行宿主行——在这些宿主上**装得上、却选不到 ClearAI**:
# 预设声明行(presets/clearai/clearai.patch.yml)只随包的 `dsh.bundle.patch` 进组合。
# 开发形态因此与产品形态走同一条路,只是包来自本地构建:
#
#     node tools/build-package.mjs                                  # 源 → dist/clearai-dsh
#     node tools/install-native.mjs --profile web                   # = dsh plugin --profile web add file:<dist>
#
# 重跑即重装(`dsh plugin add` 会把 file: 目录重新拷一遍)。卸载:
#     dsh plugin --profile web remove clearai-dsh
#
# 用法:bash install.sh [--profile web]

set -euo pipefail

PROFILE="web"
while [ $# -gt 0 ]; do
	case "$1" in
		--profile) PROFILE="$2"; shift 2 ;;
		*) echo "unknown argument: $1" >&2; exit 2 ;;
	esac
done

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DSH_HOME="${DSH_HOME:-$HOME/.dsh}"
export DSH_HOME

echo "DSH_HOME = $DSH_HOME"
echo "profile  = $PROFILE"

# 开发形态早先留下的预设拷贝:新宿主不读它,但 verify-deploy 以前会优先读它(验错对象)。
if [ -d "$DSH_HOME/.agent-presets/clearai" ]; then
	echo "注意:$DSH_HOME/.agent-presets/clearai 是旧开发形态留下的拷贝,宿主 ≥0.2.0 不读它。"
	echo "      要挪开它:node tools/install-native.mjs --profile $PROFILE --migrate"
fi

node "$HERE/tools/build-package.mjs"
node "$HERE/tools/install-native.mjs" --home "$DSH_HOME" --profile "$PROFILE"

echo
echo "装好了。验收:"
echo "  · 重启 dsh web(两半都在进程里按模块 URL 缓存,只刷新浏览器不够)"
echo "  · 起一个新的 ClearAI 会话(预设选择器里选「ClearAI」)"
echo "  · 中栏应出现「本体」;右栏「+」里应有「世界树」"
echo
echo "装完自检(用**部署出去的文件**做一次真实装配,绕开 ESM 缓存):"
if DSH_PROFILE="$PROFILE" node "$HERE/tools/verify-deploy.mjs"; then
	echo "自检通过。"
else
	echo "自检没过 —— 先别用,看上面的报错。" >&2
	exit 1
fi
