/* IndexedDB transactions and the durable operation outbox. No network writes to tables. */
let db = null;
let cloud = null;
let syncScheduledTimer = null;
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
      tabChannel.onmessage = () => { if (terminalContext.id) loadLocal().catch(reportLocalError); };
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
  if (!db || !terminalContext.id) return;
  const rows = await requestResult(db.transaction('devices').objectStore('devices').getAll());
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
async function deleteQueueKey(key) {
  const tx = db.transaction('queue', 'readwrite'); const done = transactionDone(tx);
  tx.objectStore('queue').delete(key); await done;
}
function saveDevice(dev, actionName, workerName) { return saveDeviceChanges([{ dev, actionName, workerName }]); }
async function saveDeviceChanges(changes, options = {}) {
  requireReady();
  if (!db || !state.dbReady || !state.dataVerified) throw new Error('Дождитесь первой успешной загрузки данных из облака');
  if (!changes.length || changes.length > 500) throw new Error('Одна операция должна содержать от 1 до 500 сканеров');
  if (new Set(changes.map(c => c.dev.serial)).size !== changes.length) throw new Error('Повторный сканер в операции');
  const id = crypto.randomUUID(), at = nowIso();
  const operation = { type: 'operation', id, actor: terminalContext.id, terminal: terminalId(), serials: changes.map(c => c.dev.serial), changes: [], ts: at };
  const tx = db.transaction(['devices', 'queue', 'moves'], 'readwrite');
  const done = transactionDone(tx);
  const devices = tx.objectStore('devices'), queue = tx.objectStore('queue');
  let failure;
  for (const c of changes) {
    const req = devices.get(c.dev.serial);
    req.onsuccess = () => {
      try {
        const before = req.result || null;
        const expected = state.undoExpectedVersions?.has(c.dev.serial) ? state.undoExpectedVersions.get(c.dev.serial) : c.dev.version;
        if ((before?.version || null) !== (expected || null)) throw new Error('Данные изменились в другой вкладке. Повторите операцию.');
        const after = c.remove ? null : SkladCore.validateDevice({ ...c.dev, version: `${id}:${c.dev.serial}`, last_move: at, deleted_at: null });
        const change = { serial: c.dev.serial, before, after, action: c.actionName, worker: c.workerName || '', ts: at };
        operation.changes.push(change);
        if (after) devices.put(after);
        else devices.delete(c.dev.serial);
        tx.objectStore('moves').add({ serial: c.dev.serial, action: c.actionName, worker: c.workerName || '', created_at: at, moveId: `${id}:${c.dev.serial}`, operator_id: null, terminal_id: operation.terminal });
        if (operation.changes.length === changes.length) queue.add(operation);
      } catch (e) { failure = e; tx.abort(); }
    };
  }
  try { await done; } catch (e) { throw failure || e; }
  state.lastSavedSerials = operation.serials;
  state.repairMap = {}; // v10 shadow state must never override a committed record.
  try { localStorage.removeItem(REPAIR_MAP_KEY); } catch (_) {}
  for (const change of operation.changes) {
    state.devices = state.devices.filter(d => d.serial !== change.serial);
    if (change.after) state.devices.push(change.after);
  }
  await loadLocal().catch(reportLocalError);
  tabChannel?.postMessage('changed');
  scheduleSync(150);
}
async function deleteSerial(sn) {
  requireReady();
  const dev = state.devices.find(d => d.serial === sn);
  if (dev) await saveDeviceChanges([{ dev, remove: true, actionName: 'Списание сканера', workerName: dev.holder }], { admin: true });
}
async function updateQueueStatus() {
  if (!db) return;
  const queue = await readQueueWithKeys();
  state.pendingCount = queue.length;
  state.conflictCount = queue.filter(x => x.value.conflict || x.value.type !== 'operation').length;
  const at = state.lastSyncAt ? new Date(state.lastSyncAt).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }) : 'ещё не было';
  $('syncDetail').textContent = `Локально сохранено · ожидает: ${queue.length} · конфликтов: ${state.conflictCount} · облако: ${at}`;
}
async function setQueueConflict(key, message) {
  const tx = db.transaction('queue', 'readwrite'), done = transactionDone(tx);
  const s = tx.objectStore('queue'), req = s.get(key);
  req.onsuccess = () => { if (req.result) s.put({ ...req.result, conflict: message }, key); };
  await done;
}
async function syncNow() {
  if (state.syncing || !db || !cloud || !terminalContext.id) return false;
  if (!navigator.onLine) { setSync(false, 'Офлайн — сохранение локально'); return false; }
  state.syncing = true;
  setSync(true, 'Синхронизация…', true);
  try {
    const run = async () => {
      const queue = await readQueueWithKeys();
      for (const { key, value: op } of queue) {
        if (op.conflict) break;
        if (op.type !== 'operation') {
          await setQueueConflict(key, 'Очередь старой версии: скачайте её и согласуйте с администратором');
          break;
        }
        const { data, error } = await withTimeout(cloud.rpc('scanner_apply', { p_id: op.id, p_changes: op.changes, p_events: [], p_terminal: op.terminal }), NET_TIMEOUT_MS, 'операция');
        if (error) throw error;
        if (data?.status === 'conflict') {
          await setQueueConflict(key, `Состояние изменено другим терминалом: ${(data.serials || []).join(', ')}`);
          break; // Preserve dependent operations and every local event.
        }
        if (data?.status !== 'applied') throw new Error('Сервер не подтвердил операцию');
        await deleteQueueKey(key);
      }
      const data = await pullAllDevices();
      if (data === null) throw new Error(state.lastError || 'Не удалось получить парк');
      await applyPull(data);
      await updateQueueStatus();
      const waiting = state.pendingCount > 0;
      setSync(!state.conflictCount, waiting ? `Ожидает отправки: ${state.pendingCount}` : 'Подтверждено облаком');
      return !waiting;
    };
    // Cross-tab exclusion prevents duplicate uploads, not just a per-tab boolean.
    return navigator.locks ? await navigator.locks.request('sklad-sync', { ifAvailable: true }, lock => lock ? run() : false) : await run();
  } catch (e) {
    state.lastError = e.message || 'Ошибка синхронизации';
    setSync(false, 'Нет подтверждения облака');
    await updateQueueStatus();
    return false;
  } finally { state.syncing = false; }
}
async function pullAllDevices(options = {}) {
  try {
    const snapshot = await requestResult(db.transaction('meta').objectStore('meta').get('snapshot'));
    const after = options.full ? 0 : snapshot?.cursor || 0;
    const { data, error } = await withTimeout(cloud.rpc('scanner_pull', { p_after: after }), NET_TIMEOUT_MS, 'загрузка изменений');
    if (error) throw error;
    if (!data || !Array.isArray(data.devices) || !Number.isSafeInteger(data.cursor) || typeof data.full !== 'boolean') throw new Error('Некорректный ответ синхронизации');
    return data;
  } catch (e) { state.lastError = e.message; return null; }
}
async function applyPull(snapshot) {
  if (!snapshot || !Array.isArray(snapshot.devices) || !db) throw new Error('Некорректный ответ облака');
  const data = snapshot.devices;
  const tx = db.transaction(['devices', 'queue', 'meta'], 'readwrite'), done = transactionDone(tx);
  const queue = tx.objectStore('queue').getAll();
  const store = tx.objectStore('devices');
  queue.onsuccess = () => {
    const protectedSn = new Set();
    for (const op of queue.result) {
      for (const sn of op.serials || []) protectedSn.add(sn);
      if (op.dev?.serial) protectedSn.add(op.dev.serial);
      if (op.serial) protectedSn.add(op.serial);
    }
    const records = new Map(data.map(d => [d.serial, d]));
    const keys = store.getAllKeys();
    keys.onsuccess = () => {
      if (snapshot.full) for (const sn of keys.result) if (!protectedSn.has(sn) && !records.has(sn)) store.delete(sn);
      for (const raw of data) {
        if (protectedSn.has(raw.serial)) continue;
        if (raw.deleted_at) { store.put(raw); continue; }
        const d = normalizeCloudDevice(raw);
        if (d) store.put(d);
      }
      tx.objectStore('meta').put({ verified: true, at: nowIso(), cursor: snapshot.cursor }, 'snapshot');
    };
  };
  await done;
  state.dataVerified = true;
  state.lastSyncAt = nowIso();
  state.repairMap = {};
  await loadLocal();
}
function setSync(ok, txt, busy = false) {
  const p = $('syncStatus');
  p.className = `pill-badge ${ok ? 'pill-online' : 'pill-offline'}${busy ? ' syncing' : ''}`;
  $('syncText').textContent = txt;
}
function scheduleSync(delay = SYNC_BASE_INTERVAL) {
  clearTimeout(syncScheduledTimer);
  if (!terminalContext.id) return;
  syncScheduledTimer = setTimeout(async () => {
    const ok = await syncNow();
    state.syncBackoff = ok ? 0 : Math.min((state.syncBackoff || 0) + 1, 5);
    scheduleSync(ok ? SYNC_BASE_INTERVAL : Math.min(SYNC_BASE_INTERVAL * 2 ** state.syncBackoff, SYNC_MAX_INTERVAL));
  }, delay);
}
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
  requireReady();
  const queue = await readQueueWithKeys();
  if (!queue.length) return;
  const ok = await askConfirmDialog('Согласование с облаком', `В очереди ${queue.length} операций. Они будут сохранены в локальный архив конфликтов; рабочее состояние будет загружено из облака. Сначала скачайте очередь. Применяйте после сверки фактической выдачи.`, 'Принять облачное состояние');
  if (!ok) return;
  const data = await pullAllDevices({ full: true });
  if (data === null) throw new Error('Облако недоступно');
  const tx = db.transaction(['queue', 'meta'], 'readwrite'), done = transactionDone(tx);
  const s = tx.objectStore('queue');
  // Remove exactly the reviewed entries; new scans remain protected.
  for (const item of queue) { tx.objectStore('meta').put(item.value, `conflict:${Date.now()}:${item.key}`); s.delete(item.key); }
  await done;
  await applyPull(data);
  await updateQueueStatus();
  scheduleSync(100);
}
async function hardReset() {
  requireReady();
  if ((await readQueueWithKeys()).length) { showToast('СБРОС ОСТАНОВЛЕН', 'Сначала согласуйте неотправленные операции', 'warn'); return; }
  if (!await askConfirmDialog('Перезагрузка кэша', 'Загрузить актуальное состояние из облака? Локальный журнал будет сохранён.')) return;
  const data = await pullAllDevices({ full: true });
  if (data !== null) { await applyPull(data); closeModal('diagModal'); }
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
