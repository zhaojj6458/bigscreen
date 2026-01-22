import { Link, Outlet, useLocation } from 'react-router-dom'
import { LayoutDashboard, Upload, CalendarDays } from 'lucide-react'
import { useState } from 'react'

export default function Layout() {
  const location = useLocation()
  const [isSidebarOpen, setIsSidebarOpen] = useState(false)
  
  const isActive = (path) => location.pathname === path 
    ? 'bg-gray-100 text-gray-900 shadow-sm' 
    : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'

  return (
    <div className="flex h-screen bg-gray-50 overflow-hidden font-sans">
      {/* Sidebar - Fixed position to overlay content, not push it */}
      <aside 
        onMouseEnter={() => setIsSidebarOpen(true)}
        onMouseLeave={() => setIsSidebarOpen(false)}
        className={`fixed left-0 top-0 bottom-0 z-20 transition-all duration-300 flex flex-col bg-white border-r border-gray-200 shadow-sm ${
          isSidebarOpen ? 'w-64' : 'w-16'
        }`}
      >
        <div className="h-16 flex items-center px-4 border-b border-gray-200">
          {isSidebarOpen && <h2 className="font-bold text-lg tracking-tight text-gray-900">TR 数据大屏</h2>}
        </div>

        <nav className="flex-1 py-4 px-2 space-y-2">
          <Link to="/" className={`relative flex items-center gap-3 px-3 py-3 rounded-lg transition-all duration-200 group ${isActive('/')}`}>
            <LayoutDashboard size={20} className="shrink-0" />
            {isSidebarOpen && <span className="font-medium">数据看板</span>}
            {!isSidebarOpen && (
              <div className="absolute left-16 bg-gray-900 text-white px-3 py-1 rounded text-xs opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity z-50 whitespace-nowrap shadow">
                数据看板
              </div>
            )}
          </Link>
          
          <Link to="/analysis" className={`relative flex items-center gap-3 px-3 py-3 rounded-lg transition-all duration-200 group ${isActive('/analysis')}`}>
            <CalendarDays size={20} className="shrink-0" />
            {isSidebarOpen && <span className="font-medium">月度分析</span>}
            {!isSidebarOpen && (
              <div className="absolute left-16 bg-gray-900 text-white px-3 py-1 rounded text-xs opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity z-50 whitespace-nowrap shadow">
                月度分析
              </div>
            )}
          </Link>
          
          <Link to="/upload" className={`relative flex items-center gap-3 px-3 py-3 rounded-lg transition-all duration-200 group ${isActive('/upload')}`}>
            <Upload size={20} className="shrink-0" />
            {isSidebarOpen && <span className="font-medium">数据上传</span>}
            {!isSidebarOpen && (
              <div className="absolute left-16 bg-gray-900 text-white px-3 py-1 rounded text-xs opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity z-50 whitespace-nowrap shadow">
                数据上传
              </div>
            )}
          </Link>
        </nav>

        <div className="p-4 border-t border-gray-200">
          {isSidebarOpen ? (
            <div className="text-xs text-gray-500 text-center">
              © 2026 TR Data System
            </div>
          ) : (
            <div className="w-2 h-2 bg-gray-400 rounded-full mx-auto animate-pulse"></div>
          )}
        </div>
      </aside>
      
      {/* Main Content - Fixed margin-left to accommodate sidebar */}
      <main className="flex-1 overflow-auto ml-16">
        {/* Top Header/Breadcrumb area could go here */}
        <div className="p-8 max-w-[1600px] mx-auto">
          <Outlet />
        </div>
      </main>
    </div>
  )
}