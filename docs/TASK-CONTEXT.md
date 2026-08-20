# 当前任务锚点

**Git锚点**: `6d0fcc9` fix: users.html _currentUser.id 未定义导致重置密码按钮不显示

**目的**: 给售前管理系统的各模块（售前申请、合同签订、顾问判断、销售十二条、项目跟进、业绩划分）添加单条 CRUD 接口，实现实时保存 + 右上角显示保存时间，不破坏现有逻辑。

---

## 锚点版本 server.js 关键结构

- 所有状态存在 `app_state` 表的 `data` 字段（单个 JSON）
- `saveState(newState)`: 增量合并写入（按 id 去重）
- `filterStateByUser(state, user)`: admin看全部，普通用户按 consultant/department 过滤
- GET /api/state: 返回过滤后数据
- PUT /api/state: 整体保存 + 合并写入
- **无单条 CRUD 路由**

## 锚点版本 public/index.html 关键结构

- 所有模块数据存在 `state` 全局变量
- 每个模块有对应的 filter + render 函数
- 保存统一走 `saveState()` → PUT /api/state
- **无实时保存、无保存时间显示**

## 要做的事

### 后端：新增路由（共6组）

```
POST   /api/modules/:module           新增单条
PUT    /api/modules/:module/:id       修改单条
DELETE /api/modules/:module/:id       删除单条（软删 deleted: true）
```

**支持的 module**：`applications` `contracts` `judgments` `salesQuestions` `followUps` `allocations`

**权限**：普通用户只能操作 consultant === 自己姓名 的记录

**返回**：`{ ok: true, updatedAt: "..." }`

### 前端：改造 index.html

- 在右上角当前用户信息处显示保存状态和保存时间
- 各模块编辑后立即 POST/PUT，不走整体 PUT /api/state
- 保存成功后更新右上角时间显示

## 不允许破坏的现有功能

1. GET /api/state 正常返回过滤后数据
2. PUT /api/state 整体保存继续有效
3. filterStateByUser 过滤逻辑不变
4. 各模块渲染逻辑不变（只改保存方式）

## 提交记录

每次完成一个模块的 CRUD + 实时保存后单独 commit，message 格式：
`feat(module): 添加 :module 实时CRUD + 右上角保存时间`
