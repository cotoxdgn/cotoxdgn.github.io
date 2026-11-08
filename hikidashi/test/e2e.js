// 空間ひきだし帖の画面試験（Playwright の Chromium・スプシは test/gas-mock.js の Code.gs）
// 実行：node hikidashi/test/e2e.js [スクショの保存先]
'use strict';
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..', '..');
const SHOT = process.argv[2] || path.join(os.tmpdir(), 'hikidashi-shots');
fs.mkdirSync(SHOT, { recursive: true });
const gas = require(path.join(ROOT, 'test', 'gas-mock.js'))();
gas.ctx.setup();
const conf = gas.ss.getSheetByName('設定');
const KEY = String(conf.getRange('B1').getValue());
const link = gas.ctx.connectLink_(conf);
const hash = link.slice(link.indexOf('#'));
const NOW = new Date('2026-11-05T10:00:00+09:00');   // 木曜
gas.clockBox.t = NOW.getTime();
const put = (app, id, data) => { gas.clockBox.t += 10; const r = gas.ctx.handle_({ key: KEY, action: 'put', app, id, data }); assert.ok(r.ok, JSON.stringify(r)); };
// 脳みそ：実績2件・アーキマップから残したメモ1件・ふつうのカード1件
put('brain', 'w-1', { t: 'w', name: '[案件A] 秋月貿易のブース', period: '2026-10', client: 'ひみつの施主', cost: '300〜600万' });
put('brain', 'w-2', { t: 'w', name: '[案件B] マンション', period: '2026-08' });
put('brain', 'k-1', { t: 'k', kind: 'D', no: null, title: '框なし引戸の見切り', body: '床の見切りを5mm', createdIn: 'archmap', source: { spotId: 's1', title: '見学した建物' } });
put('brain', 'k-2', { t: 'k', kind: 'H', no: 3, title: 'ふつうのカード', body: '' });
const brainBefore = JSON.stringify(gas.ctx.handle_({ key: KEY, action: 'list', app: 'brain' }).records);

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAAAJ0lEQVR4nGP4z8BAEmIY1TCqYVTDqIZRDaMaRjWMahjVMKphuGgAAKCfH/HxRw4QAAAAAElFTkSuQmCC', 'base64');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
const server = http.createServer((req, res) => {
  const p = decodeURIComponent(req.url.split('?')[0]);
  let f = path.join(ROOT, p);
  if (!f.startsWith(ROOT)) { res.writeHead(404); return res.end(); }
  if (fs.existsSync(f) && fs.statSync(f).isDirectory()) f = path.join(f, 'index.html');
  if (!fs.existsSync(f)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
});
async function wire(ctx, now) {
  await ctx.clock.setFixedTime(now || NOW);
  await ctx.route('https://fonts.googleapis.com/**', r => r.fulfill({ contentType: 'text/css', body: '' }));
  await ctx.route('https://drive.google.com/**', r => r.fulfill({ contentType: 'image/png', body: PNG }));
  await ctx.route('https://script.google.com/**', r => {
    gas.clockBox.t += 1000;
    const out = gas.ctx.doPost({ postData: { contents: r.request().postData() } });
    return r.fulfill({ contentType: 'application/json', body: out.text, headers: { 'Access-Control-Allow-Origin': '*' } });
  });
}
let passed = 0;
async function t(name, fn) { await fn(); passed++; console.log('ok -', name); }
const all = () => gas.ctx.handle_({ key: KEY, action: 'list', app: 'hikidashi' }).records;
const of = kind => all().filter(r => r.data.kind === kind);
async function settled(page) {
  await page.waitForTimeout(300);
  for (let i = 0; i < 100; i++) { if (await page.evaluate(() => Apps.pendingCount()) === 0) return; await page.waitForTimeout(100); }
  throw new Error('送信待ちが残ったまま');
}
const go = (page, h) => page.evaluate(x => { location.hash = x; }, h);
const text = (page, sel) => page.locator(sel).innerText();
async function noHScroll(page, label) {
  const o = await page.evaluate(() => { const de = document.documentElement; return de.scrollWidth > de.clientWidth + 1 ? de.scrollWidth + '>' + de.clientWidth : ''; });
  assert.strictEqual(o, '', label);
}
// ノートの写真の代わり：うす灰色の紙に黒い四角を描いた画像
async function notePhoto(page) {
  return page.evaluate(async () => {
    const c = document.createElement('canvas'); c.width = 800; c.height = 600;
    const x = c.getContext('2d'); x.fillStyle = '#d8d2c4'; x.fillRect(0, 0, 800, 600);
    x.fillStyle = '#222'; x.fillRect(300, 200, 200, 150); x.fillRect(320, 360, 40, 40);
    const b = await new Promise(ok => c.toBlob(ok, 'image/jpeg', 0.9));
    return Array.from(new Uint8Array(await b.arrayBuffer()));
  });
}

(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const BASE = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch();
  const errors = [];
  const phone = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, hasTouch: true, timezoneId: 'Asia/Tokyo', locale: 'ja-JP' };
  const ctx = await browser.newContext(phone);
  await wire(ctx);
  const page = await ctx.newPage();
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && !/favicon|Failed to load resource/.test(m.text())) errors.push('console: ' + m.text()); });
  page.on('dialog', d => d.accept());
  await page.goto(BASE + '/hikidashi/' + hash);
  await page.waitForFunction(() => Apps.isConnected('hikidashi'));
  await page.evaluate(() => Promise.all([Apps.collection('hikidashi').sync(), Apps.collection('brain').sync()]));

  await t('今日：Lv.1・0日連続・木曜のおすすめは法規・来週分 0/7・ストック0', async () => {
    await page.waitForSelector('#tWeek .s');
    assert.strictEqual(await text(page, '#tLv'), 'Lv.1');
    assert.match(await text(page, '#tRec'), /木曜のおすすめ[\s\S]*法規/);
    assert.strictEqual(await text(page, '#tWeekN'), '0 / 7 たまった');
    assert.strictEqual(await page.locator('#tWeek .s').count(), 7);
    await page.screenshot({ path: path.join(SHOT, 'today.png'), fullPage: true });
  });
  await t('一括入力：脳みその実績を選んで3行をストックへ。工夫点は非公開で保存。脳みそは変わらない', async () => {
    await go(page, '#desk');
    await page.waitForSelector('#dWorks .work');
    assert.strictEqual(await page.locator('#dWorks .work').count(), 2);
    await page.click('#dWorks [data-w="w-1"]');
    const rows = page.locator('#dRows .drow');
    await rows.nth(0).locator('[data-f=name]').fill('突板の複合フローリング');
    await rows.nth(0).locator('[data-f=from]').fill('無垢の反りが心配');
    await rows.nth(0).locator('[data-f=memo]').fill('床暖房OK');
    await rows.nth(1).locator('[data-f=type]').selectOption('detail');
    await rows.nth(1).locator('[data-f=name]').fill('入巾木');
    await rows.nth(1).locator('[data-f=from]').fill('巾木が目立つ');
    assert.strictEqual(await text(page, '#dCount'), '+2');
    await page.fill('#dPoint', 'ブースの動線');
    await page.locator('#dPoint').dispatchEvent('change');
    await page.click('#dSave');
    await settled(page);
    const s = of('stock');
    assert.strictEqual(s.length, 2);
    assert.ok(s.every(r => r.data.workId === 'w-1' && r.data.src === 'desk' && !r.data.cardId));
    assert.strictEqual(of('worknote')[0].data.point, 'ブースの動線');
    await page.click('#dArch [data-am="k-1"]');
    await settled(page);
    assert.ok(of('stock').some(r => r.data.src === 'archmap' && r.data.srcId === 'k-1' && r.data.type === 'detail'));
    assert.strictEqual(await page.locator('#dArch [data-am]').count(), 0, '取り込んだメモは候補から消える');
    assert.strictEqual(JSON.stringify(gas.ctx.handle_({ key: KEY, action: 'list', app: 'brain' }).records), brainBefore, '脳みそは読むだけ');
    await page.setViewportSize({ width: 1280, height: 844 });
    await page.screenshot({ path: path.join(SHOT, 'desk-pc.png'), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await noHScroll(page, 'desk phone');
  });
  await t('書く：ストックから選ぶと元・代案が入る。完成度3/3で完成 → +20 EXP・#001・ストックに印', async () => {
    await go(page, '#today');
    await page.click('#tWrite');
    await page.waitForSelector('#v-write:not([hidden])');
    assert.strictEqual(await page.inputValue('#wDate'), '2026-11-09', '来週の月曜（最初の空き）');
    await page.click('#wKinds [data-k="item"]');
    const opt = await page.locator('#wStock option').nth(1).getAttribute('value');
    await page.selectOption('#wStock', opt);
    assert.strictEqual(await page.inputValue('#wTo'), '突板の複合フローリング');
    assert.strictEqual(await page.inputValue('#wFrom'), '無垢の反りが心配');
    assert.ok(await page.locator('#wPubF').isVisible(), '実務の案件のカードは通称の欄が出る');
    await page.fill('#wPhrase', '表面だけ天然木なので、見た目は無垢に近いまま。反りにくく、床暖房にも使えます。');
    assert.match(await text(page, '#wScore'), /2\/3/);
    assert.ok(await page.locator('#wDone').isDisabled());
    await page.check('#wCheck');
    assert.match(await text(page, '#wScore'), /3\/3/);
    // イラスト：撮る → 白くして切り出す → 使う
    const bytes = await notePhoto(page);
    await page.setInputFiles('#wIllFile', { name: 'note.jpg', mimeType: 'image/jpeg', buffer: Buffer.from(bytes) });
    await page.waitForSelector('#v-crop:not([hidden])');
    const box = await page.evaluate(() => ({ w: document.getElementById('cCanvas').width, h: document.getElementById('cCanvas').height }));
    assert.ok(box.w < 400 && box.h < 330 && box.w > 200, '描いた範囲だけに切り出す ' + JSON.stringify(box));
    const corner = await page.evaluate(() => Array.from(document.getElementById('cCanvas').getContext('2d').getImageData(1, 1, 1, 1).data));
    assert.ok(corner[0] > 245 && corner[1] > 245 && corner[2] > 245, '紙は白 ' + corner);
    await page.screenshot({ path: path.join(SHOT, 'crop.png'), fullPage: true });
    await page.click('#cOk');
    await page.waitForSelector('#v-write:not([hidden])');
    await page.waitForFunction(() => !document.getElementById('wIllX').hidden && /完成させる/.test(document.getElementById('wDone').textContent));
    await page.screenshot({ path: path.join(SHOT, 'write.png'), fullPage: true });
    await page.click('#wDone');
    await settled(page);
    const c = of('card')[0].data;
    assert.ok(c.status === 'done' && c.no === 1 && c.date === '2026-11-09' && c.doneOn === '2026-11-05' && c.fromWork === true && c.illust && c.illust.id, JSON.stringify(c));
    assert.ok(of('stock').some(r => r.data.cardId === of('card')[0].id));
    assert.match(await text(page, '#tNext'), /合計 20/);
    assert.strictEqual(await text(page, '#tStreak'), '1日連続');
    assert.strictEqual(await text(page, '#tWeekN'), '1 / 7 たまった');
  });
  await t('法規：条文番号と最終確認日が無いと完成にしない。おすすめはURLが要る', async () => {
    await page.click('#tWeek [data-day="2026-11-10"]');
    await page.click('#wKinds [data-k="law"]');
    assert.strictEqual(await text(page, '#wFromL'), 'よくある疑問');
    assert.ok(await page.locator('#wCheckF').isHidden());
    await page.fill('#wFrom', '内装制限ってなに？');
    await page.fill('#wTo', '燃えにくい仕上げにするルール');
    await page.fill('#wPhrase', '火事のとき燃え広がらないよう、壁と天井の仕上げを決めるルール。');
    assert.match(await text(page, '#wScore'), /2\/3/);
    await page.fill('#wArticle', '建築基準法 第35条の2');
    assert.match(await text(page, '#wScore'), /2\/3/);
    await page.fill('#wChecked', '2026-11-05');
    assert.match(await text(page, '#wScore'), /3\/3/);
    await page.fill('#wNote', 'https://note.com/roomin_kurashi/n/abc');
    await page.click('#wDone');
    await settled(page);
    await page.click('#tWeek [data-day="2026-11-11"]');
    await page.click('#wKinds [data-k="rec"]');
    await page.fill('#wFrom', '設計者のみんなへ'); await page.fill('#wTo', '[賞の名前]'); await page.fill('#wPhrase', '一緒に応募しよ');
    assert.match(await text(page, '#wScore'), /2\/3/);
    await page.fill('#wLink', 'http://example.com');
    assert.match(await text(page, '#wScore'), /2\/3/, 'https だけ');
    await page.fill('#wLink', 'https://example.com/award');
    await page.click('#wSave');   // 下書きで保存
    await settled(page);
    const cs = of('card').map(r => r.data);
    assert.ok(cs.some(c => c.type === 'law' && c.status === 'done' && c.no === 2 && c.article && c.checkedOn === '2026-11-05'));
    assert.ok(cs.some(c => c.type === 'rec' && c.status === 'draft' && c.no === null));
  });
  await t('帖：バー・バッジ・一覧（完成・下書き）・種類で絞り込み', async () => {
    await go(page, '#cho');
    await page.waitForSelector('#zCards .cd');
    assert.match(await text(page, '#zN'), /2枚/);
    assert.strictEqual(await page.locator('#zCards .cd').count(), 3);
    await page.click('#zFilters [data-f="law"]');
    assert.strictEqual(await page.locator('#zCards .cd').count(), 1);
    assert.match(await text(page, '#zCards'), /完成/);
    await page.click('#zFilters [data-f="all"]');
    assert.match(await text(page, '#zCards'), /下書き/);
    await page.screenshot({ path: path.join(SHOT, 'cho.png'), fullPage: true });
  });
  await t('公開：来週の7枚。公開予約で完成カードに公開日（下書きは付かない）。HPの読み出しには公開日まで出ない', async () => {
    await go(page, '#week');
    await page.waitForSelector('#kCards .wrow');
    assert.match(await text(page, '#kRange'), /11月9日（月）〜11月15日（日）/);
    assert.strictEqual(await page.locator('#kCards .wrow').count(), 7);
    await page.click('#kStepList [data-step="0"]');
    await page.click('#kStepList [data-step="1"]');
    await settled(page);
    const cs = of('card').map(r => r.data);
    assert.ok(cs.filter(c => c.status === 'done').every(c => c.publishAt === c.date));
    assert.ok(cs.filter(c => c.status === 'draft').every(c => !c.publishAt));
    assert.match(await text(page, '#kMsg'), /2枚を公開予約[\s\S]*下書きの1枚/);
    assert.strictEqual(gas.ctx.handle_({ action: 'hikiPublic' }).cards.length, 0, 'まだ11/5');
    gas.clockBox.t = Date.parse('2026-11-10T09:00:00+09:00');
    const pub = gas.ctx.handle_({ action: 'hikiPublic' });
    assert.deepStrictEqual(JSON.parse(JSON.stringify(pub.cards.map(c => c.no))), [2, 1]);
    assert.ok(!JSON.stringify(pub).includes('ひみつ') && !JSON.stringify(pub).includes('案件A') && !JSON.stringify(pub).includes('ブースの動線'), '案件名・工夫点は出ない');
    assert.strictEqual(pub.cards[0].note, 'https://note.com/roomin_kurashi/n/abc');
    assert.ok(/^https:\/\/drive\.google\.com\/thumbnail\?id=/.test(pub.cards[1].illust));
    gas.clockBox.t = NOW.getTime();
  });
  await t('公開：ストーリー画像を書き出す（1080×1920・枚数分）→ 3つ終えて週ボーナス +50', async () => {
    await page.evaluate(() => {
      window.__files = null;
      navigator.canShare = () => true;
      navigator.share = (d) => { window.__files = d.files.map(f => [f.name, f.type, f.size]); return Promise.resolve(); };
    });
    await page.click('#kStepList [data-step="2"]');
    await page.waitForFunction(() => window.__files);
    const files = await page.evaluate(() => window.__files);
    assert.strictEqual(files.length, 2);
    assert.ok(files.every(f => f[1] === 'image/png' && f[2] > 10000), JSON.stringify(files));
    assert.match(files[0][0], /hikidashi-001-2026-11-09\.png/);
    await settled(page);
    assert.match(await text(page, '#kBonus'), /達成/);
    await go(page, '#today');
    assert.match(await text(page, '#tNext'), /合計 90/);
    // 書き出した画像そのものを1枚、目で見る用に保存
    const png = await page.evaluate(async () => {
      const c = window.__hiki.st.cards.find(x => x.no === 1);
      const cv = HikiStory.draw(document.createElement('canvas'), c, { name: 'coto', handle: '@coto_to_design', illust: null });
      return cv.toDataURL('image/png');
    });
    fs.writeFileSync(path.join(SHOT, 'story-001.png'), Buffer.from(png.split(',')[1], 'base64'));
  });
  await t('設定：公開名義（既定 coto）と賞の締切。過ぎた締切は翌年に仮で繰り越し。4月からは今日に要確認', async () => {
    await go(page, '#settings');
    assert.strictEqual(await page.inputValue('#sName'), 'coto');
    assert.ok(of('award').filter(r => /^aw-seed-/.test(r.id)).length === 5 && all().some(r => r.id === 'aw-seeded'), '最初の5つの賞が入っている');
    await page.fill('#aName', 'テストの賞'); await page.fill('#aDate', '2026-11-20'); await page.fill('#aUrl', 'https://example.com/a');
    await page.click('#aSave');
    await page.fill('#aName', '去年の賞'); await page.fill('#aDate', '2026-03-01');
    await page.click('#aSave');
    await settled(page);
    assert.match(await text(page, '#aList'), /去年の賞[\s\S]*2027|3月1日/);
    assert.match(await text(page, '#aList'), /仮・要確認/);
    await go(page, '#today');
    assert.strictEqual(await text(page, '#tAlerts'), '', '4月まではアプリに出さない');
    await go(page, '#settings');
    await page.fill('#sAlert', '2026-11-01');
    await page.click('#sSave');
    await settled(page);
    await go(page, '#today');
    assert.match(await text(page, '#tAlerts'), /要確認：テストの賞/);
    const aw = gas.ctx.handle_({ action: 'hikiPublic' }).awards;
    assert.strictEqual(aw.length, 7, '最初に入れた5つ＋2つ');
    assert.ok(aw.filter(a => /日本空間デザイン賞|グッドデザイン賞|住まいのリフォームコンクール|JID AWARD|リノベーション・オブ・ザ・イヤー/.test(a.name)).every(a => a.tentative && a.date.startsWith('2027-')), '2026年の締切は2027年に仮で繰り越し');
  });
  await t('今日：要確認がない時期も、出し始める日を過ぎていれば次の賞の締切を1行出す', async () => {
    // テストの賞（11/20）を消すと、30日以内の締切がなくなる
    const ta = of('award').find(r => r.data.name === 'テストの賞');
    await page.evaluate(id => Apps.collection('hikidashi').remove(id), ta.id);
    await settled(page);
    await go(page, '#today');
    const tx = await text(page, '#tAlerts');
    assert.ok(!/要確認/.test(tx), tx);
    assert.match(tx, /次の賞の締切：去年の賞 3月1日/);
    assert.match(tx, /全6件を見る/);
  });
  await t('設定：ストックをCSVで取り込む（同じ名前は飛ばす／上書きを選べる・2回入れても増えない）', async () => {
    await go(page, '#settings');
    const csv = '﻿kind,type,name,from,memo,src,group\n' +
      'stock,item,LIXIL／洗濯水栓 LF-WJ50KQ,,"洗濯／発注はLF-WJ50KQA／実務で使用（7件）",desk,TheR標準・TheR.E1\n' +
      'stock,item,"カクダイ／洗濯パン, ホワイト 426-411-W",,洗濯／実務で使用（6件）,desk,\n' +
      'stock,detail,名古屋モザイク／エリアボーダー彩 LB-801-M,,洗面,desk,\n';
    const f = path.join(os.tmpdir(), 'hiki-import.csv'); fs.writeFileSync(f, csv);
    await page.setInputFiles('#cFile', f);
    await page.waitForFunction(() => /読み込んだ 3件/.test(document.getElementById('cInfo').textContent));
    await page.click('#cGo');
    await page.waitForFunction(() => /ストックに 3件入れました/.test(document.getElementById('cMsg').textContent));
    await settled(page);
    let st = of('stock').filter(r => r.data.src === 'csv');
    assert.strictEqual(st.length, 3);
    assert.ok(st.every(r => /^st-csv-/.test(r.id)));
    const pan = st.find(r => /洗濯パン/.test(r.data.name));
    assert.strictEqual(pan.data.name, 'カクダイ／洗濯パン, ホワイト 426-411-W', '引用符の中のカンマ');
    assert.strictEqual(st.find(r => /LF-WJ50KQ/.test(r.data.name)).data.group, 'TheR標準・TheR.E1');
    assert.strictEqual(st.find(r => /LB-801-M/.test(r.data.name)).data.type, 'detail');
    // 2回目：既定は飛ばす
    await page.setInputFiles('#cFile', f);
    await page.waitForFunction(() => /同じ名前がすでにある 3件/.test(document.getElementById('cInfo').textContent));
    assert.ok(await page.isVisible('#cDupBox'));
    await page.click('#cGo');
    await page.waitForFunction(() => /3件は同じ名前があるので飛ばしました/.test(document.getElementById('cMsg').textContent));
    await settled(page);
    assert.strictEqual(of('stock').filter(r => r.data.src === 'csv').length, 3, '増えない');
    // 3回目：上書き
    fs.writeFileSync(f, csv.replace('洗濯／実務で使用（6件）', '洗濯／実務で使用（8件）'));
    await page.setInputFiles('#cFile', f);
    await page.waitForFunction(() => /同じ名前がすでにある 3件/.test(document.getElementById('cInfo').textContent));
    await page.check('#cOver');
    await page.click('#cGo');
    await page.waitForFunction(() => /3件を上書きしました/.test(document.getElementById('cMsg').textContent));
    await settled(page);
    st = of('stock').filter(r => r.data.src === 'csv');
    assert.strictEqual(st.length, 3);
    assert.match(st.find(r => /洗濯パン/.test(r.data.name)).data.memo, /8件/);
    await page.screenshot({ path: path.join(SHOT, 'csv-import.png'), fullPage: true });
  });
  await noHScroll(page, 'today');
  for (const v of ['#write', '#week', '#cho', '#settings']) { await go(page, v); await page.waitForTimeout(150); await noHScroll(page, v); }
  await ctx.close();
  await browser.close();
  server.close();
  assert.deepStrictEqual(errors, []);
  console.log('\n' + passed + ' 件 すべて成功（スクショ：' + SHOT + '）');
})().catch(e => { console.error(e); process.exit(1); });
