const {test,expect}=require('@playwright/test');
const fs=require('node:fs/promises');

const free=serial=>({serial,model:'Point Mobile',status:'free',holder:'',shift:'—',issued_at:null,last_move:'2026-11-14T06:00:00.000Z',version:'initial',defect:''});
const issued=(serial,worker,hours=1)=>({...free(serial),status:'issued',holder:worker,shift:'Дневная',issued_at:new Date(Date.now()-hours*3600000).toISOString()});

async function boot(page,{devices=[free('AUDIT-AA'),free('AUDIT-BB')],owner=true,...options}={}){
 const actor=owner?'AUDIT-OWNER':'AUDIT-STAFF';
 const backend={devices,moves:[],audit:[],people:[{employee_id:'AUDIT-STAFF',display_name:'',role:'operator',active:true}],files:[],calls:[],...options};
 const profile={employee_id:actor,role:owner?'owner':'operator',session_id:'00000000-0000-4000-8000-000000000001',expires_at:new Date(Date.now()+3600000).toISOString()};
 await page.context().route('https://**/*',async route=>{
  const req=route.request(),url=new URL(req.url());
  if(url.hostname!=='sgpkvnymkqwuhepkaoxw.supabase.co')return route.abort();
  const call=url.pathname.split('/').at(-1),args=req.postDataJSON()||{};
  backend.calls.push({call,args});
  let json;
  switch(call){
   case 'scanner_operator_login':json={status:'ok',token:'a'.repeat(64),profile:{...profile,employee_id:args.p_employee_id}};backend.currentProfile=json.profile;break;
   case 'scanner_operator_session':json=backend.suspendSession?{profile:null}:{profile:backend.currentProfile||profile,server_time:await page.evaluate(()=>new Date().toISOString())};break;
   case 'scanner_operator_logout':json={status:'ok'};break;
   case 'scanner_workstation_heartbeat':json=null;break;
   case 'scanner_manage_workstations':{
    backend.terminals??=[{terminal_id:'audit-station',label:'',last_seen_at:new Date().toISOString(),employee_id:actor}];
    if(args.p_terminal)backend.terminals[0].label=args.p_label;
    json=backend.terminals;break;
   }
   case 'scanner_pull':if(backend.failPull)return route.abort();json={cursor:1,full:!(backend.emptyDelta&&args.p_after),devices:backend.emptyDelta&&args.p_after?[]:backend.devices};break;
   case 'scanner_apply':{
    if(backend.failApply)return route.abort();
    const stale=args.p_changes.filter(c=>(c.before?.version||null)!==(backend.devices.find(d=>d.serial===c.serial)?.version||null));
    if(stale.length){json={status:'conflict',serials:stale.map(c=>c.serial)};break;}
    for(const c of args.p_changes){
     backend.devices=backend.devices.filter(d=>d.serial!==c.serial);
     backend.devices.push(c.after||{...c.before,deleted_at:new Date().toISOString(),version:'retired'});
     backend.moves.unshift({id:backend.moves.length+1,event_id:`${args.p_id}:${c.serial}`,serial:c.serial,worker:c.worker,action:c.action,created_at:c.ts,occurred_at:c.ts,operator_employee_id:JSON.parse(args.p_payload).employee_id,terminal_id:args.p_terminal});
    }
    json={status:'applied'};break;
   }
   case 'scanner_record_signed_action':json={status:'applied'};break;
   case 'scanner_owner_audit':json=backend.audit.filter(row=>(!args.p_employee_id||row.operator_employee_id===args.p_employee_id)&&(!args.p_before||row.id<args.p_before)).slice(0,args.p_limit);break;
   case 'scanner_operator_manage':{
    if(args.p_action==='list')json=backend.people;
    else{backend.people.find(p=>p.employee_id===args.p_employee_id).active=args.p_action==='enable';json={status:'ok'};}
    break;
   }
   case 'movements':{
    if(backend.failHistory)return route.fulfill({status:400,json:{message:'Сервис истории недоступен'}});
    const q=url.searchParams;
    const times=q.getAll('occurred_at');
    json=backend.moves.filter(m=>(!q.get('serial')||q.get('serial')===`eq.${m.serial}`)&&times.every(t=>t.startsWith('gte.')?m.occurred_at>=t.slice(4):m.occurred_at<t.slice(3))&&(!q.get('id')||m.id>Number(q.get('id').slice(3)))).sort((a,b)=>q.get('order')?.startsWith('id.asc')?a.id-b.id:b.id-a.id).slice(0,Number(q.get('limit')||1000));break;
   }
   case 'scanner_backup':{
    if(args.p_action==='list')json=backend.files.filter(f=>!f.hidden);
    else if(args.p_action==='create'){
     const file={name:`test-copy-${backend.files.length+1}`,created_at:new Date().toISOString(),metadata:{size:1024},devices:structuredClone(backend.devices.filter(d=>!d.deleted_at))};
     backend.files.unshift(file);json={name:file.name,total:file.devices.length};
    }else if(args.p_action==='download')json={devices:backend.files.find(f=>f.name===args.p_name).devices};
    else{backend.files.find(f=>f.name===args.p_name).hidden=true;json={status:'ok'};}
    break;
   }
   default:throw Error(`Unexpected RPC ${call}`);
  }
  await route.fulfill({json});
 });
 await page.goto('/');
 await expect(page.locator('#bootOverlay')).toHaveCount(0);
 await page.locator('#operatorEmployeeId').fill(actor);
 await page.locator('#operatorEmployeeId').press('Enter');
 await page.locator('#operatorPin').fill('739251');
 await page.locator('#operatorPin').press('Enter');
 await expect(page.locator('#syncText')).toHaveText('Подтверждено облаком');
 return backend;
}
async function menu(page,selector){await page.locator('#btnMenu').click();await page.locator(`#menuPop ${selector}`).click();}
async function download(page,selector){const [file]=await Promise.all([page.waitForEvent('download'),page.locator(selector).click()]);return fs.readFile(await file.path(),'utf8');}

