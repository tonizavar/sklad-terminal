const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { PGlite } = require('@electric-sql/pglite');
const fs = require('node:fs');
let db;
const admin='00000000-0000-4000-8000-000000000001';
const operator='00000000-0000-4000-8000-000000000002';
const outsider='00000000-0000-4000-8000-000000000003';
async function as(uid, role='authenticated') {
  await db.exec('reset role');
  await db.query("select set_config('request.jwt.claim.sub',$1,false)",[uid||'']);
  await db.exec(`set role ${role}`);
}
const state=(serial,status='free',holder='',version='initial')=>({serial,status,holder,version,model:'Point Mobile',shift:'Дневная',issued_at:status==='issued'?'2026-11-13T06:00:00Z':null,last_move:'2026-11-13T06:00:00Z',defect:''});
async function apply(id, changes) {
  return (await db.query("select public.scanner_apply($1,$2::jsonb,'[]'::jsonb,'test-terminal-01') as result",[id,JSON.stringify(changes)])).rows[0].result;
}
const change=(id,sn,before,after)=>({serial:sn,before,after:after&&{...after,version:`${id}:${sn}`},action:'Test operation',worker:'TEST-WORKER',ts:'2026-11-13T06:00:00Z'});
before(async()=>{
  db=new PGlite();
  await db.exec(`create role anon; create role authenticated; create schema auth;
    create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema auth to authenticated; grant execute on function auth.uid() to authenticated;`);
  await db.query('insert into auth.users values($1),($2),($3)',[admin,operator,outsider]);
  await db.exec("create schema scanner_private; create table scanner_private.members(user_id uuid primary key references auth.users(id), role text not null check(role in ('operator','admin')));");
  await db.query("insert into scanner_private.members values($1,'admin'),($2,'operator')",[admin,operator]);
  await db.exec(fs.readFileSync('supabase/migrations/20261113103823_harden_scanner_access.sql','utf8'));
  await db.query('insert into public.devices(serial,model,status,holder,version) values($1,$2,$3,$4,$5),($6,$2,$7,$8,$5)', ['TEST-A','Point Mobile','issued','TEST-WORKER','initial','TEST-B','free','']);
});
after(async()=>{await db.close()});
test('anonymous and unassigned accounts cannot read inventory or call mutations',async()=>{
  await as(null,'anon');
  await assert.rejects(db.query('select * from public.devices'),/permission denied/);
  await assert.rejects(db.query('select public.scanner_session()'),/permission denied/);
  await as(outsider);
  assert.equal((await db.query('select * from public.devices')).rows.length,0);
  await assert.rejects(db.query('select public.scanner_session()'),/SCANNER_ACCESS_REQUIRED/);
});
test('operator can read but cannot directly overwrite records or delete backups',async()=>{
  await as(operator);
  assert.equal((await db.query('select * from public.devices')).rows.length,2);
  await assert.rejects(db.query("update public.devices set holder='ATTACKER'"),/permission denied/);
  await assert.rejects(db.query("select public.scanner_backup('create')"),/ADMIN_REQUIRED/);
  await assert.rejects(db.query('select scanner_private.create_backup()'),/permission denied/);
});
test('stale swap changes neither scanner and creates no journal event',async()=>{
  await as(operator);
  const id='conflict-operation';
  const changes=[change(id,'TEST-A',state('TEST-A','issued','TEST-WORKER','stale'),state('TEST-A')),change(id,'TEST-B',state('TEST-B'),state('TEST-B','issued','TEST-WORKER'))];
  const result=await apply(id,changes);
  assert.equal(result.status,'conflict');
  assert.deepEqual(result.serials,['TEST-A']);
  const rows=(await db.query('select serial,status from public.devices order by serial')).rows;
  assert.deepEqual(rows,[{serial:'TEST-A',status:'issued'},{serial:'TEST-B',status:'free'}]);
  assert.equal((await db.query('select count(*)::int as n from public.movements')).rows[0].n,0);
});
test('swap is atomic, repair reason survives, network retry is idempotent',async()=>{
  await as(operator);
  const id='swap-operation-01';
  const changes=[change(id,'TEST-A',state('TEST-A','issued','TEST-WORKER'),{...state('TEST-A','repair'),defect:'TEST BATTERY FAILURE'}),change(id,'TEST-B',state('TEST-B'),state('TEST-B','issued','TEST-WORKER'))];
  assert.equal((await apply(id,changes)).status,'applied');
  assert.equal((await apply(id,changes)).status,'applied');
  const rows=(await db.query('select serial,status,defect from public.devices order by serial')).rows;
  assert.equal(rows[0].defect,'TEST BATTERY FAILURE');assert.equal(rows[1].status,'issued');
  const events=(await db.query('select operator_id,terminal_id from public.movements')).rows;
  assert.equal(events.length,2);assert.equal(events[0].operator_id,operator);assert.equal(events[0].terminal_id,'test-terminal-01');
  await assert.rejects(apply(id,[change(id,'TEST-A',state('TEST-A'),state('TEST-A'))]),/identifier reused/);
});
test('operator cannot retire a scanner; admin retirement preserves audit history',async()=>{
  const before=state('TEST-A','repair','','swap-operation-01:TEST-A');
  await as(operator);
  await assert.rejects(apply('retire-operation',[change('retire-operation','TEST-A',before,null)]),/ADMIN_REQUIRED/);
  await as(admin);
  assert.equal((await apply('retire-operation',[change('retire-operation','TEST-A',before,null)])).status,'applied');
  assert.ok((await db.query("select deleted_at from public.devices where serial='TEST-A'")).rows[0].deleted_at);
  assert.equal((await db.query('select count(*)::int as n from public.movements')).rows[0].n,3);
});
test('backup names are unique and include journal without deleted inventory',async()=>{
  await as(admin);
  const a=(await db.query("select public.scanner_backup('create') as b")).rows[0].b;
  const b=(await db.query("select public.scanner_backup('create') as b")).rows[0].b;
  assert.notEqual(a.name,b.name);
  const snapshot=(await db.query("select public.scanner_backup('download',$1) as b",[a.name])).rows[0].b;
  assert.equal(snapshot.devices.length,1);assert.equal(snapshot.movements.length,3);
});
test('revoked membership takes effect immediately without trusting JWT metadata',async()=>{
  await db.exec('reset role');
  await db.query('delete from scanner_private.members where user_id=$1',[operator]);
  await as(operator);
  assert.equal((await db.query('select * from public.devices')).rows.length,0);
  await assert.rejects(db.query('select public.scanner_session()'),/SCANNER_ACCESS_REQUIRED/);
});
test('delta cursor returns only changed records and carries tombstones',async()=>{
  await as(admin);
  const first=(await db.query('select public.scanner_pull(0) as result')).rows[0].result;
  assert.equal(first.full,true);assert.equal(first.devices.length,2);
  const empty=(await db.query('select public.scanner_pull($1) as result',[first.cursor])).rows[0].result;
  assert.equal(empty.full,false);assert.deepEqual(empty.devices,[]);
  const current=(await db.query("select * from public.devices where serial='TEST-B'")).rows[0];
  const id='delta-operation-01';
  assert.equal((await apply(id,[change(id,'TEST-B',current,{...current,status:'free',holder:'',issued_at:null})])).status,'applied');
  const delta=(await db.query('select public.scanner_pull($1) as result',[first.cursor])).rows[0].result;
  assert.equal(delta.devices.length,1);assert.equal(delta.devices[0].serial,'TEST-B');assert.ok(delta.cursor>first.cursor);
  const reset=(await db.query('select public.scanner_pull($1) as result',[delta.cursor+100])).rows[0].result;
  assert.equal(reset.full,true);
});
test('different scanners cannot be concurrently assigned to the same worker',async()=>{
  await as(admin);
  const current=(await db.query("select * from public.devices where serial='TEST-B'")).rows[0];
  const issue='worker-issue-001';
  assert.equal((await apply(issue,[change(issue,'TEST-B',current,state('TEST-B','issued','TEST-ONE-WORKER'))])).status,'applied');
  const second='worker-issue-002';
  const result=await apply(second,[change(second,'TEST-C',null,state('TEST-C','issued','TEST-ONE-WORKER'))]);
  assert.equal(result.status,'conflict');
  assert.equal((await db.query("select * from public.devices where serial='TEST-C'")).rows.length,0);
});
test('public RPC wrappers are invokers and private tables have RLS',async()=>{
  await db.exec('reset role');
  const functions=(await db.query("select p.proname,p.prosecdef from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'scanner_%'")).rows;
  assert.ok(functions.length>=6);assert.ok(functions.every(f=>!f.prosecdef));
  const tables=(await db.query("select relrowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='scanner_private' and c.relname in ('members','operations','backups')")).rows;
  assert.ok(tables.every(t=>t.relrowsecurity));
});
