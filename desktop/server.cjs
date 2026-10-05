const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const MIME = {'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8',
  '.mjs':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.wasm':'application/wasm',
  '.json':'application/json','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg',
  '.woff2':'font/woff2','.woff':'font/woff','.ttf':'font/ttf','.ico':'image/x-icon'};

async function startServer(root, port=0) {
  root=await fs.realpath(root);
  const server=http.createServer(async(req,res)=>{
    const host=`127.0.0.1:${server.address().port}`;
    res.setHeader('X-Content-Type-Options','nosniff');
    res.setHeader('Referrer-Policy','no-referrer');
    res.setHeader('Cache-Control','no-store');
    res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; worker-src 'self' blob:; frame-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'self'");
    if(req.headers.host!==host){res.writeHead(403);return res.end('Forbidden host');}
    if(!['GET','HEAD'].includes(req.method)){res.writeHead(405);return res.end();}
    try {
      const raw=decodeURIComponent((req.url||'/').split('?')[0]);
      if(raw.includes('\0')||raw.includes('\\')||raw.split('/').includes('..')){res.writeHead(403);return res.end();}
      let file=path.resolve(root,'.'+raw);
      const inside=(p)=>p===root||p.startsWith(root+path.sep);
      if(!inside(file)){res.writeHead(403);return res.end();}
      file=await fs.realpath(file);
      if(!inside(file)){res.writeHead(403);return res.end();}
      if((await fs.stat(file)).isDirectory())file=await fs.realpath(path.join(file,'index.html'));
      if(!inside(file)){res.writeHead(403);return res.end();}
      const data=await fs.readFile(file);
      res.setHeader('Content-Type',MIME[path.extname(file)]||'application/octet-stream');
      res.setHeader('Content-Length',data.length);res.writeHead(200);res.end(req.method==='HEAD'?undefined:data);
    } catch(error) {res.writeHead(error instanceof URIError?400:404);res.end();}
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});
  return {server,origin:`http://127.0.0.1:${server.address().port}`};
}
module.exports={startServer};
if(require.main===module)startServer(path.join(__dirname,'web'),Number(process.argv[2]||43127)).then(({origin})=>console.log(origin));
