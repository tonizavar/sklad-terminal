const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { PGlite } = require('@electric-sql/pglite');
const fs = require('node:fs');
let db;
async function asClient(role='anon') { await db.exec('reset role'); await db.exec(`set role ${role}`); }
const state=(serial,status='free',holder='',version='initial')=>({serial,status,holder,version,model:'Point Mobile',shift:'Дневная',issued_at:status==='issued'?'2026-11-13T06:00:00Z':null,last_move:'2026-11-13T06:00:00Z',defect:''});
async function apply(id, changes) {
  return (await db.query("select public.scanner_apply($1,$2::jsonb,'[]'::jsonb,'test-terminal-01') as result",[id,JSON.stringify(changes)])).rows[0].result;
}
const change=(id,sn,before,after)=>({serial:sn,before,after:after&&{...after,version:`${id}:${sn}`},action:'Test operation',worker:'TEST-WORKER',ts:'2026-11-13T06:00:00Z'});
before(async()=>{
  db=new PGlite(); await db.exec('create role anon; create role authenticated;');
  for(const file of fs.readdirSync('supabase/migrations').filter(f=>f.endsWith('.sql')).sort()) await db.exec(fs.readFileSync('supabase/migrations/'+file,'utf8'));
  await db.query('insert into public.devices(serial,model,status,holder,version) values($1,$2,$3,$4,$5),($6,$2,$7,$8,$5)', ['TEST-A','Point Mobile','issued','TEST-WORKER','initial','TEST-B','free','']);
});
after(async()=>{await db.close()});
test('shared inventory is readable without an account',async()=>{
  await asClient(); assert.equal((await db.query('select * from public.devices')).rows.length,2);
});
test('direct writes and access to private history/backup tables remain denied',async()=>{
  await asClient();
  await assert.rejects(db.query("update public.devices set holder='ATTACKER'"),/permission denied/);
  await assert.rejects(db.query('delete from public.movements'),/permission denied/);
  await assert.rejects(db.query('select * from scanner_private.operations'),/permission denied/);
  await assert.rejects(db.query('select * from scanner_private.backups'),/permission denied/);
  await assert.rejects(db.query('select scanner_private.create_backup()'),/permission denied/);
});
test('stale swap changes neither scanner and creates no journal event',async()=>{
  await asClient(); const id='conflict-operation';
  const changes=[change(id,'TEST-A',state('TEST-A','issued','TEST-WORKER','stale'),state('TEST-A')),change(id,'TEST-B',state('TEST-B'),state('TEST-B','issued','TEST-WORKER'))];
  const result=await apply(id,changes); assert.equal(result.status,'conflict');assert.deepEqual(result.serials,['TEST-A']);
  assert.deepEqual((await db.query('select serial,status from public.devices order by serial')).rows,[{serial:'TEST-A',status:'issued'},{serial:'TEST-B',status:'free'}]);
  assert.equal((await db.query('select count(*)::int as n from public.movements')).rows[0].n,0);
});
test('swap is atomic, repair reason survives, retry is idempotent and terminal is recorded',async()=>{
  await asClient(); const id='swap-operation-01';
  const changes=[change(id,'TEST-A',state('TEST-A','issued','TEST-WORKER'),{...state('TEST-A','repair'),defect:'TEST BATTERY FAILURE'}),change(id,'TEST-B',state('TEST-B'),state('TEST-B','issued','TEST-WORKER'))];
  assert.equal((await apply(id,changes)).status,'applied');assert.equal((await apply(id,changes)).status,'applied');
  const rows=(await db.query('select serial,status,defect from public.devices order by serial')).rows;
  assert.equal(rows[0].defect,'TEST BATTERY FAILURE');assert.equal(rows[1].status,'issued');
  const events=(await db.query('select operator_id,terminal_id from public.movements')).rows;
  assert.equal(events.length,2);assert.equal(events[0].operator_id,null);assert.equal(events[0].terminal_id,'test-terminal-01');
  await assert.rejects(apply(id,[change(id,'TEST-A',state('TEST-A'),state('TEST-A'))]),/identifier reused/);
});
test('shared retirement preserves audit history',async()=>{
  await asClient(); const before=state('TEST-A','repair','','swap-operation-01:TEST-A');
  assert.equal((await apply('retire-operation',[change('retire-operation','TEST-A',before,null)])).status,'applied');
  assert.ok((await db.query("select deleted_at from public.devices where serial='TEST-A'")).rows[0].deleted_at);
  assert.equal((await db.query('select count(*)::int as n from public.movements')).rows[0].n,3);
});
test('backup names are unique, journal retained, and public create is throttled',async()=>{
  await db.exec('reset role');
  const a=(await db.query('select scanner_private.create_backup() as b')).rows[0].b;
  const b=(await db.query('select scanner_private.create_backup() as b')).rows[0].b;
  assert.notEqual(a.name,b.name);await asClient();
  const snapshot=(await db.query("select public.scanner_backup('download',$1) as b",[a.name])).rows[0].b;
  assert.equal(snapshot.devices.length,1);assert.equal(snapshot.movements.length,3);
  const first=(await db.query("select public.scanner_backup('create') as b")).rows[0].b;
  const retry=(await db.query("select public.scanner_backup('create') as b")).rows[0].b;
  assert.equal(first.name,retry.name);
});
test('removing a backup from the list does not erase its snapshot',async()=>{
  await asClient(); const files=(await db.query("select public.scanner_backup('list') as b")).rows[0].b;
  await db.query("select public.scanner_backup('delete',$1)",[files[0].name]);
  assert.ok(!(await db.query("select public.scanner_backup('list') as b")).rows[0].b.some(f=>f.name===files[0].name));
  assert.equal((await db.query("select public.scanner_backup('download',$1) as b",[files[0].name])).rows[0].b.version,12);
});
test('delta cursor returns changed records, tombstones and resets after database rollback',async()=>{
  await asClient();const first=(await db.query('select public.scanner_pull(0) as result')).rows[0].result;
  assert.equal(first.full,true);assert.equal(first.devices.length,2);assert.ok(first.devices.find(d=>d.serial==='TEST-A').deleted_at);
  const empty=(await db.query('select public.scanner_pull($1) as result',[first.cursor])).rows[0].result;assert.equal(empty.full,false);assert.deepEqual(empty.devices,[]);
  const current=(await db.query("select * from public.devices where serial='TEST-B'")).rows[0];const id='delta-operation-01';
  assert.equal((await apply(id,[change(id,'TEST-B',current,{...current,status:'free',holder:'',issued_at:null})])).status,'applied');
  const delta=(await db.query('select public.scanner_pull($1) as result',[first.cursor])).rows[0].result;
  assert.equal(delta.devices.length,1);assert.equal(delta.devices[0].serial,'TEST-B');assert.ok(delta.cursor>first.cursor);
  assert.equal((await db.query('select public.scanner_pull($1) as result',[delta.cursor+100])).rows[0].result.full,true);
});
test('different scanners cannot be assigned to the same worker',async()=>{
  await asClient();const current=(await db.query("select * from public.devices where serial='TEST-B'")).rows[0];const issue='worker-issue-001';
  assert.equal((await apply(issue,[change(issue,'TEST-B',current,state('TEST-B','issued','TEST-ONE-WORKER'))])).status,'applied');
  const second='worker-issue-002';assert.equal((await apply(second,[change(second,'TEST-C',null,state('TEST-C','issued','TEST-ONE-WORKER'))])).status,'conflict');
  assert.equal((await db.query("select * from public.devices where serial='TEST-C'")).rows.length,0);
});
test('public RPC wrappers are invokers and private tables use RLS',async()=>{
  await db.exec('reset role');
  const functions=(await db.query("select p.proname,p.prosecdef from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'scanner_%'")).rows;
  assert.ok(functions.length>=3);assert.ok(functions.every(f=>!f.prosecdef));
  const tables=(await db.query("select relrowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='scanner_private' and c.relname in ('operations','backups')")).rows;assert.ok(tables.every(t=>t.relrowsecurity));
});

test('legacy SN; serial can be updated atomically without renaming',async()=>{
  await asClient();const id='legacy-prefix-operation';const sn='SN;TEST-LEGACY-001';
  assert.equal((await apply(id,[change(id,sn,null,state(sn))])).status,'applied');
  assert.equal((await db.query('select serial from public.devices where serial=$1',[sn])).rows[0].serial,sn);
});
