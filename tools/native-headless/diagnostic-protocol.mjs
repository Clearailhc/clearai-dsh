/** User-requested direct long-task comparison, separate from formal acceptance. */
export const DIAGNOSTIC_SCHEMA = 'clearai.long-task-diagnostic.v1'
export const DIAGNOSTIC_AUTHORIZATION = '2026-10-10: 用户要求先不测冒烟，直接进行长任务对比。'
export const EXPERIMENT_AUTHORIZATION = '本任务使用隔离的模拟实验服务，不操作真实设备、不消耗真实样品。题目规定次数以内的 experiment.py run 调用和工作区内可逆计算已获授权，无需逐次请示；不要把这些模拟调用登记成需要人工批准的不可逆动作。此授权不扩展到真实设备、外部发布或删除原始证据。各题观测保留，使用本题独立目录保存新观测，不覆盖前题原始读数。'
export function diagnosticSessions() {
 const rows=[]
 for(let world=1;world<=3;world++) for(let task=1;task<=4;task++) for(const group of ['A','C']) rows.push({stage:'diagnostic',group,world:`long-${world}`,task:`t${task}`,mode:group==='C'?'clearai':'default'})
 return rows
}
export function diagnosticRun(manifest,stage) {
 const diagnostic=manifest.schema===DIAGNOSTIC_SCHEMA
 if(diagnostic&&(stage!=='diagnostic'||manifest.authorization!==DIAGNOSTIC_AUTHORIZATION||manifest.productAcceptance!==false))throw new Error('Diagnostic authorization or stage mismatch')
 if(!diagnostic&&stage==='diagnostic')throw new Error('Diagnostic runs require their own frozen protocol')
 return diagnostic
}
