// おしゃれ建築map の画面試験（Playwright の Chromium）
// 実行：node archmap/test/e2e.js [スクショの保存先]
//   MAPLIBRE_DIR に maplibre-gl@4.7.1 の dist フォルダを指定（試験環境は CDN に出られないため、同じ版を差し替えて読む）
//   OpenFreeMap のタイルも外に出られないため、試験用のベクタータイルで代用する（機能と配色の確認用）
// スプシ（Apps Script）は test/gas-mock.js の Code.gs に、地図タイル・ドライブの画像は試験用の画像につなぐ。
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const zlib = require('zlib');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..', '..');
const SHOT = process.argv[2] || path.join(require('os').tmpdir(), 'archmap-shots');
const MAPLIBRE = process.env.MAPLIBRE_DIR;
if (!MAPLIBRE) { console.error('MAPLIBRE_DIR を指定してください'); process.exit(2); }
fs.mkdirSync(SHOT, { recursive: true });

const gas = require(path.join(ROOT, 'test', 'gas-mock.js'))();
gas.ctx.setup();
const KEY = String(gas.ss.getSheetByName('設定').getRange('B1').getValue());
const link = gas.ctx.connectLink_(gas.ss.getSheetByName('設定'));
const hash = link.slice(link.indexOf('#'));

// 単色の PNG を作る（写真・タイルの代わり）
function png(w, h, rgb) {
  const crcT = []; for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crcT[n] = c >>> 0; }
  const crc = b => { let c = 0xffffffff; for (const x of b) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const o = y * (w * 3 + 1) + 1 + x * 3; const s = ((x >> 4) + (y >> 4)) % 2 ? 0 : 18; raw[o] = rgb[0] - s; raw[o + 1] = rgb[1] - s; raw[o + 2] = rgb[2] - s; }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
// 地図の代わり：OpenMapTiles と同じレイヤー名で作った試験用ベクタータイル（make-tile.js で作成）を全タイルに返す
const VTILE = fs.readFileSync(path.join(__dirname, 'fixture-tile.pbf'));
const TILEJSON = JSON.stringify({ tilejson: '3.0.0', minzoom: 0, maxzoom: 14,
  tiles: ['https://tiles.openfreemap.org/planet/test/{z}/{x}/{y}.pbf'],
  vector_layers: ['water', 'waterway', 'park', 'building', 'transportation', 'place'].map(id => ({ id, fields: {} })) });
const PHOTO = png(800, 600, [190, 200, 210]);

