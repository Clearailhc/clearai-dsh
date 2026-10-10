/** Cancellation, transport failure and crash recovery for the native audit candidate. */
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { runNative } from './run.mjs'
const [home, profile, rootArg] = process.argv.slice(2)
if (!rootArg) throw new Error('Usage: audit-fault-probe.mjs <home> <profile> <new-root>')
const root = resolve(rootArg)
assert.ok(!existsSync(root)); mkdirSync(root, { recursive: true })
const checks = []
for (const fault of ['cancel-after-child-request', 'disconnect', 'crash-after-child-verdict']) {
  const base = join(root, fault)
  await promisify(execFile)(process.execPath, [join(import.meta.dirname, 'audit-wait-probe.mjs'), home, profile, base, '0', fault], { maxBuffer: 1024 * 1024 })
  const first = JSON.parse(readFileSync(join(base, 'probe-result.json')))
  assert.ok(first.usage.lowerBound > 0)
  assert.equal(first.usage.status, 'verified', 'Injected pre-provider calls must remain distinct from unknown usage')
  if (fault === 'cancel-after-child-request') {
    assert.equal(first.reason, 'user_cancelled')
    assert.notEqual(first.clearai?.goal?.status, 'achieved')
    assert.ok(!/did not settle|stop continuation/.test(first.failure ?? ''))
  }
  if (fault === 'disconnect') assert.equal(first.reason, 'blocked')
  let recovered
  if (fault === 'crash-after-child-verdict') {
    const injected = JSON.parse(readFileSync(join(base, 'run/fault-injected.json')))
    const checkpoint = JSON.parse(readFileSync(join(base, 'run/checkpoint.json')))
    const before = checkpoint.clearai.audits.find(audit => audit.child === injected.child)
    assert.ok(before)
    const spec = JSON.parse(readFileSync(join(base, 'run/spec.json')))
    delete spec.fault
    recovered = await runNative({ home, profile, workspace: join(base, 'workspace'), spec: { ...spec, output: join(base, 'recovered'), resumeSessionId: checkpoint.session, task: '恢复原目标，不重新立题。先读取已完成的独立裁决并恢复已有计划；同一份材料不要重派。若旧审计发现真实异常，补足可检查依据后再提交；完成原目标。lab/source.json 是测试控制器提供的来源与口径，0 秒是正常快速对照，不是删改过的延迟。' } })
    assert.equal(recovered.reason, 'completed', recovered.failure)
    assert.equal(recovered.usage.status, 'verified')
    assert.ok(recovered.clearai.audits.some(audit => audit.child === injected.child && ['yes','no','unclear'].includes(audit.holds ?? audit.verdict)))
    assert.equal(recovered.clearai.audits.filter(audit => audit.step === before.step && audit.digest === before.digest && audit.verdict !== 'reused').length, 1)
  }
  checks.push({ fault, passed: true, first: { reason: first.reason, usage: first.usage, installation: first.installation }, ...(recovered ? { recovered: { reason: recovered.reason, usage: recovered.usage, installation: recovered.installation } } : {}) })
  writeFileSync(join(root, 'receipt.json'), JSON.stringify({ passed: checks.length === 3, checks }, null, 2))
}
console.log(JSON.stringify({ passed: true, checks }))
