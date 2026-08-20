# 售前管理 - 后端服务

Express + better-sqlite3 单文件数据库，所有数据持久化到服务器端 SQLite。

## 目录结构

```
projects/presale/
├── server.js              # 后端服务
├── migrate-from-html.js   # 从旧 HTML 内嵌 SQLite 迁移数据
├── source-original.html   # 原始 HTML（迁移源，保留备份）
├── public/                # 前端文件（Express 静态托管）
│   ├── index.html         # 改造后的前端（走 API，不再内嵌数据）
│   └── 售前管理-so_files/
│       ├── lucide.js
│       ├── xlsx.full.min.js
│       └── sql-wasm.js
├── data/
│   └── presale.db         # SQLite 数据库（自动生成）
└── package.json
```

## 启动

```bash
cd projects/presale
npm start          # 默认端口 3210
PORT=8080 npm start  # 自定义端口
```

打开浏览器访问 `http://localhost:3210`。

## API

| 方法 | 路径 | 说明 |
|------|------|------|
| GET  | /api/state | 读取整份 state |
| PUT  | /api/state | 保存整份 state（自动留历史版本） |
| GET  | /api/state/history | 历史版本列表 |
| GET  | /api/state/history/:id | 读取某一历史版本 |
| GET  | /api/health | 健康检查 |

## 数据迁移（已完成）

原始 HTML 通过 `migrate.js` 导入到 `data/presale.db`（同时合并内嵌 SQLite + DOM 里渲染的申请行）：
- 10 条申请（HTML 内嵌 SQLite 1 条 + 浏览器保存时 DOM 渲染的 9 条合并去重）
- 1 个合同、2 条分配、16 个部门、122 个员工、24 条销售十二问

> ⚠️ **关于截图里的「共 39 条」**：原 HTML 是用浏览器「另存为网页」保存的，分页只把当前页（10/页）的 9 行渲染到了 DOM；内嵌的 SQLite 是更早的快照。**剩余 29 条申请并不在这个 HTML 文件里**，它们保存在当时使用的那台电脑的浏览器 localStorage（key: `sf_presale_state_local`）中。要找回完整 39 条，需回到原电脑/原浏览器，在 Console 执行 `copy(localStorage.getItem('sf_presale_state_local'))` 把结果发过来，或在原浏览器中点「保存」按钮重新导出一份完整 HTML。

## 前端改造点

1. 页面加载：`GET /api/state` 从服务器加载数据
2. 自动保存：编辑后 600ms 防抖，`PUT /api/state` 写入服务器
3. 「保存」按钮：导出 HTML 离线备份快照（同时先同步到服务器）
4. 服务器不可达时自动降级到 localStorage 本地缓存，右上角会提示
5. 每次保存自动在 `app_state_history` 表留快照（保留最近 50 份 + 每天至少一份）
