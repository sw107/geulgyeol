const fs=require('node:fs');const path=require('node:path');const vm=require('node:vm');
const {stripTypeScriptTypes}=require('node:module');
function fixture(text='문서 준비 완료'){
 const active=new Set();
 class Observer {
  constructor(callback){this.callback=callback;this.records=[];}
  observe(element){this.element=element;element.observers.add(this);active.add(this);}
  takeRecords(){const records=this.records;this.records=[];return records;}
  disconnect(){this.element?.observers.delete(this);active.delete(this);this.records=[];}
 }
 function element(initial){return {observers:new Set(),value:initial,get textContent(){return this.value;},set textContent(value){this.value=value;for(const o of this.observers){o.records.push({type:'childList'});queueMicrotask(()=>{const records=o.takeRecords();if(records.length)o.callback(records);});}}};}
 const exports={};const source=fs.readFileSync(path.resolve(__dirname,'../../../rhwp-studio/src/command/print-status.ts'),'utf8');
 vm.runInNewContext(stripTypeScriptTypes(source,{mode:'transform'}).replace('export class PrintStatus','exports.PrintStatus = class PrintStatus'),{exports,MutationObserver:Observer,WeakMap});
 return {PrintStatus:exports.PrintStatus,element:element(text),makeElement:element,active};
}

module.exports={fixture};
