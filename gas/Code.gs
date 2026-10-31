/**
 * cotoxdgn アプリ共通のデータ保存プログラム（Google Apps Script）
 * 使い方は SETUP.md を参照。
 *  1) このコードを貼り付けて保存 → 関数「setup」を1回実行（合言葉・画像フォルダは自動で作られます）
 *  2) デプロイ → 新しいデプロイ → 種類「ウェブアプリ」
 *     実行ユーザー：自分 ／ アクセスできるユーザー：全員
 *  3) スプシを開き直し、メニュー「アプリ設定」→「この端末をつなぐ」
 *
 * 通信の形（アプリ側は shared/apps.js が面倒を見ます）
 *  POST（Content-Type: text/plain）で JSON を送る → JSON が返る。
 *  text/plain の POST は「単純リクエスト」なので、ブラウザの事前確認（CORS preflight）が起きない。
 *  { key, action, app, ... }  →  { ok: true, now, ... } / { ok: false, error }
 *  action: ping / list / put / delete / batch / image / imageData / imageDelete / names
 */

var CONNECT_URL = 'https://cotoxdgn.github.io/connect/';
var QR_LIB_URL = 'https://cotoxdgn.github.io/shared/lib/qrcode.js';
var CONF_SHEET = '設定';
var HEADER = ['id', 'createdAt', 'updatedAt', 'deleted', 'data'];
var MAX_DATA_LEN = 45000;              // data(JSON) の上限文字数（スプシのセル上限 50,000 未満）
var MAX_IMAGE_BYTES = 2 * 1024 * 1024; // 画像1枚の上限（アプリ側で縮小してから送る前提）
var MAX_BATCH = 200;                   // batch 1回あたりの件数上限
var IMAGE_MIMES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' };
// 画像を「リンクを知っている人は閲覧可」にするか。false にすると imageData 経由でしか見られない（表示は遅くなる）
var IMAGE_LINK_SHARING = true;

// 設定シートのセル
var CELL_KEY = 'B1';     // 合言葉（自動）
var CELL_URL = 'B2';     // 接続URL（自動）
var CELL_TARGET = 'B3';  // 対象アプリ（空＝全アプリ共通、例：wanko）
var CELL_FOLDER = 'B4';  // 画像フォルダID（自動）
// 名前表（家族用＝B3 が wanko のスプシだけ作る）。A列＝見出し、B列＝名前を手で入力
var NAMES_TITLE_ROW = 8;
var NAMES_LABELS = ['わんこ1', 'わんこ2', '家族1', '家族2', '家族3', '家族4'];
var NAMES_FIRST_ROW = NAMES_TITLE_ROW + 1;

// ---------- 準備 ----------
function setup() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var conf = conf_();
  folder_(conf);
  var def = ss.getSheetByName('シート1') || ss.getSheetByName('Sheet1');
  if (def && ss.getSheets().length > 1 && def.getLastRow() === 0) ss.deleteSheet(def);
}

// 「設定」シートを整え、合言葉が空なら自動で作る
function conf_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var conf = ss.getSheetByName(CONF_SHEET) || ss.insertSheet(CONF_SHEET, 0);
  conf.getRange('A1').setValue('合言葉（自動）');
  conf.getRange('A2').setValue('接続URL（自動）');
  conf.getRange('A3').setValue('対象アプリ（空欄＝全アプリ共通）');
  conf.getRange('A4').setValue('画像フォルダID（自動）');
  conf.getRange('A1:A4').setFontWeight('bold');
  conf.getRange('B1:B4').setNumberFormat('@');
  conf.getRange('A6').setValue('入力は不要です（家族用のスプシだけ、B3 にアプリ名 wanko を入れます）。端末の設定は、メニュー「アプリ設定」→「この端末をつなぐ」から行います。B1・B2 は人に見せないでください。');
  var key = String(conf.getRange(CELL_KEY).getValue()).trim();
  if (!key) {
    key = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '').slice(0, 8);
    conf.getRange(CELL_KEY).setValue(key);
  }
  if (String(conf.getRange(CELL_TARGET).getValue()).trim() === 'wanko') namesTable_(conf);
  return conf;
}

