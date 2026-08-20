// migrate-createdby.js
// 为历史数据补 createdBy 字段
// 用法: node migrate-createdby.js [--dry-run]
//
// 规则：
//   applications   → 用 applicant(人名) 匹配 employees 表的 name，得到创建人
//   salesQuestions  → 通过 oppNo 关联 applications，取其 applicant
//   judgments       → 同上
//   followUps       → 同上
//   contracts       → 用 accountMgr(人名) 匹配 employees 表的 name，得到创建人
//
// employees 表结构: { id, empNo, name, position, deptId }
// employees.name → display_name（用于 createdBy）
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const initSqlJs = require('sql.js');

const DB_PATH = path.join(__dirname, 'data', 'presale.db');
const DRY_RUN = process.argv.includes('--dry-run');

async function main() {
  const SQL = await initSqlJs();
  let buf;
  if (fs.existsSync(DB_PATH)) {
    buf = fs.readFileSync(DB_PATH);
  } else {
    console.error('数据库不存在:', DB_PATH);
    process.exit(1);
  }
  const db = new SQL.Database(buf);

  // 读取 app_state
  const r = db.exec('SELECT data FROM app_state WHERE id = 1');
  if (!r.length || !r[0].values.length) { console.error('无 app_state'); process.exit(1); }
  const state = JSON.parse(r[0].values[0][0]);

  // 建立 employees 名字 → display_name 映射（employees.name = display_name）
  const nameToCreator = new Map();
  if (state.employees) {
    state.employees.forEach(emp => {
      if (emp.name) nameToCreator.set(emp.name.trim(), emp.name.trim());
    });
  }
  console.log('员工映射条数:', nameToCreator.size);

  // 为每类数据补充 createdBy
  let appFixed = 0, salesFixed = 0, judgmentFixed = 0, followFixed = 0, contractFixed = 0;

  // ── applications ──────────────────────────────────────────────────────────
  if (state.applications) {
    state.applications.forEach(a => {
      if (!a.createdBy && a.applicant) {
        const match = nameToCreator.get(a.applicant.trim());
        if (match) { a.createdBy = match; appFixed++; }
      }
    });
    console.log(`applications: 补了 ${appFixed} 条 createdBy`);
  }

  // ── contracts ─────────────────────────────────────────────────────────────
  if (state.contracts) {
    state.contracts.forEach(c => {
      if (!c.createdBy && c.accountMgr) {
        const match = nameToCreator.get(c.accountMgr.trim());
        if (match) { c.createdBy = match; contractFixed++; }
      }
    });
    console.log(`contracts: 补了 ${contractFixed} 条 createdBy`);
  }

  // ── salesQuestions / judgments / followUps ───────────────────────────────
  // 先建 oppNo → applicant(createdBy) 映射（基于已补完的 applications）
  const oppToCreator = new Map();
  if (state.applications) {
    state.applications.forEach(a => {
      if (a.oppNo && a.createdBy) oppToCreator.set(a.oppNo, a.createdBy);
    });
  }

  if (state.salesQuestions) {
    state.salesQuestions.forEach(q => {
      if (!q.createdBy && q.oppNo) {
        const c = oppToCreator.get(q.oppNo);
        if (c) { q.createdBy = c; salesFixed++; }
      }
    });
    console.log(`salesQuestions: 补了 ${salesFixed} 条 createdBy`);
  }

  if (state.judgments) {
    state.judgments.forEach(j => {
      if (!j.createdBy && j.oppNo) {
        const c = oppToCreator.get(j.oppNo);
        if (c) { j.createdBy = c; judgmentFixed++; }
      }
    });
    console.log(`judgments: 补了 ${judgmentFixed} 条 createdBy`);
  }

  if (state.followUps) {
    state.followUps.forEach(f => {
      if (!f.createdBy && f.oppNo) {
        const c = oppToCreator.get(f.oppNo);
        if (c) { f.createdBy = c; followFixed++; }
      }
    });
    console.log(`followUps: 补了 ${followFixed} 条 createdBy`);
  }

  const totalFixed = appFixed + contractFixed + salesFixed + judgmentFixed + followFixed;
  console.log(`\n共补了 ${totalFixed} 条 createdBy`);

  if (DRY_RUN) {
    console.log('\n[dry-run] 未写入数据库，退出');
    process.exit(0);
  }

  // 写回数据库
  const newDataStr = JSON.stringify(state);
  const now = new Date().toISOString();
  // 备份当前版本到历史
  const cur = db.exec('SELECT data, updated_at FROM app_state WHERE id=1');
  if (cur.length && cur[0].values.length) {
    db.run('INSERT INTO app_state_history (data, created_at) VALUES (?, ?)', [cur[0].values[0][0], cur[0].values[0][1]]);
  }
  db.run("UPDATE app_state SET data = ?, updated_at = ? WHERE id = 1", [newDataStr, now]);

  // 保存
  const out = fs.createWriteStream(DB_PATH);
  out.write(Buffer.from(db.export()));
  out.end();
  await new Promise(res => out.on('finish', res));

  // 验证
  const SQL2 = await initSqlJs();
  const buf2 = fs.readFileSync(DB_PATH);
  const db2 = new SQL2.Database(buf2);
  const r2 = db2.exec('SELECT data FROM app_state WHERE id=1');
  const s2 = JSON.parse(r2[0].values[0][0]);
  const appsWithCb = (s2.applications || []).filter(a => a.createdBy).length;
  const conWithCb = (s2.contracts || []).filter(c => c.createdBy).length;
  const sqWithCb = (s2.salesQuestions || []).filter(q => q.createdBy).length;
  const jdWithCb = (s2.judgments || []).filter(j => j.createdBy).length;
  const fuWithCb = (s2.followUps || []).filter(f => f.createdBy).length;
  console.log('\n✅ 验证 — 有 createdBy 的记录:');
  console.log(`  applications: ${appsWithCb}/${s2.applications.length}`);
  console.log(`  contracts:   ${conWithCb}/${s2.contracts.length}`);
  console.log(`  salesQ:     ${sqWithCb}/${s2.salesQuestions.length}`);
  console.log(`  judgments:   ${jdWithCb}/${s2.judgments.length}`);
  console.log(`  followUps:   ${fuWithCb}/${s2.followUps.length}`);
}

main().catch(e => { console.error(e); process.exit(1); });
