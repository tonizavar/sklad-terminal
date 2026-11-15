/* PIN sessions bind the offline outbox to its original operator. */
const operatorContext = { profile: null, token: null, key: null, saving: 0, timer: null, clock: null };
let ownerAuditCursor = null;
const OPERATOR_ACTIONS = { login:'Вход', logout:'Выход', logout_offline:'Выход на устройстве без сети', owner_setup:'Настройка создателя', operator_register:'Самостоятельная регистрация', issue:'Выдача', return:'Приёмка', repair:'Ремонт', repair_complete:'Возврат из ремонта', retire:'Списание', register:'Регистрация сканера', device_update:'Изменение устройства', device_operation:'Операция с устройством', operator_create:'Добавление оператора', operator_reset_pin:'Сброс PIN', operator_disable:'Отключение оператора', operator_enable:'Включение оператора', report_export:'Экспорт отчёта', fleet_export:'Экспорт парка', print_act:'Печать акта', queue_reconciliation:'Согласование очереди', cache_refresh:'Перезагрузка кэша', backup_create:'Создание копии', backup_list:'Просмотр копий', backup_download:'Скачивание копии', backup_delete:'Скрытие копии' };
function serverNowMs() {
 const clock=operatorContext.clock;
 return clock ? clock.serverAt+performance.now()-clock.performanceAt : Date.now();
}
function setOperatorClockOffset(offsetMs) {
 operatorContext.clock=Number.isFinite(offsetMs)?{offsetMs,serverAt:Date.now()+offsetMs,performanceAt:performance.now()}:null;
}
function calibrateOperatorClock(serverTime) {
 const serverAt=Date.parse(serverTime);
 if(!Number.isFinite(serverAt))throw new Error('Сервер не подтвердил время. Повторите вход.');
 setOperatorClockOffset(serverAt-Date.now());lastClockSyncAt=Date.now();
}
function saveOperatorSession() {
 try{sessionStorage.setItem('sklad_operator_session',JSON.stringify({token:operatorContext.token,profile:operatorContext.profile,pinVerified:true,clockOffsetMs:operatorContext.clock?.offsetMs??null}));}catch(_){}
}
function scheduleOperatorLock() {
 clearTimeout(operatorContext.timer);
 operatorContext.timer=setTimeout(()=>lockOperator('Время сессии истекло. Введите ID и PIN.'),Math.max(0,Date.parse(operatorContext.profile.expires_at)-serverNowMs()));
}
function operatorActive() { return Boolean(operatorContext.profile && operatorContext.token && Date.parse(operatorContext.profile.expires_at)>serverNowMs()); }
function requireOperator(owner = false) {
  if (!operatorActive()) { lockOperator(); throw new Error('Введите ID и PIN'); }
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
  const {data,error,status}=await withTimeout(cloud.rpc(name,args),NET_TIMEOUT_MS,'оператор');
  if (error) throw Object.assign(new Error(error.message), { code: error.code, connectionUnavailable: status === 0 || [502,503,504].includes(status) });
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
  document.querySelector('.workspace-footer>span').textContent=p?`Пост · ID оператора ${p.employee_id}`:'Пост · требуется ID оператора';
}
function lockOperator(message='') {
  if (operatorContext.saving || state.opLock) { clearTimeout(operatorContext.timer);operatorContext.timer=setTimeout(()=>lockOperator(message),500);return; }
  operatorContext.profile=null;operatorContext.token=null;operatorContext.key=null;operatorContext.clock=null;
  clearTimeout(operatorContext.timer);clearUndo();
  try{sessionStorage.removeItem('sklad_operator_session');}catch(_){}
  document.querySelectorAll('.modal-overlay.show').forEach(el=>closeModal(el.id));closeAuditDrawer();
  state.devices=[];renderTable();
  if(typeof setWorkspaceView==='function')setWorkspaceView('terminal');
  clearAllInputsAndFocus();
  $('searchTable').value = '';
  $('impText').value = '';
  $('operatorEmployeeId').value = '';
  $('lastOperation').hidden = true;
  $('operatorList').replaceChildren();
  $('terminalList').replaceChildren();
  $('ownerAuditList').replaceChildren();
  $('ownerAuditEmployee').value = '';
  setOperatorEnrollment(false);
  $('operatorMessage').textContent=message;
  updateOperatorUI();setTimeout(()=>$('operatorEmployeeId').focus(),0);
}
async function acceptOperatorSession(data) {
  if(!data.profile || !data.token)throw new Error('Сервер не подтвердил оператора');
  operatorContext.profile=data.profile;operatorContext.token=data.token;
  setOperatorClockOffset(Number.isFinite(data.clockOffsetMs)?data.clockOffsetMs:null);
  if(!data.server_time && !Number.isFinite(data.clockOffsetMs) && navigator.onLine){
    const checked=await operatorRpc('scanner_operator_session');
    if(!checked?.profile || checked.profile.session_id!==data.profile.session_id)throw new Error('Доступ изменён. Введите ID и PIN.');
    data={...data,profile:checked.profile,server_time:checked.server_time};operatorContext.profile=data.profile;
  }
  if(data.server_time)calibrateOperatorClock(data.server_time);
  operatorContext.key=await operatorSigningKey(data.token);
  saveOperatorSession();scheduleOperatorLock();
  updateOperatorUI();refreshSmartShift();await loadLocal();await syncNow();scheduleSync();focusActiveTerminalInput();
}
function setOperatorEnrollment(enrolling) {
  $('operatorEnroll').setAttribute('aria-pressed', String(enrolling));
  $('operatorEnroll').textContent = enrolling ? 'Уже есть PIN? Войти' : 'Первый вход / создать PIN';
  $('operatorEnrollFields').hidden = !enrolling;
  $('operatorPinRepeat').disabled = !enrolling;
  $('operatorPinRepeat').required = enrolling;
  $('operatorPinRepeat').value = '';
  $('operatorPin').value = '';
  $('operatorPin').autocomplete = enrolling ? 'new-password' : 'current-password';
  $('operatorPinLabel').textContent = enrolling ? 'Придумайте PIN' : 'PIN';
  $('operatorLoginBtn').textContent = enrolling ? 'Создать PIN и войти' : 'Войти';
}
async function initOperatorAccess() {
  $('operatorEnroll').addEventListener('click', () => {
    setOperatorEnrollment($('operatorEnrollFields').hidden);
    $('operatorMessage').textContent = '';
    ($('operatorEmployeeId').value.trim() ? $('operatorPin') : $('operatorEmployeeId')).focus();
  });
  $('operatorEmployeeId').addEventListener('keydown', event => {
    if (event.key === 'Enter' && $('operatorEmployeeId').value.trim()) {
      event.preventDefault();
      $('operatorPin').focus();
    }
  });
  $('operatorLoginForm').addEventListener('submit',async event=>{
    event.preventDefault();
    const button=$('operatorLoginBtn');
    if (button.disabled) return;
    button.disabled=true; $('operatorEnroll').disabled=true; $('operatorMessage').textContent='';
    const enrolling = !$('operatorEnrollFields').hidden;
    try {
      const employee = $('operatorEmployeeId').value.trim();
      const pin = $('operatorPin').value;
      if (!/^[a-z0-9_.-]{2,45}$/i.test(employee)) throw new Error('Проверьте ID. Допустимы латинские буквы, цифры, точка, дефис и подчёркивание.');
      if (!/^[0-9]{6,12}$/.test(pin)) throw new Error('PIN должен содержать от 6 до 12 цифр.');
      if (enrolling && pin !== $('operatorPinRepeat').value) throw new Error('PIN не совпадают.');
      const args = {p_employee_id:employee,p_pin:pin,p_terminal:terminalId()};
      const result=await operatorRpc(enrolling ? 'scanner_operator_register' : 'scanner_operator_login',args);
      if(result.status!=='ok') throw new Error(({
        exists: 'Для этого ID регистрация недоступна. Войдите с действующим PIN или обратитесь к создателю.',
        reserved: 'Для этого ID используйте действующий PIN создателя.',
        owner_required: 'Доступ создателя ещё не настроен.',
        locked: 'Слишком много попыток. Повторите позже.',
        disabled: 'Доступ для этого ID отключён создателем.'
      })[result.status] || 'Проверьте ID и PIN. Если у вас ещё нет PIN, выберите «Первый вход».');
      await acceptOperatorSession(result);
      setOperatorEnrollment(false);
    } catch(error) {
      $('operatorMessage').textContent = error.connectionUnavailable || error.code === 'TIMEOUT' ? 'Не удалось связаться с облаком. Проверьте соединение и повторите вход.' : error.message;
    } finally {
      $('operatorPin').value = '';
      $('operatorPinRepeat').value = '';
      button.disabled=false; $('operatorEnroll').disabled=false;
    }
  });
  $('operatorLogout').addEventListener('click',async()=>{
    if(state.opLock || operatorContext.saving){showToast('ПОДОЖДИТЕ','Операция ещё сохраняется','warn');return;}
    const session=operatorContext.profile?.session_id;
    try {
      if (!navigator.onLine) throw new Error('Офлайн');
      await operatorRpc('scanner_operator_logout');
    } catch (_) {
      try { await recordOperatorAction('logout_offline',{offline:true}); } catch (error) { reportLocalError(error); }
    }
    lockOperator('Сеанс завершён. Следующий сотрудник вводит ID и PIN.');
    tabChannel?.postMessage({type:'operator_logout',session});
  });
  $('operatorList').addEventListener('click',manageOperatorClick);
  $('refreshTerminals').addEventListener('click', () => refreshTerminals());
  $('terminalList').addEventListener('submit', event => {
    event.preventDefault();
    const form = event.target;
    if (form.dataset.terminalId) refreshTerminals({ p_terminal:form.dataset.terminalId, p_label:new FormData(form).get('label') });
  });
  $('refreshOwnerAudit').addEventListener('click',()=>refreshOwnerAudit(false));
  $('nextOwnerAudit').addEventListener('click',()=>refreshOwnerAudit(true));
  $('ownerAuditExport').addEventListener('click',exportOwnerAudit);
  let cached;try{cached=JSON.parse(sessionStorage.getItem('sklad_operator_session')||'null');}catch(_){}
  setOperatorClockOffset(cached?.clockOffsetMs);
  const end=new Date(serverNowMs()),start=new Date(serverNowMs());start.setHours(0,0,0,0);
  const local=d=>new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,16);
  $('ownerAuditFrom').value=local(start);$('ownerAuditTo').value=local(new Date(end.getTime()+60000));
  if(cached?.pinVerified === true && cached.token){
    operatorContext.token=cached.token;
    if(!navigator.onLine && Date.parse(cached.profile?.expires_at)>serverNowMs()){await acceptOperatorSession(cached);return;}
    if(navigator.onLine)try {
      const checked=await operatorRpc('scanner_operator_session');
      if (checked?.profile) { await acceptOperatorSession({token:cached.token,profile:checked.profile,server_time:checked.server_time}); return; }
      lockOperator('Доступ изменён. Введите ID и PIN.');
      return;
    } catch (error) {
      if ((error.connectionUnavailable || error.code === 'TIMEOUT') && Date.parse(cached.profile?.expires_at)>serverNowMs()) { await acceptOperatorSession(cached); return; }
    }
  }
  lockOperator();
}
let lastHeartbeatAt = 0;
let lastClockSyncAt = 0;
let heartbeatSession;
async function refreshOperatorClock(session) {
  if(Date.now()-lastClockSyncAt<300000)return;
  lastClockSyncAt=Date.now();
  try {
    const checked=await operatorRpc('scanner_operator_session');
    if(operatorContext.profile?.session_id!==session)return;
    if(!checked?.profile){lockOperator('Доступ изменён. Введите ID и PIN.');return;}
    operatorContext.profile=checked.profile;calibrateOperatorClock(checked.server_time);
    saveOperatorSession();scheduleOperatorLock();updateOperatorUI();
  } catch(error) {
    if(operatorContext.profile?.session_id===session && error.code==='42501' && /LOGIN_REQUIRED/.test(error.message))lockOperator('Доступ изменён. Введите ID и PIN.');
  }
}
function maybeSendTerminalHeartbeat(session) {
  if (!operatorActive() || operatorContext.profile.session_id !== session) return;
  if (heartbeatSession === session && Date.now() - lastHeartbeatAt < 60000) return;
  heartbeatSession = session;
  lastHeartbeatAt = Date.now();
  operatorRpc('scanner_workstation_heartbeat').catch(error => {
    if (operatorContext.profile?.session_id === session && error.code === '42501' && /LOGIN_REQUIRED/.test(error.message)) lockOperator('Доступ изменён. Введите ID и PIN.');
  });
  refreshOperatorClock(session);
}
let terminalListRequest = 0;
async function refreshTerminals(args = {}) {
  const session = requireOperator(true).session_id;
  const request = ++terminalListRequest;
  const status = $('terminalListStatus');
  status.textContent = 'Загрузка постов…';
  try {
    const terminals = await operatorRpc('scanner_manage_workstations', args);
    if (request !== terminalListRequest || session !== operatorContext.profile?.session_id) return;
    $('terminalList').innerHTML = terminals.map(post => {
      const name = post.label || `Пост ${post.terminal_id.slice(0,8)}`;
      const time = new Date(post.last_seen_at).toLocaleString('ru-RU');
      return `<div class="managed-operator"><div><strong>${esc(name)}</strong><small>Последняя связь ${esc(time)} · ID ${esc(post.employee_id)}</small></div><form class="terminal-edit" data-terminal-id="${esc(post.terminal_id)}"><input name="label" class="hud-input" aria-label="Название ${esc(name)}" maxlength="60" value="${esc(post.label)}" placeholder="Название поста"><button class="btn-hud">Сохранить</button></form></div>`;
    }).join('');
    status.textContent = terminals.length ? '' : 'Посты появятся после первой синхронизации.';
  } catch (error) {
    if (request === terminalListRequest && session === operatorContext.profile?.session_id) status.textContent = error.message;
  }
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
    $('operatorList').innerHTML=rows.map(row=>`<div class="managed-operator"><div><strong>${esc(row.display_name||'Без имени')}</strong><small>ID ${esc(row.employee_id)} · ${row.role==='owner'?'создатель':row.active?'доступ включён':'доступ отключён'}</small></div>${row.role==='owner'?'':`<div><button type="button" class="btn-hud" data-operator-id="${esc(row.employee_id)}" data-operator-action="${row.active?'disable':'enable'}">${row.active?'Отключить':'Включить'}</button></div>`}</div>`).join('');
  }catch(error){$('operatorList').textContent=error.message;}
}
async function manageOperatorClick(event) {
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
