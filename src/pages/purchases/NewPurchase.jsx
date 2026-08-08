import { useState, useEffect, useRef } from 'react'
import { supabase } from '../../supabase'
import { formatCurrency } from '../../lib/helpers'
import { sendSMS, smsTemplates } from '../../lib/sms'
import toast from 'react-hot-toast'
import BarcodePrintModal from '../../components/BarcodePrintModal'

async function generatePurchaseNo() {
  const { data, error } = await supabase.rpc('generate_purchase_no')
  if (error) throw error
  return data
}

async function generateSupplierNo() {
  const { data, error } = await supabase.rpc('generate_supplier_no')
  if (error) throw error
  return data
}

async function generateItemNo() {
  const { data, error } = await supabase.rpc('generate_item_no')
  if (error) throw error
  return data
}

// Generate barcode string from supplier_no + item_no
function generateBarcode(supplierNo, itemNo) {
  const s = supplierNo.replace('SUP-', '').padStart(4, '0')
  const i = itemNo.replace('ITM-', '').padStart(5, '0')
  return `PF${s}${i}`
}

export default function NewPurchase({ onBack, activeShop, isCashier = false }) {
  const [purchaseNo, setPurchaseNo] = useState('')
  const [suppliers, setSuppliers] = useState([])
  const [items, setItems] = useState([])
  const [shops, setShops] = useState([])
  const [selectedSupplier, setSelectedSupplier] = useState(null)
  const [selectedShop, setSelectedShop] = useState(null)
  const [purchaseItems, setPurchaseItems] = useState([])
  const [barcodePromptItems, setBarcodePromptItems] = useState(null) // items to offer printing after a confirmed purchase
  const [paymentMethod, setPaymentMethod] = useState('credit')
  const [amountPaid, setAmountPaid] = useState('')
  const [chequeNo, setChequeNo] = useState('')
  const [chequeDate, setChequeDate] = useState('')
  const [chequeBankId, setChequeBankId] = useState('')
  const [bankTransferAccountId, setBankTransferAccountId] = useState('')
  const [cardBankAccountId, setCardBankAccountId] = useState('')
  const [bankAccounts, setBankAccounts] = useState([])
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [supplierSearch, setSupplierSearch] = useState('')
  const [showSupplierDrop, setShowSupplierDrop] = useState(false)
  const [showNewSupplier, setShowNewSupplier] = useState(false)
  const [newSupplier, setNewSupplier] = useState({ name: '', phone: '', address: '' })
  const [itemSearch, setItemSearch] = useState('')
  const [showItemDrop, setShowItemDrop] = useState(false)
  const [showNewItem, setShowNewItem] = useState(false)
  const [newItem, setNewItem] = useState({ name: '', selling_price: '', cost_price: '', last_price: '', brand_id: '', category_id: '' })
  const [brands, setBrands] = useState([])
  const [categories, setCategories] = useState([])
  const [showNewBrand, setShowNewBrand] = useState(false)
  const [newBrandName, setNewBrandName] = useState('')
  const [showNewCategory, setShowNewCategory] = useState(false)
  const [newCategoryName, setNewCategoryName] = useState('')
  const [newCategoryParent, setNewCategoryParent] = useState('')
  const itemSearchRef = useRef(null)
  const qtyRefs = useRef([])

  useEffect(() => { fetchData(); fetchBrandsAndCategories() }, [])

  async function fetchBrandsAndCategories() {
    const [{ data: b }, { data: c }] = await Promise.all([
      supabase.from('brands').select('*').order('name'),
      supabase.from('categories').select('*').order('name'),
    ])
    setBrands(b || [])
    setCategories(c || [])
  }

  // Top-level categories first, each followed by its subcategories — for an indented dropdown
  function categoryOptions() {
    const topLevel = categories.filter(c => !c.parent_category_id)
    const opts = []
    topLevel.forEach(top => {
      opts.push({ ...top, depth: 0 })
      categories.filter(c => c.parent_category_id === top.id).forEach(sub => opts.push({ ...sub, depth: 1 }))
    })
    return opts
  }

  async function saveNewBrand() {
    if (!newBrandName.trim()) return toast.error('Brand name is required')
    const { data, error } = await supabase.from('brands').insert({ name: newBrandName.trim() }).select().single()
    if (error) return toast.error(error.code === '23505' ? 'That brand already exists' : 'Failed to add brand')
    setBrands(prev => [...prev, data].sort((a, b) => a.name.localeCompare(b.name)))
    setNewItem(p => ({ ...p, brand_id: data.id }))
    setNewBrandName('')
    setShowNewBrand(false)
    toast.success('Brand added!')
  }

  async function saveNewCategory() {
    if (!newCategoryName.trim()) return toast.error('Category name is required')
    const { data, error } = await supabase.from('categories').insert({
      name: newCategoryName.trim(),
      parent_category_id: newCategoryParent || null,
    }).select().single()
    if (error) return toast.error(error.code === '23505' ? 'That category already exists under this parent' : 'Failed to add category')
    setCategories(prev => [...prev, data])
    setNewItem(p => ({ ...p, category_id: data.id }))
    setNewCategoryName('')
    setNewCategoryParent('')
    setShowNewCategory(false)
    toast.success('Category added!')
  }

  async function fetchData() {
    try {
      const [{ data: sup }, { data: itm }, { data: sh }, { data: banks }] = await Promise.all([
        supabase.from('suppliers').select('*').order('name'),
        supabase.from('items').select('*, brands(name), categories(name, parent_category_id)').order('name'),
        supabase.from('shops').select('*').order('name'),
        supabase.from('bank_accounts').select('*').order('name'),
      ])
      setSuppliers(sup || [])
      setItems(itm || [])
      setShops(sh || [])
      setBankAccounts(banks || [])
      if (sh && sh.length > 0) {
        if (activeShop) {
          setSelectedShop(sh.find(s => s.id === activeShop.id) || sh[0])
        } else {
          setSelectedShop(sh[0])
        }
      }
    } catch { toast.error('Failed to load data') }
  }

  const subtotal = purchaseItems.reduce((sum, r) => sum + (r.is_free_issue ? 0 : r.quantity * r.unit_cost), 0)
  const isCredit = paymentMethod === 'credit'
  const paidAmt = isCredit ? 0 : (parseFloat(amountPaid) || 0)
  // Stored credit = negative outstanding_balance on supplier (credit in our favour,
  // from a prior overpayment) — mirrors NewInvoice.jsx's storedCredit exactly.
  const storedCredit = selectedSupplier && (selectedSupplier.outstanding_balance || 0) < 0
    ? Math.abs(selectedSupplier.outstanding_balance)
    : 0
  const creditDue = Math.max(0, subtotal - paidAmt - storedCredit)

  function addItem(item) {
    // Always add as new row — allows same item twice (e.g. one regular, one free issue)
    setPurchaseItems(rows => [...rows, {
      item_id: item.id,
      name: item.name,
      item_no: item.item_no,
      barcode: item.barcode || '',
      quantity: 1,
      unit_cost: parseFloat(item.cost_price) || 0,
      is_free_issue: false,
      selling_price: parseFloat(item.selling_price) || 0,
      immi_no: '',
    }])
    setItemSearch('')
    setShowItemDrop(false)
    setTimeout(() => {
      const lastIdx = qtyRefs.current.length - 1
      if (qtyRefs.current[lastIdx]) {
        qtyRefs.current[lastIdx].focus()
        qtyRefs.current[lastIdx].select()
      }
    }, 50)
  }

  function updateRow(index, field, value) {
    setPurchaseItems(rows => rows.map((r, i) => i === index ? { ...r, [field]: value } : r))
  }

  function removeRow(index) {
    setPurchaseItems(rows => rows.filter((_, i) => i !== index))
  }

  async function createSupplier() {
    if (!newSupplier.name.trim()) return toast.error('Name is required')
    try {
      const supplier_no = await generateSupplierNo()
      const { data, error } = await supabase.from('suppliers')
        .insert({ supplier_no, ...newSupplier })
        .select().single()
      if (error) throw error
      setSuppliers(prev => [...prev, data])
      setSelectedSupplier(data)
      setSupplierSearch(data.name)
      setShowNewSupplier(false)
      setNewSupplier({ name: '', phone: '', address: '' })
      toast.success('Supplier created!')
    } catch { toast.error('Failed to create supplier') }
  }

  async function createItem() {
    if (!newItem.name.trim()) return toast.error('Item name is required')
    if (!selectedSupplier) return toast.error('Please select a supplier first')
    try {
      const item_no = await generateItemNo()
      const barcode = generateBarcode(selectedSupplier.supplier_no, item_no)
      const { data, error } = await supabase.from('items').insert({
        item_no,
        name: newItem.name,
        selling_price: parseFloat(newItem.selling_price) || 0,
        cost_price: parseFloat(newItem.cost_price) || 0,
        last_price: parseFloat(newItem.last_price) || 0,
        supplier_id: selectedSupplier.id,
        brand_id: newItem.brand_id || null,
        category_id: newItem.category_id || null,
        barcode,
      }).select().single()
      if (error) throw error
      setItems(prev => [...prev, data])
      addItem(data)
      setShowNewItem(false)
      setNewItem({ name: '', selling_price: '', cost_price: '', last_price: '', brand_id: '', category_id: '' })
      toast.success(`Item created! Barcode: ${barcode}`)
    } catch (e) { toast.error('Failed to create item: ' + e.message) }
  }

  async function savePurchase(status) {
    if (!selectedSupplier) return toast.error('Please select a supplier')
    if (purchaseItems.length === 0) return toast.error('Please add at least one item')
    if (status === 'confirmed' && paymentMethod === 'bank_transfer' && !bankTransferAccountId && paidAmt > 0) return toast.error('Select a bank account for the transfer')
    if (status === 'confirmed' && paymentMethod === 'card' && !cardBankAccountId && paidAmt > 0) return toast.error('Select the bank account where card receipts are deposited')
    setSaving(true)
    try {
      const newPurchaseNo = await generatePurchaseNo()

      // Cheques are provisional until cleared, so they're tracked exclusively via a
      // linked purchase_payments row (created below) rather than folded into
      // amount_paid — matching the fix already applied on the customer/invoice side.
      // Folding a cheque into amount_paid here meant that if it later bounced, there
      // was no purchase_payments row to mark returned at all, so the purchase would
      // permanently show as paid even after the cheque failed.
      const amountPaidAtCreation = paymentMethod === 'cheque' ? 0 : paidAmt

      // Atomically create purchase + line items in one DB transaction
      const { data: purchaseData, error: purchaseError } = await supabase.rpc('create_purchase_with_items', {
        p_purchase: {
          purchase_no: newPurchaseNo,
          supplier_id: selectedSupplier.id,
          shop_id: selectedShop?.id || null,
          status,
          payment_method: paymentMethod,
          amount_paid: amountPaidAtCreation,
          subtotal,
          total: subtotal,
          credit_amount: creditDue,
          notes: notes || null,
          immi_no: null,
        },
        p_items: purchaseItems.map(r => ({
          item_id: r.item_id,
          quantity: r.quantity,
          unit_cost: r.is_free_issue ? 0 : r.unit_cost,
          line_total: r.is_free_issue ? 0 : r.quantity * r.unit_cost,
          is_free_issue: r.is_free_issue || false,
          immi_no: r.immi_no || null,
        }))
      })
      if (purchaseError) throw purchaseError
      // create_purchase_with_items is declared `returns setof purchases` — Supabase's client
      // returns that as an array even though the function only ever yields one row.
      const purchase = Array.isArray(purchaseData) ? purchaseData[0] : purchaseData

      if (status === 'confirmed') {
        // Update inventory (FIFO - add new batch)
        for (const row of purchaseItems) {
          const effectiveCost = row.is_free_issue ? 0 : row.unit_cost
          await supabase.from('inventory').insert({
            item_id: row.item_id,
            shop_id: selectedShop?.id,
            quantity: row.quantity,
            cost_price: effectiveCost,
          })
          // Atomically add to stock_quantity via RPC (no read needed)
          await supabase.rpc('add_item_stock', { p_item_id: row.item_id, p_quantity: row.quantity })
          // Separately update cost_price (does not need to be atomic)
          if (!row.is_free_issue && effectiveCost) {
            await supabase.from('items').update({ cost_price: effectiveCost }).eq('id', row.item_id)
          }
        }

        // Consume any stored supplier credit first (partial OR full coverage — mirrors
        // the fix in NewInvoice.jsx: this must run unconditionally whenever storedCredit
        // exists, not only when it fully covers the purchase, or a partially-covering
        // credit would be silently left untouched).
        if (storedCredit > 0) {
          const creditUsed = Math.min(storedCredit, Math.max(0, subtotal - paidAmt))
          if (creditUsed > 0) {
            await supabase.rpc('adjust_supplier_balance', { p_supplier_id: selectedSupplier.id, p_delta: creditUsed })
          }
        }
        // Update supplier outstanding — creditDue already accounts for storedCredit
        // (see its calculation above), so this and the block above never double-count.
        if (creditDue > 0) {
          // Atomically increment supplier outstanding balance
          await supabase.rpc('adjust_supplier_balance', { p_supplier_id: selectedSupplier.id, p_delta: creditDue })
        }

        // Record cheque as a linked purchase_payments row + pending bank transaction —
        // matching the customer-side fix so a returned cheque has a real row to reverse.
        if (paymentMethod === 'cheque' && chequeBankId && chequeDate) {
          const { data: pp } = await supabase.from('purchase_payments').insert({
            purchase_id: purchase.id, amount: paidAmt, payment_method: 'cheque',
            bank_account_id: chequeBankId, cheque_no: chequeNo || null, cheque_date: chequeDate,
            cheque_status: 'pending', notes: 'Initial payment at purchase',
          }).select().single()
          const { data: btx } = await supabase.from('bank_transactions').insert({
            bank_account_id: chequeBankId,
            type: 'cheque_out',
            amount: paidAmt,
            cheque_no: chequeNo || null,
            cheque_date: chequeDate,
            cheque_status: 'pending',
            reference: `Purchase: ${newPurchaseNo}`,
            notes: `Supplier: ${selectedSupplier.name}`,
            shop_id: selectedShop?.id,
            purchase_payment_id: pp?.id || null,
          }).select().single()
          if (pp && btx) await supabase.from('purchase_payments').update({ bank_transaction_id: btx.id }).eq('id', pp.id)
        }

        // Bank transfer — deduct from selected account immediately
        if (paymentMethod === 'bank_transfer' && bankTransferAccountId && paidAmt > 0) {
          const { data: acc } = await supabase.from('bank_accounts').select('balance').eq('id', bankTransferAccountId).single()
          await supabase.from('bank_accounts').update({ balance: Math.max(0, (acc?.balance || 0) - paidAmt) }).eq('id', bankTransferAccountId)
          await supabase.from('bank_transactions').insert({
            bank_account_id: bankTransferAccountId,
            type: 'withdrawal',
            amount: paidAmt,
            reference: `Purchase: ${newPurchaseNo}`,
            notes: `Supplier: ${selectedSupplier.name} · Bank Transfer`,
          })
        }

        // Card payment — deduct from card machine's linked bank account
        if (paymentMethod === 'card' && cardBankAccountId && paidAmt > 0) {
          const { data: acc } = await supabase.from('bank_accounts').select('balance').eq('id', cardBankAccountId).single()
          await supabase.from('bank_accounts').update({ balance: Math.max(0, (acc?.balance || 0) - paidAmt) }).eq('id', cardBankAccountId)
          await supabase.from('bank_transactions').insert({
            bank_account_id: cardBankAccountId,
            type: 'withdrawal',
            amount: paidAmt,
            reference: `Purchase: ${newPurchaseNo}`,
            notes: `Supplier: ${selectedSupplier.name} · Card Payment`,
          })
        }
      }

      toast.success(status === 'draft' ? 'Saved as draft' : 'Purchase confirmed & stock updated!')

      // Offer to print barcode labels for the items just purchased
      if (status === 'confirmed') {
        const forPrint = purchaseItems.map(r => {
          const full = items.find(i => i.id === r.item_id)
          return {
            id: r.item_id,
            name: full?.name || 'Item',
            barcode: full?.barcode || null,
            selling_price: full?.selling_price || 0,
            qty: r.quantity,
          }
        })
        setBarcodePromptItems(forPrint)
      }

      // Auto-send SMS to supplier if confirmed and supplier has phone
      if (status === 'confirmed' && selectedSupplier.phone) {
        const { data: updatedSupplier } = await supabase.from('suppliers').select('outstanding_balance').eq('id', selectedSupplier.id).single()
        const newOutstanding = updatedSupplier?.outstanding_balance || 0
        const message = smsTemplates.purchaseConfirmed(
          selectedSupplier.name, newPurchaseNo, subtotal, newOutstanding,
          selectedShop?.name || 'iPHIX Technologies'
        )
        sendSMS({
          to: selectedSupplier.phone,
          message,
          triggeredBy: 'purchase_confirmed',
          referenceType: 'purchase',
          referenceId: purchase.id,
        }).then(({ success }) => {
          if (success) toast.success('SMS sent to supplier!')
        })
      }

      resetForm()
    } catch (e) {
      toast.error('Error: ' + e.message)
    }
    setSaving(false)
  }

  function resetForm() {
    setSelectedSupplier(null)
    setPurchaseItems([])
    setPaymentMethod('credit')
    setAmountPaid('')
    setNotes('')
    setSupplierSearch('')
    setPurchaseNo('')
    setChequeNo('')
    setChequeDate('')
    setChequeBankId('')
    setBankTransferAccountId('')
  }

  const filteredSuppliers = suppliers.filter(s =>
    s.name.toLowerCase().includes(supplierSearch.toLowerCase()) ||
    s.supplier_no?.toLowerCase().includes(supplierSearch.toLowerCase())
  )
  const filteredItems = items.filter(i =>
    i.name.toLowerCase().includes(itemSearch.toLowerCase()) ||
    i.item_no?.toLowerCase().includes(itemSearch.toLowerCase()) ||
    i.barcode?.toLowerCase().includes(itemSearch.toLowerCase())
  )

  const inp = { width: '100%', padding: '9px 12px', border: '1.5px solid #e2e8f0', borderRadius: '7px', fontSize: '14px', boxSizing: 'border-box', outline: 'none', background: 'white' }
  const lbl = { display: 'block', marginBottom: '5px', fontSize: '11px', fontWeight: '700', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.06em' }
  const card = { background: 'white', borderRadius: '12px', padding: '24px', boxShadow: '0 1px 3px rgba(15,23,42,0.06), 0 1px 2px rgba(15,23,42,0.04)', marginBottom: '16px', border: '1px solid #f1f5f9' }
  const drop = { position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0, background: 'white', border: '1.5px solid #e2e8f0', borderRadius: '10px', boxShadow: '0 8px 24px rgba(0,0,0,0.12)', zIndex: 200, maxHeight: '220px', overflowY: 'auto' }
  const dropItem = { padding: '10px 14px', cursor: 'pointer', fontSize: '14px', borderBottom: '1px solid #f8fafc', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }

  return (
    <div style={{ maxWidth: '1100px' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '24px' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '6px' }}>
            <button onClick={onBack}
              style={{ background: 'none', border: 'none', color: '#2563eb', cursor: 'pointer', fontSize: '14px', fontWeight: '600', padding: 0 }}>
              ← Purchases
            </button>
          </div>
          <h1 style={{ fontSize: '22px', fontWeight: '700', color: '#0f172a', margin: '0 0 4px' }}>New Purchase</h1>
          <span style={{ fontSize: '13px', color: '#94a3b8', fontStyle: 'italic' }}>Purchase no. assigned on save</span>
        </div>
        <div style={{ display: 'flex', gap: '10px' }}>
          <button onClick={() => savePurchase('draft')} disabled={saving}
            style={{ padding: '10px 20px', background: 'white', color: '#475569', border: '1.5px solid #e2e8f0', borderRadius: '10px', cursor: 'pointer', fontWeight: '600', fontSize: '14px' }}>
            Save Draft
          </button>
          <button onClick={() => savePurchase('confirmed')} disabled={saving}
            style={{ padding: '10px 24px', background: saving ? '#93c5fd' : 'linear-gradient(135deg,#2563eb,#1d4ed8)', color: 'white', border: 'none', borderRadius: '10px', cursor: 'pointer', fontWeight: '700', fontSize: '14px' }}>
            {saving ? 'Saving...' : '✓ Confirm & Update Stock'}
          </button>
        </div>
      </div>

      {/* Shop + Supplier */}
      <div style={{ ...card, display: 'grid', gridTemplateColumns: isCashier ? '1fr' : '1fr 1.5fr', gap: '20px' }}>
        {!isCashier && (
          <div>
            <label style={lbl}>Shop</label>
            <select value={selectedShop?.id || ''} onChange={e => setSelectedShop(shops.find(s => s.id === e.target.value))} style={inp}>
              {shops.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
        )}
        <div>
          <label style={lbl}>Supplier *</label>
          <div style={{ position: 'relative' }}>
            <input type="text" placeholder="Search supplier…" value={supplierSearch}
              onChange={e => { setSupplierSearch(e.target.value); setShowSupplierDrop(true); if (!e.target.value) setSelectedSupplier(null) }}
              onFocus={() => setShowSupplierDrop(true)}
              onBlur={() => setTimeout(() => setShowSupplierDrop(false), 180)}
              style={{ ...inp, paddingRight: '36px' }} />
            {selectedSupplier && <span style={{ position: 'absolute', right: '10px', top: '50%', transform: 'translateY(-50%)', color: '#22c55e', fontSize: '16px' }}>✓</span>}
            {showSupplierDrop && (
              <div style={drop}>
                {filteredSuppliers.length === 0 && supplierSearch && <div style={{ ...dropItem, color: '#94a3b8', justifyContent: 'center' }}>No results</div>}
                {filteredSuppliers.map(s => (
                  <div key={s.id} onMouseDown={() => { setSelectedSupplier(s); setSupplierSearch(s.name); setShowSupplierDrop(false) }}
                    style={dropItem} onMouseEnter={e => e.currentTarget.style.background = '#f8fafc'} onMouseLeave={e => e.currentTarget.style.background = 'white'}>
                    <span><span style={{ fontWeight: '700', color: '#2563eb', marginRight: '8px' }}>{s.supplier_no}</span>{s.name}</span>
                    {s.outstanding_balance > 0 && <span style={{ fontSize: '12px', color: '#e11d48', fontWeight: '700' }}>Due: {formatCurrency(s.outstanding_balance)}</span>}
                  </div>
                ))}
                <div onMouseDown={() => { setShowSupplierDrop(false); setShowNewSupplier(true) }}
                  style={{ ...dropItem, color: '#2563eb', fontWeight: '700', borderTop: '2px solid #e2e8f0', justifyContent: 'center' }}
                  onMouseEnter={e => e.currentTarget.style.background = '#f5f3ff'} onMouseLeave={e => e.currentTarget.style.background = 'white'}>
                  + New Supplier
                </div>
              </div>
            )}
          </div>
          {selectedSupplier && (
            <div style={{ marginTop: '8px', padding: '8px 12px', background: '#f0fdf4', borderRadius: '10px', border: '1px solid #bbf7d0', display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ fontSize: '13px', color: '#15803d', fontWeight: '600' }}>{selectedSupplier.supplier_no} · {selectedSupplier.name}</span>
              {selectedSupplier.outstanding_balance > 0 && <span style={{ fontSize: '12px', color: '#e11d48', fontWeight: '700' }}>Outstanding: {formatCurrency(selectedSupplier.outstanding_balance)}</span>}
            </div>
          )}
          {showNewSupplier && (
            <div style={{ marginTop: '12px', padding: '16px', background: '#fafafa', borderRadius: '10px', border: '1.5px solid #e2e8f0' }}>
              <p style={{ margin: '0 0 12px', fontWeight: '700', fontSize: '13px', color: '#0f172a' }}>New Supplier</p>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginBottom: '10px' }}>
                {[{ k: 'name', p: 'Company name *' }, { k: 'phone', p: 'Phone' }, { k: 'address', p: 'Address' }].map(f => (
                  <div key={f.k} style={f.k === 'address' ? { gridColumn: '1/-1' } : {}}>
                    <input type="text" placeholder={f.p} value={newSupplier[f.k]} onChange={e => setNewSupplier(p => ({ ...p, [f.k]: e.target.value }))} style={inp} />
                  </div>
                ))}
              </div>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button onClick={createSupplier} style={{ padding: '7px 16px', background: '#2563eb', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '13px', fontWeight: '600' }}>Create</button>
                <button onClick={() => setShowNewSupplier(false)} style={{ padding: '7px 14px', background: '#f1f5f9', color: '#64748b', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '13px' }}>Cancel</button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Items */}
      <div style={card}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
          <h2 style={{ margin: 0, fontSize: '15px', fontWeight: '700', color: '#0f172a' }}>Items</h2>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <span style={{ fontSize: '13px', color: '#94a3b8' }}>{purchaseItems.length} item{purchaseItems.length !== 1 ? 's' : ''}</span>
            <button onClick={() => { setShowItemDrop(false); setShowNewItem(v => !v) }}
              style={{ padding: '7px 16px', background: 'linear-gradient(135deg,#2563eb,#1d4ed8)', color: 'white', border: 'none', borderRadius: '7px', cursor: 'pointer', fontWeight: '700', fontSize: '13px' }}>
              + Add New Item
            </button>
          </div>
        </div>

        <div style={{ position: 'relative', marginBottom: '16px' }}>
          <input ref={itemSearchRef} type="text" placeholder="Search item name, code or barcode to add…"
            value={itemSearch}
            onChange={e => { setItemSearch(e.target.value); setShowItemDrop(true) }}
            onFocus={() => setShowItemDrop(true)}
            onBlur={() => setTimeout(() => setShowItemDrop(false), 180)}
            style={{ ...inp, background: '#f8fafc' }} />
          {showItemDrop && (
            <div style={drop}>
              {filteredItems.length === 0 && itemSearch && <div style={{ ...dropItem, color: '#94a3b8', justifyContent: 'center' }}>No items found</div>}
              {filteredItems.map(item => (
                <div key={item.id} onMouseDown={() => addItem(item)}
                  style={dropItem} onMouseEnter={e => e.currentTarget.style.background = '#f8fafc'} onMouseLeave={e => e.currentTarget.style.background = 'white'}>
                  <span>
                    <span style={{ fontWeight: '700', color: '#2563eb', marginRight: '8px', fontSize: '12px' }}>{item.item_no}</span>
                    {item.name}
                    {item.barcode && <span style={{ marginLeft: '8px', fontSize: '11px', color: '#94a3b8' }}>{item.barcode}</span>}
                  </span>
                  <span style={{ fontWeight: '700', color: '#64748b', fontSize: '13px' }}>{formatCurrency(item.cost_price)}</span>
                </div>
              ))}
              <div onMouseDown={() => { setShowItemDrop(false); setShowNewItem(true) }}
                style={{ ...dropItem, color: '#2563eb', fontWeight: '700', borderTop: '2px solid #e2e8f0', justifyContent: 'center' }}
                onMouseEnter={e => e.currentTarget.style.background = '#f5f3ff'} onMouseLeave={e => e.currentTarget.style.background = 'white'}>
                + Create New Item
              </div>
            </div>
          )}
        </div>

        {showNewItem && (
          <div style={{ marginBottom: '16px', padding: '16px', background: '#fafafa', borderRadius: '10px', border: '1.5px solid #e2e8f0' }}>
            <p style={{ margin: '0 0 4px', fontWeight: '700', fontSize: '13px', color: '#0f172a' }}>New Item</p>
            {selectedSupplier && <p style={{ margin: '0 0 12px', fontSize: '12px', color: '#2563eb' }}>Barcode will be auto-generated for {selectedSupplier.name}</p>}
            <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr', gap: '10px', marginBottom: '10px' }}>
              <div><label style={{ ...lbl, fontSize: '10px' }}>Item Name *</label><input type="text" placeholder="Item name" value={newItem.name} onChange={e => setNewItem(p => ({ ...p, name: e.target.value }))} style={inp} /></div>
              <div><label style={{ ...lbl, fontSize: '10px' }}>Cost Price</label><input type="number" placeholder="0.00" value={newItem.cost_price} onChange={e => setNewItem(p => ({ ...p, cost_price: e.target.value }))} style={inp} /></div>
              <div><label style={{ ...lbl, fontSize: '10px' }}>Selling Price</label><input type="number" placeholder="0.00" value={newItem.selling_price} onChange={e => setNewItem(p => ({ ...p, selling_price: e.target.value }))} style={inp} /></div>
              <div>
                <label style={{ ...lbl, fontSize: '10px' }}>Last Price (Min Floor)</label>
                <input type="number" placeholder="0.00" value={newItem.last_price} onChange={e => setNewItem(p => ({ ...p, last_price: e.target.value }))} style={{ ...inp, borderColor: '#fde68a' }} />
              </div>
            </div>
            <div style={{ padding: '8px 12px', background: '#fef9ec', borderRadius: '7px', fontSize: '12px', color: '#92400e', marginBottom: '10px', border: '1px solid #fde68a' }}>
              💡 Last Price = minimum allowed selling price on invoices. Invoices will be blocked if unit price is set below this.
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginBottom: '10px' }}>
              <div>
                <label style={{ ...lbl, fontSize: '10px' }}>Brand <span style={{ color: '#94a3b8', fontWeight: '400', textTransform: 'none' }}>(optional)</span></label>
                {showNewBrand ? (
                  <div style={{ display: 'flex', gap: '6px' }}>
                    <input type="text" value={newBrandName} onChange={e => setNewBrandName(e.target.value)}
                      placeholder="New brand name" style={inp} autoFocus
                      onKeyDown={e => e.key === 'Enter' && saveNewBrand()} />
                    <button onClick={saveNewBrand} style={{ padding: '7px 12px', background: '#059669', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: '700', fontSize: '12px', whiteSpace: 'nowrap' }}>Add</button>
                    <button onClick={() => { setShowNewBrand(false); setNewBrandName('') }} style={{ padding: '7px 10px', background: '#f1f5f9', color: '#64748b', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '12px' }}>✕</button>
                  </div>
                ) : (
                  <select value={newItem.brand_id} onChange={e => e.target.value === '__new__' ? setShowNewBrand(true) : setNewItem(p => ({ ...p, brand_id: e.target.value }))} style={inp}>
                    <option value="">— No Brand —</option>
                    {brands.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                    <option value="__new__">+ Add new brand…</option>
                  </select>
                )}
              </div>
              <div>
                <label style={{ ...lbl, fontSize: '10px' }}>Category <span style={{ color: '#94a3b8', fontWeight: '400', textTransform: 'none' }}>(optional)</span></label>
                {showNewCategory ? (
                  <div>
                    <input type="text" value={newCategoryName} onChange={e => setNewCategoryName(e.target.value)}
                      placeholder="New category name" style={{ ...inp, marginBottom: '6px' }} autoFocus
                      onKeyDown={e => e.key === 'Enter' && saveNewCategory()} />
                    <div style={{ display: 'flex', gap: '6px' }}>
                      <select value={newCategoryParent} onChange={e => setNewCategoryParent(e.target.value)} style={{ ...inp, fontSize: '12px' }}>
                        <option value="">— Top-level —</option>
                        {categoryOptions().filter(c => c.depth === 0).map(c => <option key={c.id} value={c.id}>Sub of: {c.name}</option>)}
                      </select>
                      <button onClick={saveNewCategory} style={{ padding: '7px 12px', background: '#059669', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: '700', fontSize: '12px', whiteSpace: 'nowrap' }}>Add</button>
                      <button onClick={() => { setShowNewCategory(false); setNewCategoryName(''); setNewCategoryParent('') }} style={{ padding: '7px 10px', background: '#f1f5f9', color: '#64748b', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '12px' }}>✕</button>
                    </div>
                  </div>
                ) : (
                  <select value={newItem.category_id} onChange={e => e.target.value === '__new__' ? setShowNewCategory(true) : setNewItem(p => ({ ...p, category_id: e.target.value }))} style={inp}>
                    <option value="">— No Category —</option>
                    {categoryOptions().map(c => <option key={c.id} value={c.id}>{c.depth > 0 ? `— ${c.name}` : c.name}</option>)}
                    <option value="__new__">+ Add new category…</option>
                  </select>
                )}
              </div>
            </div>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button onClick={createItem} style={{ padding: '7px 16px', background: '#2563eb', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '13px', fontWeight: '600' }}>Create & Add</button>
              <button onClick={() => setShowNewItem(false)} style={{ padding: '7px 14px', background: '#f1f5f9', color: '#64748b', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '13px' }}>Cancel</button>
            </div>
          </div>
        )}

        {purchaseItems.length > 0 ? (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: '#f8fafc', borderBottom: '2px solid #e2e8f0' }}>
                {['#', 'Item', 'Barcode', 'Immi No', 'Qty', 'Unit Cost (LKR)', 'Selling Price (LKR)', 'Free Issue', 'Line Total', ''].map((h, i) => (
                  <th key={i} style={{ padding: '10px 12px', textAlign: i === 0 ? 'center' : i >= 7 ? 'right' : 'left', fontSize: '11px', fontWeight: '700', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {purchaseItems.map((row, idx) => (
                <tr key={idx} style={{ borderBottom: '1px solid #f1f5f9' }}>
                  <td style={{ padding: '12px', textAlign: 'center', fontSize: '12px', color: '#94a3b8', fontWeight: '700' }}>{idx + 1}</td>
                  <td style={{ padding: '12px', fontSize: '14px', fontWeight: '600', color: '#0f172a' }}>
                    <div>{row.name}</div>
                    <div style={{ fontSize: '11px', color: '#2563eb', fontWeight: '700' }}>{row.item_no}</div>
                  </td>
                  <td style={{ padding: '12px', fontSize: '12px', color: '#94a3b8', fontFamily: 'monospace' }}>{row.barcode || '—'}</td>
                  <td style={{ padding: '12px' }}>
                    <input type="text" value={row.immi_no || ''}
                      onChange={e => updateRow(idx, 'immi_no', e.target.value)}
                      placeholder="Immi no…"
                      style={{ ...inp, width: '110px', fontSize: '12px' }} />
                  </td>
                  <td style={{ padding: '12px' }}>
                    <input type="number" value={row.quantity} min="1" step="1"
                      ref={el => qtyRefs.current[idx] = el}
                      onChange={e => updateRow(idx, 'quantity', parseFloat(e.target.value) || 1)}
                      onFocus={e => e.target.select()}
                      onKeyDown={e => {
                        if (e.key === 'Enter' || (e.key === 'Tab' && !e.shiftKey)) {
                          e.preventDefault()
                          itemSearchRef.current?.focus()
                        }
                      }}
                      style={{ ...inp, width: '80px', textAlign: 'center', fontWeight: '700' }} />
                  </td>
                  <td style={{ padding: '12px' }}>
                    <input type="number" value={row.unit_cost} min="0" step="1"
                      onChange={e => updateRow(idx, 'unit_cost', parseFloat(e.target.value) || 0)}
                      onFocus={e => e.target.select()}
                      style={{ ...inp, width: '120px', textAlign: 'right', fontWeight: '600' }} />
                  </td>
                  <td style={{ padding: '12px' }}>
                    <input type="number" value={row.selling_price} min="0" step="1"
                      onChange={e => updateRow(idx, 'selling_price', parseFloat(e.target.value) || 0)}
                      onFocus={e => e.target.select()}
                      style={{ ...inp, width: '120px', textAlign: 'right', fontWeight: '600', borderColor: '#bbf7d0' }} />
                  </td>
                  <td style={{ padding: '12px' }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', userSelect: 'none' }}>
                      <input type="checkbox" checked={row.is_free_issue || false}
                        onChange={e => { updateRow(idx, 'is_free_issue', e.target.checked); if (e.target.checked) updateRow(idx, 'unit_cost', 0) }}
                        style={{ accentColor: '#2563eb', width: '15px', height: '15px', cursor: 'pointer' }} />
                      <span style={{ fontSize: '11px', fontWeight: '700', color: row.is_free_issue ? '#2563eb' : '#94a3b8' }}>Free</span>
                    </label>
                  </td>
                  <td style={{ padding: '12px', textAlign: 'right', fontSize: '15px', fontWeight: '700', color: row.is_free_issue ? '#94a3b8' : '#059669' }}>
                    {row.is_free_issue
                      ? <span style={{ fontSize: '12px', background: '#eef2ff', color: '#2563eb', padding: '2px 8px', borderRadius: '12px', fontWeight: '700' }}>FREE</span>
                      : formatCurrency(row.quantity * row.unit_cost)}
                  </td>
                  <td style={{ padding: '12px', textAlign: 'right' }}>
                    <button onClick={() => removeRow(idx)} style={{ width: '28px', height: '28px', background: '#fee2e2', color: '#dc2626', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '14px' }}>✕</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div style={{ padding: '40px', textAlign: 'center', color: '#cbd5e1', fontSize: '14px', border: '2px dashed #e2e8f0', borderRadius: '10px' }}>
            <div style={{ fontSize: '28px', marginBottom: '8px' }}>📦</div>
            Search above to add items to this purchase
          </div>
        )}
      </div>

      {/* Payment + Summary */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
        <div style={card}>
          <h2 style={{ margin: '0 0 16px', fontSize: '15px', fontWeight: '700', color: '#0f172a' }}>Payment Details</h2>
          <div style={{ marginBottom: '14px' }}>
            <label style={lbl}>Payment Method</label>
            <select value={paymentMethod} onChange={e => { setPaymentMethod(e.target.value); setAmountPaid(''); setChequeNo(''); setChequeDate(''); setChequeBankId(''); setBankTransferAccountId('') }} style={inp}>
              <option value="credit">Credit (Pay Later)</option>
              <option value="cash">Cash</option>
              <option value="card">Card</option>
              <option value="cheque">Cheque</option>
              <option value="bank_transfer">Bank Transfer</option>
            </select>
          </div>
          {!isCredit && (
            <div style={{ marginBottom: '14px' }}>
              <label style={lbl}>Amount Paid (LKR)</label>
              <input type="number" value={amountPaid} min="0" onChange={e => setAmountPaid(e.target.value)} placeholder="0.00" style={{ ...inp, fontSize: '16px', fontWeight: '600' }} />
            </div>
          )}
          {paymentMethod === 'bank_transfer' && (
            <div style={{ marginBottom: '14px' }}>
              <label style={lbl}>Bank Account * (deducted from)</label>
              <select value={bankTransferAccountId} onChange={e => setBankTransferAccountId(e.target.value)}
                style={{ ...inp, borderColor: !bankTransferAccountId ? '#fca5a5' : '#e2e8f0' }}>
                <option value="">— Select account —</option>
                {bankAccounts.map(b => (
                  <option key={b.id} value={b.id}>
                    {b.name} — {b.bank_name} (LKR {(b.balance || 0).toLocaleString('en-LK', { minimumFractionDigits: 2 })})
                  </option>
                ))}
              </select>
              {bankTransferAccountId && (
                <div style={{ marginTop: '6px', padding: '8px 12px', background: '#fef3c7', borderRadius: '7px', fontSize: '12px', color: '#92400e' }}>
                  💡 LKR {parseFloat(amountPaid || 0).toLocaleString('en-LK', { minimumFractionDigits: 2 })} will be deducted from this account on confirm
                </div>
              )}
            </div>
          )}
          {paymentMethod === 'cheque' && (
            <>
              <div style={{ marginBottom: '14px' }}>
                <label style={lbl}>Bank Account *</label>
                <select value={chequeBankId} onChange={e => setChequeBankId(e.target.value)} style={{ ...inp, borderColor: !chequeBankId ? '#fca5a5' : '#e2e8f0' }}>
                  <option value="">Select bank account</option>
                  {bankAccounts.map(b => <option key={b.id} value={b.id}>{b.name} — {b.bank_name}</option>)}
                </select>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '14px' }}>
                <div>
                  <label style={lbl}>Cheque No</label>
                  <input type="text" value={chequeNo} onChange={e => setChequeNo(e.target.value)} placeholder="Cheque number" style={inp} />
                </div>
                <div>
                  <label style={lbl}>Cheque Date *</label>
                  <input type="date" value={chequeDate} onChange={e => setChequeDate(e.target.value)} style={{ ...inp, borderColor: !chequeDate ? '#fca5a5' : '#e2e8f0' }} />
                </div>
              </div>
              {chequeDate && (
                <div style={{ padding: '10px 12px', background: '#fef3c7', borderRadius: '10px', border: '1px solid #fde68a', marginBottom: '14px', fontSize: '13px', color: '#92400e' }}>
                  💡 Cheque will appear in Bank → Cheques Due on {new Date(chequeDate).toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' })}
                </div>
              )}
            </>
          )}
          <div>
            <label style={lbl}>Notes</label>
            <textarea value={notes} onChange={e => setNotes(e.target.value)} placeholder="Invoice no, delivery note, etc…" rows={3} style={{ ...inp, resize: 'vertical', lineHeight: '1.5' }} />
          </div>
        </div>

        <div style={card}>
          <h2 style={{ margin: '0 0 16px', fontSize: '15px', fontWeight: '700', color: '#0f172a' }}>Purchase Summary</h2>
          <div style={{ display: 'flex', justifyContent: 'space-between', padding: '14px 16px', background: '#0f172a', borderRadius: '10px', marginBottom: '12px' }}>
            <span style={{ fontSize: '16px', color: '#94a3b8', fontWeight: '600' }}>Total Cost</span>
            <span style={{ fontSize: '22px', color: 'white', fontWeight: '800' }}>{formatCurrency(subtotal)}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', padding: '9px 0', borderBottom: '1px solid #f1f5f9', marginBottom: storedCredit > 0 ? '4px' : '12px' }}>
            <span style={{ fontSize: '14px', color: '#64748b' }}>Amount Paid</span>
            <span style={{ fontSize: '15px', color: '#059669', fontWeight: '700' }}>{formatCurrency(paidAmt)}</span>
          </div>

          {storedCredit > 0 && (
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '9px 0', borderBottom: '1px solid #f1f5f9', marginBottom: '12px' }}>
              <span style={{ fontSize: '14px', color: '#64748b' }}>Stored Supplier Credit Applied</span>
              <span style={{ fontSize: '15px', color: '#059669', fontWeight: '700' }}>-{formatCurrency(Math.min(storedCredit, Math.max(0, subtotal - paidAmt)))}</span>
            </div>
          )}

          {creditDue > 0 && (
            <div style={{ padding: '14px 16px', background: '#fff1f2', borderRadius: '10px', border: '1.5px solid #fecdd3', marginBottom: '16px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <div style={{ fontSize: '13px', fontWeight: '700', color: '#e11d48' }}>Payable to Supplier</div>
                  <div style={{ fontSize: '12px', color: '#fb7185', marginTop: '2px' }}>Will be added to supplier outstanding</div>
                </div>
                <div style={{ fontSize: '20px', fontWeight: '800', color: '#e11d48' }}>{formatCurrency(creditDue)}</div>
              </div>
            </div>
          )}

          <div style={{ padding: '12px 14px', background: '#f0fdf4', borderRadius: '10px', border: '1px solid #bbf7d0', marginBottom: '16px' }}>
            <div style={{ fontSize: '12px', fontWeight: '700', color: '#166534', marginBottom: '4px' }}>📦 Stock Update</div>
            <div style={{ fontSize: '13px', color: '#15803d' }}>
              Confirming will add {purchaseItems.reduce((s, r) => s + r.quantity, 0)} units across {purchaseItems.length} item{purchaseItems.length !== 1 ? 's' : ''} to inventory
            </div>
          </div>

          <div style={{ display: 'flex', gap: '10px' }}>
            <button onClick={() => savePurchase('draft')} disabled={saving}
              style={{ flex: 1, padding: '12px', background: 'white', color: '#475569', border: '1.5px solid #e2e8f0', borderRadius: '10px', cursor: 'pointer', fontWeight: '600', fontSize: '14px' }}>
              Save Draft
            </button>
            <button onClick={() => savePurchase('confirmed')} disabled={saving}
              style={{ flex: 2, padding: '12px', background: saving ? '#93c5fd' : 'linear-gradient(135deg,#2563eb,#1d4ed8)', color: 'white', border: 'none', borderRadius: '10px', cursor: 'pointer', fontWeight: '700', fontSize: '15px' }}>
              {saving ? 'Saving...' : '✓ Confirm & Update Stock'}
            </button>
          </div>
        </div>
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
