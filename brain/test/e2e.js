// 脳みそポートフォリオ の画面試験（Playwright の Chromium）
// 実行：node brain/test/e2e.js [スクショの保存先]
// 後半は実績（ポートフォリオ）・公開ページ（brain/public/）・貼って取り込む（noteネタ・日記）
// スプシ（Apps Script）は test/gas-mock.js の Code.gs に、ドライブの画像は試験用の画像につなぐ。
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const zlib = require('zlib');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..', '..');
const SHOT = process.argv[2] || path.join(require('os').tmpdir(), 'brain-shots');
fs.mkdirSync(SHOT, { recursive: true });

const gas = require(path.join(ROOT, 'test', 'gas-mock.js'))();
gas.ctx.setup();
const KEY = String(gas.ss.getSheetByName('設定').getRange('B1').getValue());
const link = gas.ctx.connectLink_(gas.ss.getSheetByName('設定'));
const hash = link.slice(link.indexOf('#'));

function png(w, h, rgb) {
  const crcT = []; for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crcT[n] = c >>> 0; }
  const crc = b => { let c = 0xffffffff; for (const x of b) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const o = y * (w * 3 + 1) + 1 + x * 3; const s = ((x >> 5) + (y >> 5)) % 2 ? 0 : 30; raw[o] = rgb[0] - s; raw[o + 1] = rgb[1] - s; raw[o + 2] = rgb[2] - s; }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