test('audit staff: registry filters, device history, overdue list, return and repair',async({page})=>{
 const back=await boot(page,{owner:false,devices:[issued('AUDIT-DEBT','AUDIT-HOLDER',16),{...free('AUDIT-ZEBRA'),model:'Zebra RS5100'},free('AUDIT-RESERVE')]});
 await expect(page.locator('#mOverdue')).toHaveText('1');
 await page.locator('#debtBtn').click();await expect(page.locator('#debtModalList')).toContainText('AUDIT-HOLDER');
 await page.locator('#btnShowDebtsInTable').click();await expect(page.locator('#tbody tr')).toHaveCount(1);
 await page.locator('[data-filter="all"]').click();
 await page.locator('[data-mfilter="Zebra RS5100"]').click();await expect(page.locator('#tbody tr')).toHaveCount(1);
 await page.locator('[data-mfilter="all"]').click();await page.locator('#searchTable').fill('AUDIT-HOLDER');
 await page.locator('[data-action=audit][data-sn="AUDIT-DEBT"]').click();await expect(page.locator('#auditDrawer')).toHaveClass(/open/);
 await expect(page.locator('#audHolder')).toHaveText('AUDIT-HOLDER');await page.keyboard.press('Escape');
 await page.keyboard.press('F2');await page.locator('#retQuery').fill('AUDIT-DEBT');await page.locator('#retQuery').press('Enter');
 await expect(page.locator('#mOverdue')).toHaveText('0');await expect.poll(()=>back.moves.length).toBe(1);
 await page.keyboard.press('F3');await page.locator('#defSn').fill('AUDIT-ZEBRA');await page.locator('#defReason').fill('Проверка кнопки');await page.locator('#defBtn').click();
 await expect(page.locator('#mRepair')).toHaveText('1');await expect.poll(()=>back.moves.length).toBe(2);
 await expect(page.locator('#lastOperation')).toContainText('подтверждено облаком');
 await page.locator('#searchTable').fill('AUDIT-ZEBRA');await page.locator('[data-action=repair][data-sn="AUDIT-ZEBRA"]').click();
 if(!await page.locator('#confirmDialogModal').isVisible()){
  await page.waitForTimeout(1250);
  await page.locator('[data-action=repair][data-sn="AUDIT-ZEBRA"]').click();
 }
 await page.locator('#confirmDialogOkBtn').click();await expect(page.locator('#mRepair')).toHaveText('0');
 await menu(page,'[data-view="activity"]');await expect(page.locator('#activityList')).toContainText('Проверка кнопки');
});

