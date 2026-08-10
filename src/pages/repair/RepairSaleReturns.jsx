import { useState, useEffect } from 'react'
import { supabase } from '../../supabase'
import toast from 'react-hot-toast'
import { formatLKR, timeAgo } from '../../lib/repairConstants'
import { generateRepairSaleReturnNo } from '../../lib/repairHelpers'
import { PartPicker } from './RepairInventory'

// Customer returns of parts sold — restores stock (a new FIFO batch at the
// original cost, same as the part being "purchased back in"), and — mirroring
// retail SalesReturns.jsx exactly — only reduces what the customer owes for
// CREDIT-method returns. A cash/bank refund means they already paid and are
// just getting their money back; it's a pure money movement that doesn't
// touch their balance, so it's deliberately excluded from their Activity
// Statement too (which is what makes that statement's own running balance
// match the stored outstanding_balance instead of silently drifting from it).
export default function RepairSaleReturns({ shop }) {
  const [returns, setReturns] = useState([])
  const [loading, setLoading] = useState(true)
  const [showNew, setShowNew] = useState(false)
  const [viewing, setViewing] = useState(null)
  const [viewItems, setViewItems] = useState([])
  const [voiding, setVoiding] = useState(null)

  useEffect(() => { fetchAll() }, [shop?.id])

  async function fetchAll() {
    setLoading(true)
    let q = supabase.from('repair_sale_returns').select('*, repair_customers(name, customer_no)').order('created_at', { ascending: false })
    if (shop?.id) q = q.eq('shop_id', shop.id)
    const { data } = await q
    setReturns(data || [])
    setLoading(false)
  }

  async function viewReturn(r) {
    const { data } = await supabase.from('repair_sale_return_items').select('*, repair_parts(name, sku)').eq('return_id', r.id)
    setViewItems(data || [])
    setViewing(r)
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '18px' }}>
        <p style={{ color: '#8a7a63', fontSize: '13px', margin: 0 }}>{returns.length} customer return{returns.length !== 1 ? 's' : ''}</p>
        <button onClick={() => setShowNew(true)}
          style={{ padding: '10px 20px', background: 'linear-gradient(135deg,#f0b23d,#d4881f)', color: '#1c1917', border: 'none', borderRadius: '11px', cursor: 'pointer', fontWeight: '800', fontSize: '13px' }}>
          + New Return
        </button>
      </div>

      {loading ? <div style={{ padding: '60px', textAlign: 'center', color: '#a89478' }}>Loading...</div> : (
        <div style={{ background: 'white', borderRadius: '16px', border: '1px solid #f3ede4', overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr style={{ background: '#fdf8f3', borderBottom: '2px solid #f3ede4' }}>
              {['Return No', 'Customer', 'Date', 'Total', 'Method', 'Status', ''].map(h => (
                <th key={h} style={{ padding: '10px 14px', textAlign: 'left', fontSize: '10px', fontWeight: '700', color: '#a89478', textTransform: 'uppercase' }}>{h}</th>
              ))}
            </tr></thead>
            <tbody>
              {returns.map((r, i) => (
                <tr key={r.id} style={{ borderBottom: '1px solid #f8f5f0', background: r.status === 'voided' ? '#faf9f7' : i % 2 === 0 ? 'white' : '#fdfbf8', opacity: r.status === 'voided' ? 0.6 : 1 }}>
                  <td onClick={() => viewReturn(r)} style={{ padding: '11px 14px', fontWeight: '700', color: '#d4881f', cursor: 'pointer' }}>{r.return_no}</td>
                  <td onClick={() => viewReturn(r)} style={{ padding: '11px 14px', cursor: 'pointer' }}>{r.repair_customers?.name || '—'}</td>
                  <td onClick={() => viewReturn(r)} style={{ padding: '11px 14px', fontSize: '12px', color: '#8a7a63', cursor: 'pointer' }}>{timeAgo(r.created_at)}</td>
                  <td onClick={() => viewReturn(r)} style={{ padding: '11px 14px', fontWeight: '700', color: '#e11d48', cursor: 'pointer' }}>{formatLKR(r.total)}</td>
                  <td onClick={() => viewReturn(r)} style={{ padding: '11px 14px', fontSize: '12px', textTransform: 'capitalize', cursor: 'pointer' }}>{r.payment_method || '—'}</td>
                  <td style={{ padding: '11px 14px' }}>
                    {r.status === 'voided'
                      ? <span style={{ padding: '3px 10px', borderRadius: '8px', fontSize: '11px', fontWeight: '700', background: '#f1f5f9', color: '#64748b' }}>Voided</span>
                      : <span style={{ padding: '3px 10px', borderRadius: '8px', fontSize: '11px', fontWeight: '700', background: '#f0fdf4', color: '#166534' }}>Confirmed</span>}
                  </td>
                  <td style={{ padding: '11px 14px' }}>
                    {r.status !== 'voided' && (
                      <button onClick={() => setVoiding(r)} style={{ padding: '4px 10px', background: '#fef2f2', color: '#e11d48', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '11px', fontWeight: '700' }}>
                        Void
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {returns.length === 0 && <div style={{ padding: '48px', textAlign: 'center', color: '#a89478' }}>No sale returns yet.</div>}
        </div>
      )}

      {showNew && <NewSaleReturnModal shop={shop} onClose={() => setShowNew(false)} onSaved={() => { setShowNew(false); fetchAll() }} />}
      {voiding && <VoidSaleReturnModal shop={shop} ret={voiding} onClose={() => setVoiding(null)} onVoided={() => { setVoiding(null); fetchAll() }} />}

      {viewing && (
        <div onClick={() => setViewing(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(28,25,23,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '20px' }}>
          <div onClick={e => e.stopPropagation()} style={{ background: 'white', borderRadius: '18px', padding: '28px', width: '100%', maxWidth: '500px', maxHeight: '85vh', overflowY: 'auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
              <h3 style={{ fontSize: '17px', fontWeight: '800', margin: 0 }}>{viewing.return_no}</h3>
              <button onClick={() => setViewing(null)} style={{ background: 'none', border: 'none', fontSize: '18px', cursor: 'pointer', color: '#a89478' }}>✕</button>
            </div>
            <p style={{ fontSize: '13px', color: '#8a7a63', margin: '0 0 4px' }}>Customer: {viewing.repair_customers?.name || '—'}</p>
            <p style={{ fontSize: '13px', color: '#8a7a63', margin: '0 0 16px' }}>{timeAgo(viewing.created_at)} · {viewing.payment_method}</p>
            {viewing.remarks && <div style={{ background: '#fdf8f3', borderRadius: '8px', padding: '10px 12px', marginBottom: '14px', fontSize: '13px', color: '#57534e' }}>{viewing.remarks}</div>}
            {viewItems.map(it => (
              <div key={it.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid #f8f5f0', fontSize: '13px' }}>
                <span>{it.repair_parts?.name || 'Part'} × {it.quantity}</span>
                <span style={{ fontWeight: '700' }}>{formatLKR(it.line_total)}</span>
              </div>
            ))}
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '12px', fontWeight: '800', fontSize: '15px' }}>
              <span>Total Refund</span><span style={{ color: '#e11d48' }}>{formatLKR(viewing.total)}</span>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function NewSaleReturnModal({ shop, onClose, onSaved }) {
  const [customerSearch, setCustomerSearch] = useState('')
  const [showCustomerDrop, setShowCustomerDrop] = useState(false)
  const [customerResults, setCustomerResults] = useState([])
  const [selectedCustomer, setSelectedCustomer] = useState(null)
  const [parts, setParts] = useState([])
  const [rows, setRows] = useState([{ part_id: '', quantity: '1', unit_price: '', unit_cost: '' }])
  const [paymentMethod, setPaymentMethod] = useState('credit')
  const [bankAccountId, setBankAccountId] = useState('')
  const [bankAccounts, setBankAccounts] = useState([])
  const [remarks, setRemarks] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    async function fetchAllParts() {
      let all = [], from = 0
      while (true) {
        const { data } = await supabase.from('repair_parts').select('*').order('name').range(from, from + 999)
        all = all.concat(data || [])
        if (!data || data.length < 1000) break
        from += 1000
      }
      setParts(all)
    }
    fetchAllParts()
    supabase.from('bank_accounts').select('*').order('name').then(({ data }) => setBankAccounts(data || []))
  }, [])

  useEffect(() => {
    if (customerSearch.trim().length < 2 || selectedCustomer) { setCustomerResults([]); return }
    supabase.from('repair_customers').select('id, name, mobile, outstanding_balance')
      .or(`name.ilike.%${customerSearch}%,mobile.ilike.%${customerSearch}%`).limit(10)
      .then(({ data }) => setCustomerResults(data || []))
  }, [customerSearch, selectedCustomer])

  function updateRow(i, field, val) {
    setRows(rs => rs.map((r, idx) => {
      if (idx !== i) return r
      const next = { ...r, [field]: val }
      if (field === 'part_id') {
        const p = parts.find(pp => pp.id === val)
        if (p) { next.unit_price = String(p.selling_price || ''); next.unit_cost = String(p.average_cost || p.purchase_price || '') }
      }
      return next
    }))
  }
  function addRow() { setRows(rs => [...rs, { part_id: '', quantity: '1', unit_price: '', unit_cost: '' }]) }
  function removeRow(i) { setRows(rs => rs.filter((_, idx) => idx !== i)) }

  const validRows = rows.filter(r => r.part_id && parseFloat(r.quantity) > 0)
  const total = validRows.reduce((s, r) => s + (parseFloat(r.quantity) || 0) * (parseFloat(r.unit_price) || 0), 0)

  async function handleSave() {
    if (!selectedCustomer) return toast.error('Select a customer')
    if (validRows.length === 0) return toast.error('Add at least one item')
    if (!remarks.trim()) return toast.error('A reason for the return is required')
    if (validRows.some(r => !(parseFloat(r.unit_price) > 0))) return toast.error('Enter a refund price for every item')
    if (paymentMethod === 'bank' && !bankAccountId) return toast.error('Select a bank account')

    setSaving(true)
    let returnId = null
    try {
      const return_no = await generateRepairSaleReturnNo()
      const { data: ret, error } = await supabase.from('repair_sale_returns').insert({
        return_no, customer_id: selectedCustomer.id, shop_id: shop?.id || null,
        payment_method: paymentMethod, bank_account_id: paymentMethod === 'bank' ? bankAccountId : null,
        subtotal: total, total, remarks: remarks.trim(),
      }).select().single()
      if (error) throw error
      returnId = ret.id

      const { error: itemsError } = await supabase.from('repair_sale_return_items').insert(
        validRows.map(r => ({
          return_id: ret.id, part_id: r.part_id,
          quantity: parseFloat(r.quantity), unit_price: parseFloat(r.unit_price), unit_cost: parseFloat(r.unit_cost) || 0,
          line_total: parseFloat(r.quantity) * parseFloat(r.unit_price),
        }))
      )
      if (itemsError) throw itemsError

      // Restore stock — a new FIFO batch at the item's original cost, same as
      // stock coming back in from anywhere else. If a later item fails after
      // earlier ones already restored stock, those need to be undone too —
      // otherwise the return record rolls back but the stock addition
      // doesn't, leaving current_stock artificially high with nothing on
      // record to explain it.
      const restoredSoFar = []
      try {
        for (const r of validRows) {
          const qty = parseFloat(r.quantity)
          const cost = parseFloat(r.unit_cost) || 0
          if (cost > 0) {
            const { error: batchError } = await supabase.rpc('repair_fifo_add_batch', { p_part_id: r.part_id, p_purchase_id: null, p_quantity: qty, p_unit_cost: cost })
            if (batchError) throw new Error(`Stock error for this return: ${batchError.message}`)
          }
          const { error: addError } = await supabase.rpc('repair_add_part_stock', { p_part_id: r.part_id, p_quantity: qty })
          if (addError) throw new Error(`Stock error for this return: ${addError.message}`)
          restoredSoFar.push({ part_id: r.part_id, quantity: qty })
        }
      } catch (stockErr) {
        for (const c of restoredSoFar.reverse()) {
          await supabase.rpc('repair_fifo_consume', { p_part_id: c.part_id, p_quantity: c.quantity })
          await supabase.rpc('repair_deduct_part_stock', { p_part_id: c.part_id, p_quantity: c.quantity })
        }
        throw stockErr
      }

      // Only a CREDIT return changes what the customer owes — cash/bank
      // refunds are a pure money movement (they already paid, now getting it
      // back), deliberately not touching outstanding_balance, matching
      // exactly what determines whether this shows in their ledger.
      if (paymentMethod === 'credit') {
        await supabase.rpc('repair_adjust_customer_balance', { p_customer_id: selectedCustomer.id, p_delta: -total })
      } else if (paymentMethod === 'cash') {
        await supabase.from('repair_cash_ledger').insert({ shop_id: shop?.id || null, type: 'refund', amount: -total, reference: selectedCustomer.name, notes: `Sale return: ${return_no}` })
      } else if (paymentMethod === 'bank') {
        const bank = bankAccounts.find(b => b.id === bankAccountId)
        await supabase.from('bank_accounts').update({ balance: (bank?.balance || 0) - total }).eq('id', bankAccountId)
        await supabase.from('bank_transactions').insert({ bank_account_id: bankAccountId, type: 'withdrawal', amount: total, reference: `Sale return: ${return_no}`, notes: selectedCustomer.name })
      }

      toast.success(`Return ${return_no} recorded`)
      onSaved()
    } catch (e) {
      if (returnId) await supabase.from('repair_sale_returns').delete().eq('id', returnId)
      toast.error('Failed: ' + e.message)
    }
    setSaving(false)
  }

  const inp = { width: '100%', padding: '9px 12px', border: '1.5px solid #e7dfd3', borderRadius: '8px', fontSize: '13px', boxSizing: 'border-box' }
  const lbl = { fontSize: '11px', fontWeight: '700', color: '#a89478', textTransform: 'uppercase', display: 'block', marginBottom: '5px' }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(28,25,23,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '20px' }}>
      <div style={{ background: 'white', borderRadius: '18px', padding: '26px', width: '100%', maxWidth: '520px', maxHeight: '90vh', overflowY: 'auto' }}>
        <h3 style={{ fontSize: '17px', fontWeight: '800', margin: '0 0 16px' }}>New Sale Return</h3>

        <div style={{ marginBottom: '14px', position: 'relative' }}>
          <label style={lbl}>Customer</label>
          {selectedCustomer ? (
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '9px 12px', background: '#fef3e2', borderRadius: '8px', border: '1.5px solid #e7dfd3' }}>
              <span style={{ fontWeight: '600', fontSize: '13px' }}>{selectedCustomer.name} — {selectedCustomer.mobile}</span>
              <button onClick={() => { setSelectedCustomer(null); setCustomerSearch('') }} style={{ background: 'none', border: 'none', color: '#e11d48', cursor: 'pointer' }}>✕</button>
            </div>
          ) : (
            <>
              <input style={inp} placeholder="Search by name or mobile" value={customerSearch}
                onChange={e => { setCustomerSearch(e.target.value); setShowCustomerDrop(true) }} onFocus={() => setShowCustomerDrop(true)} />
              {showCustomerDrop && customerResults.length > 0 && (
                <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: 'white', border: '1.5px solid #e7dfd3', borderRadius: '8px', marginTop: '2px', zIndex: 20, boxShadow: '0 8px 20px rgba(0,0,0,0.12)', maxHeight: '180px', overflowY: 'auto' }}>
                  {customerResults.map(c => (
                    <div key={c.id} onClick={() => { setSelectedCustomer(c); setShowCustomerDrop(false) }}
                      style={{ padding: '9px 12px', cursor: 'pointer', fontSize: '13px', borderBottom: '1px solid #f8f5f0' }}>
                      <div style={{ fontWeight: '600' }}>{c.name}</div>
                      <div style={{ fontSize: '11px', color: '#a89478' }}>{c.mobile}</div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>

        <label style={lbl}>Items being returned</label>
        {rows.map((r, i) => (
          <div key={i} style={{ display: 'grid', gridTemplateColumns: '2fr 0.6fr 0.8fr 0.8fr auto', gap: '8px', marginBottom: '8px', marginTop: '6px' }}>
            <PartPicker shop={shop} parts={parts} value={r.part_id}
              onChange={(id, p) => {
                setRows(rs => rs.map((row, idx) => idx !== i ? row : {
                  ...row, part_id: id,
                  unit_price: p ? String(p.selling_price || '') : '',
                  unit_cost: p ? String(p.average_cost || p.purchase_price || '') : '',
                }))
                if (p && !parts.some(pp => pp.id === p.id)) setParts(ps => [...ps, p])
              }} />
            <input type="number" style={inp} placeholder="Qty" value={r.quantity} onChange={e => updateRow(i, 'quantity', e.target.value)} />
            <input type="number" style={inp} placeholder="Refund Price" value={r.unit_price} onChange={e => updateRow(i, 'unit_price', e.target.value)} />
            <input type="number" style={inp} placeholder="Cost" value={r.unit_cost} onChange={e => updateRow(i, 'unit_cost', e.target.value)} title="Cost to restore stock value at — leave blank if this part isn't restocked to inventory" />
            <button onClick={() => removeRow(i)} style={{ background: '#fee2e2', border: 'none', borderRadius: '7px', color: '#e11d48', cursor: 'pointer', padding: '0 10px' }}>✕</button>
          </div>
        ))}
        <button onClick={addRow} style={{ marginBottom: '16px', padding: '6px 14px', background: '#fef3e2', color: '#d4881f', border: 'none', borderRadius: '7px', cursor: 'pointer', fontSize: '12px', fontWeight: '700' }}>+ Add Row</button>

        <div style={{ marginBottom: '14px' }}>
          <label style={lbl}>Reason for return *</label>
          <textarea style={{ ...inp, minHeight: '60px' }} value={remarks} onChange={e => setRemarks(e.target.value)} placeholder="e.g. wrong part, customer changed mind, defective" />
        </div>

        <div style={{ marginBottom: '16px' }}>
          <label style={lbl}>Refund Method</label>
          <select style={inp} value={paymentMethod} onChange={e => setPaymentMethod(e.target.value)}>
            <option value="credit">Credit (reduces what they owe)</option>
            <option value="cash">Cash</option>
            <option value="bank">Bank Transfer</option>
          </select>
        </div>
        {paymentMethod === 'bank' && (
          <div style={{ marginBottom: '16px' }}>
            <label style={lbl}>Bank Account</label>
            <select style={inp} value={bankAccountId} onChange={e => setBankAccountId(e.target.value)}>
              <option value="">Select...</option>
              {bankAccounts.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </div>
        )}

        <div style={{ background: '#fdf8f3', borderRadius: '10px', padding: '12px 16px', marginBottom: '18px', display: 'flex', justifyContent: 'space-between', fontWeight: '800', fontSize: '15px' }}>
          <span>Total Refund</span><span>{formatLKR(total)}</span>
        </div>

        <div style={{ display: 'flex', gap: '10px' }}>
          <button onClick={onClose} style={{ flex: 1, padding: '11px', background: '#f5f1ea', border: 'none', borderRadius: '10px', cursor: 'pointer', fontWeight: '700' }}>Cancel</button>
          <button onClick={handleSave} disabled={saving} style={{ flex: 2, padding: '11px', background: 'linear-gradient(135deg,#f0b23d,#d4881f)', border: 'none', borderRadius: '10px', cursor: 'pointer', fontWeight: '800' }}>{saving ? 'Saving...' : '✓ Confirm Return'}</button>
        </div>
      </div>
    </div>
  )
}

// Voiding a return means it should never have happened — undo it precisely
// via compensating entries (never delete/rewrite the original history):
// take the restored stock back out (consume it again — blocked if it's since
// been sold on, since it genuinely isn't here to take back), and reverse
// whatever balance/cash effect the return had, in the opposite direction.
function VoidSaleReturnModal({ shop, ret, onClose, onVoided }) {
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)

  async function handleVoid() {
    setSaving(true)
    try {
      const { data: items } = await supabase.from('repair_sale_return_items').select('*').eq('return_id', ret.id)

      // Stock sufficiency check up front, before changing anything.
      for (const it of (items || [])) {
        const { data: part } = await supabase.from('repair_parts').select('current_stock, name').eq('id', it.part_id).single()
        if (part && it.quantity > (part.current_stock || 0)) {
          toast.error(`Can't void — only ${part.current_stock || 0} of "${part.name}" left in stock (some may have been sold since this return)`)
          setSaving(false)
          return
        }
      }

      const consumedSoFar = []
      try {
        for (const it of (items || [])) {
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

      // Reverse the balance/cash effect, opposite direction from how the
      // return originally recorded it.
      if (ret.payment_method === 'credit') {
        await supabase.rpc('repair_adjust_customer_balance', { p_customer_id: ret.customer_id, p_delta: ret.total })
      } else if (ret.payment_method === 'cash') {
        await supabase.from('repair_cash_ledger').insert({ shop_id: shop?.id || null, type: 'refund', amount: ret.total, reference: ret.return_no, notes: 'Sale return voided' })
      } else if (ret.payment_method === 'bank' && ret.bank_account_id) {
        const { data: bank } = await supabase.from('bank_accounts').select('balance').eq('id', ret.bank_account_id).single()
        await supabase.from('bank_accounts').update({ balance: (bank?.balance || 0) + ret.total }).eq('id', ret.bank_account_id)
        await supabase.from('bank_transactions').insert({ bank_account_id: ret.bank_account_id, type: 'deposit', amount: ret.total, reference: `Sale return voided: ${ret.return_no}`, notes: '' })
      }

      await supabase.from('repair_sale_returns').update({
        status: 'voided', voided_at: new Date().toISOString(), void_reason: reason || null,
      }).eq('id', ret.id)

      toast.success('Return voided — all related transactions reversed')
      onVoided()
    } catch (e) { toast.error('Failed to void: ' + e.message) }
    setSaving(false)
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(28,25,23,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1100, padding: '20px' }}>
      <div style={{ background: 'white', borderRadius: '18px', padding: '24px', width: '100%', maxWidth: '440px' }}>
        <h3 style={{ fontSize: '16px', fontWeight: '800', margin: '0 0 4px', color: '#e11d48' }}>Void Return {ret.return_no}?</h3>
        <p style={{ fontSize: '12px', color: '#8a7a63', margin: '0 0 14px' }}>This cannot be undone. The following will be reversed:</p>
        <ul style={{ fontSize: '13px', color: '#44403c', margin: '0 0 16px', paddingLeft: '18px', lineHeight: '1.7' }}>
          <li>Stock restored by this return will be taken back out</li>
          <li>{ret.payment_method === 'credit' ? `${formatLKR(ret.total)} added back to the customer's balance` : `${formatLKR(ret.total)} refund (${ret.payment_method}) reversed`}</li>
        </ul>
        <label style={{ fontSize: '11px', fontWeight: '700', color: '#a89478', textTransform: 'uppercase' }}>Reason (optional)</label>
        <textarea style={{ width: '100%', padding: '9px 12px', border: '1.5px solid #e7dfd3', borderRadius: '8px', fontSize: '13px', boxSizing: 'border-box', minHeight: '60px', marginBottom: '16px', marginTop: '5px' }} value={reason} onChange={e => setReason(e.target.value)} placeholder="e.g. entered in error" />
        <div style={{ display: 'flex', gap: '10px' }}>
          <button onClick={onClose} style={{ flex: 1, padding: '10px', background: '#f5f1ea', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: '700' }}>Cancel</button>
          <button onClick={handleVoid} disabled={saving} style={{ flex: 1, padding: '10px', background: '#e11d48', color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: '800' }}>{saving ? 'Voiding...' : 'Void Return'}</button>
        </div>
      </div>
    </div>
  )
}
