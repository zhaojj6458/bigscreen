import { useState, useEffect, useCallback } from 'react'
import { useLocation } from 'react-router-dom'
import { supabase } from '../supabaseClient'
import { 
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer 
} from 'recharts'
import { Loader2, Clock, AlertTriangle, FileText, Activity } from 'lucide-react'
import '../App.css'

export default function MonthlyAnalysis() {
  const location = useLocation()
  const [loading, setLoading] = useState(true)
  const [availableMonths, setAvailableMonths] = useState([])
  const [selectedMonth, setSelectedMonth] = useState('')
  const [searchSerial, setSearchSerial] = useState('')
  const [stats, setStats] = useState({
    totalCount: 0,
    avgCycleTime: 0,
    medianCycleTime: 0,
    longCycleCount: 0,
    longCycleList: []
  })
  const [selectedDetail, setSelectedDetail] = useState(null)
  const [detailLoading, setDetailLoading] = useState(false)

  const [trendData, setTrendData] = useState([])

  // 1. 初始化：获取可用月份 & 趋势数据
  useEffect(() => {
    fetchMonths()
    fetchTrendData()
  }, [])

  const fetchTrendData = async () => {
    try {
      // 获取最近 6 个月的数据进行对比
      const { data, error } = await supabase
        .from('mese_cycle_stats')
        .select('stat_month, hq_audit_time, ship_time, total_cycle_time, branch_submit_time, supp_invest_time, branch_invest_time')
        .order('stat_month', { ascending: true })
      
      if (error) throw error

      // 按月份聚合计算平均值
      const monthStats = {}
      data.forEach(item => {
        const m = item.stat_month
        if (!monthStats[m]) {
          monthStats[m] = { 
            count: 0, 
            hq_audit_sum: 0, 
            ship_sum: 0, 
            smec_sum: 0,
            total_sum: 0 
          }
        }
        monthStats[m].count++
        monthStats[m].hq_audit_sum += Number(item.hq_audit_time) || 0
        monthStats[m].ship_sum += Number(item.ship_time) || 0
        
        // 计算 SMEC 环节总和 (分公司提交 + 补充调查 + 现场调查)
        const smecTime = (Number(item.branch_submit_time) || 0) + 
                         (Number(item.supp_invest_time) || 0) + 
                         (Number(item.branch_invest_time) || 0)
        monthStats[m].smec_sum += smecTime

        monthStats[m].total_sum += Number(item.total_cycle_time) || 0
      })

      const trend = Object.keys(monthStats).map(m => ({
        month: m,
        avg_audit: (monthStats[m].hq_audit_sum / monthStats[m].count).toFixed(2),
        avg_ship: (monthStats[m].ship_sum / monthStats[m].count).toFixed(2),
        avg_smec: (monthStats[m].smec_sum / monthStats[m].count).toFixed(2),
        avg_total: (monthStats[m].total_sum / monthStats[m].count).toFixed(2),
      })).sort((a, b) => a.month.localeCompare(b.month)).slice(-6) // 取最后 6 个月

      setTrendData(trend)
    } catch (err) {
      console.error('Fetch trend error:', err)
    }
  }

  const fetchStats = useCallback(async () => {
    setLoading(true)
    try {
      const { data, error } = await supabase
        .from('mese_cycle_stats')
        .select('*')
        .eq('stat_month', selectedMonth)
      
      if (error) throw error

      if (!data || data.length === 0) {
        setStats({ totalCount: 0, avgCycleTime: 0, medianCycleTime: 0, longCycleCount: 0, longCycleList: [] })
        setLoading(false)
        return
      }

      const times = data.map(d => Number(d.total_cycle_time) || 0).sort((a, b) => a - b)
      const totalTime = times.reduce((sum, t) => sum + t, 0)
      const avgTime = Number((totalTime / times.length).toFixed(2))
      
      const mid = Math.floor(times.length / 2)
      const medianTime = times.length % 2 !== 0 
        ? times[mid] 
        : Number(((times[mid - 1] + times[mid]) / 2).toFixed(2))

      const longList = data.filter(d => (Number(d.total_cycle_time) || 0) > 20)
        .sort((a, b) => b.total_cycle_time - a.total_cycle_time)

      setStats({
        totalCount: data.length,
        avgCycleTime: avgTime,
        medianCycleTime: Number(medianTime),
        longCycleCount: longList.length,
        longCycleList: longList.slice(0, 20)
      })
    } catch (err) {
      console.error('Fetch stats error:', err)
    } finally {
      setLoading(false)
    }
  }, [selectedMonth])

  useEffect(() => {
    if (selectedMonth) {
      fetchStats()
    }
  }, [selectedMonth, fetchStats])

  const fetchMonths = async () => {
    try {
      const { data, error } = await supabase
        .from('mese_cycle_stats')
        .select('stat_month')
        .order('stat_month', { ascending: false })
      
      if (error) throw error
      
      // 去重
      const months = [...new Set(data.map(item => item.stat_month))]
      setAvailableMonths(months)
      if (months.length > 0) setSelectedMonth(months[0])
    } catch (err) {
      console.error('Fetch months error:', err)
    } finally {
      setLoading(false)
    }
  }

  // moved above

  const fetchDetail = async (serial) => {
    setDetailLoading(true)
    try {
      // 并行查询三个表
      // 注意：mese_overview 可能有多条记录 (不同物料)，不能用 single()
      const cleanSerial = serial.trim()
      console.log('Fetching details for:', cleanSerial) // Debug log
      
      // 尝试使用 ilike 进行模糊匹配，防止数据库中存在不可见字符
      const [overviewRes, logsRes, cycleRes] = await Promise.all([
        supabase.from('mese_overview').select('*').ilike('serial_number', `${cleanSerial}%`),
        supabase.from('mese_person_node').select('*').ilike('serial_number', `${cleanSerial}%`).order('start_time', { ascending: true }),
        supabase.from('mese_cycle_stats').select('*').eq('serial_number', cleanSerial).eq('stat_month', selectedMonth).single()
      ])

      console.log('Logs found:', logsRes.data?.length) // Debug log
      let cycleData = cycleRes.data
      if (!cycleData) {
        const fallback = await supabase
          .from('mese_cycle_stats')
          .select('*')
          .eq('serial_number', cleanSerial)
          .order('stat_month', { ascending: false })
          .limit(1)
        cycleData = (fallback.data && fallback.data[0]) ? fallback.data[0] : {}
      }

      setSelectedDetail({
        overviewList: overviewRes.data || [], 
        logs: logsRes.data || [],
        cycle: cycleData || {}
      })
    } catch (err) {
      console.error('Fetch detail error:', err)
    } finally {
      setDetailLoading(false)
    }
  }

  useEffect(() => {
    const params = new URLSearchParams(location.search)
    const serial = params.get('serial')
    if (serial) {
      setSearchSerial(serial)
      if (selectedMonth) {
        fetchDetail(serial)
      }
    }
  }, [location.search, selectedMonth])

  if (loading && !stats.totalCount) {
    return (
      <div className="flex flex-col items-center justify-center h-[80vh] text-slate-400 gap-4">
        <Loader2 className="animate-spin text-blue-500" size={48} />
        <p className="text-lg font-light tracking-wide">加载月度分析数据...</p>
      </div>
    )
  }

  return (
    <div className="space-y-8 animate-fade-in pb-8">
      {/* Header */}
      <header className="flex justify-between items-end border-b border-gray-200 pb-6">
        <div>
          <h1 className="text-3xl font-bold text-slate-800 tracking-tight">月度周期分析</h1>
          <div className="mt-3 flex items-center gap-3 text-slate-500">
            <label className="text-sm font-medium uppercase tracking-wider">统计月份</label>
            <div className="relative">
              <select 
                value={selectedMonth} 
                onChange={(e) => setSelectedMonth(e.target.value)}
                className="appearance-none bg-white border border-gray-300 text-slate-700 py-1 pl-3 pr-8 rounded shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 sm:text-sm font-medium transition-shadow cursor-pointer min-w-[140px]"
              >
                {availableMonths.map(m => <option key={m} value={m}>{m}</option>)}
              </select>
              <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-2 text-gray-500">
                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7"></path></svg>
              </div>
            </div>
          </div>
        </div>
      </header>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100 flex items-center gap-5 hover:shadow-md transition-shadow">
          <div className="p-4 bg-blue-50 rounded-full text-blue-600">
            <FileText size={28} />
          </div>
          <div>
            <div className="text-sm text-slate-500 font-medium mb-1">本月三包总数</div>
            <div className="text-3xl font-bold text-slate-800">{stats.totalCount}</div>
          </div>
        </div>
        
        <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100 flex items-center gap-5 hover:shadow-md transition-shadow">
          <div className="p-4 bg-emerald-50 rounded-full text-emerald-600">
            <Clock size={28} />
          </div>
          <div>
            <div className="text-sm text-slate-500 font-medium mb-1">平均处理周期</div>
            <div className="text-3xl font-bold text-slate-800 flex items-baseline gap-1">
              {stats.avgCycleTime} <span className="text-sm font-normal text-slate-400">天</span>
            </div>
          </div>
        </div>

        <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100 flex items-center gap-5 hover:shadow-md transition-shadow">
          <div className="p-4 bg-amber-50 rounded-full text-amber-600">
            <Activity size={28} />
          </div>
          <div>
            <div className="text-sm text-slate-500 font-medium mb-1">周期中位数</div>
            <div className="text-3xl font-bold text-slate-800 flex items-baseline gap-1">
              {stats.medianCycleTime} <span className="text-sm font-normal text-slate-400">天</span>
            </div>
          </div>
        </div>

        <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100 flex items-center gap-5 hover:shadow-md transition-shadow relative overflow-hidden group">
          <div className={`absolute top-0 right-0 w-16 h-16 bg-red-500 rotate-45 transform translate-x-8 -translate-y-8 transition-transform group-hover:translate-x-6 group-hover:-translate-y-6`}></div>
          <div className="p-4 bg-red-50 rounded-full text-red-600 z-10">
            <AlertTriangle size={28} />
          </div>
          <div className="z-10">
            <div className="text-sm text-slate-500 font-medium mb-1">长周期 (&gt;20天)</div>
            <div className="text-3xl font-bold text-slate-800">{stats.longCycleCount}</div>
          </div>
        </div>
      </div>

      {/* 趋势对比表 */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100 bg-gray-50/50">
          <h3 className="font-bold text-slate-700 text-lg">MESE 环节周期趋势对比 (近6个月)</h3>
        </div>
        <div className="p-6 overflow-x-auto">
          <table className="w-full text-sm text-left border-collapse">
            <thead>
              <tr className="bg-slate-50 text-slate-600">
                <th rowSpan={2} className="px-4 py-3 font-semibold border border-slate-200">周期单位（天）</th>
                <th colSpan={3} className="px-4 py-3 font-semibold border border-slate-200 text-center bg-blue-50/50 text-blue-700">MESE 环节</th>
                <th rowSpan={2} className="px-4 py-3 font-semibold border border-slate-200 text-center bg-amber-50/50 text-amber-700">SMEC 环节</th>
                <th rowSpan={2} className="px-4 py-3 font-semibold border border-slate-200 text-center">全流程周期</th>
              </tr>
              <tr className="bg-slate-50 text-slate-600">
                <th className="px-4 py-3 font-medium border border-slate-200 text-center text-xs uppercase tracking-wider">审核处置周期</th>
                <th className="px-4 py-3 font-medium border border-slate-200 text-center text-xs uppercase tracking-wider">制造发运周期</th>
                <th className="px-4 py-3 font-medium border border-slate-200 text-center text-xs uppercase tracking-wider bg-blue-50/30 text-blue-700">周期小计 (1+2)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {trendData.map(item => (
                <tr key={item.month} className="hover:bg-slate-50/80 transition-colors">
                  <td className="px-4 py-3 font-medium text-slate-700 border border-slate-100">{item.month}</td>
                  <td className="px-4 py-3 text-center text-slate-600 border border-slate-100">{item.avg_audit}</td>
                  <td className="px-4 py-3 text-center text-slate-600 border border-slate-100">{item.avg_ship}</td>
                  <td className="px-4 py-3 text-center font-bold text-blue-600 bg-blue-50/10 border border-slate-100">
                    { (Number(item.avg_audit) + Number(item.avg_ship)).toFixed(2) }
                  </td>
                  <td className="px-4 py-3 text-center font-bold text-amber-600 bg-amber-50/10 border border-slate-100">
                    {item.avg_smec}
                  </td>
                  <td className="px-4 py-3 text-center font-bold text-emerald-600 border border-slate-100">{item.avg_total}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-8 min-h-[600px]">
        {/* 左侧：长周期列表 */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 flex flex-col overflow-hidden h-[600px]">
          <div className="px-6 py-4 border-b border-gray-100 bg-gray-50/50 flex justify-between items-center">
            <h3 className="font-bold text-slate-700 text-lg">长周期预警清单 (Top 20)</h3>
            <span className="text-xs bg-red-100 text-red-600 px-2 py-1 rounded-full font-medium">
              {stats.longCycleList.length} 条
            </span>
          </div>
          
          <div className="flex-1 overflow-y-auto p-2 space-y-1 custom-scrollbar">
            {stats.longCycleList.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-slate-400 gap-2">
                <div className="p-3 bg-slate-50 rounded-full">🎉</div>
                <p>本月无超过20天的长周期工单</p>
              </div>
            ) : (
              stats.longCycleList.map(item => (
                <div 
                  key={item.id} 
                  className={`p-4 rounded-lg cursor-pointer transition-all border border-transparent hover:border-blue-100 hover:bg-blue-50/50 group
                    ${selectedDetail?.cycle?.serial_number === item.serial_number ? 'bg-blue-50 border-blue-200 shadow-sm ring-1 ring-blue-200' : 'bg-white'}`}
                  onClick={() => fetchDetail(item.serial_number)}
                >
                  <div className="flex justify-between items-start mb-2">
                    <span className="font-semibold text-slate-700 group-hover:text-blue-700 transition-colors">{item.serial_number}</span>
                    <span className="bg-red-50 text-red-600 text-xs font-bold px-2 py-0.5 rounded">
                      {item.total_cycle_time} 天
                    </span>
                  </div>
                  <div className="flex justify-between text-xs text-slate-500">
                    <span className="truncate max-w-[120px]">{item.department}</span>
                    <span className="truncate max-w-[120px]" title={item.customer_name}>{item.customer_name}</span>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* 右侧：详情卡片 */}
        <div className="xl:col-span-2 bg-white rounded-xl shadow-sm border border-gray-100 flex flex-col overflow-hidden h-[600px]">
          <div className="px-6 py-4 border-b border-gray-100 bg-gray-50/50 flex items-center justify-between">
            <h3 className="font-bold text-slate-700 text-lg">工单全景详情</h3>
            <div className="flex items-center gap-3">
              <input
                value={searchSerial}
                onChange={(e) => setSearchSerial(e.target.value)}
                placeholder="输入三包流水号查询"
                className="bg-white border border-gray-300 text-slate-700 py-1 px-3 rounded shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 sm:text-sm w-[220px]"
              />
              <button
                className="px-3 py-1 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700"
                onClick={() => { if (searchSerial.trim()) fetchDetail(searchSerial.trim()) }}
              >
                查询三包
              </button>
            </div>
          </div>
          
          <div className="flex-1 overflow-y-auto p-6 custom-scrollbar">
            {detailLoading ? (
              <div className="flex flex-col items-center justify-center h-full text-slate-400 gap-3">
                <Loader2 className="animate-spin text-blue-500" size={32} />
                <p>加载详情中...</p>
              </div>
            ) : selectedDetail ? (
              <div className="space-y-8">
                {/* 头部信息 */}
                <div className="flex items-start justify-between">
                  <div>
                    <h4 className="text-2xl font-bold text-slate-800 flex items-center gap-3">
                      {selectedDetail.cycle.serial_number}
                      <span className="text-base font-normal text-slate-500 px-3 py-1 bg-slate-100 rounded-full">
                        {selectedDetail.overviewList?.[0]?.customer_name || selectedDetail.cycle.customer_name}
                      </span>
                    </h4>
                  </div>
                  <span className="px-3 py-1 bg-blue-50 text-blue-600 text-sm font-medium rounded-full border border-blue-100">
                    {selectedDetail.cycle.material_type || '未知类型'}
                  </span>
                </div>
                
                {/* 物料清单表格 */}
                <div className="bg-slate-50 rounded-lg border border-slate-200 overflow-hidden">
                  <div className="px-4 py-2 bg-slate-100 border-b border-slate-200 text-xs font-semibold text-slate-500 uppercase tracking-wider">
                    关联物料清单
                  </div>
                  {selectedDetail.overviewList && selectedDetail.overviewList.length > 0 ? (
                    <table className="w-full text-sm">
                      <thead className="bg-white border-b border-slate-100">
                        <tr>
                          <th className="px-4 py-2 text-left font-medium text-slate-500">物料名称</th>
                          <th className="px-4 py-2 text-left font-medium text-slate-500">图号</th>
                          <th className="px-4 py-2 text-left font-medium text-slate-500">数量</th>
                          <th className="px-4 py-2 text-left font-medium text-slate-500">故障描述</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 bg-white">
                        {selectedDetail.overviewList.map((item, idx) => (
                          <tr key={idx}>
                            <td className="px-4 py-3 text-slate-700">{item.material_name}</td>
                            <td className="px-4 py-3 text-slate-600 font-mono text-xs">{item.drawing_number}</td>
                            <td className="px-4 py-3 text-slate-700">{item.warranty_count}</td>
                            <td className="px-4 py-3 text-slate-600 min-w-[200px] whitespace-normal leading-relaxed">
                              {item.fault_description}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  ) : (
                    <div className="p-4 text-center text-slate-400 text-sm italic">暂无详细物料信息</div>
                  )}
                </div>

                {/* 周期耗时分解 + 可视化 */}
                <div>
                  <h5 className="text-sm font-semibold text-slate-700 mb-3 flex items-center gap-2">
                    <Clock size={16} /> 周期耗时分解
                  </h5>
                  <div className="flex gap-4">
                    {[
                      { label: '总部制造发运', val: Number(selectedDetail.cycle.hq_dispatch_time) || 0, color: 'bg-orange-50 border-orange-100 text-orange-700' },
                      { label: '总部审核处置', val: Number(selectedDetail.cycle.hq_audit_time) || 0, color: 'bg-amber-50 border-amber-100 text-amber-700' },
                      { label: '分公司审核提交', val: Number(selectedDetail.cycle.branch_submit_time) || 0, color: 'bg-yellow-50 border-yellow-100 text-yellow-700' },
                      { label: '补充调查', val: Number(selectedDetail.cycle.supp_invest_time) || 0, color: 'bg-lime-50 border-lime-100 text-lime-700' },
                      { label: '分公司现场调查', val: Number(selectedDetail.cycle.branch_invest_time) || 0, color: 'bg-emerald-50 border-emerald-100 text-emerald-700' },
                      { label: '全周期总计', val: Number(selectedDetail.cycle.total_cycle_time) || 0, color: 'bg-slate-800 text-white shadow-lg', isTotal: true }
                    ].map((stage, i) => (
                      <div key={i} className={`flex-1 p-3 rounded-lg border text-center ${stage.color} ${stage.isTotal ? 'border-transparent' : ''}`}>
                        <div className={`text-xs mb-1 ${stage.isTotal ? 'text-slate-300' : 'text-slate-500'}`}>{stage.label}</div>
                        <div className="text-xl font-bold">{stage.val}<span className="text-xs font-normal ml-1">天</span></div>
                      </div>
                    ))}
                  </div>
                  <div className="mt-6">
                    <h6 className="text-sm font-semibold text-slate-700 mb-2">节点耗时可视化</h6>
                    <div className="h-[260px] bg-white rounded-lg border border-slate-200 p-4">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart
                          data={[
                            { name: '总部制造发运', value: Number(selectedDetail.cycle.hq_dispatch_time) || 0 },
                            { name: '总部审核处置', value: Number(selectedDetail.cycle.hq_audit_time) || 0 },
                            { name: '分公司审核提交', value: Number(selectedDetail.cycle.branch_submit_time) || 0 },
                            { name: '补充调查', value: Number(selectedDetail.cycle.supp_invest_time) || 0 },
                            { name: '分公司现场调查', value: Number(selectedDetail.cycle.branch_invest_time) || 0 }
                          ]}
                          margin={{ left: 10, right: 10, top: 10, bottom: 0 }}
                        >
                          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                          <XAxis dataKey="name" tick={{ fontSize: 12, fill: '#64748b' }} interval={0} angle={-20} dy={10} />
                          <YAxis tick={{ fontSize: 12, fill: '#64748b' }} unit="天" />
                          <Tooltip formatter={(v) => [`${v} 天`, '耗时']} />
                          <Legend />
                          <Bar dataKey="value" name="耗时" fill="#fb923c" radius={[4, 4, 0, 0]} />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                </div>

                {/* 处理日志流 */}
                <div>
                  <h5 className="text-sm font-semibold text-slate-700 mb-3 flex items-center gap-2">
                    <Activity size={16} /> 处理日志流
                  </h5>
                  <div className="space-y-4">
                    {(() => {
                      const msPerDay = 24 * 60 * 60 * 1000
                      const durations = selectedDetail.logs.map(l => {
                        const s = new Date(l.start_time)
                        const e = l.end_time && l.end_time !== '1970-01-01T00:00:00.000Z' ? new Date(l.end_time) : new Date()
                        const diff = (e.getTime() - s.getTime()) / msPerDay
                        return Math.max(diff, 0)
                      })
                      const maxDuration = Math.max(...durations, 0) || 1
                      return selectedDetail.logs.map((log, idx) => {
                        const start = new Date(log.start_time)
                        const end = log.end_time && log.end_time !== '1970-01-01T00:00:00.000Z' ? new Date(log.end_time) : new Date()
                        const d = Math.max((end.getTime() - start.getTime()) / msPerDay, 0)
                        const pct = Math.min((d / maxDuration) * 100, 100)
                        const badge =
                          idx === 0 ? 'bg-blue-100 text-blue-700' :
                          idx === selectedDetail.logs.length - 1 ? 'bg-emerald-100 text-emerald-700' :
                          'bg-slate-100 text-slate-700'
                        const iconBg =
                          idx === 0 ? 'bg-blue-50 text-blue-600' :
                          idx === selectedDetail.logs.length - 1 ? 'bg-emerald-50 text-emerald-600' :
                          'bg-slate-50 text-slate-600'
                        return (
                          <div key={idx} className="flex items-start gap-4">
                            <div className={`w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold ${iconBg}`}>
                              {idx + 1}
                            </div>
                            <div className="flex-1">
                              <div className="flex items-center gap-2">
                                <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${badge}`}>{log.node}</span>
                                <span className="text-xs font-mono text-slate-400 bg-slate-50 px-2 py-0.5 rounded">
                                  {start.toLocaleString()}
                                </span>
                                {d > 0 && (
                                  <span className="ml-auto text-xs bg-blue-50 text-blue-600 px-2 py-0.5 rounded-full">
                                    耗时 {d.toFixed(1)} 天
                                  </span>
                                )}
                              </div>
                              <div className="mt-1 text-sm text-slate-700 flex items-center gap-2">
                                <span className="w-6 h-6 rounded-full bg-slate-100 flex items-center justify-center text-xs font-bold text-slate-500">
                                  {log.person_name?.[0]}
                                </span>
                                {log.person_name}
                              </div>
                              {d > 0 && (
                                <div className="mt-2 w-full h-2 bg-slate-100 rounded-full overflow-hidden">
                                  <div className="h-full bg-blue-500 rounded-full" style={{ width: `${pct}%` }}></div>
                                </div>
                              )}
                            </div>
                          </div>
                        )
                      })
                    })()}
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center h-full text-slate-300 gap-4">
                <div className="w-16 h-16 bg-slate-50 rounded-full flex items-center justify-center">
                  <FileText size={32} />
                </div>
                <p>请点击左侧列表查看工单详情</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
