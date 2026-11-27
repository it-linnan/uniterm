import { parseCpu, parseMemory } from './k8sQuantity'
type Resources={cpuReq:number;cpuLim:number;memReq:number;memLim:number}
const zero=():Resources=>({cpuReq:0,cpuLim:0,memReq:0,memLim:0})
const add=(a:Resources,b:Resources):Resources=>({cpuReq:a.cpuReq+b.cpuReq,cpuLim:a.cpuLim+b.cpuLim,memReq:a.memReq+b.memReq,memLim:a.memLim+b.memLim})
const max=(a:Resources,b:Resources):Resources=>({cpuReq:Math.max(a.cpuReq,b.cpuReq),cpuLim:Math.max(a.cpuLim,b.cpuLim),memReq:Math.max(a.memReq,b.memReq),memLim:Math.max(a.memLim,b.memLim)})
function resources(r:any):Resources{return {cpuReq:parseCpu(r?.requests?.cpu||''),cpuLim:parseCpu(r?.limits?.cpu||''),memReq:parseMemory(r?.requests?.memory||''),memLim:parseMemory(r?.limits?.memory||'')}}
export function effectivePodResources(p:any):Resources{
 const spec=p?.spec||{}
 let app=zero(),sidecars=zero(),initMax=zero()
 for(const c of spec.containers||[])app=add(app,resources(c.resources))
 for(const c of spec.initContainers||[]){
  const r=resources(c.resources)
  if(c.restartPolicy==='Always'){sidecars=add(sidecars,r);initMax=max(initMax,sidecars)}
  else initMax=max(initMax,add(sidecars,r))
 }
 const result=max(add(app,sidecars),initMax)
 const podLevel=spec.resources
 if(podLevel?.requests?.cpu!==undefined)result.cpuReq=parseCpu(podLevel.requests.cpu)
 if(podLevel?.requests?.memory!==undefined)result.memReq=parseMemory(podLevel.requests.memory)
 if(podLevel?.limits?.cpu!==undefined)result.cpuLim=parseCpu(podLevel.limits.cpu)
 if(podLevel?.limits?.memory!==undefined)result.memLim=parseMemory(podLevel.limits.memory)
 const cpu=parseCpu(spec.overhead?.cpu||''),mem=parseMemory(spec.overhead?.memory||'')
 result.cpuReq+=cpu;result.memReq+=mem
 if(result.cpuLim>0)result.cpuLim+=cpu
 if(result.memLim>0)result.memLim+=mem
 return result
}
