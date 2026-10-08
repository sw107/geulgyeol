import {createStudio} from './sdk/index.js';
import {routeHistory,observeComposition} from './edit-history.js';
const $=id=>document.getElementById(id);
let editor,busy=true,name='새 문서.hwpx',dirty=false,startupFailed=false,closeVersion=null;
function status(message){$('status').textContent=message;}
function error(error){$('error-text').textContent=String(error?.message||error);$('error-dialog').showModal();status('작업 실패 · 문서 상태를 확인하세요.');}
function lockCloseEditing(value){const doc=$('editor').querySelector('iframe')?.contentDocument;if(doc){doc.documentElement.inert=value;if(value)doc.activeElement?.blur?.();}}
function setBusy(value){if(!value)lockCloseEditing(false);busy=value;$('busy').hidden=!value;$('editor').inert=value;for(const id of ['new','open','save'])$(id).disabled=value||!editor;}
function setDirty(value){dirty=Boolean(value);window.baram?.setDirty(dirty);$('filename').textContent=name+(dirty?' · 수정됨':'');}
const host=()=>$('editor').querySelector('iframe')?.contentWindow?.baramHost;
const sameVersion=(a,b)=>a.documentEpoch===b.documentEpoch&&a.changeSeq===b.changeSeq;
function syncState(){const state=host()?.state();if(!state)throw new Error('문서의 편집 상태를 확인할 수 없습니다.');name=state.fileName||name;setDirty(state.dirty);return state;}
async function run(task,{keepBusyOnSuccess=false}={}){if(busy||!editor)return false;setBusy(true);let approved=false;try{const result=await task();approved=keepBusyOnSuccess&&result===true;return result;}catch(e){syncState();error(e);return false;}finally{if(!approved)setBusy(false);}}
async function approveTransition(action){
  const before=await editor.getDocumentState();
  if(before.dirty){
    const choice=window.baram?.confirmUnsaved?await window.baram.confirmUnsaved(action):
      (confirm('저장하지 않은 변경 사항을 버리고 계속할까요?')?'discard':'cancel');
    if(choice==='cancel')return null;
    // Do not save/discard a different revision than the one the user confirmed.
    if(!sameVersion(before,await editor.getDocumentState()))throw new Error('확인 중 문서가 변경되었습니다. 다시 확인해 주세요.');
    if(choice==='save'&&!await saveCurrent())return null;
  }
  const current=await editor.getDocumentState();
  if(!sameVersion(before,current))throw new Error('확인 후 문서가 변경되었습니다. 다시 확인해 주세요.');
  return current;
}
window.baramPrepareClose=()=>startupFailed?Promise.resolve('startup-failed'):run(async()=>{
  const expected=await approveTransition('close');
  if(!expected)return false;
  if(!host()?.prepareDiscardClose)throw new Error('복구본 정리 모듈이 준비되지 않았습니다.');
  lockCloseEditing(true);
  await host().prepareDiscardClose(expected);
  closeVersion=expected;
  return true;
},{keepBusyOnSuccess:true});
window.baramFinalizeClose=async()=>{
  if(!busy||!closeVersion)return false;
  try{host().assertDocumentVersion(closeVersion);return true;}
  catch(e){closeVersion=null;host().cancelDiscardClose();syncState();setBusy(false);error(e);return false;}
};
async function open(){
  if(busy||!editor)return;
  if(window.baram){await run(async()=>{const expected=await approveTransition('open');if(!expected)return false;const file=await window.baram.open();if(file)await load(file.data,file.name,expected);});}
  else $('browser-file').click();
}
async function load(data,fileName,expected){
  if(data.byteLength>64*1024*1024)throw new Error('64 MB보다 큰 문서는 지원하지 않습니다.');
  const buffer=data.buffer.slice(data.byteOffset||0,(data.byteOffset||0)+data.byteLength);
  // Preserve upstream warnings. Dialogs are part of the interactive open workflow.
  $('editor').inert=false;$('busy').hidden=true;
  status('문서를 여는 중… 안내창이 뜨면 내용을 확인하세요.');
  const result=expected?await host().loadDocument(new Uint8Array(buffer),fileName,expected):
    await editor.loadFile(buffer,fileName,{skipUnsavedGuard:true,suppressDialogs:false});
  const state=$('editor').querySelector('iframe')?.contentWindow?.baramHost?.state();
  if(!state)throw new Error('열린 문서의 편집 상태를 확인할 수 없습니다.');
  name=state.fileName||fileName;$('format').value=/\.hwp$/i.test(name)?'hwp':'hwpx';setDirty(state.dirty);
  status(state.dirty?'저장하지 않은 변경 사항':`${result.pageCount}쪽 열림 · 원본과 배치를 확인하세요.`);
}
async function saveCurrent(){
  const before=await editor.getDocumentState();
  const format=$('format').value;
  status('저장 데이터를 만들고 있습니다…');
  const fileHost=host();
  if(!fileHost)throw new Error('로컬 저장 검증 모듈이 준비되지 않았습니다.');
  const bytes=fileHost.export(format);
  if(window.baram){
    const saved=await window.baram.save(bytes,name,format);
    if(!saved){status('저장을 취소했습니다.');return false;}
    const after=await editor.getDocumentState();
    if(sameVersion(before,after)){
      const completed=await fileHost.completeSavedSnapshot(saved.name,before);
      const current=syncState();
      if(completed.ok&&!current.dirty){status(`${saved.size.toLocaleString()}바이트 저장 완료`);return true;}
    }
    syncState();status('사본 저장 완료 · 저장 중의 추가 편집은 아직 저장되지 않았습니다.');return false;
  }else{
    const url=URL.createObjectURL(new Blob([bytes]));const a=document.createElement('a');a.href=url;a.download=name.replace(/\.(hwp|hwpx)$/i,'')+'-편집.'+format;a.click();
    setTimeout(()=>URL.revokeObjectURL(url),60000);
    status('다운로드 요청 완료 · 브라우저 다운로드를 확인하세요.');
    // A download request does not prove durable storage. Keep the recovery draft.
  }
  return false;
}
async function save(){return run(saveCurrent);}
$('new').onclick=async()=>{
  if(busy||!editor)return;
  let created=false;
  await run(async()=>{
    const expected=await approveTransition('new');if(!expected)return;
    if(!host()?.newDocument)throw new Error('새 문서 초기화 모듈이 준비되지 않았습니다.');
    const state=await host().newDocument(expected);
    name=state.fileName||'새 문서.hwp';setDirty(state.dirty);status('준비됨');created=true;
  });
  if(created)$('editor').querySelector('iframe')?.contentWindow?.baramHost?.focus();
};
$('error-dialog').onclose=()=>{if(!busy)$('editor').querySelector('iframe')?.contentWindow?.baramHost?.focus();};
$('open').onclick=open;$('save').onclick=save;$('about').onclick=()=>$('about-dialog').showModal();
$('browser-file').onchange=()=>{const file=$('browser-file').files[0];$('browser-file').value='';if(file)run(async()=>{const expected=await approveTransition('open');if(expected)await load(new Uint8Array(await file.arrayBuffer()),file.name,expected);});};
window.addEventListener('beforeunload',e=>{if(dirty){e.preventDefault();e.returnValue='';}});
window.addEventListener('message',event=>{
  if(event.origin!==location.origin||event.source!==$('editor').querySelector('iframe')?.contentWindow||event.data?.type!=='baram-state')return;
  // The queued notification may precede a more recent edit or document swap.
  syncState();if(!busy)status(dirty?'저장하지 않은 변경 사항':'준비됨');
});
window.baram?.onAction(action=>{if(action==='open')open();if(action==='save')save();if(action==='about')$('about-dialog').showModal();if(action==='undo'||action==='redo')routeHistory(action,{document,editor,busy}).catch(error);});
try{
  editor=await createStudio('#editor',{studioUrl:new URL('./studio/',location.href).href,renderer:'canvas2d',requestTimeoutMs:60000});
  // Startup may still be initializing its first blank document after SDK ready.
  // Keep file actions disabled until that initialization can no longer clear edits.
  await host()?.ready?.();
  observeComposition(document);
  const studioFrame=$('editor').querySelector('iframe');
  const observeStudio=()=>{if(studioFrame?.contentDocument)observeComposition(studioFrame.contentDocument);};
  observeStudio();studioFrame?.addEventListener('load',observeStudio);
  const fileHost=studioFrame?.contentWindow?.baramHost;
  if(window.baram)fileHost?.setFileActions(action=>{
    if(busy)return;
    if(action==='open')void open();
    else if(action==='new')$('new').click();
    else if(['save','save-hwp','save-hwpx'].includes(action)){
      if(action!=='save')$('format').value=action.slice(5);
      void save();
    }
  });
  const initial=$('editor').querySelector('iframe')?.contentWindow?.baramHost?.state();
  if(initial){name=initial.fileName||name;setDirty(initial.dirty);}
  setBusy(false);$('fonts').disabled=false;status(window.baram?'문서는 이 기기에서 처리됩니다.':'브라우저 테스트 모드 · 저장은 다운로드로 제공됩니다.');
}catch(e){startupFailed=true;setBusy(true);error(e);}

$('licenses').onclick=async()=>{const text=await (await fetch('./licenses/INDEX.txt')).text();const pre=document.createElement('pre');pre.style.whiteSpace='pre-wrap';pre.textContent=text;$('licenses').replaceWith(pre);};

$('fonts').onclick=async()=>{
  const host=$('editor').querySelector('iframe')?.contentWindow?.baramHost;
  if(!host)return;
  $('fonts').disabled=true;
  try{const count=await host.detectFonts();status(`설치 글꼴 ${count}개를 글꼴 목록에 추가했습니다.`);}catch(e){error(e);}finally{$('fonts').disabled=false;}
};
