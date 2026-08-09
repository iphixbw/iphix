import { useState, useEffect } from 'react'
import { supabase } from '../../supabase'
import toast from 'react-hot-toast'
import { formatLKR, timeAgo, printPartsSaleReceipt } from '../../lib/repairConstants'
import { generateRepairSaleNo, generateRepairCustomerNo } from '../../lib/repairHelpers'

import { PartPicker, PartNameAutocomplete } from './RepairInventory'

export default function RepairSales({ shop }) {
  const [sales, setSales] = useState([])
  const [loading, setLoading] = useState(true)
  const [showNew, setShowNew] = useState(false)
  const [payingSale, setPayingSale] = useState(null)

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

      {loading ? <div style={{ padding: '60px', textAlign: 'center', color: '#a89478' }}>Loading...</div> : (
        <div style={{ background: 'white', borderRadius: '16px', border: '1px solid #f3ede4', overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr style={{ background: '#fdf8f3', borderBottom: '2px solid #f3ede4' }}>
              {['Sale No', 'Customer', 'Date', 'Total', 'Paid', 'Balance', 'Payment', '', ''].map(h => (
                <th key={h} style={{ padding: '10px 14px', textAlign: 'left', fontSize: '10px', fontWeight: '700', color: '#a89478', textTransform: 'uppercase' }}>{h}</th>
              ))}
            </tr></thead>
            <tbody>
              {sales.map((s, i) => (
                <tr key={s.id} style={{ borderBottom: '1px solid #f8f5f0', background: i % 2 === 0 ? 'white' : '#fdfbf8' }}>
                  <td style={{ padding: '11px 14px', fontWeight: '700', color: '#d4881f' }}>{s.sale_no}</td>
                  <td style={{ padding: '11px 14px' }}>{s.repair_customers?.name || s.customer_name || 'Walk-in'}</td>
                  <td style={{ padding: '11px 14px', fontSize: '12px', color: '#78716c' }}>{timeAgo(s.created_at)}</td>
                  <td style={{ padding: '11px 14px', fontWeight: '700' }}>{formatLKR(s.total)}</td>
                  <td style={{ padding: '11px 14px', color: '#059669' }}>{formatLKR(s.amount_paid)}</td>
                  <td style={{ padding: '11px 14px', fontWeight: '700', color: (s.total - s.amount_paid) > 0 ? '#e11d48' : '#94a3b8' }}>{formatLKR(s.total - s.amount_paid)}</td>
                  <td style={{ padding: '11px 14px', fontSize: '12px', textTransform: 'capitalize' }}>{s.payment_method}</td>
                  <td style={{ padding: '11px 14px' }}><span style={{ padding: '3px 10px', borderRadius: '8px', fontSize: '11px', fontWeight: '700', background: '#f0fdf4', color: '#166534' }}>{s.status}</span></td>
                  <td style={{ padding: '11px 14px', display: 'flex', gap: '6px' }}>
                    {(s.total - s.amount_paid) > 0 && s.customer_id && (
                      <button onClick={() => setPayingSale(s)} style={{ padding: '4px 10px', background: '#f0fdf4', color: '#059669', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '11px', fontWeight: '700' }}>
                        💵 Pay
                      </button>
                    )}
                    <button onClick={() => reprintReceipt(s)} style={{ padding: '4px 10px', background: '#fef3e2', color: '#d4881f', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '11px', fontWeight: '700' }}>
                      🖨 Print
                    </button>
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
  const [suppliers, setSuppliers] = useState([])
  const [rows, setRows] = useState([{ part_id: '', quantity: '1', unit_price: '', is_third_party: false, item_name: '', supplier_id: '', supplier_other: '', cost_price: '' }])
  const [paymentMethod, setPaymentMethod] = useState('cash')
  const [amountPaid, setAmountPaid] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => { supabase.from('repair_suppliers').select('id, name').order('name').then(({ data }) => setSuppliers(data || [])) }, [])

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

  const total = rows.reduce((s, r) => s + (parseFloat(r.quantity) || 0) * (parseFloat(r.unit_price) || 0), 0)
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
    setSaving(true)
    try {
      const sale_no = await generateRepairSaleNo()
      const { data: sale, error } = await supabase.from('repair_sales').insert({
        sale_no, shop_id: shop?.id || null,
        customer_id: selectedCustomer?.id || null,
        customer_name: selectedCustomer?.name || customerName || 'Walk-in',
        subtotal: total, total, payment_method: paymentMethod, amount_paid: paid, status: 'confirmed',
      }).select().single()
      if (error) throw error

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

      // Cash ledger only reflects actual cash received today, not credit or non-cash methods
      if (paymentMethod === 'cash' && paid > 0) {
        await supabase.from('repair_cash_ledger').insert({ shop_id: shop?.id || null, type: 'sale', amount: paid, reference: sale_no, notes: 'Parts sale' })
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
                <PartPicker shop={shop} parts={parts} value={r.part_id}
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

        <div style={{ background: '#fdf8f3', borderRadius: '10px', padding: '14px', marginBottom: '18px' }}>
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
