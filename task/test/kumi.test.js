// 工程の組み立ての計算（kumitate.js の window.Kumi）。実行：TZ=Asia/Tokyo node task/test/kumi.test.js
'use strict';
const assert = require('assert');
const K = require('../kumitate.js');
let n = 0; const t = (name, fn) => { fn(); n++; console.log('ok -', name); };
const T = '2026-11-09';   // 月曜
t('休み：水・日・祝日（11/23 勤労感謝の日）', () => {
  assert.ok(!K.isWork('2026-11-11')); assert.ok(!K.isWork('2026-11-15')); assert.ok(!K.isWork('2026-11-23')); assert.ok(K.isWork('2026-11-10'));
  assert.strictEqual(K.nextWork('2026-11-11'), '2026-11-12');
  assert.strictEqual(K.workDiff('2026-11-09', '2026-11-13'), 3, '月→金：火・木・金（水は休み）');
});
t('並び順に1日6hまで詰める。ほかの案件の時間も引く', () => {
  const s = K.schedule([{ key: 'a', ko: 4 }, { key: 'b', ko: 3 }, { key: 'c', ko: 2 }, { key: 'm', ms: true }], T, { '2026-11-10': 5 });
  assert.strictEqual(s.dates.a, '2026-11-09'); assert.strictEqual(s.dates.b, '2026-11-12', '火はほかで5h埋まっている・水は休み');
  assert.strictEqual(s.dates.c, '2026-11-12'); assert.strictEqual(s.dates.m, '2026-11-12', '◆は手前の駅が済む日');
});
t('6hをこえる駅は空いている日にまるごと入れる・並びより前には戻らない', () => {
  const s = K.schedule([{ key: 'a', ko: 1 }, { key: 'b', ko: 8 }, { key: 'c', ko: 1 }], T, {});
  assert.strictEqual(s.dates.b, '2026-11-10'); assert.strictEqual(s.dates.c, '2026-11-12', '火は8hで埋まったので次の稼働日');
});
t('依頼の待ち日数：前提にしている駅は返事のあと', () => {
  const s = K.schedule([{ key: 'req', ko: 0.5, wait: 3 }, { key: 'x', ko: 2, pre: 'req' }], T, {});
  assert.strictEqual(s.dates.req, '2026-11-09'); assert.strictEqual(s.dates.x, '2026-11-13', '月＋稼働日3日＝金');
});
t('ヒント：◆に必要ないものを後ろへ回すと早まる／印がないときは印の案内', () => {
  const seq = [{ key: 'demo', ko: 6, label: 'デモ動画', need: '' }, { key: 'a', ko: 4, label: '表紙', need: '提案' }, { key: 'm', ms: true, msName: '提案', label: '◆提案' }];
  const h = K.hints(seq, T, {});
  const need = h.find(x => x.kind === 'need');
  assert.ok(need && need.gain > 0, JSON.stringify(h));
  assert.deepStrictEqual(need.seq.map(x => x.key), ['a', 'm', 'demo']);
  const h2 = K.hints(seq.map(x => Object.assign({}, x, { need: '' })), T, {});
  assert.ok(h2.some(x => x.kind === 'tag'));
});
t('ヒント：依頼を先に出すと早まる・3hをこえる駅は分ける案', () => {
  const seq = [{ key: 'a', ko: 5, label: 'A', need: '提案' }, { key: 'a2', ko: 5, label: 'A2', need: '提案' }, { key: 'req', ko: 0.5, wait: 3, label: '価格の確認依頼', need: '提案' }, { key: 'b', ko: 1, pre: 'req', label: 'B', need: '提案' }, { key: 'm', ms: true, msName: '提案' }];
  const h = K.hints(seq, T, {});
  const w = h.find(x => x.kind === 'wait'); assert.ok(w && w.gain > 0, JSON.stringify(h));
  assert.strictEqual(w.seq[0].key, 'req');
  assert.ok(h.some(x => x.kind === 'split' && x.split === 'a'));
});
t('詳細の印の読み書き', () => {
  const d = K.parseDetail('🚫外す メモ https://x →◆藤井さんへ提案 ⏳3日');
  assert.deepStrictEqual([d.ex, d.need, d.wait, d.base], [true, '藤井さんへ提案', 3, 'メモ https://x']);
  assert.strictEqual(K.composeDetail('メモ', '提案', 2, false), 'メモ →◆提案 ⏳2日');
  assert.strictEqual(K.msName('【確認】◆補助金の交付決定'), '補助金の交付決定');
});
console.log(`\n${n} passed`);
