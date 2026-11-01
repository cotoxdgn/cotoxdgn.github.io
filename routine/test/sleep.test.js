// routine/sleep.js（就寝・起床の決め方・目標の履歴）の単体テスト
// 実行：node routine/test/sleep.test.js
'use strict';
process.env.TZ = 'Asia/Tokyo';   // iPhone と同じ日本時間で計算する
const assert = require('assert');
const S = require('../sleep.js');

let passed = 0;
function t(name, fn) { fn(); passed++; console.log('ok -', name); }
const J = (d, hm) => `2026-${d}T${hm}:00+09:00`;
const x = (sd, sh, ed, eh, v) => ({ s: J(sd, sh), e: J(ed, eh), v: v || 'コア' });

t('その日の記録＝起きた日。前の夜に寝て朝起きた分', () => {
  const n = S.night([x('10-31', '23:58', '11-01', '07:26')], '2026-11-01');
  assert.strictEqual(S.bedClock(n.bed), '23:58');
  assert.strictEqual(S.clock(n.wake), '7:26');
  assert.strictEqual(n.bed, 23 * 60 + 58);
  assert.strictEqual(n.wake, 7 * 60 + 26);
  assert.strictEqual(n.len, 7 * 60 + 28);
  assert.strictEqual(S.night([x('10-31', '23:58', '11-01', '07:26')], '2026-10-31'), null, '前の日の分ではない');
});

t('見る範囲：前の日の15:00〜その日の15:00に始まった記録（14:59の昼寝は前の日の範囲）', () => {
  const s = [x('10-31', '14:59', '10-31', '16:30'), x('11-01', '00:30', '11-01', '06:00'), x('11-01', '15:00', '11-01', '18:00')];
  const n = S.night(s, '2026-11-01');
  assert.strictEqual(S.bedClock(n.bed), '0:30');
  assert.strictEqual(n.bed, 1440 + 30, '日付をまたいだ就寝は 24:30 として持つ');
  assert.strictEqual(S.clock(n.wake), '6:00');
});

t('覚醒は眠っていない時間。60分未満の中断はつなぐ、60分以上なら別の塊で、いちばん長い塊が夜の睡眠', () => {
  // 23:30〜2:00 寝る → 2:00〜2:50 覚醒（50分）→ 2:50〜7:00。つながって 23:30〜7:00
  let n = S.night([x('10-31', '23:30', '11-01', '07:00', '睡眠中'), x('11-01', '02:00', '11-01', '02:50', '覚醒')], '2026-11-01');
  assert.strictEqual(n.bed, 23 * 60 + 30); assert.strictEqual(S.clock(n.wake), '7:00');
  // 中断が60分ちょうど → 別の塊。長い方（2:50〜9:00）
  n = S.night([x('10-31', '23:30', '11-01', '01:50'), x('11-01', '02:50', '11-01', '09:00')], '2026-11-01');
  assert.strictEqual(S.bedClock(n.bed), '2:50'); assert.strictEqual(S.clock(n.wake), '9:00');
  // 59分ならつながる
  n = S.night([x('10-31', '23:30', '11-01', '01:51'), x('11-01', '02:50', '11-01', '09:00')], '2026-11-01');
  assert.strictEqual(S.bedClock(n.bed), '23:30');
  // 最後の覚醒（寝床で起きていた）は起床に入れない
  n = S.night([x('10-31', '23:30', '11-01', '07:40', 'コア'), x('11-01', '07:10', '11-01', '07:40', '覚醒')], '2026-11-01');
  assert.strictEqual(S.clock(n.wake), '7:10');
});

t('昼寝・夕方のうたた寝は除く（いちばん長い塊だけ）', () => {
  const n = S.night([x('10-31', '17:00', '10-31', '18:10', 'コア'), x('11-01', '00:10', '11-01', '07:15', 'コア'), x('11-01', '12:30', '11-01', '13:30', 'コア')], '2026-11-01');
  assert.strictEqual(S.bedClock(n.bed), '0:10'); assert.strictEqual(S.clock(n.wake), '7:15');
});