let publicJson = null; // 書き出した public.json を公開版に渡す
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
const server = http.createServer((req, res) => {
  const p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/archmap/public/public.json') {
    if (!publicJson) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(publicJson);
  }
  let f = path.join(ROOT, p);
  if (!f.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
  if (fs.existsSync(f) && fs.statSync(f).isDirectory()) f = path.join(f, 'index.html');
  if (!fs.existsSync(f)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
});

async function wire(ctx) {
  // MapLibre は jsDelivr（以前は cdnjs）から読む。どちらでも試験用の同じ版を返す
  const maplibre = r => {
    const name = new URL(r.request().url()).pathname.split('/').pop();
    return r.fulfill({ path: path.join(MAPLIBRE, name) });
  };
  await ctx.route('https://cdnjs.cloudflare.com/**', maplibre);
  await ctx.route('https://cdn.jsdelivr.net/npm/maplibre-gl@*/**', maplibre);
  await ctx.route('https://fonts.googleapis.com/**', r => r.fulfill({ contentType: 'text/css', body: '' }));
  await ctx.route('https://tiles.openfreemap.org/**', r => {
    const u = new URL(r.request().url()).pathname;
    if (u === '/planet') return r.fulfill({ contentType: 'application/json', body: TILEJSON });
    if (u.startsWith('/planet/test/')) return r.fulfill({ contentType: 'application/x-protobuf', body: VTILE });
    return r.fulfill({ status: 404, body: '' }); // 文字の形（glyphs）は無し：日本語は端末の文字で描かれる
  });
  await ctx.route('https://drive.google.com/**', r => r.fulfill({ contentType: 'image/png', body: PHOTO }));
  await ctx.route('https://script.google.com/**', r => {
    gas.clockBox.t += 1000;
    const out = gas.ctx.doPost({ postData: { contents: r.request().postData() } });
    return r.fulfill({ contentType: 'application/json', body: out.text, headers: { 'Access-Control-Allow-Origin': '*' } });
  });
}

let passed = 0;
async function t(name, fn) { await fn(); passed++; console.log('ok -', name); }
const serverList = () => gas.ctx.handle_({ key: KEY, action: 'list', app: 'archmap' }).records;

(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const BASE = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const errors = [];

  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, acceptDownloads: true,
    permissions: ['geolocation'], geolocation: { latitude: 34.6851, longitude: 135.5136 } });
  await wire(phone);
  const page = await phone.newPage();
  page.on('pageerror', e => errors.push('app: ' + e.message));

  await t('接続リンクで開くと、空の状態が出る', async () => {
    await page.goto(BASE + '/archmap/' + hash);
    await page.waitForFunction(() => window.maplibregl && document.querySelector('#map .maplibregl-canvas'));
    await page.waitForSelector('#empty:not([hidden])');
    const attr = page.locator('#map .maplibregl-ctrl-attrib');
    assert.ok(await attr.isVisible());
    assert.ok(/OpenStreetMap contributors/.test(await attr.textContent()) && /OpenFreeMap/.test(await attr.textContent()));
    assert.strictEqual(await page.locator('.ax-overlay').count(), 0);
  });

  await t('1件目：写真・現在地・ディテールのメモ・公開オンで保存', async () => {
    await page.click('#addBtn');
    await page.fill('#f-name', '（試験）川沿いの小さな美術館');
    await page.setInputFiles('#f-photo', { name: 'a.png', mimeType: 'image/png', buffer: PHOTO });
    await page.waitForSelector('#photos .ph img');
    await page.setInputFiles('#f-photo', { name: 'b.png', mimeType: 'image/png', buffer: PHOTO });
    await page.waitForFunction(() => document.querySelectorAll('#photos .ph img').length === 2 && !document.querySelector('#photos .busy'));
    await page.locator('#photos .pubbtn').nth(1).click();
    await page.click('#locBtn');
    await page.waitForFunction(() => /34\.68510/.test(document.getElementById('locTxt').textContent));
    await page.fill('#f-arch', '試験設計事務所');
    await page.fill('#f-one', '川に向かって段々に下りていく展示室');
    await page.fill('#f-tags', 'RC打放し 階段');
    await page.screenshot({ path: path.join(SHOT, 'phone-2-editor.png') });
    await page.click('#detBtn');
    await page.waitForSelector('#dtPhoto img');
    const box = await page.locator('#dtPhoto img').boundingBox();
    await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.4);
    await page.locator('.note [data-k="part"]').last().fill('手摺');
    await page.locator('.note [data-k="spec"]').last().fill('St φ34 / H=850');
    await page.locator('.note [data-k="pub"]').last().check();
    await page.mouse.click(box.x + box.width * 0.2, box.y + box.height * 0.8);
    await page.locator('.note [data-k="part"]').last().fill('段板（非公開）');
    assert.strictEqual(await page.locator('#dtPhoto .mk').count(), 2);
    await page.screenshot({ path: path.join(SHOT, 'phone-3-detail.png') });
    await page.click('#dtBack');
    await page.click('#f-pub');
    await page.click('#edSave');
    await page.waitForSelector('#editor', { state: 'hidden' });
    await page.waitForSelector('.spot');
    await page.waitForFunction(() => Apps.pendingCount().then(n => n === 0));
    await page.waitForFunction(() => !document.querySelector('.badge.wait'));
    const recs = serverList();
    assert.strictEqual(recs.length, 1);
    const d = recs[0].data;
    assert.strictEqual(d.photos.length, 2);
    assert.strictEqual(d.photos[1].pub, true);
    assert.strictEqual(d.details.length, 2);
    assert.strictEqual(d.isPublic, true);
    assert.deepStrictEqual(d.tags, ['RC打放し', '階段']);
    assert.ok(Math.abs(d.lat - 34.6851) < 1e-6);
  });

  await t('2件目：現地で名称だけ（オフライン）→ つながったら送られる', async () => {
    await phone.setOffline(true);
    await page.click('#addBtn');
    await page.fill('#f-name', '（試験）商店街の書店');
    await page.selectOption('#f-list', 'want');
    await page.click('#edSave');
    await page.waitForSelector('.spot .badge.wait');
    assert.strictEqual(serverList().length, 1);
    await phone.setOffline(false);
    await page.evaluate(() => window.dispatchEvent(new Event('online')));
    await page.waitForFunction(() => Apps.pendingCount().then(n => n === 0));
    assert.strictEqual(serverList().length, 2);
  });

  await t('手入力の緯度経度と地図タップで場所を付ける', async () => {
    await page.locator('.spot', { hasText: '商店街の書店' }).click();
    await page.click('#manual summary');
    await page.fill('#f-latlng', 'https://www.google.com/maps/place/x/@34.6702,135.5012,17z');
    await page.click('#latlngBtn');
    assert.strictEqual(await page.textContent('#locTxt'), '34.67020, 135.50120');
    const mb = await page.locator('#pickMap').boundingBox();
    await page.mouse.click(mb.x + mb.width * 0.7, mb.y + mb.height * 0.5);
    assert.notStrictEqual(await page.textContent('#locTxt'), '34.67020, 135.50120');
    await page.click('#edSave');
    await page.waitForFunction(() => Apps.pendingCount().then(n => n === 0));
    assert.strictEqual(serverList().find(r => r.data.name.includes('書店')).data.isPublic, false);
  });

  await t('カテゴリで絞り込み（ピンも連動）', async () => {
    await page.waitForFunction(() => document.querySelectorAll('#map .am-pin').length === 2);
    await page.locator('.chip', { hasText: '行きたい' }).click();
    assert.strictEqual(await page.locator('.spot').count(), 1);
    assert.strictEqual(await page.locator('#map .am-pin').count(), 1);
    await page.locator('.chip', { hasText: 'すべて' }).click();
    await page.waitForTimeout(800);
    await page.screenshot({ path: path.join(SHOT, 'phone-1-home.png') });
  });

  let exported;
  await t('公開データを書き出す（公開オンだけ・設計者と訪問日なし）', async () => {
    await page.click('#exportBtn');
    const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#exDownload')]);
    assert.strictEqual(dl.suggestedFilename(), 'public.json');
    exported = fs.readFileSync(await dl.path(), 'utf8');
    const j = JSON.parse(exported);
    assert.strictEqual(j.items.length, 1);
    const it = j.items[0];
    assert.ok(!('architect' in it) && !('visited' in it) && !('tags' in it));
    assert.ok(!exported.includes('試験設計事務所'));
    assert.deepStrictEqual(it.details, [{ part: '手摺', spec: 'St φ34 / H=850', note: '' }]);
    assert.ok(/^https:\/\/drive\.google\.com\/thumbnail\?id=/.test(it.photo));
    await page.click('#exClose');
  });

  await t('別の端末（空の端末）でつなぐと、スプシから同じ記録が届く', async () => {
    const other = await browser.newContext({ viewport: { width: 1280, height: 860 } });
    await wire(other);
    const p2 = await other.newPage();
    p2.on('pageerror', e => errors.push('pc: ' + e.message));
    await p2.goto(BASE + '/archmap/' + hash);
    await p2.waitForFunction(() => document.querySelectorAll('.spot').length === 2);
    await p2.reload();
    await p2.waitForFunction(() => document.querySelectorAll('.spot').length === 2 && document.querySelectorAll('#map .am-pin').length === 2);
    await p2.waitForTimeout(400);
    await p2.screenshot({ path: path.join(SHOT, 'pc-1-home.png') });
    await other.close();
  });

  await t('公開版：public.json が無いときは空の案内', async () => {
    const p = await phone.newPage();
    await p.goto(BASE + '/archmap/public/');
    await p.waitForSelector('.pm-list .empty');
    await p.close();
  });

  publicJson = exported;
  for (const [label, vp] of [['pc', { width: 1280, height: 900 }], ['phone', { width: 390, height: 844 }]]) {
    await t('公開版の表示（' + label + '）', async () => {
      const c = await browser.newContext({ viewport: vp });
      await wire(c);
      const p = await c.newPage();
      p.on('pageerror', e => errors.push('public: ' + e.message));
      await p.goto(BASE + '/archmap/public/');
      await p.waitForSelector('.item');
      assert.strictEqual(await p.locator('.item').count(), 1);
      assert.strictEqual(await p.locator('.am-pin').count(), 1);
      const text = await p.textContent('body');
      assert.ok(text.includes('川沿いの小さな美術館') && text.includes('手摺') && !text.includes('段板') && !text.includes('試験設計事務所') && !text.includes('2026-10'));
      assert.ok(await p.locator('.maplibregl-ctrl-attrib', { hasText: 'OpenStreetMap contributors' }).isVisible());
      assert.ok(await p.locator('.maplibregl-ctrl-attrib', { hasText: 'OpenFreeMap' }).isVisible());
      assert.ok(await p.locator('.item .pic').isVisible());
      const sw = await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
      assert.ok(sw, '横にはみ出していない');
      await p.click('.item');
      await p.waitForSelector('.am-pin.on');
      await p.waitForTimeout(1500); // 地図の描画が落ち着くのを待つ
      await p.screenshot({ path: path.join(SHOT, 'public-' + label + '.png') });
      await c.close();
    });
  }

  // ---------- 脳みそとの行き来 ----------
  const brainList = () => gas.ctx.handle_({ key: KEY, action: 'list', app: 'brain' }).records;
  const brainSent = async p => {
    for (let i = 0; i < 100; i++) {
      if (await p.evaluate(() => Apps.pendingCount().then(n => n === 0 && Apps.collection('brain').all().every(r => !r.pending)))) return;
      await p.waitForTimeout(100);
    }
    throw new Error('脳みその送信待ちが残ったまま');
  };
  const toastHas = (p, s) => p.waitForFunction(x => [...document.querySelectorAll('.ax-toast')].some(e => e.textContent.includes(x)), s);
  const museum = () => serverList().find(r => r.data.name.includes('川沿いの小さな美術館'));
  await t('脳みそ：記録から「脳みそに残す」（テイスト）→ 保存 → 建築mapに戻ると書きかけと一覧が出る', async () => {
    const rec = museum();
    await page.locator('.spot', { hasText: '川沿いの小さな美術館' }).click();
    await page.waitForSelector('#editor:not([hidden])');
    assert.strictEqual(await page.textContent('#bnLab'), '脳みそのメモ 0件');
    await page.fill('#f-one', '川に向かって段々に下りていく展示室（書きかけ）');
    await page.click('#toBrainBtn');
    await page.waitForURL(/\/brain\/$/);
    await page.waitForSelector('#editor:not([hidden])');
    assert.strictEqual(await page.inputValue('#f-title'), '（試験）川沿いの小さな美術館');
    assert.ok(/テイスト/.test(await page.textContent('#edKinds .chip.on')));
    assert.ok(await page.locator('#edSrc .src.spot').isVisible());
    assert.ok(/建築mapの建物/.test(await page.textContent('#edSrc')));
    assert.strictEqual(await page.textContent('#edSrcLab'), '出典（建物）');
    assert.ok(await page.locator('#srcPage').isHidden(), 'ページ欄は出さない');
    assert.ok(/建築mapから開きました/.test(await page.textContent('#edFromText')));
    await page.fill('#f-body', '水辺に向けて床を段々に下げる');
    await page.screenshot({ path: path.join(SHOT, 'phone-brain-editor.png') });
    await page.click('#edSave');
    await page.waitForSelector('#editor', { state: 'hidden' });
    await brainSent(page);
    const b = brainList().find(r => r.data.source && r.data.source.spotId === rec.id);
    assert.ok(b, '脳みそに出典つきで保存');
    assert.strictEqual(b.data.kind, 'T');
    const pubPhoto = rec.data.photos.find(p => p.pub).id;
    assert.deepStrictEqual(Object.keys(b.data.source).sort(), ['cover', 'spotId', 'title']);
    assert.ok(b.data.source.cover.startsWith('https://drive.google.com/thumbnail?id=' + pubPhoto));
    const go = page.locator('#detail a.src.spot');
    assert.ok(/建築mapで開く/.test(await go.textContent()));
    assert.strictEqual(await go.getAttribute('href'), '../archmap/?spot=' + rec.id);
    await page.screenshot({ path: path.join(SHOT, 'phone-brain-detail.png') });
    await page.click('#detail .back-app');
    await page.waitForURL(/\/archmap\/$/);
    await page.waitForSelector('#editor:not([hidden])');
    assert.strictEqual(await page.inputValue('#f-one'), '川に向かって段々に下りていく展示室（書きかけ）', '書きかけが戻る');
    await page.waitForFunction(() => document.querySelectorAll('#bnotes .bref').length === 1);
    assert.strictEqual(await page.textContent('#bnLab'), '脳みそのメモ 1件');
    assert.ok((await page.getAttribute('#bnotes .bref', 'href')).startsWith('../brain/?open=' + b.id));
    await page.locator('#brainFld').scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(SHOT, 'phone-brain-back.png') });
  });

  await t('脳みそ：ディテールの画面から「脳みそに残す」（ディテール）→「建築mapで開く」で戻る', async () => {
    const rec = museum();
    await page.click('#detBtn');
    await page.waitForSelector('#detail:not([hidden])');
    await page.click('#dtBrainBtn');
    await page.waitForURL(/\/brain\/$/);
    await page.waitForSelector('#editor:not([hidden])');
    assert.strictEqual(await page.inputValue('#f-title'), '（試験）川沿いの小さな美術館のディテール');
    assert.ok(/ディテール/.test(await page.textContent('#edKinds .chip.on')));
    await page.click('#edSave');
    await page.waitForSelector('#editor', { state: 'hidden' });
    await brainSent(page);
    const ds = brainList().filter(r => r.data.source && r.data.source.spotId === rec.id);
    assert.strictEqual(ds.length, 2);
    assert.ok(ds.some(r => r.data.kind === 'D'));
    // 同じ建物どうしは自動でつながる
    assert.ok(/同じ建物/.test(await page.textContent('#detail .rel')));
    await page.click('#detail a.src.spot');
    await page.waitForURL(/\/archmap\/$/);
    await page.waitForSelector('#editor:not([hidden])');
    await page.waitForFunction(() => document.querySelectorAll('#bnotes .bref').length === 2);
    // 一覧から脳みそのカードを開ける
    await page.locator('#bnotes .bref', { hasText: 'のディテール' }).click();
    await page.waitForURL(/\/brain\/$/);
    await page.waitForSelector('.app.detail-open');
    assert.ok(/のディテール/.test(await page.textContent('#detail h2')));
    await page.click('#detail .back-app');
    await page.waitForURL(/\/archmap\/$/);
    await page.waitForSelector('#editor:not([hidden])');
    // 書きかけのまま閉じる（保存しない）
    page.once('dialog', d => d.accept());
    await page.click('#edClose');
    await page.waitForSelector('#editor', { state: 'hidden' });
    assert.strictEqual(museum().data.one, '川に向かって段々に下りていく展示室', '保存していない書きかけはスプシに行かない');
  });

  await t('脳みそ：まだ保存していない新しい記録では「先に保存してください」', async () => {
    await page.click('#addBtn');
    await page.fill('#f-name', '（試験）未保存の建物');
    await page.click('#toBrainBtn');
    await toastHas(page, '先に保存してください');
    assert.ok(/\/archmap\/$/.test(page.url()));
    assert.ok(/保存すると/.test(await page.textContent('#bnotes')));
    page.once('dialog', d => d.accept());
    await page.click('#edClose');
    await page.waitForSelector('#editor', { state: 'hidden' });
  });

  await t('?spot=<id> で開くとその記録が開き、URL から消える。無い id は知らせる', async () => {
    const rec = museum();
    await page.goto(BASE + '/archmap/?spot=' + encodeURIComponent(rec.id));
    await page.waitForSelector('#editor:not([hidden])');
    assert.strictEqual(await page.inputValue('#f-name'), '（試験）川沿いの小さな美術館');
    assert.ok(/\/archmap\/$/.test(page.url()));
    await page.waitForFunction(() => document.querySelectorAll('#bnotes .bref').length === 2);
    await page.click('#edClose');
    await page.waitForSelector('#editor', { state: 'hidden' });
    await page.goto(BASE + '/archmap/?spot=nope-123');
    await toastHas(page, 'その記録はまだこの端末にありません');
    assert.ok(await page.locator('#editor').isHidden());
  });

  await t('アプリも横にはみ出さない（390px）', async () => {
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
  });

  await t('画面のエラーなし', async () => { assert.deepStrictEqual(errors, []); });

  await browser.close();
  server.close();
  console.log(`\n${passed} 件 すべて成功（スクショ：${SHOT}）`);
})().catch(async e => { console.error(e); process.exit(1); });
