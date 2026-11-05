/* カードの種類と、インスタのストーリー画像（1080×1920）の描き方（window.HikiStory）
 *   KINDS：4種類の名前・色・入力欄の見出し・確認の項目
 *   draw(canvas, card, o)：card = { no, type, from, to, phrase }, o = { name（公開名義）, handle（@…）, illust（読み込んだ画像。なければ枠なし） }
 *   画像の中に「くわしくはプロフィールのHPから」を入れる（予約投稿でリンクのスタンプが外れることがあるため）
 */
(function (global) {
  'use strict';
  var KINDS = {
    item: { label: '商品', color: '#3E6FA8', ink: '#2B5283', lead: 'これが嫌やったら…', from: 'これが嫌やったら（元）', to: 'これもいけます（代案）', suffix: 'もいけますよ', check: '品番・廃番を確認済み' },
    detail: { label: '納まり', color: '#B4580C', ink: '#8A4209', lead: 'これが嫌やったら…', from: 'これが嫌やったら（元）', to: 'これもいけます（代案）', suffix: 'もいけますよ', check: '寸法・部材を確認済み' },
    law: { label: '法規', color: '#3B7A57', ink: '#2A5A3F', lead: 'よくある疑問', from: 'よくある疑問', to: '答え（ひとことで）', suffix: '', check: '' },
    rec: { label: 'おすすめ', color: '#7A4F9A', ink: '#5E3A72', lead: '設計者のみんなへ', from: 'こんな人へ・テーマ', to: '名前（賞・本・メディア）', suffix: '', check: '' }
  };
  var ORDER = ['item', 'detail', 'law', 'rec'];
  var TITLE = '空間ひきだし帖';
  var DISP = '"Zen Maru Gothic", "Hiragino Maru Gothic ProN", sans-serif';
  var BODY = '"Noto Sans JP", "Hiragino Sans", sans-serif';
  function no3(n) { n = String(n || 0); while (n.length < 3) n = '0' + n; return '#' + n; }
  // 日本語の折り返し（1文字ずつ測る。行頭に句読点が来ないよう前の行へ寄せる）
  function lines(ctx, text, width, max) {
    var out = [], cur = '';
    String(text || '').split('').forEach(function (ch) {
      if (ch === '\n') { out.push(cur); cur = ''; return; }
      if (ctx.measureText(cur + ch).width > width && cur) {
        if (/[、。，．）」』！？]/.test(ch)) { cur += ch; out.push(cur); cur = ''; return; }
        out.push(cur); cur = ch;
      } else cur += ch;
    });
    if (cur) out.push(cur);
    if (max && out.length > max) { out = out.slice(0, max); out[max - 1] = out[max - 1].replace(/.$/, '…'); }
    return out;
  }
  function rr(ctx, x, y, w, h, r) {
    ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }
  function draw(canvas, card, o) {
    o = o || {};
    var K = KINDS[card.type] || KINDS.item, W = 1080, H = 1920;
    canvas.width = W; canvas.height = H;
    var ctx = canvas.getContext('2d');
    ctx.fillStyle = K.color; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = 'rgba(255,255,255,0.10)'; ctx.beginPath(); ctx.arc(W - 30, 110, 270, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.08)'; ctx.beginPath(); ctx.arc(60, H - 420, 170, 0, Math.PI * 2); ctx.fill();
    // 上：シリーズ名と番号
    ctx.fillStyle = '#FFFFFF'; ctx.textBaseline = 'middle';
    ctx.font = '700 38px ' + DISP; ctx.fillText(TITLE + ' ｜ ' + K.label, 70, 170);
    ctx.font = '700 36px ' + BODY;
    var num = no3(card.no), nw = ctx.measureText(num).width + 44;
    ctx.fillStyle = 'rgba(255,255,255,0.18)'; rr(ctx, W - 70 - nw, 140, nw, 62, 30); ctx.fill();
    ctx.fillStyle = '#FFFFFF'; ctx.fillText(num, W - 70 - nw + 22, 172);
    // 白い紙
    var px = 70, py = 250, pw = W - 140, ph = H - 250 - 300;
    ctx.fillStyle = '#FBF7F0'; rr(ctx, px, py, pw, ph, 60); ctx.fill();
    var x = px + 56, y = py + 56, w = pw - 112;
    if (o.illust) {   // イラストは紙の上部いっぱいに（幅に合わせて拡大し、はみ出す分は上下左右を均等に切る＝真ん中が出る）
      var ih = 680, iw = pw, img = o.illust, s = Math.max(iw / img.width, ih / img.height);
      ctx.save(); rr(ctx, px, py, pw, ph, 60); ctx.clip();
      ctx.beginPath(); ctx.rect(px, py, iw, ih); ctx.clip();
      ctx.drawImage(img, px + (iw - img.width * s) / 2, py + (ih - img.height * s) / 2, img.width * s, img.height * s);
      ctx.restore();
      y = py + ih + 56;
    } else y += 260;   // イラストなしは文章を少し下げて、紙の中ほどに置く
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = K.ink; ctx.font = '700 34px ' + BODY; ctx.fillText(K.lead, x, y + 30); y += 78;
    ctx.fillStyle = '#2E2A26'; ctx.font = '700 54px ' + DISP;
    lines(ctx, card.from, w, 3).forEach(function (l) { ctx.fillText(l, x, y + 50); y += 74; });
    y += 14;
    ctx.fillStyle = K.ink; ctx.font = '700 60px ' + DISP;
    var ans = (K.suffix ? '→ ' : '') + (card.to || '') + K.suffix;
    lines(ctx, ans, w, 3).forEach(function (l) { ctx.fillText(l, x, y + 56); y += 80; });
    y += 20;
    ctx.fillStyle = '#3D3830'; ctx.font = '400 36px ' + BODY;
    lines(ctx, card.phrase, w, 4).forEach(function (l) { ctx.fillText(l, x, y + 34); y += 60; });
    // 紙の下：名義
    var by = py + ph - 70;
    ctx.fillStyle = K.color; ctx.beginPath(); ctx.arc(x + 48, by, 48, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#FFFFFF'; ctx.font = '700 32px ' + DISP; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(String(o.name || 'coo').slice(0, 3), x + 48, by + 2);
    ctx.textAlign = 'left';
    ctx.fillStyle = '#2E2A26'; ctx.font = '700 32px ' + BODY; ctx.fillText('二級建築士 ' + (o.name || 'coo'), x + 120, o.handle ? by - 20 : by);
    if (o.handle) { ctx.fillStyle = '#6B645B'; ctx.font = '400 28px ' + BODY; ctx.fillText(o.handle, x + 120, by + 24); }
    // 下：HPへの案内（画像の中に入れる）
    ctx.fillStyle = '#FFFFFF'; ctx.textAlign = 'center';
    ctx.font = '700 40px ' + BODY; ctx.fillText(card.type === 'rec' ? 'カレンダーはプロフィールのHPから' : 'くわしくはプロフィールのHPから', W / 2, H - 200);
    ctx.font = '400 30px ' + BODY; ctx.fillText('毎日ひとつ、設計者の知識をおすそわけ', W / 2, H - 140);
    ctx.textAlign = 'left';
    return canvas;
  }
  var api = { KINDS: KINDS, ORDER: ORDER, TITLE: TITLE, draw: draw, lines: lines, no3: no3 };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else global.HikiStory = api;
})(typeof window !== 'undefined' ? window : this);
