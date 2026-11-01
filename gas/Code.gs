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
 *  action: ping / list / put / delete / batch / image / imageData / imageDelete / names / geocode / mapLink
 *          yoteiCal / yoteiResults / yoteiCreateEvent（予定合わせ・合言葉が要る）
 *          yoteiGet / yoteiAnswer（予定合わせの相手用・合言葉なし。下の「予定合わせ」を参照）
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
  // 予定合わせの相手用の窓口（合言葉なし）。合言葉の確認より前に分け、ここから先の処理には進ませない
  if (req.action === 'yoteiGet' || req.action === 'yoteiAnswer') return yoteiPublic_(ss, req);
  var conf = ss.getSheetByName(CONF_SHEET);
  var pass = conf ? String(conf.getRange(CELL_KEY).getValue()).trim() : '';
  if (!pass) return { ok: false, error: 'no_setup' };
  if (String(req.key || '') !== pass) return { ok: false, error: 'bad_key' };
  if (req.action === 'geocode' || req.action === 'mapLink') {   // 場所の検索はスプシに書かないので、順番待ち（ロック）なしで返す
    var g = req.action === 'geocode' ? geocode_(req) : mapLink_(req);
    if (g.error) return { ok: false, error: g.error };
    g.ok = true; g.now = now_();
    return g;
  }
  if (req.action === 'yoteiCal') {   // カレンダーを読むだけ（スプシに書かない）ので、ロックなし
    var yc = yoteiCal_(req);
    if (yc.error) return yc.detail ? { ok: false, error: yc.error, detail: yc.detail } : { ok: false, error: yc.error };
    yc.ok = true; yc.now = now_();
    return yc;
  }

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
      case 'yoteiResults': res = yoteiResults_(ss, req); break;
      case 'yoteiCreateEvent': res = yoteiCreateEvent_(ss, req); break;
      default: res = { error: 'bad_action' };
    }
    if (res.error) return res.detail ? { ok: false, error: res.error, detail: res.detail } : { ok: false, error: res.error };
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

// ---------- 場所の検索（建物名・住所 → 緯度経度） ----------
// Google マップの検索（Apps Script の Maps サービス）を使う。APIキー不要・無料（1日の回数に上限あり）
function geocode_(req) {
  var q = String(req.q || '').trim().slice(0, 120);
  if (!q) return { error: 'no_data' };
  var res = Maps.newGeocoder().setLanguage('ja').setRegion('jp').geocode(q);
  var out = (res && res.results || []).slice(0, 5).map(function (r) {
    var comps = r.address_components || [];
    var poi = comps.filter(function (c) { return (c.types || []).some(function (t) { return t === 'establishment' || t === 'point_of_interest'; }); })[0];
    var name = poi ? poi.long_name : '';
    var addr = String(r.formatted_address || '').replace(/^日本、\s*/, '').replace(/〒\d{3}-\d{4}\s*/, '');
    return { name: name, address: addr, lat: r.geometry.location.lat, lng: r.geometry.location.lng };
  });
  return { status: res && res.status, results: out };
}

