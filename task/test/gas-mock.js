// task/gas/TaskApi.gs を node で動かすための簡易モック（SpreadsheetApp など）
// セルごとに 値・数式・書式・入力規則 を持ち、「既存の行が変わっていないか」を比べられるようにしてある
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

function blank() { return { v: '', f: '', fmt: null, dv: null }; }

class Sheet {
  constructor(name, parent) { this.name = name; this.parent = parent; this.rows = []; this.maxCols = 0; this.writes = []; }
  getName() { return this.name; }
  getParent() { return this.parent; }
  cell(r, c) {
    while (this.rows.length < r) this.rows.push([]);
    const row = this.rows[r - 1];
    while (row.length < c) row.push(blank());
    if (c > this.maxCols) this.maxCols = c;
    return row[c - 1];
  }
  peek(r, c) { const row = this.rows[r - 1]; return (row && row[c - 1]) || blank(); }
  getLastRow() {
    for (let r = this.rows.length; r >= 1; r--) if (this.rows[r - 1].some(x => (x.v !== '' && x.v != null) || x.f)) return r;
    return 0;
  }
  getLastColumn() {
    let m = 0;
    this.rows.forEach(row => row.forEach((x, i) => { if ((x.v !== '' && x.v != null) || x.f) m = Math.max(m, i + 1); }));
    return m;
  }
  getMaxColumns() { return this.maxCols; }
  getMaxRows() { return Math.max(this.rows.length, this.getLastRow()); }
  insertRowsAfter(r, n) { for (let i = 0; i < n; i++) this.rows.push([]); this.writes.push(['insertRowsAfter', r, n]); }
  getFilter() { return null; }
  hideSheet() { this.hidden = true; return this; }
  insertColumnsAfter(c, n) { this.maxCols += n; }
  deleteRow(r) { this.rows.splice(r - 1, 1); this.writes.push(['deleteRow', r]); }
  insertRowBefore(r) {
    while (this.rows.length < r - 1) this.rows.push([]);
    this.rows.splice(r - 1, 0, []);
    this.writes.push(['insertRowBefore', r]);
  }
  getRange(a, b, c, d) {
    if (typeof a === 'string') throw new Error('A1 not supported in mock');
    return new Range(this, a, b, c || 1, d || 1);
  }
}

