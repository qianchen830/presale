// mobile/app.js - Vue 3 移动端售前管理（完整版）
const { createApp, ref, reactive, computed, watch, onMounted, nextTick } = Vue;

// ========== 常量 ==========
const PRODUCTS = ['AI套件','AI星瀚','AI苍穹','灵基','AI HR','AI星空','EAS','s-HR','云之家','我家云','星空企业版','其他'];
const BUY_MODES = ['订阅','买断'];
const STAGES = ['前期沟通','需求调研','方案编写','POC','招投标','商务谈判','合同签订','项目交付','移交服务'];
const APP_STATUSES = ['活跃','暂停','预计','丢失','关闭','签单'];
const PARTNER_SETTLE = ['未结算','已结算'];
const YES_NO = ['是','否'];
const QUARTERS = ['Q1','Q2','Q3','Q4'];
const DEPT_FIELDS = [
  { key: 'name', label: '部门名称', type: 'text', required: true },
  { key: 'parentId', label: '上级部门ID', type: 'number' },
  { key: 'manager', label: '负责人', type: 'text' },
  { key: 'remark', label: '备注', type: 'text' },
];
const EMP_FIELDS = [
  { key: 'name', label: '姓名', type: 'text', required: true },
  { key: 'deptId', label: '部门ID', type: 'number', required: true },
  { key: 'position', label: '职位', type: 'text' },
  { key: 'mobile', label: '手机', type: 'text' },
  { key: 'email', label: '邮箱', type: 'text' },
];
const USER_FIELDS_ADMIN = [
  { key: 'username', label: '用户名', type: 'text', required: true },
  { key: 'display_name', label: '显示名', type: 'text', required: true },
  { key: 'role', label: '角色', type: 'select', options: ['user','admin'], required: true },
  { key: 'department', label: '部门', type: 'select' },
];
const USER_FIELDS_SELF = [
  { key: 'display_name', label: '显示名', type: 'text', required: true },
  { key: 'department', label: '部门', type: 'text' },
];

// ========== 全局状态 ==========
const state = reactive({
  user: null,          // { loggedIn, userId, username, displayName, role, department, viewDepts }
  fullState: null,     // getState() 返回的完整 state
  adminUsers: [],      // 管理员用户列表（单独加载）
  loading: false,
  toast: null,
  toastTimer: null,
  activeTab: 'dashboard',
  year: new Date().getFullYear(),
  // 列表页（dashboard 等其他模块仍在用）
  activeListTab: 'applications',
  searchText: '',
  filterStatus: '',
  // 数据查询页
  querySearchText: '',
  querySelectedOppNo: '',
  queryDetailTab: 'contract', // contract | follow | judgment | salesQ | alloc
  // admin 子页
  activeAdminSub: '',
  // 当前操作弹窗
  modal: null,         // { name, mode, data, extra }
  modalHistory: [], // 弹窗历史，关闭时恢复上一层
});

// ── 个人年度/季度目标 ──
    const userTargets = reactive({
      annualTargets: {}, // { year: amount }
      quarterTargets: {}, // { Q1: amount, ... }
      quarterPcts: { Q1: 16, Q2: 27, Q3: 23, Q4: 34 }, // { Q1: pct, ... }
    });
    async function loadUserTargets() {
      try {
        const d = await API.getUserTargets();
        userTargets.annualTargets = d.annualTargets || {};
        userTargets.quarterTargets = d.quarterTargets || {};
        userTargets.quarterPcts = (d.quarterPcts && Object.keys(d.quarterPcts).length > 0) ? d.quarterPcts : { Q1: 16, Q2: 27, Q3: 23, Q4: 34 };
      } catch(e) { /* ignore */ }
    }
    async function saveUserTargets() {
      try {
        await API.putUserTargets({
          annualTargets: JSON.parse(JSON.stringify(userTargets.annualTargets)),
          quarterTargets: JSON.parse(JSON.stringify(userTargets.quarterTargets)),
        });
        showToast('目标保存成功');
        await loadUserTargets();
      } catch(e) { showToast('保存失败: ' + e.message); }
    }

    // 根据年度目标和固定比例计算季度分解
    function getComputedQuarterTarget(quarter) {
      const year = state.year;
      const annual = parseFloat(userTargets.annualTargets[year] || 0);
      if (!annual) return '0.0';
      const pcts = userTargets.quarterPcts || { Q1: 16, Q2: 27, Q3: 23, Q4: 34 };
      return (annual * (parseFloat(pcts[quarter]) || 0) / 100).toFixed(1);
    }

    // ── 年份切换后自动刷新目标数据 ──
    watch(() => state.year, () => { loadUserTargets(); });

// ========== 工具函数 ==========
function showToast(msg, duration = 2000) {
  if (state.toastTimer) clearTimeout(state.toastTimer);
  state.toast = msg;
  state.toastTimer = setTimeout(() => { state.toast = null; }, duration);
}
function fmtMoney(v) {
  return (parseFloat(v) || 0).toLocaleString('zh-CN', { maximumFractionDigits: 0 });
}
function fmtDate(d) {
  if (!d) return '—';
  return String(d).slice(0, 10);
}
function getStatusBadge(s) {
  const m = { '活跃':'badge-active','暂停':'badge-paused','签单':'badge-won','丢失':'badge-lost','关闭':'badge-closed','预计':'badge-expect' };
  return m[s] || 'badge-active';
}
function getDeptName(id) {
  const d = (state.fullState?.departments || []).find(d => String(d.id) === String(id));
  return d ? d.name : '';
}
function getEmpName(id) {
  const e = (state.fullState?.employees || []).find(e => String(e.id) === String(id));
  return e ? e.name : '';
}

function getConsultantByOppNo(oppNo) {
  const app = (state.fullState?.applications || []).find(a => a.oppNo === oppNo);
  return app ? (app.consultant || app.applicant || '') : '';
}

function onUserEmployeeChange() {
  const empId = parseInt(formData.employeeId);
  const emp = (state.fullState?.employees || []).find(e => e.id === empId);
  if (emp) {
    formData.username = emp.name;
    formData.display_name = emp.name;
    formData.department = emp.department || '';
  } else {
    formData.username = '';
    formData.display_name = '';
    formData.department = '';
  }
}

// ========== 数据过滤 ==========
function filterRecords(records, opts = {}) {
  if (!records) return [];
  let list = records.filter(r => !r.deleted);
  if (opts.year) {
    list = list.filter(r => {
      const d = new Date(r.applyDate || r.mainSignDate || r.followDate || r.signDate || '');
      return d.getFullYear() === opts.year;
    });
  }
  if (opts.status) {
    list = list.filter(r => r.status === opts.status);
  }
  if (opts.search) {
    const kw = opts.search.toLowerCase();
    list = list.filter(r =>
      (r.customer||'').toLowerCase().includes(kw) ||
      (r.oppNo||'').toLowerCase().includes(kw) ||
      (r.projectName||'').toLowerCase().includes(kw) ||
      (r.consultant||'').toLowerCase().includes(kw) ||
      (r.signCustomer||'').toLowerCase().includes(kw) ||
      (r.signCustomerName||'').toLowerCase().includes(kw)
    );
  }
  return list;
}

// ── 可见性：admin 看到全部，普通人只看自己参与的 ──
// 关联链：followUps/judgments/salesQuestions → oppNo → applications.applicant
//          allocations → contractId → contracts
//          contracts → oppNo → applications.applicant
function getVisibleRecords(module) {
  const all = state.fullState ? (state.fullState[module] || []) : [];
  const alive = all.filter(r => !r.deleted);
  if (state.user?.role === 'admin') return alive;
  const me = state.user?.displayName || state.user?.username || '';

  if (module === 'applications') {
    return alive.filter(r => r.applicant === me || r.consultant === me);
  }
  if (module === 'contracts') {
    // 服务器端 filterStateByUser 已经做过权限过滤，直接返回全部可见合同
    return alive;
  }
  if (module === 'followUps' || module === 'judgments' || module === 'salesQuestions') {
    // 服务器端已做过权限过滤，直接返回
    return alive;
  }
  if (module === 'allocations') {
    // 分配通过 contractId 关联到合同，合同再关联到申请
    const myOppNos = new Set(
      (state.fullState?.applications || [])
        .filter(a => !a.deleted && (a.applicant === me || a.consultant === me))
        .map(a => a.oppNo)
    );
    const myContractIds = new Set(
      (state.fullState?.contracts || [])
        .filter(c => !c.deleted && myOppNos.has(c.oppNo))
        .map(c => c.id)
    );
    return alive.filter(r => myContractIds.has(r.contractId));
  }
  return alive;
}

// ── 按 oppNo 取关联记录（申请详情用） ──
function getRelatedByOppNo(module, oppNo) {
  if (!oppNo) return [];
  return (state.fullState?.[module] || []).filter(r => !r.deleted && r.oppNo === oppNo);
}

// ── 按 contractId 取关联记录（合同详情用） ──
function getRelatedByContractId(module, contractId) {
  if (!contractId) return [];
  return (state.fullState?.[module] || []).filter(r => !r.deleted && r.contractId === contractId);
}

// ── 按 ID 取合同（用于业绩分配详情展示合同金额） ──
function getContractById(id) {
  if (!id) return null;
  return (state.fullState?.contracts || []).find(c => String(c.id) === String(id) && !c.deleted) || null;
}

// ========== 模块 → API path 映射 ==========
const MODULE_MAP = {
  applications: 'applications',
  contracts: 'contracts',
  followUps: 'followUps',
  judgments: 'judgments',
  salesQuestions: 'salesQuestions',
  allocations: 'allocations',
};

function getModuleName(tab) {
  // listTab（如'applications'）→ API path（如'applications'）
  return MODULE_MAP[tab] || tab;
}

// ========== 表单字段定义 ==========
const APP_FIELDS = [
  { key:'applyDate', label:'申请日期', type:'date', required:true },
  { key:'applicant', label:'申请人', type:'text', required:true },
  { key:'department', label:'申请部门', type:'text', required:true },
  { key:'customer', label:'客户名称', type:'text', required:true },
  { key:'oppNo', label:'商机号', type:'text', required:true },
  { key:'projectName', label:'项目名称', type:'text', required:false },
  { key:'product', label:'预购产品', type:'select', options:PRODUCTS, required:true },
  { key:'buyMode', label:'购买模式', type:'select', options:BUY_MODES, required:true },
  { key:'currentStage', label:'当前阶段', type:'select', options:STAGES, required:true },
  { key:'status', label:'项目状态', type:'select', options:APP_STATUSES, required:true },
  { key:'coreRequirement', label:'核心需求', type:'textarea', required:false },
  { key:'expectedSignDate', label:'预计签单时间', type:'date', required:false },
  { key:'expectedSignAmount', label:'预计签单金额', type:'number', required:false },
];
const CONTRACT_FIELDS = [
  { key:'oppNo', label:'申请商机编号', type:'text', required:true },
  { key:'signOppNo', label:'签约商机编号', type:'text', required:true },
  { key:'workOrderNo', label:'工时商机号', type:'text', required:false },
  { key:'mainContractNo', label:'主合同编号', type:'text', required:true },
  { key:'signCustomer', label:'申请客户名称', type:'text', required:true },
  { key:'signCustomerName', label:'签约客户名称', type:'text', required:false },
  // accountMgr 和 salesDept 由组织架构选择器选择，不在通用 v-for 里
  { key:'product', label:'所购产品', type:'select', options:PRODUCTS, required:true },
  { key:'subAmount', label:'合同金额(元)', type:'number', required:true },
  { key:'actualCost', label:'实际成本(元)', type:'number', required:true },
  { key:'subPerformance', label:'订阅业绩(元)', type:'number', required:true },
  { key:'presalePerformance', label:'售前合同业绩(元)', type:'number', required:false },
  { key:'isCloudSub', label:'是否云订阅', type:'select', options:YES_NO, required:true },
  { key:'mainSignDate', label:'主合同签订时间', type:'date', required:true },
  { key:'signOpDate', label:'签订操作时间', type:'date', required:true },
  { key:'partnerSettle', label:'伙伴结算', type:'select', options:PARTNER_SETTLE, required:false },
  { key:'remarks', label:'备注', type:'text', required:false },
];
const FOLLOW_FIELDS = [
  { key:'oppNo', label:'商机号', type:'text', required:true },
  { key:'followDate', label:'日期', type:'date', required:true },
  { key:'hours', label:'耗用工时(h)', type:'number', required:true },
  { key:'workItem', label:'工作事项', type:'textarea', required:true },
  { key:'summary', label:'成果总结', type:'textarea', required:true },
  { key:'nextWork', label:'下一步工作', type:'text', required:true },
  { key:'nextDate', label:'预计时间', type:'date', required:true },
];
const JUDGMENT_FIELDS = [
  { key:'oppNo', label:'商机号', type:'text', required:true },
  { key:'judgmentType', label:'判断类型', type:'text', required:true },
  { key:'judgmentDate', label:'判断日期', type:'date', required:true },
  { key:'result', label:'判断结论', type:'textarea', required:true },
  { key:'competitor', label:'竞争对手', type:'text', required:false },
];
const SALES_Q_FIELDS = [
  { key:'oppNo', label:'商机号', type:'text', required:true },
  { key:'seq', label:'序号', type:'number', required:true },
  { key:'question', label:'问题', type:'textarea', required:true },
  { key:'answer', label:'回答', type:'textarea', required:false },
  { key:'note', label:'备注', type:'text', required:false },
];
const ALLOCATION_FIELDS = [
  { key:'oppNo', label:'商机号', type:'text', required:true },
  { key:'consultant', label:'顾问', type:'text', required:true },
  { key:'month', label:'月份', type:'text', required:false },
  { key:'quarter', label:'季度', type:'select', options:['Q1','Q2','Q3','Q4'], required:false },
  { key:'pct', label:'分配比例(%)', type:'select', options:[], required:true },
];
// consultantPerformance 根据 pct 自动计算，不做表单字段
// contractId 由 picker 选合同自动注入

