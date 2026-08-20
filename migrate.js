// 综合迁移脚本：
// 1. 从原 HTML 内嵌的 SQLite 读取完整 state
// 2. 从 HTML 中解析 DOM 里渲染出来的申请列表（浏览器保存时只存了当前页）
// 3. 合并去重后写入服务器数据库
//
// 用法: node migrate.js <原始HTML路径> [--force]
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const initSqlJs = require('sql.js');

const HTML_PATH = process.argv[2] || path.join(__dirname, 'source-original.html');
const FORCE = process.argv.includes('--force');
const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'data', 'presale.db');

function decodeEntities(s) {
  return s.replace(/&#(\d+);/g, (_, d) => String.fromCharCode(parseInt(d, 10)))
          .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
          .replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&nbsp;/g,' ');
}

function cleanCell(s) {
  s = (s || '').trim();
  let m = s.match(/title="([^"]*)"/);
  if (m) return decodeEntities(m[1]).trim();
  m = s.match(/class="badge[^"]*"[^>]*>([^<]+)</);
  if (m) return decodeEntities(m[1]).trim();
  return decodeEntities(s.replace(/<[^>]+>/g, '')).trim();
}

function parseDomApplications(html) {
  const rows = [];
  const re = /<tr class="clickable"[^>]*onclick="selectApp\(&#39;(id_ms[a-z0-9_]+)&#39;\)"[^>]*>([\s\S]*?)<\/tr>/g;
  let m;
  while ((m = re.exec(html))) {
    const id = m[1];
    const body = m[2];
    const tds = [];
    const tdRe = /<td[^>]*>([\s\S]*?)<\/td>/g;
    let tm;
    while ((tm = tdRe.exec(body))) tds.push(cleanCell(tm[1]));
    // columns: applyDate, applicant, department, customer, oppNo, projectName, product, buyMode, currentStage, status, expected, signAmount, actions
    let oppNo = tds[4] || '';
    if (oppNo === '-') oppNo = '';
    oppNo = oppNo.replace(/^\(|\)$/g, '');
    const signAmt = (tds[11] || '').replace(/,/g, '');
    rows.push({
      id,
      applyDate: tds[0] || '',
      applicant: tds[1] || '',
      department: tds[2] || '',
      customer: tds[3] || '',
      oppNo,
      projectName: tds[5] || '',
      product: tds[6] || '',
      buyMode: tds[7] || '',
      currentStage: tds[8] || '',
      status: tds[9] || '',
      expectedSignDate: (tds[10] && tds[10] !== '—' && tds[10] !== '-') ? tds[10] : '',
      expectedSignAmount: '',
      signDate: '',
      signAmount: (signAmt && signAmt !== '—' && signAmt !== '-') ? signAmt : '',
      coreRequirement: ''
    });
  }
  return rows;
}

(async () => {
  if (!fs.existsSync(HTML_PATH)) {
    console.error('找不到 HTML:', HTML_PATH);
    process.exit(1);
  }
  const html = fs.readFileSync(HTML_PATH, 'utf8');

  // 1. 读内嵌 SQLite
  const m = html.match(/<!--SF_DB_START\n([\s\S]*?)\nSF_DB_END-->/);
  if (!m || !m[1].trim()) throw new Error('HTML 中没有内嵌 SQLite');
  const SQL = await initSqlJs();
  const oldDb = new SQL.Database(Buffer.from(m[1].trim(), 'base64'));
  const r = oldDb.exec('SELECT data FROM app_state WHERE id = 1');
  if (!r.length) throw new Error('内嵌 SQLite 没有 app_state 数据');
  const state = JSON.parse(r[0].values[0][0]);
  console.log('内嵌 SQLite 数据条数:');
  for (const k of Object.keys(state)) if (Array.isArray(state[k])) console.log(`  ${k}: ${state[k].length}`);

  // 2. 解析 DOM
  const domApps = parseDomApplications(html);
  console.log(`\nHTML DOM 中解析到申请: ${domApps.length}`);

  // 3. 合并（DOM 数据更新更全，优先于 SQLite）
  const sqliteApps = state.applications || [];
  const byId = new Map();
  for (const a of sqliteApps) byId.set(a.id, a);
  for (const a of domApps) byId.set(a.id, a); // DOM 覆盖 SQLite
  state.applications = Array.from(byId.values());
  console.log(`合并后申请总数: ${state.applications.length}`);

  // 4. 写入服务器数据库
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
  const existed = db.prepare('SELECT 1 FROM app_state WHERE id=1').get();
  if (existed && !FORCE) {
    console.error('服务器数据库已有数据。加 --force 覆盖。');
    process.exit(1);
  }
  const now = new Date().toISOString();
  const dataStr = JSON.stringify(state);
  db.prepare(`
    INSERT INTO app_state (id, data, updated_at) VALUES (1, ?, ?)
    ON CONFLICT(id) DO UPDATE SET data=excluded.data, updated_at=excluded.updated_at
  `).run(dataStr, now);
  db.prepare('INSERT INTO app_state_history (data, created_at) VALUES (?, ?)').run(dataStr, now);
  console.log('\n✓ 迁移完成');
  console.log('  数据库:', DB_PATH);
  console.log('  申请总数:', state.applications.length);
})().catch(e => { console.error(e); process.exit(1); });
