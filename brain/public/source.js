/* 実績の公開ページが読むデータの入口。届け方を変えるときは、このファイルの load だけを差し替える。
 * 今の届け方：脳みその「公開データを書き出す」で作った works.json を、このフォルダ（brain/public/）に置く。
 * load() は { v:1, brand:'coto', generatedAt, items:[{ w, title, period, city, area, user, wish, point, photos:[{ url, ba }], know:[{ kind, kindName, title }] }] }
 * を返す Promise。ファイルが無いときは items が空のものを返す。
 * （検索エンジンに出すかどうかは index.html の robots の1行で切り替える）
 */
window.WorksSource = {
  load: function () {
    return fetch('works.json', { cache: 'no-cache' }).then(function (r) {
      if (r.status === 404) return { v: 1, items: [] };
      if (!r.ok) throw new Error('works.json ' + r.status);
      return r.json();
    });
  }
};
