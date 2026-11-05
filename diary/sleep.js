/* ルーティン：睡眠の計算（画面に関係しない部分。node の単体テストからも読む）
 *
 * レコード（シート app=routine）
 *   自動で届く分：id = sleep-YYYYMMDD     data = { kind:'sleep', date, samples:[{s,e,v}], receivedAt }（GAS の sleepPut が書く）
 *   手で直した分：id = sleepfix-YYYYMMDD  data = { kind:'sleepfix', date, bed, wake, at } ／ 消した日は { kind:'sleepfix', date, removed:true, at }
 *   目標　　　　：id = sleep-goal         data = { kind:'sleepgoal', history:[{ from:'YYYY-MM-DD', wake, bed, sleepLen, band }], hol:[0,3] }
 * 時刻は「分」で持つ。wake＝その日の0:00からの分（7:15 → 435）、bed＝前の日の0:00からの分（24:00 → 1440、0:12 → 1452、23:40 → 1420）。
 * sleepLen＝眠った長さの目標（分・これ以上なら目標内）、band＝目標内とみなす幅（±分）。
 * 各日の差は、その日に有効だった目標（from がその日以前で一番新しいもの）で出す。
 */
(function (global) {
  'use strict';
  var GAP_MIN = 60;          // これ未満の中断はひと続きの睡眠とみなす
  var CUT_HOUR = 15;         // 見る範囲：前の日の15:00〜その日の15:00 に始まった記録
  var DEFAULT_GOAL = { from: '2000-01-01', wake: 7 * 60 + 15, bed: 24 * 60, sleepLen: 7 * 60, band: 15 };
  var DEFAULT_HOL = [3, 0];  // 水・日

  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function ymd(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function parse(s) { var p = String(s).split('-'); return new Date(+p[0], +p[1] - 1, +p[2]); }
  function addDays(s, n) { var d = parse(s); d.setDate(d.getDate() + n); return ymd(d); }
  function compact(s) { return String(s).replace(/-/g, ''); }

  // 記録の種類：asleep（睡眠中・コア・深い・レム）／ awake（覚醒）／ inbed（入床）
  function classify(v) {
    var t = String(v == null ? '' : v).trim();
    if (/覚醒|起きて|awake|^2$/i.test(t)) return 'awake';
    if (/入床|ベッド|in ?bed|^0$/i.test(t)) return 'inbed';
    return 'asleep';
  }

  // 区間 [s,e]（ミリ秒）を重なり・接しているものでまとめる
  function union(iv) {
    var a = iv.filter(function (x) { return x[1] > x[0]; }).sort(function (x, y) { return x[0] - y[0]; });
    var out = [];
    a.forEach(function (x) {
      var l = out[out.length - 1];
      if (l && x[0] <= l[1]) l[1] = Math.max(l[1], x[1]);
      else out.push([x[0], x[1]]);
    });
    return out;
  }
  // a から b（どちらもまとめ済み）を引く
  function subtract(a, b) {
    var out = [];
    a.forEach(function (x) {
      var parts = [[x[0], x[1]]];
      b.forEach(function (y) {
        var next = [];
        parts.forEach(function (p) {
          if (y[1] <= p[0] || y[0] >= p[1]) { next.push(p); return; }
          if (y[0] > p[0]) next.push([p[0], y[0]]);
          if (y[1] < p[1]) next.push([y[1], p[1]]);
        });
        parts = next;
      });
      out = out.concat(parts);
    });
    return out.filter(function (x) { return x[1] > x[0]; });
  }

  // date（起きた日）の夜の睡眠：{ bedAt, wakeAt（ミリ秒）, bed, wake, len（分）, source:'asleep'|'inbed' } か null
  function night(samples, date) {
    var d0 = parse(date);
    var from = new Date(d0.getFullYear(), d0.getMonth(), d0.getDate() - 1, CUT_HOUR).getTime();
    var to = new Date(d0.getFullYear(), d0.getMonth(), d0.getDate(), CUT_HOUR).getTime();
    var groups = { asleep: [], awake: [], inbed: [] };
    (samples || []).forEach(function (x) {
      if (!x) return;
      var s = Date.parse(x.s), e = Date.parse(x.e);
      if (isNaN(s) || isNaN(e) || e <= s || s < from || s >= to) return;
      groups[classify(x.v)].push([s, e]);
    });
    var source = groups.asleep.length ? 'asleep' : 'inbed';
    var base = union(groups[source]);
    if (!base.length) return null;
    var sleep = subtract(base, union(groups.awake));
    if (!sleep.length) return null;
    // 60分未満の中断をつないで塊にし、いちばん長い塊を夜の睡眠とする
    var blocks = [];
    sleep.forEach(function (x) {
      var l = blocks[blocks.length - 1];
      if (l && x[0] - l[1] < GAP_MIN * 60000) l[1] = Math.max(l[1], x[1]);
      else blocks.push([x[0], x[1]]);
    });
    var best = blocks[0];
    blocks.forEach(function (b) { if (b[1] - b[0] > best[1] - best[0]) best = b; });
    var prev0 = new Date(d0.getFullYear(), d0.getMonth(), d0.getDate() - 1).getTime();
    var bed = Math.round((best[0] - prev0) / 60000);
    var wake = Math.round((best[1] - d0.getTime()) / 60000);
    return { bedAt: best[0], wakeAt: best[1], bed: bed, wake: wake, len: wake + 1440 - bed, source: source };
  }

  // 目標
  function normGoal(g) {
    return { from: g.from || DEFAULT_GOAL.from, wake: num(g.wake, DEFAULT_GOAL.wake), bed: num(g.bed, DEFAULT_GOAL.bed),
      sleepLen: num(g.sleepLen, DEFAULT_GOAL.sleepLen), band: num(g.band, DEFAULT_GOAL.band) };
  }
  function num(v, d) { return typeof v === 'number' && isFinite(v) ? v : d; }
  function history(goalData) {
    var h = goalData && Array.isArray(goalData.history) ? goalData.history.map(normGoal) : [];
    h.sort(function (a, b) { return a.from < b.from ? -1 : a.from > b.from ? 1 : 0; });
    return h.length ? h : [normGoal(DEFAULT_GOAL)];
  }
  function goalOn(hist, date) {
    var g = hist[0];
    hist.forEach(function (x) { if (x.from <= date) g = x; });
    return g;
  }
  // 目標を変える：today から新しい目標。初めて変えるときは、それより前の日のために今の目標（既定）も残す
  function setGoal(goalData, today, g) {
    var hist = goalData && Array.isArray(goalData.history) && goalData.history.length ? history(goalData) : [normGoal(DEFAULT_GOAL)];
    var cur = goalOn(hist, today);
    var next = normGoal({ from: today, wake: g.wake, bed: g.bed, sleepLen: g.sleepLen, band: g.band });
    var same = cur.wake === next.wake && cur.bed === next.bed && cur.sleepLen === next.sleepLen && cur.band === next.band;
    var kept = hist.filter(function (x) { return x.from < today; });
    var out = same ? hist : kept.concat([next]);
    return { kind: 'sleepgoal', history: out, hol: g.hol || (goalData && goalData.hol) || DEFAULT_HOL.slice() };
  }

  // 1日分の値（直した値を優先）。r = { date, auto:{bed,wake,len}|null, fix:data|null }
  function effective(auto, fix) {
    if (fix && fix.removed) return null;
    if (fix && typeof fix.bed === 'number' && typeof fix.wake === 'number') {
      return { bed: fix.bed, wake: fix.wake, len: fix.wake + 1440 - fix.bed, fixed: true };
    }
    if (auto) return { bed: auto.bed, wake: auto.wake, len: auto.len, fixed: false, receivedAt: auto.receivedAt };
    return null;
  }
  function judge(v, g) {
    var dw = v.wake - g.wake, db = v.bed - g.bed, dl = v.len - g.sleepLen;
    return { dWake: dw, dBed: db, dLen: dl, okWake: Math.abs(dw) <= g.band, okBed: Math.abs(db) <= g.band, okLen: dl >= 0,
      all: Math.abs(dw) <= g.band && Math.abs(db) <= g.band && dl >= 0 };
  }

  // routine のレコード一覧 → { days: { 'YYYY-MM-DD': {auto, fix, value} }, goalData }
  function build(list) {
    var autos = {}, fixes = {}, goalData = null, samplesByDate = {};
    (list || []).forEach(function (r) {
      var d = r && r.data;
      if (!d) return;
      if (d.kind === 'sleep' && d.date) { samplesByDate[d.date] = d; }
      else if (d.kind === 'sleepfix' && d.date) fixes[d.date] = d;
      else if (d.kind === 'sleepgoal' && r.id === 'sleep-goal') goalData = d;
    });
    // 届いた日ごとに計算する。前後の日に届いた記録にその日の分が入っていることもあるので、前後もまとめて見る（同じ記録は1つに）
    Object.keys(samplesByDate).forEach(function (ds) {
      var pool = [], seen = {};
      [addDays(ds, -1), ds, addDays(ds, 1)].forEach(function (k) {
        var rec = samplesByDate[k];
        if (!rec || !Array.isArray(rec.samples)) return;
        rec.samples.forEach(function (x) {
          var key = x && (x.s + '|' + x.e + '|' + x.v);
          if (!key || seen[key]) return;
          seen[key] = 1; pool.push(x);
        });
      });
      var n = night(pool, ds);
      if (n) n.receivedAt = samplesByDate[ds].receivedAt || '';
      autos[ds] = n;
    });
    var days = {};
    Object.keys(autos).concat(Object.keys(fixes)).forEach(function (ds) {
      if (days[ds]) return;
      var a = autos[ds] || null, f = fixes[ds] || null;
      if (!a && !f) return;
      days[ds] = { auto: a, fix: f, value: effective(a, f) };
    });
    return { days: days, goalData: goalData };
  }

  // 「24:00は0:00と入れる」。15:00より前は日付が変わった後として扱う
  function bedFromInput(v) { var m = minOf(v); return m < CUT_HOUR * 60 ? m + 1440 : m; }
  function minOf(v) { var p = String(v).split(':'); return +p[0] * 60 + +p[1]; }
  function toInput(m) { m = ((Math.round(m) % 1440) + 1440) % 1440; return pad(Math.floor(m / 60)) + ':' + pad(m % 60); }
  function clock(m) { m = ((Math.round(m) % 1440) + 1440) % 1440; return Math.floor(m / 60) + ':' + pad(m % 60); }
  function bedClock(m) { return Math.round(m) === 1440 ? '24:00' : clock(m); }
  function lenText(m) { m = Math.round(m); return Math.floor(m / 60) + '時間' + (m % 60 ? (m % 60) + '分' : ''); }
  function diffText(d) { d = Math.round(d); return d === 0 ? 'ぴったり' : Math.abs(d) + '分' + (d > 0 ? 'おそい' : '早い'); }
  function lenDiffText(d) { d = Math.round(d); return d >= 0 ? (d === 0 ? 'ちょうど' : lenText(d).replace(/^0時間/, '') + '長い') : lenText(-d).replace(/^0時間/, '') + 'たりない'; }

  var api = {
    GAP_MIN: GAP_MIN, CUT_HOUR: CUT_HOUR, DEFAULT_GOAL: DEFAULT_GOAL, DEFAULT_HOL: DEFAULT_HOL,
    classify: classify, union: union, subtract: subtract, night: night,
    history: history, goalOn: goalOn, setGoal: setGoal, effective: effective, judge: judge, build: build,
    bedFromInput: bedFromInput, minOf: minOf, toInput: toInput, clock: clock, bedClock: bedClock,
    lenText: lenText, diffText: diffText, lenDiffText: lenDiffText,
    ymd: ymd, parse: parse, addDays: addDays, compact: compact
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else global.RoutineSleep = api;
})(typeof window !== 'undefined' ? window : globalThis);
