import {DEFAULT_LIMITS} from './risk.js';

export async function readOperations({accountId,accounts,recovery=false,env=process.env,fetchImpl=fetch}) {
  if (!accounts.some(a=>a.account_type === 'demo' && a.account_id === accountId))
    throw Error('DEMO_ACCOUNT_REQUIRED');
  const key=env.SUPABASE_SERVICE_ROLE_KEY;
  if (!/^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/.test(env.SUPABASE_URL) || !key)
    throw Error('DATABASE_UNAVAILABLE');
  const url=new URL('/rest/v1/playgo_execution_intents',env.SUPABASE_URL);
  if (!/^[a-zA-Z0-9_-]{3,80}$/.test(accountId)) throw Error('DEMO_ACCOUNT_REQUIRED');
  url.search=new URLSearchParams({account_id:'eq.'+accountId,account_mode:'eq.demo',
    select:'account_id,strategy_id,symbol,status,updated_at',order:'updated_at.desc',limit:'50'});
  if (recovery) {
    url.searchParams.set('select','id,account_id,account_mode,status,symbol,contract_type,broker_contract_id');
    url.searchParams.set('status','in.(submitted,confirmed,unknown)');
  }
  const res=await fetchImpl(url,{headers:{apikey:key,Authorization:'Bearer '+key},
    redirect:'error',signal:AbortSignal.timeout(8000)});
  if (!res.ok) throw Error('DATABASE_UNAVAILABLE');
  const rows=await res.json();
  if (!Array.isArray(rows) || rows.some(row=>row.account_id !== accountId)) throw Error('ACCOUNT_MISMATCH');
  if (recovery) return {intents:rows};
  return {accountId,execution:false,limits:DEFAULT_LIMITS,worker:'Broker submission disabled',
    intents:rows.map(({strategy_id,symbol,status,updated_at})=>({strategy_id,symbol,status,updated_at}))};
}
