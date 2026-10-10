/** Capture only declared outputs from an owned synthetic campaign, before later tasks run. */
import {readFileSync,writeFileSync,existsSync,lstatSync,realpathSync,mkdirSync,readdirSync} from 'node:fs'
import {resolve,relative,join,isAbsolute} from 'node:path'
import {createHash,randomUUID} from 'node:crypto'
import {redact} from './accounting.mjs'
export const hash=value=>createHash('sha256').update(value).digest('hex')
const inside=(path,root)=>{const rel=relative(root,path);return !isAbsolute(rel)&&rel!=='..'&&!rel.startsWith('../')}
export function initializeCampaignRoot(root) {
 root=resolve(root)
 if(existsSync(root)&&readdirSync(root).length)throw new Error('A synthetic campaign requires a new empty root')
 mkdirSync(root,{recursive:true})
 const owner={schema:'clearai.synthetic-campaign.v1',id:randomUUID(),root:realpathSync(root)}
 writeFileSync(join(root,'synthetic-campaign.json'),JSON.stringify(owner)+'\n',{flag:'wx',mode:0o600})
 return owner
}
export function assertSyntheticWorkspace(root,workspace) {
 root=realpathSync(root);workspace=realpathSync(workspace)
 const owner=JSON.parse(readFileSync(join(root,'synthetic-campaign.json')))
 if(owner.schema!=='clearai.synthetic-campaign.v1'||owner.root!==root||!inside(workspace,join(root,'workspaces')))throw new Error('Only owned synthetic campaign workspaces may be captured')
 return {root,workspace,owner}
}
export function captureMaterials({root,workspace,task,submission,result,records}) {
 ({root,workspace}=assertSyntheticWorkspace(root,workspace))
 const state=result.clearai??{}, paths=new Set(['report/'+task+'.md']),missing=[],files=[]
 const add=value=>{if(typeof value==='string'&&value.trim())paths.add(value)}
 for(const path of submission?.evidence??[])add(path)
 for(const plan of state.plans??[])for(const step of plan.steps??[])for(const path of step.artifacts??[])add(path)
 const actualReferences=(state.goal?.answers??[]).map(({conclusion,basis,uses,uses_review})=>({conclusion,basis,uses,uses_review}))
 for(const row of actualReferences){for(const path of row.basis??[])add(path);for(const review of row.uses_review??[])add(review.card_path)}
 for(const record of records) {
  add(record.path)
  for(const evidence of record.evidence_records??[])for(const path of evidence.refs??[])add(path)
  for(const reason of record.rechecks??[]){add(reason.evidence);add(reason.resolution?.card_path)}
  if(record.use)add('clear/models/'+record.use+'.json')
 }
 let bytes=0
 for(const ref of paths) {
  const file=resolve(workspace,ref),name=relative(workspace,file)
  if(!inside(file,workspace)||!name||/(?:^|\/)(?:\.git|\.credentials|\.env)|experiment-endpoint|isolation-private-link/.test(name)){missing.push({ref,status:'excluded'});continue}
  if(!existsSync(file)){missing.push({ref,status:'missing'});continue}
  if(!inside(realpathSync(file),workspace)||!lstatSync(file).isFile()){missing.push({ref,status:'not-workspace-file'});continue}
  const raw=readFileSync(file)
  bytes+=raw.length
  if(raw.length>2*1024*1024||bytes>8*1024*1024)throw new Error('Declared grading materials exceed capture limit; preserve run and review instead of truncating')
  files.push({path:name,sha256:hash(raw),content:raw.toString('utf8')})
 }
 const report=files.find(file=>file.path==='report/'+task+'.md')?.content??''
 return redact({schema:'clearai.public-task-materials.v1',task,submission,answer:result.answer,report,knowledge:records,actualReferences,artifacts:files,missing})
}
export function writeSnapshot(file,material) {
 const text=JSON.stringify(material,null,2)+'\n'
 writeFileSync(file,text,{flag:'wx',mode:0o600})
 return {path:file,sha256:hash(text)}
}
export function readSnapshot(snapshot) {
 const text=readFileSync(snapshot.path,'utf8')
 if(hash(text)!==snapshot.sha256)throw new Error('Task snapshot changed after capture')
 return JSON.parse(text)
}
