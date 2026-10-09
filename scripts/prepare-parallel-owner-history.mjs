// Select verified synthetic parallel owners and preserve distinct QA evidence names.
// Usage: node scripts/prepare-parallel-owner-history.mjs PARALLEL_SEEDS_JSON FRESH_QA_DIR
import fs from 'node:fs';import path from 'node:path';import assert from 'node:assert/strict';
const [src,outArg]=process.argv.slice(2);assert(src&&outArg,'source seeds and fresh QA directory required');const out=path.resolve(outArg);assert(!fs.existsSync(out),'fresh output required');fs.mkdirSync(out,{recursive:true});
const source=JSON.parse(fs.readFileSync(src)),selected=source.filter(s=>['parallel-large','parallel-unequal','parallel-short'].includes(s.label));assert.equal(selected.length,3,'all three verified parallel variants required');const seeds=[...selected];
for(const seed of selected.filter(s=>s.snapshotEligibleOwners?.length))for(const cell of seed.snapshotEligibleOwners){
 const label=seed.label+'-owner-'+cell,files={};for(const [ext,file]of Object.entries(seed.files)){files[ext]=path.join(out,label+'.'+ext);fs.linkSync(file,files[ext]);}
 seeds.push({...seed,label,files,historyCell:cell,historyGaps:true,mixedAppendLastCell:true,operations:[...[0,1,2].flatMap(i=>['shift-enter-'+i,'direct-delete-'+i]),'tab-navigation','tab-last-row','mixed-text-history','mixed-burst-history']});
}
fs.writeFileSync(path.join(out,'seeds.json'),JSON.stringify(seeds,null,2)+'\n');console.log(JSON.stringify({groups:seeds.length,cases:seeds.reduce((n,s)=>n+2*s.operations.length,0)}));
