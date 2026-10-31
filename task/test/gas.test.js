// task/gas/TaskApi.gs の単体テスト。実行：TZ=Asia/Tokyo node task/test/gas.test.js
// 重点：追加・完了・実働記録で「既存の行（値・数式・書式・入力規則）が変わらない」こと
'use strict';
const assert = require('assert');
const makeGas = require('./gas-mock');
const { ctx, sh, call } = makeGas();
makeGas.fillExample(sh);

let passed = 0;
function t(name, fn) { fn(); passed++; console.log('ok -', name); }
const snap = () => sh.rows.map(row => JSON.stringify(row.map(x => [x.v instanceof Date ? x.v.toISOString() : x.v, x.f, x.fmt, x.dv])));
const rowSnap = r => snap()[r - 1];

t('taskApiSetup 前は no_setup', () => assert.strictEqual(call({ key: 'x', action: 'ping' }).error, 'no_setup'));
ctx.taskApiSetup();
const KEY = ctx.PropertiesService.getScriptProperties().getProperty('TASK_API_KEY');
t('taskApiSetup：合言葉を作る・2回目で変わらない・シートには書かない', () => {
  assert.ok(KEY && KEY.length >= 32);
  const before = snap();
  ctx.taskApiSetup();
  assert.strictEqual(ctx.PropertiesService.getScriptProperties().getProperty('TASK_API_KEY'), KEY);
  assert.deepStrictEqual(snap(), before);
});
t('合言葉違い・壊れた送信・不明 action', () => {
  assert.strictEqual(call({ key: 'no', action: 'ping' }).error, 'bad_key');
  assert.strictEqual(JSON.parse(ctx.doPost({ postData: { contents: '{' } }).text).error, 'bad_request');
  assert.strictEqual(call({ key: KEY, action: 'zzz' }).error, 'bad_action');
});
t('ping：実働列なし', () => {
  const r = call({ key: KEY, action: 'ping' });
  assert.ok(r.ok); assert.strictEqual(r.actualColumn, false); assert.strictEqual(r.today, '2026-10-30');
});
t('list：今日＋持ち越しの未完了、今日の完了。読むだけで何も変えない', () => {
  const before = snap(); sh.writes.length = 0;
  const r = call({ key: KEY, action: 'list' });
  assert.deepStrictEqual(r.tasks.map(x => x.no), [12, 11, 10]);
  assert.strictEqual(r.tasks[0].date, '2026-10-28');
  assert.strictEqual(r.tasks[2].done, true);
  assert.strictEqual(r.tasks[2].slot, '昼');
  assert.deepStrictEqual(r.projects, ['例）案件A', '例）案件B', '例）案件C']);
  assert.deepStrictEqual(snap(), before);
  assert.strictEqual(sh.writes.length, 0);
});

