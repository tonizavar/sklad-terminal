/* ============================================================
   SKLAD-TERMINAL v12.0 • ПРОМЫШЛЕННОЕ ЯДРО УЧЁТА СКАНЕРОВ
   Архитектура: Offline-First IndexedDB ⇄ Supabase Cloud Sync
   Оборудование: Только сканеры штрихкода (Point Mobile / Zebra RS5100)
   ============================================================ */

const SUPABASE_URL = "https://sgpkvnymkqwuhepkaoxw.supabase.co";
const SUPABASE_KEY = "sb_publishable_dqlmOngeOHVYMFUG1s4kLw_N1Pxi9KW";
const OVERDUE_H = 14;
const OP_COOLDOWN_MS = 1200; // Анти-дубль защита от двойного пика сканера (1.2 сек)
const AUTO_SWAP_KEY = 'sklad_auto_swap_v2';
const THEME_STORAGE_KEY = 'sklad_exec_theme';
const DRAFT_KEY = 'sklad_draft_iss';
const DRAFT_TTL_MS = 5 * 60 * 1000;
const SN_REGEX = /^[A-Z0-9\-_.]{2,60}$/;
const MOVES_ROTATE_THRESHOLD = 6000;
const MOVES_ROTATE_KEEP = 3000;
const DEBT_REGISTRY_KEY = 'sklad_debtors_registry_v12';
const DEBT_RECORDED_KEY = 'sklad_debtors_recorded_v12';
const ALERTED_DEBTORS_KEY = 'sklad_alerted_debtors_v12';
const DEBT_ALERT_DISMISSED_KEY = 'sklad_debt_alert_dismissed';
const REPAIR_MAP_KEY = 'sklad_repair_map_v10';
const NEW_OVERDUE_HIGHLIGHT_MS = 30000;
const NET_TIMEOUT_MS = 15000;
const SYNC_BASE_INTERVAL = 20000;
const SYNC_MAX_INTERVAL = 300000;
const THEMES = ['berry', 'sapphire', 'carbon', 'quartz'];
const THEME_NAMES = {
  berry: '🔮 WB Berry (Корпоративная)',
  sapphire: '💎 Сапфир (Executive Dark)',
  carbon: '🌑 Карбон (Высокий контраст)',
  quartz: '☀️ Светлая (Дневной пост)'
};
const THEME_META_COLORS = {
  berry: '#07040e',
  sapphire: '#060812',
  carbon: '#090a0d',
  quartz: '#eef2f6'
};

const DEBUG = false;
function dbg(...args) { if (DEBUG) console.log('[DBG]', ...args); }

const state = {
  devices: [],
  filter: 'all',
  modelFilter: 'all',
  sortField: 'default',
  sortAsc: true,
  theme: 'berry',
  rightMode: 'return', // 'return' | 'defect'
  issueShift: 'Дневная',
  issueShiftAuto: true,
  workerShifts: {},
  repairMap: {}, // sn -> defect reason
  syncing: false,
  dbReady: false,
  lastError: '—',
  pendingSwap: null,
  justIssued: null,
  justReturned: null,
  autoSwap: false,
  dataVerified: false,
  tablePage: 0,
  pendingCount: 0,
  conflictCount: 0,
  lastSyncAt: null,
  undoAction: null,
  undoTimer: null,
  toastTimer: null,
  flashTimer: null,
  auditSn: null,
  lastDropQuery: null,
  lastRetDropQuery: null,
  syncBackoff: 0,
  issDropNavigated: false,
  opLock: false, // Глобальный мьютекс активной транзакции
  debtorsRegistry: {},
  debtorsRecorded: {},
  alertedDebtors: {},
  justOverdueHighlights: {},
  debtAlertDismissedUntil: 0,
  lastDebtAlertInfo: null,
  sessionOut: 0,
  sessionIn: 0,
  sessionRep: 0,
  recentEvents: []
};

try { const v = localStorage.getItem(AUTO_SWAP_KEY); state.autoSwap = v === 'true'; } catch(e) {}
try { const st = localStorage.getItem(THEME_STORAGE_KEY); if (st && THEMES.includes(st)) state.theme = st; } catch(e) {}
try { state.workerShifts = JSON.parse(localStorage.getItem('sklad_worker_shifts') || '{}'); } catch(e) {}

try { state.debtorsRegistry = JSON.parse(localStorage.getItem(DEBT_REGISTRY_KEY) || '{}'); } catch(e) {}
try { state.debtorsRecorded = JSON.parse(localStorage.getItem(DEBT_RECORDED_KEY) || '{}'); } catch(e) {}
try { state.alertedDebtors = JSON.parse(localStorage.getItem(ALERTED_DEBTORS_KEY) || '{}'); } catch(e) {}
try { state.debtAlertDismissedUntil = parseInt(localStorage.getItem(DEBT_ALERT_DISMISSED_KEY) || '0', 10) || 0; } catch(e) {}

const opCooldownMap = new Map(); // sn -> timestamp защиты от двойного пика сканера
const $ = id => document.getElementById(id);
const nowIso = () => new Date().toISOString();

/* ===== ЗАЩИТА ОТ ДВОЙНОГО ПИКА СКАНЕРА (COOLDOWN LOCK) ===== */
function isSerialInCooldown(sn) {
  if (!sn) return false;
  const key = String(sn).toUpperCase();
  const last = opCooldownMap.get(key) || 0;
  if (Date.now() - last < OP_COOLDOWN_MS) return true;
  opCooldownMap.set(key, Date.now());
  return false;
}

function saveRepairMap() {
  try { localStorage.setItem(REPAIR_MAP_KEY, JSON.stringify(state.repairMap)); } catch(e) {}
}

/* ===== КАСТОМНОЕ МОДАЛЬНОЕ ОКНО ПОДТВЕРЖДЕНИЯ (ВМЕСТО BLOCKED CONFIRM) ===== */
let confirmDialogResolver = null;
function askConfirmDialog(title, message, okLabel = 'Подтвердить (Enter)') {
  if (confirmDialogResolver) resolveConfirmDialog(false);
  return new Promise(resolve => {
    confirmDialogResolver = resolve;
    $('confirmDialogTitle').innerText = title || 'Подтверждение';
    $('confirmDialogMessage').innerText = message || '';
    $('confirmDialogOkBtn').innerText = okLabel;
    openModal('confirmDialogModal');
    setTimeout(() => $('confirmDialogOkBtn')?.focus(), 50);
  });
}
function resolveConfirmDialog(result) {
  const fn = confirmDialogResolver; confirmDialogResolver = null;
  closeModal('confirmDialogModal');
  if (fn) fn(result);
}

/* ===== ТЕМЫ ОФОРМЛЕНИЯ ===== */
function applyTheme(themeName, notify = false) {
  const t = THEMES.includes(themeName) ? themeName : 'berry';
  state.theme = t;
  document.documentElement.setAttribute('data-theme', t);
  const meta = $('metaThemeColor');
  if (meta) meta.setAttribute('content', THEME_META_COLORS[t] || '#07040e');
  document.querySelectorAll('[data-set-theme]').forEach(btn => btn.classList.toggle('active', btn.dataset.setTheme === t));
  try { localStorage.setItem(THEME_STORAGE_KEY, t); } catch(e) {}
  if (notify) showToast('СТИЛЬ ИНТЕРФЕЙСА', THEME_NAMES[t]);
}
function cycleTheme() {
  const i = THEMES.indexOf(state.theme);
  applyTheme(THEMES[(i + 1) % THEMES.length], true);
}
applyTheme(state.theme, false);

/* ===== ПОЛНОЭКРАННАЯ ИНДИКАЦИЯ ("В ОДИН ПИК") И ТИКЕР ===== */
function triggerScanFlash(kind = 'ok') {
  const ov = $('scanFlashOverlay');
  if (!ov) return;
  ov.className = 'scan-flash-overlay ' + (kind === 'err' ? 'flash-err' : (kind === 'warn' ? 'flash-warn' : 'flash-ok'));
  clearTimeout(state.flashTimer);
  state.flashTimer = setTimeout(() => {
    ov.className = 'scan-flash-overlay';
  }, kind === 'err' ? 650 : 380);
}

function pushTickerEvent(kind, sn, worker) {
  const t = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  state.recentEvents.unshift({ kind, sn, worker: worker || 'Склад', t });
  if (state.recentEvents.length > 5) state.recentEvents.pop();
  if (kind === 't-iss' || kind === 't-swp') state.sessionOut++;
  else if (kind === 't-ret') state.sessionIn++;
  else if (kind === 't-rep') state.sessionRep++;
  renderTicker();
}

function renderTicker() {
  const sEl = $('sessionStats');
  if (sEl) sEl.innerText = `Сессия: 📤 ${state.sessionOut} · 📥 ${state.sessionIn} · 🛠 ${state.sessionRep}`;
  const wrap = $('liveTicker');
  if (!wrap || !state.recentEvents.length) return;
  wrap.innerHTML = state.recentEvents.map(ev => {
    const icon = ev.kind === 't-ret' ? '📥' : (ev.kind === 't-swp' ? '🔄' : (ev.kind === 't-rep' ? '🛠' : '📤'));
    return `<span class="ticker-chip ${ev.kind}" data-ticker-sn="${esc(ev.sn)}" title="Клик — открыть досье сканера ${esc(ev.sn)}">${icon} <b>${esc(ev.sn.slice(-4))}</b> · ${esc(ev.worker)} <span style="opacity:0.68;">${ev.t}</span></span>`;
  }).join('');
}

/* ===== КОПИРОВАНИЕ СВОДКИ В БУФЕР ОБМЕНА (С FALLBACK) ===== */
function copyTextSafe(text) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    return navigator.clipboard.writeText(text).catch(() => fallbackCopyText(text));
  }
  return Promise.resolve(fallbackCopyText(text));
}
function fallbackCopyText(text) {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  try { document.execCommand('copy'); } catch(e) {}
  document.body.removeChild(ta);
}

function copyTelegramSummary() {
  let free = 0, issued = 0, repair = 0, overdue = 0, dayCount = 0, nightCount = 0;
  const debts = [];
  state.devices.forEach(d => {
    if (d.status === 'issued') {
      issued++;
      const h = hoursSince(d.issued_at);
      if (h >= OVERDUE_H) { overdue++; debts.push({ sn: d.serial, holder: d.holder, h }); }
      if (d.shift === 'Ночная') nightCount++; else dayCount++;
    } else if (d.status === 'repair') {
      repair++;
    } else {
      free++;
    }
  });
  const dt = new Date().toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  const lines = [
    `📊 СВОДКА ПАРКА СКАНЕРОВ СЦ (${dt} • ${state.issueShift})`,
    `📦 Всего сканеров в парке: ${state.devices.length} шт.`,
    `🟢 Свободно в резерве: ${free} шт.`,
    `⚡ На руках (в смене): ${issued} шт. (☀️ День: ${dayCount} | 🌙 Ночь: ${nightCount})`,
    `🛠 В ремонте / браке: ${repair} шт.`,
    `🚨 Просрочено (>14ч): ${overdue} шт.`
  ];
  debts.sort((a, b) => b.h - a.h).slice(0, 15).forEach(x => {
    lines.push(`  • ${x.sn} — ${x.holder} (${fmtHoursShort(x.h)})`);
  });
  copyTextSafe(lines.join('\n')).then(
    () => showToast('📋 СВОДКА СКОПИРОВАНА', 'Отчёт по парку сканеров готов к отправке руководству'),
    () => showToast('ОШИБКА', 'Не удалось скопировать сводку', 'err')
  );
}

/* ===== УТИЛИТЫ И РАСПОЗНАВАНИЕ ТОЛЬКО СКАНЕРОВ ===== */
function esc(s) {
  return String(s !== null && s !== undefined ? s : '').replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
}
function debounce(fn, ms) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}
function withTimeout(promise, ms, label) {
  let timer;
  const controller = typeof promise.abortSignal === 'function' ? new AbortController() : null;
  const request = controller ? promise.abortSignal(controller.signal) : promise;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`⏱ Таймаут: ${label} (${ms}мс)`));
      controller?.abort();
    }, ms);
  });
  return Promise.race([request, timeout]).finally(() => clearTimeout(timer));
}
function pluralN(n, one, few, many) {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return few;
  return many;
}

const RU = { 'й':'q','ц':'w','у':'e','к':'r','е':'t','н':'y','г':'u','ш':'i','щ':'o','з':'p','х':'[','ъ':']','ф':'a','ы':'s','в':'d','а':'f','п':'g','р':'h','о':'j','л':'k','д':'l','ж':';','э':'\'','я':'z','ч':'x','с':'c','м':'v','и':'b','т':'n','ь':'m','б':',','ю':'.','ё':'`' };
function fixLayout(s) {
  return String(s ? s : '').split('').map(ch => {
    const lo = ch.toLowerCase();
    return RU[lo] !== undefined ? RU[lo] : ch;
  }).join('').toUpperCase().replace(/\s+/g, '');
}
function hasCyr(s) { return /[а-яёА-ЯЁ]/.test(String(s || '')); }

// СТРОГО ТОЛЬКО СКАНЕРЫ: Zebra RS5100 или Point Mobile (без планшетов, раций и рохлей)
function detectScannerModel(sn, rawModel) {
  const s = String(sn || '').toUpperCase().trim();
  const m = String(rawModel || '').toUpperCase().trim();
  if (s.startsWith('S') || m.includes('ZEBRA') || m.includes('RS5100') || m.includes('RS6000')) {
    return 'Zebra RS5100';
  }
  return 'Point Mobile';
}

function formatSnSplit(sn) {
  const s = String(sn || '');
  if (s.length <= 4) return `<span class="sn-tail">${esc(s)}</span>`;
  return `<span class="sn-prefix">${esc(s.slice(0, -4))}</span><span class="sn-tail">${esc(s.slice(-4))}</span>`;
}
function getInitials(h) {
  const s = String(h || '').trim();
  if (!s) return '•';
  const l = s.match(/[А-ЯЁA-Z]/gi);
  if (l && l.length >= 2) return (l[0] + l[1]).toUpperCase();
  return s.slice(-2).toUpperCase();
}
function hoursSince(iso) {
  if (!iso) return 0;
  const t = Date.parse(iso);
  if (isNaN(t)) return 0;
  return Math.max(0, (Date.now() - t) / 3600000);
}
function parseTime(v) {
  if (!v) return 0;
  const t = Date.parse(v);
  return isNaN(t) ? 0 : t;
}
function fmtHoursShort(h) {
  if (!isFinite(h) || h < 0) return '—';
  const m = Math.round(h * 60), H = Math.floor(m / 60), M = m % 60;
  if (H === 0) return M + 'м';
  if (M === 0) return H + 'ч';
  return H + 'ч ' + M + 'м';
}
function timeClass(h) {
  if (!isFinite(h)) return 'fresh';
  if (h >= OVERDUE_H) return 'over';
  if (h >= 8) return 'late';
  if (h >= 4) return 'mid';
  return 'fresh';
}
function timeBarWidth(h) {
  if (!isFinite(h) || h < 0) return 3;
  return Math.max(3, Math.min(100, (h / OVERDUE_H) * 100));
}
function isInheritedTime(d) {
  if (!d || d.status !== 'issued' || !d.issued_at || !d.last_move) return false;
  const t1 = Date.parse(d.last_move), t2 = Date.parse(d.issued_at);
  if (isNaN(t1) || isNaN(t2)) return false;
  return Math.abs(t1 - t2) > 60 * 1000;
}
function logMsg(msg) {
  const t = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const el = $('logStatus');
  if (el) el.textContent = `[${t}] ${msg}`;
}

function hideBoot() {
  const el = $('bootOverlay');
  if (!el) return;
  el.classList.add('hide');
  setTimeout(() => { try { el.remove(); } catch(e) {} }, 450);
}
function bootText(txt) {
  const el = $('bootText');
  if (el) el.textContent = txt;
}
function refreshScrollLock() {
  const anyModal = document.querySelector('.modal-overlay.show');
  const drawer = $('auditDrawer') && $('auditDrawer').classList.contains('open');
  document.body.classList.toggle('no-scroll', !!(anyModal || drawer));
}

