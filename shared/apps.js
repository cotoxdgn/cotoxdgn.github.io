/*
 * cotoxdgn アプリ共通JS（Apps）
 * 各アプリの index.html で <script src="/shared/apps.js"></script> と読み込むと、window.Apps が使えます。
 * 使い方は API.md を参照。
 *
 * - 接続設定（接続URL＋合言葉）は localStorage に1つだけ保存し、同じサイトの全アプリで共有する
 *   （アプリ別の上書きも持てる：家族用スプシにつなぐ wanko など）
 * - データは端末内（IndexedDB）にも控えを持ち、オフライン中の変更は再送キューにためて、つながったら送る
 * - 画像は端末で縮小してから送る
 */
(function (global) {
  'use strict';

  var VERSION = '1';
  var CONN_KEY = 'apps.conn.v1';
  var HASH_RE = /#(?:.*&)?c=([A-Za-z0-9_-]+)/;
  var APP_RE = /^[a-z0-9][a-z0-9_-]{0,29}$/;

  // shared/ の場所（ライブラリの読み込みと connect ページの場所に使う）
  var SHARED_BASE = (function () {
    try {
      var s = global.document && (document.currentScript || Array.prototype.slice.call(document.scripts).filter(function (x) {
        return /\/apps\.js(\?|$)/.test(x.src);
      })[0]);
      if (s && s.src) return s.src.replace(/apps\.js(\?.*)?$/, '');
    } catch (e) { /* 取れなければ既定 */ }
    return '/shared/';
  })();
  var SITE_BASE = SHARED_BASE.replace(/shared\/$/, '');
  var CONNECT_PAGE = SITE_BASE + 'connect/';

  var ERRORS = {
    not_connected: 'この端末はまだつながっていません',
    bad_key: '合言葉が合いません。スプシのメニュー「アプリ設定」→「この端末をつなぐ」からつなぎ直してください',
    no_setup: 'スプシの準備が終わっていません（Apps Script で setup を実行）',
    offline: 'オフラインです。つながったら自動で送ります',
    network: '通信できませんでした。電波を確認してください',
    bad_response: 'スプシ側のプログラムから正しい返事がありません。Apps Script のデプロイで「アクセスできるユーザー：全員」になっているか、コードを貼り替えた後に「デプロイを管理→新バージョン」をしたかを確認してください',
    timeout: '時間がかかりすぎたので中断しました。もう一度試してください',
    busy: 'スプシが混み合っています。少し待ってもう一度試してください',
    too_long: '1件の内容が長すぎます（約45,000文字まで）',
    too_large: '画像が大きすぎます',
    bad_mime: 'この形式の画像は保存できません',
    bad_app: 'アプリ名が正しくありません',
    bad_id: 'IDが正しくありません',
    not_found: '見つかりませんでした',
    server: 'スプシ側でエラーが起きました',
    bad_request: '送信内容が読み取れませんでした',
    bad_image: '画像を読み込めませんでした'
  };

  function err(code, detail) {
    var e = new Error(code);
    e.code = code;
    if (detail) e.detail = detail;
    return e;
  }
  function errorText(e) {
    var code = e && (e.code || e.message);
    var t = ERRORS[code] || ERRORS.network;
    if ((code === 'server' || code === 'network') && e.detail) t += '（' + String(e.detail).slice(0, 120) + '）';
    return t;
  }

  // 接続URLの見分け用（末尾6文字。合言葉は出さない）
  function urlTail(u) { var m = /\/s\/([^\/]+)\/exec/.exec(String(u || '')); return m ? m[1].slice(-6) : '?'; }

  // ---------- 小物 ----------
  function nowIso() { return new Date().toISOString(); }
  function uuid() {
    if (global.crypto && crypto.randomUUID) return crypto.randomUUID();
    var s = '';
    for (var i = 0; i < 32; i++) s += Math.floor(Math.random() * 16).toString(16);
    return s.slice(0, 8) + '-' + s.slice(8, 12) + '-4' + s.slice(13, 16) + '-a' + s.slice(17, 20) + '-' + s.slice(20);
  }
  function b64urlEncode(str) {
    return btoa(unescape(encodeURIComponent(str))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function b64urlDecode(s) {
    s = s.replace(/-/g, '+').replace(/_/g, '/');
    while (s.length % 4) s += '=';
    return decodeURIComponent(escape(atob(s)));
  }
  function lsGet(k) {
    try { var v = global.localStorage.getItem(k); return v ? JSON.parse(v) : null; } catch (e) { return null; }
  }
  function lsSet(k, v) {
    try { global.localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; }
  }
  function online() { return !global.navigator || global.navigator.onLine !== false; }
  function isIOS() {
    var ua = (global.navigator && navigator.userAgent) || '';
    return /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  }
  function isStandalone() {
    try {
      return !!(global.navigator && navigator.standalone) || global.matchMedia('(display-mode: standalone)').matches;
    } catch (e) { return false; }
  }
  var scriptCache = {};
  function loadScript(src) {
    if (scriptCache[src]) return scriptCache[src];
    scriptCache[src] = new Promise(function (ok, ng) {
      var s = document.createElement('script');
      s.src = src;
      s.onload = function () { ok(); };
      s.onerror = function () { delete scriptCache[src]; ng(err('network')); };
      document.head.appendChild(s);
    });
    return scriptCache[src];
  }

  // ---------- 端末内の保存（IndexedDB、使えなければ localStorage） ----------
  var kv = (function () {
    var dbp = null;
    function db() {
      if (dbp) return dbp;
      dbp = new Promise(function (ok, ng) {
        if (!global.indexedDB) return ng(new Error('no idb'));
        var r = indexedDB.open('apps-shared', 1);
        r.onupgradeneeded = function () { r.result.createObjectStore('kv'); };
        r.onsuccess = function () { ok(r.result); };
        r.onerror = function () { ng(r.error); };
      }).catch(function () { return null; });
      return dbp;
    }
    function tx(mode, fn) {
      return db().then(function (d) {
        if (!d) { var r0 = fn(null); return r0 && 'result' in r0 ? r0.result : undefined; }
        return new Promise(function (ok, ng) {
          var t = d.transaction('kv', mode);
          var res = fn(t.objectStore('kv'));
          t.oncomplete = function () { ok(res && 'result' in res ? res.result : undefined); };
          t.onerror = function () { ng(t.error); };
          t.onabort = function () { ng(t.error || new Error('abort')); };
        });
      });
    }
    return {
      get: function (k) {
        return tx('readonly', function (s) { return s ? s.get(k) : { result: lsGet('apps.kv.' + k) }; })
          .then(function (v) { return v === undefined ? null : v; });
      },
      set: function (k, v) {
        return tx('readwrite', function (s) {
          if (s) return s.put(v, k);
          if (!lsSet('apps.kv.' + k, v)) throw err('storage_full');
          return null;
        });
      },
      del: function (k) {
        return tx('readwrite', function (s) {
          if (s) return s.delete(k);
          try { global.localStorage.removeItem('apps.kv.' + k); } catch (e) { /* 無視 */ }
          return null;
        });
      }
    };
  })();

  // ---------- 接続設定 ----------
  // 保存形式：{ def: {url,key,name,at}, per: { wanko: {url,key,name,at} } }
  function connAll() { return lsGet(CONN_KEY) || { def: null, per: {} }; }
  function getConnection(app) {
    var all = connAll();
    return (app && all.per && all.per[app]) || all.def || null;
  }
  function isConnected(app) { return !!getConnection(app); }

  // 接続リンク／QRの中身（…#c=xxxx）を読む
  function parseConnect(text) {
    var m = HASH_RE.exec(String(text || ''));
    if (!m) return null;
    try {
      var o = JSON.parse(b64urlDecode(m[1]));
      if (!o || typeof o.u !== 'string' || typeof o.k !== 'string' || !/^https:\/\//.test(o.u)) return null;
      if (o.a && !APP_RE.test(o.a)) return null;
      return { url: o.u, key: o.k, name: o.n ? String(o.n) : '', app: o.a || '' };
    } catch (e) { return null; }
  }
  function saveConnection(c) {
    var all = connAll();
    if (!all.per) all.per = {};
    var v = { url: c.url, key: c.key, name: c.name || '', at: nowIso() };
    if (c.app) all.per[c.app] = v; else all.def = v;
    if (!lsSet(CONN_KEY, all)) throw err('storage_full');
    emit('connection', { app: c.app || '' });
    return v;
  }
  // app を省くと全アプリ共通の接続を外す
  function disconnect(app) {
    var all = connAll();
    if (app) { if (all.per) delete all.per[app]; } else all.def = null;
    lsSet(CONN_KEY, all);
    emit('connection', { app: app || '' });
  }
  function connectLink(app) {
    var all = connAll();
    var own = app && all.per && all.per[app];
    var c = own || all.def;
    if (!c) return '';
    var p = { u: c.url, k: c.key, n: c.name || '' };
    if (own) p.a = app;
    return CONNECT_PAGE + '#c=' + b64urlEncode(JSON.stringify(p));
  }
  // ページの URL に #c=… が付いていたら保存して消す（どのアプリのページでも有効）
  function consumeHash() {
    if (!global.location) return null;
    var c = parseConnect(location.hash);
    if (!c) return null;
    saveConnection(c);
    try { history.replaceState(null, '', location.pathname + location.search); } catch (e) { location.hash = ''; }
    return c;
  }

  // ---------- 通信 ----------
  function call(app, action, params, opts) {
    opts = opts || {};
    var c = opts.connection || getConnection(app);
    if (!c) return Promise.reject(err('not_connected'));
    if (!online()) return Promise.reject(err('offline'));
    var body = { key: c.key, action: action };
    if (app) body.app = app;
    for (var k in params || {}) body[k] = params[k];
    var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timedOut = false;
    var timer = ctrl ? setTimeout(function () { timedOut = true; ctrl.abort(); }, opts.timeout || 30000) : null;
    return global.fetch(c.url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' }, // 単純リクエスト＝CORSの事前確認なし
      body: JSON.stringify(body),
      redirect: 'follow',
      signal: ctrl ? ctrl.signal : undefined
    }).then(function (res) { return res.text(); }, function () {
      var code = timedOut ? 'timeout' : (online() ? 'network' : 'offline');
      throw err(code, code === 'network' ? '接続先 …' + urlTail(c.url) : undefined);
    }).then(function (txt) {
      if (timer) clearTimeout(timer);
      var data;
      try { data = JSON.parse(txt); } catch (e) { throw err('bad_response', String(txt || '').slice(0, 200)); }
      if (!data.ok) throw err(data.error || 'server', data.detail);
      return data;
    }, function (e) {
      if (timer) clearTimeout(timer);
      throw e;
    });
  }

  // ---------- 出来事の通知 ----------
  var listeners = {};
  function on(type, fn) {
    (listeners[type] = listeners[type] || []).push(fn);
    return function () { listeners[type] = (listeners[type] || []).filter(function (f) { return f !== fn; }); };
  }
  function emit(type, detail) {
    (listeners[type] || []).slice().forEach(function (fn) { try { fn(detail); } catch (e) { /* 無視 */ } });
  }

  // ---------- 再送キュー ----------
  // 項目：{ qid, app, op: 'put'|'delete', id, data, createdAt, at }
  var qLock = Promise.resolve();
  function withQueue(fn) {
    var p = qLock.then(function () { return kv.get('queue'); }).then(function (q) {
      q = q || [];
      return Promise.resolve(fn(q)).then(function (res) {
        return kv.set('queue', q).then(function () { return res; });
      });
    });
    qLock = p.catch(function () {});
    return p;
  }
  function enqueue(item) {
    item.qid = uuid();
    item.at = nowIso();
    return withQueue(function (q) {
      // 同じレコードへの未送信の操作は、最後のものだけ残す（作成日時は最初のものを引き継ぐ）
      for (var i = q.length - 1; i >= 0; i--) {
        if (q[i].app === item.app && q[i].id === item.id) {
          if (!item.createdAt) item.createdAt = q[i].createdAt;
          q.splice(i, 1);
        }
      }
      q.push(item);
    }).then(function () { emit('queue', {}); scheduleFlush(); });
  }
  function pendingIds(app) {
    return kv.get('queue').then(function (q) {
      var s = {};
      (q || []).forEach(function (x) { if (!app || x.app === app) s[x.id] = true; });
      return s;
    });
  }
  function pendingCount(app) {
    return kv.get('queue').then(function (q) {
      return (q || []).filter(function (x) { return !app || x.app === app; }).length;
    });
  }

  var flushing = null;
  var flushTimer = null;
  function scheduleFlush() {
    if (flushTimer) clearTimeout(flushTimer);
    flushTimer = setTimeout(function () { flushTimer = null; flush().catch(function () {}); }, 300);
  }
  // たまった変更をスプシへ送る。成功・失敗にかかわらず、残った件数を返す
  function flush() {
    if (flushing) return flushing;
    flushing = doFlush().then(function (r) { flushing = null; return r; }, function (e) { flushing = null; throw e; });
    return flushing;
  }
  function doFlush() {
    return kv.get('queue').then(function (q) {
      q = (q || []).slice();
      if (!q.length) return { sent: 0, left: 0 };
      if (!online()) return { sent: 0, left: q.length, error: err('offline') };
      // 接続先（スプシ）ごとにまとめる
      var groups = {};
      q.forEach(function (x) {
        var c = getConnection(x.app);
        if (!c) return;
        var g = groups[c.url] || (groups[c.url] = { conn: c, items: [] });
        g.items.push(x);
      });
      var sent = 0, lastError = null;
      var chain = Promise.resolve();
      Object.keys(groups).forEach(function (u) {
        var g = groups[u];
        for (var i = 0; i < g.items.length; i += 100) {
          (function (items) {
            chain = chain.then(function () {
              if (lastError) return; // 1回失敗したら残りは次の機会に
              var ops = items.map(function (x) {
                var o = { op: x.op, app: x.app, id: x.id };
                if (x.op === 'put') { o.data = x.data; if (x.createdAt) o.createdAt = x.createdAt; }
                return o;
              });
              return call(null, 'batch', { ops: ops }, { connection: g.conn, timeout: 60000 }).then(function (res) {
                return afterBatch(items, res.results || []).then(function (n) { sent += n; });
              }, function (e) { lastError = e; emit('error', { error: e, during: 'flush' }); });
            });
          })(g.items.slice(i, i + 100));
        }
      });
      return chain.then(function () {
        return pendingCount().then(function (left) {
          emit('queue', {});
          return { sent: sent, left: left, error: lastError || undefined };
        });
      });
    });
  }
  function afterBatch(items, results) {
    var done = {}, failed = [];
    items.forEach(function (x, i) {
      var r = results[i];
      if (!r) return;
      done[x.qid] = r;
      if (!r.ok) failed.push({ item: x, error: err(r.error) });
    });
    var stillPending;
    return withQueue(function (q) {
      for (var i = q.length - 1; i >= 0; i--) if (done[q[i].qid]) q.splice(i, 1);
      stillPending = {};
      q.forEach(function (x) { stillPending[x.app + '\n' + x.id] = true; });
    }).then(function () {
      // サーバーの結果（確定した日時）を端末の控えに反映
      var byApp = {};
      items.forEach(function (x) {
        var r = done[x.qid];
        if (!r || !r.ok || !r.record || stillPending[x.app + '\n' + x.id]) return;
        (byApp[x.app] = byApp[x.app] || []).push(r.record);
      });
      return Promise.all(Object.keys(byApp).map(function (app) {
        return collection(app)._apply(byApp[app]);
      }));
    }).then(function () {
      failed.forEach(function (f) { emit('error', { error: f.error, during: 'flush', app: f.item.app, id: f.item.id }); });
      return Object.keys(done).length;
    });
  }

  // ---------- コレクション（アプリごとのデータ） ----------
  var collections = {};
  function collection(app, opts) {
    if (!APP_RE.test(String(app))) throw err('bad_app');
    if (collections[app]) return collections[app];
    opts = opts || {};
    var map = {};          // id → { id, createdAt, updatedAt, deleted, data, pending }
    var subs = [];
    var syncing = null;
    var self = {
      app: app,
      ready: null,
      all: function () {
        return Object.keys(map).map(function (k) { return map[k]; })
          .filter(function (r) { return !r.deleted; })
          .sort(function (a, b) { return a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0; });
      },
      get: function (id) { var r = map[id]; return r && !r.deleted ? r : null; },
      put: function (data, id) {
        id = id || uuid();
        var old = map[id];
        var t = nowIso();
        var rec = { id: id, createdAt: old ? old.createdAt : t, updatedAt: t, deleted: false, data: data, pending: true };
        map[id] = rec;
        return save().then(function () {
          changed();
          return enqueue({ app: app, op: 'put', id: id, data: data, createdAt: old && !old.pending ? undefined : rec.createdAt });
        }).then(function () { return rec; });
      },
      remove: function (id) {
        var old = map[id];
        if (!old) return Promise.resolve(false);
        map[id] = { id: id, createdAt: old.createdAt, updatedAt: nowIso(), deleted: true, data: null, pending: true };
        return save().then(function () {
          changed();
          return enqueue({ app: app, op: 'delete', id: id });
        }).then(function () { return true; });
      },
      // 送信待ちを送ってから、前回以降の変更を受け取る
      sync: function (o) {
        if (syncing) return syncing;
        var full = o && o.full;
        syncing = self.ready.then(function () { return flush(); }).then(function (fr) {
          return Promise.all([kv.get('since:' + app), pendingIds(app)]).then(function (v) {
            var since = full ? '' : v[0] || '';
            var pend = v[1];
            return call(app, 'list', since ? { since: since } : {}).then(function (res) {
              if (!since) {
                // 全件取り直し：送信待ち以外は入れ替え
                Object.keys(map).forEach(function (id) { if (!pend[id]) delete map[id]; });
              }
              return self._apply(res.records || [], pend).then(function () {
                return kv.set('since:' + app, res.now);
              }).then(function () {
                return { pulled: (res.records || []).length, sent: fr.sent, left: fr.left };
              });
            });
          });
        });
        syncing.then(function () { syncing = null; }, function (e) {
          syncing = null;
          emit('error', { error: e, during: 'sync', app: app });
        });
        return syncing;
      },
      pendingCount: function () { return pendingCount(app); },
      onChange: function (fn) {
        subs.push(fn);
        return function () { subs = subs.filter(function (f) { return f !== fn; }); };
      },
      // （内部用）サーバーのレコードを反映する
      _apply: function (records, pend) {
        return self.ready.then(function () {
          var p = pend ? Promise.resolve(pend) : pendingIds(app);
          return p.then(function (pending) {
            records.forEach(function (r) {
              if (pending[r.id]) return; // 端末側の新しい変更を優先（送信後に上書きされる）
              if (r.deleted) delete map[r.id];
              else map[r.id] = { id: r.id, createdAt: r.createdAt, updatedAt: r.updatedAt, deleted: false, data: r.data };
            });
            return save().then(changed);
          });
        });
      }
    };
    function save() {
      return kv.set('rec:' + app, map).catch(function (e) { emit('error', { error: err('storage_full'), app: app }); });
    }
    function changed() {
      var list = self.all();
      subs.slice().forEach(function (fn) { try { fn(list); } catch (e) { /* 無視 */ } });
    }
    self.ready = kv.get('rec:' + app).then(function (m) {
      if (m) Object.keys(m).forEach(function (k) { if (!map[k]) map[k] = m[k]; });
      changed();
    });
    collections[app] = self;
    if (opts.autoSync !== false && global.document) {
      var trySync = function () { if (isConnected(app) && online()) self.sync().catch(function () {}); };
      self.ready.then(trySync);
      global.addEventListener('online', trySync);
      document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible') trySync(); });
    }
    return self;
  }

  // ---------- 画像 ----------
  function fileToImage(file) {
    if (global.createImageBitmap) {
      return createImageBitmap(file, { imageOrientation: 'from-image' }).catch(function () {
        return createImageBitmap(file);
      }).catch(function () { return viaImg(file); });
    }
    return viaImg(file);
  }
  function viaImg(file) {
    return new Promise(function (ok, ng) {
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () { URL.revokeObjectURL(url); ok(img); };
      img.onerror = function () { URL.revokeObjectURL(url); ng(err('bad_image')); };
      img.src = url;
    });
  }
  function canvasToBlob(cv, q) {
    return new Promise(function (ok) {
      if (cv.toBlob) cv.toBlob(ok, 'image/jpeg', q);
      else ok(null);
    });
  }
  function blobToBase64(blob) {
    return new Promise(function (ok, ng) {
      var r = new FileReader();
      r.onload = function () { ok(String(r.result).replace(/^data:[^,]*,/, '')); };
      r.onerror = function () { ng(err('bad_image')); };
      r.readAsDataURL(blob);
    });
  }
  // 画像を縮小して JPEG に（長辺 maxSide px、maxBytes を超えたら質と大きさを下げる）
  function resizeImage(file, o) {
    o = o || {};
    var maxSide = o.maxSide || 1600, quality = o.quality || 0.82, maxBytes = o.maxBytes || 1500000;
    return fileToImage(file).then(function (img) {
      var w = img.width, h = img.height;
      var attempt = function (side, q) {
        var s = Math.min(1, side / Math.max(w, h));
        var cv = document.createElement('canvas');
        cv.width = Math.max(1, Math.round(w * s));
        cv.height = Math.max(1, Math.round(h * s));
        var ctx = cv.getContext('2d');
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, cv.width, cv.height);
        ctx.drawImage(img, 0, 0, cv.width, cv.height);
        return canvasToBlob(cv, q).then(function (b) {
          if (!b) throw err('bad_image');
          if (b.size <= maxBytes || side < 400) return b;
          return attempt(Math.round(side * 0.8), Math.max(0.6, q - 0.08));
        });
      };
      return attempt(maxSide, quality);
    });
  }
  function uploadImage(app, file, o) {
    o = o || {};
    if (!online()) return Promise.reject(err('offline'));
    return resizeImage(file, o).then(blobToBase64).then(function (b64) {
      var name = o.name || (file && file.name ? String(file.name).replace(/\.[^.]+$/, '') + '.jpg' : '');
      return call(app, 'image', { mime: 'image/jpeg', base64: b64, name: name }, { timeout: 90000 });
    }).then(function (res) { return res.image; });
  }
  // 表示用URL（img.src にそのまま入れる）。img は uploadImage の結果か、その id
  function imageUrl(img, size) {
    var id = img && img.id ? img.id : img;
    if (!id) return '';
    return 'https://drive.google.com/thumbnail?id=' + encodeURIComponent(id) + '&sz=w' + (size || 1600);
  }
  // 共有リンクが使えない設定のとき用：スプシ経由で取り寄せて blob: URL を返す（端末内に控える）
  function imageBlobUrl(app, img) {
    var id = img && img.id ? img.id : img;
    var toUrl = function (v) {
      var bin = atob(v.base64), arr = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
      return URL.createObjectURL(new Blob([arr], { type: v.mime }));
    };
    return kv.get('img:' + id).then(function (v) {
      if (v) return toUrl(v);
      return call(app, 'imageData', { id: id }, { timeout: 60000 }).then(function (res) {
        var v2 = { mime: res.mime, base64: res.base64 };
        return kv.set('img:' + id, v2).catch(function () {}).then(function () { return toUrl(v2); });
      });
    });
  }
  function deleteImage(app, img) {
    var id = img && img.id ? img.id : img;
    return call(app, 'imageDelete', { id: id }).then(function () { return kv.del('img:' + id); });
  }

  // ---------- 接続の画面（QR読み取り・他の端末の追加） ----------
  function h(tag, attrs, kids) {
    var el = document.createElement(tag);
    for (var k in attrs || {}) {
      if (k === 'text') el.textContent = attrs[k];
      else if (k.slice(0, 2) === 'on') el.addEventListener(k.slice(2), attrs[k]);
      else el.setAttribute(k, attrs[k]);
    }
    (kids || []).forEach(function (c) { if (c) el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return el;
  }
  function toast(msg, isError) {
    if (!global.document) return;
    var t = h('div', { class: 'ax-toast' + (isError ? ' ax-toast-error' : ''), role: 'status', text: msg });
    document.body.appendChild(t);
    setTimeout(function () { t.classList.add('ax-toast-hide'); }, 2600);
    setTimeout(function () { t.remove(); }, 3200);
  }
  function overlay(title, body, onClose) {
    var close = function () { stopScan(); wrap.remove(); if (onClose) onClose(); };
    var wrap = h('div', { class: 'ax-overlay', role: 'dialog', 'aria-modal': 'true', 'aria-label': title }, [
      h('div', { class: 'ax-sheet' }, [
        h('div', { class: 'ax-sheet-head' }, [
          h('h2', { text: title }),
          h('button', { class: 'ax-btn ax-btn-ghost', type: 'button', 'aria-label': '閉じる', text: '閉じる', onclick: close })
        ]),
        body
      ])
    ]);
    document.body.appendChild(wrap);
    return { el: wrap, close: close };
  }

  var scan = { stream: null, raf: 0 };
  function stopScan() {
    if (scan.raf) cancelAnimationFrame(scan.raf);
    scan.raf = 0;
    if (scan.stream) scan.stream.getTracks().forEach(function (t) { t.stop(); });
    scan.stream = null;
  }
  function decodeFrom(source, w, hgt) {
    var s = Math.min(1, 1000 / Math.max(w, hgt));
    var cw = Math.round(w * s), ch = Math.round(hgt * s);
    var cv = document.createElement('canvas');
    cv.width = cw; cv.height = ch;
    var ctx = cv.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(source, 0, 0, cw, ch);
    var hit = global.jsQR(ctx.getImageData(0, 0, cw, ch).data, cw, ch, { inversionAttempts: 'attemptBoth' });
    return hit && hit.data ? hit.data : null;
  }
  // 接続用の画面。done(conn) はつながったときに呼ばれる
  function connectBody(app, done) {
    var msg = h('p', { class: 'ax-msg', 'aria-live': 'polite' });
    var video = h('video', { class: 'ax-video', playsinline: '', muted: '', hidden: '' });
    var fileIn = h('input', { type: 'file', accept: 'image/*', hidden: '' });
    var paste = h('textarea', { class: 'ax-input', rows: '2', placeholder: 'https://cotoxdgn.github.io/connect/#c=…' });
    var finish = function (c) {
      if (!c) { msg.textContent = 'つなぐ用のQR・リンクではありません'; msg.className = 'ax-msg ax-err'; return; }
      stopScan();
      saveConnection(c);
      msg.textContent = 'つながりました' + (c.name ? '（' + c.name + '）' : '');
      msg.className = 'ax-msg ax-ok';
      done(c);
    };
    var startCamera = function () {
      msg.className = 'ax-msg';
      msg.textContent = 'カメラを準備しています…';
      loadScript(SHARED_BASE + 'lib/jsQR.js').then(function () {
        return navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
      }).then(function (stream) {
        scan.stream = stream;
        video.srcObject = stream;
        video.hidden = false;
        msg.textContent = 'パソコンのスプシに出ているQRを枠に映してください';
        return video.play().catch(function () {});
      }).then(function loop() {
        if (!scan.stream) return;
        if (video.readyState >= 2 && video.videoWidth) {
          var text = decodeFrom(video, video.videoWidth, video.videoHeight);
          if (text) { var c = parseConnect(text); if (c) { video.hidden = true; finish(c); return; } }
        }
        scan.raf = requestAnimationFrame(loop);
      }).catch(function (e) {
        stopScan();
        msg.className = 'ax-msg ax-err';
        msg.textContent = e && e.code === 'network' ? '読み取りの準備ができませんでした（通信を確認）'
          : 'カメラを使えませんでした。「写真から読み取る」か、リンクの貼り付けを使ってください';
      });
    };
    fileIn.addEventListener('change', function () {
      var f = fileIn.files && fileIn.files[0];
      if (!f) return;
      loadScript(SHARED_BASE + 'lib/jsQR.js').then(function () { return fileToImage(f); }).then(function (img) {
        var text = decodeFrom(img, img.width, img.height);
        finish(text ? parseConnect(text) : null);
      }).catch(function () { finish(null); });
      fileIn.value = '';
    });
    var hint = isIOS() && !isStandalone()
      ? h('p', { class: 'ax-note', text: 'iPhone・iPad では、ホーム画面に追加したアイコンから開いてつないでください（Safariでつないでも、ホーム画面のアプリには引き継がれません）。' })
      : null;
    return h('div', { class: 'ax-connect' }, [
      h('p', { text: 'パソコンでスプシを開き、メニュー「アプリ設定」→「この端末をつなぐ」に出るQRを読み取ります。' }),
      hint,
      h('div', { class: 'ax-row' }, [
        h('button', { class: 'ax-btn ax-btn-primary', type: 'button', text: 'QRでつなぐ', onclick: startCamera }),
        h('button', { class: 'ax-btn', type: 'button', text: '写真から読み取る', onclick: function () { fileIn.click(); } })
      ]),
      video, fileIn, msg,
      h('details', { class: 'ax-details' }, [
        h('summary', { text: 'リンクを貼り付けてつなぐ' }),
        paste,
        h('button', { class: 'ax-btn', type: 'button', text: 'つなぐ', onclick: function () { finish(parseConnect(paste.value)); } })
      ])
    ]);
  }

  // つながっていなければ接続画面を出し、つながったら conn を返す
  function ensureConnected(app) {
    var c = getConnection(app);
    if (c) return Promise.resolve(c);
    return new Promise(function (ok) {
      var ov = overlay('この端末をつなぐ', connectBody(app, function (conn) {
        setTimeout(function () { ov.close(); }, 700);
        ok(conn);
      }));
    });
  }

  // すでに（全アプリ共通で）つながっていても、つなぐ画面を出す（アプリ専用のスプシにつなぎ直すとき用）
  function openConnect(app) {
    return new Promise(function (ok) {
      var ov = overlay('この端末をつなぐ', connectBody(app, function (conn) {
        setTimeout(function () { ov.close(); }, 700);
        ok(conn);
      }));
    });
  }

  // 接続状態の確認・他の端末の追加・つなぎ直し・解除
  function openConnectSheet(app) {
    var c = getConnection(app);
    var body = h('div', {}, []);
    var ov = overlay('この端末の接続', body);
    if (!c) {
      body.appendChild(connectBody(app, function () { setTimeout(ov.close, 700); }));
      return ov;
    }
    var all = connAll();
    var own = app && all.per && all.per[app];
    var qrBox = h('div', { class: 'ax-qr', hidden: '' });
    var showQr = function () {
      loadScript(SHARED_BASE + 'lib/qrcode.js').then(function () {
        var q = global.qrcode(0, 'M');
        q.addData(connectLink(app));
        q.make();
        qrBox.innerHTML = '';
        qrBox.appendChild(h('img', { src: q.createDataURL(6, 12), alt: '接続用のQR' }));
        qrBox.appendChild(h('p', { class: 'ax-note ax-err', text: 'このQRには合言葉が入っています。スクショ・共有はしないでください。' }));
        qrBox.hidden = false;
      }, function () { toast('QRを表示できませんでした（通信を確認）', true); });
    };
    body.appendChild(h('p', {}, ['つながっています：', h('b', { text: c.name || 'スプレッドシート' }),
      own ? '（' + app + ' 専用）' : '（全アプリ共通）', h('br'), h('small', { text: '接続先 …' + urlTail(c.url) })]));
    body.appendChild(h('div', { class: 'ax-row' }, [
      h('button', { class: 'ax-btn', type: 'button', text: '他の端末を追加（QRを表示）', onclick: showQr }),
      h('button', { class: 'ax-btn', type: 'button', text: '確認', onclick: function () {
        call(app, 'ping').then(function () { toast('スプシとつながっています'); }, function (e) { toast(errorText(e), true); });
      } })
    ]));
    body.appendChild(qrBox);
    body.appendChild(h('details', { class: 'ax-details' }, [
      h('summary', { text: 'つなぎ直す・外す' }),
      connectBody(app, function () { setTimeout(ov.close, 700); }),
      h('button', { class: 'ax-btn ax-btn-danger', type: 'button', text: own ? 'この端末の ' + app + ' 専用の接続を外す' : 'この端末の接続を外す', onclick: function () {
        if (!global.confirm('この端末の接続を外しますか？（スプシのデータは消えません）')) return;
        disconnect(own ? app : '');
        ov.close();
        toast('接続を外しました');
      } })
    ]));
    return ov;
  }

  // ---------- 起動時 ----------
  if (global.document && global.location) {
    var fromHash = consumeHash();
    if (fromHash) {
      var onReady = function () { toast('この端末をつなぎました' + (fromHash.app ? '（' + fromHash.app + '）' : '')); };
      if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', onReady); else onReady();
    }
    global.addEventListener('online', function () { flush().catch(function () {}); });
    global.addEventListener('storage', function (e) { if (e.key === CONN_KEY) emit('connection', {}); });
  }

  global.Apps = {
    version: VERSION,
    // 接続
    getConnection: getConnection,
    isConnected: isConnected,
    saveConnection: saveConnection,
    disconnect: disconnect,
    parseConnect: parseConnect,
    connectLink: connectLink,
    ensureConnected: ensureConnected,
    openConnectSheet: openConnectSheet,
    openConnect: openConnect,
    // データ
    call: call,
    collection: collection,
    flush: flush,
    pendingCount: pendingCount,
    // 画像
    uploadImage: uploadImage,
    resizeImage: resizeImage,
    imageUrl: imageUrl,
    imageBlobUrl: imageBlobUrl,
    deleteImage: deleteImage,
    // その他
    on: on,
    errorText: errorText,
    toast: toast,
    uuid: uuid,
    isIOS: isIOS,
    isStandalone: isStandalone,
    loadScript: loadScript,
    _kv: kv
  };
})(typeof window !== 'undefined' ? window : globalThis);
