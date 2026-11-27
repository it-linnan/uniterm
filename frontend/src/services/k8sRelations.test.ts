import { describe, expect, it } from 'vitest'
import { resourceLocation, relatedResources, serviceEndpointRows, podContainers } from './k8sRelations'
describe('resource relations', () => {
  it('requires namespace for namespaced resources and rejects unknown kinds', () => {
    expect(resourceLocation({kind:'Pod',name:'p'})).toBeUndefined()
    expect(resourceLocation({kind:'Unknown',name:'p'})).toBeUndefined()
    expect(resourceLocation({kind:'Pod',name:'p',namespace:'ns'})?.path).toBe('/api/v1/namespaces/ns/pods/p')
  })
  it('keeps namespace on referenced ConfigMaps and PVCs', () => {
    const refs=relatedResources({metadata:{namespace:'n'},spec:{volumes:[{configMap:{name:'cfg'}},{persistentVolumeClaim:{claimName:'pvc'}}]}},'Pod')
    expect(refs.find(r=>r.ref.name==='cfg')?.ref.namespace).toBe('n')
    expect(refs.find(r=>r.ref.name==='pvc')?.ref.kind).toBe('PersistentVolumeClaim')
  })
  it('does not infer readiness from absent conditions', () => {
    expect(serviceEndpointRows([{ports:[{port:80}],endpoints:[{addresses:['10.0.0.1']}]}])[0].ready).toBe('Unknown')
  })
  it('matches container status by name and distinguishes init containers', () => {
    const rows=podContainers({spec:{initContainers:[{name:'i'}],containers:[{name:'a'}]},status:{containerStatuses:[{name:'a',state:{waiting:{reason:'CrashLoopBackOff'}}}]}})
    expect(rows.map(r=>[r.type,r.reason])).toEqual([['Init',''],['Container','CrashLoopBackOff']])
  })
})
