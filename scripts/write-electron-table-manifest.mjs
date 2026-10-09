// Write exact JSON records once; optionally preserve them as verified gzip evidence.
import fs from 'node:fs';import path from 'node:path';import {createHash} from 'node:crypto';
import {Readable} from 'node:stream';import {pipeline} from 'node:stream/promises';import {createGzip,createGunzip} from 'node:zlib';import assert from 'node:assert/strict';
export async function writeTableManifest(q,records,gzip=false){
 const file=path.join(q,gzip?'manifest.json.gz':'manifest.json'),rawHash=createHash('sha256');let rawBytes=0;
 function* chunks(){const values=(function*(){yield '[';for(const[i,row]of records.entries())yield(i?',':'')+JSON.stringify(row);yield ']';})();for(const value of values){const data=Buffer.from(value);rawHash.update(data);rawBytes+=data.length;yield data;}}
 const output=fs.createWriteStream(file,{flags:'wx'});if(gzip)await pipeline(Readable.from(chunks()),createGzip({level:6}),output);else await pipeline(Readable.from(chunks()),output);
 const fd=fs.openSync(file,'r');try{fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
 const expected=rawHash.digest('hex'),storedHash=createHash('sha256');for await(const chunk of fs.createReadStream(file))storedHash.update(chunk);
 const restoredHash=createHash('sha256');let restoredBytes=0;const read=fs.createReadStream(file);const stream=gzip?read.pipe(createGunzip()):read;
 for await(const chunk of stream){restoredHash.update(chunk);restoredBytes+=chunk.length;}
 assert.equal(restoredBytes,rawBytes);assert.equal(restoredHash.digest('hex'),expected,'disk manifest restores exact JSON bytes');
 return {file:path.basename(file),compression:gzip?'gzip':'none',uncompressedBytes:rawBytes,uncompressedSHA256:expected,fileBytes:fs.statSync(file).size,fileSHA256:storedHash.digest('hex'),diskReadBackVerified:true};
}
