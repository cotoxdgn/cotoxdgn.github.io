/**
 * タスク表スマホ版の通信プログラム（独立した Google Apps Script）
 *
 * ・既存スプシ「_タスク管理2026.09.15~」に付いている Apps Script とは別のプロジェクトです。
 *   script.google.com で「新しいプロジェクト」を作り、このコードを貼り付けて使います。
 *   既存の Apps Script・トリガー・カレンダー連携には一切触りません。
 * ・スプシへの書き込みは次の3つだけです。
 *   1) タスク追加：「_日次ガントチャート」の4行目に1行挿入して入力（下の行は1行ずつ下がるだけで中身は変えない）
 *   2) 完了チェック：その行の「完了」(B列) を TRUE / FALSE にする
 *   3) 実働時間：見出し「実働」の列があれば、その行のセルに時間(h)を書く
 *      「実働」列は自動では作りません。コトさんの承認後に関数「addActualColumn」を1回だけ実行して追加します。
 *
 * 準備（約5分）
 *  1) 関数「setup」を実行（初回は権限の確認が出ます）→ 合言葉が作られます
 *  2) デプロイ → 新しいデプロイ → 種類「ウェブアプリ」／実行ユーザー：自分／アクセスできるユーザー：全員
 *  3) 関数「showConnectLink」を実行 → 実行ログに出るリンクをパソコンで開く
 *     （iPhone は、パソコンの画面の「他の端末を追加（QR）」をホーム画面のアプリで読み取る）
 *
 * 通信の形：POST（Content-Type: text/plain）で JSON → JSON。text/plain なので CORS の事前確認が起きない。
 *  { key, action, ... } → { ok: true, ... } / { ok: false, error }
 *  action: ping / list / add / done / undone / actual
 */

var SPREADSHEET_ID = '1all9BRCbemXapdhjBidydCAjPbw26pNmmyi0wbxk66Q';
var SHEET_NAME = '_日次ガントチャート';
var APP_URL = 'https://cotoxdgn.github.io/task/';
var TZ = 'Asia/Tokyo';

var HEADER_ROW = 1;   // 見出し行
var INSERT_ROW = 4;   // 新しいタスクを入れる行（既存GASと同じ）
var FIRST_ROW = 4;    // ここから下をタスクとして読む
var ACTUAL_HEADER = '実働';

// 見出しの文字で列を探す（列の順番が変わっても動くように）。見つからなければ右の既定列を使う
var COLS = {
  no:     { head: 'No',   def: 1 },
  done:   { head: '完了', def: 2 },
  pj:     { head: 'PJ',   def: 3 },
  todo:   { head: 'ToDo', def: 4 },   // 見出しは「ToDo｜未完了・日付順」など。前方一致で探す
  ko:     { head: '工',   def: 5 },
  date:   { head: '📅',   def: 6 },
  slot:   { head: '⏰',   def: 8 },
  detail: { head: '詳細', def: 11 }
};
var SLOTS = { '朝': '🌅', '昼': '☀️', '夕': '🌙' };
var PROP_KEY = 'TASK_API_KEY';
var MAX_TEXT = 500;

// ---------- 準備 ----------
function setup() {
  var props = PropertiesService.getScriptProperties();
  if (!props.getProperty(PROP_KEY)) {
    props.setProperty(PROP_KEY, Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '').slice(0, 8));
  }
  var sh = sheet_();  // スプシを開けるか確認（読むだけ）
  Logger.log('準備できました。シート「%s」を読めます。次に「デプロイ」→「新しいデプロイ」でウェブアプリにしてください。', sh.getName());
}

// 接続用リンクを実行ログに出す（パソコンで開くとつながる）
function showConnectLink() {
  var link = connectLink_();
  if (!link) {
    Logger.log('ウェブアプリのURLが取れませんでした。先に「デプロイ」→「新しいデプロイ」（ウェブアプリ）をしてください。');
    return;
  }
  Logger.log('このリンクをパソコンで開いてください（合言葉入り・人に見せない）：\n%s', link);
}