/* ===== АВТОФОКУС КОНВЕЙЕРА (SMART FOCUS GUARD) ===== */
function focusActiveTerminalInput() {
  if (!terminalContext.id) return;
  const anyModal = document.querySelector('.modal-overlay.show');
  const drawer = $('auditDrawer') && $('auditDrawer').classList.contains('open');
  if (anyModal || drawer) return;
  if (state.rightMode === 'defect' && document.activeElement === $('defReason')) return;
  const wVal = $('issWorker')?.value.trim() || '';
  if (!wVal) {
    $('issWorker')?.focus();
  } else {
    $('issSn')?.focus();
  }
}

/* ===== ОТМЕНА ПОСЛЕДНЕГО ДЕЙСТВИЯ (CTRL+Z) ===== */
function setUndo(label, cb, ttl = 7000) {
  const versions = new Map((state.lastSavedSerials || []).map(sn => [sn, state.devices.find(d => d.serial === sn)?.version || null]));
  state.undoAction = { label, callback: cb, ttl, versions };
  clearTimeout(state.undoTimer);
  state.undoTimer = setTimeout(() => {
    state.undoAction = null;
    const el = $('toast');
    const b = el?.querySelector('.t-undo');
    if (b) b.remove();
  }, ttl);
}
function clearUndo() {
  state.undoAction = null;
  clearTimeout(state.undoTimer);
  state.undoTimer = null;
  const el = $('toast');
  if (!el) return;
  const b = el.querySelector('.t-undo');
  if (b) b.remove();
}
async function undoLast() {
  if (state.undoAction && state.undoAction.callback) {
    if (state.opLock) return false;
    const { callback: cb, versions } = state.undoAction;
    clearUndo();
    state.undoExpectedVersions = versions;
    try { await cb(); } finally { state.undoExpectedVersions = null; }
    return true;
  }
  return false;
}

function showUndoToast(title, desc, undoLabel, undoCallback, kind = 'ok') {
  clearUndo();
  const el = $('toast');
  $('tTitle').innerText = title;
  $('tDesc').innerText = desc || '';
  $('tIcon').innerText = kind === 'swap' ? '🔁' : (kind === 'warn' ? '🛠' : '✓');
  $('tIcon').style.background = '';
  $('tIcon').style.borderColor = '';
  $('tIcon').style.color = '';
  $('tTitle').style.color = '';
  const oldBtn = el.querySelector('.t-undo');
  if (oldBtn) oldBtn.remove();
  if (undoCallback) {
    const btn = document.createElement('button');
    btn.className = 't-undo';
    btn.innerText = undoLabel || '↩ Отменить (Ctrl+Z)';
    btn.onclick = () => undoLast();
    el.appendChild(btn);
    setUndo(undoLabel, undoCallback, 7000);
  }
  el.className = kind === 'warn' ? 'warn' : '';
  el.classList.add('show');
  clearTimeout(state.toastTimer);
  state.toastTimer = setTimeout(() => {
    el.classList.remove('show');
    setTimeout(() => {
      const b = el.querySelector('.t-undo');
      if (b) b.remove();
    }, 400);
  }, 6500);
}

/* ===== УМНОЕ УПРАВЛЕНИЕ СМЕНАМИ ===== */
function computeSmartShift(worker) {
  const now = new Date();
  const hm = now.getHours() * 60 + now.getMinutes();
  const w = String(worker || '').trim().toUpperCase();
  if (w) {
    const ex = state.devices.find(d => d.status === 'issued' && d.holder && d.holder.toUpperCase() === w && d.shift && d.shift !== '—');
    if (ex) return ex.shift;
    if (state.workerShifts[w]) return state.workerShifts[w];
  }
  if (hm >= 5 * 60 && hm < 6 * 60) return 'Дневная';
  if (hm >= 17 * 60 && hm < 19 * 60) return 'Ночная';
  return (hm >= 6 * 60 && hm < 18 * 60) ? 'Дневная' : 'Ночная';
}
function updateShiftPill() {
  const pill = $('shiftPill');
  if (!pill) return;
  const isDay = state.issueShift === 'Дневная';
  pill.className = 'shift-pill ' + (isDay ? 'day' : 'night') + (state.issueShiftAuto ? '' : ' manual');
  $('shiftIcon').innerText = isDay ? '☀' : '🌙';
  $('shiftLabel').innerText = isDay ? 'ДЕНЬ' : 'НОЧЬ';
  const badge = $('shiftBadge');
  if (state.issueShiftAuto) {
    badge.className = 'badge-auto';
    badge.innerText = 'AUTO';
  } else {
    badge.className = 'badge-manual';
    badge.innerText = 'РУЧН ↻';
  }
  const now = new Date();
  $('shiftTime').innerText = String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0');
}
function saveShiftPref() {
  try { localStorage.setItem('sklad_shift_pref', JSON.stringify({ auto: state.issueShiftAuto, shift: state.issueShift })); } catch(e) {}
}
function toggleShift() {
  if (state.issueShiftAuto) {
    state.issueShift = state.issueShift === 'Дневная' ? 'Ночная' : 'Дневная';
    state.issueShiftAuto = false;
    saveShiftPref();
    updateShiftPill();
    showToast('РУЧНОЙ РЕЖИМ СМЕНЫ', `Смена зафиксирована: ${state.issueShift}`, 'warn');
  } else {
    state.issueShiftAuto = true;
    state.issueShift = computeSmartShift($('issWorker').value.trim());
    saveShiftPref();
    updateShiftPill();
    showToast('АВТОРЕЖИМ СМЕНЫ', 'Смена определяется автоматически по времени', 'warn');
  }
}
function resetShiftToAuto(e) {
  if (e) e.stopPropagation();
  state.issueShiftAuto = true;
  state.issueShift = computeSmartShift($('issWorker').value.trim());
  saveShiftPref();
  updateShiftPill();
  showToast('АВТОРЕЖИМ СМЕНЫ', 'Смена определяется автоматически', 'warn');
}
function refreshSmartShift() {
  if (!state.issueShiftAuto) { updateShiftPill(); return; }
  const w = $('issWorker').value.trim();
  const s = computeSmartShift(w);
  if (s !== state.issueShift) state.issueShift = s;
  updateShiftPill();
}
function rememberWorkerShift(worker, shift) {
  if (!worker) return;
  const key = String(worker).trim().toUpperCase();
  state.workerShifts[key] = shift;
  const keys = Object.keys(state.workerShifts);
  if (keys.length > 500) delete state.workerShifts[keys[0]];
  try { localStorage.setItem('sklad_worker_shifts', JSON.stringify(state.workerShifts)); } catch(e) {}
}
async function toggleDeviceShift(sn) {
  const dev = state.devices.find(d => d.serial === sn);
  if (!dev || dev.status !== 'issued') {
    showToast('НЕДОСТУПНО', 'Сканер не на руках — смена не назначена', 'warn');
    return;
  }
  const oldShift = dev.shift;
  const newShift = oldShift === 'Ночная' ? 'Дневная' : 'Ночная';
  const ts = nowIso();
  const updated = { ...dev, shift: newShift, last_move: ts };
  const idx = state.devices.findIndex(d => d.serial === sn);
  const snapshot = { ...dev };
  if (idx >= 0) state.devices[idx] = updated;
  renderTable();
  try {
    await saveDevice(updated, `Смена вручную: ${oldShift || '—'} → ${newShift}`, dev.holder);
    rememberWorkerShift(dev.holder, newShift);
    beep('issue');
    showToast('СМЕНА ОБНОВЛЕНА', `${sn}: ${oldShift || '—'} → ${newShift} (${dev.holder})`);
    logMsg(`🔀 СМЕНА: ${sn} · ${oldShift || '—'} → ${newShift} · ${dev.holder}`);
    if (state.auditSn === sn) openAudit(sn);
  } catch(e) {
    if (idx >= 0) state.devices[idx] = snapshot;
    renderTable();
    beep('err');
    showToast('ОШИБКА', e.message || 'Не удалось сохранить', 'err');
  }
}

/* ===== АУДИО- И ВИБРО-ИНДИКАЦИЯ ОПЕРАТОРА ===== */
let audioCtx = null;
function beep(type) {
  try {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
    const t = audioCtx.currentTime;
    if (type === 'return') {
      const osc = audioCtx.createOscillator(), g = audioCtx.createGain();
      osc.connect(g); g.connect(audioCtx.destination);
      osc.frequency.setValueAtTime(580, t);
      osc.frequency.exponentialRampToValueAtTime(1180, t + 0.14);
      g.gain.setValueAtTime(0.18, t);
      g.gain.linearRampToValueAtTime(0.01, t + 0.17);
      osc.start(t); osc.stop(t + 0.17);
    } else if (type === 'issue') {
      const osc = audioCtx.createOscillator(), g = audioCtx.createGain();
      osc.connect(g); g.connect(audioCtx.destination);
      osc.frequency.setValueAtTime(880, t);
      osc.frequency.exponentialRampToValueAtTime(1320, t + 0.11);
      g.gain.setValueAtTime(0.15, t);
      g.gain.linearRampToValueAtTime(0.01, t + 0.13);
      osc.start(t); osc.stop(t + 0.13);
    } else if (type === 'swap') {
      const osc = audioCtx.createOscillator(), g = audioCtx.createGain();
      osc.connect(g); g.connect(audioCtx.destination);
      osc.frequency.setValueAtTime(520, t);
      osc.frequency.linearRampToValueAtTime(1120, t + 0.19);
      g.gain.setValueAtTime(0.16, t);
      g.gain.linearRampToValueAtTime(0.01, t + 0.21);
      osc.start(t); osc.stop(t + 0.21);
    } else if (type === 'debt' || type === 'err') {
      for (let i = 0; i < 2; i++) {
        const o2 = audioCtx.createOscillator(), g2 = audioCtx.createGain();
        o2.connect(g2); g2.connect(audioCtx.destination);
        o2.type = 'sawtooth';
        o2.frequency.setValueAtTime(220, t + i * 0.14);
        g2.gain.setValueAtTime(0.20, t + i * 0.14);
        g2.gain.linearRampToValueAtTime(0.01, t + i * 0.14 + 0.12);
        o2.start(t + i * 0.14); o2.stop(t + i * 0.14 + 0.12);
      }
    }
  } catch(e) {}
  try {
    if (navigator.vibrate) {
      navigator.vibrate(type === 'err' ? [80, 40, 80] : (type === 'debt' ? [100, 50, 100] : 35));
    }
  } catch(e) {}
}

/* ===== КОНТРОЛЬ ДОЛЖНИКОВ (>14 ЧАСОВ) ===== */
function saveDebtStorage() {
  try {
    localStorage.setItem(DEBT_REGISTRY_KEY, JSON.stringify(state.debtorsRegistry));
    localStorage.setItem(DEBT_RECORDED_KEY, JSON.stringify(state.debtorsRecorded));
    localStorage.setItem(ALERTED_DEBTORS_KEY, JSON.stringify(state.alertedDebtors));
  } catch(e) {}
}

function checkDebtors() {
  if (!state.dataVerified || !terminalContext.id) return;
  let changed = false;
  state.devices.forEach(d => {
    if (d.status !== 'issued' || !d.holder || !d.issued_at) return;
    if (hoursSince(d.issued_at) < OVERDUE_H) return;
    const holderNorm = d.holder.trim().toUpperCase();
    const key = `${holderNorm}|${d.serial}|${d.issued_at}`;
    if (state.debtorsRecorded[key]) return;
    state.debtorsRecorded[key] = nowIso();
    if (!state.debtorsRegistry[holderNorm]) {
      state.debtorsRegistry[holderNorm] = { name: d.holder.trim(), count: 0, lastDate: null, serials: [] };
    }
    const reg = state.debtorsRegistry[holderNorm];
    reg.name = d.holder.trim();
    reg.count++;
    reg.lastDate = nowIso();
    if (!reg.serials.includes(d.serial)) reg.serials.push(d.serial);
    changed = true;
  });
  if (changed) saveDebtStorage();
}

function alertNewDebtors() {
  const fresh = [];
  state.devices.forEach(d => {
    if (d.status !== 'issued' || !d.holder || !d.issued_at) return;
    if (hoursSince(d.issued_at) < OVERDUE_H) return;
    const alertKey = `${d.serial}|${d.issued_at}`;
    if (state.alertedDebtors[alertKey]) return;
    state.alertedDebtors[alertKey] = nowIso();
    fresh.push(d);
    state.justOverdueHighlights[d.serial] = Date.now();
  });

  if (!fresh.length) { updateDebtBadge(); return; }
  saveDebtStorage();
  beep('debt');

  const byWorker = {};
  fresh.forEach(d => {
    const k = d.holder.trim().toUpperCase();
    if (!byWorker[k]) byWorker[k] = { display: d.holder.trim(), list: [] };
    byWorker[k].list.push(d);
  });

  const workerKeys = Object.keys(byWorker);
  const namesList = `${workerKeys.length} сотрудников — подробности в списке просрочек`;
  state.lastDebtAlertInfo = { namesList, total: fresh.length, workers: workerKeys.length, ts: Date.now() };
  if (Date.now() > state.debtAlertDismissedUntil) {
    showDebtAlertBar(state.lastDebtAlertInfo);
  }
  updateDebtBadge();
  renderTable();
  logMsg(`🚨 ПРОСРОЧКА >14Ч: ${fresh.length} сканеров · ${namesList}`);
}

function showDebtAlertBar(info) {
  const bar = $('debtAlertBar');
  if (!bar) return;
  $('debtAlertTitle').innerText = info.workers === 1 ? '🚨 Обнаружен должник по сканеру!' : `🚨 Обнаружено должников: ${info.workers}`;
  $('debtAlertText').innerText = `${info.namesList} · всего ${info.total} ${pluralN(info.total, 'сканер', 'сканера', 'сканеров')} >14ч`;
  bar.classList.add('show');
}

function dismissDebtAlert() {
  const bar = $('debtAlertBar');
  if (bar) bar.classList.remove('show');
  state.debtAlertDismissedUntil = Date.now() + 30 * 60 * 1000;
  try { localStorage.setItem(DEBT_ALERT_DISMISSED_KEY, String(state.debtAlertDismissedUntil)); } catch(e) {}
}

function updateDebtBadge() {
  const btn = $('debtBtn');
  const badge = $('debtBadge');
  if (!btn || !badge) return;
  const activeCount = state.devices.filter(d => d.status === 'issued' && hoursSince(d.issued_at) >= OVERDUE_H).length;
  if (activeCount > 0) {
    badge.innerText = activeCount > 99 ? '99+' : String(activeCount);
    badge.classList.add('show');
    btn.classList.add('has-debts');
  } else {
    badge.classList.remove('show');
    btn.classList.remove('has-debts');
    const bar = $('debtAlertBar');
    if (bar) bar.classList.remove('show');
  }
}

async function clearDebtHistory() {
  const ok = await askConfirmDialog(
    'Очистка истории нарушений',
    'Очистить всю накопленную историю просрочек?\nТекущие активные выдачи на руках затронуты не будут.',
    'Очистить историю'
  );
  if (!ok) return;
  state.debtorsRegistry = {};
  state.debtorsRecorded = {};
  state.alertedDebtors = {};
  saveDebtStorage();
  openDebtModal();
  showToast('ИСТОРИЯ ОЧИЩЕНА', 'Архив нарушений сброшен', 'warn');
}

