/* おしゃれ建築map：記録用アプリと公開版で共通の部品 */
(function (global) {
  'use strict';

  // カテゴリ別リスト（モック承認済みの4つ）
  var LISTS = [
    { k: 'public', l: '美術館・公共' },
    { k: 'house', l: '住宅' },
    { k: 'shop', l: 'カフェ・店舗' },
    { k: 'want', l: '行きたい' }
  ];
  var CENTER = [34.6937, 135.5023]; // 地図の初期位置（大阪）

  function listLabel(k) {
    for (var i = 0; i < LISTS.length; i++) if (LISTS[i].k === k) return LISTS[i].l;
    return '';
  }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function pad2(n) { return n < 10 ? '0' + n : String(n); }
  function hasLoc(d) { return d && typeof d.lat === 'number' && typeof d.lng === 'number' && isFinite(d.lat) && isFinite(d.lng); }

  // 「34.69, 135.50」やGoogleマップのURL（@34.69,135.50 / ?q=34.69,135.50 / !3d34.69!4d135.50）から緯度経度を取り出す
  function parseLatLng(text) {
    var s = String(text || '');
    var m = /!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/.exec(s) || /@(-?\d+(?:\.\d+)?),\s*(-?\d+(?:\.\d+)?)/.exec(s) ||
      /(-?\d{1,2}(?:\.\d+)?)\s*[,，、\s]\s*(-?\d{1,3}(?:\.\d+)?)/.exec(s);
    if (!m) return null;
    var lat = parseFloat(m[1]), lng = parseFloat(m[2]);
    if (!(lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180)) return null;
    return { lat: Math.round(lat * 1e6) / 1e6, lng: Math.round(lng * 1e6) / 1e6 };
  }

  // 記録（Apps のレコード配列）から公開データを作る。公開オンの記録だけ、公開してよい項目だけを入れる
  function buildPublic(records, imageUrl) {
    var items = records.filter(function (r) { return r && !r.deleted && r.data && r.data.isPublic && r.data.name; })
      .sort(function (a, b) { return String(a.createdAt).localeCompare(String(b.createdAt)); })
      .map(function (r) {
        var d = r.data;
        var photo = (d.photos || []).filter(function (p) { return p.pub; })[0];
        var item = {
          id: r.id,
          name: d.name,
          list: d.list || '',
          one: d.one || '',
          details: (d.details || []).filter(function (x) { return x.pub && (x.part || x.spec || x.note); })
            .map(function (x) { return { part: x.part || '', spec: x.spec || '', note: x.note || '' }; })
        };
        if (hasLoc(d)) { item.lat = d.lat; item.lng = d.lng; }
        if (photo) item.photo = imageUrl ? imageUrl(photo.id, 1200) : photo.id;
        return item;
      });
    return { version: 1, generatedAt: new Date().toISOString(), items: items };
  }

  // Leaflet の地図を作る（OpenStreetMap タイル＋帰属表示）。Leaflet が読めなければ null
  function makeMap(el, opts) {
    if (!global.L) {
      el.classList.add('map-off');
      el.innerHTML = '<p>地図を読み込めませんでした（オフラインの可能性）。つながると表示されます。</p>';
      return null;
    }
    var map = L.map(el, Object.assign({ zoomControl: true, attributionControl: true }, opts || {}))
      .setView(CENTER, 12);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors'
    }).addTo(map);
    map.attributionControl.setPrefix('<a href="https://leafletjs.com" target="_blank" rel="noopener">Leaflet</a>');
    return map;
  }
  function pinIcon(label, on) {
    return L.divIcon({
      className: 'am-pin-wrap',
      html: '<span class="am-pin' + (on ? ' on' : '') + '"><b>' + esc(label) + '</b></span>',
      iconSize: [28, 28], iconAnchor: [14, 28]
    });
  }

  global.ArchMap = {
    LISTS: LISTS, CENTER: CENTER, listLabel: listLabel, esc: esc, pad2: pad2, hasLoc: hasLoc,
    parseLatLng: parseLatLng, buildPublic: buildPublic, makeMap: makeMap, pinIcon: pinIcon
  };
})(typeof window !== 'undefined' ? window : globalThis);
