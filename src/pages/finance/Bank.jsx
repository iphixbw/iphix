import { useState, useEffect } from 'react'
import { supabase } from '../../supabase'
import { formatCurrency } from '../../lib/helpers'
import toast from 'react-hot-toast'

export default function Bank({ activeShop, isSuperAdmin }) {
  const [accounts, setAccounts] = useState([])
  const [transactions, setTransactions] = useState([])
  const [chequesDue, setChequesDue] = useState([])
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState('accounts')
  const [showAccountForm, setShowAccountForm] = useState(false)
  const [showTxForm, setShowTxForm] = useState(false)
  const [editAccount, setEditAccount] = useState(null)
  const [saving, setSaving] = useState(false)
  const [accountForm, setAccountForm] = useState({ name: '', bank_name: '', account_no: '', balance: '' })
  const [txForm, setTxForm] = useState({ bank_account_id: '', type: 'deposit', amount: '', reference: '', cheque_no: '', cheque_date: '', notes: '' })

  const [realizingCheque, setRealizingCheque] = useState(null)
  const [realizeAccountId, setRealizeAccountId] = useState('')
  const [chequeSubTab, setChequeSubTab] = useState('active') // 'active' | 'returned'
  const [chequesReturned, setChequesReturned] = useState([])
  const [chequeSearch, setChequeSearch] = useState('')

  useEffect(() => { fetchData() }, [])

  async function presentCheque(tx, targetAccountId) {
    const isIn = tx.type === 'cheque_in'
    // cheque_in: must select which bank account to deposit into
    if (isIn && !targetAccountId) {
      setRealizingCheque(tx)
      setRealizeAccountId(tx.bank_account_id || '')
      return
    }
    const accountId = isIn ? targetAccountId : tx.bank_account_id
    const account = accounts.find(a => a.id === accountId)
    const newBalance = (account?.balance || 0) + (isIn ? tx.amount : -tx.amount)
    setSaving(true)
    try {
      await supabase.from('bank_transactions').update({
        cheque_status: 'presented',
        bank_account_id: accountId,
      }).eq('id', tx.id)
      await supabase.from('bank_accounts').update({ balance: newBalance }).eq('id', accountId)
      toast.success(`Cheque realized — ${isIn ? '+' : '-'}${formatCurrency(tx.amount)} ${isIn ? 'credited to' : 'debited from'} ${account?.name}`)
      setRealizingCheque(null)
      setRealizeAccountId('')
      fetchData()
    } catch (e) { toast.error('Failed: ' + e.message) }
    setSaving(false)
  }

  async function returnCheque(tx) {
    const label = tx.type === 'cheque_in' ? 'received from customer' : 'issued to supplier'
    if (!window.confirm(`Mark this cheque as returned/bounced?\n\nAmount: LKR ${tx.amount?.toLocaleString('en-LK', { minimumFractionDigits: 2 })}\nReference: ${tx.reference || '—'}\n\nThis will reverse the balance adjustment made when this cheque was recorded.`)) return
    setSaving(true)
    try {
      // 1. Mark as presented with [RETURNED] note — keeps history, removes from active list
      const returnedNote = ((tx.notes || '') + ' [RETURNED]').trim()
      await supabase.from('bank_transactions').update({
        cheque_status: 'presented',
        notes: returnedNote,
      }).eq('id', tx.id)
      // Move from active to returned list immediately
      const returnedTx = { ...tx, cheque_status: 'presented', notes: returnedNote, returned_at: new Date().toISOString() }
      setChequesDue(prev => prev.filter(c => c.id !== tx.id))
      setChequesReturned(prev => [returnedTx, ...prev])

      // 2. Reverse the balance — use the direct link when available (reliable),
      // falling back to parsing the reference text for older/unlinked rows.
      const ref = tx.reference || ''
      if (tx.type === 'cheque_in') {
        // cheque_in = customer paid us → cheque bounced → add back customer balance
        if (tx.invoice_payment_id) {
          // Linked to a specific invoice payment — sync that side too, so
          // InvoiceView's payment history and balance-due reflect the return.
          await supabase.from('invoice_payments').update({
            cheque_status: 'returned',
            returned_at: new Date().toISOString(),
            notes: returnedNote,
          }).eq('id', tx.invoice_payment_id)
          const { data: ip } = await supabase.from('invoice_payments').select('invoice_id, invoices(customer_id)').eq('id', tx.invoice_payment_id).single()
          const custId = ip?.invoices?.customer_id
          if (custId) {
            await supabase.rpc('adjust_customer_balance', { p_customer_id: custId, p_delta: tx.amount })
            toast.success(`Cheque returned — LKR ${tx.amount?.toLocaleString('en-LK', { minimumFractionDigits: 2 })} added back to customer balance`)
          } else {
            toast.success('Cheque marked as returned.')
          }
        } else {
          const custMatch = ref.match(/Customer:\s*(.+)/i)
          if (custMatch) {
            const custName = custMatch[1].trim()
            const { data: custs } = await supabase.from('customers').select('id, credit_balance').ilike('name', custName)
            if (custs?.length) {
              await supabase.from('customers').update({
                credit_balance: (custs[0].credit_balance || 0) + tx.amount
              }).eq('id', custs[0].id)
              toast.success(`Cheque returned — LKR ${tx.amount?.toLocaleString('en-LK', { minimumFractionDigits: 2 })} added back to ${custName}'s balance`)
            } else {
              toast.success('Cheque marked as returned. Could not find customer to reverse balance — adjust manually if needed.')
            }
          } else {
            toast.success('Cheque marked as returned.')
          }
        }
      } else {
        // cheque_out = we paid supplier → cheque returned → add back supplier outstanding
        if (tx.repair_supplier_payment_id) {
          // Repair division supplier cheque — reverse every repair_purchases row this
          // payment was FIFO-allocated to (a cheque can settle several purchases), and
          // the supplier's aggregate balance. Mirrors the ERP retail branch below exactly.
          const { data: allocations } = await supabase
            .from('repair_supplier_payment_allocations').select('purchase_id, amount').eq('payment_id', tx.repair_supplier_payment_id)
          for (const alloc of (allocations || [])) {
            const { data: purchase } = await supabase.from('repair_purchases').select('amount_paid, credit_amount, total').eq('id', alloc.purchase_id).single()
            if (purchase) {
              const newPaid = Math.max(0, (purchase.amount_paid || 0) - alloc.amount)
              await supabase.from('repair_purchases').update({
                amount_paid: newPaid,
                credit_amount: Math.max(0, (purchase.total || 0) - newPaid),
              }).eq('id', alloc.purchase_id)
            }
          }
          await supabase.from('repair_supplier_standalone_payments').update({
            cheque_status: 'returned', status: 'returned', returned_at: new Date().toISOString(),
          }).eq('id', tx.repair_supplier_payment_id)
          const { data: pay } = await supabase.from('repair_supplier_standalone_payments').select('supplier_id').eq('id', tx.repair_supplier_payment_id).single()
          if (pay?.supplier_id) {
            await supabase.rpc('repair_adjust_supplier_balance', { p_supplier_id: pay.supplier_id, p_delta: tx.amount })
            toast.success(`Cheque returned — LKR ${tx.amount?.toLocaleString('en-LK', { minimumFractionDigits: 2 })} added back to repair supplier's outstanding balance`)
          } else {
            toast.success('Cheque marked as returned.')
          }
        } else if (tx.purchase_payment_id) {
          // Linked to a specific purchase payment — sync that side too, so
          // Suppliers.jsx's Purchases/Payments/Activity Statement reflect the return.
          // A cheque split across multiple purchases via FIFO shares one
          // bank_transaction_id across several purchase_payments rows — mark all of them.
          const { data: siblingPayments } = await supabase
            .from('purchase_payments').select('id, purchase_id').eq('bank_transaction_id', tx.id)
          const linkedIds = (siblingPayments?.length ? siblingPayments : [{ id: tx.purchase_payment_id }]).map(p => p.id)
          await supabase.from('purchase_payments').update({
            cheque_status: 'returned',
            returned_at: new Date().toISOString(),
            notes: returnedNote,
          }).in('id', linkedIds)
          const { data: pp } = await supabase.from('purchase_payments').select('purchase_id, purchases(supplier_id)').eq('id', tx.purchase_payment_id).single()
          const supId = pp?.purchases?.supplier_id
          if (supId) {
            await supabase.rpc('adjust_supplier_balance', { p_supplier_id: supId, p_delta: tx.amount })
            toast.success(`Cheque returned — LKR ${tx.amount?.toLocaleString('en-LK', { minimumFractionDigits: 2 })} added back to supplier's outstanding balance`)
          } else {
            toast.success('Cheque marked as returned.')
          }
        } else {
          // Repair division 3rd-party item settlement — items are linked to this
          // transaction directly (a batch settlement can cover several items with
          // one cheque), so put every one of them back to pending.
          const { data: tpItems } = await supabase
            .from('repair_third_party_items').select('id').eq('bank_transaction_id', tx.id)
          if (tpItems?.length) {
            await supabase.from('repair_third_party_items').update({
              payment_status: 'pending', paid_at: null,
            }).eq('bank_transaction_id', tx.id)
            toast.success(`Cheque returned — ${tpItems.length} 3rd-party item${tpItems.length > 1 ? 's' : ''} marked pending again`)
          } else {
            const supMatch = ref.match(/Supplier:\s*(.+)/i)
            if (supMatch) {
              const supName = supMatch[1].trim()
              const { data: sups } = await supabase.from('suppliers').select('id, outstanding_balance').ilike('name', supName)
              if (sups?.length) {
                await supabase.from('suppliers').update({
                  outstanding_balance: (sups[0].outstanding_balance || 0) + tx.amount
                }).eq('id', sups[0].id)
                toast.success(`Cheque returned — LKR ${tx.amount?.toLocaleString('en-LK', { minimumFractionDigits: 2 })} added back to ${supName}'s outstanding balance`)
              } else {
                toast.success('Cheque marked as returned. Could not find supplier to reverse balance — adjust manually if needed.')
              }
            } else {
              toast.success('Cheque marked as returned.')
            }
          }
        }
      }
      fetchData()
    } catch (e) { toast.error('Failed: ' + e.message) }
    setSaving(false)
  }

  async function fetchData() {
    setLoading(true)
    const nextWeek = new Date()
    nextWeek.setDate(nextWeek.getDate() + 7)

    const [{ data: accs }, { data: txs }, { data: cheques }, { data: returned }] = await Promise.all([
      supabase.from('bank_accounts').select('*').order('name'),
      supabase.from('bank_transactions').select('*, bank_accounts(name, bank_name)')
        .not('bank_account_id', 'is', null)  // exclude cash-only transactions (no bank account)
        .not('type', 'eq', 'cash_adjustment') // exclude cash adjustments
        .or('cheque_status.is.null,cheque_status.eq.presented') // only realized or non-cheque
        .order('created_at', { ascending: false }).limit(100),
      supabase.from('bank_transactions')
        .select('*, bank_accounts(name)')
        .in('type', ['cheque_in', 'cheque_out'])
        .in('cheque_status', ['pending'])
        .order('cheque_date'),
      supabase.from('bank_transactions')
        .select('*, bank_accounts(name)')
        .in('type', ['cheque_in', 'cheque_out'])
        .eq('cheque_status', 'presented')
        .ilike('notes', '%[RETURNED]%')
        .order('created_at', { ascending: false })
        .limit(100),
    ])
    setAccounts(accs || [])
    setTransactions(txs || [])
    setChequesDue(cheques || [])
    setChequesReturned(returned || [])
    setLoading(false)
  }

  async function saveAccount() {
    if (!accountForm.name.trim()) return toast.error('Account name is required')
    setSaving(true)
    try {
      if (editAccount) {
        const { error } = await supabase.from('bank_accounts').update({
          name: accountForm.name, bank_name: accountForm.bank_name, account_no: accountForm.account_no,
        }).eq('id', editAccount.id)
        if (error) throw error
        toast.success('Account updated!')
      } else {
        const { error } = await supabase.from('bank_accounts').insert({
          name: accountForm.name, bank_name: accountForm.bank_name,
          account_no: accountForm.account_no,
          balance: parseFloat(accountForm.balance) || 0,
          shop_id: activeShop?.id,
        })
        if (error) throw error
        toast.success('Bank account added!')
      }
      setShowAccountForm(false)
      setEditAccount(null)
      setAccountForm({ name: '', bank_name: '', account_no: '', balance: '' })
      fetchData()
    } catch (e) { toast.error('Failed: ' + e.message) }
    setSaving(false)
  }

  async function saveTransaction() {
    if (!txForm.bank_account_id) return toast.error('Select a bank account')
    if (!txForm.amount || parseFloat(txForm.amount) <= 0) return toast.error('Enter a valid amount')
    if ((txForm.type === 'cheque_in' || txForm.type === 'cheque_out') && !txForm.cheque_date) return toast.error('Enter cheque date')
    setSaving(true)
    try {
      const amount = parseFloat(txForm.amount)
      const account = accounts.find(a => a.id === txForm.bank_account_id)
      const isIn = txForm.type === 'deposit' || txForm.type === 'cheque_in'
      const newBalance = (account?.balance || 0) + (isIn ? amount : -amount)

      const { error: txErr } = await supabase.from('bank_transactions').insert({
        bank_account_id: txForm.bank_account_id,
        type: txForm.type,
        amount,
        reference: txForm.reference,
        cheque_no: txForm.cheque_no,
        cheque_date: txForm.cheque_date || null,
        cheque_status: txForm.type.includes('cheque') ? 'pending' : null,
        notes: txForm.notes,
        shop_id: activeShop?.id,
      })
      if (txErr) throw txErr

      // Update balance only for non-cheque transactions
      if (!txForm.type.includes('cheque')) {
        await supabase.from('bank_accounts').update({ balance: newBalance }).eq('id', txForm.bank_account_id)
      }

      // Cashflow impact:
      // deposit (cash→bank): record in cash_deposits so cashflow deducts from cash in hand
      // withdrawal (bank→cash): cashflow reads bank_transactions type=withdrawal directly — no expenses record needed
      if (txForm.type === 'deposit') {
        await supabase.from('cash_deposits').insert({
          amount, shop_id: activeShop?.id,
          notes: txForm.reference || txForm.notes || 'Cash deposited to bank',
        })
      }
      // withdrawal: already captured in bank_transactions above — cashflow adds it to cash in hand automatically

      toast.success('Transaction recorded!')
      setShowTxForm(false)
      setTxForm({ bank_account_id: '', type: 'deposit', amount: '', reference: '', cheque_no: '', cheque_date: '', notes: '' })
      fetchData()
    } catch (e) { toast.error('Failed: ' + e.message) }
    setSaving(false)
  }

  async function deleteAccount(acc) {
    if ((acc.balance || 0) !== 0) {
      toast.error(`Cannot delete "${acc.name}": balance must be LKR 0.00. Current balance: ${formatCurrency(acc.balance)}`)
      return
    }
    if (!window.confirm(`Delete bank account "${acc.name} — ${acc.bank_name}"? All transaction history will also be removed. This cannot be undone.`)) return
    try {
      // Delete all transactions linked to this account
      await supabase.from('bank_transactions').delete().eq('bank_account_id', acc.id)
      // Delete the account
      const { error } = await supabase.from('bank_accounts').delete().eq('id', acc.id)
      if (error) throw error
      toast.success(`Bank account "${acc.name}" deleted`)
      fetchData()
    } catch (e) {
      toast.error('Failed to delete: ' + e.message)
    }
  }

  const totalBalance = accounts.reduce((s, a) => s + (a.balance || 0), 0)
  const inp = { width: '100%', padding: '9px 12px', border: '1.5px solid #e2e8f0', borderRadius: '7px', fontSize: '14px', boxSizing: 'border-box', outline: 'none', background: 'white' }
  const lbl = { display: 'block', marginBottom: '5px', fontSize: '11px', fontWeight: '700', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.06em' }
  const card = { background: 'white', borderRadius: '12px', padding: '24px', boxShadow: '0 1px 3px rgba(15,23,42,0.06), 0 1px 2px rgba(15,23,42,0.04)', marginBottom: '16px', border: '1px solid #f1f5f9' }

  const txTypeLabels = { deposit: 'Deposit', withdrawal: 'Withdrawal', cheque_in: 'Cheque In', cheque_out: 'Cheque Out', payment_out: 'Payment Out' }
  const txTypeColors = { deposit: '#059669', withdrawal: '#e11d48', cheque_in: '#2563eb', cheque_out: '#d97706', payment_out: '#e11d48' }

  return (
    <div>
      {/* Cheque Realization Modal */}
      {realizingCheque && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ background: 'white', borderRadius: '16px', padding: '28px', width: '440px', boxShadow: '0 20px 60px rgba(0,0,0,0.3)' }}>
            <h2 style={{ fontSize: '17px', fontWeight: '800', color: '#0f172a', margin: '0 0 6px' }}>Realize Cheque In</h2>
            <p style={{ fontSize: '13px', color: '#64748b', margin: '0 0 20px' }}>
              Select the bank account where this cheque has been deposited.
            </p>
            {/* Cheque details */}
            <div style={{ background: '#f0f9ff', borderRadius: '10px', padding: '12px 14px', marginBottom: '20px', fontSize: '13px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                <span style={{ color: '#64748b' }}>Amount</span>
                <span style={{ fontWeight: '800', color: '#059669', fontSize: '15px' }}>{formatCurrency(realizingCheque.amount)}</span>
              </div>
              {realizingCheque.reference && <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}><span style={{ color: '#64748b' }}>Reference</span><span style={{ fontWeight: '600', color: '#0f172a' }}>{realizingCheque.reference}</span></div>}
              {realizingCheque.cheque_no && <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}><span style={{ color: '#64748b' }}>Cheque No</span><span style={{ fontWeight: '600', color: '#0f172a' }}>{realizingCheque.cheque_no}</span></div>}
              {realizingCheque.notes && <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: '#64748b' }}>Notes</span><span style={{ color: '#64748b' }}>{realizingCheque.notes}</span></div>}
            </div>
            {/* Bank account selector */}
            <div style={{ marginBottom: '20px' }}>
              <label style={lbl}>Deposit to Bank Account *</label>
              <select value={realizeAccountId} onChange={e => setRealizeAccountId(e.target.value)}
                style={{ ...inp, borderColor: !realizeAccountId ? '#fca5a5' : '#2563eb', color: realizeAccountId ? '#0f172a' : '#94a3b8' }}>
                <option value="">— Select bank account —</option>
                {accounts.map(a => (
                  <option key={a.id} value={a.id}>{a.name} — {a.bank_name} (LKR {(a.balance || 0).toLocaleString('en-LK', { minimumFractionDigits: 2 })})</option>
                ))}
              </select>
              {realizeAccountId && (
                <div style={{ marginTop: '6px', fontSize: '12px', color: '#059669', fontWeight: '600' }}>
                  ✓ LKR {(realizingCheque.amount || 0).toLocaleString('en-LK', { minimumFractionDigits: 2 })} will be added to {accounts.find(a => a.id === realizeAccountId)?.name}
                </div>
              )}
            </div>
            <div style={{ display: 'flex', gap: '10px' }}>
              <button onClick={() => { setRealizingCheque(null); setRealizeAccountId('') }}
                style={{ flex: 1, padding: '11px', background: '#f1f5f9', color: '#475569', border: 'none', borderRadius: '10px', cursor: 'pointer', fontWeight: '600' }}>
                Cancel
              </button>
              <button onClick={() => presentCheque(realizingCheque, realizeAccountId)} disabled={!realizeAccountId || saving}
                style={{ flex: 2, padding: '11px', background: !realizeAccountId ? '#e2e8f0' : 'linear-gradient(135deg,#059669,#047857)', color: !realizeAccountId ? '#94a3b8' : 'white', border: 'none', borderRadius: '10px', cursor: !realizeAccountId ? 'not-allowed' : 'pointer', fontWeight: '700', fontSize: '14px' }}>
                {saving ? 'Processing…' : '✓ Confirm Realization'}
              </button>
            </div>
          </div>
        </div>
      )}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '24px' }}>
        <div>
          <h1 style={{ fontSize: '22px', fontWeight: '700', color: '#0f172a', margin: '0 0 4px' }}>Bank</h1>
          <p style={{ color: '#64748b', fontSize: '14px', margin: 0 }}>Manage bank accounts, transactions and cheques</p>
        </div>
        <div style={{ display: 'flex', gap: '10px' }}>
          <button onClick={() => { setShowTxForm(!showTxForm); setShowAccountForm(false) }}
            style={{ padding: '10px 18px', background: 'white', color: '#2563eb', border: '1.5px solid #2563eb', borderRadius: '10px', cursor: 'pointer', fontWeight: '700', fontSize: '14px' }}>
            + Transaction
          </button>
          <button onClick={() => { setShowAccountForm(!showAccountForm); setShowTxForm(false); setEditAccount(null); setAccountForm({ name: '', bank_name: '', account_no: '', balance: '' }) }}
            style={{ padding: '10px 18px', background: 'linear-gradient(135deg,#2563eb,#1d4ed8)', color: 'white', border: 'none', borderRadius: '10px', cursor: 'pointer', fontWeight: '700', fontSize: '14px' }}>
            + Bank Account
          </button>
        </div>
      </div>

      {/* Total balance */}
      <div style={{ background: 'linear-gradient(135deg,#0b1220,#1e3a8a)', borderRadius: '14px', padding: '24px', marginBottom: '20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <div style={{ fontSize: '12px', fontWeight: '700', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '6px' }}>Total Bank Balance</div>
          <div style={{ fontSize: '36px', fontWeight: '800', color: 'white' }}>{formatCurrency(totalBalance)}</div>
          <div style={{ fontSize: '13px', color: '#94a3b8', marginTop: '4px' }}>{accounts.length} account{accounts.length !== 1 ? 's' : ''}</div>
        </div>
        {chequesDue.length > 0 && (
          <div style={{ background: 'rgba(239,68,68,0.15)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: '10px', padding: '14px 18px', textAlign: 'center' }}>
            <div style={{ fontSize: '24px', fontWeight: '800', color: '#f87171' }}>
              {chequesDue.filter(c => {
                const d = new Date(c.cheque_date); const today = new Date(); today.setHours(0,0,0,0)
                const weekAhead = new Date(today); weekAhead.setDate(today.getDate() + 7)
                return d >= today && d <= weekAhead
              }).length}
            </div>
            <div style={{ fontSize: '12px', color: '#fca5a5', fontWeight: '600' }}>Cheque{chequesDue.length !== 1 ? 's' : ''} due<br />this week</div>
          </div>
        )}
      </div>

      {/* Account form */}
      {showAccountForm && (
        <div style={card}>
          <h3 style={{ margin: '0 0 16px', fontSize: '15px', fontWeight: '700', color: '#0f172a' }}>{editAccount ? 'Edit Account' : 'New Bank Account'}</h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: '14px', marginBottom: '16px' }}>
            <div><label style={lbl}>Account Name *</label><input type="text" value={accountForm.name} onChange={e => setAccountForm(p => ({ ...p, name: e.target.value }))} placeholder="e.g. Main Account" style={inp} /></div>
            <div><label style={lbl}>Bank Name</label><input type="text" value={accountForm.bank_name} onChange={e => setAccountForm(p => ({ ...p, bank_name: e.target.value }))} placeholder="e.g. Commercial Bank" style={inp} /></div>
            <div><label style={lbl}>Account No</label><input type="text" value={accountForm.account_no} onChange={e => setAccountForm(p => ({ ...p, account_no: e.target.value }))} placeholder="Account number" style={inp} /></div>
            {!editAccount && <div><label style={lbl}>Opening Balance</label><input type="number" value={accountForm.balance} onChange={e => setAccountForm(p => ({ ...p, balance: e.target.value }))} placeholder="0.00" style={inp} /></div>}
          </div>
          <div style={{ display: 'flex', gap: '10px' }}>
            <button onClick={saveAccount} disabled={saving} style={{ padding: '10px 24px', background: 'linear-gradient(135deg,#2563eb,#1d4ed8)', color: 'white', border: 'none', borderRadius: '10px', cursor: 'pointer', fontWeight: '700', fontSize: '14px' }}>{saving ? 'Saving...' : editAccount ? 'Update' : 'Add Account'}</button>
            <button onClick={() => setShowAccountForm(false)} style={{ padding: '10px 20px', background: '#f1f5f9', color: '#64748b', border: 'none', borderRadius: '10px', cursor: 'pointer', fontWeight: '600', fontSize: '14px' }}>Cancel</button>
          </div>
        </div>
      )}

      {/* Transaction form */}
      {showTxForm && (
        <div style={card}>
          <h3 style={{ margin: '0 0 16px', fontSize: '15px', fontWeight: '700', color: '#0f172a' }}>New Transaction</h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '14px', marginBottom: '14px' }}>
            <div><label style={lbl}>Bank Account *</label>
              <select value={txForm.bank_account_id} onChange={e => setTxForm(p => ({ ...p, bank_account_id: e.target.value }))} style={inp}>
                <option value="">Select account</option>
                {accounts.map(a => <option key={a.id} value={a.id}>{a.name} — {formatCurrency(a.balance)}</option>)}
              </select>
            </div>
            <div><label style={lbl}>Type *</label>
              <select value={txForm.type} onChange={e => setTxForm(p => ({ ...p, type: e.target.value }))} style={inp}>
                <option value="deposit">Deposit</option>
                <option value="withdrawal">Withdrawal</option>
                <option value="cheque_in">Cheque In (Received)</option>
                <option value="cheque_out">Cheque Out (Issued)</option>
              </select>
            </div>
            <div><label style={lbl}>Amount (LKR) *</label><input type="number" value={txForm.amount} onChange={e => setTxForm(p => ({ ...p, amount: e.target.value }))} placeholder="0.00" style={inp} /></div>
            <div><label style={lbl}>Reference</label><input type="text" value={txForm.reference} onChange={e => setTxForm(p => ({ ...p, reference: e.target.value }))} placeholder="Reference no." style={inp} /></div>
            {txForm.type.includes('cheque') && <>
              <div><label style={lbl}>Cheque No</label><input type="text" value={txForm.cheque_no} onChange={e => setTxForm(p => ({ ...p, cheque_no: e.target.value }))} placeholder="Cheque number" style={inp} /></div>
              <div><label style={lbl}>Cheque Date *</label><input type="date" value={txForm.cheque_date} onChange={e => setTxForm(p => ({ ...p, cheque_date: e.target.value }))} style={inp} /></div>
            </>}
            <div style={{ gridColumn: txForm.type.includes('cheque') ? '1/-1' : 'auto' }}><label style={lbl}>Notes</label><input type="text" value={txForm.notes} onChange={e => setTxForm(p => ({ ...p, notes: e.target.value }))} placeholder="Optional notes" style={inp} /></div>
          </div>
          <div style={{ display: 'flex', gap: '10px' }}>
            <button onClick={saveTransaction} disabled={saving} style={{ padding: '10px 24px', background: 'linear-gradient(135deg,#2563eb,#1d4ed8)', color: 'white', border: 'none', borderRadius: '10px', cursor: 'pointer', fontWeight: '700', fontSize: '14px' }}>{saving ? 'Saving...' : 'Record Transaction'}</button>
            <button onClick={() => setShowTxForm(false)} style={{ padding: '10px 20px', background: '#f1f5f9', color: '#64748b', border: 'none', borderRadius: '10px', cursor: 'pointer', fontWeight: '600', fontSize: '14px' }}>Cancel</button>
          </div>
        </div>
      )}

      {/* Tabs */}
      <div style={{ display: 'flex', gap: '4px', marginBottom: '16px', background: '#f1f5f9', padding: '4px', borderRadius: '10px', width: 'fit-content' }}>
        {[{ id: 'accounts', label: '🏦 Accounts' }, { id: 'transactions', label: '📋 Transactions' }, { id: 'cheques', label: `🗒 Cheques Due (${chequesDue.length})` }].map(tab => (
          <button key={tab.id} onClick={() => setActiveTab(tab.id)}
            style={{ padding: '8px 16px', borderRadius: '10px', border: 'none', cursor: 'pointer', fontSize: '13px', fontWeight: '600', background: activeTab === tab.id ? 'white' : 'transparent', color: activeTab === tab.id ? '#0f172a' : '#64748b', boxShadow: activeTab === tab.id ? '0 1px 3px rgba(0,0,0,0.1)' : 'none' }}>
            {tab.label}
          </button>
        ))}
      </div>

      {/* Accounts tab */}
      {activeTab === 'accounts' && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px,1fr))', gap: '16px' }}>
          {accounts.length === 0 ? (
            <div style={{ padding: '40px', textAlign: 'center', color: '#94a3b8', gridColumn: '1/-1' }}>No bank accounts yet. Add one above.</div>
          ) : accounts.map(acc => (
            <div key={acc.id} style={{ background: 'white', borderRadius: '12px', padding: '20px', boxShadow: '0 1px 3px rgba(15,23,42,0.06), 0 1px 2px rgba(15,23,42,0.04)', border: '1px solid #f1f5f9' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '12px' }}>
                <div>
                  <div style={{ fontSize: '15px', fontWeight: '700', color: '#0f172a' }}>{acc.name}</div>
                  <div style={{ fontSize: '12px', color: '#94a3b8' }}>{acc.bank_name}</div>
                  <div style={{ fontSize: '12px', color: '#94a3b8' }}>{acc.account_no}</div>
                </div>
                <div style={{ display: 'flex', gap: '6px' }}>
                  <button onClick={() => { setEditAccount(acc); setAccountForm({ name: acc.name, bank_name: acc.bank_name || '', account_no: acc.account_no || '', balance: '' }); setShowAccountForm(true) }}
                    style={{ padding: '4px 12px', background: '#eef2ff', color: '#2563eb', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '12px', fontWeight: '700' }}>Edit</button>
                  {isSuperAdmin && (
                    <button
                      onClick={() => deleteAccount(acc)}
                      disabled={(acc.balance || 0) !== 0}
                      title={(acc.balance || 0) !== 0 ? 'Balance must be 0 to delete' : 'Delete account'}
                      style={{ padding: '4px 10px', background: (acc.balance || 0) !== 0 ? '#f1f5f9' : '#fee2e2', color: (acc.balance || 0) !== 0 ? '#cbd5e1' : '#dc2626', border: 'none', borderRadius: '6px', cursor: (acc.balance || 0) !== 0 ? 'not-allowed' : 'pointer', fontSize: '12px', fontWeight: '700' }}>
                      🗑
                    </button>
                  )}
                </div>
              </div>
              <div style={{ fontSize: '26px', fontWeight: '800', color: acc.balance >= 0 ? '#059669' : '#e11d48' }}>{formatCurrency(acc.balance)}</div>
            </div>
          ))}
        </div>
      )}

      {/* Transactions tab */}
      {activeTab === 'transactions' && (
        <div style={{ background: 'white', borderRadius: '12px', boxShadow: '0 1px 3px rgba(15,23,42,0.06), 0 1px 2px rgba(15,23,42,0.04)', overflow: 'hidden' }}>
          {transactions.length === 0 ? (
            <div style={{ padding: '40px', textAlign: 'center', color: '#94a3b8' }}>No transactions yet</div>
          ) : (
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: '#f8fafc', borderBottom: '2px solid #e2e8f0' }}>
                  {['Date', 'Account', 'Type', 'Reference', 'Amount', 'Notes'].map(h => (
                    <th key={h} style={{ padding: '11px 14px', textAlign: 'left', fontSize: '11px', fontWeight: '700', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {transactions.map((tx, i) => {
                  const isIn = tx.type === 'deposit' || tx.type === 'cheque_in'
                  return (
                    <tr key={tx.id} style={{ borderBottom: '1px solid #f1f5f9', background: i % 2 === 0 ? 'white' : '#fafafa' }}>
                      <td style={{ padding: '11px 14px', fontSize: '13px', color: '#64748b' }}>{new Date(tx.created_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}</td>
                      <td style={{ padding: '11px 14px', fontSize: '13px', fontWeight: '600', color: '#0f172a' }}>{tx.bank_accounts?.name}</td>
                      <td style={{ padding: '11px 14px' }}>
                        <span style={{ background: `${txTypeColors[tx.type]}15`, color: txTypeColors[tx.type], padding: '3px 8px', borderRadius: '12px', fontSize: '12px', fontWeight: '700' }}>{txTypeLabels[tx.type]}</span>
                      </td>
                      <td style={{ padding: '11px 14px', fontSize: '13px', color: '#64748b' }}>{tx.reference || tx.cheque_no || '—'}</td>
                      <td style={{ padding: '11px 14px', fontSize: '14px', fontWeight: '700', color: isIn ? '#059669' : '#e11d48' }}>
                        {isIn ? '+' : '-'}{formatCurrency(tx.amount)}
                      </td>
                      <td style={{ padding: '11px 14px', fontSize: '13px', color: '#64748b' }}>{tx.notes || '—'}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* Cheques due tab */}
      {activeTab === 'cheques' && (
        <div>
          {/* Summary */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '16px' }}>
            {[
              { label: 'Unrealized Cheques In', value: formatCurrency(chequesDue.filter(c => c.type === 'cheque_in').reduce((s, c) => s + (c.amount || 0), 0)), sub: `${chequesDue.filter(c => c.type === 'cheque_in').length} cheques to receive`, color: '#059669' },
              { label: 'Unrealized Cheques Out', value: formatCurrency(chequesDue.filter(c => c.type === 'cheque_out').reduce((s, c) => s + (c.amount || 0), 0)), sub: `${chequesDue.filter(c => c.type === 'cheque_out').length} cheques to pay`, color: '#e11d48' },
            ].map(s => (
              <div key={s.label} style={{ background: 'white', borderRadius: '12px', padding: '18px', boxShadow: '0 1px 3px rgba(15,23,42,0.06), 0 1px 2px rgba(15,23,42,0.04)', borderLeft: `4px solid ${s.color}` }}>
                <div style={{ fontSize: '11px', fontWeight: '700', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '6px' }}>{s.label}</div>
                <div style={{ fontSize: '20px', fontWeight: '800', color: s.color }}>{s.value}</div>
                <div style={{ fontSize: '12px', color: '#94a3b8', marginTop: '3px' }}>{s.sub}</div>
              </div>
            ))}
          </div>

          <div style={{ background: 'white', borderRadius: '12px', boxShadow: '0 1px 3px rgba(15,23,42,0.06), 0 1px 2px rgba(15,23,42,0.04)', overflow: 'hidden' }}>
            {/* Sub-tabs + Search */}
            <div style={{ padding: '12px 16px', borderBottom: '1px solid #f1f5f9', display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', background: '#f1f5f9', borderRadius: '10px', padding: '3px', gap: '2px' }}>
                {[{ id: 'active', label: `Unrealized (${chequesDue.length})` }, { id: 'returned', label: `Returned (${chequesReturned.length})` }].map(t => (
                  <button key={t.id} onClick={() => setChequeSubTab(t.id)}
                    style={{ padding: '5px 14px', borderRadius: '6px', border: 'none', cursor: 'pointer', fontSize: '13px', fontWeight: '700',
                      background: chequeSubTab === t.id ? 'white' : 'transparent',
                      color: chequeSubTab === t.id ? '#0f172a' : '#64748b',
                      boxShadow: chequeSubTab === t.id ? '0 1px 3px rgba(0,0,0,0.1)' : 'none' }}>
                    {t.label}
                  </button>
                ))}
              </div>
              <input type="text" value={chequeSearch} onChange={e => setChequeSearch(e.target.value)}
                placeholder="Search cheque no, reference, supplier, customer…"
                style={{ flex: 1, minWidth: '220px', padding: '7px 12px', border: '1.5px solid #e2e8f0', borderRadius: '10px', fontSize: '13px', outline: 'none' }} />
              {chequeSearch && <button onClick={() => setChequeSearch('')} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94a3b8', fontSize: '16px' }}>✕</button>}
            </div>

            {(() => {
              const src = chequeSubTab === 'active' ? chequesDue : chequesReturned
              const s = chequeSearch.toLowerCase()
              const filtered = s ? src.filter(c =>
                (c.cheque_no || '').toLowerCase().includes(s) ||
                (c.reference || '').toLowerCase().includes(s) ||
                (c.notes || '').toLowerCase().includes(s) ||
                (c.bank_accounts?.name || '').toLowerCase().includes(s)
              ) : src
              return filtered.length === 0 ? (
                <div style={{ padding: '40px', textAlign: 'center', color: '#94a3b8' }}>
                  <div style={{ fontSize: '32px', marginBottom: '8px' }}>{chequeSubTab === 'active' ? '✅' : '↩'}</div>
                  {chequeSubTab === 'active' ? 'No unrealized cheques' : 'No returned cheques'}
                </div>
              ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ background: '#f8fafc', borderBottom: '2px solid #e2e8f0' }}>
                    {['Cheque Date', 'Account', 'Type', 'Reference', 'Cheque No', 'Amount', chequeSubTab === 'active' ? 'Due In' : 'Returned', 'Action'].map(h => (
                      <th key={h} style={{ padding: '11px 14px', textAlign: 'left', fontSize: '11px', fontWeight: '700', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.06em', whiteSpace: 'nowrap' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((tx, i) => {
                    const today = new Date(); today.setHours(0, 0, 0, 0)
                    const chequeDay = new Date(tx.cheque_date); chequeDay.setHours(0, 0, 0, 0)
                    const daysLeft = Math.ceil((chequeDay - today) / (1000 * 60 * 60 * 24))
                    const isOverdue = daysLeft < 0
                    const isDueToday = daysLeft === 0
                    return (
                      <tr key={tx.id} style={{ borderBottom: '1px solid #f1f5f9', background: isOverdue ? '#fff5f5' : isDueToday ? '#fffbeb' : i % 2 === 0 ? 'white' : '#fafafa' }}>
                        <td style={{ padding: '11px 14px' }}>
                          <div style={{ fontSize: '13px', fontWeight: '700', color: isOverdue ? '#e11d48' : '#0f172a' }}>{new Date(tx.cheque_date).toLocaleDateString('en-GB')}</div>
                        </td>
                        <td style={{ padding: '11px 14px', fontSize: '13px', fontWeight: '600', color: '#0f172a' }}>{tx.bank_accounts?.name}</td>
                        <td style={{ padding: '11px 14px' }}>
                          <span style={{ background: txTypeColors[tx.type] + '20', color: txTypeColors[tx.type], padding: '3px 8px', borderRadius: '12px', fontSize: '12px', fontWeight: '700' }}>{txTypeLabels[tx.type]}</span>
                        </td>
                        <td style={{ padding: '11px 14px', fontSize: '12px', color: '#64748b' }}>{tx.reference || '—'}</td>
                        <td style={{ padding: '11px 14px', fontSize: '13px', fontFamily: 'monospace', color: '#64748b' }}>{tx.cheque_no || '—'}</td>
                        <td style={{ padding: '11px 14px', fontSize: '14px', fontWeight: '700', color: tx.type === 'cheque_in' ? '#059669' : '#e11d48' }}>{formatCurrency(tx.amount)}</td>
                        <td style={{ padding: '11px 14px' }}>
                          {chequeSubTab === 'returned'
                            ? <span style={{ background: '#fee2e2', color: '#dc2626', padding: '3px 8px', borderRadius: '12px', fontSize: '11px', fontWeight: '700' }}>Returned</span>
                            : isOverdue
                            ? <span style={{ background: '#fee2e2', color: '#dc2626', padding: '3px 8px', borderRadius: '12px', fontSize: '11px', fontWeight: '700' }}>Overdue!</span>
                            : isDueToday
                            ? <span style={{ background: '#fef3c7', color: '#92400e', padding: '3px 8px', borderRadius: '12px', fontSize: '11px', fontWeight: '700' }}>Today</span>
                            : <span style={{ fontSize: '12px', color: '#64748b' }}>{daysLeft} day{daysLeft !== 1 ? 's' : ''}</span>}
                        </td>
                        <td style={{ padding: '11px 14px' }}>
                          {chequeSubTab === 'active' ? (
                            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                              {tx.type === 'cheque_in' ? (
                                <button onClick={() => presentCheque(tx, null)}
                                  style={{ padding: '5px 12px', background: 'linear-gradient(135deg,#059669,#047857)', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '12px', fontWeight: '700' }}>
                                  💳 Realize
                                </button>
                              ) : (
                                <button onClick={() => presentCheque(tx, tx.bank_account_id)}
                                  style={{ padding: '5px 12px', background: 'linear-gradient(135deg,#2563eb,#1d4ed8)', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '12px', fontWeight: '700' }}>
                                  ✓ Realized
                                </button>
                              )}
                              <button onClick={() => returnCheque(tx)} disabled={saving}
                                style={{ padding: '5px 12px', background: '#fee2e2', color: '#dc2626', border: '1.5px solid #fca5a5', borderRadius: '6px', cursor: 'pointer', fontSize: '12px', fontWeight: '700' }}>
                                ↩ Return
                              </button>
                            </div>
                          ) : (
                            <span style={{ fontSize: '12px', color: '#94a3b8', fontStyle: 'italic' }}>Returned</span>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
              )
            })()}
          </div>
        </div>
      )}
    </div>
  )
}
