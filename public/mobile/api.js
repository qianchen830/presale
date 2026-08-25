// mobile/api.js - API 调用层，统一用 window.API 对象
window.API = {
  base: '/api',

  async request(method, path, data) {
    const opts = { method, credentials: 'include' };
    if (data) {
      opts.headers = { 'Content-Type': 'application/json' };
      opts.body = JSON.stringify(data);
    }
    const r = await fetch(this.base + path, opts);
    const json = await r.json().catch(() => ({ error: '响应解析失败' }));
    if (r.status === 401) {
      // session 失效，清除前端状态，回到登录页
      window.dispatchEvent(new CustomEvent('mobile:unauthorized'));
      throw new Error('登录已失效，请重新登录');
    }
    if (!r.ok) throw new Error(json.error || `请求失败(${r.status})`);
    return json;
  },

  // ── 认证 ──
  async login(username, password) {
    return this.request('POST', '/auth/login', { username, password });
  },
  async logout() {
    return this.request('POST', '/auth/logout');
  },
  async me() {
    // /api/auth/me 返回 { loggedIn, userId, username, displayName, role, department, viewDepts }
    return this.request('GET', '/auth/me');
  },

  // ── 全量状态 ──
  async getState() { return this.request('GET', '/state'); },

  // ── 模块 CRUD（通用） ──
  create(module, record) { return this.request('POST', `/modules/${module}`, record); },
  update(module, id, record) { return this.request('PUT', `/modules/${module}/${id}`, record); },
  remove(module, id) { return this.request('DELETE', `/modules/${module}/${id}`); },

  // ── 个人指标 ──
  async getUserTargets() { return this.request('GET', '/user/targets'); },
  async putUserTargets(data) { return this.request('PUT', '/user/targets', data); },

  // ── 管理员：用户 ──
  async getUsers() { return this.request('GET', '/admin/users'); },
  async createUser(data) { return this.request('POST', '/admin/users', data); },
  async updateUser(id, data) { return this.request('PUT', `/admin/users/${id}`, data); },
  async deleteUser(id) { return this.request('DELETE', `/admin/users/${id}`); },
  async updateUserPassword(id, password) { return this.request('PUT', `/admin/users/${id}/password`, { password }); },

  // ── 个人信息 ──
  async updateMyProfile(data) { return this.request('PUT', '/users/me', data); },
  async changeMyPassword(oldPassword, newPassword) { return this.request('POST', '/auth/change-password', { oldPassword, newPassword }); },

  // ── 管理员：部门 ──
  async getDepts() { return this.request('GET', '/admin/departments'); },
  async createDept(data) { return this.request('POST', '/admin/departments', data); },
  async updateDept(id, data) { return this.request('PUT', `/admin/departments/${id}`, data); },
  async deleteDept(id) { return this.request('DELETE', `/admin/departments/${id}`); },

  // ── 管理员：员工 ──
  async getEmployees() { return this.request('GET', '/admin/employees'); },
  async createEmployee(data) { return this.request('POST', '/admin/employees', data); },
  async updateEmployee(id, data) { return this.request('PUT', `/admin/employees/${id}`, data); },
  async deleteEmployee(id) { return this.request('DELETE', `/admin/employees/${id}`); },

  // ── 看板 ──
  async getDashboardStats(year) {
    return this.request('GET', `/dashboard/stats?year=${year || new Date().getFullYear()}`);
  },
  async getDashboardAnnual() { return this.request('GET', '/dashboard/annual'); },
  async getDashboardQuarter(year) {
    return this.request('GET', `/dashboard/quarter?year=${year || new Date().getFullYear()}`);
  },
  async getDashboardCycles(year) {
    return this.request('GET', `/dashboard/cycles?year=${year || new Date().getFullYear()}`);
  },
  async getDashboardProducts(year) {
    return this.request('GET', `/dashboard/products?year=${year || new Date().getFullYear()}`);
  },

  // ── 顾问切换 ──
  async putConsultant(data) { return this.request('PUT', '/consultant', data); },
};
