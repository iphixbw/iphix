import { useState, useEffect } from 'react'
import { supabase } from '../../supabase'
import { formatCurrency } from '../../lib/helpers'
import toast from 'react-hot-toast'

export default function FinanceReport({ shops, onBack, onViewInvoice, startTab = null }) {
  const [activeTab, setActiveTab] = useState(startTab || 'pl')
  const [shopFilter, setShopFilter] = useState('all')
  const [customerFilter, setCustomerFilter] = useState('all')
  const [dateFrom, setDateFrom] = useState(() => { const d = new Date(); d.setMonth(0); d.setDate(1); return d.toISOString().split('T')[0] })
  const [dateTo, setDateTo] = useState(new Date().toISOString().split('T')[0])
  const [plData, setPlData] = useState(null)
  const [invoicePL, setInvoicePL] = useState([])
  const [filteredInvoicePL, setFilteredInvoicePL] = useState([])
  const [expenses, setExpenses] = useState([])
  const [customers, setCustomers] = useState([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    supabase.from('customers').select('id, name, customer_no').order('name').then(({ data }) => setCustomers(data || []))
    fetchData()
  }, [])

  useEffect(() => {
    if (customerFilter === 'all') {
      setFilteredInvoicePL(invoicePL)
    } else {
      setFilteredInvoicePL(invoicePL.filter(r => r.customer_id === customerFilter))
    }
  }, [customerFilter, invoicePL])

  async function fetchData() {
    setLoading(true)
    try {
      let salesQ = supabase.from('invoices').select('total, amount_paid, credit_amount, shop_id').eq('status', 'confirmed').gte('created_at', dateFrom).lte('created_at', dateTo + 'T23:59:59')
      let expQ = supabase.from('expenses').select('id, amount, category, payment_method, shop_id, description, created_at').gte('created_at', dateFrom).lte('created_at', dateTo + 'T23:59:59')
      let invPlQ = supabase.from('invoice_profitability').select('*').eq('status', 'confirmed').order('created_at', { ascending: false }).gte('created_at', dateFrom).lte('created_at', dateTo + 'T23:59:59')

      if (shopFilter !== 'all') {
        salesQ = salesQ.eq('shop_id', shopFilter)
        invPlQ = invPlQ.eq('shop_id', shopFilter)
      }

      const [{ data: sales }, { data: exp }, { data: invPl }] = await Promise.all([salesQ, expQ, invPlQ])

      // Filter expenses: if shop selected, include that shop's expenses + all general (null shop_id)
      const filteredExp = shopFilter === 'all'
        ? (exp || [])
        : (exp || []).filter(e => e.shop_id === shopFilter || !e.shop_id)

      const totalRevenue = (sales || []).reduce((s, i) => s + (i.total || 0), 0)
      const totalCOGS = (invPl || []).reduce((s, i) => s + (i.cost_total || 0), 0)
      const shopExpenses = filteredExp.filter(e => e.shop_id).reduce((s, e) => s + (e.amount || 0), 0)
      const generalExpenses = filteredExp.filter(e => !e.shop_id).reduce((s, e) => s + (e.amount || 0), 0)
      const totalExpenses = shopExpenses + generalExpenses
      const grossProfit = totalRevenue - totalCOGS
      const netProfit = grossProfit - totalExpenses
      const grossMargin = totalRevenue > 0 ? (grossProfit / totalRevenue) * 100 : 0
      const netMargin = totalRevenue > 0 ? (netProfit / totalRevenue) * 100 : 0

      // Per-shop breakdown with general expenses distributed proportionally
      const totalShopRevenue = shops.reduce((s, sh) => s + (sales || []).filter(i => i.shop_id === sh.id).reduce((ss, i) => ss + (i.total || 0), 0), 0)

      const shopBreakdown = shops.map(sh => {
        const shSales = (sales || []).filter(i => i.shop_id === sh.id).reduce((s, i) => s + (i.total || 0), 0)
        const shCOGS = (invPl || []).filter(i => i.shop_id === sh.id).reduce((s, i) => s + (i.cost_total || 0), 0)
        const shShopExp = (exp || []).filter(e => e.shop_id === sh.id).reduce((s, e) => s + (e.amount || 0), 0)
        const allGeneralExp = (exp || []).filter(e => !e.shop_id).reduce((s, e) => s + (e.amount || 0), 0)
        const proportion = totalShopRevenue > 0 ? shSales / totalShopRevenue : 0
        const shGeneralExp = allGeneralExp * proportion
        return { shop: sh.name, revenue: shSales, cogs: shCOGS, shopExpenses: shShopExp, generalExpenses: shGeneralExp, totalExpenses: shShopExp + shGeneralExp, gross: shSales - shCOGS, net: shSales - shCOGS - shShopExp - shGeneralExp }
      })

      setPlData({ totalRevenue, totalCOGS, shopExpenses, generalExpenses, totalExpenses, grossProfit, netProfit, grossMargin, netMargin, shopBreakdown })
      setInvoicePL(invPl || [])
      setFilteredInvoicePL(invPl || [])
      setExpenses(filteredExp)
      setCustomerFilter('all')
    } catch (e) { toast.error('Failed: ' + e.message) }
    setLoading(false)
  }

  function exportPLCSV() {
    if (!plData) return
    const rows = [['P&L Report', `${dateFrom} to ${dateTo}`], [], ['Total Revenue', plData.totalRevenue], ['COGS', plData.totalCOGS], ['Gross Profit', plData.grossProfit], ['Gross Margin', plData.grossMargin.toFixed(1) + '%'], [], ['Shop Expenses', plData.shopExpenses], ['General Expenses', plData.generalExpenses], ['Total Expenses', plData.totalExpenses], [], ['NET PROFIT', plData.netProfit], ['Net Margin', plData.netMargin.toFixed(1) + '%']]
    const csv = rows.map(r => r.map(v => `"${v || ''}"`).join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a'); a.href = url; a.download = `pl-${dateFrom}-${dateTo}.csv`; a.click(); URL.revokeObjectURL(url); toast.success('Downloaded!')
  }

  function exportInvoicePLCSV() {
    const headers = ['Invoice No', 'Date', 'Customer', 'Customer No', 'Shop', 'Revenue', 'Cost', 'Gross Profit', 'Margin %']
    const rows = filteredInvoicePL.map(r => [r.invoice_no, new Date(r.created_at).toLocaleDateString('en-GB'), r.customer_name, r.customer_no, r.shop_name, r.revenue, r.cost_total, r.gross_profit, r.revenue > 0 ? ((r.gross_profit / r.revenue) * 100).toFixed(1) + '%' : '0%'])
    const csv = [headers, ...rows].map(r => r.map(v => `"${v || ''}"`).join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a'); a.href = url; a.download = `invoice-pl-${dateFrom}-${dateTo}.csv`; a.click(); URL.revokeObjectURL(url); toast.success('Downloaded!')
  }

  function exportExpensesCSV() {
    const headers = ['Date', 'Description', 'Category', 'Method', 'Shop', 'Type', 'Amount']
    const rows = expenses.map(e => [new Date(e.created_at).toLocaleDateString('en-GB'), e.description, e.category || 'Other', e.payment_method, shops.find(s => s.id === e.shop_id)?.name || 'General', e.shop_id ? 'Shop' : 'General', e.amount])
    const csv = [headers, ...rows].map(r => r.map(v => `"${v || ''}"`).join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a'); a.href = url; a.download = `expenses-${dateFrom}-${dateTo}.csv`; a.click(); URL.revokeObjectURL(url); toast.success('Downloaded!')
  }

  const inp = { padding: '9px 12px', border: '1.5px solid #e2e8f0', borderRadius: '7px', fontSize: '14px', outline: 'none', background: 'white' }
  const categoryTotals = expenses.reduce((acc, e) => { const k = e.category || 'Other'; acc[k] = (acc[k] || 0) + (e.amount || 0); return acc }, {})


  function printReport() {
    const w = window.open('', '_blank')
    const dateStr = new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' })
    const fmt = n => (parseFloat(n)||0).toLocaleString('en-LK', { minimumFractionDigits: 2 })
    const pl = plData || {}
    const styles = '*{box-sizing:border-box;margin:0;padding:0}body{font-family:Arial,sans-serif;font-size:11px;color:#1e293b;padding:16px}.hdr{border-bottom:3px solid #1e40af;padding-bottom:10px;margin-bottom:14px}.co{font-size:19px;font-weight:900;color:#1e40af}.ttl{font-size:14px;font-weight:700;margin-top:3px}.sub{font-size:10px;color:#64748b;margin-top:2px}table{width:100%;border-collapse:collapse;font-size:10px}thead tr{background:#0f172a;color:white}thead th{padding:7px 8px;font-size:9px;font-weight:700;text-transform:uppercase;white-space:nowrap;text-align:left}thead th.r{text-align:right}tbody tr:nth-child(even){background:#f8fafc}tbody td{padding:5px 8px;border-bottom:1px solid #f1f5f9}tbody td.r{text-align:right}tfoot tr{background:#1e293b;color:white}tfoot td{padding:8px;font-weight:800}tfoot td.r{text-align:right}.pl-row{display:flex;justify-content:space-between;padding:7px 0;border-bottom:1px solid #f1f5f9;font-size:11px}.pl-section{background:#f8fafc;padding:10px 14px;border-radius:6px;margin:10px 0}.pl-total{display:flex;justify-content:space-between;padding:12px 14px;background:#0f172a;color:white;border-radius:6px;font-weight:800;font-size:14px;margin-top:10px}.sec-hdr{font-size:11px;font-weight:700;text-transform:uppercase;color:#1e40af;margin:16px 0 6px;letter-spacing:.05em}.ftr{margin-top:14px;border-top:2px solid #e2e8f0;padding-top:8px;text-align:center;font-size:9px;color:#94a3b8;font-weight:700}@media print{@page{size:A4 portrait;margin:8mm}body{padding:0}}'

    // Build shop breakdown rows
    let shopSection = ''
    const breakdown = pl.shopBreakdown || []
    if (breakdown.length > 0) {
      const shRows = breakdown.map(sh =>
        '<tr>' +
        '<td>' + sh.name + '</td>' +
        '<td class="r" style="color:#059669">LKR ' + fmt(sh.revenue) + '</td>' +
        '<td class="r" style="color:#e11d48">LKR ' + fmt(sh.cogs) + '</td>' +
        '<td class="r" style="color:#1e40af">LKR ' + fmt(sh.gross) + '</td>' +
        '<td class="r">' + (sh.margin||0).toFixed(1) + '%</td>' +
        '<td class="r" style="color:#d97706">LKR ' + fmt(sh.shopExp) + '</td>' +
        '<td class="r" style="color:' + ((sh.net||0)>=0?'#059669':'#e11d48') + '">LKR ' + fmt(sh.net) + '</td>' +
        '</tr>'
      ).join('')
      shopSection = '<div class="sec-hdr">Shop Breakdown</div>' +
        '<table><thead><tr><th>Shop</th><th class="r">Revenue</th><th class="r">COGS</th><th class="r">Gross Profit</th><th class="r">Margin</th><th class="r">Expenses</th><th class="r">Net Profit</th></tr></thead>' +
        '<tbody>' + shRows + '</tbody></table>'
    }

    // Build expenses detail rows
    let expSection = ''
    if (expenses && expenses.length > 0) {
      const expRows = expenses.map(e =>
        '<tr>' +
        '<td>' + new Date(e.created_at).toLocaleDateString('en-GB', {day:'2-digit',month:'short',year:'numeric'}) + '</td>' +
        '<td>' + (e.description||'—') + '</td>' +
        '<td>' + (e.category||'—') + '</td>' +
        '<td>' + (shops.find(s=>s.id===e.shop_id)?.name||'General') + '</td>' +
        '<td class="r" style="color:#e11d48">LKR ' + fmt(e.amount) + '</td>' +
        '</tr>'
      ).join('')
      expSection = '<div class="sec-hdr">Expenses Detail</div>' +
        '<table><thead><tr><th>Date</th><th>Description</th><th>Category</th><th>Shop</th><th class="r">Amount</th></tr></thead>' +
        '<tbody>' + expRows + '</tbody>' +
        '<tfoot><tr><td colspan="4">TOTAL EXPENSES</td><td class="r" style="color:#fca5a5">LKR ' + fmt(pl.totalExpenses) + '</td></tr></tfoot>' +
        '</table>'
    }

    const netColor = (pl.netProfit||0) >= 0 ? '#4ade80' : '#fca5a5'
    const html = '<!DOCTYPE html><html><head><title>Finance Report</title><style>' + styles + '</style></head><body>' +
      '<div class="hdr"><div class="co">PHONEFIX (PVT) LTD</div><div class="ttl">Finance Report — Profit & Loss</div><div class="sub">' + dateFrom + ' to ' + dateTo + ' &nbsp;·&nbsp; Generated ' + dateStr + '</div></div>' +
      '<div class="pl-section">' +
        '<div class="pl-row"><span style="font-weight:700">Total Revenue</span><span style="color:#059669;font-weight:800">LKR ' + fmt(pl.totalRevenue) + '</span></div>' +
        '<div class="pl-row"><span>Cost of Goods Sold (COGS)</span><span style="color:#e11d48">LKR ' + fmt(pl.totalCOGS) + '</span></div>' +
        '<div class="pl-row" style="font-weight:700"><span>Gross Profit</span><span style="color:#1e40af">LKR ' + fmt(pl.grossProfit) + ' (' + (pl.grossMargin||0).toFixed(1) + '%)</span></div>' +
      '</div>' +
      '<div class="pl-section">' +
        '<div class="pl-row"><span>Shop Expenses</span><span style="color:#e11d48">LKR ' + fmt(pl.shopExpenses) + '</span></div>' +
        '<div class="pl-row"><span>General Expenses</span><span style="color:#e11d48">LKR ' + fmt(pl.generalExpenses) + '</span></div>' +
        '<div class="pl-row" style="font-weight:700"><span>Total Expenses</span><span style="color:#e11d48">LKR ' + fmt(pl.totalExpenses) + '</span></div>' +
      '</div>' +
      '<div class="pl-total"><span>NET PROFIT</span><span style="color:' + netColor + '">LKR ' + fmt(pl.netProfit) + ' (' + (pl.netMargin||0).toFixed(1) + '%)</span></div>' +
      shopSection +
      expSection +
      '<div class="ftr">Designed for Phonefix (PVT) Ltd &nbsp;·&nbsp; Powered by Techmo Solutions &nbsp;·&nbsp; ' + dateStr + '</div>' +
      '<script>window.onload=function(){window.print()}<\/script>' +
      '</body></html>'

    w.document.write(html)
    w.document.close()
  }

  return (
    <div>
      <style>{`@media print { .no-print { display: none !important; } }`}</style>

      <div className="no-print" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
        <div>
          <button onClick={onBack} style={{ background: 'none', border: 'none', color: '#2563eb', cursor: 'pointer', fontSize: '14px', fontWeight: '600', padding: 0, marginBottom: '6px', display: 'block' }}>← Back to Reports</button>
          <h1 style={{ fontSize: '22px', fontWeight: '700', color: '#0f172a', margin: 0 }}>Finance & P&L</h1>
        </div>
        <div style={{ display: 'flex', gap: '10px' }}>
          <button onClick={activeTab === 'pl' ? exportPLCSV : activeTab === 'invoice' ? exportInvoicePLCSV : exportExpensesCSV}
            style={{ padding: '9px 18px', background: '#f0fdf4', color: '#059669', border: '1.5px solid #bbf7d0', borderRadius: '10px', cursor: 'pointer', fontWeight: '700', fontSize: '13px' }}>⬇ Export CSV</button>
          <button onClick={printReport}
            style={{ padding: '9px 18px', background: '#eef2ff', color: '#2563eb', border: '1.5px solid #bfdbfe', borderRadius: '10px', cursor: 'pointer', fontWeight: '700', fontSize: '13px' }}>🖨 Print PDF</button>
        </div>
      </div>

      {/* Filters */}
      <div className="no-print" style={{ background: 'white', borderRadius: '12px', padding: '16px 20px', boxShadow: '0 1px 3px rgba(15,23,42,0.06), 0 1px 2px rgba(15,23,42,0.04)', marginBottom: '20px', display: 'flex', gap: '12px', flexWrap: 'wrap', alignItems: 'flex-end' }}>
        {[
          { label: 'From', el: <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} style={inp} /> },
          { label: 'To', el: <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} style={inp} /> },
          { label: 'Shop', el: <select value={shopFilter} onChange={e => setShopFilter(e.target.value)} style={inp}><option value="all">All Shops</option>{shops.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select> },
        ].map(f => (
          <div key={f.label}>
            <div style={{ fontSize: '11px', fontWeight: '700', color: '#94a3b8', textTransform: 'uppercase', marginBottom: '5px' }}>{f.label}</div>
            {f.el}
          </div>
        ))}
        <button onClick={fetchData} style={{ padding: '9px 20px', background: 'linear-gradient(135deg,#2563eb,#1d4ed8)', color: 'white', border: 'none', borderRadius: '10px', cursor: 'pointer', fontWeight: '700', fontSize: '14px' }}>Apply</button>
      </div>

      {/* Tabs */}
      <div className="no-print" style={{ display: 'flex', gap: '4px', marginBottom: '20px', background: '#f1f5f9', padding: '4px', borderRadius: '10px', width: 'fit-content' }}>
        {[{ id: 'pl', label: '📊 P&L Summary' }, { id: 'invoice', label: '🧾 Invoice Profitability' }, { id: 'expenses', label: '📝 Expense Breakdown' }].map(tab => (
          <button key={tab.id} onClick={() => setActiveTab(tab.id)}
            style={{ padding: '8px 18px', borderRadius: '10px', border: 'none', cursor: 'pointer', fontSize: '13px', fontWeight: '600', background: activeTab === tab.id ? 'white' : 'transparent', color: activeTab === tab.id ? '#0f172a' : '#64748b', boxShadow: activeTab === tab.id ? '0 1px 3px rgba(0,0,0,0.1)' : 'none' }}>
            {tab.label}
          </button>
        ))}
      </div>

      {loading && <div style={{ padding: '40px', textAlign: 'center', color: '#94a3b8' }}>Loading...</div>}

      {/* ── P&L Tab ── */}
      {!loading && activeTab === 'pl' && plData && (
        <div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: '16px', marginBottom: '20px' }}>
            {[
              { label: 'Total Revenue', value: formatCurrency(plData.totalRevenue), color: '#059669', sub: 'Confirmed invoices' },
              { label: 'Cost of Goods Sold', value: formatCurrency(plData.totalCOGS), color: '#d97706', sub: 'Cost of items sold' },
              { label: 'Total Expenses', value: formatCurrency(plData.totalExpenses), color: '#e11d48', sub: `Shop: ${formatCurrency(plData.shopExpenses)} · General: ${formatCurrency(plData.generalExpenses)}` },
            ].map(s => (
              <div key={s.label} style={{ background: 'white', borderRadius: '12px', padding: '20px', boxShadow: '0 1px 3px rgba(15,23,42,0.06), 0 1px 2px rgba(15,23,42,0.04)', borderLeft: `4px solid ${s.color}` }}>
                <div style={{ fontSize: '11px', fontWeight: '700', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '6px' }}>{s.label}</div>
                <div style={{ fontSize: '22px', fontWeight: '800', color: s.color }}>{s.value}</div>
                <div style={{ fontSize: '12px', color: '#94a3b8', marginTop: '3px' }}>{s.sub}</div>
              </div>
            ))}
          </div>

          {plData.generalExpenses > 0 && (
            <div style={{ background: '#fef3c7', border: '1px solid #fde68a', borderRadius: '10px', padding: '12px 16px', marginBottom: '20px', fontSize: '13px', color: '#92400e' }}>
              💡 <strong>{formatCurrency(plData.generalExpenses)}</strong> in general expenses (not allocated to a shop) are included in the overall P&L and distributed proportionally across shops by revenue share.
            </div>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '24px' }}>
            <div style={{ background: plData.grossProfit >= 0 ? 'linear-gradient(135deg,#059669,#047857)' : 'linear-gradient(135deg,#dc2626,#b91c1c)', borderRadius: '14px', padding: '24px', color: 'white' }}>
              <div style={{ fontSize: '12px', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.08em', opacity: 0.8, marginBottom: '8px' }}>Gross Profit</div>
              <div style={{ fontSize: '32px', fontWeight: '800', marginBottom: '4px' }}>{formatCurrency(plData.grossProfit)}</div>
              <div style={{ fontSize: '14px', opacity: 0.8 }}>Gross Margin: {plData.grossMargin.toFixed(1)}%</div>
            </div>
            <div style={{ background: plData.netProfit >= 0 ? 'linear-gradient(135deg,#0369a1,#0284c7)' : 'linear-gradient(135deg,#dc2626,#b91c1c)', borderRadius: '14px', padding: '24px', color: 'white' }}>
              <div style={{ fontSize: '12px', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.08em', opacity: 0.8, marginBottom: '8px' }}>Net Profit</div>
              <div style={{ fontSize: '32px', fontWeight: '800', marginBottom: '4px' }}>{formatCurrency(plData.netProfit)}</div>
              <div style={{ fontSize: '14px', opacity: 0.8 }}>Net Margin: {plData.netMargin.toFixed(1)}%</div>
            </div>
          </div>

          {shopFilter === 'all' && plData.shopBreakdown.length > 0 && (
            <div style={{ background: 'white', borderRadius: '12px', boxShadow: '0 1px 3px rgba(15,23,42,0.06), 0 1px 2px rgba(15,23,42,0.04)', overflow: 'hidden' }}>
              <div style={{ padding: '16px 20px', borderBottom: '1px solid #f1f5f9' }}>
                <h2 style={{ fontSize: '15px', fontWeight: '700', color: '#0f172a', margin: 0 }}>Per Shop Breakdown</h2>
              </div>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '800px' }}>
                  <thead>
                    <tr style={{ background: '#f8fafc', borderBottom: '2px solid #e2e8f0' }}>
                      {['Shop', 'Revenue', 'COGS', 'Gross Profit', 'Shop Exp.', 'General Exp. (est.)', 'Net Profit', 'Net Margin'].map(h => (
                        <th key={h} style={{ padding: '10px 14px', textAlign: 'left', fontSize: '11px', fontWeight: '700', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.06em', whiteSpace: 'nowrap' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {plData.shopBreakdown.map((s, i) => (
                      <tr key={s.shop} style={{ borderBottom: '1px solid #f1f5f9', background: i % 2 === 0 ? 'white' : '#fafafa' }}>
                        <td style={{ padding: '12px 14px', fontSize: '14px', fontWeight: '700', color: '#0f172a' }}>{s.shop}</td>
                        <td style={{ padding: '12px 14px', fontSize: '13px', fontWeight: '600', color: '#059669' }}>{formatCurrency(s.revenue)}</td>
                        <td style={{ padding: '12px 14px', fontSize: '13px', color: '#d97706' }}>{formatCurrency(s.cogs)}</td>
                        <td style={{ padding: '12px 14px', fontSize: '13px', fontWeight: '600', color: s.gross >= 0 ? '#059669' : '#e11d48' }}>{formatCurrency(s.gross)}</td>
                        <td style={{ padding: '12px 14px', fontSize: '13px', color: '#e11d48' }}>{formatCurrency(s.shopExpenses)}</td>
                        <td style={{ padding: '12px 14px', fontSize: '13px', color: '#d97706' }}>{formatCurrency(s.generalExpenses)}</td>
                        <td style={{ padding: '12px 14px', fontSize: '14px', fontWeight: '800', color: s.net >= 0 ? '#0369a1' : '#e11d48' }}>{formatCurrency(s.net)}</td>
                        <td style={{ padding: '12px 14px', fontSize: '13px', color: '#64748b' }}>{s.revenue > 0 ? ((s.net / s.revenue) * 100).toFixed(1) + '%' : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Invoice Profitability Tab ── */}
      {!loading && activeTab === 'invoice' && (
        <div>
          <div className="no-print" style={{ background: 'white', borderRadius: '12px', padding: '14px 16px', boxShadow: '0 1px 3px rgba(15,23,42,0.06), 0 1px 2px rgba(15,23,42,0.04)', marginBottom: '16px', display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap' }}>
            <div style={{ fontSize: '13px', fontWeight: '600', color: '#64748b', whiteSpace: 'nowrap' }}>Customer:</div>
            <select value={customerFilter} onChange={e => setCustomerFilter(e.target.value)} style={{ ...inp, flex: 1, maxWidth: '300px' }}>
              <option value="all">All Customers</option>
              {customers.map(c => <option key={c.id} value={c.id}>{c.customer_no} · {c.name}</option>)}
            </select>
            {customerFilter !== 'all' && (
              <button onClick={() => setCustomerFilter('all')} style={{ padding: '8px 14px', background: '#f1f5f9', color: '#64748b', border: 'none', borderRadius: '7px', cursor: 'pointer', fontSize: '13px', fontWeight: '600' }}>Clear</button>
            )}
            <div style={{ marginLeft: 'auto', fontSize: '13px', color: '#94a3b8' }}>
              {filteredInvoicePL.length} invoice{filteredInvoicePL.length !== 1 ? 's' : ''} · Gross Profit: <strong style={{ color: '#059669' }}>{formatCurrency(filteredInvoicePL.reduce((s, r) => s + (r.gross_profit || 0), 0))}</strong>
            </div>
          </div>

          <div style={{ background: 'white', borderRadius: '12px', boxShadow: '0 1px 3px rgba(15,23,42,0.06), 0 1px 2px rgba(15,23,42,0.04)', overflow: 'hidden' }}>
            {filteredInvoicePL.length === 0 ? (
              <div style={{ padding: '40px', textAlign: 'center', color: '#94a3b8' }}>
                <div style={{ fontSize: '32px', marginBottom: '8px' }}>🧾</div>No invoices found
              </div>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '800px' }}>
                  <thead>
                    <tr style={{ background: '#f8fafc', borderBottom: '2px solid #e2e8f0' }}>
                      {['Invoice No', 'Date', 'Customer', 'Shop', 'Revenue', 'Cost', 'Gross Profit', 'Margin %'].map(h => (
                        <th key={h} style={{ padding: '10px 14px', textAlign: 'left', fontSize: '11px', fontWeight: '700', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.06em', whiteSpace: 'nowrap' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {filteredInvoicePL.map((r, i) => {
                      const margin = r.revenue > 0 ? (r.gross_profit / r.revenue) * 100 : 0
                      return (
                        <tr key={r.id} style={{ borderBottom: '1px solid #f1f5f9', background: i % 2 === 0 ? 'white' : '#fafafa', cursor: 'pointer' }}
                          onMouseEnter={e => e.currentTarget.style.background = '#f5f3ff'}
                          onMouseLeave={e => e.currentTarget.style.background = i % 2 === 0 ? 'white' : '#fafafa'}
                          onClick={() => onViewInvoice && onViewInvoice(r.id, r.invoice_no)}
                          title="Click to view invoice">
                          <td style={{ padding: '10px 14px', fontWeight: '700', color: '#2563eb', fontSize: '13px', cursor: 'pointer' }}>
                            <span style={{ textDecoration: 'underline', textUnderlineOffset: '3px' }}>{r.invoice_no}</span>
                          </td>
                          <td style={{ padding: '10px 14px', fontSize: '13px', color: '#64748b', whiteSpace: 'nowrap' }}>{new Date(r.created_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}</td>
                          <td style={{ padding: '10px 14px' }}>
                            <div style={{ fontSize: '13px', fontWeight: '600', color: '#0f172a' }}>{r.customer_name}</div>
                            <div style={{ fontSize: '11px', color: '#94a3b8' }}>{r.customer_no}</div>
                          </td>
                          <td style={{ padding: '10px 14px', fontSize: '13px', color: '#64748b' }}>{r.shop_name}</td>
                          <td style={{ padding: '10px 14px', fontSize: '13px', fontWeight: '600', color: '#059669' }}>{formatCurrency(r.revenue)}</td>
                          <td style={{ padding: '10px 14px', fontSize: '13px', color: '#d97706' }}>{formatCurrency(r.cost_total)}</td>
                          <td style={{ padding: '10px 14px', fontSize: '14px', fontWeight: '700', color: r.gross_profit >= 0 ? '#059669' : '#e11d48' }}>{formatCurrency(r.gross_profit)}</td>
                          <td style={{ padding: '10px 14px' }}>
                            <span style={{ background: margin >= 20 ? '#dcfce7' : margin >= 0 ? '#fef3c7' : '#fee2e2', color: margin >= 20 ? '#166534' : margin >= 0 ? '#92400e' : '#991b1b', padding: '3px 8px', borderRadius: '12px', fontSize: '12px', fontWeight: '700' }}>
                              {margin.toFixed(1)}%
                            </span>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                  <tfoot>
                    <tr style={{ background: '#0f172a' }}>
                      <td colSpan={4} style={{ padding: '12px 14px', fontSize: '13px', fontWeight: '700', color: '#94a3b8' }}>TOTALS ({filteredInvoicePL.length})</td>
                      <td style={{ padding: '12px 14px', fontSize: '14px', fontWeight: '800', color: '#4ade80' }}>{formatCurrency(filteredInvoicePL.reduce((s, r) => s + (r.revenue || 0), 0))}</td>
                      <td style={{ padding: '12px 14px', fontSize: '14px', fontWeight: '800', color: '#fbbf24' }}>{formatCurrency(filteredInvoicePL.reduce((s, r) => s + (r.cost_total || 0), 0))}</td>
                      <td style={{ padding: '12px 14px', fontSize: '14px', fontWeight: '800', color: '#4ade80' }}>{formatCurrency(filteredInvoicePL.reduce((s, r) => s + (r.gross_profit || 0), 0))}</td>
                      <td></td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Expense Breakdown Tab ── */}
      {!loading && activeTab === 'expenses' && (
        <div>
          {/* Category summary */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px,1fr))', gap: '12px', marginBottom: '20px' }}>
            {Object.entries(categoryTotals).sort((a, b) => b[1] - a[1]).map(([cat, amt]) => (
              <div key={cat} style={{ background: 'white', borderRadius: '10px', padding: '16px', boxShadow: '0 1px 3px rgba(15,23,42,0.06), 0 1px 2px rgba(15,23,42,0.04)' }}>
                <div style={{ fontSize: '12px', fontWeight: '700', color: '#64748b', marginBottom: '6px' }}>{cat}</div>
                <div style={{ fontSize: '18px', fontWeight: '800', color: '#e11d48' }}>{formatCurrency(amt)}</div>
              </div>
            ))}
          </div>

          {/* Shop vs General */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '20px' }}>
            <div style={{ background: 'white', borderRadius: '12px', padding: '18px', boxShadow: '0 1px 3px rgba(15,23,42,0.06), 0 1px 2px rgba(15,23,42,0.04)', borderLeft: '4px solid #e11d48' }}>
              <div style={{ fontSize: '11px', fontWeight: '700', color: '#94a3b8', textTransform: 'uppercase', marginBottom: '6px' }}>Shop Expenses</div>
              <div style={{ fontSize: '22px', fontWeight: '800', color: '#e11d48' }}>{formatCurrency(expenses.filter(e => e.shop_id).reduce((s, e) => s + (e.amount || 0), 0))}</div>
              <div style={{ fontSize: '12px', color: '#94a3b8', marginTop: '3px' }}>Allocated to specific shops — affects shop P&L</div>
            </div>
            <div style={{ background: 'white', borderRadius: '12px', padding: '18px', boxShadow: '0 1px 3px rgba(15,23,42,0.06), 0 1px 2px rgba(15,23,42,0.04)', borderLeft: '4px solid #d97706' }}>
              <div style={{ fontSize: '11px', fontWeight: '700', color: '#94a3b8', textTransform: 'uppercase', marginBottom: '6px' }}>General Expenses</div>
              <div style={{ fontSize: '22px', fontWeight: '800', color: '#d97706' }}>{formatCurrency(expenses.filter(e => !e.shop_id).reduce((s, e) => s + (e.amount || 0), 0))}</div>
              <div style={{ fontSize: '12px', color: '#94a3b8', marginTop: '3px' }}>Not shop-specific — affects overall business P&L only</div>
            </div>
          </div>

          {/* Detail table */}
          <div style={{ background: 'white', borderRadius: '12px', boxShadow: '0 1px 3px rgba(15,23,42,0.06), 0 1px 2px rgba(15,23,42,0.04)', overflow: 'hidden' }}>
            <div style={{ padding: '16px 20px', borderBottom: '1px solid #f1f5f9', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h2 style={{ fontSize: '15px', fontWeight: '700', color: '#0f172a', margin: 0 }}>Expense Detail ({expenses.length})</h2>
              <span style={{ fontWeight: '800', color: '#e11d48', fontSize: '15px' }}>{formatCurrency(expenses.reduce((s, e) => s + (e.amount || 0), 0))}</span>
            </div>
            {expenses.length === 0 ? <div style={{ padding: '40px', textAlign: 'center', color: '#94a3b8' }}>No expenses in this period</div>
            : (
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ background: '#f8fafc', borderBottom: '2px solid #e2e8f0' }}>
                    {['Date', 'Description', 'Category', 'Method', 'Shop', 'Type', 'Amount'].map(h => (
                      <th key={h} style={{ padding: '10px 14px', textAlign: 'left', fontSize: '11px', fontWeight: '700', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {expenses.map((e, i) => {
                    const shopName = shops.find(s => s.id === e.shop_id)?.name
                    const isGeneral = !e.shop_id
                    return (
                      <tr key={e.id || i} style={{ borderBottom: '1px solid #f1f5f9', background: i % 2 === 0 ? 'white' : '#fafafa' }}>
                        <td style={{ padding: '10px 14px', fontSize: '13px', color: '#64748b', whiteSpace: 'nowrap' }}>{new Date(e.created_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}</td>
                        <td style={{ padding: '10px 14px', fontSize: '13px', fontWeight: '600', color: '#0f172a' }}>{e.description}</td>
                        <td style={{ padding: '10px 14px' }}><span style={{ background: '#f1f5f9', color: '#475569', padding: '2px 8px', borderRadius: '12px', fontSize: '12px', fontWeight: '600' }}>{e.category || 'Other'}</span></td>
                        <td style={{ padding: '10px 14px', fontSize: '12px', color: '#64748b', textTransform: 'capitalize' }}>{e.payment_method}</td>
                        <td style={{ padding: '10px 14px', fontSize: '13px', color: '#64748b' }}>{shopName || <span style={{ color: '#94a3b8', fontStyle: 'italic' }}>—</span>}</td>
                        <td style={{ padding: '10px 14px' }}>
                          <span style={{ background: isGeneral ? '#fef3c7' : '#fee2e2', color: isGeneral ? '#92400e' : '#991b1b', padding: '2px 8px', borderRadius: '12px', fontSize: '11px', fontWeight: '700' }}>
                            {isGeneral ? 'General' : 'Shop'}
                          </span>
                        </td>
                        <td style={{ padding: '10px 14px', fontSize: '14px', fontWeight: '700', color: '#e11d48' }}>{formatCurrency(e.amount)}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
