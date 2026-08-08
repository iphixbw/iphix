import { useState, useEffect } from 'react'
import { supabase } from '../../supabase'
import { formatCurrency } from '../../lib/helpers'
import toast from 'react-hot-toast'

const inp = { width: '100%', padding: '9px 12px', border: '1.5px solid #e2e8f0', borderRadius: '7px', fontSize: '14px', boxSizing: 'border-box', outline: 'none' }
const lbl = { display: 'block', marginBottom: '5px', fontSize: '11px', fontWeight: '700', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.06em' }

export default function WarrantyClaims({ activeShop, isCashier = false }) {
  const [claims, setClaims] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [saving, setSaving] = useState(false)

  // Form state
  const [invoiceSearch, setInvoiceSearch] = useState('')
  const [invoiceResults, setInvoiceResults] = useState([])
  const [selectedInvoice, setSelectedInvoice] = useState(null)
  const [invoiceLines, setInvoiceLines] = useState([])
  const [selectedLine, setSelectedLine] = useState(null)
  const [defectNote, setDefectNote] = useState('')
  const [itemSearch, setItemSearch] = useState('')
  const [itemResults, setItemResults] = useState([])
  const [replacementItem, setReplacementItem] = useState(null)
  const [quantity, setQuantity] = useState(1)

  useEffect(() => { fetchClaims() }, [activeShop?.id])

  async function fetchClaims() {
    setLoading(true)
    let q = supabase.from('warranty_claims').select('*, invoices(invoice_no), customers(name), items!warranty_claims_defective_item_id_fkey(name), replacement:items!warranty_claims_replacement_item_id_fkey(name)')
      .eq('division', 'retail').order('created_at', { ascending: false })
    if (activeShop?.id) q = q.eq('shop_id', activeShop.id)
    const { data, error } = await q
    if (error) toast.error('Failed to load warranty claims')
    setClaims(data || [])
    setLoading(false)
  }

  async function searchInvoices(text) {
    setInvoiceSearch(text)
    if (!text.trim()) { setInvoiceResults([]); return }
    let q = supabase.from('invoices').select('*, customers(name)').eq('status', 'confirmed')
      .or(`invoice_no.ilike.%${text}%`).order('created_at', { ascending: false }).limit(15)
    const { data } = await q
    setInvoiceResults(data || [])
  }

  async function selectInvoice(inv) {
    setSelectedInvoice(inv)
    setInvoiceResults([])
    setInvoiceSearch(inv.invoice_no)
    setSelectedLine(null)
    const { data } = await supabase.from('invoice_items').select('*, items(name, item_no)').eq('invoice_id', inv.id)
    setInvoiceLines(data || [])
  }

  async function searchItems(text) {
    setItemSearch(text)
    if (!text.trim()) { setItemResults([]); return }
    const { data } = await supabase.from('items').select('id, name, item_no, stock_quantity, selling_price')
      .or(`name.ilike.%${text}%,item_no.ilike.%${text}%,barcode.ilike.%${text}%`).limit(15)
    setItemResults(data || [])
  }

  function resetForm() {
    setSelectedInvoice(null); setInvoiceSearch(''); setInvoiceResults([]); setInvoiceLines([])
    setSelectedLine(null); setDefectNote('')
    setItemSearch(''); setItemResults([]); setReplacementItem(null); setQuantity(1)
  }

  async function confirmClaim() {
    if (!selectedInvoice) return toast.error('Select the original invoice')
    if (!selectedLine) return toast.error('Select which item is faulty')
    if (!defectNote.trim()) return toast.error('Enter a note describing the defect')
    if (!replacementItem) return toast.error('Select the replacement item')
    if (quantity <= 0) return toast.error('Quantity must be at least 1')
    if ((replacementItem.stock_quantity || 0) < quantity) {
      return toast.error(`Not enough stock for "${replacementItem.name}" — available: ${replacementItem.stock_quantity || 0}`)
    }
    setSaving(true)
    try {
      // Deduct the replacement unit from sellable stock — atomic, floor-guarded RPC
      const { error: deductErr } = await supabase.rpc('deduct_item_stock', { p_item_id: replacementItem.id, p_quantity: quantity })
      if (deductErr) throw deductErr

      // The defective unit the customer returned also came out of what they had —
      // it does NOT go back into sellable stock. It's already outside stock_quantity
      // (it left when the original invoice was sold), so no inventory movement is
      // needed for it beyond this claim record, which is the note/audit trail.
      const { data: claimNo } = await supabase.rpc('generate_warranty_claim_no')
      const { error } = await supabase.from('warranty_claims').insert({
        claim_no: claimNo,
        division: 'retail',
        shop_id: activeShop?.id || null,
        invoice_id: selectedInvoice.id,
        invoice_item_id: selectedLine.id,
        customer_id: selectedInvoice.customer_id,
        defective_item_id: selectedLine.item_id,
        defect_note: defectNote,
        replacement_item_id: replacementItem.id,
        quantity,
      })
      if (error) throw error

      toast.success(`Warranty claim ${claimNo} recorded — replacement issued`)
      setShowForm(false)
      resetForm()
      fetchClaims()
    } catch (e) {
      toast.error('Failed to record claim: ' + e.message)
    }
    setSaving(false)
  }

  async function voidClaim(claim) {
    if (!window.confirm(`Void claim ${claim.claim_no}? This will restore the replacement item's stock. The defective unit is not affected.`)) return
    try {
      if (claim.replacement_item_id) {
        await supabase.rpc('add_item_stock', { p_item_id: claim.replacement_item_id, p_quantity: claim.quantity })
      }
      await supabase.from('warranty_claims').update({ status: 'voided' }).eq('id', claim.id)
      toast.success('Claim voided')
      fetchClaims()
    } catch (e) {
      toast.error('Failed: ' + e.message)
    }
  }

  const filtered = claims.filter(c =>
    !search ||
    c.claim_no?.toLowerCase().includes(search.toLowerCase()) ||
    c.invoices?.invoice_no?.toLowerCase().includes(search.toLowerCase()) ||
    c.customers?.name?.toLowerCase().includes(search.toLowerCase())
  )

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '20px' }}>
        <div>
          <h1 style={{ fontSize: '22px', fontWeight: '700', color: '#0f172a', margin: '0 0 4px' }}>Warranty Claims</h1>
          <p style={{ color: '#64748b', fontSize: '14px', margin: 0 }}>{claims.filter(c => c.status === 'confirmed').length} claims — defective items exchanged under warranty, no charge to customer</p>
        </div>
        <button onClick={() => setShowForm(true)}
          style={{ padding: '11px 22px', background: 'linear-gradient(135deg,#2563eb,#1d4ed8)', color: 'white', border: 'none', borderRadius: '10px', cursor: 'pointer', fontWeight: '700', fontSize: '14px' }}>
          + New Warranty Claim
        </button>
      </div>

      <input type="text" placeholder="Search claim no, invoice no, or customer…" value={search} onChange={e => setSearch(e.target.value)}
        style={{ ...inp, marginBottom: '16px' }} />

      <div style={{ background: 'white', borderRadius: '12px', boxShadow: '0 1px 3px rgba(0,0,0,0.06)', overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ background: '#f8fafc' }}>
              {['Claim No', 'Date', 'Invoice', 'Customer', 'Defective Item', 'Replacement', 'Qty', 'Status'].map(h => (
                <th key={h} style={{ padding: '10px 14px', textAlign: 'left', fontSize: '11px', fontWeight: '700', color: '#94a3b8', textTransform: 'uppercase' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={8} style={{ padding: '40px', textAlign: 'center', color: '#94a3b8' }}>Loading…</td></tr>
            ) : filtered.length === 0 ? (
              <tr><td colSpan={8} style={{ padding: '40px', textAlign: 'center', color: '#94a3b8' }}>No warranty claims yet</td></tr>
            ) : filtered.map(c => (
              <tr key={c.id} style={{ borderTop: '1px solid #f1f5f9', opacity: c.status === 'voided' ? 0.5 : 1 }}>
                <td style={{ padding: '10px 14px', fontWeight: '700', color: '#2563eb', fontSize: '13px' }}>{c.claim_no}</td>
                <td style={{ padding: '10px 14px', fontSize: '13px', color: '#64748b' }}>{new Date(c.created_at).toLocaleDateString('en-GB')}</td>
                <td style={{ padding: '10px 14px', fontSize: '13px', color: '#2563eb' }}>{c.invoices?.invoice_no || '—'}</td>
                <td style={{ padding: '10px 14px', fontSize: '13px' }}>{c.customers?.name || '—'}</td>
                <td style={{ padding: '10px 14px', fontSize: '13px' }}>{c.items?.name || c.defective_description || '—'}</td>
                <td style={{ padding: '10px 14px', fontSize: '13px', fontWeight: '600' }}>{c.replacement?.name || '—'}</td>
                <td style={{ padding: '10px 14px', fontSize: '13px' }}>{c.quantity}</td>
                <td style={{ padding: '10px 14px' }}>
                  {c.status === 'voided' ? (
                    <span style={{ fontSize: '11px', fontWeight: '700', color: '#94a3b8' }}>VOIDED</span>
                  ) : !isCashier ? (
                    <button onClick={() => voidClaim(c)} style={{ padding: '4px 10px', background: '#fef2f2', color: '#e11d48', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '11px', fontWeight: '700' }}>Void</button>
                  ) : (
                    <span style={{ fontSize: '11px', fontWeight: '700', color: '#059669' }}>CONFIRMED</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showForm && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '20px' }}
          onClick={e => { if (e.target === e.currentTarget) { setShowForm(false); resetForm() } }}>
          <div style={{ background: 'white', borderRadius: '16px', padding: '28px', width: '100%', maxWidth: '640px', maxHeight: '90vh', overflowY: 'auto' }}>
            <h2 style={{ fontSize: '18px', fontWeight: '800', color: '#0f172a', margin: '0 0 4px' }}>New Warranty Claim</h2>
            <p style={{ fontSize: '13px', color: '#94a3b8', margin: '0 0 20px' }}>Replace a defective item under warranty — no charge to the customer</p>

            {/* Step 1: find the original invoice */}
            <div style={{ marginBottom: '16px', position: 'relative' }}>
              <label style={lbl}>Original Invoice *</label>
              <input type="text" placeholder="Search invoice no…" value={invoiceSearch}
                onChange={e => searchInvoices(e.target.value)} style={inp} disabled={!!selectedInvoice} />
              {selectedInvoice && (
                <button onClick={() => { setSelectedInvoice(null); setInvoiceSearch(''); setInvoiceLines([]); setSelectedLine(null) }}
                  style={{ marginTop: '6px', fontSize: '12px', color: '#2563eb', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}>Change invoice</button>
              )}
              {invoiceResults.length > 0 && (
                <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: 'white', border: '1px solid #e2e8f0', borderRadius: '8px', marginTop: '4px', maxHeight: '220px', overflowY: 'auto', zIndex: 10, boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }}>
                  {invoiceResults.map(inv => (
                    <div key={inv.id} onClick={() => selectInvoice(inv)}
                      style={{ padding: '10px 14px', cursor: 'pointer', borderBottom: '1px solid #f1f5f9', fontSize: '13px' }}
                      onMouseEnter={e => e.currentTarget.style.background = '#f8fafc'}
                      onMouseLeave={e => e.currentTarget.style.background = 'white'}>
                      <span style={{ fontWeight: '700', color: '#2563eb' }}>{inv.invoice_no}</span> · {inv.customers?.name || 'Cash'} · {formatCurrency(inv.total)}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Step 2: pick which line item is faulty */}
            {selectedInvoice && (
              <div style={{ marginBottom: '16px' }}>
                <label style={lbl}>Which item is faulty? *</label>
                {invoiceLines.length === 0 ? (
                  <div style={{ padding: '10px', fontSize: '13px', color: '#94a3b8' }}>No items on this invoice</div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    {invoiceLines.map(line => (
                      <div key={line.id} onClick={() => setSelectedLine(line)}
                        style={{ padding: '10px 12px', border: `1.5px solid ${selectedLine?.id === line.id ? '#2563eb' : '#e2e8f0'}`, borderRadius: '8px', cursor: 'pointer', background: selectedLine?.id === line.id ? '#eff6ff' : 'white', fontSize: '13px' }}>
                        <strong>{line.items?.name}</strong> · Qty {line.quantity} · {formatCurrency(line.unit_price)} each
                        {line.warranty && <span style={{ marginLeft: '8px', fontSize: '11px', color: '#059669', fontWeight: '700' }}>Warranty: {line.warranty}</span>}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {selectedLine && (
              <>
                <div style={{ marginBottom: '16px' }}>
                  <label style={lbl}>Defect Note *</label>
                  <textarea value={defectNote} onChange={e => setDefectNote(e.target.value)}
                    placeholder="Describe the fault — this stays on record for the defective unit" style={{ ...inp, minHeight: '64px' }} />
                </div>

                <div style={{ marginBottom: '16px', position: 'relative' }}>
                  <label style={lbl}>Replacement Item *</label>
                  <input type="text" placeholder="Search item name or code…" value={itemSearch}
                    onChange={e => searchItems(e.target.value)} style={inp} disabled={!!replacementItem} />
                  {replacementItem && (
                    <div style={{ marginTop: '8px', padding: '10px 12px', background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '8px', fontSize: '13px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span><strong>{replacementItem.name}</strong> · In stock: {replacementItem.stock_quantity || 0}</span>
                      <button onClick={() => { setReplacementItem(null); setItemSearch('') }} style={{ background: 'none', border: 'none', color: '#059669', cursor: 'pointer', fontSize: '12px', fontWeight: '700' }}>Change</button>
                    </div>
                  )}
                  {itemResults.length > 0 && (
                    <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: 'white', border: '1px solid #e2e8f0', borderRadius: '8px', marginTop: '4px', maxHeight: '220px', overflowY: 'auto', zIndex: 10, boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }}>
                      {itemResults.map(it => (
                        <div key={it.id} onClick={() => { setReplacementItem(it); setItemResults([]); setItemSearch(it.name) }}
                          style={{ padding: '10px 14px', cursor: 'pointer', borderBottom: '1px solid #f1f5f9', fontSize: '13px' }}
                          onMouseEnter={e => e.currentTarget.style.background = '#f8fafc'}
                          onMouseLeave={e => e.currentTarget.style.background = 'white'}>
                          <strong>{it.name}</strong> · Stock: {it.stock_quantity || 0}
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div style={{ marginBottom: '20px', maxWidth: '140px' }}>
                  <label style={lbl}>Quantity</label>
                  <input type="number" min="1" value={quantity} onChange={e => setQuantity(parseInt(e.target.value) || 1)} style={inp} />
                </div>

                <div style={{ padding: '10px 12px', background: '#fffbeb', border: '1px solid #fde68a', borderRadius: '8px', fontSize: '12px', color: '#92400e', marginBottom: '20px' }}>
                  💡 No charge to the customer. The replacement's stock is deducted; the defective unit is not added back to sellable stock.
                </div>
              </>
            )}

            <div style={{ display: 'flex', gap: '10px' }}>
              <button onClick={() => { setShowForm(false); resetForm() }} style={{ flex: 1, padding: '11px', background: '#f1f5f9', border: 'none', borderRadius: '10px', cursor: 'pointer', fontWeight: '700', color: '#64748b' }}>Cancel</button>
              <button onClick={confirmClaim} disabled={saving || !selectedLine || !replacementItem}
                style={{ flex: 2, padding: '11px', background: saving || !selectedLine || !replacementItem ? '#cbd5e1' : 'linear-gradient(135deg,#2563eb,#1d4ed8)', border: 'none', borderRadius: '10px', cursor: saving ? 'default' : 'pointer', fontWeight: '800', color: 'white' }}>
                {saving ? 'Processing…' : '✓ Confirm Warranty Claim'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
