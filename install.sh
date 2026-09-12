#!/usr/bin/env bash
# clearai 移植的**开发**安装 / 重装(不是产品形态)。
#
# 产品形态是 DSH 自己的那条命令(S3 起):
#     node tools/build-package.mjs                                  # 或 npm pack
#     node tools/install-native.mjs --profile web                   # = dsh plugin add file:<dist>
# 那个形态下:宿主半/客户端半来自**包的补丁层**,预设随包走(system root 由补丁层的 !!js 现场算出),
# 没有任何绝对路径、不给用户目录里塞副本。
#
# 本脚本保留给**开发**:它把仓库里的源直接摊进真实 DSH_HOME(预设拷进 ~/.dsh/.agent-presets,
# 面板包塞进 profile 的 node_modules,再往 profile 补丁层追一行绝对路径)。
# 改内核后想立刻在自己机器上生效,用它最省事;要验「发出去的样子」,用 install-native.mjs。
#
# 装三样东西:
#   1. 预设平面:~/.dsh/.agent-presets/clearai/            (ClearAI 的灵魂:内核 + 组合 + 技能)
#   2. 宿主平面:~/.dsh/profiles/web/node_modules/@clearai/dsh/          (面板 client 半)
#   3. 宿主平面:~/.dsh/profiles/web/cordis.patch.yml 里的一行 insert(挂上面那个包)
#
# 幂等:重复跑只会覆盖文件,补丁行只加一次。
# 用法:bash install.sh [--profile web]

set -euo pipefail

PROFILE="web"
while [ $# -gt 0 ]; do
	case "$1" in
		--profile) PROFILE="$2"; shift 2 ;;
		--remove-package) OLD_PANEL_PKGS+=("$2"); shift 2 ;;
		*) echo "unknown argument: $1" >&2; exit 2 ;;
	esac
done

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DSH_HOME="${DSH_HOME:-$HOME/.dsh}"
PRESET_DST="$DSH_HOME/.agent-presets/clearai"
PANEL_PKG="clearai-dsh"
# 旧安装留下的包名(改过名 / 换过形态之后的残留):用 `--remove-package <name>` 指定,可重复。
# 刻意**不写死**任何历史名字 —— 要清哪几个由调用方给,源码里不留旧账。
# 不清的话,同一个包会在补丁层挂两行(第二行撞 id,或挂到已经不存在的模块)。
OLD_PANEL_PKGS=()
PANEL_DST="$DSH_HOME/profiles/$PROFILE/node_modules/$PANEL_PKG"
PATCH="$DSH_HOME/profiles/$PROFILE/cordis.patch.yml"

echo "DSH_HOME = $DSH_HOME"
# **覆写之前先备份**(§27c):开发安装会覆盖下面三个落点,出问题时用
# `bash tools/backup-home.sh rollback` 一条命令回到上一版 —— 不必再手动 git 恢复。
if [ -d "$DSH_HOME/.agent-presets/clearai" ] || [ -d "$DSH_HOME/profiles/$PROFILE/node_modules/@clearai/dsh" ]; then
	backup_dir="$(DSH_HOME="$DSH_HOME" bash "$HERE/tools/backup-home.sh" backup 2>/dev/null || true)"
	case "$backup_dir" in
		*backup*) echo "覆写前已备份:$backup_dir" ;;
		*) echo "(备份跳过:没有可备份的落点或脚本不可用)" ;;
	esac
fi
echo "profile  = $PROFILE"

# ── 1. 预设平面 ─────────────────────────────────────────────────────────────
rm -rf "$PRESET_DST"
mkdir -p "$PRESET_DST"
cp -r "$HERE/preset/." "$PRESET_DST/"

# 工作区模板:空文件夹里铺的那套(PROJECT.md / 18 个技能 / knowledge / memory)。
# 源是 ClearAI 自己的模板目录——本移植长在那个仓里,所以直接取;取不到就**如实跳过**
# (工作区引导会退化成只建 clear/ 骨架,不假装铺过模板)。
TEMPLATE_SRC="$HERE/preset/template"
if [ -d "$TEMPLATE_SRC" ]; then
	rm -rf "$PRESET_DST/template"
	mkdir -p "$PRESET_DST/template"
	# 残渣不进模板(ClearAI 的 _TRANSIENT_ASSET_DIRS 同款判定)。
	tar -C "$TEMPLATE_SRC" --exclude=node_modules --exclude=dist --exclude=.vite --exclude=coverage --exclude=.pytest_cache --exclude=__pycache__ -cf - . | tar -C "$PRESET_DST/template" -xf -
	echo "     工作区模板:$(find "$PRESET_DST/template" -name SKILL.md | wc -l) 个技能 + PROJECT.md"