test('audit owner: import, retire, backup lifecycle, audit CSV, disable and enable',async({page})=>{
 const now=new Date().toISOString();
 const back=await boot(page,{audit:[{id:1,action:'issue',outcome:'ok',operator_employee_id:'AUDIT-STAFF',occurred_at:now,details:{serial:'AUDIT-AA',before:{status:'free'},after:{status:'issued'}}}]});
 await menu(page,'#btnOpenImport');await page.locator('#impText').fill('AUDIT-NEW\nAUDIT-NEW\nAUDIT-AA');await page.locator('#btnProcessImport').click();
 await expect(page.locator('#mTotal')).toHaveText('3');await expect(page.locator('#syncDetail')).toContainText('ожидает: 0');
 await menu(page,'#btnOpenBackup');await page.locator('#btnCreateCloudBackup').click();await expect(page.locator('#backupList')).toContainText('test-copy-1');
 expect(JSON.parse(await download(page,'#btnDownloadJsonBackup')).devices).toHaveLength(3);
 await page.keyboard.press('Escape');await page.keyboard.press('Control+Alt+d');
 await page.locator('[data-del-sn="AUDIT-NEW"]').click();await page.locator('#confirmDialogCancelBtn').click();await expect(page.locator('#mTotal')).toHaveText('3');
 await page.locator('[data-del-sn="AUDIT-NEW"]').click();await page.locator('#confirmDialogOkBtn').click();await expect(page.locator('#mTotal')).toHaveText('2');
 await expect.poll(()=>back.moves.length).toBe(2);
 await page.keyboard.press('Escape');await menu(page,'#btnOpenBackup');
 await page.locator('[data-bk-action=restore]').click();await expect(page.locator('#confirmDialogTitle')).toHaveText('Сравнение с резервной копией');
 await page.keyboard.press('Escape');await expect(page.locator('#mTotal')).toHaveText('2');
 await page.locator('[data-bk-action=restore]').click();await page.locator('#confirmDialogOkBtn').click();await expect(page.locator('#mTotal')).toHaveText('3');
 await menu(page,'#btnOpenBackup');await page.locator('[data-bk-action=delete]').click();await page.locator('#confirmDialogOkBtn').click();await expect(page.locator('#backupList')).toContainText('пока нет');
 await page.keyboard.press('Escape');await menu(page,'[data-view="operators"]');
 await page.locator('[data-operator-action=disable]').click();await expect(page.locator('[data-operator-action=enable]')).toBeVisible();
 await page.locator('[data-operator-action=enable]').click();await expect(page.locator('[data-operator-action=disable]')).toBeVisible();
 await expect(page.locator('#terminalList')).toContainText('Последняя связь');
 await page.locator('#terminalList input').fill('Пост приёмки');await page.locator('#terminalList button').click();
 await expect(page.locator('#terminalList strong')).toHaveText('Пост приёмки');
 await menu(page,'[data-view="ownerAudit"]');await expect(page.locator('#ownerAuditList')).toContainText('AUDIT-STAFF');
 await page.locator('#ownerAuditList summary').click();await expect(page.locator('.audit-diff')).toContainText('Выдан');
 expect(await download(page,'#ownerAuditExport')).toContain('AUDIT-STAFF');
 await page.locator('#operatorLogout').click();await expect(page.locator('#operatorPanel')).toBeVisible();
});

test('Enter on Cancel leaves the scanner in stock',async({page})=>{
 await boot(page);await page.keyboard.press('Control+Alt+d');
 await page.locator('[data-del-sn="AUDIT-AA"]').click();await expect(page.locator('#confirmDialogCancelBtn')).toBeFocused();
 await page.keyboard.press('Enter');await expect(page.locator('#confirmDialogModal')).toBeHidden();await expect(page.locator('#mTotal')).toHaveText('2');
});

test('a full serial takes precedence over suffix matches on issue',async({page})=>{
 const back=await boot(page,{owner:false,devices:[free('AUDIT-AA'),free('OTHER-AUDIT-AA')]});
 await page.locator('#issWorker').fill('AUDIT-HOLDER');await page.locator('#issSn').fill('AUDIT-AA');await page.locator('#issSn').press('Enter');
 await expect(page.locator('#issPickModal')).toBeHidden();await expect(page.locator('#mIssued')).toHaveText('1');
 await expect.poll(()=>back.moves[0]?.serial).toBe('AUDIT-AA');
});

