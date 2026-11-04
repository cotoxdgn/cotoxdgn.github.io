// コトのホーム画面ウィジェット（Scriptable 用）。ホーム画面の1ページを「大」1つ＋「中」1つで埋める
//  大（4×4）：日付・大阪の天気（3時間ごと6つ。18時からは明日の予報）・今日の予定・今日のタスク（夜は明日の分も）
//  中（4×2）：ルーティン（習慣の○×・連続日数・生理）・わんこの歯みがき（今日の2頭）・脳みその新しい2枚
//  小：タスクの件数・習慣・生理・次の予定だけ
// どのサイズも同じスクリプトです。置いたサイズで中身が変わります。使い方は widget/README.md を見てください。
//
// ================= ここに6つ貼る（空のままの所は「未設定」と出るだけで、ほかは動きます） =================
const CONFIG = {
  // ルーティン（自分用のスプシ）：アプリの「習慣」→「ホーム画面のウィジェット」の「送り先URL」（…/exec で終わる）
  routineUrl: '',
  // ルーティン：同じ画面の「見るだけ用の合言葉」（いつもの合言葉は貼らない）。習慣・予定・脳みそはこれで読みます
  routineKey: '',
  // タスク表：タスク用の Apps Script のウェブアプリURL（…/exec で終わる）
  taskUrl: '',
  // タスク表：Apps Script で taskApiShowViewKey を実行したときに出る「見るだけ用の合言葉」
  taskKey: '',
  // わんこの歯みがき（家族用のスプシ）：「設定」シートの B2（接続URL、…/exec で終わる）
  wankoUrl: '',
  // わんこの歯みがき：家族用のスプシの「設定」シートの B6（見るだけ用の合言葉）
  wankoKey: '',
};
// ================= ここまで =================

const REFRESH_MIN = 15;          // 何分ごとに読み直すか（iPhone の都合で少し遅れることがあります）
const TIMEOUT_SEC = 20;          // 1回の通信を待つ秒数
const CACHE_FILE = 'koto-widget-cache.json';   // 最後に読めた内容（この iPhone の中だけに保存）
const DAY_START_HOUR = 3;        // ルーティンの1日の区切り（深夜3時までは前の日）
const NIGHT_HOUR = 18;           // この時刻からは天気・タスクを「明日」寄りにする
// 天気：大阪（無料の Open-Meteo。合言葉は要らない）
const WEATHER_URL = 'https://api.open-meteo.com/v1/forecast?latitude=34.6937&longitude=135.5023'
  + '&hourly=temperature_2m,precipitation_probability,weather_code'
  + '&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max,weather_code'
  + '&current=temperature_2m,weather_code&timezone=Asia%2FTokyo&forecast_days=3';
const DOG_DEFAULTS = ['わんこA', 'わんこB'];   // 名前表が空のときの呼び名（wanko/app.js と同じ）

// 色（モックと同じ落ち着いた北欧風。iPhone の明るい／暗い表示で切り替わる）
const dyn = (a, b) => Color.dynamic(new Color(a), new Color(b));
const C = {
  bg: dyn('#FBFBF8', '#1F2421'),
  ink: dyn('#2B312E', '#E8EBE6'),
  muted: dyn('#7A817B', '#9AA39C'),
  line: dyn('#E7E9E3', '#323833'),
  soft: dyn('#F1F2EC', '#2A302C'),
  sage: dyn('#8FA893', '#8FA893'),
  blue: dyn('#7F96A8', '#8EA2B2'),
  rose: dyn('#C48E8E', '#CC9C9C'),
  mustard: dyn('#C9A65A', '#D2B26A'),
  lilac: dyn('#9C92B5', '#A99FC0'),
  task: dyn('#2E6E66', '#5FA399'),
  dogOk: dyn('#2F9C8A', '#3DAE9B'),
  dogNg: dyn('#D9801F', '#E39A4A'),
  brain: dyn('#C0533F', '#D27563'),
  sun: dyn('#D9A73E', '#E3C06A'),
  warn: dyn('#9B5A4E', '#E0A79B'),
  white: new Color('#FFFFFF'),
};
// Googleカレンダーの色番号（'1'〜'11'）を、落ち着いた色に置きかえる
const CAL_COLORS = {
  '1': dyn('#9C92B5', '#A99FC0'), '2': dyn('#8FA893', '#9BB39F'), '3': dyn('#A08AB0', '#AD98BC'),
  '4': dyn('#C48E8E', '#CC9C9C'), '5': dyn('#C9A65A', '#D2B26A'), '6': dyn('#C99A6E', '#D3A77D'),
  '7': dyn('#7FA3A8', '#8DB0B5'), '8': dyn('#8C918E', '#9DA29F'), '9': dyn('#6F84A6', '#8396B5'),
  '10': dyn('#6E8F78', '#7F9F89'), '11': dyn('#B7766C', '#C5877D'),
};

