import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../supabaseClient'
import { 
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
  PieChart, Pie, Cell, LineChart, Line, AreaChart, Area, LabelList
} from 'recharts'
import { Loader2, TrendingUp, Users, AlertCircle, Calendar, Package, Banknote } from 'lucide-react'

const COLORS = ['#0088FE', '#00C49F', '#FFBB28', '#FF8042', '#8884d8', '#82ca9d', '#ff6b6b', '#4ecdc4']
const CHART_COLORS = [
  '#64B5F6', // sky blue
  '#7986CB', // indigo
  '#BA68C8', // purple
  '#FFD54F', // yellow
  '#81C784', // green
  '#E57373', // red
  '#FFB74D', // orange
  '#90CAF9', // light blue
  '#4FC3F7', // cyan
  '#AED581', // light green
  '#CE93D8', // mauve
  '#4DD0E1', // teal
  '#F8BBD0', // pink
  '#B0BEC5'  // grey
]
const renderPieLabel = (props) => {
  const { name, value, percent, cx, cy, midAngle, outerRadius } = props
  const RADIAN = Math.PI / 180
  const r = outerRadius + 16
  const x = cx + r * Math.cos(-midAngle * RADIAN)
  const y = cy + r * Math.sin(-midAngle * RADIAN)
  const pct = typeof percent === 'number' ? (percent > 1 ? percent : percent * 100) : 0
  return (
    <text x={x} y={y} fill="#475569" textAnchor={x > cx ? 'start' : 'end'} dominantBaseline="central" fontSize={10}>
      {`${name} ${Math.round(Number(value) || 0).toLocaleString()} (${pct.toFixed(1)}%)`}
    </text>
  )
}

