// gas/Code.gs の予定合わせ（yotei*）の単体テスト（test/gas-mock.js を使う）
// 実行：node test/yotei.test.js
'use strict';
const assert = require('assert');
const { ctx, ss, clockBox, cal } = require('./gas-mock')();

const call = req => JSON.parse(ctx.doPost({ postData: { contents: JSON.stringify(req) } }).text);
let passed = 0;
function t(name, fn) { fn(); passed++; console.log('ok -', name); }

ctx.setup();
const KEY = String(ss.getSheetByName('設定').getRange('B1').getValue());
const tick = (ms) => { clockBox.t += ms || 1000; };
const TOKEN = 'q7Rk2mWx9TzL4pVa8nHc3sYe6uBd1fJg';
const DEV = 'devAAAAAAAAAAAAAAAAAAAA1';
const days = 7, rows = 24; // 11/9〜11/15、9:00〜21:00、30分
const empty = () => Array.from({ length: days }, () => '0'.repeat(rows));
const paint = (d, r0, r1) => { const c = empty(); c[d] = c[d].split('').map((x, i) => (i >= r0 && i < r1 ? '1' : x)).join(''); return c; };
const ev = (over) => Object.assign({ kind: 'event', title: '打合せ（試験）', start: '2026-11-09', end: '2026-11-15', from: 9, to: 21, step: 30, need: 60,
  deadline: '2026-11-08', token: TOKEN, mine: empty(), status: 'open' }, over || {});
const putEv = (id, over) => { tick(); const r = call({ key: KEY, action: 'put', app: 'yotei', id, data: ev(over) }); assert.ok(r.ok, JSON.stringify(r)); return r; };
const answer = (o) => { tick(); return call(Object.assign({ action: 'yoteiAnswer', token: TOKEN, name: '山田', device: DEV, cells: paint(0, 12, 18) }, o || {})); };
const answers = () => (ss.getSheetByName('yotei_answers') ? ss.getSheetByName('yotei_answers').getLastRow() - 1 : 0);
const snapshotOthers = () => JSON.stringify(ss.getSheets().filter(s => !/^(yotei_answers|yotei_writes)$/.test(s.getName())).map(s => [s.getName(), s.cells]));

t('予定合わせを put（ふつうの同期）で作る', () => { putEv('ev1'); });

t('yoteiGet：合言葉なしで、相手に見せてよいものだけ返す', () => {
  const r = call({ action: 'yoteiGet', token: TOKEN });
  assert.ok(r.ok, JSON.stringify(r));
  assert.deepStrictEqual(Object.keys(r.event).sort(), ['deadline', 'end', 'from', 'start', 'state', 'step', 'title', 'to']);
  assert.strictEqual(r.event.state, 'open');
  assert.strictEqual(r.event.title, '打合せ（試験）');
  const txt = JSON.stringify(r);
  assert.ok(!txt.includes(TOKEN) && !txt.includes('mine') && !txt.includes('ev1'));
});

t('トークン違い・形の違い・合言葉付きでも、返すのは not_found だけ', () => {
  for (const token of ['q7Rk2mWx9TzL4pVa8nHc3sYe6uBd1fJh', 'q7Rk2mWx9TzL4pVa8nHc3sYe6uBd1fJ', '', 123, '../../x'.padEnd(32, 'a'), TOKEN.slice(0, 31) + '-']) {
    assert.deepStrictEqual(call({ action: 'yoteiGet', token }), { ok: false, error: 'not_found' });
    assert.deepStrictEqual(call({ action: 'yoteiAnswer', token, name: 'x', device: DEV, cells: empty() }), { ok: false, error: 'not_found' });
  }
  assert.deepStrictEqual(call({ key: 'wrong', action: 'yoteiGet', token: 'x' }), { ok: false, error: 'not_found' });
});

t('合言葉の要る yotei の action は、合言葉なしでは使えない', () => {
  for (const action of ['yoteiCal', 'yoteiResults', 'yoteiCreateEvent']) {
    assert.strictEqual(call({ action, from: '2026-11-09', to: '2026-11-15', id: 'ev1' }).error, 'bad_key');
    assert.strictEqual(call({ key: 'wrong', action }).error, 'bad_key');
  }
  // 合言葉なしの窓口から、ほかの action には進めない
  assert.strictEqual(call({ action: 'list', app: 'yotei' }).error, 'bad_key');
});

