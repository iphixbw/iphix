// ── Repair Division — shared constants & helpers ──────────────
import { supabase } from '../supabase'

export const JOB_STATUSES = [
  { id: 'received', label: 'Received', color: '#64748b', bg: '#f1f5f9' },
  { id: 'diagnosing', label: 'Diagnosing', color: '#7c3aed', bg: '#f5f3ff' },
  { id: 'waiting_approval', label: 'Waiting for Approval', color: '#d97706', bg: '#fffbeb' },
  { id: 'waiting_parts', label: 'Waiting for Parts', color: '#ea580c', bg: '#fff7ed' },
  { id: 'in_progress', label: 'Repair In Progress', color: '#2563eb', bg: '#eff6ff' },
  { id: 'testing', label: 'Testing', color: '#0891b2', bg: '#ecfeff' },
  { id: 'ready', label: 'Ready for Collection', color: '#059669', bg: '#f0fdf4' },
  { id: 'collected', label: 'Collected', color: '#166534', bg: '#dcfce7' },
  { id: 'cancelled', label: 'Cancelled', color: '#94a3b8', bg: '#f8fafc' },
  { id: 'returned_unrepaired', label: 'Returned Unrepaired', color: '#e11d48', bg: '#fff1f2' },
  { id: 'voided', label: 'Voided', color: '#991b1b', bg: '#fef2f2' },
]

export function statusMeta(id) {
  return JOB_STATUSES.find(s => s.id === id) || JOB_STATUSES[0]
}

// Item 1: a job marked "Collected" with money still owed needs to stand out —
// overrides the normal status badge color to red/urgent regardless of status color.
export function isCollectedWithDue(job) {
  return job.status === 'collected' && (job.balance_due || 0) > 0
}

export const PRIORITIES = [
  { id: 'low', label: 'Low', color: '#64748b', bg: '#f1f5f9' },
  { id: 'medium', label: 'Medium', color: '#2563eb', bg: '#eff6ff' },
  { id: 'high', label: 'High', color: '#d97706', bg: '#fffbeb' },
  { id: 'urgent', label: 'Urgent', color: '#e11d48', bg: '#fff1f2' },
]

export function priorityMeta(id) {
  return PRIORITIES.find(p => p.id === id) || PRIORITIES[1]
}

export const ACCESSORY_OPTIONS = ['SIM', 'Memory Card', 'Case', 'Dock', 'None']

export const CONDITION_OPTIONS = [
  'Cracked Screen', 'Water Damage', 'No Power', 'Back Glass Broken',
  'Camera Fault', 'Speaker Fault', 'Charging Issue',
  'Mic Fault', 'Battery Fault', 'Display Issue', 'Auto Restart',
  'Wifi/Bluetooth Connectivity Issue', 'No Service',
  'Software Issue', 'Finger-print Issue', 'Button Issue',
]

export const PART_CATEGORIES = [
  'Displays', 'Batteries', 'Charging Ports', 'ICs', 'Camera Modules',
  'Back Glass', 'Housing', 'Flex Cables', 'Buttons', 'Speakers',
  'Microphones', 'Tools', 'Consumables', 'Accessories',
]

export const CHARGE_TYPES = [
  { id: 'labour', label: 'Repair Labour' },
  { id: 'diagnosis', label: 'Diagnosis Fee' },
  { id: 'cleaning', label: 'Cleaning Fee' },
  { id: 'software', label: 'Software Charge' },
  { id: 'unlock', label: 'Unlock Charge' },
  { id: 'other', label: 'Other Charges' },
]

export function formatLKR(n) {
  return 'LKR ' + (parseFloat(n) || 0).toLocaleString('en-LK', { minimumFractionDigits: 2 })
}

export function timeAgo(dateStr) {
  const d = new Date(dateStr)
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) +
    ' ' + d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
}

