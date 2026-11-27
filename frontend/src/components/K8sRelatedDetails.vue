<template>
  <div v-if="relations.length" class="detail-section">
    <div class="detail-section-title">Related resources</div>
    <div v-for="r in relations" :key="r.label + '/' + r.ref.kind + '/' + r.ref.name" class="related-row">
      <span>{{ r.label }}</span><button v-if="resourceLocation(r.ref)" class="resource-link" @click="$emit('navigate',r.ref)">{{ r.ref.kind }}/{{ r.ref.name }}</button><span v-else>{{ r.ref.kind }}/{{ r.ref.name }}</span>
    </div>
  </div>
  <template v-if="resourceKey === 'services'">
    <div class="detail-section">
      <div class="detail-section-title">Ports</div>
      <div class="table-wrap"><table><thead><tr><th>Name</th><th>Port</th><th>Target Port</th><th>Node Port</th><th>Protocol</th></tr></thead>
        <tbody><tr v-for="(p,i) in target?.spec?.ports || []" :key="i"><td>{{ p.name || '—' }}</td><td>{{ p.port }}</td><td>{{ p.targetPort ?? p.port }}</td><td>{{ p.nodePort || '—' }}</td><td>{{ p.protocol || 'TCP' }}</td></tr></tbody></table></div>
    </div>
    <div class="detail-section">
      <div class="detail-section-title">Endpoints <el-button link size="small" @click="loadService">{{ t('common.refresh') }}</el-button></div>
      <div v-if="loadingEndpoints">Loading…</div><div v-else-if="endpointError" class="error">{{ endpointError }}</div>
      <div v-else-if="!endpoints.length">—</div>
      <div v-else class="table-wrap"><table><thead><tr><th>Address</th><th>Port</th><th>Ready</th><th>Target</th></tr></thead>
        <tbody><tr v-for="(e,i) in endpoints" :key="i"><td>{{ e.address }}</td><td>{{ e.port }}/{{ e.protocol }}</td><td :class="{warn:e.ready==='Not Ready',ok:e.ready==='Ready'}">{{ e.ready }}</td>
          <td><button v-if="e.target && resourceLocation(e.target)" class="resource-link" @click="$emit('navigate',e.target)">{{ e.target.name }}</button><span v-else>{{ e.target?.name || '—' }}</span></td></tr></tbody></table></div>
    </div>
    <div class="detail-section">
      <div class="detail-section-title">Matching Pods</div>
      <div v-if="loadingPods">Loading…</div><div v-else-if="podError" class="error">{{ podError }}</div>
      <div v-else-if="!pods.length">—</div>
      <div v-for="p in pods" :key="p.metadata.uid" class="related-row">
        <button class="resource-link" @click="$emit('navigate',podRef(p))">{{ p.metadata.name }}</button><span>{{ p.status?.phase || 'Unknown' }}</span>
      </div>
    </div>
  </template>
  <template v-if="resourceKey === 'pods'">
    <div class="detail-section">
      <div class="detail-section-title">Containers ({{ containers.length }})</div>
      <details v-for="c in containers" :key="c.type+'/'+c.name" class="container-entry" open>
        <summary>{{ c.name }} <small>{{ c.type }} · {{ c.state }} · {{ c.status?.restartCount ?? 0 }} restarts</small></summary>
        <div class="related-row"><span>Image</span><span>{{ c.image }}</span></div>
        <div class="related-row"><span>Ready</span><span>{{ c.status?.ready ?? '—' }}</span></div>
        <div v-if="c.reason" class="related-row warn"><span>Reason</span><span>{{ c.reason }}</span></div>
        <div v-if="c.status?.state?.waiting?.message || c.status?.state?.terminated?.message" class="error">{{ c.status?.state?.waiting?.message || c.status?.state?.terminated?.message }}</div>
        <div class="related-row"><span>Requests</span><span>{{ pairs(c.resources?.requests) }}</span></div>
        <div class="related-row"><span>Limits</span><span>{{ pairs(c.resources?.limits) }}</span></div>
        <div class="container-actions">
          <el-button size="small" :disabled="!c.status?.state?.running && !c.status?.state?.terminated" @click="$emit('logs',c.name,false)">Logs</el-button>
          <el-button v-if="c.status?.restartCount" size="small" @click="$emit('logs',c.name,true)">Previous logs</el-button>
          <el-button size="small" :disabled="c.state !== 'Running'" @click="$emit('terminal',c.name)">Terminal</el-button>
        </div>
        <template v-if="c.env?.length || c.envFrom?.length">
          <strong>Environment</strong>
          <div v-for="(e,i) in c.env || []" :key="i" class="related-row">
            <span>{{ e.name }}</span>
            <button v-if="envRef(e)" class="resource-link" @click="$emit('navigate',envRef(e)!)">{{ envRef(e)?.name }}/{{ e.valueFrom?.configMapKeyRef?.key || e.valueFrom?.secretKeyRef?.key }}</button>
            <span v-else>{{ e.value ?? e.valueFrom?.fieldRef?.fieldPath ?? e.valueFrom?.resourceFieldRef?.resource ?? '—' }}</span>
          </div>
          <div v-for="(e,i) in c.envFrom || []" :key="'from'+i" class="related-row"><span>envFrom {{ e.prefix || '' }}</span><button v-if="fromRef(e)" class="resource-link" @click="$emit('navigate',fromRef(e)!)">{{ fromRef(e)?.kind }}/{{ fromRef(e)?.name }}</button></div>
        </template>
        <template v-if="c.volumeMounts?.length">
          <strong>Mounts</strong>
          <div v-for="m in c.volumeMounts" :key="m.mountPath" class="related-row"><span>{{ m.name }}</span><span>{{ m.mountPath }}{{ m.subPath ? ' (subPath: '+m.subPath+')' : '' }}{{ m.readOnly ? ' · read-only' : '' }}</span></div>
        </template>
      </details>
    </div>
    <div v-if="target?.spec?.volumes?.length" class="detail-section">
      <div class="detail-section-title">Volumes</div>
      <div v-for="v in target.spec.volumes" :key="v.name" class="related-row"><span>{{ v.name }}</span><span>{{ Object.keys(v).filter(k=>k!=='name').join(', ') }}</span></div>
    </div>
  </template>
