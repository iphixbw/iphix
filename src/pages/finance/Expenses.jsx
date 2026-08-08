import { useState, useEffect } from 'react'
import { supabase } from '../../supabase'
import { formatCurrency } from '../../lib/helpers'
import toast from 'react-hot-toast'

const DEFAULT_CATEGORIES = ['Rent', 'Utilities', 'Salaries', 'Transport', 'Maintenance', 'Office Supplies', 'Marketing', 'Other']

export default function Expenses({ activeShop, session }) {
  const [categories, setCategories] = useState(DEFAULT_CATEGORIES)
  const [expenses, setExpenses] = useState([])
  const [bankAccounts, setBankAccounts] = useState([])
  const [shops, setShops] = useState([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editingExpense, setEditingExpense] = useState(null) // null = new, obj = editing
  const [saving, setSaving] = useState(false)
  const [search, setSearch] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [form, setForm] = useState({
    description: '', amount: '', payment_method: 'cash',
    bank_account_id: '', cheque_no: '', cheque_date: '',
    category: 'Other', expense_type: 'shop', shop_id: ''
  })

  useEffect(() => {
    // Load custom categories if saved in settings, otherwise use defaults
    supabase.from('shops').select('id').limit(1).then(() => {
      const saved = localStorage.getItem('phonefix_expense_categories')
      if (saved) { try { setCategories(JSON.parse(saved)) } catch { setCategories(DEFAULT_CATEGORIES) } }
    })
    fetchData()
  }, [activeShop?.id])

  // Pre-fill shop_id when activeShop is available
  useEffect(() => {
    if (activeShop) {
      setForm(p => ({ ...p, shop_id: activeShop.id, expense_type: 'shop' }))
    }
  }, [activeShop])

  async function fetchData() {
    setLoading(true)
    let expQ = supabase.from('expenses').select('*').order('created_at', { ascending: false })
    // Shop-scoped: show this shop's expenses + general (null shop_id)
    if (activeShop?.id) {
      expQ = expQ.or(`shop_id.eq.${activeShop.id},shop_id.is.null`)
    }
    const [{ data: exp }, { data: banks }, { data: sh }] = await Promise.all([
      expQ,
      supabase.from('bank_accounts').select('*').order('name'),
      supabase.from('shops').select('*').order('name'),
    ])
    setExpenses(exp || [])
    setBankAccounts(banks || [])
    setShops(sh || [])
    setLoading(false)
  }

  function openNew() {
    setEditingExpense(null)
    setForm({ description: '', amount: '', payment_method: 'cash', bank_account_id: '', cheque_no: '', cheque_date: '', category: 'Other', expense_type: activeShop ? 'shop' : 'general', shop_id: activeShop?.id || '' })
    setShowForm(true)
  }

  function openEdit(e) {
    setEditingExpense(e)
    setForm({
      description: e.description,
      amount: String(e.amount),
      payment_method: e.payment_method || 'cash',
      bank_account_id: e.bank_account_id || '',
      cheque_no: e.cheque_no || '',
      cheque_date: e.cheque_date || '',
      category: e.category || 'Other',
      expense_type: e.shop_id ? 'shop' : 'general',
      shop_id: e.shop_id || '',
    })
    setShowForm(true)
  }

  async function handleDelete(exp) {
    if (!window.confirm(`Delete expense "${exp.description}" of ${formatCurrency(exp.amount)}? This will reverse any bank impact.`)) return
    try {
      // Reverse bank balance if bank payment
      if (exp.payment_method === 'bank' && exp.bank_account_id) {
        const { data: acc } = await supabase.from('bank_accounts').select('balance').eq('id', exp.bank_account_id).single()
        await supabase.from('bank_accounts').update({ balance: (acc?.balance || 0) + exp.amount }).eq('id', exp.bank_account_id)
        // Remove related bank_transaction
        await supabase.from('bank_transactions').delete()
          .eq('bank_account_id', exp.bank_account_id)
          .ilike('reference', `Expense: ${exp.description}`)
      }
      await supabase.from('expenses').delete().eq('id', exp.id)
      toast.success('Expense deleted')
      fetchData()
    } catch (e) { toast.error('Failed: ' + e.message) }
  }

  async function handleSave() {
    if (!form.description.trim()) return toast.error('Description is required')
    if (!form.amount || parseFloat(form.amount) <= 0) return toast.error('Enter a valid amount')
    if ((form.payment_method === 'bank' || form.payment_method === 'cheque') && !form.bank_account_id) return toast.error('Select a bank account')
    if (form.payment_method === 'cheque' && !form.cheque_date) return toast.error('Enter cheque date')
    if (form.expense_type === 'shop' && !form.shop_id) return toast.error('Select a shop or choose General')
    setSaving(true)
    try {
      const shopId = form.expense_type === 'general' ? null : form.shop_id
      const newAmount = parseFloat(form.amount)

      if (editingExpense) {
        // EDIT: reverse old bank impact, apply new
        const oldAmt = editingExpense.amount
        const oldMethod = editingExpense.payment_method
        const oldBankId = editingExpense.bank_account_id

        // Reverse old bank deduction if was bank transfer
        if (oldMethod === 'bank' && oldBankId) {
          const { data: acc } = await supabase.from('bank_accounts').select('balance').eq('id', oldBankId).single()
          await supabase.from('bank_accounts').update({ balance: (acc?.balance || 0) + oldAmt }).eq('id', oldBankId)
          await supabase.from('bank_transactions').delete()
            .eq('bank_account_id', oldBankId).ilike('reference', `Expense: ${editingExpense.description}`)
        }

        // Update expense record
        const { error } = await supabase.from('expenses').update({
          description: form.description, amount: newAmount,
          payment_method: form.payment_method,
          bank_account_id: (form.payment_method === 'bank' || form.payment_method === 'cheque') ? form.bank_account_id : null,
          cheque_no: form.payment_method === 'cheque' ? form.cheque_no : null,
          cheque_date: form.payment_method === 'cheque' ? form.cheque_date : null,
          category: form.category, shop_id: shopId,
        }).eq('id', editingExpense.id)
        if (error) throw error

        // Apply new bank impact
        if (form.payment_method === 'bank' && form.bank_account_id) {
          const { data: acc } = await supabase.from('bank_accounts').select('balance').eq('id', form.bank_account_id).single()
          await supabase.from('bank_accounts').update({ balance: (acc?.balance || 0) - newAmount }).eq('id', form.bank_account_id)
          await supabase.from('bank_transactions').insert({ bank_account_id: form.bank_account_id, type: 'withdrawal', amount: newAmount, reference: `Expense: ${form.description}`, notes: form.category, shop_id: shopId })
        }
        toast.success('Expense updated!')
      } else {
        // NEW expense
        const { error } = await supabase.from('expenses').insert({
          description: form.description, amount: newAmount,
          payment_method: form.payment_method,
          bank_account_id: (form.payment_method === 'bank' || form.payment_method === 'cheque') ? form.bank_account_id : null,
          cheque_no: form.payment_method === 'cheque' ? form.cheque_no : null,
          cheque_date: form.payment_method === 'cheque' ? form.cheque_date : null,
          category: form.category, shop_id: shopId, created_by: session?.user?.id,
        })
        if (error) throw error

        if (form.payment_method === 'bank' && form.bank_account_id) {
          const bank = bankAccounts.find(b => b.id === form.bank_account_id)
          await supabase.from('bank_accounts').update({ balance: (bank?.balance || 0) - newAmount }).eq('id', form.bank_account_id)
          await supabase.from('bank_transactions').insert({ bank_account_id: form.bank_account_id, type: 'withdrawal', amount: newAmount, reference: `Expense: ${form.description}`, notes: form.category, shop_id: shopId })
        }
        if (form.payment_method === 'cheque' && form.bank_account_id) {
          await supabase.from('bank_transactions').insert({ bank_account_id: form.bank_account_id, type: 'cheque_out', amount: newAmount, cheque_no: form.cheque_no || null, cheque_date: form.cheque_date, cheque_status: 'pending', reference: `Expense: ${form.description}`, notes: form.category, shop_id: shopId })
          toast.success('Expense recorded! Cheque pending on ' + new Date(form.cheque_date).toLocaleDateString('en-GB'))
        } else {
          toast.success('Expense recorded!')
        }
      }

      setForm({ description: '', amount: '', payment_method: 'cash', bank_account_id: '', cheque_no: '', cheque_date: '', category: 'Other', expense_type: activeShop ? 'shop' : 'general', shop_id: activeShop?.id || '' })
      setShowForm(false); setEditingExpense(null)
      fetchData()
    } catch (e) { toast.error('Failed: ' + e.message) }
    setSaving(false)
  }

  const filtered = expenses.filter(e => {
    const matchSearch = e.description.toLowerCase().includes(search.toLowerCase()) || e.category?.toLowerCase().includes(search.toLowerCase())
    const matchFrom = !dateFrom || new Date(e.created_at) >= new Date(dateFrom)
    const matchTo = !dateTo || new Date(e.created_at) <= new Date(dateTo + 'T23:59:59')
    return matchSearch && matchFrom && matchTo
  })

  const totalAmount = filtered.reduce((s, e) => s + (e.amount || 0), 0)
  const byCash = filtered.filter(e => e.payment_method === 'cash').reduce((s, e) => s + (e.amount || 0), 0)
  const byBank = filtered.filter(e => e.payment_method === 'bank').reduce((s, e) => s + (e.amount || 0), 0)
  const generalTotal = filtered.filter(e => !e.shop_id).reduce((s, e) => s + (e.amount || 0), 0)

  const inp = { width: '100%', padding: '9px 12px', border: '1.5px solid #e2e8f0', borderRadius: '7px', fontSize: '14px', boxSizing: 'border-box', outline: 'none', background: 'white' }
  const lbl = { display: 'block', marginBottom: '5px', fontSize: '11px', fontWeight: '700', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.06em' }
  const payColors = { cash: '#059669', bank: '#2563eb', cheque: '#d97706' }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '24px' }}>
        <div>
          <h1 style={{ fontSize: '22px', fontWeight: '700', color: '#0f172a', margin: '0 0 4px' }}>Expenses</h1>
          <p style={{ color: '#64748b', fontSize: '14px', margin: 0 }}>Track all business expenses</p>
        </div>
        <button onClick={openNew}
          style={{ padding: '10px 20px', background: 'linear-gradient(135deg,#2563eb,#1d4ed8)', color: 'white', border: 'none', borderRadius: '10px', cursor: 'pointer', fontWeight: '700', fontSize: '14px' }}>
          + Add Expense
        </button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: '16px', marginBottom: '24px' }}>
        {[
          { label: 'Total', value: formatCurrency(totalAmount), color: '#e11d48' },
          { label: 'Cash', value: formatCurrency(byCash), color: '#059669' },
          { label: 'Bank', value: formatCurrency(byBank), color: '#2563eb' },
          { label: 'General', value: formatCurrency(generalTotal), color: '#d97706', sub: 'Not shop-specific' },
        ].map(s => (
          <div key={s.label} style={{ background: 'white', borderRadius: '12px', padding: '20px', boxShadow: '0 1px 3px rgba(15,23,42,0.06), 0 1px 2px rgba(15,23,42,0.04)', borderLeft: `4px solid ${s.color}` }}>
            <div style={{ fontSize: '12px', fontWeight: '700', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '6px' }}>{s.label}</div>
            <div style={{ fontSize: '20px', fontWeight: '800', color: s.color }}>{s.value}</div>
            {s.sub && <div style={{ fontSize: '11px', color: '#94a3b8', marginTop: '3px' }}>{s.sub}</div>}
          </div>
        ))}
      </div>

      {showForm && (
        <div style={{ background: 'white', borderRadius: '12px', padding: '24px', boxShadow: '0 1px 3px rgba(15,23,42,0.06), 0 1px 2px rgba(15,23,42,0.04)', marginBottom: '20px', border: `1px solid ${editingExpense ? '#fde68a' : '#f1f5f9'}` }}>
          <h3 style={{ margin: '0 0 16px', fontSize: '15px', fontWeight: '700', color: '#0f172a' }}>
            {editingExpense ? '✏️ Edit Expense' : 'New Expense'}
          </h3>

          {/* Expense type — Shop or General */}
          <div style={{ marginBottom: '16px' }}>
            <label style={lbl}>Expense Type</label>
            <div style={{ display: 'flex', gap: '10px' }}>
              {[
                { value: 'shop', label: '🏪 Shop Expense', desc: 'Allocated to a specific shop', color: '#e11d48' },
                { value: 'general', label: '🌐 General Expense', desc: 'Not shop-specific — affects overall P&L', color: '#d97706' },
              ].map(opt => (
                <button key={opt.value} type="button"
                  onClick={() => setForm(p => ({ ...p, expense_type: opt.value, shop_id: opt.value === 'general' ? '' : (activeShop?.id || p.shop_id) }))}
                  style={{ flex: 1, padding: '12px 16px', background: form.expense_type === opt.value ? `${opt.color}15` : '#f8fafc', border: `1.5px solid ${form.expense_type === opt.value ? opt.color : '#e2e8f0'}`, borderRadius: '10px', cursor: 'pointer', textAlign: 'left', transition: 'all 0.15s' }}>
                  <div style={{ fontSize: '13px', fontWeight: '700', color: form.expense_type === opt.value ? opt.color : '#0f172a', marginBottom: '2px' }}>{opt.label}</div>
                  <div style={{ fontSize: '11px', color: '#94a3b8' }}>{opt.desc}</div>
                </button>
              ))}
            </div>
          </div>

          {/* Shop selector — only if shop expense */}
          {form.expense_type === 'shop' && (
            <div style={{ marginBottom: '16px' }}>
              <label style={lbl}>Shop *</label>
              <select value={form.shop_id} onChange={e => setForm(p => ({ ...p, shop_id: e.target.value }))} style={{ ...inp, borderColor: !form.shop_id ? '#fca5a5' : '#e2e8f0' }}>
                <option value="">Select shop</option>
                {shops.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
          )}

          {form.expense_type === 'general' && (
            <div style={{ padding: '10px 14px', background: '#fffbeb', borderRadius: '10px', border: '1px solid #fde68a', marginBottom: '16px', fontSize: '13px', color: '#92400e' }}>
              💡 This expense will appear in overall business P&L but will <strong>not</strong> affect any individual shop's profitability.
            </div>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr', gap: '14px', marginBottom: '14px' }}>
            <div>
              <label style={lbl}>Description *</label>
              <input type="text" value={form.description} onChange={e => setForm(p => ({ ...p, description: e.target.value }))} placeholder="What was this expense for?" style={inp} />
            </div>
            <div>
              <label style={lbl}>Amount (LKR) *</label>
              <input type="number" value={form.amount} onChange={e => setForm(p => ({ ...p, amount: e.target.value }))} placeholder="0.00" style={{ ...inp, fontWeight: '600', fontSize: '15px' }} />
            </div>
            <div>
              <label style={lbl}>Category</label>
              <select value={form.category} onChange={e => setForm(p => ({ ...p, category: e.target.value }))} style={inp}>
                {categories.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label style={lbl}>Payment Method</label>
              <select value={form.payment_method} onChange={e => setForm(p => ({ ...p, payment_method: e.target.value, bank_account_id: '', cheque_no: '', cheque_date: '' }))} style={inp}>
                <option value="cash">Cash</option>
                <option value="bank">Bank Transfer</option>
                <option value="cheque">Cheque</option>
              </select>
            </div>
          </div>

          {(form.payment_method === 'bank' || form.payment_method === 'cheque') && (
            <div style={{ display: 'grid', gridTemplateColumns: form.payment_method === 'cheque' ? '1fr 1fr 1fr' : '1fr 1fr', gap: '14px', marginBottom: '14px' }}>
              <div>
                <label style={lbl}>Bank Account *</label>
                <select value={form.bank_account_id} onChange={e => setForm(p => ({ ...p, bank_account_id: e.target.value }))} style={inp}>
                  <option value="">Select account</option>
                  {bankAccounts.map(b => <option key={b.id} value={b.id}>{b.name} — {b.bank_name} ({formatCurrency(b.balance)})</option>)}
                </select>
              </div>
              {form.payment_method === 'cheque' && (
                <>
                  <div>
                    <label style={lbl}>Cheque No</label>
                    <input type="text" value={form.cheque_no} onChange={e => setForm(p => ({ ...p, cheque_no: e.target.value }))} placeholder="Cheque number" style={inp} />
                  </div>
                  <div>
                    <label style={lbl}>Cheque Date *</label>
                    <input type="date" value={form.cheque_date} onChange={e => setForm(p => ({ ...p, cheque_date: e.target.value }))} style={{ ...inp, borderColor: !form.cheque_date ? '#fca5a5' : '#e2e8f0' }} />
                  </div>
                </>
              )}
            </div>
          )}

          {form.payment_method === 'cheque' && form.cheque_date && (
            <div style={{ padding: '10px 14px', background: '#fef3c7', borderRadius: '10px', border: '1px solid #fde68a', marginBottom: '14px', fontSize: '13px', color: '#92400e' }}>
              💡 Cheque will be tracked in Bank → Cheques Due on <strong>{new Date(form.cheque_date).toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' })}</strong>
            </div>
          )}

          <div style={{ display: 'flex', gap: '10px' }}>
            <button onClick={handleSave} disabled={saving}
              style={{ padding: '10px 24px', background: 'linear-gradient(135deg,#2563eb,#1d4ed8)', color: 'white', border: 'none', borderRadius: '10px', cursor: 'pointer', fontWeight: '700', fontSize: '14px' }}>
              {saving ? 'Saving...' : editingExpense ? 'Update Expense' : 'Record Expense'}
            </button>
            <button onClick={() => { setShowForm(false); setEditingExpense(null) }}
              style={{ padding: '10px 20px', background: '#f1f5f9', color: '#64748b', border: 'none', borderRadius: '10px', cursor: 'pointer', fontWeight: '600', fontSize: '14px' }}>
              Cancel
            </button>
          </div>
        </div>
      )}

      <div style={{ background: 'white', borderRadius: '12px', padding: '14px 16px', boxShadow: '0 1px 3px rgba(15,23,42,0.06), 0 1px 2px rgba(15,23,42,0.04)', marginBottom: '16px', display: 'flex', gap: '12px', flexWrap: 'wrap', alignItems: 'center' }}>
        <input type="text" placeholder="Search description or category…" value={search} onChange={e => setSearch(e.target.value)} style={{ ...inp, flex: 1, minWidth: '200px' }} />
        <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} style={inp} />
        <span style={{ color: '#94a3b8', fontSize: '13px' }}>to</span>
        <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} style={inp} />
        {(search || dateFrom || dateTo) && (
          <button onClick={() => { setSearch(''); setDateFrom(''); setDateTo('') }}
            style={{ padding: '9px 16px', background: '#f1f5f9', color: '#64748b', border: 'none', borderRadius: '7px', cursor: 'pointer', fontSize: '13px', fontWeight: '600' }}>Clear</button>
        )}
      </div>

      <div style={{ background: 'white', borderRadius: '12px', boxShadow: '0 1px 3px rgba(15,23,42,0.06), 0 1px 2px rgba(15,23,42,0.04)', overflow: 'hidden' }}>
        {loading ? <div style={{ padding: '60px', textAlign: 'center', color: '#94a3b8' }}>Loading...</div>
        : filtered.length === 0 ? (
          <div style={{ padding: '60px', textAlign: 'center', color: '#94a3b8' }}>
            <div style={{ fontSize: '36px', marginBottom: '12px' }}>📝</div>No expenses found
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: '#f8fafc', borderBottom: '2px solid #e2e8f0' }}>
                {['Date', 'Description', 'Category', 'Payment', 'Shop', 'Type', 'Amount', 'Actions'].map(h => (
                  <th key={h} style={{ padding: '11px 16px', textAlign: 'left', fontSize: '11px', fontWeight: '700', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((e, i) => {
                const shopName = shops.find(s => s.id === e.shop_id)?.name
                const isGeneral = !e.shop_id
                return (
                  <tr key={e.id} style={{ borderBottom: '1px solid #f1f5f9', background: i % 2 === 0 ? 'white' : '#fafafa' }}>
                    <td style={{ padding: '12px 16px', fontSize: '13px', color: '#64748b', whiteSpace: 'nowrap' }}>
                      {new Date(e.created_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}
                    </td>
                    <td style={{ padding: '12px 16px', fontSize: '14px', fontWeight: '600', color: '#0f172a' }}>{e.description}</td>
                    <td style={{ padding: '12px 16px' }}>
                      <span style={{ background: '#f1f5f9', color: '#475569', padding: '3px 8px', borderRadius: '12px', fontSize: '12px', fontWeight: '600' }}>{e.category || 'Other'}</span>
                    </td>
                    <td style={{ padding: '12px 16px' }}>
                      <span style={{ background: `${payColors[e.payment_method] || '#64748b'}15`, color: payColors[e.payment_method] || '#64748b', padding: '3px 8px', borderRadius: '12px', fontSize: '12px', fontWeight: '700', textTransform: 'capitalize' }}>
                        {e.payment_method}
                      </span>
                    </td>
                    <td style={{ padding: '12px 16px', fontSize: '13px', color: '#64748b' }}>{shopName || <span style={{ color: '#94a3b8', fontStyle: 'italic' }}>—</span>}</td>
                    <td style={{ padding: '12px 16px' }}>
                      <span style={{ background: isGeneral ? '#fef3c7' : '#fee2e2', color: isGeneral ? '#92400e' : '#991b1b', padding: '3px 8px', borderRadius: '12px', fontSize: '11px', fontWeight: '700' }}>
                        {isGeneral ? 'General' : 'Shop'}
                      </span>
                    </td>
                    <td style={{ padding: '12px 16px', fontSize: '15px', fontWeight: '800', color: '#e11d48' }}>{formatCurrency(e.amount)}</td>
                    <td style={{ padding: '12px 16px' }}>
                      <div style={{ display: 'flex', gap: '6px' }}>
                        <button onClick={ev => { ev.stopPropagation(); openEdit(e) }}
                          style={{ padding: '4px 10px', background: '#eef2ff', color: '#2563eb', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '12px', fontWeight: '700' }}>✏️ Edit</button>
                        <button onClick={ev => { ev.stopPropagation(); handleDelete(e) }}
                          style={{ padding: '4px 10px', background: '#fee2e2', color: '#dc2626', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '12px', fontWeight: '700' }}>🗑</button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
