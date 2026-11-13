const {test,before,after}=require('node:test');const assert=require('node:assert/strict');
const {PGlite}=require('@electric-sql/pglite');const {pgcrypto}=require('@electric-sql/pglite/contrib/pgcrypto');
const fs=require('node:fs');const crypto=require('node:crypto');let db,owner,staff;
const BOOTSTRAP='synthetic-setup-token-for-tests-only';const OWNER='TEST-OWNER',STAFF='TEST-STAFF',PIN='739251',TERMINAL='test-terminal-operator';
async function token(value){await db.query("select set_config('request.headers',$1,false)",[JSON.stringify(value?{'x-operator-session':value}:{})]);}
async function rpc(sql,args=[]){return(await db.query(sql,args)).rows[0]?.data;}
async function login(id=OWNER,pin=PIN){return rpc('select public.scanner_operator_login($1,$2,$3) as data',[id,pin,TERMINAL]);}
function proof(session,id,changes){const payload=JSON.stringify({id,kind:'device_operation',employee_id:session.profile.employee_id,session_id:session.profile.session_id,terminal:TERMINAL,captured_at:new Date().toISOString(),changes});const key=crypto.createHash('sha256').update(session.token).digest();return{payload,signature:crypto.createHmac('sha256',key).update(payload).digest('hex')};}
async function apply(session,id,changes,alter={}){const signed={...proof(session,id,changes),...alter};return rpc("select public.scanner_apply($1,$2::jsonb,'[]'::jsonb,$3,$4::uuid,$5,$6) as data",[id,JSON.stringify(changes),TERMINAL,session.profile.session_id,signed.payload,signed.signature]);}
function change(id,serial,before,after){return{serial,before,after:after&&{...after,serial,version:`${id}:${serial}`,last_move:new Date().toISOString()},action:'Untrusted client label',worker:after?.holder||'',ts:new Date().toISOString()};}
before(async()=>{db=new PGlite({extensions:{pgcrypto}});await db.exec('create role anon;create role authenticated;');for(const file of fs.readdirSync('supabase/migrations').filter(f=>f.endsWith('.sql')).sort())await db.exec(fs.readFileSync('supabase/migrations/'+file,'utf8'));
await db.query("update scanner_private.operator_config set enabled=true,owner_employee_id=$1,bootstrap_hash=encode(extensions.digest($2,'sha256'),'hex'),bootstrap_expires_at=now()+interval '1 hour'",[OWNER,BOOTSTRAP]);await db.exec('set role anon');});
after(async()=>db.close());
test('first owner setup requires both configured ID and one-use secret',async()=>{
 const bad=await rpc('select public.scanner_operator_setup($1,$2,$3,$4) as data',[OWNER,PIN,'wrong',TERMINAL]);assert.equal(bad.status,'setup_denied');
 owner=await rpc('select public.scanner_operator_setup($1,$2,$3,$4) as data',[OWNER,PIN,BOOTSTRAP,TERMINAL]);assert.equal(owner.status,'ok');assert.equal(owner.profile.role,'owner');assert.equal(owner.token.length,64);
 assert.equal((await rpc('select public.scanner_operator_setup($1,$2,$3,$4) as data',[OWNER,PIN,BOOTSTRAP,TERMINAL])).status,'setup_denied');
});
test('anonymous reads and old unsigned mutations are denied after setup',async()=>{
 await token(null);assert.deepEqual((await db.query('select serial from public.devices')).rows,[]);await assert.rejects(db.query('select public.scanner_pull()'),/LOGIN_REQUIRED/);
 await assert.rejects(db.query("select public.scanner_apply('unsigned-operation','[]'::jsonb,'[]'::jsonb,$1)",[TERMINAL]),/PROOF_REQUIRED/);
 await assert.rejects(db.query('select * from scanner_private.operators'),/permission denied/);
});
test('only owner can create operators; raw PIN and session tokens are not stored',async()=>{
 await token(owner.token);assert.equal((await rpc("select public.scanner_operator_manage('create',$1,'Test employee',$2) as data",[STAFF,PIN])).status,'ok');
 await db.exec('reset role');const rows=(await db.query('select pin_hash from scanner_private.operators')).rows;assert.ok(rows.every(row=>row.pin_hash!==PIN&&row.pin_hash.startsWith('$2')));await db.exec('set role anon');
 staff=await login(STAFF);assert.equal(staff.status,'ok');await token(staff.token);await assert.rejects(db.query("select public.scanner_operator_manage('list')"),/OWNER_REQUIRED/);await assert.rejects(db.query('select public.scanner_owner_audit()'),/OWNER_REQUIRED/);await assert.rejects(db.query("select public.scanner_backup('create')"),/OWNER_REQUIRED/);
});
test('signed operations attribute the PIN-verified employee and record factual before/after',async()=>{
 await token(owner.token);const id='owner-create-verified';const c=change(id,'AUDIT-TEST',null,{model:'Point Mobile',status:'free',holder:'',issued_at:null,defect:''});assert.equal((await apply(owner,id,[c])).status,'applied');
 await token(staff.token);const before=(await db.query("select * from public.devices where serial='AUDIT-TEST'")).rows[0];const issue='staff-issue-verified';const changes=[change(issue,'AUDIT-TEST',{...before,holder:'FAKE-BEFORE'},{...before,status:'issued',holder:'TEST-RECIPIENT',issued_at:new Date().toISOString()})];
 assert.equal((await apply(staff,issue,changes)).status,'applied');assert.equal((await apply(staff,issue,changes)).status,'applied');
 const moves=(await db.query("select operator_employee_id from public.movements where serial='AUDIT-TEST' order by id")).rows;assert.equal(moves.length,2);assert.equal(moves[1].operator_employee_id,STAFF);
 await token(owner.token);const audit=await rpc('select public.scanner_owner_audit($1) as data',[STAFF]);const event=audit.find(row=>row.action==='issue');assert.equal(event.details.before.holder,'');assert.equal(event.details.after.holder,'TEST-RECIPIENT');assert.equal(audit.filter(row=>row.action==='issue').length,1);
});
test('changing author or content invalidates an operation signature',async()=>{
 await token(staff.token);const before=(await db.query("select * from public.devices where serial='AUDIT-TEST'")).rows[0];const id='tamper-operation';const changes=[change(id,'AUDIT-TEST',before,{...before,status:'free',holder:'',issued_at:null})];const signed=proof(staff,id,changes);const payload=JSON.parse(signed.payload);payload.employee_id=OWNER;
 await assert.rejects(apply(staff,id,changes,{payload:JSON.stringify(payload),signature:signed.signature}),/INVALID_OPERATOR_PROOF/);
});
test('logout revokes live access but preserves previously signed offline author proof',async()=>{
 await token(staff.token);const before=(await db.query("select * from public.devices where serial='AUDIT-TEST'")).rows[0];const id='offline-before-logout';const changes=[change(id,'AUDIT-TEST',before,{...before,status:'free',holder:'',issued_at:null})];const signed=proof(staff,id,changes);
 await rpc('select public.scanner_operator_logout() as data');await assert.rejects(db.query('select public.scanner_pull()'),/LOGIN_REQUIRED/);
 await token(owner.token);assert.equal((await apply(staff,id,changes,signed)).status,'applied');const events=await rpc('select public.scanner_owner_audit($1) as data',[STAFF]);assert.equal(events.find(e=>e.action==='return').operator_employee_id,STAFF);
});
test('PIN guessing is limited and failures are audited without the PIN',async()=>{
 await token(null);for(let i=0;i<5;i++)assert.equal((await login('TEST-UNKNOWN','111111')).status,'invalid');assert.equal((await login('TEST-UNKNOWN','111111')).status,'locked');
 await token(owner.token);const rows=await rpc('select public.scanner_owner_audit($1) as data',['TEST-UNKNOWN']);assert.equal(rows.filter(e=>e.outcome==='denied').length,5);assert.ok(!JSON.stringify(rows).includes('111111'));
});
test('disabled employee cannot log in and historical author remains visible',async()=>{
 await token(owner.token);await rpc("select public.scanner_operator_manage('disable',$1) as data",[STAFF]);assert.equal((await login(STAFF)).status,'invalid');const rows=await rpc('select public.scanner_owner_audit($1) as data',[STAFF]);assert.ok(rows.some(row=>row.action==='issue'));
});
test('signed export events survive logout and cannot be edited or duplicated',async()=>{
 await token(owner.token);const payload=JSON.stringify({id:'export-event-verified',kind:'client_action',employee_id:OWNER,session_id:owner.profile.session_id,terminal:TERMINAL,captured_at:new Date().toISOString(),action:'report_export',details:{rows:3}});
 const key=crypto.createHash('sha256').update(owner.token).digest(),signature=crypto.createHmac('sha256',key).update(payload).digest('hex');
 await token(null);for(let i=0;i<2;i++)assert.equal((await rpc('select public.scanner_record_signed_action($1,$2,$3) as data',[owner.profile.session_id,payload,signature])).status,'applied');
 await token(owner.token);const rows=await rpc('select public.scanner_owner_audit($1) as data',[OWNER]);assert.equal(rows.filter(e=>e.action==='report_export').length,1);
 await assert.rejects(db.query('delete from scanner_private.audit_events'),/permission denied/);
});
test('logical backups contain audit and author metadata without PIN hashes or session tokens',async()=>{
 await token(owner.token);const backup=(await rpc("select public.scanner_backup('create') as data"));
 const snapshot=await rpc("select public.scanner_backup('download',$1) as data",[backup.name]);assert.ok(Array.isArray(snapshot.audit_events));assert.ok(Array.isArray(snapshot.operators));assert.ok(!JSON.stringify(snapshot).includes('pin_hash'));assert.ok(!JSON.stringify(snapshot).includes(owner.token));
});