else
	echo "     (跳过工作区模板:找不到 $TEMPLATE_SRC —— 工作区引导只会建 clear/ 骨架)"
fi
echo "① 预设已装:$PRESET_DST"
find "$PRESET_DST" -type f | sed 's/^/     /'

# ── 2. 宿主 UI 包 ───────────────────────────────────────────────────────────
if [ -f "$HERE/ui/package.json" ]; then
	rm -rf "$PANEL_DST"
	mkdir -p "$PANEL_DST"
	cp -r "$HERE/ui/." "$PANEL_DST/"
	echo "② 宿主包已装:$PANEL_DST"
	for old_pkg in "${OLD_PANEL_PKGS[@]}"; do
		old_dst="$DSH_HOME/profiles/$PROFILE/node_modules/$old_pkg"
		if [ -d "$old_dst" ]; then rm -rf "$old_dst"; echo "   已清掉旧包目录:$old_dst"; fi
	done
else
	echo "② 面板包源不存在($HERE/ui/package.json 缺失),跳过" >&2
fi

# ── 3. 补丁行(幂等) ────────────────────────────────────────────────────────
if [ ! -f "$PATCH" ]; then
	echo "③ 找不到 $PATCH:先跑一次 dsh --profile $PROFILE 让它初始化,再重跑本脚本" >&2
	exit 1
fi
for old_pkg in "${OLD_PANEL_PKGS[@]}"; do
	if grep -q "$old_pkg" "$PATCH"; then
		# 旧行(改名前的包)先摘掉:同一个包不能在补丁层挂两行
		old_id="$(printf '%s' "$old_pkg" | sed 's|@clearai/||')"
		grep -v "$old_pkg" "$PATCH" | grep -v "$old_id-host" > "$PATCH.tmp"
		mv "$PATCH.tmp" "$PATCH"
		echo "③ 已摘掉改名前的旧补丁行($old_pkg)"
	fi
done
if grep -q "$PANEL_PKG" "$PATCH"; then
	echo "③ 补丁行已存在,不动:$PATCH"
else
	# 模板给的补丁层是「注释 + 一行 []」。[] 是 flow 风格的空调色板,
	# 后面再追加 block 列表项就成了非法 YAML —— 所以追加前必须把那一行摘掉。
	# (判空不能只看「去掉空白后是不是 []」:注释文本也在文件里。)
	if grep -qE '^[[:space:]]*\[\][[:space:]]*$' "$PATCH"; then
		grep -vE '^[[:space:]]*\[\][[:space:]]*$' "$PATCH" > "$PATCH.tmp"
		mv "$PATCH.tmp" "$PATCH"
	fi
	cat >> "$PATCH" <<YAML

# ClearAI 宿主包(宿主平面:客户端模块扫描只扫宿主 Loader 的行,所以它必须在补丁层)
- insert:
    - id: clearai-host
      name: '$PANEL_PKG'
YAML
	echo "③ 已追加补丁行:$PATCH"
	echo "   补丁层是 live 重载(profile manifest 的 patchReload):改完不必重启,浏览器刷新页面即可。"
	echo "   若宿主未在监视补丁文件,重启 dsh 后再刷新。"
fi

echo
echo "装好了(**开发形态**;产品形态见 tools/install-native.mjs)。验收:"
echo "  · 起一个新的 ClearAI 会话(预设选择器里选「ClearAI」)"
echo "  · 中栏应出现「产物」页;右栏「+」里应有「进展 / 世界树 / 外脑」"
echo "  · 输入框下方应出现一行派生状态(含「需要你 N」)"
echo
echo "装完自检(用**部署出去的文件**做一次真实装配,绕开 ESM 缓存):"
if node "$HERE/tools/verify-deploy.mjs"; then
	echo "自检通过。运行期仍要重启宿主:内核按 URL 缓存(见 ROADMAP 开发纪律 1)。"
else
	echo "自检没过 —— 先别用,看上面的报错。" >&2
	exit 1
fi
