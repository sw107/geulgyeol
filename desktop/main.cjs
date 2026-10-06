const {app,BrowserWindow,dialog,ipcMain,Menu,session}=require('electron');
const path=require('node:path');
const fs=require('node:fs/promises');
app.setPath('userData',path.join(app.getPath('appData'),'GeulgyeolDevPropagation'));
const {startServer}=require('./server.cjs');
const {validateDocumentBytes,atomicWrite,MAX_BYTES}=require('./storage.cjs');
const {installCloseController}=require('./close-controller.cjs');
const {installDocumentShortcuts}=require('./document-shortcuts.cjs');
let win,origin,server,dirty=false;
function trusted(event){return win&&!win.isDestroyed()&&event.sender===win.webContents&&event.senderFrame===win.webContents.mainFrame&&event.senderFrame.url===origin+'/';}
function action(name){if(win&&!win.isDestroyed())win.webContents.send('baram:action',name);}
if(!app.requestSingleInstanceLock()){app.quit();}else{
app.on('second-instance',()=>{if(win){if(win.isMinimized())win.restore();win.show();win.focus();}});
app.whenReady().then(async()=>{
  ({server,origin}=await startServer(path.join(__dirname,'web'),0));
  // No document is exposed by the asset server. Block all remote resources.
  session.defaultSession.webRequest.onBeforeRequest((details,callback)=>{
    const allowed=details.url.startsWith(origin+'/')||details.url.startsWith('blob:'+origin+'/')||details.url.startsWith('data:')||details.url==='about:blank';
    callback({cancel:!allowed});
  });
  const allowFonts=(wc,permission,url)=>{
    if(!win||win.isDestroyed()||wc!==win.webContents||permission!=='local-fonts')return false;
    try{return new URL(url).origin===origin;}catch{return false;}
  };
  session.defaultSession.setPermissionRequestHandler((wc,permission,callback,details)=>callback(allowFonts(wc,permission,details.requestingUrl)));
  session.defaultSession.setPermissionCheckHandler((wc,permission,requestingOrigin)=>allowFonts(wc,permission,requestingOrigin));
  win=new BrowserWindow({width:1280,height:860,minWidth:900,minHeight:620,title:'글결 개발 후보 0.4.4-dev.4',show:false,
    webPreferences:{preload:path.join(__dirname,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true}});
  installDocumentShortcuts(win.webContents,action);
  win.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  win.webContents.on('will-navigate',(e,url)=>{if(url!==origin+'/')e.preventDefault();});
  installCloseController(win,{
    isDirty:()=>dirty,
    beforeDiscard:()=>win.webContents.executeJavaScript('window.baramPrepareDiscard()'),
    confirmDiscard:async()=>{
      const result=await dialog.showMessageBox(win,{type:'question',buttons:['편집 계속','저장하지 않고 닫기'],defaultId:0,cancelId:0,message:'저장하지 않은 변경 사항이 있습니다.'});
      return result.response===1;
    },
    onError:error=>dialog.showErrorBox('종료 확인 실패',String(error.message||error))
  });
  const menu=[
    ...(process.platform==='darwin'?[{label:'글결',submenu:[{role:'about'},{type:'separator'},{role:'quit'}]}]:[]),
    {label:'파일',submenu:[{label:'열기…',accelerator:'CmdOrCtrl+O',click:()=>action('open')},{label:'다른 이름으로 저장…',accelerator:'CmdOrCtrl+Shift+S',click:()=>action('save')},{type:'separator'},{role:'close'}]},
    {label:'편집',submenu:[{label:'실행 취소',accelerator:'CmdOrCtrl+Z',click:()=>action('undo')},{label:'다시 실행',accelerator:'CmdOrCtrl+Shift+Z',click:()=>action('redo')},{type:'separator'},{role:'cut'},{role:'copy'},{role:'paste'},{role:'selectAll'}]},
    {label:'보기',submenu:[{role:'togglefullscreen'}]},
    {label:'도움말',submenu:[{label:'버전과 라이선스',click:()=>action('about')}]}
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(menu));
  app.setAboutPanelOptions({applicationName:'글결 문서 편집기',applicationVersion:app.getVersion(),copyright:'문서 엔진: RHWP © Edward Kim · MIT License'});
  ipcMain.handle('baram:info',event=>{if(!trusted(event))throw new Error('허용되지 않은 요청');return {version:app.getVersion(),platform:process.platform};});
  ipcMain.on('baram:dirty',(event,value)=>{if(trusted(event)){dirty=Boolean(value);win.setDocumentEdited(dirty);}});
  ipcMain.handle('baram:open',async event=>{
    if(!trusted(event))throw new Error('허용되지 않은 요청');
    const chosen=await dialog.showOpenDialog(win,{properties:['openFile'],filters:[{name:'한글 문서',extensions:['hwp','hwpx']}]});
    if(chosen.canceled)return null;
    const target=chosen.filePaths[0];if((await fs.stat(target)).size>MAX_BYTES)throw new Error('64 MB보다 큰 문서는 지원하지 않습니다.');
    return {name:path.basename(target),data:new Uint8Array(await fs.readFile(target))};
  });
  ipcMain.handle('baram:save',async(event,{data,name,format})=>{
    if(!trusted(event))throw new Error('허용되지 않은 요청');
    const bytes=validateDocumentBytes(data,format);
    const base=path.basename(typeof name==='string'?name:'문서').replace(/\.(hwpx|hwp)$/i,'');
    const selected=await dialog.showSaveDialog(win,{defaultPath:base+'-편집.'+format,filters:[{name:format.toUpperCase(),extensions:[format]}]});
    if(selected.canceled||!selected.filePath)return null;
    if(path.extname(selected.filePath).toLowerCase()!=='.'+format)throw new Error('선택한 형식과 확장자가 일치하지 않습니다.');
    await atomicWrite(selected.filePath,bytes);return {name:path.basename(selected.filePath),size:bytes.length};
  });
  session.defaultSession.on('will-download',(_event,item)=>{
    // Studio's built-in export uses Chromium's native save dialog.
    item.setSaveDialogOptions({title:'문서 내보내기',defaultPath:item.getFilename()});
  });
  await win.loadURL(origin+'/');win.show();
}).catch(error=>{dialog.showErrorBox('글결 실행 실패',String(error.message||error));app.quit();});
app.on('window-all-closed',()=>app.quit());
app.on('will-quit',()=>{server?.close();});
}
