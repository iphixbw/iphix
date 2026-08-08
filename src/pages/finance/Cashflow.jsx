import { useState, useEffect } from 'react'
import { supabase } from '../../supabase'
import { formatCurrency } from '../../lib/helpers'

export default function Cashflow({ activeShop }) {
  const [loading, setLoading] = useState(true)
  const [dateFrom, setDateFrom] = useState(() => {
    const d = new Date(); d.setDate(1); return d.toISOString().split('T')[0]
  })
  const [dateTo, setDateTo] = useState(() => new Date().toISOString().split('T')[0])
  const [openingCash, setOpeningCash] = useState(0)
  const [bankAccounts, setBankAccounts] = useState([])
  const [cashSales, setCashSales] = useState([])
  const [cashFromCustomers, setCashFromCustomers] = useState([])
  const [cashAdjIn, setCashAdjIn] = useState([])
  const [cashAdjOut, setCashAdjOut] = useState([])
  const [cashFromInvestors, setCashFromInvestors] = useState([])
  const [bankWithdrawals, setBankWithdrawals] = useState([])
  const [cashExpenses, setCashExpenses] = useState([])
  const [cashToSuppliers, setCashToSuppliers] = useState([])
  const [cashToInvestors, setCashToInvestors] = useState([])
  const [cashRefundsFromSuppliers, setCashRefundsFromSuppliers] = useState([])
  const [cashRefundsToCustomers, setCashRefundsToCustomers] = useState([])
  const [bankDeposits, setBankDeposits] = useState([])

  useEffect(() => { fetchData() }, [activeShop?.id, dateFrom, dateTo])

  async function safeQuery(query) {
    try {
      const { data, error } = await query
      if (error) { console.warn('Query error:', error.message); return [] }
      return data || []
    } catch (e) {
      console.warn('Query failed:', e.message)
      return []
    }
  }

  async function fetchData() {
    setLoading(true)
    try {
      const from = `${dateFrom}T00:00:00+00:00`
      const to = `${dateTo}T23:59:59+00:00`
      const shop = activeShop?.id

      // Cash adjustments (additions and deductions by superadmin)
      const { data: cashAdjs, error: adjError } = await supabase.from('bank_transactions')
        .select('amount,created_at,notes,reference')
        .eq('type','cash_adjustment')
        .gte('created_at',from).lte('created_at',to)
      if (adjError) console.warn('cashAdj fetch error:', adjError.message)
      const adjInList = (cashAdjs || []).filter(a => a.notes?.startsWith('[+]'))
      const adjOutList = (cashAdjs || []).filter(a => a.notes?.startsWith('[-]'))
      setCashAdjIn(adjInList)
      setCashAdjOut(adjOutList)

      // Opening cash = actual_cash from the last shift record before dateFrom
      // If none exists (e.g. first ever period), use the earliest shift within the period as baseline
      let lastShiftQ = supabase.from('shift_records')
        .select('actual_cash, shift_date')
        .lt('shift_date', dateFrom)
        .not('actual_cash', 'is', null)
        .order('shift_date', { ascending: false })
        .limit(1)
      if (shop) lastShiftQ = lastShiftQ.eq('shop_id', shop)
      const { data: lastShift } = await lastShiftQ.maybeSingle()
      if (lastShift?.actual_cash != null) {
        setOpeningCash(lastShift.actual_cash)
      } else {
        // No prior shift — find earliest shift within the period to use as opening baseline
        let firstShiftQ = supabase.from('shift_records')
          .select('actual_cash, shift_date')
          .gte('shift_date', dateFrom)
          .lte('shift_date', dateTo)
          .not('actual_cash', 'is', null)
          .order('shift_date', { ascending: true })
          .limit(1)
        if (shop) firstShiftQ = firstShiftQ.eq('shop_id', shop)
        const { data: firstShift } = await firstShiftQ.maybeSingle()
        if (firstShift?.actual_cash != null) {
          // Opening = first shift's actual_cash minus that day's net cash movements
          // Simplest: use 0 as true opening and let the shift records carry the history
          setOpeningCash(0)
        } else {
          setOpeningCash(0)
        }
      }

      // Bank accounts
      const banks = await safeQuery(supabase.from('bank_accounts').select('*').order('name'))
      setBankAccounts(banks)

      // Cash sales (invoices paid directly in cash)
      let invQ = supabase.from('invoices')
        .select('invoice_no,amount_paid,created_at,customers(name)')
        .eq('status', 'confirmed')
        .in('payment_method', ['cash', 'partial'])
        .gte('created_at', from).lte('created_at', to)
      if (shop) invQ = invQ.eq('shop_id', shop)
      const invs = await safeQuery(invQ)
      setCashSales(invs)

      // Cash collected from customers — invoice_payments + opening balance direct cash payments
      const [custPmts, openingCashPmts] = await Promise.all([
        safeQuery(
          supabase.from('invoice_payments')
            .select('amount,created_at,payment_method,invoices(invoice_no,customers(name),shop_id)')
            .eq('payment_method', 'cash')
            .gte('created_at', from).lte('created_at', to)
        ),
        safeQuery(
          supabase.from('bank_transactions')
            .select('amount,created_at,reference,notes')
            .eq('type', 'deposit')
            .ilike('notes', '%Opening balance payment · Cash%')
            .gte('created_at', from).lte('created_at', to)
        )
      ])
      const filteredCust = shop ? custPmts.filter(p => p.invoices?.shop_id === shop) : custPmts
      const openingMapped = openingCashPmts.map(p => ({
        amount: p.amount, created_at: p.created_at, payment_method: 'cash',
        invoices: { invoice_no: 'OPEN-BAL', customers: { name: (p.reference||'').replace('Customer: ','') }, shop_id: null }
      }))
      setCashFromCustomers([...filteredCust, ...openingMapped])

      // Cash from investors (investment_transactions table - may not exist)
      const invIn = await safeQuery(
        supabase.from('investment_transactions')
          .select('amount,created_at,notes,investors(name)')
          .eq('type', 'capital_in')
          .eq('payment_method', 'cash')
          .gte('created_at', from).lte('created_at', to)
      )
      setCashFromInvestors(invIn)

      // Bank withdrawals (bank→cash: deducts bank balance, adds to cash in hand)
      const wdrawals = await safeQuery(
        supabase.from('bank_transactions')
          .select('amount,created_at,notes,reference,bank_account_id,bank_accounts(name,bank_name)')
          .eq('type', 'withdrawal')
          .gte('created_at', from).lte('created_at', to)
      )
      setBankWithdrawals(wdrawals)

      // Cash expenses
      let expQ = supabase.from('expenses')
        .select('description,amount,category,created_at')
        .eq('payment_method', 'cash')
        .neq('category', 'Supplier Payment')    // tracked via purchase_payments
        .neq('category', 'Bank Withdrawal')      // tracked via bank_transactions type=withdrawal
        .neq('category', 'Investor Payment')     // tracked via investment_transactions
        .neq('category', 'Sales Return Refund')  // tracked via sales_returns table directly
        .gte('created_at', from).lte('created_at', to)
      if (shop) expQ = expQ.eq('shop_id', shop)
      const exps = await safeQuery(expQ)
      setCashExpenses(exps)

      // Cash refunds to customers (sales returns paid in cash)
      const custRefunds = await safeQuery(
        supabase.from('sales_returns')
          .select('total,created_at,remarks,return_no,customers(name),shop_id')
          .eq('status', 'confirmed')
          .eq('payment_method', 'cash')
          .gte('created_at', from).lte('created_at', to)
      )
      setCashRefundsToCustomers(custRefunds)

      // Cash paid to suppliers
      const suppPmts = await safeQuery(
        supabase.from('purchase_payments')
          .select('amount,created_at,notes,purchases(purchase_no,suppliers(name))')
          .eq('payment_method', 'cash')
          .gte('created_at', from).lte('created_at', to)
      )
      setCashToSuppliers(suppPmts)

      // Cash paid to investors
      const invOut = await safeQuery(
        supabase.from('investment_transactions')
          .select('amount,created_at,notes,investors(name)')
          .in('type', ['withdrawal', 'return'])
          .eq('payment_method', 'cash')
          .gte('created_at', from).lte('created_at', to)
      )
      setCashToInvestors(invOut)

      // Cash refunds from suppliers (purchase returns paid in cash)
      const suppRefunds = await safeQuery(
        supabase.from('purchase_returns')
          .select('total,created_at,remarks,return_no,suppliers(name),shop_id')
          .eq('status', 'confirmed')
          .eq('payment_method', 'cash')
          .gte('created_at', from).lte('created_at', to)
      )
      setCashRefundsFromSuppliers(suppRefunds)
      let depQ = supabase.from('cash_deposits')
        .select('amount,notes,created_at')
        .gte('created_at', from).lte('created_at', to)
      if (shop) depQ = depQ.eq('shop_id', shop)
      const deps = await safeQuery(depQ)
      setBankDeposits(deps)

    } catch (e) {
      console.error('Cashflow fetchData error:', e)
    }
    setLoading(false)
  }

  const f = formatCurrency
  const sum = (arr, key = 'amount') => (arr || []).reduce((s, i) => s + (parseFloat(i[key]) || 0), 0)

  const totalCashIn = sum(cashSales, 'amount_paid') + sum(cashFromCustomers) + sum(cashFromInvestors) + sum(cashRefundsFromSuppliers, 'total') + cashAdjIn.reduce((s,a)=>s+(a.amount||0),0)
  const totalWithdrawals = sum(bankWithdrawals)
  const totalCashOut = sum(cashExpenses) + sum(cashToSuppliers) + sum(cashToInvestors) + sum(cashRefundsToCustomers, 'total') + cashAdjOut.reduce((s,a)=>s+(a.amount||0),0)
  const totalDeposits = sum(bankDeposits)
  // Closing Cash = Opening + Cash In + Withdrawals (bank→cash) − Cash Out − Deposits (cash→bank)
  const netCashMovement = totalCashIn + totalWithdrawals - totalCashOut - totalDeposits
  const closingCash = openingCash + netCashMovement
  const netCash = closingCash  // alias for display

  const inp = {
    padding: '8px 12px', border: '1.5px solid #e2e8f0', borderRadius: '7px',
    fontSize: '13px', outline: 'none', background: 'white'
  }

  function Section({ title, color, bg, items, getAmt, getDesc, getDate, total }) {
    return (
      <div style={{ background: 'white', borderRadius: '10px', boxShadow: '0 1px 3px rgba(15,23,42,0.06), 0 1px 2px rgba(15,23,42,0.04)', overflow: 'hidden', marginBottom: '10px' }}>
        <div style={{ padding: '10px 14px', background: bg, display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: `2px solid ${color}33` }}>
          <span style={{ fontWeight: '700', color, fontSize: '13px' }}>{title}</span>
          <span style={{ fontWeight: '800', color, fontSize: '15px' }}>{f(total)}</span>
        </div>
        {!items.length
          ? <div style={{ padding: '10px 14px', color: '#94a3b8', fontSize: '12px', textAlign: 'center' }}>No transactions</div>
          : items.map((item, i) => (
            <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 14px', borderBottom: '1px solid #f1f5f9', background: i % 2 === 0 ? 'white' : '#fafafa' }}>
              <div>
                <div style={{ fontSize: '13px', fontWeight: '600', color: '#0f172a' }}>{getDesc(item)}</div>
                <div style={{ fontSize: '11px', color: '#94a3b8' }}>
                  {new Date(getDate(item)).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}
                </div>
              </div>
              <span style={{ fontWeight: '700', color, fontSize: '13px', flexShrink: 0, marginLeft: '12px' }}>{f(getAmt(item))}</span>
            </div>
          ))
        }
      </div>
    )
  }

  return (
    <div style={{ maxWidth: '1000px' }}>
      <div style={{ marginBottom: '20px' }}>
        <h1 style={{ fontSize: '22px', fontWeight: '700', color: '#0f172a', margin: '0 0 4px' }}>Cash Flow</h1>
        <p style={{ color: '#64748b', fontSize: '13px', margin: 0 }}>
          Cash In Hand = Cash In + Bank Withdrawals − Cash Out − Bank Deposits
        </p>
      </div>

      {/* Filters */}
      <div style={{ background: 'white', borderRadius: '12px', padding: '14px 16px', boxShadow: '0 1px 3px rgba(15,23,42,0.06), 0 1px 2px rgba(15,23,42,0.04)', marginBottom: '20px', display: 'flex', gap: '12px', flexWrap: 'wrap', alignItems: 'flex-end' }}>
        {[{ l: 'From', v: dateFrom, s: setDateFrom }, { l: 'To', v: dateTo, s: setDateTo }].map(({ l, v, s }) => (
          <div key={l}>
            <label style={{ fontSize: '11px', fontWeight: '700', color: '#94a3b8', display: 'block', marginBottom: '4px', textTransform: 'uppercase' }}>{l}</label>
            <input type="date" value={v} onChange={e => s(e.target.value)} style={inp} />
          </div>
        ))}
        <button onClick={fetchData} style={{ padding: '9px 18px', background: 'linear-gradient(135deg,#2563eb,#1d4ed8)', color: 'white', border: 'none', borderRadius: '7px', cursor: 'pointer', fontWeight: '700', fontSize: '13px' }}>
          Refresh
        </button>
      </div>

      {loading ? (
        <div style={{ padding: '80px', textAlign: 'center', color: '#94a3b8', fontSize: '16px' }}>
          <div style={{ fontSize: '32px', marginBottom: '12px' }}>⏳</div>
          Loading cashflow data...
        </div>
      ) : (
        <>
          {/* Cash Summary Banner */}
          <div style={{ background: closingCash >= 0 ? 'linear-gradient(135deg,#059669,#047857)' : 'linear-gradient(135deg,#e11d48,#be123c)', borderRadius: '12px', padding: '20px 24px', marginBottom: '20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', color: 'white' }}>
            <div>
              <div style={{ fontSize: '14px', opacity: 0.85, marginBottom: '2px', fontWeight: '600' }}>Closing Cash in Hand</div>
              <div style={{ fontSize: '12px', opacity: 0.7 }}>
                Opening {f(openingCash)} + {f(totalCashIn)} in + {f(totalWithdrawals)} withdrawals − {f(totalCashOut)} out − {f(totalDeposits)} deposits
              </div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: '32px', fontWeight: '900' }}>{f(closingCash)}</div>
              <div style={{ fontSize: '12px', opacity: 0.75 }}>Movement: {netCashMovement >= 0 ? '+' : ''}{f(netCashMovement)}</div>
            </div>
          </div>

          {/* Summary Cards */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: '12px', marginBottom: '24px' }}>
            {[
              { label: '🏦 Opening Cash', value: openingCash, color: '#0369a1', bg: '#f0f9ff' },
              { label: '💵 Cash In', value: totalCashIn, color: '#059669', bg: '#f0fdf4' },
              { label: '💸 Cash Out', value: totalCashOut, color: '#e11d48', bg: '#fff5f5' },
              { label: '💵→🏦 Deposits', value: totalDeposits, color: '#2563eb', bg: '#eef2ff' },
            ].map(s => (
              <div key={s.label} style={{ background: s.bg, borderRadius: '12px', padding: '14px 16px', borderLeft: `4px solid ${s.color}` }}>
                <div style={{ fontSize: '11px', fontWeight: '700', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '4px' }}>{s.label}</div>
                <div style={{ fontSize: '20px', fontWeight: '800', color: s.color }}>{f(s.value)}</div>
              </div>
            ))}
          </div>

          {/* Two columns: IN on left, OUT on right */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>

            {/* LEFT: Cash In + Withdrawals */}
            <div>
              <div style={{ fontSize: '12px', fontWeight: '800', color: '#059669', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '8px', padding: '0 2px' }}>
                💵 Cash In — {f(totalCashIn)}
              </div>
              <Section title="Cash Sales" color="#059669" bg="#f0fdf4"
                items={cashSales} total={sum(cashSales, 'amount_paid')}
                getAmt={i => i.amount_paid}
                getDesc={i => `${i.invoice_no} · ${i.customers?.name || ''}`}
                getDate={i => i.created_at} />
              <Section title="Cash Received from Customers" color="#059669" bg="#f0fdf4"
                items={cashFromCustomers} total={sum(cashFromCustomers)}
                getAmt={i => i.amount}
                getDesc={i => i.invoices?.invoice_no ? `${i.invoices.invoice_no} · ${i.invoices.customers?.name || ''}` : 'Customer payment'}
                getDate={i => i.created_at} />
              <Section title="Cash from Investors" color="#059669" bg="#f0fdf4"
                items={cashFromInvestors} total={sum(cashFromInvestors)}
                getAmt={i => i.amount}
                getDesc={i => i.investors?.name || i.notes || 'Investor capital in'}
                getDate={i => i.created_at} />
              <Section title="Cash Refunds from Suppliers" color="#059669" bg="#f0fdf4"
                items={cashRefundsFromSuppliers} total={sum(cashRefundsFromSuppliers, 'total')}
                getAmt={i => i.total}
                getDesc={i => `${i.return_no || 'Return'} · ${i.suppliers?.name || ''}${i.remarks ? ` · ${i.remarks}` : ''}`}
                getDate={i => i.created_at} />

              <div style={{ fontSize: '12px', fontWeight: '800', color: '#0891b2', textTransform: 'uppercase', letterSpacing: '0.06em', margin: '16px 0 8px', padding: '0 2px' }}>
                🏦→💵 Bank Withdrawals (adds to cash) — {f(totalWithdrawals)}
              </div>
              <Section title="Withdrawn from Bank" color="#0891b2" bg="#f0f9ff"
                items={bankWithdrawals} total={totalWithdrawals}
                getAmt={i => i.amount}
                getDesc={i => `${i.bank_accounts?.name || 'Bank'} · ${i.notes || i.reference || 'Withdrawal'}`}
                getDate={i => i.created_at} />
              {cashAdjIn.length > 0 && <Section title="Cash Additions (Adjustments)" color="#7c3aed" bg="#f5f3ff"
                items={cashAdjIn.map(a=>({...a, amount: a.amount, created_at: a.created_at, description: a.notes?.replace('[+] ','') || '—'}))}
                getDesc={i=>i.description} getAmt={i=>i.amount} getDate={i=>i.created_at} total={cashAdjIn.reduce((s,a)=>s+(a.amount||0),0)} />}
            </div>

            {/* RIGHT: Cash Out + Deposits */}
            <div>
              <div style={{ fontSize: '12px', fontWeight: '800', color: '#e11d48', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '8px', padding: '0 2px' }}>
                💸 Cash Out — {f(totalCashOut)}
              </div>
              {cashAdjOut.length > 0 && <Section title="Cash Deductions (Adjustments)" color="#dc2626" bg="#fff5f5"
                items={cashAdjOut.map(a=>({...a, amount: a.amount, created_at: a.created_at, description: a.notes?.replace('[-] ','') || '—'}))}
                getDesc={i=>i.description} getAmt={i=>i.amount} getDate={i=>i.created_at} total={cashAdjOut.reduce((s,a)=>s+(a.amount||0),0)} />}
              <Section title="Cash Expenses" color="#e11d48" bg="#fff5f5"
                items={cashExpenses} total={sum(cashExpenses)}
                getAmt={i => i.amount}
                getDesc={i => i.description || i.category || 'Expense'}
                getDate={i => i.created_at} />
              <Section title="Cash Paid to Suppliers" color="#e11d48" bg="#fff5f5"
                items={cashToSuppliers} total={sum(cashToSuppliers)}
                getAmt={i => i.amount}
                getDesc={i => i.purchases?.suppliers?.name || i.notes || 'Supplier payment'}
                getDate={i => i.created_at} />
              <Section title="Cash Paid to Investors" color="#e11d48" bg="#fff5f5"
                items={cashToInvestors} total={sum(cashToInvestors)}
                getAmt={i => i.amount}
                getDesc={i => i.investors?.name || i.notes || 'Investor payment'}
                getDate={i => i.created_at} />
              <Section title="Refunds Paid to Customers" color="#e11d48" bg="#fff5f5"
                items={cashRefundsToCustomers} total={sum(cashRefundsToCustomers, 'total')}
                getAmt={i => i.total}
                getDesc={i => `${i.return_no || 'Return'} · ${i.customers?.name || ''}${i.remarks ? ` · ${i.remarks}` : ''}`}
                getDate={i => i.created_at} />

              <div style={{ fontSize: '12px', fontWeight: '800', color: '#2563eb', textTransform: 'uppercase', letterSpacing: '0.06em', margin: '16px 0 8px', padding: '0 2px' }}>
                💵→🏦 Cash Deposits (deducts from cash) — {f(totalDeposits)}
              </div>
              <Section title="Deposited to Bank" color="#2563eb" bg="#eef2ff"
                items={bankDeposits} total={totalDeposits}
                getAmt={i => i.amount}
                getDesc={i => i.notes || 'Cash deposit to bank'}
                getDate={i => i.created_at} />
            </div>
          </div>

          {/* Bank Account Balances */}
          {bankAccounts.length > 0 && (
            <div style={{ background: 'white', borderRadius: '12px', boxShadow: '0 1px 3px rgba(15,23,42,0.06), 0 1px 2px rgba(15,23,42,0.04)', overflow: 'hidden', marginTop: '20px' }}>
              <div style={{ padding: '14px 16px', borderBottom: '1px solid #f1f5f9' }}>
                <h3 style={{ fontSize: '15px', fontWeight: '700', color: '#0f172a', margin: 0 }}>Bank Account Balances</h3>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(180px,1fr))' }}>
                {bankAccounts.map(b => (
                  <div key={b.id} style={{ padding: '16px', borderRight: '1px solid #f1f5f9', borderBottom: '1px solid #f1f5f9' }}>
                    <div style={{ fontSize: '12px', color: '#64748b', fontWeight: '600', marginBottom: '2px' }}>{b.name}</div>
                    <div style={{ fontSize: '11px', color: '#94a3b8', marginBottom: '6px' }}>{b.bank_name}</div>
                    <div style={{ fontSize: '20px', fontWeight: '800', color: (b.balance || 0) >= 0 ? '#059669' : '#e11d48' }}>
                      {f(b.balance || 0)}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
