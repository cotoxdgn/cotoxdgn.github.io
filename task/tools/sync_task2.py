#!/usr/bin/env python3
"""task/ を直したら、task2/（別の表につなぐ2つ目のタスクアプリ）へ同じ直しを写す。
実行：python3 -I task/tools/sync_task2.py   （リポジトリのルートで）
・端末に保存する名前を task.* → task2.* に分ける（task と混ざらない）
・アプリ名はつないだ表の名前を表示（公開コードには表の名前を書かない）
・iPad・パソコンの広い画面では幅を少し広げる
・オフラインの控えの名前は task2-v<task と同じ番号>
"""
import os, re, sys, shutil
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
SRC, DST = os.path.join(ROOT, 'task'), os.path.join(ROOT, 'task2')

def rd(p): return open(os.path.join(SRC, p), encoding='utf-8').read()
def wr(p, s): open(os.path.join(DST, p), 'w', encoding='utf-8').write(s)
def must(s, old, new, label):
    if old not in s: sys.exit('写せませんでした（' + label + '）：task 側の形が変わっています。sync_task2.py を直してください')
    return s.replace(old, new, 1)

os.makedirs(os.path.join(DST, 'icons'), exist_ok=True)
# app.js
s = rd('app.js')
s = re.sub(r"'task\.", "'task2.", s)
s = s.replace('別のキー task.conn.v1', '別のキー task2.conn.v1')
s = must(s, "  function conn() { return lsGet(CONN_KEY); }\n",
  "  function conn() { return lsGet(CONN_KEY); }\n"
  "  // 【task2】つないだスプシの表示名（スクリプト側で設定した名前）を、画面の上とタブの名前に出す。公開するコードには名前を書かない\n"
  "  function applyName() { var c = conn(); var n = (c && c.name) ? String(c.name) : ''; document.title = n || 'タスク2'; var b = $('appName'); if (b) { b.textContent = n; b.hidden = !n; } }\n", 'applyName')
s = must(s, "  function start() {\n", "  function start() {\n    applyName();\n", 'start')
wr('app.js', s)
# kumitate.js はそのまま
shutil.copyfile(os.path.join(SRC, 'kumitate.js'), os.path.join(DST, 'kumitate.js'))
# index.html
s = rd('index.html')
s = must(s, '<meta name="apple-mobile-web-app-title" content="タスク">', '<meta name="apple-mobile-web-app-title" content="タスク2">', 'title meta')
s = must(s, '<title>タスク</title>', '<title>タスク2</title>', 'title')
s = must(s, '    <div>\n      <h1 id="title">今日</h1>', '    <div>\n      <span class="appname" id="appName" hidden></span>\n      <h1 id="title">今日</h1>', 'appName')
s = s.replace('https://cotoxdgn.github.io/task/#t=', 'https://cotoxdgn.github.io/task2/#t=')
wr('index.html', s)
# style.css
s = rd('style.css') + "\n/* 【task2】アプリ名の小さな表示と、iPad・パソコンの広い画面では少し広げる */\n.appname { display: block; font-size: 12px; color: var(--muted, #6b7280); letter-spacing: .02em; }\n@media (min-width: 900px) { main, .sheet { max-width: 760px; } }\n"
wr('style.css', s)
# sw.js
s = rd('sw.js')
m = re.search(r"var CACHE = 'task-v(\d+)'", s)
if not m: sys.exit('写せませんでした（sw.js の CACHE）')
s = s.replace(m.group(0), "var CACHE = 'task2-v" + m.group(1) + "'")
wr('sw.js', s)
# manifest
s = rd('manifest.webmanifest')
s = must(s, '"name": "タスク表スマホ版"', '"name": "タスク2"', 'manifest name')
s = must(s, '"short_name": "タスク"', '"short_name": "タスク2"', 'manifest short')
s = must(s, '"id": "/task/"', '"id": "/task2/"', 'manifest id')
wr('manifest.webmanifest', s)
print('task2 を task と同じ内容にそろえました（キャッシュ task2-v' + m.group(1) + '）')
