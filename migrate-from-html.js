// 从原 HTML 内嵌的 SQLite（base64）迁移数据到服务器数据库
// 用法: node migrate-from-html.js <html文件路径>
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const initSqlJs = require('sql.js');

const HTML_PATH = process.argv[2] || path.join(__dirname, '售前管理-so.html');
const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'data', 'presale.db');

const START = '<!--SF_DB_START\n';
const END = '\nSF_DB_END-->';

function b64ToUint8(b64) {
  const bin = Buffer.from(b64, 'base64');
  return new Uint8Array(bin);
}

(async () => {
  if (!fs.existsSync(HTML_PATH)) {
    console.error('找不到 HTML 文件:', HTML_PATH);
    process.exit(1);
  }
  const html = fs.readFileSync(HTML_PATH, 'utf8');
  const s = html.indexOf(START);
  const e = html.indexOf(END, s);
  if (s === -1 || e === -1) {
    console.error('HTML 中没有找到内嵌数据块 (SF_DB_START / SF_DB_END)');
    process.exit(1);
  }
  const b64 = html.substring(s + START.length, e).trim();
  console.log('内嵌数据长度:', b64.length, 'bytes (base64)');

  // 用 sql.js 读老库
  const SQL = await initSqlJs();
  const oldDb = new SQL.Database(b64ToUint8(b64));
  const res = oldDb.exec('SELECT data, updated_at FROM app_state WHERE id = 1');
  if (!res.length || !res[0].values.length) {
    console.error('老数据库 app_state 表为空');
    process.exit(1);
  }
  const data = res[0].values[0][0];
  const oldUpdated = res[0].values[0][1];
  const state = JSON.parse(data);
  const counts = {};
  for (const k of Object.keys(state)) {
    if (Array.isArray(state[k])) counts[k] = state[k].length;
  }
  console.log('数据统计:', counts);

  // 写入新库
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  const db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS app_state (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      data TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS app_state_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      data TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `);
  const now = new Date().toISOString();
  const existed = db.prepare('SELECT 1 FROM app_state WHERE id=1').get();
  if (existed) {
    const overwrite = process.argv.includes('--force');
    if (!overwrite) {
      console.error('服务器数据库已有数据。若要覆盖请加 --force');
      process.exit(1);
    }
    console.log('覆盖已有数据...');
  }
  db.prepare(`
    INSERT INTO app_state (id, data, updated_at) VALUES (1, ?, ?)
    ON CONFLICT(id) DO UPDATE SET data=excluded.data, updated_at=excluded.updated_at
  `).run(data, now);
  db.prepare('INSERT INTO app_state_history (data, created_at) VALUES (?, ?)')
    .run(data, now);
  console.log('迁移完成 ✓');
  console.log('  源数据最后更新:', oldUpdated);
  console.log('  新库位置:', DB_PATH);
})().catch(e => { console.error(e); process.exit(1); });