/* ===== НОРМАЛИЗАЦИЯ И БЕЗОТКАЗНАЯ СИНХРОНИЗАЦИЯ SUPABASE ===== */
function normalizeCloudDevice(row) {
  if (!row || row.deleted_at) return null;
  const sn = row.serial || row.sn || row.serial_number || row.id;
  if (!sn) return null;
  const cleanSn = String(sn).trim();
  if (!/^[A-Za-z0-9\-_.]+$/.test(cleanSn)) return null;

  // Исключаем любые не-сканерные записи (если когда-то в облаке были планшеты/рохли/рации)
  const rawModelStr = String(row.model || '').toUpperCase();
  if (rawModelStr.includes('ПЛАНШЕТ') || rawModelStr.includes('РОХЛ') || rawModelStr.includes('РАЦИ')) {
    return null;
  }

  const rawHolder = String(row.holder || row.worker || '').trim();
  let status = 'free';
  const s = String(row.status || '').toLowerCase().trim();
  // Локальный repairMap здесь НЕ применяем: облако — источник истины,
  // иначе устаревшая локальная пометка брака «залипает» на этом терминале навсегда.
  if (s === 'repair' || s === 'в ремонте' || s === 'брак') {
    status = 'repair';
  } else if (s === 'issued' || s === 'на руках' || s === 'выдан' || s === 'в работе') {
    status = 'issued';
  } else if (s === 'free' || s === 'на складе' || s === 'свободен') {
    status = 'free';
  } else {
    status = rawHolder.length > 0 ? 'issued' : 'free';
  }

  const cleanHolder = status === 'issued' ? rawHolder : '';
  const issuedAt = status === 'issued' ? (row.issued_at || row.issue_date || null) : null;
  const lastMove = row.last_move || null;
  let shift = row.shift;
  if (!shift || shift === 'null' || shift === '') {
    if (status === 'issued' && issuedAt) {
      const h = new Date(issuedAt).getHours();
      shift = (h >= 6 && h < 18) ? 'Дневная' : 'Ночная';
    } else {
      shift = '—';
    }
  }
  return {
    serial: cleanSn.toUpperCase(),
    version: row.version || null,
    deleted_at: row.deleted_at || null,
    model: detectScannerModel(cleanSn, row.model),
    status,
    holder: cleanHolder,
    issued_at: issuedAt,
    last_move: lastMove,
    shift,
    defect: status === 'repair' ? (row.defect || 'На диагностике') : ''
  };
}

function saveDraft() {
  try {
    const sn = $('issSn').value;
    const worker = $('issWorker').value;
    if (!sn && !worker) { localStorage.removeItem(DRAFT_KEY); return; }
    localStorage.setItem(DRAFT_KEY, JSON.stringify({ sn, worker, ts: Date.now() }));
  } catch(e) {}
}
function restoreDraft() {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (!raw) return;
    const d = JSON.parse(raw);
    if (!d || !d.ts || Date.now() - d.ts > DRAFT_TTL_MS) { localStorage.removeItem(DRAFT_KEY); return; }
    if (d.worker) $('issWorker').value = d.worker;
    if (d.sn) { $('issSn').value = d.sn; updateIssBanner(fixLayout(d.sn)); }
  } catch(e) {}
}
function clearDraft() {
  try { localStorage.removeItem(DRAFT_KEY); } catch(e) {}
}
function clearAllInputsAndFocus() {
  $('issWorker').value = '';
  $('issSn').value = '';
  $('retQuery').value = '';
  $('defSn').value = '';
  $('issWorker').classList.remove('err');
  $('issSn').classList.remove('err', 'warn-busy');
  $('retQuery').classList.remove('err');
  resetIssueDropdown();
  resetRetDropdown();
  resetWorkerDropdown();
  updateIssBanner('');
  clearDraft();
  focusActiveTerminalInput();
}

function resetIssueDropdown() {
  const drop = $('issDrop');
  if (!drop) return;
  drop.classList.remove('show');
  drop.innerHTML = '';
  state.lastDropQuery = null;
}
function resetRetDropdown() {
  const drop = $('retDrop');
  if (!drop) return;
  drop.classList.remove('show');
  drop.innerHTML = '';
  state.lastRetDropQuery = null;
}
function resetWorkerDropdown() {
  const drop = $('workerDrop');
  if (drop) { drop.classList.remove('show'); drop.innerHTML = ''; }
}

/* ===== ПЕРЕКЛЮЧЕНИЕ РЕЖИМОВ ПРАВОГО ПОСТА: ПРИЁМКА (F2) / БРАК (F3) ===== */
function setRightMode(mode) {
  state.rightMode = mode === 'defect' ? 'defect' : 'return';
  const card = $('rightDeckCard');
  const titleEl = $('rightDeckTitle');
  const titleText = $('rightTitleText');
  const tabRet = $('tabModeReturn');
  const tabDef = $('tabModeDefect');
  const paneRet = $('returnPane');
  const paneDef = $('defectPane');

  if (state.rightMode === 'defect') {
    card.classList.add('defect-mode');
    titleEl.style.color = 'var(--amber-text)';
    titleText.innerText = 'ПЕРЕВОД СКАНЕРА В БРАК / РЕМОНТ';
    tabRet.className = 'mode-tab';
    tabDef.className = 'mode-tab active-def';
    paneRet.style.display = 'none';
    paneDef.style.display = 'flex';
    $('defSn')?.focus();
  } else {
    card.classList.remove('defect-mode');
    titleEl.style.color = 'var(--emerald-text)';
    titleText.innerText = 'ПРИЁМКА В 1 ПИК';
    tabRet.className = 'mode-tab active-ret';
    tabDef.className = 'mode-tab';
    paneRet.style.display = 'flex';
    paneDef.style.display = 'none';
    $('retQuery')?.focus();
  }
}

/* ===== LIVE-ИНДИКАЦИЯ СКАНЕРА ПРИ ВВОДЕ ===== */
function updateIssBanner(fixedQuery) {
  const banner = $('issSnBanner');
  const inp = $('issSn');
  if (!banner || !inp) return;
  const q = String(fixedQuery || '').trim().toUpperCase();
  if (q.length < 2) {
    banner.className = 'sn-live-banner';
    banner.innerHTML = '';
    inp.classList.remove('warn-busy');
    $('modelHint').innerText = "F1 • Бейдж ➔ Сканер ➔ Авто-выдача";
    return;
  }
  const exact = state.devices.find(d => d.serial.toUpperCase() === q);
  const tailMatches = state.devices.filter(d => d.serial.toUpperCase().endsWith(q));
  const target = exact || (tailMatches.length === 1 ? tailMatches[0] : null);
  if (target) {
    if (target.status === 'repair') {
      inp.classList.add('err');
      $('modelHint').innerText = `🛠 В РЕМОНТЕ (${target.model})`;
      banner.className = 'sn-live-banner show busy';
      banner.innerHTML = `<div><b>🛠 БЛОКИРОВКА:</b> Сканер <span class="mono">${esc(target.serial)}</span> числится в ремонте (${esc(target.defect || 'неисправен')})</div><button type="button" class="banner-btn-act" data-banner-restore="${esc(target.serial)}">✅ Вернуть в строй</button>`;
      return;
    }
    inp.classList.remove('err');
    if (target.status === 'issued') {
      const h = hoursSince(target.issued_at);
      const shIcon = target.shift === 'Ночная' ? '🌙' : '☀';
      inp.classList.add('warn-busy');
      $('modelHint').innerText = `🔴 НА РУКАХ: ${target.holder}`;
      banner.className = 'sn-live-banner show busy';
      const overdueMark = h >= OVERDUE_H ? ' <span style="color:var(--rose-text);font-weight:800;">🚨 ДОЛГ</span>' : '';
      banner.innerHTML = `<div><b>🔴 УЖЕ ЧИСЛИТСЯ:</b> <span class="mono">${esc(target.serial)}</span> за <b>👤 ${esc(target.holder)}</b> (${shIcon} ${esc(target.shift || '—')} • ${fmtHoursShort(h)})${overdueMark}</div><button type="button" class="banner-btn-act" data-banner-return="${esc(target.serial)}">📥 Принять в 1 клик</button>`;
    } else {
      inp.classList.remove('warn-busy');
      $('modelHint').innerText = `🟢 Свободен (${target.model})`;
      banner.className = 'sn-live-banner show free';
      banner.innerHTML = `<div><b>🟢 ГОТОВ К ВЫДАЧЕ:</b> Сканер <span class="mono">${esc(target.serial)}</span> (${esc(target.model)}) свободен в резерве</div>`;
    }
    return;
  }
  inp.classList.remove('warn-busy', 'err');
  if (tailMatches.length > 1) {
    const busyCount = tailMatches.filter(d => d.status === 'issued').length;
    $('modelHint').innerText = `Совпадений по хвосту: ${tailMatches.length}`;
    banner.className = 'sn-live-banner show new-sn';
    banner.innerHTML = `<div>🔎 Найдено <b>${tailMatches.length}</b> сканеров с хвостом «${esc(q)}» (свободно: ${tailMatches.length - busyCount}, на руках: ${busyCount})</div>`;
    return;
  }
  $('modelHint').innerText = `⚡ Новый сканер: ${detectScannerModel(q)}`;
  banner.className = 'sn-live-banner show new-sn';
  banner.innerHTML = `<div>⚡ Новое устройство: будет зарегистрирован сканер <b>${esc(q)}</b> (${esc(detectScannerModel(q))})</div>`;
}

function handleIssSnInput() {
  const el = $('issSn');
  const raw = el.value;
  const fixed = fixLayout(raw);
  if (fixed !== el.value) {
    if (hasCyr(raw)) logMsg(`🔧 Авто-раскладка ШК: "${raw}" ➔ "${fixed}"`);
    el.value = fixed;
  }
  updateIssBanner(fixed);
  const drop = $('issDrop');
  if (fixed.length < 2) { resetIssueDropdown(); return; }
  const allMatches = state.devices.filter(d => {
    const s = d.serial.toUpperCase();
    return s.endsWith(fixed) || s.includes(fixed);
  });
  if (!allMatches.length) { resetIssueDropdown(); state.lastDropQuery = fixed; return; }
  allMatches.sort((a, b) => {
    const sa = a.serial.toUpperCase(), sb = b.serial.toUpperCase();
    const aTail = sa.endsWith(fixed) ? 0 : 1;
    const bTail = sb.endsWith(fixed) ? 0 : 1;
    if (aTail !== bTail) return aTail - bTail;
    const aFree = a.status === 'free' ? 0 : 1;
    const bFree = b.status === 'free' ? 0 : 1;
    if (aFree !== bFree) return aFree - bFree;
    return sa.localeCompare(sb);
  });
  if (allMatches.length === 1 && allMatches[0].serial.toUpperCase() === fixed) {
    resetIssueDropdown();
    state.lastDropQuery = fixed;
    return;
  }
  drop.innerHTML = allMatches.slice(0, 8).map((d, i) => {
    let rightBadge = `<span style="font-size:10.5px;color:var(--emerald-text);font-weight:700;">🟢 В РЕЗЕРВЕ</span>`;
    if (d.status === 'issued') {
      rightBadge = `<span style="font-size:11px;color:var(--rose-text);font-weight:700;">🔴 У ${esc(d.holder)} (${fmtHoursShort(hoursSince(d.issued_at))})</span>`;
    } else if (d.status === 'repair') {
      rightBadge = `<span style="font-size:11px;color:var(--amber-text);font-weight:700;">🛠 В РЕМОНТЕ</span>`;
    }
    return `<div class="drop-item ${i === 0 ? 'selected' : ''}" data-sn="${esc(d.serial)}"><div><span class="mono" style="font-weight:700;">${formatSnSplit(d.serial)}</span><span style="color:var(--text-sub);font-size:11px;margin-left:6px;">(${esc(d.model)})</span></div>${rightBadge}</div>`;
  }).join('');
  drop.classList.add('show');
  state.lastDropQuery = fixed;
}

function showIssuePickModal(items) {
  $('issPickList').innerHTML = items.map((it, idx) => {
    const sn = it.dataset.sn;
    const dev = state.devices.find(d => d.serial === sn);
    const model = dev ? esc(dev.model) : '';
    let status = `<span style="font-size:11px;color:var(--emerald-text);font-weight:700;">🟢 В РЕЗЕРВЕ</span>`;
    if (dev && dev.status === 'issued') {
      status = `<span style="font-size:11px;color:var(--rose-text);font-weight:700;">🔴 НА РУКАХ: 👤 ${esc(dev.holder)}</span>`;
    } else if (dev && dev.status === 'repair') {
      status = `<span style="font-size:11px;color:var(--amber-text);font-weight:700;">🛠 В РЕМОНТЕ</span>`;
    }
    return `<div class="drop-item ${idx === 0 ? 'selected' : ''}" data-sn="${esc(sn)}" style="padding:11px 14px;"><div><span class="mono" style="font-weight:700;">${formatSnSplit(sn)}</span><span style="color:var(--text-sub);font-size:11px;margin-left:6px;">(${model})</span></div>${status}</div>`;
  }).join('');
  resetIssueDropdown();
  openModal('issPickModal');
}

/* ===== КОНВЕЙЕРНЫЙ AUTOSUBMIT («В ОДИН ПИК СКАНЕРА») ===== */
function handleIssWorkerKeydown(e) {
  const drop = $('workerDrop');
  const items = Array.from(drop.querySelectorAll('.drop-item'));
  const cur = items.findIndex(it => it.classList.contains('selected'));
  if (e.key === 'Enter' || e.key === 'Tab') {
    e.preventDefault();
    if (drop.classList.contains('show') && cur >= 0 && items[cur]) {
      $('issWorker').value = items[cur].dataset.worker;
    }
    resetWorkerDropdown();
    const w = $('issWorker').value.trim();
    if (!w) {
      $('issWorker').classList.add('err');
      beep('err');
      triggerScanFlash('err');
      return;
    }
    $('issWorker').classList.remove('err');
    if (state.issueShiftAuto) refreshSmartShift();
    // Если серийник сканера уже отсканирован — мгновенно подтверждаем выдачу без лишнего нажатия!
    if ($('issSn').value.trim().length >= 2) {
      submitIssue();
    } else {
      $('issSn').focus();
    }
    return;
  }
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    if (!items.length) return;
    e.preventDefault();
    if (cur >= 0) items[cur].classList.remove('selected');
    const next = cur < 0 ? (e.key === 'ArrowDown' ? 0 : items.length - 1) : (e.key === 'ArrowDown' ? (cur + 1) % items.length : (cur - 1 + items.length) % items.length);
    items[next].classList.add('selected');
    items[next].scrollIntoView({ block: 'nearest' });
    return;
  }
  if (e.key === 'Escape') resetWorkerDropdown();
}

function handleIssSnKeydown(e) {
  const el = $('issSn');
  const drop = $('issDrop');
  if (e.key === 'Enter' || e.key === 'Tab') {
    e.preventDefault();
    handleIssSnInput();
    const curVal = fixLayout(el.value);
    const items = Array.from(drop.querySelectorAll('.drop-item'));
    const dropIsFresh = state.lastDropQuery !== null && state.lastDropQuery === curVal;
    const dropShown = drop.classList.contains('show');
    if (dropIsFresh && dropShown && items.length > 1) {
      if (state.issDropNavigated) {
        const cur = items.findIndex(it => it.classList.contains('selected'));
        if (cur >= 0 && items[cur]) el.value = items[cur].dataset.sn;
      } else {
        showIssuePickModal(items);
        return;
      }
    } else if (dropIsFresh && dropShown && items.length === 1) {
      el.value = items[0].dataset.sn;
    }
    resetIssueDropdown();
    updateIssBanner(fixLayout(el.value));
    // КОНВЕЙЕР: если бейдж сотрудника уже введён — автоматически оформляем выдачу!
    if ($('issWorker').value.trim().length > 0) {
      submitIssue();
    } else {
      $('issWorker').focus();
    }
    return;
  }
  const items = Array.from(drop.querySelectorAll('.drop-item'));
  const cur = items.findIndex(it => it.classList.contains('selected'));
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    if (!items.length) return;
    e.preventDefault();
    state.issDropNavigated = true;
    if (cur >= 0) items[cur].classList.remove('selected');
    const next = e.key === 'ArrowDown' ? (cur + 1) % items.length : (cur - 1 + items.length) % items.length;
    items[next].classList.add('selected');
    items[next].scrollIntoView({ block: 'nearest' });
    updateIssBanner(items[next].dataset.sn);
    return;
  }
  if (e.key === 'Escape') resetIssueDropdown();
}

