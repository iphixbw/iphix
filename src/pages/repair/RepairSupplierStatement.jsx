import { useState, useEffect } from 'react'
import { supabase } from '../../supabase'
import { formatLKR, timeAgo } from '../../lib/repairConstants'
import { buildSupplierStatement, ViewPurchaseModal, SupplierTransactionDetailModal } from './RepairPurchases'

// Full-page version of the Activity Statement in the Suppliers modal — same
// underlying data and logic (via the shared buildSupplierStatement), just
// with a whole page to work with instead of a capped-height modal.
export default function RepairSupplierStatement({ supplierId, onBack }) {
  const [supplier, setSupplier] = useState(null)
  const [statement, setStatement] = useState([])
  const [payments, setPayments] = useState([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState('statement')
  const [viewingPurchase, setViewingPurchase] = useState(null)
  const [viewingItems, setViewingItems] = useState([])
  const [viewingTxn, setViewingTxn] = useState(null)

  async function viewPurchase(p) {
    const { data } = await supabase.from('repair_purchase_items').select('*, repair_parts(name, sku)').eq('purchase_id', p.id)
    setViewingItems(data || [])
    setViewingPurchase(p)
  }

  useEffect(() => { load() }, [supplierId])

  async function load() {
    setLoading(true)
    const { data: s } = await supabase.from('repair_suppliers').select('*').eq('id', supplierId).single()
    if (!s) { setLoading(false); return }
    const { statement: st, payments: pmts } = await buildSupplierStatement(s)
    setSupplier(s)
    setStatement(st)
    setPayments(pmts)
    setLoading(false)
  }

  if (loading) return <div style={{ padding: '60px', textAlign: 'center', color: '#a89478' }}>Loading statement...</div>
  if (!supplier) return (
    <div>
      <button onClick={onBack} style={{ background: 'none', border: 'none', color: '#d4881f', fontWeight: '700', fontSize: '13px', cursor: 'pointer', marginBottom: '14px', padding: 0 }}>← Back to Suppliers</button>
      <div style={{ padding: '48px', textAlign: 'center', color: '#a89478' }}>Supplier not found.</div>
    </div>
  )

  return (
    <div>
      <button onClick={onBack} style={{ background: 'none', border: 'none', color: '#d4881f', fontWeight: '700', fontSize: '13px', cursor: 'pointer', marginBottom: '14px', padding: 0 }}>← Back to Suppliers</button>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '20px', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <h1 style={{ fontSize: '22px', fontWeight: '800', color: '#1c1917', margin: '0 0 4px' }}>{supplier.name}</h1>
          <p style={{ color: '#8a7a63', fontSize: '13px', margin: 0 }}>{supplier.supplier_no}{supplier.phone ? ` · ${supplier.phone}` : ''}</p>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: '11px', fontWeight: '700', color: '#a89478', textTransform: 'uppercase' }}>
            {supplier.outstanding_balance < 0 ? 'Credit Balance' : 'Outstanding'}
          </div>
          <div style={{ fontSize: '24px', fontWeight: '800', color: supplier.outstanding_balance > 0 ? '#e11d48' : supplier.outstanding_balance < 0 ? '#059669' : '#1c1917' }}>
            {formatLKR(Math.abs(supplier.outstanding_balance || 0))}
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', gap: '6px', marginBottom: '14px' }}>
        {[{ id: 'statement', label: 'Activity Statement' }, { id: 'payments', label: `Payments (${payments.length})` }].map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            style={{ padding: '6px 14px', borderRadius: '8px', border: 'none', background: tab === t.id ? '#1c1917' : '#f5f1ea', color: tab === t.id ? '#f0b23d' : '#78716c', fontWeight: '700', fontSize: '12px', cursor: 'pointer' }}>
            {t.label}
          </button>
        ))}
      </div>

      <div style={{ background: 'white', borderRadius: '16px', border: '1px solid #f3ede4', overflow: 'hidden' }}>
        {tab === 'statement' ? (
          statement.length === 0 ? (
            <div style={{ padding: '48px', textAlign: 'center', color: '#a89478', fontSize: '13px' }}>No activity yet.</div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid #f3ede4', background: '#fdf8f3' }}>
                  {['Date', 'Description', 'Debit', 'Credit', 'Inv. Bal.', 'Balance'].map(h => (
                    <th key={h} style={{ padding: '10px 14px', textAlign: h === 'Description' ? 'left' : 'right', fontSize: '10px', color: '#a89478', textTransform: 'uppercase' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {statement.map((e, i) => {
                  const clickable = !!e.source
                  function handleClick() {
                    if (!clickable) return
                    if (e.type === 'purchase' && e.kind === 'real_purchase') viewPurchase(e.source)
                    else setViewingTxn(e)
                  }
                  return (
                    <tr key={i} onClick={handleClick}
                      style={{ borderBottom: '1px solid #f8f5f0', cursor: clickable ? 'pointer' : 'default' }}
                      onMouseEnter={ev => clickable && (ev.currentTarget.style.background = '#fdf8f3')}
                      onMouseLeave={ev => clickable && (ev.currentTarget.style.background = 'white')}>
                      <td style={{ padding: '10px 14px', color: '#78716c', whiteSpace: 'nowrap' }}>{timeAgo(e.date)}</td>
                      <td style={{ padding: '10px 14px', fontWeight: '600' }}>{e.label}</td>
                      <td style={{ padding: '10px 14px', textAlign: 'right', color: '#e11d48' }}>{e.debit > 0 ? formatLKR(e.debit) : '—'}</td>
                      <td style={{ padding: '10px 14px', textAlign: 'right', color: '#059669' }}>{e.credit > 0 ? formatLKR(e.credit) : '—'}</td>
                      <td style={{ padding: '10px 14px', textAlign: 'right', color: '#a89478', fontSize: '12px' }}>{e.invoiceBalance != null ? formatLKR(e.invoiceBalance) : '—'}</td>
                      <td style={{ padding: '10px 14px', textAlign: 'right', fontWeight: '700' }}>{formatLKR(e.balance)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )
        ) : (
          payments.length === 0 ? (
            <div style={{ padding: '48px', textAlign: 'center', color: '#a89478', fontSize: '13px' }}>No payments recorded yet.</div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid #f3ede4', background: '#fdf8f3' }}>
                  {['Date', 'Description', 'Amount'].map(h => (
                    <th key={h} style={{ padding: '10px 14px', textAlign: h === 'Amount' ? 'right' : 'left', fontSize: '10px', color: '#a89478', textTransform: 'uppercase' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {payments.map((p, i) => (
                  <tr key={i} style={{ borderBottom: '1px solid #f8f5f0' }}>
                    <td style={{ padding: '10px 14px', color: '#78716c', whiteSpace: 'nowrap' }}>{timeAgo(p.date)}</td>
                    <td style={{ padding: '10px 14px', fontWeight: '600' }}>{p.label}</td>
                    <td style={{ padding: '10px 14px', textAlign: 'right', color: '#059669', fontWeight: '700' }}>{formatLKR(p.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )
        )}
      </div>
      <p style={{ fontSize: '11px', color: '#a89478', marginTop: '10px' }}>
        {tab === 'statement' ? `${statement.length} entr${statement.length === 1 ? 'y' : 'ies'} · sorted oldest to newest` : `${payments.length} payment${payments.length === 1 ? '' : 's'} · sorted oldest to newest`}
      </p>

      {viewingPurchase && <ViewPurchaseModal purchase={viewingPurchase} items={viewingItems} onClose={() => setViewingPurchase(null)} />}
      {viewingTxn && <SupplierTransactionDetailModal event={viewingTxn} onClose={() => setViewingTxn(null)} />}
    </div>
  )
}
