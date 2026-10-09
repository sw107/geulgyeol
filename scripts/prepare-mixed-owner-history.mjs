// Select only the verified 48x2 synthetic mixed fixtures; preserve source files.
// Usage: node scripts/prepare-mixed-owner-history.mjs SOURCE_SEEDS_JSON FRESH_QA_DIR
import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';
const [sourceArg,outArg]=process.argv.slice(2);assert(sourceArg&&outArg);const out=path.resolve(outArg);assert(!fs.existsSync(out),'fresh output required');fs.mkdirSync(out,{recursive:true});
const contracts={'mixed-large-left':{cells:50,owners:[2]},'mixed-large-right':{cells:50,owners:[3]},'mixed-staggered':{cells:34,owners:[2,18]}};
const selected=JSON.parse(fs.readFileSync(sourceArg)).filter(s=>Object.hasOwn(contracts,s.label));assert.equal(selected.length,3,'all three verified synthetic variants required');assert.equal(new Set(selected.map(s=>s.label)).size,3);
const seeds=selected.map(s=>({...s,fragmentTail:true,operations:[...s.operations,...[...contracts[s.label].owners,contracts[s.label].cells-1].map(cell=>'owner-'+cell+'-fragment-tail')],snapshotEligibleOwners:Array.from({length:contracts[s.label].cells-2},(_,i)=>i+2)}));
for(const seed of seeds.slice())for(const cell of contracts[seed.label].owners){
 const label=seed.label+'-history-owner-'+cell,files={};for(const[ext,file]of Object.entries(seed.files)){files[ext]=path.join(out,label+'.'+ext);fs.linkSync(file,files[ext]);}
 seeds.push({...seed,label,files,historyCell:cell,historyGaps:true,mixedAppendLastCell:true,operations:[...[0,1,2].flatMap(i=>['shift-enter-'+i,'direct-delete-'+i]),'tab-navigation','tab-last-row','mixed-text-history','mixed-burst-history']});
}
fs.writeFileSync(path.join(out,'seeds.json'),JSON.stringify(seeds,null,2)+'\n');console.log(JSON.stringify({groups:seeds.length,cases:seeds.reduce((n,s)=>n+2*s.operations.length,0)}));
