// 0.2.3 发布回查:对三个对象(tag / npm registry / GitHub Release)各自取独立证据。
//
// 本机 npm 缓存目录只读(npm view 会 EROFS),所以这里全部走 registry 的 HTTP 接口,
// 不依赖 npm CLI。脚本只读:不改远端、不写工作区(除了卸载 tarball 到 lab/release/unpacked)。
//
// 用法:node lab/scripts/verify_release_023.mjs
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

const VERSION = '0.2.3'
const TAG = `v${VERSION}`
const PKG = 'clearai-dsh'
const EXPECTED_COMMIT = 'e362acc1832006d92c8e29838233510c42b55c23'
const OUT_DIR = 'lab/release'
const UNPACK_DIR = join(OUT_DIR, 'unpacked')

const lines = []
const say = (s = '') => { lines.push(s); console.log(s) }
const h = (s) => say(`\n## ${s}\n`)

const raw = {}

async function getJson(url) {
  const res = await fetch(url, { headers: { 'user-agent': 'clearai-release-verify' } })
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`)
  return res.json()
}

// ---------- 1. registry:版本存在性与 dist-tags ----------
h('1. npm registry:0.2.3 是否存在')
let packument
try {
  packument = await getJson(`https://registry.npmjs.org/${PKG}`)
  raw.distTags = packument['dist-tags']
  raw.versionKeys = Object.keys(packument.versions || {})
  const v = packument.versions?.[VERSION]
  say('```')
  say(`dist-tags: ${JSON.stringify(packument['dist-tags'])}`)
  say(`versions: ${raw.versionKeys.join(', ')}`)
  say(`latest is ${VERSION}: ${packument['dist-tags']?.latest === VERSION}`)
  say(`versions 含 ${VERSION}: ${!!v}`)
  say('```')
  if (v) {
    raw.dist = v.dist
    raw.gitHead = v.gitHead ?? null
    raw.npmUser = v._npmUser ?? null
    say(`dist.tarball: ${v.dist?.tarball}`)
    say(`dist.integrity: ${v.dist?.integrity}`)
    say(`gitHead: ${v.gitHead ?? '(packument 未记录)'}`)
    say(`_npmUser: ${JSON.stringify(v._npmUser ?? null)}`)
  }
} catch (e) {
  say(`FAIL: ${e.message}`)
}

// ---------- 2. tarball 下载与摘要核对 ----------
h('2. tarball 下载、摘要核对与解包')
let tarballPath = null
try {
  const url = raw.dist?.tarball
  if (!url) throw new Error('packument 里没有 0.2.3 的 tarball URL')
  const res = await fetch(url)
  if (!res.ok) throw new Error(`${res.status} 下载失败`)
  const buf = Buffer.from(await res.arrayBuffer())
  tarballPath = join(OUT_DIR, `${PKG}-${VERSION}.tgz`)
  writeFileSync(tarballPath, buf)
  const sha512 = createHash('sha512').digest('base64')
  const sha512b64 = createHash('sha512').update(buf).digest('base64')
  const sha1 = createHash('sha1').update(buf).digest('hex')
  const [algo, expectedB64] = String(raw.dist?.integrity || '').split('-')
  say('```')
  say(`tarball 字节数: ${buf.length}`)
  say(`sha512(cnpm 形制): ${algo}-${sha512b64}`)
  say(`packument integrity: ${raw.dist?.integrity}`)
  say(`摘要一致: ${algo === 'sha512' && expectedB64 === sha512b64}`)
  say(`shasum(sha1): ${sha1}`)
  say(`packument shasum: ${raw.dist?.shasum}`)
  say(`sha1 一致: ${sha1 === raw.dist?.shasum}`)
  say('```')
  raw.local = { bytes: buf.length, sha512: sha512b64, sha1 }

  rmSync(UNPACK_DIR, { recursive: true, force: true })
  mkdirSync(UNPACK_DIR, { recursive: true })
  execFileSync('tar', ['-xzf', tarballPath, '-C', UNPACK_DIR])
  const extracted = join(UNPACK_DIR, 'package')
  const inner = JSON.parse(readFileSync(join(extracted, 'package.json'), 'utf8'))
  raw.innerPackageJson = { name: inner.name, version: inner.version, repository: inner.repository }
  say(`解包内 package.json: name=${inner.name} version=${inner.version}`)
  say(`解包内 repository: ${JSON.stringify(inner.repository)}`)
  const listing = execFileSync('tar', ['-tzf', tarballPath], { encoding: 'utf8' })
    .trim().split('\n').filter((l) => !l.endsWith('/'))
  raw.tarballFiles = listing
  say(`tarball 内文件数(不含目录): ${listing.length}`)
  writeFileSync(join(OUT_DIR, 'tarball-files.txt'), listing.join('\n') + '\n')
} catch (e) {
  say(`FAIL: ${e.message}`)
}

