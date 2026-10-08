// Dedicated official Electron QA bootstrap. Runtime files must match the current source.
// Native chooser results are controlled; transport and filesystem remain real.
const { app, BrowserWindow, dialog, ipcMain } = require(process.env.GEULGYEOL_ELECTRON_MODULE);
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const q = process.env.GEULGYEOL_QA_DIR;
if (!q || !fs.existsSync(path.join(q,'runtime','main.cjs'))) throw new Error('Dedicated GEULGYEOL_QA_DIR runtime required');
app.setPath('appData', path.join(q, 'app-data'));
const audit = (kind, data = {}) => fs.appendFileSync(path.join(q, 'audit.jsonl'), JSON.stringify({kind, at:Date.now(), ...data})+'\n');
const control = () => JSON.parse(fs.readFileSync(path.join(q, 'control.json'), 'utf8'));
const sleep = ms => new Promise(r => setTimeout(r, ms));
// This suite uses public programmatic edits. Keep its visible window from
// taking the user's keyboard while they work in another app.
BrowserWindow.prototype.show = function () { this.showInactive(); audit('qa-show-inactive',{id:this.id}); };
let dialogCount = 0, saveCount = 0, closePlan, crashPlan;
dialog.showSaveDialog = async (win, options) => {
  const c = control(), id = ++dialogCount;
  audit('save-dialog-enter', {id, plan:c.id, options, visible:win.isVisible(), rendererURL:win.webContents.getURL()});
  if (c.gate) {
    const until = Date.now()+20000;
    while (!fs.existsSync(path.join(q, c.gate))) {
      if (Date.now()>until) throw new Error('QA dialog gate timeout');
      await sleep(20);
    }
  }
  if (c.rejectDialog) throw new Error('QA controlled native chooser rejection');
  const result = c.canceled ? {canceled:true} : {canceled:false,filePath:path.join(q,'files',c.file)};
  audit('save-dialog-result',{id,plan:c.id,result});
  return result;
};
dialog.showOpenDialog = async (win, options) => {
  const c=control();if(c.openGate){while(!fs.existsSync(path.join(q,c.openGate)))await sleep(20);}audit('open-dialog',{plan:c.id,options,visible:win.isVisible()});
  return c.openFile?{canceled:false,filePaths:[path.join(q,'files',c.openFile)]}:{canceled:true,filePaths:[]};
};
dialog.showMessageBox = async (_win, options) => {
  const c=control();audit('close-confirmation',{options,plan:c.id});if(c.closeGate){while(!fs.existsSync(path.join(q,c.closeGate)))await sleep(20);}
  const choice=(options.buttons.includes('종료')?c.unavailableChoice:undefined)||c.choice||((c.quit||c.allowDiscard)?'discard':'cancel');
  const pattern=choice==='save'?/^저장$/:choice==='discard'?/저장.*않|저장 안/:choice==='exit'?/^종료$/:/취소|편집 계속/;
  const response=options.buttons.findIndex(b=>pattern.test(b));return {response:response<0?options.cancelId:response};
};
dialog.showErrorBox = (title, message) => audit('host-error',{title,message});
const originalHandle = ipcMain.handle.bind(ipcMain);
ipcMain.handle = (channel, handler) => originalHandle(channel, async (event, ...args) => {
  if (channel !== 'baram:save') return handler(event, ...args);
  const id=++saveCount, data=Buffer.from(args[0].data);
  fs.writeFileSync(path.join(q,'files','ipc-payload-'+id+'.'+args[0].format),data);
  audit('save-ipc-enter',{id,format:args[0].format,name:args[0].name,bytes:data.length,sha256:crypto.createHash('sha256').update(data).digest('hex'),mainFrame:event.senderFrame===event.sender.mainFrame,frameURL:event.senderFrame.url});
  try {const result=await handler(event,...args);audit('save-ipc-result',{id,result});return result;}
  catch(e){audit('save-ipc-rejected',{id,error:String(e)});throw e;}
});
ipcMain.on('baram:dirty',(_event,dirty)=>audit('dirty-ipc',{dirty}));
app.on('browser-window-created', (_e,win)=>{
  win.setFocusable(false);
  const exec=win.webContents.executeJavaScript.bind(win.webContents);
  win.webContents.executeJavaScript=async(code,...args)=>{
    audit('renderer-evaluate',{code});
    const result=await exec(code,...args), gate=control().finalGate;
    if(code==='window.baramPrepareClose()'&&result===true&&gate){
      audit('close-approved',{result,lock:await exec("({busy:document.querySelector('#save').disabled,inert:document.querySelector('#editor').inert})")});
      const deadline=Date.now()+20000;
      while(!fs.existsSync(path.join(q,gate))){if(Date.now()>deadline)throw new Error('QA final close gate timeout');await sleep(20);}
    }
    if(code==='window.baramFinalizeClose()'&&result===true){
      const c=control();audit('finalize-approved',{plan:c.id});
      if(c.rejectFinalize)throw new Error('QA controlled finalize reply failure after successful renderer execution');
      if(c.afterFinalizeGate){const deadline=Date.now()+20000;while(!fs.existsSync(path.join(q,c.afterFinalizeGate))){if(Date.now()>deadline)throw new Error('QA final reply gate timeout');await sleep(20);}}
    }
    return result;
  };
  win.webContents.on('render-process-gone',(_event,details)=>audit('renderer-gone',{details}));
  audit('window-created',{id:win.id});
  win.webContents.on('did-finish-load',()=>audit('window-loaded',{id:win.id,url:win.webContents.getURL(),preload:win.webContents.getLastWebPreferences().preload,sandbox:win.webContents.getLastWebPreferences().sandbox,contextIsolation:win.webContents.getLastWebPreferences().contextIsolation,nodeIntegration:win.webContents.getLastWebPreferences().nodeIntegration}));
});
const interval=setInterval(()=>{
  try {const c=control();if(c.crashRenderer&&crashPlan!==c.id){crashPlan=c.id;for(const w of BrowserWindow.getAllWindows())w.webContents.forcefullyCrashRenderer();}if(c.close&&closePlan!==c.id){closePlan=c.id;for(const w of BrowserWindow.getAllWindows()){w.close();if(c.duplicateClose)w.close();}}if(c.quit){for(const w of BrowserWindow.getAllWindows())w.close();}}
  catch(e){audit('control-error',{error:String(e)});}
},100);
app.on('will-quit',()=>{clearInterval(interval);audit('will-quit');});
audit('bootstrap',{executable:process.execPath,electron:process.versions.electron,appData:app.getPath('appData'),clipboardAccessed:false,realNativeChooser:false});
require('./runtime/main.cjs');
