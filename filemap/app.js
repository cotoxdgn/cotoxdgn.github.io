/* 仕事ファイルの地図：建物用途・業務の種類ごとの「項目」（3段まで）に、目的・ゴールのチェック・ファイルへのリンクをまとめる。
 * ファイル自体は持たず、Googleドライブ等のURLだけを保存する。
 * レコード：{ type:'item', name, parent, purpose, goals:[{id,text,done}], color, order }
 *          { type:'link', url, name, memo, kind, items:[項目id…], star } … 1つのリンクを複数の項目に置ける */
(function () {
  'use strict';
  var APP = 'filemap';
  var MAX_DEPTH = 3;
  var COLORS = ['pink', 'mint', 'sky', 'sun', 'lilac'];
  var KINDS = {
    doc: { label: 'ドキュメント', mark: '文' },
    sheet: { label: 'スプレッドシート', mark: '表' },
    slide: { label: 'スライド', mark: 'ス' },
    pdf: { label: 'PDF', mark: 'PDF' },
    folder: { label: 'フォルダ', mark: '箱' },
    other: { label: 'その他', mark: '他' }
  };
  var KIND_ORDER = ['doc', 'sheet', 'pdf', 'folder', 'slide', 'other'];

  var db = Apps.collection(APP);
  var $ = function (id) { return document.getElementById(id); };
  var S = { items: {}, links: [], open: {}, q: '', editGoals: false };

  try { S.open = JSON.parse(localStorage.getItem('filemap.open') || '{}') || {}; } catch (e) { S.open = {}; }
  function saveOpen() { try { localStorage.setItem('filemap.open', JSON.stringify(S.open)); } catch (e) { /* 無視 */ } }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // ---------- URL から種類を推定 ----------
  function guessKind(url) {
    var u = String(url || '').trim().toLowerCase();
    if (!u) return null;
    if (/docs\.google\.com\/document\//.test(u)) return 'doc';
    if (/docs\.google\.com\/spreadsheets\//.test(u)) return 'sheet';
    if (/docs\.google\.com\/presentation\//.test(u)) return 'slide';
    if (/drive\.google\.com\/(drive\/(u\/\d+\/)?folders\/|folderview|embeddedfolderview)/.test(u)) return 'folder';
    if (/\.pdf($|[?#])/.test(u)) return 'pdf';
    if (/\.(xlsx?|csv)($|[?#])/.test(u)) return 'sheet';
    if (/\.(docx?|txt)($|[?#])/.test(u)) return 'doc';
    if (/\.(pptx?)($|[?#])/.test(u)) return 'slide';
    if (/drive\.google\.com\/(file\/d\/|open\?id=)/.test(u)) return 'pdf'; // ドライブに置いたファイル（多くはPDF）。違えば手で変える
    return 'other';
  }
  function validUrl(u) { return /^https?:\/\/\S+$/i.test(String(u || '').trim()); }

  // ---------- データ ----------
  function load(list) {
    var items = {}, links = [];
    list.forEach(function (r) {
      var d = r.data || {};
      if (d.type === 'item') items[r.id] = { id: r.id, d: d, rec: r };
      else if (d.type === 'link') links.push({ id: r.id, d: d, rec: r });
    });
    S.items = items;
    S.links = links;
  }
  function itemList() {
    return Object.keys(S.items).map(function (k) { return S.items[k]; }).sort(function (a, b) {
      return (a.d.order || 0) - (b.d.order || 0) || (a.rec.createdAt < b.rec.createdAt ? -1 : 1);
    });
  }
  function parentOf(it) { return it && it.d.parent && S.items[it.d.parent] ? S.items[it.d.parent] : null; }
  function children(pid) { return itemList().filter(function (it) { return (parentOf(it) ? it.d.parent : null) === (pid || null); }); }
  function path(it) { var p = []; while (it) { p.unshift(it); it = parentOf(it); } return p; }
  function depth(it) { return path(it).length; }
  function height(it) { var h = 1; children(it.id).forEach(function (c) { h = Math.max(h, 1 + height(c)); }); return h; }
  function descendants(it) { var out = []; children(it.id).forEach(function (c) { out.push(c); out = out.concat(descendants(c)); }); return out; }
  function colorOf(it) { var top = path(it)[0]; return COLORS.indexOf(top && top.d.color) >= 0 ? top.d.color : 'pink'; }
  function initial(name) { return Array.from(String(name || '？').trim())[0] || '？'; }
  function linksIn(id) { return S.links.filter(function (l) { return (l.d.items || []).indexOf(id) >= 0; }); }
  function countIn(it) {
    var ids = [it.id].concat(descendants(it).map(function (x) { return x.id; }));
    return S.links.filter(function (l) { return (l.d.items || []).some(function (i) { return ids.indexOf(i) >= 0; }); }).length;
  }
  function latest(id) { var r = db.get(id); return r ? r.data : null; } // put 直後の値も含めた最新
  function putItem(it, patch) {
    if (typeof patch === 'function') patch = patch(latest(it.id) || it.d);
    var d = Object.assign({}, latest(it.id) || it.d, patch);
    return db.put(d, it.id);
  }

  // ---------- 画面の切り替え（#item-<id> / #fav / #recent） ----------
  function route() {
    var h = location.hash.replace(/^#/, '');
    if (h.indexOf('item-') === 0) return { v: 'item', id: h.slice(5) };
    if (h === 'fav' || h === 'recent') return { v: h };
    return { v: 'home' };
  }
  function go(to) {
    if (('#' + to) === location.hash || (!to && !location.hash)) { render(); return; }
    if (to) location.hash = to;
    else history.pushState(null, '', location.pathname + location.search);
    render();
    window.scrollTo(0, 0);
  }

  // ---------- 描画 ----------
  function render() {
    var r = route();
    if (r.v === 'item' && !S.items[r.id]) r = { v: 'home' };
    S.cur = r;
    var gi = $('goal-new');
    var keepGoal = gi && r.v === 'item' && S.goalFor === r.id ? { v: gi.value, f: document.activeElement === gi } : null;
    S.goalFor = r.v === 'item' ? r.id : null;
    renderSide(r);
    var m = $('main');
    if (S.q) m.innerHTML = viewSearch();
    else if (r.v === 'item') m.innerHTML = viewItem(S.items[r.id]);
    else if (r.v === 'fav') m.innerHTML = viewFav();
    else if (r.v === 'recent') m.innerHTML = viewRecent();
    else m.innerHTML = viewHome();
    Array.prototype.forEach.call(document.querySelectorAll('.tab'), function (t) {
      var on = (t.getAttribute('data-to') || 'home') === (r.v === 'item' ? 'home' : r.v);
      if (on) t.setAttribute('aria-current', 'page'); else t.removeAttribute('aria-current');
    });
    if (keepGoal) { var g2 = $('goal-new'); if (g2) { g2.value = keepGoal.v; if (keepGoal.f) g2.focus(); } }
    var qi = $('q');
    if (qi && S.focusQ) { qi.focus(); qi.setSelectionRange(qi.value.length, qi.value.length); }
    S.focusQ = false;
  }

  function searchBox(id) {
    return '<label class="search"><span aria-hidden="true">⌕</span><input id="' + id + '" type="search" placeholder="項目・ファイル名でさがす" value="' + esc(S.q) + '" autocomplete="off"></label>';
  }

  function renderSide(r) {
    var curId = r.v === 'item' ? r.id : null;
    var html = '<h1>仕事ファイルの地図</h1>' + searchBox('q-side') +
      '<div class="sec-h"><span class="lbl">項目の一覧</span><button class="mini" type="button" data-act="add-item">＋ 項目を追加</button></div>';
    var items = itemList();
    if (!items.length) html += '<p class="note">まだ項目がありません。</p>';
    else {
      html += '<div class="tree">';
      (function walk(pid, lv) {
        children(pid).forEach(function (it) {
          html += '<button type="button" class="kid l' + lv + (it.id === curId ? ' on' : '') + '" data-act="nav" data-to="item-' + it.id + '">' +
            '<span class="dot d-' + colorOf(it) + '"></span><span class="nm">' + esc(it.d.name) + '</span><span class="count">' + countIn(it) + '</span></button>';
          walk(it.id, lv + 1);
        });
      })(null, 0);
      html += '</div>';
    }
    html += '<div class="nav">' +
      '<button type="button" data-act="nav" data-to="fav"' + (r.v === 'fav' ? ' aria-current="page"' : '') + '>☆ よく使う</button>' +
      '<button type="button" data-act="nav" data-to="recent"' + (r.v === 'recent' ? ' aria-current="page"' : '') + '>↺ 最近追加したリンク</button>' +
      '<button type="button" data-act="settings">⚙ 接続の設定</button></div>';
    var side = $('side');
    var keepFocus = document.activeElement && document.activeElement.id === 'q-side';
    side.innerHTML = html;
    if (keepFocus) { var q = $('q-side'); q.focus(); q.setSelectionRange(q.value.length, q.value.length); }
  }

  function topBar(title) {
    return '<div class="bar m-only"><h1>' + esc(title) + '</h1><button class="icon-btn" type="button" data-act="settings" aria-label="接続の設定">⚙</button></div>';
  }

  function viewHome() {
    var html = topBar('仕事ファイルの地図') + '<div class="m-only">' + searchBox('q') + '</div>';
    var tops = children(null);
    if (!tops.length) {
      return html + '<div class="empty"><div class="stack"><span class="c-pink"></span><span class="c-mint"></span><span class="c-sky"></span><span class="c-sun"></span></div>' +
        '<h2>まだ項目がありません</h2><p>建物用途や業務の種類ごとに項目をつくり、使うファイルのリンクを置いていきます。項目は3段まで入れ子にできます（たとえば 申請のみ › 確認申請 › 用途変更）。</p>' +
        '<button class="btn-main" type="button" data-act="add-item" style="padding:0 22px">最初の項目をつくる</button></div>';
    }
    html += '<section class="sec m-only"><div class="sec-h"><span class="lbl">項目の一覧</span><button class="mini" type="button" data-act="add-item">＋ 項目を追加</button></div><div class="tree">';
    tops.forEach(function (it) {
      var kids = children(it.id);
      var open = !!S.open[it.id];
      html += '<div class="node"><div class="node-h">' +
        '<button class="go" type="button" data-act="nav" data-to="item-' + it.id + '"><span class="chip c-' + colorOf(it) + '">' + esc(initial(it.d.name)) + '</span>' +
        '<span class="node-t">' + esc(it.d.name) + '<small>' + (kids.length ? '中の項目 ' + kids.length + 'つ' : 'リンクだけ') + '</small></span><span class="count">' + countIn(it) + '件</span></button>' +
        (kids.length ? '<button class="caret" type="button" data-act="toggle" data-id="' + it.id + '" aria-expanded="' + open + '" aria-label="中の項目を開く">›</button>' : '<span style="width:36px"></span>') +
        '</div>';
      if (kids.length && open) {
        html += '<div class="kids">';
        (function walk(pid) {
          children(pid).forEach(function (c) {
            html += '<button type="button" class="kid" data-act="nav" data-to="item-' + c.id + '"><span class="dot d-' + colorOf(c) + '"></span><span class="nm">' + esc(c.d.name) + '</span><span class="count">' + countIn(c) + '</span></button>';
            if (children(c.id).length) { html += '<div class="kids">'; walk(c.id); html += '</div>'; }
          });
        })(it.id);
        html += '</div>';
      }
      html += '</div>';
    });
    html += '</div></section>';
    html += '<section class="sec pc-only"><h2 style="font-size:22px">こんにちは</h2><p class="note">左の一覧から項目を開きます。</p></section>';
    var favs = S.links.filter(function (l) { return l.d.star; });
    if (favs.length) html += '<section class="sec"><span class="lbl">よく使う</span><div class="card">' + favs.slice(0, 6).map(fileRow).join('') + '</div></section>';
    html += '<section class="sec"><span class="lbl">最近追加したリンク</span>' + recentBlock(6) + '</section>';
    return html;
  }

  function recentBlock(n) {
    var ls = S.links.slice().sort(function (a, b) { return a.rec.createdAt < b.rec.createdAt ? 1 : -1; }).slice(0, n);
    if (!ls.length) return '<div class="empty-s">リンクはまだありません。項目を開いて「＋ リンクを追加」から置けます。</div>';
    return '<div class="card">' + ls.map(function (l) { return fileRow(l, true); }).join('') + '</div>';
  }

  function placeText(l) {
    var names = (l.d.items || []).filter(function (i) { return S.items[i]; }).map(function (i) { return S.items[i].d.name; });
    return names.length ? names.join('・') : '置き場所なし';
  }

  function fileRow(l, showPlace) {
    var k = KINDS[l.d.kind] ? l.d.kind : 'other';
    var sub = showPlace ? placeText(l) : (l.d.memo || KINDS[k].label);
    return '<div class="file"><span class="ft ' + k + '">' + KINDS[k].mark + '</span>' +
      '<button class="fn" type="button" data-act="edit-link" data-id="' + l.id + '"><b>' + esc(l.d.name || KINDS[k].label) + '</b><small>' + esc(sub) +
      (l.rec.pending ? ' <span class="pend">・送信待ち</span>' : '') + '</small></button>' +
      '<button class="star' + (l.d.star ? ' on' : '') + '" type="button" data-act="star" data-id="' + l.id + '" aria-label="よく使うに' + (l.d.star ? 'しない' : 'する') + '">' + (l.d.star ? '★' : '☆') + '</button>' +
      '<a class="open" href="' + esc(l.d.url) + '" target="_blank" rel="noopener">開く ↗</a></div>';
  }

  function viewItem(it) {
    var p = path(it);
    var html = '<div class="bar m-only"><button class="icon-btn" type="button" data-act="back" aria-label="もどる">‹</button>' +
      '<button class="icon-btn" type="button" data-act="edit-item" data-id="' + it.id + '" aria-label="項目を編集">✎</button></div>';
    html += '<div class="crumb"><button type="button" data-act="nav" data-to="">一覧</button>';
    p.forEach(function (x, i) {
      html += ' › ' + (i === p.length - 1 ? '<b>' + esc(x.d.name) + '</b>' : '<button type="button" data-act="nav" data-to="item-' + x.id + '">' + esc(x.d.name) + '</button>');
    });
    html += '</div>';

    var goals = it.d.goals || [];
    var done = goals.filter(function (g) { return g.done; }).length;
    var hero = '<div class="hero"><div class="hero-top"><span class="chip c-' + colorOf(it) + '">' + esc(initial(it.d.name)) + '</span><h2>' + esc(it.d.name) + '<small>の項目</small></h2>' +
      '<button class="mini pc-only" type="button" data-act="edit-item" data-id="' + it.id + '">✎ 編集</button></div>' +
      '<span class="lbl">目的</span>' +
      (it.d.purpose ? '<p class="purpose">' + esc(it.d.purpose) + '</p>' : '<p class="purpose none">目的はまだ書いていません。<button class="mini" type="button" data-act="edit-item" data-id="' + it.id + '">書く</button></p>') + '</div>';

    var gc = '<div class="card" id="goals"><div class="card-h"><span class="lbl">ゴールのチェック</span><span style="display:flex;gap:8px;align-items:center">' +
      (goals.length ? '<span class="count">' + done + ' / ' + goals.length + '</span>' : '') +
      (goals.length ? '<button class="mini' + (S.editGoals ? ' on' : '') + '" type="button" data-act="edit-goals">' + (S.editGoals ? '完了' : '編集') + '</button>' : '') + '</span></div>';
    if (goals.length) gc += '<div class="prog"><i style="width:' + Math.round(done / goals.length * 100) + '%"></i></div>';
    goals.forEach(function (g) {
      gc += '<div class="chk"><label><input type="checkbox" data-act="goal" data-id="' + g.id + '"' + (g.done ? ' checked' : '') + '><span>' + esc(g.text) + '</span></label>' +
        (S.editGoals ? '<button class="x" type="button" data-act="del-goal" data-id="' + g.id + '" aria-label="このチェックを消す">×</button>' : '') + '</div>';
    });
    if (!goals.length) gc += '<p class="note">この項目で「できた」と言える状態を、チェック項目にして並べます。</p>';
    gc += '<form class="add-goal" data-form="goal"><input class="ax-input" id="goal-new" placeholder="チェック項目を追加" maxlength="200" autocomplete="off"><button class="ax-btn" type="submit">追加</button></form>';
    if (done && S.editGoals) gc += '<button class="mini" type="button" data-act="reset-goals" style="align-self:flex-start">チェックを全部はずす（次の案件用）</button>';
    gc += '</div>';

    var ls = linksIn(it.id);
    var fc = '<div class="card"><div class="card-h"><span class="lbl">使うファイル</span><span style="display:flex;gap:8px;align-items:center"><span class="count">' + ls.length + '件</span>' +
      '<button class="mini on" type="button" data-act="add-link">＋ リンクを追加</button></span></div>';
    fc += ls.length ? '<div>' + ls.map(function (l) { return fileRow(l); }).join('') + '</div>' : '<div class="empty-s">ドライブのURLを貼るだけで置けます。</div>';

    var kids = children(it.id);
    var canKid = depth(it) < MAX_DEPTH;
    fc += '<span class="lbl" style="margin-top:8px">中の項目</span><div class="pills">' +
      kids.map(function (c) { return '<button class="pill" type="button" data-act="nav" data-to="item-' + c.id + '">' + esc(c.d.name) + '</button>'; }).join('') +
      (canKid ? '<button class="pill add" type="button" data-act="add-item" data-parent="' + it.id + '">＋ 項目を追加</button>' : '<span class="note">（3段目なので、この下には作れません）</span>') + '</div>';
    var sibs = children(parentOf(it) ? it.d.parent : null).filter(function (x) { return x.id !== it.id; });
    if (sibs.length) {
      fc += '<span class="lbl" style="margin-top:8px">となりの項目</span><div class="pills">' +
        sibs.map(function (c) { return '<button class="pill" type="button" data-act="nav" data-to="item-' + c.id + '">' + esc(c.d.name) + '</button>'; }).join('') + '</div>';
    }
    fc += '</div>';

    return html + '<div class="cols"><div class="colstack">' + hero + gc + '</div>' + fc + '</div>';
  }

  function viewFav() {
    var ls = S.links.filter(function (l) { return l.d.star; });
    return topBar('よく使う') + '<h2 class="pc-only" style="font-size:22px">よく使う</h2>' +
      (ls.length ? '<div class="card">' + ls.map(function (l) { return fileRow(l, true); }).join('') + '</div>'
        : '<div class="empty-s">ファイルの ☆ をタップすると、ここに集まります。</div>');
  }
  function viewRecent() {
    return topBar('最近追加したリンク') + '<h2 class="pc-only" style="font-size:22px">最近追加したリンク</h2>' + recentBlock(50);
  }
  function viewSearch() {
    var q = S.q.toLowerCase();
    var its = itemList().filter(function (it) { return (it.d.name + ' ' + (it.d.purpose || '')).toLowerCase().indexOf(q) >= 0; });
    var ls = S.links.filter(function (l) { return ((l.d.name || '') + ' ' + (l.d.memo || '')).toLowerCase().indexOf(q) >= 0; });
    var html = topBar('さがす') + '<div class="m-only">' + searchBox('q') + '</div>' + '<span class="lbl">項目 ' + its.length + '件</span>';
    html += its.length ? '<div class="pills">' + its.map(function (it) {
      return '<button class="pill" type="button" data-act="nav" data-to="item-' + it.id + '">' + path(it).map(function (x) { return esc(x.d.name); }).join(' › ') + '</button>';
    }).join('') + '</div>' : '<p class="note">見つかりませんでした。</p>';
    html += '<span class="lbl">ファイル ' + ls.length + '件</span>' + (ls.length ? '<div class="card">' + ls.map(function (l) { return fileRow(l, true); }).join('') + '</div>' : '<p class="note">見つかりませんでした。</p>');
    return html;
  }

  // ---------- シート ----------
  function openSheet(html, mount) {
    closeSheet();
    var ov = document.createElement('div');
    ov.className = 'ov';
    ov.innerHTML = '<div class="bsheet" role="dialog" aria-modal="true">' + '<div class="grab"></div>' + html + '</div>';
    ov.addEventListener('click', function (e) { if (e.target === ov) closeSheet(); });
    $('sheet-root').appendChild(ov);
    S.lastFocus = document.activeElement;
    if (mount) mount(ov.querySelector('.bsheet'));
  }
  function closeSheet() {
    $('sheet-root').innerHTML = '';
    if (S.lastFocus && S.lastFocus.focus && document.contains(S.lastFocus)) S.lastFocus.focus();
  }
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && $('sheet-root').firstChild) closeSheet(); });

  // 置き場所の選択肢（項目の木）
  function treeRows(fn) {
    var rows = [];
    (function walk(pid, lv) { children(pid).forEach(function (it) { rows.push(fn(it, lv)); walk(it.id, lv + 1); }); })(null, 0);
    return rows.join('');
  }

  function linkSheet(link, presetItem) {
    var d = link ? link.d : { url: '', name: '', memo: '', kind: null, items: presetItem ? [presetItem] : [] };
    var chosen = (d.items || []).slice();
    var kind = d.kind || null;
    var kindTouched = !!link;
    var html = '<div class="sheet-h"><button type="button" data-x="cancel">やめる</button><h3>' + (link ? 'リンクを編集' : 'リンクを追加') + '</h3><button type="button" class="save" data-x="save">保存</button></div>' +
      '<div class="field"><label for="l-url">ドライブなどのURL</label><input class="ax-input" id="l-url" type="url" inputmode="url" placeholder="https://drive.google.com/…" value="' + esc(d.url) + '" autocomplete="off"></div>' +
      '<div id="l-detect"></div>' +
      '<div class="field"><label for="l-name">表示名</label><input class="ax-input" id="l-name" placeholder="例：用途変更チェックリスト" maxlength="120" value="' + esc(d.name) + '"></div>' +
      '<div class="field"><span class="lbl">種類</span><div class="seg" id="l-kind">' + KIND_ORDER.map(function (k) {
        return '<button type="button" data-k="' + k + '" aria-pressed="false">' + KINDS[k].label + '</button>';
      }).join('') + '</div></div>' +
      '<div class="field"><span class="lbl">置き場所（いくつでも）</span><div class="picker" id="l-place"></div></div>' +
      '<div class="field"><label for="l-memo">ひとことメモ（任意）</label><input class="ax-input" id="l-memo" placeholder="例：最初にこれを開く" maxlength="200" value="' + esc(d.memo) + '"></div>' +
      '<p class="err" id="l-err"></p>' +
      '<button class="btn-main" type="button" data-x="save">' + (link ? '保存する' : (chosen.length === 1 && S.items[chosen[0]] ? '「' + esc(S.items[chosen[0]].d.name) + '」に追加する' : '追加する')) + '</button>' +
      (link ? '<div id="l-delwrap"><button class="btn-del" type="button" data-x="del" style="width:100%">このリンクを削除</button></div>' : '');
    openSheet(html, function (sh) {
      var url = sh.querySelector('#l-url');
      function paintKind() {
        Array.prototype.forEach.call(sh.querySelectorAll('#l-kind button'), function (b) { b.setAttribute('aria-pressed', String(b.getAttribute('data-k') === kind)); });
      }
      function detect() {
        var v = url.value.trim();
        var box = sh.querySelector('#l-detect');
        if (!v) { box.innerHTML = ''; return; }
        if (!validUrl(v)) { box.innerHTML = '<div class="detect warn">https:// から始まるURLを貼ってください</div>'; return; }
        var g = guessKind(v);
        if (!kindTouched) kind = g;
        box.innerHTML = '<div class="detect"><span class="ft ' + g + '">' + KINDS[g].mark + '</span><span>' +
          (g === 'other' ? '種類がわからないので「その他」にしました' : KINDS[g].label + 'として認識しました') + '</span></div>';
        paintKind();
      }
      function paintPlace() {
        var box = sh.querySelector('#l-place');
        if (!itemList().length) { box.innerHTML = '<p class="none">項目がまだありません。保存すると「置き場所なし」になります。</p>'; return; }
        box.innerHTML = treeRows(function (it, lv) {
          var on = chosen.indexOf(it.id) >= 0;
          return '<label class="p' + lv + (on ? ' on' : '') + '"><input type="checkbox" value="' + it.id + '"' + (on ? ' checked' : '') + '>' + esc(it.d.name) + '</label>';
        });
      }
      url.addEventListener('input', detect);
      sh.querySelector('#l-kind').addEventListener('click', function (e) {
        var b = e.target.closest('button[data-k]'); if (!b) return;
        kind = b.getAttribute('data-k'); kindTouched = true; paintKind();
      });
      sh.querySelector('#l-place').addEventListener('change', function (e) {
        var id = e.target.value;
        if (e.target.checked) { if (chosen.indexOf(id) < 0) chosen.push(id); } else chosen = chosen.filter(function (x) { return x !== id; });
        paintPlace();
      });
      sh.addEventListener('click', function (e) {
        var b = e.target.closest('[data-x]'); if (!b) return;
        var x = b.getAttribute('data-x');
        if (x === 'cancel') closeSheet();
        else if (x === 'del') {
          sh.querySelector('#l-delwrap').innerHTML = '<p class="note">このリンクを削除します（ドライブのファイルは消えません）。</p><div class="ax-row" style="margin:6px 0 0">' +
            '<button class="ax-btn" type="button" data-x="cancel-del" style="flex:1">やめる</button><button class="ax-btn ax-btn-danger" type="button" data-x="del-yes" style="flex:1">削除する</button></div>';
        } else if (x === 'cancel-del') {
          sh.querySelector('#l-delwrap').innerHTML = '<button class="btn-del" type="button" data-x="del" style="width:100%">このリンクを削除</button>';
        } else if (x === 'del-yes') {
          db.remove(link.id); closeSheet(); Apps.toast('リンクを削除しました');
        } else if (x === 'save') {
          var v = url.value.trim();
          var errEl = sh.querySelector('#l-err');
          if (!validUrl(v)) { errEl.textContent = 'URLを貼ってください（https:// から始まるもの）'; url.focus(); return; }
          var data = Object.assign({}, d, {
            type: 'link', url: v, name: sh.querySelector('#l-name').value.trim(), memo: sh.querySelector('#l-memo').value.trim(),
            kind: kind || guessKind(v), items: chosen.filter(function (i) { return S.items[i]; }), star: !!d.star
          });
          db.put(data, link ? link.id : undefined);
          closeSheet();
          Apps.toast(link ? '保存しました' : 'リンクを追加しました');
        }
      });
      paintPlace(); detect(); paintKind();
      if (!link) url.focus();
    });
  }

  function itemSheet(it, presetParent) {
    var d = it ? it.d : { name: '', parent: presetParent || null, purpose: '', color: null };
    var parent = d.parent && S.items[d.parent] ? d.parent : null;
    var color = d.color || COLORS[children(null).length % COLORS.length];
    var myH = it ? height(it) : 1;
    var banned = it ? [it.id].concat(descendants(it).map(function (x) { return x.id; })) : [];
    var html = '<div class="sheet-h"><button type="button" data-x="cancel">やめる</button><h3>' + (it ? '項目を編集' : '項目を追加') + '</h3><button type="button" class="save" data-x="save">保存</button></div>' +
      '<div class="field"><label for="i-name">項目の名前</label><input class="ax-input" id="i-name" maxlength="60" placeholder="例：ホテル、再販、用途変更" value="' + esc(d.name) + '" autocomplete="off"></div>' +
      '<div class="field"><span class="lbl">どこに置く？</span><div class="picker" id="i-parent"></div></div>' +
      '<div class="field" id="i-colorf"><span class="lbl">色</span><div class="colors" id="i-color">' + COLORS.map(function (c) {
        return '<button type="button" class="d-' + c + '" data-c="' + c + '" aria-label="' + c + '" aria-pressed="false"></button>';
      }).join('') + '</div></div>' +
      '<div class="field"><label for="i-purpose">目的（任意）</label><textarea class="ax-input" id="i-purpose" maxlength="1000" placeholder="この項目でやること・何のために使うか">' + esc(d.purpose) + '</textarea></div>' +
      '<p class="err" id="i-err"></p>' +
      '<button class="btn-main" type="button" data-x="save">' + (it ? '保存する' : 'この項目をつくる') + '</button>' +
      (it ? '<div id="i-delwrap"><button class="btn-del" type="button" data-x="del" style="width:100%">この項目を削除</button></div>' : '');
    openSheet(html, function (sh) {
      function paint() {
        var rows = '<button type="button" class="opt' + (!parent ? ' on' : '') + '" data-p="">いちばん上（大きな分け方）</button>';
        rows += treeRows(function (x, lv) {
          var ok = banned.indexOf(x.id) < 0 && depth(x) + myH <= MAX_DEPTH;
          return '<button type="button" class="opt p' + Math.min(lv + 1, 2) + (parent === x.id ? ' on' : '') + (ok ? '' : ' dis') + '" data-p="' + x.id + '"' + (ok ? '' : ' disabled') + '>' +
            (parent === x.id ? '✓ ' : '') + esc(x.d.name) + ' の中</button>';
        });
        sh.querySelector('#i-parent').innerHTML = rows;
        sh.querySelector('#i-colorf').hidden = !!parent;
        Array.prototype.forEach.call(sh.querySelectorAll('#i-color button'), function (b) { b.setAttribute('aria-pressed', String(b.getAttribute('data-c') === color)); });
      }
      sh.querySelector('#i-parent').addEventListener('click', function (e) {
        var b = e.target.closest('button[data-p]'); if (!b || b.disabled) return;
        parent = b.getAttribute('data-p') || null; paint();
      });
      sh.querySelector('#i-color').addEventListener('click', function (e) {
        var b = e.target.closest('button[data-c]'); if (!b) return; color = b.getAttribute('data-c'); paint();
      });
      sh.addEventListener('click', function (e) {
        var b = e.target.closest('[data-x]'); if (!b) return;
        var x = b.getAttribute('data-x');
        if (x === 'cancel') closeSheet();
        else if (x === 'del') {
          var n = descendants(it).length;
          sh.querySelector('#i-delwrap').innerHTML = '<p class="note">「' + esc(it.d.name) + '」' + (n ? 'と中の項目' + n + 'つ' : '') +
            'を削除します。置いてあったリンクは、ほかの項目に置いていなければ「置き場所なし」として最近の一覧に残ります。</p><div class="ax-row" style="margin:6px 0 0">' +
            '<button class="ax-btn" type="button" data-x="cancel-del" style="flex:1">やめる</button><button class="ax-btn ax-btn-danger" type="button" data-x="del-yes" style="flex:1">削除する</button></div>';
        } else if (x === 'cancel-del') {
          sh.querySelector('#i-delwrap').innerHTML = '<button class="btn-del" type="button" data-x="del" style="width:100%">この項目を削除</button>';
        } else if (x === 'del-yes') {
          var gone = [it.id].concat(descendants(it).map(function (y) { return y.id; }));
          var back = parentOf(it);
          S.links.forEach(function (l) {
            var keep = (l.d.items || []).filter(function (i) { return gone.indexOf(i) < 0; });
            if (keep.length !== (l.d.items || []).length) db.put(Object.assign({}, l.d, { items: keep }), l.id);
          });
          gone.forEach(function (id) { db.remove(id); });
          closeSheet();
          go(back ? 'item-' + back.id : '');
          Apps.toast('項目を削除しました');
        } else if (x === 'save') {
          var name = sh.querySelector('#i-name').value.trim();
          if (!name) { sh.querySelector('#i-err').textContent = '名前を入れてください'; sh.querySelector('#i-name').focus(); return; }
          var data = Object.assign({ goals: [], order: Date.now() }, d, {
            type: 'item', name: name, parent: parent, purpose: sh.querySelector('#i-purpose').value.trim(), color: parent ? (d.color || null) : color
          });
          if (it && it.d.parent !== parent) data.order = Date.now();
          db.put(data, it ? it.id : undefined).then(function (rec) {
            if (!it) { if (parent) { S.open[path(S.items[parent])[0].id] = true; saveOpen(); } go('item-' + rec.id); }
          });
          closeSheet();
          Apps.toast(it ? '保存しました' : '項目をつくりました');
        }
      });
      paint();
      if (!it) sh.querySelector('#i-name').focus();
    });
  }

  // ---------- 操作 ----------
  document.addEventListener('click', function (e) {
    var b = e.target.closest('[data-act]');
    if (!b || b.closest('.bsheet')) return;
    var act = b.getAttribute('data-act');
    var id = b.getAttribute('data-id');
    var cur = S.cur && S.cur.v === 'item' ? S.items[S.cur.id] : null;
    if (act === 'nav') { S.q = ''; S.editGoals = false; go(b.getAttribute('data-to') || ''); }
    else if (act === 'back') { var p = cur && parentOf(cur); go(p ? 'item-' + p.id : ''); }
    else if (act === 'toggle') { S.open[id] = !S.open[id]; saveOpen(); render(); }
    else if (act === 'add-item') itemSheet(null, b.getAttribute('data-parent'));
    else if (act === 'edit-item') itemSheet(S.items[id]);
    else if (act === 'add-link') linkSheet(null, cur ? cur.id : null);
    else if (act === 'edit-link') { var l = S.links.filter(function (x) { return x.id === id; })[0]; if (l) linkSheet(l); }
    else if (act === 'star') { var s = S.links.filter(function (x) { return x.id === id; })[0]; if (s) { var sd = latest(s.id) || s.d; db.put(Object.assign({}, sd, { star: !sd.star }), s.id); } }
    else if (act === 'settings') Apps.openConnectSheet(APP);
    else if (act === 'edit-goals') { S.editGoals = !S.editGoals; render(); }
    else if (act === 'del-goal' && cur) putItem(cur, function (d) { return { goals: (d.goals || []).filter(function (g) { return g.id !== id; }) }; });
    else if (act === 'reset-goals' && cur) putItem(cur, function (d) { return { goals: (d.goals || []).map(function (g) { return Object.assign({}, g, { done: false }); }) }; });
  });
  document.addEventListener('change', function (e) {
    var t = e.target;
    if (t.getAttribute('data-act') !== 'goal' || t.closest('.bsheet')) return;
    var cur = S.items[S.cur.id];
    if (!cur) return;
    putItem(cur, function (d) { return { goals: (d.goals || []).map(function (g) { return g.id === t.getAttribute('data-id') ? Object.assign({}, g, { done: t.checked }) : g; }) }; });
  });
  document.addEventListener('submit', function (e) {
    var f = e.target;
    if (f.getAttribute('data-form') !== 'goal') return;
    e.preventDefault();
    var cur = S.items[S.cur.id];
    var inp = $('goal-new');
    var t = inp.value.trim();
    if (!cur || !t) return;
    S.refocusGoal = true;
    inp.value = '';
    putItem(cur, function (d) { return { goals: (d.goals || []).concat([{ id: Apps.uuid().slice(0, 8), text: t, done: false }]) }; });
  });
  document.addEventListener('input', function (e) {
    var t = e.target;
    if (t.id !== 'q' && t.id !== 'q-side') return;
    S.q = t.value.trim();
    S.focusQ = t.id === 'q';
    render();
  });
  $('fab').addEventListener('click', function () {
    var cur = S.cur && S.cur.v === 'item' ? S.items[S.cur.id] : null;
    if (!itemList().length) itemSheet(null);
    else linkSheet(null, cur ? cur.id : null);
  });
  window.addEventListener('hashchange', function () { S.editGoals = false; render(); });
  window.addEventListener('popstate', function () { render(); });

  db.onChange(function (list) {
    load(list);
    render();
    if (S.refocusGoal) { S.refocusGoal = false; var g = $('goal-new'); if (g) g.focus(); }
  });
  Apps.on('error', function (d) { if (d.during === 'sync' || d.during === 'flush') Apps.toast(Apps.errorText(d.error), true); });

  Apps.ensureConnected(APP).then(function () { return db.sync(); }).catch(function () { /* 'error' で表示済み */ });

  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(function () {});
  window.FileMap = { guessKind: guessKind }; // テスト用
})();
