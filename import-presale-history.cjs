/**
 * 从历史 HTML 文件导入售前申请数据
 * 每个文件格式：售前管理【顾问名】.html
 * consultant = 文件名中的顾问名
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const HTML_DIR = '/mnt/c/Users/Administrator/Desktop/售前管理';
const DB_PATH = '/home/openclaw/.openclaw/workspace/webdev-projects/presale/data/presale.db';

function extractConsultant(filename) {
  const m = filename.match(/【(.+?)】/);
  return m ? m[1] : null;
}

function findEmbeddedData(html) {
  const markerStart = '<!-- ===================== 嵌入式 SQLite 数据库存储';
  const startIdx = html.indexOf(markerStart);
  if (startIdx < 0) return null;
  const dataStart = html.indexOf('-->', startIdx);
  if (dataStart < 0) return null;
  const endMarker = '/* END Embedded */';
  const endIdx = html.indexOf(endMarker, dataStart);
  if (endIdx < 0) return null;
  const b64 = html.slice(dataStart + 3, endIdx).trim();
  if (!b64 || b64.length < 100) return null;
  return b64;
}

// 用纯 Node.js 解码 base64 → Buffer（不依赖外部库）
function b64ToBuffer(b64) {
  const str = Buffer.from(b64, 'base64').toString('binary');
  const buf = Buffer.alloc(str.length);
  for (let i = 0; i < str.length; i++) buf[i] = str.charCodeAt(i) & 0xff;
  return buf;
}

async function main() {
  // 检查 sql.js
  let SQL;
  try {
    const initSqlJs = require('sql.js');
    SQL = await initSqlJs();
  } catch (e) {
    console.error('请先安装 sql.js: npm install sql.js');
    process.exit(1);
  }

  const files = fs.readdirSync(HTML_DIR).filter(f => f.endsWith('.html'));
  console.log(`找到 ${files.length} 个历史文件\n`);

  const allApps = []; // {consultant, apps[]}

  for (const file of files) {
    const consultant = extractConsultant(file);
    if (!consultant) { console.log(`跳过: ${file}（无法提取顾问名）`); continue; }

    const filePath = path.join(HTML_DIR, file);
    const html = fs.readFileSync(filePath, 'utf8');
    const b64 = findEmbeddedData(html);

    if (!b64) {
      console.log(`[${consultant}] 无嵌入式数据，跳过`);
      continue;
    }

    try {
      const buf = b64ToBuffer(b64);
      const db = new SQL.Database(buf);

      // 查 applications
      const result = db.exec('SELECT * FROM applications');
      if (!result.length || !result[0].values.length) {
        console.log(`[${consultant}] 无申请记录`);
        db.close();
        continue;
      }

      const cols = result[0].columns;
      const rows = result[0].values;
      console.log(`[${consultant}] 找到 ${rows.length} 条申请记录`);

      rows.forEach(row => {
        const app = {};
        cols.forEach((col, i) => app[col] = row[i]);
        app._consultant_from_file = consultant; // 标记来源
        allApps.push(app);
      });

      db.close();
    } catch (e) {
      console.log(`[${consultant}] 解析失败: ${e.message}`);
    }
  }

  console.log(`\n共提取 ${allApps.length} 条申请记录`);

  if (!allApps.length) {
    console.log('没有找到数据，退出');
    return;
  }

  // 读取现有数据库
  const dbData = fs.readFileSync(DB_PATH);
  const db = new SQL.Database(dbData);

  // 检查 consultant 列是否存在
  const tableInfo = db.exec("PRAGMA table_info(applications)");
  const cols = tableInfo.length ? tableInfo[0].values.map(r => r[1]) : [];
  const hasConsultantCol = cols.includes('consultant');

  if (!hasConsultantCol) {
    db.run('ALTER TABLE applications ADD COLUMN consultant TEXT');
    console.log('已添加 consultant 列');
  } else {
    console.log('consultant 列已存在');
  }

  // 按 oppNo 去重：以 filename 中的顾问名为准（不覆盖已有 consultant 的记录）
  let imported = 0, skipped = 0, updated = 0;

  for (const app of allApps) {
    const oppNo = app.oppNo || app.id;

    // 检查是否已存在
    const existing = db.exec(`SELECT id, consultant FROM applications WHERE id = '${app.id}' OR oppNo = '${oppNo}'`);
    if (existing.length && existing[0].values.length > 0) {
      const [eid, econsultant] = existing[0].values[0];
      if (econsultant && econsultant.trim()) {
        // 已有顾问，跳过
        skipped++;
        continue;
      } else {
        // 有记录但无顾问，更新
        db.run(`UPDATE applications SET consultant = '${app._consultant_from_file.replace(/'/g, "''")}' WHERE id = '${eid}'`);
        updated++;
      }
    } else {
      // 新增
      const fields = ['id','applicant','department','customer','oppNo','projectName','product','buyMode','currentStage','status','applyDate','expectedSignDate','expectedSignAmount','signAmount','consultant','coreRequirement'];
      const present = fields.filter(f => app[f] !== undefined && app[f] !== null);
      const vals = present.map(f => {
        const v = app[f];
        if (v === undefined || v === null) return 'NULL';
        if (typeof v === 'number') return v;
        return `'${String(v).replace(/'/g, "''")}'`;
      });
      const consVal = `'${app._consultant_from_file.replace(/'/g, "''")}'`;
      const flds = [...present, 'consultant'].filter((v, i, a) => a.indexOf(v) === i);
      const vls = [...present.map(f => {
        const v = app[f];
        if (v === undefined || v === null) return 'NULL';
        if (typeof v === 'number') return v;
        return `'${String(v).replace(/'/g, "''")}'`;
      }), consVal];

      try {
        db.run(`INSERT INTO applications (${flds.join(',')}) VALUES (${vls.join(',')})`);
        imported++;
      } catch (e) {
        // 忽略重复主键等错误
        console.log(`  插入失败 ${app.id}: ${e.message}`);
      }
    }
  }

  console.log(`\n导入结果：新增 ${imported} 条，更新 ${updated} 条，跳过 ${skipped} 条（已有顾问）`);

  // 保存
  const data = db.export();
  const buf = Buffer.from(data);
  fs.writeFileSync(DB_PATH, buf);
  db.close();
  console.log(`\n已保存到 ${DB_PATH}`);
}

main().catch(e => { console.error(e); process.exit(1); });
