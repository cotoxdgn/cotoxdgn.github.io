// gas/Code.gs の calMonth（ルーティンの月カレンダー）の単体テスト
// 実行：node test/calmonth.test.js
'use strict';
const assert = require('assert');
const { ctx, ss, clockBox, cal } = require('./gas-mock')();

const call = req => JSON.parse(ctx.doPost({ postData: { contents: JSON.stringify(req) } }).text);
let passed = 0;
function t(name, fn) { fn(); passed++; console.log('ok -', name); }

ctx.setup();
const conf = ss.getSheetByName('設定');
const KEY = String(conf.getRange('B1').getValue());
const at = (d, hm) => Date.parse(`2026-${d}T${hm}:00+09:00`);

cal.events.push({ s: at('11-03', '10:00'), e: at('11-03', '12:00'), title: '現場 立会い', color: '2', location: '大阪市北区', description: '秘密のメモ' });
cal.events.push({ s: at('11-21', '00:00'), e: at('11-24', '00:00'), title: '旅行（金沢）', allDay: true, color: '5' });
cal.events.push({ s: at('11-05', '14:00'), e: at('11-05', '15:00'), title: '欠席した会', status: 'NO', color: '11' });
cal.events.push({ s: at('11-11', '17:30'), e: at('11-11', '18:00'), title: '歯医者' });
cal.events.push({ s: at('12-20', '10:00'), e: at('12-20', '11:00'), title: '期間外' });

t('calMonth：件名・開始・終了・終日・色だけ。欠席は除く。場所・メモは返さない', () => {
  const r = call({ key: KEY, action: 'calMonth', from: '2026-11-01', to: '2026-11-30' });
  assert.ok(r.ok, JSON.stringify(r));
  assert.deepStrictEqual(r.events, [
    { title: '現場 立会い', start: '2026-11-03T01:00:00.000Z', end: '2026-11-03T03:00:00.000Z', allDay: false, color: '2' },
    { title: '旅行（金沢）', start: '2026-11-21', end: '2026-11-24', allDay: true, color: '5' },
    { title: '歯医者', start: '2026-11-11T08:30:00.000Z', end: '2026-11-11T09:00:00.000Z', allDay: false, color: '' }
  ]);
  const s = JSON.stringify(r);
  assert.ok(!s.includes('大阪市') && !s.includes('秘密') && !s.includes('欠席'));
  r.events.forEach(e => assert.deepStrictEqual(Object.keys(e).sort(), ['allDay', 'color', 'end', 'start', 'title']));
});

t('calMonth：42日まで。形が違えば bad_request。スプシには何も書かない', () => {
  const before = JSON.stringify(ss.getSheets().map(x => [x.getName(), x.cells]));
  assert.ok(call({ key: KEY, action: 'calMonth', from: '2026-10-25', to: '2026-12-05' }).ok, '42日ちょうど');
  assert.strictEqual(call({ key: KEY, action: 'calMonth', from: '2026-10-25', to: '2026-12-06' }).error, 'too_long');
  assert.strictEqual(call({ key: KEY, action: 'calMonth', from: '2026-11-30', to: '2026-11-01' }).error, 'bad_request');
  assert.strictEqual(call({ key: KEY, action: 'calMonth', from: 'x', to: '2026-11-01' }).error, 'bad_request');
  assert.strictEqual(JSON.stringify(ss.getSheets().map(x => [x.getName(), x.cells])), before);
});

t('calMonth：カレンダーの許可がないときは calendar（理由つき）', () => {
  cal.fail = 'You do not have permission to call CalendarApp.getDefaultCalendar';
  const f = call({ key: KEY, action: 'calMonth', from: '2026-11-01', to: '2026-11-30' });
  assert.strictEqual(f.error, 'calendar'); assert.ok(/permission/.test(f.detail));
  cal.fail = '';
});

t('calMonth：合言葉なし・違う合言葉・睡眠用の合言葉では断る。相手用の窓口からは呼べない', () => {
  const n = cal.reads;
  assert.deepStrictEqual(call({ action: 'calMonth', from: '2026-11-01', to: '2026-11-30' }), { ok: false, error: 'bad_key' });
  assert.deepStrictEqual(call({ key: 'wrong', action: 'calMonth', from: '2026-11-01', to: '2026-11-30' }), { ok: false, error: 'bad_key' });
  clockBox.t += 1000;
  const SKEY = call({ key: KEY, action: 'sleepKey' }).sleepKey;
  assert.ok(SKEY && SKEY !== KEY);
  assert.deepStrictEqual(call({ key: SKEY, action: 'calMonth', from: '2026-11-01', to: '2026-11-30' }), { ok: false, error: 'bad_key' });
  // 相手用の窓口に calMonth の中身を混ぜても、予定合わせの答えとしてしか扱われない
  const g = call({ action: 'yoteiGet', token: 'x'.repeat(32), from: '2026-11-01', to: '2026-11-30' });
  assert.deepStrictEqual(g, { ok: false, error: 'not_found' });
  assert.strictEqual(cal.reads, n, 'カレンダーは読んでいない');
});

console.log(`\n${passed} 件 すべて成功`);
