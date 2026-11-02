import { useState, useEffect } from 'react'
import { supabase } from '../../supabase'
import toast from 'react-hot-toast'
import { formatLKR, timeAgo } from '../../lib/repairConstants'

// Short-term personal lending/borrowing — entirely independent of the
// customer and supplier ledgers. Cash and bank transfer move real money
// immediately and correctly; a cheque is recorded pending (no money moves
// until it's marked realized here) rather than hooking into the full
// Bank.jsx cheque-presentment workflow, which is built around customer/
// supplier transactions specifically — keeping this feature self-contained
// avoids a much larger, riskier cross-cutting change for what's meant to be
// an independent, standalone ledger.
// Moves money back out of / into the cash drawer or a bank account as a
// counter-entry (never edits history). `delta` is signed from OUR side:
// positive = money comes in to us, negative = money goes out.
async function applyMovement({ shop, person, method, bankAccountId, delta, label }) {
  if (Math.abs(delta) < 0.009) return
  if (method === 'cash') {
    const { error } = await supabase.from('repair_cash_ledger').insert({
      shop_id: shop?.id || null, type: 'lending', amount: delta, reference: person, notes: label,
    })
    if (error) throw error
  } else if (bankAccountId) {
    const { data: bank, error: bErr } = await supabase.from('bank_accounts').select('balance').eq('id', bankAccountId).single()
    if (bErr) throw bErr
    const { error: uErr } = await supabase.from('bank_accounts').update({ balance: (bank?.balance || 0) + delta }).eq('id', bankAccountId)
    if (uErr) throw uErr
    const { error: tErr } = await supabase.from('bank_transactions').insert({
      bank_account_id: bankAccountId, type: delta > 0 ? 'deposit' : 'withdrawal', amount: Math.abs(delta),
      reference: `Lending voided — ${person}`, notes: label,
    })
    if (tErr) throw tErr
  }
}

const personKey = (name) => (name || '').trim().toLowerCase()
const fmtDT = (iso) => {
  const d = new Date(iso)
  return `${d.toLocaleDateString('en-GB')} ${d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`
}
// Money still open on a record, signed from OUR side: + they owe us, − we owe them.
// Voided records and cheques that haven't been realized (no money moved yet) count as 0.
function signedOutstanding(r) {
  if (r.status === 'voided') return 0
  if (r.method === 'cheque' && !r.cheque_realized) return 0
  const open = Math.max(0, (r.principal_amount || 0) - (r.amount_repaid || 0))
  return r.type === 'lent' ? open : -open
}

