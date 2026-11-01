// 本棚 の画面試験（Playwright の Chromium）＋ 脳みそとの連携（本棚の中で書く → 脳みそが番号を振る → 出典のシート）
// 実行：node hondana/test/e2e.js [スクショの保存先]
// スプシ（Apps Script）は test/gas-mock.js の Code.gs に、openBD・Google Books・表紙画像は試験用の返事につなぐ。
// バーコード読み取りの部品（@zxing/browser@0.1.5）は CDN の代わりに npm から取ったものを使う（ZXING_UMD で場所を指定可）。
// カメラは Chromium の疑似カメラに、バーコードを描いた動画（y4m）を流す。
'use strict';
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');
const zlib = require('zlib');
const { execSync } = require('child_process');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..', '..');
const SHOT = process.argv[2] || path.join(os.tmpdir(), 'hondana-shots');
fs.mkdirSync(SHOT, { recursive: true });
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'hondana-'));

// ---------- 部品 ----------
function zxingFile() {
  if (process.env.ZXING_UMD && fs.existsSync(process.env.ZXING_UMD)) return process.env.ZXING_UMD;
  const dir = path.join(os.tmpdir(), 'zxing-browser-0.1.5');
  const f = path.join(dir, 'package', 'umd', 'zxing-browser.min.js');
  if (!fs.existsSync(f)) {
    fs.mkdirSync(dir, { recursive: true });
    execSync('npm pack @zxing/browser@0.1.5 --silent', { cwd: dir });
    execSync('tar xzf zxing-browser-0.1.5.tgz', { cwd: dir });
  }
  return f;
}