t('入床（ベッドにいた）は眠りの記録が1つも無い日だけ使う', () => {
  let n = S.night([x('10-31', '23:00', '11-01', '07:30', '入床'), x('11-01', '00:00', '11-01', '07:00', 'コア')], '2026-11-01');
  assert.strictEqual(n.bed, 1440); assert.strictEqual(S.clock(n.wake), '7:00'); assert.strictEqual(n.source, 'asleep');
  n = S.night([x('10-31', '23:00', '11-01', '07:30', '入床'), x('11-01', '03:00', '11-01', '03:20', '覚醒')], '2026-11-01');
  assert.strictEqual(n.bed, 23 * 60); assert.strictEqual(S.clock(n.wake), '7:30'); assert.strictEqual(n.source, 'inbed');
  assert.strictEqual(S.night([x('11-01', '03:00', '11-01', '03:20', '覚醒')], '2026-11-01'), null);
  assert.strictEqual(S.night([], '2026-11-01'), null);
});

t('複数のアプリの記録が重なっても、まとめて1つ（Apple Watch とおこしてME）', () => {
  const watch = [x('10-31', '23:55', '11-01', '02:00', 'コア'), x('11-01', '02:00', '11-01', '03:00', '深い'), x('11-01', '03:00', '11-01', '07:10', 'レム')];
  const okoshite = [x('10-31', '23:50', '11-01', '07:20', '睡眠中')];
  const n = S.night(watch.concat(okoshite), '2026-11-01');
  assert.strictEqual(S.bedClock(n.bed), '23:50'); assert.strictEqual(S.clock(n.wake), '7:20');
  assert.strictEqual(n.len, 7 * 60 + 30);
});

t('値の読み分け（日本語・英語・番号）', () => {
  assert.strictEqual(S.classify('コア'), 'asleep'); assert.strictEqual(S.classify('深い'), 'asleep');
  assert.strictEqual(S.classify('レム'), 'asleep'); assert.strictEqual(S.classify('睡眠中'), 'asleep');
  assert.strictEqual(S.classify('Asleep'), 'asleep'); assert.strictEqual(S.classify('Core'), 'asleep'); assert.strictEqual(S.classify('3'), 'asleep');
  assert.strictEqual(S.classify('覚醒'), 'awake'); assert.strictEqual(S.classify('Awake'), 'awake'); assert.strictEqual(S.classify(2), 'awake');
  assert.strictEqual(S.classify('入床'), 'inbed'); assert.strictEqual(S.classify('ベッド内'), 'inbed'); assert.strictEqual(S.classify('In Bed'), 'inbed'); assert.strictEqual(S.classify('0'), 'inbed');
});

t('就寝の差は日付をまたいでも正しい（24:00 目標で 0:12 → 12分おそい、23:40 → 20分早い）', () => {
  const g = S.goalOn(S.history(null), '2026-11-01');
  const a = S.judge({ bed: S.bedFromInput('00:12'), wake: 435, len: 0 }, g);
  assert.strictEqual(a.dBed, 12); assert.strictEqual(S.diffText(a.dBed), '12分おそい'); assert.ok(a.okBed);
  const b = S.judge({ bed: S.bedFromInput('23:40'), wake: 435, len: 0 }, g);
  assert.strictEqual(b.dBed, -20); assert.strictEqual(S.diffText(b.dBed), '20分早い'); assert.ok(!b.okBed);
  assert.strictEqual(S.bedFromInput('00:00'), 1440);
  assert.strictEqual(S.bedClock(1440), '24:00');
  assert.strictEqual(S.toInput(1452), '00:12');
});

t('眠った長さの目標（既定 7時間以上）', () => {
  const g = S.goalOn(S.history(null), '2026-11-01');
  assert.strictEqual(g.sleepLen, 420);
  assert.ok(S.judge({ bed: 1440, wake: 420, len: 420 }, g).okLen);
  const j = S.judge({ bed: 1440, wake: 371, len: 371 }, g);
  assert.ok(!j.okLen); assert.strictEqual(S.lenDiffText(j.dLen), '49分たりない');
  assert.strictEqual(S.lenDiffText(75), '1時間15分長い');
  assert.strictEqual(S.lenText(448), '7時間28分');
  // 3つとも目標内の日だけ all
  assert.ok(S.judge({ bed: 1450, wake: 440, len: 430 }, g).all);
  assert.ok(!S.judge({ bed: 1450, wake: 400, len: 430 }, g).all);
});

