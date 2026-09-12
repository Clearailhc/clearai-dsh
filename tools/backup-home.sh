#!/usr/bin/env bash
# 开发安装的**备份 / 回滚**(§27c)。
#
# 为什么有它:2026-09-12 我装了一版让用户无法新建对话,而他只能手动 git 恢复 —— 缺的
# 就是这一步。开发安装会覆写 ~/.dsh 的三个落点;覆写之前先把它们打包存起来,
# 出问题时一条命令回到上一版。
#
#   bash tools/backup-home.sh backup     # 打一份快照到 $DSH_HOME-backup/<时间戳>/
#   bash tools/backup-home.sh list       # 列出所有快照
#   bash tools/backup-home.sh rollback   # 回到最近一份快照(会先给"当前状态"再打一份)
#   bash tools/backup-home.sh rollback <时间戳>
#
# 保留最近 5 份(多的按时间删掉)。快照只装**我们动过的那三处**,不整份拷家目录。
set -euo pipefail

DSH_HOME="${DSH_HOME:-$HOME/.dsh}"
BACKUP_ROOT="${DSH_HOME}-backup"
KEEP=5

PRESET_DIR="$DSH_HOME/.agent-presets/clearai"
PANEL_DIR="$DSH_HOME/profiles/web/node_modules/@clearai/dsh"
PATCH_FILE="$DSH_HOME/profiles/web/cordis.patch.yml"

usage() {
	echo "用法: bash tools/backup-home.sh [backup|list|rollback [时间戳]]" >&2
	exit 2
}

snapshot() {
	local stamp="$1"
	local dir="$BACKUP_ROOT/$stamp"
	mkdir -p "$dir"
	[ -d "$PRESET_DIR" ] && cp -a "$PRESET_DIR" "$dir/preset" || true
	[ -d "$PANEL_DIR" ] && cp -a "$PANEL_DIR" "$dir/panel" || true
	[ -f "$PATCH_FILE" ] && cp -a "$PATCH_FILE" "$dir/cordis.patch.yml" || true
	printf '%s\n' "$DSH_HOME" > "$dir/DSH_HOME"
	echo "$dir"
}

prune() {
	# 只保留最近 KEEP 份(按名字排序 = 按时间排序,时间戳是 ISO 形状)
	local all
	all="$(ls -1 "$BACKUP_ROOT" 2>/dev/null | sort | head -n -"$KEEP" || true)"
	for old in $all; do
		[ -n "$old" ] && rm -rf "${BACKUP_ROOT:?}/$old"
	done
}

newest() {
	ls -1 "$BACKUP_ROOT" 2>/dev/null | sort | tail -1
}

case "${1:-}" in
	backup)
		stamp="$(date +%Y%m%dT%H%M%S)"
		dir="$(snapshot "$stamp")"
		prune
		echo "已备份:$dir"
		;;
	list)
		[ -d "$BACKUP_ROOT" ] || { echo "(还没有快照)"; exit 0; }
		ls -1 "$BACKUP_ROOT" | sort | while read -r name; do
			printf '%s  %s\n' "$name" "$(du -sh "$BACKUP_ROOT/$name" 2>/dev/null | cut -f1)"
		done
		;;
	rollback)
		target="${2:-$(newest)}"
		[ -n "$target" ] || { echo "没有可回滚的快照" >&2; exit 1; }
		dir="$BACKUP_ROOT/$target"
		[ -d "$dir" ] || { echo "找不到快照:$dir" >&2; exit 1; }
		# 回滚之前,先把**当前**这一份也存下来(回滚本身也可回滚)
		current="$(snapshot "before-rollback-$(date +%Y%m%dT%H%M%S)")"
		echo "当前状态已存:$current"
		[ -d "$dir/preset" ] && rm -rf "$PRESET_DIR" && mkdir -p "$(dirname "$PRESET_DIR")" && cp -a "$dir/preset" "$PRESET_DIR"
		[ -d "$dir/panel" ] && rm -rf "$PANEL_DIR" && mkdir -p "$(dirname "$PANEL_DIR")" && cp -a "$dir/panel" "$PANEL_DIR"
		[ -f "$dir/cordis.patch.yml" ] && cp -a "$dir/cordis.patch.yml" "$PATCH_FILE"
		echo "已回滚到:$target(重启 dsh web 后生效:内核按 URL 缓存)"
		;;
	*) usage ;;
esac