// 名前表の見出しを用意する（B列の入力済みの名前には触れない）
function namesTable_(conf) {
  conf.getRange('A' + NAMES_TITLE_ROW).setValue('名前（B列に入力。アプリに表示されます）');
  conf.getRange('A' + NAMES_TITLE_ROW).setFontWeight('bold');
  for (var i = 0; i < NAMES_LABELS.length; i++) {
    conf.getRange('A' + (NAMES_FIRST_ROW + i)).setValue(NAMES_LABELS[i]);
  }
}

// names：名前表を読むだけ（空欄は ''。アプリ側で既定の呼び名を使う）
function names_(conf) {
  var vals = conf.getRange(NAMES_FIRST_ROW, 2, NAMES_LABELS.length, 1).getValues();
  var v = vals.map(function (r) { return String(r[0] == null ? '' : r[0]).trim().slice(0, 20); });
  // target：B3 の値（wanko でなければ、名前表は作られていない）
  return { names: { dogs: v.slice(0, 2), members: v.slice(2, 6) }, target: String(conf.getRange(CELL_TARGET).getValue()).trim() };
}

// 画像の保存先フォルダ（なければ作る）
function folder_(conf) {
  var id = String(conf.getRange(CELL_FOLDER).getValue()).trim();
  if (id) {
    try { return DriveApp.getFolderById(id); } catch (e) { /* 消されていたら作り直す */ }
  }
  var name = 'アプリの画像（' + SpreadsheetApp.getActiveSpreadsheet().getName() + '）';
  var f = DriveApp.createFolder(name);
  conf.getRange(CELL_FOLDER).setValue(f.getId());
  return f;
}

function subFolder_(parent, app) {
  var it = parent.getFoldersByName(app);
  return it.hasNext() ? it.next() : parent.createFolder(app);
}

// ---------- スプシのメニュー ----------
function onOpen() {
  SpreadsheetApp.getUi().createMenu('アプリ設定')
    .addItem('この端末をつなぐ（リンクとQR）', 'showConnect')
    .addItem('準備をやり直す（setup）', 'setup')
    .addToUi();
}

// 公開URL（…/exec）を探す：自動で取れなければ B2 の値を使う
function execUrl_(conf) {
  // B2 に入っている URL を最優先する。ScriptApp.getService().getUrl() は、デプロイを作り直すと
  // 古い（アーカイブ済みの）URL を返すことがあり、それで上書きすると端末がつながらなくなるため。
  var saved = String(conf.getRange(CELL_URL).getValue()).trim();
  if (/\/exec$/.test(saved)) return saved;
  var u = '';
  try { u = ScriptApp.getService().getUrl() || ''; } catch (e) { u = ''; }
  if (/\/exec$/.test(u)) {
    conf.getRange(CELL_URL).setValue(u);
    return u;
  }
  return '';
}

// 接続リンク（connect ページ＋#c=…）を作る
function connectLink_(conf) {
  var url = execUrl_(conf);
  if (!url) return '';
  var payload = {
    u: url,
    k: String(conf.getRange(CELL_KEY).getValue()).trim(),
    n: SpreadsheetApp.getActiveSpreadsheet().getName()
  };
  var target = String(conf.getRange(CELL_TARGET).getValue()).trim();
  if (target) payload.a = target;
  return CONNECT_URL + '#c=' + b64url_(JSON.stringify(payload));
}

function showConnect() {
  var conf = conf_();
  var t = HtmlService.createTemplate(CONNECT_HTML);
  t.link = connectLink_(conf);
  t.target = String(conf.getRange(CELL_TARGET).getValue()).trim();
  t.qrLib = QR_LIB_URL;
  SpreadsheetApp.getUi().showModalDialog(t.evaluate().setWidth(440).setHeight(600), 'この端末をつなぐ');
}

function b64url_(str) {
  return Utilities.base64EncodeWebSafe(Utilities.newBlob(str).getBytes()).replace(/=+$/, '');
}

