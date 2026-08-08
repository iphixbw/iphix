import { useState, useEffect } from 'react'
import { supabase } from '../../supabase'
import { formatCurrency } from '../../lib/helpers'
import toast from 'react-hot-toast'

export default function EndOfShift({ activeShop, session, isSuperAdmin = false, isCashier = false }) {
  const [salesmen, setSalesmen] = useState([])
  const [selectedSalesman, setSelectedSalesman] = useState(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [actualCash, setActualCash] = useState('')
  const [notes, setNotes] = useState('')
  const [view, setView] = useState('end')
  const [allInvoices, setAllInvoices] = useState([])
  const [allExpenses, setAllExpenses] = useState([])
  const [cashCollected, setCashCollected] = useState([])
  const [openDrafts, setOpenDrafts] = useState([])
  const [creditCustomers, setCreditCustomers] = useState([])
  const [shiftHistory, setShiftHistory] = useState([])
  const [selectedShift, setSelectedShift] = useState(null)
  const [cashSalesTotal, setCashSalesTotal] = useState(0)
  const [cardSalesTotal, setCardSalesTotal] = useState(0)
  const [chequeSalesTotal, setChequeSalesTotal] = useState(0)
  const [creditSalesTotal, setCreditSalesTotal] = useState(0)
  const [totalSalesAll, setTotalSalesAll] = useState(0)
  const [cashExpensesTotal, setCashExpensesTotal] = useState(0)
  const [cashAdjList, setCashAdjList] = useState([])
  const [cashAdjIn, setCashAdjIn] = useState(0)
  const [cashAdjOut, setCashAdjOut] = useState(0)
  const [cashDepositsTotal, setCashDepositsTotal] = useState(0)
  const [cashCollectedTotal, setCashCollectedTotal] = useState(0)
  const [cashToSuppliersTotal, setCashToSuppliersTotal] = useState(0)
  const [cashToInvestorsTotal, setCashToInvestorsTotal] = useState(0)
  const [cashRefundsToCustomersTotal, setCashRefundsToCustomersTotal] = useState(0)
  const [cashRefundsFromSuppliersTotal, setCashRefundsFromSuppliersTotal] = useState(0)
  const [bankWithdrawalsTotal, setBankWithdrawalsTotal] = useState(0)
  const [openingCash, setOpeningCash] = useState(0)
  const [expectedCash, setExpectedCash] = useState(0)
  // Detail lists for expanded reconciliation
  const [cashExpensesList, setCashExpensesList] = useState([])
  const [cashDepositsList, setCashDepositsList] = useState([])
  const [cashCollectedList, setCashCollectedList] = useState([])
  const [cashToSuppliersList, setCashToSuppliersList] = useState([])
  const [cashToInvestorsList, setCashToInvestorsList] = useState([])
  const [cashRefundsToCustomersList, setCashRefundsToCustomersList] = useState([])
  const [cashRefundsFromSuppliersList, setCashRefundsFromSuppliersList] = useState([])
  const [bankWithdrawalsList, setBankWithdrawalsList] = useState([])

  const lbl = { display:'block', marginBottom:'5px', fontSize:'11px', fontWeight:'700', color:'#94a3b8', textTransform:'uppercase', letterSpacing:'0.06em' }
  const inp = { width:'100%', padding:'9px 12px', border:'1.5px solid #e2e8f0', borderRadius:'7px', fontSize:'14px', boxSizing:'border-box', outline:'none', background:'white' }
  const card = { background:'white', borderRadius:'12px', padding:'20px', boxShadow:'0 1px 3px rgba(0,0,0,0.08)', marginBottom:'16px', border:'1px solid #f1f5f9' }

  useEffect(() => { fetchData() }, [activeShop?.id])

  async function safeQ(q) {
    try { const { data } = await q; return data || [] } catch { return [] }
  }

  async function autoSelectSalesman(list, user, setter) {
    if (!user?.id || !list.length) return
    let match = list.find(s => s.user_id === user.id)
    if (!match) {
      const { data: profile } = await supabase.from('user_profiles').select('full_name').eq('id', user.id).single()
      if (profile?.full_name) match = list.find(s => s.name?.toLowerCase().trim() === profile.full_name?.toLowerCase().trim())
    }
    if (!match && user.email) {
      const prefix = user.email.split('@')[0].toLowerCase()
      match = list.find(s => s.name?.toLowerCase().replace(/\s+/g,'') === prefix)
    }
    if (match) {
      setter(match)
      if (!match.user_id) supabase.from('salesmen').update({ user_id: user.id }).eq('id', match.id).then(() => {})
    }
  }

  async function fetchData() {
    setLoading(true)
    const today = new Date(); today.setHours(0,0,0,0)
    const shop = activeShop?.id
    const from = today.toISOString()
    const to = new Date(today.getTime() + 24*60*60*1000).toISOString()

    // Fetch opening cash = actual_cash from the last completed shift record
    // This is yesterday's closing cash. Fall back to shops.cash_in_hand if no prior shift.
    const todayStr = new Date().toISOString().split('T')[0]
    let lastShiftQ = supabase.from('shift_records')
      .select('actual_cash, shift_date')
      .lt('shift_date', todayStr)
      .not('actual_cash', 'is', null)
      .order('shift_date', { ascending: false })
      .limit(1)
    if (shop) lastShiftQ = lastShiftQ.eq('shop_id', shop)
    const { data: lastShift } = await lastShiftQ.maybeSingle()
    if (lastShift?.actual_cash != null) {
      setOpeningCash(lastShift.actual_cash)
    } else if (shop) {
      const { data: shopData } = await supabase.from('shops').select('cash_in_hand').eq('id', shop).single()
      setOpeningCash(shopData?.cash_in_hand || 0)
    } else {
      const { data: allShops } = await supabase.from('shops').select('cash_in_hand')
      setOpeningCash((allShops || []).reduce((s, sh) => s + (sh.cash_in_hand || 0), 0))
    }

    let invQ = supabase.from('invoices').select('invoice_no,total,amount_paid,credit_amount,payment_method,created_at,customers(name,customer_no),salesmen(name)').eq('status','confirmed').gte('created_at',from).lte('created_at',to).order('created_at',{ascending:true})
    let expQ = supabase.from('expenses').select('description,amount,category,payment_method,created_at').gte('created_at',from).lte('created_at',to).order('created_at',{ascending:true})
    let depQ = supabase.from('cash_deposits').select('amount,notes,created_at').gte('created_at',from).lte('created_at',to)
    let draftQ = supabase.from('invoices').select('invoice_no,created_at,customers(name)').eq('status','draft')
    let histQ = supabase.from('shift_records').select('*,salesmen(name),shops(name)').order('created_at',{ascending:false}).limit(50)
    let pmtQ = supabase.from('invoice_payments').select('amount,payment_method,created_at,invoices(invoice_no,customers(name))').eq('payment_method','cash').gte('created_at',from).lte('created_at',to)
    const openingCashQ = supabase.from('bank_transactions').select('amount,created_at,reference,notes').eq('type','deposit').ilike('notes','%Opening balance payment · Cash%').gte('created_at',from).lte('created_at',to)
    // Cash adjustments — fetch without shop filter (shop_id may not exist in schema)
    const cashAdjQ = supabase.from('bank_transactions')
      .select('amount,created_at,notes,reference')
      .eq('type','cash_adjustment')
      .gte('created_at',from).lte('created_at',to)
    if (shop) { invQ=invQ.eq('shop_id',shop); expQ=expQ.eq('shop_id',shop); depQ=depQ.eq('shop_id',shop); draftQ=draftQ.eq('shop_id',shop); histQ=histQ.eq('shop_id',shop) }

    // Additional sources matching Cashflow
    let suppPmtQ = supabase.from('purchase_payments').select('amount,created_at,notes,purchases(purchase_no,suppliers(name))').eq('payment_method','cash').gte('created_at',from).lte('created_at',to)
    let invOutQ = supabase.from('investment_transactions').select('amount,created_at,notes,investors(name)').in('type',['withdrawal','return']).eq('payment_method','cash').gte('created_at',from).lte('created_at',to)
    let custRefundQ = supabase.from('sales_returns').select('total,created_at,return_no,customers(name),remarks').eq('status','confirmed').eq('payment_method','cash').gte('created_at',from).lte('created_at',to)
    let suppRefundQ = supabase.from('purchase_returns').select('total,created_at,return_no,suppliers(name),remarks').eq('status','confirmed').eq('payment_method','cash').gte('created_at',from).lte('created_at',to)
    let bankWdQ = supabase.from('bank_transactions').select('amount,created_at,reference,notes,bank_accounts(name)').eq('type','withdrawal').gte('created_at',from).lte('created_at',to)

    const [smens,invs,exps,deps,drafts,history,pmts,creds,suppPmts,invOut,custRefunds,suppRefunds,bankWd,openingCashPmts,cashAdjs] = await Promise.all([
      safeQ(supabase.from('salesmen').select('*').order('name')),
      safeQ(invQ), safeQ(expQ), safeQ(depQ), safeQ(draftQ), safeQ(histQ), safeQ(pmtQ),
      safeQ(supabase.from('customers').select('name,customer_no,credit_balance').gt('credit_balance',0).order('credit_balance',{ascending:false})),
      safeQ(suppPmtQ), safeQ(invOutQ), safeQ(custRefundQ), safeQ(suppRefundQ), safeQ(bankWdQ),
      safeQ(openingCashQ),
      cashAdjQ.then(r => r.data || []).catch(e => { console.error('cashAdj error:', e); return [] }),
    ])

    setSalesmen(smens)
    await autoSelectSalesman(smens, session?.user, setSelectedSalesman)
    setAllInvoices(invs); setAllExpenses(exps); setCashCollected(pmts)
    setOpenDrafts(drafts); setShiftHistory(history); setCreditCustomers(creds)

    // Totals
    const cashS = invs.filter(i=>i.payment_method==='cash'||i.payment_method==='partial').reduce((s,i)=>s+(i.amount_paid||0),0)
    const cardS = invs.filter(i=>i.payment_method==='card').reduce((s,i)=>s+(i.amount_paid||0),0)
    const cheqS = invs.filter(i=>i.payment_method==='cheque').reduce((s,i)=>s+(i.amount_paid||0),0)
    const credS = invs.filter(i=>i.payment_method==='credit').reduce((s,i)=>s+(i.total||0),0)
    const totAll = invs.reduce((s,i)=>s+(i.total||0),0)

    const opExps = exps.filter(e =>
      (e.payment_method === 'cash' || !e.payment_method) &&
      e.category !== 'Supplier Payment' &&
      e.category !== 'Bank Withdrawal' &&
      e.category !== 'Investor Payment' &&
      e.category !== 'Sales Return Refund'
    )
    const cashExp = opExps.reduce((s,e)=>s+(e.amount||0),0)
    const cashDep = deps.filter(d=>(d.amount||0)>0).reduce((s,d)=>s+(d.amount||0),0)
    const openingMapped = (openingCashPmts || []).map(p => ({
      amount: p.amount, created_at: p.created_at, payment_method: 'cash',
      invoices: { invoice_no: 'OPEN-BAL', customers: { name: (p.reference||'').replace('Customer: ','') } }
    }))
    const allCashPmts = [...(pmts||[]), ...openingMapped]
    const cashColl = allCashPmts.reduce((s,p)=>s+(p.amount||0),0)
    const suppPmtTotal = suppPmts.reduce((s,p)=>s+(p.amount||0),0)
    const invOutTotal = invOut.reduce((s,p)=>s+(p.amount||0),0)
    const custRefundTotal = custRefunds.reduce((s,r)=>s+(r.total||0),0)
    const suppRefundTotal = suppRefunds.reduce((s,r)=>s+(r.total||0),0)
    const bankWdTotal = bankWd.reduce((s,b)=>s+(b.amount||0),0)

    setCashSalesTotal(cashS); setCardSalesTotal(cardS); setChequeSalesTotal(cheqS)
    setCreditSalesTotal(credS); setTotalSalesAll(totAll)
    setCashExpensesTotal(cashExp); setCashDepositsList(deps.filter(d=>(d.amount||0)>0)); setCashDepositsTotal(cashDep)
    setCashCollectedTotal(cashColl); setCashCollectedList(allCashPmts)
    setCashToSuppliersTotal(suppPmtTotal); setCashToSuppliersList(suppPmts)
    setCashToInvestorsTotal(invOutTotal); setCashToInvestorsList(invOut)
    setCashRefundsToCustomersTotal(custRefundTotal); setCashRefundsToCustomersList(custRefunds)
    setCashRefundsFromSuppliersTotal(suppRefundTotal); setCashRefundsFromSuppliersList(suppRefunds)
    setBankWithdrawalsTotal(bankWdTotal); setBankWithdrawalsList(bankWd)
    setCashExpensesList(opExps)

    // Net expected cash = Cash In − Cash Out
    const totalIn = cashS + cashColl + suppRefundTotal + bankWdTotal
    // Cash adjustments: additions increase cash in hand, deductions decrease it
    const adjList = cashAdjs || []
    const adjIn = adjList.filter(a => a.notes?.startsWith('[+]')).reduce((s, a) => s + (a.amount || 0), 0)
    const adjOut = adjList.filter(a => a.notes?.startsWith('[-]')).reduce((s, a) => s + (a.amount || 0), 0)
    setCashAdjList(adjList)
    setCashAdjIn(adjIn)
    setCashAdjOut(adjOut)
    const totalOut = cashExp + cashDep + suppPmtTotal + invOutTotal + custRefundTotal
    const netCash = totalIn + adjIn - adjOut - totalOut
    setExpectedCash(netCash)

    // Auto-EOS: if today has no shift record, schedule one at midnight
    const todayShift = history.find(h => h.shift_date === todayStr)
    if (!todayShift) {
      const now = new Date()
      const midnight = new Date(today.getTime() + 24*60*60*1000)
      const msUntilMidnight = midnight.getTime() - now.getTime()
      if (msUntilMidnight > 0 && msUntilMidnight < 24*60*60*1000) {
        setTimeout(async () => {
          // Check again at midnight in case user closed shift manually
          const { data: check } = await supabase.from('shift_records')
            .select('id').eq('shift_date', todayStr).limit(1)
          if (!check || check.length === 0) {
            await supabase.from('shift_records').insert({
              shop_id: activeShop?.id,
              shift_date: todayStr,
              expected_cash: expected,
              actual_cash: 0,
              difference: -expected,
              notes: 'EOS not performed — auto-recorded at midnight',
              auto_eos: true,
            })
          }
        }, msUntilMidnight)
      }
    }

    setLoading(false)
  }

  async function handleEndShift() {
    if (openDrafts.length > 0) return toast.error(`${openDrafts.length} draft invoice(s) still open`)
    if (!selectedSalesman) return toast.error('Select your salesman account')
    if (actualCash === '') return toast.error('Enter the physical cash count')
    setSaving(true)
    try {
      const actual = parseFloat(actualCash) || 0
      const diff = actual - (openingCash + expectedCash)
      await supabase.from('shift_records').insert({
        shop_id: activeShop?.id, salesman_id: selectedSalesman.id,
        shift_date: new Date().toISOString().split('T')[0],
        expected_cash: openingCash + expectedCash, actual_cash: actual, difference: diff,
        notes, closed_by: session?.user?.id,
        cash_sales: cashSalesTotal, card_sales: cardSalesTotal,
        cheque_sales: chequeSalesTotal, credit_sales: creditSalesTotal,
        total_sales: totalSalesAll, total_expenses: cashExpensesTotal,
      })
      // Carry forward: update shop's opening cash for next shift
      if (activeShop?.id) {
        await supabase.from('shops').update({ cash_in_hand: actual }).eq('id', activeShop.id)
      }
      toast.success('Shift closed! Opening cash updated to LKR ' + actual.toLocaleString('en-LK', { minimumFractionDigits: 2 }))
      printReport(actual, diff)
      setActualCash(''); setNotes(''); fetchData()
    } catch (e) { toast.error('Failed: ' + e.message) }
    setSaving(false)
  }

  const fmt = n => parseFloat(n||0).toLocaleString('en-LK',{minimumFractionDigits:2})

  async function printShiftRecord(r) {
    const shop = r.shops?.name || activeShop?.name || 'Phonefix'
    const shiftDate = new Date(r.shift_date + 'T12:00:00').toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
    const printedAt = new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
    const d = r.difference || 0
    const isAuto = r.auto_eos || r.notes?.includes('EOS not performed')

    // Fetch all transactions for this shift date
    const dayStart = r.shift_date + 'T00:00:00'
    const dayEnd = r.shift_date + 'T23:59:59'
    const shopId = r.shop_id || activeShop?.id
    let invQ = supabase.from('invoices').select('invoice_no, payment_method, amount_paid, total, credit_amount, created_at, customers(name)').eq('status', 'confirmed').gte('created_at', dayStart).lte('created_at', dayEnd)
    if (shopId) invQ = invQ.eq('shop_id', shopId)
    const { data: dayInvoices } = await invQ.order('created_at')
    const invs = dayInvoices || []

    const cashInvs = invs.filter(i=>i.payment_method==='cash'||i.payment_method==='partial')
    const cardInvs = invs.filter(i=>i.payment_method==='card')
    const chequeInvs = invs.filter(i=>i.payment_method==='cheque')
    const creditInvs = invs.filter(i=>i.payment_method==='credit')
    const fmtT = n => parseFloat(n||0).toLocaleString('en-LK',{minimumFractionDigits:2})
    const timeOf = dt => new Date(dt).toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'})
    const subTbl = rows => rows.length===0?'':`<table style="margin-left:8px;margin-bottom:3px;width:calc(100% - 8px)"><tbody>${rows.join('')}</tbody></table>`

    const w = window.open('', '_blank')
    w.document.write(`<!DOCTYPE html><html><head><title>EOS ${shiftDate}</title>
    <style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:Arial,sans-serif;font-size:12px;font-weight:bold;color:#000;width:80mm;margin:0 auto;padding:4px}.c{text-align:center}.b{font-weight:bold}.r{text-align:right}.div{border-top:1px dashed #000;margin:4px 0}.divs{border-top:2px solid #000;margin:4px 0}.row{display:flex;justify-content:space-between;padding:2px 0;font-weight:bold}.header-band{background:#fff;color:#000;text-align:center;padding:8px 4px 6px;margin:-4px -4px 4px;border-bottom:2px solid #000}@media print{body{padding:0 0 60mm 0}@page{size:80mm auto;margin:1mm 1mm 0 1mm}}</style>
    </head><body>
    <div class="header-band">
      <div style="font-size:16px;font-weight:900;letter-spacing:1px;color:#000">PHONEFIX (PVT) LTD</div>
      <div style="font-size:9px;letter-spacing:2px;color:#000;margin-top:2px;font-weight:900">YOUR TRUSTED TECHNOLOGY PARTNER</div>
    </div>
    <div class="c b" style="font-size:13px;letter-spacing:1px">END OF SHIFT REPORT</div>
    <div class="c" style="font-size:11px">${shiftDate}</div>
    <div class="c" style="font-size:11px">Cashier: ${r.salesmen?.name || '—'}</div>
    <div class="divs"></div>

    <div class="row b"><span>SALES SUMMARY</span></div>
    <div class="div"></div>
    <div class="row"><span>Total Sales</span><span>LKR ${fmt(r.total_sales || 0)}</span></div>
    <div class="divs"></div>

    <div class="row b"><span>CASH RECONCILIATION</span></div>
    <div class="div"></div>
    <div class="row"><span>System Cash Balance</span><span>LKR ${fmt(r.expected_cash || 0)}</span></div>
    <div class="row b" style="font-size:13px"><span>Physical Count</span><span>${isAuto ? '— (Not done)' : 'LKR ' + fmt(r.actual_cash || 0)}</span></div>
    <div class="div"></div>
    <div class="row b" style="font-size:13px"><span>DIFFERENCE</span><span>${isAuto ? 'EOS not performed' : (d >= 0 ? '+' : '') + 'LKR ' + fmt(Math.abs(d)) + ' ' + (Math.abs(d) < 0.01 ? '(MATCH)' : d > 0 ? '(OVER)' : '(SHORT)')}</span></div>
    ${r.notes ? `<div class="div"></div><div class="row"><span>Notes: ${r.notes.replace('[EOS not performed]', '').trim()}</span></div>` : ''}

    ${cashInvs.length>0?`<div class="divs"></div><div class="row b"><span>CASH INVOICES (${cashInvs.length})</span></div><div class="div"></div>
    ${subTbl(cashInvs.map(i=>`<tr><td style="font-size:10px;padding:1px 3px">${timeOf(i.created_at)}</td><td style="font-size:10px;padding:1px 3px">${i.invoice_no}</td><td style="font-size:10px;padding:1px 3px">${i.customers?.name||'—'}</td><td style="font-size:10px;padding:1px 3px;text-align:right">${fmtT(i.amount_paid)}</td></tr>`))}`:``}

    ${cardInvs.length>0?`<div class="divs"></div><div class="row b"><span>CARD INVOICES (${cardInvs.length})</span></div><div class="div"></div>
    ${subTbl(cardInvs.map(i=>`<tr><td style="font-size:10px;padding:1px 3px">${timeOf(i.created_at)}</td><td style="font-size:10px;padding:1px 3px">${i.invoice_no}</td><td style="font-size:10px;padding:1px 3px">${i.customers?.name||'—'}</td><td style="font-size:10px;padding:1px 3px;text-align:right">${fmtT(i.amount_paid)}</td></tr>`))}`:``}

    ${chequeInvs.length>0?`<div class="divs"></div><div class="row b"><span>CHEQUE INVOICES (${chequeInvs.length})</span></div><div class="div"></div>
    ${subTbl(chequeInvs.map(i=>`<tr><td style="font-size:10px;padding:1px 3px">${timeOf(i.created_at)}</td><td style="font-size:10px;padding:1px 3px">${i.invoice_no}</td><td style="font-size:10px;padding:1px 3px">${i.customers?.name||'—'}</td><td style="font-size:10px;padding:1px 3px;text-align:right">${fmtT(i.amount_paid)}</td></tr>`))}`:``}

    ${creditInvs.length>0?`<div class="divs"></div><div class="row b"><span>CREDIT INVOICES (${creditInvs.length})</span></div><div class="div"></div>
    ${subTbl(creditInvs.map(i=>`<tr><td style="font-size:10px;padding:1px 3px">${timeOf(i.created_at)}</td><td style="font-size:10px;padding:1px 3px">${i.invoice_no}</td><td style="font-size:10px;padding:1px 3px">${i.customers?.name||'—'}</td><td style="font-size:10px;padding:1px 3px;text-align:right">${fmtT(i.total)}</td></tr>`))}`:``}

    <div class="divs"></div>
    <div class="c" style="font-size:10px">Reprinted at ${printedAt}</div>
    <div class="c" style="font-size:9px;margin-top:3px">Designed for Phonefix (PVT) Ltd · Powered by Techmo Solutions</div>
    <div style='height:60mm'></div><script>window.onload=function(){window.print()}<\/script>
    </body></html>`)
    w.document.close()
  }

  function printReport(actualAmt, diffAmt) {
    const w = window.open('','_blank')
    const now = new Date()
    const shop = activeShop?.name || 'Phonefix'
    const t = n => `<tr><td>${new Date(n.created_at).toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'})}</td>`
    const cashInvs = allInvoices.filter(i=>i.payment_method==='cash'||i.payment_method==='partial')
    const cardInvs = allInvoices.filter(i=>i.payment_method==='card')
    const chequeInvs = allInvoices.filter(i=>i.payment_method==='cheque')
    const creditInvs = allInvoices.filter(i=>i.payment_method==='credit')

    // Helper to render a detail sub-table
    const detailTable = (rows) => rows.length === 0 ? '' :
      `<table style="margin-left:8px;margin-bottom:3px"><tbody>${rows}</tbody></table>`

    w.document.write(`<!DOCTYPE html><html><head><title>EOS ${shop}</title>
    <style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:Arial,sans-serif;font-size:12px;font-weight:bold;color:#000;width:80mm;margin:0 auto;padding:4px}.c{text-align:center}.b{font-weight:bold}.r{text-align:right}.div{border-top:1px dashed #000;margin:4px 0}.divs{border-top:2px solid #000;margin:4px 0}table{width:100%;border-collapse:collapse}td,th{padding:2px 3px;font-size:11px;font-weight:bold;color:#000}th{font-weight:900;border-bottom:1.5px solid #000}.cr{color:#000;font-weight:900}.ok{color:#000;font-weight:900}.row{display:flex;justify-content:space-between;padding:2px 0;font-weight:bold}.sub td{font-size:10px;color:#000;padding:1px 3px;font-weight:600}.header-band{background:#fff;color:#000;text-align:center;padding:8px 4px 6px;margin:-4px -4px 4px;border-bottom:2px solid #000}@media print{body{padding:0 0 60mm 0}@page{size:80mm auto;margin:1mm 1mm 0 1mm}}</style>
    </head><body>
    <div class="header-band">
      <div style="font-size:16px;font-weight:900;letter-spacing:1px;color:#000">PHONEFIX (PVT) LTD</div>
      <div style="font-size:9px;letter-spacing:2px;color:#000;margin-top:2px;font-weight:900">YOUR TRUSTED TECHNOLOGY PARTNER</div>
    </div>
    <div class="c b" style="font-size:13px;letter-spacing:1px">END OF SHIFT REPORT</div>
    <div class="c" style="font-size:11px">${now.toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'})} &nbsp; ${now.toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'})}</div>
    <div class="c" style="font-size:11px">Cashier: ${selectedSalesman?.name||'—'}</div>
    <div class="divs"></div>

    <div class="row b"><span>SALES SUMMARY</span></div>
    <div class="div"></div>
    <div class="row"><span>Total Invoices</span><span>${allInvoices.length}</span></div>
    <div class="row b"><span>Total Sales</span><span>LKR ${fmt(totalSalesAll)}</span></div>
    <div class="div"></div>
    <div class="row"><span>Cash Sales (${cashInvs.length})</span><span>LKR ${fmt(cashSalesTotal)}</span></div>
    <div class="row"><span>Card Sales (${cardInvs.length})</span><span>LKR ${fmt(cardSalesTotal)}</span></div>
    <div class="row"><span>Cheque Sales (${chequeInvs.length})</span><span>LKR ${fmt(chequeSalesTotal)}</span></div>
    <div class="row"><span>Credit Given (${creditInvs.length})</span><span class="cr">LKR ${fmt(creditSalesTotal)}</span></div>
    <div class="row"><span>Credits Collected (cash)</span><span>LKR ${fmt(cashCollectedTotal)}</span></div>

    <div class="divs"></div>
    <div class="row b"><span>CASH RECONCILIATION</span></div>
    <div class="div"></div>

    <div class="row"><span>+ Cash Sales</span><span>LKR ${fmt(cashSalesTotal)}</span></div>
    ${detailTable(cashInvs.map(i=>`<tr class="sub"><td>${new Date(i.created_at).toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'})}</td><td>${i.invoice_no} · ${i.customers?.name||'—'}</td><td class="r">${fmt(i.amount_paid)}</td></tr>`).join(''))}

    <div class="row"><span>+ Credits Collected (cash)</span><span>LKR ${fmt(cashCollectedTotal)}</span></div>
    ${detailTable(cashCollectedList.map(p=>`<tr class="sub"><td>${new Date(p.created_at).toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'})}</td><td>${p.invoices?.invoice_no||'—'} · ${p.invoices?.customers?.name||'—'}</td><td class="r">${fmt(p.amount)}</td></tr>`).join(''))}

    ${cashRefundsFromSuppliersTotal>0?`<div class="row"><span>+ Supplier Cash Refunds</span><span>LKR ${fmt(cashRefundsFromSuppliersTotal)}</span></div>
    ${detailTable(cashRefundsFromSuppliersList.map(r=>`<tr class="sub"><td>${new Date(r.created_at).toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'})}</td><td>${r.return_no||'RET'} · ${r.suppliers?.name||'—'}</td><td class="r">${fmt(r.total)}</td></tr>`).join(''))}`:'' }

    ${bankWithdrawalsTotal>0?`<div class="row"><span>+ Bank Withdrawals (cash in)</span><span>LKR ${fmt(bankWithdrawalsTotal)}</span></div>
    ${detailTable(bankWithdrawalsList.map(b=>`<tr class="sub"><td>${new Date(b.created_at).toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'})}</td><td>${b.bank_accounts?.name||'Bank'} · ${b.reference||b.notes||'Withdrawal'}</td><td class="r">${fmt(b.amount)}</td></tr>`).join(''))}`:'' }

    <div class="div"></div>

    ${allExpenses.length>0?`<div class="row cr b"><span>EXPENSES (${allExpenses.length})</span><span>LKR ${fmt(allExpenses.reduce((s,e)=>s+(e.amount||0),0))}</span></div>
    ${detailTable(allExpenses.map(e=>`<tr class="sub"><td>${new Date(e.created_at).toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'})}</td><td>${e.description||e.category||'—'}</td><td style="font-size:9px;padding:1px 3px">${e.payment_method||'cash'}</td><td class="r">${fmt(e.amount)}</td></tr>`).join(''))}
    <div class="row cr"><span>- Cash Expenses</span><span>LKR ${fmt(cashExpensesTotal)}</span></div>`:
    '<div class="row"><span>No expenses today</span><span>—</span></div>'}

    ${cashToSuppliersTotal>0?`<div class="row cr"><span>- Cash Paid to Suppliers</span><span>LKR ${fmt(cashToSuppliersTotal)}</span></div>
    ${detailTable(cashToSuppliersList.map(p=>`<tr class="sub"><td>${new Date(p.created_at).toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'})}</td><td>${p.purchases?.purchase_no||'—'} · ${p.purchases?.suppliers?.name||'—'}</td><td class="r">${fmt(p.amount)}</td></tr>`).join(''))}`:'' }

    ${cashToInvestorsTotal>0?`<div class="row cr"><span>- Cash Paid to Investors</span><span>LKR ${fmt(cashToInvestorsTotal)}</span></div>
    ${detailTable(cashToInvestorsList.map(p=>`<tr class="sub"><td>${new Date(p.created_at).toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'})}</td><td>${p.investors?.name||p.notes||'—'}</td><td class="r">${fmt(p.amount)}</td></tr>`).join(''))}`:'' }

    ${cashRefundsToCustomersTotal>0?`<div class="row cr"><span>- Refunds Paid to Customers</span><span>LKR ${fmt(cashRefundsToCustomersTotal)}</span></div>
    ${detailTable(cashRefundsToCustomersList.map(r=>`<tr class="sub"><td>${new Date(r.created_at).toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'})}</td><td>${r.return_no||'RET'} · ${r.customers?.name||'—'}</td><td class="r">${fmt(r.total)}</td></tr>`).join(''))}`:'' }

    ${cashDepositsTotal>0?`<div class="row cr"><span>- Cash Deposited to Bank</span><span>LKR ${fmt(cashDepositsTotal)}</span></div>
    ${detailTable(cashDepositsList.map(d=>`<tr class="sub"><td>${new Date(d.created_at).toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'})}</td><td>${d.notes||'Bank deposit'}</td><td class="r">${fmt(d.amount)}</td></tr>`).join(''))}`:'' }

    <div class="divs"></div>
    <div class="row"><span>Opening Cash in Hand</span><span>LKR ${fmt(openingCash)}</span></div>
    <div class="row"><span>Net Cash Movement</span><span>LKR ${fmt(expectedCash)}</span></div>
    <div class="row b" style="font-size:13px"><span>Expected Cash in Till</span><span>LKR ${fmt(openingCash + expectedCash)}</span></div>
    <div class="row b" style="font-size:13px"><span>Physical Count</span><span>LKR ${fmt(actualAmt)}</span></div>
    <div class="div"></div>
    <div class="row b ${Math.abs(diffAmt)<0.01?'ok':diffAmt>0?'ok':'cr'}" style="font-size:13px"><span>DIFFERENCE</span><span>${diffAmt>=0?'+':''}LKR ${fmt(Math.abs(diffAmt))} ${Math.abs(diffAmt)<0.01?'(MATCH)':diffAmt>0?'(OVER)':'(SHORT)'}</span></div>

    ${cardInvs.length>0?`
    <div class="divs"></div><div class="row b"><span>CARD INVOICES (${cardInvs.length})</span></div><div class="div"></div>
    <table><thead><tr><th>Time</th><th>Invoice</th><th>Customer</th><th class="r">Amt</th></tr></thead><tbody>
    ${cardInvs.map(i=>`<tr><td>${new Date(i.created_at).toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'})}</td><td>${i.invoice_no}</td><td>${i.customers?.name||'—'}</td><td class="r">${fmt(i.amount_paid)}</td></tr>`).join('')}
    </tbody></table>`:''}

    ${chequeInvs.length>0?`
    <div class="divs"></div><div class="row b"><span>CHEQUE INVOICES (${chequeInvs.length})</span></div><div class="div"></div>
    <table><thead><tr><th>Time</th><th>Invoice</th><th>Customer</th><th class="r">Amt</th></tr></thead><tbody>
    ${chequeInvs.map(i=>`<tr><td>${new Date(i.created_at).toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'})}</td><td>${i.invoice_no}</td><td>${i.customers?.name||'—'}</td><td class="r">${fmt(i.amount_paid)}</td></tr>`).join('')}
    </tbody></table>`:''}

    ${creditInvs.length>0?`
    <div class="divs"></div><div class="row b cr"><span>CREDIT INVOICES (${creditInvs.length})</span></div><div class="div"></div>
    <table><thead><tr><th>Time</th><th>Invoice</th><th>Customer</th><th class="r">Total</th></tr></thead><tbody>
    ${creditInvs.map(i=>`<tr><td>${new Date(i.created_at).toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'})}</td><td>${i.invoice_no}</td><td>${i.customers?.name||'—'}</td><td class="r cr">${fmt(i.total)}</td></tr>`).join('')}
    </tbody></table>`:''}

    ${notes?`<div class="div"></div><div class="row"><span>Notes: ${notes}</span></div>`:''}
    <div class="divs"></div>
    <div class="c" style="font-size:11px">Closed at ${now.toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'})}</div>
    <div class="c" style="font-size:9px;margin-top:3px">Designed for Phonefix (PVT) Ltd · Powered by Techmo Solutions</div>
    <div style='height:60mm'></div><script>window.onload=function(){window.print()}<\/script>
    </body></html>`)
    w.document.close()
  }

  const actual = parseFloat(actualCash) || 0
  const totalExpected = openingCash + expectedCash
  const difference = actualCash !== '' ? actual - totalExpected : null
  const cashInvs = allInvoices.filter(i=>i.payment_method==='cash'||i.payment_method==='partial')
  const cardInvs = allInvoices.filter(i=>i.payment_method==='card')
  const chequeInvs = allInvoices.filter(i=>i.payment_method==='cheque')
  const creditInvs = allInvoices.filter(i=>i.payment_method==='credit')

  if (view === 'history') return (
    <div style={{maxWidth:'900px'}}>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:'24px'}}>
        <h1 style={{fontSize:'22px',fontWeight:'700',color:'#0f172a',margin:0}}>Shift History</h1>
        <button onClick={()=>{setSelectedShift(null);setView('end')}} style={{padding:'9px 18px',background:'#f1f5f9',color:'#475569',border:'none',borderRadius:'8px',cursor:'pointer',fontWeight:'600'}}>← Back</button>
      </div>
      {selectedShift ? (
        <div style={card}>
          {/* Auto EOS banner */}
          {(selectedShift.auto_eos || selectedShift.notes?.includes('EOS not performed')) && (
            <div style={{background:'#fff7ed',border:'2px solid #fed7aa',borderRadius:'10px',padding:'12px 16px',marginBottom:'16px',display:'flex',alignItems:'center',gap:'10px'}}>
              <span style={{fontSize:'20px'}}>⚠️</span>
              <div>
                <div style={{fontSize:'14px',fontWeight:'700',color:'#92400e'}}>EOS Not Performed</div>
                <div style={{fontSize:'12px',color:'#b45309'}}>This shift was auto-recorded at midnight. Physical cash count was not done.</div>
              </div>
            </div>
          )}
          <div style={{display:'flex',justifyContent:'space-between',marginBottom:'16px'}}>
            <div>
              <h2 style={{fontSize:'16px',fontWeight:'800',color:'#0f172a',margin:'0 0 4px'}}>{new Date(selectedShift.shift_date+'T12:00:00').toLocaleDateString('en-GB',{weekday:'long',day:'2-digit',month:'long',year:'numeric'})}</h2>
              <p style={{fontSize:'13px',color:'#64748b',margin:0}}>Cashier: {selectedShift.salesmen?.name||'—'}</p>
            </div>
            <button onClick={()=>setSelectedShift(null)} style={{background:'#f1f5f9',border:'none',borderRadius:'7px',padding:'6px 14px',cursor:'pointer',color:'#64748b',fontWeight:'600',fontSize:'12px'}}>← All Shifts</button>
          </div>
          <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:'12px',marginBottom:'16px'}}>
            {[
              {l:'Total Sales',v:formatCurrency(selectedShift.total_sales||0),c:'#0f172a'},
              {l:'Cash Sales',v:formatCurrency(selectedShift.cash_sales||0),c:'#059669'},
              {l:'Card Sales',v:formatCurrency(selectedShift.card_sales||0),c:'#0891b2'},
              {l:'Cheque Sales',v:formatCurrency(selectedShift.cheque_sales||0),c:'#7c3aed'},
              {l:'Credit Given',v:formatCurrency(selectedShift.credit_sales||0),c:'#e11d48'},
              {l:'Cash Expenses',v:formatCurrency(selectedShift.total_expenses||0),c:'#d97706'},
            ].map(s=>(
              <div key={s.l} style={{background:'#f8fafc',borderRadius:'8px',padding:'12px',borderLeft:`3px solid ${s.c}`}}>
                <div style={{fontSize:'11px',fontWeight:'700',color:'#94a3b8',textTransform:'uppercase',marginBottom:'3px'}}>{s.l}</div>
                <div style={{fontSize:'16px',fontWeight:'800',color:s.c}}>{s.v}</div>
              </div>
            ))}
          </div>
          <div style={{background:'#f8fafc',borderRadius:'10px',padding:'16px'}}>
            <h3 style={{fontSize:'12px',fontWeight:'700',color:'#94a3b8',textTransform:'uppercase',letterSpacing:'0.06em',marginBottom:'12px'}}>Cash Reconciliation</h3>
            {[
              {l:'System Cash Balance',v:formatCurrency(selectedShift.expected_cash||0)},
              {l:'Physical Cash Counted',v:formatCurrency(selectedShift.actual_cash||0)},
            ].map(r=>(
              <div key={r.l} style={{display:'flex',justifyContent:'space-between',padding:'7px 0',borderBottom:'1px solid #e2e8f0',fontSize:'14px',fontWeight:'600'}}>
                <span style={{color:'#64748b'}}>{r.l}</span><span style={{color:'#0f172a'}}>{r.v}</span>
              </div>
            ))}
            <div style={{display:'flex',justifyContent:'space-between',padding:'10px 0',fontSize:'17px',fontWeight:'900',
              color:Math.abs(selectedShift.difference||0)<0.01?'#059669':(selectedShift.difference||0)>0?'#059669':'#e11d48'}}>
              <span>Difference</span>
              <span>{(selectedShift.difference||0)>=0?'+':''}{formatCurrency(selectedShift.difference||0)} {Math.abs(selectedShift.difference||0)<0.01?'✓ BALANCED':(selectedShift.difference||0)>0?'OVER':'SHORT'}</span>
            </div>
          </div>
          {selectedShift.notes&&<p style={{fontSize:'13px',color:'#64748b',marginTop:'12px'}}>Notes: {selectedShift.notes}</p>}
        </div>
      ) : (
        <div style={card}>
          {shiftHistory.length===0?<div style={{padding:'40px',textAlign:'center',color:'#94a3b8'}}>No shift records yet</div>:(
            <table style={{width:'100%',borderCollapse:'collapse'}}>
              <thead>
                <tr style={{background:'#f8fafc',borderBottom:'2px solid #e2e8f0'}}>
                  {[...(!activeShop ? ['Shop'] : []), 'Date','Cashier','Total Sales','Sys Balance','Physical Count','Difference',''].map(h=>(
                    <th key={h} style={{padding:'10px 14px',textAlign:'left',fontSize:'11px',fontWeight:'700',color:'#94a3b8',textTransform:'uppercase'}}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {shiftHistory.map((r,i)=>{
                  const d=r.difference||0
                  const isAuto = r.auto_eos || r.notes?.includes('EOS not performed')
                  return (
                    <tr key={r.id} style={{borderBottom:'1px solid #f1f5f9',background:isAuto?'#fff7ed':i%2===0?'white':'#fafafa',cursor:'pointer'}}
                      onMouseEnter={e=>e.currentTarget.style.background='#eef2ff'}
                      onMouseLeave={e=>e.currentTarget.style.background=isAuto?'#fff7ed':i%2===0?'white':'#fafafa'}
                      onClick={()=>setSelectedShift(r)}>
                      {!activeShop && <td style={{padding:'11px 14px',fontSize:'13px',fontWeight:'600',color:'#2563eb'}}>{r.shops?.name||'—'}</td>}
                      <td style={{padding:'11px 14px',fontSize:'13px',color:'#64748b'}}>
                        {new Date(r.shift_date+'T12:00:00').toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'})}
                        {isAuto&&<span style={{marginLeft:'6px',background:'#fef3c7',color:'#92400e',padding:'1px 6px',borderRadius:'6px',fontSize:'10px',fontWeight:'700'}}>⚠ AUTO</span>}
                      </td>
                      <td style={{padding:'11px 14px',fontWeight:'600',color:'#0f172a'}}>{isAuto?<span style={{color:'#d97706',fontStyle:'italic'}}>Not performed</span>:r.salesmen?.name||'—'}</td>
                      <td style={{padding:'11px 14px',fontWeight:'700',color:'#0f172a'}}>{formatCurrency(r.total_sales||0)}</td>
                      <td style={{padding:'11px 14px',color:'#0369a1',fontWeight:'600'}}>{formatCurrency(r.expected_cash||0)}</td>
                      <td style={{padding:'11px 14px',color:isAuto?'#d97706':'#0f172a',fontWeight:'600',fontStyle:isAuto?'italic':'normal'}}>{isAuto?'—':formatCurrency(r.actual_cash||0)}</td>
                      <td style={{padding:'11px 14px',fontWeight:'800',color:isAuto?'#d97706':Math.abs(d)<0.01?'#059669':d>0?'#059669':'#e11d48'}}>
                        {isAuto?'EOS not done':d>=0?'+':''}{isAuto?'':formatCurrency(d)+' '+(Math.abs(d)<0.01?'✓':d>0?'↑ OVER':'↓ SHORT')}
                      </td>
                      <td style={{padding:'8px 14px'}} onClick={e=>e.stopPropagation()}>
                        <button onClick={e=>{e.stopPropagation();printShiftRecord(r)}}
                          style={{padding:'4px 10px',background:'#eef2ff',color:'#1e40af',border:'none',borderRadius:'6px',cursor:'pointer',fontSize:'12px',fontWeight:'700',whiteSpace:'nowrap'}}>
                          🖨 Print
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  )

  return (
    <div style={{maxWidth:'960px'}}>
      <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:'24px'}}>
        <div>
          <h1 style={{fontSize:'22px',fontWeight:'700',color:'#0f172a',margin:'0 0 4px'}}>End of Shift</h1>
          <p style={{color:'#64748b',fontSize:'13px',margin:0}}>
            {new Date().toLocaleDateString('en-GB',{weekday:'long',day:'2-digit',month:'long',year:'numeric'})}
            {activeShop?.name&&<span style={{marginLeft:'8px',background:'#eef2ff',color:'#1e40af',padding:'2px 8px',borderRadius:'10px',fontSize:'12px',fontWeight:'700'}}>{activeShop.name}</span>}
          </p>
        </div>
        <button onClick={()=>setView('history')} style={{padding:'9px 18px',background:'#f1f5f9',color:'#475569',border:'none',borderRadius:'8px',cursor:'pointer',fontWeight:'600',fontSize:'13px'}}>📋 Shift History</button>
      </div>

      {loading ? (
        <div style={{padding:'80px',textAlign:'center',color:'#94a3b8',fontSize:'16px'}}><div style={{fontSize:'32px',marginBottom:'12px'}}>⏳</div>Loading today's data...</div>
      ) : (<>

        {openDrafts.length>0&&(
          <div style={{background:'#fff5f5',border:'2px solid #fecaca',borderRadius:'10px',padding:'14px 18px',marginBottom:'16px',display:'flex',alignItems:'center',gap:'12px'}}>
            <span style={{fontSize:'20px'}}>⚠️</span>
            <div>
              <div style={{fontWeight:'700',color:'#e11d48',fontSize:'14px'}}>{openDrafts.length} draft invoice(s) still open — close before ending shift</div>
              <div style={{fontSize:'12px',color:'#64748b',marginTop:'2px'}}>{openDrafts.map(d=>d.invoice_no).join(', ')}</div>
            </div>
          </div>
        )}

        {/* SALES SUMMARY */}
        <div style={card}>
          <h2 style={{fontSize:'15px',fontWeight:'800',color:'#0f172a',margin:'0 0 16px'}}>📊 Today's Sales Summary</h2>
          <div style={{display:'grid',gridTemplateColumns:'repeat(5,1fr)',gap:'12px',marginBottom:'16px'}}>
            {[
              {label:'Total Sales',value:totalSalesAll,sub:`${allInvoices.length} invoices`,color:'#0f172a',bg:'#f8fafc'},
              {label:'Cash',value:cashSalesTotal,sub:`${cashInvs.length} inv`,color:'#059669',bg:'#f0fdf4'},
              {label:'Card',value:cardSalesTotal,sub:`${cardInvs.length} inv`,color:'#0891b2',bg:'#f0f9ff'},
              {label:'Cheque',value:chequeSalesTotal,sub:`${chequeInvs.length} inv`,color:'#7c3aed',bg:'#f5f3ff'},
              {label:'Credit Given',value:creditSalesTotal,sub:`${creditInvs.length} inv`,color:'#e11d48',bg:'#fff5f5'},
            ].map(s=>(
              <div key={s.label} style={{background:s.bg,borderRadius:'10px',padding:'14px',borderLeft:`4px solid ${s.color}`}}>
                <div style={{fontSize:'11px',fontWeight:'700',color:'#94a3b8',textTransform:'uppercase',letterSpacing:'0.05em',marginBottom:'4px'}}>{s.label}</div>
                <div style={{fontSize:'18px',fontWeight:'800',color:s.color}}>{formatCurrency(s.value)}</div>
                <div style={{fontSize:'11px',color:'#94a3b8',marginTop:'2px'}}>{s.sub}</div>
              </div>
            ))}
          </div>
          {allInvoices.length>0&&(
            <details>
              <summary style={{cursor:'pointer',fontSize:'13px',fontWeight:'600',color:'#2563eb',padding:'8px 0',userSelect:'none'}}>View all {allInvoices.length} invoices ▾</summary>
              <div style={{marginTop:'8px',overflow:'auto',maxHeight:'280px'}}>
                <table style={{width:'100%',borderCollapse:'collapse',fontSize:'12px'}}>
                  <thead style={{position:'sticky',top:0,background:'#f8fafc'}}>
                    <tr style={{borderBottom:'2px solid #e2e8f0'}}>
                      {['Time','Invoice','Customer','Salesman','Total','Paid','Due','Method'].map(h=>(
                        <th key={h} style={{padding:'7px 10px',textAlign:'left',fontWeight:'700',color:'#94a3b8',textTransform:'uppercase',fontSize:'10px',whiteSpace:'nowrap'}}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {allInvoices.map((inv,i)=>(
                      <tr key={inv.id||i} style={{borderBottom:'1px solid #f1f5f9',background:(inv.credit_amount||0)>0?'#fff5f5':i%2===0?'white':'#fafafa'}}>
                        <td style={{padding:'6px 10px',color:'#94a3b8'}}>{new Date(inv.created_at).toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'})}</td>
                        <td style={{padding:'6px 10px',fontWeight:'700',color:'#2563eb'}}>{inv.invoice_no}</td>
                        <td style={{padding:'6px 10px',color:'#0f172a'}}>{inv.customers?.name||'—'}</td>
                        <td style={{padding:'6px 10px',color:'#64748b'}}>{inv.salesmen?.name||'—'}</td>
                        <td style={{padding:'6px 10px',fontWeight:'700',color:'#0f172a'}}>{formatCurrency(inv.total)}</td>
                        <td style={{padding:'6px 10px',fontWeight:'600',color:'#059669'}}>{formatCurrency(inv.amount_paid||0)}</td>
                        <td style={{padding:'6px 10px',fontWeight:'600',color:(inv.credit_amount||0)>0?'#e11d48':'#94a3b8'}}>{(inv.credit_amount||0)>0?formatCurrency(inv.credit_amount):'—'}</td>
                        <td style={{padding:'6px 10px'}}><span style={{background:'#f1f5f9',color:'#475569',padding:'1px 6px',borderRadius:'8px',fontSize:'10px',fontWeight:'700',textTransform:'capitalize'}}>{(inv.payment_method||'').replace('_',' ')}</span></td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr style={{background:'#f8fafc',borderTop:'2px solid #e2e8f0',fontWeight:'800'}}>
                      <td colSpan={4} style={{padding:'8px 10px',fontSize:'12px',color:'#0f172a'}}>TOTALS</td>
                      <td style={{padding:'8px 10px',color:'#0f172a'}}>{formatCurrency(totalSalesAll)}</td>
                      <td style={{padding:'8px 10px',color:'#059669'}}>{formatCurrency(allInvoices.reduce((s,i)=>s+(i.amount_paid||0),0))}</td>
                      <td style={{padding:'8px 10px',color:'#e11d48'}}>{formatCurrency(allInvoices.reduce((s,i)=>s+(i.credit_amount||0),0))}</td>
                      <td></td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </details>
          )}
        </div>

        {/* EXPENSES — only operational cash expenses */}
        {(() => {
          const displayExps = allExpenses.filter(e =>
            (e.payment_method === 'cash' || !e.payment_method) &&
            e.category !== 'Supplier Payment' &&
            e.category !== 'Bank Withdrawal' &&
            e.category !== 'Investor Payment' &&
            e.category !== 'Sales Return Refund'
          )
          if (displayExps.length === 0) return null
          return (
            <div style={card}>
              <h2 style={{fontSize:'15px',fontWeight:'800',color:'#0f172a',margin:'0 0 14px'}}>💸 Today's Cash Expenses</h2>
              <table style={{width:'100%',borderCollapse:'collapse',fontSize:'13px'}}>
                <thead><tr style={{background:'#f8fafc',borderBottom:'2px solid #e2e8f0'}}>
                  {['Time','Description','Category','Amount'].map(h=>(
                    <th key={h} style={{padding:'8px 12px',textAlign:'left',fontSize:'11px',fontWeight:'700',color:'#94a3b8',textTransform:'uppercase'}}>{h}</th>
                  ))}
                </tr></thead>
                <tbody>
                  {displayExps.map((exp,i)=>(
                    <tr key={exp.id||i} style={{borderBottom:'1px solid #f1f5f9',background:i%2===0?'white':'#fafafa'}}>
                      <td style={{padding:'8px 12px',color:'#94a3b8'}}>{new Date(exp.created_at).toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'})}</td>
                      <td style={{padding:'8px 12px',color:'#0f172a'}}>{exp.description||'—'}</td>
                      <td style={{padding:'8px 12px',color:'#64748b'}}>{exp.category||'—'}</td>
                      <td style={{padding:'8px 12px',fontWeight:'700',color:'#e11d48'}}>{formatCurrency(exp.amount)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr style={{background:'#f8fafc',borderTop:'2px solid #e2e8f0'}}>
                    <td colSpan={3} style={{padding:'8px 12px',fontWeight:'700',color:'#0f172a'}}>Total Cash Expenses</td>
                    <td style={{padding:'8px 12px',fontWeight:'800',color:'#e11d48',fontSize:'14px'}}>{formatCurrency(displayExps.reduce((s,e)=>s+(e.amount||0),0))}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )
        })()}

        {/* OUTSTANDING CREDITS */}
        {creditCustomers.length>0&&(
          <div style={card}>
            <h2 style={{fontSize:'15px',fontWeight:'800',color:'#0f172a',margin:'0 0 14px'}}>⏳ Outstanding Credits ({creditCustomers.length} customers)</h2>
            <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(200px,1fr))',gap:'10px',marginBottom:'12px'}}>
              {creditCustomers.slice(0,9).map((c,i)=>(
                <div key={c.customer_no||i} style={{background:'#fff5f5',border:'1px solid #fecaca',borderRadius:'8px',padding:'12px'}}>
                  <div style={{fontSize:'13px',fontWeight:'700',color:'#0f172a',marginBottom:'2px'}}>{c.name}</div>
                  <div style={{fontSize:'11px',color:'#94a3b8',marginBottom:'4px'}}>{c.customer_no}</div>
                  <div style={{fontSize:'16px',fontWeight:'800',color:'#e11d48'}}>{formatCurrency(c.credit_balance)}</div>
                </div>
              ))}
            </div>
            <div style={{padding:'10px 14px',background:'#fff5f5',borderRadius:'8px',fontSize:'13px',color:'#e11d48',fontWeight:'700'}}>
              Total Outstanding: {formatCurrency(creditCustomers.reduce((s,c)=>s+(c.credit_balance||0),0))}
            </div>
          </div>
        )}

        {/* CASH RECONCILIATION */}
        <div style={{...card,border:'2px solid #2563eb'}}>
          <h2 style={{fontSize:'15px',fontWeight:'800',color:'#0f172a',margin:'0 0 18px'}}>💰 Cash Reconciliation</h2>

          {/* System calc — full detail matching Cashflow */}
          <div style={{background:'#f8fafc',borderRadius:'10px',padding:'16px',marginBottom:'20px'}}>
            <div style={{fontSize:'12px',fontWeight:'700',color:'#94a3b8',textTransform:'uppercase',letterSpacing:'0.06em',marginBottom:'12px'}}>System Calculation</div>

            {/* CASH IN rows */}
            {[
              {label:'Cash Sales',value:cashSalesTotal,sign:'+',color:'#059669',
               items:allInvoices.filter(i=>i.payment_method==='cash'||i.payment_method==='partial'),
               getDesc:i=>`${i.invoice_no} · ${i.customers?.name||'—'}`, getAmt:i=>i.amount_paid},
              {label:'Credits Collected (cash)',value:cashCollectedTotal,sign:'+',color:'#059669',
               items:cashCollectedList,
               getDesc:i=>`${i.invoices?.invoice_no||'—'} · ${i.invoices?.customers?.name||'—'}`, getAmt:i=>i.amount},
              {label:'Supplier Cash Refunds',value:cashRefundsFromSuppliersTotal,sign:'+',color:'#059669',
               items:cashRefundsFromSuppliersList,
               getDesc:i=>`${i.return_no||'RET'} · ${i.suppliers?.name||'—'}`, getAmt:i=>i.total},
              {label:'Bank Withdrawals (cash received)',value:bankWithdrawalsTotal,sign:'+',color:'#0891b2',
               items:bankWithdrawalsList,
               getDesc:i=>`${i.bank_accounts?.name||'Bank'} · ${i.reference||i.notes||'Withdrawal'}`, getAmt:i=>i.amount},
            ].map(row=>(
              <div key={row.label} style={{marginBottom:'4px'}}>
                <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'8px 0',borderBottom:'1px solid #e2e8f0',fontSize:'14px'}}>
                  <div style={{display:'flex',alignItems:'center',gap:'10px'}}>
                    <span style={{width:'24px',height:'24px',background:row.color+'22',color:row.color,borderRadius:'50%',display:'inline-flex',alignItems:'center',justifyContent:'center',fontSize:'14px',fontWeight:'800',flexShrink:0}}>{row.sign}</span>
                    <span style={{color:'#475569'}}>{row.label}</span>
                  </div>
                  <span style={{fontWeight:'700',color:row.color,fontSize:'15px'}}>{formatCurrency(row.value)}</span>
                </div>
                {row.items.length > 0 && (
                  <div style={{marginLeft:'34px',marginBottom:'4px'}}>
                    {row.items.map((item,ii)=>(
                      <div key={ii} style={{display:'flex',justifyContent:'space-between',fontSize:'12px',color:'#64748b',padding:'3px 0',borderBottom:'1px dotted #f1f5f9'}}>
                        <span>{new Date(item.created_at).toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'})} · {row.getDesc(item)}</span>
                        <span style={{fontWeight:'600',color:row.color}}>{formatCurrency(row.getAmt(item))}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}

            {/* CASH OUT rows */}
            {[
              ...(cashAdjIn > 0 ? [{label:'Cash Additions (Adjustments)',value:cashAdjIn,sign:'+',color:'#7c3aed',
               items:cashAdjList.filter(a=>a.notes?.startsWith('[+]')).map(a=>({created_at:a.created_at,description:a.notes?.replace('[+] ',''),amount:a.amount})),
               getDesc:a=>a.description||'—',getAmt:a=>a.amount}] : []),
              ...(cashAdjOut > 0 ? [{label:'Cash Deductions (Adjustments)',value:cashAdjOut,sign:'−',color:'#dc2626',
               items:cashAdjList.filter(a=>a.notes?.startsWith('[-]')).map(a=>({created_at:a.created_at,description:a.notes?.replace('[-] ',''),amount:a.amount})),
               getDesc:a=>a.description||'—',getAmt:a=>a.amount}] : []),
              {label:'Cash Expenses',value:cashExpensesTotal,sign:'−',color:'#e11d48',
               items:cashExpensesList,
               getDesc:i=>i.description||i.category||'Expense', getAmt:i=>i.amount},
              {label:'Cash Paid to Suppliers',value:cashToSuppliersTotal,sign:'−',color:'#e11d48',
               items:cashToSuppliersList,
               getDesc:i=>`${i.purchases?.purchase_no||'—'} · ${i.purchases?.suppliers?.name||'—'}`, getAmt:i=>i.amount},
              {label:'Cash Paid to Investors',value:cashToInvestorsTotal,sign:'−',color:'#e11d48',
               items:cashToInvestorsList,
               getDesc:i=>i.investors?.name||i.notes||'Investor', getAmt:i=>i.amount},
              {label:'Refunds Paid to Customers',value:cashRefundsToCustomersTotal,sign:'−',color:'#e11d48',
               items:cashRefundsToCustomersList,
               getDesc:i=>`${i.return_no||'RET'} · ${i.customers?.name||'—'}`, getAmt:i=>i.total},
              {label:'Cash Deposited to Bank',value:cashDepositsTotal,sign:'−',color:'#e11d48',
               items:cashDepositsList,
               getDesc:i=>i.notes||'Bank deposit', getAmt:i=>i.amount},
            ].map(row=>(
              <div key={row.label} style={{marginBottom:'4px'}}>
                <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'8px 0',borderBottom:'1px solid #e2e8f0',fontSize:'14px'}}>
                  <div style={{display:'flex',alignItems:'center',gap:'10px'}}>
                    <span style={{width:'24px',height:'24px',background:row.color+'22',color:row.color,borderRadius:'50%',display:'inline-flex',alignItems:'center',justifyContent:'center',fontSize:'14px',fontWeight:'800',flexShrink:0}}>{row.sign}</span>
                    <span style={{color:'#475569'}}>{row.label}</span>
                  </div>
                  <span style={{fontWeight:'700',color:row.color,fontSize:'15px'}}>{formatCurrency(row.value)}</span>
                </div>
                {row.items.length > 0 && (
                  <div style={{marginLeft:'34px',marginBottom:'4px'}}>
                    {row.items.map((item,ii)=>(
                      <div key={ii} style={{display:'flex',justifyContent:'space-between',fontSize:'12px',color:'#64748b',padding:'3px 0',borderBottom:'1px dotted #f1f5f9'}}>
                        <span>{new Date(item.created_at).toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'})} · {row.getDesc(item)}</span>
                        <span style={{fontWeight:'600',color:row.color}}>{formatCurrency(row.getAmt(item))}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}

            <div style={{marginTop:'12px',paddingTop:'12px',borderTop:'1px dashed #e2e8f0'}}>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'4px 0',fontSize:'14px',color:'#64748b'}}>
                <span>Opening Cash in Hand</span>
                <span style={{fontWeight:'700',color:'#0369a1'}}>+ {formatCurrency(openingCash)}</span>
              </div>
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'4px 0',fontSize:'14px',color:'#64748b'}}>
                <span>Net Cash Movement (today)</span>
                <span style={{fontWeight:'700',color:expectedCash>=0?'#059669':'#e11d48'}}>{expectedCash>=0?'+':''}{formatCurrency(expectedCash)}</span>
              </div>
            </div>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',padding:'12px 0 0',fontSize:'16px',fontWeight:'800',borderTop:'2px solid #0f172a',marginTop:'8px'}}>              <span style={{color:'#0f172a'}}>= Expected Cash in Till</span>
              <span style={{fontSize:'22px',color:'#0369a1'}}>{formatCurrency(openingCash + expectedCash)}</span>
            </div>
          </div>

          {/* Physical count */}
          <div style={{background:'#eef2ff',borderRadius:'10px',padding:'16px',marginBottom:'20px',border:'2px solid #bfdbfe'}}>
            <div style={{fontSize:'12px',fontWeight:'700',color:'#1e40af',textTransform:'uppercase',letterSpacing:'0.06em',marginBottom:'12px'}}>📥 Physical Cash Count</div>
            <label style={lbl}>Count the cash in the till and enter the total (LKR)</label>
            <input type="number" value={actualCash} min="0" onChange={e=>setActualCash(e.target.value)} onFocus={e=>e.target.select()} placeholder="0.00"
              style={{...inp,fontSize:'24px',fontWeight:'800',textAlign:'right',color:'#0f172a',padding:'14px 16px',borderColor:'#93c5fd',letterSpacing:'1px'}}/>

            {actualCash!==''&&(
              <div style={{marginTop:'14px',background:'white',borderRadius:'8px',padding:'16px',border:`2px solid ${Math.abs(difference)<0.01?'#bbf7d0':difference>0?'#bbf7d0':'#fecaca'}`}}>
                <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:'12px'}}>
                  <div style={{textAlign:'center'}}>
                    <div style={{fontSize:'11px',fontWeight:'700',color:'#94a3b8',textTransform:'uppercase',marginBottom:'6px'}}>Expected (System)</div>
                    <div style={{fontSize:'20px',fontWeight:'800',color:'#0369a1'}}>{formatCurrency(openingCash + expectedCash)}</div>
                  </div>
                  <div style={{textAlign:'center',borderLeft:'1px solid #e2e8f0',borderRight:'1px solid #e2e8f0'}}>
                    <div style={{fontSize:'11px',fontWeight:'700',color:'#94a3b8',textTransform:'uppercase',marginBottom:'6px'}}>Physical Count</div>
                    <div style={{fontSize:'20px',fontWeight:'800',color:'#0f172a'}}>{formatCurrency(actual)}</div>
                  </div>
                  <div style={{textAlign:'center'}}>
                    <div style={{fontSize:'11px',fontWeight:'700',color:'#94a3b8',textTransform:'uppercase',marginBottom:'6px'}}>Difference</div>
                    <div style={{fontSize:'20px',fontWeight:'900',color:Math.abs(difference)<0.01?'#059669':difference>0?'#059669':'#e11d48'}}>
                      {difference>=0?'+':''}{formatCurrency(difference)}
                    </div>
                    <div style={{fontSize:'12px',fontWeight:'800',marginTop:'4px',color:Math.abs(difference)<0.01?'#059669':difference>0?'#059669':'#e11d48'}}>
                      {Math.abs(difference)<0.01?'✓ BALANCED':difference>0?'↑ CASH OVER':'↓ CASH SHORT'}
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Cashier + Notes */}
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:'14px',marginBottom:'20px'}}>
            <div>
              <label style={lbl}>Cashier *</label>
              {isCashier && selectedSalesman ? (
                <div style={{padding:'9px 12px',background:'#f0fdf4',border:'1.5px solid #bbf7d0',borderRadius:'7px',display:'flex',alignItems:'center',gap:'8px'}}>
                  <span style={{fontSize:'14px',fontWeight:'700',color:'#166534'}}>{selectedSalesman.name}</span>
                  <span style={{fontSize:'11px',color:'#86efac',fontWeight:'600'}}>{selectedSalesman.salesman_no}</span>
                  <span style={{marginLeft:'auto',fontSize:'11px',background:'#dcfce7',color:'#166534',padding:'1px 7px',borderRadius:'8px',fontWeight:'700'}}>Auto</span>
                </div>
              ) : (
                <>
                  <select value={selectedSalesman?.id||''} onChange={e=>setSelectedSalesman(salesmen.find(s=>s.id===e.target.value)||null)}
                    style={{...inp,color:selectedSalesman?'#0f172a':'#94a3b8',borderColor:selectedSalesman?'#2563eb':'#e2e8f0'}}>
                    <option value="">— Select cashier —</option>
                    {salesmen.map(s=><option key={s.id} value={s.id}>{s.salesman_no} · {s.name}</option>)}
                  </select>
                  {selectedSalesman&&<div style={{fontSize:'11px',color:'#2563eb',marginTop:'3px',fontWeight:'600'}}>✓ Auto-selected from your profile</div>}
                </>
              )}
            </div>
            <div>
              <label style={lbl}>Notes (optional)</label>
              <input type="text" value={notes} onChange={e=>setNotes(e.target.value)} placeholder="Any remarks for this shift…" style={inp}/>
            </div>
          </div>

          {/* Close button */}
          <button onClick={handleEndShift}
            disabled={saving||openDrafts.length>0||!selectedSalesman||actualCash===''}
            style={{width:'100%',padding:'16px',fontSize:'16px',fontWeight:'800',border:'none',borderRadius:'10px',cursor:(saving||openDrafts.length>0||!selectedSalesman||actualCash==='')?'not-allowed':'pointer',transition:'all 0.15s',
              background:(saving||openDrafts.length>0||!selectedSalesman||actualCash==='')
                ?'#e2e8f0':'linear-gradient(135deg,#2563eb,#1d4ed8)',
              color:(saving||openDrafts.length>0||!selectedSalesman||actualCash==='')
                ?'#94a3b8':'white'}}>
            {saving?'Closing Shift…'
              :openDrafts.length>0?`⚠ Close ${openDrafts.length} Draft(s) First`
              :!selectedSalesman?'Select Cashier First'
              :actualCash===''?'Enter Cash Count to Continue'
              :'🔒 Close Shift & Print Report'}
          </button>
        </div>
      </>)}
    </div>
  )
}