function handleWorkerInput() {
  const raw = $('issWorker').value.trim();
  // Если в поле бейджа случайно пикнули длинный серийный номер сканера (начинается с S24... или 10+ цифр из реестра),
  // автоматически переносим его в поле сканера!
  const fixedCandidate = fixLayout(raw);
  if (fixedCandidate.length >= 9 && state.devices.some(d => d.serial.toUpperCase() === fixedCandidate)) {
    $('issSn').value = fixedCandidate;
    $('issWorker').value = '';
    updateIssBanner(fixedCandidate);
    logMsg(`⚡ Умный роутинг: распознан штрихкод сканера ${fixedCandidate}, введите бейдж сотрудника`);
    $('issWorker').focus();
    return;
  }

  const q = raw.toUpperCase();
  const drop = $('workerDrop');
  if (q.length < 2) { resetWorkerDropdown(); return; }
  const workerSet = new Set();
  state.devices.forEach(d => { if (d.holder) workerSet.add(d.holder); });
  if (state.workerShifts) Object.keys(state.workerShifts).forEach(w => workerSet.add(w));
  const matches = Array.from(workerSet).filter(w => w.toUpperCase().includes(q) && w.toUpperCase() !== q).slice(0, 5);
  if (!matches.length) { resetWorkerDropdown(); return; }
  drop.innerHTML = matches.map(w => `<div class="drop-item" data-worker="${esc(w)}"><span style="font-weight:700;">👤 ${esc(w)}</span><span style="font-size:10px;color:var(--text-muted);">выбрать</span></div>`).join('');
  drop.classList.add('show');
}

/* ===== ВЫДАЧА СКАНЕРА С ЗАЩИТОЙ ОТ ОШИБОК ОПЕРАТОРА ===== */
async function submitIssue() {
  if (!terminalContext.id || !state.dataVerified) { showToast('ТРЕБУЕТСЯ ЗАГРУЗКА', 'Дождитесь первой успешной загрузки из облака', 'warn'); return; }
  if (state.opLock) return;
  const rawSn = $('issSn').value.trim();
  const worker = $('issWorker').value.trim();
  $('issSn').classList.remove('err');
  $('issWorker').classList.remove('err');

  if (!worker) {
    $('issWorker').classList.add('err');
    beep('err');
    triggerScanFlash('err');
    showToast('ОШИБКА: НЕТ БЕЙДЖА', 'Отсканируйте бейдж сотрудника', 'err');
    $('issWorker').focus();
    return;
  }
  if (!rawSn) {
    $('issSn').classList.add('err');
    beep('err');
    triggerScanFlash('err');
    showToast('ОШИБКА: НЕТ СКАНЕРА', 'Отсканируйте штрихкод сканера', 'err');
    $('issSn').focus();
    return;
  }

  const cleanRaw = fixLayout(rawSn);
  if (!SN_REGEX.test(cleanRaw)) {
    $('issSn').classList.add('err');
    beep('err');
    triggerScanFlash('err');
    showToast('НЕВЕРНЫЙ ШТРИХКОД', 'Допустимы символы A-Z, 0-9, дефис (2–60 знаков)', 'err');
    $('issSn').select();
    return;
  }

  const exactMatch = state.devices.find(d => d.serial.toUpperCase() === cleanRaw);
  const allTailMatches = state.devices.filter(d => d.serial.toUpperCase().endsWith(cleanRaw));
  let sn = cleanRaw;

  if (!exactMatch) {
    if (allTailMatches.length === 1) {
      sn = allTailMatches[0].serial;
    } else if (allTailMatches.length > 1) {
      $('issSn').classList.add('err');
      beep('err');
      triggerScanFlash('warn');
      const fakeItems = allTailMatches.map(d => ({ dataset: { sn: d.serial } }));
      showIssuePickModal(fakeItems);
      return;
    } else if (cleanRaw.length < 6) {
      // Короткий хвост не найден в базе — блокируем случайное создание фантомного сканера из 4 цифр!
      $('issSn').classList.add('err');
      beep('err');
      triggerScanFlash('err');
      showToast('ОШИБКА: СКАНЕР НЕ НАЙДЕН', `По хвосту «${cleanRaw}» нет сканера в парке. Отсканируйте полный ШК.`, 'err');
      $('issSn').select();
      return;
    }
  }

  // Анти-дребезг (защита от двойного пика сканера)
  if (isSerialInCooldown(sn)) {
    logMsg(`🛡 Анти-дубль: повторный пик ${sn} проигнорирован`);
    return;
  }

  const dev = state.devices.find(d => d.serial === sn);

  // Блокировка выдачи сканера, находящегося в ремонте / браке
  if (dev && dev.status === 'repair') {
    $('issSn').classList.add('err');
    beep('err');
    triggerScanFlash('err');
    showToastWithAction(
      'ОШИБКА: УСТРОЙСТВО В РЕМОНТЕ',
      `Сканер ${sn} заблокирован (${dev.defect || 'неисправен'})`,
      '✅ Вернуть в строй и выдать',
      async () => {
        await toggleDeviceRepair(sn);
        $('issSn').value = sn;
        $('issWorker').value = worker;
      },
      'err'
    );
    return;
  }

  // Блокировка выдачи, если сканер уже числится за сотрудником
  if (dev && dev.status === 'issued') {
    $('issSn').classList.add('err');
    beep('err');
    triggerScanFlash('err');
    updateIssBanner(sn);
    if (dev.holder && dev.holder.toUpperCase() === worker.toUpperCase()) {
      showToastWithAction(
        'ОШИБКА: УЖЕ ЧИСЛИТСЯ ЗА ЭТИМ СОТРУДНИКОМ',
        `Сканер ${sn} уже выдан сотруднику ${dev.holder}`,
        '📥 Принять на склад',
        async () => {
          await doReturn(sn);
          clearAllInputsAndFocus();
        },
        'err'
      );
    } else {
      showToastWithAction(
        `ОШИБКА: УЖЕ ЧИСЛИТСЯ ЗА ${dev.holder}`,
        `Сканер ${sn} на руках у ${dev.holder} (${fmtHoursShort(hoursSince(dev.issued_at))})`,
        `🔄 Переоформить на ${worker}`,
        async () => {
          const shift = state.issueShiftAuto ? computeSmartShift(worker) : state.issueShift;
          await performIssue(sn, worker, dev, shift);
        },
        'err'
      );
    }
    return;
  }

  state.opLock = true;
  const btn = $('btnIssue');
  btn.classList.add('busy');

  try {
    let shift = state.issueShift;
    if (state.issueShiftAuto) shift = computeSmartShift(worker);

    const existingWorkerDev = state.devices.find(
      d => d.status === 'issued' && d.holder && d.holder.toUpperCase() === worker.toUpperCase()
    );

    if (existingWorkerDev) {
      const pending = {
        worker,
        oldSn: existingWorkerDev.serial,
        newSn: sn,
        isNew: !dev,
        shift,
        originalIssuedAt: existingWorkerDev.issued_at,
        originalShift: existingWorkerDev.shift
      };
      if (state.autoSwap) {
        state.pendingSwap = pending;
        await confirmSwap();
        return;
      }
      state.pendingSwap = pending;
      const hoursOnHands = existingWorkerDev.issued_at ? hoursSince(existingWorkerDev.issued_at) : 0;
      $('swapWorker').innerText = worker;
      $('swapOldSn').innerText = existingWorkerDev.serial;
      $('swapOldModel').innerText = existingWorkerDev.model || '—';
      $('swapNewSn').innerText = sn;
      $('swapNewModel').innerText = dev ? dev.model : detectScannerModel(sn);
      $('swapInheritTime').innerText = fmtHoursShort(hoursOnHands);
      openModal('swapModal');
      setTimeout(() => $('swapConfirm').focus(), 60);
      return;
    }

    await performIssue(sn, worker, dev, shift);
  } catch(e) {
    beep('err');
    triggerScanFlash('err');
    showToast('ОШИБКА ВЫДАЧИ', e.message || 'Не удалось выполнить операцию', 'err');
    state.pendingSwap = null;
  } finally {
    state.opLock = false;
    btn.classList.remove('busy');
  }
}

async function performIssue(sn, worker, dev, shift, inheritedIssuedAt) {
  const isNew = !dev;

  const ts = nowIso();
  const issuedAt = inheritedIssuedAt || ts;
  const updated = {
    serial: sn,
    version: dev?.version,
    model: dev ? detectScannerModel(sn, dev.model) : detectScannerModel(sn),
    status: 'issued',
    holder: worker,
    issued_at: issuedAt,
    last_move: ts,
    shift,
    defect: ''
  };
  const oldSnapshot = dev ? JSON.parse(JSON.stringify(dev)) : null;
  const idx = state.devices.findIndex(d => d.serial === sn);
  if (idx >= 0) state.devices[idx] = updated;
  else state.devices.push(updated);

  state.justIssued = sn;
  renderTable();
  setTimeout(() => { state.justIssued = null; renderTable(); }, 2200);

  const actionName = inheritedIssuedAt
    ? (isNew ? 'Создан и выдан (время перенесено)' : 'Выдан (время перенесено)')
    : (isNew ? 'Создан и выдан' : 'Выдан');

  try {
    await saveDevice(updated, actionName, worker);
    rememberWorkerShift(worker, shift);
    beep('issue');
    triggerScanFlash('ok');
    pushTickerEvent('t-iss', sn, worker);
    showUndoToast(
      'ВЫДАНО В СМЕНУ',
      `Сканер ${sn} (${updated.model}) ➔ 👤 ${worker} (${shift})`,
      '↩ Отменить (Ctrl+Z)',
      async () => {
        try {
          if (isNew) await deleteSerial(sn);
          else await saveDevice({ ...oldSnapshot, last_move: nowIso() }, 'Отмена выдачи', worker);
          beep('return');
          showToast('ВЫДАЧА ОТМЕНЕНА', `Сканер ${sn} возвращён в резерв`);
        } catch(e) { showToast('ОШИБКА ОТМЕНЫ', e.message || '?', 'err'); }
      },
      'ok'
    );
    logMsg(`✅ ВЫДАНО: ${sn} ➔ ${worker} (${shift})`);
    clearDraft();
  } catch(e) {
    if (isNew) state.devices = state.devices.filter(d => d.serial !== sn);
    else if (idx >= 0) state.devices[idx] = dev;
    renderTable();
    throw e;
  }

  // Полный сброс и возврат фокуса на поле бейджа для следующего сотрудника в очереди!
  $('issSn').value = '';
  $('issWorker').value = '';
  resetIssueDropdown();
  resetWorkerDropdown();
  updateIssBanner('');
  state.issDropNavigated = false;
  if (state.issueShiftAuto) state.issueShift = computeSmartShift('');
  updateShiftPill();
  $('issWorker').focus();
}

async function confirmSwap() {
  const p = state.pendingSwap;
  if (!p) return;
  state.pendingSwap = null; // анти-дубль: повторный клик/Enter по окну замены выйдет сразу
  closeModal('swapModal');
  let snapshot = null;
  try {
    const oldDev = state.devices.find(d => d.serial === p.oldSn);
    const newDev = state.devices.find(d => d.serial === p.newSn);
    const ts = nowIso();
    const inheritedIssuedAt = p.originalIssuedAt || ts;
    snapshot = {
      oldDevSnapshot: oldDev ? JSON.parse(JSON.stringify(oldDev)) : null,
      newDevSnapshot: newDev ? JSON.parse(JSON.stringify(newDev)) : null,
      worker: p.worker,
      newSn: p.newSn,
      oldSn: p.oldSn
    };
    const newRecord = {
      serial: p.newSn,
      version: newDev?.version,
      model: newDev ? detectScannerModel(p.newSn, newDev.model) : detectScannerModel(p.newSn),
      status: 'issued',
      holder: p.worker,
      issued_at: inheritedIssuedAt,
      last_move: ts,
      shift: p.shift,
      defect: ''
    };
    if (!oldDev || oldDev.status !== 'issued' || String(oldDev.holder || '').toUpperCase() !== p.worker.toUpperCase() || (newDev && newDev.status !== 'free')) {
      throw new Error('Статус сканеров изменился. Повторите замену.');
    }
    await saveDeviceChanges([
      { dev: { ...oldDev, status: 'free', holder: '', shift: '—', issued_at: null, last_move: ts }, actionName: 'Возврат (замена)', workerName: p.worker },
      { dev: newRecord, actionName: p.isNew ? 'Создан и выдан (замена)' : 'Выдача (замена)', workerName: p.worker }
    ]);
    rememberWorkerShift(p.worker, p.shift);
    beep('swap');
    triggerScanFlash('ok');
    pushTickerEvent('t-swp', p.newSn, p.worker);
    showUndoToast(
      `ЗАМЕНА СКАНЕРА: ${p.oldSn.slice(-4)} ➔ ${p.newSn.slice(-4)}`,
      `Сотрудник ${p.worker} · старый принят, новый выдан`,
      '↩ Отменить (Ctrl+Z)',
      async () => {
        const t = nowIso();
        try {
          const changes = [
            { dev: { ...snapshot.oldDevSnapshot, last_move: t }, actionName: 'Отмена замены (старый)', workerName: snapshot.worker }
          ];
          if (!snapshot.newDevSnapshot) changes.unshift({ dev: state.devices.find(d => d.serial === snapshot.newSn), remove: true, actionName: 'Отмена создания при замене', workerName: snapshot.worker });
          if (snapshot.newDevSnapshot) {
            changes.unshift({ dev: { ...snapshot.newDevSnapshot, last_move: t }, actionName: 'Отмена замены (новый)', workerName: snapshot.worker });
          }
          await saveDeviceChanges(changes);
          beep('return');
          showToast('ЗАМЕНА ОТМЕНЕНА', 'Восстановлено прежнее состояние');
        } catch(e) { showToast('ОШИБКА', e.message || '?', 'err'); }
      },
      'swap'
    );
    logMsg(`🔄 ЗАМЕНА: ${p.oldSn} ➔ ${p.newSn} у ${p.worker}`);
    state.pendingSwap = null;
    $('issSn').value = '';
    $('issWorker').value = '';
    resetIssueDropdown();
    resetWorkerDropdown();
    updateIssBanner('');
    clearDraft();
    state.issDropNavigated = false;
    if (state.issueShiftAuto) state.issueShift = computeSmartShift('');
    updateShiftPill();
    $('issWorker').focus();
  } catch(e) {
    beep('err');
    triggerScanFlash('err');
    showToast('ОШИБКА ЗАМЕНЫ', e.message || '?', 'err');
    if (!db || !state.dbReady) {
      state.devices = state.devices.filter(d => d.serial !== p.newSn);
      if (snapshot?.oldDevSnapshot) {
        const oldIdx = state.devices.findIndex(d => d.serial === p.oldSn);
        if (oldIdx >= 0) state.devices[oldIdx] = snapshot.oldDevSnapshot;
        else state.devices.push(snapshot.oldDevSnapshot);
      }
      if (snapshot?.newDevSnapshot) {
        const newIdx = state.devices.findIndex(d => d.serial === p.newSn);
        if (newIdx >= 0) state.devices[newIdx] = snapshot.newDevSnapshot;
        else state.devices.push(snapshot.newDevSnapshot);
      }
      renderTable();
    } else {
      await loadLocal();
    }
    state.pendingSwap = null;
  }
}

