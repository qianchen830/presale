// mobile/api.js - API 调用层，复用所有现有 /api 接口
const API = {
  base: '/api',

  async request(method, path, data) {
    const opts = {
      method,
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include'
    };
    if (data) opts.body = JSON.stringify(data);
    const r = await fetch(this.base + path, opts);
    if (r.status === 401) { window.location.href = '/mobile.html'; return null; }
    const json = await r.json();
    if (!r.ok) throw new Error(json.error || '请求失败');
    return json;
  },

  // 认证
  async login(username, password) {
    return this.request('POST', '/auth/login', { username, password });
  },
  async logout() { return this.request('POST', '/auth/logout'); },
  async me() { return this.request('GET', '/auth/me'); },

  // 状态
  async getState() { return this.request('GET', '/state'); },
  async putState(data) { return this.request('PUT', '/state', data); },

  // 指标
  async getUserTargets() { return this.request('GET', '/user/targets'); },
  async putUserTargets(data) { return this.request('PUT', '/user/targets', data); },

  // 模块 CRUD（统一接口）
  async create(module, record) { return this.request('POST', `/modules/${module}`, record); },
  async update(module, id, record) { return this.request('PUT', `/modules/${module}/${id}`, record); },
  async remove(module, id) { return this.request('DELETE', `/modules/${module}/${id}`); },

  // 历史
  async getHistory() { return this.request('GET', '/state/history'); },
  async getHistoryId(id) { return this.request('GET', `/state/history/${id}`); },

  // 管理员
  async getUsers() { return this.request('GET', '/admin/users'); },
  async createUser(data) { return this.request('POST', '/admin/users', data); },
  async updateUser(id, data) { return this.request('PUT', `/admin/users/${id}`, data); },
  async deleteUser(id) { return this.request('DELETE', `/admin/users/${id}`); },
  async updateUserPassword(id, password) { return this.request('PUT', `/admin/users/${id}/password`, { password }); },

  // 部门
  async getDepts() { return this.request('GET', '/admin/departments'); },
  async createDept(data) { return this.request('POST', '/admin/departments', data); },
  async updateDept(id, data) { return this.request('PUT', `/admin/departments/${id}`, data); },
  async deleteDept(id) { return this.request('DELETE', `/admin/departments/${id}`); },

  // 员工
  async getEmployees() { return this.request('GET', '/admin/employees'); },
  async createEmployee(data) { return this.request('POST', '/admin/employees', data); },
  async updateEmployee(id, data) { return this.request('PUT', `/admin/employees/${id}`, data); },
  async deleteEmployee(id) { return this.request('DELETE', `/admin/employees/${id}`); },

  // 看板
  async getDashboardStats(year) { return this.request('GET', `/dashboard/stats?year=${year || new Date().getFullYear()}`); },
  async getDashboardAnnual() { return this.request('GET', '/dashboard/annual'); },
  async getDashboardQuarter(year) { return this.request('GET', `/dashboard/quarter?year=${year || new Date().getFullYear()}`); },
  async getDashboardCycles(year) { return this.request('GET', `/dashboard/cycles?year=${year || new Date().getFullYear()}`); },
  async getDashboardProducts(year) { return this.request('GET', `/dashboard/products?year=${year || new Date().getFullYear()}`); },

  // 顾问切换
  async putConsultant(data) { return this.request('PUT', '/consultant', data); },
};

window.API = API;
