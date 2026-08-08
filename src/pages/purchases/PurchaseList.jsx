import { useState, useEffect } from 'react'
import { supabase } from '../../supabase'
import { formatCurrency } from '../../lib/helpers'
import { recordBankMovement, fetchBankAccounts } from '../../lib/bank'
import { sendSMS, smsTemplates } from '../../lib/sms'
import toast from 'react-hot-toast'
import BarcodePrintModal from '../../components/BarcodePrintModal'

export default function PurchaseList({ onNewPurchase }) {
  const [purchases, setPurchases] = useState([])
  const [loading, setLoading] = useState(true)
  const [barcodePromptItems, setBarcodePromptItems] = useState(null)
  const PAGE_SIZE = 50
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [shopFilter, setShopFilter] = useState('all')
  const [shops, setShops] = useState([])
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [payingPurchase, setPayingPurchase] = useState(null)
  const [viewingPurchase, setViewingPurchase] = useState(null)
  const [viewItems, setViewItems] = useState([])
  const [payForm, setPayForm] = useState({ amount: '', payment_method: 'cash', bank_account_id: '', notes: '' })
  const [bankAccounts, setBankAccounts] = useState([])
  const [saving, setSaving] = useState(false)
  const [purchasePayments, setPurchasePayments] = useState([])

  useEffect(() => { fetchPurchases() }, [])

  async function fetchPurchases() {
    setLoading(true)
    const banks = await fetchBankAccounts()
    setBankAccounts(banks)
    const [{ data }, { data: shopsData }] = await Promise.all([
      supabase.from('purchases')
        .select('*, suppliers(name, supplier_no, phone), shops(name), purchase_payments(*)')
        .order('created_at', { ascending: false }),
      supabase.from('shops').select('*').order('name'),
    ])
    if (data) setPurchases(data)
    else toast.error('Failed to load purchases')
    setShops(shopsData || [])
    setLoading(false)
  }

  function getRemainingBalance(p) {
    const paid = (p.purchase_payments || []).reduce((s, pay) => s + pay.amount, 0)
    return Math.max(0, (p.credit_amount || 0) - paid)
  }

  async function makePayment() {
    const amt = parseFloat(payForm.amount)
    if (!amt || amt <= 0) return toast.error('Enter a valid amount')
    if (payForm.payment_method === 'bank_transfer' && !payForm.bank_account_id) return toast.error('Select a bank account')
    const remaining = getRemainingBalance(payingPurchase)
    if (remaining <= 0) return toast.error('This purchase is fully paid')
    const payAmt = Math.min(amt, remaining)
    setSaving(true)
    try {
      // Insert payment only — DO NOT update credit_amount
      await supabase.from('purchase_payments').insert({
        purchase_id: payingPurchase.id,
        amount: payAmt,
        payment_method: payForm.payment_method,
        bank_account_id: payForm.payment_method === 'bank_transfer' ? payForm.bank_account_id : null,
        notes: payForm.notes || null,
      })

      // Recompute supplier outstanding from scratch — payment already inserted above, so newOutstanding is correct
      const { data: allPurchases } = await supabase
        .from('purchases')
        .select('credit_amount, purchase_payments(amount)')
        .eq('supplier_id', payingPurchase.supplier_id)
        .eq('status', 'confirmed')
      const newOutstanding = (allPurchases || []).reduce((total, p) => {
        const paid = (p.purchase_payments || []).reduce((s, pp) => s + pp.amount, 0)
        return total + Math.max(0, (p.credit_amount || 0) - paid)
      }, 0)
      await supabase.from('suppliers').update({
        outstanding_balance: Math.max(0, newOutstanding)
      }).eq('id', payingPurchase.supplier_id)

      // Bank deduction — payment_out type does not show in cashflow bank withdrawals
      if (payForm.payment_method === 'bank_transfer' && payForm.bank_account_id) {
        await recordBankMovement({ bankAccountId: payForm.bank_account_id, direction: 'payment_out', amount: payAmt, reference: `Purchase: ${payingPurchase.purchase_no}`, notes: `Supplier: ${payingPurchase.suppliers?.name}` })
      }
      toast.success(`Payment of ${formatCurrency(payAmt)} recorded!`)
      setPayingPurchase(null)
      setPayForm({ amount: '', payment_method: 'cash', bank_account_id: '', notes: '' })
      // Send SMS to supplier with correct total outstanding
      if (payingPurchase.suppliers?.phone) {
        const msg = smsTemplates.supplierPaymentMade(
          payingPurchase.suppliers.name, payAmt, Math.max(0, newOutstanding),
          'Phonefix'
        )
        sendSMS({ to: payingPurchase.suppliers.phone, message: msg, triggeredBy: 'purchase_payment', referenceType: 'purchase', referenceId: payingPurchase.id })
          .then(({ success }) => { if (success) toast.success('SMS sent to supplier') })
      }
      fetchPurchases()
    } catch (e) { toast.error('Error: ' + e.message) }
    setSaving(false)
  }

  async function deletePurchase(id) {
    if (!window.confirm('Delete this draft purchase?')) return
    const { error } = await supabase.from('purchases').delete().eq('id', id)
    if (error) toast.error('Failed to delete')
    else { toast.success('Draft deleted'); fetchPurchases() }
  }

  async function cancelPurchase(p) {
    if (!window.confirm(`Cancel purchase ${p.purchase_no}? This will reverse all stock, supplier balance and bank impacts.`)) return
    try {
      // 1. Delete inventory batches added by this purchase (time window ±60s), then recompute stock_quantity
      const { data: lines } = await supabase.from('purchase_items').select('item_id, quantity, is_free_issue').eq('purchase_id', p.id)
      await supabase.from('inventory').delete().eq('shop_id', p.shop_id)
        .gte('created_at', new Date(new Date(p.created_at).getTime() - 60000).toISOString())
        .lte('created_at', new Date(new Date(p.created_at).getTime() + 60000).toISOString())
      for (const line of (lines || [])) {
        if (line.is_free_issue) continue
        const { data: allBatches } = await supabase.from('inventory').select('quantity').eq('item_id', line.item_id)
        const newTotal = (allBatches || []).reduce((s, b) => s + (b.quantity || 0), 0)
        await supabase.from('items').update({ stock_quantity: newTotal }).eq('id', line.item_id)
      }

      // 2. Reverse supplier outstanding
      if ((p.credit_amount || 0) > 0) {
        const { data: sup } = await supabase.from('suppliers').select('outstanding_balance').eq('id', p.supplier_id).single()
        await supabase.from('suppliers').update({ outstanding_balance: Math.max(0, (sup?.outstanding_balance || 0) - p.credit_amount) }).eq('id', p.supplier_id)
      }

      // 3. Reverse bank payments already made on this purchase
      const { data: payments } = await supabase.from('purchase_payments').select('*').eq('purchase_id', p.id)
      for (const pay of (payments || [])) {
        if (pay.payment_method === 'bank_transfer' && pay.bank_account_id) {
          const { data: acc } = await supabase.from('bank_accounts').select('balance').eq('id', pay.bank_account_id).single()
          await supabase.from('bank_accounts').update({ balance: (acc?.balance || 0) + pay.amount }).eq('id', pay.bank_account_id)
          await supabase.from('bank_transactions').delete().eq('bank_account_id', pay.bank_account_id).ilike('reference', `Purchase: ${p.purchase_no}`)
        }
      }

      // 4. Cancel the purchase
      await supabase.from('purchases').update({ status: 'cancelled' }).eq('id', p.id)
      toast.success(`Purchase ${p.purchase_no} cancelled and all impacts reversed.`)
      fetchPurchases()
    } catch (e) { toast.error('Failed: ' + e.message) }
  }

  const filtered = purchases.filter(p => {
    const matchSearch =
      p.purchase_no?.toLowerCase().includes(search.toLowerCase()) ||
      p.suppliers?.name?.toLowerCase().includes(search.toLowerCase())
    const matchStatus = statusFilter === 'all' || p.status === statusFilter
    const matchShop = shopFilter === 'all' || p.shop_id === shopFilter
    const matchFrom = !dateFrom || new Date(p.created_at) >= new Date(dateFrom)
    const matchTo = !dateTo || new Date(p.created_at) <= new Date(dateTo + 'T23:59:59')
    return matchSearch && matchStatus && matchShop && matchFrom && matchTo
  })
  const filteredPaged = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)
  const totalPages = Math.ceil(filtered.length / PAGE_SIZE)

  const totalValue = filtered.filter(p => p.status !== 'cancelled').reduce((s, p) => s + (p.total || 0), 0)
  const totalCredit = filtered.filter(p => p.status !== 'cancelled').reduce((s, p) => s + getRemainingBalance(p), 0)

  const statusBadge = (status) => {
    const map = {
      draft: { bg: '#fef3c7', color: '#92400e', label: 'Draft' },
      confirmed: { bg: '#dcfce7', color: '#166534', label: 'Confirmed' },
      cancelled: { bg: '#fee2e2', color: '#991b1b', label: 'Cancelled' },
    }
    const s = map[status] || map.draft
    return <span style={{ background: s.bg, color: s.color, padding: '3px 10px', borderRadius: '20px', fontSize: '12px', fontWeight: '700' }}>{s.label}</span>
  }

  const inp = { padding: '9px 12px', border: '1.5px solid #e2e8f0', borderRadius: '7px', fontSize: '14px', outline: 'none', background: 'white' }
  const lbl = { display: 'block', marginBottom: '5px', fontSize: '11px', fontWeight: '700', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.06em' }
  const inpFull = { ...inp, width: '100%', boxSizing: 'border-box' }

  return (
    <div>
      {/* Purchase Detail Modal */}
      {viewingPurchase && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 1001, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          onClick={e => { if (e.target === e.currentTarget) { setViewingPurchase(null); setViewItems([]) } }}>
          <div style={{ background: 'white', borderRadius: '16px', padding: '28px', width: '620px', maxHeight: '85vh', overflowY: 'auto', boxShadow: '0 20px 60px rgba(0,0,0,0.3)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '20px' }}>
              <div>
                <h2 style={{ fontSize: '18px', fontWeight: '800', color: '#0f172a', margin: '0 0 4px' }}>{viewingPurchase.purchase_no}</h2>
                <p style={{ fontSize: '13px', color: '#64748b', margin: 0 }}>
                  {viewingPurchase.suppliers?.name} · {new Date(viewingPurchase.created_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' })}
                </p>
              </div>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button onClick={() => setBarcodePromptItems(viewItems.map(li => ({
                  id: li.item_id, name: li.items?.name || li.item_name || 'Item',
                  barcode: li.items?.barcode || null, selling_price: li.items?.selling_price || 0,
                  qty: li.quantity,
                })))}
                  style={{ background: 'linear-gradient(135deg,#2563eb,#1d4ed8)', border: 'none', borderRadius: '10px', padding: '7px 14px', cursor: 'pointer', color: 'white', fontWeight: '700', fontSize: '13px' }}>
                  🖨 Print Barcodes
                </button>
                <button onClick={() => { setViewingPurchase(null); setViewItems([]) }}
                  style={{ background: '#f1f5f9', border: 'none', borderRadius: '10px', padding: '7px 14px', cursor: 'pointer', color: '#64748b', fontWeight: '600' }}>✕ Close</button>
              </div>
            </div>
            {/* Items table */}
            <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '16px' }}>
              <thead>
                <tr style={{ background: '#f8fafc', borderBottom: '2px solid #e2e8f0' }}>
                  {['Item','Immi No','Qty','Unit Cost','Selling Price','Line Total'].map(h => (
                    <th key={h} style={{ padding: '8px 12px', textAlign: 'left', fontSize: '11px', fontWeight: '700', color: '#94a3b8', textTransform: 'uppercase' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {viewItems.map((li, i) => (
                  <tr key={li.id || i} style={{ borderBottom: '1px solid #f1f5f9', background: i % 2 === 0 ? 'white' : '#fafafa' }}>
                    <td style={{ padding: '9px 12px', fontWeight: '600', color: '#0f172a' }}>{li.items?.name || li.item_name || '—'}</td>
                    <td style={{ padding: '9px 12px', fontSize: '12px', color: li.immi_no ? '#2563eb' : '#cbd5e1', fontWeight: li.immi_no ? '700' : '400', fontFamily: 'monospace' }}>{li.immi_no || '—'}</td>
                    <td style={{ padding: '9px 12px', color: '#64748b' }}>{li.quantity}</td>
                    <td style={{ padding: '9px 12px', fontWeight: '700', color: '#e11d48' }}>{formatCurrency(li.unit_cost)}</td>
                    <td style={{ padding: '9px 12px', color: '#64748b' }}>{li.selling_price ? formatCurrency(li.selling_price) : '—'}</td>
                    <td style={{ padding: '9px 12px', fontWeight: '700', color: '#0f172a' }}>{formatCurrency(li.quantity * li.unit_cost)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {/* Summary */}
            <div style={{ background: '#f8fafc', borderRadius: '10px', padding: '14px 16px', marginBottom: '16px' }}>
              {(() => {
                const totalPaid = (viewingPurchase.purchase_payments || []).reduce((s, p) => s + p.amount, 0) + (viewingPurchase.amount_paid || 0)
                const remaining = Math.max(0, (viewingPurchase.credit_amount || 0) - (viewingPurchase.purchase_payments || []).reduce((s, p) => s + p.amount, 0))
                return [
                  { l: 'Total', v: formatCurrency(viewingPurchase.total), bold: true },
                  { l: 'Paid', v: formatCurrency(totalPaid), color: '#059669' },
                  { l: 'Balance Due', v: remaining > 0 ? formatCurrency(remaining) : '✓ Fully Paid', color: remaining > 0 ? '#e11d48' : '#059669' },
                  { l: 'Payment Method', v: viewingPurchase.payment_method?.replace('_', ' ') || '—' },
                  { l: 'Shop', v: viewingPurchase.shops?.name || '—' },
                ].map(row => (
                  <div key={row.l} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', fontSize: row.bold ? '15px' : '13px', fontWeight: row.bold ? '800' : '600', color: row.color || '#0f172a', textTransform: 'capitalize' }}>
                    <span style={{ color: '#64748b', fontWeight: '500', fontSize: '13px', textTransform: 'none' }}>{row.l}</span>
                    <span>{row.v}</span>
                  </div>
                ))
              })()}
            </div>
            {/* Payment history */}
            {(viewingPurchase.purchase_payments || []).length > 0 && (
              <div>
                <h3 style={{ fontSize: '13px', fontWeight: '700', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '8px' }}>Payment History</h3>
                {[...viewingPurchase.purchase_payments].sort((a, b) => new Date(a.created_at) - new Date(b.created_at)).map((p, i) => (
                  <div key={p.id || i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 12px', background: i % 2 === 0 ? '#f8fafc' : 'white', borderRadius: '6px', marginBottom: '4px', fontSize: '13px' }}>
                    <div>
                      <span style={{ fontWeight: '600', color: '#0f172a' }}>{new Date(p.created_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}</span>
                      <span style={{ marginLeft: '8px', color: '#64748b', textTransform: 'capitalize' }}>{p.payment_method?.replace('_', ' ') || 'cash'}</span>
                      {p.notes && <span style={{ marginLeft: '8px', color: '#94a3b8', fontSize: '12px' }}>{p.notes}</span>}
                    </div>
                    <span style={{ fontWeight: '800', color: '#e11d48' }}>{formatCurrency(p.amount)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Payment Modal */}
      {payingPurchase && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ background: 'white', borderRadius: '16px', padding: '28px', width: '420px', boxShadow: '0 20px 60px rgba(0,0,0,0.3)' }}>
            <h2 style={{ fontSize: '17px', fontWeight: '700', color: '#0f172a', margin: '0 0 4px' }}>Make Payment</h2>
            <p style={{ fontSize: '13px', color: '#64748b', margin: '0 0 4px' }}>{payingPurchase.purchase_no} · {payingPurchase.suppliers?.name}</p>
            <p style={{ fontSize: '13px', margin: '0 0 18px' }}>
              Remaining: <strong style={{ color: '#e11d48' }}>{formatCurrency(getRemainingBalance(payingPurchase))}</strong>
            </p>

            {/* Payment history for this purchase */}
            {(payingPurchase.purchase_payments || []).length > 0 && (
              <div style={{ background: '#f8fafc', borderRadius: '10px', padding: '10px 12px', marginBottom: '14px', fontSize: '12px' }}>
                <div style={{ fontWeight: '700', color: '#64748b', marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Previous Payments</div>
                {(payingPurchase.purchase_payments || []).map((pp, i) => (
                  <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0', color: '#64748b' }}>
                    <span>{new Date(pp.created_at).toLocaleDateString('en-GB')}</span>
                    <span style={{ fontWeight: '700', color: '#059669' }}>{formatCurrency(pp.amount)}</span>
                  </div>
                ))}
              </div>
            )}

            <div style={{ marginBottom: '14px' }}>
              <label style={lbl}>Amount (LKR) *</label>
              <input type="number" value={payForm.amount} onChange={e => setPayForm(p => ({ ...p, amount: e.target.value }))}
                onFocus={e => e.target.select()} placeholder={getRemainingBalance(payingPurchase).toFixed(2)}
                style={{ ...inpFull, fontSize: '20px', fontWeight: '800' }} autoFocus />
            </div>
            <div style={{ marginBottom: '14px' }}>
              <label style={lbl}>Payment Method</label>
              <div style={{ display: 'flex', gap: '8px' }}>
                {['cash','bank_transfer','card','cheque'].map(m => (
                  <button key={m} onClick={() => setPayForm(p => ({ ...p, payment_method: m, bank_account_id: '' }))}
                    style={{ flex: 1, padding: '7px 4px', borderRadius: '7px', border: `2px solid ${payForm.payment_method === m ? '#2563eb' : '#e2e8f0'}`, background: payForm.payment_method === m ? '#eef2ff' : 'white', cursor: 'pointer', fontSize: '11px', fontWeight: '700', color: payForm.payment_method === m ? '#1e40af' : '#64748b' }}>
                    {m === 'cash' ? '💵 Cash' : m === 'bank_transfer' ? '🏦 Bank' : m === 'card' ? '💳 Card' : '🧾 Cheque'}
                  </button>
                ))}
              </div>
            </div>
            {payForm.payment_method === 'bank_transfer' && (
              <div style={{ marginBottom: '14px' }}>
                <label style={lbl}>Bank Account *</label>
                <select value={payForm.bank_account_id} onChange={e => setPayForm(p => ({ ...p, bank_account_id: e.target.value }))}
                  style={{ ...inpFull, borderColor: !payForm.bank_account_id ? '#fca5a5' : '#e2e8f0' }}>
                  <option value="">— Select account —</option>
                  {bankAccounts.map(b => <option key={b.id} value={b.id}>{b.name} — {b.bank_name} (LKR {(b.balance||0).toLocaleString('en-LK',{minimumFractionDigits:2})})</option>)}
                </select>
              </div>
            )}
            <div style={{ marginBottom: '18px' }}>
              <label style={lbl}>Notes</label>
              <input type="text" value={payForm.notes} onChange={e => setPayForm(p => ({ ...p, notes: e.target.value }))} placeholder="Optional" style={inpFull} />
            </div>
            <div style={{ display: 'flex', gap: '10px' }}>
              <button onClick={() => { setPayingPurchase(null); setPayForm({ amount: '', payment_method: 'cash', bank_account_id: '', notes: '' }) }}
                style={{ flex: 1, padding: '11px', background: '#f1f5f9', color: '#475569', border: 'none', borderRadius: '10px', cursor: 'pointer', fontWeight: '600' }}>Cancel</button>
              <button onClick={makePayment} disabled={saving}
                style={{ flex: 2, padding: '11px', background: saving ? '#93c5fd' : 'linear-gradient(135deg,#2563eb,#1d4ed8)', color: 'white', border: 'none', borderRadius: '10px', cursor: 'pointer', fontWeight: '700', fontSize: '14px' }}>
                {saving ? 'Saving...' : '✓ Record Payment'}
              </button>
            </div>
          </div>
        </div>
      )}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '24px' }}>
        <div>
          <h1 style={{ fontSize: '22px', fontWeight: '700', color: '#0f172a', margin: '0 0 4px' }}>Purchases</h1>
          <p style={{ color: '#64748b', fontSize: '14px', margin: 0 }}>{filtered.length} purchase order{filtered.length !== 1 ? 's' : ''}</p>
        </div>
        <button onClick={onNewPurchase}
          style={{ padding: '10px 24px', background: 'linear-gradient(135deg,#2563eb,#1d4ed8)', color: 'white', border: 'none', borderRadius: '10px', cursor: 'pointer', fontWeight: '700', fontSize: '14px' }}>
          + New Purchase
        </button>
      </div>

      {/* Summary cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: '16px', marginBottom: '24px' }}>
        {[
          { label: 'Total Value', value: formatCurrency(totalValue), color: '#1e40af' },
          { label: 'Payable to Suppliers', value: formatCurrency(totalCredit), color: '#e11d48' },
          { label: 'Draft Orders', value: purchases.filter(p => p.status === 'draft').length, color: '#d97706' },
        ].map(s => (
          <div key={s.label} style={{ background: 'white', borderRadius: '12px', padding: '20px', boxShadow: '0 1px 3px rgba(15,23,42,0.06), 0 1px 2px rgba(15,23,42,0.04)', borderLeft: `4px solid ${s.color}` }}>
            <div style={{ fontSize: '12px', fontWeight: '700', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '6px' }}>{s.label}</div>
            <div style={{ fontSize: '22px', fontWeight: '800', color: s.color }}>{s.value}</div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div style={{ background: 'white', borderRadius: '12px', padding: '16px 20px', boxShadow: '0 1px 3px rgba(15,23,42,0.06), 0 1px 2px rgba(15,23,42,0.04)', marginBottom: '16px', display: 'flex', gap: '12px', flexWrap: 'wrap', alignItems: 'center' }}>
        <input type="text" placeholder="Search purchase no, supplier…" value={search}
          onChange={e => setSearch(e.target.value)} style={{ ...inp, flex: 1, minWidth: '200px' }} />
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} style={inp}>
          <option value="all">All Status</option>
          <option value="draft">Draft</option>
          <option value="confirmed">Confirmed</option>
          <option value="cancelled">Cancelled</option>
        </select>
        <select value={shopFilter} onChange={e => setShopFilter(e.target.value)} style={inp}>
          <option value="all">All Shops</option>
          {shops.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} style={inp} />
        <span style={{ color: '#94a3b8', fontSize: '13px' }}>to</span>
        <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} style={inp} />
        {(search || statusFilter !== 'all' || shopFilter !== 'all' || dateFrom || dateTo) && (
          <button onClick={() => { setSearch(''); setStatusFilter('all'); setShopFilter('all'); setDateFrom(''); setDateTo('') }}
            style={{ padding: '9px 16px', background: '#f1f5f9', color: '#64748b', border: 'none', borderRadius: '7px', cursor: 'pointer', fontSize: '13px', fontWeight: '600' }}>
            Clear
          </button>
        )}
      </div>

      {/* Table */}
      <div style={{ background: 'white', borderRadius: '12px', boxShadow: '0 1px 3px rgba(15,23,42,0.06), 0 1px 2px rgba(15,23,42,0.04)', overflow: 'hidden' }}>
        {loading ? (
          <div style={{ padding: '60px', textAlign: 'center', color: '#94a3b8' }}>Loading...</div>
        ) : filtered.length === 0 ? (
          <div style={{ padding: '60px', textAlign: 'center', color: '#94a3b8' }}>
            <div style={{ fontSize: '36px', marginBottom: '12px' }}>🛒</div>
            No purchases found
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: '#f8fafc', borderBottom: '2px solid #e2e8f0' }}>
                {['Purchase No', 'Date', 'Supplier', 'Shop', 'Total', 'Payment', 'Payable', 'Status', 'Actions'].map(h => (
                  <th key={h} style={{ padding: '11px 14px', textAlign: 'left', fontSize: '11px', fontWeight: '700', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.06em', whiteSpace: 'nowrap' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filteredPaged.map((p, i) => (
                <tr key={p.id} style={{ borderBottom: '1px solid #f1f5f9', background: i % 2 === 0 ? 'white' : '#fafafa', cursor: 'pointer' }}
                  onMouseEnter={e => e.currentTarget.style.background = '#f0f9ff'}
                  onMouseLeave={e => e.currentTarget.style.background = i % 2 === 0 ? 'white' : '#fafafa'}
                  onClick={async () => {
                    const [{ data: items }, { data: freshP }] = await Promise.all([
                      supabase.from('purchase_items').select('*, items(name, item_no, barcode, selling_price)').eq('purchase_id', p.id),
                      supabase.from('purchases').select('*, purchase_payments(*), suppliers(name, supplier_no), shops(name)').eq('id', p.id).single(),
                    ])
                    setViewItems(items || [])
                    setViewingPurchase(freshP || p)
                  }}>
                  <td style={{ padding: '12px 14px', fontWeight: '700', color: '#2563eb', fontSize: '13px' }}>{p.purchase_no}</td>
                  <td style={{ padding: '12px 14px', fontSize: '13px', color: '#64748b', whiteSpace: 'nowrap' }}>
                    {new Date(p.created_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}
                  </td>
                  <td style={{ padding: '12px 14px' }}>
                    <div style={{ fontSize: '14px', fontWeight: '600', color: '#0f172a' }}>{p.suppliers?.name || '—'}</div>
                    <div style={{ fontSize: '12px', color: '#94a3b8' }}>{p.suppliers?.supplier_no}</div>
                  </td>
                  <td style={{ padding: '12px 14px', fontSize: '13px', color: '#64748b' }}>{p.shops?.name || '—'}</td>
                  <td style={{ padding: '12px 14px', fontSize: '14px', fontWeight: '700', color: '#0f172a' }}>{formatCurrency(p.total)}</td>
                  <td style={{ padding: '12px 14px', fontSize: '13px', color: '#64748b', textTransform: 'capitalize' }}>{p.payment_method?.replace('_', ' ')}</td>
                  <td style={{ padding: '12px 14px', fontSize: '13px', fontWeight: '700', color: getRemainingBalance(p) > 0 ? '#e11d48' : '#94a3b8' }}>
                    {getRemainingBalance(p) > 0 ? formatCurrency(getRemainingBalance(p)) : '✓ Paid'}
                  </td>
                  <td style={{ padding: '12px 14px' }}>{statusBadge(p.status)}</td>
                  <td style={{ padding: '12px 14px', display: 'flex', gap: '6px' }} onClick={e => e.stopPropagation()}>
                    {p.status === 'confirmed' && getRemainingBalance(p) > 0 && (
                      <button onClick={() => setPayingPurchase(p)}
                        style={{ padding: '5px 10px', background: '#dcfce7', color: '#059669', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '12px', fontWeight: '700', whiteSpace: 'nowrap' }}>
                        💰 Pay
                      </button>
                    )}
                    {p.status === 'confirmed' && (
                      <button onClick={() => cancelPurchase(p)}
                        style={{ padding: '5px 10px', background: '#fef3c7', color: '#92400e', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '12px', fontWeight: '700', whiteSpace: 'nowrap' }}>
                        ✕ Cancel
                      </button>
                    )}
                    {p.status === 'draft' && (
                      <button onClick={() => deletePurchase(p.id)}
                        style={{ padding: '5px 10px', background: '#fee2e2', color: '#dc2626', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '12px', fontWeight: '700' }}>
                        🗑 Delete
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {barcodePromptItems && (
        <BarcodePrintModal
          items={barcodePromptItems}
          defaultQty={Object.fromEntries(barcodePromptItems.map(i => [i.id, i.qty]))}
          onClose={() => setBarcodePromptItems(null)}
        />
      )}
    </div>
  )
}
