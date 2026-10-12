import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';
import {installNativePrintObserver} from '../native-print-observer.mjs';
const install=(context,key)=>vm.runInNewContext('('+installNativePrintObserver.toString()+')('+JSON.stringify(key)+')',context);
test('serialized observer forwards the real print context, arguments and result',()=>{
 const calls=[],messages=[];const context={window:{print:function(...args){calls.push({owner:this,args});return 42;}},console:{info:m=>messages.push(m)}};
 install(context,'hwp-1');assert.equal(context.window.print('arg'),42);assert.equal(calls.length,1);assert.equal(calls[0].owner,context.window);assert.deepEqual(calls[0].args,['arg']);assert.deepEqual(messages,['[qa-native-print-called] hwp-1']);
});
test('retry replaces the observer while calling original print exactly once',()=>{
 let calls=0;const messages=[];const context={window:{print:()=>{calls++;}},console:{info:m=>messages.push(m)}};
 install(context,'hwpx-1');context.window.print();install(context,'hwpx-2');context.window.print();assert.equal(calls,2);assert.deepEqual(messages,['[qa-native-print-called] hwpx-1','[qa-native-print-called] hwpx-2']);
});
test('original print failure is propagated',()=>{
 const failure=new Error('synthetic print failure');const context={window:{print:()=>{throw failure;}},console:{info:()=>{}}};install(context,'hwp-1');assert.throws(()=>context.window.print(),e=>e===failure);
});
