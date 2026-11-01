// 予定合わせ の画面試験（Playwright の Chromium）
// 実行：node yotei/test/e2e.js [スクショの保存先]
// スプシ（Apps Script）は test/gas-mock.js の Code.gs に、Googleカレンダーはモックの予定につなぐ。
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..', '..');
const SHOT = process.argv[2] || path.join(require('os').tmpdir(), 'yotei-shots');
fs.mkdirSync(SHOT, { recursive: true });

const gas = require(path.join(ROOT, 'test', 'gas-mock.js'))();
gas.ctx.setup();
const KEY = String(gas.ss.getSheetByName('設定').getRange('B1').getValue());
const link = gas.ctx.connectLink_(gas.ss.getSheetByName('設定'));
const hash = link.slice(link.indexOf('#'));
const NOW = new Date('2026-11-01T10:00:00+09:00');
gas.clockBox.t = NOW.getTime();

// コトさんのカレンダー（モック）。件名は返らないこと・終日と欠席は空きのままを確かめる
const at = (day, h, m) => Date.parse(`2026-11-${day}T${String(h).padStart(2, '0')}:${String(m || 0).padStart(2, '0')}:00+09:00`);
gas.cal.events.push(
  { s: at('09', 9), e: at('09', 12), title: '秘密の打合せA' },
  { s: at('09', 13), e: at('09', 15), title: '秘密の打合せB' },
  { s: at('10', 10), e: at('10', 17), title: '現場' },
  { s: at('11', 0), e: at('12', 0), title: '終日の予定', allDay: true },
  { s: at('12', 9), e: at('12', 18), title: '欠席の予定', status: 'NO' },
  { s: at('13', 9), e: at('13', 18), title: '出張' }
);

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
async function wire(ctx, log) {
  await ctx.clock.setFixedTime(NOW);
  await ctx.route('https://fonts.googleapis.com/**', r => r.fulfill({ contentType: 'text/css', body: '' }));
  await ctx.route('https://script.google.com/**', r => {
    gas.clockBox.t += 1000;
    const out = gas.ctx.doPost({ postData: { contents: r.request().postData() } });
    if (log) log.push({ req: r.request().postData(), res: out.text });
    return r.fulfill({ contentType: 'application/json', body: out.text, headers: { 'Access-Control-Allow-Origin': '*' } });
  });
}
let passed = 0;
async function t(name, fn) { await fn(); passed++; console.log('ok -', name); }
const records = () => gas.ctx.handle_({ key: KEY, action: 'list', app: 'yotei' }).records;
const answerRows = () => { const s = gas.ss.getSheetByName('yotei_answers'); return s ? s.cells.slice(1).filter(r => r[0]) : []; };
async function settled(page) {
  for (let i = 0; i < 100; i++) { if (await page.evaluate(() => Apps.pendingCount()) === 0) return; await page.waitForTimeout(100); }
  throw new Error('送信待ちが残ったまま');
}
// マス目をなぞる（同じ日の r0〜r1 行）
async function drag(page, grid, d, r0, r1) {
  const a = page.locator(`${grid} .c[data-d="${d}"][data-r="${r0}"]`), b = page.locator(`${grid} .c[data-d="${d}"][data-r="${r1}"]`);
  await a.scrollIntoViewIfNeeded();
  const ba = await a.boundingBox(), bb = await b.boundingBox();
  await page.mouse.move(ba.x + ba.width / 2, ba.y + ba.height / 2);
  await page.mouse.down();
  await page.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2, { steps: 10 });
  await page.mouse.up();
}
const isOn = (page, grid, d, r) => page.locator(`${grid} .c[data-d="${d}"][data-r="${r}"]`).evaluate(e => e.classList.contains('on'));
async function noHScroll(page, label) {
  const o = await page.evaluate(() => {
    const bad = [];
    const de = document.documentElement;
    if (de.scrollWidth > de.clientWidth + 1) bad.push('page ' + de.scrollWidth + '>' + de.clientWidth);
    document.querySelectorAll('.scr.on, .scr.on .body, .scr.on .pad, .scr.on .rwrap').forEach(el => { if (el.scrollWidth > el.clientWidth + 1) bad.push(el.className + ' ' + el.scrollWidth + '>' + el.clientWidth); });
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
  };

  // ---------- 自分（iPhone幅） ----------
  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true });
  await wire(phone);
  await phone.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: BASE });
  const page = await phone.newPage();
  watch(page, 'owner');
  let guestUrl = '', evId = '';

  await t('接続リンクで開くと、空の一覧が出る', async () => {
    await page.goto(BASE + '/yotei/' + hash);
    await page.waitForSelector('#evEmpty:not([hidden])');
    assert.strictEqual(await page.locator('.ax-overlay').count(), 0);
    await page.screenshot({ path: path.join(SHOT, 'phone-0-list-empty.png') });
  });

  await t('作る：名前・期間・既定値（9:00〜21:00・30分・1時間・締切は初日の前日）', async () => {
    await page.click('#newBtn');
    assert.strictEqual(await page.inputValue('#cFrom'), '9');
    assert.strictEqual(await page.inputValue('#cTo'), '21');
    assert.ok(await page.locator('#stepSeg button.on', { hasText: '30分' }).count());
    assert.ok(await page.locator('#needSeg button.on', { hasText: '1時間' }).count());
    await page.fill('#cName', '打合せ（試験）');
    await page.fill('#cStart', '2026-11-09');
    await page.dispatchEvent('#cStart', 'change');
    await page.fill('#cEnd', '2026-11-15');
    assert.strictEqual(await page.inputValue('#cDead'), '2026-11-08');
    // 15日はだめ
    await page.fill('#cEnd', '2026-11-23');
    await page.click('#toMine');
    assert.ok((await page.textContent('#cErr')).includes('14日'));
    await page.fill('#cEnd', '2026-11-15');
    await page.screenshot({ path: path.join(SHOT, 'phone-1-create.png') });
    await noHScroll(page, 'create');
  });

  await t('自分の空き：カレンダーの予定から自動で塗る（予定あり＝斜線、終日・欠席は空き）', async () => {
    await page.click('#toMine');
    await page.waitForFunction(() => document.getElementById('calBanner').textContent.includes('塗りました'));
    // 11/9：9〜12・13〜15 は予定あり、12:00 と 15:00 は空き
    assert.strictEqual(await isOn(page, '#gMine', 0, 0), false);
    assert.ok(await page.locator('#gMine .c[data-d="0"][data-r="0"]').evaluate(e => e.classList.contains('busy')));
    assert.strictEqual(await isOn(page, '#gMine', 0, 6), true);
    assert.strictEqual(await isOn(page, '#gMine', 0, 8), false);
    assert.strictEqual(await isOn(page, '#gMine', 0, 12), true);
    assert.strictEqual(await isOn(page, '#gMine', 2, 0), true, '終日の予定は空き扱い');
    assert.strictEqual(await isOn(page, '#gMine', 3, 0), true, '欠席の予定は空き扱い');
    assert.strictEqual(await isOn(page, '#gMine', 4, 4), false);
    assert.ok(!(await page.content()).includes('秘密'));
    await page.screenshot({ path: path.join(SHOT, 'phone-2-mine.png') });
    await noHScroll(page, 'mine');
  });

  await t('自分の空き：なぞって直せる（塗った所をなぞると消える）', async () => {
    const before = await page.textContent('#mineCnt');
    await drag(page, '#gMine', 0, 6, 7);   // 11/9 12:00〜13:00 を消す
    assert.strictEqual(await isOn(page, '#gMine', 0, 6), false);
    assert.strictEqual(await isOn(page, '#gMine', 0, 7), false);
    assert.notStrictEqual(await page.textContent('#mineCnt'), before);
    await drag(page, '#gMine', 4, 20, 21); // 11/13 19:00〜20:00 は空き（もとから）→ 消す
    await drag(page, '#gMine', 4, 20, 21); // もう一度なぞると塗る
    assert.strictEqual(await isOn(page, '#gMine', 4, 20), true);
  });

  await t('相手用リンクを作る：英数字32文字の番号、スプシに保存', async () => {
    await page.click('#mineDone');
    await page.waitForSelector('#v-share.on');
    await settled(page);
    const recs = records();
    assert.strictEqual(recs.length, 1);
    const d = recs[0].data; evId = recs[0].id;
    assert.ok(/^[A-Za-z0-9]{32}$/.test(d.token));
    assert.strictEqual(d.status, 'open');
    assert.strictEqual(d.mine.length, 7);
    assert.strictEqual(d.mine[0].slice(0, 12), '000000000000');
    assert.strictEqual(d.mine[0].slice(12), '111111111111');
    assert.strictEqual(d.mine[2], '1'.repeat(24));
    assert.ok(!JSON.stringify(d).includes('秘密'));
    guestUrl = await page.locator('#linkBox').getAttribute('data-url');
    assert.ok(guestUrl.startsWith(BASE + '/yotei/a/#' + d.token), guestUrl);
    assert.strictEqual(await page.textContent('#linkBox em'), d.token);
    await page.click('#copyBtn');
    assert.strictEqual(await page.evaluate(() => navigator.clipboard.readText()), guestUrl);
    assert.ok((await page.textContent('#pvDead')).includes('11/8(日)'));
    await page.screenshot({ path: path.join(SHOT, 'phone-3-share.png') });
    await noHScroll(page, 'share');
  });

  // ---------- 相手（スマホ・登録なし） ----------
  async function guest(name, paints, shotPrefix) {
    const ctx = await browser.newContext({ viewport: { width: 375, height: 740 }, deviceScaleFactor: 2, hasTouch: true });
    const log = [];
    await wire(ctx, log);
    const g = await ctx.newPage();
    watch(g, 'guest ' + name);
    await g.goto(guestUrl);
    await g.waitForSelector('#g-name.on');
    assert.strictEqual(await g.textContent('#g-name .gTitle'), '打合せ（試験）');
    if (shotPrefix) await g.screenshot({ path: path.join(SHOT, shotPrefix + '-1-name.png') });
    await g.fill('#gName', name);
    await g.click('#toPaint');
    await g.waitForSelector('#g-paint.on');
    assert.ok(await g.isDisabled('#gSend'));
    for (const p of paints) await drag(g, '#gGrid', p[0], p[1], p[2]);
    if (shotPrefix) await g.screenshot({ path: path.join(SHOT, shotPrefix + '-2-paint.png') });
    await noHScroll(g, 'guest paint');
    await g.click('#gSend');
    await g.waitForSelector('#g-done.on');
    if (shotPrefix) await g.screenshot({ path: path.join(SHOT, shotPrefix + '-3-done.png') });
    return { ctx, g, log };
  }
  let g1, g2;
  await t('相手1：リンクを開く→名前→なぞって塗る→送る', async () => {
    g1 = await guest('山田（試験）', [[0, 12, 17], [2, 8, 15]], 'guest');
    const rows = answerRows();
    assert.strictEqual(rows.length, 1);
    assert.strictEqual(rows[0][0], evId);
    const a = JSON.parse(rows[0][5]);
    assert.strictEqual(a.name, '山田（試験）');
    assert.strictEqual(a.cells[0], '000000000000111111000000');
    // 相手の画面・通信に、コトさんの予定や自分の空きは出ない
    const txt = g1.log.map(x => x.res).join('\n');
    assert.ok(!txt.includes('mine') && !txt.includes('秘密') && !txt.includes(KEY) && !txt.includes(evId));
    assert.ok(g1.log.every(x => !JSON.parse(x.req).key), '合言葉は送らない');
  });

  await t('相手2：別の人。相手の画面に他の人（相手1）の名前・答えは出ない', async () => {
    g2 = await guest('佐藤（試験）', [[0, 14, 21], [2, 10, 14]]);
    assert.strictEqual(answerRows().length, 2);
    const txt = g2.log.map(x => x.res).join('\n') + await g2.g.content();
    assert.ok(!txt.includes('山田'), '他の人の名前が見えない');
  });

  await t('相手1：同じスマホで開き直すと、自分の答えを直せる（上書き）', async () => {
    const g = g1.g;
    await g.goto(BASE + '/yotei/');  // いったん離れて
    await g.goto(guestUrl);
    await g.waitForSelector('#g-done.on');
    assert.strictEqual(await g.textContent('#doneHead'), '送ってあります');
    await g.click('#gEdit');
    assert.strictEqual(await g.inputValue('#gName'), '山田（試験）');
    await g.click('#toPaint');
    assert.strictEqual(await isOn(g, '#gGrid', 0, 12), true, '前の答えが塗ってある');
    await drag(g, '#gGrid', 1, 18, 19);   // 11/10 18:00〜19:00 を足す
    await g.click('#gSend');
    await g.waitForSelector('#g-done.on');
    const rows = answerRows();
    assert.strictEqual(rows.length, 2);
    const r = rows.find(x => JSON.parse(x[5]).name === '山田（試験）');
    assert.strictEqual(r[4], '1');
    assert.strictEqual(JSON.parse(r[5]).cells[0], '000000000000111111000000');
    assert.strictEqual(JSON.parse(r[5]).cells[1], '000000000000000000110000');
  });

  await t('結果：重なりの濃淡・候補ベスト3・マスを押すと誰が空きか', async () => {
    await page.click('#toResult');
    await page.waitForFunction(() => document.querySelectorAll('#ppl .pp').length === 3);
    const n = (d, r) => page.locator(`#gHeat .c[data-d="${d}"][data-r="${r}"]`).getAttribute('data-n');
    assert.strictEqual(await n(2, 10), '3');   // 11/11 14:00：全員
    assert.strictEqual(await n(0, 12), '2');   // 11/9 15:00：自分＋山田
    assert.strictEqual(await n(0, 0), '0');
    const st = s => page.locator(`#gHeat .c[data-d="${s[0]}"][data-r="${s[1]}"]`).getAttribute('style');
    assert.notStrictEqual(await st([2, 10]), await st([0, 12]), '濃さが違う');
    const cands = await page.locator('#cands .cand').allTextContents();
    assert.strictEqual(cands.length, 3);
    assert.ok(cands[0].includes('11/11(水) 14:00〜15:00') && cands[0].includes('3/3人') && cands[0].includes('16:30まで'), cands[0]);
    assert.ok(cands[1].includes('11/9(月) 16:00〜17:00') && cands[1].includes('3/3人'), cands[1]);
    assert.ok(cands[2].includes('11/10(火) 18:00〜19:00') && cands[2].includes('2/3人'), cands[2]);
    await page.locator('#gHeat .c[data-d="0"][data-r="12"]').click();
    assert.ok(await page.locator('#rCell .pp.y', { hasText: '山田' }).count());
    assert.ok(await page.locator('#rCell .pp.n', { hasText: '佐藤' }).count());
    assert.ok(await page.locator('#gHeat .c.pick.p0').count() === 1);
    await page.screenshot({ path: path.join(SHOT, 'phone-4-result.png') });
    await page.screenshot({ path: path.join(SHOT, 'phone-4-result-full.png'), fullPage: false });
    await noHScroll(page, 'result');
    // 一覧には答えた人数
    await page.click('#v-result [data-go=list]');
    assert.ok((await page.textContent('#evs')).includes('答えた人 2人'));
    await page.screenshot({ path: path.join(SHOT, 'phone-5-list.png') });
    await page.locator('#evs .ev').first().click();
    await page.waitForSelector('#v-result.on');
  });

  // ---------- 自分（パソコン幅） ----------
  await t('パソコン幅：結果を横に広く（マス目が左、候補と答えた人が右）', async () => {
    const pc = await browser.newContext({ viewport: { width: 1366, height: 860 } });
    await wire(pc);
    const p = await pc.newPage();
    watch(p, 'pc');
    await p.goto(BASE + '/yotei/' + hash);
    await p.waitForSelector('#evs .ev');
    await p.screenshot({ path: path.join(SHOT, 'pc-1-list.png') });
    await noHScroll(p, 'pc list');
    await p.locator('#evs .ev').first().click();
    await p.waitForFunction(() => document.querySelectorAll('#ppl .pp').length === 3);
    const g = await p.locator('#rGridBox').boundingBox(), c = await p.locator('#rCandsBox').boundingBox();
    assert.ok(c.x > g.x + g.width - 1, '候補は右側');
    assert.ok(g.width > 700, 'マス目が広い ' + g.width);
    assert.ok(await p.isVisible('#calBtn2'));
    assert.ok(!(await p.isVisible('#calBtn')));
    await p.locator('#gHeat .c[data-d="2"][data-r="10"]').hover();
    assert.ok(await p.locator('#rCell .pp.y', { hasText: '佐藤' }).count());
    await p.screenshot({ path: path.join(SHOT, 'pc-2-result.png') });
    await noHScroll(p, 'pc result');
    await pc.close();
  });

  await t('カレンダーに入れる：確認→入れる で1件だけ（件名＝名前、メモ＝答えた人、招待なし）→決定', async () => {
    await page.click('#calBtn');
    await page.waitForSelector('#sheet:not([hidden])');
    assert.ok((await page.textContent('#shKv')).includes('11/11(水) 14:00〜15:00'));
    await page.screenshot({ path: path.join(SHOT, 'phone-6-cal.png') });
    assert.strictEqual(gas.cal.created.length, 0, '確認の前には作らない');
    await page.click('#calDo');
    await page.waitForSelector('#rDecided .done-banner');
    assert.strictEqual(gas.cal.created.length, 1);
    const c = gas.cal.created[0];
    assert.strictEqual(c.title, '打合せ（試験）');
    assert.strictEqual(c.s, at('11', 14)); assert.strictEqual(c.e, at('11', 15));
    assert.ok(c.opts.description.includes('山田（試験）') && c.opts.description.includes('佐藤（試験）'));
    assert.strictEqual(c.opts.sendInvites, false);
    assert.ok((await page.textContent('#rDecided')).includes('11/11(水) 14:00〜15:00'));
    assert.ok(await page.isDisabled('#calBtn'));
    assert.strictEqual(records()[0].data.status, 'decided');
    await page.screenshot({ path: path.join(SHOT, 'phone-7-decided.png') });
  });

  await t('決定後に相手がリンクを開くと「受付は終わりました」と決定日時。送れない', async () => {
    await g2.g.goto(BASE + '/yotei/');
    await g2.g.goto(guestUrl);
    await g2.g.waitForSelector('#mBox:not([hidden])');
    assert.strictEqual(await g2.g.textContent('#mHead'), '受付は終わりました');
    assert.ok((await g2.g.textContent('#mText')).includes('11/11(水) 14:00〜15:00'));
    await g2.g.screenshot({ path: path.join(SHOT, 'guest-4-decided.png') });
    const tok = guestUrl.split('#')[1].split('.')[0];
    assert.strictEqual(gas.ctx.handle_({ action: 'yoteiAnswer', token: tok, name: 'x', device: 'devXXXXXXXXXXXXXXXXXXX', cells: Array(7).fill('0'.repeat(24)) }).error, 'closed');
  });

  await t('番号違い・番号なしのリンクは「見つかりません」だけ', async () => {
    const g = g2.g;
    const tail = guestUrl.split('#')[1].split('.')[1];
    for (const h of ['#AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA.' + tail, '#short.' + tail, '']) {
      await g.goto(BASE + '/yotei/');
      await g.goto(BASE + '/yotei/a/' + h);
      await g.waitForSelector('#mBox:not([hidden])');
      assert.strictEqual(await g.textContent('#mHead'), '見つかりません', h);
    }
    await g.screenshot({ path: path.join(SHOT, 'guest-5-notfound.png') });
  });

  // 試験用の予定合わせをスプシに直接足す
  const putEv = (id, token, over) => {
    gas.clockBox.t += 1000;
    const r = gas.ctx.handle_({ key: KEY, action: 'put', app: 'yotei', id, data: Object.assign({ kind: 'event', title: '食事会（試験）', start: '2026-11-09', end: '2026-11-15',
      from: 9, to: 21, step: 30, need: 60, deadline: '2026-11-08', token, mine: Array(7).fill('0'.repeat(24)), status: 'open' }, over || {}) });
    assert.ok(r.ok);
  };
  await t('締切を過ぎた予定合わせ：「受付は終わりました」', async () => {
    const tok = 'P'.repeat(32);
    putEv('ev-past', tok, { deadline: '2026-10-31' });
    const g = g2.g;
    await g.goto(BASE + '/yotei/');
    await g.goto(BASE + '/yotei/a/#' + tok + '.' + guestUrl.split('.').pop());
    await g.waitForSelector('#mBox:not([hidden])');
    assert.strictEqual(await g.textContent('#mHead'), '受付は終わりました');
    assert.ok((await g.textContent('#mText')).includes('締切'));
  });

  await t('上限超え（5人）：6人目は送れず、理由が出る', async () => {
    const tok = 'Q'.repeat(32);
    putEv('ev-full', tok);
    for (let i = 0; i < 5; i++) {
      const r = gas.ctx.handle_({ action: 'yoteiAnswer', token: tok, name: '人' + i, device: 'devFULL' + String(i).repeat(12), cells: Array(7).fill('0'.repeat(24)) });
      assert.ok(r.ok, JSON.stringify(r));
    }
    const g = g2.g;
    await g.goto(BASE + '/yotei/');
    await g.goto(BASE + '/yotei/a/#' + tok + '.' + guestUrl.split('.').pop());
    await g.waitForSelector('#g-name.on');
    await g.fill('#gName', '6人目');
    await g.click('#toPaint');
    await drag(g, '#gGrid', 1, 2, 4);
    await g.click('#gSend');
    await g.waitForSelector('#sendErr:not([hidden])');
    assert.ok((await g.textContent('#sendErr')).includes('5人'));
    assert.ok(await g.isVisible('#g-paint'));
    await g.screenshot({ path: path.join(SHOT, 'guest-6-full.png') });
  });

  await t('2週間の予定合わせ：スマホは1週間ずつ（前の週／次の週）', async () => {
    const tok = 'R'.repeat(32);
    putEv('ev-2w', tok, { start: '2026-11-16', end: '2026-11-29', deadline: '2026-11-15', mine: Array(14).fill('0'.repeat(24)) });
    const g = g2.g;
    await g.goto(BASE + '/yotei/');
    await g.goto(BASE + '/yotei/a/#' + tok + '.' + guestUrl.split('.').pop());
    await g.waitForSelector('#g-name.on');
    await g.fill('#gName', '週送り');
    await g.click('#toPaint');
    assert.strictEqual(await g.locator('#gGrid .hd').count(), 7);
    await g.click('#gWeek [data-wk="1"]');
    assert.ok((await g.textContent('#gGrid')).includes('11/23'));
    await drag(g, '#gGrid', 8, 0, 1);
    await g.click('#gSend');
    await g.waitForSelector('#g-done.on');
    const row = answerRows().find(r => JSON.parse(r[5]).name === '週送り');
    assert.strictEqual(JSON.parse(row[5]).cells[8].slice(0, 3), '110');
    await noHScroll(g, 'guest 2w');
  });

  await t('一覧：受付中・決定が出る／リンクを作り直すと古いリンクは見つからない', async () => {
    await page.click('#v-result [data-go=list]');
    await page.evaluate(() => window.__yotei.db.sync());
    await page.waitForFunction(() => document.querySelectorAll('#evs .ev').length === 4);
    const txt = await page.textContent('#evs');
    assert.ok(txt.includes('決定') && txt.includes('受付中'));
    await page.locator('#evs .ev', { hasText: '食事会' }).filter({ hasText: '11/16' }).click();
    await page.click('#rShare');
    const old = await page.locator('#linkBox').getAttribute('data-url');
    page.once('dialog', d => d.accept());
    await page.click('#reissue');
    await page.waitForFunction(o => document.getElementById('linkBox').dataset.url !== o, old);
    await settled(page);
    const g = g2.g;
    await g.goto(BASE + '/yotei/');
    await g.goto(old);
    await g.waitForSelector('#mBox:not([hidden])');
    assert.strictEqual(await g.textContent('#mHead'), '見つかりません');
    await g.goto(BASE + '/yotei/');
    await g.goto(await page.locator('#linkBox').getAttribute('data-url'));
    await g.waitForSelector('#g-name.on, #g-done.on');
  });

  await t('画面のエラーなし', async () => { assert.deepStrictEqual(errors, []); });
  await browser.close();
  server.close();
  console.log(`\n${passed} 件 すべて成功（スクショ：${SHOT}）`);
})().catch(e => { console.error(e); process.exit(1); });