// Googleマップの共有リンク（maps.app.goo.gl など）→ 名前と緯度経度。リンク先をたどって最終URLから読む
function mapLink_(req) {
  var url = String(req.url || '').trim();
  var ok = function (u) { return /^https:\/\/(maps\.app\.goo\.gl|goo\.gl\/maps|(www\.)?google\.(com|co\.jp)\/maps|maps\.google\.(com|co\.jp))\b/i.test(u); };
  if (!ok(url)) return { error: 'bad_link' };
  for (var i = 0; i < 6; i++) {
    if (parseMapUrl_(url)) break;
    var res;
    try { res = UrlFetchApp.fetch(url, { followRedirects: false, muteHttpExceptions: true }); } catch (e) { break; }
    var loc = res.getHeaders()['Location'] || res.getHeaders()['location'];
    if (!loc) {
      // リダイレクトでなくページが返った場合は、中の地図URLを探す
      var m = /https:\/\/www\.google\.[a-z.]+\/maps\/[^"'\s<>\\]+/.exec(res.getContentText());
      if (!m) break;
      loc = m[0].replace(/\\u003d/g, '=').replace(/\\u0026/g, '&').replace(/&amp;/g, '&');
    }
    url = loc;
  }
  var p = parseMapUrl_(url);
  if (!p) return { error: 'no_place' };
  return { place: p };
}
function parseMapUrl_(u) {
  u = String(u || '');
  var m = /!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/.exec(u) || /@(-?\d+\.\d+),(-?\d+\.\d+)/.exec(u) ||
    /[?&](?:q|query|ll)=(-?\d+\.\d+),\s*(-?\d+\.\d+)/.exec(decodeURIComponent(u));
  if (!m) return null;
  var name = '';
  var n = /\/maps\/place\/([^\/@?]+)/.exec(u);
  if (n) { try { name = decodeURIComponent(n[1].replace(/\+/g, ' ')); } catch (e) { name = n[1]; } }
  return { name: name, lat: parseFloat(m[1]), lng: parseFloat(m[2]) };
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

// エディタから1回実行して「外部URLへの接続」を許可するための関数
function authorizeMapLink() {
  var r = UrlFetchApp.fetch('https://maps.google.com/', { muteHttpExceptions: true, followRedirects: false });
  Logger.log('ok ' + r.getResponseCode());
}

// エディタから1回実行して「カレンダーの表示と編集」を許可するための関数（予定合わせ用）
// 実行 → 許可 →［デプロイを管理］→ 新バージョン。予定を読んだ件数をログに出すだけで、何も書かない
function authorizeCalendar() {
  var cal = CalendarApp.getDefaultCalendar();
  var t = new Date();
  Logger.log('ok ' + cal.getEvents(t, new Date(t.getTime() + 86400000)).length);
}

// ---------- 予定合わせ（yotei） ----------
/*
 * データの置き場所
 *  ・シート app=yotei … 自分用のレコード（ふつうの put / list / delete で同期。合言葉が要る）
 *      data = { kind:'event', title, start:'YYYY-MM-DD', end:'YYYY-MM-DD', from:9, to:21, step:30, need:60,
 *               deadline:'YYYY-MM-DD', token:'英数字32文字', mine:['0110…', …], status:'open'|'closed'|'decided',
 *               decided:{ start:ISO, end:ISO } }
 *      時刻はすべて日本時間。マスは「1日1本の 0/1 の文字列」（長さ＝(to-from)*60/step、日数＝start〜end）。
 *      トークンは自分の端末で作る（crypto の乱数）。作り直し・締め切り・削除もふつうの put / delete で行う
 *  ・シート yotei_answers … 相手の答え。1行＝1人（予定合わせID＋端末ID＋名前が同じなら同じ人として上書き）
 *      A eventId ／ B device ／ C createdAt ／ D updatedAt ／ E edits（直した回数）／ F data（JSON {name, cells}）
 *      名前は JSON の中にだけ入れる（セルの先頭が = にならないので、式として読まれない）
 *  ・シート yotei_writes … 書き込みの記録（1つの予定合わせに1時間60回までの数え用）。A eventId ／ B at
 *
 * 合言葉なしの窓口（yoteiGet / yoteiAnswer）が使うのは、app=yotei の読み取りと、上の2シートだけ。
 * ほかのシート・画像・カレンダーには触れない。トークンが合わない・消した・期限切れは、どれも not_found だけを返す。
 * 掃除：期間の終わりから30日たった予定合わせ・消した予定合わせの答えは、次の書き込み・結果の読み込みのときに消す
 * （トリガーは使わない）。期限切れの予定合わせは、相手の窓口からは見つからない扱いになる。
 */
var YOTEI_APP = 'yotei';
var YOTEI_ANS = 'yotei_answers';
var YOTEI_WRITES = 'yotei_writes';
var YOTEI_ANS_HEADER = ['eventId', 'device', 'createdAt', 'updatedAt', 'edits', 'data'];
var YOTEI_TOKEN_RE = /^[A-Za-z0-9]{32}$/;
var YOTEI_DEVICE_RE = /^[A-Za-z0-9_-]{16,64}$/;
var YOTEI_YMD_RE = /^\d{4}-\d{2}-\d{2}$/;
var YOTEI_MAX_BODY = 5000;     // 相手から1回に受け取る量（文字）
var YOTEI_MAX_PEOPLE = 5;      // 1つの予定合わせに答えられる人数
var YOTEI_MAX_EDITS = 20;      // 1人が直せる回数
var YOTEI_MAX_WRITES = 60;     // 1つの予定合わせへの書き込み（1時間あたり）
var YOTEI_MAX_DAYS = 14;
var YOTEI_KEEP_DAYS = 30;      // 期間の終わりから何日で答えを消すか
var DAY_MS = 86400000;

function yoteiDay_(ymd) { return YOTEI_YMD_RE.test(String(ymd)) ? Date.parse(ymd + 'T00:00:00+09:00') : NaN; }
function yoteiNow_() { return new Date().getTime(); }

// 予定合わせの形を確かめ、日数・1日のマス数を返す（壊れていれば null）
function yoteiShape_(d) {
  if (!d || d.kind !== 'event') return null;
  var s = yoteiDay_(d.start), e = yoteiDay_(d.end);
  if (isNaN(s) || isNaN(e) || e < s) return null;
  var days = Math.round((e - s) / DAY_MS) + 1;
  var from = +d.from, to = +d.to, step = +d.step;
  if (days > YOTEI_MAX_DAYS || !(step === 30 || step === 60)) return null;
  if (from !== Math.floor(from) || to !== Math.floor(to) || from < 0 || to > 24 || from >= to) return null;
  return { days: days, rows: (to - from) * 60 / step, start: s, end: e };
}

function yoteiExpired_(shape) { return yoteiNow_() >= shape.end + DAY_MS * (1 + YOTEI_KEEP_DAYS); }

// open / closed / decided（締切は締切日の終わり＝翌日0時、期間が終わっても受付終了）
function yoteiState_(d, shape) {
  if (d.status === 'decided') return 'decided';
  if (d.status !== 'open') return 'closed';
  var dl = yoteiDay_(d.deadline), now = yoteiNow_();
  if (!isNaN(dl) && now >= dl + DAY_MS) return 'closed';
  if (now >= shape.end + DAY_MS) return 'closed';
  return 'open';
}

// 生きている予定合わせ（消していない・形が正しい・期限切れでない）を id → {data, shape} で
function yoteiEvents_(ss) {
  var sh = sheet_(ss, YOTEI_APP, false), out = {};
  if (!sh) return out;
  rows_(sh).forEach(function (r) {
    if (r.deleted || !r.data) return;
    var d; try { d = JSON.parse(r.data); } catch (e) { return; }
    var shape = yoteiShape_(d);
    if (!shape || yoteiExpired_(shape)) return;
    out[r.id] = { id: r.id, data: d, shape: shape };
  });
  return out;
}

function yoteiByToken_(ss, token) {
  var sh = sheet_(ss, YOTEI_APP, false);
  if (!sh) return null;
  var list = rows_(sh);
  for (var i = 0; i < list.length; i++) {
    var r = list[i];
    if (r.deleted || r.data.indexOf(token) < 0) continue;
    var d; try { d = JSON.parse(r.data); } catch (e) { continue; }
    if (d.token !== token) continue;
    var shape = yoteiShape_(d);
    if (!shape || yoteiExpired_(shape)) return null;
    return { id: r.id, data: d, shape: shape };
  }
  return null;
}

function yoteiSheet_(ss, name, header) {
  var sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.getRange(1, 1, 1, header.length).setValues([header]).setFontWeight('bold');
    sh.getRange(1, 1, 1000, header.length).setNumberFormat('@');
    sh.setFrozenRows(1);
  }
  return sh;
}

function yoteiAnswerRows_(sh) {
  var last = sh.getLastRow();
  if (last < 2) return [];
  return sh.getRange(2, 1, last - 1, YOTEI_ANS_HEADER.length).getValues().map(function (v, i) {
    return { row: i + 2, eventId: String(v[0]), device: String(v[1]), createdAt: str_(v[2]), updatedAt: str_(v[3]),
      edits: +v[4] || 0, data: String(v[5]) };
  });
}

// 古い答え・消した予定合わせの答え・1時間より前の書き込み記録を消す（ロックの中で呼ぶ）
function yoteiCleanup_(ss, live) {
  var ans = ss.getSheetByName(YOTEI_ANS);
  if (ans) {
    var del = yoteiAnswerRows_(ans).filter(function (a) { return a.eventId && !live[a.eventId]; }).map(function (a) { return a.row; });
    for (var i = del.length - 1; i >= 0; i--) ans.deleteRow(del[i]);
  }
  var w = ss.getSheetByName(YOTEI_WRITES);
  if (w && w.getLastRow() >= 2) {
    var limit = yoteiNow_() - 3600000;
    var vals = w.getRange(2, 1, w.getLastRow() - 1, 2).getValues();
    for (var j = vals.length - 1; j >= 0; j--) {
      var at = Date.parse(str_(vals[j][1]));
      if (!live[String(vals[j][0])] || isNaN(at) || at < limit) w.deleteRow(j + 2);
    }
  }
}

// ---- 合言葉なしの窓口 ----
function yoteiPublic_(ss, req) {
  var NF = { ok: false, error: 'not_found' };
  try {
    if (JSON.stringify(req).length > YOTEI_MAX_BODY) return { ok: false, error: 'too_long' };
    var token = typeof req.token === 'string' ? req.token : '';
    if (!YOTEI_TOKEN_RE.test(token)) return NF;
    if (req.action === 'yoteiGet') {
      var ev = yoteiByToken_(ss, token);
      if (!ev) return NF;
      return { ok: true, now: now_(), event: yoteiPublicView_(ev) };
    }
    var lock = LockService.getScriptLock();
    try { lock.waitLock(10000); } catch (e) { return { ok: false, error: 'busy' }; }
    try {
      var r = yoteiAnswer_(ss, token, req);
      if (r.error) return { ok: false, error: r.error };
      r.ok = true; r.now = now_();
      return r;
    } finally {
      lock.releaseLock();
    }
  } catch (err) {
    return { ok: false, error: 'server' };   // 相手の窓口では中身（シート名など）を出さない
  }
}

// 相手に見せてよいものだけ（自分の空き・トークン・他の人の答えは入れない）
function yoteiPublicView_(ev) {
  var d = ev.data, st = yoteiState_(d, ev.shape);
  var out = { title: String(d.title || '').slice(0, 40), start: d.start, end: d.end, from: +d.from, to: +d.to, step: +d.step,
    deadline: YOTEI_YMD_RE.test(String(d.deadline)) ? d.deadline : '', state: st };
  if (st === 'decided' && d.decided) out.decided = { start: String(d.decided.start || ''), end: String(d.decided.end || '') };
  return out;
}

function yoteiName_(v) {
  var n = String(typeof v === 'string' ? v : '').replace(/[\u0000-\u001F\u007F\u2028\u2029]/g, '').replace(/^\s+|\s+$/g, '');
  var len = n.replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]/g, '_').length;
  return len >= 1 && len <= 20 ? n : '';
}

