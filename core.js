/* Pure domain helpers shared by the browser and regression tests. */
(function (root) {
  const serialPattern = /^(?:SN;)?[A-Z0-9_.-]{2,60}$/;
  function validateDevice(d) {
    if (!d || !serialPattern.test(d.serial) || !['free', 'issued', 'repair'].includes(d.status)) throw new Error('Некорректное состояние сканера');
    if (String(d.holder || '').length > 200 || String(d.defect || '').length > 2000) throw new Error('Слишком длинное описание');
    if (d.status === 'issued' && (!String(d.holder || '').trim() || !Number.isFinite(Date.parse(d.issued_at)))) throw new Error('Не указан сотрудник или время выдачи');
    return d;
  }
  function assertSingleActiveIssue(devices, changes) {
    const holder = d => String(d.holder || '').trim().toUpperCase();
    const recipients = new Set(changes.filter(c => c.after?.status === 'issued').map(c => holder(c.after)));
    const final = new Map(devices.map(d => [d.serial, d]));
    for (const c of changes) {
      if (c.after) final.set(c.serial, c.after); else final.delete(c.serial);
    }
    const assigned = new Map();
    for (const d of final.values()) {
      if (d.deleted_at || d.status !== 'issued' || !recipients.has(holder(d))) continue;
      const key = holder(d);
      if (assigned.has(key)) throw new Error(`У сотрудника ${d.holder} уже есть активная выдача (${assigned.get(key)}). Подтвердите замену на свободный сканер.`);
      assigned.set(key, d.serial);
    }
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
  const api = { validateDevice, assertSingleActiveIssue, backupDiff, reportMoves, csvSafe };
  if (typeof module !== 'undefined') module.exports = api;
  root.SkladCore = api;
})(globalThis);
