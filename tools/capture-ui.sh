#!/usr/bin/env bash
# capture-ui —— 在一个**一次性 DSH_HOME** 里装出插件、起 web、用真浏览器截面板图。
#
# 为什么要有它(2026-09-12 的教训):面板以前从没在浏览器里被真正打开过——package 里的
# 客户端 bundle 用旧包名注册自己,浏览器直接拒绝注册,四个面板一起静默消失。
# 单测、打包自检、真跑全都绿。**只有真浏览器能抓到这个。**
#
# 这个脚本做四件事:
#   ① 建一次性 DSH_HOME(拷真实 home 的凭据/设置,摘掉开发形态残留);
#   ② 用 install-native 把**装出来的包**装进 profile;
#   ③ 起 `dsh web`(端口给参数);
#   ④ 起一个带调试端口的 Chrome,之后用 tools/ui-drive.mjs 驱动它。
#
# 用法:
#   bash tools/capture-ui.sh start [端口] [工作区]     # 起环境(前台打印 URL)
#   bash tools/capture-ui.sh stop                      # 收工(停 web 与 Chrome)
#
# 它**不**替你做交互;交互与截图用:
#   node tools/ui-drive.mjs click "世界树"
#   node tools/ui-drive.mjs shot docs/shots/worldlines.png
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
ACTION="${1:-start}"
PORT="${2:-3091}"
WORKSPACE="${3:-/tmp/clearai-case-ai4sci}"
HOME_DIR="/tmp/clearai-shots"
CHROME_DIR="/tmp/clearai-chrome"
CDP_PORT="${CDP_PORT:-9333}"

if [ "$ACTION" = "stop" ]; then
	pkill -f "remote-debugging-port=$CDP_PORT" 2>/dev/null
	pkill -f "dsh web --port $PORT" 2>/dev/null
	echo "已收工(web :$PORT,chrome :$CDP_PORT)"
	exit 0
fi

set -e
rm -rf "$HOME_DIR"
cp -a "${DSH_HOME_SOURCE:-$HOME/.dsh}" "$HOME_DIR"
# 摘掉开发形态的残留(它们不在发行物里)
rm -rf "$HOME_DIR/.agent-presets/clearai" "$HOME_DIR/profiles/web/node_modules/@clearai" "$HOME_DIR/profiles/web/node_modules/clearai-dsh"
python3 - "$HOME_DIR" <<'PY'
import sys
from pathlib import Path
p = Path(sys.argv[1]) / 'profiles' / 'web' / 'cordis.patch.yml'
if p.exists():
    blocks = p.read_text().split('\n- insert:')
    p.write_text('\n- insert:'.join([blocks[0]] + [b for b in blocks[1:] if 'clearai' not in b]))
PY

mkdir -p "$WORKSPACE"
python3 - "$HOME_DIR" "$WORKSPACE" <<'PY'
import datetime, json, sys, uuid
from pathlib import Path
home, case = Path(sys.argv[1]), sys.argv[2]
p = home / 'storages' / 'workspace.json'
data = json.loads(p.read_text())
wid = str(uuid.uuid4())
now = datetime.datetime.now(datetime.timezone.utc).isoformat().replace('+00:00', 'Z')
data['tables']['workspaces'][wid] = {"path": case, "title": Path(case).name, "sessionIds": [], "createdAt": now, "updatedAt": now}
data['global']['workspaceIds'] = [wid] + [w for w in data['global'].get('workspaceIds', []) if w != wid]
p.write_text(json.dumps(data, ensure_ascii=False, indent=2))
PY

cd "$ROOT"
node tools/build-package.mjs >/dev/null
DSH_HOME="$HOME_DIR" node tools/install-native.mjs --home "$HOME_DIR" --profile web --from-default web --dist dist/clearai-dsh | tail -6

echo
echo "下一步(两个终端):"
echo "  1) DSH_HOME=$HOME_DIR npx --no-install @deepseek-ai/dsh web --port $PORT --no-open"
echo "  2) 把打印出来的 http://127.0.0.1:$PORT/?token=… 交给 Chrome:"
echo "     google-chrome --headless=new --no-sandbox --window-size=1680,1050 \\"
echo "       --remote-debugging-port=$CDP_PORT --user-data-dir=$CHROME_DIR '<URL>'"
echo "  3) node tools/ui-drive.mjs shot docs/shots/xxx.png"
