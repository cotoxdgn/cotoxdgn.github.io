/* ワンコの歯磨きしたかな — 家族4人で、わんこ2頭の歯磨きを1日1回ずつ記録する */
(function () {
  'use strict';
  var APP = 'wanko';
  var VERSION = '5';                        // version.json と sw.js の CACHE（wanko-v3）と一緒に上げる
  var OLD_SETTINGS_ID = 'settings';         // 旧版がアプリ内で保存していた名前（今は使わない・書かない）
  var ME_KEY = 'wanko.me.v1';               // この端末で使う人（家族のID）
  var NAMES_KEY = 'wanko.names.v1';         // スプシの名前表の控え（オフラインでも表示するため）
  var DOGS = ['a', 'b'];
  var DEFAULTS = {
    dogs: { a: 'わんこA', b: 'わんこB' },
    members: [{ id: 'm1', name: '家族A' }, { id: 'm2', name: '家族B' }, { id: 'm3', name: '家族C' }, { id: 'm4', name: '家族D' }]
  };
  var WD = ['日', '月', '火', '水', '木', '金', '土'];

  var db = Apps.collection(APP, { autoSync: false });   // 同期は家族用スプシにつながっているときだけ（下の syncAll）
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

  // ---------- 名前（正本は家族用スプシの「設定」シート B9〜B14。アプリからは書かない） ----------
  var names = null;     // { dogs: [a, b], members: [1..4] }
  var namesState = '';  // '' | 'ok' | 'old'（スプシのプログラムが古い） | 'err'
  var namesErr = null;  // 読めなかったときのエラー（code・detail をそのまま出す）
  var namesTarget = null; // スプシの B3（wanko でなければ名前表がない）
  try { names = JSON.parse(localStorage.getItem(NAMES_KEY) || 'null'); } catch (e) { names = null; }
  function settings() {
    var n = names || {};
    var d = n.dogs || [], m = n.members || [];
    return {
      dogs: { a: d[0] || DEFAULTS.dogs.a, b: d[1] || DEFAULTS.dogs.b },
      members: DEFAULTS.members.map(function (x, i) { return { id: x.id, name: m[i] || x.name }; })
    };
  }
  var namesBusy = null;
  function loadNames() {
    if (!familyConn() || namesBusy) return namesBusy || Promise.resolve();
    namesBusy = Apps.call(APP, 'names').then(function (res) {
      names = res.names || null;
      namesState = 'ok'; namesErr = null;
      namesTarget = typeof res.target === 'string' ? res.target : null;
      try { localStorage.setItem(NAMES_KEY, JSON.stringify(names)); } catch (e) { /* 控えなしでも表示はできる */ }
    }, function (e) {
      namesState = e && e.code === 'bad_action' ? 'old' : 'err';
      namesErr = e;
    }).then(function () { namesBusy = null; render(); });
    return namesBusy;
  }

  // ---------- 接続：wanko は家族用スプシ専用の接続（B3=wanko のQR）だけを使う ----------
  // 自分用スプシ（全アプリ共通の接続）に流れると、記録も名前も家族と別の場所に保存されてしまう
  function familyConn() {
    var c = Apps.parseConnect(Apps.connectLink(APP));
    return c && c.app === APP ? c : null;
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
    return list.filter(function (r) { return r.id !== OLD_SETTINGS_ID && r.data && r.data.date && r.data.dog; });
  }
  function recordFor(k, dog) { var r = db.get(recId(k, dog)); return r && r.data ? r : null; }

  function markDone(dog) {
    if (!familyConn()) { show('connect'); return; }   // 家族用スプシ以外には書かない
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
    if (v !== 'connect' && v !== 'settings' && !familyConn()) v = 'connect';   // 家族用につながるまでは、つなぐ画面だけ
    if (view === 'settings' && v !== 'settings') hideQr();
    if (view === 'connect' && v !== 'connect') { stopCam(); $('connMsg').hidden = true; $('connNext').hidden = true; }
    view = v;
    if (v === 'connect') {
      $('connBack').hidden = !familyConn();
      $('iosHint').hidden = !(Apps.isIOS() && !Apps.isStandalone());
    }
    ['today', 'log', 'who', 'settings', 'connect'].forEach(function (x) { $('v-' + x).hidden = x !== v; });
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
      var ul = el('ul', 'log nod');
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
  function renderSettings() {
    var s = settings();
    var box = $('nameList');
    box.innerHTML = '';
    [['わんこ1', s.dogs.a], ['わんこ2', s.dogs.b]].concat(s.members.map(function (m, i) { return ['家族' + (i + 1), m.name]; }))
      .forEach(function (p) {
        var row = el('div', 'kv');
        row.appendChild(el('span', 'k', p[0]));
        row.appendChild(el('b', null, p[1]));
        box.appendChild(row);
      });
    $('namesNote').textContent = namesProblem();
    $('meNow').textContent = memberName(me());
    var c = Apps.getConnection(APP);
    $('connNow').textContent = !c ? '未接続' : (familyConn() ? '家族用（wanko）✓' : '自分用 ×') + '　' + (c.name || '');
    $('qrStart').disabled = !familyConn();
  }

  // ---------- 家族に配る：この端末の接続から QR を出す ----------
  function showQr() {
    var link = familyConn() ? Apps.connectLink(APP) : '';
    if (!link) return;
    Apps.loadScript('../shared/lib/qrcode.js').then(function () {
      var q = window.qrcode(0, 'M');
      q.addData(link);
      q.make();
      var box = $('qrBox');
      box.innerHTML = '';
      var img = document.createElement('img');
      img.src = q.createDataURL(6, 12);
      img.alt = '家族用スプシにつなぐQR';
      img.id = 'qrImg';
      box.appendChild(img);
      $('qrLink').textContent = link;
      $('qrWarn').hidden = true;
      $('qrShown').hidden = false;
    }, function () { Apps.toast('QRを表示できませんでした（通信を確認）', true); });
  }
  function hideQr() {
    $('qrBox').innerHTML = '';
    $('qrLink').textContent = '';
    $('qrShown').hidden = true;
    $('qrWarn').hidden = true;
  }

  // つながり先：家族用（wanko）✓／自分用 ×／未接続
  function renderConn() {
    var c = Apps.getConnection(APP);
    var st = !c ? 'none' : familyConn() ? 'family' : 'own';
    var el2 = $('connState');
    el2.className = 'connstate ' + st;
    el2.textContent = 'つながっているスプシ：' + (st === 'family' ? '家族用（wanko）✓' : st === 'own' ? '自分用 ×（ワンコには使えません）' : '未接続');
    $('connState2').className = el2.className;
    $('connState2').textContent = el2.textContent;
  }
  // 名前表が読めない・空のときの案内（'' なら問題なし）
  function namesProblem() {
    if (!familyConn()) return '';
    if (namesState === 'old') return '家族用スプシのプログラムが古いため、名前を読めません。Code.gs を新しいものに貼り替えて、新バージョンでデプロイしてください。';
    if (namesState === 'err') return '名前を読み込めませんでした：' + errDetail(namesErr) + (names ? '（前回の名前を表示しています）' : '');
    if (namesState === 'ok' && namesTarget !== null && namesTarget !== APP) return '家族用スプシの「設定」シート B3 に wanko が入っていません。B3 に wanko と入れ、メニュー［アプリ設定］→［準備をやり直す（setup）］を実行してください。';
    var n = names || {};
    var empty = !(n.dogs || []).concat(n.members || []).some(function (x) { return x; });
    if (namesState === 'ok' && empty) return 'スプシの設定シート（B9〜B14）で名前を入れてください。いまは「わんこA」「家族A」などを表示しています。';
    return '';
  }

  function render() {
    if (view === 'today') renderToday();
    else if (view === 'log') renderLog();
    else if (view === 'who') renderWho();
    else if (view === 'settings') renderSettings();
    renderConn();
    var np = namesProblem();
    $('namesHint').textContent = np;
    $('namesHint').hidden = !np || view !== 'today';
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
  $('toSettings').addEventListener('click', function () { show('settings'); loadNames(); });
  $('meChip').addEventListener('click', function () { show('who'); });
  $('changeMe').addEventListener('click', function () { show('who'); });
  $('reconnect').addEventListener('click', function () { show('connect'); });
  $('reloadNames').addEventListener('click', function () { loadNames().then(function () { if (namesState === 'ok') Apps.toast('名前を読み込みました'); }); });
  $('qrStart').addEventListener('click', function () { $('qrWarn').hidden = false; $('qrShown').hidden = true; });
  $('qrOk').addEventListener('click', showQr);
  $('qrCancel').addEventListener('click', hideQr);
  $('qrHide').addEventListener('click', hideQr);

  // ---------- 家族用スプシにつなぐ（ワンコ専用の読み取り。家族用以外のQRは保存しない） ----------
  function errDetail(e) {
    if (!e) return '';
    var t = Apps.errorText(e);
    var code = e.code || e.message || '';
    return t + '［' + code + (e.detail ? '：' + String(e.detail).slice(0, 200) : '') + '］';
  }
  function connMsg(text, ok) {
    var m = $('connMsg');
    m.className = 'msgbox ' + (ok ? 'ok' : 'ng');
    m.textContent = text;
    m.hidden = false;
  }
  var cam = { stream: null, raf: 0 };
  function stopCam() {
    if (cam.raf) cancelAnimationFrame(cam.raf);
    cam.raf = 0;
    if (cam.stream) cam.stream.getTracks().forEach(function (t) { t.stop(); });
    cam.stream = null;
    $('camVideo').hidden = true;
    $('scanStop').hidden = true;
  }
  function decodeImage(src, w, h) {
    var s = Math.min(1, 1000 / Math.max(w, h));
    var cv = document.createElement('canvas');
    cv.width = Math.round(w * s); cv.height = Math.round(h * s);
    var ctx = cv.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(src, 0, 0, cv.width, cv.height);
    var hit = window.jsQR(ctx.getImageData(0, 0, cv.width, cv.height).data, cv.width, cv.height, { inversionAttempts: 'attemptBoth' });
    return hit && hit.data ? hit.data : null;
  }
  // 読んだQR・リンクの中身を確かめて、家族用（a=wanko）のときだけ保存する
  function tryConnect(text) {
    var c = Apps.parseConnect(text || '');
    if (!c) {
      connMsg('つなぐ用のQR・リンクではありません。家族用スプシのメニュー［アプリ設定］→［この端末をつなぐ（リンクとQR）］に出るQRを読んでください。');
      return false;
    }
    if (c.app !== APP) {
      connMsg('これは自分用のQRです（つなぐ先：' + (c.app ? c.app + ' だけ' : '全アプリ共通') + (c.name ? '、' + c.name : '') + '）。\n'
        + '家族用スプシ「ワンコの歯磨き（家族）」のメニュー［アプリ設定］→［この端末をつなぐ（リンクとQR）］のQRを読んでください。\n'
        + '（家族用スプシの「設定」シート B3 が wanko でないと、家族用のQRになりません）');
      return false;
    }
    stopCam();
    Apps.saveConnection(c);
    connMsg('つながりました（' + (c.name || 'スプレッドシート') + '）。名前を読み込んでいます…', true);
    syncAll().then(function () {
      if (namesState === 'ok') {
        var s = settings();
        var warn = namesProblem();
        connMsg('つながりました（' + (c.name || 'スプレッドシート') + '）\n'
          + 'わんこ：' + s.dogs.a + '・' + s.dogs.b + '\n家族：' + s.members.map(function (m) { return m.name; }).join('・')
          + (warn ? '\n\n' + warn : ''), !warn);
      } else {
        connMsg('つながりましたが、名前を読めませんでした。\n' + (namesState === 'old'
          ? '家族用スプシのプログラムが古いようです（' + errDetail(namesErr) + '）。Code.gs を貼り替え、［デプロイを管理］→ 新バージョンでデプロイしてください。'
          : errDetail(namesErr)));
      }
      $('connNext').hidden = false;
    });
    return true;
  }
  $('scanCam').addEventListener('click', function () {
    connMsg('カメラを準備しています…', true);
    Apps.loadScript('../shared/lib/jsQR.js').then(function () {
      return navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
    }).then(function (stream) {
      cam.stream = stream;
      var v = $('camVideo');
      v.srcObject = stream; v.hidden = false; $('scanStop').hidden = false;
      connMsg('パソコンに出ている家族用スプシのQRを映してください', true);
      v.play().catch(function () {});
      var last = '';
      (function loop() {
        if (!cam.stream) return;
        if (v.readyState >= 2 && v.videoWidth) {
          var t = decodeImage(v, v.videoWidth, v.videoHeight);
          if (t && t !== last) { last = t; if (tryConnect(t)) return; }
        }
        cam.raf = requestAnimationFrame(loop);
      })();
    }).catch(function (e) {
      stopCam();
      connMsg('カメラを使えませんでした（' + (e && (e.name || e.code || e.message) || '') + '）。「写真から読み取る」か、リンクの貼り付けを使ってください。');
    });
  });
  $('scanStop').addEventListener('click', stopCam);
  $('scanFile').addEventListener('click', function () { $('fileIn').click(); });
  $('fileIn').addEventListener('change', function () {
    var f = this.files && this.files[0];
    this.value = '';
    if (!f) return;
    Apps.loadScript('../shared/lib/jsQR.js').then(function () {
      return new Promise(function (ok, ng) {
        var img = new Image();
        img.onload = function () { ok(img); };
        img.onerror = ng;
        img.src = URL.createObjectURL(f);
      });
    }).then(function (img) {
      var t = decodeImage(img, img.naturalWidth, img.naturalHeight);
      if (!t) connMsg('写真からQRを読み取れませんでした。QRが大きく写った写真で試してください。');
      else tryConnect(t);
    }, function () { connMsg('写真を読み込めませんでした。'); });
  });
  $('pasteGo').addEventListener('click', function () { tryConnect($('pasteIn').value.trim()); });
  $('connNext').addEventListener('click', function () { show(me() ? 'today' : 'who'); });
  $('connBack').addEventListener('click', function () { show(me() ? 'today' : 'who'); });

  db.onChange(function (l) { list = l; render(); });
  Apps.on('error', function (d) {
    var st = $('status');
    st.className = 'status err';
    st.textContent = Apps.errorText(d.error);
  });

  // つなぐ先が変わったら（自分用→家族用など）、前のスプシの控えを捨てて全件取り直す
  function connSig() { var c = Apps.getConnection(APP); return c ? c.url + '|' + c.key + '|' + (familyConn() ? 'f' : '') : ''; }
  var lastUrl = connSig();
  Apps.on('connection', function () {
    var u = connSig();
    if (u === lastUrl) { render(); return; }
    lastUrl = u;
    names = null; namesState = '';
    try { localStorage.removeItem(NAMES_KEY); } catch (e) { /* 無視 */ }
    render();
    if (familyConn()) db.sync({ full: true }).then(loadNames, function () {});
  });
  // 起動時・画面に戻ったとき・電波が戻ったときに、記録と名前を取りに行く
  function syncAll() {
    if (!familyConn() || !navigator.onLine) return Promise.resolve();
    return Promise.all([db.sync().catch(function () { /* 'error' で表示 */ }), loadNames()]);
  }
  document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible') syncAll(); });
  window.addEventListener('online', syncAll);

  // 起動：つながっていなければ接続画面 → 使う人が未設定なら「あなたはだれ？」
  // 共通の接続画面（Apps.ensureConnected）は使わない：どのQRでも保存してしまうため
  show(!familyConn() ? 'connect' : me() ? 'today' : 'who');
  syncAll().then(function () {
    var st = $('status'); st.className = 'status'; st.textContent = '';
  });

  // ---------- 新しい版が出たら確実に切り替える ----------
  // version.json を毎回サーバーに聞き、違えば裏の仕組み（sw.js）も更新して1回だけ自動で読み直す。
  // それでも古いままなら「新しい版があります」を出して、押せば読み直す
  var swReg = null;
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).then(function (r) { swReg = r; }).catch(function () {});
  }
  function reloadNow() {
    var go = function () { location.reload(); };
    if (swReg) swReg.update().then(go, go); else go();
  }
  function checkUpdate() {
    if (!navigator.onLine) return;
    fetch('version.json?t=' + Date.now(), { cache: 'no-store' }).then(function (r) { return r.ok ? r.json() : null; }).then(function (j) {
      if (!j || !j.v || String(j.v) === VERSION) return;
      var key = 'wanko.reloaded.' + j.v;
      var tried = false;
      try { tried = sessionStorage.getItem(key) === '1'; sessionStorage.setItem(key, '1'); } catch (e) { tried = true; }
      if (!tried && !undoEl) { reloadNow(); return; }
      $('updBanner').hidden = false;
    }).catch(function () { /* オフラインなど：次の機会に */ });
  }
  $('updNow').addEventListener('click', reloadNow);
  document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible') checkUpdate(); });
  checkUpdate();
  $('verNow').textContent = 'v' + VERSION;
})();