/**
 * 「実働」列を1つ追加する（コトさんの承認後に1回だけ手で実行）。
 * 既存の最終列の右隣の1行目に見出し「実働」を書くだけ。既存の列・行・数式・書式は変えない。
 * すでにあれば何もしない。
 */
function addActualColumn() {
  var sh = sheet_();
  var heads = heads_(sh);
  if (findCol_(heads, ACTUAL_HEADER, true)) {
    Logger.log('「実働」列はすでにあります。何もしませんでした。');
    return;
  }
  var col = sh.getLastColumn() + 1;
  if (col > sh.getMaxColumns()) sh.insertColumnsAfter(sh.getMaxColumns(), 1);
  sh.getRange(HEADER_ROW, col).setValue(ACTUAL_HEADER);
  Logger.log('「実働」列を %s 列目に追加しました。', col);
}

function connectLink_() {
  var key = PropertiesService.getScriptProperties().getProperty(PROP_KEY);
  var url = '';
  try { url = ScriptApp.getService().getUrl() || ''; } catch (e) { url = ''; }
  if (!key || !/\/exec$/.test(url)) return '';
  var payload = JSON.stringify({ u: url, k: key, n: SpreadsheetApp.openById(SPREADSHEET_ID).getName() });
  return APP_URL + '#t=' + Utilities.base64EncodeWebSafe(Utilities.newBlob(payload).getBytes()).replace(/=+$/, '');
}

// ---------- 通信の入口 ----------
function doGet() {
  return out_({ ok: true, app: 'task' });
}

function doPost(e) {
  var req;
  try { req = JSON.parse(e.postData.contents); } catch (err) { return out_({ ok: false, error: 'bad_request' }); }
  return out_(handle_(req));
}

function handle_(req) {
  if (!req || typeof req !== 'object') return { ok: false, error: 'bad_request' };
  var pass = PropertiesService.getScriptProperties().getProperty(PROP_KEY) || '';
  if (!pass) return { ok: false, error: 'no_setup' };
  if (String(req.key || '') !== pass) return { ok: false, error: 'bad_key' };

  var lock = LockService.getScriptLock();
  try { lock.waitLock(20000); } catch (e) { return { ok: false, error: 'busy' }; }
  try {
    var sh = sheet_();
    var res;
    switch (req.action) {
      case 'ping': res = { name: sh.getParent().getName(), actualColumn: !!findCol_(heads_(sh), ACTUAL_HEADER, true) }; break;
      case 'list': res = list_(sh); break;
      case 'add': res = add_(sh, req); break;
      case 'done': res = setDone_(sh, req, true); break;
      case 'undone': res = setDone_(sh, req, false); break;
      case 'actual': res = actual_(sh, req); break;
      default: res = { error: 'bad_action' };
    }
    if (res.error) return { ok: false, error: res.error };
    res.ok = true;
    res.today = ymd_(new Date());
    return res;
  } catch (err) {
    return { ok: false, error: 'server', detail: String(err && err.message || err).slice(0, 200) };
  } finally {
    lock.releaseLock();
  }
}

// ---------- シートの読み取り ----------
function sheet_() {
  var sh = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName(SHEET_NAME);
  if (!sh) throw new Error('シート「' + SHEET_NAME + '」が見つかりません');
  return sh;
}

function heads_(sh) {
  return sh.getRange(HEADER_ROW, 1, 1, sh.getLastColumn()).getValues()[0].map(function (v) { return String(v).trim(); });
}

// exact=true は完全一致、false は前方一致（ToDo｜… など）
function findCol_(heads, name, exact) {
  for (var i = 0; i < heads.length; i++) {
    if (exact ? heads[i] === name : heads[i].indexOf(name) === 0) return i + 1;
  }
  return 0;
}

function cols_(sh) {
  var heads = heads_(sh);
  var c = {};
  for (var k in COLS) c[k] = findCol_(heads, COLS[k].head, k !== 'todo') || COLS[k].def;
  c.actual = findCol_(heads, ACTUAL_HEADER, true);
  c.width = heads.length;
  return c;
}

