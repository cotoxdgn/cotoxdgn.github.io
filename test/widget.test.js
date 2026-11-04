// gas/Code.gs のウィジェット用（widget / viewKey・見るだけ用の合言葉 B6）の単体テスト（test/gas-mock.js を使う）
// 実行：node test/widget.test.js
// 生理の予定日は routine/period.js と同じ答えになるかを、routine/test/period.test.js と同じ場面で比べる。
'use strict';
process.env.TZ = 'Asia/Tokyo';
const assert = require('assert');
const makeGas = require('./gas-mock');
const P = require('../routine/period.js');

let passed = 0;
function t(name, fn) { fn(); passed++; console.log('ok -', name); }

// 新しいスプシ（モック）を用意して、合言葉を返す
function fresh() {
  const g = makeGas();
  g.ctx.setup();
  const conf = g.ss.getSheetByName('設定');
  const call = req => JSON.parse(g.ctx.doPost({ postData: { contents: JSON.stringify(req) } }).text);
  const key = String(conf.getRange('B1').getValue());
  // 日本時間の日時に時計を合わせる
  const at = iso => { g.clockBox.t = Date.parse(iso); };
  let seq = 0;
  const put = (id, data) => { g.clockBox.t += 1000; seq++; const r = call({ key, action: 'put', app: 'routine', id, data }); assert.ok(r.ok, JSON.stringify(r)); };
  return { g, conf, call, key, at, put, view: () => String(conf.getRange('B6').getValue()), sleep: () => String(conf.getRange('B5').getValue()) };
}

// ---------- 見るだけ用の合言葉 ----------
const A = fresh();
const VKEY = A.view();

t('setup：B6 に見るだけ用の合言葉（A6 に見出し）。いつもの・睡眠用とは別。やり直しても変わらない', () => {
  assert.ok(VKEY.length >= 24, VKEY);
  assert.notStrictEqual(VKEY, A.key); assert.notStrictEqual(VKEY, A.sleep());
  assert.strictEqual(String(A.conf.getRange('A6').getValue()), '見るだけ用の合言葉（自動）');
  assert.ok(String(A.conf.getRange('A7').getValue()).startsWith('入力は不要です'), '説明文は A7 へ');
  A.g.ctx.setup();
  assert.strictEqual(A.view(), VKEY);
});

// データ（習慣・記録・生理・睡眠・コレクション・ほかのアプリ）を入れておく
A.at('2026-11-04T12:00:00+09:00');
A.put('h-a', { kind: 'habit', name: 'ストレッチ', time: '', color: 'sage', order: 20, since: '', archivedOn: '' });
A.put('h-b', { kind: 'habit', name: 'サプリを飲んだ', time: '', color: 'blue', order: 10, since: '', archivedOn: '' });
A.put('h-old', { kind: 'habit', name: 'やめた習慣', time: '', color: 'rose', order: 5, since: '', archivedOn: '2026-11-01' });
['2026-11-01', '2026-11-02', '2026-11-03'].forEach(d => {
  A.put('log-' + d.replace(/-/g, '') + '-h-a', { kind: 'log', date: d, habit: 'h-a', at: d + 'T10:00:00Z' });
  A.put('log-' + d.replace(/-/g, '') + '-h-b', { kind: 'log', date: d, habit: 'h-b', at: d + 'T10:00:00Z' });
});
A.put('log-20261104-h-b', { kind: 'log', date: '2026-11-04', habit: 'h-b', at: '2026-11-04T01:00:00Z' });
A.put('period-20260910', { kind: 'period', start: '2026-09-10', end: '2026-09-14', at: 'x' });
A.put('period-20261008', { kind: 'period', start: '2026-10-08', end: '2026-10-12', at: 'x' });
A.put('sleep-20261104', { kind: 'sleep', date: '2026-11-04', samples: [{ s: '2026-11-03T15:00:00.000Z', e: '2026-11-03T22:00:00.000Z', v: 'ひみつの睡眠' }], receivedAt: 'x' });
A.put('item-1', { kind: 'item', type: 'ctype-food', date: '2026-11-03', name: 'ひみつの料理', memo: 'ひみつのメモ', image: null, at: 'x' });
A.put('ctype-x', { kind: 'ctype', name: 'ひみつの種類', icon: 'dot', color: 'blue', order: 20, archivedOn: '' });
assert.ok(A.call({ key: A.key, action: 'put', app: 'diary', id: 'd1', data: { text: 'ひみつの日記' } }).ok);

