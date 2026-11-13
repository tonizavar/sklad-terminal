/* Shared terminal: no registration, passwords or user sessions. */
async function initTerminal() {
  terminalContext.id = terminalId();
  if (typeof supabase !== 'undefined') {
    cloud = supabase.createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
  }
  $('appContent').inert = false;
  try {
    await loadLocal();
    if (cloud) await syncNow();
    else setSync(false, 'Облако недоступно — сохранение локально');
    scheduleSync();
  } catch (e) { reportLocalError(e); }
  finally { hideBoot(); focusActiveTerminalInput(); }
}
