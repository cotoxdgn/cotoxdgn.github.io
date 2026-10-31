// e2e テスト用：TaskApi.gs をモックのスプシ上で動かす小さなサーバー。実行：TZ=Asia/Tokyo node task/test/mock-server.js 8765
'use strict';
const http = require('http');
const makeGas = require('./gas-mock');
const g = makeGas({ now: new Date().toISOString() });
makeGas.fillExample(g.sh);
// 例示データの日付を「今日」に合わせる
const now = new Date(); const D = n => new Date(now.getFullYear(), now.getMonth(), now.getDate() + n);
[[5, -2], [6, 0], [7, 0], [8, 3], [9, -10]].forEach(([r, n]) => { g.sh.cell(r, 6).v = D(n); });
g.ctx.taskApiSetup();
if (process.argv[3] === 'actual') g.ctx.taskApiAddActualColumn();
const key = g.props.TASK_API_KEY;
http.createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/__sheet') {
    res.end(JSON.stringify(g.sh.rows.map(r => r.map(x => x.v instanceof Date ? 'D:' + x.v.toISOString() : x.v)))); return;
  }
  let body = '';
  req.on('data', c => { body += c; });
  req.on('end', () => {
    g.clockBox.t = Date.now();
    res.setHeader('Content-Type', 'application/json');
    res.end(g.ctx.doPost({ postData: { contents: body } }).text);
  });
}).listen(Number(process.argv[2] || 8765), () => console.log('KEY=' + key));
