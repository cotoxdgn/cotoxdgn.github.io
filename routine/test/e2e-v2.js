// ルーティン2版目（月カレンダー・生理・コレクション）の画面試験（Playwright の Chromium）
// 実行：node routine/test/e2e-v2.js [スクショの保存先]
// スプシ（Apps Script）は test/gas-mock.js の Code.gs につなぐ。Googleカレンダーの予定は gas-mock の cal.events に入れる。
// 1版目のデータを入れたまま開き、今日の丸・連続日数・花スタンプの数・睡眠の数字が1版目（git の V1 のコミット）と同じかも確かめる。
'use strict';
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const { execFileSync } = require('child_process');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..', '..');
const SHOT = process.argv[2] || path.join(os.tmpdir(), 'routine-v2-shots');
fs.mkdirSync(SHOT, { recursive: true });
const V1 = 'abf1746';   // 1版目の最後のコミット（比べる用）

const gas = require(path.join(ROOT, 'test', 'gas-mock.js'))();
gas.ctx.setup();
const conf = gas.ss.getSheetByName('設定');
const KEY = String(conf.getRange('B1').getValue());
const link = gas.ctx.connectLink_(conf);
const hash = link.slice(link.indexOf('#'));
const NOW = new Date('2026-11-03T10:00:00+09:00');   // 火曜
gas.clockBox.t = NOW.getTime();

// ---- 1版目の形のデータ（習慣・記録・睡眠）＋2版目の行（生理・種類・1件） ----
const put = (id, data) => { gas.clockBox.t += 10; const r = gas.ctx.handle_({ key: KEY, action: 'put', app: 'routine', id, data }); assert.ok(r.ok, JSON.stringify(r)); };
const H = [
  ['h-supple', { kind: 'habit', name: 'サプリを飲んだ', time: '', color: 'sage', order: 10, since: '', archivedOn: '' }],
  ['h-bath', { kind: 'habit', name: '22:30お風呂', time: '22:30', color: 'blue', order: 20, since: '', archivedOn: '' }],
  ['h-old', { kind: 'habit', name: 'ストレッチ', time: '', color: 'lilac', order: 30, since: '', archivedOn: '2026-10-15' }],
  ['h-new', { kind: 'habit', name: '日記', time: '', color: 'rose', order: 40, since: '2026-10-20', archivedOn: '' }]
];
H.forEach(([id, d]) => put(id, d));
const pad = n => String(n).padStart(2, '0');
const ymd = d => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
for (let i = 0, d = new Date(2026, 8, 25); ymd(d) <= '2026-11-03'; i++, d.setDate(d.getDate() + 1)) {
  const ds = ymd(d), lastDays = ds >= '2026-10-30' && ds <= '2026-11-02', today = ds === '2026-11-03';
  const on = { 'h-supple': i % 7 !== 3, 'h-bath': i % 5 !== 1, 'h-old': ds < '2026-10-15' && i % 2 === 0, 'h-new': ds >= '2026-10-20' && i % 6 !== 2 };
  if (lastDays) { on['h-supple'] = on['h-bath'] = on['h-new'] = true; }
  if (ds === '2026-10-29') on['h-bath'] = false;
  if (today) { on['h-supple'] = true; on['h-bath'] = on['h-new'] = false; }
  Object.keys(on).forEach(h => { if (on[h]) put('log-' + ds.replace(/-/g, '') + '-' + h, { kind: 'log', date: ds, habit: h, at: ds + 'T13:00:00.000Z' }); });
}
[['10-28', 1450, 440], ['10-29', 1435, 430], ['10-30', 1442, 436], ['10-31', 1440, 437], ['11-01', 1448, 445], ['11-02', 1441, 433], ['11-03', 1439, 438]]
  .forEach(([d, bed, wake]) => put('sleepfix-2026' + d.replace('-', ''), { kind: 'sleepfix', date: '2026-' + d, bed, wake, at: NOW.toISOString() }));
const V2ROWS = [
  ['period-20260811', { kind: 'period', start: '2026-08-11', end: '2026-08-15', at: NOW.toISOString() }],
  ['period-20260909', { kind: 'period', start: '2026-09-09', end: '2026-09-13', at: NOW.toISOString() }],
  ['period-20261008', { kind: 'period', start: '2026-10-08', end: '2026-10-12', at: NOW.toISOString() }],
  ['ctype-food', { kind: 'ctype', name: '料理', icon: 'bowl', color: 'mustard', order: 10, archivedOn: '' }],
  ['item-seed1', { kind: 'item', type: 'ctype-food', date: '2026-10-25', name: 'ミートソース', memo: '多めに作って冷凍', image: null, at: NOW.toISOString() }]
];
V2ROWS.forEach(([id, d]) => put(id, d));

