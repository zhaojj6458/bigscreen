const fs = require('fs')
require('dotenv').config()
const { createClient } = require('@supabase/supabase-js')

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('缺少 SUPABASE_URL 或 SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
const bucket = 'mese-data'

async function ensureBucket() {
  const { data: buckets, error: listErr } = await supabase.storage.listBuckets()
  if (listErr) {
    console.error('listBuckets 出错', listErr.message)
    process.exit(1)
  }
  const exists = buckets.some(b => b.name === bucket)
  if (!exists) {
    const { error } = await supabase.storage.createBucket(bucket, { public: false })
    if (error) {
      console.error('createBucket 出错', error.message)
      process.exit(1)
    }
  }
}

async function upload(localPath, remotePath) {
  const buffer = fs.readFileSync(localPath)
  const { error } = await supabase.storage.from(bucket).upload(remotePath, buffer, {
    upsert: true,
    contentType: 'text/csv',
  })
  if (error) {
    console.error('上传失败', localPath, error.message)
  }
}

async function main() {
  const [overviewPath, personPath] = process.argv.slice(2)
  if (!overviewPath || !personPath) {
    console.error('用法：node scripts/upload_storage.js <概况CSV> <人员节点CSV>')
    process.exit(1)
  }
  await ensureBucket()
  const ym = new Date().toISOString().slice(0, 7)
  await upload(overviewPath, `overview/${ym}.csv`)
  await upload(personPath, `person_nodes/${ym}.csv`)
  console.log('上传完成')
}

main().catch(e => {
  console.error(e)
  process.exit(1)
})

