import { useState, useEffect } from 'react'
import { supabase } from '../../supabase'
import toast from 'react-hot-toast'

const formatLKR = (n) => `LKR ${(n || 0).toLocaleString('en-LK', { minimumFractionDigits: 2 })}`
const timeAgo = (d) => new Date(d).toLocaleString('en-LK', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })

// Links a customer and a supplier as the same real-world entity, so their
// receivable and payable balances can be netted off against each other.
// Same feature and design as the repair division's Combined Accounts —
// matching is always an explicit, confirmed link, never automatic by name.
export default function CombinedAccounts() {
  const [links, setLinks] = useState([])
  const [loading, setLoading] = useState(true)
  const [showLink, setShowLink] = useState(false)
  const [settling, setSettling] = useState(null)
  const [unlinking, setUnlinking] = useState(null)
  const [history, setHistory] = useState(null)

  useEffect(() => { fetchLinks() }, [])

  async function fetchLinks() {
    setLoading(true)
    const { data } = await supabase.from('customer_supplier_links')
      .select('*, customers(id, name, customer_no, credit_balance), suppliers(id, name, supplier_no, outstanding_balance)')
      .order('created_at', { ascending: false })
    setLinks(data || [])
    setLoading(false)
  }

  async function unlink(link) {
    if (!window.confirm(`Unlink ${link.customers?.name}? Past settlements stay on record — this only stops future netting.`)) return
    setUnlinking(link.id)
    const { error } = await supabase.from('customer_supplier_links').delete().eq('id', link.id)
    if (error) toast.error('Failed: ' + error.message)
    else { toast.success('Unlinked'); fetchLinks() }
    setUnlinking(null)
  }

  async function viewHistory(link) {
    const { data } = await supabase.from('account_settlements').select('*').eq('link_id', link.id).order('created_at', { ascending: false })
    setHistory({ link, records: data || [] })
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '18px' }}>
        <div>
          <h1 style={{ fontSize: '22px', fontWeight: '800', color: '#0f172a', margin: '0 0 4px' }}>Combined Accounts</h1>
          <p style={{ color: '#64748b', fontSize: '13px', margin: 0 }}>Customers who are also suppliers — net their balances and settle against each other</p>
        </div>
        <button onClick={() => setShowLink(true)} style={{ padding: '10px 20px', background: 'linear-gradient(135deg,#2563eb,#1d4ed8)', color: 'white', border: 'none', borderRadius: '11px', cursor: 'pointer', fontWeight: '800', fontSize: '13px' }}>
          + Link Customer &amp; Supplier
        </button>
      </div>

      {loading ? <div style={{ padding: '60px', textAlign: 'center', color: '#94a3b8' }}>Loading...</div> : (
        <div style={{ background: 'white', borderRadius: '16px', border: '1px solid #e2e8f0', overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr style={{ background: '#f8fafc', borderBottom: '2px solid #e2e8f0' }}>
              {['Name', 'Receivable (as customer)', 'Payable (as supplier)', 'Net Balance', ''].map(h => (
                <th key={h} style={{ padding: '10px 14px', textAlign: 'left', fontSize: '10px', fontWeight: '700', color: '#94a3b8', textTransform: 'uppercase' }}>{h}</th>
              ))}
            </tr></thead>
            <tbody>
              {links.map((l, i) => {
                const receivable = Math.max(0, l.customers?.credit_balance || 0)
                const payable = Math.max(0, l.suppliers?.outstanding_balance || 0)
                const net = receivable - payable
                const canSettle = receivable > 0.009 && payable > 0.009
                return (
                  <tr key={l.id} style={{ borderBottom: '1px solid #f1f5f9', background: i % 2 === 0 ? 'white' : '#f8fafc' }}>
                    <td style={{ padding: '11px 14px', fontWeight: '700' }}>
                      {l.customers?.name}
                      <div style={{ fontSize: '11px', color: '#94a3b8', fontWeight: '500' }}>{l.customers?.customer_no} · {l.suppliers?.supplier_no}</div>
                    </td>
                    <td style={{ padding: '11px 14px', color: '#dc2626', fontWeight: '700' }}>{formatLKR(receivable)}</td>
                    <td style={{ padding: '11px 14px', color: '#d97706', fontWeight: '700' }}>{formatLKR(payable)}</td>
                    <td style={{ padding: '11px 14px', fontWeight: '800', color: net > 0 ? '#dc2626' : net < 0 ? '#059669' : '#94a3b8' }}>
                      {net === 0 ? formatLKR(0) : net > 0 ? `${formatLKR(net)} owed to us` : `${formatLKR(Math.abs(net))} owed to them`}
                    </td>
                    <td style={{ padding: '11px 14px', display: 'flex', gap: '6px' }}>
                      {canSettle && (
                        <button onClick={() => setSettling(l)} style={{ padding: '5px 12px', background: '#f0fdf4', color: '#059669', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '11px', fontWeight: '700' }}>
                          Settle
                        </button>
                      )}
                      <button onClick={() => viewHistory(l)} style={{ padding: '5px 12px', background: '#f1f5f9', color: '#64748b', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '11px', fontWeight: '700' }}>
                        History
                      </button>
                      <button onClick={() => unlink(l)} disabled={unlinking === l.id} style={{ padding: '5px 12px', background: '#fef2f2', color: '#dc2626', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '11px', fontWeight: '700' }}>
                        Unlink
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          {links.length === 0 && <div style={{ padding: '48px', textAlign: 'center', color: '#94a3b8' }}>No linked accounts yet. Link a customer and supplier who are the same person/business to net their balances.</div>}
        </div>
      )}

      {showLink && <LinkAccountModal onClose={() => setShowLink(false)} onLinked={() => { setShowLink(false); fetchLinks() }} />}
      {settling && <SettleModal link={settling} onClose={() => setSettling(null)} onSettled={() => { setSettling(null); fetchLinks() }} />}
      {history && <HistoryModal data={history} onClose={() => setHistory(null)} />}
    </div>
  )
}

function LinkAccountModal({ onClose, onLinked }) {
  const [customerQuery, setCustomerQuery] = useState('')
  const [supplierQuery, setSupplierQuery] = useState('')
  const [customerResults, setCustomerResults] = useState([])
  const [supplierResults, setSupplierResults] = useState([])
  const [selectedCustomer, setSelectedCustomer] = useState(null)
  const [selectedSupplier, setSelectedSupplier] = useState(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (customerQuery.trim().length < 2 || selectedCustomer) { setCustomerResults([]); return }
    const t = setTimeout(() => {
      supabase.from('customers').select('id, name, phone, credit_balance')
        .or(`name.ilike.%${customerQuery}%,phone.ilike.%${customerQuery}%`).limit(8)
        .then(({ data }) => setCustomerResults(data || []))
    }, 250)
    return () => clearTimeout(t)
  }, [customerQuery, selectedCustomer])

  useEffect(() => {
    if (supplierQuery.trim().length < 2 || selectedSupplier) { setSupplierResults([]); return }
    const t = setTimeout(() => {
      supabase.from('suppliers').select('id, name, outstanding_balance')
        .ilike('name', `%${supplierQuery}%`).limit(8)
        .then(({ data }) => setSupplierResults(data || []))
    }, 250)
    return () => clearTimeout(t)
  }, [supplierQuery, selectedSupplier])

  async function handleLink() {
    if (!selectedCustomer || !selectedSupplier) return toast.error('Select both a customer and a supplier')
    setSaving(true)
    try {
      const [{ data: existingCust }, { data: existingSup }] = await Promise.all([
        supabase.from('customer_supplier_links').select('id').eq('customer_id', selectedCustomer.id),
        supabase.from('customer_supplier_links').select('id').eq('supplier_id', selectedSupplier.id),
      ])
      if (existingCust?.length) { toast.error(`${selectedCustomer.name} is already linked to a supplier`); setSaving(false); return }
      if (existingSup?.length) { toast.error(`${selectedSupplier.name} is already linked to a customer`); setSaving(false); return }

      const { error } = await supabase.from('customer_supplier_links').insert({
        customer_id: selectedCustomer.id, supplier_id: selectedSupplier.id,
      })
      if (error) throw error
      toast.success('Linked')
      onLinked()
    } catch (e) { toast.error('Failed: ' + e.message) }
    setSaving(false)
  }

  const inp = { width: '100%', padding: '9px 12px', border: '1.5px solid #e2e8f0', borderRadius: '8px', fontSize: '13px', boxSizing: 'border-box' }
  const lbl = { fontSize: '11px', fontWeight: '700', color: '#94a3b8', textTransform: 'uppercase', display: 'block', marginBottom: '5px' }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '20px' }}>
      <div style={{ background: 'white', borderRadius: '18px', padding: '26px', width: '100%', maxWidth: '440px' }}>
        <h3 style={{ fontSize: '17px', fontWeight: '800', margin: '0 0 4px' }}>Link Customer &amp; Supplier</h3>
        <p style={{ fontSize: '12px', color: '#64748b', margin: '0 0 18px' }}>Confirm these are the same person/business before linking — this can't be done automatically.</p>

        <div style={{ marginBottom: '14px', position: 'relative' }}>
          <label style={lbl}>Customer</label>
          {selectedCustomer ? (
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '9px 12px', background: '#eff6ff', borderRadius: '8px', border: '1.5px solid #dbeafe', fontSize: '13px' }}>
              <span style={{ fontWeight: '600' }}>{selectedCustomer.name} — Credit Balance {formatLKR(selectedCustomer.credit_balance || 0)}</span>
              <button onClick={() => { setSelectedCustomer(null); setCustomerQuery('') }} style={{ background: 'none', border: 'none', color: '#dc2626', cursor: 'pointer' }}>✕</button>
            </div>
          ) : (
            <>
              <input style={inp} placeholder="Search customer by name or phone" value={customerQuery} onChange={e => setCustomerQuery(e.target.value)} />
              {customerResults.length > 0 && (
                <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: 'white', border: '1.5px solid #e2e8f0', borderRadius: '8px', marginTop: '2px', zIndex: 20, boxShadow: '0 8px 20px rgba(0,0,0,0.12)', maxHeight: '180px', overflowY: 'auto' }}>
                  {customerResults.map(c => (
                    <div key={c.id} onClick={() => { setSelectedCustomer(c); setCustomerResults([]) }} style={{ padding: '9px 12px', cursor: 'pointer', fontSize: '13px', borderBottom: '1px solid #f1f5f9' }}>
                      <div style={{ fontWeight: '600' }}>{c.name}</div>
                      <div style={{ fontSize: '11px', color: '#94a3b8' }}>{c.phone} · Credit Balance {formatLKR(c.credit_balance || 0)}</div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>

        <div style={{ marginBottom: '20px', position: 'relative' }}>
          <label style={lbl}>Supplier</label>
          {selectedSupplier ? (
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '9px 12px', background: '#eff6ff', borderRadius: '8px', border: '1.5px solid #dbeafe', fontSize: '13px' }}>
              <span style={{ fontWeight: '600' }}>{selectedSupplier.name} — Outstanding {formatLKR(selectedSupplier.outstanding_balance || 0)}</span>
              <button onClick={() => { setSelectedSupplier(null); setSupplierQuery('') }} style={{ background: 'none', border: 'none', color: '#dc2626', cursor: 'pointer' }}>✕</button>
            </div>
          ) : (
            <>
              <input style={inp} placeholder="Search supplier by name" value={supplierQuery} onChange={e => setSupplierQuery(e.target.value)} />
              {supplierResults.length > 0 && (
                <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: 'white', border: '1.5px solid #e2e8f0', borderRadius: '8px', marginTop: '2px', zIndex: 20, boxShadow: '0 8px 20px rgba(0,0,0,0.12)', maxHeight: '180px', overflowY: 'auto' }}>
                  {supplierResults.map(s => (
                    <div key={s.id} onClick={() => { setSelectedSupplier(s); setSupplierResults([]) }} style={{ padding: '9px 12px', cursor: 'pointer', fontSize: '13px', borderBottom: '1px solid #f1f5f9' }}>
                      <div style={{ fontWeight: '600' }}>{s.name}</div>
                      <div style={{ fontSize: '11px', color: '#94a3b8' }}>Outstanding {formatLKR(s.outstanding_balance || 0)}</div>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>

        <div style={{ display: 'flex', gap: '10px' }}>
          <button onClick={onClose} style={{ flex: 1, padding: '11px', background: '#f1f5f9', border: 'none', borderRadius: '10px', cursor: 'pointer', fontWeight: '700' }}>Cancel</button>
          <button onClick={handleLink} disabled={saving} style={{ flex: 1, padding: '11px', background: 'linear-gradient(135deg,#2563eb,#1d4ed8)', color: 'white', border: 'none', borderRadius: '10px', cursor: 'pointer', fontWeight: '800' }}>{saving ? 'Linking...' : 'Link'}</button>
        </div>
      </div>
    </div>
  )
}

function SettleModal({ link, onClose, onSettled }) {
  const receivable = Math.max(0, link.customers?.credit_balance || 0)
  const payable = Math.max(0, link.suppliers?.outstanding_balance || 0)
  const maxSettleable = Math.min(receivable, payable)
  const [amount, setAmount] = useState(String(maxSettleable))
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)

  async function handleSettle() {
    const amt = parseFloat(amount)
    if (!amt || amt <= 0) return toast.error('Enter a valid amount')
    if (amt > maxSettleable + 0.009) return toast.error(`Can't settle more than ${formatLKR(maxSettleable)} — that's the smaller of the two balances`)
    setSaving(true)
    try {
      const { error: custErr } = await supabase.rpc('adjust_customer_balance', { p_customer_id: link.customer_id, p_delta: -amt })
      if (custErr) throw custErr
      const { error: supErr } = await supabase.rpc('adjust_supplier_balance', { p_supplier_id: link.supplier_id, p_delta: -amt })
      if (supErr) throw supErr
      const { error: recErr } = await supabase.from('account_settlements').insert({
        link_id: link.id, customer_id: link.customer_id, supplier_id: link.supplier_id,
        amount: amt, notes: notes || null,
      })
      if (recErr) throw recErr

      toast.success(`${formatLKR(amt)} settled between the two accounts`)
      onSettled()
    } catch (e) { toast.error('Failed: ' + e.message) }
    setSaving(false)
  }

  const inp = { width: '100%', padding: '9px 12px', border: '1.5px solid #e2e8f0', borderRadius: '8px', fontSize: '13px', boxSizing: 'border-box' }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1100, padding: '20px' }}>
      <div style={{ background: 'white', borderRadius: '18px', padding: '24px', width: '100%', maxWidth: '420px' }}>
        <h3 style={{ fontSize: '16px', fontWeight: '800', margin: '0 0 4px' }}>Settle — {link.customers?.name}</h3>
        <p style={{ fontSize: '12px', color: '#64748b', margin: '0 0 16px' }}>
          Receivable {formatLKR(receivable)} · Payable {formatLKR(payable)} · Max settleable {formatLKR(maxSettleable)}
        </p>

        <div style={{ display: 'flex', gap: '8px', marginBottom: '14px' }}>
          <button onClick={() => setAmount(String(maxSettleable))}
            style={{ flex: 1, padding: '9px', borderRadius: '8px', border: '1.5px solid #059669', background: '#f0fdf4', color: '#059669', fontWeight: '700', fontSize: '13px', cursor: 'pointer' }}>
            Settle Full ({formatLKR(maxSettleable)})
          </button>
        </div>

        <label style={{ fontSize: '11px', fontWeight: '700', color: '#94a3b8', textTransform: 'uppercase' }}>Amount to Settle</label>
        <input type="number" style={{ ...inp, marginTop: '5px', marginBottom: '14px' }} value={amount} onChange={e => setAmount(e.target.value)} max={maxSettleable} />

        <label style={{ fontSize: '11px', fontWeight: '700', color: '#94a3b8', textTransform: 'uppercase' }}>Notes (optional)</label>
        <textarea style={{ ...inp, minHeight: '60px', marginTop: '5px', marginBottom: '18px' }} value={notes} onChange={e => setNotes(e.target.value)} />

        <div style={{ background: '#f8fafc', borderRadius: '10px', padding: '12px', marginBottom: '18px', fontSize: '12px', color: '#475569' }}>
          After this: Receivable {formatLKR(Math.max(0, receivable - (parseFloat(amount) || 0)))} · Payable {formatLKR(Math.max(0, payable - (parseFloat(amount) || 0)))}
        </div>

        <div style={{ display: 'flex', gap: '10px' }}>
          <button onClick={onClose} style={{ flex: 1, padding: '10px', background: '#f1f5f9', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: '700' }}>Cancel</button>
          <button onClick={handleSettle} disabled={saving} style={{ flex: 1, padding: '10px', background: '#059669', color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: '800' }}>{saving ? 'Settling...' : 'Confirm Settlement'}</button>
        </div>
      </div>
    </div>
  )
}

function HistoryModal({ data, onClose }) {
  const { link, records } = data
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.55)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '20px' }}>
      <div onClick={e => e.stopPropagation()} style={{ background: 'white', borderRadius: '18px', padding: '24px', width: '100%', maxWidth: '440px', maxHeight: '80vh', overflowY: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '14px' }}>
          <h3 style={{ fontSize: '16px', fontWeight: '800', margin: 0 }}>Settlement History — {link.customers?.name}</h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: '18px', cursor: 'pointer', color: '#94a3b8' }}>✕</button>
        </div>
        {records.length === 0 ? (
          <div style={{ padding: '30px', textAlign: 'center', color: '#94a3b8', fontSize: '13px' }}>No settlements yet.</div>
        ) : records.map(r => (
          <div key={r.id} style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 0', borderBottom: '1px solid #f1f5f9', fontSize: '13px' }}>
            <div>
              <div>{timeAgo(r.created_at)}</div>
              {r.notes && <div style={{ fontSize: '11px', color: '#94a3b8' }}>{r.notes}</div>}
            </div>
            <div style={{ fontWeight: '700', color: '#059669' }}>{formatLKR(r.amount)}</div>
          </div>
        ))}
      </div>
    </div>
  )
}
