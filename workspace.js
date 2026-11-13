/* Operator workspace: presentation and read-only history; mutations stay in app.js/data.js. */
let workspaceView = 'terminal';
let activityRequest = 0;
let commandIndex = 0;
const workspaceViews = {
  terminal: { title: 'Рабочий терминал', eyebrow: 'ПОСТ ВЫДАЧИ И ПРИЁМКИ', description: 'Сканируйте бейдж, затем устройство. Выдача сохранится автоматически.' },
  fleet: { title: 'Парк сканеров', eyebrow: 'ОБОРУДОВАНИЕ И СОТРУДНИКИ', description: 'Найдите устройство, проверьте статус или откройте историю выдач.' },
  ownerAudit:{title:'Действия сотрудников',eyebrow:'ЖУРНАЛ СОЗДАТЕЛЯ',description:'Кто, когда и что изменил. Фильтр по ID сотрудника и периоду.'},
  operators:{title:'Операторы и PIN',eyebrow:'УПРАВЛЕНИЕ ДОСТУПОМ',description:'Сотрудники создают PIN при первом входе. Здесь можно управлять их доступом.'},
  activity: { title: 'История операций', eyebrow: 'ЖУРНАЛ РАБОЧЕГО ПОСТА', description: 'Выдачи, возвраты и ремонт — в одной последовательности событий.' }
};
function setWorkspaceView(view, { focus = false } = {}) {
  if (!workspaceViews[view]) return;
  if(['ownerAudit','operators'].includes(view))requireOperator(true);
  if (view !== 'terminal' && document.body.classList.contains('focus-mode')) toggleFocusMode(false);
  workspaceView = view;
  const info = workspaceViews[view];
  $('workspaceTitle').replaceChildren(document.createTextNode(info.title));
  const dot = document.createElement('span'); dot.className = 'title-dot'; dot.textContent = '.';
  $('workspaceTitle').append(dot);
  $('workspaceEyebrow').textContent = info.eyebrow;
  $('workspaceDescription').textContent = info.description;
  $('workspaceBreadcrumb').textContent = info.title;
  $('terminalWorkspace').hidden = view !== 'terminal';
  $('fleetRegistry').hidden = !['terminal','fleet'].includes(view);
  document.querySelector('.metrics-grid').hidden = !['terminal','fleet'].includes(view);
  document.querySelector('.telemetry-strip').hidden = view !== 'terminal';
  $('activityWorkspace').hidden = view !== 'activity';
  $('ownerAuditWorkspace').hidden=view!=='ownerAudit';
  $('operatorsWorkspace').hidden=view!=='operators';
  if(view==='ownerAudit')refreshOwnerAudit();
  if(view==='operators')loadOperatorList();
  document.querySelector('.terminal-ready').hidden = view !== 'terminal';
  document.querySelectorAll('[data-view]').forEach(button => {
    const active = button.dataset.view === view;
    button.classList.toggle('active', active);
    if (active) button.setAttribute('aria-current', 'page'); else button.removeAttribute('aria-current');
  });
  if (view === 'activity') refreshActivity();
  if (focus) {
    if (view === 'fleet') $('searchTable').focus();
    else if (view === 'terminal') focusActiveTerminalInput();
    else $('refreshActivity').focus();
  }
}
function toggleFocusMode(force) {
  const enabled = typeof force === 'boolean' ? force : !document.body.classList.contains('focus-mode');
  if (enabled && workspaceView !== 'terminal') setWorkspaceView('terminal');
  document.body.classList.toggle('focus-mode', enabled);
  $('focusToggle').setAttribute('aria-pressed', String(enabled));
  $('focusToggle').querySelector('span').textContent = enabled ? 'Вернуть панели' : 'Режим поста';
  $('focusToggle').title = enabled ? 'Вернуть все панели (F8)' : 'Режим поста (F8)';
  if (enabled) focusActiveTerminalInput();
}
function updateSoundButton() {
  $('soundToggle').setAttribute('aria-pressed', String(Boolean(state.soundMuted)));
  $('soundToggle').setAttribute('aria-label', state.soundMuted ? 'Включить звуки' : 'Выключить звуки');
  $('soundToggle').title = state.soundMuted ? 'Звуки выключены' : 'Звуки операций включены';
}
function updateScanContext() {
  if (!$('scanFocusHint')) return;
  let text = 'Начните с бейджа сотрудника';
  const active = document.activeElement?.id;
  if (active === 'issSn') text = 'Выдача · шаг 2 из 2 · сканер';
  else if (active === 'issWorker') text = 'Выдача · шаг 1 из 2 · бейдж';
  else if (active === 'retQuery') text = 'Приёмка · один скан для возврата';
  else if (active === 'defSn' || active === 'defReason') text = 'Ремонт · сканер и причина';
  $('scanFocusHint').textContent = state.dataVerified ? text : 'Ожидание первой загрузки парка';
  document.querySelector('.terminal-ready>div').firstChild.textContent = state.dataVerified ? 'Готов к сканированию' : 'Подготовка поста';
}
const workspaceCommands = [
  { name: 'Выдать сканер', keywords: 'выдача бейдж', key: 'F1', run: () => { setWorkspaceView('terminal'); $('issWorker').focus(); } },
  { name: 'Принять сканер', keywords: 'возврат приёмка', key: 'F2', run: () => { setWorkspaceView('terminal'); setRightMode('return'); } },
  { name: 'Отправить сканер в ремонт', keywords: 'брак неисправность', key: 'F3', run: () => { setWorkspaceView('terminal'); setRightMode('defect'); } },
  { name: 'Найти сканер или сотрудника', keywords: 'поиск парк реестр', key: 'Ctrl K', run: () => setWorkspaceView('fleet', { focus: true }) },
  { name: 'История последних операций', keywords: 'журнал события', key: '', run: () => setWorkspaceView('activity', { focus: true }) },
  { name: 'Включить / выключить режим поста', keywords: 'фокус экран', key: 'F8', run: () => toggleFocusMode() },
  { name: 'Отчёт по операциям', keywords: 'csv excel период', key: 'Ctrl E', run: () => exportExcel() },
  { ownerOnly:true,name: 'Резервные копии', keywords: 'бэкап восстановление', key: '', run: () => openBackupModal() },
  { ownerOnly:true,name: 'Импорт сканеров', keywords: 'добавить загрузить', key: 'Ctrl I', run: () => { openModal('impModal'); $('impText').focus(); } },
  { name: 'Очередь и синхронизация', keywords: 'офлайн конфликты диагностика', key: '', run: () => showDiag() },
  { ownerOnly:true,name: 'Списание сканера', keywords: 'удалить обслуживание', key: '', run: () => openDeleteModal() }
];
function filteredCommands() {
  const query = $('commandSearch').value.trim().toLocaleLowerCase('ru');
  return workspaceCommands.filter(c => (!c.ownerOnly||operatorContext.profile?.role==='owner') && `${c.name} ${c.keywords}`.toLocaleLowerCase('ru').includes(query));
}
function renderCommands() {
  const commands = filteredCommands();
  commandIndex = Math.max(0, Math.min(commandIndex, commands.length - 1));
  $('commandList').innerHTML = commands.length ? commands.map((c, i) => `<button type="button" class="command-result ${i === commandIndex ? 'selected' : ''}" data-command-index="${i}"><span>${esc(c.name)}</span>${c.key ? `<kbd>${esc(c.key)}</kbd>` : ''}</button>`).join('') : '<p class="command-foot">Команды не найдены. Попробуйте «приёмка» или «отчёт».</p>';
  $('commandList').querySelector('.selected')?.scrollIntoView({ block: 'nearest' });
}
function openCommands() {
  if (document.querySelector('.modal-overlay.show') || $('auditDrawer').classList.contains('open')) return;
  $('commandSearch').value = ''; commandIndex = 0;
  openModal('commandModal'); renderCommands();
  $('commandSearch').focus();
}
function runCommand(index) {
  const command = filteredCommands()[index];
  if (!command) return;
  closeModal('commandModal');
  // Focus restoration from the closed dialog happens first; the chosen task then gets focus.
  setTimeout(() => command.run(), 1);
}
async function refreshActivity() {
  const request = ++activityRequest;
  const status = $('activityStatus'); status.textContent = 'Загрузка журнала…';
  $('refreshActivity').disabled = true;
  try {
    const local = db ? await requestResult(db.transaction('moves').objectStore('moves').getAll()) : [];
    const queue = db ? await readQueueWithKeys() : [];
    const pending = new Set(queue.flatMap(({ value: op }) => (op.changes || []).map(c => `${op.id}:${c.serial}`)));
    let remote = [], errorMessage = '';
    if (cloud && navigator.onLine) {
      try {
        const { data, error } = await withTimeout(cloud.from('movements').select('id,event_id,serial,action,worker,created_at,terminal_id,operator_employee_id').order('id', { ascending: false }).limit(50), NET_TIMEOUT_MS, 'журнал');
        if (error) throw error;
        remote = data || [];
      } catch (error) { errorMessage = error.message; }
    }
    if (request !== activityRequest) return;
    const seen = new Set();
    const rows = [...remote, ...local].filter(row => {
      const key = row.event_id || row.moveId || `${row.serial}|${row.action}|${row.created_at}`;
      if (seen.has(key)) return false;
      seen.add(key); return true;
    }).sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at)).slice(0, 50);
    $('activityList').innerHTML = rows.length ? rows.map(row => {
      const time = new Date(row.created_at);
      const waiting = pending.has(row.event_id || row.moveId);
      const validTime = Number.isFinite(time.getTime());
      return `<div class="activity-row"><time>${validTime ? esc(time.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })) : '—'}</time><div>${esc(row.action || 'Операция')}<small>${validTime ? esc(time.toLocaleDateString('ru-RU')) : 'Время не указано'} · <span class="${waiting ? 'activity-pending' : ''}">${waiting ? 'ожидает отправки' : row.event_id ? 'подтверждено облаком' : 'локальная запись'}</span></small></div><div class="mono">${esc(row.serial || '—')}</div><div>${esc(row.worker || 'Без сотрудника')}<small>Оператор: ${esc(row.operator_employee_id||'автор не указан')}</small></div></div>`;
    }).join('') : '<p class="debt-empty-modal">Операций пока нет. После первой выдачи здесь появится запись.</p>';
    status.textContent = errorMessage ? `Показан журнал этого поста. Облачный журнал недоступен: ${errorMessage}` : !navigator.onLine ? 'Офлайн · показан сохранённый журнал этого поста' : `Последние события: ${rows.length}. Полный отчёт доступен в сервисном меню.`;
  } catch (error) { if (request === activityRequest) status.textContent = `Не удалось загрузить журнал: ${error.message}`; }
  finally { if (request === activityRequest) $('refreshActivity').disabled = false; }
}
window.addEventListener('DOMContentLoaded', () => {
  try { state.soundMuted = localStorage.getItem('sklad_sound_muted') === 'true'; } catch (_) { state.soundMuted = false; }
  updateSoundButton();
  document.querySelectorAll('[data-view]').forEach(button => button.addEventListener('click', () => setWorkspaceView(button.dataset.view, { focus: true })));
  $('focusToggle').addEventListener('click', () => toggleFocusMode());
  $('soundToggle').addEventListener('click', () => {
    state.soundMuted = !state.soundMuted;
    try { localStorage.setItem('sklad_sound_muted', String(state.soundMuted)); } catch (_) {}
    updateSoundButton();
  });
  $('commandLauncher').addEventListener('click', openCommands);
  $('commandSearch').addEventListener('input', () => { commandIndex = 0; renderCommands(); });
  $('commandList').addEventListener('click', event => { const row = event.target.closest('[data-command-index]'); if (row) runCommand(Number(row.dataset.commandIndex)); });
  $('refreshActivity').addEventListener('click', refreshActivity);
  document.addEventListener('focusin', updateScanContext);
  new MutationObserver(updateScanContext).observe($('syncText'), { childList: true, characterData: true, subtree: true });
  document.addEventListener('click', event => {
    if (event.target.closest('[data-action="issue"]')) setWorkspaceView('terminal');
  }, true);
  document.addEventListener('keydown', event => {
    if(!operatorActive())return;
    const modal = document.querySelector('.modal-overlay.show');
    if (event.ctrlKey && event.code === 'Space') {
      event.preventDefault(); event.stopImmediatePropagation();
      if ($('commandModal').classList.contains('show')) closeModal('commandModal'); else openCommands();
      return;
    }
    if ($('commandModal').classList.contains('show')) {
      if (['ArrowDown', 'ArrowUp'].includes(event.key)) {
        event.preventDefault(); event.stopImmediatePropagation();
        const count = filteredCommands().length;
        if (count) commandIndex = (commandIndex + (event.key === 'ArrowDown' ? 1 : -1) + count) % count;
        renderCommands();
      } else if (event.key === 'Enter' && !event.target.closest('[data-close-modal]')) {
        event.preventDefault(); event.stopImmediatePropagation();
        const row = event.target.closest('[data-command-index]');
        runCommand(row ? Number(row.dataset.commandIndex) : commandIndex);
      }
      return;
    }
    if (modal || $('auditDrawer').classList.contains('open')) return;
    if (event.key === 'F8') { event.preventDefault(); event.stopImmediatePropagation(); toggleFocusMode(); }
    else if (event.key === 'Escape' && document.body.classList.contains('focus-mode')) { event.preventDefault(); event.stopImmediatePropagation(); toggleFocusMode(false); }
    else if (['F1', 'F2', 'F3'].includes(event.key)) setWorkspaceView('terminal');
    else if (event.ctrlKey && event.key.toLowerCase() === 'k') setWorkspaceView('fleet');
  }, true);
  updateScanContext();
});