function showToastWithAction(title, desc, actionLabel, actionCallback, kind = 'warn') {
  clearUndo();
  const el = $('toast');
  $('tTitle').innerText = title;
  $('tDesc').innerText = desc || '';
  $('tIcon').innerText = kind === 'err' ? '✕' : '!';
  $('tIcon').style.background = '';
  $('tIcon').style.borderColor = '';
  $('tIcon').style.color = '';
  $('tTitle').style.color = '';
  const oldBtn = el.querySelector('.t-undo');
  if (oldBtn) oldBtn.remove();
  const actBtn = document.createElement('button');
  actBtn.className = 't-undo';
  actBtn.innerText = actionLabel;
  actBtn.onclick = async () => { el.classList.remove('show'); try { await actionCallback(); } catch(e) { showToast('ОПЕРАЦИЯ ОСТАНОВЛЕНА', e.message, 'err'); } };
  el.appendChild(actBtn);
  el.className = kind;
  el.classList.add('show');
  clearTimeout(state.toastTimer);
  state.toastTimer = setTimeout(() => {
    el.classList.remove('show');
    setTimeout(() => {
      const b = el.querySelector('.t-undo');
      if (b) b.remove();
    }, 400);
  }, 6000);
}
/* ===== БЫСТРАЯ ПРИЁМКА В 1 ШАГ И ПЕРЕВОД В БРАК / РЕМОНТ ===== */
function handleRetInput() {
  const el = $('retQuery');
  const raw = el.value;
  const hasDigits = /[0-9]/.test(raw);
  const hasCyrHere = hasCyr(raw);
  if (hasCyrHere && hasDigits) {
    const fixed = fixLayout(raw);
    if (fixed !== raw) el.value = fixed;
  }
  const q = el.value.trim();
  const drop = $('retDrop');
  if (q.length < 1) {
    drop.classList.remove('show');
    drop.innerHTML = '';
    state.lastRetDropQuery = null;
    return;
  }
  const busy = state.devices.filter(d => d.status === 'issued');
  const qu = q.toUpperCase();
  const qNoSpace = qu.replace(/\s+/g, '');
  const qFixed = hasCyr(raw) ? qu : fixLayout(q);
  const matches = busy.filter(d => {
    const h = (d.holder || '').toUpperCase();
    const s = (d.serial || '').toUpperCase();
    if (h && (h === qu || h === qNoSpace || h === qFixed)) return true;
    if (h && (h.startsWith(qu) || h.includes(qu))) return true;
    if (s === qu || s === qFixed) return true;
    if (s.endsWith(qFixed) || s.endsWith(qNoSpace)) return true;
    if (s.includes(qFixed)) return true;
    return false;
  });
  if (!matches.length) {
    drop.classList.remove('show');
    drop.innerHTML = '';
    state.lastRetDropQuery = qFixed;
    return;
  }
  drop.innerHTML = matches.slice(0, 8).map((d, idx) => {
    const sh = d.shift === 'Ночная' ? '🌙' : (d.shift === 'Дневная' ? '☀' : '');
    const ov = hoursSince(d.issued_at) >= OVERDUE_H;
    return `<div class="drop-item ${idx === 0 ? 'selected' : ''}" data-sn="${esc(d.serial)}"><div><span class="mono" style="font-weight:700;">${formatSnSplit(d.serial)}</span><span style="color:var(--text-sub);font-size:11px;margin-left:6px;">(${esc(d.model)})</span></div><span style="font-size:11.5px;font-weight:700;color:${ov ? 'var(--rose-text)' : 'var(--emerald-text)'};">${ov ? '🚨 ' : ''}${sh} 👤 ${esc(d.holder || '—')} (${fmtHoursShort(hoursSince(d.issued_at))})</span></div>`;
  }).join('');
  drop.classList.add('show');
  state.lastRetDropQuery = qFixed;
}

function handleRetKeydown(e) {
  const drop = $('retDrop');
  if (e.key === 'Enter') {
    e.preventDefault();
    handleRetInput();
    const items = Array.from(drop.querySelectorAll('.drop-item'));
    const cur = items.findIndex(it => it.classList.contains('selected'));
    if (drop.classList.contains('show') && cur >= 0 && items[cur] && items.length === 1) {
      $('retQuery').value = items[cur].dataset.sn;
    }
    resetRetDropdown();
    quickReturn();
    return;
  }
  const items = Array.from(drop.querySelectorAll('.drop-item'));
  const cur = items.findIndex(it => it.classList.contains('selected'));
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    if (!items.length) return;
    e.preventDefault();
    if (cur >= 0) items[cur].classList.remove('selected');
    const next = e.key === 'ArrowDown' ? (cur + 1) % items.length : (cur - 1 + items.length) % items.length;
    items[next].classList.add('selected');
    items[next].scrollIntoView({ block: 'nearest' });
    return;
  }
  if (e.key === 'Escape') resetRetDropdown();
}

async function quickReturn() {
  if (state.opLock) return;
  const raw = $('retQuery').value.trim();
  if (!raw) {
    $('retQuery').classList.add('err');
    beep('err');
    triggerScanFlash('err');
    $('retQuery').focus();
    return;
  }
  resetRetDropdown();
  const qu = raw.toUpperCase();
  const qNoSpace = qu.replace(/\s+/g, '');
  const qFixed = hasCyr(raw) ? qu : fixLayout(raw);

  // Сначала проверяем, не отсканирован ли уже свободный или ремонтный сканер по точному SN
  const exactAny = state.devices.find(d => d.serial.toUpperCase() === qFixed || d.serial.toUpperCase() === qu);
  if (exactAny && exactAny.status === 'free') {
    beep('err');
    triggerScanFlash('warn');
    showToast('УЖЕ НА СКЛАДЕ', `Сканер ${exactAny.serial} уже числится свободным в резерве`, 'warn');
    $('retQuery').value = '';
    $('retQuery').focus();
    return;
  }
  if (exactAny && exactAny.status === 'repair') {
    beep('err');
    triggerScanFlash('warn');
    showToastWithAction(
      'СКАНЕР В РЕМОНТЕ',
      `Сканер ${exactAny.serial} числится в браке/ремонте`,
      '✅ Вернуть в строй',
      async () => { await toggleDeviceRepair(exactAny.serial); },
      'warn'
    );
    $('retQuery').value = '';
    $('retQuery').focus();
    return;
  }

  const busy = state.devices.filter(d => d.status === 'issued');
  if (!busy.length) {
    beep('err');
    triggerScanFlash('warn');
    showToast('НЕТ ВЫДАННЫХ СКАНЕРОВ', 'Все сканеры уже приняты на склад', 'warn');
    $('retQuery').value = '';
    return;
  }

  const exactSerial = busy.filter(d => { const s = (d.serial || '').toUpperCase(); return s === qu || s === qFixed; });
  const exactHolders = busy.filter(d => { const h = (d.holder || '').toUpperCase(); return h === qu || h === qNoSpace || h === qFixed; });
  const tailSerial = busy.filter(d => { const s = (d.serial || '').toUpperCase(); return s.endsWith(qFixed) || s.endsWith(qNoSpace) || s.includes(qFixed); });
  const partialHolders = busy.filter(d => { const h = (d.holder || '').toUpperCase(); return h && (h.includes(qu) || h.includes(qNoSpace)); });

  const candidates = exactSerial.length
    ? exactSerial
    : (exactHolders.length ? exactHolders : (tailSerial.length ? tailSerial : partialHolders));

  if (!candidates.length) {
    beep('err');
    triggerScanFlash('err');
    showToast('ОШИБКА: НЕ НАЙДЕН В СМЕНЕ', `Запрос «${raw}» не найден среди выданных сканеров`, 'err');
    $('retQuery').classList.add('err');
    setTimeout(() => $('retQuery').classList.remove('err'), 1200);
    $('retQuery').select();
    return;
  }

  if (candidates.length === 1) {
    await doReturn(candidates[0].serial);
    return;
  }

  $('pickList').innerHTML = candidates.map((d, idx) => {
    const ov = hoursSince(d.issued_at) >= OVERDUE_H;
    const sh = d.shift === 'Ночная' ? '🌙' : (d.shift === 'Дневная' ? '☀' : '');
    return `<div class="drop-item ${idx === 0 ? 'selected' : ''}" data-sn="${esc(d.serial)}" style="padding:10px 14px;"><div><span class="mono" style="font-weight:700;">${formatSnSplit(d.serial)}</span><span style="color:var(--text-sub);margin-left:8px;">${sh} 👤 ${esc(d.holder)}</span></div><span class="mono" style="font-size:11px;color:${ov ? 'var(--rose-text)' : 'var(--brand-text)'};">${ov ? '🚨 ' : ''}${fmtHoursShort(hoursSince(d.issued_at))}</span></div>`;
  }).join('');
  openModal('pickModal');
}

async function doReturn(sn) {
  if (state.opLock) return;
  if (isSerialInCooldown(sn)) {
    logMsg(`🛡 Анти-дубль: повторный возврат ${sn} проигнорирован`);
    return;
  }
  const dev = state.devices.find(d => d.serial === sn);
  if (!dev) {
    showToast('ОШИБКА', 'Сканер не найден в базе', 'err');
    return;
  }
  const holder = dev.holder || 'Сотрудник';
  const durationStr = dev.issued_at ? fmtHoursShort(hoursSince(dev.issued_at)) : '—';
  const ts = nowIso();
  const snapshot = JSON.parse(JSON.stringify(dev));
  state.opLock = true;
  const btn = $('retBtn');
  btn.classList.add('busy');

  try {
    const updated = { ...dev, status: 'free', holder: '', shift: '—', issued_at: null, last_move: ts, defect: '' };
    const idx = state.devices.findIndex(d => d.serial === sn);
    if (idx >= 0) state.devices[idx] = updated;
    state.justReturned = sn;
    renderTable();
    updateIssBanner(fixLayout($('issSn').value));
    setTimeout(() => { state.justReturned = null; renderTable(); }, 2200);

    await saveDevice(updated, 'Возврат на склад', holder);
    beep('return');
    triggerScanFlash('ok');
    pushTickerEvent('t-ret', sn, holder);
    setTimeout(() => updateDebtBadge(), 150);

    showUndoToast(
      `СКАНЕР ${sn.slice(-4)} ПРИНЯТ`,
      `Принят от 👤 ${holder} (время в смене: ${durationStr})`,
      '↩ Отменить (Ctrl+Z)',
      async () => {
        try {
          const t2 = nowIso();
          await saveDevice({ ...snapshot, last_move: t2 }, 'Отмена приёма', holder);
          beep('issue');
          showToast('ПРИЁМКА ОТМЕНЕНА', `Сканер ${sn} снова числится за ${holder}`);
        } catch(e) { showToast('ОШИБКА', e.message || '?', 'err'); }
      },
      'ok'
    );
    logMsg(`📥 ПРИНЯТО: ${sn} от ${holder} (${durationStr})`);
    $('retQuery').value = '';
    resetRetDropdown();
    $('retQuery').focus();
  } catch(e) {
    const idx = state.devices.findIndex(d => d.serial === sn);
    if (idx >= 0) state.devices[idx] = snapshot;
    renderTable();
    beep('err');
    triggerScanFlash('err');
    showToast('ОШИБКА ПРИЁМКИ', e.message || '?', 'err');
  } finally {
    state.opLock = false;
    btn.classList.remove('busy');
  }
}

/* ===== ПЕРЕВОД СКАНЕРА В БРАК / РЕМОНТ И ВОЗВРАТ В СТРОЙ ===== */
async function submitDefectForm() {
  const rawSn = $('defSn').value.trim();
  const reason = $('defReason').value.trim() || 'Неисправен / На диагностике';
  if (!rawSn) {
    $('defSn').classList.add('err');
    beep('err');
    triggerScanFlash('err');
    $('defSn').focus();
    return;
  }
  $('defSn').classList.remove('err');
  const qFixed = fixLayout(rawSn);
  const exact = state.devices.find(d => d.serial.toUpperCase() === qFixed);
  const tail = state.devices.filter(d => d.serial.toUpperCase().endsWith(qFixed));
  const target = exact || (tail.length === 1 ? tail[0] : null);
  if (!target) {
    $('defSn').classList.add('err');
    beep('err');
    triggerScanFlash('err');
    showToast('СКАНЕР НЕ НАЙДЕН', `По запросу «${rawSn}» устройство не найдено`, 'err');
    return;
  }
  await toggleDeviceRepair(target.serial, reason, 'repair');
  $('defSn').value = '';
  $('defSn').focus();
}

async function toggleDeviceRepair(sn, customReason, desiredStatus) {
  if (isSerialInCooldown(sn)) return;
  if (state.opLock) return;
  const dev = state.devices.find(d => d.serial === sn);
  if (!dev) return;
  const snapshot = JSON.parse(JSON.stringify(dev));
  const ts = nowIso();
  const isCurrentlyRepair = dev.status === 'repair';
  if (desiredStatus === 'repair' && isCurrentlyRepair) { showToast('УЖЕ В РЕМОНТЕ', sn, 'warn'); return; }
  if (isCurrentlyRepair && !await askConfirmDialog('Возврат в строй', `Подтвердите, что сканер ${sn} проверен и исправен.`, 'Вернуть в строй')) return;
  if (dev.version !== state.devices.find(d => d.serial === sn)?.version) return;
  const prevHolder = dev.holder || '';
  const reason = customReason || $('defReason')?.value.trim() || 'Требуется диагностика / ремонт';

  state.opLock = true;
  try {
    let updated;
    let actionLabel;
    if (isCurrentlyRepair) {
      updated = { ...dev, status: 'free', holder: '', shift: '—', issued_at: null, last_move: ts, defect: '' };
      actionLabel = 'Возвращён из ремонта в резерв';
    } else {
      updated = { ...dev, status: 'repair', holder: '', shift: '—', issued_at: null, last_move: ts, defect: reason };
      actionLabel = `Переведён в ремонт: ${reason}`;
    }

    const idx = state.devices.findIndex(d => d.serial === sn);
    if (idx >= 0) state.devices[idx] = updated;
    renderTable();
    updateIssBanner(fixLayout($('issSn').value));

    await saveDevice(updated, actionLabel, prevHolder);
    beep(isCurrentlyRepair ? 'return' : 'swap');
    triggerScanFlash(isCurrentlyRepair ? 'ok' : 'warn');
    pushTickerEvent(isCurrentlyRepair ? 't-ret' : 't-rep', sn, isCurrentlyRepair ? 'В резерв' : 'Брак');

    showUndoToast(
      isCurrentlyRepair ? `В СТРОЮ: ${sn}` : `В РЕМОНТЕ: ${sn}`,
      isCurrentlyRepair ? 'Сканер проверен и доступен для выдачи' : `Причина: ${reason}${prevHolder ? ` (снят с ${prevHolder})` : ''}`,
      '↩ Отменить (Ctrl+Z)',
      async () => {
        await saveDevice({ ...snapshot, last_move: nowIso() }, 'Отмена статуса ремонта', prevHolder);
        showToast('ОТМЕНЕНО', `Статус сканера ${sn} восстановлен`);
      },
      isCurrentlyRepair ? 'ok' : 'warn'
    );
    logMsg(`🛠 СТАТУС РЕМОНТА: ${sn} — ${actionLabel}`);
    if (state.auditSn === sn) openAudit(sn);
  } catch(e) {
    const idx = state.devices.findIndex(d => d.serial === sn);
    if (idx >= 0) state.devices[idx] = snapshot;
    renderTable();
    beep('err');
    showToast('ОШИБКА', e.message || '?', 'err');
  } finally {
    state.opLock = false;
  }
}

/* ===== МОДАЛЬНОЕ ОКНО ДОЛЖНИКОВ И ФИЛЬТРАЦИЯ ===== */
function buildDebtList() {
  const byHolder = {};
  state.devices.forEach(d => {
    if (d.status !== 'issued' || !d.holder) return;
    const h = hoursSince(d.issued_at);
    if (h < OVERDUE_H) return;
    const normKey = d.holder.trim().toUpperCase();
    if (!byHolder[normKey]) byHolder[normKey] = { holder: d.holder.trim(), count: 0, maxH: 0 };
    byHolder[normKey].count++;
    if (h > byHolder[normKey].maxH) byHolder[normKey].maxH = h;
  });
  return Object.values(byHolder).sort((a, b) => b.maxH - a.maxH);
}

