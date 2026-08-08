import { useState, useEffect } from 'react'
import { supabase } from '../../supabase'
import { formatCurrency } from '../../lib/helpers'
import SalesReport from './SalesReport'
import PurchaseReport from './PurchaseReport'
import InventoryReport from './InventoryReport'
import CustomerReport from './CustomerReport'
import SupplierReport from './SupplierReport'
import FinanceReport from './FinanceReport'
import SalesReturnReport from './SalesReturnReport'
import PurchaseReturnReport from './PurchaseReturnReport'
import StockTransferReport from './StockTransferReport'
import CashflowReport from './CashflowReport'

export default function Reports({ onViewInvoice, startAt = null, startTab = null }) {
  const [activeReport, setActiveReport] = useState(startAt)
  const [shops, setShops] = useState([])
  const [quickStats, setQuickStats] = useState({
    totalSales: 0, totalPurchases: 0, totalOutstanding: 0, totalPayable: 0
  })

  useEffect(() => { fetchData() }, [])

  async function fetchData() {
    const [{ data: sh }, { data: sales }, { data: purchases }, { data: customers }, { data: suppliers }] = await Promise.all([
      supabase.from('shops').select('*').order('name'),
      supabase.from('invoices').select('total').eq('status', 'confirmed'),
      supabase.from('purchases').select('total').eq('status', 'confirmed'),
      supabase.from('customers').select('credit_balance').gt('credit_balance', 0),
      supabase.from('suppliers').select('outstanding_balance').gt('outstanding_balance', 0),
    ])
    setShops(sh || [])
    setQuickStats({
      totalSales: (sales || []).reduce((s, i) => s + (i.total || 0), 0),
      totalPurchases: (purchases || []).reduce((s, p) => s + (p.total || 0), 0),
      totalOutstanding: (customers || []).reduce((s, c) => s + (c.credit_balance || 0), 0),
      totalPayable: (suppliers || []).reduce((s, sup) => s + (sup.outstanding_balance || 0), 0),
    })
  }

  if (activeReport) {
    const props = { shops, onBack: () => setActiveReport(null) }
    switch (activeReport) {
      case 'sales':            return <SalesReport {...props} />
      case 'purchases':        return <PurchaseReport {...props} />
      case 'inventory':        return <InventoryReport {...props} />
      case 'customers':        return <CustomerReport {...props} />
      case 'suppliers':        return <SupplierReport {...props} />
      case 'sales_returns':    return <SalesReturnReport {...props} />
      case 'purchase_returns': return <PurchaseReturnReport {...props} />
      case 'stock_transfers':  return <StockTransferReport {...props} />
      case 'finance':          return <FinanceReport {...props} onViewInvoice={onViewInvoice} startTab={startTab} />
      case 'cashflow':         return <CashflowReport />
      default: break
    }
  }

  const reportCards = [
    { id: 'sales',            icon: '🧾', title: 'Sales Report',           desc: 'Invoices, revenue by date, shop, salesman',    color: '#1e40af', bg: '#eef2ff' },
    { id: 'purchases',        icon: '🛒', title: 'Purchase Report',         desc: 'Purchase orders by supplier, date, shop',      color: '#059669', bg: '#f0fdf4' },
    { id: 'inventory',        icon: '📦', title: 'Inventory Report',        desc: 'Stock levels, low stock, valuation',           color: '#d97706', bg: '#fffbeb' },
    { id: 'customers',        icon: '👥', title: 'Customer Outstandings',   desc: 'Credit balances, invoice & return history',    color: '#e11d48', bg: '#fff1f2' },
    { id: 'suppliers',        icon: '🏭', title: 'Supplier Outstandings',   desc: 'Payable balances, purchase & return history',  color: '#7c3aed', bg: '#f5f3ff' },
    { id: 'sales_returns',    icon: '↩️', title: 'Sales Returns',           desc: 'Customer returns by date, shop, salesman',     color: '#db2777', bg: '#fdf2f8' },
    { id: 'purchase_returns', icon: '🔄', title: 'Purchase Returns',        desc: 'Supplier returns by date and shop',            color: '#0891b2', bg: '#ecfeff' },
    { id: 'stock_transfers',  icon: '🔀', title: 'Stock Transfer Report',   desc: 'Inter-shop stock movements and history',       color: '#7c3aed', bg: '#f5f3ff' },
    { id: 'finance',          icon: '📊', title: 'Finance & P&L',           desc: 'Profit & loss, profitability per shop',        color: '#0369a1', bg: '#f0f9ff' },
    { id: 'cashflow',         icon: '💰', title: 'Cashflow Report',         desc: 'Sales, expenses, cash reconciliation',         color: '#059669', bg: '#f0fdf4' },
  ]

  return (
    <div>
      <div style={{ marginBottom: '28px' }}>
        <h1 style={{ fontSize: '22px', fontWeight: '700', color: '#0f172a', margin: '0 0 4px' }}>Reports</h1>
        <p style={{ color: '#64748b', fontSize: '14px', margin: 0 }}>Business intelligence and data exports</p>
      </div>

      {/* Quick stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: '16px', marginBottom: '32px' }}>
        {[
          { label: 'Total Sales (All Time)',  value: formatCurrency(quickStats.totalSales),       color: '#1e40af' },
          { label: 'Total Purchases',          value: formatCurrency(quickStats.totalPurchases),   color: '#059669' },
          { label: 'Customer Outstanding',     value: formatCurrency(quickStats.totalOutstanding), color: '#e11d48' },
          { label: 'Supplier Payable',         value: formatCurrency(quickStats.totalPayable),     color: '#7c3aed' },
        ].map(s => (
          <div key={s.label} style={{ background: 'white', borderRadius: '12px', padding: '20px', boxShadow: '0 1px 3px rgba(15,23,42,0.06), 0 1px 2px rgba(15,23,42,0.04)', borderTop: `4px solid ${s.color}` }}>
            <div style={{ fontSize: '12px', fontWeight: '700', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '6px' }}>{s.label}</div>
            <div style={{ fontSize: '20px', fontWeight: '800', color: s.color }}>{s.value}</div>
          </div>
        ))}
      </div>

      {/* Report cards */}
      <h2 style={{ fontSize: '15px', fontWeight: '700', color: '#0f172a', marginBottom: '16px' }}>Select Report</h2>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: '16px' }}>
        {reportCards.map(card => (
          <button key={card.id} onClick={() => setActiveReport(card.id)}
            style={{ background: 'white', border: `1.5px solid ${card.bg}`, borderRadius: '14px', padding: '24px', cursor: 'pointer', textAlign: 'left', transition: 'all 0.15s', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}
            onMouseEnter={e => { e.currentTarget.style.borderColor = card.color; e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.boxShadow = '0 6px 20px rgba(0,0,0,0.1)' }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = card.bg; e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.boxShadow = '0 1px 3px rgba(0,0,0,0.06)' }}>
            <div style={{ width: '44px', height: '44px', background: card.bg, borderRadius: '10px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '22px', marginBottom: '14px' }}>
              {card.icon}
            </div>
            <div style={{ fontSize: '15px', fontWeight: '700', color: '#0f172a', marginBottom: '6px' }}>{card.title}</div>
            <div style={{ fontSize: '13px', color: '#64748b', lineHeight: '1.5' }}>{card.desc}</div>
            <div style={{ marginTop: '14px', fontSize: '13px', fontWeight: '700', color: card.color }}>View Report →</div>
          </button>
        ))}
      </div>
    </div>
  )
}