class Range {
  constructor(sh, r, c, nr, nc) { Object.assign(this, { sh, r, c, nr, nc }); }
  each(fn) { for (let i = 0; i < this.nr; i++) for (let j = 0; j < this.nc; j++) fn(this.r + i, this.c + j, i, j); }
  getValues() {
    const o = [];
    for (let i = 0; i < this.nr; i++) { const row = []; for (let j = 0; j < this.nc; j++) row.push(this.sh.peek(this.r + i, this.c + j).v); o.push(row); }
    return o;
  }
  getValue() { return this.sh.peek(this.r, this.c).v; }
  getFormula() { return this.sh.peek(this.r, this.c).f || ''; }
  // 表示の文字（日付は m/d、真偽は TRUE/FALSE。本物に近い程度）
  getDisplayValues() {
    return this.getValues().map(row => row.map(v => v instanceof Date ? (v.getMonth() + 1) + '/' + v.getDate() : v === true ? 'TRUE' : v === false ? 'FALSE' : String(v == null ? '' : v)));
  }
  setNumberFormat(f) { this.each((r, c) => { this.sh.cell(r, c).nf = f; }); this.sh.writes.push(['setNumberFormat', this.r, this.c]); return this; }
  getDataValidation() { return this.sh.peek(this.r, this.c).dv || null; }
  insertCheckboxes() { this.each((r, c) => { const x = this.sh.cell(r, c); x.dv = 'checkbox'; if (x.v === '') x.v = false; }); this.sh.writes.push(['insertCheckboxes', this.r, this.c]); return this; }
  getFormulasR1C1() {
    const o = [];
    for (let i = 0; i < this.nr; i++) { const row = []; for (let j = 0; j < this.nc; j++) row.push(this.sh.peek(this.r + i, this.c + j).f); o.push(row); }
    return o;
  }
  setValue(v) {
    if (v instanceof Date) v = new Date(v.getTime());
    this.each((r, c) => { const x = this.sh.cell(r, c); x.v = v; x.f = ''; });
    this.sh.writes.push(['setValue', this.r, this.c]);
    return this;
  }
  setValues(vs) { this.each((r, c, i, j) => { const x = this.sh.cell(r, c); x.v = vs[i][j]; x.f = ''; }); this.sh.writes.push(['setValues', this.r, this.c]); return this; }
  setFormulaR1C1(f) { this.each((r, c) => { const x = this.sh.cell(r, c); x.f = f; x.v = '(fx)'; }); this.sh.writes.push(['setFormulaR1C1', this.r, this.c]); return this; }
  // 並べ替え（GAS の Range.sort と同じ：指定列の値で行ごと並べ替える。空はうしろ。同じ値は元の順）
  sort(specs) {
    const rows = [];
    for (let i = 0; i < this.nr; i++) { const row = []; for (let j = 0; j < this.nc; j++) row.push(Object.assign({}, this.sh.peek(this.r + i, this.c + j))); rows.push(row); }
    const key = (row, col) => { const v = row[col - this.c].v; return v instanceof Date ? v.getTime() : v; };
    const idx = rows.map((row, i) => i);
    idx.sort((a, b) => {
      for (const s of specs) {
        const x = key(rows[a], s.column), y = key(rows[b], s.column);
        const ex = x === '' || x == null, ey = y === '' || y == null;
        if (ex !== ey) return ex ? 1 : -1;
        if (x < y) return s.ascending ? -1 : 1;
        if (x > y) return s.ascending ? 1 : -1;
      }
      return a - b;
    });
    idx.forEach((from, to) => { for (let j = 0; j < this.nc; j++) { const t = this.sh.cell(this.r + to, this.c + j); Object.assign(t, rows[from][j]); } });
    this.sh.writes.push(['sort', this.r]);
    return this;
  }
  copyTo(dest, type) {
    for (let i = 0; i < this.nr; i++) for (let j = 0; j < this.nc; j++) {
      const s = this.sh.peek(this.r + i, this.c + j);
      const t = dest.sh.cell(dest.r + i, dest.c + j);
      if (type === 'PASTE_FORMAT') t.fmt = s.fmt;
      else if (type === 'PASTE_DATA_VALIDATION') t.dv = s.dv;
      else throw new Error('copy type not mocked: ' + type);
    }
    this.sh.writes.push(['copyTo', type, dest.r]);
  }
}

module.exports = function makeGas(opts) {
  opts = opts || {};
  const ss = { name: '_タスク管理2026.09.15~', sheets: {}, getName() { return this.name; }, getSheetByName(n) { return this.sheets[n] || null; },
    insertSheet(n) { const x = new Sheet(n, ss); ss.sheets[n] = x; return x; } };
  const sh = new Sheet('_日次ガントチャート', ss);
  ss.sheets[sh.name] = sh;
  const props = {};
  const cache = {};
  const clockBox = { t: Date.parse(opts.now || '2026-10-30T03:00:00.000Z') }; // 日本時間 10/30 12:00
  const RealDate = Date;
  class FakeDate extends RealDate {
    constructor(...a) { if (a.length === 0) super(clockBox.t); else super(...a); }
    static now() { return clockBox.t; }
    static [Symbol.hasInstance](x) { return x instanceof RealDate; }
  }
  let uu = 0;
  const ctx = {
    Date: FakeDate, JSON, Math, String, Number, Array, Object, isNaN, isFinite, parseFloat, RegExp,
    SpreadsheetApp: {
      openById: id => { if (id !== '1all9BRCbemXapdhjBidydCAjPbw26pNmmyi0wbxk66Q') throw new Error('bad id'); return ss; },
      getActiveSpreadsheet: () => null, // 独立したプロジェクトでは null
      CopyPasteType: { PASTE_FORMAT: 'PASTE_FORMAT', PASTE_DATA_VALIDATION: 'PASTE_DATA_VALIDATION' }
    },
    PropertiesService: { getScriptProperties: () => ({ getProperty: k => props[k] || null, setProperty: (k, v) => { props[k] = v; } }) },
    CacheService: { getScriptCache: () => ({ get: k => cache[k] || null, put: (k, v) => { cache[k] = v; } }) },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    Logger: { log: (...a) => { (ctx.__logs = ctx.__logs || []).push(a.join(' ')); } },
    Utilities: {
      getUuid: () => 'aaaaaaaa-bbbb-cccc-dddd-' + String(++uu).padStart(12, '0'),
      base64EncodeWebSafe: b => Buffer.from(b).toString('base64').replace(/\+/g, '-').replace(/\//g, '_'),
      newBlob: data => ({ getBytes: () => Array.from(Buffer.from(data)) }),
      formatDate: (d, tz, fmt) => {
        const p = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(d);
        const g = t => p.find(x => x.type === t).value;
        if (fmt !== 'yyyy-MM-dd') throw new Error('fmt not mocked');
        return g('year') + '-' + g('month') + '-' + g('day');
      }
    },
    ScriptApp: { getService: () => ({ getUrl: () => 'https://script.google.com/macros/s/TEST/exec' }) },
    ContentService: { createTextOutput: t => ({ text: t, setMimeType() { return this; } }), MimeType: { JSON: 'json' } }
  };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'gas', 'TaskApi.gs'), 'utf8'), ctx, { filename: 'TaskApi.gs' });
  const call = req => JSON.parse(ctx.doPost({ postData: { contents: JSON.stringify(req) } }).text);
  return { ctx, ss, sh, props, clockBox, call, Sheet };
};

