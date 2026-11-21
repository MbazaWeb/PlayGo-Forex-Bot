import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {randomBytes,randomInt} from 'node:crypto';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import EmbeddedPostgres from 'embedded-postgres';

const pgPort=randomInt(30000,50000);
const directory=await mkdtemp(join(tmpdir(),'playgo-local-'));
const pg=new EmbeddedPostgres({
  databaseDir:directory,port:pgPort,user:'postgres',
  password:randomBytes(24).toString('hex'),persistent:true,autoRehydrateSymlinks:true,
  postgresFlags:['-c','listen_addresses=127.0.0.1','-c','unix_socket_directories='],
  onLog:()=>{},onError:()=>{}
});
const clients=new Set();
async function connect(role){
  const client=pg.getPgClient();
  await client.connect();
  clients.add(client);
  if(role==='worker')await client.query('set role service_role');
  return client;
}
async function close(client){await client.end();clients.delete(client);}
let running=false;
try {
  await pg.initialise();await pg.start();running=true;
  const admin=await connect();
  await admin.query('create role anon;create role authenticated;create role service_role bypassrls');
  for(const name of ['schema','hardening','atomic_transition','reserve','risk_controls','strategy','paper_pack','broker_demo','automation_mode','manual_demo']){
    const sql=await readFile(new URL('../backend/deriv_execution/'+name+'.sql',import.meta.url),'utf8');
    await admin.query('begin');
    await admin.query(sql);
    await admin.query('commit');
  }
  await admin.query('grant select,insert,update on playgo_execution_intents to service_role; grant select,insert on playgo_execution_audit to service_role; grant usage on all sequences in schema public to service_role');
  if(process.argv.includes('--rest')) {
    const {verifyLocalRest}=await import('./verify-local-rest.mjs');
    await verifyLocalRest(admin,pgPort);
  }
  const a=await connect('worker'),b=await connect('worker');
  // A previous-bar signal settles once even when two workers publish concurrently.
  await a.query("insert into playgo_demo_strategies(account_id,fast,slow,enabled,pack_id,observed_minute,signal) values ('pack-demo',5,20,true,'rsi-momentum',6000,'up')");
  const fill=c=>c.query("update playgo_demo_strategies set observed_minute=6060,signal='down',bar_open=1.10,bar_close=1.11 where account_id='pack-demo' and observed_minute<6060");
  const fills=await Promise.all([fill(a),fill(b)]);
  assert.equal(fills.reduce((n,r)=>n+r.rowCount,0),1);
  const paper=async()=> (await b.query("select count(*)::int as n,sum(pnl)::float as pnl from playgo_pack_trades where account_id='pack-demo'")).rows[0];
  assert.deepEqual(await paper(),{n:1,pnl:1});
  await a.query('begin');
  await a.query("update playgo_demo_strategies set observed_minute=6120 where account_id='pack-demo'");
  await a.query('rollback');
  assert.deepEqual(await paper(),{n:1,pnl:1});
  await a.query("update playgo_demo_strategies set observed_minute=6300 where account_id='pack-demo'");
  await a.query("update playgo_demo_strategies set enabled=false,observed_minute=6360 where account_id='pack-demo'");
  assert.deepEqual(await paper(),{n:1,pnl:1});
  await assert.rejects(a.query('delete from playgo_pack_trades'),/permission denied/);
  console.log('PASS automated paper fill, duplicate prevention, rollback, missed-bar and pause handling.');
  const nowMinute=Math.floor(Date.now()/60000)*60;
  const configuration=await a.query("update playgo_demo_strategies set enabled=true,observed_minute=$1,signal='up' where account_id='pack-demo' returning version",[nowMinute]);
  const demoRecord={account_id:'pack-demo',account_mode:'demo',strategy_id:'deriv-rsi-momentum',symbol:'frxEURUSD',status:'reserved',contract_type:'CALL',stake:1,
    idempotency_key:configuration.rows[0].version+'_'+nowMinute};
  await admin.query("insert into playgo_demo_controls(account_id,paused) values ('pack-demo',false)");
  const claimDemo=()=>a.query('select playgo_reserve_demo($1) as r',[demoRecord]);
  await assert.rejects(claimDemo(),/DEMO_NOT_QUALIFIED/);
  await admin.query("update playgo_demo_controls set broker_demo_qualified=true where account_id='pack-demo'");
  const acceptedDemo=await claimDemo();
  await a.query("update playgo_demo_strategies set enabled=false where account_id='pack-demo'");
  await assert.rejects(a.query("select playgo_atomic_demo_transition($1,'submit',null)",[acceptedDemo.rows[0].r.id]),/STALE_DEMO_SIGNAL/);
  console.log('PASS demo qualification and signal recheck at submission.');
  const manualRecord={...demoRecord,strategy_id:'deriv-manual-ticket',account_id:'manual-demo',idempotency_key:'manual_6da12d37-8284-4b5b-92ae-505967892320'};
  await admin.query("insert into playgo_demo_controls(account_id,paused) values ('manual-demo',false)");
  const manualReserve=()=>a.query('select playgo_reserve_demo($1) as r',[manualRecord]);
  await assert.rejects(manualReserve(),/DEMO_NOT_QUALIFIED/);
  await admin.query("update playgo_demo_controls set broker_demo_qualified=true where account_id='manual-demo'");
  const manual=(await manualReserve()).rows[0].r.id;
  await assert.rejects(manualReserve());
  await admin.query("update playgo_demo_controls set broker_demo_qualified=false where account_id='manual-demo'");
  await assert.rejects(a.query("select playgo_atomic_demo_transition($1,'submit',null)",[manual]),/DEMO_NOT_QUALIFIED/);
  console.log('PASS manual demo qualification, duplicate protection and revocation before purchase.');
  const record={account_id:'local-demo',account_mode:'demo',status:'reserved',idempotency_key:'local-demo-000001',strategy_id:'crossover',symbol:'frxEURUSD',contract_type:'CALL',stake:1};
  const reserve=c=>c.query('select playgo_reserve_demo($1) as r',[record]);
  await assert.rejects(reserve(a),/ACCOUNT_PAUSED/);
  await admin.query("insert into playgo_demo_controls values ('local-demo',false)");
  const reservations=await Promise.allSettled([reserve(a),reserve(b)]);
  const accepted=reservations.filter(r=>r.status==='fulfilled');
  assert.equal(accepted.length,1);
  assert.equal(reservations.find(r=>r.status==='rejected').reason.code,'23505');
  const id=accepted[0].value.rows[0].r.id;
  const change=(c,event,contract=null)=>c.query('select playgo_atomic_demo_transition($1,$2,$3)',[id,event,contract]);
  await admin.query('update playgo_demo_controls set paused=true');
  await assert.rejects(change(a,'submit'),/ACCOUNT_PAUSED/);
  await admin.query('update playgo_demo_controls set paused=false');
  const claims=await Promise.allSettled([change(a,'submit'),change(b,'submit')]);
  assert.equal(claims.filter(r=>r.status==='fulfilled').length,1);
  assert.match(claims.find(r=>r.status==='rejected').reason.message,/INVALID_EXECUTION_TRANSITION/);
  await a.query('begin');await change(a,'uncertainty');await close(a);
  assert.equal((await b.query('select status from playgo_execution_intents where id=$1',[id])).rows[0].status,'submitted');
  await change(b,'confirm','123');
  await assert.rejects(change(b,'settle','123'),/MISSING_SETTLEMENT/);
  await b.query("select playgo_settle_bound_demo($1,'123',1,1.80,floor(extract(epoch from now()))::bigint)",[id]);
  await assert.rejects(b.query("update playgo_demo_controls set paused=false"),/permission denied/);
  await close(b);await close(admin);await pg.stop();running=false;await pg.start();running=true;
  const reader=await connect('worker');
  const result=await reader.query('select i.status,s.proceeds-s.cost as pnl from playgo_execution_intents i join playgo_demo_settlements s on s.intent_id=i.id where i.id=$1',[id]);
  assert.deepEqual(result.rows,[{status:'settled',pnl:'0.80'}]);
  assert.equal((await reader.query('select count(*)::int as n from playgo_execution_audit where intent_id=$1',[id])).rows[0].n,4);
  await reader.query('reset role;set role authenticated');
  await assert.rejects(reserve(reader),/permission denied/);
  console.log('PASS local PostgreSQL migrations, worker permissions, kill switch, competing reservations and submissions, disconnect rollback, settlement and restart durability.');
} finally {
  for(const client of clients)await close(client);
  if(running)await pg.stop();
  await rm(directory,{recursive:true,force:true});
}