test('repair from the register asks for a fresh reason for the selected scanner',async({page})=>{
 const back=await boot(page);await page.keyboard.press('F3');
 await page.locator('#defSn').fill('AUDIT-AA');await page.locator('#defReason').fill('Лопнул курок');await page.locator('#defBtn').click();
 await expect(page.locator('#mRepair')).toHaveText('1');
 await page.locator('[data-action=repair][data-sn="AUDIT-BB"]').click();await expect(page.locator('#mRepair')).toHaveText('1');
 await expect(page.locator('#defSn')).toHaveValue('AUDIT-BB');await expect(page.locator('#defReason')).not.toHaveValue('Лопнул курок');
 await page.locator('#defReason').fill('Не держит заряд');await page.locator('#defBtn').click();await expect(page.locator('#mRepair')).toHaveText('2');
 await expect.poll(()=>back.devices.find(d=>d.serial==='AUDIT-BB').defect).toBe('Не держит заряд');
});

test('printing uses the full fleet from the register and from history',async({page})=>{
 await page.addInitScript(()=>{window.print=()=>{window.printData={rows:document.querySelectorAll('#shiftActRows tr').length,prepared:!document.querySelector('#shiftActPrint').hidden&&document.body.classList.contains('printing-shift-act'),meta:document.querySelector('#printActMeta').textContent};};});
 await boot(page);await page.locator('#searchTable').fill('AUDIT-AA');await expect(page.locator('#tbody .sn-link')).toHaveCount(1);
 await menu(page,'#btnPrintAct');
 await expect.poll(()=>page.evaluate(()=>window.printData)).toMatchObject({rows:2,prepared:true,meta:expect.stringContaining('Всего сканеров: 2')});
 await menu(page,'[data-view="activity"]');
 await page.evaluate(()=>{window.printData=null;});
 await menu(page,'#btnPrintAct');await expect.poll(()=>page.evaluate(()=>window.printData)).toMatchObject({rows:2,prepared:true});
});

test('the default report includes a cloud operation in the current minute',async({page})=>{
 await page.clock.setFixedTime(new Date('2026-11-14T13:07:45.000Z'));
 const row={id:1,serial:'AUDIT-AA',worker:'AUDIT-HOLDER',action:'Выдан',created_at:'2026-11-14T13:07:20.000Z',occurred_at:'2026-11-14T13:07:20.000Z',operator_employee_id:'AUDIT-STAFF'};
 await boot(page,{moves:[row]});await menu(page,'#btnExportCsv');
 expect(await download(page,'#btnReportExport')).toContain('AUDIT-AA');
 await expect(page.locator('#reportError')).toContainText('Выгружено операций: 1');
 expect(await download(page,'#btnFleetExport')).toContain('AUDIT-BB');
});

test('device history distinguishes cloud failure from no history',async({page})=>{
 await boot(page,{owner:false,failHistory:true});
 await menu(page,'[data-view="activity"]');await expect(page.locator('#activityStatus')).toContainText('Облачный журнал недоступен');
 await menu(page,'[data-view="fleet"]');await page.locator('[data-action=audit][data-sn="AUDIT-AA"]').click();
 await expect(page.locator('#audTimeline')).toContainText('Облачная история недоступна');
});

test('Ctrl+I keeps the creator import form closed for an ordinary operator',async({page})=>{
 await boot(page,{owner:false});await page.keyboard.press('Control+i');await expect(page.locator('#impModal')).toBeHidden();
});

test('a valid PIN session survives an API outage, but an explicit revocation locks the post',async({page})=>{
 const back=await boot(page,{owner:false,emptyDelta:true});
 const pattern='https://**/rpc/scanner_operator_session';
 await page.context().route(pattern,route=>route.abort());
 await page.reload();await expect(page.locator('#bootOverlay')).toHaveCount(0);
 await expect(page.locator('#operatorPanel')).toBeHidden();expect(await page.evaluate(()=>navigator.onLine)).toBe(true);
 await page.context().unroute(pattern);back.suspendSession=true;
 await page.reload();await expect(page.locator('#operatorPanel')).toBeVisible();await expect(page.locator('#operatorMessage')).toContainText('Доступ изменён');
});