// ── Job intake receipt — printed at drop-off, given to the customer ──
// job: the repair_jobs row. customer: the linked repair_customers row.
export async function printJobReceipt(job, customer) {
  const w = window.open('', '_blank')
  const fmt2 = n => (parseFloat(n) || 0).toLocaleString('en-LK', { minimumFractionDigits: 2 })
  const dateStr = new Date(job.created_at || Date.now()).toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' })
  const timeStr = new Date(job.created_at || Date.now()).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
  const accessories = (job.accessories_received || []).length ? job.accessories_received.join(', ') : 'None'
  const condition = (job.phone_condition || []).length ? job.phone_condition.join(', ') : '—'

  // Fetched fresh at print time rather than trusting whatever balance the
  // caller happened to have in memory — this job's own balance impact is
  // already applied to the customer's stored balance by the time printing
  // happens at every call site, so a fresh read here is guaranteed current,
  // not just whatever the UI had loaded before this specific job/payment.
  let outstandingBalance = null
  if (customer?.id) {
    const { data } = await supabase.from('repair_customers').select('outstanding_balance').eq('id', customer.id).single()
    if (data) outstandingBalance = data.outstanding_balance || 0
  }

  w.document.write(`<!DOCTYPE html><html><head><title>Repair Job ${job.job_no}</title>
  <style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:'Arial',sans-serif;font-size:13px;font-weight:bold;width:75mm;margin:0 auto;padding:4px}.c{text-align:center}.b{font-weight:bold}.dashed{border-top:1px dashed #000;margin:4px 0}.solid{border-top:2px solid #000;margin:4px 0}.row{display:flex;justify-content:space-between;padding:1px 0;font-size:12px;font-weight:bold}@media print{@page{size:75mm auto;margin:1mm}}</style></head><body>
  <div class="c b" style="font-size:18px;font-weight:bold;letter-spacing:1px">IFIXIT TECHNOLOGIES</div>
  <div class="c" style="font-size:10px;font-weight:bold">078-6403907/072-9999130</div>
  <div class="c" style="font-size:10px">🔧 REPAIR JOB RECEIPT</div>
  <div class="dashed"></div>
  <div class="c b" style="font-size:16px;margin:3px 0">${job.job_no}</div>
  <div class="dashed"></div>
  <div class="row"><span>Date</span><span>${dateStr} ${timeStr}</span></div>
  <div class="row"><span>Customer</span><span>${(customer?.name || '—').toUpperCase()}</span></div>
  <div class="row"><span>Mobile</span><span>${customer?.mobile || '—'}</span></div>
  <div class="dashed"></div>
  <div class="row"><span>Device</span><span>${job.phone_brand || ''} ${job.phone_model || ''}</span></div>
  ${job.imei ? `<div class="row"><span>IMEI</span><span>${job.imei}</span></div>` : ''}
  ${job.phone_colour ? `<div class="row"><span>Colour</span><span>${job.phone_colour}</span></div>` : ''}
  ${job.battery_pct_intake != null ? `<div class="row"><span>Battery at Intake</span><span>${job.battery_pct_intake}%</span></div>` : ''}
  <div class="dashed"></div>
  <div style="font-size:12px;font-weight:bold;margin-bottom:2px">Accessories Received:</div>
  <div style="font-size:11px;font-weight:normal;margin-bottom:4px">${accessories}</div>
  <div style="font-size:12px;font-weight:bold;margin-bottom:2px">Condition Noted:</div>
  <div style="font-size:11px;font-weight:normal;margin-bottom:4px">${condition}</div>
  ${job.reported_problem ? `<div style="font-size:12px;font-weight:bold;margin-bottom:2px">Reported Problem:</div><div style="font-size:11px;font-weight:normal;margin-bottom:4px">${job.reported_problem}</div>` : ''}
  <div class="dashed"></div>
  <div class="row"><span>Estimated Cost</span><span>${fmt2(job.estimated_cost)}</span></div>
  <div class="row"><span>Deposit Paid</span><span>${fmt2(job.deposit_received)}</span></div>
  ${job.estimated_completion ? `<div class="row"><span>Est. Ready Date</span><span>${new Date(job.estimated_completion).toLocaleDateString('en-GB')}</span></div>` : ''}
  ${outstandingBalance !== null ? `<div class="dashed"></div><div class="row b" style="font-size:12px;font-weight:bold"><span>Total Outstanding</span><span>${fmt2(outstandingBalance)}</span></div>` : ''}
  <div class="solid"></div>
  <div class="c" style="font-size:11px;font-weight:bold;margin:4px 0">⚠ Please retain this receipt — required for device collection.</div>
  <div class="c" style="font-size:10px;font-weight:normal">iPHIX Technologies is not responsible for data loss during repair. Uncollected devices after 7 days may be subject to a holding fee.</div>
  <div class="solid"></div>
  <div class="c b" style="font-size:13px;font-weight:bold;margin:3px 0">★ Thank You! ★</div>
  <div class="c" style="font-size:11px;font-weight:bold;margin-top:2px">Designed for iPHIX Technologies · Powered by Techmo Solutions</div>
  <script>window.onload=function(){window.print()}<\/script></body></html>`)
  w.document.close()
}

