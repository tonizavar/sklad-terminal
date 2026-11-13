const {test,expect}=require('@playwright/test');
const USER='00000000-0000-4000-8000-000000000001';
const fixture=()=>[
 {serial:'TEST-A',model:'Point Mobile',status:'free',holder:'',shift:'—',issued_at:null,last_move:'2026-11-13T06:00:00.000Z',version:'initial',defect:''},
 {serial:'TEST-B',model:'Point Mobile',status:'free',holder:'',shift:'—',issued_at:null,last_move:'2026-11-13T06:00:00.000Z',version:'initial',defect:''}
];
async function setup(page,{role='admin',count=2}={}){
 const backend={devices:count===2?fixture():Array.from({length:count},(_,i)=>({...fixture()[0],serial:`TEST-${String(i).padStart(5,'0')}`})),operations:[],online:true,role};
 await page.context().route('https://fonts.googleapis.com/**',r=>r.abort());
 await page.context().route('https://sgpkvnymkqwuhepkaoxw.supabase.co/**',async route=>{
  if(!backend.online)return route.abort();
  const req=route.request(),url=new URL(req.url());let body={};
  if(url.pathname.endsWith('/rpc/scanner_pull'))body={cursor:1,full:true,devices:backend.devices};
  else if(url.pathname.endsWith('/rpc/scanner_apply')){
   const op=req.postDataJSON();backend.operations.push(op);
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
async function login(page){await expect(page.locator('#appContent')).not.toHaveAttribute('inert','');await expect(page.locator('#syncText')).toHaveText('Подтверждено облаком');}
test('clean boot opens directly without login or embedded employee data',async({page})=>{
 const {errors}=await setup(page);await login(page);await expect(page.locator('input[type=password]')).toHaveCount(0);await expect(page.locator('#mTotal')).toHaveText('2');expect(errors).toEqual([]);
});
test('repair is explicit: repeating the repair form never releases the scanner',async({page})=>{
 const {backend,errors}=await setup(page);await login(page);await page.locator('#tabModeDefect').click();await page.locator('#defSn').fill('TEST-A');await page.locator('#defReason').fill('TEST BATTERY FAILURE');await page.locator('#defBtn').click();await expect(page.locator('#mRepair')).toHaveText('1');
 await page.evaluate(()=>syncNow());expect(backend.devices.find(d=>d.serial==='TEST-A').defect).toBe('TEST BATTERY FAILURE');
 await page.waitForTimeout(1300);await page.locator('#defSn').fill('TEST-A');await page.locator('#defBtn').click();await expect(page.locator('#mRepair')).toHaveText('1');expect(errors).toEqual([]);
});
test('offline issue persists across reload, then sends with expected version',async({page})=>{
 const {backend,errors}=await setup(page);await login(page);backend.online=false;
 await page.locator('#issWorker').fill('TEST-WORKER');await page.locator('#issSn').fill('TEST-A');await page.locator('#btnIssue').click();await expect(page.locator('#mIssued')).toHaveText('1');await expect(page.locator('#syncDetail')).toContainText('ожидает: 1');
 backend.online=true;await page.reload();await expect(page.locator('input[type=password]')).toHaveCount(0);await expect(page.locator('#syncDetail')).toContainText('ожидает: 0');expect(backend.devices.find(d=>d.serial==='TEST-A').holder).toBe('TEST-WORKER');expect(backend.operations[0].p_changes[0].before.version).toBe('initial');expect(errors).toEqual([]);
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
test('maintenance is available without creating an administrator',async({page})=>{
 await setup(page);await login(page);await page.locator('#btnMenu').click();await expect(page.locator('#btnOpenBackup')).toBeVisible();await expect(page.locator('#btnOpenImport')).toBeVisible();
});
test('pagination bounds DOM size and mobile cards expose status and actions',async({page})=>{
 const {errors}=await setup(page,{count:10000});await login(page);await expect(page.locator('#tbody tr')).toHaveCount(100);await expect(page.locator('#pageLabel')).toContainText('из 100');await page.locator('#nextPage').click();await expect(page.locator('#pageLabel')).toContainText('Страница 2');
 await page.setViewportSize({width:390,height:844});expect(await page.evaluate(()=>document.body.scrollWidth)).toBe(390);await expect(page.locator('#tbody tr').first().locator('td[data-label="Статус"]')).toBeVisible();await page.screenshot({path:'test-results/mobile.png',fullPage:false});expect(errors).toEqual([]);
});
test('confirm dialog traps keyboard focus and escape cancels',async({page})=>{
 await setup(page);await login(page);await page.evaluate(()=>{window.testConfirm=askConfirmDialog('Test','Test message')});await expect(page.locator('#confirmDialogModal')).toBeVisible();await page.locator('#confirmDialogOkBtn').focus();await page.keyboard.press('Tab');await expect(page.locator('#confirmDialogCancelBtn')).toBeFocused();await page.keyboard.press('Escape');await expect(page.locator('#confirmDialogModal')).toBeHidden();expect(await page.evaluate(()=>window.testConfirm)).toBe(false);
});
test('offline application shell reloads without signing in',async({page,context})=>{
 await setup(page);await login(page);
 await page.evaluate(async()=>{await navigator.serviceWorker.ready;});
 await page.waitForFunction(()=>navigator.serviceWorker.controller!==null);
 // context offline is real browser network loss, including reload of static resources.
 await context.setOffline(true);
 await page.reload();
 await expect(page.locator('input[type=password]')).toHaveCount(0);
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
 const tab=await context.newPage();backend.online=true;await tab.goto('/');await expect(tab.locator('input[type=password]')).toHaveCount(0);await expect(tab.locator('#syncText')).toHaveText('Подтверждено облаком');backend.online=false;
 await tab.locator('#issWorker').fill('TEST-WORKER');await tab.locator('#issSn').fill('TEST-A');await tab.locator('#btnIssue').click();await expect(tab.locator('#toast .t-undo')).toBeVisible();
 const result=await page.evaluate(async()=>{try{await saveDevice({...window.oldSnapshot,status:'repair',defect:'STALE'},'repair','');return 'bad'}catch(e){return e.message}});
 expect(result).toContain('другой вкладке');expect(await page.evaluate(async()=>(await readQueueWithKeys()).length)).toBe(1);
});
test('import refuses to claim success without durable local storage',async({page})=>{
 await setup(page);await login(page);
 await page.evaluate(async()=>{state.dbReady=false;$('impText').value='TEST-NEW-DEVICE';await processImport();});
 await expect(page.locator('#tTitle')).toHaveText('ОШИБКА ИМПОРТА');await expect(page.locator('#mTotal')).toHaveText('2');
});
