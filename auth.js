/* Authentication never trusts user_metadata. Membership is checked by scanner_session. */
let authSubscription;
let accountGeneration = 0;
async function initAccount() {
  $('loginForm').addEventListener('submit', async event => {
    event.preventDefault();
    const btn = $('loginBtn'); btn.disabled = true; $('loginError').textContent = '';
    try {
      if (!cloud) throw new Error('Не удалось загрузить клиент облака. Проверьте соединение.');
      const { data, error } = await cloud.auth.signInWithPassword({ email: $('loginEmail').value.trim(), password: $('loginPassword').value });
      $('loginPassword').value = '';
      if (error) throw error;
      await useSession(data.session);
    } catch (e) { $('loginError').textContent = e.message; } finally { btn.disabled = false; }
  });
  $('logoutBtn').addEventListener('click', async () => {
    if (state.opLock || state.syncing) { showToast('ПОДОЖДИТЕ', 'Дождитесь завершения операции', 'warn'); return; }
    const queue = db ? await readQueueWithKeys() : [];
    if (queue.length && !await askConfirmDialog('Выход из аккаунта', `Осталось ${queue.length} неотправленных операций. Они сохранятся на этом устройстве. Для отправки войдите под тем же аккаунтом.`, 'Выйти')) return;
    const { error } = await cloud.auth.signOut({ scope: 'local' });
    if (error) { showToast('ОШИБКА ВЫХОДА', error.message, 'err'); return; }
    await useSession(null);
  });
  if (typeof supabase !== 'undefined') cloud = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
  if (!cloud) { await useSession(null); return; }
  authSubscription = cloud.auth.onAuthStateChange((event, session) => {
    // Do not call other Supabase methods synchronously inside the auth callback.
    if (event === 'SIGNED_OUT') setTimeout(() => useSession(null), 0);
    if (event === 'TOKEN_REFRESHED') setTimeout(() => scheduleSync(200), 0);
  });
  const { data, error } = await cloud.auth.getSession();
  if (error) $('loginError').textContent = error.message;
  await useSession(data?.session || null);
}
async function useSession(session) {
  const generation = ++accountGeneration;
  clearTimeout(syncScheduledTimer);
  sessionAccess.user = session?.user || null;
  sessionAccess.role = null;
  state.devices = [];
  clearUndo();
  if (!session) {
    renderTable();
    $('appContent').inert = true;
    $('accountPanel').hidden = false;
    $('logoutBtn').hidden = true;
    setSync(false, 'Требуется вход');
    hideBoot();
    $('loginEmail').focus();
    return;
  }
  try {
    let data;
    if (!navigator.onLine) {
      const cached = db && await requestResult(db.transaction('meta').objectStore('meta').get(`member:${session.user.id}`));
      if (!cached || Date.now() - cached.verifiedAt > 12 * 60 * 60 * 1000) throw new Error('Для входа нужно подтвердить доступ онлайн');
      data = cached;
    } else {
      const result = await withTimeout(cloud.rpc('scanner_session'), NET_TIMEOUT_MS, 'проверка доступа');
      if (result.error) throw result.error;
      data = result.data;
      if (db) {
        const tx = db.transaction('meta', 'readwrite'), done = transactionDone(tx);
        tx.objectStore('meta').put({ role: data.role, verifiedAt: Date.now() }, `member:${session.user.id}`);
        await done;
      }
    }
    if (!['operator', 'admin'].includes(data?.role)) throw new Error('Администратор ещё не предоставил доступ');
    if (generation !== accountGeneration) return;
    sessionAccess.role = data.role;
    $('accountPanel').hidden = true;
    $('appContent').inert = false;
    refreshAccountUI();
    await loadLocal();
    await syncNow();
    scheduleSync();
    focusActiveTerminalInput();
  } catch (e) {
    sessionAccess.role = null;
    $('appContent').inert = true;
    $('accountPanel').hidden = false;
    $('loginError').textContent = `Доступ не подтверждён: ${e.message}. Для входа нужно соединение с облаком.`;
    $('logoutBtn').hidden = false;
  } finally { hideBoot(); }
}
function refreshAccountUI() {
  $('accountName').textContent = sessionAccess.user ? `${sessionAccess.user.email || 'Оператор'} · ${sessionAccess.role === 'admin' ? 'администратор' : 'оператор'}` : '';
  $('logoutBtn').hidden = !sessionAccess.user;
  document.querySelectorAll('[data-admin-only]').forEach(el => el.hidden = sessionAccess.role !== 'admin');
}
