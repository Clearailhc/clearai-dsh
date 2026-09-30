#!/usr/bin/env bash
# 探针:在新机制宿主(0.1.7-rc.2)上,preset 声明行的 config.plugins 里,
# 相对 name(./x.js)与 !!js 里的 baseUrl 各相对谁。
# 只读地建一个一次性 DSH_HOME,不动任何真实 profile。
set -uo pipefail

DSH="${DSH_CLI:-/tmp/dsh-cli-017/node_modules/.bin/dsh}"
PKG=/tmp/probe-preset
HOME_DIR=/tmp/probe-home-1
NPM_CACHE=/tmp/npm-cache-probe

echo "=== dsh: $DSH ($("$DSH" --version 2>&1)) ==="
rm -rf "$PKG" "$HOME_DIR"
mkdir -p "$PKG/presets/probe/skills"

cat > "$PKG/package.json" <<'JSON'
{
  "name": "probe-preset",
  "version": "0.0.1",
  "private": true,
  "dsh": { "bundle": { "patch": ["./cordis.patch.yml", "./presets/probe.patch.yml"] } }
}
JSON

cat > "$PKG/cordis.patch.yml" <<'YML'
# 探针包的宿主补丁:什么都不插,只为让 patch 数组有两个元素。
[]
YML

cat > "$PKG/presets/probe.patch.yml" <<'YML'
# 探针:声明行 + 两类"相对基准"的表达式
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
                - !!js "process.getBuiltinModule('node:url').fileURLToPath(new URL('skills/', baseUrl))"
          - id: probe-relative
            name: './plugins/relative-probe.js'
YML

mkdir -p "$PKG/presets/probe/plugins"
echo "// 相对路径探针" > "$PKG/presets/probe/plugins/relative-probe.js"
echo "# probe skill" > "$PKG/presets/probe/skills/README.md"

echo "=== 打包 ==="
( cd "$PKG" && npm pack --cache "$NPM_CACHE" --pack-destination /tmp >/dev/null 2>&1 )
ls -la /tmp/probe-preset-0.0.1.tgz || { echo "打包失败"; exit 1; }

export DSH_HOME="$HOME_DIR"
echo "=== 初始化 profile ==="
"$DSH" --profile web --dump-config >/dev/null 2>&1
echo "profile 初始化退出码: $?"

echo "=== plugin add ==="
"$DSH" plugin --profile web add /tmp/probe-preset-0.0.1.tgz 2>&1 | tail -15
echo "add 退出码: $?"

echo "=== dump-config 里与 preset-probe / 相对路径 / baseUrl 有关的原文 ==="
"$DSH" --profile web --dump-config > /tmp/probe-dump.yml 2>/tmp/probe-dump.err
echo "dump 退出码: $?  行数: $(wc -l < /tmp/probe-dump.yml)"
echo "--- stderr ---"; sed -n '1,20p' /tmp/probe-dump.err
echo "--- preset-probe 段落 ---"
grep -n -A28 "preset-probe" /tmp/probe-dump.yml | head -60
echo "--- 所有含 skills/ 的求值结果 ---"
grep -n "skills/" /tmp/probe-dump.yml | head -10
echo "--- 所有含 relative-probe 的行 ---"
grep -n "relative-probe" /tmp/probe-dump.yml | head -10
echo
echo "=== 名册相关行(agent-preset-registry) ==="
grep -n -A6 "agent-preset-registry" /tmp/probe-dump.yml | head -20
