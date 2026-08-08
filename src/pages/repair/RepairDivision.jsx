import { useState, useEffect } from 'react'
import { supabase } from '../../supabase'
import { Toaster } from 'react-hot-toast'
import Logo from '../../components/Logo'

import RepairDashboard from './RepairDashboard'
import RepairJobs from './RepairJobs'
import RepairJobDetail from './RepairJobDetail'
import RepairInventory from './RepairInventory'
import RepairPurchases from './RepairPurchases'
import RepairSales from './RepairSales'
import RepairExpenses from './RepairExpenses'
import RepairCash from './RepairCash'
import RepairCustomers from './RepairCustomers'
import RepairThirdParty from './RepairThirdParty'
import RepairReports from './RepairReports'
import RepairAnalytics from './RepairAnalytics'
import RepairSettings from './RepairSettings'
import RepairOpeningBalances from './RepairOpeningBalances'
import RepairWarrantyClaims from './RepairWarrantyClaims'

const MENU = [
  { id: 'dashboard', icon: '⊞', label: 'Dashboard' },
  { id: 'jobs', icon: '🔧', label: 'Repair Jobs' },
  { id: 'inventory', icon: '📦', label: 'Repair Inventory' },
  { id: 'purchases', icon: '🧾', label: 'Purchases' },
  { id: 'sales', icon: '🛒', label: 'Parts Sales' },
  { id: 'customers', icon: '👥', label: 'Customers' },
  { id: 'third_party', icon: '🔗', label: '3rd Party Items' },
  { id: 'expenses', icon: '📝', label: 'Expenses' },
  { id: 'cash', icon: '💰', label: 'Cash & Deposits' },
  { id: 'analytics', icon: '📊', label: 'Analytics' },
  { id: 'reports', icon: '📄', label: 'Reports' },
  { id: 'settings', icon: '⚙️', label: 'Settings' },
  { id: 'opening_balances', icon: '🔢', label: 'Opening Balances' },
  { id: 'warranty_claims', icon: '🛡️', label: 'Warranty Claims' },
]

