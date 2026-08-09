import { useState, useEffect } from 'react'
import { supabase } from '../../supabase'
import toast from 'react-hot-toast'
import { JOB_STATUSES, PRIORITIES, CHARGE_TYPES, statusMeta, priorityMeta, formatLKR, timeAgo, printJobReceipt, printJobPaymentReceipt } from '../../lib/repairConstants'

export default function RepairJobDetail({ jobId, shop, onBack }) {
  const [job, setJob] = useState(null)
  const [timeline, setTimeline] = useState([])
  const [jobParts, setJobParts] = useState([])
  const [thirdPartyItems, setThirdPartyItems] = useState([])
  const [jobCharges, setJobCharges] = useState([])
  const [jobPayments, setJobPayments] = useState([])
  const [parts, setParts] = useState([])
  const [loading, setLoading] = useState(true)
  const [showAddPart, setShowAddPart] = useState(false)
  const [showAddCharge, setShowAddCharge] = useState(false)
  const [showCollectCash, setShowCollectCash] = useState(false)
  const [showVoid, setShowVoid] = useState(false)
  const [saving, setSaving] = useState(false)
  const [editingCost, setEditingCost] = useState(false)
  const [costInput, setCostInput] = useState('')
  const [editingPriceId, setEditingPriceId] = useState(null)
  const [priceInput, setPriceInput] = useState('')

  useEffect(() => { refreshAndRecalc() }, [jobId])

  // A plain .select() caps at Supabase's default 1000-row limit — with a large
  // enough parts catalog, some parts silently never show up in the picker below,
  // with no error to indicate anything was cut off.
  async function fetchAllParts() {
    let all = []
    let from = 0
    const PAGE_SIZE = 1000
    while (true) {
      const { data } = await supabase.from('repair_parts').select('*').order('name').range(from, from + PAGE_SIZE - 1)
      all = all.concat(data || [])
      if (!data || data.length < PAGE_SIZE) break
      from += PAGE_SIZE
    }
    return all
  }

  async function fetchAll() {
    setLoading(true)
    const [{ data: j }, { data: tl }, { data: jp }, { data: tpi }, { data: jc }, { data: jpay }, allParts] = await Promise.all([
      supabase.from('repair_jobs').select('*, repair_customers(*)').eq('id', jobId).single(),
      supabase.from('repair_job_timeline').select('*').eq('job_id', jobId).order('created_at', { ascending: true }),
      supabase.from('repair_job_parts').select('*, repair_parts(name, sku)').eq('job_id', jobId).eq('is_third_party', false),
      supabase.from('repair_third_party_items').select('*').eq('job_id', jobId),
      supabase.from('repair_job_charges').select('*').eq('job_id', jobId).order('created_at', { ascending: true }),
      supabase.from('repair_job_payments').select('*, bank_accounts(name)').eq('job_id', jobId).order('created_at', { ascending: true }),
      fetchAllParts(),
    ])
    setJob(j)
    setTimeline(tl || [])
    setJobParts(jp || [])
    setThirdPartyItems(tpi || [])
    setJobCharges(jc || [])
    setJobPayments(jpay || [])
    setParts(allParts || [])
    setLoading(false)
    return { j, jp: jp || [], tpi: tpi || [], jc: jc || [], jpay: jpay || [] }
  }

  // Refetches everything and recalculates financials from the just-fetched data —
  // used after any action that changes parts/charges/payments/income, so the
  // stored totals are always derived from what's actually in the database, not
  // from component state that may not have re-rendered yet.
  async function refreshAndRecalc() {
    const fresh = await fetchAll()
    if (fresh.j && fresh.j.status !== 'voided') {
      const updatedTotals = await recalcTotals(fresh.j, fresh.jp, fresh.tpi, fresh.jc, fresh.jpay)
      // recalcTotals writes the new totals to the database, but fetchAll() above
      // already ran and populated `job` state with the PRE-recalc numbers — without
      // this, the UI kept showing stale financials until something else (like
      // reopening the job) triggered another fetch that finally picked up what
      // recalcTotals had written moments earlier.
      setJob(j => ({ ...j, ...updatedTotals }))
    }
  }

  async function updateStatus(newStatus) {
    setSaving(true)
    try {
      const { error } = await supabase.from('repair_jobs').update({ status: newStatus, updated_at: new Date().toISOString() }).eq('id', jobId)
      if (error) throw error
      toast.success('Status updated!')
      fetchAll()
    } catch (e) { toast.error('Failed: ' + e.message) }
    setSaving(false)
  }

  async function updatePriority(newPriority) {
    setSaving(true)
    try {
      const { error } = await supabase.from('repair_jobs').update({ priority: newPriority }).eq('id', jobId)
      if (error) throw error
      toast.success('Priority updated')
      fetchAll()
    } catch (e) { toast.error('Failed: ' + e.message) }
    setSaving(false)
  }

  async function saveCost() {
    const val = parseFloat(costInput)
    if (isNaN(val) || val < 0) return toast.error('Enter a valid amount')
    setSaving(true)
    try {
      // Just write the new income value here — refreshAndRecalc() below recomputes
      // every derived total (profit, balance due, etc.) from fresh data in one place,
      // so there's no risk of this duplicating (and drifting from) that same math.
      await supabase.from('repair_jobs').update({ estimated_cost: val }).eq('id', jobId)
      setEditingCost(false)
      toast.success('Job income updated')
      await refreshAndRecalc()
    } catch (e) { toast.error('Failed: ' + e.message) }
    setSaving(false)
  }

  async function savePartPrice(partRow) {
    const val = parseFloat(priceInput)
    if (isNaN(val) || val < 0) return toast.error('Enter a valid amount')
    setSaving(true)
    try {
      await supabase.from('repair_job_parts').update({ unit_price: val, line_total: val * partRow.quantity }).eq('id', partRow.id)
      setEditingPriceId(null)
      toast.success('Price updated')
      await refreshAndRecalc()
    } catch (e) { toast.error('Failed: ' + e.message) }
    setSaving(false)
  }

  async function recalcTotals(freshJob, freshJobParts, freshThirdParty, freshCharges, freshPayments) {
    const j = freshJob ?? job
    const jp = freshJobParts ?? jobParts
    const tpi = freshThirdParty ?? thirdPartyItems
    const jc = freshCharges ?? jobCharges
    const jpay = freshPayments ?? jobPayments
    const partsTotal = jp.reduce((s, p) => s + p.line_total, 0) + tpi.reduce((s, t) => s + t.selling_price * t.quantity, 0)
    const costTotal = jp.reduce((s, p) => s + (p.unit_cost || 0) * p.quantity, 0) + tpi.reduce((s, t) => s + (t.cost_price || 0) * t.quantity, 0)
    const labourTotal = jc.reduce((s, c) => s + c.amount, 0)
    const paidTotal = (j.deposit_received || 0) + jpay.reduce((s, p) => s + p.amount, 0)
    // Income is the estimated/quoted cost charged to the customer (editable).
    // Profit = income − parts cost. Labour/other charges are tracked separately
    // as additional detail, not subtracted again from income.
    const income = j.estimated_cost || 0
    const grossProfit = income - costTotal
    const netProfit = income - costTotal
    const updated = {
      parts_total: partsTotal, labour_total: labourTotal, cost_total: costTotal,
      grand_total: income, gross_profit: grossProfit, net_profit: netProfit,
      balance_due: income - paidTotal,
    }
    await supabase.from('repair_jobs').update(updated).eq('id', jobId)
    return updated
  }

  // recalcTotals is now called explicitly, right after each action that changes
  // financials (add/edit a part, add a charge, edit income, record a payment) —
  // passing the fresh data directly rather than depending on component state and
  // a useEffect keyed on array .length. That approach silently missed any change
  // that didn't alter the array's length (editing an existing part's price, or
  // editing job income) — this fixes both by construction, not by chasing timing.

  if (loading || !job) return <div style={{ padding: '60px', textAlign: 'center', color: '#a89478' }}>Loading job...</div>

  const meta = statusMeta(job.status)
  const pMeta = priorityMeta(job.priority)
  const card = { background: 'white', borderRadius: '16px', padding: '20px', border: '1px solid #f3ede4', boxShadow: '0 1px 3px rgba(28,25,23,0.05)', marginBottom: '16px' }
  const lbl = { fontSize: '10px', fontWeight: '700', color: '#a89478', textTransform: 'uppercase', marginBottom: '3px' }
  const paidSoFar = (job.deposit_received || 0) + jobPayments.reduce((s, p) => s + p.amount, 0)

  return (
    <div>
      <button onClick={onBack} style={{ background: 'none', border: 'none', color: '#d4881f', fontWeight: '700', fontSize: '13px', cursor: 'pointer', marginBottom: '14px', padding: 0 }}>← Back to Jobs</button>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '20px', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '6px' }}>
            <h1 style={{ fontSize: '22px', fontWeight: '800', color: '#1c1917', margin: 0 }}>{job.job_no}</h1>
            <select value={job.priority} onChange={e => updatePriority(e.target.value)} disabled={saving}
              style={{ padding: '3px 10px', borderRadius: '8px', border: 'none', fontSize: '11px', fontWeight: '800', background: pMeta.bg, color: pMeta.color, textTransform: 'uppercase', cursor: 'pointer' }}>
              {PRIORITIES.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
            </select>
          </div>
          <p style={{ color: '#8a7a63', fontSize: '14px', margin: 0 }}>{job.phone_brand} {job.phone_model} · {job.repair_customers?.name} · {job.repair_customers?.mobile}</p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
          <button onClick={() => printJobReceipt(job, job.repair_customers)}
            style={{ padding: '11px 16px', borderRadius: '12px', border: '1.5px solid #e7dfd3', background: 'white', color: '#57534e', cursor: 'pointer', fontSize: '13px', fontWeight: '700' }}>
            🖨 Print Receipt
          </button>
          {job.status !== 'voided' && (
            <button onClick={() => setShowVoid(true)}
              style={{ padding: '11px 16px', borderRadius: '12px', border: '1.5px solid #fecaca', background: '#fef2f2', color: '#e11d48', cursor: 'pointer', fontSize: '13px', fontWeight: '700' }}>
              🗑 Void Job
            </button>
          )}
          <select value={job.status} onChange={e => updateStatus(e.target.value)} disabled={saving || job.status === 'voided'}
            style={{ padding: '11px 18px', borderRadius: '12px', border: 'none', fontSize: '13px', fontWeight: '800', background: meta.bg, color: meta.color, cursor: job.status === 'voided' ? 'default' : 'pointer' }}>
            {JOB_STATUSES.filter(s => s.id !== 'voided').map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
            {job.status === 'voided' && <option value="voided">Voided</option>}
          </select>
        </div>
      </div>

      {job.status === 'voided' && (
        <div style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: '10px', padding: '12px 16px', marginBottom: '16px', fontSize: '13px', color: '#991b1b', fontWeight: '600' }}>
          ⚠ This job has been voided. All parts, charges, third-party items, and customer payments were reversed{job.voided_at ? ` on ${new Date(job.voided_at).toLocaleDateString('en-GB')}` : ''}.
          {job.void_reason && <span> Reason: {job.void_reason}</span>}
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: '16px' }}>
        {/* Left column */}
        <div>
          <div style={card}>
            <h3 style={{ fontSize: '14px', fontWeight: '800', color: '#1c1917', margin: '0 0 14px' }}>📱 Device Details</h3>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '14px', marginBottom: '14px' }}>
              <div><div style={lbl}>IMEI</div><div style={{ fontSize: '13px', color: '#292524' }}>{job.imei || '—'}</div></div>
              <div><div style={lbl}>Serial No</div><div style={{ fontSize: '13px', color: '#292524' }}>{job.serial_no || '—'}</div></div>
              <div><div style={lbl}>Colour</div><div style={{ fontSize: '13px', color: '#292524' }}>{job.phone_colour || '—'}</div></div>
              <div><div style={lbl}>Storage</div><div style={{ fontSize: '13px', color: '#292524' }}>{job.storage_capacity || '—'}</div></div>
              <div><div style={lbl}>PIN/Password</div><div style={{ fontSize: '13px', color: '#292524', fontFamily: 'monospace' }}>{job.passcode || '—'}</div></div>
              <div><div style={lbl}>Battery at Intake</div><div style={{ fontSize: '13px', color: '#292524' }}>{job.battery_pct_intake != null ? job.battery_pct_intake + '%' : '—'}</div></div>
            </div>
            <div style={{ marginBottom: '10px' }}>
              <div style={lbl}>Accessories Received</div>
              <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginTop: '4px' }}>
                {(job.accessories_received || []).length === 0 ? <span style={{ fontSize: '12px', color: '#cbd5e1' }}>None recorded</span> :
                  job.accessories_received.map(a => <span key={a} style={{ padding: '3px 10px', borderRadius: '8px', background: '#f5f1ea', fontSize: '11px', fontWeight: '600', color: '#78716c' }}>{a}</span>)}
              </div>
            </div>
            <div>
              <div style={lbl}>Phone Condition</div>
              <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginTop: '4px' }}>
                {(job.phone_condition || []).length === 0 ? <span style={{ fontSize: '12px', color: '#cbd5e1' }}>None recorded</span> :
                  job.phone_condition.map(c => <span key={c} style={{ padding: '3px 10px', borderRadius: '8px', background: '#fee2e2', fontSize: '11px', fontWeight: '600', color: '#b91c1c' }}>{c}</span>)}
              </div>
              {job.other_condition_notes && <div style={{ fontSize: '12px', color: '#78716c', marginTop: '6px' }}>{job.other_condition_notes}</div>}
            </div>
          </div>

          <div style={card}>
            <h3 style={{ fontSize: '14px', fontWeight: '800', color: '#1c1917', margin: '0 0 10px' }}>🗒 Problem & Notes</h3>
            <div style={{ marginBottom: '8px' }}><div style={lbl}>Reported Problem</div><div style={{ fontSize: '13.5px', color: '#292524' }}>{job.reported_problem || '—'}</div></div>
            <div><div style={lbl}>Detailed Notes</div><div style={{ fontSize: '13.5px', color: '#292524', whiteSpace: 'pre-wrap' }}>{job.detailed_notes || '—'}</div></div>
          </div>

          {/* Parts used */}
          <div style={card}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
              <h3 style={{ fontSize: '14px', fontWeight: '800', color: '#1c1917', margin: 0 }}>🔩 Repair Parts Used</h3>
              <button onClick={() => setShowAddPart(true)} style={{ padding: '6px 14px', background: '#fef3e2', color: '#d4881f', border: 'none', borderRadius: '8px', cursor: 'pointer', fontSize: '12px', fontWeight: '700' }}>+ Add Part</button>
            </div>
            {jobParts.length === 0 && thirdPartyItems.length === 0 ? <div style={{ fontSize: '12.5px', color: '#a89478', padding: '10px 0' }}>No parts added yet.</div> : (
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12.5px' }}>
                <thead><tr style={{ borderBottom: '1px solid #f3ede4' }}>
                  {['Part', 'Qty', 'Price', 'Total', ''].map(h => <th key={h} style={{ padding: '6px 8px', textAlign: 'left', fontSize: '10px', color: '#a89478', textTransform: 'uppercase' }}>{h}</th>)}
                </tr></thead>
                <tbody>
                  {jobParts.map(p => (
                    <tr key={p.id} style={{ borderBottom: '1px solid #f8f5f0' }}>
                      <td style={{ padding: '7px 8px', fontWeight: '600' }}>{p.repair_parts?.name}</td>
                      <td style={{ padding: '7px 8px' }}>{p.quantity}</td>
                      <td style={{ padding: '7px 8px' }}>
                        {editingPriceId === p.id ? (
                          <div style={{ display: 'flex', gap: '4px' }}>
                            <input type="number" autoFocus value={priceInput} onChange={e => setPriceInput(e.target.value)}
                              style={{ width: '70px', padding: '3px 6px', border: '1.5px solid #f0b23d', borderRadius: '5px', fontSize: '12px' }} />
                            <button onClick={() => savePartPrice(p)} style={{ background: '#166534', color: 'white', border: 'none', borderRadius: '5px', padding: '0 6px', cursor: 'pointer', fontSize: '11px' }}>✓</button>
                          </div>
                        ) : (
                          <span onClick={() => { setEditingPriceId(p.id); setPriceInput(String(p.unit_price)) }} style={{ cursor: 'pointer', borderBottom: '1px dashed #d4881f' }} title="Click to edit price">
                            {formatLKR(p.unit_price)}
                          </span>
                        )}
                      </td>
                      <td style={{ padding: '7px 8px', fontWeight: '700', color: '#166534' }}>{formatLKR(p.line_total)}</td>
                      <td style={{ padding: '7px 8px' }}>
                        <button onClick={async () => {
                          await supabase.rpc('repair_fifo_return', { p_part_id: p.part_id, p_quantity: p.quantity, p_unit_cost: p.unit_cost || 0 })
                          await supabase.rpc('repair_add_part_stock', { p_part_id: p.part_id, p_quantity: p.quantity })
                          await supabase.from('repair_job_parts').delete().eq('id', p.id)
                          refreshAndRecalc()
                        }} style={{ background: 'none', border: 'none', color: '#e11d48', cursor: 'pointer', fontSize: '12px' }}>✕</button>
                      </td>
                    </tr>
                  ))}
                  {thirdPartyItems.map(t => (
                    <tr key={t.id} style={{ borderBottom: '1px solid #f8f5f0', background: '#fef3e2' }}>
                      <td style={{ padding: '7px 8px', fontWeight: '600' }}>{t.item_name} <span style={{ fontSize: '9px', fontWeight: '700', color: '#d4881f', background: '#fde68a', padding: '1px 6px', borderRadius: '6px', marginLeft: '4px' }}>3RD PARTY</span></td>
                      <td style={{ padding: '7px 8px' }}>{t.quantity}</td>
                      <td style={{ padding: '7px 8px' }}>{formatLKR(t.selling_price)}</td>
                      <td style={{ padding: '7px 8px', fontWeight: '700', color: '#166534' }}>{formatLKR(t.selling_price * t.quantity)}</td>
                      <td style={{ padding: '7px 8px' }}>
                        <button onClick={async () => { await supabase.from('repair_third_party_items').delete().eq('id', t.id); refreshAndRecalc() }} style={{ background: 'none', border: 'none', color: '#e11d48', cursor: 'pointer', fontSize: '12px' }}>✕</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {thirdPartyItems.length > 0 && (
              <div style={{ marginTop: '10px', fontSize: '11px', color: '#8a7a63' }}>
                ⚠ 3rd-party items shown above still need cost/payment settled — see <strong>3rd Party Items</strong> in Reports, or update directly.
              </div>
            )}
          </div>

          {/* Charges */}
          <div style={card}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
              <h3 style={{ fontSize: '14px', fontWeight: '800', color: '#1c1917', margin: 0 }}>💵 Labour & Other Charges</h3>
              <button onClick={() => setShowAddCharge(true)} style={{ padding: '6px 14px', background: '#fef3e2', color: '#d4881f', border: 'none', borderRadius: '8px', cursor: 'pointer', fontSize: '12px', fontWeight: '700' }}>+ Add Charge</button>
            </div>
            {jobCharges.length === 0 ? <div style={{ fontSize: '12.5px', color: '#a89478', padding: '10px 0' }}>No charges added yet.</div> : (
              jobCharges.map(c => (
                <div key={c.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid #f8f5f0' }}>
                  <div><div style={{ fontSize: '13px', fontWeight: '600', color: '#292524' }}>{CHARGE_TYPES.find(t => t.id === c.charge_type)?.label || c.charge_type}</div>{c.description && <div style={{ fontSize: '11px', color: '#a89478' }}>{c.description}</div>}</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <span style={{ fontWeight: '700', color: '#166534', fontSize: '13px' }}>{formatLKR(c.amount)}</span>
                    <button onClick={async () => { await supabase.from('repair_job_charges').delete().eq('id', c.id); refreshAndRecalc() }} style={{ background: 'none', border: 'none', color: '#e11d48', cursor: 'pointer', fontSize: '12px' }}>✕</button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Right column */}
        <div>
          <div style={card}>
            <h3 style={{ fontSize: '14px', fontWeight: '800', color: '#1c1917', margin: '0 0 12px' }}>💰 Job Financials</h3>

            <div style={{ marginBottom: '12px' }}>
              <div style={lbl}>Job Income (Estimated Cost)</div>
              {editingCost ? (
                <div style={{ display: 'flex', gap: '6px', marginTop: '4px' }}>
                  <input type="number" autoFocus value={costInput} onChange={e => setCostInput(e.target.value)}
                    style={{ flex: 1, padding: '7px 10px', border: '1.5px solid #f0b23d', borderRadius: '7px', fontSize: '14px', fontWeight: '700' }} />
                  <button onClick={saveCost} disabled={saving} style={{ padding: '7px 12px', background: '#166534', color: 'white', border: 'none', borderRadius: '7px', cursor: 'pointer', fontWeight: '700', fontSize: '12px' }}>✓</button>
                  <button onClick={() => setEditingCost(false)} style={{ padding: '7px 12px', background: '#f5f1ea', color: '#78716c', border: 'none', borderRadius: '7px', cursor: 'pointer', fontSize: '12px' }}>✕</button>
                </div>
              ) : (
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '2px' }}>
                  <span style={{ fontSize: '19px', fontWeight: '800', color: '#1c1917' }}>{formatLKR(job.estimated_cost)}</span>
                  <button onClick={() => { setCostInput(String(job.estimated_cost || '')); setEditingCost(true) }} style={{ background: '#fef3e2', border: 'none', borderRadius: '7px', padding: '4px 10px', cursor: 'pointer', color: '#d4881f', fontSize: '11px', fontWeight: '700' }}>Edit</button>
                </div>
              )}
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 0', fontSize: '13px', color: '#57534e', borderTop: '1px dashed #f3ede4', paddingTop: '10px' }}>
              <span>Parts Cost (FIFO)</span><span style={{ fontWeight: '700', color: '#e11d48' }}>− {formatLKR(job.cost_total)}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 0', fontSize: '13px', color: '#8a7a63' }}>
              <span>Parts Charged to Customer</span><span style={{ fontWeight: '600' }}>{formatLKR(job.parts_total)}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 0', fontSize: '13px', color: '#8a7a63' }}>
              <span>Labour & Other Charges</span><span style={{ fontWeight: '600' }}>{formatLKR(job.labour_total)}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 0', borderTop: '1.5px solid #f3ede4', marginTop: '6px', fontSize: '15px', fontWeight: '800', color: '#1c1917' }}>
              <span>Grand Total (Income)</span><span>{formatLKR(job.grand_total)}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 0', fontSize: '13px', color: '#57534e' }}>
              <span>Deposit Received</span><span style={{ fontWeight: '600', color: '#059669' }}>{formatLKR(job.deposit_received)}</span>
            </div>
            {jobPayments.map(p => (
              <div key={p.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', fontSize: '12px', color: '#8a7a63' }}>
                <span>Payment ({p.payment_method}{p.bank_accounts?.name ? ' — ' + p.bank_accounts.name : ''})</span><span style={{ fontWeight: '600', color: '#059669' }}>{formatLKR(p.amount)}</span>
              </div>
            ))}
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 0', fontSize: '14px', fontWeight: '800', color: job.balance_due > 0 ? '#e11d48' : '#166534' }}>
              <span>Balance Due</span><span>{formatLKR(job.balance_due)}</span>
            </div>
            {job.balance_due > 0 && (
              <button onClick={() => setShowCollectCash(true)}
                style={{ width: '100%', marginTop: '10px', padding: '10px', background: 'linear-gradient(135deg,#f0b23d,#d4881f)', color: '#1c1917', border: 'none', borderRadius: '9px', cursor: 'pointer', fontWeight: '800', fontSize: '13px' }}>
                💵 Collect Payment
              </button>
            )}
            <div style={{ marginTop: '10px', paddingTop: '10px', borderTop: '1px dashed #f3ede4', display: 'flex', justifyContent: 'space-between', fontSize: '12px', color: '#8a7a63' }}>
              <span>Net Profit</span><span style={{ fontWeight: '700', color: job.net_profit >= 0 ? '#166534' : '#e11d48' }}>{formatLKR(job.net_profit)}</span>
            </div>
          </div>

          <div style={card}>
            <h3 style={{ fontSize: '14px', fontWeight: '800', color: '#1c1917', margin: '0 0 12px' }}>🕐 Job Timeline</h3>
            <div style={{ position: 'relative', paddingLeft: '18px' }}>
              <div style={{ position: 'absolute', left: '4px', top: '4px', bottom: '4px', width: '2px', background: '#f3ede4' }} />
              {timeline.map((t, i) => (
                <div key={t.id} style={{ position: 'relative', marginBottom: '14px' }}>
                  <div style={{ position: 'absolute', left: '-18px', top: '2px', width: '10px', height: '10px', borderRadius: '50%', background: i === timeline.length - 1 ? '#d4881f' : '#e7dfd3', border: '2px solid white' }} />
                  <div style={{ fontSize: '12px', color: '#a89478' }}>{timeAgo(t.created_at)}</div>
                  <div style={{ fontSize: '13px', color: '#292524', fontWeight: '600' }}>{t.event}</div>
                </div>
              ))}
            </div>
          </div>

          <WarrantyCard job={job} onSaved={refreshAndRecalc} />
        </div>
      </div>

      {showAddPart && <AddPartModal shop={shop} parts={parts} onClose={() => setShowAddPart(false)} onAdded={() => { setShowAddPart(false); refreshAndRecalc() }} jobId={jobId} />}
      {showAddCharge && <AddChargeModal onClose={() => setShowAddCharge(false)} onAdded={() => { setShowAddCharge(false); refreshAndRecalc() }} jobId={jobId} />}
      {showCollectCash && <CollectPaymentModal job={job} balanceDue={job.balance_due} onClose={() => setShowCollectCash(false)} onCollected={() => { setShowCollectCash(false); refreshAndRecalc() }} />}
      {showVoid && <VoidJobModal job={job} jobParts={jobParts} thirdPartyItems={thirdPartyItems} jobPayments={jobPayments}
        onClose={() => setShowVoid(false)} onVoided={() => { setShowVoid(false); refreshAndRecalc() }} />}
    </div>
  )
}

// Warranty section for an existing job — same tickbox + fixed-duration dropdown as
// the New Job form, editable after creation. Saves directly to repair_jobs.
function WarrantyCard({ job, onSaved }) {
  const [warranty, setWarranty] = useState(!!job.warranty)
  const [duration, setDuration] = useState(job.warranty_duration || '')
  const [saving, setSaving] = useState(false)
  const card = { background: 'white', borderRadius: '16px', padding: '20px', border: '1px solid #f3ede4', boxShadow: '0 1px 3px rgba(28,25,23,0.05)', marginTop: '16px' }
  const inp = { width: '100%', padding: '9px 12px', border: '1.5px solid #e7dfd3', borderRadius: '8px', fontSize: '13px', boxSizing: 'border-box' }

  // Re-sync local state if the job record changes underneath us (e.g. after a save
  // elsewhere triggers a refetch) — otherwise a stale local value could linger.
  useEffect(() => { setWarranty(!!job.warranty); setDuration(job.warranty_duration || '') }, [job.warranty, job.warranty_duration, job.warranty_expiry])

  async function save(nextWarranty, nextDuration) {
    setSaving(true)
    try {
      const days = { '7_days': 7, '1_month': 30, '3_month': 90, '6_month': 180 }[nextDuration]
      const expiry = nextWarranty && days ? new Date(Date.now() + days * 86400000).toISOString().slice(0, 10) : null
      await supabase.from('repair_jobs').update({
        warranty: nextWarranty,
        warranty_duration: nextWarranty ? nextDuration || null : null,
        warranty_expiry: expiry,
      }).eq('id', job.id)
      toast.success('Warranty updated')
      onSaved()
    } catch (e) { toast.error('Failed: ' + e.message) }
    setSaving(false)
  }

  return (
    <div style={card}>
      <h3 style={{ fontSize: '14px', fontWeight: '800', color: '#1c1917', margin: '0 0 12px' }}>🛡️ Warranty</h3>
      <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', fontWeight: '600', color: '#44403c', cursor: 'pointer', marginBottom: warranty ? '12px' : 0 }}>
        <input type="checkbox" checked={warranty} disabled={saving} onChange={e => {
          const next = e.target.checked
          setWarranty(next)
          save(next, duration)
        }} /> Under Warranty
      </label>
      {warranty && (
        <div>
          <label style={{ fontSize: '10px', fontWeight: '700', color: '#a89478', textTransform: 'uppercase', marginBottom: '3px', display: 'block' }}>Duration</label>
          <select style={inp} value={duration} disabled={saving} onChange={e => {
            const next = e.target.value
            setDuration(next)
            save(warranty, next)
          }}>
            <option value="">— Select duration —</option>
            <option value="7_days">7 Days</option>
            <option value="1_month">1 Month</option>
            <option value="3_month">3 Months</option>
            <option value="6_month">6 Months</option>
          </select>
          {job.warranty_expiry && <div style={{ fontSize: '11px', color: '#8a7a63', marginTop: '6px' }}>Expires: {new Date(job.warranty_expiry).toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' })}</div>}
        </div>
      )}
    </div>
  )
}

// Voids a job entirely — reverses every real-world effect it caused:
// - every repair part consumed: FIFO cost layer restored, stock added back
// - every 3rd-party item: if already settled with the source, that payment is
//   reversed (cash ledger credit or bank deposit) rather than silently discarded,
//   since real money was genuinely spent
// - every charge: simply removed, since a charge has no external effect of its own
// - every customer payment received: reversed (cash ledger debit, or bank balance
//   and a withdrawal transaction), same as a refund would be
// Does NOT touch the original purchases that stocked the parts in the first place —
// voiding a job undoes what the JOB did, not the purchase transactions that
// happened independently of it.
function VoidJobModal({ job, jobParts, thirdPartyItems, jobPayments, onClose, onVoided }) {
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)
  const inp = { width: '100%', padding: '9px 12px', border: '1.5px solid #e7dfd3', borderRadius: '8px', fontSize: '13px', boxSizing: 'border-box' }

  const paidTotal = jobPayments.reduce((s, p) => s + p.amount, 0)
  const settledThirdParty = thirdPartyItems.filter(t => t.payment_status === 'paid')

  async function handleVoid() {
    setSaving(true)
    try {
      // 1. Reverse every repair part — return its FIFO cost layer and restock it,
      // same as removing one part already does.
      for (const p of jobParts) {
        await supabase.rpc('repair_fifo_return', { p_part_id: p.part_id, p_quantity: p.quantity, p_unit_cost: p.unit_cost || 0 })
        await supabase.rpc('repair_add_part_stock', { p_part_id: p.part_id, p_quantity: p.quantity })
      }
      await supabase.from('repair_job_parts').delete().eq('job_id', job.id)

      // 2. Reverse any 3rd-party item that was already settled (real money paid
      // out to the source) — credit it back the same way it was recorded.
      for (const t of settledThirdParty) {
        const amount = (t.cost_price || 0) * t.quantity
        if (amount > 0.009) {
          if (t.payment_method === 'cash') {
            await supabase.from('repair_cash_ledger').insert({
              shop_id: job.shop_id, type: 'payment', amount, reference: job.job_no,
              notes: `Job voided — 3rd-party item reversed: ${t.item_name}`,
            })
          } else if (t.payment_method === 'bank' && t.bank_account_id) {
            const { data: bank } = await supabase.from('bank_accounts').select('balance').eq('id', t.bank_account_id).single()
            await supabase.from('bank_accounts').update({ balance: (bank?.balance || 0) + amount }).eq('id', t.bank_account_id)
            await supabase.from('bank_transactions').insert({
              bank_account_id: t.bank_account_id, type: 'deposit', amount,
              reference: `Job voided: ${job.job_no}`, notes: `3rd-party item reversed: ${t.item_name}`,
            })
          }
          // A cheque settlement for a 3rd-party item isn't offered as a payment
          // method in RepairThirdParty.jsx today, so there's no cheque case to
          // reverse here — if that changes, this needs a matching branch.
        }
      }
      await supabase.from('repair_third_party_items').delete().eq('job_id', job.id)

      // 3. Charges have no external effect of their own — just remove them.
      await supabase.from('repair_job_charges').delete().eq('job_id', job.id)

      // 4. Reverse every customer payment received, same as issuing a refund —
      // credit back to cash ledger or debit back out of the bank account.
      for (const p of jobPayments) {
        if (p.payment_method === 'cash') {
          await supabase.from('repair_cash_ledger').insert({
            shop_id: job.shop_id, type: 'payment', amount: -p.amount, reference: job.job_no,
            notes: 'Job voided — customer payment reversed',
          })
        } else if (p.bank_account_id) {
          const { data: bank } = await supabase.from('bank_accounts').select('balance').eq('id', p.bank_account_id).single()
          await supabase.from('bank_accounts').update({ balance: (bank?.balance || 0) - p.amount }).eq('id', p.bank_account_id)
          await supabase.from('bank_transactions').insert({
            bank_account_id: p.bank_account_id, type: 'withdrawal', amount: p.amount,
            reference: `Job voided: ${job.job_no}`, notes: `Customer payment reversed (${p.payment_method})`,
          })
        }
      }
      await supabase.from('repair_job_payments').delete().eq('job_id', job.id)

      // 5. Zero out the job's own financials and mark it voided.
      await supabase.from('repair_jobs').update({
        status: 'voided',
        parts_total: 0, labour_total: 0, cost_total: 0,
        grand_total: 0, gross_profit: 0, net_profit: 0, balance_due: 0,
        deposit_received: 0,
        voided_at: new Date().toISOString(),
        void_reason: reason || null,
      }).eq('id', job.id)

      await supabase.from('repair_job_timeline').insert({
        job_id: job.id, event: `Job voided${reason ? ` — ${reason}` : ''}`,
      })

      toast.success('Job voided — all related transactions reversed')
      onVoided()
    } catch (e) {
      toast.error('Failed to void job: ' + e.message)
    }
    setSaving(false)
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(28,25,23,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1100, padding: '20px' }}>
      <div style={{ background: 'white', borderRadius: '18px', padding: '24px', width: '440px' }}>
        <h3 style={{ fontSize: '16px', fontWeight: '800', margin: '0 0 4px', color: '#e11d48' }}>Void Job {job.job_no}?</h3>
        <p style={{ fontSize: '12px', color: '#8a7a63', margin: '0 0 14px' }}>This cannot be undone. The following will be reversed:</p>
        <ul style={{ fontSize: '13px', color: '#44403c', margin: '0 0 16px', paddingLeft: '18px', lineHeight: '1.7' }}>
          <li>{jobParts.length} repair part{jobParts.length !== 1 ? 's' : ''} — stock and cost restored</li>
          <li>{thirdPartyItems.length} 3rd-party item{thirdPartyItems.length !== 1 ? 's' : ''}{settledThirdParty.length > 0 ? ` (${settledThirdParty.length} already settled — payment will be reversed)` : ''}</li>
          <li>{jobPayments.length} customer payment{jobPayments.length !== 1 ? 's' : ''} received — {formatLKR(paidTotal)} reversed</li>
        </ul>
        <label style={{ fontSize: '11px', fontWeight: '700', color: '#a89478', textTransform: 'uppercase' }}>Reason (optional)</label>
        <textarea style={{ ...inp, minHeight: '60px', marginBottom: '16px' }} value={reason} onChange={e => setReason(e.target.value)} placeholder="e.g. customer cancelled, entered in error" />
        <div style={{ display: 'flex', gap: '10px' }}>
          <button onClick={onClose} style={{ flex: 1, padding: '10px', background: '#f5f1ea', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: '700' }}>Cancel</button>
          <button onClick={handleVoid} disabled={saving} style={{ flex: 1, padding: '10px', background: '#e11d48', color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: '800' }}>{saving ? 'Voiding...' : 'Void Job'}</button>
        </div>
      </div>
    </div>
  )
}

// Item 7: collect payment when completing a job — cash, card, or bank transfer
function CollectPaymentModal({ job, balanceDue, onClose, onCollected }) {
  const [amount, setAmount] = useState(String(balanceDue))
  const [method, setMethod] = useState('cash')
  const [bankAccountId, setBankAccountId] = useState('')
  const [bankAccounts, setBankAccounts] = useState([])
  const [saving, setSaving] = useState(false)

  useEffect(() => { supabase.from('bank_accounts').select('*').order('name').then(({ data }) => setBankAccounts(data || [])) }, [])

  async function handleCollect() {
    const amt = parseFloat(amount)
    if (!amt || amt <= 0) return toast.error('Enter a valid amount')
    if ((method === 'card' || method === 'bank_transfer') && !bankAccountId) return toast.error('Select a bank account')
    setSaving(true)
    try {
      await supabase.from('repair_job_payments').insert({
        job_id: job.id, amount: amt, payment_method: method,
        bank_account_id: (method === 'card' || method === 'bank_transfer') ? bankAccountId : null,
      })
      if (method === 'cash') {
        await supabase.from('repair_cash_ledger').insert({ shop_id: job.shop_id, type: 'sale', amount: amt, reference: job.job_no, notes: 'Repair job payment collected' })
      } else {
        const bank = bankAccounts.find(b => b.id === bankAccountId)
        await supabase.from('bank_accounts').update({ balance: (bank?.balance || 0) + amt }).eq('id', bankAccountId)
        await supabase.from('bank_transactions').insert({ bank_account_id: bankAccountId, type: 'deposit', amount: amt, reference: `Repair job: ${job.job_no}`, notes: `${method} payment` })
      }
      toast.success('Payment collected!')
      if (window.confirm('Payment collected! Print a receipt for the customer?')) {
        printJobPaymentReceipt(job, job.repair_customers, amt, method)
      }
      onCollected()
    } catch (e) { toast.error('Failed: ' + e.message) }
    setSaving(false)
  }

  const inp = { width: '100%', padding: '9px 12px', border: '1.5px solid #e7dfd3', borderRadius: '8px', fontSize: '13px', boxSizing: 'border-box' }
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(28,25,23,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1100, padding: '20px' }}>
      <div style={{ background: 'white', borderRadius: '18px', padding: '24px', width: '380px' }}>
        <h3 style={{ fontSize: '16px', fontWeight: '800', margin: '0 0 4px', color: '#1c1917' }}>Collect Payment</h3>
        <p style={{ fontSize: '12px', color: '#8a7a63', margin: '0 0 16px' }}>Balance due: {formatLKR(balanceDue)}</p>
        <div style={{ marginBottom: '10px' }}><label style={{ fontSize: '11px', fontWeight: '700', color: '#a89478' }}>Amount</label><input type="number" style={inp} value={amount} onChange={e => setAmount(e.target.value)} /></div>
        <div style={{ marginBottom: '10px' }}>
          <label style={{ fontSize: '11px', fontWeight: '700', color: '#a89478' }}>Method</label>
          <select style={inp} value={method} onChange={e => setMethod(e.target.value)}>
            <option value="cash">Cash</option><option value="card">Card</option><option value="bank_transfer">Bank Transfer</option>
          </select>
        </div>
        {(method === 'card' || method === 'bank_transfer') && (
          <div style={{ marginBottom: '16px' }}>
            <label style={{ fontSize: '11px', fontWeight: '700', color: '#a89478' }}>iPHIX Technologies Bank Account</label>
            <select style={inp} value={bankAccountId} onChange={e => setBankAccountId(e.target.value)}>
              <option value="">Select...</option>
              {bankAccounts.map(b => <option key={b.id} value={b.id}>{b.name}{b.bank_name ? ` — ${b.bank_name}` : ''}</option>)}
            </select>
          </div>
        )}
        <div style={{ display: 'flex', gap: '10px' }}>
          <button onClick={onClose} style={{ flex: 1, padding: '10px', background: '#f5f1ea', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: '700' }}>Cancel</button>
          <button onClick={handleCollect} disabled={saving} style={{ flex: 1, padding: '10px', background: 'linear-gradient(135deg,#f0b23d,#d4881f)', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: '800' }}>{saving ? 'Collecting...' : 'Collect'}</button>
        </div>
      </div>
    </div>
  )
}

function AddPartModal({ shop, parts, jobId, onClose, onAdded }) {
  const [isThirdParty, setIsThirdParty] = useState(false)
  const [partId, setPartId] = useState('')
  const [thirdPartyName, setThirdPartyName] = useState('')
  const [suppliers, setSuppliers] = useState([])
  const [thirdPartySupplierId, setThirdPartySupplierId] = useState('')
  const [thirdPartySupplierOther, setThirdPartySupplierOther] = useState('')
  const [thirdPartyCost, setThirdPartyCost] = useState('')
  const [qty, setQty] = useState('1')
  const [price, setPrice] = useState('')
  const [saving, setSaving] = useState(false)
  const selected = parts.find(p => p.id === partId)

  useEffect(() => { if (selected) setPrice(String(selected.selling_price || '')) }, [partId])
  useEffect(() => { supabase.from('repair_suppliers').select('id, name').order('name').then(({ data }) => setSuppliers(data || [])) }, [])

  async function handleAdd() {
    const q = parseFloat(qty) || 1
    const p = parseFloat(price) || 0
    setSaving(true)
    try {
      if (isThirdParty) {
        if (!thirdPartyName.trim()) { toast.error('Enter the item name'); setSaving(false); return }
        if (!p) { toast.error('Enter a selling price'); setSaving(false); return }
        const cost = parseFloat(thirdPartyCost) || 0
        const linkedSupplier = suppliers.find(s => s.id === thirdPartySupplierId)
        const supplierName = linkedSupplier ? linkedSupplier.name : (thirdPartySupplierOther || null)
        await supabase.from('repair_third_party_items').insert({
          shop_id: shop?.id || null, job_id: jobId, item_name: thirdPartyName.trim(),
          supplier_id: linkedSupplier?.id || null, supplier_name: supplierName,
          quantity: q, selling_price: p, cost_price: cost,
          payment_status: 'pending',
        })
        // Same convention as a normal purchase (RepairPurchases.jsx) — the unpaid
        // amount raises the supplier's outstanding balance immediately, so it
        // shows up in their Activity Statement right away, not just once settled.
        if (linkedSupplier && cost > 0) {
          await supabase.rpc('repair_adjust_supplier_balance', { p_supplier_id: linkedSupplier.id, p_delta: cost * q })
        }
        toast.success(cost > 0 ? '3rd-party item added' : '3rd-party item added — add cost later if unknown now')
      } else {
        if (!partId) { toast.error('Select a part'); setSaving(false); return }
        if (q > (selected.current_stock || 0)) { toast.error(`Only ${selected.current_stock || 0} in stock`); setSaving(false); return }
        const { data: unitCost } = await supabase.rpc('repair_fifo_consume', { p_part_id: partId, p_quantity: q })
        await supabase.from('repair_job_parts').insert({
          job_id: jobId, part_id: partId, quantity: q, unit_cost: unitCost || 0,
          unit_price: p, line_total: q * p, is_third_party: false,
        })
        await supabase.rpc('repair_deduct_part_stock', { p_part_id: partId, p_quantity: q })
        // Signal other open instances (e.g. the Inventory page, if kept alive by
        // some navigation caching) that stock changed — a plain custom event, since
        // localStorage's own storage event doesn't fire in the same tab that set it.
        localStorage.setItem('iphix_repair_stock_changed', String(Date.now()))
        toast.success('Part added')
      }
      onAdded()
    } catch (e) { toast.error('Failed: ' + e.message) }
    setSaving(false)
  }

  const inp = { width: '100%', padding: '9px 12px', border: '1.5px solid #e7dfd3', borderRadius: '8px', fontSize: '13px', boxSizing: 'border-box' }
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(28,25,23,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '20px' }}>
      <div style={{ background: 'white', borderRadius: '18px', padding: '24px', width: '100%', maxWidth: '420px' }}>
        <h3 style={{ fontSize: '16px', fontWeight: '800', margin: '0 0 14px', color: '#1c1917' }}>Add Repair Part</h3>

        <label style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '14px', fontSize: '13px', fontWeight: '600', color: '#44403c', cursor: 'pointer' }}>
          <input type="checkbox" checked={isThirdParty} onChange={e => setIsThirdParty(e.target.checked)} />
          This is a 3rd-party item (not from repair inventory)
        </label>

        {isThirdParty ? (
          <>
            <div style={{ marginBottom: '12px' }}><label style={{ fontSize: '11px', color: '#a89478', fontWeight: '700' }}>Item Name</label><input style={inp} value={thirdPartyName} onChange={e => setThirdPartyName(e.target.value)} /></div>
            <div style={{ marginBottom: '12px' }}>
              <label style={{ fontSize: '11px', color: '#a89478', fontWeight: '700' }}>Supplier (optional)</label>
              <select style={inp} value={thirdPartySupplierId} onChange={e => setThirdPartySupplierId(e.target.value)}>
                <option value="">— None / not tracked —</option>
                {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                <option value="__other__">Other (type name below)</option>
              </select>
              {thirdPartySupplierId === '__other__' && (
                <input style={{ ...inp, marginTop: '6px' }} placeholder="Supplier name" value={thirdPartySupplierOther} onChange={e => setThirdPartySupplierOther(e.target.value)} />
              )}
              {thirdPartySupplierId && thirdPartySupplierId !== '__other__' && (
                <div style={{ fontSize: '11px', color: '#8a7a63', marginTop: '4px' }}>Linked — this supplier's balance and Activity Statement will reflect this item.</div>
              )}
            </div>
            <div style={{ marginBottom: '12px' }}>
              <label style={{ fontSize: '11px', color: '#a89478', fontWeight: '700' }}>Cost Price</label>
              <input type="number" style={inp} placeholder="Enter if known now, or update later" value={thirdPartyCost} onChange={e => setThirdPartyCost(e.target.value)} />
            </div>
          </>
        ) : (
          <div style={{ marginBottom: '12px' }}>
            <label style={{ fontSize: '11px', color: '#a89478', fontWeight: '700' }}>Part</label>
            <select style={inp} value={partId} onChange={e => setPartId(e.target.value)}>
              <option value="">Select part...</option>
              {parts.map(p => <option key={p.id} value={p.id}>{p.name} ({p.current_stock || 0} in stock)</option>)}
            </select>
          </div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginBottom: '16px' }}>
          <div><label style={{ fontSize: '11px', color: '#a89478', fontWeight: '700' }}>Quantity</label><input type="number" min="1" style={inp} value={qty} onChange={e => setQty(e.target.value)} /></div>
          <div><label style={{ fontSize: '11px', color: '#a89478', fontWeight: '700' }}>Selling Price</label><input type="number" style={inp} value={price} onChange={e => setPrice(e.target.value)} /></div>
        </div>
        <div style={{ display: 'flex', gap: '10px' }}>
          <button onClick={onClose} style={{ flex: 1, padding: '10px', background: '#f5f1ea', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: '700', color: '#78716c' }}>Cancel</button>
          <button onClick={handleAdd} disabled={saving} style={{ flex: 1, padding: '10px', background: 'linear-gradient(135deg,#f0b23d,#d4881f)', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: '800', color: '#1c1917' }}>{saving ? 'Adding...' : 'Add'}</button>
        </div>
      </div>
    </div>
  )
}

function AddChargeModal({ jobId, onClose, onAdded }) {
  const [type, setType] = useState('labour')
  const [desc, setDesc] = useState('')
  const [amount, setAmount] = useState('')
  const [saving, setSaving] = useState(false)

  async function handleAdd() {
    const amt = parseFloat(amount)
    if (!amt || amt <= 0) return toast.error('Enter a valid amount')
    setSaving(true)
    try {
      await supabase.from('repair_job_charges').insert({ job_id: jobId, charge_type: type, description: desc || null, amount: amt })
      toast.success('Charge added')
      onAdded()
    } catch (e) { toast.error('Failed: ' + e.message) }
    setSaving(false)
  }

  const inp = { width: '100%', padding: '9px 12px', border: '1.5px solid #e7dfd3', borderRadius: '8px', fontSize: '13px', boxSizing: 'border-box' }
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(28,25,23,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '20px' }}>
      <div style={{ background: 'white', borderRadius: '18px', padding: '24px', width: '100%', maxWidth: '400px' }}>
        <h3 style={{ fontSize: '16px', fontWeight: '800', margin: '0 0 16px', color: '#1c1917' }}>Add Charge</h3>
        <div style={{ marginBottom: '12px' }}>
          <select style={inp} value={type} onChange={e => setType(e.target.value)}>
            {CHARGE_TYPES.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
          </select>
        </div>
        <div style={{ marginBottom: '12px' }}><input style={inp} placeholder="Description (optional)" value={desc} onChange={e => setDesc(e.target.value)} /></div>
        <div style={{ marginBottom: '16px' }}><input type="number" style={inp} placeholder="Amount (LKR)" value={amount} onChange={e => setAmount(e.target.value)} /></div>
        <div style={{ display: 'flex', gap: '10px' }}>
          <button onClick={onClose} style={{ flex: 1, padding: '10px', background: '#f5f1ea', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: '700', color: '#78716c' }}>Cancel</button>
          <button onClick={handleAdd} disabled={saving} style={{ flex: 1, padding: '10px', background: 'linear-gradient(135deg,#f0b23d,#d4881f)', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: '800', color: '#1c1917' }}>{saving ? 'Adding...' : 'Add'}</button>
        </div>
      </div>
    </div>
  )
}
