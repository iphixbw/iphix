import { useState, useEffect, Component } from 'react'
import { supabase } from './supabase'
import Login from './pages/Login'
import AttendancePage from './pages/hr/AttendancePage'
import ShopSelector from './pages/ShopSelector'
import Dashboard from './pages/Dashboard'
import RepairDivision from './pages/repair/RepairDivision'
import { SUPER_ADMIN_EMAIL } from './lib/config'

class ErrorBoundary extends Component {
  constructor(props) { super(props); this.state = { hasError: false, error: null } }
  static getDerivedStateFromError(error) { return { hasError: true, error } }
  componentDidCatch(error, info) { console.error('App error:', error, info) }
  render() {
    if (this.state.hasError) return (
      <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', fontFamily: 'system-ui, -apple-system, sans-serif', background: '#f8fafc', padding: '40px' }}>
        <div style={{ background: 'white', borderRadius: '16px', padding: '40px', maxWidth: '480px', width: '100%', boxShadow: '0 4px 24px rgba(0,0,0,0.08)', textAlign: 'center' }}>
          <div style={{ fontSize: '48px', marginBottom: '16px' }}>⚠️</div>
          <h2 style={{ fontSize: '20px', fontWeight: '700', color: '#0f172a', margin: '0 0 8px' }}>Something went wrong</h2>
          <p style={{ fontSize: '14px', color: '#64748b', margin: '0 0 24px' }}>An unexpected error occurred. Your data is safe.</p>
          <div style={{ background: '#f1f5f9', borderRadius: '10px', padding: '12px', marginBottom: '24px', textAlign: 'left' }}>
            <code style={{ fontSize: '12px', color: '#e11d48', wordBreak: 'break-all' }}>{this.state.error?.message || 'Unknown error'}</code>
          </div>
          <button onClick={() => { this.setState({ hasError: false, error: null }); window.location.reload() }}
            style={{ padding: '12px 28px', background: 'linear-gradient(135deg,#2563eb,#1d4ed8)', color: 'white', border: 'none', borderRadius: '10px', cursor: 'pointer', fontWeight: '700', fontSize: '15px' }}>
            Reload App
          </button>
        </div>
      </div>
    )
    return this.props.children
  }
}


function App() {
  const [session, setSession] = useState(null)
  const [activeShop, setActiveShop] = useState(null)
  const [loading, setLoading] = useState(true)
  const [inRepairDivision, setInRepairDivision] = useState(() => localStorage.getItem('iphix_in_repair_division') === 'true')

  useEffect(() => {
    localStorage.setItem('iphix_in_repair_division', String(inRepairDivision))
  }, [inRepairDivision])

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session)
      setLoading(false)
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session)
      if (!session) setActiveShop(null)
    })

    return () => subscription.unsubscribe()
  }, [])

  // Public attendance link: /attendance/<staffId>
  const attendanceMatch = window.location.pathname.match(/^\/attendance\/([\w-]+)$/)
  if (attendanceMatch) {
    return <AttendancePage staffId={attendanceMatch[1]} />
  }

  if (loading) return (
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh', fontSize: '18px', fontFamily: 'system-ui, -apple-system, sans-serif', color: '#64748b' }}>
      Loading...
    </div>
  )

  if (!session) return <Login />

  // Super admin skips shop selection entirely
  const isSuperAdmin = session.user.email === SUPER_ADMIN_EMAIL
  if (!isSuperAdmin && !activeShop) {
    return <ShopSelector session={session} onShopSelected={setActiveShop} />
  }

  return (
    <ErrorBoundary>
      {inRepairDivision ? (
        <RepairDivision
          session={session}
          activeShop={activeShop}
          isSuperAdmin={isSuperAdmin}
          onExit={() => setInRepairDivision(false)}
        />
      ) : (
        <Dashboard
          session={session}
          activeShop={activeShop}
          isSuperAdmin={isSuperAdmin}
          onShopChange={isSuperAdmin ? null : () => setActiveShop(null)}
          onEnterRepairDivision={() => setInRepairDivision(true)}
        />
      )}
    </ErrorBoundary>
  )
}

export default App
