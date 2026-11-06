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
  var SLOT_EMOJI = { '朝': '🌅', '昼': '☀️', '夕': '🌙', '移動': '🚃' };
  var ERR = {
    not_connected: 'まだつながっていません', offline: 'オフラインです。電波のある所でもう一度',
    network: 'スプシにつながりませんでした。少し待ってもう一度', timeout: '時間がかかりすぎました。もう一度押してください',
    bad_key: '合言葉が違います。接続をやり直してください', no_setup: 'スクリプトの準備（setup）がまだです',
    busy: 'スプシが混み合っています。もう一度', not_found: 'このタスクがシートで見つかりません（PCで書き換えた？）。読み込み直します',
    no_todo: 'タスク名を入れてください', bad_ko: '工は 0〜24 の数字で', bad_date: '作業日を選んでください',
    bad_actual: '実働は 0〜24 の数字で', server: 'スプシ側でエラーが起きました',
    bad_wait: '待ち相手は40文字までで', bad_slot: '時間帯は朝・昼・夕・移動・なし、または時刻で', bad_pre: '前提は一覧から選んでください（自分自身は選べません）', used_as_pre: 'ほかのタスクの前提になっているので削除できません',
    no_wait_column: 'スプシに「👤」の列が見つかりません', no_pre_column: 'スプシに「前提」の列が見つかりません',
    bad_action: 'スクリプトが古いままです。デプロイを新しい版にしてください',
    no_recur_sheet: 'スプシに「_定期タスク」の表が見つかりません', recur_changed: 'この定期タスクの行がスプシで変わっています。読み込み直します',
    bad_type: '繰り返しを選んでください', bad_when: '曜日・日を選んでください', bad_range: '終了日は開始日より後にしてください'
  };
  var $ = function (id) { return document.getElementById(id); };
  var state = { tasks: [], projects: [], today: '', actualColumn: false, loaded: false, preOptions: [], people: [], waitColumn: true, preColumn: true };

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
  function q(n) { return Math.round(n * 10) / 10; }
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
    var carry = open.filter(function (t) { return t.date < today; }).sort(function (a, b) { return rank(a) - rank(b) || (a.date < b.date ? -1 : a.date > b.date ? 1 : 0); });
    var todays = open.filter(function (t) { return t.date === today; });
    var done = state.tasks.filter(function (t) { return t.done; });
    var order = { '朝': 0, '昼': 1, '夕': 2, '移動': 3, '': 4 };
    todays.sort(function (a, b) { return rank(a) - rank(b) || order[a.slot] - order[b.slot]; });
    fill($('carry'), carry, today); $('carryBox').hidden = !carry.length;
    fill($('todayList'), todays, today); $('todayEmpty').hidden = !!todays.length;
    fill($('doneList'), done, today); $('doneBox').hidden = !done.length;
    // 明日：見るだけ（押して設定・チェックで完了もできる）。開いた／閉じたは端末ごとに覚える
    var tmr = (state.tomorrow || []).slice().sort(function (a, b) { return rank(a) - rank(b) || order[a.slot] - order[b.slot]; });
    $('tmrBox').hidden = !state.tomorrowDate;
    if (state.tomorrowDate) {
      $('tmrLbl').textContent = '明日（📅 ' + md(state.tomorrowDate) + '）' + tmr.length + '件';
      fill($('tmrList'), tmr, today); $('tmrEmpty').hidden = !!tmr.length;
    }
    $('sOpen').textContent = open.length + '件';
    $('sKo').textContent = h(open.concat(done).reduce(function (s, t) { return s + (t.ko || 0); }, 0));
    var acts = done.filter(function (t) { return t.actual != null; });
    $('sAct').textContent = acts.length ? h(acts.reduce(function (s, t) { return s + t.actual; }, 0)) : '–';
    var dl = $('pjList'); dl.innerHTML = '';
    state.projects.forEach(function (p) { var o = el('option'); o.value = p; dl.appendChild(o); });
    renderQuickMeta();
  }
  // 前提が未完了のタスクは、アプリでは完了にできない。薄いグレーで下の方に並べる（👤の待ちは印だけで、ロックしない）
  function locked(t) { return !t.done && t.preWait ? 1 : 0; }
  // 並び順：ふつう → 👤の待ち → 前提待ち（ロック）
  function rank(t) { return locked(t) ? 2 : (!t.done && t.wait ? 1 : 0); }
  function fill(box, list, today) {
    box.innerHTML = '';
    list.forEach(function (t) {
      var lk = locked(t);
      var row = el('div', 'task' + (t.done ? ' done' : '') + (!t.done && t.date < today ? ' carry' : '') + (lk ? ' locked' : (!t.done && t.wait ? ' waiting' : '')));
      var cb = el('button', 'cb'); cb.type = 'button';
      cb.setAttribute('aria-label', lk ? '前提待ちのため完了にできません：' + t.todo : (t.done ? '完了を外す：' : '完了にする：') + t.todo);
      if (lk) cb.setAttribute('aria-disabled', 'true');
      cb.appendChild(el('span', '', t.done ? '✓' : ''));
      cb.addEventListener('click', function () {
        if (lk) { toast('前提のタスクがまだ終わっていません。前提を完了にすると、完了にできます'); return; }
        if (t.done) undone(t, row); else openSheet(t);
      });
      var body = el('div', 'body');
      if (!t.done) { body.setAttribute('role', 'button'); body.tabIndex = 0; body.setAttribute('aria-label', 'タスクの設定：' + t.todo);
        body.addEventListener('click', function () { openWait(t); });
        body.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openWait(t); } }); }
      body.appendChild(el('div', 'tt', t.todo));
      var meta = el('div', 'meta');
      if (t.pj) meta.appendChild(el('span', 'pj', t.pj));
      if (!t.done && t.wait) meta.appendChild(el('span', 'chip wait', '⏳ ' + t.wait + ' 待ち'));
      if (!t.done && t.preWait) meta.appendChild(el('span', 'chip wait', '⏳ 前提 ' + t.pre.slice(0, 20) + ' 待ち'));
      if (!t.done && t.date < today) meta.appendChild(el('span', 'chip', md(t.date) + 'から'));
      if (t.slot) meta.appendChild(el('span', '', SLOT_EMOJI[t.slot] + ' ' + t.slot));
      else if (t.slotRaw) meta.appendChild(el('span', '', slotTime(t.slotRaw) ? '⏰ ' + slotTime(t.slotRaw) : t.slotRaw));
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
      state.preOptions = d.preOptions || []; state.people = d.people || [];
      state.tomorrow = d.tomorrow || []; state.tomorrowDate = d.tomorrowDate || '';
      state.waitColumn = d.waitColumn !== false; state.preColumn = d.preColumn !== false;
      lsSet(CACHE_KEY, { tasks: state.tasks, projects: state.projects, today: state.today, actualColumn: state.actualColumn,
        preOptions: state.preOptions, people: state.people, tomorrow: state.tomorrow, tomorrowDate: state.tomorrowDate, at: Date.now() });
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
  var cur = null, act = 0, actTouched = false, tick = 0, autoStarted = false;
  function openSheet(t) {
    cur = t; actTouched = false;
    // チェックを押した瞬間にタイマーを始める（まだ計っていないタスクだけ）。
    // 今回始めた分は、この画面では実働に反映しない（あとでやった分を「工」のまま完了にできるように）
    var k0 = tkey(t);
    autoStarted = false;
    if (timerSec(k0) === 0 && !timerRunning(k0)) { timerToggle(k0); autoStarted = true; toast('タイマーを始めました'); }
    $('shTitle').textContent = t.todo;
    var m = $('shMeta'); m.innerHTML = '';
    if (t.pj) m.appendChild(el('span', 'pj', t.pj));
    if (t.date) m.appendChild(el('span', '', '📅 ' + md(t.date)));
    if (t.slot) m.appendChild(el('span', '', SLOT_EMOJI[t.slot] + ' ' + t.slot));
    $('shKo').textContent = h(t.ko);
    var sec = timerSec(tkey(t));
    act = sec > 0 && !autoStarted ? Math.max(0.1, q(sec / 3600)) : (t.ko != null ? t.ko : 0.5);
    $('shNote').textContent = state.actualColumn ? '実働はシートの「実働」列に記録します（0.1h 単位）。'
      : 'シートに「実働」列がまだないため、今は完了チェックだけ記録します。';
    drawSheet();
    $('dim').hidden = false; $('sheet').hidden = false;
    clearInterval(tick); tick = setInterval(drawTimer, 500);
    $('shDone').focus();
  }
  function closeSheet() { clearInterval(tick); $('dim').hidden = true; $('sheet').hidden = true; $('conf').hidden = true; $('wsheet').hidden = true; $('rsheet').hidden = true; document.documentElement.classList.remove('noscroll'); stopScan(); cur = null; wcur = null; render(); }

  // ---------- 待ちの設定（👤・前提） ----------
  var wcur = null, wpre = '', wslot0 = '', wslot = '', preOpen = false;
  var PRE_MAX = 8;   // 一度に出す前提の候補（多いと画面が長くなって動かしにくいため。残りは検索で）
  // ⏰が数値の時刻（13.5 など）なら "13:30" にする
  function slotTime(raw) {
    var n = parseFloat(raw); if (!isFinite(n) || n < 0 || n >= 24 || String(raw).trim() === '') return '';
    var hh = Math.floor(n), mm = Math.round((n - hh) * 60); if (mm === 60) { hh++; mm = 0; }
    return ('0' + hh).slice(-2) + ':' + ('0' + mm).slice(-2);
  }
  function drawSlot() {
    Array.prototype.forEach.call($('wsSlot').querySelectorAll('button'), function (b) {
      var on = b.getAttribute('data-s') === wslot; b.classList.toggle('on', on); b.setAttribute('aria-checked', String(on)); b.setAttribute('role', 'radio');
    });
    $('wsTime').value = /^\d{2}:\d{2}$/.test(wslot) ? wslot : '';
  }
  function openWait(t) {
    wcur = t; wpre = t.pre || '';
    wslot0 = t.slot || slotTime(t.slotRaw) || ''; wslot = wslot0;
    $('wsTodo').value = t.todo || '';
    delStep = 0; drawDel();
    $('wsDate').value = t.date || ''; drawSlot();
    $('wsTitle').textContent = t.todo;
    var m = $('wsMeta'); m.innerHTML = '';
    if (t.no != null) m.appendChild(el('span', '', 'No.' + t.no));
    if (t.pj) m.appendChild(el('span', 'pj', t.pj));
    if (t.date) m.appendChild(el('span', '', '📅 ' + md(t.date)));
    $('wsWho').value = t.wait || ''; $('wsWho').disabled = !state.waitColumn;
    var pp = $('wsPeople'); pp.innerHTML = '';
    state.people.forEach(function (n) {
      var b = el('button', '', n); b.type = 'button';
      b.addEventListener('click', function () { $('wsWho').value = n; });
      pp.appendChild(b);
    });
    $('wsPreQ').value = ''; $('wsPreQ').disabled = !state.preColumn; preOpen = false;
    drawPre();
    $('dim').hidden = false; $('wsheet').hidden = false; $('wsheet').scrollTop = 0;
    document.documentElement.classList.add('noscroll');
  }
  function drawPre() {
    var cur = $('wsPreCur'); cur.innerHTML = '';
    if (wpre) {
      var hit = state.preOptions.filter(function (o) { return o.label === wpre; })[0];
      cur.appendChild(el('span', '', '選択中：' + wpre + (hit ? '' : '（完了済み、または一覧にない）')));
      var x = el('button', '', '外す'); x.type = 'button';
      x.addEventListener('click', function () { wpre = ''; drawPre(); });
      cur.appendChild(x);
    } else cur.appendChild(el('span', 'none', '前提なし'));
    var q = $('wsPreQ').value.trim().toLowerCase();
    var box = $('wsPreList'); box.innerHTML = '';
    var show = preOpen || !!q;
    $('wsPreAll').hidden = show; box.hidden = !show;
    if (!show) return;
    var all = state.preOptions.filter(function (o) {
      return wcur && o.no !== wcur.no && (!q || o.label.toLowerCase().indexOf(q) !== -1 || (o.pj || '').toLowerCase().indexOf(q) !== -1);
    });
    var list = all.slice(0, PRE_MAX);
    list.forEach(function (o) {
      var b = el('button'); b.type = 'button'; b.setAttribute('aria-pressed', String(o.label === wpre));
      b.appendChild(document.createTextNode(o.label));
      b.appendChild(el('small', '', [o.pj, o.date ? '📅 ' + md(o.date) : ''].filter(Boolean).join('　')));
      b.addEventListener('click', function () { wpre = o.label; preOpen = false; $('wsPreQ').value = ''; drawPre(); });
      box.appendChild(b);
    });
    if (all.length > list.length) box.appendChild(el('p', 'note', 'ほか ' + (all.length - list.length) + ' 件。上の欄に番号や名前を入れると絞り込めます'));
    if (!list.length) box.appendChild(el('p', 'note', q ? '見つかりません' : '未完了のタスクがありません'));
  }
  // 削除：1回目「削除しますか？」→ 2回目「ほんとに大丈夫？！」の2段階。シートの行ごと消える
  var delStep = 0;
  function drawDel() {
    var box = $('wsDelAsk'); box.innerHTML = '';
    $('wsDel').hidden = delStep > 0; box.hidden = delStep === 0;
    if (!delStep || !wcur) return;
    box.appendChild(el('span', '', delStep === 1 ? '「' + wcur.todo + '」をシートから削除しますか？（行ごと消えます）' : 'ほんとに大丈夫？！ 元に戻せません。'));
    var r = el('div', 'row2');
    var no = el('button', 'btn ghost sm', 'やめる'); no.type = 'button';
    no.addEventListener('click', function () { delStep = 0; drawDel(); });
    var yes = el('button', 'btn danger sm', delStep === 1 ? '削除する' : 'ほんとに削除する'); yes.type = 'button';
    yes.addEventListener('click', function () {
      if (delStep === 1) { delStep = 2; drawDel(); return; }
      var t = wcur; yes.disabled = true; yes.textContent = '削除中…';
      api('remove', { no: t.no, todo: t.todo }).then(function () {
        var all = timers(); if (all[tkey(t)]) { delete all[tkey(t)]; lsSet(TIMER_KEY, all); }
        toast('削除しました'); delStep = 0; closeSheet(); return load(true);
      }, function (e) {
        toast(errText(e) + (e.detail ? '：' + e.detail : ''), true); delStep = 0; drawDel();
        if (e.code === 'not_found') { closeSheet(); load(true); }
      });
    });
    r.appendChild(no); r.appendChild(yes); box.appendChild(r);
  }
  $('wsDel').addEventListener('click', function () { delStep = 1; drawDel(); });
  function saveWait() {
    var t = wcur; if (!t) return;
    var params = { no: t.no, todo: t.todo };
    var nt = $('wsTodo').value.replace(/[\r\n]+/g, ' ').trim();
    if (!nt) { toast('タスク名を空にはできません', true); $('wsTodo').focus(); return; }
    if (nt !== t.todo) params.newTodo = nt;
    var dt = $('wsDate').value;
    if (dt && dt !== (t.date || '')) params.date = dt;
    if (wslot !== wslot0) params.slot = wslot;
    var who = $('wsWho').value.trim();
    if (state.waitColumn && who !== (t.wait || '')) params.wait = who;
    if (state.preColumn && wpre !== (t.pre || '')) params.pre = wpre;
    if (params.newTodo === undefined && params.wait === undefined && params.pre === undefined && params.date === undefined && params.slot === undefined) { closeSheet(); return; }
    var btn = $('wsSave'); btn.disabled = true; btn.textContent = '保存中…';
    api('setWait', params).then(function () {
      if (params.newTodo) {   // 名前を変えたら、動いているタイマーも新しい名前に付け替える
        var all = timers(), ok0 = tkey(t), nk = t.no + '|' + params.newTodo;
        if (all[ok0]) { all[nk] = all[ok0]; delete all[ok0]; lsSet(TIMER_KEY, all); }
      }
      toast('保存しました'); closeSheet(); return load(true);
    }, function (e) { toast(errText(e), true); if (e.code === 'not_found') { closeSheet(); load(true); } })
      .then(function () { btn.disabled = false; btn.textContent = '保存'; });
  }
  function drawTimer() {
    if (!cur) return;
    var k = tkey(cur), sec = timerSec(k), run = timerRunning(k);
    $('shTimer').textContent = hms(sec);
    $('tToggle').textContent = run ? '⏸ タイマー停止' : (sec > 0 ? '▶ 再開' : '▶ タイマー開始');
    if (!actTouched && !autoStarted && sec > 0) { act = Math.max(0.1, q(sec / 3600)); drawAct(); }
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
      state.preOptions = cache.preOptions || []; state.people = cache.people || [];
      // 前回の「明日」が今日になっていたら出さない（古い控え）
      state.tomorrowDate = cache.tomorrowDate && cache.tomorrowDate > localYmd() ? cache.tomorrowDate : '';
      state.tomorrow = state.tomorrowDate ? (cache.tomorrow || []) : [];
      state.today = cache.today === localYmd() ? cache.today : localYmd();
    }
    if (!$('aDate').value) $('aDate').value = state.today || localYmd();
    if (!$('aPj').value) $('aPj').value = prefs().pj || '';
    render();
    load();
  }


  // ---------- 定期タスク（スプシの「_定期タスク」表） ----------
  var WD = '月火水木金土日';
  var rules = [], redit = null, rslot = '', rtype = '平日', rwd = {}, rmd = {};
  function ruleDesc(r) {
    var when = r.type === '毎週' ? r.when : r.type === '毎月' ? r.when.split(',').map(function (x) { return x === '末' ? '末日' : x + '日'; }).join('・') : '';
    var slotTxt = '';
    for (var k in SLOT_EMOJI) if (SLOT_EMOJI[k] === r.time) slotTxt = r.time + ' ' + k;
    var bits = [r.type + (when ? ' ' + when : ''), slotTxt || (r.time ? '⏰ ' + r.time : ''), r.ko != null ? h(r.ko) : '', r.pj];
    if (r.from && r.from > (state.today || localYmd())) bits.push(md(r.from) + 'から');
    if (r.to) bits.push(md(r.to) + 'まで');
    return bits.filter(Boolean).join(' ・ ');
  }
  function openRecur() {
    $('dim').hidden = false; $('rsheet').hidden = false; $('rsheet').scrollTop = 0;
    document.documentElement.classList.add('noscroll');
    showRecurList(); drawRules();
    $('rsEmpty').hidden = true; $('rsEmpty').textContent = '読み込み中…'; $('rsEmpty').hidden = !!rules.length;
    api('recurList').then(function (d) { rules = d.rules || []; $('rsEmpty').textContent = '定期タスクはまだありません。'; drawRules(); },
      function (e) { $('rsEmpty').textContent = errText(e); $('rsEmpty').hidden = false; });
  }
  function showRecurList() { $('rsListView').hidden = false; $('rsForm').hidden = true; $('rsTitle').textContent = '🔁 定期タスク'; }
  function drawRules() {
    var on = rules.filter(function (r) { return r.on; }), off = rules.filter(function (r) { return !r.on; });
    [[$('rsList'), on], [$('rsOff'), off]].forEach(function (pair) {
      var box = pair[0]; box.innerHTML = '';
      pair[1].forEach(function (r) {
        var row = el('div', 'rule' + (r.on ? '' : ' off'));
        var body = el('div', 'body'); body.setAttribute('role', 'button'); body.tabIndex = 0; body.setAttribute('aria-label', '直す：' + r.todo);
        body.appendChild(el('div', 'tt', r.todo)); body.appendChild(el('div', 'meta', ruleDesc(r)));
        body.addEventListener('click', function () { openRuleForm(r); });
        body.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openRuleForm(r); } });
        var sw = el('button', 'sw'); sw.type = 'button'; sw.setAttribute('role', 'switch'); sw.setAttribute('aria-checked', String(r.on));
        sw.setAttribute('aria-label', (r.on ? '止める：' : '再開する：') + r.todo);
        sw.addEventListener('click', function () {
          row.classList.add('busy');
          api('recurToggle', { row: r.row, pj: r.pj, todo: r.todo, on: !r.on }).then(function (d) {
            toast(d.rule.on ? '再開しました（翌朝8時から入ります）' : '止めました（もう入っている分は残ります）');
            rules = rules.map(function (x) { return x.row === r.row ? d.rule : x; }); drawRules();
          }, function (e) { row.classList.remove('busy'); toast(errText(e), true); if (e.code === 'recur_changed') openRecur(); });
        });
        row.appendChild(body); row.appendChild(sw); box.appendChild(row);
      });
    });
    $('rsOffLbl').hidden = !off.length;
    $('rsEmpty').hidden = !!rules.length;
  }
  function chipGrid(box, labels, sel) {
    box.innerHTML = '';
    labels.forEach(function (l) {
      var b = el('button', '', l); b.type = 'button'; b.setAttribute('aria-pressed', String(!!sel[l]));
      b.addEventListener('click', function () { sel[l] = !sel[l]; b.setAttribute('aria-pressed', String(sel[l])); drawToday(); });
      box.appendChild(b);
    });
  }
  function drawRuleForm() {
    Array.prototype.forEach.call($('rSlot').querySelectorAll('button'), function (b) {
      var on = b.getAttribute('data-s') === rslot; b.classList.toggle('on', on); b.setAttribute('aria-checked', String(on)); b.setAttribute('role', 'radio');
    });
    $('rTime').value = /^\d{1,2}:\d{2}$/.test(rslot) ? ('0' + rslot).slice(-5) : '';
    Array.prototype.forEach.call($('rType').querySelectorAll('button'), function (b) {
      var on = b.getAttribute('data-t') === rtype; b.classList.toggle('on', on); b.setAttribute('aria-checked', String(on)); b.setAttribute('role', 'radio');
    });
    $('rWdBox').hidden = rtype !== '毎週'; $('rMdBox').hidden = rtype !== '毎月';
    $('rTypeNote').textContent = rtype === '平日' ? '土日・祝日は入りません' : rtype === '毎月' ? '「末」は月の最後の日' : '';
    drawToday();
  }
  function whenText() {
    if (rtype === '毎週') return WD.split('').filter(function (c) { return rwd[c]; }).join('');
    if (rtype === '毎月') { var a = []; for (var i = 1; i <= 31; i++) if (rmd[String(i)]) a.push(String(i)); if (rmd['末']) a.push('末'); return a.join(','); }
    return '';
  }
  // 今日に当たるか（スプシ側と同じ判定。祝日だけはスプシ側で確かめる）
  function hitsToday() {
    var t = state.today || localYmd(), p = t.split('-').map(Number), d = new Date(p[0], p[1] - 1, p[2]), wd = d.getDay() || 7;
    var from = $('rFrom').value, to = $('rTo').value;
    if ((from && t < from) || (to && t > to)) return false;
    if (rtype === '毎日') return true;
    if (rtype === '平日') return wd <= 5;
    if (rtype === '毎週') return !!rwd[WD.charAt(wd - 1)];
    if (rtype === '毎月') return !!rmd[String(p[2])] || (!!rmd['末'] && new Date(p[0], p[1] - 1, p[2] + 1).getDate() === 1);
    return false;
  }
  function drawToday() {
    var t = state.today || localYmd(), hit = hitsToday() && (!redit || redit.on);
    $('rTodayBox').hidden = !hit;
    $('rTodayLbl').textContent = '今日（' + md(t) + ' ' + dow(t) + '）の分もすぐ入れる';
  }
  function openRuleForm(r) {
    redit = r || null;
    $('rsListView').hidden = true; $('rsForm').hidden = false; $('rsheet').scrollTop = 0;
    $('rsTitle').textContent = r ? '定期タスクを直す' : '定期タスクを追加';
    $('rSave').textContent = r ? '保存' : '追加する';
    $('rEditNote').hidden = !r;
    $('rTodo').value = r ? r.todo : ''; $('rPj').value = r ? r.pj : (prefs().pj || '');
    $('rKo').value = r && r.ko != null ? r.ko : '0.5';
    $('rDetail').value = r ? r.detail : ''; $('rFrom').value = r ? r.from : ''; $('rTo').value = r ? r.to : '';
    rslot = '';
    if (r) { for (var k in SLOT_EMOJI) if (SLOT_EMOJI[k] === r.time) rslot = k; var tm = /^(\d{1,2}):(\d{2})/.exec(r.time); if (!rslot && tm) rslot = Number(tm[1]) + ':' + tm[2]; }
    else rslot = '朝';
    rtype = r ? r.type : '平日';
    rwd = {}; rmd = {};
    if (r && r.type === '毎週') r.when.split('').forEach(function (c) { rwd[c] = true; });
    if (r && r.type === '毎月') r.when.split(',').forEach(function (c) { rmd[c] = true; });
    chipGrid($('rWd'), WD.split(''), rwd);
    var mds = []; for (var i = 1; i <= 31; i++) mds.push(String(i)); mds.push('末');
    chipGrid($('rMd'), mds, rmd);
    $('rToday').checked = !r;
    drawRuleForm();
    $('rTodo').focus();
  }
  function saveRule(e) {
    e.preventDefault();
    var todo = $('rTodo').value.replace(/[\r\n]+/g, ' ').trim();
    if (!todo) { toast(ERR.no_todo, true); $('rTodo').focus(); return; }
    var ko = parseFloat($('rKo').value);
    if (!isFinite(ko) || ko < 0 || ko > 24) { toast(ERR.bad_ko, true); return; }
    var when = whenText();
    if ((rtype === '毎週' || rtype === '毎月') && !when) { toast(ERR.bad_when, true); return; }
    var rule = { pj: $('rPj').value.trim(), todo: todo, ko: ko, time: rslot, type: rtype, when: when,
      from: $('rFrom').value, to: $('rTo').value, detail: $('rDetail').value.trim() };
    var p = { reqId: reqId(), rule: rule, today: !$('rTodayBox').hidden && $('rToday').checked };
    if (redit) { p.row = redit.row; p.pj = redit.pj; p.todo = redit.todo; }
    var btn = $('rSave'), label = btn.textContent; btn.disabled = true; btn.textContent = '保存中…';
    var send = function (tries) {
      return api('recurSave', p).catch(function (err) {
        if (tries > 0 && (err.code === 'network' || err.code === 'timeout' || err.code === 'busy')) return send(tries - 1);   // reqId が同じなので二重にならない
        throw err;
      });
    };
    send(1).then(function (d) {
      var msg = redit ? '保存しました' : '追加しました';
      if (d.todayAdded) msg += '（今日の分もタスクに入れました）';
      else if (p.today && d.todayNote === 'already') msg += '（今日の分はもう入っています）';
      else if (p.today && d.todayNote === 'not_today') msg += '（今日は祝日などで当たらないため、入れていません）';
      else msg += '（翌朝8時から入ります）';
      toast(msg);
      if (d.rule) { var hit = false; rules = rules.map(function (x) { if (x.row === d.rule.row) { hit = true; return d.rule; } return x; }); if (!hit) rules.push(d.rule); }
      showRecurList(); drawRules();
      if (d.todayAdded) load(true);
    }, function (err) { toast(errText(err) + '（入力内容は残しています）', true); if (err.code === 'recur_changed') openRecur(); })
      .then(function () { btn.disabled = false; btn.textContent = label; });
  }
  $('recurBtn').addEventListener('click', function () { if (conn()) openRecur(); else $('scanBtn').focus(); });
  $('rsClose').addEventListener('click', closeSheet);
  $('rsNew').addEventListener('click', function () { openRuleForm(null); });
  $('rCancel').addEventListener('click', function () { showRecurList(); drawRules(); });
  $('rsForm').addEventListener('submit', saveRule);
  $('rSlot').addEventListener('click', function (e) { var b = e.target.closest('button'); if (!b) return; rslot = b.getAttribute('data-s'); drawRuleForm(); });
  $('rTime').addEventListener('change', function () { if (this.value) { rslot = this.value; drawRuleForm(); } });
  $('rType').addEventListener('click', function (e) { var b = e.target.closest('button'); if (!b) return; rtype = b.getAttribute('data-t'); drawRuleForm(); });
  ['rFrom', 'rTo'].forEach(function (id) { $(id).addEventListener('change', drawToday); });

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
  $('tToggle').addEventListener('click', function () { if (cur) { timerToggle(tkey(cur)); actTouched = false; autoStarted = false; drawTimer(); } });
  $('tReset').addEventListener('click', function () { if (cur) { timerClear(tkey(cur)); act = cur.ko != null ? cur.ko : 0.5; actTouched = false; drawSheet(); } });
  $('shDone').addEventListener('click', doDone);
  $('shLater').addEventListener('click', closeSheet);
  $('dim').addEventListener('click', closeSheet);
  $('wsSave').addEventListener('click', saveWait);
  try { $('tmrDet').open = localStorage.getItem('task.tmrOpen') === '1'; } catch (e) { /* 覚えられない端末でも使える */ }
  $('tmrDet').addEventListener('toggle', function () { try { localStorage.setItem('task.tmrOpen', this.open ? '1' : '0'); } catch (e) { /* なし */ } });
  $('wsClose').addEventListener('click', closeSheet);
  $('wsPreQ').addEventListener('input', drawPre);
  $('wsPreAll').addEventListener('click', function () { preOpen = true; drawPre(); });
  $('wsSlot').addEventListener('click', function (e) { var b = e.target.closest('button'); if (!b) return; wslot = b.getAttribute('data-s'); drawSlot(); });
  $('wsTime').addEventListener('change', function () { if (this.value) { wslot = this.value; drawSlot(); } });
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

  window.addEventListener('hashchange', function () { if (consumeHash()) { start(); toast('この端末をつなぎました'); } });
  var hashed = consumeHash();
  start();
  if (hashed) toast('この端末をつなぎました');
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(function () {});
})();
