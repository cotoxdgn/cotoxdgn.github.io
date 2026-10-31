/* おしゃれ建築map（記録用）
 * 1件 = { name, lat?, lng?, architect, visited, list, photos:[{id,pub}], one, details:[{id,photo,x,y,part,spec,note,pub}], tags:[], isPublic }
 * 写真はドライブに置き、レコードには id だけを持つ。公開版には「公開データを書き出す」で作る public.json だけを渡す。 */
(function () {
  'use strict';
  var APP = 'archmap';
  var A = window.ArchMap;
  var db = Apps.collection(APP);
  var $ = function (id) { return document.getElementById(id); };
  var LAST_LIST_KEY = 'archmap.lastList';

  var state = { filter: 'all', cur: null, list: [] };
  var mainMap = null, pickMap = null;

  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* 使えなくても動く */ } }
  function today() {
    var d = new Date();
    return d.getFullYear() + '-' + A.pad2(d.getMonth() + 1) + '-' + A.pad2(d.getDate());
  }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  // 作成順の通し番号（01 = いちばん古い記録）
  function numbers(list) {
    var map = {};
    list.slice().sort(function (a, b) { return String(a.createdAt).localeCompare(String(b.createdAt)); })
      .forEach(function (r, i) { map[r.id] = i + 1; });
    return map;
  }

  // ---------- 一覧と地図 ----------
  function render(list) {
    state.list = list;
    var nums = numbers(list);
    var counts = { all: list.length };
    A.LISTS.forEach(function (x) { counts[x.k] = 0; });
    list.forEach(function (r) { if (counts[r.data.list] != null) counts[r.data.list]++; });

    $('meta').textContent = list.length + ' SPOTS · ' + list.filter(function (r) { return r.data.isPublic; }).length + ' 公開';

    var chips = $('chips');
    chips.innerHTML = '';
    [{ k: 'all', l: 'すべて' }].concat(A.LISTS).forEach(function (x) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'chip' + (state.filter === x.k ? ' on' : '');
      b.setAttribute('role', 'tab');
      b.setAttribute('aria-selected', state.filter === x.k ? 'true' : 'false');
      b.innerHTML = (x.k === 'all' ? '' : '<i class="dot ' + A.listClass(x.k) + '"></i>') + A.esc(x.l) + '<small>' + (counts[x.k] || 0) + '</small>';
      b.onclick = function () { state.filter = x.k; render(state.list); fitMain(); };
      chips.appendChild(b);
    });

    var items = list.filter(function (r) { return state.filter === 'all' || r.data.list === state.filter; });
    var ol = $('list');
    ol.innerHTML = '';
    items.forEach(function (r) {
      var d = r.data;
      var li = document.createElement('li');
      li.className = 'spot ' + A.listClass(d.list) + (r.id === state.cur ? ' on' : '');
      li.tabIndex = 0;
      li.dataset.id = r.id;
      var photo = (d.photos || [])[0];
      var sub = [d.architect, A.listLabel(d.list), d.visited ? d.visited.replace(/-/g, '.') : ''].filter(Boolean).join(' · ');
      li.innerHTML =
        '<span class="n' + (A.hasLoc(d) ? '' : ' none') + '">' + (A.hasLoc(d) ? A.pad2(nums[r.id]) : '場所なし') + '</span>' +
        '<div><h3><span>' + A.esc(d.name || '（名称未入力）') + '</span></h3><div class="sub">' + A.esc(sub) + '</div></div>' +
        '<div class="side">' +
          (photo ? '<img class="thumb" alt="" loading="lazy" src="' + A.esc(Apps.imageUrl(photo.id, 200)) + '">' : '') +
          (r.pending ? '<span class="badge wait">送信待ち</span>' : '<span class="badge' + (d.isPublic ? '' : ' off') + '">' + (d.isPublic ? '公開' : '非公開') + '</span>') +
        '</div>';
      li.onclick = function () { openEditor(r.id); };
      li.onkeydown = function (e) { if (e.key === 'Enter') openEditor(r.id); };
      ol.appendChild(li);
    });
    $('empty').hidden = list.length > 0;

    if (mainMap) {
      mainMap.setPins(items.filter(function (r) { return A.hasLoc(r.data); }).map(function (r) {
        return { lat: r.data.lat, lng: r.data.lng, label: A.pad2(nums[r.id]), on: r.id === state.cur, list: r.data.list,
          title: r.data.name || '', onClick: function () { focusSpot(r.id); } };
      }));
    }
  }
  function focusSpot(id) {
    state.cur = id;
    render(state.list);
    var li = document.querySelector('.spot[data-id="' + id + '"]');
    if (li) li.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }
  function fitMain() {
    if (!mainMap) return;
    var pts = state.list.filter(function (r) { return (state.filter === 'all' || r.data.list === state.filter) && A.hasLoc(r.data); })
      .map(function (r) { return [r.data.lat, r.data.lng]; });
    if (pts.length === 1) mainMap.setView(pts[0], 15);
    else if (pts.length > 1) mainMap.fitBounds(pts, 16);
  }

  // ---------- 1件の記録 ----------
  var draft = null, draftId = null, original = '', uploaded = [], removed = [];

  function openEditor(id) {
    var r = id ? db.get(id) : null;
    draftId = r ? r.id : null;
    draft = r ? clone(r.data) : {
      name: '', architect: '', visited: today(), list: lsGet(LAST_LIST_KEY) || 'public',
      photos: [], one: '', details: [], tags: [], isPublic: false
    };
    draft.photos = draft.photos || []; draft.details = draft.details || []; draft.tags = draft.tags || [];
    original = JSON.stringify(draft);
    uploaded = []; removed = [];
    $('edTitle').textContent = r ? '記録を編集' : '新しい記録';
    $('f-name').value = draft.name || '';
    $('f-arch').value = draft.architect || '';
    $('f-date').value = draft.visited || '';
    $('f-list').value = draft.list || 'public';
    $('f-one').value = draft.one || '';
    $('f-tags').value = (draft.tags || []).join(' ');
    $('f-pub').setAttribute('aria-pressed', draft.isPublic ? 'true' : 'false');
    $('f-latlng').value = '';
    $('manual').open = false;
    $('edDelete').hidden = !r;
    renderPhotos();
    renderLoc();
    $('editor').hidden = false;
    $('editor').scrollTop = 0;
    if (!pickMap) {
      pickMap = A.makeMap($('pickMap'));
      if (pickMap) pickMap.onClick(function (lat, lng) { setLoc(lat, lng, false); });
    }
    if (pickMap) {
      setTimeout(function () {
        pickMap.resize();
        if (A.hasLoc(draft)) pickMap.setView([draft.lat, draft.lng], 16);
        else if (mainMap) pickMap.setView(mainMap.getCenter(), mainMap.getZoom());
        renderLoc();
      }, 30);
    }
    if (!r) setTimeout(function () { $('f-name').focus(); }, 60);
  }
  function readForm() {
    draft.name = $('f-name').value.trim();
    draft.architect = $('f-arch').value.trim();
    draft.visited = $('f-date').value;
    draft.list = $('f-list').value;
    draft.one = $('f-one').value.trim();
    draft.tags = $('f-tags').value.split(/[\s、,，]+/).map(function (t) { return t.replace(/^#/, ''); }).filter(Boolean);
    draft.isPublic = $('f-pub').getAttribute('aria-pressed') === 'true';
  }
  function setLoc(lat, lng, pan) {
    draft.lat = Math.round(lat * 1e6) / 1e6;
    draft.lng = Math.round(lng * 1e6) / 1e6;
    renderLoc();
    if (pan && pickMap) pickMap.setView([draft.lat, draft.lng], 16);
  }
  function renderLoc() {
    $('locTxt').textContent = A.hasLoc(draft) ? draft.lat.toFixed(5) + ', ' + draft.lng.toFixed(5) : '未設定';
    if (!pickMap) return;
    if (A.hasLoc(draft)) {
      pickMap.setPick(draft.lat, draft.lng, function (lat, lng) { setLoc(lat, lng, false); });
    } else {
      pickMap.setPick(null);
    }
  }
  function useHere() {
    var btn = $('locBtn');
    if (!navigator.geolocation) { $('manual').open = true; Apps.toast('この端末では現在地を取れません。地図をタップするか手入力してください', true); return; }
    btn.disabled = true;
    btn.textContent = '取得中…';
    navigator.geolocation.getCurrentPosition(function (p) {
      btn.disabled = false; btn.textContent = '現在地を使う';
      setLoc(p.coords.latitude, p.coords.longitude, true);
    }, function (e) {
      btn.disabled = false; btn.textContent = '現在地を使う';
      $('manual').open = true;
      Apps.toast(e && e.code === 1 ? '位置情報が許可されていません。地図をタップするか手入力してください' : '現在地を取れませんでした。地図をタップするか手入力してください', true);
    }, { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 });
  }

  function renderPhotos() {
    var box = $('photos');
    box.innerHTML = '';
    draft.photos.forEach(function (p, i) {
      var d = document.createElement('div');
      d.className = 'ph';
      d.innerHTML = '<img alt="写真' + (i + 1) + '" loading="lazy" src="' + A.esc(Apps.imageUrl(p.id, 400)) + '">' +
        '<button type="button" class="pubbtn" aria-pressed="' + (p.pub ? 'true' : 'false') + '">' + (p.pub ? '公開中' : '公開') + '</button>' +
        '<button type="button" class="rm" aria-label="写真' + (i + 1) + 'を外す">×</button>';
      d.querySelector('.pubbtn').onclick = function () {
        var on = !p.pub;
        draft.photos.forEach(function (q) { q.pub = false; });
        p.pub = on;
        renderPhotos();
      };
      d.querySelector('.rm').onclick = function () {
        if (!window.confirm('この写真を記録から外しますか？（保存するとドライブからも消えます）')) return;
        draft.photos.splice(i, 1);
        draft.details.forEach(function (x) { if (x.photo === p.id) { x.photo = ''; } });
        removed.push(p.id);
        renderPhotos();
      };
      box.appendChild(d);
    });
    pendingUploads.forEach(function () {
      var b = document.createElement('div');
      b.className = 'ph busy';
      b.textContent = '保存中…';
      box.appendChild(b);
    });
    var add = document.createElement('button');
    add.type = 'button';
    add.className = 'ph add';
    add.textContent = '＋ 写真';
    add.onclick = function () { $('f-photo').click(); };
    box.appendChild(add);
  }
  var pendingUploads = [];
  function addPhotos(files) {
    if (!files.length) return;
    Apps.ensureConnected(APP).then(function () {
      Array.prototype.forEach.call(files, function (f) {
        var token = {};
        pendingUploads.push(token);
        renderPhotos();
        Apps.uploadImage(APP, f).then(function (img) {
          if (!draft) { Apps.deleteImage(APP, img.id).catch(function () {}); return; }
          draft.photos.push({ id: img.id, pub: false });
          uploaded.push(img.id);
        }, function (e) {
          Apps.toast('写真を保存できませんでした：' + Apps.errorText(e), true);
        }).then(function () {
          pendingUploads.splice(pendingUploads.indexOf(token), 1);
          if (draft) renderPhotos();
        });
      });
    });
  }

  function save() {
    readForm();
    if (pendingUploads.length) { Apps.toast('写真の保存が終わるまでお待ちください', true); return; }
    if (!draft.name && !draft.photos.length) { Apps.toast('名称か写真のどちらかを入れてください', true); $('f-name').focus(); return; }
    lsSet(LAST_LIST_KEY, draft.list);
    var data = draft, id = draftId, gone = removed.slice();
    db.put(data, id || undefined).then(function (r) {
      state.cur = r.id;
      gone.forEach(function (pid) { Apps.deleteImage(APP, pid).catch(function () {}); });
      Apps.toast(navigator.onLine === false ? '保存しました（つながったら送ります）' : '保存しました');
      fitMain();
    }, function (e) { Apps.toast(Apps.errorText(e), true); });
    closeEditor(true);
  }
  function closeEditor(saved) {
    if (!saved) {
      readForm();
      if (JSON.stringify(draft) !== original && !window.confirm('保存せずに閉じますか？')) return;
      // 保存しなかった新しい写真はドライブから消す
      uploaded.forEach(function (pid) { Apps.deleteImage(APP, pid).catch(function () {}); });
    }
    draft = null; draftId = null;
    $('editor').hidden = true;
    $('detail').hidden = true;
  }
  function removeRecord() {
    if (!draftId) return;
    if (!window.confirm('この記録を削除しますか？（写真もドライブのゴミ箱へ移します）')) return;
    var photos = (db.get(draftId) || { data: { photos: [] } }).data.photos || [];
    var ids = photos.map(function (p) { return p.id; }).concat(uploaded);
    db.remove(draftId).then(function () {
      ids.forEach(function (pid) { Apps.deleteImage(APP, pid).catch(function () {}); });
      Apps.toast('削除しました');
    });
    state.cur = null;
    draft = null; draftId = null;
    $('editor').hidden = true;
  }

  // ---------- ディテールのメモ ----------
  var dtPhoto = '';
  function openDetail() {
    readForm();
    if (!dtPhoto || !draft.photos.some(function (p) { return p.id === dtPhoto; })) dtPhoto = draft.photos.length ? draft.photos[0].id : '';
    $('detail').hidden = false;
    $('detail').scrollTop = 0;
    renderDetail();
  }
  function renderDetail() {
    var th = $('dtThumbs');
    th.innerHTML = '';
    th.hidden = draft.photos.length < 2;
    draft.photos.forEach(function (p, i) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = p.id === dtPhoto ? 'on' : '';
      b.setAttribute('aria-label', '写真' + (i + 1));
      b.innerHTML = '<img alt="" src="' + A.esc(Apps.imageUrl(p.id, 200)) + '">';
      b.onclick = function () { dtPhoto = p.id; renderDetail(); };
      th.appendChild(b);
    });

    var box = $('dtPhoto');
    box.innerHTML = '';
    if (dtPhoto) {
      var img = document.createElement('img');
      img.src = Apps.imageUrl(dtPhoto, 1200);
      img.alt = 'ディテールの写真（タップで番号を追加）';
      img.draggable = false;
      img.onclick = function (e) {
        var rect = img.getBoundingClientRect();
        addNote(dtPhoto, (e.clientX - rect.left) / rect.width * 100, (e.clientY - rect.top) / rect.height * 100);
      };
      box.appendChild(img);
      draft.details.forEach(function (x, i) {
        if (x.photo !== dtPhoto) return;
        var m = document.createElement('span');
        m.className = 'mk';
        m.style.left = x.x + '%';
        m.style.top = x.y + '%';
        m.textContent = i + 1;
        box.appendChild(m);
      });
    } else {
      box.innerHTML = '<p class="noph">写真がありません。記録の画面で写真を追加すると、写真に番号を打ってメモできます。「＋ 写真なし」でメモだけ書くこともできます。</p>';
    }

    var ol = $('notes');
    ol.innerHTML = '';
    if (!draft.details.length) {
      ol.innerHTML = '<li class="notes-empty">まだメモはありません。</li>';
      return;
    }
    draft.details.forEach(function (x, i) {
      var li = document.createElement('li');
      li.className = 'note';
      li.innerHTML =
        '<span class="mk' + (x.photo ? '' : ' plain') + '">' + (i + 1) + '</span>' +
        '<div>' +
          '<input class="ax-input" data-k="part" placeholder="部位（例：手摺）" aria-label="部位' + (i + 1) + '">' +
          '<input class="ax-input spec" data-k="spec" placeholder="寸法・素材（例：St φ34 / H=850）" aria-label="寸法・素材' + (i + 1) + '">' +
          '<textarea class="ax-input" data-k="note" rows="2" placeholder="気づいたこと" aria-label="気づいたこと' + (i + 1) + '"></textarea>' +
          '<div class="ops"><label><input type="checkbox" data-k="pub"> HPで公開</label>' +
          '<button type="button" class="ax-btn ax-btn-ghost small" data-act="del">削除</button></div>' +
        '</div>';
      li.querySelectorAll('[data-k]').forEach(function (el) {
        var k = el.dataset.k;
        if (k === 'pub') { el.checked = !!x.pub; el.onchange = function () { x.pub = el.checked; }; }
        else { el.value = x[k] || ''; el.oninput = function () { x[k] = el.value; }; }
      });
      li.querySelector('[data-act="del"]').onclick = function () {
        if ((x.part || x.spec || x.note) && !window.confirm((i + 1) + '番のメモを削除しますか？')) return;
        draft.details.splice(i, 1);
        renderDetail();
      };
      if (x.photo && x.photo !== dtPhoto) {
        li.querySelector('.mk').style.cursor = 'pointer';
      }
      ol.appendChild(li);
    });
  }
  function addNote(photo, x, y) {
    draft.details.push({ id: Apps.uuid().slice(0, 8), photo: photo || '', x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10, part: '', spec: '', note: '', pub: false });
    renderDetail();
    var inputs = $('notes').querySelectorAll('[data-k="part"]');
    var last = inputs[inputs.length - 1];
    if (last) { last.scrollIntoView({ block: 'center' }); last.focus({ preventScroll: true }); }
  }

  // ---------- 公開データ ----------
  function publicJson() {
    return JSON.stringify(A.buildPublic(db.all(), Apps.imageUrl), null, 2);
  }
  function openExport() {
    var data = A.buildPublic(db.all(), Apps.imageUrl);
    var noLoc = data.items.filter(function (x) { return x.lat == null; }).length;
    $('exSummary').textContent = '公開する記録：' + data.items.length + '件' + (noLoc ? '（うち場所なし ' + noLoc + '件は一覧だけに出ます）' : '');
    $('exText').value = JSON.stringify(data, null, 2);
    $('exportSheet').hidden = false;
  }
  function download() {
    var blob = new Blob([publicJson()], { type: 'application/json' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'public.json';
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }
  function copyJson() {
    var t = $('exText');
    var done = function () { Apps.toast('コピーしました'); };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(t.value).then(done, function () { t.select(); Apps.toast('選択しました。コピーしてください'); });
    } else { t.select(); Apps.toast('選択しました。コピーしてください'); }
  }

  // ---------- 起動 ----------
  var sel = $('f-list');
  A.LISTS.forEach(function (x) { var o = document.createElement('option'); o.value = x.k; o.textContent = x.l; sel.appendChild(o); });

  mainMap = A.makeMap($('map'));
  var firstFit = true;
  db.onChange(function (list) {
    render(list);
    if (firstFit && list.some(function (r) { return A.hasLoc(r.data); })) { firstFit = false; fitMain(); }
  });

  $('addBtn').onclick = function () { openEditor(null); };
  $('edClose').onclick = function () { closeEditor(false); };
  $('edSaveTop').onclick = save;
  $('edForm').addEventListener('submit', function (e) { e.preventDefault(); save(); });
  $('edDelete').onclick = removeRecord;
  $('f-pub').onclick = function () { var b = $('f-pub'); b.setAttribute('aria-pressed', b.getAttribute('aria-pressed') === 'true' ? 'false' : 'true'); };
  $('f-photo').addEventListener('change', function () { var fs = Array.prototype.slice.call(this.files || []); this.value = ''; addPhotos(fs); });
  $('locBtn').onclick = useHere;
  $('latlngBtn').onclick = function () {
    var text = $('f-latlng').value.trim();
    var p = A.parseLatLng(text);
    if (p) { setLoc(p.lat, p.lng, true); hideHits(); return; }
    if (!text) { Apps.toast('建物名・住所・緯度経度のどれかを入れてください', true); return; }
    searchPlace(text);
  };
  $('f-latlng').addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); $('latlngBtn').click(); } });
  // 建物名・住所から場所を探す（OpenStreetMap の検索。小さなお店は見つからないことがある）
  function hideHits() { $('geoHits').hidden = true; $('geoHits').innerHTML = ''; }
  function searchPlace(q) {
    if (!navigator.onLine) { Apps.toast('オフラインのため名前で探せません。地図をタップしてください', true); return; }
    var box = $('geoHits'); box.hidden = false; box.innerHTML = '<p class="geo-msg">探しています…</p>';
    var url = 'https://nominatim.openstreetmap.org/search?format=jsonv2&limit=5&accept-language=ja&countrycodes=jp&q=' + encodeURIComponent(q);
    fetch(url).then(function (r) { return r.json(); }).then(function (list) {
      box.innerHTML = '';
      if (!list || !list.length) {
        box.innerHTML = '<p class="geo-msg">「' + A.esc(q) + '」は見つかりませんでした。住所（例：京都市下京区…）で探すか、地図をタップしてください。</p>';
        return;
      }
      list.forEach(function (x) {
        var b = document.createElement('button');
        b.type = 'button'; b.className = 'geo-hit';
        var parts = String(x.display_name || '').split(',').map(function (t) { return t.trim(); });
        b.innerHTML = '<b>' + A.esc(x.name || parts[0] || q) + '</b><span>' + A.esc(parts.slice(1).reverse().filter(function (t) { return !/^\d{3}-?\d{4}$/.test(t) && t !== '日本'; }).join(' ')) + '</span>';
        b.onclick = function () {
          setLoc(parseFloat(x.lat), parseFloat(x.lon), true);
          if (!$('f-name').value.trim() && x.name) $('f-name').value = x.name;
          hideHits(); $('manual').open = false;
        };
        box.appendChild(b);
      });
    }, function () { box.innerHTML = '<p class="geo-msg">探せませんでした（通信を確認）。地図をタップしてください。</p>'; });
  }
  $('detBtn').onclick = openDetail;
  $('dtBack').onclick = function () { $('detail').hidden = true; };
  $('dtAddNoPhoto').onclick = function () { addNote('', 0, 0); };
  $('exportBtn').onclick = openExport;
  $('exClose').onclick = function () { $('exportSheet').hidden = true; };
  $('exDownload').onclick = download;
  $('exCopy').onclick = copyJson;
  $('settings').onclick = function () { Apps.openConnectSheet(APP); };
  Apps.on('error', function (d) { $('status').textContent = Apps.errorText(d.error); });

  Apps.ensureConnected(APP).then(function () { return db.sync(); }).then(function () {
    $('status').textContent = '';
  }).catch(function () { /* 'error' で表示済み */ });

  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(function () {});

  // テスト用（画面の状態確認）
  window.__archmap = { db: db, publicJson: publicJson };
})();
