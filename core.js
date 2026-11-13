/* Pure domain helpers shared by the browser and regression tests. */
(function (root) {
  const serialPattern = /^(?:SN;)?[A-Z0-9_.-]{2,60}$/;
  function validateDevice(d) {
    if (!d || !serialPattern.test(d.serial) || !['free', 'issued', 'repair'].includes(d.status)) throw new Error('Некорректное состояние сканера');
    if (String(d.holder || '').length > 200 || String(d.defect || '').length > 2000) throw new Error('Слишком длинное описание');
    if (d.status === 'issued' && (!String(d.holder || '').trim() || !Number.isFinite(Date.parse(d.issued_at)))) throw new Error('Не указан сотрудник или время выдачи');
    return d;
  }
  function backupDiff(current, incoming) {
    const local = new Map(current.map(d => [d.serial, d]));
    const fields = ['status', 'holder', 'shift', 'issued_at', 'model', 'defect'];
    return incoming.reduce((out, d) => {
      const before = local.get(d.serial);
      if (!before) out.added++;
      else if (fields.some(k => (before[k] || '') !== (d[k] || ''))) {
        out.changed++;
        if (before.status === 'issued') out.activeIssues++;
      }
      return out;
    }, { added: 0, changed: 0, activeIssues: 0 });
  }
  function reportMoves(moves, start, end) {
    const lo = Date.parse(start), hi = Date.parse(end);
    if (!Number.isFinite(lo) || !Number.isFinite(hi) || lo >= hi || hi - lo > 31 * 86400000) throw new Error('Укажите период до 31 суток');
    return moves.filter(m => { const t = Date.parse(m.created_at); return t >= lo && t < hi; });
  }
  function csvSafe(value) {
    let s = String(value ?? '');
    if (/^[\s]*[=+\-@]/.test(s) || /^[\t\r\n]/.test(s)) s = "'" + s;
    return '"' + s.replace(/"/g, '""') + '"';
  }
  const api = { validateDevice, backupDiff, reportMoves, csvSafe };
  if (typeof module !== 'undefined') module.exports = api;
  root.SkladCore = api;
})(globalThis);
