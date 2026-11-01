# 共通JS（shared/apps.js）の使い方 — 各アプリ担当向け

全アプリは `https://cotoxdgn.github.io/<アプリ名>/` に置き、同じオリジンなので
接続設定（接続URL＋合言葉）は localStorage で共有されます。各アプリで接続画面を作る必要はありません。

## 読み込み

```html
<link rel="stylesheet" href="../shared/apps.css">
<script src="../shared/apps.js"></script>
<script src="app.js"></script>
```

新しいアプリは `template/` をフォルダごとコピーし、`app.js` の `APP`、`manifest.webmanifest` の name/id、`sw.js` の `CACHE` を書き換えるのが早いです。
ホームの一覧（`/index.html` の `APPS`）にも1行足してください。

## アプリ名（APP）

英小文字・数字・`-` `_`、30文字まで。スプシのシート名が `app=<APP>` になります（初回保存時に自動作成）。
決定済み：`routine` `diary` `archmap` `filemap` `brain` `wanko` `hondana`

## 基本の形

```js
var APP = 'diary';
var db = Apps.collection(APP);          // 端末内の控え（IndexedDB）＋自動同期

db.onChange(function (list) { render(list); });   // 控えが変わるたびに呼ばれる（すぐ1回目も来る）

Apps.ensureConnected(APP)               // 未接続なら接続画面（QR読み取り）を出す
  .then(function () { return db.sync(); });

// 保存（すぐ画面に反映され、裏でスプシへ。オフラインなら再送キューにたまる）
db.put({ date: '2026-10-30', text: '晴れ' });           // 新規（id は自動）→ Promise<record>
db.put({ date: '2026-10-30', text: '晴れのち雨' }, id);  // 更新（同じ id で丸ごと置き換え）
db.remove(id);                                          // 削除（スプシでは論理削除）
```

### レコードの形

```js
{ id, createdAt, updatedAt, deleted: false, data: { …アプリが決めた中身… }, pending: true|undefined }
```

- `data` は JSON にできる値なら何でも。1件あたり約45,000文字まで（超えると `too_long`）
- `createdAt` / `updatedAt` は ISO 文字列。`updatedAt` はスプシ側の時刻で確定します（送信前は端末の時刻、`pending: true`）
- 同じレコードを2台で同時に直した場合は、**後から届いた方が勝ち**（丸ごと置き換え）。部分更新が必要なら1件を小さく分けてください
- 日付ごとの記録など「1日1件」にしたいときは、id を自分で決めると重複しません（例：`db.put(data, '2026-10-30')`）。id は英数字と `-` `_`、64文字まで

## コレクション（`Apps.collection(app)`）

| 関数 | 説明 |
|---|---|
| `db.ready` | 端末内の控えを読み終えたら解決する Promise |
| `db.all()` | 削除されていないレコードの配列（作成日時の新しい順） |
| `db.get(id)` | 1件。なければ `null` |
| `db.put(data, id?)` | 作成・更新 → `Promise<record>` |
| `db.remove(id)` | 削除 → `Promise<boolean>` |
| `db.sync({ full? })` | 送信待ちを送ってから、前回以降の変更を受け取る → `{ pulled, sent, left }`。`full: true` で全件取り直し |
| `db.onChange(fn)` | 変更時に `fn(list)`。戻り値で解除 |
| `db.pendingCount()` | 送信待ちの件数 → `Promise<number>` |

自動同期：起動時・オンライン復帰時・画面が前面に戻ったとき。止めたいときは `Apps.collection(app, { autoSync: false })`（最初の呼び出しで指定）。

## 画像

```js
// <input type="file" accept="image/*"> の file を渡す。長辺1600px・約1.5MB以下の JPEG に縮小して保存
Apps.uploadImage(APP, file).then(function (img) {
  // img = { id, url, thumb, name, bytes }
  db.put({ text: '…', photos: [img.id] });     // レコードには id だけ持たせる
});
imgEl.src = Apps.imageUrl(id, 800);             // 表示用URL（幅 px）
Apps.deleteImage(APP, id);                      // ドライブのゴミ箱へ
```