t('yoteiAnswer：名前と塗ったマスだけ保存、ほかの項目は捨てる。ほかのシートには触れない', () => {
  const before = snapshotOthers();
  const r = answer({ extra: 'xxx', app: 'diary', key: 'nope', id: 'hack' });
  assert.ok(r.ok, JSON.stringify(r));
  assert.strictEqual(answers(), 1);
  const row = ss.getSheetByName('yotei_answers').cells[1];
  assert.strictEqual(row[0], 'ev1'); assert.strictEqual(row[1], DEV); assert.strictEqual(row[4], '0');
  assert.deepStrictEqual(JSON.parse(row[5]), { name: '山田', cells: paint(0, 12, 18) });
  assert.strictEqual(snapshotOthers(), before);
  assert.ok(!call({ key: KEY, action: 'ping' }).apps.includes('yotei_answers'));
});

t('名前＋端末が同じなら上書き（直した回数を数える）。端末が違えば別の人', () => {
  const r = answer({ cells: paint(1, 0, 4) });
  assert.ok(r.ok); assert.strictEqual(r.edits, 1);
  assert.strictEqual(answers(), 1);
  assert.deepStrictEqual(JSON.parse(ss.getSheetByName('yotei_answers').cells[1][5]).cells, paint(1, 0, 4));
  assert.ok(answer({ device: 'devBBBBBBBBBBBBBBBBBBBB2' }).ok);
  assert.ok(answer({ name: '佐藤' }).ok); // 同じ端末でも名前が違えば別の人（家族で1台など）
  assert.strictEqual(answers(), 3);
});

t('名前・端末ID・マスの形を確かめる（期間外のマスは送れない）', () => {
  assert.strictEqual(answer({ name: '' }).error, 'bad_name');
  assert.strictEqual(answer({ name: '   ' }).error, 'bad_name');
  assert.strictEqual(answer({ name: 'あ'.repeat(21) }).error, 'bad_name');
  assert.strictEqual(answer({ name: { a: 1 } }).error, 'bad_name');
  assert.strictEqual(answer({ device: 'short' }).error, 'bad_request');
  assert.strictEqual(answer({ cells: empty().concat(['0'.repeat(rows)]) }).error, 'bad_cells'); // 8日目
  assert.strictEqual(answer({ cells: empty().map((c, i) => (i ? c : c + '1')) }).error, 'bad_cells'); // 21時以降
  assert.strictEqual(answer({ cells: empty().map((c, i) => (i ? c : '2' + c.slice(1))) }).error, 'bad_cells');
  assert.strictEqual(answer({ cells: 'xx' }).error, 'bad_cells');
  assert.strictEqual(answer({ cells: paint(0, 0, 2), pad: 'x'.repeat(5000) }).error, 'too_long');
  assert.strictEqual(answers(), 3);
});

t('名前に = で始まる文字を入れても、セルの先頭は { のまま（式として読まれない）', () => {
  assert.ok(answer({ name: '=IMPORTXML("x")', device: 'devCCCCCCCCCCCCCCCCCCCC3' }).ok);
  const cells = ss.getSheetByName('yotei_answers').cells.slice(1);
  cells.forEach(r => r.forEach(v => assert.ok(!/^[=+@-]/.test(String(v)) || /^dev|^ev/.test(v), v)));
  assert.strictEqual(answers(), 4);
});

t('答える人は5人まで', () => {
  assert.ok(answer({ name: '5人目', device: 'devDDDDDDDDDDDDDDDDDDDD4' }).ok);
  assert.strictEqual(answer({ name: '6人目', device: 'devEEEEEEEEEEEEEEEEEEEE5' }).error, 'full');
  assert.ok(answer({}).ok); // 答えた人が直すのはできる
});

t('1人20回まで直せる', () => {
  const dev = 'devDDDDDDDDDDDDDDDDDDDD4';
  let r;
  for (let i = 0; i < 19; i++) { r = answer({ name: '5人目', device: dev }); assert.ok(r.ok, i + JSON.stringify(r)); }
  assert.strictEqual(r.edits, 19);
  r = answer({ name: '5人目', device: dev }); assert.ok(r.ok); assert.strictEqual(r.editsLeft, 0);
  assert.strictEqual(answer({ name: '5人目', device: dev }).error, 'too_many_edits');
});

t('1つの予定合わせへの書き込みは1時間に60回まで（1時間たてば戻る）', () => {
  const T2 = 'Z'.repeat(32);
  putEv('ev-rate', { token: T2 });
  const names = ['a', 'b', 'c'];
  let ok = 0, r;
  for (let i = 0; i < 61; i++) {
    tick(10);
    r = call({ action: 'yoteiAnswer', token: T2, name: names[i % 3], device: 'devRRRRRRRRRRRRRRRRRRRR' + (i % 3), cells: empty() });
    if (r.ok) ok++; else break;
  }
  assert.strictEqual(ok, 60); assert.strictEqual(r.error, 'too_many');
  tick(3600 * 1000 + 1000);
  assert.ok(call({ action: 'yoteiAnswer', token: T2, name: 'a', device: 'devRRRRRRRRRRRRRRRRRRRR0', cells: empty() }).ok);
});

