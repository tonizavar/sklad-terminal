/* Backup scheduling/retention runs on the server, independently of open browsers. */
async function backupRpc(action, name = null) {
  requireAccess(true);
  const { data, error } = await withTimeout(cloud.rpc('scanner_backup', { p_action: action, p_name: name }), NET_TIMEOUT_MS, 'бэкап');
  if (error) throw error;
  return data;
}
async function doBackup() {
  try {
    const result = await backupRpc('create');
    showToast('БЭКАП СОЗДАН', `${result.total} сканеров · ${result.name}`);
    await renderBackupList();
  } catch (e) { showToast('ОШИБКА БЭКАПА', e.message, 'err'); }
}
async function downloadJsonBackup() {
  requireAccess(true);
  const moves = db ? await requestResult(db.transaction('moves').objectStore('moves').getAll()) : [];
  downloadJson({ version: 12, created_at: nowIso(), devices: state.devices, movements: moves, queue: await readQueueWithKeys(), last_cloud_confirmation: state.lastSyncAt }, `sklad-local-${Date.now()}.json`);
  showToast('ЛОКАЛЬНЫЙ СНИМОК СКАЧАН', 'Включает локальное состояние и неотправленные операции');
}
async function renderBackupList() {
  const wrap = $('backupList'); wrap.textContent = 'Загрузка…';
  try {
    const files = await backupRpc('list');
    wrap.innerHTML = files.map(f => `<div class="backup-row"><div class="backup-info"><div class="backup-name">${esc(f.name)}</div><div class="backup-meta">${esc(new Date(f.created_at).toLocaleString('ru-RU'))} · ${Math.ceil(f.metadata.size / 1024)} КБ</div></div><div><button type="button" class="backup-btn-restore" data-bk-action="restore" data-bk-file="${esc(f.name)}">Сравнить и восстановить</button><button type="button" class="backup-btn-delete" aria-label="Удалить копию ${esc(f.name)}" data-bk-action="delete" data-bk-file="${esc(f.name)}">🗑</button></div></div>`).join('') || 'Резервных копий пока нет. Создайте первую копию.';
  } catch (e) { wrap.textContent = `Не удалось получить копии: ${e.message}`; }
}
async function restoreFromBackup(filename) {
  try {
    requireAccess(true);
    if ((await readQueueWithKeys()).length) throw new Error('Сначала отправьте или согласуйте неотправленные операции');
    const backup = await backupRpc('download', filename);
    if (!Array.isArray(backup.devices) || backup.devices.length > 500) throw new Error('Копия должна содержать не более 500 сканеров для одной атомарной операции');
    const devices = backup.devices.map(normalizeCloudDevice);
    if (!devices.length || devices.some(d => !d)) throw new Error('Копия не содержит корректного парка');
    devices.forEach(SkladCore.validateDevice);
    if (new Set(devices.map(d => d.serial)).size !== devices.length) throw new Error('В копии повторяются серийные номера');
    const remote = await pullAllDevices({ full: true });
    if (remote === null) throw new Error('Не удалось проверить текущее состояние облака');
    await applyPull(remote);
    const diff = SkladCore.backupDiff(state.devices, devices);
    if (!await askConfirmDialog('Сравнение с резервной копией', `Добавится: ${diff.added}. Изменится: ${diff.changed}.\nБудет перезаписано активных выдач: ${diff.activeIssues}.\nОстальные устройства сохранятся. Журнал останется, восстановление будет записано отдельным событием.`, 'Восстановить после сверки')) return;
    // Capture the reviewed versions; saveDeviceChanges checks them again transactionally.
    const before = new Map(remote.devices.map(d => [d.serial, d]));
    await saveDeviceChanges(devices.map(d => ({ dev: { ...d, version: before.get(d.serial)?.version }, actionName: `Восстановление из ${filename}`, workerName: d.holder })), { admin: true });
    closeModal('backupModal');
    showToast('ВОССТАНОВЛЕНИЕ СОХРАНЕНО ЛОКАЛЬНО', 'Дождитесь подтверждения облака');
  } catch (e) { showToast('ВОССТАНОВЛЕНИЕ ОСТАНОВЛЕНО', e.message, 'err'); }
}
async function deleteBackup(filename) {
  try {
    requireAccess(true);
    if (!await askConfirmDialog('Удаление резервной копии', `Удалить ${filename}?`)) return;
    await backupRpc('delete', filename);
    await renderBackupList();
  } catch (e) { showToast('ОШИБКА', e.message, 'err'); }
}
function openBackupModal() { if (sessionAccess.role === 'admin') { openModal('backupModal'); renderBackupList(); } }