// ---------- ISBN とバーコード ----------
function isbn13(first12) {
  let s = 0;
  for (let i = 0; i < 12; i++) s += +first12[i] * (i % 2 ? 3 : 1);
  return first12 + ((10 - s % 10) % 10);
}
const ISBN_A = isbn13('978410100101');   // openBD にある（表紙なし → Google Books の表紙）
const ISBN_B = isbn13('978448000000');   // openBD に無く Google Books にある
const ISBN_C = isbn13('978400000000');   // どこにも無い
const ISBN_S = isbn13('978476000000');   // 書名検索で出る本
const L = ['0001101', '0011001', '0010011', '0111101', '0100011', '0110001', '0101111', '0111011', '0110111', '0001011'];
const G = L.map(c => c.split('').map(x => x === '0' ? '1' : '0').reverse().join(''));
const R = L.map(c => c.split('').map(x => x === '0' ? '1' : '0').join(''));
const PAR = ['LLLLLL', 'LLGLGG', 'LLGGLG', 'LLGGGL', 'LGLLGG', 'LGGLLG', 'LGGGLL', 'LGLGLG', 'LGLGGL', 'LGGLGL'];
function ean13bits(code) {
  const d = code.split('').map(Number);
  let b = '101';
  for (let i = 1; i <= 6; i++) b += (PAR[d[0]][i - 1] === 'L' ? L : G)[d[i]];
  b += '01010';
  for (let i = 7; i <= 12; i++) b += R[d[i]];
  return b + '101';
}
// 灰色の画素（0=黒,255=白）で、幅 w・高さ h の中央にバーコード
function barcodeGray(code, w, h, mod) {
  const bits = ean13bits(code), px = Buffer.alloc(w * h, 255);
  const bw = bits.length * mod, x0 = Math.round((w - bw) / 2), y0 = Math.round(h / 2 - h * 0.15), y1 = Math.round(h / 2 + h * 0.15);
  for (let y = y0; y < y1; y++) for (let i = 0; i < bits.length; i++) if (bits[i] === '1') for (let k = 0; k < mod; k++) px[y * w + x0 + i * mod + k] = 0;
  return px;
}
function pngGray(gray, w, h) {
  const crcT = []; for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crcT[n] = c >>> 0; }
  const crc = b => { let c = 0xffffffff; for (const x of b) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 0;
  const raw = Buffer.alloc((w + 1) * h);
  for (let y = 0; y < h; y++) gray.copy(raw, y * (w + 1) + 1, y * w, y * w + w);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
function y4m(gray, w, h, frames) {
  const uv = Buffer.alloc(w * h / 4, 128);
  const parts = [Buffer.from(`YUV4MPEG2 W${w} H${h} F10:1 Ip A1:1 C420jpeg\n`)];
  for (let i = 0; i < frames; i++) parts.push(Buffer.from('FRAME\n'), gray, uv, uv);
  return Buffer.concat(parts);
}
const VIDEO = path.join(TMP, 'barcode.y4m');
fs.writeFileSync(VIDEO, y4m(barcodeGray(ISBN_A, 640, 480, 3), 640, 480, 10));
const PHOTO_B = pngGray(barcodeGray(ISBN_B, 1200, 900, 5), 1200, 900);
const COVER = pngGray(Buffer.alloc(60 * 90, 120), 60, 90);

// ---------- スプシ（モック） ----------
const gas = require(path.join(ROOT, 'test', 'gas-mock.js'))();
gas.ctx.setup();
const KEY = String(gas.ss.getSheetByName('設定').getRange('B1').getValue());
const link = gas.ctx.connectLink_(gas.ss.getSheetByName('設定'));
const hash = link.slice(link.indexOf('#'));
const H = req => gas.ctx.handle_(Object.assign({ key: KEY }, req));
const serverList = app => H({ action: 'list', app }).records;
const books = () => serverList('hondana').filter(r => r.data && r.data.t === 'book');
const bookBy = s => books().find(r => r.data.title.includes(s));
const cards = () => serverList('brain').filter(r => r.data && r.data.t === 'k');

// 今までの脳みそのデータ（書き換わらないことを確かめる）。追加の種類に「B」を自分で作っていた場合も想定
H({ action: 'put', app: 'brain', id: 'kinds', data: { t: 'kinds', list: [{ c: 'B', name: 'ブログ' }, { c: 'P', name: 'プレゼン' }] } });
H({ action: 'put', app: 'brain', id: 'old-d1', data: { t: 'k', kind: 'D', no: 1, title: '（試験）框なし引戸の納まり', body: '既存', tags: ['照明'], photos: [], links: [], uses: [{ name: 'M邸', date: '2026-10-01' }] } });
const before = Object.fromEntries(serverList('brain').map(r => [r.id, JSON.stringify(r)]));

// ---------- 配信 ----------
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
const CORS = { 'Access-Control-Allow-Origin': '*' };
const json = (r, body) => r.fulfill({ contentType: 'application/json', body: JSON.stringify(body), headers: CORS });
const gbVol = (isbn, title, authors, pub) => ({ volumeInfo: { title, authors, publisher: pub, industryIdentifiers: [{ type: 'ISBN_13', identifier: isbn }],
  imageLinks: { thumbnail: 'http://books.google.com/books/content?id=' + isbn + '&printsec=frontcover&img=1&zoom=1&edge=curl' } } });
const calls = { openbd: 0, google: 0 };
async function wire(ctx) {
  await ctx.route('https://fonts.googleapis.com/**', r => r.fulfill({ contentType: 'text/css', body: '' }));
  await ctx.route('https://drive.google.com/**', r => r.fulfill({ contentType: 'image/png', body: COVER }));
  await ctx.route('https://books.google.com/**', r => r.fulfill({ contentType: 'image/png', body: COVER, headers: CORS }));
  await ctx.route('https://cdn.jsdelivr.net/npm/@zxing/browser@0.1.5/umd/zxing-browser.min.js', r => r.fulfill({ contentType: 'text/javascript', body: fs.readFileSync(zxingFile()) }));
  await ctx.route('https://api.openbd.jp/**', r => {
    calls.openbd++;
    const isbn = new URL(r.request().url()).searchParams.get('isbn');
    if (isbn === ISBN_A) return json(r, [{ summary: { isbn, title: '（試験）陰翳礼讃', volume: '', author: '谷崎潤一郎／著', publisher: '試験文庫', cover: '' } }]);
    if (isbn === ISBN_S) return json(r, [{ summary: { isbn, title: '（試験）住まいの解剖図鑑', volume: '', author: '増田奏／著 山田／イラスト', publisher: '試験社', cover: '' } }]);
    return json(r, [null]);
  });
  await ctx.route('https://ndlsearch.ndl.go.jp/api/**', r => r.fulfill({ contentType: 'application/xml', headers: CORS, body: '<rss version="2.0"><channel></channel></rss>' }));
  await ctx.route('https://www.googleapis.com/books/**', r => {
    calls.google++;
    const q = new URL(r.request().url()).searchParams.get('q');
    if (q === 'isbn:' + ISBN_A) return json(r, { totalItems: 1, items: [gbVol(ISBN_A, '陰翳礼讃', ['谷崎潤一郎'], '試験文庫')] });
    if (q === 'isbn:' + ISBN_B) return json(r, { totalItems: 1, items: [gbVol(ISBN_B, '（試験）建築家なしの建築', ['B.ルドフスキー'], '試験書房')] });
    if (/住まい/.test(q)) return json(r, { totalItems: 2, items: [gbVol(ISBN_S, '住まいの解剖図鑑', ['増田奏'], '試験社'), gbVol(isbn13('978476000001'), '（試験）収納の図鑑', ['例 著者'], '試験社')] });
    return json(r, { totalItems: 0 });
  });
  await ctx.route('https://script.google.com/**', r => {
    gas.clockBox.t += 1000;
    const out = gas.ctx.doPost({ postData: { contents: r.request().postData() } });
    return r.fulfill({ contentType: 'application/json', body: out.text, headers: CORS });
  });
}
let passed = 0;
async function t(name, fn) { await fn(); passed++; console.log('ok -', name); }
async function settled(page) {
  for (let i = 0; i < 100; i++) {
    if (await page.evaluate(() => Apps.pendingCount().then(n => n === 0 && ['brain', 'hondana'].every(a => Apps.collection(a).all().every(r => !r.pending))))) return;
    await page.waitForTimeout(100);
  }
  throw new Error('送信待ちが残ったまま');
}
const today = () => { const d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };

(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const BASE = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--use-file-for-fake-video-capture=' + VIDEO] });
  const errors = [];

  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, permissions: ['camera'] });
  await wire(phone);
  const page = await phone.newPage();
  page.on('pageerror', e => errors.push('phone: ' + e.message));
  page.on('console', m => { if (m.type() === 'error' && !/favicon/.test(m.text())) errors.push('phone console: ' + m.text()); });
  page.on('dialog', d => d.accept());

  await t('構文：ISBN の変換・著者名の整え', async () => {
    await page.goto(BASE + '/hondana/' + hash);
    await page.waitForSelector('#emptyShelf:not([hidden])');
    const r = await page.evaluate(() => [
      __hondana.toIsbn13('4-10-100101-?'), __hondana.toIsbn13('4101001014'), __hondana.toIsbn13('978-4-10-100101-' + '0'),
      __hondana.cleanAuthor('谷崎潤一郎／著 山田太郎／訳')]);
    assert.strictEqual(r[0], '');
    assert.ok(/^978410100101\d$/.test(r[1]), r[1]);
    assert.strictEqual(r[3], '谷崎潤一郎、山田太郎');
    await page.screenshot({ path: path.join(SHOT, 'phone-0-empty.png') });
  });

  await t('ジャンル：追加・名前変更・並べ替え', async () => {
    await page.click('[data-go=genres]');
    for (const n of ['建築・デザイン', '片づけ・暮らし', '経営', '小説']) { await page.fill('#gname', n); await page.click('#gadd button'); await page.waitForSelector(`#glist >> text=${n}`); }
    await page.locator('.grow', { hasText: '経営' }).locator('[data-gedit]').click();
    await page.fill('#gEdit', '経営・仕事');
    await page.keyboard.press('Enter');
    await page.waitForSelector('#glist >> text=経営・仕事');
    await page.locator('.grow', { hasText: '小説' }).locator('[data-up]').click();
    await page.waitForFunction(() => [...document.querySelectorAll('#glist .nm')].map(e => e.textContent).join('|') === '建築・デザイン|片づけ・暮らし|小説|経営・仕事|未分類');
    await page.screenshot({ path: path.join(SHOT, 'phone-1-genres.png') });
    await page.click('#scrGenres [data-go=shelf]');
  });

  await t('バーコード（疑似カメラ）→ openBD → 表紙は Google Books → 棚へ', async () => {
    await page.click('.tabbar .new');
    await page.waitForSelector('#scanResult:not([hidden])', { timeout: 20000 });
    await page.waitForSelector('#foundBox >> text=陰翳礼讃');
    assert.ok((await page.textContent('#foundBox')).includes('谷崎潤一郎'), await page.textContent('#foundBox'));
    assert.ok(await page.isVisible('#foundBox >> text=ISBNから見つかりました'));
    await page.locator('#nSt button', { hasText: '読んだ' }).click();
    await page.locator('#nG .chip', { hasText: '建築・デザイン' }).click();
    await page.screenshot({ path: path.join(SHOT, 'phone-2-found.png') });
    await page.click('#nSave');
    await page.waitForSelector('#scrShelf.on');
    await settled(page);
    const b = bookBy('陰翳礼讃');
    assert.strictEqual(b.data.isbn, ISBN_A);
    assert.strictEqual(b.data.status, 'done');
    assert.strictEqual(b.data.doneOn, today());
    assert.ok(/^https:\/\/books\.google\.com\/.*img=1/.test(b.data.cover) && !/edge=curl/.test(b.data.cover), b.data.cover);
    assert.strictEqual(b.data.author, '谷崎潤一郎');
    // カメラは止まっている
    assert.strictEqual(await page.evaluate(() => !!document.getElementById('video').srcObject), false);
  });

  await t('写真から読み取る（openBD に無い → Google Books）・同じ本は知らせる', async () => {
    await page.click('.tabbar .new');
    await page.setInputFiles('#scanFile', { name: 'b.png', mimeType: 'image/png', buffer: PHOTO_B });
    await page.waitForSelector('#foundBox >> text=建築家なしの建築', { timeout: 20000 });
    // 前に選んだジャンルを覚えている
    assert.strictEqual(await page.textContent('#nG .chip.on'), '建築・デザイン');
    await page.locator('#nG .chip', { hasText: '未分類' }).click();
    await page.click('#nSave');
    await page.waitForSelector('#scrShelf.on');
    // ISBN 入力：もう棚にある本
    await page.click('.tabbar .new');
    await page.fill('#isbnIn', ISBN_A);
    await page.click('#isbnForm button');
    await page.waitForSelector('#dupBox .dup');
    assert.strictEqual(await page.textContent('#nSave'), 'それでも棚に入れる');
    await page.click('#scrScan [data-go=shelf]');
  });

  await t('どこにも無い ISBN → 書名を手で入れて棚へ（未分類）', async () => {
    await page.click('.tabbar .new');
    await page.fill('#isbnIn', ISBN_C);
    await page.click('#isbnForm button');
    await page.waitForSelector('#nTitle');
    await page.locator('#nG .chip', { hasText: '未分類' }).click();
    await page.click('#nSave');  // 書名なし → 入らない
    assert.ok(await page.isVisible('#scanResult'));
    await page.fill('#nTitle', '（試験）手入れの本');
    await page.fill('#nAuthor', '（試験）著者');
    await page.click('#nSave');
    await page.waitForSelector('#scrShelf.on');
    await settled(page);
    const b = bookBy('手入れの本');
    assert.strictEqual(b.data.isbn, ISBN_C);
    assert.strictEqual(b.data.genre, '');
    assert.strictEqual(b.data.status, 'want');
  });

  await t('書名で探す → 追加（ISBN があれば openBD で引き直す）・手で入れる', async () => {
    await page.click('.tabbar [data-go=search]');
    await page.fill('#sq', '住まい 収納');
    await page.click('#sForm button');
    await page.waitForSelector('#hits .hit');
    assert.strictEqual(await page.locator('#hits .hit').count(), 2);
    await page.screenshot({ path: path.join(SHOT, 'phone-3-search.png') });
    await page.locator('#hits .hit', { hasText: '住まいの解剖図鑑' }).click();
    await page.waitForSelector('#foundBox >> text=（試験）住まいの解剖図鑑');
    await page.locator('#nG .chip', { hasText: '片づけ・暮らし' }).click();
    await page.click('#nSave');
    await page.waitForSelector('#scrSearch.on');
    await page.waitForSelector('#hits .hit .have');
    await page.click('#manualBtn');
    await page.fill('#mTitle', '（試験）小説の本');
    await page.click('#manualForm button[type=submit]');
    await page.waitForSelector('#scanResult:not([hidden])');
    await page.locator('#nG .chip', { hasText: '小説' }).click();
    await page.click('#nSave');
    await page.waitForSelector('#scrSearch.on');
    await settled(page);
    assert.strictEqual(bookBy('住まいの解剖図鑑').data.author, '増田奏、山田');
    assert.ok(bookBy('小説の本'));
    await page.click('#scrSearch [data-go=shelf]');
  });

  await t('棚：ジャンル別の段・状態とジャンルで絞り込み', async () => {
    await page.waitForFunction(() => document.querySelectorAll('#shelves .book').length === 5);
    const heads = await page.$$eval('#shelves .shelf-h h3', a => a.map(e => e.textContent));
    assert.deepStrictEqual(heads, ['建築・デザイン', '片づけ・暮らし', '小説', '経営・仕事', '未分類']);
    await page.screenshot({ path: path.join(SHOT, 'phone-4-shelf.png') });
    await page.locator('#stSeg button', { hasText: '読んだ' }).click();
    assert.strictEqual(await page.locator('#shelves .book').count(), 1);
    await page.locator('#stSeg button', { hasText: 'すべて' }).click();
    await page.locator('#gChips .chip', { hasText: '未分類' }).click();
    assert.strictEqual(await page.locator('#shelves .book').count(), 2);
    await page.locator('#gChips .chip', { hasText: '全ジャンル' }).click();
    assert.strictEqual(await page.locator('#stSeg button').count(), 3); // すべて・読みたい・読んだ（読んでるは無い）
  });

  await t('詳細：状態・★・ジャンル・読み終えた日・ひとことメモ', async () => {
    await page.locator('#shelves .book[aria-label*="建築家なし"]').click();
    await page.waitForSelector('#scrDetail.on');
    await page.locator('#detail .seg button', { hasText: '読んだ' }).click();
    await page.waitForSelector('#ddone');
    assert.strictEqual(await page.inputValue('#ddone'), today());
    await page.fill('#ddone', '2026-09-14');
    await page.dispatchEvent('#ddone', 'change');
    await page.click('#detail [data-star="4"]');
    await page.locator('#dGenres .chip', { hasText: '建築・デザイン' }).click();
    await page.fill('#dmemo', '（試験）ヴァナキュラー');
    await page.click('#detail h3');
    await settled(page);
    const b = bookBy('建築家なし').data;
    assert.deepStrictEqual([b.status, b.doneOn, b.rating, b.memo], ['done', '2026-09-14', 4, '（試験）ヴァナキュラー']);
    assert.strictEqual(b.genre, bookBy('陰翳礼讃').data.genre);
    await page.locator('#detail .seg button', { hasText: '読みたい' }).click();
    await page.waitForSelector('#ddone', { state: 'detached' });
    await page.waitForTimeout(200);
    await settled(page);
    assert.strictEqual(bookBy('建築家なし').data.doneOn, '');
    await page.click('#scrDetail [data-go=shelf]');
  });

  // ---------- 脳みそとの連携：本棚の中で書く（脳みそへは飛ばない）→ 番号は脳みそが振る ----------
  const noteBy = s => cards().find(r => r.data.title.includes(s));
  await t('「脳みそにメモを作る」→ 本棚の中のシートで書く → 番号なし（no:null）で脳みそへ送られる', async () => {
    await page.locator('#shelves .book[aria-label*="陰翳礼讃"]').click();
    assert.ok(await page.isVisible('#detail >> text=この本から作ったメモはまだありません'));
    await page.screenshot({ path: path.join(SHOT, 'phone-5-detail.png') });
    await page.click('#makeNote');
    await page.waitForSelector('.bn-overlay');
    assert.ok(/\/hondana\/$/.test(page.url()), '本棚から出ない');
    assert.strictEqual(await page.getAttribute('.bn-kinds .bn-chip.on', 'data-bnkind'), 'B');
    // 追加の種類の「B（ブログ）」は重ねて出さない・「プレゼン」は出る
    assert.strictEqual(await page.locator('.bn-kinds [data-bnkind=B]').count(), 1);
    assert.ok(await page.isVisible('.bn-kinds >> text=プレゼン'));
    assert.ok(await page.isVisible('.bn-src >> text=陰翳礼讃'));
    assert.ok(await page.isVisible('.bn-numline >> text=番号は脳みそを開くと付きます'));
    await page.fill('.bn-form [name=page]', 'p.32');
    await page.fill('.bn-form [name=title]', '（試験）暗がりがあるから金が映える');
    await page.fill('.bn-form [name=body]', '（試験）蒔絵は暗い所で見るもの');
    await page.fill('.bn-form [name=tags]', '照明 陰影');
    await page.screenshot({ path: path.join(SHOT, 'phone-6-note-sheet.png') });
    await page.click('.bn-form [data-bn=save]');
    await page.waitForSelector('.bn-overlay', { state: 'detached' });
    await page.waitForSelector('#detail .nref >> text=暗がりがあるから金が映える');
    await settled(page);
    const c = noteBy('暗がり');
    const book = bookBy('陰翳礼讃');
    assert.strictEqual(c.data.no, null);
    assert.strictEqual(c.data.kind, 'B');
    assert.strictEqual(c.data.createdIn, 'hondana');
    assert.deepStrictEqual(c.data.links, []);
    assert.deepStrictEqual(c.data.uses, []);
    assert.deepStrictEqual(c.data.tags, ['照明', '陰影']);
    assert.deepStrictEqual(c.data.source, { bookId: book.id, title: '（試験）陰翳礼讃', author: '谷崎潤一郎', cover: book.data.cover, page: 'p.32' });
    assert.ok(/—/.test(await page.textContent('#detail .nref .circ')), '番号がまだのときは —');
    assert.ok(await page.isVisible('#detail .nonum'));
    assert.ok(await page.isVisible('#detail .nref >> text=p.32'));
    await page.screenshot({ path: path.join(SHOT, 'phone-7-detail-notes.png') });
  });

  await t('オフラインで書く → 送信待ち → つながったら送る', async () => {
    await phone.setOffline(true);
    await page.click('#makeNote');
    await page.waitForSelector('.bn-overlay');
    await page.fill('.bn-form [name=title]', '（試験）障子越しの光は面で効く');
    await page.click('.bn-form [data-bn=save]');
    await page.waitForSelector('#detail .nref >> text=障子越しの光は面で効く');
    assert.ok(await page.isVisible('#detail .nref:has-text("障子越し") .wait'), '送信待ちと出る');
    await page.waitForTimeout(400);
    assert.strictEqual(await page.evaluate(() => Apps.collection('brain').pendingCount()), 1);
    assert.ok(/送信待ち 1件/.test(await page.textContent('#pend')));
    assert.ok(!noteBy('障子越し'), 'オフライン中はスプシに行かない');
    await phone.setOffline(false);
    await page.evaluate(() => window.dispatchEvent(new Event('online')));
    await settled(page);
    const c = noteBy('障子越し');
    assert.ok(c && c.data.no === null && c.data.createdIn === 'hondana');
    assert.strictEqual(await page.locator('#detail .nref').count(), 2);
  });

  // 脳みそは別のホーム画面アプリ（＝保存場所が別）として開く
  const bctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true });
  await wire(bctx);
  const bpage = await bctx.newPage();
  bpage.on('pageerror', e => errors.push('brain: ' + e.message));
  bpage.on('console', m => { if (m.type() === 'error' && !/favicon/.test(m.text())) errors.push('brain console: ' + m.text()); });
  await t('脳みそを開くと番号が振られ（作成順・既存は書き換えない）一覧に出る', async () => {
    await bpage.goto(BASE + '/brain/' + hash);
    await bpage.waitForFunction(() => document.querySelectorAll('#list .item').length === 3);
    await bpage.waitForFunction(() => /B-002/.test(document.getElementById('list').textContent), null, { timeout: 10000 });
    await settled(bpage);
    assert.strictEqual(noteBy('暗がり').data.no, 1);
    assert.strictEqual(noteBy('障子越し').data.no, 2);
    const nos = await bpage.$$eval('#list .item .no', a => a.map(e => e.textContent));
    assert.ok(nos.includes('B-001') && nos.includes('B-002') && nos.includes('D-001'), nos.join(','));
    // もう一度読み込んでも振り直さない
    await bpage.reload();
    await bpage.waitForFunction(() => document.querySelectorAll('#list .item').length === 3);
    await bpage.waitForTimeout(300);
    await settled(bpage);
    assert.strictEqual(noteBy('暗がり').data.no, 1);
    assert.strictEqual(cards().filter(r => r.data.kind === 'B').map(r => r.data.no).sort().join(','), '1,2');
    await bpage.screenshot({ path: path.join(SHOT, 'phone-8-brain-numbered.png') });
  });

  await t('脳みそ：「本棚で開く」は飛ばずに出典の本をシートで見せる', async () => {
    await bpage.locator('#list .item', { hasText: '暗がりがあるから' }).click();
    await bpage.waitForSelector('.app.detail-open');
    assert.ok(await bpage.isVisible('#detail .rel-item >> text=框なし引戸'), '同じタグ（照明）で既存カードとつながる');
    assert.ok(/（本棚で）/.test(await bpage.textContent('#detail .dt-foot')), '作成元が出る');
    await bpage.click('#detail .src[data-srcopen]');
    await bpage.waitForSelector('#srcSheet:not([hidden])');
    assert.ok(/\/brain\/$/.test(bpage.url()), '脳みそから出ない');
    const tx = await bpage.textContent('#ssBody');
    assert.ok(tx.includes('陰翳礼讃') && tx.includes('谷崎潤一郎') && tx.includes('読んだ'), tx);
    const book = bookBy('陰翳礼讃');
    assert.strictEqual(await bpage.getAttribute('#ssBody .ss-open', 'href'), '../hondana/?book=' + book.id);
    assert.ok(await bpage.isVisible('#ssBody .cover img'));
    await bpage.screenshot({ path: path.join(SHOT, 'phone-9-brain-src-sheet.png') });
    await bpage.click('#srcSheet [data-ssclose]');
    await bpage.waitForSelector('#srcSheet', { state: 'hidden' });
    await bpage.click('#dtBack');
  });

  await t('本棚に戻ると番号付きで出る・中身を見て、その場で直せる', async () => {
    // アプリに戻った（前面に来た）ときの自動同期
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await page.waitForFunction(() => [...document.querySelectorAll('#detail .nref .circ')].map(e => e.textContent).join('|') === 'B001|B002');
    assert.ok(await page.isHidden('#detail .nonum'));
    await page.locator('#detail .nref', { hasText: '暗がり' }).click();
    await page.waitForSelector('.bn-overlay .bn-view');
    const v = await page.textContent('.bn-view');
    assert.ok(v.includes('B-001') && v.includes('蒔絵は暗い所で見るもの') && v.includes('#照明'), v);
    await page.screenshot({ path: path.join(SHOT, 'phone-10-note-view.png') });
    await page.click('.bn-view [data-bn=edit]');
    await page.waitForSelector('.bn-form');
    assert.ok(await page.isVisible('.bn-numline >> text=B-001'));
    assert.strictEqual(await page.inputValue('.bn-form [name=page]'), 'p.32');
    await page.fill('.bn-form [name=body]', '（試験）蒔絵は暗い所で見るもの。金は闇で光る');
    await page.click('.bn-form [data-bn=save]');
    await page.waitForSelector('.bn-overlay', { state: 'detached' });
    await settled(page);
    const c = noteBy('暗がり');
    assert.strictEqual(c.data.body, '（試験）蒔絵は暗い所で見るもの。金は闇で光る');
    assert.strictEqual(c.data.no, 1, '番号はそのまま');
    assert.strictEqual(c.data.source.page, 'p.32');
  });

  await t('脳みそ：ひらめきは1行だけで書ける・一覧と図に新しい種類', async () => {
    await bpage.click('.tab-new');
    await bpage.locator('#edKinds .chip', { hasText: 'ひらめき' }).click();
    assert.ok(await bpage.isHidden('#edSrcFld'));
    assert.ok(/1行/.test(await bpage.getAttribute('#f-title', 'placeholder')));
    await bpage.fill('#f-title', '（試験）玄関に一時置きの棚を必ず提案する');
    await bpage.click('#edSave');
    await bpage.waitForSelector('.app.detail-open');
    await settled(bpage);
    const h = cards().find(r => r.data.kind === 'H');
    assert.strictEqual(h.data.no, 1);
    assert.ok(!h.data.source);
    await bpage.click('#dtBack');
    const chips = await bpage.$$eval('#kinds .chip', a => a.map(e => e.textContent.replace(/\d+$/, '')));
    assert.ok(chips.includes('本のメモ') && chips.includes('ひらめき') && chips.includes('プレゼン'), chips.join(','));
    assert.ok(!chips.includes('ブログ'));
    assert.strictEqual(await bpage.locator('#list .item').count(), 4);
    await bpage.screenshot({ path: path.join(SHOT, 'phone-9-brain-list.png') });
    await bpage.locator('#tabbar [data-view=graph]').click();
    await bpage.waitForFunction(() => document.getElementById('graph').dataset.nodes === '4');
    const ds = await bpage.evaluate(() => ({ ...document.getElementById('graph').dataset }));
    assert.ok(+ds.edges >= 2, '同じ本・同じタグの線 ' + ds.edges);
    await bpage.waitForTimeout(800);
    await bpage.screenshot({ path: path.join(SHOT, 'phone-10-brain-graph.png') });
    // 設定：本のメモ・ひらめきは外せない
    await bpage.click('#settingsBtn');
    for (const n of ['本のメモ', 'ひらめき']) assert.strictEqual(await bpage.locator('#stKinds div', { hasText: n }).locator('[data-rmkind]').count(), 0);
    await bpage.click('#stClose');
  });

  await bctx.close();
  await t('今までの脳みそのデータは書き換わらない', async () => {
    const now = Object.fromEntries(serverList('brain').map(r => [r.id, JSON.stringify(r)]));
    for (const id of Object.keys(before)) assert.strictEqual(now[id], before[id], id);
  });

  await t('入口の戻り先は同じサイトの中だけ', async () => {
    await page.goto(BASE + '/brain/?new=H&title=' + encodeURIComponent('（試験）下書き') + '&back=' + encodeURIComponent('https://example.com/') + '&from=x');
    await page.waitForSelector('#editor:not([hidden])');
    assert.strictEqual(await page.inputValue('#f-title'), '（試験）下書き');
    assert.ok(await page.isHidden('#fromBar'));
    await page.click('#edCancel');
  });

  await t('ジャンルを消すと、その棚の本は未分類へ', async () => {
    await page.goto(BASE + '/hondana/');
    await page.waitForSelector('#shelves .book');
    await page.click('[data-go=genres]');
    await page.locator('.grow', { hasText: '片づけ・暮らし' }).locator('[data-gdel]').click();
    assert.ok(await page.isVisible('#delAsk >> text=1冊は「未分類」に移ります'));
    await page.click('[data-gdelok]');
    await page.waitForFunction(() => !/片づけ・暮らし/.test(document.getElementById('glist').textContent));
    await settled(page);
    assert.strictEqual(bookBy('住まいの解剖図鑑').data.genre, '');
    await page.click('#scrGenres [data-go=shelf]');
  });

  await t('オフライン：棚を開ける・変更は送信待ち → つながったら送る', async () => {
    await page.waitForFunction(() => navigator.serviceWorker && navigator.serviceWorker.controller);
    await phone.setOffline(true);
    await page.reload();
    await page.waitForFunction(() => document.querySelectorAll('#shelves .book').length === 5);
    await page.locator('#shelves .book[aria-label*="小説の本"]').click();
    await page.click('#detail [data-star="5"]');
    await page.waitForSelector('#detail .dfoot >> text=送信待ち');
    assert.strictEqual(bookBy('小説の本').data.rating, 0);
    await page.click('#scrDetail [data-go=shelf]');
    await page.waitForSelector('#pend:not([hidden])');
    await page.click('.tabbar .new');
    await page.waitForSelector('#scanMsg >> text=オフラインです');
    await page.click('#scrScan [data-go=shelf]');
    await phone.setOffline(false);
    await page.evaluate(() => window.dispatchEvent(new Event('online')));
    await settled(page);
    assert.strictEqual(bookBy('小説の本').data.rating, 5);
  });

  // ---------- 広い画面（iPad・パソコン） ----------
  for (const [name, vp] of [['ipad', { width: 820, height: 1180 }], ['pc', { width: 1280, height: 800 }]]) {
    const ctx = await browser.newContext({ viewport: vp });
    await wire(ctx);
    const pg = await ctx.newPage();
    pg.on('pageerror', e => errors.push(name + ': ' + e.message));
    await t(name + '：同期されて棚が崩れずに並ぶ', async () => {
      await pg.goto(BASE + '/hondana/' + hash);
      await pg.waitForFunction(() => document.querySelectorAll('#shelves .book').length === 5);
      const sw = await pg.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
      assert.ok(sw, '横にはみ出さない');
      await pg.screenshot({ path: path.join(SHOT, name + '-shelf.png') });
      await pg.locator('#shelves .book[aria-label*="陰翳礼讃"]').click();
      await pg.waitForSelector('#detail .nref');
      await pg.screenshot({ path: path.join(SHOT, name + '-detail.png') });
    });
    await ctx.close();
  }

  // ダーク
  const dark = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: 'dark', deviceScaleFactor: 2 });
  await wire(dark);
  const dp = await dark.newPage();
  dp.on('pageerror', e => errors.push('dark: ' + e.message));
  await dp.goto(BASE + '/hondana/' + hash);
  await dp.waitForFunction(() => document.querySelectorAll('#shelves .book').length === 5);
  await dp.screenshot({ path: path.join(SHOT, 'dark-shelf.png') });
  await dp.goto(BASE + '/brain/');
  await dp.waitForFunction(() => document.querySelectorAll('#list .item').length === 4);
  await dp.screenshot({ path: path.join(SHOT, 'dark-brain.png') });

  await browser.close();
  server.close();
  console.log('openBD ' + calls.openbd + '回・Google Books ' + calls.google + '回（試験用の返事）');
  if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
  console.log(passed + ' passed');
})().catch(e => { console.error(e); process.exit(1); });
