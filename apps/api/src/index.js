import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve,extname,sep} from 'node:path';
import {createApp} from './app.js';
const origin=process.env.APP_ORIGIN||'http://localhost:5173';
const api=createApp({origin,clientId:process.env.DERIV_CLIENT_ID||'',redirectUri:process.env.DERIV_REDIRECT_URI||origin+'/api/auth/deriv/callback',scopes:process.env.DERIV_SCOPES||'trade'});
const web=resolve('apps/web/dist');
const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.ico':'image/x-icon'};
const secure=new URL(origin).protocol==='https:';
const server=createServer(async(req,res)=>{
 if(req.url.startsWith('/api/'))return api(req,res);
 if(!['GET','HEAD'].includes(req.method)){res.writeHead(405);return res.end();}
 try{
  const path=new URL(req.url,'http://localhost').pathname;
  let file=resolve(web,'.'+path);
  if(file!==web&&!file.startsWith(web+sep)){res.writeHead(403);return res.end();}
  if(path==='/'||!extname(path))file=resolve(web,'index.html');
  const body=await readFile(file);
  const headers={'Content-Type':mime[extname(file)]||'application/octet-stream','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Content-Security-Policy':"default-src 'self'; base-uri 'self'; form-action 'self'; object-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' wss://api.derivws.com; frame-ancestors 'none'"};
  if(secure){headers['Strict-Transport-Security']='max-age=63072000; includeSubDomains';headers['X-Frame-Options']='DENY';headers['Permissions-Policy']='geolocation=(), microphone=(), camera=()';}
  res.writeHead(200,headers);
  res.end(req.method==='HEAD'?undefined:body);
 }catch{res.writeHead(404);res.end('Build the frontend with npm run build first.');}
});
server.listen(Number(process.env.PORT||3001),'127.0.0.1',()=>console.log('PlayGo listening on http://127.0.0.1:'+(process.env.PORT||3001)));