var CONNECT_HTML = [
  '<div style="font-family:sans-serif;font-size:14px;line-height:1.6;color:#1F2328">',
  '<? if (!link) { ?>',
  '<p style="color:#9B2C1C;font-weight:bold">接続URLが見つかりませんでした。</p>',
  '<p>「デプロイ」→「デプロイを管理」で、ウェブアプリのURL（…/exec で終わるもの）をコピーし、「設定」シートの <b>B2</b> に貼り付けてから、もう一度このメニューを開いてください。</p>',
  '<? } else { ?>',
  '<p>つなぐ先：<b><?= target ? target + " だけ" : "全アプリ共通" ?></b></p>',
  '<p><b>このパソコン</b>：下のボタンを押すと、設定ページが開いて完了します。</p>',
  '<p><a href="<?= link ?>" target="_blank" rel="noopener" style="display:block;text-align:center;background:#0F6E6E;color:#fff;padding:12px;border-radius:12px;text-decoration:none;font-weight:bold">この端末をつなぐ</a></p>',
  '<p><b>iPhone・iPad</b>：ホーム画面から開いたアプリの「QRでつなぐ」を押し、このQRを映してください。</p>',
  '<div id="qr" style="text-align:center"></div>',
  '<p style="color:#9B2C1C;font-size:12px">このリンクとQRには合言葉が入っています。スクショ・共有はしないでください。</p>',
  '<script src="<?= qrLib ?>"></script>',
  '<script>',
  '  try { var q = qrcode(0, "M"); q.addData(<?!= JSON.stringify(link) ?>); q.make();',
  '    document.getElementById("qr").innerHTML = q.createImgTag(4, 8); } catch (e) {',
  '    document.getElementById("qr").textContent = "QRを表示できませんでした（ボタンからの設定は使えます）"; }',
  '</script>',
  '<? } ?>',
  '</div>'
].join('\n');

// ---------- 通信の入口 ----------
function doGet() {
  // ブラウザで …/exec を開いたときに、接続URLを覚えておく（メニューの設定用）
  try { execUrl_(conf_()); } catch (e) { /* 無視 */ }
  return out_({ ok: true, app: 'apps-site' });
}

function doPost(e) {
  var req;
  try {
    req = JSON.parse(e.postData.contents);
  } catch (err) {
    return out_({ ok: false, error: 'bad_request' });
  }
  try {
    return out_(handle_(req));
  } catch (err) {
    // 予期しないエラーも必ずJSONで返す（HTMLのエラー画面だとアプリ側で「通信できません」に見えてしまうため）
    return out_({ ok: false, error: 'server', detail: String((err && err.message) || err).slice(0, 300) });
  }
}

// 本体（テストからも呼べるように、結果はただのオブジェクトで返す）
function handle_(req) {
  if (!req || typeof req !== 'object') return { ok: false, error: 'bad_request' };
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var conf = ss.getSheetByName(CONF_SHEET);
  var pass = conf ? String(conf.getRange(CELL_KEY).getValue()).trim() : '';
  if (!pass) return { ok: false, error: 'no_setup' };
  if (String(req.key || '') !== pass) return { ok: false, error: 'bad_key' };

  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(20000);
  } catch (e) {
    return { ok: false, error: 'busy' };
  }
  try {
    var res;
    switch (req.action) {
      case 'ping': res = { apps: appSheets_(ss) }; break;
      case 'list': res = list_(ss, req); break;
      case 'put': res = one_(put_(ss, req)); break;
      case 'delete': res = one_(del_(ss, req)); break;
      case 'batch': res = batch_(ss, req); break;
      case 'image': res = image_(conf, req); break;
      case 'imageData': res = imageData_(conf, req); break;
      case 'imageDelete': res = imageDelete_(conf, req); break;
      case 'names': res = names_(conf); break;
      default: res = { error: 'bad_action' };
    }
    if (res.error) return { ok: false, error: res.error };
    res.ok = true;
    res.now = now_();
    return res;
  } catch (err) {
    return { ok: false, error: 'server', detail: String(err && err.message || err).slice(0, 200) };
  } finally {
    lock.releaseLock();
  }
}

function one_(r) {
  return r.error ? r : { record: r.record };
}

