/* 工程の組み立て（路線図）。window.Kumi（計算だけ・テスト用にも使う）と、画面（window.TaskApp があるときだけ）
 * 計算：作業するのは1人なので、並び順のとおりに1日の上限（7h−余白1h）まで詰めていく。水・日・祝日は休み。
 *       ◆は、その手前の駅が済む日。前提がある駅は、前提の駅の日（＋依頼の待ち日数）より前には置かない。
 * 詳細の印：「🚫外す」（集計から外す）／「→◆名前」（この◆に必要）／「⏳3日」（依頼。返事まで3日） */
(function (global) {
  'use strict';
  var CAP = 6, OFF = [0, 3];   // 1日に入れる上限（7h−余白1h）、休み（日・水）

  // ---------- 日付 ----------
  function ymd(d) { return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); }
  function parse(s) { var p = s.split('-').map(Number); return new Date(p[0], p[1] - 1, p[2]); }
  function add(s, n) { var d = parse(s); d.setDate(d.getDate() + n); return ymd(d); }
  var holCache = {};
  function holidays(y) {   // タスク表の定期タスク.gs と同じ計算
    if (holCache[y]) return holCache[y];
    var map = {}, key = function (x) { return ymd(x); }, put = function (x) { map[key(x)] = x; };
    var nthMon = function (m, n) { var f = new Date(y, m - 1, 1); return new Date(y, m - 1, 1 + (1 - f.getDay() + 7) % 7 + (n - 1) * 7); };
    var yy = y - 1980;
    put(new Date(y, 0, 1)); put(nthMon(1, 2)); put(new Date(y, 1, 11)); put(new Date(y, 1, 23));
    put(new Date(y, 2, Math.floor(20.8431 + 0.242194 * yy - Math.floor(yy / 4))));
    put(new Date(y, 3, 29)); put(new Date(y, 4, 3)); put(new Date(y, 4, 4)); put(new Date(y, 4, 5));
    put(nthMon(7, 3)); put(new Date(y, 7, 11)); put(nthMon(9, 3));
    put(new Date(y, 8, Math.floor(23.2488 + 0.242194 * yy - Math.floor(yy / 4))));
    put(nthMon(10, 2)); put(new Date(y, 10, 3)); put(new Date(y, 10, 23));
    Object.keys(map).forEach(function (k) {
      var x = map[k]; if (x.getDay() !== 0) return;
      var n = new Date(x.getFullYear(), x.getMonth(), x.getDate() + 1);
      while (map[key(n)]) n = new Date(n.getFullYear(), n.getMonth(), n.getDate() + 1);
      map[key(n)] = n;
    });
    var days = Object.keys(map).map(function (k) { return map[k]; }).sort(function (a, b) { return a - b; });
    for (var i = 0; i < days.length - 1; i++) {
      if (Math.round((days[i + 1] - days[i]) / 86400000) !== 2) continue;
      var mid = new Date(days[i].getFullYear(), days[i].getMonth(), days[i].getDate() + 1);
      if (mid.getDay() !== 0 && !map[key(mid)]) map[key(mid)] = mid;
    }
    return (holCache[y] = map);
  }
  function isWork(s) { var d = parse(s); return OFF.indexOf(d.getDay()) < 0 && !holidays(d.getFullYear())[s]; }
  function nextWork(s) { while (!isWork(s)) s = add(s, 1); return s; }
  function addWork(s, n) { s = nextWork(s); for (var i = 0; i < n; i++) s = nextWork(add(s, 1)); return s; }
  function workDiff(a, b) {   // a→b の稼働日の差（b が後ろならプラス）
    if (a === b) return 0;
    var sign = a < b ? 1 : -1, x = sign > 0 ? a : b, y = sign > 0 ? b : a, n = 0;
    while (x < y) { x = add(x, 1); if (isWork(x)) n++; }
    return n * sign;
  }

  // ---------- 印（詳細の中） ----------
  var EX = '🚫外す';
  function parseDetail(s) {
    s = String(s || '');
    var need = (/→◆\s*([^\s→⏳🚫]+)/.exec(s) || [])[1] || '';
    var wait = Number((/⏳\s*(\d+)\s*日/.exec(s) || [])[1] || 0);
    var base = s.replace(EX, '').replace(/→◆\s*[^\s→⏳🚫]+/, '').replace(/⏳\s*\d+\s*日/, '').replace(/\s+/g, ' ').trim();
    return { ex: s.indexOf(EX) >= 0, need: need, wait: wait, base: base };
  }
  function composeDetail(base, need, wait, ex) {
    return [ex ? EX : '', base || '', need ? '→◆' + need : '', wait ? '⏳' + wait + '日' : ''].filter(Boolean).join(' ').trim();
  }
  function isMsTodo(t) { return /^\s*(◆|【確認】)/.test(t); }
  function msName(t) { return String(t).replace(/^\s*(【確認】)?\s*◆?\s*/, '').trim(); }

  // ---------- 並びから日付を出す ----------
  // seq：並び順の駅 [{ key, ko, ms, pre(前提の駅の key), wait }]（外した駅・済んだ駅は入れない）
  // base：ほかの案件などで、もう埋まっている時間 { 'yyyy-mm-dd': h }
  function schedule(seq, today, base) {
    var load = {}, k;
    for (k in base || {}) load[k] = base[k];
    var dates = {}, ready = {}, cur = nextWork(today), last = '';
    seq.forEach(function (it) {
      if (it.ms) { dates[it.key] = last || cur; return; }
      var d = cur;
      if (it.pre && ready[it.pre] && ready[it.pre] > d) d = ready[it.pre];
      d = nextWork(d);
      var ko = Math.max(0, Number(it.ko) || 0);
      var guard = 0;
      while ((load[d] || 0) + ko > CAP && !((load[d] || 0) === 0) && guard++ < 400) d = nextWork(add(d, 1));
      load[d] = (load[d] || 0) + ko;
      dates[it.key] = d; cur = d; last = d;
      ready[it.key] = it.wait ? addWork(d, it.wait) : d;
    });
    return { dates: dates, load: load, end: last || cur };
  }

  // ---------- ヒント（動かす前に出す） ----------
  // 次の◆を早めるための並べ替えを試して、早まるものだけ出す。分ける提案は3hより大きい駅
  function hints(seq, today, base) {
    var out = [], first = null, pos = -1;
    seq.forEach(function (it, i) { if (it.ms && !first) { first = it; pos = i; } });
    var cur = schedule(seq, today, base);
    var gainOf = function (s2) { if (!first) return 0; var r = schedule(s2, today, base); return workDiff(r.dates[first.key], cur.dates[first.key]); };
    var move = function (s, from, to) { s = s.slice(); var x = s.splice(from, 1)[0]; s.splice(to > from ? to - 1 : to, 0, x); return s; };
    if (first) {
      var name = first.msName, tagged = seq.some(function (it) { return !it.ms && it.need; });
      if (tagged) {
        // ◆に必要ない駅が◆より前にある → まとめて◆の後ろへ
        var notNeed = seq.filter(function (it, i) { return i < pos && !it.ms && it.need !== name; });
        if (notNeed.length) {
          var s2 = seq.filter(function (it) { return notNeed.indexOf(it) < 0; });
          var p2 = s2.indexOf(first); s2 = s2.slice(0, p2 + 1).concat(notNeed, s2.slice(p2 + 1));
          var g = gainOf(s2);
          if (g > 0) out.push({ kind: 'need', icon: '↓', title: '◆' + name + 'に必要ないもの' + notNeed.length + '件を後ろへ回せます',
            body: notNeed.slice(0, 3).map(function (x) { return '「' + x.label + '」'; }).join('') + (notNeed.length > 3 ? 'ほか' : '') + 'は◆の後でも困らない印です。先に必要なものが済みます。', gain: g, seq: s2 });
        }
        // ◆に必要なのに◆より後ろにある → ◆の手前へ
        seq.forEach(function (it, i) {
          if (i > pos && !it.ms && it.need === name) {
            var s3 = move(seq, i, pos);
            out.push({ kind: 'late', icon: '⚠', title: '「' + it.label + '」は◆' + name + 'に必要なのに、◆より後ろにあります',
              body: '◆の手前に移すと、◆の日付がこの駅のぶんだけ正しくなります（遅く見えるのが本当の日付です）。', gain: 0, warn: true, seq: s3 });
          }
        });
      } else {
        out.push({ kind: 'tag', icon: '◆', title: 'どれが◆' + name + 'に必要か印を付けると、早める並べ方を出せます', body: '駅を押して「必要な◆」を選ぶか、ひな形に印を付けておくと自動で入ります。', gain: 0, info: true });
      }
      // 依頼（返事待ちのある駅）を先頭へ
      var top = seq.findIndex ? seq.findIndex(function (x) { return !x.ms; }) : 0;
      seq.forEach(function (it, i) {
        if (!it.ms && it.wait > 0 && i > top) {
          var s4 = move(seq, i, top), g4 = gainOf(s4);
          if (g4 > 0) out.push({ kind: 'wait', icon: '⏳', title: '「' + it.label + '」を先に出しましょう',
            body: '返事まで' + it.wait + '日かかる依頼です。先に頼むと、待つ間に別の作業を進められます。', gain: g4, seq: s4 });
        }
      });
    }
    seq.forEach(function (it) {
      if (!it.ms && it.ko > 3) out.push({ kind: 'split', icon: '✂', title: '「' + it.label + '」（' + it.ko + 'h）は分けると入れやすい',
        body: '3hをこえています。2つに分けると、すき間のある日に入ります。', gain: 0, split: it.key });
    });
    out.sort(function (a, b) { return (b.gain || 0) - (a.gain || 0); });
    return out.slice(0, 6);
  }

  var api = { schedule: schedule, hints: hints, parseDetail: parseDetail, composeDetail: composeDetail, isMsTodo: isMsTodo, msName: msName,
    workDiff: workDiff, nextWork: nextWork, addWork: addWork, isWork: isWork, add: add, CAP: CAP };
  if (typeof module !== 'undefined' && module.exports) { module.exports = api; return; }
  global.Kumi = api;

  // =====================================================================
  // 画面
  // =====================================================================
  var T = global.TaskApp;
  if (!T) return;
  var $ = function (id) { return document.getElementById(id); };
  var el = T.el, COLORS = 6;
  var km = null;   // { pj, items, order(keys), template, tmpls, undo:[], openKey, base }

  function colorOf(parent) { var h = 0; for (var i = 0; i < parent.length; i++) h = (h * 31 + parent.charCodeAt(i)) >>> 0; return 'l' + (h % COLORS + 1); }
  function splitTodo(todo) { var i = todo.indexOf(' | '); return i > 0 ? { parent: todo.slice(0, i), child: todo.slice(i + 3) } : { parent: '', child: todo }; }
  var newSeq = 0;

  function open(pj) {
    var all = T.pjTasks() || [], today = T.today();
    var mine = all.filter(function (t) { return t.pj === pj && !t.arc; });
    var items = mine.map(function (t) {
      var d = parseDetail(t.detail), sp = splitTodo(t.todo), ms = isMsTodo(t.todo);
      return { key: t.no + '|' + t.todo, no: t.no, todo: t.todo, parent: ms ? '◆' : (sp.parent || 'そのほか'), child: ms ? msName(t.todo) : sp.child,
        ko: t.ko == null ? 0.5 : t.ko, date: t.date, done: t.done, ms: ms, pre: t.pre, link: /⛓/.test(t.detail),
        ex0: d.ex, ex: d.ex, need0: d.need, need: d.need, wait0: d.wait, wait: d.wait, base: d.base, ko0: t.ko == null ? 0.5 : t.ko, child0: ms ? msName(t.todo) : sp.child, parent0: ms ? '◆' : (sp.parent || 'そのほか') };
    });
    // 並び：済んでいない駅を📅順（📅なしは後ろ）。◆は同じ日の最後
    var live = items.filter(function (x) { return !x.done && !x.ex; }).sort(function (a, b) {
      var x = a.date || '9999', y = b.date || '9999'; if (x !== y) return x < y ? -1 : 1; if (a.ms !== b.ms) return a.ms ? 1 : -1; return (a.no || 0) - (b.no || 0);
    });
    // ほかの案件ですでに埋まっている時間
    var base = {};
    all.forEach(function (t) { if (t.pj !== pj && !t.done && !t.arc && t.date && t.date >= today && !parseDetail(t.detail).ex) base[t.date] = (base[t.date] || 0) + (t.ko || 0); });
    km = { pj: pj, items: items, order: live.map(function (x) { return x.key; }), template: '', tmpls: null, pjTmpl: {}, undo: [], openKey: '', base: base, today: today };
    km.before = sched();
    $('kmTitle').textContent = pj + ' を組み立て';
    $('kmView').hidden = false; $('pjView').hidden = true; $('tabs').hidden = true;
    document.documentElement.classList.add('kmopen');
    T.api('tmplList').then(function (d) { km.tmpls = d.templates || {}; km.pjTmpl = d.pjTemplate || {}; km.template = km.pjTmpl[pj] || ''; drawTmplPick(); draw(); }, function () { km.tmpls = {}; drawTmplPick(); });
    draw();
    window.scrollTo(0, 0);
  }
  function close() {
    km = null; $('kmView').hidden = true; $('kmConf').hidden = true; $('pjView').hidden = false; $('tabs').hidden = false;
    document.documentElement.classList.remove('kmopen');
  }
  function item(key) { for (var i = 0; i < km.items.length; i++) if (km.items[i].key === key) return km.items[i]; return null; }
  function snapshot() { km.undo.push(JSON.stringify({ items: km.items, order: km.order, template: km.template })); if (km.undo.length > 50) km.undo.shift(); }
  function undo() { var s = km.undo.pop(); if (!s) return; var o = JSON.parse(s); km.items = o.items; km.order = o.order; km.template = o.template; km.openKey = ''; draw(); }
  function label(x) { return x.ms ? '◆' + x.child : x.child; }
  function seqOf(order) {
    // 前提（「12.ToDo」）を駅の key に直す
    var byNo = {}; km.items.forEach(function (x) { if (x.no != null) byNo[x.no] = x.key; });
    return order.map(item).filter(Boolean).map(function (x) {
      var m = /^\s*(?:No)?(\d+)/.exec(x.pre || ''), pre = m ? byNo[Number(m[1])] : '';
      if (pre && item(pre) && (item(pre).done)) pre = '';
      return { key: x.key, ko: x.ko, ms: x.ms, msName: x.ms ? x.child : '', need: x.need, wait: x.wait, pre: pre || '', label: label(x) };
    });
  }
  function sched() { return schedule(seqOf(km.order), km.today, km.base); }
  function msList() { return km.items.filter(function (x) { return x.ms && !x.done; }); }
  function tmplSet() {
    var t = km.template && km.tmpls && km.tmpls[km.template]; if (!t) return null;
    var s = {}; t.forEach(function (r) { s[(r.parent || '') + '|' + (r.child || '')] = true; }); return s;
  }

  // ---------- 描く ----------
  function draw() {
    if (!km) return;
    var now = sched(), tset = tmplSet();
    km.now = now;
    var changes = diffOps().length;
    $('kmPill').textContent = changes ? '下書き・変更 ' + changes + '件' : '変更なし';
    $('kmPill').className = 'kmpill' + (changes ? ' draft' : '');
    $('kmApply').disabled = !changes; $('kmUndo').disabled = !km.undo.length;
    // 済んだもの
    var done = km.items.filter(function (x) { return x.done; });
    $('kmDone').textContent = done.length ? '済んだもの ' + done.length + '件（動かしません）' : '';
    // 路線
    var route = $('kmRoute'); route.innerHTML = '';
    var prevParent = null, seg = null;
    km.order.forEach(function (key, idx) {
      var x = item(key); if (!x) return;
      if (x.ms) {
        var ms = el('div', 'kms'); ms.dataset.key = key;
        var g = el('span', 'grip', '⋮⋮'); g.setAttribute('aria-label', '動かす：' + label(x)); ms.appendChild(g);
        ms.appendChild(el('b', '', '◆ ' + x.child));
        var before = km.before.dates[key], after = now.dates[key];
        ms.appendChild(el('span', 'd', (before && before !== after ? T.md(before) + ' → ' : '') + (after ? T.md(after) : '')));
        ms.addEventListener('click', function (e) { if (e.target.classList.contains('grip')) return; toggleEdit(key); });
        route.appendChild(ms); prevParent = null; seg = null;
        if (km.openKey === key) route.appendChild(editor(x));
        return;
      }
      if (x.parent !== prevParent) {
        seg = el('div', 'kseg ' + colorOf(x.parent));
        seg.appendChild(el('div', 'ksegname', x.parent));
        route.appendChild(seg); prevParent = x.parent;
      }
      var st = el('div', 'kst'); st.dataset.key = key;
      var g2 = el('span', 'grip', '⋮⋮'); g2.setAttribute('aria-label', '動かす：' + label(x)); st.appendChild(g2);
      st.appendChild(el('span', 'nm', x.child));
      var tags = el('span', 'tags');
      if (tset && !tset[x.parent + '|' + x.child]) { tags.appendChild(el('span', 'tag irr', '今回だけ')); st.classList.add('irr'); }
      if (x.need) tags.appendChild(el('span', 'tag need', '◆' + x.need));
      if (x.wait) tags.appendChild(el('span', 'tag wait', '⏳' + x.wait + '日'));
      if (x.link) tags.appendChild(el('span', 'tag', '🔗'));
      st.appendChild(tags);
      st.appendChild(el('span', 'h', T.h(x.ko) + ' ・ ' + (now.dates[key] ? T.md(now.dates[key]) : '–')));
      if (!x.isNew && now.dates[key] !== x.date) st.classList.add('moved');
      st.addEventListener('click', function (e) { if (e.target.classList.contains('grip')) return; toggleEdit(key); });
      seg.appendChild(st);
      if (km.openKey === key) seg.appendChild(editor(x));
    });
    if (!km.order.length) route.appendChild(el('p', 'note', 'まだ駅がありません。下の「＋ 駅を足す」か「ひな形から足す」で始めます。'));
    // 外したもの
    var ex = km.items.filter(function (x) { return x.ex && !x.done; });
    var eb = $('kmEx'); eb.innerHTML = ''; $('kmExBox').hidden = !ex.length;
    ex.forEach(function (x) {
      var r = el('div', 'kst exd'); r.appendChild(el('span', 'nm', (x.parent && x.parent !== 'そのほか' ? x.parent + ' | ' : '') + x.child));
      if (tset && tset[x.parent + '|' + x.child]) r.appendChild(el('span', 'tag irr', '今回は外す'));
      var b = el('button', 'btn ghost sm', '戻す'); b.type = 'button';
      b.addEventListener('click', function () { snapshot(); x.ex = false; km.order.push(x.key); draw(); });
      r.appendChild(b); eb.appendChild(r);
    });
    drawHints(); drawResult(now);
  }
  function editor(x) {
    var box = el('div', 'kedit');
    var f = function (lbl, input) { var w = el('label', 'kf'); w.appendChild(el('span', '', lbl)); w.appendChild(input); box.appendChild(w); return input; };
    var nm = f(x.ms ? '◆の名前' : '駅の名前', el('input')); nm.value = x.child; nm.maxLength = 100;
    nm.addEventListener('change', function () { var v = nm.value.trim(); if (!v) { nm.value = x.child; return; } snapshot(); x.child = v; draw(); });
    if (!x.ms) {
      var pr = f('線（親タスク）', el('input')); pr.value = x.parent; pr.setAttribute('list', 'kmParents'); pr.maxLength = 60;
      pr.addEventListener('change', function () { var v = pr.value.trim() || 'そのほか'; snapshot(); x.parent = v; draw(); });
      var ko = f('工（h）', el('input')); ko.type = 'number'; ko.step = '0.25'; ko.min = '0'; ko.max = '24'; ko.inputMode = 'decimal'; ko.value = x.ko;
      ko.addEventListener('change', function () { var v = parseFloat(ko.value); if (!isFinite(v) || v < 0 || v > 24) { ko.value = x.ko; return; } snapshot(); x.ko = v; draw(); });
      var nd = f('必要な◆', el('select'));
      nd.appendChild(new Option('（なし）', ''));
      msList().forEach(function (m) { nd.appendChild(new Option('◆' + m.child, m.child)); });
      if (x.need && !msList().some(function (m) { return m.child === x.need; })) nd.appendChild(new Option('◆' + x.need, x.need));
      nd.value = x.need;
      nd.addEventListener('change', function () { snapshot(); x.need = nd.value; draw(); });
      var wt = f('依頼の返事まで（日）', el('input')); wt.type = 'number'; wt.min = '0'; wt.max = '30'; wt.step = '1'; wt.inputMode = 'numeric'; wt.value = x.wait || 0;
      wt.addEventListener('change', function () { var v = Math.max(0, Math.min(30, parseInt(wt.value, 10) || 0)); snapshot(); x.wait = v; draw(); });
    }
    var row = el('div', 'krow');
    var btn = function (t, cls, fn) { var b = el('button', 'btn sm ' + cls, t); b.type = 'button'; b.addEventListener('click', fn); row.appendChild(b); };
    var i = km.order.indexOf(x.key);
    btn('▲ 前へ', 'ghost', function () { if (i > 0) { snapshot(); km.order.splice(i, 1); km.order.splice(i - 1, 0, x.key); draw(); } });
    btn('▼ 後ろへ', 'ghost', function () { if (i < km.order.length - 1) { snapshot(); km.order.splice(i, 1); km.order.splice(i + 1, 0, x.key); draw(); } });
    if (!x.ms && x.ko > 0.25) btn('✂ 分ける', 'ghost', function () { splitItem(x.key); });
    if (!x.ms) btn(x.isNew ? 'やめる' : '外す', 'danger', function () {
      snapshot(); km.order.splice(km.order.indexOf(x.key), 1);
      if (x.isNew) km.items.splice(km.items.indexOf(x), 1); else x.ex = true;
      km.openKey = ''; draw();
    });
    btn('閉じる', 'ghost', function () { km.openKey = ''; draw(); });
    box.appendChild(row);
    if (x.link) box.appendChild(el('p', 'note', '🔗 工程表のスプシと連動しています。反映すると工程表の日付もそろえます。'));
    return box;
  }
  function toggleEdit(key) { km.openKey = km.openKey === key ? '' : key; draw(); }
  function splitItem(key) {
    var x = item(key); if (!x) return;
    snapshot();
    var half = Math.round(x.ko / 2 * 4) / 4, rest = Math.round((x.ko - half) * 4) / 4;
    var baseName = x.child.replace(/（\d\/2）$/, '');
    x.child = baseName + '（1/2）'; x.ko = half;
    var n = { key: 'new' + (++newSeq), isNew: true, parent: x.parent, child: baseName + '（2/2）', ko: rest, need: x.need, wait: 0, ms: false, base: '', date: '' };
    km.items.push(n); km.order.splice(km.order.indexOf(key) + 1, 0, n.key); km.openKey = ''; draw();
  }
  function drawHints() {
    var box = $('kmHints'); box.innerHTML = '';
    var hs = hints(seqOf(km.order), km.today, km.base);
    if (!hs.length) { box.appendChild(el('p', 'note', 'いまの並びで、早められる所は見つかりませんでした。')); return; }
    hs.forEach(function (h) {
      var r = el('div', 'tip' + (h.warn ? ' warn' : '') + (h.info ? ' info' : ''));
      r.appendChild(el('span', 'ic', h.icon));
      var tx = el('div', 'tx'); tx.appendChild(el('b', '', h.title)); tx.appendChild(el('span', '', h.body));
      if (h.gain > 0) tx.appendChild(el('span', 'eff', '試すと ◆ が' + h.gain + '日早まる見込み'));
      r.appendChild(tx);
      if (h.seq || h.split) {
        var b = el('button', 'btn sm', h.split ? '分ける' : '試す'); b.type = 'button';
        b.addEventListener('click', function () {
          if (h.split) { splitItem(h.split); return; }
          snapshot(); km.order = h.seq.map(function (x) { return x.key; }); draw(); T.toast('下書きに入れました（「元に戻す」で戻せます）');
        });
        r.appendChild(b);
      }
      box.appendChild(r);
    });
  }
  function drawResult(now) {
    var box = $('kmMs'); box.innerHTML = '';
    var ms = msList();
    if (!ms.length) box.appendChild(el('p', 'note', '◆（成果）がまだありません。「＋ ◆を足す」で入れると、日付の変化が出ます。'));
    ms.forEach(function (m) {
      var b0 = km.before.dates[m.key], b1 = now.dates[m.key];
      var r = el('div', 'res'); r.appendChild(el('span', '', '◆ ' + m.child));
      if (b0 && b1 && b0 !== b1) r.appendChild(el('span', 'was', T.md(b0)));
      r.appendChild(el('span', 'big', b1 ? T.md(b1) : '–'));
      var g = b0 && b1 ? workDiff(b1, b0) : 0;
      if (g > 0) r.appendChild(el('span', 'gain', g + '日早まる'));
      if (g < 0) r.appendChild(el('span', 'loss', -g + '日おそくなる'));
      box.appendChild(r);
    });
    // 1日の工（この先の稼働日10日）
    var lb = $('kmLoad'), ll = $('kmLoadLbl'); lb.innerHTML = ''; ll.innerHTML = '';
    var d = nextWork(km.today);
    for (var i = 0; i < 10; i++) {
      var mine = 0; km.order.forEach(function (k) { var x = item(k); if (x && !x.ms && now.dates[k] === d) mine += x.ko; });
      var other = km.base[d] || 0, bar = el('div', 'lbar');
      var o = el('i', 'other'); o.style.height = Math.min(100, other / 7 * 100) + '%';
      var mi = el('i', 'mine'); mi.style.height = Math.min(100 - Math.min(100, other / 7 * 100), mine / 7 * 100) + '%';
      bar.appendChild(mi); bar.appendChild(o); bar.title = T.md(d) + '：この案件 ' + mine + 'h／ほか ' + other + 'h';
      lb.appendChild(bar); ll.appendChild(el('span', '', T.md(d).split('/')[1] + T.dow(d)));
      d = nextWork(add(d, 1));
    }
  }

  // ---------- 足す・ひな形 ----------
  function drawTmplPick() {
    var s = $('kmTmplSel'); s.innerHTML = '';
    s.appendChild(new Option('ひな形から足す…', ''));
    Object.keys(km && km.tmpls || {}).forEach(function (n) { s.appendChild(new Option(n + '（' + km.tmpls[n].length + '）', n)); });
    var dl = $('kmParents'); dl.innerHTML = '';
    var seen = {}; (km ? km.items : []).forEach(function (x) { if (!x.ms && !seen[x.parent]) { seen[x.parent] = 1; dl.appendChild(new Option(x.parent)); } });
  }
  function addFromTmpl(name) {
    var t = km.tmpls[name]; if (!t) return;
    snapshot();
    var have = {}; km.items.forEach(function (x) { have[x.parent + '|' + x.child] = true; });
    var n = 0;
    t.forEach(function (r) {
      var ms = r.parent === '◆';
      if (have[(ms ? '◆' : r.parent) + '|' + r.child]) return;
      var it = { key: 'new' + (++newSeq), isNew: true, ms: ms, parent: ms ? '◆' : (r.parent || 'そのほか'), child: r.child, ko: ms ? 0 : (r.ko == null ? 0.5 : r.ko), need: r.need || '', wait: r.wait || 0, base: r.memo || '', date: '' };
      km.items.push(it); km.order.push(it.key); n++;
    });
    km.template = name;
    T.toast(n ? 'ひな形「' + name + '」から ' + n + '件を足しました（下書き）' : 'ひな形の駅はもう全部あります');
    draw();
  }
  function addNew(ms) {
    snapshot();
    var lastParent = ''; for (var i = km.order.length - 1; i >= 0; i--) { var x = item(km.order[i]); if (x && !x.ms) { lastParent = x.parent; break; } }
    var it = { key: 'new' + (++newSeq), isNew: true, ms: !!ms, parent: ms ? '◆' : (lastParent || 'そのほか'), child: ms ? '新しい◆' : '新しい駅', ko: ms ? 0 : 1, need: '', wait: 0, base: '', date: '' };
    km.items.push(it); km.order.push(it.key); km.openKey = it.key; draw();
    setTimeout(function () { var inp = document.querySelector('.kedit input'); if (inp) { inp.focus(); inp.select(); } }, 30);
  }
  var tmplStep = 0;
  function saveTmpl() {
    var box = $('kmTmplSave'); box.hidden = false;
    $('kmTmplName').value = km.lastTmpl || km.template || km.pj.replace(/^[^\w぀-鿿]+/, '');
    tmplStep = 0; $('kmTmplAsk').innerHTML = '';
  }
  function doSaveTmpl(overwrite) {
    var name = $('kmTmplName').value.trim(); if (!name) { T.toast('ひな形の名前を入れてください', true); return; }
    var rows = [];
    km.order.concat(km.items.filter(function (x) { return x.done; }).map(function (x) { return x.key; })).forEach(function (k) {
      var x = item(k); if (!x || rows.some(function (r) { return r._k === k; })) return;
      rows.push({ _k: k, parent: x.ms ? '◆' : x.parent, child: x.child, ko: x.ms ? '' : x.ko, need: x.need || '', wait: x.wait || '' });
    });
    if ($('kmTmplEx').checked) km.items.filter(function (x) { return x.ex; }).forEach(function (x) { rows.push({ parent: x.parent, child: x.child, ko: x.ko, need: x.need || '', wait: x.wait || '' }); });
    rows.forEach(function (r) { delete r._k; });
    T.api('tmplSave', { name: name, rows: rows, overwrite: !!overwrite }).then(function (d) {
      T.toast('ひな形「' + name + '」を保存しました（' + d.saved + '件）'); $('kmTmplSave').hidden = true; km.lastTmpl = name;
      return T.api('tmplList').then(function (l) { km.tmpls = l.templates || {}; drawTmplPick(); });
    }, function (e) {
      if (e.code !== 'tmpl_exists') { T.toast(T.errText(e), true); return; }
      var ask = $('kmTmplAsk'); ask.innerHTML = '';
      var go = function (step) {
        ask.innerHTML = '';
        ask.appendChild(el('span', '', step === 1 ? '「' + name + '」はもうあります。上書きしますか？' : 'ほんとに大丈夫？！ 前の「' + name + '」は消えます。'));
        var r = el('div', 'row2');
        var no = el('button', 'btn ghost sm', 'やめる'); no.type = 'button'; no.addEventListener('click', function () { ask.innerHTML = ''; });
        var yes = el('button', 'btn danger sm', step === 1 ? '上書きする' : 'ほんとに上書きする'); yes.type = 'button';
        yes.addEventListener('click', function () { if (step === 1) go(2); else { ask.innerHTML = ''; doSaveTmpl(true); } });
        r.appendChild(no); r.appendChild(yes); ask.appendChild(r);
      };
      go(1);
    });
  }

  // ---------- 反映 ----------
  function diffOps() {
    if (!km) return [];
    var now = km.now || sched(), ops = [];
    km.items.forEach(function (x) {
      if (x.done) return;
      var date = now.dates[x.key];
      var todoNow = x.ms ? '◆' + x.child : (x.parent && x.parent !== 'そのほか' ? x.parent + ' | ' + x.child : x.child);
      if (x.isNew) {
        if (x.ex) return;
        ops.push({ op: 'add', parent: x.ms ? '' : (x.parent === 'そのほか' ? '' : x.parent), todo: x.ms ? '◆' + x.child : x.child, ko: x.ms ? 0 : x.ko, date: date,
          detail: composeDetail(x.base, x.need, x.wait, false), _label: todoNow });
        return;
      }
      if (x.ex && !x.ex0) { ops.push({ op: 'exclude', no: x.no, todo: x.todo, _label: x.todo }); return; }
      if (x.ex) return;
      if (!x.ex && x.ex0) ops.push({ op: 'restore', no: x.no, todo: x.todo, date: date, _label: x.todo });
      else if (date && date !== x.date) ops.push({ op: 'date', no: x.no, todo: x.todo, date: date, _from: x.date, _label: x.todo });
      var e = { op: 'edit', no: x.no, todo: x.todo, _label: x.todo }, ch = false;
      if (x.child !== x.child0 || x.parent !== x.parent0) { e.newTodo = todoNow; ch = true; }
      if (x.ko !== x.ko0) { e.ko = x.ko; ch = true; }
      if (x.need !== x.need0 || x.wait !== x.wait0) { e.detail = composeDetail(x.base, x.need, x.wait, false); e._mark = (x.need ? '必要な◆：' + x.need : '必要な◆：なし') + (x.wait ? '・依頼の返事まで ' + x.wait + '日' : ''); ch = true; }
      if (ch) ops.push(e);
    });
    return ops;
  }
  var applyStep = 0;
  function openConf() {
    var ops = diffOps(); if (!ops.length) return;
    applyStep = 0;
    var list = $('kmChg'); list.innerHTML = '';
    var KIND = { date: ['移動', 'mv'], add: ['追加', 'add'], exclude: ['外す', 'del'], restore: ['戻す', 'add'], edit: ['直す', 'mv'] };
    ops.forEach(function (o) {
      var r = el('div', 'ci'); r.appendChild(el('span', 'k k-' + KIND[o.op][1], KIND[o.op][0]));
      var tx = el('div'); tx.appendChild(document.createTextNode(o._label));
      var sm = '';
      if (o.op === 'date') sm = '📅 ' + (o._from ? T.md(o._from) : '未定') + ' → ' + T.md(o.date);
      if (o.op === 'add') sm = T.h(o.ko) + ' ・ 📅 ' + (o.date ? T.md(o.date) : '今日');
      if (o.op === 'exclude') sm = '行は消さず、集計から外します（ひな形づくりの材料として残ります）';
      if (o.op === 'restore') sm = '📅 ' + T.md(o.date) + ' で戻します';
      if (o.op === 'edit') sm = [o.newTodo ? '名前 → ' + o.newTodo : '', o.ko !== undefined ? '工 → ' + T.h(o.ko) : '', o._mark ? o._mark : ''].filter(Boolean).join(' ・ ');
      tx.appendChild(el('small', '', sm)); r.appendChild(tx); list.appendChild(r);
    });
    var gain = msList().map(function (m) { var g = workDiff(km.now.dates[m.key], km.before.dates[m.key]); return g ? '◆' + m.child + ' ' + (g > 0 ? g + '日早まる' : -g + '日おそくなる') : ''; }).filter(Boolean);
    $('kmConfGain').textContent = gain.join(' ・ ');
    $('kmConfLead').textContent = '変更点 ' + ops.length + '件（タスク表に書きます' + (km.items.some(function (x) { return x.link; }) ? '。🔗の行は工程表の日付もそろえます' : '') + '）';
    drawApplyAsk();
    $('kmConf').hidden = false; $('kmConf').scrollTop = 0;
  }
  function drawApplyAsk() {
    var ask = $('kmConfAsk'); ask.innerHTML = '';
    if (applyStep === 2) ask.appendChild(el('p', 'warnline', 'ほんとに大丈夫？！ タスク表の📅・名前が書き換わります（完了済みは動かしません）。'));
    var r = el('div', 'row2');
    var no = el('button', 'btn ghost', '戻って直す'); no.type = 'button'; no.addEventListener('click', function () { $('kmConf').hidden = true; });
    var yes = el('button', 'btn' + (applyStep === 2 ? ' danger' : ''), applyStep === 2 ? 'ほんとに反映する' : '反映する'); yes.type = 'button';
    yes.addEventListener('click', function () {
      if (applyStep < 2) { applyStep = 2; drawApplyAsk(); return; }
      yes.disabled = true; yes.textContent = '反映中…';
      var ops = diffOps().map(function (o) { var c = {}; for (var k in o) if (k.charAt(0) !== '_') c[k] = o[k]; return c; });
      T.api('kumitate', { reqId: T.reqId(), pj: km.pj, template: km.template || undefined, ops: ops }).then(function (d) {
        T.toast('反映しました（' + (d.changed + d.added) + '件' + (d.koutei ? '・工程表 ' + d.koutei + '件' : '') + (d.kouteiSkipped ? '・工程表で書けなかった所 ' + d.kouteiSkipped + '件' : '') + '）');
        var pj = km.pj; close(); T.refreshPj(pj);
      }, function (e) { T.toast(T.errText(e) + (e.detail ? '：' + e.detail : ''), true); applyStep = 0; drawApplyAsk(); });
    });
    r.appendChild(no); r.appendChild(yes); ask.appendChild(r);
  }

  // ---------- 指で動かす（⋮⋮ をつまむ） ----------
  var drag = null;
  function onDown(e) {
    var g = e.target.closest && e.target.closest('.grip'); if (!g || !km) return;
    var node = g.closest('[data-key]'); if (!node) return;
    e.preventDefault();
    drag = { key: node.dataset.key, node: node, startY: e.clientY, line: el('div', 'kdrop') };
    node.classList.add('lift'); node.setPointerCapture && g.setPointerCapture && g.setPointerCapture(e.pointerId);
  }
  function targetIndex(y) {
    var nodes = Array.prototype.slice.call($('kmRoute').querySelectorAll('[data-key]'));
    for (var i = 0; i < nodes.length; i++) { var r = nodes[i].getBoundingClientRect(); if (y < r.top + r.height / 2) return { i: i, node: nodes[i], before: true }; }
    return { i: nodes.length, node: nodes[nodes.length - 1], before: false };
  }
  function onMove(e) {
    if (!drag) return;
    e.preventDefault();
    drag.node.style.transform = 'translateY(' + (e.clientY - drag.startY) + 'px)';
    var t = targetIndex(e.clientY); drag.t = t;
    if (t.node) { if (t.before) t.node.parentNode.insertBefore(drag.line, t.node); else t.node.parentNode.insertBefore(drag.line, t.node.nextSibling); }
  }
  function onUp() {
    if (!drag) return;
    var d = drag; drag = null;
    if (d.line.parentNode) d.line.parentNode.removeChild(d.line);
    d.node.style.transform = ''; d.node.classList.remove('lift');
    if (!d.t) return;
    var keys = Array.prototype.slice.call($('kmRoute').querySelectorAll('[data-key]')).map(function (n) { return n.dataset.key; });
    var target = d.t.i < keys.length ? keys[d.t.i] : null;
    if (target === d.key) return;
    snapshot();
    var from = km.order.indexOf(d.key); km.order.splice(from, 1);
    var to = target ? km.order.indexOf(target) : km.order.length;
    km.order.splice(to < 0 ? km.order.length : to, 0, d.key);
    draw();
  }

  // ---------- つなぐ ----------
  $('kmRoute').addEventListener('pointerdown', onDown);
  document.addEventListener('pointermove', onMove, { passive: false });
  document.addEventListener('pointerup', onUp);
  document.addEventListener('pointercancel', onUp);
  $('kmUndo').addEventListener('click', function () { if (km) undo(); });
  $('kmCancel').addEventListener('click', function () { close(); });
  $('kmApply').addEventListener('click', openConf);
  $('kmAdd').addEventListener('click', function () { addNew(false); });
  $('kmAddMs').addEventListener('click', function () { addNew(true); });
  $('kmTmplSel').addEventListener('change', function () { var n = this.value; this.value = ''; if (n) addFromTmpl(n); });
  $('kmTmplBtn').addEventListener('click', saveTmpl);
  $('kmTmplGo').addEventListener('click', function () { doSaveTmpl(false); });
  $('kmTmplCancel').addEventListener('click', function () { $('kmTmplSave').hidden = true; });
  global.KumiUI = { open: open, close: close, isOpen: function () { return !!km; } };
})(typeof window !== 'undefined' ? window : this);
