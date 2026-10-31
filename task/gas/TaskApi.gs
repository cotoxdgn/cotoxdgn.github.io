/**
 * ============================================================================
 *  ！！ 既存のプロジェクトに入れないこと ！！
 *  このファイルは「script.google.com を直接開いて［新しいプロジェクト］」で作った
 *  専用のプロジェクトに、これ1つだけ入れて使います。
 *  スプシの［拡張機能］→［Apps Script］で開くプロジェクト（色分け・カレンダー・定期タスクなどが
 *  入っているもの）には絶対に追加しないでください。
 *  doGet / doPost が重複すると、既存のウェブアプリや機能が壊れます。
 * ============================================================================
 *
 * タスク表スマホ版の通信プログラム（独立した Google Apps Script）
 *
 * ・既存スプシ「_タスク管理2026.09.15~」に付いている Apps Script とは別のプロジェクトです。
 *   既存の Apps Script・トリガー・カレンダー連携には一切触りません。
 *   名前の衝突を避けるため、設定は TASKAPI の1つにまとめ、内部の関数は taskApi_ で始めています。
 * ・スプシへの書き込みは次の3つだけです。
 *   1) タスク追加：「_日次ガントチャート」の4行目に1行挿入して入力（下の行は1行ずつ下がるだけで中身は変えない）
 *   2) 完了チェック：その行の「完了」(B列) を TRUE / FALSE にする
 *   3) 実働時間：見出し「実働」の列があれば、その行のセルに時間(h)を書く
 *      「実働」列は自動では作りません。コトさんの承認後に関数「taskApiAddActualColumn」を1回だけ実行して追加します。
 *
 * 準備（約5分）
 *  1) script.google.com を直接開いて［新しいプロジェクト］→ このコードを貼り付けて保存
 *  2) 関数「taskApiSetup」を実行（初回は権限の確認が出ます）→ 合言葉が作られます
 *  3) デプロイ → 新しいデプロイ → 種類「ウェブアプリ」／実行ユーザー：自分／アクセスできるユーザー：全員
 *  4) 関数「taskApiShowLink」を実行 → 実行ログに出るリンクをパソコンで開く
 *     （iPhone は、パソコンの画面の「他の端末を追加（QR）」をホーム画面のアプリで読み取る）
 *
 * 通信の形：POST（Content-Type: text/plain）で JSON → JSON。text/plain なので CORS の事前確認が起きない。
 *  { key, action, ... } → { ok: true, ... } / { ok: false, error }
 *  action: ping / list / add / done / undone / actual
 */

var TASKAPI = {
  // ↓ 自動で取れないときだけ、［デプロイを管理］のウェブアプリURL（…/exec）を '' の中に貼る
  EXEC_URL: '',
  SPREADSHEET_ID: '1all9BRCbemXapdhjBidydCAjPbw26pNmmyi0wbxk66Q',
  SHEET_NAME: '_日次ガントチャート',
  APP_URL: 'https://cotoxdgn.github.io/task/',
  TZ: 'Asia/Tokyo',
  HEADER_ROW: 1,   // 見出し行
  INSERT_ROW: 4,   // 新しいタスクを入れる行（既存GASと同じ）
  FIRST_ROW: 4,    // ここから下をタスクとして読む
  ACTUAL_HEADER: '実働',
  // 見出しの文字で列を探す（列の順番が変わっても動くように）。見つからなければ既定列を使う
  COLS: {
    no:     { head: 'No',   def: 1 },
    done:   { head: '完了', def: 2 },
    pj:     { head: 'PJ',   def: 3 },
    todo:   { head: 'ToDo', def: 4 },   // 見出しは「ToDo｜未完了・日付順」など。前方一致で探す
    ko:     { head: '工',   def: 5 },
    date:   { head: '📅',   def: 6 },
    slot:   { head: '⏰',   def: 8 },
    detail: { head: '詳細', def: 11 }
  },
  SLOTS: { '朝': '🌅', '昼': '☀️', '夕': '🌙' },
  PROP_KEY: 'TASK_API_KEY',
  MAX_TEXT: 500
};

