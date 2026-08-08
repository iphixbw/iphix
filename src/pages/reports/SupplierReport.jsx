import { useState, useEffect } from 'react'
import { supabase } from '../../supabase'
import { formatCurrency } from '../../lib/helpers'
import toast from 'react-hot-toast'

function SupplierDetail({ supplier, onBack }) {
  const [purchases, setPurchases] = useState([])
  const [returns, setReturns] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => { fetchDetail() }, [supplier.id])

  async function fetchDetail() {
    setLoading(true)
    const [{ data: purch }, { data: rets }] = await Promise.all([
      supabase.from('purchases').select('purchase_no, created_at, total, amount_paid, credit_amount, payment_method, status').eq('supplier_id', supplier.id).order('created_at', { ascending: false }),
      supabase.from('purchase_returns').select('return_no, created_at, total, payment_method, status, remarks').eq('supplier_id', supplier.id).order('created_at', { ascending: false }),
    ])
    setPurchases(purch || [])
    setReturns(rets || [])
    setLoading(false)
  }

  const totalPurchased = purchases.filter(p => p.status === 'confirmed').reduce((s, p) => s + (p.total || 0), 0)
  const totalPaid = purchases.filter(p => p.status === 'confirmed').reduce((s, p) => s + (p.amount_paid || 0), 0)
  const totalReturns = returns.filter(r => r.status === 'confirmed').reduce((s, r) => s + (r.total || 0), 0)

  return (
    <div>
      <button onClick={onBack} style={{ background: 'none', border: 'none', color: '#2563eb', cursor: 'pointer', fontSize: '14px', fontWeight: '600', padding: 0, marginBottom: '20px', display: 'block' }}>← Back to Supplier Report</button>

      {/* Supplier header */}
      <div style={{ background: 'white', borderRadius: '12px', padding: '24px', boxShadow: '0 1px 3px rgba(15,23,42,0.06), 0 1px 2px rgba(15,23,42,0.04)', marginBottom: '20px', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <div style={{ fontSize: '11px', fontWeight: '700', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '4px' }}>Supplier</div>
          <h1 style={{ fontSize: '22px', fontWeight: '800', color: '#0f172a', margin: '0 0 6px' }}>{supplier.name}</h1>
          <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
            <span style={{ fontSize: '13px', fontWeight: '700', color: '#2563eb', background: '#eef2ff', padding: '3px 10px', borderRadius: '20px' }}>{supplier.supplier_no}</span>
            {supplier.phone && <span style={{ fontSize: '13px', color: '#64748b' }}>📞 {supplier.phone}</span>}
            {supplier.email && <span style={{ fontSize: '13px', color: '#64748b' }}>✉️ {supplier.email}</span>}
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: '11px', fontWeight: '700', color: '#94a3b8', textTransform: 'uppercase', marginBottom: '4px' }}>Outstanding Balance</div>
          <div style={{ fontSize: '28px', fontWeight: '800', color: supplier.outstanding_balance > 0 ? '#7c3aed' : '#059669' }}>{formatCurrency(supplier.outstanding_balance || 0)}</div>
        </div>
      </div>

      {/* Stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: '16px', marginBottom: '24px' }}>
        {[
          { label: 'Total Purchased', value: formatCurrency(totalPurchased), color: '#1e40af' },
          { label: 'Total Paid', value: formatCurrency(totalPaid), color: '#059669' },
          { label: 'Total Returns', value: formatCurrency(totalReturns), color: '#d97706' },
          { label: 'Outstanding', value: formatCurrency(supplier.outstanding_balance || 0), color: '#7c3aed' },
        ].map(s => (
          <div key={s.label} style={{ background: 'white', borderRadius: '12px', padding: '18px', boxShadow: '0 1px 3px rgba(15,23,42,0.06), 0 1px 2px rgba(15,23,42,0.04)', borderLeft: `4px solid ${s.color}` }}>
            <div style={{ fontSize: '11px', fontWeight: '700', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '6px' }}>{s.label}</div>
            <div style={{ fontSize: '18px', fontWeight: '800', color: s.color }}>{s.value}</div>
          </div>
        ))}
      </div>

      {loading ? <div style={{ padding: '40px', textAlign: 'center', color: '#94a3b8' }}>Loading...</div> : (
        <>
          {/* Purchases */}
          <div style={{ background: 'white', borderRadius: '12px', boxShadow: '0 1px 3px rgba(15,23,42,0.06), 0 1px 2px rgba(15,23,42,0.04)', overflow: 'hidden', marginBottom: '20px' }}>
            <div style={{ padding: '16px 20px', borderBottom: '1px solid #f1f5f9' }}>
              <h2 style={{ fontSize: '15px', fontWeight: '700', color: '#0f172a', margin: 0 }}>Purchase History ({purchases.length})</h2>
            </div>
            {purchases.length === 0 ? <div style={{ padding: '32px', textAlign: 'center', color: '#94a3b8' }}>No purchases</div> : (
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ background: '#f8fafc', borderBottom: '2px solid #e2e8f0' }}>
                    {['Purchase No', 'Date', 'Total', 'Paid', 'Outstanding', 'Method', 'Status'].map(h => (
                      <th key={h} style={{ padding: '10px 14px', textAlign: 'left', fontSize: '11px', fontWeight: '700', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.06em', whiteSpace: 'nowrap' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {purchases.map((p, i) => (
                    <tr key={p.purchase_no} style={{ borderBottom: '1px solid #f1f5f9', background: i % 2 === 0 ? 'white' : '#fafafa' }}>
                      <td style={{ padding: '10px 14px', fontWeight: '700', color: '#2563eb', fontSize: '13px' }}>{p.purchase_no}</td>
                      <td style={{ padding: '10px 14px', fontSize: '13px', color: '#64748b' }}>{new Date(p.created_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}</td>
                      <td style={{ padding: '10px 14px', fontSize: '13px', fontWeight: '600' }}>{formatCurrency(p.total)}</td>
                      <td style={{ padding: '10px 14px', fontSize: '13px', color: '#059669', fontWeight: '600' }}>{formatCurrency(p.amount_paid)}</td>
                      <td style={{ padding: '10px 14px', fontSize: '13px', fontWeight: '700', color: (p.credit_amount || 0) > 0 ? '#7c3aed' : '#94a3b8' }}>
                        {(p.credit_amount || 0) > 0 ? formatCurrency(p.credit_amount) : '—'}
                      </td>
                      <td style={{ padding: '10px 14px', fontSize: '12px', color: '#64748b', textTransform: 'capitalize' }}>{p.payment_method?.replace('_', ' ')}</td>
                      <td style={{ padding: '10px 14px' }}>
                        <span style={{ background: p.status === 'confirmed' ? '#dcfce7' : '#fef3c7', color: p.status === 'confirmed' ? '#166534' : '#92400e', padding: '2px 8px', borderRadius: '12px', fontSize: '11px', fontWeight: '700' }}>{p.status}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {/* Returns */}
          {returns.length > 0 && (
            <div style={{ background: 'white', borderRadius: '12px', boxShadow: '0 1px 3px rgba(15,23,42,0.06), 0 1px 2px rgba(15,23,42,0.04)', overflow: 'hidden' }}>
              <div style={{ padding: '16px 20px', borderBottom: '1px solid #f1f5f9' }}>
                <h2 style={{ fontSize: '15px', fontWeight: '700', color: '#0f172a', margin: 0 }}>Purchase Returns ({returns.length})</h2>
              </div>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ background: '#f8fafc', borderBottom: '2px solid #e2e8f0' }}>
                    {['Return No', 'Date', 'Total', 'Method', 'Status', 'Remarks'].map(h => (
                      <th key={h} style={{ padding: '10px 14px', textAlign: 'left', fontSize: '11px', fontWeight: '700', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {returns.map((r, i) => (
                    <tr key={r.return_no} style={{ borderBottom: '1px solid #f1f5f9', background: i % 2 === 0 ? 'white' : '#fafafa' }}>
                      <td style={{ padding: '10px 14px', fontWeight: '700', color: '#2563eb', fontSize: '13px' }}>{r.return_no}</td>
                      <td style={{ padding: '10px 14px', fontSize: '13px', color: '#64748b' }}>{new Date(r.created_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}</td>
                      <td style={{ padding: '10px 14px', fontSize: '13px', fontWeight: '700', color: '#e11d48' }}>{formatCurrency(r.total)}</td>
                      <td style={{ padding: '10px 14px', fontSize: '12px', color: '#64748b', textTransform: 'capitalize' }}>{r.payment_method}</td>
                      <td style={{ padding: '10px 14px' }}>
                        <span style={{ background: r.status === 'confirmed' ? '#dcfce7' : '#fef3c7', color: r.status === 'confirmed' ? '#166534' : '#92400e', padding: '2px 8px', borderRadius: '12px', fontSize: '11px', fontWeight: '700' }}>{r.status}</span>
                      </td>
                      <td style={{ padding: '10px 14px', fontSize: '12px', color: '#64748b' }}>{r.remarks || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  )
}

export default function SupplierReport({ onBack }) {
  const [suppliers, setSuppliers] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState('outstanding')
  const [selectedSupplier, setSelectedSupplier] = useState(null)

  useEffect(() => { fetchData() }, [])

  async function fetchData() {
    setLoading(true)
    const { data, error } = await supabase.from('suppliers').select('*').order('outstanding_balance', { ascending: false })
    if (error) toast.error('Failed to load')
    else setSuppliers(data || [])
    setLoading(false)
  }

  if (selectedSupplier) {
    return <SupplierDetail supplier={selectedSupplier} onBack={() => setSelectedSupplier(null)} />
  }

  const filtered = suppliers.filter(s => {
    const matchSearch = s.name.toLowerCase().includes(search.toLowerCase()) || s.supplier_no?.toLowerCase().includes(search.toLowerCase())
    if (filter === 'outstanding') return matchSearch && s.outstanding_balance > 0
    if (filter === 'clear') return matchSearch && s.outstanding_balance <= 0
    return matchSearch
  })

  const totalPayable = filtered.reduce((s, sup) => s + (sup.outstanding_balance || 0), 0)

  function exportCSV() {
    const headers = ['Supplier No', 'Name', 'Phone', 'Email', 'Address', 'Outstanding Balance']
    const rows = filtered.map(s => [s.supplier_no, s.name, s.phone || '', s.email || '', s.address || '', s.outstanding_balance || 0])
    const csv = [headers, ...rows].map(r => r.map(v => `"${v}"`).join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a'); a.href = url; a.download = `supplier-outstanding-${new Date().toISOString().split('T')[0]}.csv`; a.click()
    URL.revokeObjectURL(url); toast.success('CSV downloaded!')
  }

  const inp = { padding: '9px 12px', border: '1.5px solid #e2e8f0', borderRadius: '7px', fontSize: '14px', outline: 'none', background: 'white' }


  function printReport() {
    const w = window.open('', '_blank')
    const dateStr = new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' })
    const fmt = n => (parseFloat(n)||0).toLocaleString('en-LK', { minimumFractionDigits: 2 })
    const totalPayable = filtered.reduce((s,sup) => s+(sup.outstanding_balance||0), 0)
    const rows = filtered.map((s,i) => `<tr>
      <td style="color:#2563eb;font-weight:700">${s.supplier_no||'—'}</td>
      <td><strong>${s.name||'—'}</strong></td>
      <td>${s.phone||'—'}</td>
      <td>${s.email||'—'}</td>
      <td class="r" style="color:#e11d48;font-weight:700">${(s.outstanding_balance||0)>0?'LKR '+fmt(s.outstanding_balance):'✓ Clear'}</td>
      <td class="r" style="color:#64748b">${(s.opening_balance||0)>0?'LKR '+fmt(s.opening_balance):'—'}</td>
    </tr>`).join('')
    w.document.write(`<!DOCTYPE html><html><head><title>Supplier Report</title><style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:Arial,sans-serif;font-size:11px;color:#1e293b;padding:16px}.hdr{border-bottom:3px solid #1e40af;padding-bottom:10px;margin-bottom:14px}.co{font-size:19px;font-weight:900;color:#1e40af;letter-spacing:1px}.ttl{font-size:14px;font-weight:700;color:#0f172a;margin-top:3px}.sub{font-size:10px;color:#64748b;margin-top:2px}.summary{display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:10px;margin-bottom:14px}.card{border:1.5px solid #e2e8f0;border-radius:8px;padding:10px 14px}.lbl{font-size:9px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:.05em;margin-bottom:4px}.val{font-size:15px;font-weight:800}table{width:100%;border-collapse:collapse;font-size:10px}thead tr{background:#0f172a;color:white}thead th{padding:7px 8px;font-size:9px;font-weight:700;text-transform:uppercase;white-space:nowrap;text-align:left}thead th.r{text-align:right}tbody tr:nth-child(even){background:#f8fafc}tbody td{padding:5px 8px;border-bottom:1px solid #f1f5f9}tbody td.r{text-align:right}tfoot tr{background:#1e293b;color:white}tfoot td{padding:8px;font-weight:800}tfoot td.r{text-align:right}.pl-row{display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid #f1f5f9;font-size:11px}.pl-section{background:#f8fafc;padding:8px 12px;border-radius:6px;margin:8px 0}.pl-total{display:flex;justify-content:space-between;padding:10px;background:#0f172a;color:white;border-radius:6px;font-weight:800;font-size:13px;margin-top:8px}.ftr{margin-top:14px;border-top:2px solid #e2e8f0;padding-top:8px;text-align:center;font-size:9px;color:#94a3b8;font-weight:700}@media print{@page{size:A4 portrait;margin:8mm}body{padding:0}}</style></head><body>
      <div class="hdr"><div class="co">PHONEFIX (PVT) LTD</div><div class="ttl">Supplier Outstandings Report</div><div class="sub">As of ${dateStr}</div></div>
      <div class="summary">
        <div class="card"><div class="lbl">Total Suppliers</div><div class="val" style="color:#1e40af">${filtered.length}</div></div>
        <div class="card"><div class="lbl">With Payables</div><div class="val" style="color:#e11d48">${filtered.filter(s=>(s.outstanding_balance||0)>0).length}</div></div>
        <div class="card"><div class="lbl">Total Payable</div><div class="val" style="color:#e11d48">LKR ${fmt(totalPayable)}</div></div>
      </div>
      <table><thead><tr><th>Supplier No</th><th>Name</th><th>Phone</th><th>Email</th><th class="r">Outstanding (CR)</th><th class="r">Opening Balance</th></tr></thead>
      <tbody>${rows}</tbody>
      <tfoot><tr><td colspan="4">TOTALS — ${filtered.length} suppliers</td><td class="r" style="color:#fca5a5">LKR ${fmt(totalPayable)}</td><td></td></tr></tfoot>
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
          <h1 style={{ fontSize: '22px', fontWeight: '700', color: '#0f172a', margin: 0 }}>Supplier Outstandings</h1>
        </div>
        <div style={{ display: 'flex', gap: '10px' }}>
          <button onClick={exportCSV} style={{ padding: '9px 18px', background: '#f0fdf4', color: '#059669', border: '1.5px solid #bbf7d0', borderRadius: '10px', cursor: 'pointer', fontWeight: '700', fontSize: '13px' }}>⬇ Export CSV</button>
          <button onClick={printReport} style={{ padding: '9px 18px', background: '#eef2ff', color: '#2563eb', border: '1.5px solid #bfdbfe', borderRadius: '10px', cursor: 'pointer', fontWeight: '700', fontSize: '13px' }}>🖨 Print PDF</button>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: '16px', marginBottom: '20px' }}>
        {[
          { label: 'Total Suppliers', value: suppliers.length, color: '#1e40af' },
          { label: 'With Balance', value: suppliers.filter(s => s.outstanding_balance > 0).length, color: '#7c3aed' },
          { label: 'Total Payable', value: formatCurrency(suppliers.reduce((s, sup) => s + (sup.outstanding_balance || 0), 0)), color: '#7c3aed' },
        ].map(s => (
          <div key={s.label} style={{ background: 'white', borderRadius: '12px', padding: '18px', boxShadow: '0 1px 3px rgba(15,23,42,0.06), 0 1px 2px rgba(15,23,42,0.04)', borderLeft: `4px solid ${s.color}` }}>
            <div style={{ fontSize: '11px', fontWeight: '700', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '6px' }}>{s.label}</div>
            <div style={{ fontSize: '20px', fontWeight: '800', color: s.color }}>{s.value}</div>
          </div>
        ))}
      </div>

      <div className="no-print" style={{ background: 'white', borderRadius: '12px', padding: '14px 16px', boxShadow: '0 1px 3px rgba(15,23,42,0.06), 0 1px 2px rgba(15,23,42,0.04)', marginBottom: '16px', display: 'flex', gap: '12px' }}>
        <input type="text" placeholder="Search supplier…" value={search} onChange={e => setSearch(e.target.value)} style={{ ...inp, flex: 1 }} />
        <select value={filter} onChange={e => setFilter(e.target.value)} style={inp}>
          <option value="all">All Suppliers</option>
          <option value="outstanding">With Balance</option>
          <option value="clear">Clear Balance</option>
        </select>
      </div>

      <div style={{ background: 'white', borderRadius: '12px', boxShadow: '0 1px 3px rgba(15,23,42,0.06), 0 1px 2px rgba(15,23,42,0.04)', overflow: 'hidden' }}>
        {loading ? <div style={{ padding: '40px', textAlign: 'center', color: '#94a3b8' }}>Loading...</div>
        : filtered.length === 0 ? <div style={{ padding: '40px', textAlign: 'center', color: '#94a3b8' }}>No suppliers found</div>
        : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: '#f8fafc', borderBottom: '2px solid #e2e8f0' }}>
                {['#', 'Supplier No', 'Name', 'Phone', 'Email', 'Outstanding Balance', ''].map(h => (
                  <th key={h} style={{ padding: '10px 14px', textAlign: 'left', fontSize: '11px', fontWeight: '700', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((s, i) => (
                <tr key={s.id} style={{ borderBottom: '1px solid #f1f5f9', background: i % 2 === 0 ? 'white' : '#fafafa', cursor: 'pointer' }}
                  onMouseEnter={e => e.currentTarget.style.background = '#f5f3ff'}
                  onMouseLeave={e => e.currentTarget.style.background = i % 2 === 0 ? 'white' : '#fafafa'}
                  onClick={() => setSelectedSupplier(s)}>
                  <td style={{ padding: '12px 14px', fontSize: '12px', color: '#94a3b8', fontWeight: '700' }}>{i + 1}</td>
                  <td style={{ padding: '12px 14px', fontWeight: '700', color: '#2563eb', fontSize: '13px' }}>{s.supplier_no}</td>
                  <td style={{ padding: '12px 14px', fontSize: '14px', fontWeight: '600', color: '#0f172a' }}>{s.name}</td>
                  <td style={{ padding: '12px 14px', fontSize: '13px', color: '#64748b' }}>{s.phone || '—'}</td>
                  <td style={{ padding: '12px 14px', fontSize: '13px', color: '#64748b' }}>{s.email || '—'}</td>
                  <td style={{ padding: '12px 14px', fontSize: '15px', fontWeight: '800', color: s.outstanding_balance > 0 ? '#7c3aed' : '#059669' }}>
                    {formatCurrency(s.outstanding_balance || 0)}
                  </td>
                  <td style={{ padding: '12px 14px' }}>
                    <span style={{ fontSize: '12px', color: '#2563eb', fontWeight: '700' }}>View →</span>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr style={{ background: '#0f172a' }}>
                <td colSpan={5} style={{ padding: '12px 14px', fontSize: '13px', fontWeight: '700', color: '#94a3b8' }}>TOTAL PAYABLE ({filtered.length} suppliers)</td>
                <td style={{ padding: '12px 14px', fontSize: '16px', fontWeight: '800', color: '#c4b5fd' }}>{formatCurrency(totalPayable)}</td>
                <td></td>
              </tr>
            </tfoot>
          </table>
        )}
      </div>
    </div>
  )
}
