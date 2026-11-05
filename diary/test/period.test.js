// routine/period.js（生理の記録・次の予定日の決め方）の単体テスト
// 実行：node diary/test/period.test.js
'use strict';
process.env.TZ = 'Asia/Tokyo';
const assert = require('assert');
const P = require('../period.js');

let passed = 0;
function t(name, fn) { fn(); passed++; console.log('ok -', name); }
const rec = (s, e) => ({ id: P.idOf(s), data: { kind: 'period', start: s, end: e || '', at: '2026-01-01T00:00:00Z' } });
const calc = (rows, today) => P.calc(P.build(rows), today);

t('build：period の行だけ、始まった日の古い順。ほかの kind・形の違う行は読み飛ばす', () => {
  const b = P.build([rec('2026-10-08', '2026-10-12'), rec('2026-09-09', '2026-09-13'),
    { id: 'log-20261001-h-a', data: { kind: 'log', date: '2026-10-01', habit: 'h-a' } },
    { id: 'period-x', data: { kind: 'period', start: 'x' } }, { id: 'y', data: null },
    { id: 'period-20260801', data: { kind: 'period', start: '2026-08-01', end: '2026-07-01' } }]);
  assert.deepStrictEqual(b.map(r => [r.s, r.e]), [['2026-08-01', ''], ['2026-09-09', '2026-09-13'], ['2026-10-08', '2026-10-12']]);
  assert.strictEqual(P.idOf('2026-10-08'), 'period-20261008');
});

t('記録0回：予測を出さない', () => {
  const pc = calc([], '2026-11-03');
  assert.strictEqual(pc.next, null); assert.strictEqual(pc.cycle, null); assert.strictEqual(pc.ongoing, false);
  assert.strictEqual(pc.len, 5);
  assert.strictEqual(P.predicted('2026-11-05', pc), false);
});

t('記録1回：仮に28日周期。うすく塗るのはその回の日数', () => {
  const pc = calc([rec('2026-10-08', '2026-10-13')], '2026-11-03');
  assert.strictEqual(pc.cycle, 28); assert.strictEqual(pc.temp, true);
  assert.strictEqual(pc.basis, '仮（28日で計算）');
  assert.strictEqual(pc.next, '2026-11-05');
  assert.strictEqual(pc.len, 6);
  assert.ok(P.predicted('2026-11-05', pc) && P.predicted('2026-11-10', pc));
  assert.ok(!P.predicted('2026-11-11', pc) && !P.predicted('2026-11-04', pc));
});

t('記録2回以上：直近の周期の平均（四捨五入）。日数の平均も四捨五入', () => {
  // 周期 29・28 → 28.5 → 29。日数 5・6 → 5.5 → 6
  const pc = calc([rec('2026-08-11', '2026-08-15'), rec('2026-09-09', '2026-09-14'), rec('2026-10-07')], '2026-10-08');
  assert.deepStrictEqual(pc.recent, [29, 28]);
  assert.strictEqual(pc.cycle, 29); assert.strictEqual(pc.basis, '直近2回の平均');
  assert.strictEqual(pc.len, 6);
  assert.strictEqual(pc.next, '2026-11-05', '記録中でも予測は次の回');
  // 周期 30・31・30 → 30.33 → 30
  const q = calc([rec('2026-07-01', '2026-07-05'), rec('2026-07-31', '2026-08-04'), rec('2026-08-31', '2026-09-04'), rec('2026-09-30', '2026-10-04')], '2026-10-10');
  assert.strictEqual(q.cycle, 30); assert.strictEqual(q.next, '2026-10-30');
});

t('15日より短い・60日より長い周期は平均に入れない（一覧には残す）。境目の15日・60日は入れる', () => {
  const pc = calc([rec('2026-01-01', '2026-01-05'), rec('2026-03-15', '2026-03-19'), rec('2026-04-12', '2026-04-16'), rec('2026-04-20', '2026-04-22'), rec('2026-05-19', '2026-05-23')], '2026-05-30');
  assert.deepStrictEqual(pc.cycles.map(c => [c.days, c.used]), [[73, false], [28, true], [8, false], [29, true]]);
  assert.deepStrictEqual(pc.recent, [28, 29]);
  assert.strictEqual(pc.cycle, 29);
  const edge = calc([rec('2026-01-01', '2026-01-03'), rec('2026-01-16', '2026-01-18'), rec('2026-03-17', '2026-03-19')], '2026-03-20');
  assert.deepStrictEqual(edge.cycles.map(c => [c.days, c.used]), [[15, true], [60, true]]);
  const none = calc([rec('2026-01-01', '2026-01-03'), rec('2026-01-05', '2026-01-07')], '2026-01-10');
  assert.strictEqual(none.recent.length, 0); assert.strictEqual(none.cycle, 28, '平均に入れる周期がなければ仮の28日');
  assert.strictEqual(none.temp, true);
});

