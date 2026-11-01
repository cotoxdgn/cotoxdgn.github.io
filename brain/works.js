/* 実績ポートフォリオ（脳みその「実績」タブ）。app.js の後に読む（window.BrainCore を使う）
 * 2段の流れ：①ささっと作る（案件名だけで保管・写真とメモは任意） ②人に見せたくなった案件だけ仕上げて「公開」をオン
 *
 * 実績のレコード（知識カードとは別の種類。知識の一覧・つながりの図・番号付けには混ざらない）：
 *   data = { t:'w', name(案件名), slug(公開番号：推測しにくい英数字10文字), memo,
 *            photos:[{ id(ドライブの画像id), pub:bool(公開ページに出す), ba:''|'before'|'after' }],   … 先頭の公開写真が表紙。1件60枚まで
 *            pubName, period:'YYYY-MM'(完成), city(市区まで), area(㎡), user(エンドユーザー), wish(ご要望), point(こだわり・工夫),
 *            hideKnow:[知識id](公開ページに出さない使った知識), published:bool,
 *            client(施主名), addr(番地まで), cost(費用帯) }
 *   - 公開ページに出ない：name・client・addr・cost・memo・公開オフの写真・スプシの記録id
 *   - 状態：published なら公開中／公開用の項目か写真の印を書き始めたら仕上げ中／それ以外は保管中
 * 使った知識は実績側に持たない：知識カードの uses[].name が実績の name と同じものを自動で並べる。
 *   案件名を変えたら、カード側の記録の名前も（確認のうえ）新しい名前に揃える
 * 書き出しの控え：id 'works-export' data = { t:'wexport', at, list:[{ w, title }] }（前回から増えた・消えたを出すため）
 *
 * 公開データ works.json（buildPublic。出してよい項目を1つずつ拾う。項目を増やしても勝手に外へは出ない）：
 *   { v:1, brand:'coto', generatedAt, items:[{ w(公開番号), title, period, city, area, user, wish, point,
 *       photos:[{ url, ba }], know:[{ kind, kindName, title }] }] }
 *   公開ページ（brain/public/）はこのファイルを読むだけ。読み込み元は brain/public/source.js の1か所
 */
