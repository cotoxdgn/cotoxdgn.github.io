// 脳みそポートフォリオ の画面試験（Playwright の Chromium）
// 実行：node brain/test/e2e.js [スクショの保存先]
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
    if (await page.evaluate(() => Apps.pendingCount()) === 0 && await page.evaluate(() => !document.querySelector('#list .wait'))) return;
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
      ev('pointerdown', 20, 640); ev('pointermove', 60, 640); ev('pointermove', 120, 640); ev('pointerup', 120, 640);
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

  await browser.close();
  server.close();
  if (errors.length) { console.error(errors.join('\n')); process.exit(1); }
  console.log(passed + ' passed');
})().catch(e => { console.error(e); process.exit(1); });
