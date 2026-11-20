import {readOperations} from '../../web/api/trading/operations.js';
import {readDemoPortfolio,readDemoHistory,readMarketQuote} from '../../web/api/trading/demo-portfolio.js';
import {createHash,randomBytes,timingSafeEqual} from 'node:crypto';
import {exchangeCode,listAccounts} from './providers/deriv.js';
const random=()=>randomBytes(32).toString('base64url');
export function createApp(config,{fetcher=fetch,now=Date.now}={}){
 const pending=new Map(),sessions=new Map();
 const secure=new URL(config.origin).protocol==='https:';
 const callback=new URL(config.redirectUri);
 if(callback.origin!==config.origin||callback.pathname!=='/api/auth/deriv/callback')throw Error('Callback must use the application origin and /api/auth/deriv/callback');
 if(!secure&&!['localhost','127.0.0.1'].includes(new URL(config.origin).hostname))throw Error('HTTPS required outside localhost');
 const cookieName=secure?'__Host-playgo_session':'playgo_session';
 const setCookie=(res,name,value,seconds)=>res.setHeader('Set-Cookie',name+'='+value+'; HttpOnly; SameSite=Lax; Path=/; Max-Age='+seconds+(secure?'; Secure':''));
 const cookies=req=>Object.fromEntries((req.headers.cookie||'').split(';').map(p=>p.trim().split('=')));
 const json=(res,status,body)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(body));};
 const redirect=(res,url)=>{res.writeHead(302,{Location:url});res.end();};
 const prune=()=>{for(const map of [pending,sessions])for(const [key,v] of map)if(v.expires<=now())map.delete(key);};
 return async function handler(req,res){
  res.setHeader('Cache-Control','no-store');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('Content-Security-Policy',"default-src 'none'; frame-ancestors 'none'");
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
    setCookie(res,'playgo_oauth',nonce,300);
    const url=new URL('https://auth.deriv.com/oauth2/auth');
    url.search=new URLSearchParams({response_type:'code',client_id:config.clientId,redirect_uri:config.redirectUri,scope:config.scopes||'trade',state,code_challenge:createHash('sha256').update(verifier).digest('base64url'),code_challenge_method:'S256'});
    return redirect(res,url.toString());
   }
   if(path==='/api/auth/deriv/callback'&&req.method==='GET'){
    const nonce=cookies(req).playgo_oauth,flow=pending.get(nonce);pending.delete(nonce);setCookie(res,'playgo_oauth','',0);
    const q=new URL(req.url,'http://localhost').searchParams,state=q.get('state')||'';
    if(!flow||Buffer.byteLength(state)!==Buffer.byteLength(flow.state)||!timingSafeEqual(Buffer.from(state),Buffer.from(flow.state))||!q.get('code')||q.has('error'))return redirect(res,config.origin+'/?auth_error=invalid_callback');
    try{
     const token=await exchangeCode({code:q.get('code'),verifier:flow.verifier,config,fetcher});
     if(sessions.size>=1000)throw Error('Session capacity reached');
     if(sid)sessions.delete(sid);
     const id=random();sessions.set(id,token);setCookie(res,cookieName,id,Math.max(1,Math.floor((token.expires-now())/1000)));
     return redirect(res,config.origin+'/');
    }catch{return redirect(res,config.origin+'/?auth_error=exchange_failed');}
   }
   if(path==='/api/auth/logout'&&req.method==='POST'){
    if(req.headers.origin!==config.origin||req.headers['x-playgo-request']!=='1')return json(res,403,{error:'Request origin rejected'});
    sessions.delete(sid);setCookie(res,cookieName,'',0);return json(res,200,{ok:true});
   }
   if(!session)return json(res,401,{error:'Sign in with Deriv first.'});
  if (['/api/demo/portfolio','/api/demo/history','/api/demo/quote','/api/demo/operations'].includes(path) && req.method === 'GET') {
    try {
      const accountId = new URL(req.url,'http://localhost').searchParams.get('account');
      const accounts = await listAccounts(session.token, fetcher, config.clientId);
      const read = path.endsWith('/operations') ? readOperations : path.endsWith('/history') ? readDemoHistory : readDemoPortfolio;
      const context = {token:session.token, accountId, accounts, appId:config.clientId, fetchImpl:fetcher};
      const params = new URL(req.url,'http://localhost').searchParams;
      const result = path.endsWith('/quote') ? await readMarketQuote(context, {
        symbol:'frxEURUSD',contractType:params.get('direction') ?? 'CALL',duration:Number(params.get('minutes') ?? 5),durationUnit:'m',stake:Number(params.get('stake') ?? 1)
      }) : await read(context);
      return json(res, 200, result);
    } catch (err) {
      return json(res, err.message === 'DEMO_ACCOUNT_REQUIRED' ? 403 : err.message === 'BROKER_RATE_LIMIT' ? 429 : err.message === 'INVALID_QUOTE' ? 400 : err.status || 502, {error:'Demo portfolio unavailable'});
    }
  }
   if(path==='/api/accounts'&&req.method==='GET'){
    try{return json(res,200,{accounts:await listAccounts(session.token,fetcher,config.clientId)});}
    catch(e){if(e.status===401){sessions.delete(sid);setCookie(res,cookieName,'',0);}return json(res,e.status||502,{error:e.status===401?'Your Deriv session expired. Sign in again.':'Could not retrieve Deriv accounts.'});}
   }
   if(path==='/api/mt5/status'&&req.method==='GET')return json(res,200,{status:'not_linked',execution:false});
   if(path.startsWith('/api/orders')||path.startsWith('/api/bots'))return json(res,501,{error:'Order execution and automated trading are not implemented.'});
   return json(res,404,{error:'Route not found'});
  }catch{return json(res,500,{error:'Request failed'});}
 };
}
