import { useState, useEffect } from 'react'
import { supabase } from '../supabase'
import { Toaster } from 'react-hot-toast'
import { formatCurrency } from '../lib/helpers'
import Logo from '../components/Logo'
import Customers from './billing/Customers'
import Salesmen from './billing/Salesmen'
import NewInvoice from './billing/NewInvoice'
import InvoiceList from './billing/InvoiceList'
import InvoiceView from './billing/InvoiceView'
import Items from './billing/Items'
import Settings from './Settings'
import Suppliers from './purchases/Suppliers'
import CombinedAccounts from './finance/CombinedAccounts'
import Lending from './finance/Lending'
import PurchaseList from './purchases/PurchaseList'
import NewPurchase from './purchases/NewPurchase'
import Inventory from './purchases/Inventory'
import StockTransfer from './purchases/StockTransfer'
import Cashflow from './finance/Cashflow'
import Bank from './finance/Bank'
import Expenses from './finance/Expenses'
import SalesReturns from './billing/SalesReturns'
import WarrantyClaims from './billing/WarrantyClaims'
import EndOfShift from './finance/EndOfShift'
import Reports from './reports/Reports'
import PurchaseReturns from './purchases/PurchaseReturns'
import SMSCentre from './sms/SMSCentre'
import ProcurementInbox from './procurement/ProcurementInbox'
import OpeningBalances from './admin/OpeningBalances'
import Investors from './investors/Investors'
import HRModule from './hr/HRModule'

