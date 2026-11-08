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
 * ・スプシへの書き込みは次の4つだけです。
 *   1) タスク追加：「_日次ガントチャート」の最終行の下に追加し、📅順に並べ替える（2026-11-05 変更。旧：4行目に挿入）
 *   2) 完了チェック：その行の「完了」(B列) を TRUE / FALSE にする
 *   3) 実働時間：見出し「実働」の列があれば、その行のセルに時間(h)を書く
 *      「実働」列は自動では作りません。コトさんの承認後に関数「taskApiAddActualColumn」を1回だけ実行して追加します。
 *   4) タスクの設定：その行の「ToDo」「📅」「⏰」「👤」「前提」「詳細」のセルだけを書く（setWait。詳細の⛓工程表の印は消させない）
 *   5) タスクの削除：No と ToDo が一致する1行を削除する（remove。アプリで2回確かめてから送る）
 *      ほかの未完了タスクの「前提」に入っているタスクは消さない（消すと相手がずっと前提待ちになるため）
 *   6) 定期タスク（2026-11-06）：スプシの「_定期タスク」表に、決まりを1行足す・直す・有効を外す（recurSave / recurToggle）。行は消さない
 *      日次ガントへの書き出しは、スプシに付いている「定期タスク.gs」の毎朝8時の仕組みのまま（このファイルでは変えない）
 *      「今日の分もすぐ入れる」のときだけ、今日の1件を 1) と同じ方法で足し、「_定期ログ」に記録する（翌朝の自動追加と重ならない）
 *   7) 完了の古い行の移動（2026-11-08）：アプリで一覧を見て2回確かめたときだけ。完了して📅から30日たった行を
 *      「_完了アーカイブ」シートの下に写してから、日次ガントの行を消す。前提にされている行・工程表連動（⛓）の行は移さない
 *   8) 工程の組み立て（2026-11-08）：アプリで変更点の一覧を見て2回確かめたときだけ。タスク表（＝工程表）の
 *      📅・ToDo・工・詳細を書き換え、行を足す。「外す」は行を消さず、📅を空にして詳細に「🚫外す」を付ける（集計から外れる）
 *      工程表のスプシと連動している行（詳細に⛓）は、工程表の 開始日・終了日・集計対象 もそろえる（数式のセルは書かない）
 *      「_ひな形」シート（非表示・値だけ）に工程のひな形を保存する。同じ名前の上書きはアプリで2回確かめてから
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
 *  action: ping / list / add / done / undone / actual / setWait（📅・⏰・👤・前提を書く）/ remove
 *          recurList / recurSave / recurToggle（定期タスクの表）
 *          pj（案件ごとのガント用：全タスクの No・完了・PJ・ToDo・工・📅・前提だけ。アーカイブも含む）
 *          weight（シートの重さ）／ archivePreview・archiveRun（完了して30日たった行を「_完了アーカイブ」へ移す）
 *          tmplList・tmplSave（工程のひな形「_ひな形」シート）／ kumitate（工程の組み立ての反映）
 *          widget（iPhone のホーム画面のウィジェット用。今日と明日の未完了タスクだけ。見るだけ用の合言葉でも使える）
 *
 * 見るだけ用の合言葉（ウィジェット用）
 *  関数「taskApiShowViewKey」を実行 → 実行ログに出る合言葉を Scriptable のスクリプトに貼る（スクリプトのプロパティ TASK_VIEW_KEY に保存）。
 *  この合言葉で出来るのは widget だけ（ほかの action は合言葉違いと同じ bad_key）。スプシには何も書けない。
 *  漏れたかもと思ったら「taskApiRenewViewKey」で作り直す（いつもの合言葉・つないだ端末はそのまま）。
 */

