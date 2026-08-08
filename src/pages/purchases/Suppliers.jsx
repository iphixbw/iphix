import { useState, useEffect } from 'react'
import { supabase } from '../../supabase'
import { formatCurrency } from '../../lib/helpers'
import { recordBankMovement, fetchBankAccounts } from '../../lib/bank'
import { sendSMS, smsTemplates } from '../../lib/sms'
import toast from 'react-hot-toast'

async function generateSupplierNo() {
  try {
    const { data, error } = await supabase.rpc('generate_supplier_no')
    if (error) throw error
    return data
  } catch {
    // Fallback: generate from timestamp
    const { data } = await supabase.from('suppliers').select('supplier_no').order('created_at', { ascending: false }).limit(1).single()
    const last = data?.supplier_no ? parseInt(data.supplier_no.replace(/\D/g, '')) || 0 : 0
    return `SUP-${String(last + 1).padStart(4, '0')}`
  }
}

export default function Suppliers({ isSuperAdmin }) {
  const [suppliers, setSuppliers] = useState([])
  const [loading, setLoading] = useState(true)
  const PAGE_SIZE = 50
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [saving, setSaving] = useState(false)
  const [editSupplier, setEditSupplier] = useState(null)
  const [form, setForm] = useState({ name: '', phone: '', address: '' })

  // Drill-down
  const [selectedSupplier, setSelectedSupplier] = useState(null)
  const [supplierPurchases, setSupplierPurchases] = useState([])
  const [supplierReturns, setSupplierReturns] = useState([])
  const [supplierBankTx, setSupplierBankTx] = useState([]) // direct payments (opening balance)
  const [purchasesLoading, setPurchasesLoading] = useState(false)
  const [detailTab, setDetailTab] = useState('purchases')
  const [viewingPurchase, setViewingPurchase] = useState(null)
  const [viewPurchaseItems, setViewPurchaseItems] = useState([])
  const [viewingPurchaseReturn, setViewingPurchaseReturn] = useState(null)
  const [viewPurchaseReturnItems, setViewPurchaseReturnItems] = useState([])
  const [linkingReturnId, setLinkingReturnId] = useState(null)

  // FIFO payment
  const [showPayModal, setShowPayModal] = useState(false)
  const [payAmount, setPayAmount] = useState('')
  const [payMethod, setPayMethod] = useState('cash')
  const [bankAccounts, setBankAccounts] = useState([])
  const [bankAccountId, setBankAccountId] = useState('')
  const [chequeNo, setChequeNo] = useState('')
  const [chequeDate, setChequeDate] = useState('')
  const [payNotes, setPayNotes] = useState('')

  useEffect(() => { fetchSuppliers() }, [])

  async function fetchSuppliers() {
    setLoading(true)
    const banks = await fetchBankAccounts()
    setBankAccounts(banks)
    const { data, error } = await supabase.from('suppliers').select('*').order('name')
    if (error) toast.error('Failed to load suppliers')
    else setSuppliers(data || [])
    setLoading(false)
  }

  async function openSupplier(sup) {
    setSelectedSupplier(sup)
    setDetailTab('purchases')
    setPurchasesLoading(true)
    const [{ data: purchases }, { data: returns }, { data: bankTx }] = await Promise.all([
      supabase.from('purchases').select('*, purchase_payments(*), shops(name)').eq('supplier_id', sup.id).eq('status', 'confirmed').order('created_at', { ascending: true }),
      supabase.from('purchase_returns').select('*').eq('supplier_id', sup.id).eq('status', 'confirmed').order('created_at', { ascending: true }),
      supabase.from('bank_transactions').select('*').ilike('reference', `%${sup.name}%`).in('type', ['withdrawal', 'cheque_out']).order('created_at', { ascending: true }),
    ])
    setSupplierPurchases(purchases || [])
    setSupplierReturns(returns || [])
    setSupplierBankTx(bankTx || [])

    // Re-read fresh balance from DB — never recompute here so opening balances are preserved
    const { data: fresh } = await supabase.from('suppliers').select('outstanding_balance, opening_balance').eq('id', sup.id).single()
    setSelectedSupplier(s => ({ ...s, outstanding_balance: fresh?.outstanding_balance ?? sup.outstanding_balance, opening_balance: fresh?.opening_balance ?? sup.opening_balance ?? 0 }))
    setPurchasesLoading(false)
  }

  function getRemainingBalance(p) {
    const returnsByPurchase = {}
    supplierReturns.filter(r => r.payment_method === 'credit').forEach(r => {
      if (r.purchase_id) returnsByPurchase[r.purchase_id] = (returnsByPurchase[r.purchase_id] || 0) + (r.total || 0)
    })
    // credit_amount already accounts for amount_paid AND stored supplier credit consumed
    // at creation time (see NewPurchase.jsx) — total alone has no way to know about that,
    // which was the exact bug already found and fixed on the customer side.
    const paid = (p.purchase_payments || []).filter(pp => pp.cheque_status !== 'returned').reduce((s, pp) => s + pp.amount, 0)
    const pRet = returnsByPurchase[p.id] || 0
    return Math.max(0, (p.credit_amount ?? p.total ?? 0) - pRet - paid)
  }

  function computePayPlan(amount) {
    let rem = parseFloat(amount) || 0
    const plan = []
    const returnsByPurchase = {}
    supplierReturns.filter(r => r.payment_method === 'credit').forEach(r => {
      if (r.purchase_id) returnsByPurchase[r.purchase_id] = (returnsByPurchase[r.purchase_id] || 0) + (r.total || 0)
    })
    // Same floating-credit distribution as the Purchases tab display (see its comment) —
    // any supplier-level credit not tied to a specific purchase's credit_amount is applied
    // FIFO to the oldest unpaid purchases first, so what's offered to settle here matches
    // what's actually owed on each purchase, not an inflated per-purchase figure.
    const rawDuesForPlan = supplierPurchases.map(p => {
      const paid = (p.purchase_payments || []).filter(pp => pp.cheque_status !== 'returned').reduce((s, pp) => s + pp.amount, 0)
      const pRet = returnsByPurchase[p.id] || 0
      return Math.max(0, (p.credit_amount ?? p.total ?? 0) - pRet - paid)
    })
    const sumRawDueForPlan = rawDuesForPlan.reduce((s, d) => s + d, 0)
    let floatingCreditForPlan = Math.max(0, sumRawDueForPlan - Math.max(0, selectedSupplier?.outstanding_balance || 0))
    supplierPurchases.forEach((p, i) => {
      const raw = rawDuesForPlan[i]
      const absorbed = Math.min(raw, floatingCreditForPlan)
      floatingCreditForPlan -= absorbed
      const due = raw - absorbed
      if (due <= 0 || rem <= 0) return
      const settle = Math.min(due, rem)
      plan.push({ p, due, settle, cleared: settle >= due - 0.01 })
      rem -= settle
    })
    return plan
  }

  async function handleFIFOPayment() {
    const amt = parseFloat(payAmount)
    if (!amt || amt <= 0) return toast.error('Enter a valid amount')
    if (payMethod === 'bank_transfer' && !bankAccountId) return toast.error('Select a bank account')
    if (payMethod === 'cheque' && !bankAccountId) return toast.error('Select a bank account for the cheque')
    if (payMethod === 'card' && !bankAccountId) return toast.error('Select a bank account for the card payment')
    if (payMethod === 'cheque' && !chequeDate) return toast.error('Enter cheque date')
    const plan = computePayPlan(amt)
    if (!plan.length) {
      // No purchase records — direct opening balance reduction
      if ((selectedSupplier.outstanding_balance || 0) <= 0) return toast.error('No outstanding balance')
      setSaving(true)
      try {
        const reduction = Math.min(amt, selectedSupplier.outstanding_balance)

        // Reduce supplier outstanding balance
        const newOutstanding = Math.max(0, (selectedSupplier.outstanding_balance || 0) - reduction)
        // Also set opening_balance if not yet recorded
        const openingUpdate = (selectedSupplier.opening_balance || 0) === 0
          ? { outstanding_balance: newOutstanding, opening_balance: selectedSupplier.outstanding_balance || 0 }
          : { outstanding_balance: newOutstanding }
        await supabase.from('suppliers').update(openingUpdate).eq('id', selectedSupplier.id)

        // Record the payment movement — same logic as FIFO path
        if (payMethod === 'bank_transfer' && bankAccountId) {
          const { data: acc } = await supabase.from('bank_accounts').select('balance').eq('id', bankAccountId).single()
          await supabase.from('bank_accounts').update({ balance: (acc?.balance || 0) - reduction }).eq('id', bankAccountId)
          await supabase.from('bank_transactions').insert({
            bank_account_id: bankAccountId, type: 'withdrawal', amount: reduction,
            reference: `Supplier: ${selectedSupplier.name}`,
            notes: `Opening balance payment · Bank Transfer${payNotes ? ` · ${payNotes}` : ''}`,
          })
        } else if (payMethod === 'cheque' && bankAccountId) {
          await supabase.from('bank_transactions').insert({
            bank_account_id: bankAccountId, type: 'cheque_out', amount: reduction,
            cheque_no: chequeNo || null, cheque_date: chequeDate, cheque_status: 'pending',
            reference: `Supplier: ${selectedSupplier.name}`,
            notes: `Opening balance payment${chequeNo ? ` · Cheque #${chequeNo}` : ''}${payNotes ? ` · ${payNotes}` : ''}`,
          })
        }
        // Card: deduct from card machine's linked bank account
        if (payMethod === 'card' && bankAccountId) {
          const { data: acc } = await supabase.from('bank_accounts').select('balance').eq('id', bankAccountId).single()
          await supabase.from('bank_accounts').update({ balance: (acc?.balance || 0) - reduction }).eq('id', bankAccountId)
          await supabase.from('bank_transactions').insert({
            bank_account_id: bankAccountId, type: 'withdrawal', amount: reduction,
            reference: `Supplier: ${selectedSupplier.name}`,
            notes: `Opening balance payment · Card${payNotes ? ` · ${payNotes}` : ''}`,
          })
        }
        // Cash: no bank entry needed

        toast.success(`${formatCurrency(reduction)} paid to ${selectedSupplier.name}`)
        setShowPayModal(false)
        setPayAmount(''); setPayNotes(''); setBankAccountId(''); setChequeNo(''); setChequeDate('')
        openSupplier(selectedSupplier)
        fetchSuppliers()
      } catch (e) { toast.error('Failed: ' + e.message) }
      setSaving(false)
      return
    }
    setSaving(true)
    try {
      let applied = 0
      const createdPaymentIds = []
      const failedPurchases = []
      const paymentRef = `PAY-${Date.now()}`
      for (const { p, settle } of plan) {
        const { data: pp, error: ppError } = await supabase.from('purchase_payments').insert({
          purchase_id: p.id, amount: settle, payment_method: payMethod,
          bank_account_id: (payMethod === 'bank_transfer' || payMethod === 'cheque' || payMethod === 'card') ? bankAccountId : null,
          cheque_no: payMethod === 'cheque' ? chequeNo || null : null,
          cheque_date: payMethod === 'cheque' ? chequeDate : null,
          cheque_status: payMethod === 'cheque' ? 'pending' : null,
          notes: `${payNotes || 'Supplier payment'} · Ref: ${paymentRef}`,
        }).select().single()
        // Only count money as applied if the record of it actually saved — previously
        // this counted `settle` unconditionally even when the insert failed, so the
        // supplier's balance got reduced by the full payment amount while some of the
        // underlying purchase_payments rows silently never existed, leaving no audit
        // trail for that portion of the money.
        if (ppError || !pp) {
          failedPurchases.push(p.purchase_no || p.id)
          continue
        }
        createdPaymentIds.push(pp.id)
        applied += settle
      }
      if (failedPurchases.length > 0) {
        // Roll back whatever DID succeed, so a failure leaves nothing half-written
        // behind rather than a purchase_payments row with no matching balance change.
        if (createdPaymentIds.length > 0) {
          await supabase.from('purchase_payments').delete().in('id', createdPaymentIds)
        }
        throw new Error(`Failed to record payment for: ${failedPurchases.join(', ')}. Nothing was saved — please try again.`)
      }

      // If amt > applied (overpayment beyond outstanding purchases), the remainder
      // becomes supplier credit (we've paid them more than we owe). Regardless of
      // payment method, it's still the SAME single payment — recording it as two
      // separate transactions (one for the applied portion, one for the "remainder")
      // showed the user a broken, split view of one real payment instead of the true
      // amount actually paid. Every method now records the full amt as one entry.
      const remainder = amt - applied

      // Reduce outstanding_balance by the FULL amount paid (applied + remainder) —
      // previously only `applied` was deducted, so any overpayment beyond what was
      // owed was silently discarded with no record and no credit to the supplier.
      await supabase.rpc('adjust_supplier_balance', { p_supplier_id: selectedSupplier.id, p_delta: -amt })
      const { data: freshSup } = await supabase.from('suppliers').select('outstanding_balance, opening_balance').eq('id', selectedSupplier.id).single()
      const newOutstanding = freshSup?.outstanding_balance ?? 0

      if (payMethod === 'cash') {
        // Cash payment to supplier — recorded in purchase_payments only for the applied
        // portion (matches the existing convention: cash isn't tracked in the bank
        // ledger). But an overpayment remainder is real money handed over that isn't
        // tied to a specific purchase — record just that excess for traceability,
        // matching the equivalent fix on the customer side.
        if (remainder > 0.009) {
          await supabase.from('bank_transactions').insert({
            bank_account_id: null, type: 'withdrawal', amount: remainder,
            reference: `Supplier: ${selectedSupplier.name}`,
            notes: `Opening balance payment · Remainder of ${formatCurrency(amt)} cash payment · Ref: ${paymentRef}${payNotes ? ` · ${payNotes}` : ''}`,
          })
        }
        // Do NOT insert into expenses table (would double-count in cashflow)
      } else if (payMethod === 'bank_transfer' && bankAccountId) {
        // Bank transfer to supplier — deducts bank balance, does NOT add to cash in hand.
        // Full amt recorded as one single withdrawal, linked to every purchase_payments
        // row created above (mirrors the cheque branch, and the customer-side fix).
        const { data: acc } = await supabase.from('bank_accounts').select('balance').eq('id', bankAccountId).single()
        await supabase.from('bank_accounts').update({ balance: Math.max(0, (acc?.balance || 0) - amt) }).eq('id', bankAccountId)
        const { data: btx } = await supabase.from('bank_transactions').insert({
          bank_account_id: bankAccountId, type: 'withdrawal', amount: amt,
          reference: `Supplier: ${selectedSupplier.name}`,
          notes: `Supplier payment · Bank Transfer${remainder > 0.009 ? ` · Includes ${formatCurrency(remainder)} credit` : ''}`,
          purchase_payment_id: createdPaymentIds[0] || null,
        }).select().single()
        if (btx && createdPaymentIds.length > 0) {
          await supabase.from('purchase_payments').update({ bank_transaction_id: btx.id }).in('id', createdPaymentIds)
        }
      } else if (payMethod === 'cheque' && bankAccountId) {
        // Cheque payment — record the FULL cheque amount as one single cheque_out row,
        // linked to EVERY purchase_payments row created above (a cheque split across
        // multiple purchases via FIFO produces one row per purchase — all must link
        // to this same bank_transactions row, or a later return can only reach
        // whichever row is linked, leaving siblings incorrectly still "paid").
        const { data: btx } = await supabase.from('bank_transactions').insert({
          bank_account_id: bankAccountId,
          type: 'cheque_out',
          amount: amt,
          cheque_no: chequeNo || null,
          cheque_date: chequeDate,
          cheque_status: 'pending',
          reference: `Supplier: ${selectedSupplier.name}`,
          notes: `Payable payment${chequeNo ? ` · Cheque #${chequeNo}` : ''}${remainder > 0.009 ? ` · Includes ${formatCurrency(remainder)} credit` : ''}`,
          purchase_payment_id: createdPaymentIds[0] || null,
        }).select().single()
        if (btx && createdPaymentIds.length > 0) {
          await supabase.from('purchase_payments').update({ bank_transaction_id: btx.id }).in('id', createdPaymentIds)
        }
      } else if (payMethod === 'card' && bankAccountId) {
        // Card payment — deduct from linked bank account, full amt as one entry, linked
        // to every purchase_payments row created above.
        const { data: acc } = await supabase.from('bank_accounts').select('balance').eq('id', bankAccountId).single()
        await supabase.from('bank_accounts').update({ balance: Math.max(0, (acc?.balance || 0) - amt) }).eq('id', bankAccountId)
        const { data: btx } = await supabase.from('bank_transactions').insert({
          bank_account_id: bankAccountId, type: 'withdrawal', amount: amt,
          reference: `Supplier: ${selectedSupplier.name}`,
          notes: `Supplier payment · Card${remainder > 0.009 ? ` · Includes ${formatCurrency(remainder)} credit` : ''}`,
          purchase_payment_id: createdPaymentIds[0] || null,
        }).select().single()
        if (btx && createdPaymentIds.length > 0) {
          await supabase.from('purchase_payments').update({ bank_transaction_id: btx.id }).in('id', createdPaymentIds)
        }
      }

      toast.success(remainder > 0.009
        ? `${formatCurrency(applied)} applied across ${plan.length} purchase(s) — ${formatCurrency(remainder)} credited to supplier`
        : `${formatCurrency(applied)} applied across ${plan.length} purchase(s)`)
      setShowPayModal(false)
      setPayAmount(''); setPayNotes(''); setBankAccountId(''); setChequeNo(''); setChequeDate('')
      // Send SMS to supplier
      if (selectedSupplier.phone) {
        const msg = smsTemplates.supplierPaymentMade(
          selectedSupplier.name, applied, Math.max(0, newOutstanding),
          activeShop?.name || 'Phonefix'
        )
        sendSMS({ to: selectedSupplier.phone, message: msg, triggeredBy: 'supplier_payment', referenceType: 'supplier', referenceId: selectedSupplier.id })
          .then(({ success }) => { if (success) toast.success('SMS sent to supplier') })
      }
      openSupplier(selectedSupplier)
      fetchSuppliers()
    } catch (e) { toast.error('Error: ' + e.message) }
    setSaving(false)
  }

  // ── Return / bounce a cheque payment made to this supplier ──────────────
  async function returnSupplierPayment(g) {
    if (g.payment_method !== 'cheque') return
    if (!window.confirm(`Mark this cheque as returned/bounced?\n\nAmount: ${formatCurrency(g.total)}\n\nThis will reverse the payment and add the amount back to the supplier's outstanding balance.`)) return
    setSaving(true)
    try {
      // Prefer the reliable bank_transaction_id link — find every purchase_payments
      // row sharing it, since a cheque split across purchases via FIFO produces one
      // row per purchase. Fall back to the old time+cheque_no heuristic only when
      // no link exists (older records created before this linking was added).
      let linkedPaymentIds = []
      if (g.bank_transaction_id) {
        const { data: siblingPayments } = await supabase
          .from('purchase_payments').select('id').eq('bank_transaction_id', g.bank_transaction_id)
        linkedPaymentIds = (siblingPayments || []).map(p => p.id)
      }
      if (linkedPaymentIds.length === 0) {
        const groupTime = new Date(g.created_at).getTime()
        const relatedPurchases = supplierPurchases.filter(p =>
          (p.purchase_payments || []).some(pp =>
            Math.abs(new Date(pp.created_at).getTime() - groupTime) < 5000 &&
            pp.payment_method === 'cheque' && pp.cheque_status !== 'returned' &&
            (g.cheque_no ? pp.cheque_no === g.cheque_no : true)
          )
        )
        for (const p of relatedPurchases) {
          const pps = (p.purchase_payments || []).filter(pp =>
            Math.abs(new Date(pp.created_at).getTime() - groupTime) < 5000 &&
            pp.payment_method === 'cheque' && pp.cheque_status !== 'returned' &&
            (g.cheque_no ? pp.cheque_no === g.cheque_no : true)
          )
          linkedPaymentIds.push(...pps.map(pp => pp.id))
        }
      }
      if (linkedPaymentIds.length > 0) {
        await supabase.from('purchase_payments').update({
          cheque_status: 'returned',
          returned_at: new Date().toISOString(),
          notes: ((g.notes || '') + ' [RETURNED]').trim(),
        }).in('id', linkedPaymentIds)
      }
      // Keep the linked bank_transactions row in sync, so it shows as returned
      // in Bank.jsx too, not just here.
      if (g.bank_transaction_id) {
        const { data: btx } = await supabase.from('bank_transactions').select('notes').eq('id', g.bank_transaction_id).single()
        await supabase.from('bank_transactions').update({
          cheque_status: 'presented',
          notes: ((btx?.notes || '') + ' [RETURNED]').trim(),
        }).eq('id', g.bank_transaction_id)
      }
      // Add the amount back to the supplier's outstanding balance
      await supabase.rpc('adjust_supplier_balance', { p_supplier_id: selectedSupplier.id, p_delta: g.total })
      toast.success(`Cheque returned — ${formatCurrency(g.total)} added back to ${selectedSupplier.name}'s outstanding balance`)
      openSupplier(selectedSupplier)
      fetchSuppliers()
    } catch (e) {
      toast.error('Failed: ' + e.message)
    }
    setSaving(false)
  }

  function openNew() {
    setSelectedSupplier(null)  // Exit detail view if open
    setSupplierPurchases([])
    setEditSupplier(null)
    setForm({ name: '', phone: '', address: '' })
    setShowForm(true)
  }

  function openEdit(supplier) {
    setEditSupplier(supplier)
    setForm({ name: supplier.name, phone: supplier.phone || '', address: supplier.address || '' })
    setShowForm(true)
  }

  async function linkReturnToPurchase(returnId, purchaseId) {
    try {
      await supabase.from('purchase_returns').update({ purchase_id: purchaseId }).eq('id', returnId)
      toast.success('Return linked to purchase!')
      setLinkingReturnId(null)
      openSupplier(selectedSupplier)
    } catch (e) { toast.error('Failed: ' + e.message) }
  }

  async function printPurchaseReturn(ret, items) {
    // Fetch the supplier's current outstanding balance fresh at print time, so it
    // reflects this return's adjustment even if the on-screen data hasn't been refetched.
    let supplierBalance = null
    if (ret.supplier_id) {
      const { data: sup } = await supabase.from('suppliers').select('outstanding_balance').eq('id', ret.supplier_id).single()
      supplierBalance = sup?.outstanding_balance ?? null
    }
    const linkedPurchase = supplierPurchases.find(p => p.id === ret.purchase_id)
    const w = window.open('', '_blank')
    const fmt = n => parseFloat(n||0).toLocaleString('en-LK', { minimumFractionDigits: 2 })
    const dateStr = new Date(ret.created_at).toLocaleDateString('en-GB', { day:'2-digit', month:'2-digit', year:'numeric' })
    const timeStr = new Date(ret.created_at).toLocaleTimeString('en-GB', { hour:'2-digit', minute:'2-digit', second:'2-digit' })
    w.document.write(`<!DOCTYPE html><html><head><title>Return ${ret.return_no}</title>
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
    <div class="row"><span>RETURN NO :</span><span>${ret.return_no || 'RET'}</span></div>
    <div class="row"><span>SUPPLIER &nbsp;:</span><span>${(selectedSupplier?.name||'—').toUpperCase()}</span></div>
    ${linkedPurchase ? `<div class="row"><span>PURCHASE &nbsp;:</span><span>${linkedPurchase.purchase_no}</span></div>` : ''}
    <div class="row"><span>REFUND &nbsp;&nbsp;&nbsp;:</span><span style="text-transform:uppercase">${ret.payment_method||'credit'}</span></div>
    ${ret.remarks ? `<div class="row" style="font-size:11px"><span>REASON &nbsp;&nbsp;&nbsp;:</span><span style="max-width:40mm;text-align:right">${ret.remarks}</span></div>` : ''}
    <div class="dashed"></div>
    <div class="row b" style="font-size:11px"><span>No. Product</span><span style="display:flex;gap:8px"><span>Cost</span><span>Qty</span><span>Amount</span></span></div>
    <div class="dashed"></div>
    ${items.map((li,idx) => `<div style="font-size:12px;font-weight:bold;padding:1px 0">${idx+1}. ${li.items?.name||li.name||'—'}</div><div style="display:flex;justify-content:space-between;font-size:12px;font-weight:bold;padding:0 0 3px 8px"><span>${fmt(li.unit_cost)} *${li.quantity}</span><span>${fmt((li.line_total||li.quantity*li.unit_cost))}</span></div>`).join('')}
    <div class="dashed"></div>
    <div class="row"><span>GROSS TOTAL :</span><span>${fmt(ret.total || ret.subtotal || 0)}</span></div>
    <div class="solid"></div>
    <div class="tot"><span>TOTAL :</span><span>${fmt(ret.total || ret.subtotal || 0)}</span></div>
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

  async function handleSave() {
    if (!form.name.trim()) return toast.error('Supplier name is required')
    setSaving(true)
    try {
      if (editSupplier) {
        const { error } = await supabase.from('suppliers').update({ name: form.name, phone: form.phone, address: form.address }).eq('id', editSupplier.id)
        if (error) throw error
        toast.success('Supplier updated!')
      } else {
        const supplier_no = await generateSupplierNo()
        const { data: newSup, error } = await supabase.from('suppliers').insert({
          supplier_no, name: form.name, phone: form.phone || null, address: form.address || null
        }).select().single()
        if (error) throw error
        // Immediately add to local state so it appears in list without full refetch
        if (newSup) setSuppliers(prev => [...prev, newSup].sort((a, b) => a.name.localeCompare(b.name)))
        toast.success('Supplier added!')
      }
      setShowForm(false); setEditSupplier(null)
      fetchSuppliers() // Also refetch to confirm
    } catch (e) { toast.error('Failed: ' + e.message) }
    setSaving(false)
  }

  async function handleDeleteSupplier(s, e) {
    e.stopPropagation()
    if ((s.outstanding_balance || 0) !== 0) {
      toast.error(`Cannot delete "${s.name}": outstanding balance must be 0. Current: ${formatCurrency(s.outstanding_balance)}`)
      return
    }
    if (!window.confirm(`Delete supplier "${s.name}" (${s.supplier_no})? Their past purchases will be kept but the supplier record will be removed.`)) return
    const { error } = await supabase.from('suppliers').delete().eq('id', s.id)
    if (error) {
      if (error.code === '23503') toast.error('Cannot delete: supplier has linked records that prevent deletion.')
      else toast.error('Failed to delete: ' + error.message)
      return
    }
    toast.success(`Supplier "${s.name}" deleted`)
    fetchData()
  }

  const filtered = suppliers.filter(s =>
    s.name.toLowerCase().includes(search.toLowerCase()) ||
    s.supplier_no?.toLowerCase().includes(search.toLowerCase()) ||
    (s.phone && s.phone.includes(search))
  )
  const filteredPaged = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)
  const totalPages = Math.ceil(filtered.length / PAGE_SIZE)

  const inp = { width: '100%', padding: '9px 12px', border: '1.5px solid #e2e8f0', borderRadius: '7px', fontSize: '14px', boxSizing: 'border-box', outline: 'none', background: 'white' }
  const lbl = { display: 'block', marginBottom: '5px', fontSize: '11px', fontWeight: '700', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.06em' }
  const previewPlan = payAmount ? computePayPlan(payAmount) : []

  // ── SUPPLIER DETAIL VIEW ──
  if (selectedSupplier) {
    const totalBilled = supplierPurchases.reduce((s, p) => s + (p.total || 0), 0)
    // Total Paid = real money paid — amount_paid at creation plus every non-returned
    // purchase_payments row, plus any stored supplier credit consumed at a purchase's
    // creation time (a real settlement even though no new money changed hands). A
    // returned cheque never actually paid anything.
    const totalPaidAll = supplierPurchases.reduce((s, p) =>
      s + (p.amount_paid || 0)
        + (p.purchase_payments || []).filter(pp => pp.cheque_status !== 'returned').reduce((pp, pay) => pp + pay.amount, 0)
        + Math.max(0, (p.total || 0) - (p.amount_paid || 0) - (p.credit_amount ?? p.total ?? 0)), 0)
    const totalReturns = supplierReturns.reduce((s, r) => s + (r.total || 0), 0)

    // Build returns map per purchase — ALL returns (for display in tabs/modals)
    const returnsByPurchase = {}
    supplierReturns.forEach(r => {
      const key = r.purchase_id || '__unlinked__'
      if (!returnsByPurchase[key]) returnsByPurchase[key] = []
      returnsByPurchase[key].push(r)
    })

    // Balance-only map — ONLY credit returns affect the outstanding payable
    const creditRetsByPurchase = {}
    supplierReturns.filter(r => r.payment_method === 'credit').forEach(r => {
      const key = r.purchase_id || '__unlinked__'
      if (!creditRetsByPurchase[key]) creditRetsByPurchase[key] = []
      creditRetsByPurchase[key].push(r)
    })

    // Outstanding purchases — only credit returns reduce what's owed
    const outstandingPurchases = supplierPurchases.filter(p => {
      const paid = (p.purchase_payments || []).filter(pp => pp.cheque_status !== 'returned').reduce((s, pp) => s + pp.amount, 0)
      const pRets = (creditRetsByPurchase[p.id] || []).reduce((s, r) => s + (r.total || 0), 0)
      return Math.max(0, (p.credit_amount ?? p.total ?? 0) - pRets - paid) > 0
    })

    // Use stored outstanding_balance as authoritative — includes opening balance
    const liveClosingBalance = selectedSupplier.outstanding_balance || 0

    // Use stored opening_balance column — set once in Opening Balances, never recalculated
    const openingBalance = selectedSupplier.opening_balance || 0

    return (
      <div>
        {/* FIFO Pay Modal */}
        {showPayModal && (
          <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <div style={{ background: 'white', borderRadius: '16px', padding: '28px', width: '520px', maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 20px 60px rgba(0,0,0,0.3)' }}>
              <h2 style={{ fontSize: '17px', fontWeight: '700', color: '#0f172a', margin: '0 0 4px' }}>Pay Supplier</h2>
              <p style={{ fontSize: '13px', color: '#64748b', margin: '0 0 18px' }}>
                {selectedSupplier.name} · Outstanding: <strong style={{ color: '#e11d48' }}>{formatCurrency(Math.max(0, selectedSupplier.outstanding_balance || 0))}</strong>
              </p>
              <div style={{ marginBottom: '14px' }}>
                <label style={lbl}>Amount (LKR) *</label>
                <input type="number" value={payAmount} onChange={e => setPayAmount(e.target.value)} onFocus={e => e.target.select()} placeholder="0.00" autoComplete="off" style={{ ...inp, fontSize: '22px', fontWeight: '800' }} autoFocus />
              </div>
              <div style={{ marginBottom: '14px' }}>
                <label style={lbl}>Payment Method</label>
                <div style={{ display: 'flex', gap: '8px' }}>
                  {['cash','bank_transfer','card','cheque'].map(m => (
                    <button key={m} onClick={() => { setPayMethod(m); setBankAccountId(''); setChequeNo(''); setChequeDate('') }}
                      style={{ flex: 1, padding: '7px 4px', borderRadius: '7px', border: `2px solid ${payMethod === m ? '#2563eb' : '#e2e8f0'}`, background: payMethod === m ? '#eef2ff' : 'white', cursor: 'pointer', fontSize: '11px', fontWeight: '700', color: payMethod === m ? '#1e40af' : '#64748b' }}>
                      {m === 'cash' ? '💵 Cash' : m === 'bank_transfer' ? '🏦 Bank' : m === 'card' ? '💳 Card' : '🧾 Cheque'}
                    </button>
                  ))}
                </div>
              </div>

              {/* Cash — note */}
              {payMethod === 'cash' && (
                <div style={{ marginBottom: '14px', padding: '10px 12px', background: '#f0fdf4', borderRadius: '10px', border: '1px solid #bbf7d0', fontSize: '13px', color: '#166534' }}>
                  💵 Payment will be recorded as a cash expense in cashflow
                </div>
              )}

              {/* Bank transfer — account selector */}
              {payMethod === 'bank_transfer' && (
                <div style={{ marginBottom: '14px' }}>
                  <label style={lbl}>Bank Account * (deducted from)</label>
                  <select value={bankAccountId} onChange={e => setBankAccountId(e.target.value)} style={{ ...inp, borderColor: !bankAccountId ? '#fca5a5' : '#e2e8f0' }}>
                    <option value="">— Select account —</option>
                    {bankAccounts.map(b => <option key={b.id} value={b.id}>{b.name} — {b.bank_name} (LKR {(b.balance||0).toLocaleString('en-LK',{minimumFractionDigits:2})})</option>)}
                  </select>
                </div>
              )}

              {/* Card — account selector (same field, reused for card since Suppliers.jsx
                  has one shared bankAccountId, unlike the customer side's separate
                  cardBankAccountId) */}
              {payMethod === 'card' && (
                <div style={{ marginBottom: '14px' }}>
                  <label style={lbl}>Bank Account * (deducted from)</label>
                  <select value={bankAccountId} onChange={e => setBankAccountId(e.target.value)} style={{ ...inp, borderColor: !bankAccountId ? '#fca5a5' : '#e2e8f0' }}>
                    <option value="">— Select account —</option>
                    {bankAccounts.map(b => <option key={b.id} value={b.id}>{b.name} — {b.bank_name} (LKR {(b.balance||0).toLocaleString('en-LK',{minimumFractionDigits:2})})</option>)}
                  </select>
                </div>
              )}

              {/* Cheque — bank account + cheque details */}
              {payMethod === 'cheque' && (
                <div style={{ marginBottom: '14px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                  <div style={{ gridColumn: '1/-1' }}>
                    <label style={lbl}>Bank Account * (cheque drawn from)</label>
                    <select value={bankAccountId} onChange={e => setBankAccountId(e.target.value)} style={{ ...inp, borderColor: !bankAccountId ? '#fca5a5' : '#e2e8f0' }}>
                      <option value="">— Select account —</option>
                      {bankAccounts.map(b => <option key={b.id} value={b.id}>{b.name} — {b.bank_name} (LKR {(b.balance||0).toLocaleString('en-LK',{minimumFractionDigits:2})})</option>)}
                    </select>
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
                      📤 Will appear in Bank → Unrealized Cheques Out until presented
                    </div>
                  )}
                </div>
              )}

              <div style={{ marginBottom: '16px' }}>
                <label style={lbl}>Notes</label>
                <input type="text" value={payNotes} onChange={e => setPayNotes(e.target.value)} placeholder="Optional" style={inp} />
              </div>
              {previewPlan.length === 0 && payAmount && (selectedSupplier?.outstanding_balance || 0) > 0 && (
                <div style={{ background: '#f5f3ff', border: '1px solid #c4b5fd', borderRadius: '10px', padding: '10px 14px', marginBottom: '12px', fontSize: '13px', color: '#5b21b6' }}>
                  💜 This will reduce the opening balance by {formatCurrency(Math.min(parseFloat(payAmount) || 0, selectedSupplier?.outstanding_balance || 0))}
                </div>
              )}
              {previewPlan.length > 0 && (
                <div style={{ background: '#fef3c7', border: '1.5px solid #fde68a', borderRadius: '10px', padding: '14px', marginBottom: '16px' }}>
                  <div style={{ fontSize: '11px', fontWeight: '700', color: '#92400e', textTransform: 'uppercase', marginBottom: '10px' }}>📋 FIFO Settlement Preview</div>
                  {previewPlan.map(({ p, due, settle, cleared }) => (
                    <div key={p.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid #fde68a', fontSize: '13px' }}>
                      <div>
                        <span style={{ fontWeight: '700', color: '#2563eb' }}>{p.purchase_no}</span>
                        <span style={{ color: '#64748b', marginLeft: '8px' }}>{new Date(p.created_at).toLocaleDateString('en-GB')}</span>
                        <span style={{ color: '#94a3b8', marginLeft: '8px', fontSize: '12px' }}>Due: {formatCurrency(due)}</span>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <div style={{ fontWeight: '700', color: '#e11d48' }}>-{formatCurrency(settle)}</div>
                        <div style={{ fontSize: '11px', fontWeight: '700', color: cleared ? '#059669' : '#e11d48' }}>{cleared ? '✓ Cleared' : `Rem: ${formatCurrency(due - settle)}`}</div>
                      </div>
                    </div>
                  ))}
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '8px', fontWeight: '800', fontSize: '14px', paddingTop: '8px', borderTop: '1px solid #fde68a' }}>
                    <span>Total Applied</span>
                    <span style={{ color: '#e11d48' }}>{formatCurrency(previewPlan.reduce((s, p) => s + p.settle, 0))}</span>
                  </div>
                  {(() => {
                    const previewApplied = previewPlan.reduce((s, p) => s + p.settle, 0)
                    const previewRemainder = (parseFloat(payAmount) || 0) - previewApplied
                    return previewRemainder > 0.009 ? (
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '6px', fontWeight: '700', fontSize: '13px', color: '#059669' }}>
                        <span>Excess → credited to supplier</span>
                        <span>{formatCurrency(previewRemainder)}</span>
                      </div>
                    ) : null
                  })()}
                </div>
              )}
              <div style={{ display: 'flex', gap: '10px' }}>
                <button onClick={() => { setShowPayModal(false); setPayAmount(''); setPayNotes(''); setBankAccountId(''); setChequeNo(''); setChequeDate(''); setPayMethod('cash') }}
                  style={{ flex: 1, padding: '11px', background: '#f1f5f9', color: '#475569', border: 'none', borderRadius: '10px', cursor: 'pointer', fontWeight: '600' }}>Cancel</button>
                <button onClick={handleFIFOPayment}
                  disabled={saving || !payAmount || (previewPlan.length === 0 && (selectedSupplier?.outstanding_balance || 0) <= 0)}
                  style={{ flex: 2, padding: '11px', background: (!payAmount || (previewPlan.length === 0 && (selectedSupplier?.outstanding_balance || 0) <= 0)) ? '#e2e8f0' : 'linear-gradient(135deg,#e11d48,#be123c)', color: (!payAmount || (previewPlan.length === 0 && (selectedSupplier?.outstanding_balance || 0) <= 0)) ? '#94a3b8' : 'white', border: 'none', borderRadius: '10px', cursor: 'pointer', fontWeight: '700', fontSize: '14px' }}>
                  {saving ? 'Processing...' : '✓ Pay Supplier (FIFO)'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Back + actions */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '20px' }}>
          <button onClick={() => { setSelectedSupplier(null); setSupplierPurchases([]) }}
            style={{ background: 'none', border: 'none', color: '#2563eb', cursor: 'pointer', fontSize: '14px', fontWeight: '600', padding: 0 }}>
            ← Back to Suppliers
          </button>
          {liveClosingBalance > 0.01 && (
            <button onClick={() => { setPayAmount(''); setPayNotes(''); setBankAccountId(''); setChequeNo(''); setChequeDate(''); setPayMethod('cash'); setShowPayModal(true) }}
              style={{ padding: '10px 20px', background: 'linear-gradient(135deg,#e11d48,#be123c)', color: 'white', border: 'none', borderRadius: '10px', cursor: 'pointer', fontWeight: '700', fontSize: '14px' }}>
              💸 Pay Supplier
            </button>
          )}
        </div>

        {/* Profile card */}
        <div style={{ background: 'white', borderRadius: '14px', padding: '24px', boxShadow: '0 1px 3px rgba(15,23,42,0.06), 0 1px 2px rgba(15,23,42,0.04)', marginBottom: '20px', display: 'grid', gridTemplateColumns: 'auto 1fr auto', gap: '20px', alignItems: 'center' }}>
          <div style={{ width: '60px', height: '60px', borderRadius: '50%', background: 'linear-gradient(135deg,#e11d48,#be123c)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontSize: '24px', fontWeight: '800' }}>
            {selectedSupplier.name[0].toUpperCase()}
          </div>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '6px' }}>
              <h1 style={{ fontSize: '20px', fontWeight: '800', color: '#0f172a', margin: 0 }}>{selectedSupplier.name}</h1>
              <span style={{ fontSize: '12px', fontWeight: '700', color: '#2563eb', background: '#eef2ff', padding: '3px 10px', borderRadius: '12px' }}>{selectedSupplier.supplier_no}</span>
            </div>
            <div style={{ display: 'flex', gap: '20px', fontSize: '13px', color: '#64748b', flexWrap: 'wrap' }}>
              {selectedSupplier.phone && <span>📞 {selectedSupplier.phone}</span>}
              {selectedSupplier.address && <span>📍 {selectedSupplier.address}</span>}
            </div>
          </div>
          {liveClosingBalance > 0.01 ? (
            <div style={{ textAlign: 'right', background: '#fff5f5', border: '1.5px solid #fecaca', borderRadius: '12px', padding: '12px 18px' }}>
              <div style={{ fontSize: '11px', fontWeight: '700', color: '#94a3b8', textTransform: 'uppercase', marginBottom: '3px' }}>Payable (DR)</div>
              <div style={{ fontSize: '22px', fontWeight: '800', color: '#e11d48' }}>{formatCurrency(liveClosingBalance)}</div>
            </div>
          ) : liveClosingBalance < -0.01 ? (
            <div style={{ textAlign: 'right', background: '#f0fdf4', border: '1.5px solid #bbf7d0', borderRadius: '12px', padding: '12px 18px' }}>
              <div style={{ fontSize: '11px', fontWeight: '700', color: '#94a3b8', textTransform: 'uppercase', marginBottom: '3px' }}>Credit (CR)</div>
              <div style={{ fontSize: '22px', fontWeight: '800', color: '#059669' }}>{formatCurrency(Math.abs(liveClosingBalance))} CR</div>
              <div style={{ fontSize: '11px', color: '#064e3b', marginTop: '2px' }}>Overpaid to supplier</div>
            </div>
          ) : (
            <div style={{ textAlign: 'right', background: '#f0fdf4', border: '1.5px solid #bbf7d0', borderRadius: '12px', padding: '12px 18px' }}>
              <div style={{ fontSize: '11px', fontWeight: '700', color: '#94a3b8', textTransform: 'uppercase', marginBottom: '3px' }}>Balance</div>
              <div style={{ fontSize: '16px', fontWeight: '800', color: '#059669' }}>✓ Clear</div>
            </div>
          )}
        </div>

        {/* Summary cards */}
        <div style={{ display: 'grid', gridTemplateColumns: `repeat(${openingBalance > 0 ? 6 : 5},1fr)`, gap: '12px', marginBottom: '20px' }}>
          {[
            { label: 'Total Purchases', value: supplierPurchases.length, color: '#1e40af' },
            { label: 'Total Billed', value: formatCurrency(totalBilled), color: '#0f172a' },
            { label: 'Total Returns', value: formatCurrency(totalReturns), color: '#d97706' },
            { label: 'Total Paid', value: formatCurrency(totalPaidAll), color: '#059669' },
            ...(openingBalance > 0 ? [{ label: 'Opening Balance', value: formatCurrency(openingBalance), color: '#7c3aed' }] : []),
            {
              label: liveClosingBalance > 0.01 ? 'Payable (DR)' : liveClosingBalance < -0.01 ? 'Credit (CR)' : 'Balance',
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

        {/* Outstanding purchases banner — deducts returns per purchase */}
        {outstandingPurchases.length > 0 && (
          <div style={{ background: '#fff5f5', border: '1.5px solid #fecaca', borderRadius: '12px', padding: '16px 20px', marginBottom: '16px' }}>
            <div style={{ fontSize: '12px', fontWeight: '700', color: '#e11d48', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '10px' }}>
              ⚠️ {outstandingPurchases.length} Outstanding Purchase{outstandingPurchases.length !== 1 ? 's' : ''}
            </div>
            <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
              {(() => {
                // Same floating-credit distribution as the Purchases tab and the payment
                // plan — keeps this banner consistent with those numbers.
                const rawDuesForBanner = supplierPurchases.map(p => {
                  const paid = (p.purchase_payments || []).filter(pp => pp.cheque_status !== 'returned').reduce((s, pp) => s + pp.amount, 0)
                  const pRets = (creditRetsByPurchase[p.id] || []).reduce((s, r) => s + (r.total || 0), 0)
                  return Math.max(0, (p.credit_amount ?? p.total ?? 0) - pRets - paid)
                })
                const sumRawDueForBanner = rawDuesForBanner.reduce((s, d) => s + d, 0)
                let floatingCreditForBanner = Math.max(0, sumRawDueForBanner - Math.max(0, liveClosingBalance))
                const bannerDues = {}
                supplierPurchases.forEach((p, i) => {
                  const raw = rawDuesForBanner[i]
                  const applied = Math.min(raw, floatingCreditForBanner)
                  floatingCreditForBanner -= applied
                  bannerDues[p.id] = raw - applied
                })
                return outstandingPurchases.map(p => {
                const pRets = (creditRetsByPurchase[p.id] || []).reduce((s, r) => s + (r.total || 0), 0)
                const due = bannerDues[p.id]
                const daysAgo = Math.floor((new Date() - new Date(p.created_at)) / (1000 * 60 * 60 * 24))
                return (
                  <div key={p.id} style={{ background: 'white', border: '1px solid #fecaca', borderRadius: '10px', padding: '10px 14px', minWidth: '160px' }}>
                    <div style={{ fontSize: '13px', fontWeight: '700', color: '#2563eb' }}>{p.purchase_no}</div>
                    <div style={{ fontSize: '11px', color: '#94a3b8', margin: '2px 0' }}>{new Date(p.created_at).toLocaleDateString('en-GB')} · {daysAgo}d ago</div>
                    {pRets > 0 && (
                      <div style={{ fontSize: '11px', color: '#d97706', marginBottom: '2px' }}>↩ Return: −{formatCurrency(pRets)}</div>
                    )}
                    <div style={{ fontSize: '15px', fontWeight: '800', color: '#e11d48' }}>{formatCurrency(due)}</div>
                  </div>
                )
                })
              })()}
            </div>
          </div>
        )}

        {/* Tabbed: Purchase History | Payment History | Activity */}
        <div style={{ background: 'white', borderRadius: '12px', boxShadow: '0 1px 3px rgba(15,23,42,0.06), 0 1px 2px rgba(15,23,42,0.04)', overflow: 'hidden' }}>
          {/* Tab bar */}
          <div style={{ display: 'flex', borderBottom: '2px solid #e2e8f0', background: '#f8fafc', flexWrap: 'wrap' }}>
            {(() => {
              // Count: initial payments + grouped subsequent payments
              const initialCount = supplierPurchases.filter(p => (p.amount_paid || 0) > 0).length
              const allPmts = supplierPurchases.flatMap(p => (p.purchase_payments || []).map(pp => ({ ...pp })))
              const groups = []
              allPmts.forEach(p => {
                const pTime = new Date(p.created_at).getTime()
                const existing = groups.find(g => Math.abs(new Date(g.created_at).getTime() - pTime) < 5000 && g.payment_method === p.payment_method)
                if (!existing) groups.push({ ...p })
              })
              return [
                { id: 'purchases', label: `Purchases (${supplierPurchases.length})` },
                { id: 'payments', label: `Payments (${initialCount + groups.length})` },
                { id: 'activity', label: 'Activity Statement' },
              ]
            })().map(tab => (
              <button key={tab.id} onClick={() => setDetailTab(tab.id)}
                style={{ padding: '12px 20px', border: 'none', background: 'none', cursor: 'pointer', fontSize: '13px', fontWeight: '700', color: detailTab === tab.id ? '#e11d48' : '#64748b', borderBottom: `3px solid ${detailTab === tab.id ? '#e11d48' : 'transparent'}`, marginBottom: '-2px' }}>
                {tab.label}
              </button>
            ))}
          </div>

          {purchasesLoading ? <div style={{ padding: '40px', textAlign: 'center', color: '#94a3b8' }}>Loading...</div>

          : detailTab === 'purchases' ? (
            supplierPurchases.length === 0 ? <div style={{ padding: '40px', textAlign: 'center', color: '#94a3b8' }}>No purchases yet</div>
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
                    const returnsByPurchase = {}
                    supplierReturns.forEach(r => {
                      const key = r.purchase_id || '__unlinked__'
                      if (!returnsByPurchase[key]) returnsByPurchase[key] = []
                      returnsByPurchase[key].push(r)
                    })
                    const rows = []
                    // Any supplier-level credit that isn't tied to a specific purchase's own
                    // credit_amount (e.g. an overpayment made via Pay Supplier, applied
                    // generally rather than at a specific purchase's creation) reduces the
                    // TRUE total owed but has no natural home in any single purchase's row —
                    // so summed per-row balances would overstate the total even though each
                    // row's own number is individually correct. Distribute it FIFO across the
                    // oldest unpaid purchases first, so every row and the total agree. Purely
                    // a display choice — no money moves, outstanding_balance is untouched.
                    // Mirrors the identical fix on the customer side (Customers.jsx).
                    const rawDues = supplierPurchases.map(p => {
                      const extraPaid = (p.purchase_payments || []).filter(pp => pp.cheque_status !== 'returned').reduce((s, pp) => s + pp.amount, 0)
                      const creditRets = (creditRetsByPurchase[p.id] || []).reduce((s, r) => s + (r.total || 0), 0)
                      return Math.max(0, (p.credit_amount ?? p.total ?? 0) - creditRets - extraPaid)
                    })
                    const sumRawDue = rawDues.reduce((s, d) => s + d, 0)
                    let floatingCredit = Math.max(0, sumRawDue - Math.max(0, liveClosingBalance))
                    const displayDues = rawDues.map(raw => {
                      const applied = Math.min(raw, floatingCredit)
                      floatingCredit -= applied
                      return raw - applied
                    })
                    supplierPurchases.forEach((p, i) => {
                      const payments = p.purchase_payments || []
                      // Paid = initial amount_paid + every non-returned purchase_payments row
                      // + any stored supplier credit that was consumed at creation time.
                      // That credit consumption is derived (total - amount_paid - credit_amount),
                      // since there's no dedicated column recording it directly — credit_amount
                      // already reflects it having been subtracted at creation (see NewPurchase.jsx).
                      // Returned cheques don't count as paid — the balance is still owed.
                      const extraPaid = payments.filter(pp => pp.cheque_status !== 'returned').reduce((s, pp) => s + pp.amount, 0)
                      const creditConsumedAtCreation = Math.max(0, (p.total || 0) - (p.amount_paid || 0) - (p.credit_amount ?? p.total ?? 0))
                      const totalPaid = (p.amount_paid || 0) + extraPaid + creditConsumedAtCreation
                      // Balance: what's actually still owed. Uses credit_amount (not total)
                      // as the starting point, since that already correctly accounts for
                      // any stored supplier credit applied to THIS purchase at creation.
                      // Also absorbs any floating supplier-level credit distributed above,
                      // FIFO, so this row's number always matches the true total owed.
                      const creditRets = (creditRetsByPurchase[p.id] || []).reduce((s, r) => s + (r.total || 0), 0)
                      // Display: all returns shown in the Returns column
                      const allRets = (returnsByPurchase[p.id] || []).reduce((s, r) => s + (r.total || 0), 0)
                      const due = displayDues[i]
                      const rowBg = due > 0 ? '#fffbeb' : i % 2 === 0 ? 'white' : '#fafafa'
                      rows.push(
                        <tr key={p.id} style={{ borderBottom: '1px solid #f1f5f9', background: rowBg, cursor: 'pointer' }}
                          onMouseEnter={e => e.currentTarget.style.background = '#eef2ff'}
                          onMouseLeave={e => e.currentTarget.style.background = rowBg}
                          onClick={async () => {
                            const { data: items } = await supabase.from('purchase_items').select('*, items(name, item_no)').eq('purchase_id', p.id)
                            setViewPurchaseItems(items || [])
                            setViewingPurchase(p)
                          }}>
                          <td style={{ padding: '11px 14px', fontSize: '13px', color: '#64748b', whiteSpace: 'nowrap' }}>{new Date(p.created_at).toLocaleDateString('en-GB', { day:'2-digit', month:'short', year:'numeric' })}</td>
                          <td style={{ padding: '11px 14px', fontWeight: '700', color: '#e11d48', fontSize: '13px' }}>{p.purchase_no}</td>
                          <td style={{ padding: '11px 14px', fontSize: '13px', color: '#64748b', textTransform: 'capitalize' }}>{p.payment_method?.replace('_',' ')}</td>
                          <td style={{ padding: '11px 14px', fontWeight: '700', color: '#0f172a' }}>{formatCurrency(p.total)}</td>
                          <td style={{ padding: '11px 14px', fontWeight: '600', color: allRets > 0 ? '#d97706' : '#94a3b8' }}>{allRets > 0 ? `− ${formatCurrency(allRets)}` : '—'}</td>
                          <td style={{ padding: '11px 14px', color: '#059669', fontWeight: '600' }}>{totalPaid > 0 ? formatCurrency(totalPaid) : '—'}</td>
                          <td style={{ padding: '11px 14px', fontWeight: '800', color: due > 0 ? '#e11d48' : '#059669' }}>{due > 0 ? formatCurrency(due) : '✓ Paid'}</td>
                          <td style={{ padding: '11px 14px', fontSize: '12px', color: '#2563eb', fontWeight: '600' }}>View →</td>
                        </tr>
                      )
                      // Return sub-rows
                      ;(returnsByPurchase[p.id] || []).forEach(ret => {
                        const pmTag = ret.payment_method === 'cash'
                          ? { label: 'Paid by Cash', bg: '#dcfce7', color: '#166534' }
                          : ret.payment_method === 'bank'
                          ? { label: 'Paid to Bank', bg: '#dbeafe', color: '#1d4ed8' }
                          : null // credit — no tag needed, it reduces balance
                        rows.push(
                          <tr key={`ret-${ret.id}`} style={{ borderBottom: '1px solid #f1f5f9', background: '#fef9ec', cursor: 'pointer' }}
                            onMouseEnter={e => e.currentTarget.style.background = '#fef3c7'}
                            onMouseLeave={e => e.currentTarget.style.background = '#fef9ec'}
                            onClick={async () => {
                              const { data: items } = await supabase.from('purchase_return_items').select('*, items(name, item_no)').eq('return_id', ret.id)
                              setViewPurchaseReturnItems(items || [])
                              setViewingPurchaseReturn(ret)
                            }}>
                            <td style={{ padding: '8px 14px 8px 24px', fontSize: '12px', color: '#92400e' }}>{new Date(ret.created_at).toLocaleDateString('en-GB', { day:'2-digit', month:'short', year:'numeric' })}</td>
                            <td style={{ padding: '8px 14px', fontWeight: '700', color: '#d97706', fontSize: '12px' }}>{ret.return_no || 'RET'}</td>
                            <td style={{ padding: '8px 14px', fontSize: '12px', color: '#92400e' }}>
                              ↩ Purchase Return{ret.remarks ? ` · ${ret.remarks}` : ''}
                              {pmTag && <span style={{ marginLeft: '6px', background: pmTag.bg, color: pmTag.color, padding: '1px 6px', borderRadius: '6px', fontSize: '11px', fontWeight: '700' }}>{pmTag.label}</span>}
                            </td>
                            <td style={{ padding: '8px 14px', fontSize: '12px', color: '#92400e' }}>—</td>
                            <td style={{ padding: '8px 14px', fontWeight: '700', color: '#d97706', fontSize: '12px' }}>− {formatCurrency(ret.total || 0)}</td>
                            <td colSpan={2} style={{ padding: '8px 14px', fontSize: '11px', color: '#d97706', fontWeight: '600' }}>View →</td>
                          </tr>
                        )
                      })
                    })
                    // Unlinked returns
                    ;(returnsByPurchase['__unlinked__'] || []).forEach(ret => {
                      rows.push(
                        <tr key={`ret-unlinked-${ret.id}`} style={{ borderBottom: '1px solid #f1f5f9', background: '#fef9ec' }}>
                          <td style={{ padding: '8px 14px', fontSize: '12px', color: '#92400e' }}>{new Date(ret.created_at).toLocaleDateString('en-GB', { day:'2-digit', month:'short', year:'numeric' })}</td>
                          <td style={{ padding: '8px 14px', fontWeight: '700', color: '#d97706', fontSize: '12px' }}>{ret.return_no || 'RET'}</td>
                          <td style={{ padding: '8px 14px', fontSize: '12px', color: '#92400e' }}>
                            ↩ Purchase Return (not linked to purchase)
                            {ret.remarks && <span style={{ marginLeft: '6px', color: '#b45309' }}>· {ret.remarks}</span>}
                          </td>
                          <td style={{ padding: '8px 14px', fontSize: '12px', color: '#92400e' }}>—</td>
                          <td style={{ padding: '8px 14px', fontWeight: '700', color: '#d97706', fontSize: '12px' }}>− {formatCurrency(ret.total || 0)}</td>
                          <td colSpan={2} style={{ padding: '8px 14px' }}>
                            {linkingReturnId === ret.id ? (
                              <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                                <select defaultValue="" onChange={e => e.target.value && linkReturnToPurchase(ret.id, e.target.value)}
                                  style={{ fontSize: '12px', padding: '3px 6px', border: '1px solid #fde68a', borderRadius: '5px', background: 'white', color: '#0f172a', cursor: 'pointer' }}>
                                  <option value="">— Select purchase —</option>
                                  {supplierPurchases.map(p => (
                                    <option key={p.id} value={p.id}>{p.purchase_no} · {formatCurrency(p.total)}</option>
                                  ))}
                                </select>
                                <button onClick={() => setLinkingReturnId(null)}
                                  style={{ fontSize: '11px', color: '#64748b', background: 'none', border: 'none', cursor: 'pointer' }}>✕</button>
                              </div>
                            ) : (
                              <div style={{ display: 'flex', gap: '6px' }}>
                                <button onClick={() => setLinkingReturnId(ret.id)}
                                  style={{ fontSize: '11px', padding: '3px 8px', background: '#fef3c7', color: '#92400e', border: '1px solid #fde68a', borderRadius: '5px', cursor: 'pointer', fontWeight: '700' }}>
                                  Link to Purchase
                                </button>
                                <button onClick={async () => {
                                    const { data: items } = await supabase.from('purchase_return_items').select('*, items(name, item_no)').eq('return_id', ret.id)
                                    setViewPurchaseReturnItems(items || [])
                                    setViewingPurchaseReturn(ret)
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
                    <td style={{ padding: '12px 14px', fontWeight: '800', color: '#0f172a' }}>{formatCurrency(totalBilled)}</td>
                    <td style={{ padding: '12px 14px', fontWeight: '800', color: '#d97706' }}>− {formatCurrency(supplierReturns.reduce((s, r) => s + (r.total || 0), 0))}</td>
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
            /* Include initial payment at purchase + subsequent purchase_payments, grouped by batch */
            (() => {
              // Initial payments made at time of purchase creation
              const initialPayments = supplierPurchases
                .filter(p => (p.amount_paid || 0) > 0)
                .map(p => ({
                  id: `initial-${p.id}`,
                  purchase_id: p.id,
                  purchase_no: p.purchase_no,
                  amount: p.amount_paid,
                  payment_method: p.payment_method,
                  created_at: p.created_at,
                  notes: 'Payment at purchase',
                  _initial: true,
                }))

              // Subsequent payments via purchase_payments table
              const subsequentPayments = supplierPurchases.flatMap(p =>
                (p.purchase_payments || []).map(pp => ({ ...pp, purchase_no: p.purchase_no }))
              )

              const allPayments = [...initialPayments, ...subsequentPayments]
                .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))

              if (allPayments.length === 0) return (
                <div style={{ padding: '40px', textAlign: 'center', color: '#94a3b8' }}>No payments recorded yet</div>
              )

              // Group by 5-second window (never merge initial payments into batches) —
              // but a shared bank_transaction_id is the more reliable signal that two
              // purchase_payments rows are the SAME physical cheque split across
              // purchases via FIFO.
              const groups = []
              allPayments.forEach(p => {
                const pTime = new Date(p.created_at).getTime()
                const existing = groups.find(g => {
                  if (p.bank_transaction_id && g.bank_transaction_id) {
                    return g.bank_transaction_id === p.bank_transaction_id
                  }
                  return Math.abs(new Date(g.created_at).getTime() - pTime) < 5000 &&
                    g.payment_method === p.payment_method &&
                    !g._initial && !p._initial
                })
                if (existing) {
                  existing.total += p.amount
                  existing.purchases.push(p.purchase_no)
                  if (p.cheque_status === 'returned') existing.cheque_status = 'returned'
                } else {
                  groups.push({ ...p, total: p.amount, purchases: [p.purchase_no] })
                }
              })
              // Show the TRUE cheque/payment face value, not just the portion that was
              // applied to purchases — an overpaid cheque (e.g. a 16,000 cheque that
              // settled 15,000 of purchases) shows as 15,000 otherwise, making it
              // impossible to reconcile against the real payment later. Display-only —
              // g.total itself is left untouched. Mirrors Customers.jsx exactly.
              groups.forEach(g => {
                let linkedTx = g.bank_transaction_id ? supplierBankTx.find(tx => tx.id === g.bank_transaction_id) : null
                if (linkedTx) {
                  g.displayAmount = linkedTx.amount > g.total ? linkedTx.amount : g.total
                  g.excessCredit = linkedTx.amount > g.total ? linkedTx.amount - g.total : 0
                } else if (g.notes) {
                  // Cash has no bank_transaction_id link for the applied portion — match
                  // by the shared payment ref embedded in both notes fields instead, so a
                  // single cash overpayment still shows as one combined total, not two.
                  const refMatch = g.notes.match(/Ref:\s*(PAY-\d+)/)
                  const remainderTx = refMatch ? supplierBankTx.find(tx => tx.notes && tx.notes.includes(`Ref: ${refMatch[1]}`)) : null
                  g.displayAmount = remainderTx ? g.total + remainderTx.amount : g.total
                  g.excessCredit = remainderTx ? remainderTx.amount : 0
                } else {
                  g.displayAmount = g.total
                  g.excessCredit = 0
                }
              })
              return (
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ background: '#f8fafc', borderBottom: '2px solid #e2e8f0' }}>
                      {['Date & Time','Amount Paid','Method','Applied To','Notes',''].map(h => (
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
                        <td style={{ padding: '11px 14px', fontWeight: '800', color: g.cheque_status === 'returned' ? '#b91c1c' : '#e11d48', fontSize: '15px', textDecoration: g.cheque_status === 'returned' ? 'line-through' : 'none' }}>
                          {formatCurrency(g.displayAmount)}
                          {g.excessCredit > 0.009 && (
                            <div style={{ fontSize: '11px', fontWeight: '600', color: '#059669', textDecoration: 'none' }}>
                              ({formatCurrency(g.total)} applied, {formatCurrency(g.excessCredit)} credit)
                            </div>
                          )}
                        </td>
                        <td style={{ padding: '11px 14px' }}>
                          <span style={{ background: '#fee2e2', color: '#991b1b', padding: '2px 8px', borderRadius: '10px', fontSize: '12px', fontWeight: '700', textTransform: 'capitalize' }}>
                            {g.payment_method?.replace('_', ' ') || 'cash'}
                          </span>
                          {g.cheque_status === 'returned' && (
                            <span style={{ marginLeft: '6px', background: '#fee2e2', color: '#b91c1c', padding: '2px 8px', borderRadius: '10px', fontSize: '11px', fontWeight: '700' }}>RETURNED</span>
                          )}
                        </td>
                        <td style={{ padding: '11px 14px', fontSize: '12px', color: '#2563eb', fontWeight: '600' }}>{[...new Set(g.purchases)].join(', ')}</td>
                        <td style={{ padding: '11px 14px', fontSize: '12px', color: '#64748b' }}>
                          {g._initial ? <span style={{ background: '#eef2ff', color: '#1e40af', padding: '1px 6px', borderRadius: '6px', fontSize: '11px', fontWeight: '700' }}>At purchase</span> : (g.notes || '—')}
                        </td>
                        <td style={{ padding: '8px 14px' }}>
                          {!g._initial && g.payment_method === 'cheque' && g.cheque_status !== 'returned' && (
                            <button onClick={() => returnSupplierPayment(g)}
                              style={{ padding: '4px 10px', background: '#fee2e2', color: '#b91c1c', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '11px', fontWeight: '700' }}>
                              Mark Returned
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr style={{ background: '#f8fafc', borderTop: '2px solid #e2e8f0' }}>
                      <td style={{ padding: '12px 14px', fontWeight: '700', color: '#0f172a' }}>Total Paid</td>
                      <td style={{ padding: '12px 14px', fontWeight: '800', color: '#e11d48', fontSize: '15px' }}>{formatCurrency(groups.filter(g => g.cheque_status !== 'returned').reduce((s, g) => s + g.displayAmount, 0))}</td>
                      <td colSpan={4}></td>
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
                  date: selectedSupplier.created_at || new Date(0).toISOString(),
                  type: 'opening',
                  ref: 'OPEN-BAL',
                  desc: 'Opening balance brought forward',
                  debit: openingBalance, credit: 0,
                })
              }

              // 1. Purchases as debits
              supplierPurchases.forEach(p => {
                events.push({
                  date: p.created_at, type: 'purchase',
                  ref: p.purchase_no, desc: 'Purchase raised',
                  debit: p.total, credit: 0
                })
                // Initial payment at time of purchase
                if ((p.amount_paid || 0) > 0) {
                  events.push({
                    date: p.created_at, type: 'payment',
                    ref: p.purchase_no,
                    desc: `Payment made (${p.payment_method?.replace('_',' ') || 'cash'})`,
                    debit: 0, credit: p.amount_paid
                  })
                }
              })

              // Payment refs already covered by a purchase_payments-linked batch event
              // (built further below) — used to suppress a duplicate standalone line for
              // a cash overpayment remainder that's really part of the same payment action.
              const coveredPaymentRefs = new Set(
                supplierPurchases.flatMap(p => (p.purchase_payments || []))
                  .map(pp => (pp.notes || '').match(/Ref:\s*(PAY-\d+)/)?.[1])
                  .filter(Boolean)
              )
              // 1b. Direct payments on opening balance (bank_transactions with no purchase link)
              // These are payments made directly to supplier outside of the purchase flow
              supplierBankTx.forEach(tx => {
                // A direct purchase_payment_id link is reliable — an amount/timestamp guess
                // breaks for any cheque split across multiple purchases via FIFO, since the
                // bank_transactions row holds the full amount while each linked
                // purchase_payments row holds only its portion.
                const isOpeningPayment = !tx.purchase_payment_id
                if (isOpeningPayment) {
                  // Skip if this is a cash-overpayment remainder already shown as part of
                  // the combined batch line below (matched by shared payment ref) — showing
                  // it again here would duplicate the same single payment into two lines.
                  const txRef = tx.notes && tx.notes.match(/Ref:\s*(PAY-\d+)/)?.[1]
                  if (txRef && coveredPaymentRefs.has(txRef)) {
                    // handled by the batches loop further below — skip entirely
                  } else {
                  const isReturned = tx.notes && tx.notes.includes('[RETURNED]')
                  // tx.type only distinguishes cheque_out from everything else — cash,
                  // bank transfer, and card all insert as type 'withdrawal', so the method
                  // must be read from the notes text, or cash gets mislabeled "bank transfer".
                  const method = tx.type === 'cheque_out' ? 'cheque'
                    : tx.notes?.includes('Bank Transfer') ? 'bank transfer'
                    : tx.notes?.includes('Card') ? 'card'
                    : 'cash'
                  // Always show the original payment
                  events.push({
                    date: tx.created_at,
                    type: 'payment',
                    ref: tx.cheque_no || 'PAY',
                    desc: `Direct payment (${method})${!isReturned && tx.notes ? ` · ${tx.notes.replace('Opening balance payment · ','').replace('Opening balance payment','')}` : ''}`,
                    cheque_date: tx.type === 'cheque_out' ? tx.cheque_date : null,
                    debit: 0,
                    credit: tx.amount,
                  })
                  // If returned — add reversal debit row
                  if (isReturned) {
                    events.push({
                      date: tx.returned_at || tx.updated_at || tx.created_at,
                      type: 'reversal',
                      ref: tx.cheque_no || 'RTN',
                      desc: `Cheque returned/bounced${tx.cheque_no ? ` · Cheque #${tx.cheque_no}` : ''} · Payment reversed`,
                      cheque_date: tx.cheque_date || null,
                      debit: tx.amount,
                      credit: 0,
                    })
                  }
                  }
                }
                // Note: a linked, active (not returned) transaction with an overpayment
                // remainder does NOT get its own event here — the purchase_payments-sourced
                // batch event above already shows the TRUE full cheque value (including
                // the credit portion) via displayAmount, with a note explaining the split.
                // Adding a second event for the same remainder here would double-count it —
                // exactly mirrors the customer-side fix in Customers.jsx.
              })

              // 2. Subsequent payments — group by 5-second window
              // Returned cheques shown separately as a reversal, not counted as a normal payment.
              // Group by bank_transaction_id first (a cheque split across purchases via FIFO
              // produces one row per purchase, all sharing the same physical cheque) so exactly
              // one reversal event is shown per real cheque, not one per row.
              const returnedPurchasePayments = supplierPurchases.flatMap(p =>
                (p.purchase_payments || []).filter(pp => pp.cheque_status === 'returned').map(pp => ({ ...pp, purchase_no: p.purchase_no }))
              )
              const returnedGroups = []
              returnedPurchasePayments.forEach(pp => {
                const groupKey = pp.bank_transaction_id || pp.id
                const existing = returnedGroups.find(g => g.groupKey === groupKey)
                if (existing) {
                  existing.total += pp.amount
                  existing.purchaseNos.push(pp.purchase_no)
                  if (new Date(pp.returned_at || pp.created_at) > new Date(existing.returned_at || existing.created_at)) {
                    existing.returned_at = pp.returned_at
                  }
                } else {
                  returnedGroups.push({ ...pp, groupKey, total: pp.amount, purchaseNos: [pp.purchase_no] })
                }
              })
              returnedGroups.forEach(g => {
                // Show the TRUE cheque face value on the reversal too, matching the
                // payment event above — a 110,000 cheque that only applied 105,000
                // to purchases still bounced for its full 110,000.
                const linkedTx = g.bank_transaction_id ? supplierBankTx.find(tx => tx.id === g.bank_transaction_id) : null
                const reversalAmount = linkedTx && linkedTx.amount > g.total ? linkedTx.amount : g.total
                events.push({
                  date: g.returned_at || g.created_at,
                  type: 'reversal',
                  ref: g.cheque_no || 'RTN',
                  desc: `Cheque returned/bounced${g.cheque_no ? ` · Cheque #${g.cheque_no}` : ''} · Purchase ${g.purchaseNos.join(', ')}`,
                  cheque_date: g.cheque_date || null,
                  debit: reversalAmount,
                  credit: 0,
                })
              })
              const rawPayments = supplierPurchases.flatMap(p =>
                (p.purchase_payments || []).map(pp => ({ ...pp, purchase_no: p.purchase_no }))
              )
              // Group by 5-second window, but never merge a returned cheque with a
              // still-valid one so the "later returned" marker is always accurate.
              // A shared bank_transaction_id is the most reliable signal that two
              // purchase_payments rows are the SAME physical cheque split across
              // purchases via FIFO.
              const batches = []
              rawPayments.forEach(pp => {
                const pTime = new Date(pp.created_at).getTime()
                const existing = batches.find(b => {
                  if (pp.bank_transaction_id && b.bank_transaction_id) {
                    return b.bank_transaction_id === pp.bank_transaction_id
                  }
                  return Math.abs(new Date(b.created_at).getTime() - pTime) < 5000 &&
                    b.payment_method === pp.payment_method &&
                    (b.cheque_status === 'returned') === (pp.cheque_status === 'returned')
                })
                if (existing) { existing.total += pp.amount }
                else batches.push({ ...pp, total: pp.amount })
              })
              batches.forEach(b => {
                // Show the TRUE cheque face value, not just the portion that was applied
                // to purchases — a 16,000 cheque that only settled 15,000 of purchases
                // still cost 16,000, and hiding that makes it impossible to reconcile
                // against the actual cheque later. Mirrors the customer-side fix exactly.
                // For cheque/bank_transfer/card, the linked bank_transactions row holds the
                // FULL value, so linkedTx.amount IS the true total. For cash, there's no
                // such single record — the row only holds the REMAINDER (the applied
                // portion lives solely in purchase_payments), so the true total there is
                // b.total + the remainder, not the remainder alone.
                let linkedTx = b.bank_transaction_id ? supplierBankTx.find(tx => tx.id === b.bank_transaction_id) : null
                let displayAmount = linkedTx ? linkedTx.amount : b.total
                let isCashRemainderMatch = false
                if (!linkedTx && b.notes) {
                  const refMatch = b.notes.match(/Ref:\s*(PAY-\d+)/)
                  if (refMatch) {
                    linkedTx = supplierBankTx.find(tx => tx.notes && tx.notes.includes(`Ref: ${refMatch[1]}`))
                    if (linkedTx) {
                      isCashRemainderMatch = true
                      displayAmount = b.total + linkedTx.amount
                    }
                  }
                }
                const excessAmount = isCashRemainderMatch ? linkedTx.amount : (linkedTx && linkedTx.amount > b.total ? linkedTx.amount - b.total : 0)
                const excessNote = excessAmount > 0.009 ? ` · ${formatCurrency(excessAmount)} applied as supplier credit` : ''
                events.push({
                  date: b.created_at, type: 'payment',
                  ref: b.cheque_no || '—',
                  desc: `Payment made (${b.payment_method?.replace('_',' ') || 'cash'})${b.cheque_status === 'returned' ? ' — later returned' : ''}${excessNote}${b.notes ? ` · ${b.notes.split('·')[0].trim()}` : ''}`,
                  cheque_date: b.payment_method === 'cheque' ? b.cheque_date : null,
                  debit: 0, credit: displayAmount
                })
              })

              // 3. Purchase returns
              // credit returns → reduce DR balance (credit column)
              // cash/bank returns → informational only, do NOT move the balance
              supplierReturns.forEach(ret => {
                const linkedPurchase = supplierPurchases.find(p => p.id === ret.purchase_id)
                const pmLabel = ret.payment_method === 'cash' ? ' · Paid by Cash'
                  : ret.payment_method === 'bank' ? ' · Paid to Bank' : ''
                const isCredit = ret.payment_method === 'credit'
                events.push({
                  date: ret.created_at,
                  type: isCredit ? 'return' : 'return_external',
                  ref: ret.return_no || 'RET',
                  desc: `Purchase return${linkedPurchase ? ` (${linkedPurchase.purchase_no})` : ''}${ret.remarks ? ` · ${ret.remarks}` : ''}${pmLabel}`,
                  debit: 0,
                  credit: isCredit ? (ret.total || 0) : 0, // cash/bank don't move balance
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
              if (rows.length === 0) return <div style={{ padding: '40px', textAlign: 'center', color: '#94a3b8' }}>No activity yet</div>
              const bgMap = { opening: '#f5f3ff', purchase: '#fff5f5', payment: '#f0fdf4', return: '#fef3c7', return_external: '#f0f9ff', reversal: '#fff1f2' }
              const pmTagMap = {
                cash: { label: 'Paid by Cash', bg: '#dcfce7', color: '#166534' },
                bank: { label: 'Paid to Bank', bg: '#dbeafe', color: '#1d4ed8' },
              }
              function exportSupplierExcel() {
                const headers = ['Date','Ref','Description','Cheque Date','Debit (LKR)','Credit (LKR)','Balance (LKR)']
                const dataRows = rows.map(e => [
                  new Date(e.date).toLocaleDateString('en-GB'),
                  e.ref, e.desc,
                  e.cheque_date ? new Date(e.cheque_date).toLocaleDateString('en-GB') : '',
                  e.debit > 0 ? e.debit.toFixed(2) : '',
                  e.credit > 0 ? e.credit.toFixed(2) : '',
                  e.balance.toFixed(2) + (e.balance > 0.01 ? ' DR' : e.balance < -0.01 ? ' CR' : ''),
                ])
                const csv = [headers, ...dataRows].map(r => r.map(v => `"${v}"`).join(',')).join('\n')
                const blob = new Blob([csv], { type: 'text/csv' })
                const url = URL.createObjectURL(blob)
                const a = document.createElement('a')
                a.href = url; a.download = `${selectedSupplier.name}-activity-statement.csv`; a.click()
                URL.revokeObjectURL(url)
              }
              return (
                <div>
                  <div style={{ display: 'flex', justifyContent: 'flex-end', padding: '8px 14px', borderBottom: '1px solid #f1f5f9' }}>
                    <button onClick={exportSupplierExcel}
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
                    {rows.map((e, i) => {
                      const pmTag = e.type === 'return_external' ? pmTagMap[e._pmMethod] : null
                      return (
                        <tr key={i} style={{ borderBottom: '1px solid #f1f5f9', background: bgMap[e.type] || 'white' }}>
                          <td style={{ padding: '9px 14px', fontSize: '12px', color: '#64748b', whiteSpace: 'nowrap' }}>{new Date(e.date).toLocaleDateString('en-GB', { day:'2-digit', month:'short', year:'numeric' })}</td>
                          <td style={{ padding: '9px 14px', fontWeight: '700', color: e.type === 'reversal' ? '#e11d48' : e.type.startsWith('return') ? '#d97706' : '#e11d48', fontSize: '12px' }}>{e.ref}</td>
                          <td style={{ padding: '9px 14px', fontSize: '13px', color: '#0f172a' }}>
                            {e.desc.replace(/ · Paid by Cash| · Paid to Bank/, '')}
                            {pmTag && <span style={{ marginLeft: '6px', background: pmTag.bg, color: pmTag.color, padding: '1px 6px', borderRadius: '6px', fontSize: '11px', fontWeight: '700' }}>{pmTag.label}</span>}
                            {e.type === 'return_external' && <span style={{ marginLeft: '6px', fontSize: '11px', color: '#64748b' }}>({formatCurrency(e._amount)} — no balance impact)</span>}
                          </td>
                          <td style={{ padding: '9px 14px', fontSize: '12px', color: '#7c3aed', whiteSpace: 'nowrap' }}>
                            {e.cheque_date ? new Date(e.cheque_date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'}
                          </td>
                          <td style={{ padding: '9px 14px', textAlign: 'right', fontWeight: '700', color: e.type === 'reversal' ? '#e11d48' : '#e11d48' }}>{e.debit > 0 ? formatCurrency(e.debit) : '—'}</td>
                          <td style={{ padding: '9px 14px', textAlign: 'right', fontWeight: '700', color: e.type === 'return' ? '#d97706' : '#059669' }}>
                            {e.type === 'return_external' ? <span style={{ color: '#94a3b8', fontStyle: 'italic' }}>—</span> : e.credit > 0 ? formatCurrency(e.credit) : '—'}
                          </td>
                          <td style={{ padding: '9px 14px', textAlign: 'right', fontWeight: '800', fontSize: '13px', color: e.balance > 0.01 ? '#e11d48' : '#059669' }}>
                            {e.type === 'return_external'
                              ? <span style={{ color: '#94a3b8', fontStyle: 'italic', fontSize: '11px' }}>unchanged</span>
                              : Math.abs(e.balance) < 0.01 ? '✓ Nil' : `${formatCurrency(Math.abs(e.balance))} ${e.balance > 0.01 ? 'DR' : 'CR'}`
                            }
                          </td>
                        </tr>
                      )
                    })}
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

        {/* Purchase detail modal */}
        {viewingPurchase && (
          <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
            onClick={e => { if (e.target === e.currentTarget) { setViewingPurchase(null); setViewPurchaseItems([]) } }}>
            <div style={{ background: 'white', borderRadius: '16px', padding: '28px', width: '620px', maxHeight: '88vh', overflowY: 'auto', boxShadow: '0 20px 60px rgba(0,0,0,0.3)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '20px' }}>
                <div>
                  <h2 style={{ fontSize: '18px', fontWeight: '800', color: '#0f172a', margin: '0 0 4px' }}>{viewingPurchase.purchase_no}</h2>
                  <p style={{ fontSize: '13px', color: '#64748b', margin: 0 }}>
                    {viewingPurchase.suppliers?.name} · {new Date(viewingPurchase.created_at).toLocaleDateString('en-GB', { day:'2-digit', month:'long', year:'numeric' })} · {viewingPurchase.payment_method?.replace('_',' ')}
                  </p>
                </div>
                <button onClick={() => { setViewingPurchase(null); setViewPurchaseItems([]) }}
                  style={{ background: '#f1f5f9', border: 'none', borderRadius: '10px', padding: '8px 14px', cursor: 'pointer', color: '#64748b', fontWeight: '600' }}>✕ Close</button>
              </div>

              {/* Items purchased */}
              <h3 style={{ fontSize: '12px', fontWeight: '700', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '8px' }}>Items Purchased</h3>
              <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '16px' }}>
                <thead>
                  <tr style={{ background: '#f8fafc', borderBottom: '2px solid #e2e8f0' }}>
                    {['Item','Qty','Unit Cost','Selling Price','Total'].map(h => (
                      <th key={h} style={{ padding: '8px 12px', textAlign: 'left', fontSize: '11px', fontWeight: '700', color: '#94a3b8', textTransform: 'uppercase' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {viewPurchaseItems.map((li, i) => (
                    <tr key={li.id} style={{ borderBottom: '1px solid #f1f5f9', background: i % 2 === 0 ? 'white' : '#fafafa' }}>
                      <td style={{ padding: '9px 12px', fontWeight: '600', color: '#0f172a' }}>{li.items?.name || li.item_name || '—'}</td>
                      <td style={{ padding: '9px 12px', color: '#64748b' }}>{li.quantity}</td>
                      <td style={{ padding: '9px 12px', fontWeight: '700', color: '#e11d48' }}>{formatCurrency(li.unit_cost)}</td>
                      <td style={{ padding: '9px 12px', color: '#64748b' }}>{li.selling_price ? formatCurrency(li.selling_price) : '—'}</td>
                      <td style={{ padding: '9px 12px', fontWeight: '700', color: '#0f172a' }}>{formatCurrency(li.quantity * li.unit_cost)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              {/* Totals summary */}
              {(() => {
                const purchRets = supplierReturns.filter(r => r.purchase_id === viewingPurchase.id)
                const totalReturned = purchRets.reduce((s, r) => s + (r.total || 0), 0)
                // Only credit returns reduce what's still owed
                const creditReturned = purchRets.filter(r => r.payment_method === 'credit').reduce((s, r) => s + (r.total || 0), 0)
                const nonReturnedPayments = (viewingPurchase.purchase_payments || []).filter(p => p.cheque_status !== 'returned').reduce((s, p) => s + p.amount, 0)
                const creditConsumedAtCreation = Math.max(0, (viewingPurchase.total || 0) - (viewingPurchase.amount_paid || 0) - (viewingPurchase.credit_amount ?? viewingPurchase.total ?? 0))
                const totalPaid = (viewingPurchase.amount_paid || 0) + nonReturnedPayments + creditConsumedAtCreation
                const balanceDue = Math.max(0, (viewingPurchase.credit_amount ?? viewingPurchase.total ?? 0) - creditReturned - nonReturnedPayments)
                return (
                  <div style={{ background: '#f8fafc', borderRadius: '10px', padding: '14px 16px', marginBottom: '16px' }}>
                    {[
                      { l: 'Purchase Total', v: formatCurrency(viewingPurchase.total), bold: true },
                      totalReturned > 0 ? { l: 'Purchase Returns (all)', v: `− ${formatCurrency(totalReturned)}`, color: '#d97706' } : null,
                      creditReturned > 0 && creditReturned < totalReturned ? { l: '  ↳ Deducted from balance', v: `− ${formatCurrency(creditReturned)}`, color: '#92400e' } : null,
                      { l: 'Amount Paid', v: formatCurrency(totalPaid), color: '#059669' },
                      { l: 'Balance Due', v: balanceDue > 0 ? formatCurrency(balanceDue) : '✓ Fully Paid', color: balanceDue > 0 ? '#e11d48' : '#059669', bold: true },
                    ].filter(Boolean).map(row => (
                      <div key={row.l} style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 0', borderBottom: '1px solid #e2e8f0', fontSize: row.bold ? '15px' : '13px', fontWeight: row.bold ? '800' : '500' }}>
                        <span style={{ color: row.bold ? (row.color || '#0f172a') : '#64748b' }}>{row.l}</span>
                        <span style={{ color: row.color || '#0f172a', fontWeight: row.bold ? '800' : '600' }}>{row.v}</span>
                      </div>
                    ))}
                  </div>
                )
              })()}

              {/* Linked Purchase Returns */}
              {(() => {
                const purchRets = supplierReturns.filter(r => r.purchase_id === viewingPurchase.id)
                if (purchRets.length === 0) return null
                return (
                  <div style={{ marginBottom: '16px' }}>
                    <h3 style={{ fontSize: '12px', fontWeight: '700', color: '#d97706', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '8px' }}>↩ Purchase Returns ({purchRets.length})</h3>
                    {purchRets.map((ret, i) => (
                      <div key={ret.id}
                        onClick={async () => {
                          const { data: items } = await supabase.from('purchase_return_items').select('*, items(name, item_no)').eq('return_id', ret.id)
                          setViewPurchaseReturnItems(items || [])
                          setViewingPurchaseReturn(ret)
                        }}
                        style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 14px', background: i % 2 === 0 ? '#fef9ec' : '#fffbf0', border: '1px solid #fde68a', borderRadius: '10px', marginBottom: '6px', cursor: 'pointer' }}
                        onMouseEnter={e => e.currentTarget.style.background = '#fef3c7'}
                        onMouseLeave={e => e.currentTarget.style.background = i % 2 === 0 ? '#fef9ec' : '#fffbf0'}>
                        <div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                            <span style={{ fontWeight: '700', color: '#d97706', fontSize: '13px' }}>{ret.return_no || 'RET'}</span>
                            {ret.payment_method === 'cash' && <span style={{ background: '#dcfce7', color: '#166534', padding: '1px 6px', borderRadius: '6px', fontSize: '11px', fontWeight: '700' }}>Paid by Cash</span>}
                            {ret.payment_method === 'bank' && <span style={{ background: '#dbeafe', color: '#1d4ed8', padding: '1px 6px', borderRadius: '6px', fontSize: '11px', fontWeight: '700' }}>Paid to Bank</span>}
                            {ret.payment_method === 'credit' && <span style={{ background: '#fef3c7', color: '#92400e', padding: '1px 6px', borderRadius: '6px', fontSize: '11px', fontWeight: '700' }}>Deducted from Balance</span>}
                          </div>
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
              {(viewingPurchase.purchase_payments || []).length > 0 && (
                <div>
                  <h3 style={{ fontSize: '12px', fontWeight: '700', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '8px' }}>Payment History</h3>
                  {[...viewingPurchase.purchase_payments].sort((a, b) => new Date(a.created_at) - new Date(b.created_at)).map((p, i) => (
                    <div key={p.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 12px', background: i % 2 === 0 ? '#f8fafc' : 'white', borderRadius: '6px', marginBottom: '4px', fontSize: '13px' }}>
                      <div>
                        <span style={{ fontWeight: '600', color: '#0f172a' }}>{new Date(p.created_at).toLocaleDateString('en-GB', { day:'2-digit', month:'short', year:'numeric' })}</span>
                        <span style={{ marginLeft: '8px', color: '#64748b', textTransform: 'capitalize' }}>{p.payment_method?.replace('_',' ') || 'cash'}</span>
                        {p.notes && <span style={{ marginLeft: '8px', color: '#94a3b8', fontSize: '12px' }}>{p.notes.split('·')[0]?.trim()}</span>}
                      </div>
                      <span style={{ fontWeight: '800', color: '#e11d48' }}>{formatCurrency(p.amount)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* Purchase Return detail modal */}
        {viewingPurchaseReturn && (
          <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 1001, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
            onClick={e => { if (e.target === e.currentTarget) { setViewingPurchaseReturn(null); setViewPurchaseReturnItems([]) } }}>
            <div style={{ background: 'white', borderRadius: '16px', padding: '28px', width: '540px', maxHeight: '82vh', overflowY: 'auto', boxShadow: '0 24px 80px rgba(0,0,0,0.4)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '20px' }}>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '4px' }}>
                    <h2 style={{ fontSize: '18px', fontWeight: '800', color: '#0f172a', margin: 0 }}>{viewingPurchaseReturn.return_no || 'Purchase Return'}</h2>
                    <span style={{ background: '#fef3c7', color: '#92400e', padding: '2px 10px', borderRadius: '10px', fontSize: '12px', fontWeight: '700' }}>↩ Return</span>
                  </div>
                  <p style={{ fontSize: '13px', color: '#64748b', margin: 0 }}>
                    {new Date(viewingPurchaseReturn.created_at).toLocaleDateString('en-GB', { day:'2-digit', month:'long', year:'numeric' })}
                    {viewingPurchaseReturn.remarks && <span style={{ marginLeft: '8px' }}>· {viewingPurchaseReturn.remarks}</span>}
                  </p>
                </div>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <button onClick={() => printPurchaseReturn(viewingPurchaseReturn, viewPurchaseReturnItems)}
                    style={{ background: '#1c1917', border: 'none', borderRadius: '10px', padding: '8px 14px', cursor: 'pointer', color: 'white', fontWeight: '700' }}>🖨 Print</button>
                  <button onClick={() => { setViewingPurchaseReturn(null); setViewPurchaseReturnItems([]) }}
                    style={{ background: '#f1f5f9', border: 'none', borderRadius: '10px', padding: '8px 14px', cursor: 'pointer', color: '#64748b', fontWeight: '600' }}>✕ Close</button>
                </div>
              </div>

              <h3 style={{ fontSize: '12px', fontWeight: '700', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '8px' }}>Returned Items</h3>
              <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '16px' }}>
                <thead>
                  <tr style={{ background: '#f8fafc', borderBottom: '2px solid #e2e8f0' }}>
                    {['Item','Qty','Unit Cost','Line Total'].map(h => (
                      <th key={h} style={{ padding: '8px 12px', textAlign: 'left', fontSize: '11px', fontWeight: '700', color: '#94a3b8', textTransform: 'uppercase' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {viewPurchaseReturnItems.map((li, i) => (
                    <tr key={li.id || i} style={{ borderBottom: '1px solid #f1f5f9', background: i % 2 === 0 ? 'white' : '#fafafa' }}>
                      <td style={{ padding: '9px 12px', fontWeight: '600', color: '#0f172a' }}>{li.items?.name || '—'}</td>
                      <td style={{ padding: '9px 12px', color: '#64748b' }}>{li.quantity}</td>
                      <td style={{ padding: '9px 12px', color: '#64748b' }}>{formatCurrency(li.unit_cost)}</td>
                      <td style={{ padding: '9px 12px', fontWeight: '700', color: '#d97706' }}>{formatCurrency(li.line_total || li.quantity * li.unit_cost)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <div style={{ background: '#fef9ec', borderRadius: '10px', padding: '14px 16px', border: '1px solid #fde68a' }}>
                {[
                  { l: 'Total Returned', v: formatCurrency(viewingPurchaseReturn.total || viewingPurchaseReturn.subtotal || 0), bold: true, color: '#d97706' },
                  { l: 'Refund Method', v: (viewingPurchaseReturn.payment_method || 'credit').replace('_', ' '), color: '#64748b' },
                  { l: 'Linked Purchase', v: supplierPurchases.find(p => p.id === viewingPurchaseReturn.purchase_id)?.purchase_no || '—', color: '#2563eb' },
                  viewingPurchaseReturn.remarks ? { l: 'Remarks', v: viewingPurchaseReturn.remarks, color: '#64748b' } : null,
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

  // ── SUPPLIER LIST VIEW ──
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '24px' }}>
        <div>
          <h1 style={{ fontSize: '22px', fontWeight: '700', color: '#0f172a', margin: '0 0 4px' }}>Suppliers</h1>
          <p style={{ color: '#64748b', fontSize: '14px', margin: 0 }}>{suppliers.length} total suppliers</p>
        </div>
        <button onClick={openNew}
          style={{ padding: '10px 20px', background: 'linear-gradient(135deg,#2563eb,#1d4ed8)', color: 'white', border: 'none', borderRadius: '10px', cursor: 'pointer', fontWeight: '700', fontSize: '14px' }}>
          + Add Supplier
        </button>
      </div>

      {showForm && (
        <div style={{ background: 'white', borderRadius: '12px', padding: '20px 24px', boxShadow: '0 1px 3px rgba(15,23,42,0.06), 0 1px 2px rgba(15,23,42,0.04)', marginBottom: '20px', border: '1px solid #f1f5f9' }}>
          <h3 style={{ margin: '0 0 16px', fontSize: '15px', fontWeight: '700', color: '#0f172a' }}>{editSupplier ? 'Edit Supplier' : 'Add New Supplier'}</h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '14px' }}>
            <div style={{ gridColumn: '1/-1' }}>
              <label style={lbl}>Name *</label>
              <input type="text" value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} placeholder="Supplier name" style={inp} autoFocus />
            </div>
            <div><label style={lbl}>Phone</label><input type="text" value={form.phone} onChange={e => setForm(p => ({ ...p, phone: e.target.value }))} placeholder="Phone" style={inp} /></div>
            <div style={{ gridColumn: '1/-1' }}><label style={lbl}>Address</label><input type="text" value={form.address} onChange={e => setForm(p => ({ ...p, address: e.target.value }))} placeholder="Address" style={inp} /></div>
          </div>
          <div style={{ display: 'flex', gap: '10px' }}>
            <button onClick={() => { setShowForm(false); setEditSupplier(null) }}
              style={{ padding: '9px 18px', background: '#f1f5f9', color: '#475569', border: 'none', borderRadius: '7px', cursor: 'pointer', fontWeight: '600' }}>Cancel</button>
            <button onClick={handleSave} disabled={saving}
              style={{ padding: '9px 20px', background: 'linear-gradient(135deg,#2563eb,#1d4ed8)', color: 'white', border: 'none', borderRadius: '7px', cursor: 'pointer', fontWeight: '700' }}>
              {saving ? 'Saving...' : editSupplier ? 'Update Supplier' : '✓ Add Supplier'}
            </button>
          </div>
        </div>
      )}

      <div style={{ marginBottom: '16px' }}>
        <input type="text" placeholder="Search by name, supplier no or phone…" value={search} onChange={e => setSearch(e.target.value)} style={{ ...inp, maxWidth: '400px' }} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: '14px', marginBottom: '20px' }}>
        {[
          { label: 'Total Suppliers', value: suppliers.length, color: '#1e40af' },
          { label: 'Total Outstanding', value: formatCurrency(suppliers.reduce((s, sup) => s + (sup.outstanding_balance || 0), 0)), color: '#e11d48' },
          { label: 'With Balance', value: suppliers.filter(s => (s.outstanding_balance || 0) > 0).length, color: '#d97706' },
        ].map(s => (
          <div key={s.label} style={{ background: 'white', borderRadius: '12px', padding: '18px', boxShadow: '0 1px 3px rgba(15,23,42,0.06), 0 1px 2px rgba(15,23,42,0.04)', borderLeft: `4px solid ${s.color}` }}>
            <div style={{ fontSize: '11px', fontWeight: '700', color: '#94a3b8', textTransform: 'uppercase', marginBottom: '4px' }}>{s.label}</div>
            <div style={{ fontSize: '20px', fontWeight: '800', color: s.color }}>{s.value}</div>
          </div>
        ))}
      </div>

      {loading ? <div style={{ padding: '60px', textAlign: 'center', color: '#94a3b8' }}>Loading...</div> : (
        <div style={{ background: 'white', borderRadius: '12px', boxShadow: '0 1px 3px rgba(15,23,42,0.06), 0 1px 2px rgba(15,23,42,0.04)', overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: '#f8fafc', borderBottom: '2px solid #e2e8f0' }}>
                {['Supplier No', 'Name', 'Phone', 'Email', 'Address', 'Outstanding', ''].map(h => (
                  <th key={h} style={{ padding: '11px 14px', textAlign: 'left', fontSize: '11px', fontWeight: '700', color: '#94a3b8', textTransform: 'uppercase' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filteredPaged.map((s, i) => (
                <tr key={s.id}
                  onClick={() => openSupplier(s)}
                  style={{ borderBottom: '1px solid #f1f5f9', background: (s.outstanding_balance || 0) > 0.01 ? '#fffbeb' : (s.outstanding_balance || 0) < -0.01 ? '#f0fdf4' : i % 2 === 0 ? 'white' : '#fafafa', cursor: 'pointer' }}
                  onMouseEnter={e => e.currentTarget.style.background = '#f5f3ff'}
                  onMouseLeave={e => e.currentTarget.style.background = (s.outstanding_balance || 0) > 0.01 ? '#fffbeb' : (s.outstanding_balance || 0) < -0.01 ? '#f0fdf4' : i % 2 === 0 ? 'white' : '#fafafa'}>
                  <td style={{ padding: '12px 14px', fontWeight: '700', color: '#2563eb', fontSize: '13px' }}>{s.supplier_no}</td>
                  <td style={{ padding: '12px 14px', fontWeight: '600', color: '#0f172a' }}>{s.name}</td>
                  <td style={{ padding: '12px 14px', color: '#64748b' }}>{s.phone || '—'}</td>
                  <td style={{ padding: '12px 14px', color: '#64748b' }}>{s.email || '—'}</td>
                  <td style={{ padding: '12px 14px', color: '#64748b', maxWidth: '140px' }}><div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.address || '—'}</div></td>
                  <td style={{ padding: '12px 14px', fontWeight: '800', color: (s.outstanding_balance || 0) > 0.01 ? '#e11d48' : (s.outstanding_balance || 0) < -0.01 ? '#059669' : '#94a3b8' }}>
                    {(s.outstanding_balance || 0) > 0.01
                      ? formatCurrency(s.outstanding_balance)
                      : (s.outstanding_balance || 0) < -0.01
                      ? <span style={{ color: '#059669' }}>{formatCurrency(Math.abs(s.outstanding_balance))} CR</span>
                      : '—'}
                  </td>
                  <td style={{ padding: '12px 14px', fontSize: '12px', color: '#2563eb', fontWeight: '600' }}>View →</td>
                  {isSuperAdmin && (
                    <td style={{ padding: '8px 14px' }} onClick={e => e.stopPropagation()}>
                      <div style={{ display: 'flex', gap: '6px' }}>
                        <button
                          onClick={e => { e.stopPropagation(); setEditSupplier(s); setForm({ name: s.name || '', phone: s.phone || '', address: s.address || '' }); setShowForm(true) }}
                          title="Edit supplier"
                          style={{ padding: '4px 10px', background: '#eef2ff', color: '#1e40af', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '12px', fontWeight: '700' }}>
                          ✏️
                        </button>
                        <button
                          onClick={e => handleDeleteSupplier(s, e)}
                          disabled={(s.outstanding_balance || 0) !== 0}
                          title={(s.outstanding_balance || 0) !== 0 ? 'Outstanding balance must be 0 to delete' : 'Delete supplier'}
                          style={{ padding: '4px 10px', background: (s.outstanding_balance || 0) !== 0 ? '#f1f5f9' : '#fee2e2', color: (s.outstanding_balance || 0) !== 0 ? '#cbd5e1' : '#dc2626', border: 'none', borderRadius: '6px', cursor: (s.outstanding_balance || 0) !== 0 ? 'not-allowed' : 'pointer', fontSize: '12px', fontWeight: '700' }}>
                          🗑
                        </button>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}


