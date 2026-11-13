function exportExcel() {
  const end = new Date(), start = new Date();
  start.setHours(start.getHours() < 6 ? -6 : start.getHours() < 18 ? 6 : 18, 0, 0, 0);
  const local = d => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  $('reportStart').value = local(start); $('reportEnd').value = local(end);
  $('reportError').textContent = '';
  openModal('reportModal');
}
async function exportPeriodReport() {
  const btn = $('btnReportExport'); btn.disabled = true;
  try {
    requireAccess();
    const start = new Date($('reportStart').value).toISOString(), end = new Date($('reportEnd').value).toISOString();
    SkladCore.reportMoves([], start, end);
    const rows = [];
    let after = 0;
    while (true) {
      const { data, error } = await withTimeout(cloud.from('movements').select('id,created_at,serial,action,worker,operator_id,terminal_id').gte('occurred_at', start).lt('occurred_at', end).gt('id', after).order('id').limit(1000), NET_TIMEOUT_MS, 'отчёт');
      if (error) throw error;
      rows.push(...data);
      if (data.length < 1000) break;
      after = data[data.length - 1].id;
    }
    const columns = ['created_at', 'serial', 'action', 'worker', 'operator_id', 'terminal_id'];
    const csv = '\uFEFFДата;Сканер;Операция;Сотрудник;Оператор;Терминал\n' + rows.map(m => columns.map(k => SkladCore.csvSafe(m[k])).join(';')).join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const a = document.createElement('a'); a.href = url; a.download = `sklad-operations-${start.slice(0, 10)}.csv`; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    $('reportError').textContent = `Выгружено операций: ${rows.length}. Неотправленные локальные операции в отчёт не входят.`;
  } catch (e) { $('reportError').textContent = e.message; } finally { btn.disabled = false; }
}