var TASKAPI = {
  // ↓ 自動で取れないときだけ、［デプロイを管理］のウェブアプリURL（…/exec）を '' の中に貼る
  EXEC_URL: '',
  SPREADSHEET_ID: '1all9BRCbemXapdhjBidydCAjPbw26pNmmyi0wbxk66Q',
  SHEET_NAME: '_日次ガントチャート',
  APP_URL: 'https://cotoxdgn.github.io/task/',
  APP_TITLE: '',        // アプリの上に出す名前（空ならスプシの名前）。公開するコードには名前を書かず、デプロイ先でここに入れる
  ARCHIVE_OFF: false,   // true：完了行の移動（アーカイブ）をしない（スプシ側の別の仕組みに任せる表のとき）
  TZ: 'Asia/Tokyo',
  HEADER_ROW: 1,   // 見出し行
  INSERT_ROW: 4,   // 旧方式の挿入行（2026-11-05 以降は使っていない）
  FIRST_ROW: 4,    // ここから下をタスクとして読む
  ACTUAL_HEADER: '実働',
  PRE_HEADER: '前提',
  STAGE_HEADER: '段階', // 段階（親タスク）の列。ある表では ToDo に「段階 | 」を付けずに分けて持つ // 前提タスクの列（「No.タイトル」。その No が未完了なら「前提待ち」）
  WAIT_HEADER: '👤',  // 待ち相手の列（空でなければ、アプリに「〇〇待ち」と出す）
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
  SLOTS: { '朝': '🌅', '昼': '☀️', '夕': '🌙', '移動': '🚃' },
  PROP_KEY: 'TASK_API_KEY',
  PROP_VIEW_KEY: 'TASK_VIEW_KEY',   // 見るだけ用の合言葉（ウィジェット用。widget だけ）
  MAX_TEXT: 500,
  // 定期タスクの表（スプシに付いている「定期タスク.gs」と同じ名前・列）
  TMPL: { SHEET: '_ひな形', HEAD: ['ひな形', '順番', '親タスク', '詳細', '工', '必要な◆', '依頼の待ち日数', 'メモ'], PROP_PJ: 'TASK_PJ_TMPL' },
  // 工程表連動（⛓キー）の工程表スプシ：キーの頭8文字 → スプレッドシートID（案件連動.gs の KL_FILES と同じもの）
  KOUTEI: { FILES: { '1_kvC8TW': '1_kvC8TWc3dJ2w2uPX2g1NUjP8UZBUNRpL-ZfW45x4m8' }, SHEET: '工程表', HEAD_ROW: 7 },
  EXCLUDE_TAG: '🚫外す',
  ARCHIVE: { SHEET: '_完了アーカイブ', DAYS: 30, PROP_LAST: 'TASK_ARCHIVE_LAST' },
  WEEKLY: { SHEET: '_週次ガントチャート', FIRST_ROW: 5 },   // 案件の並び順＝週次シートのA列の順（上ほど優先）
  WEIGHT_CELLS: 200000,   // シートの重さの目安（日次ガントの 行×列）。これを100%として表示する
  RECUR: { SHEET: '_定期タスク', LOG: '_定期ログ', TYPES: ['毎週', '毎日', '平日', '毎月'], WIDTH: 10, WDAYS: '月火水木金土日' }
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

// 見るだけ用の合言葉（ウィジェット用）を実行ログに出す。なければ作る
function taskApiShowViewKey() {
  if (taskApi_isBound()) return;
  Logger.log('見るだけ用の合言葉（ウィジェットに貼る。人に見せない）：\n%s\n送り先URL：%s', taskApi_viewKey(false), taskApi_execUrl() || '（［デプロイを管理］のウェブアプリURL）');
}

// 見るだけ用の合言葉を作り直す（古い合言葉のウィジェットは読めなくなる）
function taskApiRenewViewKey() {
  if (taskApi_isBound()) return;
  Logger.log('作り直しました。ウィジェットの合言葉を貼り替えてください：\n%s', taskApi_viewKey(true));
}

function taskApi_viewKey(renew) {
  var props = PropertiesService.getScriptProperties();
  var pass = props.getProperty(TASKAPI.PROP_KEY) || '';
  var k = props.getProperty(TASKAPI.PROP_VIEW_KEY) || '';
  if (!k || renew || k === pass) {
    do { k = 'vw' + Utilities.getUuid().replace(/-/g, ''); } while (k === pass);
    props.setProperty(TASKAPI.PROP_VIEW_KEY, k);
  }
  return k;
}

function taskApi_execUrl() {
  var url = '';
  try { url = ScriptApp.getService().getUrl() || ''; } catch (e) { url = ''; }
  if (!/\/exec$/.test(url) && TASKAPI.EXEC_URL) url = String(TASKAPI.EXEC_URL).trim();
  return /\/exec$/.test(url) ? url : '';
}

function taskApi_connectLink() {
  var key = PropertiesService.getScriptProperties().getProperty(TASKAPI.PROP_KEY);
  var url = '';
  try { url = ScriptApp.getService().getUrl() || ''; } catch (e) { url = ''; }
  if (!/\/exec$/.test(url) && TASKAPI.EXEC_URL) url = String(TASKAPI.EXEC_URL).trim();
  if (!key || !/\/exec$/.test(url)) return '';
  var payload = JSON.stringify({ u: url, k: key, n: TASKAPI.APP_TITLE || SpreadsheetApp.openById(TASKAPI.SPREADSHEET_ID).getName() });
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
  // 見るだけ用の合言葉（ウィジェット）は widget だけ。ほかの action は合言葉違いと同じ答えで断る
  var view = PropertiesService.getScriptProperties().getProperty(TASKAPI.PROP_VIEW_KEY) || '';
  var viewOnly = !!view && view !== pass && String(req.key || '') === view;
  if (viewOnly && req.action !== 'widget') return { ok: false, error: 'bad_key' };
  if (!viewOnly && String(req.key || '') !== pass) return { ok: false, error: 'bad_key' };
  if (req.action === 'widget') {   // 読むだけ（書かない）なので、順番待ち（ロック）なしで返す
    try {
      var w = taskApi_widget(taskApi_sheet());
      w.ok = true;
      return w;
    } catch (err) {
      return { ok: false, error: 'server' };   // 見るだけ用の窓口ではシート名などの中身を出さない
    }
  }

  // 読むだけの action は順番待ち（ロック）なしで返す（書き込みの終わりを待たない＝速い。2026-11-08）
  var READ = { ping: 1, list: 1, pj: 1, weight: 1, recurList: 1, tmplList: 1, archivePreview: 1 };
  if (READ[req.action]) {
    try {
      var rsh = taskApi_sheet(), rres;
      switch (req.action) {
        case 'ping': rres = { name: TASKAPI.APP_TITLE || rsh.getParent().getName(), actualColumn: !!taskApi_findCol(taskApi_heads(rsh), TASKAPI.ACTUAL_HEADER, true) }; break;
        case 'list': rres = taskApi_list(rsh, req.withPj === true); break;
        case 'pj': rres = taskApi_pj(rsh); break;
        case 'weight': rres = taskApi_weight(rsh); break;
        case 'recurList': rres = taskApi_recurList(); break;
        case 'tmplList': rres = taskApi_tmplList(); break;
        case 'archivePreview': rres = TASKAPI.ARCHIVE_OFF ? { items: [], total: 0, days: TASKAPI.ARCHIVE.DAYS } : taskApi_archivePreview(rsh); break;
      }
      if (rres.error) return rres.detail ? { ok: false, error: rres.error, detail: rres.detail } : { ok: false, error: rres.error };
      rres.ok = true; rres.today = taskApi_ymd(new Date());
      return rres;
    } catch (err) {
      return { ok: false, error: 'server', detail: String(err && err.message || err).slice(0, 200) };
    }
  }

  var lock = LockService.getScriptLock();
  try { lock.waitLock(20000); } catch (e) { return { ok: false, error: 'busy' }; }
  try {
    var sh = taskApi_sheet();
    var res;
    switch (req.action) {
      case 'ping': res = { name: TASKAPI.APP_TITLE || sh.getParent().getName(), actualColumn: !!taskApi_findCol(taskApi_heads(sh), TASKAPI.ACTUAL_HEADER, true) }; break;
      case 'list': res = taskApi_list(sh); break;
      case 'add': res = taskApi_add(sh, req); break;
      case 'done': res = taskApi_setDone(sh, req, true); break;
      case 'undone': res = taskApi_setDone(sh, req, false); break;
      case 'actual': res = taskApi_actual(sh, req); break;
      case 'setWait': res = taskApi_setWait(sh, req); break;
      case 'remove': res = taskApi_remove(sh, req); break;
      case 'recurList': res = taskApi_recurList(); break;
      case 'recurSave': res = taskApi_recurSave(sh, req); break;
      case 'recurToggle': res = taskApi_recurToggle(req); break;
      case 'pj': res = taskApi_pj(sh); break;
      case 'weight': res = taskApi_weight(sh); break;
      case 'archivePreview': res = TASKAPI.ARCHIVE_OFF ? { items: [], total: 0, days: TASKAPI.ARCHIVE.DAYS } : taskApi_archivePreview(sh); break;
      case 'archiveRun': res = TASKAPI.ARCHIVE_OFF ? { moved: 0 } : taskApi_archiveRun(sh, req); break;
      case 'tmplList': res = taskApi_tmplList(); break;
      case 'tmplSave': res = taskApi_tmplSave(req); break;
      case 'kumitate': res = taskApi_kumitate(sh, req); break;
      default: res = { error: 'bad_action' };
    }
    if (res.error) return res.detail ? { ok: false, error: res.error, detail: res.detail } : { ok: false, error: res.error };
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
/**
 * 「実働」列を「工」のすぐ右へ移す（2026-10-31 コトさん承認済み・1回だけ手で実行）。
 *  1) 「工」の右に1列挿入して見出し「実働」を書く（ガントの数式・週次の参照は自動でずれる）
 *  2) 古い「実働」列（ガントの右側）の値を新しい列へ写し、古い列の見出しと値を消す（列そのものは消さない）
 * すでに「工」のすぐ右にあれば何もしない。
 */
function taskApiMoveActualColumn() {
  if (taskApi_isBound()) return;
  var sh = taskApi_sheet();
  var heads = taskApi_heads(sh);
  var ko = taskApi_findCol(heads, TASKAPI.COLS.ko.head, true) || TASKAPI.COLS.ko.def;
  var old = taskApi_findCol(heads, TASKAPI.ACTUAL_HEADER, true);
  if (old === ko + 1) { Logger.log('「実働」列はすでに「工」の右にあります。何もしませんでした。'); return; }

  sh.insertColumnAfter(ko);
  var col = ko + 1;
  if (old > ko) old += 1;   // 挿入で1つ右にずれる
  var last = Math.max(sh.getLastRow(), TASKAPI.FIRST_ROW);
  var n = last - TASKAPI.FIRST_ROW + 1;
  sh.getRange(TASKAPI.HEADER_ROW, col).setValue(TASKAPI.ACTUAL_HEADER);
  var body = sh.getRange(TASKAPI.FIRST_ROW, col, n, 1);
  body.clearDataValidations().setNumberFormat('0.0#');
  var moved = 0;
  if (old) {
    var src = sh.getRange(TASKAPI.FIRST_ROW, old, n, 1);
    var vals = src.getValues();
    vals.forEach(function (r) { if (r[0] !== '' && r[0] !== null) moved++; });
    body.setValues(vals);
    src.clearContent();
    sh.getRange(TASKAPI.HEADER_ROW, old).clearContent();
  }
  Logger.log('「実働」列を %s 列目（工の右）に作りました。古い列から %s 件の値を移し、古い列（%s 列目）の見出しと値を消しました。', col, moved, old || 'なし');
}

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
  // 待ち相手（👤）：見つからないときは読まない（違う列を「待ち」と表示しないため、既定列は使わない）
  c.pre = taskApi_findCol(heads, TASKAPI.PRE_HEADER, false);
  c.wait = taskApi_findCol(heads.map(function (x) { return x.replace(/[\uFE0E\uFE0F]/g, ''); }), TASKAPI.WAIT_HEADER, false);
  // 段階（親タスク）の列：あればそこを段階として読み書きする。なければ ToDo の「段階 | 子」の形（2026-11-08）
  c.stage = taskApi_findCol(heads, TASKAPI.STAGE_HEADER, true);
  // 読む幅は使う列の一番右まで（右側のガントの日付列は読まない＝行が増えても重くならない）
  c.width = Math.max(c.no, c.done, c.pj, c.todo, c.ko, c.date, c.slot, c.detail, c.actual || 0, c.pre || 0, c.wait || 0, c.stage || 0);
  c.heads = heads.length;
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
    actual: c.actual ? taskApi_num(v[c.actual - 1]) : null,
    wait: c.wait ? taskApi_text(v[c.wait - 1]).slice(0, 40) : '',
    pre: c.pre ? taskApi_text(v[c.pre - 1]).slice(0, 60) : '',
    stage: c.stage ? taskApi_text(v[c.stage - 1]).slice(0, 100) : '',
    preWait: false   // taskApi_list で、前提の No が未完了かどうかを見て決める
  };
}

// first：読み始める行（日次ガントは4行目から。アーカイブは見出しのすぐ下の2行目から）
function taskApi_readAll(sh, c, first) {
  first = first || TASKAPI.FIRST_ROW;
  var last = sh.getLastRow();
  if (last < first) return [];
  // 下の方が数式だけの空き行なら、ToDo が入っている一番下の行までに縮めてから読む（読む量を減らす）
  var todos = sh.getRange(first, c.todo, last - first + 1, 1).getValues();
  while (last >= first && String(todos[last - first][0]).trim() === '') last--;
  if (last < first) return [];
  var vals = sh.getRange(first, 1, last - first + 1, c.width).getValues();
  var today = taskApi_ymd(new Date());
  var out = [];
  for (var i = 0; i < vals.length; i++) {
    var t = taskApi_rowToTask(first + i, vals[i], c, today);
    if (!t.todo.trim()) continue;
    out.push(t);
  }
  return out;
}

// 今日のタスク：📅が今日以前の未完了（持ち越し含む）＋今日の完了済み。案件名の候補も返す
function taskApi_list(sh, withPj) {
  var c = taskApi_cols(sh);
  var all = taskApi_readAll(sh, c);
  var today = taskApi_ymd(new Date());
  var tasks = all.filter(function (t) {
    if (!t.date) return false;
    return t.done ? t.date === today : t.date <= today;
  });
  // 明日（日本時間の次の日）の未完了：アプリで「明日」として見るだけ
  var tomorrowDate = taskApi_ymd(new Date(new Date().getTime() + 24 * 3600 * 1000));
  var tomorrow = all.filter(function (t) { return !t.done && t.date === tomorrowDate; });
  taskApi_markPreWait(all, tasks.concat(tomorrow));
  var seen = {}, pjs = [];
  all.forEach(function (t) { if (t.pj && !seen[t.pj]) { seen[t.pj] = true; pjs.push(t.pj); } });
  // 前提の選択肢：未完了で No と ToDo があるタスク（スプシのプルダウンと同じ「12.ToDo」の形）
  var preOptions = all.filter(function (t) { return !t.done && t.no !== null && t.todo; })
    .slice(0, 400).map(function (t) { return { no: t.no, label: t.no + '.' + t.todo, pj: t.pj, date: t.date }; });
  // 👤の候補：これまでに入れたことのある名前
  var pseen = {}, people = [];
  all.forEach(function (t) { if (t.wait && !pseen[t.wait]) { pseen[t.wait] = true; people.push(t.wait); } });
  var out = { tasks: tasks, tomorrow: tomorrow, tomorrowDate: tomorrowDate, projects: pjs, actualColumn: !!c.actual, preOptions: preOptions, people: people.slice(0, 30),
    waitColumn: !!c.wait, preColumn: !!c.pre, stageColumn: !!c.stage };
  if (withPj) { out.all = taskApi_pjFrom(all).tasks; out.pjOrder = taskApi_pjOrder(); }   // 案件のガント用（同じ読み込みを使い回す＝もう1回通信しない）
  return out;
}

// 前提：「No.タイトル」の No が完了済みなら待ちではない。番号が読めない・見つからないときは待ちとして扱う
function taskApi_markPreWait(all, tasks) {
  var doneByNo = {};
  all.forEach(function (t) { if (t.no !== null) doneByNo[t.no] = t.done; });
  tasks.forEach(function (t) {
    if (!t.pre) return;
    var m = /^\s*(?:No)?(\d+)/.exec(t.pre);
    t.preWait = !(m && doneByNo[Number(m[1])] === true);
  });
}

// widget：今日の未完了（📅が今日以前＝持ち越し含む）と、明日（日本時間の次の日・taskApi_list の tomorrow と同じ）の未完了だけ。
//  返すのは todo・pj・date・slot（朝・昼・夕・移動・空）・wait（👤が入っているか）・preWait・done
//  （詳細・前提の中身・👤の名前・No・行番号・候補の一覧は返さない）
function taskApi_widget(sh) {
  var c = taskApi_cols(sh);
  var all = taskApi_readAll(sh, c);
  var today = taskApi_ymd(new Date());
  var tomorrowDate = taskApi_ymd(new Date(new Date().getTime() + 24 * 3600 * 1000));
  var tasks = all.filter(function (t) { return !t.done && t.date && t.date <= today; });
  var tomorrow = all.filter(function (t) { return !t.done && t.date === tomorrowDate; });
  taskApi_markPreWait(all, tasks.concat(tomorrow));
  var slim = function (t) {
    return { todo: t.todo.slice(0, 100), pj: t.pj.slice(0, 40), date: t.date, slot: t.slot, wait: !!t.wait, preWait: t.preWait, done: false };
  };
  return { today: today, tasks: tasks.map(slim), tomorrowDate: tomorrowDate, tomorrow: tomorrow.map(slim) };
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
  var dataW = taskApi_dataWidth(sh);   // A列〜ガントの手前の列まで（ガント列は数式が自動で計算するので触らない）
  var last = taskApi_lastDataRow(sh, c);
  // No は今ある最大＋1
  var maxNo = 0;
  if (last >= TASKAPI.FIRST_ROW) {
    sh.getRange(TASKAPI.FIRST_ROW, c.no, last - TASKAPI.FIRST_ROW + 1, 1).getValues().forEach(function (r) {
      var n = taskApi_num(r[0]); if (n !== null && n > maxNo) maxNo = n;
    });
  }
  var no = maxNo + 1;

  // 最終行の下に追加（2026-11-05 変更：4行目への挿入はやめた。挿入するとガント・合計の数式の範囲がずれるため）
  var newRow = Math.max(last, TASKAPI.FIRST_ROW - 1) + 1;
  if (newRow > sh.getMaxRows()) sh.insertRowsAfter(sh.getMaxRows(), 1);
  var row = sh.getRange(newRow, 1, 1, dataW);
  var f = [];
  if (last >= TASKAPI.FIRST_ROW) {
    var tpl = sh.getRange(last, 1, 1, dataW);   // 1つ上の行＝見本
    // 見本の行の書式・入力規則（チェックボックスなど）だけ写す
    tpl.copyTo(row, SpreadsheetApp.CopyPasteType.PASTE_FORMAT, false);
    tpl.copyTo(row, SpreadsheetApp.CopyPasteType.PASTE_DATA_VALIDATION, false);
    // 行ごとの数式（曜日など）だけ写す。下へ広がる数式（ARRAYFORMULA など）は写さない（重なって #REF! になるため）
    f = tpl.getFormulasR1C1()[0].map(function (x) { return /ARRAYFORMULA|^=\{|LET\(|BYCOL|MAP\(/i.test(x) ? '' : x; });
    for (var j = 0; j < f.length; j++) {
      if (f[j]) sh.getRange(newRow, j + 1).setFormulaR1C1(f[j]);
    }
  }

  var date = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  var set = {};
  set[c.no] = no;
  set[c.done] = false;
  set[c.pj] = taskApi_text(req.pj);
  if (c.stage) { set[c.stage] = parent; set[c.todo] = todo; }   // 段階の列がある表は分けて書く
  else set[c.todo] = parent ? parent + ' | ' + todo : todo;
  set[c.ko] = ko;
  set[c.date] = date;
  set[c.slot] = slot ? TASKAPI.SLOTS[slot] : '';
  set[c.detail] = taskApi_text(req.detail);
  for (var col in set) {
    if (f[Number(col) - 1]) continue;  // 数式の列には書かない
    sh.getRange(newRow, Number(col)).setValue(set[col]);
  }

  // 完了を隠すフィルタが新しい行まで効くように広げてから、📅順に並べ替える
  taskApi_extendFilter(sh, newRow);
  taskApi_sortByDate(sh, c, dataW, newRow);

  var at = taskApi_findRowByNo(sh, c, no, newRow);
  var v = sh.getRange(at, 1, 1, c.width).getValues()[0];
  var res = { task: taskApi_rowToTask(at, v, c, taskApi_ymd(new Date())) };
  taskApi_remember(reqId, res);
  return res;
}

// 1行目で最初に日付が入っている列（ガントの始まり）の1つ手前までを「データの列」とする
function taskApi_dataWidth(sh) {
  var r1 = sh.getRange(TASKAPI.HEADER_ROW, 1, 1, sh.getLastColumn()).getValues()[0];
  for (var i = 0; i < r1.length; i++) if (r1[i] instanceof Date) return i;
  return r1.length;
}

// No か ToDo が入っている一番下の行（ガントの数式は下まで広がっているので getLastRow は使わない）
function taskApi_lastDataRow(sh, c) {
  var max = sh.getMaxRows();
  if (max < TASKAPI.FIRST_ROW) return TASKAPI.FIRST_ROW - 1;
  var n = max - TASKAPI.FIRST_ROW + 1;
  var a = sh.getRange(TASKAPI.FIRST_ROW, c.no, n, 1).getValues();
  var b = sh.getRange(TASKAPI.FIRST_ROW, c.todo, n, 1).getValues();
  for (var i = n - 1; i >= 0; i--) {
    if (String(a[i][0]).trim() !== '' || String(b[i][0]).trim() !== '') return TASKAPI.FIRST_ROW + i;
  }
  return TASKAPI.FIRST_ROW - 1;
}

// フィルタの範囲が lastRow より上で終わっていたら、条件（完了を隠す など）をそのままに範囲だけ広げる
function taskApi_extendFilter(sh, lastRow) {
  var fl = sh.getFilter();
  if (!fl) return;
  var r = fl.getRange();
  if (r.getLastRow() >= lastRow) return;
  var crit = {};
  for (var col = r.getColumn(); col <= r.getLastColumn(); col++) {
    var cr = fl.getColumnFilterCriteria(col);
    if (cr) crit[col] = cr.copy().build();
  }
  var top = r.getRow(), left = r.getColumn(), w = r.getNumColumns();
  fl.remove();
  var nf = sh.getRange(top, left, lastRow - top + 1, w).createFilter();
  for (var k in crit) nf.setColumnFilterCriteria(Number(k), crit[k]);
}

// 5行目〜最終行を 📅 → ⏰ → PJ の順に並べ替える（シート側の「未完了・日付順」と同じ。4行目＝入力行とガント列は動かさない）
function taskApi_sortByDate(sh, c, dataW, lastRow) {
  var top = TASKAPI.FIRST_ROW + 1;
  if (lastRow <= top) return;
  sh.getRange(top, 1, lastRow - top + 1, dataW).sort([
    { column: c.date, ascending: true },
    { column: c.slot, ascending: true },
    { column: c.pj, ascending: true }
  ]);
}

function taskApi_findRowByNo(sh, c, no, lastRow) {
  var vals = sh.getRange(TASKAPI.FIRST_ROW, c.no, lastRow - TASKAPI.FIRST_ROW + 1, 1).getValues();
  for (var i = 0; i < vals.length; i++) if (taskApi_num(vals[i][0]) === no) return TASKAPI.FIRST_ROW + i;
  return lastRow;
}

function taskApi_setDone(sh, req, done) {
  var c = taskApi_cols(sh);
  var t = taskApi_findTask(sh, c, req);
  if (!t) return { error: 'not_found' };
  sh.getRange(t.row, c.done).setValue(done);
  taskApi_stampDoneDate_(sh, t.row, done);   // 「✔日」「完了日」の列がある表だけ、完了した日を入れる／外したら消す
  var res = { task: null, actualSaved: false };
  if (done && req.actual !== undefined && req.actual !== null && req.actual !== '') {
    var a = taskApi_writeActual(sh, c, t.row, req.actual);
    if (a.error) return a;
    res.actualSaved = a.saved;
  }
  res.task = taskApi_rowToTask(t.row, sh.getRange(t.row, 1, 1, c.width).getValues()[0], c, taskApi_ymd(new Date()));
  return res;
}

// タスク名（D列）・📅・⏰・👤（待ち相手）・前提・詳細 を書く。その行のそのセルだけ。undefined の項目は書かない
// newTodo：D列をそのまま置き換える（「親 | 子」の形もそのまま）。空・改行は不可（改行は空白にする）
function taskApi_setWait(sh, req) {
  var c = taskApi_cols(sh);
  var t = taskApi_findTask(sh, c, req);
  if (!t) return { error: 'not_found' };
  // 先に全部チェックしてから書く（途中で断って半分だけ書かれるのを防ぐ）
  var date = null, slotVal = null;
  if (req.date !== undefined) {
    var dm = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(req.date || ''));
    if (!dm) return { error: 'bad_date' };
    date = new Date(Number(dm[1]), Number(dm[2]) - 1, Number(dm[3]));
  }
  if (req.slot !== undefined) {
    var sl = String(req.slot || '');
    var tm = /^(\d{1,2}):(\d{2})$/.exec(sl);
    if (tm) {   // 時刻（13:30 → 13.5。既存GASと同じ「数値の時刻」）
      var hh = Number(tm[1]), mm = Number(tm[2]);
      if (hh > 23 || mm > 59) return { error: 'bad_slot' };
      slotVal = hh + mm / 60;
    } else if (!sl) slotVal = '';
    else if (TASKAPI.SLOTS[sl]) slotVal = TASKAPI.SLOTS[sl];
    else return { error: 'bad_slot' };
  }
  var newTodo = null;
  if (req.newTodo !== undefined) { newTodo = taskApi_text(req.newTodo); if (!newTodo) return { error: 'no_todo' }; }
  if (req.wait !== undefined && !c.wait) return { error: 'no_wait_column' };
  if (req.pre !== undefined && !c.pre) return { error: 'no_pre_column' };
  if (req.wait !== undefined && taskApi_text(req.wait).length > 40) return { error: 'bad_wait' };
  if (req.pre !== undefined) {
    var p0 = taskApi_text(req.pre);
    if (p0 && !/^\d+\./.test(p0)) return { error: 'bad_pre' };
    if (p0 && Number(/^(\d+)/.exec(p0)[1]) === t.no) return { error: 'bad_pre' };
  }
  var newDetail = null;
  if (req.detail !== undefined) {
    newDetail = taskApi_text(req.detail);
    // 工程表連動の印（⛓キー）は消させない（消すと工程表とのつながりが切れ、次の同期で二重に取り込まれるため）
    var key = /⛓[\w-]+:[\w.]+/.exec(t.detail);
    if (key && newDetail.indexOf(key[0]) < 0) return { error: 'keep_link' };
  }
  if (newTodo !== null && newTodo !== t.todo) sh.getRange(t.row, c.todo).setValue(newTodo);
  if (newDetail !== null && newDetail !== t.detail) sh.getRange(t.row, c.detail).setValue(newDetail);
  if (date) sh.getRange(t.row, c.date).setValue(date);
  if (slotVal !== null) sh.getRange(t.row, c.slot).setValue(slotVal);
  if (req.wait !== undefined) sh.getRange(t.row, c.wait).setValue(taskApi_text(req.wait));
  if (req.pre !== undefined) sh.getRange(t.row, c.pre).setValue(taskApi_text(req.pre));   // 自分自身・形の違う前提は上で断り済み
  return { task: taskApi_rowToTask(t.row, sh.getRange(t.row, 1, 1, c.width).getValues()[0], c, taskApi_ymd(new Date())) };
}

// タスクを1行削除。前提にしている未完了タスクがあれば断って、その一覧を返す
function taskApi_remove(sh, req) {
  var c = taskApi_cols(sh);
  var t = taskApi_findTask(sh, c, req);
  if (!t) return { error: 'not_found' };
  if (c.pre && t.no !== null) {
    var users = taskApi_readAll(sh, c).filter(function (x) {
      if (x.done || x.row === t.row || !x.pre) return false;
      var m = /^\s*(?:No)?(\d+)/.exec(x.pre);
      return m && Number(m[1]) === t.no;
    });
    if (users.length) return { error: 'used_as_pre', detail: users.slice(0, 5).map(function (x) { return x.no + '.' + x.todo.slice(0, 40); }).join('、') };
  }
  sh.deleteRow(t.row);
  return { removed: { no: t.no, todo: t.todo } };
}

/** 「✔日」または「完了日」の列があれば、完了にした日を入れる（すでに入っていればそのまま）。完了を外したら消す。列がなければ何もしない */
function taskApi_stampDoneDate_(sh, row, done) {
  var heads = taskApi_heads(sh);
  var col = taskApi_findCol(heads, '✔日', true) || taskApi_findCol(heads, '完了日', true);
  if (!col) return;
  var cell = sh.getRange(row, col);
  if (done) {
    if (cell.getValue() === '' || cell.getValue() === null) {
      var n = new Date();
      cell.setValue(new Date(n.getFullYear(), n.getMonth(), n.getDate()));
    }
  } else cell.setValue('');
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

// ---------- 案件ごとのガント（2026-11-08） ----------
// 全タスク（日次ガント＋アーカイブ）の、ガントに要る列だけを返す。集計はアプリ側で行う
function taskApi_pj(sh) { var r = taskApi_pjFrom(taskApi_readAll(sh, taskApi_cols(sh))); r.pjOrder = taskApi_pjOrder(); return r; }
// 週次シートのA列（5行目から下）の案件名を上から順に。案件の一覧はこの順に並べる（読むだけ）
function taskApi_pjOrder() {
  var w = SpreadsheetApp.openById(TASKAPI.SPREADSHEET_ID).getSheetByName(TASKAPI.WEEKLY.SHEET);
  if (!w) return [];
  var last = w.getLastRow(), f = TASKAPI.WEEKLY.FIRST_ROW;
  if (last < f) return [];
  var seen = {}, out = [];
  w.getRange(f, 1, last - f + 1, 1).getDisplayValues().forEach(function (r) { var v = String(r[0] || '').trim(); if (v && !seen[v]) { seen[v] = 1; out.push(v.slice(0, 60)); } });
  return out.slice(0, 200);
}
function taskApi_pjFrom(rows) {
  var slim = function (t, arc) { return { no: t.no, done: t.done, pj: t.pj.slice(0, 60), todo: t.todo.slice(0, 120), stage: t.stage || undefined, ko: t.ko, date: t.date, pre: t.pre, wait: t.wait ? 1 : 0, detail: t.detail.slice(0, 200), arc: arc || undefined }; };
  var out = rows.map(function (t) { return slim(t); });
  var ar = taskApi_archiveSheet(false);
  if (ar) {
    var ac = taskApi_cols(ar);
    taskApi_readAll(ar, ac, 2).forEach(function (t) { out.push(slim(t, 1)); });
  }
  return { tasks: out.slice(0, 5000) };
}

// シートの重さ：日次ガントの 行×列（数式の多くはガントの日付列にあるため、これが重さの主な原因）
function taskApi_weight(sh) {
  var rows = sh.getMaxRows(), cols = sh.getMaxColumns(), c = taskApi_cols(sh);
  var tasks = taskApi_readAll(sh, c);
  var last = PropertiesService.getScriptProperties().getProperty(TASKAPI.ARCHIVE.PROP_LAST) || '';
  return { rows: rows, cols: cols, cells: rows * cols, limit: TASKAPI.WEIGHT_CELLS, tasks: tasks.length,
    doneTasks: tasks.filter(function (t) { return t.done; }).length, archiveCandidates: TASKAPI.ARCHIVE_OFF ? 0 : taskApi_archivePick(sh, c, tasks).length, lastArchive: last };
}

function taskApi_archiveSheet(create) {
  var ss = SpreadsheetApp.openById(TASKAPI.SPREADSHEET_ID);
  var ar = ss.getSheetByName(TASKAPI.ARCHIVE.SHEET);
  if (!ar && create) {
    ar = ss.insertSheet(TASKAPI.ARCHIVE.SHEET);
    var sh = taskApi_sheet(), w = taskApi_dataWidth(sh);
    ar.getRange(1, 1, 1, w).setValues(sh.getRange(TASKAPI.HEADER_ROW, 1, 1, w).getValues());
  }
  return ar;
}

// 移してよい行：完了・📅が30日より前・ほかの未完了タスクの前提になっていない・工程表連動（⛓）でない
function taskApi_archivePick(sh, c, all) {
  var limit = taskApi_ymd(new Date(new Date().getTime() - TASKAPI.ARCHIVE.DAYS * 24 * 3600 * 1000));
  var usedAsPre = {};
  all.forEach(function (t) { if (!t.done && t.pre) { var m = /^\s*(?:No)?(\d+)/.exec(t.pre); if (m) usedAsPre[Number(m[1])] = true; } });
  return all.filter(function (t) {
    return t.done && t.date && t.date < limit && !(t.no !== null && usedAsPre[t.no]) && t.detail.indexOf('⛓') < 0;
  });
}

function taskApi_archivePreview(sh) {
  var c = taskApi_cols(sh);
  var pick = taskApi_archivePick(sh, c, taskApi_readAll(sh, c));
  return { items: pick.slice(0, 500).map(function (t) { return { no: t.no, todo: t.todo.slice(0, 80), pj: t.pj.slice(0, 40), date: t.date }; }), total: pick.length,
    days: TASKAPI.ARCHIVE.DAYS };
}

// アプリで確かめた一覧（No と ToDo）のうち、今も移してよい行だけを移す。写してから消す
function taskApi_archiveRun(sh, req) {
  var want = {};
  (Array.isArray(req.items) ? req.items : []).slice(0, 500).forEach(function (x) { want[taskApi_num(x.no) + '|' + String(x.todo || '')] = true; });
  var c = taskApi_cols(sh);
  var pick = taskApi_archivePick(sh, c, taskApi_readAll(sh, c)).filter(function (t) { return want[t.no + '|' + t.todo.slice(0, 80)]; });
  if (!pick.length) return { moved: 0 };
  var w = taskApi_dataWidth(sh);
  var ar = taskApi_archiveSheet(true);
  var rows = pick.map(function (t) { return t.row; }).sort(function (a, b) { return a - b; });
  var vals = rows.map(function (r) { return sh.getRange(r, 1, 1, w).getValues()[0]; });
  ar.getRange(Math.max(ar.getLastRow(), 1) + 1, 1, vals.length, w).setValues(vals);
  for (var i = rows.length - 1; i >= 0; i--) sh.deleteRow(rows[i]);   // 下の行から消す（上の行番号がずれないように）
  PropertiesService.getScriptProperties().setProperty(TASKAPI.ARCHIVE.PROP_LAST, taskApi_ymd(new Date()));
  return { moved: rows.length };
}

// ---------- 工程のひな形（「_ひな形」シート：非表示・値だけ） ----------
function taskApi_tmplSheet(create) {
  var ss = SpreadsheetApp.openById(TASKAPI.SPREADSHEET_ID);
  var t = ss.getSheetByName(TASKAPI.TMPL.SHEET);
  if (!t && create) {
    t = ss.insertSheet(TASKAPI.TMPL.SHEET);
    t.getRange(1, 1, 1, TASKAPI.TMPL.HEAD.length).setValues([TASKAPI.TMPL.HEAD]);
    t.hideSheet();
  }
  return t;
}
function taskApi_tmplRows(t) {
  var last = t ? t.getLastRow() : 0;
  if (last < 2) return [];
  return t.getRange(2, 1, last - 1, TASKAPI.TMPL.HEAD.length).getValues().map(function (r, i) {
    return { row: i + 2, name: String(r[0] || '').trim(), order: taskApi_num(r[1]), parent: String(r[2] || '').trim(), child: String(r[3] || '').trim(),
      ko: taskApi_num(r[4]), need: String(r[5] || '').trim(), wait: taskApi_num(r[6]), memo: String(r[7] || '') };
  }).filter(function (x) { return x.name && (x.parent || x.child); });
}
function taskApi_tmplList() {
  var rows = taskApi_tmplRows(taskApi_tmplSheet(false)), by = {};
  rows.forEach(function (x) { (by[x.name] = by[x.name] || []).push(x); });
  Object.keys(by).forEach(function (k) { by[k].sort(function (a, b) { return (a.order || 0) - (b.order || 0); }); by[k].forEach(function (x) { delete x.row; }); });
  var map = {};
  try { map = JSON.parse(PropertiesService.getScriptProperties().getProperty(TASKAPI.TMPL.PROP_PJ) || '{}'); } catch (e) { map = {}; }
  return { templates: by, pjTemplate: map };
}
// 同じ名前があれば overwrite のときだけ置き換える（古い行を消してから下に書く）
function taskApi_tmplSave(req) {
  var name = taskApi_text(req.name).slice(0, 40);
  if (!name) return { error: 'no_tmpl_name' };
  var items = (Array.isArray(req.rows) ? req.rows : []).slice(0, 300);
  if (!items.length) return { error: 'no_tmpl_rows' };
  var t = taskApi_tmplSheet(true);
  var old = taskApi_tmplRows(t).filter(function (x) { return x.name === name; });
  if (old.length && req.overwrite !== true) return { error: 'tmpl_exists' };
  var vals = items.map(function (x, i) {
    var ko = taskApi_num(x.ko), wait = taskApi_num(x.wait);
    return [name, i + 1, taskApi_text(x.parent).slice(0, 100), taskApi_text(x.child).slice(0, 120), ko === null ? '' : ko,
      taskApi_text(x.need).slice(0, 60), wait === null ? '' : wait, taskApi_text(x.memo).slice(0, 200)];
  });
  old.map(function (x) { return x.row; }).sort(function (a, b) { return b - a; }).forEach(function (r) { t.deleteRow(r); });
  t.getRange(Math.max(t.getLastRow(), 1) + 1, 1, vals.length, TASKAPI.TMPL.HEAD.length).setValues(vals);
  return { saved: vals.length, replaced: old.length };
}

// ---------- 工程の組み立ての反映 ----------
// ops：date（📅を変える）／ edit（ToDo・工・詳細）／ add（行を足す）／ exclude（外す）／ restore（外したのを戻す）
// 先に全部確かめてから書く。対象の行は No と ToDo で探す（行番号は使わない）
function taskApi_kumitate(sh, req) {
  var reqId = /^[A-Za-z0-9_-]{8,64}$/.test(String(req.reqId || '')) ? String(req.reqId) : '';
  var prev = taskApi_seen(reqId);
  if (prev) return prev;
  var pj = taskApi_text(req.pj).slice(0, 60);
  if (!pj) return { error: 'no_pj' };
  var ops = Array.isArray(req.ops) ? req.ops.slice(0, 300) : [];
  if (!ops.length) return { error: 'no_ops' };
  var c = taskApi_cols(sh), all = taskApi_readAll(sh, c), byKey = {};
  all.forEach(function (t) { byKey[t.no + '|' + t.todo] = t; });
  var ymdRe = /^(\d{4})-(\d{2})-(\d{2})$/, plan = [];
  for (var i = 0; i < ops.length; i++) {
    var o = ops[i] || {}, kind = String(o.op || '');
    if (kind === 'add') {
      if (!taskApi_text(o.todo)) return { error: 'no_todo', detail: '追加' };
      if (o.date && !ymdRe.test(String(o.date))) return { error: 'bad_date' };
      var ko0 = taskApi_num(o.ko); if (ko0 === null || ko0 < 0 || ko0 > 24) return { error: 'bad_ko' };
      plan.push({ op: 'add', o: o }); continue;
    }
    var t = byKey[taskApi_num(o.no) + '|' + String(o.todo || '')];
    if (!t || t.pj !== pj) return { error: 'not_found', detail: String(o.todo || '').slice(0, 40) };
    if (t.done && kind !== 'edit') return { error: 'is_done', detail: t.todo.slice(0, 40) };
    if ((kind === 'date' || kind === 'restore') && !ymdRe.test(String(o.date || ''))) return { error: 'bad_date' };
    if (kind === 'edit') {
      if (o.newTodo !== undefined && !taskApi_text(o.newTodo)) return { error: 'no_todo' };
      if (o.ko !== undefined) { var k1 = taskApi_num(o.ko); if (k1 === null || k1 < 0 || k1 > 24) return { error: 'bad_ko' }; }
      if (o.detail !== undefined) { var key = /⛓[\w-]+:[\w.]+/.exec(t.detail); if (key && taskApi_text(o.detail).indexOf(key[0]) < 0) return { error: 'keep_link' }; }
    } else if (['date', 'exclude', 'restore'].indexOf(kind) < 0) return { error: 'bad_op' };
    plan.push({ op: kind, o: o, t: t });
  }
  var dt = function (s) { var m = ymdRe.exec(s); return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])); };
  var koutei = [], res = { changed: 0, added: 0, koutei: 0, kouteiSkipped: 0 };
  plan.forEach(function (p) {
    var t = p.t, o = p.o;
    if (p.op === 'date') { sh.getRange(t.row, c.date).setValue(dt(o.date)); koutei.push({ t: t, date: o.date }); }
    if (p.op === 'edit') {
      if (o.newTodo !== undefined) sh.getRange(t.row, c.todo).setValue(taskApi_text(o.newTodo));
      if (o.stage !== undefined && c.stage) sh.getRange(t.row, c.stage).setValue(taskApi_text(o.stage).slice(0, 100));
      if (o.ko !== undefined) sh.getRange(t.row, c.ko).setValue(taskApi_num(o.ko));
      if (o.detail !== undefined) sh.getRange(t.row, c.detail).setValue(taskApi_text(o.detail));
    }
    if (p.op === 'exclude') {
      sh.getRange(t.row, c.date).setValue('');
      if (t.detail.indexOf(TASKAPI.EXCLUDE_TAG) < 0) sh.getRange(t.row, c.detail).setValue((TASKAPI.EXCLUDE_TAG + ' ' + t.detail).trim());
      koutei.push({ t: t, target: 0 });
    }
    if (p.op === 'restore') {
      sh.getRange(t.row, c.date).setValue(dt(o.date));
      sh.getRange(t.row, c.detail).setValue(t.detail.split(TASKAPI.EXCLUDE_TAG).join('').replace(/\s+/g, ' ').trim());
      koutei.push({ t: t, target: 1, date: o.date });
    }
    if (p.op !== 'add') res.changed++;
  });
  // 足す行は最後にまとめて（add は最終行の下に足して📅順に並べ替えるので、上の書き換えの行番号に影響しないよう後で）
  plan.filter(function (p) { return p.op === 'add'; }).forEach(function (p) {
    var o = p.o;
    var r = taskApi_add(sh, { todo: o.todo, parent: o.parent, pj: pj, ko: o.ko, date: o.date || taskApi_ymd(new Date()), slot: '', detail: o.detail });
    if (!r.error) res.added++;
  });
  if (req.template) {   // この案件がどのひな形から作られたか（「今回だけ」の印に使う）
    var props = PropertiesService.getScriptProperties(), map = {};
    try { map = JSON.parse(props.getProperty(TASKAPI.TMPL.PROP_PJ) || '{}'); } catch (e) { map = {}; }
    map[pj] = taskApi_text(req.template).slice(0, 40);
    props.setProperty(TASKAPI.TMPL.PROP_PJ, JSON.stringify(map));
  }
  var kr = taskApi_kouteiSync(koutei);
  res.koutei = kr.done; res.kouteiSkipped = kr.skipped;
  taskApi_remember(reqId, res);
  return res;
}

// 工程表連動（⛓）の行：工程表の 開始日・終了日（📅に合わせる）と 集計対象（外す＝0／戻す＝1）をそろえる。数式のセルは書かない
function taskApi_kouteiSync(list) {
  var out = { done: 0, skipped: 0 }, books = {};
  list.forEach(function (x) {
    var m = /⛓([\w-]+):([\w.]+)/.exec(x.t.detail);
    if (!m) return;
    var id = TASKAPI.KOUTEI.FILES[m[1].slice(0, 8)];
    if (!id) { out.skipped++; return; }
    try {
      var b = books[id];
      if (!b) {
        var ks = SpreadsheetApp.openById(id).getSheetByName(TASKAPI.KOUTEI.SHEET);
        var hr = TASKAPI.KOUTEI.HEAD_ROW, head = ks.getRange(hr, 1, 1, ks.getLastColumn()).getValues()[0].map(function (v) { return String(v).trim(); });
        var col = function (n) { return head.indexOf(n) + 1; };
        b = books[id] = { ks: ks, no: col('No'), s: col('開始日'), e: col('終了日'), tgt: col('集計対象') };
        var last = ks.getLastRow();
        b.nos = last > hr ? ks.getRange(hr + 1, b.no, last - hr, 1).getValues().map(function (r) { return String(r[0]); }) : [];
      }
      var idx = b.nos.indexOf(m[2]);
      if (idx < 0) { out.skipped++; return; }
      var row = TASKAPI.KOUTEI.HEAD_ROW + 1 + idx, wrote = false;
      var put = function (cn, v) { if (!cn) return; var cell = b.ks.getRange(row, cn); if (cell.getFormula()) { out.skipped++; return; } cell.setValue(v); wrote = true; };
      if (x.date) { var p = x.date.split('-').map(Number), d = new Date(p[0], p[1] - 1, p[2]); put(b.s, d); put(b.e, d); }
      if (x.target !== undefined) put(b.tgt, x.target);
      if (wrote) out.done++;
    } catch (e) { out.skipped++; }
  });
  return out;
}

// ---------- 定期タスク（「_定期タスク」表。列は 定期タスク.gs と同じ） ----------
//  有効 / PJ / ToDo / 工 / ⏰ / 繰り返し / 曜日・日 / 開始日 / 終了日 / 詳細

function taskApi_recurSheet() { return SpreadsheetApp.openById(TASKAPI.SPREADSHEET_ID).getSheetByName(TASKAPI.RECUR.SHEET); }

function taskApi_recurRead(rs) {
  var last = rs.getLastRow();
  if (last < 2) return [];
  var rg = rs.getRange(2, 1, last - 1, TASKAPI.RECUR.WIDTH), v = rg.getValues(), d = rg.getDisplayValues(), out = [];
  for (var i = 0; i < v.length; i++) {
    var pj = String(v[i][1] || '').trim(), todo = String(v[i][2] || '').trim();
    if (!pj && !todo) continue;
    out.push({
      row: i + 2, on: v[i][0] === true, pj: pj, todo: todo, ko: taskApi_num(v[i][3]),
      time: String(d[i][4] || '').trim(), type: String(v[i][5] || '').trim() || '毎週',
      when: String(d[i][6] || '').normalize('NFKC').trim(),
      from: v[i][7] instanceof Date ? taskApi_ymd(v[i][7]) : '', to: v[i][8] instanceof Date ? taskApi_ymd(v[i][8]) : '',
      detail: String(v[i][9] || '')
    });
  }
  return out;
}

function taskApi_recurList() {
  var rs = taskApi_recurSheet();
  if (!rs) return { error: 'no_recur_sheet' };
  return { rules: taskApi_recurRead(rs).slice(0, 200) };
}

// 送られてきた決まりを確かめて、表に書く形（10列）にする
function taskApi_recurParse(r) {
  r = r || {};
  var todo = taskApi_text(r.todo), pj = taskApi_text(r.pj).slice(0, 60);
  if (!todo) return { error: 'no_todo' };
  var ko = taskApi_num(r.ko);
  if (ko === null || ko < 0 || ko > 24) return { error: 'bad_ko' };
  var time = String(r.time || '').trim(), timeCell = '';
  if (TASKAPI.SLOTS[time]) timeCell = TASKAPI.SLOTS[time];
  else if (/^\d{1,2}:\d{2}$/.test(time)) {
    var hm = time.split(':').map(Number);
    if (hm[0] > 23 || hm[1] > 59) return { error: 'bad_slot' };
    timeCell = hm[0] + ':' + ('0' + hm[1]).slice(-2);
  } else if (time) return { error: 'bad_slot' };
  var type = String(r.type || '');
  if (TASKAPI.RECUR.TYPES.indexOf(type) < 0) return { error: 'bad_type' };
  var when = String(r.when || '').normalize('NFKC').replace(/\s/g, '');
  if (type === '毎週') {
    var wd = ''; TASKAPI.RECUR.WDAYS.split('').forEach(function (ch) { if (when.indexOf(ch) >= 0) wd += ch; });
    if (!wd || wd.length !== when.replace(/[,、]/g, '').length) return { error: 'bad_when' };
    when = wd;
  } else if (type === '毎月') {
    var parts = when.split(/[,、]/).filter(String), seen = {}, ok = parts.length > 0;
    parts.forEach(function (x) { if (x === '末') return; var n = Number(x); if (!/^\d{1,2}$/.test(x) || n < 1 || n > 31) ok = false; });
    if (!ok) return { error: 'bad_when' };
    when = parts.filter(function (x) { if (seen[x]) return false; seen[x] = true; return true; }).join(',');
  } else when = '';
  var dates = {};
  ['from', 'to'].forEach(function (k) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(r[k] || ''));
    dates[k] = m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : '';
    if (!m && r[k]) dates.bad = true;
  });
  if (dates.bad || (dates.from && dates.to && dates.to < dates.from)) return { error: 'bad_range' };
  var detail = taskApi_text(r.detail);
  return { cells: [pj, todo, ko, timeCell, type, when, dates.from, dates.to, detail],
    rule: { pj: pj, todo: todo, ko: ko, time: timeCell, type: type, when: when,
      from: dates.from ? taskApi_ymd(dates.from) : '', to: dates.to ? taskApi_ymd(dates.to) : '', detail: detail } };
}