export default function Dashboard({ session, activeShop, isSuperAdmin, onShopChange, onEnterRepairDivision }) {
  const [loggingOut, setLoggingOut] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [activePage, setActivePage] = useState(() => {
    const saved = localStorage.getItem('iphix_active_page')
    // Don't restore transient pages that require context
    const transient = ['new_invoice', 'view_invoice', 'new_purchase', 'finance_invoice_pl']
    if (!saved || transient.includes(saved)) return 'dashboard'
    return saved  // Role validation happens after userRole loads — see useEffect below
  })
  const [selectedInvoice, setSelectedInvoice] = useState(null)
  const [invoiceReturnPage, setInvoiceReturnPage] = useState('billing')
  const [dashStats, setDashStats] = useState({ todaySales: 0, todayCount: 0, todayCash: 0, todayCashCount: 0, todayCredit: 0, todayCreditCount: 0, todayCollected: 0, todayCollectedCount: 0, outstanding: 0, outstandingCount: 0, drafts: 0, recentInvoices: [], lowStockItems: [] })
  const [allShops, setAllShops] = useState([])
  const [analytics, setAnalytics] = useState({ salesTrend: [], topItems: [], topCustomers: [], paymentMix: [], salesmanPerf: [] })
  const [userRole, setUserRole] = useState(null)

  // Super admin always has full access regardless of profile role
  // For other users: fetch from user_profiles, default to 'admin' if no profile found
  const effectiveRole = isSuperAdmin ? 'admin' : (userRole || 'admin')
  const isCashier = effectiveRole === 'cashier'

  useEffect(() => {
    supabase.from('shops').select('*').order('name').then(({ data }) => setAllShops(data || []))
    if (isSuperAdmin) {
      setUserRole('admin')
      return
    }
    supabase.from('user_profiles').select('role').eq('id', session.user.id).single()
      .then(({ data }) => {
        const role = data?.role || 'admin'
        setUserRole(role)
        // Validate restored page against role — cashiers can't access admin-only pages
        if (role === 'cashier') {
          const cashierPages = ['billing', 'new_invoice', 'view_invoice', 'customers', 'items', 'returns', 'stock', 'expenses', 'endshift']
          const saved = localStorage.getItem('iphix_active_page')
          if (!saved || !cashierPages.includes(saved)) {
            localStorage.setItem('iphix_active_page', 'billing')
            setActivePage('billing')
          }
        }
      })
  }, [session.user.id, isSuperAdmin])

  useEffect(() => {
    // Don't fetch until userRole has actually loaded — avoids showing wrong totals on first render
    if (userRole === null) return
    if (activePage === 'dashboard') { fetchDashStats(); fetchAnalytics() }
  }, [activePage, activeShop?.id, userRole])

  async function fetchDashStats() {
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    // Use the actual resolved role — not the defaulted one
    const resolvedCashier = (isSuperAdmin ? false : userRole === 'cashier')
    const shopScope = resolvedCashier ? activeShop : null

    // Build queries — scope to shop if cashier
    let todayQ = supabase.from('invoices').select('total, payment_method, amount_paid, credit_amount').gte('created_at', today.toISOString()).eq('status', 'confirmed')
    let recentQ = supabase.from('invoices').select('*, customers(name, customer_no), salesmen(name)').order('created_at', { ascending: false }).limit(5)
    if (shopScope?.id) {
      todayQ = todayQ.eq('shop_id', shopScope.id)
      recentQ = recentQ.eq('shop_id', shopScope.id)
    }

    // Outstanding = sum of customers.credit_balance, which Customers.jsx keeps reconciled
    // (opening balance + credit invoices − payments − credit returns) — the single source of truth.
    // Note: customers has no shop_id column, so this figure is company-wide, not shop-scoped —
    // matching how the previous opening-balance component of this stat already behaved.
    const openingBalQ = supabase.from('customers').select('credit_balance').gt('credit_balance', 0)

    const lowStockQ = supabase.from('items').select('id, name, stock_quantity, reorder_level').not('reorder_level', 'is', null).gt('reorder_level', 0)
    let pmtQ = supabase.from('invoice_payments').select('amount').gte('created_at', today.toISOString())
    if (shopScope?.id) pmtQ = pmtQ.eq('invoices.shop_id', shopScope.id)

    const [{ data: todayInvs }, { data: recentInvs }, { data: lowStockData }, { data: openingBalCustomers }, { data: todayPmts }] = await Promise.all([
      todayQ, recentQ, lowStockQ, openingBalQ, pmtQ,
    ])

    const todaySales = (todayInvs || []).reduce((s, i) => s + (i.total || 0), 0)
    const cashInvs = (todayInvs || []).filter(i => i.payment_method !== 'credit')
    const creditInvs = (todayInvs || []).filter(i => i.payment_method === 'credit' || (i.credit_amount || 0) > 0)
    const todayCash = cashInvs.reduce((s, i) => s + (i.amount_paid || 0), 0)
    const todayCredit = creditInvs.reduce((s, i) => s + (i.credit_amount || 0), 0)
    const outstanding = (openingBalCustomers || []).reduce((s, c) => s + (c.credit_balance || 0), 0)
    const drafts = (recentInvs || []).filter(i => i.status === 'draft').length

    const lowStockItems = (lowStockData || []).filter(i => (i.stock_quantity || 0) <= i.reorder_level)
    const todayCollected = (todayPmts || []).reduce((s, p) => s + (p.amount || 0), 0)
    const todayCollectedCount = (todayPmts || []).length
    setDashStats({
      todaySales,
      todayCount: (todayInvs || []).length,
      todayCash,
      todayCashCount: cashInvs.length,
      todayCredit,
      todayCreditCount: creditInvs.length,
      todayCollected,
      todayCollectedCount,
      outstanding,
      outstandingCount: (openingBalCustomers || []).length,
      drafts,
      recentInvoices: (recentInvs || []).filter(i => i.status !== 'draft').slice(0, 5),
      lowStockItems,
    })
  }


  async function fetchAnalytics() {
    const now = new Date()
    const day = n => { const d = new Date(now); d.setDate(d.getDate() - n); d.setHours(0,0,0,0); return d.toISOString() }
    const { data: trendData } = await supabase.from('invoices').select('total, created_at').eq('status','confirmed').gte('created_at', day(13)).order('created_at')
    const { data: itemData } = await supabase.from('invoice_items').select('item_id, quantity, items(name)').gte('created_at', day(29))
    const { data: custData } = await supabase.from('invoices').select('total, customers(name)').eq('status','confirmed').gte('created_at', day(29)).not('customers', 'is', null)
    const { data: pmtData } = await supabase.from('invoices').select('payment_method, total').eq('status','confirmed').gte('created_at', day(29))
    const { data: salesmanData } = await supabase.from('invoices').select('total, salesmen(name)').eq('status','confirmed').gte('created_at', day(29)).not('salesmen', 'is', null)
    const salesTrend = []
    for (let i = 13; i >= 0; i--) {
      const d = new Date(now); d.setDate(d.getDate() - i); d.setHours(0,0,0,0)
      const next = new Date(d); next.setDate(next.getDate() + 1)
      const label = d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })
      const total = (trendData||[]).filter(r => { const t = new Date(r.created_at); return t >= d && t < next }).reduce((s,r) => s+(r.total||0), 0)
      salesTrend.push({ label, total })
    }
    const itemMap = {}
    ;(itemData||[]).forEach(r => { const n=r.items?.name||'?'; itemMap[n]=(itemMap[n]||0)+(r.quantity||0) })
    const topItems = Object.entries(itemMap).sort((a,b)=>b[1]-a[1]).slice(0,8).map(([name,qty])=>({name,qty}))
    const custMap = {}
    ;(custData||[]).forEach(r => { const n=r.customers?.name; if(!n||n==='Cash Customer') return; custMap[n]=(custMap[n]||0)+(r.total||0) })
    const topCustomers = Object.entries(custMap).sort((a,b)=>b[1]-a[1]).slice(0,6).map(([name,total])=>({name,total}))
    const pmtMap = {}
    ;(pmtData||[]).forEach(r => { const m=r.payment_method||'cash'; pmtMap[m]=(pmtMap[m]||0)+(r.total||0) })
    const pmtTotal = Object.values(pmtMap).reduce((s,v)=>s+v,0)
    const pmtColors = { cash:'#059669',card:'#0891b2',cheque:'#7c3aed',credit:'#e11d48',bank_transfer:'#f59e0b',partial:'#2563eb' }
    const pmtLabels = { cash:'Cash',card:'Card',cheque:'Cheque',credit:'Credit',bank_transfer:'Bank Transfer',partial:'Partial' }
    const paymentMix = Object.entries(pmtMap).sort((a,b)=>b[1]-a[1]).map(([m,v])=>({ method:pmtLabels[m]||m, total:v, pct:pmtTotal>0?(v/pmtTotal*100).toFixed(1):0, color:pmtColors[m]||'#94a3b8' }))
    const salesmanMap = {}
    ;(salesmanData||[]).forEach(r => { const n=r.salesmen?.name; if(!n) return; salesmanMap[n]=(salesmanMap[n]||0)+(r.total||0) })
    const salesmanTotal = Object.values(salesmanMap).reduce((s,v)=>s+v,0)
    const sc = ['#1e40af','#059669','#e11d48','#d97706','#0891b2','#7c3aed','#0369a1']
    const salesmanPerf = Object.entries(salesmanMap).sort((a,b)=>b[1]-a[1]).slice(0,6).map(([name,total],i)=>({ name, total, pct:salesmanTotal>0?(total/salesmanTotal*100).toFixed(1):0, color:sc[i%sc.length] }))
    setAnalytics({ salesTrend, topItems, topCustomers, paymentMix, salesmanPerf })
  }

  function navigateTo(page) {
    localStorage.setItem('iphix_active_page', page)
    setActivePage(page)
    setSidebarOpen(false)
  }

  const handleLogout = async () => {
    setLoggingOut(true)
    localStorage.removeItem('iphix_active_page')
    await supabase.auth.signOut()
  }

  // All menu items — filtered by role below
  const allMenuItems = [
    { id: 'billing',          icon: '🧾', label: 'Billing',          section: 'SALES',    roles: ['all'] },
    { id: 'customers',        icon: '👥', label: 'Customers',        section: 'SALES',    roles: ['all'] },
    { id: 'salesmen',         icon: '👤', label: 'Salesmen',         section: 'SALES',    roles: ['admin', 'manager'] },
    { id: 'items',            icon: '📦', label: 'Items',            section: 'SALES',    roles: ['all'] },
    { id: 'returns',          icon: '↩️', label: 'Sales Returns',    section: 'SALES',    roles: ['all'] },
    { id: 'warranty_claims',  icon: '🛡️', label: 'Warranty Claims',  section: 'SALES',    roles: ['all'] },
    { id: 'inventory',        icon: '🛒', label: 'Purchases',        section: 'STOCK',    roles: ['admin', 'manager'] },
    { id: 'purchase_returns', icon: '🔄', label: 'Purchase Returns', section: 'STOCK',    roles: ['admin', 'manager'] },
    { id: 'stock',            icon: '📦', label: 'Inventory',        section: 'STOCK',    roles: ['all'] },
    { id: 'stock_transfer',   icon: '🔀', label: 'Stock Transfer',   section: 'STOCK',    roles: ['admin', 'manager'] },
    { id: 'suppliers',        icon: '🏭', label: 'Suppliers',        section: 'STOCK',    roles: ['admin', 'manager'] },
    { id: 'combined_accounts', icon: '⇄', label: 'Combined Accounts', section: 'FINANCE',  roles: ['admin', 'manager'] },
    { id: 'lending',          icon: '🤝', label: 'Personal Lending',  section: 'FINANCE',  roles: ['admin', 'manager'] },
    { id: 'procurement',      icon: '🏪', label: '3rd Party',        section: 'STOCK',    roles: ['admin', 'manager'] },
    { id: 'cashflow',         icon: '💵', label: 'Cashflow',         section: 'FINANCE',  roles: ['admin', 'manager'] },
    { id: 'bank',             icon: '🏦', label: 'Bank',             section: 'FINANCE',  roles: ['admin', 'manager'] },
    { id: 'expenses',         icon: '📝', label: 'Expenses',         section: 'FINANCE',  roles: ['all'] },
    { id: 'endshift',         icon: '🔒', label: 'End of Shift',     section: 'FINANCE',  roles: ['all'] },
    { id: 'reports',          icon: '📊', label: 'Reports',          section: 'REPORTS',  roles: ['admin', 'manager'] },
    { id: 'sms',              icon: '💬', label: 'SMS Centre',       section: 'REPORTS',  roles: ['admin', 'manager'] },
    { id: 'investors',        icon: '💼', label: 'Investors',        section: 'REPORTS',  roles: ['admin'] },
    { id: 'settings',         icon: '⚙️', label: 'Settings',         section: 'SETTINGS', roles: ['admin'] },
    { id: 'hr',               icon: '👨‍💼', label: 'HR',               section: 'SETTINGS', roles: ['admin'] },
    { id: 'opening_balances', icon: '🔢', label: 'Opening Balances',  section: 'SETTINGS', roles: ['admin'] },
  ]

  const menuItems = allMenuItems.filter(item =>
    item.roles.includes('all') || !isCashier
  )

  // Only show sections that have at least one visible item
  const allSections = ['SALES', 'STOCK', 'FINANCE', 'REPORTS', 'SETTINGS']
  const sections = allSections.filter(sec => menuItems.some(m => m.section === sec))

  function openInvoice(inv, returnPage = 'billing') {
    setSelectedInvoice(inv)
    setInvoiceReturnPage(returnPage)
    navigateTo('view_invoice')
  }

  const isActive = (id) =>
    activePage === id ||
    (activePage === 'new_invoice' && id === 'billing') ||
    (activePage === 'view_invoice' && id === 'billing') ||
    (activePage === 'new_purchase' && id === 'inventory') ||
    (activePage === 'finance_invoice_pl' && id === 'reports')

  const statusColors = {
    draft: { bg: '#fef3c7', color: '#92400e' },
    confirmed: { bg: '#dcfce7', color: '#166534' },
    cancelled: { bg: '#fee2e2', color: '#991b1b' },
  }

  const paymentLabels = {
    cash: 'Cash', card: 'Card', cheque: 'Cheque',
    bank_transfer: 'Bank Transfer', credit: 'Credit', partial: 'Partial'
  }

  function renderPage() {
    // For cashiers: pass activeShop to scope data to their shop
    // For super admin / no shop: pass null so all data shows
    const shopScope = isCashier ? activeShop : null

    switch (activePage) {
      case 'billing':
        return <InvoiceList onNewInvoice={() => navigateTo('new_invoice')} onOpenInvoice={openInvoice} activeShop={shopScope} />
      case 'new_invoice':
        return <NewInvoice onBack={() => navigateTo('billing')} activeShop={activeShop} isCashier={isCashier} session={session} />
      case 'view_invoice':
        return <InvoiceView key={selectedInvoice?.id} invoice={selectedInvoice} isCashier={isCashier} session={session} onBack={() => { setSelectedInvoice(null); navigateTo(invoiceReturnPage) }} />
      case 'customers': return <Customers activeShop={shopScope} isSuperAdmin={isSuperAdmin} />
      case 'salesmen': return <Salesmen />
      case 'items': return <Items isCashier={isCashier} />
      case 'settings': return <Settings session={session} />
      case 'suppliers': return <Suppliers isSuperAdmin={isSuperAdmin} />
      case 'combined_accounts': return <CombinedAccounts />
      case 'lending': return <Lending activeShop={activeShop} />
      case 'inventory': return <PurchaseList onNewPurchase={() => navigateTo('new_purchase')} />
      case 'new_purchase': return <NewPurchase onBack={() => navigateTo('inventory')} activeShop={activeShop} isCashier={isCashier} />
      case 'stock': return <Inventory isCashier={isCashier} />
      case 'stock_transfer': return <StockTransfer activeShop={activeShop} session={session} isCashier={isCashier} />
      case 'cashflow': return <Cashflow activeShop={activeShop} />
      case 'bank': return <Bank activeShop={activeShop} isSuperAdmin={isSuperAdmin} />
      case 'expenses': return <Expenses activeShop={activeShop} session={session} />
      case 'returns': return <SalesReturns activeShop={shopScope} isCashier={isCashier} session={session} isSuperAdmin={isSuperAdmin} />
      case 'warranty_claims': return <WarrantyClaims activeShop={shopScope} isCashier={isCashier} />
      case 'purchase_returns': return <PurchaseReturns activeShop={activeShop} session={session} />
      case 'endshift': return <EndOfShift activeShop={activeShop} session={session} isCashier={isCashier} isSuperAdmin={isSuperAdmin} />
      case 'reports': return <Reports
        onViewInvoice={(id, invoiceNo) => openInvoice({ id, invoice_no: invoiceNo }, 'finance_invoice_pl')}
      />
      case 'finance_invoice_pl': return <Reports
        startAt="finance"
        startTab="invoice"
        onViewInvoice={(id, invoiceNo) => openInvoice({ id, invoice_no: invoiceNo }, 'finance_invoice_pl')}
      />
      case 'sms': return <SMSCentre session={session} activeShop={activeShop} />
      case 'procurement': return <ProcurementInbox activeShop={activeShop} session={session} />
      case 'opening_balances': return <OpeningBalances session={session} shops={allShops} isSuperAdmin={isSuperAdmin} />
      case 'hr': return isSuperAdmin ? <HRModule /> : null
      case 'investors': return <Investors activeShop={activeShop} session={session} />
      default:
        return (
          <div>
            {/* Greeting — hero band */}
            <div style={{
              marginBottom: '28px', padding: '28px 32px', borderRadius: '20px',
              background: 'linear-gradient(120deg, #0b1220 0%, #12203f 55%, #1e3a8a 100%)',
              position: 'relative', overflow: 'hidden'
            }}>
              <div style={{ position: 'absolute', top: '-80px', right: '-60px', width: '220px', height: '220px', borderRadius: '50%', background: 'radial-gradient(circle, rgba(37,99,235,0.35), transparent 70%)' }} />
              <h1 style={{ fontSize: '26px', fontWeight: '800', color: 'white', margin: '0 0 4px', letterSpacing: '-0.01em', position: 'relative' }}>
                Good {new Date().getHours() < 12 ? 'Morning' : new Date().getHours() < 17 ? 'Afternoon' : 'Evening'} 👋
              </h1>
              <p style={{ color: '#93a5c9', fontSize: '14px', margin: 0, position: 'relative' }}>
                Here's what's happening at iPHIX Technologies today.
              </p>
            </div>

            {/* Stats */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '16px', marginBottom: '28px' }}>
              {[
                { label: isCashier && activeShop ? `Today's Sales — ${activeShop.name}` : "Today's Sales", value: formatCurrency(dashStats.todaySales), sub: `${dashStats.todayCount} confirmed invoice${dashStats.todayCount !== 1 ? 's' : ''}`, color: '#1e40af', bg: '#eff6ff', icon: '💵' },
                { label: "Today's Cash Sales", value: formatCurrency(dashStats.todayCash), sub: `${dashStats.todayCashCount} cash invoice${dashStats.todayCashCount !== 1 ? 's' : ''}`, color: '#059669', bg: '#f0fdf4', icon: '💰' },
                { label: "Today's Credit Sales", value: formatCurrency(dashStats.todayCredit), sub: `${dashStats.todayCreditCount} credit invoice${dashStats.todayCreditCount !== 1 ? 's' : ''}`, color: '#d97706', bg: '#fffbeb', icon: '🧾' },
                { label: "Collected from Creditors", value: formatCurrency(dashStats.todayCollected), sub: `${dashStats.todayCollectedCount} payment${dashStats.todayCollectedCount !== 1 ? 's' : ''} received today`, color: '#0891b2', bg: '#ecfeff', icon: '📥' },
                { label: isCashier && activeShop ? `Outstanding — ${activeShop.name}` : 'Total Outstanding', value: formatCurrency(dashStats.outstanding), sub: `${dashStats.outstandingCount} customer${dashStats.outstandingCount !== 1 ? 's' : ''} with balance`, color: '#e11d48', bg: '#fff1f2', icon: '⚠️' },
                { label: 'Open Drafts', value: dashStats.drafts, sub: 'Awaiting confirmation', color: '#7c3aed', bg: '#f5f3ff', icon: '📝' },
              ].map(stat => (
                <div key={stat.label} style={{ background: 'white', borderRadius: '16px', padding: '20px', boxShadow: '0 1px 3px rgba(15,23,42,0.06), 0 1px 2px rgba(15,23,42,0.04)', border: '1px solid #f1f5f9', transition: 'transform 0.15s, box-shadow 0.15s' }}
                  onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.boxShadow = '0 8px 20px rgba(15,23,42,0.08)' }}
                  onMouseLeave={e => { e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.boxShadow = '0 1px 3px rgba(15,23,42,0.06), 0 1px 2px rgba(15,23,42,0.04)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '14px' }}>
                    <div style={{ color: '#64748b', fontSize: '11px', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{stat.label}</div>
                    <div style={{ width: '32px', height: '32px', borderRadius: '9px', background: stat.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '15px', flexShrink: 0 }}>{stat.icon}</div>
                  </div>
                  <div style={{ fontSize: '23px', fontWeight: '800', color: stat.color, marginBottom: '4px', letterSpacing: '-0.01em' }}>{stat.value}</div>
                  <div style={{ fontSize: '12px', color: '#94a3b8' }}>{stat.sub}</div>
                </div>
              ))}
            </div>

            {/* Quick actions */}
            <h2 style={{ fontSize: '15px', fontWeight: '700', color: '#0f172a', marginBottom: '14px' }}>Quick Actions</h2>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: '12px', marginBottom: '28px' }}>
              {[
                { label: 'New Invoice', icon: '➕', color: '#1e40af', bg: '#eef2ff', page: 'new_invoice' },
                { label: 'All Invoices', icon: '🧾', color: '#2563eb', bg: '#eef2ff', page: 'billing' },
                { label: 'Customers', icon: '👥', color: '#059669', bg: '#ecfdf5', page: 'customers' },
                { label: 'Items', icon: '📦', color: '#d97706', bg: '#fffbeb', page: 'items' },
                { label: 'Expenses', icon: '📝', color: '#7c3aed', bg: '#f5f3ff', page: 'expenses' },
                { label: 'End Shift', icon: '🔒', color: '#0369a1', bg: '#f0f9ff', page: 'endshift' },
              ].map(action => (
                <button key={action.label} onClick={() => navigateTo(action.page)}
                  style={{ background: 'white', border: '1px solid #f1f5f9', borderRadius: '14px', padding: '18px 12px', cursor: 'pointer', textAlign: 'center', transition: 'transform 0.15s, box-shadow 0.15s', boxShadow: '0 1px 3px rgba(15,23,42,0.05)' }}
                  onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-3px)'; e.currentTarget.style.boxShadow = '0 10px 24px rgba(15,23,42,0.1)'; e.currentTarget.style.borderColor = action.color }}
                  onMouseLeave={e => { e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.boxShadow = '0 1px 3px rgba(15,23,42,0.05)'; e.currentTarget.style.borderColor = '#f1f5f9' }}>
                  <div style={{ width: '40px', height: '40px', borderRadius: '11px', background: action.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '19px', margin: '0 auto 10px' }}>{action.icon}</div>
                  <div style={{ fontSize: '12px', fontWeight: '700', color: action.color }}>{action.label}</div>
                </button>
              ))}
            </div>

            {/* Recent invoices */}
            <div style={{ background: 'white', borderRadius: '16px', boxShadow: '0 1px 3px rgba(15,23,42,0.06), 0 1px 2px rgba(15,23,42,0.04)', border: '1px solid #f1f5f9', overflow: 'hidden' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '18px 24px', borderBottom: '1px solid #f1f5f9' }}>
                <h2 style={{ fontSize: '15px', fontWeight: '700', color: '#0f172a', margin: 0 }}>Recent Invoices</h2>
                <button onClick={() => navigateTo('billing')}
                  style={{ fontSize: '13px', color: '#2563eb', fontWeight: '700', background: 'none', border: 'none', cursor: 'pointer' }}>
                  View all →
                </button>
              </div>

              {dashStats.lowStockItems.length > 0 && (
                <div style={{ background: '#fffbeb', border: '1.5px solid #fde68a', borderRadius: '12px', padding: '14px 18px', margin: '18px 24px 0', display: 'flex', alignItems: 'flex-start', gap: '12px' }}>
                  <span style={{ fontSize: '22px' }}>⚠️</span>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: '14px', fontWeight: '700', color: '#92400e', marginBottom: '4px' }}>
                      {dashStats.lowStockItems.length} item{dashStats.lowStockItems.length > 1 ? 's' : ''} below reorder level
                    </div>
                    <div style={{ fontSize: '12px', color: '#b45309' }}>
                      {dashStats.lowStockItems.slice(0, 5).map(i => `${i.name} (${i.stock_quantity || 0})`).join(' · ')}
                      {dashStats.lowStockItems.length > 5 && ` · +${dashStats.lowStockItems.length - 5} more`}
                    </div>
                  </div>
                  <button onClick={() => navigateTo('stock')}
                    style={{ padding: '6px 14px', background: '#fde68a', color: '#92400e', border: 'none', borderRadius: '8px', cursor: 'pointer', fontSize: '12px', fontWeight: '700', whiteSpace: 'nowrap' }}>
                    View Inventory
                  </button>
                </div>
              )}
              {dashStats.recentInvoices.length === 0 ? (
                <div style={{ padding: '56px 24px', textAlign: 'center', color: '#94a3b8' }}>
                  <div style={{ width: '56px', height: '56px', borderRadius: '16px', background: '#eff6ff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '26px', margin: '0 auto 14px' }}>🧾</div>
                  <div style={{ fontSize: '14px', fontWeight: '600', color: '#64748b' }}>No invoices yet</div>
                  <div style={{ fontSize: '13px', color: '#94a3b8', marginTop: '4px' }}>Create your first invoice to get started.</div>
                </div>
              ) : (
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ background: '#f8fafc' }}>
                      {['Invoice No', 'Customer', 'Salesman', 'Total', 'Payment', 'Status', ''].map(h => (
                        <th key={h} style={{ padding: '10px 16px', textAlign: 'left', fontSize: '11px', fontWeight: '700', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.06em', borderBottom: '1px solid #e2e8f0' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {dashStats.recentInvoices.map((inv, i) => {
                      const sc = statusColors[inv.status] || statusColors.draft
                      return (
                        <tr key={inv.id} style={{ borderBottom: '1px solid #f8fafc' }}
                          onMouseEnter={e => e.currentTarget.style.background = '#f8fafc'}
                          onMouseLeave={e => e.currentTarget.style.background = 'white'}>
                          <td style={{ padding: '12px 16px', fontWeight: '700', color: '#2563eb', fontSize: '13px' }}>{inv.invoice_no}</td>
                          <td style={{ padding: '12px 16px' }}>
                            <div style={{ fontSize: '14px', fontWeight: '600', color: '#0f172a' }}>{inv.customers?.name || '—'}</div>
                            <div style={{ fontSize: '12px', color: '#94a3b8' }}>{inv.customers?.customer_no}</div>
                          </td>
                          <td style={{ padding: '12px 16px', fontSize: '13px', color: '#64748b' }}>{inv.salesmen?.name || '—'}</td>
                          <td style={{ padding: '12px 16px', fontSize: '14px', fontWeight: '700', color: '#0f172a' }}>{formatCurrency(inv.total)}</td>
                          <td style={{ padding: '12px 16px', fontSize: '13px', color: '#64748b' }}>{paymentLabels[inv.payment_method] || inv.payment_method}</td>
                          <td style={{ padding: '12px 16px' }}>
                            <span style={{ background: sc.bg, color: sc.color, padding: '3px 10px', borderRadius: '20px', fontSize: '11px', fontWeight: '700' }}>
                              {inv.status.toUpperCase()}
                            </span>
                          </td>
                          <td style={{ padding: '12px 16px' }}>
                            <button onClick={() => openInvoice(inv)}
                              style={{ padding: '4px 12px', background: '#eef2ff', color: '#2563eb', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '12px', fontWeight: '700' }}>
                              View
                            </button>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              )}

            {/* ANALYTICS */}
            {!isCashier && analytics.salesTrend.length > 0 && (
              <div style={{ marginTop: '32px' }}>
                <h2 style={{ fontSize: '16px', fontWeight: '700', color: '#0f172a', marginBottom: '20px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  {'📊 Analytics'} <span style={{ fontSize: '12px', fontWeight: '500', color: '#94a3b8' }}>Last 30 days</span>
                </h2>
                <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '16px', marginBottom: '16px' }}>
                  <div style={{ background: 'white', borderRadius: '16px', padding: '22px', boxShadow: '0 1px 3px rgba(15,23,42,0.06), 0 1px 2px rgba(15,23,42,0.04)', border: '1px solid #f1f5f9' }}>
                    <div style={{ fontSize: '13px', fontWeight: '700', color: '#0f172a', marginBottom: '4px' }}>{'📈 14-Day Sales Trend'}</div>
                    <div style={{ fontSize: '11px', color: '#94a3b8', marginBottom: '16px' }}>Daily revenue over the past 2 weeks</div>
                    {(() => {
                      const vals = analytics.salesTrend.map(d => d.total)
                      const max = Math.max(...vals, 1)
                      const tot = vals.reduce((s,v) => s+v, 0)
                      const avg = tot / 14
                      const n = vals.length
                      const W = 500, H = 110, padL = 4, padR = 4, padT = 10, padB = 2
                      const xStep = (W - padL - padR) / (n - 1)
                      const yScale = v => padT + (H - padT - padB) * (1 - v / max)
                      const pts = vals.map((v, i) => ({ x: padL + i * xStep, y: yScale(v), v }))
                      // SVG smooth polyline points
                      const polyPts = pts.map(p => `${p.x},${p.y}`).join(' ')
                      // Area fill path
                      const areaPath = `M${pts[0].x},${H} ` + pts.map(p => `L${p.x},${p.y}`).join(' ') + ` L${pts[n-1].x},${H} Z`
                      // Trend: compare last 7 vs first 7
                      const first7 = vals.slice(0,7).reduce((s,v)=>s+v,0)
                      const last7  = vals.slice(7).reduce((s,v)=>s+v,0)
                      const trendUp = last7 >= first7
                      const trendPct = first7 > 0 ? Math.abs(((last7-first7)/first7)*100).toFixed(0) : '—'
                      // Best day
                      const bestIdx = vals.indexOf(max)
                      return (
                        <div>
                          <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'4px' }}>
                            <div style={{ display:'flex', alignItems:'center', gap:'6px' }}>
                              <div style={{ fontSize:'11px', fontWeight:'700', color: trendUp?'#059669':'#e11d48',
                                background: trendUp?'#f0fdf4':'#fff1f2', padding:'2px 8px', borderRadius:'20px',
                                display:'flex', alignItems:'center', gap:'3px' }}>
                                <span>{trendUp ? '▲' : '▼'}</span>
                                <span>{trendPct}% week-on-week</span>
                              </div>
                            </div>
                            <div style={{ fontSize:'10px', color:'#94a3b8' }}>
                              Peak: <span style={{ color:'#1e40af', fontWeight:'700' }}>{analytics.salesTrend[bestIdx]?.label}</span>
                            </div>
                          </div>
                          <div style={{ position:'relative', marginBottom:'4px' }}>
                            <svg viewBox={`0 0 ${W} ${H}`} style={{ width:'100%', height:'110px', overflow:'visible' }} preserveAspectRatio="none">
                              <defs>
                                <linearGradient id="trendGrad" x1="0" y1="0" x2="0" y2="1">
                                  <stop offset="0%" stopColor="#2563eb" stopOpacity="0.25" />
                                  <stop offset="100%" stopColor="#2563eb" stopOpacity="0.02" />
                                </linearGradient>
                                <linearGradient id="lineGrad" x1="0" y1="0" x2="1" y2="0">
                                  <stop offset="0%" stopColor="#93c5fd" />
                                  <stop offset="100%" stopColor="#1e40af" />
                                </linearGradient>
                              </defs>
                              {/* Avg line */}
                              <line x1={padL} y1={yScale(avg)} x2={W-padR} y2={yScale(avg)}
                                stroke="#e2e8f0" strokeWidth="1" strokeDasharray="4 3" />
                              {/* Area fill */}
                              <path d={areaPath} fill="url(#trendGrad)" />
                              {/* Line */}
                              <polyline points={polyPts} fill="none" stroke="url(#lineGrad)" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
                              {/* Dots */}
                              {pts.map((p, i) => {
                                const isToday = i === n - 1
                                const isBest = i === bestIdx
                                return (
                                  <g key={i}>
                                    {(isToday || isBest) && (
                                      <circle cx={p.x} cy={p.y} r="6" fill={isToday?'#1e40af':'#f59e0b'} fillOpacity="0.15" />
                                    )}
                                    <circle cx={p.x} cy={p.y} r={isToday||isBest?4:2.5}
                                      fill={isToday?'#1e40af':isBest?'#f59e0b':p.v>0?'white':'#e2e8f0'}
                                      stroke={isToday?'#1e40af':isBest?'#f59e0b':p.v>0?'#60a5fa':'#e2e8f0'}
                                      strokeWidth="2" />
                                  </g>
                                )
                              })}
                            </svg>
                          </div>
                          <div style={{ display: 'flex', gap: '2px', marginBottom: '10px' }}>
                            {analytics.salesTrend.map((d, i) => (
                              <div key={i} style={{ flex:1, fontSize:'8px', textAlign:'center', overflow:'hidden', whiteSpace:'nowrap',
                                color: i===n-1?'#1e40af':i===bestIdx?'#f59e0b':'#94a3b8',
                                fontWeight: i===n-1||i===bestIdx?'700':'400' }}>
                                {d.label.split(' ')[0]}
                              </div>
                            ))}
                          </div>
                          <div style={{ display:'flex', gap:'8px' }}>
                            <div style={{ flex:1, padding:'10px 12px', background:'#f8fafc', borderRadius:'8px' }}>
                              <div style={{ fontSize:'9px', color:'#94a3b8', fontWeight:'700', textTransform:'uppercase', marginBottom:'2px' }}>14-Day Total</div>
                              <div style={{ fontSize:'15px', fontWeight:'800', color:'#1e40af' }}>{formatCurrency(tot)}</div>
                            </div>
                            <div style={{ flex:1, padding:'10px 12px', background:'#f8fafc', borderRadius:'8px' }}>
                              <div style={{ fontSize:'9px', color:'#94a3b8', fontWeight:'700', textTransform:'uppercase', marginBottom:'2px' }}>Daily Avg</div>
                              <div style={{ fontSize:'15px', fontWeight:'800', color:'#059669' }}>{formatCurrency(avg)}</div>
                            </div>
                            <div style={{ flex:1, padding:'10px 12px', background:'#f8fafc', borderRadius:'8px' }}>
                              <div style={{ fontSize:'9px', color:'#94a3b8', fontWeight:'700', textTransform:'uppercase', marginBottom:'2px' }}>Peak Day</div>
                              <div style={{ fontSize:'15px', fontWeight:'800', color:'#f59e0b' }}>{formatCurrency(max)}</div>
                            </div>
                          </div>
                        </div>
                      )
                    })()}
                  </div>
                  <div style={{ background: 'white', borderRadius: '16px', padding: '22px', boxShadow: '0 1px 3px rgba(15,23,42,0.06), 0 1px 2px rgba(15,23,42,0.04)', border: '1px solid #f1f5f9' }}>
                    <div style={{ fontSize: '13px', fontWeight: '700', color: '#0f172a', marginBottom: '4px' }}>{'💳 Payment Mix'}</div>
                    <div style={{ fontSize: '11px', color: '#94a3b8', marginBottom: '16px' }}>Revenue by method (30 days)</div>
                    <div style={{ height:'10px', borderRadius:'5px', overflow:'hidden', display:'flex', marginBottom:'14px' }}>{analytics.paymentMix.map((p,i) => <div key={i} title={p.method+': '+p.pct+'%'} style={{ width:p.pct+'%', background:p.color }} />)}</div>
                    <div style={{ display:'flex', flexDirection:'column', gap:'8px' }}>{analytics.paymentMix.map((p,i) => <div key={i} style={{ display:'flex', alignItems:'center', gap:'8px' }}><div style={{ width:'10px', height:'10px', borderRadius:'2px', background:p.color, flexShrink:0 }} /><div style={{ flex:1, fontSize:'12px', color:'#0f172a', fontWeight:'600' }}>{p.method}</div><div style={{ fontSize:'11px', color:'#94a3b8' }}>{p.pct}%</div><div style={{ fontSize:'12px', fontWeight:'700', color:p.color }}>{formatCurrency(p.total)}</div></div>)}</div>
                  </div>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '16px' }}>
                  <div style={{ background: 'white', borderRadius: '16px', padding: '22px', boxShadow: '0 1px 3px rgba(15,23,42,0.06), 0 1px 2px rgba(15,23,42,0.04)', border: '1px solid #f1f5f9' }}>
                    <div style={{ fontSize: '13px', fontWeight: '700', color: '#0f172a', marginBottom: '4px' }}>{'🏆 Most Sold Items'}</div>
                    <div style={{ fontSize: '11px', color: '#94a3b8', marginBottom: '14px' }}>By units in last 30 days</div>
                    <div style={{ display:'flex', flexDirection:'column', gap:'10px' }}>{analytics.topItems.map((item,i) => { const max=analytics.topItems[0]?.qty||1; const cols=['#1e40af','#059669','#0891b2','#d97706','#7c3aed','#e11d48','#f59e0b','#64748b']; const color=cols[i%cols.length]; const medal=i===0?'🥇':i===1?'🥈':i===2?'🥉':''; return (<div key={i}><div style={{ display:'flex', justifyContent:'space-between', marginBottom:'3px' }}><div style={{ fontSize:'12px', fontWeight:'600', color:'#0f172a', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap', maxWidth:'75%' }}>{medal} {item.name}</div><div style={{ fontSize:'12px', fontWeight:'800', color }}>{item.qty}</div></div><div style={{ height:'5px', background:'#f1f5f9', borderRadius:'3px', overflow:'hidden' }}><div style={{ width:((item.qty/max)*100)+'%', height:'100%', background:color, borderRadius:'3px' }} /></div></div>) })}</div>
                  </div>
                  <div style={{ background: 'white', borderRadius: '16px', padding: '22px', boxShadow: '0 1px 3px rgba(15,23,42,0.06), 0 1px 2px rgba(15,23,42,0.04)', border: '1px solid #f1f5f9' }}>
                    <div style={{ fontSize: '13px', fontWeight: '700', color: '#0f172a', marginBottom: '4px' }}>{'👑 Top Customers'}</div>
                    <div style={{ fontSize: '11px', color: '#94a3b8', marginBottom: '14px' }}>By revenue in last 30 days</div>
                    <div style={{ display:'flex', flexDirection:'column', gap:'10px' }}>{analytics.topCustomers.map((c,i) => { const max=analytics.topCustomers[0]?.total||1; const hue=i*50+220; return (<div key={i}><div style={{ display:'flex', justifyContent:'space-between', marginBottom:'3px', alignItems:'center' }}><div style={{ display:'flex', alignItems:'center', gap:'6px', overflow:'hidden' }}><div style={{ width:'22px', height:'22px', borderRadius:'50%', background:`hsl(${hue},65%,55%)`, display:'flex', alignItems:'center', justifyContent:'center', color:'white', fontSize:'10px', fontWeight:'700', flexShrink:0 }}>{c.name[0]}</div><div style={{ fontSize:'12px', fontWeight:'600', color:'#0f172a', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{c.name}</div></div><div style={{ fontSize:'11px', fontWeight:'800', color:'#059669', flexShrink:0 }}>{formatCurrency(c.total)}</div></div><div style={{ height:'5px', background:'#f1f5f9', borderRadius:'3px', overflow:'hidden' }}><div style={{ width:((c.total/max)*100)+'%', height:'100%', background:`hsl(${hue},65%,55%)`, borderRadius:'3px' }} /></div></div>) })}</div>
                  </div>
                  <div style={{ background: 'white', borderRadius: '16px', padding: '22px', boxShadow: '0 1px 3px rgba(15,23,42,0.06), 0 1px 2px rgba(15,23,42,0.04)', border: '1px solid #f1f5f9' }}>
                    <div style={{ fontSize: '13px', fontWeight: '700', color: '#0f172a', marginBottom: '4px' }}>{'🏅 Salesman Performance'}</div>
                    <div style={{ fontSize: '11px', color: '#94a3b8', marginBottom: '14px' }}>Top salesmen by revenue (30 days)</div>
                    {analytics.salesmanPerf.length === 0
                      ? <div style={{ textAlign:'center', color:'#94a3b8', padding:'20px 0', fontSize:'12px' }}>No data yet</div>
                      : <div style={{ display:'flex', flexDirection:'column', gap:'10px' }}>
                          {analytics.salesmanPerf.map((s,i) => (
                            <div key={i}>
                              <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'3px' }}>
                                <div style={{ display:'flex', alignItems:'center', gap:'7px', overflow:'hidden' }}>
                                  <div style={{ width:'20px', height:'20px', borderRadius:'50%', background:s.color, display:'flex', alignItems:'center', justifyContent:'center', color:'white', fontSize:'10px', fontWeight:'800', flexShrink:0 }}>{i+1}</div>
                                  <div style={{ fontSize:'12px', fontWeight:'600', color:'#0f172a', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{s.name}</div>
                                </div>
                                <div style={{ display:'flex', alignItems:'center', gap:'6px', flexShrink:0 }}>
                                  <div style={{ fontSize:'10px', color:'#94a3b8' }}>{s.pct}%</div>
                                  <div style={{ fontSize:'12px', fontWeight:'800', color:s.color }}>{formatCurrency(s.total)}</div>
                                </div>
                              </div>
                              <div style={{ height:'5px', background:'#f1f5f9', borderRadius:'3px', overflow:'hidden' }}>
                                <div style={{ width:s.pct+'%', height:'100%', background:s.color, borderRadius:'3px' }} />
                              </div>
                            </div>
                          ))}
                        </div>
                    }
                  </div>
                </div>
              </div>
            )}
            </div>
          </div>
        )
    }
  }

  return (
    <div style={{ display: 'flex', minHeight: '100vh', background: '#f8fafc', fontFamily: 'system-ui, -apple-system, sans-serif' }}>
      <Toaster position="top-right" />

      {/* Mobile/tablet top bar — hidden on desktop via CSS */}
      <div className="iphix-mobile-topbar" style={{ display: 'none', position: 'fixed', top: 0, left: 0, right: 0, height: '58px', background: '#0b1220', alignItems: 'center', gap: '12px', padding: '0 14px', zIndex: 200, borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
        <button onClick={() => setSidebarOpen(v => !v)} aria-label="Toggle menu"
          style={{ background: 'rgba(255,255,255,0.08)', border: 'none', borderRadius: '8px', width: '38px', height: '38px', color: '#60a5fa', fontSize: '18px', cursor: 'pointer', flexShrink: 0 }}>
          ☰
        </button>
        <Logo size={28} radius={8} />
        <div style={{ color: 'white', fontWeight: '700', fontSize: '14px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>iPHIX Technologies</div>
      </div>

      {/* Overlay — closes the drawer when tapped, mobile/tablet only */}
      {sidebarOpen && (
        <div className="iphix-sidebar-overlay" onClick={() => setSidebarOpen(false)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 150 }} />
      )}

      {/* Sidebar */}
      <div className={`iphix-sidebar${sidebarOpen ? ' open' : ''}`} style={{ width: '244px', minHeight: '100vh', background: 'linear-gradient(180deg, #0b1220 0%, #0f1e3d 100%)', display: 'flex', flexDirection: 'column', position: 'fixed', left: 0, top: 0, bottom: 0, zIndex: 180 }}>
        <div style={{ padding: '22px 18px', borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '11px' }}>
            <Logo size={36} radius={10} />
            <div>
              <div style={{ color: 'white', fontWeight: '700', fontSize: '15px', letterSpacing: '-0.01em' }}>iPHIX Technologies</div>
              <div style={{ color: '#7d9be0', fontSize: '11px', fontWeight: '500' }}>ERP System</div>
            </div>
          </div>
        </div>

        {!isCashier && (
          <div style={{ padding: '10px 10px 4px' }}>
            <button onClick={() => navigateTo('dashboard')}
              style={{ width: '100%', display: 'flex', alignItems: 'center', gap: '10px', padding: '11px 12px', borderRadius: '9px', border: 'none', cursor: 'pointer', background: activePage === 'dashboard' ? 'linear-gradient(135deg, #2563eb, #1d4ed8)' : 'transparent', color: activePage === 'dashboard' ? 'white' : '#93a5c9', fontSize: '14px', fontWeight: activePage === 'dashboard' ? '600' : '400', textAlign: 'left', boxShadow: activePage === 'dashboard' ? '0 4px 12px rgba(37,99,235,0.3)' : 'none', transition: 'background 0.12s, color 0.12s' }}
              onMouseEnter={e => { if (activePage !== 'dashboard') { e.currentTarget.style.background = 'rgba(255,255,255,0.06)'; e.currentTarget.style.color = 'white' } }}
              onMouseLeave={e => { if (activePage !== 'dashboard') { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = '#93a5c9' } }}>
              <span style={{ fontSize: '15px' }}>⊞</span> Dashboard
            </button>
          </div>
        )}

        <nav style={{ flex: 1, padding: '0 10px', overflowY: 'auto' }}>
          {sections.map(section => (
            <div key={section}>
              <div style={{ color: '#4a628f', fontSize: '10px', fontWeight: '700', letterSpacing: '0.1em', padding: '14px 12px 4px', textTransform: 'uppercase' }}>{section}</div>
              {menuItems.filter(m => m.section === section).map(item => (
                <button key={item.id} onClick={() => navigateTo(item.id)}
                  style={{ width: '100%', display: 'flex', alignItems: 'center', gap: '10px', padding: '11px 12px', borderRadius: '9px', border: 'none', cursor: 'pointer', marginBottom: '2px', background: isActive(item.id) ? 'linear-gradient(135deg, #2563eb, #1d4ed8)' : 'transparent', color: isActive(item.id) ? 'white' : '#93a5c9', fontSize: '14px', fontWeight: isActive(item.id) ? '600' : '400', textAlign: 'left', boxShadow: isActive(item.id) ? '0 4px 12px rgba(37,99,235,0.3)' : 'none', transition: 'background 0.12s, color 0.12s' }}
                  onMouseEnter={e => { if (!isActive(item.id)) { e.currentTarget.style.background = 'rgba(255,255,255,0.06)'; e.currentTarget.style.color = 'white' } }}
                  onMouseLeave={e => { if (!isActive(item.id)) { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = '#93a5c9' } }}>
                  <span style={{ fontSize: '15px' }}>{item.icon}</span>
                  {item.label}
                </button>
              ))}
            </div>
          ))}
        </nav>

        {onEnterRepairDivision && (
          <div style={{ padding: '0 10px 12px' }}>
            <div style={{ borderTop: '1px solid rgba(255,255,255,0.08)', margin: '0 2px 12px' }} />
            <button onClick={onEnterRepairDivision}
              style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px', padding: '11px 12px', borderRadius: '10px', border: '1px solid rgba(240,178,61,0.3)', cursor: 'pointer', background: 'rgba(240,178,61,0.1)', color: '#f0b23d', fontSize: '13px', fontWeight: '700', textAlign: 'left' }}
              onMouseEnter={e => e.currentTarget.style.background = 'rgba(240,178,61,0.18)'}
              onMouseLeave={e => e.currentTarget.style.background = 'rgba(240,178,61,0.1)'}>
              <span>🔧 Phone Repairs</span>
              <span>→</span>
            </button>
          </div>
        )}

        <div style={{ padding: '16px', borderTop: '1px solid rgba(255,255,255,0.07)' }}>
          {/* Active shop or super admin badge */}
          {isSuperAdmin ? (
            <div style={{ padding: '10px 12px', background: 'rgba(37,99,235,0.14)', borderRadius: '10px', border: '1px solid rgba(37,99,235,0.28)', marginBottom: '10px' }}>
              <div style={{ fontSize: '10px', fontWeight: '700', color: '#60a5fa', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '3px' }}>Access Level</div>
              <div style={{ fontSize: '13px', fontWeight: '700', color: 'white' }}>⭐ Super Admin</div>
              <div style={{ fontSize: '11px', color: '#60a5fa', marginTop: '2px' }}>All shops · Full access</div>
            </div>
          ) : activeShop ? (
            <div style={{ padding: '10px 12px', background: 'rgba(37,99,235,0.14)', borderRadius: '10px', border: '1px solid rgba(37,99,235,0.28)', marginBottom: '10px' }}>
              <div style={{ fontSize: '10px', fontWeight: '700', color: '#60a5fa', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '3px' }}>Active Shop</div>
              <div style={{ fontSize: '13px', fontWeight: '700', color: 'white', marginBottom: '4px' }}>{activeShop.name}</div>
              {onShopChange && (
                <button onClick={onShopChange} style={{ fontSize: '11px', color: '#60a5fa', background: 'none', border: 'none', cursor: 'pointer', padding: 0, fontWeight: '600' }}>
                  Switch shop →
                </button>
              )}
            </div>
          ) : null}

          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '10px' }}>
            <div style={{ width: '32px', height: '32px', borderRadius: '50%', background: 'linear-gradient(135deg, #2563eb, #1d4ed8)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontWeight: '600', fontSize: '13px', flexShrink: 0 }}>
              {session.user.email[0].toUpperCase()}
            </div>
            <div style={{ overflow: 'hidden' }}>
              <div style={{ color: 'white', fontSize: '13px', fontWeight: '500', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{session.user.email}</div>
              <div style={{ color: '#7d9be0', fontSize: '11px' }}>{isSuperAdmin ? 'Super Admin' : userRole ? userRole.charAt(0).toUpperCase() + userRole.slice(1) : '...'}</div>
            </div>
          </div>
          <button onClick={handleLogout} disabled={loggingOut}
            style={{ width: '100%', padding: '9px', background: 'rgba(239,68,68,0.14)', color: '#f87171', border: '1px solid rgba(239,68,68,0.2)', borderRadius: '9px', cursor: 'pointer', fontSize: '13px', fontWeight: '500' }}>
            {loggingOut ? 'Signing out...' : '← Sign Out'}
          </button>
        </div>
      </div>

      {/* Main content */}
      <div className="iphix-main-content" style={{ marginLeft: '244px', flex: 1, padding: '32px', width: '100%', boxSizing: 'border-box' }}>
        {renderPage()}
      </div>

      <style>{`
        @media (max-width: 900px) {
          .iphix-mobile-topbar { display: flex !important; }
          .iphix-sidebar {
            transform: translateX(-100%);
            transition: transform 0.25s ease;
            box-shadow: 4px 0 24px rgba(0,0,0,0.3);
          }
          .iphix-sidebar.open { transform: translateX(0); }
          .iphix-main-content {
            margin-left: 0 !important;
            padding: 16px !important;
            padding-top: 74px !important;
            max-width: 100vw;
          }
        }
        @media (min-width: 901px) {
          .iphix-sidebar-overlay { display: none !important; }
        }
      `}</style>
    </div>
  )
}
