# clearai-dsh 0.2.3 发布前置核查

- 采集时间:2026-09-28 10:31 (+08:00)
- 采集时的 HEAD:`e362acc1832006d92c8e29838233510c42b55c23`
- 原始输出留档:`lab/release/preflight-raw.txt`(本报告所有输出逐字取自该文件)

## 结论

四项检查全部通过,**当前没有任何东西挡着发布**;发布缺的只是「tag 与 registry 上的存在」。

| # | 检查项 | 结果 |
|---|---|---|
| 0 | 工作树 / HEAD 与 origin/main 同步 | ✅ HEAD = origin/main = `e362acc`,工作树无已跟踪改动 |
| 1 | `package.json` 版本与 CHANGELOG 段落标题一致 | ✅ 两边都是 `0.2.3` |
| 2 | CHANGELOG 的 0.2.3 段落能被发布流程抽取 | ✅ 正文与标题都能正常抽出 |
| 3 | `e362acc` 上 CI 的结论 | ✅ run 35857872272,`success` |
| 4 | npm registry 上是否已有 0.2.3 | ✅ 尚无(幂等分支不会触发) |
| 5 | tag 现状 | ✅ 本地与远端都只有到 `v0.2.2`,没有 `v0.2.3` |

## 检查 0:基线同步

```
$ git rev-parse HEAD
e362acc1832006d92c8e29838233510c42b55c23

$ git rev-parse origin/main
e362acc1832006d92c8e29838233510c42b55c23

$ git status --short
?? lab/release/
```

工作树里唯一的未跟踪项是本报告所在的 `lab/release/`,不进入发布物。**发布将从 `e362acc` 出发**:tag 打在这个 commit 上,registry 上的那一份也必须由它构建——这正是发布流程最后一步逐文件比对的对象。

## 检查 1:版本一致性(tag 与 manifest 必须相等)

```
$ node -p "require('./package.json').version"
0.2.3

$ grep -n '^## \[0.2.3\]' CHANGELOG.md
5:## [0.2.3] — 2026-09-23
```

`release.yml` 的第一道门是「tag 去掉 `v` 之后必须等于 `package.json` 的 version」。`package.json` 是 `0.2.3`,于是要被推送的 tag 只能是 `v0.2.3`。CHANGELOG 里 0.2.3 段落标记的日期是 09-23(内容写就之日),与本次打 tag 的日期 09-28 不同——这是两件不同的事,不去改 `main` 上已提交的历史。

## 检查 2:发布说明能被抽出来

`release.yml` 最后一步的 GitHub Release 说明**不是** `--generate-notes` 生成的,而是用 `tools/changelog-section.mjs` 从 CHANGELOG 里抽该版本那一段(唯一账本)。抽取器必须能认出新版本:

```
$ node tools/changelog-section.mjs 0.2.3
**文档与版本信息更新。**

### Changed

- 更新项目版本至 `0.2.3`。
- 更新中文 README。
- 更新 README。

$ node tools/changelog-section.mjs 0.2.3 --title
clearai-dsh 0.2.3 — 文档与版本信息更新。
```

正文与标题都在,Release 说明不会退化成空文件或只有版本号。

## 检查 3:同一 commit 上的 CI 是绿的

发布流程会自己跑一遍套件与打包自检,但**同一棵树上已经绿过一次**是更强的信号:它说明失败(如果有)不会来自源码,而只会来自发布路径本身(身份、registry)。

```
$ gh run view 35857872272 --json databaseId,name,headSha,headBranch,event,status,conclusion,createdAt,url
{"conclusion":"success","createdAt":"2026-09-23T12:00:52Z","databaseId":35857872272,"event":"push",
 "headBranch":"main","headSha":"e362acc1832006d92c8e29838233510c42b55c23","name":"CI","status":"completed",
 "url":"https://github.com/Clearailhc/clearai-dsh/actions/runs/35857872272"}
```

`headSha` 与将要打 tag 的 commit 逐字相同。`main` 分支最近三次 push 的 CI 也都是 `success`。

## 检查 4:registry 上还没有 0.2.3

```
$ curl -sS https://registry.npmjs.org/clearai-dsh   # 取 dist-tags 与 versions
dist-tags: {"latest":"0.2.2"}
versions: 0.1.0, 0.1.1, 0.1.2, 0.1.3, 0.1.4, 0.1.5, 0.1.6, 0.1.7, 0.2.0, 0.2.1, 0.2.2
has 0.2.3: false
```

`latest` 仍是 `0.2.2`,`versions` 到 `0.2.2` 为止。两点含义:一是这次推送会真的走「发布」分支而不是幂等跳过(`release.yml` 会先 `npm view` 查一遍);二是发布成功后 `dist-tags.latest` 应当从 `0.2.2` 前进到 `0.2.3`——这就是回查时要验证的位移。

(本机 npm 缓存目录只读,`npm view` 会以 `EROFS` 失败,所以这里直接用 registry HTTP 接口 + Node 解析;发布本身在 GitHub Actions 上跑,不受影响。)

## 检查 5:tag 现状

```
$ git tag -l 'v0.2.*'
v0.2.0
v0.2.1
v0.2.2

$ git ls-remote --tags origin 'v0.2.*'
24be58ccce6d5223837dad12a9edb046ef96f980	refs/tags/v0.2.0
b3969650760e216831fd9b5bf48aa3974ec0afc7	refs/tags/v0.2.0^{}
c38143dd14c393220c36ef322df1ca229cda7097	refs/tags/v0.2.1
b870978a1bd1c17913943c361a951654a2dac29f	refs/tags/v0.2.1^{}
689d5c71d22e275ad1b01ad33f0ebe97d78a5a85	refs/tags/v0.2.2
91dcb2ab11d1a4d8fe8d5d8ff4697447bb190c25	refs/tags/v0.2.2^{}
```

本地与远端都没有 `v0.2.3`,不存在覆盖既有 tag 的风险。历史 tag 都带 `^{}` 解引用行,说明它们是 **annotated tag**(携带自己的对象与消息),新 tag 沿用同一形态。

## 下一步

在 `e362acc` 上创建 annotated tag `v0.2.3`(消息沿用历史风格),推送到 origin,由 `release.yml` 完成发布与回查。
