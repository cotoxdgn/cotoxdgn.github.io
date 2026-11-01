/* ホーム（アプリ一覧）をオフラインでも開けるようにする仕組み
 * 各アプリのページは、それぞれのフォルダの sw.js が担当する（こちらは触らない）。 */
var CACHE = 'home-v3';
var SHELL = ['./', 'index.html', 'manifest.webmanifest', 'shared/apps.js', 'shared/apps.css',
  'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png'];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(CACHE).then(function (c) { return c.addAll(SHELL); }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k.indexOf('home-') === 0 && k !== CACHE; })
      .map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

// 自分のサイトの GET だけ扱う（スプシとの通信には触れない）。新しい版を優先し、つながらない時だけ保存済みを使う
self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
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
