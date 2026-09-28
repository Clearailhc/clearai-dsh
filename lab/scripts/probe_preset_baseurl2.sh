#!/usr/bin/env bash
set -uo pipefail
NEW_DSH=/tmp/dsh-cli-017/node_modules/.bin/dsh
OLD_DSH=/home/lhc/.npm/_npx/1e7f6d9597241db0/node_modules/.bin/dsh
NPM_CACHE=/tmp/npm-cache-probe

echo "########## A':新宿主 0.1.7-rc.2,换端口绕开占用,!!js 打印 baseUrl ##########"
PKG=/tmp/probe-preset-new2; rm -rf "$PKG"; mkdir -p "$PKG/presets/probe/skills" "$PKG/presets/probe/plugins"
cat > "$PKG/package.json" <<'JSON'
{ "name": "probe-preset", "version": "0.0.3", "private": true,
  "dsh": { "bundle": { "patch": ["./cordis.patch.yml", "./presets/probe.patch.yml"] } } }
JSON
printf '# 探针\n[]\n' > "$PKG/cordis.patch.yml"
echo "// rel probe" > "$PKG/presets/probe/plugins/relative-probe.js"
echo "# skill" > "$PKG/presets/probe/skills/README.md"
cat > "$PKG/presets/probe.patch.yml" <<'YML'
- insert:
    - id: preset-probe
      name: '@deepseek-ai/dsh-agent-preset'
      config:
        id: probe
        name: Probe
        description: 探针预设
        order: 99
        plugins:
          - id: skill-filesystem
            name: '@deepseek-ai/dsh-skill-filesystem'
            config:
              customSkillDirs:
                - !!js "(function(){ var u = process.getBuiltinModule('node:url'); var p = u.fileURLToPath(new URL('skills/', baseUrl)); process.getBuiltinModule('node:process').stderr.write('PROBE_BASEURL=' + String(baseUrl) + ' RESOLVED=' + p + '\n'); return p })()"
          - id: probe-relative
            name: './plugins/relative-probe.js'
YML
( cd "$PKG" && npm pack --cache "$NPM_CACHE" --pack-destination "$PKG" >/dev/null 2>&1 )
rm -rf /tmp/probe-home-a2; mkdir -p /tmp/probe-home-a2; export DSH_HOME=/tmp/probe-home-a2
"$NEW_DSH" --profile web --dump-config >/dev/null 2>&1
"$NEW_DSH" plugin --profile web add "$PKG/probe-preset-0.0.3.tgz" >/dev/null 2>&1; echo "add=$?"
timeout 30 "$NEW_DSH" --profile web --port 3199 > /tmp/probe-boot-a2.log 2>&1
echo "boot 退出码: $?"
echo "--- PROBE 读数 ---"; grep -n "PROBE_BASEURL" /tmp/probe-boot-a2.log || echo "(未抓到)"
echo "--- 启动结果 ---"; head -6 /tmp/probe-boot-a2.log
echo "--- 有没有 preset-probe / relative-probe 相关的失败 ---"
grep -n -i "preset-probe\|relative-probe\|probe" /tmp/probe-boot-a2.log | head -20 || echo "(无)"
echo "--- 新宿主启动日志文件 ---"; ls -t /tmp/probe-home-a2/logs/ 2>/dev/null | head -3
LATEST=$(ls -t /tmp/probe-home-a2/logs/startup-*.log 2>/dev/null | head -1)
if [ -n "$LATEST" ]; then echo "--- 启动日志里的 preset 行 ---"; grep -n -i "preset\|baseUrl\|probe" "$LATEST" | head -20; fi

echo
echo "########## B':旧宿主 0.1.5-rc.1 —— 干净 profile 不装任何包(对照组)##########"
rm -rf /tmp/probe-home-b2; mkdir -p /tmp/probe-home-b2; export DSH_HOME=/tmp/probe-home-b2
"$OLD_DSH" --profile web --dump-config >/dev/null 2>&1; echo "init=$?"
timeout 20 "$OLD_DSH" --profile web --port 3198 > /tmp/probe-boot-b2.log 2>&1
echo "旧宿主干净 profile boot 退出码: $?"
head -12 /tmp/probe-boot-b2.log

echo
echo "########## B'':旧宿主 0.1.5-rc.1 装探针包 ##########"
export DSH_HOME=/tmp/probe-home-b2
"$OLD_DSH" plugin --profile web add /tmp/probe-preset-old/probe-preset-0.0.1.tgz >/dev/null 2>&1; echo "add=$?"
"$OLD_DSH" --profile web --dump-config > /tmp/probe-dump-b2.yml 2>/tmp/probe-dump-b2.err; echo "dump=$?"
echo "--- dump 里 preset-probe 段 ---"; grep -n -A6 "preset-probe" /tmp/probe-dump-b2.yml | head -12 || echo "(dump 里没有 preset-probe)"
echo "--- dump stderr ---"; head -8 /tmp/probe-dump-b2.err
timeout 20 "$OLD_DSH" --profile web --port 3198 > /tmp/probe-boot-b3.log 2>&1
echo "旧宿主装包后 boot 退出码: $?"
head -14 /tmp/probe-boot-b3.log
