/**
 * 修复导入脚本：从所有顾问的历史HTML文件中提取完整数据
 * 并合并到当前数据库的 app_state 中
 */
const fs = require('fs');
const path = require('path');

const HTML_DIR = '/mnt/c/Users/Administrator/Desktop/售前管理';
const DB_PATH = '/home/openclaw/.openclaw/workspace/webdev-projects/presale/data/presale.db';

async function main() {
  const initSqlJs = require('sql.js');
  const SQL = await initSqlJs();

  // 读取当前数据库
  const dbBuf = fs.readFileSync(DB_PATH);
  const db = new SQL.Database(dbBuf);

  // 创建用户账号（从HTML文件名提取顾问名）
  const bcrypt = require('bcryptjs');
  const passwordHash = bcrypt.hashSync('123456', 10);
  const now = new Date().toISOString();
  const dept = '解决方案与项目经理部';

  for (const file of fs.readdirSync(HTML_DIR).filter(f => f.endsWith('.html'))) {
    const consultant = file.match(/【(.+?)】/)?.[1];
    if (!consultant) continue;
    const exist = db.exec(`SELECT id FROM users WHERE username = '${consultant.replace(/'/g, "''")}'`);
    if (!exist.length || !exist[0].values.length) {
      db.run("INSERT INTO users (username, password_hash, display_name, role, department, view_depts, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
        [consultant, passwordHash, consultant, 'user', dept, '[]', now]);
      console.log(`✅ 创建用户: ${consultant} / 123456`);
    }
  }

  // 读取当前状态
  const stateResult = db.exec("SELECT data FROM app_state WHERE id = 1");
  if (!stateResult.length || !stateResult[0].values.length) {
    console.error('当前数据库无 app_state');
    process.exit(1);
  }
  const state = JSON.parse(stateResult[0].values[0][0]);
  console.log('当前数据:');
  console.log('  applications:', state.applications?.length);
  console.log('  contracts:', state.contracts?.length);
  console.log('  judgments:', state.judgments?.length);
  console.log('  followUps:', state.followUps?.length);
  console.log('  salesQuestions:', state.salesQuestions?.length);
  console.log('  requirements:', state.requirements?.length);
  console.log('  allocations:', state.allocations?.length);
  console.log('  annualActuals:', JSON.stringify(state.annualActuals));

  // 读取所有HTML文件
  const files = fs.readdirSync(HTML_DIR).filter(f => f.endsWith('.html'));
  console.log(`\n找到 ${files.length} 个历史文件`);

  // 用 oppNo 作为 key 来去重合并
  const merge = (target, source, key = 'id') => {
    const existing = new Set(target.map(x => x[key]));
    const added = source.filter(x => !existing.has(x[key]));
    return [...target, ...added];
  };

  for (const file of files) {
    const consultant = file.match(/【(.+?)】/)?.[1];
    const htmlBuf = fs.readFileSync(path.join(HTML_DIR, file));
    const htmlStr = htmlBuf.toString('utf8');
    const si = htmlStr.indexOf('<!--SF_DB_START');
    const ei = htmlStr.indexOf('SF_DB_END-->');
    if (si < 0 || ei < 0) { console.log(`[${consultant}] 无嵌入式数据`); continue; }

    const b64 = htmlStr.slice(si + 16, ei).trim();
    let histDb;
    try {
      histDb = new SQL.Database(Buffer.from(b64, 'base64'));
    } catch(e) {
      // 尝试找另一个标记
      console.log(`[${consultant}] 解析失败: ${e.message.slice(0, 80)}`);
      continue;
    }

    const r = histDb.exec("SELECT data FROM app_state WHERE id = 1");
    histDb.close();
    if (!r.length || !r[0].values.length) { console.log(`[${consultant}] app_state为空`); continue; }

    const h = JSON.parse(r[0].values[0][0]);
    console.log(`[${consultant}] contracts=${h.contracts?.length} judgments=${h.judgments?.length} salesQ=${h.salesQuestions?.length} followUps=${h.followUps?.length} reqs=${h.requirements?.length} allocs=${h.allocations?.length}`);

    // 合并各数据表（按 oppNo/id 去重）
    // 重要：每条 application 必须标记 consultant，否则前端过滤失效
    if (h.applications?.length) {
      h.applications.forEach(a => { a.consultant = consultant; });
      state.applications = merge(state.applications, h.applications, 'id');
    }
    if (h.contracts?.length) state.contracts = merge(state.contracts, h.contracts, 'id');
    if (h.judgments?.length) state.judgments = merge(state.judgments, h.judgments, 'id');
    if (h.followUps?.length) state.followUps = merge(state.followUps, h.followUps, 'id');
    if (h.salesQuestions?.length) state.salesQuestions = merge(state.salesQuestions, h.salesQuestions, 'id');
    if (h.requirements?.length) state.requirements = merge(state.requirements, h.requirements, 'id');
    if (h.allocations?.length) state.allocations = merge(state.allocations, h.allocations, 'id');
    // departments 和 employees 是公司级基础数据，取自第一个有数据的HTML
    if (h.departments?.length && !state.departments.length) state.departments = h.departments;
    if (h.employees?.length && !state.employees.length) state.employees = h.employees;
    // 注意：annualActuals 是各顾问自己填的历史数据，只存在于各自HTML中
    // 不能合并到全局状态，否则变成全公司的历史数据，逻辑错误
    // 各顾问的 annualActuals 应在前端按 filterConsultant 过滤后单独显示
  }

  // 保存历史记录
  const histResult = db.exec("SELECT data FROM app_state_history ORDER BY id DESC LIMIT 1");
  const lastHist = histResult.length && histResult[0].values.length
    ? JSON.parse(histResult[0].values[0][0]) : null;

  db.run("INSERT INTO app_state_history (data, created_at) VALUES (?, ?)",
    [JSON.stringify(lastHist || {}), now]);

  // 更新状态
  db.run("UPDATE app_state SET data = ?, updated_at = ? WHERE id = 1",
    [JSON.stringify(state), now]);

  const outBuf = db.export();
  fs.writeFileSync(DB_PATH, Buffer.from(outBuf));
  db.close();

  console.log('\n✅ 导入完成！最终数据:');
  console.log('  applications:', state.applications?.length);
  console.log('  contracts:', state.contracts?.length);
  console.log('  judgments:', state.judgments?.length);
  console.log('  followUps:', state.followUps?.length);
  console.log('  salesQuestions:', state.salesQuestions?.length);
  console.log('  requirements:', state.requirements?.length);
  console.log('  allocations:', state.allocations?.length);
  console.log('  annualActuals:', JSON.stringify(state.annualActuals));
}

main().catch(e => { console.error(e); process.exit(1); });
