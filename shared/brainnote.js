/*
 * 脳みそのカードを、ほかのアプリ（本棚・アーキマップ）の中で書く・見る・直すための共通部品（window.BrainNote）
 * iPhone のホーム画面アプリはアプリごとに保存場所（接続・控え）が別なので、脳みそへ飛ばずに、
 * そのアプリの中で Apps.collection('brain') に直接 put する（接続・送信待ち・同期は元のアプリのもの）。
 *
 * 作るカード：{ t:'k', kind, no:null, title, body, tags:[], photos:[], links:[], uses:[], source:{…}, createdIn:'hondana'|'archmap' }
 *   - 番号 no は付けない（null）。脳みそを開いたときに、種類ごとの次の番号を脳みそが振る
 * 使い方：
 *   BrainNote.write({ from:'hondana', kind:'B', title:'', source:{ bookId, title, author, cover }, page:true, kinds:'BHO…'? })
 *   BrainNote.show(id, { from:'hondana', page:true })   // 中身を見せる。「編集」で同じシートで直せる
 *   BrainNote.noLabel(data)  // 'B-001'／番号がまだなら 'B-（未採番）'
 *   BrainNote.kindName(c)
 */
(function (global) {
  'use strict';
  var BASE_KINDS = [
    { c: 'D', name: 'ディテール' }, { c: 'T', name: 'テイスト' }, { c: 'M', name: '素材' },
    { c: 'L', name: '法規・申請' }, { c: 'S', name: '寸法' }, { c: 'B', name: '本のメモ' }, { c: 'H', name: 'ひらめき' },
    { c: 'O', name: 'ほか' }
  ];
  var COLORS = { D: '#4D5A5C', T: '#9A6C78', M: '#A3812F', L: '#3F6F86', S: '#5E7C55', B: '#3E6B5A', H: '#B0602A', O: '#7A7570', x: '#6F6A8A' };
  var APP_NAME = { hondana: '本棚', archmap: 'アーキマップ', brain: '脳みそ' };
  var brain = null;
  function db() { return brain || (brain = global.Apps.collection('brain')); }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function pad3(n) { n = String(n || 0); while (n.length < 3) n = '0' + n; return n; }
  function uniq(a) { var s = {}, o = []; a.forEach(function (x) { if (x && !s[x]) { s[x] = 1; o.push(x); } }); return o; }
  function parseTags(s) {
    return uniq(String(s || '').split(/[\s,、，]+/).map(function (t) { return t.replace(/^#/, '').trim(); }).filter(Boolean));
  }
  function copy(d) { return JSON.parse(JSON.stringify(d)); }
  function isBase(c) { return BASE_KINDS.some(function (k) { return k.c === c; }); }
  function kinds() {
    var r = db().get('kinds'), seen = {};
    var extra = (r && r.data && Array.isArray(r.data.list) ? r.data.list : []).filter(function (k) {
      if (!k || !k.c || isBase(k.c) || seen[k.c]) return false;
      seen[k.c] = 1; return true;
    });
    return BASE_KINDS.concat(extra);
  }
  function kindName(c) { var k = kinds().filter(function (x) { return x.c === c; })[0]; return k ? k.name : c || 'ほか'; }
  function kindColor(c) { return COLORS[isBase(c) ? c : 'x']; }
  function hasNo(d) { return !!(d && typeof d.no === 'number' && d.no > 0); }
  function noLabel(d) { return (d.kind || 'O') + '-' + (hasNo(d) ? pad3(d.no) : '（未採番）'); }
  function noShort(d) { return hasNo(d) ? pad3(d.no) : '—'; }
  function card(id) { var r = db().get(id); return r && r.data && r.data.t === 'k' ? r : null; }

  // ---------- 見た目（このシートだけ） ----------
  var CSS = '' +
    '.bn-sheet .ax-sheet-head{margin-bottom:8px}' +
    '.bn-lab{display:block;font-size:12px;color:var(--ax-muted);margin:12px 0 2px;font-weight:600}' +
    '.bn-kinds{display:flex;flex-wrap:wrap;gap:6px;margin:4px 0}' +
    '.bn-chip{min-height:36px;padding:4px 12px;border-radius:999px;border:1px solid var(--ax-line);background:var(--ax-surface);color:var(--ax-text);font:inherit;font-size:13px;cursor:pointer}' +
    '.bn-chip.on{background:var(--kc);border-color:var(--kc);color:#fff;font-weight:700}' +
    '.bn-src{display:flex;gap:10px;align-items:center;border:1px solid var(--ax-line);border-radius:10px;padding:8px 10px;background:var(--ax-surface);margin:4px 0}' +
    '.bn-src img{width:34px;height:46px;object-fit:cover;border-radius:3px;flex:none}' +
    '.bn-src b{display:block;font-size:14px}.bn-src small{color:var(--ax-muted);font-size:12px}' +
    '.bn-no{display:inline-block;font-family:ui-monospace,Menlo,monospace;font-size:12px;padding:2px 8px;border-radius:6px;color:#fff;background:var(--kc)}' +
    '.bn-no.none{background:transparent;color:var(--ax-muted);border:1px dashed var(--ax-line)}' +
    '.bn-hint{font-size:12px;color:var(--ax-muted);margin:4px 0 0}' +
    '.bn-view h3{font-size:18px;margin:10px 0 6px;line-height:1.4}' +
    '.bn-body{white-space:pre-wrap;line-height:1.7;margin:6px 0;font-size:15px}' +
    '.bn-body.none{color:var(--ax-muted)}' +
    '.bn-tags{display:flex;flex-wrap:wrap;gap:6px;margin:6px 0}.bn-tags span{font-size:13px;color:var(--ax-muted)}' +
    '.bn-small{display:inline-block;margin-top:10px;font-size:12px;color:var(--ax-muted)}' +
    '.bn-sheet textarea.ax-input{min-height:110px;resize:vertical;font:inherit}' +
    '.bn-sheet .ax-input{font-size:16px}';
  function injectCss() {
    if (document.getElementById('bn-css')) return;
    var s = document.createElement('style'); s.id = 'bn-css'; s.textContent = CSS;
    document.head.appendChild(s);
  }

  var OV = null;
  function close() {
    if (OV) { OV.remove(); OV = null; }
    document.removeEventListener('keydown', onKey, true);
  }
  function onKey(e) { if (e.key === 'Escape' && OV) { e.stopPropagation(); close(); } }
  function overlay(title, inner) {
    close();
    injectCss();
    var wrap = document.createElement('div');
    wrap.className = 'ax-overlay bn-overlay';
    wrap.setAttribute('role', 'dialog'); wrap.setAttribute('aria-modal', 'true'); wrap.setAttribute('aria-label', title);
    wrap.innerHTML = '<div class="ax-sheet bn-sheet"><div class="ax-sheet-head"><h2>' + esc(title) + '</h2>' +
      '<button type="button" class="ax-btn ax-btn-ghost" data-bn="close">閉じる</button></div>' + inner + '</div>';
    wrap.addEventListener('click', function (e) {
      if (e.target === wrap || (e.target.closest && e.target.closest('[data-bn=close]'))) close();
    });
    document.body.appendChild(wrap);
    document.addEventListener('keydown', onKey, true);
    OV = wrap;
    return wrap;
  }
  function srcHtml(s) {
    if (!s) return '';
    var cv = /^https:\/\//.test(String(s.cover || '')) ? s.cover : '';
    return '<div class="bn-src">' + (cv ? '<img src="' + esc(cv) + '" alt="" referrerpolicy="no-referrer">' : '') +
      '<span><b>' + esc(s.title || '') + '</b><small>' + esc(s.spotId ? (s.place || '建物') : [s.author, s.page].filter(Boolean).join('　')) + '</small></span></div>';
  }

  // ---------- 書く・直す ----------
  // o = { from, kind, title, source, page(bool), id?（直すとき） , onSaved? }
  function write(o) {
    o = o || {};
    var old = o.id ? card(o.id) : null;
    var d = old ? copy(old.data) : { kind: o.kind || 'O', title: o.title || '', body: '', tags: [], source: o.source ? copy(o.source) : null };
    var cur = { kind: d.kind || 'O' };
    var withPage = !!(o.page && d.source && d.source.bookId);
    var html = '<form class="bn-form">' +
      '<span class="bn-lab">種類</span><div class="bn-kinds" role="radiogroup" aria-label="種類"></div>' +
      (d.source ? '<span class="bn-lab">出典</span>' + srcHtml(d.source) : '') +
      (withPage ? '<label><span class="bn-lab">ページ（あれば）</span><input class="ax-input" name="page" maxlength="30" placeholder="p.32" value="' + esc(d.source.page || '') + '"></label>' : '') +
      '<label><span class="bn-lab">タイトル</span><input class="ax-input" name="title" maxlength="120" required value="' + esc(d.title || '') + '"></label>' +
      '<label><span class="bn-lab">本文</span><textarea class="ax-input" name="body" rows="5" placeholder="気づいたこと・理由・どこで使えそうか">' + esc(d.body || '') + '</textarea></label>' +
      '<label><span class="bn-lab">タグ（スペース区切り）</span><input class="ax-input" name="tags" autocomplete="off" placeholder="照明 陰影" value="' + esc((d.tags || []).join(' ')) + '"></label>' +
      '<p class="bn-hint bn-numline"></p>' +
      '<div class="ax-row"><button class="ax-btn ax-btn-primary" type="submit" data-bn="save">' + (old ? '保存' : '脳みそに保存') + '</button>' +
      '<button class="ax-btn" type="button" data-bn="close">やめる</button></div></form>';
    var wrap = overlay(old ? '脳みそのメモを直す' : '脳みそにメモを作る', html);
    var f = wrap.querySelector('form');
    var F = function (n) { return f.querySelector('[name=' + n + ']'); };
    function renderKinds() {
      f.querySelector('.bn-kinds').innerHTML = kinds().map(function (k) {
        var on = k.c === cur.kind;
        return '<button type="button" role="radio" aria-checked="' + on + '" class="bn-chip' + (on ? ' on' : '') + '" style="--kc:' + kindColor(k.c) + '" data-bnkind="' + esc(k.c) + '">' + esc(k.name) + '</button>';
      }).join('');
      var keep = old && old.data.kind === cur.kind && hasNo(old.data);
      f.querySelector('.bn-numline').textContent = keep ? '番号：' + noLabel(old.data) :
        '番号は脳みそを開くと付きます' + (old && hasNo(old.data) ? '（種類を変えると振り直します）' : '');
    }
    renderKinds();
    f.querySelector('.bn-kinds').addEventListener('click', function (e) {
      var b = e.target.closest('[data-bnkind]');
      if (b) { cur.kind = b.dataset.bnkind; renderKinds(); }
    });
    f.addEventListener('submit', function (e) {
      e.preventDefault();
      var title = F('title').value.trim();
      if (!title) { F('title').focus(); return; }
      var nd = old ? copy(old.data) : { t: 'k', no: null, photos: [], links: [], uses: [], createdIn: o.from || '' };
      nd.t = 'k';
      // 番号：同じ種類のままなら今の番号、新しく作る・種類を変えたときは null（脳みそが振る）
      if (!old || old.data.kind !== cur.kind || !hasNo(old.data)) nd.no = null;
      nd.kind = cur.kind;
      nd.title = title;
      nd.body = F('body').value.replace(/\s+$/, '');
      nd.tags = parseTags(F('tags').value);
      nd.photos = nd.photos || []; nd.links = nd.links || []; nd.uses = nd.uses || [];
      if (d.source) {
        nd.source = copy(d.source);
        if (withPage) { var pg = F('page').value.trim().slice(0, 30); if (pg) nd.source.page = pg; else delete nd.source.page; }
      }
      close();
      db().put(nd, old ? old.id : undefined).then(function (rec) {
        global.Apps.toast((old ? '保存しました' : '脳みそに保存しました') + (navigator.onLine === false ? '（つながったら送ります）' : ''));
        if (o.onSaved) o.onSaved(rec);
      }, function (err) { global.Apps.toast(global.Apps.errorText(err), true); });
    });
    setTimeout(function () { if (!old) F('title').focus(); }, 50);
  }

  // ---------- 見る ----------
  function show(id, o) {
    o = o || {};
    var r = card(id);
    if (!r) { global.Apps.toast('そのメモはまだこの端末にありません（同期してみてください）', true); return; }
    var d = r.data;
    var html = '<div class="bn-view"><span class="bn-no' + (hasNo(d) ? '' : ' none') + '" style="--kc:' + kindColor(d.kind) + '">' + esc(kindName(d.kind)) + '　' + esc(noLabel(d)) + '</span>' +
      '<h3>' + esc(d.title) + '</h3>' +
      (d.source ? srcHtml(d.source) : '') +
      (d.body ? '<p class="bn-body">' + esc(d.body) + '</p>' : '<p class="bn-body none">本文はまだありません。</p>') +
      ((d.tags || []).length ? '<div class="bn-tags">' + d.tags.map(function (t) { return '<span>#' + esc(t) + '</span>'; }).join('') + '</div>' : '') +
      (hasNo(d) ? '' : '<p class="bn-hint">番号は脳みそを開くと付きます</p>') +
      (r.pending ? '<p class="bn-hint">送信待ち（つながったら送ります）</p>' : '') +
      '<div class="ax-row"><button class="ax-btn ax-btn-primary" type="button" data-bn="edit">編集</button>' +
      '<button class="ax-btn" type="button" data-bn="close">閉じる</button></div>' +
      '<a class="bn-small" href="../brain/?open=' + encodeURIComponent(r.id) + '" target="_blank" rel="noopener">ブラウザで脳みそを開く ›</a></div>';
    var wrap = overlay('脳みそのメモ', html);
    wrap.querySelector('[data-bn=edit]').addEventListener('click', function () {
      write({ id: r.id, from: o.from, page: o.page, onSaved: o.onSaved });
    });
  }

  global.BrainNote = { write: write, show: show, close: close, noLabel: noLabel, noShort: noShort, hasNo: hasNo, kindName: kindName, kindColor: kindColor, appName: function (a) { return APP_NAME[a] || a || ''; } };
})(window);
