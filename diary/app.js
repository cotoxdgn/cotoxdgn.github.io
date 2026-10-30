/* 琴音日記 — 1日1ページ（出来事・感謝したこと・今日の格言・自由記述）＋写真1枚。
 * レコードは id＝日付（YYYY-MM-DD）。data = { date, events, thanks, motto, free, photo: 画像id|null } */
(function () {
  'use strict';
  var APP = 'diary';
  var APP_URL = 'https://cotoxdgn.github.io/diary/';
  var FIELDS = ['events', 'thanks', 'motto', 'free'];
  var LABELS = { events: '出来事', thanks: '感謝したこと', motto: '今日の格言', free: '自由に' };
  var DOTS = { events: 'd-ev', thanks: 'd-th', motto: 'd-mo', free: 'd-fr' };
  var WD = ['日', '月', '火', '水', '木', '金', '土'];
  var WD_EN = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
  var DRAFT_KEY = 'diary.draft.v1';

  var db = Apps.collection(APP);
  var $ = function (id) { return document.getElementById(id); };

  // ---------- 日付 ----------
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function ymd(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function parse(s) { var p = s.split('-'); return new Date(+p[0], +p[1] - 1, +p[2]); }
  function today() { return ymd(new Date()); }
  function jpDate(s) {
    var d = parse(s);
    return (d.getMonth() + 1) + '月' + d.getDate() + '日<span>（' + WD[d.getDay()] + '）</span>';
  }

  // ---------- 状態 ----------
  var state = {
    view: 'write',
    wDate: today(),
    wPhoto: null,       // 書く画面の写真 id
    dirty: false,
    uploading: false,
    cY: new Date().getFullYear(), cM: new Date().getMonth(),
    rDate: null,
    openedToday: today()
  };

  function rec(date) { return db.get(date); }
  function hasContent(d) {
    if (!d) return false;
    return !!(d.photo || FIELDS.some(function (k) { return d[k] && String(d[k]).trim(); }));
  }
  function written() {
    return db.all().filter(function (r) { return hasContent(r.data); })
      .map(function (r) { return r.id; }).sort();
  }

  // ---------- 下書き（保存前の入力を端末に控える） ----------
  function draftGet() { try { return JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null'); } catch (e) { return null; } }
  function draftSet(v) { try { if (v) localStorage.setItem(DRAFT_KEY, JSON.stringify(v)); else localStorage.removeItem(DRAFT_KEY); } catch (e) { /* 無視 */ } }

  function formData() {
    var d = { date: state.wDate, photo: state.wPhoto || null };
    FIELDS.forEach(function (k) { d[k] = $('f-' + k).value.replace(/\s+$/, ''); });
    return d;
  }

  // ---------- 表示切り替え ----------
  function show(view) {
    state.view = view;
    ['write', 'cal', 'read'].forEach(function (v) { $('v-' + v).hidden = v !== view; });
    var tab = view === 'write' && state.wDate === today() ? 'write' : 'cal';
    Array.prototype.forEach.call(document.querySelectorAll('.tab'), function (b) {
      b.classList.toggle('on', b.getAttribute('data-tab') === tab);
    });
    if (view === 'cal') renderCal();
    if (view === 'read') renderRead();
    window.scrollTo(0, 0);
  }

  // ---------- 書く ----------
  function openWrite(date) {
    if (state.dirty && date !== state.wDate) saveNow(true);
    state.wDate = date;
    fillForm();
    show('write');
  }

  function fillForm() {
    var r = rec(state.wDate);
    var d = r ? r.data : {};
    var dr = draftGet();
    if (dr && dr.date === state.wDate) { d = dr; state.dirty = true; } else state.dirty = false;
    FIELDS.forEach(function (k) { $('f-' + k).value = d[k] || ''; });
    state.wPhoto = d.photo || null;
    renderWriteHead();
    renderPhoto();
  }

  function renderWriteHead() {
    var isToday = state.wDate === today();
    $('w-label').textContent = isToday ? 'TODAY' : '書き直し中';
    $('w-date').innerHTML = jpDate(state.wDate);
    var r = rec(state.wDate);
    var chip = $('w-chip');
    if (state.dirty) { chip.hidden = false; chip.className = 'chip pend'; chip.textContent = '未保存'; }
    else if (r && r.pending) { chip.hidden = false; chip.className = 'chip pend'; chip.textContent = '送信待ち'; }
    else if (r && hasContent(r.data)) { chip.hidden = false; chip.className = 'chip'; chip.textContent = '保存済み'; }
    else chip.hidden = true;
  }

  function renderPhoto() {
    var box = $('w-photo');
    box.innerHTML = '';
    if (state.uploading) {
      box.innerHTML = '<div class="photo uploading">写真を保存しています…</div>';
      return;
    }
    if (state.wPhoto) {
      var wrap = document.createElement('div');
      wrap.className = 'photo';
      var img = document.createElement('img');
      img.alt = 'この日の写真';
      img.src = Apps.imageUrl(state.wPhoto, 1000);
      var acts = document.createElement('div');
      acts.className = 'acts';
      acts.innerHTML = '<label>差し替え<input class="sr" type="file" accept="image/*" id="photo-replace"></label>' +
        '<button type="button" id="photo-remove">外す</button>';
      wrap.appendChild(img);
      wrap.appendChild(acts);
      box.appendChild(wrap);
      $('photo-replace').addEventListener('change', onPhoto);
      $('photo-remove').addEventListener('click', removePhoto);
    } else {
      var lab = document.createElement('label');
      lab.className = 'addphoto';
      lab.innerHTML = '<i>＋</i><span>今日の1枚を選ぶ</span><input class="sr" type="file" accept="image/*" id="photo-input">';
      box.appendChild(lab);
      $('photo-input').addEventListener('change', onPhoto);
    }
  }

  function onPhoto(e) {
    var file = e.target.files && e.target.files[0];
    if (!file) return;
    if (!Apps.isConnected(APP)) { Apps.toast('先にスプシとつないでください', true); return; }
    var old = state.wPhoto;
    var date = state.wDate;
    state.uploading = true;
    renderPhoto();
    Apps.uploadImage(APP, file).then(function (img) {
      state.uploading = false;
      if (state.wDate !== date) return; // 途中で日付を変えたとき
      state.wPhoto = img.id;
      renderPhoto();
      return saveNow(true).then(function () {
        if (old && old !== img.id) Apps.deleteImage(APP, old).catch(function () {});
        Apps.toast('写真を保存しました');
      });
    }).catch(function (er) {
      state.uploading = false;
      renderPhoto();
      Apps.toast('写真を保存できませんでした：' + Apps.errorText(er), true);
    });
  }

  function removePhoto() {
    var old = state.wPhoto;
    state.wPhoto = null;
    renderPhoto();
    saveNow(true).then(function () {
      if (old) Apps.deleteImage(APP, old).catch(function () {});
      Apps.toast('写真を外しました');
    });
  }

  function saveNow(quiet) {
    var d = formData();
    var date = d.date;
    var p;
    if (!hasContent(d)) p = rec(date) ? db.remove(date) : Promise.resolve();
    else p = db.put(d, date);
    return p.then(function () {
      draftSet(null);
      if (state.wDate === date) state.dirty = false;
      renderWriteHead();
      if (!quiet) Apps.toast(hasContent(d) ? '保存しました' : '空なので消しました');
    });
  }

  function onInput() {
    state.dirty = true;
    draftSet(formData());
    renderWriteHead();
  }

  // ---------- カレンダー ----------
  function renderCal() {
    var y = state.cY, m = state.cM;
    $('c-title').textContent = y + '年 ' + (m + 1) + '月';
    var first = new Date(y, m, 1).getDay();
    var days = new Date(y, m + 1, 0).getDate();
    var t = today();
    var cal = $('cal');
    cal.innerHTML = '';
    WD.forEach(function (w, i) {
      var el = document.createElement('div');
      el.className = 'w' + (i === 0 ? ' sun' : i === 6 ? ' sat' : '');
      el.textContent = w;
      cal.appendChild(el);
    });
    for (var i = 0; i < first; i++) cal.appendChild(document.createElement('div'));
    var n = 0, p = 0;
    for (var d = 1; d <= days; d++) {
      var key = y + '-' + pad(m + 1) + '-' + pad(d);
      var r = rec(key);
      var b = document.createElement('button');
      b.type = 'button';
      b.setAttribute('data-date', key);
      var cls = [];
      if (r && hasContent(r.data)) { cls.push('has'); n++; if (r.data.photo) { cls.push('pic'); p++; } }
      if (key === t) cls.push('today');
      b.className = cls.join(' ');
      b.disabled = key > t;
      b.innerHTML = d + '<span class="m"></span>';
      b.setAttribute('aria-label', (m + 1) + '月' + d + '日' + (cls.indexOf('has') > -1 ? '（書いた日）' : ''));
      cal.appendChild(b);
    }
    $('c-n').textContent = n + '日';
    $('c-p').textContent = p + '日';
    var now = new Date();
    $('c-next').disabled = y > now.getFullYear() || (y === now.getFullYear() && m >= now.getMonth());
  }
  $('cal').addEventListener('click', function (e) {
    var b = e.target.closest('button[data-date]');
    if (!b || b.disabled) return;
    var key = b.getAttribute('data-date');
    var r = rec(key);
    if (r && hasContent(r.data)) { state.rDate = key; show('read'); }
    else openWrite(key);
  });
  function moveMonth(k) {
    state.cM += k;
    if (state.cM < 0) { state.cM = 11; state.cY--; }
    if (state.cM > 11) { state.cM = 0; state.cY++; }
    renderCal();
  }
  $('c-prev').addEventListener('click', function () { moveMonth(-1); });
  $('c-next').addEventListener('click', function () { moveMonth(1); });

  // ---------- 読む ----------
  function renderRead() {
    var key = state.rDate;
    var d = parse(key);
    $('r-label').textContent = d.getFullYear() + ' · ' + WD_EN[d.getDay()];
    $('r-date').innerHTML = jpDate(key);
    var body = $('r-body');
    body.innerHTML = '';
    var r = rec(key);
    if (!r || !hasContent(r.data)) {
      body.innerHTML = '<div class="empty"><span>この日はまだ書いていません</span></div>';
      var b = document.createElement('button');
      b.className = 'ax-btn ax-btn-primary';
      b.type = 'button';
      b.textContent = 'この日を書く';
      b.onclick = function () { openWrite(key); };
      body.firstChild.appendChild(b);
    } else {
      if (r.data.photo) {
        var ph = document.createElement('div');
        ph.className = 'photo';
        var img = document.createElement('img');
        img.alt = 'この日の写真';
        img.src = Apps.imageUrl(r.data.photo, 1000);
        ph.appendChild(img);
        body.appendChild(ph);
      }
      FIELDS.forEach(function (k) {
        var e = document.createElement('div');
        e.className = 'entry';
        var h = document.createElement('h3');
        h.innerHTML = '<span class="dot ' + DOTS[k] + '"></span>' + LABELS[k];
        var p = document.createElement('p');
        var v = (r.data[k] || '').trim();
        p.textContent = v || '（なし）';
        if (!v) p.className = 'none';
        e.appendChild(h);
        e.appendChild(p);
        body.appendChild(e);
      });
    }
    var list = written();
    var idx = list.indexOf(key);
    var prev = idx > -1 ? list[idx - 1] : list.filter(function (x) { return x < key; }).pop();
    var next = idx > -1 ? list[idx + 1] : list.filter(function (x) { return x > key; })[0];
    $('r-prev').hidden = !prev; $('r-prev').onclick = function () { state.rDate = prev; renderRead(); };
    $('r-next').hidden = !next; $('r-next').onclick = function () { state.rDate = next; renderRead(); };
    $('r-edit').hidden = !(r && hasContent(r.data));
  }
  $('r-back').addEventListener('click', function () {
    var d = parse(state.rDate);
    state.cY = d.getFullYear(); state.cM = d.getMonth();
    show('cal');
  });
  $('r-edit').addEventListener('click', function () { openWrite(state.rDate); });

  // ---------- 通知の設定 ----------
  function openNotify() {
    var ov = document.createElement('div');
    ov.className = 'ax-overlay';
    ov.innerHTML =
      '<div class="ax-sheet" role="dialog" aria-modal="true" aria-labelledby="n-title">' +
      '<div class="ax-sheet-head"><h2 id="n-title">通知の設定</h2><button class="ax-btn ax-btn-ghost" type="button" id="n-close">閉じる</button></div>' +
      '<p class="ax-note">iPhoneの「ショートカット」アプリで、毎日決まった時刻にお知らせを出し、タップで日記を開けるようにします。</p>' +
      '<ol class="steps">' +
      '<li>「ショートカット」アプリを開き、下の<b>オートメーション</b>→右上の<b>＋</b>。</li>' +
      '<li><b>時刻</b>を選び、時刻（例：21:30）と<b>毎日</b>を設定。<b>確認後に実行</b>を選んで「次へ」。</li>' +
      '<li><b>新規の空のオートメーション</b>→アクション<b>「URLを開く」</b>を追加し、URL に下のアドレスを貼る→「完了」。</li>' +
      '<li>毎日その時刻に通知が届きます。タップすると日記が開きます。</li>' +
      '</ol>' +
      '<div class="copy"><code id="n-url"></code><button class="ax-btn" type="button" id="n-copy">コピー</button></div>' +
      '<p class="ax-note">「URLを開く」は Safari で開きます。Safari でもこの日記を一度スプシとつないでおいてください（右上の「接続」から）。</p>' +
      '</div>';
    document.body.appendChild(ov);
    $('n-url').textContent = APP_URL;
    var close = function () { ov.remove(); };
    $('n-close').onclick = close;
    ov.addEventListener('click', function (e) { if (e.target === ov) close(); });
    $('n-copy').onclick = function () {
      var done = function () { Apps.toast('コピーしました'); };
      try {
        navigator.clipboard.writeText(APP_URL).then(done, function () { selectUrl(); });
      } catch (e) { selectUrl(); }
    };
    function selectUrl() {
      var r = document.createRange(); r.selectNodeContents($('n-url'));
      var s = window.getSelection(); s.removeAllRanges(); s.addRange(r);
      Apps.toast('選択しました。長押しでコピーしてください');
    }
  }

  // ---------- 状態表示 ----------
  function setStatus(msg, isErr) {
    var s = $('status');
    s.textContent = msg || '';
    s.className = 'status' + (isErr ? ' err' : '');
  }

  // ---------- つなぐ ----------
  FIELDS.forEach(function (k) { $('f-' + k).addEventListener('input', onInput); });
  $('btn-save').addEventListener('click', function () {
    saveNow(false).then(function () {
      if (Apps.isConnected(APP)) db.sync().then(function () { renderWriteHead(); setStatus(''); }).catch(function () {});
    });
  });
  Array.prototype.forEach.call(document.querySelectorAll('.tab'), function (b) {
    b.addEventListener('click', function () {
      var t = b.getAttribute('data-tab');
      if (t === 'write') openWrite(today());
      else show('cal');
    });
  });
  $('btn-notify').addEventListener('click', openNotify);
  $('btn-conn').addEventListener('click', function () { Apps.openConnectSheet(APP); });
  Apps.on('error', function (d) { setStatus(Apps.errorText(d.error), true); });

  db.onChange(function () {
    if (state.view === 'write') {
      if (!state.dirty && !state.uploading) fillForm(); else renderWriteHead();
    }
    if (state.view === 'cal') renderCal();
    if (state.view === 'read') renderRead();
  });

  // 日付が変わったあとに開き直したら「今日」に合わせる
  document.addEventListener('visibilitychange', function () {
    var t = today();
    if (document.visibilityState === 'visible' && state.view === 'write' && !state.dirty && state.wDate === state.openedToday && t !== state.openedToday) openWrite(t);
    state.openedToday = t;
  });

  fillForm();
  Apps.ensureConnected(APP).then(function () { return db.sync(); }).then(function () {
    setStatus('');
  }).catch(function () { /* 'error' で表示済み */ });

  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(function () {});
})();
