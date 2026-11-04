// コトのホーム画面ウィジェット（Scriptable 用）
// タスク表：今日の未完了の件数・上から3つ・持ち越しの件数
// ルーティン：今日の習慣の○×・連続日数・生理の次の予定日（あと○日／○日目）
// 使い方は widget/README.md を見てください。
//
// ================= ここに4つ貼る =================
const CONFIG = {
  // ルーティン：アプリの「習慣」→「ホーム画面のウィジェット」の「送り先URL」（…/exec で終わる）
  routineUrl: '',
  // ルーティン：同じ画面の「見るだけ用の合言葉」（いつもの合言葉は貼らない）
  routineKey: '',
  // タスク表：タスク用の Apps Script のウェブアプリURL（…/exec で終わる）
  taskUrl: '',
  // タスク表：Apps Script で taskApiShowViewKey を実行したときに出る「見るだけ用の合言葉」
  taskKey: '',
};
// ================= ここまで =================

const REFRESH_MIN = 20;          // 何分ごとに読み直すか（iPhone の都合で少し遅れることがあります）
const TIMEOUT_SEC = 20;          // 1回の通信を待つ秒数
const CACHE_FILE = 'koto-widget-cache.json';   // 最後に読めた内容（この iPhone の中だけに保存）
const DAY_START_HOUR = 3;        // ルーティンの1日の区切り（深夜3時までは前の日）

// 色（アプリと同じ落ち着いた北欧風。ライト／ダークで切り替わる）
const C = {
  bg: Color.dynamic(new Color('#F3EFE8'), new Color('#22262A')),
  card: Color.dynamic(new Color('#FFFDF9'), new Color('#2F3539')),
  ink: Color.dynamic(new Color('#3E4447'), new Color('#E8E4DD')),
  muted: Color.dynamic(new Color('#80868A'), new Color('#A2A6A6')),
  sage: Color.dynamic(new Color('#7E957E'), new Color('#8FA38F')),
  rose: Color.dynamic(new Color('#B5857D'), new Color('#C29790')),
  blue: Color.dynamic(new Color('#73899A'), new Color('#8EA2B2')),
  warn: Color.dynamic(new Color('#9B5A4E'), new Color('#E0A79B')),
};