// ========== Vue App ==========
const app = createApp({
  setup() {
    // ── 登录 ──
    const loginUsername = ref('');
    const loginPassword = ref('');
    const loginLoading = ref(false);

    async function doLogin() {
      if (!loginUsername.value || !loginPassword.value) { showToast('请输入用户名和密码'); return; }
      loginLoading.value = true;
      try {
        const data = await API.login(loginUsername.value, loginPassword.value);
        // 登录成功后 /api/auth/me 会返回完整 user
        await loadMe();
      } catch (e) {
        showToast(e.message);
      } finally {
        loginLoading.value = false;
      }
    }

    async function loadMe() {
      try {
        const data = await API.me();
        if (!data || !data.loggedIn) {
          state.user = null;
          return;
        }
        // 统一结构：user 对象包含所有必要字段
        state.user = {
          loggedIn: true,
          userId: data.userId,
          username: data.username,
          displayName: data.displayName,
          role: data.role,
          department: data.department || '',
          viewDepts: data.viewDepts || [],
        };
        await loadState();
      } catch (e) {
        state.user = null;
      }
    }

    async function loadState() {
      state.loading = true;
      try {
        const d = await API.getState();
        state.fullState = d.state;
        const fu = (d.state?.followUps||[]).length;
        const jg = (d.state?.judgments||[]).length;
        const sq = (d.state?.salesQuestions||[]).length;
        const al = (d.state?.allocations||[]).length;
        
        // admin 需要加载用户列表
        if (state.user?.role === 'admin') {
          await loadAdminUsers();
        }
        await loadUserTargets();
      } catch (e) {
        showToast('加载数据失败: ' + e.message);
      } finally {
        state.loading = false;

      }
    }

    async function loadAdminUsers() {
      try {
        const data = await API.getUsers();
        state.adminUsers = data.users || [];
      } catch (e) {
        // 非 admin 可能没权限，忽略
        state.adminUsers = [];
      }
    }

    async function doLogout() {
      try { await API.logout(); } catch {}
      state.user = null;
      state.fullState = null;
      state.activeTab = 'dashboard';
      state.activeAdminSub = '';
      state.modal = null;
    }

    // ── Dashboard ──
    const dashboardStats = computed(() => {
      if (!state.fullState) return { total: 0, won: 0, lost: 0, totalAmount: 0, wonAmount: 0, activeCount: 0, annualTarget: 0, annualTargets: {}, quarterTargets: {}, quarterPcts: {} };
      const year = state.year;
      const apps = (state.fullState.applications || []).filter(a =>
        new Date(a.applyDate || 0).getFullYear() === year && !a.deleted
      );
      const cons = filteredContracts.value.filter(c =>
        new Date(c.mainSignDate || 0).getFullYear() === year
      );
      const won = apps.filter(a => a.status === '签单').length;
      const lost = apps.filter(a => a.status === '丢失').length;
      const activeCount = apps.filter(a => a.status === '活跃' || a.status === '预计').length;
      const totalAmount = cons.reduce((s, c) => s + (parseFloat(c.subAmount) || 0), 0) / 10000;
      const wonAmount = cons.reduce((s, c) => {
        const sa = parseFloat(c.subAmount) || 0;
        return s + (sa >= 100000 ? (parseFloat(c.presalePerformance) || 0) : 0);
      }, 0) / 10000;
      // 个人年度/季度目标（来自 /api/state 返回的 user_targets）
      const annualTargets = state.fullState.annualTargets || {};
      const quarterTargets = state.fullState.quarterTargets || {};
      const quarterPcts = state.fullState.quarterPcts || {};
      const annualTarget = parseFloat(annualTargets[year] || userTargets.annualTargets[year] || state.fullState.annualTarget || 0);
      return { total: apps.length, won, lost, activeCount, totalAmount, wonAmount, annualTarget, annualTargets, quarterTargets, quarterPcts };
    });

    const myVisibleApps = computed(() => getVisibleRecords('applications'));
    const myVisibleContracts = computed(() => getVisibleRecords('contracts'));
    const filteredApps = computed(() => filterRecords(myVisibleApps.value, { year: state.year, status: state.filterStatus, search: state.searchText }));
    const filteredContracts = computed(() => filterRecords(myVisibleContracts.value, { search: state.searchText }));
    const myFollows = computed(() => getVisibleRecords('followUps'));
    const myJudgments = computed(() => getVisibleRecords('judgments'));
    const mySalesQs = computed(() => getVisibleRecords('salesQuestions'));
    const myAllocs = computed(() => getVisibleRecords('allocations'));

    // 非申请 tab：用 groupedRecords（申请为主体，子记录嵌套在申请下）
    // 结构：[ { app: {...}, subs: [...] } ]
    const listRecords = computed(() => {
      const tab = state.activeListTab;
      if (tab === 'applications') return filteredApps.value;
      if (tab === 'contracts') return filteredContracts.value;
      return []; // follow/judgment/salesQ/alloc use groupedRecords instead
    });

    const groupedRecords = computed(() => {
      if (state.activeListTab === 'applications' || state.activeListTab === 'contracts') {
        return state.activeListTab === 'applications' ? filteredApps.value.map(a => ({ app: a, subs: [] })) : filteredContracts.value.map(c => ({ app: c, subs: [] }));
      }
      const moduleMap = {
        followUps: { data: myFollows.value, key: 'oppNo', icon: '📋' },
        judgments: { data: myJudgments.value, key: 'oppNo', icon: '🔍' },
        salesQuestions: { data: mySalesQs.value, key: 'oppNo', icon: '💬' },
        allocations: { data: myAllocs.value, key: 'oppNo', icon: '💰' },
      };
      const cfg = moduleMap[state.activeListTab];
      if (!cfg) return [];
      const kw = (state.searchText || '').toLowerCase();
      const subs = filterRecords(cfg.data, { search: kw });
      // 按 oppNo 分组，找对应 application
      const appMap = {};
      (state.fullState?.applications || []).forEach(a => { appMap[a.oppNo] = a; });
      const groups = {};
      subs.forEach(s => {
        const oppNo = s[cfg.key];
        if (!groups[oppNo]) groups[oppNo] = { app: appMap[oppNo] || { oppNo, customer: '(未知申请)', projectName: '' }, subs: [] };
        groups[oppNo].subs.push(s);
      });
      // 排序：最新关联的排前面
      return Object.values(groups).sort((a, b) => {
        const da = new Date(a.app.applyDate || 0); const db = new Date(b.app.applyDate || 0);
        return db - da;
      });
    });

    // ── Modal ──
    const formData = reactive({});
    const formLoading = ref(false);

    // ── 快捷录入选择器状态 ──
    // pickerStep = null → 直接填表单（申请）
    // pickerStep = 'contract'|'follow'|'judgment'|'salesQ'|'allocation' → 先选关联申请/合同
    const pickerStep = ref(null);
    const pickerSearch = ref('');

    // 选关联申请时，显示本人今年的申请列表
    const pickerList = computed(() => {
      const kw = pickerSearch.value.toLowerCase();
      const yr = state.year;
      if (pickerStep.value === 'contract' || pickerStep.value === 'follow' ||
          pickerStep.value === 'judgment' || pickerStep.value === 'salesQ') {
        // 候选：本人的申请（用于合同/跟进/判断/问答）
        const apps = getVisibleRecords('applications');
        return apps
          .filter(a => new Date(a.applyDate || 0).getFullYear() === yr)
          .filter(a => !kw || (a.customer||'').toLowerCase().includes(kw) ||
            (a.oppNo||'').toLowerCase().includes(kw) || (a.projectName||'').toLowerCase().includes(kw))
          .slice(0, 30);
      }
      if (pickerStep.value === 'allocation') {
        // 业绩分配：关联合同 → 再找申请
        const me = state.user?.displayName || state.user?.username || '';
        const myOppNos = new Set(
          (state.fullState?.applications || [])
            .filter(a => !a.deleted && (a.applicant === me || a.consultant === me))
            .map(a => a.oppNo)
        );
        return (state.fullState?.contracts || [])
          .filter(c => !c.deleted && myOppNos.has(c.oppNo))
          .filter(c => new Date(c.mainSignDate || 0).getFullYear() === yr)
          .filter(c => !kw || (c.signCustomer||'').toLowerCase().includes(kw) ||
            (c.oppNo||'').toLowerCase().includes(kw))
          .slice(0, 30);
      }
      if (pickerStep.value === 'emp') {
        // 员工选择（用于合同选择客户经理）
        const depts = state.fullState?.departments || [];
        const deptMap = {};
        depts.forEach(d => { if (!d.deleted) deptMap[d.id] = d.name; });
        return (state.fullState?.employees || [])
          .filter(e => !kw || (e.name||'').toLowerCase().includes(kw) || (e.empNo||'').toLowerCase().includes(kw))
          .map(e => ({ ...e, deptName: deptMap[e.deptId] || '' }))
          .slice(0, 50);
      }
      return [];
    });

    // ── 合同已分配比例统计（用 contractId 做 key） ──
    const contractAllocStats = computed(() => {
      const stats = new Map(); // contractId → { usedPct, remainPct }
      const allocs = state.fullState?.allocations || [];
      allocs.forEach(a => {
        if (a.deleted) return;
        const cid = String(a.contractId || '');
        if (!cid) return;
        if (!stats.has(cid)) stats.set(cid, { usedPct: 0 });
        stats.get(cid).usedPct += parseFloat(a.pct) || 0;
      });
      stats.forEach(entry => { entry.remainPct = Math.max(0, 100 - entry.usedPct); });
      return stats;
    });

    // ── 分配 pct 可选选项（根据剩余比例生成，不超过剩余比例） ──
    const allocationPctOptions = computed(() => {
      const contractId = formData.contractId;
      if (!contractId) return [];
      const remain = contractAllocStats.value.get(String(contractId))?.remainPct || 0;
      if (remain <= 0) return [];
      const options = [];
      for (const p of [5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60, 65, 70, 75, 80, 85, 90, 95, 100]) {
        if (p <= remain) options.push(p);
      }
      return options;
    });

    // ── 业绩分配 pct 变化时自动计算 consultantPerformance ──
    watch([() => formData.pct, () => formData.oppNo], () => {
      const pct = parseFloat(formData.pct) || 0;
      const contract = allocContract.value;
      const amount = contract ? (parseFloat(contract.subAmount) || 0) : 0;
      if (pct > 0 && amount > 0) {
        formData.consultantPerformance = Math.round(amount * pct / 100);
      } else {
        formData.consultantPerformance = undefined;
      }
    });

    // ── 当前分配关联的合同（用于显示合同金额） ──
    const allocContract = computed(() => {
      const cid = formData.contractId;
      if (!cid) return null;
      return (state.fullState?.contracts || []).find(c => !c.deleted && String(c.id) === String(cid)) || null;
    });

    // ── 关联记录 computeds ──
    // 申请关联合同：通过 oppNo 匹配
    const relatedContracts = computed(() => {
      if (state.modal?.name !== 'app' || state.modal?.mode !== 'view') return [];
      const oppNo = formData.oppNo;
      if (!oppNo) return [];
      return (state.fullState?.contracts || []).filter(c => !c.deleted && c.oppNo === oppNo);
    });

    // 申请关联跟进
    const relatedFollows = computed(() => {
      if (state.modal?.name !== 'app' || state.modal?.mode !== 'view') return [];
      const oppNo = formData.oppNo;
      if (!oppNo) return [];
      return (state.fullState?.followUps || []).filter(f => !f.deleted && f.oppNo === oppNo);
    });

    // 申请关联判断
    const relatedJudgments = computed(() => {
      if (state.modal?.name !== 'app' || state.modal?.mode !== 'view') return [];
      const oppNo = formData.oppNo;
      if (!oppNo) return [];
      return (state.fullState?.judgments || []).filter(j => !j.deleted && j.oppNo === oppNo);
    });

    // 申请关联问答
    const relatedSalesQs = computed(() => {
      if (state.modal?.name !== 'app' || state.modal?.mode !== 'view') return [];
      const oppNo = formData.oppNo;
      if (!oppNo) return [];
      return (state.fullState?.salesQuestions || []).filter(q => !q.deleted && q.oppNo === oppNo);
    });

    // 合同关联分配：通过 contractId 匹配
    const relatedAllocs = computed(() => {
      if (state.modal?.name !== 'contract' || state.modal?.mode !== 'view') return [];
      const contractId = formData.id;
      if (!contractId) return [];
      return (state.fullState?.allocations || []).filter(a => !a.deleted && a.contractId === contractId);
    });

    // ══════════ Board 看板 ══════════
    // 本人的商机（申请人 或 顾问）
    const boardApps = computed(() => {
      const year = state.year;
      return (state.fullState?.applications || []).filter(a => {
        if (a.deleted) return false;
        const d = a.applyDate || '';
        return d.startsWith(String(year));
      });
    });

    const boardWonAmount = computed(() => {
      const wonOppNos = new Set(boardApps.value.filter(a => a.status === '签单').map(a => a.oppNo));
      const total = (state.fullState?.contracts || [])
        .filter(c => !c.deleted && wonOppNos.has(c.oppNo))
        .reduce((s, c) => s + (parseFloat(c.subAmount) || 0), 0);
      return total / 10000;
    });
    const boardTotalAmount = computed(() => {
      const myOppNos = new Set(boardApps.value.map(a => a.oppNo));
      const total = (state.fullState?.contracts || [])
        .filter(c => !c.deleted && myOppNos.has(c.oppNo))
        .reduce((s, c) => s + (parseFloat(c.subAmount) || 0), 0);
      return total / 10000;
    });
    const boardAnnualTarget = computed(() => {
      const t = userTargets.annualTargets?.[state.year];
      return t || 0;
    });
    const boardProgress = computed(() => {
      const t = boardAnnualTarget.value;
      if (!t) return -1;
      return Math.round((boardWonAmount.value / t) * 100);
    });

    // 按产品线分组
    const boardByProduct = computed(() => {
      const wonOppNos = new Set(boardApps.value.filter(a => a.status === '签单').map(a => a.oppNo));
      const contracts = (state.fullState?.contracts || []).filter(c => !c.deleted && wonOppNos.has(c.oppNo) && (parseFloat(c.subAmount) || 0) >= 100000);
      const map = {};
      contracts.forEach(c => {
        const p = c.product || '其他';
        if (!map[p]) map[p] = { product: p, won: 0 };
        map[p].won += parseFloat(c.subAmount) || 0;
      });
      return Object.values(map).sort((a, b) => b.won - a.won);
    });

    // 按阶段分组
    const boardByStage = computed(() => {
      const map = {};
      boardApps.value.forEach(a => {
        const s = a.currentStage || '未知';
        if (!map[s]) map[s] = { stage: s, count: 0 };
        map[s].count++;
      });
      return Object.values(map).sort((a, b) => b.count - a.count);
    });

    // 近期跟进（本人的）
    const boardRecentFollows = computed(() => {
      return (state.fullState?.followUps || [])
        .filter(f => !f.deleted)
        .sort((a, b) => (b.followDate||'').localeCompare(a.followDate||''))
        .slice(0, 10)
        .map(f => ({ ...f, consultantName: getConsultantByOppNo(f.oppNo) }));
    });

    // 待回答问答（本人参与的）
    const boardPendingQs = computed(() => {
      return (state.fullState?.salesQuestions || [])
        .filter(q => !q.deleted && !q.answer)
        .sort((a, b) => (a.seq||0) - (b.seq||0));
    });

    // 申请号 -> 客户名 映射（用于近期动态显示）
    const boardAppMap = computed(() => {
      const m = {};
      (state.fullState?.applications || []).forEach(a => { m[a.oppNo] = a.customer || a.projectName || a.oppNo; });
      return m;
    });

    // ══════════ 数据查询页 ══════════
    const queryPage = ref(1);
    const queryPageSize = 15;

    const queryFilteredApps = computed(() => {
      const kw = state.querySearchText.trim().toLowerCase();
      const apps = state.fullState?.applications || [];
      const contracts = state.fullState?.contracts || [];

      // 无关键词：返回全部（按日期倒序）
      if (!kw) {
        return [...apps].filter(a => !a.deleted)
          .sort((a, b) => (b.applyDate||'').localeCompare(a.applyDate||''));
      }

      // 有关键词：
      // 1. 申请直接匹配（商机号/客户/项目/销售员）
      // 2. 合同号匹配 -> 拿到对应 oppNo -> 再找申请
      const directSet = new Set();
      apps.forEach(a => {
        if (a.deleted) return;
        if ((a.oppNo||'').toLowerCase().includes(kw)) directSet.add(a.oppNo);
        else if ((a.customer||'').toLowerCase().includes(kw)) directSet.add(a.oppNo);
        else if ((a.projectName||'').toLowerCase().includes(kw)) directSet.add(a.oppNo);
        else if ((a.applicant||'').toLowerCase().includes(kw)) directSet.add(a.oppNo);
        else if ((a.product||'').toLowerCase().includes(kw)) directSet.add(a.oppNo);
      });

      // 合同号匹配
      contracts.forEach(c => {
        if (c.deleted) return;
        if ((c.mainContractNo||'').toLowerCase().includes(kw)) directSet.add(c.oppNo);
        else if ((c.signCustomer||'').toLowerCase().includes(kw)) directSet.add(c.oppNo);
      });

      return apps.filter(a => !a.deleted && directSet.has(a.oppNo));
    });

    const queryPageCount = computed(() => Math.ceil(queryFilteredApps.value.length / queryPageSize) || 1);
    const queryPageRecords = computed(() => {
      const start = (queryPage.value - 1) * queryPageSize;
      return queryFilteredApps.value.slice(start, start + queryPageSize);
    });

    const querySelectedApp = computed(() => {
      if (!state.querySelectedOppNo) return null;
      return (state.fullState?.applications || []).find(a => a.oppNo === state.querySelectedOppNo) || null;
    });

    const queryContracts = computed(() => {
      if (!state.querySelectedOppNo) return [];
      return (state.fullState?.contracts || []).filter(c => !c.deleted && c.oppNo === state.querySelectedOppNo);
    });

    const queryFollows = computed(() => {
      if (!state.querySelectedOppNo) return [];
      return (state.fullState?.followUps || []).filter(f => !f.deleted && f.oppNo === state.querySelectedOppNo);
    });

    const queryJudgments = computed(() => {
      if (!state.querySelectedOppNo) return [];
      return (state.fullState?.judgments || []).filter(j => !j.deleted && j.oppNo === state.querySelectedOppNo);
    });

    const querySalesQs = computed(() => {
      if (!state.querySelectedOppNo) return [];
      return (state.fullState?.salesQuestions || []).filter(q => !q.deleted && q.oppNo === state.querySelectedOppNo);
    });

    const queryAllocs = computed(() => {
      if (!state.querySelectedOppNo) return [];
      const contractIds = new Set(queryContracts.value.map(c => c.id));
      return (state.fullState?.allocations || []).filter(a => !a.deleted && contractIds.has(a.contractId));
    });

    function openModal(name, mode = 'create', data = {}, extra = {}) {
      // 打开新建/编辑弹窗时，把当前弹窗（含 formData）保存到历史
      // 这样取消或保存后可以返回父详情页，而不是直接关闭
      if (state.modal) {
        state.modalHistory.push({ name: state.modal.name, mode: state.modal.mode, data: state.modal.data, extra: state.modal.extra, formDataSnapshot: { ...formData } });
      }
      state.modal = { name, mode, data, extra };
      Object.keys(formData).forEach(k => delete formData[k]);
      pickerStep.value = null;
      pickerSearch.value = '';
      const today = new Date().toISOString().slice(0, 10);
      if (mode === 'create') {
        if (name === 'app') {
          // 申请直接填
          Object.assign(formData, { applyDate: today, applicant: state.user?.displayName || state.user?.username || '', department: state.user?.department || '', product: PRODUCTS[0], buyMode: BUY_MODES[0], currentStage: STAGES[0], status: '活跃' });
        } else if (name === 'allocation' && extra?.contractId) {
          // 从合同详情进入：直接带 contractId，跳过 picker
          Object.assign(formData, {
            contractId: extra.contractId,
            oppNo: extra.oppNo || '',
            month: today.slice(0, 7),
            consultant: state.user?.displayName || state.user?.username || '',
            quarter: 'Q' + Math.ceil((parseInt(today.slice(5, 7)) || 1) / 3)
          });
        } else if (extra?.oppNo) {
          // 从申请详情进入：直接带 oppNo，跳过 picker
          const oppNo = extra.oppNo;
          if (name === 'contract') {
            Object.assign(formData, {
              oppNo,
              mainSignDate: today, signOpDate: today, isCloudSub: '否', product: extra.product || PRODUCTS[0],
              accountMgr: state.user?.displayName || state.user?.username || '',
              salesDept: state.user?.department || ''
            });
          } else if (name === 'follow') {
            Object.assign(formData, { oppNo, followDate: today, nextDate: today });
          } else if (name === 'judgment') {
            Object.assign(formData, { oppNo, judgmentDate: today });
          } else if (name === 'salesQ') {
            const existing = (state.fullState?.salesQuestions || [])
              .filter(q => !q.deleted && q.oppNo === oppNo)
              .map(q => parseInt(q.seq) || 0);
            Object.assign(formData, { oppNo, seq: existing.length ? Math.max(...existing) + 1 : 1 });
          } else if (name === 'allocation' && extra?.contractId) {
            Object.assign(formData, {
              contractId: extra.contractId, oppNo,
              month: today.slice(0, 7),
              consultant: state.user?.displayName || state.user?.username || '',
              quarter: 'Q' + Math.ceil((parseInt(today.slice(5, 7)) || 1) / 3)
            });
          }
        } else if (['dept', 'emp', 'user'].includes(name)) {
          // 部门/员工/用户：直接新建，不需要选关联记录
        } else {
          // 合同/跟进/判断/问答/分配：先选关联申请或合同
          pickerStep.value = name;
        }
      } else {
        // 查看/编辑模式
        Object.assign(formData, { ...data });
      }
    }

    // 选择关联记录后，初始化表单数据
    function doPickerSelect(record) {
      const today = new Date().toISOString().slice(0, 10);
      const name = pickerStep.value;
      if (name === 'contract') {
        Object.assign(formData, {
          oppNo: record.oppNo,
          mainSignDate: today, signOpDate: today, isCloudSub: '否', product: record.product || PRODUCTS[0]
        });
      } else if (name === 'follow') {
        Object.assign(formData, { oppNo: record.oppNo, followDate: today, nextDate: today });
      } else if (name === 'judgment') {
        Object.assign(formData, { oppNo: record.oppNo, judgmentDate: today });
      } else if (name === 'salesQ') {
        // 找已有最大seq
        const existing = (state.fullState?.salesQuestions || [])
          .filter(q => !q.deleted && q.oppNo === record.oppNo)
          .map(q => parseInt(q.seq) || 0);
        const nextSeq = existing.length ? Math.max(...existing) + 1 : 1;
        Object.assign(formData, { oppNo: record.oppNo, seq: nextSeq });
      } else if (name === 'allocation') {
        // 分配关联合同
        Object.assign(formData, {
          contractId: record.id, oppNo: record.oppNo,
          month: today.slice(0, 7), consultant: state.user?.displayName || state.user?.username || ''
        });
      } else if (name === 'emp') {
        // 选择客户经理（组织架构）
        Object.assign(formData, {
          accountMgr: record.name,
          salesDept: record.deptName || '',
          accountMgrId: record.id
        });
      }
      pickerStep.value = null;
      pickerSearch.value = '';
    }

    function closeModal() {
      if (state.modalHistory.length > 0) {
        const hist = state.modalHistory.pop();
        state.modal = hist;
        // 恢复 formData（从查看子详情返回父详情时，如合同→分配→返回合同）
        if (hist?.formDataSnapshot) {
          Object.keys(formData).forEach(k => delete formData[k]);
          Object.assign(formData, hist.formDataSnapshot);
        }
        return;
      }
      state.modal = null;
    }

    // 拖拽关闭（防止误触）
    const dragStartY = ref(0);
    const dragOffset = ref(0);
    const isDragging = ref(false);
    const dragOpened = ref(false);

    function onModalTouchStart(e) {
      dragStartY.value = e.touches[0].clientY;
      dragOffset.value = 0;
      isDragging.value = true;
      dragOpened.value = false;
    }
    function onModalTouchMove(e) {
      if (!isDragging.value) return;
      const delta = e.touches[0].clientY - dragStartY.value;
      dragOffset.value = delta > 0 ? delta : 0;
      if (delta > 80) dragOpened.value = true;
    }
    function onModalTouchEnd() {
      if (!isDragging.value) return;
      isDragging.value = false;
      if (dragOpened.value) {
        closeModal();
      }
      dragOffset.value = 0;
    }

    // 关闭前检查是否有未保存内容
    function maybeCloseModal() {
      const isForm = state.modal && state.modal.mode !== 'view';
      if (isForm && !confirm('内容未保存，确定关闭？')) return;
      closeModal();
    }

    async function saveRecord() {
      if (!state.modal) return;
      // ── 业绩分配 pct 校验：同一合同（按 contractId）总比例不得超过 100% ──
      if (state.modal.name === 'allocation') {
        const contractId = formData.contractId;
        const newPct = parseFloat(formData.pct) || 0;
        if (!contractId) { showToast('合同ID为空，请重新打开'); return; }
        if (!newPct || newPct <= 0) { showToast('分配比例为 ' + newPct + '，请填写有效比例'); return; }
        if (newPct > 100) { showToast('单次分配比例不得超过 100%'); return; }
        const stat = contractAllocStats.value.get(String(contractId));
        const usedPct = stat?.usedPct || 0;
        if (usedPct + newPct > 100) {
          showToast('累计已分配 ' + usedPct + '%，剩余 ' + Math.max(0, 100 - usedPct) + '%，请减少分配比例');
          return;
        }
      }
      formLoading.value = true;
      try {
        const { name, mode, data } = state.modal;
        if (name === 'dept' || name === 'emp' || name === 'user') {
          // 管理员实体单独处理
          if (name === 'dept') {
            if (mode === 'create') await API.createDept({ ...formData });
            else await API.updateDept(data.id, { ...formData });
          } else if (name === 'emp') {
            if (mode === 'create') await API.createEmployee({ ...formData });
            else await API.updateEmployee(data.id, { ...formData });
          } else if (name === 'user') {
            if (mode === 'create') await API.createUser({ ...formData });
            else await API.updateUser(data.id, { ...formData });
          }
          showToast('保存成功');
        } else {
          // 通用模块
          const module = getModuleName(name === 'salesQ' ? 'salesQuestions' : name === 'judgment' ? 'judgments' : name === 'allocation' ? 'allocations' : name === 'app' ? 'applications' : name === 'contract' ? 'contracts' : name);
          if (mode === 'create') {
            await API.create(module, { ...formData });
          } else {
            await API.update(module, data.id, { ...formData });
          }
          showToast('保存成功');
        }
        closeModal();
        await loadState();
      } catch (e) {
        showToast(e.message);
      } finally {
        formLoading.value = false;
      }
    }
    window._saveRecord = saveRecord;
    window._deleteRecord = deleteRecord;

    async function deleteRecord() {
      if (!state.modal) return;
      const { name, data } = state.modal;
      if (!confirm('确定要删除这条记录吗？')) return;
      formLoading.value = true;
      try {
        if (name === 'dept') {
          await API.deleteDept(data.id);
        } else if (name === 'emp') {
          await API.deleteEmployee(data.id);
        } else if (name === 'user') {
          await API.deleteUser(data.id);
        } else {
          const module = getModuleName(name === 'salesQ' ? 'salesQuestions' : name === 'judgment' ? 'judgments' : name === 'allocation' ? 'allocations' : name === 'app' ? 'applications' : name === 'contract' ? 'contracts' : name);
          await API.remove(module, data.id);
        }
        showToast('删除成功');
        await loadState();
        closeModal();
      } catch (e) {
        showToast(e.message);
      } finally {
        formLoading.value = false;
      }
    }

    function changeYear(delta) { state.year += delta; }

    function getListItemTitle(record, module) {
      if (module === 'applications') return record.customer || record.projectName || record.oppNo || '商机';
      if (module === 'contracts') return record.signCustomerName || record.signCustomer || record.oppNo || '合同';
      if (module === 'followUps') return (record.workItem || '').slice(0, 30) || '跟进';
      if (module === 'judgments') return record.judgmentType || record.oppNo || '判断';
      if (module === 'salesQuestions') return `[${record.seq||''}] ${(record.question||'').slice(0,20)}`;
      if (module === 'allocations') return `${record.consultant||''} - ${fmtMoney(record.consultantPerformance)}元`;
      return record.oppNo || '记录';
    }
    function getListItemSub(record, module) {
      if (module === 'applications') return `${record.oppNo||''} | ${record.product||''} | ${record.currentStage||''}`;
      if (module === 'contracts') return `${fmtMoney(record.subAmount)}元 | ${fmtDate(record.mainSignDate)}`;
      if (module === 'followUps') return `${fmtDate(record.followDate)} | ${record.hours||''}h`;
      if (module === 'judgments') return `${record.competitor?'竞品:'+record.competitor:''} | ${fmtDate(record.judgmentDate)}`;
      if (module === 'salesQuestions') return `回答: ${record.answer?'已填写':'未填写'}`;
      if (module === 'allocations') return `${record.month||record.quarter||''}`;
      return '';
    }

    // ── 个人信息保存 ──
    async function saveSelfProfile() {
      formLoading.value = true;
      try {
        await API.updateMyProfile({
          display_name: formData.display_name,
          department: formData.department,
        });
        state.user = { ...state.user, displayName: formData.display_name, department: formData.department };
        showToast('保存成功');
        closeModal();
      } catch (e) {
        showToast(e.message);
      } finally {
        formLoading.value = false;
      }
    }

    // 改密码
    const oldPwd = ref('');
    const newPwd = ref('');
    const confirmPwd = ref('');
    const showOldPwd = ref(false);
    const showNewPwd = ref(false);
    const showConfirmPwd = ref(false);
    const pwdLoading = ref(false);

    async function doChangePassword() {
      if (!oldPwd.value) { showToast('请输入旧密码'); return; }
      if (!newPwd.value) { showToast('请输入新密码'); return; }
      if (newPwd.value.length < 6) { showToast('新密码至少6位'); return; }
      if (newPwd.value !== confirmPwd.value) { showToast('两次新密码不一致'); return; }
      pwdLoading.value = true;
      try {
        await API.changeMyPassword(oldPwd.value, newPwd.value);
        showToast('密码修改成功');
        oldPwd.value = ''; newPwd.value = ''; confirmPwd.value = '';
      } catch (e) {
        showToast(e.message);
      } finally {
        pwdLoading.value = false;
      }
    }

    // ── Init ──
    onMounted(async () => {
      window.addEventListener('mobile:unauthorized', () => {
        state.user = null;
        state.fullState = null;
        showToast('登录已失效，请重新登录');
      });
      await loadMe();
    });

    // Dashboard 计算属性
    const dashboardWonAmount = computed(() => {
      return (filteredContracts.value || []).reduce((s,c) => {
        const sa = parseFloat(c.subAmount) || 0;
        return s + (sa >= 100000 ? (parseFloat(c.presalePerformance) || 0) : 0);
      }, 0) / 10000;
    });
    const dashboardTotalAmount = computed(() => {
      return (filteredContracts.value || []).reduce((s,c) => s + (parseFloat(c.subAmount) || 0), 0) / 10000;
    });
    const dashboardAnnualTarget = computed(() => {
      const year = state.year;
      const target = userTargets.annualTargets[year] || state.fullState?.annualTarget || 0;
      return target > 0 ? target : '—';
    });
    const dashboardProgress = computed(() => {
      const target = userTargets.annualTargets[state.year] || state.fullState?.annualTarget || 0;
      if (!target) return -1;
      return Math.round((dashboardWonAmount.value / target) * 100);
    });



    return {
      state, loginUsername, loginPassword, loginLoading,
      doLogin, doLogout, loadState,
      dashboardStats,
      dashboardWonAmount, dashboardTotalAmount, dashboardAnnualTarget, dashboardProgress,
      filteredApps, filteredContracts, myFollows, myJudgments, mySalesQs, myAllocs,
      listRecords, groupedRecords,
      formData, formLoading,
      openModal, closeModal,
      userTargets, loadUserTargets, saveUserTargets, getComputedQuarterTarget,
      oldPwd, newPwd, confirmPwd, showOldPwd, showNewPwd, showConfirmPwd,
      doChangePassword, pwdLoading,
      getListItemTitle, getListItemSub,
      getStatusBadge, fmtMoney, fmtDate, getDeptName, getEmpName,
      changeYear, listTabToModal, modalTitle, getFieldsForModal,
      PRODUCTS, BUY_MODES, STAGES, APP_STATUSES, YES_NO, QUARTERS,
      APP_FIELDS, CONTRACT_FIELDS, FOLLOW_FIELDS, JUDGMENT_FIELDS,
      SALES_Q_FIELDS, ALLOCATION_FIELDS, DEPT_FIELDS, EMP_FIELDS,
      USER_FIELDS_ADMIN, USER_FIELDS_SELF,
      relatedContracts, relatedFollows, relatedJudgments, relatedSalesQs, relatedAllocs, allocContract,
      pickerStep, pickerSearch, pickerList, contractAllocStats, allocationPctOptions, doPickerSelect,
      queryPage, queryPageCount, queryPageRecords, queryFilteredApps,
      queryContracts, queryFollows, queryJudgments, querySalesQs, queryAllocs, querySelectedApp,
      boardApps, boardWonAmount, boardTotalAmount, boardAnnualTarget, boardProgress,
      boardByProduct, boardByStage, boardRecentFollows, boardPendingQs, boardAppMap,
    };
  },

  template: `
<div>
  <!-- Toast -->
  <div v-if="state.toast" class="m-toast" v-text="state.toast"></div>

  <!-- ══════════ LOGIN ══════════ -->
  <div v-if="!state.user" class="login-page">
    <div class="login-dingtalk-icon">🏢</div>
    <div class="login-title">售前管理</div>
    <div class="login-subtitle">移动端 · 钉钉风格</div>
    <div class="login-box">
      <div class="login-field">
        <div class="login-label">用户名</div>
        <input class="login-input" v-model="loginUsername" placeholder="请输入用户名" @keyup.enter="doLogin" autocomplete="username" />
      </div>
      <div class="login-field">
        <div class="login-label">密码</div>
        <input class="login-input" type="password" v-model="loginPassword" placeholder="请输入密码" @keyup.enter="doLogin" autocomplete="current-password" />
      </div>
      <button class="login-btn" :disabled="loginLoading" @click="doLogin">
        <span v-if="loginLoading">登录中…</span>
        <span v-else>登录</span>
      </button>
    </div>
  </div>

  <!-- ══════════ MAIN APP ══════════ -->
  <div v-else>

    <!-- Header -->
    <div class="dt-header">
      <div class="dt-header-title">售前管理</div>
      <div class="dt-header-right">
        <span class="dt-header-user" v-text="state.user.displayName || state.user.username"></span>
      </div>
    </div>

    <!-- ── Dashboard ── -->
    <div v-if="state.activeTab === 'dashboard'" class="dt-page">
      <!-- 年份选择 -->
      <div class="dt-year-bar">
        <button class="dt-year-btn" @click="changeYear(-1)">‹</button>
        <span class="dt-year-label">{{ state.year }}年</span>
        <button class="dt-year-btn" @click="changeYear(1)">›</button>
      </div>

      <!-- 核心指标卡 -->
      <div class="dt-stats-row">
        <div class="dt-stat-card dt-stat-primary">
          <div class="dt-stat-num" v-text="dashboardStats.total"></div>
          <div class="dt-stat-lbl">商机总数</div>
        </div>
        <div class="dt-stat-card dt-stat-success">
          <div class="dt-stat-num" v-text="dashboardStats.won"></div>
          <div class="dt-stat-lbl">签单数</div>
        </div>
        <div class="dt-stat-card dt-stat-danger">
          <div class="dt-stat-num" v-text="dashboardStats.lost"></div>
          <div class="dt-stat-lbl">丢失数</div>
        </div>
        <div class="dt-stat-card dt-stat-warning">
          <div class="dt-stat-num" v-text="dashboardStats.activeCount"></div>
          <div class="dt-stat-lbl">活跃</div>
        </div>
      </div>

      <!-- 金额指标 -->
      <!-- 签单金额 / 合同总额 / 年度目标（内联计算，不依赖有问题的 dashboardStats） -->
      <div class="dt-money-row">
        <div class="dt-money-item">
          <div class="dt-money-lbl">签单金额</div>
              <div class="dt-money-val dt-text-primary" v-text="fmtMoney(dashboardWonAmount) + ' 万'"></div>
        </div>
        <div class="dt-money-divider"></div>
        <div class="dt-money-item">
          <div class="dt-money-lbl">合同总额</div>
          <div class="dt-money-val" v-text="fmtMoney(dashboardTotalAmount) + ' 万'"></div>
        </div>
        <div class="dt-money-divider"></div>
        <div class="dt-money-item">
          <div class="dt-money-lbl">年度目标</div>
          <div class="dt-money-val dt-text-muted" v-text="dashboardAnnualTarget"></div>
        </div>
      </div>

      <!-- 进度条（如果有目标） -->
      <div v-if="dashboardProgress >= 0" class="dt-progress-card">
        <div class="dt-progress-label">
          <span>年度完成率</span>
          <span class="dt-text-primary dt-font-bold">{{ dashboardProgress }}%</span>
        </div>
        <div class="dt-progress-bar">
          <div class="dt-progress-fill dt-bg-primary" :style="{ width: Math.min(dashboardProgress, 100) + '%' }"></div>
        </div>
      </div>

      <!-- 设置目标入口 -->
      <div class="dt-set-target-btn" @click="openModal('setTargets','edit',{})">
        <span>🎯</span>
        <span>设置年度目标</span>
        <span class="dt-set-target-arrow">›</span>
      </div>

      <!-- 我的申请摘要（带搜索+状态过滤） -->
      <div class="dt-section-card">
        <div class="dt-section-hd" style="flex-wrap:wrap;gap:6px">
          <span class="dt-section-title">我的售前申请</span>
          <select class="dt-input dt-select" style="height:28px;font-size:12px;padding:0 8px;border-radius:8px;max-width:90px" v-model="state.filterStatus">
            <option value="">全部</option>
            <option v-for="s in APP_STATUSES" :key="s" :value="s" v-text="s"></option>
          </select>
        </div>
        <!-- 搜索框（跟数据页一样） -->
        <div class="dv-search-box" style="margin:6px 0">
          <span class="dv-search-icon">🔍</span>
          <input class="dv-search-input" v-model="state.searchText" placeholder="输入客户/项目/商机号/销售员…" style="background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.1);border-radius:8px;padding:7px 10px 7px 32px;color:#fff;font-size:13px" />
        </div>
        <div v-if="filteredApps.length === 0" class="dt-empty-cell">暂无数据</div>
        <div v-for="app in filteredApps" :key="app.id" class="dt-list-row" @click="openModal('app','view',app)">
          <div class="dt-list-info">
            <div class="dt-list-title" v-text="(app.customer||'') + (app.projectName ? ' / '+app.projectName : '')"></div>
            <div class="dt-list-sub" v-text="(app.oppNo||'') + ' | ' + (app.product||'') + ' | ' + (app.currentStage||'')"></div>
          </div>
          <span class="dt-badge" :class="getStatusBadge(app.status)" v-text="app.status"></span>
        </div>
      </div>

    </div>

    <!-- ── Board（我的数据看板） ── -->
    <div v-if="state.activeTab === 'board'" class="dt-page board-page">
      <!-- 年份选择 -->
      <div class="dt-year-bar">
        <button class="dt-year-btn" @click="changeYear(-1)">‹</button>
        <span class="dt-year-label">{{ state.year }}年</span>
        <button class="dt-year-btn" @click="changeYear(1)">›</button>
      </div>

      <!-- 核心指标 -->
      <div class="board-stats-grid">
        <div class="board-stat-card board-stat-primary">
          <div class="board-stat-num" v-text="boardApps.length"></div>
          <div class="board-stat-lbl">我的商机</div>
        </div>
        <div class="board-stat-card board-stat-success">
          <div class="board-stat-num" v-text="boardApps.filter(a=>a.status==='签单').length"></div>
          <div class="board-stat-lbl">签单</div>
        </div>
        <div class="board-stat-card board-stat-warning">
          <div class="board-stat-num" v-text="boardApps.filter(a=>a.status==='活跃'||a.status==='预计').length"></div>
          <div class="board-stat-lbl">跟进中</div>
        </div>
        <div class="board-stat-card board-stat-danger">
          <div class="board-stat-num" v-text="boardApps.filter(a=>a.status==='丢失').length"></div>
          <div class="board-stat-lbl">丢失</div>
        </div>
      </div>

      <!-- 金额汇总 -->
      <div class="board-money-card">
        <div class="board-money-row">
          <div class="board-money-item">
            <div class="board-money-lbl">签单金额</div>
            <div class="board-money-val primary" v-text="fmtMoney(boardWonAmount) + ' 万'"></div>
          </div>
          <div class="board-money-div"></div>
          <div class="board-money-item">
            <div class="board-money-lbl">合同总额</div>
            <div class="board-money-val" v-text="fmtMoney(boardTotalAmount) + ' 万'"></div>
          </div>
        </div>
        <!-- 进度 -->
        <div class="board-progress" v-if="boardProgress >= 0">
          <div class="board-progress-head">
            <span>年度完成率</span>
            <span class="board-progress-pct">{{ boardProgress }}%</span>
          </div>
          <div class="board-progress-bar">
            <div class="board-progress-fill" :style="{ width: Math.min(boardProgress, 100) + '%' }"></div>
          </div>
          <div class="board-progress-target">目标 {{ fmtMoney(boardAnnualTarget) }} 万，已完成 {{ fmtMoney(boardWonAmount) }} 万</div>
        </div>
      </div>

      <!-- 各产品签单金额 -->
      <div class="board-section-card">
        <div class="board-section-hd">📊 产品线签单分布</div>
        <div v-if="boardByProduct.length === 0" class="board-empty">暂无数据</div>
        <div v-for="p in boardByProduct" :key="p.product" class="board-product-row">
          <div class="board-product-name" v-text="p.product"></div>
          <div class="board-product-bar-wrap">
            <div class="board-product-bar" :style="{ width: (boardWonAmount > 0 ? (p.won / (boardWonAmount * 10000) * 100) : 0) + '%' }"></div>
          </div>
          <div class="board-product-amount" v-text="fmtMoney(p.won / 10000) + ' 万'"></div>
        </div>
      </div>

      <!-- 各阶段分布 -->
      <div class="board-section-card">
        <div class="board-section-hd">🔄 商机阶段分布</div>
        <div v-if="boardByStage.length === 0" class="board-empty">暂无数据</div>
        <div v-for="s in boardByStage" :key="s.stage" class="board-stage-row">
          <div class="board-stage-name" v-text="s.stage"></div>
          <div class="board-stage-count" v-text="s.count + ' 个'"></div>
        </div>
      </div>

      <!-- 近期动态 -->
      <div class="board-section-card">
        <div class="board-section-hd">🕐 近期跟进动态</div>
        <div v-if="boardRecentFollows.length === 0" class="board-empty">暂无跟进记录</div>
        <div v-for="f in boardRecentFollows" :key="f.id" class="board-recent-item">
          <div class="board-recent-date" v-text="fmtDate(f.followDate)"></div>
          <div class="board-recent-title" v-text="f.workItem"></div>
          <div class="board-recent-consultant" v-text="f.consultantName || '—'"></div>
          <div class="board-recent-customer" v-text="boardAppMap[f.oppNo] || f.oppNo"></div>
        </div>
      </div>

    </div>

    <!-- ── List ── -->
    <div v-if="state.activeTab === 'list'" class="dt-page dv-page">
      <!-- 搜索框 -->
      <div class="dv-search-box">
        <span class="dv-search-icon">🔍</span>
        <input class="dv-search-input" v-model="state.querySearchText"
          placeholder="输入商机号 / 客户名称 / 销售员 / 合同号…" @keyup.enter="queryPage = 1" />
      </div>

      <!-- 搜索结果列表（未选中时） -->
      <div v-if="!state.querySelectedOppNo" class="dv-list">
        <div v-if="queryFilteredApps.length === 0" class="dv-empty">
          <div class="dv-empty-icon">📭</div>
          <div class="dv-empty-text">无匹配记录</div>
        </div>
        <div v-for="app in queryPageRecords" :key="app.id" class="dv-app-card" @click="state.querySelectedOppNo = app.oppNo; state.queryDetailTab = 'contract'">
          <div class="dv-app-card-top">
            <div class="dv-app-name" v-text="(app.customer||'') + (app.projectName ? ' / '+app.projectName : '')"></div>
            <span class="dv-status-badge" :class="getStatusBadge(app.status)" v-text="app.status"></span>
          </div>
          <div class="dv-app-meta" v-text="app.oppNo + '  ·  ' + (app.applicant||'') + '  ·  ' + (app.product||'')"></div>
        </div>
        <!-- 分页 -->
        <div v-if="queryPageCount > 1" class="dv-pager">
          <button class="dv-pager-btn" :disabled="queryPage <= 1" @click="queryPage--">‹ 上一页</button>
          <span class="dv-pager-idx">{{ queryPage }} / {{ queryPageCount }}</span>
          <button class="dv-pager-btn" :disabled="queryPage >= queryPageCount" @click="queryPage++">下一页 ›</button>
        </div>
      </div>

      <!-- 选中商机后：摘要 + 关联数据 Tab -->
      <template v-else>
        <!-- 选中商机标题栏 -->
        <div class="dv-selected-hdr">
          <button class="dv-back-btn" @click="state.querySelectedOppNo = ''">‹ 返回</button>
          <div class="dv-selected-info">
            <div class="dv-selected-name" v-text="(querySelectedApp?.customer||'') + (querySelectedApp?.projectName ? ' / '+querySelectedApp.projectName : '')"></div>
            <div class="dv-selected-meta" v-text="(querySelectedApp?.oppNo||'') + '  ·  ' + (querySelectedApp?.applicant||'') + '  ·  ' + (querySelectedApp?.product||'')"></div>
          </div>
        </div>

        <!-- 关联数据 Tab -->
        <div class="dv-tab-bar">
          <div class="dv-tab" :class="{ active: state.queryDetailTab === 'contract' }" @click="state.queryDetailTab = 'contract'">合同<span v-if="queryContracts.length" class="dv-tab-count">{{ queryContracts.length }}</span></div>
          <div class="dv-tab" :class="{ active: state.queryDetailTab === 'follow' }" @click="state.queryDetailTab = 'follow'">跟进<span v-if="queryFollows.length" class="dv-tab-count">{{ queryFollows.length }}</span></div>
          <div class="dv-tab" :class="{ active: state.queryDetailTab === 'judgment' }" @click="state.queryDetailTab = 'judgment'">判断<span v-if="queryJudgments.length" class="dv-tab-count">{{ queryJudgments.length }}</span></div>
          <div class="dv-tab" :class="{ active: state.queryDetailTab === 'salesQ' }" @click="state.queryDetailTab = 'salesQ'">问答<span v-if="querySalesQs.length" class="dv-tab-count">{{ querySalesQs.length }}</span></div>
          <div class="dv-tab" :class="{ active: state.queryDetailTab === 'alloc' }" @click="state.queryDetailTab = 'alloc'">分配<span v-if="queryAllocs.length" class="dv-tab-count">{{ queryAllocs.length }}</span></div>
        </div>

        <!-- Tab 内容 -->
        <div class="dv-detail-body">
          <!-- 合同 -->
          <template v-if="state.queryDetailTab === 'contract'">
            <div v-if="queryContracts.length === 0" class="dv-no-data">暂无关联合同</div>
            <div v-for="c in queryContracts" :key="c.id" class="dv-record-card">
              <div class="dv-record-row"><span class="dv-record-label">签约客户</span><span class="dv-record-val" v-text="c.signCustomerName || c.signCustomer || '—'"></span></div>
              <div class="dv-record-row"><span class="dv-record-label">产品</span><span class="dv-record-val" v-text="c.product||'—'"></span></div>
              <div class="dv-record-row"><span class="dv-record-label">合同金额</span><span class="dv-record-val highlight" v-text="c.subAmount ? fmtMoney(c.subAmount)+' 元' : '—'"></span></div>
              <div class="dv-record-row"><span class="dv-record-label">实际成本</span><span class="dv-record-val" v-text="c.actualCost ? fmtMoney(c.actualCost)+' 元' : '—'"></span></div>
              <div class="dv-record-row"><span class="dv-record-label">订阅业绩</span><span class="dv-record-val" v-text="c.subPerformance ? fmtMoney(c.subPerformance)+' 元' : '—'"></span></div>
              <div class="dv-record-row"><span class="dv-record-label">售前业绩</span><span class="dv-record-val" v-text="c.presalePerformance ? fmtMoney(c.presalePerformance)+' 元' : '—'"></span></div>
              <div class="dv-record-row"><span class="dv-record-label">客户经理</span><span class="dv-record-val" v-text="c.accountMgr || '—'"></span></div>
              <div class="dv-record-row"><span class="dv-record-label">销售部门</span><span class="dv-record-val" v-text="c.salesDept || '—'"></span></div>
              <div class="dv-record-row"><span class="dv-record-label">主合同号</span><span class="dv-record-val" v-text="c.mainContractNo || '—'"></span></div>
              <div class="dv-record-row"><span class="dv-record-label">签约商机</span><span class="dv-record-val" v-text="c.signOppNo || '—'"></span></div>
              <div class="dv-record-row"><span class="dv-record-label">云订阅</span><span class="dv-record-val" v-text="c.isCloudSub || '—'"></span></div>
              <div class="dv-record-row"><span class="dv-record-label">主签日期</span><span class="dv-record-val" v-text="c.mainSignDate || '—'"></span></div>
              <div class="dv-record-row"><span class="dv-record-label">伙伴结算</span><span class="dv-record-val" v-text="c.partnerSettle || '—'"></span></div>
              <div class="dv-record-row"><span class="dv-record-label">备注</span><span class="dv-record-val" v-text="c.remarks || '—'"></span></div>
            </div>
          </template>
          <!-- 跟进 -->
          <template v-if="state.queryDetailTab === 'follow'">
            <div v-if="queryFollows.length === 0" class="dv-no-data">暂无关联跟进</div>
            <div v-for="f in queryFollows" :key="f.id" class="dv-record-card">
              <div class="dv-record-row"><span class="dv-record-label">日期</span><span class="dv-record-val" v-text="fmtDate(f.followDate)"></span></div>
              <div class="dv-record-row"><span class="dv-record-label">工时</span><span class="dv-record-val highlight" v-text="(f.hours||'—')+' h'"></span></div>
              <div class="dv-record-row"><span class="dv-record-label">工作事项</span><span class="dv-record-val" v-text="f.workItem||'—'"></span></div>
              <div class="dv-record-row"><span class="dv-record-label">成果总结</span><span class="dv-record-val" v-text="f.summary||'—'"></span></div>
              <div class="dv-record-row"><span class="dv-record-label">下一步工作</span><span class="dv-record-val" v-text="f.nextWork||'—'"></span></div>
              <div class="dv-record-row"><span class="dv-record-label">预计时间</span><span class="dv-record-val" v-text="fmtDate(f.nextDate)"></span></div>
            </div>
          </template>
          <!-- 判断 -->
          <template v-if="state.queryDetailTab === 'judgment'">
            <div v-if="queryJudgments.length === 0" class="dv-no-data">暂无关联判断</div>
            <div v-for="j in queryJudgments" :key="j.id" class="dv-record-card">
              <div class="dv-record-row"><span class="dv-record-label">判断类型</span><span class="dv-record-val" v-text="j.judgmentType||'—'"></span></div>
              <div class="dv-record-row"><span class="dv-record-label">阶段</span><span class="dv-record-val" v-text="j.currentStage||'—'"></span></div>
              <div class="dv-record-row"><span class="dv-record-label">判断日期</span><span class="dv-record-val" v-text="fmtDate(j.judgmentDate)"></span></div>
              <div class="dv-record-row"><span class="dv-record-label">竞争对手</span><span class="dv-record-val" v-text="j.competitor||'—'"></span></div>
              <div class="dv-record-row"><span class="dv-record-label">判断结论</span><span class="dv-record-val" v-text="j.result||'—'"></span></div>
            </div>
          </template>
          <!-- 问答 -->
          <template v-if="state.queryDetailTab === 'salesQ'">
            <div v-if="querySalesQs.length === 0" class="dv-no-data">暂无关联问答</div>
            <div v-for="q in querySalesQs" :key="q.id" class="dv-record-card">
              <div class="dv-qa-q">Q{{ q.seq||'?' }}：{{ q.question||'' }}</div>
              <div class="dv-qa-a" :class="{ unanswered: !q.answer }">A：{{ q.answer||'(待回答)' }}</div>
              <div v-if="q.note" class="dv-record-row" style="margin-top:6px"><span class="dv-record-label">备注</span><span class="dv-record-val" v-text="q.note"></span></div>
            </div>
          </template>
          <!-- 分配 -->
          <template v-if="state.queryDetailTab === 'alloc'">
            <div v-if="queryContracts.length > 0" class="dv-alloc-summary">合同总额 <strong>{{ fmtMoney(queryContracts.reduce((s,c)=>s+(parseFloat(c.subAmount)||0),0)) }}</strong> 元</div>
            <div v-if="queryAllocs.length === 0" class="dv-no-data">暂无关联分配</div>
            <div v-for="a in queryAllocs" :key="a.id" class="dv-record-card">
              <div class="dv-record-row"><span class="dv-record-label">顾问</span><span class="dv-record-val" v-text="a.consultant||'—'"></span></div>
              <div class="dv-record-row"><span class="dv-record-label">部门</span><span class="dv-record-val" v-text="a.department||'—'"></span></div>
              <div class="dv-record-row"><span class="dv-record-label">季度</span><span class="dv-record-val" v-text="(a.quarter||'')+' '+ (a.month||'')"></span></div>
              <div class="dv-record-row"><span class="dv-record-label">分配比例</span><span class="dv-record-val highlight" v-text="(a.pct||0)+'%'"></span></div>
              <div class="dv-record-row"><span class="dv-record-label">顾问业绩</span><span class="dv-record-val" v-text="fmtMoney(a.consultantPerformance||0)+' 元'"></span></div>
              <div class="dv-record-row"><span class="dv-record-label">售前业绩</span><span class="dv-record-val" v-text="a.presalePerformance ? fmtMoney(a.presalePerformance)+' 元' : '—'"></span></div>
              <div class="dv-record-row"><span class="dv-record-label">备注</span><span class="dv-record-val" v-text="a.remarks||'—'"></span></div>
            </div>
          </template>
        </div>
      </template>
    </div>
    <!-- ── Admin ── -->
    <div v-if="state.activeTab === 'admin' && state.user?.role === 'admin'" class="dt-page admin-page">
      <!-- admin 子导航 -->
      <div v-if="!state.activeAdminSub" class="admin-main">
        <div class="admin-welcome">⚙️ 系统管理</div>
        <div class="admin-menu-grid">
          <div class="admin-card" @click="state.activeAdminSub = 'dept'">
            <div class="admin-card-icon">🏢</div>
            <div class="admin-card-title">部门管理</div>
            <div class="admin-card-sub">查看/添加/编辑部门</div>
          </div>
          <div class="admin-card" @click="state.activeAdminSub = 'emp'">
            <div class="admin-card-icon">👥</div>
            <div class="admin-card-title">员工管理</div>
            <div class="admin-card-sub">查看/添加/编辑员工</div>
          </div>
          <div class="admin-card" @click="state.activeAdminSub = 'user'">
            <div class="admin-card-icon">🔐</div>
            <div class="admin-card-title">用户管理</div>
            <div class="admin-card-sub">查看/添加/编辑用户</div>
          </div>
        </div>
      </div>

      <!-- 子页面（部门/员工/用户） -->
      <div v-if="state.activeAdminSub" class="admin-sub-page">
        <div class="admin-sub-hdr">
          <div class="admin-sub-back" @click="state.activeAdminSub = ''">‹ 返回</div>
          <div class="admin-sub-title">
            {{ state.activeAdminSub === 'dept' ? '部门管理' : state.activeAdminSub === 'emp' ? '员工管理' : '用户管理' }}
          </div>
          <div class="admin-sub-add" @click="openModal(state.activeAdminSub,'create',{})">+ 新增</div>
        </div>
        <div class="admin-list">
          <!-- 部门 -->
          <template v-if="state.activeAdminSub === 'dept'">
            <div v-if="(state.fullState?.departments||[]).length === 0" class="admin-empty">暂无部门</div>
            <div v-for="d in state.fullState?.departments||[]" :key="d.id" class="admin-row" @click="openModal('dept','edit',d)">
              <div class="admin-row-main" v-text="d.name"></div>
              <div class="admin-row-sub" v-text="(d.manager ? '负责人: '+d.manager : '')"></div>
            </div>
          </template>
          <!-- 员工 -->
          <template v-if="state.activeAdminSub === 'emp'">
            <div v-if="(state.fullState?.employees||[]).length === 0" class="admin-empty">暂无员工</div>
            <div v-for="e in state.fullState?.employees||[]" :key="e.id" class="admin-row" @click="openModal('emp','edit',e)">
              <div class="admin-row-main" v-text="e.name + (e.position ? ' ('+e.position+')' : '')"></div>
              <div class="admin-row-sub" v-text="getDeptName(e.deptId)+(e.mobile?' · '+e.mobile:'')"></div>
            </div>
          </template>
          <!-- 用户 -->
          <template v-if="state.activeAdminSub === 'user'">
            <div v-if="(state.adminUsers||[]).length === 0" class="admin-empty">暂无用户</div>
            <div v-for="u in (state.adminUsers||[])" :key="u.id" class="admin-row" @click="openModal('user','edit',u)">
              <div class="admin-row-main" v-text="u.display_name || u.username"></div>
              <div class="admin-row-sub" v-text="(u.role==='admin'?'管理员':'普通用户') + (u.department?' · '+u.department:'') + (u.created_at ? ' · '+u.created_at.slice(0,10) : '')"></div>
            </div>
          </template>
        </div>
      </div>
    </div>

    <!-- ── Profile ── -->
    <div v-if="state.activeTab === 'profile'" class="dt-page">
      <!-- 头像区 -->
      <div class="profile-hero">
        <div class="profile-avatar-ring">
          <div class="profile-avatar" v-text="(state.user.displayName || state.user.username || '?').slice(0,1)"></div>
        </div>
        <div class="profile-name" v-text="state.user.displayName || state.user.username"></div>
        <div class="profile-badges">
          <span class="profile-badge" :class="state.user.role === 'admin' ? 'badge-admin' : 'badge-user'">
            {{ state.user.role === 'admin' ? '👑 管理员' : '👤 顾问' }}
          </span>
          <span v-if="state.user.department" class="profile-badge badge-dept" v-text="state.user.department"></span>
        </div>
      </div>

      <!-- 本年统计 -->
      <div class="profile-stats">
        <div class="stat-item">
          <div class="stat-num" v-text="dashboardStats.total"></div>
          <div class="stat-lbl">我的申请</div>
        </div>
        <div class="stat-divider"></div>
        <div class="stat-item">
          <div class="stat-num" v-text="dashboardStats.won"></div>
          <div class="stat-lbl">签单</div>
        </div>
        <div class="stat-divider"></div>
        <div class="stat-item">
          <div class="stat-num dt-text-primary" v-text="fmtMoney(dashboardStats.wonAmount)"></div>
          <div class="stat-lbl">签单金额</div>
        </div>
      </div>

      <!-- 菜单 -->
      <div class="profile-menu">
        <div class="profile-menu-item" @click="openModal('selfProfile','view',{})">
          <div class="menu-icon-wrap" style="background:rgba(251,191,36,0.12)">🔑</div>
          <div class="menu-text">
            <div class="menu-title">修改密码</div>
            <div class="menu-sub">修改登录密码</div>
          </div>
          <div class="menu-arrow">›</div>
        </div>
        <div class="profile-menu-item" @click="doLogout">
          <div class="menu-icon-wrap" style="background:rgba(239,68,68,0.12)">🚪</div>
          <div class="menu-text">
            <div class="menu-title dt-text-danger">退出登录</div>
          </div>
          <div class="menu-arrow">›</div>
        </div>
      </div>
    </div>

    <!-- ── Tab Bar ── -->
    <div class="dt-tabbar">
      <div class="dt-tab-item" :class="{ active: state.activeTab === 'dashboard' }" @click="state.activeTab = 'dashboard'">
        <div class="dt-tab-icon">🏠</div>
        <div class="dt-tab-lbl">首页</div>
      </div>
      <div class="dt-tab-item" :class="{ active: state.activeTab === 'list' }" @click="state.activeTab = 'list'">
        <div class="dt-tab-icon">📋</div>
        <div class="dt-tab-lbl">数据</div>
      </div>
      <div class="dt-tab-item" :class="{ active: state.activeTab === 'board' }" @click="state.activeTab = 'board'">
        <div class="dt-tab-icon">📊</div>
        <div class="dt-tab-lbl">看板</div>
      </div>
      <div class="dt-tab-item" :class="{ active: state.activeTab === 'profile' }" @click="state.activeTab = 'profile'">
        <div class="dt-tab-icon">👤</div>
        <div class="dt-tab-lbl">我的</div>
      </div>
      <div v-if="state.user?.role === 'admin'" class="dt-tab-item" :class="{ active: state.activeTab === 'admin' }" @click="state.activeTab = 'admin'">
        <div class="dt-tab-icon">⚙️</div>
        <div class="dt-tab-lbl">管理</div>
      </div>
    </div>
  </div>

  <!-- ══════════ MODAL ══════════ -->
  <div v-if="state.modal" class="dt-modal-overlay">
    <div class="dt-modal" @click.stop
         @touchstart="onModalTouchStart" @touchmove="onModalTouchMove" @touchend="onModalTouchEnd">

      <!-- Modal Header -->
      <div class="dt-modal-hd" :class="{'dt-modal-hd-dragging': dragOffset > 30}">
        <div class="dt-modal-pull-bar"></div>
        <div class="dt-modal-title">
          <span v-if="state.modal.mode === 'create'">新建</span>
          <span v-else-if="state.modal.mode === 'view'">详情</span>
          <span v-else>编辑</span>
          {{ modalTitle(state.modal.name) }}
        </div>
        <div class="dt-modal-close" @click="closeModal">✕</div>
      </div>

      <!-- Modal Body -->
      <div class="dt-modal-bd">

        <!-- ── 快捷录入：先选关联申请/合同 ── -->
        <template v-if="state.modal.mode === 'create' && pickerStep !== null">
          <div class="picker-hint">
            {{ pickerStep === 'contract' ? '选择关联的售前申请（合同将记录在该申请下）' :
               pickerStep === 'follow' ? '选择关联的售前申请' :
               pickerStep === 'judgment' ? '选择关联的售前申请' :
               pickerStep === 'salesQ' ? '选择关联的售前申请' :
               pickerStep === 'allocation' ? '选择关联的合同（分配将记录在该合同下）' :
               pickerStep === 'emp' ? '选择客户经理' : '选择关联记录' }}
          </div>
          <div class="search-bar">
            <span class="search-icon">🔍</span>
            <input v-model="pickerSearch" placeholder="搜索客户/商机号/项目…" class="" style="flex:1;padding:12px 0;background:transparent;border:none;outline:none;font-size:14px;color:#fff" />
          </div>
          <div class="picker-list">
            <div v-if="pickerList.length === 0" class="dt-empty-cell">无匹配记录</div>
            <div v-for="item in pickerList" :key="item.id" class="picker-item" @click="doPickerSelect(item)">
              <div style="flex:1;min-width:0">
                <div class="dt-list-title" v-if="pickerStep === 'emp'" v-text="item.name"></div>
                <div class="dt-list-title" v-else-if="item.customer || item.projectName" v-text="(item.customer||'') + (item.projectName ? ' / '+item.projectName : '')"></div>
                <div class="dt-list-title" v-else v-text="item.signCustomerName || item.signCustomer || item.oppNo"></div>
                <div class="dt-list-sub" v-if="pickerStep === 'emp'" v-text="(item.empNo||'') + (item.deptName ? ' | '+item.deptName : '')"></div>
                <div class="dt-list-sub" v-else v-text="item.oppNo + ' | ' + (item.applyDate || item.mainSignDate || '')"></div>
                <div v-if="pickerStep === 'allocation'" class="picker-alloc-hint"
                  :style="{ color: (contractAllocStats.get(item.id)?.remainPct || 100) > 0 ? '#4caf50' : '#f44336' }">
                  已分配 {{ contractAllocStats.get(item.id)?.usedPct || 0 }}% ｜ 剩余 {{ contractAllocStats.get(item.id)?.remainPct || 100 }}%
                </div>
              </div>
              <div class="dt-list-arrow">›</div>
            </div>
          </div>
          <button v-if="pickerStep !== 'allocation'" class="dt-btn dt-btn-default dt-btn-block" style="margin-top:12px" @click="pickerStep = null">取消并直接新建</button>
          <div v-if="pickerStep === 'allocation'" style="font-size:12px;color:#888;text-align:center;padding:8px 0">必须选择关联合同后才能分配</div>
        </template>

        <!-- 设置年度目标（edit mode，不需要关联申请） -->
        <template v-if="state.modal.name === 'setTargets'">
          <div class="dt-form-group">
            <div class="dt-form-label">{{ state.year }} 年度目标（万元）</div>
            <input type="number" class="dt-input" v-model.number="userTargets.annualTargets[state.year]" placeholder="例如：500" step="10" @blur="saveUserTargets()" />
          </div>
          <div class="dt-form-hint">填入数字即可，单位：万元。季度分解由系统自动按比例计算。</div>
          <div class="dt-form-group" style="margin-top:12px">
            <div class="dt-form-label">季度分解（系统自动计算）</div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-top:6px">
              <div v-for="q in ['Q1','Q2','Q3','Q4']" :key="q" style="border:1px solid #e0e0e0;border-radius:6px;padding:8px 10px">
                <div style="color:#888;font-size:12px">{{ q }} ({{ userTargets.quarterPcts[q] || 25 }}%)</div>
                <div style="font-size:12px;font-weight:bold;color:#fff;margin-top:2px">{{ getComputedQuarterTarget(q) }} 万</div>
              </div>
            </div>
          </div>
        </template>

        <!-- ══════════ 详情视图 ══════════ -->
        <template v-if="state.modal.mode === 'view'">

          <!-- 申请详情 -->
          <template v-if="state.modal.name === 'app'">
            <!-- 基本信息卡片 -->
            <div class="detail-card">
              <div class="detail-card-row">
                <div class="detail-cell">
                  <div class="detail-lbl">状态</div>
                  <div class="detail-val"><span class="dt-badge" :class="getStatusBadge(formData.status)" v-text="formData.status"></span></div>
                </div>
                <div class="detail-cell">
                  <div class="detail-lbl">申请人</div>
                  <div class="detail-val" v-text="formData.applicant || '—'"></div>
                </div>
              </div>
              <div class="detail-card-row">
                <div class="detail-cell">
                  <div class="detail-lbl">客户</div>
                  <div class="detail-val" v-text="formData.customer || '—'"></div>
                </div>
                <div class="detail-cell">
                  <div class="detail-lbl">项目</div>
                  <div class="detail-val" v-text="formData.projectName || '—'"></div>
                </div>
              </div>
              <div class="detail-card-row">
                <div class="detail-cell">
                  <div class="detail-lbl">产品</div>
                  <div class="detail-val" v-text="formData.product || '—'"></div>
                </div>
                <div class="detail-cell">
                  <div class="detail-lbl">当前阶段</div>
                  <div class="detail-val" v-text="formData.currentStage || '—'"></div>
                </div>
              </div>
              <div class="detail-card-row single">
                <div class="detail-cell full">
                  <div class="detail-lbl">商机编号</div>
                  <div class="detail-val mono" v-text="formData.oppNo || '—'"></div>
                </div>
              </div>
            </div>

            <!-- 关联合同 -->
            <div class="rel-section">
              <div class="rel-section-hd">📄 关联合同 <span v-if="relatedContracts.length > 0" class="rel-count" v-text="relatedContracts.length"></span></div>
              <div v-if="relatedContracts.length === 0" class="rel-empty">暂无关联合同</div>
              <div v-for="c in relatedContracts" :key="c.id" class="rel-card" @click="openModal('contract','view',c)">
                <div class="rel-card-main" v-text="c.signCustomerName || c.signCustomer || '—'"></div>
                <div class="rel-card-sub" v-text="fmtMoney(c.subAmount) + '元 | ' + fmtDate(c.mainSignDate)"></div>
              </div>
            </div>

            <!-- 关联跟进 -->
            <div class="rel-section">
              <div class="rel-section-hd">📋 关联跟进 <span v-if="relatedFollows.length > 0" class="rel-count" v-text="relatedFollows.length"></span></div>
              <div v-if="relatedFollows.length === 0" class="rel-empty">暂无关联跟进</div>
              <div v-for="f in relatedFollows" :key="f.id" class="rel-card" @click="openModal('follow','view',f)">
                <div class="rel-card-main" v-text="f.workItem || '跟进记录'"></div>
                <div class="rel-card-sub" v-text="fmtDate(f.followDate) + ' | ' + (f.hours||'')+'h'"></div>
              </div>
            </div>

            <!-- 关联判断 -->
            <div class="rel-section">
              <div class="rel-section-hd">🔍 关联判断 <span v-if="relatedJudgments.length > 0" class="rel-count" v-text="relatedJudgments.length"></span></div>
              <div v-if="relatedJudgments.length === 0" class="rel-empty">暂无关联判断</div>
              <div v-for="j in relatedJudgments" :key="j.id" class="rel-card" @click="openModal('judgment','view',j)">
                <div class="rel-card-main" v-text="j.currentStage || '判断记录'"></div>
                <div class="rel-card-sub" v-text="fmtDate(j.updatedAt) + ' | 竞争对手: ' + (j.competitor||'—')"></div>
              </div>
            </div>

            <!-- 关联问答列表 -->
            <div class="rel-section">
              <div class="rel-section-hd">💬 关联问答 <span v-if="relatedSalesQs.length > 0" class="rel-count" v-text="relatedSalesQs.length"></span></div>
              <div v-if="relatedSalesQs.length === 0" class="rel-empty">暂无关联问答</div>
              <div v-for="q in relatedSalesQs" :key="q.id" class="rel-card" @click="openModal('salesQ','edit',q)">
                <div class="rel-card-main" v-text="'Q'+q.seq+': '+(q.question||'').slice(0,40)"></div>
                <div class="rel-card-sub" v-text="(q.answer||'待回答').slice(0,50)"></div>
              </div>
            </div>
          </template>

          <!-- 合同详情 -->
          <template v-if="state.modal.name === 'contract'">
            <div class="detail-card">
              <div class="detail-card-row">
                <div class="detail-cell">
                  <div class="detail-lbl">签约客户</div>
                  <div class="detail-val" v-text="formData.signCustomerName || formData.signCustomer || '—'"></div>
                </div>
                <div class="detail-cell">
                  <div class="detail-lbl">合同金额</div>
                  <div class="detail-val dt-text-primary dt-font-bold" v-text="fmtMoney(formData.subAmount) + '元'"></div>
                </div>
              </div>
              <div class="detail-card-row">
                <div class="detail-cell">
                  <div class="detail-lbl">客户经理</div>
                  <div class="detail-val" v-text="formData.accountMgr || '—'"></div>
                </div>
                <div class="detail-cell">
                  <div class="detail-lbl">销售部门</div>
                  <div class="detail-val" v-text="formData.salesDept || '—'"></div>
                </div>
              </div>
              <div class="detail-card-row">
                <div class="detail-cell">
                  <div class="detail-lbl">所购产品</div>
                  <div class="detail-val" v-text="formData.product || '—'"></div>
                </div>
                <div class="detail-cell">
                  <div class="detail-lbl">签订日期</div>
                  <div class="detail-val" v-text="fmtDate(formData.mainSignDate)"></div>
                </div>
              </div>
              <div class="detail-card-row">
                <div class="detail-cell">
                  <div class="detail-lbl">关联商机号</div>
                  <div class="detail-val mono" v-text="formData.oppNo || '—'"></div>
                </div>
                <div class="detail-cell">
                  <div class="detail-lbl">是否云订阅</div>
                  <div class="detail-val" v-text="formData.isCloudSub || '—'"></div>
                </div>
              </div>
              <div class="detail-card-row">
                <div class="detail-cell">
                  <div class="detail-lbl">售前合同业绩</div>
                  <div class="detail-val dt-text-primary" v-text="formData.presalePerformance != null ? fmtMoney(formData.presalePerformance) + '元' : '—'"></div>
                </div>
                <div class="detail-cell">
                  <div class="detail-lbl">订阅业绩</div>
                  <div class="detail-val" v-text="formData.subPerformance != null ? fmtMoney(formData.subPerformance) + '元' : '—'"></div>
                </div>
              </div>
              <div class="detail-card-row">
                <div class="detail-cell">
                  <div class="detail-lbl">实际成本</div>
                  <div class="detail-val" v-text="formData.actualCost != null ? fmtMoney(formData.actualCost) + '元' : '—'"></div>
                </div>
                <div class="detail-cell">
                  <div class="detail-lbl">伙伴结算</div>
                  <div class="detail-val" v-text="formData.partnerSettle || '—'"></div>
                </div>
              </div>
              <div class="detail-card-row">
                <div class="detail-cell">
                  <div class="detail-lbl">签约商机编号</div>
                  <div class="detail-val mono" v-text="formData.signOppNo || '—'"></div>
                </div>
                <div class="detail-cell">
                  <div class="detail-lbl">工时商机号</div>
                  <div class="detail-val mono" v-text="formData.workOrderNo || '—'"></div>
                </div>
              </div>
              <div class="detail-card-row single">
                <div class="detail-cell full">
                  <div class="detail-lbl">主合同编号</div>
                  <div class="detail-val mono" v-text="formData.mainContractNo || '—'"></div>
                </div>
              </div>
              <div class="detail-card-row single" v-if="formData.remarks">
                <div class="detail-cell full">
                  <div class="detail-lbl">备注</div>
                  <div class="detail-val" v-text="formData.remarks"></div>
                </div>
              </div>
            </div>

            <!-- 关联分配 -->
            <div class="rel-section">
              <div class="rel-section-hd">💰 关联业绩分配 <span v-if="relatedAllocs.length > 0" class="rel-count" v-text="relatedAllocs.length"></span></div>
              <div v-if="relatedAllocs.length === 0" class="rel-empty">暂无关联分配</div>
              <div v-for="a in relatedAllocs" :key="a.id" class="rel-card" @click="openModal('allocation','view',a)">
                <div class="rel-card-main" v-text="a.month + ' / ' + a.quarter"></div>
                <div class="rel-card-sub" v-text="'顾问业绩: ' + fmtMoney(a.consultantPerformance) + '元 | 比例: ' + (a.pct||'—') + '%'"></div>
              </div>
            </div>
          </template>

          <!-- 跟进详情 -->
          <template v-if="state.modal.name === 'follow'">
            <div class="detail-card">
              <div class="detail-card-row">
                <div class="detail-cell">
                  <div class="detail-lbl">商机号</div>
                  <div class="detail-val mono" v-text="formData.oppNo || '—'"></div>
                </div>
                <div class="detail-cell">
                  <div class="detail-lbl">日期</div>
                  <div class="detail-val" v-text="fmtDate(formData.followDate)"></div>
                </div>
              </div>
              <div class="detail-card-row single">
                <div class="detail-cell full">
                  <div class="detail-lbl">工作事项</div>
                  <div class="detail-val" v-text="formData.workItem || '—'"></div>
                </div>
              </div>
              <div class="detail-card-row single">
                <div class="detail-cell full">
                  <div class="detail-lbl">成果总结</div>
                  <div class="detail-val" v-text="formData.summary || '—'"></div>
                </div>
              </div>
              <div class="detail-card-row single">
                <div class="detail-cell full">
                  <div class="detail-lbl">下一步工作</div>
                  <div class="detail-val" v-text="formData.nextWork || '—'"></div>
                </div>
              </div>
              <div class="detail-card-row">
                <div class="detail-cell">
                  <div class="detail-lbl">耗用工时</div>
                  <div class="detail-val" v-text="(formData.hours||'') + 'h'"></div>
                </div>
                <div class="detail-cell">
                  <div class="detail-lbl">预计时间</div>
                  <div class="detail-val" v-text="fmtDate(formData.nextDate)"></div>
                </div>
              </div>
            </div>
          </template>

          <!-- 判断详情 -->
          <template v-if="state.modal.name === 'judgment'">
            <div class="detail-card">
              <div class="detail-card-row">
                <div class="detail-cell">
                  <div class="detail-lbl">商机号</div>
                  <div class="detail-val mono" v-text="formData.oppNo || '—'"></div>
                </div>
                <div class="detail-cell">
                  <div class="detail-lbl">当前阶段</div>
                  <div class="detail-val" v-text="formData.currentStage || '—'"></div>
                </div>
              </div>
              <div class="detail-card-row">
                <div class="detail-cell">
                  <div class="detail-lbl">竞争对手</div>
                  <div class="detail-val" v-text="formData.competitor || '—'"></div>
                </div>
                <div class="detail-cell">
                  <div class="detail-lbl">判断日期</div>
                  <div class="detail-val" v-text="fmtDate(formData.judgmentDate)"></div>
                </div>
              </div>
              <div class="detail-card-row single">
                <div class="detail-cell full">
                  <div class="detail-lbl">判断结论</div>
                  <div class="detail-val" v-text="formData.result || '—'"></div>
                </div>
              </div>
            </div>
          </template>

          <!-- 问答详情（对话卡片样式） -->
          <template v-if="state.modal.name === 'salesQ'">
            <div class="detail-card">
              <div class="detail-card-row">
                <div class="detail-cell">
                  <div class="detail-lbl">商机号</div>
                  <div class="detail-val mono" v-text="formData.oppNo || '—'"></div>
                </div>
                <div class="detail-cell">
                  <div class="detail-lbl">序号</div>
                  <div class="detail-val" v-text="formData.seq || '—'"></div>
                </div>
              </div>
            </div>
            <!-- 问题气泡 -->
            <div class="qa-bubble qa-question">
              <div class="qa-bubble-label">❓ 问题</div>
              <div class="qa-bubble-text" v-text="formData.question || '—'"></div>
            </div>
            <!-- 回答气泡 -->
            <div class="qa-bubble qa-answer">
              <div class="qa-bubble-label">💡 回答</div>
              <div class="qa-bubble-text" v-text="formData.answer || '待回答...'"></div>
            </div>
            <!-- 备注 -->
            <div v-if="formData.note" class="qa-note">
              <div class="qa-note-label">📎 备注</div>
              <div class="qa-note-text" v-text="formData.note"></div>
            </div>
          </template>

          <!-- 分配详情 -->
          <template v-if="state.modal.name === 'allocation'">
            <div class="detail-card">
              <div class="detail-card-row">
                <div class="detail-cell">
                  <div class="detail-lbl">顾问</div>
                  <div class="detail-val" v-text="formData.consultant || '—'"></div>
                </div>
                <div class="detail-cell">
                  <div class="detail-lbl">分配比例</div>
                  <div class="detail-val dt-text-primary dt-font-bold" v-text="(formData.pct != null ? formData.pct + '%' : '—')"></div>
                </div>
              </div>
              <div class="detail-card-row">
                <div class="detail-cell">
                  <div class="detail-lbl">分配业绩(元)</div>
                  <div class="detail-val" v-text="fmtMoney(formData.consultantPerformance) + '元'"></div>
                </div>
                <div class="detail-cell">
                  <div class="detail-lbl">季度</div>
                  <div class="detail-val" v-text="formData.quarter || '—'"></div>
                </div>
              </div>
              <div class="detail-card-row">
                <div class="detail-cell">
                  <div class="detail-lbl">月份</div>
                  <div class="detail-val" v-text="formData.month || '—'"></div>
                </div>
                <div class="detail-cell">
                  <div class="detail-lbl">关联商机号</div>
                  <div class="detail-val mono" v-text="formData.oppNo || '—'"></div>
                </div>
              </div>
              <div class="detail-card-row single" v-if="allocContract">
                <div class="detail-cell full">
                  <div class="detail-lbl">关联合同金额</div>
                  <div class="detail-val" v-text="allocContract.subAmount ? fmtMoney(allocContract.subAmount) + '元' : '—'"></div>
                </div>
              </div>
            </div>
          </template>

        <!-- 个人信息 -->
          <template v-if="state.modal.name === 'selfProfile'">
            <div class="profile-info-section">
              <div class="profile-info-row">
                <div class="profile-info-lbl">用户名</div>
                <div class="profile-info-val" v-text="state.user.username"></div>
              </div>
              <div class="profile-info-row">
                <div class="profile-info-lbl">角色</div>
                <div class="profile-info-val" v-text="state.user.role === 'admin' ? '管理员' : '顾问'"></div>
              </div>
              <div class="profile-info-row">
                <div class="profile-info-lbl">显示名</div>
                <div class="profile-info-val" v-text="state.user.displayName || state.user.username"></div>
              </div>
              <div class="profile-info-row">
                <div class="profile-info-lbl">部门</div>
                <div class="profile-info-val" v-text="state.user.department || '—'"></div>
              </div>
            </div>

            <div class="profile-pwd-area">
              <div class="profile-pwd-title">🔑 修改密码</div>
              <div class="profile-pwd-row">
                <div class="dt-form-label">旧密码</div>
                <div class="pwd-input-wrap">
                  <input :type="showOldPwd ? 'text' : 'password'" class="dt-input" v-model="oldPwd" placeholder="请输入旧密码" autocomplete="current-password" />
                  <span class="pwd-eye" @click="showOldPwd = !showOldPwd">{{ showOldPwd ? '🙈' : '👁️' }}</span>
                </div>
              </div>
              <div class="profile-pwd-row">
                <div class="dt-form-label">新密码</div>
                <div class="pwd-input-wrap">
                  <input :type="showNewPwd ? 'text' : 'password'" class="dt-input" v-model="newPwd" placeholder="至少6位" autocomplete="new-password" />
                  <span class="pwd-eye" @click="showNewPwd = !showNewPwd">{{ showNewPwd ? '🙈' : '👁️' }}</span>
                </div>
              </div>
              <div class="profile-pwd-row">
                <div class="dt-form-label">确认新密码</div>
                <div class="pwd-input-wrap">
                  <input :type="showConfirmPwd ? 'text' : 'password'" class="dt-input" v-model="confirmPwd" placeholder="再输入一次" @keyup.enter="doChangePassword" autocomplete="new-password" />
                  <span class="pwd-eye" @click="showConfirmPwd = !showConfirmPwd">{{ showConfirmPwd ? '🙈' : '👁️' }}</span>
                </div>
              </div>
              <button class="dt-btn dt-btn-primary dt-btn-full" :disabled="pwdLoading" @click="doChangePassword">{{ pwdLoading ? '修改中…' : '确认修改密码' }}</button>
            </div>
          </template>

        </template>

        <!-- ── 申请表单 ── -->
        <template v-else-if="state.modal.name === 'app' && state.modal.mode !== 'view' && pickerStep === null">
          <div class="dt-form">
            <div v-for="field in APP_FIELDS" :key="field.key" class="dt-form-group">
              <div class="dt-form-label" v-text="field.label + (field.required ? ' *' : '')"></div>
              <select v-if="field.type === 'select'" class="dt-input dt-select" v-model="formData[field.key]" :disabled="state.modal.mode === 'view'">
                <option v-for="opt in field.options" :key="opt" :value="opt" v-text="opt"></option>
              </select>
              <textarea v-else-if="field.type === 'textarea'" class="dt-input dt-textarea" v-model="formData[field.key]" :disabled="state.modal.mode === 'view'" :rows="field.key === 'coreRequirement' ? 4 : 3"></textarea>
              <input v-else :type="field.type === 'number' ? 'number' : 'text'" class="dt-input" v-model="formData[field.key]" :disabled="state.modal.mode === 'view'" />
            </div>
          </div>
        </template>

        <!-- ── 合同表单 ── -->
        <template v-else-if="state.modal.name === 'contract' && state.modal.mode !== 'view' && pickerStep === null">
          <div class="dt-form">
            <!-- 客户经理（组织架构选择） -->
            <div class="dt-form-group">
              <div class="dt-form-label">客户经理 *</div>
              <div class="dt-input dt-input-chooser" :class="{ 'chooser-active': formData.accountMgr }" @click="pickerStep = 'emp'; pickerSearch = ''">
                <span v-if="formData.accountMgr" v-text="formData.accountMgr"></span>
                <span v-else style="color:#999">点击选择客户经理</span>
              </div>
            </div>

            <!-- 销售部门（随客户经理自动带出，黑底白字） -->
            <div class="dt-form-group">
              <div class="dt-form-label">销售部门</div>
              <div class="dt-input" style="background:rgba(255,255,255,0.08);color:#fff" v-text="formData.salesDept || '—'"></div>
            </div>

            <div v-for="field in CONTRACT_FIELDS" :key="field.key" class="dt-form-group">
              <div class="dt-form-label" v-text="field.label + (field.required ? ' *' : '')"></div>
              <select v-if="field.type === 'select'" class="dt-input dt-select" v-model="formData[field.key]">
                <option v-for="opt in field.options" :key="opt" :value="opt" v-text="opt"></option>
              </select>
              <input v-else :type="field.type === 'number' ? 'number' : 'text'" class="dt-input" v-model="formData[field.key]" />
            </div>
          </div>
        </template>

        <!-- ── 跟进表单 ── -->
        <template v-else-if="state.modal.name === 'follow' && state.modal.mode !== 'view' && pickerStep === null">
          <div class="dt-form">
            <div v-for="field in FOLLOW_FIELDS" :key="field.key" class="dt-form-group">
              <div class="dt-form-label" v-text="field.label + (field.required ? ' *' : '')"></div>
              <textarea v-if="field.type === 'textarea'" class="dt-input dt-textarea" v-model="formData[field.key]" rows="3"></textarea>
              <input v-else :type="field.type === 'number' ? 'number' : 'text'" class="dt-input" v-model="formData[field.key]" />
            </div>
          </div>
        </template>

        <!-- ── 判断表单 ── -->
        <template v-else-if="state.modal.name === 'judgment' && state.modal.mode !== 'view' && pickerStep === null">
          <div class="dt-form">
            <div v-for="field in JUDGMENT_FIELDS" :key="field.key" class="dt-form-group">
              <div class="dt-form-label" v-text="field.label + (field.required ? ' *' : '')"></div>
              <textarea v-if="field.type === 'textarea'" class="dt-input dt-textarea" v-model="formData[field.key]" rows="3"></textarea>
              <input v-else :type="field.type === 'number' ? 'number' : 'text'" class="dt-input" v-model="formData[field.key]" />
            </div>
          </div>
        </template>

        <!-- ── 问答表单 ── -->
        <template v-else-if="state.modal.name === 'salesQ' && state.modal.mode !== 'view' && pickerStep === null">
          <div class="dt-form">
            <div v-for="field in SALES_Q_FIELDS" :key="field.key" class="dt-form-group">
              <div class="dt-form-label" v-text="field.label + (field.required ? ' *' : '')"></div>
              <textarea v-if="field.type === 'textarea'" class="dt-input dt-textarea" v-model="formData[field.key]" rows="3"></textarea>
              <input v-else :type="field.type === 'number' ? 'number' : 'text'" class="dt-input" v-model="formData[field.key]" />
            </div>
          </div>
        </template>

        <!-- ── 分配表单 ── -->
        <template v-else-if="state.modal.name === 'allocation' && state.modal.mode !== 'view' && pickerStep === null">
          <div class="dt-form">
            <!-- 剩余比例提示 -->
            <div v-if="formData.contractId" class="alloc-remain-hint">
              <span v-if="contractAllocStats.get(formData.contractId)">
                已分配 {{ contractAllocStats.get(formData.contractId).usedPct }}% ｜ 剩余可分配 {{ contractAllocStats.get(formData.contractId).remainPct }}%
              </span>
              <span v-else>已分配 0% ｜ 剩余可分配 100%</span>
            </div>

            <!-- 商机号（只读） -->
            <div class="dt-form-group">
              <div class="dt-form-label">商机号 *</div>
              <input type="text" class="dt-input" v-model="formData.oppNo" readonly />
            </div>

            <!-- 顾问 -->
            <div class="dt-form-group">
              <div class="dt-form-label">顾问 *</div>
              <input type="text" class="dt-input" v-model="formData.consultant" placeholder="输入顾问姓名" />
            </div>

            <!-- 月份（同时自动识别季度） -->
            <div class="dt-form-group">
              <div class="dt-form-label">月份</div>
              <input type="month" class="dt-input" v-model="formData.month"
                @change="formData.quarter = ''
                  + (() => { const m = parseInt((formData.month||'').split('-')[1]); return m ? 'Q'+Math.ceil(m/3) : '' })()" />
            </div>

            <!-- 分配比例（自由填写，不超过剩余比例） -->
            <div class="dt-form-group">
              <div class="dt-form-label">分配比例(%) *</div>
              <input type="number" class="dt-input" v-model.number="formData.pct"
                :max="contractAllocStats.get(formData.contractId)?.remainPct || 100"
                placeholder="输入 0~100 的整数" min="0" step="5" />
            </div>

            <!-- 分配业绩（自动计算，不可编辑，黑底白字） -->
            <div class="dt-form-group">
              <div class="dt-form-label">分配业绩(元) <span style="color:#888;font-weight:normal">（自动计算）</span></div>
              <div class="dt-input" style="background:rgba(255,255,255,0.08);color:#fff;padding:10px 12px;border-radius:10px;font-weight:600">
                {{ allocContract?.subAmount && formData.pct ? fmtMoney((parseFloat(allocContract.subAmount)||0) * (parseFloat(formData.pct) || 0) / 100) + ' 元' : '—' }}
              </div>
            </div>
          </div>
        </template>

        <!-- ── 部门详情（view 模式） ── -->
        <template v-else-if="state.modal.name === 'dept' && state.modal.mode === 'view'">
          <div class="detail-card">
            <div class="detail-card-row">
              <div class="detail-cell">
                <div class="detail-lbl">部门ID</div>
                <div class="detail-val" v-text="formData.id || '—'"></div>
              </div>
              <div class="detail-cell">
                <div class="detail-lbl">部门名称</div>
                <div class="detail-val" v-text="formData.name || '—'"></div>
              </div>
            </div>
            <div class="detail-card-row" v-if="formData.manager">
              <div class="detail-cell">
                <div class="detail-lbl">负责人</div>
                <div class="detail-val" v-text="formData.manager"></div>
              </div>
            </div>
          </div>
        </template>

        <!-- ── 员工详情（view 模式） ── -->
        <template v-else-if="state.modal.name === 'emp' && state.modal.mode === 'view'">
          <div class="detail-card">
            <div class="detail-card-row">
              <div class="detail-cell">
                <div class="detail-lbl">员工ID</div>
                <div class="detail-val" v-text="formData.id || '—'"></div>
              </div>
              <div class="detail-cell">
                <div class="detail-lbl">姓名</div>
                <div class="detail-val" v-text="formData.name || '—'"></div>
              </div>
            </div>
            <div class="detail-card-row">
              <div class="detail-cell">
                <div class="detail-lbl">部门</div>
                <div class="detail-val" v-text="getDeptName(formData.deptId) || '—'"></div>
              </div>
              <div class="detail-cell">
                <div class="detail-lbl">职位</div>
                <div class="detail-val" v-text="formData.position || '—'"></div>
              </div>
            </div>
            <div class="detail-card-row" v-if="formData.mobile">
              <div class="detail-cell">
                <div class="detail-lbl">手机</div>
                <div class="detail-val" v-text="formData.mobile"></div>
              </div>
            </div>
          </div>
        </template>

        <!-- ── 用户详情（view 模式） ── -->
        <template v-else-if="state.modal.name === 'user' && state.modal.mode === 'view'">
          <div class="detail-card">
            <div class="detail-card-row">
              <div class="detail-cell">
                <div class="detail-lbl">用户名</div>
                <div class="detail-val" v-text="formData.username || '—'"></div>
              </div>
              <div class="detail-cell">
                <div class="detail-lbl">显示名</div>
                <div class="detail-val" v-text="formData.display_name || '—'"></div>
              </div>
            </div>
            <div class="detail-card-row">
              <div class="detail-cell">
                <div class="detail-lbl">角色</div>
                <div class="detail-val" v-text="formData.role === 'admin' ? '管理员' : '普通用户'"></div>
              </div>
              <div class="detail-cell">
                <div class="detail-lbl">部门</div>
                <div class="detail-val" v-text="formData.department || '—'"></div>
              </div>
            </div>
          </div>
        </template>

        <!-- ── 部门表单（create/edit） ── -->
        <template v-else-if="state.modal.name === 'dept' && state.modal.mode !== 'view'">
          <div class="dt-form">
            <div class="dt-form-group">
              <div class="dt-form-label">部门名称 <span style="color:#EF4444">*</span></div>
              <input type="text" class="dt-input" v-model="formData.name" />
            </div>
            <div class="dt-form-group">
              <div class="dt-form-label">负责人</div>
              <input type="text" class="dt-input" v-model="formData.manager" />
            </div>
          </div>
        </template>

        <!-- ── 员工表单（create/edit） ── -->
        <template v-else-if="state.modal.name === 'emp' && state.modal.mode !== 'view'">
          <div class="dt-form">
            <div class="dt-form-group">
              <div class="dt-form-label">姓名 <span style="color:#EF4444">*</span></div>
              <input type="text" class="dt-input" v-model="formData.name" />
            </div>
            <div class="dt-form-group">
              <div class="dt-form-label">部门</div>
              <select class="dt-input dt-select" v-model="formData.deptId">
                <option value="">-- 无归属部门 --</option>
                <option v-for="d in (state.fullState?.departments||[])" :key="d.id" :value="d.id" v-text="d.name"></option>
              </select>
            </div>
            <div class="dt-form-group">
              <div class="dt-form-label">职位</div>
              <input type="text" class="dt-input" v-model="formData.position" />
            </div>
            <div class="dt-form-group">
              <div class="dt-form-label">手机</div>
              <input type="text" class="dt-input" v-model="formData.mobile" />
            </div>
          </div>
        </template>

        <!-- ── 用户表单（create/edit） ── -->
        <template v-else-if="state.modal.name === 'user' && state.modal.mode !== 'view'">
          <div class="dt-form">
            <!-- 新建时：选择关联员工（自动带出用户名+部门） -->
            <div class="dt-form-group" v-if="state.modal.mode === 'create'">
              <div class="dt-form-label">关联员工 <span style="color:#EF4444">*</span></div>
              <select class="dt-input dt-select" v-model="formData.employeeId" @change="onUserEmployeeChange">
                <option value="">-- 请选择员工 --</option>
                <option v-for="e in (state.fullState?.employees||[])" :key="e.id" :value="e.id" v-text="e.name + (e.position ? ' ('+e.position+')' : '')"></option>
              </select>
            </div>
            <!-- 编辑时：只读用户名 -->
            <div class="dt-form-group" v-if="state.modal.mode === 'edit'">
              <div class="dt-form-label">用户名</div>
              <input type="text" class="dt-input" v-model="formData.username" readonly style="opacity:0.5" />
            </div>
            <!-- 显示名 -->
            <div class="dt-form-group">
              <div class="dt-form-label">显示名 <span style="color:#EF4444">*</span></div>
              <input type="text" class="dt-input" v-model="formData.display_name" placeholder="页面显示名称" />
            </div>
            <!-- 角色 -->
            <div class="dt-form-group">
              <div class="dt-form-label">角色 <span style="color:#EF4444">*</span></div>
              <select class="dt-input dt-select" v-model="formData.role">
                <option value="user">普通用户</option>
                <option value="admin">管理员</option>
              </select>
            </div>
            <!-- 部门（编辑时只读自动带出） -->
            <div class="dt-form-group" v-if="state.modal.mode === 'edit'">
              <div class="dt-form-label">部门</div>
              <input type="text" class="dt-input" v-model="formData.department" readonly style="opacity:0.5" />
            </div>
            <!-- 密码 -->
            <div class="dt-form-group">
              <div class="dt-form-label" v-text="state.modal.mode === 'create' ? '初始密码 *' : '重置密码（留空则不修改）'"></div>
              <input type="password" class="dt-input" v-model="formData._password" :placeholder="state.modal.mode === 'create' ? '请输入初始密码' : '留空则不修改'" />
            </div>
          </div>
        </template>

      </div>

      <!-- Modal Footer -->
      <div class="dt-modal-ft">
        <!-- 查看/编辑申请详情 → 快捷入口：新建关联记录 -->
        <template v-if="state.modal.mode === 'view' && state.modal.name === 'app'">
          <button class="dt-btn dt-btn-default" @click="openModal('contract','create',{},{oppNo: formData.oppNo, product: formData.product})">+ 合同</button>
          <button class="dt-btn dt-btn-default" @click="openModal('follow','create',{},{oppNo: formData.oppNo})">+ 跟进</button>
          <button class="dt-btn dt-btn-default" @click="openModal('judgment','create',{},{oppNo: formData.oppNo})">+ 判断</button>
        </template>
        <!-- 查看合同详情 → 快捷入口：新建分配（直接带 contractId） -->
        <template v-if="state.modal.mode === 'view' && state.modal.name === 'contract'">
          <button class="dt-btn dt-btn-default" @click="openModal('allocation','create',{},{contractId: formData.id, oppNo: formData.oppNo})">+ 分配</button>
        </template>
        <!-- 个人信息弹窗：只有关闭按钮 -->
        <template v-if="state.modal.name === 'selfProfile'">
          <button class="dt-btn dt-btn-default" @click="closeModal">关闭</button>
        </template>
        <!-- 新建/编辑 表单（排除 selfProfile） -->
        <template v-if="state.modal.mode !== 'view' && state.modal.name !== 'selfProfile'">
          <button class="dt-btn dt-btn-default" @click="closeModal">取消</button>
          <button id="alloc-save-btn" class="dt-btn dt-btn-primary" style="touch-action:auto" onclick="window._saveRecord()">{{ formLoading ? '保存中…' : '保存' }}</button>
        </template>
        <!-- 查看时允许删除（除申请/合同/selfProfile外） -->
        <button v-if="state.modal.mode === 'view' && state.modal.name !== 'selfProfile' && state.modal.name !== 'app' && state.modal.name !== 'contract'" class="dt-btn dt-btn-danger" :disabled="formLoading" onclick="window._deleteRecord()">删除</button>
      </div>
    </div>
  </div>

</div>
  `
});

// ========== Helper 函数（在 setup 外）============

// listTab → modal name
function listTabToModal(tab) {
  const m = { applications:'app', contracts:'contract', followUps:'follow', judgments:'judgment', salesQuestions:'salesQ', allocations:'allocation' };
  return m[tab] || tab;
}

function modalTitle(name) {
  const t = { app:'售前申请', contract:'合同', follow:'项目跟进', judgment:'顾问判断', salesQ:'售前问答', allocation:'业绩分配', dept:'部门', emp:'员工', user:'用户', selfProfile:'个人信息' };
  return t[name] || '记录';
}

function getFieldsForModal(name) {
  if (name === 'app') return APP_FIELDS;
  if (name === 'contract') return CONTRACT_FIELDS;
  if (name === 'follow') return FOLLOW_FIELDS;
  if (name === 'judgment') return JUDGMENT_FIELDS;
  if (name === 'salesQ') return SALES_Q_FIELDS;
  if (name === 'allocation') return ALLOCATION_FIELDS;
  return [];
}

app.mount('#app');
