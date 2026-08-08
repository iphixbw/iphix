import { useState, useEffect } from 'react'
import { supabase } from '../../supabase'
import { formatLKR, statusMeta, timeAgo, isCollectedWithDue } from '../../lib/repairConstants'

export default function RepairDashboard({ shop, onOpenJob, navigateTo }) {
  const [loading, setLoading] = useState(true)
  const [stats, setStats] = useState(null)
  const [recentJobs, setRecentJobs] = useState([])
  const [commonRepairs, setCommonRepairs] = useState([])
  const [topParts, setTopParts] = useState([])

  useEffect(() => { fetchDashboard() }, [shop?.id])

  async function fetchDashboard() {
    setLoading(true)
    const shopFilter = shop?.id ? (q) => q.eq('shop_id', shop.id) : (q) => q

    const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0)
    const monthStart = new Date(); monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0)

    const [{ data: jobs }, { data: parts }, { data: expenses }] = await Promise.all([
      shopFilter(supabase.from('repair_jobs').select('*, repair_customers(name, mobile)')).order('created_at', { ascending: false }),
      shopFilter(supabase.from('repair_parts').select('*')),
      shopFilter(supabase.from('repair_expenses').select('amount, created_at')),
    ])

    const allJobs = jobs || []
    const todayJobs = allJobs.filter(j => new Date(j.created_at) >= todayStart)
    const pending = allJobs.filter(j => !['collected', 'cancelled', 'returned_unrepaired'].includes(j.status))
    const completed = allJobs.filter(j => j.status === 'collected')
    const waitingParts = allJobs.filter(j => j.status === 'waiting_parts')
    const ready = allJobs.filter(j => j.status === 'ready')
    const inProgress = allJobs.filter(j => j.status === 'in_progress')

    const monthJobs = allJobs.filter(j => new Date(j.created_at) >= monthStart && j.status === 'collected')
    const revenue = monthJobs.reduce((s, j) => s + (j.grand_total || 0), 0)
    const cost = monthJobs.reduce((s, j) => s + (j.cost_total || 0), 0)
    const monthExpenses = (expenses || []).filter(e => new Date(e.created_at) >= monthStart).reduce((s, e) => s + e.amount, 0)
    const profit = revenue - cost - monthExpenses

    // FIFO inventory value — sum remaining batch quantity × cost across all parts in scope
    const partIds = (parts || []).map(p => p.id)
    let inventoryValue = 0
    if (partIds.length > 0) {
      const { data: batches } = await supabase.from('repair_part_batches').select('part_id, quantity_remaining, unit_cost').in('part_id', partIds)
      inventoryValue = (batches || []).reduce((s, b) => s + (b.quantity_remaining || 0) * (b.unit_cost || 0), 0)
    }
    const lowStock = (parts || []).filter(p => (p.current_stock || 0) <= (p.min_stock || 0))

    // Most common repairs (by reported_problem text)
    const problemCounts = {}
    allJobs.forEach(j => {
      const key = (j.reported_problem || 'Other').trim()
      if (key) problemCounts[key] = (problemCounts[key] || 0) + 1
    })
    const topProblems = Object.entries(problemCounts).sort((a, b) => b[1] - a[1]).slice(0, 5)

    // Top selling parts — from job_parts join
    const { data: jobParts } = await supabase
      .from('repair_job_parts')
      .select('quantity, part_id, repair_parts(name)')
    const partCounts = {}
    ;(jobParts || []).forEach(jp => {
      const name = jp.repair_parts?.name || 'Unknown'
      partCounts[name] = (partCounts[name] || 0) + (jp.quantity || 0)
    })
    const topPartsList = Object.entries(partCounts).sort((a, b) => b[1] - a[1]).slice(0, 5)

    setStats({
      todayCount: todayJobs.length,
      pendingCount: pending.length,
      completedCount: completed.length,
      waitingPartsCount: waitingParts.length,
      readyCount: ready.length,
      inProgressCount: inProgress.length,
      revenue, cost: cost + monthExpenses, profit,
      inventoryValue, lowStockCount: lowStock.length,
    })
    setRecentJobs(allJobs.slice(0, 8))
    setCommonRepairs(topProblems)
    setTopParts(topPartsList)
    setLoading(false)
  }

  if (loading) return <div style={{ padding: '60px', textAlign: 'center', color: '#a89478' }}>Loading repair dashboard...</div>

  const statCards = [
    { label: "Today's Jobs", value: stats.todayCount, icon: '📅', color: '#d4881f', bg: '#fef3e2', page: 'jobs' },
    { label: 'Pending Repairs', value: stats.pendingCount, icon: '⏳', color: '#2563eb', bg: '#eff6ff', page: 'jobs' },
    { label: 'Waiting for Parts', value: stats.waitingPartsCount, icon: '📦', color: '#ea580c', bg: '#fff7ed', page: 'jobs' },
    { label: 'Ready for Collection', value: stats.readyCount, icon: '✅', color: '#059669', bg: '#f0fdf4', page: 'jobs' },
    { label: 'Completed (Collected)', value: stats.completedCount, icon: '🎉', color: '#166534', bg: '#dcfce7', page: 'jobs' },
    { label: 'In Progress', value: stats.inProgressCount, icon: '🔧', color: '#7c3aed', bg: '#f5f3ff', page: 'jobs' },
  ]

  return (
    <div>
      {/* Hero header */}
      <div style={{ marginBottom: '28px', padding: '28px 32px', borderRadius: '20px', background: 'linear-gradient(120deg, #1c1917 0%, #3d2c1a 55%, #6b4a1f 100%)', position: 'relative', overflow: 'hidden' }}>
        <div style={{ position: 'absolute', top: '-80px', right: '-60px', width: '220px', height: '220px', borderRadius: '50%', background: 'radial-gradient(circle, rgba(240,178,61,0.35), transparent 70%)' }} />
        <h1 style={{ fontSize: '26px', fontWeight: '800', color: 'white', margin: '0 0 4px', letterSpacing: '-0.01em', position: 'relative' }}>🔧 Repair Division</h1>
        <p style={{ color: '#d6c7b3', fontSize: '14px', margin: 0, position: 'relative' }}>
          {shop ? shop.name : 'All shops'} · Live job & inventory overview
        </p>
      </div>

      {/* Stat grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '14px', marginBottom: '24px' }}>
        {statCards.map(s => (
          <div key={s.label} onClick={() => navigateTo(s.page)}
            style={{ background: 'white', borderRadius: '16px', padding: '18px', boxShadow: '0 1px 3px rgba(28,25,23,0.06), 0 1px 2px rgba(28,25,23,0.04)', border: '1px solid #f3ede4', cursor: 'pointer', transition: 'transform 0.15s, box-shadow 0.15s' }}
            onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.boxShadow = '0 8px 20px rgba(28,25,23,0.08)' }}
            onMouseLeave={e => { e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.boxShadow = '0 1px 3px rgba(28,25,23,0.06), 0 1px 2px rgba(28,25,23,0.04)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
              <div style={{ color: '#8a7a63', fontSize: '11px', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{s.label}</div>
              <div style={{ width: '30px', height: '30px', borderRadius: '9px', background: s.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '14px' }}>{s.icon}</div>
            </div>
            <div style={{ fontSize: '24px', fontWeight: '800', color: s.color }}>{s.value}</div>
          </div>
        ))}
      </div>

      {/* Financial row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '14px', marginBottom: '24px' }}>
        {[
          { label: 'This Month Revenue', value: formatLKR(stats.revenue), color: '#166534', bg: '#f0fdf4' },
          { label: 'This Month Costs & Expenses', value: formatLKR(stats.cost), color: '#e11d48', bg: '#fff1f2' },
          { label: 'This Month Profit', value: formatLKR(stats.profit), color: stats.profit >= 0 ? '#166534' : '#e11d48', bg: stats.profit >= 0 ? '#f0fdf4' : '#fff1f2' },
          { label: 'Repair Inventory Value', value: formatLKR(stats.inventoryValue), color: '#1e40af', bg: '#eff6ff' },
        ].map(c => (
          <div key={c.label} style={{ background: c.bg, borderRadius: '16px', padding: '20px', border: '1px solid rgba(0,0,0,0.04)' }}>
            <div style={{ fontSize: '11px', fontWeight: '700', color: '#8a7a63', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '8px' }}>{c.label}</div>
            <div style={{ fontSize: '22px', fontWeight: '800', color: c.color }}>{c.value}</div>
          </div>
        ))}
      </div>

      {stats.lowStockCount > 0 && (
        <div onClick={() => navigateTo('inventory')} style={{ cursor: 'pointer', background: '#fffbeb', border: '1.5px solid #fde68a', borderRadius: '14px', padding: '14px 20px', marginBottom: '24px', display: 'flex', alignItems: 'center', gap: '12px' }}>
          <span style={{ fontSize: '22px' }}>⚠️</span>
          <div>
            <div style={{ fontSize: '14px', fontWeight: '700', color: '#92400e' }}>{stats.lowStockCount} repair part{stats.lowStockCount > 1 ? 's' : ''} at or below minimum stock</div>
            <div style={{ fontSize: '12px', color: '#b45309' }}>Click to review repair inventory</div>
          </div>
        </div>
      )}

      {/* Recent jobs + insights */}
      <div style={{ display: 'grid', gridTemplateColumns: '1.6fr 1fr', gap: '16px' }}>
        <div style={{ background: 'white', borderRadius: '16px', boxShadow: '0 1px 3px rgba(28,25,23,0.06)', border: '1px solid #f3ede4', overflow: 'hidden' }}>
          <div style={{ padding: '16px 20px', borderBottom: '1px solid #f3ede4', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h2 style={{ fontSize: '15px', fontWeight: '700', color: '#1c1917', margin: 0 }}>Recent Repair Jobs</h2>
            <button onClick={() => navigateTo('jobs')} style={{ background: 'none', border: 'none', color: '#d4881f', fontWeight: '700', fontSize: '13px', cursor: 'pointer' }}>View all →</button>
          </div>
          {recentJobs.length === 0 ? (
            <div style={{ padding: '48px', textAlign: 'center', color: '#a89478' }}>No repair jobs yet.</div>
          ) : (
            <div>
              {recentJobs.map(j => {
                const meta = statusMeta(j.status)
                const due = isCollectedWithDue(j)
                return (
                  <div key={j.id} onClick={() => onOpenJob(j.id)} style={{ padding: '13px 20px', borderBottom: '1px solid #f8f5f0', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
                    onMouseEnter={e => e.currentTarget.style.background = '#fdf8f3'} onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                    <div>
                      <div style={{ fontSize: '13px', fontWeight: '700', color: '#1c1917' }}>{j.job_no} · {j.phone_brand} {j.phone_model}</div>
                      <div style={{ fontSize: '12px', color: '#8a7a63' }}>{j.repair_customers?.name || '—'} · {timeAgo(j.created_at)}</div>
                    </div>
                    {due ? (
                      <span style={{ padding: '3px 10px', borderRadius: '10px', fontSize: '11px', fontWeight: '800', background: '#fee2e2', color: '#b91c1c', whiteSpace: 'nowrap' }}>⚠ DUE {formatLKR(j.balance_due)}</span>
                    ) : (
                      <span style={{ padding: '3px 10px', borderRadius: '10px', fontSize: '11px', fontWeight: '700', background: meta.bg, color: meta.color, whiteSpace: 'nowrap' }}>{meta.label}</span>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div style={{ background: 'white', borderRadius: '16px', boxShadow: '0 1px 3px rgba(28,25,23,0.06)', border: '1px solid #f3ede4', padding: '18px 20px' }}>
            <h3 style={{ fontSize: '13px', fontWeight: '700', color: '#1c1917', margin: '0 0 12px' }}>Most Common Repairs</h3>
            {commonRepairs.length === 0 ? <div style={{ fontSize: '12px', color: '#a89478' }}>No data yet</div> :
              commonRepairs.map(([name, count]) => (
                <div key={name} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12.5px', padding: '5px 0', borderBottom: '1px solid #f8f5f0' }}>
                  <span style={{ color: '#44403c' }}>{name}</span>
                  <span style={{ fontWeight: '700', color: '#d4881f' }}>{count}</span>
                </div>
              ))
            }
          </div>
          <div style={{ background: 'white', borderRadius: '16px', boxShadow: '0 1px 3px rgba(28,25,23,0.06)', border: '1px solid #f3ede4', padding: '18px 20px' }}>
            <h3 style={{ fontSize: '13px', fontWeight: '700', color: '#1c1917', margin: '0 0 12px' }}>Top Used Parts</h3>
            {topParts.length === 0 ? <div style={{ fontSize: '12px', color: '#a89478' }}>No data yet</div> :
              topParts.map(([name, qty]) => (
                <div key={name} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12.5px', padding: '5px 0', borderBottom: '1px solid #f8f5f0' }}>
                  <span style={{ color: '#44403c' }}>{name}</span>
                  <span style={{ fontWeight: '700', color: '#059669' }}>{qty}</span>
                </div>
              ))
            }
          </div>
        </div>
      </div>
    </div>
  )
}
