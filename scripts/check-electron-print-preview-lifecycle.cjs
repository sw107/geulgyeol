// Actual Electron API regression; isolated synthetic windows, no OS print call.
const {app,BrowserWindow}=require('electron');
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const [modulePath,phase,mode]=process.argv.slice(2);
assert(modulePath&&phase&&/^(baseline|fixed)(?:-[a-z]+)?$/.test(mode));
const root=process.env.GEULGYEOL_QA_SOURCE_ROOT||path.resolve(__dirname,'..');
const budgetRoot=process.env.GEULGYEOL_QA_BUDGET_ROOT;assert(budgetRoot,'whole-run evidence budget root required');
const traceFile=path.join(phase,mode+'-trace.jsonl');
assert(!fs.existsSync(traceFile),'fresh trace required, including interrupted runs');
const trace=event=>fs.appendFileSync(traceFile,JSON.stringify({event})+'\n');
app.on('window-all-closed',()=>trace('window-all-closed'));
app.on('before-quit',()=>trace('before-quit'));
const output=path.join(phase,mode+'.json');assert(!fs.existsSync(output),'fresh proof required');
app.setPath('userData',path.join(phase,'profile'));app.setName('Geulgyeol print lifecycle QA');
const owned=new Set(),children=[],blocked=[],shown=[];let server,owner,error,origin,before,after,replacementClosed=false,parentClosed=false,cleanupClosed=false,reopenAfterClose=false,hardenedChildren=false,budget;
const pause=ms=>new Promise(r=>setTimeout(r,ms));
async function until(fn,label,timeout=3000){const end=Date.now()+timeout;while(Date.now()<end){budget?.check();if(await fn())return;await pause(25);}throw Error('Timeout '+label);}
const snapshot=()=>owner.webContents.executeJavaScript('JSON.stringify(document.querySelector("iframe").contentWindow.qaState)');
async function openPreview(){const count=children.length;assert(await owner.webContents.mainFrame.frames.find(frame=>frame.url===origin+'/studio/').executeJavaScript('Boolean(window.open("print.html","_blank"))'));await until(()=>children.length===count+1,'new child');const child=children[count];await until(()=>!child.isDestroyed()&&child.webContents.getURL()===origin+'/studio/print.html'&&!child.webContents.isLoading(),'print loaded');return child;}
app.whenReady().then(async()=>{
 try{
  trace('ready');assert.equal(process.platform,'darwin');const {EvidenceBudget}=await import(path.join(root,'scripts/qa-evidence-budget.mjs'));budget=new EvidenceBudget({root:budgetRoot,phase});budget.started=true;budget.check();
  server=http.createServer((req,res)=>{res.setHeader('Content-Type','text/html; charset=utf-8');res.end(req.url==='/studio/'?'<!doctype html><title>Synthetic Studio</title><script>window.qaState={text:"SYNTHETIC_UNSAVED_OWNER",dirty:true,undo:["synthetic edit"],redo:["synthetic redo"]};</script>':req.url==='/studio/print.html'?'<!doctype html><title>Synthetic readonly print preview</title><p>SYNTHETIC_PRINT_ONLY</p>':'<!doctype html><title>Owned print lifecycle QA</title><iframe src="/studio/"></iframe>');});await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});origin='http://127.0.0.1:'+server.address().port;
  owner=new BrowserWindow({show:false,webPreferences:{nodeIntegration:false,contextIsolation:true,sandbox:true}});owned.add(owner);
  function RecordedWindow(options){const child=new BrowserWindow(options);owned.add(child);children.push(child);child.webContents.on('will-prevent-unload',()=>blocked.push(children.indexOf(child)));child.show=()=>shown.push(children.indexOf(child));return child;}
  require(modulePath).installPrintPreview(owner,origin,RecordedWindow);
  await owner.loadURL(origin+'/');await until(()=>owner.webContents.mainFrame.frames.some(frame=>frame.url===origin+'/studio/'),'Studio frame');before=await snapshot();trace('owner-loaded');
  const first=await openPreview();const prefs=first.webContents.getLastWebPreferences();assert.equal(prefs.nodeIntegration,false);assert.equal(prefs.contextIsolation,true);assert.equal(prefs.sandbox,true);assert(!prefs.preload,'preview has no host preload');hardenedChildren=true;await first.webContents.executeJavaScript('window.onbeforeunload=()=>false;true');
  const second=await openPreview();after=await snapshot();assert.equal(after,before,'owner synthetic state retained');
  await until(()=>first.isDestroyed(),'previous print child closed');replacementClosed=true;trace('replacement-closed');
  assert.equal(replacementClosed,true,'replacing print preview must close an old child that prevents unload');assert.equal(children.filter(w=>!w.isDestroyed()).length,1,'one owned preview remains');
  await second.webContents.executeJavaScript('window.onbeforeunload=()=>false;true');second.close();await until(()=>second.isDestroyed(),'explicit preview close');const third=await openPreview();reopenAfterClose=true;assert.equal(await snapshot(),before,'owner state retained after reopen');await third.webContents.executeJavaScript('window.onbeforeunload=()=>false;true');owner.close();await until(()=>owner.isDestroyed()&&third.isDestroyed(),'parent and child closed');parentClosed=true;
 }catch(e){error=String(e);process.exitCode=1;trace('failure-'+error);}
 finally{
  // Only synthetic windows created by this invocation. Remove its injected
  // beforeunload handler and close normally; do not enumerate or kill apps.
  for(const child of children){if(child.isDestroyed())continue;try{await child.webContents.executeJavaScript('window.onbeforeunload=null;true');child.close();}catch(e){error??=String(e);process.exitCode=1;}}
  if(owner&&!owner.isDestroyed())owner.close();
  try{await until(()=>[...owned].every(w=>w.isDestroyed()),'owned cleanup',3000);cleanupClosed=true;trace('cleanup-closed');}catch(e){error??=String(e);process.exitCode=1;}
  if(server)await new Promise(resolve=>server.close(resolve));
  fs.writeFileSync(output,JSON.stringify({mode,electron:process.versions.electron,platform:process.platform,moduleSHA256:crypto.createHash('sha256').update(fs.readFileSync(modulePath)).digest('hex'),syntheticOnly:true,actualBrowserWindowAPIs:true,physicalPrintInvoked:false,windowsShown:false,childrenCreated:children.length,willPreventUnload:blocked,showRequestsSuppressed:shown,replacementClosed,parentClosed,reopenAfterClose,hardenedChildren,ownerStatePreserved:before===after,cleanupClosed,error},null,2)+'\n',{flag:'wx'});
  console.log(JSON.stringify({mode,replacementClosed,parentClosed,reopenAfterClose,hardenedChildren,cleanupClosed,error}));
  // app.quit is normal cleanup; Electron may still exit 0 after a caught assertion.
  // The caller must inspect proof.error and the lifecycle fields, not exit 0 alone.
  app.quit();
 }
}).catch(e=>{console.error(e);process.exitCode=1;app.quit();});
