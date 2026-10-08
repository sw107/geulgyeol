// Launch the actual signed application without modifying its ASAR. Inspector
// injection controls native responses only in this QA process, before main.cjs.
import fs from 'node:fs';
import path from 'node:path';
import {spawn} from 'node:child_process';
import assert from 'node:assert/strict';
const root=path.resolve(import.meta.dirname,'..');
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(fn,label){const end=Date.now()+30000;while(Date.now()<end){if(await fn())return;await pause(25);}throw Error('Timeout '+label);}

export async function launchPackaged(executable,q){
  assert(executable.includes('.app/Contents/MacOS/'),'An actual packaged executable is required');
  let adapter=fs.readFileSync(path.join(root,'scripts/electron-document-lifecycle-bootstrap.cjs'),'utf8');
  adapter=adapter.replace(/if \(!q \|\| !fs.existsSync\(path.join\(q,'runtime','main.cjs'\)\)\) throw[^\n]+\n/,'');
  adapter=adapter.replace("app.setPath('appData', path.join(q, 'app-data'));",'');
  adapter=adapter.replace("require('./runtime/main.cjs');",'');
  const env={...process.env,GEULGYEOL_ELECTRON_MODULE:'electron',GEULGYEOL_QA_DIR:q,
    GEULGYEOL_PROFILE_ROOT:path.join(q,'app-data')};delete env.ELECTRON_RUN_AS_NODE;
  const p=spawn(executable,['--inspect-brk=0','--remote-debugging-port=0','--remote-debugging-address=127.0.0.1'],{env});
  let log='',paused;const launchLog=path.join(q,'launch.log');
  for(const stream of [p.stdout,p.stderr])stream.on('data',data=>{log+=data;fs.appendFileSync(launchLog,data);});
  await until(()=>/Debugger listening on (ws:\/\/\S+)/.test(log),'main inspector');
  const mainEndpoint=log.match(/Debugger listening on (ws:\/\/\S+)/)[1];
  const ws=new WebSocket(mainEndpoint);await new Promise((resolve,reject)=>{ws.onopen=resolve;ws.onerror=reject;});
  let seq=0;const pending=new Map();
  ws.onmessage=event=>{const data=JSON.parse(event.data);if(data.method==='Debugger.paused')paused=data.params;
    if(data.id){const request=pending.get(data.id);pending.delete(data.id);if(data.error)request.reject(Error(JSON.stringify(data.error)));else request.resolve(data.result);}};
  const send=(method,params={})=>new Promise((resolve,reject)=>{const id=++seq;pending.set(id,{resolve,reject});ws.send(JSON.stringify({id,method,params}));});
  try{
    await send('Debugger.enable');
    const breakpoint=await send('Debugger.setBreakpointByUrl',{urlRegex:'app[.]asar/main[.]cjs$',lineNumber:0});
    await send('Runtime.runIfWaitingForDebugger');
    await until(()=>paused,'packaged main pause');
    if(!paused.hitBreakpoints.includes(breakpoint.breakpointId)){
      paused=null;await send('Debugger.resume');await until(()=>paused,'packaged main breakpoint');
    }
    assert(paused.hitBreakpoints.includes(breakpoint.breakpointId));
    const source=await send('Debugger.getScriptSource',{scriptId:paused.callFrames[0].location.scriptId});
    assert.equal(source.scriptSource,fs.readFileSync(path.join(root,'desktop/main.cjs'),'utf8'),'Executing current packaged main.cjs');
    const injected=await send('Debugger.evaluateOnCallFrame',{callFrameId:paused.callFrames[0].callFrameId,
      expression:'(function(){'+adapter+'\n}).call(this);true',returnByValue:true});
    assert(!injected.exceptionDetails,JSON.stringify(injected.exceptionDetails));
    await send('Debugger.removeBreakpoint',{breakpointId:breakpoint.breakpointId});
    await send('Debugger.resume');
  }finally{ws.close();}
  await until(()=>/DevTools listening on (ws:\/\/\S+)/.test(log),'renderer endpoint');
  return {p,endpoint:log.match(/DevTools listening on (ws:\/\/\S+)/)[1],mainEndpoint};
}
