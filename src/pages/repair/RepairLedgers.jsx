import { useState, useEffect } from 'react'
import { supabase } from '../../supabase'
import { formatLKR, timeAgo } from '../../lib/repairConstants'
import { buildCustomerStatement, TransactionDetailModal } from './RepairCustomers'
import { buildSupplierStatement, ViewPurchaseModal, SupplierTransactionDetailModal } from './RepairPurchases'
import { ViewSaleModal } from './RepairSales'

function normalizeName(name) { return (name || '').trim().toLowerCase() }

// Groups every customer and every supplier by normalized name. Anyone
// present as both gets one merged entry carrying both records — anyone
// present as only one keeps their own single entry, so this page is a
// complete listing of everyone on either side, not just the overlap.
function buildEntities(customers, suppliers) {
  const byName = new Map()
  customers.forEach(c => {
    const key = normalizeName(c.name)
    if (!byName.has(key)) byName.set(key, { name: c.name, customer: null, supplier: null })
    byName.get(key).customer = c
  })
  suppliers.forEach(s => {
    const key = normalizeName(s.name)
    if (!byName.has(key)) byName.set(key, { name: s.name, customer: null, supplier: null })
    byName.get(key).supplier = s
  })
  return [...byName.values()].map(e => ({
    ...e,
    isMerged: !!(e.customer && e.supplier),
    // A customer's outstanding_balance is what they owe US (receivable —
    // positive is good for us). A supplier's outstanding_balance is what WE
    // owe THEM (payable — positive is money we still need to pay out). Net
    // position is receivable minus payable: positive means they owe us more
    // than we owe them overall; negative means the reverse.
    netBalance: (e.customer?.outstanding_balance || 0) - (e.supplier?.outstanding_balance || 0),
  })).sort((a, b) => a.name.localeCompare(b.name))
}

