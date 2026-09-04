import { useState, useEffect } from 'react'
import { supabase } from '../../supabase'
import toast from 'react-hot-toast'
import { formatLKR, timeAgo } from '../../lib/repairConstants'

const REPORTS = [
  { id: 'profit_loss', label: 'Profit & Loss', icon: '📊', color: '#166534', bg: '#f0fdf4' },
  { id: 'profitability', label: 'Repair Profitability', icon: '💰', color: '#166534', bg: '#f0fdf4' },
  { id: 'technician', label: 'Technician Performance', icon: '🧑‍🔧', color: '#1e40af', bg: '#eff6ff' },
  { id: 'parts_usage', label: 'Parts Usage', icon: '🔩', color: '#7c3aed', bg: '#f5f3ff' },
  { id: 'inventory_valuation', label: 'Inventory Valuation', icon: '📦', color: '#d4881f', bg: '#fef3e2' },
  { id: 'low_stock', label: 'Low Stock', icon: '⚠️', color: '#ea580c', bg: '#fff7ed' },
  { id: 'models', label: 'Most Repaired Models', icon: '📱', color: '#0891b2', bg: '#ecfeff' },
  { id: 'faults', label: 'Most Common Faults', icon: '🩺', color: '#e11d48', bg: '#fff1f2' },
  { id: 'warranty', label: 'Warranty Repairs', icon: '🛡', color: '#059669', bg: '#f0fdf4' },
  { id: 'cancelled', label: 'Cancelled Repairs', icon: '🚫', color: '#94a3b8', bg: '#f8fafc' },
]