// ── Payment collection receipt — job-level only, no parts/pricing detail ──
export function warrantyLabel(duration) {
  return { '7_days': '7 Days', '1_month': '1 Month', '3_month': '3 Months', '6_month': '6 Months' }[duration] || 'Warranty'
}

export async function printJobPaymentReceipt(job, customer, paymentAmount, paymentMethod) {
  const w = window.open('', '_blank')
  const fmt2 = n => (parseFloat(n) || 0).toLocaleString('en-LK', { minimumFractionDigits: 2 })
  const dateStr = new Date().toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' })
  const timeStr = new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
  const balanceAfter = Math.max(0, (job.balance_due || 0) - paymentAmount)

  let outstandingBalance = null
  if (customer?.id) {
    const { data } = await supabase.from('repair_customers').select('outstanding_balance').eq('id', customer.id).single()
    if (data) outstandingBalance = data.outstanding_balance || 0
  }

  w.document.write(`<!DOCTYPE html><html><head><title>Payment Receipt ${job.job_no}</title>
  <style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:'Arial',sans-serif;font-size:13px;font-weight:bold;width:75mm;margin:0 auto;padding:4px}.c{text-align:center}.b{font-weight:bold}.dashed{border-top:1px dashed #000;margin:4px 0}.solid{border-top:2px solid #000;margin:4px 0}.row{display:flex;justify-content:space-between;padding:1px 0;font-size:12px;font-weight:bold}.tot{display:flex;justify-content:space-between;font-weight:bold;font-size:15px;padding:3px 0}@media print{@page{size:75mm auto;margin:1mm}}</style></head><body>
  <div class="c b" style="font-size:18px;font-weight:bold;letter-spacing:1px">IFIXIT TECHNOLOGIES</div>
  <div class="c" style="font-size:10px;font-weight:bold">078-6403907/072-9999130</div>
  <div class="c" style="font-size:10px">🔧 REPAIR PAYMENT RECEIPT</div>
  <div class="dashed"></div>
  <div class="c b" style="font-size:16px;margin:3px 0">${job.job_no}</div>
  <div class="dashed"></div>
  <div class="row"><span>Date</span><span>${dateStr} ${timeStr}</span></div>
  <div class="row"><span>Customer</span><span>${(customer?.name || '—').toUpperCase()}</span></div>
  <div class="row"><span>Mobile</span><span>${customer?.mobile || '—'}</span></div>
  <div class="row"><span>Device</span><span>${job.phone_brand || ''} ${job.phone_model || ''}</span></div>
  <div class="dashed"></div>
  <div class="row"><span>Job Total</span><span>${fmt2(job.grand_total)}</span></div>
  ${job.warranty ? `<div class="row"><span>Warranty</span><span>${warrantyLabel(job.warranty_duration)}${job.warranty_expiry ? ` (until ${new Date(job.warranty_expiry).toLocaleDateString('en-GB')})` : ''}</span></div>` : ''}
  <div class="solid"></div>
  <div class="tot"><span>AMOUNT PAID (${paymentMethod.toUpperCase()})</span><span>${fmt2(paymentAmount)}</span></div>
  <div class="solid"></div>
  <div class="row"><span>Balance Remaining</span><span>${fmt2(balanceAfter)}</span></div>
  ${outstandingBalance !== null ? `<div class="dashed"></div><div class="row b" style="font-size:12px;font-weight:bold"><span>Total Outstanding</span><span>${fmt2(outstandingBalance)}</span></div>` : ''}
  <div class="dashed"></div>
  <div class="c b" style="font-size:13px;font-weight:bold;margin:3px 0">★ Thank You! ★</div>
  <div class="c" style="font-size:11px;font-weight:bold;margin-top:2px">Designed for iPHIX Technologies · Powered by Techmo Solutions</div>
  <script>window.onload=function(){window.print()}<\/script></body></html>`)
  w.document.close()
}

