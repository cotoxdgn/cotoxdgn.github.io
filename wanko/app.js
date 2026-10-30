/* ワンコの歯磨きしたかな — 家族4人で、わんこ2頭の歯磨きを1日1回ずつ記録する */
(function () {
  'use strict';
  var APP = 'wanko';
  var SETTINGS_ID = 'settings';
  var ME_KEY = 'wanko.me.v1';               // この端末で使う人（家族のID）
  var DOGS = ['a', 'b'];
  var DEFAULTS = {
    dogs: { a: 'わんこA', b: 'わんこB' },
    members: [{ id: 'm1', name: '家族A' }, { id: 'm2', name: '家族B' }, { id: 'm3', name: '家族C' }, { id: 'm4', name: '家族D' }]
  };
  var WD = ['日', '月', '火', '水', '木', '金', '土'];

  var db = Apps.collection(APP);
  var $ = function (id) { return document.getElementById(id); };
  var list = [];
  var view = 'today';
  var undoTimer = 0;

  // ---------- 日付 ----------
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function dayKey(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function addDays(d, n) { var x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); x.setDate(x.getDate() + n); return x; }
  function parseKey(k) { var p = k.split('-'); return new Date(+p[0], +p[1] - 1, +p[2]); }
  function hm(iso) { var d = new Date(iso); return isNaN(d) ? '' : pad(d.getHours()) + ':' + pad(d.getMinutes()); }
  function md(k) { var d = parseKey(k); return (d.getMonth() + 1) + '/' + d.getDate() + '（' + WD[d.getDay()] + '）'; }
  function longDate(k) { var d = parseKey(k); return (d.getMonth() + 1) + '月' + d.getDate() + '日（' + WD[d.getDay()] + '）'; }
  function recId(k, dog) { return k + '_' + dog; }     // 1頭につき1日1件（同じ id は上書き）

  // ---------- 設定（家族共通：レコード id=settings） ----------
  function settings() {
    var r = db.get(SETTINGS_ID);
    var s = r && r.data ? r.data : {};
    var dogs = { a: (s.dogs && s.dogs.a) || DEFAULTS.dogs.a, b: (s.dogs && s.dogs.b) || DEFAULTS.dogs.b };
    var members = DEFAULTS.members.map(function (m, i) {
      var got = s.members && s.members[i];
      return { id: m.id, name: (got && got.name) || m.name };
    });
    return { dogs: dogs, members: members };
  }
  function memberName(id, fallback) {
    var m = settings().members.filter(function (x) { return x.id === id; })[0];
    return m ? m.name : (fallback || '？');
  }
  function getMe() { try { return localStorage.getItem(ME_KEY) || ''; } catch (e) { return ''; } }
  function setMe(id) { try { localStorage.setItem(ME_KEY, id); } catch (e) { /* 保存できない端末でも今回は使える */ } meMem = id; }
  var meMem = getMe();
  function me() { return meMem; }

  // ---------- 記録 ----------
  function brushRecords() {
    return list.filter(function (r) { return r.id !== SETTINGS_ID && r.data && r.data.date && r.data.dog; });
  }
  function recordFor(k, dog) { var r = db.get(recId(k, dog)); return r && r.data ? r : null; }

  function markDone(dog) {
    var k = dayKey(new Date());
    if (recordFor(k, dog)) return;         // 今日はもう記録済み（1日1回）
    var who = me();
    db.put({ date: k, dog: dog, by: who, byName: memberName(who), at: new Date().toISOString() }, recId(k, dog))
      .then(function () { showUndo(k, dog); });
  }
  function undo(k, dog) {
    hideUndo();
    db.remove(recId(k, dog)).then(function () { Apps.toast('取り消しました'); });
  }

  // ---------- 表示：共通 ----------
  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function dogSvg(dog, done) {
    var ns = 'http://www.w3.org/2000/svg';
    var s = document.createElementNS(ns, 'svg');
    s.setAttribute('viewBox', '0 0 200 170'); s.setAttribute('class', 'dog'); s.setAttribute('aria-hidden', 'true');
    ['#dog' + dog.toUpperCase(), done ? '#faceDone' : '#faceYet'].forEach(function (h) {
      var u = document.createElementNS(ns, 'use'); u.setAttribute('href', h); s.appendChild(u);
    });
    return s;
  }
  function logRow(r, s, showDate) {
    var li = el('li');
    li.appendChild(el('span', 'd', showDate ? md(r.data.date) : ''));
    li.appendChild(el('span', 'w ' + r.data.dog, s.dogs[r.data.dog] || r.data.dog));
    var n = el('span', 'n', memberName(r.data.by, r.data.byName));
    if (r.pending) n.appendChild(el('span', 'p', ' 送信待ち'));
    li.appendChild(n);
    li.appendChild(el('span', 't', hm(r.data.at)));
    return li;
  }
  function show(v) {
    view = v;
    ['today', 'log', 'who', 'settings'].forEach(function (x) { $('v-' + x).hidden = x !== v; });
    render();
    window.scrollTo(0, 0);
  }

  // ---------- 表示：今日 ----------
  function renderToday() {
    var s = settings();
    var k = dayKey(new Date());
    $('todayDate').textContent = longDate(k);
    $('meChip').textContent = memberName(me()) + ' ▾';
    var left = DOGS.filter(function (d) { return !recordFor(k, d); });
    var sum = $('summary');
    if (left.length === 0) { sum.className = 'summary all'; sum.textContent = '今日は2頭とも磨きました'; }
    else if (left.length === DOGS.length) { sum.className = 'summary yet'; sum.textContent = '今日はまだ2頭とも磨いていません'; }
    else { sum.className = 'summary part'; sum.textContent = 'あと1頭（' + s.dogs[left[0]] + '）がまだです'; }

    var box = $('dogs');
    box.innerHTML = '';
    DOGS.forEach(function (d) {
      var r = recordFor(k, d);
      var card = el('section', 'dogcard ' + (r ? 'done' : 'yet'));
      card.setAttribute('aria-label', s.dogs[d]);
      card.appendChild(el('span', 'nm', s.dogs[d]));
      card.appendChild(dogSvg(d, !!r));
      card.appendChild(el('span', 'verdict', r ? 'した' : 'まだ'));
      var who = el('span', 'who');
      if (r) {
        var b = el('b', null, memberName(r.data.by, r.data.byName));
        who.appendChild(b); who.appendChild(document.createElement('br'));
        who.appendChild(document.createTextNode(hm(r.data.at) + (r.pending ? '（送信待ち）' : '')));
      } else who.textContent = '今日はまだ';
      card.appendChild(who);
      var btn = el('button', 'dogbtn' + (r ? ' ok' : ''));
      btn.type = 'button';
      btn.id = 'btn-' + d;
      if (r) { btn.textContent = '今日はOK'; btn.disabled = true; }
      else {
        btn.appendChild(document.createTextNode(s.dogs[d] + 'を'));
        btn.appendChild(document.createElement('br'));
        btn.appendChild(document.createTextNode('磨いた'));
        btn.addEventListener('click', function () { markDone(d); });
      }
      card.appendChild(btn);
      if (r) {
        var u = el('button', 'undo', 'まちがえた？取り消す');
        u.type = 'button';
        u.id = 'undo-' + d;
        u.addEventListener('click', function () { undo(k, d); });
        card.appendChild(u);
      }
      box.appendChild(card);
    });
    $('hint').textContent = left.length ? '押すと「' + memberName(me()) + '・いまの時刻」で記録されます' : '日付が変わると、また「まだ」に戻ります';

    var recent = $('recent');
    recent.innerHTML = '';
    var rs = brushRecords().sort(byTimeDesc).slice(0, 4);
    if (!rs.length) recent.appendChild(el('li', 'empty', 'まだ記録がありません'));
    rs.forEach(function (r) { recent.appendChild(logRow(r, s, true)); });
  }
  function byTimeDesc(a, b) {
    var x = a.data.date + (a.data.at || ''), y = b.data.date + (b.data.at || '');
    return x < y ? 1 : x > y ? -1 : 0;
  }

  // ---------- 表示：記録一覧 ----------
  function renderLog() {
    var s = settings();
    var today = new Date();
    var tk = dayKey(today);
    var g = $('week');
    g.innerHTML = '';
    g.appendChild(el('span'));
    var days = [];
    for (var i = 6; i >= 0; i--) days.push(addDays(today, -i));
    days.forEach(function (d) { var c = el('span'); c.appendChild(document.createTextNode(WD[d.getDay()])); c.appendChild(document.createElement('br')); c.appendChild(document.createTextNode(d.getDate())); g.appendChild(c); });
    DOGS.forEach(function (dog) {
      g.appendChild(el('span', 'rl', s.dogs[dog]));
      days.forEach(function (d) {
        var k = dayKey(d);
        var ok = !!recordFor(k, dog);
        var dot = el('div', 'dot ' + (ok ? 'ok' : 'ng') + (k === tk ? ' td' : ''), ok ? '✓' : '−');
        dot.setAttribute('aria-label', md(k) + ' ' + s.dogs[dog] + (ok ? ' した' : ' 記録なし'));
        g.appendChild(dot);
      });
    });
    var box = $('allLog');
    box.innerHTML = '';
    for (var j = 0; j < 30; j++) {
      var k = dayKey(addDays(today, -j));
      var h = el('h3', null, longDate(k) + (j === 0 ? ' 今日' : j === 1 ? ' 昨日' : ''));
      var ul = el('ul', 'log');
      DOGS.forEach(function (dog) {
        var r = recordFor(k, dog);
        if (r) ul.appendChild(logRow(r, s, false));
        else {
          var li = el('li');
          li.appendChild(el('span', 'd', ''));
          li.appendChild(el('span', 'w ' + dog, s.dogs[dog]));
          li.appendChild(el('span', 'none', j === 0 ? 'まだ' : '記録なし'));
          li.appendChild(el('span', 't', ''));
          ul.appendChild(li);
        }
      });
      box.appendChild(h); box.appendChild(ul);
    }
  }

  // ---------- 表示：使う人 ----------
  function renderWho() {
    var box = $('names');
    box.innerHTML = '';
    settings().members.forEach(function (m) {
      var b = el('button', 'namebtn', m.name);
      b.type = 'button';
      b.id = 'who-' + m.id;
      b.setAttribute('aria-pressed', String(me() === m.id));
      b.addEventListener('click', function () { setMe(m.id); show('today'); });
      box.appendChild(b);
    });
    $('whoBack').hidden = !me();
  }

  // ---------- 表示：設定 ----------
  var formDirty = false;
  function fillSettings() {
    var s = settings();
    $('dogA').value = s.dogs.a; $('dogB').value = s.dogs.b;
    s.members.forEach(function (m, i) { $('m' + (i + 1)).value = m.name; });
    formDirty = false;
  }
  function renderSettings() {
    if (!formDirty) fillSettings();
    $('meNow').textContent = memberName(me());
  }

  function render() {
    if (view === 'today') renderToday();
    else if (view === 'log') renderLog();
    else if (view === 'who') renderWho();
    else if (view === 'settings') renderSettings();
  }

  // ---------- 取り消し（記録直後） ----------
  var undoEl = null;
  function showUndo(k, dog) {
    hideUndo();
    undoEl = el('div', 'undo-toast');
    undoEl.setAttribute('role', 'status');
    undoEl.appendChild(el('span', null, settings().dogs[dog] + 'を記録しました（' + hm(new Date().toISOString()) + '）'));
    var b = el('button', null, '取り消す');
    b.type = 'button';
    b.addEventListener('click', function () { undo(k, dog); });
    undoEl.appendChild(b);
    document.body.appendChild(undoEl);
    undoTimer = setTimeout(hideUndo, 8000);
  }
  function hideUndo() { clearTimeout(undoTimer); if (undoEl) undoEl.remove(); undoEl = null; }

  // ---------- 夜0時で「まだ」に戻す ----------
  var shownDay = dayKey(new Date());
  function checkDay() {
    var k = dayKey(new Date());
    if (k !== shownDay) { shownDay = k; hideUndo(); render(); }
  }
  function scheduleMidnight() {
    var now = new Date();
    var next = addDays(now, 1);
    setTimeout(function () { checkDay(); scheduleMidnight(); }, Math.max(1000, next - now + 1000));
  }
  setInterval(checkDay, 60000);       // スリープ明けのずれ対策
  document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible') checkDay(); });
  scheduleMidnight();

  // ---------- 操作 ----------
  document.querySelectorAll('[data-go]').forEach(function (b) {
    b.addEventListener('click', function () { show(b.getAttribute('data-go')); });
  });
  $('toLog').addEventListener('click', function () { show('log'); });
  $('toSettings').addEventListener('click', function () { formDirty = false; show('settings'); });
  $('meChip').addEventListener('click', function () { show('who'); });
  $('changeMe').addEventListener('click', function () { show('who'); });
  $('conn').addEventListener('click', function () { Apps.openConnectSheet(APP); });
  $('setForm').addEventListener('input', function () { formDirty = true; });
  $('setForm').addEventListener('submit', function (e) {
    e.preventDefault();
    var v = function (id) { return $(id).value.trim(); };
    var data = {
      dogs: { a: v('dogA') || DEFAULTS.dogs.a, b: v('dogB') || DEFAULTS.dogs.b },
      members: DEFAULTS.members.map(function (m, i) { return { id: m.id, name: v('m' + (i + 1)) || m.name }; })
    };
    db.put(data, SETTINGS_ID).then(function () {
      formDirty = false;
      Apps.toast('保存しました');
      show('today');
    });
  });

  db.onChange(function (l) { list = l; render(); });
  Apps.on('error', function (d) {
    var st = $('status');
    st.className = 'status err';
    st.textContent = Apps.errorText(d.error);
  });

  // 起動：つながっていなければ接続画面 → 使う人が未設定なら「あなたはだれ？」
  show(me() ? 'today' : 'who');
  Apps.ensureConnected(APP).then(function () { return db.sync(); }).then(function () {
    var st = $('status'); st.className = 'status'; st.textContent = '';
  }).catch(function () { /* 'error' で表示済み */ });

  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(function () {});
})();
