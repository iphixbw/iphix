import { useState, useEffect } from 'react'
import { supabase } from '../supabase'
import toast from 'react-hot-toast'

export default function Settings({ session }) {
  const [activeTab, setActiveTab] = useState('users')
  const [adjShopId, setAdjShopId] = useState('')
  const [adjAmount, setAdjAmount] = useState('')
  const [adjDesc, setAdjDesc] = useState('')
  const [adjType, setAdjType] = useState('add') // 'add' | 'subtract'
  const [adjSaving, setAdjSaving] = useState(false)
  const [adjHistory, setAdjHistory] = useState([])
  const [expenseCategories, setExpenseCategories] = useState(() => {
    try { const s = localStorage.getItem('phonefix_expense_categories'); return s ? JSON.parse(s) : ['Rent', 'Utilities', 'Salaries', 'Transport', 'Maintenance', 'Office Supplies', 'Marketing', 'Other'] } catch { return ['Rent', 'Utilities', 'Salaries', 'Transport', 'Maintenance', 'Office Supplies', 'Marketing', 'Other'] }
  })
  const [newCategory, setNewCategory] = useState('')
  const [users, setUsers] = useState([])
  const [shops, setShops] = useState([])
  const isSuperAdmin = session?.user?.email === 'afrith072@gmail.com'
  const [salesmen, setSalesmen] = useState([])
  const [userShops, setUserShops] = useState({})
  const [loading, setLoading] = useState(true)
  const [showUserForm, setShowUserForm] = useState(false)
  const [showShopForm, setShowShopForm] = useState(false)
  const [saving, setSaving] = useState(false)
  const [editUser, setEditUser] = useState(null)
  const [editShop, setEditShop] = useState(null)
  const [userForm, setUserForm] = useState({ email: '', password: '', full_name: '', role: 'cashier', phone: '', shop_ids: [], salesman_id: '' })
  const [shopForm, setShopForm] = useState({ name: '', address: '', phone: '' })

  useEffect(() => { fetchData() }, [])

  async function fetchData() {
    setLoading(true)
    try {
      const [{ data: profiles }, { data: sh }, { data: us }, { data: sm }] = await Promise.all([
        supabase.from('user_profiles').select('*').order('created_at', { ascending: false }),
        supabase.from('shops').select('*').order('name'),
        supabase.from('user_shops').select('*'),
        supabase.from('salesmen').select('*').order('name'),
      ])
      setUsers(profiles || [])
      setShops(sh || [])
      setSalesmen(sm || [])
      const map = {}
      for (const row of (us || [])) {
        if (!map[row.user_id]) map[row.user_id] = []
        map[row.user_id].push(row.shop_id)
      }
      setUserShops(map)
    } catch (e) {
      toast.error('Failed to load data')
    }
    setLoading(false)
  }

  // ── User management ──────────────────────────────────────
  function openNewUser() {
    setEditUser(null)
    setUserForm({ email: '', password: '', full_name: '', role: 'cashier', phone: '', shop_ids: [], salesman_id: '' })
    setShowUserForm(true)
  }

  function openEditUser(user) {
    setEditUser(user)
    // Find salesman linked to this user
    const linkedSalesman = salesmen.find(s => s.user_id === user.id)
    setUserForm({
      email: '',
      password: '',
      full_name: user.full_name || '',
      role: user.role || 'cashier',
      phone: user.phone || '',
      shop_ids: userShops[user.id] || [],
      salesman_id: linkedSalesman?.id || '',
    })
    setShowUserForm(true)
  }

  function toggleShop(shopId) {
    setUserForm(prev => ({
      ...prev,
      shop_ids: prev.shop_ids.includes(shopId)
        ? prev.shop_ids.filter(id => id !== shopId)
        : [...prev.shop_ids, shopId]
    }))
  }

  async function saveUser() {
    if (!editUser && !userForm.email) return toast.error('Email is required')
    if (!editUser && !userForm.password) return toast.error('Password is required')
    if (!editUser && userForm.password.length < 6) return toast.error('Password must be at least 6 characters')
    if (!userForm.full_name) return toast.error('Full name is required')
    setSaving(true)
    try {
      let userId = editUser?.id

      if (!editUser) {
        const { data, error } = await supabase.auth.signUp({
          email: userForm.email,
          password: userForm.password,
          options: { emailRedirectTo: window.location.origin }
        })
        if (error) throw error
        // user may be in data.user or data.session.user
        userId = data.user?.id || data.session?.user?.id
        if (!userId) throw new Error('User created but ID not returned. Check if email confirmation is disabled in Supabase.')
      }

      // Always upsert profile
      const { error: profileError } = await supabase.from('user_profiles').upsert({
        id: userId,
        full_name: userForm.full_name,
        role: userForm.role,
        phone: userForm.phone || null,
      }, { onConflict: 'id' })
      if (profileError) throw profileError

      // Update shop assignments
      await supabase.from('user_shops').delete().eq('user_id', userId)
      if (userForm.shop_ids.length > 0) {
        const { error: shopError } = await supabase.from('user_shops').insert(
          userForm.shop_ids.map(shop_id => ({ user_id: userId, shop_id }))
        )
        if (shopError) throw shopError
      }

      // Link salesman to this user — clear any previous link first, then set new one
      // First clear any salesman that was previously linked to this user
      await supabase.from('salesmen').update({ user_id: null }).eq('user_id', userId)
      // Then link the selected salesman (if any)
      if (userForm.salesman_id) {
        const { error: smError } = await supabase.from('salesmen')
          .update({ user_id: userId })
          .eq('id', userForm.salesman_id)
        if (smError) console.warn('Salesman link failed:', smError.message)
      }

      toast.success(editUser ? 'User updated!' : 'User created! They can now log in.')
      setShowUserForm(false)
      setEditUser(null)
      setUserForm({ email: '', password: '', full_name: '', role: 'cashier', phone: '', shop_ids: [], salesman_id: '' })
      fetchData()
    } catch (e) {
      toast.error('Failed: ' + e.message)
    }
    setSaving(false)
  }

  async function deleteUser(user) {
    if (!window.confirm(`Delete user "${user.full_name}"? This will fully remove them from the system and cannot be undone.`)) return
    try {
      // Unlink salesman
      await supabase.from('salesmen').update({ user_id: null }).eq('user_id', user.id)
      // Delete shop assignments
      await supabase.from('user_shops').delete().eq('user_id', user.id)
      // Delete profile
      await supabase.from('user_profiles').delete().eq('id', user.id)

      // Delete the auth user via secure Netlify function (service key stays server-side)
      try {
        const res = await fetch('/.netlify/functions/delete-user', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ userId: user.id }),
        })
        const result = await res.json()
        if (res.ok && result.success) {
          toast.success('User fully deleted!')
        } else {
          // Profile already deleted above — auth account may linger if function not configured
          toast.success('Profile deleted. ' + (result.error || 'Configure SUPABASE_SERVICE_KEY in Netlify to also remove the login.'))
        }
      } catch {
        toast.success('Profile deleted. Auth account removal requires the Netlify delete-user function to be deployed.')
      }
      fetchData()
    } catch (e) {
      toast.error('Failed to delete: ' + e.message)
    }
  }

  // ── Shop management ──────────────────────────────────────
  function saveCategories(cats) {
    setExpenseCategories(cats)
    localStorage.setItem('phonefix_expense_categories', JSON.stringify(cats))
  }
  function addCategory() {
    const c = newCategory.trim()
    if (!c) return
    if (expenseCategories.includes(c)) { toast.error('Category already exists'); return }
    saveCategories([...expenseCategories, c])
    setNewCategory('')
    toast.success(`Category "${c}" added`)
  }
  function removeCategory(c) {
    const defaults = ['Rent', 'Utilities', 'Salaries', 'Transport', 'Maintenance', 'Office Supplies', 'Marketing', 'Other']
    if (defaults.includes(c)) { toast.error('Cannot remove default categories'); return }
    saveCategories(expenseCategories.filter(x => x !== c))
  }

  function openNewShop() {
    setEditShop(null)
    setShopForm({ name: '', address: '', phone: '' })
    setShowShopForm(true)
  }

  function openEditShop(shop) {
    setEditShop(shop)
    setShopForm({ name: shop.name, address: shop.address || '', phone: shop.phone || '' })
    setShowShopForm(true)
  }

  async function saveShop() {
    if (!shopForm.name.trim()) return toast.error('Shop name is required')
    setSaving(true)
    try {
      if (editShop) {
        const { error } = await supabase.from('shops').update({
          name: shopForm.name, address: shopForm.address, phone: shopForm.phone
        }).eq('id', editShop.id)
        if (error) throw error
        toast.success('Shop updated!')
      } else {
        const { error } = await supabase.from('shops').insert({
          name: shopForm.name, address: shopForm.address, phone: shopForm.phone
        })
        if (error) throw error
        toast.success('Shop created!')
      }
      setShowShopForm(false)
      setEditShop(null)
      fetchData()
    } catch (e) {
      toast.error('Failed: ' + e.message)
    }
    setSaving(false)
  }

  async function deleteShop(shop) {
    if (!window.confirm(`Delete "${shop.name}"? Past invoices and purchases will be kept but unlinked from this shop. This cannot be undone.`)) return
    try {
      // 1. Remove user-shop assignments
      await supabase.from('user_shops').delete().eq('shop_id', shop.id)

      // 2. Null out shop_id on all linked records (keeps history, removes FK constraint)
      await supabase.from('invoices').update({ shop_id: null }).eq('shop_id', shop.id)
      await supabase.from('purchases').update({ shop_id: null }).eq('shop_id', shop.id)
      await supabase.from('purchase_returns').update({ shop_id: null }).eq('shop_id', shop.id)
      await supabase.from('sales_returns').update({ shop_id: null }).eq('shop_id', shop.id)
      await supabase.from('expenses').update({ shop_id: null }).eq('shop_id', shop.id)
      await supabase.from('stock_transfers').update({ shop_id: null }).eq('shop_id', shop.id)
      await supabase.from('inventory').update({ shop_id: null }).eq('shop_id', shop.id)
      await supabase.from('shift_records').update({ shop_id: null }).eq('shop_id', shop.id)
      await supabase.from('cash_deposits').update({ shop_id: null }).eq('shop_id', shop.id)
      await supabase.from('bank_transactions').update({ shop_id: null }).eq('shop_id', shop.id)

      // 3. Now delete the shop
      const { error } = await supabase.from('shops').delete().eq('id', shop.id)
      if (error) throw error

      toast.success(`Shop "${shop.name}" deleted`)
      fetchData()
    } catch (e) {
      toast.error('Failed to delete shop: ' + e.message)
    }
  }

  // ── Styles ────────────────────────────────────────────────
  const roleColors = {
    super_admin: { bg: '#f5f3ff', color: '#6d28d9' },
    manager: { bg: '#eff6ff', color: '#1d4ed8' },
    cashier: { bg: '#f0fdf4', color: '#166534' },
  }
  const roleLabels = { super_admin: 'Super Admin', manager: 'Manager', cashier: 'Cashier' }
  const inp = { width: '100%', padding: '9px 12px', border: '1.5px solid #e2e8f0', borderRadius: '7px', fontSize: '14px', boxSizing: 'border-box', outline: 'none', background: 'white' }
  const lbl = { display: 'block', marginBottom: '5px', fontSize: '11px', fontWeight: '700', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.06em' }
  const card = { background: 'white', borderRadius: '12px', padding: '24px', boxShadow: '0 1px 3px rgba(15,23,42,0.06), 0 1px 2px rgba(15,23,42,0.04)', marginBottom: '20px', border: '1px solid #f1f5f9' }

  async function fetchAdjHistory() {
    const { data, error } = await supabase.from('bank_transactions')
      .select('id, type, amount, notes, created_at')
      .eq('type', 'cash_adjustment')
      .order('created_at', { ascending: false })
      .limit(50)
    if (error) {
      toast.error('History load failed: ' + error.message)
      return
    }
    setAdjHistory(data || [])
  }

  async function doAdjustment() {
    if (!adjShopId) return toast.error('Select a shop')
    if (!adjAmount || parseFloat(adjAmount) <= 0) return toast.error('Enter a valid amount')
    if (!adjDesc.trim()) return toast.error('Description is required')
    setAdjSaving(true)
    try {
      const amt = parseFloat(adjAmount)
      const delta = adjType === 'add' ? amt : -amt
      const { data: shop } = await supabase.from('shops').select('cash_in_hand').eq('id', adjShopId).single()
      const newCash = Math.max(0, (shop?.cash_in_hand || 0) + delta)
      await supabase.from('shops').update({ cash_in_hand: newCash }).eq('id', adjShopId)
      const { error: insErr } = await supabase.from('bank_transactions').insert({
        type: 'cash_adjustment',
        amount: amt,
        shop_id: adjShopId,
        notes: `[${adjType === 'add' ? '+' : '-'}] ${adjDesc.trim()}`,
        reference: `Cash ${adjType === 'add' ? 'addition' : 'deduction'} by superadmin`,
      })
      if (insErr) { toast.error('Insert failed: ' + insErr.message); setAdjSaving(false); return }
      toast.success(`Cash ${adjType === 'add' ? 'added' : 'deducted'}: LKR ${amt.toLocaleString('en-LK', { minimumFractionDigits: 2 })}`)
      setAdjAmount(''); setAdjDesc('')
      fetchAdjHistory()
    } catch (e) { toast.error('Failed: ' + e.message) }
    setAdjSaving(false)
  }

  return (
    <div>
      <div style={{ marginBottom: '24px' }}>
        <h1 style={{ fontSize: '22px', fontWeight: '700', color: '#0f172a', margin: '0 0 4px' }}>Settings</h1>
        <p style={{ color: '#64748b', fontSize: '14px', margin: 0 }}>Manage users, shops and system configuration</p>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: '4px', marginBottom: '24px', background: '#f1f5f9', padding: '4px', borderRadius: '10px', width: 'fit-content' }}>
        {[{ id: 'users', label: '👥 Users' }, { id: 'shops', label: '🏪 Shops' }, { id: 'categories', label: '🏷 Expense Categories' }, ...(isSuperAdmin ? [{ id: 'cash_adjustment', label: '💵 Cash Adjustment' }] : [])].map(tab => (
          <button key={tab.id} onClick={() => { setActiveTab(tab.id); if (tab.id === 'cash_adjustment') setTimeout(fetchAdjHistory, 50) }}
            style={{ padding: '8px 20px', borderRadius: '10px', border: 'none', cursor: 'pointer', fontSize: '14px', fontWeight: '600', background: activeTab === tab.id ? 'white' : 'transparent', color: activeTab === tab.id ? '#0f172a' : '#64748b', boxShadow: activeTab === tab.id ? '0 1px 3px rgba(0,0,0,0.1)' : 'none', transition: 'all 0.15s' }}>
            {tab.label}
          </button>
        ))}
      </div>

      {/* ── USERS TAB ── */}
      {activeTab === 'users' && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
            <div>
              <h2 style={{ fontSize: '16px', fontWeight: '700', color: '#0f172a', margin: '0 0 2px' }}>System Users</h2>
              <p style={{ color: '#64748b', fontSize: '13px', margin: 0 }}>{users.length} users registered</p>
            </div>
            <button onClick={openNewUser}
              style={{ padding: '10px 20px', background: 'linear-gradient(135deg,#2563eb,#1d4ed8)', color: 'white', border: 'none', borderRadius: '10px', cursor: 'pointer', fontWeight: '700', fontSize: '14px' }}>
              + New User
            </button>
          </div>

          {/* Role guide */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: '12px', marginBottom: '20px' }}>
            {[
              { role: 'super_admin', label: 'Super Admin', desc: 'Full access to everything across all shops.' },
              { role: 'manager', label: 'Manager', desc: 'Reports, inventory and customers for assigned shops.' },
              { role: 'cashier', label: 'Cashier', desc: 'Create invoices and process sales for assigned shops.' },
            ].map(r => {
              const rc = roleColors[r.role]
              return (
                <div key={r.role} style={{ background: rc.bg, borderRadius: '10px', padding: '14px 16px', border: `1px solid ${rc.color}22` }}>
                  <div style={{ fontSize: '13px', fontWeight: '700', color: rc.color, marginBottom: '4px' }}>{r.label}</div>
                  <div style={{ fontSize: '12px', color: '#64748b', lineHeight: '1.5' }}>{r.desc}</div>
                </div>
              )
            })}
          </div>

          {/* User form */}
          {showUserForm && (
            <div style={card}>
              <h3 style={{ margin: '0 0 20px', fontSize: '16px', fontWeight: '700', color: '#0f172a' }}>
                {editUser ? 'Edit User' : 'New User'}
              </h3>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '16px' }}>
                <div>
                  <label style={lbl}>Full Name *</label>
                  <input type="text" value={userForm.full_name} onChange={e => setUserForm(p => ({ ...p, full_name: e.target.value }))} placeholder="Enter full name" style={inp} />
                </div>
                <div>
                  <label style={lbl}>Phone</label>
                  <input type="text" value={userForm.phone} onChange={e => setUserForm(p => ({ ...p, phone: e.target.value }))} placeholder="07X XXXXXXX" style={inp} />
                </div>
                {!editUser && (
                  <>
                    <div>
                      <label style={lbl}>Email *</label>
                      <input type="email" value={userForm.email} onChange={e => setUserForm(p => ({ ...p, email: e.target.value }))} placeholder="user@example.com" style={inp} />
                    </div>
                    <div>
                      <label style={lbl}>Password *</label>
                      <input type="password" value={userForm.password} onChange={e => setUserForm(p => ({ ...p, password: e.target.value }))} placeholder="Min 6 characters" style={inp} />
                    </div>
                  </>
                )}
                <div>
                  <label style={lbl}>Role *</label>
                  <select value={userForm.role} onChange={e => setUserForm(p => ({ ...p, role: e.target.value }))} style={inp}>
                    <option value="cashier">Cashier</option>
                    <option value="manager">Manager</option>
                    <option value="super_admin">Super Admin</option>
                  </select>
                </div>
                <div>
                  <label style={lbl}>Linked Salesman</label>
                  <select value={userForm.salesman_id} onChange={e => setUserForm(p => ({ ...p, salesman_id: e.target.value }))} style={inp}>
                    <option value="">— No salesman linked —</option>
                    {salesmen.map(s => (
                      <option key={s.id} value={s.id}>
                        {s.salesman_no} · {s.name}{s.user_id && s.user_id !== editUser?.id ? ' (already linked)' : ''}
                      </option>
                    ))}
                  </select>
                  <div style={{ fontSize: '11px', color: '#94a3b8', marginTop: '4px' }}>
                    When this user logs in, their name will auto-fill as salesman on new invoices
                  </div>
                </div>
              </div>

              {/* Shop assignment checkboxes */}
              <div style={{ marginBottom: '20px' }}>
                <label style={{ ...lbl, marginBottom: '10px' }}>Assigned Shops</label>
                {userForm.role === 'super_admin' ? (
                  <div style={{ padding: '12px 14px', background: '#f5f3ff', borderRadius: '10px', border: '1px solid #e9d5ff', fontSize: '13px', color: '#6d28d9', fontWeight: '600' }}>
                    Super Admins have access to all shops automatically
                  </div>
                ) : (
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '10px' }}>
                    {shops.map(shop => (
                      <label key={shop.id}
                        style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '12px 14px', background: userForm.shop_ids.includes(shop.id) ? '#eef2ff' : '#f8fafc', borderRadius: '10px', border: `1.5px solid ${userForm.shop_ids.includes(shop.id) ? '#2563eb' : '#e2e8f0'}`, cursor: 'pointer', transition: 'all 0.15s' }}>
                        <input type="checkbox" checked={userForm.shop_ids.includes(shop.id)} onChange={() => toggleShop(shop.id)}
                          style={{ width: '16px', height: '16px', cursor: 'pointer', accentColor: '#2563eb' }} />
                        <div>
                          <div style={{ fontSize: '13px', fontWeight: '700', color: '#0f172a' }}>{shop.name}</div>
                          {shop.address && <div style={{ fontSize: '11px', color: '#94a3b8' }}>{shop.address}</div>}
                        </div>
                      </label>
                    ))}
                  </div>
                )}
              </div>

              <div style={{ display: 'flex', gap: '10px' }}>
                <button onClick={saveUser} disabled={saving}
                  style={{ padding: '10px 24px', background: 'linear-gradient(135deg,#2563eb,#1d4ed8)', color: 'white', border: 'none', borderRadius: '10px', cursor: 'pointer', fontWeight: '700', fontSize: '14px' }}>
                  {saving ? 'Saving...' : editUser ? 'Update User' : 'Create User'}
                </button>
                <button onClick={() => { setShowUserForm(false); setEditUser(null) }}
                  style={{ padding: '10px 20px', background: '#f1f5f9', color: '#64748b', border: 'none', borderRadius: '10px', cursor: 'pointer', fontWeight: '600', fontSize: '14px' }}>
                  Cancel
                </button>
              </div>
            </div>
          )}

          {/* Users table */}
          <div style={{ background: 'white', borderRadius: '12px', boxShadow: '0 1px 3px rgba(15,23,42,0.06), 0 1px 2px rgba(15,23,42,0.04)', overflow: 'hidden' }}>
            {loading ? (
              <div style={{ padding: '60px', textAlign: 'center', color: '#94a3b8' }}>Loading...</div>
            ) : users.length === 0 ? (
              <div style={{ padding: '60px', textAlign: 'center', color: '#94a3b8' }}>
                <div style={{ fontSize: '36px', marginBottom: '12px' }}>👥</div>
                No users yet
              </div>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ background: '#f8fafc', borderBottom: '2px solid #e2e8f0' }}>
                    {['Name', 'Role', 'Salesman', 'Assigned Shops', 'Phone', 'Actions'].map(h => (
                      <th key={h} style={{ padding: '11px 16px', textAlign: 'left', fontSize: '11px', fontWeight: '700', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {users.map((user, i) => {
                    const rc = roleColors[user.role] || roleColors.cashier
                    const isSelf = user.id === session.user.id
                    const assignedShopIds = userShops[user.id] || []
                    const assignedShopNames = shops.filter(s => assignedShopIds.includes(s.id)).map(s => s.name)
                    return (
                      <tr key={user.id} style={{ borderBottom: '1px solid #f1f5f9', background: i % 2 === 0 ? 'white' : '#fafafa' }}
                        onMouseEnter={e => e.currentTarget.style.background = '#f0f9ff'}
                        onMouseLeave={e => e.currentTarget.style.background = i % 2 === 0 ? 'white' : '#fafafa'}>
                        <td style={{ padding: '12px 16px' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                            <div style={{ width: '32px', height: '32px', borderRadius: '50%', background: 'linear-gradient(135deg,#2563eb,#1d4ed8)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontWeight: '700', fontSize: '13px', flexShrink: 0 }}>
                              {(user.full_name || '?')[0].toUpperCase()}
                            </div>
                            <div>
                              <div style={{ fontSize: '14px', fontWeight: '600', color: '#0f172a' }}>
                                {user.full_name || 'Unnamed'}
                                {isSelf && <span style={{ marginLeft: '6px', fontSize: '11px', background: '#eef2ff', color: '#2563eb', padding: '1px 6px', borderRadius: '10px', fontWeight: '700' }}>You</span>}
                              </div>
                            </div>
                          </div>
                        </td>
                        <td style={{ padding: '12px 16px' }}>
                          <span style={{ background: rc.bg, color: rc.color, padding: '4px 10px', borderRadius: '20px', fontSize: '12px', fontWeight: '700' }}>
                            {roleLabels[user.role] || user.role}
                          </span>
                        </td>
                        <td style={{ padding: '12px 16px' }}>
                          {(() => {
                            const linked = salesmen.find(s => s.user_id === user.id)
                            return linked
                              ? <span style={{ background: '#f0fdf4', color: '#166534', padding: '3px 10px', borderRadius: '12px', fontSize: '12px', fontWeight: '700' }}>👤 {linked.name}</span>
                              : <span style={{ fontSize: '12px', color: '#94a3b8' }}>—</span>
                          })()}
                        </td>
                        <td style={{ padding: '12px 16px' }}>
                          {user.role === 'super_admin' ? (
                            <span style={{ fontSize: '12px', color: '#6d28d9', fontWeight: '600', fontStyle: 'italic' }}>All shops</span>
                          ) : assignedShopNames.length === 0 ? (
                            <span style={{ fontSize: '12px', color: '#e11d48', fontWeight: '600' }}>None assigned</span>
                          ) : (
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                              {assignedShopNames.map(name => (
                                <span key={name} style={{ background: '#eef2ff', color: '#1e40af', padding: '2px 8px', borderRadius: '12px', fontSize: '12px', fontWeight: '600' }}>{name}</span>
                              ))}
                            </div>
                          )}
                        </td>
                        <td style={{ padding: '12px 16px', fontSize: '13px', color: '#64748b' }}>{user.phone || '—'}</td>
                        <td style={{ padding: '12px 16px' }}>
                          <div style={{ display: 'flex', gap: '6px' }}>
                            <button onClick={() => openEditUser(user)}
                              style={{ padding: '5px 14px', background: '#eef2ff', color: '#2563eb', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '12px', fontWeight: '700' }}>
                              Edit
                            </button>
                            {!isSelf && (
                              <button onClick={() => deleteUser(user)}
                                style={{ padding: '5px 10px', background: '#fee2e2', color: '#dc2626', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '12px', fontWeight: '700' }}>
                                Delete
                              </button>
                            )}
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
      )}

      {/* ── SHOPS TAB ── */}
      {activeTab === 'shops' && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
            <div>
              <h2 style={{ fontSize: '16px', fontWeight: '700', color: '#0f172a', margin: '0 0 2px' }}>Shops</h2>
              <p style={{ color: '#64748b', fontSize: '13px', margin: 0 }}>{shops.length} shops registered</p>
            </div>
            <button onClick={openNewShop}
              style={{ padding: '10px 20px', background: 'linear-gradient(135deg,#2563eb,#1d4ed8)', color: 'white', border: 'none', borderRadius: '10px', cursor: 'pointer', fontWeight: '700', fontSize: '14px' }}>
              + New Shop
            </button>
          </div>

          {/* Shop form */}
          {showShopForm && (
            <div style={card}>
              <h3 style={{ margin: '0 0 20px', fontSize: '16px', fontWeight: '700', color: '#0f172a' }}>
                {editShop ? 'Edit Shop' : 'New Shop'}
              </h3>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '20px' }}>
                <div style={{ gridColumn: '1/-1' }}>
                  <label style={lbl}>Shop Name *</label>
                  <input type="text" value={shopForm.name} onChange={e => setShopForm(p => ({ ...p, name: e.target.value }))} placeholder="e.g. Phonefix - Colombo" style={inp} />
                </div>
                <div>
                  <label style={lbl}>Address</label>
                  <input type="text" value={shopForm.address} onChange={e => setShopForm(p => ({ ...p, address: e.target.value }))} placeholder="Shop address" style={inp} />
                </div>
                <div>
                  <label style={lbl}>Phone</label>
                  <input type="text" value={shopForm.phone} onChange={e => setShopForm(p => ({ ...p, phone: e.target.value }))} placeholder="031 XXXXXXX" style={inp} />
                </div>
              </div>
              <div style={{ display: 'flex', gap: '10px' }}>
                <button onClick={saveShop} disabled={saving}
                  style={{ padding: '10px 24px', background: 'linear-gradient(135deg,#2563eb,#1d4ed8)', color: 'white', border: 'none', borderRadius: '10px', cursor: 'pointer', fontWeight: '700', fontSize: '14px' }}>
                  {saving ? 'Saving...' : editShop ? 'Update Shop' : 'Create Shop'}
                </button>
                <button onClick={() => { setShowShopForm(false); setEditShop(null) }}
                  style={{ padding: '10px 20px', background: '#f1f5f9', color: '#64748b', border: 'none', borderRadius: '10px', cursor: 'pointer', fontWeight: '600', fontSize: '14px' }}>
                  Cancel
                </button>
              </div>
            </div>
          )}

          {/* Shops grid */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '16px' }}>
            {shops.map(shop => {
              const assignedUsers = users.filter(u => (userShops[u.id] || []).includes(shop.id))
              return (
                <div key={shop.id} style={{ background: 'white', borderRadius: '12px', padding: '20px', boxShadow: '0 1px 3px rgba(15,23,42,0.06), 0 1px 2px rgba(15,23,42,0.04)', border: '1px solid #f1f5f9' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '12px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                      <div style={{ width: '40px', height: '40px', background: 'linear-gradient(135deg,#2563eb,#1d4ed8)', borderRadius: '10px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '18px', flexShrink: 0 }}>🏪</div>
                      <div>
                        <div style={{ fontSize: '15px', fontWeight: '700', color: '#0f172a' }}>{shop.name}</div>
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: '6px' }}>
                      <button onClick={() => openEditShop(shop)}
                        style={{ padding: '4px 12px', background: '#eef2ff', color: '#2563eb', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '12px', fontWeight: '700' }}>
                        Edit
                      </button>
                      <button onClick={() => deleteShop(shop)}
                        style={{ padding: '4px 12px', background: '#fee2e2', color: '#dc2626', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '12px', fontWeight: '700' }}>
                        Delete
                      </button>
                    </div>
                  </div>

                  {shop.address && <div style={{ fontSize: '13px', color: '#64748b', marginBottom: '4px' }}>📍 {shop.address}</div>}
                  {shop.phone && <div style={{ fontSize: '13px', color: '#64748b', marginBottom: '12px' }}>📞 {shop.phone}</div>}

                  <div style={{ paddingTop: '12px', borderTop: '1px solid #f1f5f9' }}>
                    <div style={{ fontSize: '11px', fontWeight: '700', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '6px' }}>
                      {assignedUsers.length} Assigned User{assignedUsers.length !== 1 ? 's' : ''}
                    </div>
                    {assignedUsers.length > 0 ? (
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                        {assignedUsers.map(u => (
                          <span key={u.id} style={{ background: '#f1f5f9', color: '#475569', padding: '2px 8px', borderRadius: '12px', fontSize: '12px', fontWeight: '600' }}>
                            {u.full_name || 'Unnamed'}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <span style={{ fontSize: '12px', color: '#94a3b8', fontStyle: 'italic' }}>No users assigned</span>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {activeTab === 'categories' && (
        <div style={{ maxWidth: '600px' }}>
          <div style={{ background: 'white', borderRadius: '12px', padding: '24px', boxShadow: '0 1px 3px rgba(15,23,42,0.06), 0 1px 2px rgba(15,23,42,0.04)' }}>
            <h2 style={{ fontSize: '16px', fontWeight: '700', color: '#0f172a', margin: '0 0 6px' }}>Expense Categories</h2>
            <p style={{ fontSize: '13px', color: '#64748b', margin: '0 0 20px' }}>Add custom categories for expenses. Defaults cannot be removed.</p>
            <div style={{ display: 'flex', gap: '8px', marginBottom: '20px' }}>
              <input type="text" value={newCategory} onChange={e => setNewCategory(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && addCategory()}
                placeholder="New category name…"
                style={{ flex: 1, padding: '9px 12px', border: '1.5px solid #e2e8f0', borderRadius: '7px', fontSize: '14px', outline: 'none' }} />
              <button onClick={addCategory}
                style={{ padding: '9px 20px', background: 'linear-gradient(135deg,#2563eb,#1d4ed8)', color: 'white', border: 'none', borderRadius: '7px', cursor: 'pointer', fontWeight: '700', fontSize: '14px' }}>
                Add
              </button>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
              {expenseCategories.map(c => {
                const isDefault = ['Rent','Utilities','Salaries','Transport','Maintenance','Office Supplies','Marketing','Other'].includes(c)
                return (
                  <span key={c} style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', background: isDefault ? '#f1f5f9' : '#eef2ff', color: isDefault ? '#475569' : '#1e40af', padding: '5px 12px', borderRadius: '20px', fontSize: '13px', fontWeight: '600' }}>
                    {c}
                    {!isDefault && (
                      <button onClick={() => removeCategory(c)}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#e11d48', fontSize: '14px', padding: '0', lineHeight: 1, fontWeight: '700' }}>×</button>
                    )}
                  </span>
                )
              })}
            </div>
          </div>
        </div>
      )}

      {/* ── CASH ADJUSTMENT TAB ── */}
      {activeTab === 'cash_adjustment' && isSuperAdmin && (
        <div key="cash-adj-tab">
          <div style={{ background: 'white', borderRadius: '12px', boxShadow: '0 1px 3px rgba(15,23,42,0.06), 0 1px 2px rgba(15,23,42,0.04)', padding: '24px', marginBottom: '20px' }}>
            <h2 style={{ fontSize: '16px', fontWeight: '700', color: '#0f172a', margin: '0 0 6px' }}>Manual Cash Adjustment</h2>
            <p style={{ fontSize: '13px', color: '#64748b', margin: '0 0 20px' }}>Adjust the cash in hand balance for a shop. Use this to correct discrepancies. All adjustments are logged.</p>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '16px' }}>
              <div>
                <label style={{ display: 'block', fontSize: '11px', fontWeight: '700', color: '#94a3b8', textTransform: 'uppercase', marginBottom: '6px' }}>Shop</label>
                <select value={adjShopId} onChange={e => setAdjShopId(e.target.value)}
                  style={{ width: '100%', padding: '9px 12px', border: '1.5px solid #e2e8f0', borderRadius: '10px', fontSize: '14px', outline: 'none' }}>
                  <option value="">— Select Shop —</option>
                  {shops.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '11px', fontWeight: '700', color: '#94a3b8', textTransform: 'uppercase', marginBottom: '6px' }}>Adjustment Type</label>
                <div style={{ display: 'flex', gap: '8px' }}>
                  {[{ id: 'add', label: '+ Add Cash', color: '#059669', bg: '#f0fdf4', border: '#86efac' }, { id: 'subtract', label: '− Deduct Cash', color: '#dc2626', bg: '#fff5f5', border: '#fca5a5' }].map(t => (
                    <button key={t.id} onClick={() => setAdjType(t.id)}
                      style={{ flex: 1, padding: '9px', border: `2px solid ${adjType === t.id ? t.border : '#e2e8f0'}`, borderRadius: '10px', cursor: 'pointer', fontWeight: '700', fontSize: '13px', background: adjType === t.id ? t.bg : 'white', color: adjType === t.id ? t.color : '#94a3b8', transition: 'all 0.15s' }}>
                      {t.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: '16px', marginBottom: '16px' }}>
              <div>
                <label style={{ display: 'block', fontSize: '11px', fontWeight: '700', color: '#94a3b8', textTransform: 'uppercase', marginBottom: '6px' }}>Amount (LKR)</label>
                <input type="number" value={adjAmount} onChange={e => setAdjAmount(e.target.value)} min="0" step="0.01" placeholder="0.00"
                  style={{ width: '100%', padding: '9px 12px', border: '1.5px solid #e2e8f0', borderRadius: '10px', fontSize: '14px', fontWeight: '700', outline: 'none' }} />
              </div>
              <div>
                <label style={{ display: 'block', fontSize: '11px', fontWeight: '700', color: '#94a3b8', textTransform: 'uppercase', marginBottom: '6px' }}>Description <span style={{ color: '#e11d48' }}>*</span></label>
                <input type="text" value={adjDesc} onChange={e => setAdjDesc(e.target.value)} placeholder="Reason for adjustment (required)"
                  style={{ width: '100%', padding: '9px 12px', border: `1.5px solid ${!adjDesc.trim() && adjAmount ? '#fca5a5' : '#e2e8f0'}`, borderRadius: '10px', fontSize: '14px', outline: 'none' }} />
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <button onClick={doAdjustment} disabled={adjSaving || !adjShopId || !adjAmount || !adjDesc.trim()}
                style={{ padding: '10px 24px', background: adjSaving || !adjShopId || !adjAmount || !adjDesc.trim() ? '#e2e8f0' : adjType === 'add' ? 'linear-gradient(135deg,#059669,#047857)' : 'linear-gradient(135deg,#dc2626,#b91c1c)', color: adjSaving || !adjShopId || !adjAmount || !adjDesc.trim() ? '#94a3b8' : 'white', border: 'none', borderRadius: '10px', cursor: 'pointer', fontWeight: '700', fontSize: '14px' }}>
                {adjSaving ? 'Saving...' : `Apply ${adjType === 'add' ? 'Addition' : 'Deduction'}`}
              </button>
              <span style={{ fontSize: '12px', color: '#94a3b8' }}>⚠️ This directly modifies the shop's cash in hand balance</span>
            </div>
          </div>

          {/* Adjustment History */}
          <div style={{ background: 'white', borderRadius: '12px', boxShadow: '0 1px 3px rgba(15,23,42,0.06), 0 1px 2px rgba(15,23,42,0.04)', overflow: 'hidden' }}>
            <div style={{ padding: '14px 20px', borderBottom: '1px solid #f1f5f9', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ fontSize: '14px', fontWeight: '700', color: '#0f172a', margin: 0 }}>Adjustment History</h3>
              <button onClick={fetchAdjHistory} style={{ background: '#f1f5f9', border: 'none', borderRadius: '6px', padding: '5px 12px', cursor: 'pointer', fontSize: '12px', fontWeight: '600', color: '#64748b' }}>↺ Refresh</button>
            </div>
            {adjHistory.length === 0 ? (
              <div style={{ padding: '32px', textAlign: 'center', color: '#94a3b8' }}>No adjustments recorded yet</div>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ background: '#f8fafc' }}>
                    {['Date & Time', 'Shop', 'Type', 'Amount', 'Description'].map(h => (
                      <th key={h} style={{ padding: '10px 16px', textAlign: 'left', fontSize: '11px', fontWeight: '700', color: '#94a3b8', textTransform: 'uppercase' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {adjHistory.map((a, i) => {
                    const isAdd = a.notes?.startsWith('[+]')
                    return (
                      <tr key={a.id} style={{ borderBottom: '1px solid #f1f5f9', background: i % 2 === 0 ? 'white' : '#fafafa' }}>
                        <td style={{ padding: '10px 16px', fontSize: '13px', color: '#64748b' }}>{new Date(a.created_at).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</td>
                        <td style={{ padding: '10px 16px', fontSize: '13px', color: '#0f172a', fontWeight: '600' }}>{a.reference?.replace('Cash addition by superadmin','Addition').replace('Cash deduction by superadmin','Deduction') || '—'}</td>
                        <td style={{ padding: '10px 16px' }}>
                          <span style={{ padding: '2px 10px', borderRadius: '12px', fontSize: '11px', fontWeight: '700', background: isAdd ? '#f0fdf4' : '#fff5f5', color: isAdd ? '#059669' : '#dc2626' }}>
                            {isAdd ? '+ Addition' : '− Deduction'}
                          </span>
                        </td>
                        <td style={{ padding: '10px 16px', fontSize: '13px', fontWeight: '800', color: isAdd ? '#059669' : '#dc2626' }}>
                          {isAdd ? '+' : '-'} LKR {(a.amount || 0).toLocaleString('en-LK', { minimumFractionDigits: 2 })}
                        </td>
                        <td style={{ padding: '10px 16px', fontSize: '13px', color: '#0f172a' }}>{a.notes?.replace('[+] ', '').replace('[-] ', '') || '—'}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
