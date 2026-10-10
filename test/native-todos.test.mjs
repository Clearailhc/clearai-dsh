import { test } from 'node:test'
import assert from 'node:assert/strict'
import { planTodos, createTodoMirror } from '../preset/plugins/native-todos.js'
const state = () => ({goal:{id:'g1',status:'open'},plans:[{id:'p1',goal:'g1',status:'active',steps:[{id:'a',do:'核算读数',status:'open'},{id:'b',do:'复检范围',status:'open'}]}]})
test('native todos reflect accepted progress, pending blocks and voided steps',()=>{
 const s=state();assert.deepEqual(planTodos(s).map(t=>t.status),['in_progress','pending'])
 s.plans[0].steps[0].status='advanced';assert.deepEqual(planTodos(s).map(t=>t.status),['completed','in_progress'])
 s.plans[0].blocked={step:'b',reason:'需要补证据'};assert.equal(planTodos(s)[1].status,'pending');assert.match(planTodos(s)[1].content,/受阻.*需要补证据/)
 s.plans[0].steps[1].status='void';assert.deepEqual(planTodos(s).map(t=>t.status),['completed'])
 s.goal.status='abandoned';s.plans[0].steps[1].status='open';assert.deepEqual(planTodos(s).map(t=>t.status),['completed','pending'])
})
test('native events update once, restore after new turn, and survive mirror restart',()=>{
 const events=[{type:'turn/start',data:{turn:1}}],target={snapshotEvents:()=>events,append:(type,data)=>events.push({type,data})}
 const sync=createTodoMirror({session:()=>target});const s=state()
 sync('main',s);sync('main',s);assert.equal(events.filter(e=>e.type==='todo/write').length,1)
 events.push({type:'turn/start',data:{turn:2}});sync('main',s);assert.equal(events.at(-1).type,'todo/write')
 const count=events.length;createTodoMirror({session:()=>target})('main',s);assert.equal(events.length,count)
 s.plans[0].steps[0].status='advanced';sync('main',s);assert.equal(events.at(-1).data.todos[0].status,'completed')
 const next={...s,goal:{id:'g2',status:'open'}};sync('main',next);assert.deepEqual(events.at(-1).data.todos,[])
})
test('display failure retries and cannot change the authority or an unrelated list',()=>{
 const s=state(),before=JSON.stringify(s);let failed=true;const events=[]
 const target={snapshotEvents:()=>events,append:(type,data)=>{if(failed)throw Error('write failed');events.push({type,data})}}
 const sync=createTodoMirror({session:()=>target,isChild:id=>id==='child'})
 sync('main',{plans:[]});assert.equal(events.length,0)
 sync('child',s);assert.equal(events.length,0)
 sync('main',s);failed=false;sync('main',s);assert.equal(events.length,1);assert.equal(JSON.stringify(s),before)
})
