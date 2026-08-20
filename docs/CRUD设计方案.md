# 售前管理系统 - 数据操作方案

## 一、现状分析

### 现有数据流
```
前端修改 → PUT /api/state (整体状态) → saveState() 合并到 app_state
```

**现有接口**：
- `GET /api/state` — 获取当前用户的过滤后数据（按 consultant 过滤）
- `PUT /api/state` — 整体保存状态（用于批量更新）

**现有 saveState 合并逻辑**：
```javascript
// 按 id 去重合并，新数据覆盖旧数据
mergeById(existingArr, incomingArr) {
  const map = new Map();
  (existingArr||[]).forEach(x => { if (x && x.id) map.set(x.id, x); });
  (incomingArr||[]).forEach(x => { if (x && x.id) map.set(x.id, x); });
  return [...map.values()];
}
```

---

## 二、问题

当前系统缺少精细化的 CRUD 接口，所有数据通过整体 PUT 提交，存在以下问题：

| 问题 | 说明 |
|------|------|
| 无法单条操作 | 改一条记录要提交全部数据，效率低 |
| 并发覆盖风险 | 多人同时编辑，后保存的会覆盖先保存的 |
| 无删除功能 | 只能软删除（改 consultant=deleted），无法真删 |
| 无权限隔离 | 无法控制谁可以修改哪条记录 |

---

## 三、设计方案

### 3.1 API 规范

所有接口统一前缀 `/api/modules`，需要登录认证。

#### 通用响应格式
```json
// 成功
{ "ok": true, "data": {...} }
// 失败
{ "error": "错误描述" }
```

#### 通用规则
- **查询**：GET，返回过滤后数据（非 admin 用户只看本人数据）
- **新增**：POST，自动追加到数组（前端生成 id，后端可覆盖）
- **修改**：PUT，完整替换指定 id 记录
- **删除**：DELETE，软删除（标记 deleted）或硬删除

---

### 3.2 各模块接口设计

#### 售前申请（applications）
```
GET    /api/modules/applications           列表（已废弃，用 /api/state）
GET    /api/modules/applications/:id       单条
POST   /api/modules/applications           新增  { ...record }
PUT    /api/modules/applications/:id       修改  { ...record }
DELETE /api/modules/applications/:id       删除（本人或 admin）
```

#### 合同签订（contracts）
```
GET    /api/modules/contracts/:id
POST   /api/modules/contracts
PUT    /api/modules/contracts/:id
DELETE /api/modules/contracts/:id
```

#### 顾问判断（judgments）
```
GET    /api/modules/judgments/:id
POST   /api/modules/judgments
PUT    /api/modules/judgments/:id
DELETE /api/modules/judgments/:id
```

#### 销售十二条（salesQuestions）
```
GET    /api/modules/sales-questions           列表（?oppNo=xxx 筛选）
GET    /api/modules/sales-questions/:id
POST   /api/modules/sales-questions
PUT    /api/modules/sales-questions/:id
DELETE /api/modules/sales-questions/:id
```

#### 项目跟进（followUps）
```
GET    /api/modules/follow-ups              列表（?oppNo=xxx 筛选）
GET    /api/modules/follow-ups/:id
POST   /api/modules/follow-ups
PUT    /api/modules/follow-ups/:id
DELETE /api/modules/follow-ups/:id
```

#### 业绩划分（allocations）
```
GET    /api/modules/allocations            列表（?oppNo=xxx 筛选）
GET    /api/modules/allocations/:id
POST   /api/modules/allocations
PUT    /api/modules/allocations/:id
DELETE /api/modules/allocations/:id
```

---

### 3.3 权限规则

| 操作 | 普通用户 | 管理员 |
|------|---------|--------|
| 新增 | ✅ 仅本人数据 | ✅ 任意数据 |
| 查看 | ✅ 仅本人数据 | ✅ 全部数据 |
| 修改 | ✅ 仅本人数据 | ✅ 任意数据 |
| 删除 | ❌ 不允许 | ✅ 任意数据 |

