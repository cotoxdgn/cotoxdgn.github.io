/* 予定合わせ（自分用・1版目）
 * レコード（シート app=yotei。ふつうの put / list / delete で同期。形は gas/Code.gs の「予定合わせ」を参照）
 *   id = ev-xxxx   data = { kind:'event', title, start, end, from, to, step, need, deadline, token, mine:[…], status, decided }
 *   token は端末で作る（crypto の乱数・英数字32文字）。「リンクを作り直す」は token を替えて put するだけ。
 * 相手の答えは yoteiResults で取り寄せる（端末の控え：Apps._kv 'yotei:answers'）。
 * カレンダーは「作る」「カレンダーから塗り直す」の時だけ読み（yoteiCal：時刻だけ）、
 * 「カレンダーに入れる」→確認の「入れる」の時だけ1件書く（yoteiCreateEvent）。
 */
(function () {
  'use strict';
  var APP = 'yotei';
  var ME = 'コト（自分）';
  var G = window.YoteiGrid;
  var $ = function (id) { return document.getElementById(id); };
  var esc = G.esc;
  var db = Apps.collection(APP);
  var wideMq = window.matchMedia('(min-width: 820px)');
  var S = { view: 'list', id: null, draft: null, editing: false, mine: {}, busy: null, week: 0, rweek: 0,
    answers: {}, pick: 0, sel: null, step: 30, need: 60, deadTouched: false, cands: [] };

  var YERR = {
    calendar: 'カレンダーを使う許可がまだありません。スプシの Apps Script で関数「authorizeCalendar」を実行して許可し、［デプロイを管理］→新バージョンで更新してください',
    already: 'もう決定済みです',
    bad_time: '日時が期間の外です',
    bad_action: 'スプシのプログラムが古いままです。Code.gs を貼り替えて［デプロイを管理］→新バージョンで更新してください'
  };
  function errText(e) {
    var c = e && (e.code || e.message);
    if (c === 'calendar' && e.detail && !/permission|権限|authoriz|許可/i.test(e.detail)) return 'カレンダーでエラーが起きました（' + String(e.detail).slice(0, 80) + '）';
    return YERR[c] || Apps.errorText(e);
  }
  function online() { return navigator.onLine !== false; }

  // ---------- 小物 ----------
  function newToken() {
    var A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789', out = '', buf = new Uint8Array(64);
    while (out.length < 32) {
      crypto.getRandomValues(buf);
      for (var i = 0; i < buf.length && out.length < 32; i++) if (buf[i] < 248) out += A.charAt(buf[i] % 62);
    }
    return out;
  }
  function isoAt(ymd, min) { return new Date(G.dayMs(ymd) + min * 60000).toISOString(); }
  function perPage() { return wideMq.matches ? 14 : 7; }
  function rowH(ev) { return wideMq.matches ? (ev.step === 60 ? 34 : 22) : (ev.step === 60 ? 30 : 19); }
  function events() { return db.all().filter(function (r) { return r.data && r.data.kind === 'event'; }); }
  function rec() { return S.id ? db.get(S.id) : null; }
  function localState(d) {
    if (d.status === 'decided') return 'decided';
    if (d.status !== 'open') return 'closed';
    var t = G.today();
    if (t > d.deadline || t > d.end) return 'closed';
    return 'open';
  }
  function hours(min) { return (Math.round(min / 6) / 10) + '時間'; }
  function weekNav(sh, page, attr) {
    var n = G.pages(sh, perPage());
    if (n < 2) return '';
    var ds = G.pageDays(sh, page, perPage());
    return '<button class="btn" type="button" ' + attr + '="-1"' + (page ? '' : ' disabled') + '>‹ 前の週</button><b>' +
      G.label(sh.dates[ds[0]]) + '〜' + G.label(sh.dates[ds[ds.length - 1]]) + '</b><button class="btn" type="button" ' + attr + '="1"' +
      (page < n - 1 ? '' : ' disabled') + '>次の週 ›</button>';
  }

  // ---------- 画面の切り替え ----------
  function go(v) {
    S.view = v;
    document.querySelectorAll('.scr').forEach(function (x) { x.classList.toggle('on', x.id === 'v-' + v); });
    $('v-result').classList.toggle('wide', true);
    $('sheet').hidden = true;
    render();
    var b = document.querySelector('.scr.on .body'); if (b) b.scrollTop = 0;
  }
  function render() {
    if (S.view === 'list') renderList();
    else if (S.view === 'mine') renderMine();
    else if (S.view === 'share') renderShare();
    else if (S.view === 'result') renderResult();
  }

  // ---------- 一覧 ----------
  function renderList() {
    var list = events();
    $('evEmpty').hidden = list.length > 0;
    $('evs').innerHTML = list.map(function (r) {
      var d = r.data, st = localState(d), n = (S.answers[r.id] || []).length;
      var sub = st === 'decided' && d.decided ? G.rangeText(d.decided.start, d.decided.end)
        : G.periodText(d).replace(/\([^)]*\)/g, '') + '・答えた人 ' + n + '人' + (st === 'closed' ? '・受付終了' : '');
      var lab = st === 'decided' ? '決定' : st === 'open' ? '受付中' : '締切';
      return '<button class="ev" type="button" data-id="' + esc(r.id) + '"><b>' + esc(d.title) + '</b><small>' + esc(sub) +
        (r.pending ? '・未送信' : '') + '</small><span class="st ' + (st === 'decided' ? 'done' : st) + '">' + lab + '</span></button>';
    }).join('');
  }

  // ---------- 作る ----------
  function initCreate() {
    var o1 = '', o2 = '';
    for (var h = 0; h < 24; h++) o1 += '<option value="' + h + '">' + h + ':00</option>';
    for (var h2 = 1; h2 <= 24; h2++) o2 += '<option value="' + h2 + '">' + h2 + ':00</option>';
    $('cFrom').innerHTML = o1; $('cTo').innerHTML = o2;
  }
  function resetCreate() {
    var s = G.addDays(G.today(), 2);
    $('cName').value = '';
    $('cStart').value = s; $('cEnd').value = G.addDays(s, 6);
    $('cFrom').value = '9'; $('cTo').value = '21';
    $('cDead').value = G.addDays(s, -1);
    S.step = 30; S.need = 60; S.deadTouched = false;
    $('cErr').hidden = true;
    segs();
  }
  function segs() {
    $('stepSeg').innerHTML = [[30, '30分'], [60, '1時間']].map(function (x) {
      return '<button type="button" class="' + (S.step === x[0] ? 'on' : '') + '" data-step="' + x[0] + '" aria-pressed="' + (S.step === x[0]) + '">' + x[1] + '</button>';
    }).join('');
    $('needSeg').innerHTML = [[30, '30分'], [60, '1時間'], [90, '1.5時間'], [120, '2時間']].map(function (x) {
      var ok = x[0] >= S.step && x[0] % S.step === 0;
      return '<button type="button" class="' + (S.need === x[0] ? 'on' : '') + '" data-need="' + x[0] + '" aria-pressed="' + (S.need === x[0]) + '"' + (ok ? '' : ' disabled') + '>' + x[1] + '</button>';
    }).join('');
  }
  function readCreate() {
    var d = { kind: 'event', title: $('cName').value.trim(), start: $('cStart').value, end: $('cEnd').value,
      from: +$('cFrom').value, to: +$('cTo').value, step: S.step, need: S.need, deadline: $('cDead').value };
    var ymd = /^\d{4}-\d{2}-\d{2}$/;
    if (!d.title) return { error: '名前を入れてください' };
    if (!ymd.test(d.start) || !ymd.test(d.end)) return { error: '期間を入れてください' };
    var n = G.diffDays(d.start, d.end) + 1;
    if (n < 1) return { error: '期間のおわりが、はじまりより前です' };
    if (n > 14) return { error: '期間は14日までです（いまは' + n + '日）' };
    if (d.from >= d.to) return { error: '時間帯のおわりが、はじまりより前です' };
    if (d.need > (d.to - d.from) * 60) return { error: '必要な長さが時間帯より長いです' };
    if (!ymd.test(d.deadline)) return { error: '締切を入れてください' };
    if (d.deadline > d.end) return { error: '締切は期間のおわり以前にしてください' };
    if (d.deadline < G.today()) return { error: '締切がもう過ぎています' };
    return { data: d };
  }

  // ---------- 自分の空き ----------
  function curEv() { return S.editing ? rec().data : S.draft; }
  function setBanner(kind, msg) {
    var b = $('calBanner');
    b.className = 'banner' + (kind === 'err' ? ' warn' : '');
    var icon = '<svg viewBox="0 0 24 24"><rect x="4" y="5" width="16" height="15" rx="2"/><path d="M4 10h16M9 3v4M15 3v4"/></svg>';
    b.innerHTML = icon + '<span>' + msg + '</span>';
  }
  function fillFromCal() {
    var ev = curEv(), sh = G.shape(ev);
    setBanner('', 'Googleカレンダーを読んでいます…');
    $('refill').disabled = true;
    return Apps.ensureConnected(APP).then(function () {
      return Apps.call(APP, 'yoteiCal', { from: ev.start, to: ev.end });
    }).then(function (res) {
      var list = (res.busy || []).map(function (b) { return [Date.parse(b.s), Date.parse(b.e)]; });
      var busy = {}, mine = {};
      for (var d = 0; d < sh.days; d++) for (var r = 0; r < sh.rows; r++) {
        var cr = G.cellRange(ev, sh, d, r), k = d + '-' + r;
        if (list.some(function (b) { return b[0] < cr[1] && cr[0] < b[1]; })) busy[k] = 1; else mine[k] = 1;
      }
      S.busy = busy; S.mine = mine;
      setBanner('', 'Googleカレンダーの予定から塗りました。<br><span class="note">斜線＝予定あり。なぞって直せます。</span>');
    }, function (e) {
      setBanner('err', 'カレンダーを読めませんでした。空いている時間をなぞって塗ってください。<br><span class="note">' + esc(errText(e)) + '</span>');
    }).then(function () { $('refill').disabled = false; if (S.view === 'mine') drawMine(); });
  }
  function drawMine() {
    var ev = curEv(), sh = G.shape(ev);
    var n = G.pages(sh, perPage()); if (S.week >= n) S.week = n - 1;
    $('mineWeek').innerHTML = weekNav(sh, S.week, 'data-mw');
    $('mineWeek').hidden = n < 2;
    G.draw($('gMine'), { ev: ev, sh: sh, days: G.pageDays(sh, S.week, perPage()), mode: 'paint', set: S.mine, busy: S.busy, rowH: rowH(ev) });
    mineCount();
  }
  function mineCount() { $('mineCnt').textContent = '空き 合計' + hours(G.count(S.mine) * curEv().step); }
  function renderMine() {
    drawMine();
    $('mineDone').textContent = S.editing ? '保存する' : '相手用リンクを作る';
  }
  function saveMine() {
    var ev = curEv(), sh = G.shape(ev), mine = G.toStrings(S.mine, sh);
    if (S.editing) {
      var r = rec(), d = Object.assign({}, r.data, { mine: mine });
      return db.put(d, r.id).then(function () { go('result'); Apps.toast('自分の空きを保存しました'); });
    }
    var id = 'ev-' + Apps.uuid().replace(/-/g, '').slice(0, 20);
    var data = Object.assign({}, S.draft, { token: newToken(), mine: mine, status: 'open' });
    return db.put(data, id).then(function () { S.id = id; S.draft = null; go('share'); });
  }

  // ---------- 送る ----------
  function guestLink(d) {
    var base = new URL('a/', location.href.split('#')[0]).href;
    var c = Apps.getConnection(APP), tail = '';
    if (!(window.YOTEI_ENDPOINT && c && c.url === window.YOTEI_ENDPOINT)) {
      var m = /\/macros\/s\/([A-Za-z0-9_-]+)\/exec/.exec(c ? c.url : '');
      if (m) tail = '.' + m[1];
    }
    return { url: base + '#' + d.token + tail, base: base, tail: tail };
  }
  function renderShare() {
    var r = rec(); if (!r) return go('list');
    var d = r.data, l = guestLink(d);
    $('linkBox').innerHTML = esc(l.base.replace(/^https?:\/\//, '')) + '#<em>' + esc(d.token) + '</em>' + (l.tail ? '<i>' + esc(l.tail) + '</i>' : '');
    $('linkBox').dataset.url = l.url;
    $('pvName').textContent = d.title;
    $('pvTime').textContent = G.periodText(d) + '　' + G.hoursText(d) + '　' + (d.step === 60 ? '1時間' : '30分') + 'ごと';
    $('pvDead').textContent = '締切 ' + G.label(d.deadline);
  }
  function copyLink() {
    var url = $('linkBox').dataset.url;
    var done = function () { Apps.toast('リンクをコピーしました'); };
    var fallback = function () {
      var ta = document.createElement('textarea'); ta.value = url; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); done(); } catch (e) { Apps.toast('コピーできませんでした。リンクを長押ししてコピーしてください', true); }
      ta.remove();
    };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(url).then(done, fallback); else fallback();
  }
  function shareLink() {
    var r = rec(), url = $('linkBox').dataset.url;
    if (!navigator.share) return copyLink();
    navigator.share({ title: r.data.title, text: '予定合わせのお願いです。空いている時間をなぞって送ってください（締切 ' + G.label(r.data.deadline) + '）', url: url })
      .catch(function () { /* やめた */ });
  }

  // ---------- 結果 ----------
  function people(id, d) {
    var list = [{ name: ME, me: true, cells: d.mine }];
    (S.answers[id] || []).forEach(function (a) { list.push({ name: a.name, cells: a.cells, at: a.updatedAt }); });
    return list;
  }
  function renderResult() {
    var r = rec(); if (!r) return go('list');
    var d = r.data, sh = G.shape(d), ppl = people(r.id, d), total = ppl.length, st = localState(d);
    var countAt = function (dd, rr) { var n = 0; ppl.forEach(function (p) { if (G.on(p.cells, dd, rr)) n++; }); return n; };
    S.cands = G.candidates(d, sh, countAt, total);
    if (S.pick >= S.cands.length) S.pick = 0;
    var c0 = S.cands[S.pick], needRows = Math.round(d.need / d.step);
    var pickAt = function (dd, rr) {
      if (!c0 || st === 'decided' || c0.d !== dd || rr < c0.s || rr >= c0.s + needRows) return '';
      return ' pick' + (rr === c0.s ? ' p0' : '') + (rr === c0.s + needRows - 1 ? ' p1' : '');
    };
    $('rTitle').textContent = d.title;
    // 決定・状態
    var ok = '<svg viewBox="0 0 24 24"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>';
    $('rDecided').innerHTML = st === 'decided' && d.decided
      ? '<div class="done-banner">' + ok + '<span><b>決定：' + esc(G.rangeText(d.decided.start, d.decided.end)) + '</b><br><span class="note">Googleカレンダーに入れました。受付は締め切りました。</span></span></div>'
      : '<p class="note">' + (st === 'open' ? '受付中（締切 ' + esc(G.label(d.deadline)) + '）' : '受付は終わっています') + '　' + esc(G.periodText(d)) + ' ' + esc(G.hoursText(d)) + '</p>';
    // 候補
    $('cands').innerHTML = S.cands.length ? S.cands.map(function (c, i) {
      return '<button class="cand' + (i === S.pick && st !== 'decided' ? ' on' : '') + '" type="button" data-pick="' + i + '"><span class="no">' + (i + 1) + '</span><span><b>' +
        esc(G.label(c.ymd)) + ' ' + G.hm(c.startMin) + '〜' + G.hm(c.endMin) + '</b><small>' +
        (c.allMin > c.endMin ? G.hm(c.allMin) + 'まで続けて空き' : 'ちょうど' + (d.need >= 60 ? hours(d.need) : d.need + '分')) + '</small></span><span class="who">' + c.k + '/' + total + '人</span></button>';
    }).join('') : '<p class="note">' + (total < 2 ? 'まだ誰も答えていません。' : '全員が空いている時間がまだありません。') + '</p>';
    // 凡例
    var ramp = '';
    for (var k = 0; k <= total; k++) ramp += '<i style="background:' + (k ? 'color-mix(in srgb, var(--heat) ' + Math.round(14 + 78 * k / total) + '%, var(--heat-0))' : 'var(--heat-0)') + '"></i>';
    $('rLegend').innerHTML = '<span>空きの人数 0<span class="ramp">' + ramp + '</span>' + total + '人</span>' + (st !== 'decided' ? '<span><i style="border:2px solid var(--red)"></i>選んだ候補</span>' : '');
    // マス目
    var n = G.pages(sh, perPage()); if (S.rweek >= n) S.rweek = n - 1;
    if (c0 && st !== 'decided' && S.pickJump) { S.rweek = Math.floor(c0.d / perPage()); S.pickJump = false; }
    $('rWeek').innerHTML = weekNav(sh, S.rweek, 'data-rw');
    $('rWeek').hidden = n < 2;
    G.draw($('gHeat'), { ev: d, sh: sh, days: G.pageDays(sh, S.rweek, perPage()), mode: 'heat', countAt: countAt, total: total, pickAt: pickAt, sel: S.sel, rowH: rowH(d), timeW: wideMq.matches ? 46 : 38 });
    renderCell(d, sh, ppl);
    $('ppl').innerHTML = ppl.map(function (p) {
      return '<span class="pp y">' + esc(p.name) + (p.at ? ' ' + esc(G.label(G.ymdOf(Date.parse(p.at))).replace(/\(.*$/, '')) : '') + '</span>';
    }).join('');
    // 操作
    var adm = [];
    if (st !== 'decided') adm.push('<button class="btn sm" type="button" data-adm="mine">自分の空きを直す</button>');
    if (d.status === 'open' && st !== 'decided') adm.push('<button class="btn sm" type="button" data-adm="close">受付を締め切る</button>');
    if (d.status === 'closed') adm.push('<button class="btn sm" type="button" data-adm="reopen">受付を再開する</button>');
    adm.push('<button class="btn sm danger" type="button" data-adm="delete">この予定合わせを消す</button>');
    $('rAdmin').innerHTML = adm.join('');
    var lbl = st === 'decided' ? '決定済み' : S.cands.length ? (S.pick + 1) + '番目の候補をカレンダーに入れる' : '候補がまだありません';
    ['calBtn', 'calBtn2'].forEach(function (b) { $(b).textContent = lbl; $(b).disabled = st === 'decided' || !S.cands.length; });
  }
  function renderCell(d, sh, ppl) {
    if (!S.sel) { $('rCell').innerHTML = '<span class="note">' + (wideMq.matches ? 'マスにマウスを乗せる（押す）と' : 'マスを押すと') + '、そのマスで空いている人が出ます。</span>'; return; }
    var dd = S.sel[0], rr = S.sel[1], m = G.rowMin(d, rr);
    $('rCell').innerHTML = '<b>' + esc(G.label(sh.dates[dd])) + ' ' + G.hm(m) + '〜' + G.hm(m + d.step) + '</b><div class="ppl">' + ppl.map(function (p) {
      var y = G.on(p.cells, dd, rr); return '<span class="pp ' + (y ? 'y' : 'n') + '">' + esc(p.name) + '</span>';
    }).join('') + '</div>';
  }

  // ---------- カレンダーに入れる ----------
  function openCal() {
    var r = rec(), c = S.cands[S.pick];
    if (!r || !c || r.data.status === 'decided') return;
    var names = (S.answers[r.id] || []).map(function (a) { return a.name; });
    $('shKv').innerHTML = '<dt>件名</dt><dd>' + esc(r.data.title) + '</dd><dt>日時</dt><dd>' + esc(G.label(c.ymd)) + ' ' + G.hm(c.startMin) + '〜' + G.hm(c.endMin) +
      '</dd><dt>メモ</dt><dd>参加：' + esc(names.join('・') || '（答えた人なし）') + '</dd>';
    $('calDo').disabled = false;
    $('sheet').hidden = false;
    $('calDo').focus();
  }
  function doCal() {
    var r = rec(), c = S.cands[S.pick];
    if (!r || !c) return;
    $('calDo').disabled = true;
    // 送信待ちを先に送ってから（あとから古い内容で「決定」が上書きされないように）
    Apps.flush().then(function () {
      return Apps.call(APP, 'yoteiCreateEvent', { id: r.id, start: isoAt(c.ymd, c.startMin), end: isoAt(c.ymd, c.endMin) }, { timeout: 60000 });
    }).then(function () {
      $('sheet').hidden = true;
      Apps.toast('Googleカレンダーに入れました');
      return db.sync();
    }, function (e) {
      $('calDo').disabled = false;
      if (e && e.code === 'already') { $('sheet').hidden = true; db.sync().catch(function () {}); }
      Apps.toast(errText(e), true);
    }).then(render, function () {});
  }

  // ---------- 相手の答え ----------
  function loadAnswers(manual) {
    if (!Apps.isConnected(APP) || !online()) return Promise.resolve();
    return Apps.call(APP, 'yoteiResults', {}).then(function (res) {
      S.answers = res.answers || {};
      Apps._kv.set('yotei:answers', S.answers).catch(function () {});
      if (S.view === 'list' || S.view === 'result') render();
    }, function (e) { if (manual) Apps.toast(errText(e), true); });
  }
  function updatePend() {
    Apps.pendingCount(APP).then(function (n) { $('pend').hidden = !n; $('pend').textContent = '未送信 ' + n; });
  }

  // ---------- 操作 ----------
  document.addEventListener('click', function (e) {
    var t = e.target.closest('button'); if (!t || t.disabled) return;
    var ds = t.dataset;
    if (ds.go) return go(ds.go);
    if (ds.id) { S.id = ds.id; S.pick = 0; S.sel = null; S.rweek = 0; S.pickJump = true; go('result'); loadAnswers(); return; }
    if (ds.step) { S.step = +ds.step; if (S.need < S.step || S.need % S.step) S.need = S.step === 60 ? 60 : S.need; segs(); return; }
    if (ds.need) { S.need = +ds.need; segs(); return; }
    if (ds.mw) { S.week += +ds.mw; drawMine(); return; }
    if (ds.rw) { S.rweek += +ds.rw; renderResult(); return; }
    if (ds.pick !== undefined) { S.pick = +ds.pick; S.pickJump = true; renderResult(); return; }
    if (ds.adm) return admin(ds.adm);
  });
  function admin(a) {
    var r = rec(); if (!r) return;
    if (a === 'mine') { S.editing = true; S.mine = G.toSet(r.data.mine); S.busy = null; S.week = 0; setBanner('', '保存してある自分の空きです。<br><span class="note">「カレンダーから塗り直す」で、今の予定から塗り直せます。</span>'); go('mine'); return; }
    if (a === 'close') { db.put(Object.assign({}, r.data, { status: 'closed' }), r.id).then(function () { Apps.toast('受付を締め切りました'); render(); }); return; }
    if (a === 'reopen') {
      if (G.today() > r.data.deadline) { Apps.toast('締切日が過ぎているので再開できません', true); return; }
      db.put(Object.assign({}, r.data, { status: 'open' }), r.id).then(function () { Apps.toast('受付を再開しました'); render(); }); return;
    }
    if (a === 'delete') {
      if (!confirm('「' + r.data.title + '」を消しますか？相手用リンクも使えなくなり、答えも消えます。')) return;
      db.remove(r.id).then(function () { S.id = null; go('list'); Apps.toast('消しました'); });
    }
  }
  $('newBtn').addEventListener('click', function () { resetCreate(); go('create'); $('cName').focus(); });
  $('connBtn').addEventListener('click', function () { Apps.openConnectSheet(APP); });
  $('cStart').addEventListener('change', function () {
    if (!S.deadTouched && $('cStart').value) $('cDead').value = G.addDays($('cStart').value, -1);
    if ($('cStart').value && (!$('cEnd').value || $('cEnd').value < $('cStart').value)) $('cEnd').value = G.addDays($('cStart').value, 6);
  });
  $('cDead').addEventListener('change', function () { S.deadTouched = true; });
  $('toMine').addEventListener('click', function () {
    var r = readCreate();
    if (r.error) { $('cErr').textContent = r.error; $('cErr').hidden = false; return; }
    $('cErr').hidden = true;
    S.draft = r.data; S.editing = false; S.mine = {}; S.busy = null; S.week = 0;
    go('mine');
    fillFromCal();
  });
  $('mineBack').addEventListener('click', function () { go(S.editing ? 'result' : 'create'); });
  $('refill').addEventListener('click', function () { fillFromCal().then(function () { Apps.toast('カレンダーの予定から塗り直しました'); }); });
  $('mineDone').addEventListener('click', function () { saveMine(); });
  $('copyBtn').addEventListener('click', copyLink);
  $('shareBtn').addEventListener('click', shareLink);
  $('reissue').addEventListener('click', function () {
    var r = rec(); if (!r) return;
    if (!confirm('新しいリンクを作りますか？前に送ったリンクは使えなくなります（もらった答えは残ります）。')) return;
    db.put(Object.assign({}, r.data, { token: newToken() }), r.id).then(function () { renderShare(); Apps.toast('新しいリンクを作りました。古いリンクは使えません'); });
  });
  $('toResult').addEventListener('click', function () { S.pick = 0; S.sel = null; S.rweek = 0; go('result'); loadAnswers(); });
  $('rShare').addEventListener('click', function () { go('share'); });
  $('calBtn').addEventListener('click', openCal);
  $('calBtn2').addEventListener('click', openCal);
  $('calCancel').addEventListener('click', function () { $('sheet').hidden = true; });
  $('calDo').addEventListener('click', doCal);
  $('sheet').addEventListener('click', function (e) { if (e.target === $('sheet')) $('sheet').hidden = true; });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') $('sheet').hidden = true; });

  G.paintable($('gMine'), function () { return S.mine; }, mineCount);
  function heatPick(e) {
    var c = e.target.closest && e.target.closest('.c'); if (!c) return;
    S.sel = [+c.dataset.d, +c.dataset.r]; renderResult();
  }
  $('gHeat').addEventListener('click', heatPick);
  $('gHeat').addEventListener('mouseover', function (e) {
    if (!wideMq.matches) return;
    var c = e.target.closest && e.target.closest('.c'); if (!c) return;
    var r = rec(); if (!r) return;
    S.sel = [+c.dataset.d, +c.dataset.r];
    renderCell(r.data, G.shape(r.data), people(r.id, r.data));
  });
  var onWide = function () { render(); };
  if (wideMq.addEventListener) wideMq.addEventListener('change', onWide); else if (wideMq.addListener) wideMq.addListener(onWide);

  // ---------- 起動 ----------
  initCreate();
  db.onChange(function () { if (S.view === 'list' || S.view === 'result' || S.view === 'share') render(); });
  Apps.on('queue', updatePend);
  Apps.on('error', function (d) { if (d.during === 'flush' && d.id) Apps.toast(errText(d.error), true); });
  Apps._kv.get('yotei:answers').then(function (a) { if (a && !Object.keys(S.answers).length) { S.answers = a; render(); } }).catch(function () {});
  updatePend();
  go('list');
  Apps.ensureConnected(APP).then(function () { return db.sync().catch(function () {}); }).then(function () { return loadAnswers(); });
  document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible') loadAnswers(); });
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(function () {});
  window.__yotei = { S: S, db: db };
})();
