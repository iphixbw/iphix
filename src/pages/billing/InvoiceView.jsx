import { useState, useEffect, useRef } from 'react'
import { supabase } from '../../supabase'
import { formatCurrency } from '../../lib/helpers'
import { sendSMS, smsTemplates } from '../../lib/sms'
import toast from 'react-hot-toast'

export default function InvoiceView({ invoice, onBack, isCashier = false, session }) {
  const [details, setDetails] = useState(null)
  const [lineItems, setLineItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [mode, setMode] = useState('view') // 'view' | 'edit'
  const [showPaymentForm, setShowPaymentForm] = useState(false)
  const [showPrintOptions, setShowPrintOptions] = useState(false)
  const [bankAccounts, setBankAccounts] = useState([])
  const [payments, setPayments] = useState([])
  const [linkedCreditReturns, setLinkedCreditReturns] = useState([])
  const [saving, setSaving] = useState(false)

  // Payment form
  const [paymentForm, setPaymentForm] = useState({ amount: '', payment_method: 'cash', bank_account_id: '', cheque_no: '', cheque_date: '', notes: '' })

  // Edit form state — mirrors NewInvoice
  const [allItems, setAllItems] = useState([])
  const [allSalesmen, setAllSalesmen] = useState([])
  const [editItems, setEditItems] = useState([])
  const [editSalesman, setEditSalesman] = useState(null)
  const [editPaymentMethod, setEditPaymentMethod] = useState('cash')
  const [editAmountPaid, setEditAmountPaid] = useState('')
  const [editChequeNo, setEditChequeNo] = useState('')
  const [editChequeDate, setEditChequeDate] = useState('')
  const [editChequeBankId, setEditChequeBankId] = useState('')
  const [editDiscountPercent, setEditDiscountPercent] = useState('')
  const [editDiscountAmount, setEditDiscountAmount] = useState('')
  const [editNotes, setEditNotes] = useState('')
  const [itemSearch, setItemSearch] = useState('')
  const [showItemDrop, setShowItemDrop] = useState(false)
  const [showNewItem, setShowNewItem] = useState(false)
  const [newItem, setNewItem] = useState({ name: '', selling_price: '', cost_price: '' })
  const itemRef = useRef(null)

  useEffect(() => { fetchDetails() }, [invoice.id])

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

  async function fetchDetails() {
    setLoading(true)
    const [{ data: inv }, { data: li }, { data: banks }, { data: pays }, { data: items }, { data: salesmen }, { data: rets }] = await Promise.all([
      supabase.from('invoices').select('*, customers(*), salesmen(*), shops(*)').eq('id', invoice.id).single(),
      supabase.from('invoice_items').select('*, items(name, item_no, stock_quantity)').eq('invoice_id', invoice.id).order('created_at'),
      supabase.from('bank_accounts').select('*').order('name'),
      supabase.from('invoice_payments').select('*').eq('invoice_id', invoice.id).order('created_at'),
      supabase.from('items').select('*').order('name'),
      supabase.from('salesmen').select('*').order('name'),
      supabase.from('sales_returns').select('*').eq('invoice_id', invoice.id).eq('status', 'confirmed'),
    ])
    setDetails(inv)
    setLineItems(li || [])
    setBankAccounts(banks || [])
    setPayments(pays || [])
    setAllItems(items || [])
    setAllSalesmen(salesmen || [])
    // Only credit-method returns reduce what the customer owes — cash refunds are paid back separately
    setLinkedCreditReturns((rets || []).filter(r => r.payment_method === 'credit' || !r.payment_method))
    // Auto-select the logged-in user's salesman for the edit panel
    if (session?.user) await autoSelectSalesman(salesmen || [], session.user, setEditSalesman)
    setLoading(false)
  }

  // ── Enter edit mode ──────────────────────────────────────
  function enterEditMode() {
    if (!details) return
    setEditItems((lineItems || []).map(li => ({
      item_id: li.item_id,
      name: li.items?.name,
      quantity: li.quantity,
      unit_price: li.unit_price,
      warranty: li.warranty,
      immi_no: li.immi_no || '',
    })))
    setEditSalesman(allSalesmen.find(s => s.id === details.salesman_id) || null)
    setEditPaymentMethod(details.payment_method || 'cash')
    setEditAmountPaid(details.amount_paid !== details.total ? String(details.amount_paid || '') : '')
    setEditChequeNo(details.cheque_no || '')
    setEditChequeDate(details.cheque_date || '')
    setEditChequeBankId(details.cheque_bank_id || '')
    setEditDiscountPercent(details.discount_percent ? String(details.discount_percent) : '')
    setEditDiscountAmount(!details.discount_percent && details.discount_amount ? String(details.discount_amount) : '')
    setEditNotes(details.notes || '')
    setMode('edit')
  }

  // ── Edit calculations ────────────────────────────────────
  const editSubtotal = editItems.reduce((s, r) => s + r.quantity * r.unit_price, 0)
  const editDiscPct = parseFloat(editDiscountPercent) || 0
  const editDiscAmt = editDiscountPercent
    ? (editSubtotal * editDiscPct) / 100
    : parseFloat(editDiscountAmount) || 0
  const editTotal = Math.max(0, editSubtotal - editDiscAmt)
  const editIsCredit = editPaymentMethod === 'credit'
  const editIsPartial = editPaymentMethod === 'partial'
  const editPaid = editIsCredit ? 0 : editIsPartial ? (parseFloat(editAmountPaid) || 0) : editTotal
  const editCredit = Math.max(0, editTotal - editPaid)

  // ── Item helpers ─────────────────────────────────────────
  function addEditItem(item) {
    const idx = editItems.findIndex(r => r.item_id === item.id)
    if (idx >= 0) {
      setEditItems(rows => rows.map((r, i) => i === idx ? { ...r, quantity: r.quantity + 1 } : r))
    } else {
      setEditItems(rows => [...rows, { item_id: item.id, name: item.name, quantity: 1, unit_price: parseFloat(item.selling_price) || 0, warranty: 'no', immi_no: '' }])
    }
    setItemSearch('')
    setShowItemDrop(false)
    setTimeout(() => itemRef.current?.focus(), 50)
  }

  function updateEditRow(idx, field, value) {
    setEditItems(rows => rows.map((r, i) => i === idx ? { ...r, [field]: value } : r))
  }

  async function createNewItem() {
    if (!newItem.name.trim()) return toast.error('Item name is required')
    if (!newItem.selling_price) return toast.error('Selling price is required')
    try {
      const { data: genNo } = await supabase.rpc('generate_item_no')
      const { data, error } = await supabase.from('items').insert({
        item_no: genNo, name: newItem.name,
        selling_price: parseFloat(newItem.selling_price),
        cost_price: parseFloat(newItem.cost_price) || 0,
      }).select().single()
      if (error) throw error
      setAllItems(prev => [...prev, data])
      addEditItem(data)
      setShowNewItem(false)
      setNewItem({ name: '', selling_price: '', cost_price: '' })
      toast.success('Item created!')
    } catch (e) { toast.error('Failed: ' + e.message) }
  }

  // ── Save draft edit ──────────────────────────────────────
  async function saveDraftEdit(confirmAfter = false) {
    if (editItems.length === 0) return toast.error('Add at least one item')
    if (!editSalesman) return toast.error('Select a salesman')

    // Stock check only if confirming
    if (confirmAfter) {
      for (const row of editItems) {
        const orig = lineItems.find(li => li.item_id === row.item_id)
        const extra = row.quantity - (orig?.quantity || 0)
        if (extra > 0) {
          const { data: item } = await supabase.from('items').select('stock_quantity, name').eq('id', row.item_id).single()
          if (item && (item.stock_quantity || 0) < extra) {
            toast.error(`Not enough stock for "${item.name}". Available: ${item.stock_quantity || 0}`)
            return
          }
        }
      }
    }

    setSaving(true)
    try {
      const newStatus = confirmAfter ? 'confirmed' : 'draft'

      await supabase.from('invoices').update({
        salesman_id: editSalesman.id,
        payment_method: editPaymentMethod,
        amount_paid: editPaid,
        discount_percent: editDiscPct,
        discount_amount: editDiscAmt,
        subtotal: editSubtotal,
        total: editTotal,
        credit_amount: editCredit,
        notes: editNotes,
        cheque_no: editPaymentMethod === 'cheque' ? editChequeNo : null,
        cheque_date: editPaymentMethod === 'cheque' ? editChequeDate : null,
        cheque_bank_id: editPaymentMethod === 'cheque' ? editChequeBankId : null,
        status: newStatus,
      }).eq('id', invoice.id)

      // Record cheque as pending bank transaction on confirm
      if (confirmAfter && editPaymentMethod === 'cheque' && editChequeBankId && editChequeDate) {
        await supabase.from('bank_transactions').insert({
          bank_account_id: editChequeBankId,
          type: 'cheque_in',
          amount: editPaid,
          cheque_no: editChequeNo || null,
          cheque_date: editChequeDate,
          cheque_status: 'pending',
          reference: `Invoice: ${invoice.invoice_no || details.invoice_no}`,
          notes: `Customer: ${details.customers?.name}`,
        })
      }

      // Replace line items
      await supabase.from('invoice_items').delete().eq('invoice_id', invoice.id)
      await supabase.from('invoice_items').insert(
        editItems.map(r => ({
          invoice_id: invoice.id,
          item_id: r.item_id,
          quantity: r.quantity,
          unit_price: r.unit_price,
          line_total: r.quantity * r.unit_price,
          warranty: r.warranty,
          immi_no: r.immi_no || null,
        }))
      )

      // Update customer credit atomically — only the delta (new credit minus old credit)
      const oldCredit = details.credit_amount || 0
      const creditDiff = editCredit - oldCredit
      if (creditDiff !== 0) {
        await supabase.rpc('adjust_customer_balance', { p_customer_id: details.customer_id, p_delta: creditDiff })
      }

      // Deduct stock on confirm — atomically via RPC
      if (confirmAfter) {
        for (const row of editItems) {
          await supabase.rpc('deduct_item_stock', { p_item_id: row.item_id, p_quantity: row.quantity })
        }
      }

      toast.success(confirmAfter ? 'Invoice confirmed!' : 'Draft updated!')
      setMode('view')
      fetchDetails()
      if (confirmAfter) setShowPrintOptions(true)
    } catch (e) { toast.error('Error: ' + e.message) }
    setSaving(false)
  }

  // ── Confirm existing draft (view mode) ───────────────────
  async function confirmInvoice() {
    // Check stock availability
    for (const li of lineItems) {
      if (li.is_third_party) continue
      const { data: item } = await supabase.from('items').select('stock_quantity, name').eq('id', li.item_id).single()
      if (item && (item.stock_quantity || 0) < li.quantity) {
        toast.error(`Not enough stock for "${item.name}". Available: ${item.stock_quantity || 0}, Required: ${li.quantity}`)
        return
      }
    }
    const { error } = await supabase.from('invoices').update({ status: 'confirmed', stock_deducted: true }).eq('id', invoice.id)
    if (error) return toast.error('Failed to confirm')
    if (!details?.stock_deducted) {
      for (const li of lineItems) {
        if (li.is_third_party) continue
        // 1. Atomically deduct global stock
        await supabase.rpc('deduct_item_stock', { p_item_id: li.item_id, p_quantity: li.quantity })
        // 2. Deduct from shop-specific inventory (FIFO)
        if (details?.shop_id) {
          let remaining = li.quantity
          const { data: batches } = await supabase.from('inventory')
            .select('id, quantity').eq('item_id', li.item_id).eq('shop_id', details.shop_id)
            .gt('quantity', 0).order('received_at', { ascending: true })
          for (const batch of (batches || [])) {
            if (remaining <= 0) break
            const deduct = Math.min(batch.quantity, remaining)
            await supabase.from('inventory').update({ quantity: batch.quantity - deduct }).eq('id', batch.id)
            remaining -= deduct
          }
        }
      }
    }
    toast.success('Invoice confirmed!')
    fetchDetails()
    setShowPrintOptions(true)
  }

  async function cancelInvoice() {
    if (!window.confirm(`Cancel invoice ${details.invoice_no}? This will:\n• Restore all stock\n• Remove customer balance impact\n• Reverse any bank payments received\n\nThis cannot be undone.`)) return
    try {
      // 1. Restore stock — re-add quantities to items.stock_quantity + restore shop inventory batches
      if (details.stock_deducted) {
        for (const li of lineItems) {
          if (li.is_third_party) continue
          // Restore shop inventory batches in reverse-FIFO order:
          // The confirm deducted from oldest batches first, so we restore to oldest batches first
          if (details.shop_id) {
            let remaining = li.quantity
            const { data: batches } = await supabase.from('inventory')
              .select('id, quantity').eq('item_id', li.item_id).eq('shop_id', details.shop_id)
              .order('received_at', { ascending: true }) // oldest first — same order as FIFO deduction
            for (const batch of (batches || [])) {
              if (remaining <= 0) break
              await supabase.from('inventory').update({ quantity: batch.quantity + remaining }).eq('id', batch.id)
              remaining = 0 // All restored to the first (oldest) batch
            }
            // If no batches exist (fully depleted), insert a new one to restore
            if (remaining > 0) {
              await supabase.from('inventory').insert({
                item_id: li.item_id, shop_id: details.shop_id,
                quantity: remaining, cost_price: li.unit_price || 0,
              })
            }
          }
          // Recompute global stock_quantity as sum of all inventory batches (source of truth)
          const { data: allBatches } = await supabase.from('inventory')
            .select('quantity').eq('item_id', li.item_id)
          const newTotal = (allBatches || []).reduce((s, b) => s + (b.quantity || 0), 0)
          await supabase.from('items').update({ stock_quantity: newTotal }).eq('id', li.item_id)
        }
      }

      // 2. Reverse customer balance — recompute excluding this invoice
      if (details.customer_id) {
        const { data: allInvs } = await supabase.from('invoices')
          .select('id, credit_amount, invoice_payments(amount)')
          .eq('customer_id', details.customer_id).eq('status', 'confirmed').neq('id', invoice.id)
        const { data: allRets } = await supabase.from('sales_returns')
          .select('invoice_id, total, payment_method')
          .eq('customer_id', details.customer_id).eq('status', 'confirmed')
        const returnsByInv = {}
        ;(allRets || []).filter(r => r.payment_method === 'credit' || !r.payment_method).forEach(r => {
          if (r.invoice_id) returnsByInv[r.invoice_id] = (returnsByInv[r.invoice_id] || 0) + (r.total || 0)
        })
        const newBalance = (allInvs || []).reduce((tot, inv) => {
          const paid = (inv.invoice_payments || []).reduce((s, p) => s + p.amount, 0)
          const rets = returnsByInv[inv.id] || 0
          return tot + Math.max(0, (inv.credit_amount || 0) - paid - rets)
        }, 0)
        await supabase.from('customers').update({ credit_balance: newBalance }).eq('id', details.customer_id)
      }

      // 3. Reverse bank deposits from invoice_payments on this invoice
      for (const pmt of payments) {
        if (pmt.payment_method === 'bank_transfer' && pmt.bank_account_id) {
          const { data: acc } = await supabase.from('bank_accounts').select('balance').eq('id', pmt.bank_account_id).single()
          await supabase.from('bank_accounts').update({ balance: Math.max(0, (acc?.balance || 0) - pmt.amount) }).eq('id', pmt.bank_account_id)
          await supabase.from('bank_transactions').delete()
            .eq('bank_account_id', pmt.bank_account_id)
            .ilike('reference', `Invoice Payment: ${details.invoice_no}`)
        }
      }

      // 4. Cancel the invoice
      await supabase.from('invoices').update({ status: 'cancelled' }).eq('id', invoice.id)
      toast.success(`Invoice ${details.invoice_no} cancelled.`)
      fetchDetails()
    } catch (e) { toast.error('Failed: ' + e.message) }
  }

  // ── Receive payment ──────────────────────────────────────
  async function receivePayment() {
    const amt = parseFloat(paymentForm.amount)
    if (!amt || amt <= 0) return toast.error('Enter a valid amount')
    const totalPaid = payments.reduce((s, p) => s + p.amount, 0)
    const totalRets = linkedCreditReturns.reduce((s, r) => s + (r.total || 0), 0)
    const remaining = Math.max(0, (details?.credit_amount || 0) - totalPaid - totalRets)
    if (remaining <= 0) return toast.error('This invoice is already fully paid')
    const payAmt = Math.min(amt, remaining)
    setSaving(true)
    try {
      const { data: newPayment, error: payErr } = await supabase.from('invoice_payments').insert({
        invoice_id: invoice.id, amount: payAmt,
        payment_method: paymentForm.payment_method,
        bank_account_id: paymentForm.bank_account_id || null,
        cheque_no: paymentForm.cheque_no || null,
        cheque_date: paymentForm.cheque_date || null,
        cheque_status: paymentForm.payment_method === 'cheque' ? 'pending' : null,
        notes: paymentForm.notes,
      }).select().single()
      if (payErr) throw payErr
      // Cheque payments also get a linked bank_transactions row, so Bank.jsx's
      // Cheques Due list sees it and a return from either screen can sync both.
      if (paymentForm.payment_method === 'cheque') {
        const { data: btx } = await supabase.from('bank_transactions').insert({
          bank_account_id: paymentForm.bank_account_id || null,
          type: 'cheque_in', amount: payAmt,
          cheque_no: paymentForm.cheque_no || null,
          cheque_date: paymentForm.cheque_date || null,
          cheque_status: 'pending',
          reference: `Invoice Payment: ${details.invoice_no}`,
          notes: `Customer: ${details.customers?.name}`,
          invoice_payment_id: newPayment.id,
        }).select().single()
        if (btx) await supabase.from('invoice_payments').update({ bank_transaction_id: btx.id }).eq('id', newPayment.id)
      }
      // DO NOT update credit_amount — it is immutable (the original balance)
      // Recompute customer credit_balance from scratch — opening balance + credit
      // invoices − payments − credit-method returns (cash refunds don't reduce it)
      const { data: custRow } = await supabase.from('customers').select('opening_balance').eq('id', details.customer_id).single()
      const { data: allInvs } = await supabase
        .from('invoices').select('id, credit_amount, invoice_payments(amount)')
        .eq('customer_id', details.customer_id).eq('status', 'confirmed')
      const { data: allRets } = await supabase
        .from('sales_returns').select('invoice_id, total, payment_method')
        .eq('customer_id', details.customer_id).eq('status', 'confirmed')
      const returnsByInv = {}
      ;(allRets || []).filter(r => r.payment_method === 'credit' || !r.payment_method).forEach(r => {
        if (r.invoice_id) returnsByInv[r.invoice_id] = (returnsByInv[r.invoice_id] || 0) + (r.total || 0)
      })
      const newBalance = (allInvs || []).reduce((total, inv) => {
        const paid = (inv.invoice_payments || []).reduce((s, p) => s + p.amount, 0)
        const rets = returnsByInv[inv.id] || 0
        return total + Math.max(0, (inv.credit_amount || 0) - paid - rets)
      }, custRow?.opening_balance || 0)
      await supabase.from('customers').update({ credit_balance: newBalance }).eq('id', details.customer_id)

      // Update bank/cash
      if (paymentForm.payment_method === 'bank_transfer' && paymentForm.bank_account_id) {
        const bank = bankAccounts.find(b => b.id === paymentForm.bank_account_id)
        await supabase.from('bank_accounts').update({ balance: (bank?.balance || 0) + payAmt }).eq('id', paymentForm.bank_account_id)
        await supabase.from('bank_transactions').insert({ bank_account_id: paymentForm.bank_account_id, type: 'deposit', amount: payAmt, reference: `Invoice Payment: ${details.invoice_no}`, notes: `Customer: ${details.customers?.name}` })
      }
      // Cash payment: tracked via invoice_payments (method=cash) — Cashflow reads that for "Cash Received from Customers"
      // No cash_deposits insert needed — that table is only for actual cash→bank deposits

      if (payAmt < amt) toast.success(`Payment of ${formatCurrency(payAmt)} received (capped at remaining balance)`)
      else toast.success('Payment received!')
      setShowPaymentForm(false)
      setPaymentForm({ amount: '', payment_method: 'cash', bank_account_id: '', cheque_no: '', cheque_date: '', notes: '' })
      // Send SMS to customer
      if (details.customers?.phone) {
        const msg = smsTemplates.customerPaymentCollected(
          details.customers.name, payAmt, Math.max(0, newBalance),
          details.shops?.name || 'Phonefix'
        )
        sendSMS({ to: details.customers.phone, message: msg, triggeredBy: 'invoice_payment', referenceType: 'invoice', referenceId: invoice.id })
          .then(({ success }) => { if (success) toast.success('SMS sent to customer') })
      }
      fetchDetails()
    } catch (e) { toast.error('Error: ' + e.message) }
    setSaving(false)
  }

  // ── Return / bounce a cheque payment on this invoice ──────────────
  async function returnInvoiceCheque(payment) {
    if (!window.confirm(`Mark this cheque as returned/bounced?\n\nAmount: ${formatCurrency(payment.amount)}\nCheque #: ${payment.cheque_no || '—'}\n\nThis will reverse the payment and add the amount back to the customer's outstanding balance.`)) return
    setSaving(true)
    try {
      // A single cheque can be split across multiple invoices via FIFO — each
      // portion is its own invoice_payments row, but all share the same
      // bank_transaction_id. Marking only the one row passed in here (this
      // invoice's portion) would leave sibling rows on other invoices stuck as
      // still-pending even though the same physical cheque bounced for all of
      // them. Find and mark every row sharing that link, not just this one.
      let linkedPaymentIds = [payment.id]
      if (payment.bank_transaction_id) {
        const { data: siblingPayments } = await supabase
          .from('invoice_payments').select('id').eq('bank_transaction_id', payment.bank_transaction_id)
        if (siblingPayments?.length) linkedPaymentIds = siblingPayments.map(p => p.id)
      }
      await supabase.from('invoice_payments').update({
        cheque_status: 'returned',
        returned_at: new Date().toISOString(),
        notes: ((payment.notes || '') + ' [RETURNED]').trim(),
      }).in('id', linkedPaymentIds)

      // Keep the linked bank_transactions row (if one exists) in sync — this is
      // what makes the cheque show as returned in Bank.jsx too, not just here.
      const linkedBtxId = payment.bank_transaction_id
      if (linkedBtxId) {
        const { data: btx } = await supabase.from('bank_transactions').select('notes').eq('id', linkedBtxId).single()
        await supabase.from('bank_transactions').update({
          cheque_status: 'presented',
          notes: ((btx?.notes || '') + ' [RETURNED]').trim(),
        }).eq('id', linkedBtxId)
      }

      // Recompute customer credit_balance from scratch, using the same full-ledger
      // model as Customers.jsx's computeCustomerBalance: every invoice's full total
      // is a debit (not just credit_amount, which excludes cash portions), every
      // non-returned payment is a credit, and a linked bank_transactions row's
      // overpayment remainder is handled the same way. This replaces the previous
      // credit_amount-based recompute here, which had drifted out of sync with the
      // model fixed everywhere else in the app.
      const { data: custRow } = await supabase.from('customers').select('opening_balance').eq('id', details.customer_id).single()
      const { data: allInvs } = await supabase
        .from('invoices').select('id, total, amount_paid, invoice_payments(amount, cheque_status, bank_transaction_id)')
        .eq('customer_id', details.customer_id).eq('status', 'confirmed')
      const { data: allRets } = await supabase
        .from('sales_returns').select('invoice_id, total, payment_method')
        .eq('customer_id', details.customer_id).eq('status', 'confirmed')
      const { data: allBankTx } = await supabase
        .from('bank_transactions').select('id, amount, notes, invoice_payment_id')
        .ilike('reference', `%${details.customers?.name || ''}%`).in('type', ['deposit', 'cheque_in'])
      const returnsByInv2 = {}
      ;(allRets || []).filter(r => r.payment_method === 'credit' || !r.payment_method).forEach(r => {
        if (r.invoice_id) returnsByInv2[r.invoice_id] = (returnsByInv2[r.invoice_id] || 0) + (r.total || 0)
      })
      let newBalance = custRow?.opening_balance || 0
      ;(allInvs || []).forEach(inv => {
        newBalance += inv.total || 0
        if ((inv.amount_paid || 0) > 0) newBalance -= inv.amount_paid
        ;(inv.invoice_payments || []).forEach(p => {
          if (p.cheque_status !== 'returned') newBalance -= p.amount
        })
        newBalance -= (returnsByInv2[inv.id] || 0)
      })
      ;(allBankTx || []).forEach(tx => {
        const isOpeningPayment = !tx.invoice_payment_id
        if (isOpeningPayment) {
          if (!(tx.notes && tx.notes.includes('[RETURNED]')) && tx.notes && tx.notes.includes('Opening balance')) {
            newBalance -= tx.amount
          }
        } else if (!(tx.notes && tx.notes.includes('[RETURNED]'))) {
          const linkedTotal = (allInvs || []).reduce((s, inv) =>
            s + (inv.invoice_payments || []).filter(p => p.bank_transaction_id === tx.id).reduce((s2, p) => s2 + p.amount, 0), 0)
          const remainder = tx.amount - linkedTotal
          if (remainder > 0.009) newBalance -= remainder
        }
      })
      await supabase.from('customers').update({ credit_balance: newBalance }).eq('id', details.customer_id)

      toast.success(`Cheque returned — ${formatCurrency(payment.amount)} added back to customer balance`)
      fetchDetails()
    } catch (e) { toast.error('Failed: ' + e.message) }
    setSaving(false)
  }

  // ── Print helpers ────────────────────────────────────────
  function printReceipt() {
    // Guard against printing before this invoice's data has finished loading —
    // total/amount_paid would show as 0.00 if we proceed with stale/empty state.
    if (!details || details.id !== invoice.id || loading) {
      toast.error('Invoice still loading — please try again in a moment')
      return
    }
    const w = window.open('', '_blank')
    const d = details
    const fmt2 = n => parseFloat(n||0).toLocaleString('en-LK',{minimumFractionDigits:2})
    const dateStr2 = new Date(d?.created_at||Date.now()).toLocaleDateString('en-GB',{day:'2-digit',month:'2-digit',year:'numeric'})
    const timeStr2 = new Date(d?.created_at||Date.now()).toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit',second:'2-digit'})
    const shopName2 = 'PHONEFIX (PVT) LTD'
    w.document.write(`<!DOCTYPE html><html><head><title>Receipt ${d?.invoice_no}</title>
    <style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:'Arial',sans-serif;font-size:13px;font-weight:bold;width:75mm;margin:0 auto;padding:4px}.c{text-align:center}.b{font-weight:bold}.dashed{border-top:1px dashed #000;margin:4px 0}.solid{border-top:2px solid #000;margin:4px 0}.row{display:flex;justify-content:space-between;padding:1px 0;font-size:13px;font-weight:bold}.tot{display:flex;justify-content:space-between;font-weight:bold;font-size:16px;padding:3px 0}.bal{display:flex;justify-content:space-between;font-weight:bold;font-size:14px;padding:2px 0}@media print{@page{size:75mm auto;margin:1mm}}</style></head><body>
    <div class="c b" style="font-size:18px;font-weight:bold;letter-spacing:1px">${shopName2}</div>
    ${d?.shops?.address?`<div class="c" style="font-size:10px">${d.shops.address.toUpperCase()}</div>`:''}
    ${d?.shops?.phone?`<div class="c" style="font-size:10px">${d.shops.phone}</div>`:''}
    <div class="dashed"></div>
    <div class="row"><span>CASHIER &nbsp;: ${d?.salesmen?.name||'—'}</span><span>SALESMAN : ${d?.salesmen?.name||'—'}</span></div>
    <div class="row"><span>UNIT &nbsp;&nbsp;&nbsp;&nbsp;: ${d?.shops?.name||'—'}</span><span>INVOICE  : ${d?.invoice_no}</span></div>
    <div class="row"><span>CUSTOMER : ${(d?.customers?.name||'Cash Customer').toUpperCase()}</span></div>
    <div class="dashed"></div>
    <div class="row b" style="font-size:12px;font-weight:bold"><span>No. Product</span><span style="display:flex;gap:16px"><span>Rate</span><span>Qty</span><span>Amount</span></span></div>
    <div class="dashed"></div>
    ${lineItems.map((li,idx)=>`<div style="font-size:12px;font-weight:bold;padding:1px 0">${idx+1}. ${li.items?.name||li.name||''}${(li.warranty&&li.warranty!=='no')?` [W:${li.warranty}]`:''}</div><div style="display:flex;justify-content:space-between;font-size:12px;font-weight:bold;padding:0 0 3px 10px"><span>${li.immi_no||''}&nbsp;&nbsp;${fmt2(li.unit_price)} *${li.quantity}</span><span>${fmt2(li.line_total)}</span></div>`).join('')}
    <div class="dashed"></div>
    <div class="row"><span>GROSS TOTAL :</span><span>${fmt2(d?.total)}</span></div>
    <div class="solid"></div>
    <div class="tot"><span>TOTAL :</span><span>${fmt2(d?.total)}</span></div>
    <div class="solid"></div>
    ${(remainingCredit||0)>0?`<div class="bal"><span>CREDIT :</span><span>${fmt2(remainingCredit)}</span></div>`:`<div class="row"><span>PAID :</span><span>${fmt2(d?.amount_paid)}</span></div>`}
    <div class="dashed"></div>
    <div style="display:flex;justify-content:space-between;font-size:10px">
      <span>Items : ${lineItems?.length||0} &nbsp; Pcs : ${lineItems.reduce((s,l)=>s+(l.quantity||0),0)}</span>
    </div>
    <div style="display:flex;justify-content:space-between;font-size:10px">
      <span>Date : ${dateStr2}</span><span>Time : ${timeStr2}</span>
    </div>
    ${(remainingCredit||0)>0?`<div class="solid"></div><div class="c b" style="font-size:12px">CURRENT BALANCE : ${fmt2(d?.customers?.credit_balance||0)}</div>`:''}
    <div class="solid"></div>
    <div class="c b" style="font-size:13px;font-weight:bold;margin:3px 0">★ Thank You! Visit Again ★</div>
    <div class="c" style="font-size:11px;font-weight:bold">Your trust is our greatest reward.</div>
    <div class="c" style="font-size:11px;font-weight:bold;margin-top:2px">Designed for Phonefix (PVT) Ltd · Powered by Techmo Solutions</div>
    <script>window.onload=function(){window.print()}<\/script></body></html>`)
    w.document.close()
  }

  function printA5Invoice() {
    // Same staleness guard as printReceipt — see comment there.
    if (!details || details.id !== invoice.id || loading) {
      toast.error('Invoice still loading — please try again in a moment')
      return
    }
    const w = window.open('', '_blank')
    const d = details
    const fmt = (n) => parseFloat(n || 0).toLocaleString('en-LK', { minimumFractionDigits: 2 })
    const dateStr = new Date(d?.created_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' })
    const pmLabels = { cash: 'Cash', card: 'Card / POS', cheque: 'Cheque', bank_transfer: 'Bank Transfer', credit: 'Credit', partial: 'Partial Payment' }
    const custBalance = d?.customers?.credit_balance || 0

    w.document.write(`<!DOCTYPE html>
<html><head>
<title>Invoice ${d?.invoice_no}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: Arial, Helvetica, sans-serif; font-size: 12px; color: #000; background: white; }
  @page { size: A5; margin: 8mm; }
  @media print { body { margin: 0; } .no-print { display: none; } }

  /* ── Header band ── */
  .header-band { background: #000; color: #fff; padding: 12px 16px 8px; margin-bottom: 0; }
  .co-name { font-size: 24px; font-weight: 900; letter-spacing: 1px; text-align: center; line-height: 1.1; color: #fff; }
  .co-tagline { font-size: 9px; letter-spacing: 3px; text-align: center; color: #ccc; margin-top: 2px; text-transform: uppercase; font-weight: 600; }
  .co-contact { font-size: 9px; text-align: center; color: #ccc; margin-top: 2px; font-weight: 600; }

  /* ── Invoice banner ── */
  .inv-banner { background: #fff; color: #000; display: flex; justify-content: space-between; align-items: center; padding: 8px 0 6px; border-bottom: 2px solid #000; margin-bottom: 10px; }
  .inv-banner-title { font-size: 18px; font-weight: 900; letter-spacing: 2px; text-transform: uppercase; color: #000; }
  .inv-banner-meta { text-align: right; font-size: 10px; line-height: 1.7; color: #000; font-weight: 700; }
  .inv-banner-no { font-size: 14px; font-weight: 900; color: #000; }

  /* ── Meta grid ── */
  .meta { display: grid; grid-template-columns: 1fr 1fr; gap: 0; margin-bottom: 10px; border: 1.5px solid #000; overflow: hidden; }
  .meta-box { padding: 8px 10px; }
  .meta-box:first-child { border-right: 1.5px solid #000; }
  .meta-label { font-size: 8px; font-weight: 900; color: #000; text-transform: uppercase; letter-spacing: 0.1em; margin-bottom: 3px; }
  .meta-value { font-size: 13px; font-weight: 900; color: #000; line-height: 1.4; }
  .meta-sub { font-size: 10px; color: #000; line-height: 1.5; margin-top: 1px; font-weight: 600; }

  /* ── Items table ── */
  table { width: 100%; border-collapse: collapse; margin-bottom: 8px; font-size: 11px; }
  thead tr { background: #000; }
  thead th { padding: 5px 7px; text-align: left; font-size: 9px; font-weight: 900; text-transform: uppercase; letter-spacing: 0.07em; color: #fff; }
  thead th.r { text-align: right; }
  tbody tr { border-bottom: 1px solid #ccc; }
  tbody tr:nth-child(even) { background: #f5f5f5; }
  tbody td { padding: 4px 7px; vertical-align: top; color: #000; font-weight: 600; }
  tbody td.r { text-align: right; font-weight: 700; }
  .badge { font-size: 8px; font-weight: 700; padding: 1px 5px; border: 1px solid #000; margin-left: 3px; display: inline-block; }

  /* ── Totals ── */
  .totals-wrap { display: flex; justify-content: flex-end; margin-bottom: 10px; }
  .totals { width: 210px; border: 1.5px solid #000; overflow: hidden; }
  .tot-row { display: flex; justify-content: space-between; padding: 4px 10px; font-size: 11px; border-bottom: 1px solid #ccc; font-weight: 700; color: #000; }
  .tot-row:last-child { border-bottom: none; }
  .tot-row.grand { background: #000; color: #fff; font-size: 13px; font-weight: 900; padding: 6px 10px; }
  .tot-row.credit { background: #f5f5f5; color: #000; font-weight: 900; font-size: 11px; border-top: 1.5px solid #000; }
  .tot-row.fullpaid { background: #f5f5f5; color: #000; font-weight: 700; font-size: 11px; }

  /* ── Payment + Balance ── */
  .info-row { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 10px; }
  .info-box { border: 1.5px solid #000; padding: 7px 10px; }
  .info-box-label { font-size: 8px; font-weight: 900; color: #000; text-transform: uppercase; letter-spacing: 0.08em; margin-bottom: 3px; }
  .info-box-value { font-size: 12px; font-weight: 900; color: #000; }
  .info-box-sub { font-size: 9px; color: #000; margin-top: 2px; font-weight: 600; }
  .balance-outstanding { background: #f5f5f5; }
  .balance-outstanding .info-box-value { font-size: 14px; font-weight: 900; }
  .balance-clear .info-box-value { font-weight: 900; }

  /* ── Footer ── */
  .footer-band { border-top: 2px solid #000; padding: 10px 16px; margin-top: 6px; text-align: center; }
  .footer-thanks { font-size: 13px; font-weight: 900; color: #000; letter-spacing: 0.5px; }
  .footer-msg { font-size: 9px; color: #000; margin-top: 3px; line-height: 1.6; font-weight: 600; }
  .footer-co { font-size: 8px; color: #000; margin-top: 4px; letter-spacing: 1px; text-transform: uppercase; font-weight: 600; }

  .status-badge { display: inline-block; padding: 1px 8px; font-size: 9px; font-weight: 900; text-transform: uppercase; letter-spacing: 0.06em; border: 1px solid #ccc; color: #000; }
  .badge-confirmed { background: #fff; }
  .badge-draft { background: #f5f5f5; }
</style>
</head>
<body>

  <!-- Header Band -->
  <div class="header-band">
    <div class="co-name">PHONEFIX (PVT) LTD</div>
    <div class="co-tagline">Your Trusted Technology Partner</div>
    <div class="co-contact">${d?.shops?.address ? d.shops.address + (d?.shops?.phone ? '  ·  ' + d.shops.phone : '') : (d?.shops?.phone || '')}</div>
  </div>

  <!-- Invoice Banner -->
  <div class="inv-banner">
    <div>
      <div class="inv-banner-title">Invoice</div>
      <div style="font-size:9px;color:rgba(255,255,255,0.7);margin-top:2px">${d?.shops?.name || 'Phonefix'}</div>
    </div>
    <div class="inv-banner-meta">
      <div class="inv-banner-no">${d?.invoice_no}</div>
      <div>${dateStr}</div>
      <div style="margin-top:3px"><span class="status-badge ${d?.status === 'confirmed' ? 'badge-confirmed' : 'badge-draft'}">${(d?.status || 'draft').toUpperCase()}</span></div>
    </div>
  </div>

  <!-- Bill To / Salesman -->
  <div class="meta">
    <div class="meta-box">
      <div class="meta-label">Bill To</div>
      <div class="meta-value">${d?.customers?.name || '—'}</div>
      <div class="meta-sub">${d?.customers?.customer_no || ''}</div>
      ${d?.customers?.phone ? `<div class="meta-sub">${d.customers.phone}</div>` : ''}
      ${d?.customers?.address ? `<div class="meta-sub">${d.customers.address}</div>` : ''}
    </div>
    <div class="meta-box">
      <div class="meta-label">Served By</div>
      <div class="meta-value">${d?.salesmen?.name || '—'}</div>
      <div class="meta-sub">Payment: ${pmLabels[d?.payment_method] || d?.payment_method || '—'}</div>
      ${d?.payment_method === 'cheque' ? `<div class="meta-sub">${d?.cheque_no ? 'Cheque #' + d.cheque_no : ''} ${d?.cheque_bank_name ? '· ' + d.cheque_bank_name : ''}</div>` : ''}
      ${d?.notes ? `<div class="meta-sub" style="margin-top:4px;font-style:italic">${d.notes}</div>` : ''}
    </div>
  </div>

  <!-- Items Table -->
  <table>
    <thead>
      <tr>
        <th style="width:24px">#</th>
        <th>Description</th>
        <th style="width:28px" class="r">Qty</th>
        <th style="width:72px" class="r">Unit Price</th>
        <th style="width:76px" class="r">Amount</th>
      </tr>
    </thead>
    <tbody>
      ${lineItems.map((li, i) => `
      <tr>
        <td style="color:#94a3b8;font-size:10px">${i + 1}</td>
        <td>
          <div style="font-weight:700;color:#0f172a">${li.items?.name || '—'}</div>
          <div style="font-size:9px;color:#94a3b8;margin-top:1px">
            ${li.items?.item_no ? li.items.item_no : ''}
            ${li.immi_no ? '· Immi: ' + li.immi_no : ''}
          </div>
          ${li.is_free_issue ? '<span class="badge" style="background:#eef2ff;color:#1e40af">FREE ISSUE</span>' : ''}
          ${li.is_third_party ? '<span class="badge" style="background:#fef3c7;color:#92400e">3RD PARTY</span>' : ''}
          ${(li.warranty && li.warranty !== 'no' && li.warranty !== false) ? `<span class="badge" style="background:#d1fae5;color:#065f46">Warranty: ${li.warranty}</span>` : ''}
        </td>
        <td class="r">${li.quantity}</td>
        <td class="r">${li.is_free_issue ? '—' : 'LKR ' + fmt(li.unit_price)}</td>
        <td class="r">${li.is_free_issue ? '<span style="color:#2563eb;font-size:10px;font-weight:700">FREE</span>' : 'LKR ' + fmt(li.line_total)}</td>
      </tr>`).join('')}
    </tbody>
  </table>

  <!-- Totals -->
  <div class="totals-wrap">
    <div class="totals">
      <div class="tot-row"><span style="color:#64748b">Subtotal</span><span>LKR ${fmt(d?.subtotal)}</span></div>
      ${(d?.discount_amount || 0) > 0 ? `<div class="tot-row"><span style="color:#64748b">Discount</span><span style="color:#059669">− LKR ${fmt(d.discount_amount)}</span></div>` : ''}
      <div class="tot-row grand"><span>TOTAL</span><span>LKR ${fmt(d?.total)}</span></div>
      <div class="tot-row"><span style="color:#64748b">Amount Paid</span><span style="color:#059669;font-weight:700">LKR ${fmt(d?.amount_paid)}</span></div>
      ${remainingCredit > 0
        ? `<div class="tot-row credit"><span>This Invoice Balance</span><span>LKR ${fmt(remainingCredit)}</span></div>`
        : `<div class="tot-row fullpaid"><span>✓ Fully Paid</span><span></span></div>`}
    </div>
  </div>

  <!-- Payment Info + Customer Outstanding Balance -->
  <div class="info-row">
    <div class="info-box">
      <div class="info-box-label">Payment Method</div>
      <div class="info-box-value">${pmLabels[d?.payment_method] || d?.payment_method || '—'}</div>
      ${d?.payment_method === 'cheque' && d?.cheque_date ? `<div class="info-box-sub">Due: ${new Date(d.cheque_date).toLocaleDateString('en-GB')}</div>` : ''}
    </div>
    <div class="info-box ${custBalance > 0.01 ? 'balance-outstanding' : 'balance-clear'}">
      <div class="info-box-label">Customer Outstanding</div>
      <div class="info-box-value">${custBalance > 0.01 ? 'LKR ' + fmt(custBalance) : '✓ Clear'}</div>
      <div class="info-box-sub">${custBalance > 0.01 ? 'Total balance across all invoices' : 'No outstanding balance'}</div>
    </div>
  </div>

  <!-- Footer -->
  <div class="footer-band">
    <div class="footer-thanks">✦ Thank You for Choosing Phonefix ✦</div>
    <div class="footer-msg">
      We appreciate your trust and loyalty.<br>
      For queries, please contact us with your invoice number.
    </div>
    <div class="footer-co">Designed for Phonefix (PVT) Ltd · Powered by Techmo Solutions</div>
  </div>

  <script>window.onload=function(){window.print()}<\/script>
  </body></html>`)
    w.document.close()
  }

  // ── Item helpers ─────────────────────────────────────────
  function addEditItem(item) {
    const idx = editItems.findIndex(r => r.item_id === item.id)
    if (idx >= 0) {
      setEditItems(rows => rows.map((r, i) => i === idx ? { ...r, quantity: r.quantity + 1 } : r))
    } else {
      setEditItems(rows => [...rows, { item_id: item.id, name: item.name, quantity: 1, unit_price: parseFloat(item.selling_price) || 0, warranty: 'no', immi_no: '' }])
    }
    setItemSearch('')
    setShowItemDrop(false)
    setTimeout(() => itemRef.current?.focus(), 50)
  }

  function updateEditRow(idx, field, value) {
    setEditItems(rows => rows.map((r, i) => i === idx ? { ...r, [field]: value } : r))
  }

  async function createNewItem() {
    if (!newItem.name.trim()) return toast.error('Item name is required')
    if (!newItem.selling_price) return toast.error('Selling price is required')
    try {
      const { data: genNo } = await supabase.rpc('generate_item_no')
      const { data, error } = await supabase.from('items').insert({
        item_no: genNo, name: newItem.name,
        selling_price: parseFloat(newItem.selling_price),
        cost_price: parseFloat(newItem.cost_price) || 0,
      }).select().single()
      if (error) throw error
      setAllItems(prev => [...prev, data])
      addEditItem(data)
      setShowNewItem(false)
      setNewItem({ name: '', selling_price: '', cost_price: '' })
      toast.success('Item created!')
    } catch (e) { toast.error('Failed: ' + e.message) }
  }

  // ── Save draft edit ──────────────────────────────────────
  async function saveDraftEdit(confirmAfter = false) {
    if (editItems.length === 0) return toast.error('Add at least one item')
    if (!editSalesman) return toast.error('Select a salesman')

    // Stock check only if confirming
    if (confirmAfter) {
      for (const row of editItems) {
        const orig = lineItems.find(li => li.item_id === row.item_id)
        const extra = row.quantity - (orig?.quantity || 0)
        if (extra > 0) {
          const { data: item } = await supabase.from('items').select('stock_quantity, name').eq('id', row.item_id).single()
          if (item && (item.stock_quantity || 0) < extra) {
            toast.error(`Not enough stock for "${item.name}". Available: ${item.stock_quantity || 0}`)
            return
          }
        }
      }
    }

    setSaving(true)
    try {
      const newStatus = confirmAfter ? 'confirmed' : 'draft'

      await supabase.from('invoices').update({
        salesman_id: editSalesman.id,
        payment_method: editPaymentMethod,
        amount_paid: editPaid,
        discount_percent: editDiscPct,
        discount_amount: editDiscAmt,
        subtotal: editSubtotal,
        total: editTotal,
        credit_amount: editCredit,
        notes: editNotes,
        cheque_no: editPaymentMethod === 'cheque' ? editChequeNo : null,
        cheque_date: editPaymentMethod === 'cheque' ? editChequeDate : null,
        cheque_bank_id: editPaymentMethod === 'cheque' ? editChequeBankId : null,
        status: newStatus,
      }).eq('id', invoice.id)

      // Record cheque as pending bank transaction on confirm
      if (confirmAfter && editPaymentMethod === 'cheque' && editChequeBankId && editChequeDate) {
        await supabase.from('bank_transactions').insert({
          bank_account_id: editChequeBankId,
          type: 'cheque_in',
          amount: editPaid,
          cheque_no: editChequeNo || null,
          cheque_date: editChequeDate,
          cheque_status: 'pending',
          reference: `Invoice: ${invoice.invoice_no || details.invoice_no}`,
          notes: `Customer: ${details.customers?.name}`,
        })
      }

      // Replace line items
      await supabase.from('invoice_items').delete().eq('invoice_id', invoice.id)
      await supabase.from('invoice_items').insert(
        editItems.map(r => ({
          invoice_id: invoice.id,
          item_id: r.item_id,
          quantity: r.quantity,
          unit_price: r.unit_price,
          line_total: r.quantity * r.unit_price,
          warranty: r.warranty,
          immi_no: r.immi_no || null,
        }))
      )

      // Update customer credit atomically — only the delta (new credit minus old credit)
      const oldCredit = details.credit_amount || 0
      const creditDiff = editCredit - oldCredit
      if (creditDiff !== 0) {
        await supabase.rpc('adjust_customer_balance', { p_customer_id: details.customer_id, p_delta: creditDiff })
      }

      // Deduct stock on confirm — atomically via RPC
      if (confirmAfter) {
        for (const row of editItems) {
          await supabase.rpc('deduct_item_stock', { p_item_id: row.item_id, p_quantity: row.quantity })
        }
      }

      toast.success(confirmAfter ? 'Invoice confirmed!' : 'Draft updated!')
      setMode('view')
      fetchDetails()
      if (confirmAfter) setShowPrintOptions(true)
    } catch (e) { toast.error('Error: ' + e.message) }
    setSaving(false)
  }

  // ── Confirm existing draft (view mode) ───────────────────
  async function confirmInvoice() {
    // Check stock availability
    for (const li of lineItems) {
      if (li.is_third_party) continue
      const { data: item } = await supabase.from('items').select('stock_quantity, name').eq('id', li.item_id).single()
      if (item && (item.stock_quantity || 0) < li.quantity) {
        toast.error(`Not enough stock for "${item.name}". Available: ${item.stock_quantity || 0}, Required: ${li.quantity}`)
        return
      }
    }
    const { error } = await supabase.from('invoices').update({ status: 'confirmed', stock_deducted: true }).eq('id', invoice.id)
    if (error) return toast.error('Failed to confirm')
    if (!details?.stock_deducted) {
      for (const li of lineItems) {
        if (li.is_third_party) continue
        // 1. Atomically deduct global stock
        await supabase.rpc('deduct_item_stock', { p_item_id: li.item_id, p_quantity: li.quantity })
        // 2. Deduct from shop-specific inventory (FIFO)
        if (details?.shop_id) {
          let remaining = li.quantity
          const { data: batches } = await supabase.from('inventory')
            .select('id, quantity').eq('item_id', li.item_id).eq('shop_id', details.shop_id)
            .gt('quantity', 0).order('received_at', { ascending: true })
          for (const batch of (batches || [])) {
            if (remaining <= 0) break
            const deduct = Math.min(batch.quantity, remaining)
            await supabase.from('inventory').update({ quantity: batch.quantity - deduct }).eq('id', batch.id)
            remaining -= deduct
          }
        }
      }
    }
    toast.success('Invoice confirmed!')
    fetchDetails()
    setShowPrintOptions(true)
  }

  async function cancelInvoice() {
    if (!window.confirm(`Cancel invoice ${details.invoice_no}? This will:\n• Restore all stock\n• Remove customer balance impact\n• Reverse any bank payments received\n\nThis cannot be undone.`)) return
    try {
      // 1. Restore stock — re-add quantities to items.stock_quantity + restore shop inventory batches
      if (details.stock_deducted) {
        for (const li of lineItems) {
          if (li.is_third_party) continue
          // Restore shop inventory batches in reverse-FIFO order:
          // The confirm deducted from oldest batches first, so we restore to oldest batches first
          if (details.shop_id) {
            let remaining = li.quantity
            const { data: batches } = await supabase.from('inventory')
              .select('id, quantity').eq('item_id', li.item_id).eq('shop_id', details.shop_id)
              .order('received_at', { ascending: true }) // oldest first — same order as FIFO deduction
            for (const batch of (batches || [])) {
              if (remaining <= 0) break
              await supabase.from('inventory').update({ quantity: batch.quantity + remaining }).eq('id', batch.id)
              remaining = 0 // All restored to the first (oldest) batch
            }
            // If no batches exist (fully depleted), insert a new one to restore
            if (remaining > 0) {
              await supabase.from('inventory').insert({
                item_id: li.item_id, shop_id: details.shop_id,
                quantity: remaining, cost_price: li.unit_price || 0,
              })
            }
          }
          // Recompute global stock_quantity as sum of all inventory batches (source of truth)
          const { data: allBatches } = await supabase.from('inventory')
            .select('quantity').eq('item_id', li.item_id)
          const newTotal = (allBatches || []).reduce((s, b) => s + (b.quantity || 0), 0)
          await supabase.from('items').update({ stock_quantity: newTotal }).eq('id', li.item_id)
        }
      }

      // 2. Reverse customer balance — recompute excluding this invoice
      if (details.customer_id) {
        const { data: allInvs } = await supabase.from('invoices')
          .select('id, credit_amount, invoice_payments(amount)')
          .eq('customer_id', details.customer_id).eq('status', 'confirmed').neq('id', invoice.id)
        const { data: allRets } = await supabase.from('sales_returns')
          .select('invoice_id, total, payment_method')
          .eq('customer_id', details.customer_id).eq('status', 'confirmed')
        const returnsByInv = {}
        ;(allRets || []).filter(r => r.payment_method === 'credit' || !r.payment_method).forEach(r => {
          if (r.invoice_id) returnsByInv[r.invoice_id] = (returnsByInv[r.invoice_id] || 0) + (r.total || 0)
        })
        const newBalance = (allInvs || []).reduce((tot, inv) => {
          const paid = (inv.invoice_payments || []).reduce((s, p) => s + p.amount, 0)
          const rets = returnsByInv[inv.id] || 0
          return tot + Math.max(0, (inv.credit_amount || 0) - paid - rets)
        }, 0)
        await supabase.from('customers').update({ credit_balance: newBalance }).eq('id', details.customer_id)
      }

      // 3. Reverse bank deposits from invoice_payments on this invoice
      for (const pmt of payments) {
        if (pmt.payment_method === 'bank_transfer' && pmt.bank_account_id) {
          const { data: acc } = await supabase.from('bank_accounts').select('balance').eq('id', pmt.bank_account_id).single()
          await supabase.from('bank_accounts').update({ balance: Math.max(0, (acc?.balance || 0) - pmt.amount) }).eq('id', pmt.bank_account_id)
          await supabase.from('bank_transactions').delete()
            .eq('bank_account_id', pmt.bank_account_id)
            .ilike('reference', `Invoice Payment: ${details.invoice_no}`)
        }
      }

      // 4. Cancel the invoice
      await supabase.from('invoices').update({ status: 'cancelled' }).eq('id', invoice.id)
      toast.success(`Invoice ${details.invoice_no} cancelled.`)
      fetchDetails()
    } catch (e) { toast.error('Failed: ' + e.message) }
  }

  // ── Receive payment ──────────────────────────────────────
  async function receivePayment() {
    const amt = parseFloat(paymentForm.amount)
    if (!amt || amt <= 0) return toast.error('Enter a valid amount')
    const totalPaid = payments.reduce((s, p) => s + p.amount, 0)
    const totalRets = linkedCreditReturns.reduce((s, r) => s + (r.total || 0), 0)
    const remaining = Math.max(0, (details?.credit_amount || 0) - totalPaid - totalRets)
    if (remaining <= 0) return toast.error('This invoice is already fully paid')
    const payAmt = Math.min(amt, remaining)
    setSaving(true)
    try {
      const { data: newPayment, error: payErr } = await supabase.from('invoice_payments').insert({
        invoice_id: invoice.id, amount: payAmt,
        payment_method: paymentForm.payment_method,
        bank_account_id: paymentForm.bank_account_id || null,
        cheque_no: paymentForm.cheque_no || null,
        cheque_date: paymentForm.cheque_date || null,
        cheque_status: paymentForm.payment_method === 'cheque' ? 'pending' : null,
        notes: paymentForm.notes,
      }).select().single()
      if (payErr) throw payErr
      // Cheque payments also get a linked bank_transactions row, so Bank.jsx's
      // Cheques Due list sees it and a return from either screen can sync both.
      if (paymentForm.payment_method === 'cheque') {
        const { data: btx } = await supabase.from('bank_transactions').insert({
          bank_account_id: paymentForm.bank_account_id || null,
          type: 'cheque_in', amount: payAmt,
          cheque_no: paymentForm.cheque_no || null,
          cheque_date: paymentForm.cheque_date || null,
          cheque_status: 'pending',
          reference: `Invoice Payment: ${details.invoice_no}`,
          notes: `Customer: ${details.customers?.name}`,
          invoice_payment_id: newPayment.id,
        }).select().single()
        if (btx) await supabase.from('invoice_payments').update({ bank_transaction_id: btx.id }).eq('id', newPayment.id)
      }
      // DO NOT update credit_amount — it is immutable (the original balance)
      // Recompute customer credit_balance from scratch — opening balance + credit
      // invoices − payments − credit-method returns (cash refunds don't reduce it)
      const { data: custRow } = await supabase.from('customers').select('opening_balance').eq('id', details.customer_id).single()
      const { data: allInvs } = await supabase
        .from('invoices').select('id, credit_amount, invoice_payments(amount)')
        .eq('customer_id', details.customer_id).eq('status', 'confirmed')
      const { data: allRets } = await supabase
        .from('sales_returns').select('invoice_id, total, payment_method')
        .eq('customer_id', details.customer_id).eq('status', 'confirmed')
      const returnsByInv = {}
      ;(allRets || []).filter(r => r.payment_method === 'credit' || !r.payment_method).forEach(r => {
        if (r.invoice_id) returnsByInv[r.invoice_id] = (returnsByInv[r.invoice_id] || 0) + (r.total || 0)
      })
      const newBalance = (allInvs || []).reduce((total, inv) => {
        const paid = (inv.invoice_payments || []).reduce((s, p) => s + p.amount, 0)
        const rets = returnsByInv[inv.id] || 0
        return total + Math.max(0, (inv.credit_amount || 0) - paid - rets)
      }, custRow?.opening_balance || 0)
      await supabase.from('customers').update({ credit_balance: newBalance }).eq('id', details.customer_id)

      // Update bank/cash
      if (paymentForm.payment_method === 'bank_transfer' && paymentForm.bank_account_id) {
        const bank = bankAccounts.find(b => b.id === paymentForm.bank_account_id)
        await supabase.from('bank_accounts').update({ balance: (bank?.balance || 0) + payAmt }).eq('id', paymentForm.bank_account_id)
        await supabase.from('bank_transactions').insert({ bank_account_id: paymentForm.bank_account_id, type: 'deposit', amount: payAmt, reference: `Invoice Payment: ${details.invoice_no}`, notes: `Customer: ${details.customers?.name}` })
      }
      // Cash payment: tracked via invoice_payments (method=cash) — Cashflow reads that for "Cash Received from Customers"
      // No cash_deposits insert needed — that table is only for actual cash→bank deposits

      if (payAmt < amt) toast.success(`Payment of ${formatCurrency(payAmt)} received (capped at remaining balance)`)
      else toast.success('Payment received!')
      setShowPaymentForm(false)
      setPaymentForm({ amount: '', payment_method: 'cash', bank_account_id: '', cheque_no: '', cheque_date: '', notes: '' })
      // Send SMS to customer
      if (details.customers?.phone) {
        const msg = smsTemplates.customerPaymentCollected(
          details.customers.name, payAmt, Math.max(0, newBalance),
          details.shops?.name || 'Phonefix'
        )
        sendSMS({ to: details.customers.phone, message: msg, triggeredBy: 'invoice_payment', referenceType: 'invoice', referenceId: invoice.id })
          .then(({ success }) => { if (success) toast.success('SMS sent to customer') })
      }
      fetchDetails()
    } catch (e) { toast.error('Error: ' + e.message) }
    setSaving(false)
  }

  // ── Return / bounce a cheque payment on this invoice ──────────────
  async function returnInvoiceCheque(payment) {
    if (!window.confirm(`Mark this cheque as returned/bounced?\n\nAmount: ${formatCurrency(payment.amount)}\nCheque #: ${payment.cheque_no || '—'}\n\nThis will reverse the payment and add the amount back to the customer's outstanding balance.`)) return
    setSaving(true)
    try {
      // A single cheque can be split across multiple invoices via FIFO — each
      // portion is its own invoice_payments row, but all share the same
      // bank_transaction_id. Marking only the one row passed in here (this
      // invoice's portion) would leave sibling rows on other invoices stuck as
      // still-pending even though the same physical cheque bounced for all of
      // them. Find and mark every row sharing that link, not just this one.
      let linkedPaymentIds = [payment.id]
      if (payment.bank_transaction_id) {
        const { data: siblingPayments } = await supabase
          .from('invoice_payments').select('id').eq('bank_transaction_id', payment.bank_transaction_id)
        if (siblingPayments?.length) linkedPaymentIds = siblingPayments.map(p => p.id)
      }
      await supabase.from('invoice_payments').update({
        cheque_status: 'returned',
        returned_at: new Date().toISOString(),
        notes: ((payment.notes || '') + ' [RETURNED]').trim(),
      }).in('id', linkedPaymentIds)

      // Keep the linked bank_transactions row (if one exists) in sync — this is
      // what makes the cheque show as returned in Bank.jsx too, not just here.
      const linkedBtxId = payment.bank_transaction_id
      if (linkedBtxId) {
        const { data: btx } = await supabase.from('bank_transactions').select('notes').eq('id', linkedBtxId).single()
        await supabase.from('bank_transactions').update({
          cheque_status: 'presented',
          notes: ((btx?.notes || '') + ' [RETURNED]').trim(),
        }).eq('id', linkedBtxId)
      }

      // Recompute customer credit_balance from scratch, using the same full-ledger
      // model as Customers.jsx's computeCustomerBalance: every invoice's full total
      // is a debit (not just credit_amount, which excludes cash portions), every
      // non-returned payment is a credit, and a linked bank_transactions row's
      // overpayment remainder is handled the same way. This replaces the previous
      // credit_amount-based recompute here, which had drifted out of sync with the
      // model fixed everywhere else in the app.
      const { data: custRow } = await supabase.from('customers').select('opening_balance').eq('id', details.customer_id).single()
      const { data: allInvs } = await supabase
        .from('invoices').select('id, total, amount_paid, invoice_payments(amount, cheque_status, bank_transaction_id)')
        .eq('customer_id', details.customer_id).eq('status', 'confirmed')
      const { data: allRets } = await supabase
        .from('sales_returns').select('invoice_id, total, payment_method')
        .eq('customer_id', details.customer_id).eq('status', 'confirmed')
      const { data: allBankTx } = await supabase
        .from('bank_transactions').select('id, amount, notes, invoice_payment_id')
        .ilike('reference', `%${details.customers?.name || ''}%`).in('type', ['deposit', 'cheque_in'])
      const returnsByInv2 = {}
      ;(allRets || []).filter(r => r.payment_method === 'credit' || !r.payment_method).forEach(r => {
        if (r.invoice_id) returnsByInv2[r.invoice_id] = (returnsByInv2[r.invoice_id] || 0) + (r.total || 0)
      })
      let newBalance = custRow?.opening_balance || 0
      ;(allInvs || []).forEach(inv => {
        newBalance += inv.total || 0
        if ((inv.amount_paid || 0) > 0) newBalance -= inv.amount_paid
        ;(inv.invoice_payments || []).forEach(p => {
          if (p.cheque_status !== 'returned') newBalance -= p.amount
        })
        newBalance -= (returnsByInv2[inv.id] || 0)
      })
      ;(allBankTx || []).forEach(tx => {
        const isOpeningPayment = !tx.invoice_payment_id
        if (isOpeningPayment) {
          if (!(tx.notes && tx.notes.includes('[RETURNED]')) && tx.notes && tx.notes.includes('Opening balance')) {
            newBalance -= tx.amount
          }
        } else if (!(tx.notes && tx.notes.includes('[RETURNED]'))) {
          const linkedTotal = (allInvs || []).reduce((s, inv) =>
            s + (inv.invoice_payments || []).filter(p => p.bank_transaction_id === tx.id).reduce((s2, p) => s2 + p.amount, 0), 0)
          const remainder = tx.amount - linkedTotal
          if (remainder > 0.009) newBalance -= remainder
        }
      })
      await supabase.from('customers').update({ credit_balance: newBalance }).eq('id', details.customer_id)

      toast.success(`Cheque returned — ${formatCurrency(payment.amount)} added back to customer balance`)
      fetchDetails()
    } catch (e) { toast.error('Failed: ' + e.message) }
    setSaving(false)
  }

  // ── Print helpers ────────────────────────────────────────
  function printReceipt() {
    // Guard against printing before this invoice's data has finished loading —
    // total/amount_paid would show as 0.00 if we proceed with stale/empty state.
    if (!details || details.id !== invoice.id || loading) {
      toast.error('Invoice still loading — please try again in a moment')
      return
    }
    const w = window.open('', '_blank')
    const d = details
    const fmt2 = n => parseFloat(n||0).toLocaleString('en-LK',{minimumFractionDigits:2})
    const dateStr2 = new Date(d?.created_at||Date.now()).toLocaleDateString('en-GB',{day:'2-digit',month:'2-digit',year:'numeric'})
    const timeStr2 = new Date(d?.created_at||Date.now()).toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit',second:'2-digit'})
    const shopName2 = 'PHONEFIX (PVT) LTD'
    w.document.write(`<!DOCTYPE html><html><head><title>Receipt ${d?.invoice_no}</title>
    <style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:'Arial',sans-serif;font-size:13px;font-weight:bold;width:75mm;margin:0 auto;padding:4px}.c{text-align:center}.b{font-weight:bold}.dashed{border-top:1px dashed #000;margin:4px 0}.solid{border-top:2px solid #000;margin:4px 0}.row{display:flex;justify-content:space-between;padding:1px 0;font-size:13px;font-weight:bold}.tot{display:flex;justify-content:space-between;font-weight:bold;font-size:16px;padding:3px 0}.bal{display:flex;justify-content:space-between;font-weight:bold;font-size:14px;padding:2px 0}@media print{@page{size:75mm auto;margin:1mm}}</style></head><body>
    <div class="c b" style="font-size:18px;font-weight:bold;letter-spacing:1px">${shopName2}</div>
    ${d?.shops?.address?`<div class="c" style="font-size:10px">${d.shops.address.toUpperCase()}</div>`:''}
    ${d?.shops?.phone?`<div class="c" style="font-size:10px">${d.shops.phone}</div>`:''}
    <div class="dashed"></div>
    <div class="row"><span>CASHIER &nbsp;: ${d?.salesmen?.name||'—'}</span><span>SALESMAN : ${d?.salesmen?.name||'—'}</span></div>
    <div class="row"><span>UNIT &nbsp;&nbsp;&nbsp;&nbsp;: ${d?.shops?.name||'—'}</span><span>INVOICE  : ${d?.invoice_no}</span></div>
    <div class="row"><span>CUSTOMER : ${(d?.customers?.name||'Cash Customer').toUpperCase()}</span></div>
    <div class="dashed"></div>
    <div class="row b" style="font-size:12px;font-weight:bold"><span>No. Product</span><span style="display:flex;gap:16px"><span>Rate</span><span>Qty</span><span>Amount</span></span></div>
    <div class="dashed"></div>
    ${lineItems.map((li,idx)=>`<div style="font-size:12px;font-weight:bold;padding:1px 0">${idx+1}. ${li.items?.name||li.name||''}${(li.warranty&&li.warranty!=='no')?` [W:${li.warranty}]`:''}</div><div style="display:flex;justify-content:space-between;font-size:12px;font-weight:bold;padding:0 0 3px 10px"><span>${li.immi_no||''}&nbsp;&nbsp;${fmt2(li.unit_price)} *${li.quantity}</span><span>${fmt2(li.line_total)}</span></div>`).join('')}
    <div class="dashed"></div>
    <div class="row"><span>GROSS TOTAL :</span><span>${fmt2(d?.total)}</span></div>
    <div class="solid"></div>
    <div class="tot"><span>TOTAL :</span><span>${fmt2(d?.total)}</span></div>
    <div class="solid"></div>
    ${(remainingCredit||0)>0?`<div class="bal"><span>CREDIT :</span><span>${fmt2(remainingCredit)}</span></div>`:`<div class="row"><span>PAID :</span><span>${fmt2(d?.amount_paid)}</span></div>`}
    <div class="dashed"></div>
    <div style="display:flex;justify-content:space-between;font-size:10px">
      <span>Items : ${lineItems?.length||0} &nbsp; Pcs : ${lineItems.reduce((s,l)=>s+(l.quantity||0),0)}</span>
    </div>
    <div style="display:flex;justify-content:space-between;font-size:10px">
      <span>Date : ${dateStr2}</span><span>Time : ${timeStr2}</span>
    </div>
    ${(remainingCredit||0)>0?`<div class="solid"></div><div class="c b" style="font-size:12px">CURRENT BALANCE : ${fmt2(d?.customers?.credit_balance||0)}</div>`:''}
    <div class="solid"></div>
    <div class="c b" style="font-size:13px;font-weight:bold;margin:3px 0">★ Thank You! Visit Again ★</div>
    <div class="c" style="font-size:11px;font-weight:bold">Your trust is our greatest reward.</div>
    <div class="c" style="font-size:11px;font-weight:bold;margin-top:2px">Designed for Phonefix (PVT) Ltd · Powered by Techmo Solutions</div>
    <script>window.onload=function(){window.print()}<\/script></body></html>`)
    w.document.close()
  }


  if (loading) return <div style={{ padding: '60px', textAlign: 'center', color: '#94a3b8' }}>Loading...</div>
  if (!details) return <div style={{ padding: '60px', textAlign: 'center', color: '#94a3b8' }}>Invoice not found</div>

  const sc = { draft: { bg: '#fef3c7', color: '#92400e' }, confirmed: { bg: '#dcfce7', color: '#166534' }, cancelled: { bg: '#fee2e2', color: '#991b1b' } }[details.status] || { bg: '#fef3c7', color: '#92400e' }
  const totalReceived = payments.reduce((s, p) => s + p.amount, 0)
  const totalCreditReturns = linkedCreditReturns.reduce((s, r) => s + (r.total || 0), 0)
  const remainingCredit = Math.max(0, (details.credit_amount || 0) - totalReceived - totalCreditReturns)

  const inp = { width: '100%', padding: '9px 12px', border: '1.5px solid #e2e8f0', borderRadius: '7px', fontSize: '14px', boxSizing: 'border-box', outline: 'none', background: 'white', color: '#0f172a' }
  const lbl = { display: 'block', marginBottom: '5px', fontSize: '11px', fontWeight: '700', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.06em' }
  const card = { background: 'white', borderRadius: '12px', padding: '24px', boxShadow: '0 1px 3px rgba(15,23,42,0.06), 0 1px 2px rgba(15,23,42,0.04)', marginBottom: '16px', border: '1px solid #f1f5f9' }
  const drop = { position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0, background: 'white', border: '1.5px solid #e2e8f0', borderRadius: '10px', boxShadow: '0 8px 24px rgba(0,0,0,0.12)', zIndex: 200, maxHeight: '220px', overflowY: 'auto' }
  const dropItem = { padding: '10px 14px', cursor: 'pointer', fontSize: '14px', borderBottom: '1px solid #f8fafc', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }
  const filteredItems = allItems.filter(i => i.name.toLowerCase().includes(itemSearch.toLowerCase()) || i.item_no?.toLowerCase().includes(itemSearch.toLowerCase()))

  return (
    <div style={{ maxWidth: '1100px' }}>
      <style>{`@media print { .no-print { display: none !important; } @page { size: A5; margin: 10mm; } }`}</style>

      {/* Print options modal */}
      {showPrintOptions && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ background: 'white', borderRadius: '16px', padding: '32px', width: '400px', textAlign: 'center' }}>
            <div style={{ fontSize: '40px', marginBottom: '12px' }}>✅</div>
            <h2 style={{ fontSize: '18px', fontWeight: '700', color: '#0f172a', margin: '0 0 4px' }}>Invoice Confirmed!</h2>
            <p style={{ color: '#2563eb', fontWeight: '700', margin: '0 0 20px' }}>{details.invoice_no}</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <button onClick={() => { printReceipt(); setShowPrintOptions(false) }}
                style={{ padding: '12px', background: '#0f172a', color: 'white', border: 'none', borderRadius: '10px', cursor: 'pointer', fontWeight: '700', fontSize: '14px' }}>
                🖨 Print Receipt (POS)
              </button>
              <button onClick={() => { printA5Invoice(); setShowPrintOptions(false) }}
                style={{ padding: '12px', background: 'linear-gradient(135deg,#2563eb,#1d4ed8)', color: 'white', border: 'none', borderRadius: '10px', cursor: 'pointer', fontWeight: '700', fontSize: '14px' }}>
                📄 Print Invoice (A5)
              </button>
              <button onClick={() => setShowPrintOptions(false)}
                style={{ padding: '12px', background: '#f1f5f9', color: '#475569', border: 'none', borderRadius: '10px', cursor: 'pointer', fontWeight: '600', fontSize: '14px' }}>
                No Print Required
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── EDIT MODE ─────────────────────────────────────── */}
      {mode === 'edit' && (
        <div>
          {/* Header */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '24px' }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '6px' }}>
                <button onClick={() => setMode('view')}
                  style={{ background: 'none', border: 'none', color: '#2563eb', cursor: 'pointer', fontSize: '14px', fontWeight: '600', padding: 0 }}>
                  ← Back to Invoice
                </button>
              </div>
              <h1 style={{ fontSize: '22px', fontWeight: '700', color: '#0f172a', margin: '0 0 4px' }}>Edit Draft Invoice</h1>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <span style={{ fontSize: '13px', fontWeight: '700', color: '#2563eb', background: '#eef2ff', padding: '3px 10px', borderRadius: '20px' }}>{details.invoice_no}</span>
                <span style={{ fontSize: '13px', color: '#94a3b8' }}>{new Date(details.created_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}</span>
              </div>
            </div>
            <div style={{ display: 'flex', gap: '10px' }}>
              <button onClick={() => setMode('view')} style={{ padding: '10px 18px', background: 'white', color: '#64748b', border: '1.5px solid #e2e8f0', borderRadius: '10px', cursor: 'pointer', fontWeight: '600', fontSize: '14px' }}>Cancel</button>
              <button onClick={() => saveDraftEdit(false)} disabled={saving}
                style={{ padding: '10px 20px', background: 'white', color: '#475569', border: '1.5px solid #e2e8f0', borderRadius: '10px', cursor: 'pointer', fontWeight: '600', fontSize: '14px' }}>
                💾 Save Draft
              </button>
              <button onClick={() => saveDraftEdit(true)} disabled={saving}
                style={{ padding: '10px 24px', background: saving ? '#93c5fd' : 'linear-gradient(135deg,#2563eb,#1d4ed8)', color: 'white', border: 'none', borderRadius: '10px', cursor: 'pointer', fontWeight: '700', fontSize: '14px' }}>
                {saving ? 'Saving...' : '✓ Confirm Invoice'}
              </button>
            </div>
          </div>

          {/* Customer info (read-only) */}
          <div style={{ ...card, background: '#f0fdf4', border: '1px solid #bbf7d0' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <span style={{ fontSize: '11px', fontWeight: '700', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Customer</span>
                <div style={{ fontSize: '16px', fontWeight: '700', color: '#0f172a', marginTop: '4px' }}>
                  {details.customers?.name}
                  <span style={{ fontSize: '13px', color: '#2563eb', fontWeight: '600', marginLeft: '10px' }}>{details.customers?.customer_no}</span>
                </div>
                {details.customers?.phone && <div style={{ fontSize: '13px', color: '#64748b' }}>{details.customers.phone}</div>}
              </div>
              {details.customers?.credit_balance > 0 && (
                <div style={{ textAlign: 'right', padding: '10px 14px', background: '#fff1f2', borderRadius: '10px', border: '1px solid #fecdd3' }}>
                  <div style={{ fontSize: '11px', color: '#e11d48', fontWeight: '700', textTransform: 'uppercase' }}>Outstanding</div>
                  <div style={{ fontSize: '18px', fontWeight: '800', color: '#e11d48' }}>{formatCurrency(details.customers.credit_balance)}</div>
                </div>
              )}
            </div>
          </div>

          {/* Shop + Salesman */}
          <div style={{ ...card, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
            <div>
              <label style={lbl}>Shop</label>
              <div style={{ padding: '10px 12px', background: '#f8fafc', borderRadius: '7px', border: '1.5px solid #e2e8f0', fontSize: '14px', color: '#64748b' }}>
                {details.shops?.name || '—'}
              </div>
            </div>
            <div>
              <label style={lbl}>Salesman *</label>
              <select value={editSalesman?.id || ''} onChange={e => setEditSalesman(allSalesmen.find(s => s.id === e.target.value) || null)}
                style={{ ...inp, color: editSalesman ? '#0f172a' : '#94a3b8', borderColor: editSalesman ? '#2563eb' : '#e2e8f0' }}>
                <option value="">— Select salesman —</option>
                {allSalesmen.map(s => <option key={s.id} value={s.id}>{s.salesman_no} · {s.name}</option>)}
              </select>
              {editSalesman && <div style={{ fontSize: '11px', color: '#2563eb', marginTop: '3px', fontWeight: '600' }}>✓ Auto-selected from your profile</div>}
            </div>
          </div>

          {/* Items */}
          <div style={card}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <h2 style={{ margin: 0, fontSize: '15px', fontWeight: '700', color: '#0f172a' }}>Items</h2>
              <span style={{ fontSize: '13px', color: '#94a3b8' }}>{editItems.length} item{editItems.length !== 1 ? 's' : ''}</span>
            </div>

            {/* Item search */}
            <div style={{ position: 'relative', marginBottom: '16px' }}>
              <input ref={itemRef} type="text" placeholder="Search and add items…" value={itemSearch}
                onChange={e => { setItemSearch(e.target.value); setShowItemDrop(true) }}
                onFocus={() => setShowItemDrop(true)}
                onBlur={() => setTimeout(() => setShowItemDrop(false), 180)}
                style={{ ...inp, background: '#f8fafc' }} />
              {showItemDrop && (
                <div style={drop}>
                  {filteredItems.length === 0 && itemSearch && <div style={{ ...dropItem, color: '#94a3b8', justifyContent: 'center' }}>No items found</div>}
                  {filteredItems.map(item => (
                    <div key={item.id} onMouseDown={() => addEditItem(item)}
                      style={dropItem} onMouseEnter={e => e.currentTarget.style.background = '#f8fafc'} onMouseLeave={e => e.currentTarget.style.background = 'white'}>
                      <span><span style={{ fontWeight: '700', color: '#2563eb', marginRight: '8px', fontSize: '12px' }}>{item.item_no}</span>{item.name}
                        <span style={{ marginLeft: '8px', fontSize: '12px', color: '#94a3b8' }}>Stock: {item.stock_quantity || 0}</span>
                      </span>
                      <span style={{ fontWeight: '700', color: '#059669', fontSize: '13px' }}>{formatCurrency(item.selling_price)}</span>
                    </div>
                  ))}
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
                  <div><label style={{ ...lbl, fontSize: '10px' }}>Name *</label><input type="text" value={newItem.name} onChange={e => setNewItem(p => ({ ...p, name: e.target.value }))} placeholder="Item name" style={inp} /></div>
                  <div><label style={{ ...lbl, fontSize: '10px' }}>Selling Price *</label><input type="number" value={newItem.selling_price} onChange={e => setNewItem(p => ({ ...p, selling_price: e.target.value }))} placeholder="0.00" style={inp} /></div>
                  <div><label style={{ ...lbl, fontSize: '10px' }}>Cost Price</label><input type="number" value={newItem.cost_price} onChange={e => setNewItem(p => ({ ...p, cost_price: e.target.value }))} placeholder="0.00" style={inp} /></div>
                </div>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <button onClick={createNewItem} style={{ padding: '7px 16px', background: '#2563eb', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '13px', fontWeight: '600' }}>Create & Add</button>
                  <button onClick={() => setShowNewItem(false)} style={{ padding: '7px 14px', background: '#f1f5f9', color: '#64748b', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '13px' }}>Cancel</button>
                </div>
              </div>
            )}

            {editItems.length > 0 ? (
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ background: '#f8fafc', borderBottom: '2px solid #e2e8f0' }}>
                    {['#', 'Item Name', 'Qty', 'Unit Price (LKR)', 'Warranty', 'Immi No', 'Line Total', ''].map((h, i) => (
                      <th key={i} style={{ padding: '10px 12px', textAlign: 'left', fontSize: '11px', fontWeight: '700', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {editItems.map((row, idx) => (
                    <tr key={idx} style={{ borderBottom: '1px solid #f1f5f9' }}>
                      <td style={{ padding: '10px 12px', fontSize: '12px', color: '#94a3b8', fontWeight: '700' }}>{idx + 1}</td>
                      <td style={{ padding: '10px 12px', fontSize: '14px', fontWeight: '600', color: '#0f172a' }}>{row.name}</td>
                      <td style={{ padding: '10px 12px' }}>
                        <input type="number" value={row.quantity} min="0.01" step="0.01"
                          onChange={e => updateEditRow(idx, 'quantity', parseFloat(e.target.value) || 1)}
                          onFocus={e => e.target.select()}
                          style={{ ...inp, width: '80px', textAlign: 'center', fontWeight: '700' }} />
                      </td>
                      <td style={{ padding: '10px 12px' }}>
                        <input type="number" value={row.unit_price} min="0" step="0.01"
                          onChange={e => updateEditRow(idx, 'unit_price', parseFloat(e.target.value) || 0)}
                          onFocus={e => e.target.select()}
                          style={{ ...inp, width: '130px', textAlign: 'right', fontWeight: '600' }} />
                      </td>
                      <td style={{ padding: '10px 12px' }}>
                        <select value={row.warranty} onChange={e => updateEditRow(idx, 'warranty', e.target.value)} style={{ ...inp, width: '100px', fontSize: '13px' }}>
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
                      <td style={{ padding: '10px 12px' }}>
                        <input type="text" value={row.immi_no || ''}
                          onChange={e => updateEditRow(idx, 'immi_no', e.target.value)}
                          placeholder="Immi no…"
                          style={{ ...inp, width: '110px', fontSize: '12px' }} />
                      </td>
                      <td style={{ padding: '10px 12px', fontSize: '15px', fontWeight: '700', color: '#059669' }}>{formatCurrency(row.quantity * row.unit_price)}</td>
                      <td style={{ padding: '10px 12px' }}>
                        <button onClick={() => setEditItems(rows => rows.filter((_, i) => i !== idx))}
                          style={{ width: '28px', height: '28px', background: '#fee2e2', color: '#dc2626', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '14px' }}>✕</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <div style={{ padding: '32px', textAlign: 'center', color: '#cbd5e1', border: '2px dashed #e2e8f0', borderRadius: '10px' }}>
                <div style={{ fontSize: '28px', marginBottom: '8px' }}>📦</div>
                Search above to add items
              </div>
            )}
          </div>

          {/* Payment + Summary */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
            <div style={card}>
              <h2 style={{ margin: '0 0 16px', fontSize: '15px', fontWeight: '700', color: '#0f172a' }}>Payment Details</h2>
              <div style={{ marginBottom: '14px' }}>
                <label style={lbl}>Payment Method</label>
                <select value={editPaymentMethod} onChange={e => { setEditPaymentMethod(e.target.value); setEditAmountPaid('') }} style={inp}>
                  <option value="cash">Cash</option>
                  <option value="card">Card</option>
                  <option value="cheque">Cheque</option>
                  <option value="bank_transfer">Bank Transfer</option>
                  <option value="partial">Partial Payment</option>
                  <option value="credit">Credit (No Payment Now)</option>
                </select>
              </div>
              {!editIsCredit && (
                <div style={{ marginBottom: '14px' }}>
                  <label style={lbl}>Amount Paid (LKR)</label>
                  <input type="number" value={editAmountPaid} min="0" onChange={e => setEditAmountPaid(e.target.value)} placeholder="0.00" style={{ ...inp, fontSize: '16px', fontWeight: '600' }} />
                </div>
              )}
              {editPaymentMethod === 'cheque' && (
                <>
                  <div style={{ marginBottom: '14px' }}>
                    <label style={lbl}>Bank Account *</label>
                    <select value={editChequeBankId} onChange={e => setEditChequeBankId(e.target.value)} style={{ ...inp, borderColor: !editChequeBankId ? '#fca5a5' : '#e2e8f0' }}>
                      <option value="">Select bank account</option>
                      {bankAccounts.map(b => <option key={b.id} value={b.id}>{b.name} — {b.bank_name}</option>)}
                    </select>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '14px' }}>
                    <div>
                      <label style={lbl}>Cheque No</label>
                      <input type="text" value={editChequeNo} onChange={e => setEditChequeNo(e.target.value)} placeholder="Cheque number" style={inp} />
                    </div>
                    <div>
                      <label style={lbl}>Cheque Date *</label>
                      <input type="date" value={editChequeDate} onChange={e => setEditChequeDate(e.target.value)} style={{ ...inp, borderColor: !editChequeDate ? '#fca5a5' : '#e2e8f0' }} />
                    </div>
                  </div>
                  {editChequeDate && (
                    <div style={{ padding: '10px 12px', background: '#fef3c7', borderRadius: '10px', border: '1px solid #fde68a', marginBottom: '14px', fontSize: '13px', color: '#92400e' }}>
                      💡 Cheque will appear in Bank → Cheques Due on {new Date(editChequeDate).toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' })}
                    </div>
                  )}
                </>
              )}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '14px' }}>
                <div>
                  <label style={lbl}>Discount %</label>
                  <input type="number" value={editDiscountPercent} min="0" max="100"
                    onChange={e => { setEditDiscountPercent(e.target.value); setEditDiscountAmount('') }}
                    placeholder="0" style={inp} />
                </div>
                <div>
                  <label style={lbl}>Discount (LKR)</label>
                  <input type="number" value={editDiscountAmount} min="0"
                    onChange={e => { setEditDiscountAmount(e.target.value); setEditDiscountPercent('') }}
                    placeholder="0.00" style={inp} />
                </div>
              </div>
              <div>
                <label style={lbl}>Notes</label>
                <textarea value={editNotes} onChange={e => setEditNotes(e.target.value)} placeholder="Any notes…" rows={3} style={{ ...inp, resize: 'vertical', lineHeight: '1.5' }} />
              </div>
            </div>

            <div style={card}>
              <h2 style={{ margin: '0 0 16px', fontSize: '15px', fontWeight: '700', color: '#0f172a' }}>Summary</h2>
              {[
                { label: 'Subtotal', val: formatCurrency(editSubtotal) },
                { label: editDiscountPercent ? `Discount (${editDiscountPercent}%)` : 'Discount', val: editDiscAmt > 0 ? `− ${formatCurrency(editDiscAmt)}` : '—', red: editDiscAmt > 0 },
              ].map(r => (
                <div key={r.label} style={{ display: 'flex', justifyContent: 'space-between', padding: '9px 0', borderBottom: '1px solid #f1f5f9' }}>
                  <span style={{ fontSize: '14px', color: '#64748b' }}>{r.label}</span>
                  <span style={{ fontSize: '14px', fontWeight: '500', color: r.red ? '#e11d48' : '#0f172a' }}>{r.val}</span>
                </div>
              ))}
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '14px 16px', background: '#0f172a', borderRadius: '10px', margin: '8px 0' }}>
                <span style={{ fontSize: '16px', color: '#94a3b8', fontWeight: '600' }}>Total</span>
                <span style={{ fontSize: '22px', color: 'white', fontWeight: '800' }}>{formatCurrency(editTotal)}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', padding: '9px 0', borderBottom: '1px solid #f1f5f9', marginBottom: '12px' }}>
                <span style={{ fontSize: '14px', color: '#64748b' }}>Amount Paid</span>
                <span style={{ fontSize: '15px', color: '#059669', fontWeight: '700' }}>{formatCurrency(editPaid)}</span>
              </div>
              {editCredit > 0 && (
                <div style={{ padding: '12px 14px', background: '#fff1f2', borderRadius: '10px', border: '1.5px solid #fecdd3', marginBottom: '16px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                      <div style={{ fontSize: '13px', fontWeight: '700', color: '#e11d48' }}>Credit Balance</div>
                      <div style={{ fontSize: '12px', color: '#fb7185', marginTop: '2px' }}>Will be added to customer outstanding</div>
                    </div>
                    <div style={{ fontSize: '20px', fontWeight: '800', color: '#e11d48' }}>{formatCurrency(editCredit)}</div>
                  </div>
                </div>
              )}
              <div style={{ display: 'flex', gap: '10px', marginTop: '8px' }}>
                <button onClick={() => saveDraftEdit(false)} disabled={saving}
                  style={{ flex: 1, padding: '12px', background: 'white', color: '#475569', border: '1.5px solid #e2e8f0', borderRadius: '10px', cursor: 'pointer', fontWeight: '600', fontSize: '14px' }}>
                  💾 Save Draft
                </button>
                <button onClick={() => saveDraftEdit(true)} disabled={saving}
                  style={{ flex: 2, padding: '12px', background: saving ? '#93c5fd' : 'linear-gradient(135deg,#2563eb,#1d4ed8)', color: 'white', border: 'none', borderRadius: '10px', cursor: 'pointer', fontWeight: '700', fontSize: '15px' }}>
                  {saving ? 'Saving...' : '✓ Confirm Invoice'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── VIEW MODE ─────────────────────────────────────── */}
      {mode === 'view' && (
        <div>
          {/* Header */}
          <div className="no-print" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
            <button onClick={onBack} style={{ padding: '9px 16px', background: 'white', color: '#475569', border: '1.5px solid #e2e8f0', borderRadius: '10px', cursor: 'pointer', fontSize: '14px', fontWeight: '600' }}>← Back</button>
            <div style={{ display: 'flex', gap: '10px' }}>
              {details.status === 'draft' && (
                <>
                  <button onClick={enterEditMode}
                    style={{ padding: '9px 18px', background: '#fef3c7', color: '#92400e', border: '1.5px solid #fde68a', borderRadius: '10px', cursor: 'pointer', fontWeight: '700', fontSize: '14px' }}>
                    ✏️ Edit Draft
                  </button>
                  <button onClick={confirmInvoice}
                    style={{ padding: '9px 20px', background: 'linear-gradient(135deg,#2563eb,#1d4ed8)', color: 'white', border: 'none', borderRadius: '10px', cursor: 'pointer', fontWeight: '700', fontSize: '14px' }}>
                    ✓ Confirm Invoice
                  </button>
                </>
              )}
              {details.status === 'confirmed' && remainingCredit > 0 && (
                <button onClick={() => setShowPaymentForm(!showPaymentForm)}
                  style={{ padding: '9px 18px', background: '#059669', color: 'white', border: 'none', borderRadius: '10px', cursor: 'pointer', fontWeight: '700', fontSize: '14px' }}>
                  💰 Receive Payment
                </button>
              )}
              {details.status === 'confirmed' && (
                <>
                  <button onClick={() => printA5Invoice()}
                    style={{ padding: '9px 18px', background: 'linear-gradient(135deg,#2563eb,#1d4ed8)', color: 'white', border: 'none', borderRadius: '10px', cursor: 'pointer', fontWeight: '600', fontSize: '14px' }}>
                    📄 A5 Invoice
                  </button>
                  <button onClick={() => printReceipt()}
                    style={{ padding: '9px 18px', background: 'white', color: '#475569', border: '1.5px solid #e2e8f0', borderRadius: '10px', cursor: 'pointer', fontWeight: '600', fontSize: '14px' }}>
                    🖨 POS Receipt
                  </button>
                  <button onClick={cancelInvoice}
                    style={{ padding: '9px 18px', background: '#fef3c7', color: '#92400e', border: '1.5px solid #fde68a', borderRadius: '10px', cursor: 'pointer', fontWeight: '700', fontSize: '14px' }}>
                    ✕ Cancel Invoice
                  </button>
                </>
              )}
              {details.status === 'draft' && (
                <button onClick={async () => {
                  if (!window.confirm('Delete this draft invoice?')) return
                  await supabase.from('invoice_items').delete().eq('invoice_id', invoice.id)
                  await supabase.from('invoices').delete().eq('id', invoice.id)
                  toast.success('Draft deleted')
                  onBack()
                }}
                  style={{ padding: '9px 18px', background: '#fee2e2', color: '#dc2626', border: '1.5px solid #fecaca', borderRadius: '10px', cursor: 'pointer', fontWeight: '700', fontSize: '14px' }}>
                  🗑 Delete Draft
                </button>
              )}
            </div>
          </div>

          {/* Receive payment form */}
          {showPaymentForm && (
            <div className="no-print" style={{ background: '#f0fdf4', border: '1.5px solid #bbf7d0', borderRadius: '12px', padding: '20px', marginBottom: '20px' }}>
              <h3 style={{ margin: '0 0 14px', fontSize: '15px', fontWeight: '700', color: '#166534' }}>💰 Receive Payment — Remaining: {formatCurrency(remainingCredit)}</h3>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '14px', marginBottom: '14px' }}>
                <div><label style={lbl}>Amount (LKR) *</label><input type="number" value={paymentForm.amount} onChange={e => setPaymentForm(p => ({ ...p, amount: e.target.value }))} placeholder={remainingCredit.toFixed(2)} style={{ ...inp, fontWeight: '700', fontSize: '16px' }} /></div>
                <div><label style={lbl}>Payment Method</label>
                  <select value={paymentForm.payment_method} onChange={e => setPaymentForm(p => ({ ...p, payment_method: e.target.value }))} style={inp}>
                    <option value="cash">Cash</option>
                    <option value="card">Card</option>
                    <option value="cheque">Cheque</option>
                    <option value="bank_transfer">Bank Transfer</option>
                  </select>
                </div>
                {paymentForm.payment_method === 'bank_transfer' && (
                  <div><label style={lbl}>Bank Account</label>
                    <select value={paymentForm.bank_account_id} onChange={e => setPaymentForm(p => ({ ...p, bank_account_id: e.target.value }))} style={inp}>
                      <option value="">Select</option>
                      {bankAccounts.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                    </select>
                  </div>
                )}
                {paymentForm.payment_method === 'cheque' && (
                  <>
                    <div><label style={lbl}>Cheque No</label><input type="text" value={paymentForm.cheque_no} onChange={e => setPaymentForm(p => ({ ...p, cheque_no: e.target.value }))} placeholder="Cheque number" style={inp} /></div>
                    <div><label style={lbl}>Cheque Date</label><input type="date" value={paymentForm.cheque_date} onChange={e => setPaymentForm(p => ({ ...p, cheque_date: e.target.value }))} style={inp} /></div>
                  </>
                )}
                <div><label style={lbl}>Notes</label><input type="text" value={paymentForm.notes} onChange={e => setPaymentForm(p => ({ ...p, notes: e.target.value }))} placeholder="Optional" style={inp} /></div>
              </div>
              <div style={{ display: 'flex', gap: '10px' }}>
                <button onClick={receivePayment} disabled={saving}
                  style={{ padding: '10px 24px', background: '#059669', color: 'white', border: 'none', borderRadius: '10px', cursor: 'pointer', fontWeight: '700', fontSize: '14px' }}>
                  {saving ? 'Processing...' : '✓ Confirm Payment'}
                </button>
                <button onClick={() => setShowPaymentForm(false)}
                  style={{ padding: '10px 18px', background: 'white', color: '#64748b', border: '1.5px solid #e2e8f0', borderRadius: '10px', cursor: 'pointer', fontWeight: '600', fontSize: '14px' }}>
                  Cancel
                </button>
              </div>
            </div>
          )}

          {/* Payment history */}
          {payments.length > 0 && (
            <div className="no-print" style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '12px', padding: '16px 20px', marginBottom: '16px' }}>
              <div style={{ fontSize: '13px', fontWeight: '700', color: '#166534', marginBottom: '8px' }}>Payment History</div>
              {payments.map((p, i) => {
                const isReturned = p.cheque_status === 'returned'
                const isChequePending = p.payment_method === 'cheque' && !isReturned
                return (
                  <div key={p.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0', borderBottom: i < payments.length - 1 ? '1px solid #dcfce7' : 'none' }}>
                    <span style={{ fontSize: '13px', color: isReturned ? '#b91c1c' : '#15803d' }}>
                      {new Date(p.created_at).toLocaleDateString('en-GB')} — {p.payment_method?.replace('_', ' ')}
                      {p.cheque_no ? ` · Cheque #${p.cheque_no}` : ''}
                      {isReturned && <span style={{ marginLeft: '8px', padding: '2px 8px', borderRadius: '10px', background: '#fee2e2', color: '#b91c1c', fontSize: '11px', fontWeight: '700' }}>RETURNED</span>}
                    </span>
                    <span style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                      <span style={{ fontSize: '14px', fontWeight: '700', color: isReturned ? '#b91c1c' : '#059669', textDecoration: isReturned ? 'line-through' : 'none' }}>+{formatCurrency(p.amount)}</span>
                      {isChequePending && (
                        <button className="no-print" onClick={() => returnInvoiceCheque(p)} disabled={saving}
                          style={{ padding: '3px 10px', background: '#fee2e2', color: '#b91c1c', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '11px', fontWeight: '700' }}>
                          Mark Returned
                        </button>
                      )}
                    </span>
                  </div>
                )
              })}
            </div>
          )}

          {/* Invoice document */}
          <div id="invoice-print" style={{ background: 'white', borderRadius: '12px', boxShadow: '0 1px 3px rgba(15,23,42,0.06), 0 1px 2px rgba(15,23,42,0.04)', overflow: 'hidden' }}>
            <div style={{ background: 'linear-gradient(135deg,#0b1220,#1e3a8a)', padding: '28px 32px', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <img src="/phonefix-logo.png" alt="Phonefix" style={{ width: '40px', height: '40px', objectFit: 'contain', flexShrink: 0 }} />
                <div>
                  <div style={{ color: 'white', fontWeight: '800', fontSize: '18px' }}>Phonefix</div>
                  <div style={{ color: '#94a3b8', fontSize: '12px' }}>{details.shops?.name}</div>
                </div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ color: '#94a3b8', fontSize: '11px', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '4px' }}>Invoice</div>
                <div style={{ color: 'white', fontSize: '20px', fontWeight: '800' }}>{details.invoice_no}</div>
                <div style={{ color: '#94a3b8', fontSize: '12px', marginTop: '4px' }}>{new Date(details.created_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' })}</div>
                <span style={{ display: 'inline-block', marginTop: '6px', background: sc.bg, color: sc.color, padding: '3px 10px', borderRadius: '20px', fontSize: '11px', fontWeight: '800' }}>{details.status.toUpperCase()}</span>
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', borderBottom: '1px solid #f1f5f9' }}>
              {[
                { title: 'Bill To', lines: [details.customers?.name, details.customers?.customer_no, details.customers?.phone, details.customers?.address] },
                { title: 'Salesman', lines: [details.salesmen?.name, details.salesmen?.salesman_no] },
                { title: 'Payment', lines: [
                  details.payment_method?.replace('_', ' '),
                  details.payment_method === 'cheque' && details.cheque_no ? `Cheque #${details.cheque_no}` : null,
                  details.payment_method === 'cheque' && details.cheque_date ? `Due: ${new Date(details.cheque_date).toLocaleDateString('en-GB')}` : null,
                  remainingCredit > 0 ? `Balance Due: ${formatCurrency(remainingCredit)}` : 'Fully Paid'
                ].filter(Boolean) },
              ].map((block, i) => (
                <div key={i} style={{ padding: '18px 24px', borderRight: i < 2 ? '1px solid #f1f5f9' : 'none' }}>
                  <div style={{ fontSize: '10px', fontWeight: '700', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '6px' }}>{block.title}</div>
                  {block.lines.filter(Boolean).map((line, j) => (
                    <div key={j} style={{ fontSize: j === 0 ? '14px' : '12px', fontWeight: j === 0 ? '700' : '400', color: j === 0 ? '#0f172a' : '#64748b', marginBottom: '2px' }}>{line}</div>
                  ))}
                </div>
              ))}
            </div>

            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: '#f8fafc', borderBottom: '2px solid #e2e8f0' }}>
                  {['#', 'Item', 'Item No', 'Qty', 'Unit Price', 'Warranty', 'Immi No', 'Total'].map((h, i) => (
                    <th key={i} style={{ padding: '10px 14px', textAlign: i === 0 ? 'center' : i >= 5 ? 'right' : 'left', fontSize: '11px', fontWeight: '700', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {lineItems.map((item, idx) => (
                  <tr key={item.id} style={{ borderBottom: '1px solid #f8fafc' }}>
                    <td style={{ padding: '11px 14px', textAlign: 'center', fontSize: '12px', color: '#94a3b8', fontWeight: '700' }}>{idx + 1}</td>
                    <td style={{ padding: '11px 14px', fontSize: '14px', fontWeight: '600', color: '#0f172a' }}>{item.items?.name}</td>
                    <td style={{ padding: '11px 14px', fontSize: '12px', color: '#2563eb', fontWeight: '600' }}>{item.items?.item_no}</td>
                    <td style={{ padding: '11px 14px', fontSize: '14px', fontWeight: '700' }}>{item.quantity}</td>
                    <td style={{ padding: '11px 14px', fontSize: '14px', textAlign: 'right' }}>{formatCurrency(item.unit_price)}</td>
                    <td style={{ padding: '11px 14px', textAlign: 'right' }}>
                      <span style={{ background: (item.warranty && item.warranty !== 'no') ? '#dcfce7' : '#f1f5f9', color: (item.warranty && item.warranty !== 'no') ? '#166534' : '#94a3b8', padding: '2px 8px', borderRadius: '12px', fontSize: '12px', fontWeight: '700' }}>{(!item.warranty || item.warranty === 'no' || item.warranty === false) ? 'No' : item.warranty}</span>
                    </td>
                    <td style={{ padding: '11px 14px', fontSize: '12px', color: item.immi_no ? '#2563eb' : '#cbd5e1', fontWeight: item.immi_no ? '700' : '400', fontFamily: 'monospace' }}>{item.immi_no || '—'}</td>
                    <td style={{ padding: '11px 14px', fontSize: '14px', fontWeight: '700', color: '#059669', textAlign: 'right' }}>{formatCurrency(item.line_total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            <div style={{ display: 'flex', justifyContent: 'flex-end', padding: '16px 24px 24px', borderTop: '2px solid #f1f5f9' }}>
              <div style={{ width: '300px' }}>
                {[
                  { label: 'Subtotal', value: formatCurrency(details.subtotal) },
                  { label: details.discount_percent > 0 ? `Discount (${details.discount_percent}%)` : 'Discount', value: details.discount_amount > 0 ? `− ${formatCurrency(details.discount_amount)}` : '—', red: details.discount_amount > 0 },
                  { label: 'Amount Paid', value: formatCurrency(details.amount_paid), green: true },
                ].map(r => (
                  <div key={r.label} style={{ display: 'flex', justifyContent: 'space-between', padding: '7px 0', borderBottom: '1px solid #f8fafc' }}>
                    <span style={{ fontSize: '14px', color: '#64748b' }}>{r.label}</span>
                    <span style={{ fontSize: '14px', fontWeight: '500', color: r.red ? '#e11d48' : r.green ? '#059669' : '#0f172a' }}>{r.value}</span>
                  </div>
                ))}
                <div style={{ display: 'flex', justifyContent: 'space-between', padding: '12px 14px', background: '#0f172a', borderRadius: '10px', margin: '8px 0' }}>
                  <span style={{ fontSize: '15px', color: '#94a3b8', fontWeight: '600' }}>Total</span>
                  <span style={{ fontSize: '20px', color: 'white', fontWeight: '800' }}>{formatCurrency(details.total)}</span>
                </div>
                {remainingCredit > 0 && (
                  <div style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 14px', background: '#fff1f2', borderRadius: '10px', border: '1.5px solid #fecdd3' }}>
                    <span style={{ fontSize: '14px', color: '#e11d48', fontWeight: '700' }}>Balance Due</span>
                    <span style={{ fontSize: '16px', color: '#e11d48', fontWeight: '800' }}>{formatCurrency(remainingCredit)}</span>
                  </div>
                )}
              </div>
            </div>

            {details.notes && (
              <div style={{ padding: '14px 24px', borderTop: '1px solid #f1f5f9', background: '#fafafa', fontSize: '13px', color: '#64748b' }}>
                <strong>Notes:</strong> {details.notes}
              </div>
            )}
            <div style={{ padding: '14px 24px', borderTop: '1px solid #f1f5f9', textAlign: 'center', fontSize: '12px', color: '#94a3b8' }}>
              Thank you for your business · Phonefix ERP
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
