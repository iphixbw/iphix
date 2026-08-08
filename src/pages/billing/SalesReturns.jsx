import { useState, useEffect, useRef } from 'react'
import { supabase } from '../../supabase'
import { formatCurrency } from '../../lib/helpers'
import { recordBankMovement, fetchBankAccounts } from '../../lib/bank'
import { sendSMS, smsTemplates } from '../../lib/sms'
import toast from 'react-hot-toast'

async function generateReturnNo() {
  const { data, error } = await supabase.rpc('generate_return_no')
  if (error) throw error
  return data
}

export default function SalesReturns({ activeShop, isCashier = false, session, isSuperAdmin = false }) {
  const [view, setView] = useState('list')
  const [editingReturn, setEditingReturn] = useState(null)  // holds draft being edited
  const [viewingReturn, setViewingReturn] = useState(null)
  const [viewReturnItems, setViewReturnItems] = useState([])
  const [returns, setReturns] = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [customers, setCustomers] = useState([])
  const [salesmen, setSalesmen] = useState([])
  const [items, setItems] = useState([])
  const [invoices, setInvoices] = useState([])
  const [selectedCustomer, setSelectedCustomer] = useState(null)
  const [selectedSalesman, setSelectedSalesman] = useState(null)
  const [selectedInvoice, setSelectedInvoice] = useState(null)
  const [returnItems, setReturnItems] = useState([])
  const [paymentMethod, setPaymentMethod] = useState('credit')
  const [bankAccountId, setBankAccountId] = useState('')
  const [bankAccounts, setBankAccounts] = useState([])
  const [remarks, setRemarks] = useState('')
  const [customerSearch, setCustomerSearch] = useState('')
  const [showCustomerDrop, setShowCustomerDrop] = useState(false)
  const [invoiceSearch, setInvoiceSearch] = useState('')
  const [showInvoiceDrop, setShowInvoiceDrop] = useState(false)
  const [itemSearch, setItemSearch] = useState('')
  const [showItemDrop, setShowItemDrop] = useState(false)
  const itemSearchRef = useRef(null)
  const qtyRefs = useRef([])

  useEffect(() => { fetchData() }, [activeShop?.id])

  async function autoSelectSalesman(list, user, setter) {
    if (!user?.id || !list.length) return
    let match = list.find(s => s.user_id === user.id)
    if (!match) {
      const { data: profile } = await supabase.from('user_profiles').select('full_name').eq('id', user.id).single()
      if (profile?.full_name) match = list.find(s => s.name?.toLowerCase().trim() === profile.full_name?.toLowerCase().trim())
    }
    if (!match && user.email) {
      const prefix = user.email.split('@')[0].toLowerCase()
      match = list.find(s => s.name?.toLowerCase().replace(/\s+/g, '') === prefix)
    }
    if (match) {
      setter(match)
      if (!match.user_id) supabase.from('salesmen').update({ user_id: user.id }).eq('id', match.id).then(() => {})
    }
  }

  async function fetchData() {
    setLoading(true)
    const shopId = activeShop?.id
    let retQ = supabase.from('sales_returns').select('*, customers(name, customer_no), salesmen(name), shops(name)').order('created_at', { ascending: false })
    let invQ = supabase.from('invoices').select('*, customers(name)').eq('status', 'confirmed').order('created_at', { ascending: false })
    if (shopId) { retQ = retQ.eq('shop_id', shopId); invQ = invQ.eq('shop_id', shopId) }
    const [{ data: ret }, { data: c }, { data: s }, { data: i }, { data: inv }] = await Promise.all([
      retQ,
      supabase.from('customers').select('*').order('name'),
      supabase.from('salesmen').select('*').order('name'),
      supabase.from('items').select('*').order('name'),
      invQ,
    ])
    setReturns(ret || [])
    setCustomers(c || [])
    setSalesmen(s || [])
    await autoSelectSalesman(s || [], session?.user, setSelectedSalesman)
    setItems(i || [])
    setInvoices(inv || [])
    const banks = await fetchBankAccounts()
    setBankAccounts(banks)
    setLoading(false)
  }

  function addItem(item) {
    const existingIdx = returnItems.findIndex(r => r.item_id === item.id)
    setItemSearch(''); setShowItemDrop(false)
    if (existingIdx >= 0) {
      setReturnItems(rows => rows.map((r, i) => i === existingIdx ? { ...r, quantity: r.quantity + 1 } : r))
      setTimeout(() => {
        if (qtyRefs.current[existingIdx]) { qtyRefs.current[existingIdx].focus(); qtyRefs.current[existingIdx].select() }
      }, 50)
    } else {
      setReturnItems(rows => [...rows, { item_id: item.id, name: item.name, quantity: 1, unit_price: parseFloat(item.selling_price) || 0 }])
      setTimeout(() => {
        const lastIdx = qtyRefs.current.length - 1
        if (qtyRefs.current[lastIdx]) { qtyRefs.current[lastIdx].focus(); qtyRefs.current[lastIdx].select() }
      }, 50)
    }
  }

  function updateRow(index, field, value) {
    setReturnItems(rows => rows.map((r, i) => i === index ? { ...r, [field]: value } : r))
  }

  function removeRow(index) {
    setReturnItems(rows => rows.filter((_, i) => i !== index))
  }

  function loadDraftForEdit(ret, retItems) {
    setEditingReturn(ret)
    setSelectedCustomer(ret.customers || null)
    setCustomerSearch(ret.customers?.name || '')
    setSelectedSalesman(ret.salesmen || null)
    setSelectedInvoice(ret.invoice_id ? { id: ret.invoice_id } : null)
    setPaymentMethod(ret.payment_method || 'credit')
    setBankAccountId(ret.bank_account_id || '')
    setRemarks(ret.remarks || '')
    setReturnItems(retItems.map(i => ({
      item_id: i.item_id,
      name: i.items?.name || i.name || '',
      quantity: i.quantity,
      unit_price: i.unit_price,
    })))
    setViewingReturn(null)
    setViewReturnItems([])
    setView('new')
  }

  const subtotal = returnItems.reduce((s, r) => s + r.quantity * r.unit_price, 0)

  async function saveReturn(status) {
    if (!selectedCustomer) return toast.error('Please select a customer')
    if (!selectedSalesman) return toast.error('Please select a salesman')
    if (returnItems.length === 0) return toast.error('Please add at least one item')
    if (!remarks.trim()) return toast.error('Reason for return is required')
    if (paymentMethod === 'bank' && !bankAccountId) return toast.error('Please select a bank account for the transfer')
    setSaving(true)
    try {
      let ret
      if (editingReturn) {
        // UPDATE existing draft
        const { data: updated, error: updErr } = await supabase.from('sales_returns').update({
          invoice_id: selectedInvoice?.id || null,
          customer_id: selectedCustomer.id,
          salesman_id: selectedSalesman.id, status,
          payment_method: paymentMethod, subtotal, total: subtotal,
          bank_account_id: paymentMethod === 'bank' ? bankAccountId : null,
          remarks,
        }).eq('id', editingReturn.id).select().single()
        if (updErr) throw updErr
        ret = updated
        // Replace all items
        await supabase.from('sales_return_items').delete().eq('return_id', editingReturn.id)
        await supabase.from('sales_return_items').insert(
          returnItems.map(r => ({ return_id: ret.id, item_id: r.item_id, quantity: r.quantity, unit_price: r.unit_price, line_total: r.quantity * r.unit_price }))
        )
      } else {
        // INSERT new return
        const return_no = await generateReturnNo()
        const { data: inserted, error: retErr } = await supabase.from('sales_returns').insert({
          return_no, invoice_id: selectedInvoice?.id || null,
          shop_id: activeShop?.id, customer_id: selectedCustomer.id,
          salesman_id: selectedSalesman.id, status,
          payment_method: paymentMethod, subtotal, total: subtotal,
          bank_account_id: paymentMethod === 'bank' ? bankAccountId : null,
          remarks, created_by: session?.user?.id,
        }).select().single()
        if (retErr) throw retErr
        ret = inserted
        await supabase.from('sales_return_items').insert(
          returnItems.map(r => ({ return_id: ret.id, item_id: r.item_id, quantity: r.quantity, unit_price: r.unit_price, line_total: r.quantity * r.unit_price }))
        )
      }

      if (status === 'confirmed') {
        // Add stock back — atomically update global count AND restore shop inventory batches
        for (const row of returnItems) {
          // 1. Atomically add to global stock_quantity
          await supabase.rpc('add_item_stock', { p_item_id: row.item_id, p_quantity: row.quantity })

          // 2. Restore to shop inventory batches (insert as new received batch)
          if (activeShop?.id) {
            await supabase.from('inventory').insert({
              item_id: row.item_id,
              shop_id: activeShop.id,
              quantity: row.quantity,
              cost_price: row.unit_price || 0,
              received_at: new Date().toISOString(),
              notes: `Sales return: ${ret.return_no}`,
            })
          }
        }

        // Issue 6: Do NOT mutate credit_amount — it is the immutable original invoice balance
        // Only credit returns reduce what the customer owes; cash refunds don't affect the balance
        const { data: custRow } = await supabase.from('customers').select('opening_balance').eq('id', selectedCustomer.id).single()
        const { data: allInvs } = await supabase
          .from('invoices').select('id, credit_amount, invoice_payments(amount)')
          .eq('customer_id', selectedCustomer.id).eq('status', 'confirmed')
        const { data: allRets } = await supabase
          .from('sales_returns').select('invoice_id, total, payment_method')
          .eq('customer_id', selectedCustomer.id).eq('status', 'confirmed')
        const returnsByInv = {}
        ;(allRets || []).filter(r => r.payment_method === 'credit' || !r.payment_method).forEach(r => {
          if (r.invoice_id) returnsByInv[r.invoice_id] = (returnsByInv[r.invoice_id] || 0) + (r.total || 0)
        })
        const newBalance = (allInvs || []).reduce((total, inv) => {
          const paid = (inv.invoice_payments || []).reduce((s, p) => s + p.amount, 0)
          const rets = returnsByInv[inv.id] || 0
          return total + Math.max(0, (inv.credit_amount || 0) - paid - rets)
        }, custRow?.opening_balance || 0)
        await supabase.from('customers').update({ credit_balance: newBalance }).eq('id', selectedCustomer.id)

        // Cash refund — Cashflow reads sales_returns directly for "Refunds Paid to Customers"
        // No cash_deposits insert needed — cash_deposits is for cash going TO the bank

        // Bank transfer refund — deduct from the selected bank account
        if (paymentMethod === 'bank' && bankAccountId) {
          await recordBankMovement({
            bankAccountId,
            direction: 'payment_out',
            amount: subtotal,
            reference: `Sales Return Refund: ${return_no}`,
            notes: `Customer: ${selectedCustomer.name}`,
          })
        }
      }

      toast.success(status === 'draft' ? 'Return saved as draft!' : 'Return confirmed & stock updated!')
      // Send SMS to customer on confirmation
      if (status === 'confirmed' && selectedCustomer?.phone) {
        const { data: updatedCust } = await supabase.from('customers').select('credit_balance').eq('id', selectedCustomer.id).single()
        const refundLabel = paymentMethod === 'cash' ? 'Cash Refund' : paymentMethod === 'bank' ? 'Bank Transfer' : 'Credit Adjustment'
        const msg = smsTemplates.salesReturnToCustomer(
          selectedCustomer.name, return_no, subtotal, refundLabel,
          Math.max(0, updatedCust?.credit_balance || 0),
          activeShop?.name || 'iPHIX Technologies'
        )
        sendSMS({ to: selectedCustomer.phone, message: msg, triggeredBy: 'sales_return', referenceType: 'sales_return', referenceId: ret.id })
          .then(({ success }) => { if (success) toast.success('SMS sent to customer') })
      }
      resetForm(); setView('list'); fetchData()
    } catch (e) { toast.error('Error: ' + e.message) }
    setSaving(false)
  }

  function resetForm() {
    setSelectedCustomer(null); setSelectedSalesman(null); setSelectedInvoice(null)
    setReturnItems([]); setPaymentMethod('credit'); setBankAccountId(''); setRemarks(''); setEditingReturn(null)
    setCustomerSearch(''); setInvoiceSearch(''); setItemSearch('')
  }

  const filteredCustomers = customers.filter(c => (c.name?.toLowerCase() || '').includes(customerSearch.toLowerCase()) || (c.customer_no?.toLowerCase() || '').includes(customerSearch.toLowerCase()))
  const filteredInvoices = invoices.filter(i => (i.invoice_no?.toLowerCase() || '').includes(invoiceSearch.toLowerCase()) || (i.customers?.name?.toLowerCase() || '').includes(invoiceSearch.toLowerCase()))
  const filteredItems = items.filter(i => (i.name?.toLowerCase() || '').includes(itemSearch.toLowerCase()) || (i.item_no?.toLowerCase() || '').includes(itemSearch.toLowerCase()))

  const statusBadge = (status) => {
    const map = { draft: { bg: '#fef3c7', color: '#92400e', label: 'Draft' }, confirmed: { bg: '#dcfce7', color: '#166534', label: 'Confirmed' }, cancelled: { bg: '#fee2e2', color: '#991b1b', label: 'Cancelled' } }
    const s = map[status] || map.draft
    return <span style={{ background: s.bg, color: s.color, padding: '3px 10px', borderRadius: '20px', fontSize: '12px', fontWeight: '700' }}>{s.label}</span>
  }

  async function printReturn(r, items) {
    // Fetch the customer's current balance fresh at print time, so it reflects
    // this return's adjustment even if the on-screen list hasn't been refetched.
    let customerBalance = null
    if (r.customer_id) {
      const { data: cust } = await supabase.from('customers').select('credit_balance').eq('id', r.customer_id).single()
      customerBalance = cust?.credit_balance ?? null
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
    <div class="c b" style="font-size:16px;font-weight:bold;letter-spacing:1px">IPHIX TECHNOLOGIES</div>
    <div class="c" style="font-size:11px;font-weight:bold">YOUR TRUSTED TECHNOLOGY PARTNER</div>
    <div class="dashed"></div>
    <div class="c b" style="font-size:14px;letter-spacing:1px">SALES RETURN</div>
    <div class="dashed"></div>
    <div class="row"><span>RETURN NO :</span><span>${r.return_no}</span></div>
    <div class="row"><span>CUSTOMER &nbsp;:</span><span>${(r.customers?.name||'—').toUpperCase()}</span></div>
    <div class="row"><span>SALESMAN &nbsp;:</span><span>${r.salesmen?.name||'—'}</span></div>
    <div class="row"><span>REFUND &nbsp;&nbsp;&nbsp;:</span><span style="text-transform:uppercase">${r.payment_method||'—'}</span></div>
    ${r.remarks ? `<div class="row" style="font-size:11px"><span>REASON &nbsp;&nbsp;&nbsp;:</span><span style="max-width:40mm;text-align:right">${r.remarks}</span></div>` : ''}
    <div class="dashed"></div>
    <div class="row b" style="font-size:11px"><span>No. Product</span><span style="display:flex;gap:8px"><span>Rate</span><span>Qty</span><span>Amount</span></span></div>
    <div class="dashed"></div>
    ${items.map((li,idx) => `<div style="font-size:12px;font-weight:bold;padding:1px 0">${idx+1}. ${li.items?.name||li.name||'—'}</div><div style="display:flex;justify-content:space-between;font-size:12px;font-weight:bold;padding:0 0 3px 8px"><span>${fmt(li.unit_price)} *${li.quantity}</span><span>${fmt((li.line_total||li.quantity*li.unit_price))}</span></div>`).join('')}
    <div class="dashed"></div>
    <div class="row"><span>GROSS TOTAL :</span><span>${fmt(r.total)}</span></div>
    <div class="solid"></div>
    <div class="tot"><span>TOTAL :</span><span>${fmt(r.total)}</span></div>
    <div class="solid"></div>
    ${customerBalance !== null ? `<div class="c b" style="font-size:12px;margin:3px 0">CURRENT BALANCE : ${fmt(Math.max(0, customerBalance))}${customerBalance < 0 ? ' CR' : ''}</div><div class="dashed"></div>` : ''}
    <div style="display:flex;justify-content:space-between;font-size:12px;font-weight:bold">
      <span>Items : ${items.length} &nbsp; Pcs : ${items.reduce((s,l)=>s+(l.quantity||0),0)}</span>
    </div>
    <div style="display:flex;justify-content:space-between;font-size:12px;font-weight:bold">
      <span>Date : ${dateStr}</span><span>Time : ${timeStr}</span>
    </div>
    <div class="solid"></div>
    <div class="c b" style="font-size:13px;margin:3px 0">★ Thank You! Visit Again ★</div>
    <div class="c" style="font-size:11px;font-weight:bold">Your trust is our greatest reward.</div>
    <div class="c" style="font-size:11px;font-weight:bold;margin-top:2px">Designed for iPHIX Technologies · Powered by Techmo Solutions</div>
    <div style=\'height:60mm\'></div><script>window.onload=function(){window.print()}<\/script></body></html>`)
    w.document.close()
  }

  async function deleteReturn(r) {
    if (!window.confirm(`Delete ${r.return_no}?\n\nThis will:\n- Remove the return record\n- Deduct stock that was added back\n- Reverse the customer balance adjustment\n\nThis cannot be undone.`)) return
    setSaving(true)
    try {
      // 1. Fetch return items
      const { data: retItems } = await supabase.from('sales_return_items').select('*').eq('return_id', r.id)
      
      if (r.status === 'confirmed') {
        // 2. Deduct stock back (reverse the addition)
        for (const row of (retItems || [])) {
          await supabase.rpc('deduct_item_stock', { p_item_id: row.item_id, p_quantity: row.quantity })
          // Remove inventory batch added by the return
          if (r.shop_id) {
            await supabase.from('inventory').delete()
              .eq('item_id', row.item_id).eq('shop_id', r.shop_id)
              .ilike('notes', `%${r.return_no}%`)
          }
        }
        // 3. Reverse customer balance — recalculate from scratch
        const { data: custRow } = await supabase.from('customers').select('opening_balance').eq('id', r.customer_id).single()
        const { data: allInvs } = await supabase.from('invoices').select('id, credit_amount, invoice_payments(amount)').eq('customer_id', r.customer_id).eq('status', 'confirmed')
        const { data: allRets } = await supabase.from('sales_returns').select('invoice_id, total, payment_method, id').eq('customer_id', r.customer_id).eq('status', 'confirmed')
        const remainingRets = (allRets || []).filter(rt => rt.id !== r.id && (rt.payment_method === 'credit' || !rt.payment_method))
        const returnsByInv = {}
        remainingRets.forEach(rt => { if (rt.invoice_id) returnsByInv[rt.invoice_id] = (returnsByInv[rt.invoice_id] || 0) + (rt.total || 0) })
        const newBalance = (allInvs || []).reduce((total, inv) => {
          const paid = (inv.invoice_payments || []).reduce((s, p) => s + p.amount, 0)
          const rets = returnsByInv[inv.id] || 0
          return total + Math.max(0, (inv.credit_amount || 0) - paid - rets)
        }, custRow?.opening_balance || 0)
        await supabase.from('customers').update({ credit_balance: newBalance }).eq('id', r.customer_id)
      }

      // 4. Delete return items and return
      await supabase.from('sales_return_items').delete().eq('return_id', r.id)
      await supabase.from('sales_returns').delete().eq('id', r.id)
      
      setViewingReturn(null); setViewReturnItems([])
      toast.success(`${r.return_no} deleted and all data reversed`)
      fetchData()
    } catch (e) { toast.error('Delete failed: ' + e.message) }
    setSaving(false)
  }

  const inp = { width: '100%', padding: '9px 12px', border: '1.5px solid #e2e8f0', borderRadius: '7px', fontSize: '14px', boxSizing: 'border-box', outline: 'none', background: 'white' }
  const lbl = { display: 'block', marginBottom: '5px', fontSize: '11px', fontWeight: '700', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.06em' }
  const card = { background: 'white', borderRadius: '12px', padding: '24px', boxShadow: '0 1px 3px rgba(15,23,42,0.06), 0 1px 2px rgba(15,23,42,0.04)', marginBottom: '16px', border: '1px solid #f1f5f9' }
  const drop = { position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0, background: 'white', border: '1.5px solid #e2e8f0', borderRadius: '10px', boxShadow: '0 8px 24px rgba(0,0,0,0.12)', zIndex: 200, maxHeight: '220px', overflowY: 'auto' }
  const dropItem = { padding: '10px 14px', cursor: 'pointer', fontSize: '14px', borderBottom: '1px solid #f8fafc', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }

  if (view === 'list') return (
    <div>
      {/* Return Detail Modal */}
      {viewingReturn && (
        <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.55)', zIndex:1000, display:'flex', alignItems:'center', justifyContent:'center' }}
          onClick={e => { if(e.target===e.currentTarget){setViewingReturn(null);setViewReturnItems([])} }}>
          <div style={{ background:'white', borderRadius:'16px', padding:'28px', width:'580px', maxHeight:'82vh', overflowY:'auto', boxShadow:'0 20px 60px rgba(0,0,0,0.3)' }}>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:'20px' }}>
              <div>
                <h2 style={{ fontSize:'18px', fontWeight:'800', color:'#0f172a', margin:'0 0 4px' }}>{viewingReturn.return_no}</h2>
                <p style={{ fontSize:'13px', color:'#64748b', margin:0 }}>
                  {viewingReturn.customers?.name} · {new Date(viewingReturn.created_at).toLocaleDateString('en-GB',{day:'2-digit',month:'long',year:'numeric'})}
                </p>
              </div>
              <div style={{ display:'flex', gap:'8px' }}>
                <button onClick={() => printReturn(viewingReturn, viewReturnItems)}
                  style={{ background:'#eef2ff', border:'none', borderRadius:'8px', padding:'7px 14px', cursor:'pointer', color:'#1e40af', fontWeight:'700', fontSize:'13px' }}>🖨 Print</button>
                {viewingReturn.status === 'draft' && (
                  <button onClick={() => loadDraftForEdit(viewingReturn, viewReturnItems)}
                    style={{ background:'#fef3c7', border:'none', borderRadius:'8px', padding:'7px 14px', cursor:'pointer', color:'#92400e', fontWeight:'700', fontSize:'13px' }}>✏️ Edit Draft</button>
                )}
                {isSuperAdmin && viewingReturn.status !== 'draft' && (
                  <button onClick={() => deleteReturn(viewingReturn)} disabled={saving}
                    style={{ background:'#fee2e2', border:'none', borderRadius:'8px', padding:'7px 14px', cursor:'pointer', color:'#dc2626', fontWeight:'700', fontSize:'13px' }}>🗑 Delete</button>
                )}
                <button onClick={()=>{setViewingReturn(null);setViewReturnItems([])}}
                  style={{ background:'#f1f5f9', border:'none', borderRadius:'8px', padding:'7px 14px', cursor:'pointer', color:'#64748b', fontWeight:'600' }}>✕ Close</button>
              </div>
            </div>
            <table style={{ width:'100%', borderCollapse:'collapse', marginBottom:'16px' }}>
              <thead>
                <tr style={{ background:'#f8fafc', borderBottom:'2px solid #e2e8f0' }}>
                  {['Item','Qty','Unit Price','Line Total'].map(h=>(
                    <th key={h} style={{ padding:'8px 12px', textAlign:'left', fontSize:'11px', fontWeight:'700', color:'#94a3b8', textTransform:'uppercase' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {viewReturnItems.map((li,i)=>(
                  <tr key={li.id||i} style={{ borderBottom:'1px solid #f1f5f9', background:i%2===0?'white':'#fafafa' }}>
                    <td style={{ padding:'9px 12px', fontWeight:'600', color:'#0f172a' }}>{li.items?.name||'—'}</td>
                    <td style={{ padding:'9px 12px', color:'#64748b' }}>{li.quantity}</td>
                    <td style={{ padding:'9px 12px', color:'#64748b' }}>{formatCurrency(li.unit_price)}</td>
                    <td style={{ padding:'9px 12px', fontWeight:'700', color:'#e11d48' }}>{formatCurrency(li.line_total||li.quantity*li.unit_price)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div style={{ background:'#f8fafc', borderRadius:'10px', padding:'14px 16px' }}>
              {[
                {l:'Total Returned', v:formatCurrency(viewingReturn.total), bold:true, color:'#e11d48'},
                {l:'Refund Method', v:viewingReturn.payment_method||'—'},
                {l:'Salesman', v:viewingReturn.salesmen?.name||'—'},
                {l:'Shop', v:viewingReturn.shops?.name||'—'},
                {l:'Remarks', v:viewingReturn.remarks||'—'},
              ].map(row=>(
                <div key={row.l} style={{ display:'flex', justifyContent:'space-between', padding:'5px 0', fontSize:row.bold?'15px':'13px', fontWeight:row.bold?'800':'500' }}>
                  <span style={{ color:'#64748b' }}>{row.l}</span>
                  <span style={{ color:row.color||'#0f172a', textTransform:'capitalize' }}>{row.v}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '24px' }}>
        <div>
          <h1 style={{ fontSize: '22px', fontWeight: '700', color: '#0f172a', margin: '0 0 4px' }}>Sales Returns</h1>
          <p style={{ color: '#64748b', fontSize: '14px', margin: 0 }}>{returns.length} return{returns.length !== 1 ? 's' : ''}</p>
        </div>
        <button onClick={() => setView('new')} style={{ padding: '10px 20px', background: 'linear-gradient(135deg,#e11d48,#be123c)', color: 'white', border: 'none', borderRadius: '10px', cursor: 'pointer', fontWeight: '700', fontSize: '14px' }}>
          + New Return
        </button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: '16px', marginBottom: '24px' }}>
        {[
          { label: 'Confirmed Returns', value: returns.filter(r => r.status === 'confirmed').length, color: '#e11d48' },
          { label: 'Total Value', value: formatCurrency(returns.filter(r => r.status === 'confirmed').reduce((s, r) => s + (r.total || 0), 0)), color: '#d97706' },
          { label: 'Drafts', value: returns.filter(r => r.status === 'draft').length, color: '#2563eb' },
        ].map(s => (
          <div key={s.label} style={{ background: 'white', borderRadius: '12px', padding: '20px', boxShadow: '0 1px 3px rgba(15,23,42,0.06), 0 1px 2px rgba(15,23,42,0.04)', borderLeft: `4px solid ${s.color}` }}>
            <div style={{ fontSize: '12px', fontWeight: '700', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '6px' }}>{s.label}</div>
            <div style={{ fontSize: '22px', fontWeight: '800', color: s.color }}>{s.value}</div>
          </div>
        ))}
      </div>

      <div style={{ background: 'white', borderRadius: '12px', boxShadow: '0 1px 3px rgba(15,23,42,0.06), 0 1px 2px rgba(15,23,42,0.04)', overflow: 'hidden' }}>
        {loading ? <div style={{ padding: '60px', textAlign: 'center', color: '#94a3b8' }}>Loading...</div>
          : returns.length === 0 ? (
            <div style={{ padding: '60px', textAlign: 'center', color: '#94a3b8' }}>
              <div style={{ fontSize: '36px', marginBottom: '12px' }}>↩️</div>No returns yet
            </div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: '#f8fafc', borderBottom: '2px solid #e2e8f0' }}>
                  {['Return No', 'Date', 'Customer', 'Salesman', 'Total', 'Refund', 'Remarks', 'Status', ''].map(h => (
                    <th key={h} style={{ padding: '11px 14px', textAlign: 'left', fontSize: '11px', fontWeight: '700', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.06em', whiteSpace: 'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {returns.map((r, i) => (
                  <tr key={r.id} style={{ borderBottom: '1px solid #f1f5f9', background: i % 2 === 0 ? 'white' : '#fafafa', cursor: 'pointer' }}
                    onMouseEnter={e => e.currentTarget.style.background = '#fff5f5'}
                    onMouseLeave={e => e.currentTarget.style.background = i % 2 === 0 ? 'white' : '#fafafa'}
                    onClick={async () => {
                      const { data: items } = await supabase.from('sales_return_items').select('*, items(name, item_no)').eq('return_id', r.id)
                      setViewReturnItems(items || [])
                      setViewingReturn(r)
                    }}>
                    <td style={{ padding: '12px 14px', fontWeight: '700', color: '#e11d48', fontSize: '13px' }}>{r.return_no}</td>
                    <td style={{ padding: '12px 14px', fontSize: '13px', color: '#64748b' }}>{new Date(r.created_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}</td>
                    <td style={{ padding: '12px 14px', fontSize: '14px', fontWeight: '600', color: '#0f172a' }}>{r.customers?.name || '—'}</td>
                    <td style={{ padding: '12px 14px', fontSize: '13px', color: '#64748b' }}>{r.salesmen?.name || '—'}</td>
                    <td style={{ padding: '12px 14px', fontSize: '14px', fontWeight: '700', color: '#e11d48' }}>{formatCurrency(r.total)}</td>
                    <td style={{ padding: '12px 14px', fontSize: '13px', color: '#64748b', textTransform: 'capitalize' }}>{r.payment_method}</td>
                    <td style={{ padding: '12px 14px', fontSize: '13px', color: '#64748b', maxWidth: '150px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.remarks || '—'}</td>
                    <td style={{ padding: '12px 14px' }}>{statusBadge(r.status)}</td>
                    <td style={{ padding: '12px 14px', fontSize: '12px', color: '#e11d48', fontWeight: '600' }}>View →</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
      </div>
    </div>
  )

  return (
    <div style={{ maxWidth: '1100px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '24px' }}>
        <div>
          <button onClick={() => { setView('list'); resetForm() }} style={{ background: 'none', border: 'none', color: '#2563eb', cursor: 'pointer', fontSize: '14px', fontWeight: '600', padding: '0 0 8px' }}>← Back to Returns</button>
          <h1 style={{ fontSize: '22px', fontWeight: '700', color: '#0f172a', margin: '0 0 4px' }}>{editingReturn ? `Edit Draft — ${editingReturn.return_no}` : 'New Sales Return'}</h1>
          <span style={{ fontSize: '13px', color: '#94a3b8', fontStyle: 'italic' }}>Return no. assigned on save</span>
        </div>
        <div style={{ display: 'flex', gap: '10px' }}>
          <button onClick={() => saveReturn('draft')} disabled={saving} style={{ padding: '10px 20px', background: 'white', color: '#475569', border: '1.5px solid #e2e8f0', borderRadius: '10px', cursor: 'pointer', fontWeight: '600', fontSize: '14px' }}>Save Draft</button>
          <button onClick={() => saveReturn('confirmed')} disabled={saving} style={{ padding: '10px 24px', background: saving ? '#fca5a5' : 'linear-gradient(135deg,#e11d48,#be123c)', color: 'white', border: 'none', borderRadius: '10px', cursor: 'pointer', fontWeight: '700', fontSize: '14px' }}>{saving ? 'Saving...' : '✓ Confirm Return'}</button>
        </div>
      </div>

      <div style={{ ...card, display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '20px' }}>
        <div>
          <label style={lbl}>Customer *</label>
          <div style={{ position: 'relative' }}>
            <input type="text" placeholder="Search customer…" value={customerSearch}
              onChange={e => { setCustomerSearch(e.target.value); setShowCustomerDrop(true); if (!e.target.value) setSelectedCustomer(null) }}
              onFocus={() => setShowCustomerDrop(true)} onBlur={() => setTimeout(() => setShowCustomerDrop(false), 180)}
              style={{ ...inp, paddingRight: '36px' }} />
            {selectedCustomer && <span style={{ position: 'absolute', right: '10px', top: '50%', transform: 'translateY(-50%)', color: '#22c55e', fontSize: '16px' }}>✓</span>}
            {showCustomerDrop && (
              <div style={drop}>
                {filteredCustomers.map(c => (
                  <div key={c.id} onMouseDown={() => { setSelectedCustomer(c); setCustomerSearch(c.name); setShowCustomerDrop(false) }}
                    style={dropItem} onMouseEnter={e => e.currentTarget.style.background = '#f8fafc'} onMouseLeave={e => e.currentTarget.style.background = 'white'}>
                    <span><span style={{ fontWeight: '700', color: '#2563eb', marginRight: '8px' }}>{c.customer_no}</span>{c.name}</span>
                    {c.credit_balance > 0 && <span style={{ fontSize: '12px', color: '#e11d48', fontWeight: '700' }}>Due: {formatCurrency(c.credit_balance)}</span>}
                  </div>
                ))}
              </div>
            )}
          </div>
          {selectedCustomer && <div style={{ marginTop: '8px', padding: '8px 12px', background: '#f0fdf4', borderRadius: '10px', border: '1px solid #bbf7d0', fontSize: '13px', color: '#15803d', fontWeight: '600' }}>{selectedCustomer.customer_no} · {selectedCustomer.name}</div>}
        </div>

        <div>
          <label style={lbl}>Salesman *</label>
          {isCashier && selectedSalesman ? (
            <div style={{ padding: '9px 12px', background: '#f0fdf4', border: '1.5px solid #bbf7d0', borderRadius: '7px', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ fontSize: '14px', fontWeight: '700', color: '#166534' }}>{selectedSalesman.name}</span>
              <span style={{ fontSize: '11px', color: '#86efac', fontWeight: '600' }}>{selectedSalesman.salesman_no}</span>
              <span style={{ marginLeft: 'auto', fontSize: '11px', background: '#dcfce7', color: '#166534', padding: '1px 7px', borderRadius: '10px', fontWeight: '700' }}>Auto</span>
            </div>
          ) : (
            <>
              <select value={selectedSalesman?.id || ''} onChange={e => setSelectedSalesman(salesmen.find(s => s.id === e.target.value) || null)} style={{ ...inp, color: selectedSalesman ? '#0f172a' : '#94a3b8', borderColor: selectedSalesman ? '#2563eb' : '#e2e8f0' }}>
                <option value="">— Select salesman —</option>
                {salesmen.map(s => <option key={s.id} value={s.id}>{s.salesman_no} · {s.name}</option>)}
              </select>
              {selectedSalesman && <div style={{ fontSize: '11px', color: '#2563eb', marginTop: '3px', fontWeight: '600' }}>✓ Auto-selected from your profile</div>}
            </>
          )}
        </div>

        <div>
          <label style={lbl}>Original Invoice (optional)</label>
          <div style={{ position: 'relative' }}>
            <input type="text" placeholder="Search invoice no…" value={invoiceSearch}
              onChange={e => { setInvoiceSearch(e.target.value); setShowInvoiceDrop(true); if (!e.target.value) setSelectedInvoice(null) }}
              onFocus={() => setShowInvoiceDrop(true)} onBlur={() => setTimeout(() => setShowInvoiceDrop(false), 180)}
              style={inp} />
            {showInvoiceDrop && (
              <div style={drop}>
                {filteredInvoices.map(inv => (
                  <div key={inv.id} onMouseDown={async () => {
                    setSelectedInvoice(inv)
                    setInvoiceSearch(inv.invoice_no)
                    setShowInvoiceDrop(false)
                    // Auto-populate items from this invoice
                    const { data: invItems } = await supabase
                      .from('invoice_items')
                      .select('*, items(name, item_no)')
                      .eq('invoice_id', inv.id)
                    if (invItems && invItems.length > 0) {
                      setReturnItems(invItems.map(li => ({
                        item_id: li.item_id,
                        name: li.items?.name || '',
                        quantity: li.quantity,
                        unit_price: li.unit_price,
                        max_quantity: li.quantity,
                      })))
                    }
                  }}
                    style={dropItem} onMouseEnter={e => e.currentTarget.style.background = '#f8fafc'} onMouseLeave={e => e.currentTarget.style.background = 'white'}>
                    <span><span style={{ fontWeight: '700', color: '#2563eb', marginRight: '8px' }}>{inv.invoice_no}</span>{inv.customers?.name}</span>
                    <span style={{ fontSize: '12px', color: '#64748b' }}>{formatCurrency(inv.total)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      <div style={card}>
        <label style={lbl}>Reason for Return *</label>
        <textarea value={remarks} onChange={e => setRemarks(e.target.value)} placeholder="Why is the customer returning this? (required)" rows={2} style={{ ...inp, resize: 'vertical', lineHeight: '1.5', borderColor: !remarks ? '#fca5a5' : '#e2e8f0' }} />
      </div>

      <div style={card}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
          <h2 style={{ margin: 0, fontSize: '15px', fontWeight: '700', color: '#0f172a' }}>Return Items</h2>
          <span style={{ fontSize: '13px', color: '#94a3b8' }}>{returnItems.length} item{returnItems.length !== 1 ? 's' : ''}</span>
        </div>
        <div style={{ position: 'relative', marginBottom: '16px' }}>
          <input ref={itemSearchRef} type="text" placeholder="Search item to return…" value={itemSearch}
            onChange={e => { setItemSearch(e.target.value); setShowItemDrop(true) }}
            onFocus={() => setShowItemDrop(true)} onBlur={() => setTimeout(() => setShowItemDrop(false), 180)}
            style={{ ...inp, background: '#f8fafc' }} />
          {showItemDrop && (
            <div style={drop}>
              {filteredItems.length === 0 && itemSearch && <div style={{ ...dropItem, color: '#94a3b8', justifyContent: 'center' }}>No items found</div>}
              {filteredItems.map(item => (
                <div key={item.id} onMouseDown={() => addItem(item)} style={dropItem} onMouseEnter={e => e.currentTarget.style.background = '#f8fafc'} onMouseLeave={e => e.currentTarget.style.background = 'white'}>
                  <span><span style={{ fontWeight: '700', color: '#2563eb', marginRight: '8px', fontSize: '12px' }}>{item.item_no}</span>{item.name}</span>
                  <span style={{ fontWeight: '700', color: '#059669', fontSize: '13px' }}>{formatCurrency(item.selling_price)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
        {returnItems.length > 0 ? (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: '#f8fafc', borderBottom: '2px solid #e2e8f0' }}>
                {['#', 'Item', 'Qty', 'Unit Price (LKR)', 'Line Total', ''].map((h, i) => (
                  <th key={i} style={{ padding: '10px 12px', textAlign: i === 0 ? 'center' : i >= 4 ? 'right' : 'left', fontSize: '11px', fontWeight: '700', color: '#94a3b8', textTransform: 'uppercase' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {returnItems.map((row, idx) => (
                <tr key={idx} style={{ borderBottom: '1px solid #f1f5f9' }}>
                  <td style={{ padding: '12px', textAlign: 'center', fontSize: '12px', color: '#94a3b8', fontWeight: '700' }}>{idx + 1}</td>
                  <td style={{ padding: '12px', fontSize: '14px', fontWeight: '600', color: '#0f172a' }}>{row.name}</td>
                  <td style={{ padding: '12px' }}><input type="number" value={row.quantity} min="0.01" step="0.01" onChange={e => updateRow(idx, 'quantity', parseFloat(e.target.value) || 1)} onFocus={e => e.target.select()}
                      ref={el => qtyRefs.current[idx] = el}
                      onKeyDown={e => { if (e.key === 'Enter' || (e.key === 'Tab' && !e.shiftKey)) { e.preventDefault(); itemSearchRef.current?.focus() } }} style={{ ...inp, width: '80px', textAlign: 'center', fontWeight: '700' }} /></td>
                  <td style={{ padding: '12px' }}><input type="number" value={row.unit_price} min="0" step="0.01" onChange={e => updateRow(idx, 'unit_price', parseFloat(e.target.value) || 0)} onFocus={e => e.target.select()} style={{ ...inp, width: '130px', textAlign: 'right', fontWeight: '600' }} /></td>
                  <td style={{ padding: '12px', textAlign: 'right', fontSize: '15px', fontWeight: '700', color: '#e11d48' }}>{formatCurrency(row.quantity * row.unit_price)}</td>
                  <td style={{ padding: '12px', textAlign: 'right' }}><button onClick={() => removeRow(idx)} style={{ width: '28px', height: '28px', background: '#fee2e2', color: '#dc2626', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '14px' }}>✕</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div style={{ padding: '40px', textAlign: 'center', color: '#cbd5e1', fontSize: '14px', border: '2px dashed #e2e8f0', borderRadius: '10px' }}>
            <div style={{ fontSize: '28px', marginBottom: '8px' }}>↩️</div>Search above to add items to return
          </div>
        )}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
        <div style={card}>
          <h2 style={{ margin: '0 0 16px', fontSize: '15px', fontWeight: '700', color: '#0f172a' }}>Refund Method</h2>
          <select value={paymentMethod} onChange={e => { setPaymentMethod(e.target.value); setBankAccountId('') }} style={{ ...inp, marginBottom: '12px' }}>
            <option value="credit">Credit (Deduct from outstanding)</option>
            <option value="cash">Cash Refund to Customer</option>
            <option value="bank">Bank Transfer to Customer</option>
          </select>
          {paymentMethod === 'bank' && (
            <div style={{ marginBottom: '12px' }}>
              <label style={lbl}>Bank Account * (deducted from)</label>
              <select value={bankAccountId} onChange={e => setBankAccountId(e.target.value)}
                style={{ ...inp, borderColor: !bankAccountId ? '#fca5a5' : '#e2e8f0' }}>
                <option value="">— Select account —</option>
                {bankAccounts.map(b => <option key={b.id} value={b.id}>{b.name} — {b.bank_name} (LKR {(b.balance || 0).toLocaleString('en-LK', { minimumFractionDigits: 2 })})</option>)}
              </select>
            </div>
          )}
          <div style={{ padding: '12px 14px', background: paymentMethod === 'credit' ? '#f0f9ff' : '#f0fdf4', borderRadius: '10px', border: `1px solid ${paymentMethod === 'credit' ? '#bae6fd' : '#bbf7d0'}`, fontSize: '13px', color: paymentMethod === 'credit' ? '#0369a1' : '#15803d' }}>
            {paymentMethod === 'credit' && '💡 Return value will be deducted from the customer\'s outstanding balance'}
            {paymentMethod === 'cash' && '💵 Cash will be refunded to the customer — deducts cash in hand'}
            {paymentMethod === 'bank' && '🏦 Refund will be transferred to customer from the selected bank account'}
          </div>
        </div>
        <div style={card}>
          <h2 style={{ margin: '0 0 16px', fontSize: '15px', fontWeight: '700', color: '#0f172a' }}>Return Summary</h2>
          <div style={{ display: 'flex', justifyContent: 'space-between', padding: '14px 16px', background: '#fef2f2', borderRadius: '10px', marginBottom: '16px', border: '1px solid #fecaca' }}>
            <span style={{ fontSize: '16px', color: '#991b1b', fontWeight: '600' }}>Total Return Value</span>
            <span style={{ fontSize: '22px', color: '#e11d48', fontWeight: '800' }}>{formatCurrency(subtotal)}</span>
          </div>
          <div style={{ display: 'flex', gap: '10px' }}>
            <button onClick={() => saveReturn('draft')} disabled={saving} style={{ flex: 1, padding: '12px', background: 'white', color: '#475569', border: '1.5px solid #e2e8f0', borderRadius: '10px', cursor: 'pointer', fontWeight: '600', fontSize: '14px' }}>Save Draft</button>
            <button onClick={() => saveReturn('confirmed')} disabled={saving} style={{ flex: 2, padding: '12px', background: saving ? '#fca5a5' : 'linear-gradient(135deg,#e11d48,#be123c)', color: 'white', border: 'none', borderRadius: '10px', cursor: 'pointer', fontWeight: '700', fontSize: '15px' }}>{saving ? 'Saving...' : '✓ Confirm Return'}</button>
          </div>
        </div>
      </div>
    </div>
  )
}