// ---------- 日付 ----------
function pad(n) { return (n < 10 ? '0' : '') + n; }
function ymd(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
function hm(d) { return pad(d.getHours()) + ':' + pad(d.getMinutes()); }
function md(s) { const p = String(s).split('-'); return (+p[1]) + '/' + (+p[2]); }
// YYYY-MM-DD どうしの日数（b − a）
function diffDays(a, b) {
  const t = s => { const p = String(s).split('-'); return Date.UTC(+p[0], +p[1] - 1, +p[2]); };
  return Math.round((t(b) - t(a)) / 86400000);
}
// ルーティンの「今日」（深夜3時までは前の日）
function routineToday(now) { return ymd(new Date(now.getTime() - DAY_START_HOUR * 3600000)); }

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

function errorText(code) {
  return ({
    bad_key: '合言葉が違います',
    no_setup: 'スプシの準備がまだです',
    network: 'つながりません',
    bad_action: 'Apps Script が古いようです',
    busy: '混み合っています',
  })[code] || 'うまく読めませんでした';
}

// ---------- 最後に読めた内容（キャッシュ） ----------
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
function writeCache(cache) {
  try { const c = cachePath(); c.fm.writeString(c.path, JSON.stringify(cache)); } catch (e) { /* 保存できなくても表示は続ける */ }
}

// 1つの読み先を読む。失敗したら最後に読めた内容を使う
//  → { state: 'unset'（未設定）| 'ok' | 'cache'（前の内容）| 'none'（何も無い）, data, at（読めた時刻）, error }
async function loadOne(cache, name, url, key, action) {
  if (!url || !key) return { state: 'unset' };
  try {
    const data = await post(url, key, action);
    cache[name] = { data: data, at: new Date().toISOString() };
    return { state: 'ok', data: data, at: new Date() };
  } catch (e) {
    const code = String((e && e.message) || e);
    const hit = cache[name];
    if (hit && hit.data) return { state: 'cache', data: hit.data, at: new Date(hit.at), error: code };
    return { state: 'none', error: code };
  }
}

// ---------- 表示用にまとめる ----------
// タスク表：アプリ（task/app.js の render）と同じ並び。持ち越し（ふつう→👤待ち→前提待ち、日付順）→ 今日（同じ順、朝・昼・夕・なし）
function taskSummary(data) {
  const today = data.today;
  const open = (data.tasks || []).filter(t => !t.done);
  const rank = t => (t.preWait ? 2 : (t.wait ? 1 : 0));
  const order = { '朝': 0, '昼': 1, '夕': 2, '': 3 };
  const carry = open.filter(t => t.date < today)
    .sort((a, b) => rank(a) - rank(b) || (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const todays = open.filter(t => t.date === today)
    .sort((a, b) => rank(a) - rank(b) || (order[a.slot || ''] ?? 3) - (order[b.slot || ''] ?? 3));
  const top = carry.concat(todays).filter(t => rank(t) === 0).slice(0, 3).map(t => String(t.todo || ''));
  return { count: open.length, carry: carry.length, top: top };
}

// ルーティン：前の内容でも「あと○日」「○日目」は今日に合わせて数え直す
function routineSummary(data, now) {
  const today = routineToday(now);
  const sameDay = data.today === today;
  let per = '';
  const p = data.period;
  if (p && p.ongoing && p.start) per = (diffDays(p.start, today) + 1) + '日目';
  else if (p && p.next) {
    const d = diffDays(today, p.next);
    if (d < -14) per = '';
    else per = d > 0 ? 'あと' + d + '日' : d === 0 ? '今日' : '予定日から' + (-d) + '日';
  }
  return {
    habits: (data.habits || []).map(h => ({ name: String(h.name || ''), done: sameDay && !!h.done })),
    streak: +data.streak || 0,
    per: per,
    dataDay: data.today,
    sameDay: sameDay,
  };
}

// ---------- ウィジェットの部品 ----------
function text(stack, s, size, color, opts) {
  opts = opts || {};
  const t = stack.addText(s);
  t.font = opts.bold ? Font.semiboldSystemFont(size) : Font.systemFont(size);
  t.textColor = color || C.ink;
  t.lineLimit = opts.lines || 1;
  t.minimumScaleFactor = opts.scale || 0.8;
  return t;
}
function shortName(s, n) { s = String(s); return s.length > n ? s.slice(0, n) + '…' : s; }

function noteFor(name, r) {
  if (r.state !== 'cache') return '';
  return name + '：更新できませんでした ' + hm(new Date());
}

// タスク表の列
function drawTask(col, r, big) {
  text(col, 'タスク表', 11, C.muted, { bold: true });
  col.addSpacer(2);
  if (r.state === 'unset') { text(col, '未設定（スクリプトの上の方に貼ってください）', 11, C.muted, { lines: 3 }); return; }
  if (r.state === 'none') { text(col, '読み込めませんでした', 12, C.warn, { lines: 2 }); text(col, errorText(r.error), 11, C.muted, { lines: 2 }); return; }
  const s = taskSummary(r.data);
  const row = col.addStack();
  row.layoutHorizontally();
  row.bottomAlignContent();
  text(row, String(s.count), big ? 30 : 24, C.ink, { bold: true });
  text(row, ' 件', 12, C.muted);
  row.addSpacer(6);
  if (s.carry) text(row, '持ち越し ' + s.carry, 11, C.rose);
  col.addSpacer(3);
  if (!s.top.length) text(col, s.count ? '待ちのタスクだけです' : '今日のタスクはありません', 11, C.muted, { lines: 2 });
  s.top.forEach(n => { text(col, '・' + n, big ? 13 : 12, C.ink, { lines: 1, scale: 0.75 }); col.addSpacer(1); });
}

// ルーティンの列
function drawRoutine(col, r, big) {
  text(col, 'ルーティン', 11, C.muted, { bold: true });
  col.addSpacer(2);
  if (r.state === 'unset') { text(col, '未設定（スクリプトの上の方に貼ってください）', 11, C.muted, { lines: 3 }); return; }
  if (r.state === 'none') { text(col, '読み込めませんでした', 12, C.warn, { lines: 2 }); text(col, errorText(r.error), 11, C.muted, { lines: 2 }); return; }
  const s = routineSummary(r.data, new Date());
  const max = big ? 8 : 4;
  s.habits.slice(0, max).forEach(h => {
    const row = col.addStack();
    row.layoutHorizontally();
    text(row, h.done ? '○' : '×', 12, h.done ? C.sage : C.muted, { bold: true });
    row.addSpacer(4);
    text(row, shortName(h.name, big ? 14 : 8), 12, h.done ? C.ink : C.muted);
    col.addSpacer(1);
  });
  if (s.habits.length > max) text(col, 'ほか ' + (s.habits.length - max) + 'つ', 10, C.muted);
  if (!s.sameDay && s.dataDay) text(col, '（' + md(s.dataDay) + ' の記録）', 10, C.muted);
  col.addSpacer(3);
  text(col, '連続 ' + s.streak + '日', 12, C.blue, { bold: true });
  if (s.per) text(col, '生理 ' + s.per, 12, C.rose, { bold: true });
}

// 小さいサイズ：数字だけ
function drawSmall(w, task, routine) {
  text(w, 'きょう', 11, C.muted, { bold: true });
  w.addSpacer(4);
  if (task.state === 'ok' || task.state === 'cache') {
    const s = taskSummary(task.data);
    text(w, 'タスク ' + s.count + '件', 15, C.ink, { bold: true });
    if (s.carry) text(w, '持ち越し ' + s.carry, 11, C.rose);
  } else text(w, 'タスク ' + (task.state === 'unset' ? '未設定' : '—'), 13, C.muted);
  w.addSpacer(4);
  if (routine.state === 'ok' || routine.state === 'cache') {
    const s = routineSummary(routine.data, new Date());
    const n = s.habits.filter(h => h.done).length;
    text(w, '習慣 ' + n + '/' + s.habits.length + '　連続 ' + s.streak + '日', 12, C.ink);
    if (s.per) text(w, '生理 ' + s.per, 12, C.rose, { bold: true });
  } else text(w, 'ルーティン ' + (routine.state === 'unset' ? '未設定' : '—'), 12, C.muted);
}

// ロック画面など（とても小さい）
function drawAccessory(w, task, routine) {
  const parts = [];
  if (task.data) parts.push('タスク' + taskSummary(task.data).count);
  if (routine.data) {
    const s = routineSummary(routine.data, new Date());
    parts.push('習慣' + s.habits.filter(h => h.done).length + '/' + s.habits.length);
    if (s.per) parts.push('生理' + s.per);
  }
  text(w, parts.length ? parts.join(' ') : '未設定', 12, null, { lines: 2, scale: 0.6 });
}

// 4つとも空のとき：設定の案内
function drawSetup(w) {
  text(w, 'ウィジェットの準備', 14, C.ink, { bold: true });
  w.addSpacer(4);
  text(w, 'Scriptable でこのスクリプトを開き、いちばん上の CONFIG に4つ（ルーティンの送り先URL・見るだけ用の合言葉、タスク表の送り先URL・見るだけ用の合言葉）を貼ってください。手順は widget/README.md にあります。', 11, C.muted, { lines: 6, scale: 0.7 });
}

function build(family, task, routine) {
  const w = new ListWidget();
  w.backgroundColor = C.bg;
  w.refreshAfterDate = new Date(Date.now() + REFRESH_MIN * 60000);
  // 押しても特別なことはしない（Safari を開くとアプリの接続が無いので、URL は付けない）
  if (task.state === 'unset' && routine.state === 'unset') { w.setPadding(14, 14, 14, 14); drawSetup(w); return w; }
  if (String(family).indexOf('accessory') === 0) { drawAccessory(w, task, routine); return w; }
  if (family === 'small') { w.setPadding(14, 14, 12, 14); drawSmall(w, task, routine); }
  else {
    const big = family === 'large' || family === 'extraLarge';
    w.setPadding(14, 14, 10, 14);
    const row = w.addStack();
    row.layoutHorizontally();
    row.topAlignContent();
    const left = row.addStack(); left.layoutVertically();
    drawTask(left, task, big);
    row.addSpacer(12);
    const right = row.addStack(); right.layoutVertically();
    drawRoutine(right, routine, big);
    row.addSpacer();
    w.addSpacer();
  }
  const notes = [noteFor('タスク表', task), noteFor('ルーティン', routine)].filter(Boolean);
  if (notes.length) {
    w.addSpacer(2);
    text(w, notes.length === 2 ? '更新できませんでした ' + hm(new Date()) : notes[0], 9, C.warn, { scale: 0.7 });
  }
  return w;
}

// ---------- 本体 ----------
const cache = readCache();
// 2つの読み先は別々に読む（片方がだめでも、もう片方は出す）
const [task, routine] = await Promise.all([
  loadOne(cache, 'task', CONFIG.taskUrl.trim(), CONFIG.taskKey.trim(), 'widget'),
  loadOne(cache, 'routine', CONFIG.routineUrl.trim(), CONFIG.routineKey.trim(), 'widget'),
]);
if (task.state === 'ok' || routine.state === 'ok') writeCache(cache);

const family = config.runsInWidget ? (config.widgetFamily || 'medium') : 'medium';
const widget = build(family, task, routine);
if (config.runsInWidget) Script.setWidget(widget);
else await widget.presentMedium();   // アプリの中で実行したときは、中サイズで見本を出す
Script.complete();
