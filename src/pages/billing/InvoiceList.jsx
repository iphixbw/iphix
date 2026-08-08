import { useState, useEffect } from 'react'
import { supabase } from '../../supabase'
import { formatCurrency } from '../../lib/helpers'
import toast from 'react-hot-toast'

export default function InvoiceList({ onNewInvoice, onOpenInvoice, activeShop }) {
  const [invoices, setInvoices] = useState([])
  const [loading, setLoading] = useState(true)
  const PAGE_SIZE = 50
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [paymentFilter, setPaymentFilter] = useState('all')
  const [salesmanFilter, setSalesmanFilter] = useState('all')
  const [dateFrom, setDateFrom] = useState(() => { const d = new Date(); d.setDate(1); return d.toISOString().split('T')[0] })
  const [dateTo, setDateTo] = useState(() => new Date().toISOString().split('T')[0])
  const [salesmen, setSalesmen] = useState([])

  useEffect(() => { fetchInvoices() }, [activeShop?.id])

  async function fetchInvoices() {
    setLoading(true)
    let query = supabase
      .from('invoices')
      .select('*, customers(name, customer_no), salesmen(name), shops(name), invoice_payments(amount), sales_returns(total, payment_method, status)')
      .order('created_at', { ascending: false })
    if (activeShop?.id) query = query.eq('shop_id', activeShop.id)
    const [{ data, error }, { data: smens }] = await Promise.all([
      query,
      supabase.from('salesmen').select('id, name').order('name'),
    ])
    if (error) toast.error('Failed to load invoices')
    else setInvoices(data || [])
    setSalesmen(smens || [])
    setLoading(false)
  }

  // Credit due net of payments received and credit-method returns linked to the invoice.
  // Cash-refunded returns don't reduce what's owed — that money went back as cash, not credit.
  function creditDue(inv) {
    const paid = (inv.invoice_payments || []).reduce((s, p) => s + p.amount, 0)
    const creditRets = (inv.sales_returns || [])
      .filter(r => r.status === 'confirmed' && (r.payment_method === 'credit' || !r.payment_method))
      .reduce((s, r) => s + (r.total || 0), 0)
    return Math.max(0, (inv.credit_amount || 0) - paid - creditRets)
  }

  async function deleteInvoice(id) {
    if (!window.confirm('Delete this draft invoice?')) return
    const { error } = await supabase.from('invoices').delete().eq('id', id)
    if (error) toast.error('Failed to delete')
    else { toast.success('Draft deleted'); fetchInvoices() }
  }

  const filtered = invoices.filter(inv => {
    const matchSearch = !search ||
      inv.invoice_no.toLowerCase().includes(search.toLowerCase()) ||
      (inv.customers?.name || '').toLowerCase().includes(search.toLowerCase()) ||
      (inv.customers?.customer_no || '').toLowerCase().includes(search.toLowerCase())
    const matchStatus = statusFilter === 'all' || inv.status === statusFilter
    const matchPayment = paymentFilter === 'all' || inv.payment_method === paymentFilter
    const matchSalesman = salesmanFilter === 'all' || inv.salesmen?.name === salesmanFilter
    const matchFrom = !dateFrom || new Date(inv.created_at) >= new Date(dateFrom)
    const matchTo = !dateTo || new Date(inv.created_at) <= new Date(dateTo + 'T23:59:59')
    return matchSearch && matchStatus && matchPayment && matchSalesman && matchFrom && matchTo
  })
  const filteredPaged = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)
  const totalPages = Math.ceil(filtered.length / PAGE_SIZE)

  const totalValue = filtered.filter(inv => inv.status !== 'cancelled').reduce((sum, inv) => sum + (inv.total || 0), 0)
  const totalCredit = filtered.filter(inv => inv.status !== 'cancelled').reduce((sum, inv) => sum + creditDue(inv), 0)

  const statusBadge = (status) => {
    const map = {
      draft: { bg: '#fef3c7', color: '#92400e', label: 'Draft' },
      confirmed: { bg: '#dcfce7', color: '#166534', label: 'Confirmed' },
      cancelled: { bg: '#fee2e2', color: '#991b1b', label: 'Cancelled' },
    }
    const s = map[status] || map.draft
    return (
      <span style={{ background: s.bg, color: s.color, padding: '3px 10px', borderRadius: '20px', fontSize: '12px', fontWeight: '700' }}>
        {s.label}
      </span>
    )
  }

  const paymentBadge = (method) => {
    const map = { cash: '#059669', card: '#2563eb', cheque: '#d97706', bank_transfer: '#0369a1', credit: '#e11d48', partial: '#7c3aed' }
    const labels = { cash: 'Cash', card: 'Card', cheque: 'Cheque', bank_transfer: 'Bank Transfer', credit: 'Credit', partial: 'Partial' }
    return <span style={{ color: map[method] || '#64748b', fontWeight: '600', fontSize: '13px' }}>{labels[method] || method}</span>
  }

  const inp = { padding: '9px 12px', border: '1.5px solid #e2e8f0', borderRadius: '7px', fontSize: '14px', outline: 'none', background: 'white' }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '24px' }}>
        <div>
          <h1 style={{ fontSize: '22px', fontWeight: '700', color: '#0f172a', margin: '0 0 4px' }}>Invoices</h1>
          <p style={{ color: '#64748b', fontSize: '14px', margin: 0 }}>{filtered.length} invoice{filtered.length !== 1 ? 's' : ''}</p>
        </div>
        <button onClick={onNewInvoice}
          style={{ padding: '10px 24px', background: 'linear-gradient(135deg,#2563eb,#1d4ed8)', color: 'white', border: 'none', borderRadius: '10px', cursor: 'pointer', fontWeight: '700', fontSize: '14px' }}>
          + New Invoice
        </button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '16px', marginBottom: '24px' }}>
        {[
          { label: 'Total Value', value: formatCurrency(totalValue), color: '#1e40af' },
          { label: 'Total Credit Due', value: formatCurrency(totalCredit), color: '#e11d48' },
          { label: 'Drafts Open', value: invoices.filter(i => i.status === 'draft').length, color: '#d97706' },
        ].map(s => (
          <div key={s.label} style={{ background: 'white', borderRadius: '12px', padding: '20px', boxShadow: '0 1px 3px rgba(15,23,42,0.06), 0 1px 2px rgba(15,23,42,0.04)', borderLeft: `4px solid ${s.color}` }}>
            <div style={{ fontSize: '12px', fontWeight: '700', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '6px' }}>{s.label}</div>
            <div style={{ fontSize: '22px', fontWeight: '800', color: s.color }}>{s.value}</div>
          </div>
        ))}
      </div>

      <div style={{ background: 'white', borderRadius: '12px', padding: '16px 20px', boxShadow: '0 1px 3px rgba(15,23,42,0.06), 0 1px 2px rgba(15,23,42,0.04)', marginBottom: '16px', display: 'flex', gap: '12px', flexWrap: 'wrap', alignItems: 'center' }}>
        <input type="text" placeholder="Search invoice no, customer…" value={search}
          onChange={e => setSearch(e.target.value)} style={{ ...inp, flex: 1, minWidth: '200px' }} />
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} style={inp}>
          <option value="all">All Status</option>
          <option value="draft">Draft</option>
          <option value="confirmed">Confirmed</option>
          <option value="cancelled">Cancelled</option>
        </select>
        <select value={paymentFilter} onChange={e => setPaymentFilter(e.target.value)} style={inp}>
          <option value="all">All Payments</option>
          <option value="cash">Cash</option>
          <option value="card">Card</option>
          <option value="cheque">Cheque</option>
          <option value="bank_transfer">Bank Transfer</option>
          <option value="credit">Credit</option>
          <option value="partial">Partial</option>
        </select>
        <select value={salesmanFilter} onChange={e => setSalesmanFilter(e.target.value)} style={inp}>
          <option value="all">All Salesmen</option>
          {salesmen.map(s => <option key={s.id} value={s.name}>{s.name}</option>)}
        </select>
        <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} style={inp} title="From date" />
        <span style={{ color: '#94a3b8', fontSize: '13px' }}>to</span>
        <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} style={inp} title="To date" />
        {(search || statusFilter !== 'all' || paymentFilter !== 'all' || salesmanFilter !== 'all' || dateFrom || dateTo) && (
          <button onClick={() => { setSearch(''); setStatusFilter('all'); setPaymentFilter('all'); setSalesmanFilter('all'); setDateFrom(''); setDateTo('') }}
            style={{ padding: '9px 16px', background: '#f1f5f9', color: '#64748b', border: 'none', borderRadius: '7px', cursor: 'pointer', fontSize: '13px', fontWeight: '600' }}>
            Clear
          </button>
        )}
      </div>

      <div style={{ background: 'white', borderRadius: '12px', boxShadow: '0 1px 3px rgba(15,23,42,0.06), 0 1px 2px rgba(15,23,42,0.04)', overflow: 'hidden' }}>
        {loading ? (
          <div style={{ padding: '60px', textAlign: 'center', color: '#94a3b8' }}>Loading...</div>
        ) : filtered.length === 0 ? (
          <div style={{ padding: '60px', textAlign: 'center', color: '#94a3b8' }}>
            <div style={{ fontSize: '36px', marginBottom: '12px' }}>🧾</div>
            No invoices found
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: '#f8fafc', borderBottom: '2px solid #e2e8f0' }}>
                {['Invoice No', 'Date', 'Customer', 'Salesman', 'Shop', 'Total', 'Payment', 'Credit Due', 'Status', 'Actions'].map(h => (
                  <th key={h} style={{ padding: '11px 14px', textAlign: 'left', fontSize: '11px', fontWeight: '700', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.06em', whiteSpace: 'nowrap' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filteredPaged.map((inv, i) => (
                <tr key={inv.id} style={{ borderBottom: '1px solid #f1f5f9', background: i % 2 === 0 ? 'white' : '#fafafa' }}
                  onMouseEnter={e => e.currentTarget.style.background = '#f0f9ff'}
                  onMouseLeave={e => e.currentTarget.style.background = i % 2 === 0 ? 'white' : '#fafafa'}>
                  <td style={{ padding: '12px 14px' }}>
                    <span style={{ fontWeight: '700', color: '#2563eb', fontSize: '13px' }}>{inv.invoice_no}</span>
                  </td>
                  <td style={{ padding: '12px 14px', fontSize: '13px', color: '#64748b', whiteSpace: 'nowrap' }}>
                    {new Date(inv.created_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}
                  </td>
                  <td style={{ padding: '12px 14px' }}>
                    <div style={{ fontSize: '14px', fontWeight: '600', color: '#0f172a' }}>{inv.customers?.name || '—'}</div>
                    <div style={{ fontSize: '12px', color: '#94a3b8' }}>{inv.customers?.customer_no}</div>
                  </td>
                  <td style={{ padding: '12px 14px', fontSize: '13px', color: '#64748b' }}>{inv.salesmen?.name || '—'}</td>
                  <td style={{ padding: '12px 14px', fontSize: '13px', color: '#64748b' }}>{inv.shops?.name || '—'}</td>
                  <td style={{ padding: '12px 14px', fontSize: '14px', fontWeight: '700', color: '#0f172a', whiteSpace: 'nowrap' }}>{formatCurrency(inv.total)}</td>
                  <td style={{ padding: '12px 14px' }}>{paymentBadge(inv.payment_method)}</td>
                  <td style={{ padding: '12px 14px', fontSize: '13px', fontWeight: '700', color: creditDue(inv) > 0 ? '#e11d48' : '#94a3b8', whiteSpace: 'nowrap' }}>
                    {creditDue(inv) > 0 ? formatCurrency(creditDue(inv)) : '—'}
                  </td>
                  <td style={{ padding: '12px 14px' }}>{statusBadge(inv.status)}</td>
                  <td style={{ padding: '12px 14px' }}>
                    <div style={{ display: 'flex', gap: '6px' }}>
                      <button onClick={() => onOpenInvoice(inv)}
                        style={{ padding: '5px 12px', background: '#eef2ff', color: '#2563eb', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '12px', fontWeight: '700' }}>
                        View
                      </button>
                      {inv.status === 'draft' && (
                        <button onClick={() => deleteInvoice(inv.id)}
                          style={{ padding: '5px 10px', background: '#fee2e2', color: '#dc2626', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '12px', fontWeight: '700' }}>
                          Delete
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
