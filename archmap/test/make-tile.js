// 試験用のベクタータイル（fixture-tile.pbf）を作る。OpenMapTiles と同じレイヤー名で、川・池・道・建物・地名を1枚に入れる
// 実行：NODE_PATH=<vt-pbf@3.1.3 と geojson-vt@3.2.1 を入れた node_modules> node archmap/test/make-tile.js
'use strict';
const fs = require('fs');
const path = require('path');
const geojsonvt = require('geojson-vt');
const vtpbf = require('vt-pbf');

// タイル内の位置（0〜1）を z0 の経緯度に直す
const ll = (x, y) => {
  const lng = x * 360 - 180;
  const n = Math.PI - 2 * Math.PI * y;
  return [lng, 180 / Math.PI * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)))];
};
const poly = pts => ({ type: 'Polygon', coordinates: [pts.concat([pts[0]]).map(p => ll(p[0], p[1]))] });
const line = pts => ({ type: 'LineString', coordinates: pts.map(p => ll(p[0], p[1])) });
const f = (geometry, properties) => ({ type: 'Feature', geometry, properties });

const layers = {
  water: [
    f(poly([[0, 0.55], [1, 0.48], [1, 0.62], [0, 0.69]]), { class: 'river' }),
    f(poly([[0.72, 0.12], [0.88, 0.1], [0.92, 0.26], [0.76, 0.3]]), { class: 'lake' })
  ],
  waterway: [f(line([[0.05, 0.02], [0.2, 0.25], [0.3, 0.55]]), { class: 'stream' })],
  park: [f(poly([[0.08, 0.75], [0.35, 0.75], [0.35, 0.95], [0.08, 0.95]]), { class: 'park' })],
  building: [[0.45, 0.1], [0.55, 0.1], [0.45, 0.25], [0.55, 0.25], [0.45, 0.78], [0.6, 0.78], [0.75, 0.85]]
    .map(([x, y]) => f(poly([[x, y], [x + 0.07, y], [x + 0.07, y + 0.08], [x, y + 0.08]]), {})),
  transportation: [
    f(line([[0, 0.4], [1, 0.36]]), { class: 'primary' }),
    f(line([[0.4, 0], [0.42, 1]]), { class: 'secondary' }),
    f(line([[0.62, 0], [0.64, 1]]), { class: 'minor' }),
    f(line([[0, 0.88], [1, 0.82]]), { class: 'rail' })
  ],
  place: [f({ type: 'Point', coordinates: ll(0.22, 0.3) }, { class: 'suburb', name: 'Test', 'name:ja': '試験町' })]
};
const tiles = {};
for (const [name, features] of Object.entries(layers)) {
  const idx = geojsonvt({ type: 'FeatureCollection', features }, { maxZoom: 0, indexMaxZoom: 0, buffer: 0 });
  tiles[name] = idx.getTile(0, 0, 0) || { features: [] };
}
fs.writeFileSync(path.join(__dirname, 'fixture-tile.pbf'), Buffer.from(vtpbf.fromGeojsonVt(tiles, { version: 2 })));
console.log('fixture-tile.pbf を作りました');
