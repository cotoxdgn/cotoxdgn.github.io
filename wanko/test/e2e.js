// わんこの歯みがき：昨日までの記録を直す（記録一覧から「した」にする・消す）の画面試験
// 実行：node wanko/test/e2e.js [スクショの保存先]
'use strict';
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..', '..');
const SHOT = process.argv[2] || path.join(os.tmpdir(), 'wanko-shots');
fs.mkdirSync(SHOT, { recursive: true });
const gas = require(path.join(ROOT, 'test', 'gas-mock.js'))();
gas.ctx.setup();
const conf = gas.ss.getSheetByName('設定');
const KEY = String(conf.getRange('B1').getValue());
const NOW = new Date('2026-11-04T19:00:00+09:00');
gas.clockBox.t = NOW.getTime();
const put = (id, data) => { gas.clockBox.t += 10; assert.ok(gas.ctx.handle_({ key: KEY, action: 'put', app: 'wanko', id, data }).ok); };
put('2026-11-03_a', { date: '2026-11-03', dog: 'a', by: 'm1', byName: '家族1', at: '2026-11-03T12:00:00.000Z' });
put('2026-11-02_b', { date: '2026-11-02', dog: 'b', by: 'm1', byName: '家族1', at: '2026-11-02T12:00:00.000Z' });
const rows = () => gas.ctx.handle_({ key: KEY, action: 'list', app: 'wanko' }).records.filter(r => !r.deleted).map(r => r.id);

const b64u = o => Buffer.from(JSON.stringify(o)).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml' };
const server = http.createServer((req, res) => {
  let f = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]));
  if (fs.existsSync(f) && fs.statSync(f).isDirectory()) f = path.join(f, 'index.html');
  if (!f.startsWith(ROOT) || !fs.existsSync(f)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
});
let n = 0;
const t = async (name, fn) => { await fn(); n++; console.log('ok -', name); };

(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const BASE = 'http://127.0.0.1:' + server.address().port;
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, locale: 'ja-JP', timezoneId: 'Asia/Tokyo' });
  await ctx.clock.setFixedTime(NOW);
  await ctx.route('https://fonts.googleapis.com/**', r => r.fulfill({ contentType: 'text/css', body: '' }));
  await ctx.route('https://script.google.com/**', r => {
    const body = JSON.parse(r.request().postData() || '{}');
    gas.clockBox.t += 1000;
    r.fulfill({ contentType: 'application/json', body: JSON.stringify(gas.ctx.handle_(body)) });
  });
  const page = await ctx.newPage();
  const errs = []; page.on('pageerror', e => errs.push(String(e)));
  page.on('dialog', d => d.accept());
  await page.goto(BASE + '/wanko/#c=' + b64u({ u: 'https://script.google.com/macros/s/FAMILY/exec', k: KEY, a: 'wanko' }));
  await page.waitForTimeout(1500);
  const who = page.locator('#names button').first();
  if (await who.count()) await who.click();
  await page.waitForTimeout(800);
  await page.screenshot({ path: path.join(SHOT, 'start.png') });
  await page.click('#toLog');
  await page.waitForSelector('#v-log:not([hidden])');
  await t('昨日までの行は押せる（今日は押せない）', async () => {
    const groups = await page.$$eval('#allLog ul', uls => uls.map(u => u.querySelectorAll('li.editable').length));
    assert.strictEqual(groups[0], 0); assert.strictEqual(groups[1], 2);
  });
  await t('記録なし → 押すと「した」になり、あとで記入と出る', async () => {
    await page.locator('#allLog ul').nth(1).locator('li.editable').nth(1).click();   // 11/3 の b（記録なし）
    await page.waitForFunction(() => document.querySelectorAll('#allLog ul')[1].textContent.includes('あとで記入'));
    await page.waitForTimeout(1500);
    assert.ok(rows().includes('2026-11-03_b'), rows().join(','));
  });
  await t('記録あり → 押すと消える', async () => {
    await page.locator('#allLog ul').nth(2).locator('li.editable').nth(1).click();   // 11/2 の b（記録あり）
    await page.waitForTimeout(2000);
    assert.ok(!rows().includes('2026-11-02_b'), rows().join(','));
  });
  await t('1週間の丸も昨日までは押せる', async () => {
    const roles = await page.$$eval('#week .dot', ds => ds.map(d => d.getAttribute('role')));
    assert.strictEqual(roles.filter(Boolean).length, 12);   // 2頭 × 6日
  });
  await t('だれが何割の円（この30日）', async () => {
    assert.ok(await page.isVisible('#share'));
    const txt = await page.textContent('#shareList');
    assert.ok(/%/.test(txt), txt);
  });
  await page.screenshot({ path: path.join(SHOT, 'log.png'), fullPage: true });
  await page.locator('#share').screenshot({ path: path.join(SHOT, 'share.png') });
  await t('JSエラーなし', async () => assert.deepStrictEqual(errs, []));
  await b.close(); server.close();
  console.log(`\n${n} 件 すべて成功（スクショ：${SHOT}）`);
})().catch(e => { console.error(e); process.exit(1); });
