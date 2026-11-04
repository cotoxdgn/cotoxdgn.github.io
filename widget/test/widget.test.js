// widget/kotowidget.js（Scriptable のウィジェット）を node で動かす試験。Scriptable の部品（Request・ListWidget など）はまねして作る
// 実行：TZ=Asia/Tokyo node widget/test/widget.test.js
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'kotowidget.js'), 'utf8');
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

const R_URL = 'https://script.google.com/macros/s/ROUTINE/exec', R_KEY = 'vwroutine', T_URL = 'https://script.google.com/macros/s/TASK/exec', T_KEY = 'vwtask';

// ---------- Scriptable のまね ----------
function makeEnv(opts) {
  const files = opts.files || {};
  const sent = [];
  const out = { widget: null, presented: null, completed: false, sent, files };
  class Color { constructor(hex) { this.hex = hex; } static dynamic(a, b) { return { light: a, dark: b }; } }
  const Font = { systemFont: n => ({ n }), semiboldSystemFont: n => ({ n, b: 1 }), boldSystemFont: n => ({ n, b: 1 }) };
  class Stack {
    constructor() { this.items = []; }
    addText(s) { if (typeof s !== 'string') throw new Error('addText needs string: ' + s); const t = { type: 'text', text: s }; this.items.push(t); return t; }
    addSpacer(n) { this.items.push({ type: 'spacer', n }); }
    addStack() { const s = new Stack(); this.items.push(s); return s; }
    layoutHorizontally() {} layoutVertically() {} topAlignContent() {} bottomAlignContent() {} centerAlignContent() {}
    setPadding() {}
    texts() { return this.items.flatMap(x => x instanceof Stack ? x.texts() : x.type === 'text' ? [x.text] : []); }
  }
  class ListWidget extends Stack {
    presentMedium() { out.presented = 'medium'; return Promise.resolve(); }
    presentSmall() { out.presented = 'small'; return Promise.resolve(); }
    presentLarge() { out.presented = 'large'; return Promise.resolve(); }
  }
  class Request {
    constructor(url) { this.url = url; }
    async loadJSON() {
      assert.strictEqual(this.method, 'POST');
      assert.strictEqual(this.headers['Content-Type'], 'text/plain');
      const body = JSON.parse(this.body);
      sent.push({ url: this.url, body });
      const h = opts.respond[this.url];
      if (!h) throw new Error('no route ' + this.url);
      return h(body);
    }
  }
  const FileManager = {
    local: () => ({
      documentsDirectory: () => '/docs',
      joinPath: (a, b) => a + '/' + b,
      fileExists: p => p in files,
      readString: p => files[p],
      writeString: (p, s) => { files[p] = s; }
    })
  };
  const Script = { setWidget: w => { out.widget = w; }, complete: () => { out.completed = true; } };
  const config = { runsInWidget: opts.inWidget !== false, widgetFamily: opts.family || 'medium' };
  const RealDate = Date;
  const now = RealDate.parse(opts.now || '2026-11-04T12:30:00+09:00');
  class FakeDate extends RealDate {
    constructor(...a) { if (a.length === 0) super(now); else super(...a); }
    static now() { return now; }
  }
  return { out, globals: { Color, Font, ListWidget, Request, FileManager, Script, config, Date: FakeDate } };
}

async function run(src, opts) {
  const env = makeEnv(opts);
  const names = Object.keys(env.globals);
  await new AsyncFunction(...names, src)(...names.map(n => env.globals[n]));
  const w = env.out.widget || env.out.lastWidget;
  return Object.assign(env.out, { texts: w ? w.texts() : [] });
}
// 4つの値を貼ったスクリプト
const configured = SRC.replace("routineUrl: ''", `routineUrl: '${R_URL}'`).replace("routineKey: ''", `routineKey: '${R_KEY}'`)
  .replace("taskUrl: ''", `taskUrl: '${T_URL}'`).replace("taskKey: ''", `taskKey: '${T_KEY}'`);
assert.notStrictEqual(configured, SRC);