// ---------- 日付 ----------
function pad(n) { return (n < 10 ? '0' : '') + n; }
function ymd(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
function hm(d) { return pad(d.getHours()) + ':' + pad(d.getMinutes()); }
function hmShort(d) { return d.getHours() + ':' + pad(d.getMinutes()); }
function md(s) { const p = String(s).split('-'); return (+p[1]) + '/' + (+p[2]); }
function addDays(d, n) { const x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); x.setDate(x.getDate() + n); return x; }
// YYYY-MM-DD どうしの日数（b − a）
function diffDays(a, b) {
  const t = s => { const p = String(s).split('-'); return Date.UTC(+p[0], +p[1] - 1, +p[2]); };
  return Math.round((t(b) - t(a)) / 86400000);
}
// ルーティンの「今日」（深夜3時までは前の日）
function routineToday(now) { return ymd(new Date(now.getTime() - DAY_START_HOUR * 3600000)); }
const WD = ['日', '月', '火', '水', '木', '金', '土'];

// ---------- 通信 ----------
async function post(url, key, action) {
  const req = new Request(url);
  req.method = 'POST';
  req.headers = { 'Content-Type': 'text/plain' };   // text/plain で送る（アプリと同じ形）
  req.body = JSON.stringify({ key: key, action: action });
  req.timeoutInterval = TIMEOUT_SEC;
  let res;
  try { res = await req.loadJSON(); } catch (e) { throw new Error('network'); }
  if (!res || res.ok !== true) throw new Error((res && res.error) || 'server');
  return res;
}
async function getWeather() {
  const req = new Request(WEATHER_URL);
  req.method = 'GET';
  req.timeoutInterval = TIMEOUT_SEC;
  let res;
  try { res = await req.loadJSON(); } catch (e) { throw new Error('network'); }
  if (!res || res.error || !res.hourly || !res.daily) throw new Error('server');
  return res;
}

function errorText(code) {
  return ({
    bad_key: '合言葉が違います',
    no_setup: 'スプシの準備がまだです',
    network: 'つながりません',
    bad_action: 'Apps Script が古いようです',
    busy: '混み合っています',
  })[code] || 'うまく読めませんでした';
}

// ---------- 最後に読めた内容（キャッシュ。読み先ごとに別々） ----------
function cachePath() {
  const fm = FileManager.local();
  return { fm: fm, path: fm.joinPath(fm.documentsDirectory(), CACHE_FILE) };
}
function readCache() {
  try {
    const c = cachePath();
    if (!c.fm.fileExists(c.path)) return {};
    const v = JSON.parse(c.fm.readString(c.path));
    return v && typeof v === 'object' ? v : {};
  } catch (e) { return {}; }
}
// 大と中は別々に動くので、書く直前に読み直して、今回読めた分だけ差し替える
function saveCache(fresh) {
  if (!Object.keys(fresh).length) return;
  try {
    const all = readCache();
    Object.keys(fresh).forEach(k => { all[k] = fresh[k]; });
    const c = cachePath();
    c.fm.writeString(c.path, JSON.stringify(all));
  } catch (e) { /* 保存できなくても表示は続ける */ }
}

// 1つの読み先を読む。失敗したら最後に読めた内容を使う
//  → { state: 'unset'（未設定）| 'ok' | 'cache'（前の内容）| 'none'（何も無い）, data, at（読めた時刻）, error }
async function loadOne(cache, fresh, name, fn) {
  if (!fn) return { state: 'unset' };
  try {
    const data = await fn();
    fresh[name] = { data: data, at: new Date().toISOString() };
    return { state: 'ok', data: data, at: new Date() };
  } catch (e) {
    const code = String((e && e.message) || e);
    const hit = cache[name];
    if (hit && hit.data) return { state: 'cache', data: hit.data, at: new Date(hit.at), error: code };
    return { state: 'none', error: code };
  }
}
function has(r) { return r.state === 'ok' || r.state === 'cache'; }
// 読めないときの短い一言（読めていれば ''）
function trouble(r) {
  if (r.state === 'unset') return '未設定';
  if (r.state === 'none') return '読み込めませんでした（' + errorText(r.error) + '）';
  return '';
}

