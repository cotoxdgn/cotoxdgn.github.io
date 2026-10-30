/* ルーティン：習慣の達成記録（1版目）
 * レコードは2種類（同じシート app=routine）
 *   習慣：id = h-xxxx            data = { kind:'habit', name, time, color, order, since, archivedOn }
 *   記録：id = log-YYYYMMDD-<習慣id> data = { kind:'log', date:'YYYY-MM-DD', habit, at }
 *   記録は「日付＋習慣」で id が決まるので、同じ日に二重にはならない。取り消しは削除。
 * 1日の区切りは深夜3時（3時までは前の日として扱う）。
 */
(function () {
  'use strict';
  var APP = 'routine';
  var DAY_START_HOUR = 3;
  var APP_URL = 'https://cotoxdgn.github.io/routine/';

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
  var FLOWER = '<svg class="flower" viewBox="0 0 20 20" aria-hidden="true"><g fill="var(--rose)"><circle cx="10" cy="5" r="4"/><circle cx="15" cy="10" r="4"/><circle cx="10" cy="15" r="4"/><circle cx="5" cy="10" r="4"/></g><circle cx="10" cy="10" r="3" fill="var(--mustard)"/></svg>';

  var db = Apps.collection(APP);
  var $ = function (id) { return document.getElementById(id); };
  var state = { habits: [], allHabits: [], logs: {}, today: '', month: null, editing: null, color: 'sage' };

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
  }
  function toggle(hid) {
    var date = state.today, id = logId(date, hid);
    state.pop = hid;
    if (done(date, hid)) db.remove(id);
    else db.put({ kind: 'log', date: date, habit: hid, at: new Date().toISOString() }, id);
  }

  // ---------- カレンダー ----------
  function renderCalendar() {
    var y = state.month.y, mo = state.month.m;
    $('monthTitle').textContent = y + '年' + (mo + 1) + '月';
    var cal = $('cal');
    var html = WD.map(function (w, i) { return '<div class="wd' + (i === 0 ? ' sun' : i === 6 ? ' sat' : '') + '">' + w + '</div>'; }).join('');
    var first = new Date(y, mo, 1), days = new Date(y, mo + 1, 0).getDate();
    for (var i = 0; i < first.getDay(); i++) html += '<div></div>';
    var fullN = 0, best = 0, run = 0, per = {}, elapsed = 0;
    for (var d = 1; d <= days; d++) {
      var ds = ymd(new Date(y, mo, d));
      var cls = 'day', inner = '<span>' + d + '</span>';
      if (ds > state.today) { cls += ' future'; run = 0; }
      else {
        elapsed++;
        if (ds === state.today) cls += ' today';
        state.allHabits.forEach(function (h) { if (done(ds, h.id)) per[h.id] = (per[h.id] || 0) + 1; });
        if (fullDay(ds)) {
          cls += ' full'; fullN++; run++; best = Math.max(best, run);
          inner += '<span class="dots" aria-label="全部できた">' + FLOWER + '</span>';
        } else {
          if (ds !== state.today) run = 0;
          inner += '<span class="dots">' + state.allHabits.filter(function (h) { return done(ds, h.id); })
            .map(function (h) { return '<i class="dot" style="background:var(--' + h.color + ')" title="' + esc(h.name) + '"></i>'; }).join('') + '</span>';
        }
      }
      html += '<div class="' + cls + '">' + inner + '</div>';
    }
    cal.innerHTML = html;
    $('legend').innerHTML = state.habits.map(function (h) {
      return '<span><i class="dot" style="background:var(--' + h.color + ')"></i>' + esc(h.name) + '</span>';
    }).join('') + '<span>' + FLOWER + '全部できた日</span>';
    var sum = '<div><b class="num">' + fullN + '日</b><small>全部できた日</small></div>' +
      '<div><b class="num">' + best + '日</b><small>この月の最長連続</small></div>';
    state.allHabits.forEach(function (h) {
      if (h.archivedOn && !per[h.id]) return;
      sum += '<div><b class="num">' + (per[h.id] || 0) + '／' + elapsed + '</b><small>' + esc(h.name) + '</small></div>';
    });
    $('summary').innerHTML = sum;
  }

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
  Apps.on('connection', function () { renderHabits(); });

  // ---------- 画面の切り替え ----------
  var VIEWS = ['today', 'calendar', 'habits', 'notify'];
  function route() {
    var v = (location.hash || '').slice(1);
    if (VIEWS.indexOf(v) < 0) v = 'today';
    VIEWS.forEach(function (k) { $('v-' + k).hidden = k !== v; });
    Array.prototype.forEach.call(document.querySelectorAll('.tabbar a'), function (a) {
      var cur = a.getAttribute('data-v') === v || (v === 'notify' && a.getAttribute('data-v') === 'habits');
      if (cur) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    });
    window.scrollTo(0, 0);
  }
  window.addEventListener('hashchange', route);
  $('prevM').onclick = function () { var m = state.month; state.month = m.m === 0 ? { y: m.y - 1, m: 11 } : { y: m.y, m: m.m - 1 }; renderCalendar(); };
  $('nextM').onclick = function () { var m = state.month; state.month = m.m === 11 ? { y: m.y + 1, m: 0 } : { y: m.y, m: m.m + 1 }; renderCalendar(); };

  // ---------- 全体 ----------
  var last = [];
  function renderAll() {
    load(last);
    renderToday();
    renderCalendar();
    renderHabits();
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
    var hasHabit = db.all().some(function (r) { return r.data && r.data.kind === 'habit'; });
    if (hasHabit) return;
    DEFAULTS.forEach(function (x) { db.put(x.data, x.id); });
  }
  Apps.on('error', function (d) { if (d.app === APP || !d.app) $('syncState').textContent = Apps.errorText(d.error); });
  Apps.ensureConnected(APP).then(function () { return db.sync(); }).then(function () {
    seed();
    renderAll();
  }).catch(function () { /* 'error' で表示済み・未接続のまま使える */ });

  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(function () {});
})();
