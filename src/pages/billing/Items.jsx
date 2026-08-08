import { useState, useEffect } from 'react'
import { supabase } from '../../supabase'
import { generateItemNo, formatCurrency } from '../../lib/helpers'
import toast from 'react-hot-toast'

export default function Items({ isCashier = false }) {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [saving, setSaving] = useState(false)
  const [editItem, setEditItem] = useState(null)
  const [suppliers, setSuppliers] = useState([])
  const [brands, setBrands] = useState([])
  const [categories, setCategories] = useState([])
  const [form, setForm] = useState({ name: '', selling_price: '', cost_price: '', last_price: '', warranty_available: false, supplier_id: '', brand_id: '', category_id: '' })
  const [showNewBrand, setShowNewBrand] = useState(false)
  const [newBrandName, setNewBrandName] = useState('')
  const [showNewCategory, setShowNewCategory] = useState(false)
  const [newCategoryName, setNewCategoryName] = useState('')
  const [newCategoryParent, setNewCategoryParent] = useState('')

  useEffect(() => { fetchItems(); fetchSuppliers(); fetchBrandsAndCategories() }, [])

  async function fetchBrandsAndCategories() {
    const [{ data: b }, { data: c }] = await Promise.all([
      supabase.from('brands').select('*').order('name'),
      supabase.from('categories').select('*').order('name'),
    ])
    setBrands(b || [])
    setCategories(c || [])
  }

  // Top-level categories first, each followed by its subcategories — used to build
  // an indented dropdown so the hierarchy is visually clear.
  function categoryOptions() {
    const topLevel = categories.filter(c => !c.parent_category_id)
    const opts = []
    topLevel.forEach(top => {
      opts.push({ ...top, depth: 0 })
      categories.filter(c => c.parent_category_id === top.id).forEach(sub => {
        opts.push({ ...sub, depth: 1 })
      })
    })
    return opts
  }

  async function saveNewBrand() {
    if (!newBrandName.trim()) return toast.error('Brand name is required')
    const { data, error } = await supabase.from('brands').insert({ name: newBrandName.trim() }).select().single()
    if (error) return toast.error(error.code === '23505' ? 'That brand already exists' : 'Failed to add brand')
    setBrands(prev => [...prev, data].sort((a, b) => a.name.localeCompare(b.name)))
    setForm(p => ({ ...p, brand_id: data.id }))
    setNewBrandName('')
    setShowNewBrand(false)
    toast.success('Brand added!')
  }

  async function saveNewCategory() {
    if (!newCategoryName.trim()) return toast.error('Category name is required')
    const { data, error } = await supabase.from('categories').insert({
      name: newCategoryName.trim(),
      parent_category_id: newCategoryParent || null,
    }).select().single()
    if (error) return toast.error(error.code === '23505' ? 'That category already exists under this parent' : 'Failed to add category')
    setCategories(prev => [...prev, data])
    setForm(p => ({ ...p, category_id: data.id }))
    setNewCategoryName('')
    setNewCategoryParent('')
    setShowNewCategory(false)
    toast.success('Category added!')
  }

  async function fetchSuppliers() {
    const { data } = await supabase.from('suppliers').select('id, name').order('name')
    setSuppliers(data || [])
  }

  async function fetchItems() {
    setLoading(true)
    const { data, error } = await supabase
      .from('items')
      .select('*, suppliers(name), brands(name), categories(name, parent_category_id)')
      .order('item_no', { ascending: true })
    if (error) toast.error('Failed to load items')
    else setItems(data || [])
    setLoading(false)
  }

  function openEdit(item) {
    setEditItem(item)
    setForm({
      name: item.name,
      selling_price: item.selling_price,
      cost_price: item.cost_price,
      last_price: item.last_price || '',
      warranty_available: item.warranty_available,
      supplier_id: item.supplier_id || '',
      brand_id: item.brand_id || '',
      category_id: item.category_id || '',
    })
    setShowForm(true)
  }

  function openNew() {
    setEditItem(null)
    setForm({ name: '', selling_price: '', cost_price: '', last_price: '', warranty_available: false, supplier_id: '', brand_id: '', category_id: '' })
    setShowForm(true)
  }

  async function handleSave() {
    if (!form.name.trim()) return toast.error('Item name is required')
    if (!form.selling_price) return toast.error('Selling price is required')
    setSaving(true)
    try {
      if (editItem) {
        const { error } = await supabase.from('items').update({
          name: form.name,
          selling_price: parseFloat(form.selling_price),
          cost_price: parseFloat(form.cost_price) || 0,
          last_price: parseFloat(form.last_price) || 0,
          warranty_available: form.warranty_available,
          supplier_id: form.supplier_id || null,
          brand_id: form.brand_id || null,
          category_id: form.category_id || null,
        }).eq('id', editItem.id)
        if (error) throw error
        toast.success('Item updated!')
      } else {
        const item_no = await generateItemNo()
        const { error } = await supabase.from('items').insert({
          item_no,
          name: form.name,
          selling_price: parseFloat(form.selling_price),
          cost_price: parseFloat(form.cost_price) || 0,
          last_price: parseFloat(form.last_price) || 0,
          warranty_available: form.warranty_available,
          supplier_id: form.supplier_id || null,
          brand_id: form.brand_id || null,
          category_id: form.category_id || null,
        })
        if (error) throw error
        toast.success('Item created!')
      }
      setShowForm(false)
      setEditItem(null)
      fetchItems()
    } catch (e) {
      toast.error('Failed to save item: ' + e.message)
    }
    setSaving(false)
  }

  const filtered = items.filter(i =>
    i.name.toLowerCase().includes(search.toLowerCase()) ||
    i.item_no.toLowerCase().includes(search.toLowerCase()) ||
    i.brands?.name?.toLowerCase().includes(search.toLowerCase()) ||
    i.categories?.name?.toLowerCase().includes(search.toLowerCase())
  )

  const margin = (item) => {
    if (!item.cost_price || item.cost_price === 0) return null
    return (((item.selling_price - item.cost_price) / item.cost_price) * 100).toFixed(1)
  }

  const inp = { width: '100%', padding: '9px 12px', border: '1.5px solid #e2e8f0', borderRadius: '7px', fontSize: '14px', boxSizing: 'border-box', outline: 'none', background: 'white' }
  const lbl = { display: 'block', marginBottom: '5px', fontSize: '11px', fontWeight: '700', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.06em' }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '24px' }}>
        <div>
          <h1 style={{ fontSize: '22px', fontWeight: '700', color: '#0f172a', margin: '0 0 4px' }}>Items</h1>
          <p style={{ color: '#64748b', fontSize: '14px', margin: 0 }}>{items.length} total items</p>
        </div>
        <button onClick={openNew}
          style={{ padding: '10px 24px', background: 'linear-gradient(135deg,#2563eb,#1d4ed8)', color: 'white', border: 'none', borderRadius: '10px', cursor: 'pointer', fontWeight: '700', fontSize: '14px' }}>
          + New Item
        </button>
      </div>

      {/* Summary cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '16px', marginBottom: '24px' }}>
        {[
          { label: 'Total Items', value: items.length, color: '#1e40af' },
          { label: 'Avg Selling Price', value: formatCurrency(items.length ? items.reduce((s, i) => s + i.selling_price, 0) / items.length : 0), color: '#059669' },
          { label: 'With Warranty', value: items.filter(i => i.warranty_available).length, color: '#d97706' },
        ].map(s => (
          <div key={s.label} style={{ background: 'white', borderRadius: '12px', padding: '20px', boxShadow: '0 1px 3px rgba(15,23,42,0.06), 0 1px 2px rgba(15,23,42,0.04)', borderLeft: `4px solid ${s.color}` }}>
            <div style={{ fontSize: '12px', fontWeight: '700', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '6px' }}>{s.label}</div>
            <div style={{ fontSize: '22px', fontWeight: '800', color: s.color }}>{s.value}</div>
          </div>
        ))}
      </div>

      {/* Form */}
      {showForm && (
        <div style={{ background: 'white', borderRadius: '12px', padding: '24px', boxShadow: '0 1px 3px rgba(15,23,42,0.06), 0 1px 2px rgba(15,23,42,0.04)', marginBottom: '20px', border: '1px solid #f1f5f9' }}>
          <h3 style={{ margin: '0 0 20px', fontSize: '16px', fontWeight: '700', color: '#0f172a' }}>
            {editItem ? 'Edit Item' : 'New Item'}
          </h3>
          <div style={{ display: 'grid', gridTemplateColumns: isCashier ? '2fr 1fr' : '2fr 1fr 1fr 1fr', gap: '16px', marginBottom: '16px' }}>
            <div>
              <label style={lbl}>Item Name *</label>
              <input type="text" value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} placeholder="Enter item name" style={inp} autoFocus />
            </div>
            {!isCashier && (
              <div>
                <label style={lbl}>Cost Price (LKR)</label>
                <input type="number" value={form.cost_price} onChange={e => setForm(p => ({ ...p, cost_price: e.target.value }))} placeholder="0" min="0" step="1" style={inp} />
              </div>
            )}
            <div>
              <label style={lbl}>Selling Price (LKR) *</label>
              <input type="number" value={form.selling_price} onChange={e => setForm(p => ({ ...p, selling_price: e.target.value }))} placeholder="0" min="0" step="1" style={inp} />
            </div>
            {!isCashier && (
              <div>
                <label style={lbl}>Last Price (Min Floor) <span style={{ color: '#d97706', fontWeight: '400', fontSize: '10px', textTransform: 'none' }}>— blocks invoices below this</span></label>
                <input type="number" value={form.last_price} onChange={e => setForm(p => ({ ...p, last_price: e.target.value }))} placeholder="0" min="0" step="1" style={{ ...inp, borderColor: form.last_price ? '#fde68a' : '#e2e8f0' }} />
              </div>
            )}
          </div>
          {!isCashier && (
            <div style={{ marginBottom: '16px' }}>
              <label style={lbl}>Supplier</label>
              <select value={form.supplier_id} onChange={e => setForm(p => ({ ...p, supplier_id: e.target.value }))} style={inp}>
                <option value="">— No Supplier —</option>
                {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
          )}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '16px' }}>
            <div>
              <label style={lbl}>Brand <span style={{ color: '#94a3b8', fontWeight: '400', fontSize: '10px', textTransform: 'none' }}>(optional)</span></label>
              {showNewBrand ? (
                <div style={{ display: 'flex', gap: '8px' }}>
                  <input type="text" value={newBrandName} onChange={e => setNewBrandName(e.target.value)}
                    placeholder="New brand name" style={inp} autoFocus
                    onKeyDown={e => e.key === 'Enter' && saveNewBrand()} />
                  <button onClick={saveNewBrand} style={{ padding: '9px 14px', background: '#059669', color: 'white', border: 'none', borderRadius: '7px', cursor: 'pointer', fontWeight: '700', fontSize: '13px', whiteSpace: 'nowrap' }}>Add</button>
                  <button onClick={() => { setShowNewBrand(false); setNewBrandName('') }} style={{ padding: '9px 12px', background: '#f1f5f9', color: '#64748b', border: 'none', borderRadius: '7px', cursor: 'pointer', fontSize: '13px' }}>✕</button>
                </div>
              ) : (
                <select value={form.brand_id} onChange={e => e.target.value === '__new__' ? setShowNewBrand(true) : setForm(p => ({ ...p, brand_id: e.target.value }))} style={inp}>
                  <option value="">— No Brand —</option>
                  {brands.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
                  <option value="__new__">+ Add new brand…</option>
                </select>
              )}
            </div>
            <div>
              <label style={lbl}>Category <span style={{ color: '#94a3b8', fontWeight: '400', fontSize: '10px', textTransform: 'none' }}>(optional)</span></label>
              {showNewCategory ? (
                <div>
                  <input type="text" value={newCategoryName} onChange={e => setNewCategoryName(e.target.value)}
                    placeholder="New category name" style={{ ...inp, marginBottom: '6px' }} autoFocus
                    onKeyDown={e => e.key === 'Enter' && saveNewCategory()} />
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <select value={newCategoryParent} onChange={e => setNewCategoryParent(e.target.value)} style={{ ...inp, fontSize: '13px' }}>
                      <option value="">— Top-level category —</option>
                      {categoryOptions().filter(c => c.depth === 0).map(c => <option key={c.id} value={c.id}>Subcategory of: {c.name}</option>)}
                    </select>
                    <button onClick={saveNewCategory} style={{ padding: '9px 14px', background: '#059669', color: 'white', border: 'none', borderRadius: '7px', cursor: 'pointer', fontWeight: '700', fontSize: '13px', whiteSpace: 'nowrap' }}>Add</button>
                    <button onClick={() => { setShowNewCategory(false); setNewCategoryName(''); setNewCategoryParent('') }} style={{ padding: '9px 12px', background: '#f1f5f9', color: '#64748b', border: 'none', borderRadius: '7px', cursor: 'pointer', fontSize: '13px' }}>✕</button>
                  </div>
                </div>
              ) : (
                <select value={form.category_id} onChange={e => e.target.value === '__new__' ? setShowNewCategory(true) : setForm(p => ({ ...p, category_id: e.target.value }))} style={inp}>
                  <option value="">— No Category —</option>
                  {categoryOptions().map(c => <option key={c.id} value={c.id}>{c.depth > 0 ? `— ${c.name}` : c.name}</option>)}
                  <option value="__new__">+ Add new category…</option>
                </select>
              )}
            </div>
          </div>
          <div style={{ marginBottom: '20px' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
              <input type="checkbox" checked={form.warranty_available}
                onChange={e => setForm(p => ({ ...p, warranty_available: e.target.checked }))}
                style={{ width: '16px', height: '16px', cursor: 'pointer' }} />
              <span style={{ fontSize: '14px', fontWeight: '500', color: '#374151' }}>Warranty available for this item</span>
            </label>
          </div>
          <div style={{ display: 'flex', gap: '10px' }}>
            <button onClick={handleSave} disabled={saving}
              style={{ padding: '10px 24px', background: 'linear-gradient(135deg,#2563eb,#1d4ed8)', color: 'white', border: 'none', borderRadius: '10px', cursor: 'pointer', fontWeight: '700', fontSize: '14px' }}>
              {saving ? 'Saving...' : editItem ? 'Update Item' : 'Create Item'}
            </button>
            <button onClick={() => { setShowForm(false); setEditItem(null) }}
              style={{ padding: '10px 20px', background: '#f1f5f9', color: '#64748b', border: 'none', borderRadius: '10px', cursor: 'pointer', fontWeight: '600', fontSize: '14px' }}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Search */}
      <div style={{ background: 'white', borderRadius: '12px', padding: '14px 16px', boxShadow: '0 1px 3px rgba(15,23,42,0.06), 0 1px 2px rgba(15,23,42,0.04)', marginBottom: '16px' }}>
        <input type="text" placeholder="Search item name or code…" value={search}
          onChange={e => setSearch(e.target.value)}
          style={{ ...inp, width: '100%', boxSizing: 'border-box' }} />
      </div>

      {/* Table */}
      <div style={{ background: 'white', borderRadius: '12px', boxShadow: '0 1px 3px rgba(15,23,42,0.06), 0 1px 2px rgba(15,23,42,0.04)', overflow: 'hidden' }}>
        {loading ? (
          <div style={{ padding: '60px', textAlign: 'center', color: '#94a3b8' }}>Loading...</div>
        ) : filtered.length === 0 ? (
          <div style={{ padding: '60px', textAlign: 'center', color: '#94a3b8' }}>
            <div style={{ fontSize: '36px', marginBottom: '12px' }}>📦</div>
            No items found
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: '#f8fafc', borderBottom: '2px solid #e2e8f0' }}>
                {['Item No', 'Name', 'Selling Price', ...(isCashier ? ['Last Price'] : ['Cost Price', 'Last Price', 'Margin', 'Supplier']), 'Brand', 'Category', 'Warranty', 'Actions'].map(h => (
                  <th key={h} style={{ padding: '11px 14px', textAlign: 'left', fontSize: '11px', fontWeight: '700', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.06em', whiteSpace: 'nowrap' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((item, i) => (
                <tr key={item.id} style={{ borderBottom: '1px solid #f1f5f9', background: i % 2 === 0 ? 'white' : '#fafafa' }}
                  onMouseEnter={e => e.currentTarget.style.background = '#f0f9ff'}
                  onMouseLeave={e => e.currentTarget.style.background = i % 2 === 0 ? 'white' : '#fafafa'}>
                  <td style={{ padding: '12px 14px', fontWeight: '700', color: '#2563eb', fontSize: '13px' }}>{item.item_no}</td>
                  <td style={{ padding: '12px 14px', fontSize: '14px', fontWeight: '600', color: '#0f172a' }}>{item.name}</td>
                  <td style={{ padding: '12px 14px', fontSize: '14px', fontWeight: '700', color: '#059669' }}>{formatCurrency(item.selling_price)}</td>
                  {isCashier && (
                    <td style={{ padding: '12px 14px', fontSize: '14px', fontWeight: '600', color: item.last_price > 0 ? '#d97706' : '#94a3b8' }}>
                      {item.last_price > 0 ? formatCurrency(item.last_price) : '—'}
                    </td>
                  )}
                  {!isCashier && (
                    <>
                      <td style={{ padding: '12px 14px', fontSize: '14px', color: '#64748b' }}>{item.cost_price > 0 ? formatCurrency(item.cost_price) : '—'}</td>
                      <td style={{ padding: '12px 14px', fontSize: '14px', color: '#d97706', fontWeight: '600' }}>
                        {item.last_price > 0 ? formatCurrency(item.last_price) : '—'}
                      </td>
                      <td style={{ padding: '12px 14px' }}>
                        {margin(item) !== null ? (
                          <span style={{ background: '#dcfce7', color: '#166534', padding: '3px 8px', borderRadius: '12px', fontSize: '12px', fontWeight: '700' }}>
                            {margin(item)}%
                          </span>
                        ) : '—'}
                      </td>
                      <td style={{ padding: '12px 14px', fontSize: '13px', color: '#64748b' }}>{item.suppliers?.name || '—'}</td>
                    </>
                  )}
                  <td style={{ padding: '12px 14px', fontSize: '13px', color: '#374151' }}>{item.brands?.name || '—'}</td>
                  <td style={{ padding: '12px 14px', fontSize: '13px', color: '#374151' }}>{item.categories?.name || '—'}</td>
                  <td style={{ padding: '12px 14px' }}>
                    <span style={{ background: item.warranty_available ? '#dcfce7' : '#f1f5f9', color: item.warranty_available ? '#166534' : '#94a3b8', padding: '3px 8px', borderRadius: '12px', fontSize: '12px', fontWeight: '700' }}>
                      {item.warranty_available ? 'Yes' : 'No'}
                    </span>
                  </td>
                  <td style={{ padding: '12px 14px' }}>
                    <button onClick={() => openEdit(item)}
                      style={{ padding: '5px 14px', background: '#eef2ff', color: '#2563eb', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '12px', fontWeight: '700' }}>
                      Edit
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
