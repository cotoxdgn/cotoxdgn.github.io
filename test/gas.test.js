// gas/Code.gs の単体テスト（SpreadsheetApp などを簡易モックして node で実行）
// 実行：node test/gas.test.js
'use strict';
const assert = require('assert');
const { ctx, ss, drive, clockBox, FakeDate } = require('./gas-mock')();

// ---------- テスト ----------
const call = req => JSON.parse(ctx.doPost({ postData: { contents: JSON.stringify(req) } }).text);
let passed = 0;
function t(name, fn) { fn(); passed++; console.log('ok -', name); }

t('setup 前は no_setup', () => { assert.strictEqual(call({ key: 'x', action: 'ping' }).error, 'no_setup'); });

ctx.setup();
const conf = ss.getSheetByName('設定');
const KEY = String(conf.getRange('B1').getValue());
const tick = () => { clockBox.t += 1000; };

t('setup：合言葉・画像フォルダ・既定シート削除', () => {
  assert.ok(KEY.length >= 32);
  assert.ok(String(conf.getRange('B4').getValue()).startsWith('F'));
  assert.strictEqual(ss.getSheetByName('シート1'), null);
  ctx.setup(); // 2回目でも合言葉は変わらない
  assert.strictEqual(String(conf.getRange('B1').getValue()), KEY);
});
t('合言葉違い・壊れた送信・不明 action', () => {
  assert.strictEqual(call({ key: 'wrong', action: 'ping' }).error, 'bad_key');
  assert.strictEqual(JSON.parse(ctx.doPost({ postData: { contents: '{' } }).text).error, 'bad_request');
  assert.strictEqual(call({ key: KEY, action: 'zzz' }).error, 'bad_action');
});
t('不正なアプリ名を拒否', () => {
  assert.strictEqual(call({ key: KEY, action: 'list', app: '../x' }).error, 'bad_app');
  assert.strictEqual(call({ key: KEY, action: 'put', app: 'A B', data: {} }).error, 'bad_app');
});
t('まだシートがないアプリの list は空', () => {
  const r = call({ key: KEY, action: 'list', app: 'diary' });
  assert.ok(r.ok); assert.deepStrictEqual(r.records, []); assert.ok(r.now);
});
let r1, r2;
t('put：作成（シート自動作成、id 自動）', () => {
  tick();
  const r = call({ key: KEY, action: 'put', app: 'diary', data: { text: 'こんにちは' } });
  assert.ok(r.ok, JSON.stringify(r));
  r1 = r.record;
  assert.ok(ss.getSheetByName('app=diary'));
  assert.deepStrictEqual(r1.data, { text: 'こんにちは' });
  assert.strictEqual(r1.deleted, false);
  assert.strictEqual(r1.createdAt, r1.updatedAt);
});
t('put：アプリ側の id と createdAt を使う', () => {
  tick();
  const r = call({ key: KEY, action: 'put', app: 'diary', id: 'local-1', createdAt: '2026-10-01T09:00:00Z', data: { text: 'b' } });
  r2 = r.record;
  assert.strictEqual(r2.id, 'local-1');
  assert.strictEqual(r2.createdAt, '2026-10-01T09:00:00.000Z');
});
let sinceMark;
t('put：更新は同じ行、createdAt は保持', () => {
  tick(); sinceMark = new FakeDate().toISOString();
  const r = call({ key: KEY, action: 'put', app: 'diary', id: 'local-1', data: { text: 'b2' } });
  assert.strictEqual(r.record.createdAt, '2026-10-01T09:00:00.000Z');
  assert.ok(r.record.updatedAt > r2.updatedAt);
  assert.strictEqual(ss.getSheetByName('app=diary').getLastRow(), 3);
});
t('list：全件', () => {
  const r = call({ key: KEY, action: 'list', app: 'diary' });
  assert.strictEqual(r.records.length, 2);
  assert.strictEqual(r.records.find(x => x.id === 'local-1').data.text, 'b2');
});
t('delete：論理削除。全件 list から消え、差分 list には出る', () => {
  tick();
  const d = call({ key: KEY, action: 'delete', app: 'diary', id: r1.id });
  assert.ok(d.ok); assert.strictEqual(d.record.deleted, true);
  const all = call({ key: KEY, action: 'list', app: 'diary' });
  assert.deepStrictEqual(all.records.map(x => x.id), ['local-1']);
  const diff = call({ key: KEY, action: 'list', app: 'diary', since: sinceMark });
  assert.deepStrictEqual(diff.records.map(x => x.id).sort(), [r1.id, 'local-1'].sort());
  assert.strictEqual(ss.getSheetByName('app=diary').getLastRow(), 3); // 行は残る
});
t('差分 list：now 以降は変化なしなら空', () => {
  const now = call({ key: KEY, action: 'ping' }).now;
  tick();
  assert.deepStrictEqual(call({ key: KEY, action: 'list', app: 'diary', since: new FakeDate(clockBox.t).toISOString() }).records, []);
  assert.ok(now);
});
t('アプリごとに別シート', () => {
  call({ key: KEY, action: 'put', app: 'routine', id: 'r1', data: { name: '歯磨き' } });
  assert.strictEqual(call({ key: KEY, action: 'list', app: 'routine' }).records.length, 1);
  assert.strictEqual(call({ key: KEY, action: 'list', app: 'diary' }).records.length, 1);
  assert.deepStrictEqual(call({ key: KEY, action: 'ping' }).apps.sort(), ['diary', 'routine']);
});
t('サイズ上限・不正 id', () => {
  assert.strictEqual(call({ key: KEY, action: 'put', app: 'diary', data: { s: 'x'.repeat(50000) } }).error, 'too_long');
  assert.strictEqual(call({ key: KEY, action: 'put', app: 'diary', id: 'a/b', data: {} }).error, 'bad_id');
});
t('batch：1件ずつ結果、失敗があっても続行', () => {
  tick();
  const r = call({ key: KEY, action: 'batch', app: 'archmap', ops: [
    { op: 'put', id: 'm1', data: { name: '大阪府立中之島図書館' } },
    { op: 'put', id: 'bad/id', data: {} },
    { op: 'delete', id: 'm1' },
    { op: 'put', app: 'brain', id: 'b1', data: { t: 1 } }
  ] });
  assert.ok(r.ok);
  assert.deepStrictEqual(r.results.map(x => x.ok), [true, false, true, true]);
  assert.strictEqual(call({ key: KEY, action: 'list', app: 'archmap' }).records.length, 0);
  assert.strictEqual(call({ key: KEY, action: 'list', app: 'brain' }).records.length, 1);
});
let img;
t('image：アプリ別サブフォルダに保存し URL を返す', () => {
  const b64 = Buffer.from('fakejpeg').toString('base64');
  const r = call({ key: KEY, action: 'image', app: 'diary', mime: 'image/jpeg', base64: 'data:image/jpeg;base64,' + b64 });
  assert.ok(r.ok, JSON.stringify(r));
  img = r.image;
  assert.ok(img.url.includes(img.id));
  const f = drive.byId[img.id];
  assert.strictEqual(f.parent.name, 'diary');
  assert.deepStrictEqual(f.sharing, ['AWL', 'VIEW']);
  assert.ok(/\.jpg$/.test(img.name));
});
t('image：上限超え・形式違いを拒否', () => {
  const big = Buffer.alloc(2 * 1024 * 1024 + 10).toString('base64');
  assert.strictEqual(call({ key: KEY, action: 'image', app: 'diary', mime: 'image/jpeg', base64: big }).error, 'too_large');
  assert.strictEqual(call({ key: KEY, action: 'image', app: 'diary', mime: 'application/pdf', base64: 'AAAA' }).error, 'bad_mime');
});
t('imageData / imageDelete：画像フォルダ外のファイルは触れない', () => {
  const d = call({ key: KEY, action: 'imageData', id: img.id });
  assert.strictEqual(Buffer.from(d.base64, 'base64').toString(), 'fakejpeg');
  const outside = ctx.DriveApp.createFolder('他').createFile(ctx.Utilities.newBlob('secret', 'text/plain', 's.txt'));
  assert.strictEqual(call({ key: KEY, action: 'imageData', id: outside.getId() }).error, 'not_found');
  assert.ok(call({ key: KEY, action: 'imageDelete', id: img.id }).ok);
  assert.strictEqual(drive.byId[img.id].trashed, true);
});
t('接続リンク：connect ページ＋#c=（u,k,n、対象アプリ a）', () => {
  const dec = l => JSON.parse(Buffer.from(l.split('#c=')[1], 'base64').toString());
  let link = ctx.connectLink_(conf);
  assert.ok(link.startsWith('https://cotoxdgn.github.io/connect/#c='));
  let p = dec(link);
  assert.strictEqual(p.k, KEY); assert.ok(/\/exec$/.test(p.u)); assert.strictEqual(p.a, undefined);
  conf.getRange('B3').setValue('wanko');
  p = dec(ctx.connectLink_(conf));
  assert.strictEqual(p.a, 'wanko');
  conf.getRange('B3').setValue('');
});
t('doGet は ok を返し接続URLを覚える', () => {
  assert.ok(JSON.parse(ctx.doGet().text).ok);
  assert.ok(/\/exec$/.test(String(conf.getRange('B2').getValue())));
});
console.log(`\n${passed} 件 すべて成功`);
