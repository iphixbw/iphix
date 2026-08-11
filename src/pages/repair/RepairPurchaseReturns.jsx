import { useState, useEffect } from 'react'
import { supabase } from '../../supabase'
import toast from 'react-hot-toast'
import { formatLKR, timeAgo } from '../../lib/repairConstants'
import { generateRepairReturnNo } from '../../lib/repairHelpers'
import { PartPicker } from './RepairInventory'

// Returning parts to a supplier — reduces stock (FIFO consume, oldest batches
// first, same as a sale would), reduces what we owe that supplier, and
// records the refund if money actually came back (cash/bank). Mirrors the
// retail PurchaseReturns.jsx page's accounting conventions exactly, adapted
// to repair's FIFO batch tracking: the supplier balance drops regardless of
// refund method (goods went back either way), while cash/bank additionally
// records the money coming in.
export default function RepairPurchaseReturns({ shop }) {
  const [returns, setReturns] = useState([])
  const [suppliers, setSuppliers] = useState([])
  const [loading, setLoading] = useState(true)
  const [showNew, setShowNew] = useState(false)
  const [viewing, setViewing] = useState(null)
  const [viewItems, setViewItems] = useState([])
  const [voiding, setVoiding] = useState(null)

  useEffect(() => { fetchAll() }, [shop?.id])

  async function fetchAll() {
    setLoading(true)
    let q = supabase.from('repair_purchase_returns').select('*, repair_suppliers(name, supplier_no)').order('created_at', { ascending: false })
    if (shop?.id) q = q.eq('shop_id', shop.id)
    const [{ data: r }, { data: s }] = await Promise.all([q, supabase.from('repair_suppliers').select('*').order('name')])
    setReturns(r || [])
    setSuppliers(s || [])
    setLoading(false)
  }

  async function viewReturn(r) {
    const { data } = await supabase.from('repair_purchase_return_items').select('*, repair_parts(name, sku)').eq('return_id', r.id)
    setViewItems(data || [])
    setViewing(r)
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '18px' }}>
        <p style={{ color: '#8a7a63', fontSize: '13px', margin: 0 }}>{returns.length} return{returns.length !== 1 ? 's' : ''} to suppliers</p>
        <button onClick={() => setShowNew(true)}
          style={{ padding: '10px 20px', background: 'linear-gradient(135deg,#f0b23d,#d4881f)', color: '#1c1917', border: 'none', borderRadius: '11px', cursor: 'pointer', fontWeight: '800', fontSize: '13px' }}>
          + New Return
        </button>
      </div>

      {loading ? <div style={{ padding: '60px', textAlign: 'center', color: '#a89478' }}>Loading...</div> : (
        <div style={{ background: 'white', borderRadius: '16px', border: '1px solid #f3ede4', overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr style={{ background: '#fdf8f3', borderBottom: '2px solid #f3ede4' }}>
              {['Return No', 'Supplier', 'Date', 'Total', 'Method', 'Status', ''].map(h => (
                <th key={h} style={{ padding: '10px 14px', textAlign: 'left', fontSize: '10px', fontWeight: '700', color: '#a89478', textTransform: 'uppercase' }}>{h}</th>
              ))}
            </tr></thead>
            <tbody>
              {returns.map((r, i) => (
                <tr key={r.id} style={{ borderBottom: '1px solid #f8f5f0', background: r.status === 'voided' ? '#faf9f7' : i % 2 === 0 ? 'white' : '#fdfbf8', opacity: r.status === 'voided' ? 0.6 : 1 }}>
                  <td onClick={() => viewReturn(r)} style={{ padding: '11px 14px', fontWeight: '700', color: '#d4881f', cursor: 'pointer' }}>{r.return_no}</td>
                  <td onClick={() => viewReturn(r)} style={{ padding: '11px 14px', cursor: 'pointer' }}>{r.repair_suppliers?.name || '—'}</td>
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
          {returns.length === 0 && <div style={{ padding: '48px', textAlign: 'center', color: '#a89478' }}>No purchase returns yet.</div>}
        </div>
      )}

      {showNew && <NewPurchaseReturnModal shop={shop} suppliers={suppliers} onClose={() => setShowNew(false)} onSaved={() => { setShowNew(false); fetchAll() }} />}
      {voiding && <VoidPurchaseReturnModal shop={shop} ret={voiding} onClose={() => setVoiding(null)} onVoided={() => { setVoiding(null); fetchAll() }} />}

      {viewing && (
        <div onClick={() => setViewing(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(28,25,23,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '20px' }}>
          <div onClick={e => e.stopPropagation()} style={{ background: 'white', borderRadius: '18px', padding: '28px', width: '100%', maxWidth: '500px', maxHeight: '85vh', overflowY: 'auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
              <h3 style={{ fontSize: '17px', fontWeight: '800', margin: 0 }}>{viewing.return_no}</h3>
              <button onClick={() => setViewing(null)} style={{ background: 'none', border: 'none', fontSize: '18px', cursor: 'pointer', color: '#a89478' }}>✕</button>
            </div>
            <p style={{ fontSize: '13px', color: '#8a7a63', margin: '0 0 4px' }}>Supplier: {viewing.repair_suppliers?.name || '—'}</p>
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

function NewPurchaseReturnModal({ shop, suppliers, onClose, onSaved }) {
  const [supplierId, setSupplierId] = useState('')
  const [parts, setParts] = useState([])
  const [rows, setRows] = useState([{ part_id: '', quantity: '1', unit_cost: '' }])
  const [paymentMethod, setPaymentMethod] = useState('credit')
  const [bankAccountId, setBankAccountId] = useState('')
  const [bankAccounts, setBankAccounts] = useState([])
  const [remarks, setRemarks] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let q = supabase.from('repair_parts').select('*').order('name')
    async function fetchAllParts() {
      let all = [], from = 0
      while (true) {
        const { data } = await q.range(from, from + 999)
        all = all.concat(data || [])
        if (!data || data.length < 1000) break
        from += 1000
      }
      setParts(all)
    }
    fetchAllParts()
    supabase.from('bank_accounts').select('*').order('name').then(({ data }) => setBankAccounts(data || []))
  }, [])

  function updateRow(i, field, val) {
    setRows(rs => rs.map((r, idx) => idx !== i ? r : { ...r, [field]: val }))
  }
  function addRow() { setRows(rs => [...rs, { part_id: '', quantity: '1', unit_cost: '' }]) }
  function removeRow(i) { setRows(rs => rs.filter((_, idx) => idx !== i)) }

  const validRows = rows.filter(r => r.part_id && parseFloat(r.quantity) > 0)
  const total = validRows.reduce((s, r) => s + (parseFloat(r.quantity) || 0) * (parseFloat(r.unit_cost) || 0), 0)

  async function handleSave() {
    if (!supplierId) return toast.error('Select a supplier')
    if (validRows.length === 0) return toast.error('Add at least one item')
    if (!remarks.trim()) return toast.error('A reason for the return is required')
    if (validRows.some(r => !(parseFloat(r.unit_cost) > 0))) return toast.error('Enter a unit cost for every item')
    if (paymentMethod === 'bank' && !bankAccountId) return toast.error('Select a bank account')

    // Stock sufficiency check up front — can't send back more than we have.
    for (const r of validRows) {
      const part = parts.find(p => p.id === r.part_id)
      if (part && parseFloat(r.quantity) > (part.current_stock || 0)) {
        return toast.error(`Only ${part.current_stock || 0} of "${part.name}" in stock — can't return more than that`)
      }
    }

    setSaving(true)
    let returnId = null
    try {
      const return_no = await generateRepairReturnNo()
      const { data: ret, error } = await supabase.from('repair_purchase_returns').insert({
        return_no, supplier_id: supplierId, shop_id: shop?.id || null,
        payment_method: paymentMethod, bank_account_id: paymentMethod === 'bank' ? bankAccountId : null,
        subtotal: total, total, remarks: remarks.trim(),
      }).select().single()
      if (error) throw error
      returnId = ret.id

      const { error: itemsError } = await supabase.from('repair_purchase_return_items').insert(
        validRows.map(r => ({
          return_id: ret.id, part_id: r.part_id,
          quantity: parseFloat(r.quantity), unit_cost: parseFloat(r.unit_cost),
          line_total: parseFloat(r.quantity) * parseFloat(r.unit_cost),
        }))
      )
      if (itemsError) throw itemsError

      // Consume stock FIFO (oldest batches first) for each returned part —
      // same mechanism a sale or job would use to take stock out. This can
      // legitimately fail if FIFO batches don't actually cover the requested
      // quantity even though current_stock said they should (the exact kind
      // of drift this app has hit before). If a LATER item fails after
      // earlier ones already succeeded, those earlier stock changes must be
      // undone too — otherwise the return record gets rolled back but the
      // stock reduction doesn't, leaving current_stock artificially low with
      // nothing on record to explain it.
      const consumedSoFar = []
      try {
        for (const r of validRows) {
          const qty = parseFloat(r.quantity)
          const { data: costConsumed, error: consumeError } = await supabase.rpc('repair_fifo_consume', { p_part_id: r.part_id, p_quantity: qty })
          if (consumeError) throw new Error(`Stock error for this return: ${consumeError.message}`)
          const { error: deductError } = await supabase.rpc('repair_deduct_part_stock', { p_part_id: r.part_id, p_quantity: qty })
          if (deductError) throw new Error(`Stock error for this return: ${deductError.message}`)
          consumedSoFar.push({ part_id: r.part_id, quantity: qty, avgCost: qty > 0 ? (costConsumed || 0) / qty : 0 })
        }
      } catch (stockErr) {
        for (const c of consumedSoFar.reverse()) {
          await supabase.rpc('repair_fifo_return', { p_part_id: c.part_id, p_quantity: c.quantity, p_unit_cost: c.avgCost })
          await supabase.rpc('repair_add_part_stock', { p_part_id: c.part_id, p_quantity: c.quantity })
        }
        throw stockErr
      }

      // Supplier owes us less (or we owe them less) regardless of refund
      // method — goods physically went back either way. Cash/bank refunds
      // additionally record the money actually coming back in.
      await supabase.rpc('repair_adjust_supplier_balance', { p_supplier_id: supplierId, p_delta: -total })

      const supplier = suppliers.find(s => s.id === supplierId)
      if (paymentMethod === 'cash') {
        await supabase.from('repair_cash_ledger').insert({ shop_id: shop?.id || null, type: 'refund', amount: total, reference: supplier?.name || return_no, notes: `Purchase return: ${return_no}` })
      } else if (paymentMethod === 'bank') {
        const bank = bankAccounts.find(b => b.id === bankAccountId)
        await supabase.from('bank_accounts').update({ balance: (bank?.balance || 0) + total }).eq('id', bankAccountId)
        await supabase.from('bank_transactions').insert({ bank_account_id: bankAccountId, type: 'deposit', amount: total, reference: `Purchase return: ${return_no}`, notes: supplier?.name || '' })
      }

      toast.success(`Return ${return_no} recorded`)
      onSaved()
    } catch (e) {
      // Best-effort rollback of the return header if anything downstream failed,
      // so a half-finished return doesn't sit around looking legitimate.
      if (returnId) await supabase.from('repair_purchase_returns').delete().eq('id', returnId)
      toast.error('Failed: ' + e.message)
    }
    setSaving(false)
  }

  const inp = { width: '100%', padding: '9px 12px', border: '1.5px solid #e7dfd3', borderRadius: '8px', fontSize: '13px', boxSizing: 'border-box' }
  const lbl = { fontSize: '11px', fontWeight: '700', color: '#a89478', textTransform: 'uppercase', display: 'block', marginBottom: '5px' }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(28,25,23,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '20px' }}>
      <div style={{ background: 'white', borderRadius: '18px', padding: '26px', width: '100%', maxWidth: '520px', maxHeight: '90vh', overflowY: 'auto' }}>
        <h3 style={{ fontSize: '17px', fontWeight: '800', margin: '0 0 16px' }}>New Purchase Return</h3>

        <div style={{ marginBottom: '14px' }}>
          <label style={lbl}>Supplier</label>
          <select style={inp} value={supplierId} onChange={e => setSupplierId(e.target.value)}>
            <option value="">Select supplier...</option>
            {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>

        <label style={lbl}>Items being returned</label>
        {rows.map((r, i) => (
          <div key={i} style={{ display: 'grid', gridTemplateColumns: '2fr 0.7fr 1fr auto', gap: '8px', marginBottom: '8px', marginTop: '6px' }}>
            <PartPicker shop={shop} parts={parts} value={r.part_id}
              onChange={(id, p) => {
                setRows(rs => rs.map((row, idx) => idx !== i ? row : { ...row, part_id: id, unit_cost: p ? String(p.average_cost || p.purchase_price || '') : '' }))
                if (p && !parts.some(pp => pp.id === p.id)) setParts(ps => [...ps, p])
              }} />
            <input type="number" style={inp} placeholder="Qty" value={r.quantity} onChange={e => updateRow(i, 'quantity', e.target.value)} />
            <input type="number" style={inp} placeholder="Unit Cost" value={r.unit_cost} onChange={e => updateRow(i, 'unit_cost', e.target.value)} />
            <button onClick={() => removeRow(i)} style={{ background: '#fee2e2', border: 'none', borderRadius: '7px', color: '#e11d48', cursor: 'pointer', padding: '0 10px' }}>✕</button>
          </div>
        ))}
        <button onClick={addRow} style={{ marginBottom: '16px', padding: '6px 14px', background: '#fef3e2', color: '#d4881f', border: 'none', borderRadius: '7px', cursor: 'pointer', fontSize: '12px', fontWeight: '700' }}>+ Add Row</button>

        <div style={{ marginBottom: '14px' }}>
          <label style={lbl}>Reason for return *</label>
          <textarea style={{ ...inp, minHeight: '60px' }} value={remarks} onChange={e => setRemarks(e.target.value)} placeholder="e.g. defective units, wrong part sent" />
        </div>

        <div style={{ marginBottom: '16px' }}>
          <label style={lbl}>Refund Method</label>
          <select style={inp} value={paymentMethod} onChange={e => setPaymentMethod(e.target.value)}>
            <option value="credit">Credit (reduces what we owe)</option>
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
// via compensating entries: restore the stock that was sent back to the
// supplier, and reverse the balance/cash effect in the opposite direction.
function VoidPurchaseReturnModal({ shop, ret, onClose, onVoided }) {
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)

  async function handleVoid() {
    setSaving(true)
    try {
      const { data: items } = await supabase.from('repair_purchase_return_items').select('*').eq('return_id', ret.id)

      const restoredSoFar = []
      try {
        for (const it of (items || [])) {
          const { error: batchError } = await supabase.rpc('repair_fifo_add_batch', { p_part_id: it.part_id, p_purchase_id: null, p_quantity: it.quantity, p_unit_cost: it.unit_cost })
          if (batchError) throw new Error(batchError.message)
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

      // Reverse the balance/cash effect, opposite direction from how the
      // return originally recorded it (it always reduced supplier balance
      // regardless of method — see NewPurchaseReturnModal). Checked so a
      // failure here stops before the return gets marked voided below.
      const { error: balErr } = await supabase.rpc('repair_adjust_supplier_balance', { p_supplier_id: ret.supplier_id, p_delta: ret.total })
      if (balErr) throw balErr
      if (ret.payment_method === 'cash') {
        const { error: cashErr } = await supabase.from('repair_cash_ledger').insert({ shop_id: shop?.id || null, type: 'refund', amount: -ret.total, reference: ret.return_no, notes: 'Purchase return voided' })
        if (cashErr) throw cashErr
      } else if (ret.payment_method === 'bank' && ret.bank_account_id) {
        const { data: bank } = await supabase.from('bank_accounts').select('balance').eq('id', ret.bank_account_id).single()
        const { error: bankErr } = await supabase.from('bank_accounts').update({ balance: (bank?.balance || 0) - ret.total }).eq('id', ret.bank_account_id)
        if (bankErr) throw bankErr
        const { error: txErr } = await supabase.from('bank_transactions').insert({ bank_account_id: ret.bank_account_id, type: 'withdrawal', amount: ret.total, reference: `Purchase return voided: ${ret.return_no}`, notes: '' })
        if (txErr) throw txErr
      }

      await supabase.from('repair_purchase_returns').update({
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
          <li>Stock sent back to the supplier will be restored</li>
          <li>{formatLKR(ret.total)} added back to the supplier's balance{ret.payment_method !== 'credit' ? `, and the ${ret.payment_method} refund reversed` : ''}</li>
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
