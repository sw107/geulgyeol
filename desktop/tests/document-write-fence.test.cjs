const {test}=require('node:test');const assert=require('node:assert/strict');
const {DocumentWriteFence}=require('../../rhwp-studio/src/core/document-write-fence.ts');
class Document {
 #text='original';
 getText(){return this.#text;}
 exportHwp(){return this.#text;}
 insertText(text){this.#text+=text;}
 saveSnapshot(){this.snapshot=this.#text;}
 unknownOperation(){this.#text='changed';}
 findOrCreateFontId(){this.#text='font changed';}
 free(){this.#text='freed';}
}
test('guard preserves instance identity and method receivers; captured writers obey later lock',()=>{
 const fence=new DocumentWriteFence(),doc=fence.guard(new Document()),write=doc.insertText.bind(doc);
 assert(doc instanceof Document);assert.equal(doc.insertText,doc.insertText);write(' before');
 const before=doc.exportHwp();fence.lock();assert.throws(()=>write(' late'),/닫는 중/);assert.equal(doc.getText(),before);assert.equal(doc.exportHwp(),before);
 fence.unlock();write(' resumed');assert.equal(doc.getText(),before+' resumed');
});
test('locked guard refuses unknown operations, snapshot changes, release and property writes',()=>{
 const fence=new DocumentWriteFence(),doc=fence.guard(new Document());fence.lock();
 for(const operation of [()=>doc.unknownOperation(),()=>doc.findOrCreateFontId(),()=>doc.saveSnapshot(),()=>doc.free(),()=>{doc.snapshot='changed';}])assert.throws(operation,/닫는 중/);
 assert.equal(doc.getText(),'original');assert.equal(doc.snapshot,undefined);
});