function yoteiCells_(cells, shape) {
  if (!Array.isArray(cells) || cells.length !== shape.days) return null;
  for (var i = 0; i < cells.length; i++) {
    if (typeof cells[i] !== 'string' || cells[i].length !== shape.rows || !/^[01]+$/.test(cells[i])) return null;
  }
  return cells.slice();
}

function yoteiAnswer_(ss, token, req) {
  var live = yoteiEvents_(ss);
  var ev = null;
  for (var id in live) if (live[id].data.token === token) { ev = live[id]; break; }
  if (!ev) return { error: 'not_found' };
  if (yoteiState_(ev.data, ev.shape) !== 'open') return { error: 'closed' };
  var name = yoteiName_(req.name);
  if (!name) return { error: 'bad_name' };
  var device = typeof req.device === 'string' ? req.device : '';
  if (!YOTEI_DEVICE_RE.test(device)) return { error: 'bad_request' };
  var cells = yoteiCells_(req.cells, ev.shape);
  if (!cells) return { error: 'bad_cells' };

  yoteiCleanup_(ss, live);
  var w = yoteiSheet_(ss, YOTEI_WRITES, ['eventId', 'at']);
  var recent = w.getLastRow() < 2 ? 0 : w.getRange(2, 1, w.getLastRow() - 1, 1).getValues()
    .filter(function (v) { return String(v[0]) === ev.id; }).length;
  if (recent >= YOTEI_MAX_WRITES) return { error: 'too_many' };

  var sh = yoteiSheet_(ss, YOTEI_ANS, YOTEI_ANS_HEADER);
  var mine = yoteiAnswerRows_(sh).filter(function (a) { return a.eventId === ev.id; });
  var same = mine.filter(function (a) {
    if (a.device !== device) return false;
    try { return JSON.parse(a.data).name === name; } catch (e) { return false; }
  })[0];
  var t = now_();
  var json = JSON.stringify({ name: name, cells: cells });   // 名前と塗ったマス以外は捨てる
  var row, rec;
  if (same) {
    if (same.edits >= YOTEI_MAX_EDITS) return { error: 'too_many_edits' };
    row = same.row;
    rec = [ev.id, device, same.createdAt, t, String(same.edits + 1), json];
  } else {
    if (mine.length >= YOTEI_MAX_PEOPLE) return { error: 'full' };
    row = sh.getLastRow() + 1;
    rec = [ev.id, device, t, t, '0', json];
  }
  var range = sh.getRange(row, 1, 1, YOTEI_ANS_HEADER.length);
  range.setNumberFormat('@');
  range.setValues([rec]);
  var wr = w.getRange(w.getLastRow() + 1, 1, 1, 2);
  wr.setNumberFormat('@');
  wr.setValues([[ev.id, t]]);
  return { saved: true, edits: +rec[4], editsLeft: YOTEI_MAX_EDITS - +rec[4] };
}