function openDebtModal() {
  checkDebtors();
  const list = buildDebtList();
  $('debtModalCount').innerText = list.length;
  const wrap = $('debtModalList');
  if (!list.length) {
    wrap.innerHTML = '<div class="debt-empty-modal" style="padding:20px;">🎉 Активных просрочек (>14ч) нет</div>';
  } else {
    wrap.innerHTML = list.map(g => {
      const holder = g.holder;
      const word = pluralN(g.count, 'сканер', 'сканера', 'сканеров');
      return `<div class="debt-modal-item" data-holder="${esc(holder)}"><div class="dname"><span>👤 ${esc(holder)}</span></div><div class="dtime">${fmtHoursShort(g.maxH)}</div><div class="dmeta"><span class="dcnt">${g.count}×</span><span>${word}</span></div></div>`;
    }).join('');
  }
  const histWrap = $('debtHistoryList');
  const history = Object.values(state.debtorsRegistry).sort((a, b) => b.count - a.count);
  if (!history.length) {
    histWrap.innerHTML = '<div class="debt-empty-modal" style="padding:20px;">📜 Архив нарушений пуст</div>';
  } else {
    histWrap.innerHTML = history.map(r => {
      const lastStr = r.lastDate ? new Date(r.lastDate).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit' }) : '—';
      return `<div class="debt-modal-item" style="background:rgba(245,158,11,.06);border-color:rgba(245,158,11,.28);" data-holder="${esc(r.name)}"><div class="dname"><span>👤 ${esc(r.name)}</span></div><div class="dtime" style="color:var(--amber-text);">${r.count}×</div><div class="dmeta"><span style="color:var(--amber-text);">${r.serials.length} сканеров</span><span style="font-size:10px;">${lastStr}</span></div></div>`;
    }).join('');
  }
  openModal('debtModal');
}

function showAllDebtsInTable() {
  closeModal('debtModal');
  document.querySelectorAll('.kpi-card').forEach(x => x.classList.remove('active'));
  const card = document.querySelector('.kpi-card[data-filter="overdue"]');
  if (card) card.classList.add('active');
  state.filter = 'overdue';
  $('searchTable').value = '';
  updateSearchWrap();
  renderTable();
}

function filterByHolder(holder) {
  $('searchTable').value = holder;
  updateSearchWrap();
  state.filter = 'all';
  document.querySelectorAll('.kpi-card').forEach(x => x.classList.remove('active'));
  const allCard = document.querySelector('.kpi-card[data-filter="all"]');
  if (allCard) allCard.classList.add('active');
  renderTable();
}

function updateSearchWrap() {
  const w = $('searchWrap');
  if (w) w.classList.toggle('has-val', !!$('searchTable').value);
}

function setRingProgress(id, ratio) {
  const el = $(id);
  if (!el) return;
  const c = 94.2;
  const r = Math.max(0, Math.min(1, ratio || 0));
  el.style.strokeDashoffset = String(c - c * r);
}

/* ===== ОТРИСОВКА KPI-ПАНЕЛИ И РЕЕСТРА СКАНЕРОВ ===== */
function renderTable() {
  const q = ($('searchTable')?.value || '').trim().toUpperCase();
  const pageKey = [q, state.filter, state.modelFilter, state.sortField, state.sortAsc].join('|');
  if (pageKey !== state.tablePageKey) { state.tablePage = 0; state.tablePageKey = pageKey; }
  let free = 0, issued = 0, repair = 0, overdue = 0, dayCount = 0, nightCount = 0;
  let zebraCnt = 0, pmCnt = 0;
  const issuedTimes = [];

  state.devices.forEach(d => {
    if (d.model === 'Zebra RS5100') zebraCnt++;
    else pmCnt++;

    if (d.status === 'issued') {
      issued++;
      const h = hoursSince(d.issued_at);
      issuedTimes.push(h);
      if (h >= OVERDUE_H) overdue++;
      if (d.shift === 'Ночная') nightCount++;
      else dayCount++;
    } else if (d.status === 'repair') {
      repair++;
    } else {
      free++;
    }
  });

  const total = state.devices.length;
  $('mTotal').innerText = total;
  $('mIssued').innerText = issued;
  $('mFree').innerText = free;
  $('mRepair').innerText = repair;
  $('mOverdue').innerText = overdue;
  $('mDay').innerText = dayCount;
  $('mNight').innerText = nightCount;

  $('mIssuedPct').innerText = total ? Math.round((issued / total) * 100) + '%' : '0%';
  $('mFreePct').innerText = total ? Math.round((free / total) * 100) + '%' : '0%';
  $('mRepairPct').innerText = total ? Math.round((repair / total) * 100) + '%' : '0%';

  $('mcAll').innerText = total;
  $('mcPm').innerText = pmCnt;
  $('mcZebra').innerText = zebraCnt;

  setRingProgress('ringIssued', total ? issued / total : 0);
  setRingProgress('ringFree', total ? free / total : 0);
  setRingProgress('ringRepair', total ? repair / total : 0);
  setRingProgress('ringOverdue', issued ? overdue / issued : 0);
  setRingProgress('ringShiftSplit', issued ? dayCount / issued : 0.5);

  if (total > 0) {
    $('capFree').style.width = ((free / total) * 100) + '%';
    $('capIssued').style.width = ((Math.max(0, issued - overdue) / total) * 100) + '%';
    $('capRepair').style.width = ((repair / total) * 100) + '%';
    $('capOver').style.width = ((overdue / total) * 100) + '%';
  }

  const statsEl = $('regStats');
  if (statsEl) {
    if (issuedTimes.length) {
      const avg = issuedTimes.reduce((a, b) => a + b, 0) / issuedTimes.length;
      const max = Math.max(...issuedTimes);
      const avgCls = timeClass(avg), maxCls = timeClass(max);
      const colors = { fresh: 'var(--emerald-text)', mid: 'var(--amber-text)', late: '#f97316', over: 'var(--rose-text)' };
      statsEl.innerHTML = `Среднее в смене: <b style="color:${colors[avgCls]};">${fmtHoursShort(avg)}</b> · Макс: <b style="color:${colors[maxCls]};">${fmtHoursShort(max)}</b>`;
    } else {
      statsEl.innerHTML = 'Среднее в смене: <span style="color:var(--text-muted);">—</span> · Макс: <span style="color:var(--text-muted);">—</span>';
    }
  }

  updateDebtBadge();

  const filtered = state.devices.filter(d => {
    if (state.filter === 'free' && d.status !== 'free') return false;
    if (state.filter === 'issued' && d.status !== 'issued') return false;
    if (state.filter === 'repair' && d.status !== 'repair') return false;
    if (state.filter === 'overdue') {
      if (d.status !== 'issued' || hoursSince(d.issued_at) < OVERDUE_H) return false;
    }
    if (state.filter === 'day') {
      if (d.status !== 'issued' || d.shift === 'Ночная') return false;
    }
    if (state.filter === 'night') {
      if (d.status !== 'issued' || d.shift !== 'Ночная') return false;
    }
    if (state.modelFilter !== 'all' && d.model !== state.modelFilter) return false;
    if (q) {
      const hay = (d.serial + ' ' + (d.holder || '') + ' ' + (d.model || '') + ' ' + (d.defect || '')).toUpperCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });

  filtered.sort((a, b) => {
    if (state.sortField === 'serial') return (state.sortAsc ? 1 : -1) * String(a.serial).localeCompare(String(b.serial));
    if (state.sortField === 'model') return (state.sortAsc ? 1 : -1) * String(a.model || '').localeCompare(String(b.model || ''));
    if (state.sortField === 'status') return (state.sortAsc ? 1 : -1) * String(a.status || '').localeCompare(String(b.status || ''));
    if (state.sortField === 'holder') return (state.sortAsc ? 1 : -1) * String(a.holder || '').localeCompare(String(b.holder || ''));
    if (state.sortField === 'time') {
      const ha = a.status === 'issued' ? hoursSince(a.issued_at) : -1;
      const hb = b.status === 'issued' ? hoursSince(b.issued_at) : -1;
      return (state.sortAsc ? 1 : -1) * (ha - hb);
    }
    const order = { issued: 0, repair: 1, free: 2 };
    const oa = order[a.status] ?? 2;
    const ob = order[b.status] ?? 2;
    if (oa !== ob) return oa - ob;
    const aTime = parseTime(a.last_move) || parseTime(a.issued_at);
    const bTime = parseTime(b.last_move) || parseTime(b.issued_at);
    if (aTime !== bTime) return bTime - aTime;
    return String(a.serial).localeCompare(String(b.serial));
  });

  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  state.tablePage = Math.min(state.tablePage || 0, pages - 1);
  $('pageLabel').textContent = `Страница ${state.tablePage + 1} из ${pages} · найдено ${filtered.length}`;
  $('prevPage').disabled = !state.tablePage;
  $('nextPage').disabled = state.tablePage >= pages - 1;
  if (!filtered.length) {
    $('tbody').innerHTML = '<tr><td colspan="6" style="text-align:center;padding:42px;color:var(--text-muted);font-size:13px;">Сканеры по выбранному фильтру не найдены</td></tr>';
    return;
  }
  const visible = state.printing ? filtered : filtered.slice(state.tablePage * PAGE_SIZE, (state.tablePage + 1) * PAGE_SIZE);
  const html = visible.map(d => renderRow(d)).join('');
  const body = $('tbody');
  if (html !== body.innerHTML) {
    const active = body.contains(document.activeElement) ? { sn: document.activeElement.dataset.sn, action: document.activeElement.dataset.action } : null;
    body.innerHTML = html;
    body.querySelectorAll('[data-action]').forEach(el => { if (el.tagName !== 'BUTTON') { el.tabIndex = 0; el.setAttribute('role', 'button'); } });
    if (active?.sn) body.querySelector(`[data-sn="${CSS.escape(active.sn)}"][data-action="${CSS.escape(active.action)}"]`)?.focus({ preventScroll: true });
  }
}

function renderRow(d) {
  const busy = d.status === 'issued';
  const isRep = d.status === 'repair';
  const h = busy ? hoursSince(d.issued_at) : 0;
  const over = busy && h >= OVERDUE_H;
  const inherited = busy && isInheritedTime(d);

  let badge = '';
  if (busy && over) badge = '<span class="badge-chip chip-over">🚨 ДОЛГ (&gt;14ч)</span>';
  else if (busy) badge = '<span class="badge-chip chip-busy">НА РУКАХ</span>';
  else if (isRep) badge = '<span class="badge-chip chip-repair">🛠 В РЕМОНТЕ</span>';
  else badge = '<span class="badge-chip chip-free">В РЕЗЕРВЕ</span>';

  let shiftChip = '';
  if (busy && d.shift === 'Дневная') {
    shiftChip = ` <span class="badge-chip chip-day" style="cursor:pointer;" data-action="toggle-shift" data-sn="${esc(d.serial)}" title="Клик — переключить на Ночную смену">☀ День ⇄</span>`;
  } else if (busy && d.shift === 'Ночная') {
    shiftChip = ` <span class="badge-chip chip-night" style="cursor:pointer;" data-action="toggle-shift" data-sn="${esc(d.serial)}" title="Клик — переключить на Дневную смену">🌙 Ночь ⇄</span>`;
  }

  const modelCls = d.model === 'Zebra RS5100' ? 'zebra' : 'pm';
  const holderHtml = d.holder
    ? `<span class="holder-pill mono" data-action="filter-holder" data-holder="${esc(d.holder)}" title="Клик — показать все сканеры сотрудника"><span class="holder-avatar">${esc(getInitials(d.holder))}</span>${esc(d.holder)}</span>`
    : '<span style="color:var(--text-muted);font-weight:400;">—</span>';

  let actionBtns = '';
  if (busy) {
    actionBtns = `<button type="button" class="btn-row-return" data-action="return" data-sn="${esc(d.serial)}" title="Принять сканер в 1 клик">Принять</button><button type="button" class="btn-row-repair" data-action="repair" data-sn="${esc(d.serial)}" title="Отметить брак / отправить в ремонт">🛠</button>`;
  } else if (isRep) {
    actionBtns = `<button type="button" class="btn-row-return" data-action="repair" data-sn="${esc(d.serial)}" title="Вернуть исправный сканер в резерв">✅ В строй</button>`;
  } else {
    actionBtns = `<button type="button" class="btn-row-issue" data-action="issue" data-sn="${esc(d.serial)}" title="Подставить сканер для выдачи">Выдать</button><button type="button" class="btn-row-repair" data-action="repair" data-sn="${esc(d.serial)}" title="Отправить в ремонт">🛠</button>`;
  }

  let timeHtml = '', timeTitle = '';
  if (busy) {
    const cls = timeClass(h);
    const barW = timeBarWidth(h);
    const issuedStr = d.issued_at ? new Date(d.issued_at).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).replace(',', '') : '—';
    timeTitle = 'Выдан: ' + issuedStr;
    const inheritMark = inherited ? '<span class="inherit-mark" title="Время перенесено при замене сканера">🔁</span>' : '';
    timeHtml = `<div class="time-inline"><span class="val ${cls}">${fmtHoursShort(h)}</span><span class="bar"><span class="bar-fill ${cls}" style="width:${barW}%"></span></span>${inheritMark}</div>`;
  } else if (isRep) {
    timeTitle = d.defect || 'В ремонте';
    timeHtml = `<span style="color:var(--amber-text);font-size:11.5px;font-weight:700;">🛠 ${esc(d.defect || 'На диагностике')}</span>`;
  } else {
    const lastMoveStr = d.last_move ? new Date(d.last_move).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).replace(',', '') : '—';
    timeTitle = 'Последняя операция: ' + lastMoveStr;
    timeHtml = `<div class="time-inline"><span class="val empty">Свободен</span><span class="bar"><span class="bar-fill zero" style="width:100%"></span></span></div>`;
  }

  let rowClass = '';
  if (over) rowClass = 'row-overdue';
  else if (isRep) rowClass = 'row-repair';
  if (state.justIssued === d.serial) rowClass += ' just-issued';
  if (state.justReturned === d.serial) rowClass += ' just-returned';

  const row = `<tr class="${rowClass}"><td><span class="mono sn-link" data-action="audit" data-sn="${esc(d.serial)}" title="Открыть досье и историю сканера">${formatSnSplit(d.serial)}</span></td><td><span class="model-pill ${modelCls}">${esc(d.model)}</span></td><td>${badge}${shiftChip}</td><td>${holderHtml}</td><td style="text-align:right;" title="${esc(timeTitle)}">${timeHtml}</td><td style="text-align:right;"><div class="row-action-cell">${actionBtns}</div></td></tr>`;
  const labels = ['Серийный номер', 'Модель', 'Статус', 'Сотрудник', 'Время / причина', 'Действия'];
  let col = 0;
  return row.replace(/<td(\s[^>]*)?>/g, (_, attrs = '') => `<td${attrs} data-label="${labels[col++]}">`);
}

function quickReturnFromRow(sn) {
  doReturn(sn);
}
function pickForIssue(sn) {
  $('issSn').value = sn;
  $('issSn').classList.remove('err');
  updateIssBanner(sn);
  if ($('issWorker').value.trim()) {
    submitIssue();
  } else {
    $('issWorker').focus();
  }
}

