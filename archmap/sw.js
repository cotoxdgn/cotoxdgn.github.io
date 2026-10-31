/* このアプリをオフラインでも開けるようにする仕組み（公開版 public/ は対象外：常に最新の public.json を読む）。CACHE の名前はアプリごとに変え、更新のたびに番号を上げる */
var CACHE = 'archmap-v7';
var SHELL = ['./', 'index.html', 'app.js', 'app.css', 'common.js', 'common.css', 'manifest.webmanifest', 'icons/icon-192.png', 'icons/apple-touch-icon.png',
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
  var u = new URL(req.url);
  if (req.method !== 'GET' || u.origin !== self.location.origin || u.pathname.indexOf('/archmap/public/') !== -1) return;
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