t('widget：見るだけ用の合言葉で、今日の習慣（並び順・やめた習慣は除く）・連続日数・生理だけ', () => {
  A.at('2026-11-04T12:00:00+09:00');
  const r = A.call({ key: VKEY, action: 'widget' });
  assert.ok(r.ok, JSON.stringify(r));
  assert.strictEqual(r.today, '2026-11-04');
  assert.deepStrictEqual(r.habits, [{ name: 'サプリを飲んだ', done: true }, { name: 'ストレッチ', done: false }]);
  assert.strictEqual(r.streak, 3, '今日はまだなので昨日から数える（11/1〜11/3）');
  assert.deepStrictEqual(r.period, { ongoing: false, start: '', day: 0, next: '2026-11-05', until: 1, late: 0 });
  assert.deepStrictEqual(Object.keys(r).sort(), ['habits', 'now', 'ok', 'period', 'streak', 'today']);
});

t('widget：ほかのデータ（睡眠・コレクション・メモ・ほかのアプリ・id）は入れない', () => {
  const s = JSON.stringify(A.call({ key: VKEY, action: 'widget' }));
  ['ひみつ', 'sleep', 'item', 'ctype', 'diary', 'h-a', 'h-b', 'log-', 'period-', 'samples', 'memo', 'records'].forEach(w => assert.ok(!s.includes(w), w));
});

t('widget：スプシには何も書かない', () => {
  const before = JSON.stringify(A.g.ss.getSheets().map(x => [x.getName(), x.cells]));
  A.call({ key: VKEY, action: 'widget' });
  A.call({ key: A.key, action: 'widget' });
  assert.strictEqual(JSON.stringify(A.g.ss.getSheets().map(x => [x.getName(), x.cells])), before);
});

t('widget：全部できたら今日から数える。深夜3時までは前の日', () => {
  A.put('log-20261104-h-a', { kind: 'log', date: '2026-11-04', habit: 'h-a', at: 'x' });
  A.at('2026-11-04T23:00:00+09:00');
  let r = A.call({ key: VKEY, action: 'widget' });
  assert.strictEqual(r.streak, 4); assert.ok(r.habits.every(h => h.done));
  A.at('2026-11-05T02:59:00+09:00');
  r = A.call({ key: VKEY, action: 'widget' });
  assert.strictEqual(r.today, '2026-11-04', '2:59 はまだ前の日'); assert.strictEqual(r.streak, 4);
  A.at('2026-11-05T03:00:00+09:00');
  r = A.call({ key: VKEY, action: 'widget' });
  assert.strictEqual(r.today, '2026-11-05'); assert.ok(r.habits.every(h => !h.done)); assert.strictEqual(r.streak, 4, '今日はまだ＝昨日まで');
  assert.strictEqual(r.period.until, 0, '予定日が今日');
  // 記録を取り消す（削除）と数えない
  A.at('2026-11-05T12:00:00+09:00');
  assert.ok(A.call({ key: A.key, action: 'delete', app: 'routine', id: 'log-20261104-h-a' }).ok);
  r = A.call({ key: VKEY, action: 'widget' });
  assert.strictEqual(r.streak, 0);
});

t('見るだけ用の合言葉では widget 以外はすべて断る（合言葉違いと同じ答え）', () => {
  for (const action of ['ping', 'list', 'put', 'delete', 'batch', 'image', 'imageData', 'imageDelete', 'names', 'geocode', 'mapLink',
    'yoteiCal', 'yoteiResults', 'yoteiCreateEvent', 'calMonth', 'sleepPut', 'sleepKey', 'viewKey', 'zzz', undefined]) {
    const r = A.call({ key: VKEY, action, app: 'routine', id: 'x', data: {}, ops: [], renew: true, q: '大阪', from: '2026-11-01', to: '2026-11-02',
      samples: [{ s: '2026-11-01T00:00:00+09:00', e: '2026-11-01T06:00:00+09:00', v: 'コア' }] });
    assert.deepStrictEqual(r, { ok: false, error: 'bad_key' }, String(action));
  }
  assert.strictEqual(A.view(), VKEY, 'viewKey の作り直しもできない');
});

t('睡眠用の合言葉・合言葉違いでは widget は呼べない。いつもの合言葉ではそのまま使える', () => {
  assert.deepStrictEqual(A.call({ key: A.sleep(), action: 'widget' }), { ok: false, error: 'bad_key' });
  assert.deepStrictEqual(A.call({ key: 'wrong', action: 'widget' }), { ok: false, error: 'bad_key' });
  assert.deepStrictEqual(A.call({ key: '', action: 'widget' }), { ok: false, error: 'bad_key' });
  assert.ok(A.call({ key: A.key, action: 'widget' }).ok);
  assert.ok(A.call({ key: A.key, action: 'ping' }).ok);
  assert.ok(A.call({ key: A.key, action: 'list', app: 'routine' }).ok);
  assert.ok(A.call({ key: A.sleep(), action: 'sleepPut', samples: [{ s: '2026-11-05T00:00:00+09:00', e: '2026-11-05T06:00:00+09:00', v: 'コア' }] }).ok);
});

