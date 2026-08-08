import { useState, useEffect } from 'react'
import { supabase } from '../../supabase'
import { formatCurrency } from '../../lib/helpers'
import toast from 'react-hot-toast'

const TABS = ['Staff', 'Attendance', 'Leave Requests', 'Manual Requests', 'Salary']
const DAYS = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun']
const inp = { padding:'8px 12px', border:'1.5px solid #e2e8f0', borderRadius:'7px', fontSize:'13px', outline:'none', background:'white', width:'100%', boxSizing:'border-box' }
const btn = (color='#2563eb',bg='#eef2ff') => ({ padding:'8px 18px', background:bg, color, border:`1.5px solid ${color}33`, borderRadius:'8px', cursor:'pointer', fontWeight:'700', fontSize:'13px' })

export default function HRModule() {
  const [tab, setTab] = useState('Staff')
  const [staff, setStaff] = useState([])
  const [shops, setShops] = useState([])
  const [attendance, setAttendance] = useState([])
  const [leaveReqs, setLeaveReqs] = useState([])
  const [manualReqs, setManualReqs] = useState([])
  const [salaryPmts, setSalaryPmts] = useState([])
  const [bankAccounts, setBankAccounts] = useState([])
  const [loading, setLoading] = useState(true)
  const [selectedStaff, setSelectedStaff] = useState(null)
  const [showStaffForm, setShowStaffForm] = useState(false)
  const [showSalaryModal, setShowSalaryModal] = useState(null)
  const [attendFilter, setAttendFilter] = useState({ date: new Date().toISOString().split('T')[0], staff_id: '' })
  const [salaryFilter, setSalaryFilter] = useState('')
  const [editStaff, setEditStaff] = useState(null)

  useEffect(() => { fetchAll() }, [])

  async function fetchAll() {
    setLoading(true)
    const [{ data: s }, { data: sh }, { data: a }, { data: lr }, { data: mr }, { data: sp }, { data: ba }] = await Promise.all([
      supabase.from('hr_staff').select('*').order('name'),
      supabase.from('shops').select('*').order('name'),
      supabase.from('hr_attendance').select('*, hr_staff(name)').order('date', { ascending: false }).limit(200),
      supabase.from('hr_leave_requests').select('*, hr_staff(name)').order('created_at', { ascending: false }),
      supabase.from('hr_attendance_requests').select('*, hr_staff(name)').order('created_at', { ascending: false }),
      supabase.from('hr_salary_payments').select('*, hr_staff(name)').order('created_at', { ascending: false }).limit(100),
      supabase.from('bank_accounts').select('*').eq('is_active', true).order('name'),
    ])
    setStaff(s || [])
    setShops(sh || [])
    setAttendance(a || [])
    setLeaveReqs(lr || [])
    setManualReqs(mr || [])
    setSalaryPmts(sp || [])
    setBankAccounts(ba || [])
    setLoading(false)
  }

  // ── Auto-reset salary on new month ──────────────────────────────────────
  async function checkSalaryReset(staffList) {
    const today = new Date()
    const firstOfMonth = new Date(today.getFullYear(), today.getMonth(), 1).toISOString().split('T')[0]
    for (const s of staffList) {
      if (s.salary_reset_date < firstOfMonth) {
        await supabase.from('hr_staff').update({ salary_paid: 0, salary_reset_date: firstOfMonth }).eq('id', s.id)
      }
    }
  }
  useEffect(() => { if (staff.length) checkSalaryReset(staff) }, [staff.length])

  const totalPayable = staff.filter(s => s.active).reduce((sum, s) => {
    const due = Math.max(0, (s.monthly_salary || 0) - (s.salary_paid || 0))
    return sum + due
  }, 0)

  // ── Staff form ───────────────────────────────────────────────────────────
  const emptyForm = { name:'', phone:'', nic:'', address:'', role:'staff', shop_id:'', monthly_salary:'', shift_start:'09:00', shift_end:'18:00', shift_days:['Mon','Tue','Wed','Thu','Fri','Sat'], geo_lat:'', geo_lng:'', geo_radius_m:25, annual_leave_balance:0, casual_leave_balance:0 }
  const [form, setForm] = useState(emptyForm)
  const F = (k, v) => setForm(f => ({ ...f, [k]: v }))

  async function saveStaff() {
    if (!form.name.trim()) return toast.error('Name required')
    const payload = { ...form, monthly_salary: parseFloat(form.monthly_salary)||0, geo_lat: parseFloat(form.geo_lat)||null, geo_lng: parseFloat(form.geo_lng)||null, geo_radius_m: parseInt(form.geo_radius_m)||25, annual_leave_balance: form.annual_leave_balance === '' ? 0 : parseInt(form.annual_leave_balance), casual_leave_balance: form.casual_leave_balance === '' ? 0 : parseInt(form.casual_leave_balance), shop_id: form.shop_id||null }
    if (editStaff) {
      const { error } = await supabase.from('hr_staff').update(payload).eq('id', editStaff.id)
      if (error) return toast.error('Failed to update')
      toast.success('Staff updated')
    } else {
      const { error } = await supabase.from('hr_staff').insert(payload)
      if (error) return toast.error('Failed to create')
      toast.success('Staff created')
    }
    setShowStaffForm(false); setEditStaff(null); setForm(emptyForm); fetchAll()
  }

  async function toggleActive(s) {
    await supabase.from('hr_staff').update({ active: !s.active }).eq('id', s.id)
    fetchAll()
  }

  // ── Salary payment ───────────────────────────────────────────────────────
  const [payAmt, setPayAmt] = useState(''); const [payMethod, setPayMethod] = useState('cash'); const [payNote, setPayNote] = useState(''); const [payBankId, setPayBankId] = useState('')
  async function paySalary() {
    if (!payAmt || parseFloat(payAmt) <= 0) return toast.error('Enter amount')
    if (payMethod === 'bank_transfer' && !payBankId) return toast.error('Select a bank account')
    const s = showSalaryModal
    const amt = parseFloat(payAmt)
    const shopId = s.shop_id || null
    const desc = `Salary — ${s.name}`

    // 1. Record salary payment
    await supabase.from('hr_salary_payments').insert({ staff_id: s.id, amount: amt, payment_method: payMethod, notes: payNote })

    // 2. Update staff paid amount
    await supabase.from('hr_staff').update({ salary_paid: (s.salary_paid||0) + amt }).eq('id', s.id)

    // 3. Record as expense so it flows into cashflow / end-of-shift
    await supabase.from('expenses').insert({
      description: desc,
      amount: amt,
      payment_method: payMethod === 'bank_transfer' ? 'bank' : 'cash',
      bank_account_id: payMethod === 'bank_transfer' ? payBankId : null,
      category: 'Salary',
      shop_id: shopId,
    })

    // 4. If bank transfer: deduct from bank balance + log bank transaction
    if (payMethod === 'bank_transfer' && payBankId) {
      const bank = bankAccounts.find(b => b.id === payBankId)
      if (bank) {
        await supabase.from('bank_accounts').update({ balance: (bank.balance || 0) - amt }).eq('id', payBankId)
        await supabase.from('bank_transactions').insert({
          bank_account_id: payBankId,
          type: 'withdrawal',
          amount: amt,
          reference: desc,
          notes: 'Salary Payment',
          shop_id: shopId,
        })
      }
    }

    toast.success(`Salary payment of ${formatCurrency(amt)} recorded`)
    setShowSalaryModal(null); setPayAmt(''); setPayNote(''); setPayBankId(''); fetchAll()
  }

  // ── Leave / Manual approve/reject ────────────────────────────────────────
  async function reviewLeave(id, status) {
    const req = leaveReqs.find(r => r.id === id)
    await supabase.from('hr_leave_requests').update({ status, reviewed_at: new Date().toISOString() }).eq('id', id)
    if (status === 'approved' && req) {
      const s = staff.find(s => s.id === req.staff_id)
      if (s) {
        if (req.leave_type === 'annual') await supabase.from('hr_staff').update({ annual_leave_balance: Math.max(0, (s.annual_leave_balance||0) - req.days) }).eq('id', s.id)
        if (req.leave_type === 'casual') await supabase.from('hr_staff').update({ casual_leave_balance: Math.max(0, (s.casual_leave_balance||0) - req.days) }).eq('id', s.id)
        // Mark attendance as leave for each day
        for (let d = new Date(req.date_from); d <= new Date(req.date_to); d.setDate(d.getDate()+1)) {
          const dateStr = d.toISOString().split('T')[0]
          await supabase.from('hr_attendance').upsert({ staff_id: req.staff_id, date: dateStr, status: 'leave' }, { onConflict: 'staff_id,date' })
        }
      }
    }
    toast.success(`Leave ${status}`)
    fetchAll()
  }

  async function reviewManual(id, status) {
    const req = manualReqs.find(r => r.id === id)
    await supabase.from('hr_attendance_requests').update({ status, reviewed_at: new Date().toISOString() }).eq('id', id)
    if (status === 'approved' && req) {
      const startDt = new Date(`${req.date}T${req.shift_start}`)
      const endDt = new Date(`${req.date}T${req.shift_end}`)
      await supabase.from('hr_attendance').upsert({
        staff_id: req.staff_id, date: req.date,
        shift_start: startDt.toISOString(), shift_end: endDt.toISOString(), status: 'present', notes: `Manual: ${req.reason}`
      }, { onConflict: 'staff_id,date' })
      // Switch to Attendance tab filtered to that date so admin can see the result
      setAttendFilter({ date: req.date, staff_id: req.staff_id })
      setTab('Attendance')
    }
    toast.success(`Request ${status}`)
    fetchAll()
  }

  // ── Attendance edit override ─────────────────────────────────────────────
  async function overrideAttendance(rec, field, value) {
    await supabase.from('hr_attendance').update({ [field]: value }).eq('id', rec.id)
    fetchAll()
  }

  const filteredAttendance = attendance.filter(a => {
    if (attendFilter.date && a.date !== attendFilter.date) return false
    if (attendFilter.staff_id && a.staff_id !== attendFilter.staff_id) return false
    return true
  })

  const attendLink = (s) => `${window.location.origin}/attendance/${s.id}`

  const sCard = { background:'white', borderRadius:'12px', padding:'20px', boxShadow:'0 1px 4px rgba(0,0,0,0.06)' }
  const label = { fontSize:'11px', fontWeight:'700', color:'#94a3b8', textTransform:'uppercase', letterSpacing:'0.06em', marginBottom:'4px' }
  const statusBadge = (s) => {
    const map = { pending:['#fef3c7','#92400e'], approved:['#dcfce7','#166534'], rejected:['#fee2e2','#991b1b'], present:['#dcfce7','#166534'], absent:['#fee2e2','#991b1b'], leave:['#e0f2fe','#0369a1'], half_day:['#fef3c7','#92400e'] }
    const [bg, col] = map[s] || ['#f1f5f9','#64748b']
    return { background:bg, color:col, padding:'2px 10px', borderRadius:'20px', fontSize:'11px', fontWeight:'700', textTransform:'capitalize' }
  }

  if (loading) return <div style={{ padding:'60px', textAlign:'center', color:'#94a3b8' }}>Loading HR data…</div>

  return (
    <div>
      {/* Header */}
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:'24px' }}>
        <div>
          <h2 style={{ fontSize:'20px', fontWeight:'700', color:'#0f172a', margin:'0 0 4px' }}>HR Management</h2>
          <p style={{ color:'#64748b', fontSize:'13px', margin:0 }}>Staff profiles, attendance, salary &amp; leaves</p>
        </div>
        <div style={{ display:'flex', gap:'10px', alignItems:'center' }}>
          <div style={{ background:'#fff7ed', border:'1.5px solid #fed7aa', borderRadius:'10px', padding:'10px 16px', textAlign:'right' }}>
            <div style={{ fontSize:'10px', fontWeight:'700', color:'#c2410c', textTransform:'uppercase' }}>Total Salary Payable</div>
            <div style={{ fontSize:'18px', fontWeight:'800', color:'#ea580c' }}>{formatCurrency(totalPayable)}</div>
          </div>
          {tab === 'Staff' && <button onClick={() => { setForm(emptyForm); setEditStaff(null); setShowStaffForm(true) }} style={{ ...btn('#fff','#1e40af'), color:'white' }}>+ Add Staff</button>}
        </div>
      </div>

      {/* Tabs */}
      <div style={{ display:'flex', gap:'4px', marginBottom:'20px', borderBottom:'2px solid #e2e8f0', paddingBottom:'0' }}>
        {TABS.map(t => (
          <button key={t} onClick={() => setTab(t)}
            style={{ padding:'10px 18px', border:'none', background:'transparent', cursor:'pointer', fontSize:'13px', fontWeight:tab===t?'700':'500', color:tab===t?'#1e40af':'#64748b', borderBottom:tab===t?'2px solid #1e40af':'2px solid transparent', marginBottom:'-2px', borderRadius:'0' }}>
            {t}
            {t === 'Leave Requests' && leaveReqs.filter(r=>r.status==='pending').length > 0 && <span style={{ marginLeft:'6px', background:'#ef4444', color:'white', borderRadius:'10px', padding:'1px 7px', fontSize:'10px' }}>{leaveReqs.filter(r=>r.status==='pending').length}</span>}
            {t === 'Manual Requests' && manualReqs.filter(r=>r.status==='pending').length > 0 && <span style={{ marginLeft:'6px', background:'#f59e0b', color:'white', borderRadius:'10px', padding:'1px 7px', fontSize:'10px' }}>{manualReqs.filter(r=>r.status==='pending').length}</span>}
          </button>
        ))}
      </div>

      {/* ── STAFF TAB ── */}
      {tab === 'Staff' && (
        <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(320px,1fr))', gap:'16px' }}>
          {staff.map(s => {
            const due = Math.max(0, (s.monthly_salary||0) - (s.salary_paid||0))
            const pct = s.monthly_salary > 0 ? Math.min(100, ((s.salary_paid||0)/s.monthly_salary)*100) : 0
            const shop = shops.find(sh => sh.id === s.shop_id)
            return (
              <div key={s.id} style={{ ...sCard, opacity: s.active ? 1 : 0.55, border: s.active ? '1.5px solid #e2e8f0' : '1.5px dashed #e2e8f0' }}>
                <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:'12px' }}>
                  <div style={{ display:'flex', alignItems:'center', gap:'10px' }}>
                    <div style={{ width:'40px', height:'40px', borderRadius:'50%', background:'linear-gradient(135deg,#2563eb,#1d4ed8)', display:'flex', alignItems:'center', justifyContent:'center', color:'white', fontWeight:'700', fontSize:'16px' }}>{s.name[0]}</div>
                    <div>
                      <div style={{ fontWeight:'700', color:'#0f172a', fontSize:'15px' }}>{s.name}</div>
                      <div style={{ fontSize:'12px', color:'#64748b' }}>{s.role} {shop ? `· ${shop.name}` : ''}</div>
                    </div>
                  </div>
                  <div style={{ display:'flex', gap:'6px' }}>
                    <button onClick={() => { setEditStaff(s); setForm({ ...s, monthly_salary: s.monthly_salary||'', geo_lat: s.geo_lat||'', geo_lng: s.geo_lng||'' }); setShowStaffForm(true) }} style={{ ...btn('#2563eb'), padding:'5px 10px', fontSize:'12px' }}>Edit</button>
                    <button onClick={() => toggleActive(s)} style={{ ...btn(s.active?'#e11d48':'#059669', s.active?'#fee2e2':'#dcfce7'), padding:'5px 10px', fontSize:'12px' }}>{s.active ? 'Deactivate' : 'Activate'}</button>
                  </div>
                </div>

                <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'8px', marginBottom:'12px', fontSize:'12px' }}>
                  <div><span style={{ color:'#94a3b8' }}>Phone: </span><span style={{ fontWeight:'600' }}>{s.phone||'—'}</span></div>
                  <div><span style={{ color:'#94a3b8' }}>NIC: </span><span style={{ fontWeight:'600' }}>{s.nic||'—'}</span></div>
                  <div><span style={{ color:'#94a3b8' }}>Shift: </span><span style={{ fontWeight:'600' }}>{s.shift_start} – {s.shift_end}</span></div>
                  <div style={{ display:'flex', gap:'8px' }}>
                    <span style={{ fontSize:'11px', background:'#e0f2fe', color:'#0369a1', padding:'2px 8px', borderRadius:'8px', fontWeight:'700' }}>Annual: {s.annual_leave_balance}d</span>
                    <span style={{ fontSize:'11px', background:'#f0fdf4', color:'#166534', padding:'2px 8px', borderRadius:'8px', fontWeight:'700' }}>Casual: {s.casual_leave_balance}d</span>
                  </div>
                </div>

                {/* Salary bar */}
                <div style={{ marginBottom:'10px' }}>
                  <div style={{ display:'flex', justifyContent:'space-between', marginBottom:'4px' }}>
                    <div style={{ fontSize:'11px', color:'#94a3b8', fontWeight:'700', textTransform:'uppercase' }}>Salary This Month</div>
                    <div style={{ fontSize:'12px', fontWeight:'700', color: due>0?'#e11d48':'#059669' }}>
                      {due > 0 ? `${formatCurrency(due)} due` : '✓ Paid'}
                    </div>
                  </div>
                  <div style={{ height:'6px', background:'#f1f5f9', borderRadius:'3px', overflow:'hidden' }}>
                    <div style={{ width:`${pct}%`, height:'100%', background: pct>=100?'#059669':'#2563eb', borderRadius:'3px' }} />
                  </div>
                  <div style={{ display:'flex', justifyContent:'space-between', marginTop:'3px', fontSize:'11px', color:'#94a3b8' }}>
                    <span>Paid: {formatCurrency(s.salary_paid||0)}</span>
                    <span>Total: {formatCurrency(s.monthly_salary||0)}</span>
                  </div>
                </div>

                <div style={{ display:'flex', gap:'8px' }}>
                  <button onClick={() => setShowSalaryModal(s)} style={{ ...btn('#059669','#f0fdf4'), flex:1, fontSize:'12px', padding:'7px' }}>💰 Pay Salary</button>
                  <button onClick={() => { navigator.clipboard.writeText(attendLink(s)); toast.success('Attendance link copied!') }}
                    style={{ ...btn('#2563eb'), flex:1, fontSize:'12px', padding:'7px' }}>🔗 Copy Link</button>
                </div>
              </div>
            )
          })}
          {staff.length === 0 && <div style={{ gridColumn:'1/-1', textAlign:'center', color:'#94a3b8', padding:'60px' }}>No staff added yet. Click "+ Add Staff" to begin.</div>}
        </div>
      )}

      {/* ── ATTENDANCE TAB ── */}
      {tab === 'Attendance' && (
        <div>
          <div style={{ display:'flex', gap:'12px', marginBottom:'16px', flexWrap:'wrap', alignItems:'flex-end' }}>
            <div><div style={label}>Date</div><input type="date" value={attendFilter.date} onChange={e => setAttendFilter(f=>({...f,date:e.target.value}))} style={{ ...inp, width:'160px' }} /></div>
            <div>
              <div style={label}>Staff</div>
              <select value={attendFilter.staff_id} onChange={e => setAttendFilter(f=>({...f,staff_id:e.target.value}))} style={{ ...inp, width:'180px' }}>
                <option value="">All Staff</option>
                {staff.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
            <button onClick={() => setAttendFilter({ date: new Date().toISOString().split('T')[0], staff_id: '' })} style={btn()}>Today</button>
          </div>
          <div style={{ background:'white', borderRadius:'12px', boxShadow:'0 1px 4px rgba(0,0,0,0.06)', overflow:'hidden' }}>
            <table style={{ width:'100%', borderCollapse:'collapse' }}>
              <thead>
                <tr style={{ background:'#f8fafc' }}>
                  {['Staff','Date','Shift Start','Shift End','Duration','Status','Auto-ended',''].map((h,i) => (
                    <th key={i} style={{ padding:'10px 14px', textAlign:'left', fontSize:'11px', fontWeight:'700', color:'#94a3b8', textTransform:'uppercase', borderBottom:'2px solid #e2e8f0' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filteredAttendance.map(a => {
                  const start = a.shift_start ? new Date(a.shift_start) : null
                  const end = a.shift_end ? new Date(a.shift_end) : null
                  const durMin = start && end ? Math.round((end-start)/60000) : null
                  const durStr = durMin ? `${Math.floor(durMin/60)}h ${durMin%60}m` : '—'
                  return (
                    <tr key={a.id} style={{ borderBottom:'1px solid #f1f5f9' }}>
                      <td style={{ padding:'10px 14px', fontWeight:'600', color:'#0f172a', fontSize:'13px' }}>{a.hr_staff?.name}</td>
                      <td style={{ padding:'10px 14px', fontSize:'13px', color:'#64748b' }}>{a.date}</td>
                      <td style={{ padding:'10px 14px', fontSize:'13px' }}>{start ? start.toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'}) : '—'}</td>
                      <td style={{ padding:'10px 14px', fontSize:'13px' }}>{end ? end.toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'}) : <span style={{ color:'#f59e0b', fontWeight:'700' }}>Active</span>}</td>
                      <td style={{ padding:'10px 14px', fontSize:'13px', fontWeight:'600', color:'#2563eb' }}>{durStr}</td>
                      <td style={{ padding:'10px 14px' }}><span style={statusBadge(a.status)}>{a.status}</span></td>
                      <td style={{ padding:'10px 14px' }}>{a.auto_ended && <span style={{ fontSize:'11px', color:'#f59e0b', fontWeight:'700' }}>⚡ Auto</span>}</td>
                      <td style={{ padding:'10px 14px' }}>
                        <select value={a.status} onChange={e => overrideAttendance(a, 'status', e.target.value)}
                          style={{ fontSize:'12px', padding:'4px 8px', border:'1px solid #e2e8f0', borderRadius:'6px', cursor:'pointer' }}>
                          {['present','absent','half_day','leave'].map(s => <option key={s} value={s}>{s}</option>)}
                        </select>
                      </td>
                    </tr>
                  )
                })}
                {filteredAttendance.length === 0 && <tr><td colSpan={8} style={{ padding:'40px', textAlign:'center', color:'#94a3b8' }}>No attendance records for this filter</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── LEAVE REQUESTS TAB ── */}
      {tab === 'Leave Requests' && (
        <div style={{ background:'white', borderRadius:'12px', boxShadow:'0 1px 4px rgba(0,0,0,0.06)', overflow:'hidden' }}>
          <table style={{ width:'100%', borderCollapse:'collapse' }}>
            <thead>
              <tr style={{ background:'#f8fafc' }}>
                {['Staff','Type','From','To','Days','Reason','Status','Action'].map((h,i) => (
                  <th key={i} style={{ padding:'10px 14px', textAlign:'left', fontSize:'11px', fontWeight:'700', color:'#94a3b8', textTransform:'uppercase', borderBottom:'2px solid #e2e8f0' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {leaveReqs.map(r => (
                <tr key={r.id} style={{ borderBottom:'1px solid #f1f5f9' }}>
                  <td style={{ padding:'10px 14px', fontWeight:'600', color:'#0f172a', fontSize:'13px' }}>{r.hr_staff?.name}</td>
                  <td style={{ padding:'10px 14px' }}><span style={{ background:'#e0f2fe', color:'#0369a1', padding:'2px 8px', borderRadius:'8px', fontSize:'11px', fontWeight:'700' }}>{r.leave_type}</span></td>
                  <td style={{ padding:'10px 14px', fontSize:'13px', color:'#64748b' }}>{r.date_from}</td>
                  <td style={{ padding:'10px 14px', fontSize:'13px', color:'#64748b' }}>{r.date_to}</td>
                  <td style={{ padding:'10px 14px', fontWeight:'700', color:'#1e40af' }}>{r.days}d</td>
                  <td style={{ padding:'10px 14px', fontSize:'12px', color:'#64748b', maxWidth:'200px' }}>{r.reason||'—'}</td>
                  <td style={{ padding:'10px 14px' }}><span style={statusBadge(r.status)}>{r.status}</span></td>
                  <td style={{ padding:'10px 14px' }}>
                    {r.status === 'pending' && (
                      <div style={{ display:'flex', gap:'6px' }}>
                        <button onClick={() => reviewLeave(r.id,'approved')} style={{ ...btn('#059669','#f0fdf4'), padding:'5px 10px', fontSize:'12px' }}>✓</button>
                        <button onClick={() => reviewLeave(r.id,'rejected')} style={{ ...btn('#e11d48','#fee2e2'), padding:'5px 10px', fontSize:'12px' }}>✕</button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
              {leaveReqs.length === 0 && <tr><td colSpan={8} style={{ padding:'40px', textAlign:'center', color:'#94a3b8' }}>No leave requests</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {/* ── MANUAL REQUESTS TAB ── */}
      {tab === 'Manual Requests' && (
        <div style={{ background:'white', borderRadius:'12px', boxShadow:'0 1px 4px rgba(0,0,0,0.06)', overflow:'hidden' }}>
          <table style={{ width:'100%', borderCollapse:'collapse' }}>
            <thead>
              <tr style={{ background:'#f8fafc' }}>
                {['Staff','Date','Start','End','Reason','Requested','Status','Action'].map((h,i) => (
                  <th key={i} style={{ padding:'10px 14px', textAlign:'left', fontSize:'11px', fontWeight:'700', color:'#94a3b8', textTransform:'uppercase', borderBottom:'2px solid #e2e8f0' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {manualReqs.map(r => (
                <tr key={r.id} style={{ borderBottom:'1px solid #f1f5f9' }}>
                  <td style={{ padding:'10px 14px', fontWeight:'600', color:'#0f172a', fontSize:'13px' }}>{r.hr_staff?.name}</td>
                  <td style={{ padding:'10px 14px', fontSize:'13px', color:'#64748b' }}>{r.date}</td>
                  <td style={{ padding:'10px 14px', fontSize:'13px' }}>{r.shift_start}</td>
                  <td style={{ padding:'10px 14px', fontSize:'13px' }}>{r.shift_end}</td>
                  <td style={{ padding:'10px 14px', fontSize:'12px', color:'#64748b', maxWidth:'180px' }}>{r.reason}</td>
                  <td style={{ padding:'10px 14px', fontSize:'12px', color:'#94a3b8' }}>{new Date(r.created_at).toLocaleDateString('en-GB')}</td>
                  <td style={{ padding:'10px 14px' }}><span style={statusBadge(r.status)}>{r.status}</span></td>
                  <td style={{ padding:'10px 14px' }}>
                    {r.status === 'pending' && (
                      <div style={{ display:'flex', gap:'6px' }}>
                        <button onClick={() => reviewManual(r.id,'approved')} style={{ ...btn('#059669','#f0fdf4'), padding:'5px 10px', fontSize:'12px' }}>✓ Approve</button>
                        <button onClick={() => reviewManual(r.id,'rejected')} style={{ ...btn('#e11d48','#fee2e2'), padding:'5px 10px', fontSize:'12px' }}>✕</button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
              {manualReqs.length === 0 && <tr><td colSpan={8} style={{ padding:'40px', textAlign:'center', color:'#94a3b8' }}>No manual entry requests</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {/* ── SALARY TAB ── */}
      {tab === 'Salary' && (
        <div>
          <div style={{ marginBottom:'16px' }}>
            <select value={salaryFilter} onChange={e => setSalaryFilter(e.target.value)} style={{ ...inp, width:'220px' }}>
              <option value="">All Staff</option>
              {staff.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
          <div style={{ background:'white', borderRadius:'12px', boxShadow:'0 1px 4px rgba(0,0,0,0.06)', overflow:'hidden' }}>
            <table style={{ width:'100%', borderCollapse:'collapse' }}>
              <thead>
                <tr style={{ background:'#f8fafc' }}>
                  {['Staff','Amount','Method','Notes','Date'].map((h,i) => (
                    <th key={i} style={{ padding:'10px 14px', textAlign:'left', fontSize:'11px', fontWeight:'700', color:'#94a3b8', textTransform:'uppercase', borderBottom:'2px solid #e2e8f0' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {salaryPmts.filter(p => !salaryFilter || p.staff_id === salaryFilter).map(p => (
                  <tr key={p.id} style={{ borderBottom:'1px solid #f1f5f9' }}>
                    <td style={{ padding:'10px 14px', fontWeight:'600', color:'#0f172a', fontSize:'13px' }}>{p.hr_staff?.name}</td>
                    <td style={{ padding:'10px 14px', fontWeight:'700', color:'#059669', fontSize:'14px' }}>{formatCurrency(p.amount)}</td>
                    <td style={{ padding:'10px 14px' }}><span style={{ background:'#dcfce7', color:'#166534', padding:'2px 8px', borderRadius:'8px', fontSize:'11px', fontWeight:'700', textTransform:'capitalize' }}>{p.payment_method}</span></td>
                    <td style={{ padding:'10px 14px', fontSize:'12px', color:'#64748b' }}>{p.notes||'—'}</td>
                    <td style={{ padding:'10px 14px', fontSize:'12px', color:'#94a3b8' }}>{new Date(p.created_at).toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'})}</td>
                  </tr>
                ))}
                {salaryPmts.filter(p => !salaryFilter || p.staff_id === salaryFilter).length === 0 && (
                  <tr><td colSpan={5} style={{ padding:'40px', textAlign:'center', color:'#94a3b8' }}>No payments recorded</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── STAFF FORM MODAL ── */}
      {showStaffForm && (
        <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.5)', zIndex:1000, display:'flex', alignItems:'center', justifyContent:'center', padding:'20px' }}>
          <div style={{ background:'white', borderRadius:'16px', width:'100%', maxWidth:'620px', maxHeight:'90vh', overflowY:'auto', padding:'28px' }}>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'20px' }}>
              <h3 style={{ margin:0, fontSize:'18px', fontWeight:'700', color:'#0f172a' }}>{editStaff ? 'Edit Staff' : 'Add Staff Member'}</h3>
              <button onClick={() => { setShowStaffForm(false); setEditStaff(null) }} style={{ background:'#f1f5f9', border:'none', borderRadius:'8px', width:'32px', height:'32px', cursor:'pointer', fontSize:'16px' }}>✕</button>
            </div>

            <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'14px' }}>
              {[['Name *','name','text'],['Phone','phone','text'],['NIC','nic','text'],['Address','address','text']].map(([l,k,t]) => (
                <div key={k} style={{ gridColumn: k==='address'?'1/-1':undefined }}>
                  <div style={label}>{l}</div>
                  <input type={t} value={form[k]||''} onChange={e=>F(k,e.target.value)} style={inp} />
                </div>
              ))}
              <div>
                <div style={label}>Role</div>
                <select value={form.role} onChange={e=>F('role',e.target.value)} style={inp}>
                  <option value="staff">Staff</option>
                  <option value="cashier">Cashier</option>
                  <option value="manager">Manager</option>
                </select>
              </div>
              <div>
                <div style={label}>Shop</div>
                <select value={form.shop_id||''} onChange={e=>F('shop_id',e.target.value)} style={inp}>
                  <option value="">No specific shop</option>
                  {shops.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>
              <div>
                <div style={label}>Monthly Salary (LKR)</div>
                <input type="number" value={form.monthly_salary} onChange={e=>F('monthly_salary',e.target.value)} style={inp} />
              </div>
              <div>
                <div style={label}>Geo Radius (metres)</div>
                <input type="number" value={form.geo_radius_m} onChange={e=>F('geo_radius_m',e.target.value)} style={inp} />
              </div>
              <div>
                <div style={label}>Shift Start</div>
                <input type="time" value={form.shift_start} onChange={e=>F('shift_start',e.target.value)} style={inp} />
              </div>
              <div>
                <div style={label}>Shift End (auto-close time)</div>
                <input type="time" value={form.shift_end} onChange={e=>F('shift_end',e.target.value)} style={inp} />
              </div>
              <div>
                <div style={label}>Annual Leave Days</div>
                <input type="number" value={form.annual_leave_balance} onChange={e=>F('annual_leave_balance',e.target.value)} style={inp} />
              </div>
              <div>
                <div style={label}>Casual Leave Days</div>
                <input type="number" value={form.casual_leave_balance} onChange={e=>F('casual_leave_balance',e.target.value)} style={inp} />
              </div>

              {/* Work days */}
              <div style={{ gridColumn:'1/-1' }}>
                <div style={label}>Work Days</div>
                <div style={{ display:'flex', gap:'8px', flexWrap:'wrap' }}>
                  {DAYS.map(d => (
                    <label key={d} style={{ display:'flex', alignItems:'center', gap:'4px', cursor:'pointer', userSelect:'none', fontSize:'13px', fontWeight:'600',
                      color: (form.shift_days||[]).includes(d) ? '#1e40af' : '#94a3b8' }}>
                      <input type="checkbox" checked={(form.shift_days||[]).includes(d)}
                        onChange={e => F('shift_days', e.target.checked ? [...(form.shift_days||[]),d] : (form.shift_days||[]).filter(x=>x!==d))}
                        style={{ accentColor:'#1e40af' }} />
                      {d}
                    </label>
                  ))}
                </div>
              </div>

              {/* Geo location */}
              <div style={{ gridColumn:'1/-1' }}>
                <div style={{ ...label, marginBottom:'8px' }}>Shop Geo Location (for attendance check)</div>
                <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'10px' }}>
                  <div>
                    <div style={{ fontSize:'11px', color:'#94a3b8', marginBottom:'3px' }}>Latitude</div>
                    <input type="number" step="any" value={form.geo_lat} onChange={e=>F('geo_lat',e.target.value)} placeholder="e.g. 6.9271" style={inp} />
                  </div>
                  <div>
                    <div style={{ fontSize:'11px', color:'#94a3b8', marginBottom:'3px' }}>Longitude</div>
                    <input type="number" step="any" value={form.geo_lng} onChange={e=>F('geo_lng',e.target.value)} placeholder="e.g. 79.8612" style={inp} />
                  </div>
                </div>
                <div style={{ fontSize:'11px', color:'#94a3b8', marginTop:'6px' }}>💡 Get coordinates from Google Maps — right-click on your shop location → "What's here?"</div>
              </div>
            </div>

            <div style={{ display:'flex', gap:'10px', marginTop:'20px', justifyContent:'flex-end' }}>
              <button onClick={() => { setShowStaffForm(false); setEditStaff(null) }} style={btn()}>Cancel</button>
              <button onClick={saveStaff} style={{ ...btn('#fff','#1e40af'), color:'white' }}>{editStaff ? 'Update Staff' : 'Create Staff'}</button>
            </div>
          </div>
        </div>
      )}

      {/* ── SALARY PAYMENT MODAL ── */}
      {showSalaryModal && (
        <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.5)', zIndex:1000, display:'flex', alignItems:'center', justifyContent:'center', padding:'20px' }}>
          <div style={{ background:'white', borderRadius:'16px', width:'100%', maxWidth:'420px', padding:'28px' }}>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:'20px' }}>
              <h3 style={{ margin:0, fontSize:'18px', fontWeight:'700', color:'#0f172a' }}>Pay Salary — {showSalaryModal.name}</h3>
              <button onClick={() => { setShowSalaryModal(null); setPayAmt(''); setPayNote(''); setPayBankId('') }} style={{ background:'#f1f5f9', border:'none', borderRadius:'8px', width:'32px', height:'32px', cursor:'pointer', fontSize:'16px' }}>✕</button>
            </div>
            <div style={{ background:'#f8fafc', borderRadius:'10px', padding:'12px 16px', marginBottom:'16px' }}>
              <div style={{ display:'flex', justifyContent:'space-between', fontSize:'13px', marginBottom:'4px' }}>
                <span style={{ color:'#64748b' }}>Monthly Salary</span><span style={{ fontWeight:'700' }}>{formatCurrency(showSalaryModal.monthly_salary||0)}</span>
              </div>
              <div style={{ display:'flex', justifyContent:'space-between', fontSize:'13px', marginBottom:'4px' }}>
                <span style={{ color:'#64748b' }}>Paid so far</span><span style={{ fontWeight:'700', color:'#059669' }}>{formatCurrency(showSalaryModal.salary_paid||0)}</span>
              </div>
              <div style={{ display:'flex', justifyContent:'space-between', fontSize:'14px', fontWeight:'700' }}>
                <span style={{ color:'#e11d48' }}>Balance Due</span><span style={{ color:'#e11d48' }}>{formatCurrency(Math.max(0,(showSalaryModal.monthly_salary||0)-(showSalaryModal.salary_paid||0)))}</span>
              </div>
            </div>
            <div style={{ display:'flex', flexDirection:'column', gap:'12px' }}>
              <div><div style={label}>Amount (LKR)</div><input type="number" value={payAmt} onChange={e=>setPayAmt(e.target.value)} placeholder="Enter amount" style={inp} autoFocus /></div>
              <div><div style={label}>Payment Method</div>
                <select value={payMethod} onChange={e=>{ setPayMethod(e.target.value); setPayBankId('') }} style={inp}>
                  <option value="cash">Cash</option>
                  <option value="bank_transfer">Bank Transfer</option>
                  <option value="cheque">Cheque</option>
                </select>
              </div>
              {payMethod === 'bank_transfer' && (
                <div><div style={label}>Bank Account</div>
                  <select value={payBankId} onChange={e=>setPayBankId(e.target.value)} style={inp}>
                    <option value="">Select account…</option>
                    {bankAccounts.map(b => <option key={b.id} value={b.id}>{b.name} — {formatCurrency(b.balance||0)}</option>)}
                  </select>
                </div>
              )}
              <div><div style={label}>Notes</div><input type="text" value={payNote} onChange={e=>setPayNote(e.target.value)} placeholder="Optional notes" style={inp} /></div>
            </div>
            <div style={{ display:'flex', gap:'10px', marginTop:'20px' }}>
              <button onClick={() => setShowSalaryModal(null)} style={{ ...btn(), flex:1 }}>Cancel</button>
              <button onClick={paySalary} style={{ ...btn('#fff','#059669'), color:'white', flex:1 }}>Record Payment</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
