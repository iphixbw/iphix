import { useState, useEffect } from 'react'
import { supabase } from '../../supabase'
import toast from 'react-hot-toast'
import { formatLKR, statusMeta, timeAgo, isCollectedWithDue } from '../../lib/repairConstants'

export default function RepairCustomers({ shop, onOpenJob }) {
  const [customers, setCustomers] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState(null)
  const [jobs, setJobs] = useState([])
  const [sales, setSales] = useState([])
  const [statement, setStatement] = useState([])
  const [detailTab, setDetailTab] = useState('statement')
  const [showReceivePayment, setShowReceivePayment] = useState(false)

  useEffect(() => { fetchCustomers() }, [])

  async function fetchCustomers() {
    setLoading(true)
    const { data } = await supabase.from('repair_customers').select('*').order('name')
    setCustomers(data || [])
    setLoading(false)
  }

  async function openCustomer(c) {
    setSelected(c)
    setDetailTab('statement')
    const [{ data: j }, { data: s }] = await Promise.all([
      supabase.from('repair_jobs').select('*').eq('customer_id', c.id).order('created_at', { ascending: false }),
      supabase.from('repair_sales').select('*').eq('customer_id', c.id).order('created_at', { ascending: false }),
    ])
    setJobs(j || [])
    setSales(s || [])

    // outstanding_balance is normally kept in sync incrementally (payments,
    // credit sales), but that only works if EVERY code path that changes what
    // a customer owes remembers to call the adjust RPC — job creation and job
    // cost edits didn't, so some customers' stored balance had quietly drifted
    // from reality with nothing to catch it. Recalculating from scratch here,
    // the same way job balances and FIFO stock values already self-heal on
    // open, makes this resilient to any gap like that, present or future.
    const trueBalance = (c.opening_balance || 0)
      + (j || []).filter(job => job.status !== 'voided').reduce((s, job) => s + (job.balance_due || 0), 0)
      + (s || []).reduce((sum, sale) => sum + Math.max(0, (sale.total || 0) - (sale.amount_paid || 0)), 0)
    let fresh = c
    if (trueBalance !== c.outstanding_balance) {
      const { data: updated } = await supabase.from('repair_customers').update({ outstanding_balance: trueBalance }).eq('id', c.id).select().single()
      if (updated) { fresh = updated; setSelected(updated); setCustomers(cs => cs.map(cc => cc.id === updated.id ? updated : cc)) }
    }

    const jobIds = (j || []).map(job => job.id)
    const [{ data: jobPayments }, { data: standalone }] = await Promise.all([
      jobIds.length ? supabase.from('repair_job_payments').select('*').in('job_id', jobIds) : Promise.resolve({ data: [] }),
      supabase.from('repair_customer_standalone_payments').select('*, bank_accounts(name)').eq('customer_id', c.id),
    ])

    // Build a chronological activity statement across jobs + sales + their payments
    const events = []
    const openingBal = fresh?.opening_balance ?? c.opening_balance
    if (openingBal > 0) {
      events.push({
        date: fresh.created_at || new Date(0).toISOString(),
        label: 'Opening balance brought forward', debit: openingBal, credit: 0, type: 'opening',
      })
    }
    ;(j || []).forEach(job => {
      // deposit_received is frozen at job creation — anything paid afterward
      // (Collect Payment on the job itself, or a customer-level payment
      // applied here) goes through repair_job_payments instead, shown below
      // as its own line, so this never double-counts with those.
      events.push({ date: job.created_at, label: `Repair Job ${job.job_no} — ${job.phone_brand} ${job.phone_model}`, debit: job.grand_total || 0, credit: job.deposit_received || 0, type: 'job' })
    })
    ;(jobPayments || []).forEach(jp => {
      const job = (j || []).find(job => job.id === jp.job_id)
      events.push({ date: jp.created_at, label: `Payment (${jp.payment_method}) — Job ${job?.job_no || ''}`, debit: 0, credit: jp.amount, type: 'payment' })
    })
    ;(s || []).forEach(sale => {
      events.push({ date: sale.created_at, label: `Parts Sale ${sale.sale_no}`, debit: sale.total || 0, credit: sale.amount_paid || 0, type: 'sale' })
    })
    ;(standalone || []).forEach(sp => {
      events.push({ date: sp.created_at, label: `Payment (${sp.payment_method}${sp.bank_accounts?.name ? ' — ' + sp.bank_accounts.name : ''})`, debit: 0, credit: sp.amount, type: 'payment' })
    })
    events.sort((a, b) => new Date(a.date) - new Date(b.date))
    let running = 0
    events.forEach(e => { running += e.debit - e.credit; e.balance = running })
    setStatement(events)
  }

  const filtered = customers.filter(c =>
    !search || c.name.toLowerCase().includes(search.toLowerCase()) || c.mobile.includes(search) || c.customer_no?.toLowerCase().includes(search.toLowerCase())
  )

  const totalSpent = jobs.filter(j => j.status === 'collected').reduce((s, j) => s + (j.grand_total || 0), 0) + sales.reduce((s, sa) => s + (sa.total || 0), 0)
  const outstanding = jobs.reduce((s, j) => s + (j.balance_due || 0), 0) + sales.reduce((s, sa) => s + Math.max(0, (sa.total || 0) - (sa.amount_paid || 0)), 0)

  const totalOutstandingAll = customers.reduce((s, c) => s + Math.max(0, c.outstanding_balance || 0), 0)
  const totalCreditAll = customers.reduce((s, c) => s + Math.max(0, -(c.outstanding_balance || 0)), 0)

  return (
    <div>
      <h1 style={{ fontSize: '22px', fontWeight: '800', color: '#1c1917', margin: '0 0 4px' }}>Repair Customers</h1>
      <p style={{ color: '#8a7a63', fontSize: '14px', margin: '0 0 20px' }}>{customers.length} customers · Search by name, mobile, IMEI, or job number</p>

      <div style={{ display: 'grid', gridTemplateColumns: totalCreditAll > 0 ? 'repeat(2, minmax(200px, 1fr))' : 'minmax(200px, 1fr)', gap: '14px', marginBottom: '20px', maxWidth: '620px' }}>
        <div style={{ background: '#fff1f2', borderRadius: '14px', padding: '16px 18px', border: '1px solid rgba(0,0,0,0.04)' }}>
          <div style={{ fontSize: '11px', fontWeight: '700', color: '#e11d48', textTransform: 'uppercase' }}>Total Outstanding</div>
          <div style={{ fontSize: '21px', fontWeight: '800', color: '#e11d48' }}>{formatLKR(totalOutstandingAll)}</div>
        </div>
        {totalCreditAll > 0 && (
          <div style={{ background: '#f0fdf4', borderRadius: '14px', padding: '16px 18px', border: '1px solid rgba(0,0,0,0.04)' }}>
            <div style={{ fontSize: '11px', fontWeight: '700', color: '#059669', textTransform: 'uppercase' }}>Total Credit (owed back)</div>
            <div style={{ fontSize: '21px', fontWeight: '800', color: '#059669' }}>{formatLKR(totalCreditAll)}</div>
          </div>
        )}
      </div>

      <input type="text" placeholder="Search customers..." value={search} onChange={e => setSearch(e.target.value)}
        style={{ width: '100%', maxWidth: '400px', padding: '10px 14px', border: '1.5px solid #e7dfd3', borderRadius: '10px', fontSize: '14px', marginBottom: '18px', boxSizing: 'border-box' }} />

      {loading ? <div style={{ padding: '60px', textAlign: 'center', color: '#a89478' }}>Loading...</div> : (
        <div style={{ background: 'white', borderRadius: '16px', border: '1px solid #f3ede4', overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr style={{ background: '#fdf8f3', borderBottom: '2px solid #f3ede4' }}>
              {['Customer No', 'Name', 'Mobile', 'Email', 'Outstanding'].map(h => <th key={h} style={{ padding: '10px 14px', textAlign: 'left', fontSize: '10px', fontWeight: '700', color: '#a89478', textTransform: 'uppercase' }}>{h}</th>)}
            </tr></thead>
            <tbody>
              {filtered.map((c, i) => (
                <tr key={c.id} onClick={() => openCustomer(c)} style={{ borderBottom: '1px solid #f8f5f0', cursor: 'pointer', background: i % 2 === 0 ? 'white' : '#fdfbf8' }}>
                  <td style={{ padding: '11px 14px', color: '#d4881f', fontWeight: '700' }}>{c.customer_no}</td>
                  <td style={{ padding: '11px 14px', fontWeight: '600' }}>{c.name}</td>
                  <td style={{ padding: '11px 14px' }}>{c.mobile}</td>
                  <td style={{ padding: '11px 14px', color: '#78716c' }}>{c.email || '—'}</td>
                  <td style={{ padding: '11px 14px', fontWeight: '700', color: c.outstanding_balance > 0 ? '#e11d48' : c.outstanding_balance < 0 ? '#059669' : '#94a3b8' }}>
                    {c.outstanding_balance < 0 ? `Credit ${formatLKR(Math.abs(c.outstanding_balance))}` : formatLKR(c.outstanding_balance || 0)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {filtered.length === 0 && <div style={{ padding: '48px', textAlign: 'center', color: '#a89478' }}>No customers found.</div>}
        </div>
      )}

      {selected && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(28,25,23,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '20px' }}>
          <div style={{ background: 'white', borderRadius: '18px', padding: '26px', width: '100%', maxWidth: '620px', maxHeight: '85vh', overflowY: 'auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '16px' }}>
              <div>
                <h3 style={{ fontSize: '18px', fontWeight: '800', color: '#1c1917', margin: '0 0 2px' }}>{selected.name}</h3>
                <p style={{ fontSize: '13px', color: '#8a7a63', margin: 0 }}>{selected.mobile} {selected.email && `· ${selected.email}`}</p>
              </div>
              <button onClick={() => setSelected(null)} style={{ background: 'none', border: 'none', fontSize: '20px', cursor: 'pointer', color: '#a89478' }}>✕</button>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginBottom: '14px' }}>
              <div style={{ background: '#f0fdf4', borderRadius: '10px', padding: '12px' }}>
                <div style={{ fontSize: '10px', fontWeight: '700', color: '#166534', textTransform: 'uppercase' }}>Total Spent</div>
                <div style={{ fontSize: '18px', fontWeight: '800', color: '#166534' }}>{formatLKR(totalSpent)}</div>
              </div>
              <div style={{ background: selected.outstanding_balance > 0 ? '#fff1f2' : selected.outstanding_balance < 0 ? '#f0fdf4' : '#f8f5f0', borderRadius: '10px', padding: '12px' }}>
                <div style={{ fontSize: '10px', fontWeight: '700', color: selected.outstanding_balance > 0 ? '#e11d48' : selected.outstanding_balance < 0 ? '#059669' : '#8a7a63', textTransform: 'uppercase' }}>
                  {selected.outstanding_balance < 0 ? 'Credit Balance' : 'Outstanding'}
                </div>
                <div style={{ fontSize: '18px', fontWeight: '800', color: selected.outstanding_balance > 0 ? '#e11d48' : selected.outstanding_balance < 0 ? '#059669' : '#8a7a63' }}>
                  {formatLKR(Math.abs(selected.outstanding_balance || 0))}
                </div>
              </div>
            </div>

            {(selected.outstanding_balance || 0) > 0 && (
              <button onClick={() => setShowReceivePayment(true)}
                style={{ width: '100%', marginBottom: '14px', padding: '10px', background: 'linear-gradient(135deg,#f0b23d,#d4881f)', color: '#1c1917', border: 'none', borderRadius: '9px', cursor: 'pointer', fontWeight: '800', fontSize: '13px' }}>
                💵 Receive Payment
              </button>
            )}

            <div style={{ display: 'flex', gap: '6px', marginBottom: '14px' }}>
              {[{ id: 'statement', label: 'Activity Statement' }, { id: 'jobs', label: `Repair Jobs (${jobs.length})` }, { id: 'sales', label: `Parts Sales (${sales.length})` }].map(t => (
                <button key={t.id} onClick={() => setDetailTab(t.id)}
                  style={{ padding: '6px 14px', borderRadius: '8px', border: 'none', background: detailTab === t.id ? '#1c1917' : '#f5f1ea', color: detailTab === t.id ? '#f0b23d' : '#78716c', fontWeight: '700', fontSize: '12px', cursor: 'pointer' }}>
                  {t.label}
                </button>
              ))}
            </div>

            {detailTab === 'statement' && (
              statement.length === 0 ? <div style={{ fontSize: '13px', color: '#a89478' }}>No activity yet.</div> : (
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12.5px' }}>
                  <thead><tr style={{ borderBottom: '1px solid #f3ede4' }}>
                    {['Date', 'Description', 'Charged', 'Paid', 'Balance'].map(h => <th key={h} style={{ padding: '6px 8px', textAlign: 'left', fontSize: '10px', color: '#a89478', textTransform: 'uppercase' }}>{h}</th>)}
                  </tr></thead>
                  <tbody>
                    {statement.map((e, i) => (
                      <tr key={i} style={{ borderBottom: '1px solid #f8f5f0' }}>
                        <td style={{ padding: '7px 8px', color: '#78716c' }}>{timeAgo(e.date)}</td>
                        <td style={{ padding: '7px 8px', fontWeight: '600' }}>{e.label}</td>
                        <td style={{ padding: '7px 8px', color: '#e11d48' }}>{formatLKR(e.debit)}</td>
                        <td style={{ padding: '7px 8px', color: '#059669' }}>{formatLKR(e.credit)}</td>
                        <td style={{ padding: '7px 8px', fontWeight: '700' }}>{formatLKR(e.balance)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )
            )}

            {detailTab === 'jobs' && (
              jobs.length === 0 ? <div style={{ fontSize: '13px', color: '#a89478' }}>No jobs yet.</div> : jobs.map(j => {
                const meta = statusMeta(j.status)
                const due = isCollectedWithDue(j)
                return (
                  <div key={j.id} onClick={() => onOpenJob && onOpenJob(j.id)} style={{ padding: '10px 0', borderBottom: '1px solid #f8f5f0', cursor: onOpenJob ? 'pointer' : 'default', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                      <div style={{ fontSize: '13px', fontWeight: '700', color: '#1c1917' }}>{j.job_no} · {j.phone_brand} {j.phone_model}</div>
                      <div style={{ fontSize: '11px', color: '#a89478' }}>{timeAgo(j.created_at)} · {formatLKR(j.grand_total)}</div>
                    </div>
                    {due ? (
                      <span style={{ padding: '3px 9px', borderRadius: '8px', fontSize: '10px', fontWeight: '800', background: '#fee2e2', color: '#b91c1c' }}>⚠ DUE {formatLKR(j.balance_due)}</span>
                    ) : (
                      <span style={{ padding: '3px 9px', borderRadius: '8px', fontSize: '10px', fontWeight: '700', background: meta.bg, color: meta.color }}>{meta.label}</span>
                    )}
                  </div>
                )
              })
            )}

            {detailTab === 'sales' && (
              sales.length === 0 ? <div style={{ fontSize: '13px', color: '#a89478' }}>No parts sales yet.</div> : sales.map(s => (
                <div key={s.id} style={{ padding: '10px 0', borderBottom: '1px solid #f8f5f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <div style={{ fontSize: '13px', fontWeight: '700', color: '#1c1917' }}>{s.sale_no}</div>
                    <div style={{ fontSize: '11px', color: '#a89478' }}>{timeAgo(s.created_at)} · {s.payment_method}</div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: '13px', fontWeight: '700' }}>{formatLKR(s.total)}</div>
                    {(s.total - s.amount_paid) > 0 && <div style={{ fontSize: '11px', color: '#e11d48', fontWeight: '600' }}>{formatLKR(s.total - s.amount_paid)} due</div>}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {showReceivePayment && selected && (
        <ReceivePaymentModal shop={shop} customer={selected} jobs={jobs} sales={sales}
          onClose={() => setShowReceivePayment(false)}
          onPaid={() => { setShowReceivePayment(false); openCustomer(selected); fetchCustomers() }} />
      )}
    </div>
  )
}

// Item 7: receive a standalone payment against a customer's outstanding
// balance, applied FIFO across their oldest unpaid jobs/sales first.
function ReceivePaymentModal({ shop, customer, jobs, sales, onClose, onPaid }) {
  const [amount, setAmount] = useState('')
  const [method, setMethod] = useState('cash')
  const [bankAccountId, setBankAccountId] = useState('')
  const [bankAccounts, setBankAccounts] = useState([])
  const [saving, setSaving] = useState(false)

  useEffect(() => { supabase.from('bank_accounts').select('*').order('name').then(({ data }) => setBankAccounts(data || [])) }, [])

  // Oldest-first list of everything with a balance still owed
  const outstandingItems = [
    ...jobs.filter(j => (j.balance_due || 0) > 0).map(j => ({ kind: 'job', id: j.id, date: j.created_at, label: `Job ${j.job_no}`, due: j.balance_due, grand_total: j.grand_total, deposit_received: j.deposit_received })),
    ...sales.filter(s => (s.total - s.amount_paid) > 0).map(s => ({ kind: 'sale', id: s.id, date: s.created_at, label: `Sale ${s.sale_no}`, due: s.total - s.amount_paid, total: s.total, amount_paid: s.amount_paid })),
  ].sort((a, b) => new Date(a.date) - new Date(b.date))

  const totalDue = outstandingItems.reduce((s, i) => s + i.due, 0)

  async function handlePay() {
    const enteredAmount = parseFloat(amount)
    if (!enteredAmount || enteredAmount <= 0) return toast.error('Enter a valid amount')
    if ((method === 'card' || method === 'bank') && !bankAccountId) return toast.error('Select a bank account')
    setSaving(true)
    try {
      let remaining = enteredAmount
      const applied = []
      for (const item of outstandingItems) {
        if (remaining <= 0) break
        const take = Math.min(remaining, item.due)
        if (item.kind === 'job') {
          // deposit_received is frozen at job creation (same convention as
          // repair_purchases.initial_payment) — anything paid afterward goes
          // through repair_job_payments instead, same table Collect Payment
          // uses on the job's own page. That keeps this job's own balance
          // self-healing correctly AND keeps the customer ledger from
          // double-counting this against a separate standalone-payment line.
          await supabase.from('repair_job_payments').insert({
            job_id: item.id, amount: take, payment_method: method,
            bank_account_id: (method === 'card' || method === 'bank') ? bankAccountId : null,
          })
          await supabase.from('repair_jobs').update({ balance_due: Math.max(0, item.due - take) }).eq('id', item.id)
        } else {
          const newPaid = (item.amount_paid || 0) + take
          await supabase.from('repair_sales').update({ amount_paid: newPaid }).eq('id', item.id)
        }
        applied.push({ ...item, applied: take })
        remaining -= take
      }

      // Only the portion that couldn't be matched to a specific job/sale above
      // (paying down an opening balance, or overpaying beyond what anything
      // here could absorb) needs its own record — the itemized portion is
      // already correctly reflected through repair_job_payments or the sale's
      // amount_paid, so recording it again here would double-count it.
      const unallocated = Math.max(0, remaining)
      if (unallocated > 0.009) {
        await supabase.from('repair_customer_standalone_payments').insert({
          customer_id: customer.id, shop_id: shop?.id || null, amount: unallocated,
          payment_method: method, bank_account_id: (method === 'card' || method === 'bank') ? bankAccountId : null,
          reference: 'Payment received',
        })
      }

      // The customer's overall balance always drops by the FULL entered
      // amount, regardless of how it was allocated above.
      await supabase.rpc('repair_adjust_customer_balance', { p_customer_id: customer.id, p_delta: -enteredAmount })

      if (method === 'cash') {
        await supabase.from('repair_cash_ledger').insert({ shop_id: shop?.id || null, type: 'sale', amount: enteredAmount, reference: customer.name, notes: 'Customer payment received' })
      } else {
        const bank = bankAccounts.find(b => b.id === bankAccountId)
        await supabase.from('bank_accounts').update({ balance: (bank?.balance || 0) + enteredAmount }).eq('id', bankAccountId)
        await supabase.from('bank_transactions').insert({ bank_account_id: bankAccountId, type: 'deposit', amount: enteredAmount, reference: `Customer payment: ${customer.name}`, notes: `${method} payment` })
      }

      toast.success(`${formatLKR(enteredAmount)} received${applied.length ? ` — applied across ${applied.length} item${applied.length !== 1 ? 's' : ''} (oldest first)` : ''}`)
      onPaid()
    } catch (e) { toast.error('Failed: ' + e.message) }
    setSaving(false)
  }

  const inp = { width: '100%', padding: '9px 12px', border: '1.5px solid #e7dfd3', borderRadius: '8px', fontSize: '13px', boxSizing: 'border-box' }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(28,25,23,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1100, padding: '20px' }}>
      <div style={{ background: 'white', borderRadius: '18px', padding: '24px', width: '100%', maxWidth: '420px', maxHeight: '85vh', overflowY: 'auto' }}>
        <h3 style={{ fontSize: '16px', fontWeight: '800', margin: '0 0 4px', color: '#1c1917' }}>Receive Payment — {customer.name}</h3>
        <p style={{ fontSize: '12px', color: '#8a7a63', margin: '0 0 4px' }}>Total outstanding: {formatLKR(Math.max(totalDue, customer.outstanding_balance || 0))}</p>
        {(customer.outstanding_balance || 0) > totalDue && (
          <p style={{ fontSize: '11px', color: '#a89478', margin: '0 0 14px', fontStyle: 'italic' }}>
            {formatLKR((customer.outstanding_balance || 0) - totalDue)} of this isn't tied to a specific job/sale below (e.g. an opening balance) — it'll still be applied when you record a payment.
          </p>
        )}

        <div style={{ background: '#fdf8f3', borderRadius: '8px', padding: '10px 12px', marginBottom: '14px', maxHeight: '140px', overflowY: 'auto' }}>
          <div style={{ fontSize: '10px', fontWeight: '700', color: '#a89478', textTransform: 'uppercase', marginBottom: '6px' }}>Applied oldest-first</div>
          {outstandingItems.map(i => (
            <div key={i.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px', padding: '3px 0' }}>
              <span style={{ color: '#57534e' }}>{i.label} · {timeAgo(i.date)}</span>
              <span style={{ fontWeight: '700', color: '#e11d48' }}>{formatLKR(i.due)}</span>
            </div>
          ))}
        </div>

        <div style={{ marginBottom: '10px' }}><label style={{ fontSize: '11px', fontWeight: '700', color: '#a89478' }}>Amount</label><input type="number" style={inp} value={amount} onChange={e => setAmount(e.target.value)} placeholder={String(Math.max(totalDue, customer.outstanding_balance || 0))} /></div>
        <div style={{ marginBottom: '10px' }}>
          <label style={{ fontSize: '11px', fontWeight: '700', color: '#a89478' }}>Method</label>
          <select style={inp} value={method} onChange={e => setMethod(e.target.value)}>
            <option value="cash">Cash</option><option value="card">Card</option><option value="bank">Bank Transfer</option>
          </select>
        </div>
        {(method === 'card' || method === 'bank') && (
          <div style={{ marginBottom: '16px' }}>
            <label style={{ fontSize: '11px', fontWeight: '700', color: '#a89478' }}>iPHIX Technologies Bank Account</label>
            <select style={inp} value={bankAccountId} onChange={e => setBankAccountId(e.target.value)}>
              <option value="">Select...</option>
              {bankAccounts.map(b => <option key={b.id} value={b.id}>{b.name}{b.bank_name ? ` — ${b.bank_name}` : ''}</option>)}
            </select>
          </div>
        )}
        <div style={{ display: 'flex', gap: '10px' }}>
          <button onClick={onClose} style={{ flex: 1, padding: '10px', background: '#f5f1ea', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: '700' }}>Cancel</button>
          <button onClick={handlePay} disabled={saving} style={{ flex: 1, padding: '10px', background: 'linear-gradient(135deg,#f0b23d,#d4881f)', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: '800' }}>{saving ? 'Applying...' : 'Receive Payment'}</button>
        </div>
      </div>
    </div>
  )
}