// 本物に近い形のシートを作る（値は例示）。1行目見出し／2行目曜日／3行目合計／4行目空き行／5行目〜タスク
module.exports.fillExample = function (sh) {
  const D = (m, d) => new Date(2026, m - 1, d);
  const heads = ['No', '完了', 'PJ', 'ToDo｜未完了・日付順', '工', '📅', '', '⏰', '👤', '前提', '詳細', '10/30', '10/31', '11/1'];
  heads.forEach((h, i) => { const x = sh.cell(1, i + 1); x.v = h; x.fmt = 'head'; });
  for (let c = 12; c <= 14; c++) { sh.cell(2, c).f = '=TEXT(R1C,"ddd")'; sh.cell(2, c).v = '(金)'; sh.cell(3, c).f = '=SUM(R4C:R1000C)'; sh.cell(3, c).v = 0; }
  sh.cell(2, 2).v = false; sh.cell(3, 2).v = false;
  const row = (r, vals) => {
    vals.forEach((v, i) => { const x = sh.cell(r, i + 1); x.v = v; x.fmt = 'body'; });
    sh.cell(r, 2).dv = 'checkbox';
    sh.cell(r, 7).f = '=IF(RC6="","",TEXT(RC6,"(ddd)"))'; sh.cell(r, 7).v = '(fx)';
    for (let c = 12; c <= 14; c++) { const x = sh.cell(r, c); x.f = '=IF(RC6=R1C,RC5,"")'; x.v = '(fx)'; x.fmt = 'gantt'; }
  };
  row(4, ['', false, '', '', '', '', '', '', '', '', '']);
  row(5, [12, false, '例）案件A', '見積書の確認 | 設備項目', 1, D(10, 28), '', '🌅', '', '10.メール返信', '']);
  row(6, [11, false, '例）案件B', 'プレゼン構成 | 目次を作る', 1, D(10, 30), '', '🌅', '山田さん', '12.見積書の確認', 'https://example.com']);
  row(7, [10, true, '例）案件C', 'メール返信 | 協力会社', 0.5, D(10, 30), '', '☀️', '', '', '']);
  row(8, [9, false, '例）案件A', '現場写真の整理', 2, D(11, 2), '', '🌙', '', '', '']);
  row(9, [8, true, '例）案件A', '古い完了タスク', 1, D(10, 20), '', '🌅', '', '', '']);
};

// 「_定期タスク」表（定期タスク.gs の setupRecurringSheet と同じ形：見出し＋100行のチェックボックス＋2行目に止めた記入例）
module.exports.fillRecur = function (ss, Sheet) {
  const rs = ss.insertSheet('_定期タスク');
  ['有効', 'PJ', 'ToDo', '工', '⏰', '繰り返し', '曜日・日', '開始日', '終了日', '詳細'].forEach((h, i) => { rs.cell(1, i + 1).v = h; });
  for (let r = 2; r <= 101; r++) { const a = rs.cell(r, 1); a.v = false; a.dv = 'checkbox'; rs.cell(r, 6).dv = 'list'; }
  [false, '', 'タスクを整理する', 1, '9:30', '毎週', '日', '', '', ''].forEach((v, i) => { rs.cell(2, i + 1).v = v; });
  return rs;
};
