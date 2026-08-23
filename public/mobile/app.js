// mobile/app.js - Vue 3 移动端主应用
const { createApp, ref, reactive, computed, watch, onMounted, nextTick } = Vue;

// ========== 常量 ==========
const PRODUCTS = ['AI套件','AI星瀚','AI苍穹','灵基','AI HR','AI星空','EAS','s-HR','云之家','我家云','星空企业版','其他'];
const BUY_MODES = ['订阅','买断'];
const STAGES = ['前期沟通','需求调研','方案编写','POC','招投标','商务谈判','合同签订','项目交付','移交服务'];
const STATUSES = ['活跃','暂停','预计','丢失','关闭'];
const APP_STATUSES = ['活跃','暂停','预计','丢失','关闭','签单'];
const QUARTERS = ['Q1','Q2','Q3','Q4'];
const YES_NO = ['是','否'];
const PARTNER_SETTLE = ['未结算','已结算'];

// ========== 全局状态 ==========
const state = reactive({
  user: null,
  fullState: null,
  loading: false,
  toast: null,
  toastTimer: null,
  activeTab: 'dashboard',
  year: new Date().getFullYear(),
  quarter: null,
  // 当前操作
  modal: null,        // { name, mode, data, module }
  filterDept: '',
  filterStatus: '',
  searchText: '',
  activeListTab: 'applications',
});

// ========== API ==========
async function apiLogin(username, password) {
  const r = await fetch('/api/auth/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    credentials: 'include', body: JSON.stringify({ username, password })
  });
  const d = await r.json();
  if (!r.ok) throw new Error(d.error || '登录失败');
  return d;
}

async function apiMe() {
  const r = await fetch('/api/auth/me', { credentials: 'include' });
  if (!r.ok) return null;
  return r.json();
}

async function apiGetState() {
  const r = await fetch('/api/state', { credentials: 'include' });
  if (!r.ok) throw new Error('获取数据失败');
  return r.json();
}