- 画像の保存は**オンライン時のみ**（オフラインだと `offline` エラー）。スプシ側の上限は1枚2MB
- 保存先：ドライブ「アプリの画像（スプシ名）」/<アプリ名>/。「リンクを知っている人は閲覧可」にして `imageUrl` で表示
- 共有リンクが使えない設定（`Code.gs` の `IMAGE_LINK_SHARING = false`）のときは `Apps.imageBlobUrl(APP, id)` → `Promise<blob URL>`（スプシ経由で取得、端末に控える）
- 縮小だけしたいとき：`Apps.resizeImage(file, { maxSide, quality, maxBytes })` → `Promise<Blob>`

## 接続

| 関数 | 説明 |
|---|---|
| `Apps.ensureConnected(app)` | 未接続なら接続画面（QR／写真から読み取り／リンク貼り付け）を出す → `Promise<conn>` |
| `Apps.openConnectSheet(app)` | 接続の確認・他の端末の追加（QR表示）・つなぎ直し・解除の画面（設定ボタンから呼ぶ） |
| `Apps.isConnected(app)` / `Apps.getConnection(app)` | 状態の確認。`conn = { url, key, name }` |
| `Apps.on('connection', fn)` | 接続が変わったとき |

仕組み：
- スプシのメニュー「アプリ設定」→「この端末をつなぐ」が `https://cotoxdgn.github.io/connect/#c=<base64url JSON {u,k,n,a?}>` のリンクとQRを出す
- `apps.js` は**どのページで読み込まれても** URL の `#c=…` を読んで保存し、URL から消す（`/diary/#c=…` でも有効）
- 保存先は localStorage `apps.conn.v1` = `{ def: 全アプリ共通, per: { wanko: 専用 } }`。`a`（対象アプリ）付きのリンクは `per[a]` に入る。`getConnection(app)` は `per[app]` → `def` の順
- iPhone・iPad のホーム画面アプリは Safari と保存場所が別なので、アプリ内の［QRでつなぐ］（カメラ＋jsQR）でつなぐ

## 通信の生（ふだんは不要）

```js
Apps.call(app, action, params) // → Promise<レスポンス>（ok:false は Error(code) で reject）
```

`POST`・`Content-Type: text/plain` で JSON を送ります（単純リクエストなので CORS の事前確認が起きない。copipe と同じ方式）。
共通項目：`{ key, action, app }` → `{ ok, now, … }` / `{ ok: false, error }`

| action | 送るもの | 返るもの |
|---|---|---|
| `ping` | — | `apps`（シートのあるアプリ名） |
| `list` | `since?`（前回の `now`） | `records`。since なし＝削除済みを除く全件、あり＝それ以降に変わったもの（削除含む、境界は重複あり） |
| `put` | `id?`, `data`, `createdAt?` | `record` |
| `delete` | `id` | `record`（`deleted: true`） |
| `batch` | `ops: [{ op: 'put'|'delete', app?, id, data?, createdAt? }]`（200件まで） | `results: [{ ok, record | error }]` |
| `image` | `mime`, `base64`, `name?` | `image: { id, url, thumb, name, bytes }` |
| `imageData` | `id` | `mime`, `base64` |
| `imageDelete` | `id` | — |

## エラー

`Apps.on('error', function (d) { … })` — `d = { error, during: 'flush'|'sync', app?, id? }`
`Apps.errorText(error)` で日本語の説明になります。主なコード：
`not_connected` `bad_key` `no_setup` `offline` `network` `timeout` `busy` `too_long` `too_large` `bad_id` `server`

- `offline` `network` `timeout` `busy` `bad_key`：送信待ちは残り、次の機会に再送
- `too_long` `bad_id` など内容の問題：その1件は送信待ちから外れ、error で通知

## その他

`Apps.toast(msg, isError)` / `Apps.uuid()` / `Apps.isIOS()` / `Apps.isStandalone()` / `Apps.loadScript(src)`

共通CSS（`apps.css`）：色の変数 `--ax-*`（ライト・ダーク両対応）、`.ax-btn` `.ax-btn-primary` `.ax-btn-danger` `.ax-btn-ghost` `.ax-input` `.ax-row` `.ax-note`。

## テスト

```
node test/gas.test.js      # Code.gs（モック）
node test/shared.test.js   # apps.js ↔ Code.gs の通し
```
