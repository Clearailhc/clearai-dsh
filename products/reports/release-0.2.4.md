# clearai-dsh 0.2.4 发布报告

- 发布日:2026-09-28
- 发布提交:`e4e3b3131c53e4ee054782ee34710368ef5397e0`
- 流水线:tag `v0.2.4` → release run [36373961380](https://github.com/Clearailhc/clearai-dsh/actions/runs/36373961380),**15 步全绿**
- **结论:0.2.4 已发布。** 三个对象(tag / npm / GitHub Release)在同一个提交上存在且相互一致。

## 一、三对象的最终状态

| 对象 | 实测 | 证据 |
|---|---|---|
| 远端 tag | `899a1781…refs/tags/v0.2.4`,解引用 `e4e3b31…` | `git ls-remote --tags origin v0.2.4` |
| npm | `clearai-dsh@0.2.4`,`dist-tags.latest = 0.2.4`,`gitHead = e4e3b31…` | registry packument;tarball 1376417 字节、137 个文件、解包版本 0.2.4 |
| GitHub Release | [v0.2.4 — 跟上了宿主的预设换代](https://github.com/Clearailhc/clearai-dsh/releases/tag/v0.2.4) | `gh release view v0.2.4`;说明与 `changelog-section.mjs 0.2.4` 输出**去尾后逐字一致**(仅差 GitHub 补的一个换行) |

`gitHead` 等于发布提交是一条很强的独立证据:npm 在发布时从 git 检出自动记录它,证明 registry 上那一份确实构建自 `e4e3b31`。发布流程自己的第 14 步还做了一次 `diff -r` 逐文件比对(registry 上的 tarball vs 本 commit 构建的 `dist/clearai-dsh`),也是绿的。

## 二、这一版修的是什么

宿主 `@deepseek-ai/dsh` 从 `0.1.7-alpha.1` 起换掉了 agent 预设的注册机制:

| | 旧(≤0.1.6-alpha.2) | 新(≥0.1.7-alpha.1) |
|---|---|---|
| 名册行 | `agent-presets`(自带补丁提供,我们用一条覆盖把 root 指到包内 `presets/`) | `agent-preset-registry`,config 只剩 `default / selectedDefault` |
| 预设从哪来 | **目录扫描**(root + trust) | **组合里的声明行** `- id: preset-<id>`,plugins 里放整份插件列表 |
| 包怎么声明 | `dsh.bundle.patch` 单文件 | 数组,每个预设一个补丁文件 |

我们的覆盖补丁在新宿主里**没有落点**,于是包能装、宿主行能起,但 **ClearAI 不进模式选择器**。

0.2.4 做了四件事:

1. **新增预设声明行** `presets/clearai/clearai.patch.yml`,由 `preset/agent.cordis.yml` 构建期派生(生成物进仓库,与 `ui/vendor/*.js` 同一条纪律);`dsh.bundle.patch` 改成数组。
2. **包内插件改用包内子路径**(`clearai-dsh/presets/clearai/plugins/*.js` + `exports` 里放行 `"./presets/*"`)。声明行 plugins 的相对基准与原来的 `agent.cordis.yml` 不同,不改就会一直「never started」。
3. **workflow 引擎换包**:`@deepseek-ai/dsh-workflow-worker-thread` 在新宿主已下线,改为同 group 内的 `@deepseek-ai/dsh-workflow-ptc`(必须与 `tool-workflow` / `tool-ralph` 同处那个 `isolate: { workflowEngine: true }` 的 realm)。
4. **把验收升级成会看运行态的门**:`verify-clean-install.mjs` 新增两条断言——boot 一次 profile、直接读 `agentPresets.list()`,要求 `clearai` 在列表里**且没有 `broken`**。

## 三、预设在新宿主上真的可用的证据

写在 CI 日志里(第三方生成、可交叉核对 run id 与 commit sha):

```
装到的版本:clearai-dsh@0.2.4
· 宿主的名册机制:声明行(≥0.1.7-alpha.1)
✓ ④ 新机制:名册注册表行在(agent-preset-registry)
✓ ④′ 新机制:预设声明行在,且 id/name/description/order/plugins 齐备
· 名册条目:standard, ptc, minimal, cordis, clearai
✓ ④″ 名册运行态:clearai 在列表里
✓ ④‴ 名册运行态:clearai 没有 broken(子插件真的起来了)
```

这条门是被 0.2.3 那次失败逼出来的:**静态检查发现不了这件事**——探针实测过,preset 里放一个根本不存在的插件,`boot` 依然完全正常,只有名册记一条 broken,界面就不显示它。要抓它只能读运行态。

另外,发布前后各做过一次**人工界面确认**(临时实例,独立于用户正在用的 GUI):修复前用户答「没看到」,修复后答「能看到 ClearAI 了」——两次观察与 roster 的 broken 状态同步变化。

## 四、宿主支持边界(重要)

**本版要求宿主 ≥ `0.1.7-alpha.1`。**

- 旧宿主(≤0.1.6-alpha.2,包括曾被当作 `latest` 的 `0.1.5-rc.3`)上,本版会因为找不到 `@deepseek-ai/dsh-agent-preset` 而**让 profile 起不来**——比旧版的「预设不可见」更严重。
- 这不是取舍失误,是实测结论:两代宿主**无法共用一个包**。旧宿主 + 数组形式的 `patch` 会直接崩在 `loadProfileDirectory` 的 `path.join`;换成字符串则崩在 `ERR_MODULE_NOT_FOUND`。桥接插件能勉强凑,但复杂度远超这次适配本身。
- 仍留在旧宿主的部署请继续用 `0.2.2`。这条边界写在 CHANGELOG 的显著位置,也已随发布说明出现在 Release 页。

## 五、与 0.2.3 那次的对照

| | 0.2.3(被拦下) | 0.2.4(本次) |
|---|---|---|
| 干净安装这道门 | ✗ 两条断言红 | ✓ 18 项全过,含两条运行态断言 |
| 包与宿主机制 | 包按旧机制写,宿主已换代 | 包按新机制写,一致 |
| npm 副作用 | 无(publish 被 skip) | 已发布 |
| 教训 | 门绿了不等于东西可用 | 门本身升级成会看运行态 |

0.2.3 没有发布,它要带的三条文档改动(版本号 + 中英 README)并入 0.2.4。远端 `v0.2.3` tag 已按用户决定删除,删除前的对象原文留档在 `lab/adapter/0.2.3-tag-disposition-raw.txt`。

## 六、遗留

1. **本地 tag `v0.2.3` 仍在**(只删了远端)。`git push --tags` 会把那个孤儿标记推回去;要一并清掉:`git tag -d v0.2.3`。
2. **远端 `main` 停在 `e362acc`,没有前进到发布提交。** 本次只推了 tag。本地 HEAD 上叠着 ClearAI 的账本提交(每次交付一条),把它们推上主干不是这次发布该做的事;需要时单独处理。
3. **本机开发环境仍装着旧版**(`~/.dsh/profiles/web` 里是旧的开发形态部署),`npm test` 的「宿主」「客户端」两个套件因此在本地红(它们在 CI 里跳过)。修法是 `bash install.sh` 重装开发形态,但那会影响正在使用的环境,留给用户挑时机。
4. **旧宿主用户**:见第四节的边界。

## 七、产物索引

- 设计与实测依据:`lab/adapter/0.2.4-design.md`、`lab/release/0.2.3-release-blocker.md`
- 回查:`lab/adapter/0.2.4-verify.md` + `0.2.4-verify-raw.txt` + `0.2.4-run.json`
- 自检:`lab/adapter/0.2.4-selfcheck.md`、`0.2.4-npmtest.log`、`0.2.4-build-verify.log`、`0.2.4-gate-output.txt`
- 发布过程:`lab/adapter/0.2.4-push.txt`、`lab/adapter/0.2.3-tag-disposition.md`
- 上一次失败的完整记录:`products/reports/release-0.2.3.md`
