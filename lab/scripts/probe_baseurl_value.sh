#!/usr/bin/env bash
# 探针 D:声明行 plugins 里解析 name 时,baseUrl 到底是什么值。
# 手法:把 name 写成一个逗号表达式 —— 先打印 baseUrl 到 stderr,再返回一个必然解析不了的包名,
# 于是宿主会把它记进 roster 的 broken 里(证明这一行确实进入了挂载),同时我们拿到 baseUrl 原值。
set -uo pipefail
DSH=/tmp/dsh-cli-017/node_modules/.bin/dsh
PKG=/tmp/probe-baseurl; rm -rf "$PKG"; mkdir -p "$PKG/presets"
cat > "$PKG/package.json" <<'JSON'
{ "name": "probe-baseurl", "version": "0.0.7", "private": true, "dsh": { "bundle": { "patch": "./p.yml" } } }
JSON
cat > "$PKG/p.yml" <<'YML'
- insert:
    - id: preset-probe
      name: '@deepseek-ai/dsh-agent-preset'
      config:
        id: probe
        order: 99
        plugins:
          - id: probe-print
            name: !!js "(process.getBuiltinModule('node:process').stderr.write('PROBE_BASEURL=' + String(baseUrl) + '\n'), 'no-such-package-xyz')"
YML
( cd "$PKG" && npm pack --cache /tmp/npm-cache-probe --pack-destination "$PKG" >/dev/null 2>&1 )
rm -rf /tmp/probe-home-baseurl; mkdir -p /tmp/probe-home-baseurl
export DSH_HOME=/tmp/probe-home-baseurl
"$DSH" --profile web --dump-config >/dev/null 2>&1
"$DSH" plugin --profile web add "$PKG/probe-baseurl-0.0.7.tgz" >/dev/null 2>&1
echo "=== boot(25s 掐断),抓 stderr 里的 PROBE_BASEURL ==="
timeout 25 "$DSH" --profile web --port 3192 --no-open > /tmp/probe-baseurl.log 2>&1
echo "boot 退出码=$?"
grep -n "PROBE_BASEURL" /tmp/probe-baseurl.log || echo "(没有抓到)"
echo
echo "=== 再用名册读一次 broken(确认探针行真的挂载了)==="
cd /home/lhc/Project/clearai-dsh && DSH_HOME=/tmp/probe-home-baseurl timeout 60 node lab/scripts/read_preset_roster.mjs 2>&1 | grep -A4 '"id": "probe"' | head -12
