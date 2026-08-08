import { useState, useEffect, useRef } from 'react'
import { supabase } from '../../supabase'
import { formatCurrency } from '../../lib/helpers'
import { sendSMS, smsTemplates } from '../../lib/sms'
import { recordBankMovement, fetchBankAccounts } from '../../lib/bank'
import toast from 'react-hot-toast'

async function generateReturnNo() {
  const { data, error } = await supabase.rpc('generate_return_no_purchase')
  if (error) throw error
  return data
}

export default function PurchaseReturns({ activeShop, session }) {
  const [activeTab, setActiveTab] = useState('list')
  const [returns, setReturns] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [viewingReturn, setViewingReturn] = useState(null)
  const [viewReturnItems, setViewReturnItems] = useState([])

  // Form state
  const [suppliers, setSuppliers] = useState([])
  const [items, setItems] = useState([])
  const [shops, setShops] = useState([])
  const [selectedSupplier, setSelectedSupplier] = useState(null)
  const [selectedPurchase, setSelectedPurchase] = useState(null)
  const [selectedShop, setSelectedShop] = useState(null)
  const [returnItems, setReturnItems] = useState([])
  const [paymentMethod, setPaymentMethod] = useState('credit')
  const [bankAccounts, setBankAccounts] = useState([])
  const [bankAccountId, setBankAccountId] = useState('')
  const [remarks, setRemarks] = useState('')
  const [saving, setSaving] = useState(false)

  // Dropdowns
  const [supplierSearch, setSupplierSearch] = useState('')
  const [showSupplierDrop, setShowSupplierDrop] = useState(false)
  const [purchaseSearch, setPurchaseSearch] = useState('')
  const [purchaseResults, setPurchaseResults] = useState([])
  const [showPurchaseDrop, setShowPurchaseDrop] = useState(false)
  const [itemSearch, setItemSearch] = useState('')
  const [showItemDrop, setShowItemDrop] = useState(false)
  const itemRef = useRef(null)
  const qtyRefs = useRef([])

  useEffect(() => { fetchData() }, [])

  async function fetchData() {
    setLoading(true)
    const [{ data: rets }, { data: sups }, { data: itms }, { data: sh }] = await Promise.all([
      supabase.from('purchase_returns').select('*, suppliers(name, supplier_no), shops(name)').order('created_at', { ascending: false }),
      supabase.from('suppliers').select('*').order('name'),
      supabase.from('items').select('*').order('name'),
      supabase.from('shops').select('*').order('name'),
    ])
    setReturns(rets || [])
    setSuppliers(sups || [])
    setItems(itms || [])
    setShops(sh || [])
    if (sh && sh.length > 0) setSelectedShop(activeShop || sh[0])
    const banks = await fetchBankAccounts()
    setBankAccounts(banks)
    setLoading(false)
  }

  async function searchPurchases(query) {
    if (!query.trim()) return
    const { data } = await supabase
      .from('purchases')
      .select('*, suppliers(name)')
      .eq('status', 'confirmed')
      .ilike('purchase_no', `%${query}%`)
      .limit(10)
    setPurchaseResults(data || [])
  }

  function selectPurchase(purchase) {
    setSelectedPurchase(purchase)
    setPurchaseSearch(purchase.purchase_no)
    setShowPurchaseDrop(false)
    // Auto-select supplier if not already selected
    if (!selectedSupplier && purchase.suppliers) {
      setSelectedSupplier(suppliers.find(s => s.id === purchase.supplier_id) || null)
      setSupplierSearch(purchase.suppliers.name)
    }
  }

  function addItem(item) {
    const existingIdx = returnItems.findIndex(r => r.item_id === item.id)
    setItemSearch('')
    setShowItemDrop(false)
    if (existingIdx >= 0) {
      setReturnItems(rows => rows.map((r, i) => i === existingIdx ? { ...r, quantity: r.quantity + 1 } : r))
      setTimeout(() => {
        if (qtyRefs.current[existingIdx]) { qtyRefs.current[existingIdx].focus(); qtyRefs.current[existingIdx].select() }
      }, 50)
    } else {
      setReturnItems(rows => [...rows, {
        item_id: item.id,
        name: item.name,
        item_no: item.item_no,
        quantity: 1,
        unit_cost: item.cost_price || 0,
        immi_no: '',
      }])
      setTimeout(() => {
        const lastIdx = qtyRefs.current.length - 1
        if (qtyRefs.current[lastIdx]) { qtyRefs.current[lastIdx].focus(); qtyRefs.current[lastIdx].select() }
      }, 50)
    }
  }

  function updateRow(idx, field, value) {
    setReturnItems(rows => rows.map((r, i) => i === idx ? { ...r, [field]: value } : r))
  }

  const subtotal = returnItems.reduce((s, r) => s + r.quantity * r.unit_cost, 0)

  async function saveReturn(status) {
    if (!selectedSupplier) return toast.error('Please select a supplier')
    if (returnItems.length === 0) return toast.error('Please add at least one item')
    if (!remarks.trim()) return toast.error('Remarks are required')
    setSaving(true)
    try {
      const returnNo = await generateReturnNo()

      const { data: ret, error: retErr } = await supabase.from('purchase_returns').insert({
        return_no: returnNo,
        purchase_id: selectedPurchase?.id || null,
        supplier_id: selectedSupplier.id,
        shop_id: selectedShop?.id,
        status,
        payment_method: paymentMethod,
        subtotal,
        total: subtotal,
        remarks,
        created_by: session?.user?.id,
      }).select().single()
      if (retErr) throw retErr

      await supabase.from('purchase_return_items').insert(
        returnItems.map(r => ({
          return_id: ret.id,
          item_id: r.item_id,
          quantity: r.quantity,
          unit_cost: r.unit_cost,
          line_total: r.quantity * r.unit_cost,
          immi_no: r.immi_no || null,
        }))
      )

      if (status === 'confirmed') {
        // Deduct stock — items are being returned to supplier.
        // Update both the global count AND the shop-level inventory batches —
        // Inventory.jsx treats the inventory table as the source of truth and
        // will otherwise silently undo a stock_quantity-only change.
        for (const row of returnItems) {
          const { data: item } = await supabase.from('items').select('stock_quantity, name').eq('id', row.item_id).single()
          if (item && item.stock_quantity < row.quantity) {
            toast.error(`Not enough stock to return "${item.name}". In stock: ${item.stock_quantity}`)
            // Rollback return record
            await supabase.from('purchase_returns').delete().eq('id', ret.id)
            setSaving(false)
            return
          }
          await supabase.rpc('deduct_item_stock', { p_item_id: row.item_id, p_quantity: row.quantity })
          if (selectedShop?.id) {
            const { error: invErr } = await supabase.rpc('deduct_shop_inventory', {
              p_item_id: row.item_id, p_shop_id: selectedShop.id, p_quantity: row.quantity,
            })
            if (invErr) {
              // Shop inventory didn't have enough batches to cover it — reverse the global
              // deduction we just made so the two stay in sync, then abort with a clear error.
              await supabase.rpc('add_item_stock', { p_item_id: row.item_id, p_quantity: row.quantity })
              toast.error(`Not enough stock at ${selectedShop.name} to return "${item?.name || 'item'}"`)
              await supabase.from('purchase_returns').delete().eq('id', ret.id)
              setSaving(false)
              return
            }
          }
        }

        // Reduce supplier outstanding balance — goods are returned regardless of payment method
        // 'credit' = deducted from what we owe; 'cash'/'bank' = we receive money back
        // Atomically reduce supplier outstanding balance (negative delta = reduction)
        await supabase.rpc('adjust_supplier_balance', { p_supplier_id: selectedSupplier.id, p_delta: -subtotal })

        // Cash refund from supplier — adds to cash in hand (visible in Cashflow Cash In)
        if (paymentMethod === 'cash') {
          await supabase.from('cash_deposits').insert({
            amount: subtotal,
            shop_id: selectedShop?.id,
            notes: `Supplier cash refund: ${selectedSupplier.name} · ${returnNo}`,
          })
        }

        // Bank transfer refund — credits the selected bank account
        if (paymentMethod === 'bank' && bankAccountId) {
          await recordBankMovement({
            bankAccountId,
            direction: 'deposit',
            amount: subtotal,
            reference: `Purchase Return: ${returnNo}`,
            notes: `Supplier refund: ${selectedSupplier.name} · Bank Transfer`,
          })
        }
      }

      toast.success(status === 'draft' ? 'Saved as draft' : 'Purchase return confirmed!')

      // Auto-send SMS to supplier if confirmed and has phone
      if (status === 'confirmed' && selectedSupplier.phone) {
        const { data: updatedSupplier } = await supabase.from('suppliers').select('outstanding_balance').eq('id', selectedSupplier.id).single()
        const newOutstanding = updatedSupplier?.outstanding_balance || 0
        const message = smsTemplates.purchaseReturnConfirmed(
          selectedSupplier.name, returnNo, subtotal, newOutstanding,
          activeShop?.name || 'Phonefix'
        )
        sendSMS({
          to: selectedSupplier.phone,
          message,
          triggeredBy: 'purchase_return',
          referenceType: 'purchase_return',
          referenceId: ret.id,
        }).then(({ success }) => {
          if (success) toast.success('SMS sent to supplier!')
        })
      }

      resetForm()
      setActiveTab('list')
      fetchData()
    } catch (e) { toast.error('Error: ' + e.message) }
    setSaving(false)
  }

  function resetForm() {
    setSelectedSupplier(null); setSelectedPurchase(null)
    setReturnItems([]); setPaymentMethod('credit'); setRemarks(''); setBankAccountId('')
    setSupplierSearch(''); setPurchaseSearch(''); setPurchaseResults([])
  }

  async function cancelReturn(r) {
    if (!window.confirm(`Cancel return ${r.return_no}? This will reverse all stock, supplier balance and bank impacts.`)) return
    try {
      // 1. Add stock back — global count AND shop inventory batches (mirrors the
      // deduction done on confirm, so the two stay in sync)
      const { data: lines } = await supabase.from('purchase_return_items').select('item_id, quantity, unit_cost').eq('return_id', r.id)
      for (const line of (lines || [])) {
        await supabase.rpc('add_item_stock', { p_item_id: line.item_id, p_quantity: line.quantity })
        if (r.shop_id) {
          await supabase.from('inventory').insert({
            item_id: line.item_id,
            shop_id: r.shop_id,
            quantity: line.quantity,
            cost_price: line.unit_cost || 0,
            received_at: new Date().toISOString(),
            notes: `Cancelled purchase return: ${r.return_no}`,
          })
        }
      }
      // 2. Restore supplier outstanding if was credit
      if (r.payment_method === 'credit' || !r.payment_method) {
        // Atomically restore supplier outstanding balance on cancel
        await supabase.rpc('adjust_supplier_balance', { p_supplier_id: r.supplier_id, p_delta: r.total })
      }
      // 3. Reverse cash deposit if was cash refund
      if (r.payment_method === 'cash') {
        await supabase.from('cash_deposits').delete().eq('shop_id', r.shop_id).ilike('notes', `%${r.return_no}%`)
      }
      // 4. Reverse bank credit if bank transfer
      if (r.payment_method === 'bank' && r.bank_account_id) {
        const { data: acc } = await supabase.from('bank_accounts').select('balance').eq('id', r.bank_account_id).single()
        await supabase.from('bank_accounts').update({ balance: Math.max(0, (acc?.balance || 0) - r.total) }).eq('id', r.bank_account_id)
        await supabase.from('bank_transactions').delete().eq('bank_account_id', r.bank_account_id).ilike('reference', `Purchase Return: ${r.return_no}`)
      }
      await supabase.from('purchase_returns').update({ status: 'cancelled' }).eq('id', r.id)
      toast.success(`Return ${r.return_no} cancelled and impacts reversed.`)
      setViewingReturn(null); setViewReturnItems([])
      fetchData()
    } catch (e) { toast.error('Failed: ' + e.message) }
  }

  async function deleteReturn(r) {
    if (!window.confirm(`Delete draft return ${r.return_no}?`)) return
    await supabase.from('purchase_return_items').delete().eq('return_id', r.id)
    await supabase.from('purchase_returns').delete().eq('id', r.id)
    toast.success('Draft deleted')
    fetchData()
  }

  async function printReturn(r, items) {
    // Fetch the supplier's current outstanding balance fresh at print time, so it
    // reflects this return's adjustment even if the on-screen list hasn't been refetched.
    let supplierBalance = null
    if (r.supplier_id) {
      const { data: sup } = await supabase.from('suppliers').select('outstanding_balance').eq('id', r.supplier_id).single()
      supplierBalance = sup?.outstanding_balance ?? null
    }
    const w = window.open('', '_blank')
    const fmt = n => parseFloat(n||0).toLocaleString('en-LK', { minimumFractionDigits: 2 })
    const dateStr = new Date(r.created_at).toLocaleDateString('en-GB', { day:'2-digit', month:'2-digit', year:'numeric' })
    const timeStr = new Date(r.created_at).toLocaleTimeString('en-GB', { hour:'2-digit', minute:'2-digit', second:'2-digit' })
    w.document.write(`<!DOCTYPE html><html><head><title>Return ${r.return_no}</title>
    <style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:Arial,sans-serif;font-size:13px;font-weight:bold;color:#000;width:80mm;margin:0 auto;padding:4px}
    .c{text-align:center}.b{font-weight:bold}.dashed{border-top:1px dashed #000;margin:4px 0}.solid{border-top:2px solid #000;margin:4px 0}
    .row{display:flex;justify-content:space-between;padding:1px 0;font-size:13px;font-weight:bold}
    .tot{display:flex;justify-content:space-between;font-weight:bold;font-size:16px;padding:3px 0}
    @media print{body{padding:0 0 60mm 0}@page{size:80mm auto;margin:1mm 1mm 0 1mm}}</style></head><body>
    <div class="c b" style="font-size:16px;font-weight:bold;letter-spacing:1px">PHONEFIX (PVT) LTD</div>
    <div class="c" style="font-size:11px;font-weight:bold">YOUR TRUSTED TECHNOLOGY PARTNER</div>
    <div class="dashed"></div>
    <div class="c b" style="font-size:14px;letter-spacing:1px">PURCHASE RETURN</div>
    <div class="dashed"></div>
    <div class="row"><span>RETURN NO :</span><span>${r.return_no}</span></div>
    <div class="row"><span>SUPPLIER &nbsp;:</span><span>${(r.suppliers?.name||'—').toUpperCase()}</span></div>
    <div class="row"><span>SHOP &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;:</span><span>${r.shops?.name||'—'}</span></div>
    <div class="row"><span>REFUND &nbsp;&nbsp;&nbsp;:</span><span style="text-transform:uppercase">${r.payment_method||'credit'}</span></div>
    ${r.remarks ? `<div class="row" style="font-size:11px"><span>REASON &nbsp;&nbsp;&nbsp;:</span><span style="max-width:40mm;text-align:right">${r.remarks}</span></div>` : ''}
    <div class="dashed"></div>
    <div class="row b" style="font-size:11px"><span>No. Product</span><span style="display:flex;gap:8px"><span>Cost</span><span>Qty</span><span>Amount</span></span></div>
    <div class="dashed"></div>
    ${items.map((li,idx) => `<div style="font-size:12px;font-weight:bold;padding:1px 0">${idx+1}. ${li.items?.name||li.name||'—'}</div><div style="display:flex;justify-content:space-between;font-size:12px;font-weight:bold;padding:0 0 3px 8px"><span>${fmt(li.unit_cost)} *${li.quantity}</span><span>${fmt((li.line_total||li.quantity*li.unit_cost))}</span></div>`).join('')}
    <div class="dashed"></div>
    <div class="row"><span>GROSS TOTAL :</span><span>${fmt(r.total)}</span></div>
    <div class="solid"></div>
    <div class="tot"><span>TOTAL :</span><span>${fmt(r.total)}</span></div>
    <div class="solid"></div>
    ${supplierBalance !== null ? `<div class="c b" style="font-size:12px;margin:3px 0">CURRENT PAYABLE : ${fmt(Math.max(0, supplierBalance))}</div><div class="dashed"></div>` : ''}
    <div style="display:flex;justify-content:space-between;font-size:12px;font-weight:bold">
      <span>Items : ${items.length} &nbsp; Pcs : ${items.reduce((s,l)=>s+(l.quantity||0),0)}</span>
    </div>
    <div style="display:flex;justify-content:space-between;font-size:12px;font-weight:bold">
      <span>Date : ${dateStr}</span><span>Time : ${timeStr}</span>
    </div>
    <div class="solid"></div>
    <div class="c b" style="font-size:13px;margin:3px 0">Designed for Phonefix (PVT) Ltd</div>
    <div class="c" style="font-size:11px;font-weight:bold;margin-top:2px">Powered by Techmo Solutions</div>
    <div style='height:60mm'></div><script>window.onload=function(){window.print()}<\/script></body></html>`)
    w.document.close()
  }

  const filteredReturns = returns.filter(r =>
    r.return_no?.toLowerCase().includes(search.toLowerCase()) ||
    r.suppliers?.name?.toLowerCase().includes(search.toLowerCase())
  )

  const filteredSuppliers = suppliers.filter(s =>
    s.name.toLowerCase().includes(supplierSearch.toLowerCase()) ||
    s.supplier_no?.toLowerCase().includes(supplierSearch.toLowerCase())
  )

  const filteredItems = items.filter(i =>
    i.name.toLowerCase().includes(itemSearch.toLowerCase()) ||
    i.item_no?.toLowerCase().includes(itemSearch.toLowerCase())
  )

  const statusBadge = (status) => {
    const map = {
      draft: { bg: '#fef3c7', color: '#92400e' },
      confirmed: { bg: '#dcfce7', color: '#166534' },
      cancelled: { bg: '#fee2e2', color: '#991b1b' }
    }
    const s = map[status] || map.draft
    return <span style={{ background: s.bg, color: s.color, padding: '3px 10px', borderRadius: '20px', fontSize: '12px', fontWeight: '700' }}>{status}</span>
  }

  const inp = { width: '100%', padding: '9px 12px', border: '1.5px solid #e2e8f0', borderRadius: '7px', fontSize: '14px', boxSizing: 'border-box', outline: 'none', background: 'white' }
  const lbl = { display: 'block', marginBottom: '5px', fontSize: '11px', fontWeight: '700', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.06em' }
  const card = { background: 'white', borderRadius: '12px', padding: '24px', boxShadow: '0 1px 3px rgba(15,23,42,0.06), 0 1px 2px rgba(15,23,42,0.04)', marginBottom: '16px', border: '1px solid #f1f5f9' }
  const drop = { position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0, background: 'white', border: '1.5px solid #e2e8f0', borderRadius: '10px', boxShadow: '0 8px 24px rgba(0,0,0,0.12)', zIndex: 200, maxHeight: '220px', overflowY: 'auto' }
  const dropItem = { padding: '10px 14px', cursor: 'pointer', fontSize: '14px', borderBottom: '1px solid #f8fafc', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }

  return (
    <div>
      {/* Return Detail Modal */}
      {viewingReturn && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 1001, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          onClick={e => { if (e.target === e.currentTarget) { setViewingReturn(null); setViewReturnItems([]) } }}>
          <div style={{ background: 'white', borderRadius: '16px', padding: '28px', width: '580px', maxHeight: '82vh', overflowY: 'auto', boxShadow: '0 20px 60px rgba(0,0,0,0.3)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '20px' }}>
              <div>
                <h2 style={{ fontSize: '18px', fontWeight: '800', color: '#0f172a', margin: '0 0 4px' }}>{viewingReturn.return_no}</h2>
                <p style={{ fontSize: '13px', color: '#64748b', margin: 0 }}>
                  {viewingReturn.suppliers?.name} · {new Date(viewingReturn.created_at).toLocaleDateString('en-GB', { day:'2-digit', month:'long', year:'numeric' })}
                </p>
              </div>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button onClick={() => printReturn(viewingReturn, viewReturnItems)}
                  style={{ background: '#1c1917', border: 'none', borderRadius: '10px', padding: '7px 14px', cursor: 'pointer', color: 'white', fontWeight: '700' }}>🖨 Print</button>
                <button onClick={() => { setViewingReturn(null); setViewReturnItems([]) }}
                  style={{ background: '#f1f5f9', border: 'none', borderRadius: '10px', padding: '7px 14px', cursor: 'pointer', color: '#64748b', fontWeight: '600' }}>✕ Close</button>
                {viewingReturn.status === 'confirmed' && (
                  <button onClick={() => cancelReturn(viewingReturn)}
                    style={{ background: '#fef3c7', border: 'none', borderRadius: '10px', padding: '7px 14px', cursor: 'pointer', color: '#92400e', fontWeight: '700' }}>✕ Cancel Return</button>
                )}
                {viewingReturn.status === 'draft' && (
                  <button onClick={() => deleteReturn(viewingReturn)}
                    style={{ background: '#fee2e2', border: 'none', borderRadius: '10px', padding: '7px 14px', cursor: 'pointer', color: '#dc2626', fontWeight: '700' }}>🗑 Delete Draft</button>
                )}
              </div>
            </div>
            <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '16px' }}>
              <thead>
                <tr style={{ background: '#f8fafc', borderBottom: '2px solid #e2e8f0' }}>
                  {['Item','Immi No','Qty','Unit Cost','Line Total'].map(h => (
                    <th key={h} style={{ padding: '8px 12px', textAlign: 'left', fontSize: '11px', fontWeight: '700', color: '#94a3b8', textTransform: 'uppercase' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {viewReturnItems.map((li, i) => (
                  <tr key={li.id || i} style={{ borderBottom: '1px solid #f1f5f9', background: i % 2 === 0 ? 'white' : '#fafafa' }}>
                    <td style={{ padding: '9px 12px', fontWeight: '600', color: '#0f172a' }}>{li.items?.name || '—'}</td>
                    <td style={{ padding: '9px 12px', fontSize: '12px', color: li.immi_no ? '#2563eb' : '#cbd5e1', fontWeight: li.immi_no ? '700' : '400', fontFamily: 'monospace' }}>{li.immi_no || '—'}</td>
                    <td style={{ padding: '9px 12px', color: '#64748b' }}>{li.quantity}</td>
                    <td style={{ padding: '9px 12px', fontWeight: '700', color: '#e11d48' }}>{formatCurrency(li.unit_cost)}</td>
                    <td style={{ padding: '9px 12px', fontWeight: '700', color: '#0f172a' }}>{formatCurrency(li.line_total || li.quantity * li.unit_cost)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div style={{ background: '#f8fafc', borderRadius: '10px', padding: '14px 16px' }}>
              {[
                { l: 'Total Returned', v: formatCurrency(viewingReturn.total), bold: true, color: '#e11d48' },
                { l: 'Refund Method', v: viewingReturn.payment_method || '—' },
                { l: 'Shop', v: viewingReturn.shops?.name || '—' },
                { l: 'Remarks', v: viewingReturn.remarks || '—' },
              ].map(row => (
                <div key={row.l} style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 0', fontSize: row.bold ? '15px' : '13px', fontWeight: row.bold ? '800' : '500' }}>
                  <span style={{ color: '#64748b' }}>{row.l}</span>
                  <span style={{ color: row.color || '#0f172a', textTransform: 'capitalize' }}>{row.v}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '24px' }}>
        <div>
          <h1 style={{ fontSize: '22px', fontWeight: '700', color: '#0f172a', margin: '0 0 4px' }}>Purchase Returns</h1>
          <p style={{ color: '#64748b', fontSize: '14px', margin: 0 }}>{returns.length} total returns</p>
        </div>
        <button onClick={() => { setActiveTab(activeTab === 'new' ? 'list' : 'new'); resetForm() }}
          style={{ padding: '10px 20px', background: activeTab === 'new' ? '#f1f5f9' : 'linear-gradient(135deg,#2563eb,#1d4ed8)', color: activeTab === 'new' ? '#475569' : 'white', border: 'none', borderRadius: '10px', cursor: 'pointer', fontWeight: '700', fontSize: '14px' }}>
          {activeTab === 'new' ? '← Back to List' : '+ New Return'}
        </button>
      </div>

      {/* ── LIST TAB ── */}
      {activeTab === 'list' && (
        <div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: '16px', marginBottom: '20px' }}>
            {[
              { label: 'Total Returns', value: returns.filter(r => r.status !== 'cancelled').length, color: '#1e40af' },
              { label: 'Total Value', value: formatCurrency(returns.filter(r => r.status !== 'cancelled').reduce((s, r) => s + (r.total || 0), 0)), color: '#e11d48' },
              { label: 'This Month', value: returns.filter(r => r.status !== 'cancelled' && new Date(r.created_at).getMonth() === new Date().getMonth()).length, color: '#d97706' },
            ].map(s => (
              <div key={s.label} style={{ background: 'white', borderRadius: '12px', padding: '20px', boxShadow: '0 1px 3px rgba(15,23,42,0.06), 0 1px 2px rgba(15,23,42,0.04)', borderLeft: `4px solid ${s.color}` }}>
                <div style={{ fontSize: '12px', fontWeight: '700', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '6px' }}>{s.label}</div>
                <div style={{ fontSize: '22px', fontWeight: '800', color: s.color }}>{s.value}</div>
              </div>
            ))}
          </div>

          <input type="text" placeholder="Search return no or supplier…" value={search} onChange={e => setSearch(e.target.value)} style={{ ...inp, marginBottom: '16px' }} />

          <div style={{ background: 'white', borderRadius: '12px', boxShadow: '0 1px 3px rgba(15,23,42,0.06), 0 1px 2px rgba(15,23,42,0.04)', overflow: 'hidden' }}>
            {loading ? <div style={{ padding: '60px', textAlign: 'center', color: '#94a3b8' }}>Loading...</div>
            : filteredReturns.length === 0 ? (
              <div style={{ padding: '60px', textAlign: 'center', color: '#94a3b8' }}>
                <div style={{ fontSize: '36px', marginBottom: '12px' }}>↩️</div>
                No purchase returns yet
              </div>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ background: '#f8fafc', borderBottom: '2px solid #e2e8f0' }}>
                    {['Return No', 'Date', 'Supplier', 'Shop', 'Total', 'Payment', 'Status', ''].map(h => (
                      <th key={h} style={{ padding: '11px 14px', textAlign: 'left', fontSize: '11px', fontWeight: '700', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filteredReturns.map((r, i) => (
                    <tr key={r.id} style={{ borderBottom: '1px solid #f1f5f9', background: i % 2 === 0 ? 'white' : '#fafafa', cursor: 'pointer' }}
                      onMouseEnter={e => e.currentTarget.style.background = '#f0f9ff'}
                      onMouseLeave={e => e.currentTarget.style.background = i % 2 === 0 ? 'white' : '#fafafa'}
                      onClick={async () => {
                        const { data: items } = await supabase.from('purchase_return_items').select('*, items(name, item_no)').eq('return_id', r.id)
                        setViewReturnItems(items || [])
                        setViewingReturn(r)
                      }}>
                      <td style={{ padding: '12px 14px', fontWeight: '700', color: '#2563eb', fontSize: '13px' }}>{r.return_no}</td>
                      <td style={{ padding: '12px 14px', fontSize: '13px', color: '#64748b' }}>{new Date(r.created_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}</td>
                      <td style={{ padding: '12px 14px' }}>
                        <div style={{ fontSize: '14px', fontWeight: '600', color: '#0f172a' }}>{r.suppliers?.name}</div>
                        <div style={{ fontSize: '12px', color: '#94a3b8' }}>{r.suppliers?.supplier_no}</div>
                      </td>
                      <td style={{ padding: '12px 14px', fontSize: '13px', color: '#64748b' }}>{r.shops?.name || '—'}</td>
                      <td style={{ padding: '12px 14px', fontSize: '14px', fontWeight: '700', color: '#e11d48' }}>{formatCurrency(r.total)}</td>
                      <td style={{ padding: '12px 14px', fontSize: '13px', color: '#64748b', textTransform: 'capitalize' }}>{r.payment_method}</td>
                      <td style={{ padding: '12px 14px' }}>{statusBadge(r.status)}</td>
                      <td style={{ padding: '12px 14px', fontSize: '12px', color: '#2563eb', fontWeight: '600' }}>View →</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {/* ── NEW RETURN TAB ── */}
      {activeTab === 'new' && (
        <div>
          {/* Action buttons */}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginBottom: '20px' }}>
            <button onClick={() => saveReturn('draft')} disabled={saving}
              style={{ padding: '10px 20px', background: 'white', color: '#475569', border: '1.5px solid #e2e8f0', borderRadius: '10px', cursor: 'pointer', fontWeight: '600', fontSize: '14px' }}>
              💾 Save Draft
            </button>
            <button onClick={() => saveReturn('confirmed')} disabled={saving}
              style={{ padding: '10px 24px', background: saving ? '#93c5fd' : 'linear-gradient(135deg,#2563eb,#1d4ed8)', color: 'white', border: 'none', borderRadius: '10px', cursor: 'pointer', fontWeight: '700', fontSize: '14px' }}>
              {saving ? 'Saving...' : '✓ Confirm Return'}
            </button>
          </div>

          {/* Supplier + Purchase + Shop */}
          <div style={{ ...card, display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '20px' }}>
            {/* Supplier */}
            <div>
              <label style={lbl}>Supplier *</label>
              <div style={{ position: 'relative' }}>
                <input type="text" placeholder="Search supplier…" value={supplierSearch}
                  onChange={e => { setSupplierSearch(e.target.value); setShowSupplierDrop(true); if (!e.target.value) setSelectedSupplier(null) }}
                  onFocus={() => setShowSupplierDrop(true)}
                  onBlur={() => setTimeout(() => setShowSupplierDrop(false), 180)}
                  style={{ ...inp, paddingRight: '32px' }} />
                {selectedSupplier && <span style={{ position: 'absolute', right: '10px', top: '50%', transform: 'translateY(-50%)', color: '#22c55e' }}>✓</span>}
                {showSupplierDrop && (
                  <div style={drop}>
                    {filteredSuppliers.map(s => (
                      <div key={s.id} onMouseDown={() => { setSelectedSupplier(s); setSupplierSearch(s.name); setShowSupplierDrop(false) }}
                        style={dropItem}
                        onMouseEnter={e => e.currentTarget.style.background = '#f8fafc'}
                        onMouseLeave={e => e.currentTarget.style.background = 'white'}>
                        <span><span style={{ fontWeight: '700', color: '#2563eb', marginRight: '8px', fontSize: '12px' }}>{s.supplier_no}</span>{s.name}</span>
                        {s.outstanding_balance > 0 && <span style={{ fontSize: '12px', color: '#7c3aed', fontWeight: '700' }}>Due: {formatCurrency(s.outstanding_balance)}</span>}
                      </div>
                    ))}
                  </div>
                )}
              </div>
              {selectedSupplier && (
                <div style={{ marginTop: '6px', padding: '6px 10px', background: '#f0fdf4', borderRadius: '6px', border: '1px solid #bbf7d0', fontSize: '12px', color: '#15803d', fontWeight: '600' }}>
                  {selectedSupplier.supplier_no} · {selectedSupplier.name}
                  {selectedSupplier.outstanding_balance > 0 && <span style={{ marginLeft: '8px', color: '#7c3aed' }}>Outstanding: {formatCurrency(selectedSupplier.outstanding_balance)}</span>}
                </div>
              )}
            </div>

            {/* Original Purchase (optional) */}
            <div>
              <label style={lbl}>Original Purchase No (optional)</label>
              <div style={{ position: 'relative' }}>
                <input type="text" placeholder="Search purchase no…" value={purchaseSearch}
                  onChange={e => { setPurchaseSearch(e.target.value); searchPurchases(e.target.value); setShowPurchaseDrop(true) }}
                  onFocus={() => setShowPurchaseDrop(true)}
                  onBlur={() => setTimeout(() => setShowPurchaseDrop(false), 180)}
                  style={inp} />
                {showPurchaseDrop && purchaseResults.length > 0 && (
                  <div style={drop}>
                    {purchaseResults.map(p => (
                      <div key={p.id} onMouseDown={() => selectPurchase(p)}
                        style={dropItem}
                        onMouseEnter={e => e.currentTarget.style.background = '#f8fafc'}
                        onMouseLeave={e => e.currentTarget.style.background = 'white'}>
                        <span style={{ fontWeight: '700', color: '#2563eb' }}>{p.purchase_no}</span>
                        <span style={{ fontSize: '12px', color: '#64748b' }}>{p.suppliers?.name} · {formatCurrency(p.total)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Shop */}
            <div>
              <label style={lbl}>Shop</label>
              <select value={selectedShop?.id || ''} onChange={e => setSelectedShop(shops.find(s => s.id === e.target.value) || null)} style={inp}>
                {shops.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
          </div>

          {/* Items */}
          <div style={card}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <h2 style={{ margin: 0, fontSize: '15px', fontWeight: '700', color: '#0f172a' }}>Items to Return</h2>
              <span style={{ fontSize: '13px', color: '#94a3b8' }}>{returnItems.length} item{returnItems.length !== 1 ? 's' : ''}</span>
            </div>

            {/* Item search */}
            <div style={{ position: 'relative', marginBottom: '16px' }}>
              <input ref={itemRef} type="text" placeholder="Search item to add…" value={itemSearch}
                onChange={e => { setItemSearch(e.target.value); setShowItemDrop(true) }}
                onFocus={() => setShowItemDrop(true)}
                onBlur={() => setTimeout(() => setShowItemDrop(false), 180)}
                style={{ ...inp, background: '#f8fafc' }} />
              {showItemDrop && (
                <div style={drop}>
                  {filteredItems.length === 0 && <div style={{ padding: '12px 14px', color: '#94a3b8', fontSize: '13px' }}>No items found</div>}
                  {filteredItems.map(item => (
                    <div key={item.id} onMouseDown={() => addItem(item)}
                      style={dropItem}
                      onMouseEnter={e => e.currentTarget.style.background = '#f8fafc'}
                      onMouseLeave={e => e.currentTarget.style.background = 'white'}>
                      <span>
                        <span style={{ fontWeight: '700', color: '#2563eb', marginRight: '8px', fontSize: '12px' }}>{item.item_no}</span>
                        {item.name}
                        <span style={{ marginLeft: '8px', fontSize: '12px', color: '#94a3b8' }}>Stock: {item.stock_quantity || 0}</span>
                      </span>
                      <span style={{ fontWeight: '700', color: '#d97706', fontSize: '13px' }}>{formatCurrency(item.cost_price)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {returnItems.length > 0 ? (
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ background: '#f8fafc', borderBottom: '2px solid #e2e8f0' }}>
                    {['#', 'Item', 'Immi No', 'Qty', 'Unit Cost (LKR)', 'Line Total', ''].map((h, i) => (
                      <th key={i} style={{ padding: '10px 12px', textAlign: 'left', fontSize: '11px', fontWeight: '700', color: '#94a3b8', textTransform: 'uppercase' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {returnItems.map((row, idx) => (
                    <tr key={idx} style={{ borderBottom: '1px solid #f1f5f9' }}>
                      <td style={{ padding: '10px 12px', fontSize: '12px', color: '#94a3b8', fontWeight: '700' }}>{idx + 1}</td>
                      <td style={{ padding: '10px 12px' }}>
                        <div style={{ fontSize: '14px', fontWeight: '600', color: '#0f172a' }}>{row.name}</div>
                        <div style={{ fontSize: '11px', color: '#2563eb' }}>{row.item_no}</div>
                      </td>
                      <td style={{ padding: '10px 12px' }}>
                        <input type="text" value={row.immi_no || ''}
                          onChange={e => updateRow(idx, 'immi_no', e.target.value)}
                          placeholder="Immi no…"
                          style={{ ...inp, width: '110px', fontSize: '12px' }} />
                      </td>
                      <td style={{ padding: '10px 12px' }}>
                        <input type="number" value={row.quantity} min="0.01" step="0.01"
                          ref={el => qtyRefs.current[idx] = el}
                          onChange={e => updateRow(idx, 'quantity', parseFloat(e.target.value) || 1)}
                          onFocus={e => e.target.select()}
                          onKeyDown={e => { if (e.key === 'Enter' || (e.key === 'Tab' && !e.shiftKey)) { e.preventDefault(); itemRef.current?.focus() } }}
                          style={{ ...inp, width: '80px', textAlign: 'center', fontWeight: '700' }} />
                      </td>
                      <td style={{ padding: '10px 12px' }}>
                        <input type="number" value={row.unit_cost} min="0"
                          onChange={e => updateRow(idx, 'unit_cost', parseFloat(e.target.value) || 0)}
                          onFocus={e => e.target.select()}
                          style={{ ...inp, width: '130px', textAlign: 'right', fontWeight: '600' }} />
                      </td>
                      <td style={{ padding: '10px 12px', fontSize: '15px', fontWeight: '700', color: '#e11d48' }}>{formatCurrency(row.quantity * row.unit_cost)}</td>
                      <td style={{ padding: '10px 12px' }}>
                        <button onClick={() => setReturnItems(rows => rows.filter((_, i) => i !== idx))}
                          style={{ width: '28px', height: '28px', background: '#fee2e2', color: '#dc2626', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '14px' }}>✕</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <div style={{ padding: '32px', textAlign: 'center', color: '#cbd5e1', border: '2px dashed #e2e8f0', borderRadius: '10px' }}>
                <div style={{ fontSize: '28px', marginBottom: '8px' }}>📦</div>
                Search above to add items being returned to supplier
              </div>
            )}
          </div>

          {/* Payment + Summary */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
            <div style={card}>
              <h3 style={{ margin: '0 0 16px', fontSize: '15px', fontWeight: '700', color: '#0f172a' }}>Return Details</h3>

              <div style={{ marginBottom: '14px' }}>
                <label style={lbl}>Payment / Adjustment Method</label>
                <select value={paymentMethod} onChange={e => { setPaymentMethod(e.target.value); setBankAccountId('') }} style={inp}>
                  <option value="credit">Deduct from Supplier Outstanding</option>
                  <option value="cash">Cash Refund from Supplier</option>
                  <option value="bank">Bank Transfer from Supplier</option>
                </select>
                {paymentMethod === 'bank' && (
                  <div style={{ marginTop: '10px' }}>
                    <label style={lbl}>Bank Account * (refund credited to)</label>
                    <select value={bankAccountId} onChange={e => setBankAccountId(e.target.value)}
                      style={{ ...inp, borderColor: !bankAccountId ? '#fca5a5' : '#e2e8f0' }}>
                      <option value="">— Select account —</option>
                      {bankAccounts.map(b => <option key={b.id} value={b.id}>{b.name} — {b.bank_name} (LKR {(b.balance || 0).toLocaleString('en-LK', { minimumFractionDigits: 2 })})</option>)}
                    </select>
                  </div>
                )}
                <div style={{ marginTop: '8px', padding: '10px 12px', background: '#f0f9ff', borderRadius: '10px', fontSize: '13px', color: '#0369a1' }}>
                  {paymentMethod === 'credit' && '💡 Return value will be deducted from supplier outstanding balance'}
                  {paymentMethod === 'cash' && '💵 Supplier will refund cash for the returned items'}
                  {paymentMethod === 'bank' && '🏦 Supplier refund will be credited to the selected bank account'}
                </div>
              </div>

              <div>
                <label style={lbl}>Remarks * (Reason for return)</label>
                <textarea value={remarks} onChange={e => setRemarks(e.target.value)}
                  placeholder="e.g. Defective goods, wrong items received, damaged in transit…"
                  rows={4} style={{ ...inp, resize: 'vertical', lineHeight: '1.5', borderColor: !remarks ? '#fca5a5' : '#e2e8f0' }} />
                {!remarks && <div style={{ fontSize: '12px', color: '#e11d48', marginTop: '4px' }}>Remarks are required</div>}
              </div>
            </div>

            <div style={card}>
              <h3 style={{ margin: '0 0 16px', fontSize: '15px', fontWeight: '700', color: '#0f172a' }}>Summary</h3>

              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '14px 16px', background: '#0f172a', borderRadius: '10px', marginBottom: '16px' }}>
                <span style={{ fontSize: '16px', color: '#94a3b8', fontWeight: '600' }}>Return Total</span>
                <span style={{ fontSize: '22px', color: 'white', fontWeight: '800' }}>{formatCurrency(subtotal)}</span>
              </div>

              {selectedSupplier?.outstanding_balance > 0 && (
                <div style={{ padding: '12px 14px', background: '#f5f3ff', borderRadius: '10px', border: '1px solid #ddd6fe', marginBottom: '16px', fontSize: '13px', color: '#6d28d9' }}>
                  Supplier outstanding: <strong>{formatCurrency(selectedSupplier.outstanding_balance)}</strong>
                  {paymentMethod === 'credit' && subtotal > 0 && (
                    <div style={{ marginTop: '4px', fontWeight: '700' }}>
                      After return: {formatCurrency(Math.max(0, selectedSupplier.outstanding_balance - subtotal))}
                    </div>
                  )}
                </div>
              )}

              <div style={{ display: 'flex', gap: '10px', marginTop: '8px' }}>
                <button onClick={() => saveReturn('draft')} disabled={saving}
                  style={{ flex: 1, padding: '12px', background: 'white', color: '#475569', border: '1.5px solid #e2e8f0', borderRadius: '10px', cursor: 'pointer', fontWeight: '600', fontSize: '14px' }}>
                  💾 Save Draft
                </button>
                <button onClick={() => saveReturn('confirmed')} disabled={saving}
                  style={{ flex: 2, padding: '12px', background: saving ? '#93c5fd' : 'linear-gradient(135deg,#2563eb,#1d4ed8)', color: 'white', border: 'none', borderRadius: '10px', cursor: 'pointer', fontWeight: '700', fontSize: '15px' }}>
                  {saving ? 'Saving...' : '✓ Confirm Return'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