// ---------- 準備 ----------
// スプシに付いているプロジェクト（スプシの［拡張機能］から開いたもの）なら true。そこでは動かさない
function taskApi_isBound() {
  var bound = null;
  try { bound = SpreadsheetApp.getActiveSpreadsheet(); } catch (e) { bound = null; }
  if (bound) {
    Logger.log('中止しました：このプロジェクトはスプシに付いています。script.google.com で新しいプロジェクトを作ってください。（このファイルはこのプロジェクトから削除してください）');
    return true;
  }
  return false;
}

function taskApiSetup() {
  if (taskApi_isBound()) return;
  var props = PropertiesService.getScriptProperties();
  if (!props.getProperty(TASKAPI.PROP_KEY)) {
    props.setProperty(TASKAPI.PROP_KEY, Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '').slice(0, 8));
  }
  var sh = taskApi_sheet();  // スプシを開けるか確認（読むだけ）
  Logger.log('準備できました。シート「%s」を読めます。次に「デプロイ」→「新しいデプロイ」でウェブアプリにしてください。', sh.getName());
}

// 接続用リンクを実行ログに出す（パソコンで開くとつながる）
function taskApiShowLink() {
  if (taskApi_isBound()) return;
  var link = taskApi_connectLink();
  if (!link) {
    Logger.log('ウェブアプリのURLが自動で取れませんでした。［デプロイ］→［デプロイを管理］の「ウェブアプリ」URL（…/exec）をコピーし、このファイルの上の方の EXEC_URL: \'\' の \'\' の中に貼って保存してから、もう一度この関数を実行してください（デプロイし直しは不要）。');
    return;
  }
  Logger.log('このリンクをパソコンで開いてください（合言葉入り・人に見せない）：\n%s', link);
}

/**
 * 「実働」列を1つ追加する（コトさんの承認後に1回だけ手で実行）。
 * 既存の最終列の右隣の1行目に見出し「実働」を書くだけ。既存の列・行・数式・書式は変えない。
 * すでにあれば何もしない。
 */
function taskApiAddActualColumn() {
  if (taskApi_isBound()) return;
  var sh = taskApi_sheet();
  var heads = taskApi_heads(sh);
  if (taskApi_findCol(heads, TASKAPI.ACTUAL_HEADER, true)) {
    Logger.log('「実働」列はすでにあります。何もしませんでした。');
    return;
  }
  var col = sh.getLastColumn() + 1;
  if (col > sh.getMaxColumns()) sh.insertColumnsAfter(sh.getMaxColumns(), 1);
  sh.getRange(TASKAPI.HEADER_ROW, col).setValue(TASKAPI.ACTUAL_HEADER);
  Logger.log('「実働」列を %s 列目に追加しました。', col);
}

function taskApi_connectLink() {
  var key = PropertiesService.getScriptProperties().getProperty(TASKAPI.PROP_KEY);
  var url = '';
  try { url = ScriptApp.getService().getUrl() || ''; } catch (e) { url = ''; }
  if (!/\/exec$/.test(url) && TASKAPI.EXEC_URL) url = String(TASKAPI.EXEC_URL).trim();
  if (!key || !/\/exec$/.test(url)) return '';
  var payload = JSON.stringify({ u: url, k: key, n: SpreadsheetApp.openById(TASKAPI.SPREADSHEET_ID).getName() });
  return TASKAPI.APP_URL + '#t=' + Utilities.base64EncodeWebSafe(Utilities.newBlob(payload).getBytes()).replace(/=+$/, '');
}

// ---------- 通信の入口 ----------
function doGet() {
  return taskApi_out({ ok: true, app: 'task' });
}

function doPost(e) {
  var req;
  try { req = JSON.parse(e.postData.contents); } catch (err) { return taskApi_out({ ok: false, error: 'bad_request' }); }
  return taskApi_out(taskApi_handle(req));
}