// ---- 合言葉が要るもの ----
// yoteiCal：期間の予定の「始まり・終わり」だけ（件名・場所・中身は返さない。終日の予定・欠席にした予定は除く）
function yoteiCal_(req) {
  var s = yoteiDay_(req.from), e = yoteiDay_(req.to);
  if (isNaN(s) || isNaN(e) || e < s) return { error: 'bad_request' };
  if ((e - s) / DAY_MS + 1 > YOTEI_MAX_DAYS + 1) return { error: 'too_long' };
  var evs;
  try {
    evs = CalendarApp.getDefaultCalendar().getEvents(new Date(s), new Date(e + DAY_MS));
  } catch (err) {
    return { error: 'calendar', detail: String((err && err.message) || err).slice(0, 200) };
  }
  var busy = [];
  evs.forEach(function (ev) {
    if (ev.isAllDayEvent()) return;
    try { if (ev.getMyStatus() === CalendarApp.GuestStatus.NO) return; } catch (x) { /* 自分の予定など */ }
    busy.push({ s: ev.getStartTime().toISOString(), e: ev.getEndTime().toISOString() });
  });
  return { busy: busy };
}

// yoteiResults：答え（名前・塗ったマス・日時）。端末IDは返さない。id を付けるとその予定合わせだけ
function yoteiResults_(ss, req) {
  var live = yoteiEvents_(ss);
  yoteiCleanup_(ss, live);
  var only = req.id ? String(req.id) : '';
  var out = {};
  var sh = ss.getSheetByName(YOTEI_ANS);
  if (sh) yoteiAnswerRows_(sh).forEach(function (a) {
    if (!live[a.eventId] || (only && a.eventId !== only)) return;
    var d; try { d = JSON.parse(a.data); } catch (e) { return; }
    (out[a.eventId] = out[a.eventId] || []).push({ name: d.name, cells: d.cells, createdAt: a.createdAt, updatedAt: a.updatedAt, edits: a.edits });
  });
  return { answers: out };
}