t('ロックが取れないときは busy', () => {
  const real = ctx.LockService;
  ctx.LockService = { getScriptLock: () => ({ waitLock() { throw new Error('timeout'); }, releaseLock() {} }) };
  assert.strictEqual(answer({}).error, 'busy');
  ctx.LockService = real;
});

t('yoteiResults：答えを返す（端末IDは返さない）', () => {
  const r = call({ key: KEY, action: 'yoteiResults', id: 'ev1' });
  assert.ok(r.ok);
  assert.deepStrictEqual(Object.keys(r.answers), ['ev1']);
  assert.ok(r.answers.ev1.length >= 4);
  assert.ok(!JSON.stringify(r).includes('dev'));
  assert.deepStrictEqual(Object.keys(r.answers.ev1[0]).sort(), ['cells', 'createdAt', 'edits', 'name', 'updatedAt']);
  const all = call({ key: KEY, action: 'yoteiResults' });
  assert.deepStrictEqual(Object.keys(all.answers).sort(), ['ev-rate', 'ev1']);
});

t('yoteiCal：開始・終了だけ。終日・欠席の予定は除く。件名は返さない', () => {
  const at = (d, h) => Date.parse(`2026-11-${d}T${String(h).padStart(2, '0')}:00:00+09:00`);
  cal.events.push({ s: at('09', 9), e: at('09', 12), title: '秘密の打合せ' });
  cal.events.push({ s: at('10', 0), e: at('11', 0), title: '終日', allDay: true });
  cal.events.push({ s: at('12', 13), e: at('12', 15), title: '欠席', status: 'NO' });
  cal.events.push({ s: at('20', 9), e: at('20', 10), title: '期間外' });
  const r = call({ key: KEY, action: 'yoteiCal', from: '2026-11-09', to: '2026-11-15' });
  assert.ok(r.ok, JSON.stringify(r));
  assert.deepStrictEqual(r.busy, [{ s: '2026-11-09T00:00:00.000Z', e: '2026-11-09T03:00:00.000Z' }]);
  assert.ok(!JSON.stringify(r).includes('秘密'));
  assert.strictEqual(call({ key: KEY, action: 'yoteiCal', from: '2026-11-01', to: '2026-11-30' }).error, 'too_long');
  assert.strictEqual(call({ key: KEY, action: 'yoteiCal', from: 'x', to: '2026-11-30' }).error, 'bad_request');
  cal.fail = 'You do not have permission to call CalendarApp.getDefaultCalendar';
  const f = call({ key: KEY, action: 'yoteiCal', from: '2026-11-09', to: '2026-11-15' });
  assert.strictEqual(f.error, 'calendar'); assert.ok(/permission/.test(f.detail));
  cal.fail = '';
});

t('相手の窓口はカレンダーに触れない', () => {
  const n = cal.reads;
  call({ action: 'yoteiGet', token: TOKEN }); answer({});
  assert.strictEqual(cal.reads, n); assert.strictEqual(cal.created.length, 0);
});

t('yoteiCreateEvent：1件だけ作り（招待なし）、決定にする。2回目は already', () => {
  assert.strictEqual(call({ key: KEY, action: 'yoteiCreateEvent', id: 'ev1', start: '2026-11-20T10:00:00+09:00', end: '2026-11-20T11:00:00+09:00' }).error, 'bad_time');
  assert.strictEqual(call({ key: KEY, action: 'yoteiCreateEvent', id: 'ev1', start: '2026-11-09T11:00:00+09:00', end: '2026-11-09T10:00:00+09:00' }).error, 'bad_time');
  assert.strictEqual(call({ key: KEY, action: 'yoteiCreateEvent', id: 'nope', start: '2026-11-09T10:00:00+09:00', end: '2026-11-09T11:00:00+09:00' }).error, 'not_found');
  const r = call({ key: KEY, action: 'yoteiCreateEvent', id: 'ev1', start: '2026-11-09T15:00:00+09:00', end: '2026-11-09T16:00:00+09:00' });
  assert.ok(r.ok, JSON.stringify(r));
  assert.strictEqual(cal.created.length, 1);
  const c = cal.created[0];
  assert.strictEqual(c.title, '打合せ（試験）');
  assert.strictEqual(c.s, Date.parse('2026-11-09T06:00:00Z'));
  assert.ok(c.opts.description.includes('山田') && c.opts.description.includes('佐藤'));
  assert.strictEqual(c.opts.sendInvites, false); assert.strictEqual(c.opts.guests, undefined);
  assert.strictEqual(r.record.data.status, 'decided');
  assert.strictEqual(r.record.data.decided.start, '2026-11-09T06:00:00.000Z');
  assert.strictEqual(call({ key: KEY, action: 'yoteiCreateEvent', id: 'ev1', start: '2026-11-09T15:00:00+09:00', end: '2026-11-09T16:00:00+09:00' }).error, 'already');
  assert.strictEqual(cal.created.length, 1);
});

