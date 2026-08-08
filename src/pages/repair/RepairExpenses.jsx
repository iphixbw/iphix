import { useState, useEffect } from 'react'
import { supabase } from '../../supabase'
import toast from 'react-hot-toast'
import { formatLKR, timeAgo } from '../../lib/repairConstants'

const CATEGORIES = ['Rent', 'Electricity', 'Internet', 'Technician Salaries', 'Cleaning', 'Tools', 'Fuel', 'Miscellaneous']

export default function RepairExpenses({ shop }) {
  const [expenses, setExpenses] = useState([])
  const [loading, setLoading] = useState(true)
  const [showNew, setShowNew] = useState(false)

  useEffect(() => { fetchExpenses() }, [shop?.id])

  async function fetchExpenses() {
    setLoading(true)
    let q = supabase.from('repair_expenses').select('*').order('created_at', { ascending: false })
    if (shop?.id) q = q.eq('shop_id', shop.id)
    const { data } = await q
    setExpenses(data || [])
    setLoading(false)
  }

  const monthStart = new Date(); monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0)
  const monthTotal = expenses.filter(e => new Date(e.created_at) >= monthStart).reduce((s, e) => s + e.amount, 0)

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '20px' }}>
        <div>
          <h1 style={{ fontSize: '22px', fontWeight: '800', color: '#1c1917', margin: '0 0 4px' }}>Repair Expenses</h1>
          <p style={{ color: '#8a7a63', fontSize: '14px', margin: 0 }}>This month: <strong style={{ color: '#e11d48' }}>{formatLKR(monthTotal)}</strong></p>
        </div>
        <button onClick={() => setShowNew(true)}
          style={{ padding: '11px 22px', background: 'linear-gradient(135deg,#f0b23d,#d4881f)', color: '#1c1917', border: 'none', borderRadius: '12px', cursor: 'pointer', fontWeight: '800', fontSize: '14px' }}>
          + Add Expense
        </button>
      </div>

      {loading ? <div style={{ padding: '60px', textAlign: 'center', color: '#a89478' }}>Loading...</div> : (
        <div style={{ background: 'white', borderRadius: '16px', border: '1px solid #f3ede4', overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr style={{ background: '#fdf8f3', borderBottom: '2px solid #f3ede4' }}>
              {['Date', 'Category', 'Description', 'Amount', 'Payment'].map(h => <th key={h} style={{ padding: '10px 14px', textAlign: 'left', fontSize: '10px', fontWeight: '700', color: '#a89478', textTransform: 'uppercase' }}>{h}</th>)}
            </tr></thead>
            <tbody>
              {expenses.map((e, i) => (
                <tr key={e.id} style={{ borderBottom: '1px solid #f8f5f0', background: i % 2 === 0 ? 'white' : '#fdfbf8' }}>
                  <td style={{ padding: '11px 14px', fontSize: '12px', color: '#78716c' }}>{timeAgo(e.created_at)}</td>
                  <td style={{ padding: '11px 14px', fontWeight: '600' }}>{e.category || '—'}</td>
                  <td style={{ padding: '11px 14px' }}>{e.description}</td>
                  <td style={{ padding: '11px 14px', fontWeight: '700', color: '#e11d48' }}>{formatLKR(e.amount)}</td>
                  <td style={{ padding: '11px 14px', fontSize: '12px', textTransform: 'capitalize' }}>{e.payment_method || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {expenses.length === 0 && <div style={{ padding: '48px', textAlign: 'center', color: '#a89478' }}>No expenses recorded yet.</div>}
        </div>
      )}

      {showNew && <NewExpenseModal shop={shop} onClose={() => setShowNew(false)} onCreated={() => { setShowNew(false); fetchExpenses() }} />}
    </div>
  )
}

function NewExpenseModal({ shop, onClose, onCreated }) {
  const [category, setCategory] = useState(CATEGORIES[0])
  const [description, setDescription] = useState('')
  const [amount, setAmount] = useState('')
  const [paymentMethod, setPaymentMethod] = useState('cash')
  const [saving, setSaving] = useState(false)

  async function handleSave() {
    const amt = parseFloat(amount)
    if (!description.trim()) return toast.error('Description is required')
    if (!amt || amt <= 0) return toast.error('Enter a valid amount')
    setSaving(true)
    try {
      await supabase.from('repair_expenses').insert({ shop_id: shop?.id || null, category, description: description.trim(), amount: amt, payment_method: paymentMethod })
      if (paymentMethod === 'cash') {
        await supabase.from('repair_cash_ledger').insert({ shop_id: shop?.id || null, type: 'expense', amount: -amt, reference: category, notes: description.trim() })
      }
      toast.success('Expense added')
      onCreated()
    } catch (e) { toast.error('Failed: ' + e.message) }
    setSaving(false)
  }

  const inp = { width: '100%', padding: '9px 12px', border: '1.5px solid #e7dfd3', borderRadius: '8px', fontSize: '13px', boxSizing: 'border-box' }
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(28,25,23,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '20px' }}>
      <div style={{ background: 'white', borderRadius: '18px', padding: '24px', width: '100%', maxWidth: '400px' }}>
        <h3 style={{ fontSize: '16px', fontWeight: '800', margin: '0 0 16px', color: '#1c1917' }}>Add Expense</h3>
        <div style={{ marginBottom: '12px' }}>
          <label style={{ fontSize: '11px', fontWeight: '700', color: '#a89478', textTransform: 'uppercase' }}>Category</label>
          <select style={inp} value={category} onChange={e => setCategory(e.target.value)}>
            {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <div style={{ marginBottom: '12px' }}>
          <label style={{ fontSize: '11px', fontWeight: '700', color: '#a89478', textTransform: 'uppercase' }}>Description</label>
          <input style={inp} value={description} onChange={e => setDescription(e.target.value)} />
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginBottom: '18px' }}>
          <div><label style={{ fontSize: '11px', fontWeight: '700', color: '#a89478', textTransform: 'uppercase' }}>Amount</label><input type="number" style={inp} value={amount} onChange={e => setAmount(e.target.value)} /></div>
          <div>
            <label style={{ fontSize: '11px', fontWeight: '700', color: '#a89478', textTransform: 'uppercase' }}>Payment</label>
            <select style={inp} value={paymentMethod} onChange={e => setPaymentMethod(e.target.value)}>
              <option value="cash">Cash</option><option value="bank_transfer">Bank Transfer</option>
            </select>
          </div>
        </div>
        <div style={{ display: 'flex', gap: '10px' }}>
          <button onClick={onClose} style={{ flex: 1, padding: '10px', background: '#f5f1ea', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: '700', color: '#78716c' }}>Cancel</button>
          <button onClick={handleSave} disabled={saving} style={{ flex: 1, padding: '10px', background: 'linear-gradient(135deg,#f0b23d,#d4881f)', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: '800', color: '#1c1917' }}>{saving ? 'Saving...' : 'Add'}</button>
        </div>
      </div>
    </div>
  )
}
