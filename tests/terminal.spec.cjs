const {test,expect}=require('@playwright/test');
const crypto=require('node:crypto');
const TEST_PIN='739251';
const USER='00000000-0000-4000-8000-000000000001';
const fixture=()=>[
 {serial:'TEST-A',model:'Point Mobile',status:'free',holder:'',shift:'—',issued_at:null,last_move:'2026-11-13T06:00:00.000Z',version:'initial',defect:''},
 {serial:'TEST-B',model:'Point Mobile',status:'free',holder:'',shift:'—',issued_at:null,last_move:'2026-11-13T06:00:00.000Z',version:'initial',defect:''}
];
async function setup(page,{role='owner',count=2,configured=true}={}){
 const backend={devices:count===2?fixture():Array.from({length:count},(_,i)=>({...fixture()[0],serial:`TEST-${String(i).padStart(5,'0')}`})),operations:[],online:true,role,configured,audit:[],operators:[]};
 await page.context().route('https://fonts.googleapis.com/**',r=>r.abort());
 await page.context().route('https://sgpkvnymkqwuhepkaoxw.supabase.co/**',async route=>{
  if(!backend.online)return route.abort();
  const req=route.request(),url=new URL(req.url());let body={};
  const profile={employee_id:backend.role==='owner'?'TEST-OWNER':'TEST-STAFF',display_name:'Тестовый сотрудник',role:backend.role,session_id:'00000000-0000-4000-8000-000000000001',expires_at:new Date(Date.now()+3600000).toISOString(),terminal_id:'test-terminal'};
  if(url.pathname.endsWith('/rpc/scanner_operator_register')){const args=req.postDataJSON();backend.registration=args;body=backend.registrationStatus?{status:backend.registrationStatus}:{status:'ok',token:'a'.repeat(64),profile:{...profile,employee_id:args.p_employee_id,role:'operator'}};}
  else if(url.pathname.endsWith('/rpc/scanner_operator_status'))body={configured:backend.configured,setup_ready:true};
  else if(url.pathname.endsWith('/rpc/scanner_operator_login')||url.pathname.endsWith('/rpc/scanner_operator_setup'))body=req.postDataJSON().p_pin===TEST_PIN?{status:'ok',token:'a'.repeat(64),profile}:{status:'invalid'};
  else if(url.pathname.endsWith('/rpc/scanner_operator_session'))body={profile};
  else if(url.pathname.endsWith('/rpc/scanner_operator_logout'))body={status:'ok'};
  else if(url.pathname.endsWith('/rpc/scanner_record_action')){backend.audit.push(req.postDataJSON());body={status:'ok'};}
  else if(url.pathname.endsWith('/rpc/scanner_operator_manage')){const args=req.postDataJSON();if(args.p_action==='list')body=backend.operators;else{backend.operators.push({employee_id:args.p_employee_id,display_name:args.p_name,role:'operator',active:true});body={status:'ok'};}}
  else if(url.pathname.endsWith('/rpc/scanner_record_signed_action')){const op=req.postDataJSON();const payload=JSON.parse(op.p_payload);backend.audit.push(payload);body={status:'applied'};}
  else if(url.pathname.endsWith('/rpc/scanner_owner_audit')){const args=req.postDataJSON();body=backend.audit.filter(e=>!args.p_employee_id||e.operator_employee_id===args.p_employee_id);}
  else if(url.pathname.endsWith('/rpc/scanner_pull'))body={cursor:1,full:true,devices:backend.devices};
  else if(url.pathname.endsWith('/rpc/scanner_apply')){
   const op=req.postDataJSON();backend.operations.push(op);
   const expected=crypto.createHmac('sha256',crypto.createHash('sha256').update('a'.repeat(64)).digest()).update(op.p_payload).digest('hex');
   if(expected!==op.p_signature)throw new Error('Invalid browser signature');
   const conflict=op.p_changes.filter(c=>{const before=backend.devices.find(d=>d.serial===c.serial);return (before?.version||null)!==(c.before?.version||null)});
   if(conflict.length)body={status:'conflict',serials:conflict.map(c=>c.serial)};
   else{for(const c of op.p_changes){backend.devices=backend.devices.filter(d=>d.serial!==c.serial);if(c.after)backend.devices.push(c.after);}body={status:'applied'};}
  }else if(url.pathname.endsWith('/devices')){const after=(url.searchParams.get('serial')||'gt.').slice(3);body=backend.devices.filter(d=>d.serial>after).sort((a,b)=>a.serial.localeCompare(b.serial)).slice(0,Number(url.searchParams.get('limit')||1000));}
  else if(url.pathname.endsWith('/movements'))body=[];
  else if(url.pathname.endsWith('/rpc/scanner_backup'))body=[];
  else throw new Error('Unexpected remote request: '+req.url());
  await route.fulfill({json:body});
 });
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('/');
 return {backend,errors};
}
async function login(page){
 if(await page.locator('#operatorPanel').isVisible()){
  await page.locator('#operatorEmployeeId').fill('TEST-OWNER');await page.locator('#operatorPin').fill(TEST_PIN);await page.locator('#operatorLoginBtn').click();
 }
 await expect(page.locator('#operatorPanel')).toBeHidden();await expect(page.locator('#syncText')).toHaveText('Подтверждено облаком');await expect(page.locator('#bootOverlay')).toHaveCount(0);
}
test('clean boot requests the operator PIN before showing inventory',async({page})=>{
 const {errors}=await setup(page);await login(page);await expect(page.locator('#operatorPanel')).toBeHidden();await expect(page.locator('#mTotal')).toHaveText('2');expect(errors).toEqual([]);
});
test('repair is explicit: repeating the repair form never releases the scanner',async({page})=>{
 const {backend,errors}=await setup(page);await login(page);await page.locator('#tabModeDefect').click();await page.locator('#defSn').fill('TEST-A');await page.locator('#defReason').fill('TEST BATTERY FAILURE');await page.locator('#defBtn').click();await expect(page.locator('#mRepair')).toHaveText('1');
 await page.evaluate(()=>syncNow());expect(backend.devices.find(d=>d.serial==='TEST-A').defect).toBe('TEST BATTERY FAILURE');
 await page.waitForTimeout(1300);await page.locator('#defSn').fill('TEST-A');await page.locator('#defBtn').click();await expect(page.locator('#mRepair')).toHaveText('1');expect(errors).toEqual([]);
});
test('offline issue persists across reload, then sends with expected version',async({page})=>{
 const {backend,errors}=await setup(page);await login(page);backend.online=false;
 await page.locator('#issWorker').fill('TEST-WORKER');await page.locator('#issSn').fill('TEST-A');await page.locator('#btnIssue').click();await expect(page.locator('#mIssued')).toHaveText('1');await expect(page.locator('#syncDetail')).toContainText('ожидает: 1');
 backend.online=true;await page.reload();await expect(page.locator('#operatorPanel')).toBeHidden();await expect(page.locator('#syncDetail')).toContainText('ожидает: 0');expect(backend.devices.find(d=>d.serial==='TEST-A').holder).toBe('TEST-WORKER');expect(backend.operations[0].p_changes[0].before.version).toBe('initial');expect(errors).toEqual([]);
});
test('remote conflict preserves local operation and prevents silent overwrite',async({page})=>{
 const {backend}=await setup(page);await login(page);backend.online=false;
 await page.locator('#issWorker').fill('TEST-WORKER');await page.locator('#issSn').fill('TEST-A');await page.locator('#btnIssue').click();await expect(page.locator('#mIssued')).toHaveText('1');
 backend.devices[0]={...backend.devices[0],status:'issued',holder:'OTHER-WORKER',version:'other-terminal-version'};backend.online=true;
 await page.evaluate(()=>syncNow());await expect(page.locator('#syncDetail')).toContainText('конфликтов: 1');expect(backend.devices[0].holder).toBe('OTHER-WORKER');expect(await page.evaluate(async()=>(await readQueueWithKeys()).length)).toBe(1);
});
test('a verified empty server snapshot clears stale devices',async({page})=>{
 const {backend}=await setup(page);await login(page);backend.devices=[];await page.evaluate(()=>syncNow());await expect(page.locator('#mTotal')).toHaveText('0');await expect(page.locator('#syncText')).toHaveText('Подтверждено облаком');
});
test('owner maintenance is available after PIN verification',async({page})=>{
 await setup(page);await login(page);await page.locator('#btnMenu').click();await expect(page.locator('#btnOpenBackup')).toBeVisible();await expect(page.locator('#btnOpenImport')).toBeVisible();
});
test('pagination bounds DOM size and mobile cards expose status and actions',async({page})=>{
 const {errors}=await setup(page,{count:10000});await login(page);await expect(page.locator('#tbody tr')).toHaveCount(100);await expect(page.locator('#pageLabel')).toContainText('из 100');await page.locator('#nextPage').click();await expect(page.locator('#pageLabel')).toContainText('Страница 2');
 await page.setViewportSize({width:390,height:844});expect(await page.evaluate(()=>document.body.scrollWidth)).toBe(390);await expect(page.locator('#tbody tr').first().locator('td[data-label="Статус"]')).toBeVisible();await page.screenshot({path:'test-results/mobile.png',fullPage:false});expect(errors).toEqual([]);
});
test('confirm dialog traps keyboard focus and escape cancels',async({page})=>{
 await setup(page);await login(page);await page.evaluate(()=>{window.testConfirm=askConfirmDialog('Test','Test message')});await expect(page.locator('#confirmDialogModal')).toBeVisible();await page.locator('#confirmDialogOkBtn').focus();await page.keyboard.press('Tab');await expect(page.locator('#confirmDialogCancelBtn')).toBeFocused();await page.keyboard.press('Escape');await expect(page.locator('#confirmDialogModal')).toBeHidden();expect(await page.evaluate(()=>window.testConfirm)).toBe(false);
});
test('verified operator session survives an offline reload',async({page,context})=>{
 await setup(page);await login(page);
 await page.evaluate(async()=>{await navigator.serviceWorker.ready;});
 await page.waitForFunction(()=>navigator.serviceWorker.controller!==null);
 // context offline is real browser network loss, including reload of static resources.
 await context.setOffline(true);
 await page.reload();
 await expect(page.locator('#operatorPanel')).toBeHidden();
 await expect(page.locator('#mTotal')).toHaveText('2');
 await expect(page.locator('#syncText')).toContainText('Офлайн');
});
test('issue and return are reversible without destroying newer versions',async({page})=>{
 const {backend}=await setup(page);await login(page);backend.online=false;
 await page.locator('#issWorker').fill('TEST-WORKER');await page.locator('#issSn').fill('TEST-A');await page.locator('#btnIssue').click();await expect(page.locator('#mIssued')).toHaveText('1');
 await expect(page.locator('#toast .t-undo')).toBeVisible();await page.keyboard.press('Control+z');await expect(page.locator('#mIssued')).toHaveText('0');
 expect(await page.evaluate(async()=>(await readQueueWithKeys()).length)).toBe(2);
});
test('replacement of two scanners is sent as one operation',async({page})=>{
 const {backend}=await setup(page);await login(page);
 await page.locator('#issWorker').fill('TEST-WORKER');await page.locator('#issSn').fill('TEST-A');await page.locator('#btnIssue').click();await expect(page.locator('#toast .t-undo')).toBeVisible();await page.evaluate(()=>syncNow());
 await page.locator('#issWorker').fill('TEST-WORKER');await page.locator('#issSn').fill('TEST-B');await page.locator('#btnIssue').click();await expect(page.locator('#swapModal')).toBeVisible();await page.locator('#swapConfirm').click();await expect(page.locator('#tTitle')).toContainText('ЗАМЕНА');await page.evaluate(()=>syncNow());
 expect(backend.operations.at(-1).p_changes).toHaveLength(2);expect(backend.devices.find(d=>d.serial==='TEST-A').status).toBe('free');expect(backend.devices.find(d=>d.serial==='TEST-B').holder).toBe('TEST-WORKER');
});
test('stale writes in another tab fail before touching the queue',async({page,context})=>{
 const {backend}=await setup(page);await login(page);backend.online=false;
 await page.evaluate(()=>{window.oldSnapshot={...state.devices.find(d=>d.serial==='TEST-A')};});
 const tab=await context.newPage();backend.online=true;await tab.goto('/');await login(tab);await expect(tab.locator('#syncText')).toHaveText('Подтверждено облаком');backend.online=false;
 await tab.locator('#issWorker').fill('TEST-WORKER');await tab.locator('#issSn').fill('TEST-A');await tab.locator('#btnIssue').click();await expect(tab.locator('#toast .t-undo')).toBeVisible();
 const result=await page.evaluate(async()=>{try{await saveDevice({...window.oldSnapshot,status:'repair',defect:'STALE'},'repair','');return 'bad'}catch(e){return e.message}});
 expect(result).toContain('другой вкладке');expect(await page.evaluate(async()=>(await readQueueWithKeys()).length)).toBe(1);
});
test('import refuses to claim success without durable local storage',async({page})=>{
 await setup(page);await login(page);
 await page.evaluate(async()=>{state.dbReady=false;$('impText').value='TEST-NEW-DEVICE';await processImport();});
 await expect(page.locator('#tTitle')).toHaveText('ОШИБКА ИМПОРТА');await expect(page.locator('#mTotal')).toHaveText('2');
});
test('legacy SN; inventory remains visible and returnable',async({page})=>{
 const {backend}=await setup(page);await login(page);
 backend.devices.push({...fixture()[0],serial:'SN;TEST-LEGACY-001',status:'issued',holder:'TEST-LEGACY-WORKER',issued_at:new Date().toISOString()});
 await page.evaluate(()=>syncNow());await expect(page.locator('#mTotal')).toHaveText('3');
 await page.locator('#retQuery').fill('SN;TEST-LEGACY-001');await page.locator('#retQuery').press('Enter');await expect(page.locator('#tTitle')).toContainText('ПРИНЯТ');
 await page.evaluate(()=>syncNow());expect(backend.devices.find(d=>d.serial==='SN;TEST-LEGACY-001').status).toBe('free');
});
test('workspace navigation preserves a partially entered issue and keyboard routes',async({page})=>{
 await setup(page);await login(page);await page.locator('#issWorker').fill('TEST-DRAFT');
 await page.locator('[data-view="fleet"]').click();await expect(page.locator('#terminalWorkspace')).toBeHidden();await expect(page.locator('#searchTable')).toBeFocused();
 await page.keyboard.press('F2');await expect(page.locator('#terminalWorkspace')).toBeVisible();await expect(page.locator('#retQuery')).toBeFocused();await expect(page.locator('#issWorker')).toHaveValue('TEST-DRAFT');
 await page.keyboard.press('Control+k');await expect(page.locator('#searchTable')).toBeFocused();
});
test('command search executes by keyboard without submitting the issue form',async({page})=>{
 const {backend}=await setup(page);await login(page);await page.keyboard.press('Control+Space');await expect(page.locator('#commandModal')).toBeVisible();
 await page.locator('#commandSearch').fill('принять');await expect(page.locator('.command-result')).toHaveCount(1);await page.locator('#commandSearch').press('Enter');
 await expect(page.locator('#commandModal')).toBeHidden();await expect(page.locator('#retQuery')).toBeFocused();expect(backend.operations).toHaveLength(0);
});
test('focus mode enlarges the work area and escape restores panels without clearing inputs',async({page})=>{
 await setup(page);await login(page);await page.locator('#issWorker').fill('TEST-DRAFT');await page.keyboard.press('F8');
 await expect(page.locator('.workspace-sidebar')).toBeHidden();await expect(page.locator('#fleetRegistry')).toBeHidden();await expect(page.locator('#terminalWorkspace')).toBeVisible();
 await page.keyboard.press('Escape');await expect(page.locator('.workspace-sidebar')).toBeVisible();await expect(page.locator('#fleetRegistry')).toBeVisible();await expect(page.locator('#issWorker')).toHaveValue('TEST-DRAFT');
});
test('sound preference survives reload',async({page})=>{
 await setup(page);await login(page);await page.locator('#soundToggle').click();await expect(page.locator('#soundToggle')).toHaveAttribute('aria-pressed','true');await page.reload();await login(page);await expect(page.locator('#soundToggle')).toHaveAttribute('aria-pressed','true');
});
test('history shows unsent local operations with a pending label',async({page,context})=>{
 await setup(page);await login(page);await context.setOffline(true);
 await page.locator('#issWorker').fill('TEST-WORKER');await page.locator('#issSn').fill('TEST-A');await page.locator('#btnIssue').click();await expect(page.locator('#toast .t-undo')).toBeVisible();
 await page.locator('[data-view="activity"]').click();await expect(page.locator('#activityList')).toContainText('TEST-A');await expect(page.locator('.activity-pending')).toContainText('ожидает отправки');await expect(page.locator('#activityStatus')).toContainText('Офлайн');
});
test('design review screenshots use synthetic inventory only',async({page})=>{
 await page.setViewportSize({width:1440,height:1000});
 const {backend,errors}=await setup(page);await login(page);
 backend.devices=Array.from({length:24},(_,i)=>({...fixture()[0],serial:`DEMO-${String(100001+i)}`,model:i%3===0?'Zebra RS5100':'Point Mobile',status:i%7===0?'repair':i%3===0?'issued':'free',holder:i%7!==0&&i%3===0?`DEMO-${2000+i}`:'',issued_at:i%7!==0&&i%3===0?new Date(Date.now()-i*25*60000).toISOString():null,shift:i%2?'Дневная':'Ночная',defect:i%7===0?'Проверка аккумулятора':''}));
 await page.evaluate(()=>syncNow());await page.screenshot({path:'test-results/terminal-v13-desktop.png',fullPage:false});
 await page.keyboard.press('F8');await page.screenshot({path:'test-results/terminal-v13-focus.png',fullPage:false});await page.keyboard.press('Escape');
 await page.keyboard.press('Control+Space');await page.screenshot({path:'test-results/terminal-v13-commands.png',fullPage:false});await page.keyboard.press('Escape');
 await page.setViewportSize({width:390,height:844});await page.screenshot({path:'test-results/terminal-v13-mobile.png',fullPage:false});expect(errors).toEqual([]);
});
test('incorrect PIN leaves the working area locked',async({page})=>{
 await setup(page);await expect(page.locator('#operatorPanel')).toBeVisible();await expect(page.locator('#mTotal')).toHaveText('0');
 await page.locator('#operatorEmployeeId').fill('TEST-OWNER');await page.locator('#operatorPin').fill('111111');await page.locator('#operatorLoginBtn').click();
 await expect(page.locator('#operatorMessage')).toContainText('Неверный ID');await expect(page.locator('#appContent')).toHaveAttribute('inert','');
});
test('staff cannot see owner controls and operation proof captures verified staff ID',async({page})=>{
 const {backend}=await setup(page,{role:'operator'});await login(page);await expect(page.locator('[data-view="ownerAudit"]')).toBeHidden();await expect(page.locator('[data-view="operators"]')).toBeHidden();
 await page.locator('#issWorker').fill('RECIPIENT-ID');await page.locator('#issSn').fill('TEST-A');await page.locator('#btnIssue').click();await expect(page.locator('#toast .t-undo')).toBeVisible();await page.evaluate(()=>syncNow());
 const payload=JSON.parse(backend.operations[0].p_payload);expect(payload.employee_id).toBe('TEST-STAFF');expect(payload.changes[0].after.holder).toBe('RECIPIENT-ID');expect(backend.operations[0].p_payload).not.toContain(TEST_PIN);
});
test('owner adds an employee without leaving the PIN in the employee list',async({page})=>{
 await setup(page);await login(page);await page.locator('[data-view="operators"]').click();await page.locator('#managedEmployeeId').fill('TEST-NEW');await page.locator('#managedEmployeeName').fill('Новый сотрудник');await page.locator('#managedEmployeePin').fill('857392');await page.locator('#saveManagedOperator').click();
 await expect(page.locator('#operatorList')).toContainText('TEST-NEW');await expect(page.locator('#operatorList')).not.toContainText('857392');await expect(page.locator('#managedEmployeePin')).toHaveValue('');
});
test('owner journal filters by the operator ID and shows actual changes',async({page})=>{
 const {backend}=await setup(page);await login(page);backend.audit=[{id:1,operator_employee_id:'TEST-STAFF',display_name:'Сотрудник',action:'issue',outcome:'ok',occurred_at:new Date().toISOString(),details:{serial:'TEST-A',before:{status:'free'},after:{status:'issued'}}}];
 await page.locator('[data-view="ownerAudit"]').click();await expect(page.locator('#ownerAuditList')).toContainText('TEST-STAFF');await page.locator('#ownerAuditList details summary').click();await expect(page.locator('#ownerAuditList .audit-diff')).toContainText('Свободен');await expect(page.locator('#ownerAuditList .audit-diff')).toContainText('Выдан');
 await page.locator('#ownerAuditEmployee').fill('OTHER-ID');await page.locator('#refreshOwnerAudit').click();await expect(page.locator('#ownerAuditList')).toContainText('действий нет');
});
test('changing operator keeps the previous signed outbox author',async({page})=>{
 const {backend}=await setup(page);await login(page);backend.online=false;await page.locator('#issWorker').fill('RECIPIENT');await page.locator('#issSn').fill('TEST-A');await page.locator('#btnIssue').click();await expect(page.locator('#toast .t-undo')).toBeVisible();
 await page.locator('#operatorLogout').click();await expect(page.locator('#operatorPanel')).toBeVisible();
 const queue=await page.evaluate(()=>readQueueWithKeys());const op=queue.find(x=>x.value.type==='operation').value;expect(JSON.parse(op.proof.payload).employee_id).toBe('TEST-OWNER');expect(queue.some(x=>x.value.type==='operator_action')).toBe(true);
 backend.online=true;backend.role='operator';await login(page);await page.evaluate(()=>syncNow());expect(JSON.parse(backend.operations[0].p_payload).employee_id).toBe('TEST-OWNER');
});
test('operator access review uses only synthetic accounts and audit records',async({page})=>{
 await page.setViewportSize({width:1440,height:1000});const {backend}=await setup(page);await expect(page.locator('#bootOverlay')).toHaveCount(0);await page.screenshot({path:'test-results/operator-login.png',fullPage:false});await login(page);
 backend.audit=[{id:2,operator_employee_id:'TEST-STAFF',display_name:'Тестовый оператор',action:'issue',outcome:'ok',occurred_at:new Date().toISOString(),details:{serial:'DEMO-100004',before:{status:'free',holder:''},after:{status:'issued',holder:'DEMO-2003'}}},{id:1,operator_employee_id:'TEST-OWNER',display_name:'Создатель',action:'operator_create',outcome:'ok',occurred_at:new Date().toISOString(),details:{employee_id:'TEST-STAFF'}}];
 await page.locator('[data-view="ownerAudit"]').click();await expect(page.locator('#ownerAuditList')).toContainText('TEST-STAFF');await page.locator('#ownerAuditList details summary').first().click();await page.screenshot({path:'test-results/operator-audit.png',fullPage:false});
});