function ymd_(d) { return Utilities.formatDate(d, TZ, 'yyyy-MM-dd'); }

// 📅 のセル（日付・文字「10/30」など）を yyyy-MM-dd にそろえる
function cellDate_(v, today) {
  if (v instanceof Date) return ymd_(v);
  var s = String(v || '').trim();
  var m = /^(\d{4})[\/-](\d{1,2})[\/-](\d{1,2})/.exec(s);
  if (m) return m[1] + '-' + pad_(m[2]) + '-' + pad_(m[3]);
  m = /^(\d{1,2})\/(\d{1,2})$/.exec(s);
  if (m) return today.slice(0, 4) + '-' + pad_(m[1]) + '-' + pad_(m[2]);
  return '';
}
function pad_(n) { return ('0' + n).slice(-2); }
function isTrue_(v) { return v === true || String(v).toUpperCase() === 'TRUE'; }
function num_(v) { var n = parseFloat(v); return isFinite(n) ? n : null; }

function rowToTask_(row, v, c, today) {
  var slotEmoji = String(v[c.slot - 1] || '').trim();
  var slot = '';
  for (var k in SLOTS) if (SLOTS[k] === slotEmoji) slot = k;
  return {
    row: row,
    no: num_(v[c.no - 1]),
    done: isTrue_(v[c.done - 1]),
    pj: String(v[c.pj - 1] || ''),
    todo: String(v[c.todo - 1] || ''),
    ko: num_(v[c.ko - 1]),
    date: cellDate_(v[c.date - 1], today),
    slot: slot,
    slotRaw: slot ? '' : slotEmoji,
    detail: String(v[c.detail - 1] || ''),
    actual: c.actual ? num_(v[c.actual - 1]) : null
  };
}

function readAll_(sh, c) {
  var last = sh.getLastRow();
  if (last < FIRST_ROW) return [];
  var vals = sh.getRange(FIRST_ROW, 1, last - FIRST_ROW + 1, c.width).getValues();
  var today = ymd_(new Date());
  var out = [];
  for (var i = 0; i < vals.length; i++) {
    var t = rowToTask_(FIRST_ROW + i, vals[i], c, today);
    if (!t.todo.trim()) continue;
    out.push(t);
  }
  return out;
}

// 今日のタスク：📅が今日以前の未完了（持ち越し含む）＋今日の完了済み。案件名の候補も返す
function list_(sh) {
  var c = cols_(sh);
  var all = readAll_(sh, c);
  var today = ymd_(new Date());
  var tasks = all.filter(function (t) {
    if (!t.date) return false;
    return t.done ? t.date === today : t.date <= today;
  });
  var seen = {}, pjs = [];
  all.forEach(function (t) { if (t.pj && !seen[t.pj]) { seen[t.pj] = true; pjs.push(t.pj); } });
  return { tasks: tasks, projects: pjs, actualColumn: !!c.actual };
}

// No と ToDo の両方が一致する行を探す（行番号は追加のたびにずれるため）
function findTask_(sh, c, req) {
  var no = num_(req.no);
  var todo = String(req.todo || '');
  if (no === null || !todo) return null;
  var all = readAll_(sh, c);
  for (var i = 0; i < all.length; i++) if (all[i].no === no && all[i].todo === todo) return all[i];
  return null;
}

// ---------- 書き込み ----------
function text_(v) { return String(v == null ? '' : v).replace(/[\r\n]+/g, ' ').trim().slice(0, MAX_TEXT); }

// 同じ送信を2回受けても二重に追加しない
function seen_(reqId) {
  if (!reqId) return null;
  var hit = CacheService.getScriptCache().get('req:' + reqId);
  return hit ? JSON.parse(hit) : null;
}
function remember_(reqId, res) {
  if (reqId) CacheService.getScriptCache().put('req:' + reqId, JSON.stringify(res), 21600);
}

