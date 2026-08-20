/**
 * 从历史 HTML 文件导入售前申请数据
 * 每个文件格式：售前管理【顾问名】.html
 * consultant = 文件名中的顾问名（而非申请人字段）
 */
const fs = require('fs');
const path = require('path');

const HTML_DIR = '/mnt/c/Users/Administrator/Desktop/售前管理';
const DB_PATH = '/home/openclaw/.openclaw/workspace/webdev-projects/presale/data/presale.db';

function extractConsultant(filename) {
  const m = filename.match(/【(.+?)】/);
  return m ? m[1] : null;
}

function extractEmbeddedState(html) {
  const startMarker = '<!--SF_DB_START\n';
  const endMarker = '\nSF_DB_END-->';
  const si = html.indexOf(startMarker);
  const ei = html.indexOf(endMarker);
  if (si < 0 || ei < 0) return null;
  const b64 = html.slice(si + startMarker.length, ei).trim();
  if (!b64 || b64.length < 100) return null;
  const buf = Buffer.from(b64, 'base64');
  return buf;
}

async function main() {
  const initSqlJs = require('sql.js');
  const SQL = await initSqlJs();

  const files = fs.readdirSync(HTML_DIR).filter(f => f.endsWith('.html'));
  console.log(`找到 ${files.length} 个历史文件\n`);

  const allApps = []; // [{consultant, app}]

  for (const file of files) {
    const consultant = extractConsultant(file);
    if (!consultant) { console.log(`跳过: ${file}`); continue; }

    const html = fs.readFileSync(path.join(HTML_DIR, file), 'utf8');
    const buf = extractEmbeddedState(html);
    if (!buf) { console.log(`[${consultant}] 无嵌入式数据，跳过`); continue; }

    try {
      const db = new SQL.Database(buf);
      const result = db.exec("SELECT data FROM app_state WHERE id = 1");
      db.close();
      if (!result.length || !result[0].values.length) {
        console.log(`[${consultant}] app_state 为空，跳过`);
        continue;
      }
      const jsonStr = result[0].values[0][0];
      const state = JSON.parse(jsonStr);
      const apps = state.applications || [];
      if (!apps.length) {
        console.log(`[${consultant}] 无申请记录`);
        continue;
      }
      console.log(`[${consultant}] ${apps.length} 条申请记录`);
      apps.forEach(app => allApps.push({ consultant, app }));
    } catch (e) {
      console.log(`[${consultant}] 解析失败: ${e.message}`);
    }
  }

  console.log(`\n共提取 ${allApps.length} 条申请记录\n`);
  if (!allApps.length) return;

  // 打开目标数据库
  const dbData = fs.readFileSync(DB_PATH);
  const db = new SQL.Database(dbData);

  // 确保 consultant 列存在
  const tableInfo = db.exec("PRAGMA table_info(applications)");
  const cols = tableInfo.length ? tableInfo[0].values.map(r => r[1]) : [];
  if (!cols.includes('consultant')) {
    db.run('ALTER TABLE applications ADD COLUMN consultant TEXT');
    console.log('已添加 consultant 列');
  } else {
    console.log('consultant 列已存在');
  }

  let imported = 0, updated = 0, skipped = 0;

  for (const { consultant, app } of allApps) {
    const appId = app.id || app.oppNo;
    if (!appId) continue;

    // 查是否已存在
    const exist = db.exec(`SELECT id, consultant FROM applications WHERE id = '${appId.replace(/'/g, "''")}' OR oppNo = '${(app.oppNo || '').replace(/'/g, "''")}'`);
    if (exist.length && exist[0].values.length > 0) {
      const [eid, econsultant] = exist[0].values[0];
      if (econsultant && econsultant.trim()) {
        skipped++;
        continue; // 已有顾问，跳过
      }
      db.run(`UPDATE applications SET consultant = '${consultant.replace(/'/g, "''")}' WHERE id = '${eid.replace(/'/g, "''")}'`);
      updated++;
    } else {
      // INSERT
      const fields = ['id','applicant','department','customer','oppNo','projectName','product','buyMode','currentStage','status','applyDate','expectedSignDate','expectedSignAmount','signAmount','signDate','coreRequirement'];
      const present = fields.filter(f => app[f] !== undefined && app[f] !== null);
      const colPart = [...present, 'consultant'].join(',');
      const valPart = [
        ...present.map(f => {
          const v = app[f];
          if (v === undefined || v === null) return 'NULL';
          if (typeof v === 'number') return v;
          return `'${String(v).replace(/'/g, "''")}'`;
        }),
        `'${consultant.replace(/'/g, "''")}'`
      ].join(',');
      try {
        db.run(`INSERT INTO applications (${colPart}) VALUES (${valPart})`);
        imported++;
      } catch (e) {
        // 重复主键等
      }
    }
  }

  console.log(`\n导入结果：新增 ${imported} 条，更新 ${updated} 条，跳过 ${skipped} 条`);
  const out = db.export();
  fs.writeFileSync(DB_PATH, Buffer.from(out));
  db.close();
  console.log(`已保存到 ${DB_PATH}`);
}

main().catch(e => { console.error(e); process.exit(1); });
