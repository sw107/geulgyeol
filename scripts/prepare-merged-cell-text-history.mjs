// Select the verified synthetic whole-span source and add real keyboard history QA.
// Usage: node scripts/prepare-merged-cell-text-history.mjs STORED_SEEDS_JSON FRESH_OUTPUT_JSON
import fs from 'node:fs';import assert from 'node:assert/strict';
const [source,out]=process.argv.slice(2);assert(source&&out,'source seeds and fresh output required');assert(!fs.existsSync(out),'fresh output required');
const seed=JSON.parse(fs.readFileSync(source)).find(s=>s.label==='partial-long-rowspan');assert(seed,'verified synthetic whole-span source required');
seed.historyGaps=true;seed.operations=[...[0,1,2].flatMap(i=>['shift-enter-'+i,'direct-delete-'+i]),'tab-navigation','tab-last-row','mixed-text-history','mixed-burst-history'];
fs.writeFileSync(out,JSON.stringify([seed],null,2)+'\n');console.log('Prepared 20 HWP/HWPX real-keyboard cases');
