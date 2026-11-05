/* 手描きイラスト（ノートの写真）を整える：背景を白くして、描いた範囲を四角く切り出す（window.HikiIllust）
 * 線の形どおりの切り抜きはしない。残った余白は画面のつまみ（上下左右）で直す。
 *   whiten(px, strength)：px は RGBA の並び（ImageData.data）。紙の色を白に合わせ、明るい所を真っ白にする（その場で書き換え）
 *     strength 0〜100（既定50）。大きいほど薄い線まで白に飛ぶ
 *   autoBox(px, w, h)：白くした後の画像で、描いてある範囲 { x, y, w, h }（少し余白を付ける）。何も無ければ全体
 */
(function (global) {
  'use strict';
  function lum(r, g, b) { return 0.299 * r + 0.587 * g + 0.114 * b; }
  // 各色の明るい方から5%の値を「紙の色」とみなす（影や照明の色かぶりを打ち消す）
  function paper(px) {
    var hist = [new Uint32Array(256), new Uint32Array(256), new Uint32Array(256)], n = 0;
    for (var i = 0; i < px.length; i += 16) { hist[0][px[i]]++; hist[1][px[i + 1]]++; hist[2][px[i + 2]]++; n++; }
    return hist.map(function (h) {
      var need = n * 0.05, acc = 0;
      for (var v = 255; v > 0; v--) { acc += h[v]; if (acc >= need) return Math.max(v, 60); }
      return 255;
    });
  }
  function whiten(px, strength) {
    var s = strength == null ? 50 : Math.max(0, Math.min(100, strength));
    var wp = paper(px), cut = 235 - s * 0.7;   // この明るさより上は白（50 → 200）
    for (var i = 0; i < px.length; i += 4) {
      var r = Math.min(255, px[i] * 255 / wp[0]), g = Math.min(255, px[i + 1] * 255 / wp[1]), b = Math.min(255, px[i + 2] * 255 / wp[2]);
      var l = lum(r, g, b);
      if (l >= cut) { r = g = b = 255; }
      else {   // 線は少し濃くして、紙に近い色ほど白へ寄せる
        var t = Math.pow(l / cut, 1.6), k = 0.85;
        r = r * k * (1 - t) + 255 * t; g = g * k * (1 - t) + 255 * t; b = b * k * (1 - t) + 255 * t;
      }
      px[i] = r; px[i + 1] = g; px[i + 2] = b; px[i + 3] = 255;
    }
    return px;
  }
  function autoBox(px, w, h) {
    var x0 = w, y0 = h, x1 = -1, y1 = -1, step = Math.max(1, Math.round(Math.max(w, h) / 800));
    for (var y = 0; y < h; y += step) {
      for (var x = 0; x < w; x += step) {
        var i = (y * w + x) * 4;
        if (lum(px[i], px[i + 1], px[i + 2]) < 200) {
          if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
        }
      }
    }
    if (x1 < 0) return { x: 0, y: 0, w: w, h: h };
    var m = Math.round(Math.max(x1 - x0, y1 - y0) * 0.06) + step;
    x0 = Math.max(0, x0 - m); y0 = Math.max(0, y0 - m); x1 = Math.min(w - 1, x1 + m); y1 = Math.min(h - 1, y1 + m);
    return { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
  }
  var api = { whiten: whiten, autoBox: autoBox, paper: paper };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else global.HikiIllust = api;
})(typeof window !== 'undefined' ? window : this);
