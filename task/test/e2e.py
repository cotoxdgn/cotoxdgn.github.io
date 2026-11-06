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
recur = lambda: json.loads(urllib.request.urlopen(f'http://127.0.0.1:{API}/__recur').read())
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
        nr = [r for r in s if r and r[0] == 13]
        check('シートに追加（No/PJ/ToDo/工/⏰）', len(nr) == 1 and nr[0][2] == '例）案件B' and nr[0][3] == 'プレゼン構成 | 表紙を作る' and nr[0][4] == 1 and nr[0][7] == '☀️')
        check('既存の行は残っている', any(r and r[3] == '見積書の確認 | 設備項目' for r in s) and any(r and r[3] == 'プレゼン構成 | 目次を作る' for r in s))
        check('画面の今日に出る', pg.locator('#todayList .task', has_text='表紙を作る').count() == 1)
        check('入力欄は空に戻る', pg.input_value('#aTodo') == '')

        # 完了＋実働
        pg.locator('#todayList .task', has_text='表紙を作る').locator('.cb').click()
        check('完了シートが開く', pg.locator('#sheet').is_visible())
        check('実働の初期値は工', pg.inner_text('#shAct') == '1h')
        pg.click('#steps button[data-d="0.1"]')
        check('差 +0.1', pg.inner_text('#shDiff') == '+0.1')
        pg.screenshot(path=OUT.replace('.png', '-sheet.png'))
        pg.click('#shDone')
        pg.wait_for_selector('#toast:has-text("完了にしました")')
        s = sheet()
        nr = [r for r in s if r and r[0] == 13]
        check('完了列 TRUE・実働列 1.1', len(nr) == 1 and nr[0][1] is True and nr[0][-1] == 1.1)
        check('今日完了に移る', pg.locator('#doneList .task', has_text='表紙を作る').count() == 1)

        # タイマー
        pg.locator('#carry .task .cb').click()
        if '停止' not in pg.inner_text('#tToggle'): pg.click('#tToggle')   # 開いた時に自動で始まっていなければ始める
        pg.wait_for_timeout(2200)
        check('タイマーが進む', pg.inner_text('#shTimer') != '00:00:00')
        pg.click('#shLater')
        check('計測中の印', pg.locator('#carry .task', has_text='計測中').count() == 1)

        # 完了を外す
        pg.locator('#doneList .task', has_text='表紙を作る').locator('.cb').click()
        pg.wait_for_selector('#toast:has-text("完了を外しました")')
        check('完了を外すとシートも FALSE', sheet()[3][1] is False)

        lk = pg.locator('.task.locked', has_text='目次を作る')
        check('待ちのタスクは薄いグレー（locked）', lk.count() == 1)
        check('👤だけの待ちはロックしない', pg.locator('.task.locked').count() == 1)
        check('前提が未完了なら「前提…待ち」の印', lk.locator('.chip.wait', has_text='前提').count() == 1)
        check('待ちのタスクは今日の一番下', pg.locator('#todayList .task').last.inner_text().find('目次を作る') >= 0)
        lk.locator('.cb').click(force=True)
        check('待ちのタスクは完了シートが開かない', not pg.locator('#sheet').is_visible())
        check('👤が空でない未完了に「待ち」の印', pg.locator('.task .chip.wait', has_text='山田さん 待ち').count() >= 1)
        # 待ちの設定（チェック以外を押す）
        pg.locator('#carry .task', has_text='見積書の確認').locator('.body').click()
        check('チェック以外を押すと待ちの設定が開く', pg.locator('#wsheet').is_visible() and not pg.locator('#sheet').is_visible())
        check('👤の候補に今までの名前', pg.locator('#wsPeople button', has_text='山田さん').count() == 1)
        check('📅・⏰も表示（今の値）', pg.input_value('#wsDate') != '' and pg.locator('#wsSlot button.on').count() == 1)
        pg.locator('#wsSlot button', has_text='夕').click()
        pg.fill('#wsWho', '佐藤さん')
        pg.fill('#wsPreQ', '目次')
        check('前提の候補は検索で絞れる・自分は出ない', pg.locator('#wsPreList button').count() == 1)
        pg.locator('#wsPreList button').first.click()
        pg.screenshot(path=OUT.replace('.png', '-wait.png'))
        pg.click('#wsSave')
        pg.wait_for_selector('#toast:has-text("保存しました")')
        row = [r for r in sheet() if r[3] == '見積書の確認 | 設備項目'][0]
        check('シートの👤・前提・⏰に書かれる', row[8] == '佐藤さん' and str(row[9]).startswith('11.') and row[7] == '🌙')
        pg.wait_for_selector('#carry .task.locked')
        check('前提が未完了になったのでロック表示', pg.locator('#carry .task.locked', has_text='見積書の確認').count() == 1)
        check('明日の欄が出る（見出しに件数）', pg.locator('#tmrBox').is_visible() and '件' in pg.inner_text('#tmrLbl'))
        pg.click('#tmrLbl')
        check('明日の欄を開ける', pg.locator('#tmrDet').get_attribute('open') is not None)
        # 削除：2回確かめてから消える。やめるで戻る
        n0 = len([r for r in sheet() if r and r[0] == 13])
        pg.locator('.task', has_text='表紙を作る').first.locator('.body').click()
        pg.wait_for_selector('#wsheet:not([hidden])')
        pg.click('#wsDel')
        check('削除1回目の確認', 'シートから削除しますか' in pg.inner_text('#wsDelAsk'))
        pg.locator('#wsDelAsk button', has_text='やめる').click()
        check('やめるで戻る', pg.locator('#wsDel').is_visible() and n0 == 1)
        pg.click('#wsDel')
        pg.locator('#wsDelAsk button', has_text='削除する').click()
        check('削除2回目の確認（ほんとに大丈夫？！）', 'ほんとに大丈夫' in pg.inner_text('#wsDelAsk'))
        check('2回目の前はまだ消えていない', len([r for r in sheet() if r and r[0] == 13]) == 1)
        pg.locator('#wsDelAsk button', has_text='ほんとに削除する').click()
        pg.wait_for_selector('#toast:has-text("削除しました")')
        check('シートからその行が消える', len([r for r in sheet() if r and r[0] == 13]) == 0)
        check('画面からも消える', pg.locator('.task', has_text='表紙を作る').count() == 0)

        # 定期タスク：🔁 → 一覧（例の行は止めた所）→ 追加（毎日・今日の分もすぐ）→ 止める → 直す
        pg.click('#recurBtn')
        pg.wait_for_selector('#rsOff .rule')
        check('止めている例の行は下に薄く出る', pg.locator('#rsOff .rule.off', has_text='タスクを整理する').count() == 1 and pg.locator('#rsList .rule').count() == 0)
        pg.screenshot(path=OUT.replace('.png', '-recur.png'))
        pg.click('#rsNew')
        pg.fill('#rTodo', '日報を書く')
        pg.fill('#rPj', '例）案件C')
        pg.click('#rType button[data-t="毎週"]')
        check('毎週で曜日が出る', pg.locator('#rWdBox').is_visible() and not pg.locator('#rMdBox').is_visible())
        check('曜日を選ぶ前は「今日の分」が出ない', not pg.locator('#rTodayBox').is_visible())
        pg.click('#rType button[data-t="毎日"]')
        pg.click('#rSlot button[data-s="夕"]')
        check('毎日なら今日の分のチェックが出る（初期は入）', pg.locator('#rTodayBox').is_visible() and pg.is_checked('#rToday'))
        pg.screenshot(path=OUT.replace('.png', '-recur-form.png'), full_page=False)
        pg.click('#rSave')
        pg.wait_for_selector('#toast:has-text("今日の分もタスクに入れました")')
        rr = recur()
        check('表の3行目に書く（有効・毎日・🌙）', rr[2][:6] == [True, '例）案件C', '日報を書く', 0.5, '🌙', '毎日'])
        check('今日のタスクにも1件入る', len([r for r in sheet() if r and r[3] == '日報を書く']) == 1)
        check('一覧に戻って出る', pg.locator('#rsList .rule', has_text='日報を書く').count() == 1)
        pg.locator('#rsList .rule', has_text='日報を書く').locator('.sw').click()
        pg.wait_for_selector('#toast:has-text("止めました")')
        check('止めると表の有効が外れ、下に移る', recur()[2][0] is False and pg.locator('#rsOff .rule', has_text='日報を書く').count() == 1)
        pg.locator('#rsOff .rule', has_text='日報を書く').locator('.body').click()
        check('直す画面：止めているので今日の分は出ない', pg.locator('#rsForm').is_visible() and not pg.locator('#rTodayBox').is_visible() and pg.locator('#rEditNote').is_visible())
        pg.fill('#rKo', '0.25')
        pg.click('#rSave')
        pg.wait_for_selector('#toast:has-text("保存しました")')
        check('直した値が表に入る（行は増えない）', recur()[2][3] == 0.25 and len([r for r in recur() if len(r) > 2 and r[2] == '日報を書く']) == 1)
        check('今日のタスクは増えない', len([r for r in sheet() if r and r[3] == '日報を書く']) == 1)
        check('定期タスク画面も横スクロールなし', pg.evaluate('document.documentElement.scrollWidth <= innerWidth'))
        pg.click('#rsClose')
        pg.wait_for_selector('#todayList .task:has-text("日報を書く")')
        check('閉じると今日に日報が出ている', True)
        check('横スクロールなし', pg.evaluate('document.documentElement.scrollWidth <= innerWidth'))
        check('JS エラーなし', not errs)
        pg.wait_for_timeout(2600)
        pg.screenshot(path=OUT, full_page=True)
        b.close()
    print(f'\n{ok} passed')
finally:
    web.terminate(); api.terminate()
