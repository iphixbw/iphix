import { useState, useEffect } from 'react'
import { supabase } from '../../supabase'
import toast from 'react-hot-toast'
import { formatLKR, timeAgo, printPartsSaleReceipt } from '../../lib/repairConstants'
import { generateRepairSaleNo, generateRepairCustomerNo } from '../../lib/repairHelpers'

import { PartPicker, PartNameAutocomplete, fetchOldestBatchCosts } from './RepairInventory'
import RepairSaleReturns from './RepairSaleReturns'

export default function RepairSales({ shop }) {
  const [tab, setTab] = useState('sales')
  const [sales, setSales] = useState([])
  const [loading, setLoading] = useState(true)
  const [showNew, setShowNew] = useState(false)
  const [payingSale, setPayingSale] = useState(null)
  const [voidingSale, setVoidingSale] = useState(null)
  const [viewingSale, setViewingSale] = useState(null)

  useEffect(() => { fetchSales() }, [shop?.id])

  async function fetchSales() {
    setLoading(true)
    let q = supabase.from('repair_sales').select('*, repair_customers(name)').order('created_at', { ascending: false })
    if (shop?.id) q = q.eq('shop_id', shop.id)
    const { data } = await q
    setSales(data || [])
    setLoading(false)
  }

  async function reprintReceipt(sale) {
    const { data: items } = await supabase.from('repair_sale_items').select('*, repair_parts(name)').eq('sale_id', sale.id)
    printPartsSaleReceipt(sale, items || [], sale.repair_customers?.name || sale.customer_name)
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '20px' }}>
        <div>
          <h1 style={{ fontSize: '22px', fontWeight: '800', color: '#1c1917', margin: '0 0 4px' }}>Parts Sales</h1>
          <p style={{ color: '#8a7a63', fontSize: '14px', margin: 0 }}>Sell repair parts directly — no job required</p>
        </div>
        <button onClick={() => setShowNew(true)}
          style={{ padding: '11px 22px', background: 'linear-gradient(135deg,#f0b23d,#d4881f)', color: '#1c1917', border: 'none', borderRadius: '12px', cursor: 'pointer', fontWeight: '800', fontSize: '14px' }}>
          + New Sale
        </button>
      </div>

      <div style={{ display: 'flex', gap: '6px', marginBottom: '18px' }}>
        {[{ id: 'sales', label: 'Sales' }, { id: 'returns', label: 'Returns' }].map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            style={{ padding: '9px 18px', borderRadius: '10px', border: 'none', background: tab === t.id ? '#1c1917' : '#f5f1ea', color: tab === t.id ? '#f0b23d' : '#78716c', fontWeight: '700', fontSize: '13px', cursor: 'pointer' }}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'returns' ? (
        <RepairSaleReturns shop={shop} />
      ) : loading ? <div style={{ padding: '60px', textAlign: 'center', color: '#a89478' }}>Loading...</div> : (
        <div style={{ background: 'white', borderRadius: '16px', border: '1px solid #f3ede4', overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr style={{ background: '#fdf8f3', borderBottom: '2px solid #f3ede4' }}>
              {['Sale No', 'Customer', 'Date', 'Total', 'Paid', 'Balance', 'Payment', '', ''].map(h => (
                <th key={h} style={{ padding: '10px 14px', textAlign: 'left', fontSize: '10px', fontWeight: '700', color: '#a89478', textTransform: 'uppercase' }}>{h}</th>
              ))}
            </tr></thead>
            <tbody>
              {sales.map((s, i) => (
                <tr key={s.id} style={{ borderBottom: '1px solid #f8f5f0', background: s.status === 'voided' ? '#faf9f7' : i % 2 === 0 ? 'white' : '#fdfbf8', opacity: s.status === 'voided' ? 0.6 : 1 }}>
                  <td onClick={() => setViewingSale(s)} style={{ padding: '11px 14px', fontWeight: '700', color: '#d4881f', cursor: 'pointer' }}>{s.sale_no}</td>
                  <td onClick={() => setViewingSale(s)} style={{ padding: '11px 14px', cursor: 'pointer' }}>{s.repair_customers?.name || s.customer_name || 'Walk-in'}</td>
                  <td onClick={() => setViewingSale(s)} style={{ padding: '11px 14px', fontSize: '12px', color: '#78716c', cursor: 'pointer' }}>{timeAgo(s.created_at)}</td>
                  <td onClick={() => setViewingSale(s)} style={{ padding: '11px 14px', fontWeight: '700', cursor: 'pointer' }}>{formatLKR(s.total)}</td>
                  <td onClick={() => setViewingSale(s)} style={{ padding: '11px 14px', color: '#059669', cursor: 'pointer' }}>{formatLKR(s.amount_paid)}</td>
                  <td onClick={() => setViewingSale(s)} style={{ padding: '11px 14px', fontWeight: '700', color: (s.total - s.amount_paid) > 0 ? '#e11d48' : '#94a3b8', cursor: 'pointer' }}>{formatLKR(s.total - s.amount_paid)}</td>
                  <td onClick={() => setViewingSale(s)} style={{ padding: '11px 14px', fontSize: '12px', textTransform: 'capitalize', cursor: 'pointer' }}>{s.payment_method}</td>
                  <td style={{ padding: '11px 14px' }}>
                    {s.status === 'voided'
                      ? <span style={{ padding: '3px 10px', borderRadius: '8px', fontSize: '11px', fontWeight: '700', background: '#f1f5f9', color: '#64748b' }}>Voided</span>
                      : <span style={{ padding: '3px 10px', borderRadius: '8px', fontSize: '11px', fontWeight: '700', background: '#f0fdf4', color: '#166534' }}>{s.status}</span>}
                  </td>
                  <td style={{ padding: '11px 14px', display: 'flex', gap: '6px' }}>
                    {s.status !== 'voided' && (s.total - s.amount_paid) > 0 && s.customer_id && (
                      <button onClick={() => setPayingSale(s)} style={{ padding: '4px 10px', background: '#f0fdf4', color: '#059669', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '11px', fontWeight: '700' }}>
                        💵 Pay
                      </button>
                    )}
                    {s.status !== 'voided' && (
                      <>
                        <button onClick={() => reprintReceipt(s)} style={{ padding: '4px 10px', background: '#fef3e2', color: '#d4881f', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '11px', fontWeight: '700' }}>
                          🖨 Print
                        </button>
                        <button onClick={() => setVoidingSale(s)} style={{ padding: '4px 10px', background: '#fef2f2', color: '#e11d48', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '11px', fontWeight: '700' }}>
                          Void
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {sales.length === 0 && <div style={{ padding: '48px', textAlign: 'center', color: '#a89478' }}>No sales yet.</div>}
        </div>
      )}

      {showNew && <NewSaleModal shop={shop} onClose={() => setShowNew(false)} onCreated={() => { setShowNew(false); fetchSales() }} />}
      {payingSale && <SalePaymentModal shop={shop} sale={payingSale} onClose={() => setPayingSale(null)} onPaid={() => { setPayingSale(null); fetchSales() }} />}
      {voidingSale && <VoidSaleModal shop={shop} sale={voidingSale} onClose={() => setVoidingSale(null)} onVoided={() => { setVoidingSale(null); fetchSales() }} />}
      {viewingSale && <ViewSaleModal sale={viewingSale} onClose={() => setViewingSale(null)} />}
    </div>
  )
}

// Pays down a specific sale's remaining balance — updates the sale's own
// amount_paid (which the customer's Activity Statement already reads live,
// so no separate ledger write is needed there) and the customer's overall
// outstanding_balance, plus records the cash/bank movement.
function SalePaymentModal({ shop, sale, onClose, onPaid }) {
  const [amount, setAmount] = useState('')
  const [method, setMethod] = useState('cash')
  const [bankAccountId, setBankAccountId] = useState('')
  const [bankAccounts, setBankAccounts] = useState([])
  const [saving, setSaving] = useState(false)

  useEffect(() => { supabase.from('bank_accounts').select('*').order('name').then(({ data }) => setBankAccounts(data || [])) }, [])

  const due = (sale.total || 0) - (sale.amount_paid || 0)

  async function handlePay() {
    const enteredAmount = parseFloat(amount)
    if (!enteredAmount || enteredAmount <= 0) return toast.error('Enter a valid amount')
    if ((method === 'card' || method === 'bank') && !bankAccountId) return toast.error('Select a bank account')
    setSaving(true)
    try {
      const newPaid = (sale.amount_paid || 0) + enteredAmount
      const { error } = await supabase.from('repair_sales').update({ amount_paid: newPaid }).eq('id', sale.id)
      if (error) throw error

      // Must not proceed to the balance/cash effects below if this log entry
      // failed to save — this is exactly what a future void relies on to
      // reverse the payment precisely. A payment silently missing its own log
      // row is the exact gap that caused a real voided sale's cash entry to
      // never get reversed.
      const { error: payLogError } = await supabase.from('repair_sale_payments').insert({
        sale_id: sale.id, amount: enteredAmount, payment_method: method,
        bank_account_id: (method === 'card' || method === 'bank') ? bankAccountId : null,
      })
      if (payLogError) throw payLogError

      // Must not adjust the customer's balance if the sale itself failed to
      // update — same reasoning as everywhere else in this app: never let a
      // balance move without a record that explains it.
      await supabase.rpc('repair_adjust_customer_balance', { p_customer_id: sale.customer_id, p_delta: -enteredAmount })

      if (method === 'cash') {
        await supabase.from('repair_cash_ledger').insert({ shop_id: shop?.id || null, type: 'sale', amount: enteredAmount, reference: sale.sale_no, notes: 'Parts sale payment received' })
      } else {
        const bank = bankAccounts.find(b => b.id === bankAccountId)
        await supabase.from('bank_accounts').update({ balance: (bank?.balance || 0) + enteredAmount }).eq('id', bankAccountId)
        await supabase.from('bank_transactions').insert({ bank_account_id: bankAccountId, type: 'deposit', amount: enteredAmount, reference: `Parts sale payment: ${sale.sale_no}`, notes: `${method} payment` })
      }

      toast.success(`${formatLKR(enteredAmount)} received for ${sale.sale_no}`)
      onPaid()
    } catch (e) { toast.error('Failed: ' + e.message) }
    setSaving(false)
  }

  const inp = { width: '100%', padding: '9px 12px', border: '1.5px solid #e7dfd3', borderRadius: '8px', fontSize: '13px', boxSizing: 'border-box' }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(28,25,23,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1100, padding: '20px' }}>
      <div style={{ background: 'white', borderRadius: '18px', padding: '24px', width: '100%', maxWidth: '380px' }}>
        <h3 style={{ fontSize: '16px', fontWeight: '800', margin: '0 0 4px', color: '#1c1917' }}>Pay — {sale.sale_no}</h3>
        <p style={{ fontSize: '12px', color: '#8a7a63', margin: '0 0 16px' }}>Balance due: {formatLKR(due)}</p>

        <div style={{ marginBottom: '10px' }}><label style={{ fontSize: '11px', fontWeight: '700', color: '#a89478' }}>Amount</label><input type="number" style={inp} value={amount} onChange={e => setAmount(e.target.value)} placeholder={String(due)} autoFocus /></div>
        <div style={{ marginBottom: '10px' }}>
          <label style={{ fontSize: '11px', fontWeight: '700', color: '#a89478' }}>Method</label>
          <select style={inp} value={method} onChange={e => setMethod(e.target.value)}>
            <option value="cash">Cash</option><option value="card">Card</option><option value="bank">Bank Transfer</option>
          </select>
        </div>
        {(method === 'card' || method === 'bank') && (
          <div style={{ marginBottom: '16px' }}>
            <label style={{ fontSize: '11px', fontWeight: '700', color: '#a89478' }}>Bank Account</label>
            <select style={inp} value={bankAccountId} onChange={e => setBankAccountId(e.target.value)}>
              <option value="">Select...</option>
              {bankAccounts.map(b => <option key={b.id} value={b.id}>{b.name}{b.bank_name ? ` — ${b.bank_name}` : ''}</option>)}
            </select>
          </div>
        )}
        <div style={{ display: 'flex', gap: '10px' }}>
          <button onClick={onClose} style={{ flex: 1, padding: '10px', background: '#f5f1ea', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: '700' }}>Cancel</button>
          <button onClick={handlePay} disabled={saving} style={{ flex: 1, padding: '10px', background: 'linear-gradient(135deg,#f0b23d,#d4881f)', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: '800' }}>{saving ? 'Saving...' : 'Receive Payment'}</button>
        </div>
      </div>
    </div>
  )
}

// Voiding a sale means it should never have happened — undo it precisely via
// compensating entries (never delete/rewrite the original history), mirroring
// exactly how Void Job already works: restock every item, reverse every
// payment individually by its own actual method/account (via
// repair_sale_payments, so a sale paid partly in cash and partly by bank
// transfer later reverses each correctly), reverse any linked 3rd-party
// items, and undo the remaining credit balance this sale is still carrying.
function VoidSaleModal({ shop, sale, onClose, onVoided }) {
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)
  const [blockingReturns, setBlockingReturns] = useState(null)
  const [blockedBySettlement, setBlockedBySettlement] = useState(false)
  const [preview, setPreview] = useState(null)

  useEffect(() => {
    async function load() {
      const { data: activeReturns } = await supabase.from('repair_sale_returns').select('return_no').eq('sale_id', sale.id).neq('status', 'voided')
      if (activeReturns?.length) { setBlockingReturns(activeReturns); return }
      const [{ data: items }, { data: tpItems }, { data: payments }] = await Promise.all([
        supabase.from('repair_sale_items').select('*').eq('sale_id', sale.id),
        supabase.from('repair_third_party_items').select('*').eq('sale_id', sale.id),
        supabase.from('repair_sale_payments').select('*').eq('sale_id', sale.id),
      ])
      // A settlement payment (from Combined Accounts) isn't real cash/bank
      // movement — it's a balance offset against a linked supplier. The
      // normal payment reversal below assumes every payment is real
      // cash/bank, so reversing a settlement that way would create a phantom
      // cash entry. Safer to block and require it be undone manually first.
      if ((payments || []).some(p => p.payment_method === 'settlement')) { setBlockedBySettlement(true); return }
      setPreview({ items: items || [], tpItems: tpItems || [], payments: payments || [] })
    }
    load()
  }, [sale.id])

  async function handleVoid() {
    setSaving(true)
    try {
      const { items, tpItems, payments } = preview

      const restoredSoFar = []
      try {
        for (const it of items) {
          const { error: returnError } = await supabase.rpc('repair_fifo_return', { p_part_id: it.part_id, p_quantity: it.quantity, p_unit_cost: it.unit_cost || 0 })
          if (returnError) throw new Error(returnError.message)
          const { error: addError } = await supabase.rpc('repair_add_part_stock', { p_part_id: it.part_id, p_quantity: it.quantity })
          if (addError) throw new Error(addError.message)
          restoredSoFar.push({ part_id: it.part_id, quantity: it.quantity })
        }
      } catch (stockErr) {
        for (const c of restoredSoFar.reverse()) {
          await supabase.rpc('repair_fifo_consume', { p_part_id: c.part_id, p_quantity: c.quantity })
          await supabase.rpc('repair_deduct_part_stock', { p_part_id: c.part_id, p_quantity: c.quantity })
        }
        throw stockErr
      }
      await supabase.from('repair_sale_items').delete().eq('sale_id', sale.id)

      // 3rd-party items: if already settled, the supplier balance is already
      // net-zero (raised at creation, reduced at settlement) — only the
      // money paid out needs reversing. If still pending, the supplier
      // balance was raised at creation and never settled, so that needs
      // reversing directly. Every step here is checked — a void that silently
      // failed partway through but still finished and marked the sale voided
      // would look successful while leaving money or balances unreversed,
      // exactly the class of bug this whole void feature exists to prevent.
      for (const t of tpItems) {
        const amount = (t.cost_price || 0) * t.quantity
        if (t.payment_status === 'paid' && amount > 0.009) {
          if (t.payment_method === 'cash') {
            const { error: cashErr } = await supabase.from('repair_cash_ledger').insert({ shop_id: shop?.id || null, type: 'payment', amount, reference: sale.sale_no, notes: `Sale voided — 3rd-party item reversed: ${t.item_name}` })
            if (cashErr) throw cashErr
          } else if (t.bank_transaction_id) {
            const { data: origTx } = await supabase.from('bank_transactions').select('bank_account_id').eq('id', t.bank_transaction_id).single()
            if (origTx?.bank_account_id) {
              const { data: bank } = await supabase.from('bank_accounts').select('balance').eq('id', origTx.bank_account_id).single()
              const { error: bankErr } = await supabase.from('bank_accounts').update({ balance: (bank?.balance || 0) + amount }).eq('id', origTx.bank_account_id)
              if (bankErr) throw bankErr
              const { error: txErr } = await supabase.from('bank_transactions').insert({ bank_account_id: origTx.bank_account_id, type: 'deposit', amount, reference: `Sale voided: ${sale.sale_no}`, notes: `3rd-party item reversed: ${t.item_name}` })
              if (txErr) throw txErr
            }
          }
        } else if (t.supplier_id && amount > 0.009) {
          const { error: supErr } = await supabase.rpc('repair_adjust_supplier_balance', { p_supplier_id: t.supplier_id, p_delta: -amount })
          if (supErr) throw supErr
        }
      }
      await supabase.from('repair_third_party_items').delete().eq('sale_id', sale.id)

      // Every payment this sale ever received, reversed individually by its
      // actual method — bank_account_id set means it really moved through a
      // bank account (SalePaymentModal/ReceivePaymentModal); unset means it
      // only ever went through the cash ledger (including the sale's own
      // creation-time payment, which — regardless of the method label chosen
      // then — was always recorded there, a pre-existing simplification this
      // reversal deliberately matches rather than guesses around).
      for (const p of payments) {
        if (p.bank_account_id) {
          const { data: bank } = await supabase.from('bank_accounts').select('balance').eq('id', p.bank_account_id).single()
          const { error: bankErr } = await supabase.from('bank_accounts').update({ balance: (bank?.balance || 0) - p.amount }).eq('id', p.bank_account_id)
          if (bankErr) throw bankErr
          const { error: txErr } = await supabase.from('bank_transactions').insert({ bank_account_id: p.bank_account_id, type: 'withdrawal', amount: p.amount, reference: `Sale voided: ${sale.sale_no}`, notes: `Payment reversed (${p.payment_method})` })
          if (txErr) throw txErr
        } else {
          const { error: cashErr } = await supabase.from('repair_cash_ledger').insert({ shop_id: shop?.id || null, type: 'sale', amount: -p.amount, reference: sale.sale_no, notes: 'Sale voided — payment reversed' })
          if (cashErr) throw cashErr
        }
      }
      await supabase.from('repair_sale_payments').delete().eq('sale_id', sale.id)

      // Whatever's still unpaid on this sale is currently reflected as debt
      // in the customer's balance (added at creation for a credit sale, then
      // reduced by each payment above as it came in) — remove exactly that
      // remainder. The payments above already reversed their own portion via
      // cash/bank; this is the separate balance dimension, not double-counted.
      const stillDue = (sale.total || 0) - (sale.amount_paid || 0)
      if (sale.customer_id && stillDue > 0.009) {
        await supabase.rpc('repair_adjust_customer_balance', { p_customer_id: sale.customer_id, p_delta: -stillDue })
      }

      await supabase.from('repair_sales').update({
        status: 'voided', subtotal: 0, total: 0, amount_paid: 0,
        voided_at: new Date().toISOString(), void_reason: reason || null,
      }).eq('id', sale.id)

      toast.success('Sale voided — all related transactions reversed')
      onVoided()
    } catch (e) { toast.error('Failed to void: ' + e.message) }
    setSaving(false)
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(28,25,23,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1100, padding: '20px' }}>
      <div style={{ background: 'white', borderRadius: '18px', padding: '24px', width: '100%', maxWidth: '440px' }}>
        <h3 style={{ fontSize: '16px', fontWeight: '800', margin: '0 0 4px', color: '#e11d48' }}>Void Sale {sale.sale_no}?</h3>
        {blockingReturns ? (
          <>
            <p style={{ fontSize: '13px', color: '#44403c', margin: '0 0 16px' }}>
              Can't void — {blockingReturns.length} active return{blockingReturns.length !== 1 ? 's' : ''} ({blockingReturns.map(r => r.return_no).join(', ')}) reference this sale. Void {blockingReturns.length !== 1 ? 'those' : 'that'} first.
            </p>
            <button onClick={onClose} style={{ width: '100%', padding: '10px', background: '#f5f1ea', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: '700' }}>Close</button>
          </>
        ) : blockedBySettlement ? (
          <>
            <p style={{ fontSize: '13px', color: '#44403c', margin: '0 0 16px' }}>
              Can't void — this sale was partly or fully paid via a Combined Accounts settlement, which offsets a linked supplier's balance rather than moving real cash. Reversing that safely needs to be done manually (settle back the other direction in Combined Accounts first), not automatically.
            </p>
            <button onClick={onClose} style={{ width: '100%', padding: '10px', background: '#f5f1ea', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: '700' }}>Close</button>
          </>
        ) : !preview ? (
          <p style={{ fontSize: '13px', color: '#8a7a63' }}>Checking...</p>
        ) : (
          <>
            <p style={{ fontSize: '12px', color: '#8a7a63', margin: '0 0 14px' }}>This cannot be undone. The following will be reversed:</p>
            <ul style={{ fontSize: '13px', color: '#44403c', margin: '0 0 16px', paddingLeft: '18px', lineHeight: '1.7' }}>
              <li>{preview.items.length} part{preview.items.length !== 1 ? 's' : ''} — stock restored</li>
              {preview.tpItems.length > 0 && <li>{preview.tpItems.length} 3rd-party item{preview.tpItems.length !== 1 ? 's' : ''}</li>}
              <li>{preview.payments.length} payment{preview.payments.length !== 1 ? 's' : ''} — {formatLKR(preview.payments.reduce((s, p) => s + p.amount, 0))} reversed</li>
            </ul>
            <label style={{ fontSize: '11px', fontWeight: '700', color: '#a89478', textTransform: 'uppercase' }}>Reason (optional)</label>
            <textarea style={{ width: '100%', padding: '9px 12px', border: '1.5px solid #e7dfd3', borderRadius: '8px', fontSize: '13px', boxSizing: 'border-box', minHeight: '60px', marginBottom: '16px', marginTop: '5px' }} value={reason} onChange={e => setReason(e.target.value)} placeholder="e.g. entered in error" />
            <div style={{ display: 'flex', gap: '10px' }}>
              <button onClick={onClose} style={{ flex: 1, padding: '10px', background: '#f5f1ea', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: '700' }}>Cancel</button>
              <button onClick={handleVoid} disabled={saving} style={{ flex: 1, padding: '10px', background: '#e11d48', color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: '800' }}>{saving ? 'Voiding...' : 'Void Sale'}</button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function NewSaleModal({ shop, onClose, onCreated }) {
  const [customerName, setCustomerName] = useState('')
  const [customerSearch, setCustomerSearch] = useState('')
  const [customerResults, setCustomerResults] = useState([])
  const [selectedCustomer, setSelectedCustomer] = useState(null)
  const [showCustomerDrop, setShowCustomerDrop] = useState(false)
  const [showCreateCustomer, setShowCreateCustomer] = useState(false)
  const [newCustomerMobile, setNewCustomerMobile] = useState('')
  const [creatingCustomer, setCreatingCustomer] = useState(false)
  const [parts, setParts] = useState([])
  const [partCosts, setPartCosts] = useState({})
  const [suppliers, setSuppliers] = useState([])
  const [rows, setRows] = useState([{ part_id: '', quantity: '1', unit_price: '', is_third_party: false, item_name: '', supplier_id: '', supplier_other: '', cost_price: '' }])
  const [paymentMethod, setPaymentMethod] = useState('cash')
  const [amountPaid, setAmountPaid] = useState('')
  const [transportFee, setTransportFee] = useState('')
  const [bankAccountId, setBankAccountId] = useState('')
  const [bankAccounts, setBankAccounts] = useState([])
  const [saving, setSaving] = useState(false)

  useEffect(() => { supabase.from('repair_suppliers').select('id, name').order('name').then(({ data }) => setSuppliers(data || [])) }, [])
  useEffect(() => { fetchOldestBatchCosts().then(setPartCosts) }, [])
  useEffect(() => { supabase.from('bank_accounts').select('*').order('name').then(({ data }) => setBankAccounts(data || [])) }, [])

  useEffect(() => {
    // A plain .select() caps at Supabase's default 1000-row limit — with a large
    // enough parts catalog, some parts silently never show up in the picker,
    // with no error to indicate anything was cut off.
    async function fetchAllParts() {
      let all = []
      let from = 0
      const PAGE_SIZE = 1000
      while (true) {
        const { data } = await supabase.from('repair_parts').select('id, name, sku, selling_price, current_stock').order('name').range(from, from + PAGE_SIZE - 1)
        all = all.concat(data || [])
        if (!data || data.length < PAGE_SIZE) break
        from += PAGE_SIZE
      }
      setParts(all)
    }
    fetchAllParts()
  }, [])

  useEffect(() => {
    if (customerSearch.trim().length < 2) { setCustomerResults([]); return }
    const t = setTimeout(() => {
      supabase.from('repair_customers').select('id, name, mobile, outstanding_balance')
        .or(`name.ilike.%${customerSearch}%,mobile.ilike.%${customerSearch}%`).limit(6)
        .then(({ data }) => setCustomerResults(data || []))
    }, 250)
    return () => clearTimeout(t)
  }, [customerSearch])

  const itemsSubtotal = rows.reduce((s, r) => s + (parseFloat(r.quantity) || 0) * (parseFloat(r.unit_price) || 0), 0)
  const total = itemsSubtotal + (parseFloat(transportFee) || 0)
  const paid = paymentMethod === 'credit' ? (parseFloat(amountPaid) || 0) : total
  const balanceDue = Math.max(0, total - paid)

  function updateRow(i, field, val) {
    setRows(rs => rs.map((r, idx) => {
      if (idx !== i) return r
      const next = { ...r, [field]: val }
      if (field === 'part_id') {
        const p = parts.find(pp => pp.id === val)
        if (p) next.unit_price = String(p.selling_price || '')
      }
      return next
    }))
  }
  function toggleThirdParty(i) {
    setRows(rs => rs.map((r, idx) => idx !== i ? r : {
      ...r, is_third_party: !r.is_third_party, part_id: '', unit_price: '',
    }))
  }
  function addRow() { setRows(rs => [...rs, { part_id: '', quantity: '1', unit_price: '', is_third_party: false, item_name: '', supplier_id: '', supplier_other: '', cost_price: '' }]) }
  function removeRow(i) { setRows(rs => rs.filter((_, idx) => idx !== i)) }

  async function handleCreateCustomer() {
    if (!customerSearch.trim()) return toast.error('Enter a customer name')
    if (!newCustomerMobile.trim()) return toast.error('Mobile number is required')
    setCreatingCustomer(true)
    try {
      const customer_no = await generateRepairCustomerNo()
      const { data: cust, error } = await supabase.from('repair_customers').insert({
        customer_no, name: customerSearch.trim(), mobile: newCustomerMobile.trim(),
      }).select('id, name, mobile, outstanding_balance').single()
      if (error) throw error
      setSelectedCustomer(cust)
      setShowCreateCustomer(false)
      setShowCustomerDrop(false)
      toast.success('Customer created')
    } catch (e) { toast.error('Failed: ' + e.message) }
    setCreatingCustomer(false)
  }

  async function handleSave() {
    const validRows = rows.filter(r => r.is_third_party ? (r.item_name.trim() && parseFloat(r.quantity) > 0) : (r.part_id && parseFloat(r.quantity) > 0))
    if (validRows.length === 0) return toast.error('Add at least one item')
    for (const r of validRows) {
      if (r.is_third_party) continue
      const part = parts.find(p => p.id === r.part_id)
      if (part && parseFloat(r.quantity) > (part.current_stock || 0)) return toast.error(`Only ${part.current_stock || 0} of "${part.name}" in stock`)
    }
    if (validRows.some(r => !(parseFloat(r.unit_price) > 0))) return toast.error('Enter a selling price for every item')
    if (paymentMethod === 'credit' && !selectedCustomer) return toast.error('Select a customer for a credit sale')
    if ((paymentMethod === 'card' || paymentMethod === 'bank_transfer') && !bankAccountId) return toast.error('Select a bank account')
    setSaving(true)
    try {
      const sale_no = await generateRepairSaleNo()
      const { data: sale, error } = await supabase.from('repair_sales').insert({
        sale_no, shop_id: shop?.id || null,
        customer_id: selectedCustomer?.id || null,
        customer_name: selectedCustomer?.name || customerName || 'Walk-in',
        subtotal: itemsSubtotal, transport_fee: parseFloat(transportFee) || 0, total,
        payment_method: paymentMethod, amount_paid: paid, status: 'confirmed',
      }).select().single()
      if (error) throw error

      if (paid > 0) {
        // Same reasoning as SalePaymentModal — a silently-failed log entry
        // here is invisible until someone tries to void this sale later and
        // finds nothing to reverse, exactly what happened to a real sale
        // before this check existed.
        const { error: payLogError } = await supabase.from('repair_sale_payments').insert({
          sale_id: sale.id, amount: paid, payment_method: paymentMethod,
          bank_account_id: (paymentMethod === 'card' || paymentMethod === 'bank_transfer') ? bankAccountId : null,
          notes: 'Paid at sale',
        })
        if (payLogError) throw payLogError
      }

      for (const r of validRows) {
        const qty = parseFloat(r.quantity), price = parseFloat(r.unit_price) || 0
        if (r.is_third_party) {
          // Same table and workflow as a job's 3rd-party items — settlement,
          // supplier balance, and the supplier's Activity Statement all already
          // handle this table regardless of whether job_id or sale_id is set.
          const linkedSupplier = suppliers.find(s => s.id === r.supplier_id)
          const supplierName = linkedSupplier ? linkedSupplier.name : (r.supplier_other || null)
          const cost = parseFloat(r.cost_price) || 0
          const { error: tpError } = await supabase.from('repair_third_party_items').insert({
            shop_id: shop?.id || null, sale_id: sale.id, item_name: r.item_name.trim(),
            part_id: r.part_id || null,
            supplier_id: linkedSupplier?.id || null, supplier_name: supplierName,
            quantity: qty, selling_price: price, cost_price: cost,
            payment_status: 'pending',
          })
          // Must not adjust the supplier's balance if the item record itself
          // failed to save — that leaves the balance changed with nothing on
          // record to explain it, which is worse than the sale failing outright.
          if (tpError) throw new Error(`Failed to save 3rd-party item "${r.item_name}": ${tpError.message}`)
          if (linkedSupplier && cost > 0) {
            await supabase.rpc('repair_adjust_supplier_balance', { p_supplier_id: linkedSupplier.id, p_delta: cost * qty })
          }
        } else {
          const { data: unitCost } = await supabase.rpc('repair_fifo_consume', { p_part_id: r.part_id, p_quantity: qty })
          await supabase.from('repair_sale_items').insert({ sale_id: sale.id, part_id: r.part_id, quantity: qty, unit_price: price, unit_cost: unitCost || 0, line_total: qty * price })
          await supabase.rpc('repair_deduct_part_stock', { p_part_id: r.part_id, p_quantity: qty })
        }
      }

      // Cash ledger reflects actual cash received; card/bank transfer route
      // through a real bank account instead — this used to only handle cash,
      // silently recording no financial movement at all for the other two
      // methods even though the sale itself showed as paid.
      if (paymentMethod === 'cash' && paid > 0) {
        await supabase.from('repair_cash_ledger').insert({ shop_id: shop?.id || null, type: 'sale', amount: paid, reference: sale_no, notes: 'Parts sale' })
      } else if ((paymentMethod === 'card' || paymentMethod === 'bank_transfer') && paid > 0) {
        const bank = bankAccounts.find(b => b.id === bankAccountId)
        const { error: bankErr } = await supabase.from('bank_accounts').update({ balance: (bank?.balance || 0) + paid }).eq('id', bankAccountId)
        if (bankErr) throw bankErr
        const { error: txErr } = await supabase.from('bank_transactions').insert({ bank_account_id: bankAccountId, type: 'deposit', amount: paid, reference: `Parts sale: ${sale_no}`, notes: `${paymentMethod} payment` })
        if (txErr) throw txErr
      }
      // Credit sale — add the unpaid balance to the customer's outstanding balance
      if (paymentMethod === 'credit' && balanceDue > 0) {
        await supabase.rpc('repair_adjust_customer_balance', { p_customer_id: selectedCustomer.id, p_delta: balanceDue })
      }

      toast.success(`Sale ${sale_no} recorded!`)
      if (window.confirm('Sale recorded! Print a receipt?')) {
        const receiptItems = validRows.map(r => ({
          repair_parts: { name: r.is_third_party ? r.item_name.trim() : (parts.find(p => p.id === r.part_id)?.name || '') },
          quantity: parseFloat(r.quantity), unit_price: parseFloat(r.unit_price) || 0,
          line_total: (parseFloat(r.quantity) || 0) * (parseFloat(r.unit_price) || 0),
        }))
        printPartsSaleReceipt(sale, receiptItems, selectedCustomer?.name || customerName)
      }
      onCreated()
    } catch (e) { toast.error('Failed: ' + e.message) }
    setSaving(false)
  }

  const inp = { width: '100%', padding: '8px 10px', border: '1.5px solid #e7dfd3', borderRadius: '7px', fontSize: '13px', boxSizing: 'border-box' }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(28,25,23,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '20px' }}>
      <div style={{ background: 'white', borderRadius: '20px', padding: '26px', width: '100%', maxWidth: '580px', maxHeight: '88vh', overflowY: 'auto' }}>
        <h2 style={{ fontSize: '18px', fontWeight: '800', color: '#1c1917', margin: '0 0 16px' }}>New Parts Sale</h2>

        <div style={{ marginBottom: '14px', position: 'relative' }}>
          <label style={{ fontSize: '11px', fontWeight: '700', color: '#a89478', textTransform: 'uppercase' }}>Customer {paymentMethod === 'credit' && '(required for credit)'}</label>
          {selectedCustomer ? (
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 12px', background: '#fef3e2', borderRadius: '8px', marginTop: '4px' }}>
              <div>
                <div style={{ fontSize: '13px', fontWeight: '700', color: '#1c1917' }}>{selectedCustomer.name}</div>
                <div style={{ fontSize: '11px', color: '#8a7a63' }}>{selectedCustomer.mobile} · Balance: {formatLKR(selectedCustomer.outstanding_balance || 0)}</div>
              </div>
              <button onClick={() => { setSelectedCustomer(null); setCustomerSearch('') }} style={{ background: 'none', border: 'none', color: '#e11d48', cursor: 'pointer', fontSize: '13px' }}>✕</button>
            </div>
          ) : (
            <>
              <input style={inp} placeholder="Search by name or mobile, or leave blank for walk-in" value={customerSearch}
                onChange={e => { setCustomerSearch(e.target.value); setCustomerName(e.target.value); setShowCustomerDrop(true); setShowCreateCustomer(false) }}
                onFocus={() => setShowCustomerDrop(true)} />
              {showCustomerDrop && customerSearch.trim().length >= 2 && (
                <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: 'white', border: '1.5px solid #e7dfd3', borderRadius: '8px', marginTop: '2px', zIndex: 10, boxShadow: '0 8px 20px rgba(0,0,0,0.1)' }}>
                  {customerResults.map(c => (
                    <div key={c.id} onClick={() => { setSelectedCustomer(c); setShowCustomerDrop(false) }}
                      style={{ padding: '8px 12px', cursor: 'pointer', borderBottom: '1px solid #f8f5f0', fontSize: '13px' }}
                      onMouseEnter={e => e.currentTarget.style.background = '#fdf8f3'} onMouseLeave={e => e.currentTarget.style.background = 'white'}>
                      <div style={{ fontWeight: '700' }}>{c.name}</div>
                      <div style={{ fontSize: '11px', color: '#8a7a63' }}>{c.mobile}</div>
                    </div>
                  ))}
                  <div onClick={() => { setShowCreateCustomer(true); setShowCustomerDrop(false) }}
                    style={{ padding: '8px 12px', cursor: 'pointer', fontSize: '13px', color: '#d4881f', fontWeight: '700' }}
                    onMouseEnter={e => e.currentTarget.style.background = '#fdf8f3'} onMouseLeave={e => e.currentTarget.style.background = 'white'}>
                    + Create new customer "{customerSearch}"
                  </div>
                </div>
              )}
              {showCreateCustomer && (
                <div style={{ marginTop: '8px', padding: '12px', background: '#fdf8f3', border: '1.5px solid #e7dfd3', borderRadius: '8px' }}>
                  <div style={{ fontSize: '12px', fontWeight: '700', color: '#1c1917', marginBottom: '8px' }}>New customer: {customerSearch}</div>
                  <input style={inp} placeholder="Mobile number *" value={newCustomerMobile} onChange={e => setNewCustomerMobile(e.target.value)} />
                  <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
                    <button onClick={() => setShowCreateCustomer(false)} style={{ flex: 1, padding: '7px', background: 'white', border: '1px solid #e7dfd3', borderRadius: '7px', cursor: 'pointer', fontSize: '12px', fontWeight: '600' }}>Cancel</button>
                    <button onClick={handleCreateCustomer} disabled={creatingCustomer} style={{ flex: 1, padding: '7px', background: '#d4881f', color: 'white', border: 'none', borderRadius: '7px', cursor: 'pointer', fontSize: '12px', fontWeight: '700' }}>{creatingCustomer ? 'Creating...' : 'Create'}</button>
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        <label style={{ fontSize: '11px', fontWeight: '700', color: '#a89478', textTransform: 'uppercase' }}>Parts</label>
        <div style={{ display: 'grid', gridTemplateColumns: '2fr 0.7fr 1fr auto', gap: '8px', marginTop: '8px', marginBottom: '2px' }}>
          <span style={{ fontSize: '10px', fontWeight: '700', color: '#a89478', textTransform: 'uppercase' }}>Part</span>
          <span style={{ fontSize: '10px', fontWeight: '700', color: '#a89478', textTransform: 'uppercase' }}>Qty</span>
          <span style={{ fontSize: '10px', fontWeight: '700', color: '#a89478', textTransform: 'uppercase' }}>Price</span>
          <span></span>
        </div>
        {rows.map((r, i) => (
          <div key={i} style={{ border: r.is_third_party ? '1.5px dashed #e7dfd3' : 'none', borderRadius: '8px', padding: r.is_third_party ? '8px' : 0, marginBottom: '8px', marginTop: '6px' }}>
            {r.is_third_party ? (
              <>
                <div style={{ display: 'grid', gridTemplateColumns: '2fr 0.7fr 1fr auto', gap: '8px', marginBottom: '6px' }}>
                  <PartNameAutocomplete parts={parts} value={r.item_name}
                    onChangeText={val => setRows(rs => rs.map((row, idx) => idx !== i ? row : { ...row, item_name: val, part_id: '' }))}
                    onSelectPart={p => {
                      setRows(rs => rs.map((row, idx) => idx !== i ? row : { ...row, item_name: p.name, part_id: p.id }))
                    }} />
                  <input type="number" style={inp} placeholder="Qty" value={r.quantity} onChange={e => updateRow(i, 'quantity', e.target.value)} />
                  <input type="number" style={inp} placeholder="Sell Price" value={r.unit_price} onChange={e => updateRow(i, 'unit_price', e.target.value)} />
                  <button onClick={() => removeRow(i)} style={{ background: '#fee2e2', border: 'none', borderRadius: '7px', color: '#e11d48', cursor: 'pointer', padding: '0 10px' }}>✕</button>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginBottom: '4px' }}>
                  <select style={inp} value={r.supplier_id} onChange={e => updateRow(i, 'supplier_id', e.target.value)}>
                    <option value="">— Supplier: none / not tracked —</option>
                    {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                    <option value="__other__">Other (type below)</option>
                  </select>
                  <input type="number" style={inp} placeholder="Cost price" value={r.cost_price} onChange={e => updateRow(i, 'cost_price', e.target.value)} />
                </div>
                {r.supplier_id === '__other__' && (
                  <input style={inp} placeholder="Supplier name" value={r.supplier_other} onChange={e => updateRow(i, 'supplier_other', e.target.value)} />
                )}
                <label style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '6px', fontSize: '11px', color: '#8a7a63', cursor: 'pointer' }}>
                  <input type="checkbox" checked={r.is_third_party} onChange={() => toggleThirdParty(i)} /> 3rd-party item (not from inventory)
                </label>
              </>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: '2fr 0.7fr 1fr auto', gap: '8px' }}>
                <PartPicker shop={shop} parts={parts} partCosts={partCosts} value={r.part_id}
                  onChange={(id, p) => {
                    setRows(rs => rs.map((row, idx) => idx !== i ? row : { ...row, part_id: id, unit_price: p ? String(p.selling_price || '') : '' }))
                    if (p && !parts.some(pp => pp.id === p.id)) setParts(ps => [...ps, p])
                  }} />
                <input type="number" style={inp} placeholder="Qty" value={r.quantity} onChange={e => updateRow(i, 'quantity', e.target.value)} />
                <input type="number" style={inp} placeholder="Price" value={r.unit_price} onChange={e => updateRow(i, 'unit_price', e.target.value)} />
                <button onClick={() => removeRow(i)} style={{ background: '#fee2e2', border: 'none', borderRadius: '7px', color: '#e11d48', cursor: 'pointer', padding: '0 10px' }}>✕</button>
              </div>
            )}
            {!r.is_third_party && (
              <label style={{ display: 'flex', alignItems: 'center', gap: '6px', marginTop: '4px', fontSize: '11px', color: '#8a7a63', cursor: 'pointer' }}>
                <input type="checkbox" checked={r.is_third_party} onChange={() => toggleThirdParty(i)} /> 3rd-party item (not from inventory)
              </label>
            )}
          </div>
        ))}
        <button onClick={addRow} style={{ marginBottom: '16px', padding: '6px 14px', background: '#fef3e2', color: '#d4881f', border: 'none', borderRadius: '7px', cursor: 'pointer', fontSize: '12px', fontWeight: '700' }}>+ Add Row</button>

        <div style={{ marginBottom: '16px' }}>
          <label style={{ fontSize: '11px', fontWeight: '700', color: '#a89478', textTransform: 'uppercase' }}>Transport Fee (optional)</label>
          <input type="number" style={inp} placeholder="0" value={transportFee} onChange={e => setTransportFee(e.target.value)} />
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: paymentMethod === 'credit' ? '1fr 1fr' : '1fr', gap: '10px', marginBottom: '16px' }}>
          <div>
            <label style={{ fontSize: '11px', fontWeight: '700', color: '#a89478', textTransform: 'uppercase' }}>Payment Method</label>
            <select style={inp} value={paymentMethod} onChange={e => setPaymentMethod(e.target.value)}>
              <option value="cash">Cash</option><option value="card">Card</option><option value="bank_transfer">Bank Transfer</option><option value="credit">Credit</option>
            </select>
          </div>
          {paymentMethod === 'credit' && (
            <div>
              <label style={{ fontSize: '11px', fontWeight: '700', color: '#a89478', textTransform: 'uppercase' }}>Amount Paid Now</label>
              <input type="number" style={inp} placeholder="0 if fully on credit" value={amountPaid} onChange={e => setAmountPaid(e.target.value)} />
            </div>
          )}
        </div>

        {(paymentMethod === 'card' || paymentMethod === 'bank_transfer') && (
          <div style={{ marginBottom: '16px' }}>
            <label style={{ fontSize: '11px', fontWeight: '700', color: '#a89478', textTransform: 'uppercase' }}>Bank Account</label>
            <select style={inp} value={bankAccountId} onChange={e => setBankAccountId(e.target.value)}>
              <option value="">Select...</option>
              {bankAccounts.map(b => <option key={b.id} value={b.id}>{b.name}{b.bank_name ? ` — ${b.bank_name}` : ''}</option>)}
            </select>
          </div>
        )}

        <div style={{ background: '#fdf8f3', borderRadius: '10px', padding: '14px', marginBottom: '18px' }}>
          {parseFloat(transportFee) > 0 && (
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: '#78716c', marginBottom: '4px' }}>
              <span>Items + Transport Fee</span><span>{formatLKR(itemsSubtotal)} + {formatLKR(parseFloat(transportFee) || 0)}</span>
            </div>
          )}
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '14px', fontWeight: '700', color: '#1c1917', marginBottom: paymentMethod === 'credit' ? '4px' : 0 }}>
            <span>Total</span><span>{formatLKR(total)}</span>
          </div>
          {paymentMethod === 'credit' && (
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', color: '#e11d48', fontWeight: '700' }}>
              <span>Credit Due</span><span>{formatLKR(balanceDue)}</span>
            </div>
          )}
        </div>

        <div style={{ display: 'flex', gap: '10px' }}>
          <button onClick={onClose} style={{ flex: 1, padding: '11px', background: '#f5f1ea', border: 'none', borderRadius: '10px', cursor: 'pointer', fontWeight: '700', color: '#78716c' }}>Cancel</button>
          <button onClick={handleSave} disabled={saving} style={{ flex: 2, padding: '11px', background: 'linear-gradient(135deg,#f0b23d,#d4881f)', border: 'none', borderRadius: '10px', cursor: 'pointer', fontWeight: '800', color: '#1c1917' }}>{saving ? 'Saving...' : '✓ Complete Sale'}</button>
        </div>
      </div>
    </div>
  )
}

