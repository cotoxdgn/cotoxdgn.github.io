/* 空間ひきだし帖：実績で使った商品・納まり、法規、おすすめを毎日1枚書いて身につけ、週1でHPとストーリーに公開する
 * レコード（自分用スプシの app=hikidashi）
 *   ストック：id st-xxxx  { kind:'stock', type, name（使ったもの・題）, from（元）, memo, workId, workName, src:'desk'|'archmap'|'csv', srcId, group（TheRの区分・CSVから）, cardId（カードにしたら）, at }
 *             CSVから入れたものは id st-csv-<名前のハッシュ>
 *   カード  ：id cd-xxxx  { kind:'card', no, type, date（公開予定日）, stockId, from, to, phrase（60字）, checked（商品・納まり）,
 *                           article・checkedOn（法規。必須）, link（おすすめ：公式・出典。https）, noteUrl, illust・photo:{ id, thumb }|null,
 *                           fromWork（実務の案件から）, workPub（フジイの案件の通称）, status:'draft'|'done', doneOn, publishAt（公開予約した日）, at }
 *   工夫点  ：id wn-<実績id> { kind:'worknote', workId, workName, point（200字・非公開） }
 *   週      ：id wk-YYYYMMDD（月曜） { kind:'week', start, steps:[読み直す, 公開予約, 画像書き出し] }
 *   賞      ：id aw-xxxx  { kind:'award', name, url, date, memo }
 *   設定    ：id conf     { kind:'conf', publicName, handle, worksFrom, alertFrom }
 * HP（archifriends.net）は GAS の hikiPublic で「公開日を過ぎた完成カードの公開項目」と賞だけを読む（ストック・工夫点・案件名は外へ出ない）
 * 脳みそ（app=brain）は読むだけ：実績（t:'w'）を一括入力の案件の選択元に、アーキマップから残したメモ（createdIn:'archmap'）をストックの候補に
 * お客様名・住所・原価の欄は作らない。
 */
