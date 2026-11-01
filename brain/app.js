/* 脳みそポートフォリオ — 技術・テイスト・素材などの知識を1件ずつ貯め、タグと手動リンクでつないでいく自分用の知識ベース。
 * 知識のレコード：data = { t:'k', kind:'D', no:1, title, body, tags:[], photos:[画像id], links:[知識id], uses:[{ name, date }] }
 *   - links は双方向として扱う（どちらか一方に書いてあれば「つながっている」）。編集で外したときは相手側からも外す
 *   - 番号は種類ごとの通し番号（D-001 …）。番号を振るのは脳みそだけ
 *   - ほかのアプリ（本棚・アーキマップ）は、そのアプリの中で no:null・createdIn:'hondana'|'archmap' のカードを直接 put する（shared/brainnote.js）。
 *     脳みそは読み込み・同期のたびに no が無いカードを見つけ、種類ごとに次の番号を作成日時順に振って put する（番号のあるカードは書き換えない）
 * 追加した種類：id 'kinds' のレコード data = { t:'kinds', list:[{ c:'P', name:'プレゼン' }] }
 *   - 最初から入っている種類（BASE_KINDS）と同じ記号が追加分にあっても、表示は最初からの方を使う（レコードは書き換えない）
 * 本のメモ（B）・ほかのアプリから作ったカードは出典を持てる：data.source = { bookId, title, author, cover, page }
 *   - bookId は本棚（app=hondana）の本の id。本棚の本の詳細には、source.bookId が一致するカードが並ぶ
 * アーキマップ（app=archmap）の建物も出典にできる：data.source = { spotId, title(建物名), place(住所・地名。あれば), cover(写真のhttps URL。あれば) }
 *   - spotId はアーキマップの記録の id。アーキマップの記録の編集画面には、source.spotId が一致するカードが並ぶ。ページ欄はない
 * 出典の「本棚で開く」「アーキマップで開く」は、ほかのアプリへ飛ばずに脳みその中のシートで出典の情報を見せる。
 *   そのために Apps.collection('hondana') と Apps.collection('archmap') を読むだけ使う（同期して控えを持つ。書き込みはしない）
 * 入口（PCのブラウザ用。主の導線は上のとおり各アプリの中で書く）：?new=<種類>&title=<下書き>&src=<出典のJSON>&back=<戻り先（相対URL）>&from=<元のアプリ名> で「知識を書く」を開く。番号は保存時にここで振る
 *       ?open=<知識id> でその知識の詳細を開く
 * 実績（ポートフォリオ）は別の種類のレコード（t:'w'）。知識の一覧・つながりの図・番号付けには混ざらない。中身は works.js の冒頭を参照
 *
 * 貼って取り込む（noteネタ・日記 → 脳みそ）：設定の「貼って取り込む」。クリップボード（読めなければ貼り付け欄）のテキストを読む
 *   1行目：#brain-import v1
 *   2行目以降：JSON 配列 [{ src:'note'|'diary', id:'<元の一意ID>', kind:'H'|'O'など, title, body, tags:[], date:'YYYY-MM-DD' }]
 *   - 1件ずつ知識カードとして put：{ t:'k', kind, no:null, title, body, tags, photos:[], links:[], uses:[], createdIn:'note'|'diary',
 *       source:{ title:'noteネタ'|'日記 YYYY-MM-DD', importId:'note:<id>'|'diary:<id>' } }。番号は上の番号付けに任せる
 *   - 同じ importId のカードが既にあれば飛ばす（2回目以降は新しい分だけ入る）
 *   - kind が無い・知らない記号なら H（ひらめき）。title が空なら body の1行目を使う。src・id が無いものは取り込まない
 */
