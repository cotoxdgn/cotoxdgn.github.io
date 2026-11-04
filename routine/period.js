/* ルーティン：生理の記録と次の予定日の計算（画面に関係しない部分。node の単体テストからも読む）
 *
 * レコード（シート app=routine）
 *   id = period-YYYYMMDD（始まった日）  data = { kind:'period', start:'YYYY-MM-DD', end:'YYYY-MM-DD'（空＝記録中）, at }
 *   始まった日を直したときは、古い id を消して新しい id で作る。
 *
 * 決め方
 *   周期＝前回始まった日から今回始まった日までの日数。15日より短い・60日より長い周期は平均に入れない（一覧には残す）
 *   次の予定日＝最後に始まった日＋直近の周期（最大6回）の平均（四捨五入）
 *     記録0回＝出さない／1回（または平均に入れる周期がない）＝仮に28日／2回以上＝平均
 *   うすく塗る日数＝これまでの日数（始まった日〜終わった日）の平均（終わった日がある回だけ。なければ5日）
 *   予定日を過ぎてもまだ始まっていないときは、予定日から14日までは出したまま。それより過ぎたら出さない
 *   記録中のまま10日たったら「終わった日を入れてください」。そのあいだカレンダーは平均の日数までを塗る
 */
(function (global) {
  'use strict';
  var MIN_CYCLE = 15, MAX_CYCLE = 60, RECENT = 6, TEMP_CYCLE = 28, DEFAULT_LEN = 5, KEEP_PAST = 14, FORGOT_DAYS = 10;

  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function ymd(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function parse(s) { var p = String(s).split('-'); return new Date(+p[0], +p[1] - 1, +p[2]); }
  function addDays(s, n) { var d = parse(s); d.setDate(d.getDate() + n); return ymd(d); }
  function diff(a, b) { return Math.round((parse(b) - parse(a)) / 864e5); }
  function idOf(start) { return 'period-' + String(start).replace(/-/g, ''); }
  var YMD = /^\d{4}-\d{2}-\d{2}$/;

  // スプシの行 → 始まった日の古い順 [{ id, s, e }]
  function build(list) {
    var out = [];
    (list || []).forEach(function (r) {
      var d = r && r.data;
      if (!d || d.kind !== 'period' || !YMD.test(d.start || '')) return;
      out.push({ id: r.id, s: d.start, e: YMD.test(d.end || '') && d.end >= d.start ? d.end : '' });
    });
    out.sort(function (a, b) { return a.s < b.s ? -1 : a.s > b.s ? 1 : 0; });
    return out;
  }

  function avg(a) { return a.length ? Math.round(a.reduce(function (x, y) { return x + y; }, 0) / a.length) : null; }

  // recs：build の結果、today：今日（3時区切り）
  function calc(recs, today) {
    var p = (recs || []).slice(), cycles = [], used = [], lens = [];
    for (var i = 1; i < p.length; i++) {
      var c = diff(p[i - 1].s, p[i].s), ok = c >= MIN_CYCLE && c <= MAX_CYCLE;
      cycles.push({ from: p[i - 1].s, to: p[i].s, days: c, used: ok });
      if (ok) used.push(c);
    }
    p.forEach(function (r) { if (r.e) lens.push(diff(r.s, r.e) + 1); });
    var recent = used.slice(-RECENT);
    var len = avg(lens) || DEFAULT_LEN;
    var last = p.length ? p[p.length - 1] : null;
    var cycle = null, basis = '', temp = false;
    if (recent.length) { cycle = avg(recent); basis = '直近' + recent.length + '回の平均'; }
    else if (p.length) { cycle = TEMP_CYCLE; temp = true; basis = '仮（28日で計算）'; }
    var ongoing = !!(last && !last.e && last.s <= today);
    var forgot = ongoing && diff(last.s, today) >= FORGOT_DAYS;
    var next = last && cycle ? addDays(last.s, cycle) : null;
    var late = next ? diff(next, today) : 0;   // 予定日から何日過ぎたか（0以下＝まだ）
    if (next && late > KEEP_PAST) next = null;
    return { list: p, cycles: cycles, recent: recent, cycle: cycle, temp: temp, basis: basis, len: len, lensN: lens.length,
      last: last, ongoing: ongoing, forgot: forgot, next: next, late: next ? late : 0, today: today };
  }

  // その回を塗る最後の日
  function endOf(r, pc) {
    if (r.e) return r.e;
    if (pc.last && r.s === pc.last.s && pc.ongoing && !pc.forgot) return pc.today;
    return addDays(r.s, pc.len - 1);   // 押し忘れ（10日以上）・古い回の書き忘れ
  }
  // その日が生理なら { r, n（○日目） }
  function dayOf(ds, pc) {
    for (var i = pc.list.length - 1; i >= 0; i--) {
      var r = pc.list[i];
      if (ds >= r.s && ds <= endOf(r, pc)) return { r: r, n: diff(r.s, ds) + 1 };
    }
    return null;
  }
  // その日が次の予定日（予測）の範囲か
  function predicted(ds, pc) {
    return !!(pc.next && ds >= pc.next && ds <= addDays(pc.next, pc.len - 1) && !dayOf(ds, pc));
  }

  var api = {
    MIN_CYCLE: MIN_CYCLE, MAX_CYCLE: MAX_CYCLE, RECENT: RECENT, TEMP_CYCLE: TEMP_CYCLE, DEFAULT_LEN: DEFAULT_LEN, KEEP_PAST: KEEP_PAST, FORGOT_DAYS: FORGOT_DAYS,
    build: build, calc: calc, endOf: endOf, dayOf: dayOf, predicted: predicted, idOf: idOf,
    ymd: ymd, parse: parse, addDays: addDays, diff: diff
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else global.RoutinePeriod = api;
})(typeof window !== 'undefined' ? window : globalThis);
