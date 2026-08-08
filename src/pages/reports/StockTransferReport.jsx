import { useState, useEffect } from 'react'
import { supabase } from '../../supabase'
import toast from 'react-hot-toast'

export default function StockTransferReport({ shops, onBack }) {
  const [data, setData] = useState([])
  const [items, setItems] = useState([]) // transfer line items
  const [loading, setLoading] = useState(false)
  const [shopFilter, setShopFilter] = useState('all') // 'all', from:id, to:id
  const [shopDirection, setShopDirection] = useState('any') // 'any','from','to'
  const [statusFilter, setStatusFilter] = useState('confirmed')
  const [dateFrom, setDateFrom] = useState(() => { const d = new Date(); d.setDate(1); return d.toISOString().split('T')[0] })
  const [dateTo, setDateTo] = useState(new Date().toISOString().split('T')[0])
  const [expandedId, setExpandedId] = useState(null)
  const [lineItems, setLineItems] = useState({}) // { transfer_id: [items] }
  const [search, setSearch] = useState('')

  useEffect(() => { fetchData() }, [])

  async function fetchData() {
    setLoading(true)
    let query = supabase
      .from('stock_transfers')
      .select(`
        *,
        from_shop:shops!stock_transfers_from_shop_id_fkey(name),
        to_shop:shops!stock_transfers_to_shop_id_fkey(name)
      `)
      .order('created_at', { ascending: false })
    if (statusFilter !== 'all') query = query.eq('status', statusFilter)
    if (dateFrom) query = query.gte('created_at', dateFrom)
    if (dateTo) query = query.lte('created_at', dateTo + 'T23:59:59')
    if (shopFilter !== 'all') {
      if (shopDirection === 'from') query = query.eq('from_shop_id', shopFilter)
      else if (shopDirection === 'to') query = query.eq('to_shop_id', shopFilter)
      else query = query.or(`from_shop_id.eq.${shopFilter},to_shop_id.eq.${shopFilter}`)
    }
    const { data, error } = await query
    if (error) toast.error('Failed to load')
    else setData(data || [])
    setLoading(false)
  }

  async function loadLineItems(transferId) {
    if (lineItems[transferId]) {
      setExpandedId(expandedId === transferId ? null : transferId)
      return
    }
    const { data } = await supabase
      .from('stock_transfer_items')
      .select('*, items(name, item_no)')
      .eq('transfer_id', transferId)
    setLineItems(prev => ({ ...prev, [transferId]: data || [] }))
    setExpandedId(transferId)
  }

  const filtered = data.filter(t =>
    !search ||
    t.transfer_no?.toLowerCase().includes(search.toLowerCase()) ||
    t.from_shop?.name?.toLowerCase().includes(search.toLowerCase()) ||
    t.to_shop?.name?.toLowerCase().includes(search.toLowerCase())
  )

  function exportCSV() {
    const headers = ['Transfer No', 'Date', 'From Shop', 'To Shop', 'Status', 'Notes']
    const rows = filtered.map(t => [
      t.transfer_no,
      new Date(t.created_at).toLocaleDateString('en-GB'),
      t.from_shop?.name,
      t.to_shop?.name,
      t.status,
      t.notes || '',
    ])
    const csv = [headers, ...rows].map(r => r.map(v => `"${v || ''}"`).join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a'); a.href = url; a.download = `stock-transfers-${dateFrom}-${dateTo}.csv`; a.click()
    URL.revokeObjectURL(url); toast.success('CSV downloaded!')
  }

  const inp = { padding: '9px 12px', border: '1.5px solid #e2e8f0', borderRadius: '7px', fontSize: '14px', outline: 'none', background: 'white' }


  function printReport() {
    const w = window.open('', '_blank')
    const dateStr = new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' })
    const rows = filtered.map((t,i) => `<tr>
      <td>${t.transfer_no||'—'}</td>
      <td>${new Date(t.created_at).toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'})}</td>
      <td style="color:#e11d48;font-weight:700">${t.from_shop?.name||'—'}</td>
      <td style="color:#94a3b8;text-align:center">→</td>
      <td style="color:#059669;font-weight:700">${t.to_shop?.name||'—'}</td>
      <td class="c"><span style="padding:2px 6px;border-radius:10px;font-size:9px;font-weight:700;background:${t.status==='confirmed'?'#dcfce7':'#fef3c7'};color:${t.status==='confirmed'?'#166534':'#92400e'}">${t.status}</span></td>
      <td>${t.notes||'—'}</td>
    </tr>`).join('')
    w.document.write(`<!DOCTYPE html><html><head><title>Stock Transfer Report</title><style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:Arial,sans-serif;font-size:11px;color:#1e293b;padding:16px}.hdr{border-bottom:3px solid #1e40af;padding-bottom:10px;margin-bottom:14px}.co{font-size:19px;font-weight:900;color:#1e40af;letter-spacing:1px}.ttl{font-size:14px;font-weight:700;color:#0f172a;margin-top:3px}.sub{font-size:10px;color:#64748b;margin-top:2px}.summary{display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:10px;margin-bottom:14px}.card{border:1.5px solid #e2e8f0;border-radius:8px;padding:10px 14px}.lbl{font-size:9px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px}.val{font-size:15px;font-weight:800}table{width:100%;border-collapse:collapse;font-size:10px}thead tr{background:#0f172a;color:white}thead th{padding:7px 8px;font-size:9px;font-weight:700;text-transform:uppercase;white-space:nowrap;text-align:left}thead th.r{text-align:right}thead th.c{text-align:center}tbody tr:nth-child(even){background:#f8fafc}tbody td{padding:5px 8px;border-bottom:1px solid #f1f5f9;vertical-align:middle}tbody td.r{text-align:right}tbody td.c{text-align:center}tfoot tr{background:#1e293b;color:white}tfoot td{padding:8px;font-weight:800;font-size:11px}tfoot td.r{text-align:right}.ftr{margin-top:14px;border-top:2px solid #e2e8f0;padding-top:8px;text-align:center;font-size:9px;color:#94a3b8;font-weight:700}@media print{@page{size:A4 landscape;margin:8mm}body{padding:0}}</style></head><body>
      <div class="hdr"><div class="co">PHONEFIX (PVT) LTD</div><div class="ttl">Stock Transfer Report</div><div class="sub">${dateFrom} to ${dateTo} &nbsp;·&nbsp; ${filtered.length} transfers &nbsp;·&nbsp; Generated ${dateStr}</div></div>
      <div class="summary">
        <div class="card"><div class="lbl">Total Transfers</div><div class="val" style="color:#1e40af">${filtered.length}</div></div>
        <div class="card"><div class="lbl">Confirmed</div><div class="val" style="color:#059669">${filtered.filter(t=>t.status==='confirmed').length}</div></div>
        <div class="card"><div class="lbl">Drafts</div><div class="val" style="color:#d97706">${filtered.filter(t=>t.status==='draft').length}</div></div>
      </div>
      <table><thead><tr><th>Transfer No</th><th>Date</th><th>From Shop</th><th class="c">→</th><th>To Shop</th><th class="c">Status</th><th>Notes</th></tr></thead>
      <tbody>${rows}</tbody>
      <tfoot><tr><td colspan="7" style="color:#94a3b8">TOTALS — ${filtered.length} transfers (${filtered.filter(t=>t.status==='confirmed').length} confirmed)</td></tr></tfoot>
      </table>
      <div class="ftr">Designed for Phonefix (PVT) Ltd &nbsp;·&nbsp; Powered by Techmo Solutions &nbsp;·&nbsp; ${dateStr}</div>
      <script>window.onload=function(){window.print()}<\/script></body></html>`)
    w.document.close()
  }

  return (
    <div>
      <style>{`@media print { .no-print { display: none !important; } }`}</style>

      <div className="no-print" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
        <div>
          <button onClick={onBack} style={{ background: 'none', border: 'none', color: '#2563eb', cursor: 'pointer', fontSize: '14px', fontWeight: '600', padding: 0, marginBottom: '6px', display: 'block' }}>← Back to Reports</button>
          <h1 style={{ fontSize: '22px', fontWeight: '700', color: '#0f172a', margin: 0 }}>Stock Transfer Report</h1>
        </div>
        <div style={{ display: 'flex', gap: '10px' }}>
          <button onClick={exportCSV} style={{ padding: '9px 18px', background: '#f0fdf4', color: '#059669', border: '1.5px solid #bbf7d0', borderRadius: '10px', cursor: 'pointer', fontWeight: '700', fontSize: '13px' }}>⬇ Export CSV</button>
          <button onClick={printReport} style={{ padding: '9px 18px', background: '#eef2ff', color: '#2563eb', border: '1.5px solid #bfdbfe', borderRadius: '10px', cursor: 'pointer', fontWeight: '700', fontSize: '13px' }}>🖨 Print</button>
        </div>
      </div>

      {/* Summary cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: '16px', marginBottom: '20px' }}>
        {[
          { label: 'Total Transfers', value: filtered.length, color: '#1e40af' },
          { label: 'Confirmed', value: filtered.filter(t => t.status === 'confirmed').length, color: '#059669' },
          { label: 'Drafts', value: filtered.filter(t => t.status === 'draft').length, color: '#d97706' },
        ].map(s => (
          <div key={s.label} style={{ background: 'white', borderRadius: '12px', padding: '18px', boxShadow: '0 1px 3px rgba(15,23,42,0.06), 0 1px 2px rgba(15,23,42,0.04)', borderLeft: `4px solid ${s.color}` }}>
            <div style={{ fontSize: '11px', fontWeight: '700', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '6px' }}>{s.label}</div>
            <div style={{ fontSize: '20px', fontWeight: '800', color: s.color }}>{s.value}</div>
          </div>
        ))}
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
        {shopFilter !== 'all' && (
          <div>
            <div style={{ fontSize: '11px', fontWeight: '700', color: '#94a3b8', textTransform: 'uppercase', marginBottom: '5px' }}>Direction</div>
            <select value={shopDirection} onChange={e => setShopDirection(e.target.value)} style={inp}>
              <option value="any">Any (from or to)</option>
              <option value="from">Sent from this shop</option>
              <option value="to">Received by this shop</option>
            </select>
          </div>
        )}
        <div>
          <div style={{ fontSize: '11px', fontWeight: '700', color: '#94a3b8', textTransform: 'uppercase', marginBottom: '5px' }}>Status</div>
          <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} style={inp}>
            <option value="all">All</option>
            <option value="confirmed">Confirmed</option>
            <option value="draft">Draft</option>
          </select>
        </div>
        <button onClick={fetchData} style={{ padding: '9px 20px', background: 'linear-gradient(135deg,#2563eb,#1d4ed8)', color: 'white', border: 'none', borderRadius: '10px', cursor: 'pointer', fontWeight: '700', fontSize: '14px' }}>Apply</button>
      </div>

      <div className="no-print" style={{ marginBottom: '12px' }}>
        <input type="text" placeholder="Search transfer no or shop…" value={search} onChange={e => setSearch(e.target.value)}
          style={{ ...inp, width: '100%', boxSizing: 'border-box' }} />
      </div>

      {/* Table */}
      <div style={{ background: 'white', borderRadius: '12px', boxShadow: '0 1px 3px rgba(15,23,42,0.06), 0 1px 2px rgba(15,23,42,0.04)', overflow: 'hidden' }}>
        <div style={{ padding: '14px 20px', borderBottom: '1px solid #f1f5f9', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 style={{ fontSize: '15px', fontWeight: '700', color: '#0f172a', margin: 0 }}>Transfer Records</h2>
          <span style={{ fontSize: '13px', color: '#94a3b8' }}>{filtered.length} records · Click row to see items</span>
        </div>

        {loading ? <div style={{ padding: '40px', textAlign: 'center', color: '#94a3b8' }}>Loading...</div>
        : filtered.length === 0 ? (
          <div style={{ padding: '40px', textAlign: 'center', color: '#94a3b8' }}>
            <div style={{ fontSize: '32px', marginBottom: '8px' }}>🔀</div>
            No stock transfers found
          </div>
        ) : (
          filtered.map((t, i) => (
            <div key={t.id}>
              {/* Transfer row */}
              <div onClick={() => loadLineItems(t.id)}
                style={{ display: 'grid', gridTemplateColumns: '140px 120px 1fr auto 1fr 120px 80px', gap: '0', borderBottom: expandedId === t.id ? 'none' : '1px solid #f1f5f9', background: expandedId === t.id ? '#f5f3ff' : i % 2 === 0 ? 'white' : '#fafafa', cursor: 'pointer', alignItems: 'center' }}
                onMouseEnter={e => { if (expandedId !== t.id) e.currentTarget.style.background = '#f8fafc' }}
                onMouseLeave={e => { if (expandedId !== t.id) e.currentTarget.style.background = i % 2 === 0 ? 'white' : '#fafafa' }}>
                <div style={{ padding: '12px 14px', fontWeight: '700', color: '#2563eb', fontSize: '13px' }}>{t.transfer_no}</div>
                <div style={{ padding: '12px 14px', fontSize: '13px', color: '#64748b' }}>{new Date(t.created_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}</div>
                <div style={{ padding: '12px 14px', fontSize: '14px', fontWeight: '700', color: '#e11d48' }}>{t.from_shop?.name || '—'}</div>
                <div style={{ padding: '12px 14px', fontSize: '18px', color: '#94a3b8' }}>→</div>
                <div style={{ padding: '12px 14px', fontSize: '14px', fontWeight: '700', color: '#059669' }}>{t.to_shop?.name || '—'}</div>
                <div style={{ padding: '12px 14px' }}>
                  <span style={{ background: t.status === 'confirmed' ? '#dcfce7' : '#fef3c7', color: t.status === 'confirmed' ? '#166534' : '#92400e', padding: '2px 8px', borderRadius: '12px', fontSize: '11px', fontWeight: '700' }}>{t.status}</span>
                </div>
                <div style={{ padding: '12px 14px', fontSize: '13px', color: '#2563eb', fontWeight: '600' }}>
                  {expandedId === t.id ? '▲ Hide' : '▼ Items'}
                </div>
              </div>

              {/* Expanded line items */}
              {expandedId === t.id && (
                <div style={{ background: '#f5f3ff', borderBottom: '1px solid #e2e8f0', padding: '0 14px 14px 14px' }}>
                  {t.notes && (
                    <div style={{ fontSize: '13px', color: '#64748b', marginBottom: '10px', padding: '8px 12px', background: '#ede9fe', borderRadius: '6px' }}>
                      📝 {t.notes}
                    </div>
                  )}
                  {lineItems[t.id] ? (
                    <table style={{ width: '100%', borderCollapse: 'collapse', background: 'white', borderRadius: '10px', overflow: 'hidden' }}>
                      <thead>
                        <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
                          {['Item No', 'Name', 'Qty Transferred'].map(h => (
                            <th key={h} style={{ padding: '8px 12px', textAlign: 'left', fontSize: '11px', fontWeight: '700', color: '#94a3b8', textTransform: 'uppercase' }}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {lineItems[t.id].map((li, j) => (
                          <tr key={li.id} style={{ borderBottom: '1px solid #f8fafc' }}>
                            <td style={{ padding: '8px 12px', fontWeight: '700', color: '#2563eb', fontSize: '12px' }}>{li.items?.item_no}</td>
                            <td style={{ padding: '8px 12px', fontSize: '13px', fontWeight: '600', color: '#0f172a' }}>{li.items?.name}</td>
                            <td style={{ padding: '8px 12px', fontSize: '14px', fontWeight: '800', color: '#1e40af' }}>{li.quantity}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  ) : (
                    <div style={{ padding: '12px', textAlign: 'center', color: '#94a3b8', fontSize: '13px' }}>Loading items...</div>
                  )}
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  )
}
