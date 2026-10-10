// Persistent private pipe bridge: one Budget instance owns one phase.
import readline from 'node:readline';
import assert from 'node:assert/strict';
import {EvidenceBudget} from './qa-evidence-budget.mjs';
let budget, finished=false;
const input=readline.createInterface({input:process.stdin,crlfDelay:Infinity});
for await(const line of input) {
 try {
  assert(Buffer.byteLength(line)<=16384,'bounded budget request required');
  const r=JSON.parse(line);let result;
  if(r.op==='begin') {
   assert(!budget,'single phase per bridge');
   budget=new EvidenceBudget({root:r.root,phase:r.phase});
   result=budget.begin({normalForecastBytes:r.normalForecastBytes,failureForecastBytes:r.failureForecastBytes});
  } else {
   assert(budget?.started&&!finished,'active owned phase required');
   if(r.op==='check')result=budget.check({normalForecastBytes:r.normalForecastBytes??0,failureForecastBytes:r.failureForecastBytes??0});
   else if(r.op==='complete') {result=budget.check();budget.mark('complete');finished=true;}
   else if(r.op==='failed') {budget.mark('failed');finished=true;result={complete:false};}
   else throw Error('unknown budget operation');
  }
  process.stdout.write(JSON.stringify({ok:true,result})+'\n');
 } catch(e) {process.stdout.write(JSON.stringify({ok:false,error:String(e)})+'\n');}
}
// EOF cannot prove that the coordinator's Native child has stopped writing.
// Preserve running; the shared policy blocks the next phase until resolved.
