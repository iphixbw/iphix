import { useState, useEffect, useRef } from 'react'
import { supabase } from '../../supabase'
import { formatCurrency } from '../../lib/helpers'
import toast from 'react-hot-toast'
import BarcodePrintModal from '../../components/BarcodePrintModal'

export default function Inventory({ isCashier = false }) {
  const [items, setItems] = useState([])
  const [shops, setShops] = useState([])
  const [shopStock, setShopStock] = useState({}) // { item_id: { shop_id: qty } }
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [activeTab, setActiveTab] = useState('stock')
  const [shopFilter, setShopFilter] = useState('all')
  const [brandFilter, setBrandFilter] = useState('all')
  const [categoryFilter, setCategoryFilter] = useState('all')
  const [brands, setBrands] = useState([])
  const [categories, setCategories] = useState([])
  const [selectedItems, setSelectedItems] = useState([])
  const [editingReorder, setEditingReorder] = useState(null)
  const [reorderValue, setReorderValue] = useState('')
  const [scanResult, setScanResult] = useState(null)
  const [barcodeInput, setBarcodeInput] = useState('')
  const [scanning, setScanning] = useState(false)
  const barcodeRef = useRef(null)
  const [showBarcodeModal, setShowBarcodeModal] = useState(false)
  // Stock movements
  const [movSearch, setMovSearch] = useState('')
  const [movItem, setMovItem] = useState(null)
  const [movLoading, setMovLoading] = useState(false)
  const [movements, setMovements] = useState([])
  const [showMovDrop, setShowMovDrop] = useState(false)
  // Brands & Categories management
  const [newBrandName, setNewBrandName] = useState('')
  const [newCategoryName, setNewCategoryName] = useState('')
  const [newCategoryParent, setNewCategoryParent] = useState('')
  const [savingBrand, setSavingBrand] = useState(false)
  const [savingCategory, setSavingCategory] = useState(false)
  const [renamingBrand, setRenamingBrand] = useState(null)
  const [renamingCategory, setRenamingCategory] = useState(null)
  const [renameValue, setRenameValue] = useState('')

  useEffect(() => { fetchInventory(); fetchBrandsAndCategories() }, [])

  async function fetchBrandsAndCategories() {
    const [{ data: b }, { data: c }] = await Promise.all([
      supabase.from('brands').select('*').order('name'),
      supabase.from('categories').select('*').order('name'),
    ])
    setBrands(b || [])
    setCategories(c || [])
  }

  // Top-level categories first, each followed by its subcategories, for an indented dropdown
  function categoryOptions() {
    const topLevel = categories.filter(c => !c.parent_category_id)
    const opts = []
    topLevel.forEach(top => {
      opts.push({ ...top, depth: 0 })
      categories.filter(c => c.parent_category_id === top.id).forEach(sub => opts.push({ ...sub, depth: 1 }))
    })
    return opts
  }

  async function addBrand() {
    if (!newBrandName.trim()) return toast.error('Brand name is required')
    setSavingBrand(true)
    const { error } = await supabase.from('brands').insert({ name: newBrandName.trim() })
    setSavingBrand(false)
    if (error) return toast.error(error.code === '23505' ? 'That brand already exists' : 'Failed to add brand')
    setNewBrandName('')
    toast.success('Brand added!')
    fetchBrandsAndCategories()
  }

  async function addCategory() {
    if (!newCategoryName.trim()) return toast.error('Category name is required')
    setSavingCategory(true)
    const { error } = await supabase.from('categories').insert({ name: newCategoryName.trim(), parent_category_id: newCategoryParent || null })
    setSavingCategory(false)
    if (error) return toast.error(error.code === '23505' ? 'That category already exists under this parent' : 'Failed to add category')
    setNewCategoryName(''); setNewCategoryParent('')
    toast.success('Category added!')
    fetchBrandsAndCategories()
  }

  async function renameBrand(id) {
    if (!renameValue.trim()) return toast.error('Name is required')
    const { error } = await supabase.from('brands').update({ name: renameValue.trim() }).eq('id', id)
    if (error) return toast.error(error.code === '23505' ? 'That brand name is already taken' : 'Failed to rename')
    setRenamingBrand(null); setRenameValue('')
    toast.success('Brand renamed!')
    fetchBrandsAndCategories()
  }

  async function renameCategory(id) {
    if (!renameValue.trim()) return toast.error('Name is required')
    const { error } = await supabase.from('categories').update({ name: renameValue.trim() }).eq('id', id)
    if (error) return toast.error(error.code === '23505' ? 'That category name is already taken under this parent' : 'Failed to rename')
    setRenamingCategory(null); setRenameValue('')
    toast.success('Category renamed!')
    fetchBrandsAndCategories()
  }

  async function deleteBrand(b) {
    const inUse = items.some(i => i.brand_id === b.id)
    if (!window.confirm(inUse
      ? `Delete "${b.name}"? Items using this brand will show no brand — this doesn't delete or change those items.`
      : `Delete "${b.name}"?`)) return
    const { error } = await supabase.from('brands').delete().eq('id', b.id)
    if (error) return toast.error('Failed to delete')
    toast.success('Brand deleted')
    fetchBrandsAndCategories()
    fetchInventory()
  }

  async function deleteCategory(c) {
    const hasSubcategories = categories.some(sub => sub.parent_category_id === c.id)
    if (hasSubcategories) return toast.error('Delete or move its subcategories first')
    const inUse = items.some(i => i.category_id === c.id)
    if (!window.confirm(inUse
      ? `Delete "${c.name}"? Items using this category will show no category — this doesn't delete or change those items.`
      : `Delete "${c.name}"?`)) return
    const { error } = await supabase.from('categories').delete().eq('id', c.id)
    if (error) return toast.error('Failed to delete')
    toast.success('Category deleted')
    fetchBrandsAndCategories()
    fetchInventory()
  }

  useEffect(() => { fetchInventory() }, [])

  async function fetchInventory() {
    setLoading(true)
    const [{ data: itemsData }, { data: shopsData }, { data: invData }] = await Promise.all([
      supabase.from('items').select('*, suppliers(name, supplier_no), brands(name), categories(name, parent_category_id)').order('name', { ascending: true }),
      supabase.from('shops').select('*').order('name'),
      supabase.from('inventory').select('item_id, shop_id, quantity').not('shop_id', 'is', null),
    ])
    setShops(shopsData || [])

    // Build shop-wise stock map: { item_id: { shop_id: totalQty } }
    const map = {}
    for (const row of (invData || [])) {
      if (!map[row.item_id]) map[row.item_id] = {}
      map[row.item_id][row.shop_id] = (map[row.item_id][row.shop_id] || 0) + (row.quantity || 0)
    }
    setShopStock(map)

    // Compute total stock per item from inventory table (sum of all shop batches)
    // This is the source of truth — items.stock_quantity is kept in sync but may drift
    const invTotalByItem = {}
    for (const row of (invData || [])) {
      invTotalByItem[row.item_id] = (invTotalByItem[row.item_id] || 0) + (row.quantity || 0)
    }

    // Merge inventory-derived totals into items, sync any drift back to DB silently
    const mergedItems = (itemsData || []).map(item => {
      const invTotal = invTotalByItem[item.id] ?? null
      // If inventory table has a total and it differs from stock_quantity, use inventory as truth
      if (invTotal !== null && invTotal !== item.stock_quantity) {
        // Sync DB silently (fire-and-forget)
        supabase.from('items').update({ stock_quantity: invTotal }).eq('id', item.id).then(() => {})
        return { ...item, stock_quantity: invTotal }
      }
      return item
    })
    setItems(mergedItems)
    setLoading(false)
  }

  async function saveReorderLevel(itemId) {
    const val = parseFloat(reorderValue) || 0
    const { error } = await supabase.from('items').update({ reorder_level: val }).eq('id', itemId)
    if (error) return toast.error('Failed to update')
    toast.success('Reorder level updated!')
    setEditingReorder(null)
    setReorderValue('')
    fetchInventory()
  }

  function toggleSelect(itemId) {
    setSelectedItems(prev => prev.includes(itemId) ? prev.filter(id => id !== itemId) : [...prev, itemId])
  }

  function toggleSelectAll() {
    const f = getFiltered()
    setSelectedItems(selectedItems.length === f.length ? [] : f.map(i => i.id))
  }

  async function handleBarcodeScan(e) {
    e.preventDefault()
    if (!barcodeInput.trim()) return
    setScanning(true); setScanResult(null)
    try {
      const { data, error } = await supabase.from('items').select('*, suppliers(name, supplier_no, phone)').eq('barcode', barcodeInput.trim()).single()
      if (error || !data) { setScanResult({ error: true, message: `No item found for: ${barcodeInput}` }) }
      else setScanResult({ item: data })
    } catch (e) { setScanResult({ error: true, message: 'Scan failed: ' + e.message }) }
    setBarcodeInput('')
    setScanning(false)
  }

  function getFiltered() {
    return items.filter(i => {
      const matchSearch = i.name.toLowerCase().includes(search.toLowerCase()) ||
        i.item_no?.toLowerCase().includes(search.toLowerCase()) ||
        i.barcode?.toLowerCase().includes(search.toLowerCase()) ||
        i.suppliers?.name?.toLowerCase().includes(search.toLowerCase()) ||
        i.brands?.name?.toLowerCase().includes(search.toLowerCase()) ||
        i.categories?.name?.toLowerCase().includes(search.toLowerCase())

      const matchBrand = brandFilter === 'all' || i.brand_id === brandFilter
      const matchCategory = categoryFilter === 'all' || i.category_id === categoryFilter

      if (shopFilter === 'all') return matchSearch && matchBrand && matchCategory
      // Filter by items that have stock in selected shop
      const shopQty = shopStock[i.id]?.[shopFilter] || 0
      return matchSearch && matchBrand && matchCategory && shopQty > 0
    })
  }

  const filtered = getFiltered()
  const lowStock = items.filter(i => i.reorder_level > 0 && (i.stock_quantity || 0) <= i.reorder_level)

  async function fetchMovements(item) {
    setMovItem(item)
    setMovLoading(true)
    setMovements([])
    const events = []

    // 1. Purchases — stock in
    const { data: purchItems } = await supabase
      .from('purchase_items')
      .select('quantity, unit_cost, purchases(purchase_no, created_at, status, shops(name), suppliers(name))')
      .eq('item_id', item.id)
    ;(purchItems || []).filter(r => r.purchases?.status === 'confirmed').forEach(r => {
      events.push({
        date: r.purchases.created_at, type: 'purchase', direction: 'in',
        qty: r.quantity, ref: r.purchases.purchase_no,
        desc: `Purchase — ${r.purchases.suppliers?.name || '—'}`,
        shop: r.purchases.shops?.name || '—',
        unit: r.unit_cost,
      })
    })

    // 2. Invoice sales — stock out
    const { data: invItems } = await supabase
      .from('invoice_items')
      .select('quantity, unit_price, invoices(invoice_no, created_at, status, shops(name), customers(name))')
      .eq('item_id', item.id)
    ;(invItems || []).filter(r => r.invoices?.status === 'confirmed').forEach(r => {
      events.push({
        date: r.invoices.created_at, type: 'sale', direction: 'out',
        qty: r.quantity, ref: r.invoices.invoice_no,
        desc: `Sale — ${r.invoices.customers?.name || '—'}`,
        shop: r.invoices.shops?.name || '—',
        unit: r.unit_price,
      })
    })

    // 3. Sales returns — stock back in
    const { data: retItems } = await supabase
      .from('sales_return_items')
      .select('quantity, unit_price, sales_returns(return_no, created_at, status, shops(name), customers(name))')
      .eq('item_id', item.id)
    ;(retItems || []).filter(r => r.sales_returns?.status === 'confirmed').forEach(r => {
      events.push({
        date: r.sales_returns.created_at, type: 'sales_return', direction: 'in',
        qty: r.quantity, ref: r.sales_returns.return_no,
        desc: `Sales Return — ${r.sales_returns.customers?.name || '—'}`,
        shop: r.sales_returns.shops?.name || '—',
        unit: r.unit_price,
      })
    })

    // 4. Purchase returns — stock out
    const { data: pretItems } = await supabase
      .from('purchase_return_items')
      .select('quantity, unit_cost, purchase_returns(return_no, created_at, status, shops(name), suppliers(name))')
      .eq('item_id', item.id)
    ;(pretItems || []).filter(r => r.purchase_returns?.status === 'confirmed').forEach(r => {
      events.push({
        date: r.purchase_returns.created_at, type: 'purchase_return', direction: 'out',
        qty: r.quantity, ref: r.purchase_returns.return_no,
        desc: `Purchase Return — ${r.purchase_returns.suppliers?.name || '—'}`,
        shop: r.purchase_returns.shops?.name || '—',
        unit: r.unit_cost,
      })
    })

    // 5. Stock transfers
    const { data: transfers } = await supabase
      .from('stock_transfer_items')
      .select('quantity, stock_transfers(transfer_no, created_at, status, from_shop:shops!stock_transfers_from_shop_id_fkey(name), to_shop:shops!stock_transfers_to_shop_id_fkey(name))')
      .eq('item_id', item.id)
    ;(transfers || []).filter(r => r.stock_transfers?.status === 'completed').forEach(r => {
      const t = r.stock_transfers
      events.push({
        date: t.created_at, type: 'transfer', direction: 'transfer',
        qty: r.quantity, ref: t.transfer_no || 'TRF',
        desc: `Transfer: ${t.from_shop?.name || '?'} → ${t.to_shop?.name || '?'}`,
        shop: `${t.from_shop?.name || '?'} → ${t.to_shop?.name || '?'}`,
        unit: null,
      })
    })

    // Sort chronologically, compute running total
    events.sort((a, b) => new Date(a.date) - new Date(b.date))
    let running = 0
    const withRunning = events.map(e => {
      if (e.direction === 'in') running += e.qty
      else if (e.direction === 'out') running -= e.qty
      return { ...e, running }
    })
    setMovements(withRunning)
    setMovLoading(false)
  }

  const movFiltered = items.filter(i =>
    i.name.toLowerCase().includes(movSearch.toLowerCase()) ||
    i.item_no?.toLowerCase().includes(movSearch.toLowerCase())
  )

  const inp = { width: '100%', padding: '9px 12px', border: '1.5px solid #e2e8f0', borderRadius: '7px', fontSize: '14px', boxSizing: 'border-box', outline: 'none', background: 'white' }

  return (
    <div>
      <div style={{ marginBottom: '24px' }}>
        <h1 style={{ fontSize: '22px', fontWeight: '700', color: '#0f172a', margin: '0 0 4px' }}>Inventory</h1>
        <p style={{ color: '#64748b', fontSize: '14px', margin: 0 }}>Stock levels{!isCashier ? ', barcodes and scanner' : ' — check availability across all shops'}</p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: '16px', marginBottom: '24px' }}>
        {[
          { label: 'Total Items', value: items.length, color: '#1e40af' },
          { label: 'In Stock', value: items.filter(i => (i.stock_quantity||0) > 0).length, color: '#059669' },
          { label: 'Out of Stock', value: items.filter(i => (i.stock_quantity||0) <= 0).length, color: '#e11d48' },
          { label: 'Low Stock', value: lowStock.length, color: '#d97706' },
        ].map(s => (
          <div key={s.label} style={{ background: 'white', borderRadius: '12px', padding: '20px', boxShadow: '0 1px 3px rgba(15,23,42,0.06), 0 1px 2px rgba(15,23,42,0.04)', borderLeft: `4px solid ${s.color}` }}>
            <div style={{ fontSize: '12px', fontWeight: '700', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '6px' }}>{s.label}</div>
            <div style={{ fontSize: '22px', fontWeight: '800', color: s.color }}>{s.value}</div>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: '4px', marginBottom: '20px', background: '#f1f5f9', padding: '4px', borderRadius: '10px', width: 'fit-content' }}>
        {[
          { id: 'stock', label: '📦 Stock Levels' },
          { id: 'movements', label: '📊 Stock Movements' },
          ...(!isCashier ? [{ id: 'scanner', label: '🔍 Barcode Scanner' }] : []),
          ...(!isCashier ? [{ id: 'brands', label: '🏷️ Brands & Categories' }] : []),
        ].map(tab => (
          <button key={tab.id} onClick={() => setActiveTab(tab.id)}
            style={{ padding: '8px 20px', borderRadius: '10px', border: 'none', cursor: 'pointer', fontSize: '14px', fontWeight: '600', background: activeTab === tab.id ? 'white' : 'transparent', color: activeTab === tab.id ? '#0f172a' : '#64748b', boxShadow: activeTab === tab.id ? '0 1px 3px rgba(0,0,0,0.1)' : 'none' }}>
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === 'stock' && (
        <div>
          {/* Filters */}
          <div style={{ display: 'flex', gap: '12px', marginBottom: '16px', alignItems: 'center', flexWrap: 'wrap' }}>
            <input type="text" placeholder="Search name, code, barcode, supplier…" value={search}
              onChange={e => setSearch(e.target.value)} style={{ ...inp, flex: 1, minWidth: '200px' }} />
            {/* Shop filter */}
            <select value={shopFilter} onChange={e => setShopFilter(e.target.value)}
              style={{ ...inp, width: 'auto', minWidth: '160px' }}>
              <option value="all">All Shops</option>
              {shops.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            {/* Brand filter */}
            <select value={brandFilter} onChange={e => setBrandFilter(e.target.value)}
              style={{ ...inp, width: 'auto', minWidth: '150px' }}>
              <option value="all">All Brands</option>
              {brands.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
            {/* Category filter */}
            <select value={categoryFilter} onChange={e => setCategoryFilter(e.target.value)}
              style={{ ...inp, width: 'auto', minWidth: '160px' }}>
              <option value="all">All Categories</option>
              {categoryOptions().map(c => <option key={c.id} value={c.id}>{c.depth > 0 ? `— ${c.name}` : c.name}</option>)}
            </select>
            {!isCashier && selectedItems.length > 0 && (
              <button onClick={() => setShowBarcodeModal(true)}
                style={{ padding: '9px 18px', background: 'linear-gradient(135deg,#2563eb,#1d4ed8)', color: 'white', border: 'none', borderRadius: '10px', cursor: 'pointer', fontWeight: '700', fontSize: '13px', whiteSpace: 'nowrap' }}>
                🖨 Print {selectedItems.length} Barcode{selectedItems.length > 1 ? 's' : ''}
              </button>
            )}
          </div>

          {lowStock.length > 0 && (
            <div style={{ background: '#fffbeb', border: '1.5px solid #fde68a', borderRadius: '10px', padding: '14px 16px', marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '10px' }}>
              <span style={{ fontSize: '20px' }}>⚠️</span>
              <div>
                <div style={{ fontSize: '14px', fontWeight: '700', color: '#92400e' }}>{lowStock.length} item{lowStock.length > 1 ? 's' : ''} below reorder level</div>
                <div style={{ fontSize: '13px', color: '#b45309' }}>{lowStock.map(i => i.name).join(', ')}</div>
              </div>
            </div>
          )}

          <div style={{ background: 'white', borderRadius: '12px', boxShadow: '0 1px 3px rgba(15,23,42,0.06), 0 1px 2px rgba(15,23,42,0.04)', overflow: 'hidden' }}>
            {loading ? <div style={{ padding: '60px', textAlign: 'center', color: '#94a3b8' }}>Loading...</div>
            : filtered.length === 0 ? (
              <div style={{ padding: '60px', textAlign: 'center', color: '#94a3b8' }}>
                <div style={{ fontSize: '36px', marginBottom: '12px' }}>📦</div>No items found
              </div>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: isCashier ? '600px' : '900px' }}>
                  <thead>
                    <tr style={{ background: '#f8fafc', borderBottom: '2px solid #e2e8f0' }}>
                      {!isCashier && (
                        <th style={{ padding: '11px 14px' }}>
                          <input type="checkbox" checked={selectedItems.length === filtered.length && filtered.length > 0}
                            onChange={toggleSelectAll} style={{ cursor: 'pointer', accentColor: '#2563eb' }} />
                        </th>
                      )}
                      {[
                        'Item No', 'Name',
                        ...(!isCashier ? ['Brand', 'Category'] : []),
                        ...(!isCashier ? ['Barcode'] : []),
                        ...(!isCashier ? ['Supplier', 'Sup. Code'] : []),
                        'Total Stock',
                        // Per-shop columns
                        ...shops.map(s => s.name),
                        ...(!isCashier ? ['Reorder', 'Cost', 'Selling'] : ['Selling Price']),
                        'Status',
                      ].map(h => (
                        <th key={h} style={{ padding: '11px 14px', textAlign: 'left', fontSize: '11px', fontWeight: '700', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.06em', whiteSpace: 'nowrap' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((item, i) => {
                      const isLow = item.reorder_level > 0 && (item.stock_quantity||0) <= item.reorder_level
                      const isOut = (item.stock_quantity||0) <= 0
                      const isSelected = selectedItems.includes(item.id)
                      return (
                        <tr key={item.id} style={{ borderBottom: '1px solid #f1f5f9', background: isSelected ? '#eef2ff' : isOut ? '#fff5f5' : isLow ? '#fffbeb' : i % 2 === 0 ? 'white' : '#fafafa' }}>
                          {!isCashier && (
                            <td style={{ padding: '10px 14px' }}>
                              <input type="checkbox" checked={isSelected} onChange={() => toggleSelect(item.id)} style={{ cursor: 'pointer', accentColor: '#2563eb' }} />
                            </td>
                          )}
                          <td style={{ padding: '10px 14px', fontWeight: '700', color: '#2563eb', fontSize: '13px' }}>{item.item_no}</td>
                          <td style={{ padding: '10px 14px', fontSize: '14px', fontWeight: '600', color: '#0f172a' }}>{item.name}</td>
                          {!isCashier && <td style={{ padding: '10px 14px', fontSize: '12px', color: '#374151' }}>{item.brands?.name || '—'}</td>}
                          {!isCashier && <td style={{ padding: '10px 14px', fontSize: '12px', color: '#374151' }}>{item.categories?.name || '—'}</td>}
                          {!isCashier && <td style={{ padding: '10px 14px', fontSize: '12px', color: '#94a3b8', fontFamily: 'monospace' }}>{item.barcode || <span style={{ color: '#fca5a5', fontSize: '11px' }}>None</span>}</td>}
                          {!isCashier && <td style={{ padding: '10px 14px', fontSize: '13px', color: '#64748b' }}>{item.suppliers?.name || '—'}</td>}
                          {!isCashier && <td style={{ padding: '10px 14px', fontSize: '12px', fontWeight: '700', color: '#2563eb' }}>{item.suppliers?.supplier_no || '—'}</td>}
                          {/* Total stock */}
                          <td style={{ padding: '10px 14px', fontSize: '15px', fontWeight: '800', color: isOut ? '#e11d48' : isLow ? '#d97706' : '#059669' }}>
                            {item.stock_quantity || 0}
                          </td>
                          {/* Per-shop stock */}
                          {shops.map(shop => {
                            const qty = shopStock[item.id]?.[shop.id] || 0
                            return (
                              <td key={shop.id} style={{ padding: '10px 14px', textAlign: 'center' }}>
                                <span style={{ fontSize: '13px', fontWeight: '700', color: qty > 0 ? '#059669' : '#e11d48', background: qty > 0 ? '#f0fdf4' : '#fff5f5', padding: '2px 8px', borderRadius: '12px', display: 'inline-block' }}>
                                  {qty}
                                </span>
                              </td>
                            )
                          })}
                          {/* Reorder — admin only */}
                          {!isCashier && (
                            <td style={{ padding: '10px 14px' }}>
                              {editingReorder === item.id ? (
                                <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
                                  <input type="number" value={reorderValue} onChange={e => setReorderValue(e.target.value)} autoFocus
                                    style={{ width: '60px', padding: '4px 8px', border: '1.5px solid #2563eb', borderRadius: '6px', fontSize: '13px', outline: 'none' }} />
                                  <button onClick={() => saveReorderLevel(item.id)} style={{ padding: '4px 8px', background: '#2563eb', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '12px' }}>✓</button>
                                  <button onClick={() => setEditingReorder(null)} style={{ padding: '4px 8px', background: '#f1f5f9', color: '#64748b', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '12px' }}>✕</button>
                                </div>
                              ) : (
                                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                  <span style={{ fontSize: '13px', color: item.reorder_level > 0 ? '#0f172a' : '#94a3b8' }}>{item.reorder_level || '—'}</span>
                                  <button onClick={() => { setEditingReorder(item.id); setReorderValue(item.reorder_level || '') }}
                                    style={{ padding: '2px 6px', background: '#f1f5f9', color: '#64748b', border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '10px', fontWeight: '700' }}>Set</button>
                                </div>
                              )}
                            </td>
                          )}
                          {!isCashier && <td style={{ padding: '10px 14px', fontSize: '13px', color: '#64748b' }}>{formatCurrency(item.cost_price)}</td>}
                          <td style={{ padding: '10px 14px', fontSize: '13px', fontWeight: '600', color: '#059669' }}>{formatCurrency(item.selling_price)}</td>
                          <td style={{ padding: '10px 14px' }}>
                            {isOut ? <span style={{ background: '#fee2e2', color: '#dc2626', padding: '3px 8px', borderRadius: '20px', fontSize: '11px', fontWeight: '700' }}>Out</span>
                            : isLow ? <span style={{ background: '#fef3c7', color: '#92400e', padding: '3px 8px', borderRadius: '20px', fontSize: '11px', fontWeight: '700' }}>Low</span>
                            : <span style={{ background: '#dcfce7', color: '#166534', padding: '3px 8px', borderRadius: '20px', fontSize: '11px', fontWeight: '700' }}>OK</span>}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
          {!isCashier && selectedItems.length > 0 && (
            <div style={{ marginTop: '12px', padding: '10px 16px', background: '#eef2ff', borderRadius: '10px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: '13px', color: '#1e40af', fontWeight: '600' }}>{selectedItems.length} item{selectedItems.length > 1 ? 's' : ''} selected</span>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button onClick={() => setSelectedItems([])} style={{ padding: '6px 14px', background: 'white', color: '#64748b', border: '1px solid #e2e8f0', borderRadius: '6px', cursor: 'pointer', fontSize: '13px', fontWeight: '600' }}>Clear</button>
                <button onClick={() => setShowBarcodeModal(true)} style={{ padding: '6px 14px', background: '#2563eb', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '13px', fontWeight: '700' }}>🖨 Print Barcodes</button>
              </div>
            </div>
          )}
        </div>
      )}

      {activeTab === 'movements' && (
        <div>
          {/* Item search */}
          <div style={{ background: 'white', borderRadius: '12px', padding: '20px', boxShadow: '0 1px 3px rgba(15,23,42,0.06), 0 1px 2px rgba(15,23,42,0.04)', marginBottom: '16px' }}>
            <h2 style={{ fontSize: '15px', fontWeight: '700', color: '#0f172a', margin: '0 0 14px' }}>Select Item to View Stock History</h2>
            <div style={{ position: 'relative', maxWidth: '480px' }}>
              <input type="text" placeholder="Search item name or code…" value={movSearch}
                onChange={e => { setMovSearch(e.target.value); setShowMovDrop(true); if (!e.target.value) { setMovItem(null); setMovements([]) } }}
                onFocus={() => setShowMovDrop(true)}
                onBlur={() => setTimeout(() => setShowMovDrop(false), 180)}
                style={{ ...inp, paddingRight: '32px' }} />
              {movItem && <span style={{ position: 'absolute', right: '10px', top: '50%', transform: 'translateY(-50%)', color: '#22c55e', fontSize: '16px' }}>✓</span>}
              {showMovDrop && movSearch && (
                <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: 'white', border: '1.5px solid #e2e8f0', borderRadius: '10px', boxShadow: '0 8px 24px rgba(0,0,0,0.12)', zIndex: 100, maxHeight: '220px', overflowY: 'auto', marginTop: '4px' }}>
                  {movFiltered.length === 0
                    ? <div style={{ padding: '12px 14px', color: '#94a3b8', fontSize: '13px' }}>No items found</div>
                    : movFiltered.slice(0, 10).map(i => (
                      <div key={i.id}
                        onMouseDown={() => { setMovSearch(i.name); setShowMovDrop(false); fetchMovements(i) }}
                        style={{ padding: '10px 14px', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #f1f5f9' }}
                        onMouseEnter={e => e.currentTarget.style.background = '#f8fafc'}
                        onMouseLeave={e => e.currentTarget.style.background = 'white'}>
                        <div>
                          <span style={{ fontWeight: '700', color: '#2563eb', marginRight: '8px', fontSize: '12px' }}>{i.item_no}</span>
                          <span style={{ fontWeight: '600', color: '#0f172a' }}>{i.name}</span>
                        </div>
                        <span style={{ fontSize: '12px', fontWeight: '700', color: (i.stock_quantity || 0) > 0 ? '#059669' : '#e11d48' }}>
                          Stock: {i.stock_quantity || 0}
                        </span>
                      </div>
                    ))
                  }
                </div>
              )}
            </div>
          </div>

          {/* Movements table */}
          {movLoading && <div style={{ padding: '40px', textAlign: 'center', color: '#94a3b8' }}>Loading movements…</div>}

          {movItem && !movLoading && (
            <div style={{ background: 'white', borderRadius: '12px', boxShadow: '0 1px 3px rgba(15,23,42,0.06), 0 1px 2px rgba(15,23,42,0.04)', overflow: 'hidden' }}>
              {/* Header */}
              <div style={{ padding: '16px 20px', borderBottom: '2px solid #e2e8f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#f8fafc' }}>
                <div>
                  <div style={{ fontSize: '16px', fontWeight: '800', color: '#0f172a' }}>{movItem.name}</div>
                  <div style={{ fontSize: '12px', color: '#2563eb', fontWeight: '700', marginTop: '2px' }}>{movItem.item_no}</div>
                </div>
                <div style={{ display: 'flex', gap: '20px', textAlign: 'right' }}>
                  <div>
                    <div style={{ fontSize: '11px', fontWeight: '700', color: '#94a3b8', textTransform: 'uppercase' }}>Current Stock</div>
                    <div style={{ fontSize: '22px', fontWeight: '800', color: (movItem.stock_quantity || 0) > 0 ? '#059669' : '#e11d48' }}>{movItem.stock_quantity || 0}</div>
                  </div>
                  <div>
                    <div style={{ fontSize: '11px', fontWeight: '700', color: '#94a3b8', textTransform: 'uppercase' }}>Movements</div>
                    <div style={{ fontSize: '22px', fontWeight: '800', color: '#2563eb' }}>{movements.length}</div>
                  </div>
                </div>
              </div>

              {movements.length === 0 ? (
                <div style={{ padding: '40px', textAlign: 'center', color: '#94a3b8' }}>No stock movements found for this item</div>
              ) : (
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ background: '#f8fafc', borderBottom: '2px solid #e2e8f0' }}>
                      {['Date', 'Type', 'Reference', 'Description', 'Shop', 'Qty In', 'Qty Out', 'Running Total'].map((h, hi) => (
                        <th key={h} style={{ padding: '10px 14px', textAlign: hi >= 5 ? 'right' : 'left', fontSize: '11px', fontWeight: '700', color: '#94a3b8', textTransform: 'uppercase', whiteSpace: 'nowrap' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {movements.map((m, i) => {
                      const typeStyle = {
                        purchase:        { bg: '#f0fdf4', badge: { bg: '#dcfce7', color: '#166534', label: '↓ Purchase' } },
                        sale:            { bg: '#fff5f5', badge: { bg: '#fee2e2', color: '#991b1b', label: '↑ Sale' } },
                        sales_return:    { bg: '#fef9ec', badge: { bg: '#fef3c7', color: '#92400e', label: '↩ Sales Return' } },
                        purchase_return: { bg: '#fff5f5', badge: { bg: '#fce7f3', color: '#9d174d', label: '↩ Purchase Return' } },
                        transfer:        { bg: '#f0f9ff', badge: { bg: '#dbeafe', color: '#1d4ed8', label: '⇄ Transfer' } },
                      }[m.type] || { bg: 'white', badge: { bg: '#f1f5f9', color: '#64748b', label: m.type } }
                      return (
                        <tr key={i} style={{ borderBottom: '1px solid #f1f5f9', background: typeStyle.bg }}>
                          <td style={{ padding: '10px 14px', fontSize: '12px', color: '#64748b', whiteSpace: 'nowrap' }}>
                            {new Date(m.date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}
                          </td>
                          <td style={{ padding: '10px 14px' }}>
                            <span style={{ background: typeStyle.badge.bg, color: typeStyle.badge.color, padding: '2px 8px', borderRadius: '10px', fontSize: '11px', fontWeight: '700', whiteSpace: 'nowrap' }}>
                              {typeStyle.badge.label}
                            </span>
                          </td>
                          <td style={{ padding: '10px 14px', fontWeight: '700', color: '#2563eb', fontSize: '12px' }}>{m.ref}</td>
                          <td style={{ padding: '10px 14px', fontSize: '13px', color: '#0f172a' }}>{m.desc}</td>
                          <td style={{ padding: '10px 14px', fontSize: '12px', color: '#64748b' }}>{m.shop}</td>
                          <td style={{ padding: '10px 14px', textAlign: 'right', fontWeight: '700', color: '#059669', fontSize: '14px' }}>
                            {m.direction === 'in' ? `+${m.qty}` : '—'}
                          </td>
                          <td style={{ padding: '10px 14px', textAlign: 'right', fontWeight: '700', color: '#e11d48', fontSize: '14px' }}>
                            {m.direction === 'out' ? `-${m.qty}` : m.direction === 'transfer' ? `±${m.qty}` : '—'}
                          </td>
                          <td style={{ padding: '10px 14px', textAlign: 'right', fontWeight: '800', fontSize: '14px', color: m.running > 0 ? '#0f172a' : '#e11d48' }}>
                            {m.direction === 'transfer' ? '—' : m.running}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                  <tfoot>
                    <tr style={{ background: '#0f172a' }}>
                      <td colSpan={5} style={{ padding: '12px 14px', fontWeight: '700', color: 'white', fontSize: '13px' }}>Total Movement</td>
                      <td style={{ padding: '12px 14px', textAlign: 'right', fontWeight: '800', color: '#86efac', fontSize: '14px' }}>
                        +{movements.filter(m => m.direction === 'in').reduce((s, m) => s + m.qty, 0)}
                      </td>
                      <td style={{ padding: '12px 14px', textAlign: 'right', fontWeight: '800', color: '#fca5a5', fontSize: '14px' }}>
                        -{movements.filter(m => m.direction === 'out').reduce((s, m) => s + m.qty, 0)}
                      </td>
                      <td style={{ padding: '12px 14px', textAlign: 'right', fontWeight: '900', color: (movItem.stock_quantity || 0) > 0 ? '#86efac' : '#fca5a5', fontSize: '15px' }}>
                        {movItem.stock_quantity || 0}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              )}
            </div>
          )}
        </div>
      )}

      {activeTab === 'scanner' && !isCashier && (
        <div>
          <div style={{ background: 'white', borderRadius: '12px', padding: '32px', boxShadow: '0 1px 3px rgba(15,23,42,0.06), 0 1px 2px rgba(15,23,42,0.04)', marginBottom: '20px', textAlign: 'center' }}>
            <div style={{ fontSize: '48px', marginBottom: '12px' }}>🔍</div>
            <h2 style={{ fontSize: '18px', fontWeight: '700', color: '#0f172a', marginBottom: '6px' }}>Barcode Scanner</h2>
            <p style={{ color: '#64748b', fontSize: '14px', marginBottom: '24px' }}>Scan or manually enter a barcode</p>
            <form onSubmit={handleBarcodeScan} style={{ display: 'flex', gap: '10px', maxWidth: '500px', margin: '0 auto' }}>
              <input ref={barcodeRef} type="text" value={barcodeInput} onChange={e => setBarcodeInput(e.target.value)}
                placeholder="Scan or type barcode…" autoFocus
                style={{ flex: 1, padding: '12px 16px', border: '2px solid #2563eb', borderRadius: '10px', fontSize: '16px', outline: 'none', textAlign: 'center', fontFamily: 'monospace' }} />
              <button type="submit" disabled={scanning}
                style={{ padding: '12px 24px', background: 'linear-gradient(135deg,#2563eb,#1d4ed8)', color: 'white', border: 'none', borderRadius: '10px', cursor: 'pointer', fontWeight: '700', fontSize: '14px' }}>
                {scanning ? '...' : 'Search'}
              </button>
            </form>
          </div>
          {scanResult && (
            scanResult.error ? (
              <div style={{ background: '#fff1f2', border: '1.5px solid #fecdd3', borderRadius: '12px', padding: '24px', textAlign: 'center' }}>
                <div style={{ fontSize: '32px', marginBottom: '8px' }}>❌</div>
                <div style={{ fontSize: '15px', fontWeight: '600', color: '#e11d48' }}>{scanResult.message}</div>
              </div>
            ) : (
              <div style={{ background: 'white', borderRadius: '12px', padding: '24px', boxShadow: '0 1px 3px rgba(15,23,42,0.06), 0 1px 2px rgba(15,23,42,0.04)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '16px' }}>
                  <div>
                    <div style={{ fontSize: '20px', fontWeight: '800', color: '#0f172a', marginBottom: '4px' }}>{scanResult.item.name}</div>
                    <span style={{ fontSize: '13px', fontWeight: '700', color: '#2563eb', background: '#eef2ff', padding: '2px 10px', borderRadius: '20px' }}>{scanResult.item.item_no}</span>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: '26px', fontWeight: '800', color: '#059669' }}>{formatCurrency(scanResult.item.selling_price)}</div>
                    <div style={{ fontSize: '13px', color: '#94a3b8' }}>Cost: {formatCurrency(scanResult.item.cost_price)}</div>
                  </div>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: '12px' }}>
                  {[
                    { title: 'Supplier', val: scanResult.item.suppliers?.name || '—', sub: scanResult.item.suppliers?.supplier_no },
                    { title: 'Total Stock', val: scanResult.item.stock_quantity || 0, large: true, color: (scanResult.item.stock_quantity||0) > 0 ? '#059669' : '#e11d48' },
                    { title: 'Warranty', val: scanResult.item.warranty_available ? '✓ Yes' : 'No', color: scanResult.item.warranty_available ? '#059669' : '#94a3b8' },
                  ].map(s => (
                    <div key={s.title} style={{ background: '#f8fafc', borderRadius: '10px', padding: '14px' }}>
                      <div style={{ fontSize: '11px', fontWeight: '700', color: '#94a3b8', textTransform: 'uppercase', marginBottom: '6px' }}>{s.title}</div>
                      <div style={{ fontSize: s.large ? '26px' : '14px', fontWeight: '700', color: s.color || '#0f172a' }}>{s.val}</div>
                      {s.sub && <div style={{ fontSize: '12px', color: '#2563eb', marginTop: '2px' }}>{s.sub}</div>}
                    </div>
                  ))}
                </div>
              </div>
            )
          )}
        </div>
      )}

      {activeTab === 'brands' && !isCashier && (
        <div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
            {/* Brands panel */}
            <div style={{ background: 'white', borderRadius: '12px', padding: '20px', boxShadow: '0 1px 3px rgba(15,23,42,0.06), 0 1px 2px rgba(15,23,42,0.04)' }}>
              <h3 style={{ margin: '0 0 4px', fontSize: '16px', fontWeight: '700', color: '#0f172a' }}>Brands</h3>
              <p style={{ margin: '0 0 16px', fontSize: '13px', color: '#94a3b8' }}>{brands.length} brand{brands.length !== 1 ? 's' : ''}</p>
              <div style={{ display: 'flex', gap: '8px', marginBottom: '16px' }}>
                <input type="text" placeholder="New brand name…" value={newBrandName}
                  onChange={e => setNewBrandName(e.target.value)} onKeyDown={e => e.key === 'Enter' && addBrand()}
                  style={{ ...inp, flex: 1 }} />
                <button onClick={addBrand} disabled={savingBrand}
                  style={{ padding: '9px 18px', background: 'linear-gradient(135deg,#2563eb,#1d4ed8)', color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: '700', fontSize: '13px', whiteSpace: 'nowrap' }}>
                  + Add
                </button>
              </div>
              {brands.length === 0 ? (
                <div style={{ padding: '30px', textAlign: 'center', color: '#94a3b8', fontSize: '13px' }}>No brands yet</div>
              ) : (
                <div style={{ maxHeight: '440px', overflowY: 'auto' }}>
                  {brands.map(b => {
                    const count = items.filter(i => i.brand_id === b.id).length
                    return (
                      <div key={b.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 12px', borderBottom: '1px solid #f1f5f9', borderRadius: '8px' }}
                        onMouseEnter={e => e.currentTarget.style.background = '#f8fafc'}
                        onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                        {renamingBrand === b.id ? (
                          <div style={{ display: 'flex', gap: '6px', flex: 1 }}>
                            <input type="text" value={renameValue} onChange={e => setRenameValue(e.target.value)}
                              onKeyDown={e => e.key === 'Enter' && renameBrand(b.id)} autoFocus
                              style={{ ...inp, padding: '6px 10px', fontSize: '13px', flex: 1 }} />
                            <button onClick={() => renameBrand(b.id)} style={{ padding: '5px 10px', background: '#059669', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '12px', fontWeight: '700' }}>Save</button>
                            <button onClick={() => { setRenamingBrand(null); setRenameValue('') }} style={{ padding: '5px 10px', background: '#f1f5f9', color: '#64748b', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '12px' }}>✕</button>
                          </div>
                        ) : (
                          <>
                            <div>
                              <span style={{ fontSize: '14px', fontWeight: '600', color: '#0f172a' }}>{b.name}</span>
                              <span style={{ marginLeft: '8px', fontSize: '12px', color: '#94a3b8' }}>{count} item{count !== 1 ? 's' : ''}</span>
                            </div>
                            <div style={{ display: 'flex', gap: '6px' }}>
                              <button onClick={() => { setRenamingBrand(b.id); setRenameValue(b.name) }}
                                style={{ padding: '4px 10px', background: '#eef2ff', color: '#2563eb', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '11px', fontWeight: '700' }}>Rename</button>
                              <button onClick={() => deleteBrand(b)}
                                style={{ padding: '4px 10px', background: '#fef2f2', color: '#e11d48', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '11px', fontWeight: '700' }}>Delete</button>
                            </div>
                          </>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>

            {/* Categories panel */}
            <div style={{ background: 'white', borderRadius: '12px', padding: '20px', boxShadow: '0 1px 3px rgba(15,23,42,0.06), 0 1px 2px rgba(15,23,42,0.04)' }}>
              <h3 style={{ margin: '0 0 4px', fontSize: '16px', fontWeight: '700', color: '#0f172a' }}>Categories</h3>
              <p style={{ margin: '0 0 16px', fontSize: '13px', color: '#94a3b8' }}>{categories.length} categor{categories.length !== 1 ? 'ies' : 'y'}</p>
              <div style={{ marginBottom: '16px' }}>
                <input type="text" placeholder="New category name…" value={newCategoryName}
                  onChange={e => setNewCategoryName(e.target.value)} onKeyDown={e => e.key === 'Enter' && addCategory()}
                  style={{ ...inp, marginBottom: '8px' }} />
                <div style={{ display: 'flex', gap: '8px' }}>
                  <select value={newCategoryParent} onChange={e => setNewCategoryParent(e.target.value)} style={{ ...inp, flex: 1, fontSize: '13px' }}>
                    <option value="">— Top-level category —</option>
                    {categoryOptions().filter(c => c.depth === 0).map(c => <option key={c.id} value={c.id}>Subcategory of: {c.name}</option>)}
                  </select>
                  <button onClick={addCategory} disabled={savingCategory}
                    style={{ padding: '9px 18px', background: 'linear-gradient(135deg,#2563eb,#1d4ed8)', color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: '700', fontSize: '13px', whiteSpace: 'nowrap' }}>
                    + Add
                  </button>
                </div>
              </div>
              {categories.length === 0 ? (
                <div style={{ padding: '30px', textAlign: 'center', color: '#94a3b8', fontSize: '13px' }}>No categories yet</div>
              ) : (
                <div style={{ maxHeight: '400px', overflowY: 'auto' }}>
                  {categoryOptions().map(c => {
                    const count = items.filter(i => i.category_id === c.id).length
                    return (
                      <div key={c.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 12px', paddingLeft: c.depth > 0 ? '28px' : '12px', borderBottom: '1px solid #f1f5f9', borderRadius: '8px' }}
                        onMouseEnter={e => e.currentTarget.style.background = '#f8fafc'}
                        onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                        {renamingCategory === c.id ? (
                          <div style={{ display: 'flex', gap: '6px', flex: 1 }}>
                            <input type="text" value={renameValue} onChange={e => setRenameValue(e.target.value)}
                              onKeyDown={e => e.key === 'Enter' && renameCategory(c.id)} autoFocus
                              style={{ ...inp, padding: '6px 10px', fontSize: '13px', flex: 1 }} />
                            <button onClick={() => renameCategory(c.id)} style={{ padding: '5px 10px', background: '#059669', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '12px', fontWeight: '700' }}>Save</button>
                            <button onClick={() => { setRenamingCategory(null); setRenameValue('') }} style={{ padding: '5px 10px', background: '#f1f5f9', color: '#64748b', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '12px' }}>✕</button>
                          </div>
                        ) : (
                          <>
                            <div>
                              {c.depth > 0 && <span style={{ color: '#cbd5e1', marginRight: '4px' }}>—</span>}
                              <span style={{ fontSize: '14px', fontWeight: c.depth === 0 ? '700' : '500', color: '#0f172a' }}>{c.name}</span>
                              <span style={{ marginLeft: '8px', fontSize: '12px', color: '#94a3b8' }}>{count} item{count !== 1 ? 's' : ''}</span>
                            </div>
                            <div style={{ display: 'flex', gap: '6px' }}>
                              <button onClick={() => { setRenamingCategory(c.id); setRenameValue(c.name) }}
                                style={{ padding: '4px 10px', background: '#eef2ff', color: '#2563eb', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '11px', fontWeight: '700' }}>Rename</button>
                              <button onClick={() => deleteCategory(c)}
                                style={{ padding: '4px 10px', background: '#fef2f2', color: '#e11d48', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '11px', fontWeight: '700' }}>Delete</button>
                            </div>
                          </>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {showBarcodeModal && (
        <BarcodePrintModal
          items={items.filter(i => selectedItems.includes(i.id)).map(i => ({ id: i.id, name: i.name, barcode: i.barcode, selling_price: i.selling_price }))}
          onClose={() => setShowBarcodeModal(false)}
        />
      )}
    </div>
  )
}
