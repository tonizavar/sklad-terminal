const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const {PGlite}=require('@electric-sql/pglite');
const {pgcrypto}=require('@electric-sql/pglite/contrib/pgcrypto');
const fs=require('node:fs');let db,owner,employee;
const PIN='739251',TERMINAL='synthetic-registration-terminal';
async function rpc(sql,args=[]){return(await db.query(sql,args)).rows[0].data;}
async function headers(token=null,source='synthetic-source'){await db.query("select set_config('request.headers',$1,false)",[JSON.stringify({'x-forwarded-for':source,...token?{'x-operator-session':token}:{}})]);}
async function register(id,pin=PIN){return rpc('select public.scanner_operator_register($1,$2,$3) as data',[id,pin,TERMINAL]);}
before(async()=>{db=new PGlite({extensions:{pgcrypto}});await db.exec('create role anon;create role authenticated;');for(const f of fs.readdirSync('supabase/migrations').filter(f=>f.endsWith('.sql')).sort())await db.exec(fs.readFileSync('supabase/migrations/'+f,'utf8'));await db.query("update scanner_private.operator_config set enabled=true,owner_employee_id='TEST-OWNER',bootstrap_hash=encode(extensions.digest('TEST-BOOTSTRAP','sha256'),'hex'),bootstrap_expires_at=now()+interval '1 hour'");await db.exec('set role anon');});
after(async()=>db.close());
test('self enrollment cannot claim the creator ID or precede creator setup',async()=>{
 await headers();assert.equal((await register('TEST-OWNER')).status,'reserved');assert.equal((await register('TEST-NEW')).status,'owner_required');
 owner=await rpc('select public.scanner_operator_setup($1,$2,$3,$4) as data',['TEST-OWNER',PIN,'TEST-BOOTSTRAP',TERMINAL]);assert.equal(owner.status,'ok');
});
test('a new employee chooses their PIN and gets only operator rights',async()=>{
 await headers();employee=await register('test-new');assert.equal(employee.status,'ok');assert.equal(employee.profile.employee_id,'TEST-NEW');assert.equal(employee.profile.role,'operator');
 await headers(employee.token);assert.equal((await rpc('select public.scanner_operator_session() as data')).profile.employee_id,'TEST-NEW');await rpc('select public.scanner_pull() as data');await assert.rejects(db.query('select public.scanner_owner_audit()'),/OWNER_REQUIRED/);await assert.rejects(db.query("select public.scanner_operator_manage('list')"),/OWNER_REQUIRED/);
});
test('registration cannot replace an existing PIN or reactivate disabled accounts',async()=>{
 await headers();assert.equal((await register('TEST-NEW','857392')).status,'exists');assert.equal((await rpc('select public.scanner_operator_login($1,$2,$3) as data',['TEST-NEW',PIN,TERMINAL])).status,'ok');assert.equal((await rpc('select public.scanner_operator_login($1,$2,$3) as data',['TEST-NEW','857392',TERMINAL])).status,'invalid');
 await headers(owner.token);await rpc("select public.scanner_operator_manage('disable','TEST-NEW') as data");await headers();assert.equal((await register('TEST-NEW','857392')).status,'exists');assert.equal((await rpc('select public.scanner_operator_login($1,$2,$3) as data',['TEST-NEW',PIN,TERMINAL])).status,'invalid');
});
test('invalid input is rejected and registration is audited without PIN disclosure',async()=>{
 assert.equal((await register('BAD ID')).status,'invalid');assert.equal((await register('TEST-BAD','12')).status,'invalid_pin');
 await headers(owner.token);const audit=await rpc("select public.scanner_owner_audit('TEST-NEW') as data");assert.equal(audit.filter(row=>row.action==='operator_register').length,1);assert.ok(!JSON.stringify(audit).includes(PIN));
 await assert.rejects(db.query('select * from scanner_private.operator_registration_attempts'),/permission denied/);
 await db.exec('reset role');const row=(await db.query("select pin_hash,role from scanner_private.operators where employee_id='TEST-NEW'")).rows[0];assert.ok(row.pin_hash.startsWith('$2'));assert.notEqual(row.pin_hash,PIN);assert.equal(row.role,'operator');await db.exec('set role anon');
});
test('enrollment has its own source rate limit',async()=>{
 await headers(null,'synthetic-rate-limit');for(let i=0;i<10;i++)assert.equal((await register('TEST-OWNER')).status,'reserved');assert.equal((await register('RATE-LIMIT-NEW')).status,'locked');
});
test('failed login after enrollment leaves no unusable claimed ID',async()=>{
 await headers(null,'synthetic-locked-id');for(let i=0;i<5;i++)await rpc('select public.scanner_operator_login($1,$2,$3) as data',['TEST-GUESSED','111111',TERMINAL]);assert.equal((await register('TEST-GUESSED')).status,'locked');
 await db.exec('reset role');assert.equal((await db.query("select count(*)::int as n from scanner_private.operators where employee_id='TEST-GUESSED'")).rows[0].n,0);await db.exec('set role anon');
});
