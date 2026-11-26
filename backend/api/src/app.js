import {readPortfolio, readHistory, closePortfolioContract} from './portfolio/index.js';
import {isDerivAccount, startRealAgents, stopRealAgents, readRealAgentStatuses, runRealAgentTick, placeRealAgentOrders, calculateStake, MAX_STAKE_ABSOLUTE_USD, MAX_STAKE_PERCENT} from '../../trading/agents/index.js';
import {createHash,randomBytes,timingSafeEqual} from 'node:crypto';
import {exchangeCode,listAccounts} from './providers/deriv.js';
import {accountReference, activateAccount, publicAccount, publicAccountBody, publicAgentResult, resolveActiveAccount} from './account-selection.js';
import {readCurrencyPerUsd} from '../../trading/execute.js';
import {readAutoStartPreference, writeAutoStartPreference, recordBrowserConsoleLogs} from '../../trading/real-store.js';
import {readJsonBody} from './read-json-body.js';

const random=()=>randomBytes(32).toString('base64url');
const RATE_LIMIT_WINDOW_MS=60000;
const RATE_LIMIT_MAX=60;

export function createApp(config,{fetcher=fetch,now=Date.now,Socket=globalThis.WebSocket}={}){
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
     const id=random();sessions.set(id,{...token,activeAccountId:null});
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
   if(params.has('account'))return json(res,400,{error:'Use the active Deriv account.'});
   let linkedAccounts;
   try {
     linkedAccounts=await listAccounts(session.token,fetcher,config.clientId);
   } catch (error) {
     const status=error.status||502;
     if(status===401){sessions.delete(sid);setCookie(res,cookieName,'',0);}
     return json(res,status,{error:status===401?'Deriv session expired. Sign in again.':status===429?'Deriv account service rate limit exceeded.':'Could not verify Deriv accounts.'});
   }
   const account=resolveActiveAccount(session,linkedAccounts);
   const accountRef=account?accountReference(session.token,account.account_id):null;

   if(path==='/api/diagnostics/client'&&req.method==='POST'){
    if(req.headers.origin!==config.origin||req.headers['x-playgo-request']!=='1')
      return json(res,403,{error:'Request origin rejected.'});
    if(!account||!accountRef)return json(res,400,{error:'Select a connected Deriv account.'});
    let body;
    try{body=await readJsonBody(req);}
    catch(error){return json(res,error.message==='REQUEST_BODY_TOO_LARGE'?413:400,{error:error.message});}
    if(body?.accountRef!==accountRef||!Array.isArray(body?.entries))
      return json(res,400,{error:'INVALID_BROWSER_DIAGNOSTICS'});
    try{
      const requestId=req.headers['x-vercel-id'];
      const result=await recordBrowserConsoleLogs({
        accountId:account.account_id,
        accountReference:accountRef,
        entries:body.entries,
        requestId:typeof requestId==='string'&&/^[A-Za-z0-9._:-]{1,128}$/.test(requestId)?requestId:null,
        fetchImpl:fetcher,
      });
      return json(res,202,result);
    }catch(error){
      const code=error.code||error.message||'BROWSER_DIAGNOSTICS_WRITE_FAILED';
      return json(res,code.startsWith('INVALID_')?400:503,{error:code});
    }
   }

   if(path==='/api/accounts'&&req.method==='GET'){
    const active=account?accountRef:null;
    return json(res,200,{accounts:linkedAccounts.filter(isDerivAccount).map(row=>publicAccount(row,session.token)),activeAccountRef:active});
   }

   if(path==='/api/accounts/select'&&req.method==='POST'){
    if(req.headers.origin!==config.origin||req.headers['x-playgo-request']!=='1')
      return json(res,403,{error:'Request origin rejected.'});
    try{
      const selected=await activateAccount({
        session,accounts:linkedAccounts,accountRef:params.get('accountRef'),token:session.token,
        confirmReal:params.get('confirmReal')==='1',appId:config.clientId,env:process.env,fetchImpl:fetcher,Socket,
      });
      return json(res,200,{activeAccount:publicAccount(selected,session.token)});
    }catch(error){
      const code=error.code||'ACCOUNT_SELECTION_FAILED';
      return json(res,code==='ACCOUNT_SWITCH_OPEN_POSITIONS'?409:
        ['REAL_ACCOUNT_CONFIRMATION_REQUIRED','ACCOUNT_REFERENCE_NOT_FOUND'].includes(code)?400:503,{error:code});
    }
   }

   if(path.startsWith('/api/agent/') && !account)
    return json(res,400,{error:'Select a connected Deriv account.'});

   if(path==='/api/agent/preferences'&&req.method==='GET'){
    try{
      const enabled=await readAutoStartPreference({accountId:account.account_id,accountType:account.account_type,env:process.env,fetchImpl:fetcher});
      return json(res,200,{accountRef,autoStartEnabled:enabled});
    }catch(error){return json(res,503,{error:error.code||'AUTO_START_SETTINGS_UNAVAILABLE'});}
   }
   if(path==='/api/agent/preferences'&&req.method==='POST'){
    if(req.headers.origin!==config.origin||req.headers['x-playgo-request']!=='1')
      return json(res,403,{error:'Request origin rejected.'});
    const enabled=params.get('enabled');
    if(!['0','1'].includes(enabled))return json(res,400,{error:'Invalid auto-start setting.'});
    if(enabled==='1'&&account.account_type==='real'&&params.get('confirmReal')!=='1')
      return json(res,400,{error:'REAL_AUTO_START_CONFIRMATION_REQUIRED'});
    try{
      await writeAutoStartPreference({accountId:account.account_id,enabled:enabled==='1',env:process.env,fetchImpl:fetcher});
      return json(res,200,{accountRef,autoStartEnabled:enabled==='1'});
    }catch(error){return json(res,503,{error:error.code||'AUTO_START_SETTINGS_UNAVAILABLE'});}
   }
   if(path==='/api/agent/limits'&&req.method==='GET'){
    try{
      const currencyPerUsd=await readCurrencyPerUsd({account,token:session.token,appId:config.clientId,fetchImpl:fetcher,Socket});
      const balance=Number(account.balance);
      const stake=calculateStake(balance,account.currency,currencyPerUsd);
      return json(res,200,{accountRef,currency:account.currency,stake,maxStake:MAX_STAKE_ABSOLUTE_USD*currencyPerUsd,sizingPercent:MAX_STAKE_PERCENT*100});
    }catch(error){return json(res,503,{error:error.code||error.message||'STAKE_LIMIT_UNAVAILABLE'});}
   }

   if(path==='/api/agent/status'&&req.method==='GET'){
    const results=await readRealAgentStatuses({accounts:[account],env:process.env,fetchImpl:fetcher});
    return json(res,200,{accounts:results.map(row=>publicAgentResult(row,accountRef))});
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
        return json(res,200,{accounts:results.map(row=>publicAgentResult(row,accountRef))});
      }catch(error){
        const code=error.code||'AGENT_START_FAILED';
        return json(res,code==='LIVE_TRADING_DISABLED'?403:['REAL_ACCOUNT_REQUIRED','INVALID_EXIT_SETTINGS'].includes(code)?400:503,{error:code});
      }
    }
    if(path==='/api/agent/stop'){
      const results=await stopRealAgents({accounts:[account],env:process.env,fetchImpl:fetcher});
      return json(res,200,{accounts:results.map(row=>publicAgentResult(row,accountRef))});
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
          orderRequestId: params.get('orderRequestId'),
          stopLossPercent:Number(params.get('stopLossPercent')),
          takeProfitPercent:Number(params.get('takeProfitPercent')),
          env:process.env,
          fetchImpl:fetcher,
        });
        return json(res,200,{accounts:results.map(row=>publicAgentResult(row,accountRef))});
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
        results.push({accountId:row.account_id,status:'error',reason:error.code||'AGENT_RUN_FAILED'});
      }
    }
    return json(res,200,{accounts:results.map(row=>publicAgentResult(row,accountRef))});
   }

   if(path==='/api/portfolio/close' && req.method==='POST'){
    if(!account)return json(res,400,{error:'Select a connected Deriv account.'});
    if(req.headers.origin!==config.origin || req.headers['x-playgo-request']!=='1')
      return json(res,403,{error:'Request origin rejected.'});
    const result=await closePortfolioContract({account,contractId:params.get('contract'),token:session.token,appId:config.clientId,fetchImpl:fetcher});
    return json(res,result.status,publicAccountBody(result.body,accountRef));
   }

   if(['/api/portfolio','/api/history'].includes(path)&&req.method==='GET'){
    if(!account)return json(res,400,{error:'Select a connected Deriv account.'});
    const read=path==='/api/history'?readHistory:readPortfolio;
    const result=await read({account,token:session.token,includeEvidence: params.get('report') === '1',
      accountRef,
      range: params.has('range') ? { mode: params.get('range'), from: params.get('from'), to: params.get('to') } : null,
      offset: params.has('offset') ? Number(params.get('offset')) : 0,
      limit: params.has('limit') ? Number(params.get('limit')) : 500,
      appId:config.clientId,env:process.env,fetchImpl:fetcher});
    return json(res,result.status,publicAccountBody(result.body,accountRef));
   }

   if(path==='/api/mt5/status'&&req.method==='GET')return json(res,200,{status:'not_linked',execution:false});
   if(path.startsWith('/api/orders')||path.startsWith('/api/bots'))return json(res,501,{error:'Route not available.'});
   return json(res,404,{error:'Route not found'});
  }catch{console.error('[playgo] request failed');return json(res,500,{error:'Request failed'});}
 };
}