// ---------- レコード操作 ----------
var APP_RE = /^[a-z0-9][a-z0-9_-]{0,29}$/;
var ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

function now_() { return new Date().toISOString(); }

function validApp_(app) { return typeof app === 'string' && APP_RE.test(app); }

// アプリ名のシート（app=<name>）。create=true ならなければ作る
function sheet_(ss, app, create) {
  var name = 'app=' + app;
  var sh = ss.getSheetByName(name);
  if (!sh && create) {
    sh = ss.insertSheet(name);
    sh.getRange(1, 1, 1, HEADER.length).setValues([HEADER]).setFontWeight('bold');
    sh.getRange('A:E').setNumberFormat('@');
    sh.setFrozenRows(1);
  }
  return sh;
}

function appSheets_(ss) {
  return ss.getSheets().map(function (s) { return s.getName(); })
    .filter(function (n) { return n.indexOf('app=') === 0; })
    .map(function (n) { return n.slice(4); });
}

function rows_(sh) {
  var last = sh.getLastRow();
  if (last < 2) return [];
  var vals = sh.getRange(2, 1, last - 1, HEADER.length).getValues();
  var out = [];
  for (var i = 0; i < vals.length; i++) {
    var v = vals[i];
    if (!String(v[0])) continue;
    out.push({ row: i + 2, id: String(v[0]), createdAt: str_(v[1]), updatedAt: str_(v[2]),
      deleted: String(v[3]).toUpperCase() === 'TRUE', data: String(v[4]) });
  }
  return out;
}

// 手で日付を入れられた場合なども文字列にそろえる
function str_(v) { return v instanceof Date ? v.toISOString() : String(v); }

function toRecord_(r) {
  var data = null;
  try { data = r.data ? JSON.parse(r.data) : null; } catch (e) { data = { _raw: r.data }; }
  return { id: r.id, createdAt: r.createdAt, updatedAt: r.updatedAt, deleted: r.deleted, data: data };
}

// list：since なし＝削除済みを除く全件、since あり＝その時刻以降に変わったもの（削除も含む）
function list_(ss, req) {
  if (!validApp_(req.app)) return { error: 'bad_app' };
  var sh = sheet_(ss, req.app, false);
  if (!sh) return { records: [] };
  var since = req.since ? String(req.since) : '';
  var recs = rows_(sh).filter(function (r) {
    return since ? r.updatedAt >= since : !r.deleted;
  }).map(toRecord_);
  return { records: recs };
}

function findRow_(sh, id) {
  var last = sh.getLastRow();
  if (last < 2) return 0;
  var ids = sh.getRange(2, 1, last - 1, 1).getValues();
  for (var i = 0; i < ids.length; i++) if (String(ids[i][0]) === id) return i + 2;
  return 0;
}

function writeRow_(sh, row, rec) {
  var range = sh.getRange(row, 1, 1, HEADER.length);
  range.setNumberFormat('@');
  range.setValues([[rec.id, rec.createdAt, rec.updatedAt, rec.deleted ? 'TRUE' : 'FALSE', rec.data]]);
}

// put：id があれば更新、なければ作成（id はアプリ側で作ってよい＝オフライン作成でも二重にならない）
function put_(ss, req) {
  if (!validApp_(req.app)) return { error: 'bad_app' };
  var id = req.id ? String(req.id) : Utilities.getUuid();
  if (!ID_RE.test(id)) return { error: 'bad_id' };
  if (req.data === undefined) return { error: 'no_data' };
  var json = JSON.stringify(req.data);
  if (json.length > MAX_DATA_LEN) return { error: 'too_long' };
  var sh = sheet_(ss, req.app, true);
  var t = now_();
  var row = findRow_(sh, id);
  var createdAt = t;
  if (row) {
    createdAt = str_(sh.getRange(row, 2, 1, 1).getValues()[0][0]) || t;
  } else {
    if (req.createdAt && !isNaN(Date.parse(req.createdAt))) createdAt = new Date(req.createdAt).toISOString();
    row = sh.getLastRow() + 1;
  }
  var rec = { id: id, createdAt: createdAt, updatedAt: t, deleted: false, data: json };
  writeRow_(sh, row, rec);
  return { record: toRecord_(rec) };
}