function add_(sh, req) {
  var reqId = /^[A-Za-z0-9_-]{8,64}$/.test(String(req.reqId || '')) ? String(req.reqId) : '';
  var prev = seen_(reqId);
  if (prev) return prev;

  var todo = text_(req.todo);
  var parent = text_(req.parent);
  if (!todo) return { error: 'no_todo' };
  var ko = num_(req.ko);
  if (ko === null || ko < 0 || ko > 24) return { error: 'bad_ko' };
  var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(req.date || ''));
  if (!m) return { error: 'bad_date' };
  var slot = String(req.slot || '');
  if (slot && !SLOTS[slot]) return { error: 'bad_slot' };

  var c = cols_(sh);
  // No は今ある最大＋1
  var last = sh.getLastRow();
  var maxNo = 0;
  if (last >= FIRST_ROW) {
    sh.getRange(FIRST_ROW, c.no, last - FIRST_ROW + 1, 1).getValues().forEach(function (r) {
      var n = num_(r[0]); if (n !== null && n > maxNo) maxNo = n;
    });
  }
  var no = maxNo + 1;

  // 4行目に1行挿入（今の4行目以下は1行ずつ下がるだけ）
  sh.insertRowBefore(INSERT_ROW);
  var width = sh.getLastColumn();
  var tpl = sh.getRange(INSERT_ROW + 1, 1, 1, width);   // 押し下げられた元の4行目＝見本
  var row = sh.getRange(INSERT_ROW, 1, 1, width);
  // 見本の行の書式・入力規則（チェックボックスなど）だけ写す
  tpl.copyTo(row, SpreadsheetApp.CopyPasteType.PASTE_FORMAT, false);
  tpl.copyTo(row, SpreadsheetApp.CopyPasteType.PASTE_DATA_VALIDATION, false);
  // 見本の行に数式があるセル（曜日・日付列など）は同じ数式を入れる（相対参照で新しい行用になる）
  var f = tpl.getFormulasR1C1()[0];
  for (var j = 0; j < f.length; j++) {
    if (f[j]) sh.getRange(INSERT_ROW, j + 1).setFormulaR1C1(f[j]);
  }

  var date = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  var set = {};
  set[c.no] = no;
  set[c.done] = false;
  set[c.pj] = text_(req.pj);
  set[c.todo] = parent ? parent + ' | ' + todo : todo;
  set[c.ko] = ko;
  set[c.date] = date;
  set[c.slot] = slot ? SLOTS[slot] : '';
  set[c.detail] = text_(req.detail);
  for (var col in set) {
    if (f[Number(col) - 1]) continue;  // 数式の列には書かない
    sh.getRange(INSERT_ROW, Number(col)).setValue(set[col]);
  }

  var v = sh.getRange(INSERT_ROW, 1, 1, c.width).getValues()[0];
  var res = { task: rowToTask_(INSERT_ROW, v, c, ymd_(new Date())) };
  remember_(reqId, res);
  return res;
}

function setDone_(sh, req, done) {
  var c = cols_(sh);
  var t = findTask_(sh, c, req);
  if (!t) return { error: 'not_found' };
  sh.getRange(t.row, c.done).setValue(done);
  var res = { task: null, actualSaved: false };
  if (done && req.actual !== undefined && req.actual !== null && req.actual !== '') {
    var a = writeActual_(sh, c, t.row, req.actual);
    if (a.error) return a;
    res.actualSaved = a.saved;
  }
  res.task = rowToTask_(t.row, sh.getRange(t.row, 1, 1, c.width).getValues()[0], c, ymd_(new Date()));
  return res;
}

function actual_(sh, req) {
  var c = cols_(sh);
  var t = findTask_(sh, c, req);
  if (!t) return { error: 'not_found' };
  var a = writeActual_(sh, c, t.row, req.actual);
  if (a.error) return a;
  return { actualSaved: a.saved };
}

// 実働(h)：0.25h 単位。「実働」列がなければ書かない（saved:false）
function writeActual_(sh, c, row, value) {
  var n = num_(value);
  if (n === null || n < 0 || n > 24) return { error: 'bad_actual' };
  n = Math.round(n * 4) / 4;
  if (!c.actual) return { saved: false };
  sh.getRange(row, c.actual).setValue(n);
  return { saved: true };
}

function out_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
