// widget/kotowidget.js（Scriptable のウィジェット）を node で動かす試験。Scriptable の部品（Request・ListWidget・SFSymbol など）はまねして作る
// 実行：TZ=Asia/Tokyo node widget/test/widget.test.js
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'kotowidget.js'), 'utf8');
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

const R_URL = 'https://script.google.com/macros/s/ROUTINE/exec', R_KEY = 'vwroutine';
const T_URL = 'https://script.google.com/macros/s/TASK/exec', T_KEY = 'vwtask';
const W_URL = 'https://script.google.com/macros/s/WANKO/exec', W_KEY = 'vwwanko';
const WX = 'https://api.open-meteo.com/v1/forecast?';

// ---------- Scriptable のまね ----------
function makeEnv(opts) {
  const files = opts.files || {};
  const sent = [];
  const out = { widget: null, presented: [], completed: false, sent, files };
  class Color { constructor(hex) { this.hex = hex; } static dynamic(a, b) { return { light: a, dark: b }; } }
  const Font = {};
  ['systemFont', 'mediumSystemFont', 'semiboldSystemFont', 'boldSystemFont', 'lightSystemFont', 'semiboldRoundedSystemFont', 'lightRoundedSystemFont']
    .forEach(n => { Font[n] = size => ({ n: size, name: n, bold: /bold/i.test(n) && !/semibold/i.test(n), semibold: /semibold/i.test(n) }); });
  class Size { constructor(w, h) { this.w = w; this.h = h; } }
  class Stack {
    constructor() { this.items = []; }
    addText(s) {
      if (typeof s !== 'string') throw new Error('addText needs string: ' + s);
      const t = { type: 'text', text: s, rightAlignText() { this.align = 'right'; }, centerAlignText() { this.align = 'center'; } };
      this.items.push(t); return t;
    }
    addSpacer(n) { this.items.push({ type: 'spacer', n }); }
    addStack() { const s = new Stack(); this.items.push(s); return s; }
    addImage(img) { if (!img || !img.sym) throw new Error('addImage needs image'); const i = { type: 'image', sym: img.sym }; this.items.push(i); return i; }
    layoutHorizontally() {} layoutVertically() {} topAlignContent() {} bottomAlignContent() {} centerAlignContent() {}
    setPadding() {}
    all() { return this.items.flatMap(x => x instanceof Stack ? x.all() : [x]); }
    texts() { return this.all().filter(x => x.type === 'text').map(x => x.text); }
  }
  class ListWidget extends Stack {
    presentMedium() { out.presented.push('medium'); out.lastWidget = this; return Promise.resolve(); }
    presentSmall() { out.presented.push('small'); out.lastWidget = this; return Promise.resolve(); }
    presentLarge() { out.presented.push('large'); out.previewLarge = this; return Promise.resolve(); }
  }
  class Request {
    constructor(url) { this.url = url; }
    async loadJSON() {
      if (this.url.startsWith(WX)) {
        assert.strictEqual(this.method, 'GET');
        ['latitude=34.6937', 'longitude=135.5023', 'hourly=temperature_2m,precipitation_probability,weather_code',
          'daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max,weather_code', 'current=temperature_2m,weather_code', 'timezone=Asia%2FTokyo']
          .forEach(q => assert.ok(this.url.includes(q), q));
        sent.push({ url: 'weather' });
        if (opts.weather === false) throw new Error('offline');
        return (opts.weather || weather)();
      }
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
  const SFSymbol = { named: n => (n ? { image: { sym: n }, applyFont() {} } : null) };
  const Device = { screenSize: () => ({ width: 393, height: 852 }) };
  const Script = { setWidget: w => { out.widget = w; }, complete: () => { out.completed = true; } };
  const config = { runsInWidget: opts.inWidget !== false, widgetFamily: opts.family || 'medium' };
  const RealDate = Date;
  const now = RealDate.parse(opts.now || '2026-11-05T10:30:00+09:00');
  class FakeDate extends RealDate {
    constructor(...a) { if (a.length === 0) super(now); else super(...a); }
    static now() { return now; }
  }
  return { out, globals: { Color, Font, Size, ListWidget, Request, FileManager, SFSymbol, Device, Script, config, Date: FakeDate } };
}

async function run(src, opts) {
  const env = makeEnv(opts);
  const names = Object.keys(env.globals);
  await new AsyncFunction(...names, src)(...names.map(n => env.globals[n]));
  const w = env.out.widget || env.out.lastWidget;
  const items = w ? w.all() : [];
  return Object.assign(env.out, { items, texts: w ? w.texts() : [], syms: items.filter(x => x.type === 'image').map(x => x.sym) });
}
const ALL = { routineUrl: R_URL, routineKey: R_KEY, taskUrl: T_URL, taskKey: T_KEY, wankoUrl: W_URL, wankoKey: W_KEY };
// 値を貼ったスクリプト（貼らない所は空のまま）
function withConfig(vals) {
  let s = SRC;
  Object.keys(vals).forEach(k => { const n = s.replace(`${k}: ''`, `${k}: '${vals[k]}'`); assert.notStrictEqual(n, s, k); s = n; });
  return s;
}
const configured = withConfig(ALL);

// ---------- にせの返事 ----------
const TASKS = {
  ok: true, today: '2026-11-05', tomorrowDate: '2026-11-06', tasks: [
    { todo: '夕方のタスク', pj: 'A', date: '2026-11-05', slot: '夕', wait: false, preWait: false, done: false },
    { todo: '前提待ちの持ち越し', pj: 'A', date: '2026-10-30', slot: '朝', wait: false, preWait: true, done: false },
    { todo: '朝のタスク', pj: 'B', date: '2026-11-05', slot: '朝', wait: false, preWait: false, done: false },
    { todo: '山田さん待ち', pj: 'B', date: '2026-11-05', slot: '朝', wait: true, preWait: false, done: false },
    { todo: '古い持ち越し', pj: 'C', date: '2026-10-28', slot: '', wait: false, preWait: false, done: false },
    { todo: '時間帯なし', pj: 'C', date: '2026-11-05', slot: '', wait: false, preWait: false, done: false },
    { todo: '昼のタスク', pj: 'C', date: '2026-11-05', slot: '昼', wait: false, preWait: false, done: false },
    { todo: 'もう一つ', pj: 'C', date: '2026-11-05', slot: '', wait: false, preWait: false, done: false }
  ],
  tomorrow: [
    { todo: '明日の夕方', pj: 'A', date: '2026-11-06', slot: '夕', wait: false, preWait: false, done: false },
    { todo: '明日の待ち', pj: 'A', date: '2026-11-06', slot: '朝', wait: true, preWait: false, done: false },
    { todo: '明日の朝', pj: 'A', date: '2026-11-06', slot: '朝', wait: false, preWait: false, done: false }
  ]
};
const J = s => new Date(s + '+09:00').toISOString();
const EVENTS = [
  { title: '朝会', start: J('2026-11-05T08:00:00'), end: J('2026-11-05T09:00:00'), allDay: false, color: '' },
  { title: '現場 引渡し', start: J('2026-11-05T10:00:00'), end: J('2026-11-05T12:00:00'), allDay: false, color: '2' },
  { title: '打合せ（仕様確認）', start: J('2026-11-05T15:00:00'), end: J('2026-11-05T16:00:00'), allDay: false, color: '9' },
  { title: '母の誕生日', start: '2026-11-05', end: '2026-11-06', allDay: true, color: '4' },
  { title: '見積提出〆', start: J('2026-11-05T17:30:00'), end: J('2026-11-05T18:00:00'), allDay: false, color: '5' },
  { title: 'ジム', start: J('2026-11-05T19:00:00'), end: J('2026-11-05T20:00:00'), allDay: false, color: '1' },
  { title: '歯医者', start: J('2026-11-06T09:30:00'), end: J('2026-11-06T10:30:00'), allDay: false, color: '11' },
  { title: '打合せ', start: J('2026-11-06T13:00:00'), end: J('2026-11-06T14:00:00'), allDay: false, color: '' },
  { title: '現場 立会い', start: J('2026-11-06T16:00:00'), end: J('2026-11-06T17:00:00'), allDay: false, color: '2' }
];
const ROUTINE = { ok: true, now: 'x', today: '2026-11-05', streak: 3,
  habits: [{ name: 'サプリを飲んだ', done: true }, { name: 'ストレッチを10分する', done: false }],
  period: { ongoing: false, start: '', day: 0, next: '2026-11-07', until: 2, late: 0 },
  events: EVENTS,
  brain: { count: 128, latest: [
    { kind: 'H', no: 34, title: '造作収納は「使う場所の50cm以内」に置くと定位置が続く', at: '2026-11-04T12:00:00.000Z' },
    { kind: 'M', no: null, title: 'ラワン合板の小口', at: '2026-11-03T12:00:00.000Z' }] } };
const WANKO = { ok: true, now: 'x', wanko: { today: '2026-11-05', dogs: [{ name: 'ポチ', done: true }, { name: '', done: false }] } };
// 大阪の天気（11/4 0時から72時間。気温＝10＋時÷2、0〜5時 晴れ(1)・6〜11時 快晴(0)・12〜17時 晴れ時々くもり(2)・18時〜 小雨(61)）
function weather() {
  const time = [], temp = [], rain = [], code = [];
  for (let i = 0; i < 72; i++) {
    const d = 4 + Math.floor(i / 24), h = i % 24;
    time.push(`2026-11-0${d}T${String(h).padStart(2, '0')}:00`);
    temp.push(10 + h / 2); rain.push(h >= 18 ? 70 : 10); code.push(h < 6 ? 1 : h < 12 ? 0 : h < 18 ? 2 : 61);
  }
  return { current: { time: '2026-11-05T10:30', temperature_2m: 16.4, weather_code: 0 },
    hourly: { time, temperature_2m: temp, precipitation_probability: rain, weather_code: code },
    daily: { time: ['2026-11-04', '2026-11-05', '2026-11-06'], temperature_2m_max: [19, 20, 21], temperature_2m_min: [11, 12, 13],
      precipitation_probability_max: [20, 30, 10], weather_code: [2, 3, 61] } };
}
const good = {
  [T_URL]: b => { assert.strictEqual(b.key, T_KEY); assert.strictEqual(b.action, 'widget'); return TASKS; },
  [R_URL]: b => { assert.strictEqual(b.key, R_KEY); assert.strictEqual(b.action, 'widget'); return ROUTINE; },
  [W_URL]: b => { assert.strictEqual(b.key, W_KEY); assert.strictEqual(b.action, 'widget'); return WANKO; }
};
const down = () => { throw new Error('offline'); };
const fail = { [T_URL]: down, [R_URL]: down, [W_URL]: down };
const routineWith = extra => Object.assign({}, good, { [R_URL]: () => Object.assign({}, ROUTINE, extra) });

let passed = 0;
async function t(name, fn) { await fn(); passed++; console.log('ok -', name); }
const has = (r, s) => assert.ok(r.texts.some(x => x.includes(s)), s + ' がない：' + JSON.stringify(r.texts));
const hasNot = (r, s) => assert.ok(!r.texts.some(x => x.includes(s)), s + ' がある：' + JSON.stringify(r.texts));
const item = (r, s) => { const x = r.items.find(i => i.type === 'text' && i.text === s); assert.ok(x, s + ' がない：' + JSON.stringify(r.texts)); return x; };
const urls = r => r.sent.map(x => x.url).sort();

(async () => {
  await t('未設定（6つとも空）：設定の案内を出す（どこにも通信しない）', async () => {
    for (const family of ['large', 'medium', 'small']) {
      const r = await run(SRC, { respond: {}, family });
      assert.ok(r.completed && r.widget);
      has(r, 'ウィジェットの準備'); has(r, 'CONFIG に6つ');
      assert.strictEqual(r.sent.length, 0, family);
    }
  });

  const files = {};
  await t('大（昼）：日付・天気（今・最高最低・降水・3時間ごと6つ）・予定（今の予定は太字・終わった予定は出さない・明日の最初）・タスク5つ（持越の印）', async () => {
    const r = await run(configured, { respond: good, files, family: 'large' });
    assert.ok(r.completed);
    assert.deepStrictEqual(urls(r), [R_URL, T_URL, W_URL, 'weather'].sort(), '大は全部読む');
    assert.strictEqual(r.widget.refreshAfterDate - Date.parse('2026-11-05T10:30:00+09:00'), 15 * 60000);
    assert.strictEqual(r.widget.url, undefined, '押しても Scriptable が開くだけ');
    has(r, '11.5'); has(r, '木曜日・大阪');
    has(r, '16°'); has(r, '最高 20° / 最低 12° / 降水 30%'); has(r, 'くもり');
    const slotLabels = r.texts.filter(x => /^\d+時$/.test(x));
    assert.deepStrictEqual(slotLabels, ['11時', '14時', '17時', '20時', '23時', '2時']);
    assert.ok(r.texts.includes('16°') && r.texts.includes('70%'));
    assert.ok(r.syms.includes('sun.max.fill') && r.syms.includes('cloud.rain.fill') && r.syms.includes('moon.stars.fill'), JSON.stringify(r.syms));
    // 予定
    has(r, '予定'); has(r, 'あと5件');
    hasNot(r, '朝会');
    assert.ok(item(r, '現場 引渡し').font.bold, '今やっている予定は太字');
    assert.ok(!item(r, '打合せ（仕様確認）').font.bold);
    const times = r.texts.filter(x => /^\d+:\d\d$|^終日$/.test(x));
    assert.deepStrictEqual(times, ['10:00', '15:00', '17:30', '19:00']);
    has(r, 'ほか1件');
    const order = ['現場 引渡し', '打合せ（仕様確認）', '見積提出〆', 'ジム'].map(s => r.texts.indexOf(s));
    assert.deepStrictEqual(order.slice().sort((a, b) => a - b), order, '時刻順、終日はあと');
    has(r, '明日 9:30 歯医者');
    // タスク
    has(r, 'タスク'); assert.ok(r.texts.includes('8件'));
    const names = ['古い持ち越し', '朝のタスク', '昼のタスク', '夕方のタスク'];
    const idx = names.map(n => r.texts.indexOf(n));
    assert.ok(idx.every(i => i >= 0), JSON.stringify(r.texts));
    assert.deepStrictEqual(idx.slice().sort((a, b) => a - b), idx, 'アプリと同じ順');
    hasNot(r, 'もう一つ'); hasNot(r, '山田さん待ち'); hasNot(r, '前提待ちの持ち越し'); hasNot(r, '明日の朝');
    assert.strictEqual(r.texts.filter(x => x === '持越').length, 1);
    assert.strictEqual(r.texts[r.texts.indexOf('古い持ち越し') + 1], '持越');
    assert.ok(r.texts.includes('🌅') && r.texts.includes('☀️') && r.texts.includes('🌙'));
    has(r, 'ほか2件・待ち2件・明日3件');
    hasNot(r, '更新できませんでした');
    // 下段：ルーティン・歯みがき・脳みそ（大1つに全部）
    has(r, 'ルーティン'); assert.ok(r.texts.includes('日連続')); has(r, '生理 2日後');
    has(r, '歯みがき'); assert.ok(r.texts.includes('ポチ') && r.texts.includes('わんこB'));
    has(r, '脳みそ'); has(r, '全128枚'); has(r, '造作収納は');
    has(r, '10:30 更新');
    const c = JSON.parse(files['/docs/koto-widget-cache.json']);
    assert.deepStrictEqual(Object.keys(c).sort(), ['routine', 'task', 'wanko', 'weather']);
  });

  await t('大（夜 21:40）：明日の予報・3時間ごとは22時から・予定は「今日は終了」で明日の分・タスクは今日の残りと明日', async () => {
    const r = await run(configured, { respond: good, files: {}, family: 'large', now: '2026-11-05T21:40:00+09:00' });
    has(r, 'あす 21° / 13° / 降水 10%'); has(r, 'あす 小雨');
    assert.deepStrictEqual(r.texts.filter(x => /^\d+時$/.test(x)), ['22時', '1時', '4時', '7時', '10時', '13時']);
    has(r, '今日は終了'); assert.ok(r.texts.includes('明日'));
    ['歯医者', '打合せ', '現場 立会い'].forEach(s => assert.ok(r.texts.includes(s), s));
    hasNot(r, 'ジム'); hasNot(r, '母の誕生日');
    assert.deepStrictEqual(r.texts.filter(x => /^\d+:\d\d$/.test(x)), ['9:30', '13:00', '16:00']);
    // タスク：今日の残り2つ＋ほか・待ち、明日（待ちは名前に出さない）
    ['古い持ち越し', '朝のタスク'].forEach(s => assert.ok(r.texts.includes(s), s));
    hasNot(r, '昼のタスク');
    has(r, 'ほか4件・待ち2件');
    assert.ok(r.texts.includes('3件'), '明日の件数（待ち含む）');
    assert.ok(r.texts.indexOf('明日の朝') < r.texts.indexOf('明日の夕方'));
    hasNot(r, '明日の待ち');
  });

  await t('大：今日の時刻のある予定が全部終わったら、18時前でも明日の分', async () => {
    const only = routineWith({ events: [EVENTS[0], EVENTS[6]] });
    const r = await run(configured, { respond: only, files: {}, family: 'large' });
    has(r, '今日は終了'); assert.ok(r.texts.includes('歯医者'));
    // 予定が無い日の昼は「今日の予定はありません」と明日の最初
    const none = await run(configured, { respond: routineWith({ events: [EVENTS[6]] }), files: {}, family: 'large' });
    has(none, '今日の予定はありません'); has(none, '明日 9:30 歯医者'); hasNot(none, '今日は終了');
  });

  await t('中：ルーティン（○×・連続・生理 ○日後）・歯みがき（2頭・名前が空なら わんこB）・脳みそ新しい2枚・HH:MM 更新', async () => {
    const r = await run(configured, { respond: good, files, family: 'medium' });
    assert.deepStrictEqual(urls(r), [R_URL, W_URL].sort(), '中はルーティンとわんこだけ読む');
    has(r, 'ルーティン'); has(r, 'サプリを…'); has(r, 'ストレッ…');
    assert.ok(r.texts.includes('✓') && r.texts.includes('·'));
    assert.ok(r.texts.includes('3') && r.texts.includes('日連続'));
    has(r, '生理 2日後');
    has(r, '歯みがき'); assert.ok(r.texts.includes('ポチ') && r.texts.includes('わんこB') && r.texts.includes('−'));
    has(r, '脳みそ'); has(r, '全128枚');
    has(r, '造作収納は「使う場所の50cm以内」'); has(r, 'H-034 · 11/4');
    has(r, 'ラワン合板の小口'); assert.ok(r.texts.includes('M · 11/3'), '番号が無いカードは記号だけ');
    hasNot(r, '今日の1枚');
    has(r, '10:30 更新');
    const c = JSON.parse(files['/docs/koto-widget-cache.json']);
    assert.deepStrictEqual(Object.keys(c).sort(), ['routine', 'task', 'wanko', 'weather'], '大の分を消さずに足す');
  });

  await t('中：わんこの内容が昨日の分なら、今日は2頭とも − にする', async () => {
    const old = Object.assign({}, good, { [W_URL]: () => ({ ok: true, wanko: { today: '2026-11-04', dogs: [{ name: 'ポチ', done: true }, { name: 'タマ', done: true }] } }) });
    const r = await run(configured, { respond: old, files: {}, family: 'medium' });
    assert.ok(!r.texts.slice(r.texts.indexOf('歯みがき')).includes('✓'));
    assert.strictEqual(r.texts.filter(x => x === '−').length, 2);
  });

  await t('設定が足りない：その欄だけ「未設定」。ほかは出す（エラーにしない）', async () => {
    const onlyR = withConfig({ routineUrl: R_URL, routineKey: R_KEY });
    let r = await run(onlyR, { respond: good, files: {}, family: 'large' });
    assert.ok(r.completed); has(r, '現場 引渡し'); has(r, '未設定'); has(r, '16°');
    r = await run(onlyR, { respond: good, files: {}, family: 'medium' });
    has(r, '生理 2日後'); has(r, '全128枚');
    assert.strictEqual(r.texts.filter(x => x === '未設定').length, 1, '歯みがきだけ未設定');
    const onlyW = withConfig({ wankoUrl: W_URL, wankoKey: W_KEY });
    r = await run(onlyW, { respond: good, files: {}, family: 'medium' });
    assert.ok(r.texts.includes('ポチ')); assert.strictEqual(r.texts.filter(x => x === '未設定').length, 2, 'ルーティンと脳みそ');
    r = await run(onlyW, { respond: good, files: {}, family: 'large' });
    assert.strictEqual(r.texts.filter(x => x === '未設定').length, 4, '予定・タスク・ルーティン・脳みそ'); has(r, '木曜日・大阪'); assert.ok(r.texts.includes('ポチ'));
  });

  await t('天気だけ読めない：天気の所に一言。予定・タスクはそのまま', async () => {
    const r = await run(configured, { respond: good, files: {}, family: 'large', weather: false });
    has(r, '天気を読めません'); has(r, '現場 引渡し'); has(r, '古い持ち越し');
    assert.ok(!r.texts.some(x => /^\d+時$/.test(x)));
    // 前に読めた天気があればそれを使う（今の気温は今の時刻の予報から）
    const r2 = await run(configured, { respond: good, files: { '/docs/koto-widget-cache.json': JSON.stringify({ weather: { data: weather(), at: '2026-11-05T01:00:00.000Z' } }) }, family: 'large', weather: false, now: '2026-11-05T13:10:00+09:00' });
    hasNot(r2, '天気を読めません'); has(r2, '17°'); has(r2, '最高 20°');
    hasNot(r2, '天気：更新');
    // 天気の返事がおかしい
    const r3 = await run(configured, { respond: good, files: {}, family: 'large', weather: () => ({ error: true, reason: 'x' }) });
    has(r3, '天気を読めません'); has(r3, '現場 引渡し');
  });

  await t('タスク表だけ落ちている：前の内容が無ければ理由を出す。あれば前の内容と「タスク表：更新できませんでした HH:MM」', async () => {
    let r = await run(configured, { respond: Object.assign({}, good, { [T_URL]: down }), files: {}, family: 'large' });
    has(r, '読み込めませんでした（つながりません）'); has(r, '現場 引渡し'); has(r, '16°');
    r = await run(configured, { respond: Object.assign({}, good, { [T_URL]: () => ({ ok: false, error: 'bad_key' }) }), files, family: 'large', now: '2026-11-05T10:40:00+09:00' });
    has(r, '古い持ち越し'); has(r, 'タスク表：更新できませんでした 10:40'); hasNot(r, '予定・タスク表');
  });

  await t('全部読めない：前の内容を出し、下に「…：更新できませんでした HH:MM」。中は「更新」の代わりにそれ', async () => {
    let r = await run(configured, { respond: fail, files, family: 'large', weather: false, now: '2026-11-05T11:05:00+09:00' });
    has(r, '現場 引渡し'); has(r, '古い持ち越し'); has(r, '予定・タスク表・歯みがき：更新できませんでした 11:05');
    r = await run(configured, { respond: fail, files, family: 'medium', now: '2026-11-05T11:05:00+09:00' });
    has(r, '生理 2日後'); has(r, 'ポチ'); has(r, 'ルーティン・歯みがき：更新できませんでした 11:05'); hasNot(r, '11:05 更新');
  });

  await t('前の内容が無いまま読めない：理由（合言葉違いなど）', async () => {
    const r = await run(configured, { respond: { [R_URL]: () => ({ ok: false, error: 'bad_key' }), [W_URL]: () => ({ ok: false, error: 'bad_action' }), [T_URL]: down }, files: {}, family: 'medium' });
    assert.ok(r.completed);
    has(r, '読み込めませんでした（合言葉が違います）'); has(r, '読み込めませんでした（Apps Script が古いようです）');
  });

  await t('カレンダーが読めない（events:null）・スプシのプログラムが古い（events・brain・wanko が無い）', async () => {
    let r = await run(configured, { respond: routineWith({ events: null }), files: {}, family: 'large' });
    has(r, 'カレンダーを読めませんでした'); has(r, '古い持ち越し');
    const oldR = Object.assign({}, ROUTINE); delete oldR.events; delete oldR.brain;
    const oldResp = Object.assign({}, good, { [R_URL]: () => oldR, [W_URL]: () => ({ ok: true, today: '2026-11-05', habits: [], streak: 0, period: null }) });
    r = await run(configured, { respond: oldResp, files: {}, family: 'large' });
    has(r, 'スプシのプログラムを新しくすると出ます');
    r = await run(configured, { respond: oldResp, files: {}, family: 'medium' });
    has(r, 'スプシのプログラムを新しくすると出ます'); has(r, '家族用のスプシのプログラムを新しくすると出ます'); has(r, '生理 2日後');
    // 古いタスク表（tomorrow が無い）：「明日N件」は出さない
    const oldT = Object.assign({}, TASKS); delete oldT.tomorrow; delete oldT.tomorrowDate;
    r = await run(configured, { respond: Object.assign({}, good, { [T_URL]: () => oldT }), files: {}, family: 'large', now: '2026-11-05T21:40:00+09:00' });
    hasNot(r, '明日3件'); assert.ok(r.texts.includes('夕方のタスク'), '夜でも今日の分を5つまで');
  });

  await t('脳みそのカードが0枚', async () => {
    const r = await run(configured, { respond: routineWith({ brain: { count: 0, latest: [] } }), files: {}, family: 'medium' });
    has(r, '全0枚'); has(r, 'まだカードがありません');
  });

  await t('前の内容が昨日の分：○×は出さず日付を添える。生理の「○日後」は今日で数え直す', async () => {
    const r = await run(configured, { respond: fail, files, family: 'medium', now: '2026-11-06T09:00:00+09:00' });
    assert.ok(!r.texts.slice(0, r.texts.indexOf('歯みがき')).includes('✓'), '昨日の○は今日の○にしない');
    has(r, '（11/5 の記録）'); has(r, '生理 1日後');
    const l = await run(configured, { respond: fail, files, family: 'large', now: '2026-11-06T09:00:00+09:00' });
    has(l, '（11/5 の内容）');
  });

  await t('深夜3時まではルーティンの前の日（2:30 は 11/5 のまま）', async () => {
    const r = await run(configured, { respond: good, files: {}, family: 'medium', now: '2026-11-06T02:30:00+09:00' });
    assert.ok(r.texts.includes('✓')); hasNot(r, 'の記録）'); has(r, '生理 2日後');
  });

  await t('生理：記録中は「○日目」、予定日を過ぎたら「予定日から○日」、今日なら「今日」、無ければ出さない', async () => {
    const mk = p => routineWith({ period: p });
    let r = await run(configured, { respond: mk({ ongoing: true, start: '2026-11-03', day: 3, next: '2026-12-01', until: 26, late: 0 }), files: {} });
    has(r, '生理 3日目');
    r = await run(configured, { respond: mk({ ongoing: false, start: '', day: 0, next: '2026-11-02', until: -3, late: 3 }), files: {} });
    has(r, '生理 予定日から3日');
    r = await run(configured, { respond: mk({ ongoing: false, start: '', day: 0, next: '2026-11-05', until: 0, late: 0 }), files: {} });
    has(r, '生理 今日');
    r = await run(configured, { respond: mk(null), files: {} });
    hasNot(r, '生理');
  });

  await t('小さいサイズ・ロック画面でも動く', async () => {
    let r = await run(configured, { respond: good, files: {}, family: 'small' });
    assert.deepStrictEqual(urls(r), [R_URL, T_URL].sort());
    has(r, 'きょう 11/5（木）'); has(r, 'タスク 8件'); has(r, '持ち越し 2'); has(r, '習慣 1/2　連続 3日'); has(r, '生理 2日後');
    has(r, '10:00 現場 引渡し');
    r = await run(configured, { respond: good, files: {}, family: 'small', now: '2026-11-05T21:40:00+09:00' });
    has(r, '明日 9:30 歯医者');
    r = await run(configured, { respond: fail, files: {}, family: 'small' });
    has(r, 'タスク —');
    r = await run(configured, { respond: good, files: {}, family: 'accessoryRectangular' });
    has(r, 'タスク8 習慣1/2 生理2日後');
  });

  await t('待ちだけ・0件', async () => {
    const only = Object.assign({}, good, { [T_URL]: () => ({ ok: true, today: '2026-11-05', tasks: [TASKS.tasks[3]], tomorrow: [], tomorrowDate: '2026-11-06' }) });
    let r = await run(configured, { respond: only, files: {}, family: 'large' });
    has(r, '待ちのタスクだけです'); has(r, '待ち1件・明日0件');
    r = await run(configured, { respond: Object.assign({}, good, { [T_URL]: () => ({ ok: true, today: '2026-11-05', tasks: [], tomorrow: [], tomorrowDate: '2026-11-06' }) }), files: {}, family: 'large', now: '2026-11-05T21:40:00+09:00' });
    has(r, '今日のタスクはありません'); has(r, '明日のタスクはありません'); hasNot(r, '持越');
  });

  await t('アプリの中で実行：大の見本を出す（全部読む・大1つに全部入る）', async () => {
    const r = await run(configured, { respond: good, files: {}, inWidget: false });
    assert.deepStrictEqual(r.presented, ['large']); assert.ok(r.completed);
    assert.deepStrictEqual(urls(r), [R_URL, T_URL, W_URL, 'weather'].sort());
    assert.ok(r.previewLarge.texts().includes('現場 引渡し'));
    assert.ok(r.previewLarge.texts().includes('ポチ'));
  });

  await t('キャッシュが壊れていても動く', async () => {
    const r = await run(configured, { respond: fail, files: { '/docs/koto-widget-cache.json': '{壊れた' }, family: 'large', weather: false });
    assert.ok(r.completed); has(r, '読み込めませんでした'); has(r, '天気を読めません');
  });

  console.log(`\n${passed} 件 すべて成功`);
})().catch(e => { console.error(e); process.exit(1); });
