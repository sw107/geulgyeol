const fs=require('node:fs/promises');
const path=require('node:path');
const {startServer}=require('./server.cjs');

// IndexedDB is keyed by origin, including the local port. Keep one origin per
// isolated profile across launches so recovery drafts remain accessible.
async function startProfileServer(root,profile){
  const record=path.join(profile,'asset-origin.json');
  let port=0;
  try{
    port=JSON.parse(await fs.readFile(record,'utf8')).port;
    if(!Number.isInteger(port)||port<1024||port>65535)throw new Error('로컬 문서 주소 기록을 읽을 수 없습니다.');
  }catch(error){if(error.code!=='ENOENT')throw error;}
  let asset;
  try{asset=await startServer(root,port);}
  catch(error){
    if(error.code==='EADDRINUSE')throw new Error('문서 복구용 로컬 주소가 사용 중입니다. 다른 글결 창을 닫거나 잠시 후 다시 실행해 주세요.');
    throw error;
  }
  if(!port){
    try{
      await fs.mkdir(profile,{recursive:true});
      await fs.writeFile(record,JSON.stringify({port:asset.server.address().port})+'\n',{flag:'wx'});
    }catch(error){await new Promise(resolve=>asset.server.close(resolve));throw error;}
  }
  return asset;
}
module.exports={startProfileServer};