(function () {
  'use strict';
  var APP = 'brain';
  var BASE_KINDS = [
    { c: 'D', name: 'ディテール' }, { c: 'T', name: 'テイスト' }, { c: 'M', name: '素材' },
    { c: 'L', name: '法規・申請' }, { c: 'S', name: '寸法' }, { c: 'B', name: '本のメモ' }, { c: 'H', name: 'ひらめき' },
    { c: 'O', name: 'ほか' }
  ];
  var KIND_HINT = {
    B: '例：暗がりがあるから金が映える', H: '思いついたことを1行で（例：玄関に一時置きの棚を必ず提案する）'
  };
  var HONDANA = '../hondana/';
  var ARCHMAP = '../archmap/';
  var KINDS_ID = 'kinds';
  var APP_NAMES = { hondana: '本棚', archmap: 'アーキマップ', note: 'noteネタから取り込み', diary: '日記から取り込み' };

  var db = Apps.collection(APP);
  var hondanaDb = Apps.collection('hondana'); // 本棚の控え（読むだけ）
  var archDb = Apps.collection('archmap');    // アーキマップの控え（読むだけ）
  var $ = function (id) { return document.getElementById(id); };
  var wide = window.matchMedia('(min-width: 960px)');

  var S = { view: 'list', sel: null, kind: '', tag: '', q: '', detailOpen: false, useOpen: false, back: '', from: '' };
  var ED = null; // 編集中：{ id, kind, photos:[{id}|{busy,key}], links:[], orig:{photos} , uploaded:[], source, entry }

  // ---------- 小物 ----------
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function pad3(n) { n = String(n || 0); while (n.length < 3) n = '0' + n; return n; }
  function today() {
    var d = new Date();
    return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);
  }
  function localDay(iso) {
    var d = new Date(iso);
    return isNaN(d) ? '' : d.getFullYear() + '.' + (d.getMonth() + 1) + '.' + d.getDate();
  }
  function uniq(a) { var s = {}, o = []; a.forEach(function (x) { if (x && !s[x]) { s[x] = 1; o.push(x); } }); return o; }
  function parseTags(s) {
    return uniq(String(s || '').split(/[\s,、，]+/).map(function (t) { return t.replace(/^#/, '').trim(); }).filter(Boolean));
  }
  function online() { return navigator.onLine !== false; }

  // ---------- データ ----------
  function items() { return db.all().filter(function (r) { return r.data && r.data.t === 'k'; }); }
  function byId(id) { var r = db.get(id); return r && r.data && r.data.t === 'k' ? r : null; }
  function isBase(c) { return BASE_KINDS.some(function (k) { return k.c === c; }); }
  // 保存されている追加分そのまま（保存し直すときはこちらを使い、記号が重なる分も消さない）
  function rawExtraKinds() { var r = db.get(KINDS_ID); return r && r.data && Array.isArray(r.data.list) ? r.data.list : []; }
  // 表示用：最初からの種類と同じ記号・重複は出さない
  function extraKinds() {
    var seen = {};
    return rawExtraKinds().filter(function (k) {
      if (!k || !k.c || isBase(k.c) || seen[k.c]) return false;
      seen[k.c] = 1; return true;
    });
  }
  function kinds() { return BASE_KINDS.concat(extraKinds()); }
  function kindOf(c) { return kinds().filter(function (k) { return k.c === c; })[0] || { c: c || 'O', name: c || 'ほか' }; }
  function kindColor(c) { return isBase(c) ? 'var(--k-' + c + ')' : 'var(--k-x)'; }
  // 出典（本など）
  function srcOf(d) { return d && d.source && typeof d.source === 'object' && (d.source.bookId || d.source.spotId || d.source.title) ? d.source : null; }
  // つながった出典（本棚の本・アーキマップの建物）か
  function linkedSrc(s) { return !!(s && (s.bookId || s.spotId || s.importId)); }
  // noteネタ・日記から取り込んだカードの出典
  function importSrc(s) { return !!(s && s.importId); }
  function safeUrl(u) { u = String(u || ''); return /^https:\/\//.test(u) ? u : ''; }
  function coverOf(d) { var s = srcOf(d); return s ? safeUrl(s.cover) : ''; }
  function srcLine(s) { return [s.title, s.spotId ? '' : s.page].filter(Boolean).join(' '); }
  // 同じ出典（同じ本・同じ建物）なら自動でつながる。戻り値は理由の言葉（なければ ''）
  function sameSrc(a, b) {
    var x = srcOf(a.data), y = srcOf(b.data);
    if (!x || !y) return '';
    if (x.bookId && x.bookId === y.bookId) return '同じ本';
    if (x.spotId && x.spotId === y.spotId) return '同じ建物';
    return '';
  }
  function sameBook(a, b) { return !!sameSrc(a, b); }
  function bookHref(s) { return HONDANA + '?book=' + encodeURIComponent(s.bookId); }
  function spotHref(s) { return ARCHMAP + '?spot=' + encodeURIComponent(s.spotId); }
  function hasNo(d) { return !!(d && typeof d.no === 'number' && d.no > 0); }
  function noStr(d) { return (d.kind || 'O') + '-' + (hasNo(d) ? pad3(d.no) : '（未採番）'); }
  function noShort(d) { return hasNo(d) ? pad3(d.no) : '—'; }
  function nextNo(kind) {
    var m = 0;
    items().forEach(function (r) { if (r.data.kind === kind && r.data.no > m) m = r.data.no; });
    return m + 1;
  }
  function usesOf(d) { return Array.isArray(d.uses) ? d.uses : []; }
  // 手動のつながり（双方向）
  function manualOf(id) {
    var r = byId(id), out = [];
    if (r) (r.data.links || []).forEach(function (x) { if (byId(x)) out.push(x); });
    items().forEach(function (o) { if (o.id !== id && (o.data.links || []).indexOf(id) >= 0) out.push(o.id); });
    return uniq(out);
  }
  function sharedTags(a, b) { var tb = b.data.tags || []; return (a.data.tags || []).filter(function (t) { return tb.indexOf(t) >= 0; }); }
  function autoOf(id) {
    var r = byId(id);
    if (!r) return [];
    var man = manualOf(id);
    return items().filter(function (o) { return o.id !== id && man.indexOf(o.id) < 0 && (sharedTags(r, o).length || sameBook(r, o)); })
      .map(function (o) { return { r: o, tags: sharedTags(r, o), book: sameSrc(r, o) }; })
      .sort(function (a, b) { return (b.tags.length + (b.book ? 1 : 0)) - (a.tags.length + (a.book ? 1 : 0)); });
  }
  function thumbHtml(r, size) {
    var d = r.data, p = (d.photos || [])[0];
    var st = ' style="--kc:' + kindColor(d.kind) + '"';
    if (p) return '<span class="thumb"' + st + '><img src="' + esc(Apps.imageUrl(p, size || 200)) + '" alt="" loading="lazy"></span>';
    var cv = coverOf(d);
    if (cv) return '<span class="thumb"' + st + '><img src="' + esc(cv) + '" alt="" loading="lazy" referrerpolicy="no-referrer"></span>';
    return '<span class="thumb"' + st + '>' + esc(d.kind) + '<br>' + esc(noShort(d)) + '</span>';
  }
  function put(r, data) { return db.put(data, r ? r.id : undefined); }
  function copyData(d) { return JSON.parse(JSON.stringify(d)); }

  // ---------- 絞り込み・一覧 ----------
  function filtered() {
    var q = S.q.trim().toLowerCase();
    return items().filter(function (r) {
      var d = r.data;
      if (S.kind && d.kind !== S.kind) return false;
      if (S.tag && (d.tags || []).indexOf(S.tag) < 0) return false;
      if (q) {
        var sc = srcOf(d) || {};
        var hay = [d.title, d.body, noStr(d), (d.tags || []).join(' '), kindOf(d.kind).name, sc.title, sc.author, sc.place,
          usesOf(d).map(function (u) { return u.name; }).join(' ')].join('\n').toLowerCase();
        if (q.split(/\s+/).some(function (w) { return hay.indexOf(w) < 0; })) return false;
      }
      return true;
    }).sort(function (a, b) {
      // 種類の並び → 番号の新しい順
      var ka = kinds().map(function (k) { return k.c; });
      var x = ka.indexOf(a.data.kind) - ka.indexOf(b.data.kind);
      return x || (b.data.no || 0) - (a.data.no || 0);
    });
  }
  function renderFilters() {
    var all = items();
    var cnt = {};
    all.forEach(function (r) { cnt[r.data.kind] = (cnt[r.data.kind] || 0) + 1; });
    var kh = '<button type="button" class="chip' + (!S.kind ? ' on' : '') + '" data-kind="">すべて<span class="n">' + all.length + '</span></button>';
    kinds().forEach(function (k) {
      kh += '<button type="button" class="chip' + (S.kind === k.c ? ' on' : '') + '" data-kind="' + esc(k.c) + '"><i style="background:' + kindColor(k.c) + '"></i>' +
        esc(k.name) + '<span class="n">' + (cnt[k.c] || 0) + '</span></button>';
    });
    $('kinds').innerHTML = kh;
    var tc = {};
    all.forEach(function (r) { if (!S.kind || r.data.kind === S.kind) (r.data.tags || []).forEach(function (t) { tc[t] = (tc[t] || 0) + 1; }); });
    var tags = Object.keys(tc).sort(function (a, b) { return tc[b] - tc[a] || (a < b ? -1 : 1); });
    if (S.tag && tags.indexOf(S.tag) < 0) tags.unshift(S.tag);
    $('tags').innerHTML = tags.map(function (t) {
      return '<button type="button" class="chip' + (S.tag === t ? ' on' : '') + '" data-tag="' + esc(t) + '">#' + esc(t) + '</button>';
    }).join('');
    $('tags').hidden = !tags.length;
  }
  function renderList() {
    var all = items(), list = filtered();
    $('emptyList').hidden = all.length > 0;
    $('paneList').querySelector('.filters').hidden = !all.length;
    $('noHit').hidden = !all.length || list.length > 0;
    $('list').innerHTML = list.map(function (r) {
      var d = r.data;
      return '<button type="button" class="item' + (S.sel === r.id ? ' sel' : '') + '" data-id="' + esc(r.id) + '">' + thumbHtml(r) +
        '<span style="min-width:0"><span class="t">' + esc(d.title) + (r.pending ? '<span class="wait">送信待ち</span>' : '') + '</span>' +
        '<span class="m" style="--kc:' + kindColor(d.kind) + '"><span class="no">' + esc(noStr(d)) + '</span>' + esc(srcOf(d) ? srcLine(srcOf(d)) : kindOf(d.kind).name) +
        ((d.tags || []).length ? ' ・ ' + esc(d.tags.map(function (t) { return '#' + t; }).join(' ')) : '') + '</span></span>' +
        '<span class="uses"><b>' + usesOf(d).length + '</b>回</span></button>';
    }).join('');
  }

  // ---------- 詳細 ----------
  function relItem(r, why, cls) {
    return '<button type="button" class="rel-item" data-go="' + esc(r.id) + '">' + thumbHtml(r, 120) +
      '<span class="rt"><span class="no" style="--kc:' + kindColor(r.data.kind) + '">' + esc(noStr(r.data)) + '</span>' + esc(r.data.title) + '</span>' +
      '<span class="why ' + cls + '">' + esc(why) + '</span></button>';
  }
  function renderDetail() {
    var r = S.sel && byId(S.sel);
    $('app').classList.toggle('has-sel', !!r);
    if (!r) { $('detail').innerHTML = ''; if (S.detailOpen) closeDetail(); return; }
    var d = r.data, k = kindOf(d.kind);
    var man = manualOf(r.id).map(byId).filter(Boolean), au = autoOf(r.id).slice(0, 8);
    var uses = usesOf(d);
    var projects = uniq([].concat.apply([], items().map(function (o) { return usesOf(o.data).map(function (u) { return u.name; }); }))
      .concat(window.BrainWorks ? BrainWorks.names() : []));
    var h = '<div class="dt-head" style="--kc:' + kindColor(d.kind) + '"><span class="kindlabel"><b>' + esc(k.name) + '</b><span class="no">' + esc(noStr(d)) + '</span></span>' +
      '<h2>' + esc(d.title) + '</h2>' +
      ((d.tags || []).length ? '<div class="tagrow">' + d.tags.map(function (t) { return '<button type="button" class="tag" data-tagjump="' + esc(t) + '">#' + esc(t) + '</button>'; }).join('') + '</div>' : '') +
      '</div>';
    var sc = srcOf(d);
    if (sc) h += '<div><span class="lab">出典</span>' + srcCard(sc, true) + '</div>';
    if ((d.photos || []).length) {
      h += '<div class="gallery">' + d.photos.map(function (p) {
        return '<button type="button" data-photo="' + esc(p) + '" aria-label="写真を大きく見る"><img src="' + esc(Apps.imageUrl(p, 900)) + '" alt="" loading="lazy"></button>';
      }).join('') + '</div>';
    }
    h += '<div><span class="lab">メモ</span>' + (d.body ? '<p class="memo">' + esc(d.body) + '</p>' : '<p class="memo none">まだ本文はありません。「編集」から書けます。</p>') + '</div>';
    h += '<div><span class="lab">使った案件 ' + uses.length + '件</span>';
    if (uses.length) {
      h += '<div class="uselog">' + uses.map(function (u, i) { return { u: u, i: i }; }).reverse().map(function (x) {
        return '<div><span>' + esc(x.u.name) + '</span><span class="d">' + esc((x.u.date || '').replace(/-/g, '.')) + '</span>' +
          '<button type="button" class="x" data-unuse="' + x.i + '" aria-label="この記録を消す">×</button></div>';
      }).join('') + '</div>';
    }
    if (S.useOpen) {
      h += '<form class="use-form" id="useForm"><input class="ax-input" id="u-name" list="projList" placeholder="案件名（例：M邸）" required maxlength="60" autocomplete="off">' +
        '<input class="ax-input" id="u-date" type="date" value="' + today() + '" aria-label="使った日">' +
        '<button class="ax-btn ax-btn-primary" type="submit">記録</button></form>' +
        '<datalist id="projList">' + projects.map(function (p) { return '<option value="' + esc(p) + '">'; }).join('') + '</datalist>';
    } else {
      h += '<button type="button" class="ax-btn ax-btn-primary btn-use" id="useBtn">この知識を使う</button>';
    }
    h += '</div>';
    h += '<div><span class="lab">つながる知識</span><div class="rel">' +
      man.map(function (o) { return relItem(o, '手動', 'man'); }).join('') +
      au.map(function (x) { return relItem(x.r, x.tags.length ? '#' + x.tags[0] : x.book, 'auto'); }).join('') +
      (!man.length && !au.length ? '<p class="rel-none">まだつながりはありません。同じタグを付けるか、手動でつなげます。</p>' : '') +
      '<button type="button" class="ax-btn" id="dtLink">＋ 手動でつなぐ</button></div></div>';
    h += '<p class="dt-foot">作成 ' + esc(localDay(r.createdAt)) + (APP_NAMES[d.createdIn] ? '（' + APP_NAMES[d.createdIn] + 'で）' : '') + ' ・ 更新 ' + esc(localDay(r.updatedAt)) + (r.pending ? ' ・ 送信待ち' : '') + '</p>';
    if (S.back) h = '<a class="ax-btn ax-btn-primary back-app" href="' + esc(S.back) + '">‹ ' + esc(S.from) + 'に戻る</a>' + h;
    $('detail').innerHTML = h;
  }
  // 出典の札（本の表紙・書名・著者・ページ）。本棚の本なら「本棚で開く」、アーキマップの建物なら「アーキマップで開く」
  // （どちらも押すと脳みその中のシートで出典を見せる。ほかのアプリへは飛ばない）
  function srcCard(s, link) {
    var cv = safeUrl(s.cover);
    if (importSrc(s)) {
      return '<div class="src imp"><span class="cover" aria-hidden="true"><span class="ic">' + (/^diary:/.test(s.importId) ? '日' : 'n') + '</span></span>' +
        '<span class="si"><b>' + esc(s.title || '取り込み') + '</b><small>' + (/^diary:/.test(s.importId) ? '日記' : 'noteネタ') + 'から取り込み</small></span></div>';
    }
    if (s.spotId) {
      var ph = '<span class="cover" aria-hidden="true">' + (cv ? '<img src="' + esc(cv) + '" alt="" loading="lazy" referrerpolicy="no-referrer">' : '<span class="pin"></span>') + '</span>';
      var si = ph + '<span class="si"><b>' + esc(s.title || '（名称なし）') + '</b><small>' + esc(s.place || (link ? 'アーキマップの建物' : '')) + '</small></span>';
      if (link) return '<button type="button" class="src spot" data-srcopen="1">' + si + '<span class="go">アーキマップで開く ›</span></button>';
      return '<div class="src spot">' + si + '<span class="go">アーキマップの建物</span></div>';
    }
    var cover = '<span class="cover" aria-hidden="true">' + (cv ? '<img src="' + esc(cv) + '" alt="" loading="lazy" referrerpolicy="no-referrer">' : '<span class="vt">' + esc(s.title || '') + '</span>') + '</span>';
    var inner = cover + '<span class="si"><b>' + esc(s.title || '（書名なし）') + '</b><small>' + esc([s.author, s.page].filter(Boolean).join('　')) + '</small></span>';
    if (link && s.bookId) return '<button type="button" class="src" data-srcopen="1">' + inner + '<span class="go">本棚で開く ›</span></button>';
    return '<div class="src">' + inner + (s.bookId ? '<span class="go">本棚の本</span>' : '') + '</div>';
  }

  // ---------- 出典のシート（本棚の本・アーキマップの建物を、脳みその中で見せる） ----------
  function stars(n) { n = Math.max(0, Math.min(5, +n || 0)); return n ? '★★★★★'.slice(0, n) + '<span class="off">' + '★★★★★'.slice(n) + '</span>' : ''; }
  function openSrcSheet(s) {
    if (!s) return;
    var h = '', href = '', name = '';
    if (s.spotId) {
      name = 'アーキマップ'; href = spotHref(s);
      var sp = archDb.get(s.spotId), sd = sp && sp.data;
      var photo = sd && (sd.photos || []).filter(function (p) { return p && p.pub; })[0] || sd && (sd.photos || [])[0];
      var pic = photo && photo.id ? Apps.imageUrl(photo.id, 900) : safeUrl(s.cover);
      h += '<div class="ss-spot">' + (pic ? '<img class="ss-photo" src="' + esc(pic) + '" alt="" referrerpolicy="no-referrer">' : '') +
        '<h3>' + esc((sd && sd.name) || s.title || '（名称なし）') + '</h3>';
      if (sd) {
        var sub = [sd.architect, sd.visited ? String(sd.visited).replace(/-/g, '.') + ' 訪問' : ''].filter(Boolean).join(' ・ ');
        if (sub) h += '<p class="ss-sub">' + esc(sub) + '</p>';
        if (sd.one) h += '<p class="ss-memo">' + esc(sd.one) + '</p>';
        if (typeof sd.lat === 'number' && typeof sd.lng === 'number') {
          h += '<a class="ax-btn ss-map" target="_blank" rel="noopener" href="https://www.google.com/maps/search/?api=1&query=' + (+sd.lat) + ',' + (+sd.lng) + '">Googleマップで場所を見る</a>';
        }
      }
    } else if (s.bookId) {
      name = '本棚'; href = bookHref(s);
      var bk = hondanaDb.get(s.bookId), bd = bk && bk.data;
      var cv = safeUrl((bd && bd.cover) || s.cover);
      h += '<div class="ss-book">' + '<span class="cover" aria-hidden="true">' + (cv ? '<img src="' + esc(cv) + '" alt="" referrerpolicy="no-referrer">' : '<span class="vt">' + esc(s.title || '') + '</span>') + '</span>' +
        '<div><h3>' + esc((bd && bd.title) || s.title || '（書名なし）') + '</h3><p class="ss-sub">' + esc([(bd && bd.author) || s.author, bd && bd.publisher].filter(Boolean).join('　')) + '</p>';
      if (bd) {
        h += '<p class="ss-st"><span class="st">' + (bd.status === 'done' ? '読んだ' + (bd.doneOn ? '（' + esc(String(bd.doneOn).replace(/-/g, '.')) + '）' : '') : '読みたい') + '</span>' +
          (bd.rating ? '<span class="ss-stars" aria-label="★' + (+bd.rating) + '">' + stars(bd.rating) + '</span>' : '') + '</p>';
      }
      h += '</div></div>';
      if (bd && bd.memo) h += '<p class="ss-memo"><span class="lab">ひとことメモ</span>' + esc(bd.memo) + '</p>';
      if (s.page) h += '<p class="ss-sub">このメモのページ：' + esc(s.page) + '</p>';
    } else return;
    var known = s.spotId ? archDb.get(s.spotId) : hondanaDb.get(s.bookId);
    if (!known) h += '<p class="ax-note">' + esc(name) + 'の控えがまだこの端末にありません。カードに残っている情報だけ出しています（同期すると詳しく出ます）。</p>';
    if (s.spotId) h += '</div>';
    h += '<div class="ax-row"><button class="ax-btn ax-btn-primary" type="button" data-ssclose="1">閉じる</button></div>' +
      '<a class="ss-open" href="' + esc(href) + '">' + esc(name) + 'をブラウザで開く ›</a>';
    $('ssTitle').textContent = s.spotId ? '出典の建物' : '出典の本';
    $('ssBody').innerHTML = h;
    $('srcSheet').hidden = false;
  }
  $('srcSheet').addEventListener('click', function (e) {
    if (e.target === $('srcSheet') || e.target.closest('[data-ssclose]')) $('srcSheet').hidden = true;
  });
  function openDetail(id) {
    S.sel = id; S.useOpen = false;
    if (!wide.matches) { S.detailOpen = true; $('app').classList.add('detail-open'); }
    render();
    $('detail').scrollTop = 0;
  }
  function closeDetail() { S.detailOpen = false; S.useOpen = false; $('app').classList.remove('detail-open'); }

  $('detail').addEventListener('click', function (e) {
    var t = e.target.closest('button');
    if (!t) return;
    var r = byId(S.sel);
    if (!r) return;
    if (t.dataset.go) { openDetail(t.dataset.go); graph.focus(t.dataset.go); return; }
    if (t.dataset.srcopen) { openSrcSheet(srcOf(r.data)); return; }
    if (t.dataset.tagjump) { S.tag = t.dataset.tagjump; S.kind = ''; closeDetail(); setView('list'); render(); return; }
    if (t.dataset.photo) { $('lbImg').src = Apps.imageUrl(t.dataset.photo, 1600); $('lightbox').hidden = false; return; }
    if (t.id === 'useBtn') { S.useOpen = true; renderDetail(); var u = $('u-name'); if (u) u.focus(); return; }
    if (t.dataset.unuse != null) {
      var d = copyData(r.data); d.uses = usesOf(d); d.uses.splice(+t.dataset.unuse, 1);
      put(r, d); return;
    }
    if (t.id === 'dtLink') {
      $('pkTitle').textContent = 'つなぐ知識を選ぶ';
      openPicker(r.id, manualOf(r.id), function (other, on) { setLink(r.id, other, on); });
    }
  });
  $('detail').addEventListener('submit', function (e) {
    if (e.target.id !== 'useForm') return;
    e.preventDefault();
    var r = byId(S.sel), name = $('u-name').value.trim();
    if (!r || !name) return;
    var d = copyData(r.data); d.uses = usesOf(d);
    d.uses.push({ name: name, date: $('u-date').value || today() });
    S.useOpen = false;
    put(r, d).then(function () { Apps.toast('「' + name + '」で使ったと記録しました'); });
  });
  $('dtBack').addEventListener('click', function () { closeDetail(); });
  $('dtEdit').addEventListener('click', function () { if (S.sel) openEditor(S.sel); });
  $('lbClose').addEventListener('click', function () { $('lightbox').hidden = true; $('lbImg').removeAttribute('src'); });
  $('lightbox').addEventListener('click', function (e) { if (e.target === $('lightbox')) $('lbClose').click(); });

  // つながりを付ける・外す（双方向。外すときは両側から）
  function setLink(a, b, on) {
    var ra = byId(a), rb = byId(b);
    if (!ra || !rb || a === b) return Promise.resolve();
    var ops = [];
    if (on) {
      if (manualOf(a).indexOf(b) >= 0) return Promise.resolve();
      var d = copyData(ra.data); d.links = uniq((d.links || []).concat([b]));
      ops.push(put(ra, d));
    } else {
      [[ra, b], [rb, a]].forEach(function (p) {
        var ls = p[0].data.links || [];
        if (ls.indexOf(p[1]) >= 0) {
          var dd = copyData(p[0].data); dd.links = ls.filter(function (x) { return x !== p[1]; });
          ops.push(put(p[0], dd));
        }
      });
    }
    return Promise.all(ops);
  }

  // ---------- つなぐ知識を選ぶ ----------
  var PK = null;
  function openPicker(selfId, current, onToggle) {
    PK = { self: selfId, set: current.slice(), onToggle: onToggle };
    $('pkQ').value = '';
    renderPicker();
    $('picker').hidden = false;
  }
  function renderPicker() {
    var q = $('pkQ').value.trim().toLowerCase();
    var list = items().filter(function (r) {
      if (r.id === PK.self) return false;
      return !q || (r.data.title + ' ' + noStr(r.data) + ' ' + (r.data.tags || []).join(' ')).toLowerCase().indexOf(q) >= 0;
    });
    $('pkList').innerHTML = list.length ? list.map(function (r) {
      return '<label class="pk-row"><input type="checkbox" data-pk="' + esc(r.id) + '"' + (PK.set.indexOf(r.id) >= 0 ? ' checked' : '') + '>' + thumbHtml(r, 100) +
        '<span class="rt"><span class="no" style="--kc:' + kindColor(r.data.kind) + '">' + esc(noStr(r.data)) + '</span>' + esc(r.data.title) + '</span></label>';
    }).join('') : '<p class="ax-note">つなげる知識がまだありません。</p>';
  }
  $('pkQ').addEventListener('input', renderPicker);
  $('pkList').addEventListener('change', function (e) {
    var id = e.target.dataset.pk;
    if (!id) return;
    var on = e.target.checked;
    PK.set = on ? uniq(PK.set.concat([id])) : PK.set.filter(function (x) { return x !== id; });
    PK.onToggle(id, on);
  });
  $('pkClose').addEventListener('click', function () { $('picker').hidden = true; PK = null; });

  // ---------- 編集 ----------
  // entry：ほかのアプリから開いたときの下書き { kind, title, source }
  function openEditor(id, entry) {
    var r = id && byId(id);
    var d = r ? r.data : { kind: (entry && entry.kind) || S.kind || 'D', title: (entry && entry.title) || '', body: '', tags: S.tag && !entry ? [S.tag] : [], photos: [], links: [],
      source: entry && entry.source };
    var sc = srcOf(d);
    ED = { id: r ? r.id : null, kind: d.kind, photos: (d.photos || []).map(function (p) { return { id: p }; }),
      links: r ? manualOf(r.id) : [], orig: (d.photos || []).slice(), uploaded: [], busy: 0,
      source: sc ? copyData(sc) : null, entry: !!entry };
    $('edFrom').hidden = !entry;
    if (entry) $('edFromText').textContent = (S.from || '元のアプリ') + 'から開きました。' + (sc ? '種類と出典は入れてあります' : '種類は選んであります');
    $('f-page').value = sc && sc.page || '';
    $('f-srcTitle').value = sc && !linkedSrc(sc) ? sc.title || '' : '';
    $('edTitle').textContent = r ? '知識を編集' : '知識を書く';
    $('f-title').value = d.title || '';
    $('f-body').value = d.body || '';
    $('f-tags').value = (d.tags || []).join(' ');
    $('edDelete').hidden = !r;
    renderEdKinds(); renderEdPhotos(); renderEdLinks(); renderTagSug();
    $('editor').hidden = false;
    $('editor').querySelector('.ed-body').scrollTop = 0;
    if (!r) setTimeout(function () { $('f-title').focus(); }, 50);
  }
  // 出典欄：本のメモか、出典つきで開いたときだけ出す
  function renderEdSrc() {
    var show = ED.kind === 'B' || !!ED.source;
    $('edSrcFld').hidden = !show;
    if (!show) return;
    var linked = linkedSrc(ED.source), spot = !!(ED.source && ED.source.spotId), imp = importSrc(ED.source);
    $('edSrcLab').textContent = spot ? '出典（建物）' : imp ? '出典（取り込み）' : '出典（本）';
    $('edSrc').innerHTML = linked ? srcCard(ED.source, false) +
      '<button type="button" class="ax-btn ax-btn-ghost src-x" id="edSrcX">出典を外す</button>' : '';
    $('srcManual').hidden = !!linked;
    $('srcPage').hidden = spot || imp; // ページは本だけ
  }
  function renderEdKinds() {
    $('edKinds').innerHTML = kinds().map(function (k) {
      return '<button type="button" role="radio" aria-checked="' + (ED.kind === k.c) + '" class="chip' + (ED.kind === k.c ? ' on' : '') +
        '" style="--kc:' + kindColor(k.c) + '" data-edkind="' + esc(k.c) + '">' + esc(k.name) + '</button>';
    }).join('');
    $('f-title').placeholder = KIND_HINT[ED.kind] || '例：框なし引戸の納まり';
    $('f-title').setAttribute('aria-label', ED.kind === 'H' ? 'ひらめき（1行でよい）' : 'タイトル');
    $('edTitleLab').textContent = ED.kind === 'H' ? 'ひらめき（1行でよい）' : 'タイトル';
    renderEdSrc();
    var r = ED.id && byId(ED.id);
    var keep = r && r.data.kind === ED.kind && hasNo(r.data);
    var no = keep ? r.data.no : nextNo(ED.kind);
    $('edNo').textContent = '番号：' + ED.kind + '-' + pad3(no) + (r && hasNo(r.data) && r.data.kind !== ED.kind ? '（種類を変えると番号も振り直します）' : '');
  }
  function renderEdPhotos() {
    $('edPhotos').innerHTML = ED.photos.map(function (p, i) {
      if (p.busy) return '<div class="ph busy">保存中…</div>';
      return '<div class="ph"><img src="' + esc(Apps.imageUrl(p.id, 300)) + '" alt="">' + (i === 0 ? '<span class="first">図の点</span>' : '') +
        '<button type="button" class="rm" data-rmph="' + i + '" aria-label="この写真を外す">×</button></div>';
    }).join('');
  }
  function renderEdLinks() {
    $('edLinks').innerHTML = ED.links.map(byId).filter(Boolean).map(function (r) {
      return '<div class="rel-item">' + thumbHtml(r, 100) + '<span class="rt"><span class="no" style="--kc:' + kindColor(r.data.kind) + '">' + esc(noStr(r.data)) + '</span>' + esc(r.data.title) + '</span>' +
        '<button type="button" class="x" data-rmlink="' + esc(r.id) + '" aria-label="つながりを外す">×</button></div>';
    }).join('');
  }
  function renderTagSug() {
    var cur = parseTags($('f-tags').value), tc = {};
    items().forEach(function (r) { (r.data.tags || []).forEach(function (t) { tc[t] = (tc[t] || 0) + 1; }); });
    var sug = Object.keys(tc).filter(function (t) { return cur.indexOf(t) < 0; }).sort(function (a, b) { return tc[b] - tc[a]; }).slice(0, 16);
    $('edTagSug').innerHTML = sug.map(function (t) { return '<button type="button" class="chip" data-addtag="' + esc(t) + '">＋' + esc(t) + '</button>'; }).join('');
  }
  $('f-tags').addEventListener('input', renderTagSug);
  $('edTagSug').addEventListener('click', function (e) {
    var t = e.target.closest('[data-addtag]');
    if (!t) return;
    $('f-tags').value = parseTags($('f-tags').value).concat([t.dataset.addtag]).join(' ') + ' ';
    renderTagSug();
  });
  $('edKinds').addEventListener('click', function (e) {
    var t = e.target.closest('[data-edkind]');
    if (t) { ED.kind = t.dataset.edkind; renderEdKinds(); }
  });
  $('edSrc').addEventListener('click', function (e) {
    if (e.target.closest('#edSrcX')) { ED.source = null; renderEdSrc(); }
  });
  $('edPhotos').addEventListener('click', function (e) {
    var t = e.target.closest('[data-rmph]');
    if (t) { ED.photos.splice(+t.dataset.rmph, 1); renderEdPhotos(); }
  });
  $('edLinks').addEventListener('click', function (e) {
    var t = e.target.closest('[data-rmlink]');
    if (t) { ED.links = ED.links.filter(function (x) { return x !== t.dataset.rmlink; }); renderEdLinks(); }
  });
  $('edAddLink').addEventListener('click', function () {
    $('pkTitle').textContent = 'つなぐ知識を選ぶ';
    openPicker(ED.id, ED.links, function (id, on) {
      ED.links = on ? uniq(ED.links.concat([id])) : ED.links.filter(function (x) { return x !== id; });
      renderEdLinks();
    });
  });
  $('f-photo').addEventListener('change', function () {
    var files = Array.prototype.slice.call(this.files || []);
    this.value = '';
    if (!files.length) return;
    if (!online()) { Apps.toast(Apps.errorText('offline').replace('つながったら自動で送ります', '写真はつながってから追加してください'), true); return; }
    var ed = ED;
    files.forEach(function (f) {
      var slot = { busy: true };
      ed.photos.push(slot); ed.busy++;
      renderEdPhotos();
      Apps.uploadImage(APP, f).then(function (img) {
        slot.busy = false; slot.id = img.id; ed.uploaded.push(img.id);
      }, function (e) {
        ed.photos.splice(ed.photos.indexOf(slot), 1);
        Apps.toast('写真を保存できませんでした：' + Apps.errorText(e), true);
      }).then(function () { ed.busy--; if (ED === ed) renderEdPhotos(); });
    });
  });
  function closeEditor(saved) {
    if (ED && !saved) {
      // 保存せずに閉じた：今回あげた写真は片付ける
      ED.uploaded.forEach(function (p) { Apps.deleteImage(APP, p).catch(function () {}); });
    }
    ED = null;
    $('editor').hidden = true;
  }
  $('edCancel').addEventListener('click', function () { closeEditor(false); });
  $('edForm').addEventListener('submit', function (e) {
    e.preventDefault();
    if (!ED) return;
    if (ED.busy) { Apps.toast('写真の保存が終わるまでお待ちください'); return; }
    var title = $('f-title').value.trim();
    if (!title) { $('f-title').focus(); return; }
    var old = ED.id && byId(ED.id);
    var d = old ? copyData(old.data) : { t: 'k', uses: [] };
    d.t = 'k';
    if (!old || old.data.kind !== ED.kind || !hasNo(old.data)) d.no = nextNo(ED.kind);
    d.kind = ED.kind;
    d.title = title;
    d.body = $('f-body').value.replace(/\s+$/, '');
    d.tags = parseTags($('f-tags').value);
    d.photos = ED.photos.filter(function (p) { return p.id; }).map(function (p) { return p.id; });
    d.links = ED.links.filter(function (x) { return byId(x); });
    d.uses = usesOf(d);
    // 出典：本棚の本はそのまま＋ページ、アーキマップの建物はそのまま、手入れなら書名＋ページ
    if (!$('edSrcFld').hidden) {
      var page = $('f-page').value.trim().slice(0, 30);
      var src = linkedSrc(ED.source) ? copyData(ED.source) : { title: $('f-srcTitle').value.trim().slice(0, 120) };
      if (!src.spotId && !src.importId) src.page = page;
      if (!src.page) delete src.page;
      if (src.bookId || src.spotId || src.title) d.source = src; else delete d.source;
    } else if (!ED.source) delete d.source;
    var fromEntry = ED.entry;
    var removed = ED.orig.filter(function (p) { return d.photos.indexOf(p) < 0; });
    closeEditor(true);
    put(old, d).then(function (rec) {
      // 外したつながりは相手側からも外す
      var ops = [];
      if (old) {
        items().forEach(function (o) {
          if (o.id !== rec.id && (o.data.links || []).indexOf(rec.id) >= 0 && d.links.indexOf(o.id) < 0) {
            var od = copyData(o.data); od.links = od.links.filter(function (x) { return x !== rec.id; });
            ops.push(put(o, od));
          }
        });
      }
      removed.forEach(function (p) { Apps.deleteImage(APP, p).catch(function () {}); });
      return Promise.all(ops).then(function () {
        Apps.toast(old ? '保存しました' : noStr(d) + ' を貯めました' + (fromEntry && S.back ? '（' + S.from + 'に戻れます）' : ''));
        openDetail(rec.id);
        graph.focus(rec.id);
      });
    }, function (err) { Apps.toast(Apps.errorText(err), true); });
  });
  $('edDelete').addEventListener('click', function () {
    var r = ED && byId(ED.id);
    if (!r) return;
    $('cfOk').textContent = '削除する'; $('cfOk').className = 'ax-btn ax-btn-danger'; ASK = null;
    $('cfTitle').textContent = '「' + r.data.title + '」を削除しますか？';
    $('cfText').textContent = '写真・使った案件の記録・つながりも消えます。元に戻せません。';
    $('confirm').hidden = false;
    $('cfOk').onclick = function () {
      $('confirm').hidden = true;
      var id = r.id, photos = (r.data.photos || []).slice();
      closeEditor(true);
      var ops = [db.remove(id)];
      items().forEach(function (o) {
        if ((o.data.links || []).indexOf(id) >= 0) {
          var od = copyData(o.data); od.links = od.links.filter(function (x) { return x !== id; });
          ops.push(put(o, od));
        }
      });
      photos.forEach(function (p) { Apps.deleteImage(APP, p).catch(function () {}); });
      S.sel = null; closeDetail();
      Promise.all(ops).then(function () { Apps.toast('削除しました'); });
    };
  });
  $('cfNo').addEventListener('click', function () { $('confirm').hidden = true; if (ASK) { var f = ASK; ASK = null; f(false); } });
  // はい／いいえの確認（削除以外にも使う）。Promise<boolean>
  var ASK = null;
  function ask(title, text, okLabel, danger) {
    return new Promise(function (resolve) {
      $('cfTitle').textContent = title; $('cfText').textContent = text || '';
      $('cfOk').textContent = okLabel || 'はい'; $('cfOk').className = 'ax-btn ' + (danger ? 'ax-btn-danger' : 'ax-btn-primary');
      ASK = resolve;
      $('cfOk').onclick = function () { $('confirm').hidden = true; ASK = null; resolve(true); };
      $('confirm').hidden = false;
    });
  }

  // ---------- 設定（種類の追加・接続） ----------
  function renderSettings() {
    var cnt = {};
    items().forEach(function (r) { cnt[r.data.kind] = (cnt[r.data.kind] || 0) + 1; });
    $('stKinds').innerHTML = kinds().map(function (k) {
      var extra = !isBase(k.c);
      return '<div><i style="background:' + kindColor(k.c) + '"></i><span class="no" style="--kc:' + kindColor(k.c) + '">' + esc(k.c) + '-</span><span style="flex:1">' + esc(k.name) +
        '</span><span class="ax-note">' + (cnt[k.c] || 0) + '件</span>' +
        (extra && !cnt[k.c] ? '<button type="button" class="ax-btn ax-btn-ghost" data-rmkind="' + esc(k.c) + '">外す</button>' : '') + '</div>';
    }).join('');
  }
  function saveExtraKinds(list) { return db.put({ t: 'kinds', list: list }, KINDS_ID); }
  $('settingsBtn').addEventListener('click', function () { renderSettings(); $('settings').hidden = false; });
  $('stClose').addEventListener('click', function () { $('settings').hidden = true; });
  $('stConn').addEventListener('click', function () { $('settings').hidden = true; Apps.openConnectSheet(APP); });
  $('stImport').addEventListener('click', function () { $('settings').hidden = true; openImport(); });
  $('stExport').addEventListener('click', function () { $('settings').hidden = true; if (window.BrainWorks) BrainWorks.openExport(); });

  // ---------- 貼って取り込む（noteネタ・日記 → 知識カード） ----------
  var IMPORT_HEAD = '#brain-import v1';
  var IM = null; // 読み取った結果 { items:[…], skipped }
  function str(v, n) { return typeof v === 'string' ? v.slice(0, n) : typeof v === 'number' ? String(v).slice(0, n) : ''; }
  // テキスト → { ok, error, items:[{ importId, src, kind, title, body, tags, date, dup }], skipped }
  function parseImport(text) {
    text = String(text || '').replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').trim();
    if (!text) return { ok: false, error: '' };
    var nl = text.indexOf('\n');
    var head = (nl < 0 ? text : text.slice(0, nl)).trim();
    if (head !== IMPORT_HEAD) return { ok: false, error: '1行目が「' + IMPORT_HEAD + '」ではありません。noteネタ・日記の「脳みそへまとめて書き出す」でコピーしたものを貼ってください' };
    var arr;
    try { arr = JSON.parse(nl < 0 ? '' : text.slice(nl + 1)); } catch (e) { return { ok: false, error: '2行目以降が読めません（JSON の形が崩れています）' }; }
    if (!Array.isArray(arr)) return { ok: false, error: '2行目以降が一覧（JSON の配列）ではありません' };
    var have = {};
    items().forEach(function (r) { var sc = r.data.source; if (sc && sc.importId) have[sc.importId] = 1; });
    var seen = {}, out = [], skipped = 0;
    arr.slice(0, 1000).forEach(function (x) {
      if (!x || typeof x !== 'object') { skipped++; return; }
      var src = x.src === 'note' || x.src === 'diary' ? x.src : '';
      var id = str(x.id, 120).trim();
      var body = str(x.body, 20000).replace(/\s+$/, '');
      var title = str(x.title, 120).trim() || body.split('\n')[0].trim().slice(0, 120);
      if (!src || !id || !title) { skipped++; return; }
      var importId = src + ':' + id;
      if (seen[importId]) return;
      seen[importId] = 1;
      var kind = str(x.kind, 4).trim().toUpperCase();
      if (!kinds().some(function (k) { return k.c === kind; })) kind = 'H';
      var date = /^\d{4}-\d{2}-\d{2}$/.test(str(x.date, 10)) ? x.date : '';
      out.push({ importId: importId, src: src, kind: kind, title: title, body: body, date: date,
        tags: parseTags(Array.isArray(x.tags) ? x.tags.map(function (t) { return str(t, 40); }).join(' ') : str(x.tags, 400)), dup: !!have[importId] });
    });
    return { ok: true, items: out, skipped: skipped };
  }
  function importCard(x) {
    return { t: 'k', kind: x.kind, no: null, title: x.title, body: x.body, tags: x.tags, photos: [], links: [], uses: [], createdIn: x.src,
      source: { title: x.src === 'diary' ? '日記' + (x.date ? ' ' + x.date : '') : 'noteネタ', importId: x.importId } };
  }
  function renderImport() {
    var r = parseImport($('imText').value);
    IM = r.ok ? r : null;
    var fresh = r.ok ? r.items.filter(function (x) { return !x.dup; }) : [];
    $('imMsg').className = 'ax-note' + (r.ok || !r.error ? '' : ' im-err');
    $('imMsg').textContent = r.ok ? r.items.length + '件（新規 ' + fresh.length + '件・取り込み済み ' + (r.items.length - fresh.length) + '件）' +
      (r.skipped ? '・読めない ' + r.skipped + '件は飛ばします' : '') : r.error;
    $('imList').innerHTML = r.ok ? r.items.map(function (x) {
      return '<div class="im-row' + (x.dup ? ' dup' : '') + '"><span class="no" style="--kc:' + kindColor(x.kind) + '">' + esc(x.kind) + '</span>' +
        '<span class="rt">' + esc(x.title) + '<small>' + (x.src === 'diary' ? '日記' : 'noteネタ') + (x.date ? ' ' + esc(x.date) : '') + '</small></span>' +
        '<span class="im-st">' + (x.dup ? '取り込み済み' : '新規') + '</span></div>';
    }).join('') : '';
    $('imGo').disabled = !fresh.length;
    $('imGo').textContent = fresh.length ? fresh.length + '件を取り込む' : '取り込む';
  }
  function openImport() {
    $('imText').value = ''; IM = null; renderImport();
    $('importSheet').hidden = false;
  }
  $('imRead').addEventListener('click', function () {
    if (!navigator.clipboard || !navigator.clipboard.readText) { $('imText').focus(); Apps.toast('下の欄に貼り付けてください'); return; }
    navigator.clipboard.readText().then(function (t) {
      $('imText').value = t || ''; renderImport();
      if (!t) Apps.toast('クリップボードが空でした', true);
    }, function () { $('imText').focus(); Apps.toast('クリップボードを読めませんでした。下の欄に貼り付けてください', true); });
  });
  $('imText').addEventListener('input', renderImport);
  $('imClose').addEventListener('click', function () { $('importSheet').hidden = true; });
  $('imGo').addEventListener('click', function () {
    if (!IM) return;
    // 取り込む直前にもう一度、既にあるかを見る（同期で増えた分も飛ばす）
    var r = parseImport($('imText').value);
    var fresh = r.ok ? r.items.filter(function (x) { return !x.dup; }) : [];
    if (!fresh.length) { renderImport(); return; }
    $('imGo').disabled = true;
    Promise.all(fresh.map(function (x) { return db.put(importCard(x)); })).then(function () {
      $('importSheet').hidden = true;
      Apps.toast(fresh.length + '件を知識に取り込みました（番号は自動で付きます）');
      S.kind = ''; S.tag = ''; setView('list'); render();
    }, function (e) { Apps.toast(Apps.errorText(e), true); renderImport(); });
  });
  window.__brainImport = { parse: parseImport };
  $('stAdd').addEventListener('submit', function (e) {
    e.preventDefault();
    var c = $('st-code').value.trim().toUpperCase(), name = $('st-name').value.trim();
    if (!/^[A-Z]{1,2}$/.test(c) || !name) { Apps.toast('記号は英字1〜2文字で入れてください', true); return; }
    if (kinds().some(function (k) { return k.c === c; })) { Apps.toast('記号「' + c + '」はもう使っています', true); return; }
    saveExtraKinds(rawExtraKinds().concat([{ c: c, name: name }])).then(function () {
      $('st-code').value = ''; $('st-name').value = '';
      renderSettings(); Apps.toast('種類「' + name + '」を追加しました');
    });
  });
  $('stKinds').addEventListener('click', function (e) {
    var t = e.target.closest('[data-rmkind]');
    if (t) saveExtraKinds(rawExtraKinds().filter(function (k) { return k.c !== t.dataset.rmkind; })).then(renderSettings);
  });

  // ---------- つながりの図 ----------
  var graph = (function () {
    var cv = $('graph'), ctx = cv.getContext('2d');
    var W = 0, H = 0, DPR = 1;
    var nodes = {}, list = [], edges = [], adj = {};
    var view = { s: 1, x: 0, y: 0 }, fitted = false, touched = false;
    var alpha = 0, raf = 0;
    var imgs = {};
    var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    var colors = {};

    function readColors() {
      var cs = getComputedStyle(document.documentElement);
      ['--ink', '--mute', '--red', '--paper', '--line', '--bg', '--on-red'].forEach(function (k) { colors[k] = cs.getPropertyValue(k).trim(); });
      kinds().forEach(function (k) {
        var v = isBase(k.c) ? '--k-' + k.c : '--k-x';
        colors['k' + k.c] = cs.getPropertyValue(v).trim();
      });
    }
    // 点の絵：写真の1枚目。なければ出典の本の表紙
    function img(src) {
      if (imgs[src]) return imgs[src];
      var im = new Image();
      im.referrerPolicy = 'no-referrer';
      im.onload = function () { request(); };
      im.src = src;
      imgs[src] = im;
      return im;
    }
    function picOf(d) { var p = (d.photos || [])[0]; return p ? Apps.imageUrl(p, 200) : coverOf(d); }
    function radius(n) { return 16 + Math.min(usesOf(n.r.data).length, 12) * 2.2; }

    function setData(recs) {
      var keep = {};
      list = recs.map(function (r) {
        var n = nodes[r.id];
        if (!n) {
          // 新しい点は、つながる点の近く（なければ中心まわり）に置く
          var near = (r.data.links || []).map(function (x) { return nodes[x]; }).filter(Boolean)[0];
          var a = Math.random() * Math.PI * 2, d = near ? 60 : 40 + Math.random() * 120;
          n = { id: r.id, x: (near ? near.x : 0) + Math.cos(a) * d, y: (near ? near.y : 0) + Math.sin(a) * d, vx: 0, vy: 0 };
          nodes[r.id] = n;
        }
        n.r = r; keep[r.id] = 1;
        return n;
      });
      Object.keys(nodes).forEach(function (id) { if (!keep[id]) delete nodes[id]; });
      edges = []; adj = {};
      var seen = {};
      function add(a, b, man, w) {
        var k = a < b ? a + '|' + b : b + '|' + a;
        if (seen[k]) { if (man) { seen[k].man = true; } return; }
        var e = { a: nodes[a], b: nodes[b], man: man, w: w };
        seen[k] = e; edges.push(e);
        (adj[a] = adj[a] || {})[b] = 1; (adj[b] = adj[b] || {})[a] = 1;
      }
      list.forEach(function (n) { (n.r.data.links || []).forEach(function (x) { if (nodes[x] && x !== n.id) add(n.id, x, true, 1); }); });
      for (var i = 0; i < list.length; i++) for (var j = i + 1; j < list.length; j++) {
        var s = sharedTags(list[i].r, list[j].r).length + (sameBook(list[i].r, list[j].r) ? 1 : 0);
        if (s) add(list[i].id, list[j].id, false, s);
      }
      cv.dataset.nodes = list.length;
      cv.dataset.edges = edges.length;
      cv.dataset.manual = edges.filter(function (e) { return e.man; }).length;
      heat(0.9);
    }
    function heat(a) {
      alpha = Math.max(alpha, a);
      if (reduce) { while (alpha > 0.01) step(); if (!touched) fit(); draw(); return; }
      if (!raf) raf = requestAnimationFrame(loop);
    }
    function step() {
      var n = list.length, i, j, a, b, dx, dy, d2, d, f;
      for (i = 0; i < n; i++) { a = list[i]; a.vx -= a.x * 0.012 * alpha; a.vy -= a.y * 0.012 * alpha; }
      for (i = 0; i < n; i++) for (j = i + 1; j < n; j++) {
        a = list[i]; b = list[j]; dx = a.x - b.x; dy = a.y - b.y; d2 = dx * dx + dy * dy;
        if (d2 < 1) { dx = Math.random() - 0.5; dy = Math.random() - 0.5; d2 = 1; }
        d = Math.sqrt(d2); f = Math.min(2600 / d2, 30) * alpha;
        a.vx += dx / d * f; a.vy += dy / d * f; b.vx -= dx / d * f; b.vy -= dy / d * f;
      }
      edges.forEach(function (e) {
        dx = e.b.x - e.a.x; dy = e.b.y - e.a.y; d = Math.sqrt(dx * dx + dy * dy) || 1;
        var L = e.man ? 95 : 150, k = (e.man ? 0.06 : 0.012 * Math.min(e.w, 3)) * (d - L) * alpha;
        e.a.vx += dx / d * k; e.a.vy += dy / d * k; e.b.vx -= dx / d * k; e.b.vy -= dy / d * k;
      });
      for (i = 0; i < n; i++) {
        a = list[i];
        if (a === drag.node) { a.vx = a.vy = 0; continue; }
        a.vx *= 0.6; a.vy *= 0.6; a.x += a.vx; a.y += a.vy;
      }
      alpha *= 0.985;
    }
    function loop() {
      raf = 0;
      step();
      if (!touched && alpha > 0.05) fit();
      draw();
      if (alpha > 0.01) raf = requestAnimationFrame(loop);
    }
    var pendingDraw = 0;
    function request() { if (!pendingDraw && !raf) pendingDraw = requestAnimationFrame(function () { pendingDraw = 0; draw(); }); }
    function resize() {
      var r = cv.getBoundingClientRect();
      DPR = window.devicePixelRatio || 1;
      W = r.width; H = r.height;
      if (!W || !H) return;
      cv.width = Math.round(W * DPR); cv.height = Math.round(H * DPR);
      if (!touched) fit();
      draw();
    }
    function toScreen(n) { return [W / 2 + view.x + n.x * view.s, H / 2 + view.y + n.y * view.s]; }
    function toWorld(x, y) { return [(x - W / 2 - view.x) / view.s, (y - H / 2 - view.y) / view.s]; }
    function fit() {
      if (!list.length || !W) return;
      var x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
      list.forEach(function (n) { var r = radius(n); x0 = Math.min(x0, n.x - r); x1 = Math.max(x1, n.x + r); y0 = Math.min(y0, n.y - r); y1 = Math.max(y1, n.y + r + 18); });
      var padT = wide.matches ? 40 : 70, padB = 80;
      var s = Math.min(1.6, (W - 60) / Math.max(1, x1 - x0), (H - padT - padB) / Math.max(1, y1 - y0));
      view.s = Math.max(0.15, s);
      view.x = -((x0 + x1) / 2) * view.s;
      view.y = -((y0 + y1) / 2) * view.s + (padT - padB) / 2;
      fitted = true;
    }
    function label(n, x, y, r, isSel) {
      var t = n.r.data.title;
      ctx.font = (isSel ? '700 12px ' : '400 11px ') + getComputedStyle(document.body).fontFamily;
      ctx.textAlign = 'center'; ctx.textBaseline = 'top';
      if (!isSel && t.length > 12) t = t.slice(0, 12) + '…';
      if (isSel) {
        var w = ctx.measureText(t).width + 12;
        ctx.fillStyle = colors['--red']; ctx.fillRect(x - w / 2, y + r + 5, w, 18);
        ctx.fillStyle = colors['--on-red']; ctx.fillText(t, x, y + r + 8);
      } else {
        ctx.fillStyle = colors['--mute']; ctx.fillText(t, x, y + r + 5);
      }
    }
    function draw() {
      if (!W || !H) return;
      readColors();
      ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
      ctx.clearRect(0, 0, W, H);
      var sel = S.sel && nodes[S.sel] ? S.sel : null, near = sel ? adj[sel] || {} : null;
      edges.forEach(function (e) {
        var on = sel && (e.a.id === sel || e.b.id === sel);
        var p = toScreen(e.a), q = toScreen(e.b);
        ctx.beginPath(); ctx.moveTo(p[0], p[1]); ctx.lineTo(q[0], q[1]);
        if (e.man) { ctx.setLineDash([]); ctx.strokeStyle = on ? colors['--red'] : colors['--ink']; ctx.globalAlpha = on ? 1 : sel ? 0.25 : 0.55; ctx.lineWidth = on ? 2.2 : 1.4; }
        else { ctx.setLineDash([3, 4]); ctx.strokeStyle = on ? colors['--red'] : colors['--mute']; ctx.globalAlpha = on ? 0.85 : sel ? 0.12 : 0.35; ctx.lineWidth = 1; }
        ctx.stroke();
      });
      ctx.setLineDash([]);
      var drawn = 0;
      var showAll = view.s >= 1.15 || list.length <= 10;
      var order = list.slice().sort(function (a, b) { return (a.id === sel) - (b.id === sel); });
      order.forEach(function (n) {
        var p = toScreen(n), isSel = n.id === sel, r = radius(n) * view.s * (isSel ? 1.2 : 1);
        r = Math.max(r, 7);
        if (p[0] < -r - 80 || p[0] > W + r + 80 || p[1] < -r - 40 || p[1] > H + r + 40) { n.sx = p[0]; n.sy = p[1]; n.sr = r; return; }
        var dim = sel && !isSel && !near[n.id];
        ctx.globalAlpha = dim ? 0.35 : 1;
        var kc = colors['k' + n.r.data.kind] || colors['--mute'];
        ctx.save();
        ctx.beginPath(); ctx.arc(p[0], p[1], r, 0, Math.PI * 2);
        ctx.fillStyle = colors['--paper']; ctx.fill(); ctx.clip();
        var ph = picOf(n.r.data), im = ph && img(ph);
        if (im && im.complete && im.naturalWidth) {
          var iw = im.naturalWidth, ih = im.naturalHeight, sc = Math.max(2 * r / iw, 2 * r / ih);
          ctx.drawImage(im, p[0] - iw * sc / 2, p[1] - ih * sc / 2, iw * sc, ih * sc);
        } else {
          ctx.fillStyle = kc; ctx.globalAlpha = (dim ? 0.35 : 1) * 0.16; ctx.fillRect(p[0] - r, p[1] - r, 2 * r, 2 * r);
          ctx.globalAlpha = dim ? 0.35 : 1;
          if (r > 12) {
            ctx.fillStyle = kc; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
            ctx.font = '500 ' + Math.round(Math.min(13, r * 0.5)) + 'px ' + getComputedStyle(document.body).fontFamily;
            ctx.fillText(n.r.data.kind + '-' + noShort(n.r.data), p[0], p[1]);
          }
        }
        ctx.restore();
        ctx.beginPath(); ctx.arc(p[0], p[1], r, 0, Math.PI * 2);
        ctx.lineWidth = isSel ? 3 : 1.6; ctx.strokeStyle = isSel ? colors['--red'] : kc; ctx.stroke();
        if (isSel || (!dim && (showAll || (near && near[n.id])))) label(n, p[0], p[1], r, isSel);
        n.sx = p[0]; n.sy = p[1]; n.sr = r;
        drawn++;
      });
      ctx.globalAlpha = 1;
      cv.dataset.drawn = drawn;
    }
    function hit(x, y) {
      var best = null, bd = Infinity;
      list.forEach(function (n) { var d = Math.hypot(n.sx - x, n.sy - y); if (d < n.sr + 8 && d < bd) { bd = d; best = n; } });
      return best;
    }
    function zoomAt(f, x, y) {
      var w = toWorld(x, y);
      view.s = Math.max(0.15, Math.min(4, view.s * f));
      view.x = x - W / 2 - w[0] * view.s; view.y = y - H / 2 - w[1] * view.s;
      touched = true; draw();
    }
    // 指・マウス：1本で移動（点の上ならその点を動かす）、2本でピンチ、ホイールで拡大縮小
    var ptrs = {}, drag = { node: null, moved: false, sx: 0, sy: 0, pinch: null };
    function pos(e) { var r = cv.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; }
    cv.addEventListener('pointerdown', function (e) {
      try { cv.setPointerCapture(e.pointerId); } catch (x) { /* 合成イベントなど */ }
      var p = pos(e);
      ptrs[e.pointerId] = p;
      var ids = Object.keys(ptrs);
      if (ids.length === 1) {
        drag.node = hit(p[0], p[1]); drag.moved = false; drag.sx = p[0]; drag.sy = p[1]; drag.last = p;
      } else if (ids.length === 2) {
        var a = ptrs[ids[0]], b = ptrs[ids[1]];
        drag.node = null; drag.moved = true;
        drag.pinch = { d: Math.hypot(a[0] - b[0], a[1] - b[1]), s: view.s, mid: toWorld((a[0] + b[0]) / 2, (a[1] + b[1]) / 2) };
      }
    });
    cv.addEventListener('pointermove', function (e) {
      if (!ptrs[e.pointerId]) return;
      var p = pos(e);
      ptrs[e.pointerId] = p;
      var ids = Object.keys(ptrs);
      if (ids.length >= 2 && drag.pinch) {
        var a = ptrs[ids[0]], b = ptrs[ids[1]];
        var d = Math.hypot(a[0] - b[0], a[1] - b[1]);
        view.s = Math.max(0.15, Math.min(4, drag.pinch.s * d / Math.max(1, drag.pinch.d)));
        var mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
        view.x = mx - W / 2 - drag.pinch.mid[0] * view.s; view.y = my - H / 2 - drag.pinch.mid[1] * view.s;
        touched = true; draw(); return;
      }
      if (!drag.moved && Math.hypot(p[0] - drag.sx, p[1] - drag.sy) < 6) return;
      drag.moved = true; cv.classList.add('drag');
      if (drag.node) {
        var w = toWorld(p[0], p[1]); drag.node.x = w[0]; drag.node.y = w[1];
        touched = true; heat(0.3); draw();
      } else {
        view.x += p[0] - drag.last[0]; view.y += p[1] - drag.last[1];
        touched = true; draw();
      }
      drag.last = p;
    });
    function up(e) {
      if (!ptrs[e.pointerId]) return;
      var p = ptrs[e.pointerId];
      delete ptrs[e.pointerId];
      var left = Object.keys(ptrs);
      if (left.length) { drag.pinch = null; drag.last = ptrs[left[0]]; return; }
      cv.classList.remove('drag');
      if (!drag.moved && e.type === 'pointerup') {
        var n = hit(p[0], p[1]);
        onTap(n ? n.id : null);
      }
      drag.node = null; drag.pinch = null;
    }
    cv.addEventListener('pointerup', up);
    cv.addEventListener('pointercancel', up);
    cv.addEventListener('wheel', function (e) {
      e.preventDefault();
      var p = pos(e);
      zoomAt(Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015)), p[0], p[1]);
    }, { passive: false });
    $('gFit').addEventListener('click', function () { touched = false; fit(); draw(); });
    $('gIn').addEventListener('click', function () { zoomAt(1.3, W / 2, H / 2); });
    $('gOut').addEventListener('click', function () { zoomAt(1 / 1.3, W / 2, H / 2); });
    if (window.ResizeObserver) new ResizeObserver(resize).observe(cv); else window.addEventListener('resize', resize);
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', draw);

    var onTap = function () {};
    return {
      setData: setData, draw: draw, resize: resize,
      onTap: function (fn) { onTap = fn; },
      // 選んだ点が画面の外なら、見える位置まで寄せる
      focus: function (id) {
        var n = nodes[id];
        if (!n || !W) return;
        var p = toScreen(n);
        if (p[0] < 40 || p[0] > W - 40 || p[1] < 60 || p[1] > H - 80) {
          view.x -= p[0] - W / 2; view.y -= p[1] - H / 2; draw();
        }
      },
      _state: function () { return { view: view, nodes: list.map(function (n) { return { id: n.id, x: n.sx, y: n.sy, r: n.sr }; }) }; }
    };
  })();
  window.__brain = { graph: graph };
  // 実績（works.js）に渡す部品
  window.BrainCore = {
    APP: APP, db: db, S: S, wide: wide, $: $,
    esc: esc, uniq: uniq, today: today, localDay: localDay, copyData: copyData, online: online, kindOf: kindOf, kindColor: kindColor,
    items: items, byId: byId, noStr: noStr, usesOf: usesOf, ask: ask, setView: setView,
    openPicker: function (title, current, onToggle) { $('pkTitle').textContent = title; openPicker(null, current, onToggle); },
    // 知識の詳細を開く（PCでは知識の画面へ切り替える）
    showCard: function (id) { if (wide.matches) setView('list'); openDetail(id); graph.focus(id); },
    lightbox: function (url) { $('lbImg').src = url; $('lightbox').hidden = false; }
  };

  graph.onTap(function (id) {
    S.sel = id;
    if (wide.matches) { S.useOpen = false; render(); return; }
    renderPeek(); graph.draw(); renderList();
  });
  function renderPeek() {
    var r = S.sel && byId(S.sel);
    var pk = $('peek');
    if (!r || wide.matches) { pk.hidden = true; return; }
    pk.innerHTML = thumbHtml(r, 120) + '<span class="pt">' + esc(r.data.title) + '<small>' + esc(noStr(r.data)) + ' ・ 使った ' + usesOf(r.data).length + '回 ・ つながり ' +
      (manualOf(r.id).length + autoOf(r.id).length) + '件</small></span><span class="go">詳細 ›</span>';
    pk.hidden = false;
  }
  $('peek').addEventListener('click', function () { if (S.sel) openDetail(S.sel); });

  // ---------- 画面の切り替え ----------
  function setView(v) {
    S.view = v;
    $('app').dataset.view = v;
    Array.prototype.forEach.call(document.querySelectorAll('#tabbar [data-view]'), function (b) { b.classList.toggle('on', b.dataset.view === v); });
    Array.prototype.forEach.call(document.querySelectorAll('#modeSw [data-view]'), function (b) {
      var on = (b.dataset.view === 'works') === (v === 'works');
      b.classList.toggle('on', on); b.setAttribute('aria-pressed', on);
    });
    var tn = document.querySelector('#tabbar .tab-new');
    tn.setAttribute('aria-label', v === 'works' ? '実績をささっと作る' : '知識を書く');
    if (v === 'graph' || v === 'list') setTimeout(graph.resize, 0);
    if (window.BrainWorks) BrainWorks.render();
  }
  function render() {
    renderFilters(); renderList(); renderDetail(); renderPeek();
    var all = items();
    $('emptyGraph').hidden = all.length > 0;
    graph.draw();
  }
  $('tabbar').addEventListener('click', function (e) {
    var b = e.target.closest('[data-view]');
    if (b) setView(b.dataset.view);
  });
  $('modeSw').addEventListener('click', function (e) {
    var b = e.target.closest('[data-view]');
    if (b) setView(b.dataset.view);
  });
  // ＋：実績タブにいる時は「ささっと作る」
  Array.prototype.forEach.call(document.querySelectorAll('[data-new]'), function (b) {
    b.addEventListener('click', function () {
      if (S.view === 'works' && window.BrainWorks) BrainWorks.quick(); else openEditor(null);
    });
  });
  $('kinds').addEventListener('click', function (e) {
    var b = e.target.closest('[data-kind]');
    if (!b) return;
    S.kind = b.dataset.kind; S.tag = ''; render();
  });
  $('tags').addEventListener('click', function (e) {
    var b = e.target.closest('[data-tag]');
    if (!b) return;
    S.tag = S.tag === b.dataset.tag ? '' : b.dataset.tag; render();
  });
  $('q').addEventListener('input', function () { S.q = this.value; renderList(); });
  $('list').addEventListener('click', function (e) {
    var b = e.target.closest('[data-id]');
    if (b) { openDetail(b.dataset.id); graph.focus(b.dataset.id); }
  });
  wide.addEventListener('change', function () {
    if (wide.matches) closeDetail();
    if (window.BrainWorks) BrainWorks.onWide();
    setTimeout(function () { graph.resize(); render(); }, 0);
  });
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    if (!$('lightbox').hidden) $('lbClose').click();
    else if (!$('confirm').hidden) $('cfNo').click();
    else if (!$('importSheet').hidden) $('imClose').click();
    else if (!$('srcSheet').hidden) $('srcSheet').hidden = true;
    else if (!$('picker').hidden) $('pkClose').click();
    else if (window.BrainWorks && BrainWorks.onEscape()) return;
    else if (!$('confirm').hidden) $('cfNo').click();
    else if (!$('settings').hidden) $('stClose').click();
    else if (!$('editor').hidden) closeEditor(false);
    else if (S.detailOpen) closeDetail();
    else if (window.BrainWorks) BrainWorks.closeWork();
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
    hondanaDb.sync().catch(function () {}); archDb.sync().catch(function () {});
    return syncBrain().then(function (r) {
      if (manual) Apps.toast(r.left ? '送信待ちが ' + r.left + '件 残っています' : '同期しました');
    }, function (e) {
      if (manual) Apps.toast(Apps.errorText(e), true);
    }).then(function () { $('syncBtn').classList.remove('spin'); updatePending(); });
  }
  $('syncBtn').addEventListener('click', function () { syncNow(true); });
  Apps.on('queue', updatePending);
  Apps.on('error', function (d) {
    if (d.during === 'flush' && d.id) Apps.toast(Apps.errorText(d.error), true);
  });

  // ---------- 番号を振る（ほかのアプリで作った no の無いカード） ----------
  // 種類ごとに、今ある最大の番号の次から、作成日時の古い順に振る。番号のあるカードは触らない。
  // つながっている端末では、最初の同期が終わってから振る（別の端末で振った番号と重ならないように）
  var firstSyncDone = false, numbering = false, numTimer = 0;
  function syncBrain() {
    return db.sync().then(function (r) { firstSyncDone = true; assignNumbers(); return r; },
      function (e) { firstSyncDone = true; assignNumbers(); throw e; });
  }
  function assignNumbers() {
    if (numbering) return Promise.resolve(0);
    if (!firstSyncDone && Apps.isConnected(APP) && online()) return Promise.resolve(0);
    var todo = items().filter(function (r) { return !hasNo(r.data); })
      .sort(function (a, b) { return String(a.createdAt).localeCompare(String(b.createdAt)) || (a.id < b.id ? -1 : 1); });
    if (!todo.length) return Promise.resolve(0);
    numbering = true;
    var next = {};
    var ops = todo.map(function (r) {
      var k = r.data.kind || 'O';
      if (!next[k]) next[k] = nextNo(k);
      var d = copyData(r.data); d.no = next[k]++; if (!d.kind) d.kind = k;
      return db.put(d, r.id);
    });
    return Promise.all(ops).then(function () { numbering = false; return ops.length; }, function () { numbering = false; return 0; });
  }
  function scheduleNumbers() { clearTimeout(numTimer); numTimer = setTimeout(assignNumbers, 50); }
  window.__brain.assignNumbers = assignNumbers;

  db.onChange(function () {
    scheduleNumbers();
    graph.setData(items());
    if (S.sel && !byId(S.sel)) S.sel = null;
    render();
    updatePending();
    if (ED) { renderEdLinks(); }
    if (PK) renderPicker();
  });

  // ---------- ほかのアプリからの入口 ----------
  function safeBack(u) {
    u = String(u || '');
    // 同じサイトの中の相対パスだけ（外のサイトへは戻さない）
    return /^(\.\.\/|\/(?!\/))[^:\\]*$/.test(u) && u.length < 600 ? u : '';
  }
  function readEntry() {
    var P;
    try { P = new URLSearchParams(location.search); } catch (e) { return; }
    var kind = P.get('new'), open = P.get('open');
    if (!kind && !open) return;
    S.back = safeBack(P.get('back'));
    S.from = (P.get('from') || '').slice(0, 12) || (/hondana/.test(S.back) ? '本棚' : /archmap/.test(S.back) ? 'アーキマップ' : '元のアプリ');
    if (S.from === '建築map') S.from = 'アーキマップ'; // 前の版のリンク
    var src = null;
    try { src = JSON.parse(P.get('src') || 'null'); } catch (e) { src = null; }
    if (src && typeof src === 'object') {
      var s2 = {};
      ['bookId', 'spotId', 'title', 'author', 'place', 'cover', 'page'].forEach(function (k) { if (src[k] != null && src[k] !== '') s2[k] = String(src[k]).slice(0, k === 'cover' ? 500 : 160); });
      if (s2.cover && !safeUrl(s2.cover)) delete s2.cover;
      if (s2.spotId) { delete s2.bookId; delete s2.page; delete s2.author; } // 建物の出典は本の項目を持たない
      src = s2.bookId || s2.spotId || s2.title ? s2 : null;
    } else src = null;
    var title = (P.get('title') || '').slice(0, 120);
    // 再読み込みでもう一度開かないよう、URL からは消す（戻り先は覚えておく）
    try { history.replaceState(null, '', location.pathname); } catch (e) { /* 無視 */ }
    if (S.back) { $('fromBar').hidden = false; $('fromText').textContent = S.from + 'から開きました'; $('fromBack').href = S.back; $('fromBack').textContent = S.from + 'に戻る ›'; }
    db.ready.then(function () {
      if (open) { if (byId(open)) { openDetail(open); graph.focus(open); } else Apps.toast('その知識はまだこの端末にありません（同期してみてください）', true); return; }
      if (!kinds().some(function (k) { return k.c === kind; })) kind = 'O';
      openEditor(null, { kind: kind, title: title, source: src });
    });
  }
  readEntry();

  setView('list');
  Apps.ensureConnected(APP).then(function () {
    hondanaDb.sync().catch(function () {}); archDb.sync().catch(function () {});
    return syncBrain();
  }).catch(function () { /* 'error' で表示 */ });
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(function () {});
})();
