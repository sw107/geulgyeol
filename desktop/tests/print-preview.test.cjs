const {test}=require('node:test');
const assert=require('node:assert/strict');
const {EventEmitter}=require('node:events');
const {isPrintPreviewRequest,installPrintPreview}=require('../print-preview.cjs');
const origin='http://127.0.0.1:12345',studio=origin+'/studio/?desktopRecovery=1';
const request={url:origin+'/studio/print.html',frameName:'',features:'',disposition:'foreground-tab',referrer:{url:studio}};
test('only exact bundled print surface with a live Studio document is eligible',()=>{
 assert(isPrintPreviewRequest(request,origin,[studio]));
 assert(isPrintPreviewRequest({...request,referrer:{url:'',policy:'no-referrer'}},origin,[studio]));
 assert(!isPrintPreviewRequest({...request,referrer:{url:'',policy:'default'}},origin,[studio]));
 for(const url of [origin+'/',origin+'/studio/',origin+'/studio/print.html?x=1',origin+'/studio/print.html#x','https://example.com/','data:text/html,test','about:blank',origin.replace('12345','12346')+'/studio/print.html'])assert(!isPrintPreviewRequest({...request,url},origin,[studio]),url);
 for(const patch of [{frameName:'named'},{features:'nodeIntegration=yes'},{postBody:{data:[]}},{disposition:'background-tab'},{referrer:{url:origin+'/'}}])assert(!isPrintPreviewRequest({...request,...patch},origin,[studio]));
 assert(!isPrintPreviewRequest(request,origin,[]));
});
class Contents extends EventEmitter {setWindowOpenHandler(fn){this.open=fn;}}
class Window extends EventEmitter {
 constructor(options={}){super();this.options=options;this.webContents=new Contents();this.dead=false;this.shown=false;}
 isDestroyed(){return this.dead;}
 close(){this.dead=true;this.emit('closed');}
 show(){this.shown=true;}
 setMenu(menu){this.menu=menu;}
}
test('single child lifecycle, hardened preferences and navigation fences',()=>{
 const owner=new Window();owner.webContents.mainFrame={frames:[{url:studio}]};owner.webContents.session={};
 installPrintPreview(owner,origin,Window);const opened=owner.webContents.open(request);
 assert.equal(opened.action,'allow');assert.equal(opened.outlivesOpener,false);
 const childContents=opened.createWindow({webContents:new Contents(),webPreferences:{preload:'/host/preload',nodeIntegration:true,sandbox:false}});
 // Find the child using the supplied constructor without relying on product globals.
 assert.equal(childContents.open({url:request.url}).action,'deny');
 for(const eventName of ['will-navigate','will-frame-navigate','will-redirect']){
  let prevented=false;childContents.emit(eventName,{url:origin+'/',preventDefault(){prevented=true;}},origin+'/');assert(prevented);
  prevented=false;childContents.emit(eventName,{url:request.url,preventDefault(){prevented=true;}},request.url);assert(!prevented);
 }
 let children=[];class Recorded extends Window {constructor(options){super(options);children.push(this);}}
 const nextOwner=new Window();nextOwner.webContents.mainFrame=owner.webContents.mainFrame;nextOwner.webContents.session=owner.webContents.session;
 installPrintPreview(nextOwner,origin,Recorded);
 for(let i=0;i<2;i++)nextOwner.webContents.open(request).createWindow({webPreferences:{preload:'/host/preload',nodeIntegration:true,sandbox:false}});
 assert(children[0].dead);assert(!children[1].dead);
 const prefs=children[1].options.webPreferences;assert.equal(prefs.preload,undefined);assert.equal(prefs.nodeIntegration,false);assert.equal(prefs.contextIsolation,true);assert.equal(prefs.sandbox,true);assert.equal(prefs.webSecurity,true);assert.equal(prefs.session,nextOwner.webContents.session);
 assert.equal(children[1].options.parent,nextOwner);assert.equal(children[1].menu,null);children[1].emit('ready-to-show');assert(children[1].shown);
 nextOwner.close();assert(children[1].dead);
});

test('readonly preview unload cannot block replacement or owner cleanup',()=>{
 const owner=new Window();owner.webContents.mainFrame={frames:[{url:studio}]};owner.webContents.session={};
 const children=[];
 class UnloadWindow extends Window {
  constructor(options){super(options);children.push(this);}
  close(){
   let allowed=false;
   this.webContents.emit('will-prevent-unload',{preventDefault(){allowed=true;}});
   if(allowed)super.close();
  }
 }
 installPrintPreview(owner,origin,UnloadWindow);
 owner.webContents.open(request).createWindow({});
 owner.webContents.open(request).createWindow({});
 assert(children[0].dead,'previous readonly snapshot cannot veto replacement');
 assert(!children[1].dead);
 assert.equal(owner.webContents.listenerCount('will-prevent-unload'),0,'editable owner retains its own unload policy');
 children[0].emit('ready-to-show');assert(!children[0].shown,'a closed preview is never shown late');
 owner.close();assert(children[1].dead,'readonly snapshot cannot veto owner cleanup');
});
test('closing a preview allows a fresh hardened preview on the next request',()=>{
 const owner=new Window();owner.webContents.mainFrame={frames:[{url:studio}]};owner.webContents.session={};
 const children=[];class Recorded extends Window {constructor(options){super(options);children.push(this);}}
 installPrintPreview(owner,origin,Recorded);
 owner.webContents.open(request).createWindow({});children[0].close();
 owner.webContents.open(request).createWindow({webPreferences:{preload:'/untrusted',nodeIntegration:true}});
 assert(children[0].dead);assert(!children[1].dead);
 assert.equal(children[1].options.webPreferences.preload,undefined);
 assert.equal(children[1].options.webPreferences.nodeIntegration,false);
 assert.equal(children[1].webContents.open(request).action,'deny');
 owner.close();assert(children[1].dead);
});
