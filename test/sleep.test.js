// gas/Code.gs の睡眠（sleepPut / sleepKey）の単体テスト（test/gas-mock.js を使う）
// 実行：node test/sleep.test.js
'use strict';
const assert = require('assert');
const { ctx, ss, clockBox } = require('./gas-mock')();

const call = req => JSON.parse(ctx.doPost({ postData: { contents: JSON.stringify(req) } }).text);
let passed = 0;
function t(name, fn) { fn(); passed++; console.log('ok -', name); }
const tick = () => { clockBox.t += 1000; };

ctx.setup();
const conf = ss.getSheetByName('設定');
const KEY = String(conf.getRange('B1').getValue());
let SKEY = String(conf.getRange('B5').getValue());
const rows = () => { const s = ss.getSheetByName('app=routine'); return s ? s.cells.slice(1).filter(r => r[0]) : []; };
const rec = id => { const r = rows().find(x => x[0] === id); return r ? JSON.parse(r[4]) : null; };
const night = [
  { s: '2026-10-31T23:58:00+09:00', e: '2026-11-01T03:10:00+09:00', v: 'コア' },
  { s: '2026-11-01T03:10:00+09:00', e: '2026-11-01T03:20:00+09:00', v: '覚醒' },
  { s: '2026-11-01T03:20:00+09:00', e: '2026-11-01T07:26:00+09:00', v: 'レム' }
];

t('setup：B5 に睡眠用の合言葉ができる（いつもの合言葉とは別。やり直しても変わらない）', () => {
  assert.ok(SKEY.length >= 24, SKEY);
  assert.notStrictEqual(SKEY, KEY);
  assert.strictEqual(String(conf.getRange('A5').getValue()), '睡眠用の合言葉（自動）');
  ctx.setup();
  assert.strictEqual(String(conf.getRange('B5').getValue()), SKEY);
});

t('sleepPut：睡眠用の合言葉で保存。id は起きた日（最後に終わった時刻の日・日本時間）', () => {
  tick();
  const r = call({ key: SKEY, action: 'sleepPut', samples: night });
  assert.ok(r.ok, JSON.stringify(r));
  assert.strictEqual(r.date, '2026-11-01');
  assert.strictEqual(r.id, 'sleep-20261101');
  assert.strictEqual(r.count, 3);
  const d = rec('sleep-20261101');
  assert.strictEqual(d.kind, 'sleep');
  assert.strictEqual(d.date, '2026-11-01');
  assert.strictEqual(d.samples.length, 3);
  assert.strictEqual(d.samples[0].s, '2026-10-31T14:58:00.000Z');
  assert.ok(d.receivedAt);
  // 返事に中身（記録）は入れない
  assert.ok(!JSON.stringify(r).includes('コア'));
});

t('sleepPut：同じ日に何回送っても1行（上書き）', () => {
  tick();
  const more = night.concat([{ s: '2026-11-01T07:30:00+09:00', e: '2026-11-01T07:40:00+09:00', v: 'コア' }]);
  assert.ok(call({ key: SKEY, action: 'sleepPut', samples: more }).ok);
  tick();
  assert.ok(call({ key: KEY, action: 'sleepPut', samples: more }).ok, 'いつもの合言葉でも送れる');
  assert.strictEqual(rows().filter(r => r[0] === 'sleep-20261101').length, 1);
  assert.strictEqual(rec('sleep-20261101').samples.length, 4);
});

t('sleepPut：s・e・v 以外は捨て、読めない時刻・逆転・長すぎる件も捨てる', () => {
  tick();
  const r = call({ key: SKEY, action: 'sleepPut', app: 'diary', id: 'hack', data: { x: 1 }, samples: [
    { s: '2026-10-30T23:00:00+09:00', e: '2026-10-31T06:50:00+09:00', v: '睡眠中', extra: 'xxx', key: 'k' },
    { s: 'きのう', e: '2026-10-31T06:00:00+09:00', v: 'コア' },
    { s: '2026-10-31T06:00:00+09:00', e: '2026-10-31T05:00:00+09:00', v: 'コア' },
    { s: '2026-10-29T00:00:00+09:00', e: '2026-10-31T06:00:00+09:00', v: 'コア' },
    { s: 1, e: 2, v: 'コア' },
    null, 'x',
    { s: '2026-10-31T06:50:00+09:00', e: '2026-10-31T07:00:00+09:00', v: '<b>' + 'あ'.repeat(40) }
  ] });
  assert.ok(r.ok, JSON.stringify(r));
  assert.strictEqual(r.id, 'sleep-20261031');
  const d = rec('sleep-20261031');
  assert.strictEqual(d.samples.length, 2);
  assert.deepStrictEqual(Object.keys(d.samples[0]).sort(), ['e', 's', 'v']);
  assert.strictEqual(d.samples[1].v.length, 20);
  assert.deepStrictEqual(Object.keys(d).sort(), ['date', 'kind', 'receivedAt', 'samples']);
  assert.strictEqual(ss.getSheetByName('app=diary'), null, 'app を指定しても routine 以外には書かない');
});

