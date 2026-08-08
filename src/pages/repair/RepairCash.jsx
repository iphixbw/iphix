import { useState, useEffect } from 'react'
import { supabase } from '../../supabase'
import toast from 'react-hot-toast'
import { formatLKR, timeAgo } from '../../lib/repairConstants'

export default function RepairCash({ shop }) {
  const [ledger, setLedger] = useState([])
  const [deposits, setDeposits] = useState([])
  const [bankAccounts, setBankAccounts] = useState([])
  const [loading, setLoading] = useState(true)
  const [showDeposit, setShowDeposit] = useState(false)

  useEffect(() => { fetchAll() }, [shop?.id])

  async function fetchAll() {
    setLoading(true)
    let lq = supabase.from('repair_cash_ledger').select('*').order('created_at', { ascending: false })
    let dq = supabase.from('repair_bank_deposits').select('*, bank_accounts(name, bank_name)').order('created_at', { ascending: false })
    if (shop?.id) { lq = lq.eq('shop_id', shop.id); dq = dq.eq('shop_id', shop.id) }
    const [{ data: l }, { data: d }, { data: banks }] = await Promise.all([
      lq, dq, supabase.from('bank_accounts').select('*').order('name')
    ])
    setLedger(l || [])
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
      <p style={{ color: '#8a7a63', fontSize: '14px', margin: '0 0 20px' }}>Separate repair cash account · deposits are the only link to Phonefix's main accounting</p>

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
            <option value="">Select Phonefix bank account...</option>
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