test('a new operator receives empty scan forms',async({page})=>{
 await boot(page,{owner:false});
 await page.locator('#issWorker').fill('AUDIT-PREVIOUS');await page.locator('#issSn').fill('AUDIT-AA');
 await page.locator('#operatorLogout').click();await expect(page.locator('#operatorPanel')).toBeVisible();
 await page.locator('#operatorEmployeeId').fill('AUDIT-NEW-STAFF');await page.locator('#operatorEmployeeId').press('Enter');
 await page.locator('#operatorPin').fill('739251');await page.locator('#operatorPin').press('Enter');
 await expect(page.locator('#operatorBadgeText')).toContainText('AUDIT-NEW-STAFF');await expect(page.locator('#issWorker')).toHaveValue('');
 await expect(page.locator('#issSn')).toHaveValue('');
});

test('showing overdue scanners from history opens the filtered register',async({page})=>{
 await boot(page,{owner:false,devices:[issued('AUDIT-DEBT','AUDIT-HOLDER',16)]});
 await menu(page,'[data-view="activity"]');await page.locator('#debtBtn').click();await page.locator('#btnShowDebtsInTable').click();
 await expect(page.locator('#debtModal')).toBeHidden();await expect(page.locator('#activityWorkspace')).toBeHidden();
 await expect(page.locator('#fleetRegistry')).toBeVisible();await expect(page.locator('#tbody')).toContainText('AUDIT-HOLDER');
});

test('audit staff: copy shift summary, manual shift, theme, sound and compact mode',async({page,context})=>{
 await context.grantPermissions(['clipboard-read','clipboard-write']);
 await boot(page,{owner:false});
 await menu(page,'#btnCopySummary');await expect(page.locator('#tTitle')).toContainText('СВОДКА СКОПИРОВАНА');
 expect(await page.evaluate(()=>navigator.clipboard.readText())).toContain('Всего сканеров в парке: 2');
 await page.keyboard.press('F4');await expect(page.locator('#shiftBadge')).toHaveText(/MANUAL|РУЧН/);
 await page.locator('#shiftBadge').click();await expect(page.locator('#shiftBadge')).toHaveText('AUTO');
 await page.locator('#soundToggle').click();await expect(page.locator('#soundToggle')).toHaveAttribute('aria-pressed','true');
 await page.keyboard.press('F8');await expect(page.locator('#fleetRegistry')).toBeHidden();await page.keyboard.press('Escape');
 await menu(page,'[data-open-themes]');await page.locator('#themeModal [data-set-theme="quartz"]').click();await expect(page.locator('html')).toHaveAttribute('data-theme','quartz');
});

test('audit owner: diagnose a conflict, download the queue, cancel and reconcile',async({page})=>{
 const back=await boot(page,{failApply:true});
 await page.locator('#issWorker').fill('AUDIT-LOCAL');await page.locator('#issSn').fill('AUDIT-AA');await page.locator('#issSn').press('Enter');
 await expect(page.locator('#syncDetail')).toContainText('ожидает: 1');
 await expect(page.locator('#lastOperation')).toContainText('сохранено на этом ПК');
 back.devices[0]={...issued('AUDIT-AA','AUDIT-REMOTE'),version:'remote'};back.failApply=false;
 await page.locator('#syncStatus').click();await page.locator('#btnForceSync').click();
 await expect(page.locator('#syncText')).toHaveText('Требуется сверка с облаком');
 await expect(page.locator('#lastOperation')).toContainText('требуется сверка');
 await page.locator('#syncStatus').click();await expect(page.locator('#diagContent')).toContainText('AUDIT-AA');
 const saved=JSON.parse(await download(page,'#btnDownloadQueue'));expect(saved.queue).toHaveLength(1);
 await page.locator('#btnResolveQueue').click();await expect(page.locator('#confirmDialogModal')).toBeVisible();await page.keyboard.press('Escape');
 await expect(page.locator('#syncDetail')).toContainText('ожидает: 1');
 await page.locator('#btnResolveQueue').click();await page.locator('#confirmDialogOkBtn').click();
 await expect(page.locator('#tbody')).toContainText('AUDIT-REMOTE');await expect(page.locator('#syncText')).toHaveText('Подтверждено облаком');
 expect(await page.evaluate(async()=>{const store=db.transaction('meta').objectStore('meta');return (await requestResult(store.getAllKeys())).some(key=>String(key).startsWith('conflict:'));})).toBe(true);
 await expect(page.locator('#lastOperation')).toContainText('сверено с облаком');
});