// 行番号＋PJ・ToDo が一致するか（PCで表を並べ替えた・消したときに別の行を書き換えないため）
function taskApi_recurAt(rs, req) {
  var row = Number(req.row);
  if (!(row >= 2 && row <= rs.getLastRow() && row === Math.floor(row))) return null;
  var v = rs.getRange(row, 1, 1, 3).getValues()[0];
  if (String(v[1] || '').trim() !== String(req.pj || '').trim() || String(v[2] || '').trim() !== String(req.todo || '').trim()) return null;
  return row;
}

function taskApi_recurWrite(rs, row, cells, on) {
  // ⏰・曜日・日は文字のまま書く（「9:30」が時刻、「15」が数字に変わらないように）。日付の2列は m/d
  rs.getRange(row, 5).setNumberFormat('@');
  rs.getRange(row, 7).setNumberFormat('@');
  rs.getRange(row, 8, 1, 2).setNumberFormat('m/d');
  rs.getRange(row, 2, 1, 9).setValues([cells]);
  if (on !== undefined) {
    var a = rs.getRange(row, 1);
    if (!a.getDataValidation()) a.insertCheckboxes();
    a.setValue(on);
  }
}

function taskApi_recurSave(sh, req) {
  var reqId = /^[A-Za-z0-9_-]{8,64}$/.test(String(req.reqId || '')) ? String(req.reqId) : '';
  var prev = taskApi_seen(reqId);
  if (prev) return prev;
  var rs = taskApi_recurSheet();
  if (!rs) return { error: 'no_recur_sheet' };
  var p = taskApi_recurParse(req.rule);
  if (p.error) return p;
  var row, renamed = null;
  if (req.row !== undefined && req.row !== null && req.row !== '') {
    row = taskApi_recurAt(rs, req);
    if (!row) return { error: 'recur_changed' };
    if (String(req.pj || '').trim() !== p.rule.pj || String(req.todo || '').trim() !== p.rule.todo) renamed = { pj: String(req.pj || '').trim(), todo: String(req.todo || '').trim() };
    taskApi_recurWrite(rs, row, p.cells);
  } else {
    // 空いている行（PJもToDoも空）の一番上。なければ一番下に1行足す
    var last = rs.getLastRow(), max = rs.getMaxRows(), free = 0;
    if (max >= 2) {
      var v = rs.getRange(2, 2, max - 1, 2).getValues();
      for (var i = 0; i < v.length; i++) if (String(v[i][0]).trim() === '' && String(v[i][1]).trim() === '') { free = i + 2; break; }
    }
    if (!free) { rs.insertRowsAfter(Math.max(max, 1), 1); free = Math.max(max, 1) + 1; }
    row = free;
    taskApi_recurWrite(rs, row, p.cells, req.rule.on !== false);
  }
  var res = { rule: null, todayAdded: false, todayNote: '' };
  // 名前（PJ・ToDo）を変えたとき：もう日次に入っている今日以降の分は、新しい名前でも「入れた」ことにする（翌朝に二重に入らないように）
  if (renamed) taskApi_recurCarryLog(sh, renamed, p.rule);
  var all = taskApi_recurRead(rs);
  for (var k = 0; k < all.length; k++) if (all[k].row === row) res.rule = all[k];
  if (req.today && res.rule && res.rule.on) {   // 止めている決まりは今日の分も入れない
    var t = taskApi_recurToday(sh, p.rule);
    res.todayAdded = t.added; res.todayNote = t.note || ''; if (t.task) res.task = t.task;
  }
  taskApi_remember(reqId, res);
  return res;
}

