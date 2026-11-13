const { test } = require('node:test');
const assert = require('node:assert/strict');
const { validateDevice, backupDiff, csvSafe, reportMoves } = require('../core.js');
test('serials and issued state are validated', () => {
  assert.throws(() => validateDevice({ serial: '<img>', status: 'free' }));
  assert.throws(() => validateDevice({ serial: 'TEST-1', status: 'issued', holder: '' }));
  assert.throws(() => validateDevice({ serial: 'TEST-1', status: 'issued', holder: 'A', issued_at: 'yesterday' }));
  assert.equal(validateDevice({ serial: 'TEST-1', status: 'free' }).serial, 'TEST-1');
});
test('backup comparison identifies active issues that will change', () => {
  assert.deepEqual(backupDiff([{serial:'T1',status:'issued',holder:'A'}], [{serial:'T1',status:'free'},{serial:'T2',status:'repair'}]), { added:1, changed:1, activeIssues:1 });
});
test('CSV neutralizes spreadsheet formulas and escapes quotes', () => {
  assert.equal(csvSafe('  =1+1'), '"\'  =1+1"');
  assert.equal(csvSafe('A"B'), '"A""B"');
  assert.equal(csvSafe('123456789012345'), '"123456789012345"');
});
test('period report uses an exclusive end and limits query size', () => {
  const rows=[{created_at:'2026-11-13T06:00:00Z'},{created_at:'2026-11-13T18:00:00Z'}];
  assert.equal(reportMoves(rows,'2026-11-13T06:00:00Z','2026-11-13T18:00:00Z').length,1);
  assert.throws(()=>reportMoves([], '2026-01-01', '2026-03-01'));
});
