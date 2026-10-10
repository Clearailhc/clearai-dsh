/** Hidden parameters stay in the controller's memory while any agent runs. */
import http from 'node:http'
import {createHmac,randomBytes} from 'node:crypto'
export function makeWorld(key,seed,template='interaction') {
 let offset=0
 const uniform=()=>{const b=createHmac('sha256',key).update(seed+':'+offset++).digest();return (b.readUInt32LE()/4294967296)}
 const a=0.25+uniform()*0.45,b=0.25+uniform()*0.45
 const cross=template==='additive'?0:18+uniform()*9
 const noise=template==='cost_noise'?0.9:0.18
 const bias=template==='drift'||template==='sensor_series'?0.1+uniform()*0.08:0
 const normal=()=>Math.sqrt(-2*Math.log(Math.max(uniform(),1e-12)))*Math.cos(2*Math.PI*uniform())
 const evaluate=(x,y,instrument='original',metric='yield')=>{
  const actual=x-(instrument==='replacement'?0:bias)
  const dx=actual-a,dy=y-b
  let value=93-27*dx*dx-23*dy*dy+cross*dx*dy+5*actual
  if(metric==='purity_adjusted')value*=1-(0.055+0.05*y+0.03*actual*actual)
  return {value,impurity:0.055+0.05*y+0.03*actual*actual,actual}
 }
 return {template,noise,bias,a,b,cross,evaluate,normal}
}
export function score(world,recipe,{instrument='original',metric='yield',limit=0.115}={}) {
 const start=world.evaluate(0.15,0.15,instrument,metric).value
 let optimum=-Infinity
 for(let ix=0;ix<=400;ix++)for(let iy=0;iy<=400;iy++){
  const r=world.evaluate(ix/400,iy/400,instrument,metric)
  if(r.impurity<=limit)optimum=Math.max(optimum,r.value)
 }
 if(!recipe||![recipe.x,recipe.y].every(Number.isFinite)||[recipe.x,recipe.y].some(x=>x<0||x>1))return {score:0,feasible:false,start,optimum}
 const chosen=world.evaluate(recipe.x,recipe.y,instrument,metric)
 const feasible=chosen.impurity<=limit
 return {score:feasible?Math.max(0,Math.min(100,100*(chosen.value-start)/(optimum-start))):0,feasible,value:chosen.value,impurity:chosen.impurity,start,optimum}
}
export async function experimentService(world,{budget=24,instrument='original',metric='yield'}={}) {
 const token=randomBytes(24).toString('hex'),observations=[],calls=[]
 let spent=0
 const observe=(x,y,mode)=>{
  const r=world.evaluate(x,y,instrument,metric),sd=mode==='full'?world.noise:world.noise*2.5
  return {x,y,value:r.value+world.normal()*sd,impurity:r.impurity+world.normal()*0.0008,instrument,metric,mode,noise_sd:sd,units:{value:'%',impurity:'fraction'}}
 }
 const initial=[]
 for(const x of [0.1,0.5,0.9])for(const y of [0.1,0.5,0.9])initial.push(observe(x,y,'full'))
 const server=http.createServer(async(req,res)=>{
  const send=(status,data)=>{res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify(data))}
  if(req.method!=='POST'||req.url!=='/experiment'||req.headers.authorization!=='Bearer '+token)return send(404,{error:'not found'})
  let raw='';for await(const chunk of req){raw+=chunk;if(raw.length>4096)return send(413,{error:'request too large'})}
  let args;try{args=JSON.parse(raw)}catch{return send(400,{error:'invalid JSON'})}
  const cost={quick:1,full:3,calibrate:2}[args.mode]
  if(!cost)return send(400,{error:'mode must be quick, full or calibrate'})
  if(args.mode!=='calibrate'&&![args.x,args.y].every(x=>Number.isFinite(x)&&x>=0&&x<=1))return send(400,{error:'x,y must be within 0..1'})
  if(spent+cost>budget)return send(409,{error:'experiment budget exhausted',spent,budget})
  spent+=cost
  const result=args.mode==='calibrate'?{instrument,metric,offset:instrument==='replacement'?0:world.bias,unit:'normalized x',cost,spent,budget}: {...observe(args.x,args.y,args.mode),cost,spent,budget}
  calls.push({request:args,result});if(args.mode!=='calibrate')observations.push(result)
  send(200,result)
 })
 await new Promise(r=>server.listen(0,'127.0.0.1',r))
 return {endpoint:'http://127.0.0.1:'+server.address().port+'/experiment',token,initial,observations,calls,get spent(){return spent},close:()=>new Promise(r=>server.close(r))}
}
