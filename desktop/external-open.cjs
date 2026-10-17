const fs = require('node:fs/promises');
const path = require('node:path');
const {MAX_BYTES} = require('./storage.cjs');

async function readDocumentFile(target) {
  const handle = await fs.open(target, 'r');
  try {
    const stat = await handle.stat();
    if (!stat.isFile()) throw new Error('일반 문서 파일만 열 수 있습니다.');
    if (stat.size > MAX_BYTES) throw new Error('64 MB보다 큰 문서는 지원하지 않습니다.');
    // Bound the actual read too: the file may grow after stat().
    const chunks = []; let size = 0;
    for (;;) {
      const buffer = Buffer.alloc(Math.min(65536, MAX_BYTES + 1 - size));
      const {bytesRead} = await handle.read(buffer, 0, buffer.length, null);
      if (!bytesRead) break;
      size += bytesRead;
      if (size > MAX_BYTES) throw new Error('64 MB보다 큰 문서는 지원하지 않습니다.');
      chunks.push(buffer.subarray(0, bytesRead));
    }
    return {name: path.basename(target), data: new Uint8Array(Buffer.concat(chunks, size))};
  } finally {
    await handle.close();
  }
}

function createExternalOpenQueue(notify, read = readDocumentFile) {
  const pending = []; let reading = false;
  return {
    enqueue(target) {
      if (typeof target !== 'string' || !path.isAbsolute(target) || !/\.(hwp|hwpx)$/i.test(target)) {
        throw new Error('HWP 또는 HWPX 문서 파일을 선택하세요.');
      }
      if (pending.length >= 32) throw new Error('열기 요청이 너무 많습니다. 문서를 확인한 뒤 다시 시도하세요.');
      pending.push(target);
      notify();
    },
    async take() {
      if (reading) throw new Error('문서를 읽고 있습니다. 완료 후 다시 시도하세요.');
      const target = pending.shift();
      if (!target) return null;
      reading = true;
      try { return await read(target); }
      finally { reading = false; }
    },
  };
}
module.exports = {createExternalOpenQueue, readDocumentFile};
