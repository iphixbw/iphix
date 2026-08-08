import { useState, useEffect } from 'react'
import { supabase } from '../../supabase'
import { formatCurrency } from '../../lib/helpers'
import { sendSMS, smsTemplates } from '../../lib/sms'
import toast from 'react-hot-toast'

const TABS = [
  { id: 'compose', label: '✉️ Compose' },
  { id: 'bulk', label: '📣 Bulk SMS' },
  { id: 'reminders', label: '💰 Reminders' },
  { id: 'log', label: '📋 SMS Log' },
]

export default function SMSCentre({ session, activeShop }) {
  const [activeTab, setActiveTab] = useState('compose')

  // Compose state
  const [composePhone, setComposePhone] = useState('')
  const [composeMessage, setComposeMessage] = useState('')
  const [composeSending, setComposeSending] = useState(false)
  const [composeCustomerSearch, setComposeCustomerSearch] = useState('')
  const [composeCustomerResults, setComposeCustomerResults] = useState([])

  // Bulk state
  const [bulkCustomers, setBulkCustomers] = useState([])
  const [selectedBulk, setSelectedBulk] = useState([])
  const [bulkMessage, setBulkMessage] = useState('')
  const [bulkSending, setBulkSending] = useState(false)
  const [bulkProgress, setBulkProgress] = useState(null)

  // Reminders state
  const [reminderCustomers, setReminderCustomers] = useState([])
  const [selectedReminders, setSelectedReminders] = useState([])
  const [reminderSending, setReminderSending] = useState(false)
  const [reminderProgress, setReminderProgress] = useState(null)

  // Log state
  const [smsLog, setSmsLog] = useState([])
  const [logLoading, setLogLoading] = useState(false)
  const [logSearch, setLogSearch] = useState('')

  useEffect(() => {
    if (activeTab === 'bulk') fetchBulkCustomers()
    if (activeTab === 'reminders') fetchReminderCustomers()
    if (activeTab === 'log') fetchLog()
  }, [activeTab])

  async function searchCustomers(query) {
    if (!query.trim()) { setComposeCustomerResults([]); return }
    const { data } = await supabase.from('customers').select('id, name, customer_no, phone').ilike('name', `%${query}%`).limit(6)
    setComposeCustomerResults(data || [])
  }

  async function fetchBulkCustomers() {
    const { data } = await supabase.from('customers').select('id, name, customer_no, phone').not('phone', 'is', null).order('name')
    setBulkCustomers(data || [])
  }

  async function fetchReminderCustomers() {
    // If an active shop is set, scope to that shop's customers via invoices
    let query = supabase.from('customers').select('id, name, customer_no, phone, credit_balance').gt('credit_balance', 0).not('phone', 'is', null).order('credit_balance', { ascending: false })
    if (activeShop?.id) {
      // Get customer IDs with invoices in this shop
      const { data: shopInvs } = await supabase.from('invoices').select('customer_id').eq('shop_id', activeShop.id).eq('status', 'confirmed').gt('credit_amount', 0)
      const shopCustomerIds = [...new Set((shopInvs || []).map(i => i.customer_id).filter(Boolean))]
      if (shopCustomerIds.length > 0) {
        query = query.in('id', shopCustomerIds)
      } else {
        setReminderCustomers([])
        return
      }
    }
    const { data } = await query
    setReminderCustomers(data || [])
  }

  async function fetchLog() {
    setLogLoading(true)
    const { data } = await supabase.from('sms_log').select('*').order('created_at', { ascending: false }).limit(100)
    setSmsLog(data || [])
    setLogLoading(false)
  }

  // ── Compose ────────────────────────────────────────────
  async function handleCompose() {
    if (!composePhone.trim()) return toast.error('Enter a phone number')
    if (!composeMessage.trim()) return toast.error('Enter a message')
    setComposeSending(true)
    const { success } = await sendSMS({
      to: composePhone,
      message: composeMessage,
      triggeredBy: 'manual',
      userId: session?.user?.id,
    })
    if (success) {
      toast.success('SMS sent!')
      setComposeMessage('')
      setComposePhone('')
      setComposeCustomerSearch('')
    } else {
      toast.error('Failed to send SMS')
    }
    setComposeSending(false)
  }

  // ── Bulk ───────────────────────────────────────────────
  function toggleBulk(id) {
    setSelectedBulk(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])
  }

  function toggleAllBulk() {
    const withPhone = bulkCustomers.filter(c => c.phone)
    setSelectedBulk(selectedBulk.length === withPhone.length ? [] : withPhone.map(c => c.id))
  }

  async function sendBulkSMS() {
    if (selectedBulk.length === 0) return toast.error('Select at least one customer')
    if (!bulkMessage.trim()) return toast.error('Enter a message')
    setBulkSending(true)
    setBulkProgress({ sent: 0, failed: 0, total: selectedBulk.length })
    const targets = bulkCustomers.filter(c => selectedBulk.includes(c.id) && c.phone)
    let sent = 0, failed = 0
    for (const c of targets) {
      const { success } = await sendSMS({
        to: c.phone,
        message: bulkMessage,
        triggeredBy: 'bulk',
        referenceType: 'customer',
        referenceId: c.id,
        userId: session?.user?.id,
      })
      if (success) sent++; else failed++
      setBulkProgress({ sent, failed, total: targets.length })
      await new Promise(r => setTimeout(r, 300)) // rate limit
    }
    toast.success(`Sent: ${sent}, Failed: ${failed}`)
    setBulkSending(false)
    setSelectedBulk([])
    setBulkMessage('')
    setTimeout(() => setBulkProgress(null), 3000)
  }

  // ── Reminders ─────────────────────────────────────────
  function toggleReminder(id) {
    setSelectedReminders(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])
  }

  function toggleAllReminders() {
    setSelectedReminders(selectedReminders.length === reminderCustomers.length ? [] : reminderCustomers.map(c => c.id))
  }

  async function sendReminders() {
    if (selectedReminders.length === 0) return toast.error('Select at least one customer')
    setReminderSending(true)
    setReminderProgress({ sent: 0, failed: 0, total: selectedReminders.length })
    const targets = reminderCustomers.filter(c => selectedReminders.includes(c.id))
    let sent = 0, failed = 0
    for (const c of targets) {
      const msg = smsTemplates.paymentReminder(c.name, c.credit_balance, activeShop?.name || 'iPHIX Technologies')
      const { success } = await sendSMS({
        to: c.phone,
        message: msg,
        triggeredBy: 'reminder',
        referenceType: 'customer',
        referenceId: c.id,
        userId: session?.user?.id,
      })
      if (success) sent++; else failed++
      setReminderProgress({ sent, failed, total: targets.length })
      await new Promise(r => setTimeout(r, 300))
    }
    toast.success(`Sent: ${sent}, Failed: ${failed}`)
    setReminderSending(false)
    setSelectedReminders([])
    setTimeout(() => setReminderProgress(null), 3000)
  }

  const filteredLog = smsLog.filter(l =>
    !logSearch || l.recipient?.includes(logSearch) || l.message?.toLowerCase().includes(logSearch.toLowerCase())
  )

  const inp = { width: '100%', padding: '10px 12px', border: '1.5px solid #e2e8f0', borderRadius: '10px', fontSize: '14px', boxSizing: 'border-box', outline: 'none', background: 'white' }
  const lbl = { display: 'block', marginBottom: '6px', fontSize: '11px', fontWeight: '700', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.06em' }
  const card = { background: 'white', borderRadius: '12px', padding: '24px', boxShadow: '0 1px 3px rgba(15,23,42,0.06), 0 1px 2px rgba(15,23,42,0.04)', marginBottom: '16px' }

  return (
    <div>
      {/* Header */}
      <div style={{ marginBottom: '24px' }}>
        <h1 style={{ fontSize: '22px', fontWeight: '700', color: '#0f172a', margin: '0 0 4px' }}>SMS Centre</h1>
        <p style={{ color: '#64748b', fontSize: '14px', margin: 0 }}>Send messages to customers via text.lk</p>
      </div>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: '4px', marginBottom: '24px', background: '#f1f5f9', padding: '4px', borderRadius: '10px', width: 'fit-content', flexWrap: 'wrap' }}>
        {TABS.map(tab => (
          <button key={tab.id} onClick={() => setActiveTab(tab.id)}
            style={{ padding: '8px 18px', borderRadius: '10px', border: 'none', cursor: 'pointer', fontSize: '13px', fontWeight: '600', background: activeTab === tab.id ? 'white' : 'transparent', color: activeTab === tab.id ? '#0f172a' : '#64748b', boxShadow: activeTab === tab.id ? '0 1px 3px rgba(0,0,0,0.1)' : 'none', whiteSpace: 'nowrap' }}>
            {tab.label}
          </button>
        ))}
      </div>

      {/* ── COMPOSE TAB ── */}
      {activeTab === 'compose' && (
        <div style={{ maxWidth: '600px' }}>
          <div style={card}>
            <h2 style={{ fontSize: '16px', fontWeight: '700', color: '#0f172a', margin: '0 0 20px' }}>Send a Message</h2>

            {/* Customer search */}
            <div style={{ marginBottom: '16px' }}>
              <label style={lbl}>Search Customer (optional)</label>
              <div style={{ position: 'relative' }}>
                <input type="text" placeholder="Search by name…" value={composeCustomerSearch}
                  onChange={e => { setComposeCustomerSearch(e.target.value); searchCustomers(e.target.value) }}
                  onBlur={() => setTimeout(() => setComposeCustomerResults([]), 180)}
                  style={inp} />
                {composeCustomerResults.length > 0 && (
                  <div style={{ position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0, background: 'white', border: '1.5px solid #e2e8f0', borderRadius: '10px', boxShadow: '0 8px 24px rgba(0,0,0,0.12)', zIndex: 100 }}>
                    {composeCustomerResults.map(c => (
                      <div key={c.id} onMouseDown={() => {
                        setComposePhone(c.phone || '')
                        setComposeCustomerSearch(c.name)
                        setComposeCustomerResults([])
                      }} style={{ padding: '10px 14px', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid #f8fafc', fontSize: '14px' }}
                        onMouseEnter={e => e.currentTarget.style.background = '#f8fafc'}
                        onMouseLeave={e => e.currentTarget.style.background = 'white'}>
                        <span><span style={{ fontWeight: '700', color: '#2563eb', marginRight: '8px', fontSize: '12px' }}>{c.customer_no}</span>{c.name}</span>
                        <span style={{ fontSize: '12px', color: '#94a3b8' }}>{c.phone || 'No phone'}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div style={{ marginBottom: '16px' }}>
              <label style={lbl}>Phone Number *</label>
              <input type="text" placeholder="07X XXX XXXX or 94XXXXXXXXX" value={composePhone} onChange={e => setComposePhone(e.target.value)} style={inp} />
              <div style={{ fontSize: '12px', color: '#94a3b8', marginTop: '4px' }}>Will be auto-formatted to 94XXXXXXXXX</div>
            </div>

            <div style={{ marginBottom: '16px' }}>
              <label style={lbl}>Message *</label>
              <textarea value={composeMessage} onChange={e => setComposeMessage(e.target.value)}
                placeholder="Type your message here…" rows={5}
                style={{ ...inp, resize: 'vertical', lineHeight: '1.6' }} />
              <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '4px' }}>
                <div style={{ fontSize: '12px', color: '#94a3b8' }}>{composeMessage.length} characters</div>
                <div style={{ fontSize: '12px', color: composeMessage.length > 160 ? '#d97706' : '#94a3b8' }}>
                  {Math.ceil(composeMessage.length / 160)} SMS credit{Math.ceil(composeMessage.length / 160) !== 1 ? 's' : ''}
                </div>
              </div>
            </div>

            {/* Quick templates */}
            <div style={{ marginBottom: '20px' }}>
              <label style={lbl}>Quick Templates</label>
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                {[
                  { label: 'Payment Reminder', msg: smsTemplates.paymentReminder('Customer', 0, activeShop?.name || 'iPHIX Technologies') },
                  { label: 'Invoice Confirmed', msg: smsTemplates.invoiceConfirmed('INV-00001', 0, activeShop?.name || 'iPHIX Technologies') },
                  { label: 'Payment Received', msg: smsTemplates.paymentReceived(0, 'INV-00001', activeShop?.name || 'iPHIX Technologies') },
                ].map(t => (
                  <button key={t.label} onClick={() => setComposeMessage(t.msg)}
                    style={{ padding: '6px 12px', background: '#eef2ff', color: '#2563eb', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '12px', fontWeight: '600' }}>
                    {t.label}
                  </button>
                ))}
              </div>
            </div>

            <button onClick={handleCompose} disabled={composeSending}
              style={{ width: '100%', padding: '12px', background: composeSending ? '#93c5fd' : 'linear-gradient(135deg,#2563eb,#1d4ed8)', color: 'white', border: 'none', borderRadius: '10px', cursor: composeSending ? 'not-allowed' : 'pointer', fontWeight: '700', fontSize: '15px' }}>
              {composeSending ? 'Sending...' : '📤 Send SMS'}
            </button>
          </div>
        </div>
      )}

      {/* ── BULK TAB ── */}
      {activeTab === 'bulk' && (
        <div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
            {/* Customer selector */}
            <div style={card}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
                <h2 style={{ fontSize: '15px', fontWeight: '700', color: '#0f172a', margin: 0 }}>Select Customers</h2>
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                  <span style={{ fontSize: '12px', color: '#94a3b8' }}>{selectedBulk.length} selected</span>
                  <button onClick={toggleAllBulk}
                    style={{ padding: '4px 12px', background: '#eef2ff', color: '#2563eb', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '12px', fontWeight: '700' }}>
                    {selectedBulk.length === bulkCustomers.filter(c => c.phone).length ? 'Deselect All' : 'Select All'}
                  </button>
                </div>
              </div>
              <div style={{ maxHeight: '400px', overflowY: 'auto' }}>
                {bulkCustomers.map(c => (
                  <div key={c.id} onClick={() => c.phone && toggleBulk(c.id)}
                    style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '8px 4px', borderBottom: '1px solid #f8fafc', cursor: c.phone ? 'pointer' : 'default', opacity: c.phone ? 1 : 0.4 }}>
                    <input type="checkbox" checked={selectedBulk.includes(c.id)} onChange={() => {}} readOnly
                      style={{ accentColor: '#2563eb', cursor: 'pointer' }} />
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: '13px', fontWeight: '600', color: '#0f172a' }}>{c.name}</div>
                      <div style={{ fontSize: '12px', color: '#94a3b8' }}>{c.phone || 'No phone number'}</div>
                    </div>
                  </div>
                ))}
                {bulkCustomers.length === 0 && <div style={{ padding: '20px', textAlign: 'center', color: '#94a3b8', fontSize: '14px' }}>No customers with phone numbers</div>}
              </div>
            </div>

            {/* Message */}
            <div>
              <div style={card}>
                <h2 style={{ fontSize: '15px', fontWeight: '700', color: '#0f172a', margin: '0 0 16px' }}>Message</h2>
                <textarea value={bulkMessage} onChange={e => setBulkMessage(e.target.value)}
                  placeholder="Type your bulk message here…" rows={8}
                  style={{ ...inp, resize: 'vertical', lineHeight: '1.6', marginBottom: '8px' }} />
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '16px' }}>
                  <span style={{ fontSize: '12px', color: '#94a3b8' }}>{bulkMessage.length} chars</span>
                  <span style={{ fontSize: '12px', color: bulkMessage.length > 160 ? '#d97706' : '#94a3b8' }}>{Math.ceil(bulkMessage.length / 160) || 1} credit{Math.ceil(bulkMessage.length / 160) !== 1 ? 's' : ''} × {selectedBulk.length} customers</span>
                </div>

                {bulkProgress && (
                  <div style={{ marginBottom: '16px', padding: '12px', background: '#f0fdf4', borderRadius: '10px', border: '1px solid #bbf7d0' }}>
                    <div style={{ fontSize: '13px', fontWeight: '700', color: '#166534', marginBottom: '6px' }}>
                      Sending... {bulkProgress.sent + bulkProgress.failed}/{bulkProgress.total}
                    </div>
                    <div style={{ background: '#e2e8f0', borderRadius: '4px', height: '6px', overflow: 'hidden' }}>
                      <div style={{ height: '100%', background: 'linear-gradient(135deg,#2563eb,#1d4ed8)', borderRadius: '4px', width: `${((bulkProgress.sent + bulkProgress.failed) / bulkProgress.total) * 100}%`, transition: 'width 0.3s' }} />
                    </div>
                    <div style={{ fontSize: '12px', color: '#64748b', marginTop: '4px' }}>✓ {bulkProgress.sent} sent · ✗ {bulkProgress.failed} failed</div>
                  </div>
                )}

                <button onClick={sendBulkSMS} disabled={bulkSending || selectedBulk.length === 0}
                  style={{ width: '100%', padding: '12px', background: bulkSending || selectedBulk.length === 0 ? '#93c5fd' : 'linear-gradient(135deg,#2563eb,#1d4ed8)', color: 'white', border: 'none', borderRadius: '10px', cursor: bulkSending || selectedBulk.length === 0 ? 'not-allowed' : 'pointer', fontWeight: '700', fontSize: '15px' }}>
                  {bulkSending ? `Sending ${bulkProgress?.sent + bulkProgress?.failed || 0}/${bulkProgress?.total || selectedBulk.length}...` : `📣 Send to ${selectedBulk.length} Customer${selectedBulk.length !== 1 ? 's' : ''}`}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── REMINDERS TAB ── */}
      {activeTab === 'reminders' && (
        <div>
          <div style={{ background: '#fef3c7', border: '1px solid #fde68a', borderRadius: '10px', padding: '14px 16px', marginBottom: '20px', fontSize: '13px', color: '#92400e' }}>
            💡 This sends personalised payment reminder messages to customers with outstanding balances. Each message includes their name, balance amount and your shop name.
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
            <div style={card}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
                <h2 style={{ fontSize: '15px', fontWeight: '700', color: '#0f172a', margin: 0 }}>Customers with Balance</h2>
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                  <span style={{ fontSize: '12px', color: '#94a3b8' }}>{selectedReminders.length} selected</span>
                  <button onClick={toggleAllReminders}
                    style={{ padding: '4px 12px', background: '#eef2ff', color: '#2563eb', border: 'none', borderRadius: '6px', cursor: 'pointer', fontSize: '12px', fontWeight: '700' }}>
                    {selectedReminders.length === reminderCustomers.length ? 'Deselect All' : 'Select All'}
                  </button>
                </div>
              </div>
              <div style={{ maxHeight: '420px', overflowY: 'auto' }}>
                {reminderCustomers.length === 0 ? (
                  <div style={{ padding: '32px', textAlign: 'center', color: '#94a3b8' }}>
                    <div style={{ fontSize: '28px', marginBottom: '8px' }}>✅</div>
                    No outstanding balances with phone numbers
                  </div>
                ) : reminderCustomers.map(c => (
                  <div key={c.id} onClick={() => toggleReminder(c.id)}
                    style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 4px', borderBottom: '1px solid #f8fafc', cursor: 'pointer' }}
                    onMouseEnter={e => e.currentTarget.style.background = '#f8fafc'}
                    onMouseLeave={e => e.currentTarget.style.background = 'white'}>
                    <input type="checkbox" checked={selectedReminders.includes(c.id)} onChange={() => {}} readOnly style={{ accentColor: '#2563eb', cursor: 'pointer' }} />
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: '13px', fontWeight: '600', color: '#0f172a' }}>{c.name}</div>
                      <div style={{ fontSize: '12px', color: '#94a3b8' }}>{c.phone}</div>
                    </div>
                    <div style={{ fontSize: '14px', fontWeight: '800', color: '#e11d48' }}>{formatCurrency(c.credit_balance)}</div>
                  </div>
                ))}
              </div>
            </div>

            <div>
              <div style={card}>
                <h2 style={{ fontSize: '15px', fontWeight: '700', color: '#0f172a', margin: '0 0 14px' }}>Message Preview</h2>
                <div style={{ padding: '14px', background: '#f8fafc', borderRadius: '10px', fontSize: '13px', color: '#374151', lineHeight: '1.6', marginBottom: '16px', border: '1px solid #e2e8f0', fontStyle: 'italic' }}>
                  {smsTemplates.paymentReminder(
                    reminderCustomers.find(c => selectedReminders.includes(c.id))?.name || 'Customer Name',
                    reminderCustomers.find(c => selectedReminders.includes(c.id))?.credit_balance || 0,
                    activeShop?.name || 'iPHIX Technologies'
                  )}
                </div>
                <div style={{ fontSize: '12px', color: '#94a3b8', marginBottom: '16px' }}>
                  Each message is personalised with the customer's name and exact balance.
                </div>

                {reminderProgress && (
                  <div style={{ marginBottom: '16px', padding: '12px', background: '#f0fdf4', borderRadius: '10px', border: '1px solid #bbf7d0' }}>
                    <div style={{ fontSize: '13px', fontWeight: '700', color: '#166534', marginBottom: '6px' }}>
                      Sending... {reminderProgress.sent + reminderProgress.failed}/{reminderProgress.total}
                    </div>
                    <div style={{ background: '#e2e8f0', borderRadius: '4px', height: '6px', overflow: 'hidden' }}>
                      <div style={{ height: '100%', background: 'linear-gradient(135deg,#059669,#047857)', borderRadius: '4px', width: `${((reminderProgress.sent + reminderProgress.failed) / reminderProgress.total) * 100}%`, transition: 'width 0.3s' }} />
                    </div>
                    <div style={{ fontSize: '12px', color: '#64748b', marginTop: '4px' }}>✓ {reminderProgress.sent} sent · ✗ {reminderProgress.failed} failed</div>
                  </div>
                )}

                <button onClick={sendReminders} disabled={reminderSending || selectedReminders.length === 0}
                  style={{ width: '100%', padding: '12px', background: reminderSending || selectedReminders.length === 0 ? '#93c5fd' : 'linear-gradient(135deg,#059669,#047857)', color: 'white', border: 'none', borderRadius: '10px', cursor: reminderSending || selectedReminders.length === 0 ? 'not-allowed' : 'pointer', fontWeight: '700', fontSize: '15px' }}>
                  {reminderSending ? `Sending ${reminderProgress?.sent + reminderProgress?.failed || 0}/${reminderProgress?.total || selectedReminders.length}...` : `💰 Send ${selectedReminders.length} Reminder${selectedReminders.length !== 1 ? 's' : ''}`}
                </button>
              </div>

              <div style={{ ...card, background: '#f0fdf4', border: '1px solid #bbf7d0' }}>
                <div style={{ fontSize: '13px', fontWeight: '700', color: '#166534', marginBottom: '8px' }}>Total Outstanding Selected</div>
                <div style={{ fontSize: '24px', fontWeight: '800', color: '#059669' }}>
                  {formatCurrency(reminderCustomers.filter(c => selectedReminders.includes(c.id)).reduce((s, c) => s + (c.credit_balance || 0), 0))}
                </div>
                <div style={{ fontSize: '12px', color: '#94a3b8', marginTop: '4px' }}>{selectedReminders.length} customer{selectedReminders.length !== 1 ? 's' : ''}</div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── LOG TAB ── */}
      {activeTab === 'log' && (
        <div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: '16px', marginBottom: '20px' }}>
            {[
              { label: 'Total Sent', value: smsLog.filter(l => l.status === 'sent').length, color: '#059669' },
              { label: 'Failed', value: smsLog.filter(l => l.status === 'failed').length, color: '#e11d48' },
              { label: 'Last 100 Messages', value: smsLog.length, color: '#1e40af' },
            ].map(s => (
              <div key={s.label} style={{ background: 'white', borderRadius: '12px', padding: '18px', boxShadow: '0 1px 3px rgba(15,23,42,0.06), 0 1px 2px rgba(15,23,42,0.04)', borderLeft: `4px solid ${s.color}` }}>
                <div style={{ fontSize: '11px', fontWeight: '700', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '6px' }}>{s.label}</div>
                <div style={{ fontSize: '22px', fontWeight: '800', color: s.color }}>{s.value}</div>
              </div>
            ))}
          </div>

          <div style={{ marginBottom: '16px' }}>
            <input type="text" placeholder="Search by number or message…" value={logSearch} onChange={e => setLogSearch(e.target.value)}
              style={{ ...inp, maxWidth: '400px' }} />
          </div>

          <div style={{ background: 'white', borderRadius: '12px', boxShadow: '0 1px 3px rgba(15,23,42,0.06), 0 1px 2px rgba(15,23,42,0.04)', overflow: 'hidden' }}>
            {logLoading ? <div style={{ padding: '40px', textAlign: 'center', color: '#94a3b8' }}>Loading...</div>
            : filteredLog.length === 0 ? (
              <div style={{ padding: '40px', textAlign: 'center', color: '#94a3b8' }}>
                <div style={{ fontSize: '32px', marginBottom: '8px' }}>📋</div>
                No SMS records yet
              </div>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ background: '#f8fafc', borderBottom: '2px solid #e2e8f0' }}>
                    {['Date & Time', 'Recipient', 'Message', 'Type', 'Status'].map(h => (
                      <th key={h} style={{ padding: '10px 14px', textAlign: 'left', fontSize: '11px', fontWeight: '700', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.06em', whiteSpace: 'nowrap' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filteredLog.map((log, i) => (
                    <tr key={log.id} style={{ borderBottom: '1px solid #f1f5f9', background: i % 2 === 0 ? 'white' : '#fafafa' }}>
                      <td style={{ padding: '10px 14px', fontSize: '12px', color: '#64748b', whiteSpace: 'nowrap' }}>
                        {new Date(log.created_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}
                        <div style={{ color: '#94a3b8' }}>{new Date(log.created_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</div>
                      </td>
                      <td style={{ padding: '10px 14px', fontSize: '13px', fontFamily: 'monospace', color: '#0f172a', fontWeight: '600' }}>{log.recipient}</td>
                      <td style={{ padding: '10px 14px', fontSize: '13px', color: '#374151', maxWidth: '300px' }}>
                        <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{log.message}</div>
                      </td>
                      <td style={{ padding: '10px 14px' }}>
                        <span style={{ background: '#f1f5f9', color: '#475569', padding: '2px 8px', borderRadius: '12px', fontSize: '11px', fontWeight: '600', textTransform: 'capitalize' }}>
                          {log.triggered_by || 'manual'}
                        </span>
                      </td>
                      <td style={{ padding: '10px 14px' }}>
                        <span style={{ background: log.status === 'sent' ? '#dcfce7' : '#fee2e2', color: log.status === 'sent' ? '#166534' : '#991b1b', padding: '3px 8px', borderRadius: '12px', fontSize: '11px', fontWeight: '700' }}>
                          {log.status === 'sent' ? '✓ Sent' : '✗ Failed'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
