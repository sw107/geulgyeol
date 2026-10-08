// Current source UI + current WASM in an isolated, headed Mac Chrome profile.
// Selection setup uses DEV Cursor helpers; dialog clicks/keys use CDP.
// No physical input, OS clipboard/dialogs, installed app, or user documents.
import puppeteer from '../rhwp-studio/node_modules/puppeteer-core/lib/puppeteer/puppeteer-core.js';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
const [engineArg, qaArg] = process.argv.slice(2);
const root = path.resolve(import.meta.dirname, '..'), engine = path.resolve(engineArg), q = path.resolve(qaArg);
const sha = b => crypto.createHash('sha256').update(b).digest('hex');
const write = (name, data) => fs.writeFileSync(path.join(output, name), JSON.stringify(data, null, 2) + '\n');
const pause = ms => new Promise(r => setTimeout(r, ms));
const port = 32168, url = 'http://127.0.0.1:' + port + '/studio/';
const sourceHead = execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();
assert.equal(process.platform, 'darwin', 'Mac Chrome validation');
const output = path.join(q, 'run-' + Date.now()); fs.mkdirSync(output);
const M = await import(pathToFileURL(path.join(engine, 'rhwp.js')));
M.initSync({ module: fs.readFileSync(path.join(engine, 'rhwp_bg.wasm')) });
const fixtures = [];
const borders = {
  borderLeft: { type: 1, width: 4, color: '#123456' },
  borderRight: { type: 2, width: 2, color: '#654321' },
  borderTop: { type: 1, width: 3, color: '#345678' },
  borderBottom: { type: 1, width: 5, color: '#876543' },
  diagonalLine: 1, diagonalSlash: 7, diagonalBackSlash: 0,
  diagonalWidth: 2, diagonalColor: '#553311', centerLine: 'none',
};
for (const kind of ['cell', 'table', 'shape']) for (const state of ['transparent', 'none', 'white']) {
  const d = M.HwpDocument.createEmpty(); let c;
  try {
    d.insertText(0, 0, 0, '채우기 검증🙂 다른 서식과 책갈피 보존');
    d.addBookmark(0, 0, 1, '보존-'+kind+'-'+state);
    d.applyCharFormat(0, 0, 0, 3, '{"bold":true,"textColor":"#234567"}');
    d.setPageBorderFill(0, JSON.stringify({ fillType:'solid', fillColor:'#d0e8ff', patternType:-1, fillArea:'paper' }));
    d.insertParagraph(0, 0);
    if (kind === 'shape') {
      c = JSON.parse(d.createShapeControl(JSON.stringify({ sectionIdx:0, paraIdx:0, charOffset:0, width:7200, height:7200, treatAsChar:true, shapeType:'rectangle' })));
      d.setShapeProperties(0,c.paraIdx,c.controlIdx,JSON.stringify({
        fillType:'solid',fillBgColor:state==='transparent'?-1:0xffffff,fillPatColor:0x999999,fillPatType:-1,
        borderColor:0x563412,borderWidth:100,lineType:1,
      }));
      if (state==='none') d.setShapeProperties(0,c.paraIdx,c.controlIdx,'{"fillType":"none"}');
    } else {
      c = JSON.parse(d.createTableEx(JSON.stringify({sectionIdx:0,paraIdx:0,charOffset:0,rowCount:1,colCount:2,treatAsChar:true,colWidths:[14400,14400],rowHeights:[3600]})));
      d.insertTextInCell(0,c.paraIdx,c.controlIdx,0,0,0,'대상 셀🙂');
      d.insertTextInCell(0,c.paraIdx,c.controlIdx,1,0,0,'옆 셀 보존');
      d.setTableProperties(0,c.paraIdx,c.controlIdx,JSON.stringify({
        paddingLeft:0,paddingRight:0,paddingTop:0,paddingBottom:0,outerLeft:0,outerRight:0,outerTop:0,outerBottom:0,
      }));
      const brush = { ...borders, ...(state==='transparent'?{borderFillId:2}:{
        fillType:state==='white'?'solid':'none',fillColor:'#ffffff',patternColor:'#999999',patternType:0,
      }) };
      if (kind==='table') d.setTableProperties(0,c.paraIdx,c.controlIdx,JSON.stringify(brush));
      else {
        d.setCellProperties(0,c.paraIdx,c.controlIdx,0,JSON.stringify(brush));
        d.setCellProperties(0,c.paraIdx,c.controlIdx,1,JSON.stringify({...borders,fillType:'solid',fillColor:'#c8e6c9',patternType:0}));
      }
    }
    const file=path.join(output,kind+'-'+state+'-seed.hwp');
    const bytes=d.exportHwp();fs.writeFileSync(file,bytes);
    // HWP adds section definition control at the first paragraph. Resolve the
    // seed's real imported control index rather than reuse its creation index.
    const opened=new M.HwpDocument(bytes);
    try{
      const target=JSON.parse(opened.getControls()).find(x=>x.list===0&&x.ctrlId===(kind==='shape'?'gso':'tbl'));
      assert(target);c={paraIdx:target.para,controlIdx:target.controlIndex};
    }finally{opened.free();}
    fixtures.push({kind,state,file,context:c});
  } finally { d.free(); }
}
let server, browser, page, phase='launch', pairs=0, reopens=0;
let normalBrowserClose=false, normalServerClose=false;
const rows=[], manifest=[], errors=[], wasmResponses=[], sourceResponses=[], savedGetterDifferences=[];
const settle = () => page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
const queryState = ({kind,context:c,raw=false}) => {
  const w=window.__wasm,d=w.doc;
  const target=JSON.parse(d.getControls()).find(x=>x.list===0&&x.ctrlId===(kind==='shape'?'gso':'tbl'));
  if(!target)throw Error('synthetic target missing');
  c={paraIdx:target.para,controlIdx:target.controlIndex};
  const strip = o => {
    o={...o}; delete o.borderFillId;
    if(!raw){
      if(o.patternType<=0)o.patternType=0;
      // Read-only aggregate getter: HWPX parser stores dimensions in common,
      // while this getter reads ctrl_width/height. Exact SVG + each cell size
      // remain required; raw differences are retained per saved file below.
      delete o.tableWidth;delete o.tableHeight;
    }
    return o;
  };
  return {
    object:kind==='shape'?w.getShapeProperties(0,c.paraIdx,c.controlIdx):{
      table:strip(w.getTableProperties(0,c.paraIdx,c.controlIdx)),
      cells:[0,1].map(i=>strip(w.getCellProperties(0,c.paraIdx,c.controlIdx,i))),
    },
    text:d.getTextFileText(),styles:JSON.parse(d.getStyleList()),
    books:w.getBookmarks().map(({ctrlIdx,...b})=>b),
    bodyPara:w.getParaPropertiesAt(0,1),
    bodyChars:Array.from({length:3},(_,i)=>w.getCharPropertiesAt(0,1,i)),
    svg:Array.from({length:w.pageCount},(_,p)=>w.renderPageSvg(p)),
  };
};
const state = f => page.evaluate(queryState, f);
const fill = (s,f) => f.kind==='shape'?s.object:f.kind==='table'?s.object.table:s.object.cells[0];
const withoutFill = (s,f) => {
  s=structuredClone(s); delete s.svg;
  const remove = o => { for(const k of Object.keys(o))if(k.startsWith('fill')||k==='patternColor'||k==='patternType')delete o[k]; };
  if(f.kind==='shape')remove(s.object);
  else { if(f.kind==='table'){remove(s.object.table);s.object.cells.forEach(remove);}else remove(s.object.cells[0]); }
  return s;
};
async function load(file) {
  await page.evaluate(()=>window.rhwpStudio.notifySaved());
  await (await page.$('#file-input')).uploadFile(file);
  await page.waitForFunction(n=>window.__wasm.fileName===n&&window.__inputHandler?.active&&!document.documentElement.classList.contains('rhwp-busy'),{timeout:30000},path.basename(file));
  await settle();
}
async function select(f) {
  await page.evaluate(({kind,context:c})=>{
    const h=window.__inputHandler,x=h.cursor;
    const target=JSON.parse(window.__wasm.doc.getControls()).find(x=>x.list===0&&x.ctrlId===(kind==='shape'?'gso':'tbl'));
    if(!target)throw Error('synthetic target missing');
    c={paraIdx:target.para,controlIdx:target.controlIndex};
    x.exitCellSelectionMode();x.exitCellMode?.();x.exitPictureObjectSelection?.();x.clearSelection();
    if(kind==='shape')h.selectPictureObject(0,c.paraIdx,c.controlIdx,'shape');
    else if(kind==='table'){x.enterTableObjectSelectionDirect(0,c.paraIdx,c.controlIdx);h.renderTableObjectSelection();}
    else x.moveTo({sectionIndex:0,paragraphIndex:0,charOffset:0,parentParaIndex:c.paraIdx,controlIndex:c.controlIdx,cellIndex:0,cellParaIndex:0});
    h.updateCaret();h.focus();
  },f);
}
async function textClick(selector,text) {
  const handles=await page.$$(selector);
  for(const e of handles)if((await e.evaluate(e=>e.textContent.trim()))===text){await e.click();return;}
  throw Error('missing button '+selector+' '+text);
}
const dialog = f => f.kind==='shape'?'.pp-dialog':f.kind==='table'?'.tcp-dialog':'.tcp-border-bg-dialog';
async function open(f) {
  await select(f);
  const id=f.kind==='shape'?'insert:picture-props':f.kind==='table'?'table:cell-props':'table:border-each';
  assert.deepEqual(await page.evaluate(id=>window.__inputHandler.dispatcher.dispatchWithResult(id),id),{ok:true});
  await page.waitForSelector(dialog(f),{visible:true});
  await textClick(dialog(f)+' .dialog-tab',f.kind==='shape'?'채우기':'배경');
  await settle();
}
const radioGroup = f => dialog(f)+' input[type=radio][name="'+(f.kind==='shape'?'pp-fill-type':f.kind==='table'?'bgFill':'cellBgFill')+'"]';
async function displayed(f,expected) {
  const actual=await page.$$eval(radioGroup(f),es=>es.findIndex(e=>e.checked));
  assert.equal(actual,expected==='solid'?1:0,f.kind+' '+f.state+' displayed fill');
}
async function choose(f,stage) {
  const radios=await page.$$(radioGroup(f)); await radios[stage==='none'?0:1].click();
  if(stage!=='none') {
    const color=stage==='white'?'#ffffff':'#e08020';
    const selector=f.kind==='shape'?'.pp-fill-sub input[type=color]':'.dialog-tab-panel input[type=color]';
    // Only visible panel/first face picker; input event uses the real dialog listener.
    await page.$$eval(dialog(f)+' '+selector,(es,color)=>{
      const e=es.find(e=>e.getClientRects().length>0);if(!e)throw Error('visible face picker missing');
      e.value=color;e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));
    },color);
  }
}
async function close(f,confirm) {
  if(confirm)await page.click(dialog(f)+' .dialog-btn-primary');
  else await textClick(dialog(f)+' .dialog-btn','취소');
  await page.waitForSelector(dialog(f),{hidden:true}); await settle();
}
async function key(redo=false) {
  await page.evaluate(()=>window.__inputHandler.focus());
  await page.keyboard.down('Meta');if(redo)await page.keyboard.down('Shift');
  try{await page.keyboard.press('z');}finally{if(redo)await page.keyboard.up('Shift');await page.keyboard.up('Meta');}
  await settle();
}
async function saveReopen(f,label,expected) {
  const files=[];
  for(const ext of ['hwp','hwpx']){
    const bytes=await page.evaluate(ext=>Array.from(window.baramHost.export(ext)),ext);
    const file=path.join(output,f.kind+'-'+f.state+'-'+label+'.'+ext);
    fs.writeFileSync(file,Buffer.from(bytes));files.push(file);
  }
  const rawBefore=await state({...f,raw:true});
  for(const file of files){
    await load(file);const raw=await state({...f,raw:true});
    fs.writeFileSync(file+'.observed.json',JSON.stringify({raw,expected,rawBefore},null,2));
    assert.deepEqual(await state(f),expected,path.basename(file)+' properties/text/bookmarks/exact SVG');
    if(f.kind!=='shape'){
      for(const key of ['tableWidth','tableHeight'])
        if(raw.object.table[key]!==rawBefore.object.table[key])savedGetterDifferences.push({file,key,before:rawBefore.object.table[key],after:raw.object.table[key],geometryAndCellSizeExact:true});
      for(let i=0;i<2;i++)if(raw.object.cells[i].patternType!==rawBefore.object.cells[i].patternType)
        savedGetterDifferences.push({file,key:'cell'+i+'.patternType',before:rawBefore.object.cells[i].patternType,after:raw.object.cells[i].patternType,noPatternEquivalent:true});
    }
    const p=fill(raw,f);
    const v=f.kind==='shape'?{fillType:p.fillType,...(p.fillType==='solid'?{fillBgColor:p.fillBgColor,fillPatColor:p.fillPatColor,fillPatType:p.fillPatType}:{})}:
      {fillType:p.fillType,fillColor:p.fillColor,patternColor:p.patternColor,patternType:p.patternType};
    const context=await page.evaluate(kind=>{
      const t=JSON.parse(window.__wasm.doc.getControls()).find(x=>x.list===0&&x.ctrlId===(kind==='shape'?'gso':'tbl'));
      return {paraIdx:t.para,controlIdx:t.controlIndex};
    },f.kind);
    manifest.push({file,kind:f.kind,state:f.state,stage:label,context,fill:v,svg:raw.svg});reopens++;
  }
  await load(files[0]); // Continue edits in the same format as the HWP seed.
}
try {
  const script=path.join(output,'serve-current.mjs');
  fs.writeFileSync(script, [
    'import {createServer} from '+JSON.stringify(pathToFileURL(path.join(root,'rhwp-studio/node_modules/vite/dist/node/index.js')).href)+';',
    'import config from '+JSON.stringify(pathToFileURL(path.join(root,'rhwp-studio/vite.geulgyeol-beta.config.mjs')).href)+';',
    'const server=await createServer({...config,configFile:false,root:'+JSON.stringify(path.join(root,'rhwp-studio'))+',cacheDir:'+JSON.stringify(path.join(output,'vite-cache'))+',server:{host:"127.0.0.1",port:'+port+',strictPort:true,fs:{allow:'+JSON.stringify([path.dirname(root),fs.realpathSync(path.join(root,'rhwp-studio/node_modules'))])+'}}});',
    'await server.listen();console.log("READY");process.removeAllListeners("SIGTERM");process.on("SIGTERM",async()=>{console.log("NORMAL_CLOSE");await server.close();process.exit(0);});',
  ].join('\n'));
  const log=fs.createWriteStream(path.join(output,'server.log'));let launch='';
  server=spawn(process.execPath,[script],{env:{...process.env,GEULGYEOL_DEV_ENGINE_DIR:engine},stdio:['ignore','pipe','pipe']});
  for(const stream of [server.stdout,server.stderr])stream.on('data',b=>{launch+=b;log.write(b);});
  for(let n=0;n<100&&!launch.includes('READY');n++){assert.equal(server.exitCode,null,'source server stayed up');await pause(100);}
  assert(launch.includes('READY'));
  browser=await puppeteer.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:false,userDataDir:path.join(output,'chrome-profile'),args:['--window-size=1280,900','--no-first-run','--no-default-browser-check','--disable-background-networking'],timeout:30000});
  page=await browser.newPage();await page.setViewport({width:1280,height:860});
  page.on('pageerror',e=>errors.push(String(e)));page.on('dialog',d=>d.dismiss());
  page.on('response',r=>{
    if(r.url().includes('.wasm'))wasmResponses.push(r.buffer().then(b=>({url:r.url(),sha256:sha(b)})));
    if(/\/src\/.*\.ts(?:\?|$)/.test(r.url()))sourceResponses.push(r.url());
  });
  await page.setRequestInterception(true);
  page.on('request',r=>r.url().startsWith('http://127.0.0.1:'+port+'/')||r.url().startsWith('data:')||r.url().startsWith('blob:')?r.continue():r.abort());
  await page.goto(url+'?renderer=canvas2d',{waitUntil:'networkidle0',timeout:45000});
  await page.waitForFunction(()=>window.__inputHandler?.active,{timeout:30000});
  if(await page.$('.dialog-close'))await page.click('.dialog-close');
  for(const f of fixtures){
    const label=f.kind+'-'+f.state;phase=label+' load';
    await load(f.file);
    const initial=await state(f);assert.equal(fill(initial,f).fillType,f.state==='white'?'solid':'none');
    await saveReopen(f,'initial',initial);
    phase=label+' unchanged confirmation';await open(f);await displayed(f,fill(initial,f).fillType);
    assert.deepEqual(await state(f),initial,'open is read only');
    await page.screenshot({path:path.join(output,label+'-dialog.png')});
    await close(f,true);
    assert.deepEqual(await state(f),initial,label+' unchanged confirmation');
    await saveReopen(f,'unchanged',initial);
    phase=label+' edited cancel';await open(f);await choose(f,f.state==='white'?'none':'white');await close(f,false);
    assert.deepEqual(await state(f),initial,label+' canceled draft preserves all properties');
    for(const stage of ['color','white','none']){
      phase=label+' '+stage;await open(f);const before=await state(f);await choose(f,stage);await close(f,true);
      const after=await state(f);
      assert.equal(fill(after,f).fillType,stage==='none'?'none':'solid');
      if(stage==='white'){
        const p=fill(after,f);assert.equal(f.kind==='shape'?p.fillBgColor:p.fillColor,f.kind==='shape'?0xffffff:'#ffffff');
      }
      assert.deepEqual(withoutFill(after,f),withoutFill(initial,f),label+' '+stage+' non-fill attributes preserved');
      assert.notDeepEqual(after.svg,before.svg,label+' '+stage+' actually paints/clears');
      await page.screenshot({path:path.join(output,label+'-'+stage+'-canvas.png')});
      for(let n=0;n<2;n++){await key();assert.deepEqual(await state(f),before,label+' '+stage+' undo');await key(true);assert.deepEqual(await state(f),after,label+' '+stage+' redo');pairs++;}
      await saveReopen(f,stage,after);
    }
    rows.push({label,unchangedConfirm:true,editedCancel:true,dialogDisplayedCorrectFill:true,undoRedoPairs:6,reopens:10});
    console.log('PASS '+label);
  }
  const wasm=await Promise.all(wasmResponses),expectedWasm=sha(fs.readFileSync(path.join(engine,'rhwp_bg.wasm')));
  assert(wasm.some(r=>r.sha256===expectedWasm),'actual current engine response');
  for(const filename of ['picture-props-dialog.ts','picture-props-apply-model.ts','cell-border-bg-dialog.ts','table-cell-props-dialog.ts'])
    assert(sourceResponses.some(u=>u.includes(filename)),'actual current UI module '+filename);
  assert.deepEqual(errors,[]);
  fs.writeFileSync(path.join(output,'manifest.json'),JSON.stringify(manifest,null,2));
  write('proof.json',{output,sourceHead,sourceSHA256:sha(fs.readFileSync(path.join(root,'rhwp-studio/src/ui/picture-props-apply-model.ts'))),sourceURL:page.url(),browserVersion:await browser.version(),headless:false,platform:process.platform,cases:rows.length,rows,undoRedoPairs:pairs,savedFiles:manifest.length,reopens,errors,savedGetterDifferences,wasmResponses:wasm,engineSHA256:expectedWasm,currentSourceModules:sourceResponses,realDOMAndCanvas2D:true,selectionSetupViaDEVHelpers:true,dialogClicksAndKeysViaCDP:true,physicalInputVerified:false,installedAppVerified:false,OSClipboardAccessed:false,OSDialogsInvoked:0,userDocumentsUsed:false});
} catch(e) {
  fs.writeFileSync(path.join(output,'partial-manifest.json'),JSON.stringify(manifest,null,2));
  fs.writeFileSync(path.join(output,'failure.json'),JSON.stringify({phase,error:String(e),stack:e.stack,rows,pairs,reopens,errors},null,2));
  if(page)await page.screenshot({path:path.join(output,'failure.png')}).catch(()=>{});
  throw e;
} finally {
  if(browser){await browser.close();normalBrowserClose=browser.process().exitCode===0;}
  if(server&&server.exitCode===null){server.kill('SIGTERM');for(let n=0;n<100&&server.exitCode===null;n++)await pause(100);}
  normalServerClose=server?.exitCode===0;
  write('lifecycle-'+path.basename(output)+'.json',{normalBrowserClose,browserExit:browser?.process().exitCode,normalServerClose,serverExit:server?.exitCode,browserPid:browser?.process().pid,serverPid:server?.pid,sourcePort:port});
  if(!normalBrowserClose||!normalServerClose)process.exitCode=1;
}
