import { useState, useEffect } from 'react'
import { supabase } from '../../supabase'
import toast from 'react-hot-toast'

const formatLKR = (n) => `LKR ${(n || 0).toLocaleString('en-LK', { minimumFractionDigits: 2 })}`
const timeAgo = (d) => new Date(d).toLocaleString('en-LK', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })

// Short-term personal lending/borrowing — entirely independent of the
// customer and supplier ledgers. Same feature as the repair division's
// version, adapted to retail's cash model: retail doesn't keep a running
// cash-ledger table the way repair does — Cashflow/EndOfShift compute the
// cash position by summing source tables for a period, with `cash_adjustment`
// bank_transactions rows as the existing, established bucket for cash moving
// outside a normal sale/expense (see Settings.jsx's superadmin cash
// adjustment tool) — lending's cash movements use that exact same mechanism
// so they show up correctly in existing cash reports without needing to
// teach those reports a whole new source.
export default function Lending({ activeShop }) {
  const [records, setRecords] = useState([])
  const [loading, setLoading] = useState(true)
  const [showNew, setShowNew] = useState(false)
  const [repaying, setRepaying] = useState(null)
  const [viewing, setViewing] = useState(null)
  const [history, setHistory] = useState([])

  useEffect(() => { fetchRecords() }, [activeShop?.id])

  async function fetchRecords() {
    setLoading(true)
    let q = supabase.from('lending_records').select('*, bank_accounts(name)').order('created_at', { ascending: false })
    if (activeShop?.id) q = q.eq('shop_id', activeShop.id)
    const { data } = await q
    setRecords(data || [])
    setLoading(false)
  }

  async function viewRecord(r) {
    const { data } = await supabase.from('lending_repayments').select('*, bank_accounts(name)').eq('lending_id', r.id).order('created_at', { ascending: false })
    setHistory(data || [])
    setViewing(r)
  }

  async function markChequeRealized(r) {
    if (!window.confirm(`Mark this cheque as realized? This will ${r.type === 'lent' ? 'deduct' : 'add'} ${formatLKR(r.principal_amount)} ${r.bank_account_id ? `from ${r.bank_accounts?.name}` : 'in cash'} now.`)) return
    try {
      const delta = r.type === 'lent' ? -r.principal_amount : r.principal_amount
      if (r.bank_account_id) {
        const { data: bank } = await supabase.from('bank_accounts').select('balance').eq('id', r.bank_account_id).single()
        const { error: bankErr } = await supabase.from('bank_accounts').update({ balance: (bank?.balance || 0) + delta }).eq('id', r.bank_account_id)
        if (bankErr) throw bankErr
        const { error: txErr } = await supabase.from('bank_transactions').insert({
          bank_account_id: r.bank_account_id, type: delta > 0 ? 'deposit' : 'withdrawal', amount: r.principal_amount,
          reference: `Lending — ${r.person_name}`, notes: `Cheque realized (${r.type})`,
        })
        if (txErr) throw txErr
      } else {
        const { error: cashErr } = await supabase.from('bank_transactions').insert({
          type: 'cash_adjustment', amount: r.principal_amount, shop_id: r.shop_id,
          notes: `[${delta > 0 ? '+' : '-'}] Lending cheque realized — ${r.person_name}`,
          reference: `Lending (${r.type})`,
        })
        if (cashErr) throw cashErr
      }
      const { error: updErr } = await supabase.from('lending_records').update({ cheque_realized: true }).eq('id', r.id)
      if (updErr) throw updErr
      toast.success('Cheque marked realized')
      fetchRecords()
    } catch (e) { toast.error('Failed: ' + e.message) }
  }

  const totalLentOut = records.filter(r => r.type === 'lent' && r.status === 'active').reduce((s, r) => s + (r.principal_amount - r.amount_repaid), 0)
  const totalBorrowed = records.filter(r => r.type === 'borrowed' && r.status === 'active').reduce((s, r) => s + (r.principal_amount - r.amount_repaid), 0)

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '18px' }}>
        <div>
          <h1 style={{ fontSize: '22px', fontWeight: '800', color: '#0f172a', margin: '0 0 4px' }}>Personal Lending</h1>
          <p style={{ color: '#64748b', fontSize: '13px', margin: 0 }}>Short-term cash lent or borrowed — separate from customer/supplier accounts</p>
        </div>
        <button onClick={() => setShowNew(true)} style={{ padding: '10px 20px', background: 'linear-gradient(135deg,#2563eb,#1d4ed8)', color: 'white', border: 'none', borderRadius: '11px', cursor: 'pointer', fontWeight: '800', fontSize: '13px' }}>
          + New Record
        </button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(200px, 1fr))', gap: '14px', marginBottom: '20px', maxWidth: '520px' }}>
        <div style={{ background: '#fef2f2', borderRadius: '14px', padding: '16px 18px', border: '1px solid rgba(0,0,0,0.04)' }}>
          <div style={{ fontSize: '11px', fontWeight: '700', color: '#dc2626', textTransform: 'uppercase' }}>Lent Out (Outstanding)</div>
          <div style={{ fontSize: '21px', fontWeight: '800', color: '#dc2626' }}>{formatLKR(totalLentOut)}</div>
        </div>
        <div style={{ background: '#fffbeb', borderRadius: '14px', padding: '16px 18px', border: '1px solid rgba(0,0,0,0.04)' }}>
          <div style={{ fontSize: '11px', fontWeight: '700', color: '#d97706', textTransform: 'uppercase' }}>Borrowed (Outstanding)</div>
          <div style={{ fontSize: '21px', fontWeight: '800', color: '#d97706' }}>{formatLKR(totalBorrowed)}</div>
        </div>
      </div>

      {loading ? <div style={{ padding: '60px', textAlign: 'center', color: '#94a3b8' }}>Loading...</div> : (
        <div style={{ background: 'white', borderRadius: '16px', border: '1px solid #e2e8f0', overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr style={{ background: '#f8fafc', borderBottom: '2px solid #e2e8f0' }}>
              {['Person', 'Type', 'Principal', 'Repaid', 'Outstanding', 'Status', ''].map(h => (
                <th key={h} style={{ padding: '10px 14px', textAlign: 'left', fontSize: '10px', fontWeight: '700', color: '#94a3b8', textTransform: 'uppercase' }}>{h}</th>
              ))}
            </tr></thead>
            <tbody>
              {records.map((r, i) => {
                const outstanding = r.principal_amount - r.amount_repaid
                const chequePending = r.method === 'cheque' && !r.cheque_realized
                return (
                  <tr key={r.id} style={{ borderBottom: '1px solid #f1f5f9', background: i % 2 === 0 ? 'white' : '#f8fafc' }}>
                    <td onClick={() => viewRecord(r)} style={{ padding: '11px 14px', fontWeight: '700', cursor: 'pointer' }}>{r.person_name}</td>
                    <td style={{ padding: '11px 14px' }}>
                      <span style={{ padding: '3px 10px', borderRadius: '8px', fontSize: '11px', fontWeight: '700', background: r.type === 'lent' ? '#fef2f2' : '#fffbeb', color: r.type === 'lent' ? '#dc2626' : '#d97706' }}>
                        {r.type === 'lent' ? 'Lent' : 'Borrowed'}
                      </span>
                    </td>
                    <td style={{ padding: '11px 14px', fontWeight: '700' }}>{formatLKR(r.principal_amount)}</td>
                    <td style={{ padding: '11px 14px', color: '#059669' }}>{formatLKR(r.amount_repaid)}</td>
                    <td style={{ padding: '11px 14px', fontWeight: '700', color: outstanding > 0 ? '#dc2626' : '#94a3b8' }}>{formatLKR(outstanding)}</td>
                    <td style={{ padding: '11px 14px' }}>
                      {chequePending ? (
                        <span style={{ padding: '3px 10px', borderRadius: '8px', fontSize: '11px', fontWeight: '700', background: '#fef9c3', color: '#a16207' }}>Cheque Pending</span>
                      ) : r.status === 'settled' ? (
                        <span style={{ padding: '3px 10px', borderRadius: '8px', fontSize: '11px', fontWeight: '700', background: '#f1f5f9', color: '#64748b' }}>Settled</span>
                      ) : (
                        <span style={{ padding: '3px 10px', borderRadius: '8px', fontSize: '11px', fontWeight: '700', background: '#f0fdf4', color: '#166534' }}>Active</span>
                      )}
                    </td>
                    <td style={{ padding: '11px 14px', display: 'flex', gap: '6px' }}>
                      {chequePending && (
                        <button onClick={() => markChequeRealized(r)} style={{ padding: '4px 10px', background: '#fef9c3', color: '#a16207', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '11px', fontWeight: '700' }}>
                          Mark Realized
                        </button>
                      )}
                      {r.status === 'active' && !chequePending && outstanding > 0.009 && (
                        <button onClick={() => setRepaying(r)} style={{ padding: '4px 10px', background: '#f0fdf4', color: '#059669', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '11px', fontWeight: '700' }}>
                          Record Repayment
                        </button>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          {records.length === 0 && <div style={{ padding: '48px', textAlign: 'center', color: '#94a3b8' }}>No lending records yet.</div>}
        </div>
      )}

      {showNew && <NewLendingModal activeShop={activeShop} onClose={() => setShowNew(false)} onSaved={() => { setShowNew(false); fetchRecords() }} />}
      {repaying && <RepaymentModal activeShop={activeShop} record={repaying} onClose={() => setRepaying(null)} onSaved={() => { setRepaying(null); fetchRecords() }} />}

      {viewing && (
        <div onClick={() => setViewing(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '20px' }}>
          <div onClick={e => e.stopPropagation()} style={{ background: 'white', borderRadius: '18px', padding: '24px', width: '100%', maxWidth: '440px', maxHeight: '80vh', overflowY: 'auto' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
              <h3 style={{ fontSize: '16px', fontWeight: '800', margin: 0 }}>{viewing.person_name}</h3>
              <button onClick={() => setViewing(null)} style={{ background: 'none', border: 'none', fontSize: '18px', cursor: 'pointer', color: '#94a3b8' }}>✕</button>
            </div>
            <p style={{ fontSize: '12px', color: '#64748b', margin: '0 0 4px' }}>
              {viewing.type === 'lent' ? 'We lent' : 'We borrowed'} {formatLKR(viewing.principal_amount)} via {viewing.method}{viewing.bank_accounts?.name ? ` (${viewing.bank_accounts.name})` : ''}
            </p>
            <p style={{ fontSize: '12px', color: '#64748b', margin: '0 0 16px' }}>{timeAgo(viewing.created_at)}</p>
            {viewing.notes && <div style={{ background: '#f8fafc', borderRadius: '8px', padding: '10px 12px', marginBottom: '14px', fontSize: '13px' }}>{viewing.notes}</div>}
            <div style={{ fontWeight: '700', fontSize: '13px', marginBottom: '8px' }}>Repayments</div>
            {history.length === 0 ? (
              <div style={{ fontSize: '12px', color: '#94a3b8' }}>No repayments recorded yet.</div>
            ) : history.map(h => (
              <div key={h.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '1px solid #f1f5f9', fontSize: '13px' }}>
                <span>{timeAgo(h.created_at)} — {h.method}{h.bank_accounts?.name ? ` (${h.bank_accounts.name})` : ''}</span>
                <span style={{ fontWeight: '700', color: '#059669' }}>{formatLKR(h.amount)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function NewLendingModal({ activeShop, onClose, onSaved }) {
  const [personName, setPersonName] = useState('')
  const [contact, setContact] = useState('')
  const [type, setType] = useState('lent')
  const [amount, setAmount] = useState('')
  const [method, setMethod] = useState('cash')
  const [bankAccountId, setBankAccountId] = useState('')
  const [bankAccounts, setBankAccounts] = useState([])
  const [chequeNo, setChequeNo] = useState('')
  const [chequeDate, setChequeDate] = useState('')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => { supabase.from('bank_accounts').select('*').order('name').then(({ data }) => setBankAccounts(data || [])) }, [])

  async function handleSave() {
    const amt = parseFloat(amount)
    if (!personName.trim()) return toast.error('Enter a name')
    if (!amt || amt <= 0) return toast.error('Enter a valid amount')
    if ((method === 'bank' || method === 'cheque') && !bankAccountId) return toast.error('Select a bank account')
    if (method === 'cash' && !activeShop?.id) return toast.error('Select a shop first — cash lending needs a shop to record against')
    setSaving(true)
    let recordId = null
    try {
      const { data: rec, error } = await supabase.from('lending_records').insert({
        shop_id: activeShop?.id || null, person_name: personName.trim(), contact: contact.trim() || null,
        type, principal_amount: amt, method,
        bank_account_id: (method === 'bank' || method === 'cheque') ? bankAccountId : null,
        cheque_no: method === 'cheque' ? chequeNo || null : null,
        cheque_date: method === 'cheque' ? chequeDate || null : null,
        notes: notes || null,
      }).select().single()
      if (error) throw error
      recordId = rec.id

      // Cheque: no money movement yet — recorded pending, realized separately.
      if (method === 'cash') {
        const delta = type === 'lent' ? -amt : amt
        const { error: cashErr } = await supabase.from('bank_transactions').insert({
          type: 'cash_adjustment', amount: amt, shop_id: activeShop.id,
          notes: `[${delta > 0 ? '+' : '-'}] ${type === 'lent' ? 'Lent to' : 'Borrowed from'} ${personName.trim()}`,
          reference: `Lending (${type})`,
        })
        if (cashErr) throw cashErr
      } else if (method === 'bank') {
        const bank = bankAccounts.find(b => b.id === bankAccountId)
        const delta = type === 'lent' ? -amt : amt
        const { error: bankErr } = await supabase.from('bank_accounts').update({ balance: (bank?.balance || 0) + delta }).eq('id', bankAccountId)
        if (bankErr) throw bankErr
        const { error: txErr } = await supabase.from('bank_transactions').insert({
          bank_account_id: bankAccountId, type: type === 'lent' ? 'withdrawal' : 'deposit', amount: amt,
          reference: `Lending — ${personName.trim()}`, notes: type === 'lent' ? 'Lent out' : 'Borrowed',
        })
        if (txErr) throw txErr
      }

      toast.success('Lending record saved')
      onSaved()
    } catch (e) {
      if (recordId) await supabase.from('lending_records').delete().eq('id', recordId)
      toast.error('Failed: ' + e.message)
    }
    setSaving(false)
  }

  const inp = { width: '100%', padding: '9px 12px', border: '1.5px solid #e2e8f0', borderRadius: '8px', fontSize: '13px', boxSizing: 'border-box' }
  const lbl = { fontSize: '11px', fontWeight: '700', color: '#94a3b8', textTransform: 'uppercase', display: 'block', marginBottom: '5px' }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '20px' }}>
      <div style={{ background: 'white', borderRadius: '18px', padding: '26px', width: '100%', maxWidth: '440px', maxHeight: '90vh', overflowY: 'auto' }}>
        <h3 style={{ fontSize: '17px', fontWeight: '800', margin: '0 0 16px' }}>New Lending Record</h3>

        <div style={{ display: 'flex', gap: '8px', marginBottom: '14px' }}>
          <button onClick={() => setType('lent')} style={{ flex: 1, padding: '9px', borderRadius: '8px', border: type === 'lent' ? '1.5px solid #dc2626' : '1.5px solid #e2e8f0', background: type === 'lent' ? '#fef2f2' : 'white', color: type === 'lent' ? '#dc2626' : '#64748b', fontWeight: '700', fontSize: '13px', cursor: 'pointer' }}>
            We Lent Out
          </button>
          <button onClick={() => setType('borrowed')} style={{ flex: 1, padding: '9px', borderRadius: '8px', border: type === 'borrowed' ? '1.5px solid #d97706' : '1.5px solid #e2e8f0', background: type === 'borrowed' ? '#fffbeb' : 'white', color: type === 'borrowed' ? '#d97706' : '#64748b', fontWeight: '700', fontSize: '13px', cursor: 'pointer' }}>
            We Borrowed
          </button>
        </div>

        <div style={{ marginBottom: '12px' }}><label style={lbl}>Person Name</label><input style={inp} value={personName} onChange={e => setPersonName(e.target.value)} /></div>
        <div style={{ marginBottom: '12px' }}><label style={lbl}>Contact (optional)</label><input style={inp} value={contact} onChange={e => setContact(e.target.value)} /></div>
        <div style={{ marginBottom: '12px' }}><label style={lbl}>Amount</label><input type="number" style={inp} value={amount} onChange={e => setAmount(e.target.value)} /></div>

        <div style={{ marginBottom: '12px' }}>
          <label style={lbl}>Method</label>
          <select style={inp} value={method} onChange={e => setMethod(e.target.value)}>
            <option value="cash">Cash</option><option value="cheque">Cheque</option><option value="bank">Bank Transfer</option>
          </select>
        </div>

        {(method === 'bank' || method === 'cheque') && (
          <div style={{ marginBottom: '12px' }}>
            <label style={lbl}>Bank Account</label>
            <select style={inp} value={bankAccountId} onChange={e => setBankAccountId(e.target.value)}>
              <option value="">Select...</option>
              {bankAccounts.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </div>
        )}
        {method === 'cheque' && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginBottom: '12px' }}>
            <div><label style={lbl}>Cheque No</label><input style={inp} value={chequeNo} onChange={e => setChequeNo(e.target.value)} /></div>
            <div><label style={lbl}>Cheque Date</label><input type="date" style={inp} value={chequeDate} onChange={e => setChequeDate(e.target.value)} /></div>
          </div>
        )}

        <div style={{ marginBottom: '18px' }}><label style={lbl}>Notes (optional)</label><textarea style={{ ...inp, minHeight: '60px' }} value={notes} onChange={e => setNotes(e.target.value)} /></div>

        <div style={{ display: 'flex', gap: '10px' }}>
          <button onClick={onClose} style={{ flex: 1, padding: '11px', background: '#f1f5f9', border: 'none', borderRadius: '10px', cursor: 'pointer', fontWeight: '700' }}>Cancel</button>
          <button onClick={handleSave} disabled={saving} style={{ flex: 1, padding: '11px', background: 'linear-gradient(135deg,#2563eb,#1d4ed8)', color: 'white', border: 'none', borderRadius: '10px', cursor: 'pointer', fontWeight: '800' }}>{saving ? 'Saving...' : 'Save'}</button>
        </div>
      </div>
    </div>
  )
}

function RepaymentModal({ activeShop, record, onClose, onSaved }) {
  const outstanding = record.principal_amount - record.amount_repaid
  const [amount, setAmount] = useState(String(outstanding))
  const [method, setMethod] = useState('cash')
  const [bankAccountId, setBankAccountId] = useState('')
  const [bankAccounts, setBankAccounts] = useState([])
  const [saving, setSaving] = useState(false)

  useEffect(() => { supabase.from('bank_accounts').select('*').order('name').then(({ data }) => setBankAccounts(data || [])) }, [])

  async function handleSave() {
    const amt = parseFloat(amount)
    if (!amt || amt <= 0) return toast.error('Enter a valid amount')
    if (amt > outstanding + 0.009) return toast.error(`Can't repay more than the outstanding ${formatLKR(outstanding)}`)
    if (method === 'bank' && !bankAccountId) return toast.error('Select a bank account')
    if (method === 'cash' && !(record.shop_id || activeShop?.id)) return toast.error('No shop on record for this — select a shop first')
    setSaving(true)
    try {
      // Repaying a LENT record means money comes back IN to us; repaying a
      // BORROWED record means we're paying it back OUT.
      const delta = record.type === 'lent' ? amt : -amt
      if (method === 'cash') {
        const { error: cashErr } = await supabase.from('bank_transactions').insert({
          type: 'cash_adjustment', amount: amt, shop_id: record.shop_id || activeShop?.id,
          notes: `[${delta > 0 ? '+' : '-'}] Lending repayment — ${record.person_name}`,
          reference: 'Lending repayment',
        })
        if (cashErr) throw cashErr
      } else {
        const bank = bankAccounts.find(b => b.id === bankAccountId)
        const { error: bankErr } = await supabase.from('bank_accounts').update({ balance: (bank?.balance || 0) + delta }).eq('id', bankAccountId)
        if (bankErr) throw bankErr
        const { error: txErr } = await supabase.from('bank_transactions').insert({
          bank_account_id: bankAccountId, type: delta > 0 ? 'deposit' : 'withdrawal', amount: amt,
          reference: `Lending repayment — ${record.person_name}`, notes: '',
        })
        if (txErr) throw txErr
      }

      const { error: repayErr } = await supabase.from('lending_repayments').insert({
        lending_id: record.id, amount: amt, method, bank_account_id: method === 'bank' ? bankAccountId : null,
      })
      if (repayErr) throw repayErr

      const newRepaid = record.amount_repaid + amt
      const { error: updErr } = await supabase.from('lending_records').update({
        amount_repaid: newRepaid, status: newRepaid >= record.principal_amount - 0.009 ? 'settled' : 'active',
      }).eq('id', record.id)
      if (updErr) throw updErr

      toast.success('Repayment recorded')
      onSaved()
    } catch (e) { toast.error('Failed: ' + e.message) }
    setSaving(false)
  }

  const inp = { width: '100%', padding: '9px 12px', border: '1.5px solid #e2e8f0', borderRadius: '8px', fontSize: '13px', boxSizing: 'border-box' }
  const lbl = { fontSize: '11px', fontWeight: '700', color: '#94a3b8', textTransform: 'uppercase', display: 'block', marginBottom: '5px' }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1100, padding: '20px' }}>
      <div style={{ background: 'white', borderRadius: '18px', padding: '24px', width: '100%', maxWidth: '400px' }}>
        <h3 style={{ fontSize: '16px', fontWeight: '800', margin: '0 0 4px' }}>Record Repayment — {record.person_name}</h3>
        <p style={{ fontSize: '12px', color: '#64748b', margin: '0 0 16px' }}>Outstanding: {formatLKR(outstanding)}</p>

        <div style={{ marginBottom: '12px' }}><label style={lbl}>Amount</label><input type="number" style={inp} value={amount} onChange={e => setAmount(e.target.value)} /></div>
        <div style={{ marginBottom: '12px' }}>
          <label style={lbl}>Method</label>
          <select style={inp} value={method} onChange={e => setMethod(e.target.value)}>
            <option value="cash">Cash</option><option value="bank">Bank Transfer</option>
          </select>
        </div>
        {method === 'bank' && (
          <div style={{ marginBottom: '18px' }}>
            <label style={lbl}>Bank Account</label>
            <select style={inp} value={bankAccountId} onChange={e => setBankAccountId(e.target.value)}>
              <option value="">Select...</option>
              {bankAccounts.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </div>
        )}

        <div style={{ display: 'flex', gap: '10px' }}>
          <button onClick={onClose} style={{ flex: 1, padding: '10px', background: '#f1f5f9', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: '700' }}>Cancel</button>
          <button onClick={handleSave} disabled={saving} style={{ flex: 1, padding: '10px', background: '#059669', color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: '800' }}>{saving ? 'Saving...' : 'Confirm'}</button>
        </div>
      </div>
    </div>
  )
}