function taskApi_recurToggle(req) {
  var rs = taskApi_recurSheet();
  if (!rs) return { error: 'no_recur_sheet' };
  var row = taskApi_recurAt(rs, req);
  if (!row) return { error: 'recur_changed' };
  var a = rs.getRange(row, 1);
  if (!a.getDataValidation()) a.insertCheckboxes();
  a.setValue(req.on === true);
  var all = taskApi_recurRead(rs), rule = null;
  for (var k = 0; k < all.length; k++) if (all[k].row === row) rule = all[k];
  return { rule: rule };
}

function taskApi_recurKey(pj, todo, ymd) { return [pj, todo, ymd].join('|'); }

function taskApi_recurLogSheet() {
  var ss = SpreadsheetApp.openById(TASKAPI.SPREADSHEET_ID);
  var lg = ss.getSheetByName(TASKAPI.RECUR.LOG);
  if (!lg) { lg = ss.insertSheet(TASKAPI.RECUR.LOG); lg.hideSheet(); }
  return lg;
}
function taskApi_recurLogged(lg) {
  var o = {}, n = lg.getLastRow();
  if (n >= 1) lg.getRange(1, 1, n, 1).getValues().forEach(function (r) { o[String(r[0])] = true; });
  return o;
}
function taskApi_recurLog(lg, keys) {
  if (!keys.length) return;
  lg.getRange(lg.getLastRow() + 1, 1, keys.length, 2).setValues(keys.map(function (k) { return [k, new Date()]; }));
}

