import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../../supabase'
import toast from 'react-hot-toast'
import { formatLKR, timeAgo } from '../../lib/repairConstants'

export default function RepairCash({ shop, isSuperAdmin }) {
  const [ledger, setLedger] = useState([])
  const [deposits, setDeposits] = useState([])
  const [bankAccounts, setBankAccounts] = useState([])
  const [loading, setLoading] = useState(true)
  const [showDeposit, setShowDeposit] = useState(false)
  const [tab, setTab] = useState('overview')
  const [showAdjust, setShowAdjust] = useState(false)

  useEffect(() => { fetchAll() }, [shop?.id])

  async function fetchAll() {
    setLoading(true)
    // Supabase caps a single response at 1000 rows, so page through the ledger
    // — the cashbook and cash-on-hand must see every row.
    const allLedger = []
    for (let from = 0; ; from += 1000) {
      let q = supabase.from('repair_cash_ledger').select('*').order('created_at', { ascending: false }).order('id').range(from, from + 999)
      if (shop?.id) q = q.eq('shop_id', shop.id)
      const { data: page } = await q
      allLedger.push(...(page || []))
      if (!page || page.length < 1000) break
    }
    let dq = supabase.from('repair_bank_deposits').select('*, bank_accounts(name, bank_name)').order('created_at', { ascending: false })
    if (shop?.id) dq = dq.eq('shop_id', shop.id)
    const [{ data: d }, { data: banks }] = await Promise.all([
      dq, supabase.from('bank_accounts').select('*').order('name')
    ])
    setLedger(allLedger)
    setDeposits(d || [])
    setBankAccounts(banks || [])
    setLoading(false)
  }

  const cashBalance = ledger.reduce((s, l) => s + l.amount, 0)
  const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0)
  const todayIn = ledger.filter(l => new Date(l.created_at) >= todayStart && l.amount > 0).reduce((s, l) => s + l.amount, 0)
  const todayOut = ledger.filter(l => new Date(l.created_at) >= todayStart && l.amount < 0).reduce((s, l) => s + Math.abs(l.amount), 0)

  return (
    <div>
      <h1 style={{ fontSize: '22px', fontWeight: '800', color: '#1c1917', margin: '0 0 4px' }}>Repair Cash & Bank Deposits</h1>
      <p style={{ color: '#8a7a63', fontSize: '14px', margin: '0 0 20px' }}>Separate repair cash account · deposits are the only link to iPHIX Technologies's main accounting</p>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '14px', marginBottom: '24px' }}>
        {[
          { label: 'Cash on Hand', value: cashBalance, color: '#166534', bg: '#f0fdf4' },
          { label: "Today's Cash In", value: todayIn, color: '#059669', bg: '#f0fdf4' },
          { label: "Today's Cash Out", value: todayOut, color: '#e11d48', bg: '#fff1f2' },
        ].map(c => (
          <div key={c.label} style={{ background: c.bg, borderRadius: '16px', padding: '18px', border: '1px solid rgba(0,0,0,0.04)' }}>
            <div style={{ fontSize: '11px', fontWeight: '700', color: '#8a7a63', textTransform: 'uppercase', marginBottom: '6px' }}>{c.label}</div>
            <div style={{ fontSize: '21px', fontWeight: '800', color: c.color }}>{formatLKR(c.value)}</div>
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', gap: '8px', marginBottom: '16px', alignItems: 'center' }}>
        {[['overview', '💵 Overview'], ['cashbook', '📒 Cashbook']].map(([id, label]) => (
          <button key={id} onClick={() => setTab(id)}
            style={{ padding: '9px 18px', borderRadius: '10px', border: 'none', cursor: 'pointer', fontWeight: '700', fontSize: '13px', background: tab === id ? '#1c1917' : '#f5f1ea', color: tab === id ? 'white' : '#78716c' }}>{label}</button>
        ))}
        {isSuperAdmin && (
          <button onClick={() => setShowAdjust(true)}
            style={{ marginLeft: 'auto', padding: '9px 18px', borderRadius: '10px', border: '1.5px solid #d4881f', background: 'white', color: '#b45309', cursor: 'pointer', fontWeight: '800', fontSize: '13px' }}>⚖️ Adjust Cash</button>
        )}
      </div>

      {tab === 'cashbook' && !loading && <Cashbook ledger={ledger} />}

      {tab === 'overview' && (<>
      <button onClick={() => setShowDeposit(true)}
        style={{ marginBottom: '20px', padding: '12px 24px', background: 'linear-gradient(135deg,#f0b23d,#d4881f)', color: '#1c1917', border: 'none', borderRadius: '12px', cursor: 'pointer', fontWeight: '800', fontSize: '14px', boxShadow: '0 4px 14px rgba(212,136,31,0.3)' }}>
        🏦 Deposit Cash to Bank
      </button>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
        <div style={{ background: 'white', borderRadius: '16px', border: '1px solid #f3ede4', overflow: 'hidden' }}>
          <div style={{ padding: '14px 18px', borderBottom: '1px solid #f3ede4' }}><h3 style={{ fontSize: '14px', fontWeight: '800', color: '#1c1917', margin: 0 }}>Daily Cash Book</h3></div>
          {loading ? <div style={{ padding: '30px', textAlign: 'center', color: '#a89478' }}>Loading...</div> : ledger.length === 0 ? (
            <div style={{ padding: '30px', textAlign: 'center', color: '#a89478' }}>No cash transactions yet.</div>
          ) : (
            <div style={{ maxHeight: '400px', overflowY: 'auto' }}>
              {ledger.map(l => (
                <div key={l.id} style={{ padding: '11px 18px', borderBottom: '1px solid #f8f5f0', display: 'flex', justifyContent: 'space-between' }}>
                  <div>
                    <div style={{ fontSize: '12.5px', fontWeight: '600', color: '#292524', textTransform: 'capitalize' }}>{l.type}{l.reference ? ` · ${l.reference}` : ''}</div>
                    <div style={{ fontSize: '11px', color: '#a89478' }}>{timeAgo(l.created_at)}</div>
                  </div>
                  <span style={{ fontWeight: '700', color: l.amount >= 0 ? '#059669' : '#e11d48' }}>{l.amount >= 0 ? '+' : ''}{formatLKR(l.amount)}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div style={{ background: 'white', borderRadius: '16px', border: '1px solid #f3ede4', overflow: 'hidden' }}>
          <div style={{ padding: '14px 18px', borderBottom: '1px solid #f3ede4' }}><h3 style={{ fontSize: '14px', fontWeight: '800', color: '#1c1917', margin: 0 }}>Bank Deposit History</h3></div>
          {deposits.length === 0 ? (
            <div style={{ padding: '30px', textAlign: 'center', color: '#a89478' }}>No deposits yet.</div>
          ) : (
            <div style={{ maxHeight: '400px', overflowY: 'auto' }}>
              {deposits.map(d => (
                <div key={d.id} style={{ padding: '11px 18px', borderBottom: '1px solid #f8f5f0' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <div style={{ fontSize: '12.5px', fontWeight: '700', color: '#292524' }}>{d.bank_accounts?.name}</div>
                    <span style={{ fontWeight: '700', color: '#1e40af' }}>{formatLKR(d.amount)}</span>
                  </div>
                  <div style={{ fontSize: '11px', color: '#a89478' }}>{new Date(d.deposit_date).toLocaleDateString('en-GB')} {d.reference && `· Ref: ${d.reference}`}</div>
                  {d.remarks && <div style={{ fontSize: '11px', color: '#78716c', marginTop: '2px' }}>{d.remarks}</div>}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
      </>)}

      {showAdjust && <AdjustCashModal shop={shop} cashBalance={cashBalance} onClose={() => setShowAdjust(false)} onSaved={() => { setShowAdjust(false); fetchAll() }} />}
      {showDeposit && <DepositModal shop={shop} bankAccounts={bankAccounts} cashBalance={cashBalance} onClose={() => setShowDeposit(false)} onDeposited={() => { setShowDeposit(false); fetchAll() }} />}
    </div>
  )
}

function DepositModal({ shop, bankAccounts, cashBalance, onClose, onDeposited }) {
  const [bankAccountId, setBankAccountId] = useState('')
  const [amount, setAmount] = useState('')
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10))
  const [reference, setReference] = useState('')
  const [remarks, setRemarks] = useState('')
  const [saving, setSaving] = useState(false)

  async function handleDeposit() {
    const amt = parseFloat(amount)
    if (!bankAccountId) return toast.error('Select a bank account')
    if (!amt || amt <= 0) return toast.error('Enter a valid amount')
    if (amt > cashBalance) return toast.error(`Only ${formatLKR(cashBalance)} available in repair cash`)
    setSaving(true)
    try {
      const { error } = await supabase.rpc('repair_deposit_to_bank', {
        p_shop_id: shop?.id || null, p_bank_account_id: bankAccountId, p_amount: amt,
        p_reference: reference || null, p_remarks: remarks || null, p_deposit_date: date,
      })
      if (error) throw error
      toast.success(`${formatLKR(amt)} deposited successfully!`)
      onDeposited()
    } catch (e) { toast.error('Failed: ' + e.message) }
    setSaving(false)
  }

  const inp = { width: '100%', padding: '9px 12px', border: '1.5px solid #e7dfd3', borderRadius: '8px', fontSize: '13px', boxSizing: 'border-box' }
  const lbl = { fontSize: '11px', fontWeight: '700', color: '#a89478', textTransform: 'uppercase', display: 'block', marginBottom: '5px' }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(28,25,23,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '20px' }}>
      <div style={{ background: 'white', borderRadius: '20px', padding: '26px', width: '100%', maxWidth: '440px' }}>
        <h2 style={{ fontSize: '18px', fontWeight: '800', color: '#1c1917', margin: '0 0 4px' }}>🏦 Deposit Cash to Bank</h2>
        <p style={{ fontSize: '12.5px', color: '#8a7a63', margin: '0 0 18px' }}>Available repair cash: <strong style={{ color: '#166534' }}>{formatLKR(cashBalance)}</strong></p>

        <div style={{ marginBottom: '14px' }}>
          <label style={lbl}>Bank Account</label>
          <select style={inp} value={bankAccountId} onChange={e => setBankAccountId(e.target.value)}>
            <option value="">Select iPHIX Technologies bank account...</option>
            {bankAccounts.map(b => <option key={b.id} value={b.id}>{b.name}{b.bank_name ? ` — ${b.bank_name}` : ''}</option>)}
          </select>
          {bankAccounts.length === 0 && <div style={{ fontSize: '11.5px', color: '#e11d48', marginTop: '4px' }}>No bank accounts found — add one in the retail system's Bank page first.</div>}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginBottom: '14px' }}>
          <div><label style={lbl}>Amount (LKR)</label><input type="number" style={inp} value={amount} onChange={e => setAmount(e.target.value)} /></div>
          <div><label style={lbl}>Date</label><input type="date" style={inp} value={date} onChange={e => setDate(e.target.value)} /></div>
        </div>
        <div style={{ marginBottom: '14px' }}><label style={lbl}>Reference</label><input style={inp} placeholder="Slip number, etc." value={reference} onChange={e => setReference(e.target.value)} /></div>
        <div style={{ marginBottom: '20px' }}><label style={lbl}>Remarks</label><textarea style={{ ...inp, minHeight: '50px' }} value={remarks} onChange={e => setRemarks(e.target.value)} /></div>

        <div style={{ display: 'flex', gap: '10px' }}>
          <button onClick={onClose} style={{ flex: 1, padding: '11px', background: '#f5f1ea', border: 'none', borderRadius: '10px', cursor: 'pointer', fontWeight: '700', color: '#78716c' }}>Cancel</button>
          <button onClick={handleDeposit} disabled={saving} style={{ flex: 2, padding: '11px', background: 'linear-gradient(135deg,#f0b23d,#d4881f)', border: 'none', borderRadius: '10px', cursor: 'pointer', fontWeight: '800', color: '#1c1917' }}>{saving ? 'Depositing...' : '✓ Confirm Deposit'}</button>
        </div>
      </div>
    </div>
  )
}


// ── Cashbook: every cash in/out with date filter, running balance and daily totals ──
const TYPE_LABELS = { opening: 'Opening', sale: 'Receipt', payment: 'Payment', expense: 'Expense', deposit: 'Bank Deposit', refund: 'Refund', lending: 'Lending', adjustment: 'Adjustment' }
const dayKey = (iso) => new Date(iso).toLocaleDateString('en-CA')   // YYYY-MM-DD in the viewer's local time

function Cashbook({ ledger }) {
  const today = dayKey(new Date().toISOString())
  const monthStart = today.slice(0, 8) + '01'
  const [from, setFrom] = useState(monthStart)
  const [to, setTo] = useState(today)
  const [typeFilter, setTypeFilter] = useState('all')
  const [search, setSearch] = useState('')
  const [view, setView] = useState('transactions')

  // Oldest → newest with a running balance over the WHOLE ledger, so the balance
  // shown on any row is the true cash on hand at that moment, whatever the filter.
  const withBalance = useMemo(() => {
    const sorted = [...ledger].sort((a, b) => new Date(a.created_at) - new Date(b.created_at) || String(a.id).localeCompare(String(b.id)))
    let bal = 0
    return sorted.map(l => { bal += l.amount || 0; return { ...l, day: dayKey(l.created_at), balance: bal } })
  }, [ledger])

  const openingBF = useMemo(() => withBalance.filter(l => from && l.day < from).reduce((s, l) => s + l.amount, 0), [withBalance, from])
  const rows = useMemo(() => {
    const q = search.trim().toLowerCase()
    return withBalance.filter(l =>
      (!from || l.day >= from) && (!to || l.day <= to) &&
      (typeFilter === 'all' || l.type === typeFilter) &&
      (!q || `${l.reference || ''} ${l.notes || ''} ${l.type}`.toLowerCase().includes(q)))
  }, [withBalance, from, to, typeFilter, search])

  const totalIn = rows.filter(r => r.amount > 0).reduce((s, r) => s + r.amount, 0)
  const totalOut = rows.filter(r => r.amount < 0).reduce((s, r) => s + Math.abs(r.amount), 0)

  const daily = useMemo(() => {
    const m = {}
    for (const r of rows) {
      const d = (m[r.day] = m[r.day] || { day: r.day, in: 0, out: 0, count: 0, closing: 0 })
      if (r.amount > 0) d.in += r.amount; else d.out += Math.abs(r.amount)
      d.count++; d.closing = r.balance
    }
    return Object.values(m).sort((a, b) => a.day.localeCompare(b.day))
  }, [rows])

  function preset(kind) {
    const d = new Date()
    if (kind === 'today') { setFrom(today); setTo(today) }
    else if (kind === 'yesterday') { d.setDate(d.getDate() - 1); const y = dayKey(d.toISOString()); setFrom(y); setTo(y) }
    else if (kind === 'week') { d.setDate(d.getDate() - 6); setFrom(dayKey(d.toISOString())); setTo(today) }
    else if (kind === 'month') { setFrom(monthStart); setTo(today) }
    else { setFrom(''); setTo('') }
  }

  function exportCsv() {
    const esc = v => `"${String(v ?? '').replace(/"/g, '""')}"`
    const lines = [['Date', 'Time', 'Type', 'Reference', 'Details', 'Cash In', 'Cash Out', 'Balance'].join(',')]
    for (const r of rows) {
      const dt = new Date(r.created_at)
      lines.push([r.day, dt.toLocaleTimeString('en-GB'), TYPE_LABELS[r.type] || r.type, esc(r.reference), esc(r.notes),
        r.amount > 0 ? r.amount : '', r.amount < 0 ? Math.abs(r.amount) : '', r.balance].join(','))
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/csv' })
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `cashbook_${from || 'all'}_${to || 'all'}.csv`; a.click()
  }

  const inp = { padding: '8px 10px', border: '1.5px solid #e7dfd3', borderRadius: '8px', fontSize: '13px', boxSizing: 'border-box' }
  const th = { padding: '9px 12px', textAlign: 'left', fontSize: '10.5px', fontWeight: '800', color: '#a89478', textTransform: 'uppercase', background: '#faf7f2', position: 'sticky', top: 0 }
  const td = { padding: '9px 12px', fontSize: '12.5px', borderBottom: '1px solid #f8f5f0', color: '#292524' }
  const num = { ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums', fontWeight: '700' }

  return (
    <div>
      <div style={{ background: 'white', borderRadius: '16px', border: '1px solid #f3ede4', padding: '14px 18px', marginBottom: '14px' }}>
        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div><div style={{ fontSize: '10.5px', fontWeight: '700', color: '#a89478', marginBottom: '4px' }}>FROM</div><input type="date" style={inp} value={from} onChange={e => setFrom(e.target.value)} /></div>
          <div><div style={{ fontSize: '10.5px', fontWeight: '700', color: '#a89478', marginBottom: '4px' }}>TO</div><input type="date" style={inp} value={to} onChange={e => setTo(e.target.value)} /></div>
          <div><div style={{ fontSize: '10.5px', fontWeight: '700', color: '#a89478', marginBottom: '4px' }}>TYPE</div>
            <select style={inp} value={typeFilter} onChange={e => setTypeFilter(e.target.value)}>
              <option value="all">All types</option>
              {Object.entries(TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select></div>
          <div style={{ flex: 1, minWidth: '160px' }}><div style={{ fontSize: '10.5px', fontWeight: '700', color: '#a89478', marginBottom: '4px' }}>SEARCH</div>
            <input style={{ ...inp, width: '100%' }} placeholder="Reference or details…" value={search} onChange={e => setSearch(e.target.value)} /></div>
        </div>
        <div style={{ display: 'flex', gap: '6px', marginTop: '10px', flexWrap: 'wrap' }}>
          {[['today', 'Today'], ['yesterday', 'Yesterday'], ['week', 'Last 7 days'], ['month', 'This month'], ['all', 'All time']].map(([k, label]) => (
            <button key={k} onClick={() => preset(k)} style={{ padding: '5px 12px', borderRadius: '8px', border: '1px solid #e7dfd3', background: 'white', cursor: 'pointer', fontSize: '12px', fontWeight: '600', color: '#78716c' }}>{label}</button>
          ))}
          <button onClick={exportCsv} style={{ marginLeft: 'auto', padding: '5px 12px', borderRadius: '8px', border: 'none', background: '#1c1917', color: 'white', cursor: 'pointer', fontSize: '12px', fontWeight: '700' }}>⬇ Export CSV</button>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: '12px', marginBottom: '14px' }}>
        {[
          { label: 'Brought Forward', value: openingBF, color: '#44403c', bg: '#faf7f2' },
          { label: 'Total Cash In', value: totalIn, color: '#059669', bg: '#f0fdf4' },
          { label: 'Total Cash Out', value: totalOut, color: '#e11d48', bg: '#fff1f2' },
          { label: 'Closing Balance', value: openingBF + totalIn - totalOut, color: '#166534', bg: '#f0fdf4' },
        ].map(c => (
          <div key={c.label} style={{ background: c.bg, borderRadius: '14px', padding: '14px', border: '1px solid rgba(0,0,0,0.04)' }}>
            <div style={{ fontSize: '10.5px', fontWeight: '700', color: '#8a7a63', textTransform: 'uppercase', marginBottom: '4px' }}>{c.label}</div>
            <div style={{ fontSize: '18px', fontWeight: '800', color: c.color }}>{formatLKR(c.value)}</div>
          </div>
        ))}
      </div>
      {typeFilter !== 'all' || search.trim() ? <div style={{ fontSize: '11.5px', color: '#a89478', marginBottom: '10px' }}>Filters active — Closing Balance above = Brought Forward + the filtered rows. The running balance column always shows true cash on hand.</div> : null}

      <div style={{ display: 'flex', gap: '8px', marginBottom: '10px' }}>
        {[['transactions', `Transactions (${rows.length})`], ['daily', `Daily Totals (${daily.length})`]].map(([id, label]) => (
          <button key={id} onClick={() => setView(id)} style={{ padding: '7px 14px', borderRadius: '8px', border: 'none', cursor: 'pointer', fontWeight: '700', fontSize: '12.5px', background: view === id ? '#f0b23d' : '#f5f1ea', color: view === id ? '#1c1917' : '#78716c' }}>{label}</button>
        ))}
      </div>

      <div style={{ background: 'white', borderRadius: '16px', border: '1px solid #f3ede4', overflow: 'hidden' }}>
        <div style={{ maxHeight: '560px', overflow: 'auto' }}>
          {view === 'transactions' ? (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr>
                <th style={th}>Date & Time</th><th style={th}>Type</th><th style={th}>Reference</th><th style={th}>Details</th>
                <th style={{ ...th, textAlign: 'right' }}>Cash In</th><th style={{ ...th, textAlign: 'right' }}>Cash Out</th><th style={{ ...th, textAlign: 'right' }}>Balance</th>
              </tr></thead>
              <tbody>
                {rows.length === 0 && <tr><td colSpan={7} style={{ ...td, textAlign: 'center', color: '#a89478', padding: '30px' }}>No cash transactions in this period.</td></tr>}
                {rows.map(r => (
                  <tr key={r.id}>
                    <td style={td}>{new Date(r.created_at).toLocaleDateString('en-GB')} <span style={{ color: '#a89478' }}>{new Date(r.created_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</span></td>
                    <td style={td}>{TYPE_LABELS[r.type] || r.type}</td>
                    <td style={td}>{r.reference || '—'}</td>
                    <td style={{ ...td, color: '#78716c' }}>{r.notes || '—'}</td>
                    <td style={{ ...num, color: '#059669' }}>{r.amount > 0 ? formatLKR(r.amount) : ''}</td>
                    <td style={{ ...num, color: '#e11d48' }}>{r.amount < 0 ? formatLKR(Math.abs(r.amount)) : ''}</td>
                    <td style={{ ...num, color: r.balance < 0 ? '#e11d48' : '#1c1917' }}>{formatLKR(r.balance)}</td>
                  </tr>
                ))}
              </tbody>
              {rows.length > 0 && <tfoot><tr>
                <td colSpan={4} style={{ ...td, fontWeight: '800', background: '#faf7f2' }}>Total</td>
                <td style={{ ...num, background: '#faf7f2', color: '#059669' }}>{formatLKR(totalIn)}</td>
                <td style={{ ...num, background: '#faf7f2', color: '#e11d48' }}>{formatLKR(totalOut)}</td>
                <td style={{ ...num, background: '#faf7f2' }}>{formatLKR(totalIn - totalOut)}</td>
              </tr></tfoot>}
            </table>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead><tr>
                <th style={th}>Date</th><th style={{ ...th, textAlign: 'right' }}>Entries</th>
                <th style={{ ...th, textAlign: 'right' }}>Cash In</th><th style={{ ...th, textAlign: 'right' }}>Cash Out</th>
                <th style={{ ...th, textAlign: 'right' }}>Net</th><th style={{ ...th, textAlign: 'right' }}>Closing Balance</th>
              </tr></thead>
              <tbody>
                {daily.length === 0 && <tr><td colSpan={6} style={{ ...td, textAlign: 'center', color: '#a89478', padding: '30px' }}>No cash transactions in this period.</td></tr>}
                {daily.map(d => (
                  <tr key={d.day}>
                    <td style={td}>{new Date(d.day + 'T00:00:00').toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' })}</td>
                    <td style={{ ...num, color: '#a89478' }}>{d.count}</td>
                    <td style={{ ...num, color: '#059669' }}>{formatLKR(d.in)}</td>
                    <td style={{ ...num, color: '#e11d48' }}>{formatLKR(d.out)}</td>
                    <td style={{ ...num, color: d.in - d.out >= 0 ? '#059669' : '#e11d48' }}>{formatLKR(d.in - d.out)}</td>
                    <td style={num}>{formatLKR(d.closing)}</td>
                  </tr>
                ))}
              </tbody>
              {daily.length > 0 && <tfoot><tr>
                <td style={{ ...td, fontWeight: '800', background: '#faf7f2' }}>Total</td>
                <td style={{ ...num, background: '#faf7f2' }}>{rows.length}</td>
                <td style={{ ...num, background: '#faf7f2', color: '#059669' }}>{formatLKR(totalIn)}</td>
                <td style={{ ...num, background: '#faf7f2', color: '#e11d48' }}>{formatLKR(totalOut)}</td>
                <td style={{ ...num, background: '#faf7f2' }}>{formatLKR(totalIn - totalOut)}</td>
                <td style={{ ...num, background: '#faf7f2' }}></td>
              </tr></tfoot>}
            </table>
          )}
        </div>
      </div>
    </div>
  )
}


// Owner-only manual correction of the cash drawer: add cash that came in without
// being recorded (owner funding, transfers) or deduct cash that went out. Every
// adjustment is a normal dated ledger row with a mandatory reason, so it shows in
// the Cashbook and can always be traced.
function AdjustCashModal({ shop, cashBalance, onClose, onSaved }) {
  const nowLocal = () => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 16) }
  const [direction, setDirection] = useState('add')
  const [amount, setAmount] = useState('')
  const [when, setWhen] = useState(nowLocal())
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)

  const amt = parseFloat(amount) || 0
  const newBalance = cashBalance + (direction === 'add' ? amt : -amt)

  async function handleSave() {
    if (amt <= 0) return toast.error('Enter an amount greater than 0')
    if (!reason.trim()) return toast.error('A reason is required')
    if (!when) return toast.error('Select the date and time')
    setSaving(true)
    try {
      const { error } = await supabase.from('repair_cash_ledger').insert({
        shop_id: shop?.id || null, type: 'adjustment', amount: direction === 'add' ? amt : -amt,
        reference: direction === 'add' ? 'Cash added (owner)' : 'Cash deducted (owner)',
        notes: reason.trim(), created_at: new Date(when).toISOString(),
      })
      if (error) throw error
      toast.success(`Cash ${direction === 'add' ? 'added' : 'deducted'}: ${formatLKR(amt)}`)
      onSaved()
    } catch (e) { toast.error('Failed: ' + e.message) }
    setSaving(false)
  }

  const inp = { width: '100%', padding: '9px 12px', border: '1.5px solid #e7dfd3', borderRadius: '8px', fontSize: '13px', boxSizing: 'border-box' }
  const lbl = { fontSize: '11px', fontWeight: '700', color: '#a89478', textTransform: 'uppercase', display: 'block', marginBottom: '5px' }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(28,25,23,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '20px' }}>
      <div style={{ background: 'white', borderRadius: '20px', padding: '26px', width: '100%', maxWidth: '440px' }}>
        <h2 style={{ fontSize: '18px', fontWeight: '800', color: '#1c1917', margin: '0 0 4px' }}>⚖️ Adjust Cash</h2>
        <p style={{ fontSize: '12.5px', color: '#8a7a63', margin: '0 0 16px' }}>Current cash on hand: <strong style={{ color: '#166534' }}>{formatLKR(cashBalance)}</strong></p>

        <div style={{ display: 'flex', gap: '8px', marginBottom: '14px' }}>
          {[['add', '➕ Add Cash', '#059669'], ['deduct', '➖ Deduct Cash', '#e11d48']].map(([id, label, color]) => (
            <button key={id} onClick={() => setDirection(id)}
              style={{ flex: 1, padding: '10px', borderRadius: '10px', cursor: 'pointer', fontWeight: '700', fontSize: '13px', border: `2px solid ${direction === id ? color : '#e7dfd3'}`, background: direction === id ? color : 'white', color: direction === id ? 'white' : '#78716c' }}>{label}</button>
          ))}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginBottom: '14px' }}>
          <div><label style={lbl}>Amount (LKR)</label><input type="number" style={inp} value={amount} onChange={e => setAmount(e.target.value)} autoFocus /></div>
          <div><label style={lbl}>Date & Time</label><input type="datetime-local" style={inp} value={when} onChange={e => setWhen(e.target.value)} /></div>
        </div>
        <div style={{ marginBottom: '14px' }}>
          <label style={lbl}>Reason (required)</label>
          <textarea style={{ ...inp, minHeight: '60px' }} placeholder="e.g. Owner funded supplier payment to ARUNAS / cash count correction" value={reason} onChange={e => setReason(e.target.value)} />
        </div>
        {amt > 0 && (
          <div style={{ background: '#faf7f2', borderRadius: '10px', padding: '10px 12px', fontSize: '12.5px', color: '#44403c', marginBottom: '16px' }}>
            Cash on hand after this adjustment: <strong style={{ color: newBalance < 0 ? '#e11d48' : '#166534' }}>{formatLKR(newBalance)}</strong>
            {when && new Date(when) < new Date(Date.now() - 86400000) && <div style={{ marginTop: '4px', color: '#a89478' }}>Back-dated: running balances from that date onward will change.</div>}
          </div>
        )}
        <div style={{ display: 'flex', gap: '10px' }}>
          <button onClick={onClose} style={{ flex: 1, padding: '11px', background: '#f5f1ea', border: 'none', borderRadius: '10px', cursor: 'pointer', fontWeight: '700', color: '#78716c' }}>Cancel</button>
          <button onClick={handleSave} disabled={saving} style={{ flex: 2, padding: '11px', background: 'linear-gradient(135deg,#f0b23d,#d4881f)', border: 'none', borderRadius: '10px', cursor: 'pointer', fontWeight: '800', color: '#1c1917' }}>{saving ? 'Saving...' : '✓ Save Adjustment'}</button>
        </div>
      </div>
    </div>
  )
}