let added;
t('add：4行目に挿入。既存の行は1行下がるだけで中身は同じ', () => {
  const before = snap();
  const r = call({ key: KEY, action: 'add', reqId: 'req-0001-abcd', pj: '例）案件B', parent: 'プレゼン構成', todo: '表紙', detail: 'メモ', ko: 0.5, date: '2026-10-31', slot: '夕' });
  assert.ok(r.ok, JSON.stringify(r));
  added = r.task;
  const after = snap();
  assert.deepStrictEqual(after.slice(0, 3), before.slice(0, 3), '1〜3行目は不変');
  assert.deepStrictEqual(after.slice(4), before.slice(3), '元の4行目以下は1行下がるだけ');
  // 新しい行の中身
  const v = n => sh.peek(4, n);
  assert.strictEqual(v(1).v, 13);
  assert.strictEqual(v(2).v, false);
  assert.strictEqual(v(3).v, '例）案件B');
  assert.strictEqual(v(4).v, 'プレゼン構成 | 表紙');
  assert.strictEqual(v(5).v, 0.5);
  assert.strictEqual(ctx.Utilities.formatDate(v(6).v, 'Asia/Tokyo', 'yyyy-MM-dd'), '2026-10-31');
  assert.strictEqual(v(8).v, '🌙');
  assert.strictEqual(v(11).v, 'メモ');
  // 書式・チェックボックス・数式は見本（元の4行目）と同じ
  assert.strictEqual(v(2).dv, 'checkbox');
  assert.strictEqual(v(1).fmt, 'body');
  assert.strictEqual(v(7).f, '=IF(RC6="","",TEXT(RC6,"(ddd)"))');
  assert.strictEqual(v(12).f, '=IF(RC6=R1C,RC5,"")');
  assert.strictEqual(v(12).fmt, 'gantt');
  assert.strictEqual(added.no, 13); assert.strictEqual(added.slot, '夕');
});
t('add：同じ reqId の再送では二重に追加しない', () => {
  const before = snap();
  const r = call({ key: KEY, action: 'add', reqId: 'req-0001-abcd', todo: '表紙', ko: 0.5, date: '2026-10-31' });
  assert.ok(r.ok); assert.strictEqual(r.task.no, 13);
  assert.deepStrictEqual(snap(), before);
});
t('add：入力チェック（ToDo なし・工の範囲・日付・時間帯）でシートは不変', () => {
  const before = snap();
  assert.strictEqual(call({ key: KEY, action: 'add', todo: ' ', ko: 1, date: '2026-10-30' }).error, 'no_todo');
  assert.strictEqual(call({ key: KEY, action: 'add', todo: 'a', ko: 99, date: '2026-10-30' }).error, 'bad_ko');
  assert.strictEqual(call({ key: KEY, action: 'add', todo: 'a', ko: 1, date: '10/30' }).error, 'bad_date');
  assert.strictEqual(call({ key: KEY, action: 'add', todo: 'a', ko: 1, date: '2026-10-30', slot: '夜' }).error, 'bad_slot');
  assert.deepStrictEqual(snap(), before);
});

t('done：完了列だけが変わる（実働列なし→実働は保存されない）', () => {
  const before = snap(); sh.writes.length = 0;
  const r = call({ key: KEY, action: 'done', no: 11, todo: 'プレゼン構成 | 目次を作る', actual: 1.3 });
  assert.ok(r.ok, JSON.stringify(r));
  assert.strictEqual(r.actualSaved, false);
  assert.strictEqual(r.task.done, true);
  const after = snap();
  const row = 7; // 元6行目 → 1行下がって7行目
  after.forEach((s, i) => { if (i !== row - 1) assert.strictEqual(s, before[i], (i + 1) + '行目が変わった'); });
  const b = JSON.parse(before[row - 1]), a = JSON.parse(after[row - 1]);
  a.forEach((cell, j) => { if (j !== 1) assert.deepStrictEqual(cell, b[j], (j + 1) + '列目が変わった'); });
  assert.strictEqual(a[1][0], true);
  assert.deepStrictEqual(sh.writes, [['setValue', 7, 2]]);
});
t('done：No と ToDo が合わなければ何も書かない', () => {
  const before = snap();
  assert.strictEqual(call({ key: KEY, action: 'done', no: 11, todo: '別のタスク' }).error, 'not_found');
  assert.strictEqual(call({ key: KEY, action: 'done', no: 999, todo: 'プレゼン構成 | 目次を作る' }).error, 'not_found');
  assert.deepStrictEqual(snap(), before);
});
t('undone：完了を外す（完了列だけ）', () => {
  const before = snap();
  const r = call({ key: KEY, action: 'undone', no: 11, todo: 'プレゼン構成 | 目次を作る' });
  assert.ok(r.ok); assert.strictEqual(r.task.done, false);
  const after = snap();
  after.forEach((s, i) => { if (i !== 6) assert.strictEqual(s, before[i]); });
});

