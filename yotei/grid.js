/* 予定合わせ：マス目の共通部品（自分用 /yotei/ と相手用 /yotei/a/ の両方で使う）
 * 時刻はすべて日本時間で扱う（端末の時間帯の設定に左右されないよう、+09:00 で計算する）。
 * マスは「1日1本の 0/1 文字列」。日 d（0〜）・行 r（0〜）のマスを 'd-r' のキーで持つ。
 */
(function (global) {
  'use strict';
  var WD = ['日', '月', '火', '水', '木', '金', '土'];
  var DAY = 86400000, JST = 9 * 3600000;

  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function dayMs(ymd) { return Date.parse(ymd + 'T00:00:00+09:00'); }
  function jstDate(ms) { return new Date(ms + JST); }
  function ymdOf(ms) { return jstDate(ms).toISOString().slice(0, 10); }
  function addDays(ymd, n) { return ymdOf(dayMs(ymd) + n * DAY + 3600000); }
  function today() { return ymdOf(Date.now()); }
  function diffDays(a, b) { return Math.round((dayMs(b) - dayMs(a)) / DAY); }
  function info(ymd) { var t = jstDate(dayMs(ymd)); return { m: t.getUTCMonth() + 1, d: t.getUTCDate(), w: t.getUTCDay() }; }
  function label(ymd) { var x = info(ymd); return x.m + '/' + x.d + '(' + WD[x.w] + ')'; }
  function hm(min) { return Math.floor(min / 60) + ':' + pad(min % 60); }
  function hmPad(min) { return pad(Math.floor(min / 60)) + ':' + pad(min % 60); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

  // 予定合わせの形：日付の一覧・1日のマス数
  function shape(ev) {
    var n = diffDays(ev.start, ev.end) + 1, dates = [];
    for (var i = 0; i < n; i++) dates.push(addDays(ev.start, i));
    return { days: n, rows: (ev.to - ev.from) * 60 / ev.step, dates: dates };
  }
  function rowMin(ev, r) { return ev.from * 60 + r * ev.step; }
  // マスの始まり・終わり（ミリ秒）
  function cellRange(ev, sh, d, r) { var s = dayMs(sh.dates[d]) + rowMin(ev, r) * 60000; return [s, s + ev.step * 60000]; }
  // 日本時間の ISO（カレンダーに入れるとき用）
  function iso(ymd, min) { return ymd + 'T' + hmPad(min) + ':00+09:00'; }
  // 期間の表示（11/9(月)〜11/15(日)　9:00〜21:00）
  function periodText(ev) { return label(ev.start) + '〜' + label(ev.end); }
  function hoursText(ev) { return hm(ev.from * 60) + '〜' + hm(ev.to * 60); }
  function rangeText(startIso, endIso) {
    var s = Date.parse(startIso), e = Date.parse(endIso);
    var sm = Math.round((s - dayMs(ymdOf(s))) / 60000), em = Math.round((e - dayMs(ymdOf(s))) / 60000);
    return label(ymdOf(s)) + ' ' + hm(sm) + '〜' + hm(em);
  }

  function toSet(strings) {
    var o = {};
    (strings || []).forEach(function (s, d) { for (var r = 0; r < String(s).length; r++) if (s.charAt(r) === '1') o[d + '-' + r] = 1; });
    return o;
  }
  function toStrings(set, sh) {
    var out = [];
    for (var d = 0; d < sh.days; d++) { var s = ''; for (var r = 0; r < sh.rows; r++) s += set[d + '-' + r] ? '1' : '0'; out.push(s); }
    return out;
  }
  function on(strings, d, r) { return !!(strings && strings[d] && strings[d].charAt(r) === '1'); }
  function count(set) { return Object.keys(set).length; }

  // 表示する日（1ページ perPage 日）
  function pageDays(sh, page, perPage) {
    var out = [];
    for (var i = page * perPage; i < Math.min(sh.days, (page + 1) * perPage); i++) out.push(i);
    return out;
  }
  function pages(sh, perPage) { return Math.max(1, Math.ceil(sh.days / perPage)); }

  function heatColor(n, total) {
    if (!n) return '';
    return 'background-color:color-mix(in srgb, var(--heat) ' + Math.round(14 + 78 * n / total) + '%, var(--heat-0));';
  }

  /* マス目を描く
   * o = { ev, sh, days:[日の番号], mode:'paint'|'heat', set（paint：塗ったマス）, busy（paint：予定ありのマス）,
   *       countAt(d,r)（heat）, total, pickAt(d,r) → ' p0'/' p1'/'' , sel:[d,r], rowH } */
  function draw(el, o) {
    var ev = o.ev, sh = o.sh, n = sh.rows, h = o.rowH || (ev.step === 60 ? 30 : 19);
    el.style.gridTemplateColumns = (o.timeW || 38) + 'px repeat(' + o.days.length + ', minmax(0, 1fr))';
    el.classList.toggle('heat', o.mode === 'heat');
    var out = ['<div></div>'];
    o.days.forEach(function (d) {
      var x = info(sh.dates[d]);
      out.push('<div class="hd' + (x.w === 0 || x.w === 6 ? ' we' : '') + '"><b>' + x.m + '/' + x.d + '</b>' + WD[x.w] + '</div>');
    });
    for (var r = 0; r < n; r++) {
      var min = rowMin(ev, r), isHr = min % 60 === 0;
      out.push('<div class="tm" style="height:' + h + 'px">' + (isHr ? hm(min) : '') + '</div>');
      o.days.forEach(function (d, i) {
        var k = d + '-' + r, cls = 'c' + (isHr ? ' hr' : '') + (i === o.days.length - 1 ? ' last' : '') + (r === n - 1 ? ' end' : ''), st = '', extra = '';
        if (o.mode === 'paint') {
          if (o.busy && o.busy[k]) cls += ' busy';
          if (o.set[k]) cls += ' on';
        } else {
          var c = o.countAt(d, r);
          st = heatColor(c, o.total);
          extra = ' data-n="' + c + '"';
          if (o.pickAt) cls += o.pickAt(d, r);
          if (o.sel && o.sel[0] === d && o.sel[1] === r) cls += ' sel';
        }
        out.push('<div class="' + cls + '" data-d="' + d + '" data-r="' + r + '"' + extra + ' style="height:' + h + 'px;' + st + '"></div>');
      });
    }
    el.innerHTML = out.join('');
  }

  // なぞって塗る（最初に触ったマスが空なら塗る、塗ってあれば消す）
  function paintable(el, getSet, after) {
    var mode = null;
    function at(x, y) { var t = document.elementFromPoint(x, y); return t && t.classList && t.classList.contains('c') && el.contains(t) ? t : null; }
    function apply(c) {
      var k = c.dataset.d + '-' + c.dataset.r, set = getSet();
      if (mode) set[k] = 1; else delete set[k];
      c.classList.toggle('on', mode);
    }
    el.addEventListener('pointerdown', function (e) {
      if (e.button > 0) return;
      var c = at(e.clientX, e.clientY); if (!c) return;
      e.preventDefault(); mode = !c.classList.contains('on'); apply(c);
      try { el.setPointerCapture(e.pointerId); } catch (x) { /* 無視 */ }
    });
    el.addEventListener('pointermove', function (e) {
      if (mode === null) return;
      var c = at(e.clientX, e.clientY);
      if (c && c.classList.contains('on') !== mode) apply(c);
    });
    function end() { if (mode !== null) { mode = null; after(); } }
    el.addEventListener('pointerup', end); el.addEventListener('pointercancel', end); el.addEventListener('lostpointercapture', end);
  }

  /* 候補ベスト3：全員空き → 長く続く → 早い日 の順。
   * countAt(d,r) が k 人以上のマスが need 分以上続く所を探す（k = 全員、つぎに1人欠け。2人未満は候補にしない） */
  function candidates(ev, sh, countAt, total) {
    var need = Math.max(1, Math.round((ev.need || ev.step) / ev.step)), list = [];
    for (var k = total; k >= Math.max(2, total - 1); k--) {
      for (var d = 0; d < sh.days; d++) {
        var r = 0;
        while (r < sh.rows) {
          if (countAt(d, r) >= k) {
            var s = r;
            while (r < sh.rows && countAt(d, r) >= k) r++;
            var e = r;
            if (e - s >= need && !list.some(function (c) { return c.d === d && c.s < e && s < c.e; })) list.push({ d: d, s: s, e: e, k: k });
          } else r++;
        }
      }
    }
    list.sort(function (a, b) { return (b.k - a.k) || ((b.e - b.s) - (a.e - a.s)) || (a.d - b.d) || (a.s - b.s); });
    return list.slice(0, 3).map(function (c) {
      c.startMin = rowMin(ev, c.s); c.endMin = c.startMin + (ev.need || ev.step); c.allMin = rowMin(ev, c.e);
      c.ymd = sh.dates[c.d];
      return c;
    });
  }

  global.YoteiGrid = {
    WD: WD, pad: pad, dayMs: dayMs, ymdOf: ymdOf, addDays: addDays, today: today, diffDays: diffDays, info: info, label: label,
    hm: hm, iso: iso, esc: esc, shape: shape, rowMin: rowMin, cellRange: cellRange, periodText: periodText, hoursText: hoursText,
    rangeText: rangeText, toSet: toSet, toStrings: toStrings, on: on, count: count, pageDays: pageDays, pages: pages, heatColor: heatColor,
    draw: draw, paintable: paintable, candidates: candidates
  };
})(typeof window !== 'undefined' ? window : globalThis);