/* ===== ДОСЬЕ СКАНЕРА И ЖУРНАЛ ДВИЖЕНИЙ ===== */
async function openAudit(sn) {
  const dev = state.devices.find(d => d.serial === sn);
  if (!dev) return;
  state.auditSn = sn;
  $('audSn').innerText = dev.serial;
  const bcTxt = $('audBarcodeText');
  if (bcTxt) bcTxt.innerText = dev.serial;
  $('audModel').innerText = dev.model || '—';
  $('audHolder').innerText = dev.holder || (dev.status === 'repair' ? 'В ремзоне' : 'На складе (в резерве)');
  const badge = $('audStatusBadge');
  if (dev.status === 'issued') {
    badge.className = 'badge-chip chip-busy';
    badge.innerText = 'На руках (в смене)';
  } else if (dev.status === 'repair') {
    badge.className = 'badge-chip chip-repair';
    badge.innerText = 'В ремонте / Браке';
  } else {
    badge.className = 'badge-chip chip-free';
    badge.innerText = 'Свободен в резерве';
  }
  $('audDuration').innerText = dev.status === 'issued' && dev.issued_at
    ? fmtHoursShort(hoursSince(dev.issued_at)) + ' (' + (dev.shift || '—') + ')'
    : (dev.status === 'repair' ? (dev.defect || 'На диагностике') : 'Готов к выдаче');

  const shiftBtn = $('audShiftBtn');
  if (shiftBtn) {
    if (dev.status === 'issued') {
      shiftBtn.style.display = 'inline-flex';
      shiftBtn.innerText = dev.shift === 'Ночная' ? '🔀 Перевести на ДЕНЬ' : '🔀 Перевести на НОЧЬ';
      shiftBtn.onclick = () => toggleDeviceShift(sn);
    } else {
      shiftBtn.style.display = 'none';
    }
  }
  const repBtn = $('audRepairBtn');
  if (repBtn) {
    repBtn.innerText = dev.status === 'repair' ? '✅ Вернуть из ремонта в строй' : '🛠 Отправить в ремонт / брак';
    repBtn.onclick = () => toggleDeviceRepair(sn);
  }

  $('auditOverlay').classList.add('show');
  $('auditDrawer').classList.add('open');
  refreshScrollLock();

  const localMoves = await new Promise(r => {
    if (!db) return r([]);
    try {
      const t = db.transaction('moves', 'readonly');
      const req = t.objectStore('moves').index('serial').getAll(sn);
      req.onsuccess = () => r(req.result || []);
      req.onerror = () => r([]);
      t.onabort = () => r([]);
    } catch(e) { r([]); }
  });
  const filteredLocal = localMoves.filter(m => m.serial === sn);

  let cloudMoves = [];
  if (cloud && navigator.onLine) {
    try {
      const { data } = await withTimeout(
        cloud.from('movements').select('*').eq('serial', sn).order('created_at', { ascending: false }).limit(25),
        NET_TIMEOUT_MS,
        'audit query'
      );
      if (state.auditSn !== sn) return;
      if (data) cloudMoves = data;
    } catch(e) {}
  }
  if (state.auditSn !== sn) return;

  const combined = [...cloudMoves, ...filteredLocal];
  const seen = new Set();
  const moves = combined.filter(m => {
    const ts = parseTime(m.created_at || m.at);
    const sig = m.event_id || m.moveId || `${m.action || ''}|${m.worker || ''}|${ts}`;
    if (seen.has(sig)) return false;
    seen.add(sig);
    return true;
  }).sort((a, b) => parseTime(b.created_at || b.at) - parseTime(a.created_at || a.at)).slice(0, 30);

  const tl = $('audTimeline');
  if (!moves.length) {
    tl.innerHTML = '<div style="color:var(--text-muted);font-size:12px;text-align:center;padding:15px;">Журнал операций по данному сканеру пока пуст.</div>';
    return;
  }
  tl.innerHTML = moves.map(h => {
    const isRet = h.action && h.action.startsWith('Возврат');
    const d = h.created_at || h.at;
    const t = d ? new Date(d).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—';
    const actColor = isRet ? 'var(--emerald-text)' : 'var(--brand-text)';
    return `<div class="timeline-item ${isRet ? 'return' : ''}"><div class="timeline-dot"></div><div class="timeline-time">${t}</div><div class="timeline-action" style="color:${actColor};">${esc(h.action)}</div><div class="timeline-actor">👤 ${esc(h.worker || 'Склад')} · оператор ${esc(h.operator_id || (h.terminal_id ? 'общий режим' : 'старая запись'))} · терминал ${esc(h.terminal_id || '—')}</div></div>`;
  }).join('');
}

function closeAuditDrawer() {
  state.auditSn = null;
  $('auditDrawer').classList.remove('open');
  $('auditOverlay').classList.remove('show');
  refreshScrollLock();
  focusActiveTerminalInput();
}

