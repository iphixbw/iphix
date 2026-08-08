import { useState, useEffect, useRef } from 'react'
import { supabase } from '../../supabase'
import { formatCurrency } from '../../lib/helpers'
import toast from 'react-hot-toast'

async function generateTransferNo() {
  const { data, error } = await supabase.rpc('generate_transfer_no')
  if (error) throw error
  return data
}

export default function StockTransfer({ activeShop, session, isCashier = false }) {
  const [activeTab, setActiveTab] = useState('list')
  const [transfers, setTransfers] = useState([])
  const [loading, setLoading] = useState(true)
  const [shops, setShops] = useState([])
  const [items, setItems] = useState([])

  // Form state
  const [fromShop, setFromShop] = useState(null)
  const [toShop, setToShop] = useState(null)
  const [transferItems, setTransferItems] = useState([])
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [itemSearch, setItemSearch] = useState('')
  const [showItemDrop, setShowItemDrop] = useState(false)
  const itemRef = useRef(null)

  useEffect(() => { fetchData() }, [])

  async function fetchData() {
    setLoading(true)
    const [{ data: tr }, { data: sh }, { data: itms }, { data: invData }] = await Promise.all([
      supabase.from('stock_transfers').select('*, from_shop:shops!stock_transfers_from_shop_id_fkey(name), to_shop:shops!stock_transfers_to_shop_id_fkey(name)').order('created_at', { ascending: false }),
      supabase.from('shops').select('*').order('name'),
      supabase.from('items').select('*').order('name'),
      supabase.from('inventory').select('item_id, shop_id, quantity').not('shop_id', 'is', null),
    ])
    setTransfers(tr || [])
    setShops(sh || [])

    // Build shop-wise stock map per item
    const shopStockMap = {}
    for (const row of (invData || [])) {
      if (!shopStockMap[row.item_id]) shopStockMap[row.item_id] = {}
      shopStockMap[row.item_id][row.shop_id] = (shopStockMap[row.item_id][row.shop_id] || 0) + (row.quantity || 0)
    }

    // Attach from-shop stock to each item
    const itemsWithShopStock = (itms || []).map(item => ({
      ...item,
      shopStockMap: shopStockMap[item.id] || {},
    }))
    setItems(itemsWithShopStock)

    if (sh && activeShop) {
      setFromShop(sh.find(s => s.id === activeShop.id) || sh[0])
    } else if (sh && sh.length > 0) {
      setFromShop(sh[0])
    }
    setLoading(false)
  }

  function addItem(item) {
    const fromShopQty = fromShop ? (item.shopStockMap?.[fromShop.id] || 0) : (item.stock_quantity || 0)
    const idx = transferItems.findIndex(r => r.item_id === item.id)
    if (idx >= 0) {
      setTransferItems(rows => rows.map((r, i) => i === idx ? { ...r, quantity: r.quantity + 1 } : r))
    } else {
      setTransferItems(rows => [...rows, {
        item_id: item.id,
        name: item.name,
        item_no: item.item_no,
        quantity: 1,
        stock_quantity: fromShopQty,
      }])
    }
    setItemSearch('')
    setShowItemDrop(false)
    setTimeout(() => itemRef.current?.focus(), 50)
  }

  async function saveTransfer(status) {
    if (!fromShop) return toast.error('Select source shop')
    if (!toShop) return toast.error('Select destination shop')
    if (fromShop.id === toShop.id) return toast.error('Source and destination shops must be different')
    if (transferItems.length === 0) return toast.error('Add at least one item')

    // Validate stock availability at FROM shop
    for (const row of transferItems) {
      const item = items.find(i => i.item_id === row.item_id || i.id === row.item_id)
      const fromShopQty = fromShop ? (item?.shopStockMap?.[fromShop.id] || 0) : (item?.stock_quantity || 0)
      if (fromShopQty < row.quantity) {
        toast.error(`Not enough stock for "${row.name}" at ${fromShop?.name}. Available: ${fromShopQty}, Requested: ${row.quantity}`)
        return
      }
    }

    setSaving(true)
    try {
      const transferNo = await generateTransferNo()
      const { data: transfer, error: trErr } = await supabase.from('stock_transfers').insert({
        transfer_no: transferNo,
        from_shop_id: fromShop.id,
        to_shop_id: toShop.id,
        status,
        notes,
        created_by: session?.user?.id,
      }).select().single()
      if (trErr) throw trErr

      await supabase.from('stock_transfer_items').insert(
        transferItems.map(r => ({
          transfer_id: transfer.id,
          item_id: r.item_id,
          quantity: r.quantity,
        }))
      )

      if (status === 'confirmed') {
        for (const row of transferItems) {
          // Atomic FIFO batch transfer — locks and moves stock server-side
          const { error: transferErr } = await supabase.rpc('transfer_stock_between_shops', {
            p_item_id: row.item_id, p_from_shop_id: fromShop.id, p_to_shop_id: toShop.id, p_quantity: row.quantity,
          })
          if (transferErr) throw transferErr
          // Note: items.stock_quantity is global total — does NOT change on transfer
        }
        toast.success(`Transfer ${transferNo} confirmed! ${fromShop.name} → ${toShop.name}`)
      } else {
        toast.success('Transfer saved as draft')
      }

      resetForm()
      setActiveTab('list')
      fetchData()
    } catch (e) { toast.error('Error: ' + e.message) }
    setSaving(false)
  }

  // Refresh stock quantities shown in form when from-shop changes
  useEffect(() => {
    if (fromShop) {
      setTransferItems(rows => rows.map(r => {
        const item = items.find(i => i.id === r.item_id)
        return { ...r, stock_quantity: item?.shopStockMap?.[fromShop.id] || 0 }
      }))
    }
  }, [fromShop])

  function resetForm() {
    setTransferItems([])
    setToShop(null)
    setNotes('')
    setItemSearch('')
  }

  const filteredItems = items.filter(i =>
    i.name.toLowerCase().includes(itemSearch.toLowerCase()) ||
    i.item_no?.toLowerCase().includes(itemSearch.toLowerCase())
  )

  const statusBadge = (s) => {
    const m = { draft: { bg: '#fef3c7', color: '#92400e' }, confirmed: { bg: '#dcfce7', color: '#166534' }, cancelled: { bg: '#fee2e2', color: '#991b1b' } }
    const st = m[s] || m.draft
    return <span style={{ background: st.bg, color: st.color, padding: '3px 10px', borderRadius: '20px', fontSize: '12px', fontWeight: '700' }}>{s}</span>
  }

  const inp = { width: '100%', padding: '9px 12px', border: '1.5px solid #e2e8f0', borderRadius: '7px', fontSize: '14px', boxSizing: 'border-box', outline: 'none', background: 'white' }
  const lbl = { display: 'block', marginBottom: '5px', fontSize: '11px', fontWeight: '700', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.06em' }
  const card = { background: 'white', borderRadius: '12px', padding: '24px', boxShadow: '0 1px 3px rgba(15,23,42,0.06), 0 1px 2px rgba(15,23,42,0.04)', marginBottom: '16px', border: '1px solid #f1f5f9' }
  const drop = { position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0, background: 'white', border: '1.5px solid #e2e8f0', borderRadius: '10px', boxShadow: '0 8px 24px rgba(0,0,0,0.12)', zIndex: 200, maxHeight: '220px', overflowY: 'auto' }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '24px' }}>
        <div>
          <h1 style={{ fontSize: '22px', fontWeight: '700', color: '#0f172a', margin: '0 0 4px' }}>Stock Transfers</h1>
          <p style={{ color: '#64748b', fontSize: '14px', margin: 0 }}>Move stock between shops at zero cost</p>
        </div>
        <button onClick={() => { setActiveTab(activeTab === 'new' ? 'list' : 'new'); resetForm() }}
          style={{ padding: '10px 20px', background: activeTab === 'new' ? '#f1f5f9' : 'linear-gradient(135deg,#2563eb,#1d4ed8)', color: activeTab === 'new' ? '#475569' : 'white', border: 'none', borderRadius: '10px', cursor: 'pointer', fontWeight: '700', fontSize: '14px' }}>
          {activeTab === 'new' ? '← Back to List' : '+ New Transfer'}
        </button>
      </div>

      {/* ── LIST ── */}
      {activeTab === 'list' && (
        <div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: '16px', marginBottom: '20px' }}>
            {[
              { label: 'Total Transfers', value: transfers.length, color: '#1e40af' },
              { label: 'Confirmed', value: transfers.filter(t => t.status === 'confirmed').length, color: '#059669' },
              { label: 'Drafts', value: transfers.filter(t => t.status === 'draft').length, color: '#d97706' },
            ].map(s => (
              <div key={s.label} style={{ background: 'white', borderRadius: '12px', padding: '20px', boxShadow: '0 1px 3px rgba(15,23,42,0.06), 0 1px 2px rgba(15,23,42,0.04)', borderLeft: `4px solid ${s.color}` }}>
                <div style={{ fontSize: '12px', fontWeight: '700', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '6px' }}>{s.label}</div>
                <div style={{ fontSize: '22px', fontWeight: '800', color: s.color }}>{s.value}</div>
              </div>
            ))}
          </div>

          <div style={{ background: 'white', borderRadius: '12px', boxShadow: '0 1px 3px rgba(15,23,42,0.06), 0 1px 2px rgba(15,23,42,0.04)', overflow: 'hidden' }}>
            {loading ? <div style={{ padding: '60px', textAlign: 'center', color: '#94a3b8' }}>Loading...</div>
            : transfers.length === 0 ? (
              <div style={{ padding: '60px', textAlign: 'center', color: '#94a3b8' }}>
                <div style={{ fontSize: '36px', marginBottom: '12px' }}>🏪</div>
                No stock transfers yet
              </div>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ background: '#f8fafc', borderBottom: '2px solid #e2e8f0' }}>
                    {['Transfer No', 'Date', 'From', 'To', 'Status', 'Notes'].map(h => (
                      <th key={h} style={{ padding: '11px 14px', textAlign: 'left', fontSize: '11px', fontWeight: '700', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {transfers.map((t, i) => (
                    <tr key={t.id} style={{ borderBottom: '1px solid #f1f5f9', background: i % 2 === 0 ? 'white' : '#fafafa' }}>
                      <td style={{ padding: '12px 14px', fontWeight: '700', color: '#2563eb', fontSize: '13px' }}>{t.transfer_no}</td>
                      <td style={{ padding: '12px 14px', fontSize: '13px', color: '#64748b' }}>{new Date(t.created_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}</td>
                      <td style={{ padding: '12px 14px', fontSize: '14px', fontWeight: '600', color: '#e11d48' }}>{t.from_shop?.name || '—'}</td>
                      <td style={{ padding: '12px 14px', fontSize: '14px', fontWeight: '600', color: '#059669' }}>{t.to_shop?.name || '—'}</td>
                      <td style={{ padding: '12px 14px' }}>{statusBadge(t.status)}</td>
                      <td style={{ padding: '12px 14px', fontSize: '13px', color: '#64748b' }}>{t.notes || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {/* ── NEW TRANSFER ── */}
      {activeTab === 'new' && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', marginBottom: '20px' }}>
            <button onClick={() => saveTransfer('draft')} disabled={saving}
              style={{ padding: '10px 20px', background: 'white', color: '#475569', border: '1.5px solid #e2e8f0', borderRadius: '10px', cursor: 'pointer', fontWeight: '600', fontSize: '14px' }}>
              💾 Save Draft
            </button>
            <button onClick={() => saveTransfer('confirmed')} disabled={saving}
              style={{ padding: '10px 24px', background: saving ? '#93c5fd' : 'linear-gradient(135deg,#2563eb,#1d4ed8)', color: 'white', border: 'none', borderRadius: '10px', cursor: 'pointer', fontWeight: '700', fontSize: '14px' }}>
              {saving ? 'Processing...' : '✓ Confirm Transfer'}
            </button>
          </div>

          {/* Shop selector */}
          <div style={{ ...card, display: 'grid', gridTemplateColumns: '1fr auto 1fr', gap: '16px', alignItems: 'end' }}>
            <div>
              <label style={lbl}>From Shop *</label>
              {isCashier ? (
                <div style={{ padding: '9px 12px', background: '#f8fafc', border: '1.5px solid #e2e8f0', borderRadius: '7px', fontSize: '14px', fontWeight: '600', color: '#0f172a' }}>
                  {fromShop?.name || '—'} <span style={{ fontSize: '11px', color: '#94a3b8', fontWeight: '400' }}>(your shop)</span>
                </div>
              ) : (
                <select value={fromShop?.id || ''} onChange={e => setFromShop(shops.find(s => s.id === e.target.value) || null)} style={inp}>
                  <option value="">Select source shop</option>
                  {shops.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              )}
            </div>
            <div style={{ textAlign: 'center', paddingBottom: '10px', fontSize: '24px', color: '#2563eb', fontWeight: '700' }}>→</div>
            <div>
              <label style={lbl}>To Shop *</label>
              <select value={toShop?.id || ''} onChange={e => setToShop(shops.find(s => s.id === e.target.value) || null)} style={inp}>
                <option value="">Select destination shop</option>
                {shops.filter(s => s.id !== fromShop?.id).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
          </div>

          {fromShop && toShop && (
            <div style={{ padding: '12px 16px', background: '#eef2ff', borderRadius: '10px', border: '1px solid #bfdbfe', marginBottom: '16px', fontSize: '13px', color: '#1e3a8a', fontWeight: '600' }}>
              📦 Transferring stock from <strong>{fromShop.name}</strong> → <strong>{toShop.name}</strong> at zero cost
            </div>
          )}

          {/* Items */}
          <div style={card}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
              <h2 style={{ margin: 0, fontSize: '15px', fontWeight: '700', color: '#0f172a' }}>Items to Transfer</h2>
              <span style={{ fontSize: '13px', color: '#94a3b8' }}>{transferItems.length} item{transferItems.length !== 1 ? 's' : ''}</span>
            </div>

            <div style={{ position: 'relative', marginBottom: '16px' }}>
              <input ref={itemRef} type="text" placeholder="Search item to transfer…" value={itemSearch}
                onChange={e => { setItemSearch(e.target.value); setShowItemDrop(true) }}
                onFocus={() => setShowItemDrop(true)}
                onBlur={() => setTimeout(() => setShowItemDrop(false), 180)}
                style={{ ...inp, background: '#f8fafc' }} />
              {showItemDrop && (
                <div style={drop}>
                  {filteredItems.length === 0 && <div style={{ padding: '12px 14px', color: '#94a3b8', fontSize: '13px' }}>No items found</div>}
                  {filteredItems.map(item => {
                    const fromShopQty = fromShop ? (item.shopStockMap?.[fromShop.id] || 0) : (item.stock_quantity || 0)
                    return (
                      <div key={item.id} onMouseDown={() => addItem(item)}
                        style={{ padding: '10px 14px', cursor: fromShopQty > 0 ? 'pointer' : 'default', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #f8fafc', fontSize: '14px', opacity: fromShopQty > 0 ? 1 : 0.5 }}
                        onMouseEnter={e => { if (fromShopQty > 0) e.currentTarget.style.background = '#f8fafc' }}
                        onMouseLeave={e => e.currentTarget.style.background = 'white'}>
                        <span>
                          <span style={{ fontWeight: '700', color: '#2563eb', marginRight: '8px', fontSize: '12px' }}>{item.item_no}</span>
                          {item.name}
                        </span>
                        <span style={{ fontSize: '12px', fontWeight: '700', color: fromShopQty > 0 ? '#059669' : '#e11d48' }}>
                          {fromShop?.name || 'Total'}: {fromShopQty}
                        </span>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>

            {transferItems.length > 0 ? (
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ background: '#f8fafc', borderBottom: '2px solid #e2e8f0' }}>
                    {['#', 'Item', 'Available Stock', 'Transfer Qty', ''].map((h, i) => (
                      <th key={i} style={{ padding: '10px 12px', textAlign: 'left', fontSize: '11px', fontWeight: '700', color: '#94a3b8', textTransform: 'uppercase' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {transferItems.map((row, idx) => {
                    const overQty = row.quantity > row.stock_quantity
                    return (
                      <tr key={idx} style={{ borderBottom: '1px solid #f1f5f9', background: overQty ? '#fff5f5' : 'white' }}>
                        <td style={{ padding: '10px 12px', fontSize: '12px', color: '#94a3b8', fontWeight: '700' }}>{idx + 1}</td>
                        <td style={{ padding: '10px 12px' }}>
                          <div style={{ fontSize: '14px', fontWeight: '600', color: '#0f172a' }}>{row.name}</div>
                          <div style={{ fontSize: '11px', color: '#2563eb' }}>{row.item_no}</div>
                        </td>
                        <td style={{ padding: '10px 12px', fontSize: '14px', fontWeight: '700', color: row.stock_quantity > 0 ? '#059669' : '#e11d48' }}>
                          {row.stock_quantity}
                        </td>
                        <td style={{ padding: '10px 12px' }}>
                          <input type="number" value={row.quantity} min="1"
                            onChange={e => setTransferItems(rows => rows.map((r, i) => i === idx ? { ...r, quantity: parseFloat(e.target.value) || 1 } : r))}
                            onFocus={e => e.target.select()}
                            style={{ ...inp, width: '90px', textAlign: 'center', fontWeight: '700', borderColor: overQty ? '#fca5a5' : '#e2e8f0' }} />
                          {overQty && <div style={{ fontSize: '11px', color: '#e11d48', marginTop: '3px' }}>Exceeds stock</div>}
                        </td>
                        <td style={{ padding: '10px 12px' }}>
                          <button onClick={() => setTransferItems(rows => rows.filter((_, i) => i !== idx))}
                            style={{ width: '28px', height: '28px', background: '#fee2e2', color: '#dc2626', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '14px' }}>✕</button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            ) : (
              <div style={{ padding: '32px', textAlign: 'center', color: '#cbd5e1', border: '2px dashed #e2e8f0', borderRadius: '10px' }}>
                <div style={{ fontSize: '28px', marginBottom: '8px' }}>📦</div>
                Search above to add items to transfer
              </div>
            )}
          </div>

          {/* Notes */}
          <div style={card}>
            <label style={lbl}>Notes</label>
            <textarea value={notes} onChange={e => setNotes(e.target.value)}
              placeholder="Reason for transfer or any notes…" rows={3}
              style={{ ...inp, resize: 'vertical', lineHeight: '1.5' }} />
          </div>
        </div>
      )}
    </div>
  )
}
