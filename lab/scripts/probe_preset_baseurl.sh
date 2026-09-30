#!/usr/bin/env bash
# 探针 A:新宿主上,preset 声明行里 plugins 的 baseUrl 与相对 name 相对谁 ——
#         让 !!js 求值时把答案写进 stderr。
# 探针 B:同一份包在旧宿主(0.1.5-rc.1)上会怎样 —— 检验"两代共用一个包"是否可能。
set -uo pipefail
NEW_DSH=/tmp/dsh-cli-017/node_modules/.bin/dsh
OLD_DSH=/home/lhc/.npm/_npx/1e7f6d9597241db0/node_modules/.bin/dsh
NPM_CACHE=/tmp/npm-cache-probe

build_pkg() { # $1=dir $2=version
  rm -rf "$1"; mkdir -p "$1/presets/probe/skills" "$1/presets/probe/plugins"
  cat > "$1/package.json" <<JSON
{ "name": "probe-preset", "version": "$2", "private": true,
  "dsh": { "bundle": { "patch": ["./cordis.patch.yml", "./presets/probe.patch.yml"] } } }
JSON
  printf '# 探针包宿主补丁\n[]\n' > "$1/cordis.patch.yml"
  echo "// 相对路径探针" > "$1/presets/probe/plugins/relative-probe.js"
  echo "# probe skill" > "$1/presets/probe/skills/README.md"
  cat > "$1/presets/probe.patch.yml" <<'YML'
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
                - !!js "process.getBuiltinModule('node:process').stderr.write('PROBE_BASEURL=' + String(baseUrl) + '\n') || process.getBuiltinModule('node:url').fileURLToPath(new URL('skills/', baseUrl))"
          - id: probe-relative
            name: './plugins/relative-probe.js'
YML
  ( cd "$1" && npm pack --cache "$NPM_CACHE" --pack-destination "$1" >/dev/null 2>&1 )
}

echo "################ 探针 A:新宿主 0.1.7-rc.2 ################"
echo "--- 探针 A:构建 ---"
build_pkg /tmp/probe-preset-new 0.0.2
ls /tmp/probe-preset-new/*.tgz
echo "--- 探针 A:空 home + 安装 ---"
rm -rf /tmp/probe-home-new; mkdir -p /tmp/probe-home-new
export DSH_HOME=/tmp/probe-home-new
"$NEW_DSH" --profile web --dump-config >/dev/null 2>&1; echo "init=$?"
"$NEW_DSH" plugin --profile web add /tmp/probe-preset-new/probe-preset-0.0.2.tgz 2>&1 | tail -4
echo "--- 探针 A:真 boot(25s 后掐断),抓 stderr ---"
timeout 25 "$NEW_DSH" --profile web > /tmp/probe-boot-new.log 2>&1
echo "boot 退出码: $?(124=被 timeout 掐断,属预期)"
echo "--- 关键读数 ---"
grep -n "PROBE_BASEURL" /tmp/probe-boot-new.log || echo "(没有抓到 PROBE_BASEURL)"
echo "--- 日志里与 preset / probe 有关的行 ---"
grep -n -i "preset\|probe\|relative-probe\|skill-filesystem" /tmp/probe-boot-new.log | head -25
echo "--- 日志头 20 行 ---"
head -20 /tmp/probe-boot-new.log
echo
echo "################ 探针 B:旧宿主 0.1.5-rc.1 装同一个包 ################"
echo "旧 dsh 版本: $("$OLD_DSH" --version 2>&1)"
echo "--- 探针 B:构建 ---"
build_pkg /tmp/probe-preset-old 0.0.1
ls /tmp/probe-preset-old/*.tgz
echo "--- 探针 B:空 home + 安装 ---"
rm -rf /tmp/probe-home-old; mkdir -p /tmp/probe-home-old
export DSH_HOME=/tmp/probe-home-old
"$OLD_DSH" --profile web --dump-config >/dev/null 2>&1; echo "init=$?"
"$OLD_DSH" plugin --profile web add /tmp/probe-preset-old/probe-preset-0.0.1.tgz 2>&1 | tail -4
echo "--- 探针 B:旧宿主 boot(20s 后掐断) ---"
timeout 20 "$OLD_DSH" --profile web > /tmp/probe-boot-old.log 2>&1
echo "boot 退出码: $?"
echo "--- 旧宿主日志里与 preset / probe 有关的行 ---"
grep -n -i "preset\|probe\|Cannot find\|ERR_MODULE" /tmp/probe-boot-old.log | head -25
echo "--- 旧宿主日志头 20 行 ---"
head -20 /tmp/probe-boot-old.log
