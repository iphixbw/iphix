import { useState, useEffect } from 'react'
import { supabase } from '../../supabase'
import toast from 'react-hot-toast'
import { formatLKR } from '../../lib/repairConstants'
import { generateRepairPartSku } from '../../lib/repairHelpers'

export default function RepairInventory({ shop }) {
  const [parts, setParts] = useState([])
  const [stockValues, setStockValues] = useState({}) // part_id -> FIFO value
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('all')
  const [showNew, setShowNew] = useState(false)
  const [editingPart, setEditingPart] = useState(null)

  useEffect(() => { fetchParts() }, [shop?.id])

  // Backstop: if this page's component instance ever gets kept alive rather than
  // freshly remounted when navigating back to it (some tab/cache patterns do this),
  // refetch whenever the browser tab regains focus/visibility too — so stock and
  // FIFO value consumed elsewhere (e.g. added to a repair job) don't show stale
  // until a manual page refresh.
  useEffect(() => {
    function onVisible() {
      if (document.visibilityState === 'visible') fetchParts()
    }
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('focus', onVisible)
    return () => {
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('focus', onVisible)
    }
  }, [shop?.id])

  // Cross-tab signal: another open tab writing to this key (e.g. after adding a
  // part to a job there) fires the browser's storage event here.
  useEffect(() => {
    function onStorage(e) {
      if (e.key === 'iphix_repair_stock_changed') fetchParts()
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [shop?.id])

  async function fetchParts() {
    setLoading(true)
    // A plain .select() is capped by Supabase/PostgREST's default row limit (often
    // 100 or 1000 depending on project config) — with 1000+ parts that silently
    // truncated the list. Page through in batches of 1000 until everything's fetched.
    let allParts = []
    let from = 0
    const PAGE_SIZE = 1000
    while (true) {
      let q = supabase.from('repair_parts').select('*, repair_suppliers(name)').order('name').range(from, from + PAGE_SIZE - 1)
      if (shop?.id) q = q.eq('shop_id', shop.id)
      const { data, error } = await q
      if (error) { toast.error('Failed to load parts: ' + error.message); break }
      allParts = allParts.concat(data || [])
      if (!data || data.length < PAGE_SIZE) break
      from += PAGE_SIZE
    }
    setParts(allParts)
    // Fetch FIFO stock value per part — batched rather than firing hundreds/thousands
    // of RPC calls at once (which risks browser connection limits and rate limiting
    // once the part count gets large).
    const values = {}
    const BATCH_SIZE = 25
    for (let i = 0; i < allParts.length; i += BATCH_SIZE) {
      const batch = allParts.slice(i, i + BATCH_SIZE)
      await Promise.all(batch.map(async p => {
        const { data: val } = await supabase.rpc('repair_fifo_stock_value', { p_part_id: p.id })
        values[p.id] = val || 0
      }))
    }
    setStockValues(values)
    setLoading(false)
  }

  const filtered = parts.filter(p => {
    const matchesCat = categoryFilter === 'all' || p.category === categoryFilter
    const matchesSearch = !search || p.name.toLowerCase().includes(search.toLowerCase()) ||
      p.sku?.toLowerCase().includes(search.toLowerCase()) || p.barcode?.toLowerCase().includes(search.toLowerCase())
    return matchesCat && matchesSearch
  })

  const totalValue = Object.values(stockValues).reduce((s, v) => s + v, 0)
  const lowStockCount = parts.filter(p => (p.current_stock || 0) <= (p.min_stock || 0)).length

  // Only show categories that are actually in use (e.g. added via Excel upload or the
  // part form) — repair_parts.category is free text, not a fixed list, so this reflects
  // real data instead of the old hardcoded PART_CATEGORIES constant.
  const categoriesInUse = [...new Set(parts.map(p => p.category).filter(Boolean))].sort()

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '20px' }}>
        <div>
          <h1 style={{ fontSize: '22px', fontWeight: '800', color: '#1c1917', margin: '0 0 4px' }}>Repair Inventory</h1>
          <p style={{ color: '#8a7a63', fontSize: '14px', margin: 0 }}>{parts.length} parts · FIFO Value: {formatLKR(totalValue)}{lowStockCount > 0 && <span style={{ color: '#e11d48', fontWeight: '700' }}> · {lowStockCount} low stock</span>}</p>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button onClick={fetchParts} title="Refresh stock and values"
            style={{ padding: '11px 16px', background: 'white', color: '#78716c', border: '1.5px solid #e7dfd3', borderRadius: '12px', cursor: 'pointer', fontWeight: '700', fontSize: '14px' }}>
            ↻
          </button>
          <button onClick={() => setShowNew(true)}
            style={{ padding: '11px 22px', background: 'linear-gradient(135deg,#f0b23d,#d4881f)', color: '#1c1917', border: 'none', borderRadius: '12px', cursor: 'pointer', fontWeight: '800', fontSize: '14px' }}>
            + Add Repair Part
          </button>
        </div>
      </div>

      <div style={{ display: 'flex', gap: '10px', marginBottom: '18px', flexWrap: 'wrap' }}>
        <input type="text" placeholder="Search name, SKU, barcode..." value={search} onChange={e => setSearch(e.target.value)}
          style={{ flex: 1, minWidth: '240px', padding: '10px 14px', border: '1.5px solid #e7dfd3', borderRadius: '10px', fontSize: '14px' }} />
        <select value={categoryFilter} onChange={e => setCategoryFilter(e.target.value)}
          style={{ padding: '10px 14px', border: '1.5px solid #e7dfd3', borderRadius: '10px', fontSize: '13px', background: 'white' }}>
          <option value="all">All Categories</option>
          {categoriesInUse.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>

      {loading ? (
        <div style={{ padding: '60px', textAlign: 'center', color: '#a89478' }}>Loading inventory...</div>
      ) : (
        <div style={{ background: 'white', borderRadius: '16px', border: '1px solid #f3ede4', overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: '#fdf8f3', borderBottom: '2px solid #f3ede4' }}>
                {['SKU', 'Part Name', 'Category', 'Stock', 'Min', 'FIFO Value', 'Selling Price', ''].map(h => (
                  <th key={h} style={{ padding: '10px 14px', textAlign: 'left', fontSize: '10px', fontWeight: '700', color: '#a89478', textTransform: 'uppercase' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((p, i) => {
                const low = (p.current_stock || 0) <= (p.min_stock || 0)
                return (
                  <tr key={p.id} onClick={() => setEditingPart(p)} style={{ borderBottom: '1px solid #f8f5f0', background: low ? '#fff7ed' : i % 2 === 0 ? 'white' : '#fdfbf8', cursor: 'pointer' }}>
                    <td style={{ padding: '10px 14px', fontSize: '12px', color: '#a89478', fontFamily: 'monospace' }}>{p.sku}</td>
                    <td style={{ padding: '10px 14px', fontWeight: '700', color: '#1c1917' }}>{p.name}</td>
                    <td style={{ padding: '10px 14px', fontSize: '12px', color: '#78716c' }}>{p.category || '—'}</td>
                    <td style={{ padding: '10px 14px', fontWeight: '700', color: low ? '#e11d48' : '#292524' }}>{p.current_stock || 0}</td>
                    <td style={{ padding: '10px 14px', fontSize: '12px', color: '#a89478' }}>{p.min_stock || 0}</td>
                    <td style={{ padding: '10px 14px', fontSize: '13px' }}>{formatLKR(stockValues[p.id] || 0)}</td>
                    <td style={{ padding: '10px 14px', fontSize: '13px', fontWeight: '600', color: '#166534' }}>{formatLKR(p.selling_price)}</td>
                    <td style={{ padding: '10px 14px' }}>{low && <span style={{ fontSize: '11px', fontWeight: '700', color: '#ea580c' }}>⚠ Low</span>}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          {filtered.length === 0 && <div style={{ padding: '48px', textAlign: 'center', color: '#a89478' }}>No parts found.</div>}
        </div>
      )}

      {(showNew || editingPart) && (
        <PartModal shop={shop} part={editingPart} onClose={() => { setShowNew(false); setEditingPart(null) }} onSaved={() => { setShowNew(false); setEditingPart(null); fetchParts() }} />
      )}
    </div>
  )
}

// Exported so RepairPurchases.jsx can reuse the same "Add Part" modal (item 1)
export function PartModal({ shop, part, onClose, onSaved }) {
  const [suppliers, setSuppliers] = useState([])
  const [saving, setSaving] = useState(false)
  const [categoriesInUse, setCategoriesInUse] = useState([])
  const [brandsInUse, setBrandsInUse] = useState([])
  const [showNewCategory, setShowNewCategory] = useState(false)
  const [newCategoryName, setNewCategoryName] = useState('')
  const [livePart, setLivePart] = useState(part)
  const [showAdjust, setShowAdjust] = useState(false)
  const [form, setForm] = useState({
    sku: part?.sku || '', barcode: part?.barcode || '', name: part?.name || '',
    compatible_models: part?.compatible_models || '', category: part?.category || '',
    brand: part?.brand || '', supplier_id: part?.supplier_id || '',
    purchase_price: part?.purchase_price || '',
    selling_price: part?.selling_price || '', min_stock: part?.min_stock || '',
    opening_stock: part ? '' : '0', location: part?.location || '',
    warranty: part?.warranty || '', expiry_date: part?.expiry_date || '', notes: part?.notes || '',
  })

  useEffect(() => { supabase.from('repair_suppliers').select('id, name').order('name').then(({ data }) => setSuppliers(data || [])) }, [])
  useEffect(() => {
    // Categories and brands are free-text columns on repair_parts, not a fixed list —
    // pull the distinct values already in use so the dropdown reflects real data
    // (e.g. anything added via the Opening Balances Excel upload). Paged so this
    // doesn't miss values past the default row cap once there are 1000+ parts.
    async function loadDistinct() {
      let all = []
      let from = 0
      const PAGE_SIZE = 1000
      while (true) {
        const { data } = await supabase.from('repair_parts').select('category, brand').range(from, from + PAGE_SIZE - 1)
        all = all.concat(data || [])
        if (!data || data.length < PAGE_SIZE) break
        from += PAGE_SIZE
      }
      setCategoriesInUse([...new Set(all.map(p => p.category).filter(Boolean))].sort())
      setBrandsInUse([...new Set(all.map(p => p.brand).filter(Boolean))].sort())
    }
    loadDistinct()
  }, [])
  useEffect(() => {
    if (!part && !form.sku) {
      generateRepairPartSku().then(sku => setForm(f => ({ ...f, sku }))).catch(() => {})
    }
  }, [])

  async function handleSave() {
    if (!form.name.trim()) return toast.error('Part name is required')
    if (!form.sku.trim()) return toast.error('SKU is required')
    setSaving(true)
    try {
      const payload = {
        sku: form.sku.trim(), barcode: form.barcode || null, name: form.name.trim(),
        compatible_models: form.compatible_models || null, category: form.category,
        brand: form.brand || null, supplier_id: form.supplier_id || null,
        purchase_price: parseFloat(form.purchase_price) || 0,
        selling_price: parseFloat(form.selling_price) || 0, min_stock: parseFloat(form.min_stock) || 0,
        location: form.location || null,
        warranty: form.warranty || null, expiry_date: form.expiry_date || null, notes: form.notes || null,
        shop_id: shop?.id || null,
      }
      if (part) {
        const { error } = await supabase.from('repair_parts').update(payload).eq('id', part.id)
        if (error) throw error
        toast.success('Part updated!')
      } else {
        const openingQty = parseFloat(form.opening_stock) || 0
        const { data: newPart, error } = await supabase.from('repair_parts').insert({ ...payload, current_stock: openingQty }).select().single()
        if (error) throw error
        // Create an opening FIFO batch if starting stock was entered
        if (openingQty > 0) {
          await supabase.rpc('repair_fifo_add_batch', {
            p_part_id: newPart.id, p_purchase_id: null,
            p_quantity: openingQty, p_unit_cost: parseFloat(form.purchase_price) || 0,
          })
        }
        toast.success('Part added!')
      }
      onSaved()
    } catch (e) { toast.error('Failed: ' + e.message) }
    setSaving(false)
  }

  const inp = { width: '100%', padding: '9px 12px', border: '1.5px solid #e7dfd3', borderRadius: '8px', fontSize: '13px', boxSizing: 'border-box' }
  const lbl = { display: 'block', marginBottom: '5px', fontSize: '11px', fontWeight: '700', color: '#a89478', textTransform: 'uppercase' }
  const grid2 = { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginBottom: '12px' }
  const grid3 = { display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '12px', marginBottom: '12px' }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(28,25,23,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '20px' }}>
      <div style={{ background: 'white', borderRadius: '20px', padding: '28px', width: '100%', maxWidth: '600px', maxHeight: '88vh', overflowY: 'auto' }}>
        <h2 style={{ fontSize: '18px', fontWeight: '800', color: '#1c1917', margin: '0 0 18px' }}>{part ? 'Edit' : 'Add'} Repair Part</h2>

        <div style={grid2}>
          <div><label style={lbl}>Part Name *</label><input style={inp} value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} /></div>
          <div><label style={lbl}>SKU * (auto-generated)</label><input style={inp} value={form.sku} onChange={e => setForm(f => ({ ...f, sku: e.target.value }))} /></div>
        </div>
        <div style={grid2}>
          <div><label style={lbl}>Barcode</label><input style={inp} value={form.barcode} onChange={e => setForm(f => ({ ...f, barcode: e.target.value }))} /></div>
          <div><label style={lbl}>Compatible Models</label><input style={inp} placeholder="e.g. iPhone 12 / 12 Pro" value={form.compatible_models} onChange={e => setForm(f => ({ ...f, compatible_models: e.target.value }))} /></div>
        </div>
        <div style={grid3}>
          <div>
            <label style={lbl}>Category</label>
            {showNewCategory ? (
              <div style={{ display: 'flex', gap: '6px' }}>
                <input style={inp} value={newCategoryName} autoFocus
                  onChange={e => setNewCategoryName(e.target.value)}
                  placeholder="New category name"
                  onKeyDown={e => { if (e.key === 'Enter') { setForm(f => ({ ...f, category: newCategoryName.trim() })); setShowNewCategory(false) } }} />
                <button onClick={() => { setForm(f => ({ ...f, category: newCategoryName.trim() })); setShowNewCategory(false) }}
                  style={{ padding: '9px 12px', background: '#059669', color: 'white', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: '700', fontSize: '12px', whiteSpace: 'nowrap' }}>Add</button>
                <button onClick={() => { setShowNewCategory(false); setNewCategoryName('') }}
                  style={{ padding: '9px 10px', background: '#f5f1ea', color: '#78716c', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '12px' }}>✕</button>
              </div>
            ) : (
              <select style={inp} value={form.category} onChange={e => e.target.value === '__new__' ? setShowNewCategory(true) : setForm(f => ({ ...f, category: e.target.value }))}>
                <option value="">— No Category —</option>
                {categoriesInUse.map(c => <option key={c} value={c}>{c}</option>)}
                <option value="__new__">+ Add new category…</option>
              </select>
            )}
          </div>
          <div>
            <label style={lbl}>Brand <span style={{ fontWeight: '400', textTransform: 'none' }}>(optional)</span></label>
            <input style={inp} list="repair-part-brand-list" value={form.brand} onChange={e => setForm(f => ({ ...f, brand: e.target.value }))} placeholder="Type or pick a brand" />
            <datalist id="repair-part-brand-list">{brandsInUse.map(b => <option key={b} value={b} />)}</datalist>
          </div>
          <div>
            <label style={lbl}>Supplier</label>
            <select style={inp} value={form.supplier_id} onChange={e => setForm(f => ({ ...f, supplier_id: e.target.value }))}>
              <option value="">—</option>
              {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
        </div>
        <div style={grid3}>
          <div><label style={lbl}>Purchase Price {!part && '(cost of opening stock)'}</label><input type="number" style={inp} value={form.purchase_price} onChange={e => setForm(f => ({ ...f, purchase_price: e.target.value }))} /></div>
          <div><label style={lbl}>Selling Price</label><input type="number" style={inp} value={form.selling_price} onChange={e => setForm(f => ({ ...f, selling_price: e.target.value }))} /></div>
          <div><label style={lbl}>Minimum Stock</label><input type="number" style={inp} value={form.min_stock} onChange={e => setForm(f => ({ ...f, min_stock: e.target.value }))} /></div>
        </div>
        <div style={grid2}>
          {!part && <div><label style={lbl}>Opening Stock Quantity</label><input type="number" style={inp} value={form.opening_stock} onChange={e => setForm(f => ({ ...f, opening_stock: e.target.value }))} /></div>}
          <div><label style={lbl}>Location</label><input style={inp} placeholder="e.g. Shelf A-3" value={form.location} onChange={e => setForm(f => ({ ...f, location: e.target.value }))} /></div>
        </div>
        {part && (
          <div style={{ background: '#fdf8f3', borderRadius: '8px', padding: '10px 12px', marginBottom: '12px', fontSize: '12px', color: '#8a7a63', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
            <span>Current stock: <strong style={{ color: '#1c1917' }}>{livePart?.current_stock || 0} units</strong> — normally managed by purchases and job/sale usage.</span>
            <button onClick={() => setShowAdjust(true)}
              style={{ padding: '6px 12px', background: '#1c1917', color: '#f0b23d', border: 'none', borderRadius: '7px', cursor: 'pointer', fontWeight: '700', fontSize: '11px', whiteSpace: 'nowrap' }}>
              ⚙ Adjust Stock
            </button>
          </div>
        )}
        <div style={grid2}>
          <div><label style={lbl}>Warranty</label><input style={inp} placeholder="e.g. 3 months" value={form.warranty} onChange={e => setForm(f => ({ ...f, warranty: e.target.value }))} /></div>
          <div><label style={lbl}>Expiry Date</label><input type="date" style={inp} value={form.expiry_date} onChange={e => setForm(f => ({ ...f, expiry_date: e.target.value }))} /></div>
        </div>
        <div style={{ marginBottom: '18px' }}><label style={lbl}>Notes</label><textarea style={{ ...inp, minHeight: '50px' }} value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} /></div>

        <div style={{ display: 'flex', gap: '10px' }}>
          <button onClick={onClose} style={{ flex: 1, padding: '11px', background: '#f5f1ea', border: 'none', borderRadius: '10px', cursor: 'pointer', fontWeight: '700', color: '#78716c' }}>Cancel</button>
          <button onClick={handleSave} disabled={saving} style={{ flex: 2, padding: '11px', background: 'linear-gradient(135deg,#f0b23d,#d4881f)', border: 'none', borderRadius: '10px', cursor: 'pointer', fontWeight: '800', color: '#1c1917' }}>{saving ? 'Saving...' : '✓ Save Part'}</button>
        </div>
      </div>

      {showAdjust && livePart && (
        <StockAdjustmentModal
          shop={shop} part={livePart}
          onClose={() => setShowAdjust(false)}
          onAdjusted={(freshPart) => { setLivePart(freshPart); setShowAdjust(false); onSaved() }}
        />
      )}
    </div>
  )
}

// Manual stock correction with a mandatory reason, logged to
// repair_stock_adjustments for a permanent audit trail. Keeps FIFO batches in
// sync rather than just moving the current_stock number: an increase creates a
// new batch at the given cost, a decrease consumes from existing batches
// oldest-first via repair_fifo_consume — same mechanics a real purchase or job
// usage would go through, so Inventory Valuation stays accurate afterward.
function StockAdjustmentModal({ shop, part, onClose, onAdjusted }) {
  const [type, setType] = useState('increase')
  const [quantity, setQuantity] = useState('')
  const [unitCost, setUnitCost] = useState(String(part.average_cost || part.purchase_price || ''))
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)

  const qty = parseFloat(quantity) || 0
  const currentStock = part.current_stock || 0

  async function handleAdjust() {
    if (!qty || qty <= 0) return toast.error('Enter a valid quantity')
    if (!reason.trim()) return toast.error('A reason is required for stock adjustments')
    if (type === 'decrease' && qty > currentStock) return toast.error(`Cannot remove more than the current stock (${currentStock})`)
    setSaving(true)
    try {
      if (type === 'increase') {
        const cost = parseFloat(unitCost) || 0
        if (cost <= 0) { toast.error('Enter a unit cost for the added stock'); setSaving(false); return }
        await supabase.rpc('repair_fifo_add_batch', { p_part_id: part.id, p_purchase_id: null, p_quantity: qty, p_unit_cost: cost })
        await supabase.rpc('repair_add_part_stock', { p_part_id: part.id, p_quantity: qty })
      } else {
        await supabase.rpc('repair_fifo_consume', { p_part_id: part.id, p_quantity: qty })
        await supabase.rpc('repair_deduct_part_stock', { p_part_id: part.id, p_quantity: qty })
      }
      const newStock = type === 'increase' ? currentStock + qty : currentStock - qty
      await supabase.from('repair_stock_adjustments').insert({
        part_id: part.id, shop_id: shop?.id || null, adjustment_type: type,
        quantity: qty, unit_cost: type === 'increase' ? parseFloat(unitCost) || 0 : null,
        previous_stock: currentStock, new_stock: newStock, reason: reason.trim(),
      })
      toast.success(`Stock ${type === 'increase' ? 'increased' : 'decreased'} — ${part.name} now at ${newStock} units`)
      const { data: fresh } = await supabase.from('repair_parts').select('*').eq('id', part.id).single()
      onAdjusted(fresh || { ...part, current_stock: newStock })
    } catch (e) { toast.error('Failed: ' + e.message) }
    setSaving(false)
  }

  const inp = { width: '100%', padding: '9px 12px', border: '1.5px solid #e7dfd3', borderRadius: '8px', fontSize: '13px', boxSizing: 'border-box' }
  const lbl = { display: 'block', marginBottom: '5px', fontSize: '11px', fontWeight: '700', color: '#a89478', textTransform: 'uppercase' }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(28,25,23,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1100, padding: '20px' }}>
      <div style={{ background: 'white', borderRadius: '18px', padding: '24px', width: '100%', maxWidth: '400px' }}>
        <h3 style={{ fontSize: '16px', fontWeight: '800', margin: '0 0 4px', color: '#1c1917' }}>Adjust Stock</h3>
        <p style={{ fontSize: '12px', color: '#8a7a63', margin: '0 0 16px' }}>{part.name} — currently {currentStock} units</p>

        <div style={{ display: 'flex', gap: '8px', marginBottom: '14px' }}>
          <button onClick={() => setType('increase')}
            style={{ flex: 1, padding: '9px', borderRadius: '8px', border: type === 'increase' ? '1.5px solid #059669' : '1.5px solid #e7dfd3', background: type === 'increase' ? '#f0fdf4' : 'white', color: type === 'increase' ? '#059669' : '#78716c', fontWeight: '700', fontSize: '13px', cursor: 'pointer' }}>
            + Increase
          </button>
          <button onClick={() => setType('decrease')}
            style={{ flex: 1, padding: '9px', borderRadius: '8px', border: type === 'decrease' ? '1.5px solid #e11d48' : '1.5px solid #e7dfd3', background: type === 'decrease' ? '#fff1f2' : 'white', color: type === 'decrease' ? '#e11d48' : '#78716c', fontWeight: '700', fontSize: '13px', cursor: 'pointer' }}>
            − Decrease
          </button>
        </div>

        <div style={{ marginBottom: '10px' }}>
          <label style={lbl}>Quantity to {type === 'increase' ? 'add' : 'remove'}</label>
          <input type="number" style={inp} value={quantity} onChange={e => setQuantity(e.target.value)} autoFocus />
        </div>

        {type === 'increase' && (
          <div style={{ marginBottom: '10px' }}>
            <label style={lbl}>Unit Cost (for the new stock)</label>
            <input type="number" style={inp} value={unitCost} onChange={e => setUnitCost(e.target.value)} />
          </div>
        )}

        <div style={{ marginBottom: '18px' }}>
          <label style={lbl}>Reason *</label>
          <textarea style={{ ...inp, minHeight: '70px' }} placeholder="e.g. physical stock count correction, damaged/written off, found extra units"
            value={reason} onChange={e => setReason(e.target.value)} />
        </div>

        <div style={{ display: 'flex', gap: '10px' }}>
          <button onClick={onClose} style={{ flex: 1, padding: '10px', background: '#f5f1ea', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: '700', color: '#78716c' }}>Cancel</button>
          <button onClick={handleAdjust} disabled={saving}
            style={{ flex: 1, padding: '10px', background: type === 'increase' ? '#059669' : '#e11d48', color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: '800' }}>
            {saving ? 'Saving...' : 'Confirm'}
          </button>
        </div>
      </div>
    </div>
  )
}
