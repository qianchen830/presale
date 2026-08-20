// 批量迁移售前管理系统用户数据
// 从 /tmp/presale-states/*.json 读取各用户数据，合并后写入 presale.db
// 用法: cd ~/.openclaw/workspace/webdev-projects/presale && node write-db.js
const fs = require('fs');
const path = require('path');

const DB_PATH = '/home/openclaw/workspace/webdev-projects/presale/data/presale.db';
const STATES_DIR = '/tmp/presale-states';
const USERS = ['刘云飞','包百花','明芳','李莹莹','王景蕾','田景洪','舒蕴佳','苏诚','谢菲菲','陈骞'];

function mergeById(arrays) {
  const map = new Map();
  for (const arr of arrays) {
    if (!Array.isArray(arr)) continue;
    for (const item of arr) {
      if (item && item.id) map.set(item.id, item);
    }
  }
  return [...map.values()];
}

async function main() {
  console.log('🔍 开始迁移...\n');

  const initSqlJs = require('sql.js');
  const bcrypt = require('bcryptjs');
  const SQL = await initSqlJs();

  // 1. 加载所有 state JSON
  const allStates = [];
  for (const name of USERS) {
    const fp = path.join(STATES_DIR, name + '.json');
    if (!fs.existsSync(fp)) { console.log('MISS:', name); continue; }
    allStates.push(JSON.parse(fs.readFileSync(fp, 'utf8')));
  }
  console.log(`📊 共读取 ${allStates.length} 个用户数据`);

  // 2. 合并业务数据
  const merged = {
    applications: mergeById(allStates.map(s => s.applications).filter(Boolean)),
    salesQuestions: allStates[0].salesQuestions || [],
    requirements: allStates[0].requirements || [],
    judgments: allStates[0].judgments || [],
    followUps: mergeById(allStates.map(s => s.followUps).filter(Boolean)),
    contracts: mergeById(allStates.map(s => s.contracts).filter(Boolean)),
    allocations: mergeById(allStates.map(s => s.allocations).filter(Boolean)),
    annualTarget: allStates[0].annualTarget || null,
    annualTargets: allStates[0].annualTargets || {},
    annualActuals: allStates[0].annualActuals || {},
    quarterTargets: allStates[0].quarterTargets || {},
    quarterPcts: allStates[0].quarterPcts || {},
    activeTab: allStates[0].activeTab || 'applications',
    year: allStates[0].year || new Date().getFullYear(),
    quarter: allStates[0].quarter || Math.ceil((new Date().getMonth() + 1) / 3),
    month: allStates[0].month || (new Date().getMonth() + 1),
    weekYear: allStates[0].weekYear || new Date().getFullYear(),
    weekNum: allStates[0].weekNum || 1,
    weekStart: allStates[0].weekStart || '',
    weekEnd: allStates[0].weekEnd || '',
    consultant: USERS[0] || '',
    consultantAvatar: allStates[0].consultantAvatar || '',
    selectedAppId: null,
    departments: allStates[0].departments || [],
    employees: mergeById(allStates.map(s => s.employees).filter(Boolean)),
  };

  console.log('📦 合并统计: 申请', merged.applications.length, '| 跟进', merged.followUps.length, '| 合同', merged.contracts.length, '| 员工', merged.employees.length);

  // 3. 读写数据库
  let data = null;
  try { data = fs.readFileSync(DB_PATH); console.log('已有数据库，大小:', data.length); } catch(e) { console.log('新建数据库'); }
  const db = new SQL.Database(data);

  db.run(`CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL, display_name TEXT NOT NULL DEFAULT '', role TEXT NOT NULL DEFAULT 'user', department TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL)`);
  db.run(`CREATE TABLE IF NOT EXISTS app_state (id INTEGER PRIMARY KEY CHECK (id = 1), data TEXT NOT NULL, updated_at TEXT NOT NULL)`);
  db.run(`CREATE TABLE IF NOT EXISTS app_state_history (id INTEGER PRIMARY KEY AUTOINCREMENT, data TEXT NOT NULL, created_at TEXT NOT NULL)`);

  const now = new Date().toISOString();
  const existingUsers = db.exec('SELECT username FROM users');
  const existingNames = existingUsers.length ? existingUsers[0].values.map(r => r[0]) : [];
  let created = 0;
  console.log('\n👤 创建用户账号:');
  for (const name of USERS) {
    if (existingNames.includes(name)) { console.log('  ⏭️ ', name, '(已存在)'); continue; }
    const hash = bcrypt.hashSync('123456', 10);
    db.run('INSERT INTO users VALUES (?,?,?,?,?,?,?)', [null, name, hash, name, 'user', '解决方案与项目经理部', now]);
    console.log('  ✅', name, '(密码: 123456)');
    created++;
  }

  const stateJson = JSON.stringify(merged);
  const existingState = db.exec('SELECT id FROM app_state WHERE id=1');
  if (existingState.length && existingState[0].values.length) {
    const old = db.exec('SELECT data, updated_at FROM app_state WHERE id=1');
    if (old.length && old[0].values.length) {
      db.run('INSERT INTO app_state_history VALUES (?,?,?)', [null, old[0].values[0][0], old[0].values[0][1]]);
    }
    db.run('UPDATE app_state SET data=?, updated_at=? WHERE id=1', [stateJson, now]);
  } else {
    db.run('INSERT INTO app_state VALUES (1,?,?)', [stateJson, now]);
  }

  const buf = db.export();
  db.close();

  // 写入策略: /tmp中转 -> copyFileSync(目标必须已存在)
  const tmpPath = '/tmp/presale-final-' + Date.now() + '.db';
  fs.writeFileSync(tmpPath, Buffer.from(new Uint8Array(buf)));
  if (!fs.existsSync(DB_PATH)) fs.writeFileSync(DB_PATH, Buffer.alloc(0));
  fs.copyFileSync(tmpPath, DB_PATH);
  fs.unlinkSync(tmpPath);
  console.log('\n💾 数据库写入成功! 大小:', fs.statSync(DB_PATH).size);

  // 验证
  const vDb = new SQL.Database(fs.readFileSync(DB_PATH));
  const vUsers = vDb.exec('SELECT username, display_name FROM users');
  const vApps = vDb.exec(`SELECT json_extract(data, '$.applications') FROM app_state WHERE id=1`);
  console.log('\n📋 数据库用户:');
  if (vUsers.length) vUsers[0].values.forEach(r => console.log('  -', r[0], '(' + r[1] + ')'));
  if (vApps.length && vApps[0].values.length) {
    const apps = JSON.parse(vApps[0].values[0][0]);
    console.log('\n📋 申请记录:', apps.length, '条');
  }
  vDb.close();

  console.log('\n✅ 迁移完成! 新建', created, '个账号');
  console.log('🔐 密码: 123456');
  console.log('🌐 访问: http://localhost:3210');
  console.log('\n💡 重启服务: cd', path.dirname(DB_PATH), '&& nohup node server.js > /tmp/presale.log 2>&1 &');
}

main().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
