/* ルーティン：習慣の達成記録＋日記＋月カレンダー（予定・生理・コレクション）＋起床・就寝記録（2026-11-05 から /diary/ で公開）
 * レコード（同じシート app=routine）。睡眠のレコードは sleep.js、生理は period.js の先頭を参照
 *   習慣：id = h-xxxx            data = { kind:'habit', name, time, color, order, since, archivedOn }
 *   記録：id = log-YYYYMMDD-<習慣id> data = { kind:'log', date:'YYYY-MM-DD', habit, at }
 *   記録は「日付＋習慣」で id が決まるので、同じ日に二重にはならない。取り消しは削除。
 *   生理：id = period-YYYYMMDD   data = { kind:'period', start, end（空＝記録中）, at }
 *   種類：id = ctype-xxxx（料理は ctype-food で固定）  data = { kind:'ctype', name, icon, color, order, archivedOn }
 *   日記：id = diary-YYYYMMDD    data = { kind:'diary', date, event, thanks, maxim, free, image:{ id, thumb }|null, at }
 *   1件 ：id = item-xxxx         data = { kind:'item', type, date, name, memo（60文字まで）, image:{ id, thumb }|null, at }
 * Googleカレンダーの予定はスプシに保存しない（GAS の calMonth で読む。端末には最後に読んだ月の分だけ置く）。
 * 「表示」の切り替え・睡眠の表示オンオフは端末ごと（localStorage）。
 * 1日の区切りは深夜3時（3時までは前の日として扱う）。
 */
