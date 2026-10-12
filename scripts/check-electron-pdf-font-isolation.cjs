const {app,BrowserWindow}=require('electron');
const {startSerialPoll}=require('./electron-qa-serial-poll.cjs');
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const phase=process.env.GEULGYEOL_PRINT_ISOLATION_DIR;
assert(phase&&fs.existsSync(path.join(phase,'controls.html')));
const sha=x=>crypto.createHash('sha256').update(x).digest('hex');
const write=(name,obj)=>fs.writeFileSync(path.join(phase,name),JSON.stringify(obj,null,2),{flag:'wx'});
fs.mkdirSync(path.join(phase,'app-data'));app.setPath('appData',path.join(phase,'app-data'));app.setPath('userData',path.join(phase,'app-data/profile'));
app.setName('Geulgyeol Synthetic Print QA');
app.commandLine.appendSwitch('disk-cache-size','1048576');
let win,monitor,error,ready=false,before;
app.on('window-all-closed',()=>app.quit());
app.on('will-quit',()=>{monitor?.stop();write('will-quit.json',{normalQuitRequested:true,error:error||null,ready,at:Date.now()});});
function fail(e){
 if(error!==undefined)return;error=String(e);
 try{write('failure.json',{error,stack:e.stack});}catch(recordError){console.error('QA failure record could not be written',recordError);}
 console.error(e);app.quit();
}
app.whenReady().then(async()=>{
 win=new BrowserWindow({width:900,height:1050,title:'Geulgyeol Synthetic Print Isolation',webPreferences:{contextIsolation:true,nodeIntegration:false,sandbox:true}});
 win.webContents.on('console-message',(_e,_level,message)=>{if(message==='[native-isolation-print-entered]'&&!fs.existsSync(path.join(phase,'native-called.json')))write('native-called.json',{entered:true});});
 win.webContents.on('render-process-gone',(_e,details)=>write('renderer-gone.json',details));
 await win.loadFile(path.join(phase,'controls.html'));
 const deadline=Date.now()+20000;
 while(!await win.webContents.executeJavaScript('Boolean(window.syntheticIsolation?.ready)')){if(Date.now()>deadline)throw Error('readiness timeout');await new Promise(r=>setTimeout(r,100));}
 before=await win.webContents.executeJavaScript('JSON.stringify(window.syntheticIsolation)');
 write('renderer-before.json',JSON.parse(before));
 const options={printBackground:true,preferCSSPageSize:true};
 const pdf=await win.webContents.printToPDF(options);assert(pdf.subarray(0,5).toString()==='%PDF-');
 fs.writeFileSync(path.join(phase,'printToPDF-controls.pdf'),pdf,{flag:'wx'});
 assert.equal(await win.webContents.executeJavaScript('JSON.stringify(window.syntheticIsolation)'),before);
 write('printToPDF-proof.json',{route:'Electron webContents.printToPDF',options,sha256:sha(pdf),bytes:pdf.length,versions:process.versions,rendererControlStatePreserved:true});
 await win.webContents.executeJavaScript(`(()=>{const original=window.print;window.print=function(...args){console.info('[native-isolation-print-entered]');return original.apply(this,args);};})()`);
 ready=true;write('ready.json',{ready:true,title:win.getTitle(),url:win.webContents.getURL(),OSOutput:'os-native-controls.pdf',versions:process.versions});console.log('READY PRINT CONTROLS: actual OS PDF requires native CUA observer');
 monitor=startSerialPoll(async isStopped=>{
  if(fs.existsSync(path.join(phase,'os-saved.json'))&&!fs.existsSync(path.join(phase,'os-proof.json'))){
   const receipt=JSON.parse(fs.readFileSync(path.join(phase,'os-saved.json')));assert(receipt.nativeDialogObserved&&receipt.PDFSaveMenuInvoked&&receipt.OSSavePanelObserved&&receipt.SaveButtonInvoked&&receipt.noPrinterOutput);
   const bytes=fs.readFileSync(path.join(phase,'os-native-controls.pdf'));assert(bytes.subarray(0,5).toString()==='%PDF-');assert(fs.existsSync(path.join(phase,'native-called.json')));assert.equal(await win.webContents.executeJavaScript('JSON.stringify(window.syntheticIsolation)'),before);
   if(isStopped())return;
   write('os-proof.json',{route:'actual macOS print panel PDF save',sha256:sha(bytes),bytes:bytes.length,rendererControlStatePreserved:true});console.log('OS PDF SAVED AND STATE PRESERVED');
  }
  if(fs.existsSync(path.join(phase,'quit.json'))){monitor.stop();app.quit();}
 },{onError:fail});
}).catch(fail);