test('first owner sets a PIN once and can later use the normal login form',async({page})=>{
 const {errors}=await setup(page,{configured:false});
 await page.locator('#operatorOwnerSetup').click();await expect(page.locator('#operatorPanelTitle')).toHaveText('Настройка создателя');
 await page.goto('/#setup=SYNTHETIC-SETUP-ONLY');await expect(page.locator('#operatorSetupKey')).toHaveValue('SYNTHETIC-SETUP-ONLY');expect(new URL(page.url()).hash).toBe('');await page.locator('#operatorEmployeeId').fill('TEST-OWNER');
 await page.locator('#operatorPin').fill(TEST_PIN);await page.locator('#operatorPinConfirm').fill('111111');await page.locator('#operatorLoginBtn').click();
 await expect(page.locator('#operatorMessage')).toContainText('не совпадает');
 await page.locator('#operatorPinConfirm').fill(TEST_PIN);await page.locator('#operatorLoginBtn').click();await expect(page.locator('#operatorPanel')).toBeHidden();
 await page.locator('#operatorLogout').click();await expect(page.locator('#operatorSetupFields')).toBeHidden();
 await page.locator('#operatorEmployeeId').fill('TEST-OWNER');await page.locator('#operatorPin').fill(TEST_PIN);await page.locator('#operatorLoginBtn').click();await expect(page.locator('#operatorPanel')).toBeHidden();expect(errors).toEqual([]);
});

