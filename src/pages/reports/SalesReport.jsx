import { useState, useEffect } from 'react'
import { supabase } from '../../supabase'
import { formatCurrency } from '../../lib/helpers'
import toast from 'react-hot-toast'

export default function SalesReport({ shops, onBack }) {
  const [data, setData] = useState([])
  const [loading, setLoading] = useState(false)
  const [shopFilter, setShopFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('confirmed')
  const [dateFrom, setDateFrom] = useState(() => {
    const d = new Date(); d.setDate(1); return d.toISOString().split('T')[0]
  })
  const [dateTo, setDateTo] = useState(new Date().toISOString().split('T')[0])
  const [salesmen, setSalesmen] = useState([])
  const [salesmanFilter, setSalesmanFilter] = useState('all')

  useEffect(() => {
    supabase.from('salesmen').select('*').order('name').then(({ data }) => setSalesmen(data || []))
    fetchData()
  }, [])

  async function fetchData() {
    setLoading(true)
    let query = supabase.from('sales_summary').select('*').order('created_at', { ascending: false })
    if (shopFilter !== 'all') query = query.eq('shop_id', shopFilter)
    if (statusFilter !== 'all') query = query.eq('status', statusFilter)
    if (dateFrom) query = query.gte('created_at', dateFrom)
    if (dateTo) query = query.lte('created_at', dateTo + 'T23:59:59')
    const { data, error } = await query
    if (error) toast.error('Failed to load report')
    else setData(data || [])
    setLoading(false)
  }

  const filtered = salesmanFilter === 'all' ? data : data.filter(r => r.salesman_name === salesmanFilter)

  const totalRevenue = filtered.reduce((s, r) => s + (r.total || 0), 0)
  const totalPaid = filtered.reduce((s, r) => s + (r.amount_paid || 0), 0)
  const totalCredit = filtered.reduce((s, r) => s + (r.credit_amount || 0), 0)
  const totalDiscount = filtered.reduce((s, r) => s + (r.discount_amount || 0), 0)

  function exportCSV() {
    const headers = ['Invoice No', 'Date', 'Customer', 'Customer No', 'Salesman', 'Shop', 'Subtotal', 'Discount', 'Total', 'Paid', 'Credit', 'Payment Method', 'Status']
    const rows = filtered.map(r => [
      r.invoice_no,
      new Date(r.created_at).toLocaleDateString('en-GB'),
      r.customer_name,
      r.customer_no,
      r.salesman_name,
      r.shop_name,
      r.subtotal,
      r.discount_amount,
      r.total,
      r.amount_paid,
      r.credit_amount,
      r.payment_method,
      r.status,
    ])
    const csv = [headers, ...rows].map(r => r.map(v => `"${v || ''}"`).join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `sales-report-${dateFrom}-${dateTo}.csv`
    a.click()
    URL.revokeObjectURL(url)
    toast.success('CSV downloaded!')
  }

  

  const inp = { padding: '9px 12px', border: '1.5px solid #e2e8f0', borderRadius: '7px', fontSize: '14px', outline: 'none', background: 'white' }


  function printReport() {
    const w = window.open('', '_blank')
    const dateStr = new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' })
    const fmt = n => (parseFloat(n)||0).toLocaleString('en-LK', { minimumFractionDigits: 2 })
    const rows = filtered.map((r,i) => `<tr>
      <td>${r.invoice_no||'—'}</td>
      <td>${new Date(r.created_at).toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'})}</td>
      <td><strong>${r.customer_name||'—'}</strong><br><span style="color:#94a3b8;font-size:9px">${r.customer_no||''}</span></td>
      <td>${r.salesman_name||'—'}</td>
      <td>${r.shop_name||'—'}</td>
      <td class="r">${fmt(r.total)}</td>
      <td class="r" style="color:#059669">${fmt(r.amount_paid)}</td>
      <td class="r" style="color:#e11d48">${r.credit_amount>0?fmt(r.credit_amount):'—'}</td>
      <td style="text-transform:capitalize">${r.payment_method?.replace('_',' ')||'—'}</td>
      <td class="c"><span style="padding:2px 6px;border-radius:10px;font-size:9px;font-weight:700;background:${r.status==='confirmed'?'#dcfce7':r.status==='draft'?'#fef3c7':'#fee2e2'};color:${r.status==='confirmed'?'#166534':r.status==='draft'?'#92400e':'#991b1b'}">${r.status}</span></td>
    </tr>`).join('')
    w.document.write(`<!DOCTYPE html><html><head><title>Sales Report</title><style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:Arial,sans-serif;font-size:11px;color:#1e293b;padding:16px}.hdr{border-bottom:3px solid #1e40af;padding-bottom:10px;margin-bottom:14px}.co{font-size:19px;font-weight:900;color:#1e40af;letter-spacing:1px}.ttl{font-size:14px;font-weight:700;color:#0f172a;margin-top:3px}.sub{font-size:10px;color:#64748b;margin-top:2px}.summary{display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:10px;margin-bottom:14px}.card{border:1.5px solid #e2e8f0;border-radius:8px;padding:10px 14px}.lbl{font-size:9px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px}.val{font-size:15px;font-weight:800}table{width:100%;border-collapse:collapse;font-size:10px}thead tr{background:#0f172a;color:white}thead th{padding:7px 8px;font-size:9px;font-weight:700;text-transform:uppercase;white-space:nowrap;text-align:left}thead th.r{text-align:right}thead th.c{text-align:center}tbody tr:nth-child(even){background:#f8fafc}tbody td{padding:5px 8px;border-bottom:1px solid #f1f5f9;vertical-align:middle}tbody td.r{text-align:right}tbody td.c{text-align:center}tfoot tr{background:#1e293b;color:white}tfoot td{padding:8px;font-weight:800;font-size:11px}tfoot td.r{text-align:right}.ftr{margin-top:14px;border-top:2px solid #e2e8f0;padding-top:8px;text-align:center;font-size:9px;color:#94a3b8;font-weight:700}@media print{@page{size:A4 landscape;margin:8mm}body{padding:0}}</style></head><body>
      <div class="hdr"><div class="co">IPHIX TECHNOLOGIES</div><div class="ttl">Sales Report</div><div class="sub">${dateFrom} to ${dateTo} &nbsp;·&nbsp; ${filtered.length} records &nbsp;·&nbsp; Generated ${dateStr}</div></div>
      <div class="summary">
        <div class="card"><div class="lbl">Total Revenue</div><div class="val" style="color:#1e40af">LKR ${fmt(totalRevenue)}</div></div>
        <div class="card"><div class="lbl">Total Collected</div><div class="val" style="color:#059669">LKR ${fmt(totalPaid)}</div></div>
        <div class="card"><div class="lbl">Credit Due</div><div class="val" style="color:#e11d48">LKR ${fmt(totalCredit)}</div></div>
        <div class="card"><div class="lbl">Discounts</div><div class="val" style="color:#d97706">LKR ${fmt(totalDiscount)}</div></div>
      </div>
      <table><thead><tr><th>Invoice No</th><th>Date</th><th>Customer</th><th>Salesman</th><th>Shop</th><th class="r">Total</th><th class="r">Paid</th><th class="r">Credit</th><th>Method</th><th class="c">Status</th></tr></thead>
      <tbody>${rows}</tbody>
      <tfoot><tr><td colspan="5">TOTALS — ${filtered.length} invoices</td><td class="r" style="color:#fbbf24">LKR ${fmt(totalRevenue)}</td><td class="r" style="color:#6ee7b7">LKR ${fmt(totalPaid)}</td><td class="r" style="color:#fca5a5">LKR ${fmt(totalCredit)}</td><td colspan="2"></td></tr></tfoot>
      </table>
      <div class="ftr">Designed for iPHIX Technologies &nbsp;·&nbsp; Powered by Techmo Solutions &nbsp;·&nbsp; ${dateStr}</div>
      <script>window.onload=function(){window.print()}<\/script></body></html>`)
    w.document.close()
  }

  return (
    <div>
      <style>{`@media print { .no-print { display: none !important; } }`}</style>
      <div className="no-print" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
        <div>
          <button onClick={onBack} style={{ background: 'none', border: 'none', color: '#2563eb', cursor: 'pointer', fontSize: '14px', fontWeight: '600', padding: 0, marginBottom: '6px', display: 'block' }}>← Back to Reports</button>
          <h1 style={{ fontSize: '22px', fontWeight: '700', color: '#0f172a', margin: 0 }}>Sales Report</h1>
        </div>
        <div style={{ display: 'flex', gap: '10px' }}>
          <button onClick={exportCSV} style={{ padding: '9px 18px', background: '#f0fdf4', color: '#059669', border: '1.5px solid #bbf7d0', borderRadius: '10px', cursor: 'pointer', fontWeight: '700', fontSize: '13px' }}>⬇ Export CSV</button>
          <button onClick={printReport} style={{ padding: '9px 18px', background: '#eef2ff', color: '#2563eb', border: '1.5px solid #bfdbfe', borderRadius: '10px', cursor: 'pointer', fontWeight: '700', fontSize: '13px' }}>🖨 Print PDF</button>
        </div>
      </div>

      {/* Filters */}
      <div className="no-print" style={{ background: 'white', borderRadius: '12px', padding: '16px 20px', boxShadow: '0 1px 3px rgba(15,23,42,0.06), 0 1px 2px rgba(15,23,42,0.04)', marginBottom: '20px', display: 'flex', gap: '12px', flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <div>
          <div style={{ fontSize: '11px', fontWeight: '700', color: '#94a3b8', textTransform: 'uppercase', marginBottom: '5px' }}>From</div>
          <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} style={inp} />
        </div>
        <div>
          <div style={{ fontSize: '11px', fontWeight: '700', color: '#94a3b8', textTransform: 'uppercase', marginBottom: '5px' }}>To</div>
          <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} style={inp} />
        </div>
        <div>
          <div style={{ fontSize: '11px', fontWeight: '700', color: '#94a3b8', textTransform: 'uppercase', marginBottom: '5px' }}>Shop</div>
          <select value={shopFilter} onChange={e => setShopFilter(e.target.value)} style={inp}>
            <option value="all">All Shops</option>
            {shops.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
        <div>
          <div style={{ fontSize: '11px', fontWeight: '700', color: '#94a3b8', textTransform: 'uppercase', marginBottom: '5px' }}>Salesman</div>
          <select value={salesmanFilter} onChange={e => setSalesmanFilter(e.target.value)} style={inp}>
            <option value="all">All Salesmen</option>
            {salesmen.map(s => <option key={s.id} value={s.name}>{s.name}</option>)}
          </select>
        </div>
        <div>
          <div style={{ fontSize: '11px', fontWeight: '700', color: '#94a3b8', textTransform: 'uppercase', marginBottom: '5px' }}>Status</div>
          <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} style={inp}>
            <option value="all">All</option>
            <option value="confirmed">Confirmed</option>
            <option value="draft">Draft</option>
            <option value="cancelled">Cancelled</option>
          </select>
        </div>
        <button onClick={fetchData} style={{ padding: '9px 20px', background: 'linear-gradient(135deg,#2563eb,#1d4ed8)', color: 'white', border: 'none', borderRadius: '10px', cursor: 'pointer', fontWeight: '700', fontSize: '14px' }}>
          Apply Filters
        </button>
      </div>

      {/* Summary cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: '16px', marginBottom: '20px' }}>
        {[
          { label: 'Total Revenue', value: formatCurrency(totalRevenue), color: '#1e40af' },
          { label: 'Total Collected', value: formatCurrency(totalPaid), color: '#059669' },
          { label: 'Total Credit Due', value: formatCurrency(totalCredit), color: '#e11d48' },
          { label: 'Total Discounts', value: formatCurrency(totalDiscount), color: '#d97706' },
        ].map(s => (
          <div key={s.label} style={{ background: 'white', borderRadius: '12px', padding: '18px', boxShadow: '0 1px 3px rgba(15,23,42,0.06), 0 1px 2px rgba(15,23,42,0.04)', borderLeft: `4px solid ${s.color}` }}>
            <div style={{ fontSize: '11px', fontWeight: '700', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '6px' }}>{s.label}</div>
            <div style={{ fontSize: '20px', fontWeight: '800', color: s.color }}>{s.value}</div>
            <div style={{ fontSize: '12px', color: '#94a3b8', marginTop: '3px' }}>{filtered.length} invoice{filtered.length !== 1 ? 's' : ''}</div>
          </div>
        ))}
      </div>

      {/* Table */}
      <div style={{ background: 'white', borderRadius: '12px', boxShadow: '0 1px 3px rgba(15,23,42,0.06), 0 1px 2px rgba(15,23,42,0.04)', overflow: 'hidden' }}>
        <div style={{ padding: '16px 20px', borderBottom: '1px solid #f1f5f9', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 style={{ fontSize: '15px', fontWeight: '700', color: '#0f172a', margin: 0 }}>Sales Transactions</h2>
          <span style={{ fontSize: '13px', color: '#94a3b8' }}>{filtered.length} records</span>
        </div>
        {loading ? <div style={{ padding: '40px', textAlign: 'center', color: '#94a3b8' }}>Loading...</div>
        : filtered.length === 0 ? (
          <div style={{ padding: '40px', textAlign: 'center', color: '#94a3b8' }}>
            <div style={{ fontSize: '32px', marginBottom: '8px' }}>🧾</div>No records found
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '900px' }}>
              <thead>
                <tr style={{ background: '#f8fafc', borderBottom: '2px solid #e2e8f0' }}>
                  {['Invoice No', 'Date', 'Customer', 'Salesman', 'Shop', 'Total', 'Paid', 'Credit', 'Method', 'Status'].map(h => (
                    <th key={h} style={{ padding: '10px 14px', textAlign: 'left', fontSize: '11px', fontWeight: '700', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.06em', whiteSpace: 'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((r, i) => (
                  <tr key={r.id} style={{ borderBottom: '1px solid #f1f5f9', background: i % 2 === 0 ? 'white' : '#fafafa' }}>
                    <td style={{ padding: '10px 14px', fontWeight: '700', color: '#2563eb', fontSize: '13px' }}>{r.invoice_no}</td>
                    <td style={{ padding: '10px 14px', fontSize: '13px', color: '#64748b', whiteSpace: 'nowrap' }}>{new Date(r.created_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}</td>
                    <td style={{ padding: '10px 14px', fontSize: '13px', color: '#0f172a', fontWeight: '500' }}>{r.customer_name}</td>
                    <td style={{ padding: '10px 14px', fontSize: '13px', color: '#64748b' }}>{r.salesman_name || '—'}</td>
                    <td style={{ padding: '10px 14px', fontSize: '13px', color: '#64748b' }}>{r.shop_name}</td>
                    <td style={{ padding: '10px 14px', fontSize: '13px', fontWeight: '700', color: '#0f172a' }}>{formatCurrency(r.total)}</td>
                    <td style={{ padding: '10px 14px', fontSize: '13px', fontWeight: '600', color: '#059669' }}>{formatCurrency(r.amount_paid)}</td>
                    <td style={{ padding: '10px 14px', fontSize: '13px', fontWeight: '600', color: r.credit_amount > 0 ? '#e11d48' : '#94a3b8' }}>{r.credit_amount > 0 ? formatCurrency(r.credit_amount) : '—'}</td>
                    <td style={{ padding: '10px 14px', fontSize: '12px', color: '#64748b', textTransform: 'capitalize' }}>{r.payment_method?.replace('_', ' ')}</td>
                    <td style={{ padding: '10px 14px' }}>
                      <span style={{ background: r.status === 'confirmed' ? '#dcfce7' : r.status === 'draft' ? '#fef3c7' : '#fee2e2', color: r.status === 'confirmed' ? '#166534' : r.status === 'draft' ? '#92400e' : '#991b1b', padding: '2px 8px', borderRadius: '12px', fontSize: '11px', fontWeight: '700' }}>
                        {r.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr style={{ background: '#0f172a', borderTop: '2px solid #e2e8f0' }}>
                  <td colSpan={5} style={{ padding: '12px 14px', fontSize: '13px', fontWeight: '700', color: '#94a3b8' }}>TOTALS ({filtered.length} records)</td>
                  <td style={{ padding: '12px 14px', fontSize: '14px', fontWeight: '800', color: 'white' }}>{formatCurrency(totalRevenue)}</td>
                  <td style={{ padding: '12px 14px', fontSize: '14px', fontWeight: '800', color: '#4ade80' }}>{formatCurrency(totalPaid)}</td>
                  <td style={{ padding: '12px 14px', fontSize: '14px', fontWeight: '800', color: '#f87171' }}>{formatCurrency(totalCredit)}</td>
                  <td colSpan={2}></td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