// ---------- 3. provenance:这一份是谁在哪个 commit 上构建的 ----------
h('3. provenance attestation(来源证明)')
try {
  const att = await getJson(`https://registry.npmjs.org/-/npm/v1/attestations/${PKG}@${VERSION}`)
  raw.attestationCount = att.attestations?.length ?? 0
  say('```')
  say(`attestations: ${raw.attestationCount}`)
  for (const a of att.attestations || []) {
    say(`- predicateType: ${a.predicateType}`)
    const payloadB64 = a.bundle?.dsseEnvelope?.payload
    if (!payloadB64) continue
    const stmt = JSON.parse(Buffer.from(payloadB64, 'base64').toString('utf8'))
    raw.statement = stmt
    const wf = stmt.predicate?.buildDefinition?.externalParameters?.workflow
    const rd = stmt.predicate?.buildDefinition?.resolvedDependencies || []
    say(`  subject: ${JSON.stringify(stmt.subject)}`)
    say(`  workflow: ${JSON.stringify(wf)}`)
    for (const d of rd) {
      if (d.digest?.gitCommit || d.uri?.includes('github.com')) {
        say(`  resolvedDependency: uri=${d.uri} gitCommit=${d.digest?.gitCommit}`)
      }
    }
    const commit = rd.map((d) => d.digest?.gitCommit).filter(Boolean)[0]
    raw.provenanceCommit = commit ?? null
    say(`  provenance 记录的 gitCommit: ${commit ?? '(未找到)'}`)
    say(`  与期望 commit 一致: ${commit === EXPECTED_COMMIT}`)
  }
  say('```')
} catch (e) {
  say(`FAIL: ${e.message}`)
}

// ---------- 4. GitHub Release ----------
h('4. GitHub Release')
try {
  const json = execFileSync('gh', ['release', 'view', TAG, '--json',
    'tagName,name,isDraft,isPrerelease,publishedAt,url,body'], { encoding: 'utf8' })
  const rel = JSON.parse(json)
  raw.release = rel
  writeFileSync(join(OUT_DIR, 'release-notes-from-github.md'), rel.body)
  const local = execFileSync('node', ['tools/changelog-section.mjs', VERSION], { encoding: 'utf8' })
  writeFileSync(join(OUT_DIR, 'release-notes-from-changelog.md'), local)
  say('```')
  say(`tagName: ${rel.tagName}`)
  say(`name: ${rel.name}`)
  say(`isDraft: ${rel.isDraft}  isPrerelease: ${rel.isPrerelease}`)
  say(`publishedAt: ${rel.publishedAt}`)
  say(`url: ${rel.url}`)
  say(`说明文字与 CHANGELOG 段落逐字一致: ${rel.body.trim() === local.trim()}`)
  say('```')
} catch (e) {
  say(`FAIL: ${e.message}`)
}

// ---------- 5. tag(远端) ----------
h('5. 远端 tag')
try {
  const ls = execFileSync('git', ['ls-remote', '--tags', 'origin', TAG], { encoding: 'utf8' }).trim()
  say('```')
  say(ls || '(未找到)')
  say('```')
  raw.remoteTag = ls
} catch (e) {
  say(`FAIL: ${e.message}`)
}

writeFileSync(join(OUT_DIR, 'verify-raw.json'), JSON.stringify(raw, null, 2))
writeFileSync(join(OUT_DIR, 'verify-output.md'), lines.join('\n') + '\n')
console.log(`\n原始数据: ${OUT_DIR}/verify-raw.json`)
