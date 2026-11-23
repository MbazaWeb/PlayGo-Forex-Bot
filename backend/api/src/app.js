import { isDerivAccount } from '../../trading/deriv-account.js';
import {readPortfolio, readHistory, closePortfolioContract} from './portfolio/index.js';
import {startRealAgents, stopRealAgents, readRealAgentStatuses, runRealAgentTick, placeRealAgentOrders} from '../../trading/real-agent.js';
import {createHash,randomBytes,timingSafeEqual} from 'node:crypto';
import {exchangeCode,listAccounts} from './providers/deriv.js';

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
   if(path==='/api/health'&&req.method==='GET')return json(res,200,{status:'ok',execution:process.env.LIVE_TRADING_ENABLED==='true'});
   if(path==='/api/session'&&req.method==='GET')return json(res,200,{authenticated:!!session,configured:!!config.clientId,execution:process.env.LIVE_TRADING_ENABLED==='true',mt5:'not_linked'});
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

   if(!session)return json(res,401,{error:'Sign in with Deriv first.'});
   if(sid&&rateLimit(sid))return json(res,429,{error:'Rate limit exceeded. Slow down.'});

   const params=new URL(req.url,'http://localhost').searchParams;
   const accountId=params.get('account');
   let linkedAccounts;
   try {
     linkedAccounts=await listAccounts(session.token,fetcher,config.clientId);
   } catch (error) {
     const status=error.status||502;
     if(status===401){sessions.delete(sid);setCookie(res,cookieName,'',0);}
     return json(res,status,{error:status===401?'Deriv session expired. Sign in again.':status===429?'Deriv account service rate limit exceeded.':'Could not verify Deriv accounts.'});
   }
   const account=linkedAccounts.find(a=>a.account_id===accountId && isDerivAccount(a));

   if(path.startsWith('/api/agent/') && !account)
    return json(res,400,{error:'Select a connected Deriv account.'});

   if(path==='/api/agent/status'&&req.method==='GET'){
    const results=await readRealAgentStatuses({accounts:[account],env:process.env,fetchImpl:fetcher});
    return json(res,200,{accounts:results});
   }
   if(['/api/agent/start','/api/agent/stop','/api/agent/run','/api/agent/place'].includes(path)&&req.method==='POST'){
    if(req.headers.origin!==config.origin||req.headers['x-playgo-request']!=='1')
      return json(res,403,{error:'Request origin rejected.'});
    if(path==='/api/agent/start'){
      try{
        const results=await startRealAgents({
          accounts:[account],
          stopLossPercent:Number(params.get('stopLossPercent')),
          takeProfitPercent:Number(params.get('takeProfitPercent')),
          env:process.env,
          fetchImpl:fetcher,
        });
        return json(res,200,{accounts:results});
      }catch(error){
        const code=error.code||'AGENT_START_FAILED';
        return json(res,code==='LIVE_TRADING_DISABLED'?403:['REAL_ACCOUNT_REQUIRED','INVALID_EXIT_SETTINGS'].includes(code)?400:503,{error:code});
      }
    }
    if(path==='/api/agent/stop'){
      const results=await stopRealAgents({accounts:[account],env:process.env,fetchImpl:fetcher});
      return json(res,200,{accounts:results});
    }
    if(path==='/api/agent/place'){
      try{
        const results=await placeRealAgentOrders({
          accounts:[account],
          token:session.token,
          appId:config.clientId,
          symbol:params.get('symbol'),
          granularity:Number(params.get('granularity')),
          automatic:params.get('mode')==='automatic',
          terminalAction: params.get('terminalAction'),
          stopLossPercent:Number(params.get('stopLossPercent')),
          takeProfitPercent:Number(params.get('takeProfitPercent')),
          env:process.env,
          fetchImpl:fetcher,
        });
        return json(res,200,{accounts:results});
      }catch(error){
        const code=error.code||'AGENT_PLACE_FAILED';
        return json(res,code==='LIVE_TRADING_DISABLED'?403:['REAL_ACCOUNT_REQUIRED','INVALID_EXIT_SETTINGS','INVALID_MARKET_REQUEST','INVALID_TERMINAL_ACTION'].includes(code)?400:503,{error:code});
      }
    }
    const symbol=params.get('symbol');
    const granularity=Number(params.get('granularity'));
    const results=[];
    for(const row of [account]){
      try{
        results.push(await runRealAgentTick({
          account:row,token:session.token,appId:config.clientId,symbol,granularity,
          automatic:params.get('mode')==='automatic',
          exitsOnly: params.get('exitsOnly') === '1',
          marketScan: params.get('marketScan') === '1',
          env:process.env,fetchImpl:fetcher
        }));
      }catch(error){
        results.push({accountId:row.account_id,status:'error',reason:error.code||error.message||'AGENT_RUN_FAILED'});
      }
    }
    return json(res,200,{accounts:results});
   }

   if(path==='/api/portfolio/close' && req.method==='POST'){
    if(req.headers.origin!==config.origin || req.headers['x-playgo-request']!=='1')
      return json(res,403,{error:'Request origin rejected.'});
    const result=await closePortfolioContract({account,contractId:params.get('contract'),token:session.token,appId:config.clientId,fetchImpl:fetcher});
    return json(res,result.status,result.body);
   }

   if(['/api/portfolio','/api/history'].includes(path)&&req.method==='GET'){
    if(!account)return json(res,400,{error:'Deriv account not found.'});
    const read=path==='/api/history'?readHistory:readPortfolio;
    const result=await read({account,token:session.token,appId:config.clientId,fetchImpl:fetcher});
    return json(res,result.status,result.body);
   }

   if(path==='/api/accounts'&&req.method==='GET')return json(res,200,{accounts:linkedAccounts.filter(isDerivAccount)});

   if(path==='/api/mt5/status'&&req.method==='GET')return json(res,200,{status:'not_linked',execution:false});
   if(path.startsWith('/api/orders')||path.startsWith('/api/bots'))return json(res,501,{error:'Route not available.'});
   return json(res,404,{error:'Route not found'});
  }catch(err){console.error('[playgo] request failed:',err&&err.message);return json(res,500,{error:'Request failed'});}
 };
}