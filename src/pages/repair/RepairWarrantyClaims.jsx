import { useState, useEffect } from 'react'
import { supabase } from '../../supabase'
import { formatLKR } from '../../lib/repairConstants'
import toast from 'react-hot-toast'

const inp = { width: '100%', padding: '9px 12px', border: '1.5px solid #e7dfd3', borderRadius: '8px', fontSize: '14px', boxSizing: 'border-box' }
const lbl = { display: 'block', marginBottom: '5px', fontSize: '11px', fontWeight: '700', color: '#a89478', textTransform: 'uppercase' }

export default function RepairWarrantyClaims({ shop }) {
  const [claims, setClaims] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [saving, setSaving] = useState(false)

  // Form state
  const [jobSearch, setJobSearch] = useState('')
  const [jobResults, setJobResults] = useState([])
  const [selectedJob, setSelectedJob] = useState(null)
  const [defectiveDescription, setDefectiveDescription] = useState('')
  const [defectNote, setDefectNote] = useState('')
  const [replacementType, setReplacementType] = useState('part') // 'part' | 'description'
  const [partSearch, setPartSearch] = useState('')
  const [partResults, setPartResults] = useState([])
  const [replacementPart, setReplacementPart] = useState(null)
  const [replacementDescription, setReplacementDescription] = useState('')
  const [quantity, setQuantity] = useState(1)

  useEffect(() => { fetchClaims() }, [shop?.id])

  async function fetchClaims() {
    setLoading(true)
    let q = supabase.from('warranty_claims').select('*, repair_jobs(job_no), repair_customers(name, mobile), repair_parts!warranty_claims_replacement_part_id_fkey(name)')
      .eq('division', 'repair').order('created_at', { ascending: false })
    if (shop?.id) q = q.eq('shop_id', shop.id)
    const { data, error } = await q
    if (error) toast.error('Failed to load warranty claims')
    setClaims(data || [])
    setLoading(false)
  }

  async function searchJobs(text) {
    setJobSearch(text)
    if (!text.trim()) { setJobResults([]); return }
    const { data } = await supabase.from('repair_jobs').select('*, repair_customers(name, mobile)')
      .ilike('job_no', `%${text}%`).order('created_at', { ascending: false }).limit(15)
    setJobResults(data || [])
  }

  function selectJob(job) {
    setSelectedJob(job)
    setJobResults([])
    setJobSearch(job.job_no)
  }

  async function searchParts(text) {
    setPartSearch(text)
    if (!text.trim()) { setPartResults([]); return }
    const { data } = await supabase.from('repair_parts').select('id, name, sku, current_stock')
      .or(`name.ilike.%${text}%,sku.ilike.%${text}%`).limit(15)
    setPartResults(data || [])
  }

  function resetForm() {
    setSelectedJob(null); setJobSearch(''); setJobResults([])
    setDefectiveDescription(''); setDefectNote('')
    setReplacementType('part'); setPartSearch(''); setPartResults([]); setReplacementPart(null)
    setReplacementDescription(''); setQuantity(1)
  }

  async function confirmClaim() {
    if (!selectedJob) return toast.error('Select the original repair job')
    if (!defectiveDescription.trim()) return toast.error('Describe what came back faulty (e.g. the repaired screen, the device itself)')
    if (!defectNote.trim()) return toast.error('Enter a note describing the defect')
    if (replacementType === 'part' && !replacementPart) return toast.error('Select the replacement part')
    if (replacementType === 'description' && !replacementDescription.trim()) return toast.error('Describe the replacement given')
    if (quantity <= 0) return toast.error('Quantity must be at least 1')
    if (replacementType === 'part' && (replacementPart.current_stock || 0) < quantity) {
      return toast.error(`Not enough stock for "${replacementPart.name}" — available: ${replacementPart.current_stock || 0}`)
    }
    setSaving(true)
    try {
      // Deduct the replacement part's stock — atomic, floor-guarded RPC. Only applies
      // when a stocked part is the replacement; a free-text replacement (e.g. "whole
      // unit swapped from another job") has no stock record to touch.
      if (replacementType === 'part') {
        const { error: deductErr } = await supabase.rpc('repair_deduct_part_stock', { p_part_id: replacementPart.id, p_quantity: quantity })
        if (deductErr) throw deductErr
      }

      const { data: claimNo } = await supabase.rpc('generate_warranty_claim_no')
      const { error } = await supabase.from('warranty_claims').insert({
        claim_no: claimNo,
        division: 'repair',
        shop_id: shop?.id || null,
        repair_job_id: selectedJob.id,
        repair_customer_id: selectedJob.customer_id,
        defective_description: defectiveDescription,
        defect_note: defectNote,
        replacement_part_id: replacementType === 'part' ? replacementPart.id : null,
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
    if (!window.confirm(`Void claim ${claim.claim_no}? This will restore the replacement part's stock, if one was used.`)) return
    try {
      if (claim.replacement_part_id) {
        // repair_add_part_stock alone only bumps the cached current_stock count —
        // it doesn't touch repair_part_batches, which is what FIFO valuation and
        // job costing actually draw from. Without a matching batch, this part's
        // stock count and its real FIFO value silently drift apart, same as a
        // purchase or opening-balance entry that skipped creating one.
        const { data: part } = await supabase.from('repair_parts').select('average_cost, purchase_price').eq('id', claim.replacement_part_id).single()
        const unitCost = part?.average_cost || part?.purchase_price || 0
        await supabase.rpc('repair_add_part_stock', { p_part_id: claim.replacement_part_id, p_quantity: claim.quantity })
        if (unitCost > 0) {
          await supabase.rpc('repair_fifo_add_batch', { p_part_id: claim.replacement_part_id, p_purchase_id: null, p_quantity: claim.quantity, p_unit_cost: unitCost })
        }
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
    c.repair_jobs?.job_no?.toLowerCase().includes(search.toLowerCase()) ||
    c.repair_customers?.name?.toLowerCase().includes(search.toLowerCase())
  )

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '20px' }}>
        <div>
          <h1 style={{ fontSize: '22px', fontWeight: '800', color: '#1c1917', margin: '0 0 4px' }}>Warranty Claims</h1>
          <p style={{ color: '#8a7a63', fontSize: '14px', margin: 0 }}>{claims.filter(c => c.status === 'confirmed').length} claims — faulty repairs exchanged under warranty, no charge to customer</p>
        </div>
        <button onClick={() => setShowForm(true)}
          style={{ padding: '11px 22px', background: 'linear-gradient(135deg,#f0b23d,#d4881f)', color: '#1c1917', border: 'none', borderRadius: '12px', cursor: 'pointer', fontWeight: '800', fontSize: '14px' }}>
          + New Warranty Claim
        </button>
      </div>

      <input type="text" placeholder="Search claim no, job no, or customer…" value={search} onChange={e => setSearch(e.target.value)}
        style={{ ...inp, marginBottom: '16px' }} />

      <div style={{ background: 'white', borderRadius: '16px', border: '1px solid #f3ede4', overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ background: '#fdf8f3', borderBottom: '2px solid #f3ede4' }}>
              {['Claim No', 'Date', 'Job No', 'Customer', 'Defective Item', 'Replacement', 'Qty', 'Status'].map(h => (
                <th key={h} style={{ padding: '10px 14px', textAlign: 'left', fontSize: '10px', fontWeight: '700', color: '#a89478', textTransform: 'uppercase' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={8} style={{ padding: '40px', textAlign: 'center', color: '#a89478' }}>Loading…</td></tr>
            ) : filtered.length === 0 ? (
              <tr><td colSpan={8} style={{ padding: '40px', textAlign: 'center', color: '#a89478' }}>No warranty claims yet</td></tr>
            ) : filtered.map(c => (
              <tr key={c.id} style={{ borderTop: '1px solid #f8f5f0', opacity: c.status === 'voided' ? 0.5 : 1 }}>
                <td style={{ padding: '10px 14px', fontWeight: '700', color: '#d4881f', fontSize: '13px' }}>{c.claim_no}</td>
                <td style={{ padding: '10px 14px', fontSize: '13px', color: '#78716c' }}>{new Date(c.created_at).toLocaleDateString('en-GB')}</td>
                <td style={{ padding: '10px 14px', fontSize: '13px', color: '#d4881f' }}>{c.repair_jobs?.job_no || '—'}</td>
                <td style={{ padding: '10px 14px', fontSize: '13px' }}>{c.repair_customers?.name || '—'}</td>
                <td style={{ padding: '10px 14px', fontSize: '13px' }}>{c.defective_description || '—'}</td>
                <td style={{ padding: '10px 14px', fontSize: '13px', fontWeight: '600' }}>{c.repair_parts?.name || '—'}</td>
                <td style={{ padding: '10px 14px', fontSize: '13px' }}>{c.quantity}</td>
                <td style={{ padding: '10px 14px' }}>
                  {c.status === 'voided' ? (
                    <span style={{ fontSize: '11px', fontWeight: '700', color: '#a89478' }}>VOIDED</span>
                  ) : (
                    <button onClick={() => voidClaim(c)} style={{ padding: '4px 10px', background: '#fef2f2', color: '#e11d48', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '11px', fontWeight: '700' }}>Void</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showForm && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(28,25,23,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '20px' }}
          onClick={e => { if (e.target === e.currentTarget) { setShowForm(false); resetForm() } }}>
          <div style={{ background: 'white', borderRadius: '20px', padding: '28px', width: '100%', maxWidth: '640px', maxHeight: '90vh', overflowY: 'auto' }}>
            <h2 style={{ fontSize: '18px', fontWeight: '800', color: '#1c1917', margin: '0 0 4px' }}>New Warranty Claim</h2>
            <p style={{ fontSize: '13px', color: '#a89478', margin: '0 0 20px' }}>The repaired device came back faulty — exchange it, no charge to the customer</p>

            {/* Step 1: original job */}
            <div style={{ marginBottom: '16px', position: 'relative' }}>
              <label style={lbl}>Original Repair Job *</label>
              <input type="text" placeholder="Search job no…" value={jobSearch}
                onChange={e => searchJobs(e.target.value)} style={inp} disabled={!!selectedJob} />
              {selectedJob && (
                <div style={{ marginTop: '8px', padding: '10px 12px', background: '#fdf8f3', border: '1px solid #f3ede4', borderRadius: '8px', fontSize: '13px', display: 'flex', justifyContent: 'space-between' }}>
                  <span><strong>{selectedJob.job_no}</strong> · {selectedJob.repair_customers?.name}</span>
                  <button onClick={() => { setSelectedJob(null); setJobSearch('') }} style={{ background: 'none', border: 'none', color: '#d4881f', cursor: 'pointer', fontSize: '12px', fontWeight: '700' }}>Change</button>
                </div>
              )}
              {jobResults.length > 0 && (
                <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: 'white', border: '1px solid #e7dfd3', borderRadius: '8px', marginTop: '4px', maxHeight: '220px', overflowY: 'auto', zIndex: 10, boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }}>
                  {jobResults.map(j => (
                    <div key={j.id} onClick={() => selectJob(j)}
                      style={{ padding: '10px 14px', cursor: 'pointer', borderBottom: '1px solid #f8f5f0', fontSize: '13px' }}
                      onMouseEnter={e => e.currentTarget.style.background = '#fdf8f3'}
                      onMouseLeave={e => e.currentTarget.style.background = 'white'}>
                      <span style={{ fontWeight: '700', color: '#d4881f' }}>{j.job_no}</span> · {j.repair_customers?.name} · {j.device_model || ''}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {selectedJob && (
              <>
                <div style={{ marginBottom: '16px' }}>
                  <label style={lbl}>What came back faulty? *</label>
                  <input type="text" placeholder="e.g. the replaced screen, the battery, the whole device" value={defectiveDescription}
                    onChange={e => setDefectiveDescription(e.target.value)} style={inp} />
                </div>

                <div style={{ marginBottom: '16px' }}>
                  <label style={lbl}>Defect Note *</label>
                  <textarea value={defectNote} onChange={e => setDefectNote(e.target.value)}
                    placeholder="Describe the fault — this stays on record" style={{ ...inp, minHeight: '64px' }} />
                </div>

                <div style={{ marginBottom: '10px', display: 'flex', gap: '8px' }}>
                  <button onClick={() => setReplacementType('part')}
                    style={{ flex: 1, padding: '9px', borderRadius: '8px', border: `1.5px solid ${replacementType === 'part' ? '#d4881f' : '#e7dfd3'}`, background: replacementType === 'part' ? '#fdf3e2' : 'white', cursor: 'pointer', fontWeight: '700', fontSize: '13px' }}>
                    Replace with a stocked part
                  </button>
                  <button onClick={() => setReplacementType('description')}
                    style={{ flex: 1, padding: '9px', borderRadius: '8px', border: `1.5px solid ${replacementType === 'description' ? '#d4881f' : '#e7dfd3'}`, background: replacementType === 'description' ? '#fdf3e2' : 'white', cursor: 'pointer', fontWeight: '700', fontSize: '13px' }}>
                    Describe replacement (no stock item)
                  </button>
                </div>

                {replacementType === 'part' ? (
                  <div style={{ marginBottom: '16px', position: 'relative' }}>
                    <label style={lbl}>Replacement Part *</label>
                    <input type="text" placeholder="Search part name or SKU…" value={partSearch}
                      onChange={e => searchParts(e.target.value)} style={inp} disabled={!!replacementPart} />
                    {replacementPart && (
                      <div style={{ marginTop: '8px', padding: '10px 12px', background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '8px', fontSize: '13px', display: 'flex', justifyContent: 'space-between' }}>
                        <span><strong>{replacementPart.name}</strong> · In stock: {replacementPart.current_stock || 0}</span>
                        <button onClick={() => { setReplacementPart(null); setPartSearch('') }} style={{ background: 'none', border: 'none', color: '#059669', cursor: 'pointer', fontSize: '12px', fontWeight: '700' }}>Change</button>
                      </div>
                    )}
                    {partResults.length > 0 && (
                      <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: 'white', border: '1px solid #e7dfd3', borderRadius: '8px', marginTop: '4px', maxHeight: '220px', overflowY: 'auto', zIndex: 10, boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }}>
                        {partResults.map(p => (
                          <div key={p.id} onClick={() => { setReplacementPart(p); setPartResults([]); setPartSearch(p.name) }}
                            style={{ padding: '10px 14px', cursor: 'pointer', borderBottom: '1px solid #f8f5f0', fontSize: '13px' }}
                            onMouseEnter={e => e.currentTarget.style.background = '#fdf8f3'}
                            onMouseLeave={e => e.currentTarget.style.background = 'white'}>
                            <strong>{p.name}</strong> · Stock: {p.current_stock || 0}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ) : (
                  <div style={{ marginBottom: '16px' }}>
                    <label style={lbl}>Replacement Description *</label>
                    <input type="text" placeholder="e.g. whole unit swapped from stock reserve" value={replacementDescription}
                      onChange={e => setReplacementDescription(e.target.value)} style={inp} />
                  </div>
                )}

                <div style={{ marginBottom: '20px', maxWidth: '140px' }}>
                  <label style={lbl}>Quantity</label>
                  <input type="number" min="1" value={quantity} onChange={e => setQuantity(parseInt(e.target.value) || 1)} style={inp} />
                </div>

                <div style={{ padding: '10px 12px', background: '#fdf3e2', border: '1px solid #fde68a', borderRadius: '8px', fontSize: '12px', color: '#92400e', marginBottom: '20px' }}>
                  💡 No charge to the customer. If a stocked part is used as the replacement, its stock is deducted.
                </div>
              </>
            )}

            <div style={{ display: 'flex', gap: '10px' }}>
              <button onClick={() => { setShowForm(false); resetForm() }} style={{ flex: 1, padding: '11px', background: '#f5f1ea', border: 'none', borderRadius: '10px', cursor: 'pointer', fontWeight: '700', color: '#78716c' }}>Cancel</button>
              <button onClick={confirmClaim} disabled={saving || !selectedJob}
                style={{ flex: 2, padding: '11px', background: saving || !selectedJob ? '#e7dfd3' : 'linear-gradient(135deg,#f0b23d,#d4881f)', border: 'none', borderRadius: '10px', cursor: saving ? 'default' : 'pointer', fontWeight: '800', color: '#1c1917' }}>
                {saving ? 'Processing…' : '✓ Confirm Warranty Claim'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