/* ===== ВЫГРУЗКА ТЕКУЩЕГО ПАРКА (CSV/EXCEL) И ПЕЧАТЬ АКТА ===== */
function csvSafe(v) { return SkladCore.csvSafe(v); }
function exportFleetSnapshot() {
  let csv = '\uFEFFСерийный номер;Модель сканера;Статус;Сотрудник (Бейдж);Смена;Время на руках;Выдан;Активность;Примечание\n';
  state.devices.forEach(d => {
    const stLabel = d.status === 'issued' ? 'В работе' : (d.status === 'repair' ? 'В ремонте' : 'На складе');
    const dur = d.status === 'issued' && d.issued_at ? fmtHoursShort(hoursSince(d.issued_at)) : '—';
    csv += [
      d.serial,
      d.model,
      stLabel,
      d.holder || '—',
      d.shift || '—',
      dur,
      d.issued_at || '',
      d.last_move || '',
      d.defect || ''
    ].map(csvSafe).join(';') + '\n';
  });
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `sklad_scanners_report_${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  showToast('ОТЧЁТ ВЫГРУЖЕН (CSV / EXCEL)', `Экспортировано ${state.devices.length} сканеров`);
}

function printShiftAct() {
  const dt = new Date().toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  const total = state.devices.length;
  const issued = state.devices.filter(d => d.status === 'issued').length;
  const free = state.devices.filter(d => d.status === 'free').length;
  const repair = state.devices.filter(d => d.status === 'repair').length;
  const meta = $('printActMeta');
  if (meta) {
    meta.innerText = `Дата и время: ${dt} • Смена: ${state.issueShift} • Всего сканеров: ${total} шт. (На руках: ${issued} | В резерве: ${free} | В ремонте: ${repair})`;
  }
  state.printing = true; renderTable();
  window.print();
  state.printing = false; renderTable();
}

async function processImport() {
  try {
    requireReady();
    if (!db || !state.dbReady) throw new Error('Локальная база недоступна. Импорт не выполнен.');
    const raw = [...new Set($('impText').value.split(/\r?\n/).map(fixLayout).filter(Boolean))];
    if (!raw.length) return;
    if (raw.length > 500 || raw.some(sn => !SN_REGEX.test(sn))) throw new Error('Допускается до 500 корректных серийных номеров. Исправьте строки перед импортом.');
    const existing = new Set(state.devices.map(d => d.serial));
    const fresh = raw.filter(sn => !existing.has(sn));
    if (!fresh.length) { showToast('ИМПОРТ', 'Все номера уже зарегистрированы', 'warn'); return; }
    await saveDeviceChanges(fresh.map(serial => ({ dev: { serial, model: detectScannerModel(serial), status: 'free', holder: '', shift: '—', issued_at: null, defect: '' }, actionName: 'Импорт в парк', workerName: '' })), { admin: true });
    closeModal('impModal'); $('impText').value = '';
    showToast('ИМПОРТ СОХРАНЁН ЛОКАЛЬНО', `Добавлено ${fresh.length}. Дождитесь подтверждения облака.`);
  } catch (e) { showToast('ОШИБКА ИМПОРТА', e.message, 'err'); }
}

function showDiag() {
  const countReq = db && state.dbReady
    ? new Promise(resolve => {
        try {
          const t = db.transaction('queue', 'readonly');
          const q = t.objectStore('queue').count();
          q.onsuccess = () => resolve({ count: q.result, error: false });
          q.onerror = () => resolve({ count: null, error: true });
          t.onabort = () => resolve({ count: null, error: true });
          t.onerror = () => resolve({ count: null, error: true });
        } catch(e) { resolve({ count: null, error: true }); }
      })
    : Promise.resolve({ count: null, error: true });

  Promise.all([countReq, renderQueuePreview()]).then(([countResult, preview]) => {
    const n = countResult.count;
    const queueCountText = countResult.error ? '⚠ недоступно' : String(n);
    const lastBk = localStorage.getItem('sklad_last_backup_date') || '—';
    const autoSwapTxt = state.autoSwap ? 'ВКЛ (мгновенная замена в 1 пик)' : 'ВЫКЛ (с окном подтверждения)';
    const autoSwapColor = state.autoSwap ? 'var(--emerald-text)' : 'var(--text-muted)';
    const dbOk = state.dbReady ? '✅ IndexedDB активна' : '⚠ Запись заблокирована';
    const dbColor = state.dbReady ? 'var(--emerald-text)' : 'var(--amber-text)';
    $('diagContent').innerHTML = `
      <div>ВЕРСИЯ ЯДРА: <span style="color:var(--brand-text);">v12.0 · атомарные операции</span></div>
      <div>ЛОКАЛЬНАЯ БД: <span style="color:${dbColor};">${dbOk}</span></div>
      <div>ВСЕГО СКАНЕРОВ В ПАРКЕ: <span style="color:var(--brand-text);">${state.devices.length}</span> шт.</div>
      <div>ПАКЕТОВ В ОЧЕРЕДИ SYNC: <span style="color:${countResult.error ? 'var(--rose-text)' : 'var(--brand-text)'};">${queueCountText}</span></div>
      <div>ТЕКУЩАЯ СМЕНА: <span style="color:var(--text-main);">${state.issueShift}</span> (${state.issueShiftAuto ? 'авто' : 'ручная'})</div>
      <div>ЭКСПРЕСС-ЗАМЕНА: <span style="color:${autoSwapColor};">${autoSwapTxt}</span> <button type="button" class="btn-hud" id="btnToggleAutoSwapDiag" style="padding:2px 8px;font-size:10px;margin-left:8px;min-width:auto;">Переключить</button></div>
      <div>ПОСЛЕДНИЙ БЭКАП: <span style="color:var(--emerald-text);">${esc(lastBk)}</span></div>
      <div>СТАТУС СЕТИ / ОШИБКА: <span style="color:var(--rose-text);">${esc(state.lastError)}</span></div>
      ${countResult.error || n ? `<div style="margin-top:12px;border-top:1px solid var(--card-border);padding-top:8px;"><div style="font-size:11px;font-weight:800;color:var(--amber-text);margin-bottom:6px;">⚠ ОЧЕРЕДЬ ДОКАЧКИ:</div><div style="max-height:180px;overflow-y:auto;background:var(--input-bg);border-radius:6px;padding:6px 10px;">${preview}</div>${countResult.error ? '' : '<div style="margin-top:8px;"><button type="button" class="btn-hud" id="btnRetryQueueDiag" style="border-color:rgba(244,63,94,.4);color:var(--rose-text);font-size:10px;min-width:auto;">↻ Повторить синхронизацию</button></div>'}</div>` : ''}
    `;
    openModal('diagModal');
    $('btnToggleAutoSwapDiag')?.addEventListener('click', toggleAutoSwap);
    $('btnRetryQueueDiag')?.addEventListener('click', retryQueuedSync);
  });
}

function toggleAutoSwap() {
  state.autoSwap = !state.autoSwap;
  try { localStorage.setItem(AUTO_SWAP_KEY, state.autoSwap ? 'true' : 'false'); } catch(e) {}
  showToast('РЕЖИМ ЗАМЕНЫ СКАНЕРА', state.autoSwap ? 'Включена мгновенная замена без лишних окон' : 'Включено окно подтверждения замены', 'warn');
  closeModal('diagModal');
}

function openDeleteModal() {

  $('delSearch').value = '';
  renderDeleteList();
  openModal('delModal');
  setTimeout(() => $('delSearch').focus(), 50);
}
function renderDeleteList() {
  const q = ($('delSearch').value || '').trim().toUpperCase();
  const list = state.devices.filter(d => {
    if (!q) return true;
    const hay = ((d.serial || '') + ' ' + (d.model || '') + ' ' + (d.holder || '')).toUpperCase();
    return hay.includes(q);
  }).sort((a, b) => String(a.serial).localeCompare(String(b.serial)));
  const wrap = $('delList');
  if (!list.length) {
    wrap.innerHTML = '<div class="del-empty">Сканеры не найдены</div>';
    return;
  }
  wrap.innerHTML = list.map(d => {
    const status = d.status === 'issued' ? `на руках у ${esc(d.holder || '—')}` : (d.status === 'repair' ? 'в ремонте' : 'в резерве');
    return `<div class="del-row"><span class="sn">${esc(d.serial)}</span><span class="info">${esc(d.model || '—')} · ${status}</span><button type="button" class="del-btn" data-del-sn="${esc(d.serial)}">🗑 Удалить</button></div>`;
  }).join('');
}
async function confirmDelete(sn) {
  const dev = state.devices.find(d => d.serial === sn);
  if (!dev) return;
  const ok = await askConfirmDialog(
    'Списание сканера с сохранением истории',
    `Вы действительно хотите списать сканер "${sn}" (${dev.model}) из базы данных?`,
    'Удалить сканер'
  );
  if (!ok) return;
  try {
    await deleteSerial(sn);
    showToast('УДАЛЕНО ИЗ ПАРКА', sn, 'warn');
    renderDeleteList();
  } catch(e) { showToast('ОШИБКА УДАЛЕНИЯ', e.message || '?', 'err'); }
}

const modalFocusStack = [];
function openModal(id) {
  modalFocusStack.push({ id, element: document.activeElement });
  const el = $(id);
  if (el) el.classList.add('show');
  refreshScrollLock();
}
function closeModal(id) {
  const i = modalFocusStack.findLastIndex(entry => entry.id === id);
  const previous = i >= 0 ? modalFocusStack.splice(i, 1)[0].element : null;
  if (id === 'confirmDialogModal' && confirmDialogResolver) { const fn = confirmDialogResolver; confirmDialogResolver = null; fn(false); }
  setTimeout(() => previous?.isConnected && previous.focus(), 0);
  const el = $(id);
  if (el) el.classList.remove('show');
  refreshScrollLock();
}

function showToast(title, desc, kind = 'ok') {
  clearUndo();
  const el = $('toast');
  $('tTitle').innerText = title;
  $('tDesc').innerText = desc || '';
  $('tIcon').innerText = kind === 'err' ? '✕' : (kind === 'warn' ? '!' : '✓');
  $('tIcon').style.background = '';
  $('tIcon').style.borderColor = '';
  $('tIcon').style.color = '';
  $('tTitle').style.color = '';
  const oldBtn = el.querySelector('.t-undo');
  if (oldBtn) oldBtn.remove();
  el.className = kind === 'err' ? 'err' : (kind === 'warn' ? 'warn' : '');
  el.classList.add('show');
  clearTimeout(state.toastTimer);
  state.toastTimer = setTimeout(() => el.classList.remove('show'), 3200);
}

/* ===== ДЕЛЕГИРОВАНИЕ СОБЫТИЙ И ГОРЯЧИЕ КЛАВИШИ ===== */
function setupDelegation() {
  document.querySelectorAll('[data-set-theme]').forEach(btn => {
    btn.addEventListener('click', () => applyTheme(btn.dataset.setTheme, true));
  });

  document.querySelectorAll('[data-close-modal]').forEach(btn => {
    btn.addEventListener('click', () => closeModal(btn.dataset.closeModal));
  });

  document.querySelectorAll('.modal-overlay').forEach(m => {
    m.addEventListener('click', e => {
      if (e.target === m) {
        if (m.id === 'confirmDialogModal') resolveConfirmDialog(false);
        else closeModal(m.id);
      }
    });
  });

  $('prevPage').addEventListener('click', () => { state.tablePage--; renderTable(); });
  $('nextPage').addEventListener('click', () => { state.tablePage++; renderTable(); });
  $('btnDownloadQueue').addEventListener('click', () => downloadQueue().catch(reportLocalError));
  $('btnResolveQueue').addEventListener('click', () => resolveQueueFromCloud().catch(reportLocalError));
  $('btnReportExport').addEventListener('click', exportPeriodReport);
  $('btnFleetExport').addEventListener('click', exportFleetSnapshot);
  $('confirmDialogOkBtn')?.addEventListener('click', () => resolveConfirmDialog(true));
  $('confirmDialogCancelBtn')?.addEventListener('click', () => resolveConfirmDialog(false));

  $('shiftPill')?.addEventListener('click', e => {
    if (e.target.id === 'shiftBadge') resetShiftToAuto(e);
    else toggleShift();
  });
  $('syncStatus')?.addEventListener('click', () => { if (terminalContext.id) showDiag(); });
  $('debtBtn')?.addEventListener('click', openDebtModal);
  $('btnCopySummary')?.addEventListener('click', copyTelegramSummary);
  $('btnPrintAct')?.addEventListener('click', printShiftAct);
  $('btnExportCsv')?.addEventListener('click', exportExcel);
  $('btnOpenBackup')?.addEventListener('click', openBackupModal);
  $('btnOpenImport')?.addEventListener('click', () => { openModal('impModal'); setTimeout(() => $('impText')?.focus(), 50); });

  /* Меню «⋮»: открытие/закрытие, автозакрытие по клику на пункт или вне меню */
  $('btnMenu')?.addEventListener('click', e => {
    e.stopPropagation();
    $('menuPop')?.classList.toggle('show');
  });
  document.addEventListener('click', e => {
    const pop = $('menuPop');
    if (!pop || !pop.classList.contains('show')) return;
    if (!e.target.closest('.menu-wrap') || e.target.closest('.menu-item')) pop.classList.remove('show');
  });

  $('btnDebtAlertShow')?.addEventListener('click', openDebtModal);
  $('btnDebtAlertClose')?.addEventListener('click', dismissDebtAlert);
  $('btnShowDebtsInTable')?.addEventListener('click', showAllDebtsInTable);
  $('btnClearDebtHistory')?.addEventListener('click', clearDebtHistory);

  $('auditOverlay')?.addEventListener('click', closeAuditDrawer);
  $('btnCloseAudit')?.addEventListener('click', closeAuditDrawer);
  $('audBarcodeCard')?.addEventListener('click', () => {
    if (state.auditSn) {
      copyTextSafe(state.auditSn).then(() => showToast('СКОПИРОВАНО', state.auditSn));
    }
  });

  $('btnProcessImport')?.addEventListener('click', processImport);
  $('btnHardReset')?.addEventListener('click', hardReset);
  $('btnForceSync')?.addEventListener('click', forceSync);
  $('btnCreateCloudBackup')?.addEventListener('click', () => doBackup('manual'));
  $('btnDownloadJsonBackup')?.addEventListener('click', downloadJsonBackup);
  $('btnRefreshBackupList')?.addEventListener('click', renderBackupList);

  $('tabModeReturn')?.addEventListener('click', () => setRightMode('return'));
  $('tabModeDefect')?.addEventListener('click', () => setRightMode('defect'));
  $('defBtn')?.addEventListener('click', submitDefectForm);
  $('defSn')?.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); submitDefectForm(); } });
  $('defReason')?.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); submitDefectForm(); } });

  $('modelFilterBar')?.addEventListener('click', e => {
    const btn = e.target.closest('[data-mfilter]');
    if (!btn) return;
    document.querySelectorAll('[data-mfilter]').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    state.modelFilter = btn.dataset.mfilter;
    renderTable();
  });

  document.querySelectorAll('th.sortable').forEach(th => {
    th.addEventListener('click', () => {
      const f = th.dataset.sort;
      if (state.sortField === f) state.sortAsc = !state.sortAsc;
      else { state.sortField = f; state.sortAsc = true; }
      document.querySelectorAll('.sort-ind').forEach(el => el.innerText = '');
      const ind = $('sort-' + f);
      if (ind) ind.innerText = state.sortAsc ? '▲' : '▼';
      renderTable();
    });
  });

  $('liveTicker')?.addEventListener('click', e => {
    const chip = e.target.closest('[data-ticker-sn]');
    if (chip) openAudit(chip.dataset.tickerSn);
  });

  $('tbody')?.addEventListener('click', e => {
    const target = e.target.closest('[data-action]');
    if (!target) return;
    const action = target.dataset.action;
    const sn = target.dataset.sn;
    if (action === 'audit') openAudit(sn);
    else if (action === 'return') quickReturnFromRow(sn);
    else if (action === 'issue') pickForIssue(sn);
    else if (action === 'repair') toggleDeviceRepair(sn);
    else if (action === 'toggle-shift') toggleDeviceShift(sn);
    else if (action === 'filter-holder') filterByHolder(target.dataset.holder);
  });

  $('issSnBanner')?.addEventListener('click', async e => {
    const retBtn = e.target.closest('[data-banner-return]');
    if (retBtn) {
      const sn = retBtn.dataset.bannerReturn;
      await doReturn(sn);
      $('issSn').value = sn;
      updateIssBanner(sn);
      $('issWorker').focus();
      return;
    }
    const resBtn = e.target.closest('[data-banner-restore]');
    if (resBtn) {
      const sn = resBtn.dataset.bannerRestore;
      await toggleDeviceRepair(sn);
      $('issSn').value = sn;
      updateIssBanner(sn);
      $('issWorker').focus();
    }
  });

  $('issDrop')?.addEventListener('click', e => {
    const item = e.target.closest('.drop-item');
    if (!item) return;
    const sn = item.dataset.sn;
    $('issSn').value = sn;
    resetIssueDropdown();
    updateIssBanner(sn);
    if ($('issWorker').value.trim()) submitIssue();
    else $('issWorker').focus();
  });

  $('issPickList')?.addEventListener('click', e => {
    const item = e.target.closest('.drop-item');
    if (!item) return;
    const sn = item.dataset.sn;
    closeModal('issPickModal');
    $('issSn').value = sn;
    state.issDropNavigated = false;
    updateIssBanner(sn);
    if ($('issWorker').value.trim()) submitIssue();
    else $('issWorker').focus();
  });

  $('workerDrop')?.addEventListener('click', e => {
    const item = e.target.closest('.drop-item');
    if (!item) return;
    $('issWorker').value = item.dataset.worker;
    resetWorkerDropdown();
    if ($('issSn').value.trim()) submitIssue();
    else $('issSn').focus();
  });

  $('retDrop')?.addEventListener('click', e => {
    const item = e.target.closest('.drop-item');
    if (!item) return;
    $('retQuery').value = item.dataset.sn;
    resetRetDropdown();
    quickReturn();
  });

  $('pickList')?.addEventListener('click', e => {
    const item = e.target.closest('.drop-item');
    if (!item) return;
    closeModal('pickModal');
    doReturn(item.dataset.sn);
  });

  $('debtModalList')?.addEventListener('click', e => {
    const item = e.target.closest('.debt-modal-item');
    if (!item) return;
    closeModal('debtModal');
    filterByHolder(item.dataset.holder);
  });

  $('debtHistoryList')?.addEventListener('click', e => {
    const item = e.target.closest('.debt-modal-item');
    if (!item) return;
    closeModal('debtModal');
    filterByHolder(item.dataset.holder);
  });

  $('delList')?.addEventListener('click', e => {
    const btn = e.target.closest('[data-del-sn]');
    if (!btn) return;
    confirmDelete(btn.dataset.delSn);
  });

  $('backupList')?.addEventListener('click', e => {
    const btn = e.target.closest('[data-bk-action]');
    if (!btn) return;
    const file = btn.dataset.bkFile;
    if (btn.dataset.bkAction === 'restore') restoreFromBackup(file);
    else if (btn.dataset.bkAction === 'delete') deleteBackup(file);
  });
}

const debouncedRenderTable = debounce(renderTable, 70);

$('issSn').addEventListener('input', () => { state.issDropNavigated = false; });
$('issSn').addEventListener('input', debounce(handleIssSnInput, 35));
$('issSn').addEventListener('input', debounce(saveDraft, 400));
$('issSn').addEventListener('keydown', handleIssSnKeydown);

$('issWorker').addEventListener('input', debounce(handleWorkerInput, 45));
$('issWorker').addEventListener('input', debounce(() => { if (state.issueShiftAuto) refreshSmartShift(); }, 250));
$('issWorker').addEventListener('input', debounce(saveDraft, 400));
$('issWorker').addEventListener('keydown', handleIssWorkerKeydown);

$('issueForm').addEventListener('submit', e => { e.preventDefault(); submitIssue(); });
$('retQuery').addEventListener('input', debounce(handleRetInput, 40));
$('retQuery').addEventListener('keydown', handleRetKeydown);
$('retBtn').addEventListener('click', quickReturn);
$('searchTable').addEventListener('input', () => { updateSearchWrap(); debouncedRenderTable(); });
$('searchClearBtn').addEventListener('click', () => {
  $('searchTable').value = '';
  updateSearchWrap();
  renderTable();
  focusActiveTerminalInput();
});
$('delSearch').addEventListener('input', debounce(renderDeleteList, 90));

document.querySelectorAll('.kpi-card').forEach(s => {
  s.addEventListener('click', () => {
    const f = s.dataset.filter;
    if (f === 'overdue' && state.filter !== 'overdue') {
      openDebtModal();
      return;
    }
    if (f === 'shift_split') {
      state.filter = state.filter === 'day' ? 'night' : 'day';
      const ssl = $('shiftSplitLabel');
      if (ssl) ssl.innerText = state.filter === 'day' ? 'Фильтр: ДЕНЬ' : 'Фильтр: НОЧЬ';
      document.querySelectorAll('.kpi-card').forEach(x => x.classList.remove('active'));
      s.classList.add('active');
      renderTable();
      return;
    }
    const sslReset = $('shiftSplitLabel');
    if (sslReset) sslReset.innerText = 'День / Ночь';
    if (f === 'all' && state.filter === 'all' && $('searchTable').value) {
      $('searchTable').value = '';
      updateSearchWrap();
    }
    document.querySelectorAll('.kpi-card').forEach(x => x.classList.remove('active'));
    s.classList.add('active');
    state.filter = f;
    renderTable();
  });
});

$('swapConfirm').addEventListener('click', confirmSwap);

document.addEventListener('click', e => {
  if (!e.target.closest('.hud-group')) {
    resetIssueDropdown();
    resetRetDropdown();
    resetWorkerDropdown();
  }
});

let brandClicks = 0, brandTimer = null;
$('brandTag').addEventListener('click', () => {
  brandClicks++;
  clearTimeout(brandTimer);
  brandTimer = setTimeout(() => { brandClicks = 0; }, 700);
  if (brandClicks >= 3) { brandClicks = 0; openDeleteModal(); }
});

document.addEventListener('keydown', e => {
  if (!terminalContext.id) return;
  if ($('confirmDialogModal').classList.contains('show')) {
    if (e.key === 'Enter') { e.preventDefault(); resolveConfirmDialog(true); return; }
    if (e.key === 'Escape') { e.preventDefault(); resolveConfirmDialog(false); return; }
  }

  if ($('issPickModal').classList.contains('show')) {
    const items = Array.from($('issPickList').querySelectorAll('.drop-item'));
    const cur = items.findIndex(it => it.classList.contains('selected'));
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (!items.length) return;
      e.preventDefault();
      if (cur >= 0) items[cur].classList.remove('selected');
      const next = e.key === 'ArrowDown' ? (cur + 1) % items.length : (cur - 1 + items.length) % items.length;
      items[next].classList.add('selected');
      items[next].scrollIntoView({ block: 'nearest' });
      return;
    }
    if (e.key === 'Enter' && cur >= 0 && items[cur]) {
      e.preventDefault();
      const sn = items[cur].dataset.sn;
      closeModal('issPickModal');
      $('issSn').value = sn;
      state.issDropNavigated = false;
      updateIssBanner(sn);
      if ($('issWorker').value.trim()) submitIssue();
      else $('issWorker').focus();
      return;
    }
    if (e.key === 'Escape') { e.preventDefault(); closeModal('issPickModal'); return; }
  }

  if ($('pickModal').classList.contains('show')) {
    const items = Array.from($('pickList').querySelectorAll('.drop-item'));
    const cur = items.findIndex(it => it.classList.contains('selected'));
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (!items.length) return;
      e.preventDefault();
      if (cur >= 0) items[cur].classList.remove('selected');
      const next = e.key === 'ArrowDown' ? (cur + 1) % items.length : (cur - 1 + items.length) % items.length;
      items[next].classList.add('selected');
      items[next].scrollIntoView({ block: 'nearest' });
      return;
    }
    if (e.key === 'Enter' && cur >= 0 && items[cur]) {
      e.preventDefault();
      const sn = items[cur].dataset.sn;
      closeModal('pickModal');
      doReturn(sn);
      return;
    }
    if (e.key === 'Escape') { e.preventDefault(); closeModal('pickModal'); return; }
  }

  if (e.ctrlKey && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'z') {
    if (state.undoAction) { e.preventDefault(); undoLast(); return; }
  }
  if (e.altKey && e.key.toLowerCase() === 't') { e.preventDefault(); cycleTheme(); return; }
  if (e.ctrlKey && e.altKey && e.key.toLowerCase() === 'd') { e.preventDefault(); openDeleteModal(); return; }
  if ($('swapModal').classList.contains('show') && e.key === 'Enter') { e.preventDefault(); confirmSwap(); return; }

  if (e.key === 'F1') { e.preventDefault(); $('issWorker').focus(); }
  else if (e.key === 'F2') { e.preventDefault(); setRightMode('return'); }
  else if (e.key === 'F3') { e.preventDefault(); setRightMode('defect'); }
  else if (e.key === 'F4') { e.preventDefault(); toggleShift(); }
  else if (e.ctrlKey && e.key.toLowerCase() === 'k') { e.preventDefault(); $('searchTable').focus(); }
  else if (e.ctrlKey && e.key.toLowerCase() === 'e') { e.preventDefault(); exportExcel(); }
  else if (e.ctrlKey && e.key.toLowerCase() === 'p') { e.preventDefault(); printShiftAct(); }
  else if (e.ctrlKey && e.key.toLowerCase() === 'i') { e.preventDefault(); openModal('impModal'); }
  else if (e.key === 'Escape') {
    const anyModal = document.querySelector('.modal-overlay.show');
    const drawer = $('auditDrawer') && $('auditDrawer').classList.contains('open');
    if (anyModal || drawer) {
      document.querySelectorAll('.modal-overlay.show').forEach(m => closeModal(m.id));
      closeAuditDrawer();
    } else {
      clearAllInputsAndFocus();
      showToast('ФОРМА ОЧИЩЕНА', 'Готов к новому сканированию');
    }
  }
});

setInterval(() => { if (state.issueShiftAuto) refreshSmartShift(); else updateShiftPill(); }, 30000);
setInterval(() => { renderTable(); checkDebtors(); alertNewDebtors(); }, 60000);

window.addEventListener('DOMContentLoaded', () => {
  try {
    const pref = JSON.parse(localStorage.getItem('sklad_shift_pref') || '{}');
    if (pref.auto === false && (pref.shift === 'Дневная' || pref.shift === 'Ночная')) {
      state.issueShift = pref.shift;
      state.issueShiftAuto = false;
    } else {
      state.issueShift = computeSmartShift('');
      state.issueShiftAuto = true;
    }
  } catch(e) {
    state.issueShift = computeSmartShift('');
    state.issueShiftAuto = true;
  }
  applyTheme(state.theme, false);
  updateShiftPill();
  setupDelegation();
  updateDebtBadge();
  initStorage().then(initTerminal).catch(reportLocalError);
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(e => dbg('offline shell', e.message));
});

window.addEventListener('online', () => { state.syncBackoff = 0; scheduleSync(500); });
window.addEventListener('offline', () => setSync(false, 'Офлайн (Локальная БД)'));
window.addEventListener('beforeunload', () => { try { saveDraft(); } catch(e) {} });
