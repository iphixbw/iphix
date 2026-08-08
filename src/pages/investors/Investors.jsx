import { useState, useEffect } from 'react'
import { supabase } from '../../supabase'
import { formatCurrency } from '../../lib/helpers'
import { recordBankMovement } from '../../lib/bank'
import toast from 'react-hot-toast'

const RETURN_TYPES = { fixed: 'Fixed Amount', profit_share: 'Profit Share %' }
const PERIODS = { monthly: 'Monthly', quarterly: 'Quarterly', yearly: 'Yearly', one_off: 'One-off' }
const TX_TYPES = {
  capital_in:   { label: 'Capital Received',  color: '#059669', bg: '#dcfce7', icon: '↓' },
  return_paid:  { label: 'Return Paid',        color: '#e11d48', bg: '#fee2e2', icon: '↑' },
  withdrawal:   { label: 'Withdrawal',         color: '#d97706', bg: '#fef3c7', icon: '↑' },
}

export default function Investors() {
  const [view, setView] = useState('list') // list | detail | new
  const [investors, setInvestors] = useState([])
  const [loading, setLoading] = useState(true)
  const [selectedInvestor, setSelectedInvestor] = useState(null)
  const [ledger, setLedger] = useState([])
  const [ledgerLoading, setLedgerLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [showTxForm, setShowTxForm] = useState(false)
  const [showInvestorForm, setShowInvestorForm] = useState(false)
  const [editingInvestor, setEditingInvestor] = useState(null)

  // Profit data for profit share calculations
  const [monthlyProfit, setMonthlyProfit] = useState(0)
  const [bankAccounts, setBankAccounts] = useState([])
  const [totalCapitalReceived, setTotalCapitalReceived] = useState(0)

  const [investorForm, setInvestorForm] = useState({
    name: '', phone: '', email: '', address: '',
    return_type: 'fixed', return_value: '', return_period: 'monthly',
    status: 'active', notes: ''
  })
  const [txForm, setTxForm] = useState({
    type: 'capital_in', amount: '', date: new Date().toISOString().split('T')[0],
    payment_method: 'cash', cheque_no: '', cheque_date: '', cheque_bank_name: '',
    bank_account_id: '', // for outgoing cheques (return/withdrawal)
    reference: '', notes: ''
  })

  useEffect(() => { fetchInvestors() }, [])

  async function fetchInvestors() {
    setLoading(true)
    const { data } = await supabase.from('investors').select('*').order('created_at', { ascending: false })
    setInvestors(data || [])

    const { data: banks } = await supabase.from('bank_accounts').select('*').order('name')
    setBankAccounts(banks || [])

    // Fetch this month's profit for profit share calculation
    const firstDay = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString()
    const { data: invData } = await supabase.from('invoices')
      .select('total').eq('status', 'confirmed').gte('created_at', firstDay)
    const { data: expData } = await supabase.from('expenses')
      .select('amount').gte('created_at', firstDay)
    const revenue = (invData || []).reduce((s, i) => s + (i.total || 0), 0)
    const expenses = (expData || []).reduce((s, e) => s + (e.amount || 0), 0)
    setMonthlyProfit(Math.max(0, revenue - expenses))

    // Total capital received across all investors (all time)
    const { data: allTx } = await supabase.from('investment_transactions')
      .select('amount, type')
    const capitalIn = (allTx || []).filter(t => t.type === 'capital_in').reduce((s, t) => s + (t.amount || 0), 0)
    setTotalCapitalReceived(capitalIn)

    setLoading(false)
  }

  async function fetchLedger(investorId) {
    setLedgerLoading(true)
    const { data } = await supabase.from('investment_transactions')
      .select('*').eq('investor_id', investorId)
      .order('date', { ascending: false })
    setLedger(data || [])
    setLedgerLoading(false)
  }

  function openInvestor(inv) {
    setSelectedInvestor(inv)
    fetchLedger(inv.id)
    setView('detail')
  }

  async function saveInvestor() {
    if (!investorForm.name.trim()) return toast.error('Name is required')
    setSaving(true)
    try {
      const payload = {
        name: investorForm.name.trim(),
        phone: investorForm.phone || null,
        email: investorForm.email || null,
        address: investorForm.address || null,
        return_type: investorForm.return_type,
        return_value: parseFloat(investorForm.return_value) || 0,
        return_period: investorForm.return_period,
        status: investorForm.status,
        notes: investorForm.notes || null,
      }
      if (editingInvestor) {
        await supabase.from('investors').update(payload).eq('id', editingInvestor.id)
        toast.success('Investor updated!')
      } else {
        await supabase.from('investors').insert(payload)
        toast.success('Investor added!')
      }
      setShowInvestorForm(false)
      setEditingInvestor(null)
      resetInvestorForm()
      fetchInvestors()
      if (selectedInvestor) {
        const { data } = await supabase.from('investors').select('*').eq('id', selectedInvestor.id).single()
        setSelectedInvestor(data)
      }
    } catch (e) { toast.error('Failed: ' + e.message) }
    setSaving(false)
  }

  async function saveTx() {
    if (!txForm.amount || parseFloat(txForm.amount) <= 0) return toast.error('Enter a valid amount')
    if (!txForm.date) return toast.error('Select a date')
    setSaving(true)
    try {
      await supabase.from('investment_transactions').insert({
        investor_id: selectedInvestor.id,
        type: txForm.type,
        amount: parseFloat(txForm.amount),
        date: txForm.date,
        payment_method: txForm.payment_method,
        cheque_no: txForm.payment_method === 'cheque' ? txForm.cheque_no || null : null,
        cheque_date: txForm.payment_method === 'cheque' ? txForm.cheque_date || null : null,
        cheque_bank_name: txForm.payment_method === 'cheque' ? txForm.cheque_bank_name || null : null,
        reference: txForm.reference || null,
        notes: txForm.notes || null,
      })

      // Wire cheques into bank unrealized cheques
      if (txForm.payment_method === 'cheque' && txForm.cheque_date) {
        const amt = parseFloat(txForm.amount)
        if (txForm.type === 'capital_in') {
          await supabase.from('bank_transactions').insert({
            bank_account_id: null, type: 'cheque_in', amount: amt,
            cheque_no: txForm.cheque_no || null, cheque_date: txForm.cheque_date,
            cheque_status: 'pending',
            reference: `Investor: ${selectedInvestor.name}`,
            notes: `Capital received${txForm.cheque_bank_name ? ` · Bank: ${txForm.cheque_bank_name}` : ''}${txForm.notes ? ` · ${txForm.notes}` : ''}`,
          })
          toast.success('Transaction recorded & added to Bank → Unrealized Cheques In')
        } else {
          if (!txForm.bank_account_id) { toast.error('Please select a bank account for the outgoing cheque'); setSaving(false); return }
          await supabase.from('bank_transactions').insert({
            bank_account_id: txForm.bank_account_id, type: 'cheque_out', amount: parseFloat(txForm.amount),
            cheque_no: txForm.cheque_no || null, cheque_date: txForm.cheque_date,
            cheque_status: 'pending',
            reference: `Investor: ${selectedInvestor.name} · ${txForm.type === 'return_paid' ? 'Return' : 'Withdrawal'}`,
            notes: txForm.notes || null,
          })
          toast.success('Transaction recorded & added to Bank → Unrealized Cheques Out')
        }
      } else if (txForm.payment_method === 'bank_transfer') {
        const amt = parseFloat(txForm.amount)
        if (txForm.type === 'capital_in') {
          // Capital received via bank transfer — credit the selected bank account
          if (!txForm.bank_account_id) { toast.error('Please select a bank account'); setSaving(false); return }
          await recordBankMovement({
            bankAccountId: txForm.bank_account_id,
            direction: 'deposit',
            amount: amt,
            reference: `Investor Capital: ${selectedInvestor.name}`,
            notes: txForm.notes || null,
          })
          toast.success('Transaction recorded & bank account credited!')
        } else {
          // Return or withdrawal via bank transfer — deduct from selected bank account
          if (!txForm.bank_account_id) { toast.error('Please select a bank account'); setSaving(false); return }
          await recordBankMovement({
            bankAccountId: txForm.bank_account_id,
            direction: 'withdrawal',
            amount: amt,
            reference: `Investor ${txForm.type === 'return_paid' ? 'Return' : 'Withdrawal'}: ${selectedInvestor.name}`,
            notes: txForm.notes || null,
          })
          toast.success('Transaction recorded & bank account debited!')
        }
      } else {
        // Cash transactions — wire to cashflow
        const amt = parseFloat(txForm.amount)
        if (txForm.type === 'capital_in') {
          // Cash received from investor → tracked via investment_transactions (type=capital_in, payment_method=cash)
          // Cashflow reads investment_transactions for "Cash from Investors" — do NOT also insert cash_deposits
          toast.success('Transaction recorded! Cash in hand updated.')
        } else {
          // Cash paid to investor (withdrawal or return) → deducts from cash in hand
          await supabase.from('expenses').insert({
            description: `Investor payment: ${selectedInvestor.name}${txForm.notes ? ` · ${txForm.notes}` : ''}`,
            amount: amt,
            payment_method: 'cash',
            category: 'Investor Payment',
            shop_id: null,
          })
          toast.success('Transaction recorded! Cash out recorded.')
        }
      }
      setShowTxForm(false)
      resetTxForm()
      fetchLedger(selectedInvestor.id)
      // Refresh investor data
      const { data } = await supabase.from('investors').select('*').eq('id', selectedInvestor.id).single()
      setSelectedInvestor(data)
      fetchInvestors()
    } catch (e) { toast.error('Failed: ' + e.message) }
    setSaving(false)
  }

  async function deleteTx(id) {
    if (!window.confirm('Delete this transaction?')) return
    await supabase.from('investment_transactions').delete().eq('id', id)
    toast.success('Deleted')
    fetchLedger(selectedInvestor.id)
    fetchInvestors()
  }

  function resetInvestorForm() {
    setInvestorForm({ name: '', phone: '', email: '', address: '', return_type: 'fixed', return_value: '', return_period: 'monthly', status: 'active', notes: '' })
  }
  function resetTxForm() {
    setTxForm({ type: 'capital_in', amount: '', date: new Date().toISOString().split('T')[0], payment_method: 'cash', cheque_no: '', cheque_date: '', cheque_bank_name: '', bank_account_id: '', reference: '', notes: '' })
  }

  // Compute totals per investor from transactions
  function getInvestorTotals(investorId, txList) {
    const txs = txList || []
    const capitalIn = txs.filter(t => t.investor_id === investorId && t.type === 'capital_in').reduce((s, t) => s + t.amount, 0)
    const returnsPaid = txs.filter(t => t.investor_id === investorId && t.type === 'return_paid').reduce((s, t) => s + t.amount, 0)
    const withdrawals = txs.filter(t => t.investor_id === investorId && t.type === 'withdrawal').reduce((s, t) => s + t.amount, 0)
    return { capitalIn, returnsPaid, withdrawals, balance: capitalIn - returnsPaid - withdrawals }
  }

  // For detail view — compute from ledger
  // Net balance = capital received minus withdrawals only (returns are NOT deducted from capital)
  const detailTotals = selectedInvestor ? {
    capitalIn: ledger.filter(t => t.type === 'capital_in').reduce((s, t) => s + t.amount, 0),
    returnsPaid: ledger.filter(t => t.type === 'return_paid').reduce((s, t) => s + t.amount, 0),
    withdrawals: ledger.filter(t => t.type === 'withdrawal').reduce((s, t) => s + t.amount, 0),
  } : {}
  // Capital held = capital in minus withdrawals (returns are separate — profit to investors, not return of capital)
  const netBalance = (detailTotals.capitalIn || 0) - (detailTotals.withdrawals || 0)

  // Calculate return due this period
  function calcReturnDue(investor) {
    if (investor.return_type === 'fixed') return investor.return_value || 0
    if (investor.return_type === 'profit_share') return (monthlyProfit * (investor.return_value || 0)) / 100
    return 0
  }

  // Summary across all investors
  const totalCapital = investors.reduce((s, inv) => {
    // We'd need all transactions — approximate from investor records
    return s
  }, 0)
  const activeInvestors = investors.filter(i => i.status === 'active')
  const totalReturnDue = activeInvestors.reduce((s, inv) => s + calcReturnDue(inv), 0)

  const inp = { width: '100%', padding: '9px 12px', border: '1.5px solid #e2e8f0', borderRadius: '7px', fontSize: '14px', boxSizing: 'border-box', outline: 'none', background: 'white' }
  const lbl = { display: 'block', marginBottom: '5px', fontSize: '11px', fontWeight: '700', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.06em' }
  const card = { background: 'white', borderRadius: '12px', padding: '20px', boxShadow: '0 1px 3px rgba(15,23,42,0.06), 0 1px 2px rgba(15,23,42,0.04)', marginBottom: '16px', border: '1px solid #f1f5f9' }

  return (
    <div>
      {/* Investor form modal */}
      {showInvestorForm && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ background: 'white', borderRadius: '16px', padding: '32px', width: '520px', maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 20px 60px rgba(0,0,0,0.25)' }}>
            <h2 style={{ fontSize: '18px', fontWeight: '700', color: '#0f172a', margin: '0 0 20px' }}>
              {editingInvestor ? 'Edit Investor' : 'Add Investor'}
            </h2>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
              <div style={{ gridColumn: '1/-1' }}>
                <label style={lbl}>Full Name *</label>
                <input type="text" value={investorForm.name} onChange={e => setInvestorForm(p => ({ ...p, name: e.target.value }))} placeholder="Investor name" style={inp} autoFocus />
              </div>
              <div>
                <label style={lbl}>Phone</label>
                <input type="text" value={investorForm.phone} onChange={e => setInvestorForm(p => ({ ...p, phone: e.target.value }))} placeholder="07X XXX XXXX" style={inp} />
              </div>
              <div>
                <label style={lbl}>Email</label>
                <input type="email" value={investorForm.email} onChange={e => setInvestorForm(p => ({ ...p, email: e.target.value }))} placeholder="email@example.com" style={inp} />
              </div>
              <div style={{ gridColumn: '1/-1' }}>
                <label style={lbl}>Address</label>
                <input type="text" value={investorForm.address} onChange={e => setInvestorForm(p => ({ ...p, address: e.target.value }))} placeholder="Address" style={inp} />
              </div>
              <div>
                <label style={lbl}>Return Type</label>
                <select value={investorForm.return_type} onChange={e => setInvestorForm(p => ({ ...p, return_type: e.target.value }))} style={inp}>
                  <option value="fixed">Fixed Amount</option>
                  <option value="profit_share">Profit Share %</option>
                </select>
              </div>
              <div>
                <label style={lbl}>{investorForm.return_type === 'fixed' ? 'Return Amount (LKR)' : 'Profit Share (%)'}</label>
                <input type="number" value={investorForm.return_value} onChange={e => setInvestorForm(p => ({ ...p, return_value: e.target.value }))}
                  placeholder={investorForm.return_type === 'fixed' ? '0.00' : '0'} style={inp} />
              </div>
              <div>
                <label style={lbl}>Return Period</label>
                <select value={investorForm.return_period} onChange={e => setInvestorForm(p => ({ ...p, return_period: e.target.value }))} style={inp}>
                  {Object.entries(PERIODS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </div>
              <div>
                <label style={lbl}>Status</label>
                <select value={investorForm.status} onChange={e => setInvestorForm(p => ({ ...p, status: e.target.value }))} style={inp}>
                  <option value="active">Active</option>
                  <option value="closed">Closed</option>
                </select>
              </div>
              {investorForm.return_type === 'profit_share' && (
                <div style={{ gridColumn: '1/-1', padding: '10px 14px', background: '#eef2ff', borderRadius: '10px', fontSize: '13px', color: '#1e3a8a' }}>
                  💡 Based on this month's estimated profit of <strong>{formatCurrency(monthlyProfit)}</strong>, this investor would receive <strong>{formatCurrency((monthlyProfit * (parseFloat(investorForm.return_value) || 0)) / 100)}</strong>
                </div>
              )}
              <div style={{ gridColumn: '1/-1' }}>
                <label style={lbl}>Notes</label>
                <textarea value={investorForm.notes} onChange={e => setInvestorForm(p => ({ ...p, notes: e.target.value }))} rows={2} placeholder="Agreement details, terms, etc…" style={{ ...inp, resize: 'vertical', lineHeight: '1.5' }} />
              </div>
            </div>
            <div style={{ display: 'flex', gap: '10px', marginTop: '20px' }}>
              <button onClick={() => { setShowInvestorForm(false); setEditingInvestor(null); resetInvestorForm() }}
                style={{ flex: 1, padding: '11px', background: '#f1f5f9', color: '#475569', border: 'none', borderRadius: '10px', cursor: 'pointer', fontWeight: '600' }}>Cancel</button>
              <button onClick={saveInvestor} disabled={saving}
                style={{ flex: 2, padding: '11px', background: saving ? '#93c5fd' : 'linear-gradient(135deg,#2563eb,#1d4ed8)', color: 'white', border: 'none', borderRadius: '10px', cursor: 'pointer', fontWeight: '700', fontSize: '14px' }}>
                {saving ? 'Saving...' : editingInvestor ? 'Update Investor' : 'Add Investor'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Transaction form modal */}
      {showTxForm && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ background: 'white', borderRadius: '16px', padding: '32px', width: '420px', boxShadow: '0 20px 60px rgba(0,0,0,0.25)' }}>
            <h2 style={{ fontSize: '18px', fontWeight: '700', color: '#0f172a', margin: '0 0 6px' }}>Record Transaction</h2>
            <p style={{ fontSize: '13px', color: '#64748b', margin: '0 0 20px' }}>{selectedInvestor?.name}</p>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px' }}>
              <div style={{ gridColumn: '1/-1' }}>
                <label style={lbl}>Transaction Type</label>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '8px' }}>
                  {Object.entries(TX_TYPES).map(([k, v]) => (
                    <button key={k} onClick={() => setTxForm(p => ({ ...p, type: k }))}
                      style={{ padding: '10px 12px', borderRadius: '10px', border: `2px solid ${txForm.type === k ? v.color : '#e2e8f0'}`, background: txForm.type === k ? v.bg : 'white', cursor: 'pointer', fontSize: '12px', fontWeight: '700', color: txForm.type === k ? v.color : '#64748b', textAlign: 'left' }}>
                      <span style={{ marginRight: '6px' }}>{v.icon}</span>{v.label}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label style={lbl}>Amount (LKR) *</label>
                <input type="number" value={txForm.amount} onChange={e => setTxForm(p => ({ ...p, amount: e.target.value }))}
                  placeholder="0.00" style={{ ...inp, fontSize: '16px', fontWeight: '700' }} autoFocus />
              </div>
              <div>
                <label style={lbl}>Date *</label>
                <input type="date" value={txForm.date} onChange={e => setTxForm(p => ({ ...p, date: e.target.value }))} style={inp} />
              </div>

              {/* Payment Method */}
              <div style={{ gridColumn: '1/-1' }}>
                <label style={lbl}>Payment Method *</label>
                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                  {['cash', 'cheque', 'bank_transfer'].map(pm => (
                    <button key={pm} onClick={() => setTxForm(p => ({ ...p, payment_method: pm, cheque_no: '', cheque_date: '', cheque_bank_name: '' }))}
                      style={{ padding: '7px 16px', borderRadius: '20px', border: `2px solid ${txForm.payment_method === pm ? '#2563eb' : '#e2e8f0'}`, background: txForm.payment_method === pm ? '#eef2ff' : 'white', cursor: 'pointer', fontSize: '13px', fontWeight: '700', color: txForm.payment_method === pm ? '#1e40af' : '#64748b' }}>
                      {pm === 'cash' ? '💵 Cash' : pm === 'cheque' ? '🧾 Cheque' : '🏦 Bank Transfer'}
                    </button>
                  ))}
                </div>
              </div>

              {/* Cheque fields */}
              {txForm.payment_method === 'cheque' && (
                <>
                  {txForm.type === 'capital_in' && (
                    <div>
                      <label style={lbl}>Investor's Bank Name</label>
                      <input type="text" value={txForm.cheque_bank_name} onChange={e => setTxForm(p => ({ ...p, cheque_bank_name: e.target.value }))}
                        placeholder="e.g. Commercial Bank…" style={inp} />
                    </div>
                  )}
                  {(txForm.type === 'return_paid' || txForm.type === 'withdrawal') && (
                    <div style={{ gridColumn: '1/-1' }}>
                      <label style={lbl}>Our Bank Account * (cheque drawn from)</label>
                      <select value={txForm.bank_account_id} onChange={e => setTxForm(p => ({ ...p, bank_account_id: e.target.value }))}
                        style={{ ...inp, borderColor: !txForm.bank_account_id ? '#fca5a5' : '#e2e8f0' }}>
                        <option value="">— Select account —</option>
                        {bankAccounts.map(b => <option key={b.id} value={b.id}>{b.name} — {b.bank_name} (LKR {(b.balance || 0).toLocaleString('en-LK', { minimumFractionDigits: 2 })})</option>)}
                      </select>
                    </div>
                  )}
                  <div>
                    <label style={lbl}>Cheque No</label>
                    <input type="text" value={txForm.cheque_no} onChange={e => setTxForm(p => ({ ...p, cheque_no: e.target.value }))}
                      placeholder="Cheque number" style={inp} />
                  </div>
                  <div style={{ gridColumn: '1/-1' }}>
                    <label style={lbl}>{txForm.type === 'capital_in' ? 'Cheque Date (deposit by)' : 'Cheque Date (present on)'}</label>
                    <input type="date" value={txForm.cheque_date} onChange={e => setTxForm(p => ({ ...p, cheque_date: e.target.value }))} style={{ ...inp, borderColor: '#fde68a' }} />
                    {txForm.cheque_date && (
                      <div style={{ marginTop: '6px', padding: '8px 12px', background: '#fef3c7', borderRadius: '7px', fontSize: '12px', color: '#92400e' }}>
                        {txForm.type === 'capital_in'
                          ? `📥 Will appear in Bank → Unrealized Cheques In until deposited`
                          : `📤 Will appear in Bank → Unrealized Cheques Out until presented`}
                      </div>
                    )}
                  </div>
                </>
              )}

              {/* Bank transfer — always show account selector */}
              {txForm.payment_method === 'bank_transfer' && (
                <div style={{ gridColumn: '1/-1' }}>
                  <label style={lbl}>
                    {txForm.type === 'capital_in' ? 'Our Bank Account * (credited)' : 'Our Bank Account * (debited)'}
                  </label>
                  <select value={txForm.bank_account_id} onChange={e => setTxForm(p => ({ ...p, bank_account_id: e.target.value }))}
                    style={{ ...inp, borderColor: !txForm.bank_account_id ? '#fca5a5' : '#e2e8f0' }}>
                    <option value="">— Select account —</option>
                    {bankAccounts.map(b => (
                      <option key={b.id} value={b.id}>{b.name} — {b.bank_name} (LKR {(b.balance || 0).toLocaleString('en-LK', { minimumFractionDigits: 2 })})</option>
                    ))}
                  </select>
                </div>
              )}

              <div>
                <label style={lbl}>Reference</label>
                <input type="text" value={txForm.reference} onChange={e => setTxForm(p => ({ ...p, reference: e.target.value }))} placeholder="Transfer ref, slip no…" style={inp} />
              </div>
              <div>
                <label style={lbl}>Notes</label>
                <input type="text" value={txForm.notes} onChange={e => setTxForm(p => ({ ...p, notes: e.target.value }))} placeholder="Optional notes" style={inp} />
              </div>

              {txForm.type === 'return_paid' && selectedInvestor && (
                <div style={{ gridColumn: '1/-1', padding: '10px 14px', background: '#fef3c7', borderRadius: '10px', fontSize: '12px', color: '#92400e' }}>
                  💡 Expected return ({PERIODS[selectedInvestor.return_period]}): <strong>{formatCurrency(calcReturnDue(selectedInvestor))}</strong>
                  {selectedInvestor.return_type === 'profit_share' && ` (${selectedInvestor.return_value}% of ${formatCurrency(monthlyProfit)} profit)`}
                </div>
              )}
            </div>
            <div style={{ display: 'flex', gap: '10px', marginTop: '20px' }}>
              <button onClick={() => { setShowTxForm(false); resetTxForm() }}
                style={{ flex: 1, padding: '11px', background: '#f1f5f9', color: '#475569', border: 'none', borderRadius: '10px', cursor: 'pointer', fontWeight: '600' }}>Cancel</button>
              <button onClick={saveTx} disabled={saving}
                style={{ flex: 2, padding: '11px', background: saving ? '#93c5fd' : `linear-gradient(135deg,${TX_TYPES[txForm.type].color},${TX_TYPES[txForm.type].color})`, color: 'white', border: 'none', borderRadius: '10px', cursor: 'pointer', fontWeight: '700', fontSize: '14px' }}>
                {saving ? 'Saving...' : '✓ Record Transaction'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── LIST VIEW ── */}
      {view === 'list' && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '24px' }}>
            <div>
              <h1 style={{ fontSize: '22px', fontWeight: '700', color: '#0f172a', margin: '0 0 4px' }}>Investors</h1>
              <p style={{ color: '#64748b', fontSize: '14px', margin: 0 }}>Track investments, capital and returns</p>
            </div>
            <button onClick={() => { resetInvestorForm(); setEditingInvestor(null); setShowInvestorForm(true) }}
              style={{ padding: '10px 20px', background: 'linear-gradient(135deg,#2563eb,#1d4ed8)', color: 'white', border: 'none', borderRadius: '10px', cursor: 'pointer', fontWeight: '700', fontSize: '14px' }}>
              + Add Investor
            </button>
          </div>

          {/* Summary */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(180px,1fr))', gap: '16px', marginBottom: '24px' }}>
            {[
              { label: 'Total Investments Received', value: formatCurrency(totalCapitalReceived), sub: 'All capital in — all time', color: '#059669' },
              { label: 'Total Investors', value: investors.length, sub: `${activeInvestors.length} active`, color: '#1e40af' },
              { label: 'Returns Due This Period', value: formatCurrency(totalReturnDue), sub: 'across all active investors', color: '#e11d48' },
              { label: 'This Month\'s Profit', value: formatCurrency(monthlyProfit), sub: 'used for profit share calc', color: '#0891b2' },
            ].map(s => (
              <div key={s.label} style={{ background: 'white', borderRadius: '12px', padding: '18px', boxShadow: '0 1px 3px rgba(15,23,42,0.06), 0 1px 2px rgba(15,23,42,0.04)', borderLeft: `4px solid ${s.color}` }}>
                <div style={{ fontSize: '11px', fontWeight: '700', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '6px' }}>{s.label}</div>
                <div style={{ fontSize: '18px', fontWeight: '800', color: s.color }}>{s.value}</div>
                <div style={{ fontSize: '11px', color: '#94a3b8', marginTop: '3px' }}>{s.sub}</div>
              </div>
            ))}
          </div>

          {loading ? <div style={{ padding: '60px', textAlign: 'center', color: '#94a3b8' }}>Loading...</div>
          : investors.length === 0 ? (
            <div style={{ background: 'white', borderRadius: '12px', padding: '60px', textAlign: 'center', color: '#94a3b8', boxShadow: '0 1px 3px rgba(15,23,42,0.06), 0 1px 2px rgba(15,23,42,0.04)' }}>
              <div style={{ fontSize: '40px', marginBottom: '12px' }}>💼</div>
              <div style={{ fontSize: '16px', fontWeight: '600', marginBottom: '6px' }}>No investors yet</div>
              <div style={{ fontSize: '14px' }}>Add your first investor to start tracking</div>
            </div>
          ) : (
            <div style={{ display: 'grid', gap: '12px' }}>
              {investors.map(inv => {
                const returnDue = calcReturnDue(inv)
                return (
                  <div key={inv.id} onClick={() => openInvestor(inv)}
                    style={{ background: 'white', borderRadius: '12px', padding: '20px 24px', boxShadow: '0 1px 3px rgba(15,23,42,0.06), 0 1px 2px rgba(15,23,42,0.04)', border: '1px solid #f1f5f9', cursor: 'pointer', display: 'grid', gridTemplateColumns: '1fr auto', gap: '16px', alignItems: 'center', transition: 'box-shadow 0.15s' }}
                    onMouseEnter={e => e.currentTarget.style.boxShadow = '0 4px 16px rgba(0,0,0,0.1)'}
                    onMouseLeave={e => e.currentTarget.style.boxShadow = '0 1px 3px rgba(0,0,0,0.08)'}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                      <div style={{ width: '44px', height: '44px', borderRadius: '50%', background: inv.status === 'active' ? 'linear-gradient(135deg,#2563eb,#1d4ed8)' : '#e2e8f0', display: 'flex', alignItems: 'center', justifyContent: 'center', color: inv.status === 'active' ? 'white' : '#94a3b8', fontWeight: '800', fontSize: '18px', flexShrink: 0 }}>
                        {inv.name[0].toUpperCase()}
                      </div>
                      <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '3px' }}>
                          <span style={{ fontSize: '15px', fontWeight: '700', color: '#0f172a' }}>{inv.name}</span>
                          <span style={{ fontSize: '11px', fontWeight: '700', padding: '2px 8px', borderRadius: '12px', background: inv.status === 'active' ? '#dcfce7' : '#f1f5f9', color: inv.status === 'active' ? '#166534' : '#64748b' }}>
                            {inv.status}
                          </span>
                        </div>
                        <div style={{ fontSize: '12px', color: '#64748b' }}>
                          {inv.phone && <span style={{ marginRight: '12px' }}>📞 {inv.phone}</span>}
                          <span style={{ background: '#eef2ff', color: '#1e40af', padding: '1px 8px', borderRadius: '10px', fontWeight: '600' }}>
                            {RETURN_TYPES[inv.return_type]} · {inv.return_type === 'fixed' ? formatCurrency(inv.return_value) : `${inv.return_value}%`} {PERIODS[inv.return_period]}
                          </span>
                        </div>
                      </div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontSize: '11px', fontWeight: '700', color: '#94a3b8', textTransform: 'uppercase', marginBottom: '3px' }}>
                        Due This {PERIODS[inv.return_period]}
                      </div>
                      <div style={{ fontSize: '18px', fontWeight: '800', color: inv.status === 'active' ? '#e11d48' : '#94a3b8' }}>
                        {formatCurrency(returnDue)}
                      </div>
                      {inv.return_type === 'profit_share' && (
                        <div style={{ fontSize: '10px', color: '#94a3b8' }}>{inv.return_value}% of {formatCurrency(monthlyProfit)}</div>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* ── DETAIL VIEW ── */}
      {view === 'detail' && selectedInvestor && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '24px' }}>
            <div>
              <button onClick={() => { setView('list'); setSelectedInvestor(null); setLedger([]) }}
                style={{ background: 'none', border: 'none', color: '#2563eb', cursor: 'pointer', fontSize: '14px', fontWeight: '600', padding: 0, marginBottom: '6px', display: 'block' }}>
                ← Back to Investors
              </button>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <h1 style={{ fontSize: '22px', fontWeight: '700', color: '#0f172a', margin: 0 }}>{selectedInvestor.name}</h1>
                <span style={{ fontSize: '12px', fontWeight: '700', padding: '3px 10px', borderRadius: '12px', background: selectedInvestor.status === 'active' ? '#dcfce7' : '#f1f5f9', color: selectedInvestor.status === 'active' ? '#166534' : '#64748b' }}>
                  {selectedInvestor.status}
                </span>
              </div>
              {selectedInvestor.phone && <p style={{ color: '#64748b', fontSize: '13px', margin: '4px 0 0' }}>📞 {selectedInvestor.phone}{selectedInvestor.email ? ` · ✉ ${selectedInvestor.email}` : ''}</p>}
            </div>
            <div style={{ display: 'flex', gap: '10px' }}>
              <button onClick={() => { setInvestorForm({ ...selectedInvestor, return_value: String(selectedInvestor.return_value) }); setEditingInvestor(selectedInvestor); setShowInvestorForm(true) }}
                style={{ padding: '9px 18px', background: 'white', color: '#475569', border: '1.5px solid #e2e8f0', borderRadius: '10px', cursor: 'pointer', fontWeight: '600', fontSize: '14px' }}>
                ✏️ Edit
              </button>
              <button onClick={() => { resetTxForm(); setShowTxForm(true) }}
                style={{ padding: '9px 18px', background: 'linear-gradient(135deg,#2563eb,#1d4ed8)', color: 'white', border: 'none', borderRadius: '10px', cursor: 'pointer', fontWeight: '700', fontSize: '14px' }}>
                + Record Transaction
              </button>
            </div>
          </div>

          {/* Summary cards */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(160px,1fr))', gap: '14px', marginBottom: '20px' }}>
            {[
              { label: 'Total Capital In', value: formatCurrency(detailTotals.capitalIn), color: '#059669' },
              { label: 'Total Returns Paid', value: formatCurrency(detailTotals.returnsPaid), color: '#e11d48' },
              { label: 'Withdrawals', value: formatCurrency(detailTotals.withdrawals), color: '#d97706' },
              { label: 'Net Balance Held', value: formatCurrency(netBalance), color: '#1e40af' },
              { label: `Return Due (${PERIODS[selectedInvestor.return_period]})`, value: formatCurrency(calcReturnDue(selectedInvestor)), color: '#e11d48', sub: selectedInvestor.return_type === 'profit_share' ? `${selectedInvestor.return_value}% of profit` : 'Fixed' },
            ].map(s => (
              <div key={s.label} style={{ background: 'white', borderRadius: '12px', padding: '16px', boxShadow: '0 1px 3px rgba(15,23,42,0.06), 0 1px 2px rgba(15,23,42,0.04)', borderTop: `3px solid ${s.color}` }}>
                <div style={{ fontSize: '11px', fontWeight: '700', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '5px' }}>{s.label}</div>
                <div style={{ fontSize: '17px', fontWeight: '800', color: s.color }}>{s.value}</div>
                {s.sub && <div style={{ fontSize: '10px', color: '#94a3b8', marginTop: '2px' }}>{s.sub}</div>}
              </div>
            ))}
          </div>

          {/* Agreement info */}
          <div style={{ ...card, display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(160px,1fr))', gap: '12px' }}>
            {[
              { label: 'Return Type', value: RETURN_TYPES[selectedInvestor.return_type] },
              { label: 'Return Value', value: selectedInvestor.return_type === 'fixed' ? formatCurrency(selectedInvestor.return_value) : `${selectedInvestor.return_value}%` },
              { label: 'Period', value: PERIODS[selectedInvestor.return_period] },
              ...(selectedInvestor.address ? [{ label: 'Address', value: selectedInvestor.address }] : []),
            ].map(s => (
              <div key={s.label}>
                <div style={{ fontSize: '11px', fontWeight: '700', color: '#94a3b8', textTransform: 'uppercase', marginBottom: '4px' }}>{s.label}</div>
                <div style={{ fontSize: '13px', fontWeight: '600', color: '#0f172a' }}>{s.value}</div>
              </div>
            ))}
            {selectedInvestor.notes && (
              <div style={{ gridColumn: '1/-1' }}>
                <div style={{ fontSize: '11px', fontWeight: '700', color: '#94a3b8', textTransform: 'uppercase', marginBottom: '4px' }}>Notes</div>
                <div style={{ fontSize: '13px', color: '#64748b' }}>{selectedInvestor.notes}</div>
              </div>
            )}
          </div>

          {/* Ledger */}
          <div style={{ background: 'white', borderRadius: '12px', boxShadow: '0 1px 3px rgba(15,23,42,0.06), 0 1px 2px rgba(15,23,42,0.04)', overflow: 'hidden' }}>
            <div style={{ padding: '16px 20px', borderBottom: '1px solid #f1f5f9', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h2 style={{ fontSize: '15px', fontWeight: '700', color: '#0f172a', margin: 0 }}>Transaction Ledger</h2>
              <span style={{ fontSize: '13px', color: '#94a3b8' }}>{ledger.length} records</span>
            </div>
            {ledgerLoading ? <div style={{ padding: '40px', textAlign: 'center', color: '#94a3b8' }}>Loading...</div>
            : ledger.length === 0 ? (
              <div style={{ padding: '48px', textAlign: 'center', color: '#94a3b8' }}>
                <div style={{ fontSize: '32px', marginBottom: '10px' }}>📒</div>
                No transactions yet. Record the first capital injection to get started.
              </div>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ background: '#f8fafc', borderBottom: '2px solid #e2e8f0' }}>
                    {['Date', 'Type', 'Payment', 'Reference / Cheque', 'Notes', 'Amount', ''].map(h => (
                      <th key={h} style={{ padding: '10px 14px', textAlign: 'left', fontSize: '11px', fontWeight: '700', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {ledger.map((tx, i) => {
                    const txMeta = TX_TYPES[tx.type] || TX_TYPES.capital_in
                    const isIn = tx.type === 'capital_in'
                    const pmLabels = { cash: '💵 Cash', cheque: '🧾 Cheque', bank_transfer: '🏦 Bank Transfer' }
                    return (
                      <tr key={tx.id} style={{ borderBottom: '1px solid #f1f5f9', background: i % 2 === 0 ? 'white' : '#fafafa' }}>
                        <td style={{ padding: '12px 14px', fontSize: '13px', color: '#64748b', whiteSpace: 'nowrap' }}>
                          {new Date(tx.date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}
                        </td>
                        <td style={{ padding: '12px 14px' }}>
                          <span style={{ background: txMeta.bg, color: txMeta.color, padding: '3px 10px', borderRadius: '12px', fontSize: '12px', fontWeight: '700' }}>
                            {txMeta.icon} {txMeta.label}
                          </span>
                        </td>
                        <td style={{ padding: '12px 14px', fontSize: '12px', color: '#64748b' }}>
                          {pmLabels[tx.payment_method] || tx.payment_method || '—'}
                        </td>
                        <td style={{ padding: '12px 14px', fontSize: '12px', color: '#64748b' }}>
                          {tx.payment_method === 'cheque' ? (
                            <div>
                              {tx.cheque_no && <div style={{ fontFamily: 'monospace', fontWeight: '600', color: '#0f172a' }}>#{tx.cheque_no}</div>}
                              {tx.cheque_bank_name && <div style={{ color: '#94a3b8' }}>{tx.cheque_bank_name}</div>}
                              {tx.cheque_date && <div style={{ color: '#d97706', fontWeight: '600' }}>Due: {new Date(tx.cheque_date).toLocaleDateString('en-GB')}</div>}
                            </div>
                          ) : (
                            <span style={{ fontFamily: 'monospace' }}>{tx.reference || '—'}</span>
                          )}
                        </td>
                        <td style={{ padding: '12px 14px', fontSize: '13px', color: '#64748b', maxWidth: '160px' }}>
                          <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{tx.notes || '—'}</div>
                        </td>
                        <td style={{ padding: '12px 14px', fontSize: '15px', fontWeight: '800', color: isIn ? '#059669' : '#e11d48', whiteSpace: 'nowrap' }}>
                          {isIn ? '+' : '-'} {formatCurrency(tx.amount)}
                        </td>
                        <td style={{ padding: '12px 14px' }}>
                          <button onClick={() => deleteTx(tx.id)}
                            style={{ width: '28px', height: '28px', background: '#fee2e2', color: '#dc2626', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '13px' }}>✕</button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
                {/* Running balance row */}
                <tfoot>
                  <tr style={{ background: '#f8fafc', borderTop: '2px solid #e2e8f0' }}>
                    <td colSpan={5} style={{ padding: '12px 14px', fontSize: '13px', fontWeight: '700', color: '#0f172a' }}>Net Capital Held (Capital In − Withdrawals)</td>
                    <td style={{ padding: '12px 14px', fontSize: '16px', fontWeight: '800', color: netBalance >= 0 ? '#1e40af' : '#e11d48' }}>{formatCurrency(netBalance)}</td>
                    <td></td>
                  </tr>
                </tfoot>
              </table>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
