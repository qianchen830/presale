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
  { key: 'department', label: '部门', type: 'text' },
  { key: 'view_depts', label: '可见部门(JSON)', type: 'text' },
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
  // 列表页
  searchText: '',
  filterStatus: '',
  activeListTab: 'applications',
  // admin 子页
  activeAdminSub: '',
  // 当前操作弹窗
  modal: null,         // { name, mode, data, extra }
});

// ── 个人年度/季度目标 ──
    const userTargets = reactive({
      annualTargets: {}, // { year: amount }
      quarterTargets: {}, // { Q1: amount, ... }
    });
    async function loadUserTargets() {
      try {
        const d = await API.getUserTargets();
        userTargets.annualTargets = d.annualTargets || {};
        userTargets.quarterTargets = d.quarterTargets || {};
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

    // ── 年份切换后自动刷新目标数据 ──
    watch(() => state.year, () => { loadUserTargets(); });

// ========== 工具函数 ==========
function showToast(msg, duration = 2000) {
  if (state.toastTimer) clearTimeout(state.toastTimer);
  state.toast = msg;
  state.toastTimer = setTimeout(() => { state.toast = null; }, duration);
}
function fmtMoney(v) {
  return (parseFloat(v) || 0).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
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
    // 合同通过 oppNo 关联到申请，看申请人是否是本人
    const myOppNos = new Set(
      (state.fullState?.applications || [])
        .filter(a => !a.deleted && (a.applicant === me || a.consultant === me))
        .map(a => a.oppNo)
    );
    return alive.filter(r => myOppNos.has(r.oppNo));
  }
  if (module === 'followUps' || module === 'judgments' || module === 'salesQuestions') {
    // 这些模块通过 oppNo 关联到申请
    const myOppNos = new Set(
      (state.fullState?.applications || [])
        .filter(a => !a.deleted && (a.applicant === me || a.consultant === me))
        .map(a => a.oppNo)
    );
    return alive.filter(r => myOppNos.has(r.oppNo));
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
  { key:'accountMgr', label:'客户经理', type:'text', required:true },
  { key:'salesDept', label:'销售部门', type:'text', required:true },
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
  { key:'contractId', label:'合同ID', type:'text', required:false },
  { key:'month', label:'月份', type:'text', required:false },
  { key:'quarter', label:'季度', type:'text', required:false },
  { key:'consultantPerformance', label:'分配业绩(元)', type:'number', required:true },
];

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
    const filteredContracts = computed(() => filterRecords(myVisibleContracts.value, { year: state.year, search: state.searchText }));
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
      return [];
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

    // 快捷录入：先选关联记录，再填表单
    function openModal(name, mode = 'create', data = {}, extra = {}) {
      state.modal = { name, mode, data, extra };
      Object.keys(formData).forEach(k => delete formData[k]);
      pickerStep.value = null;
      pickerSearch.value = '';
      const today = new Date().toISOString().slice(0, 10);
      if (mode === 'create') {
        if (name === 'app') {
          // 申请直接填
          Object.assign(formData, { applyDate: today, applicant: state.user?.displayName || state.user?.username || '', department: state.user?.department || '', product: PRODUCTS[0], buyMode: BUY_MODES[0], currentStage: STAGES[0], status: '活跃' });
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
      }
      pickerStep.value = null;
      pickerSearch.value = '';
    }

    function closeModal() { state.modal = null; }

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
          await loadState();
        } else {
          // 通用模块
          const module = getModuleName(name === 'salesQ' ? 'salesQuestions' : name === 'judgment' ? 'judgments' : name === 'allocation' ? 'allocations' : name === 'app' ? 'applications' : name === 'contract' ? 'contracts' : name);
          if (mode === 'create') {
            await API.create(module, { ...formData });
          } else {
            await API.update(module, data.id, { ...formData });
          }
          showToast('保存成功');
          await loadState();
        }
        closeModal();
      } catch (e) {
        showToast(e.message);
      } finally {
        formLoading.value = false;
      }
    }

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

    return {
      state, loginUsername, loginPassword, loginLoading,
      doLogin, doLogout, loadState,
      dashboardStats,
      filteredApps, filteredContracts, myFollows, myJudgments, mySalesQs, myAllocs,
      listRecords, groupedRecords,
      formData, formLoading,
      openModal, closeModal, maybeCloseModal,
      userTargets, loadUserTargets, saveUserTargets,
      oldPwd, newPwd, confirmPwd, showOldPwd, showNewPwd, showConfirmPwd,
      doChangePassword, pwdLoading,
      getListItemTitle, getListItemSub,
      getStatusBadge, fmtMoney, fmtDate, getDeptName, getEmpName,
      changeYear, listTabToModal, modalTitle, getFieldsForModal,
      PRODUCTS, BUY_MODES, STAGES, APP_STATUSES, YES_NO, QUARTERS,
      APP_FIELDS, CONTRACT_FIELDS, FOLLOW_FIELDS, JUDGMENT_FIELDS,
      SALES_Q_FIELDS, ALLOCATION_FIELDS, DEPT_FIELDS, EMP_FIELDS,
      USER_FIELDS_ADMIN, USER_FIELDS_SELF,
      relatedContracts, relatedFollows, relatedJudgments, relatedSalesQs, relatedAllocs,
      pickerStep, pickerSearch, pickerList, doPickerSelect,
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
      <div style="background:#111;border:1px solid #333;color:#0f0;font-size:11px;padding:3px 8px;margin-bottom:8px;font-family:monospace">
        userTargets.annualTargets[2026]={{ userTargets.annualTargets[2026] }} | userTargets.annualTargets={{ JSON.stringify(userTargets.annualTargets) }}
      </div>
      <div class="dt-money-row">
        <div class="dt-money-item">
          <div class="dt-money-lbl">签单金额</div>
          <div class="dt-money-val dt-text-primary" v-text="dashboardStats.wonAmount.toFixed(1) + ' 万'"></div>
        </div>
        <div class="dt-money-divider"></div>
        <div class="dt-money-item">
          <div class="dt-money-lbl">合同总额</div>
          <div class="dt-money-val" v-text="dashboardStats.totalAmount.toFixed(1) + ' 万'"></div>
        </div>
        <div class="dt-money-divider"></div>
        <div class="dt-money-item">
          <div class="dt-money-lbl">年度目标</div>
          <div class="dt-money-val dt-text-muted" v-text="dashboardStats.annualTarget > 0 ? (dashboardStats.annualTarget/10000).toFixed(1)+' 万' : '—'"></div>
        </div>
      </div>

      <!-- 进度条（如果有目标） -->
      <div v-if="dashboardStats.annualTarget > 0" class="dt-progress-card">
        <div class="dt-progress-label">
          <span>年度完成率</span>
          <span class="dt-text-primary dt-font-bold">{{ ((dashboardStats.wonAmount / (dashboardStats.annualTarget/10000)) * 100).toFixed(0) }}%</span>
        </div>
        <div class="dt-progress-bar">
          <div class="dt-progress-fill dt-bg-primary" :style="{ width: Math.min((dashboardStats.wonAmount / (dashboardStats.annualTarget/10000)) * 100, 100) + '%' }"></div>
        </div>
      </div>

      <!-- 设置目标入口 -->
      <div class="dt-set-target-btn" @click="openModal('setTargets','edit',{})">
        <span>🎯</span>
        <span>设置年度目标</span>
        <span class="dt-set-target-arrow">›</span>
      </div>

      <!-- 我的申请摘要 -->
      <div class="dt-section-card">
        <div class="dt-section-hd">
          <span class="dt-section-title">我的售前申请</span>
          <span class="dt-section-more" @click="state.activeTab='list'; state.activeListTab='applications'">查看全部 ›</span>
        </div>
        <div v-if="filteredApps.length === 0" class="dt-empty-cell">暂无数据</div>
        <div v-for="app in filteredApps.slice(0, 5)" :key="app.id" class="dt-list-row" @click="openModal('app','view',app)">
          <div class="dt-list-info">
            <div class="dt-list-title" v-text="(app.customer||'') + (app.projectName ? ' / '+app.projectName : '')"></div>
            <div class="dt-list-sub" v-text="(app.oppNo||'') + ' | ' + (app.product||'') + ' | ' + (app.currentStage||'')"></div>
          </div>
          <span class="dt-badge" :class="getStatusBadge(app.status)" v-text="app.status"></span>
        </div>
      </div>

      <!-- 我的合同摘要 -->
      <div class="dt-section-card">
        <div class="dt-section-hd">
          <span class="dt-section-title">我的合同</span>
          <span class="dt-section-more" @click="state.activeTab='list'; state.activeListTab='contracts'">查看全部 ›</span>
        </div>
        <div v-if="filteredContracts.length === 0" class="dt-empty-cell">暂无数据</div>
        <div v-for="c in filteredContracts.slice(0, 5)" :key="c.id" class="dt-list-row" @click="openModal('contract','view',c)">
          <div class="dt-list-info">
            <div class="dt-list-title" v-text="c.signCustomerName || c.signCustomer"></div>
            <div class="dt-list-sub" v-text="fmtMoney(c.subAmount) + '元 | ' + fmtDate(c.mainSignDate)"></div>
          </div>
        </div>
      </div>
    </div>

    <!-- ── List ── -->
    <div v-if="state.activeTab === 'list'" class="dt-page">
      <!-- 搜索 + 年份 -->
      <div class="dt-filter-bar">
        <div class="dt-year-chip" @click="changeYear(-1)">‹ {{ state.year - 1 }}</div>
        <div class="dt-year-chip dt-year-chip-active">{{ state.year }}</div>
        <div class="dt-year-chip" @click="changeYear(1)">{{ state.year + 1 }} ›</div>
      </div>
      <div class="dt-search-bar">
        <span class="dt-search-icon">🔍</span>
        <input class="dt-search-input" v-model="state.searchText" placeholder="搜索客户/商机号/项目…" />
      </div>

      <!-- 模块 Tab（胶囊可滚动） -->
      <div class="dt-mod-nav">
        <div class="dt-mod-item" :class="{ active: state.activeListTab === 'applications' }" @click="state.activeListTab = 'applications'">申请</div>
        <div class="dt-mod-item" :class="{ active: state.activeListTab === 'contracts' }" @click="state.activeListTab = 'contracts'">合同</div>
        <div class="dt-mod-item" :class="{ active: state.activeListTab === 'followUps' }" @click="state.activeListTab = 'followUps'">跟进</div>
        <div class="dt-mod-item" :class="{ active: state.activeListTab === 'judgments' }" @click="state.activeListTab = 'judgments'">判断</div>
        <div class="dt-mod-item" :class="{ active: state.activeListTab === 'salesQuestions' }" @click="state.activeListTab = 'salesQuestions'">问答</div>
        <div class="dt-mod-item" :class="{ active: state.activeListTab === 'allocations' }" @click="state.activeListTab = 'allocations'">分配</div>
      </div>

      <!-- 状态过滤（仅申请 tab） -->
      <div v-if="state.activeListTab === 'applications'" class="dt-status-row">
        <div class="dt-status-pill" :class="{ active: !state.filterStatus }" @click="state.filterStatus = ''">全部</div>
        <div class="dt-status-pill" :class="{ active: state.filterStatus === '活跃' }" @click="state.filterStatus = '活跃'">活跃</div>
        <div class="dt-status-pill" :class="{ active: state.filterStatus === '签单' }" @click="state.filterStatus = '签单'">签单</div>
        <div class="dt-status-pill" :class="{ active: state.filterStatus === '暂停' }" @click="state.filterStatus = '暂停'">暂停</div>
        <div class="dt-status-pill" :class="{ active: state.filterStatus === '丢失' }" @click="state.filterStatus = '丢失'">丢失</div>
        <div class="dt-status-pill" :class="{ active: state.filterStatus === '关闭' }" @click="state.filterStatus = '关闭'">关闭</div>
      </div>

      <!-- 记录列表 -->
      <div class="dt-list">

        <!-- 申请/合同：扁平列表 -->
        <template v-if="state.activeListTab === 'applications' || state.activeListTab === 'contracts'">
          <div v-if="listRecords.length === 0" class="dt-empty">
            <div class="dt-empty-icon">📭</div>
            <div class="dt-empty-text">暂无数据</div>
          </div>
          <div v-for="r in listRecords" :key="r.id" class="dt-list-row" @click="openModal(listTabToModal(state.activeListTab),'view',r)">
            <div v-if="state.activeListTab === 'applications'" class="dt-list-info" style="flex:1">
              <div class="dt-list-title" v-text="(r.customer||'') + (r.projectName ? ' / '+r.projectName : '')"></div>
              <div class="dt-list-sub">
                <span v-text="r.oppNo"></span>
                <span class="dt-sep">·</span>
                <span v-text="r.consultant || r.applicant || ''"></span>
                <span class="dt-sep">·</span>
                <span v-text="r.product||''"></span>
              </div>
              <div class="dt-list-sub" style="margin-top:2px">
                <span class="dt-badge" :class="getStatusBadge(r.status)" v-text="r.status" style="margin-right:6px"></span>
                <span v-text="r.currentStage||''"></span>
              </div>
            </div>
            <div v-else class="dt-list-info" style="flex:1">
              <div class="dt-list-title" v-text="r.signCustomerName || r.signCustomer"></div>
              <div class="dt-list-sub">
                <span v-text="r.oppNo"></span>
                <span class="dt-sep">·</span>
                <span v-text="fmtMoney(r.subAmount)"></span>元
                <span class="dt-sep">·</span>
                <span v-text="fmtDate(r.mainSignDate)"></span>
              </div>
            </div>
            <div class="dt-list-arrow">›</div>
          </div>
        </template>

        <!-- 跟进/判断/问答/分配：按申请分组，子记录展开显示 -->
        <template v-else>
          <div v-if="groupedRecords.length === 0" class="dt-empty">
            <div class="dt-empty-icon">📭</div>
            <div class="dt-empty-text">暂无数据</div>
          </div>
          <div v-for="group in groupedRecords" :key="group.app.oppNo" class="dt-app-group">
            <!-- 父申请卡片 -->
            <div class="dt-app-group-hd" @click="openModal('app','view', group.app)">
              <div class="dt-app-group-info">
                <div class="dt-app-group-name" v-text="(group.app.customer||'') + (group.app.projectName ? ' / '+group.app.projectName : '')"></div>
                <div class="dt-app-group-meta">
                  <span v-text="group.app.oppNo"></span>
                  <span class="dt-sep">·</span>
                  <span v-text="group.app.consultant || group.app.applicant || ''"></span>
                  <span class="dt-sep">·</span>
                  <span v-text="group.app.product||''"></span>
                </div>
                <div class="dt-app-group-meta" v-if="group.app.status">
                  <span class="dt-badge" :class="getStatusBadge(group.app.status)" v-text="group.app.status" style="margin-right:6px"></span>
                  <span v-text="group.app.currentStage||''"></span>
                </div>
              </div>
              <div class="dt-list-arrow">›</div>
            </div>
            <!-- 子记录列表 -->
            <div v-if="group.subs.length === 0" class="dt-app-group-empty">暂无记录</div>
            <div v-for="sub in group.subs" :key="sub.id" class="dt-list-row dt-sub-row" @click="openModal(listTabToModal(state.activeListTab),'view',sub)">
              <div class="dt-list-info" style="flex:1">
                <!-- 跟进: 工作项+日期 -->
                <template v-if="state.activeListTab === 'followUps'">
                  <div class="dt-list-title" v-text="sub.workItem"></div>
                  <div class="dt-list-sub" v-text="fmtDate(sub.followDate) + (sub.hours ? ' · '+sub.hours+'h' : '')"></div>
                  <div v-if="sub.summary" class="dt-list-desc" v-text="sub.summary"></div>
                </template>
                <!-- 判断: 阶段+竞争对手 -->
                <template v-else-if="state.activeListTab === 'judgments'">
                  <div class="dt-list-title" v-text="(sub.currentStage||'判断') + (sub.competitor ? ' · 竞对:'+sub.competitor : '')"></div>
                  <div class="dt-list-sub" v-text="fmtDate(sub.updatedAt)"></div>
                </template>
                <!-- 问答: 问题摘要 -->
                <template v-else-if="state.activeListTab === 'salesQuestions'">
                  <div class="dt-list-title" v-text="sub.seq ? 'Q'+sub.seq+': '+(sub.question||'') : (sub.question||'')"></div>
                  <div class="dt-list-sub dt-list-desc" v-text="sub.answer ? '→ '+sub.answer : '→ 待回答'"></div>
                </template>
                <!-- 分配: 顾问+金额 -->
                <template v-else-if="state.activeListTab === 'allocations'">
                  <div class="dt-list-title" v-text="(sub.consultant||'顾问') + (sub.department ? ' · '+sub.department : '')"></div>
                  <div class="dt-list-sub" v-text="fmtMoney(sub.consultantPerformance)+'元 · '+sub.month"></div>
                </template>
              </div>
              <div class="dt-list-arrow">›</div>
            </div>
          </div>
        </template>

      </div>

      <!-- FAB: 只有申请 tab 能直接新建，其他模块必须从父记录进入 -->
      <div v-if="state.activeTab === 'list' && state.activeListTab === 'applications'" class="dt-fab" @click="openModal('app','create',{})">+</div>
    </div>

    <!-- ── Admin ── -->
    <div v-if="state.activeTab === 'admin' && state.user?.role === 'admin'" class="dt-page">
      <!-- admin 子导航 -->
      <div v-if="!state.activeAdminSub" class="dt-admin-menu">
        <div class="dt-admin-item" @click="state.activeAdminSub = 'dept'">
          <div class="dt-admin-icon" style="background:#EFF6FF">🏢</div>
          <div class="dt-admin-info">
            <div class="dt-admin-title">部门管理</div>
            <div class="dt-admin-sub">查看/添加/编辑部门</div>
          </div>
          <div class="dt-list-arrow">›</div>
        </div>
        <div class="dt-admin-item" @click="state.activeAdminSub = 'emp'">
          <div class="dt-admin-icon" style="background:#F0FDF4">👥</div>
          <div class="dt-admin-info">
            <div class="dt-admin-title">员工管理</div>
            <div class="dt-admin-sub">查看/添加/编辑员工</div>
          </div>
          <div class="dt-list-arrow">›</div>
        </div>
        <div class="dt-admin-item" @click="state.activeAdminSub = 'user'">
          <div class="dt-admin-icon" style="background:#FEF3C7">🔐</div>
          <div class="dt-admin-info">
            <div class="dt-admin-title">用户管理</div>
            <div class="dt-admin-sub">查看/添加/编辑用户密码</div>
          </div>
          <div class="dt-list-arrow">›</div>
        </div>
      </div>

      <!-- 部门管理 -->
      <div v-if="state.activeAdminSub === 'dept'" class="dt-page-sub">
        <div class="dt-sub-header">
          <div class="dt-sub-back" @click="state.activeAdminSub = ''">‹ 返回</div>
          <div class="dt-sub-title">部门管理</div>
          <div class="dt-sub-action" @click="openModal('dept','create',{})">+ 新增</div>
        </div>
        <div class="dt-list">
          <div v-if="(state.fullState?.departments||[]).length === 0" class="dt-empty"><div class="dt-empty-icon">🏢</div><div class="dt-empty-text">暂无部门</div></div>
          <div v-for="d in state.fullState?.departments||[]" :key="d.id" class="dt-list-row" @click="openModal('dept','view',d)">
            <div class="dt-list-info" style="flex:1">
              <div class="dt-list-title" v-text="d.name"></div>
              <div class="dt-list-sub" v-text="'ID: ' + d.id + (d.manager ? ' | 负责人: '+d.manager : '')"></div>
            </div>
            <div class="dt-list-arrow">›</div>
          </div>
        </div>
      </div>

      <!-- 员工管理 -->
      <div v-if="state.activeAdminSub === 'emp'" class="dt-page-sub">
        <div class="dt-sub-header">
          <div class="dt-sub-back" @click="state.activeAdminSub = ''">‹ 返回</div>
          <div class="dt-sub-title">员工管理</div>
          <div class="dt-sub-action" @click="openModal('emp','create',{})">+ 新增</div>
        </div>
        <div class="dt-list">
          <div v-if="(state.fullState?.employees||[]).length === 0" class="dt-empty"><div class="dt-empty-icon">👥</div><div class="dt-empty-text">暂无员工</div></div>
          <div v-for="e in state.fullState?.employees||[]" :key="e.id" class="dt-list-row" @click="openModal('emp','view',e)">
            <div class="dt-list-info" style="flex:1">
              <div class="dt-list-title" v-text="e.name + (e.position ? ' ('+e.position+')' : '')"></div>
              <div class="dt-list-sub" v-text="'ID:'+e.id+' | 部门:'+getDeptName(e.deptId)+(e.mobile?' | '+e.mobile:'')"></div>
            </div>
            <div class="dt-list-arrow">›</div>
          </div>
        </div>
      </div>

      <!-- 用户管理 -->
      <div v-if="state.activeAdminSub === 'user'" class="dt-page-sub">
        <div class="dt-sub-header">
          <div class="dt-sub-back" @click="state.activeAdminSub = ''">‹ 返回</div>
          <div class="dt-sub-title">用户管理</div>
          <div class="dt-sub-action" @click="openModal('user','create',{})">+ 新增</div>
        </div>
        <div class="dt-list">
          <div v-if="(state.fullState?._users||[]).length === 0" class="dt-empty"><div class="dt-empty-icon">🔐</div><div class="dt-empty-text">暂无用户</div></div>
          <div v-for="u in (state.fullState?._users||[])" :key="u.id" class="dt-list-row" @click="openModal('user','view',u)">
            <div class="dt-list-info" style="flex:1">
              <div class="dt-list-title" v-text="u.display_name || u.username"></div>
              <div class="dt-list-sub" v-text="u.username + ' | ' + (u.role==='admin'?'管理员':'普通用户') + (u.department?' | '+u.department:'')"></div>
            </div>
            <div class="dt-list-arrow">›</div>
          </div>
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
        <div class="dt-tab-icon">📊</div>
        <div class="dt-tab-lbl">看板</div>
      </div>
      <div class="dt-tab-item" :class="{ active: state.activeTab === 'list' }" @click="state.activeTab = 'list'">
        <div class="dt-tab-icon">📋</div>
        <div class="dt-tab-lbl">数据</div>
      </div>
      <div v-if="state.user?.role === 'admin'" class="dt-tab-item" :class="{ active: state.activeTab === 'admin' }" @click="state.activeTab = 'admin'">
        <div class="dt-tab-icon">⚙️</div>
        <div class="dt-tab-lbl">管理</div>
      </div>
      <div class="dt-tab-item" :class="{ active: state.activeTab === 'profile' }" @click="state.activeTab = 'profile'">
        <div class="dt-tab-icon">👤</div>
        <div class="dt-tab-lbl">我的</div>
      </div>
    </div>
  </div>

  <!-- ══════════ MODAL ══════════ -->
  <div v-if="state.modal" class="dt-modal-overlay" @click.self="maybeCloseModal">
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
               pickerStep === 'allocation' ? '选择关联的合同（分配将记录在该合同下）' : '选择关联记录' }}
          </div>
          <div class="search-bar">
            <span class="search-icon">🔍</span>
            <input v-model="pickerSearch" placeholder="搜索客户/商机号/项目…" class="" style="flex:1;padding:12px 0;background:transparent;border:none;outline:none;font-size:14px;color:#fff" />
          </div>
          <div class="picker-list">
            <div v-if="pickerList.length === 0" class="dt-empty-cell">无匹配记录</div>
            <div v-for="item in pickerList" :key="item.id" class="picker-item" @click="doPickerSelect(item)">
              <div style="flex:1;min-width:0">
                <div class="dt-list-title" v-if="item.customer || item.projectName" v-text="(item.customer||'') + (item.projectName ? ' / '+item.projectName : '')"></div>
                <div class="dt-list-title" v-else v-text="item.signCustomerName || item.signCustomer || item.oppNo"></div>
                <div class="dt-list-sub" v-text="item.oppNo + ' | ' + (item.applyDate || item.mainSignDate || '')"></div>
              </div>
              <div class="dt-list-arrow">›</div>
            </div>
          </div>
          <button class="dt-btn dt-btn-default dt-btn-block" style="margin-top:12px" @click="pickerStep = null">取消并直接新建</button>
        </template>

        <!-- 设置年度目标（edit mode，不需要关联申请） -->
        <template v-if="state.modal.name === 'setTargets'">
          <div class="dt-form-group">
            <div class="dt-form-label">{{ state.year }} 年度目标（万元）</div>
            <input type="number" class="dt-input" v-model.number="userTargets.annualTargets[state.year]" placeholder="例如：500" step="10" />
          </div>
          <div class="dt-form-hint">填入数字即可，单位：万元</div>
          <div class="dt-form-group" style="margin-top:12px">
            <div class="dt-form-label">季度分解（万元）</div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
              <div v-for="q in ['Q1','Q2','Q3','Q4']" :key="q" class="dt-q-input-wrap">
                <div class="dt-form-label" style="margin-bottom:4px">{{ q }}</div>
                <input type="number" class="dt-input" v-model.number="userTargets.quarterTargets[q]" placeholder="0" step="5" />
              </div>
            </div>
          </div>
          <button class="dt-btn dt-btn-primary dt-btn-full" style="margin-top:16px" @click="saveUserTargets(); closeModal();">保存目标</button>
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
              <div v-for="q in relatedSalesQs" :key="q.id" class="rel-card" @click="openModal('salesQ','view',q)">
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
                  <div class="detail-lbl">产品</div>
                  <div class="detail-val" v-text="formData.product || '—'"></div>
                </div>
                <div class="detail-cell">
                  <div class="detail-lbl">签订日期</div>
                  <div class="detail-val" v-text="fmtDate(formData.mainSignDate)"></div>
                </div>
              </div>
              <div class="detail-card-row single">
                <div class="detail-cell full">
                  <div class="detail-lbl">关联商机号</div>
                  <div class="detail-val mono" v-text="formData.oppNo || '—'"></div>
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
                  <div class="detail-lbl">业绩</div>
                  <div class="detail-val dt-text-primary dt-font-bold" v-text="fmtMoney(formData.consultantPerformance) + '元'"></div>
                </div>
              </div>
              <div class="detail-card-row">
                <div class="detail-cell">
                  <div class="detail-lbl">季度</div>
                  <div class="detail-val" v-text="formData.quarter || '—'"></div>
                </div>
                <div class="detail-cell">
                  <div class="detail-lbl">月份</div>
                  <div class="detail-val" v-text="formData.month || '—'"></div>
                </div>
              </div>
              <div class="detail-card-row single">
                <div class="detail-cell full">
                  <div class="detail-lbl">关联商机号</div>
                  <div class="detail-val mono" v-text="formData.oppNo || '—'"></div>
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
            <div v-for="field in ALLOCATION_FIELDS" :key="field.key" class="dt-form-group">
              <div class="dt-form-label" v-text="field.label + (field.required ? ' *' : '')"></div>
              <input :type="field.type === 'number' ? 'number' : 'text'" class="dt-input" v-model="formData[field.key]" />
            </div>
          </div>
        </template>

        <!-- ── 部门表单 ── -->
        <template v-else-if="state.modal.name === 'dept'">
          <div class="dt-form">
            <div v-for="field in DEPT_FIELDS" :key="field.key" class="dt-form-group">
              <div class="dt-form-label" v-text="field.label + (field.required ? ' *' : '')"></div>
              <input type="number" v-if="field.type === 'number'" class="dt-input" v-model="formData[field.key]" />
              <input v-else type="text" class="dt-input" v-model="formData[field.key]" />
            </div>
          </div>
        </template>

        <!-- ── 员工表单 ── -->
        <template v-else-if="state.modal.name === 'emp'">
          <div class="dt-form">
            <div v-for="field in EMP_FIELDS" :key="field.key" class="dt-form-group">
              <div class="dt-form-label" v-text="field.label + (field.required ? ' *' : '')"></div>
              <input type="number" v-if="field.type === 'number'" class="dt-input" v-model="formData[field.key]" />
              <input v-else type="text" class="dt-input" v-model="formData[field.key]" />
            </div>
          </div>
        </template>

        <!-- ── 用户表单 ── -->
        <template v-else-if="state.modal.name === 'user'">
          <div class="dt-form">
            <div v-for="field in (state.modal.mode === 'create' ? USER_FIELDS_ADMIN : USER_FIELDS_ADMIN.filter(f => f.key !== 'username'))" :key="field.key" class="dt-form-group">
              <div class="dt-form-label" v-text="field.label + (field.required ? ' *' : '')"></div>
              <select v-if="field.type === 'select'" class="dt-input dt-select" v-model="formData[field.key]">
                <option v-for="opt in field.options" :key="opt" :value="opt" v-text="opt"></option>
              </select>
              <input v-else type="text" class="dt-input" v-model="formData[field.key]" />
            </div>
            <!-- 密码（仅新建/重置） -->
            <div class="dt-form-group" v-if="state.modal.mode === 'create'">
              <div class="dt-form-label">初始密码 <span style="color:#EF4444">*</span></div>
              <input type="password" class="dt-input" v-model="formData._password" placeholder="请输入初始密码" />
            </div>
          </div>
        </template>

      </div>

      <!-- Modal Footer -->
      <div class="dt-modal-ft">
        <!-- 查看/编辑申请详情 → 快捷入口：新建关联记录 -->
        <template v-if="state.modal.mode === 'view' && state.modal.name === 'app'">
          <button class="dt-btn dt-btn-default" @click="openModal('contract','create',{})">+ 合同</button>
          <button class="dt-btn dt-btn-default" @click="openModal('follow','create',{})">+ 跟进</button>
          <button class="dt-btn dt-btn-default" @click="openModal('judgment','create',{})">+ 判断</button>
          <button class="dt-btn dt-btn-default" @click="openModal('salesQ','create',{})">+ 问答</button>
        </template>
        <!-- 查看合同详情 → 快捷入口：新建分配 -->
        <template v-if="state.modal.mode === 'view' && state.modal.name === 'contract'">
          <button class="dt-btn dt-btn-default" @click="openModal('allocation','create',{})">+ 分配</button>
        </template>
        <!-- 个人信息弹窗：只有关闭按钮 -->
        <template v-if="state.modal.name === 'selfProfile'">
          <button class="dt-btn dt-btn-default" @click="closeModal">关闭</button>
        </template>
        <!-- 新建/编辑 表单（排除 selfProfile） -->
        <template v-if="state.modal.mode !== 'view' && state.modal.name !== 'selfProfile'">
          <button class="dt-btn dt-btn-default" @click="closeModal">取消</button>
          <button class="dt-btn dt-btn-primary" :disabled="formLoading" @click="saveRecord">{{ formLoading ? '保存中…' : '保存' }}</button>
        </template>
        <!-- 查看时允许删除（除申请/合同/selfProfile外） -->
        <button v-if="state.modal.mode === 'view' && state.modal.name !== 'selfProfile' && state.modal.name !== 'app' && state.modal.name !== 'contract'" class="dt-btn dt-btn-danger" :disabled="formLoading" @click="deleteRecord">删除</button>
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
