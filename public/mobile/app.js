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

// admin 看到全部，非admin只看本人
function getVisibleRecords(module) {
  const all = state.fullState ? (state.fullState[module] || []) : [];
  if (state.user?.role === 'admin') return all.filter(r => !r.deleted);
  const me = state.user?.displayName || state.user?.username || '';
  return all.filter(r => !r.deleted && r.consultant === me);
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
        // admin 需要加载用户列表
        if (state.user?.role === 'admin') {
          await loadAdminUsers();
        }
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
      if (!state.fullState) return { total: 0, won: 0, lost: 0, totalAmount: 0, wonAmount: 0, activeCount: 0 };
      const year = state.year;
      const apps = (state.fullState.applications || []).filter(a =>
        new Date(a.applyDate || 0).getFullYear() === year && !a.deleted
      );
      const cons = (state.fullState.contracts || []).filter(c =>
        new Date(c.mainSignDate || c.signDate || 0).getFullYear() === year && !c.deleted
      );
      const won = apps.filter(a => a.status === '签单').length;
      const lost = apps.filter(a => a.status === '丢失').length;
      const activeCount = apps.filter(a => a.status === '活跃' || a.status === '预计').length;
      const totalAmount = cons.reduce((s, c) => s + (parseFloat(c.subAmount) || 0), 0) / 10000;
      const wonAmount = cons.reduce((s, c) => {
        const sa = parseFloat(c.subAmount) || 0;
        return s + (sa >= 100000 ? (parseFloat(c.presalePerformance) || 0) : 0);
      }, 0) / 10000;
      // 年度目标（来自 state.annualTarget）
      const annualTarget = parseFloat(state.fullState.annualTarget || 0);
      return { total: apps.length, won, lost, activeCount, totalAmount, wonAmount, annualTarget };
    });

    const myVisibleApps = computed(() => getVisibleRecords('applications'));
    const myVisibleContracts = computed(() => getVisibleRecords('contracts'));
    const filteredApps = computed(() => filterRecords(myVisibleApps.value, { year: state.year, status: state.filterStatus, search: state.searchText }));
    const filteredContracts = computed(() => filterRecords(myVisibleContracts.value, { year: state.year, search: state.searchText }));
    const myFollows = computed(() => getVisibleRecords('followUps'));
    const myJudgments = computed(() => getVisibleRecords('judgments'));
    const mySalesQs = computed(() => getVisibleRecords('salesQuestions'));
    const myAllocs = computed(() => getVisibleRecords('allocations'));

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

    // ── Modal ──
    const formData = reactive({});
    const formLoading = ref(false);

    function openModal(name, mode = 'create', data = {}, extra = {}) {
      state.modal = { name, mode, data, extra };
      Object.keys(formData).forEach(k => delete formData[k]);
      const today = new Date().toISOString().slice(0, 10);
      if (mode === 'create') {
        if (name === 'app') {
          Object.assign(formData, { applyDate: today, applicant: state.user?.displayName || state.user?.username || '', department: state.user?.department || '', product: PRODUCTS[0], buyMode: BUY_MODES[0], currentStage: STAGES[0], status: '活跃' });
        } else if (name === 'contract') {
          Object.assign(formData, { mainSignDate: today, signOpDate: today, isCloudSub: '否', product: PRODUCTS[0] });
        } else if (name === 'follow') {
          Object.assign(formData, { followDate: today, nextDate: today });
        } else if (name === 'judgment') {
          Object.assign(formData, { judgmentDate: today });
        } else if (name === 'salesQ') {
          Object.assign(formData, { seq: 1 });
        } else if (name === 'allocation') {
          Object.assign(formData, {});
        }
      } else {
        Object.assign(formData, { ...data });
      }
    }

    function closeModal() { state.modal = null; }

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
        await API.updateUser(state.user.userId, {
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
      listRecords,
      formData, formLoading,
      openModal, closeModal, saveRecord, deleteRecord, saveSelfProfile,
      getListItemTitle, getListItemSub,
      getStatusBadge, fmtMoney, fmtDate, getDeptName, getEmpName,
      changeYear, listTabToModal, modalTitle, getFieldsForModal,
      PRODUCTS, BUY_MODES, STAGES, APP_STATUSES, YES_NO, QUARTERS,
      APP_FIELDS, CONTRACT_FIELDS, FOLLOW_FIELDS, JUDGMENT_FIELDS,
      SALES_Q_FIELDS, ALLOCATION_FIELDS, DEPT_FIELDS, EMP_FIELDS,
      USER_FIELDS_ADMIN, USER_FIELDS_SELF,
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

      <!-- 模块 tab -->
      <div class="dt-tab-nav">
        <div class="dt-tab-item" :class="{ active: state.activeListTab === 'applications' }" @click="state.activeListTab = 'applications'">申请</div>
        <div class="dt-tab-item" :class="{ active: state.activeListTab === 'contracts' }" @click="state.activeListTab = 'contracts'">合同</div>
        <div class="dt-tab-item" :class="{ active: state.activeListTab === 'followUps' }" @click="state.activeListTab = 'followUps'">跟进</div>
        <div class="dt-tab-item" :class="{ active: state.activeListTab === 'judgments' }" @click="state.activeListTab = 'judgments'">判断</div>
        <div class="dt-tab-item" :class="{ active: state.activeListTab === 'salesQuestions' }" @click="state.activeListTab = 'salesQuestions'">问答</div>
        <div class="dt-tab-item" :class="{ active: state.activeListTab === 'allocations' }" @click="state.activeListTab = 'allocations'">分配</div>
      </div>

      <!-- 状态过滤（仅申请） -->
      <div v-if="state.activeListTab === 'applications'" class="dt-chip-row">
        <div class="dt-chip" :class="{ active: !state.filterStatus }" @click="state.filterStatus = ''">全部</div>
        <div class="dt-chip" :class="{ active: state.filterStatus === '活跃' }" @click="state.filterStatus = '活跃'">活跃</div>
        <div class="dt-chip" :class="{ active: state.filterStatus === '签单' }" @click="state.filterStatus = '签单'">签单</div>
        <div class="dt-chip" :class="{ active: state.filterStatus === '暂停' }" @click="state.filterStatus = '暂停'">暂停</div>
        <div class="dt-chip" :class="{ active: state.filterStatus === '丢失' }" @click="state.filterStatus = '丢失'">丢失</div>
        <div class="dt-chip" :class="{ active: state.filterStatus === '关闭' }" @click="state.filterStatus = '关闭'">关闭</div>
      </div>

      <!-- 记录列表 -->
      <div class="dt-list">
        <div v-if="listRecords.length === 0" class="dt-empty">
          <div class="dt-empty-icon">📭</div>
          <div class="dt-empty-text">暂无数据</div>
        </div>
        <div v-for="r in listRecords" :key="r.id" class="dt-list-row" @click="openModal(listTabToModal(state.activeListTab),'view',r)">
          <div v-if="state.activeListTab === 'applications'" class="dt-list-info" style="flex:1">
            <div class="dt-list-title" v-text="(r.customer||'') + (r.projectName ? ' / '+r.projectName : '')"></div>
            <div class="dt-list-sub" v-text="(r.oppNo||'') + ' | ' + (r.product||'') + ' | ' + (r.currentStage||'')"></div>
          </div>
          <div v-else-if="state.activeListTab === 'contracts'" class="dt-list-info" style="flex:1">
            <div class="dt-list-title" v-text="r.signCustomerName || r.signCustomer"></div>
            <div class="dt-list-sub" v-text="fmtMoney(r.subAmount) + '元 | ' + fmtDate(r.mainSignDate)"></div>
          </div>
          <div v-else class="dt-list-info" style="flex:1">
            <div class="dt-list-title" v-text="getListItemTitle(r, state.activeListTab)"></div>
            <div class="dt-list-sub" v-text="getListItemSub(r, state.activeListTab)"></div>
          </div>
          <div v-if="state.activeListTab === 'applications'" class="dt-list-badge">
            <span class="dt-badge" :class="getStatusBadge(r.status)" v-text="r.status"></span>
          </div>
          <div class="dt-list-arrow">›</div>
        </div>
      </div>

      <!-- FAB -->
      <div class="dt-fab" @click="openModal(listTabToModal(state.activeListTab),'create',{})">+</div>
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
      <div class="dt-profile-card">
        <div class="dt-profile-avatar" v-text="(state.user.displayName || state.user.username || '?').slice(0,1)"></div>
        <div class="dt-profile-name" v-text="state.user.displayName || state.user.username"></div>
        <div class="dt-profile-role" v-text="state.user.role === 'admin' ? '👑 管理员' : '👤 普通用户'"></div>
        <div class="dt-profile-dept" v-text="state.user.department || '未设置部门'"></div>
      </div>
      <div class="dt-list" style="margin-top:12px">
        <div class="dt-list-row" @click="openModal('selfProfile','edit',{})">
          <div class="dt-admin-icon" style="background:#EFF6FF">✏️</div>
          <div class="dt-list-info" style="flex:1">
            <div class="dt-list-title">编辑个人信息</div>
            <div class="dt-list-sub">修改显示名、部门</div>
          </div>
          <div class="dt-list-arrow">›</div>
        </div>
        <div class="dt-list-row" @click="doLogout" style="border-top: 8px solid #F3F4F6">
          <div class="dt-admin-icon" style="background:#FEE2E2">🚪</div>
          <div class="dt-list-info" style="flex:1">
            <div class="dt-list-title dt-text-danger">退出登录</div>
          </div>
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
  <div v-if="state.modal" class="dt-modal-overlay" @click.self="closeModal">
    <div class="dt-modal" @click.stop>

      <!-- Modal Header -->
      <div class="dt-modal-hd">
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

        <!-- ── 申请/合同时通用详情 ── -->
        <template v-if="state.modal.mode === 'view' && (state.modal.name === 'app' || state.modal.name === 'contract' || state.modal.name === 'follow' || state.modal.name === 'judgment' || state.modal.name === 'salesQ' || state.modal.name === 'allocation')">
          <div class="dt-detail-list">
            <div v-for="field in getFieldsForModal(state.modal.name)" :key="field.key" class="dt-detail-row">
              <div class="dt-detail-lbl" v-text="field.label"></div>
              <div class="dt-detail-val" v-if="field.type === 'select'" v-text="formData[field.key] || '—'"></div>
              <div class="dt-detail-val dt-text-primary dt-font-bold" v-else-if="field.key === 'subAmount' || field.key === 'consultantPerformance'" v-text="fmtMoney(formData[field.key]) + '元'"></div>
              <div class="dt-detail-val" v-else-if="field.type === 'number'" v-text="fmtMoney(formData[field.key])"></div>
              <div class="dt-detail-val" v-else v-text="formData[field.key] || '—'"></div>
            </div>
          </div>
        </template>

        <!-- ── 申请表单 ── -->
        <template v-else-if="state.modal.name === 'app'">
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
        <template v-else-if="state.modal.name === 'contract'">
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
        <template v-else-if="state.modal.name === 'follow'">
          <div class="dt-form">
            <div v-for="field in FOLLOW_FIELDS" :key="field.key" class="dt-form-group">
              <div class="dt-form-label" v-text="field.label + (field.required ? ' *' : '')"></div>
              <textarea v-if="field.type === 'textarea'" class="dt-input dt-textarea" v-model="formData[field.key]" rows="3"></textarea>
              <input v-else :type="field.type === 'number' ? 'number' : 'text'" class="dt-input" v-model="formData[field.key]" />
            </div>
          </div>
        </template>

        <!-- ── 判断表单 ── -->
        <template v-else-if="state.modal.name === 'judgment'">
          <div class="dt-form">
            <div v-for="field in JUDGMENT_FIELDS" :key="field.key" class="dt-form-group">
              <div class="dt-form-label" v-text="field.label + (field.required ? ' *' : '')"></div>
              <textarea v-if="field.type === 'textarea'" class="dt-input dt-textarea" v-model="formData[field.key]" rows="3"></textarea>
              <input v-else :type="field.type === 'number' ? 'number' : 'text'" class="dt-input" v-model="formData[field.key]" />
            </div>
          </div>
        </template>

        <!-- ── 问答表单 ── -->
        <template v-else-if="state.modal.name === 'salesQ'">
          <div class="dt-form">
            <div v-for="field in SALES_Q_FIELDS" :key="field.key" class="dt-form-group">
              <div class="dt-form-label" v-text="field.label + (field.required ? ' *' : '')"></div>
              <textarea v-if="field.type === 'textarea'" class="dt-input dt-textarea" v-model="formData[field.key]" rows="3"></textarea>
              <input v-else :type="field.type === 'number' ? 'number' : 'text'" class="dt-input" v-model="formData[field.key]" />
            </div>
          </div>
        </template>

        <!-- ── 分配表单 ── -->
        <template v-else-if="state.modal.name === 'allocation'">
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

        <!-- ── 个人信息编辑 ── -->
        <template v-else-if="state.modal.name === 'selfProfile'">
          <div class="dt-form">
            <div class="dt-form-group">
              <div class="dt-form-label">用户名</div>
              <input type="text" class="dt-input dt-input-disabled" v-model="formData.username" disabled />
            </div>
            <div class="dt-form-group">
              <div class="dt-form-label">显示名 <span style="color:#EF4444">*</span></div>
              <input type="text" class="dt-input" v-model="formData.display_name" />
            </div>
            <div class="dt-form-group">
              <div class="dt-form-label">部门</div>
              <input type="text" class="dt-input" v-model="formData.department" />
            </div>
          </div>
        </template>

      </div>

      <!-- Modal Footer -->
      <div class="dt-modal-ft">
        <button v-if="state.modal.mode === 'view' && state.modal.name !== 'selfProfile'" class="dt-btn dt-btn-danger" :disabled="formLoading" @click="deleteRecord">删除</button>
        <button v-if="state.modal.mode !== 'view'" class="dt-btn dt-btn-default" @click="closeModal">取消</button>
        <button v-if="state.modal.mode !== 'view'" class="dt-btn dt-btn-primary" :disabled="formLoading" @click="saveRecord">
          {{ formLoading ? '保存中…' : '保存' }}
        </button>
        <button v-if="state.modal.mode === 'view' && state.modal.name !== 'selfProfile'" class="dt-btn dt-btn-primary" @click="state.modal.mode = 'edit'">编辑</button>
        <button v-if="state.modal.mode === 'view' && state.modal.name === 'selfProfile'" class="dt-btn dt-btn-primary" @click="state.modal.mode = 'edit'">编辑</button>
        <button v-if="state.modal.mode === 'edit' && state.modal.name === 'selfProfile'" class="dt-btn dt-btn-primary" :disabled="formLoading" @click="saveSelfProfile">保存</button>
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
