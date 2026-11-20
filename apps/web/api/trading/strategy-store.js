import {databaseRoot,databaseKey} from './database-url.js';
import {randomUUID} from 'node:crypto';
import {validPeriods} from './crossover.js';

export async function strategyStore(context, action='read', value={}) {
  const {accountId,accounts,env=process.env,fetchImpl=fetch}=context;
  if(!/^[a-zA-Z0-9_-]{3,80}$/.test(accountId??'') ||
     !accounts.some(row=>row.account_id===accountId && row.account_type==='demo')) throw Error('DEMO_ACCOUNT_REQUIRED');
  const key=databaseKey(env);
  if(!databaseRoot(env) || !key) throw Error('DATABASE_UNAVAILABLE');
  const url=new URL(databaseRoot(env)+'/playgo_demo_strategies');
  const headers={apikey:key,Authorization:'Bearer '+key,'Content-Type':'application/json'};
  let method='GET',body;
  if(action==='save'){
    if(!validPeriods(value.fast,value.slow) || typeof value.enabled!=='boolean') throw Error('INVALID_STRATEGY');
    method='POST';url.searchParams.set('on_conflict','account_id');
    headers.Prefer='resolution=merge-duplicates,return=representation';
    body={account_id:accountId,fast:value.fast,slow:value.slow,enabled:value.enabled,version:randomUUID(),signal:null,observed_minute:null};
  } else {
    url.searchParams.set('account_id','eq.'+accountId);
    if(action==='publish'){
      method='PATCH';headers.Prefer='return=representation';
      url.searchParams.set('version','eq.'+value.version);
      url.searchParams.set('enabled','eq.true');
      url.searchParams.set('or','(observed_minute.is.null,observed_minute.lt.'+value.minute+')');
      body={signal:value.signal,observed_minute:value.minute};
    } else if(action!=='read') throw Error('INVALID_ACTION');
  }
  const res=await fetchImpl(url,{method,headers,body:JSON.stringify(body),redirect:'error',signal:AbortSignal.timeout(8000)});
  if(!res.ok) throw Error('DATABASE_UNAVAILABLE');
  const rows=await res.json();
  if(!Array.isArray(rows)||rows.length>1 || rows.some(row=>row.account_id!==accountId)) throw Error('INVALID_STRATEGY_RESPONSE');
  return rows[0]??null;
}