(function () {
  'use strict';
  var APP = 'routine';
  var DAY_START_HOUR = 3;
  var APP_URL = 'https://cotoxdgn.github.io/diary/';

  var COLORS = [
    { k: 'sage', label: 'セージ' }, { k: 'blue', label: 'ブルーグレー' }, { k: 'rose', label: 'ローズ' },
    { k: 'mustard', label: 'マスタード' }, { k: 'lilac', label: 'ライラック' }
  ];
  var DEFAULTS = [
    { id: 'h-supple', data: { kind: 'habit', name: 'サプリを飲んだ', time: '', color: 'sage', order: 10, since: '', archivedOn: '' } },
    { id: 'h-bath', data: { kind: 'habit', name: '22:30お風呂', time: '22:30', color: 'blue', order: 20, since: '', archivedOn: '' } }
  ];
  var WD = ['日', '月', '火', '水', '木', '金', '土'];
  var CHECK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>';
  var FLOWER = '<svg class="flower" viewBox="0 0 20 20" aria-hidden="true"><g fill="var(--rose)"><circle cx="10" cy="5.2" r="3.3"/><circle cx="14.6" cy="8.6" r="3.3"/><circle cx="12.8" cy="14" r="3.3"/><circle cx="7.2" cy="14" r="3.3"/><circle cx="5.4" cy="8.6" r="3.3"/></g><circle cx="10" cy="10" r="2.6" fill="var(--mustard)"/></svg>';

  var MOON = '<svg class="moon" viewBox="0 0 12 12" aria-hidden="true"><path d="M10.2 7.6A4.6 4.6 0 0 1 4.4 1.8a4.6 4.6 0 1 0 5.8 5.8z" fill="var(--blue)"/></svg>';
  var SL = window.RoutineSleep;
  var P = window.RoutinePeriod;
  var ST = window.RoutineStickers;
  var SHORTCUT = '睡眠を送る';
  var SHORTCUT_URL = 'shortcuts://run-shortcut?name=' + encodeURIComponent(SHORTCUT);
  var SHORTCUT_FORCE = SHORTCUT_URL + '&input=text&text=' + encodeURIComponent('いま');

  var db = Apps.collection(APP);
  var $ = function (id) { return document.getElementById(id); };
  var state = { habits: [], allHabits: [], logs: {}, today: '', month: null, editing: null, color: 'sage',
    per: [], types: [], allTypes: [], items: [], diary: {}, sel: '', view: 'today' };
  var sl = { days: {}, goalData: null, hist: SL.history(null), hol: {}, range: 'w', kind: 'wake', sel: null, editDate: null, key: '', keyShown: false };

  // ---------- 日付 ----------
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function ymd(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function logicalToday() { return ymd(new Date(Date.now() - DAY_START_HOUR * 3600 * 1000)); }
  function parse(s) { var p = s.split('-'); return new Date(+p[0], +p[1] - 1, +p[2]); }
  function addDays(s, n) { var d = parse(s); d.setDate(d.getDate() + n); return ymd(d); }
  function logId(date, habitId) { return 'log-' + date.replace(/-/g, '') + '-' + habitId; }
  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function hm(iso) { var d = new Date(iso); return d.getHours() + ':' + pad(d.getMinutes()); }

  // ---------- データの読み出し ----------
  function load(list) {
    var hs = [], logs = {};
    list.forEach(function (r) {
      var d = r.data || {};
      if (d.kind === 'habit') hs.push({ id: r.id, name: d.name, time: d.time || '', color: d.color || 'sage', order: +d.order || 0, since: d.since || '', archivedOn: d.archivedOn || '' });
      else if (d.kind === 'log' && d.date && d.habit) logs[d.date + '|' + d.habit] = d;
    });
    loadV2(list);
    // まだ習慣が1つも無いとき（初回・未接続）は初期の2つを表示する（保存は同期のあと）
    DEFAULTS.forEach(function (x) {
      if (!hs.some(function (h) { return h.id === x.id; }) && !list.some(function (r) { return r.data && r.data.kind === 'habit'; })) {
        var d = x.data; hs.push({ id: x.id, name: d.name, time: d.time, color: d.color, order: d.order, since: '', archivedOn: '', virtual: true });
      }
    });
    hs.sort(function (a, b) { return a.order - b.order || (a.id < b.id ? -1 : 1); });
    state.allHabits = hs;
    state.habits = hs.filter(function (h) { return !h.archivedOn; });
    state.logs = logs;
    var b = SL.build(list);
    sl.days = b.days;
    sl.goalData = b.goalData;
    sl.hist = SL.history(b.goalData);
    sl.hol = {};
    ((b.goalData && Array.isArray(b.goalData.hol)) ? b.goalData.hol : SL.DEFAULT_HOL).forEach(function (w) { sl.hol[w] = 1; });
  }
  function done(date, hid) { return !!state.logs[date + '|' + hid]; }
  function habitsOn(date) {
    return state.allHabits.filter(function (h) {
      return (!h.since || h.since <= date) && (!h.archivedOn || date < h.archivedOn);
    });
  }
  function fullDay(date) {
    var hs = habitsOn(date);
    return hs.length > 0 && hs.every(function (h) { return done(date, h.id); });
  }
  // 今日がまだなら昨日から数える
  function streak(test) {
    var d = state.today, n = 0;
    if (!test(d)) d = addDays(d, -1);
    while (test(d) && n < 3700) { n++; d = addDays(d, -1); }
    return n;
  }

  // ---------- 今日 ----------
  function renderToday() {
    var t = parse(state.today);
    $('todayTitle').textContent = (t.getMonth() + 1) + '月' + t.getDate() + '日（' + WD[t.getDay()] + '）';
    $('stAll').textContent = streak(fullDay);
    var m = state.today.slice(0, 7), c = 0;
    for (var d = m + '-01'; d <= state.today && d.slice(0, 7) === m; d = addDays(d, 1)) if (fullDay(d)) c++;
    $('stMonth').textContent = c;

    var box = $('habits');
    box.innerHTML = '';
    if (!state.habits.length) { box.innerHTML = '<div class="card empty">習慣がありません。「習慣」から追加してください。</div>'; }
    state.habits.forEach(function (h) {
      var on = done(state.today, h.id);
      var log = state.logs[state.today + '|' + h.id];
      var s = streak(function (d) { return done(d, h.id); });
      var el = document.createElement('div');
      el.className = 'habit';
      el.innerHTML = '<div class="txt"><span class="name">' + esc(h.name) + '</span><span class="meta">' +
        (on ? '記録 ' + hm(log.at) : (h.time ? '目安 ' + esc(h.time) : 'まだ')) + '　' + s + '日連続</span></div>' +
        '<button type="button" class="check' + (on ? ' on' : '') + (state.pop === h.id && on ? ' pop' : '') + '" style="--c:var(--' + h.color + ')" aria-pressed="' + on + '" aria-label="' + esc(h.name) + 'を記録" data-h="' + esc(h.id) + '">' + CHECK + '</button>';
      el.querySelector('button').addEventListener('click', function () { toggle(h.id); });
      box.appendChild(el);
    });
    state.pop = null;
    var all = fullDay(state.today);
    $('alldone').hidden = !all;
    if (all) $('alldone').innerHTML = FLOWER + '<span>今日は全部できました。カレンダーに花のスタンプを押しました。</span>';
    renderPerCard();
    renderDiaryCard();
  }
  function toggle(hid) {
    var date = state.today, id = logId(date, hid);
    state.pop = hid;
    if (done(date, hid)) db.remove(id);
    else db.put({ kind: 'log', date: date, habit: hid, at: new Date().toISOString() }, id);
  }

  // ---------- 端末ごとの設定（localStorage。使えない時は既定のまま） ----------
  var LS = 'routine.';
  function lsGet(k, def) { try { var v = localStorage.getItem(LS + k); return v == null ? def : JSON.parse(v); } catch (e) { return def; } }
  function lsSet(k, v) { try { localStorage.setItem(LS + k, JSON.stringify(v)); } catch (e) { /* 保存できなくても動く */ } }
  function sleepOn() { return lsGet('sleepOn', false) === true; }
  var LAYERS = (function () {
    var d = { ev: true, hb: true, per: true, ph: true }, v = lsGet('layers', null);
    if (v && typeof v === 'object') Object.keys(d).forEach(function (k) { if (typeof v[k] === 'boolean') d[k] = v[k]; });
    return d;
  })();
  var wideMq = window.matchMedia ? window.matchMedia('(min-width: 768px)') : { matches: false };
  function isWide() { return !!wideMq.matches; }

  // ---------- 2版目のデータ（生理・種類・1件） ----------
  var FOOD = { id: 'ctype-food', data: { kind: 'ctype', name: '料理', icon: 'bowl', color: 'mustard', order: 10, archivedOn: '' } };
  var COLS = ['sage', 'blue', 'rose', 'mustard', 'lilac'];
  function loadV2(list) {
    state.per = P.build(list);
    var ts = [], items = [], dia = {};
    list.forEach(function (r) {
      var d = r.data || {};
      if (d.kind === 'diary' && d.date) dia[d.date] = { date: d.date, event: d.event || '', thanks: d.thanks || '', maxim: d.maxim || '', free: d.free || '', image: d.image && d.image.id ? d.image : null };
      if (d.kind === 'ctype') ts.push({ id: r.id, name: d.name || '', icon: d.icon || 'dot', color: COLS.indexOf(d.color) >= 0 ? d.color : 'blue', order: +d.order || 0, archivedOn: d.archivedOn || '' });
      else if (d.kind === 'item' && d.date) items.push({ id: r.id, type: d.type || FOOD.id, date: d.date, name: d.name || '', memo: d.memo || '', image: d.image && d.image.id ? d.image : null, at: d.at || r.createdAt || '' });
    });
    if (!ts.some(function (t) { return t.id === FOOD.id; })) { var f = FOOD.data; ts.push({ id: FOOD.id, name: f.name, icon: f.icon, color: f.color, order: f.order, archivedOn: '', virtual: true }); }
    ts.sort(function (a, b) { return a.order - b.order || (a.id < b.id ? -1 : 1); });
    state.allTypes = ts;
    state.types = ts.filter(function (t) { return !t.archivedOn; });
    items.sort(function (a, b) { return a.date < b.date ? 1 : a.date > b.date ? -1 : (a.at < b.at ? 1 : a.at > b.at ? -1 : 0); });
    state.items = items;
    state.diary = dia;
  }
  function typeOf(id) {
    for (var i = 0; i < state.allTypes.length; i++) if (state.allTypes[i].id === id) return state.allTypes[i];
    return { id: id, name: '（種類なし）', icon: 'dot', color: 'blue', archivedOn: '' };
  }
  function itemsOn(ds) { return state.items.filter(function (it) { return it.date === ds; }).reverse(); }   // その日の古い順
  function pc() { return P.calc(state.per, state.today); }

  // ---------- 表示の小物 ----------
  function diff(a, b) { return P.diff(a, b); }
  function mdw(ds) { var d = parse(ds); return (d.getMonth() + 1) + '/' + d.getDate() + '（' + WD[d.getDay()] + '）'; }
  function jp(ds) { var d = parse(ds); return (d.getMonth() + 1) + '月' + d.getDate() + '日（' + WD[d.getDay()] + '）'; }
  function sticker(color, ic, extra) { return '<span class="sticker' + (extra ? ' ' + extra : '') + '" style="--lc:var(--' + color + ')">' + ST.icon(ic) + '</span>'; }
  function picOf(it, size, inCell) {
    var t = typeOf(it.type);
    if (it.image && it.image.id) return '<img alt="" loading="lazy" src="' + esc(Apps.imageUrl(it.image.id, size || 400)) + '">';
    if (inCell) return '<span class="noimg" style="--lc:var(--' + t.color + ')">' + ST.icon(t.icon) + '</span>';   // 写真なし：種類の絵
    return '<span class="noimg" style="--lc:var(--' + t.color + ');--lc-soft:var(--' + t.color + '-soft)">' + sticker(t.color, t.icon) + '</span>';
  }
  function thumbHTML(it) {
    var t = typeOf(it.type);
    return '<button class="thumb" type="button" data-item="' + esc(it.id) + '"><span class="pic">' + picOf(it, 400) + sticker(t.color, t.icon, 'tg') +
      '</span><span class="cap">' + esc(it.name || t.name) + '</span><small>' + md(it.date) + '</small></button>';
  }
  function untilText(dd) { return dd > 0 ? 'あと' + dd + '日' : dd === 0 ? '今日' : '予定日から' + (-dd) + '日'; }

  // ---------- Googleカレンダーの予定（calMonth） ----------
  var ev = { mem: {}, err: null, loading: '' };
  function monthKey(m) { m = m || state.month; return m.y + '-' + pad(m.m + 1); }
  function monthFrom(m) { return monthKey(m) + '-01'; }
  function monthTo(m) { return monthKey(m) + '-' + pad(new Date(m.y, m.m + 1, 0).getDate()); }
  function cachedMonth() { var c = lsGet('calCache', null); return c && c.ym && Array.isArray(c.events) ? c : null; }
  function eventsFor(k) {
    if (ev.mem[k]) return ev.mem[k];
    var c = cachedMonth();
    return c && c.ym === k ? { events: c.events, at: c.at, cached: true } : null;
  }
  function loadEvents(force) {
    var m = state.month, k = monthKey(m);
    if (!Apps.isConnected(APP)) { ev.err = { code: 'not_connected' }; renderCalNote(); return Promise.resolve(); }
    if (!force && ev.mem[k] && !ev.mem[k].cached) return Promise.resolve();
    if (ev.loading === k) return Promise.resolve();
    ev.loading = k;
    renderCalNote();
    return Apps.call(APP, 'calMonth', { from: monthFrom(m), to: monthTo(m) }).then(function (r) {
      var v = { events: Array.isArray(r.events) ? r.events : [], at: new Date().toISOString() };
      ev.mem[k] = v;
      lsSet('calCache', { ym: k, events: v.events, at: v.at });   // 端末には最後に読んだ月の分だけ
      if (monthKey() === k) ev.err = null;
    }, function (e) {
      if (monthKey() === k) ev.err = e;
    }).then(function () {
      if (ev.loading === k) ev.loading = '';
      if (monthKey() === k) { renderCalendar(); refreshOpen(); }
    });
  }
  function calErrText(e) {
    var c = e && (e.code || e.message);
    if (c === 'not_connected') return 'スプシとつながると、Googleカレンダーの予定が出ます（習慣 → スプレッドシートとの接続）';
    if (c === 'bad_action') return 'スプシのプログラムが古いままです。Code.gs を貼り替えて［デプロイを管理］→新バージョンで更新すると、予定が出ます';
    if (c === 'calendar') return 'カレンダーを使う許可がまだありません。スプシの Apps Script で関数「authorizeCalendar」を実行して許可し、［デプロイを管理］→新バージョンで更新してください';
    return '予定を読めませんでした：' + Apps.errorText(e);
  }
  function renderCalNote() {
    var k = monthKey(), v = eventsFor(k), n = $('calNote'), t = '', bad = false;
    if (ev.loading === k && !v) t = '予定を読んでいます…';
    else if (ev.err) {
      var c = ev.err.code || ev.err.message;
      if ((c === 'offline' || c === 'network' || c === 'timeout') && v) { var d = new Date(v.at); t = 'つながらないので、前に読んだ予定（' + (d.getMonth() + 1) + '/' + d.getDate() + ' ' + hm(v.at) + '）を出しています'; }
      else { t = calErrText(ev.err); bad = c !== 'not_connected'; }
    } else t = '予定は Googleカレンダー（普段使いの1つ）から読みます。スプシには保存しません。下に引っぱると読み直します';
    n.textContent = t;
    n.className = 'calnote' + (bad ? ' err' : '');
  }
  // 予定 → 日ごとの一覧（終日・何日も続く予定は、その日すべてに）
  function evDays(list) {
    var by = {};
    (list || []).forEach(function (e) {
      var title = String(e.title || '（件名なし）'), c = ST.color(e.color), ic = ST.evIcon(title);
      if (e.allDay) {
        var s = String(e.start || '').slice(0, 10), en = String(e.end || '').slice(0, 10);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return;
        var last = /^\d{4}-\d{2}-\d{2}$/.test(en) && en > s ? addDays(en, -1) : s;
        for (var d = s, n = 0; d <= last && n < 62; d = addDays(d, 1), n++) (by[d] = by[d] || []).push({ title: title, c: c, ic: ic, all: true, sort: '' });
        return;
      }
      var a = new Date(e.start), b = new Date(e.end);
      if (isNaN(a)) return;
      if (isNaN(b) || b < a) b = a;
      var sd = ymd(a), ed = ymd(new Date(Math.max(+a, +b - 1)));
      for (var d2 = sd, n2 = 0; d2 <= ed && n2 < 62; d2 = addDays(d2, 1), n2++) {
        var first = d2 === sd, lastD = d2 === ed;
        var range = first && lastD ? hm(a) + '〜' + hm(b) : first ? hm(a) + '〜' : lastD ? '〜' + hm(b) : '終日';
        (by[d2] = by[d2] || []).push({ title: title, c: c, ic: ic, all: false, tm: first ? hm(a) : '', range: range, sort: first ? pad(a.getHours()) + pad(a.getMinutes()) : '00' });
      }
    });
    Object.keys(by).forEach(function (k) { by[k].sort(function (x, y) { return x.all === y.all ? (x.sort < y.sort ? -1 : x.sort > y.sort ? 1 : 0) : x.all ? -1 : 1; }); });
    return by;
  }
  var evBy = {};

  // ---------- カレンダー ----------
  function labHTML(e, i) {
    return '<span class="lab' + (i === 2 ? ' l3' : '') + '" style="--lc:var(--' + e.c + ');--lc-soft:var(--' + e.c + '-soft)" title="' + esc((e.all ? '終日 ' : e.range + ' ') + e.title) + '"><i>' + ST.icon(e.ic) + '</i>' +
      (e.tm ? '<em class="tm">' + e.tm + '</em>' : '') + '<span>' + esc(e.title) + '</span></span>';
  }
  function renderCalendar() {
    var y = state.month.y, mo = state.month.m, k = monthKey();
    $('monthTitle').textContent = y + '年' + (mo + 1) + '月';
    Array.prototype.forEach.call(document.querySelectorAll('[data-ly]'), function (b) { b.setAttribute('aria-pressed', String(!!LAYERS[b.getAttribute('data-ly')])); });
    var v = eventsFor(k);
    evBy = evDays(v ? v.events : []);
    var p = pc(), son = sleepOn();
    var html = WD.map(function (w, i) { return '<div class="wd' + (i === 0 ? ' sun' : i === 6 ? ' sat' : '') + '">' + w + '</div>'; }).join('');
    var first = new Date(y, mo, 1), days = new Date(y, mo + 1, 0).getDate();
    for (var i = 0; i < first.getDay(); i++) html += '<div class="day blank" aria-hidden="true"></div>';
    var fullN = 0, best = 0, run = 0, per = {}, elapsed = 0, sleepN = 0, photoN = 0;
    for (var d = 1; d <= days; d++) {
      var ds = ymd(new Date(y, mo, d));
      var cls = 'day', inner = '<span class="n">' + d + '</span>', label = jp(ds), title = [];
      if (ds === state.today) { cls += ' today'; label += '・今日'; }
      if (ds === state.sel) cls += ' sel';
      if (ds > state.today) { cls += ' future'; run = 0; }
      var pd = P.dayOf(ds, p);
      if (LAYERS.per && pd) { cls += ' per'; label += '・生理' + pd.n + '日目'; }
      else if (LAYERS.per && P.predicted(ds, p)) { cls += ' yosoku'; label += '・生理の予定日（予測）'; }
      var its = itemsOn(ds);
      photoN += its.length;
      if (LAYERS.ph && its.length) {
        inner += '<span class="ph">' + picOf(its[0], 200, true) + (its.length > 1 ? '<b>' + its.length + '</b>' : '') + '</span>';
        label += '・写真' + its.length + '件';
      }
      if (state.diary[ds]) { inner += '<i class="dmark" aria-hidden="true"></i>'; label += '・日記あり'; }
      if (ds <= state.today) {
        elapsed++;
        if (son && sleepGood(ds)) { sleepN++; inner += MOON; }
        state.allHabits.forEach(function (h) { if (done(ds, h.id)) per[h.id] = (per[h.id] || 0) + 1; });
      }
      if (LAYERS.ev) {
        var evs = evBy[ds] || [];
        inner += evs.slice(0, 3).map(labHTML).join('');
        if (evs.length > 2) inner += '<span class="more n">+' + (evs.length - 2) + '</span>';
        if (evs.length > 3) inner += '<span class="more w">+' + (evs.length - 3) + '</span>';
        if (evs.length) label += '・予定' + evs.length + '件';
        evs.forEach(function (e) { title.push((e.all ? '終日' : e.range) + ' ' + e.title); });
      }
      if (ds <= state.today) {
        var full = fullDay(ds);
        if (full) { fullN++; run++; best = Math.max(best, run); } else if (ds !== state.today) run = 0;
        if (LAYERS.hb) {
          inner += '<span class="stamps"' + (full ? ' aria-label="全部できた"' : '') + '>' + (full ? FLOWER : state.allHabits.filter(function (h) { return done(ds, h.id); })
            .map(function (h) { return '<i class="dot" style="background:var(--' + h.color + ')" title="' + esc(h.name) + '"></i>'; }).join('')) + '</span>';
          if (full) label += '・習慣を全部できた';
        }
      }
      html += '<button type="button" class="' + cls + '" data-d="' + ds + '" aria-label="' + esc(label) + '"' + (title.length ? ' title="' + esc(title.join('\n')) + '"' : '') + '>' + inner + '</button>';
    }
    $('cal').innerHTML = html;
    var lg = '';
    if (LAYERS.per) lg += '<span><i class="sq" style="background:var(--per)"></i>生理</span><span><i class="sq" style="background:var(--per-soft);outline:1.5px dashed var(--per);outline-offset:-1.5px"></i>次の予定日（予測）</span>';
    if (LAYERS.hb) lg += '<span>' + FLOWER + '習慣を全部できた日</span>' + state.habits.map(function (h) { return '<span><i class="dot" style="background:var(--' + h.color + ')"></i>' + esc(h.name) + '</span>'; }).join('');
    if (LAYERS.ph) lg += '<span><i class="sq" style="border-radius:50%;background:var(--mustard-soft);border:1.5px solid var(--mustard)"></i>写真（コレクション）</span>';
    lg += '<span><i class="dot" style="background:var(--ax-accent)"></i>日記を書いた日</span>';
    if (son) lg += '<span>' + MOON + '睡眠が目標内（起床・就寝・長さ）</span>';
    $('legend').innerHTML = lg;
    var sum = '<div><b class="num">' + fullN + '日</b><small>全部できた日</small></div>' +
      '<div><b class="num">' + best + '日</b><small>この月の最長連続</small></div>' +
      (son ? '<div><b class="num">' + sleepN + '／' + elapsed + '</b><small>睡眠が目標内の日</small></div>' : '');
    state.allHabits.forEach(function (h) {
      if (h.archivedOn && !per[h.id]) return;
      sum += '<div><b class="num">' + (per[h.id] || 0) + '／' + elapsed + '</b><small>' + esc(h.name) + '</small></div>';
    });
    sum += '<div><b class="num">' + photoN + '件</b><small>この月の写真</small></div>';
    $('summary').innerHTML = sum;
    renderCalNote();
    if (isWide()) $('panel').innerHTML = dayHTML(state.sel || state.today);
  }
  function dayHTML(ds) {
    var p = pc(), pd = P.dayOf(ds, p), h = '<div class="dd"><h3>' + jp(ds) + '</h3>';
    if (pd) h += '<span class="perline on">生理 ' + pd.n + '日目</span>';
    else if (P.predicted(ds, p)) h += '<span class="perline pr">生理の予定日（予測）</span>';
    if (ds <= state.today) {
      var btn = '';
      if (pd && !pd.r.e) btn = '<button class="ax-btn btn-per" type="button" data-act="perEndOn" data-d="' + ds + '">生理がこの日に終わった</button>';
      else if (!pd && p.ongoing && ds > p.last.s) btn = '<button class="ax-btn btn-per" type="button" data-act="perEndOn" data-d="' + ds + '">生理がこの日に終わった</button>';
      else if (!pd && !p.ongoing) btn = '<button class="ax-btn" type="button" data-act="perStartOn" data-d="' + ds + '">生理がこの日に始まった</button>';
      if (pd) btn += '<button class="ax-btn ax-btn-ghost" type="button" data-act="perEditOf" data-d="' + esc(pd.r.id) + '">生理の記録を直す ›</button>';
      if (btn) h += '<div class="btns">' + btn + '</div>';
    }
    var evs = evBy[ds] || [];
    h += '<div class="grp"><span class="lb">予定</span>' + (evs.length ? evs.map(function (e) {
      return '<div class="ev"><span class="tm">' + (e.all ? '終日' : e.range) + '</span>' + sticker(e.c, e.ic) + '<span class="tt">' + esc(e.title) + '</span></div>';
    }).join('') : '<span class="small muted">' + (eventsFor(monthKey(state.month)) ? '予定なし' : '予定はまだ読めていません') + '</span>') + '</div>';
    var hs = habitsOn(ds);
    h += '<div class="grp"><span class="lb">習慣</span>' + (ds > state.today ? '<span class="small muted">これからの日</span>' : (hs.length ? hs.map(function (x) {
      var on = done(ds, x.id);
      return '<div class="hrow"><i class="dot' + (on ? '' : ' off') + '"' + (on ? ' style="background:var(--' + x.color + ')"' : '') + '></i>' + esc(x.name) + '<span class="small muted">' + (on ? 'できた' : 'まだ') + '</span></div>';
    }).join('') : '<span class="small muted">習慣なし</span>') + '<span class="note">つけ外しは今日の画面で</span>') + '</div>';
    if (ds <= state.today) {
      var de = state.diary[ds];
      h += '<div class="grp"><span class="lb">日記</span>' + (de ? '<p class="dsum">' + esc(diaryText(de)) + '</p>' : '<span class="small muted">まだ書いていません</span>') +
        '<div class="btns"><button class="ax-btn" type="button" data-act="diaryOn" data-d="' + ds + '">' + (de ? '日記を開く' : '日記を書く') + '</button>' +
        '<button class="ax-btn ax-btn-ghost" type="button" data-act="diaryWeek" data-d="' + ds + '">この1週間をコピー</button></div></div>';
    }
    var its = itemsOn(ds);
    h += '<div class="grp"><span class="lb">コレクション</span>' + (its.length ? '<div class="thumbs">' + its.map(thumbHTML).join('') + '</div>' : '') +
      '<div class="btns"><button class="ax-btn" type="button" data-act="addOn" data-d="' + ds + '">＋ この日に追加</button></div></div>';
    return h + '</div>';
  }
  function openDay(ds) {
    state.sel = ds;
    renderCalendar();
    if (isWide()) return;
    $('sheetBody').innerHTML = dayHTML(ds);
    $('sheet').hidden = false; $('sheetBg').hidden = false;
    $('sheet').scrollTop = 0;
  }
  function closeSheet() { $('sheet').hidden = true; $('sheetBg').hidden = true; }
  // データが変わったら、開いている「その日の中身」と1件の画面を作り直す
  function refreshOpen() {
    if (!$('sheet').hidden) $('sheetBody').innerHTML = dayHTML(state.sel);
    if (state.view === 'diary' && !dy.dirty && !dy.saving) fillDiary(true);   // ほかの端末で書いた分も出す（書きかけの時は触らない）
    if (state.view === 'item-view') fillItemView();
  }
  function setMonth(y, m) {
    state.month = { y: y, m: m };
    state.sel = monthKey() === state.today.slice(0, 7) ? state.today : monthFrom(state.month);
    ev.err = null;
    renderCalendar();
    loadEvents(false);
  }
  function shiftMonth(n) { var m = state.month, d = new Date(m.y, m.m + n, 1); setMonth(d.getFullYear(), d.getMonth()); }
  $('prevM').onclick = function () { shiftMonth(-1); };
  $('nextM').onclick = function () { shiftMonth(1); };
  Array.prototype.forEach.call(document.querySelectorAll('[data-ly]'), function (b) {
    b.onclick = function () { var k = b.getAttribute('data-ly'); LAYERS[k] = !LAYERS[k]; lsSet('layers', LAYERS); renderCalendar(); refreshOpen(); };
  });
  $('cal').addEventListener('click', function (e) {
    var b = e.target.closest ? e.target.closest('button.day[data-d]') : null;
    if (b) openDay(b.getAttribute('data-d'));
  });
  $('sheetX').onclick = closeSheet;
  $('sheetBg').onclick = closeSheet;
  document.addEventListener('keydown', function (e) {
    if (state.view !== 'calendar' || /INPUT|TEXTAREA|SELECT/.test(e.target.tagName || '') || e.altKey || e.ctrlKey || e.metaKey) return;
    if (e.key === 'ArrowLeft') { e.preventDefault(); shiftMonth(-1); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); shiftMonth(1); }
    else if (e.key === 'Escape') closeSheet();
  });
  var onWide = function () { if (isWide()) closeSheet(); if (state.view === 'calendar') renderCalendar(); };
  if (wideMq.addEventListener) wideMq.addEventListener('change', onWide); else if (wideMq.addListener) wideMq.addListener(onWide);
  // 下に引っぱって更新（ページのいちばん上で）
  (function () {
    var y0 = null, dy = 0, hint = $('pullHint');
    var cal = $('v-calendar');
    cal.addEventListener('touchstart', function (e) { y0 = window.scrollY <= 0 && e.touches.length === 1 ? e.touches[0].clientY : null; dy = 0; }, { passive: true });
    cal.addEventListener('touchmove', function (e) {
      if (y0 == null) return;
      dy = e.touches[0].clientY - y0;
      hint.style.height = dy > 70 ? '22px' : '0';
    }, { passive: true });
    cal.addEventListener('touchend', function () {
      if (y0 != null && dy > 70) { loadEvents(true); if (Apps.isConnected(APP)) db.sync().catch(function () {}); Apps.toast('読み直しています'); }
      y0 = null; dy = 0; hint.style.height = '0';
    });
  })();

  // ---------- 生理 ----------
  function perPut(s, e) { return db.put({ kind: 'period', start: s, end: e || '', at: new Date().toISOString() }, P.idOf(s)); }
  function perStart(ds) {
    var p = pc();
    if (p.last && ds < p.last.s) { openPerEdit(null, ds); return; }   // 前の記録より前の日は、終わった日も入れる画面で
    perPut(ds, '');
    Apps.toast(md(ds) + ' を始まった日として記録しました');
  }
  function perEndAt(ds) {
    var p = pc(), r = p.last;
    if (!r || r.e) return;
    if (ds < r.s) { Apps.toast('始まった日より前にはできません', true); return; }
    db.put({ kind: 'period', start: r.s, end: ds, at: new Date().toISOString() }, r.id);
    Apps.toast(md(ds) + ' を終わった日として記録しました（' + (diff(r.s, ds) + 1) + '日間）');
  }
  function renderPerCard() {
    var p = pc(), h = '<div class="top"><h2>生理</h2><a class="ax-btn ax-btn-ghost" href="#rec">記録 ›</a></div>';
    if (p.ongoing) {
      var n = diff(p.last.s, state.today) + 1;
      h += '<div class="st"><b>' + n + '日目</b>　' + md(p.last.s) + 'から</div>';
      if (p.forgot) h += '<div class="warn">始まってから10日たちました。終わった日を入れてください（カレンダーかこの下の「記録」から）。</div>';
      h += '<button class="ax-btn btn-per" type="button" data-act="perEnd" id="tPerBtn">生理が終わった（' + n + '日目）</button>';
    } else {
      if (p.next) h += '<div class="st">次の予定日 <b>' + mdw(p.next) + '</b>ごろ　' + untilText(diff(state.today, p.next)) + '</div>';
      else h += '<div class="st muted">始まった日を記録すると、次の予定日が出ます</div>';
      h += '<button class="ax-btn btn-per" type="button" data-act="perStart" id="tPerBtn">生理が始まった</button>';
    }
    $('tPer').innerHTML = h;
  }
  function renderRec() {
    var p = pc(), h = '<div class="card statbox" id="perState">';
    if (p.ongoing) {
      var n = diff(p.last.s, state.today) + 1;
      h += '<span class="small muted">いまの状態</span><span class="big">生理 ' + n + '日目</span><span class="small">' + mdw(p.last.s) + 'から（記録中）</span>';
      if (p.forgot) h += '<div class="warn">始まってから10日たちました。終わった日を入れてください。カレンダーは平均の' + p.len + '日までを塗っています。</div>';
      h += '<button class="ax-btn btn-per" type="button" data-act="perEnd">生理が終わった（' + n + '日目）</button>';
    } else {
      h += '<span class="small muted">いまの状態</span><span class="big">生理ではない日</span>';
      h += '<button class="ax-btn btn-per" type="button" data-act="perStart">生理が始まった</button>';
    }
    h += '<span class="note">押すと今日の日付で記録します（深夜3時までは前の日）。違う日はカレンダーの日を押すか、下の一覧から直せます。</span></div>';
    if (p.next) {
      var dd = diff(state.today, p.next);
      h += '<div class="card pred" id="perPred"><span class="chip">' + md(p.next) + '</span><b>次の予定日 ' + mdw(p.next) + 'ごろ（' + untilText(dd) + '）</b>' +
        '<small>周期 ' + p.cycle + '日：' + esc(p.basis) + (p.temp ? '。2回目からは記録の平均です' : '（' + p.recent.join('・') + '日）') +
        '／うすく塗るのは' + p.len + '日間（' + (p.lensN ? 'これまでの平均' : '終わった日の記録がないので5日') + '）</small></div>';
    } else if (!p.list.length) {
      h += '<div class="card pred" id="perPred"><span class="chip">?</span><b>まだ予定日は出せません</b><small>始まった日を記録すると予定日が出ます（1回目は仮に28日周期、2回目からは記録の平均）。</small></div>';
    }
    h += '<div class="sect">これまでの記録（押すと直す）</div><div class="list" id="perList">';
    var rev = p.list.slice().reverse();
    h += rev.map(function (r, i) {
      var prev = rev[i + 1], c = prev ? diff(prev.s, r.s) : null, out = c != null && (c < P.MIN_CYCLE || c > P.MAX_CYCLE);
      return '<button class="row" type="button" data-act="perEditOf" data-d="' + esc(r.id) + '"><span class="bar' + (r.e ? '' : ' open') + '"></span><div class="txt"><span>' + mdw(r.s) + ' 〜 ' + (r.e ? mdw(r.e) : '記録中') + '</span><small>' +
        (r.s.slice(0, 4) !== state.today.slice(0, 4) ? r.s.slice(0, 4) + '年・' : '') + (r.e ? (diff(r.s, r.e) + 1) + '日間' : (diff(r.s, state.today) + 1) + '日目') + '</small></div><span class="r">' +
        (c != null ? '前回から<br>' + c + '日' + (out ? '（平均に入れない）' : '') : '最初の記録') + '</span></button>';
    }).join('') || '<div class="row"><span class="small muted">まだ記録がありません</span></div>';
    h += '</div><div class="btns"><button class="ax-btn" type="button" data-act="perNew">＋ 過去の記録を入れる</button></div>';
    h += '<p class="note">周期＝前回始まった日から今回始まった日までの日数。直近（最大6回）の平均で次の予定日を出します。15日より短い・60日より長い周期は、押し忘れなどとみて平均に入れません。</p>';
    $('recPer').innerHTML = h;
  }
  var pe = { rec: null, start: '' };
  function openPerEdit(id, start) {
    pe.rec = null;
    state.per.forEach(function (r) { if (r.id === id) pe.rec = r; });
    pe.start = start || '';
    if (location.hash === '#per-edit') fillPerEdit(); else location.hash = '#per-edit';
  }
  function fillPerEdit() {
    var r = pe.rec;
    $('peTitle').textContent = r ? '生理の記録を直す' : '過去の記録を入れる';
    $('peS').value = r ? r.s : pe.start;
    $('peE').value = r ? r.e : '';
    $('peS').max = state.today; $('peE').max = state.today;
    $('peDel').hidden = !r;
  }
  $('peForm').addEventListener('submit', function (e) {
    e.preventDefault();
    var s = $('peS').value, en = $('peE').value, r = pe.rec;
    if (!s) return;
    if (s > state.today) { Apps.toast('始まった日は今日までにしてください', true); return; }
    if (en && en < s) { Apps.toast('終わった日は始まった日と同じか後にしてください', true); return; }
    if (en && en > state.today) { Apps.toast('終わった日は今日までにしてください', true); return; }
    var nid = P.idOf(s);
    if ((!r || r.id !== nid) && db.get(nid)) { Apps.toast(md(s) + ' に始まった記録がもうあります', true); return; }
    if (r && r.id !== nid) db.remove(r.id);   // 始まった日を変えた：古い id を消して新しい id で作る
    perPut(s, en);
    pe.rec = null;
    location.hash = '#rec';
    Apps.toast('保存しました');
  });
  $('peDel').onclick = function () {
    var r = pe.rec;
    if (!r || !confirm(mdw(r.s) + ' からの生理の記録を消しますか？')) return;
    db.remove(r.id);
    pe.rec = null;
    location.hash = '#rec';
    Apps.toast('消しました');
  };

  // ---------- コレクション ----------
  var col = { type: lsGet('colType', 'all') };
  function renderCollection() {
    if (col.type !== 'all' && !state.types.some(function (t) { return t.id === col.type; })) col.type = 'all';
    $('colTypes').innerHTML = '<button type="button" class="plain" data-ct="all" aria-pressed="' + (col.type === 'all') + '">すべて</button>' +
      state.types.map(function (t) { return '<button type="button" data-ct="' + esc(t.id) + '" aria-pressed="' + (col.type === t.id) + '">' + sticker(t.color, t.icon) + esc(t.name) + '</button>'; }).join('') +
      '<a class="ax-btn ax-btn-ghost" href="#types" style="min-height:38px">＋ 種類・並べ替え</a>';
    var list = state.items.filter(function (it) { return col.type === 'all' || it.type === col.type; });
    $('colCount').textContent = list.length + '件・新しい順';
    $('gallery').innerHTML = list.length ? '<div class="gallery">' + list.map(thumbHTML).join('') + '</div>'
      : '<div class="card placeholder">まだありません。「＋ 追加」から写真を入れてみてください。</div>';
  }
  $('colTypes').addEventListener('click', function (e) {
    var b = e.target.closest ? e.target.closest('[data-ct]') : null;
    if (!b) return;
    col.type = b.getAttribute('data-ct');
    lsSet('colType', col.type);
    renderCollection();
  });
  $('colAdd').addEventListener('click', function (e) { e.preventDefault(); openItemEdit(state.today, null); });

  // 1件の追加・直し
  var ie = null;   // { item, file, preview, removePhoto, type, date }
  function openItemEdit(ds, it) {
    var t = it ? it.type : (col.type !== 'all' ? col.type : (state.types[0] ? state.types[0].id : FOOD.id));
    ie = { item: it || null, file: null, preview: null, removePhoto: false, type: t, date: it ? it.date : (ds || state.today) };
    closeSheet();
    if (location.hash === '#item-edit') fillItemEdit(); else location.hash = '#item-edit';
  }
  function fillItemEdit() {
    if (!ie) ie = { item: null, file: null, preview: null, removePhoto: false, type: state.types[0] ? state.types[0].id : FOOD.id, date: state.today };
    var it = ie.item;
    $('ieTitle').textContent = it ? '直す' : '追加';
    $('ieName').value = it ? it.name : '';
    $('ieDate').value = ie.date;
    $('ieDate').max = '';
    $('ieMemo').value = it ? it.memo : '';
    $('ieCount').textContent = $('ieMemo').value.length + '／60';
    $('ieDel').hidden = !it;
    $('ieSave').disabled = false; $('ieSave').textContent = '保存';
    fillPick(); fillIeTypes();
  }
  function fillPick() {
    var it = ie.item, has = !!(ie.preview || (it && it.image && !ie.removePhoto));
    $('iePick').innerHTML = ie.preview ? '<img alt="選んだ写真" src="' + esc(ie.preview) + '">' : has ? '<img alt="今の写真" src="' + esc(Apps.imageUrl(it.image.id, 900)) + '">' : '写真を選ぶ・撮る';
    $('iePhBtns').hidden = !has;
  }
  function fillIeTypes() {
    var ts = state.types.slice();
    if (!ts.some(function (t) { return t.id === ie.type; })) ts.push(typeOf(ie.type));   // しまった種類の記録を直すとき
    $('ieTypes').innerHTML = ts.map(function (t) { return '<button type="button" data-it="' + esc(t.id) + '" aria-pressed="' + (ie.type === t.id) + '">' + sticker(t.color, t.icon) + esc(t.name) + '</button>'; }).join('');
  }
  $('ieTypes').addEventListener('click', function (e) {
    var b = e.target.closest ? e.target.closest('[data-it]') : null;
    if (!b) return;
    ie.type = b.getAttribute('data-it'); fillIeTypes();
  });
  $('iePick').onclick = function () { $('ieFile').click(); };
  $('ieFile').onchange = function () {
    var f = this.files && this.files[0];
    if (!f) return;
    if (ie.preview) try { URL.revokeObjectURL(ie.preview); } catch (x) { /* 無視 */ }
    ie.file = f; ie.preview = URL.createObjectURL(f); ie.removePhoto = false;
    this.value = '';
    fillPick();
  };
  $('ieNoPh').onclick = function () { ie.file = null; ie.preview = null; ie.removePhoto = true; fillPick(); };
  $('ieMemo').addEventListener('input', function () { $('ieCount').textContent = $('ieMemo').value.length + '／60'; });
  $('ieForm').addEventListener('submit', function (e) {
    e.preventDefault();
    var name = $('ieName').value.trim(), date = $('ieDate').value, memo = $('ieMemo').value.trim().slice(0, 60);
    if (!name || !date) return;
    var it = ie.item, old = it && it.image ? it.image : null;
    var id = it ? it.id : 'item-' + Apps.uuid().replace(/[^a-z0-9]/gi, '').slice(0, 12);
    var cur = ie;
    var up = cur.file ? Apps.uploadImage(APP, cur.file, { maxSide: 1600, name: 'item-' + date.replace(/-/g, '') + '.jpg' }).then(function (img) { return { id: img.id, thumb: img.thumb || Apps.imageUrl(img.id, 400) }; })
      : Promise.resolve(cur.removePhoto ? null : old);
    $('ieSave').disabled = true; $('ieSave').textContent = cur.file ? '写真を保存中…' : '保存中…';
    up.then(function (image) {
      db.put({ kind: 'item', type: cur.type, date: date, name: name, memo: memo, image: image, at: it && it.at ? it.at : new Date().toISOString() }, id);
      if (old && (!image || image.id !== old.id)) removeImage(old.id);
      if (cur.preview) try { URL.revokeObjectURL(cur.preview); } catch (x) { /* 無視 */ }
      ie = null;
      Apps.toast('保存しました（' + md(date) + 'のカレンダーにも出ます）');
      location.hash = '#collection';
    }, function (err) {
      $('ieSave').disabled = false; $('ieSave').textContent = '保存';
      Apps.toast('写真を保存できませんでした：' + Apps.errorText(err), true);
    });
  });
  function deleteItem(it) {
    if (!it || !confirm('「' + (it.name || typeOf(it.type).name) + '」を消しますか？（ドライブの写真も消えます）')) return false;
    db.remove(it.id);
    if (it.image && it.image.id) removeImage(it.image.id);
    Apps.toast('消しました');
    return true;
  }
  $('ieDel').onclick = function () { if (ie && deleteItem(ie.item)) { ie = null; location.hash = '#collection'; } };
  // ドライブの写真を消す。つながらない時は覚えておき、次に同期できたときに消す
  function removeImage(imgId) {
    Apps.deleteImage(APP, imgId).catch(function (e) {
      if (e && e.code === 'not_found') return;
      var q = lsGet('imgDel', []); if (q.indexOf(imgId) < 0) q.push(imgId); lsSet('imgDel', q);
    });
  }
  function retryImageDeletes() {
    var q = lsGet('imgDel', []);
    if (!q.length) return;
    lsSet('imgDel', []);
    q.forEach(removeImage);
  }

  // 1件を見る
  var viewId = '';
  function openItemView(id) { viewId = id; closeSheet(); if (location.hash === '#item-view') fillItemView(); else location.hash = '#item-view'; }
  function curItem() { for (var i = 0; i < state.items.length; i++) if (state.items[i].id === viewId) return state.items[i]; return null; }
  function fillItemView() {
    var it = curItem();
    if (!it) { if (state.view === 'item-view') location.hash = '#collection'; return; }
    var t = typeOf(it.type);
    $('ivPh').innerHTML = picOf(it, 1600);
    $('ivName').textContent = it.name || t.name;
    $('ivMeta').innerHTML = sticker(t.color, t.icon) + ' ' + esc(t.name) + '・' + it.date.slice(0, 4) + '年' + jp(it.date);
    $('ivMemo').textContent = it.memo || '（メモなし）';
  }
  $('ivEdit').onclick = function () { var it = curItem(); if (it) openItemEdit(it.date, it); };
  $('ivDel').onclick = function () { if (deleteItem(curItem())) location.hash = '#collection'; };
  $('ivCal').onclick = function () {
    var it = curItem(); if (!it) return;
    var d = parse(it.date);
    state.month = { y: d.getFullYear(), m: d.getMonth() };
    state.sel = it.date;
    state.openAfter = it.date;
    location.hash = '#calendar';
  };
  document.addEventListener('click', function (e) {
    var b = e.target.closest ? e.target.closest('[data-item]') : null;
    if (b) openItemView(b.getAttribute('data-item'));
  });

  // 種類
  var te = { editing: null, icon: 'cup', color: 'rose' };
  function typeRecord(t, patch) {
    var d = { kind: 'ctype', name: t.name, icon: t.icon, color: t.color, order: t.order, archivedOn: t.archivedOn || '' };
    Object.keys(patch || {}).forEach(function (k) { d[k] = patch[k]; });
    t.virtual = false;
    return db.put(d, t.id);
  }
  function renderTypes() {
    var active = state.types;
    var rows = state.allTypes.map(function (t) {
      var n = state.items.filter(function (i) { return i.type === t.id; }).length, ai = active.indexOf(t);
      return '<div class="row">' + sticker(t.color, t.icon) + '<div class="txt"><span>' + esc(t.name) + (t.archivedOn ? '（しまった）' : '') + '</span><small>' + n + '件' + (t.id === FOOD.id ? '・最初からある種類' : '') + '</small></div>' +
        (t.archivedOn ? '' : '<button type="button" class="mini" data-tmv="-1" data-t="' + esc(t.id) + '" aria-label="上へ"' + (ai === 0 ? ' disabled' : '') + '>↑</button>' +
          '<button type="button" class="mini" data-tmv="1" data-t="' + esc(t.id) + '" aria-label="下へ"' + (ai === active.length - 1 ? ' disabled' : '') + '>↓</button>' +
          '<button type="button" class="mini" data-ted="' + esc(t.id) + '" aria-label="' + esc(t.name) + 'の名前・絵・色を変える">✎</button>') +
        '<button type="button" class="ax-btn" data-toff="' + esc(t.id) + '" style="min-height:40px">' + (t.archivedOn ? '戻す' : 'しまう') + '</button></div>';
    });
    $('teList').innerHTML = rows.join('');
    drawTypeForm();
  }
  function drawTypeForm() {
    $('teIcons').innerHTML = ST.TYPE_ICONS.map(function (k) { return '<button type="button" data-ic="' + k + '" aria-pressed="' + (te.icon === k) + '" aria-label="絵 ' + k + '">' + ST.icon(k) + '</button>'; }).join('');
    $('teColors').innerHTML = COLORS.map(function (c) { return '<button type="button" data-tc="' + c.k + '" aria-pressed="' + (te.color === c.k) + '" style="background:var(--' + c.k + ')" aria-label="' + c.label + '"></button>'; }).join('');
  }
  $('teList').addEventListener('click', function (e) {
    var b = e.target.closest ? e.target.closest('button') : null;
    if (!b) return;
    var t = typeOf(b.getAttribute('data-t') || b.getAttribute('data-ted') || b.getAttribute('data-toff'));
    if (b.hasAttribute('data-tmv')) {
      var arr = state.types.slice(), i = arr.indexOf(t), j = i + +b.getAttribute('data-tmv');
      if (i < 0 || j < 0 || j >= arr.length) return;
      var x = arr[i]; arr[i] = arr[j]; arr[j] = x;
      arr.forEach(function (y, k) { var o = (k + 1) * 10; if (y.order !== o || y.virtual) typeRecord(y, { order: o }); });
    } else if (b.hasAttribute('data-ted')) {
      te.editing = t; te.icon = t.icon; te.color = t.color;
      $('teName').value = t.name; $('teTitle').textContent = '変える：' + t.name; $('teSave').textContent = '保存'; $('teCancel').hidden = false;
      drawTypeForm(); $('teName').focus();
    } else if (b.hasAttribute('data-toff')) {
      if (t.archivedOn) { typeRecord(t, { archivedOn: '', order: nextTypeOrder() }); Apps.toast('「' + t.name + '」を戻しました'); }
      else { typeRecord(t, { archivedOn: state.today }); Apps.toast('「' + t.name + '」をしまいました（中の記録は残ります）'); }
    }
  });
  function nextTypeOrder() { return state.allTypes.reduce(function (m, t) { return Math.max(m, t.order); }, 0) + 10; }
  function resetTypeForm() { te.editing = null; $('teName').value = ''; $('teTitle').textContent = '種類を追加'; $('teSave').textContent = '追加'; $('teCancel').hidden = true; drawTypeForm(); }
  $('teIcons').addEventListener('click', function (e) { var b = e.target.closest ? e.target.closest('[data-ic]') : null; if (b) { te.icon = b.getAttribute('data-ic'); drawTypeForm(); } });
  $('teColors').addEventListener('click', function (e) { var b = e.target.closest ? e.target.closest('[data-tc]') : null; if (b) { te.color = b.getAttribute('data-tc'); drawTypeForm(); } });
  $('teCancel').onclick = resetTypeForm;
  $('teForm').addEventListener('submit', function (e) {
    e.preventDefault();
    var n = $('teName').value.trim();
    if (!n) return;
    if (te.editing) { typeRecord(te.editing, { name: n, icon: te.icon, color: te.color }); Apps.toast('保存しました'); resetTypeForm(); return; }
    var id = 'ctype-' + Apps.uuid().replace(/[^a-z0-9]/gi, '').slice(0, 12);
    db.put({ kind: 'ctype', name: n, icon: te.icon, color: te.color, order: nextTypeOrder(), archivedOn: '' }, id);
    col.type = id; lsSet('colType', id);
    resetTypeForm();
    Apps.toast('「' + n + '」を追加しました');
    location.hash = '#collection';
  });

  // 押したときの動き（今日・カレンダー・記録で共通の data-act）
  document.addEventListener('click', function (e) {
    var b = e.target.closest ? e.target.closest('[data-act]') : null;
    if (!b) return;
    var a = b.getAttribute('data-act'), d = b.getAttribute('data-d');
    if (a === 'perStart') perStart(state.today);
    else if (a === 'perEnd') perEndAt(state.today);
    else if (a === 'perStartOn') perStart(d);
    else if (a === 'perEndOn') perEndAt(d);
    else if (a === 'perEditOf') { closeSheet(); openPerEdit(d); }
    else if (a === 'perNew') openPerEdit(null);
    else if (a === 'addOn') openItemEdit(d, null);
    else if (a === 'diaryOn') openDiary(d);
    else if (a === 'diaryWeek') copyWeek(d);
  });
  // ---------- 習慣の編集 ----------
  // 初期の習慣（まだ保存していない表示だけのもの）を、どれか1つを変える前にまとめて保存する
  function materialize() {
    state.allHabits.forEach(function (h) {
      if (!h.virtual) return;
      h.virtual = false;
      DEFAULTS.forEach(function (x) { if (x.id === h.id) db.put(x.data, x.id); });
    });
  }
  function habitRecord(h, patch) {
    materialize();
    var d = { kind: 'habit', name: h.name, time: h.time, color: h.color, order: h.order, since: h.since, archivedOn: h.archivedOn };
    Object.keys(patch || {}).forEach(function (k) { d[k] = patch[k]; });
    return db.put(d, h.id);
  }
  function renderHabits() {
    var list = $('habitList');
    list.innerHTML = '';
    if (!state.habits.length) list.innerHTML = '<div class="row muted">まだありません</div>';
    state.habits.forEach(function (h, i) {
      var row = document.createElement('div');
      row.className = 'row';
      row.innerHTML = '<i class="swatch" style="background:var(--' + h.color + ')"></i>' +
        '<div class="txt"><span>' + esc(h.name) + '</span><small>毎日' + (h.time ? '・目安 ' + esc(h.time) : '') + '</small></div>' +
        '<button type="button" class="mini" aria-label="上へ"' + (i === 0 ? ' disabled' : '') + '>↑</button>' +
        '<button type="button" class="mini" aria-label="下へ"' + (i === state.habits.length - 1 ? ' disabled' : '') + '>↓</button>' +
        '<button type="button" class="mini" aria-label="' + esc(h.name) + 'を編集">✎</button>';
      var b = row.querySelectorAll('button');
      b[0].onclick = function () { move(i, -1); };
      b[1].onclick = function () { move(i, 1); };
      b[2].onclick = function () { openForm(h); };
      list.appendChild(row);
    });
    var arch = state.allHabits.filter(function (h) { return h.archivedOn; });
    $('archivedList').innerHTML = '';
    if (!arch.length) $('archivedList').innerHTML = '<div class="row small muted">ありません</div>';
    arch.forEach(function (h) {
      var row = document.createElement('div');
      row.className = 'row';
      row.innerHTML = '<i class="swatch" style="background:var(--' + h.color + ')"></i><div class="txt"><span>' + esc(h.name) +
        '</span><small>' + esc(h.archivedOn) + ' にやめた</small></div><button type="button" class="ax-btn">再開</button>';
      row.querySelector('button').onclick = function () {
        habitRecord(h, { archivedOn: '', order: nextOrder() });
        Apps.toast('「' + h.name + '」を再開しました');
      };
      $('archivedList').appendChild(row);
    });
    $('connState').textContent = Apps.isConnected(APP) ? 'つながっています（タップで確認・他の端末を追加）' : 'まだつながっていません';
  }
  function nextOrder() { return state.allHabits.reduce(function (m, h) { return Math.max(m, h.order); }, 0) + 10; }
  function move(i, dir) {
    var arr = state.habits.slice();
    var j = i + dir;
    if (j < 0 || j >= arr.length) return;
    var t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    arr.forEach(function (h, k) {
      var o = (k + 1) * 10;
      if (h.order !== o) habitRecord(h, { order: o });
    });
  }
  function renderColors() {
    $('hColors').innerHTML = COLORS.map(function (c) {
      return '<button type="button" style="background:var(--' + c.k + ')" aria-label="' + c.label + '" aria-pressed="' + (state.color === c.k) + '" data-k="' + c.k + '"></button>';
    }).join('');
    Array.prototype.forEach.call($('hColors').querySelectorAll('button'), function (b) {
      b.onclick = function () { state.color = b.getAttribute('data-k'); renderColors(); };
    });
  }
  function openForm(h) {
    state.editing = h || null;
    $('formTitle').textContent = h ? '編集：' + h.name : '習慣を追加';
    $('hName').value = h ? h.name : '';
    $('hTime').value = h ? h.time : '';
    state.color = h ? h.color : COLORS[state.allHabits.length % COLORS.length].k;
    renderColors();
    $('hArchive').hidden = !h;
    $('archiveNote').hidden = !h;
    $('habitForm').hidden = false;
    $('addHabit').hidden = true;
    $('hName').focus();
  }
  function closeForm() { $('habitForm').hidden = true; $('addHabit').hidden = false; state.editing = null; }
  $('addHabit').onclick = function () { openForm(null); };
  $('hCancel').onclick = closeForm;
  $('hArchive').onclick = function () {
    var h = state.editing;
    if (!h) return;
    habitRecord(h, { archivedOn: state.today });
    Apps.toast('「' + h.name + '」をやめました（記録は残ります）');
    closeForm();
  };
  $('habitForm').addEventListener('submit', function (e) {
    e.preventDefault();
    var name = $('hName').value.trim();
    if (!name) return;
    var time = $('hTime').value || '';
    if (state.editing) habitRecord(state.editing, { name: name, time: time, color: state.color });
    else {
      materialize();
      var id = 'h-' + Apps.uuid().replace(/[^a-z0-9]/gi, '').slice(0, 12);
      db.put({ kind: 'habit', name: name, time: time, color: state.color, order: nextOrder(), since: state.today, archivedOn: '' }, id);
    }
    Apps.toast('保存しました');
    closeForm();
  });

  // ---------- 通知の設定 ----------
  $('appUrl').textContent = APP_URL;
  $('copyUrl').onclick = function () {
    var done_ = function () { Apps.toast('コピーしました'); };
    var fallback = function () {
      var r = document.createRange(); r.selectNodeContents($('appUrl'));
      var s = window.getSelection(); s.removeAllRanges(); s.addRange(r);
      Apps.toast('選択しました。長押しでコピーしてください');
    };
    try { navigator.clipboard.writeText(APP_URL).then(done_, fallback); } catch (e) { fallback(); }
  };
  $('connBtn').onclick = function () { Apps.openConnectSheet(APP); };
  Apps.on('connection', function () { renderHabits(); if (state.view === 'calendar') loadEvents(true); });
  function renderSleepSwitch() { $('swSleep').setAttribute('aria-checked', String(sleepOn())); }
  $('swSleep').onclick = function () {
    var on = !sleepOn();
    lsSet('sleepOn', on);
    renderSleepSwitch();
    Apps.toast(on ? '「記録」に睡眠が出ます' : '睡眠を隠しました（データは残ります）');
    renderCalendar();
    renderRecHeads();
  };


  // ---------- 睡眠 ----------
  function sleepRec(ds) { var d = sl.days[ds]; return d && d.value ? d.value : null; }
  function goalOf(ds) { return SL.goalOn(sl.hist, ds); }
  function sleepJudge(ds) { var v = sleepRec(ds); return v ? SL.judge(v, goalOf(ds)) : null; }
  function sleepGood(ds) { var j = sleepJudge(ds); return !!(j && j.all); }
  function md(ds) { var d = parse(ds); return (d.getMonth() + 1) + '/' + d.getDate(); }
  function isHol(ds) { return !!sl.hol[parse(ds).getDay()]; }
  function dayLabel(ds) { return md(ds) + '(' + WD[parse(ds).getDay()] + (isHol(ds) ? '・休' : '') + ')'; }
  function sign(d) { d = Math.round(d); return (d > 0 ? '+' : d < 0 ? '−' : '±') + Math.abs(d); }
  function hhmm(iso) { var d = new Date(iso); return isNaN(d) ? '' : d.getHours() + ':' + pad(d.getMinutes()); }
  // 今朝の分がまだ無ければ昨日から数える（今朝の分があって目標外なら 0）
  function sleepStreak(key) {
    var d = state.today, n = 0;
    if (!sleepRec(d)) d = addDays(d, -1);
    for (var j = sleepJudge(d); j && j[key] && n < 3700; j = sleepJudge(d)) { n++; d = addDays(d, -1); }
    return n;
  }
  function tag(ok, ngText) { return '<span class="tag ' + (ok ? 'ok' : 'ng') + '">' + (ok ? '目標内' : ngText) + '</span>'; }

  function renderSleep() {
    var t = parse(state.today);
    $('slSub').textContent = (t.getMonth() + 1) + '月' + t.getDate() + '日（' + WD[t.getDay()] + (isHol(state.today) ? '・休日' : '') + '）の朝';
    var g = goalOf(state.today), v = sleepRec(state.today), box = $('slToday');
    if (!v) {
      var early = new Date().getHours() < 9;
      box.innerHTML = '<div class="missing" id="slMissing"><p><b>今朝の記録がまだ届いていません</b></p><p class="small">' +
        (early ? '9:00 か、朝いちばんのアプリを開いたときに自動で届きます。' : '9:00 に iPhone がロックされていると、送れないことがあります。') + '</p>' +
        '<div class="btns"><a class="ax-btn ax-btn-primary" id="slRun" href="' + SHORTCUT_URL + '">ショートカットを今すぐ実行</a>' +
        '<button class="ax-btn" type="button" id="slManual">手で入れる</button></div></div>';
      $('slRun').onclick = waitForArrival;
      $('slManual').onclick = function () { openEdit(state.today); };
    } else {
      var j = SL.judge(v, g);
      box.innerHTML = '<div class="card sl-night" id="slCard">' +
        '<div class="cell"><small>昨夜の就寝</small><b id="slBed">' + SL.bedClock(v.bed) + '</b><span class="sl-diff" id="slBedDiff">' + tag(j.okBed, g.band + '分超') + SL.bedClock(g.bed) + ' より' + SL.diffText(j.dBed) + '</span></div>' +
        '<div class="cell"><small>今朝の起床</small><b id="slWake">' + SL.clock(v.wake) + '</b><span class="sl-diff" id="slWakeDiff">' + tag(j.okWake, g.band + '分超') + SL.clock(g.wake) + ' より' + SL.diffText(j.dWake) + '</span></div>' +
        '<div class="sl-len"><div class="top"><small>眠った長さ</small><b class="num" id="slLen">' + SL.lenText(v.len) + '</b></div>' +
        '<span class="sl-diff" id="slLenDiff">' + tag(j.okLen, 'たりない') + '目標 ' + SL.lenText(g.sleepLen) + '以上・' + SL.lenDiffText(j.dLen) + '</span></div>' +
        '<div class="sl-from"><span id="slSrc">' + (v.fixed ? '手で直した値' : 'ヘルスケアから ' + hhmm(v.receivedAt) + ' に届きました') + '</span>' +
        (v.fixed ? '' : '<a href="' + SHORTCUT_FORCE + '" id="slResend">もう一度送る</a>') + '</div></div>';
      if ($('slResend')) $('slResend').onclick = waitForArrival;
    }
    $('stWake').textContent = sleepStreak('okWake');
    $('stBed').textContent = sleepStreak('okBed');
    $('stLen').textContent = sleepStreak('okLen');
    $('lenN').textContent = SL.lenText(g.sleepLen);
    Array.prototype.forEach.call(document.querySelectorAll('.bandN'), function (e) { e.textContent = g.band; });
    renderChart();
    renderRecent();
  }
  // ショートカットから戻ってきたら受け取る
  var waitTimer = null;
  function waitForArrival() {
    Apps.toast('「' + SHORTCUT + '」を開きます。終わったらこのアプリに戻ってください');
    var n = 0;
    clearInterval(waitTimer);
    waitTimer = setInterval(function () {
      if (++n > 24 || sleepRec(state.today)) { clearInterval(waitTimer); return; }
      if (!document.hidden && Apps.isConnected(APP)) db.sync().catch(function () {});
    }, 5000);
  }

  // グラフ（SVG）。縦＝目標との差（上ほどおそい／長い）、点線＝目標、帯＝目標内
  var NS = 'http://www.w3.org/2000/svg';
  function el(tagName, at, txt) { var e = document.createElementNS(NS, tagName); for (var k in at) e.setAttribute(k, at[k]); if (txt != null) e.textContent = txt; return e; }
  function diffOf(ds) { var j = sleepJudge(ds); return j ? (sl.kind === 'wake' ? j.dWake : sl.kind === 'bed' ? j.dBed : j.dLen) : null; }
  function renderChart() {
    var svg = $('chart'); while (svg.firstChild) svg.removeChild(svg.firstChild);
    var n = sl.range === 'w' ? 7 : 30, W = 340, H = 200, L = 40, R = 8, T = 10, B = sl.range === 'w' ? 40 : 28;
    var pw = W - L - R, ph = H - T - B, LIM = sl.kind === 'len' ? 120 : 60;
    var g = goalOf(state.today), goal = sl.kind === 'wake' ? g.wake : sl.kind === 'bed' ? g.bed : g.sleepLen;
    var y = function (d) { return T + ph / 2 - (Math.max(-LIM, Math.min(LIM, d)) / LIM) * (ph / 2); };
    var days = []; for (var i = n - 1; i >= 0; i--) days.push(addDays(state.today, -i));
    var changed = sl.hist.some(function (h) { return h.from > days[0] && h.from <= days[n - 1]; });
    $('cTitle').textContent = (sl.kind === 'wake' ? '起床' : sl.kind === 'bed' ? '就寝' : '眠った長さ') + '　' + md(days[0]) + '〜' + md(days[n - 1]) + '　' +
      (sl.kind === 'len' ? '上ほど長い' : '上ほどおそい') + (changed ? '（途中で目標を変更。各日はその時の目標との差）' : '');
    if (sl.kind === 'len') svg.appendChild(el('rect', { x: L, y: T, width: pw, height: y(0) - T, fill: 'var(--band)' }));
    else svg.appendChild(el('rect', { x: L, y: y(g.band), width: pw, height: y(-g.band) - y(g.band), fill: 'var(--band)' }));
    var ticks = [-LIM, -LIM / 2, LIM / 2, LIM];
    ticks.forEach(function (d) { svg.appendChild(el('line', { x1: L, x2: W - R, y1: y(d), y2: y(d), stroke: 'var(--grid)', 'stroke-width': 1 })); });
    [-LIM, -LIM / 2, 0, LIM / 2, LIM].forEach(function (d) {
      var t = sl.kind === 'len' ? SL.clock(goal + d) : sl.kind === 'bed' ? SL.bedClock(goal + d) : SL.clock(goal + d);
      svg.appendChild(el('text', { x: L - 6, y: y(d) + 4, 'text-anchor': 'end', 'class': d === 0 ? 'tgt' : '' }, t));
    });
    svg.appendChild(el('line', { x1: L, x2: W - R, y1: y(0), y2: y(0), stroke: 'var(--ink)', 'stroke-width': 1.5, 'stroke-dasharray': '4 4' }));
    var cw = pw / n, y0 = y(0);
    days.forEach(function (ds, i) {
      var cx = L + cw * (i + 0.5), hol = isHol(ds), d = diffOf(ds), col = hol ? 'var(--hol)' : 'var(--wk)';
      if (sl.sel === ds) svg.appendChild(el('rect', { x: cx - cw / 2, y: T, width: cw, height: ph, fill: 'var(--ink)', opacity: 0.07, rx: 4 }));
      if (sl.range === 'w') {
        svg.appendChild(el('text', { x: cx, y: H - B + 16, 'text-anchor': 'middle' }, WD[parse(ds).getDay()]));
        svg.appendChild(el('text', { x: cx, y: H - B + 31, 'text-anchor': 'middle', fill: hol ? 'var(--ink)' : 'var(--muted)' }, hol ? md(ds) + '休' : md(ds)));
      } else if ((parse(ds).getDate() % 5 === 0 || parse(ds).getDate() === 1) && i > 1 && i < n - 1) {
        svg.appendChild(el('text', { x: cx, y: H - B + 16, 'text-anchor': 'middle' }, md(ds)));
      }
      if (d != null) {
        var py = y(d), out = Math.abs(d) > LIM, sz = sl.range === 'w' ? 5 : 4;
        svg.appendChild(el('line', { x1: cx, x2: cx, y1: y0, y2: py, stroke: col, 'stroke-width': 2, 'stroke-linecap': 'round' }));
        if (out) {
          var up = d > 0, tip = up ? T + 1 : T + ph - 1, base = up ? tip + 9 : tip - 9;
          svg.appendChild(el('path', { d: 'M' + (cx - 6) + ' ' + base + 'L' + cx + ' ' + tip + 'L' + (cx + 6) + ' ' + base + 'Z', fill: col, stroke: 'var(--card)', 'stroke-width': 2, 'stroke-linejoin': 'round', 'class': 'pt out' }));
        } else if (hol) {
          svg.appendChild(el('rect', { x: cx - sz, y: py - sz, width: sz * 2, height: sz * 2, rx: 2, fill: col, stroke: 'var(--card)', 'stroke-width': 2, 'class': 'pt' }));
        } else {
          svg.appendChild(el('circle', { cx: cx, cy: py, r: sz, fill: col, stroke: 'var(--card)', 'stroke-width': 2, 'class': 'pt' }));
        }
      } else if (sl.range === 'w') {
        svg.appendChild(el('text', { x: cx, y: y0 - 6, 'text-anchor': 'middle' }, '—'));
      }
      var hit = el('rect', { x: cx - cw / 2, y: 0, width: cw, height: H, fill: 'transparent', 'data-d': ds, tabindex: sl.range === 'w' ? 0 : -1, role: 'button', 'aria-label': dayLabel(ds) });
      hit.style.cursor = 'pointer';
      hit.addEventListener('click', function () { sl.sel = ds; renderChart(); });
      hit.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); sl.sel = ds; renderChart(); } });
      svg.appendChild(hit);
    });
    $('cLegend').innerHTML = '<span><i style="background:var(--wk);border-radius:50%"></i>平日</span><span><i style="background:var(--hol);border-radius:2px"></i>休日（' +
      WD.filter(function (w, k) { return sl.hol[k]; }).join('・') + '）</span><span><i style="background:var(--band)"></i>' +
      (sl.kind === 'len' ? '目標以上' : '目標±' + g.band + '分') + '</span><span><i style="height:0;border-top:2px dashed var(--ink);width:14px"></i>目標</span>';
    if (sl.sel) showTip(sl.sel); else $('tip').textContent = '点を押すと、その日の時刻と差が出ます';
  }
  function showTip(ds) {
    var v = sleepRec(ds);
    if (!v) { $('tip').textContent = dayLabel(ds) + '　記録なし'; return; }
    var j = SL.judge(v, goalOf(ds));
    $('tip').textContent = dayLabel(ds) + '　' + (sl.kind === 'wake' ? '起床 ' + SL.clock(v.wake) + '（' + SL.diffText(j.dWake) + '）'
      : sl.kind === 'bed' ? '就寝 ' + SL.bedClock(v.bed) + '（' + SL.diffText(j.dBed) + '）'
      : '長さ ' + SL.lenText(v.len) + '（' + SL.lenDiffText(j.dLen) + '）') + (v.fixed ? '・手で直した値' : '');
  }

  function renderRecent() {
    var html = '';
    for (var i = 0; i < 7; i++) {
      var ds = addDays(state.today, -i), v = sleepRec(ds), hol = isHol(ds), j = v ? SL.judge(v, goalOf(ds)) : null;
      var mark = '<i class="mk" style="background:' + (hol ? 'var(--hol);border-radius:2px' : 'var(--wk);border-radius:50%') + '"></i>';
      html += '<button class="row" type="button" data-ed="' + ds + '">' + mark + '<span class="d">' + md(ds) + '(' + WD[parse(ds).getDay()] + ')<small>' + (hol ? '休日' : '平日') + (v && v.fixed ? '・直した' : '') + '</small></span>' +
        (v ? '<span class="v"><span>就寝 ' + SL.bedClock(v.bed) + '</span><span>起床 ' + SL.clock(v.wake) + '</span><small>' + sign(j.dBed) + '分</small><small>' + sign(j.dWake) + '分</small>' +
          '<small class="l">長さ ' + SL.lenText(v.len) + (j.okLen ? '' : '（' + SL.lenDiffText(j.dLen) + '）') + '</small></span>'
          : '<span class="v"><span class="muted">記録なし</span></span>') + '<span aria-hidden="true" class="muted">›</span></button>';
    }
    $('slRecent').innerHTML = html;
    Array.prototype.forEach.call($('slRecent').querySelectorAll('[data-ed]'), function (b) { b.onclick = function () { openEdit(b.getAttribute('data-ed')); }; });
  }
  Array.prototype.forEach.call(document.querySelectorAll('[data-range]'), function (b) { b.onclick = function () { sl.range = b.getAttribute('data-range'); sl.sel = null; syncSeg(); renderChart(); }; });
  Array.prototype.forEach.call(document.querySelectorAll('[data-kind]'), function (b) { b.onclick = function () { sl.kind = b.getAttribute('data-kind'); syncSeg(); renderChart(); }; });
  function syncSeg() {
    Array.prototype.forEach.call(document.querySelectorAll('[data-range]'), function (b) { b.setAttribute('aria-pressed', b.getAttribute('data-range') === sl.range); });
    Array.prototype.forEach.call(document.querySelectorAll('[data-kind]'), function (b) { b.setAttribute('aria-pressed', b.getAttribute('data-kind') === sl.kind); });
  }

  // 手入力・修正
  function fixId(ds) { return 'sleepfix-' + SL.compact(ds); }
  function openEdit(ds) {
    sl.editDate = ds;
    if (location.hash === '#sleep-edit') fillEdit(); else location.hash = '#sleep-edit';
  }
  function fillEdit() {
    var ds = sl.editDate, day = sl.days[ds], v = sleepRec(ds), g = goalOf(ds);
    var auto = day && day.auto;
    $('eDate').value = ds;
    $('eDate').max = state.today;
    $('eTitle').textContent = v ? '記録を直す' : '記録を入れる';
    $('eFrom').textContent = auto ? 'ヘルスケアから：就寝 ' + SL.bedClock(auto.bed) + '・起床 ' + SL.clock(auto.wake) + '（' + SL.lenText(auto.len) + '）' : 'ヘルスケアからの記録はありません（手入力）';
    $('eBed').value = SL.toInput(v ? v.bed : g.bed);
    $('eWake').value = SL.toInput(v ? v.wake : g.wake);
    $('ePrev').textContent = md(addDays(ds, -1)) + ' の夜に寝て、' + md(ds) + ' の朝に起きた分です。';
    $('eReset').hidden = !(day && day.fix && auto);
    $('eDel').hidden = !v;
  }
  $('slNew').onclick = function () { openEdit(state.today); };
  $('eDate').addEventListener('change', function () { if ($('eDate').value) { sl.editDate = $('eDate').value; fillEdit(); } });
  $('eForm').addEventListener('submit', function (e) {
    e.preventDefault();
    var ds = sl.editDate;
    if (!ds || !$('eBed').value || !$('eWake').value) return;
    db.put({ kind: 'sleepfix', date: ds, bed: SL.bedFromInput($('eBed').value), wake: SL.minOf($('eWake').value), at: new Date().toISOString() }, fixId(ds));
    sl.sel = ds;
    location.hash = '#sleep';
    Apps.toast(md(ds) + ' の記録を保存しました');
  });
  $('eReset').onclick = function () {
    db.remove(fixId(sl.editDate));
    location.hash = '#sleep';
    Apps.toast('ヘルスケアの値に戻しました');
  };
  $('eDel').onclick = function () {
    var ds = sl.editDate, day = sl.days[ds];
    if (!confirm(md(ds) + ' の記録を消しますか？')) return;
    // ヘルスケアの値は残し（あとで届き直しても出ないよう）「消した」印を置く
    if (day && day.auto) db.put({ kind: 'sleepfix', date: ds, removed: true, at: new Date().toISOString() }, fixId(ds));
    else db.remove(fixId(ds));
    location.hash = '#sleep';
    Apps.toast(md(ds) + ' の記録を消しました');
  };

  // 目標
  var BANDS = [10, 15, 20, 30], gBand = 15, gHol = {};
  function fillGoal() {
    var g = goalOf(state.today);
    $('gWake').value = SL.toInput(g.wake);
    $('gBed').value = SL.toInput(g.bed);
    var opts = '';
    for (var m = 300; m <= 600; m += 30) opts += '<option value="' + m + '"' + (m === g.sleepLen ? ' selected' : '') + '>' + SL.lenText(m) + '以上</option>';
    if ((g.sleepLen - 300) % 30 || g.sleepLen < 300 || g.sleepLen > 600) opts += '<option value="' + g.sleepLen + '" selected>' + SL.lenText(g.sleepLen) + '以上</option>';
    $('gLen').innerHTML = opts;
    gBand = g.band; gHol = {}; for (var k in sl.hol) gHol[k] = 1;
    drawGoalCtl();
    $('gHist').innerHTML = sl.hist.slice().reverse().map(function (h) {
      return '<div class="row"><div class="txt"><span>' + (h.from <= '2000-01-01' ? 'はじめ' : h.from.slice(0, 4) + '/' + md(h.from) + ' から') +
        '</span><small>起床 ' + SL.clock(h.wake) + '・就寝 ' + SL.bedClock(h.bed) + '・' + SL.lenText(h.sleepLen) + '以上・±' + h.band + '分</small></div></div>';
    }).join('');
  }
  function drawGoalCtl() {
    $('gBand').innerHTML = BANDS.map(function (b) { return '<button type="button" data-b="' + b + '" aria-pressed="' + (b === gBand) + '">±' + b + '分</button>'; }).join('');
    $('gHol').innerHTML = WD.map(function (w, i) { return '<button type="button" data-w="' + i + '" aria-pressed="' + !!gHol[i] + '" aria-label="' + w + '曜日">' + w + '</button>'; }).join('');
    Array.prototype.forEach.call($('gBand').querySelectorAll('button'), function (b) { b.onclick = function () { gBand = +b.getAttribute('data-b'); drawGoalCtl(); }; });
    Array.prototype.forEach.call($('gHol').querySelectorAll('button'), function (b) { b.onclick = function () { var i = b.getAttribute('data-w'); if (gHol[i]) delete gHol[i]; else gHol[i] = 1; drawGoalCtl(); }; });
  }
  $('gForm').addEventListener('submit', function (e) {
    e.preventDefault();
    var hol = Object.keys(gHol).map(Number).sort();
    var data = SL.setGoal(sl.goalData, state.today, { wake: SL.minOf($('gWake').value), bed: SL.bedFromInput($('gBed').value), sleepLen: +$('gLen').value, band: gBand, hol: hol });
    db.put(data, 'sleep-goal');
    location.hash = '#sleep';
    Apps.toast('目標を保存しました（今日から。前の日はその時の目標のまま）');
  });

  // 自動で送る設定
  function fillSetup() {
    var c = Apps.getConnection(APP);
    $('skUrl').textContent = c && c.url ? c.url : 'まだスプシとつながっていません（習慣 → スプレッドシートとの接続）';
    $('sk').textContent = sl.keyShown && sl.key ? sl.key : '••••••••••••••••';
    $('skShow').textContent = sl.keyShown ? '隠す' : '表示';
  }
  function keyError(e) {
    if (e && (e.code === 'bad_action')) return 'スプシのプログラムが古いようです。Code.gs を貼り替えて［デプロイを管理］→ 新バージョンにしてください';
    return Apps.errorText(e);
  }
  function getKey(renew) {
    if (sl.key && !renew) return Promise.resolve(sl.key);
    return Apps.call(APP, 'sleepKey', renew ? { renew: true } : {}).then(function (r) { sl.key = r.sleepKey; return sl.key; });
  }
  function copyText(text, label) {
    var ok = function () { Apps.toast(label + 'をコピーしました'); };
    try { navigator.clipboard.writeText(text).then(ok, function () { Apps.toast('コピーできませんでした。表示して長押しでコピーしてください', true); }); }
    catch (e) { Apps.toast('コピーできませんでした。表示して長押しでコピーしてください', true); }
  }
  $('skShow').onclick = function () {
    if (sl.keyShown) { sl.keyShown = false; fillSetup(); return; }
    getKey(false).then(function () { sl.keyShown = true; fillSetup(); }, function (e) { Apps.toast(keyError(e), true); });
  };
  $('skCopy').onclick = function () {
    getKey(false).then(function (k) { copyText(k, '睡眠用の合言葉'); }, function (e) { Apps.toast(keyError(e), true); });
  };
  $('skUrlCopy').onclick = function () {
    var c = Apps.getConnection(APP);
    if (!c) { Apps.toast('まだスプシとつながっていません', true); return; }
    copyText(c.url, '送り先URL');
  };
  $('skNew').onclick = function () {
    if (!confirm('睡眠用の合言葉を作り直しますか？\n今のショートカットは送れなくなるので、新しい合言葉に貼り替えてください。')) return;
    getKey(true).then(function () { sl.keyShown = true; fillSetup(); Apps.toast('作り直しました。ショートカットの合言葉も貼り替えてください'); }, function (e) { Apps.toast(keyError(e), true); });
  };

  // ホーム画面のウィジェット（見るだけ用の合言葉。GAS の viewKey）
  var wv = { key: '', shown: false };
  function fillWidget() {
    var c = Apps.getConnection(APP);
    $('wvUrl').textContent = c && c.url ? c.url : 'まだスプシとつながっていません（習慣 → スプレッドシートとの接続）';
    $('wv').textContent = wv.shown && wv.key ? wv.key : '••••••••••••••••';
    $('wvShow').textContent = wv.shown ? '隠す' : '表示';
  }
  function getViewKey(renew) {
    if (wv.key && !renew) return Promise.resolve(wv.key);
    return Apps.call(APP, 'viewKey', renew ? { renew: true } : {}).then(function (r) { wv.key = r.viewKey; return wv.key; });
  }
  $('wvShow').onclick = function () {
    if (wv.shown) { wv.shown = false; fillWidget(); return; }
    getViewKey(false).then(function () { wv.shown = true; fillWidget(); }, function (e) { Apps.toast(keyError(e), true); });
  };
  $('wvCopy').onclick = function () {
    getViewKey(false).then(function (k) { copyText(k, '見るだけ用の合言葉'); }, function (e) { Apps.toast(keyError(e), true); });
  };
  $('wvUrlCopy').onclick = function () {
    var c = Apps.getConnection(APP);
    if (!c) { Apps.toast('まだスプシとつながっていません', true); return; }
    copyText(c.url, '送り先URL');
  };
  $('wvNew').onclick = function () {
    if (!confirm('見るだけ用の合言葉を作り直しますか？\n今のウィジェットは読めなくなるので、新しい合言葉に貼り替えてください。')) return;
    getViewKey(true).then(function () { wv.shown = true; fillWidget(); Apps.toast('作り直しました。ウィジェットの合言葉も貼り替えてください'); }, function (e) { Apps.toast(keyError(e), true); });
  };

  // ---------- 日記（1日1件：id = diary-YYYYMMDD） ----------
  // data = { kind:'diary', date, event, thanks, maxim, free, image:{ id, thumb }|null, at }
  // 夜（18時〜朝5時）は日記の画面を暗くする（「明るくする」で切り替え、端末ごとに覚える）
  var NOTE_URL = 'https://claude.ai/artifact/99p3EizFftnBMoFMRDH5Uj';
  var DF = [['event', 'dEvent'], ['thanks', 'dThanks'], ['maxim', 'dMaxim'], ['free', 'dFree']];
  var dy = { date: '', file: null, preview: null, removePhoto: false, dirty: false, saving: false, imp: null };
  function diaryId(ds) { return 'diary-' + ds.replace(/-/g, ''); }
  function diaryOf(ds) { return state.diary[ds] || null; }
  function diaryText(e) { return e ? [e.event, e.thanks, e.maxim, e.free].filter(Boolean).join(' / ') : ''; }
  function isNight() { var h = new Date().getHours(); return h >= 18 || h < 5; }
  function diaryDark() { return isNight() && lsGet('diaryLight', false) !== true; }
  function applyDiaryTheme() {
    if (state.view === 'diary' && diaryDark()) document.documentElement.setAttribute('data-theme', 'dark');
    else document.documentElement.removeAttribute('data-theme');
    $('dTheme').hidden = !isNight();
    $('dTheme').textContent = diaryDark() ? '☀ 明るくする' : '🌙 暗くする';
  }
  $('dTheme').onclick = function () { lsSet('diaryLight', diaryDark()); applyDiaryTheme(); };
  function renderDiaryCard() {
    var e = diaryOf(state.today);
    $('tDiary').innerHTML = '<span class="top"><b>今日の日記</b><span class="pill' + (e ? ' ok' : '') + '">' + (e ? '書いた' : 'まだ') + '</span></span>' +
      '<span class="small muted dline">' + (e ? esc(diaryText(e)) : '出来事・感謝・格言。夜に1分で。') + '</span>';
  }
  $('tDiary').onclick = function () { openDiary(state.today); };
  function openDiary(ds) {
    closeSheet();
    dy.date = ds || state.today;
    if (location.hash === '#diary') fillDiary(); else location.hash = '#diary';
  }
  function dReset() {
    if (dy.preview) try { URL.revokeObjectURL(dy.preview); } catch (x) { /* 無視 */ }
    dy.file = null; dy.preview = null; dy.removePhoto = false; dy.dirty = false;
  }
  function fillDiary(keepStatus) {
    if (!dy.date) dy.date = state.today;
    var st = $('dState').textContent;
    dReset();
    var e = diaryOf(dy.date) || {};
    $('dTitle').textContent = jp(dy.date) + (dy.date === state.today ? '・今日' : '');
    $('dNext').disabled = dy.date >= state.today;
    DF.forEach(function (f) { $(f[1]).value = e[f[0]] || ''; });
    $('dSave').disabled = false; $('dSave').textContent = '保存';
    dStatus(keepStatus && /^保存しました|^空にした/.test(st) ? st : e.date ? '保存済み' : 'まだ書いていません');
    dPick();
    applyDiaryTheme();
  }
  function dStatus(t) { $('dState').textContent = t; }
  function dPick() {
    var e = diaryOf(dy.date), has = !!(dy.preview || (e && e.image && !dy.removePhoto));
    $('dPick').innerHTML = dy.preview ? '<img alt="選んだ写真" src="' + esc(dy.preview) + '">' : has ? '<img alt="今の写真" src="' + esc(Apps.imageUrl(e.image.id, 900)) + '">' : '写真を選ぶ・撮る（1枚）';
    $('dNoPh').hidden = !has;
  }
  DF.forEach(function (f) { $(f[1]).addEventListener('input', function () { dy.dirty = true; dStatus('まだ保存していません'); }); });
  $('dPick').onclick = function () { $('dFile').click(); };
  $('dFile').onchange = function () {
    var f = this.files && this.files[0];
    if (!f) return;
    if (dy.preview) try { URL.revokeObjectURL(dy.preview); } catch (x) { /* 無視 */ }
    dy.file = f; dy.preview = URL.createObjectURL(f); dy.removePhoto = false; dy.dirty = true;
    this.value = ''; dPick(); dStatus('まだ保存していません');
  };
  $('dNoPh').onclick = function () { dy.file = null; if (dy.preview) try { URL.revokeObjectURL(dy.preview); } catch (x) { /* 無視 */ } dy.preview = null; dy.removePhoto = true; dy.dirty = true; dPick(); dStatus('まだ保存していません'); };
  // 保存（全部空で写真もなければ、その日の日記を消す）。戻り値は Promise
  function saveDiary() {
    if (dy.saving) return Promise.resolve();
    var date = dy.date, old = diaryOf(date), oldImg = old && old.image ? old.image : null, cur = { file: dy.file, removePhoto: dy.removePhoto, preview: dy.preview };
    var v = {}; DF.forEach(function (f) { v[f[0]] = $(f[1]).value.replace(/\s+$/, ''); });
    var up = cur.file ? Apps.uploadImage(APP, cur.file, { maxSide: 1600, name: 'diary-' + date.replace(/-/g, '') + '.jpg' }).then(function (img) { return { id: img.id, thumb: img.thumb || Apps.imageUrl(img.id, 400) }; })
      : Promise.resolve(cur.removePhoto ? null : oldImg);
    dy.saving = true; $('dSave').disabled = true; $('dSave').textContent = cur.file ? '写真を保存中…' : '保存中…';
    return up.then(function (image) {
      var empty = !v.event && !v.thanks && !v.maxim && !v.free && !image;
      if (empty) { if (old) db.remove(diaryId(date)); }
      else db.put({ kind: 'diary', date: date, event: v.event, thanks: v.thanks, maxim: v.maxim, free: v.free, image: image, at: new Date().toISOString() }, diaryId(date));
      if (oldImg && (!image || image.id !== oldImg.id)) removeImage(oldImg.id);
      if (cur.preview) try { URL.revokeObjectURL(cur.preview); } catch (x) { /* 無視 */ }
      if (dy.date === date) { dy.file = null; dy.preview = null; dy.removePhoto = false; dy.dirty = false; dStatus(empty ? (old ? '空にしたので消しました' : 'まだ書いていません') : '保存しました' + (navigator.onLine === false ? '（つながったら送ります）' : '')); }
    }, function (err) {
      Apps.toast('写真を保存できませんでした：' + Apps.errorText(err), true);
      dStatus('保存できませんでした');
    }).then(function () { dy.saving = false; $('dSave').disabled = false; $('dSave').textContent = '保存'; });
  }
  $('dForm').addEventListener('submit', function (e) { e.preventDefault(); saveDiary(); });
  function goDay(n) {
    var to = addDays(dy.date, n);
    if (to > state.today) return;
    (dy.dirty ? saveDiary() : Promise.resolve()).then(function () { dy.date = to; fillDiary(); });
  }
  $('dPrev').onclick = function () { goDay(-1); };
  $('dNext').onclick = function () { goDay(1); };
  // 格言 → 脳みそ（脳みそのカードを直接作る。番号は脳みそを開いたときに付く）
  $('dBrain').onclick = function () {
    var m = $('dMaxim').value.trim();
    if (!m) { Apps.toast('先に今日の格言を書いてください', true); $('dMaxim').focus(); return; }
    BrainNote.write({ from: 'diary', kind: 'H', title: m, source: { title: '日記 ' + dy.date, importId: 'diary:' + dy.date } });
  };
  // 格言・出来事 → noteネタ（文をコピーして、noteネタのページを開く）
  $('dNeta').onclick = function () {
    var t = $('dMaxim').value.trim() || $('dEvent').value.trim();
    if (!t) { Apps.toast('格言か出来事を書いてからにしてください', true); return; }
    copyText(t + '（' + md(dy.date) + 'の日記から）', 'ネタの文');
    window.open(NOTE_URL, '_blank', 'noopener');
  };
  // この1週間（表示中の日まで7日分）をコピー → noteネタのページの「週の振り返り」に貼る
  function weekText(end) {
    var list = [];
    for (var i = 6; i >= 0; i--) {
      var ds = addDays(end, -i), e = diaryOf(ds);
      if (e) list.push({ date: ds, event: e.event || '', thanks: e.thanks || '', maxim: e.maxim || '', free: e.free || '' });
    }
    return list.length ? '#ROUTINE-DIARY-WEEK v1\n' + JSON.stringify(list) : '';
  }
  function copyWeek(end) {
    var t = weekText(end || state.today);
    if (!t) { Apps.toast('この1週間の日記がまだありません', true); return; }
    copyText(t, 'この1週間の日記');
  }
  $('dWeek').onclick = function () { copyWeek(dy.date); };
  // 貼って取り込む（noteネタのページの「日記を全部コピー」から。1回だけの引っ越し用）
  function parseImport(text) {
    text = String(text || '').trim();
    var m = /^#NOTE-DIARY-EXPORT v1\s*\n([\s\S]*)$/.exec(text);
    if (!m) return null;
    try { var a = JSON.parse(m[1]); return Array.isArray(a) ? a : null; } catch (e) { return null; }
  }
  $('dImpCheck').onclick = function () {
    var a = parseImport($('dImp').value);
    if (!a) { $('dImpMsg').textContent = '読めませんでした。noteネタのページの「日記を全部コピー」で出た文を、そのまま全部貼ってください。'; dy.imp = null; $('dImpGo').hidden = true; return; }
    var add = [], skip = [], photo = 0;
    a.forEach(function (x) {
      if (!x || !/^\d{4}-\d{2}-\d{2}$/.test(String(x.date || ''))) return;
      if (diaryOf(x.date)) skip.push(x.date); else { add.push(x); if (x.hasPhoto) photo++; }
    });
    dy.imp = add;
    $('dImpMsg').textContent = add.length + '日分を取り込みます' + (skip.length ? '（すでに書いてある ' + skip.length + '日分は上書きせず飛ばします）' : '') +
      (photo ? '。写真 ' + photo + '枚は移せないので、その日を開いて付け直してください' : '') + '。';
    $('dImpGo').hidden = !add.length;
  };
  $('dImpGo').onclick = function () {
    var a = dy.imp || [], at = new Date().toISOString();
    a.forEach(function (x) {
      db.put({ kind: 'diary', date: x.date, event: String(x.event || ''), thanks: String(x.thanks || ''), maxim: String(x.maxim || ''), free: String(x.free || ''), image: null, at: at }, diaryId(x.date));
    });
    dy.imp = null; $('dImpGo').hidden = true; $('dImp').value = '';
    $('dImpMsg').textContent = a.length + '日分を取り込みました。カレンダーで緑の点を確かめてください。';
  };

  // ---------- 画面の切り替え ----------
  var VIEWS = ['today', 'calendar', 'rec', 'collection', 'sleep', 'habits', 'notify', 'widget', 'sleep-edit', 'sleep-goal', 'sleep-setup', 'per-edit', 'item-edit', 'item-view', 'types', 'diary'];
  var TAB_OF = { notify: 'habits', widget: 'habits', rec: 'rec', collection: 'rec', sleep: 'rec', 'sleep-edit': 'rec', 'sleep-goal': 'rec', 'sleep-setup': 'rec',
    'per-edit': 'rec', 'item-edit': 'rec', 'item-view': 'rec', types: 'rec', diary: 'today' };
  var REC = [{ v: 'rec', label: '生理' }, { v: 'collection', label: 'コレクション' }, { v: 'sleep', label: '睡眠' }];
  function renderRecHeads() {
    var cur = state.view;
    var html = '<div class="head"><h1>記録</h1></div><nav class="seg" aria-label="記録の種類">' + REC.filter(function (r) {
      return r.v !== 'sleep' || sleepOn() || cur === 'sleep';
    }).map(function (r) {
      return '<a href="#' + r.v + '" data-rv="' + r.v + '"' + (r.v === cur ? ' aria-current="page"' : '') + '>' + r.label + '</a>';
    }).join('') + '</nav>';
    Array.prototype.forEach.call(document.querySelectorAll('[data-rechead]'), function (el) { el.innerHTML = html; });
  }
  function route() {
    var v = (location.hash || '').slice(1);
    if (VIEWS.indexOf(v) < 0) v = 'today';
    var prev = state.view;
    if (prev === 'diary' && v !== 'diary' && dy.dirty) saveDiary();   // 書きかけは離れるときに保存する
    state.view = v;
    closeSheet();
    applyDiaryTheme();
    VIEWS.forEach(function (k) { $('v-' + k).hidden = k !== v; });
    document.querySelector('main').classList.toggle('wide', v === 'calendar' || v === 'collection');
    if (v === 'rec' || v === 'collection' || v === 'sleep') lsSet('rec', v);
    var recTab = document.querySelector('.tabbar a[data-v="rec"]');
    var last = lsGet('rec', 'rec');
    recTab.setAttribute('href', '#' + (last === 'collection' || (last === 'sleep' && sleepOn()) ? last : 'rec'));
    Array.prototype.forEach.call(document.querySelectorAll('.tabbar a'), function (a) {
      var cur = a.getAttribute('data-v') === (TAB_OF[v] || v);
      if (cur) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    });
    renderRecHeads();
    if (v === 'calendar') {
      if (!state.sel) state.sel = state.today;
      renderCalendar();
      loadEvents(true);
      if (state.openAfter) { var oa = state.openAfter; state.openAfter = ''; if (!isWide()) openDay(oa); }
    }
    if (v === 'sleep-goal') fillGoal();
    if (v === 'sleep-edit') { if (!sl.editDate) sl.editDate = state.today; fillEdit(); }
    if (v === 'sleep-setup') fillSetup();
    if (v === 'widget') fillWidget();
    if (v === 'per-edit') fillPerEdit();
    if (v === 'item-edit') fillItemEdit();
    if (v === 'item-view') fillItemView();
    if (v === 'diary' && prev !== 'diary') fillDiary();
    if (v === 'types' && prev !== 'types') resetTypeForm();
    window.scrollTo(0, 0);
  }
  window.addEventListener('hashchange', route);

  // ---------- 全体 ----------
  var last = [];
  function renderAll() {
    load(last);
    renderToday();
    renderCalendar();
    renderHabits();
    renderSleep();
    renderSleepSwitch();
    renderRec();
    renderCollection();
    renderTypes();
    refreshOpen();
    db.pendingCount().then(function (n) { $('syncState').textContent = n ? '送信待ち ' + n + '件' : ''; }, function () {});
  }
  function refreshDay() {
    var t = logicalToday();
    if (t !== state.today) {
      state.today = t;
      var d = parse(t);
      state.month = { y: d.getFullYear(), m: d.getMonth() };
      renderAll();
    }
  }
  state.today = logicalToday();
  (function () { var d = parse(state.today); state.month = { y: d.getFullYear(), m: d.getMonth() }; })();
  db.onChange(function (list) { last = list; renderAll(); });
  route();
  renderAll();
  setInterval(refreshDay, 60 * 1000);
  document.addEventListener('visibilitychange', function () { if (!document.hidden) refreshDay(); });

  // 同期のあと、初期の習慣がスプシに無ければ保存する（固定の id なので2台で同時に作っても重複しない）
  function seed() {
    if (!db.get(FOOD.id)) db.put(FOOD.data, FOOD.id);   // 最初の種類「料理」（固定の id）
    var hasHabit = db.all().some(function (r) { return r.data && r.data.kind === 'habit'; });
    if (hasHabit) return;
    DEFAULTS.forEach(function (x) { db.put(x.data, x.id); });
  }
  Apps.on('error', function (d) { if (d.app === APP || !d.app) $('syncState').textContent = Apps.errorText(d.error); });
  Apps.ensureConnected(APP).then(function () { return db.sync(); }).then(function () {
    seed();
    renderAll();
    retryImageDeletes();
  }).catch(function () { /* 'error' で表示済み・未接続のまま使える */ });

  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(function () {});
})();
