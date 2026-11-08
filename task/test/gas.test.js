// task/gas/TaskApi.gs の単体テスト。実行：TZ=Asia/Tokyo node task/test/gas.test.js
// 重点：追加・完了・実働記録で「既存の行（値・数式・書式・入力規則）が変わらない」こと
'use strict';
const assert = require('assert');
const makeGas = require('./gas-mock');
const { ctx, sh, call, clockBox } = makeGas();
makeGas.fillExample(sh);

let passed = 0;
function t(name, fn) { fn(); passed++; console.log('ok -', name); }
const trimRow = row => { const r = row.slice(); while (r.length && r[r.length - 1].v === '' && !r[r.length - 1].f && !r[r.length - 1].fmt && !r[r.length - 1].dv) r.pop(); return r; };   // 末尾の空のセルは比べない（並べ替えで行の長さだけ変わるため）
const snap = () => sh.rows.map(row => JSON.stringify(trimRow(row).map(x => [x.v instanceof Date ? x.v.toISOString() : x.v, x.f, x.fmt, x.dv])));
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
  assert.strictEqual(r.tasks[1].wait, '山田さん'); assert.strictEqual(r.tasks[0].wait, '');
  assert.strictEqual(r.tasks[0].preWait, false, '前提の No.10 は完了済み');
  assert.strictEqual(r.tasks[1].preWait, true, '前提の No.12 は未完了');
  assert.deepStrictEqual(r.projects, ['例）案件A', '例）案件B', '例）案件C']);
  assert.deepStrictEqual(snap(), before);
  assert.strictEqual(sh.writes.length, 0);
});

