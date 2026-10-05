// A single native confirmation owns window closing. Renderer beforeunload must
// not veto a discard that the user already approved.
function installCloseController(win,{isDirty,confirmDiscard,beforeDiscard=async()=>{},onError=()=>{}}){
 let prompting=false;
 win.on('close',event=>{
  event.preventDefault();
  if(prompting)return;
  if(!isDirty()){win.destroy();return;}
  prompting=true;
  Promise.resolve().then(confirmDiscard).then(async discard=>{
   if(discard&&!win.isDestroyed()){
    await beforeDiscard();
    if(!win.isDestroyed())win.destroy();
   }
  }).catch(onError).finally(()=>{prompting=false;});
 });
}
module.exports={installCloseController};