t('viewKey：いつもの合言葉からだけ。表示と作り直し（古い見るだけ用の合言葉は使えなくなる）', () => {
  assert.strictEqual(A.call({ key: 'wrong', action: 'viewKey' }).error, 'bad_key');
  assert.strictEqual(A.call({ key: A.sleep(), action: 'viewKey' }).error, 'bad_key');
  const r = A.call({ key: A.key, action: 'viewKey' });
  assert.ok(r.ok); assert.strictEqual(r.viewKey, VKEY);
  const n = A.call({ key: A.key, action: 'viewKey', renew: true });
  assert.ok(n.ok); assert.notStrictEqual(n.viewKey, VKEY); assert.notStrictEqual(n.viewKey, A.key); assert.notStrictEqual(n.viewKey, A.sleep());
  assert.strictEqual(A.view(), n.viewKey);
  assert.strictEqual(A.call({ key: VKEY, action: 'widget' }).error, 'bad_key');
  assert.ok(A.call({ key: n.viewKey, action: 'widget' }).ok);
  assert.ok(A.call({ key: A.key, action: 'ping' }).ok, 'いつもの合言葉はそのまま');
});

t('B6 が空のまま（コードを貼り替えただけ）でも viewKey で作られる。空の間は見るだけ用の合言葉では何もできない', () => {
  A.conf.getRange('B6').setValue('');
  assert.strictEqual(A.call({ key: '', action: 'widget' }).error, 'bad_key');
  const r = A.call({ key: A.key, action: 'viewKey' });
  assert.ok(r.ok && r.viewKey.length >= 24);
  assert.strictEqual(A.view(), r.viewKey);
});

t('B5 と B6 が同じ値（手で書いた等）なら、どちらの合言葉としても widget は呼べない', () => {
  A.conf.getRange('B6').setValue(A.sleep());
  assert.strictEqual(A.call({ key: A.sleep(), action: 'widget' }).error, 'bad_key');
  assert.ok(A.call({ key: A.key, action: 'viewKey' }).viewKey !== A.sleep(), 'viewKey で別の値に作り直す');
});

t('習慣が1つも無いときは初期の2つ（アプリと同じ）。記録が無ければ生理は null', () => {
  const B = fresh();
  B.at('2026-11-04T12:00:00+09:00');
  const r = B.call({ key: B.view(), action: 'widget' });
  assert.ok(r.ok, JSON.stringify(r));
  assert.deepStrictEqual(r.habits, [{ name: 'サプリを飲んだ', done: false }, { name: '22:30お風呂', done: false }]);
  assert.strictEqual(r.streak, 0); assert.strictEqual(r.period, null);
});

t('連続日数：始めた日より前・やめた日から後の習慣は、その日の「全部」に入れない（アプリと同じ）', () => {
  const B = fresh();
  B.at('2026-11-04T12:00:00+09:00');
  B.put('h-a', { kind: 'habit', name: 'A', order: 10, since: '', archivedOn: '' });
  B.put('h-n', { kind: 'habit', name: '新しい', order: 20, since: '2026-11-03', archivedOn: '' });
  B.put('h-x', { kind: 'habit', name: 'やめた', order: 30, since: '', archivedOn: '2026-11-02' });
  ['2026-10-31', '2026-11-01', '2026-11-02', '2026-11-03'].forEach(d => B.put('log-' + d.replace(/-/g, '') + '-h-a', { kind: 'log', date: d, habit: 'h-a' }));
  ['2026-10-31', '2026-11-01'].forEach(d => B.put('log-' + d.replace(/-/g, '') + '-h-x', { kind: 'log', date: d, habit: 'h-x' }));
  B.put('log-20261103-h-n', { kind: 'log', date: '2026-11-03', habit: 'h-n' });
  const r = B.call({ key: B.view(), action: 'widget' });
  assert.strictEqual(r.streak, 4);
  assert.deepStrictEqual(r.habits.map(h => h.name), ['A', '新しい']);
});

