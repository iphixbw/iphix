import { useState, useEffect } from 'react'
import { supabase } from '../../supabase'
import { formatCurrency } from '../../lib/helpers'
import { recordBankMovement, fetchBankAccounts } from '../../lib/bank'
import toast from 'react-hot-toast'

export default function ProcurementInbox({ activeShop, session }) {
  const [records, setRecords] = useState([])
  const [loading, setLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState('pending')
  const [supplierFilter, setSupplierFilter] = useState('')
  const [suppliers, setSuppliers] = useState([])
  const [settlingId, setSettlingId] = useState(null)
  const [settleForm, setSettleForm] = useState({ cost_price: '', payment_status: 'paid', payment_method: 'cash', bank_account_id: '', notes: '' })
  const [savingSettle, setSavingSettle] = useState(false)
  const [bankAccounts, setBankAccounts] = useState([])
  const [editingCost, setEditingCost] = useState({})
  const [assigningSupplier, setAssigningSupplier] = useState({}) // { id: supplierName }

  useEffect(() => { fetchData() }, [activeShop?.id, statusFilter])

  async function fetchData() {
    setLoading(true)
    let q = supabase.from('third_party_procurement')
      .select('*, invoices(invoice_no, created_at, customers(name, customer_no))')
      .order('created_at', { ascending: false })
    if (statusFilter !== 'all') q = q.eq('payment_status', statusFilter)
    if (activeShop?.id) q = q.eq('shop_id', activeShop.id)
    const { data, error } = await q
    if (error) toast.error('Failed to load')
    else setRecords(data || [])

    const { data: sup } = await supabase.from('third_party_suppliers').select('name').order('use_count', { ascending: false })
    setSuppliers([...new Set((sup || []).map(s => s.name))])
    const banks = await fetchBankAccounts()
    setBankAccounts(banks)
    setLoading(false)
  }

  async function saveSupplierAssignment(rec, supplierName) {
    if (!supplierName?.trim()) return toast.error('Enter a supplier name')
    try {
      await supabase.from('third_party_procurement').update({ supplier_name: supplierName.trim() }).eq('id', rec.id)
      // Also upsert into third_party_suppliers for future autocomplete
      const { data: existing } = await supabase.from('third_party_suppliers').select('id, use_count').eq('name', supplierName.trim()).single()
      if (existing) {
        await supabase.from('third_party_suppliers').update({ use_count: (existing.use_count || 1) + 1 }).eq('id', existing.id)
      } else {
        await supabase.from('third_party_suppliers').insert({ name: supplierName.trim() })
      }
      toast.success('Supplier assigned!')
      setAssigningSupplier(prev => { const n = { ...prev }; delete n[rec.id]; return n })
      fetchData()
    } catch (e) { toast.error('Failed: ' + e.message) }
  }

  async function markSettled(rec) {
    if (!settleForm.cost_price) return toast.error('Enter cost price paid to supplier')
    setSavingSettle(true)
    try {
      await supabase.from('third_party_procurement').update({
        cost_price: parseFloat(settleForm.cost_price),
        payment_status: settleForm.payment_status,
        payment_method: settleForm.payment_method,
        notes: settleForm.notes || null,
        paid_at: settleForm.payment_status === 'paid' ? new Date().toISOString() : null,
      }).eq('id', rec.id)

      // Bank transfer — deduct from selected account
      if (settleForm.payment_status === 'paid' && settleForm.payment_method === 'bank_transfer' && settleForm.bank_account_id) {
        await recordBankMovement({
          bankAccountId: settleForm.bank_account_id,
          direction: 'withdrawal',
          amount: parseFloat(settleForm.cost_price),
          reference: `3rd Party: ${rec.item_name}`,
          notes: `Supplier: ${rec.supplier_name || '—'} · ${rec.invoices?.invoice_no || ''}`,
        })
      }

      // Update supplier last used
      if (rec.supplier_name) {
        await supabase.from('third_party_suppliers').update({ last_used_at: new Date().toISOString() }).eq('name', rec.supplier_name)
      }

      toast.success(settleForm.payment_status === 'paid' ? 'Marked as paid!' : 'Updated!')
      setSettlingId(null)
      setSettleForm({ cost_price: '', payment_status: 'paid', payment_method: 'cash', notes: '' })
      fetchData()
    } catch (e) { toast.error('Failed: ' + e.message) }
    setSavingSettle(false)
  }

  // Group records by supplier
  const filtered = records.filter(r => !supplierFilter || r.supplier_name === supplierFilter)

  const groupedBySupplier = filtered.reduce((acc, r) => {
    const key = r.supplier_name || 'Unknown Supplier'
    if (!acc[key]) acc[key] = []
    acc[key].push(r)
    return acc
  }, {})

  const totalOwed = filtered.filter(r => r.payment_status === 'pending').reduce((s, r) => {
    // Use cost_price if set, else estimate from selling_price
    return s + ((r.cost_price || r.selling_price || 0) * r.quantity)
  }, 0)

  const inp = { width: '100%', padding: '8px 10px', border: '1.5px solid #e2e8f0', borderRadius: '7px', fontSize: '13px', boxSizing: 'border-box', outline: 'none', background: 'white' }
  const lbl = { display: 'block', marginBottom: '4px', fontSize: '11px', fontWeight: '700', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.06em' }

  return (
    <div>
      <div style={{ marginBottom: '24px' }}>
        <h1 style={{ fontSize: '22px', fontWeight: '700', color: '#0f172a', margin: '0 0 4px' }}>3rd Party Procurement</h1>
        <p style={{ color: '#64748b', fontSize: '14px', margin: 0 }}>Track items sourced from external suppliers</p>
      </div>

      {/* Summary cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: '16px', marginBottom: '24px' }}>
        {[
          { label: 'Pending Payment', value: records.filter(r => r.payment_status === 'pending').length, color: '#f59e0b', sub: 'items to settle' },
          { label: 'Total Owed', value: formatCurrency(totalOwed), color: '#e11d48', sub: 'estimated from cost/selling' },
          { label: 'Paid This Month', value: records.filter(r => r.payment_status === 'paid' && r.paid_at && new Date(r.paid_at) > new Date(new Date().getFullYear(), new Date().getMonth(), 1)).length, color: '#059669', sub: 'settled' },
          { label: 'Total Suppliers', value: suppliers.length, color: '#2563eb', sub: 'tracked' },
        ].map(s => (
          <div key={s.label} style={{ background: 'white', borderRadius: '12px', padding: '18px', boxShadow: '0 1px 3px rgba(15,23,42,0.06), 0 1px 2px rgba(15,23,42,0.04)', borderLeft: `4px solid ${s.color}` }}>
            <div style={{ fontSize: '11px', fontWeight: '700', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '6px' }}>{s.label}</div>
            <div style={{ fontSize: '18px', fontWeight: '800', color: s.color }}>{s.value}</div>
            <div style={{ fontSize: '11px', color: '#94a3b8', marginTop: '2px' }}>{s.sub}</div>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div style={{ background: 'white', borderRadius: '12px', padding: '14px 18px', boxShadow: '0 1px 3px rgba(15,23,42,0.06), 0 1px 2px rgba(15,23,42,0.04)', marginBottom: '16px', display: 'flex', gap: '12px', flexWrap: 'wrap', alignItems: 'center' }}>
        {[
          { id: 'pending', label: '⏳ Pending' },
          { id: 'paid', label: '✓ Paid' },
          { id: 'all', label: 'All' },
        ].map(f => (
          <button key={f.id} onClick={() => setStatusFilter(f.id)}
            style={{ padding: '6px 16px', borderRadius: '20px', border: 'none', cursor: 'pointer', fontSize: '13px', fontWeight: '600', background: statusFilter === f.id ? '#0f172a' : '#f1f5f9', color: statusFilter === f.id ? 'white' : '#64748b' }}>
            {f.label}
          </button>
        ))}
        <select value={supplierFilter} onChange={e => setSupplierFilter(e.target.value)}
          style={{ ...inp, width: 'auto', minWidth: '180px' }}>
          <option value="">All Suppliers</option>
          {suppliers.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <button onClick={fetchData} style={{ padding: '7px 16px', background: 'linear-gradient(135deg,#2563eb,#1d4ed8)', color: 'white', border: 'none', borderRadius: '10px', cursor: 'pointer', fontWeight: '700', fontSize: '13px' }}>Refresh</button>
      </div>

      {loading ? <div style={{ padding: '60px', textAlign: 'center', color: '#94a3b8' }}>Loading...</div>
      : filtered.length === 0 ? (
        <div style={{ background: 'white', borderRadius: '12px', padding: '60px', textAlign: 'center', color: '#94a3b8', boxShadow: '0 1px 3px rgba(15,23,42,0.06), 0 1px 2px rgba(15,23,42,0.04)' }}>
          <div style={{ fontSize: '36px', marginBottom: '12px' }}>🏪</div>
          No {statusFilter === 'all' ? '' : statusFilter} procurement records found
        </div>
      ) : (
        Object.entries(groupedBySupplier).map(([supplier, items]) => {
          const supplierOwed = items.filter(r => r.payment_status === 'pending').reduce((s, r) => s + ((r.cost_price || r.selling_price || 0) * r.quantity), 0)
          return (
            <div key={supplier} style={{ background: 'white', borderRadius: '12px', boxShadow: '0 1px 3px rgba(15,23,42,0.06), 0 1px 2px rgba(15,23,42,0.04)', marginBottom: '16px', overflow: 'hidden' }}>
              {/* Supplier header */}
              <div style={{ background: 'linear-gradient(135deg,#fef3c7,#fde68a)', padding: '14px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #fde68a' }}>
                <div>
                  <div style={{ fontSize: '15px', fontWeight: '700', color: supplier === 'Unknown Supplier' ? '#7c3aed' : '#92400e' }}>
                    {supplier === 'Unknown Supplier' ? '⚠ Unknown Supplier — assign below' : `🏪 ${supplier}`}
                  </div>
                  <div style={{ fontSize: '12px', color: '#b45309', marginTop: '2px' }}>
                    {items[0]?.supplier_phone && <span>{items[0].supplier_phone} · </span>}
                    {items.length} item{items.length !== 1 ? 's' : ''}
                  </div>
                </div>
                {supplierOwed > 0 && (
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: '11px', fontWeight: '700', color: '#b45309', textTransform: 'uppercase' }}>Pending Owed</div>
                    <div style={{ fontSize: '18px', fontWeight: '800', color: '#e11d48' }}>{formatCurrency(supplierOwed)}</div>
                  </div>
                )}
              </div>

              {/* Items */}
              {items.map(rec => (
                <div key={rec.id}>
                  <div style={{ padding: '14px 20px', borderBottom: '1px solid #f1f5f9', display: 'grid', gridTemplateColumns: '1fr auto', gap: '16px', alignItems: 'start' }}>
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '4px', flexWrap: 'wrap' }}>
                        <span style={{ fontSize: '14px', fontWeight: '700', color: '#0f172a' }}>{rec.item_name}</span>
                        <span style={{ fontSize: '12px', color: '#2563eb', fontWeight: '600', background: '#eef2ff', padding: '1px 8px', borderRadius: '10px' }}>
                          {rec.invoices?.invoice_no}
                        </span>
                        <span style={{ fontSize: '11px', color: '#94a3b8' }}>
                          {new Date(rec.created_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}
                        </span>
                        <span style={{ fontSize: '11px', color: '#94a3b8' }}>
                          Customer: {rec.invoices?.customers?.name}
                        </span>
                      </div>
                      <div style={{ display: 'flex', gap: '20px', flexWrap: 'wrap' }}>
                        <div><span style={{ fontSize: '11px', color: '#94a3b8' }}>Qty</span><div style={{ fontSize: '14px', fontWeight: '700', color: '#0f172a' }}>{rec.quantity}</div></div>
                        <div><span style={{ fontSize: '11px', color: '#94a3b8' }}>Sold At</span><div style={{ fontSize: '14px', fontWeight: '700', color: '#059669' }}>{formatCurrency(rec.selling_price)}</div></div>
                        <div>
                          <span style={{ fontSize: '11px', color: '#94a3b8' }}>Cost Paid</span>
                          {rec.cost_price ? (
                            <div style={{ fontSize: '14px', fontWeight: '700', color: '#e11d48' }}>{formatCurrency(rec.cost_price)}</div>
                          ) : (
                            <div style={{ fontSize: '13px', color: '#fbbf24', fontStyle: 'italic' }}>Not entered yet</div>
                          )}
                        </div>
                        {rec.cost_price && (
                          <div>
                            <span style={{ fontSize: '11px', color: '#94a3b8' }}>Margin</span>
                            <div style={{ fontSize: '14px', fontWeight: '700', color: (rec.selling_price - rec.cost_price) >= 0 ? '#059669' : '#e11d48' }}>
                              {formatCurrency((rec.selling_price - rec.cost_price) * rec.quantity)}
                            </div>
                          </div>
                        )}
                        {rec.reference && <div><span style={{ fontSize: '11px', color: '#94a3b8' }}>Ref</span><div style={{ fontSize: '13px', color: '#64748b' }}>{rec.reference}</div></div>}
                      </div>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                      <span style={{ background: rec.payment_status === 'paid' ? '#dcfce7' : '#fef3c7', color: rec.payment_status === 'paid' ? '#166634' : '#92400e', padding: '3px 10px', borderRadius: '12px', fontSize: '11px', fontWeight: '700' }}>
                        {rec.payment_status === 'paid' ? '✓ Paid' : '⏳ Pending'}
                      </span>
                      {/* Issue 11: Assign Supplier button for unknown supplier items */}
                      {!rec.supplier_name && (
                        <button onClick={() => setAssigningSupplier(prev => ({ ...prev, [rec.id]: '' }))}
                          style={{ padding: '5px 10px', background: '#eef2ff', color: '#1e40af', border: '1.5px solid #bfdbfe', borderRadius: '7px', cursor: 'pointer', fontSize: '12px', fontWeight: '700', whiteSpace: 'nowrap' }}>
                          + Assign Supplier
                        </button>
                      )}
                      {rec.payment_status === 'pending' && (
                        <button onClick={() => { setSettlingId(rec.id); setSettleForm({ cost_price: rec.cost_price || '', payment_status: 'paid', payment_method: 'cash', notes: '' }) }}
                          style={{ padding: '5px 14px', background: 'linear-gradient(135deg,#f59e0b,#d97706)', color: 'white', border: 'none', borderRadius: '7px', cursor: 'pointer', fontSize: '12px', fontWeight: '700', whiteSpace: 'nowrap' }}>
                          Settle
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Assign Supplier inline form */}
                  {rec.id in assigningSupplier && (
                    <div style={{ padding: '12px 20px', background: '#eef2ff', borderBottom: '1px solid #bfdbfe', display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                      <span style={{ fontSize: '13px', fontWeight: '600', color: '#1e40af' }}>Assign supplier for <em>{rec.item_name}</em>:</span>
                      <input
                        type="text"
                        placeholder="Supplier name"
                        value={assigningSupplier[rec.id] || ''}
                        onChange={e => setAssigningSupplier(prev => ({ ...prev, [rec.id]: e.target.value }))}
                        list={`sup-list-${rec.id}`}
                        style={{ padding: '6px 10px', border: '1.5px solid #93c5fd', borderRadius: '6px', fontSize: '13px', outline: 'none', minWidth: '200px' }}
                        autoFocus
                      />
                      <datalist id={`sup-list-${rec.id}`}>
                        {suppliers.map(s => <option key={s} value={s} />)}
                      </datalist>
                      <button onClick={() => saveSupplierAssignment(rec, assigningSupplier[rec.id])}
                        style={{ padding: '6px 14px', background: '#2563eb', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '12px', fontWeight: '700' }}>
                        Save
                      </button>
                      <button onClick={() => setAssigningSupplier(prev => { const n = { ...prev }; delete n[rec.id]; return n })}
                        style={{ padding: '6px 10px', background: '#f1f5f9', color: '#64748b', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '12px' }}>
                        Cancel
                      </button>
                    </div>
                  )}

                  {/* Settle form */}
                  {settlingId === rec.id && (
                    <div style={{ padding: '16px 20px', background: '#fffbeb', borderBottom: '1px solid #fde68a' }}>
                      <div style={{ fontSize: '13px', fontWeight: '700', color: '#92400e', marginBottom: '12px' }}>Settle Payment — {rec.item_name}</div>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: '10px', marginBottom: '12px' }}>
                        <div>
                          <label style={lbl}>Cost Paid (LKR) *</label>
                          <input type="number" placeholder="0.00" value={settleForm.cost_price}
                            onChange={e => setSettleForm(p => ({ ...p, cost_price: e.target.value }))}
                            style={{ ...inp, borderColor: '#fde68a', fontWeight: '700', fontSize: '15px' }} autoFocus />
                        </div>
                        <div>
                          <label style={lbl}>Status</label>
                          <select value={settleForm.payment_status} onChange={e => setSettleForm(p => ({ ...p, payment_status: e.target.value }))} style={{ ...inp, borderColor: '#fde68a' }}>
                            <option value="paid">Paid Now</option>
                            <option value="pending">Still Pending (just save cost)</option>
                          </select>
                        </div>
                        <div>
                          <label style={lbl}>Payment Method</label>
                          <select value={settleForm.payment_method} onChange={e => setSettleForm(p => ({ ...p, payment_method: e.target.value, bank_account_id: '' }))} style={{ ...inp, borderColor: '#fde68a' }}>
                            <option value="cash">Cash</option>
                            <option value="bank_transfer">Bank Transfer</option>
                            <option value="credit">Deduct from Credit</option>
                          </select>
                        </div>
                        {settleForm.payment_method === 'bank_transfer' && (
                          <div style={{ gridColumn: '1/-1' }}>
                            <label style={lbl}>Bank Account * (deducted from)</label>
                            <select value={settleForm.bank_account_id} onChange={e => setSettleForm(p => ({ ...p, bank_account_id: e.target.value }))}
                              style={{ ...inp, borderColor: !settleForm.bank_account_id ? '#fca5a5' : '#fde68a' }}>
                              <option value="">— Select account —</option>
                              {bankAccounts.map(b => <option key={b.id} value={b.id}>{b.name} — {b.bank_name} (LKR {(b.balance || 0).toLocaleString('en-LK', { minimumFractionDigits: 2 })})</option>)}
                            </select>
                          </div>
                        )}
                        <div>
                          <label style={lbl}>Notes</label>
                          <input type="text" placeholder="Optional notes" value={settleForm.notes}
                            onChange={e => setSettleForm(p => ({ ...p, notes: e.target.value }))}
                            style={{ ...inp, borderColor: '#fde68a' }} />
                        </div>
                      </div>
                      {settleForm.cost_price && (
                        <div style={{ marginBottom: '10px', fontSize: '13px', color: '#059669', fontWeight: '600' }}>
                          Margin on this item: {formatCurrency((rec.selling_price - parseFloat(settleForm.cost_price)) * rec.quantity)}
                          {' '}({rec.selling_price > 0 ? (((rec.selling_price - parseFloat(settleForm.cost_price)) / rec.selling_price) * 100).toFixed(1) : 0}%)
                        </div>
                      )}
                      <div style={{ display: 'flex', gap: '8px' }}>
                        <button onClick={() => markSettled(rec)} disabled={savingSettle}
                          style={{ padding: '8px 20px', background: 'linear-gradient(135deg,#059669,#047857)', color: 'white', border: 'none', borderRadius: '7px', cursor: 'pointer', fontWeight: '700', fontSize: '13px' }}>
                          {savingSettle ? 'Saving...' : '✓ Confirm'}
                        </button>
                        <button onClick={() => setSettlingId(null)}
                          style={{ padding: '8px 16px', background: '#f1f5f9', color: '#64748b', border: 'none', borderRadius: '7px', cursor: 'pointer', fontSize: '13px' }}>
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )
        })
      )}
    </div>
  )
}
