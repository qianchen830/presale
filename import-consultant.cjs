/**
 * 历史 HTML 顾问导入脚本（全部用 sql.js）
 * 从文件名提取顾问名 → 解析每个 HTML 的 embedded DB → 匹配现有申请记录 → 写入 consultant 字段
 */
const fs = require('fs');
const path = require('path');

const HTML_DIR = '/mnt/c/Users/Administrator/Desktop/售前管理';
const DB_PATH = '/home/openclaw/.openclaw/workspace/webdev-projects/presale/data/presale.db';

function extractConsultant(filename) {
  const m = filename.match(/【(.+?)】/);
  return m ? m[1] : null;
}

function extractEmbeddedBuf(html) {
  const START = '<!--SF_DB_START\n';
  const END = '\nSF_DB_END-->';
  const s = html.indexOf(START), e = html.indexOf(END, s);
  if (s < 0 || e < 0) return null;
  const b64 = html.slice(s + START.length, e).trim();
  if (!b64 || b64.length < 100) return null;
  return Buffer.from(b64, 'base64');
}

async function main() {
  const initSqlJs = require('sql.js');
  const SQL = await initSqlJs();

  // 打开主数据库
  let mainDb;
  if (fs.existsSync(DB_PATH)) {
    mainDb = new SQL.Database(fs.readFileSync(DB_PATH));
  } else {
    console.error('数据库不存在:', DB_PATH);
    return;
  }

  // 读取 app_state
  const stateRows = mainDb.exec('SELECT data FROM app_state WHERE id = 1');
  if (!stateRows.length || !stateRows[0].values.length) {
    console.error('app_state 无数据');
    mainDb.close(); return;
  }
  let state;
  try {
    state = JSON.parse(stateRows[0].values[0][0]);
  } catch (e) {
    console.error('state JSON 解析失败:', e.message);
    mainDb.close(); return;
  }

  if (!state.applications) { console.error('无 applications'); mainDb.close(); return; }
  console.log(`\n现有 ${state.applications.length} 条申请记录\n`);

  // 按 id 建索引
  const appMap = new Map();
  state.applications.forEach(a => { if (a.id) appMap.set(a.id, a); });

  const stat = {};
  let updated = 0, skipped = 0;

  const files = fs.readdirSync(HTML_DIR).filter(f => f.endsWith('.html'));
  console.log(`处理 ${files.length} 个历史文件...\n`);

  for (const file of files) {
    const consultant = extractConsultant(file);
    if (!consultant) continue;

    const buf = extractEmbeddedBuf(fs.readFileSync(path.join(HTML_DIR, file), 'utf8'));
    if (!buf) { console.log(`[${consultant}] 无数据`); continue; }

    let apps = [];
    try {
      const oldDb = new SQL.Database(buf);
      const r = oldDb.exec('SELECT data FROM app_state WHERE id = 1');
      oldDb.close();
      if (!r.length || !r[0].values.length) continue;
      const oldState = JSON.parse(r[0].values[0][0]);
      apps = oldState.applications || [];
    } catch (e) {
      console.log(`[${consultant}] 解析失败: ${e.message}`);
      continue;
    }

    if (!apps.length) { console.log(`[${consultant}] 0 条记录`); continue; }
    console.log(`[${consultant}] ${apps.length} 条`);

    apps.forEach(app => {
      if (!app.id) return;
      const existing = appMap.get(app.id);
      if (!existing) return;
      if (existing.consultant && existing.consultant.trim()) {
        skipped++; return;
      }
      existing.consultant = consultant;
      stat[consultant] = (stat[consultant] || 0) + 1;
      updated++;
    });
  }

  console.log(`\n结果：更新 ${updated} 条，跳过 ${skipped} 条（已有顾问）`);
  if (Object.keys(stat).length) {
    Object.entries(stat).forEach(([k, v]) => console.log(`  ${k}: ${v} 条`));
  }

  // 回写 app_state（JSON.stringify 整个 state）
  const newData = JSON.stringify(state);
  const now = new Date().toISOString();
  mainDb.run('UPDATE app_state SET data=?, updated_at=? WHERE id=1', [newData, now]);

  // 保存
  const out = mainDb.export();
  fs.writeFileSync(DB_PATH, Buffer.from(out));
  mainDb.close();
  console.log('\n数据库已保存 ✓');
}

main().catch(e => { console.error(e); process.exit(1); });
