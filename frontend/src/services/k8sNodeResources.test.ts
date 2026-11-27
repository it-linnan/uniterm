import { describe,it,expect } from 'vitest'
import {effectivePodResources} from './k8sNodeResources'
describe('effective Pod resources',()=>{
 it('uses the larger init request instead of adding sequential init containers',()=>{
  expect(effectivePodResources({spec:{containers:[{resources:{requests:{cpu:'100m'}}}],initContainers:[{resources:{requests:{cpu:'500m'}}},{resources:{requests:{cpu:'200m'}}}],overhead:{cpu:'20m'}}}).cpuReq).toBe(520)
 })
 it('includes restartable init sidecars with application containers',()=>{
  expect(effectivePodResources({spec:{containers:[{resources:{requests:{cpu:'200m'}}}],initContainers:[{restartPolicy:'Always',resources:{requests:{cpu:'100m'}}}]}}).cpuReq).toBe(300)
 })
})
