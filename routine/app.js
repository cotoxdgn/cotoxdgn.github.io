/* ルーティン：習慣の達成記録＋起床・就寝記録
 * レコード（同じシート app=routine）。睡眠のレコードは sleep.js の先頭を参照
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

  var MOON = '<svg class="moon" viewBox="0 0 12 12" aria-hidden="true"><path d="M10.2 7.6A4.6 4.6 0 0 1 4.4 1.8a4.6 4.6 0 1 0 5.8 5.8z" fill="var(--blue)"/></svg>';
  var SL = window.RoutineSleep;
  var SHORTCUT = '睡眠を送る';
  var SHORTCUT_URL = 'shortcuts://run-shortcut?name=' + encodeURIComponent(SHORTCUT);
  var SHORTCUT_FORCE = SHORTCUT_URL + '&input=text&text=' + encodeURIComponent('いま');

  var db = Apps.collection(APP);
  var $ = function (id) { return document.getElementById(id); };
  var state = { habits: [], allHabits: [], logs: {}, today: '', month: null, editing: null, color: 'sage' };
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
    var fullN = 0, best = 0, run = 0, per = {}, elapsed = 0, sleepN = 0;
    for (var d = 1; d <= days; d++) {
      var ds = ymd(new Date(y, mo, d));
      var cls = 'day', inner = '<span>' + d + '</span>';
      if (ds > state.today) { cls += ' future'; run = 0; }
      else {
        elapsed++;
        if (ds === state.today) cls += ' today';
        if (sleepGood(ds)) { sleepN++; inner += MOON; }
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
    }).join('') + '<span>' + FLOWER + '全部できた日</span><span>' + MOON + '睡眠が目標内（起床・就寝・長さ）</span>';
    var sum = '<div><b class="num">' + fullN + '日</b><small>全部できた日</small></div>' +
      '<div><b class="num">' + best + '日</b><small>この月の最長連続</small></div>' +
      '<div><b class="num">' + sleepN + '／' + elapsed + '</b><small>睡眠が目標内の日</small></div>';
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

  // ---------- 画面の切り替え ----------
  var VIEWS = ['today', 'calendar', 'sleep', 'habits', 'notify', 'sleep-edit', 'sleep-goal', 'sleep-setup'];
  var TAB_OF = { notify: 'habits', 'sleep-edit': 'sleep', 'sleep-goal': 'sleep', 'sleep-setup': 'sleep' };
  function route() {
    var v = (location.hash || '').slice(1);
    if (VIEWS.indexOf(v) < 0) v = 'today';
    VIEWS.forEach(function (k) { $('v-' + k).hidden = k !== v; });
    Array.prototype.forEach.call(document.querySelectorAll('.tabbar a'), function (a) {
      var cur = a.getAttribute('data-v') === (TAB_OF[v] || v);
      if (cur) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    });
    if (v === 'sleep-goal') fillGoal();
    if (v === 'sleep-edit') { if (!sl.editDate) sl.editDate = state.today; fillEdit(); }
    if (v === 'sleep-setup') fillSetup();
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
    renderSleep();
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
