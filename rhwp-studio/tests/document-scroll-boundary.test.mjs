// Production viewport scheduling, virtual page map and CanvasView boundary methods.
// RAF, DOM and paint are adapters; actual wheel/host verification is separate.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {stripTypeScriptTypes} from 'node:module';
import {test} from 'node:test';
const repo=path.resolve(import.meta.dirname,'../..'),read=n=>fs.readFileSync(repo+'/rhwp-studio/src/'+n,'utf8');
const strip=s=>stripTypeScriptTypes(s,{mode:'transform'}).replace(/^import[\s\S]*?;\s*$/gm,'');
const load=s=>import('data:text/javascript;base64,'+Buffer.from(s).toString('base64'));
const arrangement=await load(strip(read('view/page-arrangement.ts'))),anchor=await load(strip(read('view/zoom-anchor.ts'))),gap=await load(strip(read('view/page-gap.ts')));
globalThis.__scrollBoundary={arrangement,anchor,gap};
const movement=await load('const {normalizePageArrangement}=globalThis.__scrollBoundary.arrangement;\n'+strip(read('view/page-movement.ts')));globalThis.__scrollBoundary.movement=movement;
const {ViewportManager}=await load('const {CENTER_ZOOM_ANCHOR,normalizeZoomAnchor}=globalThis.__scrollBoundary.anchor;const {MIN_DOCUMENT_ZOOM,MAX_DOCUMENT_ZOOM}=globalThis.__scrollBoundary.arrangement;const {DEFAULT_PAGE_MOVEMENT,normalizePageMovementSettings}=globalThis.__scrollBoundary.movement;\n'+strip(read('view/viewport-manager.ts')));
const {VirtualScroll}=await load('const {DEFAULT_PAGE_ARRANGEMENT,normalizePageArrangement}=globalThis.__scrollBoundary.arrangement;const {resolvePageGap}=globalThis.__scrollBoundary.gap;\n'+strip(read('view/virtual-scroll.ts')));
function method(s,n){let a=s.indexOf('  '+n+'(');if(a<0)a=s.indexOf('  private '+n+'(');const z=s.indexOf('\n  }\n',a);assert(a>=0&&z>a,n);return s.slice(a,z+4);}
const source=read('view/canvas-view.ts');
const {BoundaryView}=await load(strip('export class BoundaryView {\n'+['updateVisiblePages','reset'].map(n=>method(source,n)).join('\n')+'\n}'));
function fixture(){
 let sequence=0;const scheduled=new Map(),cancelled=[],events=[],paint=[];
 globalThis.requestAnimationFrame=fn=>{const id=++sequence;scheduled.set(id,fn);return id;};
 globalThis.cancelAnimationFrame=id=>{cancelled.push(id);scheduled.delete(id);};globalThis.window={removeEventListener(){}};
 const viewport=new ViewportManager({emit:(...a)=>{events.push(a);if(a[0]==='viewport-scroll')view.updateVisiblePages();}});
 const container={scrollTop:0,scrollLeft:0,removeEventListener(){}};viewport.container=container;viewport.viewportWidth=800;viewport.viewportHeight=600;
 const virtual=new VirtualScroll(),view=new BoundaryView();
 const info=[{width:600,height:900},{width:600,height:900}];virtual.setPageDimensions(info,1,800,{kind:'single'},'vertical',600);
 const undo=[{name:'pending undo'}],redo=[{name:'pending redo'}],model={text:'보존🙂',dirty:true};
 Object.assign(view,{disposed:false,pages:info,virtualScroll:virtual,viewportManager:viewport,canvasPool:{activePages:[],has:()=>false},pendingPrefetchPages:new Set(),pageRenderer:{cancelAll(){},setPageMarginGuideEdges(){}},scrollContent:{replaceChildren(){}},
  cancelPendingTextEditRefresh(){},cancelTextEditStaticLayerVerification(){},cancelPendingPrefetch(){},releaseAllRenderedPages(){},renderHeaderFooterEditOverlays(){},updateActivePageSnapshot(){},schedulePrefetchPages(){},eventBus:{emit(){}},
  renderPage(p){paint.push(p);assert(view.pages[p],`old virtual page ${p} reached paint`);}});
 const frame=()=>scheduled.entries().next().value;
 const fire=()=>{const [id,fn]=frame();scheduled.delete(id);fn(0);};
 return {viewport,view,container,virtual,scheduled,cancelled,events,paint,undo,redo,model,frame,fire};
}
test('scroll updates coalesce to the latest current-document coordinates',()=>{
 const f=fixture();f.container.scrollTop=100;f.viewport.onScroll();f.container.scrollTop=250;f.container.scrollLeft=30;f.viewport.onScroll();assert.equal(f.scheduled.size,1);f.fire();assert.deepEqual(f.events,[['viewport-scroll',250,30]]);assert(f.paint.length>0);
});
test('document reset cancels its pending viewport frame without touching model or history',()=>{
 const f=fixture(),before=structuredClone({undo:f.undo,redo:f.redo,model:f.model});f.viewport.onScroll();const [id,old]=f.frame();f.view.reset();assert(f.cancelled.includes(id));assert.equal(f.scheduled.size,0);old(0);assert.deepEqual(f.events,[]);assert.deepEqual({undo:f.undo,redo:f.redo,model:f.model},before);
});
test('a late old callback cannot consume or emit a newly scheduled document scroll',()=>{
 const f=fixture();f.viewport.onScroll();const old=f.frame()[1];f.viewport.cancelPendingScrollUpdate();f.container.scrollTop=350;f.viewport.onScroll();const current=f.frame();old(0);assert.equal(f.scheduled.size,1);assert.equal(f.viewport.scrollAnimationFrame,current[0]);assert.deepEqual(f.events,[]);f.fire();assert.deepEqual(f.events,[['viewport-scroll',350,0]]);
});
test('scroll arriving while page information is empty never reads the old virtual map',()=>{
 const f=fixture();f.view.pages=[];f.container.scrollTop=950;f.viewport.onScroll();f.fire();assert.deepEqual(f.paint,[]);
});
test('disposed views ignore a remaining viewport notification',()=>{
 const f=fixture();f.view.disposed=true;f.viewport.onScroll();f.fire();assert.deepEqual(f.paint,[]);
});
test('detach invalidates an already queued callback even if it is delivered late',()=>{
 const f=fixture();f.viewport.onScroll();const old=f.frame()[1];f.viewport.detach();old(0);assert.deepEqual(f.events,[]);assert.equal(f.scheduled.size,0);
});
test('repeated blank/open boundaries resume scrolling only with the new page map',()=>{
 const f=fixture();for(let i=0;i<5;i++){f.viewport.onScroll();const old=f.frame()[1];f.view.reset();old(0);f.container.scrollTop=950;f.viewport.onScroll();f.fire();assert.deepEqual(f.paint,[]);f.view.pages=[{width:600,height:900}];f.virtual.setPageDimensions(f.view.pages,1,800,{kind:'single'},'vertical',600);f.container.scrollTop=0;f.viewport.onScroll();f.fire();assert.deepEqual(f.paint,[0]);f.paint.length=0;}assert.equal(f.undo.length,1);assert.equal(f.redo.length,1);assert.equal(f.model.text,'보존🙂');
});
