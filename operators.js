/* PIN is sent only over HTTPS, never cached or added to operation/audit payloads. */
const operatorContext = { profile: null, token: null, key: null, saving: 0, timer: null };
let operatorSetupToken = '';
let ownerAuditCursor = null;
const OPERATOR_ACTIONS = { login:'Вход', logout:'Выход', logout_offline:'Выход на устройстве без сети', owner_setup:'Настройка создателя', issue:'Выдача', return:'Приёмка', repair:'Ремонт', repair_complete:'Возврат из ремонта', retire:'Списание', register:'Регистрация сканера', device_update:'Изменение устройства', device_operation:'Операция с устройством', operator_create:'Добавление оператора', operator_reset_pin:'Сброс PIN', operator_disable:'Отключение оператора', operator_enable:'Включение оператора', report_export:'Экспорт отчёта', fleet_export:'Экспорт парка', print_act:'Печать акта', queue_reconciliation:'Согласование очереди', cache_refresh:'Перезагрузка кэша', backup_create:'Создание копии', backup_list:'Просмотр копий', backup_download:'Скачивание копии', backup_delete:'Скрытие копии' };
function operatorActive() { return Boolean(operatorContext.profile && operatorContext.token && Date.parse(operatorContext.profile.expires_at)>Date.now()); }
function requireOperator(owner = false) {
  if (!operatorActive()) { lockOperator(); throw new Error('Укажите ID оператора и личный PIN'); }
  if (owner && operatorContext.profile.role!=='owner') throw new Error('Действие доступно только создателю');
  return operatorContext.profile;
}
function bytesHex(bytes) { return [...new Uint8Array(bytes)].map(b=>b.toString(16).padStart(2,'0')).join(''); }
async function operatorSigningKey(token) {
  const digest = await crypto.subtle.digest('SHA-256',new TextEncoder().encode(token));
  return crypto.subtle.importKey('raw',digest,{name:'HMAC',hash:'SHA-256'},false,['sign']);
}
async function signOperatorOperation(operation, captured) {
  const payload=JSON.stringify({id:operation.id,kind:'device_operation',employee_id:captured.profile.employee_id,session_id:captured.profile.session_id,terminal:operation.terminal,captured_at:operation.ts,changes:operation.changes});
  return { session:captured.profile.session_id,payload,signature:bytesHex(await crypto.subtle.sign('HMAC',captured.key,new TextEncoder().encode(payload))) };
}
async function operatorRpc(name,args={}) {
  if (!cloud) throw new Error('Для входа нужно соединение с облаком');
  const {data,error}=await withTimeout(cloud.rpc(name,args),NET_TIMEOUT_MS,'оператор');
  if(error) throw error;
  return data;
}
function updateOperatorUI() {
  const p=operatorContext.profile;
  $('operatorBadgeText').textContent=p?`${p.display_name||'Оператор'} · ID ${p.employee_id}`:'Оператор не выбран';
  document.querySelectorAll('[data-owner-only]').forEach(el=>el.hidden=p?.role!=='owner');
  $('operatorPanel').hidden=Boolean(p);
  $('appContent').inert=!p;
  document.querySelector('.workspace-sidebar').inert=!p;
  $('operatorBadge').hidden=!p;
  document.querySelector('.workspace-footer>span').textContent=p?`Пост · ID оператора ${p.employee_id}`:'Пост · требуется ID и PIN';
}
function lockOperator(message='') {
  if (operatorContext.saving || state.opLock) { clearTimeout(operatorContext.timer);operatorContext.timer=setTimeout(()=>lockOperator(message),500);return; }
  operatorContext.profile=null;operatorContext.token=null;operatorContext.key=null;
  clearTimeout(operatorContext.timer);clearUndo();
  try{sessionStorage.removeItem('sklad_operator_session');}catch(_){}
  document.querySelectorAll('.modal-overlay.show').forEach(el=>closeModal(el.id));closeAuditDrawer();
  state.devices=[];renderTable();
  if(typeof setWorkspaceView==='function')setWorkspaceView('terminal');
  $('operatorPin').value='';$('operatorMessage').textContent=message;
  updateOperatorUI();setTimeout(()=>$('operatorEmployeeId').focus(),0);
}
async function acceptOperatorSession(data) {
  $('operatorLoginForm').dataset.setup='false';$('operatorSetupFields').hidden=true;$('operatorPinConfirm').required=false;$('operatorSetupKey').required=false;
  $('operatorPanelTitle').textContent='Кто работает за постом?';$('operatorLoginBtn').textContent='Начать работу';
  if(!data.profile || !data.token)throw new Error('Сервер не подтвердил оператора');
  operatorContext.profile=data.profile;operatorContext.token=data.token;
  operatorContext.key=await operatorSigningKey(data.token);
  try{sessionStorage.setItem('sklad_operator_session',JSON.stringify({token:data.token,profile:data.profile}));}catch(_){}
  clearTimeout(operatorContext.timer);
  operatorContext.timer=setTimeout(()=>lockOperator('Время сессии истекло. Введите ID и PIN снова.'),Math.max(0,Date.parse(data.profile.expires_at)-Date.now()));
  updateOperatorUI();await loadLocal();await syncNow();scheduleSync();focusActiveTerminalInput();
}
async function initOperatorAccess() {
  const fragment=new URLSearchParams(location.hash.slice(1));
  operatorSetupToken=fragment.get('setup')||'';
  if(operatorSetupToken){history.replaceState(null,'',location.pathname+location.search);$('operatorSetupKey').value=operatorSetupToken;}
  $('operatorLoginForm').addEventListener('submit',async event=>{
    event.preventDefault();const button=$('operatorLoginBtn');button.disabled=true;$('operatorMessage').textContent='';
    try{
      const setup=$('operatorLoginForm').dataset.setup==='true';
      if(setup && $('operatorPin').value!==$('operatorPinConfirm').value)throw new Error('Повторный PIN не совпадает');
      const args={p_employee_id:$('operatorEmployeeId').value.trim(),p_pin:$('operatorPin').value,p_terminal:terminalId()};
      if(setup)args.p_setup_token=$('operatorSetupKey').value.trim();
      const result=await operatorRpc(setup?'scanner_operator_setup':'scanner_operator_login',args);
      $('operatorPin').value='';$('operatorPinConfirm').value='';
      if(result.status!=='ok')throw new Error(result.status==='locked'?'Слишком много попыток. Повторите через 15 минут.':result.status==='setup_denied'?'Проверьте ID создателя и одноразовый ключ настройки.':'Неверный ID или PIN.');
      operatorSetupToken='';$('operatorSetupKey').value='';await acceptOperatorSession(result);
    }catch(error){$('operatorMessage').textContent=error.message;}finally{button.disabled=false;}
  });
  $('operatorLogout').addEventListener('click',async()=>{
    if(state.opLock || operatorContext.saving){showToast('ПОДОЖДИТЕ','Операция ещё сохраняется','warn');return;}
    const session=operatorContext.profile?.session_id;
    try{if(navigator.onLine)await operatorRpc('scanner_operator_logout');else await recordOperatorAction('logout_offline',{offline:true});}catch(_){await recordOperatorAction('logout_offline',{offline:true});}
    lockOperator('Сеанс завершён. Следующий сотрудник вводит свой ID и PIN.');
    tabChannel?.postMessage({type:'operator_logout',session});
  });
  $('ownerOperatorForm').addEventListener('submit',saveManagedOperator);
  $('operatorList').addEventListener('click',manageOperatorClick);
  $('refreshOwnerAudit').addEventListener('click',()=>refreshOwnerAudit(false));
  $('nextOwnerAudit').addEventListener('click',()=>refreshOwnerAudit(true));
  $('ownerAuditExport').addEventListener('click',exportOwnerAudit);
  const end=new Date(),start=new Date();start.setHours(0,0,0,0);
  const local=d=>new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,16);
  $('ownerAuditFrom').value=local(start);$('ownerAuditTo').value=local(new Date(end.getTime()+60000));
  let cached;try{cached=JSON.parse(sessionStorage.getItem('sklad_operator_session')||'null');}catch(_){}
  if(cached?.token && Date.parse(cached.profile?.expires_at)>Date.now()){
    operatorContext.token=cached.token;
    if(!navigator.onLine){await acceptOperatorSession(cached);return;}
    try{const checked=await operatorRpc('scanner_operator_session');if(checked.profile){await acceptOperatorSession({token:cached.token,profile:checked.profile});return;}}catch(_){}
  }
  lockOperator();
  try{
    const status=await operatorRpc('scanner_operator_status');const setup=!status.configured;
    $('operatorLoginForm').dataset.setup=String(setup);
    $('operatorSetupFields').hidden=!setup;
    $('operatorSetupKey').required=setup;$('operatorPinConfirm').required=setup;
    $('operatorPanelTitle').textContent=setup?'Настройка создателя':'Кто работает за постом?';
    $('operatorPanelHint').textContent=setup?'Создатель задаёт свой первый PIN с одноразовым ключом настройки.':'Укажите свой ID и личный PIN. Получатель сканера указывается отдельно при выдаче.';
    $('operatorLoginBtn').textContent=setup?'Задать PIN и начать работу':'Начать работу';
  }catch(error){$('operatorMessage').textContent=`Для входа нужно облако: ${error.message}`;}
}
async function recordOperatorAction(action,details={}) {
  const profile=requireOperator(['queue_reconciliation','cache_refresh'].includes(action));
  const captured={profile:{...profile},key:operatorContext.key};
  const body={id:crypto.randomUUID(),kind:'client_action',action,details,employee_id:profile.employee_id,session_id:profile.session_id,terminal:terminalId(),captured_at:nowIso()};
  const payload=JSON.stringify(body);const proof={session:profile.session_id,payload,signature:bytesHex(await crypto.subtle.sign('HMAC',captured.key,new TextEncoder().encode(payload)))};
  const tx=db.transaction('queue','readwrite'),done=transactionDone(tx);tx.objectStore('queue').add({type:'operator_action',id:body.id,actor:profile.employee_id,serials:[],proof,ts:body.captured_at});await done;await updateQueueStatus();scheduleSync(150);return {status:'saved_locally'};
}
async function loadOperatorList() {
  requireOperator(true);$('operatorList').textContent='Загрузка…';
  try{const rows=await operatorRpc('scanner_operator_manage',{p_action:'list'});
    $('operatorList').innerHTML=rows.map(row=>`<div class="managed-operator"><div><strong>${esc(row.display_name||'Без имени')}</strong><small>ID ${esc(row.employee_id)} · ${row.role==='owner'?'создатель':row.active?'доступ включён':'доступ отключён'}</small></div>${row.role==='owner'?'':`<div><button type="button" class="btn-hud" data-pin-reset="${esc(row.employee_id)}">Сменить PIN</button><button type="button" class="btn-hud" data-operator-id="${esc(row.employee_id)}" data-operator-action="${row.active?'disable':'enable'}">${row.active?'Отключить':'Включить'}</button></div>`}</div>`).join('');
  }catch(error){$('operatorList').textContent=error.message;}
}
async function saveManagedOperator(event) {
  event.preventDefault();$('managedOperatorError').textContent='';
  try{
    requireOperator(true);const action=$('ownerOperatorForm').dataset.action||'create';
    const managedId=$('managedEmployeeId').value.trim().toUpperCase();
    await operatorRpc('scanner_operator_manage',{p_action:action,p_employee_id:$('managedEmployeeId').value.trim(),p_name:$('managedEmployeeName').value.trim(),p_pin:$('managedEmployeePin').value});
    $('managedEmployeePin').value='';$('ownerOperatorForm').reset();$('ownerOperatorForm').dataset.action='create';$('saveManagedOperator').textContent='Добавить сотрудника';
    if(action==='reset_pin' && managedId===operatorContext.profile?.employee_id){lockOperator('Ваш PIN изменён. Введите новый PIN.');return;}
    await loadOperatorList();
  }catch(error){$('managedOperatorError').textContent=error.message;}
}
async function manageOperatorClick(event) {
  const reset=event.target.closest('[data-pin-reset]');
  if(reset){$('managedEmployeeId').value=reset.dataset.pinReset;$('ownerOperatorForm').dataset.action='reset_pin';$('saveManagedOperator').textContent='Установить новый PIN';$('managedEmployeePin').focus();return;}
  const button=event.target.closest('[data-operator-action]');if(!button)return;
  try{await operatorRpc('scanner_operator_manage',{p_action:button.dataset.operatorAction,p_employee_id:button.dataset.operatorId});await loadOperatorList();}catch(error){$('managedOperatorError').textContent=error.message;}
}
function ownerAuditArgs(before=null,limit=100) {
  const from=new Date($('ownerAuditFrom').value).toISOString(),to=new Date($('ownerAuditTo').value).toISOString();
  SkladCore.reportMoves([],from,to);
  return {p_employee_id:$('ownerAuditEmployee').value.trim()||null,p_from:from,p_to:to,p_before:before,p_limit:limit};
}
function auditDisplayValue(value,key) {
  if(value===null || value===undefined || value==='')return '—';
  if(key==='status')return ({free:'Свободен',issued:'Выдан',repair:'В ремонте'})[value]||String(value);
  if(key==='kind')return ({operator_audit:'Журнал сотрудников'})[value]||String(value);
  if(typeof value==='boolean')return value?'Да':'Нет';
  if(Array.isArray(value))return value.map(item=>auditDisplayValue(item)).join(', ');
  if(typeof value==='object')return Object.entries(value).map(([field,item])=>`${field}: ${auditDisplayValue(item,field)}`).join('; ');
  if(['issued_at','deleted_at','from','to'].includes(key) && !Number.isNaN(Date.parse(value)))return new Date(value).toLocaleString('ru-RU');
  return String(value);
}
function renderAuditDetails(details={}) {
  const fields={serial:'Сканер',model:'Модель',status:'Статус',holder:'Получатель',shift:'Смена',issued_at:'Выдан с',defect:'Неисправность',deleted_at:'Списан'};
  if('before' in details || 'after' in details){
    const before=details.before||{},after=details.after||{};
    const changes=Object.entries(fields).filter(([key])=>JSON.stringify(before[key]??null)!==JSON.stringify(after[key]??null));
    return `<div class="audit-diff-wrap"><table class="audit-diff"><thead><tr><th>Поле</th><th>Было</th><th>Стало</th></tr></thead><tbody>${changes.map(([key,label])=>`<tr><th>${label}</th><td>${esc(auditDisplayValue(before[key],key))}</td><td>${esc(auditDisplayValue(after[key],key))}</td></tr>`).join('')}</tbody></table></div>`;
  }
  const labels={employee_id:'ID сотрудника',serials:'Сканеры',rows:'Количество записей',name:'Копия',kind:'Раздел',from:'С начала',to:'До',offline:'Без сети',count:'Количество',pending:'Ожидает отправки'};
  const entries=Object.entries(details).filter(([key])=>!['operation_id','version'].includes(key));
  return entries.length?`<dl class="audit-details">${entries.map(([key,value])=>`<div><dt>${esc(labels[key]||key)}</dt><dd>${esc(auditDisplayValue(value,key))}</dd></div>`).join('')}</dl>`:'<p class="text-muted">Дополнительных сведений нет.</p>';
}
function renderOwnerAudit(rows) {
  return rows.map(row=>`<article class="owner-audit-row"><div><time>${esc(new Date(row.occurred_at).toLocaleString('ru-RU'))}</time><strong>${esc(row.operator_employee_id||'Автор не указан')}</strong><span>${esc(row.display_name||'')}</span>${row.terminal_id?`<span>Пост: ${esc(row.terminal_id)}</span>`:''}</div><div><strong>${esc(OPERATOR_ACTIONS[row.action]||row.action)}</strong><span class="${row.outcome==='ok'?'':'activity-pending'}">${row.outcome==='ok'?'выполнено':row.outcome==='conflict'?'конфликт':'отказ'}</span>${row.details?.serial?`<code>${esc(row.details.serial)}</code>`:''}<details><summary>Что изменилось</summary>${renderAuditDetails(row.details)}</details></div></article>`).join('');
}
async function refreshOwnerAudit(next=false) {
  requireOperator(true);$('ownerAuditError').textContent='';
  try{const rows=await operatorRpc('scanner_owner_audit',ownerAuditArgs(next?ownerAuditCursor:null));if(!next)$('ownerAuditList').innerHTML='';$('ownerAuditList').insertAdjacentHTML('beforeend',renderOwnerAudit(rows));ownerAuditCursor=rows.at(-1)?.id||null;$('nextOwnerAudit').disabled=rows.length<100;if(!rows.length&&!next)$('ownerAuditList').textContent='За выбранный период действий нет.';}
  catch(error){$('ownerAuditError').textContent=error.message;}
}
async function exportOwnerAudit() {
  try{
    requireOperator(true);let before=null,rows=[];
    while(true){const batch=await operatorRpc('scanner_owner_audit',ownerAuditArgs(before,200));rows.push(...batch);if(batch.length<200)break;before=batch.at(-1).id;}
    const cols=['occurred_at','operator_employee_id','display_name','action','outcome','serial','terminal_id','details'];
    const csv='\uFEFFВремя;ID оператора;Имя;Действие;Результат;Сканер;Пост;Изменения\n'+rows.map(row=>cols.map(key=>SkladCore.csvSafe(key==='serial'?row.details?.serial:key==='details'?JSON.stringify(row.details):row[key])).join(';')).join('\n');
    const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download='operator-actions.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),5000);
    await recordOperatorAction('report_export',{kind:'operator_audit',rows:rows.length});
  }catch(error){$('ownerAuditError').textContent=error.message;}
}
