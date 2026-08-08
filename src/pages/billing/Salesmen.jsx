import { useState, useEffect } from 'react'
import { supabase } from '../../supabase'
import { generateSalesmanNo } from '../../lib/helpers'
import toast from 'react-hot-toast'

export default function Salesmen() {
  const [salesmen, setSalesmen] = useState([])
  const [shops, setShops] = useState([])
  const [userShopMap, setUserShopMap] = useState({}) // { user_id: [shop names] }
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editingSalesman, setEditingSalesman] = useState(null)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({ name: '', phone: '' })

  useEffect(() => { fetchData() }, [])

  async function fetchData() {
    setLoading(true)
    const [{ data: smData }, { data: shopsData }, { data: userShopsData }] = await Promise.all([
      supabase.from('salesmen').select('*').order('name'),
      supabase.from('shops').select('*').order('name'),
      supabase.from('user_shops').select('user_id, shop_id, shops(name)'),
    ])
    setSalesmen(smData || [])
    setShops(shopsData || [])

    // Build map: user_id → array of shop names
    const map = {}
    for (const row of (userShopsData || [])) {
      if (!row.user_id) continue
      if (!map[row.user_id]) map[row.user_id] = []
      if (row.shops?.name) map[row.user_id].push(row.shops.name)
    }
    setUserShopMap(map)
    setLoading(false)
  }

  function openNew() {
    setEditingSalesman(null)
    setForm({ name: '', phone: '' })
    setShowForm(true)
  }

  function openEdit(s) {
    setEditingSalesman(s)
    setForm({ name: s.name, phone: s.phone || '' })
    setShowForm(true)
  }

  async function handleSave() {
    if (!form.name.trim()) return toast.error('Salesman name is required')
    setSaving(true)
    try {
      if (editingSalesman) {
        const { error } = await supabase.from('salesmen').update({
          name: form.name, phone: form.phone || null
        }).eq('id', editingSalesman.id)
        if (error) throw error
        toast.success('Salesman updated!')
      } else {
        const salesman_no = await generateSalesmanNo()
        const { error } = await supabase.from('salesmen').insert({
          salesman_no, name: form.name, phone: form.phone || null
        })
        if (error) throw error
        toast.success('Salesman created! Assign them to a user in Settings to link shop access.')
      }
      setForm({ name: '', phone: '' })
      setShowForm(false)
      setEditingSalesman(null)
      fetchData()
    } catch (e) { toast.error('Failed: ' + e.message) }
    setSaving(false)
  }

  async function handleDelete(s) {
    if (!window.confirm(`Delete salesman "${s.name}"? This will not affect existing invoices (they will show the salesman name as-is).`)) return
    try {
      // Null out user_id link on any user_profiles that reference this salesman
      // Then delete — invoices keep their salesman_id but it will return null on join (handled gracefully)
      const { error } = await supabase.from('salesmen').delete().eq('id', s.id)
      if (error) {
        // If FK constraint blocks delete (invoices reference this salesman), inform user
        if (error.code === '23503') {
          toast.error('Cannot delete: this salesman has invoices. Consider renaming them instead.')
        } else {
          toast.error('Failed to delete: ' + error.message)
        }
        return
      }
      toast.success('Salesman deleted')
      fetchData()
    } catch (e) { toast.error('Failed to delete: ' + e.message) }
  }

  const inp = { width: '100%', padding: '9px 12px', border: '1px solid #e2e8f0', borderRadius: '7px', fontSize: '14px', boxSizing: 'border-box', outline: 'none' }
  const lbl = { display: 'block', marginBottom: '6px', fontSize: '13px', fontWeight: '600', color: '#374151' }
  const card = { background: 'white', borderRadius: '12px', padding: '24px', boxShadow: '0 1px 3px rgba(15,23,42,0.06), 0 1px 2px rgba(15,23,42,0.04)', marginBottom: '16px' }

  return (
    <div style={{ maxWidth: '800px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px' }}>
        <div>
          <h1 style={{ fontSize: '22px', fontWeight: '700', color: '#0f172a', margin: '0 0 4px' }}>Salesmen</h1>
          <p style={{ color: '#64748b', fontSize: '13px', margin: 0 }}>Shop access is assigned via Settings → Users</p>
        </div>
        <button onClick={openNew}
          style={{ padding: '10px 20px', background: 'linear-gradient(135deg,#2563eb,#1d4ed8)', color: 'white', border: 'none', borderRadius: '10px', cursor: 'pointer', fontWeight: '700', fontSize: '14px' }}>
          + New Salesman
        </button>
      </div>

      {showForm && (
        <div style={{ ...card, border: `1px solid ${editingSalesman ? '#fde68a' : '#dbeafe'}` }}>
          <h3 style={{ margin: '0 0 16px', fontSize: '15px', fontWeight: '700', color: '#0f172a' }}>
            {editingSalesman ? '✏️ Edit Salesman' : 'New Salesman'}
          </h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px', marginBottom: '16px' }}>
            <div>
              <label style={lbl}>Name *</label>
              <input type="text" value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))}
                placeholder="Full name" style={inp} autoFocus />
            </div>
            <div>
              <label style={lbl}>Phone</label>
              <input type="text" value={form.phone} onChange={e => setForm(p => ({ ...p, phone: e.target.value }))}
                placeholder="07X XXXXXXX" style={inp} />
            </div>
          </div>
          {!editingSalesman && (
            <div style={{ padding: '10px 14px', background: '#f0f9ff', borderRadius: '10px', border: '1px solid #bae6fd', fontSize: '13px', color: '#0369a1', marginBottom: '16px' }}>
              💡 After creating, go to <strong>Settings → Users</strong> to link this salesman to a login account and assign their shop.
            </div>
          )}
          <div style={{ display: 'flex', gap: '10px' }}>
            <button onClick={handleSave} disabled={saving}
              style={{ padding: '10px 24px', background: 'linear-gradient(135deg,#2563eb,#1d4ed8)', color: 'white', border: 'none', borderRadius: '10px', cursor: 'pointer', fontWeight: '700', fontSize: '14px' }}>
              {saving ? 'Saving...' : editingSalesman ? 'Update Salesman' : 'Create Salesman'}
            </button>
            <button onClick={() => { setShowForm(false); setEditingSalesman(null); setForm({ name: '', phone: '' }) }}
              style={{ padding: '10px 18px', background: '#f1f5f9', color: '#64748b', border: 'none', borderRadius: '10px', cursor: 'pointer', fontWeight: '600' }}>
              Cancel
            </button>
          </div>
        </div>
      )}

      <div style={card}>
        {loading ? <div style={{ padding: '40px', textAlign: 'center', color: '#94a3b8' }}>Loading...</div>
        : salesmen.length === 0 ? <div style={{ padding: '40px', textAlign: 'center', color: '#94a3b8' }}>No salesmen yet. Add one above.</div>
        : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: '#f8fafc', borderBottom: '2px solid #e2e8f0' }}>
                {['No.', 'Name', 'Phone', 'Linked Shop', 'Status', 'Actions'].map(h => (
                  <th key={h} style={{ padding: '10px 14px', textAlign: 'left', fontSize: '11px', fontWeight: '700', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {salesmen.map((s, i) => {
                const shopNames = s.user_id ? (userShopMap[s.user_id] || []) : []
                const isLinked = !!s.user_id
                return (
                  <tr key={s.id} style={{ borderBottom: '1px solid #f1f5f9', background: i % 2 === 0 ? 'white' : '#fafafa' }}>
                    <td style={{ padding: '11px 14px', fontWeight: '700', color: '#2563eb', fontSize: '13px' }}>{s.salesman_no}</td>
                    <td style={{ padding: '11px 14px', fontWeight: '600', color: '#0f172a' }}>{s.name}</td>
                    <td style={{ padding: '11px 14px', color: '#64748b', fontSize: '13px' }}>{s.phone || '—'}</td>
                    <td style={{ padding: '11px 14px', fontSize: '13px' }}>
                      {shopNames.length > 0
                        ? <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                            {shopNames.map(name => (
                              <span key={name} style={{ background: '#eef2ff', color: '#1e40af', padding: '2px 10px', borderRadius: '12px', fontSize: '12px', fontWeight: '600' }}>{name}</span>
                            ))}
                          </div>
                        : <span style={{ color: '#94a3b8', fontSize: '12px' }}>
                            {isLinked ? 'Linked — no shop assigned yet' : 'Not assigned — link via Settings'}
                          </span>
                      }
                    </td>
                    <td style={{ padding: '11px 14px' }}>
                      {isLinked
                        ? <span style={{ background: '#f0fdf4', color: '#166534', padding: '2px 8px', borderRadius: '10px', fontSize: '11px', fontWeight: '700' }}>✓ Linked</span>
                        : <span style={{ background: '#fef3c7', color: '#92400e', padding: '2px 8px', borderRadius: '10px', fontSize: '11px', fontWeight: '700' }}>No user</span>}
                    </td>
                    <td style={{ padding: '11px 14px' }}>
                      <div style={{ display: 'flex', gap: '6px' }}>
                        <button onClick={() => openEdit(s)}
                          style={{ padding: '4px 10px', background: '#eef2ff', color: '#2563eb', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '12px', fontWeight: '700' }}>✏️ Edit</button>
                        <button onClick={() => handleDelete(s)}
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