// delete：論理削除（行は残し deleted=TRUE、data は空に）
function del_(ss, req) {
  if (!validApp_(req.app)) return { error: 'bad_app' };
  var id = String(req.id || '');
  if (!ID_RE.test(id)) return { error: 'bad_id' };
  var sh = sheet_(ss, req.app, true);
  var t = now_();
  var row = findRow_(sh, id);
  var createdAt = t;
  if (row) createdAt = str_(sh.getRange(row, 2, 1, 1).getValues()[0][0]) || t;
  else row = sh.getLastRow() + 1; // 他の端末が知っている id なら、削除の印だけ残す
  var rec = { id: id, createdAt: createdAt, updatedAt: t, deleted: true, data: '' };
  writeRow_(sh, row, rec);
  return { record: toRecord_(rec) };
}

// batch：オフライン中にたまった操作をまとめて送る。1件ずつ結果を返す（1件の失敗で全体は止めない）
function batch_(ss, req) {
  var ops = req.ops;
  if (!Array.isArray(ops)) return { error: 'bad_request' };
  if (ops.length > MAX_BATCH) return { error: 'too_many' };
  var results = ops.map(function (op) {
    var o = {};
    for (var k in op) o[k] = op[k];
    if (!o.app) o.app = req.app;
    var r = o.op === 'put' ? put_(ss, o) : o.op === 'delete' ? del_(ss, o) : { error: 'bad_op' };
    return r.error ? { ok: false, error: r.error, id: o.id || null } : { ok: true, record: r.record };
  });
  return { results: results };
}

// ---------- 画像 ----------
function image_(conf, req) {
  if (!validApp_(req.app)) return { error: 'bad_app' };
  var mime = String(req.mime || 'image/jpeg');
  var ext = IMAGE_MIMES[mime];
  if (!ext) return { error: 'bad_mime' };
  var b64 = String(req.base64 || '').replace(/^data:[^,]*,/, '');
  if (!b64) return { error: 'no_data' };
  if (b64.length * 3 / 4 > MAX_IMAGE_BYTES * 1.01) return { error: 'too_large' };
  var bytes = Utilities.base64Decode(b64);
  if (bytes.length > MAX_IMAGE_BYTES) return { error: 'too_large' };
  var name = String(req.name || '').replace(/[\\\/:*?"<>|]/g, '').slice(0, 60) ||
    Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyyMMdd-HHmmss');
  if (!/\.[a-z0-9]+$/i.test(name)) name += '.' + ext;
  var dir = subFolder_(folder_(conf), req.app);
  var file = dir.createFile(Utilities.newBlob(bytes, mime, name));
  if (IMAGE_LINK_SHARING) {
    try { file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW); } catch (e) { /* 組織の制限などで不可なら非公開のまま */ }
  }
  var id = file.getId();
  return { image: { id: id, url: 'https://drive.google.com/thumbnail?id=' + id + '&sz=w1600',
    thumb: 'https://drive.google.com/thumbnail?id=' + id + '&sz=w400', name: name, bytes: bytes.length } };
}

// 画像フォルダ内のファイルだけを扱う（他のドライブのファイルを読ませない）
function ownImage_(conf, id) {
  if (!ID_RE.test(String(id || ''))) return null;
  var file;
  try { file = DriveApp.getFileById(String(id)); } catch (e) { return null; }
  var rootId = folder_(conf).getId();
  var parents = file.getParents();
  while (parents.hasNext()) {
    var p = parents.next();
    var gp = p.getParents();
    while (gp.hasNext()) if (gp.next().getId() === rootId) return file;
  }
  return null;
}

function imageData_(conf, req) {
  var file = ownImage_(conf, req.id);
  if (!file) return { error: 'not_found' };
  var blob = file.getBlob();
  return { mime: blob.getContentType(), base64: Utilities.base64Encode(blob.getBytes()) };
}

function imageDelete_(conf, req) {
  var file = ownImage_(conf, req.id);
  if (!file) return { error: 'not_found' };
  file.setTrashed(true);
  return {};
}

function out_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