// ---- Googleカレンダー（calMonth が読む） ----
const at = (d, hm) => Date.parse(`2026-${d}T${hm}:00+09:00`);
gas.cal.events.push(
  { s: at('11-03', '10:00'), e: at('11-03', '12:00'), title: '現場 立会い', color: '2' },
  { s: at('11-03', '19:00'), e: at('11-03', '20:00'), title: 'ジム' },
  { s: at('11-05', '14:00'), e: at('11-05', '15:30'), title: '打合せ', color: '9' },
  { s: at('11-07', '11:00'), e: at('11-07', '13:00'), title: '美容院', color: '1' },
  { s: at('11-11', '17:30'), e: at('11-11', '18:00'), title: '歯医者', color: '5' },
  { s: at('11-12', '09:00'), e: at('11-12', '10:00'), title: '欠席した会議', status: 'NO' },
  { s: at('11-18', '10:00'), e: at('11-18', '11:00'), title: '現場 引渡し', color: '2' },
  { s: at('11-18', '15:00'), e: at('11-18', '16:00'), title: '打合せ', color: '9' },
  { s: at('11-18', '19:00'), e: at('11-18', '20:00'), title: 'ジム' },
  { s: at('11-18', '21:00'), e: at('11-18', '22:00'), title: '電話', color: '3' },
  { s: at('11-21', '00:00'), e: at('11-24', '00:00'), title: '旅行（金沢）', allDay: true, color: '5' },
  { s: at('12-02', '10:00'), e: at('12-02', '11:00'), title: '打合せ', color: '9' }
);

// ---- 1版目のファイル（比べる用）を git から取り出す ----
let V1DIR = null;
try {
  V1DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'routine-v1-'));
  ['index.html', 'app.js', 'sleep.js', 'manifest.webmanifest'].forEach(f => {
    fs.writeFileSync(path.join(V1DIR, f), execFileSync('git', ['-C', ROOT, 'show', V1 + ':routine/' + f]));
  });
} catch (e) { console.log('# 1版目のファイルを取り出せないので、比べる試験は数字の決め打ちだけにします'); V1DIR = null; }

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAAAJ0lEQVR4nGP4z8BAEmIY1TCqYVTDqIZRDaMaRjWMahjVMKphuGgAAKCfH/HxRw4QAAAAAElFTkSuQmCC', 'base64');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
const server = http.createServer((req, res) => {
  const p = decodeURIComponent(req.url.split('?')[0]);
  let f;
  if (p.startsWith('/v1routine/')) {
    if (!V1DIR) { res.writeHead(404); return res.end(); }
    const rest = p.slice('/v1routine/'.length) || 'index.html';
    f = path.join(V1DIR, rest);
  } else f = path.join(ROOT, p);
  if (!f || !f.startsWith(V1DIR && p.startsWith('/v1routine/') ? V1DIR : ROOT)) { res.writeHead(404); return res.end(); }
  if (fs.existsSync(f) && fs.statSync(f).isDirectory()) f = path.join(f, 'index.html');
  if (!fs.existsSync(f)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
});
const net = { calMonth: 'ok', calls: [] };   // ok / bad_action / down
async function wire(ctx) {
  await ctx.clock.setFixedTime(NOW);
  await ctx.route('https://fonts.googleapis.com/**', r => r.fulfill({ contentType: 'text/css', body: '' }));
  await ctx.route('https://drive.google.com/**', r => r.fulfill({ contentType: 'image/png', body: PNG }));
  await ctx.route('https://script.google.com/**', r => {
    const body = JSON.parse(r.request().postData());
    net.calls.push(body.action);
    if (body.action === 'calMonth' && net.calMonth === 'down') return r.abort('internetdisconnected');
    if (body.action === 'calMonth' && net.calMonth === 'bad_action') return r.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: false, error: 'bad_action' }), headers: { 'Access-Control-Allow-Origin': '*' } });
    gas.clockBox.t += 1000;
    const out = gas.ctx.doPost({ postData: { contents: r.request().postData() } });
    return r.fulfill({ contentType: 'application/json', body: out.text, headers: { 'Access-Control-Allow-Origin': '*' } });
  });
}
let passed = 0;
async function t(name, fn) { await fn(); passed++; console.log('ok -', name); }
const all = () => gas.ctx.handle_({ key: KEY, action: 'list', app: 'routine' }).records;
const record = id => { const r = all().find(x => x.id === id); return r ? r.data : null; };
async function settled(page) {
  for (let i = 0; i < 100; i++) { if (await page.evaluate(() => Apps.pendingCount()) === 0) return; await page.waitForTimeout(100); }
  throw new Error('送信待ちが残ったまま');
}
const sync = page => page.evaluate(() => Apps.collection('routine').sync());
const text = (page, sel) => page.locator(sel).innerText();
const cell = (page, ds) => page.locator(`#cal .day[data-d="${ds}"]`);
async function noHScroll(page, label) {
  const o = await page.evaluate(() => {
    const de = document.documentElement, bad = [];
    if (de.scrollWidth > de.clientWidth + 1) bad.push('page ' + de.scrollWidth + '>' + de.clientWidth);
    document.querySelectorAll('.view:not([hidden]) .card, .view:not([hidden]) .list, .view:not([hidden]) .cal').forEach(el => { if (el.scrollWidth > el.clientWidth + 1) bad.push(el.className + ' ' + el.scrollWidth + '>' + el.clientWidth); });
    return bad;
  });
  assert.deepStrictEqual(o, [], label);
}
const go = (page, h) => page.evaluate(x => { location.hash = x; }, h);

