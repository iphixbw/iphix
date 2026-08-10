import { useState, useEffect } from 'react'
import { supabase } from '../../supabase'
import toast from 'react-hot-toast'
import { formatLKR, timeAgo } from '../../lib/repairConstants'
import { generateRepairPurchaseNo, generateRepairSupplierNo } from '../../lib/repairHelpers'
import { PartModal } from './RepairInventory'
import RepairPurchaseReturns from './RepairPurchaseReturns'

export default function RepairPurchases({ shop }) {
  const [tab, setTab] = useState('purchases')
  const [purchases, setPurchases] = useState([])
  const [suppliers, setSuppliers] = useState([])
  const [loading, setLoading] = useState(true)
  const [showNew, setShowNew] = useState(false)
  const [viewing, setViewing] = useState(null)
  const [viewItems, setViewItems] = useState([])
  const [voidingPurchase, setVoidingPurchase] = useState(null)

  useEffect(() => { fetchAll() }, [shop?.id])

  async function fetchAll() {
    setLoading(true)
    let pq = supabase.from('repair_purchases').select('*, repair_suppliers(name, supplier_no)').order('created_at', { ascending: false })
    if (shop?.id) pq = pq.eq('shop_id', shop.id)
    const [{ data: p }, { data: s }] = await Promise.all([pq, supabase.from('repair_suppliers').select('*').order('name')])
    setPurchases(p || [])
    setSuppliers(s || [])
    setLoading(false)
  }

  async function viewPurchase(p) {
    const { data } = await supabase.from('repair_purchase_items').select('*, repair_parts(name, sku)').eq('purchase_id', p.id)
    setViewItems(data || [])
    setViewing(p)
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '20px' }}>
        <div>
          <h1 style={{ fontSize: '22px', fontWeight: '800', color: '#1c1917', margin: '0 0 4px' }}>Repair Purchases</h1>
          <p style={{ color: '#8a7a63', fontSize: '14px', margin: 0 }}>Separate from retail purchases · repair parts only</p>
        </div>
        <button onClick={() => setShowNew(true)}
          style={{ padding: '11px 22px', background: 'linear-gradient(135deg,#f0b23d,#d4881f)', color: '#1c1917', border: 'none', borderRadius: '12px', cursor: 'pointer', fontWeight: '800', fontSize: '14px' }}>
          + New Purchase
        </button>
      </div>

      <div style={{ display: 'flex', gap: '6px', marginBottom: '18px' }}>
        {[{ id: 'purchases', label: 'Purchases' }, { id: 'suppliers', label: 'Suppliers' }, { id: 'returns', label: 'Returns' }].map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            style={{ padding: '9px 18px', borderRadius: '10px', border: 'none', background: tab === t.id ? '#1c1917' : '#f5f1ea', color: tab === t.id ? '#f0b23d' : '#78716c', fontWeight: '700', fontSize: '13px', cursor: 'pointer' }}>
            {t.label}
          </button>
        ))}
      </div>

      {loading ? <div style={{ padding: '60px', textAlign: 'center', color: '#a89478' }}>Loading...</div> : tab === 'purchases' ? (
        <div style={{ background: 'white', borderRadius: '16px', border: '1px solid #f3ede4', overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr style={{ background: '#fdf8f3', borderBottom: '2px solid #f3ede4' }}>
              {['Purchase No', 'Supplier', 'Date', 'Total', 'Paid', 'Balance', 'Status', ''].map(h => (
                <th key={h} style={{ padding: '10px 14px', textAlign: 'left', fontSize: '10px', fontWeight: '700', color: '#a89478', textTransform: 'uppercase' }}>{h}</th>
              ))}
            </tr></thead>
            <tbody>
              {purchases.map((p, i) => (
                <tr key={p.id} style={{ borderBottom: '1px solid #f8f5f0', background: p.status === 'voided' ? '#faf9f7' : i % 2 === 0 ? 'white' : '#fdfbf8', opacity: p.status === 'voided' ? 0.6 : 1 }}>
                  <td onClick={() => viewPurchase(p)} style={{ padding: '11px 14px', fontWeight: '700', color: '#d4881f', cursor: 'pointer' }}>{p.purchase_no}</td>
                  <td onClick={() => viewPurchase(p)} style={{ padding: '11px 14px', cursor: 'pointer' }}>{p.repair_suppliers?.name || '—'}</td>
                  <td onClick={() => viewPurchase(p)} style={{ padding: '11px 14px', fontSize: '12px', color: '#78716c', cursor: 'pointer' }}>{timeAgo(p.created_at)}</td>
                  <td onClick={() => viewPurchase(p)} style={{ padding: '11px 14px', fontWeight: '700', cursor: 'pointer' }}>{formatLKR(p.total)}</td>
                  <td onClick={() => viewPurchase(p)} style={{ padding: '11px 14px', color: '#059669', cursor: 'pointer' }}>{formatLKR(p.amount_paid)}</td>
                  <td onClick={() => viewPurchase(p)} style={{ padding: '11px 14px', color: p.credit_amount > 0 ? '#e11d48' : '#94a3b8', fontWeight: '700', cursor: 'pointer' }}>{formatLKR(p.credit_amount)}</td>
                  <td onClick={() => viewPurchase(p)} style={{ padding: '11px 14px', cursor: 'pointer' }}>
                    {p.status === 'voided'
                      ? <span style={{ padding: '3px 10px', borderRadius: '8px', fontSize: '11px', fontWeight: '700', background: '#f1f5f9', color: '#64748b' }}>Voided</span>
                      : <span style={{ padding: '3px 10px', borderRadius: '8px', fontSize: '11px', fontWeight: '700', background: '#f0fdf4', color: '#166534' }}>{p.status}</span>}
                  </td>
                  <td style={{ padding: '11px 14px' }}>
                    {p.status !== 'voided' && (
                      <button onClick={() => setVoidingPurchase(p)} style={{ padding: '4px 10px', background: '#fef2f2', color: '#e11d48', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '11px', fontWeight: '700' }}>
                        Void
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {purchases.length === 0 && <div style={{ padding: '48px', textAlign: 'center', color: '#a89478' }}>No purchases yet.</div>}
        </div>
      ) : tab === 'suppliers' ? (
        <SupplierList shop={shop} suppliers={suppliers} onChanged={fetchAll} />
      ) : (
        <RepairPurchaseReturns shop={shop} />
      )}

      {showNew && <NewPurchaseModal shop={shop} suppliers={suppliers} onClose={() => setShowNew(false)} onCreated={() => { setShowNew(false); fetchAll() }} onSuppliersChanged={fetchAll} />}
      {viewing && <ViewPurchaseModal purchase={viewing} items={viewItems} onClose={() => setViewing(null)} />}
      {voidingPurchase && <VoidPurchaseModal shop={shop} purchase={voidingPurchase} onClose={() => setVoidingPurchase(null)} onVoided={() => { setVoidingPurchase(null); fetchAll() }} />}
    </div>
  )
}

function SupplierList({ shop, suppliers, onChanged }) {
  const [showNew, setShowNew] = useState(false)
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [saving, setSaving] = useState(false)
  const [selected, setSelected] = useState(null)
  const [statement, setStatement] = useState([])
  const [showPay, setShowPay] = useState(false)

  async function handleAdd() {
    if (!name.trim()) return toast.error('Supplier name required')
    setSaving(true)
    try {
      const supplier_no = await generateRepairSupplierNo()
      await supabase.from('repair_suppliers').insert({ supplier_no, name: name.trim(), phone: phone || null })
      toast.success('Supplier added')
      setShowNew(false); setName(''); setPhone(''); onChanged()
    } catch (e) { toast.error('Failed: ' + e.message) }
    setSaving(false)
  }

  async function openSupplier(s) {
    setSelected(s)
    const { data: fresh } = await supabase.from('repair_suppliers').select('*').eq('id', s.id).single()
    let supplierRow = fresh || s
    if (fresh) setSelected(fresh)

    const [{ data: purchases }, { data: thirdPartyItems }, { data: returns }] = await Promise.all([
      supabase.from('repair_purchases').select('total, amount_paid').eq('supplier_id', supplierRow.id),
      supabase.from('repair_third_party_items').select('cost_price, quantity').eq('supplier_id', supplierRow.id).eq('payment_status', 'pending'),
      supabase.from('repair_purchase_returns').select('total').eq('supplier_id', supplierRow.id).neq('status', 'voided'),
    ])
    // Same self-healing recalc as customers — keeps outstanding_balance
    // resilient to any gap in the incremental adjust-RPC calls (like the one
    // that turned up for customers), rather than trusting it's always been
    // perfectly kept in sync everywhere.
    const trueBalance = (supplierRow.opening_balance || 0)
      + (purchases || []).reduce((s, p) => s + Math.max(0, (p.total || 0) - (p.amount_paid || 0)), 0)
      + (thirdPartyItems || []).reduce((s, t) => s + (t.cost_price || 0) * (t.quantity || 1), 0)
      - (returns || []).reduce((s, r) => s + (r.total || 0), 0)
    if (trueBalance !== supplierRow.outstanding_balance) {
      const { data: updated } = await supabase.from('repair_suppliers').update({ outstanding_balance: trueBalance }).eq('id', supplierRow.id).select().single()
      if (updated) { supplierRow = updated; setSelected(updated); setSuppliers(ss => ss.map(sp => sp.id === updated.id ? updated : sp)) }
    }

    await loadStatement(supplierRow)
  }

  async function loadStatement(supplier) {
    const supplierId = supplier.id
    const [{ data: purchases }, { data: payments }, { data: thirdPartyItems }, { data: returns }] = await Promise.all([
      supabase.from('repair_purchases').select('*').eq('supplier_id', supplierId).order('created_at', { ascending: true }),
      supabase.from('repair_supplier_standalone_payments').select('*, bank_accounts(name)').eq('supplier_id', supplierId).order('created_at', { ascending: true }),
      supabase.from('repair_third_party_items').select('*, repair_jobs(job_no), repair_sales(sale_no)').eq('supplier_id', supplierId).order('created_at', { ascending: true }),
      supabase.from('repair_purchase_returns').select('*').eq('supplier_id', supplierId).neq('status', 'voided').order('created_at', { ascending: true }),
    ])
    const events = []
    if (supplier.opening_balance > 0) {
      events.push({
        date: supplier.created_at || new Date(0).toISOString(), type: 'opening',
        label: 'Opening balance brought forward',
        debit: supplier.opening_balance, credit: 0, ref: 'OPEN-BAL',
      })
    }
    ;(purchases || []).forEach(p => events.push({
      date: p.created_at, type: 'purchase', label: `Purchase ${p.purchase_no}`,
      debit: p.total, credit: p.initial_payment || 0, ref: p.purchase_no,
    }))
    ;(returns || []).forEach(r => events.push({
      date: r.created_at, type: 'return', label: `Return ${r.return_no}`,
      debit: 0, credit: r.total, ref: r.return_no,
    }))
    ;(thirdPartyItems || []).forEach(t => {
      const lineTotal = (t.cost_price || 0) * (t.quantity || 1)
      const ref = t.repair_jobs?.job_no || t.repair_sales?.sale_no || ''
      events.push({
        date: t.created_at, type: 'purchase',
        label: `3rd-party item — ${t.item_name}${ref ? ` (${ref})` : ''}`,
        debit: lineTotal, credit: 0, ref,
      })
      if (t.payment_status === 'paid' && t.paid_at) {
        events.push({
          date: t.paid_at, type: 'payment',
          label: `Settled (${t.payment_method || 'unknown'}) — ${t.item_name}`,
          debit: 0, credit: lineTotal, ref,
        })
      }
    })
    ;(payments || []).forEach(pay => {
      events.push({
        date: pay.created_at, type: 'payment', label: `Payment (${pay.payment_method}${pay.bank_accounts?.name ? ' — ' + pay.bank_accounts.name : ''})`,
        debit: 0, credit: pay.amount, ref: pay.reference,
      })
      if (pay.cheque_status === 'returned') {
        events.push({
          date: pay.returned_at || pay.created_at, type: 'reversal',
          label: 'Cheque returned/bounced — payment reversed',
          debit: pay.amount, credit: 0, ref: pay.reference,
        })
      }
    })
    events.sort((a, b) => new Date(a.date) - new Date(b.date))
    let running = 0
    events.forEach(e => { running += e.debit - e.credit; e.balance = running })
    setStatement(events)
  }

  const totalPurchased = statement.filter(e => e.type === 'purchase').reduce((s, e) => s + e.debit, 0)
  const totalOutstandingAll = suppliers.reduce((s, sup) => s + Math.max(0, sup.outstanding_balance || 0), 0)
  const totalCreditAll = suppliers.reduce((s, sup) => s + Math.max(0, -(sup.outstanding_balance || 0)), 0)

  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: totalCreditAll > 0 ? 'repeat(2, minmax(200px, 1fr))' : 'minmax(200px, 1fr)', gap: '14px', marginBottom: '18px', maxWidth: '620px' }}>
        <div style={{ background: '#fff1f2', borderRadius: '14px', padding: '16px 18px', border: '1px solid rgba(0,0,0,0.04)' }}>
          <div style={{ fontSize: '11px', fontWeight: '700', color: '#e11d48', textTransform: 'uppercase' }}>Total Outstanding</div>
          <div style={{ fontSize: '21px', fontWeight: '800', color: '#e11d48' }}>{formatLKR(totalOutstandingAll)}</div>
        </div>
        {totalCreditAll > 0 && (
          <div style={{ background: '#f0fdf4', borderRadius: '14px', padding: '16px 18px', border: '1px solid rgba(0,0,0,0.04)' }}>
            <div style={{ fontSize: '11px', fontWeight: '700', color: '#059669', textTransform: 'uppercase' }}>Total Credit (owed to you)</div>
            <div style={{ fontSize: '21px', fontWeight: '800', color: '#059669' }}>{formatLKR(totalCreditAll)}</div>
          </div>
        )}
      </div>

      <button onClick={() => setShowNew(true)} style={{ marginBottom: '14px', padding: '9px 18px', background: '#fef3e2', color: '#d4881f', border: 'none', borderRadius: '10px', cursor: 'pointer', fontWeight: '700', fontSize: '13px' }}>+ Add Supplier</button>
      <div style={{ background: 'white', borderRadius: '16px', border: '1px solid #f3ede4', overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr style={{ background: '#fdf8f3', borderBottom: '2px solid #f3ede4' }}>
            {['Supplier No', 'Name', 'Phone', 'Outstanding'].map(h => <th key={h} style={{ padding: '10px 14px', textAlign: 'left', fontSize: '10px', fontWeight: '700', color: '#a89478', textTransform: 'uppercase' }}>{h}</th>)}
          </tr></thead>
          <tbody>
            {suppliers.map((s, i) => (
              <tr key={s.id} onClick={() => openSupplier(s)} style={{ borderBottom: '1px solid #f8f5f0', cursor: 'pointer', background: i % 2 === 0 ? 'white' : '#fdfbf8' }}>
                <td style={{ padding: '11px 14px', color: '#d4881f', fontWeight: '700' }}>{s.supplier_no}</td>
                <td style={{ padding: '11px 14px', fontWeight: '600' }}>{s.name}</td>
                <td style={{ padding: '11px 14px' }}>{s.phone || '—'}</td>
                <td style={{ padding: '11px 14px', fontWeight: '700', color: s.outstanding_balance > 0 ? '#e11d48' : s.outstanding_balance < 0 ? '#059669' : '#94a3b8' }}>
                  {s.outstanding_balance < 0 ? `Credit ${formatLKR(Math.abs(s.outstanding_balance))}` : formatLKR(s.outstanding_balance)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {suppliers.length === 0 && <div style={{ padding: '48px', textAlign: 'center', color: '#a89478' }}>No suppliers yet.</div>}
      </div>

      {selected && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(28,25,23,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '20px' }}>
          <div style={{ background: 'white', borderRadius: '18px', padding: '26px', width: '100%', maxWidth: '600px', maxHeight: '85vh', overflowY: 'auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '16px' }}>
              <div>
                <h3 style={{ fontSize: '18px', fontWeight: '800', color: '#1c1917', margin: '0 0 2px' }}>{selected.name}</h3>
                <p style={{ fontSize: '13px', color: '#8a7a63', margin: 0 }}>{selected.supplier_no} {selected.phone && `· ${selected.phone}`}</p>
              </div>
              <button onClick={() => { setSelected(null); setStatement([]) }} style={{ background: 'none', border: 'none', fontSize: '20px', cursor: 'pointer', color: '#a89478' }}>✕</button>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginBottom: '14px' }}>
              <div style={{ background: '#fef3e2', borderRadius: '10px', padding: '12px' }}>
                <div style={{ fontSize: '10px', fontWeight: '700', color: '#d4881f', textTransform: 'uppercase' }}>Total Purchased</div>
                <div style={{ fontSize: '18px', fontWeight: '800', color: '#d4881f' }}>{formatLKR(totalPurchased)}</div>
              </div>
              <div style={{ background: selected.outstanding_balance > 0 ? '#fff1f2' : selected.outstanding_balance < 0 ? '#f0fdf4' : '#f8f5f0', borderRadius: '10px', padding: '12px' }}>
                <div style={{ fontSize: '10px', fontWeight: '700', color: selected.outstanding_balance > 0 ? '#e11d48' : selected.outstanding_balance < 0 ? '#059669' : '#8a7a63', textTransform: 'uppercase' }}>
                  {selected.outstanding_balance < 0 ? 'Credit Balance' : 'Outstanding'}
                </div>
                <div style={{ fontSize: '18px', fontWeight: '800', color: selected.outstanding_balance > 0 ? '#e11d48' : selected.outstanding_balance < 0 ? '#059669' : '#8a7a63' }}>
                  {formatLKR(Math.abs(selected.outstanding_balance))}
                </div>
                {selected.outstanding_balance < 0 && <div style={{ fontSize: '10px', color: '#059669', marginTop: '2px' }}>Overpaid — owed back to you</div>}
              </div>
            </div>

            <button onClick={() => setShowPay(true)} style={{ marginBottom: '14px', padding: '9px 16px', background: 'linear-gradient(135deg,#f0b23d,#d4881f)', color: '#1c1917', border: 'none', borderRadius: '9px', cursor: 'pointer', fontWeight: '700', fontSize: '13px' }}>
              💵 Record Payment
            </button>

            <h4 style={{ fontSize: '13px', fontWeight: '800', color: '#1c1917', margin: '0 0 10px' }}>Activity Statement</h4>
            {statement.length === 0 ? <div style={{ fontSize: '13px', color: '#a89478' }}>No activity yet.</div> : (
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12.5px' }}>
                <thead><tr style={{ borderBottom: '1px solid #f3ede4' }}>
                  {['Date', 'Description', 'Debit', 'Credit', 'Balance'].map(h => <th key={h} style={{ padding: '6px 8px', textAlign: 'left', fontSize: '10px', color: '#a89478', textTransform: 'uppercase' }}>{h}</th>)}
                </tr></thead>
                <tbody>
                  {statement.map((e, i) => (
                    <tr key={i} style={{ borderBottom: '1px solid #f8f5f0' }}>
                      <td style={{ padding: '7px 8px', color: '#78716c' }}>{timeAgo(e.date)}</td>
                      <td style={{ padding: '7px 8px', fontWeight: '600' }}>{e.label}</td>
                      <td style={{ padding: '7px 8px', color: '#e11d48' }}>{e.debit > 0 ? formatLKR(e.debit) : '—'}</td>
                      <td style={{ padding: '7px 8px', color: '#059669' }}>{e.credit > 0 ? formatLKR(e.credit) : '—'}</td>
                      <td style={{ padding: '7px 8px', fontWeight: '700' }}>{formatLKR(e.balance)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {showPay && selected && (
        <SupplierPaymentModal shop={shop} supplier={selected} onClose={() => setShowPay(false)}
          onPaid={(freshSupplier) => {
            setShowPay(false)
            loadStatement(freshSupplier || selected)
            onChanged()
            if (freshSupplier) setSelected(freshSupplier)
          }} />
      )}

      {showNew && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(28,25,23,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}>
          <div style={{ background: 'white', borderRadius: '18px', padding: '24px', width: '100%', maxWidth: '360px' }}>
            <h3 style={{ fontSize: '16px', fontWeight: '800', margin: '0 0 16px', color: '#1c1917' }}>Add Supplier</h3>
            <input style={{ width: '100%', padding: '9px 12px', border: '1.5px solid #e7dfd3', borderRadius: '8px', marginBottom: '10px', boxSizing: 'border-box' }} placeholder="Name" value={name} onChange={e => setName(e.target.value)} />
            <input style={{ width: '100%', padding: '9px 12px', border: '1.5px solid #e7dfd3', borderRadius: '8px', marginBottom: '16px', boxSizing: 'border-box' }} placeholder="Phone" value={phone} onChange={e => setPhone(e.target.value)} />
            <div style={{ display: 'flex', gap: '10px' }}>
              <button onClick={() => setShowNew(false)} style={{ flex: 1, padding: '10px', background: '#f5f1ea', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: '700' }}>Cancel</button>
              <button onClick={handleAdd} disabled={saving} style={{ flex: 1, padding: '10px', background: 'linear-gradient(135deg,#f0b23d,#d4881f)', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: '800' }}>{saving ? 'Saving...' : 'Add'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// Item 6: pay down a supplier's outstanding balance via cash or a iPHIX Technologies bank account.
// The payment is applied FIFO across the supplier's own outstanding purchases (oldest
// first), updating each purchase's amount_paid/credit_amount — not just the supplier's
// aggregate balance — so the Purchases list correctly reflects payments made here.
function SupplierPaymentModal({ shop, supplier, onClose, onPaid }) {
  const [amount, setAmount] = useState('')
  const [method, setMethod] = useState('cash')
  const [bankAccountId, setBankAccountId] = useState('')
  const [bankAccounts, setBankAccounts] = useState([])
  const [chequeNo, setChequeNo] = useState('')
  const [chequeDate, setChequeDate] = useState('')
  const [reference, setReference] = useState('')
  const [saving, setSaving] = useState(false)
  const [outstandingPurchases, setOutstandingPurchases] = useState([])

  useEffect(() => { supabase.from('bank_accounts').select('*').order('name').then(({ data }) => setBankAccounts(data || [])) }, [])
  useEffect(() => { fetchOutstandingPurchases() }, [supplier.id])

  function fetchOutstandingPurchases() {
    supabase.from('repair_purchases').select('id, purchase_no, total, amount_paid, created_at')
      .eq('supplier_id', supplier.id).eq('status', 'confirmed').order('created_at', { ascending: true })
      .then(({ data, error }) => {
        if (error) { toast.error('Failed to load outstanding purchases: ' + error.message); return }
        setOutstandingPurchases((data || []).filter(p => (p.total || 0) - (p.amount_paid || 0) > 0.009))
      })
  }

  async function handlePay() {
    const amt = parseFloat(amount)
    if (!amt || amt <= 0) return toast.error('Enter a valid amount')
    if ((method === 'bank' || method === 'cheque') && !bankAccountId) return toast.error('Select a bank account')
    if (method === 'cheque' && !chequeDate) return toast.error('Enter the cheque date')
    setSaving(true)
    try {
      const { data: payment, error: payErr } = await supabase.from('repair_supplier_standalone_payments').insert({
        supplier_id: supplier.id, shop_id: shop?.id || null, amount: amt,
        payment_method: method, bank_account_id: (method === 'bank' || method === 'cheque') ? bankAccountId : null,
        cheque_no: method === 'cheque' ? chequeNo || null : null,
        cheque_date: method === 'cheque' ? chequeDate || null : null,
        cheque_status: method === 'cheque' ? 'pending' : null,
        reference: reference || null,
      }).select().single()
      if (payErr) throw payErr

      // Apply FIFO across this supplier's outstanding purchases, oldest first —
      // recording exactly how much went to each so a later cheque return knows
      // precisely what to reverse.
      let remaining = amt
      const purchaseUpdateErrors = []
      for (const p of outstandingPurchases) {
        if (remaining <= 0.009) break
        const due = Math.max(0, (p.total || 0) - (p.amount_paid || 0))
        if (due <= 0.009) continue
        const settle = Math.min(due, remaining)
        const { error: updErr } = await supabase.from('repair_purchases').update({
          amount_paid: (p.amount_paid || 0) + settle,
          credit_amount: Math.max(0, (p.total || 0) - ((p.amount_paid || 0) + settle)),
        }).eq('id', p.id)
        if (updErr) purchaseUpdateErrors.push(`${p.purchase_no}: ${updErr.message}`)
        const { error: allocErr } = await supabase.from('repair_supplier_payment_allocations').insert({
          payment_id: payment.id, purchase_id: p.id, amount: settle,
        })
        if (allocErr) purchaseUpdateErrors.push(`${p.purchase_no} allocation: ${allocErr.message}`)
        remaining -= settle
      }
      if (purchaseUpdateErrors.length > 0) {
        // Surface this loudly rather than let the payment appear to succeed while
        // silently failing to update the purchases it was meant to settle — this
        // was previously swallowed, since a failed .update() here doesn't throw.
        toast.error('Payment recorded, but some purchases failed to update: ' + purchaseUpdateErrors.join('; '))
      }
      if (outstandingPurchases.length === 0) {
        toast.error('No outstanding purchases found for this supplier — payment recorded against balance only. If purchases exist, try closing and reopening this dialog.')
      }

      await supabase.rpc('repair_adjust_supplier_balance', { p_supplier_id: supplier.id, p_delta: -amt })
      if (method === 'cash') {
        await supabase.from('repair_cash_ledger').insert({ shop_id: shop?.id || null, type: 'payment', amount: -amt, reference: supplier.name, notes: 'Supplier payment' })
      } else if (method === 'bank') {
        const bank = bankAccounts.find(b => b.id === bankAccountId)
        await supabase.from('bank_accounts').update({ balance: (bank?.balance || 0) - amt }).eq('id', bankAccountId)
        await supabase.from('bank_transactions').insert({ bank_account_id: bankAccountId, type: 'withdrawal', amount: amt, reference: `Repair supplier payment: ${supplier.name}`, notes: reference || '' })
      } else if (method === 'cheque') {
        // Cheque out — recorded pending, uses the same shared bank_accounts table
        // as the ERP retail side, so it shows up alongside retail's own cheques
        // in Bank > Cheques Due until presented/returned. No balance deduction
        // yet — that happens when the cheque is actually presented, matching
        // the retail cheque flow's convention. Linked both ways to the payment
        // record, so a return can find its way back to the purchases it settled.
        const { data: btx } = await supabase.from('bank_transactions').insert({
          bank_account_id: bankAccountId, type: 'cheque_out', amount: amt,
          cheque_no: chequeNo || null, cheque_date: chequeDate || null, cheque_status: 'pending',
          reference: `Repair supplier payment: ${supplier.name}`, notes: reference || '',
          repair_supplier_payment_id: payment.id,
        }).select().single()
        if (btx) await supabase.from('repair_supplier_standalone_payments').update({ bank_transaction_id: btx.id }).eq('id', payment.id)
      }
      toast.success('Payment recorded')
      // Fetch the updated supplier directly here and pass it back — the parent
      // no longer needs its own follow-up fetch, which removes any possibility
      // of a race between this write completing and that fetch reading stale data.
      const { data: freshSupplier } = await supabase.from('repair_suppliers').select('*').eq('id', supplier.id).single()
      onPaid(freshSupplier)
    } catch (e) { toast.error('Failed: ' + e.message) }
    setSaving(false)
  }

  const inp = { width: '100%', padding: '9px 12px', border: '1.5px solid #e7dfd3', borderRadius: '8px', fontSize: '13px', boxSizing: 'border-box' }
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(28,25,23,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1100, padding: '20px' }}>
      <div style={{ background: 'white', borderRadius: '18px', padding: '24px', width: '100%', maxWidth: '380px' }}>
        <h3 style={{ fontSize: '16px', fontWeight: '800', margin: '0 0 4px', color: '#1c1917' }}>Pay {supplier.name}</h3>
        <p style={{ fontSize: '12px', color: '#8a7a63', margin: '0 0 16px' }}>Outstanding: {formatLKR(supplier.outstanding_balance)}</p>
        <div style={{ marginBottom: '10px' }}><label style={{ fontSize: '11px', fontWeight: '700', color: '#a89478' }}>Amount</label><input type="number" style={inp} value={amount} onChange={e => setAmount(e.target.value)} /></div>
        <div style={{ marginBottom: '10px' }}>
          <label style={{ fontSize: '11px', fontWeight: '700', color: '#a89478' }}>Method</label>
          <select style={inp} value={method} onChange={e => setMethod(e.target.value)}>
            <option value="cash">Cash</option>
            <option value="bank">Bank Transfer</option>
            <option value="cheque">Cheque</option>
          </select>
        </div>
        {(method === 'bank' || method === 'cheque') && (
          <div style={{ marginBottom: '10px' }}>
            <label style={{ fontSize: '11px', fontWeight: '700', color: '#a89478' }}>Bank Account {method === 'cheque' ? '(cheque drawn from)' : ''}</label>
            <select style={inp} value={bankAccountId} onChange={e => setBankAccountId(e.target.value)}>
              <option value="">Select...</option>
              {bankAccounts.map(b => <option key={b.id} value={b.id}>{b.name}{b.bank_name ? ` — ${b.bank_name}` : ''}</option>)}
            </select>
          </div>
        )}
        {method === 'cheque' && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginBottom: '10px' }}>
            <div>
              <label style={{ fontSize: '11px', fontWeight: '700', color: '#a89478' }}>Cheque No</label>
              <input style={inp} value={chequeNo} onChange={e => setChequeNo(e.target.value)} />
            </div>
            <div>
              <label style={{ fontSize: '11px', fontWeight: '700', color: '#a89478' }}>Cheque Date</label>
              <input type="date" style={inp} value={chequeDate} onChange={e => setChequeDate(e.target.value)} />
            </div>
          </div>
        )}
        {outstandingPurchases.length > 0 && amount && parseFloat(amount) > 0 && (
          <div style={{ marginBottom: '12px', padding: '10px 12px', background: '#fdf8f3', borderRadius: '8px', fontSize: '11px' }}>
            <div style={{ fontWeight: '700', color: '#a89478', marginBottom: '4px' }}>APPLIED TO (FIFO)</div>
            {(() => {
              let rem = parseFloat(amount)
              return outstandingPurchases.map(p => {
                if (rem <= 0.009) return null
                const due = Math.max(0, (p.total || 0) - (p.amount_paid || 0))
                if (due <= 0.009) return null
                const settle = Math.min(due, rem)
                rem -= settle
                return <div key={p.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 0' }}><span>{p.purchase_no}</span><span style={{ fontWeight: '700' }}>{formatLKR(settle)}</span></div>
              })
            })()}
          </div>
        )}
        <div style={{ marginBottom: '16px' }}><input style={inp} placeholder="Reference (optional)" value={reference} onChange={e => setReference(e.target.value)} /></div>
        <div style={{ display: 'flex', gap: '10px' }}>
          <button onClick={onClose} style={{ flex: 1, padding: '10px', background: '#f5f1ea', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: '700' }}>Cancel</button>
          <button onClick={handlePay} disabled={saving} style={{ flex: 1, padding: '10px', background: 'linear-gradient(135deg,#f0b23d,#d4881f)', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: '800' }}>{saving ? 'Paying...' : 'Pay'}</button>
        </div>
      </div>
    </div>
  )
}

function NewPurchaseModal({ shop, suppliers, onClose, onCreated, onSuppliersChanged }) {
  const [supplierId, setSupplierId] = useState('')
  const [parts, setParts] = useState([])
  const [rows, setRows] = useState([{ part_id: '', quantity: '1', unit_cost: '' }])
  const [paymentMethod, setPaymentMethod] = useState('credit')
  const [amountPaid, setAmountPaid] = useState('')
  const [bankAccountId, setBankAccountId] = useState('')
  const [bankAccounts, setBankAccounts] = useState([])
  const [saving, setSaving] = useState(false)
  const [showNewPart, setShowNewPart] = useState(false)
  const [showNewSupplier, setShowNewSupplier] = useState(false)
  const [newSupplierName, setNewSupplierName] = useState('')
  const [newSupplierPhone, setNewSupplierPhone] = useState('')

  useEffect(() => { fetchParts() }, [])
  useEffect(() => { supabase.from('bank_accounts').select('*').order('name').then(({ data }) => setBankAccounts(data || [])) }, [])

  function fetchParts() {
    supabase.from('repair_parts').select('id, name, purchase_price').order('name').then(({ data }) => setParts(data || []))
  }

  const subtotal = rows.reduce((s, r) => s + (parseFloat(r.quantity) || 0) * (parseFloat(r.unit_cost) || 0), 0)
  const paid = parseFloat(amountPaid) || 0
  const credit = Math.max(0, subtotal - paid)

  function updateRow(i, field, val) {
    setRows(rs => rs.map((r, idx) => idx === i ? { ...r, [field]: val } : r))
  }
  function addRow() { setRows(rs => [...rs, { part_id: '', quantity: '1', unit_cost: '' }]) }
  function removeRow(i) { setRows(rs => rs.filter((_, idx) => idx !== i)) }

  async function handleAddSupplier() {
    if (!newSupplierName.trim()) return toast.error('Supplier name required')
    try {
      const supplier_no = await generateRepairSupplierNo()
      const { data, error } = await supabase.from('repair_suppliers').insert({ supplier_no, name: newSupplierName.trim(), phone: newSupplierPhone || null }).select().single()
      if (error) throw error
      toast.success('Supplier added')
      setSupplierId(data.id)
      setShowNewSupplier(false); setNewSupplierName(''); setNewSupplierPhone('')
      onSuppliersChanged()
    } catch (e) { toast.error('Failed: ' + e.message) }
  }

  async function handleSave() {
    if (!supplierId) return toast.error('Select a supplier')
    const validRows = rows.filter(r => r.part_id && parseFloat(r.quantity) > 0)
    if (validRows.length === 0) return toast.error('Add at least one part')
    if (paymentMethod === 'bank' && !bankAccountId) return toast.error('Select a bank account')
    setSaving(true)
    try {
      const purchase_no = await generateRepairPurchaseNo()
      const { data: purchase, error } = await supabase.from('repair_purchases').insert({
        purchase_no, supplier_id: supplierId, shop_id: shop?.id || null, status: 'confirmed',
        subtotal, total: subtotal, payment_method: paymentMethod, amount_paid: paid, credit_amount: credit, initial_payment: paid,
        bank_account_id: paymentMethod === 'bank' ? bankAccountId : null,
      }).select().single()
      if (error) throw error

      for (const r of validRows) {
        const qty = parseFloat(r.quantity), cost = parseFloat(r.unit_cost) || 0
        await supabase.from('repair_purchase_items').insert({ purchase_id: purchase.id, part_id: r.part_id, quantity: qty, unit_cost: cost, line_total: qty * cost })
        // FIFO: add a new cost-layer batch instead of overwriting an average
        await supabase.rpc('repair_fifo_add_batch', { p_part_id: r.part_id, p_purchase_id: purchase.id, p_quantity: qty, p_unit_cost: cost })
        await supabase.rpc('repair_add_part_stock', { p_part_id: r.part_id, p_quantity: qty })
        // purchase_price is a plain overwrite (most recent price, reference only) — not an increment, so no race risk
        await supabase.from('repair_parts').update({ purchase_price: cost }).eq('id', r.part_id)
      }

      if (credit > 0) {
        await supabase.rpc('repair_adjust_supplier_balance', { p_supplier_id: supplierId, p_delta: credit })
      }
      // Cash/bank payment made at purchase time
      if (paid > 0) {
        if (paymentMethod === 'cash') {
          await supabase.from('repair_cash_ledger').insert({ shop_id: shop?.id || null, type: 'payment', amount: -paid, reference: purchase_no, notes: 'Repair purchase payment' })
        } else if (paymentMethod === 'bank') {
          const bank = bankAccounts.find(b => b.id === bankAccountId)
          await supabase.from('bank_accounts').update({ balance: (bank?.balance || 0) - paid }).eq('id', bankAccountId)
          await supabase.from('bank_transactions').insert({ bank_account_id: bankAccountId, type: 'withdrawal', amount: paid, reference: `Repair purchase: ${purchase_no}`, notes: '' })
        }
      }

      toast.success(`Purchase ${purchase_no} created!`)
      onCreated()
    } catch (e) { toast.error('Failed: ' + e.message) }
    setSaving(false)
  }

  const inp = { width: '100%', padding: '8px 10px', border: '1.5px solid #e7dfd3', borderRadius: '7px', fontSize: '13px', boxSizing: 'border-box' }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(28,25,23,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '20px' }}>
      <div style={{ background: 'white', borderRadius: '20px', padding: '26px', width: '100%', maxWidth: '640px', maxHeight: '88vh', overflowY: 'auto' }}>
        <h2 style={{ fontSize: '18px', fontWeight: '800', color: '#1c1917', margin: '0 0 16px' }}>New Repair Purchase</h2>

        <div style={{ marginBottom: '14px' }}>
          <label style={{ fontSize: '11px', fontWeight: '700', color: '#a89478', textTransform: 'uppercase' }}>Supplier</label>
          <div style={{ display: 'flex', gap: '8px' }}>
            <select style={inp} value={supplierId} onChange={e => setSupplierId(e.target.value)}>
              <option value="">Select supplier...</option>
              {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            <button onClick={() => setShowNewSupplier(true)} style={{ padding: '0 14px', background: '#fef3e2', color: '#d4881f', border: 'none', borderRadius: '7px', cursor: 'pointer', fontSize: '12px', fontWeight: '700', whiteSpace: 'nowrap' }}>+ New</button>
          </div>
          {showNewSupplier && (
            <div style={{ marginTop: '8px', padding: '10px', background: '#fdf8f3', border: '1.5px solid #e7dfd3', borderRadius: '8px' }}>
              <input style={{ ...inp, marginBottom: '6px' }} placeholder="Supplier name" value={newSupplierName} onChange={e => setNewSupplierName(e.target.value)} />
              <input style={{ ...inp, marginBottom: '8px' }} placeholder="Phone (optional)" value={newSupplierPhone} onChange={e => setNewSupplierPhone(e.target.value)} />
              <div style={{ display: 'flex', gap: '6px' }}>
                <button onClick={() => setShowNewSupplier(false)} style={{ flex: 1, padding: '6px', background: 'white', border: '1px solid #e7dfd3', borderRadius: '6px', cursor: 'pointer', fontSize: '12px' }}>Cancel</button>
                <button onClick={handleAddSupplier} style={{ flex: 1, padding: '6px', background: '#d4881f', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '12px', fontWeight: '700' }}>Create</button>
              </div>
            </div>
          )}
        </div>

        <label style={{ fontSize: '11px', fontWeight: '700', color: '#a89478', textTransform: 'uppercase' }}>Parts</label>
        {rows.map((r, i) => (
          <div key={i} style={{ display: 'grid', gridTemplateColumns: '2fr 0.7fr 1fr auto', gap: '8px', marginBottom: '8px', marginTop: '6px' }}>
            <select style={inp} value={r.part_id} onChange={e => updateRow(i, 'part_id', e.target.value)}>
              <option value="">Select part...</option>
              {parts.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            <input type="number" style={inp} placeholder="Qty" value={r.quantity} onChange={e => updateRow(i, 'quantity', e.target.value)} />
            <input type="number" style={inp} placeholder="Unit Cost" value={r.unit_cost} onChange={e => updateRow(i, 'unit_cost', e.target.value)} />
            <button onClick={() => removeRow(i)} style={{ background: '#fee2e2', border: 'none', borderRadius: '7px', color: '#e11d48', cursor: 'pointer', padding: '0 10px' }}>✕</button>
          </div>
        ))}
        <div style={{ display: 'flex', gap: '8px', marginBottom: '16px' }}>
          <button onClick={addRow} style={{ padding: '6px 14px', background: '#fef3e2', color: '#d4881f', border: 'none', borderRadius: '7px', cursor: 'pointer', fontSize: '12px', fontWeight: '700' }}>+ Add Row</button>
          <button onClick={() => setShowNewPart(true)} style={{ padding: '6px 14px', background: '#eef2ff', color: '#1e40af', border: 'none', borderRadius: '7px', cursor: 'pointer', fontSize: '12px', fontWeight: '700' }}>+ New Part</button>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: paymentMethod === 'bank' ? '1fr 1fr 1fr' : '1fr 1fr', gap: '12px', marginBottom: '16px' }}>
          <div>
            <label style={{ fontSize: '11px', fontWeight: '700', color: '#a89478', textTransform: 'uppercase' }}>Payment Method</label>
            <select style={inp} value={paymentMethod} onChange={e => setPaymentMethod(e.target.value)}>
              <option value="credit">Credit</option><option value="cash">Cash</option><option value="bank">iPHIX Technologies Bank Account</option>
            </select>
          </div>
          <div>
            <label style={{ fontSize: '11px', fontWeight: '700', color: '#a89478', textTransform: 'uppercase' }}>Amount Paid</label>
            <input type="number" style={inp} value={amountPaid} onChange={e => setAmountPaid(e.target.value)} />
          </div>
          {paymentMethod === 'bank' && (
            <div>
              <label style={{ fontSize: '11px', fontWeight: '700', color: '#a89478', textTransform: 'uppercase' }}>Bank Account</label>
              <select style={inp} value={bankAccountId} onChange={e => setBankAccountId(e.target.value)}>
                <option value="">Select...</option>
                {bankAccounts.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </div>
          )}
        </div>

        <div style={{ background: '#fdf8f3', borderRadius: '10px', padding: '14px', marginBottom: '18px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', marginBottom: '4px' }}><span>Subtotal</span><span style={{ fontWeight: '700' }}>{formatLKR(subtotal)}</span></div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px' }}><span>Credit Due</span><span style={{ fontWeight: '700', color: '#e11d48' }}>{formatLKR(credit)}</span></div>
        </div>

        <div style={{ display: 'flex', gap: '10px' }}>
          <button onClick={onClose} style={{ flex: 1, padding: '11px', background: '#f5f1ea', border: 'none', borderRadius: '10px', cursor: 'pointer', fontWeight: '700', color: '#78716c' }}>Cancel</button>
          <button onClick={handleSave} disabled={saving} style={{ flex: 2, padding: '11px', background: 'linear-gradient(135deg,#f0b23d,#d4881f)', border: 'none', borderRadius: '10px', cursor: 'pointer', fontWeight: '800', color: '#1c1917' }}>{saving ? 'Saving...' : '✓ Confirm Purchase'}</button>
        </div>
      </div>

      {showNewPart && <PartModal shop={shop} part={null} onClose={() => setShowNewPart(false)} onSaved={() => { setShowNewPart(false); fetchParts() }} />}
    </div>
  )
}

function ViewPurchaseModal({ purchase, items, onClose }) {
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(28,25,23,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '20px' }}>
      <div style={{ background: 'white', borderRadius: '18px', padding: '24px', width: '100%', maxWidth: '500px', maxHeight: '85vh', overflowY: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '16px' }}>
          <h3 style={{ fontSize: '17px', fontWeight: '800', color: '#1c1917', margin: 0 }}>{purchase.purchase_no}</h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: '20px', cursor: 'pointer', color: '#a89478' }}>✕</button>
        </div>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px', marginBottom: '12px' }}>
          <thead><tr style={{ borderBottom: '1px solid #f3ede4' }}>{['Part', 'Qty', 'Cost', 'Total'].map(h => <th key={h} style={{ padding: '6px 8px', textAlign: 'left', fontSize: '10px', color: '#a89478' }}>{h}</th>)}</tr></thead>
          <tbody>
            {items.map(i => (
              <tr key={i.id} style={{ borderBottom: '1px solid #f8f5f0' }}>
                <td style={{ padding: '7px 8px' }}>{i.repair_parts?.name}</td>
                <td style={{ padding: '7px 8px' }}>{i.quantity}</td>
                <td style={{ padding: '7px 8px' }}>{formatLKR(i.unit_cost)}</td>
                <td style={{ padding: '7px 8px', fontWeight: '700' }}>{formatLKR(i.line_total)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '15px', fontWeight: '800', color: '#1c1917' }}><span>Total</span><span>{formatLKR(purchase.total)}</span></div>
      </div>
    </div>
  )
}

// Voiding a purchase means it should never have happened — undo it precisely
// via compensating entries, mirroring Void Job/Void Sale exactly. Unlike
// sales, purchases can have a standalone payment FIFO-split across several
// purchases at once (repair_supplier_payment_allocations) — unwinding one
// purchase's share of a payment that also partly paid off other purchases
// isn't something that can be done safely in general, so voiding is only
// allowed while amount_paid still equals initial_payment (the amount paid
// at creation) — i.e. nothing has been paid toward it since. If a payment
// has been applied, it needs to be reasoned through manually rather than
// risk an incorrect automatic reversal.
function VoidPurchaseModal({ shop, purchase, onClose, onVoided }) {
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)
  const [blockingReturns, setBlockingReturns] = useState(null)
  const [blockedByPayment, setBlockedByPayment] = useState(false)
  const [blockedByMissingBank, setBlockedByMissingBank] = useState(false)
  const [preview, setPreview] = useState(null)
  const [fresh, setFresh] = useState(null)

  useEffect(() => {
    async function load() {
      const { data: freshPurchase } = await supabase.from('repair_purchases').select('*').eq('id', purchase.id).single()
      setFresh(freshPurchase || purchase)

      const { data: activeReturns } = await supabase.from('repair_purchase_returns').select('return_no').eq('purchase_id', purchase.id).neq('status', 'voided')
      if (activeReturns?.length) { setBlockingReturns(activeReturns); return }

      const initial = freshPurchase?.initial_payment || 0
      const paid = freshPurchase?.amount_paid || 0
      if (Math.abs(paid - initial) > 0.009) { setBlockedByPayment(true); return }

      // This purchase predates bank_account_id being recorded at creation —
      // there's no way to know which account to refund into. Checked here,
      // before any reversal starts, so a block can never leave stock/balance
      // already reversed while the purchase record still says confirmed.
      if (freshPurchase?.payment_method === 'bank' && !freshPurchase?.bank_account_id && initial > 0.009) {
        setBlockedByMissingBank(true); return
      }

      const { data: items } = await supabase.from('repair_purchase_items').select('*').eq('purchase_id', purchase.id)
      setPreview({ items: items || [] })
    }
    load()
  }, [purchase.id])

  async function handleVoid() {
    setSaving(true)
    try {
      const { items } = preview

      // Stock sufficiency check up front — can't reverse stock that's since
      // been sold or used on a job.
      for (const it of items) {
        const { data: part } = await supabase.from('repair_parts').select('current_stock, name').eq('id', it.part_id).single()
        if (part && it.quantity > (part.current_stock || 0)) {
          toast.error(`Can't void — only ${part.current_stock || 0} of "${part.name}" left in stock (some may have been used since this purchase)`)
          setSaving(false)
          return
        }
      }

      const consumedSoFar = []
      try {
        for (const it of items) {
          const { data: costConsumed, error: consumeError } = await supabase.rpc('repair_fifo_consume', { p_part_id: it.part_id, p_quantity: it.quantity })
          if (consumeError) throw new Error(consumeError.message)
          const { error: deductError } = await supabase.rpc('repair_deduct_part_stock', { p_part_id: it.part_id, p_quantity: it.quantity })
          if (deductError) throw new Error(deductError.message)
          consumedSoFar.push({ part_id: it.part_id, quantity: it.quantity, avgCost: it.quantity > 0 ? (costConsumed || 0) / it.quantity : 0 })
        }
      } catch (stockErr) {
        for (const c of consumedSoFar.reverse()) {
          await supabase.rpc('repair_fifo_return', { p_part_id: c.part_id, p_quantity: c.quantity, p_unit_cost: c.avgCost })
          await supabase.rpc('repair_add_part_stock', { p_part_id: c.part_id, p_quantity: c.quantity })
        }
        throw stockErr
      }
      await supabase.from('repair_purchase_items').delete().eq('purchase_id', purchase.id)

      // Reverse the debt this purchase added (total minus what was paid at
      // creation) — the same amount that was added when it was created.
      const debtAdded = (fresh.total || 0) - (fresh.initial_payment || 0)
      if (debtAdded > 0.009) {
        await supabase.rpc('repair_adjust_supplier_balance', { p_supplier_id: fresh.supplier_id, p_delta: -debtAdded })
      }

      // Refund whatever was paid at creation, via however it was originally paid.
      const initialPayment = fresh.initial_payment || 0
      if (initialPayment > 0.009) {
        if (fresh.payment_method === 'cash') {
          await supabase.from('repair_cash_ledger').insert({ shop_id: shop?.id || null, type: 'refund', amount: initialPayment, reference: fresh.purchase_no, notes: 'Purchase voided' })
        } else if (fresh.payment_method === 'bank' && fresh.bank_account_id) {
          const { data: bank } = await supabase.from('bank_accounts').select('balance').eq('id', fresh.bank_account_id).single()
          await supabase.from('bank_accounts').update({ balance: (bank?.balance || 0) + initialPayment }).eq('id', fresh.bank_account_id)
          await supabase.from('bank_transactions').insert({ bank_account_id: fresh.bank_account_id, type: 'deposit', amount: initialPayment, reference: `Purchase voided: ${fresh.purchase_no}`, notes: '' })
        }
      }

      await supabase.from('repair_purchases').update({
        status: 'voided', subtotal: 0, total: 0, amount_paid: 0, credit_amount: 0, initial_payment: 0,
        voided_at: new Date().toISOString(), void_reason: reason || null,
      }).eq('id', purchase.id)

      toast.success('Purchase voided — all related transactions reversed')
      onVoided()
    } catch (e) { toast.error('Failed to void: ' + e.message) }
    setSaving(false)
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(28,25,23,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1100, padding: '20px' }}>
      <div style={{ background: 'white', borderRadius: '18px', padding: '24px', width: '100%', maxWidth: '440px' }}>
        <h3 style={{ fontSize: '16px', fontWeight: '800', margin: '0 0 4px', color: '#e11d48' }}>Void Purchase {purchase.purchase_no}?</h3>
        {blockingReturns ? (
          <>
            <p style={{ fontSize: '13px', color: '#44403c', margin: '0 0 16px' }}>
              Can't void — {blockingReturns.length} active return{blockingReturns.length !== 1 ? 's' : ''} ({blockingReturns.map(r => r.return_no).join(', ')}) reference this purchase. Void {blockingReturns.length !== 1 ? 'those' : 'that'} first.
            </p>
            <button onClick={onClose} style={{ width: '100%', padding: '10px', background: '#f5f1ea', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: '700' }}>Close</button>
          </>
        ) : blockedByPayment ? (
          <>
            <p style={{ fontSize: '13px', color: '#44403c', margin: '0 0 16px' }}>
              Can't void automatically — a payment has been applied to this purchase since it was created (possibly split across several purchases via a supplier payment). Reversing that safely needs to be done manually. Let your admin know if this needs sorting out.
            </p>
            <button onClick={onClose} style={{ width: '100%', padding: '10px', background: '#f5f1ea', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: '700' }}>Close</button>
          </>
        ) : blockedByMissingBank ? (
          <>
            <p style={{ fontSize: '13px', color: '#44403c', margin: '0 0 16px' }}>
              Can't void — this purchase was paid by bank transfer, but it predates this app tracking which account was used, so there's no way to know where to refund {formatLKR(fresh?.initial_payment || 0)}. Nothing has been changed. Let your admin know if this needs sorting out manually.
            </p>
            <button onClick={onClose} style={{ width: '100%', padding: '10px', background: '#f5f1ea', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: '700' }}>Close</button>
          </>
        ) : !preview ? (
          <p style={{ fontSize: '13px', color: '#8a7a63' }}>Checking...</p>
        ) : (
          <>
            <p style={{ fontSize: '12px', color: '#8a7a63', margin: '0 0 14px' }}>This cannot be undone. The following will be reversed:</p>
            <ul style={{ fontSize: '13px', color: '#44403c', margin: '0 0 16px', paddingLeft: '18px', lineHeight: '1.7' }}>
              <li>{preview.items.length} part{preview.items.length !== 1 ? 's' : ''} — stock taken back out</li>
              <li>{formatLKR((fresh.total || 0) - (fresh.initial_payment || 0))} removed from supplier balance</li>
              {(fresh.initial_payment || 0) > 0 && <li>{formatLKR(fresh.initial_payment)} refunded ({fresh.payment_method})</li>}
            </ul>
            <label style={{ fontSize: '11px', fontWeight: '700', color: '#a89478', textTransform: 'uppercase' }}>Reason (optional)</label>
            <textarea style={{ width: '100%', padding: '9px 12px', border: '1.5px solid #e7dfd3', borderRadius: '8px', fontSize: '13px', boxSizing: 'border-box', minHeight: '60px', marginBottom: '16px', marginTop: '5px' }} value={reason} onChange={e => setReason(e.target.value)} placeholder="e.g. entered in error" />
            <div style={{ display: 'flex', gap: '10px' }}>
              <button onClick={onClose} style={{ flex: 1, padding: '10px', background: '#f5f1ea', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: '700' }}>Cancel</button>
              <button onClick={handleVoid} disabled={saving} style={{ flex: 1, padding: '10px', background: '#e11d48', color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: '800' }}>{saving ? 'Voiding...' : 'Void Purchase'}</button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