t('taskApiAddActualColumn：最終列の右の1行目に「実働」を書くだけ。2回目は何もしない', () => {
  const before = snap();
  const lastCol = sh.getLastColumn();
  ctx.taskApiAddActualColumn();
  const after = snap();
  assert.strictEqual(sh.peek(1, lastCol + 1).v, '実働');
  const b0 = JSON.parse(before[0]), a0 = JSON.parse(after[0]);
  assert.deepStrictEqual(a0.slice(0, lastCol), b0.slice(0, lastCol));
  assert.strictEqual(a0.length, lastCol + 1);
  assert.deepStrictEqual(after.slice(1), before.slice(1));
  const again = snap();
  ctx.taskApiAddActualColumn();
  assert.deepStrictEqual(snap(), again);
});
t('done＋実働：完了列と実働列のセルだけ（0.25h 単位に丸め）', () => {
  const before = snap(); sh.writes.length = 0;
  const r = call({ key: KEY, action: 'done', no: 12, todo: '見積書の確認 | 設備項目', actual: 1.3 });
  assert.ok(r.ok); assert.strictEqual(r.actualSaved, true); assert.strictEqual(r.task.actual, 1.25);
  const after = snap();
  after.forEach((s, i) => { if (i !== 5) assert.strictEqual(s, before[i]); });
  assert.deepStrictEqual(sh.writes, [['setValue', 6, 2], ['setValue', 6, 15]]);
  assert.strictEqual(sh.peek(6, 15).v, 1.25);
});
t('actual：実働だけ直す・範囲外は拒否', () => {
  const before = snap();
  assert.strictEqual(call({ key: KEY, action: 'actual', no: 12, todo: '見積書の確認 | 設備項目', actual: -1 }).error, 'bad_actual');
  assert.deepStrictEqual(snap(), before);
  const r = call({ key: KEY, action: 'actual', no: 12, todo: '見積書の確認 | 設備項目', actual: 2 });
  assert.ok(r.ok); assert.strictEqual(sh.peek(6, 15).v, 2);
});
t('add（実働列あり）：実働列は空のまま、ほかの行は不変', () => {
  const before = snap();
  const r = call({ key: KEY, action: 'add', todo: '単発タスク', ko: 1, date: '2026-10-30', slot: '朝' });
  assert.ok(r.ok); assert.strictEqual(r.task.todo, '単発タスク'); assert.strictEqual(r.task.actual, null);
  const after = snap();
  assert.deepStrictEqual(after.slice(4), before.slice(3));
  assert.deepStrictEqual(after.slice(0, 3), before.slice(0, 3));
});
t('taskApiShowLink：#t= 付きのリンク（apps 共通の #c= と別）', () => {
  ctx.__logs = [];
  ctx.taskApiShowLink();
  const m = /https:\/\/cotoxdgn\.github\.io\/task\/#t=([A-Za-z0-9_-]+)/.exec(ctx.__logs.join('\n'));
  assert.ok(m);
  const o = JSON.parse(Buffer.from(m[1], 'base64').toString());
  assert.strictEqual(o.u, 'https://script.google.com/macros/s/TEST/exec'); assert.strictEqual(o.k, KEY);
});

t('スプシに付いたプロジェクトでは taskApiSetup / AddActualColumn / ShowLink を中止（何も書かない）', () => {
  const g2 = makeGas(); makeGas.fillExample(g2.sh);
  g2.ctx.SpreadsheetApp.getActiveSpreadsheet = () => g2.ss;
  const before = JSON.stringify(g2.sh.rows);
  g2.ctx.__logs = [];
  g2.ctx.taskApiSetup(); g2.ctx.taskApiAddActualColumn(); g2.ctx.taskApiShowLink();
  assert.strictEqual(g2.props.TASK_API_KEY, undefined);
  assert.strictEqual(JSON.stringify(g2.sh.rows), before);
  assert.strictEqual(g2.ctx.__logs.length, 3);
  assert.ok(g2.ctx.__logs.every(l => l.includes('このプロジェクトはスプシに付いています。script.google.com で新しいプロジェクトを作ってください')));
});
t('グローバルは TASKAPI・taskApi*・doGet/doPost だけ（既存GASと名前が衝突しない）', () => {
  const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'gas', 'TaskApi.gs'), 'utf8');
  const names = [...src.matchAll(/^(?:function|var|let|const)\s+([A-Za-z_$][\w$]*)/gm)].map(m => m[1]);
  names.forEach(n => assert.ok(n === 'TASKAPI' || n === 'doGet' || n === 'doPost' || /^taskApi/.test(n), n));
  ['setup', 'showConnectLink', 'addActualColumn'].forEach(n => assert.ok(!names.includes(n), n));
});

console.log(`\n${passed} passed`);