// yoteiCreateEvent：確認のあとに1件だけ作る（招待メールなし）。件名＝名前、メモ＝答えた人。
// 作ったら予定合わせを「決定」にする（2台から押しても二重にならない）
function yoteiCreateEvent_(ss, req) {
  var id = String(req.id || '');
  if (!ID_RE.test(id)) return { error: 'bad_id' };
  var live = yoteiEvents_(ss), ev = live[id];
  if (!ev) return { error: 'not_found' };
  if (ev.data.status === 'decided') return { error: 'already' };
  var s = Date.parse(String(req.start || '')), e = Date.parse(String(req.end || ''));
  if (isNaN(s) || isNaN(e) || e <= s || e - s > DAY_MS || s < ev.shape.start || e > ev.shape.end + DAY_MS) return { error: 'bad_time' };
  var names = [];
  var sh = ss.getSheetByName(YOTEI_ANS);
  if (sh) yoteiAnswerRows_(sh).forEach(function (a) {
    if (a.eventId !== id) return;
    try { names.push(JSON.parse(a.data).name); } catch (x) { /* 無視 */ }
  });
  var title = String(ev.data.title || '予定合わせ').slice(0, 40);
  var made;
  try {
    made = CalendarApp.getDefaultCalendar().createEvent(title, new Date(s), new Date(e), {
      description: '参加：' + (names.length ? names.join('・') : '（答えた人なし）') + '\n（予定合わせで決定）',
      sendInvites: false
    });
  } catch (err) {
    return { error: 'calendar', detail: String((err && err.message) || err).slice(0, 200) };
  }
  var d = ev.data;
  d.status = 'decided';
  d.decided = { start: new Date(s).toISOString(), end: new Date(e).toISOString() };
  var r = put_(ss, { app: YOTEI_APP, id: id, data: d });
  return { record: r.record, calendarEventId: made && made.getId ? made.getId() : '' };
}