t('決定後：相手は書き込めず、yoteiGet に決定日時が出る', () => {
  assert.strictEqual(answer({}).error, 'closed');
  const g = call({ action: 'yoteiGet', token: TOKEN });
  assert.strictEqual(g.event.state, 'decided');
  assert.deepStrictEqual(g.event.decided, { start: '2026-11-09T06:00:00.000Z', end: '2026-11-09T07:00:00.000Z' });
});

t('締め切った・締切日を過ぎた予定合わせには書き込めない', () => {
  const T3 = 'C'.repeat(32), T4 = 'D'.repeat(32);
  putEv('ev-closed', { token: T3, status: 'closed' });
  assert.strictEqual(call({ action: 'yoteiAnswer', token: T3, name: 'a', device: DEV, cells: empty() }).error, 'closed');
  assert.strictEqual(call({ action: 'yoteiGet', token: T3 }).event.state, 'closed');
  putEv('ev-dl', { token: T4, deadline: '2026-10-31' });  // 今は 10/30 ごろ（時計はテストで進んでいる）
  const now = clockBox.t;
  clockBox.t = Date.parse('2026-10-31T23:59:00+09:00');
  assert.ok(call({ action: 'yoteiAnswer', token: T4, name: 'a', device: DEV, cells: empty() }).ok); // 締切日のうちはOK
  clockBox.t = Date.parse('2026-11-01T00:00:01+09:00');
  assert.strictEqual(call({ action: 'yoteiAnswer', token: T4, name: 'a', device: DEV, cells: empty() }).error, 'closed');
  assert.strictEqual(call({ action: 'yoteiGet', token: T4 }).event.state, 'closed');
  clockBox.t = Math.max(now, clockBox.t);
});

t('リンクの作り直し（トークンを替える put）で古いリンクは見つからない', () => {
  const T5 = 'E'.repeat(32), T6 = 'F'.repeat(32);
  putEv('ev-re', { token: T5 });
  assert.ok(call({ action: 'yoteiGet', token: T5 }).ok);
  putEv('ev-re', { token: T6 });
  assert.strictEqual(call({ action: 'yoteiGet', token: T5 }).error, 'not_found');
  assert.ok(call({ action: 'yoteiGet', token: T6 }).ok);
});

t('消した予定合わせ：見つからない。答えは次の読み書きで消える', () => {
  const T7 = 'G'.repeat(32);
  putEv('ev-del', { token: T7 });
  assert.ok(call({ action: 'yoteiAnswer', token: T7, name: 'a', device: DEV, cells: empty() }).ok);
  const n = answers();
  tick(); assert.ok(call({ key: KEY, action: 'delete', app: 'yotei', id: 'ev-del' }).ok);
  assert.strictEqual(call({ action: 'yoteiGet', token: T7 }).error, 'not_found');
  call({ key: KEY, action: 'yoteiResults' });
  assert.strictEqual(answers(), n - 1);
});

t('期間の終わりから30日で、答えが消え、リンクも見つからない', () => {
  const T8 = 'H'.repeat(32);
  putEv('ev-old', { token: T8, start: '2026-11-01', end: '2026-11-02', deadline: '2026-11-02' });
  clockBox.t = Date.parse('2026-11-01T10:00:00+09:00');
  assert.ok(call({ action: 'yoteiAnswer', token: T8, name: 'a', device: DEV, cells: [Array(25).join('0'), Array(25).join('0')] }).ok);
  const n = answers();
  clockBox.t = Date.parse('2026-12-02T23:59:00+09:00'); // 11/2 の終わり＋30日 の直前
  assert.ok(call({ action: 'yoteiGet', token: T8 }).ok);
  clockBox.t = Date.parse('2026-12-03T00:00:01+09:00');
  assert.strictEqual(call({ action: 'yoteiGet', token: T8 }).error, 'not_found');
  call({ key: KEY, action: 'yoteiResults' });
  assert.ok(answers() < n);
  assert.ok(!ss.getSheetByName('yotei_answers').cells.slice(1).some(r => r[0] === 'ev-old'));
});

t('既存の action はそのまま動く', () => {
  assert.ok(call({ key: KEY, action: 'ping' }).ok);
  assert.ok(call({ key: KEY, action: 'list', app: 'yotei' }).records.length >= 1);
  assert.strictEqual(call({ key: KEY, action: 'zzz' }).error, 'bad_action');
});

console.log(`\n${passed} 件 すべて成功`);
