import { useState, useEffect, useRef } from 'react'
import { supabase } from '../../supabase'
import { generateInvoiceNo, generateCustomerNo, generateItemNo, formatCurrency } from '../../lib/helpers'
import { SUPER_ADMIN_EMAIL } from '../../lib/config'
import { sendSMS, smsTemplates } from '../../lib/sms'
import toast from 'react-hot-toast'

export default function NewInvoice({ onBack, activeShop, isCashier = false, session }) {
  function safeBack() {
    if (invoiceItems.length > 0) {
      if (!window.confirm('You have unsaved items in this invoice. Leave without saving?')) return
    }
    onBack()
  }
  const [invoiceNo, setInvoiceNo] = useState('')
  const [invoiceDate] = useState(new Date())
  const [customers, setCustomers] = useState([])
  const [salesmen, setSalesmen] = useState([])
  const [items, setItems] = useState([])
  const [shops, setShops] = useState([])
  const [selectedShop, setSelectedShop] = useState(null)
  const [selectedCustomer, setSelectedCustomer] = useState(null)
  const [isCashCustomer, setIsCashCustomer] = useState(false)
  const [thirdPartySuppliers, setThirdPartySuppliers] = useState([])
  const [overpaymentModal, setOverpaymentModal] = useState(null) // { excess, creditBalance, pendingStatus }
  const [overpaymentChoice, setOverpaymentChoice] = useState(null) // 'deduct' | 'store' // saved supplier suggestions
  const [selectedSalesman, setSelectedSalesman] = useState(null)
  const [invoiceItems, setInvoiceItems] = useState([])
  const [paymentMethod, setPaymentMethod] = useState('cash')
  const [amountPaid, setAmountPaid] = useState('')
  const [chequeNo, setChequeNo] = useState('')
  const [chequeDate, setChequeDate] = useState('')
  const [chequeBankName, setChequeBankName] = useState('')
  const [discountPercent, setDiscountPercent] = useState('')
  const [discountAmount, setDiscountAmount] = useState('')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [customerSearch, setCustomerSearch] = useState('')
  const [showCustomerDrop, setShowCustomerDrop] = useState(false)
  const [showNewCustomer, setShowNewCustomer] = useState(false)
  const [newCustomer, setNewCustomer] = useState({ name: '', phone: '', address: '' })
  const [itemSearch, setItemSearch] = useState('')
  const [showItemDrop, setShowItemDrop] = useState(false)
  const [showAdvancedCols, setShowAdvancedCols] = useState(true)
  const [showNewItem, setShowNewItem] = useState(false)
  const [newItem, setNewItem] = useState({ name: '', selling_price: '', cost_price: '' })
  const [shopPrices, setShopPrices] = useState({}) // { item_id: { selling_price, last_price } }
  const [showPrintOptions, setShowPrintOptions] = useState(false)
  const [lastInvoice, setLastInvoice] = useState(null)
  const [dropHighlight, setDropHighlight] = useState(-1)
  const [itemDropHighlight, setItemDropHighlight] = useState(-1)
  const [bankAccounts, setBankAccounts] = useState([])
  const [bankTransferAccountId, setBankTransferAccountId] = useState('')
  const [cardBankAccountId, setCardBankAccountId] = useState('')
  const itemSearchRef = useRef(null)
  const qtyRefs = useRef([])

  // Warn browser on tab close/refresh when invoice has items
  useEffect(() => {
    const handler = (e) => {
      if (invoiceItems.length > 0) { e.preventDefault(); e.returnValue = '' }
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [invoiceItems.length])

  useEffect(() => { initInvoice(); fetchData() }, [])

  async function initInvoice() {
    // Don't generate invoice number on load — this wastes sequence numbers every page open.
    // The number is generated at save time only.
    setInvoiceNo('AUTO')
  }

  async function fetchData() {
    try {
      const shopId = activeShop?.id
      const [{ data: c }, { data: s }, { data: i }, { data: sh }, { data: tp }, { data: banks }, { data: sp }] = await Promise.all([
        supabase.from('customers').select('*').order('name'),
        supabase.from('salesmen').select('*').order('name'),
        supabase.from('items').select('*').order('name'),
        supabase.from('shops').select('*').order('name'),
        supabase.from('third_party_suppliers').select('*').order('use_count', { ascending: false }).limit(20),
        supabase.from('bank_accounts').select('*').order('name'),
        shopId ? supabase.from('shop_prices').select('item_id, selling_price, last_price').eq('shop_id', shopId) : Promise.resolve({ data: [] }),
      ])
      setCustomers(c || [])
      setSalesmen(s || [])
      setItems(i || [])
      setShops(sh || [])
      setThirdPartySuppliers(tp || [])
      // Build shop price map: { item_id: { selling_price, last_price } }
      const priceMap = {}
      ;(sp || []).forEach(p => { priceMap[p.item_id] = { selling_price: p.selling_price, last_price: p.last_price } })
      setShopPrices(priceMap)
      setBankAccounts(banks || [])
      if (sh && sh.length > 0) {
        // Cashier: always use their assigned shop
        if (activeShop) {
          const match = sh.find(s => s.id === activeShop.id)
          setSelectedShop(match || sh[0])
        } else {
          setSelectedShop(sh[0])
        }
      }
      // Auto-select salesman linked to current user
      await autoSelectSalesman(s || [], session?.user)
    } catch { toast.error('Failed to load data') }
  }

  async function autoSelectSalesman(list, user) {
    if (!user?.id || !list.length) return
    // 1. Match by user_id on salesmen table
    let match = list.find(s => s.user_id === user.id)
    // 2. Fallback: match by full_name from user_profiles
    if (!match) {
      const { data: profile } = await supabase.from('user_profiles').select('full_name').eq('id', user.id).single()
      if (profile?.full_name) match = list.find(s => s.name?.toLowerCase().trim() === profile.full_name?.toLowerCase().trim())
    }
    // 3. Fallback: match by email prefix
    if (!match && user.email) {
      const prefix = user.email.split('@')[0].toLowerCase()
      match = list.find(s => s.name?.toLowerCase().replace(/\s+/g, '') === prefix)
    }
    if (match) {
      setSelectedSalesman(match)
      // Back-fill user_id if missing
      if (!match.user_id) supabase.from('salesmen').update({ user_id: user.id }).eq('id', match.id).then(() => {})
    }
  }

  const subtotal = invoiceItems.reduce((sum, r) => sum + (r.is_free_issue ? 0 : r.quantity * r.unit_price), 0)
  const discPct = parseFloat(discountPercent) || 0
  const discAmt = discountPercent ? (subtotal * discPct) / 100 : parseFloat(discountAmount) || 0
  const total = Math.max(0, subtotal - discAmt)
  const isCredit = paymentMethod === 'credit'
  const isPartial = paymentMethod === 'partial'
  // Blank Amount Paid always means "nothing paid yet" (0), regardless of payment method —
  // a customer owes the full amount until an explicit figure is entered. This applies to
  // credit too, where it was already 0, so isCredit no longer needs a special case here.
  const paidAmt = (amountPaid === '' || amountPaid === null || amountPaid === undefined)
    ? 0
    : (parseFloat(amountPaid) || 0)
  // Stored credit = negative credit_balance on customer (credit in their favour)
  const storedCredit = selectedCustomer && !isCashCustomer && (selectedCustomer.credit_balance || 0) < 0
    ? Math.abs(selectedCustomer.credit_balance)
    : 0
  const creditDue = Math.max(0, total - paidAmt - storedCredit)
  const overpayment = !isCredit && paidAmt > total ? paidAmt - total : 0

  async function addItem(item) {
    // Fetch latest immi_no for this item from purchase_items
    let immi_no = ''
    try {
      const { data: lastPurchaseLine } = await supabase
        .from('purchase_items')
        .select('immi_no')
        .eq('item_id', item.id)
        .not('immi_no', 'is', null)
        .order('created_at', { ascending: false })
        .limit(1)
        .single()
      immi_no = lastPurchaseLine?.immi_no || ''
    } catch { immi_no = '' }

    // Use shop-specific price if available, otherwise fall back to item default
    const shopPrice = shopPrices[item.id]
    const unitPrice = shopPrice ? (parseFloat(shopPrice.selling_price) || 0) : (parseFloat(item.selling_price) || 0)
    setInvoiceItems(rows => [...rows, { item_id: item.id, name: item.name, quantity: 1, unit_price: unitPrice, warranty: 'no', immi_no, is_free_issue: false, is_third_party: false, tp_supplier_name: '', tp_supplier_phone: '', tp_reference: '' }])
    setItemSearch('')
    setShowItemDrop(false)
    // Focus the qty input of the newly added row so user can type qty immediately
    setTimeout(() => {
      const lastIdx = qtyRefs.current.length - 1
      if (qtyRefs.current[lastIdx]) {
        qtyRefs.current[lastIdx].focus()
        qtyRefs.current[lastIdx].select()
      }
    }, 50)
  }

  function updateRow(index, field, value) {
    setInvoiceItems(rows => rows.map((r, i) => i === index ? { ...r, [field]: value } : r))
  }

  function removeRow(index) {
    setInvoiceItems(rows => rows.filter((_, i) => i !== index))
  }

  async function createCustomer() {
    if (!newCustomer.name.trim()) return toast.error('Name is required')
    try {
      const customer_no = await generateCustomerNo()
      const { data, error } = await supabase.from('customers').insert({ customer_no, ...newCustomer }).select().single()
      if (error) throw error
      setCustomers(prev => [...prev, data])
      setSelectedCustomer(data)
      setCustomerSearch(data.name)
      setShowNewCustomer(false)
      setNewCustomer({ name: '', phone: '', address: '' })
      toast.success('Customer created!')
    } catch { toast.error('Failed to create customer') }
  }

  async function createItem() {
    if (!newItem.name.trim()) return toast.error('Item name is required')
    if (!newItem.selling_price) return toast.error('Selling price is required')
    try {
      const item_no = await generateItemNo()
      const { data, error } = await supabase.from('items').insert({ item_no, name: newItem.name, selling_price: parseFloat(newItem.selling_price), cost_price: parseFloat(newItem.cost_price) || 0 }).select().single()
      if (error) throw error
      setItems(prev => [...prev, data])
      addItem(data)
      setShowNewItem(false)
      setNewItem({ name: '', selling_price: '', cost_price: '' })
      toast.success('Item created!')
    } catch { toast.error('Failed to create item') }
  }

  async function saveInvoice(status, overpaymentResolution = null) {
    if (!selectedCustomer) return toast.error('Please select a customer')
    if (!selectedSalesman) return toast.error('Please select a salesman')
    if (invoiceItems.length === 0) return toast.error('Please add at least one item')
    if (paymentMethod === 'bank_transfer' && !bankTransferAccountId && paidAmt > 0) return toast.error('Please select a bank account for the transfer')
    if (paymentMethod === 'card' && !cardBankAccountId && paidAmt > 0) return toast.error('Please select the bank account where card receipts are deposited')

    // Minimum price validation — block if any item is below its last_price (minimum floor)
    for (const row of invoiceItems) {
      if (row.is_free_issue) continue
      const itemData = items.find(i => i.id === row.item_id)
      const shopP = shopPrices[row.item_id]
      const effectiveLastPrice = shopP?.last_price > 0 ? shopP.last_price : (itemData?.last_price || 0)
      if (effectiveLastPrice > 0 && row.unit_price < effectiveLastPrice) {
        toast.error(`"${row.name}": price LKR ${row.unit_price.toLocaleString('en-LK', { minimumFractionDigits: 2 })} is below the minimum price of LKR ${effectiveLastPrice.toLocaleString('en-LK', { minimumFractionDigits: 2 })}`)
        return
      }
    }

    // Intercept overpayment on confirm — show modal first
    if (status === 'confirmed' && overpayment > 0 && !isCashCustomer && overpaymentResolution === null) {
      setOverpaymentModal({
        excess: overpayment,
        creditBalance: selectedCustomer.credit_balance || 0,
      })
      setOverpaymentChoice(null)
      return
    }

    // Stock validation for confirmed invoices (skip 3rd party items)
    if (status === 'confirmed') {
      for (const row of invoiceItems) {
        if (row.is_third_party) continue
        const { data: item } = await supabase.from('items').select('stock_quantity, name').eq('id', row.item_id).single()
        if (item && (item.stock_quantity || 0) < row.quantity) {
          toast.error(`Not enough stock for "${item.name}". Available: ${item.stock_quantity || 0}, Required: ${row.quantity}`)
          return
        }
      }
    }

    if (saving) return  // Extra guard against double-click race condition
    setSaving(true)
    try {
      // Resolve cash customer — find or create the real DB record
      let customerId = selectedCustomer.id
      if (isCashCustomer || selectedCustomer.id === 'cash') {
        const { data: existing } = await supabase.from('customers').select('id').eq('customer_no', 'CASH').single()
        if (existing) {
          customerId = existing.id
        } else {
          const { data: newCash } = await supabase.rpc('generate_customer_no').then(async ({ data: custNo }) => {
            return supabase.from('customers').insert({ customer_no: 'CASH', name: 'Cash Customer', phone: null }).select().single()
          })
          customerId = newCash?.id
        }
      }

      // Generate invoice number at save time (not on page load, to avoid wasting sequence numbers)
      let newInvoiceNo = (invoiceNo === 'AUTO' || !invoiceNo) ? await generateInvoiceNo() : invoiceNo
      if (!newInvoiceNo || newInvoiceNo === 'AUTO') {
        // Retry once if generation failed
        newInvoiceNo = await generateInvoiceNo()
      }
      if (!newInvoiceNo || newInvoiceNo === 'AUTO') {
        setSaving(false)
        return toast.error('Failed to generate invoice number. Please try again.')
      }
      setInvoiceNo(newInvoiceNo)
      // How much stored credit was applied to this invoice
      const creditApplied = storedCredit > 0 ? Math.min(storedCredit, Math.max(0, total - paidAmt)) : 0
      // amount_paid must only ever reflect money actually received at creation time —
      // never stored credit applied. Credit consumption is tracked separately via
      // adjust_customer_balance below (customers.credit_balance), which is the correct
      // single source of truth for it. Folding creditApplied into amount_paid here was
      // the actual bug: it made the invoice's own "amount_paid" lie about what happened,
      // and caused the Activity Statement to display a phantom "cash payment received"
      // event for money that was really an existing credit balance being drawn down,
      // not new money coming in.
      const amountPaidAtCreation = paymentMethod === 'cheque' ? 0 : paidAmt

      // Atomically create invoice + line items in one DB transaction
      const { data: invData, error: invErr } = await supabase.rpc('create_invoice_with_items', {
        p_invoice: {
          invoice_no: newInvoiceNo, shop_id: selectedShop?.id || null,
          customer_id: customerId, salesman_id: selectedSalesman.id,
          status, payment_method: paymentMethod, amount_paid: amountPaidAtCreation,
          discount_percent: discPct, discount_amount: discAmt,
          subtotal, total, credit_amount: creditDue, notes: notes || null,
          cash_customer: isCashCustomer,
          cheque_no: paymentMethod === 'cheque' ? chequeNo : null,
          cheque_date: paymentMethod === 'cheque' ? chequeDate : null,
          cheque_bank_name: paymentMethod === 'cheque' ? chequeBankName : null,
        },
        p_items: invoiceItems.map(r => ({
          item_id: r.item_id,
          quantity: r.quantity,
          unit_price: r.is_free_issue ? 0 : r.unit_price,
          line_total: r.is_free_issue ? 0 : r.quantity * r.unit_price,
          warranty: r.warranty || 'no',
          immi_no: r.immi_no || null,
          is_free_issue: r.is_free_issue || false,
          is_third_party: r.is_third_party || false,
        }))
      })
      if (invErr) throw invErr
      // create_invoice_with_items is declared `returns setof invoices` — Supabase's client
      // returns that as an array even though the function only ever yields one row.
      const inv = Array.isArray(invData) ? invData[0] : invData

      // Consume any stored credit first (partial OR full coverage — previously this only
      // ran when storedCredit fully covered the invoice, via an else-if that never
      // triggered once creditDue was still positive; a partially-covering credit was
      // silently never touched at all).
      if (storedCredit > 0) {
        const creditUsed = Math.min(storedCredit, Math.max(0, total - paidAmt))
        if (creditUsed > 0) {
          await supabase.rpc('adjust_customer_balance', { p_customer_id: selectedCustomer.id, p_delta: creditUsed })
        }
      }
      if (creditDue > 0 && !isCashCustomer) {
        // Atomically add new credit due to balance — never for cash customers.
        // creditDue already accounts for storedCredit (see its calculation above), so
        // this and the block above never double-count the same money.
        await supabase.rpc('adjust_customer_balance', { p_customer_id: selectedCustomer.id, p_delta: creditDue })
      }

      // Handle overpayment resolution
      if (overpayment > 0 && !isCashCustomer) {
        const currentBalance = selectedCustomer.credit_balance || 0
        if (overpaymentResolution === 'deduct') {
          if (currentBalance <= 0) {
            // No outstanding — store full overpayment as credit
            await supabase.from('customers').update({ credit_balance: currentBalance - overpayment }).eq('id', selectedCustomer.id)
            toast.success(`No outstanding balance — ${formatCurrency(overpayment)} stored as credit`)
          } else if (overpayment >= currentBalance) {
            // Overpayment covers all outstanding, remainder stored as credit
            const remainder = overpayment - currentBalance
            await supabase.from('customers').update({ credit_balance: -remainder }).eq('id', selectedCustomer.id)
            if (remainder > 0) {
              toast.success(`Outstanding cleared. Remaining ${formatCurrency(remainder)} stored as credit`)
            } else {
              toast.success(`Outstanding of ${formatCurrency(currentBalance)} fully cleared`)
            }
          } else {
            // Overpayment partially reduces outstanding
            await supabase.from('customers').update({ credit_balance: currentBalance - overpayment }).eq('id', selectedCustomer.id)
            toast.success(`${formatCurrency(overpayment)} deducted from outstanding balance`)
          }
        } else if (overpaymentResolution === 'store') {
          // Store as negative credit (credit in customer's favour)
          await supabase.from('customers').update({ credit_balance: currentBalance - overpayment }).eq('id', selectedCustomer.id)
          toast.success(`${formatCurrency(overpayment)} stored as credit for future invoices`)
        }
      }

      // Deduct stock on confirm — guarded by stock_deducted flag to prevent double deduction
      if (status === 'confirmed') {
        for (const row of invoiceItems) {
          if (!row.is_third_party) {
            // 1. Atomically deduct from items.stock_quantity using RPC
            await supabase.rpc('deduct_item_stock', { p_item_id: row.item_id, p_quantity: row.quantity })

            // 2. Deduct from inventory table per-shop using FIFO (oldest batches first)
            if (selectedShop?.id) {
              let remaining = row.quantity
              const { data: batches } = await supabase
                .from('inventory')
                .select('id, quantity')
                .eq('item_id', row.item_id)
                .eq('shop_id', selectedShop.id)
                .gt('quantity', 0)
                .order('received_at', { ascending: true })
              for (const batch of (batches || [])) {
                if (remaining <= 0) break
                const deduct = Math.min(batch.quantity, remaining)
                await supabase.from('inventory').update({ quantity: batch.quantity - deduct }).eq('id', batch.id)
                remaining -= deduct
              }
              // If no shop-specific batches, insert a negative adjustment record so count is accurate
              if ((batches || []).length === 0 && row.quantity > 0) {
                await supabase.from('inventory').insert({
                  item_id: row.item_id, shop_id: selectedShop.id,
                  quantity: -row.quantity, received_at: new Date().toISOString(),
                })
              }
            }
          }
        }
        // Mark stock as deducted so InvoiceView confirm doesn't double-deduct
        await supabase.from('invoices').update({ stock_deducted: true }).eq('id', inv.id)

        // Keep the in-memory items list in sync so the item search/dropdown shows
        // correct stock for the very next invoice on this same page — fetchData()
        // only runs once on mount, so without this, stock would appear unchanged
        // (stale) for the rest of the session even though the database is correct.
        const deductedQty = {}
        invoiceItems.forEach(row => {
          if (!row.is_third_party) deductedQty[row.item_id] = (deductedQty[row.item_id] || 0) + row.quantity
        })
        setItems(prev => prev.map(it =>
          deductedQty[it.id] ? { ...it, stock_quantity: Math.max(0, (it.stock_quantity || 0) - deductedQty[it.id]) } : it
        ))

        // Create procurement records for 3rd party items
        const thirdPartyRows = invoiceItems.filter(r => r.is_third_party)
        if (thirdPartyRows.length > 0) {
          await supabase.from('third_party_procurement').insert(
            thirdPartyRows.map(r => ({
              invoice_id: inv.id,
              item_id: r.item_id,
              item_name: r.name,
              quantity: r.quantity,
              selling_price: r.unit_price,
              supplier_name: r.tp_supplier_name || null,
              supplier_phone: r.tp_supplier_phone || null,
              reference: r.tp_reference || null,
              payment_status: 'pending',
              shop_id: selectedShop?.id,
              created_by: null,
            }))
          )
          // Upsert supplier suggestions for autofill
          for (const r of thirdPartyRows) {
            if (r.tp_supplier_name?.trim()) {
              const { data: existing } = await supabase.from('third_party_suppliers').select('id, use_count').eq('name', r.tp_supplier_name.trim()).maybeSingle()
              if (existing) {
                await supabase.from('third_party_suppliers').update({ use_count: (existing.use_count || 1) + 1, last_used_at: new Date().toISOString(), phone: r.tp_supplier_phone || undefined }).eq('id', existing.id)
              } else {
                await supabase.from('third_party_suppliers').insert({ name: r.tp_supplier_name.trim(), phone: r.tp_supplier_phone || null, shop_id: selectedShop?.id })
              }
            }
          }
        }
        // Record cheque as pending bank transaction, linked to a real invoice_payments
        // row so it can be tracked, and so returning it in Bank.jsx correctly cascades
        // to this invoice's balance and the Customers.jsx Payments/Invoices tabs —
        // previously the initial cheque at sale only set invoices.amount_paid with no
        // linked payment record at all, so a return had nothing on this side to update.
        if (paymentMethod === 'cheque' && chequeDate) {
          const { data: ip } = await supabase.from('invoice_payments').insert({
            invoice_id: inv.id, amount: paidAmt, payment_method: 'cheque',
            cheque_no: chequeNo || null, cheque_date: chequeDate, cheque_status: 'pending',
            notes: `Initial payment at sale${chequeBankName ? ` · Bank: ${chequeBankName}` : ''}`,
          }).select().single()
          const { data: btx } = await supabase.from('bank_transactions').insert({
            bank_account_id: null,
            type: 'cheque_in',
            amount: paidAmt,
            cheque_no: chequeNo || null,
            cheque_date: chequeDate,
            cheque_status: 'pending',
            reference: `Invoice: ${newInvoiceNo}`,
            notes: `Customer: ${selectedCustomer.name}${chequeBankName ? ` | Bank: ${chequeBankName}` : ''}`,
            invoice_payment_id: ip?.id || null,
          }).select().single()
          if (ip && btx) await supabase.from('invoice_payments').update({ bank_transaction_id: btx.id }).eq('id', ip.id)
        }

        // Bank transfer — credit selected account immediately
        if (paymentMethod === 'bank_transfer' && bankTransferAccountId && paidAmt > 0) {
          const { data: acc } = await supabase.from('bank_accounts').select('balance').eq('id', bankTransferAccountId).single()
          await supabase.from('bank_accounts').update({ balance: (acc?.balance || 0) + paidAmt }).eq('id', bankTransferAccountId)
          await supabase.from('bank_transactions').insert({
            bank_account_id: bankTransferAccountId,
            type: 'deposit',
            amount: paidAmt,
            reference: `Invoice: ${newInvoiceNo}`,
            notes: `Customer: ${selectedCustomer.name} · Bank Transfer`,
          })
        }

        // Card payment — credit the card machine's bank account
        if (paymentMethod === 'card' && cardBankAccountId && paidAmt > 0) {
          const { data: acc } = await supabase.from('bank_accounts').select('balance').eq('id', cardBankAccountId).single()
          await supabase.from('bank_accounts').update({ balance: (acc?.balance || 0) + paidAmt }).eq('id', cardBankAccountId)
          await supabase.from('bank_transactions').insert({
            bank_account_id: cardBankAccountId,
            type: 'deposit',
            amount: paidAmt,
            reference: `Invoice: ${newInvoiceNo}`,
            notes: `Customer: ${selectedCustomer.name} · Card Payment`,
          })
        }

        // Fetch updated customer balance before printing so POS receipt shows correct balance
        let newBalance = selectedCustomer?.credit_balance || 0
        if (!isCashCustomer && selectedCustomer?.id) {
          const { data: updatedCustomer } = await supabase.from('customers').select('credit_balance').eq('id', selectedCustomer.id).single()
          newBalance = updatedCustomer?.credit_balance || 0
        }
        const customerWithNewBalance = { ...selectedCustomer, credit_balance: newBalance }
        setLastInvoice({ ...inv, invoice_no: newInvoiceNo, customers: customerWithNewBalance, salesmen: selectedSalesman, shops: selectedShop, _lineItems: invoiceItems })
        setShowPrintOptions(true)

        // Keep the in-memory customer list in sync so the next invoice for this
        // customer (without leaving this page) shows their updated balance —
        // fetchData() only runs once on mount, so this list would otherwise stay
        // stale for the rest of the session.
        if (!isCashCustomer && selectedCustomer?.id) {
          setCustomers(prev => prev.map(c => c.id === selectedCustomer.id ? { ...c, credit_balance: newBalance } : c))
        }

        // Auto-send SMS if customer has a phone number and is NOT a cash customer
        if (selectedCustomer.phone && !isCashCustomer) {
          const shopName = selectedShop?.name || 'Phonefix'
          // newBalance already fetched above
          const message = newBalance > 0
            ? smsTemplates.invoiceWithOutstanding(selectedCustomer.name, newInvoiceNo, total, newBalance, shopName)
            : smsTemplates.invoiceFullyPaid(selectedCustomer.name, newInvoiceNo, total, shopName)
          sendSMS({
            to: selectedCustomer.phone,
            message,
            triggeredBy: 'invoice_confirmed',
            referenceType: 'invoice',
            referenceId: inv.id,
          }).then(({ success }) => {
            if (success) toast.success('SMS sent to customer!')
          })
        }
      } else {
        toast.success('Saved as draft')
      }

      resetForm()
    } catch (e) { toast.error('Error: ' + e.message) }
    setSaving(false)
  }

  async function resetForm() {
    setSelectedCustomer(null); setSelectedSalesman(null); setInvoiceItems([])
    setPaymentMethod('cash'); setAmountPaid(''); setDiscountPercent(''); setDiscountAmount('')
    setNotes(''); setCustomerSearch(''); setInvoiceNo(''); setIsCashCustomer(false)
    setChequeNo(''); setChequeDate(''); setChequeBankName(''); setBankTransferAccountId('')
  }

  const isSuperAdmin = session?.user?.email === SUPER_ADMIN_EMAIL

  function printPOSReceipt(inv, lineItems) {
    const w = window.open('', '_blank')
    const fmt = n => parseFloat(n||0).toLocaleString('en-LK',{minimumFractionDigits:2})
    const d = inv
    const dateStr = new Date(d?.created_at||Date.now()).toLocaleDateString('en-GB',{day:'2-digit',month:'2-digit',year:'numeric'})
    const timeStr = new Date(d?.created_at||Date.now()).toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit',second:'2-digit'})
    const shopName = 'PHONEFIX (PVT) LTD'
    const shopAddress = d?.shops?.address || 'BANDARAWELA'
    const shopPhone = d?.shops?.phone || ''
    w.document.write(`<!DOCTYPE html><html><head><title>POS ${d?.invoice_no}</title>
    <style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:'Arial',sans-serif;font-size:13px;font-weight:bold;width:75mm;margin:0 auto;padding:4px}.c{text-align:center}.b{font-weight:bold}.r{text-align:right}.dashed{border-top:1px dashed #000;margin:4px 0}.solid{border-top:2px solid #000;margin:4px 0}.row{display:flex;justify-content:space-between;padding:1px 0;font-size:13px;font-weight:bold}.tot{display:flex;justify-content:space-between;font-weight:bold;font-size:16px;padding:3px 0}.bal{display:flex;justify-content:space-between;font-weight:bold;font-size:14px;padding:2px 0}table{width:100%;border-collapse:collapse}td{padding:2px 2px;font-size:12px;font-weight:bold;vertical-align:top}@media print{body{padding:0 0 60mm 0}@page{size:75mm auto;margin:1mm 1mm 0 1mm}}</style></head><body>
    <div class="c b" style="font-size:18px;font-weight:bold;letter-spacing:1px">${shopName}</div>
    ${shopAddress?`<div class="c" style="font-size:10px">${shopAddress.toUpperCase()}</div>`:''}
    ${shopPhone?`<div class="c" style="font-size:10px">${shopPhone}</div>`:''}
    <div class="dashed"></div>
    <div class="row"><span>CASHIER &nbsp;: ${d?.salesmen?.name||'—'}</span><span>SALESMAN : ${d?.salesmen?.name||'—'}</span></div>
    <div class="row"><span>UNIT &nbsp;&nbsp;&nbsp;&nbsp;: ${d?.shops?.name||'—'}</span><span>INVOICE  : ${d?.invoice_no}</span></div>
    <div class="row"><span>CUSTOMER : ${(d?.customers?.name||'Cash Customer').toUpperCase()}</span></div>
    <div class="dashed"></div>
    <div class="row b" style="font-size:12px;font-weight:bold"><span>No. Product</span><span style="display:flex;gap:16px"><span>Rate</span><span>Qty</span><span>Amount</span></span></div>
    <div class="dashed"></div>
    ${(lineItems||[]).map((li,idx)=>`<div style="font-size:12px;font-weight:bold;padding:1px 0">${idx+1}. ${li.name}${li.is_free_issue?' [FREE]':''}${(li.warranty&&li.warranty!=='no')?` [W:${li.warranty}]`:''}</div><div style="display:flex;justify-content:space-between;font-size:12px;font-weight:bold;padding:0 0 3px 10px"><span>${li.immi_no||''}&nbsp;&nbsp;${li.is_free_issue?'—':fmt(li.unit_price)} *${li.quantity}</span><span>${li.is_free_issue?'FREE':fmt(li.quantity*li.unit_price)}</span></div>`).join('')}
    <div class="dashed"></div>
    ${(d?.discount_amount||0)>0?`<div class="row"><span>GROSS TOTAL :</span><span>${fmt(d?.subtotal)}</span></div><div class="row"><span>DISCOUNT :</span><span>- ${fmt(d?.discount_amount)}</span></div>`:`<div class="row"><span>GROSS TOTAL :</span><span>${fmt(d?.total)}</span></div>`}
    <div class="solid"></div>
    <div class="tot"><span>TOTAL :</span><span>${fmt(d?.total)}</span></div>
    <div class="solid"></div>
    ${(d?.credit_amount||0)>0?`<div class="bal"><span>CREDIT :</span><span>${fmt(d?.credit_amount)}</span></div>`:`<div class="row"><span>PAID :</span><span>${fmt(d?.amount_paid)}</span></div>`}
    <div class="dashed"></div>
    <div style="display:flex;justify-content:space-between;font-size:12px;font-weight:bold">
      <span>Items : ${lineItems?.length||0} &nbsp; Pcs : ${(lineItems||[]).reduce((s,l)=>s+l.quantity,0)}</span>
    </div>
    <div style="display:flex;justify-content:space-between;font-size:12px;font-weight:bold">
      <span>Date : ${dateStr}</span><span>Time : ${timeStr}</span>
    </div>
    ${(d?.credit_amount||0)>0?`<div class="solid"></div><div class="c b" style="font-size:12px">CURRENT BALANCE : ${fmt((d?.customers?.credit_balance||0))}</div>`:''}
    <div class="solid"></div>
    <div class="c b" style="font-size:13px;margin:3px 0">★ Thank You! Visit Again ★</div>
    <div class="c" style="font-size:11px;font-weight:bold">Your trust is our greatest reward.</div>
    <div class="c" style="font-size:11px;font-weight:bold;margin-top:2px">Designed for Phonefix (PVT) Ltd · Powered by Techmo Solutions</div>
    <div style=\'height:60mm\'></div><script>window.onload=function(){window.print()}<\/script></body></html>`)
    w.document.close()
  }

  function printA5Receipt(inv, lineItems) {
    const w = window.open('', '_blank')
    const fmt = n => parseFloat(n||0).toLocaleString('en-LK',{minimumFractionDigits:2})
    const d = inv
    w.document.write(`<!DOCTYPE html><html><head><title>Invoice ${d?.invoice_no}</title>
    <style>body{font-family:Arial,sans-serif;font-size:13px;padding:20px;max-width:148mm;margin:0 auto}h1{font-size:18px;margin:0 0 4px}table{width:100%;border-collapse:collapse;margin:12px 0}th{background:#f1f5f9;padding:8px;text-align:left;font-size:11px;text-transform:uppercase;border-bottom:2px solid #e2e8f0}td{padding:7px 8px;border-bottom:1px solid #f1f5f9;font-size:13px}.tot{font-weight:bold;font-size:15px}.due{color:#dc2626;font-weight:bold}@media print{@page{size:A5;margin:10mm}}</style></head><body>
    <h1>${d?.shops?.name||'Phonefix'}</h1>
    <p style="color:#64748b;margin:0 0 12px">${new Date(d?.created_at||Date.now()).toLocaleDateString('en-GB',{day:'2-digit',month:'long',year:'numeric'})}</p>
    <div style="display:flex;justify-content:space-between;margin-bottom:12px">
      <div><strong>Invoice:</strong> ${d?.invoice_no}<br><strong>Customer:</strong> ${d?.customers?.name||'Cash Customer'}</div>
      <div style="text-align:right">${d?.salesmen?.name?`<strong>Cashier:</strong> ${d.salesmen.name}`:''}</div>
    </div>
    <table><thead><tr><th>Item</th><th>Qty</th><th style="text-align:right">Unit Price</th><th style="text-align:right">Total</th></tr></thead>
    <tbody>${(lineItems||[]).map(li=>`<tr><td>${li.name}${li.is_free_issue?' <em>[Free Issue]</em>':''}</td><td>${li.quantity}</td><td style="text-align:right">${li.is_free_issue?'—':fmt(li.unit_price)}</td><td style="text-align:right">${li.is_free_issue?'FREE':fmt(li.quantity*li.unit_price)}</td></tr>`).join('')}</tbody></table>
    ${(d?.discount_amount||0)>0?`<p style="text-align:right">Subtotal: LKR ${fmt(d?.subtotal)} &nbsp;|&nbsp; Discount: -LKR ${fmt(d?.discount_amount)}</p>`:''}
    <p class="tot" style="text-align:right">TOTAL: LKR ${fmt(d?.total)}</p>
    <p style="text-align:right">Amount Paid: LKR ${fmt(d?.amount_paid)}</p>
    ${(d?.credit_amount||0)>0?`<p class="due" style="text-align:right">Balance Due: LKR ${fmt(d?.credit_amount)}</p>`:'<p style="text-align:right;color:green">✓ Fully Paid</p>'}
    <p style="margin-top:20px;font-size:12px;color:#64748b">Thank you for your business!</p>
    <div style=\'height:60mm\'></div><script>window.onload=function(){window.print()}<\/script></body></html>`)
    w.document.close()
  }

  const filteredCustomers = customers.filter(c => {
    const s = customerSearch.toLowerCase()
    return (c.name?.toLowerCase() || '').includes(s) || (c.customer_no?.toLowerCase() || '').includes(s)
  })

  const filteredItems = items.filter(i => {
    const s = itemSearch.toLowerCase()
    if (!s) return true  // show all when focused with no text
    return (i.name?.toLowerCase() || '').includes(s) ||
           (i.item_no?.toLowerCase() || '').includes(s) ||
           (i.barcode?.toLowerCase() || '').includes(s)
  }).slice(0, 30)

  const inp = { width: '100%', padding: '9px 12px', border: '1.5px solid #e2e8f0', borderRadius: '7px', fontSize: '14px', boxSizing: 'border-box', outline: 'none', background: 'white', color: '#0f172a' }
  const lbl = { display: 'block', marginBottom: '5px', fontSize: '11px', fontWeight: '700', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.06em' }
  const card = { background: 'white', borderRadius: '12px', padding: '24px', boxShadow: '0 1px 3px rgba(15,23,42,0.06), 0 1px 2px rgba(15,23,42,0.04)', marginBottom: '16px', border: '1px solid #f1f5f9' }
  const drop = { position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0, background: 'white', border: '1.5px solid #e2e8f0', borderRadius: '10px', boxShadow: '0 8px 24px rgba(0,0,0,0.12)', zIndex: 200, maxHeight: '220px', overflowY: 'auto' }
  const dropItem = { padding: '10px 14px', cursor: 'pointer', fontSize: '14px', borderBottom: '1px solid #f8fafc', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }

  return (
    <div style={{ maxWidth: '1100px' }}>

      {/* Overpayment modal */}
      {overpaymentModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 1001, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ background: 'white', borderRadius: '16px', padding: '32px', width: '460px', boxShadow: '0 20px 60px rgba(0,0,0,0.3)' }}>
            <div style={{ fontSize: '36px', textAlign: 'center', marginBottom: '8px' }}>💰</div>
            <h2 style={{ fontSize: '18px', fontWeight: '700', color: '#0f172a', margin: '0 0 6px', textAlign: 'center' }}>Overpayment Detected</h2>
            <p style={{ fontSize: '13px', color: '#64748b', textAlign: 'center', marginBottom: '20px' }}>
              Customer paid <strong style={{ color: '#059669' }}>{formatCurrency(paidAmt)}</strong> for an invoice of <strong>{formatCurrency(total)}</strong>
            </p>

            <div style={{ background: '#f0fdf4', border: '1.5px solid #bbf7d0', borderRadius: '10px', padding: '14px 16px', marginBottom: '20px', textAlign: 'center' }}>
              <div style={{ fontSize: '12px', color: '#94a3b8', fontWeight: '700', textTransform: 'uppercase', marginBottom: '4px' }}>Excess Amount</div>
              <div style={{ fontSize: '28px', fontWeight: '800', color: '#059669' }}>{formatCurrency(overpaymentModal.excess)}</div>
            </div>

            {/* Option 1 — deduct from outstanding */}
            <div onClick={() => setOverpaymentChoice('deduct')}
              style={{ padding: '14px 16px', borderRadius: '10px', border: `2px solid ${overpaymentChoice === 'deduct' ? '#2563eb' : '#e2e8f0'}`, marginBottom: '10px', cursor: 'pointer', background: overpaymentChoice === 'deduct' ? '#eef2ff' : 'white', transition: 'all 0.15s' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <div style={{ fontSize: '14px', fontWeight: '700', color: '#0f172a', marginBottom: '3px' }}>
                    {overpaymentChoice === 'deduct' ? '✅ ' : ''}Option 1 — Deduct from Outstanding
                  </div>
                  <div style={{ fontSize: '12px', color: '#64748b' }}>
                    {overpaymentModal.creditBalance <= 0
                      ? 'Customer has no outstanding — full amount will be stored as credit'
                      : overpaymentModal.excess >= overpaymentModal.creditBalance
                        ? `Clears outstanding of ${formatCurrency(overpaymentModal.creditBalance)}${overpaymentModal.excess > overpaymentModal.creditBalance ? ` + remaining ${formatCurrency(overpaymentModal.excess - overpaymentModal.creditBalance)} stored as credit` : ''}`
                        : `Outstanding ${formatCurrency(overpaymentModal.creditBalance)} → becomes ${formatCurrency(overpaymentModal.creditBalance - overpaymentModal.excess)}`}
                  </div>
                </div>
              </div>
            </div>

            {/* Option 2 — store as credit */}
            <div onClick={() => setOverpaymentChoice('store')}
              style={{ padding: '14px 16px', borderRadius: '10px', border: `2px solid ${overpaymentChoice === 'store' ? '#2563eb' : '#e2e8f0'}`, marginBottom: '20px', cursor: 'pointer', background: overpaymentChoice === 'store' ? '#eef2ff' : 'white', transition: 'all 0.15s' }}>
              <div>
                <div style={{ fontSize: '14px', fontWeight: '700', color: '#0f172a', marginBottom: '3px' }}>
                  {overpaymentChoice === 'store' ? '✅ ' : ''}Option 2 — Store as Credit
                </div>
                <div style={{ fontSize: '12px', color: '#64748b' }}>
                  {formatCurrency(overpaymentModal.excess)} stored as overpayment credit. Will automatically deduct from next invoice for this customer.
                </div>
              </div>
            </div>

            <div style={{ display: 'flex', gap: '10px' }}>
              <button onClick={() => { setOverpaymentModal(null); setOverpaymentChoice(null) }}
                style={{ flex: 1, padding: '11px', background: '#f1f5f9', color: '#475569', border: 'none', borderRadius: '10px', cursor: 'pointer', fontWeight: '600', fontSize: '14px' }}>
                Cancel
              </button>
              <button onClick={() => {
                  if (!overpaymentChoice) return toast.error('Please select an option')
                  setOverpaymentModal(null)
                  saveInvoice('confirmed', overpaymentChoice)
                }}
                disabled={!overpaymentChoice}
                style={{ flex: 2, padding: '11px', background: overpaymentChoice ? 'linear-gradient(135deg,#2563eb,#1d4ed8)' : '#e2e8f0', color: overpaymentChoice ? 'white' : '#94a3b8', border: 'none', borderRadius: '10px', cursor: overpaymentChoice ? 'pointer' : 'not-allowed', fontWeight: '700', fontSize: '14px' }}>
                Confirm & Save Invoice
              </button>
            </div>
          </div>
        </div>
      )}
      {showPrintOptions && lastInvoice && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ background: 'white', borderRadius: '20px', padding: '32px', width: '420px', textAlign: 'center', boxShadow: '0 24px 80px rgba(0,0,0,0.4)' }}>
            <div style={{ width: '56px', height: '56px', background: '#dcfce7', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 16px', fontSize: '28px' }}>✅</div>
            <h2 style={{ fontSize: '20px', fontWeight: '800', color: '#0f172a', margin: '0 0 4px' }}>Invoice Confirmed!</h2>
            <div style={{ fontSize: '17px', fontWeight: '800', color: '#2563eb', marginBottom: '4px' }}>{lastInvoice.invoice_no}</div>
            <div style={{ fontSize: '13px', color: '#64748b', marginBottom: '4px' }}>{lastInvoice?.customers?.name}</div>
            <div style={{ fontSize: '22px', fontWeight: '900', color: '#059669', marginBottom: '20px' }}>
              LKR {(lastInvoice?.total || 0).toLocaleString('en-LK', { minimumFractionDigits: 2 })}
            </div>
            <p style={{ fontSize: '12px', color: '#94a3b8', marginBottom: '16px' }}>Print receipt?</p>
            <div style={{ display: 'flex', gap: '8px', flexDirection: 'column' }}>
              <button onClick={() => { printPOSReceipt(lastInvoice, lastInvoice._lineItems || []); setShowPrintOptions(false); resetForm() }}
                style={{ padding: '12px', background: '#0f172a', color: 'white', border: 'none', borderRadius: '10px', cursor: 'pointer', fontWeight: '700', fontSize: '14px' }}>
                🖨 Print POS Receipt (75mm)
              </button>
              {isSuperAdmin && (
                <button onClick={() => { printA5Receipt(lastInvoice, lastInvoice._lineItems || []); setShowPrintOptions(false); resetForm() }}
                  style={{ padding: '12px', background: '#2563eb', color: 'white', border: 'none', borderRadius: '10px', cursor: 'pointer', fontWeight: '700', fontSize: '14px' }}>
                  📄 Print A5 Invoice
                </button>
              )}
              <button onClick={() => { setShowPrintOptions(false); resetForm() }}
                style={{ padding: '12px', background: '#f1f5f9', color: '#475569', border: 'none', borderRadius: '10px', cursor: 'pointer', fontWeight: '600', fontSize: '14px' }}>
                ✕ No Print — New Invoice
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '24px' }}>
        <div>
          <h1 style={{ fontSize: '22px', fontWeight: '700', color: '#0f172a', margin: '0 0 6px' }}>New Invoice</h1>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span style={{ fontSize: '13px', fontWeight: '700', color: '#2563eb', background: '#eef2ff', padding: '3px 10px', borderRadius: '20px' }}>{invoiceNo}</span>
            <span style={{ fontSize: '13px', color: '#94a3b8' }}>
              {invoiceDate.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })} · {invoiceDate.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
            </span>
          </div>
        </div>
        <div style={{ display: 'flex', gap: '10px' }}>
          <button onClick={() => saveInvoice('draft')} disabled={saving}
            style={{ padding: '10px 20px', background: 'white', color: '#475569', border: '1.5px solid #e2e8f0', borderRadius: '10px', cursor: 'pointer', fontWeight: '600', fontSize: '14px' }}>
            Save Draft
          </button>
          <button onClick={() => saveInvoice('confirmed')} disabled={saving}
            style={{ padding: '10px 24px', background: saving ? '#93c5fd' : 'linear-gradient(135deg,#2563eb,#1d4ed8)', color: 'white', border: 'none', borderRadius: '10px', cursor: 'pointer', fontWeight: '700', fontSize: '14px' }}>
            {saving ? 'Saving...' : '✓ Confirm Invoice'}
          </button>
        </div>
      </div>

      {/* Shop + Salesman + Customer */}
      <div style={{ ...card, display: 'grid', gridTemplateColumns: isCashier ? '1fr 1.5fr' : '1fr 1fr 1.5fr', gap: '20px', alignItems: 'start' }}>

        {!isCashier && (
          <div>
            <label style={lbl}>Shop</label>
            <select value={selectedShop?.id || ''} onChange={e => setSelectedShop(shops.find(s => s.id === e.target.value))} style={inp}>
              {shops.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
        )}

        <div>
          <label style={lbl}>Salesman *</label>
          {isCashier && selectedSalesman ? (
            <div style={{ padding: '9px 12px', background: '#f0fdf4', border: '1.5px solid #bbf7d0', borderRadius: '7px', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <span style={{ fontSize: '14px', fontWeight: '700', color: '#166534' }}>{selectedSalesman.name}</span>
              <span style={{ fontSize: '11px', color: '#86efac', fontWeight: '600' }}>{selectedSalesman.salesman_no}</span>
              <span style={{ marginLeft: 'auto', fontSize: '11px', background: '#dcfce7', color: '#166534', padding: '1px 7px', borderRadius: '10px', fontWeight: '700' }}>Auto</span>
            </div>
          ) : (
            <select value={selectedSalesman?.id || ''}
              onChange={e => setSelectedSalesman(salesmen.find(s => s.id === e.target.value) || null)}
              style={{ ...inp, color: selectedSalesman ? '#0f172a' : '#94a3b8' }}>
              <option value="">— Select salesman —</option>
              {salesmen.map(s => <option key={s.id} value={s.id}>{s.salesman_no} · {s.name}</option>)}
            </select>
          )}
        </div>

        <div>
          <label style={lbl}>Customer *</label>
          <div style={{ position: 'relative' }}>
            <input type="text" placeholder="Search name or customer no…" value={customerSearch}
              onChange={e => { setCustomerSearch(e.target.value); setShowCustomerDrop(true); if (!e.target.value) setSelectedCustomer(null) }}
              onFocus={() => setShowCustomerDrop(true)}
              onBlur={() => setTimeout(() => setShowCustomerDrop(false), 180)}
              style={{ ...inp, paddingRight: '36px' }} />
            {selectedCustomer && <span style={{ position: 'absolute', right: '10px', top: '50%', transform: 'translateY(-50%)', color: '#22c55e', fontSize: '16px' }}>✓</span>}
            {showCustomerDrop && (
              <div style={drop}>
                {filteredCustomers.length === 0 && customerSearch && <div style={{ ...dropItem, color: '#94a3b8', justifyContent: 'center' }}>No results</div>}
                {filteredCustomers.map(c => (
                  <div key={c.id} onMouseDown={() => { setSelectedCustomer(c); setCustomerSearch(c.name); setShowCustomerDrop(false) }}
                    style={dropItem} onMouseEnter={e => e.currentTarget.style.background = '#f8fafc'} onMouseLeave={e => e.currentTarget.style.background = 'white'}>
                    <span><span style={{ fontWeight: '700', color: '#2563eb', marginRight: '8px' }}>{c.customer_no}</span>{c.name}</span>
                    {c.credit_balance > 0 && <span style={{ fontSize: '12px', color: '#e11d48', fontWeight: '700' }}>Due: {formatCurrency(c.credit_balance)}</span>}
                  </div>
                ))}
                <div onMouseDown={() => { setShowCustomerDrop(false); setShowNewCustomer(true) }}
                  style={{ ...dropItem, color: '#2563eb', fontWeight: '700', borderTop: '2px solid #e2e8f0', justifyContent: 'center' }}
                  onMouseEnter={e => e.currentTarget.style.background = '#f5f3ff'} onMouseLeave={e => e.currentTarget.style.background = 'white'}>
                  + New Customer
                </div>
              </div>
            )}
          </div>
          {selectedCustomer && (
            <div style={{ marginTop: '8px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 12px', background: '#f0fdf4', borderRadius: '10px', border: '1px solid #bbf7d0' }}>
              <span style={{ fontSize: '13px', color: '#15803d', fontWeight: '600' }}>{selectedCustomer.customer_no} · {selectedCustomer.name}{selectedCustomer.phone && <span style={{ fontWeight: '400', marginLeft: '6px' }}>{selectedCustomer.phone}</span>}</span>
              {selectedCustomer.credit_balance > 0 && <span style={{ fontSize: '12px', color: '#e11d48', fontWeight: '700' }}>Outstanding: {formatCurrency(selectedCustomer.credit_balance)}</span>}
            </div>
          )}
          {/* Cash Customer Toggle */}
          <div style={{ marginTop: '10px' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer', userSelect: 'none', padding: '10px 14px', background: isCashCustomer ? '#fef3c7' : '#f8fafc', borderRadius: '10px', border: `1.5px solid ${isCashCustomer ? '#fde68a' : '#e2e8f0'}`, transition: 'all 0.15s' }}>
              <input type="checkbox" checked={isCashCustomer} onChange={e => {
                setIsCashCustomer(e.target.checked)
                if (e.target.checked) {
                  // Auto-select or create a "Cash Customer" placeholder
                  setSelectedCustomer({ id: 'cash', name: 'Cash Customer', customer_no: 'CASH', phone: null, credit_balance: 0 })
                  setCustomerSearch('Cash Customer')
                } else {
                  setSelectedCustomer(null)
                  setCustomerSearch('')
                }
              }} style={{ accentColor: '#d97706', width: '16px', height: '16px', cursor: 'pointer' }} />
              <div>
                <div style={{ fontSize: '13px', fontWeight: '700', color: isCashCustomer ? '#92400e' : '#64748b' }}>💵 Cash Customer</div>
                <div style={{ fontSize: '11px', color: isCashCustomer ? '#b45309' : '#94a3b8', marginTop: '1px' }}>No SMS will be sent · Customer name set to "Cash Customer"</div>
              </div>
            </label>
          </div>
          {showNewCustomer && (
            <div style={{ marginTop: '12px', padding: '16px', background: '#fafafa', borderRadius: '10px', border: '1.5px solid #e2e8f0' }}>
              <p style={{ margin: '0 0 12px', fontWeight: '700', fontSize: '13px', color: '#0f172a' }}>New Customer</p>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginBottom: '10px' }}>
                {[{ k: 'name', p: 'Full name *' }, { k: 'phone', p: 'Phone' }, { k: 'address', p: 'Address' }].map(f => (
                  <div key={f.k} style={f.k === 'address' ? { gridColumn: '1/-1' } : {}}>
                    <input type="text" placeholder={f.p} value={newCustomer[f.k]} onChange={e => setNewCustomer(p => ({ ...p, [f.k]: e.target.value }))} style={inp} />
                  </div>
                ))}
              </div>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button onClick={createCustomer} style={{ padding: '7px 16px', background: '#2563eb', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '13px', fontWeight: '600' }}>Create</button>
                <button onClick={() => setShowNewCustomer(false)} style={{ padding: '7px 14px', background: '#f1f5f9', color: '#64748b', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '13px' }}>Cancel</button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Items */}
      <div style={card}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
          <h2 style={{ margin: 0, fontSize: '15px', fontWeight: '700', color: '#0f172a' }}>Items</h2>
          <span style={{ fontSize: '13px', color: '#94a3b8' }}>{invoiceItems.length} item{invoiceItems.length !== 1 ? 's' : ''}</span>
        </div>

        <div style={{ position: 'relative', marginBottom: '16px' }}>
          <input ref={itemSearchRef} type="text" placeholder="Search by name, item code or scan barcode…"
            value={itemSearch}
            onChange={e => { setItemSearch(e.target.value); setShowItemDrop(true) }}
            onFocus={() => setShowItemDrop(true)}
            onBlur={() => setTimeout(() => setShowItemDrop(false), 180)}
            onKeyDown={e => {
              if (e.key === 'Enter') {
                // Exact barcode match — scanners send Enter after the code
                const exactBarcode = items.find(i => i.barcode && i.barcode.toLowerCase() === itemSearch.toLowerCase())
                const exactCode = items.find(i => i.item_no && i.item_no.toLowerCase() === itemSearch.toLowerCase())
                const match = exactBarcode || exactCode
                if (match) { addItem(match); setItemSearch(''); setShowItemDrop(false); e.preventDefault() }
                else if (filteredItems.length === 1) { addItem(filteredItems[0]); setItemSearch(''); setShowItemDrop(false); e.preventDefault() }
              }
            }}
            style={{ ...inp, background: '#f8fafc' }} />
          {showItemDrop && (
            <div style={drop}>
              {filteredItems.length === 0 && itemSearch && <div style={{ ...dropItem, color: '#94a3b8', justifyContent: 'center' }}>No items found</div>}
              {filteredItems.map((item, iidx) => {
                const stock = item.stock_quantity || 0
                const isOut = stock <= 0
                const isLow = item.reorder_level > 0 && stock <= item.reorder_level
                return (
                  <div key={item.id} onMouseDown={() => addItem(item)}
                    style={{ ...dropItem, opacity: isOut ? 0.5 : 1, background: itemDropHighlight === iidx ? '#eef2ff' : 'white' }}
                    onMouseEnter={e => { e.currentTarget.style.background = '#f8fafc'; setItemDropHighlight(iidx) }}
                    onMouseLeave={e => e.currentTarget.style.background = itemDropHighlight === iidx ? '#eef2ff' : 'white'}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                      <span>
                        <span style={{ fontWeight: '700', color: '#2563eb', marginRight: '8px', fontSize: '12px' }}>{item.item_no}</span>
                        <span style={{ fontWeight: '600' }}>{item.name}</span>
                      </span>
                      <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                        <span style={{ fontSize: '11px', fontWeight: '700', color: isOut ? '#e11d48' : isLow ? '#d97706' : '#059669' }}>
                          {isOut ? '⚠ Out of stock' : isLow ? `⚠ Low: ${stock}` : `✓ Stock: ${stock}`}
                        </span>
                        {item.cost_price > 0 && (
                          <span style={{ fontSize: '11px', color: '#94a3b8' }}>Cost: {formatCurrency(item.cost_price)}</span>
                        )}
                      </div>
                    </div>
                    <span style={{ fontWeight: '800', color: '#059669', fontSize: '14px', flexShrink: 0 }}>
                      {shopPrices[item.id] ? formatCurrency(shopPrices[item.id].selling_price) : formatCurrency(item.selling_price)}
                      {shopPrices[item.id] && <span style={{ fontSize: '10px', color: '#7c3aed', marginLeft: '4px' }}>★</span>}
                    </span>
                  </div>
                )
              })}
              <div onMouseDown={() => { setShowItemDrop(false); setShowNewItem(true) }}
                style={{ ...dropItem, color: '#2563eb', fontWeight: '700', borderTop: '2px solid #e2e8f0', justifyContent: 'center' }}
                onMouseEnter={e => e.currentTarget.style.background = '#f5f3ff'} onMouseLeave={e => e.currentTarget.style.background = 'white'}>
                + Add New Item
              </div>
            </div>
          )}
        </div>

        {showNewItem && (
          <div style={{ marginBottom: '16px', padding: '16px', background: '#fafafa', borderRadius: '10px', border: '1.5px solid #e2e8f0' }}>
            <p style={{ margin: '0 0 12px', fontWeight: '700', fontSize: '13px', color: '#0f172a' }}>New Item</p>
            <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr', gap: '10px', marginBottom: '10px' }}>
              <div><label style={lbl}>Item Name *</label><input type="text" placeholder="Item name" value={newItem.name} onChange={e => setNewItem(p => ({ ...p, name: e.target.value }))} style={inp} autoFocus /></div>
              <div><label style={lbl}>Cost Price (LKR)</label><input type="number" placeholder="0" min="0" step="1" value={newItem.cost_price} onChange={e => setNewItem(p => ({ ...p, cost_price: e.target.value }))} style={inp} /></div>
              <div><label style={lbl}>Selling Price (LKR) *</label><input type="number" placeholder="0" min="0" step="1" value={newItem.selling_price} onChange={e => setNewItem(p => ({ ...p, selling_price: e.target.value }))} style={inp} /></div>
            </div>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button onClick={createItem} style={{ padding: '7px 16px', background: '#2563eb', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '13px', fontWeight: '600' }}>Create & Add</button>
              <button onClick={() => setShowNewItem(false)} style={{ padding: '7px 14px', background: '#f1f5f9', color: '#64748b', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '13px' }}>Cancel</button>
            </div>
          </div>
        )}

        {invoiceItems.length > 0 ? (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: '#f8fafc', borderBottom: '2px solid #e2e8f0' }}>
                {['#', 'Item Name', 'Stock', 'Qty', 'Unit Price (LKR)', ...(showAdvancedCols ? ['Warranty', 'Immi No', 'Free Issue', '3rd Party'] : []), 'Line Total', ''].map((h, i) => (
                  <th key={i} style={{ padding: '10px 12px', textAlign: i === 0 ? 'center' : i >= 5 ? 'right' : 'left', fontSize: '11px', fontWeight: '700', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {invoiceItems.map((row, idx) => {
                const itemData = items.find(i => i.id === row.item_id)
                const stock = itemData?.stock_quantity || 0
                const isOut = stock <= 0
                const isLow = itemData?.reorder_level > 0 && stock <= itemData.reorder_level
                const overQty = !row.is_free_issue && row.quantity > stock
                return (
                <tr key={idx} style={{ borderBottom: '1px solid #f1f5f9', background: overQty ? '#fff5f5' : 'white' }}>
                  <td style={{ padding: '12px', textAlign: 'center', fontSize: '12px', color: '#94a3b8', fontWeight: '700' }}>{idx + 1}</td>
                  <td style={{ padding: '12px', fontSize: '14px', fontWeight: '600', color: '#0f172a' }}>{row.name}</td>
                  <td style={{ padding: '12px', textAlign: 'center' }}>
                    <span style={{ fontSize: '12px', fontWeight: '700', color: isOut ? '#e11d48' : isLow ? '#d97706' : '#059669', background: isOut ? '#fee2e2' : isLow ? '#fef3c7' : '#dcfce7', padding: '2px 8px', borderRadius: '12px', display: 'inline-block' }}>
                      {stock}
                    </span>
                    {overQty && <div style={{ fontSize: '10px', color: '#e11d48', marginTop: '2px', fontWeight: '700' }}>Exceeds stock!</div>}
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
                    {(() => {
                      const itemData = items.find(i => i.id === row.item_id)
                      const belowMin = !row.is_free_issue && itemData?.last_price > 0 && row.unit_price < itemData.last_price
                      return (
                        <div>
                          <input type="number" value={row.unit_price} min="0" step="1"
                            onChange={e => updateRow(idx, 'unit_price', parseFloat(e.target.value) || 0)}
                            onFocus={e => e.target.select()}
                            style={{ ...inp, width: '130px', textAlign: 'right', fontWeight: '600', borderColor: belowMin ? '#f87171' : '#e2e8f0', background: belowMin ? '#fff5f5' : 'white' }} />
                          {belowMin && <div style={{ fontSize: '10px', color: '#e11d48', marginTop: '2px', fontWeight: '700' }}>Below min: {formatCurrency(itemData.last_price)}</div>}
                        </div>
                      )
                    })()}
                  </td>
                  {showAdvancedCols && (<>
                  <td style={{ padding: '12px' }}>
                    <select value={row.warranty} onChange={e => updateRow(idx, 'warranty', e.target.value)} style={{ ...inp, width: '100px', fontSize: '13px' }}>
                      <option value="no">No</option>
                      <option value="7 days">7 Days</option>
                      <option value="14 days">14 Days</option>
                      <option value="21 days">21 Days</option>
                      <option value="1 month">1 Month</option>
                      <option value="3 months">3 Months</option>
                      <option value="6 months">6 Months</option>
                      <option value="1 year">1 Year</option>
                    </select>
                  </td>
                  <td style={{ padding: '12px' }}>
                    <input type="text" value={row.immi_no || ''}
                      onChange={e => updateRow(idx, 'immi_no', e.target.value)}
                      placeholder="Immi no…"
                      style={{ ...inp, width: '110px', fontSize: '12px' }} />
                  </td>
                  <td style={{ padding: '12px' }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer', userSelect: 'none' }}>
                      <input type="checkbox" checked={row.is_free_issue || false}
                        onChange={e => { updateRow(idx, 'is_free_issue', e.target.checked); if (e.target.checked) updateRow(idx, 'unit_price', 0) }}
                        style={{ accentColor: '#2563eb', width: '15px', height: '15px', cursor: 'pointer' }} />
                      <span style={{ fontSize: '11px', fontWeight: '700', color: row.is_free_issue ? '#2563eb' : '#94a3b8' }}>Free</span>
                    </label>
                  </td>
                  {/* 3rd Party Cell */}
                  <td style={{ padding: '8px', minWidth: '160px' }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '5px', cursor: 'pointer', marginBottom: row.is_third_party ? '6px' : 0 }}>
                      <input type="checkbox" checked={row.is_third_party || false}
                        onChange={e => updateRow(idx, 'is_third_party', e.target.checked)}
                        style={{ accentColor: '#f59e0b', width: '14px', height: '14px', cursor: 'pointer' }} />
                      <span style={{ fontSize: '11px', fontWeight: '700', color: row.is_third_party ? '#f59e0b' : '#94a3b8' }}>3rd Party</span>
                    </label>
                    {row.is_third_party && (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                        <input type="text" placeholder="Supplier name *"
                          value={row.tp_supplier_name || ''}
                          onChange={e => updateRow(idx, 'tp_supplier_name', e.target.value)}
                          list={`tp-suppliers-${idx}`}
                          style={{ width: '100%', padding: '4px 7px', border: '1.5px solid #fde68a', borderRadius: '5px', fontSize: '11px', outline: 'none', background: '#fffbeb' }} />
                        <datalist id={`tp-suppliers-${idx}`}>
                          {thirdPartySuppliers.map(s => <option key={s.id} value={s.name} />)}
                        </datalist>
                        <input type="text" placeholder="Phone (optional)"
                          value={row.tp_supplier_phone || ''}
                          onChange={e => updateRow(idx, 'tp_supplier_phone', e.target.value)}
                          style={{ width: '100%', padding: '4px 7px', border: '1.5px solid #fde68a', borderRadius: '5px', fontSize: '11px', outline: 'none', background: '#fffbeb' }} />
                        <input type="text" placeholder="Ref / bill no"
                          value={row.tp_reference || ''}
                          onChange={e => updateRow(idx, 'tp_reference', e.target.value)}
                          style={{ width: '100%', padding: '4px 7px', border: '1.5px solid #fde68a', borderRadius: '5px', fontSize: '11px', outline: 'none', background: '#fffbeb' }} />
                      </div>
                    )}
                  </td>
                  </>)}
                  <td style={{ padding: '12px', textAlign: 'right', fontSize: '15px', fontWeight: '700', color: row.is_free_issue ? '#94a3b8' : '#059669' }}>
                    {row.is_free_issue
                      ? <span style={{ fontSize: '12px', background: '#eef2ff', color: '#2563eb', padding: '2px 8px', borderRadius: '12px', fontWeight: '700' }}>FREE</span>
                      : formatCurrency(row.quantity * row.unit_price)}
                  </td>
                  <td style={{ padding: '12px', textAlign: 'right' }}>
                    <button onClick={() => removeRow(idx)} style={{ width: '28px', height: '28px', background: '#fee2e2', color: '#dc2626', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '14px' }}>✕</button>
                  </td>
                </tr>
                )
              })}
            </tbody>
          </table>
        ) : (
          <div style={{ padding: '40px', textAlign: 'center', color: '#cbd5e1', fontSize: '14px', border: '2px dashed #e2e8f0', borderRadius: '10px' }}>
            <div style={{ fontSize: '28px', marginBottom: '8px' }}>📦</div>
            Search above to add items to this invoice
          </div>
        )}
      </div>

      {/* Payment + Summary */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
        <div style={card}>
          <h2 style={{ margin: '0 0 16px', fontSize: '15px', fontWeight: '700', color: '#0f172a' }}>Payment Details</h2>
          <div style={{ marginBottom: '14px' }}>
            <label style={lbl}>Payment Method</label>
            <select value={paymentMethod} onChange={e => { setPaymentMethod(e.target.value); setAmountPaid(''); setChequeNo(''); setChequeDate(''); setChequeBankName(''); setBankTransferAccountId('') }} style={inp}>
              <option value="cash">Cash</option>
              <option value="card">Card</option>
              <option value="cheque">Cheque</option>
              <option value="bank_transfer">Bank Transfer</option>
              <option value="partial">Partial Payment</option>
              <option value="credit">Credit (No Payment Now)</option>
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
              <label style={lbl}>Bank Account * (amount will be credited)</label>
              <select value={bankTransferAccountId} onChange={e => setBankTransferAccountId(e.target.value)}
                style={{ ...inp, borderColor: !bankTransferAccountId ? '#fca5a5' : '#e2e8f0' }}>
                <option value="">— Select account —</option>
                {bankAccounts.map(b => (
                  <option key={b.id} value={b.id}>{b.name} — {b.bank_name} (LKR {(b.balance || 0).toLocaleString('en-LK', { minimumFractionDigits: 2 })})</option>
                ))}
              </select>
              {bankTransferAccountId && paidAmt > 0 && (
                <div style={{ fontSize: '11px', color: '#059669', marginTop: '4px', fontWeight: '600' }}>
                  💡 LKR {paidAmt.toLocaleString('en-LK', { minimumFractionDigits: 2 })} will be added to this account on confirm
                </div>
              )}
            </div>
          )}
          {paymentMethod === 'card' && (
            <div style={{ marginBottom: '14px' }}>
              <label style={lbl}>Card machine deposits to *</label>
              <select value={cardBankAccountId} onChange={e => setCardBankAccountId(e.target.value)}
                style={{ ...inp, borderColor: !cardBankAccountId ? '#fca5a5' : '#e2e8f0' }}>
                <option value="">— Select account —</option>
                {bankAccounts.map(b => (
                  <option key={b.id} value={b.id}>{b.name} — {b.bank_name} (LKR {(b.balance || 0).toLocaleString('en-LK', { minimumFractionDigits: 2 })})</option>
                ))}
              </select>
              {cardBankAccountId && paidAmt > 0 && (
                <div style={{ fontSize: '11px', color: '#059669', marginTop: '4px', fontWeight: '600' }}>
                  💡 LKR {paidAmt.toLocaleString('en-LK', { minimumFractionDigits: 2 })} will be added to this account on confirm
                </div>
              )}
            </div>
          )}
          {paymentMethod === 'cheque' && (
            <>
              <div style={{ marginBottom: '14px' }}>
                <label style={lbl}>Bank Name</label>
                <input type="text" value={chequeBankName} onChange={e => setChequeBankName(e.target.value)}
                  placeholder="e.g. Commercial Bank, Sampath Bank…" style={inp} />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '14px' }}>
                <div>
                  <label style={lbl}>Cheque No</label>
                  <input type="text" value={chequeNo} onChange={e => setChequeNo(e.target.value)}
                    placeholder="Cheque number" style={inp} />
                </div>
                <div>
                  <label style={lbl}>Cheque Date *</label>
                  <input type="date" value={chequeDate} onChange={e => setChequeDate(e.target.value)}
                    style={{ ...inp, borderColor: !chequeDate ? '#fca5a5' : '#e2e8f0' }} />
                </div>
              </div>
              {chequeDate && (
                <div style={{ padding: '10px 12px', background: '#fef3c7', borderRadius: '10px', border: '1px solid #fde68a', marginBottom: '14px', fontSize: '13px', color: '#92400e' }}>
                  💡 Cheque will appear in Bank → Cheques on {new Date(chequeDate).toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' })}
                </div>
              )}
            </>
          )}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '14px' }}>
            <div>
              <label style={lbl}>Discount %</label>
              <input type="number" value={discountPercent} min="0" max="100" onChange={e => { setDiscountPercent(e.target.value); setDiscountAmount('') }} placeholder="0" style={inp} />
            </div>
            <div>
              <label style={lbl}>Discount (LKR)</label>
              <input type="number" value={discountAmount} min="0" onChange={e => { setDiscountAmount(e.target.value); setDiscountPercent('') }} placeholder="0.00" style={inp} />
            </div>
          </div>
          <div>
            <label style={lbl}>Notes</label>
            <textarea value={notes} onChange={e => setNotes(e.target.value)} placeholder="Remarks, cheque no, etc…" rows={3} style={{ ...inp, resize: 'vertical', lineHeight: '1.5' }} />
          </div>
        </div>

        <div style={card}>
          <h2 style={{ margin: '0 0 16px', fontSize: '15px', fontWeight: '700', color: '#0f172a' }}>Invoice Summary</h2>
          <div style={{ marginBottom: '12px' }}>
            {[
              { label: 'Subtotal', val: formatCurrency(subtotal) },
              { label: discountPercent ? `Discount (${discountPercent}%)` : 'Discount', val: discAmt > 0 ? `− ${formatCurrency(discAmt)}` : '—', red: discAmt > 0 },
            ].map(r => (
              <div key={r.label} style={{ display: 'flex', justifyContent: 'space-between', padding: '9px 0', borderBottom: '1px solid #f1f5f9' }}>
                <span style={{ fontSize: '14px', color: '#64748b' }}>{r.label}</span>
                <span style={{ fontSize: '14px', color: r.red ? '#e11d48' : '#0f172a', fontWeight: '500' }}>{r.val}</span>
              </div>
            ))}
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', padding: '14px 16px', background: '#0f172a', borderRadius: '10px', marginBottom: '12px' }}>
            <span style={{ fontSize: '16px', color: '#94a3b8', fontWeight: '600' }}>Total</span>
            <span style={{ fontSize: '22px', color: 'white', fontWeight: '800' }}>{formatCurrency(total)}</span>
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', padding: '9px 0', borderBottom: '1px solid #f1f5f9', marginBottom: storedCredit > 0 ? '4px' : '12px' }}>
            <span style={{ fontSize: '14px', color: '#64748b' }}>Amount Paid</span>
            <span style={{ fontSize: '15px', color: '#059669', fontWeight: '700' }}>{formatCurrency(paidAmt)}</span>
          </div>
          {storedCredit > 0 && overpayment === 0 && (
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid #f1f5f9', marginBottom: '12px' }}>
              <span style={{ fontSize: '13px', color: '#059669' }}>+ Credit Applied</span>
              <span style={{ fontSize: '14px', color: '#059669', fontWeight: '700' }}>+{formatCurrency(Math.min(storedCredit, Math.max(0, total - paidAmt)))}</span>
            </div>
          )}

          {creditDue > 0 && (
            <div style={{ padding: '14px 16px', background: '#fff1f2', borderRadius: '10px', border: '1.5px solid #fecdd3', marginBottom: '16px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <div style={{ fontSize: '13px', fontWeight: '700', color: '#e11d48' }}>Credit Balance</div>
                  <div style={{ fontSize: '12px', color: '#fb7185', marginTop: '2px' }}>Will be added to customer outstanding</div>
                </div>
                <div style={{ fontSize: '20px', fontWeight: '800', color: '#e11d48' }}>{formatCurrency(creditDue)}</div>
              </div>
              {selectedCustomer?.credit_balance > 0 && (
                <div style={{ marginTop: '10px', paddingTop: '10px', borderTop: '1px solid #fecdd3', display: 'flex', justifyContent: 'space-between', fontSize: '13px' }}>
                  <span style={{ color: '#fb7185' }}>Total outstanding after this invoice</span>
                  <span style={{ fontWeight: '800', color: '#e11d48' }}>{formatCurrency((selectedCustomer.credit_balance || 0) + creditDue)}</span>
                </div>
              )}
            </div>
          )}

          {/* Overpayment warning */}
          {overpayment > 0 && !isCashCustomer && (
            <div style={{ padding: '14px 16px', background: '#f0fdf4', borderRadius: '10px', border: '1.5px solid #bbf7d0', marginBottom: '16px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <div style={{ fontSize: '13px', fontWeight: '700', color: '#059669' }}>⚠ Overpayment</div>
                  <div style={{ fontSize: '12px', color: '#34d399', marginTop: '2px' }}>Paid more than invoice total — you will be prompted on confirm</div>
                </div>
                <div style={{ fontSize: '20px', fontWeight: '800', color: '#059669' }}>+{formatCurrency(overpayment)}</div>
              </div>
            </div>
          )}

          {/* Stored credit being applied */}
          {storedCredit > 0 && overpayment === 0 && (
            <div style={{ padding: '12px 14px', background: '#f0fdf4', borderRadius: '10px', border: '1.5px solid #bbf7d0', marginBottom: '12px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <div style={{ fontSize: '13px', fontWeight: '700', color: '#166534' }}>✓ Stored Credit Applied</div>
                  <div style={{ fontSize: '12px', color: '#34d399', marginTop: '2px' }}>
                    {storedCredit >= (total - paidAmt) && total > paidAmt
                      ? `Covers remaining LKR ${formatCurrency(total - paidAmt)} — invoice fully settled`
                      : `Partially covers invoice — ${formatCurrency(Math.max(0, total - paidAmt - storedCredit))} still due`}
                  </div>
                </div>
                <div style={{ fontSize: '18px', fontWeight: '800', color: '#059669' }}>-{formatCurrency(Math.min(storedCredit, Math.max(0, total - paidAmt)))}</div>
              </div>
            </div>
          )}

          {selectedCustomer?.credit_balance > 0 && creditDue === 0 && overpayment === 0 && (
            <div style={{ padding: '12px 14px', background: '#fef3c7', borderRadius: '10px', border: '1px solid #fde68a', marginBottom: '16px', fontSize: '13px', color: '#92400e' }}>
              This customer has an existing outstanding of <strong>{formatCurrency(selectedCustomer.credit_balance)}</strong>
            </div>
          )}

          <div style={{ display: 'flex', gap: '10px', marginTop: '8px' }}>
            <button onClick={() => saveInvoice('draft')} disabled={saving}
              style={{ flex: 1, padding: '12px', background: 'white', color: '#475569', border: '1.5px solid #e2e8f0', borderRadius: '10px', cursor: 'pointer', fontWeight: '600', fontSize: '14px' }}>
              Save Draft
            </button>
            <button onClick={() => saveInvoice('confirmed')} disabled={saving}
              style={{ flex: 2, padding: '12px', background: saving ? '#93c5fd' : 'linear-gradient(135deg,#2563eb,#1d4ed8)', color: 'white', border: 'none', borderRadius: '10px', cursor: 'pointer', fontWeight: '700', fontSize: '15px' }}>
              {saving ? 'Saving...' : '✓ Confirm Invoice'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
