import { useState } from 'react'
import { supabase } from '../supabaseClient'
import Papa from 'papaparse'
import { Upload as UploadIcon, FileUp, CheckCircle, AlertCircle, Loader2, Trash2, CalendarClock, FileSpreadsheet } from 'lucide-react'
import '../App.css'

function UploadPage() {
  const [logs, setLogs] = useState([])
  const [loading, setLoading] = useState(false)

  const addLog = (msg, type = 'info') => {
    setLogs(prev => [...prev, { msg, type, time: new Date().toLocaleTimeString() }])
  }

  const toDateTime = (s) => {
    if (!s) return null
    // 兼容 "2025/11/20 16:00" 或 "2025/7/16 9:27:22"
    const ds = s.replace(/\//g, '-')
    const d = new Date(ds)
    return isNaN(d.getTime()) ? null : d.toISOString()
  }

  // 辅助函数：支持多列名匹配 (兼容中英文表头)
  const getCellValue = (row, keys) => {
    for (const key of keys) {
      if (row[key] !== undefined && row[key] !== null && row[key] !== '') {
        return row[key]
      }
      // 尝试去空格匹配
      const trimmedKey = Object.keys(row).find(k => k.trim() === key)
      if (trimmedKey && row[trimmedKey]) return row[trimmedKey]
    }
    return null
  }

  // 新增：手动选择的月份
  const [selectedMonth, setSelectedMonth] = useState('')

  const handleFileUpload = async (event, type) => {
    const file = event.target.files[0]
    if (!file) return

    // 如果是周期统计，强制要求选择月份
    if (type === 'cycle_stats' && !selectedMonth) {
      // 尝试从文件名自动推断，作为默认值
      const match = file.name.match(/(\d{2})年(\d{1,2})月/)
      if (match) {
        const autoMonth = `20${match[1]}-${match[2].padStart(2, '0')}`
        if (!confirm(`从文件名推断月份为 "${autoMonth}"，是否确认？\n\n点击“确定”使用该月份。\n点击“取消”请先手动在上方选择月份。`)) {
          return
        }
        // 如果用户确认了自动推断的月份，继续执行
        // 注意：这里需要将推断的月份传递给 upsertCycleStats，或者更新 state
        // 由于 setState 是异步的，我们直接传参更稳妥
        await processFile(file, type, autoMonth)
        return
      } else {
        alert('请先在上传框上方选择该文件所属的统计月份！')
        return
      }
    }

    await processFile(file, type, selectedMonth)
  }

  const processFile = async (file, type, monthOverride) => {
    setLoading(true)
    addLog(`开始处理文件: ${file.name} (${type})`, 'info')

    try {
      // 1. Upload to Storage (Non-blocking)
      try {
        await uploadToStorage(file, type)
      } catch (storageErr) {
        addLog(`[警告] 原始文件归档失败: ${storageErr.message} (不影响数据入库)`, 'warning')
      }

      // 2. Parse and Upload to DB
      Papa.parse(file, {
        header: true,
        skipEmptyLines: true,
        complete: async (results) => {
          try {
            // Debug: 打印第一行数据的键名
            if (results.data && results.data.length > 0) {
              const firstRowKeys = Object.keys(results.data[0])
              const validKeys = firstRowKeys.filter(k => k.trim() !== '') 
              addLog(`[调试] CSV表头识别: ${validKeys.join(', ')}`, 'info')
              const hasWeirdChars = validKeys.some(k => /�/.test(k))
              if (hasWeirdChars) addLog('[警告] 检测到表头疑似乱码，请另存为 UTF-8 再上传。', 'warning')
            }

            if (type === 'overview') {
              await upsertOverview(results.data)
            } else if (type === 'person_node') {
              await upsertPersonNodes(results.data)
            } else if (type === 'cycle_stats') {
              await upsertCycleStats(results.data, file.name, monthOverride)
            } else if (type === 'ledger') {
              await upsertLedgerAnnual(results.data, file.name)
            }
            addLog(`${file.name} 处理完成！`, 'success')
          } catch (err) {
            addLog(`数据入库失败: ${err.message}`, 'error')
            if (err.message.includes('ON CONFLICT')) {
              addLog('提示: 数据库约束不匹配。请在 Supabase SQL Editor 中执行 fix_schema_final.sql 以修复表结构。', 'error')
            }
          } finally {
            setLoading(false)
          }
        },
        error: (err) => {
          addLog(`CSV 解析失败: ${err.message}`, 'error')
          setLoading(false)
        }
      })
    } catch (err) {
      addLog(`文件上传失败: ${err.message}`, 'error')
      setLoading(false)
    }
  }

  const uploadToStorage = async (file, type) => {
    const folderMap = {
      'overview': 'overview',
      'person_node': 'person_nodes',
      'cycle_stats': 'cycle_stats',
      'ledger': 'ledger'
    }
    const folder = folderMap[type] || 'misc'
    
    const ym = new Date().toISOString().slice(0, 7)
    // Fix: Clean filename to avoid Invalid key errors with non-ASCII chars
    // Using timestamp + sanitized name
    const safeName = file.name.replace(/[^a-zA-Z0-9.-]/g, '_')
    const path = `${folder}/${ym}/${Date.now()}_${safeName}`
    
    addLog(`正在上传原始文件到存储桶: ${path}...`)
    
    const { error } = await supabase.storage
      .from('mese-data')
      .upload(path, file, { upsert: true })

    if (error) {
      if (error.message.includes('bucket not found')) {
         addLog('存储桶 mese-data 不存在，请联系管理员创建', 'error')
      }
      throw error
    }
    addLog('原始文件归档成功', 'success')
  }

  const upsertCycleStats = async (rawRows, filename, monthOverride) => {
    // 优先使用传入的月份，否则尝试从文件名解析，最后默认当前月份
    let statMonth = monthOverride
    
    if (!statMonth) {
      const match = filename.match(/(\d{2})年(\d{1,2})月/)
      if (match) {
        statMonth = `20${match[1]}-${match[2].padStart(2, '0')}`
      } else {
        statMonth = new Date().toISOString().slice(0, 7)
      }
    }

    const uniqueMap = new Map()

    rawRows.forEach(row => {
      const serial = getCellValue(row, ['三包流水号', 'serial_number'])
      if (!serial) return

      // 解析最后一列 "基板/非基板" (通常在客户名称后面)
      // 由于 PapaParse header:true，我们需要根据 key 查找，或者通过 Object.values 获取最后一列
      // 这里假设 CSV 最后一列是基板类型，如果 key 是空的或者是 'Column 10' 之类
      // 简单处理：尝试查找包含 '基板' 字样的值
      let materialType = ''
      Object.values(row).forEach(val => {
        if (typeof val === 'string' && (val.includes('基板') || val.includes('非基板'))) {
          materialType = val
        }
      })

      // 修复：发运时间在 CSV 中可能是日期字符串 "2025/11/20 16:00"
      // 但这里我们需要的是"制造发运周期" (数值)，如果 CSV 列名是 "制造发运周期" 或 "总部制造发运时间"
      // 检查 CSV 表头发现：
      // 第2列: 总部制造发运时间 (数值 2.12)
      // 第3列: 总部审核处置时间 (数值 0.12)
      // 第7列: 发运时间 (日期 2025/11/20) -> 这个不是周期
      
      // 因此 ship_time 应该对应 "制造发运周期" 或 "总部制造发运时间"
      // 如果数据库字段定义 ship_time 是 numeric，那它应该存数值
      
      const cleanRow = {
        serial_number: serial,
        hq_dispatch_time: parseFloat(getCellValue(row, ['总部制造发运时间']) || 0), // 对应周期
        hq_audit_time: parseFloat(getCellValue(row, ['总部审核处置时间']) || 0),
        branch_submit_time: parseFloat(getCellValue(row, ['分公司审核提交时间']) || 0),
        supp_invest_time: parseFloat(getCellValue(row, ['补充调查时间']) || 0),
        branch_invest_time: parseFloat(getCellValue(row, ['分公司现场调查时间']) || 0),
        
        // 修正：ship_time 在数据库中似乎被用作 "制造发运周期" (数值)
        // 但 CSV 中有一列叫 "发运时间" (日期)
        // 如果我们要存周期，应该复用 hq_dispatch_time 或者确认是否有单独的列
        // 在 debug_trend_data 中，ship_time 被用作 "制造发运周期"
        // 因此这里应该取 "总部制造发运时间" (如果是同一列) 或者 0
        // 暂时映射为 hq_dispatch_time (因为通常制造发运周期就是指这个)
        ship_time: parseFloat(getCellValue(row, ['总部制造发运时间']) || 0), 
        
        total_cycle_time: parseFloat(getCellValue(row, ['全周期统计时间']) || 0),
        department: getCellValue(row, ['提出部门']) || '',
        customer_name: getCellValue(row, ['客户名称']) || '',
        material_type: materialType,
        stat_month: statMonth
      }
      
      // 唯一键：流水号 + 统计月份
      uniqueMap.set(`${serial}|${statMonth}`, cleanRow)
    })

    const rows = Array.from(uniqueMap.values())
    addLog(`正在同步 ${rows.length} 条周期统计数据 (月份: ${statMonth})...`)
    
    const batchSize = 100
    for (let i = 0; i < rows.length; i += batchSize) {
      const batch = rows.slice(i, i + batchSize)
      const { error } = await supabase
        .from('mese_cycle_stats')
        .upsert(batch, { onConflict: 'serial_number, stat_month' })

      if (error) throw error
      addLog(`进度: ${Math.min(i + batchSize, rows.length)}/${rows.length}`)
    }
  }

  const upsertOverview = async (rawRows) => {
    // 1. 前端去重与清洗：基于 (serial_number + material_name + drawing_number)
    // 后出现的记录覆盖先出现的
    const uniqueMap = new Map()
    
    rawRows.forEach(row => {
      // 兼容多列名
      const serial = getCellValue(row, ['serial_number', '三包流水号', '流水号'])
      if (!serial) return

      // 提取年份逻辑：从流水号中提取第一个两位数字 (如 MBY25 -> 25 -> 2025)
      let reportYear = 2025
      const yearMatch = serial.match(/(\d{2})/)
      if (yearMatch) {
        reportYear = 2000 + parseInt(yearMatch[1], 10)
      }

      const cleanRow = {
        serial_number: serial,
        report_year: reportYear,
        department: getCellValue(row, ['department', '分公司', '部门']) || '',
        customer_name: getCellValue(row, ['customer_name', '客户名称', '项目名称', '项目']),
        installation_stage: getCellValue(row, ['installation_stage', '安装阶段']),
        material_name: getCellValue(row, ['material_name', '物料名称', '物料描述']) || '',
        drawing_number: getCellValue(row, ['drawing_number', '图号']) || '',
        warranty_count: Number(getCellValue(row, ['warranty_count', '数量', '三包数量']) || 0),
        warranty_type: getCellValue(row, ['warranty_type', '三包类型']) || '',
        fault_description: getCellValue(row, ['fault_description', '故障描述', '问题描述', '原因']) || '',
      }

      // 生成唯一键
      const key = `${cleanRow.serial_number}|${cleanRow.material_name}|${cleanRow.drawing_number}`
      uniqueMap.set(key, cleanRow)
    })

    const rows = Array.from(uniqueMap.values())

    addLog(`正在同步 ${rows.length} 条概况数据 (原始 ${rawRows.length} 条, 去重后保留最新)...`)
    const batchSize = 100
    for (let i = 0; i < rows.length; i += batchSize) {
      const batch = rows.slice(i, i + batchSize)

      const { error } = await supabase
        .from('mese_overview')
        .upsert(batch, { 
          // 使用新的复合字段进行冲突检测
          onConflict: 'serial_number, material_name, drawing_number' 
        })
      
      if (error) throw error
      addLog(`进度: ${Math.min(i + batchSize, rows.length)}/${rows.length}`)
    }
  }

  const upsertPersonNodes = async (rawRows) => {
    // 1. 前端清洗与去重
    // 组合键：流水号 + 开始时间 + 结束时间 + 节点 + 处理人
    // 注意：数据库 upsert 依赖唯一索引，如果字段为 NULL，Postgres 默认视为“不重复”，导致数据堆积。
    // 因此需将空时间转为特定值 (如 1970-01-01) 或确保不为空。
    
    const uniqueMap = new Map()
    const DEFAULT_TIME = '1970-01-01T00:00:00.000Z'

    rawRows.forEach(row => {
      // 兼容多列名
      const serial = getCellValue(row, ['三包流水号', 'serial_number', '流水号'])
      if (!serial) return

      const startTime = toDateTime(getCellValue(row, ['处理开始时间', 'start_time', '开始时间'])) || DEFAULT_TIME
      const endTime = toDateTime(getCellValue(row, ['处理结束时间', 'end_time', '结束时间'])) || DEFAULT_TIME
      const node = getCellValue(row, ['流程节点', 'node', '节点']) || ''
      const person = getCellValue(row, ['处理人姓名', 'person_name', '处理人', '姓名']) || ''

      const cleanRow = {
        serial_number: serial,
        start_time: startTime,
        end_time: endTime,
        node: node,
        person_name: person,
      }

      const key = `${serial}|${startTime}|${endTime}|${node}|${person}`
      uniqueMap.set(key, cleanRow)
    })

    const rows = Array.from(uniqueMap.values())

    addLog(`正在同步 ${rows.length} 条人员节点数据 (原始 ${rawRows.length} 条, 去重后保留最新)...`)
    const batchSize = 100
    for (let i = 0; i < rows.length; i += batchSize) {
      const batch = rows.slice(i, i + batchSize)

      const { error } = await supabase
        .from('mese_person_node')
        .upsert(batch, {
          // 使用组合键进行冲突检测
          onConflict: 'serial_number,start_time,end_time,node,person_name'
        })

      if (error) throw error
      addLog(`进度: ${Math.min(i + batchSize, rows.length)}/${rows.length}`)
    }
  }

  const upsertLedgerAnnual = async (rawRows, filename) => {
    let reportYear = 2025
    const yearMatchFile = filename.match(/（(\d{4})）/) || filename.match(/\((\d{4})\)/) || filename.match(/(\d{4})/)
    if (yearMatchFile) {
      const y = parseInt(yearMatchFile[1], 10)
      if (!isNaN(y)) reportYear = y
    }

    const uniqueMap = new Map()

    rawRows.forEach(row => {
      const serial = getCellValue(row, [
        '三包流水号', 'serial_number', '流水号',
        'TR编号', '物流三包号', '快递三包号', '三包单取号'
      ])
      if (!serial) return

      const cleanRow = {
        serial_number: serial,
        report_year: reportYear,
        department: getCellValue(row, ['提出部门', '分公司', '部门', '责任科室']) || '',
        customer_name: getCellValue(row, ['客户名称', '项目名称', '客户', '项目名']) || '',
        warranty_type: getCellValue(row, ['三包类型', '类型', 'TR部品分类', '品目分类', '部品分类']) || '',
        material_name: getCellValue(row, ['物料名称', '物料描述', '物料', '部品名称', '品目']) || '',
        quantity: Number(getCellValue(row, ['数量', '三包数量', '统计-数量']) || 0),
        amount: parseFloat(getCellValue(row, ['金额', '费用金额', '赔付金额', '金额(元)', '预估三包费用']) || 0),
        resolution: getCellValue(row, ['处理方式', '处置方式', '结案方式', '核查结案', '核查意见']) || '',
        status: getCellValue(row, ['结案状态', '状态', 'TR状态区分']) || '',
        category: getCellValue(row, ['问题类别', '问题类型', '不良分类（MASTER）', '一级分类']) || '',
        cause: getCellValue(row, ['原因', '原因分类', '原因类型', '五级定责分类']) || '',
        apply_date: toDateTime(getCellValue(row, ['申请日期', '发生日期', '上报日期', 'TR提出日期', '记录更新日期'])) || null
      }

      uniqueMap.set(serial, cleanRow)
    })

    const rows = Array.from(uniqueMap.values())
    addLog(`正在同步 ${rows.length} 条年度台账数据 (${reportYear})...`)

    const batchSize = 100
    for (let i = 0; i < rows.length; i += batchSize) {
      const batch = rows.slice(i, i + batchSize)
      const { error } = await supabase
        .from('mese_ledger')
        .upsert(batch, { onConflict: 'serial_number, report_year' })

      if (error) {
        addLog('提示: 如果出现 relation 不存在错误，请在 Supabase 中创建表 mese_ledger。', 'warning')
        throw error
      }
      addLog(`进度: ${Math.min(i + batchSize, rows.length)}/${rows.length}`)
    }
  }

  const handleCleanup = async () => {
    if (!confirm('确定要执行数据库去重操作吗？这将永久删除重复的历史数据，只保留最新的一条。')) return
    
    setLoading(true)
    addLog('开始执行数据库去重...', 'info')
    
    try {
      const { data, error } = await supabase.rpc('cleanup_duplicates')
      
      if (error) throw error
      
      addLog(`去重完成！清理无效数据: ${data.deleted_null_sn} 条, 重复概况: ${data.deleted_overview} 条, 重复节点: ${data.deleted_nodes} 条`, 'success')
    } catch (err) {
      addLog(`去重失败: ${err.message}`, 'error')
    } finally {
      setLoading(false)
    }
  }

  const handleTruncate = async (table, label) => {
    const tableName = table === 'overview' ? 'mese_overview' : 'mese_person_node'
    const confirmMsg = `【严重警告】您确定要清空“${label}”的全部数据吗？\n\n此操作不可恢复！通常用于重新上传全量数据。\n\n请输入 "DELETE" 确认：`
    
    const userInput = prompt(confirmMsg)
    if (userInput !== 'DELETE') {
      if (userInput !== null) alert('操作已取消')
      return
    }

    setLoading(true)
    addLog(`正在清空 ${label} 数据...`, 'warning')

    try {
      const { error } = await supabase.rpc('truncate_table', { table_name: tableName })
      if (error) throw error
      addLog(`${label} 数据已全部清空`, 'success')
    } catch (err) {
      addLog(`清空失败: ${err.message}`, 'error')
      if (err.message.includes('function truncate_table') && err.message.includes('does not exist')) {
         addLog('提示: 请先在 Supabase 执行 rpc_cleanup_v4.sql', 'warning')
      }
    } finally {
      setLoading(false)
    }
  }

  const handleDeleteMonthStats = async () => {
    const month = prompt('请输入要删除的统计月份 (格式: YYYY-MM，例如 2026-01):')
    if (!month) return
    
    if (!/^\d{4}-\d{2}$/.test(month)) {
      alert('格式错误！请使用 YYYY-MM 格式，例如 2026-01')
      return
    }

    const confirmMsg = `【严重警告】您确定要删除 "${month}" 月份的所有周期统计数据吗？\n\n此操作不可恢复！\n\n请输入 "DELETE" 确认：`
    const userInput = prompt(confirmMsg)
    if (userInput !== 'DELETE') {
      if (userInput !== null) alert('操作已取消')
      return
    }

    setLoading(true)
    addLog(`正在删除 ${month} 月份的周期数据...`, 'warning')

    try {
      const { error } = await supabase
        .from('mese_cycle_stats')
        .delete()
        .eq('stat_month', month)

      if (error) throw error
      
      addLog(`删除成功！已清除 ${month} 月份的数据`, 'success')
    } catch (err) {
      addLog(`删除失败: ${err.message}`, 'error')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-slate-50 p-6 md:p-12 font-sans">
      <header className="mb-10 max-w-7xl mx-auto">
        <h1 className="text-3xl md:text-4xl font-extrabold text-slate-800 tracking-tight">
          TR 数据大屏数据上传中心
        </h1>
        <p className="mt-2 text-slate-500 text-lg">
          每月更新 Supabase 数据库，确保大屏数据实时准确
        </p>
      </header>

      <main className="max-w-7xl mx-auto">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8 mb-12">
          {/* MESE 三包概况 */}
          <div className="group bg-white rounded-2xl p-6 shadow-sm border border-slate-100 hover:shadow-xl hover:-translate-y-1 transition-all duration-300">
            <div className="flex items-center gap-4 mb-6">
              <div className="p-3 bg-blue-50 text-blue-600 rounded-xl group-hover:bg-blue-600 group-hover:text-white transition-colors duration-300">
                <UploadIcon size={24} />
              </div>
              <div>
                <h2 className="text-lg font-bold text-slate-800">MESE 三包概况</h2>
                <p className="text-xs text-slate-400 font-medium">Overview Data</p>
              </div>
            </div>
            <p className="text-sm text-slate-500 mb-6 h-10">
              请上传最新的 <code className="bg-slate-100 px-1 py-0.5 rounded text-slate-700">MESE三包概况.csv</code> 文件
            </p>
            <div className="relative">
              <input 
                type="file" 
                accept=".csv"
                onChange={(e) => handleFileUpload(e, 'overview')}
                onClick={(e) => { e.currentTarget.value = '' }} 
                disabled={loading}
                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
              />
              <div className="border-2 border-dashed border-slate-200 rounded-xl p-6 text-center group-hover:border-blue-400 group-hover:bg-blue-50/50 transition-all duration-300">
                <span className="text-sm font-semibold text-blue-600">点击上传 CSV 文件</span>
              </div>
            </div>
          </div>

          {/* 人员节点日志 */}
          <div className="group bg-white rounded-2xl p-6 shadow-sm border border-slate-100 hover:shadow-xl hover:-translate-y-1 transition-all duration-300">
            <div className="flex items-center gap-4 mb-6">
              <div className="p-3 bg-purple-50 text-purple-600 rounded-xl group-hover:bg-purple-600 group-hover:text-white transition-colors duration-300">
                <FileUp size={24} />
              </div>
              <div>
                <h2 className="text-lg font-bold text-slate-800">人员节点日志</h2>
                <p className="text-xs text-slate-400 font-medium">Person Node Logs</p>
              </div>
            </div>
            <p className="text-sm text-slate-500 mb-6 h-10">
              请上传 <code className="bg-slate-100 px-1 py-0.5 rounded text-slate-700">MESE三包日志人员节点...csv</code>
            </p>
            <div className="relative">
              <input 
                type="file" 
                accept=".csv"
                onChange={(e) => handleFileUpload(e, 'person_node')} 
                onClick={(e) => { e.currentTarget.value = '' }} 
                disabled={loading}
                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
              />
              <div className="border-2 border-dashed border-slate-200 rounded-xl p-6 text-center group-hover:border-purple-400 group-hover:bg-purple-50/50 transition-all duration-300">
                <span className="text-sm font-semibold text-purple-600">点击上传 CSV 文件</span>
              </div>
            </div>
          </div>

          {/* 月度周期统计 */}
          <div className="group bg-white rounded-2xl p-6 shadow-sm border border-slate-100 hover:shadow-xl hover:-translate-y-1 transition-all duration-300">
            <div className="flex items-center gap-4 mb-6">
              <div className="p-3 bg-emerald-50 text-emerald-600 rounded-xl group-hover:bg-emerald-600 group-hover:text-white transition-colors duration-300">
                <CalendarClock size={24} />
              </div>
              <div>
                <h2 className="text-lg font-bold text-slate-800">月度周期统计</h2>
                <p className="text-xs text-slate-400 font-medium">Monthly Cycle Stats</p>
              </div>
            </div>
            <p className="text-sm text-slate-500 mb-6 h-10">
              请上传 <code className="bg-slate-100 px-1 py-0.5 rounded text-slate-700">周期统计确认(xx年xx月).csv</code>
            </p>
            
            {/* 月份选择器 */}
            <div className="mb-4">
              <label className="block text-xs font-semibold text-slate-500 mb-1">
                指定统计月份 (必选)
              </label>
              <input 
                type="month" 
                value={selectedMonth}
                onChange={(e) => setSelectedMonth(e.target.value)}
                className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
              />
            </div>

            <div className="relative">
              <input 
                type="file" 
                accept=".csv"
                onChange={(e) => handleFileUpload(e, 'cycle_stats')} 
                onClick={(e) => { e.currentTarget.value = '' }} 
                disabled={loading}
                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
              />
              <div className="border-2 border-dashed border-slate-200 rounded-xl p-6 text-center group-hover:border-emerald-400 group-hover:bg-emerald-50/50 transition-all duration-300">
                <span className="text-sm font-semibold text-emerald-600">点击上传 CSV 文件</span>
              </div>
            </div>
          </div>

          {/* TR 年度三包台账 */}
          <div className="group bg-white rounded-2xl p-6 shadow-sm border border-slate-100 hover:shadow-xl hover:-translate-y-1 transition-all duration-300">
            <div className="flex items-center gap-4 mb-6">
              <div className="p-3 bg-amber-50 text-amber-600 rounded-xl group-hover:bg-amber-600 group-hover:text-white transition-colors duration-300">
                <FileSpreadsheet size={24} />
              </div>
              <div>
                <h2 className="text-lg font-bold text-slate-800">TR 年度三包台账</h2>
                <p className="text-xs text-slate-400 font-medium">Annual Ledger</p>
              </div>
            </div>
            <p className="text-sm text-slate-500 mb-6 h-10">
              请上传 <code className="bg-slate-100 px-1 py-0.5 rounded text-slate-700">三包台账（YYYY）.csv</code>
            </p>
            <div className="relative">
              <input 
                type="file" 
                accept=".csv"
                onChange={(e) => handleFileUpload(e, 'ledger')} 
                onClick={(e) => { e.currentTarget.value = '' }} 
                disabled={loading}
                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
              />
              <div className="border-2 border-dashed border-slate-200 rounded-xl p-6 text-center group-hover:border-amber-400 group-hover:bg-amber-50/50 transition-all duration-300">
                <span className="text-sm font-semibold text-amber-600">点击上传 CSV 文件</span>
              </div>
            </div>
          </div>

          {/* 数据维护 (Danger Zone) */}
          <div className="col-span-1 md:col-span-2 lg:col-span-3 mt-4">
            <div className="bg-white rounded-2xl p-6 shadow-sm border border-slate-100 overflow-hidden">
              <div className="flex items-center gap-3 mb-6 pb-4 border-b border-slate-100">
                <Trash2 size={20} className="text-slate-400" />
                <h2 className="text-lg font-bold text-slate-800">数据维护与清理</h2>
                <span className="text-xs font-medium px-2 py-1 bg-amber-50 text-amber-600 rounded-full border border-amber-100">
                  Advanced
                </span>
              </div>
              
              <div className="flex flex-wrap gap-4">
                <button 
                  onClick={handleCleanup}
                  disabled={loading}
                  className="flex-1 min-w-[200px] px-6 py-4 rounded-xl bg-amber-50 text-amber-700 font-semibold hover:bg-amber-100 hover:shadow-md transition-all duration-200 flex items-center justify-center gap-2 border border-amber-100"
                >
                  <CheckCircle size={18} />
                  执行智能去重
                </button>
                
                <button 
                  onClick={() => handleTruncate('person_node', '人员节点日志')}
                  disabled={loading}
                  className="flex-1 min-w-[200px] px-6 py-4 rounded-xl bg-white text-slate-600 font-medium border border-slate-200 hover:border-red-200 hover:text-red-600 hover:bg-red-50 transition-all duration-200"
                >
                  清空人员日志表
                </button>

                <button 
                  onClick={() => handleTruncate('overview', 'MESE三包概况')}
                  disabled={loading}
                  className="flex-1 min-w-[200px] px-6 py-4 rounded-xl bg-white text-slate-600 font-medium border border-slate-200 hover:border-red-200 hover:text-red-600 hover:bg-red-50 transition-all duration-200"
                >
                  清空三包概况表
                </button>

                <button 
                  onClick={handleDeleteMonthStats}
                  disabled={loading}
                  className="flex-1 min-w-[200px] px-6 py-4 rounded-xl bg-white text-slate-600 font-medium border border-slate-200 hover:border-red-200 hover:text-red-600 hover:bg-red-50 transition-all duration-200"
                >
                  删除指定月份周期数据
                </button>
              </div>
              <p className="mt-4 text-xs text-slate-400 text-center">
                注意：清空操作不可恢复，请谨慎操作。智能去重会保留最新的记录。
              </p>
            </div>
          </div>
        </div>

        {/* 运行日志 */}
        <div className="bg-slate-900 rounded-2xl shadow-2xl overflow-hidden border border-slate-800">
          <div className="px-6 py-4 bg-slate-950 border-b border-slate-800 flex items-center justify-between">
            <h3 className="text-slate-200 font-semibold flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
              系统运行日志
            </h3>
            {loading && (
              <div className="flex items-center gap-2 text-blue-400 text-sm">
                <Loader2 className="animate-spin" size={16} />
                正在处理数据...
              </div>
            )}
          </div>
          <div className="h-80 overflow-y-auto p-6 font-mono text-sm space-y-2 scrollbar-thin scrollbar-thumb-slate-700 scrollbar-track-transparent">
            {logs.length === 0 && (
              <div className="h-full flex flex-col items-center justify-center text-slate-600">
                <Loader2 size={32} className="mb-2 opacity-20" />
                <span>等待操作...</span>
              </div>
            )}
            {logs.map((log, idx) => (
              <div key={idx} className={`flex items-start gap-3 animate-in fade-in slide-in-from-left-2 duration-300 ${
                log.type === 'error' ? 'text-red-400' : 
                log.type === 'warning' ? 'text-amber-400' : 
                log.type === 'success' ? 'text-emerald-400' : 'text-slate-300'
              }`}>
                <span className="text-slate-600 shrink-0 select-none">[{log.time}]</span>
                <span className="mt-0.5 shrink-0">
                  {log.type === 'success' && <CheckCircle size={14} />}
                  {log.type === 'error' && <AlertCircle size={14} />}
                  {log.type === 'warning' && <AlertCircle size={14} />}
                  {log.type === 'info' && <span className="block w-3.5 h-3.5 rounded-full bg-slate-700/50 border border-slate-600"></span>}
                </span>
                <span className="break-all leading-relaxed">{log.msg}</span>
              </div>
            ))}
            {/* Auto scroll anchor could be added here */}
          </div>
        </div>
      </main>
    </div>
  )
}

export default UploadPage
