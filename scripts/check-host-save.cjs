// Official main.cjs IPC handler + storage.cjs, real isolated files.
// Electron window/dialog/session are adapters; no OS dialogs or renderer claim.
const fs=require('node:fs/promises');
const sync=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const {pathToFileURL}=require('node:url');
const root=path.resolve(__dirname,'..');
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};

async function bootHost(mainFile,storage,choose){
 const handlers=new Map(),ready=deferred();let win;const origin='http://127.0.0.1:39877';
 const app={setPath(){},getPath(){return '/ADAPTER-NOT-USED';},requestSingleInstanceLock:()=>true,
  on(){},quit(){},getVersion:()=> 'source-host-test',setAboutPanelOptions(){},
  whenReady:()=>Promise.resolve()};
 class Window{
  constructor(){win=this;this.webContents={mainFrame:{url:origin+'/'},on(){},send(){},
   setWindowOpenHandler(){}};}
  isDestroyed(){return false;}on(){}setDocumentEdited(){}show(){ready.resolve();}
  async loadURL(url){assert.equal(url,origin+'/');}
 }
 const forbidden=()=>{throw Error('OS dialog/window action forbidden in host QA');};
 const electron={app,BrowserWindow:Window,dialog:{showSaveDialog:(_win,options)=>choose(options),
  showOpenDialog:forbidden,showMessageBox:forbidden,showErrorBox:forbidden},
  ipcMain:{handle:(name,fn)=>handlers.set(name,fn),on(){}},
  Menu:{setApplicationMenu(){},buildFromTemplate:x=>x},session:{defaultSession:{
   webRequest:{onBeforeRequest(){}},setPermissionRequestHandler(){},setPermissionCheckHandler(){},on(){}}}};
 const source=sync.readFileSync(mainFile,'utf8');
 vm.runInNewContext(source,{require:name=>{
  if(name==='electron')return electron;
  if(name==='./server.cjs')return {startServer:async()=>({origin,server:{close(){}}})};
  if(name==='./storage.cjs')return storage;
  if(name.startsWith('./'))return require(path.join(root,'desktop',name));
  return require(name);
 },__dirname:path.join(root,'desktop'),process:{platform:process.platform},Buffer,Uint8Array},
 {filename:mainFile});
 await ready.promise;
 return {save:handlers.get('baram:save'),event:{sender:win.webContents,senderFrame:win.webContents.mainFrame}};
}

function storageWithFaults(file,fault){
 const actual=require('node:fs/promises');
 let closes=0,opens=0;const io={...actual,open:async(...args)=>{
  const h=await actual.open(...args);opens++;
  return {writeFile:async data=>{
   await h.writeFile(data);
   if(fault==='write-and-close')throw Object.assign(Error('synthetic-write-EIO'),{code:'EIO'});
  },sync:async()=>{
   if(fault==='sync')throw Object.assign(Error('synthetic-sync-EIO'),{code:'EIO'});
   return h.sync();
  },close:async()=>{closes++;await h.close();
   if(fault==='write-and-close')throw Object.assign(Error('synthetic-close-EIO'),{code:'EIO'});
  }};
 }};
 const context={require:name=>name==='node:fs/promises'?io:name==='node:crypto'&&fault==='collision'?{
  randomUUID:()=> 'collision-existing'
 }:require(name),module:{exports:{}},Buffer,Uint8Array};
 vm.runInNewContext(sync.readFileSync(file,'utf8'),context,{filename:file});
 return {...context.module.exports,counters:()=>({closes,opens})};
}

async function uiController(save,bytes){
 const elements=new Map(),get=id=>{if(!elements.has(id))elements.set(id,{
  hidden:false,disabled:false,textContent:'',value:'hwpx',showModal(){this.open=true;}});return elements.get(id);};
 let state={dirty:true,fileName:'synthetic.hwpx',documentEpoch:1,changeSeq:1};
 const notified=[],reported=[];
 const frame={contentWindow:{baramHost:{state:()=>state,export:()=>bytes,setFileActions(){},focus(){},completeSavedSnapshot:async(name,expected)=>{
  if(state.documentEpoch!==expected.documentEpoch||state.changeSeq!==expected.changeSeq)return {ok:false};
  notified.push(name);state={...state,dirty:false,fileName:name};return {ok:true};
 }}},addEventListener(){}};
 get('editor').querySelector=()=>frame;
 const editor={getDocumentState:async()=>({...state}),notifySaved:async name=>{
  notified.push(name);state={...state,dirty:false,fileName:name};
 }};
 const source=sync.readFileSync(path.join(root,'desktop/web/baram.js'),'utf8').replace(/^import .*;$/gm,'');
 await vm.runInNewContext('(async()=>{'+source+'})()',{
  document:{getElementById:get},window:{addEventListener(){},baram:{save,setDirty:v=>reported.push(v),onAction(){}}},
  location:{href:'http://127.0.0.1/',origin:'http://127.0.0.1'},URL,Uint8Array,
  createStudio:async()=>editor,observeComposition(){},confirm:()=>true,
 });
 return {get,notified,reported,edit:()=>state={...state,dirty:true,changeSeq:state.changeSeq+1}};
}

