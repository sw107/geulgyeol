const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {stripTypeScriptTypes}=require('node:module');
const root=path.resolve(__dirname,'../..');
const dateCode=stripTypeScriptTypes(fs.readFileSync(path.join(root,'rhwp-studio/src/command/commands/today-date.ts'),'utf8'),{mode:'transform'})
  .replace('export function formatLocalDate','function formatLocalDate').replace('export const todayDateCommand','const todayDateCommand');
const dates=vm.runInNewContext(dateCode+'\n({formatLocalDate,todayDateCommand})');
const source=fs.readFileSync(path.join(root,'rhwp-studio/src/engine/input-handler.ts'),'utf8');
const methods=source.slice(source.indexOf('  canInsertTodayDate():'),source.indexOf('  /** 붙이기 (커맨드 시스템용'));
const subject=vm.runInNewContext(stripTypeScriptTypes('class DateInput {'+methods+'}\nDateInput',{mode:'transform'}),{
  InsertTextCommand:class {constructor(position,text){this.position=position;this.text=text;}execute(wasm){return wasm.insert(this.position,this.text);}}
});
function fixture(overrides={}){
  const calls=[];const input=Object.create(subject.prototype);
  const position={sectionIndex:0,paragraphIndex:2,charOffset:3};
  const cursor={getPosition:()=>position};
  for(const name of ['hasSelection','isInCell','isInTextBox','isInHeaderFooter','isInFootnote','isInCellSelectionMode','isInPictureObjectSelection','isInTableObjectSelection']) cursor[name]=()=>false;
  Object.assign(input,{cursor,editMode:'normal',isComposing:false,isPictureCaptionEditing:()=>false,isInField:()=>false,
    focus:()=>calls.push('focus'),executeOperation:op=>{calls.push(op);}});
  Object.assign(input,overrides);
  return {input,calls,position};
}
test('date text uses local calendar components including leap day and padded month/day',()=>{
  assert.equal(dates.formatLocalDate(new Date(2024,1,29,23,59)),'2024-02-29');
  assert.equal(dates.formatLocalDate(new Date(2026,0,2,0,1)),'2026-01-02');
  // An explicit offset puts this instant on a different local/UTC day in TZ=Pacific/Kiritimati.
  const d=new Date('2026-10-26T23:30:00Z');
  const expected=[d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-');
  assert.equal(dates.formatLocalDate(d),expected);
});
test('date insertion is one distinct snapshot at the cursor and restores typing focus',()=>{
  const {input,calls,position}=fixture();input.performInsertDate('2026-10-27');
  assert.equal(calls.length,2);const operation=calls[0];
  assert.equal(operation.kind,'snapshot');assert.equal(operation.operationType,'insertTodayDate');
  const inserted=[];const end={...position,charOffset:13};
  assert.equal(operation.operation({insert:(p,text)=>{inserted.push([p,text]);return end;}}),end);
  assert.deepEqual(inserted,[[position,'2026-10-27']]);assert.equal(calls[1],'focus');
});
test('live state rejects every excluded context before mutation or focus changes',()=>{
  const exclusions=['hasSelection','isInCell','isInTextBox','isInHeaderFooter','isInFootnote','isInCellSelectionMode','isInPictureObjectSelection','isInTableObjectSelection'];
  for(const name of exclusions){const {input,calls}=fixture();input.cursor[name]=()=>true;assert.equal(input.canInsertTodayDate(),false,name);input.performInsertDate('2026-10-27');assert.equal(calls.length,0,name);}
  for(const override of [{editMode:'form'},{isComposing:true},{isPictureCaptionEditing:()=>true},{isInField:()=>true}]){
    const {input,calls}=fixture(override);input.performInsertDate('2026-10-27');assert.equal(calls.length,0);
  }
  for(const patch of [{parentParaIndex:0},{cellPath:[{}]}]){const {input,calls,position}=fixture();Object.assign(position,patch);input.performInsertDate('2026-10-27');assert.equal(calls.length,0);}
});
test('command availability follows writable ordinary body state and calls the input handler',()=>{
  const command=dates.todayDateCommand;const normal={hasDocument:true,isEditable:true,isFormMode:false,canInsertTodayDate:true};
  assert.equal(command.canExecute(normal),true);
  for(const patch of [{hasDocument:false},{isEditable:false},{isFormMode:true},{canInsertTodayDate:false}])assert.equal(command.canExecute({...normal,...patch}),false);
  const inserted=[];command.execute({getInputHandler:()=>({performInsertDate:text=>inserted.push(text)})});
  assert.equal(inserted.length,1);assert.match(inserted[0],/^\d{4}-\d{2}-\d{2}$/);
  command.execute({getInputHandler:()=>null});
  assert(fs.readFileSync(path.join(root,'rhwp-studio/index.html'),'utf8').includes('data-cmd="insert:today-date"'));
});
