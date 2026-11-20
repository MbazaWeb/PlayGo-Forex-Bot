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
