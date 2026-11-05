// ルーティンの日記（今日のカード・日記の画面・カレンダーの点・取り込み・1週間コピー・脳みそ）の画面試験
// 実行：node diary/test/e2e-diary.js [スクショの保存先]
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
  await page.waitForTimeout(300);
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

  const { ctx, page } = await open(phone, BASE + '/diary/', 'phone', { permissions: ['clipboard-read', 'clipboard-write'] });
  await t('今日の画面：日記カードは「まだ」。押すと日記の画面（今日・次の日へは進めない）', async () => {
    await go(page, '#today');
    await page.waitForSelector('#tDiary');
    assert.match(await text(page, '#tDiary'), /今日の日記[\s\S]*まだ/);
    await page.click('#tDiary');
    await page.waitForSelector('#v-diary:not([hidden])');
    assert.match(await text(page, '#dTitle'), /11月3日（火）・今日/);
    assert.ok(await page.locator('#dNext').isDisabled());
    assert.strictEqual(await page.evaluate(() => document.documentElement.getAttribute('data-theme')), null, '朝10時は明るいまま');
  });
  await t('書いて保存 → スプシに diary-YYYYMMDD。今日のカードは「書いた」、カレンダーに点・その日のシートに日記', async () => {
    await page.fill('#dEvent', '現場で施主さんと床材を決めた');
    await page.fill('#dMaxim', '決めるのは早く、確かめるのは丁寧に');
    await page.click('#dSave');
    await settled(page);
    const r = record('diary-20261103');
    assert.ok(r && r.kind === 'diary' && r.date === '2026-11-03' && r.event === '現場で施主さんと床材を決めた' && r.maxim && r.image === null, JSON.stringify(r));
    assert.match(await text(page, '#dState'), /保存しました/);
    await go(page, '#today');
    assert.match(await text(page, '#tDiary'), /書いた[\s\S]*床材/);
    await go(page, '#calendar');
    await page.waitForSelector('#cal .day');
    assert.strictEqual(await cell(page, '2026-11-03').locator('.dmark').count(), 1);
    assert.strictEqual(await cell(page, '2026-11-02').locator('.dmark').count(), 0);
    await cell(page, '2026-11-03').click();
    assert.match(await text(page, '#sheetBody'), /日記[\s\S]*床材[\s\S]*日記を開く/);
    await page.click('#sheetBody [data-act="diaryOn"]');
    await page.waitForSelector('#v-diary:not([hidden])');
    assert.strictEqual(await page.inputValue('#dEvent'), '現場で施主さんと床材を決めた');
    await page.screenshot({ path: path.join(SHOT, 'diary-phone.png'), fullPage: true });
  });
  await t('前の日へ：書きかけは移るときに保存。全部消して保存するとその日の日記は消える', async () => {
    await page.click('#dPrev');
    assert.match(await text(page, '#dTitle'), /11月2日（月）/);
    await page.fill('#dThanks', '職人さんが段取りを先回りしてくれた');
    await go(page, '#today');
    await settled(page);
    assert.strictEqual(record('diary-20261102').thanks, '職人さんが段取りを先回りしてくれた');
    await page.evaluate(() => { location.hash = '#calendar'; });
    await cell(page, '2026-11-02').click();
    await page.click('#sheetBody [data-act="diaryOn"]');
    await page.fill('#dThanks', '');
    await page.click('#dSave');
    await settled(page);
    assert.strictEqual(record('diary-20261102'), null);
    assert.match(await text(page, '#dState'), /消しました/);
  });
  await t('この1週間をコピー：#ROUTINE-DIARY-WEEK v1 ＋ 書いた日だけ', async () => {
    await page.click('#dNext');
    await page.click('#dWeek');
    await page.waitForTimeout(200);
    const c = await page.evaluate(() => navigator.clipboard.readText());
    assert.ok(c.startsWith('#ROUTINE-DIARY-WEEK v1\n'), c);
    const a = JSON.parse(c.split('\n').slice(1).join('\n'));
    assert.deepStrictEqual(a.map(x => x.date), ['2026-11-03']);
  });
  await t('取り込み：前の日記を貼る → 件数を確かめてから取り込む。書いてある日は上書きしない', async () => {
    const exp = '#NOTE-DIARY-EXPORT v1\n' + JSON.stringify([
      { date: '2026-10-31', event: '引っ越し前の日記', thanks: '', maxim: '', free: '自由', hasPhoto: true },
      { date: '2026-11-03', event: '上書きされてはいけない', thanks: '', maxim: '', free: '' }]);
    await page.click('.dimp summary');
    await page.fill('#dImp', 'でたらめ');
    await page.click('#dImpCheck');
    assert.match(await text(page, '#dImpMsg'), /読めませんでした/);
    assert.ok(await page.locator('#dImpGo').isHidden());
    await page.fill('#dImp', exp);
    await page.click('#dImpCheck');
    assert.match(await text(page, '#dImpMsg'), /1日分を取り込みます[\s\S]*1日分は上書きせず[\s\S]*写真 1枚/);
    assert.strictEqual(record('diary-20261031'), null, '確かめるだけでは書かない');
    await page.click('#dImpGo');
    await settled(page);
    assert.strictEqual(record('diary-20261031').event, '引っ越し前の日記');
    assert.strictEqual(record('diary-20261103').event, '現場で施主さんと床材を決めた');
  });
  await t('脳みそに残す：格言から脳みそのカード（出典＝日記・番号なし）', async () => {
    await page.click('#dBrain');
    await page.waitForSelector('.bn-form');
    assert.strictEqual(await page.inputValue('.bn-form [name=title]'), '決めるのは早く、確かめるのは丁寧に');
    await page.click('.bn-form [data-bn=save]');
    await settled(page);
    const b = gas.ctx.handle_({ key: KEY, action: 'list', app: 'brain' }).records.map(x => x.data).find(d => d.createdIn === 'diary');
    assert.ok(b && b.kind === 'H' && b.no === null && b.source.importId === 'diary:2026-11-03' && b.source.title === '日記 2026-11-03', JSON.stringify(b));
  });
  await t('夜（21時）は日記の画面だけ暗い。「明るくする」で戻せる。ほかの画面は元のまま', async () => {
    const night = await open(phone, BASE + '/diary/', 'night', { colorScheme: 'light' });
    await night.ctx.clock.setFixedTime(new Date('2026-11-03T21:00:00+09:00'));
    await night.page.goto(BASE + '/diary/#diary');
    await night.page.reload();
    await night.page.waitForSelector('#v-diary:not([hidden])');
    assert.strictEqual(await night.page.evaluate(() => document.documentElement.getAttribute('data-theme')), 'dark');
    await night.page.screenshot({ path: path.join(SHOT, 'diary-night.png'), fullPage: true });
    await night.page.click('#dTheme');
    assert.strictEqual(await night.page.evaluate(() => document.documentElement.getAttribute('data-theme')), null);
    await night.page.click('#dTheme');
    await go(night.page, '#today');
    assert.strictEqual(await night.page.evaluate(() => document.documentElement.getAttribute('data-theme')), null);
    await noHScroll(night.page, 'today');
    await night.ctx.close();
  });
  await t('/routine/ は /diary/ へ転送（#の行き先もそのまま）', async () => {
    const c = await browser.newContext(phone); await wire(c);
    const p = await c.newPage();
    await p.goto(BASE + '/routine/#calendar');
    await p.waitForURL(/\/diary\/#calendar$/);
    await c.close();
  });
  await go(page, '#diary');
  await noHScroll(page, 'diary');
  await ctx.close();
  await browser.close();
  server.close();
  assert.deepStrictEqual(errors, []);
  console.log('\n' + passed + ' 件 すべて成功（スクショ：' + SHOT + '）');
})().catch(e => { console.error(e); process.exit(1); });
