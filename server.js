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
    CREATE TABLE IF NOT EXISTS user_targets (
      user_id INTEGER PRIMARY KEY,
      annual_targets TEXT NOT NULL DEFAULT '{}',
      annual_actuals TEXT NOT NULL DEFAULT '{}',
      quarter_targets TEXT NOT NULL DEFAULT '{}',
      quarter_pcts TEXT NOT NULL DEFAULT '{}',
      updated_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );
  `);

  // 兼容旧数据库：view_depts 列不存在时添加
  try { db.run("ALTER TABLE users ADD COLUMN view_depts TEXT NOT NULL DEFAULT '[]'"); } catch(e) { /* 列已存在 */ }
  // 兼容旧数据库：user_targets 表不存在时添加（首次启动已用 CREATE TABLE IF NOT EXISTS，这里只做兜底）
  try { db.run("ALTER TABLE user_targets ADD COLUMN quarter_targets TEXT NOT NULL DEFAULT '{}'"); } catch(e) {}
  try { db.run("ALTER TABLE user_targets ADD COLUMN quarter_pcts TEXT NOT NULL DEFAULT '{}'"); } catch(e) {}

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
    for (const key of ['annualTarget','annualTargets','annualActuals','quarterTargets','quarterPcts','activeTab','year','quarter','month','weekNum','weekYear','weekStart','weekEnd','departments','employees','consultant','consultantAvatar']) {
      if (newState[key] !== undefined) merged[key] = newState[key];
    }
  } else {
    merged = newState;
  }
  // 从 merged 中移除本次删除的记录
  if (_deletedIds.applications) merged.applications = merged.applications.filter(a => !_deletedIds.applications.has(String(a.id)));
  if (_deletedIds.contracts) merged.contracts = merged.contracts.filter(c => !_deletedIds.contracts.has(String(c.id)));
  if (_deletedIds.allocations) merged.allocations = merged.allocations.filter(a => !_deletedIds.allocations.has(String(a.id)));
  if (_deletedIds.judgments) merged.judgments = merged.judgments.filter(j => !_deletedIds.judgments.has(String(j.id)));
  if (_deletedIds.followUps) merged.followUps = merged.followUps.filter(f => !_deletedIds.followUps.has(String(f.id)));
  if (_deletedIds.requirements) merged.requirements = merged.requirements.filter(r => !_deletedIds.requirements.has(String(r.id)));
  if (_deletedIds.salesQuestions) merged.salesQuestions = merged.salesQuestions.filter(q => !_deletedIds.salesQuestions.has(String(q.id)));
  // 清除本次记录
  for (const k in _deletedIds) delete _deletedIds[k];

  console.log("[saveState] merged.applications count:", merged.applications.length, " deletedIds:", JSON.stringify([...(_deletedIds.applications||[])]));
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

  // 收集 allocations 里本人作为支持顾问的所有 oppNo（不限部门）
  const myAllocOppNos = new Set(
    (s.allocations || [])
      .filter(a => a.consultant === myName && a.oppNo)
      .map(a => a.oppNo)
  );

  // 建立 consultant → 归属部门 映射（只用 employees.deptId，不从 applications 表覆盖）
  const deptById = {};
  (s.departments || []).forEach(d => { if (d.id && d.name) deptById[d.id] = d.name; });
  const consultantDepts = {};
  (s.employees || []).forEach(e => {
    if (e.name) consultantDepts[e.name] = deptById[e.deptId] || '';
  });

  // applications：本人是顾问 OR 本人参与的allocations OR 申请记录的首席顾问归属部门在授权范围内
  // view_depts 权限语义：能看到这些部门的顾问所负责的所有项目
  // consultantDepts 来自 employees.deptId（顾问的真实归属部门），不用申请记录的 a.department
  if (s.applications) {
    s.applications = s.applications.filter(a => {
      if (a.consultant === myName) return true;
      if (myAllocOppNos.has(a.oppNo)) return true;
      if (myDepts.size === 0) return false;
      // 用顾问归属部门（来自 employees 表）判断，不依赖申请记录的 department 字段
      const homeDept = consultantDepts[a.consultant] || '';
      if (homeDept && myDepts.has(homeDept)) return true;
      // 父部门覆盖子部门：若 view_depts 包含某父部门，则子部门下的顾问也放行
      for (const vd of myDepts) {
        // 找 homeDept 的所有祖先部门
        let cur = homeDept;
        while (cur) {
          if (cur === vd) return true;
          const parentId = Object.entries(deptById).find(([, name]) => name === cur)?.[0];
          if (!parentId) break;
          const parentEntry = (s.departments || []).find(d => d.id === parentId);
          cur = parentEntry ? (deptById[parentEntry.pid] || '') : '';
        }
      }
      return false;
    });
  }

  // 先收集可见的 oppNo（来自过滤后的 applications）
  const visibleOppNos = new Set((s.applications || []).map(a => a.oppNo).filter(Boolean));

  // contracts：通过 oppNo 关联到本人可见的申请 + 本人是客户经理的记录
  if (s.contracts) {
    s.contracts = s.contracts.filter(c =>
      visibleOppNos.has(c.oppNo) || c.accountMgr === myName
    );
  }

  // salesQuestions / judgments / followUps / allocations：
  // 通过 oppNo 关联到可见的 applications + 本人是顾问/客户经理的记录
  if (s.salesQuestions) {
    s.salesQuestions = s.salesQuestions.filter(q =>
      visibleOppNos.has(q.oppNo) || q.consultant === myName || q.answerBy === myName
    );
  }
  if (s.judgments) {
    s.judgments = s.judgments.filter(j =>
      visibleOppNos.has(j.oppNo) || j.consultant === myName
    );
  }
  if (s.followUps) {
    s.followUps = s.followUps.filter(f =>
      visibleOppNos.has(f.oppNo) || f.consultant === myName
    );
  }
  if (s.allocations) {
    s.allocations = s.allocations.filter(a =>
      visibleOppNos.has(a.oppNo) || a.consultant === myName
    );
  }

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
app.set('trust proxy', 1);
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

  // 读取当前用户的个人指标（合并到 state 中返回）
  let userTargets = { annualTargets: {}, annualActuals: {}, quarterTargets: {}, quarterPcts: {} };
  try {
    const ut = db.exec('SELECT annual_targets, annual_actuals, quarter_targets, quarter_pcts FROM user_targets WHERE user_id = ' + req.session.userId);
    if (ut.length && ut[0].values.length) {
      userTargets = {
        annualTargets: JSON.parse(ut[0].values[0][0] || '{}'),
        annualActuals: JSON.parse(ut[0].values[0][1] || '{}'),
        quarterTargets: JSON.parse(ut[0].values[0][2] || '{}'),
        quarterPcts: JSON.parse(ut[0].values[0][3] || '{}')
      };
    }
  } catch(e) {}

  // 用个人指标覆盖 state 中的全局指标（个人优先）
  const merged = JSON.parse(JSON.stringify(filtered));
  merged.annualTargets = userTargets.annualTargets;
  merged.annualActuals = userTargets.annualActuals;
  merged.quarterPcts = userTargets.quarterPcts;

  // 动态计算 quarterTargets：annualTargets[year] × quarterPcts[pct]
  const year = merged.year || new Date().getFullYear();
  const annualTarget = parseFloat(merged.annualTargets && merged.annualTargets[year]) || parseFloat(merged.annualTarget) || 0;
  const quarterPcts = (merged.quarterPcts && Object.keys(merged.quarterPcts).length > 0) ? merged.quarterPcts : { Q1: 25, Q2: 25, Q3: 25, Q4: 25 };
  const computedQuarterTargets = {};
  ['Q1','Q2','Q3','Q4'].forEach(function(q) {
    computedQuarterTargets[q] = Math.round(annualTarget * (parseFloat(quarterPcts[q]) || 0) / 100 * 100) / 100;
  });
  // 优先用个人存储的 quarterTargets（允许用户手动覆盖），否则用动态计算值
  merged.quarterTargets = userTargets.quarterTargets && Object.keys(userTargets.quarterTargets).length > 0
    ? userTargets.quarterTargets
    : computedQuarterTargets;

  // 动态计算 quarterActuals：从 contracts 按季度汇总 presalePerformance
  const qMonths = { Q1: [1,2,3], Q2: [4,5,6], Q3: [7,8,9], Q4: [10,11,12] };
  const computedQuarterActuals = { Q1: 0, Q2: 0, Q3: 0, Q4: 0 };
  (merged.contracts || []).forEach(function(c) {
    const sd = c.mainSignDate ? new Date(c.mainSignDate) : (c.signDate ? new Date(c.signDate) : null);
    if (!sd || isNaN(sd.getTime())) return;
    if (sd.getFullYear() !== year) return;
    const m = sd.getMonth() + 1;
    const q = Object.keys(qMonths).find(function(q) { return qMonths[q].includes(m); });
    if (q) {
      computedQuarterActuals[q] += (parseFloat(c.presalePerformance) || 0);
    }
  });
  Object.keys(computedQuarterActuals).forEach(function(q) {
    computedQuarterActuals[q] = Math.round(computedQuarterActuals[q] / 10000 * 100) / 100;
  });
  merged.quarterActuals = computedQuarterActuals;

  // 动态计算 deptSupportTargets（各部门的签单+支撑业绩汇总）
  const computedDeptSupport = {};
  (merged.allocations || []).forEach(function(al) {
    var did = al.deptId;
    var deptName = al.department || '未知部门';
    if (!computedDeptSupport[did]) {
      computedDeptSupport[did] = { deptId: did, department: deptName, newSignAmount: 0, subAmount: 0, presalePerf: 0 };
    }
    computedDeptSupport[did].presalePerf += (parseFloat(al.presalePerformance) || 0);
    computedDeptSupport[did].subAmount += (parseFloat(al.subscriptionPerformance) || 0);
  });
  merged.deptSupportTargets = computedDeptSupport;

  res.json({ state: merged, updatedAt: result.updatedAt });
});

app.put('/api/state', requireAuth, (req, res) => {
  console.log('[DEBUG apiPutState] body.state.quarter:', req.body?.state?.quarter, 'year:', req.body?.state?.year);
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

// 保存当前用户的个人指标（年度指标/季度指标）
app.put('/api/user/targets', requireAuth, (req, res) => {
  const { annualTargets, annualActuals, quarterTargets, quarterPcts } = req.body || {};
  const now = new Date().toISOString();
  try {
    db.run(`INSERT INTO user_targets (user_id, annual_targets, annual_actuals, quarter_targets, quarter_pcts, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET
        annual_targets = excluded.annual_targets,
        annual_actuals = excluded.annual_actuals,
        quarter_targets = excluded.quarter_targets,
        quarter_pcts = excluded.quarter_pcts,
        updated_at = excluded.updated_at`,
      [
        req.session.userId,
        JSON.stringify(annualTargets || {}),
        JSON.stringify(annualActuals || {}),
        JSON.stringify(quarterTargets || {}),
        JSON.stringify(quarterPcts || {}),
        now
      ]
    );
    saveDbs();
    res.json({ ok: true, updatedAt: now });
  } catch (e) {
    console.error('保存用户指标失败:', e);
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
app.get('/api/admin/users', requireAuth, (req, res) => {
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

// 重置/修改密码（本人或管理员可调用）
app.put('/api/admin/users/:id/password', requireAuth, (req, res) => {
  const id = parseInt(req.params.id);
  const { password } = req.body || {};
  if (!password || password.length < 6) return res.status(400).json({ error: '密码至少6位' });
  // 非管理员只能修改自己的密码
  if (req.session.role !== 'admin' && req.session.userId !== id) return res.status(403).json({ error: '无权限' });
  const existing = db.exec("SELECT id FROM users WHERE id = " + id);
  if (!existing.length || !existing[0].values.length) return res.status(404).json({ error: '用户不存在' });
  const bcrypt = require('bcryptjs');
  const hash = bcrypt.hashSync(password, 10);
  db.run("UPDATE users SET password_hash = ? WHERE id = ?", [hash, id]);
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
app.get('/api/admin/departments', requireAuth, (req, res) => {
  const result = getState();
  const depts = result && result.state && result.state.departments ? result.state.departments : [];
  res.json({ departments: depts });
});


app.get('/api/admin/employees', requireAuth, (req, res) => {
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


// ---- 顾问信息（个人配置）----
app.put('/api/consultant', requireAuth, (req, res) => {
  const { consultant, consultantAvatar } = req.body || {};
  const existing = getStateRow();
  let state = existing ? JSON.parse(existing.data) : {};
  state.consultant = (consultant || '').trim();
  state.consultantAvatar = consultantAvatar || '';
  const updatedAt = saveState(state);
  res.json({ ok: true, updatedAt });
});

app.get('/api/consultant', requireAuth, (req, res) => {
  const existing = getStateRow();
  if (!existing) return res.json({ consultant: '', consultantAvatar: '' });
  try {
    const state = JSON.parse(existing.data);
    res.json({ consultant: state.consultant || '', consultantAvatar: state.consultantAvatar || '' });
  } catch(e) {
    res.json({ consultant: '', consultantAvatar: '' });
  }
});

// 各模块单条 CRUD 路由（实时保存）
const MODULE_KEYS = ['applications','contracts','judgments','salesQuestions','followUps','allocations'];

function checkModuleOwnership(record, session) {
  if (session.role === 'admin') return true;
  const myName = session.displayName || session.username;
  // 本人负责的记录可删
  if (record.consultant === myName) return true;
  // 部门级授权用户可删本部门所有顾问的记录
  var viewDepts = [];
  try { viewDepts = JSON.parse(session.viewDepts || '[]'); } catch(e) {}
  if (viewDepts.length > 0) {
    // 查询该顾问的归属部门是否在 viewDepts 中
    var allState = getState().state;
    var emp = (allState.employees || []).find(function(e) { return e.name === record.consultant; });
    if (emp && emp.department && viewDepts.includes(emp.department)) return true;
  }
  return false;
}

// 记录本次操作中删除的 record id，按 module 分组
const _deletedIds = {}; // { applications: Set(['id1','id2']), contracts: Set([...]) }

function moduleOp(key, action, record, session) {
  if (!MODULE_KEYS.includes(key)) return { error: '不支持的模块: ' + key };
  const state = getState().state;
  const arr = state[key] || [];
  const now = new Date().toISOString();
  if (action === 'create') {
    if (!record.id) record.id = Date.now();
    record.consultant = record.consultant || session.displayName || session.username;
    record.createdAt = now;
    record.updatedAt = now;
    while (arr.find(r => r.id === record.id)) record.id++;
    arr.push(record);
    state[key] = arr;
    const updatedAt = saveState(state);
    return { ok: true, record, updatedAt };
  }
  if (action === 'update') {
    const idx = arr.findIndex(r => r.id === record.id);
    if (idx < 0) return { error: '记录不存在' };
    if (!checkModuleOwnership(arr[idx], session)) return { error: '无权限修改此记录' };
    record.consultant = arr[idx].consultant;
    record.id = arr[idx].id;
    record.createdAt = arr[idx].createdAt;
    record.updatedAt = now;
    arr[idx] = record;
    state[key] = arr;
    const updatedAt = saveState(state);
    return { ok: true, record, updatedAt };
  }
  if (action === 'delete') {
    // id 可能是字符串或整数，统一转为字符串比较
    var delId = String(record.id);
    console.log('[delete] key=' + key + ' delId=' + delId + ' arr.length=' + arr.length + ' session=' + (session.username || '') + ' firstId=' + (arr.length > 0 ? String(arr[0].id) : 'none'));
    if (!delId) return { error: '无效的记录ID' };
    var idx = arr.findIndex(function(r) { return String(r.id) === delId; });
    console.log('[delete] idx=' + idx + ' record.consultant=' + (idx >= 0 ? arr[idx].consultant : 'n/a'));
    if (idx < 0) return { error: '记录不存在' };
    var own = checkModuleOwnership(arr[idx], session);
    // contracts/allocations 没有 consultant 字段，通过 oppNo 找对应 application 的顾问来判断
    if (!own) {
      var myName = session.displayName || session.username;
      // allocations 有自己的 consultant 字段，直接比对
      if (key === 'allocations' && arr[idx].consultant === myName) {
        own = true;
      }
      // 其他模块（judgments/followUps/contracts/allocations）通过 oppNo 找对应 application 的顾问
      if (!own) {
        var oppNoStr = arr[idx].oppNo || '';
        var firstOpp = oppNoStr.split('、')[0].trim();
        var app = state.applications.find(function(a) { return a.oppNo === firstOpp; });
        if (app && app.consultant === myName) own = true;
      }
    }
    console.log('[delete] checkModuleOwnership=' + own);
    if (!own) return { error: '无权限删除此记录' };
    // 级联删除：applications 删时同步删关联合同/业绩分配；contracts 删时同步删业绩分配；其他软删除
    var oppNo = null;
    if (key === 'applications' || key === 'contracts') {
      var app = arr[idx];
      oppNo = app.oppNo;
    }
    if (key === 'applications') {
      // 级联删除：合同、业绩分配、销售十二条、顾问判断、项目跟进
      state.contracts = (state.contracts || []).filter(function(c) { return c.oppNo !== oppNo; });
      state.allocations = (state.allocations || []).filter(function(a) { return a.oppNo !== oppNo; });
      state.salesQuestions = (state.salesQuestions || []).filter(function(q) { return q.oppNo !== oppNo; });
      state.judgments = (state.judgments || []).filter(function(j) { return j.oppNo !== oppNo; });
      state.followUps = (state.followUps || []).filter(function(f) { return f.oppNo !== oppNo; });
      arr.splice(idx, 1);
      if (!_deletedIds[key]) _deletedIds[key] = new Set();
      _deletedIds[key].add(delId);
    } else if (key === 'contracts') {
      // 级联删除：业绩分配（通过 contractId）
      state.allocations = (state.allocations || []).filter(function(a) { return String(a.contractId) !== delId; });
      state.allocations = (state.allocations || []).filter(function(a) { return String(a.contractId) !== delId; });
      arr.splice(idx, 1);
      if (!_deletedIds[key]) _deletedIds[key] = new Set();
      _deletedIds[key].add(delId);
    } else if (key === 'allocations') {
      // allocations 用 splice 真删
      arr.splice(idx, 1);
      if (!_deletedIds[key]) _deletedIds[key] = new Set();
      _deletedIds[key].add(delId);
    } else {
      // judgments/followUps/requirements/salesQuestions：软删，加到_deletedIds排除
      arr[idx] = { ...arr[idx], deleted: true, updatedAt: now };
      if (!_deletedIds[key]) _deletedIds[key] = new Set();
      _deletedIds[key].add(delId);
    }
    state[key] = arr;
    const updatedAt = saveState(state);
    return { ok: true, updatedAt };
  }
  return { error: '未知操作: ' + action };
}

app.post('/api/modules/:module', requireAuth, (req, res) => {
  const key = req.params.module;
  const record = req.body && typeof req.body === 'object' ? req.body : {};
  if (!record || !Object.keys(record).length) return res.status(400).json({ error: '需要 record 对象' });
  const result = moduleOp(key, 'create', record, req.session);
  if (result.error) return res.status(400).json({ error: result.error });
  res.json({ ok: true, record: result.record, updatedAt: result.updatedAt });
});

app.put('/api/modules/:module/:id', requireAuth, (req, res) => {
  const key = req.params.module;
  const id = req.params.id;
  const record = req.body && typeof req.body === 'object' ? req.body : {};
  record.id = id;
  const result = moduleOp(key, 'update', record, req.session);
  if (result.error) return res.status(400).json({ error: result.error });
  res.json({ ok: true, record: result.record, updatedAt: result.updatedAt });
});

app.delete('/api/modules/:module/:id', requireAuth, (req, res) => {
  const key = req.params.module;
  const id = req.params.id;
  console.log('[DELETE] key=' + key + ' id=' + id);
  const result = moduleOp(key, 'delete', { id }, req.session);
  console.log('[DELETE] result:', JSON.stringify(result));
  if (result.error) return res.status(400).json({ error: result.error });
  res.json({ ok: true, updatedAt: result.updatedAt });
});

// 部门 CRUD
app.post('/api/admin/departments', requireAuth, (req, res) => {
  const { name, pid } = req.body || {};
  if (!name || !name.trim()) return res.status(400).json({ error: '部门名称不能为空' });
  const state = getState().state;
  state.departments = state.departments || [];
  const newDept = { id: Date.now(), name: name.trim(), pid: pid || null };
  state.departments.push(newDept);
  const updatedAt = saveState(state);
  res.json({ ok: true, record: newDept, updatedAt });
});

app.put('/api/admin/departments/:id', requireAuth, (req, res) => {
  const id = parseInt(req.params.id);
  const { name, pid } = req.body || {};
  const state = getState().state;
  const idx = (state.departments || []).findIndex(d => d.id === id);
  if (idx < 0) return res.status(404).json({ error: '部门不存在' });
  if (name) state.departments[idx].name = name.trim();
  if (pid !== undefined) state.departments[idx].pid = pid;
  const updatedAt = saveState(state);
  res.json({ ok: true, record: state.departments[idx], updatedAt });
});

app.delete('/api/admin/departments/:id', requireAuth, (req, res) => {
  const id = parseInt(req.params.id);
  const state = getState().state;
  state.departments = state.departments || [];
  var toDel = [id];
  var changed = true;
  while (changed) {
    changed = false;
    state.departments.forEach(d => { if (toDel.indexOf(d.pid) >= 0 && toDel.indexOf(d.id) < 0) { toDel.push(d.id); changed = true; } });
  }
  state.departments = state.departments.filter(d => toDel.indexOf(d.id) < 0);
  (state.employees || []).forEach(e => { if (toDel.indexOf(e.deptId) >= 0) e.deptId = null; });
  const updatedAt = saveState(state);
  res.json({ ok: true, updatedAt });
});

// 员工 CRUD
app.post('/api/admin/employees', requireAuth, (req, res) => {
  const { empNo, name, position, deptId } = req.body || {};
  if (!empNo || !name) return res.status(400).json({ error: '工号和姓名不能为空' });
  const state = getState().state;
  state.employees = state.employees || [];
  const newEmp = { id: Date.now(), empNo, name, position: position || '', deptId: deptId || null };
  state.employees.push(newEmp);
  const updatedAt = saveState(state);
  res.json({ ok: true, record: newEmp, updatedAt });
});

app.put('/api/admin/employees/:id', requireAuth, (req, res) => {
  const id = parseInt(req.params.id);
  const { empNo, name, position, deptId } = req.body || {};
  const state = getState().state;
  const idx = (state.employees || []).findIndex(e => e.id === id);
  if (idx < 0) return res.status(404).json({ error: '员工不存在' });
  if (empNo) state.employees[idx].empNo = empNo;
  if (name) state.employees[idx].name = name;
  if (position !== undefined) state.employees[idx].position = position;
  if (deptId !== undefined) state.employees[idx].deptId = deptId;
  const updatedAt = saveState(state);
  res.json({ ok: true, record: state.employees[idx], updatedAt });
});

app.delete('/api/admin/employees/:id', requireAuth, (req, res) => {
  const id = parseInt(req.params.id);
  const state = getState().state;
  state.employees = (state.employees || []).filter(e => e.id !== id);
  const updatedAt = saveState(state);
  res.json({ ok: true, updatedAt });
});


// ---- 看板 Dashboard API (admin only) ----

// Helper: get quarter from month (1-based)
function getQuarter(month) {
  if (month <= 3) return 'Q1';
  if (month <= 6) return 'Q2';
  if (month <= 9) return 'Q3';
  return 'Q4';
}

// GET /api/dashboard/stats - top-level project stats
app.get('/api/dashboard/stats', requireAdmin, (req, res) => {
  const result = getState();
  if (!result) return res.json({ total: 0, won: 0, lost: 0, totalAmount: 0, wonAmount: 0 });
  const state = result.state;
  const now = new Date();
  const year = parseInt(req.query.year) || now.getFullYear();
  const quarter = req.query.quarter || null; // 'Q1'-'Q4' or null for full year
  const month = req.query.month !== undefined ? parseInt(req.query.month) : null;

  let apps = state.applications || [];
  let contracts = state.contracts || [];

  // Filter by period
  if (year) {
    apps = apps.filter(a => {
      const d = new Date(a.applyDate);
      return d.getFullYear() === year;
    });
    const yearContracts = (state.contracts || []).filter(c => {
      const sd = new Date(c.mainSignDate || c.signDate || 0);
      return sd.getFullYear() === year;
    });
    if (quarter) {
      const qNum = parseInt(quarter[1]);
      apps = apps.filter(a => {
        const d = new Date(a.applyDate);
        const q = getQuarter(d.getMonth() + 1);
        return q === quarter;
      });
      const qMonths = { Q1: [1,2,3], Q2: [4,5,6], Q3: [7,8,9], Q4: [10,11,12] }[quarter] || [];
      contracts = yearContracts.filter(c => {
        const sd = new Date(c.mainSignDate || c.signDate || 0);
        return qMonths.includes(sd.getMonth() + 1);
      });
    } else if (month !== null) {
      apps = apps.filter(a => new Date(a.applyDate).getMonth() + 1 === month);
      contracts = yearContracts.filter(c => {
        const sd = new Date(c.mainSignDate || c.signDate || 0);
        return sd.getMonth() + 1 === month;
      });
    } else {
      contracts = yearContracts;
    }
  }

  const won = apps.filter(a => a.status === '签单').length;
  const lost = apps.filter(a => a.status === '丢失').length;
  const totalAmount = contracts.reduce((s, c) => s + (parseFloat(c.subAmount) || 0), 0) / 10000;
  const wonAmount = contracts.reduce((s, c) => s + (parseFloat(c.presalePerformance) || 0), 0) / 10000;

  res.json({
    total: apps.length,
    won,
    lost,
    totalAmount: Math.round(totalAmount * 100) / 100,
    wonAmount: Math.round(wonAmount * 100) / 100
  });
});

// GET /api/dashboard/annual - annual targets vs actuals (2023-2026)
app.get('/api/dashboard/annual', requireAdmin, (req, res) => {
  const result = getState();
  if (!result) return res.json({ years: [] });
  const state = result.state;
  const contracts = state.contracts || [];
  const years = [2023, 2024, 2025, 2026];
  const currentYear = new Date().getFullYear();

  const data = years.map(year => {
    const yearContracts = contracts.filter(c => {
      const sd = new Date(c.mainSignDate || c.signDate || 0);
      return sd.getFullYear() === year;
    });
    const actual = yearContracts.reduce((s, c) => s + (parseFloat(c.presalePerformance) || 0), 0) / 10000;
    const target = parseFloat(state.annualTargets && state.annualTargets[year]) || 0;
    const completion = target > 0 ? Math.round(actual / target * 1000) / 10 : 0;
    return {
      year,
      target: Math.round(target * 100) / 100,
      actual: Math.round(actual * 100) / 100,
      completion: Math.round(completion * 10) / 10
    };
  });

  res.json({ years: data, currentYear });
});

// GET /api/dashboard/quarter - quarterly breakdown for a given year (default current year)
app.get('/api/dashboard/quarter', requireAdmin, (req, res) => {
  const result = getState();
  if (!result) return res.json({ quarters: [] });
  const state = result.state;
  const contracts = state.contracts || [];
  const year = parseInt(req.query.year) || new Date().getFullYear();
  const annualTarget = parseFloat(state.annualTargets && state.annualTargets[year]) || 0;
  const quarterPcts = state.quarterPcts || { Q1: 16, Q2: 27, Q3: 23, Q4: 34 };
  const currentQuarter = getQuarter(new Date().getMonth() + 1);

  const quarters = ['Q1', 'Q2', 'Q3', 'Q4'].map(q => {
    const qNum = parseInt(q[1]);
    const qMonths = { Q1: [1,2,3], Q2: [4,5,6], Q3: [7,8,9], Q4: [10,11,12] }[q];
    const qContracts = contracts.filter(c => {
      const sd = new Date(c.mainSignDate || c.signDate || 0);
      return sd.getFullYear() === year && qMonths.includes(sd.getMonth() + 1);
    });
    const actual = qContracts.reduce((s, c) => s + (parseFloat(c.presalePerformance) || 0), 0) / 10000;
    const pct = parseFloat(quarterPcts[q]) || 0;
    const target = annualTarget * pct / 100;
    const completion = target > 0 ? Math.round(actual / target * 1000) / 10 : 0;
    return {
      quarter: q,
      pct,
      target: Math.round(target * 100) / 100,
      actual: Math.round(actual * 100) / 100,
      completion: Math.round(completion * 10) / 10
    };
  });

  res.json({ year, quarters, currentQuarter });
});

// GET /api/dashboard/cycles - win rate and sales cycle stats
app.get('/api/dashboard/cycles', requireAdmin, (req, res) => {
  const result = getState();
  if (!result) return res.json({ winRate: 0, avgCycle: 0, fastCount: 0, slowCount: 0, won: 0, lost: 0, total: 0 });
  const state = result.state;
  const apps = state.applications || [];
  const contracts = state.contracts || [];
  const year = parseInt(req.query.year) || new Date().getFullYear();

  // Filter apps by year
  const yearApps = apps.filter(a => {
    const d = new Date(a.applyDate);
    return d.getFullYear() === year;
  });

  const wonApps = yearApps.filter(a => a.status === '签单');
  const lostApps = yearApps.filter(a => a.status === '丢失');
  const total = wonApps.length + lostApps.length;
  const winRate = total > 0 ? Math.round(wonApps.length / total * 1000) / 10 : 0;

  // Find won contracts to calculate cycle
  // Build a map of oppNo → app for quick lookup (split multi-oppNos)
  const appMap = {};
  wonApps.forEach(a => {
    if (!a.oppNo) return;
    a.oppNo.split('、').forEach(n => { appMap[n.trim()] = a; });
  });
  // Match contracts where any of their oppNo appears in wonApps
  const wonSignedContracts = contracts.filter(c => {
    if (!c.oppNo) return false;
    return c.oppNo.split('、').some(n => appMap[n.trim()]);
  });

  let avgCycle = 0, fastCount = 0, slowCount = 0;
  if (wonSignedContracts.length > 0) {
    let totalDays = 0;
    let fast = 0, slow = 0;
    wonSignedContracts.forEach(c => {
      // Find any matching app (try each oppNo in the contract)
      const appOppNos = c.oppNo ? c.oppNo.split('、').map(n => n.trim()) : [];
      let app = null;
      for (const n of appOppNos) { if (appMap[n]) { app = appMap[n]; break; } }
      if (!app || !app.applyDate || (!c.mainSignDate && !c.signDate)) return;
      const days = Math.round((new Date(c.mainSignDate || c.signDate) - new Date(app.applyDate)) / 86400000);
      totalDays += days;
      if (days <= 30) fast++;
      if (days > 90) slow++;
    });
    avgCycle = wonSignedContracts.length > 0 ? Math.round(totalDays / wonSignedContracts.length * 10) / 10 : 0;
    fastCount = fast;
    slowCount = slow;
  }

  res.json({
    winRate,
    avgCycle,
    fastCount,
    slowCount,
    won: wonApps.length,
    lost: lostApps.length,
    total
  });
});

// GET /api/dashboard/products - product dimension stats
app.get('/api/dashboard/products', requireAdmin, (req, res) => {
  const result = getState();
  if (!result) return res.json({ products: [] });
  const state = result.state;
  const contracts = state.contracts || [];
  const year = parseInt(req.query.year) || new Date().getFullYear();

  const yearContracts = contracts.filter(c => {
    const sd = new Date(c.mainSignDate || c.signDate || 0);
    return sd.getFullYear() === year;
  });

  const productMap = {};
  yearContracts.forEach(c => {
    const product = c.product || '未知';
    if (!productMap[product]) productMap[product] = { count: 0, amount: 0 };
    productMap[product].count++;
    productMap[product].amount += (parseFloat(c.subAmount) || 0) / 10000;
  });

  const products = Object.entries(productMap).map(([name, data]) => ({
    name,
    count: data.count,
    amount: Math.round(data.amount * 100) / 100
  })).sort((a, b) => b.amount - a.amount);

  res.json({ products });
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
