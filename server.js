// 售前管理 - 后端服务
// Node.js + Express + better-sqlite3 (原生 SQLite) + Session Auth
const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3210;
const SESSION_SECRET = process.env.SESSION_SECRET || 'presale-secret-2026-change-me';
const DATA_DIR = path.join(__dirname, 'data');
const DB_PATH = process.env.DB_PATH || path.join(DATA_DIR, 'presale.db');

// ---- 10万门槛常量：合同金额小于此值不计入售前绩效 ----
const PERFORMANCE_THRESHOLD = 100000; // 元
function presalePerfOrZero(c) {
  const sa = parseFloat(c.subAmount) || 0;
  return sa >= PERFORMANCE_THRESHOLD ? (parseFloat(c.presalePerformance) || 0) : 0;
}
function contractHasPerformance(c) {
  return (parseFloat(c.subAmount) || 0) >= PERFORMANCE_THRESHOLD;
}

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

// ---- better-sqlite3 数据库（同步原生 SQLite）----
let db;

function initDb() {
  const Database = require('better-sqlite3');
  let isNewDb = false;
  if (!fs.existsSync(DB_PATH)) {
    isNewDb = true;
  }

  db = new Database(DB_PATH);

  // 优化：使用 WAL 模式提升并发读写性能，崩溃恢复更安全
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');

  db.exec(`
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
    CREATE TABLE IF NOT EXISTS user_prefs (
      user_id INTEGER PRIMARY KEY,
      prefs TEXT NOT NULL DEFAULT '{}',
      updated_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );
  `);

  // 兼容旧数据库
  try { db.run("ALTER TABLE users ADD COLUMN view_depts TEXT NOT NULL DEFAULT '[]'"); } catch(e) { /* 列已存在 */ }
  try { db.run("ALTER TABLE user_targets ADD COLUMN quarter_targets TEXT NOT NULL DEFAULT '{}'"); } catch(e) {}
  try { db.run("ALTER TABLE user_targets ADD COLUMN quarter_pcts TEXT NOT NULL DEFAULT '{}'"); } catch(e) {}

  // 默认管理员
  const adminRow = db.prepare("SELECT id FROM users WHERE username = 'admin'").get();
  if (!adminRow) {
    const bcrypt = require('bcryptjs');
    const hash = bcrypt.hashSync('admin123', 10);
    const now = new Date().toISOString();
    db.prepare("INSERT INTO users (username, password_hash, display_name, role, department, view_depts, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run('admin', hash, '系统管理员', 'admin', '解决方案与项目经理部', '[]', now);
    console.log('✅ 默认管理员账号已创建: admin / admin123');
  }

  // 仅在新建数据库时初始化空状态
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
    db.prepare('INSERT INTO app_state (id, data, updated_at) VALUES (1, ?, ?)').run(JSON.stringify(emptyState), now);
    console.log('✅ 新建数据库已初始化空状态');
  }

  console.log('✅ 数据库初始化完成');
}

function saveDb() {
  if (!db) return;
  // better-sqlite3 默认同步写盘，WAL 模式保证原子性，崩溃安全
  // 无需额外操作，每次事务提交自动落盘
}

// 同步落盘：模块CRUD/状态保存后立即写盘。
// （此前的100ms防抖存在丢数据窗口：崩4盘或外部读库会拿到未落盘的旧快照）
const saveDbs = () => { saveDb(); };

