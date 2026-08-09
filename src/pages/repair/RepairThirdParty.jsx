import { useState, useEffect } from 'react'
import { supabase } from '../../supabase'
import toast from 'react-hot-toast'
import { formatLKR, timeAgo } from '../../lib/repairConstants'

// Item 3: dedicated top-level page (not buried in Reports) for settling
// 3rd-party job items — edit their real cost and mark them paid.
export default function RepairThirdParty({ shop }) {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [editingId, setEditingId] = useState(null)
  const [costInput, setCostInput] = useState('')
  const [payingItem, setPayingItem] = useState(null)
  const [selectedIds, setSelectedIds] = useState([])
  const [showBatchPay, setShowBatchPay] = useState(false)
  const [bankAccounts, setBankAccounts] = useState([])

  useEffect(() => { fetchItems(); fetchBanks() }, [shop?.id])

  async function fetchBanks() {
    const { data } = await supabase.from('bank_accounts').select('*').order('name')
    setBankAccounts(data || [])
  }

  async function fetchItems() {
    setLoading(true)
    let q = supabase.from('repair_third_party_items').select('*, repair_jobs(job_no), repair_sales(sale_no)').order('created_at', { ascending: false })
    if (shop?.id) q = q.eq('shop_id', shop.id)
    const { data } = await q
    setItems(data || [])
    setSelectedIds([])
    setLoading(false)
  }

  async function recalcJobFinancials(jobId) {
    const { data: job } = await supabase.from('repair_jobs').select('*').eq('id', jobId).single()
    if (!job) return
    const [{ data: jobParts }, { data: allThirdParty }] = await Promise.all([
      supabase.from('repair_job_parts').select('unit_cost, quantity').eq('job_id', jobId),
      supabase.from('repair_third_party_items').select('cost_price, quantity').eq('job_id', jobId),
    ])
    const partsCost = (jobParts || []).reduce((s, p) => s + (p.unit_cost || 0) * p.quantity, 0)
    const tpCost = (allThirdParty || []).reduce((s, t) => s + (t.cost_price || 0) * t.quantity, 0)
    const costTotal = partsCost + tpCost
    const income = job.estimated_cost || 0
    await supabase.from('repair_jobs').update({
      cost_total: costTotal, gross_profit: income - costTotal, net_profit: income - costTotal,
    }).eq('id', jobId)
  }

  async function saveCost(item) {
    const val = parseFloat(costInput)
    if (isNaN(val) || val < 0) return toast.error('Enter a valid cost')
    try {
      await supabase.from('repair_third_party_items').update({ cost_price: val }).eq('id', item.id)
      await recalcJobFinancials(item.job_id)
      setEditingId(null)
      toast.success('Cost updated')
      fetchItems()
    } catch (e) { toast.error('Failed: ' + e.message) }
  }

  // One settlement can now cover several pending items in one action — used both
  // for a single item (the existing "Mark Paid" button) and for the batch-pay flow
  // (several 3rd-party items from the same supplier, settled together).
  async function settleItems(itemsToPay, method, bankAccountId, chequeNo, chequeDate) {
    try {
      const totalAmount = itemsToPay.reduce((s, i) => s + (i.cost_price || 0) * i.quantity, 0)
      const jobsInvolved = [...new Set(itemsToPay.map(i => i.job_id))]
      const referenceLabel = itemsToPay.length === 1 ? itemsToPay[0].item_name : `${itemsToPay.length} items`
      const supplierLabel = itemsToPay[0]?.supplier_name || ''

      // For bank/cheque methods, the transaction is inserted first so every item
      // settled in this batch can be linked to it — that link is what lets a later
      // cheque return (in Bank.jsx) find and reverse exactly these items.
      let bankTransactionId = null

      if (totalAmount > 0) {
        if (method === 'bank' && bankAccountId) {
          const bank = bankAccounts.find(b => b.id === bankAccountId)
          await supabase.from('bank_accounts').update({ balance: (bank?.balance || 0) - totalAmount }).eq('id', bankAccountId)
          const { data: btx } = await supabase.from('bank_transactions').insert({
            bank_account_id: bankAccountId, type: 'withdrawal', amount: totalAmount,
            reference: `3rd-party settlement${supplierLabel ? `: ${supplierLabel}` : ''}`,
            notes: referenceLabel,
          }).select().single()
          bankTransactionId = btx?.id || null
        } else if (method === 'cheque' && bankAccountId) {
          // Cheque out — recorded pending, same as the ERP retail/supplier cheque flow,
          // using the same shared bank_accounts table so this shows up alongside
          // retail's own cheques in Bank > Cheques Due until presented/returned.
          const { data: btx } = await supabase.from('bank_transactions').insert({
            bank_account_id: bankAccountId, type: 'cheque_out', amount: totalAmount,
            cheque_no: chequeNo || null, cheque_date: chequeDate || null, cheque_status: 'pending',
            reference: `3rd-party settlement${supplierLabel ? `: ${supplierLabel}` : ''}`,
            notes: referenceLabel,
          }).select().single()
          bankTransactionId = btx?.id || null
        }
      }

      for (const item of itemsToPay) {
        await supabase.from('repair_third_party_items').update({
          payment_status: 'paid', payment_method: method, paid_at: new Date().toISOString(),
          bank_transaction_id: bankTransactionId,
        }).eq('id', item.id)
      }

      // Mirror the normal supplier-payment convention (RepairPurchases.jsx): the
      // balance drops immediately on recording, regardless of method — including
      // cheques, which get reversed back up in Bank.jsx if the cheque later
      // bounces. A batch can include items from more than one supplier (or none,
      // for untracked/free-text suppliers), so group by supplier_id first.
      const bySupplier = {}
      for (const item of itemsToPay) {
        if (!item.supplier_id) continue
        bySupplier[item.supplier_id] = (bySupplier[item.supplier_id] || 0) + (item.cost_price || 0) * item.quantity
      }
      for (const [supplierId, amount] of Object.entries(bySupplier)) {
        if (amount > 0) await supabase.rpc('repair_adjust_supplier_balance', { p_supplier_id: supplierId, p_delta: -amount })
      }

      if (totalAmount > 0 && method === 'cash') {
        await supabase.from('repair_cash_ledger').insert({
          shop_id: shop?.id || null, type: 'payment', amount: -totalAmount,
          reference: supplierLabel || referenceLabel,
          notes: `3rd-party settlement — ${referenceLabel}`,
        })
      }

      for (const jobId of jobsInvolved) await recalcJobFinancials(jobId)

      toast.success(itemsToPay.length === 1 ? 'Marked as paid' : `${itemsToPay.length} items settled`)
      setPayingItem(null)
      setShowBatchPay(false)
      fetchItems()
    } catch (e) { toast.error('Failed: ' + e.message) }
  }

  function toggleSelect(id) {
    setSelectedIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])
  }

  const pendingItems = items.filter(i => i.payment_status !== 'paid')
  const totalPending = pendingItems.reduce((s, i) => s + (i.cost_price || 0) * i.quantity, 0)
  const selectedItems = items.filter(i => selectedIds.includes(i.id))
  // Batch pay only makes sense within one supplier — mixing suppliers into one bank
  // withdrawal/cheque would misattribute the money. Selecting across suppliers is
  // still allowed (checkboxes aren't restricted), but the batch action requires a
  // single supplier among the current selection.
  const selectedSuppliers = [...new Set(selectedItems.map(i => i.supplier_name || '—'))]

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '4px', flexWrap: 'wrap', gap: '10px' }}>
        <h1 style={{ fontSize: '22px', fontWeight: '800', color: '#1c1917', margin: 0 }}>🔗 3rd Party Items</h1>
        {selectedIds.length > 0 && (
          selectedSuppliers.length > 1 ? (
            <span style={{ fontSize: '12px', color: '#e11d48', fontWeight: '700', padding: '9px 14px' }}>
              Select items from one supplier only to batch-pay ({selectedSuppliers.length} suppliers selected)
            </span>
          ) : (
            <button onClick={() => setShowBatchPay(true)}
              style={{ padding: '10px 20px', background: 'linear-gradient(135deg,#f0b23d,#d4881f)', color: '#1c1917', border: 'none', borderRadius: '10px', cursor: 'pointer', fontWeight: '800', fontSize: '13px' }}>
              💵 Settle {selectedIds.length} Selected ({formatLKR(selectedItems.reduce((s, i) => s + (i.cost_price || 0) * i.quantity, 0))})
            </button>
          )
        )}
      </div>
      <p style={{ fontSize: '14px', color: '#8a7a63', margin: '0 0 20px' }}>
        Items sourced for a job outside repair inventory. Fill in the real cost and settle payment once confirmed with the source — one at a time, or select several from the same supplier to pay together.
        {totalPending > 0 && <span style={{ color: '#e11d48', fontWeight: '700' }}> · {formatLKR(totalPending)} pending settlement</span>}
      </p>

      {loading ? <div style={{ padding: '60px', textAlign: 'center', color: '#a89478' }}>Loading...</div> : items.length === 0 ? (
        <div style={{ background: 'white', borderRadius: '16px', padding: '48px', textAlign: 'center', color: '#a89478', border: '1px solid #f3ede4' }}>No 3rd-party items yet.</div>
      ) : (
        <div style={{ background: 'white', borderRadius: '16px', border: '1px solid #f3ede4', overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
            <thead><tr style={{ background: '#fdf8f3', borderBottom: '2px solid #f3ede4' }}>
              {['', 'Date', 'Job', 'Item', 'Source', 'Qty', 'Sold For', 'Cost', 'Status', ''].map(h => (
                <th key={h} style={{ padding: '9px 14px', textAlign: 'left', fontSize: '10px', fontWeight: '700', color: '#a89478', textTransform: 'uppercase' }}>{h}</th>
              ))}
            </tr></thead>
            <tbody>
              {items.map((i, idx) => (
                <tr key={i.id} style={{ borderBottom: '1px solid #f8f5f0', background: i.payment_status === 'pending' ? '#fffbeb' : idx % 2 === 0 ? 'white' : '#fdfbf8' }}>
                  <td style={{ padding: '9px 14px' }}>
                    {i.payment_status !== 'paid' && (
                      <input type="checkbox" checked={selectedIds.includes(i.id)} onChange={() => toggleSelect(i.id)} style={{ cursor: 'pointer' }} />
                    )}
                  </td>
                  <td style={{ padding: '9px 14px', fontSize: '12px', color: '#78716c' }}>{timeAgo(i.created_at)}</td>
                  <td style={{ padding: '9px 14px', color: '#d4881f', fontWeight: '700' }}>{i.repair_jobs?.job_no || i.repair_sales?.sale_no || '—'}</td>
                  <td style={{ padding: '9px 14px', fontWeight: '600' }}>{i.item_name}</td>
                  <td style={{ padding: '9px 14px', color: '#78716c' }}>{i.supplier_name || '—'}</td>
                  <td style={{ padding: '9px 14px' }}>{i.quantity}</td>
                  <td style={{ padding: '9px 14px', color: '#166534', fontWeight: '600' }}>{formatLKR(i.selling_price)}</td>
                  <td style={{ padding: '9px 14px' }}>
                    {editingId === i.id ? (
                      <div style={{ display: 'flex', gap: '4px' }}>
                        <input type="number" autoFocus value={costInput} onChange={e => setCostInput(e.target.value)}
                          style={{ width: '70px', padding: '4px 6px', border: '1.5px solid #f0b23d', borderRadius: '5px', fontSize: '12px' }} />
                        <button onClick={() => saveCost(i)} style={{ background: '#166534', color: 'white', border: 'none', borderRadius: '5px', padding: '0 6px', cursor: 'pointer', fontSize: '11px' }}>✓</button>
                      </div>
                    ) : (
                      <span onClick={() => { setEditingId(i.id); setCostInput(String(i.cost_price || '')) }} style={{ cursor: 'pointer', borderBottom: '1px dashed #d4881f' }}>
                        {formatLKR(i.cost_price)}
                      </span>
                    )}
                  </td>
                  <td style={{ padding: '9px 14px' }}>
                    <span style={{ padding: '2px 9px', borderRadius: '8px', fontSize: '11px', fontWeight: '700', background: i.payment_status === 'paid' ? '#f0fdf4' : '#fef3e2', color: i.payment_status === 'paid' ? '#166534' : '#d4881f' }}>
                      {i.payment_status}
                    </span>
                  </td>
                  <td style={{ padding: '9px 14px' }}>
                    {i.payment_status !== 'paid' && (
                      <button onClick={() => setPayingItem(i)} style={{ padding: '4px 10px', background: '#fef3e2', color: '#d4881f', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '11px', fontWeight: '700' }}>
                        Mark Paid
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {payingItem && (
        <SettleModal items={[payingItem]} bankAccounts={bankAccounts} onClose={() => setPayingItem(null)} onConfirm={settleItems} />
      )}
      {showBatchPay && selectedItems.length > 0 && (
        <SettleModal items={selectedItems} bankAccounts={bankAccounts} onClose={() => setShowBatchPay(false)} onConfirm={settleItems} />
      )}
    </div>
  )
}

// Settles one or several 3rd-party items in a single payment action — cash, a
// iPHIX Technologies bank account transfer, or a cheque (recorded pending, same as the
// ERP retail/supplier cheque flow).
function SettleModal({ items, bankAccounts, onClose, onConfirm }) {
  const [method, setMethod] = useState('cash')
  const [bankAccountId, setBankAccountId] = useState('')
  const [chequeNo, setChequeNo] = useState('')
  const [chequeDate, setChequeDate] = useState('')
  const amount = items.reduce((s, i) => s + (i.cost_price || 0) * i.quantity, 0)
  const supplierLabel = items[0]?.supplier_name

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(28,25,23,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1100, padding: '20px' }}>
      <div style={{ background: 'white', borderRadius: '18px', padding: '24px', width: '100%', maxWidth: '400px' }}>
        <h3 style={{ fontSize: '16px', fontWeight: '800', margin: '0 0 4px', color: '#1c1917' }}>
          {items.length === 1 ? `Settle: ${items[0].item_name}` : `Settle ${items.length} items`}
        </h3>
        {supplierLabel && <p style={{ fontSize: '12px', color: '#a89478', margin: '0 0 4px' }}>Supplier: {supplierLabel}</p>}
        <p style={{ fontSize: '12px', color: '#8a7a63', margin: '0 0 16px' }}>Total amount: {formatLKR(amount)}</p>
        {items.length > 1 && (
          <div style={{ marginBottom: '14px', maxHeight: '110px', overflowY: 'auto', background: '#fdf8f3', borderRadius: '8px', padding: '8px 10px' }}>
            {items.map(i => (
              <div key={i.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', padding: '2px 0' }}>
                <span>{i.item_name} ({i.repair_jobs?.job_no || i.repair_sales?.sale_no || '—'})</span>
                <span style={{ fontWeight: '600' }}>{formatLKR((i.cost_price || 0) * i.quantity)}</span>
              </div>
            ))}
          </div>
        )}
        <div style={{ marginBottom: '10px' }}>
          <label style={{ fontSize: '11px', fontWeight: '700', color: '#a89478' }}>Payment Method</label>
          <select style={{ width: '100%', padding: '9px 12px', border: '1.5px solid #e7dfd3', borderRadius: '8px', fontSize: '13px', boxSizing: 'border-box' }} value={method} onChange={e => setMethod(e.target.value)}>
            <option value="cash">Cash</option>
            <option value="bank">Bank Transfer</option>
            <option value="cheque">Cheque</option>
          </select>
        </div>
        {(method === 'bank' || method === 'cheque') && (
          <div style={{ marginBottom: '10px' }}>
            <label style={{ fontSize: '11px', fontWeight: '700', color: '#a89478' }}>Bank Account {method === 'cheque' ? '(cheque drawn from)' : ''}</label>
            <select style={{ width: '100%', padding: '9px 12px', border: '1.5px solid #e7dfd3', borderRadius: '8px', fontSize: '13px', boxSizing: 'border-box' }} value={bankAccountId} onChange={e => setBankAccountId(e.target.value)}>
              <option value="">Select...</option>
              {bankAccounts.map(b => <option key={b.id} value={b.id}>{b.name}{b.bank_name ? ` — ${b.bank_name}` : ''}</option>)}
            </select>
          </div>
        )}
        {method === 'cheque' && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginBottom: '10px' }}>
            <div>
              <label style={{ fontSize: '11px', fontWeight: '700', color: '#a89478' }}>Cheque No</label>
              <input style={{ width: '100%', padding: '9px 12px', border: '1.5px solid #e7dfd3', borderRadius: '8px', fontSize: '13px', boxSizing: 'border-box' }} value={chequeNo} onChange={e => setChequeNo(e.target.value)} />
            </div>
            <div>
              <label style={{ fontSize: '11px', fontWeight: '700', color: '#a89478' }}>Cheque Date</label>
              <input type="date" style={{ width: '100%', padding: '9px 12px', border: '1.5px solid #e7dfd3', borderRadius: '8px', fontSize: '13px', boxSizing: 'border-box' }} value={chequeDate} onChange={e => setChequeDate(e.target.value)} />
            </div>
          </div>
        )}
        <div style={{ display: 'flex', gap: '10px', marginTop: '6px' }}>
          <button onClick={onClose} style={{ flex: 1, padding: '10px', background: '#f5f1ea', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: '700' }}>Cancel</button>
          <button onClick={() => {
            if ((method === 'bank' || method === 'cheque') && !bankAccountId) return toast.error('Select a bank account')
            if (method === 'cheque' && !chequeDate) return toast.error('Enter the cheque date')
            onConfirm(items, method, bankAccountId, chequeNo, chequeDate)
          }} style={{ flex: 1, padding: '10px', background: 'linear-gradient(135deg,#f0b23d,#d4881f)', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: '800' }}>
            Confirm Paid
          </button>
        </div>
      </div>
    </div>
  )
}
