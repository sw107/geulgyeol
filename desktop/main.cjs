const {app,BrowserWindow,dialog,ipcMain,Menu,session}=require('electron');
const path=require('node:path');
app.setPath('userData',path.join(process.env?.GEULGYEOL_PROFILE_ROOT||app.getPath('appData'),'GeulgyeolBeta3'));
const {startProfileServer}=require('./profile-server.cjs');
const {validateDocumentBytes,atomicWrite}=require('./storage.cjs');
const {installCloseController}=require('./close-controller.cjs');
const {installDocumentShortcuts}=require('./document-shortcuts.cjs');
const {installPrintPreview}=require('./print-preview.cjs');
const {createExternalOpenQueue,readDocumentFile}=require('./external-open.cjs');
let win,origin,server,dirty=false,saving=false,rendererFailed=false;
function trusted(event){return win&&!win.isDestroyed()&&event.sender===win.webContents&&event.senderFrame===win.webContents.mainFrame&&event.senderFrame.url===origin+'/';}
function action(name){if(win&&!win.isDestroyed())win.webContents.send('baram:action',name);}
const externalOpen=createExternalOpenQueue(()=>action('open-external'));
if(!app.requestSingleInstanceLock()){app.quit();}else{
// macOS can send this before app.whenReady() or before the editor initializes.
app.on('open-file',(event,target)=>{
  event.preventDefault();
  try{externalOpen.enqueue(target);}
  catch(error){dialog.showErrorBox('문서 열기 실패',String(error.message||error));}
});
app.on('second-instance',()=>{if(win){if(win.isMinimized())win.restore();win.show();win.focus();}});
app.whenReady().then(async()=>{
  ({server,origin}=await startProfileServer(path.join(__dirname,'web'),app.getPath('userData')));
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
  win=new BrowserWindow({width:1280,height:860,minWidth:900,minHeight:620,title:'글결 베타 0.4.4-beta.3',show:false,
    webPreferences:{preload:path.join(__dirname,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true}});
  installDocumentShortcuts(win.webContents,action);
  installPrintPreview(win,origin,BrowserWindow);
  win.webContents.on('will-navigate',(e,url)=>{if(url!==origin+'/')e.preventDefault();});
  win.webContents.on('render-process-gone',()=>{rendererFailed=true;});
  async function confirmUnavailableClose(){
    const result=await dialog.showMessageBox(win,{type:'warning',buttons:['취소','종료'],defaultId:0,cancelId:0,
      message:'편집 상태를 확인할 수 없어 저장을 완료할 수 없습니다.',detail:'종료하면 저장하지 않은 변경 사항이 사라질 수 있습니다. 복구본은 이미 정리됐을 수 있습니다.'});
    if(result.response!==1&&!rendererFailed){
      try{await win.webContents.executeJavaScript('window.baramCancelClose?.()');}
      catch(error){dialog.showErrorBox('편집 재개 실패',String(error.message||error));}
    }
    return result.response===1;
  }
  installCloseController(win,{
    beforeClose:async()=>{
      if(rendererFailed)return confirmUnavailableClose();
      try{
        const approved=await win.webContents.executeJavaScript('window.baramPrepareClose()');
        if(approved==='startup-failed')return confirmUnavailableClose();
        if(approved!==true)return false;
        return await win.webContents.executeJavaScript('window.baramFinalizeClose()');
      }catch{return confirmUnavailableClose();}
    },
    onError:error=>dialog.showErrorBox('종료 확인 실패',String(error.message||error))
  });
  const menu=[
    ...(process.platform==='darwin'?[{label:'글결',submenu:[{role:'about'},{type:'separator'},{role:'quit'}]}]:[]),
    {label:'파일',submenu:[{label:'열기…',accelerator:'CmdOrCtrl+O',click:()=>action('open')},{label:'다른 이름으로 저장…',accelerator:'CmdOrCtrl+Shift+S',click:()=>action('save')},{type:'separator'},{role:'close'}]},
    {label:'편집',submenu:[{label:'실행 취소',accelerator:'CmdOrCtrl+Z',click:()=>action('undo')},{label:'다시 실행',accelerator:'CmdOrCtrl+Shift+Z',click:()=>action('redo')},{type:'separator'},{role:'cut'},{role:'copy'},{role:'paste'},
      {id:'document-select-all',label:'모두 선택',accelerator:'CmdOrCtrl+A',click:(_item,focusedWindow)=>{
        if(focusedWindow&&focusedWindow!==win){if(!focusedWindow.isDestroyed())focusedWindow.webContents.selectAll();return;}
        action('select-all');
      }}]},
    {label:'보기',submenu:[{role:'togglefullscreen'}]},
    {label:'도움말',submenu:[{label:'버전과 라이선스',click:()=>action('about')}]}
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(menu));
  app.setAboutPanelOptions({applicationName:'글결 문서 편집기',applicationVersion:app.getVersion(),copyright:'문서 엔진: RHWP © Edward Kim · MIT License'});
  ipcMain.handle('baram:info',event=>{if(!trusted(event))throw new Error('허용되지 않은 요청');return {version:app.getVersion(),platform:process.platform};});
  ipcMain.handle('baram:take-open-file',event=>{if(!trusted(event))throw new Error('허용되지 않은 요청');return externalOpen.take();});
  ipcMain.on('baram:dirty',(event,value)=>{if(trusted(event)){dirty=Boolean(value);win.setDocumentEdited(dirty);}});
  ipcMain.handle('baram:confirm-unsaved',async(event,action)=>{
    if(!trusted(event)||!['new','open','close'].includes(action))throw new Error('허용되지 않은 요청');
    const result=await dialog.showMessageBox(win,{type:'question',buttons:['저장','저장하지 않기','취소'],defaultId:0,cancelId:2,
      message:'저장하지 않은 변경 사항이 있습니다.',detail:'계속하기 전에 현재 문서를 저장할까요?'});
    return ['save','discard','cancel'][result.response]||'cancel';
  });
  ipcMain.handle('baram:open',async event=>{
    if(!trusted(event))throw new Error('허용되지 않은 요청');
    const chosen=await dialog.showOpenDialog(win,{properties:['openFile'],filters:[{name:'한글 문서',extensions:['hwp','hwpx']}]});
    if(chosen.canceled)return null;
    return readDocumentFile(chosen.filePaths[0]);
  });
  ipcMain.handle('baram:save',async(event,{data,name,format})=>{
    if(!trusted(event))throw new Error('허용되지 않은 요청');
    if(saving)throw new Error('저장 작업이 진행 중입니다. 완료 후 다시 시도하세요.');
    saving=true;
    try{
      const bytes=validateDocumentBytes(data,format);
      const base=path.basename(typeof name==='string'?name:'문서').replace(/\.(hwpx|hwp)$/i,'');
      const selected=await dialog.showSaveDialog(win,{defaultPath:base+'-편집.'+format,filters:[{name:format.toUpperCase(),extensions:[format]}]});
      if(selected.canceled||!selected.filePath)return null;
      if(path.extname(selected.filePath).toLowerCase()!=='.'+format)throw new Error('선택한 형식과 확장자가 일치하지 않습니다.');
      await atomicWrite(selected.filePath,bytes);return {name:path.basename(selected.filePath),size:bytes.length};
    }finally{saving=false;}
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
