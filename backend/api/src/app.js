import {manualTicket} from './manual-demo.js';
import {strategyStore} from '../../trading/strategy-store.js';
import {readOperations} from '../../trading/operations.js';
import {readDemoPortfolio,readDemoHistory,readMarketQuote,readDemoSignal} from '../../trading/demo-portfolio.js';
import {createHash,randomBytes,timingSafeEqual} from 'node:crypto';
import {exchangeCode,listAccounts} from './providers/deriv.js';
import {executeRealOrder} from './ticket/real.js';
import {strategyPassReal} from './strategy/real.js';
import {readRealPortfolio} from './portfolio/real.js';

const random=()=>randomBytes(32).toString('base64url');
const RATE_LIMIT_WINDOW_MS=60000;
const RATE_LIMIT_MAX=60;

export function createApp(config,{fetcher=fetch,now=Date.now}={}){
 const pending=new Map(),sessions=new Map(),rateBuckets=new Map();
 const secure=new URL(config.origin).protocol==='https:';
 const callback=new URL(config.redirectUri);
 if(callback.origin!==config.origin||callback.pathname!=='/api/auth/deriv/callback')throw Error('Callback must use the application origin and /api/auth/deriv/callback');
 if(!secure&&!['localhost','127.0.0.1'].includes(new URL(config.origin).hostname))throw Error('HTTPS required outside localhost');
 const cookieName=secure?'__Host-playgo_session':'playgo_session';
 const oauthCookieName=secure?'__Host-playgo_oauth':'playgo_oauth';
 const setCookie=(res,name,value,seconds)=>{
  const attrs='; HttpOnly; SameSite=Lax; Path=/; Max-Age='+seconds+(secure?'; Secure':'');
  const next=name+'='+value+attrs;
  const prev=res.getHeader('Set-Cookie');
  res.setHeader('Set-Cookie',Array.isArray(prev)?[...prev,next]:prev?[prev,next]:[next]);
 };
 const cookies=req=>Object.fromEntries((req.headers.cookie||'').split(';').map(p=>p.trim().split('=')).filter(x=>x.length===2));
 const json=(res,status,body)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(body));};
 const redirect=(res,url)=>{res.writeHead(302,{Location:url});res.end();};
 const prune=()=>{for(const map of [pending,sessions])for(const [key,v] of map)if(v.expires<=now())map.delete(key);};
 const rateLimit=(sid)=>{
  const t=now();
  let bucket=rateBuckets.get(sid);
  if(!bucket||bucket.reset<=t){bucket={count:0,reset:t+RATE_LIMIT_WINDOW_MS};rateBuckets.set(sid,bucket);}
  bucket.count++;
  return bucket.count>RATE_LIMIT_MAX;
 };
 return async function handler(req,res){
  res.setHeader('Cache-Control','no-store');
  res.setHeader('Referrer-Policy','no-referrer');
  res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('Content-Security-Policy',"default-src 'none'; frame-ancestors 'none'");
  if(secure){
   res.setHeader('Strict-Transport-Security','max-age=63072000; includeSubDomains');
   res.setHeader('X-Frame-Options','DENY');
   res.setHeader('Permissions-Policy','geolocation=(), microphone=(), camera=()');
  }
  prune();
  const path=new URL(req.url,'http://localhost').pathname;
  const sid=cookies(req)[cookieName],session=sessions.get(sid);
  try{
   if(path==='/api/health'&&req.method==='GET')return json(res,200,{status:'ok',execution:false});
   if(path==='/api/session'&&req.method==='GET')return json(res,200,{authenticated:!!session,configured:!!config.clientId,execution:false,mt5:'not_linked'});
   if(path==='/api/auth/deriv/start'&&req.method==='GET'){
    if(!config.clientId)return json(res,503,{error:'Configure DERIV_CLIENT_ID and DERIV_REDIRECT_URI on the backend.'});
    if(pending.size>=1000)return json(res,429,{error:'Too many sign-in attempts. Try later.'});
    const nonce=random(),state=random(),verifier=random();
    pending.set(nonce,{state,verifier,expires:now()+300000});
    setCookie(res,oauthCookieName,nonce,300);
    const url=new URL('https://auth.deriv.com/oauth2/auth');
    url.search=new URLSearchParams({response_type:'code',client_id:config.clientId,redirect_uri:config.redirectUri,scope:config.scopes||'trade',state,code_challenge:createHash('sha256').update(verifier).digest('base64url'),code_challenge_method:'S256'});
    return redirect(res,url.toString());
   }
   if(path==='/api/auth/deriv/callback'&&req.method==='GET'){
    const nonce=cookies(req)[oauthCookieName],flow=pending.get(nonce);pending.delete(nonce);
    const q=new URL(req.url,'http://localhost').searchParams,state=q.get('state')||'';
    const stateValid=flow&&state&&Buffer.byteLength(state)===Buffer.byteLength(flow.state)&&timingSafeEqual(Buffer.from(state),Buffer.from(flow.state));
    if(!stateValid||!q.get('code')||q.has('error')){setCookie(res,oauthCookieName,'',0);return redirect(res,config.origin+'/?auth_error=invalid_callback');}
    try{
     const token=await exchangeCode({code:q.get('code'),verifier:flow.verifier,config,fetcher});
     if(sessions.size>=1000)throw Error('Session capacity reached');
     if(sid)sessions.delete(sid);
     const id=random();sessions.set(id,token);
     setCookie(res,oauthCookieName,'',0);
     setCookie(res,cookieName,id,Math.max(1,Math.floor((token.expires-now())/1000)));
     return redirect(res,config.origin+'/');
    }catch{setCookie(res,oauthCookieName,'',0);return redirect(res,config.origin+'/?auth_error=exchange_failed');}
   }
   if(path==='/api/auth/logout'&&req.method==='POST'){
    if(req.headers.origin!==config.origin||req.headers['x-playgo-request']!=='1')return json(res,403,{error:'Request origin rejected'});
    sessions.delete(sid);setCookie(res,cookieName,'',0);return json(res,200,{ok:true});
   }
   const liveRoute={
    '/api/live/ticket':executeRealOrder,
    '/api/live/strategy':strategyPassReal,
    '/api/live/portfolio':readRealPortfolio,
   }[path];
   if(path.startsWith('/api/live/')){
    if(!liveRoute)return json(res,403,{error:'Real-money trading is unavailable.'});
    const result=await liveRoute();
    return json(res,result.status,result.body);
   }
   if(!session)return json(res,401,{error:'Sign in with Deriv first.'});
   if(sid&&rateLimit(sid))return json(res,429,{error:'Rate limit exceeded. Slow down.'});
   if(path==='/api/demo/ticket' && ['GET','POST'].includes(req.method)){
    if(req.method==='POST' && (req.headers.origin!==config.origin || req.headers['x-playgo-request']!=='1'))
      return json(res,403,{message:'Request origin rejected.'});
    const result=await manualTicket({method:req.method,params:new URL(req.url,'http://localhost').searchParams,token:session.token,
      appId:config.clientId,fetchImpl:fetcher});
    return json(res,result.status,result.body);
   }
   if (path === '/api/demo/strategy' && ['GET','POST'].includes(req.method)) {
    const write=req.method==='POST';
    if(write && (req.headers.origin!==config.origin || req.headers['x-playgo-request']!=='1'))
      return json(res,403,{error:'Request origin rejected'});
    try {
      const params=new URL(req.url,'http://localhost').searchParams;
      const accounts=await listAccounts(session.token,fetcher,config.clientId);
      const row=await strategyStore({accountId:params.get('account'),accounts,fetchImpl:fetcher},write?'save':params.get('view')==='history'?'history':'read',{
        packId:params.get('pack'),fast:Number(params.get('fast')),slow:Number(params.get('slow')),
        enabled:params.get('enabled')==='true'?true:params.get('enabled')==='false'?false:null
      });
      return json(res,200,{strategy:row});
    } catch(err) {
      return json(res,err.message==='DEMO_ACCOUNT_REQUIRED'?403:err.message==='INVALID_STRATEGY'?400:err.status||503,{error:'Strategy unavailable'});
    }
   }
   if (['/api/demo/portfolio','/api/demo/history','/api/demo/quote','/api/demo/operations','/api/demo/signal'].includes(path) && req.method === 'GET') {
    try {
      const accountId = new URL(req.url,'http://localhost').searchParams.get('account');
      const accounts = await listAccounts(session.token, fetcher, config.clientId);
      const read = path.endsWith('/operations') ? readOperations : path.endsWith('/history') ? readDemoHistory : readDemoPortfolio;
      const context = {token:session.token, accountId, accounts, appId:config.clientId, fetchImpl:fetcher};
      const params = new URL(req.url,'http://localhost').searchParams;
      const result = path.endsWith('/signal') ? await readDemoSignal(context,params) : path.endsWith('/quote') ? await readMarketQuote(context, {
        symbol:params.get('symbol')||'frxEURUSD',contractType:params.get('direction') ?? 'CALL',duration:Number(params.get('minutes') ?? 15),durationUnit:'m',stake:Number(params.get('stake') ?? 1)
      }) : await read(context);
      return json(res, 200, result);
    } catch (err) {
      return json(res, err.message === 'DEMO_ACCOUNT_REQUIRED' ? 403 : err.message === 'BROKER_RATE_LIMIT' ? 429 : ['INVALID_QUOTE','INVALID_STRATEGY'].includes(err.message) ? 400 : err.status || 502, {error:'Demo portfolio unavailable'});
    }
   }
   if(path==='/api/accounts'&&req.method==='GET'){
    try{return json(res,200,{accounts:await listAccounts(session.token,fetcher,config.clientId)});}
    catch(e){if(e.status===401){sessions.delete(sid);setCookie(res,cookieName,'',0);}return json(res,e.status||502,{error:e.status===401?'Your Deriv session expired. Sign in again.':'Could not retrieve Deriv accounts.'});}
   }
   if(path==='/api/mt5/status'&&req.method==='GET')return json(res,200,{status:'not_linked',execution:false});
   if(path.startsWith('/api/orders')||path.startsWith('/api/bots'))return json(res,501,{error:'Broker order submission is disabled.'});
   return json(res,404,{error:'Route not found'});
  }catch(err){console.error('[playgo] request failed:',err&&err.message);return json(res,500,{error:'Request failed'});}
 };
}
