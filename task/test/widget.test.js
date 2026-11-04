// task/gas/TaskApi.gs のウィジェット用（widget・見るだけ用の合言葉 TASK_VIEW_KEY）の単体テスト
// 実行：TZ=Asia/Tokyo node task/test/widget.test.js
'use strict';
const assert = require('assert');
const makeGas = require('./gas-mock');
const { ctx, sh, call, props } = makeGas();
makeGas.fillExample(sh);

let passed = 0;
function t(name, fn) { fn(); passed++; console.log('ok -', name); }
const snap = () => JSON.stringify(sh.rows.map(row => row.map(x => [x.v instanceof Date ? x.v.toISOString() : x.v, x.f, x.fmt, x.dv])));

t('taskApiSetup 前は見るだけ用の合言葉があっても no_setup', () => {
  props.TASK_VIEW_KEY = 'vwtest';
  assert.strictEqual(call({ key: 'vwtest', action: 'widget' }).error, 'no_setup');
  delete props.TASK_VIEW_KEY;
});
ctx.taskApiSetup();
const KEY = props.TASK_API_KEY;

t('taskApiShowViewKey：見るだけ用の合言葉を作って実行ログに出す。2回目は同じ。シートには書かない', () => {
  const before = snap();
  ctx.__logs = [];
  ctx.taskApiShowViewKey();
  const v = props.TASK_VIEW_KEY;
  assert.ok(v && v.length >= 24 && v !== KEY);
  assert.ok(ctx.__logs.join('\n').includes(v));
  assert.ok(ctx.__logs.join('\n').includes('https://script.google.com/macros/s/TEST/exec'));
  ctx.taskApiShowViewKey();
  assert.strictEqual(props.TASK_VIEW_KEY, v);
  assert.strictEqual(props.TASK_API_KEY, KEY, 'いつもの合言葉は変わらない');
  assert.strictEqual(snap(), before);
});
let VKEY = props.TASK_VIEW_KEY;

t('widget：見るだけ用の合言葉で、今日の未完了（持ち越し含む）だけ。決まった項目だけ返す', () => {
  const before = snap(); sh.writes.length = 0;
  const r = call({ key: VKEY, action: 'widget' });
  assert.ok(r.ok, JSON.stringify(r));
  assert.strictEqual(r.today, '2026-10-30');
  assert.deepStrictEqual(r.tasks, [
    { todo: '見積書の確認 | 設備項目', pj: '例）案件A', date: '2026-10-28', slot: '朝', wait: false, preWait: false, done: false },
    { todo: 'プレゼン構成 | 目次を作る', pj: '例）案件B', date: '2026-10-30', slot: '朝', wait: true, preWait: true, done: false }
  ]);
  assert.deepStrictEqual(Object.keys(r).sort(), ['ok', 'tasks', 'today']);
  assert.strictEqual(snap(), before); assert.strictEqual(sh.writes.length, 0, '読むだけ');
});

t('widget：詳細・👤の名前・前提の中身・No・行・候補の一覧は入れない', () => {
  const s = JSON.stringify(call({ key: VKEY, action: 'widget' }));
  ['example.com', '山田', '12.見積書', '10.メール', 'メール返信', '現場写真', '古い完了', 'preOptions', 'people', 'projects', '"row"', '"no"', 'detail', 'actual'].forEach(w => assert.ok(!s.includes(w), w));
});

t('見るだけ用の合言葉では widget 以外はすべて断る（合言葉違いと同じ答え）。シートは変わらない', () => {
  const before = snap();
  for (const action of ['ping', 'list', 'add', 'done', 'undone', 'actual', 'setWait', 'zzz', undefined]) {
    const r = call({ key: VKEY, action, no: 11, todo: 'プレゼン構成 | 目次を作る', ko: 1, date: '2026-10-31', actual: 1, wait: 'x', reqId: 'req-view-0001' });
    assert.deepStrictEqual(r, { ok: false, error: 'bad_key' }, String(action));
  }
  assert.strictEqual(snap(), before);
});

t('いつもの合言葉：widget も使える。ほかの action はこれまでどおり', () => {
  const w = call({ key: KEY, action: 'widget' });
  assert.ok(w.ok); assert.strictEqual(w.tasks.length, 2);
  const l = call({ key: KEY, action: 'list' });
  assert.ok(l.ok); assert.deepStrictEqual(l.tasks.map(x => x.no), [12, 11, 10]);
  assert.ok(Array.isArray(l.preOptions) && Array.isArray(l.people));
  assert.ok(call({ key: KEY, action: 'ping' }).ok);
  assert.strictEqual(call({ key: 'wrong', action: 'widget' }).error, 'bad_key');
  assert.strictEqual(call({ key: '', action: 'widget' }).error, 'bad_key');
});

t('widget：完了にしたら消える。前提が完了したら preWait が外れる', () => {
  const r = call({ key: KEY, action: 'done', no: 12, todo: '見積書の確認 | 設備項目' });
  assert.ok(r.ok, JSON.stringify(r));
  const w = call({ key: VKEY, action: 'widget' });
  assert.deepStrictEqual(w.tasks.map(x => [x.todo, x.preWait]), [['プレゼン構成 | 目次を作る', false]]);
  assert.ok(call({ key: KEY, action: 'undone', no: 12, todo: '見積書の確認 | 設備項目' }).ok);
});

t('taskApiRenewViewKey：作り直すと古い合言葉は使えない', () => {
  ctx.__logs = [];
  ctx.taskApiRenewViewKey();
  const n = props.TASK_VIEW_KEY;
  assert.ok(n && n !== VKEY && n !== KEY);
  assert.ok(ctx.__logs.join('\n').includes(n));
  assert.strictEqual(call({ key: VKEY, action: 'widget' }).error, 'bad_key');
  assert.ok(call({ key: n, action: 'widget' }).ok);
  VKEY = n;
});

t('見るだけ用の合言葉がいつもの合言葉と同じ値（手で入れた等）なら、見るだけ扱いにしない', () => {
  props.TASK_VIEW_KEY = KEY;
  assert.ok(call({ key: KEY, action: 'list' }).ok, 'いつもの合言葉として全部使える');
  ctx.taskApiShowViewKey();
  assert.notStrictEqual(props.TASK_VIEW_KEY, KEY, 'ShowViewKey で別の値に作り直す');
});

t('スプシに付いたプロジェクトでは taskApiShowViewKey / taskApiRenewViewKey を中止（何も作らない）', () => {
  const g2 = makeGas(); makeGas.fillExample(g2.sh);
  g2.ctx.SpreadsheetApp.getActiveSpreadsheet = () => g2.ss;
  g2.ctx.__logs = [];
  g2.ctx.taskApiShowViewKey(); g2.ctx.taskApiRenewViewKey();
  assert.strictEqual(g2.props.TASK_VIEW_KEY, undefined);
  assert.strictEqual(g2.ctx.__logs.length, 2);
  assert.ok(g2.ctx.__logs.every(l => l.includes('このプロジェクトはスプシに付いています')));
});

console.log(`\n${passed} passed`);
