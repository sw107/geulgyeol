// At most one task awaits completion; stale or overlapping callbacks do no work.
function startSerialPoll(task,{onError,delayMs=200,schedule=setTimeout,cancel=clearTimeout}={}) {
 let stopped=false,running=false,timer,generation=0;
 function arm(){const token=++generation;timer=schedule(()=>tick(token),delayMs);}
 async function tick(token){
  if(stopped||running||token!==generation)return;
  timer=undefined;running=true;
  try{await task(()=>stopped);}
  catch(error){
   stopped=true;
   try{await onError(error);}catch(reportError){console.error('QA polling error handler failed',reportError);}
  }finally{running=false;if(!stopped)arm();}
 }
 arm();
 return {stop(){stopped=true;++generation;if(timer!==undefined){cancel(timer);timer=undefined;}}};
}
module.exports={startSerialPoll};
