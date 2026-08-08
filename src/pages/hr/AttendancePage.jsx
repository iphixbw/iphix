import { useState, useEffect, useRef } from 'react'
import { supabase } from '../../supabase'

// ─── Haversine distance in metres ───────────────────────────────────────────
function distanceM(lat1, lng1, lat2, lng2) {
  const R = 6371000
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLng = (lng2 - lng1) * Math.PI / 180
  const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180) * Math.cos(lat2*Math.PI/180) * Math.sin(dLng/2)**2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a))
}

function pad(n) { return String(n).padStart(2,'0') }
function timeStr(d) { return `${pad(d.getHours())}:${pad(d.getMinutes())}` }
function dateStr(d) { return d.toISOString().split('T')[0] }

export default function AttendancePage({ staffId }) {
  const [staff, setStaff] = useState(null)
  const [today, setToday] = useState(null)          // today's attendance record
  const [mode, setMode] = useState('main')           // main | manual | leave
  const [geoStatus, setGeoStatus] = useState('idle') // idle | checking | ok | fail | denied
  const [geoMsg, setGeoMsg] = useState('')
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [clock, setClock] = useState(new Date())
  const [autoEndTimer, setAutoEndTimer] = useState(null)

  // Manual request form
  const [manDate, setManDate] = useState(dateStr(new Date()))
  const [manStart, setManStart] = useState('')
  const [manEnd, setManEnd] = useState('')
  const [manReason, setManReason] = useState('')

  // Leave request form
  const [leaveType, setLeaveType] = useState('annual')
  const [leaveFrom, setLeaveFrom] = useState(dateStr(new Date()))
  const [leaveTo, setLeaveTo] = useState(dateStr(new Date()))
  const [leaveReason, setLeaveReason] = useState('')

  const [msg, setMsg] = useState(null) // { type: 'success'|'error', text: '' }

  // Clock tick
  useEffect(() => {
    const t = setInterval(() => setClock(new Date()), 1000)
    return () => clearInterval(t)
  }, [])

  // Load staff + today's record
  useEffect(() => {
    if (!staffId) return
    loadData()
  }, [staffId])

  async function loadData() {
    setLoading(true)
    const { data: s } = await supabase.from('hr_staff').select('*').eq('id', staffId).single()
    if (!s) { setLoading(false); return }
    setStaff(s)

    const today = dateStr(new Date())
    const { data: rec } = await supabase.from('hr_attendance').select('*').eq('staff_id', staffId).eq('date', today).maybeSingle()
    setToday(rec)

    // Schedule auto-end if shift started but not ended
    if (rec && rec.shift_start && !rec.shift_end && s.shift_end) {
      scheduleAutoEnd(rec, s)
    }
    setLoading(false)
  }

  function scheduleAutoEnd(rec, staffData) {
    const now = new Date()
    const [h, m] = staffData.shift_end.split(':').map(Number)
    const endTime = new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, m, 0)
    const msUntilEnd = endTime - now
    if (msUntilEnd > 0) {
      const t = setTimeout(async () => {
        await supabase.from('hr_attendance').update({ shift_end: endTime.toISOString(), auto_ended: true }).eq('id', rec.id)
        loadData()
      }, msUntilEnd)
      setAutoEndTimer(t)
    }
    return () => { if (autoEndTimer) clearTimeout(autoEndTimer) }
  }

  // Get geo position
  function getGeo() {
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) { reject(new Error('Geolocation not supported')); return }
      navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: true, timeout: 10000 })
    })
  }

  // Check within radius
  async function checkAndMark(action) {
    setGeoStatus('checking')
    setGeoMsg('Getting your location…')
    try {
      const pos = await getGeo()
      const { latitude, longitude } = pos.coords

      if (!staff.geo_lat || !staff.geo_lng) {
        // No geo set for this staff — allow without check
        await doMark(action, latitude, longitude)
        return
      }

      const dist = distanceM(latitude, longitude, parseFloat(staff.geo_lat), parseFloat(staff.geo_lng))
      const radius = staff.geo_radius_m || 25

      if (dist > radius) {
        setGeoStatus('fail')
        setGeoMsg(`You are ${Math.round(dist)}m from the shop. Must be within ${radius}m.`)
        return
      }

      setGeoStatus('ok')
      setGeoMsg(`✓ ${Math.round(dist)}m from shop`)
      await doMark(action, latitude, longitude)
    } catch (e) {
      setGeoStatus('denied')
      setGeoMsg(e.code === 1 ? 'Location access denied. Please allow location and try again.' : 'Could not get location. Try again.')
    }
  }

  async function doMark(action, lat, lng) {
    setSubmitting(true)
    const now = new Date()
    const todayStr = dateStr(now)

    if (action === 'start') {
      if (today) {
        setMsg({ type:'error', text:'You already started your shift today.' })
        setSubmitting(false)
        return
      }
      const { data, error } = await supabase.from('hr_attendance').insert({
        staff_id: staffId,
        date: todayStr,
        shift_start: now.toISOString(),
        start_lat: lat,
        start_lng: lng,
        status: 'present',
      }).select().single()
      if (error) { setMsg({ type:'error', text:'Failed to mark start. Try again.' }); setSubmitting(false); return }
      setToday(data)
      scheduleAutoEnd(data, staff)
      setMsg({ type:'success', text:`Shift started at ${timeStr(now)} ✓` })
    } else {
      if (!today || !today.shift_start) {
        setMsg({ type:'error', text:'No shift started today.' })
        setSubmitting(false)
        return
      }
      if (today.shift_end) {
        setMsg({ type:'error', text:'Shift already ended.' })
        setSubmitting(false)
        return
      }
      const { error } = await supabase.from('hr_attendance').update({
        shift_end: now.toISOString(),
        end_lat: lat,
        end_lng: lng,
      }).eq('id', today.id)
      if (error) { setMsg({ type:'error', text:'Failed to mark end. Try again.' }); setSubmitting(false); return }
      if (autoEndTimer) clearTimeout(autoEndTimer)
      setMsg({ type:'success', text:`Shift ended at ${timeStr(now)} ✓` })
      loadData()
    }
    setGeoStatus('idle')
    setSubmitting(false)
  }

  async function submitManualRequest() {
    if (!manStart || !manEnd || !manReason.trim()) { setMsg({ type:'error', text:'Please fill all fields.' }); return }
    setSubmitting(true)
    const { error } = await supabase.from('hr_attendance_requests').insert({
      staff_id: staffId,
      date: manDate,
      shift_start: manStart,
      shift_end: manEnd,
      reason: manReason,
    })
    if (error) { setMsg({ type:'error', text:'Submission failed.' }); setSubmitting(false); return }
    setMsg({ type:'success', text:'Manual request submitted. Admin will review.' })
    setMode('main')
    setSubmitting(false)
  }

  async function submitLeaveRequest() {
    if (!leaveFrom || !leaveTo || !leaveReason.trim()) { setMsg({ type:'error', text:'Please fill all fields.' }); return }
    const from = new Date(leaveFrom), to = new Date(leaveTo)
    if (to < from) { setMsg({ type:'error', text:'End date must be after start date.' }); return }
    const days = Math.round((to - from) / 86400000) + 1
    setSubmitting(true)
    const { error } = await supabase.from('hr_leave_requests').insert({
      staff_id: staffId,
      leave_type: leaveType,
      date_from: leaveFrom,
      date_to: leaveTo,
      days,
      reason: leaveReason,
    })
    if (error) { setMsg({ type:'error', text:'Submission failed.' }); setSubmitting(false); return }
    setMsg({ type:'success', text:`Leave request for ${days} day(s) submitted. Awaiting admin approval.` })
    setMode('main')
    setSubmitting(false)
  }

  // ── Styles ───────────────────────────────────────────────────────────────
  const page = { minHeight:'100vh', background:'linear-gradient(135deg,#0b1220 0%,#1e3a8a 100%)', display:'flex', alignItems:'center', justifyContent:'center', fontFamily:'system-ui,sans-serif', padding:'20px' }
  const card = { background:'white', borderRadius:'20px', padding:'32px 28px', width:'100%', maxWidth:'400px', boxShadow:'0 20px 60px rgba(0,0,0,0.4)' }
  const inp = { padding:'10px 14px', border:'1.5px solid #e2e8f0', borderRadius:'8px', fontSize:'14px', outline:'none', width:'100%', boxSizing:'border-box' }
  const bigBtn = (bg, disabled) => ({ width:'100%', padding:'18px', background: disabled?'#e2e8f0':bg, color: disabled?'#94a3b8':'white', border:'none', borderRadius:'12px', cursor: disabled?'not-allowed':'pointer', fontSize:'16px', fontWeight:'700', letterSpacing:'0.02em', boxShadow: disabled?'none':'0 4px 14px rgba(0,0,0,0.2)', transition:'opacity 0.2s' })
  const smBtn = (col='#2563eb', bg='#eef2ff') => ({ padding:'8px 16px', background:bg, color:col, border:`1.5px solid ${col}33`, borderRadius:'8px', cursor:'pointer', fontWeight:'600', fontSize:'13px' })

  if (!staffId) return <div style={page}><div style={{ color:'white', fontSize:'18px' }}>Invalid attendance link.</div></div>
  if (loading) return <div style={page}><div style={{ color:'white', fontSize:'18px' }}>Loading…</div></div>
  if (!staff) return <div style={page}><div style={{ color:'white', fontSize:'18px' }}>Staff member not found.</div></div>

  const shiftStarted = today?.shift_start && !today?.shift_end
  const shiftEnded = today?.shift_start && today?.shift_end

  return (
    <div style={page}>
      <div style={card}>
        {/* Header */}
        <div style={{ textAlign:'center', marginBottom:'24px' }}>
          <div style={{ width:'56px', height:'56px', borderRadius:'50%', background:'linear-gradient(135deg,#2563eb,#1d4ed8)', display:'flex', alignItems:'center', justifyContent:'center', color:'white', fontWeight:'700', fontSize:'22px', margin:'0 auto 12px' }}>{staff.name[0]}</div>
          <div style={{ fontSize:'20px', fontWeight:'700', color:'#0f172a' }}>{staff.name}</div>
          <div style={{ fontSize:'13px', color:'#94a3b8', marginTop:'2px', textTransform:'capitalize' }}>{staff.role}</div>
          <div style={{ fontSize:'22px', fontWeight:'800', color:'#1e40af', marginTop:'8px', fontVariantNumeric:'tabular-nums' }}>
            {pad(clock.getHours())}:{pad(clock.getMinutes())}:{pad(clock.getSeconds())}
          </div>
          <div style={{ fontSize:'12px', color:'#94a3b8' }}>
            {clock.toLocaleDateString('en-GB',{weekday:'long',day:'2-digit',month:'long',year:'numeric'})}
          </div>
        </div>

        {/* Status bar */}
        {today && (
          <div style={{ background: shiftEnded?'#f0fdf4':shiftStarted?'#fef3c7':'#f8fafc', border:`1.5px solid ${shiftEnded?'#bbf7d0':shiftStarted?'#fde68a':'#e2e8f0'}`, borderRadius:'10px', padding:'10px 14px', marginBottom:'16px', fontSize:'13px' }}>
            {shiftStarted && <div style={{ color:'#92400e', fontWeight:'700' }}>⏱ Shift in progress — started at {new Date(today.shift_start).toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'})}</div>}
            {shiftEnded && <div style={{ color:'#166534', fontWeight:'700' }}>✓ Shift complete — {new Date(today.shift_start).toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'})} → {new Date(today.shift_end).toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'})}{today.auto_ended && ' (auto-ended)'}</div>}
          </div>
        )}

        {/* Geo status */}
        {geoStatus !== 'idle' && (
          <div style={{ marginBottom:'12px', padding:'10px 14px', borderRadius:'10px', fontSize:'13px', fontWeight:'600',
            background: geoStatus==='ok'?'#f0fdf4':geoStatus==='checking'?'#f8fafc':'#fff1f2',
            color: geoStatus==='ok'?'#166534':geoStatus==='checking'?'#64748b':'#e11d48',
            border: `1.5px solid ${geoStatus==='ok'?'#bbf7d0':geoStatus==='checking'?'#e2e8f0':'#fecaca'}` }}>
            {geoStatus === 'checking' && '📡 '}{geoMsg}
          </div>
        )}

        {/* Message */}
        {msg && (
          <div style={{ marginBottom:'12px', padding:'10px 14px', borderRadius:'10px', fontSize:'13px', fontWeight:'600',
            background: msg.type==='success'?'#f0fdf4':'#fff1f2',
            color: msg.type==='success'?'#166534':'#e11d48',
            border: `1.5px solid ${msg.type==='success'?'#bbf7d0':'#fecaca'}` }} onClick={() => setMsg(null)}>
            {msg.text}
          </div>
        )}

        {/* ── Main mode ── */}
        {mode === 'main' && (
          <div style={{ display:'flex', flexDirection:'column', gap:'12px' }}>
            <button onClick={() => checkAndMark('start')}
              disabled={submitting || !!today || geoStatus==='checking'}
              style={bigBtn('linear-gradient(135deg,#059669,#047857)', submitting || !!today || geoStatus==='checking')}>
              {submitting && geoStatus !== 'fail' ? '⏳ Marking…' : shiftStarted || shiftEnded ? '✓ Shift Started' : '▶ Start Shift'}
            </button>
            <button onClick={() => checkAndMark('end')}
              disabled={submitting || !shiftStarted || geoStatus==='checking'}
              style={bigBtn('linear-gradient(135deg,#e11d48,#be123c)', submitting || !shiftStarted || geoStatus==='checking')}>
              {submitting && geoStatus !== 'fail' ? '⏳ Marking…' : shiftEnded ? '✓ Shift Ended' : '⏹ End Shift'}
            </button>
            <div style={{ display:'flex', gap:'8px', marginTop:'4px' }}>
              <button onClick={() => { setMode('manual'); setMsg(null) }} style={{ ...smBtn('#f59e0b','#fffbeb'), flex:1 }}>⚠ Forgot to mark?</button>
              <button onClick={() => { setMode('leave'); setMsg(null) }} style={{ ...smBtn('#2563eb'), flex:1 }}>🌴 Request Leave</button>
            </div>
            <div style={{ textAlign:'center', marginTop:'4px', fontSize:'11px', color:'#cbd5e1' }}>
              Shift: {staff.shift_start} – {staff.shift_end} &nbsp;·&nbsp; {(staff.shift_days||[]).join(', ')}
            </div>
          </div>
        )}

        {/* ── Manual request mode ── */}
        {mode === 'manual' && (
          <div>
            <div style={{ fontSize:'16px', fontWeight:'700', color:'#0f172a', marginBottom:'16px' }}>Manual Attendance Request</div>
            <div style={{ display:'flex', flexDirection:'column', gap:'12px' }}>
              <div>
                <div style={{ fontSize:'11px', fontWeight:'700', color:'#94a3b8', marginBottom:'4px' }}>DATE</div>
                <input type="date" value={manDate} onChange={e=>setManDate(e.target.value)} style={inp} />
              </div>
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'10px' }}>
                <div>
                  <div style={{ fontSize:'11px', fontWeight:'700', color:'#94a3b8', marginBottom:'4px' }}>START TIME</div>
                  <input type="time" value={manStart} onChange={e=>setManStart(e.target.value)} style={inp} />
                </div>
                <div>
                  <div style={{ fontSize:'11px', fontWeight:'700', color:'#94a3b8', marginBottom:'4px' }}>END TIME</div>
                  <input type="time" value={manEnd} onChange={e=>setManEnd(e.target.value)} style={inp} />
                </div>
              </div>
              <div>
                <div style={{ fontSize:'11px', fontWeight:'700', color:'#94a3b8', marginBottom:'4px' }}>REASON</div>
                <textarea value={manReason} onChange={e=>setManReason(e.target.value)} rows={3} placeholder="Explain why you couldn't mark attendance…" style={{ ...inp, resize:'vertical' }} />
              </div>
              <div style={{ display:'flex', gap:'8px' }}>
                <button onClick={() => { setMode('main'); setMsg(null) }} style={{ ...smBtn(), flex:1 }}>← Back</button>
                <button onClick={submitManualRequest} disabled={submitting} style={{ padding:'10px', background:'#f59e0b', color:'white', border:'none', borderRadius:'8px', cursor:'pointer', fontWeight:'700', fontSize:'14px', flex:2 }}>
                  {submitting ? 'Submitting…' : 'Submit Request'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── Leave request mode ── */}
        {mode === 'leave' && (
          <div>
            <div style={{ fontSize:'16px', fontWeight:'700', color:'#0f172a', marginBottom:'16px' }}>Request Leave</div>
            <div style={{ background:'#f8fafc', borderRadius:'10px', padding:'10px 14px', marginBottom:'14px', fontSize:'13px' }}>
              <div style={{ display:'flex', justifyContent:'space-between' }}>
                <span style={{ color:'#64748b' }}>Annual Leave Balance</span>
                <span style={{ fontWeight:'700', color:'#1e40af' }}>{staff.annual_leave_balance} days</span>
              </div>
              <div style={{ display:'flex', justifyContent:'space-between', marginTop:'4px' }}>
                <span style={{ color:'#64748b' }}>Casual Leave Balance</span>
                <span style={{ fontWeight:'700', color:'#059669' }}>{staff.casual_leave_balance} days</span>
              </div>
            </div>
            <div style={{ display:'flex', flexDirection:'column', gap:'12px' }}>
              <div>
                <div style={{ fontSize:'11px', fontWeight:'700', color:'#94a3b8', marginBottom:'4px' }}>LEAVE TYPE</div>
                <select value={leaveType} onChange={e=>setLeaveType(e.target.value)} style={inp}>
                  <option value="annual">Annual Leave</option>
                  <option value="casual">Casual Leave</option>
                  <option value="no_pay">No Pay Leave</option>
                </select>
              </div>
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'10px' }}>
                <div>
                  <div style={{ fontSize:'11px', fontWeight:'700', color:'#94a3b8', marginBottom:'4px' }}>FROM</div>
                  <input type="date" value={leaveFrom} onChange={e=>setLeaveFrom(e.target.value)} style={inp} />
                </div>
                <div>
                  <div style={{ fontSize:'11px', fontWeight:'700', color:'#94a3b8', marginBottom:'4px' }}>TO</div>
                  <input type="date" value={leaveTo} onChange={e=>setLeaveTo(e.target.value)} style={inp} />
                </div>
              </div>
              <div>
                <div style={{ fontSize:'11px', fontWeight:'700', color:'#94a3b8', marginBottom:'4px' }}>REASON</div>
                <textarea value={leaveReason} onChange={e=>setLeaveReason(e.target.value)} rows={3} placeholder="Reason for leave…" style={{ ...inp, resize:'vertical' }} />
              </div>
              <div style={{ display:'flex', gap:'8px' }}>
                <button onClick={() => { setMode('main'); setMsg(null) }} style={{ ...smBtn(), flex:1 }}>← Back</button>
                <button onClick={submitLeaveRequest} disabled={submitting} style={{ padding:'10px', background:'linear-gradient(135deg,#2563eb,#1d4ed8)', color:'white', border:'none', borderRadius:'8px', cursor:'pointer', fontWeight:'700', fontSize:'14px', flex:2 }}>
                  {submitting ? 'Submitting…' : 'Submit Request'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