</template>
<script setup lang="ts">
import { computed, ref, watch, onBeforeUnmount } from 'vue'
import { ElButton } from 'element-plus'
import { useI18n } from '../i18n'
import { getResource } from '../services/k8sResources'
import { listRelated, podContainers, relatedResources, resourceLocation, serviceEndpointRows, type ResourceRef } from '../services/k8sRelations'
import { requestJSON } from '../services/k8sClient'
const props=defineProps<{connId:string;target:any;resourceKey:string}>()
defineEmits<{(e:'navigate',ref:ResourceRef):void;(e:'logs',container:string,previous:boolean):void;(e:'terminal',container:string):void}>()
const {t}=useI18n()
const relations=computed(()=>relatedResources(props.target,props.target?.kind || getResource(props.resourceKey)?.kind || ''))
const containers=computed(()=>podContainers(props.target))
const ns=computed(()=>props.target?.metadata?.namespace || '')
function pairs(o:any){return Object.entries(o||{}).map(([k,v])=>k+': '+v).join(', ') || '—'}
function podRef(p:any):ResourceRef{return {kind:'Pod',name:p.metadata.name,namespace:p.metadata.namespace,uid:p.metadata.uid}}
function envRef(e:any):ResourceRef|undefined {
  const cm=e.valueFrom?.configMapKeyRef, secret=e.valueFrom?.secretKeyRef
  return cm ? {kind:'ConfigMap',name:cm.name,namespace:ns.value} : secret ? {kind:'Secret',name:secret.name,namespace:ns.value} : undefined
}
function fromRef(e:any):ResourceRef|undefined{
  return e.configMapRef ? {kind:'ConfigMap',name:e.configMapRef.name,namespace:ns.value} : e.secretRef ? {kind:'Secret',name:e.secretRef.name,namespace:ns.value} : undefined
}
const endpoints=ref<ReturnType<typeof serviceEndpointRows>>([])
const pods=ref<any[]>([])
const endpointError=ref(''),podError=ref('')
const loadingEndpoints=ref(false),loadingPods=ref(false)
let generation=0
async function loadService(){
  const gen=++generation
  endpoints.value=[];pods.value=[];endpointError.value='';podError.value=''
  loadingEndpoints.value=false;loadingPods.value=false
  if(props.resourceKey!=='services' || !ns.value || !props.target?.metadata?.name || !props.connId)return
  const conn=props.connId,namespace=encodeURIComponent(ns.value),name=props.target.metadata.name
  const selector=Object.entries(props.target.spec?.selector || {}).map(([k,v])=>k+'='+v).join(',')
  loadingEndpoints.value=true
  const endpointTask=(async()=>{
    try {
      const slices=await listRelated(conn,'/apis/discovery.k8s.io/v1/namespaces/'+namespace+'/endpointslices?labelSelector='+encodeURIComponent('kubernetes.io/service-name='+name))
      if(gen===generation) endpoints.value=serviceEndpointRows(slices)
    } catch(e:any){
      try{
        const {status,data}=await requestJSON(conn,'GET','/api/v1/namespaces/'+namespace+'/endpoints/'+encodeURIComponent(name))
        if(status!==200 && status!==404)throw new Error('HTTP '+status)
        if(gen===generation) endpoints.value=(data?.subsets||[]).flatMap((s:any)=>[...(s.addresses||[]).map((a:any)=>({...a,ready:'Ready'})),...(s.notReadyAddresses||[]).map((a:any)=>({...a,ready:'Not Ready'}))].flatMap((a:any)=>(s.ports||[]).map((p:any)=>({address:a.ip,port:p.port,name:p.name||'',protocol:p.protocol||'TCP',ready:a.ready,target:a.targetRef}))))
      }catch(f:any){if(gen===generation)endpointError.value=String(e?.message||e)+'; Endpoints fallback: '+String(f?.message||f)}
    }finally{if(gen===generation)loadingEndpoints.value=false}
  })()
  if(selector){
    loadingPods.value=true
    try{const result=await listRelated(conn,'/api/v1/namespaces/'+namespace+'/pods?labelSelector='+encodeURIComponent(selector));if(gen===generation)pods.value=result}
    catch(e:any){if(gen===generation)podError.value=String(e?.message||e)}
    finally{if(gen===generation)loadingPods.value=false}
  }
  await endpointTask
}
watch(()=>[props.connId,props.resourceKey,props.target],()=>void loadService(),{immediate:true})
onBeforeUnmount(()=>{generation++})
</script>
<style scoped>
.detail-section{margin-bottom:1rem}.detail-section-title{font-weight:600;border-bottom:1px solid var(--border-subtle);padding-bottom:.375rem;margin-bottom:.5rem}
.related-row{display:flex;justify-content:space-between;align-items:baseline;gap:.75rem;padding:.25rem 0;overflow-wrap:anywhere}
.related-row>*{min-width:0}.related-row>span:first-child{color:var(--text-muted)}
.resource-link{background:none;border:0;padding:0;color:var(--accent);text-align:left;cursor:pointer;font:inherit;overflow-wrap:anywhere;user-select:text;-webkit-user-select:text}
.resource-link:hover{text-decoration:underline}.table-wrap{overflow-x:auto}table{width:100%;border-collapse:collapse;text-align:left}th,td{padding:.375rem;border-bottom:1px solid var(--border-subtle);vertical-align:top}
.container-entry{border:1px solid var(--border-subtle);border-radius:var(--radius-sm);padding:.5rem;margin:.5rem 0}.container-entry summary{cursor:pointer;overflow-wrap:anywhere}.container-entry small{color:var(--text-muted);margin-left:.5rem}.container-actions{display:flex;flex-wrap:wrap;gap:.375rem;margin:.5rem 0}.container-actions :deep(.el-button+.el-button){margin-left:0}.ok{color:var(--el-color-success)}.warn,.error{color:var(--el-color-warning)}.error{overflow-wrap:anywhere}
</style>
