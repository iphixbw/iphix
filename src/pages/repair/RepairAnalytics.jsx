import { useState, useEffect, useMemo } from 'react'
import { supabase } from '../../supabase'
import { formatLKR, statusMeta, JOB_STATUSES, PRIORITIES } from '../../lib/repairConstants'
import {
  AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell, LineChart, Line,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts'

const RANGES = [
  { id: 7, label: '7 Days' },
  { id: 30, label: '30 Days' },
  { id: 90, label: '90 Days' },
  { id: 365, label: '1 Year' },
  { id: 0, label: 'All Time' },
]

const PALETTE = ['#d4881f', '#2563eb', '#059669', '#e11d48', '#7c3aed', '#0891b2', '#ea580c', '#94a3b8']

export default function RepairAnalytics({ shop }) {
  const [range, setRange] = useState(30)
  const [loading, setLoading] = useState(true)
  const [jobs, setJobs] = useState([])
  const [sales, setSales] = useState([])
  const [expenses, setExpenses] = useState([])
  const [jobParts, setJobParts] = useState([])

  useEffect(() => { fetchData() }, [shop?.id, range])

  async function fetchData() {
    setLoading(true)
    const shopFilter = (q) => shop?.id ? q.eq('shop_id', shop.id) : q
    let cutoff = null
    if (range > 0) { cutoff = new Date(); cutoff.setDate(cutoff.getDate() - range) }

    let jq = shopFilter(supabase.from('repair_jobs').select('*'))
    let sq = shopFilter(supabase.from('repair_sales').select('*'))
    let eq = shopFilter(supabase.from('repair_expenses').select('*'))
    if (cutoff) {
      jq = jq.gte('created_at', cutoff.toISOString())
      sq = sq.gte('created_at', cutoff.toISOString())
      eq = eq.gte('created_at', cutoff.toISOString())
    }

    const [{ data: j }, { data: s }, { data: e }, { data: jp }] = await Promise.all([
      jq.order('created_at', { ascending: true }),
      sq.order('created_at', { ascending: true }),
      eq,
      supabase.from('repair_job_parts').select('quantity, line_total, unit_cost, repair_parts(name)'),
    ])
    setJobs(j || [])
    setSales(s || [])
    setExpenses(e || [])
    setJobParts(jp || [])
    setLoading(false)
  }

  // ── KPIs ──────────────────────────────────────────────
  const kpis = useMemo(() => {
    const collected = jobs.filter(j => j.status === 'collected')
    const revenue = collected.reduce((s, j) => s + (j.grand_total || 0), 0) + sales.reduce((s, sa) => s + (sa.total || 0), 0)
    const cost = collected.reduce((s, j) => s + (j.cost_total || 0), 0)
    const expTotal = expenses.reduce((s, e) => s + e.amount, 0)
    const profit = revenue - cost - expTotal
    const avgTicket = collected.length > 0 ? revenue / collected.length : 0

    // Average turnaround: created_at -> updated_at for collected jobs
    const turnarounds = collected
      .filter(j => j.updated_at)
      .map(j => (new Date(j.updated_at) - new Date(j.created_at)) / (1000 * 60 * 60 * 24))
      .filter(d => d >= 0)
    const avgTurnaround = turnarounds.length > 0 ? turnarounds.reduce((a, b) => a + b, 0) / turnarounds.length : 0

    return {
      revenue, profit, cost: cost + expTotal, avgTicket, avgTurnaround,
      jobCount: jobs.length, collectedCount: collected.length,
      marginPct: revenue > 0 ? (profit / revenue) * 100 : 0,
    }
  }, [jobs, sales, expenses])

  // ── Revenue & profit trend by day ──────────────────────
  const trendData = useMemo(() => {
    const byDay = {}
    jobs.filter(j => j.status === 'collected').forEach(j => {
      const day = new Date(j.updated_at || j.created_at).toISOString().slice(0, 10)
      if (!byDay[day]) byDay[day] = { day, revenue: 0, cost: 0, jobs: 0 }
      byDay[day].revenue += j.grand_total || 0
      byDay[day].cost += j.cost_total || 0
      byDay[day].jobs += 1
    })
    sales.forEach(s => {
      const day = new Date(s.created_at).toISOString().slice(0, 10)
      if (!byDay[day]) byDay[day] = { day, revenue: 0, cost: 0, jobs: 0 }
      byDay[day].revenue += s.total || 0
    })
    return Object.values(byDay)
      .sort((a, b) => new Date(a.day) - new Date(b.day))
      .map(d => ({ ...d, profit: d.revenue - d.cost, label: new Date(d.day).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }) }))
  }, [jobs, sales])

  // ── Status breakdown ────────────────────────────────────
  const statusData = useMemo(() => {
    return JOB_STATUSES.map(s => ({
      name: s.label, value: jobs.filter(j => j.status === s.id).length, color: s.color,
    })).filter(s => s.value > 0)
  }, [jobs])

  // ── Priority breakdown ──────────────────────────────────
  const priorityData = useMemo(() => {
    return PRIORITIES.map(p => ({
      name: p.label, value: jobs.filter(j => j.priority === p.id).length, color: p.color,
    }))
  }, [jobs])

  // ── Top brands/models ────────────────────────────────────
  const brandData = useMemo(() => {
    const counts = {}
    jobs.forEach(j => { const b = j.phone_brand || 'Unknown'; counts[b] = (counts[b] || 0) + 1 })
    return Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([name, value]) => ({ name, value }))
  }, [jobs])

  // ── Common faults ────────────────────────────────────────
  const faultData = useMemo(() => {
    const counts = {}
    jobs.forEach(j => { const f = (j.reported_problem || '').trim(); if (f) counts[f] = (counts[f] || 0) + 1 })
    return Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([name, value]) => ({ name: name.length > 22 ? name.slice(0, 22) + '…' : name, value }))
  }, [jobs])

  // ── Technician performance ────────────────────────────────
  const techData = useMemo(() => {
    const byTech = {}
    jobs.filter(j => j.status === 'collected').forEach(j => {
      const t = j.technician || 'Unassigned'
      if (!byTech[t]) byTech[t] = { name: t, revenue: 0, jobs: 0, profit: 0 }
      byTech[t].revenue += j.grand_total || 0
      byTech[t].profit += j.net_profit || 0
      byTech[t].jobs += 1
    })
    return Object.values(byTech).sort((a, b) => b.revenue - a.revenue).slice(0, 8)
  }, [jobs])

  // ── Top parts used ────────────────────────────────────────
  const partsData = useMemo(() => {
    const byPart = {}
    jobParts.forEach(p => {
      const name = p.repair_parts?.name || 'Unknown'
      if (!byPart[name]) byPart[name] = { name, qty: 0, revenue: 0 }
      byPart[name].qty += p.quantity || 0
      byPart[name].revenue += p.line_total || 0
    })
    return Object.values(byPart).sort((a, b) => b.qty - a.qty).slice(0, 8)
  }, [jobParts])

  // ── Payment method mix (jobs + sales) ────────────────────
  const paymentMixData = useMemo(() => {
    const counts = {}
    sales.forEach(s => { const m = s.payment_method || 'cash'; counts[m] = (counts[m] || 0) + (s.total || 0) })
    return Object.entries(counts).map(([name, value]) => ({ name: name.replace('_', ' '), value }))
  }, [sales])

  const card = { background: 'white', borderRadius: '16px', padding: '20px', border: '1px solid #f3ede4', boxShadow: '0 1px 3px rgba(28,25,23,0.05)' }
  const cardTitle = { fontSize: '14px', fontWeight: '800', color: '#1c1917', margin: '0 0 16px' }

  const tooltipStyle = { background: '#1c1917', border: 'none', borderRadius: '10px', color: 'white', fontSize: '12px', padding: '8px 12px' }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '20px', flexWrap: 'wrap', gap: '12px' }}>
        <div>
          <h1 style={{ fontSize: '22px', fontWeight: '800', color: '#1c1917', margin: '0 0 4px' }}>📊 Repair Analytics</h1>
          <p style={{ color: '#8a7a63', fontSize: '14px', margin: 0 }}>Interactive performance overview for the Repair Division</p>
        </div>
        <div style={{ display: 'flex', gap: '6px' }}>
          {RANGES.map(r => (
            <button key={r.id} onClick={() => setRange(r.id)}
              style={{ padding: '8px 16px', borderRadius: '9px', border: 'none', background: range === r.id ? '#1c1917' : '#f5f1ea', color: range === r.id ? '#f0b23d' : '#78716c', fontWeight: '700', fontSize: '12.5px', cursor: 'pointer' }}>
              {r.label}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div style={{ padding: '80px', textAlign: 'center', color: '#a89478' }}>Loading analytics...</div>
      ) : jobs.length === 0 && sales.length === 0 ? (
        <div style={{ background: 'white', borderRadius: '16px', padding: '80px', textAlign: 'center', color: '#a89478', border: '1px solid #f3ede4' }}>
          No data in this period yet.
        </div>
      ) : (
        <>
          {/* KPI row */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: '14px', marginBottom: '20px' }}>
            {[
              { label: 'Revenue', value: formatLKR(kpis.revenue), color: '#166534', bg: '#f0fdf4', icon: '💰' },
              { label: 'Profit', value: formatLKR(kpis.profit), color: kpis.profit >= 0 ? '#166534' : '#e11d48', bg: kpis.profit >= 0 ? '#f0fdf4' : '#fff1f2', icon: '📈' },
              { label: 'Margin', value: kpis.marginPct.toFixed(1) + '%', color: '#1e40af', bg: '#eff6ff', icon: '🎯' },
              { label: 'Jobs Completed', value: kpis.collectedCount, color: '#d4881f', bg: '#fef3e2', icon: '✅' },
              { label: 'Avg Ticket', value: formatLKR(kpis.avgTicket), color: '#7c3aed', bg: '#f5f3ff', icon: '🧾' },
              { label: 'Avg Turnaround', value: kpis.avgTurnaround.toFixed(1) + ' days', color: '#0891b2', bg: '#ecfeff', icon: '⏱' },
            ].map(k => (
              <div key={k.label} style={{ ...card, padding: '16px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                  <div style={{ fontSize: '10.5px', fontWeight: '700', color: '#8a7a63', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{k.label}</div>
                  <div style={{ width: '26px', height: '26px', borderRadius: '8px', background: k.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '13px' }}>{k.icon}</div>
                </div>
                <div style={{ fontSize: '19px', fontWeight: '800', color: k.color }}>{k.value}</div>
              </div>
            ))}
          </div>

          {/* Revenue trend — full width */}
          <div style={{ ...card, marginBottom: '16px' }}>
            <h3 style={cardTitle}>Revenue & Profit Trend</h3>
            <ResponsiveContainer width="100%" height={260}>
              <AreaChart data={trendData}>
                <defs>
                  <linearGradient id="revGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#d4881f" stopOpacity={0.35} />
                    <stop offset="100%" stopColor="#d4881f" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="profitGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#166534" stopOpacity={0.3} />
                    <stop offset="100%" stopColor="#166534" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#f3ede4" vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#a89478' }} axisLine={{ stroke: '#f3ede4' }} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fill: '#a89478' }} axisLine={false} tickLine={false} tickFormatter={v => v >= 1000 ? `${(v / 1000).toFixed(0)}k` : v} />
                <Tooltip contentStyle={tooltipStyle} formatter={(v) => formatLKR(v)} />
                <Legend wrapperStyle={{ fontSize: '12px' }} />
                <Area type="monotone" dataKey="revenue" name="Revenue" stroke="#d4881f" strokeWidth={2.5} fill="url(#revGrad)" />
                <Area type="monotone" dataKey="profit" name="Profit" stroke="#166534" strokeWidth={2.5} fill="url(#profitGrad)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>

          {/* Status + Priority row */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '16px' }}>
            <div style={card}>
              <h3 style={cardTitle}>Job Status Breakdown</h3>
              <ResponsiveContainer width="100%" height={240}>
                <PieChart>
                  <Pie data={statusData} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={55} outerRadius={85} paddingAngle={2}>
                    {statusData.map((entry, i) => <Cell key={i} fill={entry.color} />)}
                  </Pie>
                  <Tooltip contentStyle={tooltipStyle} />
                  <Legend wrapperStyle={{ fontSize: '11px' }} layout="vertical" verticalAlign="middle" align="right" />
                </PieChart>
              </ResponsiveContainer>
            </div>
            <div style={card}>
              <h3 style={cardTitle}>Priority Distribution</h3>
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={priorityData} layout="vertical" margin={{ left: 10 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f3ede4" horizontal={false} />
                  <XAxis type="number" tick={{ fontSize: 11, fill: '#a89478' }} axisLine={false} tickLine={false} allowDecimals={false} />
                  <YAxis type="category" dataKey="name" tick={{ fontSize: 12, fill: '#57534e' }} axisLine={false} tickLine={false} width={70} />
                  <Tooltip contentStyle={tooltipStyle} />
                  <Bar dataKey="value" radius={[0, 6, 6, 0]}>
                    {priorityData.map((entry, i) => <Cell key={i} fill={entry.color} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Brands + Faults row */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '16px' }}>
            <div style={card}>
              <h3 style={cardTitle}>Most Repaired Brands</h3>
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={brandData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f3ede4" vertical={false} />
                  <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#a89478' }} axisLine={{ stroke: '#f3ede4' }} tickLine={false} />
                  <YAxis tick={{ fontSize: 11, fill: '#a89478' }} axisLine={false} tickLine={false} allowDecimals={false} />
                  <Tooltip contentStyle={tooltipStyle} />
                  <Bar dataKey="value" name="Jobs" radius={[6, 6, 0, 0]}>
                    {brandData.map((_, i) => <Cell key={i} fill={PALETTE[i % PALETTE.length]} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div style={card}>
              <h3 style={cardTitle}>Most Common Faults</h3>
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={faultData} layout="vertical" margin={{ left: 10 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f3ede4" horizontal={false} />
                  <XAxis type="number" tick={{ fontSize: 11, fill: '#a89478' }} axisLine={false} tickLine={false} allowDecimals={false} />
                  <YAxis type="category" dataKey="name" tick={{ fontSize: 11, fill: '#57534e' }} axisLine={false} tickLine={false} width={130} />
                  <Tooltip contentStyle={tooltipStyle} />
                  <Bar dataKey="value" name="Occurrences" fill="#e11d48" radius={[0, 6, 6, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Technician + Parts row */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px', marginBottom: '16px' }}>
            <div style={card}>
              <h3 style={cardTitle}>Technician Performance</h3>
              {techData.length === 0 ? <div style={{ fontSize: '12.5px', color: '#a89478', padding: '20px 0', textAlign: 'center' }}>No completed jobs yet.</div> : (
                <ResponsiveContainer width="100%" height={240}>
                  <BarChart data={techData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f3ede4" vertical={false} />
                    <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#a89478' }} axisLine={{ stroke: '#f3ede4' }} tickLine={false} />
                    <YAxis tick={{ fontSize: 11, fill: '#a89478' }} axisLine={false} tickLine={false} tickFormatter={v => v >= 1000 ? `${(v / 1000).toFixed(0)}k` : v} />
                    <Tooltip contentStyle={tooltipStyle} formatter={(v) => formatLKR(v)} />
                    <Legend wrapperStyle={{ fontSize: '12px' }} />
                    <Bar dataKey="revenue" name="Revenue" fill="#2563eb" radius={[6, 6, 0, 0]} />
                    <Bar dataKey="profit" name="Profit" fill="#059669" radius={[6, 6, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
            <div style={card}>
              <h3 style={cardTitle}>Top Used Parts</h3>
              {partsData.length === 0 ? <div style={{ fontSize: '12.5px', color: '#a89478', padding: '20px 0', textAlign: 'center' }}>No parts usage yet.</div> : (
                <ResponsiveContainer width="100%" height={240}>
                  <BarChart data={partsData} layout="vertical" margin={{ left: 10 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f3ede4" horizontal={false} />
                    <XAxis type="number" tick={{ fontSize: 11, fill: '#a89478' }} axisLine={false} tickLine={false} allowDecimals={false} />
                    <YAxis type="category" dataKey="name" tick={{ fontSize: 11, fill: '#57534e' }} axisLine={false} tickLine={false} width={100} />
                    <Tooltip contentStyle={tooltipStyle} />
                    <Bar dataKey="qty" name="Quantity Used" fill="#7c3aed" radius={[0, 6, 6, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>

          {/* Payment mix */}
          {paymentMixData.length > 0 && (
            <div style={card}>
              <h3 style={cardTitle}>Parts Sales — Payment Mix</h3>
              <ResponsiveContainer width="100%" height={220}>
                <PieChart>
                  <Pie data={paymentMixData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80} label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`} labelLine={false}>
                    {paymentMixData.map((_, i) => <Cell key={i} fill={PALETTE[i % PALETTE.length]} />)}
                  </Pie>
                  <Tooltip contentStyle={tooltipStyle} formatter={(v) => formatLKR(v)} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          )}
        </>
      )}
    </div>
  )
}