function getStateRow() {
  const r = db.prepare('SELECT data, updated_at FROM app_state WHERE id = 1').get();
  if (!r) return null;
  return { data: r.data, updated_at: r.updated_at };
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
    // 全局配置字段：直接取新值（个人偏好/指标字段已在上游剥离，不进全局）
    for (const key of ['departments','employees','dataVersion']) {
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
  db.prepare('INSERT INTO app_state_history (data, created_at) VALUES (?, ?)').run(existing ? existing.data : '{}', now);
  db.prepare("UPDATE app_state SET data = ?, updated_at = ? WHERE id = 1").run(dataStr, now);
  saveDbs();
  return now;
}

// ---- 个人偏好（避免全局字段被最后保存者覆盖导致串扰） ----
// 这些字段以前存在全局 app_state 里，任何人的保存都会覆盖所有人的值（串头像/串期间）
const PER_USER_PREF_KEYS = ['consultant','consultantAvatar','year','quarter','month','weekNum','weekYear','weekStart','weekEnd','activeTab','filterDept','filterConsultant','selectedAppId'];
// 这些指标字段已迁移到 user_targets 表，全局 app_state 里不再保留
const PER_USER_TARGET_KEYS = ['annualTarget','annualTargets','annualActuals','quarterTargets','quarterPcts'];

function getUserPrefs(userId) {
  try {
    const r = db.prepare('SELECT prefs FROM user_prefs WHERE user_id = ?').get(parseInt(userId));
    if (r) return JSON.parse(r.prefs || '{}');
  } catch(e) {}
  return {};
}
function saveUserPrefs(userId, patch) {
  const cur = getUserPrefs(userId);
  const next = Object.assign({}, cur, patch);
  db.prepare(`INSERT INTO user_prefs (user_id, prefs, updated_at) VALUES (?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET prefs = excluded.prefs, updated_at = excluded.updated_at`)
    .run(parseInt(userId), JSON.stringify(next), new Date().toISOString());
  return next;
}

// ---- 签单状态服务端同步：合同增/改/删时自动翻转申请状态（与前端 updateAppSignStatusFromContract 同口径） ----
function syncAppSignStatus(state, oppNo, force) {
  if (!oppNo) return;
  const apps = (state.applications || []).filter(a => a.oppNo === oppNo);
  if (!apps.length) return;
  const cons = (state.contracts || []).filter(c => c.oppNo === oppNo);
  apps.forEach(a => {
    if (cons.length === 0) {
      // 无合同：
      // force=true（用户显式删除合同）——无条件回退活跃并清空签单金额/日期
      // force=undef（常规同步）——仅当无 signAmount（非手动/文件录入）时才回退，
      // 有 signAmount 的签单（个人文件同步来的合法状态）保持不变
      if (a.status === '签单' && (force || !(parseFloat(a.signAmount) > 0))) { a.status = '活跃'; a.signDate = ''; a.signAmount = ''; }
    } else {
      const totalAmt = cons.reduce((s, c) => s + (parseFloat(c.subAmount) || 0), 0);
      const dates = cons.map(c => c.mainSignDate).filter(Boolean).sort();
      a.status = '签单';
      a.signAmount = totalAmt.toFixed(2);
      if (dates[0]) a.signDate = dates[0];
    }
  });
  // 10万门槛：统计层过滤（getCardsAnnualActual 等），不再清零DB字段以保真源数据
}

// ---- 数据权限过滤 ----
// admin：看所有数据；其他用户：按部门过滤
function filterStateByUser(state, user) {
  if (!state) return null;
  if (user.role === 'admin') return state;

  const s = JSON.parse(JSON.stringify(state));
  let viewDepts = [];
  try { viewDepts = JSON.parse(user.view_depts || '[]'); } catch {}

  // 自己被授权的部门（仅 viewDepts 生效；本人部门不自动获得全部门可见权限）
  const myDepts = new Set(viewDepts);
  const myName = user.displayName || user.username;

  // 收集 allocations 里本人作为支持顾问的所有 oppNo（不再用于扩充申请可见性：
  // 按需求，普通用户只能看到售前顾问=自己的申请；但本人的分配记录本身仍对其可见，
  // 以保证个人实际业绩取数完整；同时用于扩充合同可见性：个人文件中合同可能
  // 录入在与他人共存分配的商机下，如明芳文件中的 OPP202512090157 合同）
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

  // 权限规则：
  // - admin：看所有数据
  // - 普通顾问（无部门授权）：只看售前顾问=自己的申请（与单机版文件一致）
  // - 部门授权用户（viewDepts 非空）：额外可见授权部门（含子部门）顾问名下的全部申请
  if (s.applications) {
    if (myDepts.size === 0) {
      s.applications = s.applications.filter(a => a.consultant === myName);
    } else {
      s.applications = s.applications.filter(a => {
        if (a.consultant === myName) return true;
        // 按顾问归属部门（employees.deptId）判断，支持父部门覆盖子部门
        const homeDept = consultantDepts[a.consultant] || '';
        if (homeDept && myDepts.has(homeDept)) return true;
        for (const vd of myDepts) {
          // 找 homeDept 的所有祖先部门：若授权部门包含某祖先，则放行
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
  }

  // 先收集可见的 oppNo（来自过滤后的 applications）
  const visibleOppNos = new Set((s.applications || []).map(a => a.oppNo).filter(Boolean));

  // contracts：通过 oppNo 关联到本人可见的申请 + 本人是客户经理的记录 + 本人有业绩分配的商机（个人文件中合同可能录入在与他人共存的分配商机下）
  if (s.contracts) {
    s.contracts = s.contracts.filter(c =>
      visibleOppNos.has(c.oppNo) || c.accountMgr === myName || myAllocOppNos.has(c.oppNo)
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
    // 分配可见性：本人名下 + 本人参与分配的商机（共同分配合伙人可见，与个人文件口径一致；
    // 不按可见申请扩充，避免看到他人商机的全部分配）
    s.allocations = s.allocations.filter(a =>
      myAllocOppNos.has(a.oppNo) || a.consultant === myName
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
const FileStore = require('session-file-store')(session);
app.use(session({
  store: new FileStore({
    path: path.join(DATA_DIR, 'sessions'),
    ttl: 7 * 24 * 60 * 60, // 7 days in seconds
    retries: 2,
    secret: SESSION_SECRET
  }),
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 7 * 24 * 60 * 60 * 1000, httpOnly: true, sameSite: 'lax' }
}));

// ---- 根路径：User-Agent 自动识别移动端/PC端 ----

function isMobileDevice(req) {
  const ua = req.headers['user-agent'] || '';
  return /Android|iPhone|iPad|iPod|Mobile|microMessenger|WeChat|Windows Phone/i.test(ua);
}

app.get('/', (req, res) => {
  const ua = req.headers['user-agent'] || '';
  // 日志：方便调试
  console.log(`[${new Date().toISOString()}] / -> ${isMobileDevice(req) ? 'MOBILE' : 'PC'} | UA: ${ua.slice(0, 80)}`);
  if (isMobileDevice(req)) {
    res.sendFile(path.join(__dirname, 'public', 'mobile', 'index.html'));
  } else {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
  }
});

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
  const r = db.prepare("SELECT * FROM users WHERE username = ?").get(username);
  if (!r) return res.status(401).json({ error: '用户名或密码错误' });
  const user = r;
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
    const ut = db.prepare('SELECT annual_targets, annual_actuals, quarter_targets, quarter_pcts FROM user_targets WHERE user_id = ?').get(req.session.userId);
    if (ut) {
      userTargets = {
        annualTargets: JSON.parse(ut.annual_targets || '{}'),
        annualActuals: JSON.parse(ut.annual_actuals || '{}'),
        quarterTargets: JSON.parse(ut.quarter_targets || '{}'),
        quarterPcts: JSON.parse(ut.quarter_pcts || '{}')
      };
    }
  } catch(e) {}
  const merged = JSON.parse(JSON.stringify(filtered));
  merged.annualTargets = userTargets.annualTargets;
  merged.annualActuals = userTargets.annualActuals;
  merged.quarterPcts = userTargets.quarterPcts;

  // 注入个人偏好（头像/期间/页签等），彻底隔离全局字段串扰；
  // 无论全局 state 里残留什么旧值，这里一律用本人 prefs 或默认值覆盖
  const prefs = getUserPrefs(req.session.userId);
  merged.consultant = prefs.consultant || req.session.displayName || req.session.username || '';
  merged.consultantAvatar = prefs.consultantAvatar || '';
  merged.year = new Date().getFullYear();
  merged.quarter = prefs.quarter != null ? prefs.quarter : null;
  merged.month = prefs.month != null ? prefs.month : null;
  merged.weekNum = prefs.weekNum != null ? prefs.weekNum : null;
  merged.weekYear = prefs.weekYear != null ? prefs.weekYear : null;
  merged.weekStart = prefs.weekStart || '';
  merged.weekEnd = prefs.weekEnd || '';
  merged.activeTab = prefs.activeTab || 'q12';
  merged.filterDept = prefs.filterDept != null ? prefs.filterDept : null;
  merged.filterConsultant = prefs.filterConsultant != null ? prefs.filterConsultant : null;
  merged.selectedAppId = prefs.selectedAppId != null ? prefs.selectedAppId : null;

  // admin 视图为公司级：指标用全员个人指标合计（admin 个人无业务数据）
  if (req.session.role === 'admin') {
    const company = getCompanyTargets();
    merged.annualTargets = company;
    merged.annualTarget = parseFloat(company[merged.year]) || 0;
    merged.annualActuals = {}; // 公司实际由前端按全部业绩分配实时汇总
  } else {
    merged.annualTarget = parseFloat(userTargets.annualTargets && userTargets.annualTargets[merged.year]) || 0;
  }

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

  // quarterActuals 不再由服务端预算（旧口径从合同取全额，合个人实际不一致）。
  // 前端统一用 getScopeActualWan 实时取数：业绩分配优先，无分配时从合同取。
  merged.quarterActuals = { Q1: 0, Q2: 0, Q3: 0, Q4: 0 };

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

  res.json({ state: merged, updatedAt: result.updatedAt, user: user });
});

app.put('/api/state', requireAuth, (req, res) => {
  console.log('[DEBUG apiPutState] body.state.quarter:', req.body?.state?.quarter, 'year:', req.body?.state?.year);
  const body = req.body;
  if (!body || typeof body !== 'object' || !body.state) return res.status(400).json({ error: '请求体需要包含 state 对象' });
  // injectCreatedBy 在此处只补 createdBy，不做全量序列化
  const enriched = injectCreatedBy(body.state, req.session.displayName);
  // 个人偏好字段 → 存到 user_prefs（不再写入全局，防止串头像/串期间）
  const prefsPatch = {};
  PER_USER_PREF_KEYS.forEach(k => { if (enriched[k] !== undefined) prefsPatch[k] = enriched[k]; });
  if (Object.keys(prefsPatch).length) saveUserPrefs(req.session.userId, prefsPatch);
  // 指标字段已在 /api/user/targets 按人保存，从全局提交中剔除，防止覆盖他人
  PER_USER_TARGET_KEYS.forEach(k => { delete enriched[k]; });
  PER_USER_PREF_KEYS.forEach(k => { delete enriched[k]; });
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
    db.prepare(`INSERT INTO user_targets (user_id, annual_targets, annual_actuals, quarter_targets, quarter_pcts, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id) DO UPDATE SET
        annual_targets = excluded.annual_targets,
        annual_actuals = excluded.annual_actuals,
        quarter_targets = excluded.quarter_targets,
        quarter_pcts = excluded.quarter_pcts,
        updated_at = excluded.updated_at`)
      .run(
        req.session.userId,
        JSON.stringify(annualTargets || {}),
        JSON.stringify(annualActuals || {}),
        JSON.stringify(quarterTargets || {}),
        JSON.stringify(quarterPcts || {}),
        now
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
  const items = db.prepare('SELECT id, created_at, length(data) AS size FROM app_state_history ORDER BY id DESC LIMIT ?').all(limit);
  res.json({ items });
});

app.get('/api/state/history/:id', requireAuth, (req, res) => {
  const r = db.prepare("SELECT data, created_at FROM app_state_history WHERE id = ?").get(parseInt(req.params.id));
  if (!r) return res.status(404).json({ error: '版本不存在' });
  res.json({ state: JSON.parse(r.data), createdAt: r.created_at });
});

// ---- 管理员接口 ----
app.get('/api/admin/users', requireAuth, (req, res) => {
  const users = db.prepare('SELECT id, username, display_name, role, department, view_depts, created_at FROM users ORDER BY id ASC').all().map(v => ({id: v.id, username: v.username, display_name: v.display_name, role: v.role, department: v.department, view_depts: (() => { try { return JSON.parse(v.view_depts || '[]'); } catch { return []; } })(), created_at: v.created_at}));
  res.json({ users });
});

app.post('/api/admin/users', requireAdmin, (req, res) => {
  const { username, password, displayName, role, department, viewDepts } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: '用户名和密码不能为空' });
  const safeName = username.replace(/'/g, "''");
  const existing = db.prepare("SELECT id FROM users WHERE username = ?").get(safeName);
  if (existing) return res.status(409).json({ error: '用户名已存在' });
  const bcrypt = require('bcryptjs');
  const hash = bcrypt.hashSync(password, 10);
  const now = new Date().toISOString();
  db.prepare("INSERT INTO users (username, password_hash, display_name, role, department, view_depts, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .run(username, hash, displayName || username, role || 'user', department || '', JSON.stringify(viewDepts || []), now);
  saveDbs();
  res.json({ ok: true });
});

app.put('/api/admin/users/:id', requireAdmin, (req, res) => {
  const id = parseInt(req.params.id);
  const { password, displayName, role, department, viewDepts } = req.body || {};
  const existing = db.prepare("SELECT id FROM users WHERE id = ?").get(id);
  if (!existing) return res.status(404).json({ error: '用户不存在' });
  if (password) {
    const bcrypt = require('bcryptjs');
    const hash = bcrypt.hashSync(password, 10);
    db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(hash, id);
  }
  if (displayName !== undefined) db.prepare("UPDATE users SET display_name = ? WHERE id = ?").run(displayName, id);
  if (role !== undefined)         db.prepare("UPDATE users SET role = ? WHERE id = ?").run(role, id);
  if (department !== undefined)   db.prepare("UPDATE users SET department = ? WHERE id = ?").run(department, id);
  if (viewDepts !== undefined)    db.prepare("UPDATE users SET view_depts = ? WHERE id = ?").run(JSON.stringify(viewDepts), id);
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
  const existing = db.prepare("SELECT id FROM users WHERE id = ?").get(id);
  if (!existing) return res.status(404).json({ error: '用户不存在' });
  const bcrypt = require('bcryptjs');
  const hash = bcrypt.hashSync(password, 10);
  db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(hash, id);
  saveDbs();
  res.json({ ok: true });
});

// ---- 普通用户查看自己的账号信息 ----
app.get('/api/users/me-record', requireAuth, (req, res) => {
  const u = db.prepare("SELECT id, username, display_name, role, department, view_depts, created_at FROM users WHERE id = ?").get(req.session.userId);
  if (!u) return res.status(404).json({ error: '用户不存在' });
  const viewDepts = (() => { try { return JSON.parse(u.view_depts || '[]'); } catch { return []; } })();
  res.json({ users: [{ id: u.id, username: u.username, display_name: u.display_name, role: u.role, department: u.department, view_depts: viewDepts, created_at: u.created_at }] });
});

// ---- 用户修改自己的信息 ----
app.put('/api/users/me', requireAuth, (req, res) => {
  const { display_name, department } = req.body || {};
  if (display_name !== undefined) db.prepare("UPDATE users SET display_name = ? WHERE id = ?").run(display_name, req.session.userId);
  if (department !== undefined)     db.prepare("UPDATE users SET department = ? WHERE id = ?").run(department, req.session.userId);
  saveDbs();
  res.json({ ok: true });
});

// ---- 用户改自己的密码 ----
app.post('/api/auth/change-password', requireAuth, (req, res) => {
  const { oldPassword, newPassword } = req.body || {};
  if (!oldPassword || !newPassword) return res.status(400).json({ error: '旧密码和新密码都不能为空' });
  if (newPassword.length < 6) return res.status(400).json({ error: '新密码至少6位' });
  const r = db.prepare('SELECT id, password_hash FROM users WHERE id = ?').get(req.session.userId);
  if (!r) return res.status(404).json({ error: '用户不存在' });
  const bcrypt = require('bcryptjs');
  if (!bcrypt.compareSync(oldPassword, r.password_hash)) return res.status(403).json({ error: '旧密码错误' });
  const hash = bcrypt.hashSync(newPassword, 10);
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, req.session.userId);
  saveDbs();
  res.json({ ok: true });
});

app.delete('/api/admin/users/:id', requireAdmin, (req, res) => {
  const id = parseInt(req.params.id);
  if (id === req.session.userId) return res.status(400).json({ error: '不能删除自己' });
  const existing = db.prepare("SELECT id FROM users WHERE id = ?").get(id);
  if (!existing) return res.status(404).json({ error: '用户不存在' });
  db.prepare("DELETE FROM users WHERE id = ?").run(id);
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
  const existing = db.prepare("SELECT username FROM users").all();
  const usedNames = new Set(existing.map(v => v.username));
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


// ---- 顾问信息（个人配置，存 user_prefs，不再写全局） ----
app.put('/api/consultant', requireAuth, (req, res) => {
  const { consultant, consultantAvatar } = req.body || {};
  saveUserPrefs(req.session.userId, { consultant: (consultant || '').trim(), consultantAvatar: consultantAvatar || '' });
  saveDbs();
  res.json({ ok: true });
});

app.get('/api/consultant', requireAuth, (req, res) => {
  const prefs = getUserPrefs(req.session.userId);
  res.json({ consultant: prefs.consultant || '', consultantAvatar: prefs.consultantAvatar || '' });
});

// 各模块单条 CRUD 路由（实时保存）
const MODULE_KEYS = ['applications','contracts','judgments','salesQuestions','followUps','allocations'];

function checkModuleOwnership(record, session, state, key) {
  if (session.role === 'admin') return true;
  const myName = session.displayName || session.username;
  // 本人负责的记录可改/可删（applications、新建记录、allocations 的业绩归属人）
  if (record.consultant === myName) return true;
  var oppNoStr = record.oppNo || '';
  // 业绩分配：仅支持的售前顾问本人（consultant字段）、admin、部门授权用户可改；
  // 项目首席顾问（oppNo归属）不能改分配给别人的业绩
  if (key !== 'allocations' && oppNoStr) {
    // 导入的旧数据（contracts/judgments/followUps 等）无 consultant 字段：
    // 通过 oppNo 找对应申请的顾问判断归属（oppNo 可能是多个、用、分隔，取第一个）
    var firstOpp = oppNoStr.split('、')[0].trim();
    var app = (state.applications || []).find(function(a) { return a.oppNo === firstOpp; });
    if (app && app.consultant === myName) return true;
  }
  // 部门级授权用户可改/可删授权部门所有顾问的记录（含分配：归属顾问在其授权部门内）
  var viewDepts = [];
  try { viewDepts = JSON.parse(session.view_depts || '[]'); } catch(e) {}
  if (viewDepts.length > 0) {
    // 注意：employees 存的是 deptId（部门id），需经 departments 映射为部门名后再比对授权部门名
    var deptById = {};
    (state.departments || []).forEach(function(d) { if (d.id && d.name) deptById[d.id] = d.name; });
    var targetName = record.consultant;
    if (!targetName && oppNoStr && key !== 'allocations') {
      var fo = oppNoStr.split('、')[0].trim();
      var fa = (state.applications || []).find(function(a) { return a.oppNo === fo; });
      if (fa) targetName = fa.consultant;
    }
    if (targetName) {
      var emp = (state.employees || []).find(function(e) { return e.name === targetName; });
      if (emp && emp.deptId) {
        var deptName = deptById[emp.deptId];
        if (deptName && viewDepts.includes(deptName)) return true;
      }
    }
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
    // 合同新增：服务端同步翻转申请签单状态（防止绕过页面直接调API时状态不一致）
    if (key === 'contracts') syncAppSignStatus(state, record.oppNo);
    const updatedAt = saveState(state);
    return { ok: true, record, updatedAt };
  }
  if (action === 'update') {
    // id 可能是字符串或数字（URL参数恒为字符串），统一按字符串比较
    const idx = arr.findIndex(r => String(r.id) === String(record.id));
    if (idx < 0) return { error: '记录不存在' };
    if (!checkModuleOwnership(arr[idx], session, state, key)) return { error: '无权限修改此记录' };
    var oldOppNo = key === 'contracts' ? arr[idx].oppNo : null;
    record.consultant = arr[idx].consultant;
    record.id = arr[idx].id;
    record.createdAt = arr[idx].createdAt;
    record.updatedAt = now;
    arr[idx] = record;
    state[key] = arr;
    // 合同修改：新旧商机号都重新同步（商机号/金额/签订日期可能变化）
    if (key === 'contracts') { syncAppSignStatus(state, oldOppNo); syncAppSignStatus(state, record.oppNo); }
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
    // 归属校验：consultant 直配 + oppNo→申请归属 + 部门授权，与 update 同一套规则
    if (!checkModuleOwnership(arr[idx], session, state, key)) return { error: '无权限删除此记录' };
    // 级联删除：applications 删时同步删关联合同/业绩分配；contracts 删时同步删业绩分配；其他软删除
    var oppNo = null;
    if (key === 'applications' || key === 'contracts') {
      var app = arr[idx];
      oppNo = app.oppNo;
    }
    if (key === 'applications') {
      // 级联删除：合同、业绩分配、销售十二条、顾问判断、项目跟进
      // 重要：被级联删除的记录id必须登记到 _deletedIds，否则 saveState 的按id合并会从库副本中"复活"它们
      var cascaded = { contracts: [], allocations: [], salesQuestions: [], judgments: [], followUps: [] };
      state.contracts = (state.contracts || []).filter(function(c) { if (c.oppNo === oppNo) { cascaded.contracts.push(String(c.id)); return false; } return true; });
      state.allocations = (state.allocations || []).filter(function(a) { if (a.oppNo === oppNo) { cascaded.allocations.push(String(a.id)); return false; } return true; });
      state.salesQuestions = (state.salesQuestions || []).filter(function(q) { if (q.oppNo === oppNo) { cascaded.salesQuestions.push(String(q.id)); return false; } return true; });
      state.judgments = (state.judgments || []).filter(function(j) { if (j.oppNo === oppNo) { cascaded.judgments.push(String(j.id)); return false; } return true; });
      state.followUps = (state.followUps || []).filter(function(f) { if (f.oppNo === oppNo) { cascaded.followUps.push(String(f.id)); return false; } return true; });
      for (var ck in cascaded) {
        if (cascaded[ck].length) {
          if (!_deletedIds[ck]) _deletedIds[ck] = new Set();
          cascaded[ck].forEach(function(cid) { _deletedIds[ck].add(cid); });
        }
      }
      arr.splice(idx, 1);
      if (!_deletedIds[key]) _deletedIds[key] = new Set();
      _deletedIds[key].add(delId);
    } else if (key === 'contracts') {
      // 级联删除：业绩分配（通过 contractId）；同样登记 _deletedIds 防止合并复活
      var cascadedAllocIds = [];
      state.allocations = (state.allocations || []).filter(function(a) {
        if (String(a.contractId) === delId) { cascadedAllocIds.push(String(a.id)); return false; }
        return true;
      });
      if (cascadedAllocIds.length) {
        if (!_deletedIds.allocations) _deletedIds.allocations = new Set();
        cascadedAllocIds.forEach(function(cid) { _deletedIds.allocations.add(cid); });
      }
      arr.splice(idx, 1);
      if (!_deletedIds[key]) _deletedIds[key] = new Set();
      _deletedIds[key].add(delId);
      // 合同删除：重新同步申请签单状态（无合同则回退活跃，force=true 强制清空签单金额）
      syncAppSignStatus(state, oppNo, true);
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

// 公司级指标/实际取数：指标=全员个人指标合计；实际=全员业绩分配优先(与个人视图同口径)
function getCompanyTargets() {
  const out = {};
  try {
    const r = db.prepare('SELECT annual_targets FROM user_targets').all();
    (r[0] && r[0].values || []).forEach(v => {
      try {
        const t = JSON.parse(v[0] || '{}');
        Object.keys(t).forEach(y => { out[y] = (out[y] || 0) + (parseFloat(t[y]) || 0); });
      } catch(e) {}
    });
  } catch(e) {}
  return out;
}
function getCompanyActualWan(state, year, quarter) {
  const allocs = (state.allocations || []).filter(a => {
    if (year != null) { const y = a.month ? parseInt(String(a.month).split('-')[0], 10) : null; if (y !== year) return false; }
    if (quarter != null) {
      let q = a.quarter;
      if (!q && a.month) q = 'Q' + (Math.floor((parseInt(String(a.month).split('-')[1], 10) - 1) / 3) + 1);
      if (q !== quarter) return false;
    }
    return true;
  });
    const THRESHOLD = 100000; // 10万：合同金额小于此值不计入售前绩效
  function presalePerfOrZero(c) {
    const sa = parseFloat(c.subAmount) || 0;
    return (sa >= THRESHOLD) ? (parseFloat(c.presalePerformance) || 0) : 0;
  }
  const t = allocs.reduce((s, a) => s + (parseFloat(a.consultantPerformance) || 0), 0);
  if (t > 0) return t / 10000;
  const cons = (state.contracts || []).filter(c => {
    if (year != null) { const y = c.yearMonth ? parseInt(String(c.yearMonth).split('-')[0], 10) : null; if (y !== year) return false; }
    if (quarter != null && c.quarter !== quarter) return false;
    return (parseFloat(c.subAmount) || 0) >= THRESHOLD;
  });
  return cons.reduce((s, c) => s + presalePerfOrZero(c), 0) / 10000;
}

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

  // 按项目(oppNo)去重：商机号可重复录入，汇总统计只计一次（首个为准）
  {
    const seen = new Set();
    apps = apps.filter(a => { if (a.oppNo && seen.has(a.oppNo)) return false; if (a.oppNo) seen.add(a.oppNo); return true; });
  }

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
  const wonAmount = contracts.reduce((s, c) => s + presalePerfOrZero(c), 0) / 10000;

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
  const companyTargets = getCompanyTargets();
  const years = [2023, 2024, 2025, 2026];
  const currentYear = new Date().getFullYear();

  const data = years.map(year => {
    // 实际：全员业绩分配优先（与个人视图同口径），无分配时从合同取
    const actual = getCompanyActualWan(state, year);
    const target = parseFloat(companyTargets[year]) || 0;
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
  const year = parseInt(req.query.year) || new Date().getFullYear();
  // 公司级指标：全员个人指标合计（全局state里的annualTargets会被最后保存者的个人值覆盖，不可用）
  const companyTargets = getCompanyTargets();
  const annualTarget = parseFloat(companyTargets[year]) || 0;
  const quarterPcts = state.quarterPcts && Object.keys(state.quarterPcts).length ? state.quarterPcts : { Q1: 25, Q2: 25, Q3: 25, Q4: 25 };
  const currentQuarter = getQuarter(new Date().getMonth() + 1);

  const quarters = ['Q1', 'Q2', 'Q3', 'Q4'].map(q => {
    // 季度实际：全员业绩分配优先（与个人视图同口径），无分配时从合同取
    const actual = getCompanyActualWan(state, year, q);
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
try {
  initDb();
  // graceful shutdown：关闭 WAL 并关闭数据库连接
  const shutdown = () => {
    console.log('\n收到关闭信号，正在关闭数据库...');
    if (db) { db.pragma('wal_checkpoint'); db.close(); }
    process.exit(0);
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`\n🖥️  售前管理后端已启动: http://0.0.0.0:${PORT}`);
    console.log(`📁 数据库: ${DB_PATH}`);
    console.log(`🔐 默认管理员: admin / admin123 (请首次登录后修改密码)\n`);
  });
} catch(e) {
  console.error('数据库初始化失败:', e);
  process.exit(1);
}
