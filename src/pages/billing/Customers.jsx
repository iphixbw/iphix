import { useState, useEffect, useRef } from 'react'


import { supabase } from '../../supabase'
import { generateCustomerNo, formatCurrency } from '../../lib/helpers'
import { sendSMS, smsTemplates } from '../../lib/sms'
import toast from 'react-hot-toast'

export default function Customers({ activeShop, isSuperAdmin }) {
  const [customers, setCustomers] = useState([])
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(1)
  const PAGE_SIZE = 50
  const [search, setSearch] = useState('')
  const [saving, setSaving] = useState(false)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({ name: '', phone: '', address: '' })
  const [editingCustomer, setEditingCustomer] = useState(null)
  const [editPayment, setEditPayment] = useState(null) // { group, type: 'initial'|'invoice_payment'|'bank_tx' }
  const [editPayAmt, setEditPayAmt] = useState('')
  const [editPayMethod, setEditPayMethod] = useState('')
  const [editPayNotes, setEditPayNotes] = useState('')
  const [editPayChequeNo, setEditPayChequeNo] = useState('')
  const [editPayChequeDate, setEditPayChequeDate] = useState('')
  const [editPayBankId, setEditPayBankId] = useState('')
  const [editPayInvoiceId, setEditPayInvoiceId] = useState('')
  const [editPaySaving, setEditPaySaving] = useState(false)
  const [editForm, setEditForm] = useState({ name: '', phone: '', address: '' })
  const [showEditModal, setShowEditModal] = useState(false)
  const [selectedCustomer, setSelectedCustomer] = useState(null)
  const [customerInvoices, setCustomerInvoices] = useState([])
  const [customerBankTx, setCustomerBankTx] = useState([])
  const [invoicesLoading, setInvoicesLoading] = useState(false)
  const [detailTab, setDetailTab] = useState('invoices')
  const [viewingInvoice, setViewingInvoice] = useState(null)
  const [viewInvoiceItems, setViewInvoiceItems] = useState([])
  const [viewingReturn, setViewingReturn] = useState(null)
  const [viewReturnItems, setViewReturnItems] = useState([])
  const [linkingReturnId, setLinkingReturnId] = useState(null) // return being linked to an invoice
  const [customerReturns, setCustomerReturns] = useState([])
  const [cardBankAccountId, setCardBankAccountId] = useState('')
  const [showPayModal, setShowPayModal] = useState(false)
  const [payAmount, setPayAmount] = useState('')
  const [payMethod, setPayMethod] = useState('cash')
  const [bankAccounts, setBankAccounts] = useState([])
  const [bankAccountId, setBankAccountId] = useState('')
  const [chequeNo, setChequeNo] = useState('')
  const [chequeDate, setChequeDate] = useState('')
  const [chequeBankName, setChequeBankName] = useState('')
  const [payNotes, setPayNotes] = useState('')

  useEffect(() => { fetchCustomers() }, [activeShop?.id])

  // Keep customers.credit_balance in sync with the Activity Statement's live-computed
  // balance (opening balance + credit invoices − payments − credit returns). Without this,
  // the customer list page (which trusts the stored credit_balance column) can drift out
  // of sync with the detail page (which always recomputes fresh from transaction history) —
  // e.g. a customer with an opening balance would show correctly on their detail page but
  // an understated amount on the list.
  useEffect(() => {
    if (!selectedCustomer || invoicesLoading) return
    const _bal = computeCustomerBalance(selectedCustomer, customerInvoices, customerReturns, customerBankTx)
    syncCustomerBalance(selectedCustomer.id, _bal)
  }, [selectedCustomer?.id, invoicesLoading, customerInvoices, customerBankTx, customerReturns])

  async function fetchCustomers() {
    setLoading(true)
    const { data: banks } = await supabase.from('bank_accounts').select('*').order('name')
    setBankAccounts(banks || [])

    // Fetch ALL customers — trust credit_balance column as source of truth.
    // For customers where credit_balance=0 but opening_balance>0, sync credit_balance from opening_balance
    const { data, error } = await supabase.from('customers').select('*').order('name')
    if (error) toast.error('Failed to load customers')
    const customers = data || []
    setCustomers(customers)
    setLoading(false)

    // Background resync: recalculate every customer's balance server-side and
    // silently refresh the list if anything was corrected. This is what makes
    // the list self-heal without requiring someone to open each customer's
    // detail page first (which is the only place a live recompute used to run).
    supabase.rpc('recalculate_all_customer_balances').then(({ data: corrections }) => {
      if (corrections && corrections.length > 0) {
        setCustomers(prev => prev.map(c => {
          const fix = corrections.find(x => x.cust_id === c.id)
          return fix ? { ...c, credit_balance: fix.new_balance } : c
        }))
      }
    }).catch(() => {}) // non-critical — list already shows the (possibly stale) stored values
  }

  // Single, correct balance calculation — mirrors exactly what the Activity
  // Statement displays event-by-event, so the stat card and Customers list can
  // never disagree with the statement again. Treats every invoice's full total
  // as a debit (not just the credit_amount portion) and every payment/return as
  // a credit, which is the only model that's correct for cash invoices that
  // later receive cheque payments (credit_amount stays 0 on those, so the old
  // credit-only formula never counted them as debt in the first place).
  function computeCustomerBalance(customer, invoices, returns, bankTx) {
    const openingBalance = customer?.opening_balance || 0
    let balance = openingBalance

    invoices.forEach(inv => {
      balance += inv.total || 0
      if ((inv.amount_paid || 0) > 0) balance -= inv.amount_paid
    })

    invoices.forEach(inv => {
      (inv.invoice_payments || []).forEach(p => {
        // A returned cheque never actually paid anything — skip it entirely rather
        // than subtracting then adding back, which double-counts the debt (the
        // invoice's full total, added above, already represents money still owed).
        if (p.cheque_status !== 'returned') balance -= p.amount
      })
    })

    bankTx.forEach(tx => {
      // A direct invoice_payment_id link is reliable — an amount/timestamp guess
      // breaks for any cheque split across multiple invoices via FIFO, since the
      // bank_transactions row holds the full amount while each linked
      // invoice_payments row holds only its portion, so they'd never match by
      // amount even though a real link exists.
      const isOpeningPayment = !tx.invoice_payment_id
      if (isOpeningPayment) {
        // A returned cheque never actually paid anything — skip entirely rather
        // than adding back, matching the invoice-linked case. (This "if returned,
        // else if paid" structure meant a returned cheque's original payment was
        // never subtracted in the first place, since by the time cheque_status
        // reflects the return, tx.notes already contains both markers and only
        // the first branch matched — so adding the amount "back" here created new
        // debt instead of simply un-crediting a payment that was never subtracted.)
        if (!(tx.notes && tx.notes.includes('[RETURNED]')) && tx.notes && tx.notes.includes('Opening balance')) {
          balance -= tx.amount
        }
      } else if (!(tx.notes && tx.notes.includes('[RETURNED]'))) {
        // Linked, still active — sum every invoice_payments row tied to this
        // transaction (a FIFO-split cheque can settle several invoices at once,
        // not just one), and treat only the genuine excess over that total as an
        // overpayment remainder / customer credit. Using .find() for a single
        // row here was the bug — it silently ignored every invoice beyond the
        // first for a split cheque, double-subtracting the rest as "remainder".
        const linkedTotal = invoices.reduce((s, inv) =>
          s + (inv.invoice_payments || []).filter(p => p.bank_transaction_id === tx.id).reduce((s2, p) => s2 + p.amount, 0), 0)
        const remainder = tx.amount - linkedTotal
        if (remainder > 0.009) balance -= remainder
      }
    })

    returns.forEach(ret => {
      const isCredit = ret.payment_method === 'credit' || !ret.payment_method
      if (isCredit) balance -= (ret.total || 0)
    })

    return balance
  }

  async function openCustomer(c) {
    // Cash customer should always have 0 balance — auto-reset if stale
    if ((c.customer_no === 'CASH' || c.name === 'Cash Customer') && (c.credit_balance || 0) !== 0) {
      await supabase.from('customers').update({ credit_balance: 0, opening_balance: 0 }).eq('id', c.id)
      c = { ...c, credit_balance: 0, opening_balance: 0 }
    }
    setSelectedCustomer(c)
    setDetailTab('invoices')
    setInvoicesLoading(true)
    const [{ data }, { data: returns }, { data: bankTx }] = await Promise.all([
      supabase.from('invoices')
        .select('*, salesmen(name), invoice_payments(*)')
        .eq('customer_id', c.id).eq('status', 'confirmed')
        .order('created_at', { ascending: true }),
      supabase.from('sales_returns')
        .select('*')
        .eq('customer_id', c.id)
        .eq('status', 'confirmed')
        .order('created_at', { ascending: true }),
      supabase.from('bank_transactions').select('*').ilike('reference', `%${c.name}%`).in('type', ['deposit', 'cheque_in']).order('created_at', { ascending: true }),
    ])
    setCustomerInvoices(data || [])
    setCustomerReturns(returns || [])
    setCustomerBankTx(bankTx || [])
    // Read opening_balance from DB
    const { data: fresh } = await supabase.from('customers').select('credit_balance, opening_balance').eq('id', c.id).single()
    setSelectedCustomer(prev => ({ ...prev, credit_balance: fresh?.credit_balance ?? c.credit_balance, opening_balance: fresh?.opening_balance ?? c.opening_balance ?? 0 }))
    setInvoicesLoading(false)
  }

  // After liveClosingBalance is computed in render, sync back to DB if different
  // This is called once when the drill-down finishes loading
  async function syncCustomerBalance(customerId, computedBalance) {
    const { data: cur } = await supabase.from('customers').select('credit_balance').eq('id', customerId).single()
    if (Math.abs((cur?.credit_balance || 0) - computedBalance) > 0.01) {
      await supabase.from('customers').update({ credit_balance: computedBalance }).eq('id', customerId)
      // Update list
      setCustomers(prev => prev.map(c => c.id === customerId ? { ...c, credit_balance: computedBalance } : c))
    }
  }

  function computePayPlan(amount) {
    let rem = parseFloat(amount) || 0
    const plan = []
    // Only credit returns reduce what the customer still owes
    const returnsByInvoice = {}
    customerReturns.filter(r => r.payment_method === 'credit' || !r.payment_method).forEach(r => {
      if (r.invoice_id) returnsByInvoice[r.invoice_id] = (returnsByInvoice[r.invoice_id] || 0) + (r.total || 0)
    })
    // Same floating-credit distribution as the Invoices tab display (see its comment) —
    // any customer-level credit not tied to a specific invoice's credit_amount is applied
    // FIFO to the oldest unpaid invoices first, so what's offered to settle here matches
    // what the customer actually owes on each invoice, not an inflated per-invoice figure.
    const liveClosingBalanceForPlan = computeCustomerBalance(selectedCustomer, customerInvoices, customerReturns, customerBankTx)
    const rawDuesForPlan = customerInvoices.map(inv => {
      const extraPaid = (inv.invoice_payments || [])
        .filter(p => p.cheque_status !== 'returned')
        .reduce((s, p) => s + p.amount, 0)
      const invReturns = returnsByInvoice[inv.id] || 0
      return Math.max(0, (inv.credit_amount ?? inv.total ?? 0) - invReturns - extraPaid)
    })
    const sumRawDueForPlan = rawDuesForPlan.reduce((s, d) => s + d, 0)
    let floatingCreditForPlan = Math.max(0, sumRawDueForPlan - Math.max(0, liveClosingBalanceForPlan))
    customerInvoices.forEach((inv, i) => {
      const raw = rawDuesForPlan[i]
      const absorbed = Math.min(raw, floatingCreditForPlan)
      floatingCreditForPlan -= absorbed
      const due = raw - absorbed
      if (due <= 0 || rem <= 0) return
      const settle = Math.min(due, rem)
      plan.push({ inv, due, settle, cleared: settle >= due - 0.01 })
      rem -= settle
    })
    return plan
  }

  async function handleFIFOPayment() {
    const amt = parseFloat(payAmount)
    if (!amt || amt <= 0) return toast.error('Enter a valid amount')
    if (payMethod === 'bank_transfer' && !bankAccountId) return toast.error('Select a bank account')
    if (payMethod === 'card' && !cardBankAccountId) return toast.error('Select the bank account where card receipts are deposited')
    if (payMethod === 'cheque' && !chequeDate) return toast.error('Enter cheque date')
    const plan = computePayPlan(amt)
    // If no invoice plan found but customer has opening balance, do a direct balance reduction
    if (!plan.length) {
      const effectiveBal = selectedCustomer.credit_balance || selectedCustomer.opening_balance || 0
      if (effectiveBal <= 0) return toast.error('No outstanding balance to settle')
      setSaving(true)
      try {
        const reduction = amt  // allow overpayment — excess becomes customer credit

        // Reduce balance — can go negative (credit balance = customer overpaid)
        const newCreditBalance = effectiveBal - reduction
        await supabase.from('customers').update({ credit_balance: newCreditBalance }).eq('id', selectedCustomer.id)

        // Record the payment movement — same logic as FIFO path
        if (payMethod === 'bank_transfer' && bankAccountId) {
          const { data: acc } = await supabase.from('bank_accounts').select('balance').eq('id', bankAccountId).single()
          await supabase.from('bank_accounts').update({ balance: (acc?.balance || 0) + reduction }).eq('id', bankAccountId)
          await supabase.from('bank_transactions').insert({
            bank_account_id: bankAccountId, type: 'deposit', amount: reduction,
            reference: `Customer: ${selectedCustomer.name}`,
            notes: `Opening balance payment · Bank Transfer${payNotes ? ` · ${payNotes}` : ''}`,
          })
        } else if (payMethod === 'card' && cardBankAccountId) {
          const { data: acc } = await supabase.from('bank_accounts').select('balance').eq('id', cardBankAccountId).single()
          await supabase.from('bank_accounts').update({ balance: (acc?.balance || 0) + reduction }).eq('id', cardBankAccountId)
          await supabase.from('bank_transactions').insert({
            bank_account_id: cardBankAccountId, type: 'deposit', amount: reduction,
            reference: `Customer: ${selectedCustomer.name}`,
            notes: `Opening balance payment · Card${payNotes ? ` · ${payNotes}` : ''}`,
          })
        } else if (payMethod === 'cheque') {
          await supabase.from('bank_transactions').insert({
            bank_account_id: null, type: 'cheque_in', amount: reduction,
            cheque_no: chequeNo || null, cheque_date: chequeDate, cheque_status: 'pending',
            reference: `Customer: ${selectedCustomer.name}`,
            notes: `Opening balance payment${chequeNo ? ` · Cheque #${chequeNo}` : ''}${chequeBankName ? ` · ${chequeBankName}` : ''}${payNotes ? ` · ${payNotes}` : ''}`,
          })
        }
        // Cash: record in bank_transactions so it appears in cashflow and EOS
        if (payMethod === 'cash') {
          await supabase.from('bank_transactions').insert({
            bank_account_id: null, type: 'deposit', amount: reduction,
            reference: `Customer: ${selectedCustomer.name}`,
            notes: `Opening balance payment · Cash${payNotes ? ` · ${payNotes}` : ''}`,
          })
        }

        toast.success(`${formatCurrency(reduction)} received from ${selectedCustomer.name}`)
        setShowPayModal(false)
        setPayAmount(''); setPayNotes(''); setBankAccountId(''); setChequeNo(''); setChequeDate(''); setChequeBankName(''); setCardBankAccountId('')
        openCustomer({ ...selectedCustomer, credit_balance: newCreditBalance })
        fetchCustomers()
      } catch (e) { toast.error('Failed: ' + e.message) }
      setSaving(false)
      return
    }
    setSaving(true)
    try {
      let applied = 0

      // Distribute full amt across invoices via FIFO
      const paymentRef = `PAY-${Date.now()}`
      const createdPaymentIds = []
      const failedInvoices = []
      for (const { inv, settle } of plan) {
        const { data: ip, error: ipError } = await supabase.from('invoice_payments').insert({
          invoice_id: inv.id, amount: settle, payment_method: payMethod,
          bank_account_id: payMethod === 'bank_transfer' ? bankAccountId : payMethod === 'card' ? cardBankAccountId : null,
          cheque_no: payMethod === 'cheque' ? chequeNo || null : null,
          cheque_date: payMethod === 'cheque' ? chequeDate || null : null,
          cheque_status: payMethod === 'cheque' ? 'pending' : null,
          notes: `${payNotes || 'Customer payment'} · Ref: ${paymentRef} · Total: ${formatCurrency(amt)}`,
        }).select().single()
        // Only count money as applied if the record of it actually saved — otherwise
        // the customer's balance gets reduced by the full payment amount while some
        // portion of it has no corresponding invoice_payments row to show for it.
        if (ipError || !ip) {
          failedInvoices.push(inv.invoice_no || inv.id)
          continue
        }
        createdPaymentIds.push(ip.id)
        applied += settle
      }
      if (failedInvoices.length > 0) {
        // Roll back whatever DID succeed, so a failure leaves nothing half-written behind.
        if (createdPaymentIds.length > 0) {
          await supabase.from('invoice_payments').delete().in('id', createdPaymentIds)
        }
        throw new Error(`Failed to record payment for: ${failedInvoices.join(', ')}. Nothing was saved — please try again.`)
      }

      // If amt > applied (overpayment beyond invoices), the remainder becomes customer
      // credit. Regardless of payment method, it's still the SAME single payment —
      // recording it as two separate transactions (one for the applied portion, one
      // for the "remainder") showed a broken, split view of one real payment instead
      // of the true amount actually paid. Every method now records the full amt as
      // one entry (see the bank_transfer/card/cheque branches below) — this block
      // previously created a separate remainder-only row here, which is now redundant
      // and would double-count alongside the full-amount entry.
      const remainder = amt - applied

      // Reduce credit_balance by full amt (applied to invoices + remainder to opening balance)
      await supabase.rpc('adjust_customer_balance', { p_customer_id: selectedCustomer.id, p_delta: -amt })
      const { data: freshCust } = await supabase.from('customers').select('credit_balance, opening_balance').eq('id', selectedCustomer.id).single()
      const newBalance = freshCust?.credit_balance ?? 0

      // Record full amt in bank/cheque ledger
      if (payMethod === 'cash') {
        // Cash has no linked bank_transactions row for the applied portion (matches
        // the existing convention elsewhere: cash is tracked via invoice_payments only,
        // not the bank ledger). But an overpayment remainder is real money the customer
        // handed over that isn't tied to a specific invoice — record just that excess so
        // it's visible in cashflow, matching the opening-balance-only cash path above.
        if (remainder > 0.009) {
          await supabase.from('bank_transactions').insert({
            bank_account_id: null, type: 'deposit', amount: remainder,
            reference: `Customer: ${selectedCustomer.name}`,
            notes: `Opening balance payment · Remainder of ${formatCurrency(amt)} cash payment · Ref: ${paymentRef}${payNotes ? ` · ${payNotes}` : ''}`,
          })
        }
      } else if (payMethod === 'bank_transfer') {
        if (!bankAccountId) {
          toast.error('No bank account selected — bank balance not updated. Please edit the payment.')
        } else {
          const { data: acc } = await supabase.from('bank_accounts').select('balance').eq('id', bankAccountId).single()
          await supabase.from('bank_accounts').update({ balance: (acc?.balance || 0) + amt }).eq('id', bankAccountId)
          // Record the FULL amount (applied + any overpayment remainder credited to the
          // customer) as one transaction, and link every invoice_payments row created
          // above — mirrors the cheque branch below exactly, applied to bank transfer too.
          const { data: btx, error: btErr } = await supabase.from('bank_transactions').insert({
            bank_account_id: bankAccountId, type: 'deposit', amount: amt,
            reference: `Customer: ${selectedCustomer.name}`,
            notes: `Receivable payment · Bank Transfer${remainder > 0.009 ? ` · Includes ${formatCurrency(remainder)} credit` : ''}${payNotes ? ` · ${payNotes}` : ''}`,
            invoice_payment_id: createdPaymentIds[0] || null,
          }).select().single()
          if (btErr) toast.error('Bank transaction record failed: ' + btErr.message)
          if (btx && createdPaymentIds.length > 0) {
            await supabase.from('invoice_payments').update({ bank_transaction_id: btx.id }).in('id', createdPaymentIds)
          }
        }
      } else if (payMethod === 'card' && cardBankAccountId) {
        const { data: acc } = await supabase.from('bank_accounts').select('balance').eq('id', cardBankAccountId).single()
        await supabase.from('bank_accounts').update({ balance: (acc?.balance || 0) + amt }).eq('id', cardBankAccountId)
        const { data: btx } = await supabase.from('bank_transactions').insert({
          bank_account_id: cardBankAccountId, type: 'deposit', amount: amt,
          reference: `Customer: ${selectedCustomer.name}`,
          notes: `Receivable payment · Card${remainder > 0.009 ? ` · Includes ${formatCurrency(remainder)} credit` : ''}`,
          invoice_payment_id: createdPaymentIds[0] || null,
        }).select().single()
        if (btx && createdPaymentIds.length > 0) {
          await supabase.from('invoice_payments').update({ bank_transaction_id: btx.id }).in('id', createdPaymentIds)
        }
      } else if (payMethod === 'cheque') {
        // Record the FULL cheque amount as one single cheque_in row — a cheque is one
        // physical instrument regardless of how much of it settled invoices vs. became
        // customer credit. Splitting it into two rows (one for the applied portion, one
        // for the overpayment remainder) made it impossible to correctly return "the
        // cheque" as a single action — only one of the two records would get marked
        // returned, leaving the other stranded and the balance math broken.
        const { data: btx } = await supabase.from('bank_transactions').insert({
          bank_account_id: null, type: 'cheque_in', amount: amt,
          cheque_no: chequeNo || null, cheque_date: chequeDate, cheque_status: 'pending',
          reference: `Customer: ${selectedCustomer.name}`,
          notes: `Receivable payment${chequeNo ? ` · Cheque #${chequeNo}` : ''}${chequeBankName ? ` · ${chequeBankName}` : ''}${remainder > 0.009 ? ` · Includes ${formatCurrency(remainder)} credit` : ''} · Ref: ${paymentRef}`,
          invoice_payment_id: createdPaymentIds[0] || null,
        }).select().single()
        if (btx && createdPaymentIds.length > 0) {
          // Link every invoice_payments row created by this payment action to the
          // same bank_transactions row — not just the first — so a FIFO-split cheque
          // (settling several invoices at once) is correctly recognized as fully
          // linked, not misread as "partially unlinked overpayment" by the balance
          // calculation, which sums every linked payment against this transaction.
          await supabase.from('invoice_payments').update({ bank_transaction_id: btx.id }).in('id', createdPaymentIds)
        }
      }

      toast.success(`${formatCurrency(amt)} received from ${selectedCustomer.name}`)
      setShowPayModal(false)
      setPayAmount(''); setPayNotes(''); setBankAccountId(''); setChequeNo(''); setChequeDate(''); setChequeBankName(''); setCardBankAccountId('')
      // Send SMS to customer
      if (selectedCustomer.phone) {
        const msg = smsTemplates.customerPaymentCollected(
          selectedCustomer.name, applied, Math.max(0, newBalance),
          activeShop?.name || 'Phonefix'
        )
        sendSMS({ to: selectedCustomer.phone, message: msg, triggeredBy: 'customer_payment', referenceType: 'customer', referenceId: selectedCustomer.id })
          .then(({ success }) => { if (success) toast.success('SMS sent to customer') })
      }
      const updatedCustomer = { ...selectedCustomer, credit_balance: newBalance, opening_balance: freshCust?.opening_balance ?? selectedCustomer.opening_balance ?? 0 }
      setSelectedCustomer(updatedCustomer)
      openCustomer(updatedCustomer)
      fetchCustomers()
    } catch (e) { toast.error('Error: ' + e.message) }
    setSaving(false)
  }

  async function linkReturnToInvoice(returnId, invoiceId) {
    try {
      await supabase.from('sales_returns').update({ invoice_id: invoiceId }).eq('id', returnId)
      toast.success('Return linked to invoice!')
      setLinkingReturnId(null)
      openCustomer(selectedCustomer) // refresh
    } catch (e) { toast.error('Failed: ' + e.message) }
  }

  async function returnPayment(g) {
    if (g.payment_method !== 'cheque') return
    const dialogAmount = g.displayAmount || g.total
    if (!window.confirm(`Mark this cheque as returned/bounced?\n\nAmount: ${formatCurrency(dialogAmount)}\nCheque #: ${g.cheque_no || '—'}\n\nThis will reverse the payment and add the amount back to the customer's outstanding balance. The payment stays visible in the Activity Statement as returned.`)) return
    setSaving(true)
    try {
      const amt = g.total
      if (g._type === 'bank_tx' && g._btxId) {
        // Opening-balance cheque — mark the bank_transactions row as returned
        await supabase.from('bank_transactions').update({
          cheque_status: 'presented',
          notes: ((g.notes || '') + ' [RETURNED]').trim(),
        }).eq('id', g._btxId)
      } else {
        // Per-invoice cheque — mark the matching invoice_payments row(s) as returned.
        // If this group represents a single original payment, its id is already g.id —
        // use that directly rather than re-matching by time window, which is fragile
        // when multiple cheques land within the same few seconds.
        const groupTime = new Date(g.created_at).getTime()
        const isSingleUngroupedPayment = g.invoices?.length === 1 && g.id && !g._type
        if (isSingleUngroupedPayment) {
          await supabase.from('invoice_payments').update({
            cheque_status: 'returned',
            returned_at: new Date().toISOString(),
            notes: ((g.notes || '') + ' [RETURNED]').trim(),
          }).eq('id', g.id)
          // Keep the linked bank_transactions row in sync, so it shows as
          // returned in Bank.jsx too, not just here.
          if (g.bank_transaction_id) {
            const { data: btx } = await supabase.from('bank_transactions').select('notes').eq('id', g.bank_transaction_id).single()
            await supabase.from('bank_transactions').update({
              cheque_status: 'presented',
              notes: ((btx?.notes || '') + ' [RETURNED]').trim(),
            }).eq('id', g.bank_transaction_id)
          }
        } else {
          // Multi-invoice cheque (a single cheque split across several invoices via
          // FIFO) — match by cheque number, not just time proximity + method, or
          // this can catch a completely different cheque that merely happened to
          // land within the same few seconds.
          const relatedInvoices = customerInvoices.filter(inv =>
            (inv.invoice_payments || []).some(ip =>
              Math.abs(new Date(ip.created_at).getTime() - groupTime) < 5000 &&
              ip.payment_method === 'cheque' && ip.cheque_status !== 'returned' &&
              (g.cheque_no ? ip.cheque_no === g.cheque_no : true)
            )
          )
          for (const inv of relatedInvoices) {
            const ips = (inv.invoice_payments || []).filter(ip =>
              Math.abs(new Date(ip.created_at).getTime() - groupTime) < 5000 &&
              ip.payment_method === 'cheque' && ip.cheque_status !== 'returned' &&
              (g.cheque_no ? ip.cheque_no === g.cheque_no : true)
            )
            for (const ip of ips) {
              await supabase.from('invoice_payments').update({
                cheque_status: 'returned',
                returned_at: new Date().toISOString(),
                notes: ((ip.notes || '') + ' [RETURNED]').trim(),
              }).eq('id', ip.id)
              if (ip.bank_transaction_id) {
                const { data: btx } = await supabase.from('bank_transactions').select('notes').eq('id', ip.bank_transaction_id).single()
                await supabase.from('bank_transactions').update({
                  cheque_status: 'presented',
                  notes: ((btx?.notes || '') + ' [RETURNED]').trim(),
                }).eq('id', ip.bank_transaction_id)
              }
            }
          }
        }
      }
      // Add the amount back to the customer's outstanding balance
      await supabase.rpc('adjust_customer_balance', { p_customer_id: selectedCustomer.id, p_delta: amt })
      toast.success(`Cheque returned — ${formatCurrency(amt)} added back to ${selectedCustomer.name}'s balance`)
      // Re-fetch fresh — small delay guards against any read-after-write lag on the
      // invoice_payments join, so the balance card reflects the return immediately.
      await new Promise(res => setTimeout(res, 150))
      await openCustomer(selectedCustomer)
      fetchCustomers()
    } catch (e) {
      toast.error('Failed: ' + e.message)
    }
    setSaving(false)
  }

  async function deletePayment(g) {
    const dialogAmount = g.displayAmount || g.total
    if (!window.confirm(`Delete this payment of ${formatCurrency(dialogAmount)}?\n\nThis will reverse the customer balance and remove all linked records.`)) return
    setSaving(true)
    try {
      const amt = g.total
      if (g._type === 'bank_tx' && g._btxId) {
        // Delete the bank_transaction record
        await supabase.from('bank_transactions').delete().eq('id', g._btxId)
        // If bank transfer/card, reverse bank balance
        if ((g.payment_method === 'bank_transfer' || g.payment_method === 'card') && g._bankAccountId) {
          const { data: acc } = await supabase.from('bank_accounts').select('balance').eq('id', g._bankAccountId).single()
          await supabase.from('bank_accounts').update({ balance: (acc?.balance || 0) - amt }).eq('id', g._bankAccountId)
        }
      } else if (g._type === 'invoice_payment' || !g._type) {
        // Find all invoice_payments in this group (same 5-second window + method)
        const groupTime = new Date(g.created_at).getTime()
        const relatedInvoices = customerInvoices.filter(inv =>
          (inv.invoice_payments || []).some(ip =>
            Math.abs(new Date(ip.created_at).getTime() - groupTime) < 5000 &&
            ip.payment_method === g.payment_method
          )
        )
        for (const inv of relatedInvoices) {
          const ips = (inv.invoice_payments || []).filter(ip =>
            Math.abs(new Date(ip.created_at).getTime() - groupTime) < 5000 &&
            ip.payment_method === g.payment_method
          )
          for (const ip of ips) {
            await supabase.from('invoice_payments').delete().eq('id', ip.id)
          }
        }
        // Reverse bank/cheque if applicable
        if (g.payment_method === 'bank_transfer' && g._bankAccountId) {
          const { data: acc } = await supabase.from('bank_accounts').select('balance').eq('id', g._bankAccountId).single()
          await supabase.from('bank_accounts').update({ balance: (acc?.balance || 0) - amt }).eq('id', g._bankAccountId)
        } else if (g.payment_method === 'cheque') {
          // Delete the matching pending cheque_in bank_transaction
          await supabase.from('bank_transactions')
            .delete()
            .ilike('reference', `%${selectedCustomer.name}%`)
            .eq('type', 'cheque_in')
            .eq('amount', amt)
        }
      }
      // Restore customer balance
      await supabase.rpc('adjust_customer_balance', { p_customer_id: selectedCustomer.id, p_delta: amt })
      toast.success(`Payment of ${formatCurrency(amt)} deleted and balance restored`)
      openCustomer(selectedCustomer)
      fetchCustomers()
    } catch (e) {
      toast.error('Delete failed: ' + e.message)
    }
    setSaving(false)
  }

  async function saveEditPayment() {
    if (!editPayment) return
    const newAmt = parseFloat(editPayAmt)
    if (!newAmt || newAmt <= 0) return toast.error('Enter a valid amount')
    setEditPaySaving(true)
    try {
      const g = editPayment.group
      const oldAmt = g.total
      const diff = newAmt - oldAmt // positive = increased, negative = decreased

      if (editPayment.type === 'invoice_payment') {
        // Update each invoice_payment record proportionally (or just the first one if single)
        const invPmts = selectedCustomer ? customerInvoices.flatMap(inv =>
          (inv.invoice_payments || []).filter(p => {
            const pTime = new Date(p.created_at).getTime()
            const gTime = new Date(g.created_at).getTime()
            return Math.abs(pTime - gTime) < 5000 && p.payment_method === g.payment_method
          }).map(p => ({ ...p, _fromInvoiceId: inv.id }))
        ) : []
        if (invPmts.length === 1) {
          const updatePayload = { amount: newAmt, payment_method: editPayMethod || g.payment_method, cheque_no: editPayChequeNo || null, cheque_date: editPayChequeDate || null }
          // Re-link to a different invoice — only the two invoices involved are affected;
          // the customer's total credit_balance doesn't change, since the amount owed overall is the same
          const relinking = editPayInvoiceId && editPayInvoiceId !== invPmts[0]._fromInvoiceId
          if (relinking) updatePayload.invoice_id = editPayInvoiceId
          await supabase.from('invoice_payments').update(updatePayload).eq('id', invPmts[0].id)
        } else if (invPmts.length > 1) {
          // Scale each proportionally
          for (const p of invPmts) {
            const scaled = (p.amount / oldAmt) * newAmt
            await supabase.from('invoice_payments').update({ amount: scaled }).eq('id', p.id)
          }
        }
      } else if (editPayment.type === 'bank_tx') {
        const newBankId = editPayBankId || g._bankAccountId
        // Update bank_transactions record
        await supabase.from('bank_transactions').update({
          amount: newAmt,
          bank_account_id: newBankId || null,
          notes: editPayNotes || g.notes,
          cheque_no: editPayChequeNo || null,
          cheque_date: editPayChequeDate || null,
        }).eq('id', g._btxId)
        // Adjust bank account balances — reverse old, apply new
        if (g.payment_method === 'bank_transfer' || g.payment_method === 'card') {
          if (g._bankAccountId && g._bankAccountId !== newBankId) {
            // Bank changed — reverse full amount from old bank
            const { data: oldAcc } = await supabase.from('bank_accounts').select('balance').eq('id', g._bankAccountId).single()
            await supabase.from('bank_accounts').update({ balance: (oldAcc?.balance || 0) - oldAmt }).eq('id', g._bankAccountId)
            // Add full new amount to new bank
            if (newBankId) {
              const { data: newAcc } = await supabase.from('bank_accounts').select('balance').eq('id', newBankId).single()
              await supabase.from('bank_accounts').update({ balance: (newAcc?.balance || 0) + newAmt }).eq('id', newBankId)
            }
          } else if (newBankId) {
            // Same bank, adjust by diff
            const { data: acc } = await supabase.from('bank_accounts').select('balance').eq('id', newBankId).single()
            await supabase.from('bank_accounts').update({ balance: (acc?.balance || 0) + diff }).eq('id', newBankId)
          }
        }
      }

      // Adjust customer credit_balance by the difference
      await supabase.rpc('adjust_customer_balance', { p_customer_id: selectedCustomer.id, p_delta: -diff })

      toast.success('Payment updated')
      setEditPayment(null)
      setEditPayAmt(''); setEditPayMethod(''); setEditPayNotes(''); setEditPayChequeNo(''); setEditPayChequeDate(''); setEditPayBankId(''); setEditPayInvoiceId('')
      openCustomer(selectedCustomer)
      fetchCustomers()
    } catch (e) { toast.error('Failed: ' + e.message) }
    setEditPaySaving(false)
  }

  function openEditCustomer(c, e) {
    e.stopPropagation()
    setEditingCustomer(c)
    setEditForm({ name: c.name || '', phone: c.phone || '', address: c.address || '' })
    setShowEditModal(true)
  }

  async function handleSaveEdit() {
    if (!editForm.name) return toast.error('Name required')
    setSaving(true)
    try {
      const { error } = await supabase.from('customers').update({
        name: editForm.name.trim(),
        phone: editForm.phone.trim(),
        address: editForm.address.trim(),
      }).eq('id', editingCustomer.id)
      if (error) throw error
      toast.success('Customer updated!')
      setShowEditModal(false)
      setEditingCustomer(null)
      fetchCustomers()
    } catch (e) { toast.error('Failed: ' + e.message) }
    setSaving(false)
  }

  async function handleSave() {
    if (!form.name) return toast.error('Name required')
    setSaving(true)
    try {
      const customer_no = await generateCustomerNo()
      await supabase.from('customers').insert({ customer_no, name: form.name, phone: form.phone, address: form.address })
      toast.success('Customer added!')
      setShowForm(false); setForm({ name: '', phone: '', address: '' }); fetchCustomers()
    } catch { toast.error('Failed') }
    setSaving(false)
  }

  async function handleDeleteCustomer(c, e) {
    e.stopPropagation()
    if ((c.credit_balance || 0) !== 0) {
      toast.error(`Cannot delete "${c.name}": balance must be 0. Current balance: ${formatCurrency(Math.abs(c.credit_balance))}`)
      return
    }
    if (!window.confirm(`Delete customer "${c.name}" (${c.customer_no})? This cannot be undone.`)) return
    try {
      // Remove all linked records before deleting the customer
      await supabase.from('sms_log').delete().eq('customer_id', c.id)
      // Nullify customer_id on all invoices (keeps invoice records but unlinks customer)
      await supabase.from('invoices').update({ customer_id: null }).eq('customer_id', c.id)
      // Nullify customer_id on all sales returns
      await supabase.from('sales_returns').update({ customer_id: null }).eq('customer_id', c.id)
      // Remove any bank_transactions linked by reference
      await supabase.from('bank_transactions').delete().ilike('reference', `%${c.name}%`).is('bank_account_id', null)
      // Now delete the customer
      const { error } = await supabase.from('customers').delete().eq('id', c.id)
      if (error) {
        // Show which table is blocking
        toast.error(`Cannot delete: ${error.message}`)
        return
      }
      toast.success(`Customer "${c.name}" deleted`)
      fetchCustomers()
    } catch (err) {
      toast.error('Delete failed: ' + err.message)
    }
  }

  const filtered = customers.filter(c =>
    c.name?.toLowerCase().includes(search.toLowerCase()) ||
    c.customer_no?.toLowerCase().includes(search.toLowerCase()) ||
    c.phone?.includes(search)
  )
  const filteredPaged = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)
  const totalPages = Math.ceil(filtered.length / PAGE_SIZE)

  const inp = { width: '100%', padding: '9px 12px', border: '1.5px solid #e2e8f0', borderRadius: '10px', fontSize: '14px', boxSizing: 'border-box', outline: 'none' }
  const lbl = { display: 'block', marginBottom: '5px', fontSize: '11px', fontWeight: '700', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.06em' }
  const previewPlan = payAmount ? computePayPlan(payAmount) : []

  // ── DETAIL VIEW ──
  if (selectedCustomer) {
    const totalSales = customerInvoices.reduce((s, i) => s + (i.total || 0), 0)
    // Total Paid = real money received (invoice's own amount_paid at creation, plus every
    // invoice_payments row's TRUE face value — using the linked bank_transactions amount
    // where an overpayment cheque's excess was folded in as customer credit, not just the
    // portion that happened to apply to an invoice) — plus any stored customer credit that
    // was consumed against an invoice at creation time, which is a real settlement even
    // though no new money changed hands. Matches the Invoices/Payments tab totals exactly.
    const totalPaidAll = customerInvoices.reduce((s, i) => s + (i.amount_paid || 0), 0) +
      customerInvoices.flatMap(i => (i.invoice_payments || []).filter(pp => pp.cheque_status !== 'returned'))
        .reduce((s, pp) => {
          const linkedTx = pp.bank_transaction_id ? customerBankTx.find(tx => tx.id === pp.bank_transaction_id) : null
          return s + (linkedTx && linkedTx.amount > pp.amount ? linkedTx.amount : pp.amount)
        }, 0) +
      customerInvoices.reduce((s, i) => s + Math.max(0, (i.total || 0) - (i.amount_paid || 0) - (i.credit_amount ?? i.total ?? 0)), 0)
    const totalReturns = customerReturns.reduce((s, r) => s + (r.total || 0), 0)

    // Build returns map for display (all returns — used in invoice tab sub-rows and modals)
    const returnsByInvoice = {}
    customerReturns.forEach(r => {
      const key = r.invoice_id || '__unlinked__'
      if (!returnsByInvoice[key]) returnsByInvoice[key] = []
      returnsByInvoice[key].push(r)
    })

    // Balance-only map — ONLY credit returns reduce what the customer owes
    // cash refunds are paid back in cash — they don't reduce the outstanding DR balance
    const creditRetsByInvoice = {}
    customerReturns.filter(r => r.payment_method === 'credit' || !r.payment_method).forEach(r => {
      const key = r.invoice_id || '__unlinked__'
      if (!creditRetsByInvoice[key]) creditRetsByInvoice[key] = []
      creditRetsByInvoice[key].push(r)
    })

    // Outstanding invoices — only credit returns reduce what's owed
    const outstandingInvoices = customerInvoices.filter(inv => {
      const extraPaid = (inv.invoice_payments || [])
        .filter(p => p.cheque_status !== 'returned')
        .reduce((s, p) => s + p.amount, 0)
      const invReturns = (creditRetsByInvoice[inv.id] || []).reduce((s, r) => s + (r.total || 0), 0)
      return Math.max(0, (inv.total || 0) - (inv.amount_paid || 0) - extraPaid - invReturns) > 0
    })

    // Use stored opening_balance column — set once in Opening Balances, never recalculated
    const openingBalance = selectedCustomer.opening_balance || 0

    // Balance — single shared calculation, matches the Activity Statement exactly
    // (see computeCustomerBalance) so the stat card can never disagree with it.
    const liveClosingBalance = computeCustomerBalance(selectedCustomer, customerInvoices, customerReturns, customerBankTx)

    return (
      <div>
        {showPayModal && (
          <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <div style={{ background: 'white', borderRadius: '16px', padding: '28px', width: '520px', maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 20px 60px rgba(0,0,0,0.3)' }}>
              <h2 style={{ fontSize: '17px', fontWeight: '700', color: '#0f172a', margin: '0 0 4px' }}>Receive Payment</h2>
              <p style={{ fontSize: '13px', color: '#64748b', margin: '0 0 18px' }}>{selectedCustomer.name} · Outstanding: <strong style={{ color: '#e11d48' }}>{formatCurrency(Math.max(0, selectedCustomer.credit_balance || 0))}</strong></p>
              <div style={{ marginBottom: '14px' }}>
                <label style={lbl}>Amount (LKR) *</label>
                <input type="number" value={payAmount} onChange={e => setPayAmount(e.target.value)} onFocus={e => e.target.select()} placeholder="0.00" autoComplete="off" style={{ ...inp, fontSize: '22px', fontWeight: '800' }} autoFocus />
              </div>
              <div style={{ marginBottom: '14px' }}>
                <label style={lbl}>Payment Method</label>
                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                  {['cash','bank_transfer','card','cheque'].map(m => (
                    <button key={m} onClick={() => { setPayMethod(m); setBankAccountId(''); setChequeNo(''); setChequeDate(''); setChequeBankName(''); setCardBankAccountId('') }}
                      style={{ flex: 1, padding: '8px', borderRadius: '10px', border: `2px solid ${payMethod === m ? '#2563eb' : '#e2e8f0'}`, background: payMethod === m ? '#eef2ff' : 'white', cursor: 'pointer', fontSize: '12px', fontWeight: '700', color: payMethod === m ? '#1e40af' : '#64748b', minWidth: '60px' }}>
                      {m === 'cash' ? '💵 Cash' : m === 'bank_transfer' ? '🏦 Bank' : m === 'card' ? '💳 Card' : '🧾 Cheque'}
                    </button>
                  ))}
                </div>
              </div>
              {payMethod === 'bank_transfer' && (
                <div style={{ marginBottom: '14px' }}>
                  <label style={lbl}>Bank Account * (credited to)</label>
                  <select value={bankAccountId} onChange={e => setBankAccountId(e.target.value)} style={{ ...inp, borderColor: !bankAccountId ? '#fca5a5' : '#e2e8f0' }}>
                    <option value="">— Select —</option>
                    {bankAccounts.map(b => <option key={b.id} value={b.id}>{b.name} — {b.bank_name} (LKR {(b.balance||0).toLocaleString('en-LK',{minimumFractionDigits:2})})</option>)}
                  </select>
                </div>
              )}
              {payMethod === 'card' && (
                <div style={{ marginBottom: '14px' }}>
                  <label style={lbl}>Bank Account * (card receipts deposited to)</label>
                  <select value={cardBankAccountId} onChange={e => setCardBankAccountId(e.target.value)} style={{ ...inp, borderColor: !cardBankAccountId ? '#fca5a5' : '#e2e8f0' }}>
                    <option value="">— Select —</option>
                    {bankAccounts.map(b => <option key={b.id} value={b.id}>{b.name} — {b.bank_name} (LKR {(b.balance||0).toLocaleString('en-LK',{minimumFractionDigits:2})})</option>)}
                  </select>
                </div>
              )}
              {payMethod === 'cheque' && (
                <div style={{ marginBottom: '14px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                  <div style={{ gridColumn: '1/-1' }}>
                    <label style={lbl}>Bank Name (where cheque is drawn)</label>
                    <input type="text" value={chequeBankName} onChange={e => setChequeBankName(e.target.value)}
                      placeholder="e.g. Commercial Bank, Sampath Bank…" style={inp} />
                  </div>
                  <div>
                    <label style={lbl}>Cheque No</label>
                    <input type="text" value={chequeNo} onChange={e => setChequeNo(e.target.value)} placeholder="Cheque number" style={inp} />
                  </div>
                  <div>
                    <label style={lbl}>Cheque Date *</label>
                    <input type="date" value={chequeDate} onChange={e => setChequeDate(e.target.value)} style={{ ...inp, borderColor: !chequeDate ? '#fca5a5' : '#e2e8f0' }} />
                  </div>
                  {chequeDate && (
                    <div style={{ gridColumn: '1/-1', padding: '8px 12px', background: '#fef3c7', borderRadius: '7px', fontSize: '12px', color: '#92400e' }}>
                      📥 Will appear in Bank → Unrealized Cheques In until deposited
                    </div>
                  )}
                </div>
              )}
              <div style={{ marginBottom: '16px' }}>
                <label style={lbl}>Notes</label>
                <input type="text" value={payNotes} onChange={e => setPayNotes(e.target.value)} placeholder="Optional" style={inp} />
              </div>
              {previewPlan.length === 0 && payAmount && (selectedCustomer.credit_balance || 0) > 0 && (
                <div style={{ background: '#f5f3ff', border: '1px solid #c4b5fd', borderRadius: '10px', padding: '10px 14px', marginBottom: '12px', fontSize: '13px', color: '#5b21b6' }}>
                  💜 This will reduce the opening balance by {formatCurrency(Math.min(parseFloat(payAmount) || 0, selectedCustomer.credit_balance || 0))}
                </div>
              )}
              {previewPlan.length > 0 && (
                <div style={{ background: '#f0fdf4', border: '1.5px solid #bbf7d0', borderRadius: '10px', padding: '14px', marginBottom: '16px' }}>
                  <div style={{ fontSize: '11px', fontWeight: '700', color: '#166534', textTransform: 'uppercase', marginBottom: '10px' }}>📋 FIFO Settlement Preview</div>
                  {previewPlan.map(({ inv, due, settle, cleared }) => (
                    <div key={inv.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid #dcfce7', fontSize: '13px' }}>
                      <div>
                        <span style={{ fontWeight: '700', color: '#2563eb' }}>{inv.invoice_no}</span>
                        <span style={{ color: '#64748b', marginLeft: '8px' }}>{new Date(inv.created_at).toLocaleDateString('en-GB')}</span>
                        <span style={{ color: '#94a3b8', marginLeft: '8px', fontSize: '12px' }}>Due: {formatCurrency(due)}</span>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <div style={{ fontWeight: '700', color: '#059669' }}>-{formatCurrency(settle)}</div>
                        <div style={{ fontSize: '11px', color: cleared ? '#059669' : '#e11d48', fontWeight: '700' }}>{cleared ? '✓ Cleared' : `Rem: ${formatCurrency(due - settle)}`}</div>
                      </div>
                    </div>
                  ))}
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '8px', fontWeight: '800', fontSize: '14px', paddingTop: '8px', borderTop: '1px solid #bbf7d0' }}>
                    <span>Total Applied</span>
                    <span style={{ color: '#059669' }}>{formatCurrency(previewPlan.reduce((s, p) => s + p.settle, 0))}</span>
                  </div>
                  {(() => {
                    const previewApplied = previewPlan.reduce((s, p) => s + p.settle, 0)
                    const previewRemainder = (parseFloat(payAmount) || 0) - previewApplied
                    return previewRemainder > 0.009 ? (
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '6px', fontWeight: '700', fontSize: '13px', color: '#059669' }}>
                        <span>Excess → credited to customer</span>
                        <span>{formatCurrency(previewRemainder)}</span>
                      </div>
                    ) : null
                  })()}
                </div>
              )}
              <div style={{ display: 'flex', gap: '10px' }}>
                <button onClick={() => { setShowPayModal(false); setPayAmount(''); setPayNotes(''); setBankAccountId(''); setChequeNo(''); setChequeDate(''); setChequeBankName(''); setCardBankAccountId(''); setPayMethod('cash') }}
                  style={{ flex: 1, padding: '11px', background: '#f1f5f9', color: '#475569', border: 'none', borderRadius: '10px', cursor: 'pointer', fontWeight: '600' }}>Cancel</button>
                <button onClick={handleFIFOPayment}
                  disabled={saving || !payAmount || (previewPlan.length === 0 && (selectedCustomer.credit_balance || 0) <= 0)}
                  style={{ flex: 2, padding: '11px', background: (!payAmount || (previewPlan.length === 0 && (selectedCustomer.credit_balance || 0) <= 0)) ? '#e2e8f0' : 'linear-gradient(135deg,#059669,#047857)', color: (!payAmount || (previewPlan.length === 0 && (selectedCustomer.credit_balance || 0) <= 0)) ? '#94a3b8' : 'white', border: 'none', borderRadius: '10px', cursor: 'pointer', fontWeight: '700', fontSize: '14px' }}>
                  {saving ? 'Processing...' : '✓ Apply Payment (FIFO)'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Edit Payment Modal */}
        {editPayment && (
          <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 2000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
            onClick={() => setEditPayment(null)}>
            <div style={{ background: 'white', borderRadius: '14px', padding: '28px', width: '400px', boxShadow: '0 20px 60px rgba(0,0,0,0.2)' }}
              onClick={e => e.stopPropagation()}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
                <div>
                  <h2 style={{ fontSize: '16px', fontWeight: '700', color: '#0f172a', margin: 0 }}>Edit Payment</h2>
                  <div style={{ fontSize: '12px', color: '#94a3b8', marginTop: '2px' }}>
                    {new Date(editPayment.group.created_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}
                  </div>
                </div>
                <button onClick={() => { setEditPayment(null); setEditPayChequeNo(''); setEditPayChequeDate(''); setEditPayBankId(''); setEditPayInvoiceId('') }}
                  style={{ background: '#f1f5f9', border: 'none', borderRadius: '10px', padding: '6px 12px', cursor: 'pointer', color: '#64748b', fontWeight: '600' }}>✕</button>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginBottom: '20px' }}>
                <div>
                  <label style={{ display: 'block', fontSize: '11px', fontWeight: '700', color: '#94a3b8', textTransform: 'uppercase', marginBottom: '4px' }}>Amount (LKR)</label>
                  <input type="number" value={editPayAmt} onChange={e => setEditPayAmt(e.target.value)} min="0" step="0.01"
                    style={{ width: '100%', padding: '9px 12px', border: '1.5px solid #e2e8f0', borderRadius: '7px', fontSize: '14px', fontWeight: '700', outline: 'none' }} />
                  <div style={{ fontSize: '11px', color: '#94a3b8', marginTop: '3px' }}>Original: {formatCurrency(editPayment.group.total)}</div>
                </div>
                {editPayment.type === 'invoice_payment' && editPayment.group.invoices?.length === 1 && (
                  <div>
                    <label style={{ display: 'block', fontSize: '11px', fontWeight: '700', color: '#94a3b8', textTransform: 'uppercase', marginBottom: '4px' }}>Applied To Invoice</label>
                    <select value={editPayInvoiceId} onChange={e => setEditPayInvoiceId(e.target.value)}
                      style={{ width: '100%', padding: '9px 12px', border: '1.5px solid #e2e8f0', borderRadius: '7px', fontSize: '14px', outline: 'none' }}>
                      {customerInvoices.map(inv => (
                        <option key={inv.id} value={inv.id}>{inv.invoice_no} · Credit due: {formatCurrency(inv.credit_amount || 0)}</option>
                      ))}
                    </select>
                    <div style={{ fontSize: '11px', color: '#94a3b8', marginTop: '3px' }}>Currently: {editPayment.group.invoices[0]}</div>
                  </div>
                )}
                <div>
                  <label style={{ display: 'block', fontSize: '11px', fontWeight: '700', color: '#94a3b8', textTransform: 'uppercase', marginBottom: '4px' }}>Payment Method</label>
                  <select value={editPayMethod} onChange={e => setEditPayMethod(e.target.value)}
                    style={{ width: '100%', padding: '9px 12px', border: '1.5px solid #e2e8f0', borderRadius: '7px', fontSize: '14px', outline: 'none' }}>
                    <option value="cash">Cash</option>
                    <option value="cheque">Cheque</option>
                    <option value="bank_transfer">Bank Transfer</option>
                    <option value="card">Card</option>
                  </select>
                </div>
                {(editPayMethod === 'bank_transfer' || editPayMethod === 'card' || editPayMethod === 'cheque' || (!editPayMethod && (editPayment?.group?.payment_method === 'bank_transfer' || editPayment?.group?.payment_method === 'card' || editPayment?.group?.payment_method === 'cheque'))) && (
                  <div>
                    <label style={{ display: 'block', fontSize: '11px', fontWeight: '700', color: '#94a3b8', textTransform: 'uppercase', marginBottom: '4px' }}>Bank Account</label>
                    <select value={editPayBankId} onChange={e => setEditPayBankId(e.target.value)}
                      style={{ width: '100%', padding: '9px 12px', border: '1.5px solid #e2e8f0', borderRadius: '7px', fontSize: '14px', outline: 'none' }}>
                      <option value="">Select bank account…</option>
                      {bankAccounts.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                    </select>
                  </div>
                )}
                <div>
                  <label style={{ display: 'block', fontSize: '11px', fontWeight: '700', color: '#94a3b8', textTransform: 'uppercase', marginBottom: '4px' }}>Notes</label>
                  <input type="text" value={editPayNotes} onChange={e => setEditPayNotes(e.target.value)}
                    style={{ width: '100%', padding: '9px 12px', border: '1.5px solid #e2e8f0', borderRadius: '7px', fontSize: '14px', outline: 'none' }} />
                </div>
                {(editPayMethod === 'cheque' || (editPayment?.group?.payment_method === 'cheque')) && (
                  <>
                    <div>
                      <label style={{ display: 'block', fontSize: '11px', fontWeight: '700', color: '#94a3b8', textTransform: 'uppercase', marginBottom: '4px' }}>Cheque No.</label>
                      <input type="text" value={editPayChequeNo} onChange={e => setEditPayChequeNo(e.target.value)}
                        placeholder="Enter cheque number"
                        style={{ width: '100%', padding: '9px 12px', border: '1.5px solid #e2e8f0', borderRadius: '7px', fontSize: '14px', outline: 'none' }} />
                    </div>
                    <div>
                      <label style={{ display: 'block', fontSize: '11px', fontWeight: '700', color: '#94a3b8', textTransform: 'uppercase', marginBottom: '4px' }}>Cheque Date</label>
                      <input type="date" value={editPayChequeDate} onChange={e => setEditPayChequeDate(e.target.value)}
                        style={{ width: '100%', padding: '9px 12px', border: '1.5px solid #e2e8f0', borderRadius: '7px', fontSize: '14px', outline: 'none' }} />
                    </div>
                  </>
                )}
              </div>
              <div style={{ background: '#fef3c7', borderRadius: '10px', padding: '10px 12px', marginBottom: '16px', fontSize: '12px', color: '#92400e' }}>
                ⚠️ {editPayInvoiceId && editPayment.type === 'invoice_payment' && editPayment.group.invoices?.length === 1 && customerInvoices.find(inv => inv.invoice_no === editPayment.group.invoices[0])?.id !== editPayInvoiceId
                  ? 'Re-linking this payment updates the balance due on both the old and new invoice — the customer\'s total outstanding balance stays the same.'
                  : 'Editing will adjust the customer balance by the difference.'}
              </div>
              <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
                <button onClick={() => { setEditPayment(null); setEditPayChequeNo(''); setEditPayChequeDate(''); setEditPayBankId(''); setEditPayInvoiceId('') }}
                  style={{ padding: '9px 18px', background: '#f1f5f9', color: '#64748b', border: 'none', borderRadius: '10px', cursor: 'pointer', fontWeight: '600' }}>Cancel</button>
                <button onClick={saveEditPayment} disabled={editPaySaving}
                  style={{ padding: '9px 22px', background: 'linear-gradient(135deg,#2563eb,#1d4ed8)', color: 'white', border: 'none', borderRadius: '10px', cursor: 'pointer', fontWeight: '700' }}>
                  {editPaySaving ? 'Saving...' : '✓ Save Changes'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Back + actions */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '20px' }}>
          <button onClick={() => { setSelectedCustomer(null); setCustomerInvoices([]) }}
            style={{ background: 'none', border: 'none', color: '#2563eb', cursor: 'pointer', fontSize: '14px', fontWeight: '600', padding: 0, display: 'flex', alignItems: 'center', gap: '4px' }}>
            ← Back to Customers
          </button>
          {liveClosingBalance > 0.01 && (
            <button onClick={() => { setPayAmount(''); setPayNotes(''); setBankAccountId(''); setChequeNo(''); setChequeDate(''); setChequeBankName(''); setCardBankAccountId(''); setPayMethod('cash'); setShowPayModal(true) }}
              style={{ padding: '10px 20px', background: 'linear-gradient(135deg,#059669,#047857)', color: 'white', border: 'none', borderRadius: '10px', cursor: 'pointer', fontWeight: '700', fontSize: '14px' }}>
              💰 Receive Payment
            </button>
          )}
        </div>

        {/* Profile card */}
        <div style={{ background: 'white', borderRadius: '14px', padding: '24px', boxShadow: '0 1px 3px rgba(15,23,42,0.06), 0 1px 2px rgba(15,23,42,0.04)', marginBottom: '20px', display: 'grid', gridTemplateColumns: 'auto 1fr auto', gap: '20px', alignItems: 'center' }}>
          {/* Avatar */}
          <div style={{ width: '60px', height: '60px', borderRadius: '50%', background: 'linear-gradient(135deg,#2563eb,#1d4ed8)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontSize: '24px', fontWeight: '800', flexShrink: 0 }}>
            {selectedCustomer.name[0].toUpperCase()}
          </div>
          {/* Info */}
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '6px' }}>
              <h1 style={{ fontSize: '20px', fontWeight: '800', color: '#0f172a', margin: 0 }}>{selectedCustomer.name}</h1>
              <span style={{ fontSize: '12px', fontWeight: '700', color: '#2563eb', background: '#eef2ff', padding: '3px 10px', borderRadius: '12px' }}>{selectedCustomer.customer_no}</span>
            </div>
            <div style={{ display: 'flex', gap: '20px', fontSize: '13px', color: '#64748b', flexWrap: 'wrap' }}>
              {selectedCustomer.phone && <span>📞 {selectedCustomer.phone}</span>}
              {selectedCustomer.address && <span>📍 {selectedCustomer.address}</span>}
              {!selectedCustomer.phone && !selectedCustomer.address && <span style={{ color: '#cbd5e1' }}>No contact details</span>}
            </div>
          </div>
          {/* Outstanding / CR badge — always shows live closing balance */}
          {liveClosingBalance > 0.01 && (
            <div style={{ textAlign: 'right', background: '#fff5f5', border: '1.5px solid #fecaca', borderRadius: '12px', padding: '12px 18px' }}>
              <div style={{ fontSize: '11px', fontWeight: '700', color: '#94a3b8', textTransform: 'uppercase', marginBottom: '3px' }}>Outstanding (DR)</div>
              <div style={{ fontSize: '22px', fontWeight: '800', color: '#e11d48' }}>{formatCurrency(liveClosingBalance)}</div>
            </div>
          )}
          {liveClosingBalance < -0.01 && (
            <div style={{ textAlign: 'right', background: '#f0fdf4', border: '1.5px solid #bbf7d0', borderRadius: '12px', padding: '12px 18px' }}>
              <div style={{ fontSize: '11px', fontWeight: '700', color: '#94a3b8', textTransform: 'uppercase', marginBottom: '3px' }}>Credit Balance (CR)</div>
              <div style={{ fontSize: '22px', fontWeight: '800', color: '#059669' }}>{formatCurrency(Math.abs(liveClosingBalance))} CR</div>
              <div style={{ fontSize: '11px', color: '#064e3b', marginTop: '2px' }}>Customer has overpaid</div>
            </div>
          )}
          {Math.abs(liveClosingBalance) <= 0.01 && (
            <div style={{ textAlign: 'right', background: '#f0fdf4', border: '1.5px solid #bbf7d0', borderRadius: '12px', padding: '12px 18px' }}>
              <div style={{ fontSize: '11px', fontWeight: '700', color: '#94a3b8', textTransform: 'uppercase', marginBottom: '3px' }}>Balance</div>
              <div style={{ fontSize: '16px', fontWeight: '800', color: '#059669' }}>✓ Clear</div>
            </div>
          )}
        </div>

        {/* Summary cards */}
        <div style={{ display: 'grid', gridTemplateColumns: `repeat(${openingBalance > 0 ? 6 : 5},1fr)`, gap: '12px', marginBottom: '20px' }}>
          {[
            { label: 'Total Invoices', value: customerInvoices.length, color: '#1e40af' },
            { label: 'Total Billed', value: formatCurrency(totalSales), color: '#0f172a' },
            { label: 'Total Returns', value: formatCurrency(totalReturns), color: '#d97706' },
            { label: 'Total Paid', value: formatCurrency(totalPaidAll), color: '#059669' },
            ...(openingBalance > 0 ? [{ label: 'Opening Balance', value: formatCurrency(openingBalance), color: '#7c3aed' }] : []),
            {
              label: liveClosingBalance > 0.01 ? 'Outstanding (DR)' : liveClosingBalance < -0.01 ? 'Credit (CR)' : 'Balance',
              value: Math.abs(liveClosingBalance) < 0.01 ? '✓ Clear' : `${formatCurrency(Math.abs(liveClosingBalance))}${liveClosingBalance < -0.01 ? ' CR' : ''}`,
              color: liveClosingBalance > 0.01 ? '#e11d48' : '#059669',
            },
          ].map(s => (
            <div key={s.label} style={{ background: 'white', borderRadius: '10px', padding: '14px', boxShadow: '0 1px 3px rgba(15,23,42,0.06), 0 1px 2px rgba(15,23,42,0.04)', borderTop: `3px solid ${s.color}` }}>
              <div style={{ fontSize: '10px', fontWeight: '700', color: '#94a3b8', textTransform: 'uppercase', marginBottom: '4px' }}>{s.label}</div>
              <div style={{ fontSize: '16px', fontWeight: '800', color: s.color }}>{s.value}</div>
            </div>
          ))}
        </div>

        {/* Outstanding invoices highlight */}
        {/* Outstanding invoices banner — deducts returns per invoice */}
        {outstandingInvoices.length > 0 && (
          <div style={{ background: '#fff5f5', border: '1.5px solid #fecaca', borderRadius: '12px', padding: '16px 20px', marginBottom: '16px' }}>
            <div style={{ fontSize: '12px', fontWeight: '700', color: '#e11d48', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '10px' }}>
              ⚠️ {outstandingInvoices.length} Outstanding Invoice{outstandingInvoices.length !== 1 ? 's' : ''}
            </div>
            <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
              {(() => {
                // Same floating-credit distribution as the Invoices tab and Receive
                // Payment plan — keeps this banner consistent with those numbers.
                const rawDuesForBanner = customerInvoices.map(inv => {
                  const extraPaid = (inv.invoice_payments || [])
                    .filter(p => p.cheque_status !== 'returned')
                    .reduce((s, p) => s + p.amount, 0)
                  const invReturns = (creditRetsByInvoice[inv.id] || []).reduce((s, r) => s + (r.total || 0), 0)
                  return Math.max(0, (inv.credit_amount ?? inv.total ?? 0) - extraPaid - invReturns)
                })
                const sumRawDueForBanner = rawDuesForBanner.reduce((s, d) => s + d, 0)
                let floatingCreditForBanner = Math.max(0, sumRawDueForBanner - Math.max(0, liveClosingBalance))
                const bannerDues = {}
                customerInvoices.forEach((inv, i) => {
                  const raw = rawDuesForBanner[i]
                  const applied = Math.min(raw, floatingCreditForBanner)
                  floatingCreditForBanner -= applied
                  bannerDues[inv.id] = raw - applied
                })
                return outstandingInvoices.map(inv => {
                const invReturns = (creditRetsByInvoice[inv.id] || []).reduce((s, r) => s + (r.total || 0), 0)
                const daysAgo = Math.floor((new Date() - new Date(inv.created_at)) / (1000 * 60 * 60 * 24))
                return (
                  <div key={inv.id} style={{ background: 'white', border: '1px solid #fecaca', borderRadius: '10px', padding: '10px 14px', minWidth: '160px' }}>
                    <div style={{ fontSize: '13px', fontWeight: '700', color: '#2563eb' }}>{inv.invoice_no}</div>
                    <div style={{ fontSize: '11px', color: '#94a3b8', margin: '2px 0' }}>
                      {new Date(inv.created_at).toLocaleDateString('en-GB')} · {daysAgo}d ago
                    </div>
                    {invReturns > 0 && (
                      <div style={{ fontSize: '11px', color: '#d97706', marginBottom: '2px' }}>
                        ↩ Return: −{formatCurrency(invReturns)}
                      </div>
                    )}
                    <div style={{ fontSize: '15px', fontWeight: '800', color: '#e11d48' }}>{formatCurrency(bannerDues[inv.id])}</div>
                  </div>
                )
                })
              })()}
            </div>
          </div>
        )}

        {/* Tabbed: Invoice History | Payment History | Activity */}
        <div style={{ background: 'white', borderRadius: '12px', boxShadow: '0 1px 3px rgba(15,23,42,0.06), 0 1px 2px rgba(15,23,42,0.04)', overflow: 'hidden' }}>
          {/* Tab bar */}
          <div style={{ display: 'flex', borderBottom: '2px solid #e2e8f0', background: '#f8fafc', flexWrap: 'wrap' }}>
            {[
              { id: 'invoices', label: `Invoices (${customerInvoices.length})` },
              { id: 'payments', label: `Payments (${customerInvoices.reduce((s, i) => s + (i.invoice_payments?.length || 0) + ((i.amount_paid || 0) > 0 ? 1 : 0), 0) + customerBankTx.filter(tx => tx.notes && tx.notes.includes('Opening balance')).length})` },
              { id: 'activity', label: 'Activity Statement' },
            ].map(tab => (
              <button key={tab.id} onClick={() => setDetailTab(tab.id)}
                style={{ padding: '12px 20px', border: 'none', background: 'none', cursor: 'pointer', fontSize: '13px', fontWeight: '700', color: detailTab === tab.id ? '#2563eb' : '#64748b', borderBottom: `3px solid ${detailTab === tab.id ? '#2563eb' : 'transparent'}`, marginBottom: '-2px' }}>
                {tab.label}
              </button>
            ))}
          </div>

          {invoicesLoading ? <div style={{ padding: '40px', textAlign: 'center', color: '#94a3b8' }}>Loading...</div>

          : detailTab === 'invoices' ? (
            customerInvoices.length === 0 ? <div style={{ padding: '40px', textAlign: 'center', color: '#94a3b8' }}>No invoices yet</div>
            : (
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ background: '#f8fafc', borderBottom: '2px solid #e2e8f0' }}>
                    {['Date','Ref','Description','Total','Returns','Paid','Balance',''].map(h => (
                      <th key={h} style={{ padding: '10px 14px', textAlign: 'left', fontSize: '11px', fontWeight: '700', color: '#94a3b8', textTransform: 'uppercase', whiteSpace: 'nowrap' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {(() => {
                    // Build returns map: invoice_id → list of returns
                    const returnsByInvoice = {}
                    customerReturns.forEach(r => {
                      const key = r.invoice_id || '__unlinked__'
                      if (!returnsByInvoice[key]) returnsByInvoice[key] = []
                      returnsByInvoice[key].push(r)
                    })
                    const rows = []
                    // Any customer-level credit that isn't tied to a specific invoice's own
                    // credit_amount (e.g. an overpayment made via Receive Payment, applied
                    // generally rather than at a specific invoice's creation) reduces the
                    // TRUE total owed but has no natural home in any single invoice's row —
                    // so summed per-row balances would overstate the total even though each
                    // row's own number is individually correct. Distribute it FIFO across the
                    // oldest unpaid invoices first, so every row and the total agree. This is
                    // purely a display choice — no money moves, credit_balance is untouched.
                    const rawDues = customerInvoices.map(inv => {
                      const extraPaid = (inv.invoice_payments || [])
                        .filter(p => p.cheque_status !== 'returned')
                        .reduce((s, p) => s + p.amount, 0)
                      const creditRets = (creditRetsByInvoice[inv.id] || []).reduce((s, r) => s + (r.total || 0), 0)
                      return Math.max(0, (inv.credit_amount ?? inv.total ?? 0) - extraPaid - creditRets)
                    })
                    const sumRawDue = rawDues.reduce((s, d) => s + d, 0)
                    let floatingCredit = Math.max(0, sumRawDue - Math.max(0, liveClosingBalance))
                    const displayDues = rawDues.map(raw => {
                      const applied = Math.min(raw, floatingCredit)
                      floatingCredit -= applied
                      return raw - applied
                    })
                    customerInvoices.forEach((inv, i) => {
                      // Paid = initial amount_paid + every non-returned invoice_payments row
                      // + any stored customer credit that was consumed at creation time.
                      // That credit consumption is derived (total - amount_paid - credit_amount),
                      // since there's no dedicated column recording it directly — credit_amount
                      // already reflects it having been subtracted at creation (see NewInvoice.jsx).
                      // Returned cheques don't count as paid — the customer still owes that amount.
                      const extraPaid = (inv.invoice_payments || [])
                        .filter(p => p.cheque_status !== 'returned')
                        .reduce((s, p) => s + p.amount, 0)
                      const creditConsumedAtCreation = Math.max(0, (inv.total || 0) - (inv.amount_paid || 0) - (inv.credit_amount ?? inv.total ?? 0))
                      const totalPaid = (inv.amount_paid || 0) + extraPaid + creditConsumedAtCreation
                      // Balance: what's actually still owed on this invoice. Uses
                      // credit_amount (not total) as the starting point, since that
                      // already correctly accounts for any stored customer credit that
                      // was applied to THIS invoice at creation time — total alone has
                      // no way to know about that. Also absorbs any floating customer-level
                      // credit distributed above, FIFO, so this row's number always matches
                      // what the customer's total balance implies.
                      const creditRets = (creditRetsByInvoice[inv.id] || []).reduce((s, r) => s + (r.total || 0), 0)
                      // Display: all returns shown in Returns column
                      const allRets = (returnsByInvoice[inv.id] || []).reduce((s, r) => s + (r.total || 0), 0)
                      const due = displayDues[i]
                      const rowBg = due > 0 ? '#fff5f5' : i % 2 === 0 ? 'white' : '#fafafa'
                      // Invoice row
                      rows.push(
                        <tr key={inv.id} style={{ borderBottom: '1px solid #f1f5f9', background: rowBg, cursor: 'pointer' }}
                          onMouseEnter={e => e.currentTarget.style.background = '#eef2ff'}
                          onMouseLeave={e => e.currentTarget.style.background = rowBg}
                          onClick={async () => {
                            const [{ data: items }, { data: freshInv }] = await Promise.all([
                              supabase.from('invoice_items').select('*, items(name, item_no)').eq('invoice_id', inv.id),
                              supabase.from('invoices').select('*, invoice_payments(*)').eq('id', inv.id).single(),
                            ])
                            setViewInvoiceItems(items || [])
                            setViewingInvoice(freshInv || inv)
                          }}>
                          <td style={{ padding: '11px 14px', fontSize: '13px', color: '#64748b', whiteSpace: 'nowrap' }}>{new Date(inv.created_at).toLocaleDateString('en-GB', { day:'2-digit', month:'short', year:'numeric' })}</td>
                          <td style={{ padding: '11px 14px', fontWeight: '700', color: '#2563eb', fontSize: '13px' }}>{inv.invoice_no}</td>
                          <td style={{ padding: '11px 14px', fontSize: '13px', color: '#64748b', textTransform: 'capitalize' }}>{inv.payment_method?.replace('_',' ')}</td>
                          <td style={{ padding: '11px 14px', fontWeight: '700', color: '#0f172a' }}>{formatCurrency(inv.total)}</td>
                          <td style={{ padding: '11px 14px', fontWeight: '600', color: allRets > 0 ? '#d97706' : '#94a3b8' }}>{allRets > 0 ? `− ${formatCurrency(allRets)}` : '—'}</td>
                          <td style={{ padding: '11px 14px', color: '#059669', fontWeight: '600' }}>{formatCurrency(totalPaid)}</td>
                          <td style={{ padding: '11px 14px', fontWeight: '800', color: due > 0 ? '#e11d48' : '#059669' }}>{due > 0 ? formatCurrency(due) : '✓ Paid'}</td>
                          <td style={{ padding: '11px 14px', fontSize: '12px', color: '#2563eb', fontWeight: '600' }}>View →</td>
                        </tr>
                      )
                      // Return sub-rows for this invoice
                      ;(returnsByInvoice[inv.id] || []).forEach(ret => {
                        const isCashRefund = ret.payment_method === 'cash'
                        rows.push(
                          <tr key={`ret-${ret.id}`} style={{ borderBottom: '1px solid #f1f5f9', background: '#fef9ec', cursor: 'pointer' }}
                            onMouseEnter={e => e.currentTarget.style.background = '#fef3c7'}
                            onMouseLeave={e => e.currentTarget.style.background = '#fef9ec'}
                            onClick={async () => {
                              const { data: items } = await supabase.from('sales_return_items').select('*, items(name, item_no)').eq('return_id', ret.id)
                              setViewReturnItems(items || [])
                              setViewingReturn(ret)
                            }}>
                            <td style={{ padding: '8px 14px 8px 24px', fontSize: '12px', color: '#92400e' }}>{new Date(ret.created_at).toLocaleDateString('en-GB', { day:'2-digit', month:'short', year:'numeric' })}</td>
                            <td style={{ padding: '8px 14px', fontWeight: '700', color: '#d97706', fontSize: '12px' }}>{ret.return_no || 'RET'}</td>
                            <td style={{ padding: '8px 14px', fontSize: '12px', color: '#92400e' }}>
                              ↩ Sales Return{ret.remarks ? ` · ${ret.remarks}` : ''}
                              {isCashRefund && <span style={{ marginLeft: '6px', background: '#dcfce7', color: '#166534', padding: '1px 6px', borderRadius: '6px', fontSize: '11px', fontWeight: '700' }}>Cash Refund</span>}
                            </td>
                            <td style={{ padding: '8px 14px', fontSize: '12px', color: '#92400e' }}>—</td>
                            <td style={{ padding: '8px 14px', fontWeight: '700', color: '#d97706', fontSize: '12px' }}>− {formatCurrency(ret.total || 0)}</td>
                            <td colSpan={2} style={{ padding: '8px 14px', fontSize: '11px', color: '#d97706', fontWeight: '600' }}>View →</td>
                          </tr>
                        )
                      })
                    })
                    // Unlinked returns at bottom
                    ;(returnsByInvoice['__unlinked__'] || []).forEach(ret => {
                      rows.push(
                        <tr key={`ret-unlinked-${ret.id}`} style={{ borderBottom: '1px solid #f1f5f9', background: '#fef9ec' }}>
                          <td style={{ padding: '8px 14px', fontSize: '12px', color: '#92400e' }}>{new Date(ret.created_at).toLocaleDateString('en-GB', { day:'2-digit', month:'short', year:'numeric' })}</td>
                          <td style={{ padding: '8px 14px', fontWeight: '700', color: '#d97706', fontSize: '12px' }}>{ret.return_no || 'RET'}</td>
                          <td style={{ padding: '8px 14px', fontSize: '12px', color: '#92400e' }}>
                            ↩ Sales Return (not linked to invoice)
                            {ret.remarks && <span style={{ marginLeft: '6px', color: '#b45309' }}>· {ret.remarks}</span>}
                          </td>
                          <td style={{ padding: '8px 14px', fontSize: '12px', color: '#92400e' }}>—</td>
                          <td style={{ padding: '8px 14px', fontWeight: '700', color: '#d97706', fontSize: '12px' }}>− {formatCurrency(ret.total || 0)}</td>
                          <td colSpan={2} style={{ padding: '8px 14px' }}>
                            {linkingReturnId === ret.id ? (
                              <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                                <select defaultValue="" onChange={e => e.target.value && linkReturnToInvoice(ret.id, e.target.value)}
                                  style={{ fontSize: '12px', padding: '3px 6px', border: '1px solid #fde68a', borderRadius: '5px', background: 'white', color: '#0f172a', cursor: 'pointer' }}>
                                  <option value="">— Select invoice —</option>
                                  {customerInvoices.map(inv => (
                                    <option key={inv.id} value={inv.id}>{inv.invoice_no} · {formatCurrency(inv.total)}</option>
                                  ))}
                                </select>
                                <button onClick={() => setLinkingReturnId(null)}
                                  style={{ fontSize: '11px', color: '#64748b', background: 'none', border: 'none', cursor: 'pointer' }}>✕</button>
                              </div>
                            ) : (
                              <div style={{ display: 'flex', gap: '6px' }}>
                                <button onClick={() => setLinkingReturnId(ret.id)}
                                  style={{ fontSize: '11px', padding: '3px 8px', background: '#fef3c7', color: '#92400e', border: '1px solid #fde68a', borderRadius: '5px', cursor: 'pointer', fontWeight: '700' }}>
                                  Link to Invoice
                                </button>
                                <button onClick={async () => {
                                    const { data: items } = await supabase.from('sales_return_items').select('*, items(name, item_no)').eq('return_id', ret.id)
                                    setViewReturnItems(items || [])
                                    setViewingReturn(ret)
                                  }}
                                  style={{ fontSize: '11px', padding: '3px 8px', background: '#f1f5f9', color: '#64748b', border: 'none', borderRadius: '5px', cursor: 'pointer', fontWeight: '600' }}>
                                  View →
                                </button>
                              </div>
                            )}
                          </td>
                        </tr>
                      )
                    })
                    return rows
                  })()}
                </tbody>
                <tfoot>
                  <tr style={{ background: '#f8fafc', borderTop: '2px solid #e2e8f0' }}>
                    <td colSpan={2} style={{ padding: '12px 14px', fontWeight: '700', fontSize: '13px', color: '#0f172a' }}>Totals</td>
                    <td style={{ padding: '12px 14px' }}></td>
                    <td style={{ padding: '12px 14px', fontWeight: '800', color: '#0f172a' }}>{formatCurrency(totalSales)}</td>
                    <td style={{ padding: '12px 14px', fontWeight: '800', color: '#d97706' }}>− {formatCurrency(customerReturns.reduce((s, r) => s + (r.total || 0), 0))}</td>
                    <td style={{ padding: '12px 14px', fontWeight: '800', color: '#059669' }}>{formatCurrency(totalPaidAll)}</td>
                    <td style={{ padding: '12px 14px', fontWeight: '800', color: liveClosingBalance > 0.01 ? '#e11d48' : '#059669' }}>
                      {Math.abs(liveClosingBalance) < 0.01 ? '✓ Clear' : `${formatCurrency(Math.abs(liveClosingBalance))}${liveClosingBalance < -0.01 ? ' CR' : ''}`}
                    </td>
                    <td></td>
                  </tr>
                </tfoot>
              </table>
            )
          ) : detailTab === 'payments' ? (
            /* Include initial payment at sale + subsequent invoice_payments, group by 5-sec batch */
            (() => {
              // Start with initial payments made at time of invoice creation
              const initialPayments = customerInvoices
                .filter(inv => (inv.amount_paid || 0) > 0)
                .map(inv => ({
                  id: `initial-${inv.id}`,
                  invoice_id: inv.id,
                  invoice_no: inv.invoice_no,
                  amount: inv.amount_paid,
                  payment_method: inv.payment_method,
                  created_at: inv.created_at,
                  notes: 'Payment at sale',
                  _initial: true,
                }))

              // Subsequent payments via invoice_payments table
              const subsequentPayments = customerInvoices.flatMap(inv =>
                (inv.invoice_payments || []).map(p => ({ ...p, invoice_no: inv.invoice_no }))
              )

              // Opening balance direct payments (cash/bank/card/cheque) via bank_transactions
              const directPayments = customerBankTx
                .filter(tx => tx.notes && tx.notes.includes('Opening balance'))
                .map(tx => ({
                  id: `btx-${tx.id}`,
                  _btxId: tx.id,
                  _bankAccountId: tx.bank_account_id,
                  _type: 'bank_tx',
                  invoice_id: null,
                  invoice_no: 'OPEN-BAL',
                  amount: tx.amount,
                  payment_method: tx.type === 'cheque_in' ? 'cheque' : tx.type === 'deposit' ? (tx.notes?.includes('Bank Transfer') ? 'bank_transfer' : tx.notes?.includes('Card') ? 'card' : 'cash') : 'cash',
                  cheque_no: tx.cheque_no || null,
                  cheque_date: tx.cheque_date || null,
                  created_at: tx.created_at,
                  notes: tx.notes,
                  cheque_status: tx.notes?.includes('[RETURNED]') ? 'returned' : null,
                }))

              const allPayments = [...initialPayments, ...subsequentPayments, ...directPayments]
                .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))

              if (allPayments.length === 0) return (
                <div style={{ padding: '40px', textAlign: 'center', color: '#94a3b8' }}>No payments recorded yet</div>
              )

              // Group within 5-second window as one batch — but a shared bank_transaction_id
              // is the more reliable signal for "this is the same physical cheque split
              // across invoices via FIFO" (see the Activity Statement's identical fix above).
              const groups = []
              allPayments.forEach(p => {
                const pTime = new Date(p.created_at).getTime()
                const existing = groups.find(g => {
                  if (p.bank_transaction_id && g.bank_transaction_id) {
                    return g.bank_transaction_id === p.bank_transaction_id
                  }
                  return Math.abs(new Date(g.created_at).getTime() - pTime) < 5000 &&
                    g.payment_method === p.payment_method &&
                    !g._initial && !p._initial // never merge initial payments into batches
                })
                if (existing) {
                  existing.total += p.amount
                  existing.invoices.push(p.invoice_no)
                  if (p.cheque_status === 'returned') existing.cheque_status = 'returned'
                } else {
                  groups.push({ ...p, total: p.amount, invoices: [p.invoice_no] })
                }
              })

              // Compute the TRUE cheque/payment face value for display — g.total only
              // reflects the portion applied to an invoice, which understates an
              // overpayment cheque (e.g. a 7,000 cheque that settled a 5,000 invoice
              // shows as 5,000, making it impossible to reconcile against the real
              // cheque later). This is display-only — g.total itself is left untouched
              // since balance math and the edit modal both depend on it staying accurate.
              groups.forEach(g => {
                const linkedTxId = g.bank_transaction_id || g._btxId
                const linkedTx = linkedTxId ? customerBankTx.find(tx => tx.id === linkedTxId) : null
                g.displayAmount = linkedTx && linkedTx.amount > g.total ? linkedTx.amount : g.total
                g.excessCredit = linkedTx && linkedTx.amount > g.total ? linkedTx.amount - g.total : 0
              })

              return (
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ background: '#f8fafc', borderBottom: '2px solid #e2e8f0' }}>
                      {['Date & Time','Amount Received','Method','Cheque Date','Cheque No.','Applied To','Notes',''].map(h => (
                        <th key={h} style={{ padding: '10px 14px', textAlign: 'left', fontSize: '11px', fontWeight: '700', color: '#94a3b8', textTransform: 'uppercase' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {groups.map((g, i) => (
                      <tr key={g.id || i} style={{ borderBottom: '1px solid #f1f5f9', background: g.cheque_status === 'returned' ? '#fff1f2' : i % 2 === 0 ? 'white' : '#fafafa' }}>
                        <td style={{ padding: '11px 14px', fontSize: '13px', color: '#64748b', whiteSpace: 'nowrap' }}>
                          {new Date(g.created_at).toLocaleDateString('en-GB', { day:'2-digit', month:'short', year:'numeric' })}
                          <span style={{ marginLeft: '6px', fontSize: '11px' }}>{new Date(g.created_at).toLocaleTimeString('en-GB', { hour:'2-digit', minute:'2-digit' })}</span>
                        </td>
                        <td style={{ padding: '11px 14px', fontWeight: '800', color: g.cheque_status === 'returned' ? '#b91c1c' : '#059669', fontSize: '15px', textDecoration: g.cheque_status === 'returned' ? 'line-through' : 'none' }}>
                          {formatCurrency(g.displayAmount)}
                          {g.excessCredit > 0 && (
                            <div style={{ fontSize: '11px', fontWeight: '600', color: '#059669', textDecoration: 'none' }}>
                              ({formatCurrency(g.total)} applied, {formatCurrency(g.excessCredit)} credit)
                            </div>
                          )}
                        </td>
                        <td style={{ padding: '11px 14px' }}>
                          <span style={{ background: '#dcfce7', color: '#166534', padding: '2px 8px', borderRadius: '10px', fontSize: '12px', fontWeight: '700', textTransform: 'capitalize' }}>
                            {g.payment_method?.replace('_',' ') || 'cash'}
                          </span>
                          {g.cheque_status === 'returned' && (
                            <span style={{ marginLeft: '6px', background: '#fee2e2', color: '#b91c1c', padding: '2px 8px', borderRadius: '10px', fontSize: '11px', fontWeight: '700' }}>RETURNED</span>
                          )}
                        </td>
                        <td style={{ padding: '11px 14px', fontSize: '12px', color: '#64748b', whiteSpace: 'nowrap' }}>
                          {g.payment_method === 'cheque' && g.cheque_date
                            ? <span style={{ background: '#fef3c7', color: '#92400e', padding: '2px 8px', borderRadius: '10px', fontWeight: '700', fontSize: '11px' }}>{new Date(g.cheque_date).toLocaleDateString('en-GB', { day:'2-digit', month:'short', year:'numeric' })}</span>
                            : <span style={{ color: '#e2e8f0' }}>—</span>}
                        </td>
                        <td style={{ padding: '11px 14px', fontSize: '12px', color: '#64748b', whiteSpace: 'nowrap' }}>
                          {g.payment_method === 'cheque' && g.cheque_no
                            ? <span style={{ background: '#ede9fe', color: '#5b21b6', padding: '2px 8px', borderRadius: '10px', fontWeight: '700', fontSize: '11px' }}>{g.cheque_no}</span>
                            : <span style={{ color: '#e2e8f0' }}>—</span>}
                        </td>
                        <td style={{ padding: '11px 14px', fontSize: '12px', color: '#2563eb', fontWeight: '600' }}>
                          {[...new Set(g.invoices)].join(', ')}
                        </td>
                        <td style={{ padding: '11px 14px', fontSize: '12px', color: '#64748b' }}>{g.notes?.split('·')[0]?.trim() || '—'}</td>
                        {!g._initial && (
                          <td style={{ padding: '8px 14px' }}>
                            <div style={{ display: 'flex', gap: '6px' }}>
                              {g.payment_method === 'cheque' && g.cheque_status !== 'returned' && (
                                <button onClick={() => returnPayment(g)}
                                  style={{ padding: '4px 10px', background: '#fee2e2', color: '#b91c1c', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '11px', fontWeight: '700' }}>
                                  Mark Returned
                                </button>
                              )}
                              <button onClick={() => {
                                setEditPayment({ group: g, type: g._type || 'invoice_payment' })
                                setEditPayAmt(String(g.total))
                                setEditPayMethod(g.payment_method || 'cash')
                                setEditPayNotes(g.notes || '')
                                setEditPayChequeNo(g.cheque_no || '')
                                setEditPayChequeDate(g.cheque_date || '')
                                setEditPayBankId(g._bankAccountId || '')
                                const currentInv = g.invoices?.length === 1 ? customerInvoices.find(inv => inv.invoice_no === g.invoices[0]) : null
                                setEditPayInvoiceId(currentInv?.id || '')
                              }} style={{ padding: '4px 10px', background: '#eef2ff', color: '#1e40af', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '12px', fontWeight: '700' }}>✏️</button>
                              {isSuperAdmin && (
                                <button onClick={() => deletePayment(g)}
                                  style={{ padding: '4px 10px', background: '#fee2e2', color: '#e11d48', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '12px', fontWeight: '700' }}>🗑</button>
                              )}
                            </div>
                          </td>
                        )}
                        {g._initial && <td></td>}
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr style={{ background: '#f8fafc', borderTop: '2px solid #e2e8f0' }}>
                      <td style={{ padding: '12px 14px', fontWeight: '700', color: '#0f172a' }}>Total Received</td>
                      <td style={{ padding: '12px 14px', fontWeight: '800', color: '#059669', fontSize: '15px' }}>{formatCurrency(groups.filter(g => g.cheque_status !== 'returned').reduce((s, g) => s + g.displayAmount, 0))}</td>
                      <td colSpan={5}></td>
                    </tr>
                  </tfoot>
                </table>
              )
            })()
          ) : (
            /* Activity Statement — chronological, payments grouped by batch */
            (() => {
              const events = []

              // 0. Opening balance — shown as first debit row if present
              if (openingBalance > 0) {
                events.push({
                  date: selectedCustomer.created_at || new Date(0).toISOString(),
                  type: 'opening',
                  ref: 'OPEN-BAL',
                  desc: 'Opening balance brought forward',
                  debit: openingBalance, credit: 0,
                })
              }

              // 0b. Direct payments on opening balance (bank_transactions — cheque/bank)
              // Payment refs already covered by an invoice_payments-linked batch event
              // (built further below) — used to suppress a duplicate standalone line for
              // a cash overpayment remainder that's really part of the same payment action.
              const coveredPaymentRefs = new Set(
                customerInvoices.flatMap(inv => (inv.invoice_payments || []))
                  .map(p => (p.notes || '').match(/Ref:\s*(PAY-\d+)/)?.[1])
                  .filter(Boolean)
              )
              customerBankTx.forEach(tx => {
                // A direct invoice_payment_id link is reliable — an amount/timestamp guess
                // breaks for any cheque split across multiple invoices via FIFO.
                const isOpeningPayment = !tx.invoice_payment_id
                // Show returned/bounced cheques as a debit reversal — but only for genuinely
                // unlinked (opening-balance) transactions. A cheque linked to a specific invoice
                // payment is already reported once by the invoice_payments-sourced reversal below;
                // reporting it here too would double it, since both cheque_status and the
                // bank_transactions note get set together once the two are linked.
                if (isOpeningPayment && tx.notes && tx.notes.includes('[RETURNED]')) {
                  events.push({
                    date: tx.returned_at || tx.updated_at || tx.created_at,
                    type: 'reversal',
                    ref: tx.cheque_no || 'RTN',
                    desc: `Cheque returned/bounced${tx.cheque_no ? ` · Cheque #${tx.cheque_no}` : ''} · Amount reversed`,
                    cheque_date: tx.cheque_date || null,
                    debit: tx.amount,
                    credit: 0,
                  })
                } else if (isOpeningPayment && tx.notes && tx.notes.includes('Opening balance')) {
                  // Skip if this is a cash-overpayment remainder already shown as part of
                  // the combined batch line below (matched by shared payment ref) — showing
                  // it again here would duplicate the same single payment into two lines.
                  const txRef = tx.notes.match(/Ref:\s*(PAY-\d+)/)?.[1]
                  if (txRef && coveredPaymentRefs.has(txRef)) {
                    // handled by the batches loop further below
                  } else {
                  // tx.type only distinguishes cheque_in from everything else — cash,
                  // bank transfer, and card all insert as type 'deposit', so the method
                  // must be read from the notes text (same convention directPayments
                  // already uses), or cash gets mislabeled "bank transfer".
                  const method = tx.type === 'cheque_in' ? 'cheque'
                    : tx.notes?.includes('Bank Transfer') ? 'bank transfer'
                    : tx.notes?.includes('Card') ? 'card'
                    : 'cash'
                  events.push({
                    date: tx.created_at,
                    type: 'payment',
                    ref: tx.cheque_no || 'PAY',
                    desc: `Payment received (${method})${tx.notes ? ` · ${tx.notes.replace('Opening balance payment · ','').replace('Opening balance payment','')}` : ''}`,
                    cheque_date: tx.type === 'cheque_in' ? tx.cheque_date : null,
                    debit: 0,
                    credit: tx.amount,
                  })
                  }
                }
                // Note: a linked, active (not returned) transaction with an overpayment
                // remainder does NOT get its own event here — the invoice_payments-sourced
                // batch event below already shows the TRUE full cheque value (including the
                // credit portion) via displayAmount, with a note explaining the split. Adding
                // a second event for the same remainder here would double-count it.
              })

              // 1. Invoices as debits
              customerInvoices.forEach(inv => {
                events.push({
                  date: inv.created_at, type: 'invoice',
                  ref: inv.invoice_no, desc: `Invoice raised`,
                  debit: inv.total, credit: 0
                })
                // Initial payment at time of invoice (if any)
                if ((inv.amount_paid || 0) > 0) {
                  events.push({
                    date: inv.created_at, type: 'payment',
                    ref: inv.invoice_no,
                    desc: `Payment received (${inv.payment_method?.replace('_',' ') || 'cash'})`,
                    debit: 0, credit: inv.amount_paid,
                    _batchKey: `${inv.created_at}|${inv.payment_method}|initial`
                  })
                }
              })

              // 2. Subsequent payments — group by 5-second window
              // Returned cheques are shown separately as a reversal, not counted as a normal payment
              // A single cheque split across multiple invoices via FIFO produces one
              // invoice_payments row per invoice, all marked returned together and all
              // sharing the same bank_transaction_id. Reporting a reversal event per row
              // — each independently showing the full linked cheque value — double (or
              // triple) counts the same physical cheque. Group by bank_transaction_id
              // first (falling back to the row id when unlinked) so exactly one reversal
              // event is emitted per real cheque, listing every invoice it touched.
              const returnedInvoicePayments = customerInvoices.flatMap(inv =>
                (inv.invoice_payments || []).filter(p => p.cheque_status === 'returned').map(p => ({ ...p, invoice_no: inv.invoice_no }))
              )
              const returnedGroups = []
              returnedInvoicePayments.forEach(p => {
                const groupKey = p.bank_transaction_id || p.id
                const existing = returnedGroups.find(g => g.groupKey === groupKey)
                if (existing) {
                  existing.appliedTotal += p.amount
                  existing.invoiceNos.push(p.invoice_no)
                  if (new Date(p.returned_at || p.created_at) > new Date(existing.returned_at || existing.created_at)) {
                    existing.returned_at = p.returned_at
                  }
                } else {
                  returnedGroups.push({ ...p, groupKey, appliedTotal: p.amount, invoiceNos: [p.invoice_no] })
                }
              })
              returnedGroups.forEach(g => {
                // Show the TRUE cheque face value, not just the portion that was applied
                // to the invoice(s) — a 7,000 cheque that only settled a 5,000 invoice
                // still bounced for its full 7,000, and hiding that makes it impossible
                // to reconcile against the actual cheque later. The balance math is
                // unaffected — it still correctly uses each row's own p.amount.
                const linkedTx = g.bank_transaction_id ? customerBankTx.find(tx => tx.id === g.bank_transaction_id) : null
                const displayAmount = linkedTx ? linkedTx.amount : g.appliedTotal
                const invoiceList = g.invoiceNos.join(', ')
                events.push({
                  date: g.returned_at || g.created_at,
                  type: 'reversal',
                  ref: g.cheque_no || 'RTN',
                  desc: `Cheque returned/bounced${g.cheque_no ? ` · Cheque #${g.cheque_no}` : ''} · Invoice ${invoiceList}${linkedTx && linkedTx.amount > g.appliedTotal ? ` · Cheque was for ${formatCurrency(linkedTx.amount)} (${formatCurrency(g.appliedTotal)} applied${g.invoiceNos.length > 1 ? ' across invoices' : ' here'}, ${formatCurrency(linkedTx.amount - g.appliedTotal)} was excess credit)` : ''}`,
                  cheque_date: g.cheque_date || null,
                  debit: displayAmount,
                  credit: 0,
                })
              })
              const rawPayments = customerInvoices.flatMap(inv =>
                (inv.invoice_payments || []).map(p => ({ ...p, invoice_no: inv.invoice_no }))
              )
              // Group into batches — never merge a returned cheque with a still-valid one,
              // so the "later returned" marker on a batch is always accurate for every
              // payment it represents, not just whichever was grouped in first.
              // A shared bank_transaction_id is the most reliable signal that two
              // invoice_payments rows are actually the SAME physical cheque split across
              // invoices via FIFO — grouping by that first (falling back to the time+method
              // heuristic only when there's no link) prevents each row from independently
              // reporting the full linked cheque value and double-counting it.
              const batches = []
              rawPayments.forEach(p => {
                const pTime = new Date(p.created_at).getTime()
                const existing = batches.find(b => {
                  if (p.bank_transaction_id && b.bank_transaction_id) {
                    return b.bank_transaction_id === p.bank_transaction_id
                  }
                  return Math.abs(new Date(b.created_at).getTime() - pTime) < 5000 &&
                    b.payment_method === p.payment_method &&
                    (b.cheque_status === 'returned') === (p.cheque_status === 'returned')
                })
                if (existing) { existing.total += p.amount }
                else batches.push({ ...p, total: p.amount })
              })
              batches.forEach(b => {
                // Same fix here: show the true cheque face value if this batch's payment
                // is linked to a bank_transactions row with a larger amount (overpayment).
                // For cheque/bank_transfer/card, the linked bank_transactions row holds the
                // FULL cheque/transfer value, so linkedTx.amount IS the true total. For cash,
                // there's no such single record — the bank_transactions row only holds the
                // REMAINDER (the applied portion lives solely in invoice_payments), so the
                // true total there is b.total + the remainder, not the remainder alone.
                let linkedTx = b.bank_transaction_id ? customerBankTx.find(tx => tx.id === b.bank_transaction_id) : null
                let displayAmount = linkedTx ? linkedTx.amount : b.total
                let isCashRemainderMatch = false
                if (!linkedTx && b.notes) {
                  const refMatch = b.notes.match(/Ref:\s*(PAY-\d+)/)
                  if (refMatch) {
                    linkedTx = customerBankTx.find(tx => tx.notes && tx.notes.includes(`Ref: ${refMatch[1]}`))
                    if (linkedTx) {
                      isCashRemainderMatch = true
                      displayAmount = b.total + linkedTx.amount
                    }
                  }
                }
                const excessAmount = isCashRemainderMatch ? linkedTx.amount : (linkedTx && linkedTx.amount > b.total ? linkedTx.amount - b.total : 0)
                const excessNote = excessAmount > 0.009 ? ` · ${formatCurrency(excessAmount)} applied as customer credit` : ''
                events.push({
                  date: b.created_at, type: 'payment',
                  ref: b.cheque_no || '—',
                  desc: `Payment received (${b.payment_method?.replace('_',' ') || 'cash'})${b.cheque_status === 'returned' ? ' — later returned' : ''}${excessNote}${b.notes ? ` · ${b.notes.split('·')[0].trim()}` : ''}`,
                  cheque_date: b.payment_method === 'cheque' ? b.cheque_date : null,
                  debit: 0, credit: displayAmount
                })
              })

              // 3. Sales returns
              // credit returns → reduce DR balance (credit column)
              // cash returns → refund paid to customer, does NOT reduce their outstanding
              customerReturns.forEach(ret => {
                const linkedInv = customerInvoices.find(i => i.id === ret.invoice_id)
                const isCredit = ret.payment_method === 'credit' || !ret.payment_method
                events.push({
                  date: ret.created_at,
                  type: isCredit ? 'return' : 'return_external',
                  ref: ret.return_no || 'RET',
                  desc: `Sales return${linkedInv ? ` (${linkedInv.invoice_no})` : ''}${ret.remarks ? ` · ${ret.remarks}` : ''}`,
                  debit: 0,
                  credit: isCredit ? (ret.total || 0) : 0, // cash refunds don't move balance
                  _pmMethod: ret.payment_method,
                  _amount: ret.total || 0,
                })
              })

              events.sort((a, b) => new Date(a.date) - new Date(b.date))
              let balance = 0
              const rows = events.map(e => {
                balance += (e.debit || 0) - (e.credit || 0)
                return { ...e, balance }
              })
              if (rows.length === 0 && openingBalance <= 0) return <div style={{ padding: '40px', textAlign: 'center', color: '#94a3b8' }}>No activity yet</div>
              const bgMap = { opening: '#f5f3ff', invoice: '#fff5f5', payment: '#f0fdf4', return: '#fef3c7', return_external: '#f0f9ff', reversal: '#fff1f2' }
              function exportActivityExcel() {
                const headers = ['Date','Ref','Description','Cheque Date','Debit (LKR)','Credit (LKR)','Balance (LKR)']
                const dataRows = rows.map(e => [
                  new Date(e.date).toLocaleDateString('en-GB'),
                  e.ref,
                  e.desc,
                  e.cheque_date ? new Date(e.cheque_date).toLocaleDateString('en-GB') : '',
                  e.debit > 0 ? e.debit.toFixed(2) : '',
                  e.credit > 0 ? e.credit.toFixed(2) : '',
                  e.balance.toFixed(2) + (e.balance > 0.01 ? ' DR' : e.balance < -0.01 ? ' CR' : ''),
                ])
                const csv = [headers, ...dataRows].map(r => r.map(v => `"${v}"`).join(',')).join('\n')
                const blob = new Blob([csv], { type: 'text/csv' })
                const url = URL.createObjectURL(blob)
                const a = document.createElement('a')
                a.href = url; a.download = `${selectedCustomer.name}-activity-statement.csv`; a.click()
                URL.revokeObjectURL(url)
              }
              return (
                <div>
                  <div style={{ display: 'flex', justifyContent: 'flex-end', padding: '8px 14px', borderBottom: '1px solid #f1f5f9' }}>
                    <button onClick={exportActivityExcel}
                      style={{ padding: '6px 14px', background: '#f0fdf4', color: '#059669', border: '1.5px solid #bbf7d0', borderRadius: '7px', cursor: 'pointer', fontWeight: '700', fontSize: '12px' }}>
                      ⬇ Export to Excel
                    </button>
                  </div>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ background: '#f8fafc', borderBottom: '2px solid #e2e8f0' }}>
                      {['Date','Ref','Description','Cheque Date','Debit','Credit','Balance'].map((h, hi) => (
                        <th key={h} style={{ padding: '10px 14px', textAlign: hi >= 4 ? 'right' : 'left', fontSize: '11px', fontWeight: '700', color: '#94a3b8', textTransform: 'uppercase', whiteSpace: 'nowrap' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((e, i) => (
                      <tr key={i} style={{ borderBottom: '1px solid #f1f5f9', background: bgMap[e.type] || 'white' }}>
                        <td style={{ padding: '9px 14px', fontSize: '12px', color: '#64748b', whiteSpace: 'nowrap' }}>{new Date(e.date).toLocaleDateString('en-GB', { day:'2-digit', month:'short', year:'numeric' })}</td>
                        <td style={{ padding: '9px 14px', fontWeight: '700', color: e.type === 'reversal' ? '#e11d48' : e.type.startsWith('return') ? '#d97706' : '#2563eb', fontSize: '12px' }}>{e.ref}</td>
                        <td style={{ padding: '9px 14px', fontSize: '13px', color: '#0f172a' }}>
                          {e.desc}
                          {e.type === 'return_external' && (
                            <>
                              <span style={{ marginLeft: '6px', background: '#dcfce7', color: '#166534', padding: '1px 6px', borderRadius: '6px', fontSize: '11px', fontWeight: '700' }}>Cash Refund</span>
                              <span style={{ marginLeft: '6px', fontSize: '11px', color: '#64748b' }}>({formatCurrency(e._amount)} — no balance impact)</span>
                            </>
                          )}
                        </td>
                        <td style={{ padding: '9px 14px', fontSize: '12px', color: '#7c3aed', whiteSpace: 'nowrap' }}>
                          {e.cheque_date ? new Date(e.cheque_date).toLocaleDateString('en-GB', { day:'2-digit', month:'short', year:'numeric' }) : '—'}
                        </td>
                        <td style={{ padding: '9px 14px', textAlign: 'right', fontWeight: '700', color: '#e11d48' }}>{e.debit > 0 ? formatCurrency(e.debit) : '—'}</td>
                        <td style={{ padding: '9px 14px', textAlign: 'right', fontWeight: '700', color: e.type === 'return' ? '#d97706' : '#059669' }}>
                          {e.type === 'return_external' ? <span style={{ color: '#94a3b8', fontStyle: 'italic' }}>—</span> : e.credit > 0 ? formatCurrency(e.credit) : '—'}
                        </td>
                        <td style={{ padding: '9px 14px', textAlign: 'right', fontWeight: '800', fontSize: '13px', color: e.balance > 0.01 ? '#e11d48' : e.balance < -0.01 ? '#059669' : '#059669' }}>
                          {e.type === 'return_external'
                            ? <span style={{ color: '#94a3b8', fontStyle: 'italic', fontSize: '11px' }}>unchanged</span>
                            : Math.abs(e.balance) < 0.01 ? '✓ Nil' : `${formatCurrency(Math.abs(e.balance))} ${e.balance > 0.01 ? 'DR' : 'CR'}`}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr style={{ background: '#0f172a' }}>
                      <td colSpan={4} style={{ padding: '12px 14px', fontWeight: '700', color: 'white', fontSize: '13px' }}>Closing Balance</td>
                      <td style={{ padding: '12px 14px', textAlign: 'right', fontWeight: '800', color: '#fca5a5' }}>{formatCurrency(rows.reduce((s, e) => s + (e.debit || 0), 0))}</td>
                      <td style={{ padding: '12px 14px', textAlign: 'right', fontWeight: '800', color: '#86efac' }}>{formatCurrency(rows.reduce((s, e) => s + (e.credit || 0), 0))}</td>
                      <td style={{ padding: '12px 14px', textAlign: 'right', fontWeight: '900', fontSize: '15px',
                        color: (rows[rows.length-1]?.balance || 0) > 0.01 ? '#fca5a5' : '#86efac' }}>
                        {Math.abs(rows[rows.length-1]?.balance || 0) < 0.01 ? '✓ Nil'
                          : `${formatCurrency(Math.abs(rows[rows.length-1]?.balance || 0))} ${(rows[rows.length-1]?.balance || 0) > 0 ? 'DR' : 'CR'}`}
                      </td>
                    </tr>
                  </tfoot>
                </table>
                </div>
              )
            })()
          )}
        </div>

        {/* Invoice detail modal */}
        {viewingInvoice && (
          <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
            onClick={e => { if (e.target === e.currentTarget) { setViewingInvoice(null); setViewInvoiceItems([]) } }}>
            <div style={{ background: 'white', borderRadius: '16px', padding: '28px', width: '620px', maxHeight: '88vh', overflowY: 'auto', boxShadow: '0 20px 60px rgba(0,0,0,0.3)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '20px' }}>
                <div>
                  <h2 style={{ fontSize: '18px', fontWeight: '800', color: '#0f172a', margin: '0 0 4px' }}>{viewingInvoice.invoice_no}</h2>
                  <p style={{ fontSize: '13px', color: '#64748b', margin: 0 }}>{new Date(viewingInvoice.created_at).toLocaleDateString('en-GB', { day:'2-digit', month:'long', year:'numeric' })} · {viewingInvoice.payment_method?.replace('_',' ')}</p>
                </div>
                <button onClick={() => { setViewingInvoice(null); setViewInvoiceItems([]) }}
                  style={{ background: '#f1f5f9', border: 'none', borderRadius: '10px', padding: '8px 14px', cursor: 'pointer', color: '#64748b', fontWeight: '600' }}>✕ Close</button>
              </div>

              {/* Items */}
              <h3 style={{ fontSize: '12px', fontWeight: '700', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '8px' }}>Items Sold</h3>
              <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '16px' }}>
                <thead>
                  <tr style={{ background: '#f8fafc', borderBottom: '2px solid #e2e8f0' }}>
                    {['Item','Qty','Unit Price','Total'].map(h => (
                      <th key={h} style={{ padding: '8px 12px', textAlign: 'left', fontSize: '11px', fontWeight: '700', color: '#94a3b8', textTransform: 'uppercase' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {viewInvoiceItems.map((li, i) => (
                    <tr key={li.id} style={{ borderBottom: '1px solid #f1f5f9', background: i % 2 === 0 ? 'white' : '#fafafa' }}>
                      <td style={{ padding: '9px 12px', fontWeight: '600', color: '#0f172a' }}>
                        {li.items?.name}
                        {li.is_free_issue && <span style={{ marginLeft: '6px', background: '#eef2ff', color: '#1e40af', padding: '1px 6px', borderRadius: '10px', fontSize: '11px', fontWeight: '700' }}>FREE</span>}
                      </td>
                      <td style={{ padding: '9px 12px', color: '#64748b' }}>{li.quantity}</td>
                      <td style={{ padding: '9px 12px', color: '#64748b' }}>{li.is_free_issue ? '—' : formatCurrency(li.unit_price)}</td>
                      <td style={{ padding: '9px 12px', fontWeight: '700', color: '#059669' }}>{li.is_free_issue ? 'FREE' : formatCurrency(li.line_total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {/* Totals summary */}
              {(() => {
                const invReturns = customerReturns.filter(r => r.invoice_id === viewingInvoice.id)
                const totalReturned = invReturns.reduce((s, r) => s + (r.total || 0), 0)
                const creditReturned = invReturns.filter(r => r.payment_method === 'credit' || !r.payment_method).reduce((s, r) => s + (r.total || 0), 0)
                const nonReturnedPayments = (viewingInvoice.invoice_payments || []).filter(p => p.cheque_status !== 'returned').reduce((s, p) => s + p.amount, 0)
                const totalPaid = (viewingInvoice.amount_paid || 0) + nonReturnedPayments
                const balanceDue = Math.max(0, (viewingInvoice.total || 0) - creditReturned - totalPaid)
                return (
                  <div style={{ background: '#f8fafc', borderRadius: '10px', padding: '14px 16px', marginBottom: '16px' }}>
                    {[
                      { l: 'Subtotal', v: formatCurrency(viewingInvoice.subtotal || viewingInvoice.total) },
                      viewingInvoice.discount_amount > 0 ? { l: 'Discount', v: `− ${formatCurrency(viewingInvoice.discount_amount)}` } : null,
                      { l: 'Invoice Total', v: formatCurrency(viewingInvoice.total), bold: true },
                      totalReturned > 0 ? { l: 'Sales Returns', v: `− ${formatCurrency(totalReturned)}`, color: '#d97706' } : null,
                      { l: 'Amount Paid', v: formatCurrency(totalPaid), color: '#059669' },
                      { l: 'Balance Due', v: balanceDue > 0 ? formatCurrency(balanceDue) : '✓ Fully Paid', color: balanceDue > 0 ? '#e11d48' : '#059669', bold: true },
                    ].filter(Boolean).map(row => (
                      <div key={row.l} style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 0', borderBottom: '1px solid #e2e8f0', fontSize: row.bold ? '15px' : '13px', fontWeight: row.bold ? '800' : '500', color: row.color || '#0f172a' }}>
                        <span style={{ color: row.bold ? (row.color || '#0f172a') : '#64748b' }}>{row.l}</span>
                        <span>{row.v}</span>
                      </div>
                    ))}
                  </div>
                )
              })()}

              {/* Linked Sales Returns */}
              {(() => {
                const invReturns = customerReturns.filter(r => r.invoice_id === viewingInvoice.id)
                if (invReturns.length === 0) return null
                return (
                  <div style={{ marginBottom: '16px' }}>
                    <h3 style={{ fontSize: '12px', fontWeight: '700', color: '#d97706', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '8px' }}>↩ Sales Returns ({invReturns.length})</h3>
                    {invReturns.map((ret, i) => (
                      <div key={ret.id}
                        onClick={async () => {
                          const { data: items } = await supabase.from('sales_return_items').select('*, items(name, item_no)').eq('return_id', ret.id)
                          setViewReturnItems(items || [])
                          setViewingReturn(ret)
                        }}
                        style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 14px', background: i % 2 === 0 ? '#fef9ec' : '#fffbf0', border: '1px solid #fde68a', borderRadius: '10px', marginBottom: '6px', cursor: 'pointer' }}
                        onMouseEnter={e => e.currentTarget.style.background = '#fef3c7'}
                        onMouseLeave={e => e.currentTarget.style.background = i % 2 === 0 ? '#fef9ec' : '#fffbf0'}>
                        <div>
                          <div style={{ fontWeight: '700', color: '#d97706', fontSize: '13px' }}>{ret.return_no || 'RET'}</div>
                          <div style={{ fontSize: '11px', color: '#92400e', marginTop: '2px' }}>
                            {new Date(ret.created_at).toLocaleDateString('en-GB', { day:'2-digit', month:'short', year:'numeric' })}
                            {ret.remarks && <span style={{ marginLeft: '8px' }}>{ret.remarks}</span>}
                          </div>
                        </div>
                        <div style={{ textAlign: 'right' }}>
                          <div style={{ fontWeight: '800', color: '#d97706', fontSize: '15px' }}>− {formatCurrency(ret.total || 0)}</div>
                          <div style={{ fontSize: '11px', color: '#92400e', marginTop: '1px' }}>View details →</div>
                        </div>
                      </div>
                    ))}
                  </div>
                )
              })()}

              {/* Payment history */}
              {(viewingInvoice.invoice_payments || []).length > 0 && (
                <div>
                  <h3 style={{ fontSize: '12px', fontWeight: '700', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '8px' }}>Payment History</h3>
                  {viewingInvoice.invoice_payments.map((p, i) => (
                    <div key={p.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 12px', background: i % 2 === 0 ? '#f8fafc' : 'white', borderRadius: '6px', marginBottom: '4px', fontSize: '13px' }}>
                      <div>
                        <span style={{ fontWeight: '600', color: '#0f172a' }}>{new Date(p.created_at).toLocaleDateString('en-GB', { day:'2-digit', month:'short', year:'numeric' })}</span>
                        <span style={{ marginLeft: '8px', color: '#64748b', textTransform: 'capitalize' }}>{p.payment_method?.replace('_',' ') || 'cash'}</span>
                        {p.notes && <span style={{ marginLeft: '8px', color: '#94a3b8', fontSize: '12px' }}>{p.notes.split('·')[0]?.trim()}</span>}
                      </div>
                      <span style={{ fontWeight: '800', color: '#059669' }}>{formatCurrency(p.amount)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Sales Return detail modal */}
        {viewingReturn && (
          <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 1001, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
            onClick={e => { if (e.target === e.currentTarget) { setViewingReturn(null); setViewReturnItems([]) } }}>
            <div style={{ background: 'white', borderRadius: '16px', padding: '28px', width: '540px', maxHeight: '82vh', overflowY: 'auto', boxShadow: '0 24px 80px rgba(0,0,0,0.4)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '20px' }}>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '4px' }}>
                    <h2 style={{ fontSize: '18px', fontWeight: '800', color: '#0f172a', margin: 0 }}>{viewingReturn.return_no || 'Sales Return'}</h2>
                    <span style={{ background: '#fef3c7', color: '#92400e', padding: '2px 10px', borderRadius: '10px', fontSize: '12px', fontWeight: '700' }}>↩ Return</span>
                  </div>
                  <p style={{ fontSize: '13px', color: '#64748b', margin: 0 }}>
                    {new Date(viewingReturn.created_at).toLocaleDateString('en-GB', { day:'2-digit', month:'long', year:'numeric' })}
                    {viewingReturn.remarks && <span style={{ marginLeft: '8px' }}>· {viewingReturn.remarks}</span>}
                  </p>
                </div>
                <button onClick={() => { setViewingReturn(null); setViewReturnItems([]) }}
                  style={{ background: '#f1f5f9', border: 'none', borderRadius: '10px', padding: '8px 14px', cursor: 'pointer', color: '#64748b', fontWeight: '600' }}>✕ Close</button>
              </div>

              {/* Return items */}
              <h3 style={{ fontSize: '12px', fontWeight: '700', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '8px' }}>Returned Items</h3>
              <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '16px' }}>
                <thead>
                  <tr style={{ background: '#f8fafc', borderBottom: '2px solid #e2e8f0' }}>
                    {['Item','Qty','Unit Price','Line Total'].map(h => (
                      <th key={h} style={{ padding: '8px 12px', textAlign: 'left', fontSize: '11px', fontWeight: '700', color: '#94a3b8', textTransform: 'uppercase' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {viewReturnItems.map((li, i) => (
                    <tr key={li.id || i} style={{ borderBottom: '1px solid #f1f5f9', background: i % 2 === 0 ? 'white' : '#fafafa' }}>
                      <td style={{ padding: '9px 12px', fontWeight: '600', color: '#0f172a' }}>{li.items?.name || '—'}</td>
                      <td style={{ padding: '9px 12px', color: '#64748b' }}>{li.quantity}</td>
                      <td style={{ padding: '9px 12px', color: '#64748b' }}>{formatCurrency(li.unit_price)}</td>
                      <td style={{ padding: '9px 12px', fontWeight: '700', color: '#d97706' }}>{formatCurrency(li.line_total || li.quantity * li.unit_price)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {/* Return summary */}
              <div style={{ background: '#fef9ec', borderRadius: '10px', padding: '14px 16px', border: '1px solid #fde68a' }}>
                {[
                  { l: 'Total Returned', v: formatCurrency(viewingReturn.total || viewingReturn.subtotal || 0), bold: true, color: '#d97706' },
                  { l: 'Refund Method', v: (viewingReturn.payment_method || 'credit').replace('_', ' '), color: '#64748b' },
                  { l: 'Linked Invoice', v: customerInvoices.find(i => i.id === viewingReturn.invoice_id)?.invoice_no || '—', color: '#2563eb' },
                  viewingReturn.remarks ? { l: 'Remarks', v: viewingReturn.remarks, color: '#64748b' } : null,
                ].filter(Boolean).map(row => (
                  <div key={row.l} style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 0', borderBottom: '1px solid #fde68a', fontSize: row.bold ? '15px' : '13px', fontWeight: row.bold ? '800' : '500' }}>
                    <span style={{ color: '#92400e' }}>{row.l}</span>
                    <span style={{ color: row.color || '#0f172a', textTransform: 'capitalize', fontWeight: row.bold ? '800' : '600' }}>{row.v}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    )
  }

  // ── LIST VIEW ──
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
        <h1 style={{ fontSize: '22px', fontWeight: '700', color: '#0f172a', margin: 0 }}>Customers</h1>
        <button onClick={() => setShowForm(!showForm)}
          style={{ padding: '10px 20px', background: showForm ? '#f1f5f9' : 'linear-gradient(135deg,#2563eb,#1d4ed8)', color: showForm ? '#475569' : 'white', border: 'none', borderRadius: '10px', cursor: 'pointer', fontWeight: '700', fontSize: '14px' }}>
          {showForm ? 'Cancel' : '+ Add Customer'}
        </button>
      </div>
      {showForm && (
        <div style={{ background: 'white', borderRadius: '12px', padding: '20px', boxShadow: '0 1px 3px rgba(15,23,42,0.06), 0 1px 2px rgba(15,23,42,0.04)', marginBottom: '20px' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '14px' }}>
            {[{k:'name',p:'Full name *',col:'1/-1'},{k:'phone',p:'Phone'},{k:'address',p:'Address'}].map(f => (
              <div key={f.k} style={f.col ? {gridColumn:f.col} : {}}>
                <input type="text" placeholder={f.p} value={form[f.k]} onChange={e => setForm(p => ({...p,[f.k]:e.target.value}))} style={inp} />
              </div>
            ))}
          </div>
          <button onClick={handleSave} disabled={saving}
            style={{ padding: '9px 20px', background: 'linear-gradient(135deg,#2563eb,#1d4ed8)', color: 'white', border: 'none', borderRadius: '10px', cursor: 'pointer', fontWeight: '700' }}>
            {saving ? 'Saving...' : '✓ Add Customer'}
          </button>
        </div>
      )}


      {/* Edit Customer Modal */}
      {showEditModal && editingCustomer && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          onClick={() => setShowEditModal(false)}>
          <div style={{ background: 'white', borderRadius: '14px', padding: '28px', width: '420px', boxShadow: '0 20px 60px rgba(0,0,0,0.2)' }}
            onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
              <div>
                <h2 style={{ fontSize: '16px', fontWeight: '700', color: '#0f172a', margin: 0 }}>Edit Customer</h2>
                <div style={{ fontSize: '12px', color: '#2563eb', fontWeight: '600', marginTop: '2px' }}>{editingCustomer.customer_no}</div>
              </div>
              <button onClick={() => setShowEditModal(false)}
                style={{ background: '#f1f5f9', border: 'none', borderRadius: '10px', padding: '6px 12px', cursor: 'pointer', color: '#64748b', fontWeight: '600' }}>✕</button>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginBottom: '20px' }}>
              {[
                { k: 'name', label: 'Full Name *', placeholder: 'Customer name' },
                { k: 'phone', label: 'Phone', placeholder: 'Phone number' },
                { k: 'address', label: 'Address', placeholder: 'Address' },
              ].map(f => (
                <div key={f.k}>
                  <label style={{ display: 'block', fontSize: '11px', fontWeight: '700', color: '#94a3b8', textTransform: 'uppercase', marginBottom: '4px' }}>{f.label}</label>
                  <input type="text" value={editForm[f.k]} placeholder={f.placeholder}
                    onChange={e => setEditForm(p => ({ ...p, [f.k]: e.target.value }))}
                    style={inp} />
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
              <button onClick={() => setShowEditModal(false)}
                style={{ padding: '9px 18px', background: '#f1f5f9', color: '#64748b', border: 'none', borderRadius: '10px', cursor: 'pointer', fontWeight: '600' }}>Cancel</button>
              <button onClick={handleSaveEdit} disabled={saving}
                style={{ padding: '9px 22px', background: 'linear-gradient(135deg,#2563eb,#1d4ed8)', color: 'white', border: 'none', borderRadius: '10px', cursor: 'pointer', fontWeight: '700' }}>
                {saving ? 'Saving...' : '✓ Save Changes'}
              </button>
            </div>
          </div>
        </div>
      )}
      <div style={{ marginBottom: '16px' }}>
        <input type="text" placeholder="Search by name, customer no or phone…" value={search} onChange={e => setSearch(e.target.value)} style={{ ...inp, maxWidth: '400px' }} />
      </div>
      {loading ? <div style={{ padding: '60px', textAlign: 'center', color: '#94a3b8' }}>Loading...</div>
      : (
        <div style={{ background: 'white', borderRadius: '12px', boxShadow: '0 1px 3px rgba(15,23,42,0.06), 0 1px 2px rgba(15,23,42,0.04)', overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: '#f8fafc', borderBottom: '2px solid #e2e8f0' }}>
                {['Customer No','Name','Phone','Address','Outstanding',''].map(h => (
                  <th key={h} style={{ padding: '11px 14px', textAlign: 'left', fontSize: '11px', fontWeight: '700', color: '#94a3b8', textTransform: 'uppercase' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filteredPaged.map((c, i) => (
                <tr key={c.id} style={{ borderBottom: '1px solid #f1f5f9', background: c.credit_balance > 0 ? '#fff5f5' : i % 2 === 0 ? 'white' : '#fafafa', cursor: 'pointer' }}
                  onMouseEnter={e => e.currentTarget.style.background = '#f5f3ff'}
                  onMouseLeave={e => e.currentTarget.style.background = c.credit_balance > 0 ? '#fff5f5' : i % 2 === 0 ? 'white' : '#fafafa'}
                  onClick={() => openCustomer(c)}>
                  <td style={{ padding: '11px 14px', fontWeight: '700', color: '#2563eb', fontSize: '13px' }}>{c.customer_no}</td>
                  <td style={{ padding: '11px 14px', fontWeight: '600', color: '#0f172a' }}>{c.name}</td>
                  <td style={{ padding: '11px 14px', color: '#64748b' }}>{c.phone || '—'}</td>
                  <td style={{ padding: '11px 14px', color: '#64748b', maxWidth: '160px' }}><div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.address || '—'}</div></td>
                  <td style={{ padding: '11px 14px', fontWeight: '800', color: c.credit_balance > 0.01 ? '#e11d48' : c.credit_balance < -0.01 ? '#059669' : '#94a3b8' }}>
                    {c.credit_balance > 0.01
                      ? formatCurrency(c.credit_balance)
                      : c.credit_balance < -0.01
                      ? <span style={{ color: '#059669' }}>{formatCurrency(Math.abs(c.credit_balance))} CR</span>
                      : Math.abs(c.credit_balance) < 0.01 && (c.credit_balance !== null && c.credit_balance !== undefined) && c.credit_balance === 0
                      ? '✓ Clear'
                      : '—'}
                  </td>
                  <td style={{ padding: '11px 14px', fontSize: '12px', color: '#2563eb', fontWeight: '600' }}>View →</td>
                  {isSuperAdmin && (
                    <td style={{ padding: '8px 14px' }} onClick={e => e.stopPropagation()}>
                      <div style={{ display: 'flex', gap: '6px' }}>
                        <button
                          onClick={e => openEditCustomer(c, e)}
                          title="Edit customer"
                          style={{ padding: '4px 10px', background: '#eef2ff', color: '#1e40af', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '12px', fontWeight: '700' }}>
                          ✏️
                        </button>
                        <button
                          onClick={e => handleDeleteCustomer(c, e)}
                          disabled={(c.credit_balance || 0) !== 0}
                          title={(c.credit_balance || 0) !== 0 ? 'Balance must be 0 to delete' : 'Delete customer'}
                          style={{ padding: '4px 10px', background: (c.credit_balance || 0) !== 0 ? '#f1f5f9' : '#fee2e2', color: (c.credit_balance || 0) !== 0 ? '#cbd5e1' : '#dc2626', border: 'none', borderRadius: '6px', cursor: (c.credit_balance || 0) !== 0 ? 'not-allowed' : 'pointer', fontSize: '12px', fontWeight: '700' }}>
                          🗑
                        </button>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
          {totalPages > 1 && (
            <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '8px', padding: '16px', borderTop: '1px solid #f1f5f9' }}>
              <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
                style={{ padding: '6px 14px', background: page === 1 ? '#f1f5f9' : 'white', color: page === 1 ? '#cbd5e1' : '#475569', border: '1.5px solid #e2e8f0', borderRadius: '7px', cursor: page === 1 ? 'not-allowed' : 'pointer', fontWeight: '600', fontSize: '13px' }}>← Prev</button>
              <span style={{ fontSize: '13px', color: '#64748b', fontWeight: '600' }}>Page {page} of {totalPages} ({filtered.length} total)</span>
              <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}
                style={{ padding: '6px 14px', background: page === totalPages ? '#f1f5f9' : 'white', color: page === totalPages ? '#cbd5e1' : '#475569', border: '1.5px solid #e2e8f0', borderRadius: '7px', cursor: page === totalPages ? 'not-allowed' : 'pointer', fontWeight: '600', fontSize: '13px' }}>Next →</button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