// ---------- にせの返事 ----------
const TASKS = {
  ok: true, today: '2026-11-04', tasks: [
    { todo: '夕方のタスク', pj: 'A', date: '2026-11-04', slot: '夕', wait: false, preWait: false, done: false },
    { todo: '前提待ちの持ち越し', pj: 'A', date: '2026-10-30', slot: '朝', wait: false, preWait: true, done: false },
    { todo: '朝のタスク', pj: 'B', date: '2026-11-04', slot: '朝', wait: false, preWait: false, done: false },
    { todo: '山田さん待ち', pj: 'B', date: '2026-11-04', slot: '朝', wait: true, preWait: false, done: false },
    { todo: '古い持ち越し', pj: 'C', date: '2026-10-28', slot: '', wait: false, preWait: false, done: false },
    { todo: '時間帯なし', pj: 'C', date: '2026-11-04', slot: '', wait: false, preWait: false, done: false }
  ]
};
const ROUTINE = { ok: true, now: 'x', today: '2026-11-04', streak: 3,
  habits: [{ name: 'サプリを飲んだ', done: true }, { name: 'ストレッチを10分する', done: false }],
  period: { ongoing: false, start: '', day: 0, next: '2026-11-06', until: 2, late: 0 } };
const good = { [T_URL]: b => { assert.strictEqual(b.key, T_KEY); assert.strictEqual(b.action, 'widget'); return TASKS; },
  [R_URL]: b => { assert.strictEqual(b.key, R_KEY); assert.strictEqual(b.action, 'widget'); return ROUTINE; } };
const fail = { [T_URL]: () => { throw new Error('offline'); }, [R_URL]: () => { throw new Error('offline'); } };

let passed = 0;
async function t(name, fn) { await fn(); passed++; console.log('ok -', name); }
const has = (r, s) => assert.ok(r.texts.some(x => x.includes(s)), s + ' がない：' + JSON.stringify(r.texts));
const hasNot = (r, s) => assert.ok(!r.texts.some(x => x.includes(s)), s + ' がある：' + JSON.stringify(r.texts));