> **consultant 字段判断所有权**：`record.consultant === 当前用户` 为本人数据

---

### 3.4 删除策略：逻辑删除

**不物理删除**，在记录上加 `deleted: true` 标记：

```javascript
// 删除时
db.run("UPDATE ... SET deleted = 1, updatedAt = ? WHERE id = ?", [now, id])

// 查询时自动过滤
const records = (state.xxx || []).filter(r => !r.deleted)
```

---

### 3.5 并发安全：乐观锁

每条记录加 `updatedAt` 时间戳，修改时检查：

```javascript
// 修改时传入 expectedUpdatedAt
PUT /api/modules/applications/:id
Body: { record: {...}, expectedUpdatedAt: "2026-08-20T02:00:00.000Z" }

// 后端检查
if (existing.updatedAt !== expectedUpdatedAt) {
  return res.status(409).json({ error: '数据已被他人修改，请刷新后重试' })
}
```

---

### 3.6 数据修改后端实现

```javascript
// 统一保存逻辑（复用现有 mergeById 机制）
function upsertRecord(key, record, isDelete) {
  const state = getState().state;
  const arr = state[key] || [];
  if (isDelete) {
    // 逻辑删除
    const idx = arr.findIndex(r => r.id === record.id);
    if (idx >= 0) { arr[idx] = { ...arr[idx], deleted: true }; }
  } else {
    // 按 id 覆盖或追加
    const idx = arr.findIndex(r => r.id === record.id);
    if (idx >= 0) { arr[idx] = record; }
    else { arr.push(record); }
  }
  state[key] = arr;
  saveState(state); // 复用合并写入
}
```

---

### 3.7 前端操作模式

#### 方式 A：即时保存（单条操作）
```
点击编辑 → 修改字段 → 点击保存 → POST/PUT → 自动合并到全局
```
适用：顾问判断、销售十二条、项目跟进

#### 方式 B：草稿 + 确认提交
```
点击新增 → 草稿保存在本地 → 确认后 → POST → 合并到全局
```
适用：售前申请（字段多，表单复杂）

#### 方式 C：批量操作（继续用现有 PUT）
```
多个模块一起改 → 整体 PUT /api/state → 合并写入
```
适用：年度指标、季度指标等全局配置

---

### 3.8 前端页面改造

| 页面 | 改造内容 |
|------|---------|
| 售前申请 | 增加新增按钮 → 弹窗表单 → POST；行内编辑 → PUT；行末删除按钮 |
| 合同签订 | 同上 |
| 顾问判断 | 行内编辑，实时保存 |
| 销售十二条 | 行内编辑，实时保存；按 oppNo 分组显示 |
| 项目跟进 | 同上 |
| 业绩划分 | 同上 |

---

## 四、实施计划

### 第一阶段：后端基础（2小时）
- [ ] 实现统一 CRUD 路由
- [ ] 实现 upsertRecord + 逻辑删除
- [ ] 实现乐观锁校验
- [ ] 实现权限检查（consultant 过滤）

### 第二阶段：各模块前端（3小时）
- [ ] 售前申请：新增/编辑/删除
- [ ] 合同签订：新增/编辑/删除
- [ ] 顾问判断：行内编辑
- [ ] 销售十二条：行内编辑
- [ ] 项目跟进：行内编辑
- [ ] 业绩划分：新增/编辑/删除

### 第三阶段：完善
- [ ] 并发冲突提示
- [ ] 操作日志（app_state_history 已支持）
- [ ] 软删除恢复功能

---

## 五、数据完整性保证

1. **新增时**：前端生成 UUID 或时间戳 id，保证唯一性
2. **修改时**：自动补 `updatedAt`、`updatedBy` 字段
3. **删除时**：逻辑删除，不物理移除
4. **保存时**：通过 `saveState` 合并写入，不覆盖其他顾问数据