// ---------- 表示用にまとめる ----------
// タスク表：アプリ（task/app.js の render）と同じ並び。持ち越し（ふつう→👤待ち→前提待ち、日付順）→ 今日（同じ順、朝・昼・夕・なし）
const SLOT_ORDER = { '朝': 0, '昼': 1, '夕': 2, '': 3 };
const SLOT_ICON = { '朝': '🌅', '昼': '☀️', '夕': '🌙' };
const taskRank = t => (t.preWait ? 2 : (t.wait ? 1 : 0));
function bySlot(a, b) { return taskRank(a) - taskRank(b) || (SLOT_ORDER[a.slot || ''] ?? 3) - (SLOT_ORDER[b.slot || ''] ?? 3); }
function taskSummary(data) {
  const today = data.today;
  const open = (data.tasks || []).filter(t => !t.done);
  const carry = open.filter(t => t.date < today)
    .sort((a, b) => taskRank(a) - taskRank(b) || (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const todays = open.filter(t => t.date === today).sort(bySlot);
  const ready = carry.concat(todays).filter(t => taskRank(t) === 0)
    .map(t => ({ name: String(t.todo || ''), slot: t.slot || '', carry: t.date < today }));
  const hasTmr = Array.isArray(data.tomorrow);   // 古い Apps Script には tomorrow が無い
  const tmr = hasTmr ? data.tomorrow.filter(t => !t.done).sort(bySlot) : [];
  return {
    today: today,
    count: open.length,
    carry: carry.length,
    wait: open.length - ready.length,
    ready: ready,
    top: ready.slice(0, 3).map(t => t.name),
    tomorrow: hasTmr ? tmr.filter(t => taskRank(t) === 0).map(t => ({ name: String(t.todo || ''), slot: t.slot || '', carry: false })) : null,
    tomorrowCount: hasTmr ? tmr.length : null,
  };
}

// 生理の言い方：「12日後」「今日」「3日目」「予定日から2日」
function periodText(p, today) {
  if (p && p.ongoing && p.start) return (diffDays(p.start, today) + 1) + '日目';
  if (p && p.next) {
    const d = diffDays(today, p.next);
    if (d < -14) return '';
    return d > 0 ? d + '日後' : d === 0 ? '今日' : '予定日から' + (-d) + '日';
  }
  return '';
}
// ルーティン：前の内容でも「○日後」「○日目」は今日に合わせて数え直す
function routineSummary(data, now) {
  const today = routineToday(now);
  const sameDay = data.today === today;
  return {
    habits: (data.habits || []).map(h => ({ name: String(h.name || ''), done: sameDay && !!h.done })),
    streak: +data.streak || 0,
    per: periodText(data.period, today),
    dataDay: data.today,
    sameDay: sameDay,
  };
}

// 予定：今日（0時区切り）と明日に分ける。時刻のある予定は始まる順、終日はあと
function eventSummary(events, now) {
  const t0 = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const t1 = addDays(now, 1).getTime(), t2 = addDays(now, 2).getTime();
  const today = ymd(now), tomorrow = ymd(addDays(now, 1));
  const list = (events || []).map(e => {
    if (e.allDay) return { title: String(e.title || ''), allDay: true, s: String(e.start), e: String(e.end), color: e.color || '' };
    return { title: String(e.title || ''), allDay: false, s: new Date(e.start).getTime(), e: new Date(e.end).getTime(), color: e.color || '' };
  }).filter(e => e.allDay ? /^\d{4}-\d{2}-\d{2}$/.test(e.s) : !isNaN(e.s) && !isNaN(e.e));
  const onDay = (e, from, to, key) => e.allDay ? (e.s <= key && key < e.e) : (e.s < to && from < e.e);
  const sort = arr => arr.filter(e => !e.allDay).sort((a, b) => a.s - b.s).concat(arr.filter(e => e.allDay));
  const todays = sort(list.filter(e => onDay(e, t0, t1, today)));
  const tmr = sort(list.filter(e => onDay(e, t1, t2, tomorrow)));
  const nowMs = now.getTime();
  const timed = todays.filter(e => !e.allDay);
  const left = todays.filter(e => e.allDay || e.e > nowMs);
  const leftTimed = timed.filter(e => e.e > nowMs);
  // 今日の時刻のある予定が全部終わったら（予定が無い日は18時から）明日の分を出す
  const tomorrowMode = !leftTimed.length && (timed.length > 0 || now.getHours() >= NIGHT_HOUR);
  return { todays: todays, left: left, tomorrow: tmr, tomorrowMode: tomorrowMode, t0: t0, t1: t1, nowMs: nowMs };
}
function eventTime(e, dayStart) {
  if (e.allDay) return '終日';
  if (e.s < dayStart) return '〜' + hmShort(new Date(e.e));
  return hmShort(new Date(e.s));
}

// 天気（WMO の番号 → ことばと SF Symbols の名前）
const WMO = [
  [[0, 1], '晴れ', 'sun.max.fill', 'moon.stars.fill'],
  [[2], '晴れ時々くもり', 'cloud.sun.fill', 'cloud.moon.fill'],
  [[3], 'くもり', 'cloud.fill'],
  [[45, 48], '霧', 'cloud.fog.fill'],
  [[51, 53, 55], '霧雨', 'cloud.drizzle.fill'],
  [[56, 57, 66, 67], 'みぞれ', 'cloud.sleet.fill'],
  [[61], '小雨', 'cloud.rain.fill'],
  [[63], '雨', 'cloud.rain.fill'],
  [[65], '強い雨', 'cloud.heavyrain.fill'],
  [[71], '小雪', 'cloud.snow.fill'],
  [[73, 77], '雪', 'cloud.snow.fill'],
  [[75], '大雪', 'cloud.snow.fill'],
  [[80, 81], 'にわか雨', 'cloud.sun.rain.fill', 'cloud.moon.rain.fill'],
  [[82], '強いにわか雨', 'cloud.heavyrain.fill'],
  [[85, 86], 'にわか雪', 'cloud.snow.fill'],
  [[95], '雷雨', 'cloud.bolt.rain.fill'],
  [[96, 99], '雷雨（ひょう）', 'cloud.bolt.rain.fill'],
];
function wmo(code, night) {
  const hit = WMO.find(x => x[0].indexOf(+code) >= 0);
  if (!hit) return { word: '—', sym: 'cloud.fill' };
  return { word: hit[1], sym: (night && hit[3]) || hit[2] };
}
function symColor(sym) {
  if (/bolt|rain|drizzle|sleet|snow/.test(sym)) return C.blue;
  if (/sun/.test(sym) && !/cloud/.test(sym)) return C.sun;
  if (/moon/.test(sym)) return C.mustard;
  return C.muted;
}
function weatherSummary(data, fresh, now) {
  const h = data.hourly || {}, d = data.daily || {};
  const times = h.time || [];
  const key = t => ymd(t) + 'T' + pad(t.getHours()) + ':00';
  const hourAt = t => times.indexOf(key(t));
  const night = now.getHours() >= NIGHT_HOUR;
  const dayIdx = d.time ? d.time.indexOf(ymd(night ? addDays(now, 1) : now)) : -1;
  const nowI = hourAt(now);
  // 今の気温：読めたばかりなら current、前の内容なら今の時刻の予報
  let cur = null, curCode = null;
  if (fresh && data.current && data.current.temperature_2m != null) { cur = data.current.temperature_2m; curCode = data.current.weather_code; }
  else if (nowI >= 0) { cur = h.temperature_2m[nowI]; curCode = h.weather_code[nowI]; }
  const slots = [];
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours() + 1);
  for (let i = 0; i < 6; i++) {
    const t = new Date(start.getTime() + i * 3 * 3600000);
    const j = hourAt(t);
    if (j < 0) continue;
    const hr = t.getHours();
    slots.push({ label: hr + '時', temp: h.temperature_2m[j], rain: h.precipitation_probability ? h.precipitation_probability[j] : null,
      sym: wmo(h.weather_code[j], hr >= 18 || hr < 6).sym });
  }
  const day = dayIdx >= 0 ? {
    max: d.temperature_2m_max[dayIdx], min: d.temperature_2m_min[dayIdx],
    rain: d.precipitation_probability_max ? d.precipitation_probability_max[dayIdx] : null, code: d.weather_code[dayIdx],
  } : null;
  if (cur == null && !day && !slots.length) return null;   // 古すぎて今の分が無い
  const nightNow = now.getHours() >= 18 || now.getHours() < 6;
  return { night: night, cur: cur, curSym: curCode != null ? wmo(curCode, nightNow).sym : null, day: day, slots: slots };
}
const deg = v => (v == null || isNaN(v) ? '—' : Math.round(v)) + '°';
const pct = v => (v == null || isNaN(v) ? '—' : Math.round(v)) + '%';

// ---------- ウィジェットの部品 ----------
const FONTS = { regular: 'systemFont', medium: 'mediumSystemFont', semibold: 'semiboldSystemFont', bold: 'boldSystemFont', light: 'lightSystemFont' };
const ROUND = { regular: 'regularRoundedSystemFont', medium: 'mediumRoundedSystemFont', semibold: 'semiboldRoundedSystemFont', bold: 'boldRoundedSystemFont', light: 'lightRoundedSystemFont' };
function font(size, weight, round) {
  const w = weight || 'regular';
  const name = round ? ROUND[w] : FONTS[w];
  if (typeof Font[name] === 'function') return Font[name](size);
  if (typeof Font[FONTS[w]] === 'function') return Font[FONTS[w]](size);
  return Font.systemFont(size);
}
function text(stack, s, size, color, opts) {
  opts = opts || {};
  const t = stack.addText(String(s));
  t.font = font(size, opts.w || (opts.bold ? 'semibold' : 'regular'), opts.round);
  t.textColor = color || C.ink;
  t.lineLimit = opts.lines || 1;
  t.minimumScaleFactor = opts.scale || 0.8;
  if (opts.align === 'right' && t.rightAlignText) t.rightAlignText();
  if (opts.align === 'center' && t.centerAlignText) t.centerAlignText();
  return t;
}
function hstack(parent, spacing) { const s = parent.addStack(); s.layoutHorizontally(); if (spacing != null) s.spacing = spacing; return s; }
function vstack(parent, spacing) { const s = parent.addStack(); s.layoutVertically(); if (spacing != null) s.spacing = spacing; return s; }
function symbol(stack, name, size, color) {
  let sf = null;
  try { sf = SFSymbol.named(name); } catch (e) { sf = null; }
  if (!sf) return null;
  try { sf.applyFont(Font.systemFont(size)); } catch (e) { /* 古い Scriptable */ }
  const img = stack.addImage(sf.image);
  img.imageSize = new Size(size, size);
  img.tintColor = color || C.muted;
  return img;
}
function dot(stack, color, size) {
  const d = stack.addStack();
  d.size = new Size(size || 7, size || 7);
  d.cornerRadius = (size || 7) / 2;
  d.backgroundColor = color;
  return d;
}
function line(stack) {
  const l = hstack(stack);
  l.size = new Size(0, 1);
  l.backgroundColor = C.line;
  l.addSpacer();
  return l;
}
// 見出し：●予定　　　　5件
function heading(col, color, label, right, width) {
  const h = hstack(col, 5);
  h.centerAlignContent();
  if (width) h.size = new Size(width, 0);
  if (color) dot(h, color, 7);
  text(h, label, 11, C.muted, { w: 'bold' });
  if (right) { h.addSpacer(); text(h, right, 11, C.ink, { w: 'semibold', round: true }); }
  return h;
}
function shortName(s, n) { s = String(s); return s.length > n ? s.slice(0, n) + '…' : s; }

// ウィジェットの幅（iPhone の画面の幅から。わからなければ 338）
function widgetWidth(family) {
  let sw = 390;
  try { sw = Device.screenSize().width; } catch (e) { sw = 390; }
  if (family === 'small') return sw >= 428 ? 170 : sw >= 414 ? 169 : sw >= 390 ? 158 : sw >= 375 ? 155 : 148;
  return sw >= 428 ? 364 : sw >= 414 ? 360 : sw >= 390 ? 338 : sw >= 375 ? 329 : 321;
}

// 「更新できませんでした」の一言（前の内容を出している読み先の名前）
function staleNote(pairs) {
  const names = pairs.filter(p => p[1].state === 'cache').map(p => p[0]);
  if (!names.length) return '';
  return names.join('・') + '：更新できませんでした ' + hm(new Date());
}

// ---------- 大（4×4）：日付・天気・予定・タスク ----------
function drawLarge(w, S) {
  const now = new Date();
  const W = widgetWidth('large'), PAD = 14, GAP = 12;
  const inner = W - PAD * 2, colW = Math.floor((inner - GAP) / 2);
  w.setPadding(12, PAD, 10, PAD);

  // 上：日付と天気
  const top = hstack(w);
  top.topAlignContent();
  const date = vstack(top, 0);
  text(date, (now.getMonth() + 1) + '.' + now.getDate(), 24, C.ink, { w: 'semibold', round: true });
  text(date, WD[now.getDay()] + '曜日・大阪', 11, C.muted);
  top.addSpacer();
  const wx = has(S.weather) ? weatherSummary(S.weather.data, S.weather.state === 'ok', now) : null;
  if (!wx) {
    text(top, S.weather.state === 'none' ? '天気を読めません' : '天気：—', 11, C.muted);
  } else {
    const box = hstack(top, 7);
    box.centerAlignContent();
    const tx = vstack(box, 0);
    const big = hstack(tx); big.addSpacer();
    text(big, deg(wx.cur), 24, C.ink, { w: 'light', round: true });
    const d = wx.day;
    const l1 = d ? (wx.night ? 'あす ' + deg(d.max) + ' / ' + deg(d.min) + ' / 降水 ' + pct(d.rain) : '最高 ' + deg(d.max) + ' / 最低 ' + deg(d.min) + ' / 降水 ' + pct(d.rain)) : '';
    const l2 = d ? (wx.night ? 'あす ' : '') + wmo(d.code, false).word : '';
    if (l1) { const r1 = hstack(tx); r1.addSpacer(); text(r1, l1, 10, C.muted, { scale: 0.7 }); }
    if (l2) { const r2 = hstack(tx); r2.addSpacer(); text(r2, l2, 10, C.muted, { scale: 0.7 }); }
    const icon = wx.night && d ? wmo(d.code, false).sym : (wx.curSym || (d ? wmo(d.code, false).sym : 'cloud.fill'));
    symbol(box, icon, 28, symColor(icon));
  }
  w.addSpacer(6);

  // 3時間ごとの天気
  if (wx && wx.slots.length) {
    const row = hstack(w, 0);
    const sw = Math.floor(inner / 6);
    wx.slots.forEach(s => {
      const c = vstack(row, 1);
      c.size = new Size(sw, 0);
      c.centerAlignContent();
      text(c, s.label, 10, C.muted, { align: 'center', round: true });
      symbol(c, s.sym, 13, symColor(s.sym));
      text(c, deg(s.temp), 12, C.ink, { w: 'semibold', align: 'center', round: true });
      text(c, pct(s.rain), 9, s.rain >= 50 ? C.blue : C.muted, { align: 'center', round: true });
    });
    w.addSpacer(5);
  }
  line(w);
  w.addSpacer(7);

  // 下：予定とタスク
  const two = hstack(w, GAP);
  two.topAlignContent();
  const left = vstack(two, 3); left.size = new Size(colW, 0);
  drawEvents(left, S.routine, now, colW);
  const right = vstack(two, 3); right.size = new Size(colW, 0);
  drawTasks(right, S.task, now, colW);
  w.addSpacer();

  const note = staleNote([['予定', S.routine], ['タスク表', S.task]]);
  if (note) text(w, note, 9, C.warn, { scale: 0.7 });
}

function evRow(col, e, dayStart, bold) {
  const r = hstack(col, 5);
  r.centerAlignContent();
  const tm = hstack(r); tm.size = new Size(34, 0);
  text(tm, eventTime(e, dayStart), 11, C.muted, { w: 'semibold', round: true, scale: 0.7 });
  const bar = r.addStack(); bar.size = new Size(3, 13); bar.cornerRadius = 1.5; bar.backgroundColor = CAL_COLORS[e.color] || C.blue;
  text(r, e.title || '（件名なし）', 12, C.ink, { w: bold ? 'bold' : 'regular', scale: 0.85 });
  r.addSpacer();
}

function drawEvents(col, r, now, colW) {
  const msg = trouble(r);
  if (msg) { heading(col, C.blue, '予定', '', colW); text(col, msg, 11, r.state === 'none' ? C.warn : C.muted, { lines: 3 }); return; }
  if (!('events' in r.data)) { heading(col, C.blue, '予定', '', colW); text(col, 'スプシのプログラムを新しくすると出ます', 11, C.muted, { lines: 3 }); return; }
  if (r.data.events === null) { heading(col, C.blue, '予定', '', colW); text(col, 'カレンダーを読めませんでした', 11, C.warn, { lines: 2 }); return; }
  const E = eventSummary(r.data.events, now);
  if (E.tomorrowMode) {
    heading(col, C.blue, '予定', '今日は終了', colW);
    text(col, '明日', 12, C.ink, { w: 'semibold' });
    if (!E.tomorrow.length) { text(col, '明日の予定はありません', 11, C.muted); return; }
    E.tomorrow.slice(0, 4).forEach(e => evRow(col, e, E.t1, false));
    if (E.tomorrow.length > 4) text(col, 'ほか' + (E.tomorrow.length - 4) + '件', 10, C.muted);
    return;
  }
  const ended = E.todays.length - E.left.length;
  heading(col, C.blue, '予定', E.todays.length ? (ended ? 'あと' + E.left.length + '件' : E.todays.length + '件') : '', colW);
  if (!E.left.length) text(col, '今日の予定はありません', 11, C.muted);
  E.left.slice(0, 5).forEach(e => evRow(col, e, E.t0, !e.allDay && e.s <= E.nowMs && E.nowMs < e.e));
  if (E.left.length > 5) text(col, 'ほか' + (E.left.length - 5) + '件', 10, C.muted);
  const first = E.tomorrow[0];
  col.addSpacer(1);
  text(col, first ? '明日 ' + eventTime(first, E.t1) + ' ' + first.title : '明日の予定はありません', 10, C.muted, { scale: 0.75 });
}

function taskRow(col, t) {
  const r = hstack(col, 4);
  r.centerAlignContent();
  text(r, SLOT_ICON[t.slot] || '・', 10, C.muted);
  text(r, t.name, 12, C.ink, { scale: 0.85 });
  if (t.carry) text(r, '持越', 9, C.rose, { w: 'bold' });
  r.addSpacer();
}

function drawTasks(col, r, now, colW) {
  const msg = trouble(r);
  if (msg) { heading(col, C.task, 'タスク', '', colW); text(col, msg, 11, r.state === 'none' ? C.warn : C.muted, { lines: 3 }); return; }
  const s = taskSummary(r.data);
  heading(col, C.task, 'タスク', s.count + '件', colW);
  if (s.today && s.today !== ymd(now)) text(col, '（' + md(s.today) + ' の内容）', 10, C.muted);
  const night = now.getHours() >= NIGHT_HOUR;
  const empty = () => text(col, s.count ? '待ちのタスクだけです' : '今日のタスクはありません', 11, C.muted);
  if (night && s.tomorrow) {
    // 夜：今日の残り（3つまで）と、明日の分
    if (!s.ready.length) empty();
    s.ready.slice(0, 3).forEach(t => taskRow(col, t));
    const rest = s.ready.length - Math.min(3, s.ready.length);
    if (rest || s.wait) text(col, [rest ? 'ほか' + rest + '件' : '', s.wait ? '待ち' + s.wait + '件' : ''].filter(Boolean).join('・'), 10, C.muted);
    col.addSpacer(3);
    heading(col, null, '明日', s.tomorrowCount + '件', colW);
    const n = Math.max(2, 5 - Math.min(3, Math.max(1, s.ready.length)));
    if (!s.tomorrow.length) text(col, s.tomorrowCount ? '待ちのタスクだけです' : '明日のタスクはありません', 11, C.muted);
    s.tomorrow.slice(0, n).forEach(t => taskRow(col, t));
    return;
  }
  if (!s.ready.length) empty();
  s.ready.slice(0, 5).forEach(t => taskRow(col, t));
  const more = [];
  if (s.ready.length > 5) more.push('ほか' + (s.ready.length - 5) + '件');
  if (s.wait) more.push('待ち' + s.wait + '件');
  if (s.tomorrowCount != null) more.push('明日' + s.tomorrowCount + '件');
  if (more.length) text(col, more.join('・'), 10, C.muted);
}

// ---------- 中（4×2）：ルーティン・わんこ・脳みそ ----------
function drawMedium(w, S) {
  const now = new Date();
  const W = widgetWidth('medium'), PAD = 13, GAP = 10;
  const inner = W - PAD * 2;
  const lw = Math.floor((inner - GAP) * 0.55), rw = inner - GAP - lw;
  w.setPadding(12, PAD, 10, PAD);
  const two = hstack(w, GAP);
  two.topAlignContent();

  // 左：ルーティンと歯みがき
  const left = vstack(two, 4); left.size = new Size(lw, 0);
  heading(left, C.sage, 'ルーティン', '', lw);
  const rmsg = trouble(S.routine);
  if (rmsg) text(left, rmsg, 11, S.routine.state === 'none' ? C.warn : C.muted, { lines: 2 });
  else {
    const s = routineSummary(S.routine.data, now);
    const chips = hstack(left, 4);
    const max = 3;
    const habitColors = [C.sage, C.blue, C.rose];
    s.habits.slice(0, max).forEach((h, i) => {
      const chip = hstack(chips, 3);
      chip.centerAlignContent();
      chip.backgroundColor = C.soft; chip.cornerRadius = 9; chip.setPadding(1, 2, 1, 6);
      const mark = hstack(chip); mark.size = new Size(15, 15); mark.cornerRadius = 7.5; mark.centerAlignContent();
      if (h.done) { mark.backgroundColor = habitColors[i % habitColors.length]; text(mark, '✓', 9, C.white, { w: 'bold' }); }
      else { mark.borderColor = C.muted; mark.borderWidth = 1; text(mark, '·', 10, C.muted, { w: 'bold' }); }
      text(chip, shortName(h.name, 4), 10, h.done ? C.ink : C.muted, { scale: 0.7 });
    });
    if (s.habits.length > max) text(chips, '+' + (s.habits.length - max), 10, C.muted);
    if (!s.sameDay && s.dataDay) text(left, '（' + md(s.dataDay) + ' の記録）', 9, C.muted);
    const kv = hstack(left, 4);
    kv.bottomAlignContent();
    text(kv, String(s.streak), 16, C.ink, { w: 'semibold', round: true });
    text(kv, '日連続', 11, C.muted);
    if (s.per) {
      kv.addSpacer(8);
      text(kv, '生理 ' + s.per, 11, C.rose, { w: 'semibold' });
    }
  }
  left.addSpacer(2);
  heading(left, C.dogOk, '歯みがき', '', lw);
  const wmsg = trouble(S.wanko);
  if (wmsg) text(left, wmsg, 11, S.wanko.state === 'none' ? C.warn : C.muted, { lines: 2 });
  else if (!S.wanko.data.wanko) text(left, '家族用のスプシのプログラムを新しくすると出ます', 10, C.muted, { lines: 2 });
  else {
    const wk = S.wanko.data.wanko;
    const sameDay = wk.today === ymd(now);
    const dogs = hstack(left, 8);
    dogs.centerAlignContent();
    (wk.dogs || []).slice(0, 2).forEach((d, i) => {
      const done = sameDay && !!d.done;
      const one = hstack(dogs, 4);
      one.centerAlignContent();
      const b = hstack(one); b.size = new Size(18, 18); b.cornerRadius = 9; b.centerAlignContent();
      if (done) { b.backgroundColor = C.dogOk; text(b, '✓', 10, C.white, { w: 'bold' }); }
      else { b.borderColor = C.dogNg; b.borderWidth = 1.5; text(b, '−', 11, C.dogNg, { w: 'bold' }); }
      text(one, shortName(d.name || DOG_DEFAULTS[i], 6), 11, C.ink);
    });
  }

  // 右：脳みそ（新しい2枚）
  const right = vstack(two, 3); right.size = new Size(rw, 0);
  const bmsg = trouble(S.routine);
  if (bmsg) { heading(right, C.brain, '脳みそ', '', rw); text(right, bmsg, 11, S.routine.state === 'none' ? C.warn : C.muted, { lines: 2 }); }
  else if (!S.routine.data.brain) { heading(right, C.brain, '脳みそ', '', rw); text(right, 'スプシのプログラムを新しくすると出ます', 10, C.muted, { lines: 2 }); }
  else {
    const br = S.routine.data.brain;
    heading(right, C.brain, '脳みそ', '全' + (+br.count || 0) + '枚', rw);
    const cards = br.latest || [];
    if (!cards.length) text(right, 'まだカードがありません', 11, C.muted);
    cards.slice(0, 2).forEach((c, i) => {
      if (i) line(right);
      text(right, c.title || '（題なし）', 11, C.ink, { lines: 2, scale: 0.8 });
      const no = String(c.kind || 'O') + (c.no ? '-' + ('00' + c.no).slice(-3) : '');
      const at = c.at ? new Date(c.at) : null;
      text(right, no + (at && !isNaN(at) ? ' · ' + (at.getMonth() + 1) + '/' + at.getDate() : ''), 9, C.muted, { round: true });
    });
  }
  w.addSpacer();
  const note = staleNote([['ルーティン', S.routine], ['歯みがき', S.wanko]]);
  const foot = hstack(w);
  foot.addSpacer();
  if (note) text(foot, note, 9, C.warn, { scale: 0.7 });
  else text(foot, hm(now) + ' 更新', 9, C.muted, { round: true });
}

// ---------- 小：数字だけ ----------
function drawSmall(w, S) {
  const now = new Date();
  w.setPadding(14, 14, 12, 14);
  text(w, 'きょう ' + (now.getMonth() + 1) + '/' + now.getDate() + '（' + WD[now.getDay()] + '）', 11, C.muted, { w: 'bold' });
  w.addSpacer(4);
  if (has(S.task)) {
    const s = taskSummary(S.task.data);
    text(w, 'タスク ' + s.count + '件', 15, C.ink, { bold: true });
    if (s.carry) text(w, '持ち越し ' + s.carry, 11, C.rose);
  } else text(w, 'タスク ' + (S.task.state === 'unset' ? '未設定' : '—'), 13, C.muted);
  w.addSpacer(4);
  if (has(S.routine)) {
    const s = routineSummary(S.routine.data, now);
    const n = s.habits.filter(h => h.done).length;
    text(w, '習慣 ' + n + '/' + s.habits.length + '　連続 ' + s.streak + '日', 12, C.ink);
    if (s.per) text(w, '生理 ' + s.per, 12, C.rose, { bold: true });
    if (Array.isArray(S.routine.data.events)) {
      const E = eventSummary(S.routine.data.events, now);
      const next = E.tomorrowMode ? E.tomorrow[0] : E.left[0];
      if (next) text(w, (E.tomorrowMode ? '明日 ' : '') + eventTime(next, E.tomorrowMode ? E.t1 : E.t0) + ' ' + next.title, 11, C.muted, { scale: 0.7 });
    }
  } else text(w, 'ルーティン ' + (S.routine.state === 'unset' ? '未設定' : '—'), 12, C.muted);
  w.addSpacer();
  if (S.task.state === 'cache' || S.routine.state === 'cache') text(w, '更新できませんでした ' + hm(now), 9, C.warn, { scale: 0.7 });
}

// ロック画面など（とても小さい）
function drawAccessory(w, S) {
  const parts = [];
  if (S.task.data) parts.push('タスク' + taskSummary(S.task.data).count);
  if (S.routine.data) {
    const s = routineSummary(S.routine.data, new Date());
    parts.push('習慣' + s.habits.filter(h => h.done).length + '/' + s.habits.length);
    if (s.per) parts.push('生理' + s.per);
  }
  text(w, parts.length ? parts.join(' ') : '未設定', 12, null, { lines: 2, scale: 0.6 });
}

// 6つとも空のとき：設定の案内
function drawSetup(w) {
  w.setPadding(14, 14, 14, 14);
  text(w, 'ウィジェットの準備', 14, C.ink, { bold: true });
  w.addSpacer(4);
  text(w, 'Scriptable でこのスクリプトを開き、いちばん上の CONFIG に6つ（ルーティン・タスク表・わんこの、送り先URLと見るだけ用の合言葉）を貼ってください。使わないものは空のままでかまいません。手順は widget/README.md にあります。', 11, C.muted, { lines: 7, scale: 0.7 });
}

function build(family, S, configured) {
  const w = new ListWidget();
  w.backgroundColor = C.bg;
  w.refreshAfterDate = new Date(Date.now() + REFRESH_MIN * 60000);
  // 押しても Scriptable が開くだけ（Safari でアプリを開くと接続が無いので、URL は付けない）
  if (!configured) { drawSetup(w); return w; }
  if (String(family).indexOf('accessory') === 0) drawAccessory(w, S);
  else if (family === 'small') drawSmall(w, S);
  else if (family === 'medium') drawMedium(w, S);
  else drawLarge(w, S);   // 大・特大
  return w;
}

// ---------- 本体 ----------
// サイズごとに要る読み先だけ読む（アプリの中で実行したときは全部）
const family = config.runsInWidget ? (config.widgetFamily || 'medium') : 'preview';
const NEED = {
  large: ['weather', 'routine', 'task'], extraLarge: ['weather', 'routine', 'task'],
  medium: ['routine', 'wanko'], small: ['routine', 'task'],
  preview: ['weather', 'routine', 'task', 'wanko'],
};
const need = NEED[family] || ['routine', 'task'];
const cfg = k => String(CONFIG[k] || '').trim();
const SOURCES = {
  routine: cfg('routineUrl') && cfg('routineKey') ? () => post(cfg('routineUrl'), cfg('routineKey'), 'widget') : null,
  task: cfg('taskUrl') && cfg('taskKey') ? () => post(cfg('taskUrl'), cfg('taskKey'), 'widget') : null,
  wanko: cfg('wankoUrl') && cfg('wankoKey') ? () => post(cfg('wankoUrl'), cfg('wankoKey'), 'widget') : null,
  weather: getWeather,
};
const configured = !!(SOURCES.routine || SOURCES.task || SOURCES.wanko);
const cache = readCache();
const fresh = {};
// 読み先は別々に読む（どれかがだめでも、ほかは出す）
const S = {};
await Promise.all(Object.keys(SOURCES).map(async name => {
  // 6つとも空なら何も読まない（設定の案内だけ）。このサイズで使わない読み先も読まない
  if (!configured || need.indexOf(name) < 0) { S[name] = SOURCES[name] ? { state: 'skip' } : { state: 'unset' }; return; }
  S[name] = await loadOne(cache, fresh, name, SOURCES[name]);
}));
saveCache(fresh);

if (config.runsInWidget) {
  Script.setWidget(build(family, S, configured));
} else {
  // アプリの中で実行したとき：大と中の見本を続けて出す
  await build('large', S, configured).presentLarge();
  await build('medium', S, configured).presentMedium();
}
Script.complete();
