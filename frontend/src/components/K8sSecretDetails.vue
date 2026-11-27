<template>
 <section class="secret-section">
  <h4>Secret data ({{ keys.length }})</h4>
  <p>Values are hidden by default. Reveal only the key you need.</p>
  <div v-for="key in keys" :key="key" class="secret-entry">
   <div class="secret-header"><strong>{{ key }}</strong><span v-if="activeKey!==key" class="masked">••••••••</span>
    <el-button size="small" link :disabled="saving || !!editKey" @click="toggle(key)">{{ activeKey===key?'Hide':'Reveal' }}</el-button>
    <el-button v-if="activeKey===key && !object?.immutable && !editKey" size="small" link @click="start(key)">{{ t('k8s.edit') }}</el-button>
   </div>
   <template v-if="activeKey===key">
    <div class="secret-mode"><el-button size="small" link :disabled="!!editKey" @click="raw=!raw">{{ raw?'Decode UTF-8':'Base64' }}</el-button><span>{{ raw?'Base64':'UTF-8' }}</span></div>
    <div v-if="decodeError && !raw" class="error">{{ decodeError }}</div>
    <div v-else class="secret-editor"><SyntaxEditor :key="key+'/'+raw+'/'+!!editKey" :model-value="editKey===key?draft:displayValue" :file-path="raw?'':key" :lang="raw?undefined:language" :readonly="!editKey || saving" compact show-search-button @update:model-value="v=>{if(editKey)draft=v}" /></div>
    <div v-if="editKey===key" class="secret-mode"><el-button size="small" :disabled="saving" @click="cancel">{{ t('common.cancel') }}</el-button><el-button size="small" type="primary" :loading="saving" @click="save">{{ t('common.save') }}</el-button></div>
    <div v-if="error" class="error">{{ error }}</div>
   </template>
  </div>
 </section>
</template>
<script setup lang="ts">
import {computed,ref,watch} from 'vue'
import {ElButton} from 'element-plus'
import {useI18n} from '../i18n'
import {requestJSON} from '../services/k8sClient'
import {configMapEntries} from '../services/k8sResources'
import SyntaxEditor from './SyntaxEditor.vue'
const props=defineProps<{connId:string;target:any}>()
const emit=defineEmits<{(e:'saved',o:any):void}>()
const {t}=useI18n()
const saved=ref<any>(null),activeKey=ref(''),editKey=ref(''),raw=ref(false),draft=ref(''),saving=ref(false),error=ref('')
const object=computed(()=>saved.value||props.target)
const keys=computed(()=>Object.keys(object.value?.data||{}))
function decode(v:string){return new TextDecoder('utf-8',{fatal:true}).decode(Uint8Array.from(atob(v),c=>c.charCodeAt(0)))}
function encode(v:string){let binary='';for(const b of new TextEncoder().encode(v))binary+=String.fromCharCode(b);return btoa(binary)}
const decodeError=computed(()=>{if(!activeKey.value||raw.value)return '';try{decode(object.value?.data?.[activeKey.value]||'');return ''}catch{return 'Not valid UTF-8; use Base64 mode.'}})
const displayValue=computed(()=>{const v=object.value?.data?.[activeKey.value]||'';if(raw.value)return v;try{return decode(v)}catch{return ''}})
const language=computed(()=>configMapEntries({[activeKey.value]:displayValue.value})[0]?.lang)
let generation=0
watch(()=>props.target,()=>{generation++;saved.value=null;activeKey.value='';editKey.value='';draft.value='';error.value='';raw.value=false})
function toggle(key:string){activeKey.value=activeKey.value===key?'':key;raw.value=false;error.value='';draft.value=''}
function start(key:string){if(decodeError.value&&!raw.value)return;editKey.value=key;draft.value=displayValue.value;error.value=''}
function cancel(){editKey.value='';draft.value='';error.value=''}
async function save(){
 if(!editKey.value||saving.value)return
 const o=object.value,key=editKey.value,original=o.data[key],uid=o.metadata?.uid,g= generation
 if(!uid||o.immutable)return
 let value:string
 try{value=raw.value?btoa(atob(draft.value)):encode(draft.value)}catch{error.value='Invalid Base64';return}
 if(value===original){cancel();return}
 const p='/data/'+key.replace(/~/g,'~0').replace(/\//g,'~1')
 saving.value=true;error.value=''
 try{
  const {status,data}=await requestJSON(props.connId,'PATCH','/api/v1/namespaces/'+encodeURIComponent(o.metadata.namespace)+'/secrets/'+encodeURIComponent(o.metadata.name),[{op:'test',path:'/metadata/uid',value:uid},{op:'test',path:p,value:original},{op:'replace',path:p,value}],'application/json-patch+json')
  if(g!==generation)return
  if(status<200||status>=300){error.value='HTTP '+status+' — save failed or value changed';return}
  saved.value=data||{...o,data:{...o.data,[key]:value}};cancel();emit('saved',saved.value)
 }catch{if(g===generation)error.value='Unable to save Secret; reopen and retry.'}finally{saving.value=false}
}
</script>
<style scoped>
.secret-section h4{font-size:inherit;border-bottom:1px solid var(--border-subtle);padding-bottom:.375rem}.secret-section p,.masked{color:var(--text-muted)}.secret-entry{padding:.5rem;border:1px solid var(--border-subtle);border-radius:var(--radius-sm);margin:.5rem 0}.secret-header,.secret-mode{display:flex;align-items:center;gap:.5rem}.secret-header strong{flex:1;min-width:0;overflow-wrap:anywhere}.secret-mode{justify-content:flex-end;margin:.375rem 0}.secret-editor{height:16rem}.error{color:var(--el-color-warning)}
</style>