export default function RepairLending({ shop }) {
  const [records, setRecords] = useState([])
  const [loading, setLoading] = useState(true)
  const [showNew, setShowNew] = useState(false)
  const [newForName, setNewForName] = useState('')
  const [repaying, setRepaying] = useState(null)
  const [viewingKey, setViewingKey] = useState(null)
  const [voiding, setVoiding] = useState(null)
  const [version, setVersion] = useState(0)
  const [search, setSearch] = useState('')
  const [showVoided, setShowVoided] = useState(false)

  useEffect(() => { fetchRecords() }, [shop?.id])

  async function fetchRecords() {
    setLoading(true)
    let q = supabase.from('repair_lending_records').select('*, bank_accounts(name)').order('created_at', { ascending: true })
    if (shop?.id) q = q.eq('shop_id', shop.id)
    const { data } = await q
    setRecords(data || [])
    setVersion(v => v + 1)
    setLoading(false)
  }

  // One row per person — "FAHAD", "Fahad " and "fahad" are the same person.
  const people = (() => {
    const map = new Map()
    for (const r of records) {
      if (r.status === 'voided' && !showVoided) continue
      const k = personKey(r.person_name)
      if (!map.has(k)) map.set(k, { key: k, name: r.person_name.trim(), records: [], lastAt: r.created_at })
      const g = map.get(k)
      g.records.push(r)
      if (new Date(r.created_at) > new Date(g.lastAt)) { g.lastAt = r.created_at; g.name = r.person_name.trim() }
    }
    return [...map.values()].map(g => {
      const live = g.records.filter(r => r.status !== 'voided')
      const lentOut = live.filter(r => r.type === 'lent').reduce((s, r) => s + Math.max(0, signedOutstanding(r)), 0)
      const borrowed = live.filter(r => r.type === 'borrowed').reduce((s, r) => s + Math.max(0, -signedOutstanding(r)), 0)
      const pendingCheques = live.filter(r => r.method === 'cheque' && !r.cheque_realized).length
      return { ...g, live, lentOut, borrowed, net: lentOut - borrowed, pendingCheques }
    }).filter(g => !search.trim() || g.name.toLowerCase().includes(search.trim().toLowerCase()))
      .sort((a, b) => new Date(b.lastAt) - new Date(a.lastAt))
  })()

  const totalLentOut = records.reduce((s, r) => s + Math.max(0, signedOutstanding(r)), 0)
  const totalBorrowed = records.reduce((s, r) => s + Math.max(0, -signedOutstanding(r)), 0)
  // The popup always lists EVERY entry for the person (voided ones greyed) so the audit
  // trail never disappears, whatever the "Show voided" toggle says for the main list.
  const viewingPerson = (() => {
    if (!viewingKey) return null
    const rs = records.filter(r => personKey(r.person_name) === viewingKey)
    if (!rs.length) return null
    const live = rs.filter(r => r.status !== 'voided')
    const lentOut = live.filter(r => r.type === 'lent').reduce((s, r) => s + Math.max(0, signedOutstanding(r)), 0)
    const borrowed = live.filter(r => r.type === 'borrowed').reduce((s, r) => s + Math.max(0, -signedOutstanding(r)), 0)
    return { key: viewingKey, name: rs[rs.length - 1].person_name.trim(), records: rs, live, lentOut, borrowed, net: lentOut - borrowed, pendingCheques: 0 }
  })()

  // Undo ONE repayment: reverse its cash/bank movement, remove it, and re-open the record.
  async function voidRepayment(rec, h) {
    if (!window.confirm(`Void this ${formatLKR(h.amount)} ${h.method} repayment? The ${h.method === 'cash' ? 'cash drawer' : (h.bank_accounts?.name || 'bank account')} will be ${rec.type === 'lent' ? 'reduced' : 'increased'} by ${formatLKR(h.amount)} and the record's outstanding amount goes back up.`)) return
    try {
      // Original repayment: lent → money came IN, borrowed → money went OUT. Reverse it.
      const originalDelta = rec.type === 'lent' ? h.amount : -h.amount
      await applyMovement({ shop, person: rec.person_name, method: h.method, bankAccountId: h.bank_account_id, delta: -originalDelta, label: `Lending repayment voided (${formatLKR(h.amount)})` })
      const { error: dErr } = await supabase.from('repair_lending_repayments').delete().eq('id', h.id)
      if (dErr) throw dErr
      const newRepaid = Math.max(0, (rec.amount_repaid || 0) - h.amount)
      const { error: uErr } = await supabase.from('repair_lending_records').update({ amount_repaid: newRepaid, status: 'active' }).eq('id', rec.id)
      if (uErr) throw uErr
      toast.success('Repayment voided and reversed')
      fetchRecords()
    } catch (e) { toast.error('Failed: ' + e.message) }
  }

  async function markChequeRealized(r) {
    if (!window.confirm(`Mark this cheque as realized? This will ${r.type === 'lent' ? 'deduct' : 'add'} ${formatLKR(r.principal_amount)} from your ${r.bank_account_id ? r.bank_accounts?.name : 'cash'} balance now.`)) return
    try {
      const delta = r.type === 'lent' ? -r.principal_amount : r.principal_amount
      if (r.bank_account_id) {
        const { data: bank } = await supabase.from('bank_accounts').select('balance').eq('id', r.bank_account_id).single()
        const { error: bankErr } = await supabase.from('bank_accounts').update({ balance: (bank?.balance || 0) + delta }).eq('id', r.bank_account_id)
        if (bankErr) throw bankErr
        const { error: txErr } = await supabase.from('bank_transactions').insert({
          bank_account_id: r.bank_account_id, type: delta > 0 ? 'deposit' : 'withdrawal', amount: r.principal_amount,
          reference: `Lending — ${r.person_name}`, notes: `Cheque realized (${r.type})`,
        })
        if (txErr) throw txErr
      } else {
        const { error: cashErr } = await supabase.from('repair_cash_ledger').insert({
          shop_id: shop?.id || null, type: 'lending', amount: delta, reference: r.person_name, notes: `Cheque realized (${r.type})`,
        })
        if (cashErr) throw cashErr
      }
      const { error: updErr } = await supabase.from('repair_lending_records').update({ cheque_realized: true }).eq('id', r.id)
      if (updErr) throw updErr
      toast.success('Cheque marked realized')
      fetchRecords()
    } catch (e) { toast.error('Failed: ' + e.message) }
  }

  const netLabel = (net) => net > 0.009 ? 'They owe us' : net < -0.009 ? 'We owe them' : 'Settled'
  const netColor = (net) => net > 0.009 ? '#e11d48' : net < -0.009 ? '#d4881f' : '#94a3b8'

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '18px' }}>
        <div>
          <h1 style={{ fontSize: '22px', fontWeight: '800', color: '#1c1917', margin: '0 0 4px' }}>Personal Lending</h1>
          <p style={{ color: '#8a7a63', fontSize: '13px', margin: 0 }}>Short-term cash lent or borrowed — one line per person with the net balance; click a person for every transaction</p>
        </div>
        <button onClick={() => { setNewForName(''); setShowNew(true) }} style={{ padding: '10px 20px', background: 'linear-gradient(135deg,#f0b23d,#d4881f)', color: '#1c1917', border: 'none', borderRadius: '11px', cursor: 'pointer', fontWeight: '800', fontSize: '13px' }}>
          + New Record
        </button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(200px, 1fr))', gap: '14px', marginBottom: '20px', maxWidth: '520px' }}>
        <div style={{ background: '#fff1f2', borderRadius: '14px', padding: '16px 18px', border: '1px solid rgba(0,0,0,0.04)' }}>
          <div style={{ fontSize: '11px', fontWeight: '700', color: '#e11d48', textTransform: 'uppercase' }}>Lent Out (Outstanding)</div>
          <div style={{ fontSize: '21px', fontWeight: '800', color: '#e11d48' }}>{formatLKR(totalLentOut)}</div>
        </div>
        <div style={{ background: '#fef3e2', borderRadius: '14px', padding: '16px 18px', border: '1px solid rgba(0,0,0,0.04)' }}>
          <div style={{ fontSize: '11px', fontWeight: '700', color: '#d4881f', textTransform: 'uppercase' }}>Borrowed (Outstanding)</div>
          <div style={{ fontSize: '21px', fontWeight: '800', color: '#d4881f' }}>{formatLKR(totalBorrowed)}</div>
        </div>
      </div>

      <div style={{ display: 'flex', gap: '12px', alignItems: 'center', marginBottom: '14px', flexWrap: 'wrap' }}>
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search person…"
          style={{ flex: 1, minWidth: '220px', maxWidth: '360px', padding: '9px 12px', border: '1.5px solid #e7dfd3', borderRadius: '10px', fontSize: '13px', outline: 'none' }} />
        <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12.5px', color: '#78716c', cursor: 'pointer' }}>
          <input type="checkbox" checked={showVoided} onChange={e => setShowVoided(e.target.checked)} /> Show voided
        </label>
      </div>

      {loading ? <div style={{ padding: '60px', textAlign: 'center', color: '#a89478' }}>Loading...</div> : (
        <div style={{ background: 'white', borderRadius: '16px', border: '1px solid #f3ede4', overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr style={{ background: '#fdf8f3', borderBottom: '2px solid #f3ede4' }}>
              {['Person', 'Entries', 'Lent Out', 'Borrowed', 'Net Balance', 'Last Activity'].map(h => (
                <th key={h} style={{ padding: '10px 14px', textAlign: 'left', fontSize: '10px', fontWeight: '700', color: '#a89478', textTransform: 'uppercase' }}>{h}</th>
              ))}
            </tr></thead>
            <tbody>
              {people.map((g, i) => (
                <tr key={g.key} onClick={() => setViewingKey(g.key)} style={{ borderBottom: '1px solid #f8f5f0', background: i % 2 === 0 ? 'white' : '#fdfbf8', cursor: 'pointer' }}
                  onMouseEnter={e => e.currentTarget.style.background = '#fef9ef'} onMouseLeave={e => e.currentTarget.style.background = i % 2 === 0 ? 'white' : '#fdfbf8'}>
                  <td style={{ padding: '12px 14px', fontWeight: '700' }}>{g.name}{g.pendingCheques > 0 && <span style={{ marginLeft: '8px', padding: '2px 8px', borderRadius: '8px', fontSize: '10.5px', fontWeight: '700', background: '#fef9c3', color: '#a16207' }}>{g.pendingCheques} cheque pending</span>}</td>
                  <td style={{ padding: '12px 14px', color: '#78716c' }}>{g.records.length}</td>
                  <td style={{ padding: '12px 14px', color: g.lentOut > 0 ? '#e11d48' : '#cbd5e1', fontWeight: '600' }}>{formatLKR(g.lentOut)}</td>
                  <td style={{ padding: '12px 14px', color: g.borrowed > 0 ? '#d4881f' : '#cbd5e1', fontWeight: '600' }}>{formatLKR(g.borrowed)}</td>
                  <td style={{ padding: '12px 14px' }}>
                    <div style={{ fontWeight: '800', color: netColor(g.net) }}>{formatLKR(Math.abs(g.net))}</div>
                    <div style={{ fontSize: '11px', color: netColor(g.net) }}>{netLabel(g.net)}</div>
                  </td>
                  <td style={{ padding: '12px 14px', fontSize: '12px', color: '#a89478' }}>{timeAgo(g.lastAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {people.length === 0 && <div style={{ padding: '48px', textAlign: 'center', color: '#a89478' }}>{search ? 'No one matches that search.' : 'No lending records yet.'}</div>}
        </div>
      )}

      {viewingPerson && (
        <PersonLedgerModal person={viewingPerson} version={version} showVoided={showVoided}
          onClose={() => setViewingKey(null)}
          onNewEntry={() => { setNewForName(viewingPerson.name); setShowNew(true) }}
          onRepay={r => setRepaying(r)} onVoidRecord={r => setVoiding(r)}
          onVoidRepayment={voidRepayment} onRealize={markChequeRealized} />
      )}
      {showNew && <NewLendingModal shop={shop} initialName={newForName} onClose={() => setShowNew(false)} onSaved={() => { setShowNew(false); fetchRecords() }} />}
      {voiding && <VoidLendingModal shop={shop} record={voiding} onClose={() => setVoiding(null)} onSaved={() => { setVoiding(null); fetchRecords() }} />}
      {repaying && <RepaymentModal shop={shop} record={repaying} onClose={() => setRepaying(null)} onSaved={() => { setRepaying(null); fetchRecords() }} />}
    </div>
  )
}

// Everything for one person: net balance up top, then every lend / borrow / repayment
// oldest → newest with a running net balance.
function PersonLedgerModal({ person, version, showVoided, onClose, onNewEntry, onRepay, onVoidRecord, onVoidRepayment, onRealize }) {
  const [repayments, setRepayments] = useState([])
  const idsKey = person.records.map(r => r.id).join(',')

  useEffect(() => {
    if (!idsKey) { setRepayments([]); return }
    supabase.from('repair_lending_repayments').select('*, bank_accounts(name)').in('lending_id', idsKey.split(',')).order('created_at', { ascending: true })
      .then(({ data }) => setRepayments(data || []))
  }, [idsKey, version])

  // Build the timeline. Running net: + they owe us, − we owe them. Voided records and
  // their repayments are listed (greyed) but never change the running balance.
  const events = []
  for (const r of person.records) {
    events.push({ kind: 'record', at: r.created_at, r })
    for (const h of repayments.filter(x => x.lending_id === r.id)) events.push({ kind: 'repayment', at: h.created_at, r, h })
  }
  events.sort((a, b) => new Date(a.at) - new Date(b.at))
  let running = 0
  for (const e of events) {
    const voided = e.r.status === 'voided'
    let delta = 0
    if (!voided) {
      if (e.kind === 'record') {
        const moved = !(e.r.method === 'cheque' && !e.r.cheque_realized)
        delta = moved ? (e.r.type === 'lent' ? e.r.principal_amount : -e.r.principal_amount) : 0
      } else {
        delta = e.r.type === 'lent' ? -e.h.amount : e.h.amount
      }
    }
    running += delta
    e.delta = delta; e.running = running; e.voided = voided
  }
  const net = person.net

  const th = { padding: '8px 10px', textAlign: 'left', fontSize: '10px', fontWeight: '800', color: '#a89478', textTransform: 'uppercase', background: '#faf7f2', position: 'sticky', top: 0 }
  const td = { padding: '9px 10px', fontSize: '12.5px', borderBottom: '1px solid #f8f5f0', verticalAlign: 'top' }
  const btn = (bg, color) => ({ padding: '3px 9px', background: bg, color, border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '11px', fontWeight: '700', marginLeft: '4px' })

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(28,25,23,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '20px' }}>
      <div onClick={e => e.stopPropagation()} style={{ background: 'white', borderRadius: '18px', padding: '24px', width: '100%', maxWidth: '860px', maxHeight: '90vh', overflowY: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
          <h3 style={{ fontSize: '18px', fontWeight: '800', margin: 0 }}>{person.name}</h3>
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            <button onClick={onNewEntry} style={{ padding: '8px 14px', background: 'linear-gradient(135deg,#f0b23d,#d4881f)', border: 'none', borderRadius: '9px', cursor: 'pointer', fontWeight: '800', fontSize: '12.5px' }}>+ New entry for {person.name}</button>
            <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: '20px', cursor: 'pointer', color: '#a89478' }}>✕</button>
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '10px', marginBottom: '16px' }}>
          <div style={{ background: net > 0.009 ? '#fff1f2' : net < -0.009 ? '#fef3e2' : '#f8fafc', borderRadius: '12px', padding: '12px 14px' }}>
            <div style={{ fontSize: '10.5px', fontWeight: '700', color: '#8a7a63', textTransform: 'uppercase' }}>Net Balance</div>
            <div style={{ fontSize: '20px', fontWeight: '800', color: net > 0.009 ? '#e11d48' : net < -0.009 ? '#d4881f' : '#94a3b8' }}>{formatLKR(Math.abs(net))}</div>
            <div style={{ fontSize: '11.5px', color: '#78716c' }}>{net > 0.009 ? `${person.name} owes us` : net < -0.009 ? `We owe ${person.name}` : 'Fully settled'}</div>
          </div>
          <div style={{ background: '#faf7f2', borderRadius: '12px', padding: '12px 14px' }}>
            <div style={{ fontSize: '10.5px', fontWeight: '700', color: '#8a7a63', textTransform: 'uppercase' }}>Lent Out (open)</div>
            <div style={{ fontSize: '17px', fontWeight: '800', color: '#e11d48' }}>{formatLKR(person.lentOut)}</div>
          </div>
          <div style={{ background: '#faf7f2', borderRadius: '12px', padding: '12px 14px' }}>
            <div style={{ fontSize: '10.5px', fontWeight: '700', color: '#8a7a63', textTransform: 'uppercase' }}>Borrowed (open)</div>
            <div style={{ fontSize: '17px', fontWeight: '800', color: '#d4881f' }}>{formatLKR(person.borrowed)}</div>
          </div>
        </div>

        <div style={{ border: '1px solid #f3ede4', borderRadius: '12px', overflow: 'auto', maxHeight: '55vh' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '640px' }}>
            <thead><tr>
              <th style={th}>Date & Time</th><th style={th}>Transaction</th><th style={th}>Method</th>
              <th style={{ ...th, textAlign: 'right' }}>Amount</th><th style={{ ...th, textAlign: 'right' }}>Net After</th><th style={th}></th>
            </tr></thead>
            <tbody>
              {events.map(e => {
                const isRec = e.kind === 'record'
                const lent = e.r.type === 'lent'
                const open = Math.max(0, e.r.principal_amount - e.r.amount_repaid)
                const chequePending = isRec && e.r.method === 'cheque' && !e.r.cheque_realized
                return (
                  <tr key={(isRec ? 'r' : 'h') + (isRec ? e.r.id : e.h.id)} style={{ opacity: e.voided ? 0.45 : 1 }}>
                    <td style={{ ...td, whiteSpace: 'nowrap', color: '#78716c' }}>{fmtDT(e.at)}</td>
                    <td style={td}>
                      {isRec ? (
                        <>
                          <span style={{ fontWeight: '700', color: lent ? '#e11d48' : '#d4881f' }}>{lent ? 'Lent to' : 'Borrowed from'} {person.name}</span>
                          {e.voided && <span style={{ marginLeft: '6px', padding: '1px 7px', borderRadius: '8px', fontSize: '10.5px', fontWeight: '700', background: '#fee2e2', color: '#b91c1c' }}>Voided</span>}
                          {chequePending && !e.voided && <span style={{ marginLeft: '6px', padding: '1px 7px', borderRadius: '8px', fontSize: '10.5px', fontWeight: '700', background: '#fef9c3', color: '#a16207' }}>Cheque pending</span>}
                          {e.r.notes && <div style={{ fontSize: '11px', color: '#a89478' }}>{e.r.notes}</div>}
                          {e.voided && e.r.void_reason && <div style={{ fontSize: '11px', color: '#b91c1c' }}>Void reason: {e.r.void_reason}</div>}
                          {!e.voided && <div style={{ fontSize: '11px', color: '#a89478' }}>Repaid {formatLKR(e.r.amount_repaid)} · Open {formatLKR(open)}</div>}
                        </>
                      ) : (
                        <span style={{ color: '#059669', fontWeight: '600' }}>↳ Repayment {lent ? 'received' : 'paid'}</span>
                      )}
                    </td>
                    <td style={{ ...td, color: '#78716c', textTransform: 'capitalize' }}>{isRec ? e.r.method : e.h.method}{(isRec ? e.r.bank_accounts?.name : e.h.bank_accounts?.name) ? ` (${isRec ? e.r.bank_accounts.name : e.h.bank_accounts.name})` : ''}</td>
                    <td style={{ ...td, textAlign: 'right', fontWeight: '700', fontVariantNumeric: 'tabular-nums', color: isRec ? (lent ? '#e11d48' : '#d4881f') : '#059669' }}>
                      {formatLKR(isRec ? e.r.principal_amount : e.h.amount)}
                    </td>
                    <td style={{ ...td, textAlign: 'right', fontWeight: '800', fontVariantNumeric: 'tabular-nums', color: e.voided ? '#a89478' : e.running > 0.009 ? '#e11d48' : e.running < -0.009 ? '#d4881f' : '#94a3b8' }}>
                      {e.voided ? '—' : <>{formatLKR(Math.abs(e.running))}<div style={{ fontSize: '10px', fontWeight: '600' }}>{e.running > 0.009 ? 'they owe' : e.running < -0.009 ? 'we owe' : 'settled'}</div></>}
                    </td>
                    <td style={{ ...td, whiteSpace: 'nowrap', textAlign: 'right' }}>
                      {isRec && !e.voided && chequePending && <button onClick={() => onRealize(e.r)} style={btn('#fef9c3', '#a16207')}>Mark Realized</button>}
                      {isRec && !e.voided && e.r.status === 'active' && !chequePending && open > 0.009 && <button onClick={() => onRepay(e.r)} style={btn('#f0fdf4', '#059669')}>Record Repayment</button>}
                      {isRec && !e.voided && <button onClick={() => onVoidRecord(e.r)} style={btn('#fff1f2', '#e11d48')}>Void</button>}
                      {!isRec && !e.voided && <button onClick={() => onVoidRepayment(e.r, e.h)} style={btn('#fff1f2', '#e11d48')}>Void</button>}
                    </td>
                  </tr>
                )
              })}
              {events.length === 0 && <tr><td colSpan={6} style={{ ...td, textAlign: 'center', color: '#a89478', padding: '30px' }}>No transactions.</td></tr>}
            </tbody>
          </table>
        </div>
        <p style={{ fontSize: '11px', color: '#a89478', margin: '10px 0 0' }}>Net Balance counts money that has actually moved: voided entries and cheques not yet realized are excluded.</p>
      </div>
    </div>
  )
}

function NewLendingModal({ shop, initialName = '', onClose, onSaved }) {
  const [personName, setPersonName] = useState(initialName)
  const [contact, setContact] = useState('')
  const [type, setType] = useState('lent')
  const [amount, setAmount] = useState('')
  const [method, setMethod] = useState('cash')
  const [bankAccountId, setBankAccountId] = useState('')
  const [bankAccounts, setBankAccounts] = useState([])
  const [chequeNo, setChequeNo] = useState('')
  const [chequeDate, setChequeDate] = useState('')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => { supabase.from('bank_accounts').select('*').order('name').then(({ data }) => setBankAccounts(data || [])) }, [])

  async function handleSave() {
    const amt = parseFloat(amount)
    if (!personName.trim()) return toast.error('Enter a name')
    if (!amt || amt <= 0) return toast.error('Enter a valid amount')
    if ((method === 'bank' || method === 'cheque') && !bankAccountId) return toast.error('Select a bank account')
    setSaving(true)
    let recordId = null
    try {
      const { data: rec, error } = await supabase.from('repair_lending_records').insert({
        shop_id: shop?.id || null, person_name: personName.trim(), contact: contact.trim() || null,
        type, principal_amount: amt, method,
        bank_account_id: (method === 'bank' || method === 'cheque') ? bankAccountId : null,
        cheque_no: method === 'cheque' ? chequeNo || null : null,
        cheque_date: method === 'cheque' ? chequeDate || null : null,
        notes: notes || null,
      }).select().single()
      if (error) throw error
      recordId = rec.id

      // Cheque: no money movement yet — recorded pending, realized separately.
      if (method === 'cash') {
        const delta = type === 'lent' ? -amt : amt
        const { error: cashErr } = await supabase.from('repair_cash_ledger').insert({
          shop_id: shop?.id || null, type: 'lending', amount: delta, reference: personName.trim(), notes: `${type === 'lent' ? 'Lent to' : 'Borrowed from'} ${personName.trim()}`,
        })
        if (cashErr) throw cashErr
      } else if (method === 'bank') {
        const bank = bankAccounts.find(b => b.id === bankAccountId)
        const delta = type === 'lent' ? -amt : amt
        const { error: bankErr } = await supabase.from('bank_accounts').update({ balance: (bank?.balance || 0) + delta }).eq('id', bankAccountId)
        if (bankErr) throw bankErr
        const { error: txErr } = await supabase.from('bank_transactions').insert({
          bank_account_id: bankAccountId, type: type === 'lent' ? 'withdrawal' : 'deposit', amount: amt,
          reference: `Lending — ${personName.trim()}`, notes: type === 'lent' ? 'Lent out' : 'Borrowed',
        })
        if (txErr) throw txErr
      }

      toast.success('Lending record saved')
      onSaved()
    } catch (e) {
      if (recordId) await supabase.from('repair_lending_records').delete().eq('id', recordId)
      toast.error('Failed: ' + e.message)
    }
    setSaving(false)
  }

  const inp = { width: '100%', padding: '9px 12px', border: '1.5px solid #e7dfd3', borderRadius: '8px', fontSize: '13px', boxSizing: 'border-box' }
  const lbl = { fontSize: '11px', fontWeight: '700', color: '#a89478', textTransform: 'uppercase', display: 'block', marginBottom: '5px' }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(28,25,23,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '20px' }}>
      <div style={{ background: 'white', borderRadius: '18px', padding: '26px', width: '100%', maxWidth: '440px', maxHeight: '90vh', overflowY: 'auto' }}>
        <h3 style={{ fontSize: '17px', fontWeight: '800', margin: '0 0 16px' }}>New Lending Record</h3>

        <div style={{ display: 'flex', gap: '8px', marginBottom: '14px' }}>
          <button onClick={() => setType('lent')} style={{ flex: 1, padding: '9px', borderRadius: '8px', border: type === 'lent' ? '1.5px solid #e11d48' : '1.5px solid #e7dfd3', background: type === 'lent' ? '#fff1f2' : 'white', color: type === 'lent' ? '#e11d48' : '#78716c', fontWeight: '700', fontSize: '13px', cursor: 'pointer' }}>
            We Lent Out
          </button>
          <button onClick={() => setType('borrowed')} style={{ flex: 1, padding: '9px', borderRadius: '8px', border: type === 'borrowed' ? '1.5px solid #d4881f' : '1.5px solid #e7dfd3', background: type === 'borrowed' ? '#fef3e2' : 'white', color: type === 'borrowed' ? '#d4881f' : '#78716c', fontWeight: '700', fontSize: '13px', cursor: 'pointer' }}>
            We Borrowed
          </button>
        </div>

        <div style={{ marginBottom: '12px' }}><label style={lbl}>Person Name</label><input style={inp} value={personName} onChange={e => setPersonName(e.target.value)} /></div>
        <div style={{ marginBottom: '12px' }}><label style={lbl}>Contact (optional)</label><input style={inp} value={contact} onChange={e => setContact(e.target.value)} /></div>
        <div style={{ marginBottom: '12px' }}><label style={lbl}>Amount</label><input type="number" style={inp} value={amount} onChange={e => setAmount(e.target.value)} /></div>

        <div style={{ marginBottom: '12px' }}>
          <label style={lbl}>Method</label>
          <select style={inp} value={method} onChange={e => setMethod(e.target.value)}>
            <option value="cash">Cash</option><option value="cheque">Cheque</option><option value="bank">Bank Transfer</option>
          </select>
        </div>

        {(method === 'bank' || method === 'cheque') && (
          <div style={{ marginBottom: '12px' }}>
            <label style={lbl}>Bank Account</label>
            <select style={inp} value={bankAccountId} onChange={e => setBankAccountId(e.target.value)}>
              <option value="">Select...</option>
              {bankAccounts.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </div>
        )}
        {method === 'cheque' && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginBottom: '12px' }}>
            <div><label style={lbl}>Cheque No</label><input style={inp} value={chequeNo} onChange={e => setChequeNo(e.target.value)} /></div>
            <div><label style={lbl}>Cheque Date</label><input type="date" style={inp} value={chequeDate} onChange={e => setChequeDate(e.target.value)} /></div>
          </div>
        )}

        <div style={{ marginBottom: '18px' }}><label style={lbl}>Notes (optional)</label><textarea style={{ ...inp, minHeight: '60px' }} value={notes} onChange={e => setNotes(e.target.value)} /></div>

        <div style={{ display: 'flex', gap: '10px' }}>
          <button onClick={onClose} style={{ flex: 1, padding: '11px', background: '#f5f1ea', border: 'none', borderRadius: '10px', cursor: 'pointer', fontWeight: '700' }}>Cancel</button>
          <button onClick={handleSave} disabled={saving} style={{ flex: 1, padding: '11px', background: 'linear-gradient(135deg,#f0b23d,#d4881f)', border: 'none', borderRadius: '10px', cursor: 'pointer', fontWeight: '800' }}>{saving ? 'Saving...' : 'Save'}</button>
        </div>
      </div>
    </div>
  )
}

