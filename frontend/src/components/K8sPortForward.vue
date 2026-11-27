<template>
 <section class="forward-section">
  <h4 v-if="!managerOnly">Port forwarding</h4>
  <template v-if="!managerOnly">
   <p class="muted">Local listeners bind to 127.0.0.1 only. TCP; WebSocket channel protocol required.</p>
   <div v-if="resourceKey==='services'">
    <el-select v-model="selected" size="small" placeholder="Select ready endpoint / port" style="width:100%">
      <el-option v-for="e in choices" :key="e.id" :label="e.label" :value="e.id"/>
    </el-select>
    <p v-if="!choices.length" class="muted">No ready TCP Pod endpoint available.</p>
   </div>
   <div class="forward-controls">
    <label>Local port <el-input-number v-model="localPort" :min="0" :max="65535" :precision="0" size="small"/></label>
    <label>Remote port <el-input-number v-model="remotePort" :min="1" :max="65535" :precision="0" size="small" :disabled="resourceKey==='services'"/></label>
    <el-button type="primary" size="small" :loading="starting" :disabled="resourceKey==='services'&&!selected" @click="start">Start</el-button>
   </div>
   <p class="muted">Local port 0 selects an available port automatically.</p>
  </template>
  <div v-if="error" class="error">{{ error }}</div>
  <div v-if="!forwards.length" class="muted">No active forwards.</div>
  <div v-for="f in forwards" :key="f.id" class="forward-entry">
   <div class="forward-line"><strong>127.0.0.1:{{ f.localPort }}</strong><el-button link size="small" @click="open(f)">Open HTTP</el-button><el-button link size="small" @click="copy(f)">Copy</el-button><el-button link size="small" type="danger" @click="stop(f.id)">Stop</el-button></div>
   <div class="muted">{{ f.namespace }}/{{ f.pod }}:{{ f.remotePort }} · Listening</div>
   <div v-if="f.lastError" class="error">Last connection error: {{ f.lastError }}</div>
  </div>
 </section>
</template>
<script setup lang="ts">
import {ref,watch,onBeforeUnmount,onMounted} from 'vue'
import {ElButton,ElInputNumber,ElSelect,ElOption} from 'element-plus'
import {listRelated,serviceEndpointRows} from '../services/k8sRelations'
import {startPortForward,stopPortForward,listPortForwards,type PortForwardInfo} from '../services/k8sClient'
import {openExternalUrl} from '../services/webSftpBridge'
import {writeClipboard} from '../composables/useClipboardWrite'
const props=defineProps<{connId:string;target?:any;resourceKey?:string;managerOnly?:boolean}>()
const localPort=ref(0),remotePort=ref(8080),starting=ref(false),error=ref(''),selected=ref('')
const choices=ref<{id:string;label:string;namespace:string;pod:string;port:number}[]>([]),forwards=ref<PortForwardInfo[]>([])
let gen=0,timer:number|undefined
async function refresh(){const conn=props.connId;if(!conn)return;try{const f=await listPortForwards(conn);if(conn===props.connId)forwards.value=f||[]}catch(e:any){if(conn===props.connId)error.value=String(e?.message||e)}}
async function loadChoices(){const g=++gen;selected.value='';choices.value=[];error.value='';const o=props.target;if(props.managerOnly||!o?.metadata?.name)return
 if(props.resourceKey==='pods'){remotePort.value=(o.spec?.containers||[]).flatMap((c:any)=>c.ports||[]).find((p:any)=>!p.protocol||p.protocol==='TCP')?.containerPort||8080;return}
 if(props.resourceKey!=='services')return
 const ns=o.metadata.namespace
 try{const rows=serviceEndpointRows(await listRelated(props.connId,'/apis/discovery.k8s.io/v1/namespaces/'+encodeURIComponent(ns)+'/endpointslices?labelSelector='+encodeURIComponent('kubernetes.io/service-name='+o.metadata.name)));if(g!==gen)return
  const map=new Map<string,{id:string;label:string;namespace:string;pod:string;port:number}>()
  for(const r of rows){if(r.target?.kind!=='Pod'||r.protocol!=='TCP'||r.ready!=='Ready'||typeof r.port!=='number')continue;const namespace=r.target.namespace||ns,pod=r.target.name,id=namespace+'/'+pod+':'+r.port;map.set(id,{id,label:(r.name?r.name+' · ':'')+id,namespace,pod,port:r.port})}
  choices.value=[...map.values()];if(choices.value.length)selected.value=choices.value[0].id
 }catch(e:any){if(g===gen)error.value=String(e?.message||e)}
}
watch(selected,id=>{const item=choices.value.find(e=>e.id===id);if(item)remotePort.value=item.port})
watch(()=>[props.connId,props.target,props.resourceKey],()=>{void loadChoices();void refresh()},{immediate:true})
async function start(){const o=props.target,item=choices.value.find(e=>e.id===selected.value),conn=props.connId;const ns=props.resourceKey==='services'?item?.namespace:o?.metadata?.namespace,pod=props.resourceKey==='services'?item?.pod:o?.metadata?.name;if(!ns||!pod||starting.value)return;starting.value=true;error.value=''
 try{await startPortForward(conn,ns,pod,localPort.value,remotePort.value);await refresh()}catch(e:any){error.value=String(e?.message||e)}finally{starting.value=false}}
async function stop(id:string){try{await stopPortForward(props.connId,id);await refresh()}catch(e:any){error.value=String(e?.message||e)}}
async function open(f:PortForwardInfo){try{await openExternalUrl('http://127.0.0.1:'+f.localPort)}catch(e:any){error.value=String(e?.message||e)}}
async function copy(f:PortForwardInfo){if(!await writeClipboard('127.0.0.1:'+f.localPort))error.value='Clipboard write failed'}
onMounted(()=>{timer=window.setInterval(refresh,3000)})
onBeforeUnmount(()=>{gen++;if(timer!==undefined)clearInterval(timer)})
</script>
<style scoped>
.forward-section{margin-bottom:1rem}.forward-section h4{font-size:inherit;border-bottom:1px solid var(--border-subtle);padding-bottom:.375rem}.forward-controls{display:flex;gap:.5rem;flex-wrap:wrap;align-items:end;margin:.5rem 0}.forward-controls label{display:flex;flex-direction:column;gap:.25rem}.forward-entry{border:1px solid var(--border-subtle);border-radius:var(--radius-sm);padding:.5rem;margin:.5rem 0}.forward-line{display:flex;align-items:center;gap:.375rem;flex-wrap:wrap}.forward-line strong{flex:1}.muted{color:var(--text-muted);font-size:.75rem}.error{color:var(--el-color-warning);overflow-wrap:anywhere}
</style>
