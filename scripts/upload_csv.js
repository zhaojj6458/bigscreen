// 依赖：@supabase/supabase-js、csv-parse
require('dotenv').config();
// 使用：先设置环境变量 SUPABASE_URL、SUPABASE_SERVICE_ROLE_KEY
// node scripts/upload_csv.js "c:/Users/HP/Desktop/TR数据大屏3/MESE三包概况.csv" "c:/Users/HP/Desktop/TR数据大屏3/MESE三包日志人员节点1229.utf8.csv"
const fs = require('fs');
const { createClient } = require('@supabase/supabase-js');
const { parse } = require('csv-parse');

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('请设置 SUPABASE_URL 与 SUPABASE_SERVICE_ROLE_KEY 环境变量');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

function readCsv(filePath, options = {}) {
  return new Promise((resolve, reject) => {
    const records = [];
    fs.createReadStream(filePath)
      .pipe(parse({
        columns: true,
        skip_empty_lines: true,
        trim: true,
        bom: true,
        ...options,
      }))
      .on('data', (row) => records.push(row))
      .on('end', () => resolve(records))
      .on('error', reject);
  });
}

function toDateTime(s) {
  if (!s) return null;
  // 兼容 "2025/11/20 16:00" 或 "2025/7/16 9:27:22"
  const ds = s.replace(/\//g, '-'); // 简化解析
  const d = new Date(ds);
  return isNaN(d.getTime()) ? null : d.toISOString();
}

async function upsertOverview(rows) {
  for (const row of rows) {
    const payload = {
      serial_number: row.serial_number,
      department: row.department,
      customer_name: row.customer_name,
      installation_stage: row.installation_stage,
      material_name: row.material_name,
      drawing_number: row.drawing_number || null,
      warranty_count: row.warranty_count ? Number(row.warranty_count) : 0,
      warranty_type: row.warranty_type,
      fault_description: row.fault_description,
      // 可按需要设置 source_month（例如取文件名里的月份或当前月份）
      // source_month: new Date().toISOString().slice(0, 10)
    };
    const { error } = await supabase
      .from('mese_overview')
      .upsert(payload, { onConflict: 'serial_number' });
    if (error) {
      console.error('overview upsert error', row.serial_number, error.message);
    }
  }
  console.log(`概况表 upsert 完成：${rows.length} 条`);
}

async function upsertPersonNodes(rows) {
  for (const row of rows) {
    const payload = {
      serial_number: row['三包流水号'],
      start_time: toDateTime(row['处理开始时间']),
      end_time: toDateTime(row['处理结束时间']),
      node: row['流程节点'],
      person_name: row['处理人姓名'],
    };
    const { error } = await supabase
      .from('mese_person_node')
      .upsert(payload, {
        onConflict: 'serial_number,start_time,end_time,node,person_name',
      });
    if (error) {
      console.error('person_node upsert error', payload.serial_number, error.message);
    }
  }
  console.log(`人员节点 upsert 完成：${rows.length} 条`);
}

async function main() {
  const [overviewPath, personNodePath] = process.argv.slice(2);
  if (!overviewPath || !personNodePath) {
    console.error('用法：node scripts/upload_csv.js <概况CSV> <人员节点CSV>');
    process.exit(1);
  }
  const overviewRows = await readCsv(overviewPath, { relax_quotes: true });
  const personRows = await readCsv(personNodePath, { relax_quotes: true, delimiter: '\t' });

  await upsertOverview(overviewRows);
  await upsertPersonNodes(personRows);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

