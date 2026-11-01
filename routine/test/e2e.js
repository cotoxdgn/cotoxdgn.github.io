// ルーティン（起床・就寝記録）の画面試験（Playwright の Chromium）
// 実行：node routine/test/e2e.js [スクショの保存先]
// スプシ（Apps Script）は test/gas-mock.js の Code.gs につなぐ。iPhone のショートカットの送信は sleepPut を直接呼んで再現する。
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..', '..');
const SHOT = process.argv[2] || path.join(require('os').tmpdir(), 'routine-shots');
fs.mkdirSync(SHOT, { recursive: true });

const gas = require(path.join(ROOT, 'test', 'gas-mock.js'))();
gas.ctx.setup();
const conf = gas.ss.getSheetByName('設定');
const KEY = String(conf.getRange('B1').getValue());
const link = gas.ctx.connectLink_(conf);
const hash = link.slice(link.indexOf('#'));
let NOW = new Date('2026-11-01T10:00:00+09:00');   // 日曜（休日）
gas.clockBox.t = NOW.getTime();

// ---- ショートカットから届いた記録（例） ----
const J = (d, hm) => `2026-${d}T${hm}:00+09:00`;
const x = (sd, sh, ed, eh, v) => ({ s: J(sd, sh), e: J(ed, eh), v: v || 'コア' });
const send = samples => {
  gas.clockBox.t += 1000;
  const r = gas.ctx.handle_({ key: String(conf.getRange('B5').getValue()), action: 'sleepPut', samples });
  assert.ok(r.ok, JSON.stringify(r));
  return r;
};
const NIGHTS = {
  '10-26': [x('10-26', '00:05', '10-26', '07:20')],
  '10-27': [x('10-26', '23:50', '10-27', '07:07')],
  '10-28': [x('10-28', '00:55', '10-28', '07:57')],
  '10-29': [x('10-29', '00:08', '10-29', '07:27')],
  '10-30': [x('10-30', '00:14', '10-30', '07:12')],
  '10-31': [x('10-30', '23:51', '10-31', '07:24')],
  // 今朝：Apple Watch（覚醒あり）とおこしてME が重なる。夕方のうたた寝は除く
  '11-01': [x('10-31', '16:00', '10-31', '16:40'), x('11-01', '00:12', '11-01', '03:10', 'コア'), x('11-01', '03:10', '11-01', '03:20', '覚醒'),
    x('11-01', '03:20', '11-01', '07:26', 'レム'), x('11-01', '00:15', '11-01', '07:20', '睡眠中')]
};
Object.keys(NIGHTS).forEach(k => send(NIGHTS[k]));

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
const server = http.createServer((req, res) => {
  const p = decodeURIComponent(req.url.split('?')[0]);
  let f = path.join(ROOT, p);
  if (!f.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
  if (fs.existsSync(f) && fs.statSync(f).isDirectory()) f = path.join(f, 'index.html');
  if (!fs.existsSync(f)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
});
async function wire(ctx) {
  await ctx.clock.setFixedTime(NOW);
  await ctx.route('https://fonts.googleapis.com/**', r => r.fulfill({ contentType: 'text/css', body: '' }));
  await ctx.route('https://script.google.com/**', r => {
    gas.clockBox.t += 1000;
    const out = gas.ctx.doPost({ postData: { contents: r.request().postData() } });
    return r.fulfill({ contentType: 'application/json', body: out.text, headers: { 'Access-Control-Allow-Origin': '*' } });
  });
}
let passed = 0;
async function t(name, fn) { await fn(); passed++; console.log('ok -', name); }
const record = id => { const r = gas.ctx.handle_({ key: KEY, action: 'list', app: 'routine' }).records.find(x => x.id === id); return r ? r.data : null; };
async function settled(page) {
  for (let i = 0; i < 100; i++) { if (await page.evaluate(() => Apps.pendingCount()) === 0) return; await page.waitForTimeout(100); }
  throw new Error('送信待ちが残ったまま');
}
const sync = page => page.evaluate(() => Apps.collection('routine').sync());
const text = (page, sel) => page.locator(sel).innerText();
const row = (page, ds) => page.locator(`#slRecent [data-ed="${ds}"]`);
async function noHScroll(page, label) {
  const o = await page.evaluate(() => {
    const de = document.documentElement, bad = [];
    if (de.scrollWidth > de.clientWidth + 1) bad.push('page ' + de.scrollWidth + '>' + de.clientWidth);
    document.querySelectorAll('.view:not([hidden]) .card, .view:not([hidden]) .list').forEach(el => { if (el.scrollWidth > el.clientWidth + 1) bad.push(el.className + ' ' + el.scrollWidth + '>' + el.clientWidth); });
    return bad;
  });
  assert.deepStrictEqual(o, [], label);
}

(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const BASE = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch();
  const errors = [];
  const watch = (page, who) => {
    page.on('pageerror', e => errors.push(who + ': ' + e.message));
    page.on('console', m => { if (m.type() === 'error' && !/favicon/.test(m.text())) errors.push(who + ' console: ' + m.text()); });
    page.on('dialog', d => d.accept());
  };
  const phoneOpts = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, timezoneId: 'Asia/Tokyo', locale: 'ja-JP' };
  const ctx = await browser.newContext(phoneOpts);
  await wire(ctx);
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: BASE });
  const page = await ctx.newPage();
  watch(page, 'phone');

  await t('接続して睡眠タブ：自動で届いた分（重なり・覚醒・うたた寝を整理）と目標との差', async () => {
    await page.goto(BASE + '/routine/' + hash);
    await page.waitForFunction(() => Apps.isConnected('routine'));
    await sync(page);
    assert.strictEqual(await page.locator('.tabbar a').count(), 4);
    await page.click('.tabbar a[data-v="sleep"]');
    await page.waitForSelector('#slCard');
    assert.strictEqual(await text(page, '#slBed'), '0:12');
    assert.strictEqual(await text(page, '#slWake'), '7:26');
    assert.ok((await text(page, '#slBedDiff')).includes('24:00 より12分おそい'));
    assert.ok((await text(page, '#slBedDiff')).includes('目標内'));
    assert.ok((await text(page, '#slWakeDiff')).includes('7:15 より11分おそい'));
    assert.strictEqual(await text(page, '#slLen'), '7時間14分');
    assert.ok((await text(page, '#slLenDiff')).includes('目標内'));
    assert.ok((await text(page, '#slSrc')).includes('ヘルスケアから'));
    assert.ok((await text(page, '#slSub')).includes('11月1日（日・休日）'));
    // 連続：起床・就寝は 10/29〜11/1 の4日、長さは 10/30 が 6時間58分 なので2日
    assert.strictEqual(await text(page, '#stWake'), '4');
    assert.strictEqual(await text(page, '#stBed'), '4');
    assert.strictEqual(await text(page, '#stLen'), '2');
    assert.strictEqual(await page.locator('.tabbar a[data-v="sleep"]').getAttribute('aria-current'), 'page');
    await page.screenshot({ path: path.join(SHOT, 'phone-1-sleep.png'), fullPage: true });
    await noHScroll(page, 'sleep');
  });

  await t('グラフ：週／月、起床／就寝／長さの切り替え。点を押すとその日の時刻と差', async () => {
    assert.strictEqual(await page.locator('#chart .pt').count(), 7);
    assert.strictEqual(await page.locator('#chart rect.pt').count(), 2, '休日（10/28 水・11/1 日）は四角');
    await page.locator('#chart [data-d="2026-10-28"]').click();
    assert.strictEqual(await text(page, '#tip'), '10/28(水・休)　起床 7:57（42分おそい）');
    await page.click('[data-kind="bed"]');
    assert.ok((await text(page, '#tip')).includes('就寝 0:55（55分おそい）'));
    await page.click('[data-kind="len"]');
    assert.ok((await text(page, '#tip')).includes('長さ 7時間2分（2分長い）'));
    await page.locator('#chart [data-d="2026-10-30"]').click();
    assert.ok((await text(page, '#tip')).includes('長さ 6時間58分（2分たりない）'));
    assert.ok((await text(page, '#cTitle')).includes('眠った長さ'));
    await page.locator('.chart').screenshot({ path: path.join(SHOT, 'phone-2-chart-len.png') });
    await page.click('[data-range="m"]');
    assert.strictEqual(await page.locator('#chart .pt').count(), 7);
    assert.strictEqual(await page.locator('#chart [data-d]').count(), 30);
    await page.locator('.chart').screenshot({ path: path.join(SHOT, 'phone-3-chart-month.png') });
    await page.click('[data-range="w"]'); await page.click('[data-kind="wake"]');
  });

  await t('手入力：直した値が優先され、あとで自動で届いても直した値のまま。「ヘルスケアの値に戻す」で戻る', async () => {
    await row(page, '2026-10-30').click();
    await page.waitForSelector('#v-sleep-edit:not([hidden])');
    assert.ok((await text(page, '#eFrom')).includes('就寝 0:14・起床 7:12'));
    assert.strictEqual(await page.inputValue('#eDate'), '2026-10-30');
    assert.strictEqual(await page.isHidden('#eReset'), true);
    await page.fill('#eBed', '23:30');
    await page.fill('#eWake', '07:40');
    await page.screenshot({ path: path.join(SHOT, 'phone-4-edit.png'), fullPage: true });
    await page.click('#eForm button[type="submit"]');
    await page.waitForSelector('#v-sleep:not([hidden])');
    assert.ok((await text(page, '#slRecent [data-ed="2026-10-30"]')).includes('起床 7:40'));
    assert.ok((await text(page, '#slRecent [data-ed="2026-10-30"]')).includes('直した'));
    await settled(page);
    assert.deepStrictEqual([record('sleepfix-20261030').bed, record('sleepfix-20261030').wake], [23 * 60 + 30, 7 * 60 + 40]);
    // ショートカットが同じ日の分をもう一度送っても、直した値が優先
    send(NIGHTS['10-30']);
    await sync(page);
    assert.ok((await text(page, '#slRecent [data-ed="2026-10-30"]')).includes('起床 7:40'));
    // 戻す
    await row(page, '2026-10-30').click();
    await page.waitForSelector('#v-sleep-edit:not([hidden])');
    await page.click('#eReset');
    await page.waitForSelector('#v-sleep:not([hidden])');
    assert.ok((await text(page, '#slRecent [data-ed="2026-10-30"]')).includes('起床 7:12'));
    await settled(page);
    assert.strictEqual(record('sleepfix-20261030'), null);
  });

  await t('記録を消す：ヘルスケアの値は残し、届き直しても出ない。戻すと出る', async () => {
    await row(page, '2026-10-27').click();
    await page.waitForSelector('#v-sleep-edit:not([hidden])');
    await page.click('#eDel');
    await page.waitForSelector('#v-sleep:not([hidden])');
    assert.ok((await text(page, '#slRecent [data-ed="2026-10-27"]')).includes('記録なし'));
    await settled(page);
    assert.strictEqual(record('sleepfix-20261027').removed, true);
    assert.ok(record('sleep-20261027'), 'ヘルスケアの値は残る');
    send(NIGHTS['10-27']);
    await sync(page);
    assert.ok((await text(page, '#slRecent [data-ed="2026-10-27"]')).includes('記録なし'));
    await row(page, '2026-10-27').click();
    await page.waitForSelector('#v-sleep-edit:not([hidden])');
    assert.strictEqual(await page.isVisible('#eReset'), true);
    await page.click('#eReset');
    await page.waitForSelector('#v-sleep:not([hidden])');
    assert.ok((await text(page, '#slRecent [data-ed="2026-10-27"]')).includes('起床 7:07'));
    await settled(page);
  });

  await t('カレンダー：起床・就寝・長さの3つとも目標内の日に月の印（花スタンプとは別の場所）', async () => {
    await page.click('.tabbar a[data-v="calendar"]');
    await page.waitForSelector('#v-calendar:not([hidden])');
    assert.strictEqual(await page.locator('#cal .day .moon').count(), 1, '11月は 11/1 だけ');
    assert.ok((await text(page, '#summary')).includes('睡眠が目標内の日'));
    assert.ok((await text(page, '#legend')).includes('睡眠が目標内'));
    const pos = await page.locator('#cal .day .moon').first().evaluate(e => getComputedStyle(e).position);
    assert.strictEqual(pos, 'absolute');
    await page.screenshot({ path: path.join(SHOT, 'phone-5-calendar-nov.png'), fullPage: true });
    await page.click('#prevM');
    // 10月：10/26・27・29・31（10/28 は就寝がおそい、10/30 は長さがたりない）
    const days = await page.locator('#cal .day:has(.moon) > span:first-child').allInnerTexts();
    assert.deepStrictEqual(days, ['26', '27', '29', '31']);
    await page.screenshot({ path: path.join(SHOT, 'phone-6-calendar-oct.png'), fullPage: true });
    await page.click('#nextM');
  });

  await t('目標の変更：今日からの記録に新しい目標。前の日はその時の目標のまま', async () => {
    await page.click('.tabbar a[data-v="sleep"]');
    await page.click('a.gear');
    await page.waitForSelector('#v-sleep-goal:not([hidden])');
    assert.strictEqual(await page.inputValue('#gWake'), '07:15');
    assert.strictEqual(await page.inputValue('#gBed'), '00:00');
    assert.strictEqual(await page.inputValue('#gLen'), '420');
    assert.strictEqual(await page.locator('#gHol [aria-pressed="true"]').count(), 2);
    await page.fill('#gWake', '07:00');
    await page.click('#gForm button[type="submit"]');
    await page.waitForSelector('#v-sleep:not([hidden])');
    assert.ok((await text(page, '#slWakeDiff')).includes('7:00 より26分おそい'));
    assert.ok((await text(page, '#slWakeDiff')).includes('15分超'));
    assert.ok((await text(page, '#slRecent [data-ed="2026-10-31"]')).includes('+9分'), '10/31 は 7:15 との差のまま');
    assert.strictEqual(await text(page, '#stWake'), '0');
    await settled(page);
    const g = record('sleep-goal');
    assert.deepStrictEqual(g.history.map(h => [h.from, h.wake]), [['2000-01-01', 435], ['2026-11-01', 420]]);
    assert.deepStrictEqual(g.hol, [0, 3]);
    // 週のグラフにも「途中で目標を変更」
    assert.ok((await text(page, '#cTitle')).includes('途中で目標を変更'));
  });

  await t('眠った長さの目標：8時間以上にすると今日は「たりない」、連続も0', async () => {
    await page.click('a.gear');
    await page.waitForSelector('#v-sleep-goal:not([hidden])');
    await page.selectOption('#gLen', '480');
    assert.strictEqual(await page.locator('#gHist .row').count(), 2);
    await page.screenshot({ path: path.join(SHOT, 'phone-7-goal.png'), fullPage: true });
    await page.click('#gForm button[type="submit"]');
    await page.waitForSelector('#v-sleep:not([hidden])');
    assert.ok((await text(page, '#slLenDiff')).includes('たりない'));
    assert.ok((await text(page, '#slLenDiff')).includes('目標 8時間以上・46分たりない'));
    assert.strictEqual(await text(page, '#stLen'), '0');
    assert.strictEqual(await text(page, '#lenN'), '8時間');
    await settled(page);
    const g = record('sleep-goal');
    assert.strictEqual(g.history.length, 2, '同じ日に変えたら、その日の分を置き換える');
    assert.deepStrictEqual([g.history[1].wake, g.history[1].sleepLen], [420, 480]);
    // カレンダーの 10月の印は前の目標のまま
    await page.click('.tabbar a[data-v="calendar"]');
    await page.click('#prevM');
    assert.strictEqual(await page.locator('#cal .day .moon').count(), 4);
    await page.click('#nextM');
    assert.strictEqual(await page.locator('#cal .day .moon').count(), 0);
  });

  await t('合言葉：送り先URLと睡眠用の合言葉を表示・コピー・作り直し', async () => {
    await page.click('.tabbar a[data-v="sleep"]');
    await page.click('a[href="#sleep-setup"]');
    await page.waitForSelector('#v-sleep-setup:not([hidden])');
    assert.ok(/\/exec$/.test(await text(page, '#skUrl')));
    assert.ok(!(await text(page, '#sk')).includes('sl'));
    await page.click('#skShow');
    const SK = String(conf.getRange('B5').getValue());
    await page.waitForFunction(k => document.getElementById('sk').textContent === k, SK);
    await page.click('#skCopy');
    assert.strictEqual(await page.evaluate(() => navigator.clipboard.readText()), SK);
    assert.ok((await text(page, '#v-sleep-setup')).includes('オートメーション'));
    assert.ok((await text(page, '#v-sleep-setup')).includes('睡眠を送った日.txt'));
    await page.screenshot({ path: path.join(SHOT, 'phone-8-setup.png'), fullPage: true });
    await page.click('#skNew');
    await page.waitForFunction(k => { const t = document.getElementById('sk').textContent; return t !== k && t.startsWith('sl'); }, SK);
    const SK2 = String(conf.getRange('B5').getValue());
    assert.notStrictEqual(SK2, SK);
    assert.strictEqual(await text(page, '#sk'), SK2);
    assert.strictEqual(gas.ctx.handle_({ key: SK, action: 'sleepPut', samples: NIGHTS['11-01'] }).error, 'bad_key');
    await page.click('#skShow');
    assert.ok(!(await text(page, '#sk')).includes('sl'));
    await noHScroll(page, 'setup');
  });

  await t('まだ届いていない朝：今すぐ実行（ショートカットを開く）と手で入れる。届いたら表示', async () => {
    NOW = new Date('2026-11-02T09:30:00+09:00');
    gas.clockBox.t = NOW.getTime();
    const ctx2 = await browser.newContext(phoneOpts);
    await wire(ctx2);
    const p2 = await ctx2.newPage();
    watch(p2, 'phone2');
    await p2.goto(BASE + '/routine/' + hash);
    await p2.waitForFunction(() => Apps.isConnected('routine'));
    await sync(p2);
    await p2.click('.tabbar a[data-v="sleep"]');
    await p2.waitForSelector('#slMissing');
    assert.ok((await text(p2, '#slMissing')).includes('今朝の記録がまだ届いていません'));
    assert.strictEqual(await p2.getAttribute('#slRun', 'href'), 'shortcuts://run-shortcut?name=' + encodeURIComponent('睡眠を送る'));
    await p2.screenshot({ path: path.join(SHOT, 'phone-9-missing.png'), fullPage: true });
    // 手で入れる → 今日の日付で開く（ヘルスケアの記録なし）
    await p2.click('#slManual');
    await p2.waitForSelector('#v-sleep-edit:not([hidden])');
    assert.strictEqual(await p2.inputValue('#eDate'), '2026-11-02');
    assert.ok((await text(p2, '#eFrom')).includes('ありません'));
    assert.strictEqual(await text(p2, '#eTitle'), '記録を入れる');
    await p2.click('#v-sleep-edit a.back');
    // ショートカットが送った（ロックを外して LINE を開いた等）→ 同期で表示
    send([x('11-01', '23:58', '11-02', '07:05')]);
    await sync(p2);
    await p2.waitForSelector('#slCard');
    assert.strictEqual(await text(p2, '#slWake'), '7:05');
    assert.ok((await text(p2, '#slWakeDiff')).includes('7:00 より5分おそい'), '新しい目標');
    assert.ok((await p2.getAttribute('#slResend', 'href')).includes('input=text'));
    await p2.screenshot({ path: path.join(SHOT, 'phone-10-arrived.png'), fullPage: true });
    await ctx2.close();
  });

  await t('ダークモードでも崩れない（睡眠・カレンダー）', async () => {
    const ctx3 = await browser.newContext(Object.assign({ colorScheme: 'dark' }, phoneOpts));
    await wire(ctx3);
    const p3 = await ctx3.newPage();
    watch(p3, 'dark');
    await p3.goto(BASE + '/routine/' + hash);
    await p3.waitForFunction(() => Apps.isConnected('routine'));
    await sync(p3);
    await p3.click('.tabbar a[data-v="sleep"]');
    await p3.waitForSelector('#slCard');
    await p3.screenshot({ path: path.join(SHOT, 'phone-11-dark.png'), fullPage: true });
    await noHScroll(p3, 'dark');
    await ctx3.close();
  });

  await t('今日の習慣の画面はそのまま動く', async () => {
    await page.click('.tabbar a[data-v="today"]');
    await page.waitForSelector('#habits .habit');
    assert.strictEqual(await page.locator('#habits .habit').count(), 2);
  });

  assert.deepStrictEqual(errors, []);
  await browser.close();
  server.close();
  console.log(`\n${passed} 件 すべて成功（スクショ：${SHOT}）`);
})().catch(e => { console.error(e); process.exit(1); });