// Read-only invoice detail — reused from the Customers page too, so a sale
// clicked from either the Parts Sales list or a customer's Activity
// Statement shows the exact same thing.
export function ViewSaleModal({ sale, onClose }) {
  const [items, setItems] = useState(null)
  const [tpItems, setTpItems] = useState([])

  useEffect(() => {
    async function load() {
      const [{ data: si }, { data: tp }] = await Promise.all([
        supabase.from('repair_sale_items').select('*, repair_parts(name, sku)').eq('sale_id', sale.id),
        supabase.from('repair_third_party_items').select('*').eq('sale_id', sale.id),
      ])
      setItems(si || [])
      setTpItems(tp || [])
    }
    load()
  }, [sale.id])

  const balanceDue = Math.max(0, (sale.total || 0) - (sale.amount_paid || 0))

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(28,25,23,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '20px' }}>
      <div onClick={e => e.stopPropagation()} style={{ background: 'white', borderRadius: '18px', padding: '26px', width: '100%', maxWidth: '480px', maxHeight: '85vh', overflowY: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
          <h3 style={{ fontSize: '17px', fontWeight: '800', margin: 0, color: '#d4881f' }}>{sale.sale_no}</h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: '18px', cursor: 'pointer', color: '#a89478' }}>✕</button>
        </div>
        <p style={{ fontSize: '13px', color: '#8a7a63', margin: '0 0 4px' }}>
          {sale.repair_customers?.name || sale.customer_name || 'Walk-in'} · {timeAgo(sale.created_at)}
        </p>
        <p style={{ fontSize: '12px', color: '#a89478', margin: '0 0 16px', textTransform: 'capitalize' }}>
          {sale.payment_method}{sale.status === 'voided' ? ' · Voided' : ''}
        </p>

        {items === null ? (
          <div style={{ padding: '20px', textAlign: 'center', color: '#a89478', fontSize: '13px' }}>Loading...</div>
        ) : (
          <>
            <div style={{ borderTop: '1px solid #f3ede4', borderBottom: '1px solid #f3ede4', padding: '8px 0', marginBottom: '10px' }}>
              {items.map(it => (
                <div key={it.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', fontSize: '13px' }}>
                  <span>{it.repair_parts?.name || 'Part'} × {it.quantity} @ {formatLKR(it.unit_price)}</span>
                  <span style={{ fontWeight: '700' }}>{formatLKR(it.line_total)}</span>
                </div>
              ))}
              {tpItems.map(t => (
                <div key={t.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', fontSize: '13px' }}>
                  <span>{t.item_name} × {t.quantity} @ {formatLKR(t.selling_price)} <span style={{ fontSize: '11px', color: '#a89478' }}>(3rd-party)</span></span>
                  <span style={{ fontWeight: '700' }}>{formatLKR(t.selling_price * t.quantity)}</span>
                </div>
              ))}
              {items.length === 0 && tpItems.length === 0 && (
                <div style={{ fontSize: '12px', color: '#a89478', padding: '6px 0' }}>No items on record.</div>
              )}
            </div>
            {sale.transport_fee > 0 && (
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', color: '#78716c', marginBottom: '6px' }}>
                <span>Transport Fee</span><span>{formatLKR(sale.transport_fee)}</span>
              </div>
            )}
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '15px', fontWeight: '800', marginBottom: '4px' }}>
              <span>Total</span><span>{formatLKR(sale.total)}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', color: '#059669', marginBottom: '4px' }}>
              <span>Paid</span><span>{formatLKR(sale.amount_paid)}</span>
            </div>
            {balanceDue > 0 && (
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', fontWeight: '700', color: '#e11d48' }}>
                <span>Balance Due</span><span>{formatLKR(balanceDue)}</span>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
