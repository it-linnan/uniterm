<template>
  <section v-if="workload || storage" class="diag-section">
    <h4>{{ workload ? 'Workload Pods' : 'Claim consumers' }} <el-button size="small" link @click="load">{{ t('common.refresh') }}</el-button></h4>
    <div v-if="workload && templateContainers.length" class="diag-wrap"><table><thead><tr><th>Container template</th><th>Image</th></tr></thead><tbody><tr v-for="c in templateContainers" :key="c.name"><td>{{ c.name }}</td><td>{{ c.image }}</td></tr></tbody></table></div>
    <div v-if="busyPods">Loading…</div><div v-else-if="podError" class="error">{{ podError }}</div><div v-else-if="!pods.length">—</div>
    <div v-for="p in pods" :key="p.metadata.uid" class="diag-row"><button class="link" @click="$emit('navigate',refOf(p,'Pod'))">{{ p.metadata.name }}</button><span>{{ p.status?.phase || 'Unknown' }}</span></div>
    <div v-if="replicasets.length"><strong>ReplicaSets</strong><div v-for="r in replicasets" :key="r.metadata.uid" class="diag-row"><button class="link" @click="$emit('navigate',refOf(r,'ReplicaSet'))">{{ r.metadata.name }}</button><span>{{ r.status?.readyReplicas || 0 }}/{{ r.spec?.replicas ?? 0 }}</span></div></div>
  </section>
  <section v-if="target?.metadata?.uid" class="diag-section">
    <h4>Events <el-button size="small" link @click="load">{{ t('common.refresh') }}</el-button></h4>
    <el-select v-model="eventType" size="small" style="width:8rem"><el-option label="All" value=""/><el-option label="Warning" value="Warning"/><el-option label="Normal" value="Normal"/></el-select>
    <div v-if="busyEvents">Loading…</div><div v-else-if="eventError" class="error">{{ eventError }}</div><div v-else-if="!filteredEvents.length">—</div>
    <div v-else class="diag-wrap"><table><thead><tr><th>Type / Reason</th><th>Message</th><th>Last seen</th><th>Count</th></tr></thead><tbody><tr v-for="e in filteredEvents" :key="e.metadata?.uid"><td :class="{error:e.type==='Warning'}">{{ e.type }}<br>{{ e.reason }}</td><td>{{ e.message }}</td><td>{{ eventTime(e) }}</td><td>{{ e.series?.count ?? e.count ?? 1 }}</td></tr></tbody></table></div>
  </section>
</template>
<script setup lang="ts">
import {computed,ref,watch,onBeforeUnmount} from 'vue'
import {ElButton,ElSelect,ElOption} from 'element-plus'
import {useI18n} from '../i18n'
import {listRelated,type ResourceRef} from '../services/k8sRelations'
const props=defineProps<{connId:string;target:any;resourceKey:string}>()
defineEmits<{(e:'navigate',r:ResourceRef):void}>()
const {t}=useI18n()
const workload=computed(()=>['deployments','replicasets','statefulsets','daemonsets','jobs','cronjobs'].includes(props.resourceKey))
const storage=computed(()=>['persistentvolumes','persistentvolumeclaims'].includes(props.resourceKey))
const templateContainers=computed(()=>{const spec=props.target?.spec?.template?.spec || props.target?.spec?.jobTemplate?.spec?.template?.spec;return [...(spec?.initContainers||[]),...(spec?.containers||[])]})
const pods=ref<any[]>([]),replicasets=ref<any[]>([]),events=ref<any[]>([])
const podError=ref(''),eventError=ref(''),busyPods=ref(false),busyEvents=ref(false),eventType=ref('')
const filteredEvents=computed(()=>events.value.filter(e=>!eventType.value||e.type===eventType.value))
function eventTime(e:any){return e.series?.lastObservedTime || e.lastTimestamp || e.eventTime || e.metadata?.creationTimestamp || '—'}
function refOf(o:any,kind:string):ResourceRef{return {kind,name:o.metadata.name,namespace:o.metadata.namespace,uid:o.metadata.uid}}
function owned(o:any,uids:Set<string>){return (o.metadata?.ownerReferences||[]).some((r:any)=>uids.has(r.uid))}
let gen=0
async function load(){
 const g=++gen,o=props.target,conn=props.connId
 pods.value=[];replicasets.value=[];events.value=[];podError.value='';eventError.value='';busyPods.value=false;busyEvents.value=false
 if(!o?.metadata?.uid||!conn)return
 const uid=o.metadata.uid,ns=o.metadata.namespace,nsPath=ns?'/namespaces/'+encodeURIComponent(ns):''
 busyEvents.value=true
 const et=(async()=>{try{const es=await listRelated(conn,'/api/v1'+nsPath+'/events?fieldSelector='+encodeURIComponent('involvedObject.uid='+uid));if(g===gen)events.value=es.sort((a,b)=>eventTime(b).localeCompare(eventTime(a)))}catch(e:any){if(g===gen)eventError.value=String(e?.message||e)}finally{if(g===gen)busyEvents.value=false}})()
 if(workload.value||storage.value){
  busyPods.value=true
  try{
   const claim=props.resourceKey==='persistentvolumes'?o.spec?.claimRef:props.resourceKey==='persistentvolumeclaims'?{namespace:ns,name:o.metadata.name}:null
   if(storage.value && !claim?.namespace)return
   const scope='/namespaces/'+encodeURIComponent(claim?.namespace||ns)
   const ownerUids=new Set<string>([uid])
   if(props.resourceKey==='deployments'||props.resourceKey==='cronjobs'){
    const child=props.resourceKey==='deployments'?'replicasets':'jobs',api=child==='replicasets'?'apps/v1':'batch/v1'
    const cs=(await listRelated(conn,'/apis/'+api+scope+'/'+child)).filter(x=>owned(x,ownerUids))
    for(const c of cs)ownerUids.add(c.metadata.uid)
    if(g===gen&&child==='replicasets')replicasets.value=cs
   }
   const all=await listRelated(conn,'/api/v1'+scope+'/pods')
   if(g===gen)pods.value=claim?all.filter(p=>(p.spec?.volumes||[]).some((v:any)=>v.persistentVolumeClaim?.claimName===claim.name)):all.filter(p=>owned(p,ownerUids))
  }catch(e:any){if(g===gen)podError.value=String(e?.message||e)}finally{if(g===gen)busyPods.value=false}
 }
 await et
}
watch(()=>[props.target,props.connId,props.resourceKey],()=>{eventType.value='';void load()},{immediate:true})
onBeforeUnmount(()=>{gen++})
</script>
<style scoped>
.diag-section{margin-bottom:1rem;user-select:text;-webkit-user-select:text}.diag-section h4{font-size:inherit;border-bottom:1px solid var(--border-subtle);padding-bottom:.375rem}.diag-row{display:flex;justify-content:space-between;gap:.5rem;padding:.25rem 0;overflow-wrap:anywhere}.link{border:0;background:none;color:var(--accent);font:inherit;cursor:pointer;padding:0;text-align:left}.link:hover{text-decoration:underline}.diag-wrap{overflow-x:auto}table{width:100%;border-collapse:collapse;text-align:left}td,th{border-bottom:1px solid var(--border-subtle);padding:.375rem;vertical-align:top;overflow-wrap:anywhere}.error{color:var(--el-color-warning);overflow-wrap:anywhere}
</style>
