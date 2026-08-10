import { useState, useEffect } from 'react'
import { supabase } from '../../supabase'
import { formatLKR, timeAgo } from '../../lib/repairConstants'

// Shows exactly how a part's stock got to where it is — every purchase,
// sale, job usage, return, and manual adjustment, chronologically, with a
// running stock balance alongside each one.
//
// The running balance is anchored to truth rather than assumed: it's
// computed by starting from the part's ACTUAL current_stock and working
// backward through every tracked movement, so the balance shown on the most
// recent row is always guaranteed to match real stock exactly. Whatever's
// left over at the very start (if tracked history doesn't fully explain
// current stock — e.g. this part existed before some of these tracking
// mechanisms did) shows as its own explicit "Stock before tracked history"
// line, the same honest treatment as an opening balance elsewhere in this
// app, rather than a silently wrong number.
export default function RepairInventoryMovements({ shop, parts }) {
  const [selectedPartId, setSelectedPartId] = useState('')
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [events, setEvents] = useState(null)
  const [loading, setLoading] = useState(false)
  const [currentStock, setCurrentStock] = useState(0)

  useEffect(() => {
    if (!selectedPartId) { setEvents(null); return }
    loadMovements(selectedPartId)
  }, [selectedPartId])

  async function loadMovements(partId) {
    setLoading(true)
    setEvents(null)
    const part = parts.find(p => p.id === partId)
    const stock = part?.current_stock || 0
    setCurrentStock(stock)

    const [
      { data: purchaseItems }, { data: saleItems }, { data: jobParts },
      { data: purchaseReturnItems }, { data: saleReturnItems }, { data: adjustments },
    ] = await Promise.all([
      supabase.from('repair_purchase_items').select('quantity, unit_cost, created_at, repair_purchases(purchase_no, status)').eq('part_id', partId),
      supabase.from('repair_sale_items').select('quantity, unit_cost, created_at, repair_sales(sale_no, status)').eq('part_id', partId),
      supabase.from('repair_job_parts').select('quantity, unit_cost, created_at, repair_jobs(job_no, status)').eq('part_id', partId).eq('is_third_party', false),
      supabase.from('repair_purchase_return_items').select('quantity, unit_cost, created_at, repair_purchase_returns(return_no, status)').eq('part_id', partId),
      supabase.from('repair_sale_return_items').select('quantity, unit_cost, created_at, repair_sale_returns(return_no, status)').eq('part_id', partId),
      supabase.from('repair_stock_adjustments').select('*').eq('part_id', partId),
    ])

    const evts = []
    // Purchases/sales/job-usage rows disappear entirely when their parent is
    // voided (void deletes the line items) — so nothing to filter here.
    ;(purchaseItems || []).forEach(p => evts.push({
      date: p.created_at, type: 'Purchase', ref: p.repair_purchases?.purchase_no || '—',
      delta: p.quantity, unitCost: p.unit_cost,
    }))
    ;(saleItems || []).forEach(s => evts.push({
      date: s.created_at, type: 'Sale', ref: s.repair_sales?.sale_no || '—',
      delta: -s.quantity, unitCost: s.unit_cost,
    }))
    ;(jobParts || []).forEach(j => evts.push({
      date: j.created_at, type: 'Job Usage', ref: j.repair_jobs?.job_no || '—',
      delta: -j.quantity, unitCost: j.unit_cost,
    }))
    // Return line items are NOT deleted when a return is voided (only the
    // return's own status flips) — these must be explicitly excluded, or a
    // voided return's movement would still show as if it really happened.
    ;(purchaseReturnItems || []).forEach(r => {
      if (r.repair_purchase_returns?.status === 'voided') return
      evts.push({ date: r.created_at, type: 'Purchase Return', ref: r.repair_purchase_returns?.return_no || '—', delta: -r.quantity, unitCost: r.unit_cost })
    })
    ;(saleReturnItems || []).forEach(r => {
      if (r.repair_sale_returns?.status === 'voided') return
      evts.push({ date: r.created_at, type: 'Sale Return', ref: r.repair_sale_returns?.return_no || '—', delta: r.quantity, unitCost: r.unit_cost })
    })
    ;(adjustments || []).forEach(a => {
      if (a.adjustment_type === 'cost_correction') {
        evts.push({ date: a.created_at, type: 'Cost Correction', ref: a.reason || '—', delta: 0, unitCost: a.unit_cost, note: 'No quantity change' })
      } else {
        evts.push({
          date: a.created_at, type: a.adjustment_type === 'increase' ? 'Stock Adjustment (+)' : 'Stock Adjustment (−)',
          ref: a.reason || '—', delta: a.adjustment_type === 'increase' ? a.quantity : -a.quantity, unitCost: a.unit_cost,
        })
      }
    })

    evts.sort((a, b) => new Date(a.date) - new Date(b.date))

    // Anchor to truth: whatever's left after backing out every tracked
    // movement from current stock is what existed before tracking began.
    const netTracked = evts.reduce((s, e) => s + e.delta, 0)
    const startingStock = stock - netTracked

    let running = startingStock
    const withBalance = evts.map(e => { running += e.delta; return { ...e, balance: running } })

    setEvents({ list: withBalance, startingStock })
    setLoading(false)
  }

  const selectedPart = parts.find(p => p.id === selectedPartId)
  const results = query.trim().length > 0 && !selectedPartId
    ? parts.filter(p => p.name.toLowerCase().includes(query.toLowerCase()) || p.sku?.toLowerCase().includes(query.toLowerCase())).slice(0, 25)
    : []

  const inp = { width: '100%', padding: '9px 12px', border: '1.5px solid #e7dfd3', borderRadius: '8px', fontSize: '13px', boxSizing: 'border-box' }

  return (
    <div>
      <div style={{ maxWidth: '420px', marginBottom: '18px', position: 'relative' }}>
        {selectedPart ? (
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '9px 12px', background: '#fef3e2', borderRadius: '8px', border: '1.5px solid #e7dfd3', fontSize: '13px' }}>
            <span style={{ fontWeight: '600' }}>{selectedPart.name} ({selectedPart.sku})</span>
            <button onClick={() => { setSelectedPartId(''); setQuery('') }} style={{ background: 'none', border: 'none', color: '#e11d48', cursor: 'pointer' }}>✕</button>
          </div>
        ) : (
          <>
            <input style={inp} placeholder="Search a part to see its movement history..." value={query}
              onChange={e => { setQuery(e.target.value); setOpen(true) }} onFocus={() => setOpen(true)} />
            {open && results.length > 0 && (
              <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: 'white', border: '1.5px solid #e7dfd3', borderRadius: '8px', marginTop: '2px', zIndex: 20, boxShadow: '0 8px 20px rgba(0,0,0,0.12)', maxHeight: '220px', overflowY: 'auto' }}>
                {results.map(p => (
                  <div key={p.id} onClick={() => { setSelectedPartId(p.id); setQuery(''); setOpen(false) }}
                    style={{ padding: '9px 12px', cursor: 'pointer', fontSize: '13px', borderBottom: '1px solid #f8f5f0' }}
                    onMouseEnter={e => e.currentTarget.style.background = '#fdf8f3'}
                    onMouseLeave={e => e.currentTarget.style.background = 'white'}>
                    <div style={{ fontWeight: '600' }}>{p.name}</div>
                    <div style={{ fontSize: '11px', color: '#a89478' }}>{p.sku} · {p.current_stock || 0} in stock</div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>

      {!selectedPartId ? (
        <div style={{ padding: '60px', textAlign: 'center', color: '#a89478', background: 'white', borderRadius: '16px', border: '1px solid #f3ede4' }}>
          Search for a part above to see everything that's happened to its stock.
        </div>
      ) : loading || !events ? (
        <div style={{ padding: '60px', textAlign: 'center', color: '#a89478' }}>Loading movement history...</div>
      ) : (
        <div style={{ background: 'white', borderRadius: '16px', border: '1px solid #f3ede4', overflow: 'hidden' }}>
          <div style={{ padding: '16px 18px', borderBottom: '1px solid #f3ede4', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <div style={{ fontWeight: '800', fontSize: '15px', color: '#1c1917' }}>{selectedPart?.name}</div>
              <div style={{ fontSize: '12px', color: '#a89478' }}>{selectedPart?.sku}</div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: '10px', fontWeight: '700', color: '#a89478', textTransform: 'uppercase' }}>Current Stock</div>
              <div style={{ fontSize: '20px', fontWeight: '800', color: '#1c1917' }}>{currentStock}</div>
            </div>
          </div>

          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr style={{ background: '#fdf8f3', borderBottom: '2px solid #f3ede4' }}>
              {['Date', 'Type', 'Reference', 'Qty Change', 'Unit Cost', 'Balance After'].map(h => (
                <th key={h} style={{ padding: '10px 14px', textAlign: 'left', fontSize: '10px', fontWeight: '700', color: '#a89478', textTransform: 'uppercase' }}>{h}</th>
              ))}
            </tr></thead>
            <tbody>
              {events.startingStock !== 0 && (
                <tr style={{ borderBottom: '1px solid #f8f5f0', background: '#fdf8f3' }}>
                  <td style={{ padding: '10px 14px', fontSize: '12px', color: '#8a7a63' }} colSpan={5}>
                    Stock before tracked history {events.startingStock < 0 && <span style={{ color: '#e11d48' }}>(negative — some past movement isn't accounted for; worth a closer look)</span>}
                  </td>
                  <td style={{ padding: '10px 14px', fontWeight: '700' }}>{events.startingStock}</td>
                </tr>
              )}
              {events.list.map((e, i) => (
                <tr key={i} style={{ borderBottom: '1px solid #f8f5f0', background: i % 2 === 0 ? 'white' : '#fdfbf8' }}>
                  <td style={{ padding: '10px 14px', fontSize: '12px', color: '#78716c' }}>{timeAgo(e.date)}</td>
                  <td style={{ padding: '10px 14px', fontSize: '12px', fontWeight: '700' }}>{e.type}</td>
                  <td style={{ padding: '10px 14px', fontSize: '12px', color: '#57534e' }}>{e.ref}{e.note ? ` — ${e.note}` : ''}</td>
                  <td style={{ padding: '10px 14px', fontWeight: '700', color: e.delta > 0 ? '#059669' : e.delta < 0 ? '#e11d48' : '#94a3b8' }}>
                    {e.delta > 0 ? `+${e.delta}` : e.delta}
                  </td>
                  <td style={{ padding: '10px 14px', fontSize: '13px', color: '#78716c' }}>{e.unitCost ? formatLKR(e.unitCost) : '—'}</td>
                  <td style={{ padding: '10px 14px', fontWeight: '700' }}>{e.balance}</td>
                </tr>
              ))}
              {events.list.length === 0 && (
                <tr><td colSpan={6} style={{ padding: '40px', textAlign: 'center', color: '#a89478' }}>No tracked movements for this part yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
