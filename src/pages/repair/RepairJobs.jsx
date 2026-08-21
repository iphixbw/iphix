import { useState, useEffect } from 'react'
import { supabase } from '../../supabase'
import toast from 'react-hot-toast'
import { JOB_STATUSES, PRIORITIES, ACCESSORY_OPTIONS, CONDITION_OPTIONS, statusMeta, priorityMeta, isCollectedWithDue, formatLKR, timeAgo, printJobReceipt } from '../../lib/repairConstants'
import { generateRepairJobNo, generateRepairCustomerNo } from '../../lib/repairHelpers'

export default function RepairJobs({ shop, onOpenJob }) {
  const [jobs, setJobs] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [showNew, setShowNew] = useState(false)

  useEffect(() => { fetchJobs() }, [shop?.id])

  async function fetchJobs() {
    setLoading(true)
    let q = supabase.from('repair_jobs').select('*, repair_customers(name, mobile)').order('created_at', { ascending: false })
    if (shop?.id) q = q.eq('shop_id', shop.id)
    const { data } = await q
    setJobs(data || [])
    setLoading(false)
  }

  const filtered = jobs.filter(j => {
    const matchesStatus = statusFilter === 'all' || j.status === statusFilter
    const matchesSearch = !search ||
      j.job_no?.toLowerCase().includes(search.toLowerCase()) ||
      j.phone_brand?.toLowerCase().includes(search.toLowerCase()) ||
      j.phone_model?.toLowerCase().includes(search.toLowerCase()) ||
      j.imei?.toLowerCase().includes(search.toLowerCase()) ||
      j.repair_customers?.name?.toLowerCase().includes(search.toLowerCase()) ||
      j.repair_customers?.mobile?.includes(search)
    return matchesStatus && matchesSearch
  })

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '20px' }}>
        <div>
          <h1 style={{ fontSize: '22px', fontWeight: '800', color: '#1c1917', margin: '0 0 4px' }}>Repair Jobs</h1>
          <p style={{ color: '#8a7a63', fontSize: '14px', margin: 0 }}>{filtered.length} job{filtered.length !== 1 ? 's' : ''}</p>
        </div>
        <button onClick={() => setShowNew(true)}
          style={{ padding: '11px 22px', background: 'linear-gradient(135deg,#f0b23d,#d4881f)', color: '#1c1917', border: 'none', borderRadius: '12px', cursor: 'pointer', fontWeight: '800', fontSize: '14px', boxShadow: '0 4px 14px rgba(212,136,31,0.35)' }}>
          + New Repair Job
        </button>
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: '10px', marginBottom: '18px', flexWrap: 'wrap' }}>
        <input type="text" placeholder="Search job#, customer, phone, IMEI..." value={search} onChange={e => setSearch(e.target.value)}
          style={{ flex: 1, minWidth: '240px', padding: '10px 14px', border: '1.5px solid #e7dfd3', borderRadius: '10px', fontSize: '14px', outline: 'none' }} />
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
          style={{ padding: '10px 14px', border: '1.5px solid #e7dfd3', borderRadius: '10px', fontSize: '13px', background: 'white' }}>
          <option value="all">All Statuses</option>
          {JOB_STATUSES.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
        </select>
      </div>

      {/* Job cards */}
      {loading ? (
        <div style={{ padding: '60px', textAlign: 'center', color: '#a89478' }}>Loading jobs...</div>
      ) : filtered.length === 0 ? (
        <div style={{ background: 'white', borderRadius: '16px', padding: '60px', textAlign: 'center', color: '#a89478', border: '1px solid #f3ede4' }}>
          No repair jobs found.
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '14px' }}>
          {filtered.map(j => {
            const meta = statusMeta(j.status)
            const pMeta = priorityMeta(j.priority)
            const due = isCollectedWithDue(j)
            return (
              <div key={j.id} onClick={() => onOpenJob(j.id)}
                style={{ background: 'white', borderRadius: '16px', padding: '18px', border: '1px solid #f3ede4', cursor: 'pointer', boxShadow: '0 1px 3px rgba(28,25,23,0.05)', transition: 'transform 0.15s, box-shadow 0.15s', borderLeft: `4px solid ${due ? '#e11d48' : meta.color}` }}
                onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.boxShadow = '0 8px 20px rgba(28,25,23,0.1)' }}
                onMouseLeave={e => { e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.boxShadow = '0 1px 3px rgba(28,25,23,0.05)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '8px' }}>
                  <div style={{ fontWeight: '800', color: '#1c1917', fontSize: '14px' }}>{j.job_no}</div>
                  <span style={{ padding: '2px 9px', borderRadius: '8px', fontSize: '10px', fontWeight: '800', background: pMeta.bg, color: pMeta.color, textTransform: 'uppercase' }}>{pMeta.label}</span>
                </div>
                <div style={{ fontSize: '15px', fontWeight: '700', color: '#292524', marginBottom: '2px' }}>{j.phone_brand} {j.phone_model}</div>
                <div style={{ fontSize: '12.5px', color: '#8a7a63', marginBottom: '10px' }}>{j.repair_customers?.name || '—'} · {j.repair_customers?.mobile || '—'}</div>
                <div style={{ fontSize: '12px', color: '#78716c', marginBottom: '12px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {j.reported_problem || 'No problem description'}
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  {due ? (
                    <span style={{ padding: '4px 11px', borderRadius: '10px', fontSize: '11px', fontWeight: '800', background: '#fee2e2', color: '#b91c1c' }}>⚠ DUE {formatLKR(j.balance_due)}</span>
                  ) : (
                    <span style={{ padding: '4px 11px', borderRadius: '10px', fontSize: '11px', fontWeight: '700', background: meta.bg, color: meta.color }}>{meta.label}</span>
                  )}
                  <span style={{ fontSize: '12px', color: '#a89478' }}>{timeAgo(j.created_at)}</span>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {showNew && <NewJobModal shop={shop} onClose={() => setShowNew(false)} onCreated={(id) => { setShowNew(false); fetchJobs(); onOpenJob(id) }} />}
    </div>
  )
}

function NewJobModal({ shop, onClose, onCreated }) {
  const [saving, setSaving] = useState(false)
  const [customAccessory, setCustomAccessory] = useState('')
  const [savedAccessoryOptions, setSavedAccessoryOptions] = useState([])
  const [matchedCustomer, setMatchedCustomer] = useState(null)
  const [nameResults, setNameResults] = useState([])
  const [showNameDropdown, setShowNameDropdown] = useState(false)
  const [checkingMobile, setCheckingMobile] = useState(false)
  const [form, setForm] = useState({
    customer_name: '', customer_mobile: '', alt_mobile: '', email: '',
    phone_brand: '', phone_model: '', imei: '', serial_no: '', phone_colour: '', storage_capacity: '',
    passcode: '', battery_pct_intake: '', accessories_received: [], phone_condition: [], other_condition_notes: '',
    reported_problem: '', detailed_notes: '', estimated_cost: '', estimated_completion: '', technician: '',
    priority: 'medium', warranty: false, warranty_expiry: '', warranty_duration: '', deposit_received: '',
  })

  useEffect(() => {
    supabase.from('repair_accessory_options').select('name').order('name').then(({ data }) => {
      setSavedAccessoryOptions((data || []).map(r => r.name))
    })
  }, [])

  useEffect(() => {
    const mobile = form.customer_mobile.trim()
    if (mobile.length < 6) { setMatchedCustomer(null); return }
    setCheckingMobile(true)
    const t = setTimeout(() => {
      supabase.from('repair_customers').select('id, name, mobile, alt_mobile, email').eq('mobile', mobile).maybeSingle()
        .then(({ data }) => {
          setCheckingMobile(false)
          if (data) {
            setMatchedCustomer(data)
            setForm(f => ({ ...f, customer_name: data.name, alt_mobile: data.alt_mobile || f.alt_mobile, email: data.email || f.email }))
          } else {
            setMatchedCustomer(null)
          }
        })
    }, 400)
    return () => clearTimeout(t)
  }, [form.customer_mobile])

  // Reverse of the mobile lookup above — search by name while typing, and
  // fill in the mobile (plus other details) once one is picked. The name
  // field can only be edited while no customer is matched (same as the
  // existing disabled-on-match behavior for the name field), so this never
  // runs at the same time as an active mobile-based match.
  useEffect(() => {
    const name = form.customer_name.trim()
    if (matchedCustomer || name.length < 2) { setNameResults([]); return }
    const t = setTimeout(() => {
      supabase.from('repair_customers').select('id, name, mobile, alt_mobile, email')
        .ilike('name', `%${name}%`).limit(8)
        .then(({ data }) => setNameResults(data || []))
    }, 400)
    return () => clearTimeout(t)
  }, [form.customer_name, matchedCustomer])

  function pickCustomerByName(c) {
    setMatchedCustomer(c)
    setForm(f => ({ ...f, customer_name: c.name, customer_mobile: c.mobile, alt_mobile: c.alt_mobile || f.alt_mobile, email: c.email || f.email }))
    setNameResults([])
    setShowNameDropdown(false)
  }

  function toggleArr(field, val) {
    setForm(f => ({ ...f, [field]: f[field].includes(val) ? f[field].filter(v => v !== val) : [...f[field], val] }))
  }

  // Persists a newly typed accessory so it's remembered and offered on future
  // jobs, not just kept on this one. Silently ignores a duplicate-name error
  // (someone else already saved the same one) rather than surfacing it as a
  // failure — the accessory still gets added to this job either way.
  async function addCustomAccessory(name) {
    toggleArr('accessories_received', name)
    if (!ACCESSORY_OPTIONS.includes(name) && !savedAccessoryOptions.includes(name)) {
      const { error } = await supabase.from('repair_accessory_options').insert({ name })
      if (!error) setSavedAccessoryOptions(prev => [...prev, name].sort())
    }
  }

  async function handleSave() {
    if (!form.customer_name.trim()) return toast.error('Customer name is required')
    if (!form.customer_mobile.trim()) return toast.error('Customer mobile is required')
    if (!form.phone_brand.trim()) return toast.error('Phone brand is required')
    const estCost = parseFloat(form.estimated_cost)
    if (isNaN(estCost) || estCost <= 0) return toast.error('Estimated cost is required and must be greater than 0')
    setSaving(true)
    try {
      // Find or create customer by mobile
      let customerId
      const { data: existing } = await supabase.from('repair_customers').select('id').eq('mobile', form.customer_mobile.trim()).maybeSingle()
      if (existing) {
        customerId = existing.id
      } else {
        const customer_no = await generateRepairCustomerNo()
        const { data: newCust, error: custErr } = await supabase.from('repair_customers').insert({
          customer_no, name: form.customer_name.trim(), mobile: form.customer_mobile.trim(),
          alt_mobile: form.alt_mobile || null, email: form.email || null,
        }).select().single()
        if (custErr) throw custErr
        customerId = newCust.id
      }

      const job_no = await generateRepairJobNo()
      const deposit = parseFloat(form.deposit_received) || 0
      const { data: newJob, error } = await supabase.from('repair_jobs').insert({
        job_no, shop_id: shop?.id || null, customer_id: customerId,
        phone_brand: form.phone_brand, phone_model: form.phone_model,
        imei: form.imei || null, serial_no: form.serial_no || null,
        phone_colour: form.phone_colour || null, storage_capacity: form.storage_capacity || null,
        passcode: form.passcode || null, battery_pct_intake: form.battery_pct_intake ? parseInt(form.battery_pct_intake) : null,
        accessories_received: form.accessories_received, phone_condition: form.phone_condition,
        other_condition_notes: form.other_condition_notes || null,
        reported_problem: form.reported_problem || null, detailed_notes: form.detailed_notes || null,
        estimated_cost: estCost, grand_total: estCost, gross_profit: estCost, net_profit: estCost,
        estimated_completion: form.estimated_completion || null,
        technician: form.technician || null, priority: form.priority,
        warranty: form.warranty, warranty_expiry: form.warranty_expiry || null,
        warranty_duration: form.warranty ? form.warranty_duration || null : null,
        deposit_received: deposit,
        balance_due: estCost - deposit,
        status: 'received',
      }).select().single()
      if (error) throw error

      // Job creation never raised the customer's outstanding_balance for the
      // unpaid portion — only credit sales did. Their balance still
      // self-heals on next open regardless, but this keeps it correct
      // immediately too (e.g. for the customer list, which doesn't recalc).
      const initialBalanceDue = estCost - deposit
      if (initialBalanceDue > 0) {
        await supabase.rpc('repair_adjust_customer_balance', { p_customer_id: customerId, p_delta: initialBalanceDue })
      }

      toast.success(`Job ${job_no} created!`)
      const { data: cust } = await supabase.from('repair_customers').select('*').eq('id', customerId).single()
      printJobReceipt(newJob, cust)
      onCreated(newJob.id)
    } catch (e) {
      toast.error('Failed: ' + e.message)
    }
    setSaving(false)
  }

  const inp = { width: '100%', padding: '9px 12px', border: '1.5px solid #e7dfd3', borderRadius: '8px', fontSize: '13px', boxSizing: 'border-box', outline: 'none' }
  const lbl = { display: 'block', marginBottom: '5px', fontSize: '11px', fontWeight: '700', color: '#a89478', textTransform: 'uppercase' }
  const section = { marginBottom: '18px' }
  const grid2 = { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' }
  const grid3 = { display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '12px' }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(28,25,23,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '20px' }}>
      <div style={{ background: 'white', borderRadius: '20px', padding: '28px', width: '100%', maxWidth: '720px', maxHeight: '88vh', overflowY: 'auto', boxShadow: '0 20px 60px rgba(0,0,0,0.3)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
          <h2 style={{ fontSize: '19px', fontWeight: '800', color: '#1c1917', margin: 0 }}>🔧 New Repair Job</h2>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: '22px', color: '#a89478', cursor: 'pointer' }}>✕</button>
        </div>

        <div style={section}>
          <div style={{ fontSize: '13px', fontWeight: '800', color: '#d4881f', marginBottom: '10px' }}>CUSTOMER</div>
          <div style={grid2}>
            <div style={{ position: 'relative' }}>
              <label style={lbl}>Mobile Number *</label>
              <input style={inp} value={form.customer_mobile} onChange={e => { setForm(f => ({ ...f, customer_mobile: e.target.value })); setMatchedCustomer(null) }} placeholder="e.g. 0771234567" />
              {matchedCustomer && (
                <div style={{ marginTop: '5px', fontSize: '11.5px', color: '#166534', fontWeight: '700', display: 'flex', alignItems: 'center', gap: '5px' }}>
                  ✓ Existing customer found: {matchedCustomer.name}
                </div>
              )}
              {checkingMobile && <div style={{ marginTop: '5px', fontSize: '11px', color: '#a89478' }}>Searching...</div>}
            </div>
            <div style={{ position: 'relative' }}>
              <label style={lbl}>Customer Name *</label>
              <input style={inp} value={form.customer_name}
                onChange={e => { setForm(f => ({ ...f, customer_name: e.target.value })); setShowNameDropdown(true) }}
                onFocus={() => setShowNameDropdown(true)}
                disabled={!!matchedCustomer} placeholder="Start typing to search..." />
              {matchedCustomer && (
                <div style={{ marginTop: '5px', fontSize: '11.5px', color: '#166534', fontWeight: '700' }}>
                  ✓ Existing customer — mobile filled in automatically
                </div>
              )}
              {showNameDropdown && !matchedCustomer && nameResults.length > 0 && (
                <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: 'white', border: '1.5px solid #e7dfd3', borderRadius: '8px', marginTop: '2px', zIndex: 20, boxShadow: '0 8px 20px rgba(0,0,0,0.12)', maxHeight: '200px', overflowY: 'auto' }}>
                  {nameResults.map(c => (
                    <div key={c.id} onClick={() => pickCustomerByName(c)}
                      style={{ padding: '9px 12px', cursor: 'pointer', fontSize: '13px', borderBottom: '1px solid #f8f5f0' }}
                      onMouseEnter={e => e.currentTarget.style.background = '#fdf8f3'}
                      onMouseLeave={e => e.currentTarget.style.background = 'white'}>
                      <div style={{ fontWeight: '600' }}>{c.name}</div>
                      <div style={{ fontSize: '11px', color: '#a89478' }}>{c.mobile}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div><label style={lbl}>Alternative Number</label><input style={inp} value={form.alt_mobile} onChange={e => setForm(f => ({ ...f, alt_mobile: e.target.value }))} /></div>
            <div><label style={lbl}>Email</label><input style={inp} value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} /></div>
          </div>
        </div>

        <div style={section}>
          <div style={{ fontSize: '13px', fontWeight: '800', color: '#d4881f', marginBottom: '10px' }}>DEVICE</div>
          <div style={{ ...grid3, marginBottom: '12px' }}>
            <div><label style={lbl}>Phone Brand *</label><input style={inp} value={form.phone_brand} onChange={e => setForm(f => ({ ...f, phone_brand: e.target.value }))} /></div>
            <div><label style={lbl}>Phone Model</label><input style={inp} value={form.phone_model} onChange={e => setForm(f => ({ ...f, phone_model: e.target.value }))} /></div>
            <div><label style={lbl}>Colour</label><input style={inp} value={form.phone_colour} onChange={e => setForm(f => ({ ...f, phone_colour: e.target.value }))} /></div>
          </div>
          <div style={{ ...grid3, marginBottom: '12px' }}>
            <div><label style={lbl}>IMEI</label><input style={inp} value={form.imei} onChange={e => setForm(f => ({ ...f, imei: e.target.value }))} /></div>
            <div><label style={lbl}>Serial No</label><input style={inp} value={form.serial_no} onChange={e => setForm(f => ({ ...f, serial_no: e.target.value }))} /></div>
            <div><label style={lbl}>Storage Capacity</label><input style={inp} value={form.storage_capacity} onChange={e => setForm(f => ({ ...f, storage_capacity: e.target.value }))} /></div>
          </div>
          <div style={grid2}>
            <div><label style={lbl}>Password / PIN</label><input style={inp} value={form.passcode} onChange={e => setForm(f => ({ ...f, passcode: e.target.value }))} /></div>
            <div><label style={lbl}>Battery % at Intake</label><input type="number" min="0" max="100" style={inp} value={form.battery_pct_intake} onChange={e => setForm(f => ({ ...f, battery_pct_intake: e.target.value }))} /></div>
          </div>
        </div>

        <div style={section}>
          <label style={lbl}>Accessories Received</label>
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '10px' }}>
            {[...new Set([...ACCESSORY_OPTIONS, ...savedAccessoryOptions, ...form.accessories_received])].map(a => (
              <button key={a} onClick={() => toggleArr('accessories_received', a)}
                style={{ padding: '6px 14px', borderRadius: '20px', border: form.accessories_received.includes(a) ? 'none' : '1.5px solid #e7dfd3', background: form.accessories_received.includes(a) ? 'linear-gradient(135deg,#f0b23d,#d4881f)' : 'white', color: form.accessories_received.includes(a) ? '#1c1917' : '#78716c', fontSize: '12px', fontWeight: '700', cursor: 'pointer' }}>
                {a}
              </button>
            ))}
          </div>
          <div style={{ display: 'flex', gap: '8px', marginBottom: '14px' }}>
            <input style={{ ...inp, flex: 1 }} placeholder="Add custom accessory..." value={customAccessory}
              onChange={e => setCustomAccessory(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && customAccessory.trim()) { e.preventDefault(); addCustomAccessory(customAccessory.trim()); setCustomAccessory('') } }} />
            <button onClick={() => { if (customAccessory.trim()) { addCustomAccessory(customAccessory.trim()); setCustomAccessory('') } }}
              style={{ padding: '0 16px', background: '#fef3e2', color: '#d4881f', border: 'none', borderRadius: '8px', cursor: 'pointer', fontSize: '12px', fontWeight: '700', whiteSpace: 'nowrap' }}>+ Add</button>
          </div>
          <label style={lbl}>Phone Condition</label>
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '10px' }}>
            {CONDITION_OPTIONS.map(c => (
              <button key={c} onClick={() => toggleArr('phone_condition', c)}
                style={{ padding: '6px 14px', borderRadius: '20px', border: form.phone_condition.includes(c) ? 'none' : '1.5px solid #e7dfd3', background: form.phone_condition.includes(c) ? '#fee2e2' : 'white', color: form.phone_condition.includes(c) ? '#b91c1c' : '#78716c', fontSize: '12px', fontWeight: '700', cursor: 'pointer' }}>
                {c}
              </button>
            ))}
          </div>
          <input style={inp} placeholder="Other condition notes..." value={form.other_condition_notes} onChange={e => setForm(f => ({ ...f, other_condition_notes: e.target.value }))} />
        </div>

        <div style={section}>
          <div style={{ fontSize: '13px', fontWeight: '800', color: '#d4881f', marginBottom: '10px' }}>PROBLEM & JOB DETAILS</div>
          <div style={{ marginBottom: '12px' }}><label style={lbl}>Reported Problem</label><input style={inp} value={form.reported_problem} onChange={e => setForm(f => ({ ...f, reported_problem: e.target.value }))} /></div>
          <div style={{ marginBottom: '12px' }}><label style={lbl}>Detailed Notes</label><textarea style={{ ...inp, minHeight: '60px' }} value={form.detailed_notes} onChange={e => setForm(f => ({ ...f, detailed_notes: e.target.value }))} /></div>
          <div style={grid3}>
            <div><label style={lbl}>Estimated Cost (LKR) *</label><input type="number" style={inp} value={form.estimated_cost} onChange={e => setForm(f => ({ ...f, estimated_cost: e.target.value }))} /></div>
            <div><label style={lbl}>Est. Completion Date</label><input type="date" style={inp} value={form.estimated_completion} onChange={e => setForm(f => ({ ...f, estimated_completion: e.target.value }))} /></div>
            <div><label style={lbl}>Technician Assigned</label><input style={inp} value={form.technician} onChange={e => setForm(f => ({ ...f, technician: e.target.value }))} /></div>
          </div>
        </div>

        <div style={section}>
          <div style={grid3}>
            <div>
              <label style={lbl}>Priority</label>
              <select style={inp} value={form.priority} onChange={e => setForm(f => ({ ...f, priority: e.target.value }))}>
                {PRIORITIES.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
              </select>
            </div>
            <div><label style={lbl}>Deposit Received (LKR)</label><input type="number" style={inp} value={form.deposit_received} onChange={e => setForm(f => ({ ...f, deposit_received: e.target.value }))} /></div>
            <div style={{ display: 'flex', alignItems: 'flex-end', paddingBottom: '3px' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '13px', fontWeight: '600', color: '#44403c', cursor: 'pointer' }}>
                <input type="checkbox" checked={form.warranty} onChange={e => setForm(f => ({ ...f, warranty: e.target.checked }))} /> Under Warranty
              </label>
            </div>
          </div>
          {form.warranty && (
            <div style={{ marginTop: '10px' }}>
              <label style={lbl}>Warranty Duration</label>
              <select style={inp} value={form.warranty_duration || ''} onChange={e => {
                const dur = e.target.value
                const days = { '7_days': 7, '1_month': 30, '3_month': 90, '6_month': 180 }[dur]
                const expiry = days ? new Date(Date.now() + days * 86400000).toISOString().slice(0, 10) : ''
                setForm(f => ({ ...f, warranty_duration: dur, warranty_expiry: expiry }))
              }}>
                <option value="">— Select duration —</option>
                <option value="7_days">7 Days</option>
                <option value="1_month">1 Month</option>
                <option value="3_month">3 Months</option>
                <option value="6_month">6 Months</option>
              </select>
              {form.warranty_expiry && <div style={{ fontSize: '11px', color: '#8a7a63', marginTop: '4px' }}>Expires: {new Date(form.warranty_expiry).toLocaleDateString('en-GB', { day: '2-digit', month: 'long', year: 'numeric' })}</div>}
            </div>
          )}
        </div>

        <div style={{ display: 'flex', gap: '10px', marginTop: '10px' }}>
          <button onClick={onClose} style={{ flex: 1, padding: '12px', background: '#f5f1ea', color: '#78716c', border: 'none', borderRadius: '10px', cursor: 'pointer', fontWeight: '700', fontSize: '14px' }}>Cancel</button>
          <button onClick={handleSave} disabled={saving} style={{ flex: 2, padding: '12px', background: saving ? '#fbd898' : 'linear-gradient(135deg,#f0b23d,#d4881f)', color: '#1c1917', border: 'none', borderRadius: '10px', cursor: 'pointer', fontWeight: '800', fontSize: '15px' }}>
            {saving ? 'Creating...' : '✓ Create Job'}
          </button>
        </div>
      </div>
    </div>
  )
}
