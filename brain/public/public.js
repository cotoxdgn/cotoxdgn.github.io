/* 実績の公開ページ（見るだけ）。データは source.js の WorksSource.load() からだけ受け取る（スプシには触れない）
 *   ?w=<公開番号> … その実績のページ ／ 番号なし … 公開中の実績の一覧
 *   ?preview=1 … 脳みその「公開ページの見え方」用。読み込まずに、枠の外から WorksPublic.preview(data, w) で渡される
 */
(function () {
  'use strict';

  // ▼ HP の導線。URL が決まったらここを書き換える（空のままならボタンは出ない）
  var LINKS = {
    consult: ''   // 相談ページ
  };

  var KC = { D: '#4D5A5C', T: '#9A6C78', M: '#A3812F', L: '#3F6F86', S: '#5E7C55', B: '#3E6B5A', H: '#B0602A', O: '#7A7570' };
  var $ = function (id) { return document.getElementById(id); };
  var P = new URLSearchParams(location.search);
  var preview = P.get('preview') === '1';

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function safeUrl(u) { return /^https:\/\//.test(String(u || '')) ? String(u) : ''; }
  function ym(s) { var m = /^(\d{4})-(\d{2})$/.exec(String(s || '')); return m ? m[1] + '年' + (+m[2]) + '月' : ''; }
  function small(u) { return u.replace(/([?&]sz=w)\d+/, '$1800'); }
  function photos(x) { return (Array.isArray(x.photos) ? x.photos : []).filter(function (p) { return p && safeUrl(p.url); }); }
  function ph(p, alt, big) {
    var u = safeUrl(p.url);
    return '<span class="ph">' + (u ? '<img src="' + esc(big ? u : small(u)) + '" alt="' + esc(alt || '') + '" loading="lazy">' : '') +
      (p.ba === 'before' || p.ba === 'after' ? '<span class="ba ' + p.ba + '">' + (p.ba === 'after' ? 'アフター' : 'ビフォー') + '</span>' : '') + '</span>';
  }
  function link(w) { return preview ? '#' : '?w=' + encodeURIComponent(w); }
  function card(x) {
    var c = photos(x)[0];
    return '<a class="pp-card" href="' + esc(link(x.w)) + '">' + (c ? ph({ url: c.url }, '') : '<span class="ph"></span>') +
      '<b>' + esc(x.title) + '</b><small>' + esc([x.city, ym(x.period)].filter(Boolean).join(' ・ ')) + '</small></a>';
  }
  function top() { return '<div class="pp-top"><a href="' + (preview ? '#' : './') + '" class="brand">' + esc(BRAND) + '</a><span>WORKS</span></div>'; }
  function cta(more) {
    return '<div class="pp-cta"><p>住まいの設計・リノベーションのご相談を受け付けています。</p><div class="btns">' +
      (LINKS.consult ? '<a class="p" href="' + esc(LINKS.consult) + '" target="_top">相談する</a>' : '') +
      (more ? '<a href="' + (preview ? '#' : './') + '">ほかの実績を見る</a>' : '') + '</div></div>';
  }
  var BRAND = 'coto';

  function workHtml(x, all) {
    var pub = photos(x), cover = pub[0];
    var bef = pub.filter(function (p) { return p.ba === 'before'; });
    var aft = pub.filter(function (p) { return p.ba === 'after'; });
    // ビフォーとアフターは並んだ順に組にする（表紙も組に入れてよい）
    var pairs = bef.slice(0, aft.length).map(function (b, i) { return [b, aft[i]]; });
    var paired = [].concat.apply([], pairs);
    var rest = pub.filter(function (p) { return p !== cover && paired.indexOf(p) < 0; });
    var meta = [['時期', ym(x.period) ? ym(x.period) + ' 完成' : ''], ['場所', x.city], ['広さ', x.area ? x.area + '㎡' : ''], ['住む人', x.user]].filter(function (m) { return m[1]; });
    var know = Array.isArray(x.know) ? x.know : [];
    var h = top();
    h += '<article class="pp-work"><div class="pp-hero">' + (cover ? ph(cover, x.title + 'の写真', true) : '') +
      '<div><div class="kicker">RENOVATION</div><h1>' + esc(x.title) + '</h1>' +
      (meta.length ? '<dl class="pp-meta">' + meta.map(function (m) { return '<div><dt>' + m[0] + '</dt><dd>' + esc(m[1]) + '</dd></div>'; }).join('') + '</dl>' : '') + '</div></div>';
    if (x.wish || x.point) {
      h += '<div class="pp-two">' + (x.wish ? '<section><h2>ご要望</h2><p>' + esc(x.wish) + '</p></section>' : '') +
        (x.point ? '<section><h2>こだわり・工夫</h2><p>' + esc(x.point) + '</p></section>' : '') + '</div>';
    }
    if (pairs.length) h += '<section><h2>ビフォー・アフター</h2><div class="pairs">' + pairs.map(function (p) { return '<figure class="pair">' + ph(p[0], 'ビフォー') + ph(p[1], 'アフター') + '</figure>'; }).join('') + '</div></section>';
    if (rest.length) h += '<section><h2>写真</h2><div class="pp-gal">' + rest.map(function (p) { return ph(p, ''); }).join('') + '</div></section>';
    if (know.length) {
      h += '<section><h2>この住まいで使った知識</h2><div class="pp-know">' + know.map(function (k) {
        return '<span style="--kc:' + (KC[k.kind] || '#6F6A8A') + '"><i>' + esc(k.kindName || '') + '</i>' + esc(k.title) + '</span>';
      }).join('') + '</div></section>';
    }
    h += '</article>';
    var others = all.filter(function (o) { return o !== x; });
    h += cta(true);
    if (others.length) h += '<section class="pp-others"><h2>ほかの実績</h2><div class="pp-grid">' + others.slice(0, 6).map(card).join('') + '</div></section>';
    return h;
  }
  function listHtml(all) {
    var h = top() + '<header class="pp-intro"><div class="kicker">WORKS</div><h1>住まいのリノベーション実績</h1>' +
      '<p>建築士の' + esc(BRAND) + 'が手がけた住まいです。写真をタップすると、ご要望と工夫したところが見られます。</p></header>';
    h += all.length ? '<div class="pp-grid">' + all.map(card).join('') + '</div>' : '<p class="pp-empty">まだ公開している実績はありません。</p>';
    return h + cta(false);
  }
  function show(data, w) {
    BRAND = data && typeof data.brand === 'string' && data.brand ? data.brand : 'coto';
    var all = (data && Array.isArray(data.items) ? data.items : []).filter(function (x) { return x && x.w && x.title; });
    var x = w ? all.filter(function (y) { return y.w === w; })[0] : null;
    var root = $('pp');
    if (w && !x) {
      root.innerHTML = top() + '<p class="pp-empty">この実績は公開を終えたか、リンクが違うようです。</p>' + (all.length ? '<div class="pp-grid">' + all.map(card).join('') + '</div>' : '') + cta(false);
      document.title = '実績｜' + BRAND;
    } else if (x) {
      root.innerHTML = workHtml(x, all);
      document.title = x.title + '｜' + BRAND;
    } else {
      root.innerHTML = listHtml(all);
      document.title = '実績｜' + BRAND;
    }
    root.removeAttribute('aria-busy');
    root.dataset.shown = x ? 'work' : 'list';
    postHeight();
  }
  // HP に iframe で埋め込んだとき、親ページが高さを合わせられるように知らせる
  function postHeight() {
    if (window.parent === window || preview) return;
    try { window.parent.postMessage({ type: 'works-height', height: document.documentElement.scrollHeight }, '*'); } catch (e) { /* 無視 */ }
  }
  window.addEventListener('resize', postHeight);

  window.WorksPublic = { preview: function (data, w) { if (preview) { show(data, w); window.scrollTo(0, 0); } } };
  if (preview) {
    // 見え方の確認ではリンクで移動しない
    document.addEventListener('click', function (e) { var a = e.target.closest('a'); if (a && a.getAttribute('href') === '#') e.preventDefault(); });
    return;
  }
  window.WorksSource.load().then(function (data) { show(data, P.get('w') || ''); }, function () {
    $('pp').innerHTML = top() + '<p class="pp-empty">読み込めませんでした。時間をおいてもう一度開いてください。</p>';
    $('pp').removeAttribute('aria-busy');
  });
})();