(function () {
  'use strict';
  var C = window.BrainCore;
  var db = C.db, esc = C.esc, $ = C.$;
  var MAX_PHOTOS = 60;
  var COSTS = ['〜300万', '300〜600万', '600〜900万', '900〜1,200万', '1,200万〜'];
  var STATUS = { keep: '保管中', work: '仕上げ中', pub: '公開中' };
  var PUB_TEXT = ['pubName', 'period', 'city', 'area', 'user', 'wish', 'point'];
  var EXPORT_ID = 'works-export';
  var BRAND = 'coto';
  var PUBLIC_URL = new URL('public/', location.href).href;
  var LOCK = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="11" width="14" height="9" rx="1.5"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>';
  var EYE = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="2.6"/></svg>';

  var W = { filter: 'all', q: '', sel: null, open: false, up: 0 };
  var Q = null;   // ささっと作る：{ photos:[{id}|{busy}], uploaded:[], busy }
  var F = null;   // 仕上げの下書き：{ id, d, orig(元の写真id) }

  // ---------- データ ----------
  function works() { return db.all().filter(function (r) { return r.data && r.data.t === 'w'; }); }
  function wById(id) { var r = id && db.get(id); return r && r.data && r.data.t === 'w' ? r : null; }
  function photosOf(d) { return (Array.isArray(d.photos) ? d.photos : []).filter(function (p) { return p && p.id; }); }
  function status(d) {
    if (d.published) return 'pub';
    if (PUB_TEXT.some(function (k) { return String(d[k] || '').trim(); }) || photosOf(d).some(function (p) { return p.pub || p.ba; })) return 'work';
    return 'keep';
  }
  function canPublish(d) { return !!(String(d.pubName || '').trim() && photosOf(d).some(function (p) { return p.pub; })); }
  function ym(s) { var m = /^(\d{4})-(\d{2})$/.exec(String(s || '')); return m ? m[1] + '年' + (+m[2]) + '月' : ''; }
  function names() { return works().map(function (r) { return r.data.name; }).filter(Boolean); }
  function nameTaken(name, selfId) { return works().some(function (r) { return r.id !== selfId && r.data.name === name; }); }
  // 使った知識：カードの「この知識を使う」の案件名が同じもの（最後に使った日つき）
  function usedCards(name) {
    if (!name) return [];
    return C.items().map(function (r) {
      var us = C.usesOf(r.data).filter(function (u) { return u && u.name === name; });
      return us.length ? { r: r, date: us.map(function (u) { return u.date || ''; }).sort().pop() } : null;
    }).filter(Boolean).sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; });
  }
  // 知識の記録だけある案件名（まだ実績になっていない）
  function orphans() {
    var cnt = {}, have = {};
    C.items().forEach(function (r) { C.uniq(C.usesOf(r.data).map(function (u) { return u && u.name; })).forEach(function (n) { cnt[n] = (cnt[n] || 0) + 1; }); });
    names().forEach(function (n) { have[n] = 1; });
    return Object.keys(cnt).filter(function (n) { return !have[n]; }).map(function (n) { return { name: n, n: cnt[n] }; });
  }
  function newSlug() {
    var a = 'abcdefghijkmnpqrstuvwxyz23456789', taken = {};
    works().forEach(function (r) { taken[r.data.slug] = 1; });
    for (;;) {
      var b = new Uint8Array(10), out = '';
      (window.crypto || window.msCrypto).getRandomValues(b);
      for (var i = 0; i < 10; i++) out += a[b[i] % a.length];
      if (!taken[out]) return out;
    }
  }
  function pubUrl(d) { return PUBLIC_URL + '?w=' + encodeURIComponent(d.slug || ''); }
  function img(id, size) { return Apps.imageUrl(id, size || 600); }

  // ---------- 公開データ（出してよい項目だけを1つずつ拾う） ----------
  function s(v, n) { return typeof v === 'string' ? v.trim().slice(0, n) : typeof v === 'number' ? String(v).slice(0, n) : ''; }
  function pubItem(d) {
    var hide = Array.isArray(d.hideKnow) ? d.hideKnow : [];
    return {
      w: s(d.slug, 20),
      title: s(d.pubName, 120),
      period: /^\d{4}-\d{2}$/.test(String(d.period || '')) ? d.period : '',
      city: s(d.city, 60),
      area: s(String(d.area || '').replace(/[^\d.]/g, ''), 8),
      user: s(d.user, 120),
      wish: s(d.wish, 4000),
      point: s(d.point, 6000),
      photos: photosOf(d).filter(function (p) { return p.pub; }).map(function (p) {
        return { url: Apps.imageUrl(p.id, 1600), ba: p.ba === 'before' || p.ba === 'after' ? p.ba : '' };
      }),
      know: usedCards(d.name).filter(function (x) { return hide.indexOf(x.r.id) < 0; }).map(function (x) {
        return { kind: s(x.r.data.kind || 'O', 4), kindName: s(C.kindOf(x.r.data.kind).name, 20), title: s(x.r.data.title, 120) };
      })
    };
  }
  function publishable() {
    return works().filter(function (r) { return r.data.published && canPublish(r.data); })
      .sort(function (a, b) { return String(b.data.period || '').localeCompare(String(a.data.period || '')) || (a.createdAt < b.createdAt ? 1 : -1); });
  }
  function buildPublic() {
    return { v: 1, brand: BRAND, generatedAt: new Date().toISOString(), items: publishable().map(function (r) { return pubItem(r.data); }) };
  }
  // 施主名・番地に入れた文字が、公開する文章に入っていないか。見つかった言葉の一覧を返す
  function norm(t) { return String(t || '').normalize('NFKC').replace(/\s+/g, ''); }
  function leaks(d) {
    var it = pubItem(d);
    var txt = norm([it.title, it.city, it.user, it.wish, it.point].concat(it.know.map(function (k) { return k.title; })).join('\n'));
    var needles = [];
    var client = String(d.client || '').normalize('NFKC').replace(/(様|さま|さん|邸|殿|御中)\s*$/, '').trim();
    if (client) {
      needles.push(norm(client));
      client.split(/[\s・,、]+/).forEach(function (w) { needles.push(norm(w.replace(/(様|さま|さん|邸|殿)$/, ''))); });
    }
    var addr = norm(d.addr);
    if (addr) {
      needles.push(addr);
      var city = norm(d.city);
      if (city && addr.indexOf(city) === 0) needles.push(addr.slice(city.length));
      (addr.match(/\d+(?:(?:-|丁目|番地?|号|の)\d+)+/g) || []).forEach(function (m) { needles.push(m); });
    }
    return C.uniq(needles.filter(function (w) { return w && w.length >= 2 && txt.indexOf(w) >= 0; }));
  }

  // ---------- 一覧 ----------
  function cover(d) { var p = photosOf(d); var c = p.filter(function (x) { return x.pub; })[0] || p[0]; return c ? c.id : ''; }
  function phHtml(id, ba, size, cls) {
    return '<span class="wph' + (cls ? ' ' + cls : '') + '">' + (id ? '<img src="' + esc(img(id, size)) + '" alt="" loading="lazy">' : '') +
      (ba ? '<span class="ba ' + ba + '">' + (ba === 'after' ? 'アフター' : 'ビフォー') + '</span>' : '') + '</span>';
  }
  function renderList() {
    var all = works(), n = { all: all.length, keep: 0, work: 0, pub: 0 };
    all.forEach(function (r) { n[status(r.data)]++; });
    $('wChips').innerHTML = [['all', 'すべて'], ['keep', '保管中'], ['work', '仕上げ中'], ['pub', '公開中']].map(function (x) {
      return '<button type="button" class="chip' + (W.filter === x[0] ? ' on' : '') + '" data-wfilter="' + x[0] + '">' + x[1] + '<span class="n">' + n[x[0]] + '</span></button>';
    }).join('');
    var q = W.q.trim().toLowerCase();
    var list = all.filter(function (r) {
      var d = r.data;
      if (W.filter !== 'all' && status(d) !== W.filter) return false;
      if (q) {
        var hay = [d.name, d.pubName, d.city, d.addr].join('\n').toLowerCase();
        if (q.split(/\s+/).some(function (w) { return hay.indexOf(w) < 0; })) return false;
      }
      return true;
    });
    $('wEmpty').hidden = all.length > 0;
    $('paneWorks').querySelector('.filters').hidden = !all.length;
    $('wNoHit').hidden = !all.length || list.length > 0;
    $('works').innerHTML = list.map(function (r) {
      var d = r.data, st = status(d), c = cover(d);
      var sub = [d.city, ym(d.period), photosOf(d).length + '枚'].filter(Boolean).join(' ・ ');
      return '<button type="button" class="wk' + (W.sel === r.id ? ' sel' : '') + '" data-wopen="' + esc(r.id) + '">' +
        (c ? phHtml(c, '', 200) : '<span class="wph none">写真なし</span>') +
        '<span class="wt"><b>' + esc(d.name) + (r.pending ? '<span class="wait">送信待ち</span>' : '') + '</b><small>' + esc(sub) + '</small></span>' +
        '<span class="r"><span class="st ' + st + '">' + STATUS[st] + '</span><span class="kn">知識 ' + usedCards(d.name).length + '</span></span></button>';
    }).join('');
    var orph = orphans();
    $('wOrph').innerHTML = orph.length ? '<h3>知識の記録だけある案件</h3><p class="ax-note">脳みそで「この知識を使う」に書いた案件名です。押すとその名前で実績を作れます。</p>' +
      orph.map(function (o) {
        return '<button type="button" class="orow" data-orph="' + esc(o.name) + '"><span>' + esc(o.name) + '<small>使った知識 ' + o.n + '件</small></span><em>実績にする ›</em></button>';
      }).join('') : '';
  }

  // ---------- 詳細 ----------
  function renderDetail() {
    var r = wById(W.sel);
    $('app').classList.toggle('has-wsel', !!r);
    if (!r) { $('wDetail').innerHTML = ''; if (W.open) closeWork(); return; }
    var d = r.data, st = status(d), used = usedCards(d.name), ph = photosOf(d);
    var h = '<div class="wd-head"><h2>' + esc(d.name) + '</h2><div class="meta"><span class="st ' + st + '">' + STATUS[st] + '</span>' +
      [d.city, ym(d.period), d.area ? d.area + '㎡' : ''].filter(Boolean).map(esc).join('<span aria-hidden="true">・</span>') + '</div></div>';
    h += ph.length ? '<div class="wgal">' + ph.map(function (p) {
      return '<button type="button" data-wphoto="' + esc(p.id) + '" aria-label="写真を大きく見る">' + phHtml(p.id, p.ba, 900) + '</button>';
    }).join('') + '</div>' : '<p class="ax-note">写真はまだありません。</p>';
    h += '<div class="w-add"><label class="ax-btn" for="w-photo">＋ 写真をまとめて追加</label><span class="ax-note" id="wUpNote">' +
      (W.up ? '送信中 ' + W.up + '枚…' : ph.length + ' / ' + MAX_PHOTOS + '枚') + '</span></div>';
    h += '<div><span class="lab">メモ</span>' + (d.memo ? '<p class="memo">' + esc(d.memo) + '</p>' : '<p class="memo none">まだメモはありません。「仕上げ」の下の方で書けます。</p>') + '</div>';
    h += '<div><span class="lab">使った知識 ' + used.length + '件<span class="auto-tag">自動</span></span><div class="know">' +
      (used.length ? used.map(function (x) {
        var k = x.r.data;
        return '<button type="button" class="kn-item" style="--kc:' + C.kindColor(k.kind) + '" data-card="' + esc(x.r.id) + '"><span class="dot">' + esc(C.noStr(k)) + '</span>' +
          '<span class="t">' + esc(k.title) + '<small>' + esc(C.kindOf(k.kind).name) + '</small></span><span class="d">' + esc(String(x.date || '').replace(/-/g, '.')) + '</span></button>';
      }).join('') : '<p class="ax-note">「' + esc(d.name) + '」で「この知識を使う」と記録したカードがここに並びます。</p>') +
      '<button class="ax-btn" type="button" id="wAddKnow">＋ 使った知識を足す</button></div></div>';
    if (st !== 'pub') {
      h += '<div class="next"><p><b>人に見せたくなったら</b>　時期・場所・ご要望などを足して、公開ページにできます。急がなくて大丈夫です。</p>' +
        '<button class="ax-btn ax-btn-primary" type="button" data-wfin="1">仕上げる</button></div>';
    } else {
      h += '<div class="next"><p><b>公開中</b>　「公開データを書き出す」で反映したあと、リンクを送る・HPに貼ることができます。</p>' +
        '<div class="urlbox">' + esc(PUBLIC_URL + '?w=') + '<em>' + esc(d.slug) + '</em></div>' +
        '<div class="acts"><button class="ax-btn" type="button" id="wCopyUrl">リンクをコピー</button><button class="ax-btn" type="button" id="wExport">公開データを書き出す</button></div></div>';
    }
    h += '<p class="dt-foot">作成 ' + esc(C.localDay(r.createdAt)) + ' ・ 更新 ' + esc(C.localDay(r.updatedAt)) + (r.pending ? ' ・ 送信待ち' : '') + '</p>';
    $('wDetail').innerHTML = h;
  }
  function openWork(id) {
    W.sel = id;
    if (!C.wide.matches) { W.open = true; $('app').classList.add('work-open'); }
    render();
    $('wDetail').scrollTop = 0;
  }
  function closeWork() { W.open = false; $('app').classList.remove('work-open'); }

  $('works').addEventListener('click', function (e) {
    var b = e.target.closest('[data-wopen]');
    if (b) openWork(b.dataset.wopen);
  });
  $('wChips').addEventListener('click', function (e) {
    var b = e.target.closest('[data-wfilter]');
    if (b) { W.filter = b.dataset.wfilter; renderList(); }
  });
  $('wq').addEventListener('input', function () { W.q = this.value; renderList(); });
  $('wOrph').addEventListener('click', function (e) {
    var b = e.target.closest('[data-orph]');
    if (b) quick(b.dataset.orph);
  });
  Array.prototype.forEach.call(document.querySelectorAll('[data-wquick]'), function (b) { b.addEventListener('click', function () { quick(''); }); });
  $('wBack').addEventListener('click', closeWork);
  $('wFinBtn').addEventListener('click', function () { if (W.sel) openFinish(W.sel); });
  $('wDetail').addEventListener('click', function (e) {
    var t = e.target.closest('button');
    var r = wById(W.sel);
    if (!t || !r) return;
    if (t.dataset.wphoto) { C.lightbox(img(t.dataset.wphoto, 1600)); return; }
    if (t.dataset.card) { C.showCard(t.dataset.card); return; }
    if (t.dataset.wfin) { openFinish(r.id); return; }
    if (t.id === 'wCopyUrl') { copyText(pubUrl(r.data), 'リンクをコピーしました'); return; }
    if (t.id === 'wExport') { openExport(); return; }
    if (t.id === 'wAddKnow') {
      var name = r.data.name;
      C.openPicker('「' + name + '」で使った知識', usedCards(name).map(function (x) { return x.r.id; }), function (cid, on) { setUse(cid, name, on); });
    }
  });
  // カードの「使った案件」に記録を足す・外す（カード側にも同じ記録が入る）
  function setUse(cid, name, on) {
    var c = C.byId(cid);
    if (!c) return Promise.resolve();
    var d = C.copyData(c.data); d.uses = C.usesOf(d);
    if (on) {
      if (d.uses.some(function (u) { return u.name === name; })) return Promise.resolve();
      d.uses.push({ name: name, date: C.today() });
    } else d.uses = d.uses.filter(function (u) { return u.name !== name; });
    return db.put(d, c.id);
  }
  // 写真をまとめて追加（詳細から）。送り終わった順に1枚ずつ足す
  var chain = Promise.resolve();
  function appendPhoto(wid, imgId) {
    chain = chain.then(function () {
      var r = wById(wid);
      if (!r) { Apps.deleteImage(C.APP, imgId).catch(function () {}); return; }
      var d = C.copyData(r.data); d.photos = photosOf(d).concat([{ id: imgId, pub: false, ba: '' }]);
      return db.put(d, wid);
    }).catch(function (e) { Apps.toast(Apps.errorText(e), true); });
    return chain;
  }
  function pickFiles(files, have) {
    if (!C.online()) { Apps.toast('写真はつながってから追加してください', true); return []; }
    var room = MAX_PHOTOS - have;
    if (room <= 0) { Apps.toast('1件の写真は' + MAX_PHOTOS + '枚までです', true); return []; }
    if (files.length > room) Apps.toast('1件の写真は' + MAX_PHOTOS + '枚までです。先頭の' + room + '枚だけ追加します', true);
    return files.slice(0, room);
  }
  $('w-photo').addEventListener('change', function () {
    var files = Array.prototype.slice.call(this.files || []);
    this.value = '';
    var r = wById(W.sel);
    if (!r || !files.length) return;
    files = pickFiles(files, photosOf(r.data).length + W.up);
    var wid = r.id;
    files.forEach(function (f) {
      W.up++;
      Apps.uploadImage(C.APP, f).then(function (im) { return appendPhoto(wid, im.id); },
        function (e) { Apps.toast('写真を保存できませんでした：' + Apps.errorText(e), true); })
        .then(function () { W.up--; renderDetail(); });
    });
    renderDetail();
  });

  // ---------- ささっと作る ----------
  function quick(name) {
    Q = { photos: [], uploaded: [], busy: 0 };
    $('q-name').value = name || '';
    $('q-memo').value = '';
    $('qNames').innerHTML = orphans().map(function (o) { return '<option value="' + esc(o.name) + '">'; }).join('');
    renderQuick();
    $('quick').hidden = false;
    if (name) Apps.toast('知識の記録と同じ名前で作ります');
    setTimeout(function () { (name ? $('q-memo') : $('q-name')).focus(); }, 50);
  }
  function renderQuick() {
    $('qPhotos').innerHTML = Q.photos.map(function (p, i) {
      if (p.busy) return '<div class="ph busy">送信中…</div>';
      return '<div class="ph"><img src="' + esc(img(p.id, 300)) + '" alt=""><button type="button" class="rm" data-qrm="' + i + '" aria-label="この写真を外す">×</button></div>';
    }).join('');
    var done = Q.photos.filter(function (p) { return p.id; }).length;
    $('qPhNote').textContent = Q.photos.length ? Q.photos.length + '枚' + (Q.busy ? '（送信中 ' + Q.busy + '枚…）' : '（保存しました）') :
      '何枚でも一度に選べます（1件' + MAX_PHOTOS + '枚まで）。縮小してドライブに保存します（オンライン時のみ）';
    $('qSave').disabled = false;
    return done;
  }
  $('q-photo').addEventListener('change', function () {
    var files = Array.prototype.slice.call(this.files || []);
    this.value = '';
    if (!files.length || !Q) return;
    files = pickFiles(files, Q.photos.length);
    var q = Q;
    files.forEach(function (f) {
      var slot = { busy: true };
      q.photos.push(slot); q.busy++;
      Apps.uploadImage(C.APP, f).then(function (im) {
        slot.busy = false; slot.id = im.id; q.uploaded.push(im.id);
      }, function (e) {
        q.photos.splice(q.photos.indexOf(slot), 1);
        Apps.toast('写真を保存できませんでした：' + Apps.errorText(e), true);
      }).then(function () { q.busy--; if (Q === q) renderQuick(); });
    });
    renderQuick();
  });
  $('qPhotos').addEventListener('click', function (e) {
    var t = e.target.closest('[data-qrm]');
    if (t && Q) { Q.photos.splice(+t.dataset.qrm, 1); renderQuick(); }
  });
  function closeQuick(saved) {
    if (Q && !saved) Q.uploaded.forEach(function (p) { Apps.deleteImage(C.APP, p).catch(function () {}); });
    else if (Q) {
      var kept = Q.photos.map(function (p) { return p.id; });
      Q.uploaded.filter(function (p) { return kept.indexOf(p) < 0; }).forEach(function (p) { Apps.deleteImage(C.APP, p).catch(function () {}); });
    }
    Q = null; $('quick').hidden = true;
  }
  $('qCancel').addEventListener('click', function () { closeQuick(false); });
  $('qForm').addEventListener('submit', function (e) {
    e.preventDefault();
    if (!Q) return;
    if (Q.busy) { Apps.toast('写真の保存が終わるまでお待ちください'); return; }
    var name = $('q-name').value.trim().slice(0, 60);
    if (!name) { $('q-name').focus(); Apps.toast('案件名だけ入れてください'); return; }
    if (nameTaken(name)) { Apps.toast('「' + name + '」の実績はもうあります。詳細から写真を足せます', true); return; }
    var d = { t: 'w', name: name, slug: newSlug(), memo: $('q-memo').value.replace(/\s+$/, ''),
      photos: Q.photos.filter(function (p) { return p.id; }).map(function (p) { return { id: p.id, pub: false, ba: '' }; }),
      pubName: '', period: '', city: '', area: '', user: '', wish: '', point: '', hideKnow: [], published: false, client: '', addr: '', cost: '' };
    closeQuick(true);
    db.put(d).then(function (rec) {
      Apps.toast('「' + name + '」を保管しました');
      C.setView('works');
      openWork(rec.id);
    }, function (err) { Apps.toast(Apps.errorText(err), true); });
  });

  // ---------- 仕上げ ----------
  function fld(lab, key, o) {
    o = o || {};
    var v = esc(F.d[key] || '');
    var id = 'f-' + key;
    var inner = o.area ? '<textarea class="ax-input" id="' + id + '" rows="' + (o.rows || 3) + '" data-f="' + key + '" placeholder="' + esc(o.ph || '') + '">' + v + '</textarea>'
      : o.sel ? '<select class="ax-input" id="' + id + '" data-f="' + key + '"><option value="">（未選択）</option>' + o.sel.map(function (x) {
        return '<option' + (x === F.d[key] ? ' selected' : '') + '>' + esc(x) + '</option>';
      }).join('') + '</select>'
      : '<input class="ax-input" id="' + id + '" data-f="' + key + '" value="' + v + '" placeholder="' + esc(o.ph || '') + '"' + (o.type ? ' type="' + o.type + '"' : '') +
        (o.mode ? ' inputmode="' + o.mode + '"' : '') + ' maxlength="' + (o.max || 120) + '" autocomplete="off">';
    return '<label class="fld"><span class="lab">' + lab + '</span>' + inner + (o.note ? '<span class="ax-note">' + o.note + '</span>' : '') + '</label>';
  }
  function openFinish(id) {
    var r = wById(id);
    if (!r) return;
    var d = C.copyData(r.data);
    d.photos = photosOf(d).map(function (p) { return { id: p.id, pub: !!p.pub, ba: p.ba || '' }; });
    d.hideKnow = Array.isArray(d.hideKnow) ? d.hideKnow : [];
    F = { id: r.id, d: d, orig: d.photos.map(function (p) { return p.id; }), name0: d.name };
    renderFinish();
    $('finish').hidden = false;
    $('fBody').scrollTop = 0;
  }
  function renderFinish() {
    var d = F.d, used = usedCards(F.name0), ph = d.photos;
    var firstPub = ph.filter(function (p) { return p.pub; })[0];
    var h = '<div class="sec"><h3 class="sec-h">' + EYE + '公開ページに出る項目<small>見る人に見える</small></h3>' +
      fld('公開用の名前', 'pubName', { ph: '例：北区 築40年マンション、回遊できるLDK', note: '案件名（' + esc(d.name) + '）は出ません' }) +
      '<div class="row2">' + fld('時期（完成）', 'period', { type: 'month' }) + fld('広さ（㎡）', 'area', { mode: 'decimal', ph: '例：68', max: 8 }) + '</div>' +
      fld('場所（市区まで）', 'city', { ph: '例：大阪市北区', note: '番地は下の「出ない項目」へ', max: 60 }) +
      fld('エンドユーザー', 'user', { ph: '例：30代ご夫婦＋お子さま1人' }) +
      fld('ご要望', 'wish', { area: true, ph: 'お客様が最初に望んでいたこと' }) +
      fld('こだわり・工夫', 'point', { area: true, rows: 4, ph: 'どう応えたか、どこを工夫したか' }) + '</div>';
    h += '<div class="sec"><h3 class="sec-h">写真<small>押す：ビフォー→アフター→印なし</small></h3>' +
      (ph.length ? '<div class="pgrid">' + ph.map(function (p, i) {
        return '<div class="pcell' + (p.pub ? '' : ' off') + '"><button type="button" class="pba" data-fba="' + i + '" aria-label="ビフォー・アフターの印を切り替え（今：' +
          (p.ba === 'before' ? 'ビフォー' : p.ba === 'after' ? 'アフター' : '印なし') + '）">' + phHtml(p.id, p.ba, 300) + '</button>' +
          '<button type="button" class="pub' + (p.pub ? ' on' : '') + '" data-fpub="' + i + '" aria-pressed="' + !!p.pub + '" aria-label="この写真を公開">' +
          (p.pub ? '<svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>' : '<svg viewBox="0 0 24 24"><path d="M12 6v12M6 12h12"/></svg>') + '</button>' +
          '<button type="button" class="prm" data-frm="' + i + '" aria-label="この写真を外す">×</button>' +
          (p === firstPub ? '<span class="cover">表紙</span>' : '') + '</div>';
      }).join('') + '</div><p class="ax-note">右上の ✓ がついた写真だけが公開ページに出ます。✓の最初の1枚が表紙です。</p>' :
        '<p class="ax-note">写真がまだありません。詳細の「写真をまとめて追加」から入れられます。</p>') + '</div>';
    h += '<div class="sec"><h3 class="sec-h">使った知識<small>名前と種類だけ出ます</small></h3><div>' +
      (used.length ? used.map(function (x) {
        return '<label class="krow" style="--kc:' + C.kindColor(x.r.data.kind) + '"><input type="checkbox" data-fknow="' + esc(x.r.id) + '"' + (d.hideKnow.indexOf(x.r.id) < 0 ? ' checked' : '') + '>' +
          '<span>' + esc(x.r.data.title) + '</span><i>' + esc(C.kindOf(x.r.data.kind).name) + '</i></label>';
      }).join('') : '<p class="ax-note">まだありません</p>') + '</div></div>';
    h += '<div class="sec priv"><h3 class="sec-h">' + LOCK + '公開ページに出ない項目<small>自分だけ</small></h3>' +
      fld('案件名', 'name', { max: 60, note: '変えると、脳みそのカードの「使った案件」の名前も揃えます（確認あり）' }) +
      fld('施主名', 'client', { ph: '例：山田 様' }) + fld('住所（番地まで）', 'addr', { ph: '例：大阪市北区〇〇1-2-3' }) +
      fld('費用帯', 'cost', { sel: COSTS }) +
      fld('メモ', 'memo', { area: true, rows: 4 }) + '</div>';
    var ok = canPublish(d);
    h += '<div class="sec"><div class="sw"><div><b>公開する</b><small id="fPubNote">' + (ok ? 'オンにすると、次の「公開データを書き出す」から公開ページに出ます' : '公開用の名前と、✓の写真1枚以上が必要です') + '</small></div>' +
      '<button type="button" class="tg" id="fPub" aria-pressed="' + !!d.published + '" aria-label="公開する"' + (ok || d.published ? '' : ' disabled') + '></button></div>' +
      (d.published ? '<div class="urlbox">' + esc(PUBLIC_URL + '?w=') + '<em>' + esc(d.slug) + '</em></div>' +
        '<button class="ax-btn" type="button" id="fExport">保存して公開データを書き出す</button>' : '') + '</div>';
    h += '<button class="ax-btn ax-btn-danger" type="button" id="fDelete">この実績を削除</button>';
    $('fBody').innerHTML = h;
  }
  function refreshPubSwitch() {
    var ok = canPublish(F.d);
    if (!ok && F.d.published) { F.d.published = false; renderFinish(); return; }
    $('fPub').disabled = !ok && !F.d.published;
    $('fPubNote').textContent = ok ? 'オンにすると、次の「公開データを書き出す」から公開ページに出ます' : '公開用の名前と、✓の写真1枚以上が必要です';
  }
  $('fBody').addEventListener('input', function (e) {
    var k = e.target.dataset && e.target.dataset.f;
    if (!k || !F) return;
    F.d[k] = e.target.value;
    if (k === 'pubName') refreshPubSwitch();
  });
  $('fBody').addEventListener('change', function (e) {
    var k = e.target.dataset && e.target.dataset.f;
    if (k && F) { F.d[k] = e.target.value; return; }
    var kn = e.target.dataset && e.target.dataset.fknow;
    if (kn && F) {
      F.d.hideKnow = e.target.checked ? F.d.hideKnow.filter(function (x) { return x !== kn; }) : C.uniq(F.d.hideKnow.concat([kn]));
    }
  });
  $('fBody').addEventListener('click', function (e) {
    var t = e.target.closest('button');
    if (!t || !F) return;
    var ph = F.d.photos;
    if (t.dataset.fba != null) { var p = ph[+t.dataset.fba]; p.ba = p.ba === '' ? 'before' : p.ba === 'before' ? 'after' : ''; renderFinish(); return; }
    if (t.dataset.fpub != null) { var q = ph[+t.dataset.fpub]; q.pub = !q.pub; if (F.d.published && !canPublish(F.d)) { F.d.published = false; Apps.toast('公開する写真が無くなったので、公開をオフにしました'); } renderFinish(); return; }
    if (t.dataset.frm != null) { ph.splice(+t.dataset.frm, 1); if (F.d.published && !canPublish(F.d)) F.d.published = false; renderFinish(); return; }
    if (t.id === 'fPub') {
      if (F.d.published) { F.d.published = false; Apps.toast('公開をオフにしました。次の書き出しで公開ページから消えます'); }
      else if (canPublish(F.d)) { F.d.published = true; Apps.toast('公開をオンにしました。保存して書き出すと反映されます'); }
      renderFinish(); return;
    }
    if (t.id === 'fExport') { saveFinish().then(function (ok) { if (ok) openExport(); }); return; }
    if (t.id === 'fDelete') { deleteWork(F.id); }
  });
  // 保存。Promise<boolean>
  function saveFinish() {
    if (!F) return Promise.resolve(false);
    var f = F, d = C.copyData(f.d);
    d.t = 'w';
    d.name = String(d.name || '').trim().slice(0, 60);
    if (!d.name) { Apps.toast('案件名は空にできません', true); $('f-name').focus(); return Promise.resolve(false); }
    if (nameTaken(d.name, f.id)) { Apps.toast('「' + d.name + '」の実績はもうあります', true); return Promise.resolve(false); }
    PUB_TEXT.concat(['client', 'addr', 'cost']).forEach(function (k) { d[k] = String(d[k] || '').trim(); });
    d.memo = String(d.memo || '').replace(/\s+$/, '');
    if (d.published && !canPublish(d)) d.published = false;
    var renamed = d.name !== f.name0 ? usedCards(f.name0) : [];
    var go = renamed.length ? C.ask('使った知識の記録も「' + d.name + '」に揃えますか？',
      '脳みそのカード ' + renamed.length + '件の「使った案件」が「' + f.name0 + '」になっています。揃えないと、この実績に並ばなくなります。', '揃える') : Promise.resolve(false);
    return go.then(function (yes) {
      var removed = f.orig.filter(function (p) { return !d.photos.some(function (x) { return x.id === p; }); });
      var ops = [db.put(d, f.id)];
      if (yes) renamed.forEach(function (x) {
        var cd = C.copyData(x.r.data);
        cd.uses = C.usesOf(cd).map(function (u) { return u.name === f.name0 ? { name: d.name, date: u.date } : u; });
        ops.push(db.put(cd, x.r.id));
      });
      F = null; $('finish').hidden = true;
      return Promise.all(ops).then(function () {
        removed.forEach(function (p) { Apps.deleteImage(C.APP, p).catch(function () {}); });
        Apps.toast('保存しました');
        openWork(f.id);
        return true;
      }, function (e) { Apps.toast(Apps.errorText(e), true); return false; });
    });
  }
  $('fForm').addEventListener('submit', function (e) { e.preventDefault(); saveFinish(); });
  $('fCancel').addEventListener('click', function () { F = null; $('finish').hidden = true; });
  function deleteWork(id) {
    var r = wById(id);
    if (!r) return;
    C.ask('「' + r.data.name + '」を削除しますか？', '写真・メモ・公開用の項目が消えます。脳みそのカードの「使った案件」の記録は残ります。元に戻せません。', '削除する', true).then(function (yes) {
      if (!yes) return;
      var photos = photosOf(r.data).map(function (p) { return p.id; });
      F = null; $('finish').hidden = true;
      W.sel = null; closeWork();
      db.remove(id).then(function () {
        photos.forEach(function (p) { Apps.deleteImage(C.APP, p).catch(function () {}); });
        Apps.toast('削除しました');
      });
    });
  }

  // ---------- 公開ページの見え方（公開ページそのものを枠の中で開き、下書きを渡す） ----------
  $('fPreview').addEventListener('click', function () {
    if (!F) return;
    var d = F.d, item = pubItem(Object.assign({}, d, { name: F.name0 }));
    var others = publishable().filter(function (r) { return r.id !== F.id; }).map(function (r) { return pubItem(r.data); });
    var fr = $('pvFrame');
    fr.onload = function () {
      try { fr.contentWindow.WorksPublic.preview({ v: 1, brand: BRAND, items: [item].concat(others) }, item.w); }
      catch (e) { Apps.toast('見え方を出せませんでした（オンラインで試してください）', true); }
    };
    fr.src = PUBLIC_URL + '?preview=1';
    $('preview').hidden = false;
  });
  $('pvClose').addEventListener('click', function () { $('preview').hidden = true; $('pvFrame').removeAttribute('src'); });

  // ---------- 書き出し ----------
  function lastExport() { var r = db.get(EXPORT_ID); return r && r.data && Array.isArray(r.data.list) ? r.data : null; }
  function openExport() {
    var data = buildPublic(), last = lastExport();
    var bad = publishable().map(function (r) { return { r: r, words: leaks(r.data) }; }).filter(function (x) { return x.words.length; });
    $('exSum').textContent = '公開オンの実績：' + data.items.length + '件。オンの案件だけを works.json にまとめます。';
    $('exStop').hidden = !bad.length;
    $('exStop').innerHTML = bad.length ? '<b>書き出しを止めています</b><p>施主名・番地に入れた文字が、公開する文章に入っています。直してから書き出してください。</p>' +
      bad.map(function (x) {
        return '<div class="ex-bad"><span>' + esc(x.r.data.name) + '：' + x.words.map(function (w) { return '「' + esc(w) + '」'; }).join('') + '</span>' +
          '<button class="ax-btn" type="button" data-exfix="' + esc(x.r.id) + '">直す</button></div>';
      }).join('') : '';
    var cur = data.items.map(function (x) { return { w: x.w, title: x.title }; });
    var diff = [];
    if (last) {
      cur.forEach(function (x) { if (!last.list.some(function (y) { return y.w === x.w; })) diff.push('<div><span class="y">増えた</span><span>' + esc(x.title) + '</span></div>'); });
      last.list.forEach(function (y) { if (!cur.some(function (x) { return x.w === y.w; })) diff.push('<div><span class="n">消えた</span><span>' + esc(y.title) + '</span></div>'); });
      if (!diff.length) diff.push('<div><span class="y">—</span><span>変わりなし（前回 ' + esc(C.localDay(last.at)) + '）</span></div>');
    } else {
      diff = cur.map(function (x) { return '<div><span class="y">増えた</span><span>' + esc(x.title) + '</span></div>'; });
      diff.unshift('<div><span class="y">—</span><span>はじめての書き出しです</span></div>');
    }
    $('exDiff').innerHTML = diff.join('');
    $('exText').value = bad.length ? '' : JSON.stringify(data, null, 2);
    $('exDownload').disabled = $('exCopy').disabled = !!bad.length;
    $('exportSheet').hidden = false;
    return data;
  }
  function remember() {
    var data = JSON.parse($('exText').value || '{"items":[]}');
    return db.put({ t: 'wexport', at: new Date().toISOString(), list: data.items.map(function (x) { return { w: x.w, title: x.title }; }) }, EXPORT_ID);
  }
  $('exDownload').addEventListener('click', function () {
    if (!$('exText').value) return;
    var blob = new Blob([$('exText').value], { type: 'application/json' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = 'works.json';
    document.body.appendChild(a); a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    remember().then(function () { Apps.toast('works.json を書き出しました。brain/public/ に置くと反映されます'); });
  });
  $('exCopy').addEventListener('click', function () {
    if (!$('exText').value) return;
    copyText($('exText').value, 'コピーしました').then(function (ok) { if (ok) remember(); });
  });
  $('exClose').addEventListener('click', function () { $('exportSheet').hidden = true; });
  $('exStop').addEventListener('click', function (e) {
    var b = e.target.closest('[data-exfix]');
    if (b) { $('exportSheet').hidden = true; C.setView('works'); openWork(b.dataset.exfix); openFinish(b.dataset.exfix); }
  });
  function copyText(t, msg) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(t).then(function () { Apps.toast(msg); return true; }, function () { Apps.toast('コピーできませんでした', true); return false; });
    }
    Apps.toast('コピーできませんでした', true);
    return Promise.resolve(false);
  }

  // ---------- 全体 ----------
  function render() {
    if (W.sel && !wById(W.sel)) W.sel = null;
    renderList(); renderDetail();
  }
  db.onChange(function () { render(); });
  render();

  window.BrainWorks = {
    render: render,
    quick: function () { quick(''); },
    names: names,
    openExport: openExport,
    onWide: function () { if (C.wide.matches) closeWork(); },
    onEscape: function () {
      if (!$('preview').hidden) { $('pvClose').click(); return true; }
      if (!$('exportSheet').hidden) { $('exportSheet').hidden = true; return true; }
      if (!$('finish').hidden) { $('fCancel').click(); return true; }
      if (!$('quick').hidden) { closeQuick(false); return true; }
      return false;
    },
    closeWork: closeWork,
    // 試験用
    _buildPublic: buildPublic, _leaks: leaks
  };
})();
