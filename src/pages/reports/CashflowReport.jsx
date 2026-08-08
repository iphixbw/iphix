import { useState, useEffect } from 'react'
import { supabase } from '../../supabase'
import { formatCurrency } from '../../lib/helpers'

export default function CashflowReport() {
  const [loading, setLoading] = useState(true)
  const [shops, setShops] = useState([])
  const [shopFilter, setShopFilter] = useState('all')
  const [dateFrom, setDateFrom] = useState(() => { const d = new Date(); d.setDate(1); return d.toISOString().split('T')[0] })
  const [dateTo, setDateTo] = useState(() => new Date().toISOString().split('T')[0])
  const [cashSales, setCashSales] = useState([])
  const [cardSales, setCardSales] = useState([])
  const [creditSales, setCreditSales] = useState([])
  const [chequeSales, setChequeSales] = useState([])
  const [expenses, setExpenses] = useState([])
  const [deposits, setDeposits] = useState([])
  const [payments, setPayments] = useState([])
  const [expanded, setExpanded] = useState({})

  useEffect(() => {
    supabase.from('shops').select('*').order('name').then(({ data }) => setShops(data || []))
  }, [])
  useEffect(() => { fetchData() }, [dateFrom, dateTo, shopFilter])

  async function fetchData() {
    setLoading(true)
    const from = `${dateFrom}T00:00:00`
    const to = `${dateTo}T23:59:59`
    let invQ = supabase.from('invoices')
      .select('id,invoice_no,total,amount_paid,credit_amount,payment_method,created_at,customers(name),shops(name)')
      .eq('status','confirmed').gte('created_at',from).lte('created_at',to)
    let expQ = supabase.from('expenses').select('*').gte('created_at',from).lte('created_at',to)
    let depQ = supabase.from('cash_deposits').select('*').gte('created_at',from).lte('created_at',to)
    let pmtQ = supabase.from('invoice_payments')
      .select('*,invoices(invoice_no,customers(name),shops(name))').gte('created_at',from).lte('created_at',to)
    if (shopFilter !== 'all') {
      invQ = invQ.eq('shop_id', shopFilter)
      expQ = expQ.eq('shop_id', shopFilter)
      depQ = depQ.eq('shop_id', shopFilter)
    }
    const [{ data: invs }, { data: exps }, { data: deps }, { data: pmts }] = await Promise.all([invQ,expQ,depQ,pmtQ])
    const all = invs || []
    setCashSales(all.filter(i => i.payment_method === 'cash' || i.payment_method === 'partial'))
    setCardSales(all.filter(i => i.payment_method === 'card'))
    setCreditSales(all.filter(i => i.payment_method === 'credit'))
    setChequeSales(all.filter(i => i.payment_method === 'cheque'))
    setExpenses(exps || [])
    setDeposits(deps || [])
    setPayments(pmts || [])
    setLoading(false)
  }

  const totalCashIn   = cashSales.reduce((s,i) => s+(i.amount_paid||0), 0)
  const totalCardIn   = cardSales.reduce((s,i) => s+(i.amount_paid||0), 0)
  const totalChequeIn = chequeSales.reduce((s,i) => s+(i.amount_paid||0), 0)
  const totalCredit   = creditSales.reduce((s,i) => s+(i.total||0), 0)
  const totalPmtsRcvd = payments.reduce((s,p) => s+p.amount, 0)
  const totalExp      = expenses.reduce((s,e) => s+(e.amount||0), 0)
  const cashExp       = expenses.filter(e => !e.payment_method || e.payment_method==='cash').reduce((s,e) => s+e.amount, 0)
  const totalDep      = deposits.reduce((s,d) => s+d.amount, 0)
  const netCash       = totalCashIn + totalPmtsRcvd - cashExp - totalDep

  const inp = { padding:'8px 12px', border:'1.5px solid #e2e8f0', borderRadius:'7px', fontSize:'13px', outline:'none', background:'white' }
  const f = formatCurrency

  function toggleExpand(key) {
    setExpanded(prev => ({ ...prev, [key]: !prev[key] }))
  }

  function expandAll() {
    setExpanded({ cashSales:true, cardSales:true, chequeSales:true, payments:true, expenses:true, deposits:true, creditSales:true })
  }

  const thStyle = { padding:'7px 12px', textAlign:'left', fontSize:'11px', fontWeight:'700', color:'#94a3b8', textTransform:'uppercase', whiteSpace:'nowrap', background:'#f8fafc', borderBottom:'2px solid #e2e8f0' }
  const tdStyle = { padding:'8px 12px', fontSize:'12px', borderBottom:'1px solid #f1f5f9' }

  function SectionRow({ label, count, total, items, green, skey, renderRow, headers }) {
    if (!items || items.length === 0) return null
    const isOpen = expanded[skey]
    return (
      <div>
        <div onClick={() => toggleExpand(skey)}
          style={{ padding:'10px 16px', background: isOpen ? (green?'#f0fdf4':'#fff5f5') : '#f8fafc',
            borderBottom:'1px solid #f1f5f9', cursor:'pointer',
            display:'flex', justifyContent:'space-between', alignItems:'center' }}
          onMouseEnter={e => e.currentTarget.style.background='#eef2ff'}
          onMouseLeave={e => e.currentTarget.style.background= isOpen ? (green?'#f0fdf4':'#fff5f5') : '#f8fafc'}>
          <span style={{ fontSize:'12px', fontWeight:'700', textTransform:'uppercase', color: green?'#166534':'#991b1b' }}>
            {label} <span style={{color:'#94a3b8', fontWeight:'400'}}>({count})</span>
          </span>
          <span style={{ display:'flex', alignItems:'center', gap:'10px' }}>
            <span style={{ fontSize:'13px', fontWeight:'800', color: green?'#059669':'#e11d48' }}>{f(total)}</span>
            <span style={{ fontSize:'11px', color:'#94a3b8', fontWeight:'600' }}>{isOpen ? '▲ collapse' : '▼ expand'}</span>
          </span>
        </div>
        {isOpen && (
          <div style={{ overflowX:'auto' }}>
            <table style={{ width:'100%', borderCollapse:'collapse' }}>
              <thead>
                <tr>{headers.map((h,i) => <th key={i} style={{ ...thStyle, textAlign: h.right?'right':'left' }}>{h.label}</th>)}</tr>
              </thead>
              <tbody>
                {items.map((row, ri) => (
                  <tr key={row.id||ri} style={{ background: ri%2===0?'white':'#fafafa' }}>
                    {renderRow(row).map((cell, ci) => (
                      <td key={ci} style={{ ...tdStyle, textAlign: headers[ci]?.right?'right':'left',
                        fontWeight: headers[ci]?.bold?'700':'400', color: headers[ci]?.color||'#0f172a' }}>
                        {cell}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr style={{ background:'#0f172a', color:'white' }}>
                  <td colSpan={headers.length - 1} style={{ padding:'8px 12px', fontWeight:'700', fontSize:'12px' }}>
                    Total — {count} records
                  </td>
                  <td style={{ padding:'8px 12px', textAlign:'right', fontWeight:'800', fontSize:'13px',
                    color: green?'#4ade80':'#fca5a5' }}>
                    {f(total)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>
    )
  }

  function printReport() {
    const w = window.open('', '_blank')
    const dateStr = new Date().toLocaleDateString('en-GB', { day:'2-digit', month:'long', year:'numeric' })
    const fmt = n => (parseFloat(n)||0).toLocaleString('en-LK', { minimumFractionDigits:2 })
    const shopName = shopFilter !== 'all' ? shops.find(s=>s.id===shopFilter)?.name || 'All Shops' : 'All Shops'

    function sectionTable(title, items, headers, rowFn, total, color) {
      if (!items || items.length === 0) return ''
      const rows = items.map((r,i) => `<tr style="background:${i%2===0?'white':'#f8fafc'}">${rowFn(r).map((cell,ci) => `<td style="padding:5px 8px;border-bottom:1px solid #f1f5f9;text-align:${headers[ci]?.right?'right':'left'};font-weight:${headers[ci]?.bold?'700':'400'};color:${headers[ci]?.color||'#1e293b'}">${cell}</td>`).join('')}</tr>`).join('')
      return `
        <div style="margin-bottom:18px">
          <div style="background:#f8fafc;padding:8px 12px;border-left:4px solid ${color};margin-bottom:0;font-size:11px;font-weight:700;text-transform:uppercase;color:${color};display:flex;justify-content:space-between">
            <span>${title} (${items.length} records)</span><span>LKR ${fmt(total)}</span>
          </div>
          <table style="width:100%;border-collapse:collapse;font-size:10px">
            <thead><tr style="background:#0f172a;color:white">${headers.map(h=>`<th style="padding:6px 8px;text-align:${h.right?'right':'left'};font-size:9px;font-weight:700;text-transform:uppercase;white-space:nowrap">${h.label}</th>`).join('')}</tr></thead>
            <tbody>${rows}</tbody>
            <tfoot><tr style="background:#1e293b;color:white">
              <td colspan="${headers.length-1}" style="padding:7px 8px;font-weight:700">Total</td>
              <td style="padding:7px 8px;text-align:right;font-weight:800;font-size:12px">LKR ${fmt(total)}</td>
            </tr></tfoot>
          </table>
        </div>`
    }

    const fmtDate = r => new Date(r.created_at).toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'})

    const html = `<!DOCTYPE html><html><head><title>Cashflow Report</title>
    <style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:Arial,sans-serif;font-size:11px;color:#1e293b;padding:16px}.hdr{border-bottom:3px solid #1e40af;padding-bottom:10px;margin-bottom:14px}.co{font-size:19px;font-weight:900;color:#1e40af}.ttl{font-size:14px;font-weight:700;margin-top:3px}.sub{font-size:10px;color:#64748b;margin-top:2px}.summary{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:16px}.card{border:1.5px solid #e2e8f0;border-radius:6px;padding:10px 12px}.lbl{font-size:9px;font-weight:700;color:#94a3b8;text-transform:uppercase;margin-bottom:3px}.val{font-size:14px;font-weight:800}.net{padding:14px 20px;border-radius:8px;display:flex;justify-content:space-between;align-items:center;margin-top:14px}.ftr{margin-top:14px;border-top:2px solid #e2e8f0;padding-top:8px;text-align:center;font-size:9px;color:#94a3b8;font-weight:700}@media print{@page{size:A4 portrait;margin:8mm}body{padding:0}}</style>
    </head><body>
    <div class="hdr"><div class="co">PHONEFIX (PVT) LTD</div><div class="ttl">Cashflow Report</div><div class="sub">${dateFrom} to ${dateTo} &nbsp;·&nbsp; ${shopName} &nbsp;·&nbsp; Generated ${dateStr}</div></div>
    <div class="summary">
      <div class="card"><div class="lbl">Cash Sales</div><div class="val" style="color:#059669">LKR ${fmt(totalCashIn)}</div><div style="font-size:9px;color:#94a3b8">${cashSales.length} invoices</div></div>
      <div class="card"><div class="lbl">Card Sales</div><div class="val" style="color:#0891b2">LKR ${fmt(totalCardIn)}</div><div style="font-size:9px;color:#94a3b8">${cardSales.length} invoices</div></div>
      <div class="card"><div class="lbl">Cheque Sales</div><div class="val" style="color:#7c3aed">LKR ${fmt(totalChequeIn)}</div><div style="font-size:9px;color:#94a3b8">${chequeSales.length} invoices</div></div>
      <div class="card"><div class="lbl">Payments Received</div><div class="val" style="color:#059669">LKR ${fmt(totalPmtsRcvd)}</div><div style="font-size:9px;color:#94a3b8">${payments.length} payments</div></div>
      <div class="card"><div class="lbl">Expenses</div><div class="val" style="color:#d97706">LKR ${fmt(totalExp)}</div><div style="font-size:9px;color:#94a3b8">${expenses.length} entries</div></div>
      <div class="card"><div class="lbl">Cash Deposited</div><div class="val" style="color:#2563eb">LKR ${fmt(totalDep)}</div><div style="font-size:9px;color:#94a3b8">${deposits.length} deposits</div></div>
      <div class="card"><div class="lbl">Credit Given</div><div class="val" style="color:#e11d48">LKR ${fmt(totalCredit)}</div><div style="font-size:9px;color:#94a3b8">${creditSales.length} invoices</div></div>
      <div class="card"><div class="lbl">Net Cash</div><div class="val" style="color:${netCash>=0?'#059669':'#e11d48'}">LKR ${fmt(netCash)}</div></div>
    </div>
    <h3 style="font-size:12px;font-weight:700;color:#059669;margin:14px 0 8px;text-transform:uppercase;letter-spacing:.05em">💵 Money In</h3>
    ${sectionTable('Cash Sales', cashSales, [{label:'Date'},{label:'Invoice',bold:true,color:'#2563eb'},{label:'Customer'},{label:'Shop'},{label:'Amount',right:true,bold:true,color:'#059669'}], r=>[fmtDate(r),r.invoice_no||'—',r.customers?.name||'—',r.shops?.name||'—','LKR '+fmt(r.amount_paid)], totalCashIn, '#059669')}
    ${sectionTable('Card Sales', cardSales, [{label:'Date'},{label:'Invoice',bold:true,color:'#2563eb'},{label:'Customer'},{label:'Shop'},{label:'Amount',right:true,bold:true,color:'#0891b2'}], r=>[fmtDate(r),r.invoice_no||'—',r.customers?.name||'—',r.shops?.name||'—','LKR '+fmt(r.amount_paid)], totalCardIn, '#0891b2')}
    ${sectionTable('Cheque Sales', chequeSales, [{label:'Date'},{label:'Invoice',bold:true,color:'#2563eb'},{label:'Customer'},{label:'Shop'},{label:'Amount',right:true,bold:true,color:'#7c3aed'}], r=>[fmtDate(r),r.invoice_no||'—',r.customers?.name||'—',r.shops?.name||'—','LKR '+fmt(r.amount_paid)], totalChequeIn, '#7c3aed')}
    ${sectionTable('Payments Received', payments, [{label:'Date'},{label:'Invoice',bold:true,color:'#2563eb'},{label:'Customer'},{label:'Method'},{label:'Amount',right:true,bold:true,color:'#059669'}], r=>[fmtDate(r),r.invoices?.invoice_no||'—',r.invoices?.customers?.name||'—',(r.payment_method||'cash').replace('_',' '),'LKR '+fmt(r.amount)], totalPmtsRcvd, '#059669')}
    <h3 style="font-size:12px;font-weight:700;color:#e11d48;margin:14px 0 8px;text-transform:uppercase;letter-spacing:.05em">💸 Money Out</h3>
    ${sectionTable('Expenses', expenses, [{label:'Date'},{label:'Description'},{label:'Category'},{label:'Method'},{label:'Amount',right:true,bold:true,color:'#e11d48'}], r=>[fmtDate(r),r.description||'—',r.category||'—',r.payment_method||'cash','LKR '+fmt(r.amount)], totalExp, '#e11d48')}
    ${sectionTable('Cash Deposited', deposits, [{label:'Date'},{label:'Notes'},{label:'Amount',right:true,bold:true,color:'#2563eb'}], r=>[fmtDate(r),r.notes||'Cash deposit','LKR '+fmt(r.amount)], totalDep, '#2563eb')}
    ${creditSales.length>0?sectionTable('Credit Given (Unpaid)', creditSales, [{label:'Date'},{label:'Invoice',bold:true,color:'#2563eb'},{label:'Customer'},{label:'Shop'},{label:'Amount',right:true,bold:true,color:'#e11d48'}], r=>[fmtDate(r),r.invoice_no||'—',r.customers?.name||'—',r.shops?.name||'—','LKR '+fmt(r.total)], totalCredit, '#e11d48'):''}
    <div class="net" style="background:${netCash>=0?'#059669':'#e11d48'}">
      <div><div style="font-size:12px;color:white;opacity:.85">Net Cash Position</div><div style="font-size:10px;color:white;opacity:.7">${dateFrom} → ${dateTo} · ${shopName}</div></div>
      <div style="font-size:22px;font-weight:900;color:white">${netCash>=0?'+':''}LKR ${fmt(netCash)}</div>
    </div>
    <div class="ftr">Designed for Phonefix (PVT) Ltd &nbsp;·&nbsp; Powered by Techmo Solutions &nbsp;·&nbsp; ${dateStr}</div>
    <script>window.onload=function(){window.print()}<\/script></body></html>`

    w.document.write(html)
    w.document.close()
  }

  return (
    <div>
      {/* ── Header ── */}
      <div style={{ marginBottom:'20px', display:'flex', justifyContent:'space-between', alignItems:'flex-start' }}>
        <div>
          <h2 style={{ fontSize:'18px', fontWeight:'700', color:'#0f172a', margin:'0 0 4px' }}>Cashflow Report</h2>
          <p style={{ color:'#64748b', fontSize:'13px', margin:0 }}>Click any section to expand details</p>
        </div>
        <div style={{ display:'flex', gap:'10px' }}>
          <button onClick={expandAll}
            style={{ padding:'8px 16px', background:'#f8fafc', color:'#2563eb', border:'1.5px solid #bfdbfe', borderRadius:'7px', cursor:'pointer', fontWeight:'700', fontSize:'13px' }}>
            ⊞ Expand All
          </button>
          <button onClick={printReport}
            style={{ padding:'8px 16px', background:'#eef2ff', color:'#2563eb', border:'1.5px solid #bfdbfe', borderRadius:'7px', cursor:'pointer', fontWeight:'700', fontSize:'13px' }}>
            🖨 Print PDF
          </button>
        </div>
      </div>

      {/* ── Filters ── */}
      <div style={{ background:'white', borderRadius:'12px', padding:'14px 16px', boxShadow:'0 1px 3px rgba(0,0,0,0.08)', marginBottom:'20px', display:'flex', gap:'12px', flexWrap:'wrap', alignItems:'flex-end' }}>
        {[{l:'From',v:dateFrom,s:setDateFrom},{l:'To',v:dateTo,s:setDateTo}].map(({l,v,s}) => (
          <div key={l}>
            <label style={{ fontSize:'11px', fontWeight:'700', color:'#94a3b8', display:'block', marginBottom:'4px', textTransform:'uppercase' }}>{l}</label>
            <input type="date" value={v} onChange={e=>s(e.target.value)} style={inp} />
          </div>
        ))}
        <div>
          <label style={{ fontSize:'11px', fontWeight:'700', color:'#94a3b8', display:'block', marginBottom:'4px', textTransform:'uppercase' }}>Shop</label>
          <select value={shopFilter} onChange={e=>setShopFilter(e.target.value)} style={inp}>
            <option value="all">All Shops</option>
            {shops.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
        <button onClick={fetchData} style={{ padding:'9px 18px', background:'linear-gradient(135deg,#2563eb,#1d4ed8)', color:'white', border:'none', borderRadius:'7px', cursor:'pointer', fontWeight:'700', fontSize:'13px' }}>
          Refresh
        </button>
      </div>

      {loading ? <div style={{ padding:'60px', textAlign:'center', color:'#94a3b8', fontSize:'16px' }}>Loading...</div> : (<>

        {/* ── Summary cards ── */}
        <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(155px,1fr))', gap:'12px', marginBottom:'24px' }}>
          {[
            {label:'Cash Sales',    val:totalCashIn,   sub:`${cashSales.length} invoices`,   color:'#059669'},
            {label:'Card Sales',    val:totalCardIn,   sub:`${cardSales.length} invoices`,   color:'#0891b2'},
            {label:'Cheque Sales',  val:totalChequeIn, sub:`${chequeSales.length} invoices`, color:'#7c3aed'},
            {label:'Credit Given',  val:totalCredit,   sub:`${creditSales.length} invoices`, color:'#e11d48'},
            {label:'Pmts Received', val:totalPmtsRcvd, sub:`${payments.length} payments`,   color:'#059669'},
            {label:'Expenses',      val:totalExp,      sub:`${expenses.length} entries`,    color:'#d97706'},
            {label:'Deposited',     val:totalDep,      sub:`${deposits.length} deposits`,   color:'#2563eb'},
            {label:'Net Cash',      val:netCash,       sub:'in + pmts − exp − dep',         color:netCash>=0?'#059669':'#e11d48'},
          ].map(s => (
            <div key={s.label} style={{ background:'white', borderRadius:'12px', padding:'14px 16px', boxShadow:'0 1px 3px rgba(0,0,0,0.08)', borderLeft:`4px solid ${s.color}` }}>
              <div style={{ fontSize:'11px', fontWeight:'700', color:'#94a3b8', textTransform:'uppercase', letterSpacing:'0.06em', marginBottom:'4px' }}>{s.label}</div>
              <div style={{ fontSize:'19px', fontWeight:'800', color:s.color }}>{f(s.val)}</div>
              <div style={{ fontSize:'11px', color:'#94a3b8', marginTop:'2px' }}>{s.sub}</div>
            </div>
          ))}
        </div>

        {/* ── Sections ── */}
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'16px' }}>

          {/* Money IN */}
          <div style={{ background:'white', borderRadius:'12px', boxShadow:'0 1px 3px rgba(0,0,0,0.08)', overflow:'hidden' }}>
            <div style={{ padding:'14px 16px', background:'#f0fdf4', borderBottom:'1px solid #bbf7d0' }}>
              <h3 style={{ fontSize:'14px', fontWeight:'700', color:'#166534', margin:0 }}>
                💵 Money In — {f(totalCashIn+totalCardIn+totalChequeIn+totalPmtsRcvd)}
              </h3>
            </div>
            <SectionRow label="Cash Sales" count={cashSales.length} total={totalCashIn} items={cashSales} green skey="cashSales"
              headers={[{label:'Date'},{label:'Invoice',bold:true,color:'#2563eb'},{label:'Customer'},{label:'Shop'},{label:'Amount',right:true,bold:true,color:'#059669'}]}
              renderRow={r=>[new Date(r.created_at).toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'}),r.invoice_no||'—',r.customers?.name||'—',r.shops?.name||'—',f(r.amount_paid)]} />
            <SectionRow label="Card Sales" count={cardSales.length} total={totalCardIn} items={cardSales} green skey="cardSales"
              headers={[{label:'Date'},{label:'Invoice',bold:true,color:'#2563eb'},{label:'Customer'},{label:'Shop'},{label:'Amount',right:true,bold:true,color:'#0891b2'}]}
              renderRow={r=>[new Date(r.created_at).toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'}),r.invoice_no||'—',r.customers?.name||'—',r.shops?.name||'—',f(r.amount_paid)]} />
            <SectionRow label="Cheque Sales" count={chequeSales.length} total={totalChequeIn} items={chequeSales} green skey="chequeSales"
              headers={[{label:'Date'},{label:'Invoice',bold:true,color:'#2563eb'},{label:'Customer'},{label:'Shop'},{label:'Amount',right:true,bold:true,color:'#7c3aed'}]}
              renderRow={r=>[new Date(r.created_at).toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'}),r.invoice_no||'—',r.customers?.name||'—',r.shops?.name||'—',f(r.amount_paid)]} />
            <SectionRow label="Payments Received" count={payments.length} total={totalPmtsRcvd} items={payments} green skey="payments"
              headers={[{label:'Date'},{label:'Invoice',bold:true,color:'#2563eb'},{label:'Customer'},{label:'Method'},{label:'Amount',right:true,bold:true,color:'#059669'}]}
              renderRow={r=>[new Date(r.created_at).toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'}),r.invoices?.invoice_no||'—',r.invoices?.customers?.name||'—',(r.payment_method||'cash').replace('_',' '),f(r.amount)]} />
            {totalCashIn+totalCardIn+totalChequeIn+totalPmtsRcvd===0 &&
              <div style={{ padding:'30px', textAlign:'center', color:'#94a3b8' }}>No inflows in this period</div>}
          </div>

          {/* Money OUT */}
          <div style={{ background:'white', borderRadius:'12px', boxShadow:'0 1px 3px rgba(0,0,0,0.08)', overflow:'hidden' }}>
            <div style={{ padding:'14px 16px', background:'#fff5f5', borderBottom:'1px solid #fecaca' }}>
              <h3 style={{ fontSize:'14px', fontWeight:'700', color:'#991b1b', margin:0 }}>
                💸 Money Out — {f(totalExp+totalDep)}
              </h3>
            </div>
            <SectionRow label="Expenses" count={expenses.length} total={totalExp} items={expenses} skey="expenses"
              headers={[{label:'Date'},{label:'Description'},{label:'Category'},{label:'Method'},{label:'Amount',right:true,bold:true,color:'#e11d48'}]}
              renderRow={r=>[new Date(r.created_at).toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'}),r.description||'—',r.category||'—',r.payment_method||'cash',f(r.amount)]} />
            <SectionRow label="Cash Deposited" count={deposits.length} total={totalDep} items={deposits} skey="deposits"
              headers={[{label:'Date'},{label:'Notes'},{label:'Amount',right:true,bold:true,color:'#2563eb'}]}
              renderRow={r=>[new Date(r.created_at).toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'}),r.notes||'Cash deposit',f(r.amount)]} />
            {creditSales.length > 0 &&
              <SectionRow label="⚠ Credit Given (unpaid)" count={creditSales.length} total={totalCredit} items={creditSales} skey="creditSales"
                headers={[{label:'Date'},{label:'Invoice',bold:true,color:'#2563eb'},{label:'Customer'},{label:'Shop'},{label:'Amount',right:true,bold:true,color:'#e11d48'}]}
                renderRow={r=>[new Date(r.created_at).toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'}),r.invoice_no||'—',r.customers?.name||'—',r.shops?.name||'—',f(r.total)]} />}
            {totalExp+totalDep===0 &&
              <div style={{ padding:'30px', textAlign:'center', color:'#94a3b8' }}>No outflows in this period</div>}
          </div>
        </div>

        {/* ── Net bar ── */}
        <div style={{ background:netCash>=0?'linear-gradient(135deg,#059669,#047857)':'linear-gradient(135deg,#e11d48,#be123c)', borderRadius:'12px', padding:'20px 24px', marginTop:'16px', display:'flex', justifyContent:'space-between', alignItems:'center', color:'white' }}>
          <div>
            <div style={{ fontSize:'13px', opacity:0.85, marginBottom:'4px' }}>Net Cash Position</div>
            <div style={{ fontSize:'11px', opacity:0.7 }}>{dateFrom} → {dateTo} {shopFilter!=='all'?`· ${shops.find(s=>s.id===shopFilter)?.name}`:'· All Shops'}</div>
          </div>
          <div style={{ fontSize:'28px', fontWeight:'900' }}>{netCash>=0?'+':''}{f(netCash)}</div>
        </div>
      </>)}
    </div>
  )
}
