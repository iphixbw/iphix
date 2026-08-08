import { useState, useEffect } from 'react'
import { supabase } from '../../supabase'
import { formatCurrency } from '../../lib/helpers'
import toast from 'react-hot-toast'

const STATUS_COLORS = {
  pending:  { bg: '#fef3c7', color: '#92400e', label: 'Pending' },
  ordered:  { bg: '#dbeafe', color: '#1e40af', label: 'Ordered' },
  received: { bg: '#dcfce7', color: '#166534', label: 'Received' },
  paid:     { bg: '#f0fdf4', color: '#059669', label: 'Paid' },
  cancelled:{ bg: '#fee2e2', color: '#991b1b', label: 'Cancelled' },
}

export default function ThirdPartyReport() {
  const [records, setRecords] = useState([])
  const [loading, setLoading] = useState(true)
  const [selectedRecord, setSelectedRecord] = useState(null)
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [supplierFilter, setSupplierFilter] = useState('')
  const [search, setSearch] = useState('')
  const [suppliers, setSuppliers] = useState([])

  useEffect(() => { fetchData() }, [])

  async function fetchData() {
    setLoading(true)
    const { data, error } = await supabase
      .from('third_party_procurement')
      .select('*, invoices(invoice_no, created_at, customers(name), shops(name))')
      .order('created_at', { ascending: false })
    if (error) toast.error('Failed to load')
    else {
      setRecords(data || [])
      setSuppliers([...new Set((data || []).map(r => r.supplier_name).filter(Boolean))])
    }
    setLoading(false)
  }

  const filtered = records.filter(r => {
    const matchSearch = !search ||
      r.item_name?.toLowerCase().includes(search.toLowerCase()) ||
      r.supplier_name?.toLowerCase().includes(search.toLowerCase()) ||
      r.invoices?.invoice_no?.toLowerCase().includes(search.toLowerCase()) ||
      r.invoices?.customers?.name?.toLowerCase().includes(search.toLowerCase())
    const matchStatus = statusFilter === 'all' || r.payment_status === statusFilter
    const matchSupplier = !supplierFilter || r.supplier_name === supplierFilter
    const matchFrom = !dateFrom || new Date(r.created_at) >= new Date(dateFrom)
    const matchTo = !dateTo || new Date(r.created_at) <= new Date(dateTo + 'T23:59:59')
    return matchSearch && matchStatus && matchSupplier && matchFrom && matchTo
  })

  const totalSale = filtered.reduce((s, r) => s + (r.sale_price || 0), 0)
  const totalCost = filtered.reduce((s, r) => s + (r.cost_price || 0), 0)
  const totalProfit = totalSale - totalCost

  const inp = { padding: '8px 12px', border: '1.5px solid #e2e8f0', borderRadius: '7px', fontSize: '13px', outline: 'none', background: 'white' }


  function printReport() {
    const w = window.open('', '_blank')
    const dateStr = new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' })
    const fmt = n => (parseFloat(n)||0).toLocaleString('en-LK', { minimumFractionDigits: 2 })
    const rows = filtered.map((r,i) => `<tr>
      <td>${new Date(r.created_at).toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'})}</td>
      <td><strong>${r.item_name||'—'}</strong></td>
      <td>${r.supplier_name||'—'}</td>
      <td style="color:#2563eb;font-weight:700">${r.invoices?.invoice_no||'—'}</td>
      <td>${r.invoices?.customers?.name||'—'}</td>
      <td class="r" style="color:#059669;font-weight:700">${fmt(r.sale_price)}</td>
      <td class="r" style="color:#e11d48">${r.cost_price?fmt(r.cost_price):'—'}</td>
      <td class="r" style="color:${(r.sale_price||0)-(r.cost_price||0)>=0?'#059669':'#e11d48'};font-weight:700">${r.cost_price?fmt((r.sale_price||0)-(r.cost_price||0)):'—'}</td>
      <td class="c"><span style="padding:2px 6px;border-radius:10px;font-size:9px;font-weight:700;background:#dcfce7;color:#166534">${r.payment_status||'—'}</span></td>
    </tr>`).join('')
    w.document.write(`<!DOCTYPE html><html><head><title>3rd Party Report</title><style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:Arial,sans-serif;font-size:11px;color:#1e293b;padding:16px}.hdr{border-bottom:3px solid #1e40af;padding-bottom:10px;margin-bottom:14px}.co{font-size:19px;font-weight:900;color:#1e40af;letter-spacing:1px}.ttl{font-size:14px;font-weight:700;color:#0f172a;margin-top:3px}.sub{font-size:10px;color:#64748b;margin-top:2px}.summary{display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:10px;margin-bottom:14px}.card{border:1.5px solid #e2e8f0;border-radius:8px;padding:10px 14px}.lbl{font-size:9px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px}.val{font-size:15px;font-weight:800}table{width:100%;border-collapse:collapse;font-size:10px}thead tr{background:#0f172a;color:white}thead th{padding:7px 8px;font-size:9px;font-weight:700;text-transform:uppercase;white-space:nowrap;text-align:left}thead th.r{text-align:right}thead th.c{text-align:center}tbody tr:nth-child(even){background:#f8fafc}tbody td{padding:5px 8px;border-bottom:1px solid #f1f5f9;vertical-align:middle}tbody td.r{text-align:right}tbody td.c{text-align:center}tfoot tr{background:#1e293b;color:white}tfoot td{padding:8px;font-weight:800;font-size:11px}tfoot td.r{text-align:right}.ftr{margin-top:14px;border-top:2px solid #e2e8f0;padding-top:8px;text-align:center;font-size:9px;color:#94a3b8;font-weight:700}@media print{@page{size:A4 landscape;margin:8mm}body{padding:0}}</style></head><body>
      <div class="hdr"><div class="co">IPHIX TECHNOLOGIES</div><div class="ttl">Third Party Procurement Report</div><div class="sub">${filtered.length} records &nbsp;·&nbsp; Generated ${dateStr}</div></div>
      <div class="summary">
        <div class="card"><div class="lbl">Total Entries</div><div class="val" style="color:#1e40af">${filtered.length}</div></div>
        <div class="card"><div class="lbl">Sale Value</div><div class="val" style="color:#059669">LKR ${fmt(totalSale)}</div></div>
        <div class="card"><div class="lbl">Cost Value</div><div class="val" style="color:#e11d48">LKR ${fmt(totalCost)}</div></div>
        <div class="card"><div class="lbl">Gross Profit</div><div class="val" style="color:${totalProfit>=0?'#059669':'#e11d48'}">LKR ${fmt(totalProfit)}</div></div>
      </div>
      <table><thead><tr><th>Date</th><th>Item</th><th>Supplier</th><th>Invoice</th><th>Customer</th><th class="r">Sale Price</th><th class="r">Cost Price</th><th class="r">Profit</th><th class="c">Status</th></tr></thead>
      <tbody>${rows}</tbody>
      <tfoot><tr><td colspan="5">TOTALS — ${filtered.length} records</td><td class="r" style="color:#6ee7b7">LKR ${fmt(totalSale)}</td><td class="r" style="color:#fca5a5">LKR ${fmt(totalCost)}</td><td class="r" style="color:${totalProfit>=0?'#6ee7b7':'#fca5a5'}">LKR ${fmt(totalProfit)}</td><td></td></tr></tfoot>
      </table>
      <div class="ftr">Designed for iPHIX Technologies &nbsp;·&nbsp; Powered by Techmo Solutions &nbsp;·&nbsp; ${dateStr}</div>
      <script>window.onload=function(){window.print()}<\/script></body></html>`)
    w.document.close()
  }

  return (
    <div>
      {selectedRecord && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ background: 'white', borderRadius: '16px', padding: '28px', width: '460px', boxShadow: '0 20px 60px rgba(0,0,0,0.3)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '18px' }}>
              <h2 style={{ fontSize: '17px', fontWeight: '700', color: '#0f172a', margin: 0 }}>3rd Party Detail</h2>
              <button onClick={() => setSelectedRecord(null)} style={{ background: '#f1f5f9', border: 'none', borderRadius: '6px', padding: '6px 12px', cursor: 'pointer', color: '#64748b' }}>✕ Close</button>
            </div>
            {[
              { label: 'Item', value: selectedRecord.item_name },
              { label: 'Supplier', value: selectedRecord.supplier_name || '—' },
              { label: 'Supplier Phone', value: selectedRecord.supplier_phone || '—' },
              { label: 'Invoice No', value: selectedRecord.invoices?.invoice_no || '—' },
              { label: 'Customer', value: selectedRecord.invoices?.customers?.name || '—' },
              { label: 'Shop', value: selectedRecord.invoices?.shops?.name || '—' },
              { label: 'Date', value: new Date(selectedRecord.created_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' }) },
              { label: 'Sale Price', value: formatCurrency(selectedRecord.sale_price || 0), color: '#059669' },
              { label: 'Cost Price', value: selectedRecord.cost_price ? formatCurrency(selectedRecord.cost_price) : 'Not set', color: '#e11d48' },
              { label: 'Profit', value: selectedRecord.cost_price ? formatCurrency((selectedRecord.sale_price||0)-(selectedRecord.cost_price||0)) : '—', color: '#1e40af' },
              { label: 'Reference', value: selectedRecord.reference || '—' },
              { label: 'Notes', value: selectedRecord.notes || '—' },
            ].map(row => (
              <div key={row.label} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid #f1f5f9', fontSize: '13px' }}>
                <span style={{ color: '#64748b', fontWeight: '600' }}>{row.label}</span>
                <span style={{ fontWeight: '700', color: row.color || '#0f172a', maxWidth: '240px', textAlign: 'right' }}>{row.value}</span>
              </div>
            ))}
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', fontSize: '13px', marginTop: '4px' }}>
              <span style={{ color: '#64748b', fontWeight: '600' }}>Payment Status</span>
              <span style={{ background: STATUS_COLORS[selectedRecord.payment_status]?.bg, color: STATUS_COLORS[selectedRecord.payment_status]?.color, padding: '2px 10px', borderRadius: '12px', fontSize: '12px', fontWeight: '700' }}>
                {STATUS_COLORS[selectedRecord.payment_status]?.label || selectedRecord.payment_status}
              </span>
            </div>
          </div>
        </div>
      )}

      <div style={{ marginBottom: '24px' }}>
        <h1 style={{ fontSize: '22px', fontWeight: '700', color: '#0f172a', margin: '0 0 4px' }}>3rd Party Procurement Report</h1>
        <p style={{ color: '#64748b', fontSize: '14px', margin: 0 }}>All third-party items sourced through invoices</p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: '14px', marginBottom: '24px' }}>
        {[
          { label: 'Total Entries', value: filtered.length, color: '#1e40af' },
          { label: 'Sale Value', value: formatCurrency(totalSale), color: '#059669' },
          { label: 'Cost Value', value: formatCurrency(totalCost), color: '#e11d48' },
          { label: 'Gross Profit', value: formatCurrency(totalProfit), color: totalProfit >= 0 ? '#059669' : '#e11d48' },
        ].map(s => (
          <div key={s.label} style={{ background: 'white', borderRadius: '12px', padding: '16px', boxShadow: '0 1px 3px rgba(15,23,42,0.06), 0 1px 2px rgba(15,23,42,0.04)', borderLeft: `4px solid ${s.color}` }}>
            <div style={{ fontSize: '11px', fontWeight: '700', color: '#94a3b8', textTransform: 'uppercase', marginBottom: '4px' }}>{s.label}</div>
            <div style={{ fontSize: '18px', fontWeight: '800', color: s.color }}>{s.value}</div>
          </div>
        ))}
      </div>

      <div style={{ background: 'white', borderRadius: '12px', padding: '14px 16px', boxShadow: '0 1px 3px rgba(15,23,42,0.06), 0 1px 2px rgba(15,23,42,0.04)', marginBottom: '16px', display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'center' }}>
        <input type="text" placeholder="Search item, supplier, invoice, customer…" value={search} onChange={e => setSearch(e.target.value)} style={{ ...inp, width: '260px' }} />
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} style={inp}>
          <option value="all">All Statuses</option>
          {Object.entries(STATUS_COLORS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
        <select value={supplierFilter} onChange={e => setSupplierFilter(e.target.value)} style={inp}>
          <option value="">All Suppliers</option>
          {suppliers.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} style={inp} />
        <span style={{ color: '#94a3b8', fontSize: '12px' }}>to</span>
        <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} style={inp} />
        {(search || statusFilter !== 'all' || supplierFilter || dateFrom || dateTo) && (
          <button onClick={() => { setSearch(''); setStatusFilter('all'); setSupplierFilter(''); setDateFrom(''); setDateTo('') }}
            style={{ ...inp, background: '#f1f5f9', color: '#64748b', cursor: 'pointer', fontWeight: '600' }}>Clear</button>
        )}
      </div>

      <div style={{ background: 'white', borderRadius: '12px', boxShadow: '0 1px 3px rgba(15,23,42,0.06), 0 1px 2px rgba(15,23,42,0.04)', overflow: 'hidden' }}>
        {loading ? <div style={{ padding: '60px', textAlign: 'center', color: '#94a3b8' }}>Loading...</div>
        : filtered.length === 0 ? <div style={{ padding: '60px', textAlign: 'center', color: '#94a3b8' }}><div style={{ fontSize: '36px', marginBottom: '10px' }}>🔍</div>No records found</div>
        : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: '#f8fafc', borderBottom: '2px solid #e2e8f0' }}>
                {['Date','Item','Supplier','Invoice','Customer','Sale Price','Cost Price','Profit','Status',''].map(h => (
                  <th key={h} style={{ padding: '10px 12px', textAlign: 'left', fontSize: '11px', fontWeight: '700', color: '#94a3b8', textTransform: 'uppercase', whiteSpace: 'nowrap' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((r, i) => {
                const profit = (r.sale_price || 0) - (r.cost_price || 0)
                const sc = STATUS_COLORS[r.payment_status] || STATUS_COLORS.pending
                return (
                  <tr key={r.id} style={{ borderBottom: '1px solid #f1f5f9', background: i % 2 === 0 ? 'white' : '#fafafa', cursor: 'pointer' }}
                    onMouseEnter={e => e.currentTarget.style.background = '#f5f3ff'}
                    onMouseLeave={e => e.currentTarget.style.background = i % 2 === 0 ? 'white' : '#fafafa'}
                    onClick={() => setSelectedRecord(r)}>
                    <td style={{ padding: '10px 12px', fontSize: '12px', color: '#64748b', whiteSpace: 'nowrap' }}>{new Date(r.created_at).toLocaleDateString('en-GB', { day:'2-digit', month:'short', year:'numeric' })}</td>
                    <td style={{ padding: '10px 12px', fontWeight: '600', color: '#0f172a', maxWidth: '140px' }}><div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.item_name}</div></td>
                    <td style={{ padding: '10px 12px', fontSize: '12px', color: '#64748b' }}>{r.supplier_name || '—'}</td>
                    <td style={{ padding: '10px 12px', fontWeight: '700', color: '#2563eb', fontSize: '12px' }}>{r.invoices?.invoice_no || '—'}</td>
                    <td style={{ padding: '10px 12px', fontSize: '12px', color: '#64748b' }}>{r.invoices?.customers?.name || '—'}</td>
                    <td style={{ padding: '10px 12px', fontWeight: '700', color: '#059669' }}>{formatCurrency(r.sale_price || 0)}</td>
                    <td style={{ padding: '10px 12px', fontWeight: '600', color: r.cost_price ? '#e11d48' : '#94a3b8' }}>{r.cost_price ? formatCurrency(r.cost_price) : '—'}</td>
                    <td style={{ padding: '10px 12px', fontWeight: '700', color: profit > 0 ? '#059669' : profit < 0 ? '#e11d48' : '#94a3b8' }}>{r.cost_price ? formatCurrency(profit) : '—'}</td>
                    <td style={{ padding: '10px 12px' }}><span style={{ background: sc.bg, color: sc.color, padding: '2px 8px', borderRadius: '12px', fontSize: '11px', fontWeight: '700' }}>{sc.label}</span></td>
                    <td style={{ padding: '10px 12px', fontSize: '12px', color: '#2563eb', fontWeight: '600' }}>View →</td>
                  </tr>
                )
              })}
            </tbody>
            <tfoot>
              <tr style={{ background: '#f8fafc', borderTop: '2px solid #e2e8f0' }}>
                <td colSpan={5} style={{ padding: '12px', fontWeight: '700', fontSize: '13px', color: '#0f172a' }}>Totals ({filtered.length} records)</td>
                <td style={{ padding: '12px', fontWeight: '800', color: '#059669' }}>{formatCurrency(totalSale)}</td>
                <td style={{ padding: '12px', fontWeight: '800', color: '#e11d48' }}>{formatCurrency(totalCost)}</td>
                <td style={{ padding: '12px', fontWeight: '800', color: totalProfit >= 0 ? '#059669' : '#e11d48' }}>{formatCurrency(totalProfit)}</td>
                <td colSpan={2}></td>
              </tr>
            </tfoot>
          </table>
        )}
      </div>
    </div>
  )
}