export default function RepairDivision({ session, activeShop, isSuperAdmin, onExit }) {
  const [activePage, setActivePage] = useState(() => localStorage.getItem('iphix_repair_active_page') || 'dashboard')
  const [selectedJobId, setSelectedJobId] = useState(null)
  const [loggingOut, setLoggingOut] = useState(false)

  useEffect(() => {
    localStorage.setItem('iphix_repair_active_page', activePage)
  }, [activePage])

  function navigateTo(page) {
    setActivePage(page)
    if (page !== 'job_detail') setSelectedJobId(null)
  }

  function openJob(jobId) {
    setSelectedJobId(jobId)
    setActivePage('job_detail')
  }

  async function handleLogout() {
    setLoggingOut(true)
    await supabase.auth.signOut()
    setLoggingOut(false)
  }

  function renderPage() {
    switch (activePage) {
      case 'dashboard': return <RepairDashboard shop={activeShop} onOpenJob={openJob} navigateTo={navigateTo} />
      case 'jobs': return <RepairJobs shop={activeShop} onOpenJob={openJob} />
      case 'job_detail': return <RepairJobDetail jobId={selectedJobId} shop={activeShop} onBack={() => navigateTo('jobs')} />
      case 'inventory': return <RepairInventory shop={activeShop} />
      case 'purchases': return <RepairPurchases shop={activeShop} />
      case 'sales': return <RepairSales shop={activeShop} />
      case 'customers': return <RepairCustomers shop={activeShop} onOpenJob={openJob} />
      case 'third_party': return <RepairThirdParty shop={activeShop} />
      case 'expenses': return <RepairExpenses shop={activeShop} />
      case 'cash': return <RepairCash shop={activeShop} />
      case 'analytics': return <RepairAnalytics shop={activeShop} />
      case 'reports': return <RepairReports shop={activeShop} />
      case 'settings': return <RepairSettings shop={activeShop} />
      case 'opening_balances': return <RepairOpeningBalances shop={activeShop} />
      case 'warranty_claims': return <RepairWarrantyClaims shop={activeShop} />
      default: return <RepairDashboard shop={activeShop} onOpenJob={openJob} navigateTo={navigateTo} />
    }
  }

  return (
    <div style={{ display: 'flex', minHeight: '100vh', background: '#fdf8f3', fontFamily: 'system-ui, -apple-system, sans-serif' }}>
      <Toaster position="top-right" />

      {/* Sidebar — warm amber/charcoal identity, distinct from retail's navy/blue */}
      <div style={{ width: '244px', minHeight: '100vh', background: 'linear-gradient(180deg, #1c1917 0%, #2a1f14 100%)', display: 'flex', flexDirection: 'column', position: 'fixed', left: 0, top: 0, bottom: 0, zIndex: 100 }}>
        <div style={{ padding: '22px 18px', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '11px' }}>
            <Logo size={36} />
            <div>
              <div style={{ color: 'white', fontWeight: '700', fontSize: '15px', letterSpacing: '-0.01em' }}>iPHIX Technologies</div>
              <div style={{ color: '#f0b23d', fontSize: '11px', fontWeight: '700', letterSpacing: '0.04em' }}>🔧 REPAIR DIVISION</div>
            </div>
          </div>
        </div>

        <nav style={{ flex: 1, padding: '14px 10px', overflowY: 'auto' }}>
          {MENU.map(item => {
            const isActive = activePage === item.id || (item.id === 'jobs' && activePage === 'job_detail')
            return (
              <button key={item.id} onClick={() => navigateTo(item.id)}
                style={{ width: '100%', display: 'flex', alignItems: 'center', gap: '10px', padding: '9px 12px', borderRadius: '9px', border: 'none', cursor: 'pointer', marginBottom: '2px', background: isActive ? 'linear-gradient(135deg, #f0b23d, #d4881f)' : 'transparent', color: isActive ? '#1c1917' : '#d6c7b3', fontSize: '13px', fontWeight: isActive ? '700' : '400', textAlign: 'left', boxShadow: isActive ? '0 4px 12px rgba(240,178,61,0.3)' : 'none', transition: 'background 0.12s, color 0.12s' }}
                onMouseEnter={e => { if (!isActive) { e.currentTarget.style.background = 'rgba(255,255,255,0.06)'; e.currentTarget.style.color = 'white' } }}
                onMouseLeave={e => { if (!isActive) { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = '#d6c7b3' } }}>
                <span style={{ fontSize: '15px' }}>{item.icon}</span>
                {item.label}
              </button>
            )
          })}
        </nav>

        <div style={{ padding: '16px', borderTop: '1px solid rgba(255,255,255,0.08)' }}>
          <button onClick={onExit}
            style={{ width: '100%', padding: '9px', background: 'rgba(255,255,255,0.06)', color: '#d6c7b3', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '9px', cursor: 'pointer', fontSize: '13px', fontWeight: '600', marginBottom: '10px' }}>
            ← Back to Retail System
          </button>

          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '10px' }}>
            <div style={{ width: '32px', height: '32px', borderRadius: '50%', background: 'linear-gradient(135deg, #f0b23d, #d4881f)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#1c1917', fontWeight: '700', fontSize: '13px', flexShrink: 0 }}>
              {session.user.email[0].toUpperCase()}
            </div>
            <div style={{ overflow: 'hidden' }}>
              <div style={{ color: 'white', fontSize: '13px', fontWeight: '500', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{session.user.email}</div>
              <div style={{ color: '#a89478', fontSize: '11px' }}>{isSuperAdmin ? 'Super Admin' : activeShop?.name}</div>
            </div>
          </div>
          <button onClick={handleLogout} disabled={loggingOut}
            style={{ width: '100%', padding: '9px', background: 'rgba(239,68,68,0.14)', color: '#f87171', border: '1px solid rgba(239,68,68,0.2)', borderRadius: '9px', cursor: 'pointer', fontSize: '13px', fontWeight: '500' }}>
            {loggingOut ? 'Signing out...' : '⏻ Sign Out'}
          </button>
        </div>
      </div>

      {/* Main content */}
      <div style={{ marginLeft: '244px', flex: 1, padding: '32px' }}>
        {renderPage()}
      </div>
    </div>
  )
}