async function main(){
 const q=path.resolve(process.argv[2]),mode=process.argv[3];assert(['baseline','final','final-schema'].includes(mode));
 const final=mode!=='baseline',seed=process.argv[4]?path.resolve(process.argv[4]):null;
 assert(mode!=='final-schema'||seed,'final-schema requires a verified synthetic seed');
 const out=path.join(q,mode);await fs.mkdir(out); // Refuse an existing run.
 const mainFile=mode==='baseline'?path.join(q,'baseline-main.cjs'):path.join(root,'desktop/main.cjs');
 const storageFile=mode==='baseline'?path.join(q,'baseline-storage.cjs'):path.join(root,'desktop/storage.cjs');
 const storage=require(storageFile);const checks=[],problems=[],native=[];
 const add=(name,details={})=>{checks.push({name,...details});console.log('PASS '+name);};
 const fixtures=path.join(q,seed?'schema-fixtures':'fixtures');
 if(!sync.existsSync(fixtures)){
  await fs.mkdir(fixtures);
  const engine=process.env.GEULGYEOL_QA_ENGINE_DIR||path.join(root,'../dev12-integration-qa/packaged-engine');
  const wasm=await import(pathToFileURL(path.join(engine,'rhwp.js')));
  wasm.initSync({module:await fs.readFile(path.join(engine,'rhwp_bg.wasm'))});
  for(const [label,text] of [['old','이전 합성 문서🙂'],['edited','저장 검증 한글🙂 새 내용']]){
   const doc=seed?new wasm.HwpDocument(await fs.readFile(seed)):wasm.HwpDocument.createEmpty();
   try{doc.insertText(0,0,0,text);
    for(const ext of ['hwp','hwpx']){const exported=doc[ext==='hwp'?'exportHwpWithReport':'exportHwpxWithReport']();
     try{assert.equal(JSON.parse(exported.contentLoss()).count,0);await fs.writeFile(path.join(fixtures,label+'.'+ext),exported.takeBytes());}
     finally{exported.free();}
    }
   }finally{doc.free();}
  }
 }
 const bytes={};for(const ext of ['hwp','hwpx'])for(const label of ['old','edited'])bytes[label+'.'+ext]=await fs.readFile(path.join(fixtures,label+'.'+ext));
 let selected,dialogCount=0,lastOptions;const host=await bootHost(mainFile,storage,async options=>{
  dialogCount++;lastOptions=options;return selected;
 });
 const save=(ext,label='edited',name='합성.'+ext)=>host.save(host.event,{data:bytes[label+'.'+ext],name,format:ext});
 const listTemps=async dir=>(await fs.readdir(dir)).filter(n=>n.startsWith('.baram-')&&n.endsWith('.tmp'));
 async function exact(file,data){assert.equal(sha(await fs.readFile(file)),sha(data));}
 function nativeRow(file,label,ext){native.push({input:path.join(fixtures,label+'.'+ext),file,ops:[]});}
 for(const ext of ['hwp','hwpx']){
  const file=path.join(out,'new.'+ext);selected={canceled:false,filePath:file};
  const result=await save(ext);assert.deepEqual({...result},{name:'new.'+ext,size:bytes['edited.'+ext].length});
  assert.equal(lastOptions.defaultPath,'합성-편집.'+ext);await exact(file,bytes['edited.'+ext]);nativeRow(file,'edited',ext);
  add('new-'+ext,{file,bytes:result.size});
  const replacement=path.join(out,'replace.'+ext);await fs.writeFile(replacement,bytes['old.'+ext],{mode:0o600});selected.filePath=replacement;
  await save(ext);await exact(replacement,bytes['edited.'+ext]);assert.equal((await fs.stat(replacement)).mode&0o777,0o600);
  nativeRow(replacement,'edited',ext);add('replace-'+ext,{file:replacement});
 }
 const protectedFile=path.join(out,'preserved.hwp');await fs.writeFile(protectedFile,bytes['old.hwp']);
 for(const choice of [{canceled:true,filePath:protectedFile},{canceled:false}]){
  selected=choice;assert.equal(await save('hwp'),null);await exact(protectedFile,bytes['old.hwp']);
 }add('cancel-and-no-path-preserve');
 selected={canceled:false,filePath:protectedFile};
 await assert.rejects(save('hwpx'),/확장자/);await exact(protectedFile,bytes['old.hwp']);add('extension-mismatch-preserves-existing');
 const upper=path.join(out,'uppercase.HWP');selected.filePath=upper;await save('hwp');await exact(upper,bytes['edited.hwp']);nativeRow(upper,'edited','hwp');add('uppercase-extension');
 const callsBefore=dialogCount;
 for(const args of [{data:bytes['edited.hwp'],format:'hwpx'},{data:bytes['edited.hwpx'],format:'hwp'},
  {data:new Uint8Array(),format:'hwp'},{data:'invalid',format:'hwp'},
  {data:bytes['edited.hwp'],format:'other'},{data:new Uint8Array(storage.MAX_BYTES+1),format:'hwp'}]){
  await assert.rejects(host.save(host.event,args));
 }assert.equal(dialogCount,callsBefore);add('six-data-and-format-refusals-before-dialog');
 await assert.rejects(host.save({...host.event,sender:{}},{data:bytes['edited.hwp'],format:'hwp'}),/허용되지/);
 assert.equal(dialogCount,callsBefore);add('untrusted-refusal');
 const folder=path.join(out,'directory.hwp');await fs.mkdir(folder);await fs.writeFile(path.join(folder,'sentinel'), 'preserved directory');
 for(const filePath of [folder,path.join(out,'missing','child.hwp'),path.join(out,'invalid\0.hwp'),{bad:true}]){
  selected={canceled:false,filePath};await assert.rejects(save('hwp'));
  await exact(protectedFile,bytes['old.hwp']);assert.equal(await fs.readFile(path.join(folder,'sentinel'),'utf8'),'preserved directory');
  assert.deepEqual(await listTemps(out),[]);
 }add('four-invalid-path-refusals-and-rename-cleanup');
 // Deterministic filesystem fault after a real exclusive temp create/write.
 for(const fault of ['sync','write-and-close']){
  const dir=path.join(out,fault);await fs.mkdir(dir);const file=path.join(dir,'existing.hwp');await fs.writeFile(file,bytes['old.hwp']);
  const faulty=storageWithFaults(storageFile,fault);let error;try{await faulty.atomicWrite(file,bytes['edited.hwp']);}catch(e){error=e;}
  assert(error);await exact(file,bytes['old.hwp']);const temps=await listTemps(dir);
  const primaryCorrect=error.message==='synthetic-'+(fault==='sync'?'sync':'write')+'-EIO';
  const record={fault,error:error.message,code:error.code,originalPreserved:true,temps,counters:faulty.counters()};
  if(!primaryCorrect||temps.length){problems.push({name:'failed-write-cleanup-and-primary-error',...record});}
  if(final){assert(primaryCorrect);assert.deepEqual(temps,[]);}add('fault-'+fault,record);
 }
 const collisionDir=path.join(out,'collision');await fs.mkdir(collisionDir);
 const collisionFile=path.join(collisionDir,'.baram-collision-existing.tmp');await fs.writeFile(collisionFile,'pre-existing synthetic temp');
 await assert.rejects(storageWithFaults(storageFile,'collision').atomicWrite(path.join(collisionDir,'new.hwp'),bytes['edited.hwp']),e=>e.code==='EEXIST');
 const collisionPreserved=sync.existsSync(collisionFile)&&await fs.readFile(collisionFile,'utf8')==='pre-existing synthetic temp';
 if(!collisionPreserved)problems.push({name:'exclusive-create-failure-deletes-unowned-temp'});
 if(final)assert(collisionPreserved);add('exclusive-create-collision',{preexistingTempPreserved:collisionPreserved});
 // Complete an older native chooser after a newer request: reproduce stale overwrite.
 const gate=deferred();let duplicateDialogs=0;const duplicateFile=path.join(out,'duplicate.hwp');
 const duplicate=await bootHost(mainFile,storage,async()=>{duplicateDialogs++;return duplicateDialogs===1?gate.promise:{canceled:false,filePath:duplicateFile};});
 const oldArgs={data:bytes['old.hwp'],format:'hwp',name:'old.hwp'};
 const first=duplicate.save(duplicate.event,oldArgs);
 let duplicateError,secondResult;try{secondResult=await duplicate.save(duplicate.event,{...oldArgs,data:bytes['edited.hwp']});}catch(e){duplicateError=e;}
 gate.resolve({canceled:false,filePath:duplicateFile});await first;
 const firstFinalHash=sha(await fs.readFile(duplicateFile));
 if(!duplicateError)problems.push({name:'concurrent-host-save-stale-overwrite',dialogs:duplicateDialogs,
  newerSaveReportedSuccess:Boolean(secondResult),olderBytesOverwroteNewer:firstFinalHash===sha(bytes['old.hwp'])});
 if(final){assert.match(duplicateError.message,/저장 작업.*진행/);assert.equal(duplicateDialogs,1);}
 // A busy rejection must not poison subsequent valid saves.
 await duplicate.save(duplicate.event,{...oldArgs,data:bytes['edited.hwp']});await exact(duplicateFile,bytes['edited.hwp']);nativeRow(duplicateFile,'edited','hwp');
 add('concurrent-save-and-retry',{secondRejected:Boolean(duplicateError),dialogsAfterRetry:duplicateDialogs});
 selected={canceled:false,filePath:path.join(out,'retry.hwpx')};await save('hwpx');nativeRow(selected.filePath,'edited','hwpx');add('retry-after-cancel-format-path-failures');
 nativeRow(protectedFile,'old','hwp');
 // Actual host UI save function, editor/DOM/preload adapters; no renderer claim.
 const uiGate=deferred();let uiCalls=0;const ui=await uiController(async()=>{uiCalls++;return uiGate.promise;},bytes['edited.hwpx']);
 const pending=ui.get('save').onclick();await Promise.resolve();await Promise.resolve();
 assert.equal(ui.get('save').disabled,true);assert.equal(ui.get('editor').inert,true);await ui.get('save').onclick();assert.equal(uiCalls,1);assert.equal(ui.notified.length,0);
 uiGate.resolve({name:'ui-saved.hwpx',size:bytes['edited.hwpx'].length});await pending;
 assert.deepEqual(ui.notified,['ui-saved.hwpx']);assert.equal(ui.reported.at(-1),false);assert.match(ui.get('status').textContent,/저장 완료/);assert.equal(ui.get('editor').inert,false);add('ui-duplicate-and-success-after-completion');
 const canceled=await uiController(async()=>null,bytes['edited.hwpx']);await canceled.get('save').onclick();assert.equal(canceled.notified.length,0);assert.equal(canceled.reported.at(-1),true);assert.match(canceled.get('status').textContent,/취소/);add('ui-cancel-retains-dirty');
 const failed=await uiController(async()=>{throw Error('synthetic-write-EIO');},bytes['edited.hwpx']);await failed.get('save').onclick();assert.equal(failed.notified.length,0);assert.equal(failed.reported.at(-1),true);assert.equal(failed.get('error-dialog').open,true);assert.match(failed.get('error-text').textContent,/synthetic-write-EIO/);assert.equal(failed.get('editor').inert,false);add('ui-failure-reports-error-and-retains-dirty');
 const changedGate=deferred(),changed=await uiController(async()=>changedGate.promise,bytes['edited.hwpx']);const saving=changed.get('save').onclick();await Promise.resolve();await Promise.resolve();changed.edit();changedGate.resolve({name:'ui-copy.hwpx',size:10});await saving;assert.equal(changed.notified.length,0);assert.equal(changed.reported.at(-1),true);assert.match(changed.get('status').textContent,/추가 편집/);add('ui-edit-during-save-retains-dirty');
 await fs.mkdir(path.join(out,'native'));await fs.writeFile(path.join(out,'native/manifest.json'),JSON.stringify(native,null,2)+'\n');
 const proof={mode,mainSHA256:sha(await fs.readFile(mainFile)),storageSHA256:sha(await fs.readFile(storageFile)),
  actualRegisteredHostIPCHandler:true,actualFilesystem:true,ElectronWindowAndDialogAdapters:true,
  OSDialogsInvoked:0,OSClipboardAccessed:false,userFilesAccessed:false,permissionsChanged:false,
  faultInjection:['sync EIO','write EIO with close EIO','exclusive create collision','native chooser completion order'],
  rendererVerified:false,syntheticDocuments:true,syntheticSeed:seed,syntheticSeedSHA256:seed?sha(await fs.readFile(seed)):null,
  fixtureSHA256:Object.fromEntries(Object.entries(bytes).map(([k,v])=>[k,sha(v)])),
  checks,problems,nativeSavedFiles:native.length,formatValidationScope:'size/type and HWP CFB / HWPX ZIP magic; full parse is checked independently by cached Native oracle'};
 await fs.writeFile(path.join(out,'proof.json'),JSON.stringify(proof,null,2)+'\n');
 console.log(JSON.stringify({mode,checks:checks.length,problems,nativeSavedFiles:native.length}));
 if(final)assert.deepEqual(problems,[]);
}
module.exports={bootHost,storageWithFaults,uiController};
if(require.main===module)main().catch(e=>{console.error(e);process.exitCode=1;});