(async () => {
  await t('未設定：設定の案内を出す（通信しない）', async () => {
    const r = await run(SRC, { respond: {} });
    assert.ok(r.completed && r.widget);
    has(r, 'ウィジェットの準備'); has(r, 'CONFIG');
    assert.strictEqual(r.sent.length, 0);
  });

  const files = {};
  await t('中サイズ：件数・上から3つ（アプリと同じ順・待ちは除く）・持ち越し・習慣の○×・連続・生理', async () => {
    const r = await run(configured, { respond: good, files });
    assert.ok(r.completed);
    assert.strictEqual(r.sent.length, 2);
    assert.ok(r.widget.refreshAfterDate instanceof Date);
    assert.strictEqual(r.widget.refreshAfterDate - Date.parse('2026-11-04T12:30:00+09:00'), 20 * 60000);
    assert.strictEqual(r.widget.url, undefined, '押しても何も開かない');
    has(r, 'タスク表'); has(r, 'ルーティン');
    assert.ok(r.texts.includes('6'), '未完了6件');
    has(r, '持ち越し 2');
    const tops = r.texts.filter(x => x.startsWith('・'));
    assert.deepStrictEqual(tops, ['・古い持ち越し', '・朝のタスク', '・夕方のタスク']);
    hasNot(r, '山田さん待ち'); hasNot(r, '前提待ちの持ち越し');
    assert.ok(r.texts.includes('○') && r.texts.includes('×'));
    has(r, 'サプリを飲んだ'); has(r, 'ストレッチを10…'); has(r, '連続 3日'); has(r, '生理 あと2日');
    hasNot(r, '更新できませんでした');
    assert.ok(Object.keys(files).length === 1, 'キャッシュを保存');
  });

  await t('どちらも読めない：前の内容を出し「更新できませんでした HH:MM」', async () => {
    const r = await run(configured, { respond: fail, files, now: '2026-11-04T13:05:00+09:00' });
    assert.ok(r.completed);
    has(r, '持ち越し 2'); has(r, '連続 3日'); has(r, '生理 あと2日');
    has(r, '更新できませんでした 13:05');
  });

  await t('片方だけ読めない：もう片方は新しい内容。注意はその片方だけ', async () => {
    const r = await run(configured, { respond: { [T_URL]: () => ({ ok: false, error: 'busy' }), [R_URL]: good[R_URL] }, files, now: '2026-11-04T13:10:00+09:00' });
    has(r, 'タスク表：更新できませんでした 13:10');
    hasNot(r, 'ルーティン：更新');
    has(r, '生理 あと2日');
  });

  await t('前の内容が無いまま読めない：「読み込めませんでした」と理由（合言葉違いなど）', async () => {
    const r = await run(configured, { respond: { [T_URL]: () => ({ ok: false, error: 'bad_key' }), [R_URL]: () => { throw new Error('x'); } }, files: {} });
    assert.ok(r.completed);
    has(r, '読み込めませんでした'); has(r, '合言葉が違います'); has(r, 'つながりません');
  });

  await t('前の内容が昨日の分：○×は出さず日付を添える。生理の「あと○日」は今日で数え直す', async () => {
    const r = await run(configured, { respond: fail, files, now: '2026-11-05T09:00:00+09:00' });
    assert.ok(!r.texts.includes('○'), '昨日の○は今日の○にしない');
    has(r, '（11/4 の記録）'); has(r, '生理 あと1日');
  });

  await t('深夜3時まではルーティンの前の日（2:30 は 11/4 のまま）', async () => {
    const r = await run(configured, { respond: { [T_URL]: good[T_URL], [R_URL]: good[R_URL] }, files: {}, now: '2026-11-05T02:30:00+09:00' });
    assert.ok(r.texts.includes('○')); hasNot(r, 'の記録）'); has(r, '生理 あと2日');
  });

  await t('生理：記録中は「○日目」、予定日を過ぎたら「予定日から○日」、今日なら「今日」', async () => {
    const mk = p => ({ [T_URL]: good[T_URL], [R_URL]: () => Object.assign({}, ROUTINE, { period: p }) });
    let r = await run(configured, { respond: mk({ ongoing: true, start: '2026-11-02', day: 3, next: '2026-11-30', until: 26, late: 0 }), files: {} });
    has(r, '生理 3日目');
    r = await run(configured, { respond: mk({ ongoing: false, start: '', day: 0, next: '2026-11-01', until: -3, late: 3 }), files: {} });
    has(r, '生理 予定日から3日');
    r = await run(configured, { respond: mk({ ongoing: false, start: '', day: 0, next: '2026-11-04', until: 0, late: 0 }), files: {} });
    has(r, '生理 今日');
    r = await run(configured, { respond: mk(null), files: {} });
    hasNot(r, '生理');
  });

  await t('小さいサイズ・大きいサイズ・ロック画面でも動く', async () => {
    let r = await run(configured, { respond: good, files: {}, family: 'small' });
    has(r, 'タスク 6件'); has(r, '習慣 1/2　連続 3日'); has(r, '生理 あと2日');
    r = await run(configured, { respond: good, files: {}, family: 'large' });
    has(r, 'ストレッチを10分する'); has(r, '持ち越し 2');
    r = await run(configured, { respond: good, files: {}, family: 'accessoryRectangular' });
    has(r, 'タスク6 習慣1/2 生理あと2日');
  });

  await t('片方だけ設定：設定した方は出す。もう片方は「未設定」', async () => {
    const half = SRC.replace("taskUrl: ''", `taskUrl: '${T_URL}'`).replace("taskKey: ''", `taskKey: '${T_KEY}'`);
    const r = await run(half, { respond: good, files: {} });
    has(r, '持ち越し 2'); has(r, '未設定');
  });

  await t('待ちだけ・0件', async () => {
    const only = { [T_URL]: () => ({ ok: true, today: '2026-11-04', tasks: [TASKS.tasks[3]] }), [R_URL]: good[R_URL] };
    let r = await run(configured, { respond: only, files: {} });
    has(r, '待ちのタスクだけです');
    r = await run(configured, { respond: { [T_URL]: () => ({ ok: true, today: '2026-11-04', tasks: [] }), [R_URL]: good[R_URL] }, files: {} });
    has(r, '今日のタスクはありません'); hasNot(r, '持ち越し');
  });

  await t('アプリの中で実行：中サイズの見本を出す', async () => {
    const r = await run(configured, { respond: good, files: {}, inWidget: false });
    assert.strictEqual(r.presented, 'medium'); assert.ok(r.completed);
  });

  await t('キャッシュが壊れていても動く', async () => {
    const r = await run(configured, { respond: fail, files: { '/docs/koto-widget-cache.json': '{壊れた' } });
    assert.ok(r.completed); has(r, '読み込めませんでした');
  });

  console.log(`\n${passed} 件 すべて成功`);
})().catch(e => { console.error(e); process.exit(1); });
