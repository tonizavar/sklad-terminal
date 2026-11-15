/* IndexedDB transactions and the durable operation outbox. No network writes to tables. */
let db = null;
let cloud = null;
let syncScheduledTimer = null;
let syncScheduledAt = Infinity;
let syncInFlight = null;
const terminalContext = { id: null };
const PAGE_SIZE = 100;
let tabChannel;
function transactionDone(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = resolve;
    tx.onabort = () => reject(tx.error || new Error('Транзакция прервана'));
    tx.onerror = () => reject(tx.error || new Error('Ошибка локальной БД'));
  });
}
function requestResult(req) {
  return new Promise((resolve, reject) => { req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error); });
}
function requireReady() {
  requireOperator();
  if (!terminalContext.id || !db || !state.dbReady) throw new Error('Локальная база недоступна. Операции временно заблокированы.');
}
async function initStorage() {
  const req = indexedDB.open('SkladDB', 4);
  req.onupgradeneeded = () => {
    const d = req.result;
    if (!d.objectStoreNames.contains('devices')) d.createObjectStore('devices', { keyPath: 'serial' });
    if (!d.objectStoreNames.contains('queue')) d.createObjectStore('queue', { autoIncrement: true });
    if (!d.objectStoreNames.contains('moves')) d.createObjectStore('moves', { autoIncrement: true });
    if (!d.objectStoreNames.contains('meta')) d.createObjectStore('meta');
    const q = req.transaction.objectStore('queue');
    if (!q.indexNames.contains('serials')) q.createIndex('serials', 'serials', { multiEntry: true });
    const moves = req.transaction.objectStore('moves');
    if (!moves.indexNames.contains('serial')) moves.createIndex('serial', 'serial');
  };
  req.onblocked = () => showToast('БАЗА ЗАНЯТА', 'Закройте старые вкладки терминала', 'warn');
  try {
    db = await requestResult(req);
    db.onversionchange = () => { db.close(); state.dbReady = false; setSync(false, 'Обновите страницу'); };
    state.dbReady = true;
    if (typeof BroadcastChannel !== 'undefined') {
      tabChannel = new BroadcastChannel('sklad-v12');
      tabChannel.onmessage = event => { if(event.data?.type==='operator_logout' && event.data.session===operatorContext.profile?.session_id) lockOperator('Сеанс завершён в другой вкладке.'); else if(terminalContext.id && operatorActive())loadLocal().catch(reportLocalError); };
    }
    // A real server snapshot is required before fresh installations allow operations.
    const meta = await requestResult(db.transaction('meta').objectStore('meta').get('snapshot'));
    state.dataVerified = Boolean(meta?.verified);
    state.lastSyncAt = meta?.at || null;
    await rotateMovesIfNeeded();
  } catch (e) {
    state.dbReady = false;
    setSync(false, 'Локальная БД недоступна — операции заблокированы');
    reportLocalError(e);
  }
}
function reportLocalError(e) { state.lastError = e.message; showToast('ОШИБКА ХРАНЕНИЯ', e.message, 'err'); }
async function loadLocal() {
  if (!db || !terminalContext.id || !operatorActive()) return;
  const tx = db.transaction(['devices', 'meta']);
  const [rows, snapshot] = await Promise.all([requestResult(tx.objectStore('devices').getAll()), requestResult(tx.objectStore('meta').get('snapshot'))]);
  if (!operatorActive()) return;
  state.dataVerified = Boolean(snapshot?.verified);
  state.lastSyncAt = snapshot?.at || null;
  state.devices = rows.filter(d => !d.deleted_at).map(normalizeCloudDevice).filter(Boolean);
  state.tablePage = Math.min(state.tablePage || 0, Math.max(0, Math.ceil(state.devices.length / PAGE_SIZE) - 1));
  renderTable();
  updateIssBanner(fixLayout($('issSn')?.value || ''));
  await updateQueueStatus();
  checkDebtors();
}
async function rotateMovesIfNeeded() {
  if (!db) return;
  const tx = db.transaction('moves', 'readwrite');
  const done = transactionDone(tx);
  const store = tx.objectStore('moves');
  const req = store.count();
  req.onsuccess = () => {
    let remove = req.result > MOVES_ROTATE_THRESHOLD ? req.result - MOVES_ROTATE_KEEP : 0;
    if (!remove) return;
    const cursor = store.openCursor();
    cursor.onsuccess = () => { const c = cursor.result; if (c && remove-- > 0) { c.delete(); c.continue(); } };
  };
  await done;
}
async function readQueueWithKeys() {
  if (!db || !state.dbReady) throw new Error('Локальная база недоступна');
  const tx = db.transaction('queue');
  const s = tx.objectStore('queue');
  const [keys, values] = await Promise.all([requestResult(s.getAllKeys()), requestResult(s.getAll())]);
  return keys.map((key, i) => ({ key, value: values[i] }));
}
function markLastOperation(meta, id, status) {
  const request = meta.get('lastOperation');
  request.onsuccess = () => {
    if (request.result?.id === id) meta.put({ ...request.result, status }, 'lastOperation');
  };
}
async function deleteQueueKey(key, operation) {
  const tx = db.transaction(['queue', 'meta'], 'readwrite'); const done = transactionDone(tx);
  tx.objectStore('queue').delete(key);
  if (operation?.type === 'operation') markLastOperation(tx.objectStore('meta'), operation.id, 'confirmed');
  await done;
}
function saveDevice(dev, actionName, workerName) { return saveDeviceChanges([{ dev, actionName, workerName }]); }
async function saveDeviceChanges(changes, options={}) {
  requireReady();const profile=requireOperator(Boolean(options.admin));
  if(!state.dataVerified)throw new Error('Дождитесь первой успешной загрузки данных из облака');
  if(!changes.length||changes.length>500||new Set(changes.map(c=>c.dev.serial)).size!==changes.length)throw new Error('Некорректный список сканеров');
  const captured={profile:{...profile},key:operatorContext.key};operatorContext.saving++;
  try{
    const id=crypto.randomUUID(),at=nowIso();
    const read=db.transaction('devices');
    const originals=await Promise.all(changes.map(c=>requestResult(read.objectStore('devices').get(c.dev.serial))));
    const operation={type:'operation',id,actor:profile.employee_id,operator_employee_id:profile.employee_id,terminal:terminalId(),serials:changes.map(c=>c.dev.serial),changes:[],ts:at};
    for(let i=0;i<changes.length;i++){
      const c=changes[i],before=originals[i]||null;
      if(profile.role!=='owner' && (!before||before.deleted_at||c.remove))throw new Error('Регистрация и списание доступны создателю');
      const expected=state.undoExpectedVersions?.has(c.dev.serial)?state.undoExpectedVersions.get(c.dev.serial):c.dev.version;
      if((before?.version||null)!==(expected||null))throw new Error('Данные изменились в другой вкладке. Повторите операцию.');
      const after=c.remove?null:SkladCore.validateDevice({...c.dev,version:`${id}:${c.dev.serial}`,last_move:at,deleted_at:null});
      operation.changes.push({serial:c.dev.serial,before,after,action:c.actionName,worker:c.workerName||'',ts:at});
    }
    operation.proof=await signOperatorOperation(operation,captured);
    if(operatorContext.profile?.session_id!==profile.session_id)throw new Error('Оператор изменился. Повторите операцию.');
    const tx=db.transaction(['devices','queue','moves','meta'],'readwrite'),done=transactionDone(tx);let failure,remaining=operation.changes.length;
    for(const change of operation.changes){
      const req=tx.objectStore('devices').get(change.serial);
      req.onsuccess=()=>{try{
        if((req.result?.version||null)!==(change.before?.version||null))throw new Error('Данные изменились в другой вкладке. Повторите операцию.');
        if(change.after)tx.objectStore('devices').put(change.after);else tx.objectStore('devices').delete(change.serial);
        tx.objectStore('moves').add({serial:change.serial,action:change.action,worker:change.worker,created_at:at,moveId:`${id}:${change.serial}`,operator_employee_id:profile.employee_id,operator_session_id:profile.session_id,operator_id:null,terminal_id:operation.terminal});
        if (--remaining === 0) {
          tx.objectStore('queue').add(operation);
          tx.objectStore('meta').put({ id, actor: profile.employee_id, serials: operation.serials, status: 'local' }, 'lastOperation');
        }
      }catch(error){failure=error;tx.abort();}};
    }
    try{await done;}catch(error){throw failure||error;}
    state.lastSavedSerials=operation.serials;state.repairMap={};
    try{localStorage.removeItem(REPAIR_MAP_KEY);}catch(_){}
    for(const c of operation.changes){state.devices=state.devices.filter(d=>d.serial!==c.serial);if(c.after)state.devices.push(c.after);}
    await loadLocal().catch(reportLocalError);tabChannel?.postMessage('changed');scheduleSync(150);
  }finally{operatorContext.saving--;}
}
async function deleteSerial(sn) {
  requireReady();requireOperator(true);
  const dev = state.devices.find(d => d.serial === sn);
  if (dev) await saveDeviceChanges([{ dev, remove: true, actionName: 'Списание сканера', workerName: dev.holder }], { admin: true });
}
async function updateQueueStatus() {
  if (!db) return;
  const [queue, last] = await Promise.all([
    readQueueWithKeys(), requestResult(db.transaction('meta').objectStore('meta').get('lastOperation'))
  ]);
  state.pendingCount = queue.length;
  state.conflictCount = queue.filter(x => x.value.conflict || !['operation','operator_action'].includes(x.value.type)).length;
  const at = state.lastSyncAt ? new Date(state.lastSyncAt).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }) : 'ещё не было';
  $('syncDetail').textContent = `Локально сохранено · ожидает: ${queue.length} · конфликтов: ${state.conflictCount} · облако: ${at}`;
  const activity = $('lastOperation');
  activity.hidden = !operatorActive() || !last || last.actor !== operatorContext.profile.employee_id;
  if (!activity.hidden) {
    const label = { local: 'сохранено на этом ПК', confirmed: 'подтверждено облаком', conflict: 'требуется сверка', reviewed: 'сверено с облаком' }[last.status];
    const serials = last.serials.length <= 2 ? last.serials.join(' → ') : `${last.serials.length} устройств`;
    const text = `Последняя операция · ${serials} · ${label}`;
    if (activity.textContent !== text) activity.textContent = text;
  }
}
async function setQueueConflict(key, message) {
  const tx = db.transaction(['queue','meta'], 'readwrite'), done = transactionDone(tx);
  const s = tx.objectStore('queue'), req = s.get(key);
  req.onsuccess = () => { if (req.result) {
    s.put({ ...req.result, conflict: message }, key);
    if (req.result.type === 'operation') markLastOperation(tx.objectStore('meta'), req.result.id, 'conflict');
  } };
  await done;
}
function syncNow() {
  if (syncInFlight) return syncInFlight;
  if (!db || !state.dbReady || !cloud || !terminalContext.id || !operatorActive()) return Promise.resolve(null);
  syncInFlight = syncWithCloud().finally(() => { syncInFlight = null; });
  return syncInFlight;
}
async function syncWithCloud() {
  if (!navigator.onLine) { setSync(false, 'Офлайн — сохранение локально'); return false; }
  state.syncing = true;
  try {
    const run = async () => {
      const queue = await readQueueWithKeys();
      if (queue.length && !queue[0].value.conflict) setSync(true, 'Синхронизация…', true);
      const blockedSerials = new Set();
      const serialsOf = op => Array.isArray(op.serials) ? op.serials : [op.serial || op.dev?.serial].filter(Boolean);
      const blockOperation = (op, extra = []) => { for (const sn of [...serialsOf(op), ...extra]) blockedSerials.add(sn); };
      for (const { key, value: op } of queue) {
        if (!operatorActive()) break;
        const serials = serialsOf(op);
        if (op.conflict || serials.some(sn => blockedSerials.has(sn))) { blockOperation(op); continue; }
        if (!['operation','operator_action'].includes(op.type) || !op.proof) {
          await setQueueConflict(key, 'Очередь старой версии: скачайте её и согласуйте с администратором');
          blockOperation(op);
          continue;
        }
        if(op.type==='operator_action'){
          const {data,error}=await withTimeout(cloud.rpc('scanner_record_signed_action',{p_session:op.proof.session,p_payload:op.proof.payload,p_signature:op.proof.signature}),NET_TIMEOUT_MS,'журнал');
          if(error){if(error.code==='42501'){await setQueueConflict(key,error.message);if(op.proof.session===operatorContext.profile?.session_id){lockOperator('Доступ изменён. Введите ID и PIN.');break;}continue;}throw error;}if(data?.status!=='applied')throw new Error('Запись журнала не подтверждена');await deleteQueueKey(key, op);continue;
        }
        const { data, error } = await withTimeout(cloud.rpc('scanner_apply', {p_id:op.id,p_changes:op.changes,p_events:[],p_terminal:op.terminal,p_session:op.proof.session,p_payload:op.proof.payload,p_signature:op.proof.signature}), NET_TIMEOUT_MS, 'операция');
        if(error){if(error.code==='42501'){await setQueueConflict(key,error.message);blockOperation(op);if(op.proof.session===operatorContext.profile?.session_id){lockOperator('Доступ изменён. Введите ID и PIN.');break;}continue;}throw error;}
        if (data?.status === 'conflict') {
          await setQueueConflict(key, `Состояние изменено другим терминалом: ${(data.serials || []).join(', ')}`);
          blockOperation(op, data.serials || []);
          continue;
        }
        if (data?.status !== 'applied') throw new Error('Сервер не подтвердил операцию');
        await deleteQueueKey(key, op);
      }
      if(!operatorActive()){setSync(false,'Введите ID и PIN');await updateQueueStatus();return null;}
      const session = operatorContext.profile.session_id;
      const data = await pullAllDevices();
      if (!operatorActive() || operatorContext.profile.session_id !== session) return null;
      await applyPull(data);
      await updateQueueStatus();
      maybeSendTerminalHeartbeat(session);
      setSync(!state.conflictCount, state.conflictCount ? 'Требуется сверка с облаком' : state.pendingCount ? `Ожидает отправки: ${state.pendingCount}` : 'Подтверждено облаком');
      return true;
    };
    // Cross-tab exclusion prevents duplicate uploads, not just a per-tab boolean.
    return navigator.locks ? await navigator.locks.request('sklad-sync', { ifAvailable: true }, lock => lock ? run() : null) : await run();
  } catch (e) {
    if(e.code==='42501' && /LOGIN_REQUIRED/.test(e.message))lockOperator('Введите ID и PIN.');
    state.lastError = e.message || 'Ошибка синхронизации';
    setSync(false, 'Нет подтверждения облака');
    await updateQueueStatus().catch(reportLocalError);
    return false;
  } finally { state.syncing = false; }
}
async function pullAllDevices(options = {}) {
  const snapshot = await requestResult(db.transaction('meta').objectStore('meta').get('snapshot'));
  const baseCursor = snapshot?.cursor || 0;
  const { data, error } = await withTimeout(cloud.rpc('scanner_pull', { p_after: options.full ? 0 : baseCursor }), NET_TIMEOUT_MS, 'загрузка изменений');
  if (error) throw error;
  if (!data || !Array.isArray(data.devices) || !Number.isSafeInteger(data.cursor) || typeof data.full !== 'boolean') throw new Error('Некорректный ответ синхронизации');
  return { ...data, baseCursor };
}
async function applyPull(snapshot, reviewed = []) {
  if (!snapshot || !Array.isArray(snapshot.devices) || !db) throw new Error('Некорректный ответ облака');
  const data = snapshot.devices;
  const at = nowIso();
  const changed = snapshot.full || data.length > 0;
  const tx = db.transaction(['devices', 'queue', 'meta'], 'readwrite'), done = transactionDone(tx);
  const meta = tx.objectStore('meta');
  const current = meta.get('snapshot');
  const store = tx.objectStore('devices');
  let applied = false;
  current.onsuccess = () => {
    // A slow response must not roll back a newer snapshot from another tab or action.
    if (snapshot.baseCursor !== (current.result?.cursor || 0)) return;
    applied = true;
    const queueStore = tx.objectStore('queue');
    // Archive only the packets the operator reviewed, in the same commit as the merge.
    for (const item of reviewed) {
      meta.put(item.value, `conflict:${Date.now()}:${item.key}`);
      queueStore.delete(item.key);
      if (item.value?.type === 'operation') markLastOperation(meta, item.value.id, 'reviewed');
    }
    if (!changed) { meta.put({ verified: true, at, cursor: snapshot.cursor }, 'snapshot'); return; }
    const queue = queueStore.getAll();
    queue.onsuccess = () => {
      const protectedSn = new Set();
      for (const op of queue.result) {
        for (const sn of op.serials || []) protectedSn.add(sn);
        if (op.dev?.serial) protectedSn.add(op.dev.serial);
        if (op.serial) protectedSn.add(op.serial);
      }
      let skipped = false;
      const merge = () => {
        for (const raw of data) {
          if (protectedSn.has(raw.serial)) { skipped = true; continue; }
          if (raw.deleted_at) { store.put(raw); continue; }
          const d = normalizeCloudDevice(raw);
          if (d) store.put(d);
        }
        // Read skipped cloud changes again when the local packet is cleared.
        meta.put({ verified: true, at, cursor: skipped ? (snapshot.full ? 0 : snapshot.baseCursor) : snapshot.cursor }, 'snapshot');
      };
      if (snapshot.full) {
        const records = new Set(data.map(d => d.serial));
        const keys = store.getAllKeys();
        keys.onsuccess = () => {
          for (const sn of keys.result) {
            if (records.has(sn)) continue;
            if (protectedSn.has(sn)) skipped = true;
            else store.delete(sn);
          }
          merge();
        };
      } else merge();
    };
  };
  await done;
  if (changed || !applied) {
    await loadLocal();
    if (applied) tabChannel?.postMessage('changed');
  } else {
    state.dataVerified = true;
    state.lastSyncAt = at;
  }
  return applied;
}
function setSync(ok, txt, busy = false) {
  const p = $('syncStatus');
  p.className = `pill-badge ${ok ? 'pill-online' : 'pill-offline'}${busy ? ' syncing' : ''}`;
  $('syncText').textContent = txt;
}
function scheduleSync(delay = syncInterval()) {
  if (!terminalContext.id || !operatorActive()) return;
  const due = Date.now() + delay;
  if (due >= syncScheduledAt) return;
  clearTimeout(syncScheduledTimer);
  syncScheduledAt = due;
  syncScheduledTimer = setTimeout(async () => {
    syncScheduledAt = Infinity;
    if (syncInFlight) {
      await syncInFlight;
      scheduleSync(delay);
      return;
    }
    const ok = await syncNow();
    if (ok === null) { scheduleSync(1000); return; }
    state.syncBackoff = ok ? 0 : Math.min((state.syncBackoff || 0) + 1, 5);
    scheduleSync(ok ? syncInterval() : Math.min(syncInterval() * 2 ** state.syncBackoff, SYNC_MAX_INTERVAL));
  }, delay);
}
function syncInterval() { return document.hidden ? SYNC_BACKGROUND_INTERVAL : SYNC_BASE_INTERVAL; }
async function forceSync() { closeModal('diagModal'); await syncNow(); scheduleSync(); }
async function retryQueuedSync() { await forceSync(); }
async function renderQueuePreview() {
  try {
    return (await readQueueWithKeys()).slice(0, 30).map(({ value: op }) => `<div class="queue-preview">${esc(op.type)} · ${esc((op.serials || [op.serial || op.dev?.serial]).join(', '))}${op.conflict ? `<br><strong>${esc(op.conflict)}</strong>` : ''}</div>`).join('') || 'Очередь пуста';
  } catch (e) { return esc(e.message); }
}
async function downloadQueue() {
  requireReady();
  downloadJson({ exported_at: nowIso(), queue: await readQueueWithKeys() }, 'sklad-pending-operations.json');
}
async function resolveQueueFromCloud() {
  requireReady();requireOperator(true);
  const conflicts = (await readQueueWithKeys()).filter(item => item.value.conflict);
  if (!conflicts.length) { showToast('НЕТ КОНФЛИКТОВ', 'Неподтверждённые операции останутся в очереди. Повторите синхронизацию.', 'warn'); return; }
  const ok = await askConfirmDialog('Согласование с облаком', `Конфликтных пакетов: ${conflicts.length}. Только они будут сохранены в локальный архив конфликтов; их рабочее состояние будет загружено из облака. Остальные операции останутся в очереди. Сначала скачайте очередь. Применяйте после сверки фактической выдачи.`, 'Принять облачное состояние');
  if (!ok) return;
  await recordOperatorAction('queue_reconciliation',{reviewed_packets:conflicts.length});
  const data = await pullAllDevices({ full: true });
  if (!await applyPull(data, conflicts)) throw new Error('Парк обновился во время загрузки. Повторите сверку.');
  await updateQueueStatus();
  scheduleSync(100);
}
async function hardReset() {
  requireReady();requireOperator(true);
  if ((await readQueueWithKeys()).length) { showToast('СБРОС ОСТАНОВЛЕН', 'Сначала согласуйте неотправленные операции', 'warn'); return; }
  if (!await askConfirmDialog('Перезагрузка кэша', 'Загрузить актуальное состояние из облака? Локальный журнал будет сохранён.')) return;
  await recordOperatorAction('cache_refresh');
  const data = await pullAllDevices({ full: true });
  if (!await applyPull(data)) throw new Error('Парк обновился во время загрузки. Повторите операцию.');
  closeModal('diagModal');
}
function terminalId() {
  let id = localStorage.getItem('sklad_terminal_id');
  if (!id) { id = crypto.randomUUID(); localStorage.setItem('sklad_terminal_id', id); }
  return id;
}
function downloadJson(value, name) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }));
  const a = document.createElement('a'); a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