// 日次ガントの今日以降で、PJ・ToDo が同じ行の日付
function taskApi_recurDays(sh, pj, todo) {
  var c = taskApi_cols(sh), today = taskApi_ymd(new Date()), out = [];
  taskApi_readAll(sh, c).forEach(function (t) { if (t.date && t.date >= today && t.pj.trim() === pj && t.todo.trim() === todo) out.push(t.date); });
  return out;
}

function taskApi_recurCarryLog(sh, from, rule) {
  var days = taskApi_recurDays(sh, from.pj, from.todo);
  if (!days.length) return;
  var lg = taskApi_recurLogSheet(), logged = taskApi_recurLogged(lg);
  taskApi_recurLog(lg, days.map(function (d) { return taskApi_recurKey(rule.pj, rule.todo, d); }).filter(function (k) { return !logged[k]; }));
}

// 今日の1件：決まりが今日に当たり、まだ入っていなければ add と同じ方法で足す
function taskApi_recurToday(sh, rule) {
  var today = taskApi_ymd(new Date());
  if (!taskApi_recurMatch(rule, today)) return { added: false, note: 'not_today' };
  var key = taskApi_recurKey(rule.pj, rule.todo, today);
  var lg = taskApi_recurLogSheet();
  if (taskApi_recurLogged(lg)[key] || taskApi_recurDays(sh, rule.pj, rule.todo).indexOf(today) >= 0) return { added: false, note: 'already' };
  var slot = '';
  for (var k in TASKAPI.SLOTS) if (TASKAPI.SLOTS[k] === rule.time) slot = k;
  var r = taskApi_add(sh, { todo: rule.todo, pj: rule.pj, ko: rule.ko, date: today, slot: slot, detail: rule.detail });
  if (r.error) return { added: false, note: r.error };
  if (/^\d{1,2}:\d{2}$/.test(rule.time)) {   // 時刻は setWait と同じ「数値の時刻」で書く
    var hm = rule.time.split(':').map(Number), c = taskApi_cols(sh);
    sh.getRange(r.task.row, c.slot).setValue(hm[0] + hm[1] / 60);
    r.task = taskApi_rowToTask(r.task.row, sh.getRange(r.task.row, 1, 1, c.width).getValues()[0], c, today);
  }
  taskApi_recurLog(lg, [key]);
  return { added: true, task: r.task };
}