(function () {
  'use strict';
  var APP = 'hikidashi';
  var S = window.HikiStory, IL = window.HikiIllust, K = S.KINDS, ORDER = S.ORDER;
  var PLAN = { 1: 'item', 2: 'detail', 3: 'item', 4: 'law', 5: 'detail', 6: 'rec', 0: 'law' };   // 曜日のおすすめ（日=0）
  var GOALS = { item: 20, detail: 20, law: 12, rec: 10 };
  var BADGE = { item: '仕様の引き出し', detail: '納まりの引き出し', law: '法規の引き出し', rec: 'おすすめの引き出し' };
  var EXP = { card: 20, week: 50, streak7: 30 }, PER_LEVEL = 100;
  var DEF = { publicName: 'coto', handle: '', worksFrom: '2027-04-01', alertFrom: '2027-04-01' };
  var WD = ['日', '月', '火', '水', '木', '金', '土'];

  var db = Apps.collection(APP);
  var brain = Apps.collection('brain');   // 読むだけ（実績・アーキマップから残したメモ）
  var $ = function (id) { return document.getElementById(id); };
  var st = { stocks: [], cards: [], notes: {}, weeks: {}, awards: [], conf: Object.assign({}, DEF), view: 'today', filter: 'all', wk: '', desk: { work: null, rows: [] } };
  var ed = null;      // 書く画面で編集中のカード
  var crop = null;    // イラストを整える途中

  // ---------- 日付（端末の日付・0時区切り） ----------
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function ymd(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function parse(s) { var p = String(s).split('-'); return new Date(+p[0], +p[1] - 1, +p[2]); }
  function add(s, n) { var d = parse(s); d.setDate(d.getDate() + n); return ymd(d); }
  function today() { return ymd(new Date()); }
  function md(s) { var d = parse(s); return (d.getMonth() + 1) + '/' + d.getDate(); }
  function mdw(s) { var d = parse(s); return (d.getMonth() + 1) + '月' + d.getDate() + '日（' + WD[d.getDay()] + '）'; }
  function nextMonday(s) { var d = parse(s), k = (8 - d.getDay()) % 7 || 7; return add(s, k); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function newId(p) { return p + Apps.uuid().replace(/[^a-z0-9]/gi, '').slice(0, 12); }
  function isUrl(v) { return /^https:\/\/[^\s"'<>]+$/.test(String(v || '')); }

  // ---------- 読み出し ----------
  function load(list) {
    var stocks = [], cards = [], notes = {}, weeks = {}, awards = [], conf = Object.assign({}, DEF);
    list.forEach(function (r) {
      var d = r.data || {};
      if (d.kind === 'stock') stocks.push(Object.assign({ id: r.id }, d));
      else if (d.kind === 'card') cards.push(Object.assign({ id: r.id }, d));
      else if (d.kind === 'worknote' && d.workId) notes[d.workId] = Object.assign({ id: r.id }, d);
      else if (d.kind === 'week' && d.start) weeks[d.start] = Object.assign({ id: r.id }, d);
      else if (d.kind === 'award') awards.push(Object.assign({ id: r.id }, d));
      else if (d.kind === 'conf' && r.id === 'conf') Object.keys(DEF).forEach(function (k) { if (d[k]) conf[k] = d[k]; });
    });
    cards.sort(function (a, b) { return (a.date || '') < (b.date || '') ? 1 : (a.date || '') > (b.date || '') ? -1 : (b.no || 0) - (a.no || 0); });
    st.stocks = stocks; st.cards = cards; st.notes = notes; st.weeks = weeks; st.awards = awards; st.conf = conf;
  }
  function done(c) { return c.status === 'done'; }
  function stateOf(c) {
    if (!done(c)) return { t: '下書き', c: 'var(--muted)' };
    if (!c.publishAt) return { t: '完成', c: 'var(--item-ink)' };
    return c.publishAt > today() ? { t: '予約中 ' + md(c.publishAt), c: 'var(--detail-ink)' } : { t: '公開済み', c: 'var(--law-ink)' };
  }
  function freeStocks(type) { return st.stocks.filter(function (s) { return !s.cardId && (!type || s.type === type); }); }

  // ---------- EXP・レベル・連続日数 ----------
  function score() {
    var days = {}, exp = 0;
    st.cards.forEach(function (c) { if (done(c)) { exp += EXP.card; if (c.doneOn) days[c.doneOn] = 1; } });
    Object.keys(st.weeks).forEach(function (k) { var w = st.weeks[k]; if (w.steps && w.steps.every(Boolean)) exp += EXP.week; });
    var ds = Object.keys(days).sort(), run = 0, prev = '';
    ds.forEach(function (d) { run = prev && add(prev, 1) === d ? run + 1 : 1; if (run % 7 === 0) exp += EXP.streak7; prev = d; });
    var t = today(), s = 0, d = days[t] ? t : add(t, -1);
    while (days[d]) { s++; d = add(d, -1); }
    return { exp: exp, level: Math.floor(exp / PER_LEVEL) + 1, into: exp % PER_LEVEL, streak: s };
  }

  // ---------- 賞の締切（過ぎたら翌年の同じ日に仮で繰り越す。GAS の hikiPublic と同じ決め方） ----------
  function awardNext(a) {
    var d = a.date, t = today(), tent = !!a.tentative;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(d || ''))) return null;
    while (d < t) { d = (+d.slice(0, 4) + 1) + d.slice(4); tent = true; }
    return { date: d, tentative: tent };
  }

  // ---------- ① 今日 ----------
  function renderToday() {
    var t = today(), sc = score();
    $('tDate').textContent = mdw(t);
    $('tLv').textContent = 'Lv.' + sc.level;
    $('tStreak').textContent = sc.streak + '日連続';
    $('tBar').style.width = sc.into + '%';
    $('tNext').textContent = '次のレベルまで ' + (PER_LEVEL - sc.into) + ' EXP（合計 ' + sc.exp + '）';
    var k = PLAN[parse(t).getDay()];
    $('tRec').className = 'row k-' + k;
    $('tRec').innerHTML = '<div class="rec-kind">' + K[k].label + '</div><div><div class="small muted">' + WD[parse(t).getDay()] + '曜のおすすめ</div><b>' + K[k].label + 'のカード（ほかを選んでもOK）</b></div>';
    // 来週分のストック（来週の月〜日、7枚で1週間）
    var mon = nextMonday(t), n = 0, html = '';
    for (var i = 0; i < 7; i++) {
      var ds = add(mon, i), dk = PLAN[parse(ds).getDay()];
      var c = st.cards.filter(function (x) { return x.date === ds; });
      var dn = c.filter(done)[0], dr = c[0];
      if (dn) n++;
      var kk = dn ? dn.type : dr ? dr.type : dk;
      html += '<div class="k-' + kk + '"><div class="d">' + WD[parse(ds).getDay()] + '</div><button type="button" class="s' + (dn ? ' on' : dr ? ' dr' : '') + '" data-day="' + ds + '" aria-label="' + mdw(ds) + (dn ? '（書けた）' : dr ? '（下書き）' : '（まだ）') + '">' + (dn ? '済' : dr ? '下' : '') + '</button><div class="kn">' + K[kk].label + '</div></div>';
    }
    $('tWeek').innerHTML = html;
    $('tWeekN').textContent = n + ' / 7 たまった';
    $('tStock').innerHTML = ORDER.map(function (k2) { return '<div class="k-' + k2 + '"><span class="small">' + K[k2].label + '</span><b>' + freeStocks(k2).length + '</b></div>'; }).join('');
    // 賞の要確認（締切の1か月前。設定の日から出す）
    var al = '';
    if (t >= st.conf.alertFrom) {
      st.awards.forEach(function (a) {
        var nx = awardNext(a);
        if (nx && nx.date <= add(t, 30)) al += '<div class="alert">要確認：' + esc(a.name) + ' の締切 ' + mdw(nx.date) + (nx.tentative ? '（去年の日付から仮）' : '') + (isUrl(a.url) ? ' <a href="' + esc(a.url) + '" target="_blank" rel="noopener">公式ページ</a>' : '') + '</div>';
      });
    }
    // 要確認がないときも、次の締切を1行だけ出す（一覧は 帖 › 設定）
    if (!al && st.awards.length && t >= st.conf.alertFrom) {
      var nxt = st.awards.map(function (a) { return { a: a, n: awardNext(a) }; }).filter(function (x) { return x.n; })
        .sort(function (x, y) { return x.n.date < y.n.date ? -1 : 1; })[0];
      if (nxt) al = '<div class="small muted" id="tNextAward">次の賞の締切：' + esc(nxt.a.name) + ' ' + mdw(nxt.n.date) + (nxt.n.tentative ? '（去年の日付から仮）' : '') + '　<a class="link" href="#settings">全' + st.awards.length + '件を見る</a></div>';
    }
    $('tAlerts').innerHTML = al;
  }
  $('tWeek').addEventListener('click', function (e) {
    var b = e.target.closest('[data-day]'); if (!b) return;
    var ds = b.getAttribute('data-day'), c = st.cards.filter(function (x) { return x.date === ds; })[0];
    openWrite(c ? c.id : null, ds);
  });
  $('tWrite').addEventListener('click', function (e) { e.preventDefault(); openWrite(null, null); });

  // ---------- ② 書く ----------
  function firstEmptyDay() {
    var mon = nextMonday(today());
    for (var i = 0; i < 7; i++) { var ds = add(mon, i); if (!st.cards.some(function (c) { return c.date === ds; })) return ds; }
    return add(today(), 1);
  }
  function openWrite(id, day) {
    var c = id ? st.cards.filter(function (x) { return x.id === id; })[0] : null;
    if (c) ed = JSON.parse(JSON.stringify(c));
    else {
      var d = day || firstEmptyDay();
      ed = { id: null, type: PLAN[parse(d).getDay()], date: d, stockId: '', from: '', to: '', phrase: '', checked: false, article: '', checkedOn: '', link: '', noteUrl: '', workPub: '', fromWork: false, illust: null, photo: null, status: 'draft' };
    }
    ed.dirty = false;
    if (location.hash === '#write') fillWrite(); else location.hash = '#write';
  }
  function checks() {
    var len = (ed.phrase || '').length, k = ed.type, third;
    if (k === 'law') third = { ok: !!(ed.article || '').trim() && /^\d{4}-\d{2}-\d{2}$/.test(ed.checkedOn || ''), label: '根拠の条文番号と最終確認日' };
    else if (k === 'rec') third = { ok: isUrl(ed.link), label: '公式ページか出典のURL' };
    else third = { ok: !!ed.checked, label: K[k].check.replace('済み', 'した') };
    return [{ ok: !!(ed.from || '').trim() && !!(ed.to || '').trim(), label: K[k].from.replace(/（.*）/, '') + 'と' + K[k].to.replace(/（.*）/, '') + 'が書けた' },
      { ok: len > 0 && len <= 60, label: '一言が60字以内' }, third];
  }
  var blobs = {};   // イラストの表示用（ドライブから取り寄せた blob URL）
  function illustSrc(img) {
    if (!img) return '';
    if (img.local) return img.local;
    if (blobs[img.id]) return blobs[img.id];
    Apps.imageBlobUrl(APP, img).then(function (u) { blobs[img.id] = u; if (st.view === 'write') renderMini(); }, function () {});
    return img.thumb || '';
  }
  function renderMini() {
    var k = K[ed.type], src = illustSrc(ed.illust);
    $('wMini').className = 'mini k-' + ed.type;
    $('wMini').innerHTML = '<div class="t">' + esc(S.TITLE) + ' ' + (ed.no ? S.no3(ed.no) : '#—') + '</div><div class="p' + (ed.illust ? ' has-il' : '') + '">' +
      (ed.illust ? '<div class="il"><img alt="" src="' + esc(src) + '"></div>' : '') +
      '<div class="small" style="font-size:7px;color:#6B645B">' + esc(k.lead) + '</div><div class="q">' + esc(ed.from || '（元）') + '</div>' +
      '<div class="a">' + (k.suffix ? '→ ' : '') + esc(ed.to || '（代案）') + esc(k.suffix) + '</div><div class="b">' + esc(ed.phrase) + '</div></div>' +
      '<div class="c">' + (ed.type === 'rec' ? 'カレンダーは' : 'くわしくは') + 'プロフィールのHPから</div>';
  }
  function renderWriteState() {
    var cs = checks(), n = cs.filter(function (x) { return x.ok; }).length;
    $('wScore').textContent = '完成度 ' + n + '/3';
    $('wChecks').innerHTML = cs.map(function (x) { return '<div class="' + (x.ok ? 'ok' : '') + '">' + (x.ok ? '✓ ' : '・ ') + esc(x.label) + '</div>'; }).join('');
    $('wCount').textContent = (ed.phrase || '').length;
    var isDone = done(ed);
    $('wDone').disabled = n < 3;
    $('wDone').textContent = n < 3 ? 'あと ' + (3 - n) + ' つで完成' : isDone ? '保存する' : '完成させる（+' + EXP.card + ' EXP）';
    $('wSave').hidden = isDone;
    renderMini();
  }
  function fillWrite() {
    if (!ed) openWrite(null, null);
    var k = K[ed.type];
    $('wBadge').className = 'pill k-' + ed.type; $('wBadge').style.background = 'var(--k)'; $('wBadge').style.color = '#fff';
    $('wBadge').textContent = k.label + 'カード' + (ed.id ? '（' + stateOf(ed).t + '）' : '');
    $('wKinds').innerHTML = ORDER.map(function (t) { return '<button type="button" class="k-' + t + '" data-k="' + t + '" aria-pressed="' + (ed.type === t) + '">' + K[t].label + '</button>'; }).join('');
    $('wNo').textContent = ed.no ? 'シリーズ番号 ' + S.no3(ed.no) : '番号は完成させたときに付きます';
    $('wDate').value = ed.date || '';
    var opts = freeStocks(ed.type);
    if (ed.stockId) { var cur = st.stocks.filter(function (s) { return s.id === ed.stockId; })[0]; if (cur && opts.indexOf(cur) < 0) opts.unshift(cur); }
    $('wStock').innerHTML = '<option value="">（ストックから選ばない）</option>' + opts.map(function (s) {
      return '<option value="' + esc(s.id) + '"' + (s.id === ed.stockId ? ' selected' : '') + '>' + esc(s.name) + (s.workName ? '｜' + esc(s.workName) : s.src === 'archmap' ? '｜アーキマップ' : '') + '</option>';
    }).join('');
    $('wFromL').textContent = k.from; $('wToL').textContent = k.to;
    $('wFrom').value = ed.from || ''; $('wTo').value = ed.to || ''; $('wPhrase').value = ed.phrase || '';
    $('wCheckF').hidden = !k.check; $('wCheck').checked = !!ed.checked; $('wCheckL').textContent = k.check;
    $('wLawF').hidden = ed.type !== 'law'; $('wArticle').value = ed.article || ''; $('wChecked').value = ed.checkedOn || '';
    $('wLinkF').hidden = ed.type !== 'rec'; $('wLink').value = ed.link || '';
    $('wNote').value = ed.noteUrl || '';
    $('wPubF').hidden = !ed.fromWork; $('wPub').value = ed.workPub || '';
    $('wIll').innerHTML = ed.illust ? '<img alt="イラスト" src="' + esc(illustSrc(ed.illust)) + '">' : 'イラスト<br>ノートを撮る';
    $('wPh').innerHTML = ed.photo ? '<img alt="写真" src="' + esc(ed.photo.local || Apps.imageUrl(ed.photo, 400)) + '">' : '写真<br>（HP用）';
    $('wIllX').hidden = !ed.illust; $('wPhX').hidden = !ed.photo;
    $('wDel').hidden = !ed.id;
    renderWriteState();
  }
  $('wKinds').addEventListener('click', function (e) {
    var b = e.target.closest('[data-k]'); if (!b) return;
    if (ed.stockId) { var s = st.stocks.filter(function (x) { return x.id === ed.stockId; })[0]; if (s && s.type !== b.getAttribute('data-k')) ed.stockId = ''; }
    ed.type = b.getAttribute('data-k'); ed.dirty = true; fillWrite();
  });
  $('wStock').addEventListener('change', function () {
    var s = st.stocks.filter(function (x) { return x.id === $('wStock').value; })[0];
    ed.stockId = s ? s.id : ''; ed.dirty = true;
    if (s) { ed.to = s.name || ed.to; ed.from = s.from || ed.from; ed.fromWork = !!s.workId; if (!ed.phrase && s.memo) ed.phrase = String(s.memo).slice(0, 60); }
    else ed.fromWork = false;
    fillWrite();
  });
  [['wFrom', 'from'], ['wTo', 'to'], ['wPhrase', 'phrase'], ['wArticle', 'article'], ['wChecked', 'checkedOn'], ['wLink', 'link'], ['wNote', 'noteUrl'], ['wPub', 'workPub'], ['wDate', 'date']].forEach(function (p) {
    $(p[0]).addEventListener('input', function () { ed[p[1]] = $(p[0]).value; ed.dirty = true; renderWriteState(); });
  });
  $('wCheck').addEventListener('change', function () { ed.checked = $('wCheck').checked; ed.dirty = true; renderWriteState(); });
  function record(c) {
    var d = { kind: 'card' };
    ['no', 'type', 'date', 'stockId', 'from', 'to', 'phrase', 'checked', 'article', 'checkedOn', 'link', 'noteUrl', 'fromWork', 'workPub', 'status', 'doneOn', 'publishAt'].forEach(function (k) { d[k] = c[k] == null ? '' : c[k]; });
    d.checked = !!c.checked; d.fromWork = !!c.fromWork; d.no = typeof c.no === 'number' ? c.no : null;
    d.phrase = String(c.phrase || '').slice(0, 60);
    d.illust = c.illust && c.illust.id ? { id: c.illust.id, thumb: c.illust.thumb || '' } : null;
    d.photo = c.photo && c.photo.id ? { id: c.photo.id, thumb: c.photo.thumb || '' } : null;
    d.at = c.at || new Date().toISOString();
    return d;
  }
  function saveCard(finish) {
    if (ed.uploading) { Apps.toast('写真を保存中です。終わってからもう一度押してください', true); return; }
    if (!ed.date) { Apps.toast('「いつの分か」を入れてください', true); return; }
    var first = finish && !done(ed);
    if (finish) {
      ed.status = 'done';
      if (typeof ed.no !== 'number') ed.no = st.cards.reduce(function (m, c) { return Math.max(m, typeof c.no === 'number' ? c.no : 0); }, 0) + 1;
      if (!ed.doneOn) ed.doneOn = today();
      if (ed.publishAt) ed.publishAt = ed.date;   // 予約済みのカードは、日付を変えたら予約日も合わせる
    }
    var id = ed.id || newId('cd-'), prev = ed.id ? st.cards.filter(function (c) { return c.id === ed.id; })[0] : null;
    db.put(record(ed), id);
    // ストック：使ったものに印、外したものは戻す
    if (prev && prev.stockId && prev.stockId !== ed.stockId) releaseStock(prev.stockId);
    if (ed.stockId) { var s = st.stocks.filter(function (x) { return x.id === ed.stockId; })[0]; if (s && s.cardId !== id) db.put(Object.assign(stockRec(s), { cardId: id }), s.id); }
    ed.id = id; ed.dirty = false;
    Apps.toast(first ? 'カード完成！ +' + EXP.card + ' EXP（' + S.no3(ed.no) + '）' : finish ? '保存しました' : '下書きで保存しました');
    location.hash = first ? '#today' : '#cho';
  }
  function stockRec(s) { var d = {}; Object.keys(s).forEach(function (k) { if (k !== 'id') d[k] = s[k]; }); return d; }
  function releaseStock(sid) { var s = st.stocks.filter(function (x) { return x.id === sid; })[0]; if (s) db.put(Object.assign(stockRec(s), { cardId: '' }), s.id); }
  $('wDone').addEventListener('click', function () { saveCard(true); });
  // noteへ：カードの文をコピーして、noteのネタ帳（claude.ai のページ）を開く。記事を書いたら「noteの記事」欄にURLを貼る
  var NOTE_URL = 'https://claude.ai/artifact/99p3EizFftnBMoFMRDH5Uj';
  $('wNeta').addEventListener('click', function () {
    var k = K[ed.type];
    if (!(ed.from || '').trim() && !(ed.to || '').trim()) { Apps.toast('先に' + k.from.replace(/（.*）/, '') + 'と' + k.to.replace(/（.*）/, '') + 'を書いてください', true); return; }
    var t = (ed.from || '') + ' → ' + (ed.to || '') + (k.suffix || '') + (ed.phrase ? '：' + ed.phrase : '') + '（空間ひきだし帖' + (ed.no ? ' ' + S.no3(ed.no) : '') + 'から）';
    try { navigator.clipboard.writeText(t).then(function () { Apps.toast('文をコピーしました。ネタ帳に貼ってください'); }, function () { Apps.toast('コピーできませんでした', true); }); } catch (e) { Apps.toast('コピーできませんでした', true); }
    window.open(NOTE_URL, '_blank', 'noopener');
  });
  $('wSave').addEventListener('click', function () { saveCard(false); });
  $('wDel').addEventListener('click', function () {
    if (!ed.id || !confirm('このカードを消しますか？' + (ed.publishAt && ed.publishAt <= today() ? '\nHPからも消えます。' : ''))) return;
    db.remove(ed.id);
    if (ed.stockId) releaseStock(ed.stockId);
    ed = null; Apps.toast('消しました'); location.hash = '#cho';
  });
  // HP用の写真（そのまま縮小して保存）
  $('wPh').addEventListener('click', function () { $('wPhFile').click(); });
  $('wPhFile').addEventListener('change', function () {
    var f = this.files && this.files[0]; this.value = ''; if (!f) return;
    uploadTo('photo', f, URL.createObjectURL(f));
  });
  $('wPhX').addEventListener('click', function () { ed.photo = null; ed.dirty = true; fillWrite(); });
  $('wIllX').addEventListener('click', function () { ed.illust = null; ed.dirty = true; fillWrite(); });
  function uploadTo(field, blob, local) {
    var target = ed;
    target.uploading = true;
    target[field] = { local: local };
    fillWrite();
    $('wDone').textContent = '写真を保存中…';
    Apps.uploadImage(APP, blob, { maxSide: 1600, name: APP + '-' + field + '.jpg' }).then(function (img) {
      target[field] = { id: img.id, thumb: img.thumb || '', local: local };
      if (field === 'illust') blobs[img.id] = local;
      target.uploading = false; target.dirty = true;
      if (ed === target && st.view === 'write') fillWrite();
    }, function (e) {
      target[field] = null; target.uploading = false;
      Apps.toast('写真を保存できませんでした：' + Apps.errorText(e), true);
      if (ed === target && st.view === 'write') fillWrite();
    });
  }

  // ---------- イラストを整える ----------
  $('wIll').addEventListener('click', function () { $('wIllFile').click(); });
  $('wIllFile').addEventListener('change', function () {
    var f = this.files && this.files[0]; this.value = ''; if (!f) return;
    Apps.resizeImage(f, { maxSide: 1600, quality: 0.92, maxBytes: 4000000 }).then(function (b) {
      var u = URL.createObjectURL(b), img = new Image();
      img.onload = function () { startCrop(img); URL.revokeObjectURL(u); };
      img.onerror = function () { Apps.toast('写真を読み込めませんでした', true); };
      img.src = u;
    }, function () { Apps.toast('写真を読み込めませんでした', true); });
  });
  function startCrop(img) {
    var cv = document.createElement('canvas'); cv.width = img.width; cv.height = img.height;
    cv.getContext('2d').drawImage(img, 0, 0);
    var orig = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height);
    crop = { orig: orig, w: cv.width, h: cv.height, strength: 50 };
    applyWhite(true);
    location.hash = '#crop';
  }
  function applyWhite(auto) {
    var data = new ImageData(new Uint8ClampedArray(crop.orig.data), crop.w, crop.h);
    IL.whiten(data.data, crop.strength);
    crop.img = data;
    if (auto) {
      var b = IL.autoBox(data.data, crop.w, crop.h);
      $('cT').value = Math.round(b.y / crop.h * 100); $('cB').value = Math.round((crop.h - b.y - b.h) / crop.h * 100);
      $('cL').value = Math.round(b.x / crop.w * 100); $('cR').value = Math.round((crop.w - b.x - b.w) / crop.w * 100);
    }
    drawCrop();
  }
  function box() {
    var t = +$('cT').value, b = +$('cB').value, l = +$('cL').value, r = +$('cR').value;
    if (t + b > 95) b = 95 - t; if (l + r > 95) r = 95 - l;
    var x = Math.round(crop.w * l / 100), y = Math.round(crop.h * t / 100);
    return { x: x, y: y, w: Math.max(10, Math.round(crop.w * (100 - l - r) / 100)), h: Math.max(10, Math.round(crop.h * (100 - t - b) / 100)) };
  }
  function drawCrop() {
    var b = box(), cv = $('cCanvas');
    cv.width = b.w; cv.height = b.h;
    cv.getContext('2d').putImageData(crop.img, -b.x, -b.y);
  }
  ['cT', 'cB', 'cL', 'cR'].forEach(function (id) { $(id).addEventListener('input', function () { if (crop) drawCrop(); }); });
  $('cW').addEventListener('change', function () { if (crop) { crop.strength = +$('cW').value; applyWhite(false); } });
  $('cCancel').addEventListener('click', function () { crop = null; location.hash = '#write'; });
  $('cOk').addEventListener('click', function () {
    $('cCanvas').toBlob(function (b) {
      crop = null;
      if (!b) { Apps.toast('イラストを作れませんでした', true); return; }
      location.hash = '#write';
      uploadTo('illust', b, URL.createObjectURL(b));
    }, 'image/jpeg', 0.92);
  });

  // ---------- ③ 公開（週1） ----------
  function weekCards(mon) {
    var out = [];
    for (var i = 0; i < 7; i++) { var ds = add(mon, i); out.push({ day: ds, cards: st.cards.filter(function (c) { return c.date === ds; }) }); }
    return out;
  }
  function weekRec(mon) { return st.weeks[mon] || { start: mon, steps: [false, false, false] }; }
  function setStep(mon, i, on) {
    var w = weekRec(mon), s = (w.steps || [false, false, false]).slice(); s[i] = on;
    var wasAll = (w.steps || []).every(Boolean) && (w.steps || []).length === 3;
    db.put({ kind: 'week', start: mon, steps: s }, 'wk-' + mon.replace(/-/g, ''));
    if (!wasAll && s.every(Boolean)) Apps.toast('週ボーナス達成！ +' + EXP.week + ' EXP');
  }
  function renderWeek() {
    if (!st.wk) st.wk = nextMonday(today());
    var mon = st.wk, w = weekRec(mon), steps = w.steps || [false, false, false], n = steps.filter(Boolean).length;
    $('kRange').textContent = mdw(mon) + '〜' + mdw(add(mon, 6)) + 'の分';
    $('kSteps').textContent = n + '/3';
    $('kBonus').textContent = n === 3 ? '達成！ +' + EXP.week + ' EXP' : '3つ終えると +' + EXP.week + ' EXP';
    var wc = weekCards(mon);
    $('kCards').innerHTML = wc.map(function (x) {
      var c = x.cards.filter(done)[0] || x.cards[0], label = WD[parse(x.day).getDay()] + ' ' + md(x.day);
      if (!c) return '<button type="button" class="wrow empty" data-new="' + x.day + '"><span class="d">' + label + '</span><span class="tt">まだありません（押して書く）</span></button>';
      var s = stateOf(c), more = x.cards.length > 1 ? '<span class="small muted">ほか' + (x.cards.length - 1) + '枚</span>' : '';
      return '<button type="button" class="wrow k-' + c.type + '" data-card="' + esc(c.id) + '"><span class="d">' + label + '</span><span class="pill tagk">' + K[c.type].label + '</span><span class="tt">' + esc(c.from) + ' → ' + esc(c.to) + '</span>' + more + '<span class="small" style="color:' + s.c + '">' + esc(s.t) + '</span></button>';
    }).join('');
    var ready = wc.filter(function (x) { return x.cards.some(done); }).length;
    var STEPS = [['1. 7枚を読み直す', '誤字と品番・条文を最終確認。押すと済みになります'],
      ['2. HPに公開予約', '完成したカード（' + ready + '枚）に、曜日ごとの公開日を付けます。その日になるとHPに自動で出ます'],
      ['3. ストーリー画像を書き出す', '1080×1920の画像を' + ready + '枚。写真に保存 → インスタ（Meta Business Suite）で日付を指定して予約']];
    $('kStepList').innerHTML = STEPS.map(function (s, i) { return '<button type="button" class="step' + (steps[i] ? ' on' : '') + '" data-step="' + i + '"><b>' + (steps[i] ? '✓ ' : '') + s[0] + '</b><span>' + s[1] + '</span></button>'; }).join('');
  }
  $('kPrev').addEventListener('click', function () { st.wk = add(st.wk, -7); renderWeek(); });
  $('kNext').addEventListener('click', function () { st.wk = add(st.wk, 7); renderWeek(); });
  $('kCards').addEventListener('click', function (e) {
    var b = e.target.closest('[data-card],[data-new]'); if (!b) return;
    if (b.dataset.card) openWrite(b.dataset.card); else openWrite(null, b.dataset.new);
  });
  $('kStepList').addEventListener('click', function (e) {
    var b = e.target.closest('[data-step]'); if (!b) return;
    var i = +b.dataset.step, mon = st.wk, steps = weekRec(mon).steps || [];
    if (i === 0) { setStep(mon, 0, !steps[0]); return; }
    var cs = [];
    weekCards(mon).forEach(function (x) { x.cards.filter(done).forEach(function (c) { cs.push(c); }); });
    if (!cs.length) { Apps.toast('この週の完成したカードがまだありません', true); return; }
    if (i === 1) reserve(mon, cs); else exportStories(mon, cs);
  });
  function reserve(mon, cs) {
    var drafts = 0;
    weekCards(mon).forEach(function (x) { drafts += x.cards.filter(function (c) { return !done(c); }).length; });
    cs.forEach(function (c) { if (c.publishAt !== c.date) db.put(Object.assign(record(c), { publishAt: c.date }), c.id); });
    setStep(mon, 1, true);
    $('kMsg').textContent = cs.length + '枚を公開予約しました（' + md(cs[0].date) + 'から1日ずつHPに出ます）' + (drafts ? '。下書きの' + drafts + '枚は完成させてからもう一度押してください' : '');
  }
  function loadImg(src) { return new Promise(function (ok, ng) { var i = new Image(); i.onload = function () { ok(i); }; i.onerror = ng; i.src = src; }); }
  function exportStories(mon, cs) {
    $('kMsg').textContent = '画像を作っています…';
    var fonts = document.fonts && document.fonts.load ? Promise.all(['700 40px "Zen Maru Gothic"', '700 40px "Noto Sans JP"', '400 40px "Noto Sans JP"'].map(function (f) { return document.fonts.load(f, 'あ'); })).catch(function () {}) : Promise.resolve();
    cs.sort(function (a, b) { return a.date < b.date ? -1 : 1; });
    fonts.then(function () {
      return Promise.all(cs.map(function (c) {
        var ill = c.illust && c.illust.id ? (blobs[c.illust.id] ? Promise.resolve(blobs[c.illust.id]) : Apps.imageBlobUrl(APP, c.illust).then(function (u) { blobs[c.illust.id] = u; return u; })).then(loadImg).catch(function () { return null; }) : Promise.resolve(null);
        return ill.then(function (img) {
          var cv = S.draw(document.createElement('canvas'), c, { name: st.conf.publicName, handle: st.conf.handle, illust: img });
          return new Promise(function (ok) { cv.toBlob(function (b) { ok(new File([b], 'hikidashi-' + S.no3(c.no).slice(1) + '-' + c.date + '.png', { type: 'image/png' })); }, 'image/png'); });
        });
      }));
    }).then(function (files) {
      var share = navigator.canShare && navigator.canShare({ files: files });
      var finish = function () { setStep(mon, 2, true); $('kMsg').textContent = files.length + '枚の画像を書き出しました。インスタで日付を指定して予約してください'; };
      if (share) return navigator.share({ files: files }).then(finish, function (e) { if (e && e.name === 'AbortError') $('kMsg').textContent = '書き出しをやめました'; else throw e; });
      files.forEach(function (f) { var a = document.createElement('a'); a.href = URL.createObjectURL(f); a.download = f.name; document.body.appendChild(a); a.click(); a.remove(); });
      finish();
    }).catch(function () { $('kMsg').textContent = '画像を作れませんでした。もう一度押してください'; });
  }

  // ---------- ④ 帖 ----------
  function renderCho() {
    var all = st.cards, doneN = all.filter(done).length;
    $('zN').textContent = '集めたカード ' + doneN + '枚';
    var bars = ORDER.map(function (k) {
      var n = all.filter(function (c) { return done(c) && c.type === k; }).length, g = GOALS[k];
      return '<div class="kb k-' + k + '"><div class="between small"><b style="color:var(--ki)">' + K[k].label + '</b><span class="muted">' + n + ' / ' + g + '</span></div><div class="bar"><i style="width:' + Math.min(100, Math.round(n / g * 100)) + '%"></i></div></div>';
    }).join('');
    var badges = ORDER.map(function (k) {
      var n = all.filter(function (c) { return done(c) && c.type === k; }).length;
      return '<span class="badge' + (n >= GOALS[k] ? ' got' : '') + '">' + (n >= GOALS[k] ? '★ ' : '') + BADGE[k] + '</span>';
    }).join('');
    var next = ORDER.map(function (k) { return { k: k, left: GOALS[k] - all.filter(function (c) { return done(c) && c.type === k; }).length }; }).filter(function (x) { return x.left > 0; }).sort(function (a, b) { return a.left - b.left; })[0];
    $('zBars').innerHTML = bars + '<div class="badges">' + badges + '</div>' + (next ? '<div class="small muted">次のバッジ：' + K[next.k].label + 'カードあと' + next.left + '枚で「' + BADGE[next.k] + '」</div>' : '<div class="small muted">バッジを全部そろえました</div>');
    $('zFilters').innerHTML = ['all'].concat(ORDER).map(function (k) { return '<button type="button" class="' + (k === 'all' ? '' : 'k-' + k) + '" data-f="' + k + '" aria-pressed="' + (st.filter === k) + '">' + (k === 'all' ? 'すべて' : K[k].label) + '</button>'; }).join('');
    var list = all.filter(function (c) { return st.filter === 'all' || c.type === st.filter; });
    $('zCards').innerHTML = list.length ? list.map(function (c) {
      var s = stateOf(c);
      return '<button type="button" class="cd k-' + c.type + '" data-card="' + esc(c.id) + '"><span class="between small"><b style="color:var(--ki)">' + K[c.type].label + '</b><span class="muted">' + (c.no ? S.no3(c.no) : '') + '</span></span><span class="tt">' + esc(c.to || c.from || '（まだ書いていません）') + '</span><span class="small muted">' + (c.date ? md(c.date) + 'の分' : '') + '</span><span class="st" style="color:' + s.c + '">' + esc(s.t) + '</span></button>';
    }).join('') : '<div class="small muted">まだカードがありません。「書く」から1枚目を書いてみてください。</div>';
  }
  $('zFilters').addEventListener('click', function (e) { var b = e.target.closest('[data-f]'); if (b) { st.filter = b.dataset.f; renderCho(); } });
  $('zCards').addEventListener('click', function (e) { var b = e.target.closest('[data-card]'); if (b) openWrite(b.dataset.card); });

  // ---------- ⑤ 案件完了時の一括入力 ----------
  function works() {
    return brain.all().filter(function (r) { return r.data && r.data.t === 'w' && r.data.name; })
      .sort(function (a, b) { return String(b.data.period || '').localeCompare(String(a.data.period || '')) || (a.data.name < b.data.name ? -1 : 1); });
  }
  function newRow() { return { type: 'item', name: '', from: '', memo: '' }; }
  function renderDesk() {
    var ws = works(), cur = st.desk.work;
    $('dWorks').innerHTML = ws.length ? ws.map(function (r) {
      var n = st.stocks.filter(function (s) { return s.workId === r.id; }).length;
      return '<button type="button" class="work" data-w="' + esc(r.id) + '" aria-pressed="' + (cur === r.id) + '"><b>' + esc(r.data.name) + '</b><small>' + (r.data.period ? '完成 ' + esc(r.data.period) + ' ／ ' : '') + (n ? 'ストック ' + n : '未入力') + '</small></button>';
    }).join('') : '<div class="small muted">脳みその実績ポートフォリオに案件がまだありません（または同期中）。</div>';
    var w = ws.filter(function (r) { return r.id === cur; })[0];
    $('dCur').textContent = w ? w.data.name : '案件を選んでください';
    if (!st.desk.rows.length) st.desk.rows = [newRow(), newRow(), newRow()];
    $('dRows').innerHTML = st.desk.rows.map(function (r, i) {
      return '<div class="drow" data-i="' + i + '"><select data-f="type" aria-label="種類">' + ORDER.map(function (k) { return '<option value="' + k + '"' + (r.type === k ? ' selected' : '') + '>' + K[k].label + '</option>'; }).join('') + '</select>' +
        '<input data-f="name" value="' + esc(r.name) + '" placeholder="使ったもの（商品名・品番・納まり）" aria-label="使ったもの" maxlength="120">' +
        '<input data-f="from" value="' + esc(r.from) + '" placeholder="これが嫌やったら（元）" aria-label="元" maxlength="120">' +
        '<input data-f="memo" value="' + esc(r.memo) + '" placeholder="メモ" aria-label="メモ" maxlength="200">' +
        '<button type="button" class="ax-btn ax-btn-ghost" data-x="' + i + '" aria-label="この行を消す" style="min-height:36px;padding:0">×</button></div>';
    }).join('');
    $('dPoint').value = w && st.notes[w.id] ? st.notes[w.id].point || '' : '';
    $('dPoint').disabled = !w;
    $('dCount').textContent = '+' + st.desk.rows.filter(function (r) { return r.name.trim(); }).length;
    // アーキマップから残したメモ（脳みそのカード。読むだけ）
    var used = {}; st.stocks.forEach(function (s) { if (s.src === 'archmap' && s.srcId) used[s.srcId] = 1; });
    var am = brain.all().filter(function (r) { return r.data && r.data.t === 'k' && r.data.createdIn === 'archmap' && !used[r.id]; });
    $('dArch').innerHTML = am.length ? am.map(function (r) {
      var src = r.data.source || {};
      return '<div class="cand"><span><b>' + esc(r.data.title || '') + '</b><br><small class="muted">' + esc(src.title || 'アーキマップ') + '</small></span><button type="button" class="ax-btn" data-am="' + esc(r.id) + '" style="min-height:36px">ストックへ</button></div>';
    }).join('') : '<div class="small muted">取り込める見学メモはありません（アーキマップの記録の「脳みそに残す」で作ったメモが出ます）。</div>';
  }
  $('dWorks').addEventListener('click', function (e) { var b = e.target.closest('[data-w]'); if (b) { st.desk.work = b.dataset.w; renderDesk(); } });
  $('dRows').addEventListener('input', function (e) {
    var row = e.target.closest('[data-i]'), f = e.target.getAttribute('data-f'); if (!row || !f) return;
    st.desk.rows[+row.dataset.i][f] = e.target.value;
    $('dCount').textContent = '+' + st.desk.rows.filter(function (r) { return r.name.trim(); }).length;
  });
  $('dRows').addEventListener('click', function (e) { var b = e.target.closest('[data-x]'); if (b) { st.desk.rows.splice(+b.dataset.x, 1); renderDesk(); } });
  $('dAdd').addEventListener('click', function () { st.desk.rows.push(newRow()); renderDesk(); });
  $('dPoint').addEventListener('change', function () {
    var w = works().filter(function (r) { return r.id === st.desk.work; })[0]; if (!w) return;
    db.put({ kind: 'worknote', workId: w.id, workName: w.data.name, point: $('dPoint').value.slice(0, 200) }, 'wn-' + w.id.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 60));
    $('dMsg').textContent = '工夫点を保存しました（非公開）';
  });
  $('dSave').addEventListener('click', function () {
    var w = works().filter(function (r) { return r.id === st.desk.work; })[0];
    var rows = st.desk.rows.filter(function (r) { return r.name.trim(); });
    if (!rows.length) { $('dMsg').textContent = '「使ったもの」を1つ以上書いてください'; return; }
    var at = new Date().toISOString();
    rows.forEach(function (r) {
      db.put({ kind: 'stock', type: r.type, name: r.name.trim(), from: r.from.trim(), memo: r.memo.trim(), workId: w ? w.id : '', workName: w ? w.data.name : '', src: 'desk', srcId: '', cardId: '', at: at }, newId('st-'));
    });
    st.desk.rows = [];
    $('dMsg').textContent = rows.length + 'ネタをストックに入れました' + (w ? '（' + w.data.name + '）' : '');
    renderDesk();
  });
  $('dArch').addEventListener('click', function (e) {
    var b = e.target.closest('[data-am]'); if (!b) return;
    var r = brain.get(b.dataset.am); if (!r) return;
    var d = r.data, src = d.source || {};
    db.put({ kind: 'stock', type: 'detail', name: String(d.title || '').slice(0, 120), from: '', memo: String(d.body || '').slice(0, 200) + (src.title ? '（見学：' + src.title + '）' : ''), workId: '', workName: '', src: 'archmap', srcId: r.id, cardId: '', at: new Date().toISOString() }, newId('st-'));
    Apps.toast('ストックに入れました（納まり）');
  });

  // ---------- 設定・賞 ----------
  var awEdit = null;
  function renderSettings() {
    $('sName').value = st.conf.publicName; $('sHandle').value = st.conf.handle;
    $('sWorks').value = st.conf.worksFrom; $('sAlert').value = st.conf.alertFrom;
    var list = st.awards.slice().sort(function (a, b) { var x = awardNext(a), y = awardNext(b); return (x ? x.date : '9') < (y ? y.date : '9') ? -1 : 1; });
    $('aN').textContent = list.length + '件';
    $('aList').innerHTML = list.length ? list.map(function (a) {
      var nx = awardNext(a);
      return '<div class="cand"><span><b>' + esc(a.name) + '</b><br><small class="muted">締切 ' + (nx ? mdw(nx.date) + (nx.tentative ? '（仮・要確認）' : '') : '未設定') + (a.memo ? ' ／ ' + esc(a.memo) : '') + '</small></span><button type="button" class="ax-btn" data-ae="' + esc(a.id) + '" style="min-height:36px">直す</button><button type="button" class="ax-btn ax-btn-ghost" data-ad="' + esc(a.id) + '" style="min-height:36px">消す</button></div>';
    }).join('') : '<div class="small muted">まだありません。</div>';
  }
  $('sSave').addEventListener('click', function () {
    var c = { kind: 'conf', publicName: $('sName').value.trim() || DEF.publicName, handle: $('sHandle').value.trim(), worksFrom: $('sWorks').value || DEF.worksFrom, alertFrom: $('sAlert').value || DEF.alertFrom };
    db.put(c, 'conf'); Apps.toast('保存しました');
  });
  $('sConn').addEventListener('click', function () { Apps.openConnectSheet(APP); });
  function resetAward() { awEdit = null; $('aName').value = ''; $('aDate').value = ''; $('aUrl').value = ''; $('aMemo').value = ''; $('aSave').textContent = '追加'; $('aCancel').hidden = true; }
  $('aList').addEventListener('click', function (e) {
    var b = e.target.closest('[data-ae],[data-ad]'); if (!b) return;
    var a = st.awards.filter(function (x) { return x.id === (b.dataset.ae || b.dataset.ad); })[0]; if (!a) return;
    if (b.dataset.ad) { if (confirm('「' + a.name + '」を締切の一覧から消しますか？（HPのカレンダーからも消えます）')) { db.remove(a.id); Apps.toast('消しました'); } return; }
    awEdit = a.id; $('aName').value = a.name || ''; $('aDate').value = (awardNext(a) || {}).date || a.date || ''; $('aUrl').value = a.url || ''; $('aMemo').value = a.memo || '';
    $('aSave').textContent = '保存'; $('aCancel').hidden = false; $('aName').focus();
  });
  $('aCancel').addEventListener('click', resetAward);
  $('aSave').addEventListener('click', function () {
    var name = $('aName').value.trim(), date = $('aDate').value, url = $('aUrl').value.trim();
    if (!name || !date) { Apps.toast('賞の名前と締切を入れてください', true); return; }
    if (url && !isUrl(url)) { Apps.toast('公式ページは https:// で始まるURLにしてください', true); return; }
    db.put({ kind: 'award', name: name, date: date, url: url, memo: $('aMemo').value.trim(), tentative: false }, awEdit || newId('aw-'));
    Apps.toast(awEdit ? '保存しました' : '追加しました'); resetAward();
  });

  // ---------- ストックのCSV取込（実績の仕様リストなど。列：kind,type,name,from,memo,src,group） ----------
  var csvRows = [];
  function parseCsv(text) {
    text = String(text || '').replace(/^﻿/, '');
    var rows = [], row = [], cell = '', q = false;
    for (var i = 0; i < text.length; i++) {
      var ch = text[i];
      if (q) {
        if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; }
        else cell += ch;
      } else if (ch === '"') q = true;
      else if (ch === ',') { row.push(cell); cell = ''; }
      else if (ch === '\n' || ch === '\r') {
        if (ch === '\r' && text[i + 1] === '\n') i++;
        row.push(cell); cell = ''; if (row.some(function (c) { return c !== ''; })) rows.push(row); row = [];
      } else cell += ch;
    }
    row.push(cell); if (row.some(function (c) { return c !== ''; })) rows.push(row);
    return rows;
  }
  function csvId(name) {   // 同じ名前は同じ id（2台で入れても重複しない）
    var h1 = 0x811c9dc5, h2 = 0x01000193;
    for (var i = 0; i < name.length; i++) { var c = name.charCodeAt(i); h1 = Math.imul(h1 ^ c, 16777619) >>> 0; h2 = Math.imul(h2 ^ c, 2246822519) >>> 0; }
    return 'st-csv-' + h1.toString(36) + h2.toString(36);
  }
  function csvRecords(rows) {
    if (!rows.length) return [];
    var head = rows[0].map(function (x) { return String(x).trim().toLowerCase(); });
    var ix = function (k) { return head.indexOf(k); };
    if (ix('name') < 0) return null;
    return rows.slice(1).map(function (r) {
      var g = function (k) { var i = ix(k); return i < 0 ? '' : String(r[i] == null ? '' : r[i]).trim(); };
      var type = K[g('type')] ? g('type') : 'item';
      return { kind: g('kind') || 'stock', type: type, name: g('name').slice(0, 120), from: g('from').slice(0, 120), memo: g('memo').slice(0, 200), group: g('group').slice(0, 80) };
    }).filter(function (x) { return x.kind === 'stock' && x.name; });
  }
  function findStockByName(name) { return st.stocks.filter(function (s) { return s.name === name; })[0] || null; }
  function renderCsv() {
    var n = csvRows.length, dup = csvRows.filter(function (r) { return findStockByName(r.name); }).length;
    $('cInfo').textContent = n ? ('読み込んだ ' + n + '件（新しく入る ' + (n - dup) + '件／同じ名前がすでにある ' + dup + '件）') : '';
    $('cDupBox').hidden = !dup;
    $('cGo').disabled = !n;
  }
  $('cFile').addEventListener('change', function () {
    var f = this.files && this.files[0]; csvRows = []; $('cMsg').textContent = '';
    if (!f) { renderCsv(); return; }
    var rd = new FileReader();
    rd.onload = function () {
      var recs = csvRecords(parseCsv(rd.result));
      if (recs === null) { $('cMsg').textContent = '1行目に name の列が見つかりません。取込用のCSVを選んでください'; csvRows = []; }
      else csvRows = recs;
      renderCsv();
    };
    rd.readAsText(f, 'utf-8');
  });
  $('cGo').addEventListener('click', function () {
    if (!csvRows.length) return;
    var over = $('cOver').checked, at = new Date().toISOString(), add = 0, upd = 0, skip = 0;
    var jobs = csvRows.slice();
    $('cGo').disabled = true; $('cMsg').textContent = '取り込み中…';
    (function next() {
      var r = jobs.shift();
      if (!r) {
        var msg = [];
        if (add) msg.push('ストックに ' + add + '件入れました');
        if (upd) msg.push(upd + '件を上書きしました');
        if (skip) msg.push(skip + '件は同じ名前があるので飛ばしました');
        $('cMsg').textContent = msg.join('・') || '入れるものはありませんでした';
        csvRows = []; $('cFile').value = ''; renderCsv(); Apps.toast('取り込みました'); return;
      }
      var old = findStockByName(r.name), p;
      if (old && !over) { skip++; return next(); }
      if (old) {
        upd++;
        p = db.put(Object.assign({}, old, { type: r.type, from: r.from, memo: r.memo, group: r.group, id: undefined }), old.id);
      } else {
        add++;
        p = db.put({ kind: 'stock', type: r.type, name: r.name, from: r.from, memo: r.memo, group: r.group, workId: '', workName: '', src: 'csv', srcId: '', cardId: '', at: at }, csvId(r.name));
      }
      Promise.resolve(p).then(next, next);
    })();
  });

  // ---------- 画面の切り替え ----------
  var VIEWS = ['today', 'write', 'crop', 'week', 'cho', 'desk', 'settings'];
  var TAB = { crop: 'write', desk: 'today', settings: 'cho' };
  function route() {
    var v = (location.hash || '').replace(/^#/, '');
    if (VIEWS.indexOf(v) < 0) v = 'today';
    if (v === 'crop' && !crop) v = 'write';
    st.view = v;
    VIEWS.forEach(function (k) { $('v-' + k).hidden = k !== v; });
    $('main').classList.toggle('wide', v === 'desk');
    Array.prototype.forEach.call(document.querySelectorAll('.tabbar a'), function (a) {
      if (a.dataset.v === (TAB[v] || v)) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    });
    renderView();
    window.scrollTo(0, 0);
  }
  function renderView() {
    var v = st.view;
    if (v === 'today') renderToday();
    else if (v === 'write') { if (!ed) openWrite(null, null); else fillWrite(); }
    else if (v === 'week') renderWeek();
    else if (v === 'cho') renderCho();
    else if (v === 'desk') renderDesk();
    else if (v === 'settings') renderSettings();
  }
  window.addEventListener('hashchange', route);
  db.onChange(function (list) {
    load(list);
    if (st.view === 'write' && ed && ed.dirty) return;   // 書きかけは上書きしない
    if (st.view === 'write' && ed && ed.id) { var c = st.cards.filter(function (x) { return x.id === ed.id; })[0]; if (c) ed = JSON.parse(JSON.stringify(c)); }
    if (st.view !== 'crop') renderView();
  });
  brain.onChange(function () { if (st.view === 'desk') renderDesk(); });
  Apps.on('error', function (d) { if (!d.app || d.app === APP) $('sync').textContent = Apps.errorText(d.error); });
  load(db.all());
  route();
  // 最初に入れておく賞（2026-11-05 台帳で確認。2026年の締切。過ぎた分は翌年の同じ日に仮で繰り越して出る）。
  // 固定の id なので、2台で同時に入れても重複しない。一度入れたら、消しても入れ直さない（印 aw-seeded）
  var AWARD_SEED = [
    ['aw-seed-kukan', '日本空間デザイン賞', '2026-05-14', 'https://kukan.design/27109/'],
    ['aw-seed-gmark', 'グッドデザイン賞', '2026-05-21', 'https://www.g-mark.org'],
    ['aw-seed-reform', '住まいのリフォームコンクール', '2026-06-17', 'https://www.chord.or.jp/reform_contest/'],
    ['aw-seed-jid', 'JID AWARD（日本インテリアデザイナー協会）', '2026-06-30', 'https://jid-award.com/html/detail-2026.html'],
    ['aw-seed-renov', 'リノベーション・オブ・ザ・イヤー', '2026-08-31', 'https://prtimes.jp/main/html/rd/p/000000105.000008586.html']
  ];
  function seedAwards() {
    if (db.get('aw-seeded')) return;
    AWARD_SEED.forEach(function (a) { if (!db.get(a[0])) db.put({ kind: 'award', name: a[1], date: a[2], url: a[3], memo: '', tentative: false }, a[0]); });
    db.put({ kind: 'seedmark', at: new Date().toISOString() }, 'aw-seeded');
  }
  Apps.ensureConnected(APP).then(function () { $('sync').textContent = ''; brain.sync().catch(function () {}); return db.sync(); }).then(seedAwards).catch(function () {});
  window.__hiki = { st: st, score: score, awardNext: awardNext };
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(function () {});
})();