function RepaymentModal({ shop, record, onClose, onSaved }) {
  const outstanding = record.principal_amount - record.amount_repaid
  const [amount, setAmount] = useState(String(outstanding))
  const [method, setMethod] = useState('cash')
  const [bankAccountId, setBankAccountId] = useState('')
  const [bankAccounts, setBankAccounts] = useState([])
  const [saving, setSaving] = useState(false)

  useEffect(() => { supabase.from('bank_accounts').select('*').order('name').then(({ data }) => setBankAccounts(data || [])) }, [])

  async function handleSave() {
    const amt = parseFloat(amount)
    if (!amt || amt <= 0) return toast.error('Enter a valid amount')
    if (amt > outstanding + 0.009) return toast.error(`Can't repay more than the outstanding ${formatLKR(outstanding)}`)
    if (method === 'bank' && !bankAccountId) return toast.error('Select a bank account')
    setSaving(true)
    try {
      // Repaying a LENT record means money comes back IN to us; repaying a
      // BORROWED record means we're paying it back OUT.
      const delta = record.type === 'lent' ? amt : -amt
      if (method === 'cash') {
        const { error: cashErr } = await supabase.from('repair_cash_ledger').insert({
          shop_id: shop?.id || null, type: 'lending', amount: delta, reference: record.person_name, notes: 'Lending repayment',
        })
        if (cashErr) throw cashErr
      } else {
        const bank = bankAccounts.find(b => b.id === bankAccountId)
        const { error: bankErr } = await supabase.from('bank_accounts').update({ balance: (bank?.balance || 0) + delta }).eq('id', bankAccountId)
        if (bankErr) throw bankErr
        const { error: txErr } = await supabase.from('bank_transactions').insert({
          bank_account_id: bankAccountId, type: delta > 0 ? 'deposit' : 'withdrawal', amount: amt,
          reference: `Lending repayment — ${record.person_name}`, notes: '',
        })
        if (txErr) throw txErr
      }

      const { error: repayErr } = await supabase.from('repair_lending_repayments').insert({
        lending_id: record.id, amount: amt, method, bank_account_id: method === 'bank' ? bankAccountId : null,
      })
      if (repayErr) throw repayErr

      const newRepaid = record.amount_repaid + amt
      const { error: updErr } = await supabase.from('repair_lending_records').update({
        amount_repaid: newRepaid, status: newRepaid >= record.principal_amount - 0.009 ? 'settled' : 'active',
      }).eq('id', record.id)
      if (updErr) throw updErr

      toast.success('Repayment recorded')
      onSaved()
    } catch (e) { toast.error('Failed: ' + e.message) }
    setSaving(false)
  }

  const inp = { width: '100%', padding: '9px 12px', border: '1.5px solid #e7dfd3', borderRadius: '8px', fontSize: '13px', boxSizing: 'border-box' }
  const lbl = { fontSize: '11px', fontWeight: '700', color: '#a89478', textTransform: 'uppercase', display: 'block', marginBottom: '5px' }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(28,25,23,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1100, padding: '20px' }}>
      <div style={{ background: 'white', borderRadius: '18px', padding: '24px', width: '100%', maxWidth: '400px' }}>
        <h3 style={{ fontSize: '16px', fontWeight: '800', margin: '0 0 4px' }}>Record Repayment — {record.person_name}</h3>
        <p style={{ fontSize: '12px', color: '#8a7a63', margin: '0 0 16px' }}>Outstanding: {formatLKR(outstanding)}</p>

        <div style={{ marginBottom: '12px' }}><label style={lbl}>Amount</label><input type="number" style={inp} value={amount} onChange={e => setAmount(e.target.value)} /></div>
        <div style={{ marginBottom: '12px' }}>
          <label style={lbl}>Method</label>
          <select style={inp} value={method} onChange={e => setMethod(e.target.value)}>
            <option value="cash">Cash</option><option value="bank">Bank Transfer</option>
          </select>
        </div>
        {method === 'bank' && (
          <div style={{ marginBottom: '18px' }}>
            <label style={lbl}>Bank Account</label>
            <select style={inp} value={bankAccountId} onChange={e => setBankAccountId(e.target.value)}>
              <option value="">Select...</option>
              {bankAccounts.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </div>
        )}

        <div style={{ display: 'flex', gap: '10px' }}>
          <button onClick={onClose} style={{ flex: 1, padding: '10px', background: '#f5f1ea', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: '700' }}>Cancel</button>
          <button onClick={handleSave} disabled={saving} style={{ flex: 1, padding: '10px', background: '#059669', color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: '800' }}>{saving ? 'Saving...' : 'Confirm'}</button>
        </div>
      </div>
    </div>
  )
}


