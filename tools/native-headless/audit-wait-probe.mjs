/** Real native audit waiting regression. Delay is a fixture, never a performance score. */
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { runNative } from './run.mjs'

const verifyOnly = process.argv.includes('--verify')
const [home, profile, rootArg, delayArg = '305', faultArg] = process.argv.slice(2).filter(arg => arg !== '--verify')
if (!rootArg) throw new Error('Usage: audit-wait-probe.mjs <home> <profile> <new-root> [delay-seconds] [fault]')
const root = resolve(rootArg), workspace = join(root, 'workspace'), seconds = Number(delayArg)
assert.ok(Number.isInteger(seconds) && seconds >= 0 && seconds <= 600)
if (!verifyOnly) {
assert.ok(!existsSync(root), 'Preserve earlier evidence; use a new root')
mkdirSync(join(workspace, 'lab'), { recursive: true })
writeFileSync(join(workspace, 'lab/input.json'), '[2,2,2]\n')
writeFileSync(join(workspace, 'lab/source.json'), JSON.stringify({ fixture: 'audit-wait', source: 'synthetic test controller', unit: 'count', input: 'lab/input.json', observations: [2,2,2], delay_seconds: seconds, delay_purpose: 'Intentional test delay; zero is the fast control. Not physical measurement latency.' }, null, 2))
writeFileSync(join(workspace, 'lab/check.py'), `import json, time, sys\nfrom pathlib import Path\nstart=time.monotonic()\nvalues=json.loads(Path('lab/input.json').read_text())\nif '--quick' not in sys.argv:\n for i in range(${seconds}):\n  time.sleep(1)\n  if i % 30 == 0: print('synthetic check running', i+1, flush=True)\nprint(json.dumps({'mean':sum(values)/len(values),'unit':'count','elapsed_seconds':time.monotonic()-start,'quick':'--quick' in sys.argv}),flush=True)\n`)
}
const task = `这是合成审计等待回归,只核对 lab/input.json 的三个整数均值为 2 count。所有数据均由测试夹具提供,没有现实仪器或外部业务决定。
读取 lab/source.json、input.json 和 check.py。source.json 是测试控制器提供的来源、单位、夹具名和延迟配置，报告直接引用它。Frame hypotheses=[]，conditions={fixture:"audit-wait"}，目标判据明确写：原始值[2,2,2]的均值为2 count，独立评估者必须在系统提供的复跑副本中执行 python3 lab/check.py（不能加 --quick 或删改延迟），等命令真正结束并核对 mean=2、quick=false、elapsed_seconds>=${seconds}。${seconds}秒固定延迟是授权的测试夹具，不是性能要求或故障。
CreatePlan 只建一个普通文档步骤，不检验假设，不需要额外建本体。你可以运行 python3 lab/check.py --quick 做自检，写 lab/report.md，列原始数值、单位、来源、运算及范围只限本夹具，说明最终默认命令由独立评估者执行。报告、source.json、input.json、check.py 都列为交付产物。
AdvancePlan 自检交付这个普通步骤；ClosePlan；Conclude achieved，answers 给结论和三个文件依据。不要自行派评估者，不要再建验证框架，不提新经验，不请求人工决定。独立评估者等待超过四分钟仍属正常，不应重派。`
const output = join(root, 'run')
const result = verifyOnly ? JSON.parse(readFileSync(join(root, 'probe-result.json'))) : await runNative({ home, profile, workspace, spec: { group: 'C', mode: 'clearai', task, tokenBudget: 5_000_000, timeoutMs: 90 * 60_000, output, ...(faultArg ? { fault: faultArg } : {}) } })
if (!verifyOnly) writeFileSync(join(root, 'probe-result.json'), JSON.stringify(result, null, 2))
if (faultArg) { console.log(JSON.stringify({ fault: faultArg, reason: result.reason, root })); process.exit(0) }
assert.equal(result.reason, 'completed', result.failure)
assert.equal(result.usage.status, 'verified')
const audits = result.clearai.audits.filter(audit => audit.verdict !== 'reused')
assert.ok(audits.length > 0 && audits.some(audit => audit.holds === 'yes'))
assert.equal(new Set(audits.map(audit => `${audit.step}:${audit.digest}`)).size, audits.length, 'Identical materials must not dispatch another evaluator')
assert.ok(audits.some(audit => audit.settledAt - audit.at >= seconds * 1000))
const calls = readFileSync(join(output, 'llm-calls.jsonl'), 'utf8').trim().split('\n').map(JSON.parse)
const waitingRequests = calls.filter(call => call.session === result.session && audits.some(audit => call.started > audit.at && call.started < audit.settledAt))
assert.equal(waitingRequests.length, 0, 'Waiting must not generate parent model polling requests')
const childLog = result.logs.find(log => log.session === audits[0].child)
assert.ok(childLog, 'Keep the independent child log')
const events = readFileSync(join(output, childLog.path), 'utf8').trim().split('\n').map(JSON.parse)
const strings = (value, depth = 0) => {
  if (depth > 8 || value == null) return []
  if (typeof value === 'string') {
    try { return [value, ...strings(JSON.parse(value), depth + 1)] } catch { return [value] }
  }
  return typeof value === 'object' ? Object.values(value).flatMap(item => strings(item, depth + 1)) : []
}
const readings = events.filter(event => event.type === 'tool/result').flatMap(event => strings(event.data)).flatMap(value => [...value.matchAll(/\{[^{}\n]*"elapsed_seconds"[^{}\n]*\}/g)].flatMap(match => {
  try { return [JSON.parse(match[0])] } catch { return [] }
}))
assert.ok(readings.some(reading => reading.mean === 2 && reading.quick === false && reading.elapsed_seconds >= seconds), 'The evaluator must collect the completed default fixture result')
const nativeJobReads = events.filter(event => event.type === 'tool/call' && event.data.name === 'job_output').length
if (seconds >= 300) assert.ok(nativeJobReads > 0, 'Long commands must be collected through native job_output')
const receipt = { passed: true, delaySeconds: seconds, nativeJobReads, parentRequestsWhileWaiting: waitingRequests.length, audits: audits.length, elapsedMs: result.elapsedMs, usage: result.usage, installation: result.installation, limitation: 'Synthetic engineering check. Fixed delay is not performance evidence.' }
writeFileSync(join(root, 'receipt.json'), JSON.stringify(receipt, null, 2))
console.log(JSON.stringify(receipt))
