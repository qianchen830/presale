const fs = require('fs');
const path = require('path');

const HTML_DIR = '/mnt/c/Users/Administrator/Desktop/售前管理';
const OUT_DIR = '/tmp/presale-states';
fs.mkdirSync(OUT_DIR, { recursive: true });

const USERS = ['刘云飞','包百花','明芳','李莹莹','王景蕾','田景洪','舒蕴佳','苏诚','谢菲菲','陈骞'];

function b64ToUint8(b64) { return new Uint8Array(Buffer.from(b64, 'base64')); }

function extractHtmlData(htmlPath) {
  const html = fs.readFileSync(htmlPath, 'utf8');
  // <!--SF_DB_START\n  -> marker without newline has length 15
  const s = html.indexOf('<!--SF_DB_START');
  const e = html.indexOf('SF_DB_END-->', s);
  if (s === -1) return null;
  // 15 = length of '<!--SF_DB_START', data starts right after it
  return html.substring(s + 15, e).trim();
}

async function main() {
  const initSqlJs = require('sql.js');
  const SQL = await initSqlJs();

  for (const name of USERS) {
    const htmlPath = path.join(HTML_DIR, '售前管理【' + name + '】.html');
    if (!fs.existsSync(htmlPath)) { console.log('MISS:', name); continue; }
    const b64 = extractHtmlData(htmlPath);
    if (!b64) { console.log('NODATA:', name); continue; }
    try {
      const db = new SQL.Database(b64ToUint8(b64));
      const r = db.exec('SELECT data FROM app_state WHERE id = 1');
      db.close();
      if (!r.length || !r[0].values.length) { console.log('EMPTY:', name); continue; }
      fs.writeFileSync(path.join(OUT_DIR, name + '.json'), r[0].values[0][0]);
      const state = JSON.parse(r[0].values[0][0]);
      console.log('OK:', name, state.applications ? state.applications.length + ' apps' : 'no apps');
    } catch(e) {
      console.log('ERROR:', name, e.message);
    }
  }
  console.log('Done. Files in', OUT_DIR);
}

main().catch(e => { console.error(e); process.exit(1); });