function taskApi_handle(req) {
  if (!req || typeof req !== 'object') return { ok: false, error: 'bad_request' };
  var pass = PropertiesService.getScriptProperties().getProperty(TASKAPI.PROP_KEY) || '';
  if (!pass) return { ok: false, error: 'no_setup' };
  if (String(req.key || '') !== pass) return { ok: false, error: 'bad_key' };

  var lock = LockService.getScriptLock();
  try { lock.waitLock(20000); } catch (e) { return { ok: false, error: 'busy' }; }
  try {
    var sh = taskApi_sheet();
    var res;
    switch (req.action) {
      case 'ping': res = { name: sh.getParent().getName(), actualColumn: !!taskApi_findCol(taskApi_heads(sh), TASKAPI.ACTUAL_HEADER, true) }; break;
      case 'list': res = taskApi_list(sh); break;
      case 'add': res = taskApi_add(sh, req); break;
      case 'done': res = taskApi_setDone(sh, req, true); break;
      case 'undone': res = taskApi_setDone(sh, req, false); break;
      case 'actual': res = taskApi_actual(sh, req); break;
      default: res = { error: 'bad_action' };
    }
    if (res.error) return { ok: false, error: res.error };
    res.ok = true;
    res.today = taskApi_ymd(new Date());
    return res;
  } catch (err) {
    return { ok: false, error: 'server', detail: String(err && err.message || err).slice(0, 200) };
  } finally {
    lock.releaseLock();
  }
}

// ---------- シートの読み取り ----------
function taskApi_sheet() {
  var sh = SpreadsheetApp.openById(TASKAPI.SPREADSHEET_ID).getSheetByName(TASKAPI.SHEET_NAME);
  if (!sh) throw new Error('シート「' + TASKAPI.SHEET_NAME + '」が見つかりません');
  return sh;
}

function taskApi_heads(sh) {
  return sh.getRange(TASKAPI.HEADER_ROW, 1, 1, sh.getLastColumn()).getValues()[0].map(function (v) { return String(v).trim(); });
}

// exact=true は完全一致、false は前方一致（ToDo｜… など）
function taskApi_findCol(heads, name, exact) {
  for (var i = 0; i < heads.length; i++) {
    if (exact ? heads[i] === name : heads[i].indexOf(name) === 0) return i + 1;
  }
  return 0;
}

function taskApi_cols(sh) {
  var heads = taskApi_heads(sh);
  var c = {};
  for (var k in TASKAPI.COLS) c[k] = taskApi_findCol(heads, TASKAPI.COLS[k].head, k !== 'todo') || TASKAPI.COLS[k].def;
  c.actual = taskApi_findCol(heads, TASKAPI.ACTUAL_HEADER, true);
  c.width = heads.length;
  return c;
}

function taskApi_ymd(d) { return Utilities.formatDate(d, TASKAPI.TZ, 'yyyy-MM-dd'); }

// 📅 のセル（日付・文字「10/30」など）を yyyy-MM-dd にそろえる
function taskApi_cellDate(v, today) {
  if (v instanceof Date) return taskApi_ymd(v);
  var s = String(v || '').trim();
  var m = /^(\d{4})[\/-](\d{1,2})[\/-](\d{1,2})/.exec(s);
  if (m) return m[1] + '-' + taskApi_pad(m[2]) + '-' + taskApi_pad(m[3]);
  m = /^(\d{1,2})\/(\d{1,2})$/.exec(s);
  if (m) return today.slice(0, 4) + '-' + taskApi_pad(m[1]) + '-' + taskApi_pad(m[2]);
  return '';
}
function taskApi_pad(n) { return ('0' + n).slice(-2); }
function taskApi_isTrue(v) { return v === true || String(v).toUpperCase() === 'TRUE'; }
function taskApi_num(v) { var n = parseFloat(v); return isFinite(n) ? n : null; }

