const fs=require('node:fs/promises');
const path=require('node:path');
const crypto=require('node:crypto');
const MAX_BYTES=64*1024*1024;
function validateDocumentBytes(data,format) {
  if(!(data instanceof Uint8Array)||data.byteLength===0||data.byteLength>MAX_BYTES)throw new Error('문서는 64 MB 이하여야 합니다.');
  const bytes=Buffer.from(data);
  if(format==='hwp') {
    if(!bytes.subarray(0,8).equals(Buffer.from('d0cf11e0a1b11ae1','hex')))throw new Error('올바른 HWP 저장 데이터가 아닙니다.');
  } else if(format==='hwpx') {
    if(!bytes.subarray(0,4).equals(Buffer.from('504b0304','hex')))throw new Error('올바른 HWPX 저장 데이터가 아닙니다.');
  } else throw new Error('HWP 또는 HWPX 형식을 선택하세요.');
  return bytes;
}
async function atomicWrite(destination,data) {
  const temp=path.join(path.dirname(destination),`.baram-${crypto.randomUUID()}.tmp`);
  let handle;
  try {handle=await fs.open(temp,'wx',0o600);await handle.writeFile(data);await handle.sync();await handle.close();handle=null;await fs.rename(temp,destination);}
  finally {if(handle)await handle.close();await fs.unlink(temp).catch(()=>{});}
}
module.exports={validateDocumentBytes,atomicWrite,MAX_BYTES};
