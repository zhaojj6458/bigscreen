import { BrowserRouter, Routes, Route } from 'react-router-dom'
import Layout from './layout/Layout'
import Dashboard from './pages/Dashboard'
import UploadPage from './pages/Upload'
import MonthlyAnalysis from './pages/MonthlyAnalysis'

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Layout />}>
          <Route index element={<Dashboard />} />
          <Route path="analysis" element={<MonthlyAnalysis />} />
          <Route path="upload" element={<UploadPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}

export default App