function taskApi_rowToTask(row, v, c, today) {
  var slotEmoji = String(v[c.slot - 1] || '').trim();
  var slot = '';
  for (var k in TASKAPI.SLOTS) if (TASKAPI.SLOTS[k] === slotEmoji) slot = k;
  return {
    row: row,
    no: taskApi_num(v[c.no - 1]),
    done: taskApi_isTrue(v[c.done - 1]),
    pj: String(v[c.pj - 1] || ''),
    todo: String(v[c.todo - 1] || ''),
    ko: taskApi_num(v[c.ko - 1]),
    date: taskApi_cellDate(v[c.date - 1], today),
    slot: slot,
    slotRaw: slot ? '' : slotEmoji,
    detail: String(v[c.detail - 1] || ''),
    actual: c.actual ? taskApi_num(v[c.actual - 1]) : null
  };
}

function taskApi_readAll(sh, c) {
  var last = sh.getLastRow();
  if (last < TASKAPI.FIRST_ROW) return [];
  var vals = sh.getRange(TASKAPI.FIRST_ROW, 1, last - TASKAPI.FIRST_ROW + 1, c.width).getValues();
  var today = taskApi_ymd(new Date());
  var out = [];
  for (var i = 0; i < vals.length; i++) {
    var t = taskApi_rowToTask(TASKAPI.FIRST_ROW + i, vals[i], c, today);
    if (!t.todo.trim()) continue;
    out.push(t);
  }
  return out;
}

// 今日のタスク：📅が今日以前の未完了（持ち越し含む）＋今日の完了済み。案件名の候補も返す
function taskApi_list(sh) {
  var c = taskApi_cols(sh);
  var all = taskApi_readAll(sh, c);
  var today = taskApi_ymd(new Date());
  var tasks = all.filter(function (t) {
    if (!t.date) return false;
    return t.done ? t.date === today : t.date <= today;
  });
  var seen = {}, pjs = [];
  all.forEach(function (t) { if (t.pj && !seen[t.pj]) { seen[t.pj] = true; pjs.push(t.pj); } });
  return { tasks: tasks, projects: pjs, actualColumn: !!c.actual };
}

// No と ToDo の両方が一致する行を探す（行番号は追加のたびにずれるため）
function taskApi_findTask(sh, c, req) {
  var no = taskApi_num(req.no);
  var todo = String(req.todo || '');
  if (no === null || !todo) return null;
  var all = taskApi_readAll(sh, c);
  for (var i = 0; i < all.length; i++) if (all[i].no === no && all[i].todo === todo) return all[i];
  return null;
}

// ---------- 書き込み ----------
function taskApi_text(v) { return String(v == null ? '' : v).replace(/[\r\n]+/g, ' ').trim().slice(0, TASKAPI.MAX_TEXT); }

// 同じ送信を2回受けても二重に追加しない
function taskApi_seen(reqId) {
  if (!reqId) return null;
  var hit = CacheService.getScriptCache().get('req:' + reqId);
  return hit ? JSON.parse(hit) : null;
}
function taskApi_remember(reqId, res) {
  if (reqId) CacheService.getScriptCache().put('req:' + reqId, JSON.stringify(res), 21600);
}