(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const BASE = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch();
  const errors = [];
  const watch = (page, who) => {
    page.on('pageerror', e => errors.push(who + ': ' + e.message));
    page.on('console', m => { if (m.type() === 'error' && !/favicon|ERR_INTERNET_DISCONNECTED|Failed to load resource/.test(m.text())) errors.push(who + ' console: ' + m.text()); });
    page.on('dialog', d => d.accept());
  };
  const phone = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, hasTouch: true, timezoneId: 'Asia/Tokyo', locale: 'ja-JP' };
  const wide = { viewport: { width: 1024, height: 900 }, deviceScaleFactor: 1, timezoneId: 'Asia/Tokyo', locale: 'ja-JP' };
  async function open(opts, url, who, extra) {
    const ctx = await browser.newContext(Object.assign({}, opts, extra || {}));
    await wire(ctx);
    const page = await ctx.newPage();
    watch(page, who);
    await page.goto(url + hash);
    await page.waitForFunction(() => Apps.isConnected('routine'));
    await sync(page);
    return { ctx, page };
  }
  // 今日・カレンダー（10月・11月）・睡眠の数字を集める（1版目と2版目で同じ書き方で読める所だけ）
  async function numbers(page, v1) {
    const o = {};
    await go(page, '#today');
    await page.waitForSelector('#habits .habit');
    o.stAll = await text(page, '#stAll');
    o.stMonth = await text(page, '#stMonth');
    o.checks = await page.locator('#habits .check.on').count();
    o.meta = await page.locator('#habits .meta').allInnerTexts();
    await go(page, '#calendar');
    await page.waitForSelector('#cal .day');
    o.novFlowers = await page.locator('#cal .flower').count();
    o.novDots = await page.locator('#cal .dot').count();
    await page.click('#prevM');
    o.octFlowers = await page.locator('#cal .flower').count();
    o.octDots = await page.locator('#cal .dot').count();
    o.octSummary = (await page.locator('#summary div').allInnerTexts()).filter(s => !/睡眠|写真/.test(s)).map(s => s.replace(/\s+/g, ''));
    await page.click('#nextM');
    await go(page, '#sleep');
    await page.waitForSelector('#slCard');
    o.sleep = [await text(page, '#stWake'), await text(page, '#stBed'), await text(page, '#stLen'), await text(page, '#slLen')];
    await go(page, '#today');
    return o;
  }

  let v1nums = null;
  await t('1版目：2版目の行（生理・種類・1件）が入っていても読み飛ばして、エラーなく動く', async () => {
    if (!V1DIR) return;
    const { ctx, page } = await open(phone, BASE + '/v1routine/', 'v1', { serviceWorkers: 'block' });
    v1nums = await numbers(page, true);
    assert.strictEqual(await page.locator('#habits .habit').count(), 3);
    await ctx.close();
  });

  const { ctx, page } = await open(phone, BASE + '/routine/', 'phone');
  await t('2版目：今日の丸・連続日数・花スタンプの数・睡眠の数字が1版目と同じ', async () => {
    const n = await numbers(page, false);
    assert.strictEqual(n.stAll, '4', '10/30〜11/2 の4日連続（今日はまだ）');
    assert.strictEqual(n.stMonth, '2');
    assert.strictEqual(n.checks, 1);
    if (v1nums) assert.deepStrictEqual(n, v1nums);
    assert.deepStrictEqual(await page.locator('.tabbar a').allInnerTexts(), ['今日', 'カレンダー', '記録', '習慣']);
  });

  await t('今日：生理の小さなカード（次の予定日・始まったボタン）', async () => {
    await page.waitForSelector('#tPer');
    // 周期 29・29 → 29日。10/8＋29＝11/6
    assert.ok((await text(page, '#tPer')).includes('次の予定日 11/6（金）ごろ　あと3日'), await text(page, '#tPer'));
    assert.strictEqual(await text(page, '#tPerBtn'), '生理が始まった');
    await page.screenshot({ path: path.join(SHOT, 'v2-phone-01-today.png'), fullPage: true });
  });

  await t('カレンダー：予定（丸い色ラベル＋絵）・習慣・生理・予測・写真をまとめて出す', async () => {
    await page.click('.tabbar a[data-v="calendar"]');
    await page.waitForSelector('#cal .lab');
    assert.ok(net.calls.includes('calMonth'));
    const c3 = cell(page, '2026-11-03');
    assert.strictEqual(await c3.locator('.lab').count(), 2);
    assert.ok((await c3.locator('.lab').first().getAttribute('title')).includes('10:00〜12:00 現場 立会い'));
    assert.ok((await c3.locator('.lab').first().getAttribute('style')).includes('--lc:var(--sage)'), 'Googleカレンダーの色2 → セージ');
    assert.ok((await c3.locator('.lab').nth(1).getAttribute('style')).includes('--lc:var(--blue)'), '色なし → ブルーグレー');
    assert.ok((await c3.locator('.lab i').first().innerHTML()).includes('M4 11l8-6'), '現場 → おうちの絵');
    assert.ok((await c3.getAttribute('class')).includes('today'));
    // 4件の日：iPhone ではラベル2つと「+2」
    const c18 = cell(page, '2026-11-18');
    assert.strictEqual(await c18.locator('.lab:visible').count(), 2);
    assert.strictEqual(await c18.locator('.more.n').innerText(), '+2');
    // 終日・何日も続く予定はその日すべてに
    for (const d of ['21', '22', '23']) assert.ok((await cell(page, '2026-11-' + d).locator('.lab').innerText()).includes('旅行'));
    assert.strictEqual(await cell(page, '2026-11-24').locator('.lab').count(), 0);
    assert.strictEqual(await cell(page, '2026-11-12').locator('.lab').count(), 0, '欠席にした予定は出ない');
    // 生理の予測（11/6〜11/10、日数の平均5日）
    const yo = await page.locator('#cal .day.yosoku').evaluateAll(es => es.map(e => e.dataset.d));
    assert.deepStrictEqual(yo, ['2026-11-06', '2026-11-07', '2026-11-08', '2026-11-09', '2026-11-10']);
    assert.strictEqual(await page.locator('#cal .day.full').count(), 0, '全部できた日の背景色はやめた（花だけ）');
    assert.ok((await text(page, '#summary')).includes('この月の写真'));
    assert.strictEqual(await page.locator('#cal .moon').count(), 0, '睡眠を表示しない間は月の印なし');
    await page.screenshot({ path: path.join(SHOT, 'v2-phone-02-calendar.png'), fullPage: true });
    await noHScroll(page, 'calendar phone');
    // 10月：生理 10/8〜10/12、写真 10/25（写真なし＝種類の絵）
    await page.click('#prevM');
    const per = await page.locator('#cal .day.per').evaluateAll(es => es.map(e => e.dataset.d));
    assert.deepStrictEqual(per, ['2026-10-08', '2026-10-09', '2026-10-10', '2026-10-11', '2026-10-12']);
    assert.strictEqual(await cell(page, '2026-10-25').locator('.ph .noimg').count(), 1);
    assert.ok((await text(page, '#summary')).includes('1件'));
    await page.click('#nextM');
    await page.waitForSelector('#cal .lab');
  });

  await t('表示の切り替え：予定／習慣／生理／写真を隠せて、端末に覚える', async () => {
    await page.click('[data-ly="ev"]');
    assert.strictEqual(await page.locator('#cal .lab').count(), 0);
    await page.click('[data-ly="per"]');
    assert.strictEqual(await page.locator('#cal .day.yosoku').count(), 0);
    assert.deepStrictEqual(JSON.parse(await page.evaluate(() => localStorage.getItem('routine.layers'))), { ev: false, hb: true, per: false, ph: true });
    await page.reload(); await page.waitForSelector('#cal .day');
    assert.strictEqual(await page.getAttribute('[data-ly="ev"]', 'aria-pressed'), 'false');
    await page.click('[data-ly="ev"]'); await page.click('[data-ly="per"]');
    await page.waitForSelector('#cal .lab');
  });

  await t('日を押すと下から中身：予定（時刻・件名）・習慣・生理（予測）。閉じる', async () => {
    await cell(page, '2026-11-18').click();
    await page.waitForSelector('#sheet:not([hidden])');
    const s = await text(page, '#sheetBody');
    assert.ok(s.includes('11月18日（水）'));
    ['10:00〜11:00', '現場 引渡し', '15:00〜16:00', '21:00〜22:00', '電話', 'これからの日', '＋ この日に追加'].forEach(w => assert.ok(s.includes(w), w));
    await page.screenshot({ path: path.join(SHOT, 'v2-phone-03-day.png') });
    await page.click('#sheetX');
    assert.ok(await page.isHidden('#sheet'));
    await cell(page, '2026-11-07').click();
    assert.ok((await text(page, '#sheetBody')).includes('生理の予定日（予測）'));
    await page.click('#sheetBg', { position: { x: 10, y: 10 } });
    await cell(page, '2026-11-02').click();
    const s2 = await text(page, '#sheetBody');
    assert.ok(s2.includes('サプリを飲んだ') && s2.includes('できた') && s2.includes('生理がこの日に始まった'));
    await page.click('#sheetX');
  });

  await t('生理：今日のボタンで始まった→終わった。予測は次の回に移る。日付を直すと id も変わる', async () => {
    await page.click('.tabbar a[data-v="today"]');
    await page.click('#tPerBtn');
    await page.waitForFunction(() => document.getElementById('tPerBtn').textContent === '生理が終わった（1日目）');
    assert.ok((await text(page, '#tPer')).includes('1日目'));
    await settled(page);
    assert.deepStrictEqual(record('period-20261103').end, '');
    await page.click('.tabbar a[data-v="calendar"]');
    assert.ok((await cell(page, '2026-11-03').getAttribute('class')).includes('per'));
    assert.strictEqual(await page.locator('#cal .day.yosoku').count(), 0, '周期 29・29・26 → 28日。次は 12/1');
    await page.click('#nextM');
    const yo = await page.locator('#cal .day.yosoku').evaluateAll(es => es.map(e => e.dataset.d));
    assert.deepStrictEqual(yo, ['2026-12-01', '2026-12-02', '2026-12-03', '2026-12-04', '2026-12-05']);
    await page.click('#prevM');
    await page.click('.tabbar a[data-v="rec"]');
    await page.waitForSelector('#v-rec:not([hidden])');
    assert.ok((await text(page, '#perState')).includes('生理 1日目'));
    assert.ok((await text(page, '#perPred')).includes('直近3回の平均'));
    assert.ok((await text(page, '#perList')).includes('前回から\n26日'));
    await page.screenshot({ path: path.join(SHOT, 'v2-phone-04-rec-period.png'), fullPage: true });
    await page.click('#perState [data-act="perEnd"]');
    await page.waitForFunction(() => document.getElementById('perState').textContent.includes('生理ではない日'));
    await settled(page);
    assert.strictEqual(record('period-20261103').end, '2026-11-03');
    // 始まった日を 11/2 に直す：古い id を消して新しい id
    await page.click('#perList [data-d="period-20261103"]');
    await page.waitForSelector('#v-per-edit:not([hidden])');
    assert.strictEqual(await page.inputValue('#peS'), '2026-11-03');
    await page.fill('#peS', '2026-11-02');
    await page.click('#peForm button[type="submit"]');
    await page.waitForSelector('#v-rec:not([hidden])');
    await settled(page);
    assert.strictEqual(record('period-20261103'), null);
    assert.deepStrictEqual([record('period-20261102').start, record('period-20261102').end], ['2026-11-02', '2026-11-03']);
    // 消す
    await page.click('#perList [data-d="period-20261102"]');
    await page.click('#peDel');
    await page.waitForSelector('#v-rec:not([hidden])');
    await settled(page);
    assert.strictEqual(record('period-20261102'), null);
    assert.ok((await text(page, '#tPer')).includes('次の予定日 11/6'));
  });

  await t('コレクション：写真つきで追加（アプリで小さくしてドライブへ）。カレンダーに丸い写真。消すとドライブの写真も消える', async () => {
    await page.click('#v-rec [data-rv="collection"]');
    await page.waitForSelector('#v-collection:not([hidden])');
    assert.strictEqual(await page.locator('#gallery .thumb').count(), 1);
    await page.click('#colAdd');
    await page.waitForSelector('#v-item-edit:not([hidden])');
    assert.strictEqual(await page.inputValue('#ieDate'), '2026-11-03');
    // 大きめの写真（2400×1800）を作って選ぶ
    const big = await page.evaluate(async () => {
      const c = document.createElement('canvas'); c.width = 2400; c.height = 1800;
      const x = c.getContext('2d'); x.fillStyle = '#c90'; x.fillRect(0, 0, 2400, 1800); x.fillStyle = '#396'; x.fillRect(300, 300, 900, 900);
      return c.toDataURL('image/png').split(',')[1];
    });
    await page.setInputFiles('#ieFile', { name: 'soup.png', mimeType: 'image/png', buffer: Buffer.from(big, 'base64') });
    await page.waitForSelector('#iePick img');
    await page.fill('#ieName', 'かぼちゃのポタージュ');
    await page.fill('#ieMemo', '牛乳多めでなめらか');
    assert.strictEqual(await text(page, '#ieCount'), '9／60');
    assert.strictEqual(await page.getAttribute('#ieMemo', 'maxlength'), '60');
    await page.screenshot({ path: path.join(SHOT, 'v2-phone-05-item-edit.png'), fullPage: true });
    await page.click('#ieSave');
    await page.waitForSelector('#v-collection:not([hidden])');
    await settled(page);
    const item = all().find(r => r.data && r.data.kind === 'item' && r.data.name === 'かぼちゃのポタージュ');
    assert.ok(item && /^item-/.test(item.id));
    const d = item.data;
    assert.deepStrictEqual([d.type, d.date, d.memo], ['ctype-food', '2026-11-03', '牛乳多めでなめらか']);
    assert.ok(d.image && d.image.id && d.image.thumb);
    const file = gas.drive.byId[d.image.id];
    assert.ok(file && !file.trashed);
    assert.strictEqual(file.blob.getContentType ? file.blob.getContentType() : 'image/jpeg', 'image/jpeg');
    assert.ok(file.blob.getBytes().length < 1500000, '縮小してから保存');
    assert.strictEqual(await page.locator('#gallery .thumb').count(), 2);
    assert.ok((await page.locator('#gallery .thumb').first().innerText()).includes('かぼちゃのポタージュ'), '新しい順');
    await page.screenshot({ path: path.join(SHOT, 'v2-phone-06-gallery.png'), fullPage: true });
    // 種類を追加して絞り込み
    await page.click('a[href="#types"]');
    await page.waitForSelector('#v-types:not([hidden])');
    await page.fill('#teName', 'カフェ');
    await page.click('#teIcons [data-ic="cup"]');
    await page.click('#teColors [data-tc="rose"]');
    await page.screenshot({ path: path.join(SHOT, 'v2-phone-07-types.png'), fullPage: true });
    await page.click('#teSave');
    await page.waitForSelector('#v-collection:not([hidden])');
    assert.strictEqual(await page.locator('#gallery .thumb').count(), 0, '新しい種類で絞り込み');
    await page.click('#colTypes [data-ct="all"]');
    assert.strictEqual(await page.locator('#gallery .thumb').count(), 2);
    await settled(page);
    const caf = all().find(r => r.data && r.data.kind === 'ctype' && r.data.name === 'カフェ');
    assert.ok(caf && /^ctype-/.test(caf.id) && caf.data.icon === 'cup' && caf.data.color === 'rose');
    // カレンダー：11/3 に丸い写真
    await page.click('.tabbar a[data-v="calendar"]');
    assert.strictEqual(await cell(page, '2026-11-03').locator('.ph img').count(), 1);
    await cell(page, '2026-11-03').click();
    assert.ok((await text(page, '#sheetBody')).includes('かぼちゃのポタージュ'));
    await page.locator('#sheetBody .thumb').click();
    await page.waitForSelector('#v-item-view:not([hidden])');
    assert.strictEqual(await text(page, '#ivName'), 'かぼちゃのポタージュ');
    assert.ok((await text(page, '#ivMemo')).includes('牛乳多め'));
    await page.screenshot({ path: path.join(SHOT, 'v2-phone-08-item-view.png'), fullPage: true });
    await page.click('#ivDel');
    await page.waitForSelector('#v-collection:not([hidden])');
    await settled(page);
    for (let i = 0; i < 30 && !gas.drive.byId[d.image.id].trashed; i++) await page.waitForTimeout(100);
    assert.strictEqual(record(item.id), null);
    assert.strictEqual(gas.drive.byId[d.image.id].trashed, true, 'ドライブの写真も消す');
  });

  await t('カレンダーの「＋ この日に追加」：過去の日に写真なしで追加（種類の絵が出る）', async () => {
    await page.click('.tabbar a[data-v="calendar"]');
    await cell(page, '2026-11-01').click();
    await page.click('#sheetBody [data-act="addOn"]');
    await page.waitForSelector('#v-item-edit:not([hidden])');
    assert.strictEqual(await page.inputValue('#ieDate'), '2026-11-01');
    await page.fill('#ieName', '親子丼');
    await page.click('#ieSave');
    await page.waitForSelector('#v-collection:not([hidden])');
    await page.click('.tabbar a[data-v="calendar"]');
    assert.strictEqual(await cell(page, '2026-11-01').locator('.ph .noimg').count(), 1);
  });

  await t('Code.gs が古い（calMonth を知らない）ときは「スプシのプログラムが古いまま」。つながらない時は前に読んだ予定', async () => {
    net.calMonth = 'down';
    await page.reload(); await page.waitForSelector('#cal .day');
    await page.waitForFunction(() => /前に読んだ予定/.test(document.getElementById('calNote').textContent));
    assert.strictEqual(await cell(page, '2026-11-03').locator('.lab').count(), 2, '端末に置いた予定を出す');
    net.calMonth = 'bad_action';
    await page.click('#nextM');
    await page.waitForFunction(() => /古いまま/.test(document.getElementById('calNote').textContent));
    assert.ok((await text(page, '#calNote')).includes('スプシのプログラムが古いままです'));
    net.calMonth = 'ok';
    await page.click('#prevM');
    await page.waitForFunction(() => !/古いまま|前に読んだ/.test(document.getElementById('calNote').textContent));
  });

  await t('#sleep は 記録＞睡眠 を開く。習慣の「睡眠を表示する」で切り替えに出し、カレンダーに月の印', async () => {
    await go(page, '#sleep');
    await page.waitForSelector('#v-sleep:not([hidden])');
    assert.strictEqual(await page.locator('.tabbar a[data-v="rec"]').getAttribute('aria-current'), 'page');
    await go(page, '#rec');
    assert.strictEqual(await page.locator('#v-rec [data-rv="sleep"]').count(), 0);
    await page.click('.tabbar a[data-v="habits"]');
    await page.click('#swSleep');
    await page.click('.tabbar a[data-v="rec"]');
    assert.strictEqual(await page.locator('#v-collection [data-rv="sleep"]').count(), 1, '記録タブは最後に見た切り替え（コレクション）を開く');
    await page.click('.tabbar a[data-v="calendar"]');
    assert.ok(await page.locator('#cal .moon').count() > 0);
    assert.ok((await text(page, '#summary')).includes('睡眠が目標内の日'));
    await page.click('.tabbar a[data-v="habits"]');
    await page.click('#swSleep');
    await page.screenshot({ path: path.join(SHOT, 'v2-phone-09-habits.png'), fullPage: true });
  });
  await t('習慣＞ホーム画面のウィジェット：送り先URLと見るだけ用の合言葉（B6）を表示・作り直し。その合言葉で読めるのは widget だけ', async () => {
    await page.click('.tabbar a[data-v="habits"]');
    await page.click('a[href="#widget"]');
    await page.waitForSelector('#v-widget:not([hidden])');
    assert.strictEqual(await page.locator('.tabbar a[data-v="habits"]').getAttribute('aria-current'), 'page');
    assert.ok((await text(page, '#wvUrl')).endsWith('/exec'));
    assert.ok((await text(page, '#wv')).includes('•'));
    await page.click('#wvShow');
    await page.waitForFunction(() => !document.getElementById('wv').textContent.includes('•'));
    const vk = await text(page, '#wv');
    assert.strictEqual(vk, String(conf.getRange('B6').getValue()));
    assert.ok(gas.ctx.handle_({ key: vk, action: 'widget' }).ok);
    assert.strictEqual(gas.ctx.handle_({ key: vk, action: 'list', app: 'routine' }).error, 'bad_key');
    await page.click('#wvNew');
    await page.waitForFunction(old => document.getElementById('wv').textContent !== old, vk);
    const nk = await text(page, '#wv');
    assert.notStrictEqual(nk, vk); assert.strictEqual(nk, String(conf.getRange('B6').getValue()));
    await page.screenshot({ path: path.join(SHOT, 'v2-phone-10-widget.png'), fullPage: true });
    await noHScroll(page, 'widget');
  });
  await ctx.close();

  await t('iPad・パソコン幅：左に大きな月のマス目、右にその日の中身。ラベル3つ・時刻つき。← → で月を切り替え', async () => {
    const { ctx: c2, page: w } = await open(wide, BASE + '/routine/', 'wide');
    await go(w, '#calendar');
    await w.waitForSelector('#cal .lab');
    assert.ok(await w.isVisible('#panel'));
    assert.ok((await text(w, '#panel')).includes('11月3日（火）'));
    const c18 = cell(w, '2026-11-18');
    assert.strictEqual(await c18.locator('.lab:visible').count(), 3);
    assert.strictEqual(await c18.locator('.more.w').innerText(), '+1');
    assert.ok((await c18.locator('.lab .tm').first().innerText()).includes('10:00'));
    await c18.click();
    assert.ok(await w.isHidden('#sheet'), '広い幅では下からの画面は出さない');
    assert.ok((await text(w, '#panel')).includes('11月18日（水）'));
    await w.screenshot({ path: path.join(SHOT, 'v2-wide-01-calendar.png'), fullPage: true });
    await noHScroll(w, 'calendar wide');
    await w.keyboard.press('ArrowRight');
    assert.strictEqual(await text(w, '#monthTitle'), '2026年12月');
    await w.waitForSelector('#cal .day[data-d="2026-12-02"] .lab');
    await w.keyboard.press('ArrowLeft');
    assert.strictEqual(await text(w, '#monthTitle'), '2026年11月');
    await go(w, '#collection');
    await w.waitForSelector('#gallery .thumb');
    await w.screenshot({ path: path.join(SHOT, 'v2-wide-02-collection.png'), fullPage: true });
    await noHScroll(w, 'collection wide');
    await go(w, '#today');
    const mw = await w.evaluate(() => getComputedStyle(document.querySelector('main')).maxWidth);
    assert.strictEqual(mw, '560px', '今日・習慣・記録の文字の画面は今と同じ幅');
    await c2.close();
  });

  await t('ダークモード（iPhone・広い幅）', async () => {
    const { ctx: c3, page: d } = await open(phone, BASE + '/routine/', 'dark', { colorScheme: 'dark' });
    await go(d, '#calendar');
    await d.waitForSelector('#cal .lab');
    await d.screenshot({ path: path.join(SHOT, 'v2-dark-01-calendar.png'), fullPage: true });
    await cell(d, '2026-11-07').click();
    await d.screenshot({ path: path.join(SHOT, 'v2-dark-02-day.png') });
    await d.click('#sheetX');
    await go(d, '#today');
    await d.screenshot({ path: path.join(SHOT, 'v2-dark-03-today.png'), fullPage: true });
    await go(d, '#rec');
    await d.screenshot({ path: path.join(SHOT, 'v2-dark-04-rec.png'), fullPage: true });
    await noHScroll(d, 'dark');
    await c3.close();
    const { ctx: c4, page: dw } = await open(wide, BASE + '/routine/', 'dark-wide', { colorScheme: 'dark' });
    await go(dw, '#calendar');
    await dw.waitForSelector('#cal .lab');
    await dw.screenshot({ path: path.join(SHOT, 'v2-dark-05-wide.png'), fullPage: true });
    await c4.close();
  });

  assert.deepStrictEqual(errors, []);
  await browser.close();
  server.close();
  if (V1DIR) fs.rmSync(V1DIR, { recursive: true, force: true });
  console.log(`\n${passed} 件 すべて成功（スクショ：${SHOT}）`);
})().catch(e => { console.error(e); process.exit(1); });