t('平均は直近6回まで', () => {
  // 周期：40,40,28,28,28,28,28,28 → 直近6回は全部 28
  const starts = ['2026-01-01'];
  [40, 40, 28, 28, 28, 28, 28, 28].forEach(c => starts.push(P.addDays(starts[starts.length - 1], c)));
  const pc = calc(starts.map(s => rec(s, P.addDays(s, 4))), P.addDays(starts[starts.length - 1], 5));
  assert.strictEqual(pc.recent.length, 6);
  assert.strictEqual(pc.cycle, 28);
  assert.strictEqual(pc.basis, '直近6回の平均');
});

t('予定日を過ぎても始まっていない：予測は残し「予定日から○日」。14日を過ぎたら消す', () => {
  const rows = [rec('2026-09-10', '2026-09-14'), rec('2026-10-08', '2026-10-12')];   // 周期 28 → 11/5
  let pc = calc(rows, '2026-11-08');
  assert.strictEqual(pc.next, '2026-11-05'); assert.strictEqual(pc.late, 3);
  assert.ok(P.predicted('2026-11-05', pc));
  pc = calc(rows, '2026-11-19');
  assert.strictEqual(pc.next, '2026-11-05'); assert.strictEqual(pc.late, 14);
  pc = calc(rows, '2026-11-20');
  assert.strictEqual(pc.next, null);
  assert.ok(!P.predicted('2026-11-05', pc));
});

t('始まったら記録が優先され、予測は次の回に移る', () => {
  const rows = [rec('2026-09-10', '2026-09-14'), rec('2026-10-08', '2026-10-12'), rec('2026-11-04')];
  const pc = calc(rows, '2026-11-06');
  assert.ok(pc.ongoing);
  assert.deepStrictEqual(P.dayOf('2026-11-05', pc).n, 2);
  assert.ok(!P.predicted('2026-11-05', pc), '記録した日は予測にしない');
  assert.strictEqual(pc.next, '2026-12-02');   // 周期 28・27 → 27.5 → 28
  assert.strictEqual(P.dayOf('2026-11-07', pc), null, '記録中は今日まで塗る');
});

t('記録中のまま10日たったら押し忘れ。カレンダーは平均の日数までを塗る', () => {
  const rows = [rec('2026-09-10', '2026-09-14'), rec('2026-10-08', '2026-10-13'), rec('2026-10-25')];   // 日数 5・6 → 6
  let pc = calc(rows, '2026-11-03');   // 10日目（9日経過）
  assert.ok(pc.ongoing); assert.ok(!pc.forgot);
  assert.strictEqual(P.dayOf('2026-11-03', pc).n, 10);
  pc = calc(rows, '2026-11-04');       // 10日たった
  assert.ok(pc.forgot);
  assert.strictEqual(P.endOf(pc.last, pc), '2026-10-30');
  assert.ok(P.dayOf('2026-10-30', pc)); assert.strictEqual(P.dayOf('2026-10-31', pc), null);
});

t('終わった日がある回だけで日数の平均。なければ5日', () => {
  assert.strictEqual(calc([rec('2026-10-25')], '2026-10-26').len, 5);
  assert.strictEqual(calc([rec('2026-09-25', '2026-10-01'), rec('2026-10-25')], '2026-10-26').len, 7);
  const pc = calc([rec('2026-09-25', '2026-10-01'), rec('2026-10-25')], '2026-10-26');
  assert.strictEqual(P.dayOf('2026-10-01', pc).n, 7);
  assert.strictEqual(P.dayOf('2026-10-02', pc), null);
});

console.log(`\n${passed} 件 すべて成功`);