t('目標の履歴：各日はその日に有効だった目標で差を出す（初めて変えたとき、前の日は既定のまま）', () => {
  let goal = S.setGoal(null, '2026-10-28', { wake: 420, bed: 1410, sleepLen: 450, band: 15 });
  assert.strictEqual(goal.history.length, 2);
  assert.strictEqual(goal.history[0].from, S.DEFAULT_GOAL.from);
  assert.strictEqual(goal.history[1].from, '2026-10-28');
  let h = S.history(goal);
  assert.strictEqual(S.goalOn(h, '2026-10-27').wake, 435);
  assert.strictEqual(S.goalOn(h, '2026-10-28').wake, 420);
  assert.strictEqual(S.goalOn(h, '2026-11-01').wake, 420);
  // 同じ日にもう一度変えたら、その日の分を置き換える
  goal = S.setGoal(goal, '2026-10-28', { wake: 425, bed: 1410, sleepLen: 450, band: 20 });
  assert.strictEqual(goal.history.length, 2); assert.strictEqual(goal.history[1].wake, 425);
  // 別の日に変える
  goal = S.setGoal(goal, '2026-11-01', { wake: 450, bed: 1440, sleepLen: 420, band: 15, hol: [6] });
  h = S.history(goal);
  assert.deepStrictEqual(h.map(g => g.from), [S.DEFAULT_GOAL.from, '2026-10-28', '2026-11-01']);
  assert.strictEqual(S.goalOn(h, '2026-10-31').band, 20);
  assert.deepStrictEqual(goal.hol, [6]);
  // 何も変えずに保存しても履歴は増えない（休日だけ変わる）
  const same = S.setGoal(goal, '2026-11-05', { wake: 450, bed: 1440, sleepLen: 420, band: 15, hol: [0] });
  assert.strictEqual(same.history.length, 3); assert.deepStrictEqual(same.hol, [0]);
  // 履歴より前の日は、いちばん古い目標
  assert.strictEqual(S.goalOn(S.history({ history: [{ from: '2026-10-01', wake: 400, bed: 1400, sleepLen: 400, band: 10 }] }), '2026-09-01').wake, 400);
});

t('build：直した値を優先。消した日は出さない。戻すと自動の値。前後の日に届いた記録も合わせる', () => {
  const list = [
    { id: 'sleep-20261101', data: { kind: 'sleep', date: '2026-11-01', receivedAt: '2026-11-01T00:00:01Z', samples: [x('11-01', '00:12', '11-01', '07:26'), x('10-31', '03:20', '10-31', '07:05')] } },
    { id: 'sleep-20261031', data: { kind: 'sleep', date: '2026-10-31', samples: [x('10-30', '23:40', '10-31', '03:00'), x('10-31', '20:00', '10-31', '20:30')] } },
    // 10/31 の朝の続きが 11/1 に届いた記録に入っていた（上）。同じ記録の重複も1つに
    { id: 'sleep-20261102', data: { kind: 'sleep', date: '2026-11-02', samples: [x('11-01', '00:12', '11-01', '07:26'), x('11-01', '23:50', '11-02', '07:00')] } },
    { id: 'sleepfix-20261030', data: { kind: 'sleepfix', date: '2026-10-30', bed: 1442, wake: 430 } },
    { id: 'sleepfix-20261102', data: { kind: 'sleepfix', date: '2026-11-02', removed: true } },
    { id: 'h-supple', data: { kind: 'habit', name: 'x' } },
    { id: 'sleep-goal', data: { kind: 'sleepgoal', history: [{ from: '2026-10-01', wake: 420, bed: 1440, sleepLen: 420, band: 15 }], hol: [3, 0] } }
  ];
  const b = S.build(list);
  assert.strictEqual(b.days['2026-11-01'].value.bed, 1452);
  assert.strictEqual(b.days['2026-11-01'].value.fixed, false);
  assert.strictEqual(b.days['2026-11-01'].value.receivedAt, '2026-11-01T00:00:01Z');
  assert.strictEqual(S.clock(b.days['2026-10-31'].value.wake), '7:05');
  assert.strictEqual(b.days['2026-10-31'].value.bed, 23 * 60 + 40);
  assert.strictEqual(b.days['2026-10-30'].value.fixed, true);
  assert.strictEqual(b.days['2026-10-30'].value.len, 430 + 1440 - 1442);
  assert.strictEqual(b.days['2026-11-02'].value, null, '消した日');
  assert.ok(b.days['2026-11-02'].auto, '自動の値は残っている');
  assert.strictEqual(b.goalData.history[0].wake, 420);
  // 直した値を消す（戻す）と自動の値
  assert.strictEqual(S.effective(b.days['2026-11-02'].auto, null).fixed, false);
});

console.log(`\n${passed} 件 すべて成功`);