// Voids a whole lending record: reverses every repayment and the original
// lend/borrow movement (cash drawer or bank account) with counter-entries, then
// marks the record voided. History stays visible; nothing is silently deleted.
function VoidLendingModal({ shop, record, onClose, onSaved }) {
  const [repayments, setRepayments] = useState([])
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    supabase.from('repair_lending_repayments').select('*, bank_accounts(name)').eq('lending_id', record.id).order('created_at')
      .then(({ data }) => setRepayments(data || []))
  }, [record.id])

  const lent = record.type === 'lent'
  // Did the original lend/borrow actually move money? (A cheque only does once realized.)
  const principalMoved = record.method === 'cash' || record.method === 'bank' || (record.method === 'cheque' && record.cheque_realized)
  const principalWhere = record.method === 'cash' ? 'cash drawer' : (record.bank_accounts?.name || 'bank account')

  // Each reversal line, from OUR side (+ = money comes back in to us).
  const lines = []
  if (principalMoved) lines.push({ text: `${lent ? 'Lent' : 'Borrowed'} ${formatLKR(record.principal_amount)} (${principalWhere})`, delta: lent ? record.principal_amount : -record.principal_amount })
  for (const h of repayments) lines.push({ text: `Repayment ${formatLKR(h.amount)} (${h.method === 'cash' ? 'cash drawer' : (h.bank_accounts?.name || 'bank')})`, delta: lent ? -h.amount : h.amount })

  async function handleVoid() {
    if (!reason.trim()) return toast.error('A reason is required')
    setSaving(true)
    try {
      for (const h of repayments) {
        const originalDelta = lent ? h.amount : -h.amount
        await applyMovement({ shop, person: record.person_name, method: h.method, bankAccountId: h.bank_account_id, delta: -originalDelta, label: `Lending repayment reversed — record voided` })
      }
      if (principalMoved) {
        const originalDelta = lent ? -record.principal_amount : record.principal_amount
        await applyMovement({ shop, person: record.person_name, method: record.method === 'cash' ? 'cash' : 'bank', bankAccountId: record.bank_account_id, delta: -originalDelta, label: `${lent ? 'Lent to' : 'Borrowed from'} ${record.person_name} — record voided` })
      }
      const { error } = await supabase.from('repair_lending_records').update({
        status: 'voided', voided_at: new Date().toISOString(), void_reason: reason.trim(),
      }).eq('id', record.id)
      if (error) throw error
      toast.success('Lending record voided — transactions reversed')
      onSaved()
    } catch (e) { toast.error('Failed: ' + e.message) }
    setSaving(false)
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(28,25,23,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1100, padding: '20px' }}>
      <div style={{ background: 'white', borderRadius: '18px', padding: '24px', width: '100%', maxWidth: '440px', maxHeight: '90vh', overflowY: 'auto' }}>
        <h3 style={{ fontSize: '16px', fontWeight: '800', margin: '0 0 4px', color: '#b91c1c' }}>Void — {record.person_name}</h3>
        <p style={{ fontSize: '12px', color: '#8a7a63', margin: '0 0 14px' }}>{lent ? 'We lent' : 'We borrowed'} {formatLKR(record.principal_amount)} via {record.method}</p>

        <div style={{ background: '#fdf8f3', borderRadius: '10px', padding: '12px', marginBottom: '14px' }}>
          <div style={{ fontSize: '11px', fontWeight: '700', color: '#a89478', textTransform: 'uppercase', marginBottom: '8px' }}>These will be reversed</div>
          {lines.length === 0 && <div style={{ fontSize: '12.5px', color: '#78716c' }}>No money has moved (pending cheque) — the record is just marked voided.</div>}
          {lines.map((l, i) => (
            <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12.5px', padding: '3px 0' }}>
              <span>{l.text}</span>
              <span style={{ fontWeight: '700', color: l.delta >= 0 ? '#059669' : '#e11d48' }}>{l.delta >= 0 ? '+' : '−'}{formatLKR(Math.abs(l.delta))}</span>
            </div>
          ))}
        </div>

        <label style={{ fontSize: '11px', fontWeight: '700', color: '#a89478', textTransform: 'uppercase', display: 'block', marginBottom: '5px' }}>Reason (required)</label>
        <textarea style={{ width: '100%', padding: '9px 12px', border: '1.5px solid #e7dfd3', borderRadius: '8px', fontSize: '13px', boxSizing: 'border-box', minHeight: '60px', marginBottom: '16px' }}
          placeholder="e.g. Entered by mistake" value={reason} onChange={e => setReason(e.target.value)} />

        <div style={{ display: 'flex', gap: '10px' }}>
          <button onClick={onClose} style={{ flex: 1, padding: '10px', background: '#f5f1ea', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: '700' }}>Cancel</button>
          <button onClick={handleVoid} disabled={saving} style={{ flex: 1, padding: '10px', background: '#e11d48', color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: '800' }}>{saving ? 'Voiding...' : 'Void & Reverse'}</button>
        </div>
      </div>
    </div>
  )
}
