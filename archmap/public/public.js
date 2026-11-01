/* アーキマップ 公開版（見るだけ）。同じフォルダの public.json だけを読む（スプシには触れない） */
(function () {
  'use strict';

  // ▼ HP の導線。URL が決まったらここを書き換える（空のままならボタンは出ない）
  var LINKS = {
    works: '',    // cotoの作品ページ
    consult: ''   // 相談ページ
  };
  var DATA_URL = 'public.json';

  var A = window.ArchMap;
  var $ = function (id) { return document.getElementById(id); };
  var map = A.makeMap($('map'), { scrollZoom: false });
  var items = [], cur = null;

  if (LINKS.works) { $('ctaWorks').href = LINKS.works; $('ctaWorks').hidden = false; }
  if (LINKS.consult) { $('ctaConsult').href = LINKS.consult; $('ctaConsult').hidden = false; }

  function safeUrl(u) { return /^https:\/\//.test(String(u || '')) ? String(u) : ''; }

  function render() {
    var ol = $('list');
    ol.innerHTML = '';
    if (!items.length) {
      ol.innerHTML = '<li class="empty">まだ公開している建築はありません。</li>';
    }
    items.forEach(function (x, i) {
      var li = document.createElement('li');
      li.className = 'item ' + A.listClass(x.list) + (x.id === cur ? ' on' : '');
      li.tabIndex = 0;
      li.dataset.id = x.id;
      var pic = safeUrl(x.photo);
      var det = (x.details || []).map(function (d) {
        return '<li>' + (d.part ? '<b>' + A.esc(d.part) + '</b>' : '') +
          (d.spec ? '<span class="spec">' + A.esc(d.spec) + '</span>' : '') +
          (d.note ? '<div>' + A.esc(d.note) + '</div>' : '') + '</li>';
      }).join('');
      li.innerHTML =
        '<span class="n' + (x._loc ? '' : ' none') + '">' + (x._loc ? A.pad2(x._n) : '—') + '</span>' +
        '<div><h2><span>' + A.esc(x.name) + '</span></h2>' +
        (x.one ? '<p class="one">' + A.esc(x.one) + '</p>' : '') +
        (det ? '<ul class="det" aria-label="ディテールのメモ">' + det + '</ul>' : '') +
        (pic ? '<img class="pic" loading="lazy" alt="' + A.esc(x.name) + 'の写真" src="' + A.esc(pic) + '">' : '') +
        '</div>';
      li.onclick = function () { select(x.id, true); };
      li.onkeydown = function (e) { if (e.key === 'Enter') select(x.id, true); };
      ol.appendChild(li);
    });
    if (map) {
      map.setPins(items.filter(function (x) { return x._loc; }).map(function (x) {
        return { lat: x.lat, lng: x.lng, label: A.pad2(x._n), on: x.id === cur, list: x.list, title: x.name,
          onClick: function () { select(x.id, false); } };
      }));
    }
    postHeight();
  }
  function select(id, pan) {
    cur = id;
    render();
    var x = items.filter(function (y) { return y.id === id; })[0];
    if (pan && map && x && x._loc) map.setView([x.lat, x.lng], Math.max(map.getZoom(), 15));
    if (!pan) {
      var li = document.querySelector('.item[data-id="' + CSS.escape(id) + '"]');
      if (li) li.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }
  function fit() {
    if (!map) return;
    var pts = items.filter(function (x) { return x._loc; }).map(function (x) { return [x.lat, x.lng]; });
    if (pts.length === 1) map.setView(pts[0], 15);
    else if (pts.length > 1) map.fitBounds(pts, 16);
  }
  // HP に iframe で埋め込んだとき、親ページが高さを合わせられるように知らせる
  function postHeight() {
    if (window.parent === window) return;
    try { window.parent.postMessage({ type: 'archmap-height', height: document.documentElement.scrollHeight }, '*'); } catch (e) { /* 無視 */ }
  }
  window.addEventListener('resize', postHeight);

  fetch(DATA_URL, { cache: 'no-cache' }).then(function (r) {
    if (!r.ok) throw new Error(r.status);
    return r.json();
  }).then(function (data) {
    var n = 0;
    items = (data && data.items || []).filter(function (x) { return x && x.name; }).map(function (x) {
      x._loc = A.hasLoc(x);
      if (x._loc) x._n = ++n;
      return x;
    });
    var when = data && data.generatedAt ? new Date(data.generatedAt) : null;
    $('legend').innerHTML = '<span>掲載 ' + items.length + '件</span>' +
      (when && !isNaN(when) ? '<span>更新 ' + when.getFullYear() + '.' + A.pad2(when.getMonth() + 1) + '.' + A.pad2(when.getDate()) + '</span>' : '');
    render();
    fit();
  }).catch(function () {
    items = [];
    render();
  });
})();
