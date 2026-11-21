import {databaseRoot,databaseKey} from '../../web/server/trading/database-url.js';
// One recovery pass. Schedule only on an isolated demo worker after qualification.
import {listAccounts} from './providers/deriv.js';
import {readOperations} from '../../web/server/trading/operations.js';
import {recoverBoundContract} from '../../web/server/trading/recovery-policy.js';
import {atomicDemoTransition} from '../../web/server/trading/atomic-worker.js';
import {pathToFileURL} from 'node:url';

export async function recoverDemo({env=process.env,fetchImpl=fetch,Socket=WebSocket}={}) {
  if (env.PLAYGO_DEMO_EXECUTION_ENABLED !== 'true' || env.LIVE_TRADING_ENABLED !== 'false')
    throw Error('WORKER_DISABLED');
  const accountId=env.DERIV_DEMO_ACCOUNT_ID;
  const token=env.DERIV_DEMO_TOKEN;
  if (!token || !env.DERIV_CLIENT_ID || !/^[a-zA-Z0-9_-]{3,80}$/.test(accountId || ''))
    throw Error('DEMO_AUTH_REQUIRED');
  const accounts=await listAccounts(token,fetchImpl,env.DERIV_CLIENT_ID);
  const context={token,accountId,accounts,appId:env.DERIV_CLIENT_ID,fetchImpl,Socket};
  // This also verifies demo ownership before reading with the service role.
  const snapshot=await readOperations({...context,env,recovery:true});
  const counts={observed:snapshot.intents.length,held:0,transitioned:0};
  for (const intent of snapshot.intents) {
    const result=await recoverBoundContract({intent,context,
      atomicTransition:args=>atomicDemoTransition({...args,env,fetchImpl})});
    if (result.audited === true) counts.transitioned++;
    else counts.held++;
  }
  const heartbeat=await fetchImpl(new URL(databaseRoot(env)+'/playgo_demo_worker_health?on_conflict=account_id'),{
    method:'POST',headers:{apikey:databaseKey(env),Authorization:'Bearer '+databaseKey(env),
      'Content-Type':'application/json',Prefer:'resolution=merge-duplicates,return=minimal'},
    body:JSON.stringify({account_id:accountId,completed_at:new Date().toISOString()}),
    redirect:'error',signal:AbortSignal.timeout(8000)
  });
  if (!heartbeat.ok) throw Error('WORKER_HEARTBEAT_FAILED');
  return counts;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  recoverDemo().then(result=>console.log(JSON.stringify(result))).catch(()=>{
    console.error('Demo recovery incomplete. Existing intents remain reserved for review.');
    process.exitCode=1;
  });
}
