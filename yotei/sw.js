/* このアプリをオフラインでも開けるようにする仕組み。CACHE の名前はアプリごとに変え、更新のたびに番号を上げる
 * 相手用ページ（a/）は保存しない（ネットにつながっている時だけ使う） */
var CACHE = 'yotei-v1';
var SHELL = ['./', 'index.html', 'app.js', 'app.css', 'grid.js', 'endpoint.js', 'manifest.webmanifest', 'icons/icon-192.png', 'icons/apple-touch-icon.png',
  '../shared/apps.js', '../shared/apps.css'];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(SHELL); }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener('activate', function (e) {
  var prefix = CACHE.replace(/-v\d+$/, '-');
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k.indexOf(prefix) === 0 && k !== CACHE; })
      .map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

// 自分のサイトの GET だけ扱う（スプシ・画像の通信には触れない）。新しい版を優先し、つながらない時だけ保存済みを使う
self.addEventListener('fetch', function (e) {
  var req = e.request;
  var url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== self.location.origin) return;
  if (url.pathname.indexOf('/yotei/a/') >= 0) return;   // 相手用ページはブラウザに任せる
  e.respondWith(fetch(req.url, { cache: 'no-cache', credentials: 'same-origin' }).then(function (res) {  // ブラウザの一時保存より新しい版を優先
    if (res && res.ok) {
      var copy = res.clone();
      caches.open(CACHE).then(function (c) { c.put(req, copy); });
    }
    return res;
  }).catch(function () {
    return caches.match(req, { ignoreSearch: true }).then(function (hit) {
      return hit || (req.mode === 'navigate' ? caches.match('index.html') : Response.error());
    });
  }));
});
