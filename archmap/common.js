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

  // カテゴリの色を付けるクラス（c-public など）。知らないカテゴリは空
  function listClass(k) { return listLabel(k) ? 'c-' + k : ''; }

  // ---------- 地図（MapLibre GL ＋ OpenFreeMap のベクタータイル） ----------
  // 陸・道・建物はグレー、水辺（海・川・池・湖）だけ水色。ラベルは控えめなグレー
  var TILES = 'https://tiles.openfreemap.org/planet';
  var GLYPHS = 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf';
  var ATTR = '<a href="https://openfreemap.org" target="_blank" rel="noopener">OpenFreeMap</a> ' +
    '<a href="https://www.openmaptiles.org/" target="_blank" rel="noopener">&copy; OpenMapTiles</a> ' +
    '<a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">&copy; OpenStreetMap contributors</a>';
  var PALETTE = {
    light: { bg: '#F3F3F1', land: '#ECECE9', park: '#E7E8E5', bldg: '#E1E1DE', bldgLine: '#D5D5D1',
      casing: '#DADAD6', road: '#FFFFFF', minor: '#FAFAF9', path: '#E2E2DE', rail: '#CDCDC9',
      water: '#9FD3E6', waterLine: '#7CC4DC', wood: '#C3DDB8', grass: '#D5E8CC', label: '#8C8D90', waterLabel: '#5FA6C0', halo: '#F7F7F5' },
    dark: { bg: '#1E1F22', land: '#232427', park: '#25272A', bldg: '#2C2D31', bldgLine: '#333539',
      casing: '#2A2B2F', road: '#3A3C41', minor: '#34363A', path: '#2E3034', rail: '#3A3C40',
      water: '#3C7F98', waterLine: '#4A93AD', wood: '#2E4632', grass: '#2A3D2D', label: '#8E9196', waterLabel: '#7FB9CE', halo: '#1E1F22' }
  };
  function isDark() {
    var t = document.documentElement.getAttribute('data-theme');
    if (t) return t === 'dark';
    // 公開版は明るい配色だけで作っているので、地図も明るいまま
    if (document.documentElement.classList.contains('light-only')) return false;
    return !!(global.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches);
  }
  var NAME = ['coalesce', ['get', 'name:ja'], ['get', 'name']];
  function mapStyle(dark) {
    var c = PALETTE[dark ? 'dark' : 'light'];
    var w = function (pairs) { return ['interpolate', ['exponential', 1.4], ['zoom']].concat(pairs); };
    var roadClass = function (list) { return ['match', ['get', 'class'], list, true, false]; };
    var MAJOR = ['motorway', 'trunk', 'primary', 'secondary', 'tertiary'];
    var MINOR = ['minor', 'service', 'street', 'residential'];
    return {
      version: 8,
      glyphs: GLYPHS,
      sources: { omt: { type: 'vector', url: TILES } },
      layers: [
        { id: 'bg', type: 'background', paint: { 'background-color': c.bg } },
        { id: 'landuse', type: 'fill', source: 'omt', 'source-layer': 'landuse', paint: { 'fill-color': c.land } },
        // 緑（山・森・草地・公園）だけ緑にする。それ以外の土地はグレーのまま
        { id: 'landcover', type: 'fill', source: 'omt', 'source-layer': 'landcover',
          paint: { 'fill-color': ['match', ['get', 'class'], 'wood', c.wood, 'grass', c.grass, c.park] } },
        { id: 'park', type: 'fill', source: 'omt', 'source-layer': 'park', paint: { 'fill-color': c.grass } },
        { id: 'water', type: 'fill', source: 'omt', 'source-layer': 'water', paint: { 'fill-color': c.water, 'fill-antialias': true } },
        { id: 'waterway', type: 'line', source: 'omt', 'source-layer': 'waterway',
          layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: { 'line-color': c.waterLine, 'line-width': w([8, 0.6, 12, 1.2, 16, 4, 20, 10]) } },
        { id: 'building', type: 'fill', source: 'omt', 'source-layer': 'building', minzoom: 13,
          paint: { 'fill-color': c.bldg, 'fill-outline-color': c.bldgLine } },
        { id: 'path', type: 'line', source: 'omt', 'source-layer': 'transportation', minzoom: 14,
          filter: roadClass(['path', 'track']),
          paint: { 'line-color': c.path, 'line-width': w([14, 0.6, 18, 2]), 'line-dasharray': [2, 1.5] } },
        { id: 'rail', type: 'line', source: 'omt', 'source-layer': 'transportation', minzoom: 11,
          filter: roadClass(['rail', 'transit']),
          paint: { 'line-color': c.rail, 'line-width': w([11, 0.6, 16, 1.6, 20, 3]) } },
        { id: 'road-casing', type: 'line', source: 'omt', 'source-layer': 'transportation', minzoom: 10,
          filter: roadClass(MAJOR), layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: { 'line-color': c.casing, 'line-width': w([10, 1.5, 14, 6, 18, 24, 20, 40]) } },
        { id: 'road-minor', type: 'line', source: 'omt', 'source-layer': 'transportation', minzoom: 12,
          filter: roadClass(MINOR), layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: { 'line-color': c.minor, 'line-width': w([12, 0.6, 15, 3, 18, 12, 20, 24]) } },
        { id: 'road', type: 'line', source: 'omt', 'source-layer': 'transportation', minzoom: 6,
          filter: roadClass(MAJOR), layout: { 'line-cap': 'round', 'line-join': 'round' },
          paint: { 'line-color': c.road, 'line-width': w([6, 0.5, 10, 1, 14, 4.5, 18, 20, 20, 34]) } },
        { id: 'water-name', type: 'symbol', source: 'omt', 'source-layer': 'water_name',
          layout: { 'text-field': NAME, 'text-font': ['Noto Sans Regular'], 'text-size': 11, 'text-max-width': 6 },
          paint: { 'text-color': c.waterLabel, 'text-halo-color': c.halo, 'text-halo-width': 1.2 } },
        { id: 'road-name', type: 'symbol', source: 'omt', 'source-layer': 'transportation_name', minzoom: 14,
          layout: { 'text-field': NAME, 'text-font': ['Noto Sans Regular'], 'text-size': 10, 'symbol-placement': 'line' },
          paint: { 'text-color': c.label, 'text-halo-color': c.halo, 'text-halo-width': 1.2 } },
        { id: 'place', type: 'symbol', source: 'omt', 'source-layer': 'place',
          filter: ['match', ['get', 'class'], ['city', 'town', 'village', 'suburb', 'quarter', 'neighbourhood'], true, false],
          layout: { 'text-field': NAME, 'text-font': ['Noto Sans Regular'], 'text-max-width': 7,
            'text-size': ['match', ['get', 'class'], 'city', 14, 'town', 13, 12] },
          paint: { 'text-color': c.label, 'text-halo-color': c.halo, 'text-halo-width': 1.4 } }
      ]
    };
  }

  // 地図を作る。MapLibre が読めない・WebGL が使えないときは案内を出して null
  // 戻り値は、記録用と公開版で使う操作だけをまとめたもの
  function makeMap(el, opts) {
    opts = opts || {};
    var map;
    try {
      if (!global.maplibregl) throw new Error('no maplibre');
      map = new maplibregl.Map({
        container: el, style: mapStyle(isDark()), center: [CENTER[1], CENTER[0]], zoom: 12, maxZoom: 19,
        attributionControl: false, scrollZoom: opts.scrollZoom !== false, dragRotate: false, pitchWithRotate: false,
        touchPitch: false
      });
    } catch (e) {
      el.classList.add('map-off');
      el.innerHTML = '<p>地図を読み込めませんでした（オフラインの可能性）。つながると表示されます。</p>';
      return null;
    }
    map.touchZoomRotate.disableRotation();
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-left');
    map.addControl(new maplibregl.AttributionControl({ compact: false, customAttribution: ATTR }), 'bottom-right');

    var pins = [], pick = null;
    function pinEl(label, on, list, title, onClick) {
      var wrap = document.createElement('div');
      wrap.className = 'am-pin-wrap';
      wrap.innerHTML = '<span class="am-pin ' + listClass(list) + (on ? ' on' : '') + '"><b>' + esc(label) + '</b></span>';
      if (title) { wrap.title = title; wrap.setAttribute('aria-label', title); }
      if (onClick) {
        wrap.tabIndex = 0;
        wrap.setAttribute('role', 'button');
        wrap.addEventListener('click', function (e) { e.stopPropagation(); onClick(); });
        wrap.addEventListener('keydown', function (e) { if (e.key === 'Enter') onClick(); });
      }
      return wrap;
    }
    return {
      map: map,
      setView: function (ll, z) { map.jumpTo({ center: [ll[1], ll[0]], zoom: z == null ? map.getZoom() : z }); },
      fitBounds: function (pts, maxZoom) {
        var b = new maplibregl.LngLatBounds();
        pts.forEach(function (p) { b.extend([p[1], p[0]]); });
        map.fitBounds(b, { padding: 40, maxZoom: maxZoom || 16, animate: false });
      },
      getCenter: function () { var c = map.getCenter(); return [c.lat, c.lng]; },
      getZoom: function () { return map.getZoom(); },
      onClick: function (fn) { map.on('click', function (e) { fn(e.lngLat.lat, e.lngLat.lng); }); },
      resize: function () { map.resize(); },
      // pins = [{ lat, lng, label, on, list, title, onClick }]
      setPins: function (list) {
        pins.forEach(function (m) { m.remove(); });
        pins = list.map(function (p) {
          return new maplibregl.Marker({ element: pinEl(p.label, p.on, p.list, p.title, p.onClick), anchor: 'bottom' })
            .setLngLat([p.lng, p.lat]).addTo(map);
        });
      },
      // 場所決め用のピン（ドラッグで動かせる）。lat が null なら消す
      setPick: function (lat, lng, onDrag) {
        if (lat == null) { if (pick) { pick.remove(); pick = null; } return; }
        if (!pick) {
          pick = new maplibregl.Marker({ element: pinEl('●', true, '', '場所（ドラッグで移動）'), anchor: 'bottom', draggable: true });
          pick.on('dragend', function () { var p = pick.getLngLat(); if (onDrag) onDrag(p.lat, p.lng); });
          pick.setLngLat([lng, lat]).addTo(map); // 位置を決めてから地図に載せる
        }
        pick.setLngLat([lng, lat]);
      }
    };
  }

  global.ArchMap = {
    LISTS: LISTS, CENTER: CENTER, listLabel: listLabel, esc: esc, pad2: pad2, hasLoc: hasLoc,
    parseLatLng: parseLatLng, buildPublic: buildPublic, makeMap: makeMap, mapStyle: mapStyle, listClass: listClass
  };
})(typeof window !== 'undefined' ? window : globalThis);
