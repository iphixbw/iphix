import { useState, useEffect } from 'react'
import { supabase } from '../../supabase'
import { formatCurrency } from '../../lib/helpers'
import toast from 'react-hot-toast'

export default function InventoryReport({ shops = [], onBack }) {
  const [data, setData] = useState([])
  const [shopStock, setShopStock] = useState({}) // { item_id: { shop_id: qty } }
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [stockFilter, setStockFilter] = useState('all')
  const [shopFilter, setShopFilter] = useState('all')

  useEffect(() => { fetchData() }, [])

  async function fetchData() {
    setLoading(true)
    const [{ data: items, error }, { data: invRows }] = await Promise.all([
      supabase.from('items').select('*, suppliers(name, supplier_no)').order('name'),
      supabase.from('inventory').select('item_id, shop_id, quantity').not('shop_id', 'is', null),
    ])
    if (error) toast.error('Failed to load')
    else {
      setData(items || [])
      // Build shopStock map: { item_id: { shop_id: total_qty } }
      const map = {}
      for (const row of (invRows || [])) {
        if (!map[row.item_id]) map[row.item_id] = {}
        map[row.item_id][row.shop_id] = (map[row.item_id][row.shop_id] || 0) + (row.quantity || 0)
      }
      setShopStock(map)
    }
    setLoading(false)
  }

  const filtered = data.filter(item => {
    const matchSearch = item.name.toLowerCase().includes(search.toLowerCase()) ||
      item.item_no?.toLowerCase().includes(search.toLowerCase()) ||
      item.suppliers?.name?.toLowerCase().includes(search.toLowerCase())
    const qty = shopFilter === 'all' ? (item.stock_quantity || 0) : (shopStock[item.id]?.[shopFilter] || 0)
    if (stockFilter === 'in') return matchSearch && qty > 0
    if (stockFilter === 'out') return matchSearch && qty <= 0
    if (stockFilter === 'low') return matchSearch && item.reorder_level > 0 && qty <= item.reorder_level
    return matchSearch
  })

  const totalItems = filtered.length
  const totalStockValue = filtered.reduce((s, i) => s + (i.stock_quantity || 0) * (i.cost_price || 0), 0)
  const totalRetailValue = filtered.reduce((s, i) => s + (i.stock_quantity || 0) * (i.selling_price || 0), 0)
  const totalUnits = filtered.reduce((s, i) => s + (i.stock_quantity || 0), 0)

  function exportCSV() {
    const shopHeaders = shops.map(s => s.name)
    const headers = ['Item No', 'Name', 'Barcode', 'Supplier', 'Supplier No', 'Total Stock', ...shopHeaders, 'Reorder Level', 'Cost Price', 'Selling Price', 'Stock Value (Cost)', 'Stock Value (Retail)']
    const rows = filtered.map(i => [
      i.item_no, i.name, i.barcode || '', i.suppliers?.name || '', i.suppliers?.supplier_no || '',
      i.stock_quantity || 0,
      ...shops.map(s => shopStock[i.id]?.[s.id] || 0),
      i.reorder_level || 0, i.cost_price || 0, i.selling_price || 0,
      ((i.stock_quantity || 0) * (i.cost_price || 0)).toFixed(2),
      ((i.stock_quantity || 0) * (i.selling_price || 0)).toFixed(2),
    ])
    const csv = [headers, ...rows].map(r => r.map(v => `"${v}"`).join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a'); a.href = url; a.download = `inventory-report-${new Date().toISOString().split('T')[0]}.csv`; a.click()
    URL.revokeObjectURL(url); toast.success('CSV downloaded!')
  }

  function printReport() {
    const w = window.open('', '_blank')
    const dateStr = new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' })
    const fmt = n => parseFloat(n||0).toLocaleString('en-LK', { minimumFractionDigits: 2 })
    const shopHeaders = shops.map(s => `<th>${s.name}</th>`).join('')
    const rows = filtered.map((item, i) => {
      const totalQty = item.stock_quantity || 0
      const isOut = totalQty <= 0
      const isLow = item.reorder_level > 0 && totalQty <= item.reorder_level
      const status = isOut ? '<span style="color:#dc2626;font-weight:700">Out</span>' : isLow ? '<span style="color:#d97706;font-weight:700">Low</span>' : '<span style="color:#059669;font-weight:700">OK</span>'
      const shopCells = shops.map(s => `<td style="text-align:center">${shopStock[item.id]?.[s.id] || '—'}</td>`).join('')
      return `<tr style="background:${i%2===0?'white':'#f8fafc'}">
        <td>${item.item_no}</td>
        <td><strong>${item.name}</strong></td>
        <td style="font-family:monospace;font-size:10px">${item.barcode||'—'}</td>
        <td>${item.suppliers?.name||'—'}</td>
        <td style="font-weight:800;color:${isOut?'#dc2626':isLow?'#d97706':'#059669'};text-align:center">${totalQty}</td>
        ${shopCells}
        <td style="text-align:center">${item.reorder_level||'—'}</td>
        <td style="text-align:right">${fmt(item.cost_price)}</td>
        <td style="text-align:right">${fmt(item.selling_price)}</td>
        <td style="text-align:right;font-weight:700">${fmt(totalQty*(item.cost_price||0))}</td>
        <td style="text-align:center">${status}</td>
      </tr>`
    }).join('')

    const shopTotals = shops.map(s => `<td style="text-align:center;color:#93c5fd;font-weight:700">${filtered.reduce((sum,i)=>sum+(shopStock[i.id]?.[s.id]||0),0)}</td>`).join('')

    w.document.write(`<!DOCTYPE html><html><head><title>Inventory Report — ${dateStr}</title>
    <style>
      * { box-sizing: border-box; margin: 0; padding: 0 }
      body { font-family: Arial, sans-serif; font-size: 11px; color: #1e293b; padding: 16px }
      .header { border-bottom: 3px solid #1e40af; padding-bottom: 12px; margin-bottom: 16px }
      .co { font-size: 20px; font-weight: 900; color: #1e40af; letter-spacing: 1px }
      .title { font-size: 15px; font-weight: 700; color: #0f172a; margin-top: 3px }
      .meta { font-size: 10px; color: #64748b; margin-top: 2px }
      .summary { display: grid; grid-template-columns: repeat(4,1fr); gap: 10px; margin-bottom: 16px }
      .card { border: 1.5px solid #e2e8f0; border-radius: 8px; padding: 10px 14px }
      .card-label { font-size: 9px; font-weight: 700; color: #94a3b8; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 4px }
      .card-value { font-size: 15px; font-weight: 800 }
      table { width: 100%; border-collapse: collapse; font-size: 10px }
      thead tr { background: #0f172a; color: white }
      thead th { padding: 7px 8px; text-align: left; font-size: 9px; font-weight: 700; text-transform: uppercase; white-space: nowrap }
      thead th.r { text-align: right }
      thead th.c { text-align: center }
      tbody td { padding: 5px 8px; border-bottom: 1px solid #f1f5f9; vertical-align: middle }
      tfoot tr { background: #1e293b; color: white }
      tfoot td { padding: 8px; font-weight: 700; font-size: 11px }
      .footer { margin-top: 16px; border-top: 2px solid #e2e8f0; padding-top: 8px; text-align: center; font-size: 9px; color: #94a3b8; font-weight: 700 }
      @media print { @page { size: A4 landscape; margin: 8mm } body { padding: 0 } }
    </style></head><body>
    <div class="header">
      <div class="co">PHONEFIX (PVT) LTD</div>
      <div class="title">Inventory Report</div>
      <div class="meta">Generated on ${dateStr} &nbsp;·&nbsp; ${filtered.length} items &nbsp;·&nbsp; Filter: ${stockFilter === 'all' ? 'All Items' : stockFilter === 'in' ? 'In Stock' : stockFilter === 'out' ? 'Out of Stock' : 'Low Stock'}</div>
    </div>
    <div class="summary">
      <div class="card"><div class="card-label">Total Items</div><div class="card-value" style="color:#1e40af">${totalItems}</div></div>
      <div class="card"><div class="card-label">Total Units</div><div class="card-value" style="color:#059669">${totalUnits}</div></div>
      <div class="card"><div class="card-label">Stock Value (Cost)</div><div class="card-value" style="color:#d97706">LKR ${fmt(totalStockValue)}</div></div>
      <div class="card"><div class="card-label">Stock Value (Retail)</div><div class="card-value" style="color:#7c3aed">LKR ${fmt(totalRetailValue)}</div></div>
    </div>
    <table>
      <thead><tr>
        <th>Item No</th><th>Name</th><th>Barcode</th><th>Supplier</th>
        <th class="c">Total Stock</th>${shopHeaders}
        <th class="c">Reorder</th><th class="r">Cost</th><th class="r">Selling</th><th class="r">Stock Value</th><th class="c">Status</th>
      </tr></thead>
      <tbody>${rows}</tbody>
      <tfoot><tr>
        <td colspan="4">TOTALS — ${filtered.length} items</td>
        <td style="text-align:center;color:white">${totalUnits}</td>
        ${shopTotals}
        <td></td><td></td><td></td>
        <td style="text-align:right;color:#fbbf24">LKR ${fmt(totalStockValue)}</td>
        <td></td>
      </tr></tfoot>
    </table>
    <div class="footer">Designed for Phonefix (PVT) Ltd &nbsp;·&nbsp; Powered by Techmo Solutions &nbsp;·&nbsp; ${dateStr}</div>
    <script>window.onload=function(){window.print()}<\/script>
    </body></html>`)
    w.document.close()
  }

  const inp = { padding: '9px 12px', border: '1.5px solid #e2e8f0', borderRadius: '7px', fontSize: '14px', outline: 'none', background: 'white' }

  return (
    <div>
      <style>{`@media print { .no-print { display: none !important; } }`}</style>
      <div className="no-print" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
        <div>
          <button onClick={onBack} style={{ background: 'none', border: 'none', color: '#2563eb', cursor: 'pointer', fontSize: '14px', fontWeight: '600', padding: 0, marginBottom: '6px', display: 'block' }}>← Back to Reports</button>
          <h1 style={{ fontSize: '22px', fontWeight: '700', color: '#0f172a', margin: 0 }}>Inventory Report</h1>
        </div>
        <div style={{ display: 'flex', gap: '10px' }}>
          <button onClick={exportCSV} style={{ padding: '9px 18px', background: '#f0fdf4', color: '#059669', border: '1.5px solid #bbf7d0', borderRadius: '10px', cursor: 'pointer', fontWeight: '700', fontSize: '13px' }}>⬇ Export CSV</button>
          <button onClick={printReport} style={{ padding: '9px 18px', background: '#eef2ff', color: '#2563eb', border: '1.5px solid #bfdbfe', borderRadius: '10px', cursor: 'pointer', fontWeight: '700', fontSize: '13px' }}>🖨 Print PDF</button>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: '16px', marginBottom: '20px' }}>
        {[
          { label: 'Total Items', value: totalItems, color: '#1e40af' },
          { label: 'Total Units', value: totalUnits, color: '#059669' },
          { label: 'Stock Value (Cost)', value: formatCurrency(totalStockValue), color: '#d97706' },
          { label: 'Stock Value (Retail)', value: formatCurrency(totalRetailValue), color: '#7c3aed' },
        ].map(s => (
          <div key={s.label} style={{ background: 'white', borderRadius: '12px', padding: '18px', boxShadow: '0 1px 3px rgba(15,23,42,0.06), 0 1px 2px rgba(15,23,42,0.04)', borderLeft: `4px solid ${s.color}` }}>
            <div style={{ fontSize: '11px', fontWeight: '700', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '6px' }}>{s.label}</div>
            <div style={{ fontSize: '20px', fontWeight: '800', color: s.color }}>{s.value}</div>
          </div>
        ))}
      </div>

      {/* Per-shop stock summary cards */}
      {shops.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: `repeat(${shops.length},1fr)`, gap: '12px', marginBottom: '20px' }}>
          {shops.map(shop => {
            const shopTotal = filtered.reduce((s, i) => s + (shopStock[i.id]?.[shop.id] || 0), 0)
            const shopValue = filtered.reduce((s, i) => s + (shopStock[i.id]?.[shop.id] || 0) * (i.cost_price || 0), 0)
            return (
              <div key={shop.id} style={{ background: 'white', borderRadius: '12px', padding: '16px 18px', boxShadow: '0 1px 3px rgba(15,23,42,0.06), 0 1px 2px rgba(15,23,42,0.04)', borderTop: '3px solid #2563eb' }}>
                <div style={{ fontSize: '11px', fontWeight: '700', color: '#94a3b8', textTransform: 'uppercase', marginBottom: '8px' }}>🏪 {shop.name}</div>
                <div style={{ fontSize: '18px', fontWeight: '800', color: '#1e40af' }}>{shopTotal.toLocaleString()} units</div>
                <div style={{ fontSize: '12px', color: '#64748b', marginTop: '3px' }}>{formatCurrency(shopValue)} cost value</div>
              </div>
            )
          })}
        </div>
      )}

      <div className="no-print" style={{ background: 'white', borderRadius: '12px', padding: '14px 16px', boxShadow: '0 1px 3px rgba(15,23,42,0.06), 0 1px 2px rgba(15,23,42,0.04)', marginBottom: '16px', display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap' }}>
        <input type="text" placeholder="Search item, supplier…" value={search} onChange={e => setSearch(e.target.value)} style={{ ...inp, flex: 1, minWidth: '180px' }} />
        <select value={shopFilter} onChange={e => setShopFilter(e.target.value)} style={inp}>
          <option value="all">All Shops</option>
          {shops.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <select value={stockFilter} onChange={e => setStockFilter(e.target.value)} style={inp}>
          <option value="all">All Items</option>
          <option value="in">In Stock</option>
          <option value="out">Out of Stock</option>
          <option value="low">Low Stock</option>
        </select>
      </div>

      <div style={{ background: 'white', borderRadius: '12px', boxShadow: '0 1px 3px rgba(15,23,42,0.06), 0 1px 2px rgba(15,23,42,0.04)', overflow: 'hidden' }}>
        {loading ? <div style={{ padding: '40px', textAlign: 'center', color: '#94a3b8' }}>Loading...</div>
        : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '900px' }}>
              <thead>
                <tr style={{ background: '#f8fafc', borderBottom: '2px solid #e2e8f0' }}>
                  {['Item No', 'Name', 'Barcode', 'Supplier', 'Total Stock', ...shops.map(s => s.name), 'Reorder', 'Cost Price', 'Selling Price', 'Stock Value', 'Status'].map(h => (
                    <th key={h} style={{ padding: '10px 14px', textAlign: 'left', fontSize: '11px', fontWeight: '700', color: shops.map(s => s.name).includes(h) ? '#2563eb' : '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.06em', whiteSpace: 'nowrap', background: shops.map(s => s.name).includes(h) ? '#eef2ff' : '#f8fafc' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((item, i) => {
                  const totalQty = item.stock_quantity || 0
                  const isOut = totalQty <= 0
                  const isLow = item.reorder_level > 0 && totalQty <= item.reorder_level
                  return (
                    <tr key={item.id} style={{ borderBottom: '1px solid #f1f5f9', background: isOut ? '#fff5f5' : isLow ? '#fffbeb' : i % 2 === 0 ? 'white' : '#fafafa' }}>
                      <td style={{ padding: '10px 14px', fontWeight: '700', color: '#2563eb', fontSize: '13px' }}>{item.item_no}</td>
                      <td style={{ padding: '10px 14px', fontSize: '13px', fontWeight: '600', color: '#0f172a' }}>{item.name}</td>
                      <td style={{ padding: '10px 14px', fontSize: '11px', color: '#94a3b8', fontFamily: 'monospace' }}>{item.barcode || '—'}</td>
                      <td style={{ padding: '10px 14px', fontSize: '12px', color: '#64748b' }}>{item.suppliers?.name || '—'}</td>
                      <td style={{ padding: '10px 14px', fontSize: '15px', fontWeight: '800', color: isOut ? '#e11d48' : isLow ? '#d97706' : '#059669' }}>{totalQty}</td>
                      {shops.map(shop => {
                        const sq = shopStock[item.id]?.[shop.id] || 0
                        return (
                          <td key={shop.id} style={{ padding: '10px 14px', fontSize: '13px', fontWeight: '600', color: sq > 0 ? '#1e40af' : '#cbd5e1', background: '#fafbff', textAlign: 'center' }}>{sq > 0 ? sq : '—'}</td>
                        )
                      })}
                      <td style={{ padding: '10px 14px', fontSize: '13px', color: '#64748b' }}>{item.reorder_level || '—'}</td>
                      <td style={{ padding: '10px 14px', fontSize: '13px', color: '#64748b' }}>{formatCurrency(item.cost_price)}</td>
                      <td style={{ padding: '10px 14px', fontSize: '13px', fontWeight: '600', color: '#059669' }}>{formatCurrency(item.selling_price)}</td>
                      <td style={{ padding: '10px 14px', fontSize: '13px', fontWeight: '700', color: '#0f172a' }}>{formatCurrency(totalQty * (item.cost_price || 0))}</td>
                      <td style={{ padding: '10px 14px' }}>
                        {isOut ? <span style={{ background: '#fee2e2', color: '#dc2626', padding: '2px 8px', borderRadius: '12px', fontSize: '11px', fontWeight: '700' }}>Out</span>
                        : isLow ? <span style={{ background: '#fef3c7', color: '#92400e', padding: '2px 8px', borderRadius: '12px', fontSize: '11px', fontWeight: '700' }}>Low</span>
                        : <span style={{ background: '#dcfce7', color: '#166534', padding: '2px 8px', borderRadius: '12px', fontSize: '11px', fontWeight: '700' }}>OK</span>}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
              <tfoot>
                <tr style={{ background: '#0f172a' }}>
                  <td colSpan={4} style={{ padding: '12px 14px', fontSize: '13px', fontWeight: '700', color: '#94a3b8' }}>TOTALS</td>
                  <td style={{ padding: '12px 14px', fontSize: '14px', fontWeight: '800', color: 'white' }}>{totalUnits}</td>
                  {shops.map(shop => (
                    <td key={shop.id} style={{ padding: '12px 14px', fontSize: '13px', fontWeight: '700', color: '#93c5fd', textAlign: 'center' }}>
                      {filtered.reduce((s, i) => s + (shopStock[i.id]?.[shop.id] || 0), 0)}
                    </td>
                  ))}
                  <td></td><td></td><td></td>
                  <td style={{ padding: '12px 14px', fontSize: '14px', fontWeight: '800', color: '#fbbf24' }}>{formatCurrency(totalStockValue)}</td>
                  <td></td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
