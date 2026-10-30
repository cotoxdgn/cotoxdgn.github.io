/* タスク表スマホ版：既存スプシ「_タスク管理2026.09.15~」を、独立した Apps Script（task/gas/TaskApi.gs）経由で読み書きする。
 * 共通の shared/apps.js は使わない（接続設定も別のキー task.conn.v1 に保存し、他アプリと混ざらない）。 */
(function () {
  'use strict';
  var CONN_KEY = 'task.conn.v1';
  var CACHE_KEY = 'task.cache.v1';
  var TIMER_KEY = 'task.timers.v1';
  var PREF_KEY = 'task.prefs.v1';
  var HASH_RE = /#(?:.*&)?t=([A-Za-z0-9_-]+)/;
  var LIB = '../shared/lib/';
  var SLOT_EMOJI = { '朝': '🌅', '昼': '☀️', '夕': '🌙' };
  var ERR = {
    not_connected: 'まだつながっていません', offline: 'オフラインです。電波のある所でもう一度',
    network: 'スプシにつながりませんでした。少し待ってもう一度', timeout: '時間がかかりすぎました。もう一度押してください',
    bad_key: '合言葉が違います。接続をやり直してください', no_setup: 'スクリプトの準備（setup）がまだです',
    busy: 'スプシが混み合っています。もう一度', not_found: 'このタスクがシートで見つかりません（PCで書き換えた？）。読み込み直します',
    no_todo: 'タスク名を入れてください', bad_ko: '工は 0〜24 の数字で', bad_date: '作業日を選んでください',
    bad_actual: '実働は 0〜24 の数字で', server: 'スプシ側でエラーが起きました'
  };
  var $ = function (id) { return document.getElementById(id); };
  var state = { tasks: [], projects: [], today: '', actualColumn: false, loaded: false };

  // ---------- 端末内の保存（失敗しても動く） ----------
  function lsGet(k) { try { var v = localStorage.getItem(k); return v ? JSON.parse(v) : null; } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch (e) { return false; } }
  function lsDel(k) { try { localStorage.removeItem(k); } catch (e) { /* 無視 */ } }

  // ---------- 接続 ----------
  function b64urlDecode(s) {
    s = s.replace(/-/g, '+').replace(/_/g, '/'); while (s.length % 4) s += '=';
    return decodeURIComponent(Array.prototype.map.call(atob(s), function (c) { return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2); }).join(''));
  }
  function b64urlEncode(str) {
    return btoa(unescape(encodeURIComponent(str))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function parseConnect(text) {
    var m = HASH_RE.exec(String(text || ''));
    if (!m) return null;
    try {
      var o = JSON.parse(b64urlDecode(m[1]));
      if (!o || typeof o.u !== 'string' || typeof o.k !== 'string' || !/^https:\/\//.test(o.u)) return null;
      return { url: o.u, key: o.k, name: o.n ? String(o.n) : '' };
    } catch (e) { return null; }
  }
  function conn() { return lsGet(CONN_KEY); }
  function connectLink() {
    var c = conn(); if (!c) return '';
    return location.origin + location.pathname + '#t=' + b64urlEncode(JSON.stringify({ u: c.url, k: c.key, n: c.name }));
  }
  function saveConn(c) { lsSet(CONN_KEY, { url: c.url, key: c.key, name: c.name, at: new Date().toISOString() }); }

  // ---------- 通信 ----------
  function api(action, params) {
    var c = conn();
    if (!c) return Promise.reject({ code: 'not_connected' });
    if (navigator.onLine === false) return Promise.reject({ code: 'offline' });
    var body = { key: c.key, action: action };
    for (var k in params || {}) body[k] = params[k];
    var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timedOut = false;
    var timer = ctrl ? setTimeout(function () { timedOut = true; ctrl.abort(); }, 30000) : null;
    return fetch(c.url, {
      method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(body),
      redirect: 'follow', signal: ctrl ? ctrl.signal : undefined
    }).then(function (r) { return r.text(); }, function () {
      throw { code: timedOut ? 'timeout' : (navigator.onLine === false ? 'offline' : 'network') };
    }).then(function (txt) {
      if (timer) clearTimeout(timer);
      var d; try { d = JSON.parse(txt); } catch (e) { throw { code: 'network' }; }
      if (!d.ok) throw { code: d.error || 'server', detail: d.detail };
      if (d.today) state.today = d.today;
      return d;
    }, function (e) { if (timer) clearTimeout(timer); throw e; });
  }
  function errText(e) { return ERR[e && e.code] || ('エラー：' + (e && e.code || '不明')); }

  // ---------- 小物 ----------
  var toastTimer = 0;
  function toast(msg, isErr) {
    var t = $('toast'); t.textContent = msg; t.className = 'toast' + (isErr ? ' err' : ''); t.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(function () { t.hidden = true; }, isErr ? 4500 : 2400);
  }
  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function localYmd(d) { d = d || new Date(); return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); }
  function md(ymd) { var p = ymd.split('-'); return Number(p[1]) + '/' + Number(p[2]); }
  function dow(ymd) { var p = ymd.split('-'); return '日月火水木金土'.charAt(new Date(+p[0], p[1] - 1, +p[2]).getDay()); }
  function h(n) { return n == null ? '–' : (Math.round(n * 100) / 100) + 'h'; }
  function q(n) { return Math.round(n * 4) / 4; }
  function signed(n) { n = Math.round(n * 100) / 100; return n === 0 ? '±0' : (n > 0 ? '+' : '−') + Math.abs(n); }
  function tkey(t) { return t.no + '|' + t.todo; }
  function loadScript(src) {
    return new Promise(function (ok, ng) { var s = document.createElement('script'); s.src = src; s.onload = ok; s.onerror = ng; document.head.appendChild(s); });
  }
  function reqId() { return 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10); }

  // ---------- タイマー（端末内） ----------
  function timers() { return lsGet(TIMER_KEY) || {}; }
  function timerSec(k) {
    var t = timers()[k]; if (!t) return 0;
    return (t.acc || 0) + (t.start ? (Date.now() - t.start) / 1000 : 0);
  }
  function timerRunning(k) { var t = timers()[k]; return !!(t && t.start); }
  function timerSet(k, fn) { var all = timers(); var t = all[k] || { acc: 0, start: 0 }; fn(t); if (!t.acc && !t.start) delete all[k]; else all[k] = t; lsSet(TIMER_KEY, all); }
  function timerToggle(k) { timerSet(k, function (t) { if (t.start) { t.acc += (Date.now() - t.start) / 1000; t.start = 0; } else t.start = Date.now(); }); }
  function timerClear(k) { var all = timers(); delete all[k]; lsSet(TIMER_KEY, all); }
  function hms(s) { s = Math.floor(s); return [Math.floor(s / 3600), Math.floor(s / 60) % 60, s % 60].map(function (n) { return ('0' + n).slice(-2); }).join(':'); }

  // ---------- 表示 ----------
  function render() {
    var today = state.today || localYmd();
    $('today').textContent = md(today) + ' (' + dow(today) + ')';
    $('todayLbl').textContent = '今日（📅 ' + md(today) + '）';
    var open = state.tasks.filter(function (t) { return !t.done; });
    var carry = open.filter(function (t) { return t.date < today; }).sort(function (a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : 0; });
    var todays = open.filter(function (t) { return t.date === today; });
    var done = state.tasks.filter(function (t) { return t.done; });
    var order = { '朝': 0, '昼': 1, '夕': 2, '': 3 };
    todays.sort(function (a, b) { return order[a.slot] - order[b.slot]; });
    fill($('carry'), carry, today); $('carryBox').hidden = !carry.length;
    fill($('todayList'), todays, today); $('todayEmpty').hidden = !!todays.length;
    fill($('doneList'), done, today); $('doneBox').hidden = !done.length;
    $('sOpen').textContent = open.length + '件';
    $('sKo').textContent = h(open.concat(done).reduce(function (s, t) { return s + (t.ko || 0); }, 0));
    var acts = done.filter(function (t) { return t.actual != null; });
    $('sAct').textContent = acts.length ? h(acts.reduce(function (s, t) { return s + t.actual; }, 0)) : '–';
    var dl = $('pjList'); dl.innerHTML = '';
    state.projects.forEach(function (p) { var o = el('option'); o.value = p; dl.appendChild(o); });
    renderQuickMeta();
  }
  function fill(box, list, today) {
    box.innerHTML = '';
    list.forEach(function (t) {
      var row = el('div', 'task' + (t.done ? ' done' : '') + (!t.done && t.date < today ? ' carry' : ''));
      var cb = el('button', 'cb'); cb.type = 'button';
      cb.setAttribute('aria-label', (t.done ? '完了を外す：' : '完了にする：') + t.todo);
      cb.appendChild(el('span', '', t.done ? '✓' : ''));
      cb.addEventListener('click', function () { if (t.done) undone(t, row); else openSheet(t); });
      var body = el('div', 'body');
      body.appendChild(el('div', 'tt', t.todo));
      var meta = el('div', 'meta');
      if (t.pj) meta.appendChild(el('span', 'pj', t.pj));
      if (!t.done && t.date < today) meta.appendChild(el('span', 'chip', md(t.date) + 'から'));
      if (t.slot) meta.appendChild(el('span', '', SLOT_EMOJI[t.slot] + ' ' + t.slot));
      else if (t.slotRaw) meta.appendChild(el('span', '', t.slotRaw));
      if (!t.done && timerRunning(tkey(t))) meta.appendChild(el('span', 'chip run', '⏱ 計測中'));
      if (t.done && t.actual != null) meta.appendChild(el('span', '', '実働 ' + h(t.actual) + ' / 工 ' + h(t.ko)));
      body.appendChild(meta);
      var hrs = el('span', 'hrs');
      if (t.done && t.actual != null && t.ko != null) {
        var d = t.actual - t.ko; var s = el('span', d > 0 ? 'over' : '', signed(d)); hrs.appendChild(s);
      } else hrs.textContent = h(t.ko);
      row.appendChild(cb); row.appendChild(body); row.appendChild(hrs);
      box.appendChild(row);
    });
  }

  function load(quiet) {
    if (!quiet) $('status').textContent = '読み込み中…';
    return api('list').then(function (d) {
      state.tasks = d.tasks || []; state.projects = d.projects || []; state.actualColumn = !!d.actualColumn; state.loaded = true;
      lsSet(CACHE_KEY, { tasks: state.tasks, projects: state.projects, today: state.today, actualColumn: state.actualColumn, at: Date.now() });
      $('status').textContent = '';
      render();
    }, function (e) {
      $('status').textContent = errText(e) + (state.loaded ? '' : '（前回の内容を表示中）');
      if (!quiet) toast(errText(e), true);
    });
  }

  // ---------- 追加 ----------
  var slot = '朝';
  function prefs() { return lsGet(PREF_KEY) || {}; }
  function renderQuickMeta() {
    var pj = $('aPj').value.trim();
    var date = $('aDate').value || state.today || localYmd();
    $('quickMeta').textContent = [pj || '案件名なし', '工 ' + ($('aKo').value || '0') + 'h', '📅 ' + md(date) + '(' + dow(date) + ')', SLOT_EMOJI[slot] + ' ' + slot].join(' ・ ');
    var parent = $('aParent').value.trim(), todo = $('aTodo').value.trim();
    $('preview').textContent = 'シートの ToDo 欄：' + (todo ? (parent ? parent + ' | ' + todo : todo) : '（タスク名）');
  }
  function resetForm() {
    $('aTodo').value = ''; $('aParent').value = ''; $('aDetail').value = '';
    $('aKo').value = '0.5'; $('aDate').value = state.today || localYmd();
    setSlot('朝');
  }
  function setSlot(v) {
    slot = v;
    Array.prototype.forEach.call($('aSlot').children, function (b) { var on = b.dataset.v === v; b.classList.toggle('on', on); b.setAttribute('aria-checked', String(on)); });
    renderQuickMeta();
  }
  function submitAdd(e) {
    e.preventDefault();
    var todo = $('aTodo').value.trim();
    if (!todo) { toast(ERR.no_todo, true); $('aTodo').focus(); return; }
    var ko = parseFloat($('aKo').value);
    if (!isFinite(ko) || ko < 0 || ko > 24) { toast(ERR.bad_ko, true); return; }
    var p = { reqId: reqId(), pj: $('aPj').value.trim(), parent: $('aParent').value.trim(), todo: todo, detail: $('aDetail').value.trim(),
      ko: ko, date: $('aDate').value || state.today || localYmd(), slot: slot };
    var btn = $('addBtn'); btn.disabled = true; btn.textContent = '追加中…';
    var send = function (tries) {
      return api('add', p).catch(function (err) {
        if (tries > 0 && (err.code === 'network' || err.code === 'timeout' || err.code === 'busy')) return send(tries - 1); // reqId が同じなので二重にならない
        throw err;
      });
    };
    send(1).then(function (d) {
      var pr = prefs(); pr.pj = p.pj; lsSet(PREF_KEY, pr);
      toast('シートに追加しました（No.' + d.task.no + '）');
      resetForm();
      var tdy = state.today || localYmd();
      if (d.task.date && d.task.date <= tdy) state.tasks.push(d.task);
      if (p.pj && state.projects.indexOf(p.pj) < 0) state.projects.push(p.pj);
      render();
    }, function (err) { toast(errText(err) + '（入力内容は残しています）', true); })
      .then(function () { btn.disabled = false; btn.textContent = '追加する'; });
  }

  // ---------- 完了シート ----------
  var cur = null, act = 0, actTouched = false, tick = 0;
  function openSheet(t) {
    cur = t; actTouched = false;
    $('shTitle').textContent = t.todo;
    var m = $('shMeta'); m.innerHTML = '';
    if (t.pj) m.appendChild(el('span', 'pj', t.pj));
    if (t.date) m.appendChild(el('span', '', '📅 ' + md(t.date)));
    if (t.slot) m.appendChild(el('span', '', SLOT_EMOJI[t.slot] + ' ' + t.slot));
    $('shKo').textContent = h(t.ko);
    var sec = timerSec(tkey(t));
    act = sec > 0 ? Math.max(0.25, q(sec / 3600)) : (t.ko != null ? t.ko : 0.5);
    $('shNote').textContent = state.actualColumn ? '実働はシートの「実働」列に記録します（0.25h 単位）。'
      : 'シートに「実働」列がまだないため、今は完了チェックだけ記録します。';
    drawSheet();
    $('dim').hidden = false; $('sheet').hidden = false;
    clearInterval(tick); tick = setInterval(drawTimer, 500);
    $('shDone').focus();
  }
  function closeSheet() { clearInterval(tick); $('dim').hidden = true; $('sheet').hidden = true; $('conf').hidden = true; stopScan(); cur = null; render(); }
  function drawTimer() {
    if (!cur) return;
    var k = tkey(cur), sec = timerSec(k), run = timerRunning(k);
    $('shTimer').textContent = hms(sec);
    $('tToggle').textContent = run ? '⏸ タイマー停止' : (sec > 0 ? '▶ 再開' : '▶ タイマー開始');
    if (!actTouched && sec > 0) { act = Math.max(0.25, q(sec / 3600)); drawAct(); }
  }
  function drawAct() {
    $('shAct').textContent = h(act);
    if (cur.ko != null) { var d = act - cur.ko; $('shDiff').textContent = signed(d); $('shDiffBox').className = d > 0 ? 'over' : ''; }
    else $('shDiff').textContent = '–';
  }
  function drawSheet() { drawTimer(); drawAct(); }
  function doDone() {
    var t = cur; if (!t) return;
    var btn = $('shDone'); btn.disabled = true; btn.textContent = '記録中…';
    api('done', { no: t.no, todo: t.todo, actual: act }).then(function (d) {
      timerClear(tkey(t));
      t.done = true; t.actual = d.actualSaved ? d.task.actual : act;
      if (!d.actualSaved) t.actualLocal = true;
      toast(d.actualSaved ? '完了にしました（実働 ' + h(d.task.actual) + '）' : '完了にしました');
      closeSheet();
    }, function (e) {
      toast(errText(e), true);
      if (e.code === 'not_found') { closeSheet(); load(true); }
    }).then(function () { btn.disabled = false; btn.textContent = '完了にする'; });
  }
  function undone(t, row) {
    row.classList.add('busy');
    api('undone', { no: t.no, todo: t.todo }).then(function () {
      t.done = false; toast('完了を外しました'); render();
    }, function (e) { row.classList.remove('busy'); toast(errText(e), true); if (e.code === 'not_found') load(true); });
  }

  // ---------- 接続画面 ----------
  var scan = { stream: null, raf: 0 };
  function stopScan() {
    if (scan.raf) cancelAnimationFrame(scan.raf); scan.raf = 0;
    if (scan.stream) scan.stream.getTracks().forEach(function (x) { x.stop(); }); scan.stream = null;
    $('video').hidden = true;
  }
  function cmsg(text, cls) { var m = $('connectMsg'); m.textContent = text; m.className = 'msg' + (cls ? ' ' + cls : ''); }
  function decode(src, w, hh) {
    var s = Math.min(1, 1000 / Math.max(w, hh)); var cw = Math.round(w * s), ch = Math.round(hh * s);
    var cv = document.createElement('canvas'); cv.width = cw; cv.height = ch;
    var cx = cv.getContext('2d', { willReadFrequently: true }); cx.drawImage(src, 0, 0, cw, ch);
    var hit = window.jsQR(cx.getImageData(0, 0, cw, ch).data, cw, ch, { inversionAttempts: 'attemptBoth' });
    return hit && hit.data ? hit.data : null;
  }
  function finishConnect(c) {
    if (!c) { cmsg('タスク表用のQR・リンクではありません', 'err'); return; }
    stopScan(); saveConn(c); cmsg('つながりました', 'ok'); start();
  }
  function startCamera() {
    cmsg('カメラを準備しています…');
    var v = $('video');
    (window.jsQR ? Promise.resolve() : loadScript(LIB + 'jsQR.js')).then(function () {
      return navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
    }).then(function (stream) {
      scan.stream = stream; v.srcObject = stream; v.hidden = false;
      cmsg('パソコンに出ているQRを映してください');
      return v.play().catch(function () {});
    }).then(function loop() {
      if (!scan.stream) return;
      if (v.readyState >= 2 && v.videoWidth) { var txt = decode(v, v.videoWidth, v.videoHeight); var c = txt && parseConnect(txt); if (c) { finishConnect(c); return; } }
      scan.raf = requestAnimationFrame(loop);
    }).catch(function () { stopScan(); cmsg('カメラを使えませんでした。「写真から読み取る」かリンクの貼り付けを使ってください', 'err'); });
  }
  function fromPhoto() {
    var f = $('photo').files && $('photo').files[0]; if (!f) return;
    (window.jsQR ? Promise.resolve() : loadScript(LIB + 'jsQR.js')).then(function () {
      return new Promise(function (ok, ng) { var img = new Image(); img.onload = function () { ok(img); }; img.onerror = ng; img.src = URL.createObjectURL(f); });
    }).then(function (img) { var txt = decode(img, img.naturalWidth, img.naturalHeight); finishConnect(txt ? parseConnect(txt) : null); })
      .catch(function () { finishConnect(null); });
    $('photo').value = '';
  }
  function openConf() {
    var c = conn(); if (!c) return;
    $('confName').textContent = 'つながっています：' + (c.name || 'スプレッドシート');
    $('qrBox').hidden = true; $('qrBox').innerHTML = '';
    $('dim').hidden = false; $('conf').hidden = false;
  }
  function showQr() {
    (window.qrcode ? Promise.resolve() : loadScript(LIB + 'qrcode.js')).then(function () {
      var qr = window.qrcode(0, 'M'); qr.addData(connectLink()); qr.make();
      var box = $('qrBox'); box.innerHTML = '';
      var img = el('img'); img.src = qr.createDataURL(6, 12); img.alt = '接続用のQR'; box.appendChild(img);
      box.appendChild(el('p', 'note', 'iPhone のホーム画面のタスクアプリで「QRでつなぐ」を押して映してください。このQRには合言葉が入っています。スクショ・共有はしないでください。'));
      box.hidden = false;
    }, function () { toast('QRを表示できませんでした（通信を確認）', true); });
  }

  // ---------- 起動 ----------
  function consumeHash() {
    var c = parseConnect(location.hash); if (!c) return false;
    saveConn(c);
    try { history.replaceState(null, '', location.pathname + location.search); } catch (e) { location.hash = ''; }
    return true;
  }
  function start() {
    var c = conn();
    $('connect').hidden = !!c; $('app').hidden = !c;
    if (!c) { $('iosHint').hidden = !(/iP(hone|ad|od)/.test(navigator.userAgent) && !navigator.standalone); return; }
    var cache = lsGet(CACHE_KEY);
    if (cache && cache.tasks) {
      state.tasks = cache.tasks; state.projects = cache.projects || []; state.actualColumn = !!cache.actualColumn;
      state.today = cache.today === localYmd() ? cache.today : localYmd();
    }
    if (!$('aDate').value) $('aDate').value = state.today || localYmd();
    if (!$('aPj').value) $('aPj').value = prefs().pj || '';
    render();
    load();
  }

  $('addForm').addEventListener('submit', submitAdd);
  ['aTodo', 'aPj', 'aParent', 'aKo', 'aDate'].forEach(function (id) { $(id).addEventListener('input', renderQuickMeta); });
  $('aSlot').addEventListener('click', function (e) { var b = e.target.closest('button'); if (b) setSlot(b.dataset.v); });
  $('moreBtn').addEventListener('click', function () {
    var open = $('more').hidden; $('more').hidden = !open; $('quickMeta').hidden = open;
    this.textContent = open ? '簡単入力に戻す' : '詳しく入力'; this.setAttribute('aria-expanded', String(open));
  });
  $('steps').addEventListener('click', function (e) {
    var b = e.target.closest('button'); if (!b || !cur) return;
    actTouched = true; act = Math.max(0, Math.min(24, q(act + parseFloat(b.dataset.d)))); drawAct();
  });
  $('tToggle').addEventListener('click', function () { if (cur) { timerToggle(tkey(cur)); actTouched = false; drawTimer(); } });
  $('tReset').addEventListener('click', function () { if (cur) { timerClear(tkey(cur)); act = cur.ko != null ? cur.ko : 0.5; actTouched = false; drawSheet(); } });
  $('shDone').addEventListener('click', doDone);
  $('shLater').addEventListener('click', closeSheet);
  $('dim').addEventListener('click', closeSheet);
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !$('dim').hidden) closeSheet(); });
  $('reload').addEventListener('click', function () { if (conn()) load(); });
  $('settings').addEventListener('click', function () { if (conn()) openConf(); else $('scanBtn').focus(); });
  $('confClose').addEventListener('click', closeSheet);
  $('qrBtn').addEventListener('click', showQr);
  $('pingBtn').addEventListener('click', function () {
    api('ping').then(function (d) { toast('つながっています（' + d.name + (d.actualColumn ? '・実働列あり' : '・実働列なし') + '）'); }, function (e) { toast(errText(e), true); });
  });
  $('discBtn').addEventListener('click', function () { lsDel(CONN_KEY); lsDel(CACHE_KEY); closeSheet(); toast('接続を外しました'); start(); });
  $('scanBtn').addEventListener('click', startCamera);
  $('photoBtn').addEventListener('click', function () { $('photo').click(); });
  $('photo').addEventListener('change', fromPhoto);
  $('pasteBtn').addEventListener('click', function () { finishConnect(parseConnect($('paste').value)); });
  document.addEventListener('visibilitychange', function () { if (!document.hidden && conn() && $('sheet').hidden) load(true); });

  var hashed = consumeHash();
  start();
  if (hashed) toast('この端末をつなぎました');
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(function () {});
})();
