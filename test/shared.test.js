// shared/apps.js と gas/Code.gs をつないだ通し試験（fetch をモックの doPost に直結）
// 実行：node test/shared.test.js
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');
const gas = require('./gas-mock')();

gas.ctx.setup();
const KEY = String(gas.ss.getSheetByName('設定').getRange('B1').getValue());
const tick = () => { gas.clockBox.t += 1000; };

// ブラウザ側の最小限の環境（IndexedDB なし → localStorage で代用される）
const store = {};
let isOnline = true;
let fetchCount = 0;
const win = {
  localStorage: {
    getItem: k => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: k => { delete store[k]; }
  },
  navigator: { get onLine() { return isOnline; }, userAgent: 'node' },
  setTimeout, clearTimeout,
  btoa: s => Buffer.from(s, 'binary').toString('base64'),
  atob: s => Buffer.from(s, 'base64').toString('binary'),
  addEventListener() {},
  fetch: (url, init) => {
    fetchCount++;
    if (!isOnline) return Promise.reject(new TypeError('Failed to fetch'));
    assert.strictEqual(init.method, 'POST');
    assert.ok(/^text\/plain/.test(init.headers['Content-Type']));
    const out = gas.ctx.doPost({ postData: { contents: init.body } });
    return Promise.resolve({ text: () => Promise.resolve(out.text) });
  }
};
win.window = win;
win.unescape = unescape; win.escape = escape;
win.encodeURIComponent = encodeURIComponent; win.decodeURIComponent = decodeURIComponent;
vm.createContext(win);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'shared', 'apps.js'), 'utf8'), win, { filename: 'apps.js' });
const Apps = win.Apps;

const b64u = o => Buffer.from(JSON.stringify(o)).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const wait = ms => new Promise(r => setTimeout(r, ms));
let passed = 0;
async function t(name, fn) { await fn(); passed++; console.log('ok -', name); }

(async () => {
  await t('未接続なら not_connected', async () => {
    assert.strictEqual(Apps.isConnected('diary'), false);
    await assert.rejects(Apps.call('diary', 'ping'), e => e.code === 'not_connected');
  });

  await t('接続リンク（GAS が作るもの）を読んで保存。全アプリに効く', async () => {
    const link = gas.ctx.connectLink_(gas.ss.getSheetByName('設定'));
    const c = Apps.parseConnect(link);
    assert.ok(c && c.key === KEY && /\/exec$/.test(c.url));
    Apps.saveConnection(c);
    assert.ok(Apps.isConnected('diary') && Apps.isConnected('routine'));
    assert.ok((await Apps.call('diary', 'ping')).ok);
    // 自分で作るリンクも同じ形で読める
    assert.strictEqual(Apps.parseConnect(Apps.connectLink()).key, KEY);
    assert.strictEqual(Apps.parseConnect('https://example.com/#c=zzz'), null);
  });

  await t('アプリ別の接続（wanko は家族用スプシ）', async () => {
    Apps.saveConnection(Apps.parseConnect('https://cotoxdgn.github.io/connect/#c=' + b64u({ u: 'https://script.google.com/macros/s/FAMILY/exec', k: 'fam', a: 'wanko' })));
    assert.ok(Apps.getConnection('wanko').url.includes('FAMILY'));
    assert.strictEqual(Apps.getConnection('diary').key, KEY);
    assert.strictEqual(Apps.parseConnect(Apps.connectLink('wanko')).app, 'wanko');
    Apps.disconnect('wanko');
    assert.strictEqual(Apps.getConnection('wanko').key, KEY);
  });

  const diary = Apps.collection('diary');
  await diary.ready;
  let rec;
  await t('put → 端末にすぐ反映 → 送信後はサーバーの日時になる', async () => {
    tick();
    rec = await diary.put({ text: '晴れ' });
    assert.strictEqual(diary.get(rec.id).pending, true);
    await Apps.flush();
    assert.strictEqual(await diary.pendingCount(), 0);
    const r = diary.get(rec.id);
    assert.ok(!r.pending);
    assert.strictEqual(gas.ctx.handle_({ key: KEY, action: 'list', app: 'diary' }).records[0].data.text, '晴れ');
  });

  await t('オフライン中の変更はキューにたまり、同じ id はまとめられる', async () => {
    isOnline = false;
    tick();
    await diary.put({ text: '雨' }, rec.id);
    await diary.put({ text: '雨のち晴れ' }, rec.id);
    const b = await diary.put({ text: '新規（オフライン）' });
    assert.strictEqual(await diary.pendingCount(), 2);
    const r = await Apps.flush();
    assert.strictEqual(r.left, 2);
    await assert.rejects(diary.sync(), e => e.code === 'offline');
    isOnline = true;
    tick();
    const s = await diary.sync();
    assert.strictEqual(s.left, 0);
    const server = gas.ctx.handle_({ key: KEY, action: 'list', app: 'diary' }).records;
    assert.strictEqual(server.length, 2);
    assert.strictEqual(server.find(x => x.id === rec.id).data.text, '雨のち晴れ');
    assert.ok(server.find(x => x.id === b.id));
  });

  await t('他の端末の変更・削除を差分で受け取る', async () => {
    tick();
    gas.ctx.handle_({ key: KEY, action: 'put', app: 'diary', id: 'other-1', data: { text: '別の端末から' } });
    gas.ctx.handle_({ key: KEY, action: 'delete', app: 'diary', id: rec.id });
    const before = fetchCount;
    const s = await diary.sync();
    assert.ok(fetchCount > before);
    assert.ok(s.pulled >= 2); // 境界の時刻は重ねて受け取る（同じ id は上書きされるだけ）
    assert.ok(diary.get('other-1'));
    assert.strictEqual(diary.get(rec.id), null);
    assert.strictEqual(diary.all().length, 2);
  });

  await t('remove → 論理削除が届く', async () => {
    tick();
    await diary.remove('other-1');
    await diary.sync();
    assert.strictEqual(diary.get('other-1'), null);
    assert.strictEqual(gas.ctx.handle_({ key: KEY, action: 'list', app: 'diary' }).records.length, 1);
  });

  await t('サーバーが拒否した操作はキューから外して error を通知', async () => {
    const seen = [];
    const off = Apps.on('error', d => seen.push(d.error.code));
    await diary.put({ s: 'x'.repeat(50000) });
    await Apps.flush();
    assert.strictEqual(await Apps.pendingCount(), 0);
    assert.deepStrictEqual(seen, ['too_long']);
    off();
  });

  await t('合言葉違いはキューを残す', async () => {
    Apps.saveConnection({ url: Apps.getConnection().url, key: 'wrong' });
    await diary.put({ text: 'x' });
    const r = await Apps.flush();
    assert.strictEqual(r.left, 1);
    assert.strictEqual(r.error.code, 'bad_key');
    assert.ok(/合言葉/.test(Apps.errorText(r.error)));
    Apps.saveConnection({ url: Apps.getConnection().url, key: KEY });
    assert.strictEqual((await Apps.flush()).left, 0);
  });

  await t('端末内の控えは読み込み直しても残る', async () => {
    const saved = JSON.parse(store['apps.kv.rec:diary']);
    assert.ok(Object.keys(saved).length >= 2);
  });

  await t('imageUrl', async () => {
    assert.ok(Apps.imageUrl({ id: 'abc' }, 400).endsWith('id=abc&sz=w400'));
  });

  await wait(400); // 予約された自動送信が終わるのを待つ
  console.log(`\n${passed} 件 すべて成功`);
})().catch(e => { console.error(e); process.exit(1); });