test('employee first entry confirms a self-chosen PIN and grants ordinary access',async({page})=>{
 const {backend,errors}=await setup(page);await page.locator('[data-operator-mode="register"]').click();await page.locator('#operatorEmployeeId').fill('TEST-SELF');await page.locator('#operatorPin').fill(TEST_PIN);await page.locator('#operatorPinConfirm').fill('111111');await page.locator('#operatorLoginBtn').click();
 await expect(page.locator('#operatorMessage')).toContainText('не совпадает');expect(backend.registration).toBeUndefined();await page.locator('#operatorPinConfirm').fill(TEST_PIN);await page.locator('#operatorLoginBtn').click();await expect(page.locator('#operatorPanel')).toBeHidden();expect(backend.registration.p_employee_id).toBe('TEST-SELF');await expect(page.locator('#operatorBadgeText')).toContainText('TEST-SELF');await expect(page.locator('[data-view="ownerAudit"]')).toBeHidden();await expect(page.locator('#operatorPin')).toHaveValue('');await expect(page.locator('#operatorPinConfirm')).toHaveValue('');expect(errors).toEqual([]);
});
test('existing employee ID cannot be overwritten through first entry',async({page})=>{
 const {backend}=await setup(page);backend.registrationStatus='exists';await page.locator('[data-operator-mode="register"]').click();await page.locator('#operatorEmployeeId').fill('TEST-EXISTS');await page.locator('#operatorPin').fill(TEST_PIN);await page.locator('#operatorPinConfirm').fill(TEST_PIN);await page.locator('#operatorLoginBtn').click();await expect(page.locator('#operatorMessage')).toContainText('уже зарегистрирован');await expect(page.locator('#operatorPanel')).toBeVisible();await page.locator('[data-operator-mode="login"]').click();await expect(page.locator('#operatorSetupFields')).toBeHidden();
});
test('all twelve distinct themes work before login and persist after reload',async({page})=>{
 const {errors}=await setup(page);await page.locator('#operatorPanel [data-open-themes]').click();await expect(page.locator('#themeModal')).toBeVisible();await expect(page.locator('.theme-card')).toHaveCount(12);const backgrounds=new Set();
 for(const id of ['berry','sapphire','carbon','quartz','forest','aurora','paper','ocean','rose','cobalt','copper','mint']){await page.locator(`[data-set-theme="${id}"]`).click();await expect(page.locator('html')).toHaveAttribute('data-theme',id);backgrounds.add(await page.evaluate(()=>getComputedStyle(document.body).backgroundColor));await expect(page.locator(`[data-set-theme="${id}"]`)).toHaveAttribute('aria-pressed','true');}
 expect(backgrounds.size).toBe(12);await page.locator('[data-theme-filter="light"]').click();await expect(page.locator('.theme-card:visible')).toHaveCount(5);await page.locator('[data-theme-filter="dark"]').click();await expect(page.locator('.theme-card:visible')).toHaveCount(7);await page.keyboard.press('Escape');await expect(page.locator('#themeModal')).toBeHidden();await page.reload();await expect(page.locator('html')).toHaveAttribute('data-theme','mint');expect(errors).toEqual([]);
});
test('theme choice preserves the current scan and is usable on a narrow screen',async({page})=>{
 await setup(page);await login(page);await page.locator('#issWorker').fill('TEST-RECIPIENT');await page.locator('#btnMenu').click();await page.locator('#menuPop [data-open-themes]').click();await page.locator('[data-set-theme="paper"]').click();await page.keyboard.press('Escape');await expect(page.locator('#issWorker')).toHaveValue('TEST-RECIPIENT');await page.setViewportSize({width:390,height:844});await page.locator('#btnMenu').click();await page.locator('#menuPop [data-open-themes]').click();await expect(page.locator('#themeModal')).toBeVisible();expect(await page.evaluate(()=>document.body.scrollWidth)).toBe(390);await page.locator('[data-set-theme="ocean"]').click();await expect(page.locator('html')).toHaveAttribute('data-theme','ocean');
});
test('theme review captures synthetic screens with different palettes and geometry',async({page})=>{
 await page.setViewportSize({width:1440,height:1000});await setup(page);await login(page);
 for(const id of ['forest','paper','cobalt','rose']){await page.evaluate(id=>applyTheme(id,false),id);await page.screenshot({path:`test-results/theme-${id}.png`,fullPage:false});}
 await page.locator('#btnMenu').click();await page.locator('#menuPop [data-open-themes]').click();await page.screenshot({path:'test-results/theme-gallery.png',fullPage:false});
});