async function apiCreate(module, record) {
  const r = await fetch(`/api/modules/${module}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    credentials: 'include', body: JSON.stringify(record)
  });
  const d = await r.json();
  if (!r.ok) throw new Error(d.error || '创建失败');
  return d;
}

async function apiUpdate(module, id, record) {
  const r = await fetch(`/api/modules/${module}/${id}`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    credentials: 'include', body: JSON.stringify(record)
  });
  const d = await r.json();
  if (!r.ok) throw new Error(d.error || '更新失败');
  return d;
}

async function apiDelete(module, id) {
  const r = await fetch(`/api/modules/${module}/${id}`, {
    method: 'DELETE', credentials: 'include'
  });
  const d = await r.json();
  if (!r.ok) throw new Error(d.error || '删除失败');
  return d;
}

async function apiGetDashboard(year) {
  const r = await fetch(`/api/dashboard/stats?year=${year}`, { credentials: 'include' });
  if (!r.ok) return { total: 0, won: 0, lost: 0, totalAmount: 0, wonAmount: 0 };
  return r.json();
}

async function apiGetDepts() { return (await fetch('/api/admin/departments', { credentials: 'include' })).json(); }
async function apiGetEmployees() { return (await fetch('/api/admin/employees', { credentials: 'include' })).json(); }
async function apiGetUsers() { return (await fetch('/api/admin/users', { credentials: 'include' })).json(); }

// ========== 工具函数 ==========
function showToast(msg, duration = 2000) {
  if (state.toastTimer) clearTimeout(state.toastTimer);
  state.toast = msg;
  state.toastTimer = setTimeout(() => { state.toast = null; }, duration);
}

function fmtMoney(v) {
  const n = parseFloat(v) || 0;
  return n.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtDate(d) {
  if (!d) return '—';
  return d.slice(0, 10);
}

function statusClass(s) {
  const map = { '活跃': 'active', '暂停': 'paused', '签单': 'won', '丢失': 'lost', '关闭': 'closed', '预计': 'expect' };
  return map[s] || 'active';
}

function getStatusBadge(s) {
  const map = { '活跃': 'badge-active', '暂停': 'badge-paused', '签单': 'badge-won', '丢失': 'badge-lost', '关闭': 'badge-closed', '预计': 'badge-expect' };
  return map[s] || 'badge-active';
}

function getDeptName(id) {
  if (!state.fullState) return '';
  const d = (state.fullState.departments || []).find(d => d.id == id);
  return d ? d.name : '';
}

function getEmpName(id) {
  if (!state.fullState) return '';
  const e = (state.fullState.employees || []).find(e => e.id == id);
  return e ? e.name : '';
}

function getDeptNameById(id) {
  if (!state.fullState) return '';
  return (state.fullState.departments || []).find(d => String(d.id) === String(id))?.name || '';
}

function getYear() { return state.year; }

// ========== 过滤器 ==========
function filterRecords(records, opts = {}) {
  if (!records) return [];
  let list = [...records];
  // 排除软删除
  list = list.filter(r => !r.deleted);
  // 按搜索文本
  if (opts.search) {
    const kw = opts.search.toLowerCase();
    list = list.filter(r => {
      return (r.customer || '').toLowerCase().includes(kw) ||
             (r.oppNo || '').toLowerCase().includes(kw) ||
             (r.projectName || '').toLowerCase().includes(kw) ||
             (r.consultant || '').toLowerCase().includes(kw) ||
             (r.applicant || '').toLowerCase().includes(kw);
    });
  }
  // 按部门
  if (opts.dept) {
    list = list.filter(r => {
      const emp = (state.fullState?.employees || []).find(e => e.name === r.consultant);
      if (!emp) return false;
      const d = (state.fullState?.departments || []).find(d => d.id == emp.deptId);
      return d && d.name === opts.dept;
    });
  }
  // 按状态
  if (opts.status) {
    list = list.filter(r => r.status === opts.status);
  }
  // 按年份（申请日期 / 签订日期）
  if (opts.year) {
    list = list.filter(r => {
      const d = new Date(r.applyDate || r.mainSignDate || r.followDate || '');
      return d.getFullYear() === opts.year;
    });
  }
  return list;
}

function myFilter(records, module) {
  if (!records) return [];
  if (state.user?.role === 'admin') return records.filter(r => !r.deleted);
  const myName = state.user?.displayName || state.user?.username || '';
  return records.filter(r => !r.deleted && r.consultant === myName);
}

// ========== 字段定义 ==========
const APP_FIELDS = [
  { key: 'applyDate', label: '申请日期', type: 'date', required: true },
  { key: 'applicant', label: '申请人', type: 'text', required: true },
  { key: 'department', label: '申请部门', type: 'text', required: true },
  { key: 'customer', label: '客户名称', type: 'text', required: true },
  { key: 'oppNo', label: '商机号', type: 'text', required: true },
  { key: 'projectName', label: '项目名称', type: 'text', required: true },
  { key: 'product', label: '预购产品', type: 'select', options: PRODUCTS, required: true },
  { key: 'buyMode', label: '购买模式', type: 'select', options: BUY_MODES, required: true },
  { key: 'currentStage', label: '当前阶段', type: 'select', options: STAGES, required: true },
  { key: 'status', label: '项目状态', type: 'select', options: APP_STATUSES, required: true },
  { key: 'coreRequirement', label: '核心需求', type: 'textarea', required: true },
  { key: 'expectedSignDate', label: '预计签单时间', type: 'date' },
  { key: 'expectedSignAmount', label: '预计签单金额', type: 'number' },
];

const CONTRACT_FIELDS = [
  { key: 'oppNo', label: '申请商机编号', type: 'text', required: true },
  { key: 'signOppNo', label: '签约商机编号', type: 'text', required: true },
  { key: 'workOrderNo', label: '工时商机号', type: 'text', required: true },
  { key: 'mainContractNo', label: '主合同编号', type: 'text', required: true },
  { key: 'signCustomer', label: '申请客户名称', type: 'text', required: true },
  { key: 'signCustomerName', label: '签约客户名称', type: 'text', required: true },
  { key: 'accountMgr', label: '客户经理', type: 'text', required: true },
  { key: 'salesDept', label: '销售部门', type: 'text', required: true },
  { key: 'product', label: '所购产品', type: 'select', options: PRODUCTS, required: true },
  { key: 'subAmount', label: '合同金额(元)', type: 'number', required: true },
  { key: 'actualCost', label: '实际成本(元)', type: 'number', required: true },
  { key: 'subPerformance', label: '订阅业绩(元)', type: 'number', required: true },
  { key: 'presalePerformance', label: '售前合同业绩(元)', type: 'number' },
  { key: 'isCloudSub', label: '是否云订阅', type: 'select', options: YES_NO, required: true },
  { key: 'mainSignDate', label: '主合同签订时间', type: 'date', required: true },
  { key: 'signOpDate', label: '签订操作时间', type: 'date', required: true },
  { key: 'yearMonth', label: '年月', type: 'text' },
  { key: 'quarter', label: '季度', type: 'text' },
  { key: 'partnerSettle', label: '伙伴结算', type: 'select', options: PARTNER_SETTLE },
  { key: 'remarks', label: '备注', type: 'text' },
];

const FOLLOW_FIELDS = [
  { key: 'oppNo', label: '商机号', type: 'text', required: true },
  { key: 'followDate', label: '日期', type: 'date', required: true },
  { key: 'hours', label: '耗用工时(h)', type: 'number', required: true },
  { key: 'workItem', label: '工作事项', type: 'textarea', required: true },
  { key: 'summary', label: '成果总结', type: 'textarea', required: true },
  { key: 'nextWork', label: '下一步工作', type: 'text', required: true },
  { key: 'nextDate', label: '预计时间', type: 'date', required: true },
];

const JUDGMENT_FIELDS = [
  { key: 'oppNo', label: '商机号', type: 'text', required: true },
  { key: 'judgmentType', label: '判断类型', type: 'text', required: true },
  { key: 'judgmentDate', label: '判断日期', type: 'date', required: true },
  { key: 'result', label: '判断结论', type: 'textarea', required: true },
  { key: 'competitor', label: '竞争对手', type: 'text' },
];

const SALES_Q_FIELDS = [
  { key: 'oppNo', label: '商机号', type: 'text', required: true },
  { key: 'seq', label: '序号', type: 'number', required: true },
  { key: 'question', label: '问题', type: 'textarea', required: true },
  { key: 'answer', label: '回答', type: 'textarea' },
  { key: 'note', label: '备注', type: 'text' },
];

const ALLOCATION_FIELDS = [
  { key: 'oppNo', label: '商机号', type: 'text', required: true },
  { key: 'contractId', label: '合同ID', type: 'text' },
  { key: 'consultant', label: '顾问', type: 'text', required: true },
  { key: 'month', label: '月份', type: 'text' },
  { key: 'quarter', label: '季度', type: 'text' },
  { key: 'consultantPerformance', label: '分配业绩(元)', type: 'number', required: true },
];

const REQUIREMENT_FIELDS = [
  { key: 'oppNo', label: '商机号', type: 'text', required: true },
  { key: 'description', label: '需求描述', type: 'textarea', required: true },
  { key: 'priority', label: '优先级', type: 'text' },
];

// ========== Vue App ==========
const app = createApp({
  setup() {
    // Login
    const loginUsername = ref('');
    const loginPassword = ref('');
    const loginLoading = ref(false);

    async function doLogin() {
      if (!loginUsername.value || !loginPassword.value) { showToast('请输入用户名和密码'); return; }
      loginLoading.value = true;
      try {
        await apiLogin(loginUsername.value, loginPassword.value);
        await loadMe();
      } catch (e) {
        showToast(e.message);
      } finally {
        loginLoading.value = false;
      }
    }

    async function loadMe() {
      const user = await apiMe();
      if (!user) { state.user = null; return; }
      state.user = user;
      await loadState();
    }

    async function loadState() {
      state.loading = true;
      try {
        const d = await apiGetState();
        state.fullState = d.state;
      } catch (e) {
        showToast('加载数据失败: ' + e.message);
      } finally {
        state.loading = false;
      }
    }

    async function doLogout() {
      await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
      state.user = null;
      state.fullState = null;
    }

    // Dashboard computed
    const dashboardStats = computed(() => {
      if (!state.fullState) return { total: 0, won: 0, lost: 0, totalAmount: 0, wonAmount: 0 };
      const year = state.year;
      const apps = (state.fullState.applications || []).filter(a => {
        return new Date(a.applyDate || 0).getFullYear() === year;
      });
      const cons = (state.fullState.contracts || []).filter(c => {
        const d = new Date(c.mainSignDate || c.signDate || 0);
        return d.getFullYear() === year;
      });
      const won = apps.filter(a => a.status === '签单').length;
      const lost = apps.filter(a => a.status === '丢失').length;
      const totalAmount = cons.reduce((s, c) => s + (parseFloat(c.subAmount) || 0), 0) / 10000;
      const wonAmount = cons.reduce((s, c) => {
        const sa = parseFloat(c.subAmount) || 0;
        return s + (sa >= 100000 ? (parseFloat(c.presalePerformance) || 0) : 0);
      }, 0) / 10000;
      return { total: apps.length, won, lost, totalAmount, wonAmount };
    });

    const deptOptions = computed(() => {
      if (!state.fullState) return [];
      return (state.fullState.departments || []).map(d => d.name);
    });

    const myApps = computed(() => myFilter(state.fullState?.applications || [], 'applications'));
    const myContracts = computed(() => myFilter(state.fullState?.contracts || [], 'contracts'));
    const myFollows = computed(() => myFilter(state.fullState?.followUps || [], 'followUps'));
    const myJudgments = computed(() => myFilter(state.fullState?.judgments || [], 'judgments'));
    const mySalesQs = computed(() => myFilter(state.fullState?.salesQuestions || [], 'salesQuestions'));
    const myAllocs = computed(() => myFilter(state.fullState?.allocations || [], 'allocations'));

    const filteredApps = computed(() => filterRecords(myApps.value, { year: state.year, search: state.searchText, status: state.filterStatus }));
    const filteredContracts = computed(() => filterRecords(myContracts.value, { year: state.year, search: state.searchText }));

    // List computed
    const listRecords = computed(() => {
      const tab = state.activeListTab;
      if (tab === 'applications') return filteredApps.value;
      if (tab === 'contracts') return filteredContracts.value;
      if (tab === 'followUps') return filterRecords(myFollows.value, { year: state.year, search: state.searchText });
      if (tab === 'judgments') return filterRecords(myJudgments.value, { year: state.year, search: state.searchText });
      if (tab === 'salesQuestions') return filterRecords(mySalesQs.value, { year: state.year, search: state.searchText });
      if (tab === 'allocations') return filterRecords(myAllocs.value, { year: state.year, search: state.searchText });
      return [];
    });

    // Modal form data
    const formData = reactive({});
    const formLoading = ref(false);

    function openModal(name, mode = 'create', data = {}) {
      state.modal = { name, mode, data };
      // 初始化表单数据
      Object.keys(formData).forEach(k => delete formData[k]);
      if (mode === 'create') {
        // 默认值
        const today = new Date().toISOString().slice(0, 10);
        if (name === 'app') {
          Object.assign(formData, {
            applyDate: today,
            applicant: state.user?.displayName || state.user?.username || '',
            department: state.user?.department || '',
            product: PRODUCTS[0],
            buyMode: BUY_MODES[0],
            currentStage: STAGES[0],
            status: '活跃',
          });
        } else if (name === 'contract') {
          Object.assign(formData, {
            mainSignDate: today,
            signOpDate: today,
            isCloudSub: '否',
            product: PRODUCTS[0],
          });
        } else if (name === 'follow') {
          Object.assign(formData, { followDate: today, nextDate: today });
        } else if (name === 'judgment') {
          Object.assign(formData, { judgmentDate: today });
        } else if (name === 'salesQ') {
          Object.assign(formData, { seq: 1 });
        } else if (name === 'allocation') {
          Object.assign(formData, {});
        } else if (name === 'requirement') {
          Object.assign(formData, {});
        }
      } else {
        Object.assign(formData, { ...data });
      }
    }

    function closeModal() {
      state.modal = null;
    }

    async function saveRecord() {
      if (!state.modal) return;
      const { name, mode, data } = state.modal;
      const module = name === 'salesQ' ? 'salesQuestions' : name === 'judgment' ? 'judgments' : name + 's';
      formLoading.value = true;
      try {
        if (mode === 'create') {
          const d = await apiCreate(module, { ...formData });
          showToast('创建成功');
          await loadState();
        } else {
          const d = await apiUpdate(module, data.id, { ...formData });
          showToast('更新成功');
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
      const module = name === 'salesQ' ? 'salesQuestions' : name === 'judgment' ? 'judgments' : name + 's';
      if (!confirm('确认删除？')) return;
      formLoading.value = true;
      try {
        await apiDelete(module, data.id);
        showToast('已删除');
        await loadState();
        closeModal();
      } catch (e) {
        showToast(e.message);
      } finally {
        formLoading.value = false;
      }
    }

    function getFieldValue(record, key) {
      return record[key] || '';
    }

    function renderFieldValue(record, field) {
      const v = record[field.key];
      if (!v && v !== 0) return '—';
      if (field.type === 'number') return fmtMoney(v);
      if (field.type === 'date') return fmtDate(v);
      return v;
    }

    function getListItemTitle(record, module) {
      if (module === 'applications') return record.customer || record.projectName || record.oppNo || '商机';
      if (module === 'contracts') return record.signCustomerName || record.signCustomer || record.oppNo || '合同';
      if (module === 'followUps') return (record.workItem || '').slice(0, 30) || '跟进';
      if (module === 'judgments') return record.judgmentType || record.oppNo || '判断';
      if (module === 'salesQuestions') return `[${record.seq || ''}] ${(record.question || '').slice(0, 20)}`;
      if (module === 'allocations') return `${record.consultant || ''} - ${fmtMoney(record.consultantPerformance)}元`;
      return record.oppNo || '记录';
    }

    function getListItemSub(record, module) {
      if (module === 'applications') return `${record.oppNo || ''} | ${record.product || ''} | ${record.currentStage || ''}`;
      if (module === 'contracts') return `${fmtMoney(record.subAmount)}元 | ${fmtDate(record.mainSignDate)}`;
      if (module === 'followUps') return `${fmtDate(record.followDate)} | ${record.hours || ''}h`;
      if (module === 'judgments') return `${record.competitor ? '竞品: ' + record.competitor : ''} | ${fmtDate(record.judgmentDate)}`;
      if (module === 'salesQuestions') return `回答: ${record.answer ? '已填写' : '未填写'}`;
      if (module === 'allocations') return `${record.month || record.quarter || ''}`;
      return '';
    }

    // Dept name by consultant
    function getConsultantDept(consultant) {
      if (!state.fullState) return '';
      const emp = (state.fullState.employees || []).find(e => e.name === consultant);
      if (!emp) return '';
      return getDeptNameById(emp.deptId);
    }

    // Render list row badge for applications
    function getAppStatusBadge(record) {
      return getStatusBadge(record.status);
    }

    // Year navigation
    function changeYear(delta) {
      state.year += delta;
    }

    // Init
    onMounted(async () => {
      await loadMe();
    });

    return {
      state, loginUsername, loginPassword, loginLoading,
      doLogin, doLogout, loadState,
      dashboardStats, deptOptions,
      myApps, myContracts, myFollows, myJudgments, mySalesQs, myAllocs,
      filteredApps, filteredContracts, listRecords,
      formData, formLoading, formLoading,
      openModal, closeModal, saveRecord, deleteRecord,
      getFieldValue, renderFieldValue,
      getListItemTitle, getListItemSub,
      getAppStatusBadge, statusClass, getStatusBadge,
      fmtMoney, fmtDate,
      changeYear, getConsultantDept,
      PRODUCTS, BUY_MODES, STAGES, STATUSES, APP_STATUSES, QUARTERS, YES_NO,
      APP_FIELDS, CONTRACT_FIELDS, FOLLOW_FIELDS, JUDGMENT_FIELDS,
      SALES_Q_FIELDS, ALLOCATION_FIELDS, REQUIREMENT_FIELDS,
    };
  },

  template: `
<div>
  <!-- Toast -->
  <div v-if="state.toast" class="m-toast">{{ state.toast }}</div>

  <!-- ========== LOGIN ========== -->
  <div v-if="!state.user" class="login-page">
    <div class="login-logo">📋</div>
    <div class="login-title">售前管理</div>
    <div class="login-subtitle">Presale Management System</div>
    <div class="login-box">
      <div class="login-field">
        <label>用户名</label>
        <input class="login-input" v-model="loginUsername" placeholder="请输入用户名" @keyup.enter="doLogin" />
      </div>
      <div class="login-field">
        <label>密码</label>
        <input class="login-input" type="password" v-model="loginPassword" placeholder="请输入密码" @keyup.enter="doLogin" />
      </div>
      <button class="login-btn" :disabled="loginLoading" @click="doLogin">
        {{ loginLoading ? '登录中...' : '登录' }}
      </button>
    </div>
  </div>

  <!-- ========== MAIN APP ========== -->
  <div v-else>
    <!-- Header -->
    <div class="m-header">
      <div class="m-header-title">售前管理</div>
      <div class="m-header-right" style="font-size:13px;color:rgba(255,255,255,0.8)">{{ state.user?.displayName || state.user?.username }}</div>
    </div>

    <!-- Dashboard Tab -->
    <div v-if="state.activeTab === 'dashboard'" class="m-page">
      <!-- Year picker -->
      <div class="year-picker">
        <button class="year-btn" @click="changeYear(-1)">‹</button>
        <span class="year-current">{{ state.year }}年</span>
        <button class="year-btn" @click="changeYear(1)">›</button>
      </div>

      <!-- Stats Cards -->
      <div class="m-card">
        <div class="stat-grid">
          <div class="stat-item">
            <div class="stat-label">商机总数</div>
            <div class="stat-value blue">{{ dashboardStats.total }}</div>
          </div>
          <div class="stat-item">
            <div class="stat-label">签单数</div>
            <div class="stat-value green">{{ dashboardStats.won }}</div>
          </div>
          <div class="stat-item">
            <div class="stat-label">丢失数</div>
            <div class="stat-value red">{{ dashboardStats.lost }}</div>
          </div>
          <div class="stat-item">
            <div class="stat-label">签单金额</div>
            <div class="stat-value">{{ dashboardStats.wonAmount.toFixed(1) }}<span class="stat-unit">万</span></div>
          </div>
        </div>
      </div>

      <!-- My Apps Summary -->
      <div class="m-card" style="margin-top:12px">
        <div class="section-header" style="padding:0 0 10px">
          <span class="section-title">我的售前申请</span>
        </div>
        <div v-if="filteredApps.length === 0" class="m-empty" style="padding:24px 0">
          <div class="m-empty-text text-muted">暂无数据</div>
        </div>
        <div v-for="app in filteredApps.slice(0, 5)" :key="app.id" class="m-list-item" @click="openModal('app','view',app)">
          <div class="m-list-content">
            <div class="m-list-title">{{ app.customer }} {{ app.projectName ? '/ ' + app.projectName : '' }}</div>
            <div class="m-list-sub">{{ app.oppNo }} | {{ app.product }} | {{ app.currentStage }}</div>
          </div>
          <span :class="'badge ' + getAppStatusBadge(app)">{{ app.status }}</span>
        </div>
      </div>

      <!-- My Contracts Summary -->
      <div class="m-card" style="margin-top:12px">
        <div class="section-header" style="padding:0 0 10px">
          <span class="section-title">我的合同</span>
        </div>
        <div v-if="filteredContracts.length === 0" class="m-empty" style="padding:24px 0">
          <div class="m-empty-text text-muted">暂无数据</div>
        </div>
        <div v-for="c in filteredContracts.slice(0, 5)" :key="c.id" class="m-list-item" @click="openModal('contract','view',c)">
          <div class="m-list-content">
            <div class="m-list-title">{{ c.signCustomerName || c.signCustomer }}</div>
            <div class="m-list-sub">{{ fmtMoney(c.subAmount) }}元 | {{ fmtDate(c.mainSignDate) }}</div>
          </div>
        </div>
      </div>
    </div>

    <!-- List Tab -->
    <div v-if="state.activeTab === 'list'" class="m-page">
      <!-- Search -->
      <div class="m-search-bar">
        <div class="m-search-input-wrap" style="flex:1">
          <span style="color:var(--dt-gray-4);font-size:14px">🔍</span>
          <input v-model="state.searchText" placeholder="搜索客户/商机号/项目..." />
        </div>
      </div>

      <!-- Module Tabs -->
      <div class="m-tabs">
        <div class="m-tab" :class="{ active: state.activeListTab === 'applications' }" @click="state.activeListTab = 'applications'">申请</div>
        <div class="m-tab" :class="{ active: state.activeListTab === 'contracts' }" @click="state.activeListTab = 'contracts'">合同</div>
        <div class="m-tab" :class="{ active: state.activeListTab === 'followUps' }" @click="state.activeListTab = 'followUps'">跟进</div>
        <div class="m-tab" :class="{ active: state.activeListTab === 'judgments' }" @click="state.activeListTab = 'judgments'">判断</div>
        <div class="m-tab" :class="{ active: state.activeListTab === 'salesQuestions' }" @click="state.activeListTab = 'salesQuestions'">问答</div>
        <div class="m-tab" :class="{ active: state.activeListTab === 'allocations' }" @click="state.activeListTab = 'allocations'">分配</div>
      </div>

      <!-- Filter chips -->
      <div class="chip-list" v-if="state.activeListTab === 'applications'">
        <div class="chip" :class="{ active: !state.filterStatus }" @click="state.filterStatus = ''">全部</div>
        <div class="chip" :class="{ active: state.filterStatus === '活跃' }" @click="state.filterStatus = '活跃'">活跃</div>
        <div class="chip" :class="{ active: state.filterStatus === '签单' }" @click="state.filterStatus = '签单'">签单</div>
        <div class="chip" :class="{ active: state.filterStatus === '暂停' }" @click="state.filterStatus = '暂停'">暂停</div>
        <div class="chip" :class="{ active: state.filterStatus === '丢失' }" @click="state.filterStatus = '丢失'">丢失</div>
        <div class="chip" :class="{ active: state.filterStatus === '关闭' }" @click="state.filterStatus = '关闭'">关闭</div>
      </div>

      <!-- List -->
      <div class="m-list" style="margin-top:0">
        <div v-if="listRecords.length === 0" class="m-empty">
          <div class="m-empty-icon">📭</div>
          <div class="m-empty-text">暂无数据</div>
        </div>
        <div v-for="r in listRecords" :key="r.id" class="m-list-item" @click="openModal(state.activeListTab.slice(0,-1),'view',r)">
          <div v-if="state.activeListTab === 'applications'" style="display:flex;align-items:center;gap:8px;flex:1;min-width:0">
            <div class="m-list-content" style="flex:1">
              <div class="m-list-title truncate">{{ r.customer }} {{ r.projectName ? '/ ' + r.projectName : '' }}</div>
              <div class="m-list-sub">{{ r.oppNo }} | {{ r.product }} | {{ r.currentStage }}</div>
            </div>
            <span :class="'badge ' + getAppStatusBadge(r)">{{ r.status }}</span>
          </div>
          <div v-else-if="state.activeListTab === 'contracts'" style="display:flex;align-items:center;gap:8px;flex:1">
            <div class="m-list-content" style="flex:1">
              <div class="m-list-title truncate">{{ r.signCustomerName || r.signCustomer }}</div>
              <div class="m-list-sub">{{ fmtMoney(r.subAmount) }}元 | {{ fmtDate(r.mainSignDate) }}</div>
            </div>
          </div>
          <div v-else style="display:flex;align-items:center;gap:8px;flex:1">
            <div class="m-list-content" style="flex:1">
              <div class="m-list-title truncate">{{ getListItemTitle(r, state.activeListTab) }}</div>
              <div class="m-list-sub">{{ getListItemSub(r, state.activeListTab) }}</div>
            </div>
          </div>
          <div class="m-list-arrow">›</div>
        </div>
      </div>

      <!-- FAB: Add -->
      <div class="m-fab" @click="openModal(state.activeListTab.slice(0,-1),'create',{})">+</div>
    </div>

    <!-- Admin Tab -->
    <div v-if="state.activeTab === 'admin' && state.user?.role === 'admin'" class="m-page">
      <div class="m-list" style="margin-top:0">
        <div class="m-list-item" @click="state.activeAdminSub = 'dept'">
          <div class="m-list-icon" style="background:#EFF6FF">🏢</div>
          <div class="m-list-content">
            <div class="m-list-title">部门管理</div>
            <div class="m-list-sub">查看/添加/编辑部门</div>
          </div>
          <div class="m-list-arrow">›</div>
        </div>
        <div class="m-list-item" @click="state.activeAdminSub = 'emp'">
          <div class="m-list-icon" style="background:#F0FDF4">👥</div>
          <div class="m-list-content">
            <div class="m-list-title">员工管理</div>
            <div class="m-list-sub">查看/添加/编辑员工</div>
          </div>
          <div class="m-list-arrow">›</div>
        </div>
        <div class="m-list-item" @click="state.activeAdminSub = 'user'">
          <div class="m-list-icon" style="background:#FEF3C7">🔐</div>
          <div class="m-list-content">
            <div class="m-list-title">用户管理</div>
            <div class="m-list-sub">查看/添加/编辑用户</div>
          </div>
          <div class="m-list-arrow">›</div>
        </div>
        <div class="m-list-item" @click="doLogout">
          <div class="m-list-icon" style="background:#FEE2E2">🚪</div>
          <div class="m-list-content">
            <div class="m-list-title text-red">退出登录</div>
            <div class="m-list-sub">{{ state.user?.displayName || state.user?.username }}</div>
          </div>
        </div>
      </div>
    </div>

    <!-- Profile Tab -->
    <div v-if="state.activeTab === 'profile'" class="m-page">
      <div class="m-card" style="margin-top:0">
        <div style="display:flex;align-items:center;gap:14px;padding:8px 0">
          <div style="width:56px;height:56px;background:var(--dt-blue);border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:24px;color:#fff;font-weight:700">
            {{ (state.user?.displayName || state.user?.username || '?').slice(0,1) }}
          </div>
          <div>
            <div style="font-size:17px;font-weight:600">{{ state.user?.displayName || state.user?.username }}</div>
            <div class="text-muted text-sm mt-4">{{ state.user?.role === 'admin' ? '管理员' : '普通用户' }}</div>
            <div class="text-muted text-sm">{{ state.user?.department }}</div>
          </div>
        </div>
      </div>
      <div class="m-list" style="margin-top:12px">
        <div class="m-list-item" @click="doLogout">
          <div class="m-list-icon" style="background:#FEE2E2">🚪</div>
          <div class="m-list-content">
            <div class="m-list-title text-red">退出登录</div>
          </div>
        </div>
      </div>
    </div>

    <!-- Tab Bar -->
    <div class="m-tabbar">
      <div class="m-tab-item" :class="{ active: state.activeTab === 'dashboard' }" @click="state.activeTab = 'dashboard'">
        <div class="m-tab-icon">📊</div>
        <div class="m-tab-label">看板</div>
      </div>
      <div class="m-tab-item" :class="{ active: state.activeTab === 'list' }" @click="state.activeTab = 'list'">
        <div class="m-tab-icon">📋</div>
        <div class="m-tab-label">数据</div>
      </div>
      <div v-if="state.user?.role === 'admin'" class="m-tab-item" :class="{ active: state.activeTab === 'admin' }" @click="state.activeTab = 'admin'">
        <div class="m-tab-icon">⚙️</div>
        <div class="m-tab-label">管理</div>
      </div>
      <div class="m-tab-item" :class="{ active: state.activeTab === 'profile' }" @click="state.activeTab = 'profile'">
        <div class="m-tab-icon">👤</div>
        <div class="m-tab-label">我的</div>
      </div>
    </div>
  </div>

  <!-- ========== MODAL ========== -->
  <div v-if="state.modal" class="m-modal-overlay" @click.self="closeModal">
    <div class="m-modal" @click.stop>
      <div class="m-modal-header">
        <div class="m-modal-title">
          <span v-if="state.modal.mode === 'create'">新建</span>
          <span v-else-if="state.modal.mode === 'view'">详情</span>
          <span v-else>编辑</span>
          {{ state.modal.name === 'salesQ' ? '售前问答' : state.modal.name === 'judgment' ? '顾问判断' : state.modal.name === 'allocation' ? '业绩分配' : state.modal.name === 'app' ? '售前申请' : state.modal.name === 'contract' ? '合同' : state.modal.name === 'follow' ? '项目跟进' : '记录' }}
        </div>
        <div class="m-modal-close" @click="closeModal">✕</div>
      </div>

      <div class="m-modal-body">
        <!-- APP FORM -->
        <div v-if="state.modal.name === 'app'">
          <div class="m-form">
            <template v-if="state.modal.mode === 'view'">
              <div class="m-detail-item"><div class="m-detail-label">申请日期</div><div class="m-detail-value">{{ fmtDate(formData.applyDate) }}</div></div>
              <div class="m-detail-item"><div class="m-detail-label">申请人</div><div class="m-detail-value">{{ formData.applicant }}</div></div>
              <div class="m-detail-item"><div class="m-detail-label">申请部门</div><div class="m-detail-value">{{ formData.department }}</div></div>
              <div class="m-detail-item"><div class="m-detail-label">客户名称</div><div class="m-detail-value">{{ formData.customer }}</div></div>
              <div class="m-detail-item"><div class="m-detail-label">商机号</div><div class="m-detail-value">{{ formData.oppNo }}</div></div>
              <div class="m-detail-item"><div class="m-detail-label">项目名称</div><div class="m-detail-value">{{ formData.projectName }}</div></div>
              <div class="m-detail-item"><div class="m-detail-label">预购产品</div><div class="m-detail-value">{{ formData.product }}</div></div>
              <div class="m-detail-item"><div class="m-detail-label">购买模式</div><div class="m-detail-value">{{ formData.buyMode }}</div></div>
              <div class="m-detail-item"><div class="m-detail-label">当前阶段</div><div class="m-detail-value">{{ formData.currentStage }}</div></div>
              <div class="m-detail-item"><div class="m-detail-label">项目状态</div><div class="m-detail-value"><span :class="'badge ' + getStatusBadge(formData.status)">{{ formData.status }}</span></div></div>
              <div class="m-detail-item"><div class="m-detail-label">核心需求</div><div class="m-detail-value">{{ formData.coreRequirement }}</div></div>
              <div v-if="formData.expectedSignDate" class="m-detail-item"><div class="m-detail-label">预计签单时间</div><div class="m-detail-value">{{ fmtDate(formData.expectedSignDate) }}</div></div>
              <div v-if="formData.expectedSignAmount" class="m-detail-item"><div class="m-detail-label">预计签单金额</div><div class="m-detail-value">{{ fmtMoney(formData.expectedSignAmount) }}元</div></div>
            </template>
            <template v-else>
              <div v-for="field in APP_FIELDS" :key="field.key" class="m-form-group">
                <label class="m-form-label">
                  {{ field.label }}<span v-if="field.required" class="req">*</span>
                </label>
                <select v-if="field.type === 'select'" class="m-select" v-model="formData[field.key]" :disabled="state.modal.mode === 'view'">
                  <option v-for="opt in field.options" :key="opt" :value="opt">{{ opt }}</option>
                </select>
                <textarea v-else-if="field.type === 'textarea'" class="m-textarea" v-model="formData[field.key]" :disabled="state.modal.mode === 'view'" :rows="field.key === 'coreRequirement' ? 4 : 3" />
                <input v-else :type="field.type || 'text'" class="m-input" v-model="formData[field.key]" :disabled="state.modal.mode === 'view'" />
              </div>
            </template>
          </div>
        </div>

        <!-- CONTRACT FORM -->
        <div v-if="state.modal.name === 'contract'">
          <div class="m-form">
            <template v-if="state.modal.mode === 'view'">
              <div class="m-detail-item"><div class="m-detail-label">申请商机</div><div class="m-detail-value">{{ formData.oppNo }}</div></div>
              <div class="m-detail-item"><div class="m-detail-label">签约商机</div><div class="m-detail-value">{{ formData.signOppNo }}</div></div>
              <div class="m-detail-item"><div class="m-detail-label">主合同编号</div><div class="m-detail-value">{{ formData.mainContractNo }}</div></div>
              <div class="m-detail-item"><div class="m-detail-label">签约客户</div><div class="m-detail-value">{{ formData.signCustomerName || formData.signCustomer }}</div></div>
              <div class="m-detail-item"><div class="m-detail-label">客户经理</div><div class="m-detail-value">{{ formData.accountMgr }}</div></div>
              <div class="m-detail-item"><div class="m-detail-label">销售部门</div><div class="m-detail-value">{{ formData.salesDept }}</div></div>
              <div class="m-detail-item"><div class="m-detail-label">所购产品</div><div class="m-detail-value">{{ formData.product }}</div></div>
              <div class="m-detail-item"><div class="m-detail-label">合同金额</div><div class="m-detail-value text-blue font-bold">{{ fmtMoney(formData.subAmount) }}元</div></div>
              <div class="m-detail-item"><div class="m-detail-label">实际成本</div><div class="m-detail-value">{{ fmtMoney(formData.actualCost) }}元</div></div>
              <div class="m-detail-item"><div class="m-detail-label">订阅业绩</div><div class="m-detail-value">{{ fmtMoney(formData.subPerformance) }}元</div></div>
              <div class="m-detail-item"><div class="m-detail-label">售前业绩</div><div class="m-detail-value">{{ fmtMoney(formData.presalePerformance) }}元</div></div>
              <div class="m-detail-item"><div class="m-detail-label">云订阅</div><div class="m-detail-value">{{ formData.isCloudSub }}</div></div>
              <div class="m-detail-item"><div class="m-detail-label">签订时间</div><div class="m-detail-value">{{ fmtDate(formData.mainSignDate) }}</div></div>
              <div class="m-detail-item"><div class="m-detail-label">备注</div><div class="m-detail-value">{{ formData.remarks }}</div></div>
            </template>
            <template v-else>
              <div v-for="field in CONTRACT_FIELDS" :key="field.key" class="m-form-group">
                <label class="m-form-label">{{ field.label }}<span v-if="field.required" class="req">*</span></label>
                <select v-if="field.type === 'select'" class="m-select" v-model="formData[field.key]">
                  <option v-for="opt in field.options" :key="opt" :value="opt">{{ opt }}</option>
                </select>
                <input v-else :type="field.type || 'text'" class="m-input" v-model="formData[field.key]" />
              </div>
            </template>
          </div>
        </div>

        <!-- FOLLOW FORM -->
        <div v-if="state.modal.name === 'follow'">
          <div class="m-form">
            <template v-if="state.modal.mode === 'view'">
              <div class="m-detail-item"><div class="m-detail-label">商机号</div><div class="m-detail-value">{{ formData.oppNo }}</div></div>
              <div class="m-detail-item"><div class="m-detail-label">日期</div><div class="m-detail-value">{{ fmtDate(formData.followDate) }}</div></div>
              <div class="m-detail-item"><div class="m-detail-label">工时</div><div class="m-detail-value">{{ formData.hours }}h</div></div>
              <div class="m-detail-item"><div class="m-detail-label">工作事项</div><div class="m-detail-value">{{ formData.workItem }}</div></div>
              <div class="m-detail-item"><div class="m-detail-label">成果总结</div><div class="m-detail-value">{{ formData.summary }}</div></div>
              <div class="m-detail-item"><div class="m-detail-label">下一步</div><div class="m-detail-value">{{ formData.nextWork }}</div></div>
              <div class="m-detail-item"><div class="m-detail-label">预计时间</div><div class="m-detail-value">{{ fmtDate(formData.nextDate) }}</div></div>
            </template>
            <template v-else>
              <div v-for="field in FOLLOW_FIELDS" :key="field.key" class="m-form-group">
                <label class="m-form-label">{{ field.label }}<span v-if="field.required" class="req">*</span></label>
                <textarea v-if="field.type === 'textarea'" class="m-textarea" v-model="formData[field.key]" rows="3" />
                <input v-else :type="field.type || 'text'" class="m-input" v-model="formData[field.key]" />
              </div>
            </template>
          </div>
        </div>

        <!-- JUDGMENT FORM -->
        <div v-if="state.modal.name === 'judgment'">
          <div class="m-form">
            <template v-if="state.modal.mode === 'view'">
              <div class="m-detail-item"><div class="m-detail-label">商机号</div><div class="m-detail-value">{{ formData.oppNo }}</div></div>
              <div class="m-detail-item"><div class="m-detail-label">判断类型</div><div class="m-detail-value">{{ formData.judgmentType }}</div></div>
              <div class="m-detail-item"><div class="m-detail-label">判断日期</div><div class="m-detail-value">{{ fmtDate(formData.judgmentDate) }}</div></div>
              <div class="m-detail-item"><div class="m-detail-label">判断结论</div><div class="m-detail-value">{{ formData.result }}</div></div>
              <div v-if="formData.competitor" class="m-detail-item"><div class="m-detail-label">竞争对手</div><div class="m-detail-value">{{ formData.competitor }}</div></div>
            </template>
            <template v-else>
              <div v-for="field in JUDGMENT_FIELDS" :key="field.key" class="m-form-group">
                <label class="m-form-label">{{ field.label }}<span v-if="field.required" class="req">*</span></label>
                <textarea v-if="field.type === 'textarea'" class="m-textarea" v-model="formData[field.key]" rows="3" />
                <input v-else :type="field.type || 'text'" class="m-input" v-model="formData[field.key]" />
              </div>
            </template>
          </div>
        </div>

        <!-- SALES Q FORM -->
        <div v-if="state.modal.name === 'salesQ'">
          <div class="m-form">
            <template v-if="state.modal.mode === 'view'">
              <div class="m-detail-item"><div class="m-detail-label">商机号</div><div class="m-detail-value">{{ formData.oppNo }}</div></div>
              <div class="m-detail-item"><div class="m-detail-label">序号</div><div class="m-detail-value">{{ formData.seq }}</div></div>
              <div class="m-detail-item"><div class="m-detail-label">问题</div><div class="m-detail-value">{{ formData.question }}</div></div>
              <div class="m-detail-item"><div class="m-detail-label">回答</div><div class="m-detail-value">{{ formData.answer || '—' }}</div></div>
              <div v-if="formData.note" class="m-detail-item"><div class="m-detail-label">备注</div><div class="m-detail-value">{{ formData.note }}</div></div>
            </template>
            <template v-else>
              <div v-for="field in SALES_Q_FIELDS" :key="field.key" class="m-form-group">
                <label class="m-form-label">{{ field.label }}<span v-if="field.required" class="req">*</span></label>
                <textarea v-if="field.type === 'textarea'" class="m-textarea" v-model="formData[field.key]" rows="3" />
                <input v-else :type="field.type || 'text'" class="m-input" v-model="formData[field.key]" />
              </div>
            </template>
          </div>
        </div>

        <!-- ALLOCATION FORM -->
        <div v-if="state.modal.name === 'allocation'">
          <div class="m-form">
            <template v-if="state.modal.mode === 'view'">
              <div class="m-detail-item"><div class="m-detail-label">商机号</div><div class="m-detail-value">{{ formData.oppNo }}</div></div>
              <div class="m-detail-item"><div class="m-detail-label">顾问</div><div class="m-detail-value">{{ formData.consultant }}</div></div>
              <div class="m-detail-item"><div class="m-detail-label">月份</div><div class="m-detail-value">{{ formData.month }}</div></div>
              <div class="m-detail-item"><div class="m-detail-label">季度</div><div class="m-detail-value">{{ formData.quarter }}</div></div>
              <div class="m-detail-item"><div class="m-detail-label">分配业绩</div><div class="m-detail-value text-green font-bold">{{ fmtMoney(formData.consultantPerformance) }}元</div></div>
            </template>
            <template v-else>
              <div v-for="field in ALLOCATION_FIELDS" :key="field.key" class="m-form-group">
                <label class="m-form-label">{{ field.label }}<span v-if="field.required" class="req">*</span></label>
                <input :type="field.type || 'text'" class="m-input" v-model="formData[field.key]" />
              </div>
            </template>
          </div>
        </div>
      </div>

      <!-- Modal Footer -->
      <div class="m-modal-footer">
        <button v-if="state.modal.mode === 'view'" class="m-btn m-btn-danger" :disabled="formLoading" @click="deleteRecord">删除</button>
        <button v-if="state.modal.mode !== 'view'" class="m-btn m-btn-default" @click="closeModal">取消</button>
        <button v-if="state.modal.mode !== 'view'" class="m-btn m-btn-primary" :disabled="formLoading" @click="saveRecord">
          {{ formLoading ? '保存中...' : '保存' }}
        </button>
        <button v-if="state.modal.mode === 'view'" class="m-btn m-btn-primary" @click="state.modal.mode = 'edit'">编辑</button>
      </div>
    </div>
  </div>
</div>
  `
});

app.mount('#app');