// ---------- 生理：routine/period.js と同じ答えか（period.test.js と同じ場面） ----------
const rec = (s, e) => ({ id: P.idOf(s), data: { kind: 'period', start: s, end: e || '', at: '2026-01-01T00:00:00Z' } });
function expectFromApp(rows, today) {
  const pc = P.calc(P.build(rows), today);
  if (!pc.list.length) return null;
  return { ongoing: pc.ongoing, start: pc.ongoing ? pc.last.s : '', day: pc.ongoing ? P.diff(pc.last.s, today) + 1 : 0,
    next: pc.next, until: pc.next ? P.diff(today, pc.next) : null, late: pc.next && pc.late > 0 ? pc.late : 0 };
}
function viaGas(rows, today) {
  const B = fresh();
  B.at(today + 'T12:00:00+09:00');
  rows.forEach(r => B.put(r.id, r.data));
  B.at(today + 'T12:00:00+09:00');
  const res = B.call({ key: B.view(), action: 'widget' });
  assert.ok(res.ok, JSON.stringify(res));
  return res.period;
}
const starts = ['2026-01-01'];
[40, 40, 28, 28, 28, 28, 28, 28].forEach(c => starts.push(P.addDays(starts[starts.length - 1], c)));
const CASES = [
  ['記録0回', [], '2026-11-03'],
  ['記録1回（仮の28日）', [rec('2026-10-08', '2026-10-13')], '2026-11-03'],
  ['記録2回以上（四捨五入・記録中）', [rec('2026-08-11', '2026-08-15'), rec('2026-09-09', '2026-09-14'), rec('2026-10-07')], '2026-10-08'],
  ['周期 30・31・30', [rec('2026-07-01', '2026-07-05'), rec('2026-07-31', '2026-08-04'), rec('2026-08-31', '2026-09-04'), rec('2026-09-30', '2026-10-04')], '2026-10-10'],
  ['短い・長い周期は入れない', [rec('2026-01-01', '2026-01-05'), rec('2026-03-15', '2026-03-19'), rec('2026-04-12', '2026-04-16'), rec('2026-04-20', '2026-04-22'), rec('2026-05-19', '2026-05-23')], '2026-05-30'],
  ['境目の15日・60日', [rec('2026-01-01', '2026-01-03'), rec('2026-01-16', '2026-01-18'), rec('2026-03-17', '2026-03-19')], '2026-03-20'],
  ['平均に入れる周期がない', [rec('2026-01-01', '2026-01-03'), rec('2026-01-05', '2026-01-07')], '2026-01-10'],
  ['直近6回まで', starts.map(s => rec(s, P.addDays(s, 4))), P.addDays(starts[starts.length - 1], 5)],
  ['予定日から3日', [rec('2026-09-10', '2026-09-14'), rec('2026-10-08', '2026-10-12')], '2026-11-08'],
  ['予定日から14日', [rec('2026-09-10', '2026-09-14'), rec('2026-10-08', '2026-10-12')], '2026-11-19'],
  ['予定日から15日（消す）', [rec('2026-09-10', '2026-09-14'), rec('2026-10-08', '2026-10-12')], '2026-11-20'],
  ['始まったら次の回', [rec('2026-09-10', '2026-09-14'), rec('2026-10-08', '2026-10-12'), rec('2026-11-04')], '2026-11-06'],
  ['記録中10日目', [rec('2026-09-10', '2026-09-14'), rec('2026-10-08', '2026-10-13'), rec('2026-10-25')], '2026-11-03'],
  ['押し忘れ（10日たった）', [rec('2026-09-10', '2026-09-14'), rec('2026-10-08', '2026-10-13'), rec('2026-10-25')], '2026-11-04'],
  ['月またぎ・うるう年なし', [rec('2026-12-20', '2026-12-24'), rec('2027-01-18', '2027-01-22')], '2027-02-10'],
  ['先の日付の記録（まだ始まっていない）', [rec('2026-10-08', '2026-10-12'), rec('2026-11-10')], '2026-11-06']
];
t('生理：routine/period.js と同じ答え（' + CASES.length + ' 場面）', () => {
  CASES.forEach(([name, rows, today]) => assert.deepStrictEqual(viaGas(rows, today), expectFromApp(rows, today), name));
});
t('生理：答えの中身（あと○日・○日目）', () => {
  assert.deepStrictEqual(viaGas(CASES[1][1], '2026-11-03'), { ongoing: false, start: '', day: 0, next: '2026-11-05', until: 2, late: 0 });
  assert.deepStrictEqual(viaGas(CASES[2][1], '2026-10-08'), { ongoing: true, start: '2026-10-07', day: 2, next: '2026-11-05', until: 28, late: 0 });
  assert.deepStrictEqual(viaGas(CASES[8][1], '2026-11-08'), { ongoing: false, start: '', day: 0, next: '2026-11-05', until: -3, late: 3 });
  assert.strictEqual(viaGas(CASES[10][1], '2026-11-20').next, null);
  assert.strictEqual(viaGas(CASES[12][1], '2026-11-03').day, 10);
});

console.log(`\n${passed} 件 すべて成功`);