export default function Dashboard() {
  const navigate = useNavigate()
  const [loading, setLoading] = useState(true)
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear()) // 默认当年
  const [availableYears] = useState([2023, 2024, 2025, 2026])
  const [modalOpen, setModalOpen] = useState(false)
  const [modalType, setModalType] = useState('')
  const [anchorRect, setAnchorRect] = useState(null)
  const [trendFilters, setTrendFilters] = useState({ dept: '全部', customer: '全部', materialType: '全部' })
  const [amountFilters, setAmountFilters] = useState({ dept: '全部', customer: '全部' })
  const [faultFilters, setFaultFilters] = useState({ dept: '全部', customer: '全部' })
  const [deptTopFilters, setDeptTopFilters] = useState({ customer: '全部', warranty: '全部' })
  const [customerAmountFilters, setCustomerAmountFilters] = useState({ dept: '全部', category: '全部' })
  const [cycleRaw, setCycleRaw] = useState([])
  const [ledgerRaw, setLedgerRaw] = useState([])
  const [overviewRaw, setOverviewRaw] = useState([])
  const [detailCriteria, setDetailCriteria] = useState(null)
  
  const [stats, setStats] = useState({
    totalCount: 0,
    avgCycleTime: 0,
    topDept: { name: 'N/A', count: 0 },
    warrantyTypeData: [],
    monthlyTrend: [],
    departmentData: [],
    topMaterials: [],
    topFaults: [],
    amountTotal: 0,
    avgAmount: 0,
    closeRate: 0,
    monthlyAmountTrend: [],
    resolutionData: [],
    categoryData: [],
    categoryAmountData: [],
    deptAmountTop: [],
    customerAmountTop: []
  })

  const fetchData = useCallback(async () => {
    try {
      setLoading(true)
      
      // 并行查询：Overview (全量) 和 Cycle Stats (趋势)
      // 1. 获取 Overview 总数和数据
      const { count, error: countError } = await supabase
        .from('mese_overview')
        .select('*', { count: 'exact', head: true })
        .eq('report_year', selectedYear)
      
      if (countError) throw countError

      // 分页拉取 Overview 所有数据
      let allOverviewData = []
      let from = 0
      const limit = 1000
      let hasMore = true

      while (hasMore) {
        const { data, error } = await supabase
          .from('mese_overview')
          .select('*')
          .eq('report_year', selectedYear)
          .range(from, from + limit - 1)
        
        if (error) throw error
        
        if (data.length > 0) {
          allOverviewData = allOverviewData.concat(data)
          from += limit
          if (data.length < limit) hasMore = false
        } else {
          hasMore = false
        }
      }

      // 2. 获取 Cycle Stats (用于月度趋势和平均周期)
      // 注意：stat_month 格式为 "YYYY-MM"
      const { data: cycleData, error: cycleError } = await supabase
        .from('mese_cycle_stats')
        .select('stat_month, total_cycle_time, department, customer_name, material_type')
        .ilike('stat_month', `${selectedYear}-%`)
        .order('stat_month', { ascending: true })

      if (cycleError) throw cycleError

      // 3. 获取年度台账 (费用与结案)
      const { data: ledgerData, error: ledgerError } = await supabase
        .from('mese_ledger')
        .select('serial_number, material_name, amount, resolution, category, cause, department, customer_name, report_year, apply_date, status')
        .eq('report_year', selectedYear)
      
      if (ledgerError) throw ledgerError

      // --- 数据处理 ---

      // 1. 基础指标
      const totalCount = count
      setCycleRaw(cycleData || [])
      setLedgerRaw(ledgerData || [])
      setOverviewRaw(allOverviewData || [])
      
      // 2. 计算平均周期 (基于 cycleData)
      let avgCycleTime = 0
      if (cycleData && cycleData.length > 0) {
        const totalTime = cycleData.reduce((sum, item) => sum + (Number(item.total_cycle_time) || 0), 0)
        avgCycleTime = Number((totalTime / cycleData.length).toFixed(2))
      }

      // 3. 月度趋势 (基于 cycleData)
      const monthlyMap = {}
      cycleData.forEach(item => {
        const m = item.stat_month
        if (!monthlyMap[m]) monthlyMap[m] = { month: m, count: 0, avgTime: 0, totalTime: 0 }
        monthlyMap[m].count++
        monthlyMap[m].totalTime += (Number(item.total_cycle_time) || 0)
      })
      const monthlyTrend = Object.values(monthlyMap).map(item => ({
        month: item.month,
        count: item.count,
        avgTime: (item.totalTime / item.count).toFixed(2)
      })).sort((a, b) => a.month.localeCompare(b.month))

      // 4. 三包类型分布
      const typeCount = {}
      allOverviewData.forEach(item => {
        const type = item.warranty_type || '未知'
        typeCount[type] = (typeCount[type] || 0) + 1
      })
      const warrantyTypeData = Object.entries(typeCount)
        .map(([name, value]) => ({ name, value }))
        .sort((a, b) => b.value - a.value)

      // 5. 部门分布 Top 10
      const deptCount = {}
      allOverviewData.forEach(item => {
        const dept = item.department || '未知'
        deptCount[dept] = (deptCount[dept] || 0) + 1
      })
      const departmentData = Object.entries(deptCount)
        .map(([name, value]) => ({ name, value }))
        .sort((a, b) => b.value - a.value)
        .slice(0, 10)
      
      const topDept = departmentData.length > 0 ? { name: departmentData[0].name, count: departmentData[0].value } : { name: 'N/A', count: 0 }

      // 6. 物料 Top 10
      const materialCount = {}
      allOverviewData.forEach(item => {
        const name = item.material_name || '未知'
        materialCount[name] = (materialCount[name] || 0) + 1
      })
      const topMaterials = Object.entries(materialCount)
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 10)

      // 7. 故障描述 Top 10
      const faultCount = {}
      allOverviewData.forEach(item => {
        const fault = item.fault_description || '未描述'
        // 简单清洗：截取前10个字避免太长，或者直接统计完全匹配
        const cleanFault = fault.length > 20 ? fault.substring(0, 20) + '...' : fault
        faultCount[cleanFault] = (faultCount[cleanFault] || 0) + 1
      })
      const topFaults = Object.entries(faultCount)
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 10)

      // 8. 年度台账费用与结案
      let amountTotal = 0
      let ledgerCount = 0
      let closedCount = 0
      const resolutionMap = {}
      const categoryMap = {}
      const deptAmountMap = {}
      const customerAmountMap = {}
      const monthlyAmountMap = {}

      if (ledgerData && ledgerData.length > 0) {
        ledgerCount = ledgerData.length
        ledgerData.forEach(item => {
          const amt = Number(item.amount) || 0
          amountTotal += amt

          const res = item.resolution || '未知'
          resolutionMap[res] = (resolutionMap[res] || 0) + 1

          const cat = item.category || '未知'
          categoryMap[cat] = (categoryMap[cat] || 0) + 1

          const dept = item.department || '未知'
          deptAmountMap[dept] = (deptAmountMap[dept] || 0) + amt

          const cust = item.customer_name || '未知'
          customerAmountMap[cust] = (customerAmountMap[cust] || 0) + amt

          const st = (item.status || '').toString()
          if (st.includes('结') || st === '已结案' || st === '结案') closedCount++

          if (item.apply_date) {
            const month = new Date(item.apply_date).toISOString().slice(0, 7)
            if (!monthlyAmountMap[month]) monthlyAmountMap[month] = { month, amount: 0 }
            monthlyAmountMap[month].amount += amt
          }
        })
      }

      const avgAmount = ledgerCount ? Number((amountTotal / ledgerCount).toFixed(2)) : 0
      const closeRate = ledgerCount ? Number(((closedCount / ledgerCount) * 100).toFixed(1)) : 0
      const monthlyAmountTrend = Object.values(monthlyAmountMap).sort((a, b) => a.month.localeCompare(b.month))
      const resolutionData = Object.entries(resolutionMap).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value)
      const categoryData = Object.entries(categoryMap).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value)
      const categoryAmountMap = {}
      if (ledgerData && ledgerData.length > 0) {
        ledgerData.forEach(item => {
          const cat = item.category || '未知'
          const amt = Number(item.amount) || 0
          categoryAmountMap[cat] = (categoryAmountMap[cat] || 0) + amt
        })
      }
      const categoryAmountData = Object.entries(categoryAmountMap).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value)
      const deptAmountTop = Object.entries(deptAmountMap).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value).slice(0, 10)
      const customerAmountTop = Object.entries(customerAmountMap).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value).slice(0, 10)

      setStats({
        totalCount,
        avgCycleTime,
        topDept,
        warrantyTypeData,
        monthlyTrend,
        departmentData,
        topMaterials,
        topFaults,
        amountTotal,
        avgAmount,
        closeRate,
        monthlyAmountTrend,
        resolutionData,
        categoryData,
        categoryAmountData,
        deptAmountTop,
        customerAmountTop
      })

    } catch (err) {
      console.error('Error fetching dashboard data:', err)
    } finally {
      setLoading(false)
    }
  }, [selectedYear])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center h-[80vh] text-slate-400 gap-4">
        <Loader2 className="animate-spin text-blue-500" size={48} />
        <p className="text-lg font-light tracking-wide">正在计算年度数据...</p>
      </div>
    )
  }

  const openDetail = (kind, value) => {
    setDetailCriteria({ kind, value })
    setModalType('detailList')
    setModalOpen(true)
  }

  return (
    <div className="space-y-8 animate-fade-in pb-10 max-w-7xl mx-auto px-4">
      <header className="flex justify-between items-end border-b border-gray-200 pb-6">
        <div>
          <h1 className="text-3xl font-bold text-slate-800 tracking-tight">TR 年度数据分析看板</h1>
          <p className="text-slate-500 mt-2">全方位洞察 {selectedYear} 年度三包业务数据</p>
        </div>
        <div className="flex items-center gap-4">
            <div className="flex items-center gap-3 bg-white px-4 py-2 rounded-lg border border-gray-200 shadow-sm">
                <label className="text-sm font-medium text-slate-500 uppercase tracking-wider">统计年份</label>
                <select 
                    value={selectedYear} 
                    onChange={(e) => setSelectedYear(Number(e.target.value))}
                    className="appearance-none bg-transparent text-slate-700 font-bold text-lg focus:outline-none cursor-pointer"
                >
                    {availableYears.map(year => (
                    <option key={year} value={year}>{year}年</option>
                    ))}
                </select>
            </div>
        </div>
      </header>

      {/* 1. KPI 核心指标卡片 */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-gradient-to-br from-blue-500 to-blue-600 rounded-2xl p-6 text-white shadow-lg shadow-blue-200">
            <div className="flex justify-between items-start">
                <div>
                    <p className="text-blue-100 font-medium mb-1">年度工单总数</p>
                    <h3 className="text-4xl font-extrabold">{stats.totalCount.toLocaleString()}</h3>
                </div>
                <div className="p-3 bg-white/20 rounded-xl backdrop-blur-sm">
                    <Package size={24} className="text-white" />
                </div>
            </div>
            <div className="mt-4 flex items-center gap-2 text-sm text-blue-100">
                <span className="bg-white/20 px-2 py-0.5 rounded text-white font-medium">100%</span>
                <span>数据录入完成</span>
            </div>
        </div>

        <div className="bg-white rounded-2xl p-6 border border-gray-100 shadow-sm hover:shadow-md transition-shadow">
            <div className="flex justify-between items-start">
                <div>
                    <p className="text-slate-500 font-medium mb-1">平均处理周期</p>
                    <h3 className="text-4xl font-extrabold text-slate-800 flex items-baseline gap-2">
                        {stats.avgCycleTime} <span className="text-lg font-normal text-slate-400">天</span>
                    </h3>
                </div>
                <div className="p-3 bg-emerald-50 rounded-xl text-emerald-600">
                    <TrendingUp size={24} />
                </div>
            </div>
            <p className="mt-4 text-sm text-slate-400">基于 {stats.monthlyTrend.reduce((acc, cur) => acc + cur.count, 0)} 条有效闭环数据计算</p>
        </div>

        <div className="bg-white rounded-2xl p-6 border border-gray-100 shadow-sm hover:shadow-md transition-shadow">
            <div className="flex justify-between items-start">
                <div>
                    <p className="text-slate-500 font-medium mb-1">年度费用总额</p>
                    <h3 className="text-4xl font-extrabold text-slate-800 flex items-baseline gap-2">
                        ¥ {Number(stats.amountTotal).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </h3>
                </div>
                <div className="p-3 bg-blue-50 rounded-xl text-blue-600">
                    <Banknote size={24} />
                </div>
            </div>
            <p className="mt-4 text-sm text-slate-400">单均费用 ¥{stats.avgAmount}</p>
        </div>
      </div>

      {modalOpen && (
        <div className="fixed inset-0 z-50">
          <div className="absolute inset-0 bg-black/50" onClick={() => setModalOpen(false)}></div>
          <div className="absolute inset-0 p-4">
            <div 
              className="bg-white rounded-2xl shadow-2xl w-full max-w-5xl overflow-hidden border border-slate-200"
              style={
                anchorRect 
                  ? { 
                      position: 'absolute', 
                      top: anchorRect.top + (anchorRect.height / 2), 
                      left: '50%', 
                      transform: 'translate(-50%, -50%)' 
                    } 
                  : { position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)' }
              }
            >
              <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 bg-slate-50">
                <h3 className="text-lg font-bold text-slate-800">
                  {modalType === 'monthlyTrend' 
                    ? '月度工单量与周期趋势（放大）' 
                    : modalType === 'monthlyAmount' 
                      ? '月度费用趋势（放大）' 
                      : modalType === 'faultTop'
                        ? 'Top 故障描述（放大）'
                        : modalType === 'deptTop'
                          ? '部门工单 Top 榜（放大）'
                          : modalType === 'customerAmountTop'
                            ? '客户费用 Top 榜（放大）'
                              : modalType === 'warrantyTypeDist'
                                ? '三包类型分布（放大）'
                      : modalType === 'categoryAmountDist'
                        ? '问题类别费用占比（放大）'
                        : modalType === 'detailList'
                          ? '三包清单（详情）'
                          : '问题类别分布（放大）'}
                </h3>
                <button 
                  className="px-3 py-1 rounded-lg bg-slate-200 text-slate-700 text-sm font-medium hover:bg-slate-300"
                  onClick={() => { setModalOpen(false); setAnchorRect(null) }}
                >
                  关闭
                </button>
              </div>
              <div className="p-6 space-y-6">
                {modalType === 'detailList' && (
                  <>
                    {(() => {
                      let rows = []
                      let columns = []
                      if (detailCriteria && (detailCriteria.kind === 'category' || detailCriteria.kind === 'categoryAmount')) {
                        rows = ledgerRaw.filter(d => (d.category || '未知') === detailCriteria.value)
                        columns = ['serial_number', 'material_name', 'drawing_number', 'apply_date', 'customer_name', 'department', 'category', 'amount', 'status', 'resolution', 'cause']
                      } else if (detailCriteria && detailCriteria.kind === 'warrantyType') {
                        rows = overviewRaw.filter(d => (d.warranty_type || '未知') === detailCriteria.value)
                        columns = ['serial_number', 'material_name', 'drawing_number', 'customer_name', 'department', 'warranty_type']
                      } else if (detailCriteria && detailCriteria.kind === 'material') {
                        rows = overviewRaw.filter(d => (d.material_name || '未知') === detailCriteria.value)
                        columns = ['serial_number', 'material_name', 'drawing_number', 'customer_name', 'department', 'warranty_type']
                      } else if (detailCriteria && detailCriteria.kind === 'department') {
                        rows = ledgerRaw.filter(d => (d.department || '未知') === detailCriteria.value)
                        columns = ['serial_number', 'material_name', 'drawing_number', 'apply_date', 'customer_name', 'department', 'category', 'amount', 'status', 'resolution', 'cause']
                      }
                      return (
                        <div className="max-h-[640px] overflow-y-auto pr-2 custom-scrollbar">
                          <div className="text-sm text-slate-600 mb-2">筛选条件：{detailCriteria?.value}</div>
                          <table className="w-full text-sm">
                            <thead>
                              <tr className="text-left text-slate-500">
                                {columns.map((c, i) => (
                                  <th key={i} className="py-2 pr-4">{c}</th>
                                ))}
                              </tr>
                            </thead>
                            <tbody>
                              {rows.slice(0, 200).map((r, idx) => (
                                <tr key={idx} className="border-t border-slate-100">
                                  {columns.map((c, i) => (
                                    <td key={i} className="py-2 pr-4">
                                      {c === 'amount' ? `¥${Math.round(Number(r[c]) || 0).toLocaleString()}` 
                                        : c === 'apply_date' ? (r[c] ? new Date(r[c]).toISOString().slice(0,10) : '') 
                                        : c === 'drawing_number' ? (() => {
                                            const m = overviewRaw.find(d => d.serial_number === r.serial_number && (!r.material_name || d.material_name === r.material_name))
                                            return m?.drawing_number || ''
                                          })()
                                        : r[c]}
                                    </td>
                                  ))}
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )
                    })()}
                  </>
                )}
                {modalType === 'monthlyTrend' && (
                  <>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                      <select
                        value={trendFilters.dept}
                        onChange={(e) => setTrendFilters(f => ({ ...f, dept: e.target.value }))}
                        className="bg-white border border-gray-300 text-slate-700 py-1 pl-3 pr-8 rounded shadow-sm sm:text-sm font-medium"
                      >
                        {['全部', ...Array.from(new Set(cycleRaw.map(d => d.department).filter(Boolean)))].map(d => (
                          <option key={`dept-${d}`} value={d}>{d}</option>
                        ))}
                      </select>
                      <select
                        value={trendFilters.customer}
                        onChange={(e) => setTrendFilters(f => ({ ...f, customer: e.target.value }))}
                        className="bg-white border border-gray-300 text-slate-700 py-1 pl-3 pr-8 rounded shadow-sm sm:text-sm font-medium"
                      >
                        {['全部', ...Array.from(new Set(cycleRaw.map(d => d.customer_name).filter(Boolean)))].map(c => (
                          <option key={`cust-${c}`} value={c}>{c}</option>
                        ))}
                      </select>
                      <select
                        value={trendFilters.materialType}
                        onChange={(e) => setTrendFilters(f => ({ ...f, materialType: e.target.value }))}
                        className="bg-white border border-gray-300 text-slate-700 py-1 pl-3 pr-8 rounded shadow-sm sm:text-sm font-medium"
                      >
                        {['全部', ...Array.from(new Set(cycleRaw.map(d => d.material_type).filter(Boolean)))].map(mt => (
                          <option key={`mt-${mt}`} value={mt}>{mt}</option>
                        ))}
                      </select>
                    </div>
                    {(() => {
                      const filtered = cycleRaw.filter(d => 
                        (trendFilters.dept === '全部' || d.department === trendFilters.dept) &&
                        (trendFilters.customer === '全部' || d.customer_name === trendFilters.customer) &&
                        (trendFilters.materialType === '全部' || d.material_type === trendFilters.materialType)
                      )
                      const map = {}
                      filtered.forEach(item => {
                        const m = item.stat_month
                        if (!map[m]) map[m] = { month: m, count: 0, totalTime: 0 }
                        map[m].count++
                        map[m].totalTime += (Number(item.total_cycle_time) || 0)
                      })
                      const filteredMonthlyTrend = Object.values(map).map(item => ({
                        month: item.month,
                        count: item.count,
                        avgTime: (item.totalTime / (item.count || 1)).toFixed(2)
                      })).sort((a, b) => a.month.localeCompare(b.month))
                      const deptMap = {}
                      filtered.forEach(d => {
                        const k = d.department || '未知'
                        deptMap[k] = (deptMap[k] || 0) + 1
                      })
                      const filteredDeptData = Object.entries(deptMap).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value)
                      return (
                        <>
                          <div className="h-[420px]">
                            <ResponsiveContainer width="100%" height="100%">
                              <AreaChart data={filteredMonthlyTrend} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
                                <defs>
                                  <linearGradient id="mColorCount" x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.1}/>
                                    <stop offset="95%" stopColor="#3b82f6" stopOpacity={0}/>
                                  </linearGradient>
                                </defs>
                                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                                <XAxis dataKey="month" axisLine={false} tickLine={false} tick={{fill: '#64748b', fontSize: 12}} dy={10} />
                                <YAxis yAxisId="left" axisLine={false} tickLine={false} tick={{fill: '#64748b', fontSize: 12}} />
                                <YAxis yAxisId="right" orientation="right" axisLine={false} tickLine={false} tick={{fill: '#10b981', fontSize: 12}} unit="天" />
                                <Tooltip />
                                <Legend wrapperStyle={{ fontSize: 10 }} />
                                <Area yAxisId="left" type="monotone" dataKey="count" name="工单量" stroke="#3b82f6" strokeWidth={3} fillOpacity={1} fill="url(#mColorCount)" />
                                <Line yAxisId="right" type="monotone" dataKey="avgTime" name="平均周期(天)" stroke="#10b981" strokeWidth={2} dot={{ r: 4 }} activeDot={{ r: 6 }} />
                              </AreaChart>
                            </ResponsiveContainer>
                          </div>
                          <div className="h-[320px]">
                            <ResponsiveContainer width="100%" height="100%">
                              <BarChart data={filteredDeptData} margin={{ left: 0, right: 20, top: 10, bottom: 10 }}>
                                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                                <XAxis dataKey="name" tick={{ fill: '#475569', fontSize: 12 }} interval={0} angle={-25} dy={10} />
                                <YAxis />
                                <Tooltip />
                                <Legend wrapperStyle={{ fontSize: 10 }} />
                                <Bar dataKey="value" name="部门工单数" fill="#f59e0b" radius={[4, 4, 0, 0]} />
                              </BarChart>
                            </ResponsiveContainer>
                          </div>
                        </>
                      )
                    })()}
                  </>
                )}

                {modalType === 'monthlyAmount' && (
                  <>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <select
                        value={amountFilters.dept}
                        onChange={(e) => setAmountFilters(f => ({ ...f, dept: e.target.value }))}
                        className="bg-white border border-gray-300 text-slate-700 py-1 pl-3 pr-8 rounded shadow-sm sm:text-sm font-medium"
                      >
                        {['全部', ...Array.from(new Set(ledgerRaw.map(d => d.department).filter(Boolean)))].map(d => (
                          <option key={`adept-${d}`} value={d}>{d}</option>
                        ))}
                      </select>
                      <select
                        value={amountFilters.customer}
                        onChange={(e) => setAmountFilters(f => ({ ...f, customer: e.target.value }))}
                        className="bg-white border border-gray-300 text-slate-700 py-1 pl-3 pr-8 rounded shadow-sm sm:text-sm font-medium"
                      >
                        {['全部', ...Array.from(new Set(ledgerRaw.map(d => d.customer_name).filter(Boolean)))].map(c => (
                          <option key={`acust-${c}`} value={c}>{c}</option>
                        ))}
                      </select>
                    </div>
                    {(() => {
                      const filtered = ledgerRaw.filter(d =>
                        (amountFilters.dept === '全部' || d.department === amountFilters.dept) &&
                        (amountFilters.customer === '全部' || d.customer_name === amountFilters.customer)
                      )
                      const mm = {}
                      filtered.forEach(item => {
                        if (item.apply_date) {
                          const month = new Date(item.apply_date).toISOString().slice(0, 7)
                          if (!mm[month]) mm[month] = { month, amount: 0 }
                          mm[month].amount += Number(item.amount) || 0
                        }
                      })
                      const fMonthlyAmountTrend = Object.values(mm).sort((a, b) => a.month.localeCompare(b.month))
                      const deptMap = {}
                      const customerMap = {}
                      filtered.forEach(item => {
                        const d = item.department || '未知'
                        const c = item.customer_name || '未知'
                        deptMap[d] = (deptMap[d] || 0) + (Number(item.amount) || 0)
                        customerMap[c] = (customerMap[c] || 0) + (Number(item.amount) || 0)
                      })
                      const fDeptAmountTop = Object.entries(deptMap).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value).slice(0, 10)
                      const fCustomerAmountTop = Object.entries(customerMap).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value).slice(0, 10)
                      return (
                        <>
                          <div className="h-[420px]">
                            <ResponsiveContainer width="100%" height="100%">
                              <AreaChart data={fMonthlyAmountTrend} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
                                <defs>
                                  <linearGradient id="mColorAmount" x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="5%" stopColor="#10b981" stopOpacity={0.15}/>
                                    <stop offset="95%" stopColor="#10b981" stopOpacity={0}/>
                                  </linearGradient>
                                </defs>
                                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                                <XAxis dataKey="month" axisLine={false} tickLine={false} tick={{fill: '#64748b', fontSize: 12}} dy={10} />
                                <YAxis axisLine={false} tickLine={false} tick={{fill: '#64748b', fontSize: 12}} />
                                <Tooltip formatter={(value) => [`¥${Number(value).toLocaleString()}`, '费用']} />
                                <Legend wrapperStyle={{ fontSize: 10 }} />
                                <Area type="monotone" dataKey="amount" name="费用" stroke="#10b981" strokeWidth={3} fillOpacity={1} fill="url(#mColorAmount)" />
                              </AreaChart>
                            </ResponsiveContainer>
                          </div>
                          <div className="h-[320px] grid grid-cols-1 lg:grid-cols-2 gap-6">
                            <div className="w-full h-full">
                              <ResponsiveContainer width="100%" height="100%">
                                <BarChart data={fDeptAmountTop} margin={{ left: 0, right: 20, top: 10, bottom: 10 }}>
                                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                                  <XAxis dataKey="name" tick={{ fill: '#475569', fontSize: 12 }} interval={0} angle={-25} dy={10} />
                                  <YAxis />
                                  <Tooltip formatter={(value) => [`¥${Number(value).toLocaleString()}`, '费用']} />
                                  <Legend wrapperStyle={{ fontSize: 10 }} />
                                  <Bar dataKey="value" name="部门费用" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                                </BarChart>
                              </ResponsiveContainer>
                            </div>
                            <div className="w-full h-full">
                              <ResponsiveContainer width="100%" height="100%">
                                <BarChart data={fCustomerAmountTop} margin={{ left: 0, right: 20, top: 10, bottom: 10 }}>
                                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                                  <XAxis dataKey="name" tick={{ fill: '#475569', fontSize: 12 }} interval={0} angle={-25} dy={10} />
                                  <YAxis />
                                  <Tooltip formatter={(value) => [`¥${Number(value).toLocaleString()}`, '费用']} />
                                  <Legend wrapperStyle={{ fontSize: 10 }} />
                                  <Bar dataKey="value" name="客户费用" fill="#f59e0b" radius={[4, 4, 0, 0]} />
                                </BarChart>
                              </ResponsiveContainer>
                            </div>
                          </div>
                        </>
                      )
                    })()}
                  </>
                )}

                {modalType === 'faultTop' && (
                  <>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <select
                        value={faultFilters.dept}
                        onChange={(e) => setFaultFilters(f => ({ ...f, dept: e.target.value }))}
                        className="bg-white border border-gray-300 text-slate-700 py-1 pl-3 pr-8 rounded shadow-sm sm:text-sm font-medium"
                      >
                        {['全部', ...Array.from(new Set(overviewRaw.map(d => d.department).filter(Boolean)))].map(d => (
                          <option key={`fdept-${d}`} value={d}>{d}</option>
                        ))}
                      </select>
                      <select
                        value={faultFilters.customer}
                        onChange={(e) => setFaultFilters(f => ({ ...f, customer: e.target.value }))}
                        className="bg-white border border-gray-300 text-slate-700 py-1 pl-3 pr-8 rounded shadow-sm sm:text-sm font-medium"
                      >
                        {['全部', ...Array.from(new Set(overviewRaw.map(d => d.customer_name).filter(Boolean)))].map(c => (
                          <option key={`fcust-${c}`} value={c}>{c}</option>
                        ))}
                      </select>
                    </div>
                    {(() => {
                      const filtered = overviewRaw.filter(d =>
                        (faultFilters.dept === '全部' || d.department === faultFilters.dept) &&
                        (faultFilters.customer === '全部' || d.customer_name === faultFilters.customer)
                      )
                      const faultMap = {}
                      filtered.forEach(item => {
                        const desc = item.fault_description || '未描述'
                        if (!faultMap[desc]) {
                          faultMap[desc] = { 
                            desc, 
                            count: 0, 
                            departments: {}, 
                            customers: {}, 
                            samples: [] 
                          }
                        }
                        faultMap[desc].count++
                        const d = item.department || '未知'
                        const c = item.customer_name || '未知'
                        faultMap[desc].departments[d] = (faultMap[desc].departments[d] || 0) + 1
                        faultMap[desc].customers[c] = (faultMap[desc].customers[c] || 0) + 1
                        if (faultMap[desc].samples.length < 5) {
                          faultMap[desc].samples.push({
                            serial: item.serial_number,
                            material: item.material_name,
                            customer: item.customer_name,
                            department: item.department
                          })
                        }
                      })
                      const faultList = Object.values(faultMap)
                        .sort((a, b) => b.count - a.count)
                        .slice(0, 20)
                      const toTopArray = (obj) => Object.entries(obj)
                        .map(([name, value]) => ({ name, value }))
                        .sort((a, b) => b.value - a.value)
                        .slice(0, 5)
                      return (
                        <div className="space-y-4 max-h-[640px] overflow-y-auto pr-2 custom-scrollbar">
                          {faultList.map((f, idx) => (
                            <div key={idx} className="p-4 rounded-xl border border-slate-100 bg-white shadow-sm">
                              <div className="flex items-start justify-between gap-3">
                                <div className="flex items-start gap-3">
                                  <span className={`flex-shrink-0 w-6 h-6 flex items-center justify-center rounded-full text-xs font-bold ${idx < 3 ? 'bg-red-100 text-red-700' : 'bg-slate-200 text-slate-600'}`}>
                                    {idx + 1}
                                  </span>
                                  <div>
                                    <div className="text-slate-800 font-semibold leading-relaxed break-words">{f.desc}</div>
                                    <div className="mt-1 text-xs text-slate-500">出现次数：<span className="font-bold text-slate-700">{f.count}</span></div>
                                  </div>
                                </div>
                              </div>
                              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-3">
                                <div>
                                  <div className="text-xs font-semibold text-slate-500 mb-1">Top 部门</div>
                                  <ul className="space-y-1">
                                    {toTopArray(f.departments).map((d, i) => (
                                      <li key={i} className="flex justify-between text-xs">
                                        <span className="text-slate-700 truncate">{d.name}</span>
                                        <span className="font-bold text-slate-600">{d.value}</span>
                                      </li>
                                    ))}
                                  </ul>
                                </div>
                                <div>
                                  <div className="text-xs font-semibold text-slate-500 mb-1">Top 客户</div>
                                  <ul className="space-y-1">
                                    {toTopArray(f.customers).map((c, i) => (
                                      <li key={i} className="flex justify-between text-xs">
                                        <span className="text-slate-700 truncate" title={c.name}>{c.name}</span>
                                        <span className="font-bold text-slate-600">{c.value}</span>
                                      </li>
                                    ))}
                                  </ul>
                                </div>
                                <div>
                                  <div className="text-xs font-semibold text-slate-500 mb-1">关联样例</div>
                                  <ul className="space-y-1">
                                    {f.samples.map((s, i) => (
                                      <li key={i} className="text-xs text-slate-700 flex justify-between">
                                        <button 
                                          className="truncate max-w-[160px] text-blue-600 hover:underline text-xs"
                                          title={s.serial}
                                          onClick={() => { setModalOpen(false); navigate(`/analysis?serial=${encodeURIComponent(s.serial)}`) }}
                                        >
                                          {s.serial}
                                        </button>
                                        <span className="truncate max-w-[160px]" title={s.material}>{s.material}</span>
                                      </li>
                                    ))}
                                  </ul>
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      )
                    })()}
                  </>
                )}

                {modalType === 'deptTop' && (
                  <>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <select
                        value={deptTopFilters.customer}
                        onChange={(e) => setDeptTopFilters(f => ({ ...f, customer: e.target.value }))}
                        className="bg-white border border-gray-300 text-slate-700 py-1 pl-3 pr-8 rounded shadow-sm sm:text-sm font-medium"
                      >
                        {['全部', ...Array.from(new Set(overviewRaw.map(d => d.customer_name).filter(Boolean)))].map(c => (
                          <option key={`dtop-c-${c}`} value={c}>{c}</option>
                        ))}
                      </select>
                      <select
                        value={deptTopFilters.warranty}
                        onChange={(e) => setDeptTopFilters(f => ({ ...f, warranty: e.target.value }))}
                        className="bg-white border border-gray-300 text-slate-700 py-1 pl-3 pr-8 rounded shadow-sm sm:text-sm font-medium"
                      >
                        {['全部', ...Array.from(new Set(overviewRaw.map(d => d.warranty_type).filter(Boolean)))].map(w => (
                          <option key={`dtop-w-${w}`} value={w}>{w}</option>
                        ))}
                      </select>
                    </div>
                    {(() => {
                      const filtered = overviewRaw.filter(d =>
                        (deptTopFilters.customer === '全部' || d.customer_name === deptTopFilters.customer) &&
                        (deptTopFilters.warranty === '全部' || d.warranty_type === deptTopFilters.warranty)
                      )
                      const map = {}
                      filtered.forEach(item => {
                        const k = item.department || '未知'
                        map[k] = (map[k] || 0) + 1
                      })
                      const data = Object.entries(map).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value)
                      return (
                        <div className="h-[520px]">
                          <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={data} layout="vertical" margin={{ left: 0, right: 20, top: 10, bottom: 10 }}>
                              <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#f1f5f9" />
                              <XAxis type="number" hide />
                              <YAxis dataKey="name" type="category" width={120} tick={{ fill: '#475569', fontSize: 12 }} axisLine={false} tickLine={false} />
                              <Tooltip cursor={{ fill: '#f8fafc' }} contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)' }} />
                              <Legend />
                              <Bar dataKey="value" name="工单数" fill="#f59e0b" radius={[0, 4, 4, 0]} barSize={22} />
                            </BarChart>
                          </ResponsiveContainer>
                        </div>
                      )
                    })()}
                  </>
                )}

                {modalType === 'customerAmountTop' && (
                  <>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <select
                        value={customerAmountFilters.dept}
                        onChange={(e) => setCustomerAmountFilters(f => ({ ...f, dept: e.target.value }))}
                        className="bg-white border border-gray-300 text-slate-700 py-1 pl-3 pr-8 rounded shadow-sm sm:text-sm font-medium"
                      >
                        {['全部', ...Array.from(new Set(ledgerRaw.map(d => d.department).filter(Boolean)))].map(d => (
                          <option key={`ctop-d-${d}`} value={d}>{d}</option>
                        ))}
                      </select>
                      <select
                        value={customerAmountFilters.category}
                        onChange={(e) => setCustomerAmountFilters(f => ({ ...f, category: e.target.value }))}
                        className="bg-white border border-gray-300 text-slate-700 py-1 pl-3 pr-8 rounded shadow-sm sm:text-sm font-medium"
                      >
                        {['全部', ...Array.from(new Set(ledgerRaw.map(d => d.category).filter(Boolean)))].map(cat => (
                          <option key={`ctop-cat-${cat}`} value={cat}>{cat}</option>
                        ))}
                      </select>
                    </div>
                    {(() => {
                      const filtered = ledgerRaw.filter(d =>
                        (customerAmountFilters.dept === '全部' || d.department === customerAmountFilters.dept) &&
                        (customerAmountFilters.category === '全部' || d.category === customerAmountFilters.category)
                      )
                      const map = {}
                      filtered.forEach(item => {
                        const k = item.customer_name || '未知'
                        map[k] = (map[k] || 0) + (Number(item.amount) || 0)
                      })
                      const data = Object.entries(map).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value)
                      return (
                        <div className="h-[520px]">
                          <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={data} layout="vertical" margin={{ left: 0, right: 20, top: 10, bottom: 10 }}>
                              <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#f1f5f9" />
                              <XAxis type="number" tickFormatter={(v) => `¥${Number(v).toLocaleString()}`} />
                              <YAxis dataKey="name" type="category" width={120} tick={{ fill: '#475569', fontSize: 12 }} axisLine={false} tickLine={false} />
                              <Tooltip formatter={(value) => [`¥${Number(value).toLocaleString()}`, '费用']} />
                              <Legend />
                              <Bar dataKey="value" name="费用" fill="#3b82f6" radius={[0, 4, 4, 0]} barSize={22} />
                            </BarChart>
                          </ResponsiveContainer>
                        </div>
                      )
                    })()}
                  </>
                )}

                

                {modalType === 'warrantyTypeDist' && (
                  <>
                    {(() => {
                      const total = stats.warrantyTypeData.reduce((s, i) => s + i.value, 0)
                      const data = stats.warrantyTypeData.map(d => ({
                        ...d,
                        percent: total ? Math.round((d.value / total) * 100) : 0
                      }))
                      return (
                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                          <div className="h-[420px]">
                            <ResponsiveContainer width="100%" height="100%">
                              <PieChart>
                                <Pie
                                  data={data}
                                  cx="50%"
                                  cy="50%"
                                  innerRadius={70}
                                  outerRadius={110}
                                  paddingAngle={4}
                                  labelLine
                                  label={renderPieLabel}
                                  onClick={(d) => openDetail('warrantyType', d?.name ?? d?.payload?.name)}
                                  dataKey="value"
                                >
                                  {data.map((entry, index) => (
                                    <Cell key={`cell-wm-${index}`} fill={CHART_COLORS[index % CHART_COLORS.length]} stroke="#FFF7ED" />
                                  ))}
                                </Pie>
                                <Tooltip formatter={(value, name, props) => [`${value} 条（${props.payload.percent}%）`, name]} />
                                <Legend verticalAlign="bottom" height={36} iconType="circle" wrapperStyle={{ fontSize: 10 }} />
                              </PieChart>
                            </ResponsiveContainer>
                          </div>
                          <div className="h-[420px]">
                            <ResponsiveContainer width="100%" height="100%">
                              <BarChart data={data} layout="vertical" margin={{ left: 0, right: 20, top: 0, bottom: 0 }}>
                                <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#f1f5f9" />
                                <XAxis type="number" />
                                <YAxis
                                  dataKey="name"
                                  type="category"
                                  width={120}
                                  tick={{ fill: '#475569', fontSize: 12 }}
                                  axisLine={false}
                                  tickLine={false}
                                />
                                <Tooltip formatter={(value, name, props) => [`${value} 条（${props.payload.percent}%）`, '数量']} />
                                <Legend wrapperStyle={{ fontSize: 10 }} />
                                <Bar dataKey="value" name="数量" fill="#64B5F6" radius={[0, 6, 6, 0]} barSize={22} onClick={(d) => openDetail('warrantyType', d?.name ?? d?.payload?.name)}>
                                  <LabelList dataKey="percent" position="right" formatter={(v) => `${v}%`} />
                                  {data.map((entry, index) => (
                                    <Cell key={`bar-w-${index}`} fill={CHART_COLORS[index % CHART_COLORS.length]} />
                                  ))}
                                </Bar>
                              </BarChart>
                            </ResponsiveContainer>
                          </div>
                        </div>
                      )
                    })()}
                  </>
                )}

                {modalType === 'categoryDist' && (
                  <>
                    {(() => {
                      const total = stats.categoryData.reduce((s, i) => s + i.value, 0)
                      const data = stats.categoryData.map(d => ({
                        ...d,
                        percent: total ? Math.round((d.value / total) * 100) : 0
                      }))
                      return (
                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                          <div className="h-[420px]">
                            <ResponsiveContainer width="100%" height="100%">
                              <PieChart>
                                <Pie
                                  data={data}
                                  cx="50%"
                                  cy="50%"
                                  innerRadius={70}
                                  outerRadius={110}
                                  paddingAngle={4}
                                  labelLine
                                label={renderPieLabel}
                                onClick={(d) => openDetail('category', d?.name ?? d?.payload?.name)}
                                  dataKey="value"
                                >
                                  {data.map((entry, index) => (
                                    <Cell key={`cell-cm-${index}`} fill={CHART_COLORS[index % CHART_COLORS.length]} stroke="#FFF7ED" />
                                  ))}
                                </Pie>
                                <Tooltip formatter={(value, name, props) => [`${value} 条（${props.payload.percent}%）`, name]} />
                              <Legend verticalAlign="bottom" height={36} iconType="circle" wrapperStyle={{ fontSize: 10 }} />
                              </PieChart>
                            </ResponsiveContainer>
                          </div>
                          <div className="h-[420px]">
                            <ResponsiveContainer width="100%" height="100%">
                              <BarChart data={data} layout="vertical" margin={{ left: 0, right: 20, top: 0, bottom: 0 }}>
                                <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#f1f5f9" />
                                <XAxis type="number" />
                                <YAxis
                                  dataKey="name"
                                  type="category"
                                  width={120}
                                  tick={{ fill: '#475569', fontSize: 12 }}
                                  axisLine={false}
                                  tickLine={false}
                                />
                                <Tooltip formatter={(value, name, props) => [`${value} 条（${props.payload.percent}%）`, '数量']} />
                                <Legend wrapperStyle={{ fontSize: 10 }} />
                                <Bar dataKey="value" name="数量" fill="#64B5F6" radius={[0, 6, 6, 0]} barSize={22} onClick={(d) => openDetail('category', d?.name ?? d?.payload?.name)}>
                                  <LabelList dataKey="percent" position="right" formatter={(v) => `${v}%`} />
                                  {data.map((entry, index) => (
                                    <Cell key={`bar-c-${index}`} fill={CHART_COLORS[index % CHART_COLORS.length]} />
                                  ))}
                                </Bar>
                              </BarChart>
                            </ResponsiveContainer>
                          </div>
                        </div>
                      )
                    })()}
                  </>
                )}
                
                {modalType === 'categoryAmountDist' && (
                  <>
                    {(() => {
                      const total = stats.categoryAmountData.reduce((s, i) => s + i.value, 0)
                      const data = stats.categoryAmountData.map(d => ({
                        ...d,
                        value: Math.round(d.value),
                        percent: total ? Math.round((d.value / total) * 100) : 0
                      }))
                      return (
                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                          <div className="h-[420px]">
                            <ResponsiveContainer width="100%" height="100%">
                              <PieChart>
                                <Pie
                                  data={data}
                                  cx="50%"
                                  cy="50%"
                                  innerRadius={70}
                                  outerRadius={110}
                                  paddingAngle={4}
                                  labelLine
                                label={renderPieLabel}
                                onClick={(d) => openDetail('categoryAmount', d?.name ?? d?.payload?.name)}
                                  dataKey="value"
                                >
                                  {data.map((entry, index) => (
                                    <Cell key={`cell-cam-${index}`} fill={CHART_COLORS[index % CHART_COLORS.length]} stroke="#FFF7ED" />
                                  ))}
                                </Pie>
                                <Tooltip formatter={(value, name, props) => [`¥${Math.round(Number(value) || 0).toLocaleString()}（${props.payload.percent}%）`, name]} />
                              <Legend verticalAlign="bottom" height={36} iconType="circle" wrapperStyle={{ fontSize: 10 }} />
                              </PieChart>
                            </ResponsiveContainer>
                          </div>
                          <div className="h-[420px]">
                            <ResponsiveContainer width="100%" height="100%">
                              <BarChart data={data} layout="vertical" margin={{ left: 0, right: 20, top: 0, bottom: 0 }}>
                                <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#f1f5f9" />
                                <XAxis type="number" />
                                <YAxis
                                  dataKey="name"
                                  type="category"
                                  width={120}
                                  tick={{ fill: '#475569', fontSize: 12 }}
                                  axisLine={false}
                                  tickLine={false}
                                />
                                <Tooltip formatter={(value, name, props) => [`¥${Math.round(Number(value) || 0).toLocaleString()}（${props.payload.percent}%）`, '费用']} />
                                <Legend wrapperStyle={{ fontSize: 10 }} />
                                <Bar dataKey="value" name="费用" fill="#64B5F6" radius={[0, 6, 6, 0]} barSize={22} onClick={(d) => openDetail('categoryAmount', d?.name ?? d?.payload?.name)}>
                                  <LabelList dataKey="percent" position="right" formatter={(v) => `${v}%`} />
                                  {data.map((entry, index) => (
                                    <Cell key={`bar-cam-${index}`} fill={CHART_COLORS[index % CHART_COLORS.length]} />
                                  ))}
                                </Bar>
                              </BarChart>
                            </ResponsiveContainer>
                          </div>
                        </div>
                      )
                    })()}
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 2. 趋势图表区 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* 月度趋势图 */}
        <div 
          className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 overflow-hidden cursor-zoom-in"
          onClick={(e) => { 
            const rect = e.currentTarget.getBoundingClientRect()
            setAnchorRect({ top: rect.top, left: rect.left, width: rect.width, height: rect.height })
            setModalType('monthlyTrend'); 
            setModalOpen(true) 
          }}
        >
            <h3 className="text-lg font-bold text-slate-700 mb-6 flex items-center gap-2">
                <Calendar size={20} className="text-blue-500" />
                月度工单量与周期趋势
            </h3>
            <div className="h-[320px] w-full overflow-hidden">
                <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={stats.monthlyTrend} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
                        <defs>
                            <linearGradient id="colorCount" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.1}/>
                                <stop offset="95%" stopColor="#3b82f6" stopOpacity={0}/>
                            </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                        <XAxis dataKey="month" axisLine={false} tickLine={false} tick={{fill: '#64748b', fontSize: 12}} dy={10} />
                        <YAxis yAxisId="left" axisLine={false} tickLine={false} tick={{fill: '#64748b', fontSize: 12}} />
                        <YAxis yAxisId="right" orientation="right" axisLine={false} tickLine={false} tick={{fill: '#10b981', fontSize: 12}} unit="天" />
                        <Tooltip 
                            contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.1)' }}
                            labelStyle={{ color: '#1e293b', fontWeight: 'bold', marginBottom: '8px' }}
                        />
                        <Legend wrapperStyle={{ paddingTop: '20px' }} />
                        <Area 
                            yAxisId="left"
                            type="monotone" 
                            dataKey="count" 
                            name="工单量" 
                            stroke="#3b82f6" 
                            strokeWidth={3}
                            fillOpacity={1} 
                            fill="url(#colorCount)" 
                        />
                        <Line 
                            yAxisId="right"
                            type="monotone" 
                            dataKey="avgTime" 
                            name="平均周期(天)" 
                            stroke="#10b981" 
                            strokeWidth={2}
                            dot={{ r: 4, fill: '#10b981', strokeWidth: 0 }}
                            activeDot={{ r: 6 }}
                        />
                    </AreaChart>
                </ResponsiveContainer>
            </div>
        </div>

        {/* 月度费用趋势 */}
        <div 
          className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 cursor-zoom-in"
          onClick={(e) => { 
            const rect = e.currentTarget.getBoundingClientRect()
            setAnchorRect({ top: rect.top, left: rect.left, width: rect.width, height: rect.height })
            setModalType('monthlyAmount'); 
            setModalOpen(true) 
          }}
        >
          <h3 className="text-lg font-bold text-slate-700 mb-6 flex items-center gap-2">
            <Calendar size={20} className="text-emerald-500" />
            月度费用趋势
          </h3>
          <div className="h-[320px] w-full overflow-hidden">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={stats.monthlyAmountTrend} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="colorAmount" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#10b981" stopOpacity={0.15}/>
                    <stop offset="95%" stopColor="#10b981" stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                <XAxis dataKey="month" axisLine={false} tickLine={false} tick={{fill: '#64748b', fontSize: 12}} dy={10} />
                <YAxis axisLine={false} tickLine={false} tick={{fill: '#64748b', fontSize: 12}} />
                <Tooltip 
                  contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.1)' }}
                  labelStyle={{ color: '#1e293b', fontWeight: 'bold', marginBottom: '8px' }}
                  formatter={(value) => [`¥${Number(value).toLocaleString()}`, '费用']}
                />
                <Legend wrapperStyle={{ paddingTop: '20px', fontSize: 10 }} />
                <Area 
                  type="monotone" 
                  dataKey="amount" 
                  name="费用" 
                  stroke="#10b981" 
                  strokeWidth={3}
                  fillOpacity={1} 
                  fill="url(#colorAmount)" 
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* 2.1 费用趋势与分布 */}
      <div className="grid grid-cols-1 gap-8">
        {/* 问题类别费用占比 */}
        <div 
          className="bg-white p-6 rounded-2xl shadow-sm border border-amber-100 overflow-hidden"
        >
          <h3 className="text-lg font-bold text-slate-700 mb-6 flex items-center gap-2">
            <AlertCircle size={20} className="text-amber-500" />
            问题类别费用占比
          </h3>
          {(() => {
            const total = stats.categoryAmountData.reduce((s, i) => s + i.value, 0)
            const data = stats.categoryAmountData.map(d => ({
              ...d,
              value: Math.round(d.value),
              percent: total ? Math.round((d.value / total) * 100) : 0
            }))
            return (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div className="h-[320px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={data}
                        cx="50%"
                        cy="50%"
                        innerRadius={60}
                        outerRadius={95}
                        paddingAngle={3}
                        labelLine
                      label={renderPieLabel}
                      onClick={(d) => openDetail('categoryAmount', d?.name ?? d?.payload?.name)}
                        dataKey="value"
                      >
                        {data.map((entry, index) => (
                          <Cell key={`cell-cam-inline-${index}`} fill={CHART_COLORS[index % CHART_COLORS.length]} stroke="#FFF7ED" />
                        ))}
                      </Pie>
                      <Tooltip contentStyle={{ borderRadius: '10px', border: 'none', boxShadow: '0 8px 20px rgba(0,0,0,0.08)' }} formatter={(value) => [`¥${Math.round(Number(value) || 0).toLocaleString()}`, '费用']} />
                    <Legend verticalAlign="bottom" height={36} iconType="circle" wrapperStyle={{ fontSize: 10 }} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <div className="h-[320px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={data} layout="vertical" margin={{ left: 0, right: 20, top: 0, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#f1f5f9" />
                      <XAxis type="number" />
                      <YAxis
                        dataKey="name"
                        type="category"
                        width={120}
                        tick={{ fill: '#475569', fontSize: 12 }}
                        axisLine={false}
                        tickLine={false}
                      />
                      <Tooltip formatter={(value, name, props) => [`¥${Math.round(Number(value) || 0).toLocaleString()}（${props.payload.percent}%）`, '费用']} />
                    <Legend wrapperStyle={{ fontSize: 10 }} />
                      <Bar dataKey="value" name="费用" fill="#64B5F6" radius={[0, 6, 6, 0]} barSize={22} onClick={(d) => openDetail('categoryAmount', d?.name ?? d?.payload?.name)}>
                        <LabelList dataKey="percent" position="right" formatter={(v) => `${v}%`} />
                        {data.map((entry, index) => (
                          <Cell key={`bar-cam-inline-${index}`} fill={CHART_COLORS[index % CHART_COLORS.length]} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            )
          })()}
        </div>
      </div>

      {/* 3. 分布与排行 */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* 三包类型分布 */}
        <div 
          className="bg-white p-6 rounded-2xl shadow-sm border border-amber-100 overflow-hidden cursor-zoom-in"
          onClick={(e) => { 
            const rect = e.currentTarget.getBoundingClientRect()
            setAnchorRect({ top: rect.top, left: rect.left, width: rect.width, height: rect.height })
            setModalType('warrantyTypeDist'); 
            setModalOpen(true) 
          }}
        >
            <h3 className="text-lg font-bold text-slate-700 mb-6 flex items-center gap-2">
                <AlertCircle size={20} className="text-amber-500" />
                三包类型占比
            </h3>
            <div className="h-[300px] overflow-hidden">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={stats.warrantyTypeData}
                    cx="50%"
                    cy="50%"
                    innerRadius={60}
                    outerRadius={90}
                    paddingAngle={3}
                    labelLine
                    label={renderPieLabel}
                    onClick={(d) => openDetail('warrantyType', d?.name ?? d?.payload?.name)}
                    dataKey="value"
                  >
                    {stats.warrantyTypeData.map((entry, index) => (
                      <Cell key={`cell-w-${index}`} fill={CHART_COLORS[index % CHART_COLORS.length]} stroke="#FFF7ED" />
                    ))}
                  </Pie>
                  <Tooltip contentStyle={{ borderRadius: '10px', border: 'none', boxShadow: '0 8px 20px rgba(0,0,0,0.08)' }} />
                  <Legend verticalAlign="bottom" height={36} iconType="circle" wrapperStyle={{ fontSize: 10 }} />
                </PieChart>
              </ResponsiveContainer>
            </div>
        </div>

        {/* 高频物料 */}
        <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
            <h3 className="text-lg font-bold text-slate-700 mb-6 flex items-center gap-2">
                <Package size={20} className="text-emerald-500" />
                高频故障物料
            </h3>
            <div className="space-y-4 overflow-y-auto h-[300px] pr-2 custom-scrollbar">
                {stats.topMaterials.map((item, idx) => (
                    <div key={idx} className="flex items-center justify-between p-3 bg-slate-50 rounded-lg cursor-pointer hover:bg-slate-100" onClick={() => openDetail('material', item.name)}>
                        <div className="flex items-center gap-3 overflow-hidden">
                            <span className={`flex-shrink-0 w-6 h-6 flex items-center justify-center rounded-full text-xs font-bold ${idx < 3 ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-200 text-slate-600'}`}>
                                {idx + 1}
                            </span>
                            <span className="text-sm text-slate-700 truncate font-medium break-words" title={item.name}>{item.name}</span>
                        </div>
                        <span className="text-sm font-bold text-slate-600">{item.count}</span>
                    </div>
                ))}
            </div>
        </div>

        {/* 故障描述词云/列表 */}
        <div 
            className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 overflow-hidden cursor-zoom-in"
          onClick={(e) => { 
            const rect = e.currentTarget.getBoundingClientRect()
            setAnchorRect({ top: rect.top, left: rect.left, width: rect.width, height: rect.height })
            setModalType('faultTop'); 
            setModalOpen(true) 
          }}
        >
            <h3 className="text-lg font-bold text-slate-700 mb-6 flex items-center gap-2">
                <AlertCircle size={20} className="text-red-500" />
                Top 故障描述
            </h3>
            <div className="space-y-4 overflow-y-auto h-[300px] pr-2 custom-scrollbar">
                {stats.topFaults.map((item, idx) => (
                    <div key={idx} className="flex items-center justify-between p-3 bg-slate-50 rounded-lg">
                        <div className="flex items-center gap-3 overflow-hidden">
                            <span className={`flex-shrink-0 w-6 h-6 flex items-center justify-center rounded-full text-xs font-bold ${idx < 3 ? 'bg-red-100 text-red-700' : 'bg-slate-200 text-slate-600'}`}>
                                {idx + 1}
                            </span>
                            <span className="text-sm text-slate-700 truncate font-medium break-words" title={item.name}>{item.name}</span>
                        </div>
                        <span className="text-sm font-bold text-slate-600">{item.count}</span>
                    </div>
                ))}
            </div>
        </div>
      </div>

      {/* 3.1 部门费用 Top 与问题类别分布 */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* 部门费用 Top 榜 */}
        <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100">
          <h3 className="text-lg font-bold text-slate-700 mb-6 flex items-center gap-2">
            <Users size={20} className="text-blue-500" />
            部门费用 Top 榜
          </h3>
          <div className="h-[320px] w-full overflow-hidden">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={stats.deptAmountTop} layout="vertical" margin={{ left: 0, right: 20, top: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#f1f5f9" />
                <XAxis type="number" hide />
                <YAxis 
                  dataKey="name" 
                  type="category" 
                  width={100} 
                  tick={{ fill: '#475569', fontSize: 12 }} 
                  axisLine={false}
                  tickLine={false}
                />
                <Tooltip 
                  cursor={{ fill: '#f8fafc' }} 
                  contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)' }}
                  formatter={(value) => [`¥${Number(value).toLocaleString()}`, '费用']}
                />
                <Bar dataKey="value" name="费用" fill="#3b82f6" radius={[0, 4, 4, 0]} barSize={20} onClick={(d) => openDetail('department', d?.name ?? d?.payload?.name)} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* 问题类别占比 */}
        <div 
          className="bg-white p-6 rounded-2xl shadow-sm border border-amber-100 cursor-zoom-in"
          onClick={(e) => { 
            const rect = e.currentTarget.getBoundingClientRect()
            setAnchorRect({ top: rect.top, left: rect.left, width: rect.width, height: rect.height })
            setModalType('categoryDist'); 
            setModalOpen(true) 
          }}
        >
          <h3 className="text-lg font-bold text-slate-700 mb-6 flex items-center gap-2">
            <AlertCircle size={20} className="text-amber-500" />
            问题类别占比
          </h3>
          <div className="h-[300px] overflow-hidden">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={stats.categoryData}
                  cx="50%"
                  cy="50%"
                  innerRadius={60}
                  outerRadius={90}
                  paddingAngle={3}
                  labelLine
                  label={renderPieLabel}
                  onClick={(d) => openDetail('category', d?.name ?? d?.payload?.name)}
                  dataKey="value"
                >
                  {stats.categoryData.map((entry, index) => (
                    <Cell key={`cell-c-${index}`} fill={CHART_COLORS[index % CHART_COLORS.length]} stroke="#FFF7ED" />
                  ))}
                </Pie>
                <Tooltip contentStyle={{ borderRadius: '10px', border: 'none', boxShadow: '0 8px 20px rgba(0,0,0,0.08)' }} />
                <Legend verticalAlign="bottom" height={36} iconType="circle" wrapperStyle={{ fontSize: 10 }} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* 客户费用 Top 榜 */}
        <div 
          className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 cursor-zoom-in"
          onClick={(e) => { 
            const rect = e.currentTarget.getBoundingClientRect()
            setAnchorRect({ top: rect.top, left: rect.left, width: rect.width, height: rect.height })
            setModalType('customerAmountTop'); 
            setModalOpen(true) 
          }}
        >
          <h3 className="text-lg font-bold text-slate-700 mb-6 flex items-center gap-2">
            <Package size={20} className="text-amber-500" />
            客户费用 Top 榜
          </h3>
          <div className="space-y-4 overflow-y-auto h-[300px] pr-2 custom-scrollbar">
            {stats.customerAmountTop.map((item, idx) => (
              <div key={idx} className="flex items-center justify-between p-3 bg-slate-50 rounded-lg">
                <div className="flex items-center gap-3 overflow-hidden">
                  <span className={`flex-shrink-0 w-6 h-6 flex items-center justify-center rounded-full text-xs font-bold ${idx < 3 ? 'bg-amber-100 text-amber-700' : 'bg-slate-200 text-slate-600'}`}>
                    {idx + 1}
                  </span>
                  <span className="text-sm text-slate-700 truncate font-medium" title={item.name}>{item.name}</span>
                </div>
                <span className="text-sm font-bold text-slate-600">¥{Number(item.value).toLocaleString()}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
