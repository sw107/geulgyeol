// Real WASM and current SnapshotCommand; no GUI/physical IME claim.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {stripTypeScriptTypes} from 'node:module';
const [pkg,manifest,out,mode]=process.argv.slice(2), observe=mode==='--observe';
fs.mkdirSync(out,{recursive:true});
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const bytes=fs.readFileSync(path.join(pkg,'rhwp_bg.wasm'));
const {initSync,HwpDocument}=await import(pathToFileURL(path.resolve(pkg,'rhwp.js')));
initSync({module:bytes});
const source=fs.readFileSync('rhwp-studio/src/engine/command.ts','utf8');
const js=stripTypeScriptTypes('const MAX_PAGE_LOCAL_TEXT_EDIT_CHARS=10000;\n'+source,{mode:'transform'}).replace(/^import[\s\S]*?;\s*$/gm,'');
const {SnapshotCommand}=await import('data:text/javascript;base64,'+Buffer.from(js).toString('base64'));
const parsed=JSON.parse,rows=[],fixtureNormalization=[];
const model=d=>{
    const controls=parsed(d.getControls());
    return {paragraphs:Array.from({length:d.getParagraphCount(0)},(_,p)=>{
        const text=d.getTextRange(0,p,0,10000);
        return {text,para:parsed(d.getParaPropertiesAt(0,p)),chars:[...text].map((_,i)=>parsed(d.getCharPropertiesAt(0,p,i)))};
    }),fields:parsed(d.getFieldList()).map(f=>({...f,props:parsed(d.getClickHereProps(f.fieldId))})),controls,
    notes:controls.filter(c=>c.list===0&&c.ctrlId==='fn').map(c=>{
        const info=parsed(d.getFootnoteInfo(0,c.para,c.controlIndex));
        return {control:c,info,paragraphs:info.texts.map((text,p)=>({text,para:parsed(d.getParaPropertiesInFootnote(0,c.para,c.controlIndex,p)),chars:[...text].map((_,i)=>parsed(d.getCharPropertiesInFootnote(0,c.para,c.controlIndex,p,i)))}))};
    })};
};
function exports(d,label) {
    return Object.fromEntries(['Hwp','Hwpx'].map(format=>{
        const e=d['export'+format+'WithReport']();
        try {
            const b=e.takeBytes(),report=parsed(e.contentLoss());
            const file=path.join(out,label+'.'+format.toLowerCase());fs.writeFileSync(file,b);
            return [format,{file,sha256:sha(b),report}];
        } finally {e.free();}
    }));
}
const inputs=JSON.parse(fs.readFileSync(manifest));
for (const [i,c] of inputs.entries()) {
    let d=new HwpDocument(fs.readFileSync(c.file));
    try {
        if (c.kind==='supported') {
            // Canonicalize the already-known blank BorderFill default difference
            // before any value mutation; never filter the actual mutation comparisons.
            const original=model(d),seed=d.exportHwpx();d.free();d=new HwpDocument(seed);
            const normalized=model(d),differences=[];
            const diff=(a,b,key)=>{
                if(JSON.stringify(a)===JSON.stringify(b))return;
                if(a&&b&&typeof a==='object'&&typeof b==='object'){
                    assert.deepEqual(Object.keys(a).sort(),Object.keys(b).sort());
                    for(const k of Object.keys(a))diff(a[k],b[k],key+'.'+k);
                }else differences.push({key,before:a,after:b});
            };
            diff(original,normalized,'model');
            assert(differences.every(x=>/\.(fillType|patternColor|patternType)$/.test(x.key)));
            fixtureNormalization.push({input:c.file,differences});
            const w={saveSnapshot:()=>d.saveSnapshot(),restoreSnapshot:n=>parsed(d.restoreSnapshot(n)),discardSnapshot:n=>d.discardSnapshot(n)};
            for (const [j,value] of ['새🙂','','𐐀값'].entries()) {
                if (!observe && c.adjacent && value==='') {
                    const before=model(d);assert.throws(()=>d.setFieldValue(c.id,value));assert.deepEqual(model(d),before);continue;
                }
                const before=model(d),pos={sectionIndex:0,paragraphIndex:0,charOffset:2};
                const command=new SnapshotCommand('fieldValue',pos,pos,()=>{
                    const result=j%2?d.setFieldValueByName('first',value):d.setFieldValue(c.id,value);
                    assert.equal(parsed(result).ok,true);return pos;
                });
                try {
                    command.execute(w);const after=model(d);
                    const neighbor=c.neighbor==null?null:after.fields.find(f=>f.fieldId===c.neighbor);
                    if (!observe&&neighbor) assert.equal(neighbor.value,'','adjacent field remains empty');
                    command.undo(w);if(!observe)assert.deepEqual(model(d),before,'entire public model undo');
                    command.execute(w);if(!observe)assert.deepEqual(model(d),after,'entire public model redo');
                    const saved=exports(d,`supported-${i}-${j}`);
                    for (const e of Object.values(saved)) {
                        assert.equal(e.report.count,0);
                        const reopened=new HwpDocument(fs.readFileSync(e.file));
                        try {if(!observe)assert.deepEqual(model(reopened),after,'supported save/reopen');}finally{reopened.free();}
                    }
                    rows.push({kind:'supported',input:c.file,value,neighborValue:neighbor?.value,saved});
                } finally {command.discard(w);}
            }
        } else {
            for (const byName of [false,true]) {
                const before=model(d),info=d.getDocumentInfo(),events=d.getEventLog();
                const label=`unsupported-${i}-${byName}`,original=exports(d,label+'-before');
                let accepted=false,error;
                try {accepted=parsed(byName?d.setFieldValueByName('first',c.value??'새🙂'):d.setFieldValue(c.id,c.value??'새🙂')).ok;}catch(e){error=String(e);}
                const after=model(d),saved=exports(d,label+'-after');
                if(!observe) {
                    assert.equal(accepted,false,label);assert.match(error,/필드|누름틀/);
                    assert.deepEqual(after,before,label+' full public model');assert.equal(d.getDocumentInfo(),info);assert.equal(d.getEventLog(),events);
                    for(const format of ['Hwp','Hwpx']){
                        assert.equal(saved[format].sha256,original[format].sha256,label+' unchanged exported bytes');
                        assert.deepEqual(saved[format].report,original[format].report);
                    }
                }
                const reopenedModels={};if(c.kind==='boundary-clear'){for(const [format,e] of Object.entries(saved)){const r=new HwpDocument(fs.readFileSync(e.file));try{reopenedModels[format]={same:JSON.stringify(model(r))===JSON.stringify(after),model:model(r)};}finally{r.free();}}}
                rows.push({kind:c.kind,input:c.file,byName,accepted,error,changed:JSON.stringify(before)!==JSON.stringify(after),before,after,original,saved,reopenedModels});
            }
        }
    } finally {d.free();}
}
const proof={observe,wasmSha256:sha(bytes),sourceSha256:sha(source),GUIVerified:false,physicalIMEVerified:false,
    unsupported:rows.filter(r=>r.kind!=='supported').length,supported:rows.filter(r=>r.kind==='supported').length,
    fixtureNormalization,acceptedUnsupported:rows.filter(r=>r.kind!=='supported'&&r.accepted).length,rows};
fs.writeFileSync(path.join(out,'proof.json'),JSON.stringify(proof,null,2)+'\n');
console.log(JSON.stringify({...proof,rows:undefined}));
