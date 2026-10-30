# e2e：iPhone 幅（390px）で 追加→完了→実働入力 を確認。API は mock-server.js（本物の TaskApi.gs をモックのスプシで実行）
# 実行：python3 -I task/test/e2e.py   （リポジトリのルートで）
import base64, json, os, subprocess, sys, time, urllib.request
from playwright.sync_api import sync_playwright

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
OUT = sys.argv[1] if len(sys.argv) > 1 else '/tmp/task-e2e.png'
WEB, API = 8811, 8765
env = dict(os.environ, TZ='Asia/Tokyo')
web = subprocess.Popen([sys.executable, '-m', 'http.server', str(WEB), '--bind', '127.0.0.1'], cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
api = subprocess.Popen(['node', os.path.join(ROOT, 'task/test/mock-server.js'), str(API), 'actual'], env=env, stdout=subprocess.PIPE, text=True)
key = api.stdout.readline().strip().split('=', 1)[1]
time.sleep(0.8)
EXEC = 'https://script.google.com/macros/s/TEST/exec'
payload = base64.urlsafe_b64encode(json.dumps({'u': EXEC, 'k': key, 'n': '_タスク管理2026.09.15~'}).encode()).decode().rstrip('=')
sheet = lambda: json.loads(urllib.request.urlopen(f'http://127.0.0.1:{API}/__sheet').read())
ok = 0
def check(name, cond):
    global ok
    if not cond: raise AssertionError(name)
    ok += 1; print('ok -', name)

def forward(route):
    req = urllib.request.Request(f'http://127.0.0.1:{API}/', data=route.request.post_data.encode(), method='POST')
    route.fulfill(status=200, content_type='application/json', body=urllib.request.urlopen(req).read().decode())

try:
    with sync_playwright() as p:
        b = p.chromium.launch()
        ctx = b.new_context(viewport={'width': 390, 'height': 844}, device_scale_factor=2, is_mobile=True, has_touch=True, locale='ja-JP', timezone_id='Asia/Tokyo')
        ctx.route('https://script.google.com/**', forward)
        pg = ctx.new_page()
        errs = []
        pg.on('pageerror', lambda e: errs.append(str(e)))

        pg.goto(f'http://127.0.0.1:{WEB}/task/')
        check('未接続なら接続画面', pg.locator('#connect').is_visible() and not pg.locator('#app').is_visible())

        pg.goto(f'http://127.0.0.1:{WEB}/task/#t={payload}')
        pg.wait_for_selector('#todayList .task')
        check('接続後 #t= が URL から消える', '#t=' not in pg.url)
        check('接続設定は task.conn.v1 に保存（共通の apps.conn.v1 には入れない）',
              pg.evaluate("!!localStorage.getItem('task.conn.v1') && !localStorage.getItem('apps.conn.v1')"))
        check('持ち越し1件', pg.locator('#carry .task').count() == 1)
        check('今日の未完了1件', pg.locator('#todayList .task').count() == 1)
        check('今日完了1件', pg.locator('#doneList .task').count() == 1)

        # 追加
        pg.fill('#aTodo', '表紙を作る')
        pg.click('#moreBtn')
        pg.fill('#aPj', '例）案件B')
        pg.fill('#aParent', 'プレゼン構成')
        pg.fill('#aKo', '1')
        pg.click('#aSlot button[data-v="昼"]')
        check('ToDo のプレビュー', 'プレゼン構成 | 表紙を作る' in pg.inner_text('#preview'))
        pg.click('#addBtn')
        pg.wait_for_selector('#toast:has-text("シートに追加しました")')
        s = sheet()
        check('シート4行目に追加（No/PJ/ToDo/工/⏰）', s[3][0] == 13 and s[3][2] == '例）案件B' and s[3][3] == 'プレゼン構成 | 表紙を作る' and s[3][4] == 1 and s[3][7] == '☀️')
        check('元の4行目以下は1行下がっただけ', s[5][3] == '見積書の確認 | 設備項目' and s[6][3] == 'プレゼン構成 | 目次を作る')
        check('画面の今日に出る', pg.locator('#todayList .task', has_text='表紙を作る').count() == 1)
        check('入力欄は空に戻る', pg.input_value('#aTodo') == '')

        # 完了＋実働
        pg.locator('#todayList .task', has_text='表紙を作る').locator('.cb').click()
        check('完了シートが開く', pg.locator('#sheet').is_visible())
        check('実働の初期値は工', pg.inner_text('#shAct') == '1h')
        pg.click('#steps button[data-d="0.25"]')
        check('差 +0.25', pg.inner_text('#shDiff') == '+0.25')
        pg.screenshot(path=OUT.replace('.png', '-sheet.png'))
        pg.click('#shDone')
        pg.wait_for_selector('#toast:has-text("完了にしました")')
        s = sheet()
        check('完了列 TRUE・実働列 1.25', s[3][1] is True and s[3][-1] == 1.25)
        check('今日完了に移る', pg.locator('#doneList .task', has_text='表紙を作る').count() == 1)

        # タイマー
        pg.locator('#carry .task .cb').click()
        pg.click('#tToggle')
        pg.wait_for_timeout(2200)
        check('タイマーが進む', pg.inner_text('#shTimer') != '00:00:00')
        pg.click('#shLater')
        check('計測中の印', pg.locator('#carry .task', has_text='計測中').count() == 1)

        # 完了を外す
        pg.locator('#doneList .task', has_text='表紙を作る').locator('.cb').click()
        pg.wait_for_selector('#toast:has-text("完了を外しました")')
        check('完了を外すとシートも FALSE', sheet()[3][1] is False)

        check('横スクロールなし', pg.evaluate('document.documentElement.scrollWidth <= innerWidth'))
        check('JS エラーなし', not errs)
        pg.wait_for_timeout(2600)
        pg.screenshot(path=OUT, full_page=True)
        b.close()
    print(f'\n{ok} passed')
finally:
    web.terminate(); api.terminate()
