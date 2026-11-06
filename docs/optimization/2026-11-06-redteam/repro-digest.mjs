import {mkdtempSync,writeFileSync,symlinkSync,mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {auditMaterialDigest,fileDigest} from '../../../preset/plugins/audit-material.js';
const cwd=mkdtempSync(join(tmpdir(),'clearai-digest-probe-'));
for(const absolute of [false,true]) {
 const path=join(cwd,'result.txt');
 const ref=absolute?path:'result.txt';
 const step={id:'s1',done_criteria:'Result equals VALID',artifacts:[ref]};
 const plan={id:'p1',steps:[step]};
 const state={plans:[plan]}; const gate={confirmed:[{ref,digest:'admission-snapshot'}]};
 writeFileSync(path,'VALID');
 const before=auditMaterialDigest({kind:'evidence_audit',step,plan,state,gate,cwd});
 writeFileSync(path,'WRONG');
 const after=auditMaterialDigest({kind:'evidence_audit',step,plan,state,gate,cwd});
 console.log(JSON.stringify({absolute,fileDigest:fileDigest(cwd,ref),changed:before!==after}));
}
