import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';

test('PostgreSQL reservations and audit commit or roll back together', async t => {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec('create role anon; create role authenticated; create role service_role;');
  for (const name of ['schema','hardening','atomic_transition','reserve']) {
    await db.exec(await readFile('backend/deriv_execution/'+name+'.sql','utf8'));
  }
  const record = {account_id:'demo-A',account_mode:'demo',idempotency_key:'fixture-key',
    status:'reserved',strategy_id:'strategy',symbol:'R_100',contract_type:'CALL',stake:1};
  const reserve = data => db.query('select public.playgo_reserve_demo($1) as result',[JSON.stringify(data)]);
  const [{result}] = (await reserve(record)).rows;
  assert.equal(result.audited,true);
  await assert.rejects(reserve({...record,idempotency_key:'second-intent'}),/unique/i);
  await assert.rejects(reserve({...record,account_id:'demo-B'}),/unique/i);
  await db.query("select public.playgo_atomic_demo_transition($1,'submit',null)",[result.id]);
  await assert.rejects(db.query("select public.playgo_atomic_demo_transition($1,'submit',null)",[result.id]),/INVALID_EXECUTION_TRANSITION/);
  await assert.rejects(db.exec('delete from public.playgo_execution_audit'),/append only/);
  await db.exec("alter table public.playgo_execution_audit add constraint inject_failure check(event_type <> 'DEMO_INTENT_RESERVED') not valid");
  await assert.rejects(reserve({...record,idempotency_key:'rollback',account_id:'demo-B'}),/inject_failure/);
  assert.equal((await db.query('select count(*)::int as n from public.playgo_execution_intents')).rows[0].n,1);
  await db.exec('set role authenticated');
  await assert.rejects(reserve(record),/permission denied/);
});

test('durable demo controls guard reservation, submission and settlement',async t=>{
  const db=new PGlite();
  t.after(()=>db.close());
  await db.exec('create role anon; create role authenticated; create role service_role bypassrls;');
  for(const name of ['schema','hardening','atomic_transition','reserve','risk_controls'])
    await db.exec(await readFile('backend/deriv_execution/'+name+'.sql','utf8'));
  await db.exec('grant select,insert,update on playgo_execution_intents to service_role; grant select,insert on playgo_execution_audit to service_role; grant usage on all sequences in schema public to service_role');
  const record={account_id:'demoA',account_mode:'demo',status:'reserved',strategy_id:'a',symbol:'R_100',contract_type:'CALL',stake:1,idempotency_key:'risk-test'};
  const reserve=()=>db.query('select playgo_reserve_demo($1) as r',[JSON.stringify(record)]);
  await db.exec('set role service_role');
  await assert.rejects(reserve(),/ACCOUNT_PAUSED/);
  const pause=async paused=>{
    await db.exec('reset role');
    await db.query("insert into playgo_demo_controls values('demoA',$1) on conflict(account_id) do update set paused=excluded.paused",[paused]);
    await db.exec('set role service_role');
  };
  await pause(false);
  const id=(await reserve()).rows[0].r.id;
  const transition=(event,contract=null)=>db.query('select playgo_atomic_demo_transition($1,$2,$3)',[id,event,contract]);
  await pause(true);
  await assert.rejects(transition('submit'),/ACCOUNT_PAUSED/);
  await pause(false);
  await transition('submit');
  await transition('confirm','123');
  await assert.rejects(transition('settle','123'),/MISSING_SETTLEMENT/);
  await db.query("select playgo_settle_bound_demo($1,'123',1,0, floor(extract(epoch from now()))::bigint)",[id]);
  assert.equal((await db.query('select proceeds-cost as pnl from playgo_demo_settlements')).rows[0].pnl,'-1');
  record.idempotency_key='next';
  await assert.rejects(reserve(),/COOLDOWN/);
  await assert.rejects(db.exec('update playgo_demo_controls set paused=false'),/permission denied/);
});
