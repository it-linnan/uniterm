<template>
 <section class="node-detail">
  <h4>Resource allocation <el-button size="small" link @click="load">{{ t('common.refresh') }}</el-button></h4>
  <div v-if="loading">Loading…</div>
  <div v-if="error" class="error">{{ error }}</div>
  <div class="node-table"><table><thead><tr><th>Resource</th><th>Capacity</th><th>Allocatable</th><th>Requests</th><th>Limits</th><th>Usage</th></tr></thead><tbody>
   <tr v-for="r in rows" :key="r.label"><td>{{ r.label }}</td><td>{{ r.capacity }}</td><td>{{ r.allocatable }}</td><td>{{ r.requests }}</td><td>{{ r.limits }}</td><td>{{ r.usage }}</td></tr>
  </tbody></table></div>
  <div v-for="r in bars" :key="r.label" class="node-bar"><span>{{ r.label }} {{ r.text }}</span><div><i :style="{width:r.width+'%',background:r.width>=90?'var(--el-color-warning)':'var(--accent)'}"></i></div></div>
  <p v-if="metricsMissing" class="muted">Metrics unavailable (metrics-server or RBAC).</p>
  <h4>Pods {{ podKnown?'('+pods.length+')':'' }}</h4>
  <div v-if="podKnown && !pods.length">—</div>
  <div v-for="p in pods" :key="p.metadata.uid" class="node-pod"><button class="link" @click="$emit('navigate',{kind:'Pod',name:p.metadata.name,namespace:p.metadata.namespace,uid:p.metadata.uid})">{{ p.metadata.namespace }}/{{ p.metadata.name }}</button><span>{{ p.status?.phase }}</span></div>
 </section>
</template>
<script setup lang="ts">
import {computed,ref,watch,onBeforeUnmount} from 'vue'
import {ElButton} from 'element-plus'
import {useI18n} from '../i18n'
import {listRelated,type ResourceRef} from '../services/k8sRelations'
import {requestJSON} from '../services/k8sClient'
import {parseCpu,parseMemory,formatCpu,formatMemory} from '../services/k8sQuantity'
import {podResourceTotals} from '../services/k8sResources'
const props=defineProps<{connId:string;target:any}>()
defineEmits<{(e:'navigate',r:ResourceRef):void}>()
const {t}=useI18n()
const pods=ref<any[]>([]),podKnown=ref(false),metrics=ref<any>(null),metricsMissing=ref(false),loading=ref(false),error=ref('')
const totals=computed(()=>pods.value.filter(p=>!['Succeeded','Failed'].includes(p.status?.phase)).reduce((a,p)=>{const v=podResourceTotals(p);return {cpuReq:a.cpuReq+v.cpuReq,cpuLim:a.cpuLim+v.cpuLim,memReq:a.memReq+v.memReq,memLim:a.memLim+v.memLim}},{cpuReq:0,cpuLim:0,memReq:0,memLim:0}))
const rows=computed(()=>{const s=props.target?.status||{},v=totals.value;return [{label:'CPU',capacity:s.capacity?.cpu||'—',allocatable:s.allocatable?.cpu||'—',requests:podKnown.value?formatCpu(v.cpuReq):'—',limits:podKnown.value?formatCpu(v.cpuLim):'—',usage:metrics.value?.cpu?formatCpu(parseCpu(metrics.value.cpu)):'—'},{label:'Memory',capacity:s.capacity?.memory||'—',allocatable:s.allocatable?.memory||'—',requests:podKnown.value?formatMemory(v.memReq):'—',limits:podKnown.value?formatMemory(v.memLim):'—',usage:metrics.value?.memory?formatMemory(parseMemory(metrics.value.memory)):'—'},{label:'Pods',capacity:s.capacity?.pods||'—',allocatable:s.allocatable?.pods||'—',requests:'—',limits:'—',usage:podKnown.value?String(pods.value.filter(p=>!['Succeeded','Failed'].includes(p.status?.phase)).length):'—'}]})
const bars=computed(()=>{const s=props.target?.status?.allocatable||{},out:{label:string;text:string;width:number}[]=[];const add=(label:string,n:number,d:number)=>{if(d>0){const p=Math.round(n/d*100);out.push({label,text:p+'%',width:Math.min(100,Math.max(0,p))})}};if(podKnown.value){add('CPU requests',totals.value.cpuReq,parseCpu(s.cpu));add('Memory requests',totals.value.memReq,parseMemory(s.memory))}if(metrics.value?.cpu)add('CPU usage',parseCpu(metrics.value.cpu),parseCpu(s.cpu));if(metrics.value?.memory)add('Memory usage',parseMemory(metrics.value.memory),parseMemory(s.memory));return out})
let gen=0
async function load(){const g=++gen,conn=props.connId,name=props.target?.metadata?.name;pods.value=[];podKnown.value=false;metrics.value=null;metricsMissing.value=false;error.value='';if(!conn||!name)return;loading.value=true
 await Promise.all([listRelated(conn,'/api/v1/pods?fieldSelector='+encodeURIComponent('spec.nodeName='+name)).then(v=>{if(g===gen){pods.value=v;podKnown.value=true}}).catch(e=>{if(g===gen)error.value=String(e?.message||e)}),requestJSON(conn,'GET','/apis/metrics.k8s.io/v1beta1/nodes/'+encodeURIComponent(name)).then(r=>{if(g===gen){metrics.value=r.status===200?r.data?.usage:null;metricsMissing.value=!metrics.value}}).catch(()=>{if(g===gen)metricsMissing.value=true})]);if(g===gen)loading.value=false}
watch(()=>[props.target,props.connId],()=>void load(),{immediate:true})
onBeforeUnmount(()=>{gen++})
</script>
<style scoped>
.node-detail{margin-bottom:1rem;user-select:text;-webkit-user-select:text}.node-detail h4{font-size:inherit;border-bottom:1px solid var(--border-subtle);padding-bottom:.375rem}.node-table{overflow-x:auto}table{width:100%;border-collapse:collapse;text-align:left}td,th{padding:.375rem;border-bottom:1px solid var(--border-subtle)}.node-bar{margin:.5rem 0}.node-bar>div{height:.4rem;background:var(--bg-hover);border-radius:.25rem;overflow:hidden;margin-top:.25rem}.node-bar i{display:block;height:100%}.muted{color:var(--text-muted)}.error{color:var(--el-color-warning);overflow-wrap:anywhere}.node-pod{display:flex;justify-content:space-between;gap:.5rem;padding:.25rem 0}.link{background:none;border:0;color:var(--accent);font:inherit;text-align:left;cursor:pointer;padding:0}
</style>
