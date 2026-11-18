const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

const code = ts.transpileModule(fs.readFileSync(`${__dirname}/../src/lib/account-license.ts`, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;
const exported = {};
vm.runInNewContext(code, { exports: exported });
const { withAccountLicense, featureChanges } = exported;
const now = Date.parse('2026-11-17T05:00:00Z');
const day = 86400000;
const account = { key: 'fb_account', days: 999, enabled: false };
const paid = (key, days) => ({ key, days, enabled: true });
const saved = { created_at: '2026-11-17T05:00:00Z', features: [] };

test('signup gets thirty days and paid modules scale it to max plus thirty', () => {
  assert.equal(withAccountLicense([account], null, now)[0].days, 30);
  for (const [days, expected] of [[10, 40], [60, 90], [90, 120]]) {
    const result = withAccountLicense([account, paid('spam_group', days)], saved, now);
    assert.equal(result[0].days, expected);
    assert.equal(result[0].enabled, true);
  }
  assert.equal(withAccountLicense([account, paid('spam_group', 60), paid('create_fanpage', 90)], saved, now)[0].days, 120);
});

test('unchanged saved dates keep counting down including the final grace period', () => {
  const user = { ...saved, features: [{ key: 'spam_group', is_enabled: true, days_remaining: 0, expired_at: new Date(now + 90 * day).toISOString() }] };
  assert.equal(withAccountLicense([account, paid('spam_group', 0)], user, now + 90 * day)[0].days, 30);
  assert.equal(withAccountLicense([account, paid('spam_group', 0)], user, now + 100 * day)[0].days, 20);
  assert.equal(withAccountLicense([account, paid('spam_group', 0)], user, now + 121 * day)[0].days, 0);
  assert.equal(withAccountLicense([account], saved, now + 31 * day)[0].days, 0);
});

test('editing or deselecting a module updates the preview and managed days cannot be overridden', () => {
  const user = { ...saved, features: [{ key: 'spam_group', is_enabled: true, days_remaining: 90, expired_at: new Date(now + 90 * day).toISOString() }] };
  assert.equal(withAccountLicense([account, paid('spam_group', 20)], user, now)[0].days, 50);
  assert.equal(withAccountLicense([account, { ...paid('spam_group', 90), enabled: false }], user, now)[0].days, 30);
});

test('save payload excludes the managed module and unchanged paid licenses', () => {
  const user = { ...saved, features: [{ key: 'spam_group', is_enabled: true, days_remaining: 60 }] };
  assert.equal(featureChanges([account, paid('spam_group', 60)], user).length, 0);
  const changed = featureChanges([account, paid('spam_group', 90)], user);
  assert.equal(changed.length, 1);
  assert.equal(changed[0].key, 'spam_group');
  assert.equal(changed[0].days, 90);
  assert.equal(featureChanges([account], null).length, 0);
});

test('legacy UTC registration timestamps without Z give the same remaining trial days', () => {
  const dayLater = now + day - 1000;
  const legacy = { ...saved, created_at: '2026-11-17 05:00:00' };
  assert.equal(withAccountLicense([account], legacy, dayLater)[0].days, withAccountLicense([account], saved, dayLater)[0].days);
});

test('cancelling the last subscription previews thirty grace days without resetting expired history', () => {
  const user = { ...saved, features: [{ key: 'spam_group', is_enabled: true, days_remaining: 45, days_granted: 90,
    expired_at: new Date(now + 90 * day).toISOString() }] };
  const disabled = { key: 'spam_group', enabled: false, days: 0 };
  assert.equal(withAccountLicense([account, disabled], user, now + 45 * day)[0].days, 30);
  user.features[0] = { ...user.features[0], is_enabled: false, days_remaining: 0, expired_at: new Date(now + 45 * day).toISOString() };
  assert.equal(withAccountLicense([account, disabled], user, now + 55 * day)[0].days, 20);
});
