import { RESOURCES } from './k8sResources'

export interface ResourceRef { kind: string; name: string; namespace?: string; apiVersion?: string; uid?: string }
export function resourceLocation(ref: ResourceRef) {
  const group = (v: string) => v.includes('/') ? v.split('/')[0] : ''
  const desc = RESOURCES.find(r => r.kind === ref.kind && (!ref.apiVersion || group(r.apiVersion) === group(ref.apiVersion)))
  if (!desc || !ref.name || (desc.namespaced && !ref.namespace)) return undefined
  return { key: desc.key, path: desc.listPath(ref.namespace || '').split('?')[0] + '/' + encodeURIComponent(ref.name) }
}
export function relatedResources(obj: any, kind: string): { label: string; ref: ResourceRef }[] {
  const out: { label: string; ref: ResourceRef }[] = []
  const ns = obj?.metadata?.namespace
  const add = (label: string, ref: ResourceRef) => {
    if (ref.name && !out.some(x => x.label === label && x.ref.kind === ref.kind && x.ref.name === ref.name && x.ref.namespace === ref.namespace)) out.push({label, ref})
  }
  for (const r of obj?.metadata?.ownerReferences || []) add('Owner', {...r, namespace: ns})
  const spec = obj?.spec || {}
  if (kind === 'Pod') {
    add('Node', {kind:'Node',name:spec.nodeName})
    add('Service Account', {kind:'ServiceAccount',name:spec.serviceAccountName || 'default',namespace:ns})
    for (const v of spec.volumes || []) {
      if(v.configMap) add('Volume', {kind:'ConfigMap',name:v.configMap.name,namespace:ns})
      if(v.secret) add('Volume', {kind:'Secret',name:v.secret.secretName,namespace:ns})
      if(v.persistentVolumeClaim) add('Volume', {kind:'PersistentVolumeClaim',name:v.persistentVolumeClaim.claimName,namespace:ns})
      for(const p of v.projected?.sources || []) {
        if(p.configMap) add('Volume', {kind:'ConfigMap',name:p.configMap.name,namespace:ns})
        if(p.secret) add('Volume', {kind:'Secret',name:p.secret.name,namespace:ns})
      }
    }
  }
  if (kind === 'Ingress') {
    const backends = [spec.defaultBackend, ...(spec.rules || []).flatMap((r:any) => (r.http?.paths || []).map((p:any) => p.backend))]
    for (const b of backends) {
      if (b?.service) add('Backend', {kind:'Service',name:b.service.name,namespace:ns})
      if (b?.resource) add('Backend', {kind:b.resource.kind,name:b.resource.name,namespace:ns,apiVersion:b.resource.apiGroup ? b.resource.apiGroup+'/v1' : 'v1'})
    }
    for (const t of spec.tls || []) add('TLS', {kind:'Secret',name:t.secretName,namespace:ns})
  }
  if (kind === 'PersistentVolumeClaim') add('Volume', {kind:'PersistentVolume',name:spec.volumeName})
  if (kind === 'PersistentVolume' && spec.claimRef) add('Claim', {kind:'PersistentVolumeClaim',name:spec.claimRef.name,namespace:spec.claimRef.namespace,uid:spec.claimRef.uid})
  if (['PersistentVolume','PersistentVolumeClaim'].includes(kind)) add('Storage Class', {kind:'StorageClass',name:spec.storageClassName})
  return out
}
export async function listRelated(connId: string, path: string): Promise<any[]> {
  const { requestJSON } = await import('./k8sClient')
  let token = ''
  const items: any[] = []
  do {
    const url = path + (path.includes('?') ? '&' : '?') + 'limit=200' + (token ? '&continue='+encodeURIComponent(token) : '')
    const {status,data} = await requestJSON(connId,'GET',url)
    if(status!==200 || !Array.isArray(data?.items)) throw new Error('HTTP '+status+' — unable to list resources')
    items.push(...data.items)
    token=data.metadata?.continue || ''
    if(items.length>=5000 && token) throw new Error('More than 5000 related resources; narrow the scope.')
  } while(token)
  return items
}
export function serviceEndpointRows(slices: any[]) {
  return slices.flatMap(slice => (slice.endpoints || []).flatMap((endpoint: any) => (endpoint.addresses || []).flatMap((address:string) =>
    (slice.ports?.length ? slice.ports : [{}]).map((port:any) => ({
      address, port: port.port ?? '—', name: port.name || '', protocol: port.protocol || 'TCP',
      ready: endpoint.conditions?.ready === true ? 'Ready' : endpoint.conditions?.ready === false ? 'Not Ready' : 'Unknown',
      target: endpoint.targetRef as ResourceRef | undefined,
    }))
  )))
}
export function podContainers(pod: any) {
  return [
    {type:'Init',spec:pod?.spec?.initContainers,status:pod?.status?.initContainerStatuses},
    {type:'Container',spec:pod?.spec?.containers,status:pod?.status?.containerStatuses},
    {type:'Ephemeral',spec:pod?.spec?.ephemeralContainers,status:pod?.status?.ephemeralContainerStatuses},
  ].flatMap(group => (group.spec || []).map((c:any) => {
    const status = (group.status || []).find((s:any) => s.name === c.name)
    return {...c, type:group.type, status, state:status?.state?.waiting ? 'Waiting' : status?.state?.running ? 'Running' : status?.state?.terminated ? 'Terminated' : 'Unknown',
      reason:status?.state?.waiting?.reason || status?.state?.terminated?.reason || status?.lastState?.terminated?.reason || ''}
  }))
}
