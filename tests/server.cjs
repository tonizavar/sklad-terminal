const http=require('node:http'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..');
let deployment='reset';
http.createServer((req,res)=>{
 const name=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
 if(name==='/__test_deployment' && req.method==='POST'){
  let body='';req.setEncoding('utf8');req.on('data',chunk=>{body+=chunk;if(body.length>80)req.destroy();});
  req.on('end',()=>{if(!/^[a-z0-9-]{1,60}$/.test(body))return res.writeHead(400).end();deployment=body;res.writeHead(204).end();});
  return;
 }
 const file=path.resolve(root,'.'+(name==='/'?'/index.html':name));
 if(!file.startsWith(root+path.sep)) {res.writeHead(403).end();return;}
 fs.readFile(file,(error,body)=>{
  if(error){res.writeHead(404).end();return;}
  if(deployment!=='reset'){
   if(name==='/sw.js')body=body.toString().replace(/(const CACHE = '[^']+)(')/,`$1-${deployment}$2`);
   if(name==='/'||name==='/index.html')body=body.toString().replace('<html ',`<html data-test-deployment="${deployment}" `);
  }
  res.setHeader('Cache-Control','no-store');
  res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html');res.end(body);
 });
}).listen(Number(process.env.PLAYWRIGHT_PORT||4173),'127.0.0.1');