t('sleepPut：読める件が無ければ保存しない（前に届いた分を消さない）／ 300件まで', () => {
  const before = JSON.stringify(rows());
  assert.strictEqual(call({ key: SKEY, action: 'sleepPut', samples: [] }).error, 'no_samples');
  assert.strictEqual(call({ key: SKEY, action: 'sleepPut', samples: [{ s: 'x', e: 'y', v: 'コア' }] }).error, 'no_samples');
  assert.strictEqual(call({ key: SKEY, action: 'sleepPut' }).error, 'bad_request');
  assert.strictEqual(call({ key: SKEY, action: 'sleepPut', samples: 'abc' }).error, 'bad_request');
  const many = Array.from({ length: 301 }, (_, i) => ({ s: '2026-11-01T00:00:00+09:00', e: '2026-11-01T00:01:00+09:00', v: 'コア' + i }));
  assert.strictEqual(call({ key: SKEY, action: 'sleepPut', samples: many }).error, 'too_many');
  assert.strictEqual(JSON.stringify(rows()), before);
  tick();
  assert.ok(call({ key: SKEY, action: 'sleepPut', samples: many.slice(0, 300) }).ok);
});

t('睡眠用の合言葉では sleepPut 以外はすべて断る', () => {
  for (const action of ['ping', 'list', 'put', 'delete', 'batch', 'image', 'imageData', 'imageDelete', 'names', 'geocode', 'mapLink',
    'yoteiCal', 'yoteiResults', 'yoteiCreateEvent', 'sleepKey', 'zzz']) {
    const r = call({ key: SKEY, action, app: 'routine', id: 'x', data: {}, ops: [], renew: true, q: '大阪', from: '2026-11-01', to: '2026-11-02' });
    assert.deepStrictEqual(r, { ok: false, error: 'bad_key' }, action);
  }
  assert.strictEqual(String(conf.getRange('B5').getValue()), SKEY, 'sleepKey の作り直しもできない');
});

t('sleepKey：いつもの合言葉からだけ。表示と作り直し（古い睡眠用の合言葉は使えなくなる）', () => {
  assert.strictEqual(call({ key: 'wrong', action: 'sleepKey' }).error, 'bad_key');
  const r = call({ key: KEY, action: 'sleepKey' });
  assert.ok(r.ok); assert.strictEqual(r.sleepKey, SKEY);
  const n = call({ key: KEY, action: 'sleepKey', renew: true });
  assert.ok(n.ok); assert.notStrictEqual(n.sleepKey, SKEY); assert.notStrictEqual(n.sleepKey, KEY);
  assert.strictEqual(String(conf.getRange('B5').getValue()), n.sleepKey);
  assert.strictEqual(call({ key: SKEY, action: 'sleepPut', samples: night }).error, 'bad_key');
  SKEY = n.sleepKey;
  tick();
  assert.ok(call({ key: SKEY, action: 'sleepPut', samples: night }).ok);
  assert.ok(call({ key: KEY, action: 'ping' }).ok, 'いつもの合言葉はそのまま');
});

t('B5 が空のまま（コードを貼り替えただけ）でも sleepKey で作られる。空の間は睡眠用の合言葉では何もできない', () => {
  conf.getRange('B5').setValue('');
  assert.strictEqual(call({ key: '', action: 'sleepPut', samples: night }).error, 'bad_key');
  const r = call({ key: KEY, action: 'sleepKey' });
  assert.ok(r.ok && r.sleepKey.length >= 24);
  assert.strictEqual(String(conf.getRange('B5').getValue()), r.sleepKey);
});

t('アプリの list で sleep-YYYYMMDD が届く（手で直した値・目標はふつうの put）', () => {
  tick();
  assert.ok(call({ key: KEY, action: 'put', app: 'routine', id: 'sleepfix-20261101', data: { kind: 'sleepfix', date: '2026-11-01', bed: 1440, wake: 435 } }).ok);
  assert.ok(call({ key: KEY, action: 'put', app: 'routine', id: 'sleep-goal', data: { kind: 'sleepgoal', history: [] } }).ok);
  const ids = call({ key: KEY, action: 'list', app: 'routine' }).records.map(r => r.id);
  for (const id of ['sleep-20261101', 'sleep-20261031', 'sleepfix-20261101', 'sleep-goal']) assert.ok(ids.includes(id), id);
});

console.log(`\n${passed} 件 すべて成功`);