const PHOTO = png(800, 600, [176, 150, 110]);

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
let worksJson = null; // 書き出した works.json を公開ページに渡す（無いときは 404）
const server = http.createServer((req, res) => {
  const p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/brain/public/works.json') {
    if (!worksJson) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(worksJson);
  }
  let f = path.join(ROOT, p);
  if (!f.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
  if (fs.existsSync(f) && fs.statSync(f).isDirectory()) f = path.join(f, 'index.html');
  if (!fs.existsSync(f)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
});
async function wire(ctx) {
  await ctx.route('https://fonts.googleapis.com/**', r => r.fulfill({ contentType: 'text/css', body: '' }));
  await ctx.route('https://drive.google.com/**', r => r.fulfill({ contentType: 'image/png', body: PHOTO }));
  await ctx.route('https://script.google.com/**', r => {
    gas.clockBox.t += 1000;
    const out = gas.ctx.doPost({ postData: { contents: r.request().postData() } });
    return r.fulfill({ contentType: 'application/json', body: out.text, headers: { 'Access-Control-Allow-Origin': '*' } });
  });
}
let passed = 0;
async function t(name, fn) { await fn(); passed++; console.log('ok -', name); }
const serverList = () => gas.ctx.handle_({ key: KEY, action: 'list', app: 'brain' }).records;
const byTitle = s => serverList().find(r => r.data && r.data.title && r.data.title.includes(s));
async function settled(page) {
  for (let i = 0; i < 100; i++) {
    if (await page.evaluate(() => Apps.pendingCount()) === 0 && await page.evaluate(() => !document.querySelector('#list .wait') && !Apps.collection('brain').all().some(r => r.pending))) return;
    await page.waitForTimeout(100);
  }
  throw new Error('送信待ちが残ったまま');
}
// 図に何か描かれているか：画像を描くと canvas は読み出せない（cross-origin）ので、要素のスクショの大きさで見る
// （無地なら数KB、点と線があれば大きくなる）。あわせて写真が描かれた＝読み出し不可になったことも確かめる
const inked = async page => {
  const buf = await page.locator('#graph').screenshot();
  const tainted = await page.evaluate(() => { try { document.getElementById('graph').getContext('2d').getImageData(0, 0, 1, 1); return false; } catch (e) { return true; } });
  return { bytes: buf.length, tainted };
};

(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const BASE = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch();
  const errors = [];

  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true });
  await wire(phone);
  const page = await phone.newPage();
  page.on('pageerror', e => errors.push('phone: ' + e.message));
  page.on('console', m => { if (m.type() === 'error' && !/favicon/.test(m.text())) errors.push('phone console: ' + m.text()); });

  await t('接続リンクで開くと、空の状態が出る', async () => {
    await page.goto(BASE + '/brain/' + hash);
    await page.waitForSelector('#emptyList:not([hidden])');
    assert.strictEqual(await page.locator('.ax-overlay:not([hidden])').count(), 0);
    assert.ok(!(await page.url()).includes('#c='));
    await page.screenshot({ path: path.join(SHOT, 'phone-0-empty.png') });
  });

  await t('1件目：テイスト・写真2枚・タグで作成 → スプシへ', async () => {
    await page.click('.tab-new');
    await page.locator('#edKinds .chip', { hasText: 'テイスト' }).click();
    assert.strictEqual(await page.textContent('#edNo'), '番号：T-001');
    await page.fill('#f-title', '（試験）くすみ色×真鍮の組み合わせ');
    await page.fill('#f-body', 'グレイッシュな壁に真鍮の取手で温度を足す。\n真鍮は点で効かせる。');
    await page.fill('#f-tags', '#色 真鍮、金物');
    await page.setInputFiles('#f-photo', [{ name: 'a.png', mimeType: 'image/png', buffer: PHOTO }, { name: 'b.png', mimeType: 'image/png', buffer: PHOTO }]);
    await page.waitForFunction(() => document.querySelectorAll('#edPhotos .ph img').length === 2 && !document.querySelector('#edPhotos .busy'));
    await page.screenshot({ path: path.join(SHOT, 'phone-2-editor.png') });
    await page.click('#edSave');
    await page.waitForSelector('#editor', { state: 'hidden' });
    await page.waitForSelector('.app.detail-open');
    await settled(page);
    const r = byTitle('真鍮の組み合わせ');
    assert.ok(r);
    assert.strictEqual(r.data.kind, 'T'); assert.strictEqual(r.data.no, 1);
    assert.deepStrictEqual(r.data.tags, ['色', '真鍮', '金物']);
    assert.strictEqual(r.data.photos.length, 2);
    assert.ok(r.data.photos.every(p => typeof p === 'string'));
    assert.strictEqual(await page.locator('#detail .gallery img').count(), 2);
    await page.click('#dtBack');
  });

  await t('2件目・3件目：番号は種類ごと、手動リンクを付ける', async () => {
    await page.click('.tab-new');
    await page.fill('#f-title', '（試験）床見切りの段差ゼロ処理');
    await page.fill('#f-tags', '床 見切り 真鍮');
    await page.click('#edSave');
    await page.waitForSelector('#editor', { state: 'hidden' });
    await page.click('#dtBack');
    await page.click('.tab-new');
    await page.locator('#edKinds .chip', { hasText: '法規・申請' }).click();
    await page.fill('#f-title', '（試験）マンション二重床の遮音等級');
    await page.fill('#f-tags', '床 マンション');
    await page.click('#edAddLink');
    await page.locator('.pk-row', { hasText: '真鍮の組み合わせ' }).locator('input').check();
    await page.click('#pkClose');
    assert.strictEqual(await page.locator('#edLinks .rel-item').count(), 1);
    await page.click('#edSave');
    await page.waitForSelector('#editor', { state: 'hidden' });
    await settled(page);
    const d = byTitle('段差ゼロ'), l = byTitle('遮音等級'), tt = byTitle('真鍮の組み合わせ');
    assert.strictEqual(d.data.kind + d.data.no, 'D1');
    assert.strictEqual(l.data.kind + l.data.no, 'L1');
    assert.deepStrictEqual(l.data.links, [tt.id]);
    // 詳細：手動（遮音→真鍮）と同じタグ（床）の両方が出る
    assert.ok(await page.locator('#detail .rel-item', { hasText: '真鍮の組み合わせ' }).locator('.why.man').isVisible());
    assert.ok(await page.locator('#detail .rel-item', { hasText: '段差ゼロ' }).locator('.why.auto', { hasText: '#床' }).isVisible());
  });

  await t('「この知識を使う」で案件名を記録', async () => {
    await page.click('#useBtn');
    await page.fill('#u-name', '（試験）M邸');
    await page.click('#useForm button[type=submit]');
    await page.waitForSelector('#detail .uselog');
    await settled(page);
    assert.deepStrictEqual(byTitle('遮音等級').data.uses.map(u => u.name), ['（試験）M邸']);
    await page.screenshot({ path: path.join(SHOT, 'phone-3-detail.png') });
    // 相手側（真鍮）からも手動のつながりが見える
    await page.locator('#detail .rel-item', { hasText: '真鍮の組み合わせ' }).click();
    assert.ok(await page.locator('#detail .rel-item', { hasText: '遮音等級' }).locator('.why.man').isVisible());
    await page.click('#dtBack');
  });

  await t('一覧の絞り込み：種類・タグ・検索', async () => {
    assert.strictEqual(await page.locator('#list .item').count(), 3);
    await page.locator('#kinds .chip', { hasText: 'ディテール' }).click();
    assert.strictEqual(await page.locator('#list .item').count(), 1);
    await page.locator('#kinds .chip', { hasText: 'すべて' }).click();
    await page.locator('#tags .chip', { hasText: '#真鍮' }).click();
    assert.strictEqual(await page.locator('#list .item').count(), 2);
    await page.locator('#tags .chip', { hasText: '#真鍮' }).click();
    await page.fill('#q', 'L-001');
    assert.strictEqual(await page.locator('#list .item').count(), 1);
    await page.fill('#q', '存在しない言葉');
    assert.ok(await page.isVisible('#noHit'));
    await page.fill('#q', '');
    await page.dispatchEvent('#q', 'input');
    await page.screenshot({ path: path.join(SHOT, 'phone-1-list.png') });
  });

  await t('つながりの図：点（画像）と線が描かれ、点をタップ→詳細', async () => {
    await page.locator('#tabbar [data-view=graph]').click();
    await page.waitForFunction(() => document.getElementById('graph').dataset.drawn === '3');
    const ds = await page.evaluate(() => ({ ...document.getElementById('graph').dataset }));
    assert.strictEqual(ds.nodes, '3');
    assert.strictEqual(ds.manual, '1');
    assert.ok(+ds.edges >= 3, 'タグの線も出る'); // 遮音↔真鍮（手動）・床・真鍮
    await page.waitForTimeout(600);
    const ik = await inked(page); assert.ok(ik.bytes > 15000 && ik.tainted, JSON.stringify(ik));
    const st = await page.evaluate(() => window.__brain.graph._state());
    const box = await page.locator('#graph').boundingBox();
    const n = st.nodes[0];
    await page.touchscreen.tap(box.x + n.x, box.y + n.y);
    await page.waitForSelector('#peek:not([hidden])');
    await page.screenshot({ path: path.join(SHOT, 'phone-4-graph.png') });
    await page.click('#peek');
    await page.waitForSelector('.app.detail-open');
    await page.click('#dtBack');
  });

  await t('つながりの図：ピンチで拡大・ドラッグで移動', async () => {
    const s0 = await page.evaluate(() => window.__brain.graph._state().view.s);
    await page.evaluate(() => {
      const c = document.getElementById('graph'), r = c.getBoundingClientRect();
      const ev = (type, id, x, y) => c.dispatchEvent(new PointerEvent(type, { pointerId: id, clientX: r.left + x, clientY: r.top + y, bubbles: true, pointerType: 'touch', isPrimary: id === 1 }));
      ev('pointerdown', 1, 150, 300); ev('pointerdown', 2, 230, 300);
      for (let i = 1; i <= 5; i++) { ev('pointermove', 1, 150 - i * 12, 300); ev('pointermove', 2, 230 + i * 12, 300); }
      ev('pointerup', 1, 90, 300); ev('pointerup', 2, 290, 300);
    });
    const s1 = await page.evaluate(() => window.__brain.graph._state().view.s);
    assert.ok(s1 > s0 * 1.5, 'ピンチで拡大 ' + s0 + '→' + s1);
    const x0 = await page.evaluate(() => window.__brain.graph._state().view.x);
    await page.evaluate(() => {
      const c = document.getElementById('graph'), r = c.getBoundingClientRect();
      const ev = (type, x, y) => c.dispatchEvent(new PointerEvent(type, { pointerId: 7, clientX: r.left + x, clientY: r.top + y, bubbles: true, pointerType: 'touch', isPrimary: true }));
      // 点のない場所から始める（点の上だと点を動かす）
      const ns = window.__brain.graph._state().nodes;
      let sx = 20, sy = 20;
      for (let y = 20; y < r.height - 20; y += 10) {
        if (ns.every(n => Math.hypot(n.x - sx, n.y - y) > n.r + 20 && Math.hypot(n.x - sx - 100, n.y - y) > n.r + 20)) { sy = y; break; }
      }
      ev('pointerdown', sx, sy); ev('pointermove', sx + 40, sy); ev('pointermove', sx + 100, sy); ev('pointerup', sx + 100, sy);
    });
    const x1 = await page.evaluate(() => window.__brain.graph._state().view.x);
    assert.ok(Math.abs(x1 - x0 - 100) < 2, '移動 ' + (x1 - x0));
    await page.click('#gFit');
  });

  await t('再読み込みしても残る（端末の控え）', async () => {
    await page.reload();
    await page.waitForFunction(() => document.querySelectorAll('#list .item').length === 3);
  });

  await t('オフラインで使った記録 → つながったら送られる', async () => {
    await phone.setOffline(true);
    await page.locator('#list .item', { hasText: '段差ゼロ' }).click();
    await page.click('#useBtn');
    await page.fill('#u-name', '（試験）K邸');
    await page.click('#useForm button[type=submit]');
    await page.waitForSelector('#pend:not([hidden])');
    assert.strictEqual(byTitle('段差ゼロ').data.uses.length, 0);
    await phone.setOffline(false);
    await page.evaluate(() => window.dispatchEvent(new Event('online')));
    await settled(page);
    assert.strictEqual(byTitle('段差ゼロ').data.uses.length, 1);
    await page.click('#dtBack');
  });

  // ---------- PC幅（別の端末として） ----------
  const pc = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await wire(pc);
  const pg = await pc.newPage();
  pg.on('pageerror', e => errors.push('pc: ' + e.message));

  await t('PC：別の端末で開くと同期され、一覧＋詳細＋図が並ぶ', async () => {
    await pg.goto(BASE + '/brain/' + hash);
    await pg.waitForFunction(() => document.querySelectorAll('#list .item').length === 3);
    assert.ok(await pg.isVisible('#dtNone'));
    assert.ok(!(await pg.isVisible('#tabbar')));
    await pg.locator('#list .item', { hasText: '真鍮の組み合わせ' }).click();
    for (const id of ['#paneList', '#paneDetail', '#paneGraph']) assert.ok(await pg.isVisible(id), id);
    const [a, b, c] = await Promise.all(['#paneList', '#paneDetail', '#paneGraph'].map(s => pg.locator(s).boundingBox()));
    assert.ok(a.x < b.x && b.x < c.x && c.width > 400);
    await pg.waitForFunction(() => document.getElementById('graph').dataset.drawn === '3');
    await pg.waitForTimeout(800);
    const ik = await inked(pg); assert.ok(ik.bytes > 15000 && ik.tainted, JSON.stringify(ik));
    const s0 = await pg.evaluate(() => window.__brain.graph._state().view.s);
    const box = await pg.locator('#graph').boundingBox();
    await pg.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await pg.mouse.wheel(0, -300);
    assert.ok(await pg.evaluate(() => window.__brain.graph._state().view.s) > s0);
    await pg.click('#gFit');
    await pg.waitForTimeout(300);
    await pg.screenshot({ path: path.join(SHOT, 'pc-1.png') });
  });

  await t('PC：図の点をクリックすると詳細が切り替わる', async () => {
    const st = await pg.evaluate(() => window.__brain.graph._state());
    const box = await pg.locator('#graph').boundingBox();
    const target = await pg.evaluate(() => window.__brain.graph._state().nodes.map(n => n.id));
    for (const n of st.nodes) {
      await pg.mouse.click(box.x + n.x, box.y + n.y);
      const title = await pg.textContent('#detail h2');
      assert.ok(title.includes('（試験）'));
    }
    assert.strictEqual(target.length, 3);
  });

  await t('PC：種類を追加して使える', async () => {
    await pg.click('#settingsBtn');
    await pg.fill('#st-code', 'p');
    await pg.fill('#st-name', 'プレゼン');
    await pg.click('#stAdd button');
    await pg.waitForSelector('#stKinds >> text=プレゼン');
    await pg.click('#stClose');
    assert.ok(await pg.locator('#kinds .chip', { hasText: 'プレゼン' }).isVisible());
    await pg.click('.fab-new');
    await pg.locator('#edKinds .chip', { hasText: 'プレゼン' }).click();
    assert.strictEqual(await pg.textContent('#edNo'), '番号：P-001');
    await pg.fill('#f-title', '（試験）提案書の構成');
    await pg.click('#edSave');
    await settled(pg);
    assert.strictEqual(byTitle('提案書').data.kind, 'P');
  });

  await t('PC：削除すると相手側のつながりも消える', async () => {
    await pg.locator('#list .item', { hasText: '真鍮の組み合わせ' }).click();
    await pg.click('#dtEdit');
    await pg.click('#edDelete');
    await pg.click('#cfOk');
    await settled(pg);
    assert.ok(!byTitle('真鍮の組み合わせ'));
    assert.deepStrictEqual(byTitle('遮音等級').data.links, []);
    await pg.waitForFunction(() => document.getElementById('graph').dataset.nodes === '3');
  });

  await t('iPhone：同期すると削除が反映される', async () => {
    await page.click('#syncBtn');
    await page.waitForFunction(() => !/真鍮の組み合わせ/.test(document.getElementById('list').textContent) && /提案書の構成/.test(document.getElementById('list').textContent));
    assert.strictEqual(await page.locator('#list .item').count(), 3);
  });

  // ---------- ほかのアプリ（本棚・アーキマップ）で作った番号なしのカード ----------
  await t('番号なし（no:null）のカードは、同期で種類ごと・作成順に番号が振られる（既存は書き換えない）', async () => {
    const H = req => gas.ctx.handle_(Object.assign({ key: KEY, action: 'put', app: 'brain' }, req));
    const nn = (title, kind, at, src) => ({ t: 'k', kind, no: null, title, body: '', tags: [], photos: [], links: [], uses: [], source: src, createdIn: src.spotId ? 'archmap' : 'hondana' });
    // 作成日時の新しい方から先に届く（順番は作成日時で決まる）
    H({ id: 'nn-t2', createdAt: '2026-10-31T10:00:00Z', data: nn('（試験）あとのテイスト', 'T', 0, { spotId: 'spot-x', title: '（試験）建物X' }) });
    H({ id: 'nn-t1', createdAt: '2026-10-31T09:00:00Z', data: nn('（試験）さきのテイスト', 'T', 0, { spotId: 'spot-x', title: '（試験）建物X' }) });
    H({ id: 'nn-o1', createdAt: '2026-10-31T09:30:00Z', data: nn('（試験）ほかのメモ', 'O', 0, { bookId: 'book-x', title: '（試験）本X' }) });
    const before = Object.fromEntries(serverList().filter(r => r.data && r.data.t === 'k' && typeof r.data.no === 'number').map(r => [r.id, JSON.stringify(r.data)]));
    const maxT = Math.max(0, ...serverList().filter(r => r.data && r.data.kind === 'T' && typeof r.data.no === 'number').map(r => r.data.no));
    await pg.click('#syncBtn');
    await pg.waitForFunction(() => /T-00\d/.test(document.getElementById('list').textContent) && !/未採番/.test(document.getElementById('list').textContent));
    await settled(pg);
    assert.strictEqual(byTitle('さきのテイスト').data.no, maxT + 1);
    assert.strictEqual(byTitle('あとのテイスト').data.no, maxT + 2);
    assert.strictEqual(byTitle('ほかのメモ').data.no, 1);
    for (const [id, d] of Object.entries(before)) assert.strictEqual(JSON.stringify(serverList().find(r => r.id === id).data), d, id);
    // 出典のシート：控えが無い本・建物はカードの情報だけで出す
    await pg.locator('#list .item', { hasText: 'さきのテイスト' }).click();
    assert.ok(/アーキマップで（|（アーキマップで）/.test(await pg.textContent('#detail .dt-foot')));
    await pg.click('#detail .src[data-srcopen]');
    await pg.waitForSelector('#srcSheet:not([hidden])');
    assert.ok(/建物X/.test(await pg.textContent('#ssBody')) && /控えがまだこの端末にありません/.test(await pg.textContent('#ssBody')));
    await pg.click('#srcSheet [data-ssclose]');
    // もう1台（iPhone）で同期しても振り直さない
    await page.click('#syncBtn');
    await page.waitForFunction(() => /さきのテイスト/.test(document.getElementById('list').textContent));
    await page.waitForTimeout(400);
    await settled(page);
    assert.strictEqual(byTitle('さきのテイスト').data.no, maxT + 1);
    assert.strictEqual(serverList().filter(r => r.data && r.data.kind === 'T').map(r => r.data.no).sort().join(','), Array.from({ length: maxT + 2 }, (_, i) => i + 1).join(','));
  });

  // ---------- 実績（ポートフォリオ） ----------
  const works = () => serverList().filter(r => r.data && r.data.t === 'w');
  const workBy = n => works().find(r => r.data.name === n);
  const cardsOnServer = () => serverList().filter(r => r.data && r.data.t === 'k');

  await t('実績：タブを開くと空の案内と「知識の記録だけある案件」が出る', async () => {
    await page.locator('#tabbar [data-view=works]').click();
    await page.waitForSelector('#wEmpty:not([hidden])');
    assert.ok(await page.locator('#wOrph .orow', { hasText: '（試験）M邸' }).isVisible());
    assert.ok(await page.locator('#wOrph .orow', { hasText: '（試験）K邸' }).isVisible());
    assert.strictEqual(await page.getAttribute('#tabbar .tab-new', 'aria-label'), '実績をささっと作る');
  });

  await t('実績：ささっと作る（案件名・写真3枚まとめて・メモ）→ スプシへ、保管中', async () => {
    await page.click('.tab-new');
    await page.waitForSelector('#quick:not([hidden])');
    await page.fill('#q-name', '（試験）A邸');
    await page.setInputFiles('#q-photo', [1, 2, 3].map(i => ({ name: 'p' + i + '.png', mimeType: 'image/png', buffer: PHOTO })));
    await page.waitForFunction(() => document.querySelectorAll('#qPhotos .ph img').length === 3 && !document.querySelector('#qPhotos .busy'));
    await page.fill('#q-memo', '（試験）床は管理組合へ事前申請。');
    await page.screenshot({ path: path.join(SHOT, 'phone-w1-quick.png') });
    await page.click('#qSave');
    await page.waitForSelector('#quick', { state: 'hidden' });
    await page.waitForSelector('.app.work-open');
    await settled(page);
    const w = workBy('（試験）A邸');
    assert.ok(w);
    assert.strictEqual(w.data.photos.length, 3);
    assert.ok(w.data.photos.every(p => typeof p.id === 'string' && p.pub === false && p.ba === ''));
    assert.ok(/^[a-z0-9]{10}$/.test(w.data.slug), w.data.slug);
    assert.strictEqual(w.data.published, false);
    assert.ok(await page.locator('#wDetail .st.keep').isVisible());
    assert.strictEqual(await page.locator('#wDetail .wgal img').count(), 3);
    // 知識の一覧・採番には混ざらない
    assert.ok(!(await page.textContent('#list')).includes('（試験）A邸'));
    assert.ok(works().every(r => r.data.no === undefined));
  });

  await t('実績：カードで「この知識を使う」に同じ案件名 → 実績に自動で並ぶ／詳細から足す', async () => {
    await page.click('#wBack');
    await page.locator('#tabbar [data-view=list]').click();
    await page.locator('#list .item', { hasText: '段差ゼロ' }).click();
    await page.click('#useBtn');
    assert.strictEqual(await page.locator('#projList option[value="（試験）A邸"]').count(), 1, '案件名の候補に実績の名前が出る');
    await page.fill('#u-name', '（試験）A邸');
    await page.click('#useForm button[type=submit]');
    await page.waitForFunction(() => /（試験）A邸/.test(document.querySelector('#detail .uselog').textContent));
    await page.click('#dtBack');
    await page.locator('#tabbar [data-view=works]').click();
    await page.locator('#works .wk', { hasText: '（試験）A邸' }).click();
    await page.waitForSelector('#wDetail .kn-item');
    assert.strictEqual(await page.locator('#wDetail .kn-item').count(), 1);
    assert.ok(await page.locator('#wDetail .kn-item', { hasText: '段差ゼロ' }).isVisible());
    // ここから足す → カード側の「使った案件」にも入る
    await page.click('#wAddKnow');
    await page.waitForSelector('#picker:not([hidden])');
    assert.ok((await page.textContent('#pkTitle')).includes('（試験）A邸'));
    await page.locator('.pk-row', { hasText: '遮音等級' }).locator('input').check();
    await page.click('#pkClose');
    await page.waitForFunction(() => document.querySelectorAll('#wDetail .kn-item').length === 2);
    await settled(page);
    assert.ok(byTitle('遮音等級').data.uses.some(u => u.name === '（試験）A邸'));
    await page.screenshot({ path: path.join(SHOT, 'phone-w2-detail.png') });
  });

  await t('実績：仕上げ → 写真に印と公開 → 公開をオン（名前と写真が揃うまでは押せない）', async () => {
    await page.click('#wFinBtn');
    await page.waitForSelector('#finish:not([hidden])');
    assert.ok(await page.isDisabled('#fPub'));
    await page.fill('#f-pubName', '（試験）北区 築40年マンション、回遊できるLDK');
    await page.fill('#f-period', '2026-08');
    await page.fill('#f-area', '68');
    await page.fill('#f-city', '大阪市北区');
    await page.fill('#f-user', '30代ご夫婦＋お子さま1人');
    await page.fill('#f-wish', '広いLDKにしたい。');
    await page.fill('#f-point', 'キッチンを中心に回遊できる動線にしました。');
    await page.fill('#f-client', '山田 太郎 様');
    await page.fill('#f-addr', '大阪市北区梅田1-2-3');
    await page.selectOption('#f-cost', '900〜1,200万');
    await page.fill('#f-memo', '（試験）ひみつのメモ');
    assert.ok(await page.isDisabled('#fPub'), '公開する写真がまだない');
    // 1枚目：アフター・公開／2枚目：ビフォー・公開／3枚目：公開しない
    await page.click('[data-fba="0"]'); await page.click('[data-fba="0"]');
    await page.click('[data-fba="1"]');
    await page.click('[data-fpub="0"]'); await page.click('[data-fpub="1"]');
    assert.ok(!(await page.isDisabled('#fPub')));
    await page.click('#fPub');
    assert.strictEqual(await page.getAttribute('#fPub', 'aria-pressed'), 'true');
    // 遮音等級は公開ページに出さない
    const hideId = byTitle('遮音等級').id;
    await page.uncheck('[data-fknow="' + hideId + '"]');
    await page.screenshot({ path: path.join(SHOT, 'phone-w3-finish.png') });
    await page.click('#fSave');
    await page.waitForSelector('#finish', { state: 'hidden' });
    await settled(page);
    const w = workBy('（試験）A邸');
    assert.strictEqual(w.data.published, true);
    assert.deepStrictEqual(w.data.photos.map(p => [p.pub, p.ba]), [[true, 'after'], [true, 'before'], [false, '']]);
    assert.deepStrictEqual(w.data.hideKnow, [hideId]);
    assert.strictEqual(w.data.cost, '900〜1,200万');
    assert.ok(await page.locator('#wDetail .st.pub').isVisible());
    assert.ok((await page.textContent('#wDetail .urlbox')).includes('/brain/public/?w=' + w.data.slug));
  });

  await t('実績：書き出し → works.json に非公開の項目が入らない', async () => {
    await page.click('#wExport');
    await page.waitForSelector('#exportSheet:not([hidden])');
    assert.ok(await page.isHidden('#exStop'));
    assert.ok((await page.textContent('#exDiff')).includes('はじめて'));
    const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#exDownload')]);
    assert.strictEqual(dl.suggestedFilename(), 'works.json');
    worksJson = fs.readFileSync(await dl.path(), 'utf8');
    const data = JSON.parse(worksJson);
    const w = workBy('（試験）A邸');
    assert.strictEqual(data.brand, 'coto');
    assert.strictEqual(data.items.length, 1);
    const it = data.items[0];
    assert.deepStrictEqual(Object.keys(it).sort(), ['area', 'city', 'know', 'period', 'photos', 'point', 'title', 'user', 'w', 'wish']);
    assert.strictEqual(it.w, w.data.slug);
    assert.strictEqual(it.photos.length, 2);
    assert.deepStrictEqual(it.photos.map(p => Object.keys(p).sort().join()), ['ba,url', 'ba,url']);
    assert.deepStrictEqual(it.know, [{ kind: 'D', kindName: 'ディテール', title: '（試験）床見切りの段差ゼロ処理' }]);
    for (const secret of ['山田', '太郎', '梅田', '1-2-3', '900〜1,200万', 'ひみつのメモ', '（試験）A邸', w.id, w.data.photos[2].id, '遮音等級', byTitle('段差ゼロ').id, 'D-001']) {
      assert.ok(!worksJson.includes(secret), '書き出しに入っている：' + secret);
    }
    await settled(page);
    assert.strictEqual(serverList().find(r => r.id === 'works-export').data.list[0].w, w.data.slug);
    await page.screenshot({ path: path.join(SHOT, 'phone-w4-export.png') });
    await page.click('#exClose');
  });

  await t('実績：施主名・番地が公開する文章に入っていたら書き出しを止める', async () => {
    await page.click('#wFinBtn');
    await page.fill('#f-point', 'キッチンを中心に回遊できる動線にしました。山田さんのご家族のために。');
    await page.click('#fExport');
    await page.waitForSelector('#exportSheet:not([hidden])');
    assert.ok(await page.isVisible('#exStop'));
    assert.ok((await page.textContent('#exStop')).includes('「山田」'));
    assert.ok(await page.isDisabled('#exDownload'));
    assert.ok(await page.isDisabled('#exCopy'));
    assert.strictEqual(await page.inputValue('#exText'), '');
    // 「直す」→ 仕上げが開く。直して書き出せる
    await page.click('#exStop [data-exfix]');
    await page.waitForSelector('#finish:not([hidden])');
    await page.fill('#f-point', 'キッチンを中心に回遊できる動線にしました。');
    await page.click('#fExport');
    await page.waitForSelector('#exportSheet:not([hidden])');
    assert.ok(await page.isHidden('#exStop'));
    assert.ok((await page.textContent('#exDiff')).includes('変わりなし'));
    await page.click('#exClose');
    // 番地（数字の並び）・名前の片方だけでも見つける
    const found = await page.evaluate(() => window.BrainWorks._leaks({ name: 'x', client: '佐藤 花子', addr: '大阪市北区梅田１－２－３', city: '大阪市北区',
      pubName: '梅田1-2-3の住まい', wish: '花子さんの夢', photos: [] }));
    assert.ok(found.includes('花子') && found.some(w => /1-2-3/.test(w)), JSON.stringify(found));
  });

  await t('公開ページ（スマホ幅）：1件のページに公開項目だけが出る', async () => {
    const pub = await phone.newPage();
    pub.on('pageerror', e => errors.push('public: ' + e.message));
    const slug = workBy('（試験）A邸').data.slug;
    await pub.goto(BASE + '/brain/public/?w=' + slug);
    await pub.waitForSelector('#pp[data-shown=work]');
    assert.strictEqual(await pub.getAttribute('meta[name=robots]', 'content'), 'noindex, nofollow');
    assert.ok((await pub.textContent('h1')).includes('回遊できるLDK'));
    assert.ok((await pub.title()).includes('｜coto'));
    const text = await pub.textContent('#pp');
    for (const v of ['2026年8月 完成', '大阪市北区', '68㎡', '30代ご夫婦', '広いLDKにしたい', '段差ゼロ', 'ディテール']) assert.ok(text.includes(v), v);
    for (const v of ['山田', '梅田', '1,200万', 'ひみつのメモ', '（試験）A邸', '遮音等級']) assert.ok(!text.includes(v), v);
    assert.strictEqual(await pub.locator('.pp-hero .ph .ba.after').count(), 1, '表紙はアフター');
    assert.strictEqual(await pub.locator('.pp-hero img').count(), 1);
    await pub.waitForFunction(() => [...document.images].every(i => i.complete));
    await pub.screenshot({ path: path.join(SHOT, 'phone-w5-public.png'), fullPage: true });
    // 番号なしで開くと一覧、知らない番号は案内
    await pub.goto(BASE + '/brain/public/');
    await pub.waitForSelector('#pp[data-shown=list]');
    assert.strictEqual(await pub.locator('.pp-card').count(), 1);
    await pub.goto(BASE + '/brain/public/?w=nothere000');
    await pub.waitForSelector('#pp[data-shown=list]');
    assert.ok((await pub.textContent('#pp')).includes('公開を終えたか'));
    await pub.close();
  });

  await t('実績：知識の記録だけある案件から作る → 使った知識がそのまま並ぶ', async () => {
    await page.click('#wBack');
    await page.locator('#wOrph .orow', { hasText: '（試験）M邸' }).click();
    await page.waitForSelector('#quick:not([hidden])');
    assert.strictEqual(await page.inputValue('#q-name'), '（試験）M邸');
    await page.click('#qSave');
    await page.waitForSelector('.app.work-open');
    await page.waitForSelector('#wDetail .kn-item');
    assert.ok(await page.locator('#wDetail .kn-item', { hasText: '遮音等級' }).isVisible());
    await settled(page);
    assert.ok(workBy('（試験）M邸'));
    await page.click('#wBack');
    assert.strictEqual(await page.locator('#wOrph .orow', { hasText: '（試験）M邸' }).count(), 0);
    await page.locator('#wChips .chip', { hasText: '公開中' }).click();
    assert.strictEqual(await page.locator('#works .wk').count(), 1);
    await page.locator('#wChips .chip', { hasText: 'すべて' }).click();
    await page.fill('#wq', '北区');
    assert.strictEqual(await page.locator('#works .wk').count(), 1);
    await page.fill('#wq', '');
    await page.dispatchEvent('#wq', 'input');
    await page.screenshot({ path: path.join(SHOT, 'phone-w0-list.png') });
  });

  await t('PC：知識｜実績の切り替え、左に一覧・右に詳細、見え方の確認、名前を変えるとカード側も揃う', async () => {
    await pg.click('#syncBtn');
    await pg.click('#modeSw [data-view=works]');
    await pg.waitForFunction(() => document.querySelectorAll('#works .wk').length === 2);
    assert.ok(await pg.isVisible('#wNone'));
    await pg.locator('#works .wk', { hasText: '（試験）A邸' }).click();
    const [a, b] = await Promise.all(['#paneWorks', '#paneWork'].map(s2 => pg.locator(s2).boundingBox()));
    assert.ok(a.x < b.x && b.width > 500);
    assert.ok(!(await pg.isVisible('#paneGraph')));
    await pg.waitForFunction(() => [...document.querySelectorAll('#wDetail img')].every(i => i.complete));
    await pg.screenshot({ path: path.join(SHOT, 'pc-w1-works.png') });
    await pg.click('#wFinBtn');
    await pg.click('#fPreview');
    const fr = pg.frameLocator('#pvFrame');
    await fr.locator('#pp[data-shown=work]').waitFor();
    assert.ok((await fr.locator('h1').textContent()).includes('回遊できるLDK'));
    assert.ok(!(await fr.locator('#pp').textContent()).includes('山田'));
    await pg.screenshot({ path: path.join(SHOT, 'pc-w2-preview.png') });
    await pg.click('#pvClose');
    await pg.fill('#f-name', '（試験）A邸改');
    await pg.click('#fSave');
    await pg.waitForSelector('#confirm:not([hidden])');
    assert.ok((await pg.textContent('#cfTitle')).includes('揃えますか'));
    await pg.click('#cfOk');
    await pg.waitForSelector('#finish', { state: 'hidden' });
    await settled(pg);
    assert.ok(workBy('（試験）A邸改'));
    assert.ok(byTitle('段差ゼロ').data.uses.some(u => u.name === '（試験）A邸改'));
    assert.ok(!cardsOnServer().some(r => (r.data.uses || []).some(u => u.name === '（試験）A邸')));
    assert.strictEqual(await pg.locator('#wDetail .kn-item').count(), 2);
    // 知識へ戻ると、図には知識だけ
    await pg.click('#modeSw [data-view=list]');
    await pg.waitForFunction(() => document.getElementById('graph').dataset.nodes === String(document.querySelectorAll('#list .item').length));
  });

  await t('公開ページ（PC幅）', async () => {
    const pub = await pc.newPage();
    pub.on('pageerror', e => errors.push('public pc: ' + e.message));
    await pub.goto(BASE + '/brain/public/?w=' + workBy('（試験）A邸改').data.slug);
    await pub.waitForSelector('#pp[data-shown=work]');
    await pub.waitForFunction(() => [...document.images].every(i => i.complete));
    const [hero, h1] = await Promise.all([pub.locator('.pp-hero .ph').boundingBox(), pub.locator('.pp-hero h1').boundingBox()]);
    assert.ok(hero.x < h1.x, '表紙と名前が横に並ぶ');
    assert.strictEqual(await pub.locator('.pair').count(), 1, 'ビフォーとアフターが組で並ぶ');
    assert.strictEqual(await pub.locator('.pair .ba.before').count() + await pub.locator('.pair .ba.after').count(), 2);
    await pub.screenshot({ path: path.join(SHOT, 'pc-w3-public.png'), fullPage: true });
    await pub.close();
  });

  // ---------- 貼って取り込む（noteネタ・日記） ----------
  const payload = list => '#brain-import v1\n' + JSON.stringify(list);
  const N1 = { src: 'note', id: 'n-001', kind: 'H', title: '（試験）玄関の一時置き棚', body: '帰ってすぐ置ける場所', tags: ['玄関', '収納'], date: '2026-10-30' };
  const D1 = { src: 'diary', id: 'd-777', kind: 'Z', title: '（試験）現場で気づいた巾木の色', body: '白より少し濃い方が汚れが目立たない', tags: [], date: '2026-10-31' };

  await t('取り込み：形式チェック → プレビュー（件数・新規）→ 知識カードとして入り、番号が付く', async () => {
    await page.locator('#tabbar [data-view=list]').click();
    await page.click('#settingsBtn');
    await page.click('#stImport');
    await page.waitForSelector('#importSheet:not([hidden])');
    await page.fill('#imText', '{"src":"note"}');
    assert.ok((await page.textContent('#imMsg')).includes('#brain-import v1'));
    assert.ok(await page.isDisabled('#imGo'));
    await page.fill('#imText', '#brain-import v1\n{壊れた');
    assert.ok((await page.textContent('#imMsg')).includes('読めません'));
    await page.fill('#imText', payload([N1, D1, { src: 'note', title: 'idなし' }]));
    assert.ok((await page.textContent('#imMsg')).includes('2件（新規 2件・取り込み済み 0件）'));
    assert.ok((await page.textContent('#imMsg')).includes('読めない 1件'));
    await page.screenshot({ path: path.join(SHOT, 'phone-i1-import.png') });
    await page.click('#imGo');
    await page.waitForSelector('#importSheet', { state: 'hidden' });
    await page.waitForFunction(() => /玄関の一時置き棚/.test(document.getElementById('list').textContent) && !/未採番/.test(document.getElementById('list').textContent));
    await settled(page);
    const n = byTitle('玄関の一時置き棚'), d = byTitle('巾木の色');
    assert.deepStrictEqual(n.data.source, { title: 'noteネタ', importId: 'note:n-001' });
    assert.deepStrictEqual(d.data.source, { title: '日記 2026-10-31', importId: 'diary:d-777' });
    assert.strictEqual(d.data.kind, 'H', '知らない種類はひらめき');
    assert.deepStrictEqual(n.data.tags, ['玄関', '収納']);
    assert.ok(typeof n.data.no === 'number' && typeof d.data.no === 'number' && n.data.no !== d.data.no);
    assert.strictEqual(n.data.createdIn, 'note');
    // 詳細：出典は取り込み元。編集して保存しても importId は残る
    await page.locator('#list .item', { hasText: '巾木の色' }).click();
    assert.ok((await page.textContent('#detail .src.imp')).includes('日記'));
    await page.click('#dtEdit');
    assert.ok(await page.isHidden('#srcPage'));
    await page.fill('#f-body', '白より少し濃い方が汚れが目立たない。グレージュ。');
    await page.click('#edSave');
    await settled(page);
    assert.strictEqual(byTitle('巾木の色').data.source.importId, 'diary:d-777');
    await page.click('#dtBack');
  });

  await t('取り込み：2回目は新しい分だけ（クリップボードから読む・同じ importId は飛ばす）', async () => {
    await pc.grantPermissions(['clipboard-read', 'clipboard-write']);
    await pg.click('#syncBtn');
    await pg.waitForFunction(() => /巾木の色/.test(document.getElementById('list').textContent));
    const N2 = { src: 'note', id: 'n-002', title: '', body: '（試験）本文だけのネタ\n2行目', tags: '照明 陰影' };
    await pg.evaluate(t2 => navigator.clipboard.writeText(t2), payload([N1, D1, N2]));
    const before = cardsOnServer().length;
    await pg.click('#settingsBtn');
    await pg.click('#stImport');
    await pg.click('#imRead');
    await pg.waitForFunction(() => /新規 1件・取り込み済み 2件/.test(document.getElementById('imMsg').textContent));
    assert.strictEqual(await pg.locator('#imList .im-row.dup').count(), 2);
    await pg.screenshot({ path: path.join(SHOT, 'pc-i1-import.png') });
    await pg.click('#imGo');
    await pg.waitForSelector('#importSheet', { state: 'hidden' });
    await settled(pg);
    assert.strictEqual(cardsOnServer().length, before + 1);
    const n2 = cardsOnServer().find(r => r.data.source && r.data.source.importId === 'note:n-002');
    assert.strictEqual(n2.data.title, '（試験）本文だけのネタ');
    assert.strictEqual(n2.data.kind, 'H');
    assert.deepStrictEqual(n2.data.tags, ['照明', '陰影']);
    // もう一度読んでも何も入らない
    await pg.click('#settingsBtn');
    await pg.click('#stImport');
    await pg.click('#imRead');
    await pg.waitForFunction(() => /新規 0件・取り込み済み 3件/.test(document.getElementById('imMsg').textContent));
    assert.ok(await pg.isDisabled('#imGo'));
    await pg.click('#imClose');
    assert.strictEqual(serverList().filter(r => r.data && r.data.source && /^(note|diary):/.test(r.data.source.importId || '')).length, 3);
  });

  await browser.close();
  server.close();
  if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
  console.log(passed + ' passed');
})().catch(e => { console.error(e); process.exit(1); });
