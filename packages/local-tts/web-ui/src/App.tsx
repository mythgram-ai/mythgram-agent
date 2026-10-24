import { NavLink, Route, Routes, useNavigate } from 'react-router-dom'
import StudioPage from './pages/StudioPage'
import VoicesPage from './pages/VoicesPage'
import LogsPage from './pages/LogsPage'
import ApiPage from './pages/ApiPage'
import ApiDocsPage from './pages/ApiDocsPage'
import { useBackendAlive } from './lib/hooks'
import { IconBook, IconChip, IconScript, IconServer, IconSliders, IconWave } from './components/icons'

function Sidebar() {
  const navigate = useNavigate()
  const alive = useBackendAlive()

  return (
    <nav className="sidebar">
      <div className="brand" onClick={() => navigate('/')} style={{ cursor: 'pointer' }}>
        <span className="brand-mark">
          <IconWave size={17} />
        </span>
        <span>
          <div className="brand-name">Piper Studio</div>
          <div className="brand-sub">local speech synthesis</div>
        </span>
      </div>

      <div className="nav-label">Workspace</div>
      <NavLink to="/" end className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}>
        <span className="nav-ico"><IconWave size={16} /></span>
        Speech studio
      </NavLink>
      <NavLink to="/voices" className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}>
        <span className="nav-ico"><IconSliders size={16} /></span>
        Voices &amp; setup
      </NavLink>
      <NavLink to="/logs" className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}>
        <span className="nav-ico"><IconScript size={16} /></span>
        Logs
      </NavLink>

      <div className="nav-label">Interface</div>
      <NavLink to="/voice-api" className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}>
        <span className="nav-ico"><IconServer size={16} /></span>
        API access
      </NavLink>
      <NavLink to="/voice-api/docs" className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}>
        <span className="nav-ico"><IconBook size={16} /></span>
        API docs
      </NavLink>

      <div className="sidebar-foot">
        <div className={`backend-chip${alive ? ' ok' : ''}`}>
          <span className="dot" />
          {alive ? 'backend live' : 'backend offline'}
          <span className="meta">
            <IconChip size={11} /> :7878
          </span>
        </div>
      </div>
    </nav>
  )
}

export default function App() {
  return (
    <div className="shell">
      <Sidebar />
      <main className="content">
        <Routes>
          <Route path="/" element={<StudioPage />} />
          <Route path="/voices" element={<VoicesPage />} />
          <Route path="/logs" element={<LogsPage />} />
          <Route path="/voice-api" element={<ApiPage />} />
          <Route path="/voice-api/docs" element={<ApiDocsPage />} />
          <Route path="*" element={<StudioPage />} />
        </Routes>
      </main>
    </div>
  )
}
