/* 予定合わせ（相手用）：登録なし・合言葉なし。リンクの # の後ろの32文字（＋任意で「.デプロイID」）だけで答える。
 * 使う窓口は yoteiGet（予定合わせの名前・期間・時間帯・締切・状態）と yoteiAnswer（名前と塗ったマス）の2つだけ。
 * 自分の答えは、この端末（localStorage）にだけ控える。他の人の名前・答えはスプシからも返ってこない。
 */
(function () {
  'use strict';
  var G = window.YoteiGrid;
  var $ = function (id) { return document.getElementById(id); };
  var HASH_RE = /^#([A-Za-z0-9]{32})(?:\.([A-Za-z0-9_-]{3,120}))?$/;
  var S = { token: '', endpoint: '', ev: null, sh: null, name: '', cells: {}, week: 0, saved: null, sending: false };
  var ERR = {
    full: '答えられる人数（5人）に達しているため、送れませんでした。コトさんに連絡してください。',
    too_many_edits: '直せる回数（20回）を超えたため、送れませんでした。コトさんに連絡してください。',
    too_many: '短い時間に送られた回数が多いため、いったん止めています。しばらくしてから送ってください。',
    busy: '混み合っています。少し待ってからもう一度送ってください。',
    bad_name: 'お名前を1〜20文字で入れてください。',
    bad_cells: '送れませんでした。ページを開き直してから、もう一度塗ってください。',
    too_long: '送れませんでした。ページを開き直してから、もう一度塗ってください。',
    network: '通信できませんでした。電波を確認して、もう一度送ってください。'
  };

  function ls(k, v) {
    try {
      if (v === undefined) { var x = localStorage.getItem(k); return x ? JSON.parse(x) : null; }
      localStorage.setItem(k, JSON.stringify(v));
    } catch (e) { /* 保存できない設定のときは、この画面の間だけ覚える */ }
    return null;
  }
  function device() {
    var d = ls('yotei.g.device');
    if (typeof d === 'string' && /^[A-Za-z0-9_-]{16,64}$/.test(d)) return d;
    if (S.dev) return S.dev;
    var A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789', b = new Uint8Array(24), s = '';
    crypto.getRandomValues(b);
    for (var i = 0; i < b.length; i++) s += A.charAt(b[i] % 62);
    S.dev = s;
    ls('yotei.g.device', s);
    return s;
  }

  function api(action, params) {
    var body = { action: action, token: S.token };
    for (var k in params || {}) body[k] = params[k];
    var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, 30000) : null;
    return fetch(S.endpoint, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(body),
      redirect: 'follow', credentials: 'omit', referrerPolicy: 'no-referrer', signal: ctrl ? ctrl.signal : undefined })
      .then(function (r) { return r.text(); })
      .then(function (t) { if (timer) clearTimeout(timer); var d; try { d = JSON.parse(t); } catch (e) { d = { ok: false, error: 'network' }; } return d; },
        function () { if (timer) clearTimeout(timer); return { ok: false, error: 'network' }; });
  }

  function show(id) {
    document.querySelectorAll('.scr').forEach(function (x) { x.classList.toggle('on', x.id === id); });
    var b = document.querySelector('.scr.on .body'); if (b) b.scrollTop = 0;
  }
  function message(head, text, opts) {
    opts = opts || {};
    $('mTitle').textContent = opts.title || '予定合わせ';
    $('mMeta').textContent = opts.meta || '';
    $('mHead').textContent = head;
    $('mText').textContent = text;
    $('mMark').className = 'mk' + (opts.ok ? '' : ' off');
    $('mMark').innerHTML = opts.ok ? '<svg viewBox="0 0 24 24"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>' : '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg>';
    $('mBox').hidden = false;
    $('mRetry').hidden = !opts.retry;
    show('g-msg');
  }
  function notFound() {
    message('見つかりません', 'このリンクの予定合わせは見つかりませんでした。リンクが途中で切れていないか、送ってくれた人に確かめてください。');
  }

  function fillHeads() {
    var ev = S.ev;
    document.querySelectorAll('.gTitle').forEach(function (x) { x.textContent = ev.title; });
    document.querySelectorAll('.gMeta').forEach(function (x) { x.textContent = G.periodText(ev) + '　' + G.hoursText(ev); });
  }

  function load() {
    $('mBox').hidden = true; $('mRetry').hidden = true; $('mTitle').textContent = '読み込んでいます…'; $('mMeta').textContent = '';
    show('g-msg');
    var m = HASH_RE.exec(location.hash || '');
    S.token = m ? m[1] : '';
    S.endpoint = m && m[2] ? 'https://script.google.com/macros/s/' + m[2] + '/exec' : (window.YOTEI_ENDPOINT || '');
    if (!S.token || !/^https:\/\/script\.google\.com\//.test(S.endpoint)) return notFound();
    api('yoteiGet').then(function (res) {
      if (!res.ok) {
        if (res.error === 'not_found') return notFound();
        return message('読み込めませんでした', ERR[res.error] || ERR.network, { retry: true });
      }
      var ev = res.event;
      S.ev = ev; S.sh = G.shape(ev);
      if (ev.state !== 'open') {
        var meta = G.periodText(ev) + '　' + G.hoursText(ev);
        if (ev.state === 'decided' && ev.decided && ev.decided.start) {
          return message('受付は終わりました', 'この日時に決まりました：' + G.rangeText(ev.decided.start, ev.decided.end), { title: ev.title, meta: meta, ok: true });
        }
        return message('受付は終わりました', '締切を過ぎたか、受付が締め切られました。', { title: ev.title, meta: meta });
      }
      fillHeads();
      S.saved = ls('yotei.g.' + S.token);
      if (S.saved && S.saved.name) {
        S.name = S.saved.name;
        S.cells = G.toSet(S.saved.cells);
        $('doneHead').textContent = '送ってあります';
        $('doneNote').textContent = '前に送った答え（' + S.saved.name + ' さん）を、締切（' + G.label(ev.deadline) + '）まで直せます。';
        show('g-done');
      } else {
        $('nameNote').textContent = '登録やアプリは要りません。答えはコトさんだけが見ます。締切は ' + (ev.deadline ? G.label(ev.deadline) : '期間の前') + ' です。';
        show('g-name');
      }
    });
  }

  function drawGrid() {
    var n = G.pages(S.sh, 7); if (S.week >= n) S.week = n - 1;
    var ds = G.pageDays(S.sh, S.week, 7);
    $('gWeek').hidden = n < 2;
    $('gWeek').innerHTML = n < 2 ? '' : '<button class="btn" type="button" data-wk="-1"' + (S.week ? '' : ' disabled') + '>‹ 前の週</button><b>' +
      G.label(S.sh.dates[ds[0]]) + '〜' + G.label(S.sh.dates[ds[ds.length - 1]]) + '</b><button class="btn" type="button" data-wk="1"' + (S.week < n - 1 ? '' : ' disabled') + '>次の週 ›</button>';
    G.draw($('gGrid'), { ev: S.ev, sh: S.sh, days: ds, mode: 'paint', set: S.cells, rowH: S.ev.step === 60 ? 30 : 19 });
    counts();
  }
  function counts() {
    var n = G.count(S.cells), min = n * S.ev.step;
    $('gCnt').textContent = n ? '塗った時間 合計' + (Math.round(min / 6) / 10) + '時間' : 'まだ塗っていません';
    $('gSend').disabled = !n || S.sending;
  }
  function toPaint() {
    var nm = $('gName').value.replace(/^\s+|\s+$/g, '');
    if (!nm) { $('nameErr').textContent = 'お名前を入れてください'; $('nameErr').hidden = false; return; }
    $('nameErr').hidden = true;
    S.name = nm.slice(0, 20);
    $('gWho').textContent = S.name + ' さん';
    $('sendErr').hidden = true;
    show('g-paint');
    drawGrid();
  }
  function send() {
    if (S.sending) return;
    S.sending = true; $('gSend').disabled = true; $('gSend').textContent = '送っています…'; $('sendErr').hidden = true;
    var cells = G.toStrings(S.cells, S.sh);
    api('yoteiAnswer', { name: S.name, device: device(), cells: cells }).then(function (res) {
      S.sending = false; $('gSend').textContent = 'この内容で送る';
      if (res.ok) {
        ls('yotei.g.' + S.token, { name: S.name, cells: cells, at: res.now || '' });
        $('doneHead').textContent = '送れました';
        $('doneNote').textContent = 'このスマホで同じリンクを開けば、締切（' + G.label(S.ev.deadline) + '）まで直せます。';
        show('g-done');
        return;
      }
      if (res.error === 'not_found' || res.error === 'closed') return load();
      $('sendErr').textContent = ERR[res.error] || ERR.network;
      $('sendErr').hidden = false;
      counts();
    });
  }

  document.addEventListener('click', function (e) {
    var t = e.target.closest('button'); if (!t || t.disabled) return;
    if (t.dataset.wk) { S.week += +t.dataset.wk; drawGrid(); }
  });
  $('toPaint').addEventListener('click', toPaint);
  $('gName').addEventListener('keydown', function (e) { if (e.key === 'Enter') toPaint(); });
  $('gSend').addEventListener('click', send);
  $('gClear').addEventListener('click', function () { S.cells = {}; drawGrid(); });
  $('gBackName').addEventListener('click', function () { $('gName').value = S.name; show('g-name'); });
  $('gEdit').addEventListener('click', function () {
    $('gName').value = S.name;
    $('nameNote').textContent = 'お名前を変えると、別の人の答えとして届きます。締切は ' + G.label(S.ev.deadline) + ' です。';
    show('g-name');
  });
  $('mRetry').addEventListener('click', load);
  window.addEventListener('hashchange', function () { S.cells = {}; S.week = 0; load(); });
  G.paintable($('gGrid'), function () { return S.cells; }, counts);
  load();
})();
