const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const crypto=require('node:crypto');
const {PGlite}=require('@electric-sql/pglite');
const {pgcrypto}=require('@electric-sql/pglite/contrib/pgcrypto');

const ownerId='PIN-OWNER', employeeId='ID-ONLY-EMPLOYEE', terminal='test-migration-post', pin='739251';
const migrationPrefix='20261114190759';
let db, owner, oldOwner, oldEmployee, oldPayload, oldSignature, oldChanges, oldDevicePayload, oldDeviceSignature;
async function rpc(sql,args=[]){return (await db.query(sql,args)).rows[0]?.data;}
async function headers(token){await db.query("select set_config('request.headers',$1,false)",[JSON.stringify(token?{'x-operator-session':token}:{})]);}
const login=(id,pin)=>rpc('select public.scanner_operator_login($1,$2,$3) as data',[id,pin,terminal]);
const enroll=(id,pin)=>rpc('select public.scanner_operator_register($1,$2,$3) as data',[id,pin,terminal]);
function sign(token,payload){return crypto.createHmac('sha256',crypto.createHash('sha256').update(token).digest()).update(payload).digest('hex');}

before(async()=>{
 db=new PGlite({extensions:{pgcrypto}});
 await db.exec('create role anon;create role authenticated;');
 const migrations=fs.readdirSync('supabase/migrations').filter(name=>name.endsWith('.sql')).sort();
 for(const name of migrations.filter(name=>name<migrationPrefix))await db.exec(fs.readFileSync('supabase/migrations/'+name,'utf8'));
 await db.query("update scanner_private.operator_config set enabled=true, owner_employee_id=$1,bootstrap_hash=encode(extensions.digest('synthetic-setup','sha256'),'hex'),bootstrap_expires_at=now()+interval '1 hour'",[ownerId]);
 await db.exec('set role anon');
 owner=await rpc('select public.scanner_operator_setup($1,$2,$3,$4) as data',[ownerId,pin,'synthetic-setup',terminal]);
 const oldLogin=id=>rpc('select public.scanner_operator_id_login($1,$2) as data',[id,terminal]);
 oldOwner=await oldLogin(ownerId);oldEmployee=await oldLogin(employeeId);
 await oldLogin('ID-RESET');await oldLogin('ID-DISABLED');
 await headers(owner.token);
 await rpc("select public.scanner_operator_manage('reset_pin','ID-RESET',null,$1) as data",[pin]);
 await rpc("select public.scanner_operator_manage('disable','ID-DISABLED') as data");
 oldPayload=JSON.stringify({id:'audit-pre-pin-migration',kind:'client_action',employee_id:ownerId,session_id:oldOwner.profile.session_id,terminal,captured_at:new Date().toISOString(),action:'report_export',details:{rows:1}});
 oldSignature=sign(oldOwner.token,oldPayload);
 const id='offline-before-pin-migration', serial='TEST-PIN-SCANNER', now=new Date().toISOString();
 oldChanges=[{serial,before:null,after:{serial,version:`${id}:${serial}`,model:'Point Mobile',status:'free',holder:'',shift:'—',issued_at:null,last_move:now,defect:''},action:'Импорт в парк',worker:'',ts:now}];
 oldDevicePayload=JSON.stringify({id,kind:'device_operation',employee_id:ownerId,session_id:oldOwner.profile.session_id,terminal,captured_at:now,changes:oldChanges});
 oldDeviceSignature=sign(oldOwner.token,oldDevicePayload);
 await db.exec('reset role');
 for(const name of migrations.filter(name=>name>=migrationPrefix))await db.exec(fs.readFileSync('supabase/migrations/'+name,'utf8'));
 await db.exec('set role anon');await headers(null);
});
after(async()=>{await db?.close();});

test('PIN migration revokes live ID-only sessions but accepts old signed packets once',async()=>{
 for(const previous of [oldEmployee,oldOwner]){
  await headers(previous.token);
  assert.equal((await rpc('select public.scanner_operator_session() as data')).profile,null);
  await assert.rejects(db.query('select public.scanner_pull()'),/LOGIN_REQUIRED/);
 }
 await headers(owner.token);
 for(let retry=0;retry<2;retry++){
  assert.equal((await rpc('select public.scanner_record_signed_action($1,$2,$3) as data',[oldOwner.profile.session_id,oldPayload,oldSignature])).status,'applied');
  const result=await rpc("select public.scanner_apply($1,$2::jsonb,'[]'::jsonb,$3,$4,$5,$6) as data",['offline-before-pin-migration',JSON.stringify(oldChanges),terminal,oldOwner.profile.session_id,oldDevicePayload,oldDeviceSignature]);
  assert.equal(result.status,'applied');
 }
 const rows=await rpc('select public.scanner_owner_audit($1) as data',[ownerId]);
 assert.equal(rows.filter(row=>row.action==='report_export').length,1);
 const moves=(await db.query("select operator_employee_id from public.movements where serial='TEST-PIN-SCANNER'")).rows;
 assert.deepEqual(moves,[{operator_employee_id:ownerId}]);
});

test('first PIN changes an eligible ID only once and preserves creator, reset and disabled access',async()=>{
 await headers(null);
 assert.equal((await enroll(ownerId,'781045')).status,'reserved');
 assert.equal((await enroll('ID-RESET','781045')).status,'exists');
 assert.equal((await enroll('ID-DISABLED','781045')).status,'exists');
 const enrolled=await enroll(employeeId,'781045');assert.equal(enrolled.status,'ok');assert.equal(enrolled.profile.role,'operator');
 assert.equal((await enroll(employeeId,'518204')).status,'exists');
 assert.equal((await login(employeeId,'518204')).status,'invalid');
 assert.equal((await login(employeeId,'781045')).status,'ok');
 assert.equal((await login(ownerId,pin)).status,'ok');
});

test('authenticated posts report their server time and only the creator can manage names',async()=>{
 await headers(null);await assert.rejects(db.query('select public.scanner_workstation_heartbeat()'),/LOGIN_REQUIRED/);
 const employee=await login(employeeId,'781045');await headers(employee.token);
 await rpc('select public.scanner_workstation_heartbeat() as data');
 await assert.rejects(db.query('select public.scanner_manage_workstations()'),/OWNER_REQUIRED/);
 await assert.rejects(db.query('select * from scanner_private.workstations'),/permission denied/);
 await headers(owner.token);
 const list=await rpc('select public.scanner_manage_workstations() as data');
 assert.equal(list[0].terminal_id,terminal);assert.equal(list[0].employee_id,employeeId);assert.ok(Date.parse(list[0].last_seen_at));
 const named=await rpc('select public.scanner_manage_workstations($1,$2) as data',[terminal,'Приёмка']);
 assert.equal(named[0].label,'Приёмка');assert.equal(named[0].last_seen_at,list[0].last_seen_at);
});