function taskApi_add(sh, req) {
  var reqId = /^[A-Za-z0-9_-]{8,64}$/.test(String(req.reqId || '')) ? String(req.reqId) : '';
  var prev = taskApi_seen(reqId);
  if (prev) return prev;

  var todo = taskApi_text(req.todo);
  var parent = taskApi_text(req.parent);
  if (!todo) return { error: 'no_todo' };
  var ko = taskApi_num(req.ko);
  if (ko === null || ko < 0 || ko > 24) return { error: 'bad_ko' };
  var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(req.date || ''));
  if (!m) return { error: 'bad_date' };
  var slot = String(req.slot || '');
  if (slot && !TASKAPI.SLOTS[slot]) return { error: 'bad_slot' };

  var c = taskApi_cols(sh);
  // No は今ある最大＋1
  var last = sh.getLastRow();
  var maxNo = 0;
  if (last >= TASKAPI.FIRST_ROW) {
    sh.getRange(TASKAPI.FIRST_ROW, c.no, last - TASKAPI.FIRST_ROW + 1, 1).getValues().forEach(function (r) {
      var n = taskApi_num(r[0]); if (n !== null && n > maxNo) maxNo = n;
    });
  }
  var no = maxNo + 1;

  // 4行目に1行挿入（今の4行目以下は1行ずつ下がるだけ）
  sh.insertRowBefore(TASKAPI.INSERT_ROW);
  var width = sh.getLastColumn();
  var tpl = sh.getRange(TASKAPI.INSERT_ROW + 1, 1, 1, width);   // 押し下げられた元の4行目＝見本
  var row = sh.getRange(TASKAPI.INSERT_ROW, 1, 1, width);
  // 見本の行の書式・入力規則（チェックボックスなど）だけ写す
  tpl.copyTo(row, SpreadsheetApp.CopyPasteType.PASTE_FORMAT, false);
  tpl.copyTo(row, SpreadsheetApp.CopyPasteType.PASTE_DATA_VALIDATION, false);
  // 見本の行に数式があるセル（曜日・日付列など）は同じ数式を入れる（相対参照で新しい行用になる）
  var f = tpl.getFormulasR1C1()[0];
  for (var j = 0; j < f.length; j++) {
    if (f[j]) sh.getRange(TASKAPI.INSERT_ROW, j + 1).setFormulaR1C1(f[j]);
  }

  var date = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  var set = {};
  set[c.no] = no;
  set[c.done] = false;
  set[c.pj] = taskApi_text(req.pj);
  set[c.todo] = parent ? parent + ' | ' + todo : todo;
  set[c.ko] = ko;
  set[c.date] = date;
  set[c.slot] = slot ? TASKAPI.SLOTS[slot] : '';
  set[c.detail] = taskApi_text(req.detail);
  for (var col in set) {
    if (f[Number(col) - 1]) continue;  // 数式の列には書かない
    sh.getRange(TASKAPI.INSERT_ROW, Number(col)).setValue(set[col]);
  }

  var v = sh.getRange(TASKAPI.INSERT_ROW, 1, 1, c.width).getValues()[0];
  var res = { task: taskApi_rowToTask(TASKAPI.INSERT_ROW, v, c, taskApi_ymd(new Date())) };
  taskApi_remember(reqId, res);
  return res;
}

function taskApi_setDone(sh, req, done) {
  var c = taskApi_cols(sh);
  var t = taskApi_findTask(sh, c, req);
  if (!t) return { error: 'not_found' };
  sh.getRange(t.row, c.done).setValue(done);
  var res = { task: null, actualSaved: false };
  if (done && req.actual !== undefined && req.actual !== null && req.actual !== '') {
    var a = taskApi_writeActual(sh, c, t.row, req.actual);
    if (a.error) return a;
    res.actualSaved = a.saved;
  }
  res.task = taskApi_rowToTask(t.row, sh.getRange(t.row, 1, 1, c.width).getValues()[0], c, taskApi_ymd(new Date()));
  return res;
}

function taskApi_actual(sh, req) {
  var c = taskApi_cols(sh);
  var t = taskApi_findTask(sh, c, req);
  if (!t) return { error: 'not_found' };
  var a = taskApi_writeActual(sh, c, t.row, req.actual);
  if (a.error) return a;
  return { actualSaved: a.saved };
}

// 実働(h)：0.1h 単位。「実働」列がなければ書かない（saved:false）
function taskApi_writeActual(sh, c, row, value) {
  var n = taskApi_num(value);
  if (n === null || n < 0 || n > 24) return { error: 'bad_actual' };
  n = Math.round(n * 10) / 10;
  if (!c.actual) return { saved: false };
  sh.getRange(row, c.actual).setValue(n);
  return { saved: true };
}

function taskApi_out(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
