const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('baram',Object.freeze({
  open:()=>ipcRenderer.invoke('baram:open'),
  save:(data,name,format)=>ipcRenderer.invoke('baram:save',{data,name,format}),
  onAction:(callback)=>{const fn=(_event,action)=>callback(action);ipcRenderer.on('baram:action',fn);return()=>ipcRenderer.removeListener('baram:action',fn);},
  setDirty:(dirty)=>ipcRenderer.send('baram:dirty',Boolean(dirty)),
  info:()=>ipcRenderer.invoke('baram:info')
}));