export default function RepairReports({ shop }) {
  const [active, setActive] = useState(null)
  const [loading, setLoading] = useState(false)
  const [rows, setRows] = useState([])
  const [pl, setPl] = useState(null)
  const monthStartStr = (() => { const d = new Date(); d.setDate(1); return d.toISOString().slice(0, 10) })()
  const todayStr = new Date().toISOString().slice(0, 10)
  const [fromDate, setFromDate] = useState(monthStartStr)
  const [toDate, setToDate] = useState(todayStr)

  useEffect(() => {
    if (active === 'profit_loss') loadProfitLoss()
  }, [active, fromDate, toDate, shop?.id])

  // Revenue = repair job charges + direct Parts Sales, net of credit-method
  // returns (cash/bank refunds are a pure money movement, not a revenue
  // reversal — same convention used everywhere else in this app).
  // Cost of Sales = each job's own stored cost_total (parts + 3rd-party/
  // outside-repair costs, already computed by the app itself) + the cost of
  // everything sold through Parts Sales, including 3rd-party items sold
  // directly there — that last piece is easy to miss since it lives in a
  // different table (repair_third_party_items) than regular sale_items.
  async function loadProfitLoss() {
    setLoading(true)
    try {
      const fromISO = fromDate ? new Date(fromDate + 'T00:00:00').toISOString() : null
      const toISO = toDate ? new Date(toDate + 'T23:59:59.999').toISOString() : null
      const shopFilter = (q) => shop?.id ? q.eq('shop_id', shop.id) : q
      const dateFilter = (q, col = 'created_at') => {
        if (fromISO) q = q.gte(col, fromISO)
        if (toISO) q = q.lte(col, toISO)
        return q
      }

      let jobsQ = dateFilter(shopFilter(supabase.from('repair_jobs').select('id, grand_total, cost_total, status'))).neq('status', 'voided')
      let salesQ = dateFilter(shopFilter(supabase.from('repair_sales').select('id, total, status'))).neq('status', 'voided')
      let returnsQ = dateFilter(shopFilter(supabase.from('repair_sale_returns').select('total, payment_method, status'))).eq('payment_method', 'credit').neq('status', 'voided')
      let expensesQ = dateFilter(shopFilter(supabase.from('repair_expenses').select('amount, category')))

      const [{ data: jobs }, { data: sales }, { data: returns }, { data: expenses }] = await Promise.all([jobsQ, salesQ, returnsQ, expensesQ])

      const saleIds = (sales || []).map(s => s.id)
      let saleItemsCost = 0, thirdPartySalesCost = 0
      if (saleIds.length) {
        const [{ data: items }, { data: tp }] = await Promise.all([
          supabase.from('repair_sale_items').select('unit_cost, quantity, sale_id').in('sale_id', saleIds),
          supabase.from('repair_third_party_items').select('cost_price, quantity, sale_id').in('sale_id', saleIds),
        ])
        saleItemsCost = (items || []).reduce((s, i) => s + (i.unit_cost || 0) * (i.quantity || 0), 0)
        thirdPartySalesCost = (tp || []).reduce((s, i) => s + (i.cost_price || 0) * (i.quantity || 0), 0)
      }

      const jobRevenue = (jobs || []).reduce((s, j) => s + (j.grand_total || 0), 0)
      const jobCost = (jobs || []).reduce((s, j) => s + (j.cost_total || 0), 0)
      const salesGross = (sales || []).reduce((s, x) => s + (x.total || 0), 0)
      const returnsTotal = (returns || []).reduce((s, r) => s + (r.total || 0), 0)
      const salesRevenue = salesGross - returnsTotal
      const totalRevenue = jobRevenue + salesRevenue
      const partsCost = saleItemsCost + thirdPartySalesCost
      const totalCOGS = jobCost + partsCost
      const grossProfit = totalRevenue - totalCOGS

      const byCategory = {}
      ;(expenses || []).forEach(e => { const c = e.category || 'Uncategorized'; byCategory[c] = (byCategory[c] || 0) + (e.amount || 0) })
      const totalExpenses = (expenses || []).reduce((s, e) => s + (e.amount || 0), 0)
      const netProfit = grossProfit - totalExpenses

      setPl({
        jobRevenue, salesGross, returnsTotal, salesRevenue, totalRevenue,
        jobCost, partsCost, totalCOGS, grossProfit,
        expensesByCategory: Object.entries(byCategory).sort((a, b) => b[1] - a[1]),
        totalExpenses, netProfit,
      })
    } catch (e) {
      toast.error('Failed to load P&L: ' + e.message)
    }
    setLoading(false)
  }

  async function openReport(id) {
    setActive(id)
    if (id === 'profit_loss') return // handled by its own useEffect (date-filter driven)
    setLoading(true)
    const shopFilter = (q) => shop?.id ? q.eq('shop_id', shop.id) : q

    if (id === 'profitability') {
      const { data } = await shopFilter(supabase.from('repair_jobs').select('job_no, phone_brand, phone_model, grand_total, cost_total, net_profit, status, created_at')).eq('status', 'collected').order('created_at', { ascending: false })
      setRows(data || [])
    } else if (id === 'technician') {
      const { data } = await shopFilter(supabase.from('repair_jobs').select('technician, grand_total, net_profit, status')).eq('status', 'collected')
      const byTech = {}
      ;(data || []).forEach(j => {
        const t = j.technician || 'Unassigned'
        if (!byTech[t]) byTech[t] = { technician: t, jobs: 0, revenue: 0, profit: 0 }
        byTech[t].jobs++; byTech[t].revenue += j.grand_total || 0; byTech[t].profit += j.net_profit || 0
      })
      setRows(Object.values(byTech).sort((a, b) => b.revenue - a.revenue))
    } else if (id === 'parts_usage') {
      const { data } = await supabase.from('repair_job_parts').select('quantity, line_total, repair_parts(name, sku)')
      const byPart = {}
      ;(data || []).forEach(p => {
        const name = p.repair_parts?.name || 'Unknown'
        if (!byPart[name]) byPart[name] = { name, sku: p.repair_parts?.sku, qty: 0, revenue: 0 }
        byPart[name].qty += p.quantity; byPart[name].revenue += p.line_total
      })
      setRows(Object.values(byPart).sort((a, b) => b.qty - a.qty))
    } else if (id === 'inventory_valuation') {
      const { data } = await shopFilter(supabase.from('repair_parts').select('id, name, sku, current_stock')).order('name')
      const partIds = (data || []).map(p => p.id)
      let batches = []
      if (partIds.length > 0) {
        const { data: b } = await supabase.from('repair_part_batches').select('part_id, quantity_remaining, unit_cost').in('part_id', partIds)
        batches = b || []
      }
      setRows((data || []).map(({ id: pid, ...p }) => {
        const value = batches.filter(b => b.part_id === pid).reduce((s, b) => s + (b.quantity_remaining || 0) * (b.unit_cost || 0), 0)
        return { ...p, fifo_value: value }
      }))
    } else if (id === 'low_stock') {
      const { data } = await shopFilter(supabase.from('repair_parts').select('name, sku, current_stock, min_stock')).order('name')
      setRows((data || []).filter(p => (p.current_stock || 0) <= (p.min_stock || 0)))
    } else if (id === 'models') {
      const { data } = await shopFilter(supabase.from('repair_jobs').select('phone_brand, phone_model'))
      const byModel = {}
      ;(data || []).forEach(j => {
        const key = `${j.phone_brand || 'Unknown'} ${j.phone_model || ''}`.trim()
        byModel[key] = (byModel[key] || 0) + 1
      })
      setRows(Object.entries(byModel).map(([model, count]) => ({ model, count })).sort((a, b) => b.count - a.count))
    } else if (id === 'faults') {
      const { data } = await shopFilter(supabase.from('repair_jobs').select('reported_problem'))
      const byFault = {}
      ;(data || []).forEach(j => { const key = (j.reported_problem || 'Unspecified').trim(); if (key) byFault[key] = (byFault[key] || 0) + 1 })
      setRows(Object.entries(byFault).map(([fault, count]) => ({ fault, count })).sort((a, b) => b.count - a.count))
    } else if (id === 'warranty') {
      const { data } = await shopFilter(supabase.from('repair_jobs').select('job_no, phone_brand, phone_model, warranty_expiry, status')).eq('warranty', true)
      setRows(data || [])
    } else if (id === 'cancelled') {
      const { data } = await shopFilter(supabase.from('repair_jobs').select('job_no, phone_brand, phone_model, created_at, status')).in('status', ['cancelled', 'returned_unrepaired'])
      setRows(data || [])
    }
    setLoading(false)
  }

  if (active === 'profit_loss') {
    const row = (label, value, opts = {}) => (
      <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: opts.total ? '2px solid #1c1917' : '1px solid #f8f5f0' }}>
        <span style={{ fontWeight: opts.bold ? '800' : '500', fontSize: opts.total ? '15px' : '13px', paddingLeft: opts.indent ? '16px' : 0, color: opts.muted ? '#8a7a63' : '#1c1917' }}>{label}</span>
        <span style={{ fontWeight: opts.bold ? '800' : '600', fontSize: opts.total ? '15px' : '13px', color: opts.color || '#1c1917' }}>{opts.negative ? '(' + formatLKR(value) + ')' : formatLKR(value)}</span>
      </div>
    )
    return (
      <div>
        <button onClick={() => setActive(null)} style={{ background: 'none', border: 'none', color: '#d4881f', fontWeight: '700', fontSize: '13px', cursor: 'pointer', marginBottom: '14px', padding: 0 }}>← Back to Reports</button>
        <h1 style={{ fontSize: '20px', fontWeight: '800', color: '#1c1917', margin: '0 0 16px' }}>📊 Profit &amp; Loss</h1>

        <div style={{ display: 'flex', gap: '12px', alignItems: 'flex-end', marginBottom: '20px', flexWrap: 'wrap' }}>
          <div>
            <label style={{ fontSize: '11px', fontWeight: '700', color: '#a89478', textTransform: 'uppercase', display: 'block', marginBottom: '4px' }}>From</label>
            <input type="date" value={fromDate} onChange={e => setFromDate(e.target.value)} style={{ padding: '9px 12px', border: '1.5px solid #e7dfd3', borderRadius: '8px', fontSize: '13px' }} />
          </div>
          <div>
            <label style={{ fontSize: '11px', fontWeight: '700', color: '#a89478', textTransform: 'uppercase', display: 'block', marginBottom: '4px' }}>To</label>
            <input type="date" value={toDate} onChange={e => setToDate(e.target.value)} style={{ padding: '9px 12px', border: '1.5px solid #e7dfd3', borderRadius: '8px', fontSize: '13px' }} />
          </div>
          <button onClick={() => { const d = new Date(); d.setDate(1); setFromDate(d.toISOString().slice(0, 10)); setToDate(todayStr) }}
            style={{ padding: '9px 14px', background: '#fef3e2', color: '#d4881f', border: 'none', borderRadius: '8px', cursor: 'pointer', fontSize: '12px', fontWeight: '700' }}>This Month</button>
        </div>

        {loading || !pl ? <div style={{ padding: '60px', textAlign: 'center', color: '#a89478' }}>Loading...</div> : (
          <div style={{ background: 'white', borderRadius: '16px', border: '1px solid #f3ede4', padding: '24px', maxWidth: '560px' }}>
            <div style={{ fontSize: '11px', fontWeight: '700', color: '#a89478', textTransform: 'uppercase', marginBottom: '10px' }}>Revenue</div>
            {row('Repair Job Revenue', pl.jobRevenue, { indent: true })}
            {row('Parts Sales Revenue (gross)', pl.salesGross, { indent: true })}
            {pl.returnsTotal > 0 && row('Less: Sale Returns (credit)', pl.returnsTotal, { indent: true, negative: true, muted: true })}
            {row('Total Revenue', pl.totalRevenue, { bold: true, total: true })}

            <div style={{ fontSize: '11px', fontWeight: '700', color: '#a89478', textTransform: 'uppercase', margin: '20px 0 10px' }}>Cost of Sales</div>
            {row('Repair Job Cost', pl.jobCost, { indent: true })}
            {row('Parts Sold Cost (incl. 3rd-party)', pl.partsCost, { indent: true })}
            {row('Total Cost of Sales', pl.totalCOGS, { bold: true, total: true })}

            {row('Gross Profit', pl.grossProfit, { bold: true, total: true, color: pl.grossProfit >= 0 ? '#166534' : '#e11d48' })}
            <div style={{ fontSize: '11px', color: '#a89478', marginTop: '2px', marginBottom: '20px' }}>
              Margin: {pl.totalRevenue > 0 ? ((pl.grossProfit / pl.totalRevenue) * 100).toFixed(1) : '0.0'}%
            </div>

            <div style={{ fontSize: '11px', fontWeight: '700', color: '#a89478', textTransform: 'uppercase', marginBottom: '10px' }}>Operating Expenses</div>
            {pl.expensesByCategory.length === 0 ? (
              <div style={{ fontSize: '13px', color: '#a89478', padding: '6px 0 6px 16px' }}>No expenses recorded in this period.</div>
            ) : pl.expensesByCategory.map(([cat, amt]) => <div key={cat}>{row(cat, amt, { indent: true })}</div>)}
            {row('Total Operating Expenses', pl.totalExpenses, { bold: true, total: true })}

            {row('Net Profit', pl.netProfit, { bold: true, total: true, color: pl.netProfit >= 0 ? '#166534' : '#e11d48' })}
            <div style={{ fontSize: '11px', color: '#a89478', marginTop: '2px' }}>
              Margin: {pl.totalRevenue > 0 ? ((pl.netProfit / pl.totalRevenue) * 100).toFixed(1) : '0.0'}%
            </div>
          </div>
        )}
      </div>
    )
  }

  if (active) {
    const meta = REPORTS.find(r => r.id === active)
    return (
      <div>
        <button onClick={() => setActive(null)} style={{ background: 'none', border: 'none', color: '#d4881f', fontWeight: '700', fontSize: '13px', cursor: 'pointer', marginBottom: '14px', padding: 0 }}>← Back to Reports</button>
        <h1 style={{ fontSize: '20px', fontWeight: '800', color: '#1c1917', margin: '0 0 16px' }}>{meta.icon} {meta.label}</h1>
        {loading ? <div style={{ padding: '60px', textAlign: 'center', color: '#a89478' }}>Loading...</div> : rows.length === 0 ? (
          <div style={{ background: 'white', borderRadius: '16px', padding: '48px', textAlign: 'center', color: '#a89478', border: '1px solid #f3ede4' }}>No data available.</div>
        ) : (
          <div style={{ background: 'white', borderRadius: '16px', border: '1px solid #f3ede4', overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
              <thead><tr style={{ background: '#fdf8f3', borderBottom: '2px solid #f3ede4' }}>
                {Object.keys(rows[0]).map(k => <th key={k} style={{ padding: '9px 14px', textAlign: 'left', fontSize: '10px', fontWeight: '700', color: '#a89478', textTransform: 'uppercase' }}>{k.replace(/_/g, ' ')}</th>)}
              </tr></thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={i} style={{ borderBottom: '1px solid #f8f5f0', background: i % 2 === 0 ? 'white' : '#fdfbf8' }}>
                    {Object.entries(r).map(([k, v]) => (
                      <td key={k} style={{ padding: '9px 14px' }}>
                        {typeof v === 'number' && /total|profit|revenue|value|cost/i.test(k) ? formatLKR(v) : (v ?? '—')}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    )
  }

  return (
    <div>
      <h1 style={{ fontSize: '22px', fontWeight: '800', color: '#1c1917', margin: '0 0 4px' }}>Repair Reports</h1>
      <p style={{ color: '#8a7a63', fontSize: '14px', margin: '0 0 22px' }}>Reports for the Repair Division only</p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '14px' }}>
        {REPORTS.map(r => (
          <div key={r.id} onClick={() => openReport(r.id)}
            style={{ background: 'white', borderRadius: '16px', padding: '20px', border: '1px solid #f3ede4', cursor: 'pointer', boxShadow: '0 1px 3px rgba(28,25,23,0.05)', transition: 'transform 0.15s' }}
            onMouseEnter={e => e.currentTarget.style.transform = 'translateY(-2px)'} onMouseLeave={e => e.currentTarget.style.transform = 'translateY(0)'}>
            <div style={{ width: '38px', height: '38px', borderRadius: '11px', background: r.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '18px', marginBottom: '12px' }}>{r.icon}</div>
            <div style={{ fontSize: '14px', fontWeight: '700', color: '#1c1917' }}>{r.label}</div>
          </div>
        ))}
      </div>
    </div>
  )
}
