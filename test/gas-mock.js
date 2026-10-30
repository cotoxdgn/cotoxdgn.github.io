// gas/Code.gs を node で動かすための簡易モック（SpreadsheetApp・DriveApp など）
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

module.exports = function makeGas() {
// ---------- モック ----------
  function colIndex(letters) { let n = 0; for (const c of letters) n = n * 26 + (c.charCodeAt(0) - 64); return n; }
  function parseA1(a1) {
    const m = /^([A-Z]+)(\d*)(?::([A-Z]+)(\d*))?$/.exec(a1);
    const c1 = colIndex(m[1]), r1 = m[2] ? +m[2] : 1;
    const c2 = m[3] ? colIndex(m[3]) : c1, r2 = m[4] ? +m[4] : (m[2] ? r1 : 1000);
    return [r1, c1, r2 - r1 + 1, c2 - c1 + 1];
  }
  class Sheet {
    constructor(name) { this.name = name; this.cells = []; }
    getName() { return this.name; }
    getLastRow() { for (let r = this.cells.length; r >= 1; r--) { const row = this.cells[r - 1]; if (row && row.some(v => v !== '' && v != null)) return r; } return 0; }
    getRange(a, b, c, d) {
      const [r, col, nr, nc] = typeof a === 'string' ? parseA1(a) : [a, b, c || 1, d || 1];
      const sh = this;
      return {
        setValues(v) { v.forEach((row, i) => row.forEach((x, j) => sh.set(r + i, col + j, x))); return this; },
        setValue(x) { sh.set(r, col, x); return this; },
        getValues() { const o = []; for (let i = 0; i < nr; i++) { const row = []; for (let j = 0; j < nc; j++) row.push(sh.get(r + i, col + j)); o.push(row); } return o; },
        getValue() { return sh.get(r, col); },
        clearContent() { sh.set(r, col, ''); return this; },
        setFontWeight() { return this; }, setNumberFormat() { return this; }
      };
    }
    set(r, c, v) { while (this.cells.length < r) this.cells.push([]); const row = this.cells[r - 1]; while (row.length < c) row.push(''); row[c - 1] = v; }
    get(r, c) { const row = this.cells[r - 1]; return row && row[c - 1] !== undefined ? row[c - 1] : ''; }
    setFrozenRows() {}
  }
  class SS {
    constructor() { this.sheets = [new Sheet('シート1')]; }
    getName() { return 'テスト用スプシ'; }
    getSheetByName(n) { return this.sheets.find(s => s.name === n) || null; }
    insertSheet(n, idx) { const s = new Sheet(n); if (idx === 0) this.sheets.unshift(s); else this.sheets.push(s); return s; }
    getSheets() { return this.sheets.slice(); }
    deleteSheet(s) { this.sheets = this.sheets.filter(x => x !== s); }
  }
  let idSeq = 0;
  class Folder {
    constructor(name, parent) { this.name = name; this.id = 'F' + (++idSeq); this.parent = parent; this.folders = []; this.files = []; drive.byId[this.id] = this; }
    getId() { return this.id; }
    getFoldersByName(n) { const hit = this.folders.filter(f => f.name === n); let i = 0; return { hasNext: () => i < hit.length, next: () => hit[i++] }; }
    createFolder(n) { const f = new Folder(n, this); this.folders.push(f); return f; }
    createFile(blob) { const f = new File(blob, this); this.files.push(f); return f; }
    getParents() { const ps = this.parent ? [this.parent] : []; let i = 0; return { hasNext: () => i < ps.length, next: () => ps[i++] }; }
  }
  class File {
    constructor(blob, parent) { this.blob = blob; this.parent = parent; this.id = 'X' + (++idSeq); this.trashed = false; this.sharing = null; drive.byId[this.id] = this; }
    getId() { return this.id; }
    getParents() { let done = false; return { hasNext: () => !done, next: () => { done = true; return this.parent; } }; }
    setSharing(a, p) { this.sharing = [a, p]; }
    setTrashed(t) { this.trashed = t; }
    getBlob() { return this.blob; }
  }
  const drive = { byId: {} };
  const clockBox = { t: Date.parse('2026-10-30T00:00:00.000Z') };
  const RealDate = Date;
  class FakeDate extends RealDate {
    constructor(...a) { if (a.length === 0) super(clockBox.t); else super(...a); }
    static now() { return clockBox.t; }
  }
  const ss = new SS();
  const ctx = {
    Date: FakeDate, JSON, Math, String, Array, Object, isNaN, RegExp,
    SpreadsheetApp: { getActiveSpreadsheet: () => ss, getUi: () => { throw new Error('no ui'); } },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    Utilities: {
      getUuid: () => 'uuid' + String(++idSeq).padStart(28, '0') + '-x',
      base64EncodeWebSafe: b => Buffer.from(b).toString('base64').replace(/\+/g, '-').replace(/\//g, '_'),
      base64Encode: b => Buffer.from(b).toString('base64'),
      base64Decode: s => Array.from(Buffer.from(s, 'base64')),
      newBlob: (data, mime, name) => ({ getBytes: () => (typeof data === 'string' ? Array.from(Buffer.from(data)) : data), getContentType: () => mime, name }),
      formatDate: () => '20261030-090000'
    },
    DriveApp: {
      createFolder: n => new Folder(n, null),
      getFolderById: id => { const f = drive.byId[id]; if (!f || !(f instanceof Folder)) throw new Error('nf'); return f; },
      getFileById: id => { const f = drive.byId[id]; if (!f || !(f instanceof File)) throw new Error('nf'); return f; },
      Access: { ANYONE_WITH_LINK: 'AWL' }, Permission: { VIEW: 'VIEW' }
    },
    ScriptApp: { getService: () => ({ getUrl: () => 'https://script.google.com/macros/s/ABC/exec' }) },
    ContentService: { createTextOutput: t => ({ text: t, setMimeType() { return this; } }), MimeType: { JSON: 'json' } },
    HtmlService: {}
  };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'gas', 'Code.gs'), 'utf8'), ctx, { filename: 'Code.gs' });
  return { ctx, ss, drive, clockBox, FakeDate };
};
