/** Four-task causal worlds. Secret keys and parameters stay in the coordinator. */
import { createHmac, randomBytes } from 'node:crypto'
import http from 'node:http'

export const FACTORS = Object.freeze({ T: [140, 200], P: [1, 6], cat: [0.2, 2], t: [20, 120], w: [0.1, 1] })
export function sequenceWorld(key, seed) {
 const uniform = tag => createHmac('sha256', key).update(`${seed}:${tag}`).digest().readUInt32LE() / 4294967296
 const normal = tag => Math.sqrt(-2*Math.log(Math.max(uniform(`${tag}:u`),1e-12)))*Math.cos(2*Math.PI*uniform(`${tag}:v`))
 const p = { ridge: 188+4*uniform('ridge'), slope: 20+4*uniform('slope'), shift: 4+4*uniform('shift'), bias: 6+2*uniform('bias'), extra: 5+2*uniform('extra'), noise: .55+.3*uniform('noise'), bT: 161+7*uniform('bT'), bP: 3.6+.8*uniform('bP') }
 const bias = (task,n=30) => task==='t3'?0:task==='t1'?(n>20?p.bias:0):task==='t4'?p.bias+p.extra:p.bias
 const evaluate = (task,recipe,n=30) => {
  const {P,cat,t}=recipe, T=recipe.T-bias(task,n), shift=task==='t2'?p.shift:0
  const value = task==='t3'?89-.04*(T-p.bT)**2-2*(P-p.bP)**2-6*(cat-1)**2-.002*(t-80)**2:62+36*cat-11*cat**2-.05*(T-(p.ridge+shift-p.slope*cat))**2-2.5*(P-3.5)**2-.003*(t-70)**2
  const impurity = task==='t3'?.1+.02*Math.max(0,T-172)+.5*Math.max(0,cat-1.3)+.002*Math.max(0,t-90):.1+.8*Math.max(0,cat-1.1)+.02*Math.max(0,T-(162+shift))+.003*Math.max(0,t-70)
  return {value:Math.max(0,value),impurity,T_actual:T}
 }
 const cachedOptima=new Map()
 const optimum = task => {
  if(cachedOptima.has(task))return cachedOptima.get(task)
  let best={value:-Infinity}
  // Pressure and residence time optima are analytic; scan T/catalyst at a fixed resolution.
  for(let i=0;i<=600;i++)for(let j=0;j<=360;j++) {
   const recipe={T:140+i/10,P:task==='t3'?p.bP:3.5,cat:.2+j/200,t:task==='t3'?80:70,w:.3}, value=evaluate(task,recipe)
   if(value.impurity<=.5&&value.value>best.value)best={...value,recipe}
  }
  cachedOptima.set(task,best);return best
 }
 const production = () => Array.from({length:42},(_,i)=>{
  const day=Math.floor(i/3)+1,late=day>7,recipe={T:162,P:3.5,cat:1.3,t:70,w:late?.65:.25}
  const drift=p.bias+(late?(day-7)*p.extra/7:0), r=evaluate('t1',{...recipe,T:recipe.T-drift},1)
  return {day,shift:i%3,crew:late?'乙':'甲',...recipe,T_ref:(day===1||day===8)&&i%3===0?recipe.T-drift+.15*normal('prodref'+i):null,yield_pct:r.value+.5*normal('prod'+i),impurity_pct:r.impurity}
 })
 return {seed,bias,evaluate,optimum,normal,noise:p.noise,production,truth:()=>({...p})}
}

export function scoreRecipe(world,task,recipe,n=30) {
 if(!recipe||Object.entries(FACTORS).some(([k,[lo,hi]])=>!Number.isFinite(recipe[k])||recipe[k]<lo||recipe[k]>hi))return {score:0,feasible:false}
 const value=world.evaluate(task,recipe,n), optimum=world.optimum(task).value
 const start=world.evaluate(task,{T:170,P:3,cat:1,t:60,w:.4}).value
 return {...value,optimum,start,feasible:value.impurity<=.5,score:value.impurity>.5?0:Math.max(0,Math.min(100,100*(value.value-start)/(optimum-start)))}
}

export async function sequenceService(world,task) {
 const token=randomBytes(24).toString('hex'), calls=[], budget=task==='t4'?12:30
 const server=http.createServer(async(req,res)=>{
  const send=(status,data)=>{res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify(data))}
  if(req.headers.authorization!=='Bearer '+token)return send(404,{error:'not found'})
  if(req.method==='GET'&&req.url==='/log')return send(200,{calls,budget})
  if(req.method!=='POST'||req.url!=='/experiment')return send(404,{error:'not found'})
  let raw='';for await(const chunk of req){raw+=chunk;if(raw.length>4096)return send(413,{error:'too large'})}
  let recipe;try{recipe=JSON.parse(raw)}catch{return send(400,{error:'invalid JSON'})}
  if(Object.entries(FACTORS).some(([k,[lo,hi]])=>!Number.isFinite(recipe[k])||recipe[k]<lo||recipe[k]>hi))return send(400,{error:'T,P,cat,t,w must be within public bounds',bounds:FACTORS})
  if(calls.length>=budget)return send(409,{error:'experiment budget exhausted',budget})
  const n=calls.length+1,real=world.evaluate(task,recipe,n)
  const observation={run:n,setpoint:recipe,yield_pct:real.value+world.noise*world.normal(`${task}:${n}:yield`),impurity_pct:Math.max(.01,real.impurity+.015*world.normal(`${task}:${n}:imp`)),T_controller:recipe.T,budget_left:budget-n}
  if(n%(task==='t4'?3:5)===0)observation.T_ref=real.T_actual+.3*world.normal(`${task}:${n}:ref`)
  calls.push({request:recipe,result:observation});send(200,observation)
 })
 await new Promise(r=>server.listen(0,'127.0.0.1',r))
 const endpoint='http://127.0.0.1:'+server.address().port+'/experiment'
 return {endpoint,token,calls,budget,close:()=>new Promise(r=>server.close(r))}
}

export function sequenceTask(task) {
 const descriptions={t1:'A线首次加氢优化。现场有人怀疑原料含水影响收率，请用数据判断。',t2:'A线更换催化剂批次，沿用同一套装置和未维修的热电偶。利用上一题材料，重新确认可行配方。',t3:'B线另一套装置和新热电偶。相同反应但工艺关系可能不同。确认本线可行配方与仪表口径。',t4:'A线量产两周收率下降。production.json 给出记录；含水升高和换班组同时发生。定位原因、核对仪表并提出可验证修复。'}
 return `${descriptions[task]}\n小试通过 python3 experiment.py run --parameters '{"T":170,"P":3.5,"cat":1,"t":70,"w":0.3}' --output lab/run-N.json，所有量必须提交。可用 log 查看本题观测。范围 ${JSON.stringify(FACTORS)}；单位 T=°C,P=bar,cat=wt%,t=min,w=含水wt%。杂质≤0.5%，尽量提高收率。预算${task==='t4'?12:30}次。原始读数必须保留。每题新会话，工作区旧文件可以读取复用。请把本题结论写入 submission.json：recipe（上述五量），diagnosis（原因与证据），measurement（仪表和口径说明），relations（工艺关系），excluded（排除项及范围），evidence（路径数组）。请在 report/${task}.md 给出论证，明确范围、不确定性和证据。允许维护笔记、脚本和使用 method/ 里的通用方法。仅以本题实际观测支持结论。`
}
