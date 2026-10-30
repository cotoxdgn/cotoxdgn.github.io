/* 新しいアプリのひな形。フォルダごとコピーし、APP をフォルダ名に変える。 */
(function () {
  'use strict';
  var APP = 'template'; // ← アプリ名（英小文字）。スプシのシート名「app=template」になる

  var db = Apps.collection(APP);   // 端末内の控え＋自動同期
  var $ = function (id) { return document.getElementById(id); };

  function render(list) {
    var ul = $('list');
    ul.innerHTML = '';
    list.forEach(function (r) {
      var li = document.createElement('li');
      var span = document.createElement('span');
      span.textContent = r.data.text;
      if (r.pending) {
        var p = document.createElement('span');
        p.className = 'pending';
        p.textContent = '（送信待ち）';
        span.appendChild(p);
      }
      var del = document.createElement('button');
      del.className = 'ax-btn ax-btn-ghost';
      del.textContent = '削除';
      del.onclick = function () { db.remove(r.id); };
      li.appendChild(span);
      li.appendChild(del);
      ul.appendChild(li);
    });
  }

  db.onChange(render);
  $('form').addEventListener('submit', function (e) {
    e.preventDefault();
    var t = $('text').value.trim();
    if (!t) return;
    db.put({ text: t });   // すぐ画面に出て、裏でスプシへ送られる（オフラインなら後で）
    $('text').value = '';
  });
  $('settings').addEventListener('click', function () { Apps.openConnectSheet(APP); });
  Apps.on('error', function (d) { $('status').textContent = Apps.errorText(d.error); });

  // つながっていなければ接続画面を出す → つながったら同期
  Apps.ensureConnected(APP).then(function () { return db.sync(); }).then(function () {
    $('status').textContent = '';
  }).catch(function () { /* 'error' で表示済み */ });

  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(function () {});
})();