// 定期タスク.gs の ruleMatchesDay_ と同じ判定（平日は土日祝を除く）
function taskApi_recurMatch(rule, ymd) {
  if (rule.from && ymd < rule.from) return false;
  if (rule.to && ymd > rule.to) return false;
  var p = ymd.split('-').map(Number), d = new Date(p[0], p[1] - 1, p[2]), wd = d.getDay() || 7;
  switch (rule.type) {
    case '毎日': return true;
    case '平日': return wd <= 5 && !taskApi_isHoliday(d);
    case '毎週': return rule.when.indexOf(TASKAPI.RECUR.WDAYS.charAt(wd - 1)) >= 0;
    case '毎月': {
      var parts = rule.when.split(','), next = new Date(p[0], p[1] - 1, p[2] + 1);
      return parts.indexOf(String(p[2])) >= 0 || (parts.indexOf('末') >= 0 && next.getDate() === 1);
    }
  }
  return false;
}

// 祝日（定期タスク.gs の buildJapaneseHolidays_ と同じ計算）
function taskApi_isHoliday(d) {
  var y = d.getFullYear(), map = {};
  var key = function (x) { return x.getFullYear() + '-' + x.getMonth() + '-' + x.getDate(); };
  var add = function (x) { map[key(x)] = x; };
  var nthMon = function (m, n) { var f = new Date(y, m - 1, 1); return new Date(y, m - 1, 1 + (1 - f.getDay() + 7) % 7 + (n - 1) * 7); };
  var yy = y - 1980;
  add(new Date(y, 0, 1)); add(nthMon(1, 2)); add(new Date(y, 1, 11)); add(new Date(y, 1, 23));
  add(new Date(y, 2, Math.floor(20.8431 + 0.242194 * yy - Math.floor(yy / 4))));
  add(new Date(y, 3, 29)); add(new Date(y, 4, 3)); add(new Date(y, 4, 4)); add(new Date(y, 4, 5));
  add(nthMon(7, 3)); add(new Date(y, 7, 11)); add(nthMon(9, 3));
  add(new Date(y, 8, Math.floor(23.2488 + 0.242194 * yy - Math.floor(yy / 4))));
  add(nthMon(10, 2)); add(new Date(y, 10, 3)); add(new Date(y, 10, 23));
  Object.keys(map).forEach(function (k) {   // 振替休日
    var x = map[k]; if (x.getDay() !== 0) return;
    var n = new Date(x.getFullYear(), x.getMonth(), x.getDate() + 1);
    while (map[key(n)]) n = new Date(n.getFullYear(), n.getMonth(), n.getDate() + 1);
    map[key(n)] = n;
  });
  var days = Object.keys(map).map(function (k) { return map[k]; }).sort(function (a, b) { return a - b; });
  for (var i = 0; i < days.length - 1; i++) {   // 国民の休日
    if ((days[i + 1] - days[i]) / 86400000 !== 2) continue;
    var mid = new Date(days[i].getFullYear(), days[i].getMonth(), days[i].getDate() + 1);
    if (mid.getDay() !== 0 && !map[key(mid)]) map[key(mid)] = mid;
  }
  return !!map[key(d)];
}

function taskApi_out(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