// ── Parts sale receipt ──────────────────────────────────
export async function printPartsSaleReceipt(sale, items, customerName) {
  const w = window.open('', '_blank')
  const fmt2 = n => (parseFloat(n) || 0).toLocaleString('en-LK', { minimumFractionDigits: 2 })
  const dateStr = new Date(sale.created_at || Date.now()).toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' })
  const timeStr = new Date(sale.created_at || Date.now()).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
  const balanceDue = Math.max(0, (sale.total || 0) - (sale.amount_paid || 0))

  // Fresh at print time, same reasoning as the job receipts — walk-in sales
  // (no customer_id) have no balance to show at all.
  let outstandingBalance = null
  if (sale.customer_id) {
    const { data } = await supabase.from('repair_customers').select('outstanding_balance').eq('id', sale.customer_id).single()
    if (data) outstandingBalance = data.outstanding_balance || 0
  }

  w.document.write(`<!DOCTYPE html><html><head><title>Receipt ${sale.sale_no}</title>
  <style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:'Arial',sans-serif;font-size:13px;font-weight:bold;width:75mm;margin:0 auto;padding:4px}.c{text-align:center}.b{font-weight:bold}.dashed{border-top:1px dashed #000;margin:4px 0}.solid{border-top:2px solid #000;margin:4px 0}.row{display:flex;justify-content:space-between;padding:1px 0;font-size:12px;font-weight:bold}.tot{display:flex;justify-content:space-between;font-weight:bold;font-size:16px;padding:3px 0}@media print{@page{size:75mm auto;margin:1mm}}</style></head><body>
  <div class="c b" style="font-size:18px;font-weight:bold;letter-spacing:1px">IFIXIT TECHNOLOGIES</div>
  <div class="c" style="font-size:10px;font-weight:bold">078-6403907/072-9999130</div>
  <div class="c" style="font-size:10px">🔧 REPAIR PARTS SALE</div>
  <div class="dashed"></div>
  <div class="c b" style="font-size:16px;margin:3px 0">${sale.sale_no}</div>
  <div class="dashed"></div>
  <div class="row"><span>Date</span><span>${dateStr} ${timeStr}</span></div>
  <div class="row"><span>Customer</span><span>${(customerName || 'Walk-in').toUpperCase()}</span></div>
  <div class="dashed"></div>
  <div class="row b" style="font-size:11px;font-weight:bold"><span>Item</span><span style="display:flex;gap:12px"><span>Qty</span><span>Amount</span></span></div>
  <div class="dashed"></div>
  ${items.map((li, idx) => `<div style="font-size:12px;font-weight:bold;padding:1px 0">${idx + 1}. ${li.repair_parts?.name || li.item_name || ''}</div><div style="display:flex;justify-content:space-between;font-size:12px;font-weight:bold;padding:0 0 3px 10px"><span>${fmt2(li.unit_price)} × ${li.quantity}</span><span>${fmt2(li.line_total)}</span></div>`).join('')}
  <div class="dashed"></div>
  <div class="solid"></div>
  <div class="tot"><span>TOTAL</span><span>${fmt2(sale.total)}</span></div>
  <div class="solid"></div>
  ${balanceDue > 0 ? `<div class="row"><span>PAID</span><span>${fmt2(sale.amount_paid)}</span></div><div class="row b"><span>CREDIT DUE</span><span>${fmt2(balanceDue)}</span></div>` : `<div class="row"><span>PAID (${(sale.payment_method || '').toUpperCase()})</span><span>${fmt2(sale.amount_paid)}</span></div>`}
  ${outstandingBalance !== null ? `<div class="dashed"></div><div class="row b" style="font-size:12px;font-weight:bold"><span>Total Outstanding</span><span>${fmt2(outstandingBalance)}</span></div>` : ''}
  <div class="dashed"></div>
  <div class="c b" style="font-size:13px;font-weight:bold;margin:3px 0">★ Thank You! ★</div>
  <div class="c" style="font-size:11px;font-weight:bold;margin-top:2px">Designed for iPHIX Technologies · Powered by Techmo Solutions</div>
  <script>window.onload=function(){window.print()}<\/script></body></html>`)
  w.document.close()
}
