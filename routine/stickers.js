/* ルーティン：シール風の小さな絵・予定の件名の言葉→絵の表・Googleカレンダーの色→くすみ色5色
 * 言葉と絵の表は WORDS に足していけます（上から順に見て、最初に当てはまったもの）。 */
(function (global) {
  'use strict';
  var IC = {
    chat: '<path d="M4 6h16v10H10l-4 3v-3H4z"/>',
    house: '<path d="M4 11l8-6 8 6v9H4z"/><path d="M10 20v-5h4v5"/>',
    scissors: '<circle cx="7" cy="17" r="3"/><circle cx="17" cy="17" r="3"/><path d="M9 15L18 4M15 15L6 4"/>',
    cup: '<path d="M5 9h11v5a5 5 0 0 1-5 5h-1a5 5 0 0 1-5-5z"/><path d="M16 10h2a2 2 0 0 1 0 4h-2M9 3v3M12 3v3"/>',
    cross: '<path d="M10 4h4v6h6v4h-6v6h-4v-6H4v-4h6z"/>',
    plane: '<path d="M3 13l18-8-6 16-3-7z"/>',
    bag: '<path d="M5 8h14l-1 12H6z"/><path d="M9 8a3 3 0 0 1 6 0"/>',
    bowl: '<path d="M3 11h18a9 9 0 0 1-18 0z"/><path d="M9 4c-1 2 1 3 0 5M14 4c-1 2 1 3 0 5"/>',
    book: '<path d="M4 5h6a2 2 0 0 1 2 2v13a2 2 0 0 0-2-2H4zM20 5h-6a2 2 0 0 0-2 2v13a2 2 0 0 1 2-2h6z"/>',
    flower: '<circle cx="12" cy="12" r="2.5"/><path d="M12 9.5a3 3 0 1 1 0-6 3 3 0 1 1 0 6M12 14.5a3 3 0 1 0 0 6 3 3 0 1 0 0-6M9.5 12a3 3 0 1 1-6 0 3 3 0 1 1 6 0M14.5 12a3 3 0 1 0 6 0 3 3 0 1 0-6 0"/>',
    star: '<path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z"/>',
    leaf: '<path d="M5 19C5 10 10 5 20 4c0 10-5 15-14 15z"/><path d="M5 19l8-8"/>',
    camera: '<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>',
    dot: '<circle cx="12" cy="12" r="4" fill="currentColor"/>'
  };
  // 件名の言葉 → 絵
  var WORDS = [
    [/打合せ|打ち合わせ|打合わせ|MTG|ミーティング/i, 'chat'],
    [/現場/, 'house'],
    [/美容院|美容室|ヘア|カット/, 'scissors'],
    [/カフェ|喫茶/, 'cup'],
    [/歯医者|歯科|病院|クリニック|医院/, 'cross'],
    [/旅行|出張/, 'plane'],
    [/買い物|買物/, 'bag'],
    [/ランチ|ごはん|ご飯|ディナー|食事/, 'bowl']
  ];
  // 種類（コレクション）に選べる絵
  var TYPE_ICONS = ['bowl', 'cup', 'book', 'flower', 'star', 'leaf', 'bag', 'house', 'camera'];
  // Googleカレンダーの色番号（getColor）→ くすみ色。色なし＝ブルーグレー
  var GCOLOR = { '1': 'lilac', '2': 'sage', '3': 'lilac', '4': 'rose', '5': 'mustard', '6': 'mustard', '7': 'blue', '8': 'blue', '9': 'blue', '10': 'sage', '11': 'rose' };

  function icon(k) { return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (IC[k] || IC.dot) + '</svg>'; }
  function evIcon(title) { var t = String(title || ''); for (var i = 0; i < WORDS.length; i++) if (WORDS[i][0].test(t)) return WORDS[i][1]; return 'dot'; }
  function color(id) { return GCOLOR[String(id == null ? '' : id)] || 'blue'; }

  var api = { IC: IC, WORDS: WORDS, TYPE_ICONS: TYPE_ICONS, GCOLOR: GCOLOR, icon: icon, evIcon: evIcon, color: color };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else global.RoutineStickers = api;
})(typeof window !== 'undefined' ? window : globalThis);