export default function RepairLedgers({ shop }) {
  const [customers, setCustomers] = useState([])
  const [suppliers, setSuppliers] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState(null)
  const [ledger, setLedger] = useState([])
  const [ledgerLoading, setLedgerLoading] = useState(false)
  const [viewingTxn, setViewingTxn] = useState(null)
  const [viewingPurchase, setViewingPurchase] = useState(null)
  const [viewingItems, setViewingItems] = useState([])

  useEffect(() => { fetchAll() }, [])

  async function fetchAll() {
    setLoading(true)
    const [{ data: c }, { data: s }] = await Promise.all([
      supabase.from('repair_customers').select('*').order('name'),
      supabase.from('repair_suppliers').select('*').order('name'),
    ])
    setCustomers(c || [])
    setSuppliers(s || [])
    setLoading(false)
  }

  const entities = buildEntities(customers, suppliers)
  const filtered = entities.filter(e => !search.trim() || e.name.toLowerCase().includes(search.toLowerCase()))

  // Builds one combined, chronologically-sorted ledger from whichever of the
  // customer/supplier statements this entity has. Reuses the exact same
  // statement-building functions the Customers and Suppliers pages already
  // use — not a reimplementation — so this can never drift out of sync with
  // what those pages independently show for the same person.
  async function openEntity(entity) {
    setSelected(entity)
    setLedgerLoading(true)
    const events = []
    if (entity.customer) {
      const { statement } = await buildCustomerStatement(entity.customer)
      statement.forEach(e => {
        events.push({
          date: e.date, label: entity.isMerged ? `[Customer] ${e.label}` : e.label,
          amount: e.debit - e.credit, side: 'customer', raw: e,
        })
      })
    }
    if (entity.supplier) {
      const { statement } = await buildSupplierStatement(entity.supplier)
      statement.forEach(e => {
        // Inverted relative to the customer side — a supplier debit (a
        // purchase or 3rd-party item) increases what WE owe, which is a
        // negative contribution to our combined net position; a supplier
        // credit (a payment we make, or a return in our favor) reduces what
        // we owe, a positive contribution.
        events.push({
          date: e.date, label: entity.isMerged ? `[Supplier] ${e.label}` : e.label,
          amount: -(e.debit - e.credit), side: 'supplier', raw: e,
        })
      })
    }
    events.sort((a, b) => new Date(a.date) - new Date(b.date))
    let running = 0
    events.forEach(e => { running += e.amount; e.balance = running })
    setLedger(events)
    setLedgerLoading(false)
  }

  async function handleRowClick(e) {
    if (!e.raw.source) return
    if (e.side === 'customer' && e.raw.type === 'sale') {
      setViewingTxn({ ...e.raw, isSale: true })
    } else if (e.side === 'customer') {
      setViewingTxn(e.raw)
    } else if (e.side === 'supplier' && e.raw.type === 'purchase' && e.raw.kind === 'real_purchase') {
      const { data } = await supabase.from('repair_purchase_items').select('*, repair_parts(name, sku)').eq('purchase_id', e.raw.source.id)
      setViewingItems(data || [])
      setViewingPurchase(e.raw.source)
    } else if (e.side === 'supplier') {
      setViewingTxn({ ...e.raw, isSupplierTxn: true })
    }
  }

  if (selected) {
    return (
      <div>
        <button onClick={() => { setSelected(null); setLedger([]) }} style={{ background: 'none', border: 'none', color: '#d4881f', fontWeight: '700', fontSize: '13px', cursor: 'pointer', marginBottom: '14px', padding: 0 }}>← Back to Ledgers</button>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '20px', flexWrap: 'wrap', gap: '12px' }}>
          <div>
            <h1 style={{ fontSize: '22px', fontWeight: '800', color: '#1c1917', margin: '0 0 4px' }}>{selected.name}</h1>
            <p style={{ color: '#8a7a63', fontSize: '13px', margin: 0 }}>
              {selected.isMerged ? 'Customer & Supplier — combined ledger' : selected.customer ? 'Customer' : 'Supplier'}
              {selected.customer?.mobile ? ` · ${selected.customer.mobile}` : selected.supplier?.phone ? ` · ${selected.supplier.phone}` : ''}
            </p>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: '11px', fontWeight: '700', color: '#a89478', textTransform: 'uppercase' }}>
              {selected.netBalance < 0 ? 'We Owe (Net)' : 'Owed To Us (Net)'}
            </div>
            <div style={{ fontSize: '24px', fontWeight: '800', color: selected.netBalance > 0 ? '#e11d48' : selected.netBalance < 0 ? '#059669' : '#1c1917' }}>
              {formatLKR(Math.abs(selected.netBalance))}
            </div>
          </div>
        </div>

        <div style={{ background: 'white', borderRadius: '16px', border: '1px solid #f3ede4', overflow: 'hidden' }}>
          {ledgerLoading ? (
            <div style={{ padding: '48px', textAlign: 'center', color: '#a89478', fontSize: '13px' }}>Loading ledger...</div>
          ) : ledger.length === 0 ? (
            <div style={{ padding: '48px', textAlign: 'center', color: '#a89478', fontSize: '13px' }}>No activity yet.</div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid #f3ede4', background: '#fdf8f3' }}>
                  {['Date', 'Description', 'Amount', 'Running Balance'].map(h => (
                    <th key={h} style={{ padding: '10px 14px', textAlign: h === 'Description' ? 'left' : 'right', fontSize: '10px', color: '#a89478', textTransform: 'uppercase' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {ledger.map((e, i) => {
                  const clickable = !!e.raw.source
                  return (
                    <tr key={i} onClick={() => clickable && handleRowClick(e)}
                      style={{ borderBottom: '1px solid #f8f5f0', cursor: clickable ? 'pointer' : 'default' }}
                      onMouseEnter={ev => clickable && (ev.currentTarget.style.background = '#fdf8f3')}
                      onMouseLeave={ev => clickable && (ev.currentTarget.style.background = 'white')}>
                      <td style={{ padding: '10px 14px', color: '#78716c', whiteSpace: 'nowrap' }}>{timeAgo(e.date)}</td>
                      <td style={{ padding: '10px 14px', fontWeight: '600' }}>{e.label}</td>
                      <td style={{ padding: '10px 14px', textAlign: 'right', fontWeight: '700', color: e.amount > 0 ? '#059669' : e.amount < 0 ? '#e11d48' : '#94a3b8' }}>
                        {e.amount > 0 ? '+' : e.amount < 0 ? '−' : ''}{formatLKR(Math.abs(e.amount))}
                      </td>
                      <td style={{ padding: '10px 14px', textAlign: 'right', fontWeight: '700', color: e.balance > 0 ? '#059669' : e.balance < 0 ? '#e11d48' : '#1c1917' }}>
                        {formatLKR(Math.abs(e.balance))}{e.balance < 0 ? ' (we owe)' : ''}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>
        <p style={{ fontSize: '11px', color: '#a89478', marginTop: '10px' }}>
          {ledger.length} entr{ledger.length === 1 ? 'y' : 'ies'} · sorted oldest to newest · positive amounts increase what's owed to us, negative amounts increase what we owe
        </p>

        {viewingTxn && viewingTxn.isSale && <ViewSaleModal sale={viewingTxn.source} onClose={() => setViewingTxn(null)} />}
        {viewingTxn && !viewingTxn.isSale && !viewingTxn.isSupplierTxn && <TransactionDetailModal event={viewingTxn} onClose={() => setViewingTxn(null)} />}
        {viewingTxn && viewingTxn.isSupplierTxn && <SupplierTransactionDetailModal event={viewingTxn} onClose={() => setViewingTxn(null)} />}
        {viewingPurchase && <ViewPurchaseModal purchase={viewingPurchase} items={viewingItems} onClose={() => setViewingPurchase(null)} />}
      </div>
    )
  }

  return (
    <div>
      <div style={{ marginBottom: '20px' }}>
        <h1 style={{ fontSize: '22px', fontWeight: '800', color: '#1c1917', margin: '0 0 4px' }}>Ledgers</h1>
        <p style={{ color: '#8a7a63', fontSize: '14px', margin: 0 }}>Every customer and supplier, one place. Anyone who is both gets a single combined ledger with a net balance.</p>
      </div>

      <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search by name..."
        style={{ width: '100%', maxWidth: '360px', padding: '9px 14px', border: '1.5px solid #e7dfd3', borderRadius: '10px', fontSize: '13px', marginBottom: '18px', boxSizing: 'border-box' }} />

      {loading ? <div style={{ padding: '60px', textAlign: 'center', color: '#a89478' }}>Loading...</div> : (
        <div style={{ background: 'white', borderRadius: '16px', border: '1px solid #f3ede4', overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr style={{ background: '#fdf8f3', borderBottom: '2px solid #f3ede4' }}>
              {['Name', 'Type', 'Net Balance'].map(h => (
                <th key={h} style={{ padding: '10px 14px', textAlign: h === 'Net Balance' ? 'right' : 'left', fontSize: '10px', fontWeight: '700', color: '#a89478', textTransform: 'uppercase' }}>{h}</th>
              ))}
            </tr></thead>
            <tbody>
              {filtered.map((e, i) => (
                <tr key={e.name} onClick={() => openEntity(e)} style={{ borderBottom: '1px solid #f8f5f0', cursor: 'pointer', background: i % 2 === 0 ? 'white' : '#fdfbf8' }}>
                  <td style={{ padding: '11px 14px', fontWeight: '700', color: '#1c1917' }}>{e.name}</td>
                  <td style={{ padding: '11px 14px' }}>
                    {e.isMerged ? (
                      <span style={{ padding: '3px 10px', borderRadius: '8px', fontSize: '11px', fontWeight: '700', background: '#fef3e2', color: '#d4881f' }}>Customer & Supplier</span>
                    ) : e.customer ? (
                      <span style={{ padding: '3px 10px', borderRadius: '8px', fontSize: '11px', fontWeight: '700', background: '#eef2ff', color: '#4338ca' }}>Customer</span>
                    ) : (
                      <span style={{ padding: '3px 10px', borderRadius: '8px', fontSize: '11px', fontWeight: '700', background: '#f0fdf4', color: '#166534' }}>Supplier</span>
                    )}
                  </td>
                  <td style={{ padding: '11px 14px', textAlign: 'right', fontWeight: '700', color: e.netBalance > 0 ? '#059669' : e.netBalance < 0 ? '#e11d48' : '#94a3b8' }}>
                    {e.netBalance < 0 ? `We owe ${formatLKR(Math.abs(e.netBalance))}` : formatLKR(e.netBalance)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {filtered.length === 0 && (
            <div style={{ padding: '48px', textAlign: 'center', color: '#a89478' }}>
              {entities.length === 0 ? 'No customers or suppliers yet.' : 'No matches for your search.'}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