let added;
t('add：最終行の下に足して📅順に並べ替え（2026-11-05 から）。既存の行の中身は変わらない', () => {
  const before = snap();
  const r = call({ key: KEY, action: 'add', reqId: 'req-0001-abcd', pj: '例）案件B', parent: 'プレゼン構成', todo: '表紙', detail: 'メモ', ko: 0.5, date: '2026-10-31', slot: '夕' });
  assert.ok(r.ok, JSON.stringify(r));
  added = r.task;
  const after = snap();
  assert.deepStrictEqual(after.slice(0, 4), before.slice(0, 4), '1〜4行目（見出し・入力行）は不変');
  const rest = after.slice(4);
  before.slice(4).forEach(x => assert.ok(rest.includes(x), '既存の行が変わった：' + x));
  assert.strictEqual(after.length, before.length + 1);
  // 新しい行の中身（並べ替えのあとの位置）
  const row = added.row;
  const v = n => sh.peek(row, n);
  assert.strictEqual(v(1).v, 13);
  assert.strictEqual(v(2).v, false);
  assert.strictEqual(v(3).v, '例）案件B');
  assert.strictEqual(v(4).v, 'プレゼン構成 | 表紙');
  assert.strictEqual(v(5).v, 0.5);
  assert.strictEqual(ctx.Utilities.formatDate(v(6).v, 'Asia/Tokyo', 'yyyy-MM-dd'), '2026-10-31');
  assert.strictEqual(v(8).v, '🌙');
  assert.strictEqual(v(11).v, 'メモ');
  assert.strictEqual(v(2).dv, 'checkbox');
  assert.strictEqual(v(7).f, '=IF(RC6="","",TEXT(RC6,"(ddd)"))');
  // 5行目から下は📅順
  const dates = []; for (let k = 5; k <= sh.getLastRow(); k++) { const d = sh.peek(k, 6).v; if (d instanceof Date) dates.push(d.getTime()); }
  assert.deepStrictEqual(dates, dates.slice().sort((a, b) => a - b));
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
  const row = r.task.row; // 並べ替えで行は動くので、返ってきた行で見る
  after.forEach((s, i) => { if (i !== row - 1) assert.strictEqual(s, before[i], (i + 1) + '行目が変わった'); });
  const b = JSON.parse(before[row - 1]), a = JSON.parse(after[row - 1]);
  a.forEach((cell, j) => { if (j !== 1) assert.deepStrictEqual(cell, b[j], (j + 1) + '列目が変わった'); });
  assert.strictEqual(a[1][0], true);
  assert.deepStrictEqual(sh.writes, [['setValue', row, 2]]);
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
  after.forEach((s, i) => { if (i !== r.task.row - 1) assert.strictEqual(s, before[i]); });
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
t('done＋実働：完了列と実働列のセルだけ（0.1h 単位に丸め）', () => {
  const before = snap(); sh.writes.length = 0;
  const r = call({ key: KEY, action: 'done', no: 12, todo: '見積書の確認 | 設備項目', actual: 1.3 });
  assert.ok(r.ok); assert.strictEqual(r.actualSaved, true); assert.strictEqual(r.task.actual, 1.3);
  const after = snap();
  after.forEach((s, i) => { if (i !== 5) assert.strictEqual(s, before[i]); });
  assert.deepStrictEqual(sh.writes, [['setValue', 6, 2], ['setValue', 6, 15]]);
  assert.strictEqual(sh.peek(6, 15).v, 1.3);
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
  assert.deepStrictEqual(after.slice(0, 4), before.slice(0, 4));
  before.slice(4).forEach(x => assert.ok(after.slice(4).includes(x), '既存の行が変わった：' + x.slice(0, 120)));
  assert.strictEqual(sh.peek(r.task.row, 15).v, '', '実働は空');
});
t('list：明日（次の日）の未完了を tomorrow で返す。今日の一覧には入れない', () => {
  // No.8（古い完了タスク）の行を、明日の未完了に一時的に変えて確かめる
  const all = ctx.taskApi_readAll(sh, ctx.taskApi_cols(sh));
  const t8 = all.find(x => x.no === 8);
  const keep = [sh.peek(t8.row, 2).v, sh.peek(t8.row, 6).v];
  sh.peek(t8.row, 2).v = false; sh.peek(t8.row, 6).v = new Date(2026, 9, 31);
  const r = call({ key: KEY, action: 'list' });
  assert.strictEqual(r.tomorrowDate, '2026-10-31');
  assert.ok(r.tomorrow.some(x => x.no === 8));
  assert.ok(r.tomorrow.every(x => x.date === '2026-10-31' && !x.done));
  assert.ok(!r.tasks.some(x => x.no === 8));
  sh.peek(t8.row, 2).v = keep[0]; sh.peek(t8.row, 6).v = keep[1];
});
t('list：前提の選択肢（未完了の「No.ToDo」）と👤の候補', () => {
  const r = call({ key: KEY, action: 'list' });
  assert.ok(r.preOptions.some(o => o.label === '11.プレゼン構成 | 目次を作る'));
  assert.ok(!r.preOptions.some(o => o.no === 10), '完了済みは出ない');
  assert.ok(r.people.includes('山田さん'));
  assert.strictEqual(r.waitColumn, true); assert.strictEqual(r.preColumn, true);
});
t('setWait：👤と前提のセルだけを書く。自分自身・形の違う前提は断る', () => {
  const no = 9, todo = '現場写真の整理';
  const row = ctx.taskApi_findTask(sh, ctx.taskApi_cols(sh), { no, todo }).row;
  const before = snap(); sh.writes.length = 0;
  const r = call({ key: KEY, action: 'setWait', no, todo, wait: '佐藤さん', pre: '11.プレゼン構成 | 目次を作る' });
  assert.ok(r.ok, JSON.stringify(r));
  assert.strictEqual(r.task.wait, '佐藤さん'); assert.strictEqual(r.task.pre, '11.プレゼン構成 | 目次を作る');
  const after = snap();
  after.forEach((x, i) => { if (i !== row - 1) assert.strictEqual(x, before[i]); });
  assert.deepStrictEqual(sh.writes.map(w => w[1]), [row, row]);
  assert.strictEqual(call({ key: KEY, action: 'setWait', no, todo, pre: '9.自分' }).error, 'bad_pre');
  assert.strictEqual(call({ key: KEY, action: 'setWait', no, todo, pre: 'てきとう' }).error, 'bad_pre');
  const r2 = call({ key: KEY, action: 'setWait', no, todo, wait: '', pre: '' });
  assert.ok(r2.ok); assert.strictEqual(r2.task.wait, ''); assert.strictEqual(r2.task.pre, '');
  assert.strictEqual(call({ key: KEY, action: 'setWait', no: 999, todo: 'x', wait: 'a' }).error, 'not_found');
  // 📅・⏰
  const r3 = call({ key: KEY, action: 'setWait', no, todo, date: '2026-11-05', slot: '夕' });
  assert.ok(r3.ok, JSON.stringify(r3)); assert.strictEqual(r3.task.date, '2026-11-05'); assert.strictEqual(r3.task.slot, '夕');
  const r4 = call({ key: KEY, action: 'setWait', no, todo, slot: '13:30' });
  assert.ok(r4.ok); assert.strictEqual(sh.peek(row, 8).v, 13.5);
  const r4b = call({ key: KEY, action: 'setWait', no, todo, slot: '移動' });
  assert.ok(r4b.ok); assert.strictEqual(sh.peek(row, 8).v, '🚃'); assert.strictEqual(r4b.task.slot, '移動', '🚃 はシートの移動の印');
  // タスク名（D列）
  assert.strictEqual(call({ key: KEY, action: 'setWait', no, todo, newTodo: '  ' }).error, 'no_todo');
  const rn = call({ key: KEY, action: 'setWait', no, todo, newTodo: '現場写真の整理\nと共有' });
  assert.ok(rn.ok, JSON.stringify(rn)); assert.strictEqual(rn.task.todo, '現場写真の整理 と共有');
  assert.strictEqual(call({ key: KEY, action: 'setWait', no, todo, slot: '' }).error, 'not_found', '前の名前では見つからない');
  const rb = call({ key: KEY, action: 'setWait', no, todo: '現場写真の整理 と共有', newTodo: todo });
  assert.ok(rb.ok); assert.strictEqual(rb.task.todo, todo);
  const r5 = call({ key: KEY, action: 'setWait', no, todo, slot: '' });
  assert.ok(r5.ok); assert.strictEqual(r5.task.slot, ''); assert.strictEqual(r5.task.slotRaw, '');
  const b1 = snap();
  assert.strictEqual(call({ key: KEY, action: 'setWait', no, todo, date: '11/5', wait: 'x' }).error, 'bad_date');
  assert.strictEqual(call({ key: KEY, action: 'setWait', no, todo, slot: '25:00' }).error, 'bad_slot');
  assert.strictEqual(call({ key: KEY, action: 'setWait', no, todo, slot: '夜' }).error, 'bad_slot');
  assert.strictEqual(call({ key: KEY, action: 'setWait', no, todo, date: '2026-11-06', pre: 'てきとう' }).error, 'bad_pre');
  assert.deepStrictEqual(snap(), b1, '断ったときは何も書かない');
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

t('remove：No と ToDo が合う1行だけ削除。前提にされている未完了タスクは消さない', () => {
  // 前提にされているタスク（No.12 は No.11 の前提）は断る
  const all0 = ctx.taskApi_readAll(sh, ctx.taskApi_cols(sh));
  const t12 = all0.find(x => x.no === 12);
  const user = all0.find(x => !x.done && /^\s*12\./.test(x.pre || ''));
  if (user) {
    const r0 = call({ key: KEY, action: 'remove', no: 12, todo: t12.todo });
    assert.strictEqual(r0.error, 'used_as_pre'); assert.ok(r0.detail.includes(String(user.no)));
  }
  assert.strictEqual(call({ key: KEY, action: 'remove', no: 13, todo: '違う名前' }).error, 'not_found');
  const before = snap();
  const t13 = all0.find(x => x.no === 13);
  const r = call({ key: KEY, action: 'remove', no: 13, todo: t13.todo });
  assert.ok(r.ok, JSON.stringify(r)); assert.strictEqual(r.removed.no, 13);
  const after = snap();
  assert.strictEqual(after.length, before.length - 1);
  assert.deepStrictEqual(after, before.filter((x, i) => i !== t13.row - 1), 'その行だけ消えて、ほかは同じ');
  assert.ok(!ctx.taskApi_readAll(sh, ctx.taskApi_cols(sh)).some(x => x.no === 13));
});

// ---------- 定期タスク ----------
const rs = makeGas.fillRecur(ctx.SpreadsheetApp.openById('1all9BRCbemXapdhjBidydCAjPbw26pNmmyi0wbxk66Q'));
const rsnap = () => rs.rows.map(row => JSON.stringify(row.map(x => [x.v instanceof Date ? x.v.toISOString() : x.v, x.dv])));
t('recurList：表を読むだけ（例の行は止めた状態で出る）', () => {
  const before = rsnap(); rs.writes.length = 0;
  const r = call({ key: KEY, action: 'recurList' });
  assert.ok(r.ok, JSON.stringify(r));
  assert.strictEqual(r.rules.length, 1);
  assert.deepStrictEqual([r.rules[0].row, r.rules[0].on, r.rules[0].todo, r.rules[0].time, r.rules[0].type, r.rules[0].when], [2, false, 'タスクを整理する', '9:30', '毎週', '日']);
  assert.deepStrictEqual(rsnap(), before); assert.strictEqual(rs.writes.length, 0);
});
t('recurSave：入力の確かめ（書く前に断る）', () => {
  const before = rsnap();
  const base = { pj: '例）案件A', todo: 'メール返信', ko: 0.5, time: '朝', type: '平日', when: '' };
  const bad = (o, code) => assert.strictEqual(call({ key: KEY, action: 'recurSave', rule: Object.assign({}, base, o) }).error, code, JSON.stringify(o));
  bad({ todo: ' ' }, 'no_todo'); bad({ ko: 30 }, 'bad_ko'); bad({ time: '25:00' }, 'bad_slot'); bad({ time: '夜' }, 'bad_slot');
  bad({ type: '隔週' }, 'bad_type'); bad({ type: '毎週', when: '' }, 'bad_when'); bad({ type: '毎週', when: '月x' }, 'bad_when');
  bad({ type: '毎月', when: '32' }, 'bad_when'); bad({ from: '2026-11-10', to: '2026-11-01' }, 'bad_range');
  assert.deepStrictEqual(rsnap(), before);
});
let r1;
t('recurSave（追加）：空いている一番上の行（3行目）に書く。ほかの行は変えない。日次には書かない', () => {
  const before = rsnap(), dBefore = snap();
  r1 = call({ key: KEY, action: 'recurSave', reqId: 'recur-0001-ab', rule: { pj: '例）案件A', todo: 'メール返信', ko: 0.5, time: '朝', type: '平日', when: '', detail: 'メモ' } });
  assert.ok(r1.ok, JSON.stringify(r1));
  assert.strictEqual(r1.rule.row, 3); assert.strictEqual(r1.rule.on, true); assert.strictEqual(r1.rule.time, '🌅');
  assert.strictEqual(r1.todayAdded, false);
  const after = rsnap();
  after.forEach((x, i) => { if (i !== 2) assert.strictEqual(x, before[i], (i + 1) + '行目が変わった'); });
  assert.strictEqual(rs.peek(3, 5).nf, '@');
  assert.deepStrictEqual(snap(), dBefore, '日次ガントは変えない（書き出しは毎朝8時の仕組み）');
  // 同じ reqId の再送で二重にならない
  const again = call({ key: KEY, action: 'recurSave', reqId: 'recur-0001-ab', rule: { pj: '例）案件A', todo: 'メール返信', ko: 0.5, time: '朝', type: '平日' } });
  assert.strictEqual(again.rule.row, 3); assert.strictEqual(call({ key: KEY, action: 'recurList' }).rules.length, 2);
});
t('recurSave（今日の分もすぐ）：10/30(金) に当たる毎週金を足すと、今日の1件だけ日次に入り、ログに残る。2回目は入らない', () => {
  const dBefore = snap();
  const r = call({ key: KEY, action: 'recurSave', today: true, rule: { pj: '例）案件B', todo: '週報', ko: 1, time: '13:30', type: '毎週', when: '金' } });
  assert.ok(r.ok, JSON.stringify(r)); assert.strictEqual(r.todayAdded, true);
  assert.strictEqual(r.task.date, '2026-10-30'); assert.strictEqual(r.task.todo, '週報'); assert.strictEqual(r.task.slotRaw, '13.5');
  assert.strictEqual(snap().length, dBefore.length + 1);
  dBefore.slice(4).forEach(x => assert.ok(snap().includes(x), '既存の行が変わった'));
  const lg = ctx.SpreadsheetApp.openById('1all9BRCbemXapdhjBidydCAjPbw26pNmmyi0wbxk66Q').getSheetByName('_定期ログ');
  assert.ok(lg && lg.hidden); assert.strictEqual(lg.peek(1, 1).v, '例）案件B|週報|2026-10-30');
  const again = call({ key: KEY, action: 'recurSave', row: r.rule.row, pj: '例）案件B', todo: '週報', today: true, rule: { pj: '例）案件B', todo: '週報', ko: 1, time: '13:30', type: '毎週', when: '金' } });
  assert.ok(again.ok); assert.strictEqual(again.todayAdded, false); assert.strictEqual(again.todayNote, 'already');
  // 今日に当たらない決まり
  const no = call({ key: KEY, action: 'recurSave', today: true, rule: { pj: '', todo: '月初の請求', ko: 1, time: '', type: '毎月', when: '1' } });
  assert.strictEqual(no.todayAdded, false); assert.strictEqual(no.todayNote, 'not_today');
});
t('recurSave（直す）：行番号と元の PJ・ToDo が合わなければ断る。名前を変えると、入っている今日以降の分をログに足す', () => {
  assert.strictEqual(call({ key: KEY, action: 'recurSave', row: 3, pj: '例）案件A', todo: '違う', rule: { todo: 'x', ko: 1, type: '毎日' } }).error, 'recur_changed');
  const row = call({ key: KEY, action: 'recurList' }).rules.find(x => x.todo === '週報').row;
  const r = call({ key: KEY, action: 'recurSave', row: row, pj: '例）案件B', todo: '週報', rule: { pj: '例）案件B', todo: '週報を書く', ko: 1, time: '13:30', type: '毎週', when: '金' } });
  assert.ok(r.ok, JSON.stringify(r)); assert.strictEqual(r.rule.todo, '週報を書く'); assert.strictEqual(r.rule.on, true);
  const lg = ctx.SpreadsheetApp.openById('1all9BRCbemXapdhjBidydCAjPbw26pNmmyi0wbxk66Q').getSheetByName('_定期ログ');
  assert.strictEqual(lg.peek(2, 1).v, '例）案件B|週報を書く|2026-10-30');
});
t('recurToggle：有効だけ書き換える（行は消さない）。止めた決まりは今日の分も入れない', () => {
  const before = rsnap();
  const r = call({ key: KEY, action: 'recurToggle', row: 3, pj: '例）案件A', todo: 'メール返信', on: false });
  assert.ok(r.ok); assert.strictEqual(r.rule.on, false);
  const after = rsnap();
  assert.strictEqual(after.length, before.length);
  after.forEach((x, i) => { if (i !== 2) assert.strictEqual(x, before[i]); });
  assert.strictEqual(rs.peek(3, 2).v, '例）案件A');
  assert.strictEqual(call({ key: KEY, action: 'recurToggle', row: 3, pj: 'x', todo: 'メール返信', on: true }).error, 'recur_changed');
  const s = call({ key: KEY, action: 'recurSave', row: 3, pj: '例）案件A', todo: 'メール返信', today: true, rule: { pj: '例）案件A', todo: 'メール返信', ko: 0.5, time: '朝', type: '毎日' } });
  assert.strictEqual(s.todayAdded, false); assert.strictEqual(s.rule.on, false);
});
t('祝日と判定（定期タスク.gs と同じ）', () => {
  const H = (y, m, d) => ctx.taskApi_isHoliday(new Date(y, m - 1, d));
  assert.ok(H(2026, 11, 3)); assert.ok(H(2026, 11, 23)); assert.ok(H(2026, 9, 22), '国民の休日'); assert.ok(H(2026, 5, 6), '振替休日');
  assert.ok(!H(2026, 11, 6));
  const m = (rule, ymd) => ctx.taskApi_recurMatch(Object.assign({ from: '', to: '', when: '' }, rule), ymd);
  assert.ok(!m({ type: '平日' }, '2026-11-03')); assert.ok(m({ type: '平日' }, '2026-11-04')); assert.ok(!m({ type: '平日' }, '2026-11-07'));
  assert.ok(m({ type: '毎月', when: '末' }, '2026-11-30')); assert.ok(!m({ type: '毎月', when: '末' }, '2026-11-29'));
  assert.ok(m({ type: '毎週', when: '月水' }, '2026-11-04')); assert.ok(!m({ type: '毎日', from: '2026-11-10' }, '2026-11-09'));
});

// ---------- 案件のガント・重さ・アーカイブ・詳細 ----------
t('setWait：詳細を書き換える。工程表連動の⛓印は消させない', () => {
  const all = ctx.taskApi_readAll(sh, ctx.taskApi_cols(sh));
  const x = all.find(y => !y.done);
  const r = call({ key: KEY, action: 'setWait', no: x.no, todo: x.todo, detail: '新しいメモ\nhttps://example.com' });
  assert.ok(r.ok, JSON.stringify(r)); assert.strictEqual(r.task.detail, '新しいメモ https://example.com');
  sh.cell(x.row, 11).v = '📋工程表 ⛓1_kvC8TW:12';
  assert.strictEqual(call({ key: KEY, action: 'setWait', no: x.no, todo: x.todo, detail: 'メモだけ' }).error, 'keep_link');
  assert.ok(call({ key: KEY, action: 'setWait', no: x.no, todo: x.todo, detail: 'メモ 📋工程表 ⛓1_kvC8TW:12' }).ok);
  sh.cell(x.row, 11).v = '';
});
t('pj：読むだけ。ガントの日付列は読まない（必要な列まで）', () => {
  const before = snap(); sh.writes.length = 0;
  const r = call({ key: KEY, action: 'pj' });
  assert.ok(r.ok); assert.ok(r.tasks.length >= 5);
  assert.ok(r.tasks.every(x => 'pj' in x && 'todo' in x && 'done' in x && !('row' in x)));
  assert.deepStrictEqual(snap(), before); assert.strictEqual(sh.writes.length, 0);
  const cc = ctx.taskApi_cols(sh);
  assert.strictEqual(cc.width, Math.max(11, cc.actual || 0), '使う列の一番右まで（ガントの日付列は、使う列より右なら読まない）');
});
t('weight：行×列と、移せる行の数', () => {
  clockBox.t = Date.parse('2026-11-25T03:00:00.000Z');   // 日本時間 11/25（10/20 の完了から30日より後）
  const r = call({ key: KEY, action: 'weight' });
  assert.ok(r.ok); assert.strictEqual(r.cells, r.rows * r.cols); assert.strictEqual(r.limit, 200000);
  assert.strictEqual(r.archiveCandidates, 1, '10/20 の古い完了（No.8）だけ。10/30 の完了はまだ30日たっていない');
});
t('archivePreview → archiveRun：写してから消す。見ていない行・前提の行は移さない', () => {
  const p = call({ key: KEY, action: 'archivePreview' });
  assert.deepStrictEqual(p.items.map(x => x.no), [8]);
  assert.strictEqual(call({ key: KEY, action: 'archiveRun', items: [{ no: 10, todo: 'メール返信 | 協力会社' }] }).moved, 0, '30日たっていない行は送られても移さない');
  const before = snap(), n0 = before.length;
  const row8 = ctx.taskApi_readAll(sh, ctx.taskApi_cols(sh)).find(x => x.no === 8).row;
  const r = call({ key: KEY, action: 'archiveRun', items: p.items });
  assert.ok(r.ok); assert.strictEqual(r.moved, 1);
  assert.deepStrictEqual(snap(), before.filter((x, i) => i !== row8 - 1), 'その行だけ消えて、ほかは同じ');
  const ar = ctx.SpreadsheetApp.openById('1all9BRCbemXapdhjBidydCAjPbw26pNmmyi0wbxk66Q').getSheetByName('_完了アーカイブ');
  assert.strictEqual(ar.peek(1, 4).v, 'ToDo｜未完了・日付順'); assert.strictEqual(ar.peek(2, 1).v, 8); assert.strictEqual(ar.peek(2, 4).v, '古い完了タスク');
  assert.strictEqual(snap().length, n0 - 1);
  const pj = call({ key: KEY, action: 'pj' });
  assert.ok(pj.tasks.some(x => x.no === 8 && x.arc === 1), 'アーカイブの行も案件の集計に入る');
});

// ---------- 工程の組み立て・ひな形 ----------
t('tmplSave / tmplList：非表示の「_ひな形」に値だけで保存。同じ名前は overwrite のときだけ置き換える', () => {
  const rows = [{ parent: '診断の設問', child: 'テイストの聞き方', ko: 2, need: '藤井さんへ提案' }, { parent: '仕様書テンプレ', child: '表紙', ko: 1, need: '藤井さんへ提案' }, { parent: 'プレゼン資料', child: 'デモ動画の撮影', ko: 2, wait: '' }];
  const r = call({ key: KEY, action: 'tmplSave', name: '標準仕様書', rows });
  assert.ok(r.ok, JSON.stringify(r)); assert.strictEqual(r.saved, 3);
  const ts = ctx.SpreadsheetApp.openById('1all9BRCbemXapdhjBidydCAjPbw26pNmmyi0wbxk66Q').getSheetByName('_ひな形');
  assert.ok(ts.hidden); assert.strictEqual(ts.peek(1, 6).v, '必要な◆');
  assert.ok(ts.rows.every(row => row.every(x => !x.f)), '数式は入れない');
  assert.strictEqual(call({ key: KEY, action: 'tmplSave', name: '標準仕様書', rows }).error, 'tmpl_exists');
  const r2 = call({ key: KEY, action: 'tmplSave', name: '標準仕様書', rows: rows.slice(0, 2), overwrite: true });
  assert.strictEqual(r2.replaced, 3); assert.strictEqual(r2.saved, 2);
  const l = call({ key: KEY, action: 'tmplList' });
  assert.deepStrictEqual(l.templates['標準仕様書'].map(x => x.child), ['テイストの聞き方', '表紙']);
  assert.strictEqual(l.templates['標準仕様書'][0].need, '藤井さんへ提案');
});
t('kumitate：📅・名前・外す・戻す・足す。ほかの案件・完了の行は変えない。外すは行を消さない', () => {
  const all = ctx.taskApi_readAll(sh, ctx.taskApi_cols(sh));
  const a = all.filter(x => x.pj === '例）案件A' && !x.done);
  assert.ok(a.length >= 1);
  const other = all.filter(x => x.pj !== '例）案件A').map(x => x.no + '|' + x.todo + '|' + x.date).sort();
  // 別の案件の行は断る
  const ob = all.find(x => x.pj !== '例）案件A' && !x.done);
  assert.strictEqual(call({ key: KEY, action: 'kumitate', pj: '例）案件A', ops: [{ op: 'date', no: ob.no, todo: ob.todo, date: '2026-12-01' }] }).error, 'not_found');
  const n0 = sh.getLastRow();
  const r = call({ key: KEY, action: 'kumitate', pj: '例）案件A', reqId: 'kumi-0001-ab', template: '標準仕様書', ops: [
    { op: 'date', no: a[0].no, todo: a[0].todo, date: '2026-12-02' },
    { op: 'edit', no: a[0].no, todo: a[0].todo, ko: 1.5, detail: 'メモ →◆藤井さんへ提案' },
    { op: 'add', parent: '仕様書テンプレ', todo: '再販向けの注意書き', ko: 1.5, date: '2026-12-03', detail: '今回だけ' }
  ] });
  assert.ok(r.ok, JSON.stringify(r)); assert.strictEqual(r.changed, 2); assert.strictEqual(r.added, 1);
  const after = ctx.taskApi_readAll(sh, ctx.taskApi_cols(sh));
  const x = after.find(y => y.no === a[0].no);
  assert.strictEqual(x.date, '2026-12-02'); assert.strictEqual(x.ko, 1.5); assert.strictEqual(x.detail, 'メモ →◆藤井さんへ提案');
  const nw = after.find(y => y.todo === '仕様書テンプレ | 再販向けの注意書き');
  assert.ok(nw && nw.pj === '例）案件A' && nw.date === '2026-12-03');
  assert.deepStrictEqual(after.filter(y => y.pj !== '例）案件A').map(y => y.no + '|' + y.todo + '|' + y.date).sort(), other, 'ほかの案件は変わらない');
  // 同じ reqId は二重にしない
  assert.strictEqual(call({ key: KEY, action: 'kumitate', pj: '例）案件A', reqId: 'kumi-0001-ab', ops: [{ op: 'add', todo: 'x', ko: 1 }] }).added, 1);
  assert.strictEqual(ctx.taskApi_readAll(sh, ctx.taskApi_cols(sh)).filter(y => y.todo === 'x').length, 0);
  // 外す → 行は残り、📅が空になって詳細に印。戻すと元に
  const ex = call({ key: KEY, action: 'kumitate', pj: '例）案件A', ops: [{ op: 'exclude', no: nw.no, todo: nw.todo }] });
  assert.ok(ex.ok, JSON.stringify(ex));
  let y = ctx.taskApi_readAll(sh, ctx.taskApi_cols(sh)).find(z => z.no === nw.no);
  assert.ok(y, '行は消さない'); assert.strictEqual(y.date, ''); assert.ok(y.detail.startsWith('🚫外す'));
  call({ key: KEY, action: 'kumitate', pj: '例）案件A', ops: [{ op: 'restore', no: nw.no, todo: nw.todo, date: '2026-12-04' }] });
  y = ctx.taskApi_readAll(sh, ctx.taskApi_cols(sh)).find(z => z.no === nw.no);
  assert.strictEqual(y.date, '2026-12-04'); assert.strictEqual(y.detail, '今回だけ');
  assert.strictEqual(call({ key: KEY, action: 'tmplList' }).pjTemplate['例）案件A'], '標準仕様書');
  // ⛓の印は消させない
  sh.cell(x.row, 11).v = '📋工程表 ⛓1_kvC8TW:12';
  assert.strictEqual(call({ key: KEY, action: 'kumitate', pj: '例）案件A', ops: [{ op: 'edit', no: x.no, todo: x.todo, detail: 'なし' }] }).error, 'keep_link');
});
t('kumitate：工程表連動（⛓）の行は、工程表の開始日・終了日・集計対象もそろえる（数式のセルは書かない）', () => {
  const ss = ctx.SpreadsheetApp.openById('1all9BRCbemXapdhjBidydCAjPbw26pNmmyi0wbxk66Q');
  const kb = { sheets: {}, getSheetByName(n) { return this.sheets[n] || null; } };
  const ks = new (makeGas.SheetClass || ss.sheets['_日次ガントチャート'].constructor)('工程表', kb); kb.sheets['工程表'] = ks;
  ['No', '親タスク', '詳細', '担当', '期間(週)', '開始日', '終了日', '福田工数(h)', '集計対象'].forEach((h, i) => { ks.cell(7, i + 1).v = h; });
  [[11, '設問', 'a', '福田', 1, '', '', 2, 1], [12, '設問', 'b', '福田', 1, '', '', 1, 1]].forEach((r, j) => r.forEach((v, i) => { ks.cell(8 + j, i + 1).v = v; }));
  ks.cell(9, 7).f = '=F9+7';   // 終了日が数式の行
  const real = ctx.SpreadsheetApp.openById;
  ctx.SpreadsheetApp.openById = id => id === '1_kvC8TWc3dJ2w2uPX2g1NUjP8UZBUNRpL-ZfW45x4m8' ? kb : real(id);
  const x = ctx.taskApi_readAll(sh, ctx.taskApi_cols(sh)).find(z => z.detail.indexOf('⛓1_kvC8TW:12') >= 0);
  const r = call({ key: KEY, action: 'kumitate', pj: x.pj, ops: [{ op: 'date', no: x.no, todo: x.todo, date: '2026-12-08' }] });
  ctx.SpreadsheetApp.openById = real;
  assert.ok(r.ok, JSON.stringify(r)); assert.strictEqual(r.koutei, 1); assert.strictEqual(r.kouteiSkipped, 1, '数式の終了日は書かない');
  assert.strictEqual(ctx.Utilities.formatDate(ks.peek(9, 6).v, 'Asia/Tokyo', 'yyyy-MM-dd'), '2026-12-08');
  assert.strictEqual(ks.peek(9, 7).f, '=F9+7'); assert.strictEqual(ks.peek(8, 6).v, '', 'ほかの行は変えない');
  sh.cell(x.row, 11).v = '';
});

t('list withPj：案件のガント用の全タスクを同じ読み込みで返す（読むだけ・ロックなし）', () => {
  const before = snap(); sh.writes.length = 0;
  const r = call({ key: KEY, action: 'list', withPj: true });
  assert.ok(r.ok); assert.ok(Array.isArray(r.all) && r.all.length >= r.tasks.length);
  assert.ok(r.all.some(x => x.arc === 1), 'アーカイブも入る');
  assert.deepStrictEqual(snap(), before); assert.strictEqual(sh.writes.length, 0);
  assert.strictEqual(call({ key: KEY, action: 'list' }).all, undefined, 'withPj なしでは付けない');
});

t('案件の並び順：週次シートのA列（5行目から）の順を返す', () => {
  const ss = ctx.SpreadsheetApp.openById('1all9BRCbemXapdhjBidydCAjPbw26pNmmyi0wbxk66Q');
  const w = ss.insertSheet('_週次ガントチャート');
  w.cell(4, 1).v = '案件名'; ['例）案件C', '例）案件A', '', '例）案件A', '例）案件B'].forEach((v, i) => { w.cell(5 + i, 1).v = v; });
  const r = call({ key: KEY, action: 'list', withPj: true });
  assert.deepStrictEqual(r.pjOrder, ['例）案件C', '例）案件A', '例）案件B']);
  assert.deepStrictEqual(call({ key: KEY, action: 'pj' }).pjOrder, ['例）案件C', '例）案件A', '例）案件B']);
});

t('段階の列がある表：段階と ToDo を分けて読み書きする（ない表は従来どおり「段階 | 子」）', () => {
  const g = makeGas(); const sh2 = g.sh;
  const heads = ['No', '完了', 'PJ', '段階', 'ToDo｜全部表示', '詳細', '工', '実働', '📅', '', '⏰', '👤', '前提', '✔日', '10/30'];
  heads.forEach((h, i) => { sh2.cell(1, i + 1).v = h; });
  sh2.cell(4, 2).v = false;
  [[5, [1, false, '細溝邸', 'プラン①', 'たたき台作成', '', 1, '', new Date(2026, 9, 30), '', '🌅', '', '', '']]].forEach(([r, vals]) => vals.forEach((v, i) => { sh2.cell(r, i + 1).v = v; }));
  g.ctx.taskApiSetup(); const K2 = g.props.TASK_API_KEY;
  const l = g.call({ key: K2, action: 'list', withPj: true });
  assert.ok(l.ok, JSON.stringify(l)); assert.strictEqual(l.stageColumn, true);
  assert.strictEqual(l.tasks[0].stage, 'プラン①'); assert.strictEqual(l.tasks[0].todo, 'たたき台作成');
  assert.strictEqual(l.all[0].stage, 'プラン①');
  const a = g.call({ key: K2, action: 'add', pj: '細溝邸', parent: 'プラン②', todo: '修正案', ko: 1, date: '2026-10-30', slot: '朝' });
  assert.ok(a.ok, JSON.stringify(a)); assert.strictEqual(a.task.stage, 'プラン②'); assert.strictEqual(a.task.todo, '修正案');
  const k = g.call({ key: K2, action: 'kumitate', pj: '細溝邸', ops: [{ op: 'edit', no: 1, todo: 'たたき台作成', stage: 'プラン②' }] });
  assert.ok(k.ok, JSON.stringify(k));
  const after = g.call({ key: K2, action: 'list' }).tasks.find(x => x.no === 1);
  assert.strictEqual(after.stage, 'プラン②'); assert.strictEqual(after.todo, 'たたき台作成');
  const d = g.call({ key: K2, action: 'done', no: 1, todo: 'たたき台作成' });
  assert.ok(d.ok); assert.ok(sh2.peek(after.row, 14).v instanceof Date, '✔日に完了日が入る');
});
console.log(`\n${passed} passed`);
