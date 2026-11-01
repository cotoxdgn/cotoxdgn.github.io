/* 本棚 — 本をバーコードで棚に入れ、ジャンル別の段で眺め、読んだ本から脳みそにメモを作る。
 * 本のレコード：data = { t:'book', isbn, title, author, publisher, cover, status:'want'|'done', rating:0〜5, genre:ジャンルid|'', doneOn:'YYYY-MM-DD'|'', memo }
 *   - status は「読みたい」「読んだ」の2つだけ。「読んだ」にした日を doneOn に自動で入れる（詳細で直せる）
 *   - 表紙は URL を持つだけ（画像は保存しない）
 * ジャンル：id 'genres' のレコード data = { t:'genres', list:[{ id:'g-xxxx', name, c:1〜4 }] }（並び順＝棚の順）
 *   - genre が '' または見つからない本は「未分類」（消せない・いつも最後の段）
 * 脳みそ（app=brain）のカードのうち data.source.bookId がこの本の id のものを、本の詳細に並べる（読むだけ・書き換えない）
 * 書誌：ISBN → openBD → なければ Google Books。書名検索は Google Books。バーコードは ZXing（版固定）で読む
 */
(function () {
  'use strict';
  var APP = 'hondana';
  var GENRES_ID = 'genres';
  var BRAIN = '../brain/';
  var ZXING = 'https://cdn.jsdelivr.net/npm/@zxing/browser@0.1.5/umd/zxing-browser.min.js';
  var OPENBD = 'https://api.openbd.jp/v1/get?isbn=';
  var GBOOKS = 'https://www.googleapis.com/books/v1/volumes?q=';
  // 国立国会図書館サーチ（無料・キー不要・回数制限なし）。Google Books はキーなしだと1日の上限に当たりやすいので予備にする
  var NDL = 'https://ndlsearch.ndl.go.jp/api/opensearch?mediatype=books&';
  var NDL_THUMB = 'https://ndlsearch.ndl.go.jp/thumbnail/';
  var STS = [{ k: 'want', l: '読みたい' }, { k: 'done', l: '読んだ' }];
  var BRAIN_KINDS = 'DTMLSBHO';

  var db = Apps.collection(APP);
  var brain = Apps.collection('brain');   // 脳みその控え（読むだけ）
  var $ = function (id) { return document.getElementById(id); };
  var S = { scr: 'shelf', st: '', g: '', sel: null, editG: null, delG: null, nw: null, nwFrom: 'scan', lastGenre: '', addG: false };

  // ---------- 小物 ----------
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function today() {
    var d = new Date();
    return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);
  }
  function dots(s) { return String(s || '').replace(/-/g, '.'); }
  function online() { return navigator.onLine !== false; }
  function copyData(d) { return JSON.parse(JSON.stringify(d)); }
  function pad3(n) { n = String(n || 0); while (n.length < 3) n = '0' + n; return n; }
  function httpsUrl(u) {
    u = String(u || '').trim();
    if (/^http:\/\//.test(u)) u = 'https://' + u.slice(7);
    return /^https:\/\/[^\s"'<>]+$/.test(u) ? u : '';
  }
  function stLabel(k) { return k === 'done' ? '読んだ' : '読みたい'; }
  function normStatus(k) { return k === 'done' ? 'done' : 'want'; }

  // ---------- ISBN ----------
  function isbn13ok(s) {
    if (!/^97[89]\d{10}$/.test(s)) return false;
    var sum = 0;
    for (var i = 0; i < 12; i++) sum += (+s[i]) * (i % 2 ? 3 : 1);
    return (10 - sum % 10) % 10 === +s[12];
  }
  // 13桁・10桁（ハイフン可）→ 13桁。正しくなければ ''
  function toIsbn13(raw) {
    var s = String(raw || '').replace(/[\s\-‐－ー]/g, '').toUpperCase();
    if (/^\d{13}$/.test(s)) return isbn13ok(s) ? s : '';
    if (/^\d{9}[\dX]$/.test(s)) {
      var sum = 0;
      for (var i = 0; i < 10; i++) sum += (s[i] === 'X' ? 10 : +s[i]) * (10 - i);
      if (sum % 11) return '';
      var b = '978' + s.slice(0, 9), t = 0;
      for (var j = 0; j < 12; j++) t += (+b[j]) * (j % 2 ? 3 : 1);
      return b + ((10 - t % 10) % 10);
    }
    return '';
  }
  function isbnStr(s) { return s && s.length === 13 ? s.slice(0, 3) + '-' + s.slice(3) : s || ''; }

  // ---------- データ ----------
  function books() { return db.all().filter(function (r) { return r.data && r.data.t === 'book'; }); }
  function byId(id) { var r = db.get(id); return r && r.data && r.data.t === 'book' ? r : null; }
  function genres() { var r = db.get(GENRES_ID); return r && r.data && Array.isArray(r.data.list) ? r.data.list.filter(function (g) { return g && g.id; }) : []; }
  function genreOf(id) { return genres().filter(function (g) { return g.id === id; })[0] || null; }
  function gKey(d) { return genreOf(d.genre) ? d.genre : ''; }
  function gColor(g) { return g ? 'var(--g' + (((g.c || 1) - 1) % 4 + 1) + ')' : 'var(--g5)'; }
  function gName(g) { return g ? g.name : '未分類'; }
  function saveGenres(list) { return db.put({ t: 'genres', list: list }, GENRES_ID); }
  function newGenre(name) {
    var list = genres();
    var used = {};
    list.forEach(function (g) { used[g.c] = (used[g.c] || 0) + 1; });
    var c = [1, 2, 3, 4].sort(function (a, b) { return (used[a] || 0) - (used[b] || 0) || a - b; })[0];
    var g = { id: 'g-' + Apps.uuid().slice(0, 8), name: name, c: c };
    return saveGenres(list.concat([g])).then(function () { return g; });
  }
  function putBook(r, d) { return db.put(d, r ? r.id : undefined); }
  function notesOf(bookId) {
    return brain.all().filter(function (r) {
      var d = r.data;
      return d && d.t === 'k' && d.source && d.source.bookId === bookId;
    }).sort(function (a, b) { return (a.data.no || 0) - (b.data.no || 0); });
  }

  // ---------- 表紙 ----------
  function cover(d, cls) {
    var g = genreOf(d.genre), url = httpsUrl(d.cover);
    return '<span class="cover' + (cls ? ' ' + cls : '') + '" style="--gc:' + gColor(g) + '"><span class="vt">' + esc(d.title) + '</span><span class="au">' + esc(d.author) + '</span>' +
      (url ? '<img src="' + esc(url) + '" alt="" loading="lazy" referrerpolicy="no-referrer">' : '') + '</span>';
  }
  // 表紙が読めなかったら、色地＋縦書きに戻す
  document.addEventListener('error', function (e) {
    var t = e.target;
    if (t && t.tagName === 'IMG' && t.parentNode && t.parentNode.classList && t.parentNode.classList.contains('cover')) t.remove();
  }, true);
  function starsS(n) { return n ? '<span class="stars-s" aria-label="★' + n + '">' + '★★★★★'.slice(0, n) + '</span>' : ''; }

  // ---------- 画面の切り替え ----------
  var SCR = { shelf: 'scrShelf', detail: 'scrDetail', scan: 'scrScan', search: 'scrSearch', genres: 'scrGenres' };
  function go(s) {
    if (S.scr === 'scan' && s !== 'scan') stopScan();
    S.scr = s;
    S.addG = false;
    Object.keys(SCR).forEach(function (k) { $(SCR[k]).classList.toggle('on', k === s); });
    if (s === 'scan') { showScanView(); startScan(); }
    if (s === 'genres') { S.editG = null; S.delG = null; }
    if (s === 'search') { setTimeout(function () { if (!$('sq').value) $('sq').focus(); }, 50); renderMine(); }
    render();
    var b = $(SCR[s]).querySelector('.body');
    if (b && s !== 'shelf') b.scrollTop = 0;
  }
  document.addEventListener('click', function (e) {
    var t = e.target.closest('[data-go]');
    if (t && t.tagName !== 'A') { e.preventDefault(); go(t.dataset.go); }
  });
  function render() {
    if (S.scr === 'shelf') renderShelf();
    if (S.scr === 'detail') renderDetail();
    if (S.scr === 'genres') renderGenres();
    if (S.scr === 'scan' && S.nw) renderNew();
  }

  // ---------- 棚 ----------
  function renderShelf() {
    var all = books();
    $('emptyShelf').hidden = all.length > 0;
    $('filters').hidden = !all.length;
    if (!all.length) { $('shelves').innerHTML = ''; return; }
    var segs = [{ k: '', l: 'すべて' }].concat(STS);
    $('stSeg').innerHTML = segs.map(function (x) {
      return '<button type="button" aria-pressed="' + (S.st === x.k) + '" class="' + (S.st === x.k ? 'on' : '') + '" data-st="' + x.k + '">' + x.l + '</button>';
    }).join('');
    var pool = all.filter(function (b) { return !S.st || normStatus(b.data.status) === S.st; });
    var gs = genres().concat([null]);
    if (S.g && S.g !== '-' && !genreOf(S.g)) S.g = '';
    var gh = '<button type="button" class="chip' + (!S.g ? ' on' : '') + '" data-g="">全ジャンル<span class="n">' + pool.length + '</span></button>';
    gs.forEach(function (g) {
      var key = g ? g.id : '';
      var n = pool.filter(function (b) { return gKey(b.data) === key; }).length;
      if (!g && !n && S.g !== '-') return;
      var fk = g ? g.id : '-';
      gh += '<button type="button" class="chip' + (S.g === fk ? ' on' : '') + '" data-g="' + esc(fk) + '"><i style="background:' + gColor(g) + '"></i>' + esc(gName(g)) + '<span class="n">' + n + '</span></button>';
    });
    $('gChips').innerHTML = gh;
    var h = '';
    gs.forEach(function (g) {
      var key = g ? g.id : '', fk = g ? g.id : '-';
      if (S.g && S.g !== fk) return;
      var bs = pool.filter(function (b) { return gKey(b.data) === key; });
      var head = '<div class="shelf-h"><h3><i style="background:' + gColor(g) + '"></i>' + esc(gName(g)) + '</h3><span>' + bs.length + '冊</span></div>';
      if (!bs.length) {
        if (g && !S.g && !S.st) h += '<div class="shelf">' + head + '<p class="empty-shelf">まだこの棚に本はありません</p></div>';
        return;
      }
      h += '<div class="shelf">' + head + '<div class="books">' + bs.map(function (b) {
        var d = b.data, st = normStatus(d.status);
        return '<button type="button" class="book" data-book="' + esc(b.id) + '" aria-label="' + esc(d.title) + '">' + cover(d) +
          '<span class="meta"><span class="st ' + st + '">' + stLabel(st) + '</span>' + starsS(d.rating) + (b.pending ? '<span class="wait">送信待ち</span>' : '') + '</span></button>';
      }).join('') + '</div></div>';
    });
    $('shelves').innerHTML = h || '<p class="empty-shelf">条件に合う本はありません</p>';
  }
  $('stSeg').addEventListener('click', function (e) { var b = e.target.closest('[data-st]'); if (b) { S.st = b.dataset.st; renderShelf(); } });
  $('gChips').addEventListener('click', function (e) { var b = e.target.closest('[data-g]'); if (b) { S.g = b.dataset.g; renderShelf(); } });
  $('shelves').addEventListener('click', function (e) { var b = e.target.closest('[data-book]'); if (b) openBook(b.dataset.book); });

  // ---------- 本の詳細 ----------
  var STAR = '<svg viewBox="0 0 24 24"><path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z"/></svg>';
  function openBook(id) { S.sel = id; go('detail'); }
  function brainUrl(params) {
    var q = Object.keys(params).map(function (k) { return encodeURIComponent(k) + '=' + encodeURIComponent(params[k]); }).join('&');
    return BRAIN + '?' + q;
  }
  function backUrl(id) { return '../hondana/?book=' + encodeURIComponent(id); }
  function makeNoteUrl(r) {
    var d = r.data, src = { bookId: r.id, title: d.title, author: d.author || '' };
    if (httpsUrl(d.cover)) src.cover = httpsUrl(d.cover);
    return brainUrl({ 'new': 'B', src: JSON.stringify(src), back: backUrl(r.id), from: '本棚' });
  }
  function genreChips(sel, attr) {
    var h = genres().concat([null]).map(function (g) {
      var key = g ? g.id : '';
      return '<button type="button" class="chip' + (sel === key ? ' on' : '') + '" ' + attr + '="' + esc(key) + '" aria-pressed="' + (sel === key) + '"><i style="background:' + gColor(g) + '"></i>' + esc(gName(g)) + '</button>';
    }).join('');
    if (S.addG) h += '<form class="chip-form" data-gform="' + attr + '"><input class="inp" maxlength="14" placeholder="新しいジャンル名" aria-label="新しいジャンル名" required><button class="btn" type="submit">作る</button></form>';
    else h += '<button type="button" class="chip add" data-gnew="1">＋ ジャンルを作る</button>';
    return h;
  }
  function renderDetail() {
    var r = S.sel && byId(S.sel);
    if (!r) { $('detail').innerHTML = '<p class="note">この本は見つかりません（消したか、まだ同期していません）。</p>'; return; }
    var d = r.data, st = normStatus(d.status), notes = notesOf(r.id);
    var keepMemo = document.activeElement && document.activeElement.id === 'dmemo';
    if (keepMemo) return; // 入力中は描き直さない
    var h = '<div class="dhead">' + cover(d) + '<div><h3>' + esc(d.title) + '</h3><p>' + esc([d.author, d.publisher].filter(Boolean).join('　')) + '</p>' +
      (d.isbn ? '<span class="isbn">ISBN ' + esc(isbnStr(d.isbn)) + '</span>' : '') + '</div></div>';
    h += '<div><span class="lab">状態</span><div class="seg" role="group" aria-label="状態">' + STS.map(function (x) {
      return '<button type="button" aria-pressed="' + (st === x.k) + '" class="' + (st === x.k ? 'on' : '') + '" data-dst="' + x.k + '">' + x.l + '</button>';
    }).join('') + '</div></div>';
    h += '<div><span class="lab">評価</span><div class="stars" role="group" aria-label="評価">' + [1, 2, 3, 4, 5].map(function (n) {
      return '<button type="button" class="' + ((d.rating || 0) >= n ? 'on' : '') + '" data-star="' + n + '" aria-label="★' + n + '" aria-pressed="' + ((d.rating || 0) === n) + '">' + STAR + '</button>';
    }).join('') + '</div></div>';
    h += '<div><span class="lab">ジャンル（棚）</span><div class="chips" id="dGenres">' + genreChips(gKey(d), 'data-dg') + '</div></div>';
    if (st === 'done') h += '<div><span class="lab">読み終えた日</span><div class="done-row"><input class="inp" type="date" id="ddone" value="' + esc(d.doneOn || '') + '" aria-label="読み終えた日"></div></div>';
    h += '<label><span class="lab">ひとことメモ（本棚の中だけ）</span><textarea class="inp" id="dmemo" rows="2" maxlength="400" placeholder="どこで知ったか・誰に勧められたか など">' + esc(d.memo || '') + '</textarea></label>';
    h += '<div><span class="lab">脳みそのメモ ' + notes.length + '件</span><div class="notes">' + (notes.length ? notes.map(function (n) {
      var k = n.data.kind || 'O', kc = BRAIN_KINDS.indexOf(k) >= 0 ? 'var(--k-' + k + ')' : 'var(--k-x)';
      return '<a class="nref" href="' + esc(brainUrl({ open: n.id, back: backUrl(r.id), from: '本棚' })) + '"><span class="circ" style="--kc:' + kc + '">' + esc(k) + '<br>' + esc(pad3(n.data.no)) + '</span>' +
        '<span class="rt">' + esc(n.data.title) + (n.data.source.page ? ' <small>' + esc(n.data.source.page) + '</small>' : '') + '</span><span class="go">›</span></a>';
    }).join('') : '<p class="notes-none">この本から作ったメモはまだありません。</p>') + '</div></div>';
    h += '<a class="make" href="' + esc(makeNoteUrl(r)) + '">＋ 脳みそにメモを作る</a>';
    h += '<p class="note">メモは何件でも作れます。1件＝気づき1つ（例：「暗がりがあるから金が映える」）。</p>';
    h += '<details class="biblio"><summary>書誌を直す・この本を消す</summary><form class="biblio-f" id="bibForm">' +
      '<label><span class="lab">書名</span><input class="inp" id="bTitle" required maxlength="160" value="' + esc(d.title) + '"></label>' +
      '<label><span class="lab">著者</span><input class="inp" id="bAuthor" maxlength="120" value="' + esc(d.author || '') + '"></label>' +
      '<label><span class="lab">出版社</span><input class="inp" id="bPub" maxlength="80" value="' + esc(d.publisher || '') + '"></label>' +
      '<label><span class="lab">ISBN</span><input class="inp" id="bIsbn" inputmode="numeric" maxlength="20" value="' + esc(d.isbn || '') + '"></label>' +
      '<label><span class="lab">表紙のURL（https）</span><input class="inp" id="bCover" type="url" maxlength="500" value="' + esc(d.cover || '') + '"></label>' +
      '<button class="btn pri" type="submit">書誌を保存</button>' +
      '<button class="btn danger" type="button" id="bDel">この本を棚から消す</button></form></details>';
    h += '<p class="dfoot">登録 ' + esc(dots(r.createdAt.slice(0, 10))) + (r.pending ? ' ・ 送信待ち' : '') + '</p>';
    var open = $('detail').querySelector('details.biblio');
    var wasOpen = open && open.open;
    $('detail').innerHTML = h;
    if (wasOpen) $('detail').querySelector('details.biblio').open = true;
  }
  function updateSel(fn, msg) {
    var r = byId(S.sel);
    if (!r) return Promise.resolve();
    var d = copyData(r.data);
    fn(d);
    return putBook(r, d).then(function () { if (msg) Apps.toast(msg); });
  }
  $('detail').addEventListener('click', function (e) {
    var t = e.target.closest('button');
    if (!t) return;
    var ds = t.dataset;
    if (ds.dst) {
      updateSel(function (d) {
        d.status = ds.dst;
        if (ds.dst === 'done' && !d.doneOn) d.doneOn = today();
        if (ds.dst !== 'done') d.doneOn = '';
      }, '「' + stLabel(ds.dst) + '」にしました');
      return;
    }
    if (ds.star) { var n = +ds.star; updateSel(function (d) { d.rating = (d.rating || 0) === n ? 0 : n; }); return; }
    if (ds.dg != null) {
      var g = genreOf(ds.dg);
      updateSel(function (d) { d.genre = g ? g.id : ''; }, '「' + gName(g) + '」の棚に移しました');
      return;
    }
    if (ds.gnew) { S.addG = true; renderDetail(); focusGForm(); return; }
    if (t.id === 'bDel') {
      var r = byId(S.sel);
      if (!r) return;
      ask('「' + r.data.title + '」を棚から消しますか？', '評価・メモも消えます。脳みそのメモは残ります（出典の書名はそのまま）。', '消す', function () {
        db.remove(r.id).then(function () { Apps.toast('消しました'); });
        go('shelf');
      });
    }
  });
  $('detail').addEventListener('change', function (e) {
    if (e.target.id === 'ddone') { var v = e.target.value; updateSel(function (d) { d.doneOn = v; }); }
  });
  var memoTimer = 0;
  function saveMemo() {
    clearTimeout(memoTimer); memoTimer = 0;
    var el = $('dmemo'), r = byId(S.sel);
    if (!el || !r) return;
    var v = el.value.replace(/\s+$/, '');
    if (v === (r.data.memo || '')) return;
    var d = copyData(r.data); d.memo = v;
    putBook(r, d);
  }
  $('detail').addEventListener('input', function (e) { if (e.target.id === 'dmemo') { clearTimeout(memoTimer); memoTimer = setTimeout(saveMemo, 800); } });
  $('detail').addEventListener('focusout', function (e) { if (e.target.id === 'dmemo') { saveMemo(); setTimeout(renderDetail, 0); } });
  $('detail').addEventListener('submit', function (e) {
    e.preventDefault();
    if (e.target.id === 'bibForm') {
      var title = $('bTitle').value.trim();
      if (!title) return;
      var rawIsbn = $('bIsbn').value.trim(), isbn = rawIsbn ? toIsbn13(rawIsbn) : '';
      if (rawIsbn && !isbn) { Apps.toast('ISBNが正しくありません（13桁か10桁）', true); return; }
      var cv = $('bCover').value.trim();
      if (cv && !httpsUrl(cv)) { Apps.toast('表紙のURLは https:// で始まるものにしてください', true); return; }
      updateSel(function (d) {
        d.title = title; d.author = $('bAuthor').value.trim(); d.publisher = $('bPub').value.trim(); d.isbn = isbn; d.cover = httpsUrl(cv);
      }, '書誌を保存しました');
      return;
    }
    if (e.target.dataset.gform) submitGForm(e.target);
  });

  // ジャンルをその場で作る（詳細・追加の画面）
  function focusGForm() { var i = document.querySelector('.chip-form .inp'); if (i) i.focus(); }
  function submitGForm(form) {
    var name = form.querySelector('.inp').value.trim(), attr = form.dataset.gform;
    if (!name) return;
    if (genres().some(function (g) { return g.name === name; })) { Apps.toast('「' + name + '」はもうあります', true); return; }
    newGenre(name).then(function (g) {
      S.addG = false;
      if (attr === 'data-dg') updateSel(function (d) { d.genre = g.id; }, '「' + name + '」の棚を作って移しました');
      else { S.nw.genre = g.id; S.lastGenre = g.id; renderNew(); Apps.toast('「' + name + '」の棚を作りました'); }
    });
  }

  // ---------- 確認 ----------
  function ask(title, text, okLabel, ok) {
    $('cfTitle').textContent = title; $('cfText').textContent = text; $('cfOk').textContent = okLabel || '削除する';
    $('confirm').hidden = false;
    $('cfOk').onclick = function () { $('confirm').hidden = true; ok(); };
  }
  $('cfNo').addEventListener('click', function () { $('confirm').hidden = true; });

  // ---------- 書誌を調べる ----------
  function getJson(url) {
    if (!online()) return Promise.reject(new Error('offline'));
    var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, 12000) : 0;
    return fetch(url, { signal: ctrl ? ctrl.signal : undefined, referrerPolicy: 'no-referrer' }).then(function (res) {
      clearTimeout(timer);
      if (!res.ok) throw new Error('http ' + res.status);
      return res.json();
    }, function (e) { clearTimeout(timer); throw e; });
  }
  function cleanAuthor(a) {
    // openBD の「谷崎潤一郎／著 山田太郎／訳」→「谷崎潤一郎、山田太郎」
    return String(a || '').split(/[\s　]+/).map(function (x) { return x.replace(/[／\/][^／\/]*$/, '').replace(/,\s*/g, ''); })
      .filter(Boolean).join('、');
  }
  function fromOpenBD(isbn) {
    return getJson(OPENBD + isbn).then(function (arr) {
      var o = arr && arr[0] && arr[0].summary;
      if (!o || !o.title) return null;
      return { isbn: isbn, title: [o.title, o.volume].filter(Boolean).join(' '), author: cleanAuthor(o.author), publisher: o.publisher || '', cover: httpsUrl(o.cover) };
    });
  }
  function gbItem(v, isbnHint) {
    v = v || {};
    var ids = v.industryIdentifiers || [], i13 = ids.filter(function (x) { return x.type === 'ISBN_13'; })[0], i10 = ids.filter(function (x) { return x.type === 'ISBN_10'; })[0];
    var isbn = isbnHint || (i13 ? toIsbn13(i13.identifier) : i10 ? toIsbn13(i10.identifier) : '');
    var img = v.imageLinks && (v.imageLinks.thumbnail || v.imageLinks.smallThumbnail);
    return {
      isbn: isbn, title: [v.title, v.subtitle].filter(Boolean).join(' '), author: (v.authors || []).join('、'), publisher: v.publisher || '',
      cover: httpsUrl(String(img || '').replace(/&edge=curl/, ''))
    };
  }
  function fromGoogle(isbn) {
    return getJson(GBOOKS + 'isbn:' + isbn).then(function (res) {
      var it = res && res.items && res.items[0];
      return it && it.volumeInfo && it.volumeInfo.title ? gbItem(it.volumeInfo, isbn) : null;
    });
  }
  function getXml(url) {
    if (!online()) return Promise.reject(new Error('offline'));
    var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, 12000) : 0;
    return fetch(url, { signal: ctrl ? ctrl.signal : undefined, referrerPolicy: 'no-referrer' }).then(function (res) {
      clearTimeout(timer);
      if (!res.ok) throw new Error('http ' + res.status);
      return res.text();
    }, function (e) { clearTimeout(timer); throw e; }).then(function (t) { return new DOMParser().parseFromString(t, 'text/xml'); });
  }
  var DC = 'http://purl.org/dc/elements/1.1/';
  function ndlItems(doc) {
    var out = [], seen = {};
    Array.prototype.forEach.call(doc.getElementsByTagName('item'), function (it) {
      function all(tag) { return Array.prototype.map.call(it.getElementsByTagNameNS(DC, tag), function (x) { return String(x.textContent || '').trim(); }).filter(Boolean); }
      var title = all('title')[0] || '';
      if (!title) return;
      var isbn = '';
      Array.prototype.forEach.call(it.getElementsByTagNameNS(DC, 'identifier'), function (x) {
        if (!isbn && /ISBN/.test(x.getAttribute('xsi:type') || '')) isbn = toIsbn13(String(x.textContent || '').replace(/[^0-9Xx]/g, '')) || '';
      });
      var author = all('creator').map(function (a) { return a.replace(/,\s*/g, '').replace(/\s*\d{4}-?\d{0,4}$/, ''); }).join('、');
      var key = isbn || title + '|' + author;
      if (seen[key]) return;
      seen[key] = 1;
      out.push({ isbn: isbn, title: title.replace(/\s*:\s*/g, ' '), author: author, publisher: all('publisher')[0] || '', cover: isbn ? NDL_THUMB + isbn + '.jpg' : '' });
    });
    return out;
  }
  function fromNdl(isbn) {
    return getXml(NDL + 'isbn=' + isbn + '&cnt=1').then(function (doc) { return ndlItems(doc)[0] || null; });
  }
  // openBD → 国会図書館 → Google Books。どれにも無ければ null。全部通信できなければ reject
  function lookupIsbn(isbn) {
    var netErr = 0;
    return fromOpenBD(isbn).catch(function () { netErr++; return null; }).then(function (a) {
      if (a && a.cover) return a;
      return fromNdl(isbn).catch(function () { netErr++; return null; }).then(function (n) {
        var base = a || n;
        if (base && base.cover) return base;
        // 表紙が無い（または見つからない）ときだけ Google Books も見る
        return fromGoogle(isbn).catch(function () { netErr++; return null; }).then(function (b) {
          if (base) { if (b && b.cover) base.cover = b.cover; return base; }
          if (b) return b;
          if (netErr >= 3) throw new Error('network');
          return null;
        });
      });
    });
  }
  // 書名・著者で探す：国会図書館（ISBNのある本を先に）→ 0件・失敗なら Google Books
  function searchTitle(q) {
    return getXml(NDL + 'any=' + encodeURIComponent(q) + '&cnt=40').then(function (doc) {
      var r = ndlItems(doc);
      r.sort(function (x, y) { return (y.isbn ? 1 : 0) - (x.isbn ? 1 : 0); });
      return r.slice(0, 20);
    }).catch(function () { return []; }).then(function (r) {
      if (r.length) return r;
      return getJson(GBOOKS + encodeURIComponent(q) + '&maxResults=20&printType=books').then(function (res) {
        return (res && res.items || []).map(function (it) { return gbItem(it.volumeInfo); }).filter(function (x) { return x.title; });
      });
    });
  }

  // ---------- バーコード ----------
  var SC = { stream: null, timer: 0, reader: null, busy: false, cv: null };
  function scanMsg(t, err) { $('scanMsg').textContent = t || ''; $('scanMsg').className = 'scan-msg' + (err ? ' err' : ''); }
  function showScanView() { $('scanView').hidden = false; $('scanResult').hidden = true; S.nw = null; $('isbnIn').value = ''; }
  function loadReader() {
    if (SC.reader) return Promise.resolve(SC.reader);
    return Apps.loadScript(ZXING).then(function () {
      var Z = window.ZXingBrowser;
      // 2 = POSSIBLE_FORMATS、3 = TRY_HARDER（DecodeHintType の番号）
      var hints = new Map([[2, [Z.BarcodeFormat.EAN_13]], [3, true]]);
      SC.reader = new Z.BrowserMultiFormatOneDReader(hints);
      return SC.reader;
    });
  }
  // canvas から ISBN（978/979 の13桁）を探す。帯（中央）→ 全体の順
  function decodeCanvas(cv) {
    try {
      var res = SC.reader.decodeFromCanvas(cv);
      var s = res && res.getText ? res.getText() : '';
      return isbn13ok(s) ? s : (s ? '!' + s : '');
    } catch (e) { return ''; }
  }
  function grab(src, w, h, band) {
    var cv = SC.cv || (SC.cv = document.createElement('canvas'));
    var sy = band ? h * 0.3 : 0, sh = band ? h * 0.4 : h;
    var s = Math.min(1, 1000 / w);
    cv.width = Math.round(w * s); cv.height = Math.round(sh * s);
    var ctx = cv.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(src, 0, sy, w, sh, 0, 0, cv.width, cv.height);
    return cv;
  }
  function startScan() {
    stopScan();
    scanMsg('');
    if (!online()) { scanMsg('オフラインです。つながってから読むか、「書名で探す」→「手で入れる」で登録できます', true); return; }
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { scanMsg('この画面ではカメラを使えません。写真から読み取るか、書名で探してください', true); return; }
    scanMsg('カメラを準備しています…');
    var mine = SC.gen = (SC.gen || 0) + 1;
    loadReader().then(function () {
      return navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
    }).then(function (stream) {
      if (mine !== SC.gen || S.scr !== 'scan') { stream.getTracks().forEach(function (t) { t.stop(); }); return; }
      SC.stream = stream;
      var v = $('video');
      v.srcObject = stream;
      v.play().catch(function () {});
      scanMsg('');
      var tick = function () {
        if (mine !== SC.gen) return;
        if (v.readyState >= 2 && v.videoWidth && !SC.busy) {
          var hit = decodeCanvas(grab(v, v.videoWidth, v.videoHeight, true));
          if (hit && hit[0] !== '!') { onIsbn(hit); return; }
          if (hit) scanMsg('それは値段のバーコードです。978で始まる方を映してください');
        }
        SC.timer = setTimeout(tick, 180);
      };
      tick();
    }).catch(function (e) {
      if (mine !== SC.gen) return;
      scanMsg(e && e.code === 'network' ? '読み取りの準備ができませんでした（通信を確認）。ISBNを入力するか、書名で探してください'
        : 'カメラを使えませんでした。写真から読み取るか、ISBNを入力してください', true);
    });
  }
  function stopScan() {
    SC.gen = (SC.gen || 0) + 1;
    clearTimeout(SC.timer); SC.timer = 0;
    if (SC.stream) SC.stream.getTracks().forEach(function (t) { t.stop(); });
    SC.stream = null;
    var v = $('video'); if (v) v.srcObject = null;
  }
  $('scanFile').addEventListener('change', function () {
    var f = this.files && this.files[0];
    this.value = '';
    if (!f) return;
    scanMsg('写真を読んでいます…');
    loadReader().then(function () {
      return window.createImageBitmap ? window.createImageBitmap(f) : Promise.reject(new Error('no bitmap'));
    }).then(function (img) {
      var hit = '';
      [true, false].some(function (band) { hit = decodeCanvas(grab(img, img.width, img.height, band)); return hit && hit[0] !== '!'; });
      if (hit && hit[0] !== '!') onIsbn(hit);
      else scanMsg('バーコードが読めませんでした。明るい所で、バーコードを大きめに撮ってください', true);
    }).catch(function () { scanMsg('写真を読めませんでした。ISBNを入力するか、書名で探してください', true); });
  });
  $('isbnForm').addEventListener('submit', function (e) {
    e.preventDefault();
    var isbn = toIsbn13($('isbnIn').value);
    if (!isbn) { scanMsg('ISBNが正しくありません（13桁か10桁）', true); return; }
    onIsbn(isbn);
  });
  function onIsbn(isbn) {
    stopScan();
    if (navigator.vibrate) try { navigator.vibrate(40); } catch (e) { /* 無視 */ }
    scanMsg('「' + isbnStr(isbn) + '」を調べています…');
    lookupIsbn(isbn).then(function (b) {
      if (S.scr !== 'scan') return;
      if (!b) {
        scanMsg('');
        showNew({ isbn: isbn, title: '', author: '', publisher: '', cover: '' }, 'scan', 'ISBNでは見つかりませんでした。書名を入れてください');
        return;
      }
      showNew(b, 'scan');
    }, function () {
      if (S.scr !== 'scan') return;
      showNew({ isbn: isbn, title: '', author: '', publisher: '', cover: '' }, 'scan', '本のデータベースにつながりませんでした。書名を入れてください');
    });
  }

  // ---------- 追加の確認（状態・ジャンルを選んで棚へ） ----------
  function showNew(b, from, warn) {
    if (S.scr !== 'scan') go('scan');
    stopScan();
    S.nw = { isbn: b.isbn || '', title: b.title || '', author: b.author || '', publisher: b.publisher || '', cover: httpsUrl(b.cover), status: 'want', genre: genreOf(S.lastGenre) ? S.lastGenre : '', warn: warn || '' };
    S.nwFrom = from;
    S.addG = false;
    $('scanView').hidden = true; $('scanResult').hidden = false;
    renderNew();
    $('scanResult').scrollTop = 0;
  }
  function dupOf(nw) {
    return books().filter(function (r) { return nw.isbn ? r.data.isbn === nw.isbn : (r.data.title === nw.title && (r.data.author || '') === (nw.author || '')); })[0];
  }
  function renderNew() {
    var n = S.nw;
    if (!n) return;
    var editTitle = !n.title || n.warn;
    $('foundBox').innerHTML = cover(n) + '<div>' +
      (n.warn ? '<span class="ok warn">' + esc(n.warn) + '</span>' : '<span class="ok">' + (n.isbn && S.nwFrom === 'scan' ? 'ISBNから見つかりました' : '入れる本') + '</span>') +
      (editTitle ? '<label><input class="inp" id="nTitle" maxlength="160" placeholder="書名" aria-label="書名" value="' + esc(n.title) + '"></label>' +
        '<label style="margin-top:6px"><input class="inp" id="nAuthor" maxlength="120" placeholder="著者" aria-label="著者" value="' + esc(n.author) + '"></label>'
        : '<h3>' + esc(n.title) + '</h3><p>' + esc([n.author, n.publisher].filter(Boolean).join('　')) + '</p>') +
      (n.isbn ? '<span class="isbn">' + esc(isbnStr(n.isbn)) + '</span>' : '') + '</div>';
    var dup = dupOf(n);
    $('dupBox').innerHTML = dup ? '<div class="dup"><p>この本はもう「' + esc(gName(genreOf(dup.data.genre))) + '」の棚にあります。</p><div><button type="button" class="btn" data-open="' + esc(dup.id) + '">棚の本を開く</button></div></div>' : '';
    $('nSt').innerHTML = STS.map(function (x) {
      return '<button type="button" aria-pressed="' + (n.status === x.k) + '" class="' + (n.status === x.k ? 'on' : '') + '" data-nst="' + x.k + '">' + x.l + '</button>';
    }).join('');
    $('nG').innerHTML = genreChips(n.genre, 'data-ng');
    $('nSave').textContent = dup ? 'それでも棚に入れる' : '棚に入れる';
  }
  $('foundBox').addEventListener('input', function (e) {
    if (e.target.id === 'nTitle') S.nw.title = e.target.value;
    if (e.target.id === 'nAuthor') S.nw.author = e.target.value;
  });
  $('scanResult').addEventListener('click', function (e) {
    var t = e.target.closest('button');
    if (!t || !S.nw) return;
    var ds = t.dataset;
    if (ds.nst) { S.nw.status = ds.nst; renderNew(); return; }
    if (ds.ng != null) { S.nw.genre = genreOf(ds.ng) ? ds.ng : ''; S.lastGenre = S.nw.genre; renderNew(); return; }
    if (ds.gnew) { S.addG = true; renderNew(); focusGForm(); return; }
    if (ds.open) { openBook(ds.open); return; }
  });
  $('scanResult').addEventListener('submit', function (e) { e.preventDefault(); if (e.target.dataset.gform) submitGForm(e.target); });
  $('nSave').addEventListener('click', function () {
    var n = S.nw;
    if (!n) return;
    var title = String(n.title || '').trim();
    if (!title) { Apps.toast('書名を入れてください', true); var i = $('nTitle'); if (i) i.focus(); return; }
    var d = { t: 'book', isbn: n.isbn || '', title: title, author: String(n.author || '').trim(), publisher: n.publisher || '', cover: httpsUrl(n.cover),
      status: n.status, rating: 0, genre: genreOf(n.genre) ? n.genre : '', doneOn: n.status === 'done' ? today() : '', memo: '' };
    var g = genreOf(d.genre);
    putBook(null, d).then(function () {
      Apps.toast('「' + gName(g) + '」の棚に入れました');
      S.nw = null;
      if (S.nwFrom === 'search') go('search'); else { S.st = ''; S.g = ''; go('shelf'); }
    }, function (err) { Apps.toast(Apps.errorText(err), true); });
  });
  $('nAgain').addEventListener('click', function () { showScanView(); startScan(); });

  // ---------- 書名で探す ----------
  var HITS = [];
  function renderMine() {
    var q = $('sq').value.trim().toLowerCase();
    if (!q) { $('mine').innerHTML = ''; return; }
    var ws = q.split(/\s+/);
    var mine = books().filter(function (r) {
      var hay = (r.data.title + ' ' + (r.data.author || '') + ' ' + (r.data.memo || '')).toLowerCase();
      return ws.every(function (w) { return hay.indexOf(w) >= 0; });
    });
    $('mine').innerHTML = mine.length ? '<p class="sub-h">棚にある本 ' + mine.length + '冊</p><div class="hits">' + mine.map(function (r) {
      return '<button type="button" class="hit" data-mine="' + esc(r.id) + '">' + cover(r.data) + '<span><b>' + esc(r.data.title) + '</b><small>' + esc(r.data.author || '') + '</small></span><span class="add have">' + stLabel(normStatus(r.data.status)) + ' ›</span></button>';
    }).join('') + '</div>' : '';
  }
  function renderHits() {
    var have = {};
    books().forEach(function (r) { if (r.data.isbn) have[r.data.isbn] = 1; });
    $('hits').innerHTML = HITS.map(function (x, i) {
      return '<button type="button" class="hit" data-hit="' + i + '">' + cover(x) + '<span><b>' + esc(x.title) + '</b><small>' + esc([x.author, x.publisher].filter(Boolean).join('　')) + '</small></span>' +
        '<span class="add' + (have[x.isbn] ? ' have' : '') + '">' + (have[x.isbn] ? '棚にある' : '＋ 追加') + '</span></button>';
    }).join('');
  }
  $('sq').addEventListener('input', renderMine);
  $('sForm').addEventListener('submit', function (e) {
    e.preventDefault();
    var q = $('sq').value.trim();
    if (!q) return;
    $('sq').blur();
    renderMine();
    if (!online()) { $('sNote').textContent = 'オフラインなのでネットの検索はできません。「手で入れる」なら登録できます。'; return; }
    $('sNote').textContent = '探しています…';
    searchTitle(q).then(function (list) {
      HITS = list; renderHits();
      $('sNote').textContent = list.length ? '見つかった本：' + list.length + '件（Google Books）。違う本しか無いときは「手で入れる」を使ってください。' : 'ネットでは見つかりませんでした。「手で入れる」で書名・著者だけ登録できます。';
    }, function () {
      $('sNote').textContent = '本のデータベースにつながりませんでした。少し待って試すか、「手で入れる」を使ってください。';
    });
  });
  $('scrSearch').addEventListener('click', function (e) {
    var t = e.target.closest('[data-hit],[data-mine]');
    if (!t) return;
    if (t.dataset.mine) { openBook(t.dataset.mine); return; }
    var x = HITS[+t.dataset.hit];
    if (!x) return;
    // ISBN があれば openBD の方が日本の本に詳しいので引き直す（だめなら検索結果のまま）
    if (x.isbn) {
      lookupIsbn(x.isbn).catch(function () { return null; }).then(function (b) {
        if (b && !b.cover) b.cover = x.cover;
        showNew(b || x, 'search');
      });
    } else showNew(x, 'search');
  });
  $('manualBtn').addEventListener('click', function () {
    $('manualForm').hidden = false; $('manualBtn').hidden = true;
    $('mTitle').value = $('sq').value.trim(); $('mTitle').focus();
  });
  $('manualForm').addEventListener('submit', function (e) {
    e.preventDefault();
    var title = $('mTitle').value.trim();
    if (!title) return;
    showNew({ title: title, author: $('mAuthor').value.trim() }, 'search');
    $('manualForm').hidden = true; $('manualBtn').hidden = false; $('mTitle').value = ''; $('mAuthor').value = '';
  });

  // ---------- ジャンルの管理 ----------
  var ICON = {
    up: '<svg viewBox="0 0 24 24"><path d="m6 15 6-6 6 6"/></svg>',
    edit: '<svg viewBox="0 0 24 24"><path d="M4 20h4L19 9l-4-4L4 16z"/></svg>',
    ok: '<svg viewBox="0 0 24 24"><path d="m5 12 5 5 9-10"/></svg>',
    del: '<svg viewBox="0 0 24 24"><path d="M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13"/></svg>'
  };
  function countIn(key) { return books().filter(function (b) { return gKey(b.data) === key; }).length; }
  function renderGenres() {
    var list = genres();
    var h = list.map(function (g, i) {
      var nm = S.editG === g.id ? '<form data-rename="' + esc(g.id) + '"><input id="gEdit" maxlength="14" value="' + esc(g.name) + '" aria-label="ジャンル名" required></form>' : esc(g.name);
      return '<div class="grow"><i style="background:' + gColor(g) + '"></i><span class="nm">' + nm + '</span><span class="ct">' + countIn(g.id) + '冊</span>' +
        '<button type="button" class="ibtn" data-up="' + i + '" aria-label="「' + esc(g.name) + '」を上へ"' + (i === 0 ? ' disabled' : '') + '>' + ICON.up + '</button>' +
        (S.editG === g.id ? '<button type="button" class="ibtn" data-gok="' + esc(g.id) + '" aria-label="決定" style="color:var(--red)">' + ICON.ok + '</button>'
          : '<button type="button" class="ibtn" data-gedit="' + esc(g.id) + '" aria-label="「' + esc(g.name) + '」の名前を変える">' + ICON.edit + '</button>') +
        '<button type="button" class="ibtn" data-gdel="' + esc(g.id) + '" aria-label="「' + esc(g.name) + '」を消す">' + ICON.del + '</button></div>';
    }).join('');
    h += '<div class="grow"><i style="background:var(--g5)"></i><span class="nm">未分類</span><span class="ct">' + countIn('') + '冊</span><span></span><span></span><span></span></div>';
    $('glist').innerHTML = h;
    var d = S.delG && genreOf(S.delG), n = d ? countIn(d.id) : 0;
    $('delAsk').innerHTML = d ? '<div class="sheet"><p>「' + esc(d.name) + '」を消しますか？' + (n ? 'この棚の' + n + '冊は「未分類」に移ります。本は消えません。' : '') + '</p>' +
      '<div class="row"><button type="button" class="btn pri" data-gdelok="1">消す</button><button type="button" class="btn" data-gdelno="1">やめる</button></div></div>' : '';
    var e = $('gEdit'); if (e) { e.focus(); e.select(); }
  }
  function renameGenre(id) {
    var el = $('gEdit'), v = el ? el.value.trim() : '';
    var list = genres().map(function (g) { return { id: g.id, name: g.name, c: g.c }; });
    var g = list.filter(function (x) { return x.id === id; })[0];
    S.editG = null;
    if (g && v && v !== g.name) {
      if (list.some(function (x) { return x.name === v && x.id !== id; })) { Apps.toast('「' + v + '」はもうあります', true); renderGenres(); return; }
      g.name = v;
      saveGenres(list).then(function () { Apps.toast('名前を「' + v + '」にしました'); });
    }
    renderGenres();
  }
  $('glist').addEventListener('submit', function (e) { e.preventDefault(); var f = e.target.closest('[data-rename]'); if (f) renameGenre(f.dataset.rename); });
  $('scrGenres').addEventListener('click', function (e) {
    var t = e.target.closest('button');
    if (!t) return;
    var ds = t.dataset, list = genres().slice();
    if (ds.up != null) {
      var i = +ds.up;
      if (i > 0) { var x = list[i]; list[i] = list[i - 1]; list[i - 1] = x; saveGenres(list); }
      return;
    }
    if (ds.gedit) { S.editG = ds.gedit; S.delG = null; renderGenres(); return; }
    if (ds.gok) { renameGenre(ds.gok); return; }
    if (ds.gdel) { S.delG = ds.gdel; S.editG = null; renderGenres(); return; }
    if (ds.gdelno) { S.delG = null; renderGenres(); return; }
    if (ds.gdelok) {
      var id = S.delG, name = gName(genreOf(id));
      S.delG = null;
      // 先に本を未分類へ移してから、ジャンルを消す
      var ops = books().filter(function (b) { return b.data.genre === id; }).map(function (b) { var d = copyData(b.data); d.genre = ''; return putBook(b, d); });
      Promise.all(ops).then(function () { return saveGenres(list.filter(function (g) { return g.id !== id; })); }).then(function () {
        if (S.g === id) S.g = '';
        Apps.toast('「' + name + '」を消しました' + (ops.length ? '（' + ops.length + '冊は未分類へ）' : ''));
      });
    }
  });
  $('gadd').addEventListener('submit', function (e) {
    e.preventDefault();
    var v = $('gname').value.trim();
    if (!v) return;
    if (genres().some(function (g) { return g.name === v; })) { Apps.toast('「' + v + '」はもうあります', true); return; }
    newGenre(v).then(function () { $('gname').value = ''; Apps.toast('「' + v + '」の棚を作りました'); });
  });

  // ---------- 同期 ----------
  function updatePending() {
    db.pendingCount().then(function (n) {
      $('pend').hidden = !n;
      $('pend').textContent = '送信待ち ' + n + '件';
    });
  }
  function syncNow(manual) {
    if (!Apps.isConnected(APP)) { Apps.ensureConnected(APP).then(function () { return syncNow(true); }); return Promise.resolve(); }
    $('syncBtn').classList.add('spin');
    return Promise.all([db.sync(), brain.sync().catch(function () { return null; })]).then(function (rs) {
      var r = rs[0];
      if (manual) Apps.toast(r.left ? '送信待ちが ' + r.left + '件 残っています' : '同期しました');
    }, function (e) {
      if (manual) Apps.toast(Apps.errorText(e), true);
    }).then(function () { $('syncBtn').classList.remove('spin'); updatePending(); });
  }
  $('syncBtn').addEventListener('click', function () { syncNow(true); });
  $('connBtn').addEventListener('click', function () { Apps.openConnectSheet(APP); });
  Apps.on('queue', updatePending);
  Apps.on('error', function (d) {
    if (d.during === 'flush' && d.id) Apps.toast(Apps.errorText(d.error), true);
  });

  db.onChange(function () {
    render();
    if (S.scr === 'search') { renderMine(); if (HITS.length) renderHits(); }
    updatePending();
  });
  brain.onChange(function () { if (S.scr === 'detail') renderDetail(); });

  // ?book=<id> で開いたら、その本の詳細へ（脳みその「本棚で開く」から）
  db.ready.then(function () {
    var id = null;
    try { id = new URLSearchParams(location.search).get('book'); } catch (e) { id = null; }
    if (id) {
      try { history.replaceState(null, '', location.pathname); } catch (e) { /* 無視 */ }
      S.sel = id; go('detail');
    }
  });
  window.addEventListener('pagehide', function () { saveMemo(); stopScan(); });
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden') { saveMemo(); if (S.scr === 'scan') stopScan(); }
    else if (S.scr === 'scan' && !S.nw && !SC.stream) startScan();
  });
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    if (!$('confirm').hidden) $('cfNo').click();
    else if (S.scr !== 'shelf') go('shelf');
  });

  render();
  Apps.ensureConnected(APP).then(function () { brain.sync().catch(function () {}); return db.sync(); }).catch(function () { /* 'error' で表示 */ });
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(function () {});
  window.__hondana = { toIsbn13: toIsbn13, cleanAuthor: cleanAuthor };
})();
