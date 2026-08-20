// 售前管理 - 后端服务
// Node.js + Express + sql.js (纯 JS SQLite) + Session Auth
const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const initSqlJs = require('sql.js');

const PORT = process.env.PORT || 3210;
const SESSION_SECRET = process.env.SESSION_SECRET || 'presale-secret-2026-change-me';
const DATA_DIR = path.join(__dirname, 'data');
const DB_PATH = process.env.DB_PATH || path.join(DATA_DIR, 'presale.db');

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

// ---- sql.js 数据库 ----
let db;
const SQL = require('sql.js');

async function initDb() {
  const SQL = await initSqlJs();

  let data = null;
  let isNewDb = false;
  if (fs.existsSync(DB_PATH)) {
    data = fs.readFileSync(DB_PATH);
  } else {
    isNewDb = true;
  }

  db = new SQL.Database(data);
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      display_name TEXT NOT NULL DEFAULT '',
      role TEXT NOT NULL DEFAULT 'user',
      department TEXT NOT NULL DEFAULT '',
      view_depts TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL
    );
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
    CREATE INDEX IF NOT EXISTS idx_history_created ON app_state_history(created_at);
  `);

  // 兼容旧数据库：view_depts 列不存在时添加
  try { db.run("ALTER TABLE users ADD COLUMN view_depts TEXT NOT NULL DEFAULT '[]'"); } catch(e) { /* 列已存在 */ }

  // 默认管理员
  const adminRow = db.exec("SELECT id FROM users WHERE username = 'admin'");
  if (adminRow.length === 0 || adminRow[0].values.length === 0) {
    const bcrypt = require('bcryptjs');
    const hash = bcrypt.hashSync('admin123', 10);
    const now = new Date().toISOString();
    db.run("INSERT INTO users (username, password_hash, display_name, role, department, view_depts, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      ['admin', hash, '系统管理员', 'admin', '解决方案与项目经理部', '[]', now]);
    console.log('✅ 默认管理员账号已创建: admin / admin123');
  }

  // 仅在新建数据库时初始化空状态，绝不在已有数据上覆盖写入
  if (isNewDb) {
    const now = new Date().toISOString();
    const emptyState = {
      applications: [], contracts: [], judgments: [], followUps: [],
      salesQuestions: [], requirements: [], allocations: [],
      annualTarget: 1500, annualTargets: {2024:0,2025:0,2026:0},
      annualActuals: {}, quarterTargets: {Q1:100,Q2:120,Q3:130,Q4:150},
      quarterPcts: {Q1:16,Q2:27,Q3:23,Q4:34},
      activeTab: 'contract', year: 2026,
      departments: [], employees: [],
      filterDept: null, filterConsultant: null, consultant: '', consultantAvatar: '',
      selectedAppId: null
    };
    db.run('INSERT INTO app_state (id, data, updated_at) VALUES (1, ?, ?)', [JSON.stringify(emptyState), now]);
    saveDb();
    console.log('✅ 新建数据库已初始化空状态');
  }

  console.log('✅ 数据库初始化完成');
}

function saveDb() {
  if (!db) return;
  const buf = db.export();
  const bufArr = Buffer.from(buf);
  fs.writeFileSync(DB_PATH, bufArr);
}

const saveDbs = (() => {
  let timer;
  return () => {
    clearTimeout(timer);
    timer = setTimeout(saveDb, 100);
  };
})();

function getStateRow() {
  const r = db.exec('SELECT data, updated_at FROM app_state WHERE id = 1');
  if (!r.length || !r[0].values.length) return null;
  return { data: r[0].values[0][0], updated_at: r[0].values[0][1] };
}

function getState() {
  const row = getStateRow();
  if (!row) return null;
  return { state: JSON.parse(row.data), updatedAt: row.updated_at };
}

function saveState(newState) {
  // newState 是本次要保存的增量数据（来自当前用户的过滤状态）
  // 必须与磁盘上已有的完整状态合并，防止过滤后的数据覆盖全局数据
  const existing = getStateRow();
  const now = new Date().toISOString();
  let merged;
  if (existing) {
    merged = JSON.parse(existing.data);
    // 合并策略：
    //   - applications / contracts / judgments / followUps / salesQuestions / requirements / allocations
    //     按 id 去重，新的或变更的覆盖旧的（来自任意顾问的数据都要保留）
    //   - departments / employees：已有则保留
    //   - 各类 target/pct/filter 字段：使用本次提交的值（用户主动修改的）
    const mergeById = (existingArr, incomingArr) => {
      const map = new Map();
      (existingArr || []).forEach(x => { if (x && x.id) map.set(x.id, x); });
      (incomingArr || []).forEach(x => { if (x && x.id) map.set(x.id, x); });
      return [...map.values()];
    };
    for (const key of ['applications','contracts','judgments','followUps','salesQuestions','requirements','allocations']) {
      if (newState[key] !== undefined) {
        merged[key] = mergeById(merged[key] || [], newState[key] || []);
      }
    }
    // 全局配置字段：直接取新值
    for (const key of ['annualTarget','annualTargets','annualActuals','quarterTargets','quarterPcts','activeTab','year','departments','employees']) {
      if (newState[key] !== undefined) merged[key] = newState[key];
    }
  } else {
    merged = newState;
  }
  const dataStr = JSON.stringify(merged);
  db.run('INSERT INTO app_state_history (data, created_at) VALUES (?, ?)', [existing ? existing.data : '{}', now]);
  db.run("UPDATE app_state SET data = ?, updated_at = ? WHERE id = 1", [dataStr, now]);
  saveDbs();
  return now;
}

// ---- 数据权限过滤 ----
// admin：看所有数据；其他用户：按部门过滤
function filterStateByUser(state, user) {
  if (!state) return null;
  if (user.role === 'admin') return state;

  const s = JSON.parse(JSON.stringify(state));
  let viewDepts = [];
  try { viewDepts = JSON.parse(user.view_depts || '[]'); } catch {}

  // 自己的部门 + 被授权的部门（去重合并）
  const myDepts = new Set(viewDepts);
  if (user.department) myDepts.add(user.department);
  const myName = user.displayName || user.username;

  // applications：本人是顾问 OR 申请部门在授权部门中
  if (s.applications) {
    s.applications = s.applications.filter(a =>
      a.consultant === myName || myDepts.has(a.department)
    );
  }

  // 先收集可见的 oppNo（来自过滤后的 applications）
  const visibleOppNos = new Set((s.applications || []).map(a => a.oppNo).filter(Boolean));

  // contracts：通过 oppNo 关联到本人可见的申请
  if (s.contracts) {
    s.contracts = s.contracts.filter(c => visibleOppNos.has(c.oppNo));
  }

  // salesQuestions / judgments / followUps / allocations：通过 oppNo 关联到可见的 applications
  if (s.salesQuestions) s.salesQuestions = s.salesQuestions.filter(q => visibleOppNos.has(q.oppNo));
  if (s.judgments)     s.judgments     = s.judgments    .filter(j => visibleOppNos.has(j.oppNo));
  if (s.followUps)     s.followUps     = s.followUps    .filter(f => visibleOppNos.has(f.oppNo));
  if (s.allocations)   s.allocations   = s.allocations  .filter(a => visibleOppNos.has(a.oppNo));

  return s;
}


// PUT 时给没有 createdBy 的记录补上创建人
function injectCreatedBy(state, displayName) {
  if (!state) return state;
  if (state.applications) {
    state.applications.forEach(a => { if (!a.createdBy) a.createdBy = displayName; });
  }
  return state;
}

// ---- App ----
const app = express();
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

const session = require('express-session');
app.use(session({
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 7 * 24 * 60 * 60 * 1000, httpOnly: true, sameSite: 'lax' }
}));

app.use(express.static(path.join(__dirname, 'public'), {
  setHeaders(res, filePath) {
    if (filePath.endsWith('.html')) {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    }
  }
}));

// ---- Auth 中间件 ----
function requireAuth(req, res, next) {
  if (!req.session || !req.session.userId) return res.status(401).json({ error: '请先登录' });
  next();
}
function requireAdmin(req, res, next) {
  if (!req.session || req.session.role !== 'admin') return res.status(403).json({ error: '需要管理员权限' });
  next();
}

// ---- 公开接口 ----

// 临时调试端点
app.get('/api/debug/state', (req, res) => {
  const row = getStateRow();
  if (!row) return res.json({ error: 'no row' });
  try {
    const state = JSON.parse(row.data);
    res.json({ apps: state.applications.length, updated_at: row.updated_at, keys: Object.keys(state) });
  } catch(e) {
    res.json({ error: e.message });
  }
});

app.get('/api/health', (req, res) => {
  const row = getStateRow();
  res.json({ ok: true, hasData: !!row, updatedAt: row ? row.updated_at : null });
});

app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: '用户名和密码不能为空' });
  const r = db.exec("SELECT * FROM users WHERE username = '" + username.replace(/'/g, "''") + "'");
  if (!r.length || !r[0].values.length) return res.status(401).json({ error: '用户名或密码错误' });
  const cols = r[0].columns;
  const user = {};
  cols.forEach((c, i) => user[c] = r[0].values[0][i]);
  const bcrypt = require('bcryptjs');
  if (!bcrypt.compareSync(password, user.password_hash)) return res.status(401).json({ error: '用户名或密码错误' });
  req.session.userId = user.id;
  req.session.username = user.username;
  req.session.displayName = user.display_name;
  req.session.role = user.role;
  req.session.department = user.department || '';
  req.session.viewDepts = user.view_depts || '[]';
  res.json({
    ok: true,
    username: user.username,
    displayName: user.display_name,
    role: user.role,
    department: user.department || '',
    viewDepts: (() => { try { return JSON.parse(user.view_depts || '[]'); } catch { return []; } })()
  });
});

app.post('/api/auth/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

app.get('/api/auth/me', (req, res) => {
  if (!req.session || !req.session.userId) return res.json({ loggedIn: false });
  res.json({
    loggedIn: true,
    userId: req.session.userId,
    username: req.session.username,
    displayName: req.session.displayName,
    role: req.session.role,
    department: req.session.department || '',
    viewDepts: (() => { try { return JSON.parse(req.session.viewDepts || '[]'); } catch { return []; } })()
  });
});

// ---- 需要登录的接口 ----
app.get('/api/state', requireAuth, (req, res) => {
  const result = getState();
  if (!result) return res.json({ state: null, updatedAt: null });
  const user = {
    role: req.session.role,
    displayName: req.session.displayName,
    username: req.session.username,
    department: req.session.department,
    view_depts: req.session.viewDepts || '[]'
  };
  const filtered = filterStateByUser(result.state, user);
  res.json({ state: filtered, updatedAt: result.updatedAt });
});

app.put('/api/state', requireAuth, (req, res) => {
  const body = req.body;
  if (!body || typeof body !== 'object' || !body.state) return res.status(400).json({ error: '请求体需要包含 state 对象' });
  // injectCreatedBy 在此处只补 createdBy，不做全量序列化
  const enriched = injectCreatedBy(body.state, req.session.displayName);
  try {
    const updatedAt = saveState(enriched);
    res.json({ ok: true, updatedAt });
  } catch (e) {
    console.error('保存失败:', e);
    res.status(500).json({ error: '保存失败: ' + e.message });
  }
});

app.get('/api/state/history', requireAuth, (req, res) => {
  const limit = Math.min(parseInt(req.query.limit || '50', 10), 200);
  const r = db.exec('SELECT id, created_at, length(data) AS size FROM app_state_history ORDER BY id DESC LIMIT ' + limit);
  if (!r.length) return res.json({ items: [] });
  const cols = r[0].columns;
  const items = r[0].values.map(row => {
    const item = {}; cols.forEach((c, i) => item[c] = row[i]); return item;
  });
  res.json({ items });
});

app.get('/api/state/history/:id', requireAuth, (req, res) => {
  const r = db.exec("SELECT data, created_at FROM app_state_history WHERE id = " + parseInt(req.params.id));
  if (!r.length || !r[0].values.length) return res.status(404).json({ error: '版本不存在' });
  res.json({ state: JSON.parse(r[0].values[0][0]), createdAt: r[0].values[0][1] });
});

// ---- 管理员接口 ----
app.get('/api/admin/users', requireAdmin, (req, res) => {
  const r = db.exec('SELECT id, username, display_name, role, department, view_depts, created_at FROM users ORDER BY id ASC');
  if (!r.length) return res.json({ users: [] });
  const cols = r[0].columns;
  const users = r[0].values.map(row => {
    const u = {}; cols.forEach((c, i) => u[c] = row[i]);
    try { u.view_depts = JSON.parse(u.view_depts || '[]'); } catch { u.view_depts = []; }
    return u;
  });
  res.json({ users });
});

app.post('/api/admin/users', requireAdmin, (req, res) => {
  const { username, password, displayName, role, department, viewDepts } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: '用户名和密码不能为空' });
  const safeName = username.replace(/'/g, "''");
  const existing = db.exec("SELECT id FROM users WHERE username = '" + safeName + "'");
  if (existing.length && existing[0].values.length) return res.status(409).json({ error: '用户名已存在' });
  const bcrypt = require('bcryptjs');
  const hash = bcrypt.hashSync(password, 10);
  const now = new Date().toISOString();
  db.run("INSERT INTO users (username, password_hash, display_name, role, department, view_depts, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    [username, hash, displayName || username, role || 'user', department || '', JSON.stringify(viewDepts || []), now]);
  saveDbs();
  res.json({ ok: true });
});

app.put('/api/admin/users/:id', requireAdmin, (req, res) => {
  const id = parseInt(req.params.id);
  const { password, displayName, role, department, viewDepts } = req.body || {};
  const existing = db.exec("SELECT id FROM users WHERE id = " + id);
  if (!existing.length || !existing[0].values.length) return res.status(404).json({ error: '用户不存在' });
  if (password) {
    const bcrypt = require('bcryptjs');
    const hash = bcrypt.hashSync(password, 10);
    db.run("UPDATE users SET password_hash = ? WHERE id = ?", [hash, id]);
  }
  if (displayName !== undefined) db.run("UPDATE users SET display_name = ? WHERE id = ?", [displayName, id]);
  if (role !== undefined)         db.run("UPDATE users SET role = ? WHERE id = ?", [role, id]);
  if (department !== undefined)   db.run("UPDATE users SET department = ? WHERE id = ?", [department, id]);
  if (viewDepts !== undefined)    db.run("UPDATE users SET view_depts = ? WHERE id = ?", [JSON.stringify(viewDepts), id]);
  saveDbs();
  res.json({ ok: true });
});

// ---- 普通用户查看自己的账号信息 ----
app.get('/api/users/me-record', requireAuth, (req, res) => {
  const r = db.exec("SELECT id, username, display_name, role, department, view_depts, created_at FROM users WHERE id = " + req.session.userId);
  if (!r.length || !r[0].values.length) return res.status(404).json({ error: '用户不存在' });
  const row = r[0].values[0];
  const viewDepts = (() => { try { return JSON.parse(row[5] || '[]'); } catch { return []; } })();
  res.json({ users: [{ id: row[0], username: row[1], display_name: row[2], role: row[3], department: row[4], view_depts: viewDepts, created_at: row[6] }] });
});

// ---- 用户改自己的密码 ----
app.post('/api/auth/change-password', requireAuth, (req, res) => {
  const { oldPassword, newPassword } = req.body || {};
  if (!oldPassword || !newPassword) return res.status(400).json({ error: '旧密码和新密码都不能为空' });
  if (newPassword.length < 6) return res.status(400).json({ error: '新密码至少6位' });
  const r = db.exec('SELECT id, password_hash FROM users WHERE id = ' + req.session.userId);
  if (!r.length || !r[0].values.length) return res.status(404).json({ error: '用户不存在' });
  const bcrypt = require('bcryptjs');
  if (!bcrypt.compareSync(oldPassword, r[0].values[0][1])) return res.status(403).json({ error: '旧密码错误' });
  const hash = bcrypt.hashSync(newPassword, 10);
  db.run('UPDATE users SET password_hash = ? WHERE id = ?', [hash, req.session.userId]);
  saveDbs();
  res.json({ ok: true });
});

app.delete('/api/admin/users/:id', requireAdmin, (req, res) => {
  const id = parseInt(req.params.id);
  if (id === req.session.userId) return res.status(400).json({ error: '不能删除自己' });
  const existing = db.exec("SELECT id FROM users WHERE id = " + id);
  if (!existing.length || !existing[0].values.length) return res.status(404).json({ error: '用户不存在' });
  db.run("DELETE FROM users WHERE id = ?", [id]);
  saveDbs();
  res.json({ ok: true });
});

// 部门列表（供前端渲染权限选择）
app.get('/api/admin/departments', requireAdmin, (req, res) => {
  const result = getState();
  const depts = result && result.state && result.state.departments ? result.state.departments : [];
  res.json({ departments: depts });
});


app.get('/api/admin/employees', requireAdmin, (req, res) => {
  const result = getState();
  const employees = result && result.state && result.state.employees ? result.state.employees : [];
  const departments = result && result.state && result.state.departments ? result.state.departments : [];
  const deptById = {};
  departments.forEach(d => { deptById[d.id] = d.name; });
  // 已有账号的用户名
  const existing = db.exec("SELECT username FROM users");
  const usedNames = new Set((existing[0]?.values || []).map(v => v[0]));
  // 只返回未创建账号的员工（过滤掉已创建账号的）
  const available = employees.filter(e => !usedNames.has(e.name)).map(e => ({
    name: e.name,
    empNo: e.empNo,
    position: e.position,
    deptId: e.deptId,
    deptName: deptById[e.deptId] || ''
  }));
  res.json({ employees: available });
});

// 错误处理
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: err.message });
});

// 启动
initDb().then(() => {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`\n🖥️  售前管理后端已启动: http://0.0.0.0:${PORT}`);
    console.log(`📁 数据库: ${DB_PATH}`);
    console.log(`🔐 默认管理员: admin / admin123 (请首次登录后修改密码)\n`);
  });
}).catch(e => {
  console.error('数据库初始化失败:', e);
  process.exit(1);
});
