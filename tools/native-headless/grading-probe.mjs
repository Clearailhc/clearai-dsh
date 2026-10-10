/** Authorized synthetic grading fixture; never a product-benefit sample. */
import {mkdirSync,writeFileSync,existsSync} from 'node:fs'
import {join,resolve} from 'node:path'
import assert from 'node:assert/strict'
import {sequenceWorld} from './sequence.mjs'
import {gradeSequence} from './scoring.mjs'
const [home,profile,rootPath]=process.argv.slice(2)
if(!rootPath)throw new Error('Usage: grading-probe.mjs <home> <profile> <new-root>')
const root=resolve(rootPath);if(existsSync(root))throw new Error('Preserve old grading probe')
mkdirSync(root,{recursive:true});const probe=join(root,'private-sentinel');writeFileSync(probe,'synthetic controller')
const world=sequenceWorld('engineering-only','judge-probe'),recipe=world.optimum('t3').recipe
const blind=await gradeSequence({home,profile,root:join(root,'judges'),protectedRoot:root,probe,task:'t3',world,submission:{recipe,measurement:'New instrument B, current bias zero; A compensation not applied.',relations:'B is additive; no extrapolation to A.'},observations:[],report:'Synthetic evaluator plumbing fixture. There are no real experiment observations; the chosen recipe is fixture-supplied and not verified by the task agent. Old A facts remain valid in original scope. No actual knowledge reuse is claimed.',artifacts:[],knowledge:[],actualReferences:[]})
assert.ok(blind.judges.length>=2);assert.ok(blind.judges.every(row=>row.result.usage.status==='verified'))
writeFileSync(join(root,'result.json'),JSON.stringify({passed:true,synthetic:true,blind},null,2))
