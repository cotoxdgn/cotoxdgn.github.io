// 空間ひきだし帖の公開用の読み出し（GAS hikiPublic）：合言葉なしで、出してよいものだけ返すか
'use strict';
const assert = require('assert');
const gas = require('./gas-mock.js')();
gas.ctx.setup();
const conf = gas.ss.getSheetByName('設定');
const KEY = String(conf.getRange('B1').getValue());
let n = 0;
const eq = (a, b, m) => assert.strictEqual(JSON.stringify(a), JSON.stringify(b), m);
const t = (name, fn) => { fn(); n++; console.log('ok -', name); };
const at = s => { gas.clockBox.t = Date.parse(s); };
const put = (id, data) => { gas.clockBox.t += 10; const r = gas.ctx.handle_({ key: KEY, action: 'put', app: 'hikidashi', id, data }); assert.ok(r.ok, JSON.stringify(r)); };
const pub = () => gas.ctx.handle_({ action: 'hikiPublic' });
at('2026-11-05T09:00:00+09:00');
const IMG = { id: 'abcdefghijklmnop1234', thumb: 'x' };
put('c1', { kind: 'card', no: 1, type: 'item', status: 'done', publishAt: '2026-11-04', from: '無垢の反りが心配', to: '突板の複合フローリング', phrase: '見た目は無垢に近い', stockId: 's1', fromWork: true, workPub: '', illust: IMG, photo: null, noteUrl: 'https://note.com/x/n/abc', at: 'x', secret: 'ひみつ' });
put('c2', { kind: 'card', no: 2, type: 'law', status: 'done', publishAt: '2026-11-05', from: '内装制限ってなに？', to: '燃えにくい仕上げのルール', phrase: 'ことふう', article: '建築基準法35条の2', checkedOn: '2026-11-01', fromWork: false });
put('c3', { kind: 'card', no: 3, type: 'detail', status: 'done', publishAt: '2026-11-06', from: '予約中', to: 'まだ出ない', phrase: '' });
put('c4', { kind: 'card', no: 4, type: 'rec', status: 'draft', publishAt: '2026-11-01', from: '下書き', to: '出ない', phrase: '' });
put('c5', { kind: 'card', no: 5, type: 'item', status: 'done', publishAt: '2026-11-03', from: 'フジイ', to: 'ブース', phrase: '', fromWork: true, workPub: '秋月貿易のブース', link: 'javascript:alert(1)' });
put('s1', { kind: 'stock', type: 'item', name: 'ひみつのストック', workId: 'w-1', workName: 'ひみつの案件' });
put('wn', { kind: 'worknote', workId: 'w-1', point: 'ひみつの工夫' });
put('a1', { kind: 'award', name: 'インテリアの賞', url: 'https://example.com/a', date: '2026-12-10', memo: '' });
put('a2', { kind: 'award', name: '去年の賞', url: 'https://example.com/b', date: '2026-06-30', memo: '' });

t('合言葉なしで読める。公開日を過ぎた完成カードだけ（予約中・下書きは出ない）、新しい順', () => {
  const r = pub();
  assert.ok(r.ok, JSON.stringify(r));
  eq(r.cards.map(c => c.no), [2, 1, 5]);
  assert.strictEqual(r.updated, '2026-11-05');
  assert.strictEqual(r.name, 'coo', '設定がなければ coo');
});
t('出す項目だけ（ストック・工夫点・案件名・id・ほかの項目は出さない）', () => {
  const s = JSON.stringify(pub());
  ['ひみつ', 'stockId', 'workId', 'w-1', '"c1"', 'secret', '"thumb"'].forEach(w => assert.ok(!s.includes(w), w));
  const c1 = pub().cards.find(c => c.no === 1);
  eq(Object.keys(c1).sort(), ['article', 'checked', 'date', 'from', 'illust', 'link', 'no', 'note', 'phrase', 'photo', 'to', 'type', 'work'].sort());
  assert.strictEqual(c1.illust, 'https://drive.google.com/thumbnail?id=abcdefghijklmnop1234&sz=w1600');
  assert.strictEqual(c1.note, 'https://note.com/x/n/abc');
  assert.strictEqual(pub().cards.find(c => c.no === 5).link, '', 'https 以外のリンクは出さない');
  assert.strictEqual(pub().cards.find(c => c.no === 2).article, '建築基準法35条の2');
  assert.strictEqual(c1.article, '', '法規以外は条文を出さない');
});
t('実績の表記：2027年3月までは出さない。4月からは「実務で使用」、フジイの案件は通称', () => {
  assert.ok(pub().cards.every(c => c.work === ''));
  at('2027-04-01T09:00:00+09:00');
  const r = pub();
  assert.strictEqual(r.cards.find(c => c.no === 1).work, '実務で使用');
  assert.strictEqual(r.cards.find(c => c.no === 5).work, '実績：秋月貿易のブース');
  assert.strictEqual(r.cards.find(c => c.no === 2).work, '');
  at('2026-11-05T09:00:00+09:00');
});
t('賞：締切順。過ぎた締切は翌年の同じ日に仮で繰り越す（tentative）', () => {
  const r = pub();
  eq(r.awards.map(a => [a.name, a.date, a.tentative]), [['インテリアの賞', '2026-12-10', false], ['去年の賞', '2027-06-30', true]]);
});
t('公開名義は設定の publicName（4月に「こと」へ切り替え）', () => {
  put('conf', { kind: 'conf', publicName: 'こと' });
  assert.strictEqual(pub().name, 'こと');
});
t('家族用など、対象アプリが別のスプシでは出さない', () => {
  conf.getRange('B3').setValue('wanko');
  eq(pub(), { ok: false, error: 'not_found' });
  conf.getRange('B3').setValue('');
});
t('スプシには何も書かない', () => {
  const before = JSON.stringify(gas.ss.getSheets().map(x => [x.getName(), x.cells]));
  pub(); pub();
  assert.strictEqual(JSON.stringify(gas.ss.getSheets().map(x => [x.getName(), x.cells])), before);
});
console.log('\n' + n + ' 件 すべて成功');
