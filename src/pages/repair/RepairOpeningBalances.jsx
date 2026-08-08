import { useState, useEffect, useRef } from 'react'
import { supabase } from '../../supabase'
import { formatLKR } from '../../lib/repairConstants'
import { generateRepairCustomerNo, generateRepairSupplierNo, generateRepairPartSku } from '../../lib/repairHelpers'
import toast from 'react-hot-toast'
import * as XLSX from 'xlsx'

const TABS = [
  { id: 'cash',      icon: '💰', label: 'Cash in Hand',       desc: 'Set the opening cash balance for the repair shop' },
  { id: 'customers', icon: '👥', label: 'Customer Balances',  desc: 'Enter what each repair customer owes' },
  { id: 'suppliers', icon: '🏭', label: 'Supplier Balances',  desc: 'Enter what you owe each parts supplier' },
  { id: 'inventory', icon: '📦', label: 'Parts Stock Count',  desc: 'Set opening quantity, cost and brand/category for each part' },
]

const inp = { width: '100%', padding: '9px 12px', border: '1.5px solid #e2e8f0', borderRadius: '7px', fontSize: '14px', boxSizing: 'border-box', outline: 'none', background: 'white' }
const lbl = { display: 'block', marginBottom: '5px', fontSize: '11px', fontWeight: '700', color: '#94a3b8', textTransform: 'uppercase', letterSpacing: '0.06em' }

export default function RepairOpeningBalances({ shop }) {
  const [activeTab, setActiveTab] = useState('cash')
  const [saving, setSaving] = useState(false)

  // Cash tab
  const [cashLedger, setCashLedger] = useState([])
  const [openingCash, setOpeningCash] = useState('')
  const existingOpeningRow = cashLedger.find(l => l.type === 'opening')

  // Customers tab
  const [customers, setCustomers] = useState([])
  const [customerBalances, setCustomerBalances] = useState({})
  const [customerSearch, setCustomerSearch] = useState('')
  const [customerUploadPreview, setCustomerUploadPreview] = useState(null)
  const [customerUploading, setCustomerUploading] = useState(false)
  const customerFileRef = useRef(null)

  // Suppliers tab
  const [suppliers, setSuppliers] = useState([])
  const [supplierBalances, setSupplierBalances] = useState({})
  const [supplierSearch, setSupplierSearch] = useState('')
  const [supplierUploadPreview, setSupplierUploadPreview] = useState(null)
  const [supplierUploading, setSupplierUploading] = useState(false)
  const supplierFileRef = useRef(null)

  // Inventory (parts) tab
  const [parts, setParts] = useState([])
  const [brands, setBrands] = useState([]) // repair_parts.brand is free text — distinct values seen so far
  const [categories, setCategories] = useState([]) // same, repair_parts.category is free text
  const [partQty, setPartQty] = useState({})
  const [partCost, setPartCost] = useState({})
  const [partSelling, setPartSelling] = useState({})
  const [partBrand, setPartBrand] = useState({})
  const [partCategory, setPartCategory] = useState({})
  const [partSearch, setPartSearch] = useState('')
  const [uploadPreview, setUploadPreview] = useState(null)
  const [uploading, setUploading] = useState(false)
  const fileInputRef = useRef(null)

  useEffect(() => { fetchAll() }, [])

  // Plain .select() is capped by Supabase/PostgREST's default row limit — with over
  // 1000 parts (or growing customer/supplier lists), that silently truncated results.
  // Pages through in batches of 1000 until everything's fetched.
  async function fetchAllRows(table, columns, orderCol) {
    let all = []
    let from = 0
    const PAGE_SIZE = 1000
    while (true) {
      const { data, error } = await supabase.from(table).select(columns).order(orderCol).range(from, from + PAGE_SIZE - 1)
      if (error) { toast.error(`Failed to load ${table}: ` + error.message); break }
      all = all.concat(data || [])
      if (!data || data.length < PAGE_SIZE) break
      from += PAGE_SIZE
    }
    return all
  }

  async function fetchAll() {
    const [ledger, custs, sups, prts] = await Promise.all([
      fetchAllRows('repair_cash_ledger', '*', 'created_at'),
      fetchAllRows('repair_customers', 'id, name, customer_no, mobile, outstanding_balance', 'name'),
      fetchAllRows('repair_suppliers', 'id, name, supplier_no, outstanding_balance, opening_balance', 'name'),
      fetchAllRows('repair_parts', 'id, name, sku, current_stock, purchase_price, average_cost, selling_price, brand, category', 'name'),
    ])
    setCashLedger(ledger || [])
    setCustomers(custs || [])
    setSuppliers(sups || [])
    setParts(prts || [])

    setBrands([...new Set((prts || []).map(p => p.brand).filter(Boolean))].sort())
    setCategories([...new Set((prts || []).map(p => p.category).filter(Boolean))].sort())

    const cBal = {}
    for (const c of (custs || [])) cBal[c.id] = c.outstanding_balance > 0 ? String(c.outstanding_balance) : ''
    setCustomerBalances(cBal)

    const sBal = {}
    for (const s of (sups || [])) sBal[s.id] = (s.opening_balance ?? s.outstanding_balance) > 0 ? String(s.opening_balance ?? s.outstanding_balance) : ''
    setSupplierBalances(sBal)

    const pQty = {}, pCost = {}, pSelling = {}, pBrand = {}, pCategory = {}
    for (const p of (prts || [])) {
      pQty[p.id] = p.current_stock > 0 ? String(p.current_stock) : ''
      pCost[p.id] = p.purchase_price > 0 ? String(p.purchase_price) : ''
      pSelling[p.id] = p.selling_price > 0 ? String(p.selling_price) : ''
      pBrand[p.id] = p.brand || ''
      pCategory[p.id] = p.category || ''
    }
    setPartQty(pQty); setPartCost(pCost); setPartSelling(pSelling)
    setPartBrand(pBrand); setPartCategory(pCategory)

    const opening = (ledger || []).find(l => l.type === 'opening')
    setOpeningCash(opening ? String(opening.amount) : '')
  }

  // ── Cash in hand ──────────────────────────────────────────────
  async function saveCash() {
    if (!shop?.id) return toast.error('No active shop selected')
    setSaving(true)
    try {
      const val = parseFloat(openingCash) || 0
      if (existingOpeningRow) {
        await supabase.from('repair_cash_ledger').update({ amount: val }).eq('id', existingOpeningRow.id)
      } else {
        await supabase.from('repair_cash_ledger').insert({
          shop_id: shop.id, type: 'opening', amount: val, reference: 'Opening balance', notes: 'Set via Opening Balances',
        })
      }
      toast.success('Opening cash saved!')
      fetchAll()
    } catch (e) {
      toast.error('Failed to save: ' + e.message)
    }
    setSaving(false)
  }

  // ── Customers — manual save ──────────────────────────────────
  async function saveCustomers() {
    setSaving(true)
    try {
      for (const c of customers) {
        const val = parseFloat(customerBalances[c.id]) || 0
        if (val !== (c.outstanding_balance || 0)) {
          await supabase.from('repair_customers').update({ outstanding_balance: val }).eq('id', c.id)
        }
      }
      toast.success('Customer balances saved!')
      fetchAll()
    } catch (e) {
      toast.error('Failed to save: ' + e.message)
    }
    setSaving(false)
  }

  // ── Customers — Excel upload ──────────────────────────────────
  function handleCustomerExcelUpload(e) {
    const file = e.target.files?.[0]
    if (customerFileRef.current) customerFileRef.current.value = ''
    if (!file) return
    const reader = new FileReader()
    reader.onload = (evt) => {
      try {
        const wb = XLSX.read(evt.target.result, { type: 'binary' })
        const ws = wb.Sheets[wb.SheetNames[0]]
        const allRows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' })
        if (!allRows.length) return toast.error('File is empty')
        const headers = allRows[0].map(h => String(h).trim().toLowerCase())
        const dataRows = allRows.slice(1).filter(r => r.some(v => v !== ''))
        const col = (candidates, fallback) => {
          for (const c of candidates) {
            const idx = headers.findIndex(h => h === c.toLowerCase() || h.includes(c.toLowerCase()))
            if (idx !== -1) return idx
          }
          return fallback
        }
        const colName    = col(['name', 'customer name', 'customer'], 0)
        const colBalance = col(['balance', 'outstanding', 'outstanding balance', 'amount', 'amount owed'], 1)
        const colMobile  = col(['mobile', 'phone', 'contact'], 2)
        const colAddress = col(['address'], 3)
        const rows = dataRows.map(r => ({
          name: String(r[colName] || '').trim(),
          balance: parseFloat(r[colBalance]) || 0,
          mobile: String(r[colMobile] || '').trim(),
          address: String(r[colAddress] || '').trim(),
        })).filter(r => r.name)
        if (!rows.length) return toast.error('No valid rows found. Ensure columns: Name, Balance')
        const matched = rows.map(r => {
          const existing = customers.find(c => c.name.toLowerCase() === r.name.toLowerCase())
          return { ...r, existing, status: existing ? 'update' : 'new' }
        })
        setCustomerUploadPreview(matched)
        toast.success(`${matched.length} rows parsed — ${matched.filter(r => r.status === 'new').length} new, ${matched.filter(r => r.status === 'update').length} updates`)
      } catch (err) {
        toast.error('Failed to parse file: ' + err.message)
      }
    }
    reader.readAsBinaryString(file)
  }

  async function commitCustomerUpload() {
    if (!customerUploadPreview?.length) return
    setCustomerUploading(true)
    try {
      let newCount = 0, updateCount = 0
      for (const row of customerUploadPreview) {
        if (row.status === 'new') {
          if (!row.mobile) { toast.error(`Skipped "${row.name}" — mobile number is required for new repair customers`); continue }
          const customer_no = await generateRepairCustomerNo()
          const { error } = await supabase.from('repair_customers').insert({
            customer_no,
            name: row.name,
            mobile: row.mobile,
            address: row.address || null,
            outstanding_balance: row.balance || 0,
          })
          if (error) { toast.error(`Failed for "${row.name}": ${error.message}`); continue }
          newCount++
        } else {
          const { error } = await supabase.from('repair_customers').update({
            outstanding_balance: row.balance || 0,
            ...(row.mobile ? { mobile: row.mobile } : {}),
            ...(row.address ? { address: row.address } : {}),
          }).eq('id', row.existing.id)
          if (error) { toast.error(`Failed for "${row.name}": ${error.message}`); continue }
          updateCount++
        }
      }
      toast.success(`Import complete: ${newCount} new customers, ${updateCount} updated`)
      setCustomerUploadPreview(null)
      fetchAll()
    } catch (err) {
      toast.error('Import failed: ' + err.message)
    }
    setCustomerUploading(false)
  }

  // ── Suppliers — manual save ──────────────────────────────────
  async function saveSuppliers() {
    setSaving(true)
    try {
      for (const s of suppliers) {
        const val = parseFloat(supplierBalances[s.id]) || 0
        if (val !== (s.opening_balance ?? s.outstanding_balance ?? 0)) {
          await supabase.from('repair_suppliers').update({ opening_balance: val, outstanding_balance: val }).eq('id', s.id)
        }
      }
      toast.success('Supplier balances saved!')
      fetchAll()
    } catch (e) {
      toast.error('Failed to save: ' + e.message)
    }
    setSaving(false)
  }

  // ── Suppliers — Excel upload ──────────────────────────────────
  function handleSupplierExcelUpload(e) {
    const file = e.target.files?.[0]
    if (supplierFileRef.current) supplierFileRef.current.value = ''
    if (!file) return
    const reader = new FileReader()
    reader.onload = (evt) => {
      try {
        const wb = XLSX.read(evt.target.result, { type: 'binary' })
        const ws = wb.Sheets[wb.SheetNames[0]]
        const allRows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' })
        if (!allRows.length) return toast.error('File is empty')
        const headers = allRows[0].map(h => String(h).trim().toLowerCase())
        const dataRows = allRows.slice(1).filter(r => r.some(v => v !== ''))
        const col = (candidates, fallback) => {
          for (const c of candidates) {
            const idx = headers.findIndex(h => h === c.toLowerCase() || h.includes(c.toLowerCase()))
            if (idx !== -1) return idx
          }
          return fallback
        }
        const colName    = col(['name', 'supplier name', 'supplier'], 0)
        const colBalance = col(['balance', 'outstanding', 'outstanding balance', 'amount', 'amount owed', 'payable'], 1)
        const colPhone   = col(['phone', 'mobile', 'contact'], 2)
        const colAddress = col(['address'], 3)
        const rows = dataRows.map(r => ({
          name: String(r[colName] || '').trim(),
          balance: parseFloat(r[colBalance]) || 0,
          phone: String(r[colPhone] || '').trim(),
          address: String(r[colAddress] || '').trim(),
        })).filter(r => r.name)
        if (!rows.length) return toast.error('No valid rows found. Ensure columns: Name, Balance')
        const matched = rows.map(r => {
          const existing = suppliers.find(s => s.name.toLowerCase() === r.name.toLowerCase())
          return { ...r, existing, status: existing ? 'update' : 'new' }
        })
        setSupplierUploadPreview(matched)
        toast.success(`${matched.length} rows parsed — ${matched.filter(r => r.status === 'new').length} new, ${matched.filter(r => r.status === 'update').length} updates`)
      } catch (err) {
        toast.error('Failed to parse file: ' + err.message)
      }
    }
    reader.readAsBinaryString(file)
  }

  async function commitSupplierUpload() {
    if (!supplierUploadPreview?.length) return
    setSupplierUploading(true)
    try {
      let newCount = 0, updateCount = 0
      for (const row of supplierUploadPreview) {
        if (row.status === 'new') {
          const supplier_no = await generateRepairSupplierNo()
          const { error } = await supabase.from('repair_suppliers').insert({
            supplier_no,
            name: row.name,
            phone: row.phone || null,
            address: row.address || null,
            opening_balance: row.balance || 0,
            outstanding_balance: row.balance || 0,
          })
          if (error) { toast.error(`Failed for "${row.name}": ${error.message}`); continue }
          newCount++
        } else {
          const { error } = await supabase.from('repair_suppliers').update({
            opening_balance: row.balance || 0,
            outstanding_balance: row.balance || 0,
            ...(row.phone ? { phone: row.phone } : {}),
            ...(row.address ? { address: row.address } : {}),
          }).eq('id', row.existing.id)
          if (error) { toast.error(`Failed for "${row.name}": ${error.message}`); continue }
          updateCount++
        }
      }
      toast.success(`Import complete: ${newCount} new suppliers, ${updateCount} updated`)
      setSupplierUploadPreview(null)
      fetchAll()
    } catch (err) {
      toast.error('Import failed: ' + err.message)
    }
    setSupplierUploading(false)
  }

  // ── Parts stock — manual save ──────────────────────────────────
  async function saveParts() {
    setSaving(true)
    try {
      for (const p of parts) {
        const qty = parseFloat(partQty[p.id]) || 0
        const cost = parseFloat(partCost[p.id]) || 0
        const selling = parseFloat(partSelling[p.id]) || 0
        const brand = (partBrand[p.id] || '').trim()
        const category = (partCategory[p.id] || '').trim()
        // The FIFO consumption used when a part is added to a repair job
        // (repair_fifo_consume) draws from repair_part_batches, not from
        // repair_parts.current_stock directly — setting current_stock alone
        // here left opening-balance stock with no batch to actually consume,
        // so a job using it got no real cost (or an incorrect one) instead of
        // the true opening cost. Only add a batch for genuinely NEW quantity —
        // re-saving this screen for a part whose stock hasn't changed shouldn't
        // create a duplicate batch each time.
        const qtyIncrease = qty - (p.current_stock || 0)
        await supabase.from('repair_parts').update({
          current_stock: qty,
          purchase_price: cost,
          average_cost: cost,
          ...(selling > 0 ? { selling_price: selling } : {}),
          brand: brand || null,
          category: category || null,
        }).eq('id', p.id)
        if (qtyIncrease > 0.009 && cost > 0) {
          await supabase.rpc('repair_fifo_add_batch', { p_part_id: p.id, p_purchase_id: null, p_quantity: qtyIncrease, p_unit_cost: cost })
        }
      }
      toast.success('Parts stock saved!')
      fetchAll()
    } catch (e) {
      toast.error('Failed to save: ' + e.message)
    }
    setSaving(false)
  }

  // ── Parts stock — Excel upload (includes Brand and Category columns) ────
  function handleExcelUpload(e) {
    const file = e.target.files?.[0]
    if (fileInputRef.current) fileInputRef.current.value = ''
    if (!file) return
    const reader = new FileReader()
    reader.onload = (evt) => {
      try {
        const wb = XLSX.read(evt.target.result, { type: 'binary' })
        const ws = wb.Sheets[wb.SheetNames[0]]
        const allRows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' })
        if (!allRows.length) return toast.error('Excel file is empty')
        const headers = allRows[0].map(h => String(h).trim().toLowerCase())
        const dataRows = allRows.slice(1).filter(r => r.some(v => v !== ''))
        const col = (candidates, fallbackIdx) => {
          for (const c of candidates) {
            const idx = headers.findIndex(h => h === c.toLowerCase() || h.includes(c.toLowerCase()))
            if (idx !== -1) return idx
          }
          return fallbackIdx
        }
        const colName     = col(['name', 'part name', 'part', 'description'], 0)
        const colQty      = col(['qty', 'quantity', 'stock', 'on hand', 'stock qty'], 1)
        const colCost     = col(['cost price', 'cost', 'unit cost', 'purchase price'], 2)
        const colSelling  = col(['selling price', 'sell price', 'sale price'], 3)
        const colBrand    = col(['brand'], 4)
        const colCategory = col(['category'], 5)
        const rows = dataRows.map(r => ({
          name: String(r[colName] || '').trim(),
          qty: parseFloat(r[colQty]) || 0,
          cost: parseFloat(r[colCost]) || 0,
          sellingPrice: parseFloat(r[colSelling]) || 0,
          brand: String(r[colBrand] || '').trim(),
          category: String(r[colCategory] || '').trim(),
        })).filter(r => r.name)
        if (!rows.length) return toast.error('No valid rows found. Ensure columns include: Name, Qty, Cost Price')
        const matched = rows.map(r => {
          const existing = parts.find(p => p.name.toLowerCase() === r.name.toLowerCase())
          return { ...r, existing, status: existing ? 'update' : 'new' }
        })
        setUploadPreview(matched)
        toast.success(`${matched.length} rows parsed — ${matched.filter(r => r.status === 'new').length} new parts, ${matched.filter(r => r.status === 'update').length} updates`)
      } catch (err) {
        toast.error('Failed to parse file: ' + err.message)
      }
    }
    reader.readAsBinaryString(file)
  }

  async function commitUpload() {
    if (!uploadPreview?.length) return
    setUploading(true)
    try {
      let newCount = 0, updateCount = 0
      for (const row of uploadPreview) {
        if (row.status === 'new') {
          const sku = await generateRepairPartSku()
          const { data: newPart, error } = await supabase.from('repair_parts').insert({
            sku,
            name: row.name,
            current_stock: row.qty || 0,
            purchase_price: row.cost || 0,
            average_cost: row.cost || 0,
            selling_price: row.sellingPrice || 0,
            brand: row.brand || null,
            category: row.category || null,
            shop_id: shop?.id || null,
          }).select().single()
          if (error) { toast.error(`Failed to create "${row.name}": ${error.message}`); continue }
          // Same FIFO batch requirement as saveParts() below — without this, a job
          // consuming this part's opening stock has no batch to draw a real cost from.
          if ((row.qty || 0) > 0.009 && (row.cost || 0) > 0) {
            await supabase.rpc('repair_fifo_add_batch', { p_part_id: newPart.id, p_purchase_id: null, p_quantity: row.qty, p_unit_cost: row.cost })
          }
          newCount++
        } else {
          const p = row.existing
          const qtyIncrease = (row.qty || 0) - (p.current_stock || 0)
          const costForBatch = row.cost > 0 ? row.cost : p.purchase_price
          const { error } = await supabase.from('repair_parts').update({
            current_stock: row.qty,
            purchase_price: row.cost > 0 ? row.cost : p.purchase_price,
            average_cost: row.cost > 0 ? row.cost : p.average_cost,
            selling_price: row.sellingPrice || p.selling_price || 0,
            brand: row.brand || p.brand || null,
            category: row.category || p.category || null,
          }).eq('id', p.id)
          if (error) { toast.error(`Failed to update "${row.name}": ${error.message}`); continue }
          if (qtyIncrease > 0.009 && costForBatch > 0) {
            await supabase.rpc('repair_fifo_add_batch', { p_part_id: p.id, p_purchase_id: null, p_quantity: qtyIncrease, p_unit_cost: costForBatch })
          }
          updateCount++
        }
      }
      toast.success(`Import complete: ${newCount} new parts created, ${updateCount} updated`)
      setUploadPreview(null)
      fetchAll()
    } catch (err) {
      toast.error('Import failed: ' + err.message)
    }
    setUploading(false)
  }

  function downloadPartsTemplate() {
    const ws = XLSX.utils.aoa_to_sheet([
      ['Name', 'Qty', 'Cost Price', 'Selling Price', 'Brand', 'Category'],
      ['iPhone 12 Screen (OLED)', 10, 4500, 6500, 'Apple', 'Displays'],
      ['Samsung A12 Battery', 25, 800, 1400, 'Samsung', 'Batteries'],
    ])
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Parts')
    XLSX.writeFile(wb, 'repair_parts_opening_stock_template.xlsx')
  }

  function downloadCustomerTemplate() {
    const ws = XLSX.utils.aoa_to_sheet([
      ['Name', 'Balance', 'Mobile', 'Address'],
      ['Kasun Perera', 3500, '0771234567', 'No. 12, Main Street'],
    ])
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Customers')
    XLSX.writeFile(wb, 'repair_customer_balances_template.xlsx')
  }

  function downloadSupplierTemplate() {
    const ws = XLSX.utils.aoa_to_sheet([
      ['Name', 'Balance', 'Phone', 'Address'],
      ['ABC Parts Distributors', 12000, '0112345678', 'Colombo 03'],
    ])
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Suppliers')
    XLSX.writeFile(wb, 'repair_supplier_balances_template.xlsx')
  }

  const filteredCustomers = customers.filter(c => !customerSearch || c.name.toLowerCase().includes(customerSearch.toLowerCase()))
  const filteredSuppliers = suppliers.filter(s => !supplierSearch || s.name.toLowerCase().includes(supplierSearch.toLowerCase()))
  const filteredParts = parts.filter(p => !partSearch || p.name.toLowerCase().includes(partSearch.toLowerCase()) || p.sku?.toLowerCase().includes(partSearch.toLowerCase()))

  const btnPrimary = { padding: '9px 20px', background: 'linear-gradient(135deg,#d4881f,#b8721a)', color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: '700', fontSize: '13px' }
  const btnSecondary = { padding: '9px 16px', background: '#f1f5f9', color: '#64748b', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: '600', fontSize: '13px' }

  return (
    <div>
      <div style={{ marginBottom: '20px' }}>
        <h1 style={{ fontSize: '22px', fontWeight: '700', color: '#1c1917', margin: '0 0 4px' }}>Repair Division — Opening Balances</h1>
        <p style={{ color: '#8a7a63', fontSize: '14px', margin: 0 }}>Set starting balances for cash, customers, suppliers and parts stock — via manual entry or Excel upload</p>
      </div>

      <div style={{ display: 'flex', gap: '4px', marginBottom: '20px', background: '#f1ede4', padding: '4px', borderRadius: '10px', width: 'fit-content', flexWrap: 'wrap' }}>
        {TABS.map(tab => (
          <button key={tab.id} onClick={() => setActiveTab(tab.id)}
            style={{ padding: '8px 18px', borderRadius: '8px', border: 'none', cursor: 'pointer', fontSize: '13px', fontWeight: '600', background: activeTab === tab.id ? 'white' : 'transparent', color: activeTab === tab.id ? '#1c1917' : '#8a7a63', boxShadow: activeTab === tab.id ? '0 1px 3px rgba(0,0,0,0.1)' : 'none', whiteSpace: 'nowrap' }}>
            {tab.icon} {tab.label}
          </button>
        ))}
      </div>

      {/* ── Cash in Hand ─────────────────────────────────────── */}
      {activeTab === 'cash' && (
        <div style={{ background: 'white', borderRadius: '12px', padding: '24px', boxShadow: '0 1px 3px rgba(0,0,0,0.06)', maxWidth: '480px' }}>
          <h3 style={{ margin: '0 0 4px', fontSize: '16px', fontWeight: '700', color: '#1c1917' }}>Cash in Hand — {shop?.name || 'this shop'}</h3>
          <p style={{ margin: '0 0 20px', fontSize: '13px', color: '#8a7a63' }}>
            {existingOpeningRow ? 'An opening balance is already set — editing here updates it.' : 'This creates a one-time opening entry in the cash ledger.'}
          </p>
          <label style={lbl}>Opening Cash (LKR)</label>
          <input type="number" value={openingCash} onChange={e => setOpeningCash(e.target.value)} placeholder="0" min="0" step="1" style={{ ...inp, fontSize: '18px', fontWeight: '700', marginBottom: '20px' }} />
          <button onClick={saveCash} disabled={saving} style={btnPrimary}>{saving ? 'Saving…' : 'Save Opening Cash'}</button>
        </div>
      )}

      {/* ── Customers ─────────────────────────────────────────── */}
      {activeTab === 'customers' && (
        <div>
          <div style={{ background: 'white', borderRadius: '12px', padding: '20px', boxShadow: '0 1px 3px rgba(0,0,0,0.06)', marginBottom: '20px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px', flexWrap: 'wrap', gap: '10px' }}>
              <h3 style={{ margin: 0, fontSize: '16px', fontWeight: '700', color: '#1c1917' }}>Bulk Upload (Excel)</h3>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button onClick={downloadCustomerTemplate} style={btnSecondary}>⬇ Download Template</button>
                <button onClick={() => customerFileRef.current?.click()} style={btnPrimary}>⬆ Upload Excel</button>
                <input ref={customerFileRef} type="file" accept=".xlsx,.xls,.csv" onChange={handleCustomerExcelUpload} style={{ display: 'none' }} />
              </div>
            </div>
            <p style={{ margin: 0, fontSize: '13px', color: '#8a7a63' }}>Columns: Name, Balance, Mobile, Address. Matches existing customers by name (case-insensitive) — everything else creates a new customer. Mobile is required for new customers.</p>

            {customerUploadPreview && (
              <div style={{ marginTop: '16px', border: '1.5px solid #fde68a', borderRadius: '10px', padding: '14px', background: '#fffbeb' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '10px' }}>
                  <strong style={{ fontSize: '13px' }}>{customerUploadPreview.length} rows ready — {customerUploadPreview.filter(r => r.status === 'new').length} new, {customerUploadPreview.filter(r => r.status === 'update').length} updates</strong>
                  <button onClick={() => setCustomerUploadPreview(null)} style={{ background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer', fontSize: '13px' }}>✕ Discard</button>
                </div>
                <div style={{ maxHeight: '260px', overflowY: 'auto', marginBottom: '12px' }}>
                  <table style={{ width: '100%', fontSize: '12px', borderCollapse: 'collapse' }}>
                    <thead><tr style={{ textAlign: 'left', color: '#92400e' }}><th>Name</th><th>Balance</th><th>Mobile</th><th>Status</th></tr></thead>
                    <tbody>
                      {customerUploadPreview.map((r, i) => (
                        <tr key={i} style={{ borderTop: '1px solid #fde68a' }}>
                          <td style={{ padding: '4px 0' }}>{r.name}</td>
                          <td>{formatLKR(r.balance)}</td>
                          <td>{r.mobile || '—'}</td>
                          <td style={{ color: r.status === 'new' ? '#059669' : '#2563eb', fontWeight: '700' }}>{r.status}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <button onClick={commitCustomerUpload} disabled={customerUploading} style={btnPrimary}>{customerUploading ? 'Importing…' : `Confirm Import (${customerUploadPreview.length} rows)`}</button>
              </div>
            )}
          </div>

          <div style={{ background: 'white', borderRadius: '12px', boxShadow: '0 1px 3px rgba(0,0,0,0.06)', overflow: 'hidden' }}>
            <div style={{ padding: '14px 16px', borderBottom: '1px solid #f1ede4' }}>
              <input type="text" placeholder="Search customer…" value={customerSearch} onChange={e => setCustomerSearch(e.target.value)} style={inp} />
            </div>
            <div style={{ maxHeight: '440px', overflowY: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr style={{ background: '#f8f5f0', position: 'sticky', top: 0 }}>
                  {['Customer No', 'Name', 'Mobile', 'Balance (LKR)'].map(h => <th key={h} style={{ padding: '10px 14px', textAlign: 'left', fontSize: '11px', fontWeight: '700', color: '#8a7a63', textTransform: 'uppercase' }}>{h}</th>)}
                </tr></thead>
                <tbody>
                  {filteredCustomers.map(c => (
                    <tr key={c.id} style={{ borderTop: '1px solid #f1ede4' }}>
                      <td style={{ padding: '9px 14px', color: '#d4881f', fontWeight: '700', fontSize: '13px' }}>{c.customer_no}</td>
                      <td style={{ padding: '9px 14px', fontSize: '14px' }}>{c.name}</td>
                      <td style={{ padding: '9px 14px', fontSize: '13px', color: '#8a7a63' }}>{c.mobile}</td>
                      <td style={{ padding: '9px 14px' }}>
                        <input type="number" value={customerBalances[c.id] || ''} onChange={e => setCustomerBalances(p => ({ ...p, [c.id]: e.target.value }))} placeholder="0" style={{ ...inp, width: '140px' }} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div style={{ padding: '14px 16px', borderTop: '1px solid #f1ede4' }}>
              <button onClick={saveCustomers} disabled={saving} style={btnPrimary}>{saving ? 'Saving…' : 'Save All Balances'}</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Suppliers ─────────────────────────────────────────── */}
      {activeTab === 'suppliers' && (
        <div>
          <div style={{ background: 'white', borderRadius: '12px', padding: '20px', boxShadow: '0 1px 3px rgba(0,0,0,0.06)', marginBottom: '20px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px', flexWrap: 'wrap', gap: '10px' }}>
              <h3 style={{ margin: 0, fontSize: '16px', fontWeight: '700', color: '#1c1917' }}>Bulk Upload (Excel)</h3>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button onClick={downloadSupplierTemplate} style={btnSecondary}>⬇ Download Template</button>
                <button onClick={() => supplierFileRef.current?.click()} style={btnPrimary}>⬆ Upload Excel</button>
                <input ref={supplierFileRef} type="file" accept=".xlsx,.xls,.csv" onChange={handleSupplierExcelUpload} style={{ display: 'none' }} />
              </div>
            </div>
            <p style={{ margin: 0, fontSize: '13px', color: '#8a7a63' }}>Columns: Name, Balance, Phone, Address. Matches existing suppliers by name (case-insensitive) — everything else creates a new supplier.</p>

            {supplierUploadPreview && (
              <div style={{ marginTop: '16px', border: '1.5px solid #fde68a', borderRadius: '10px', padding: '14px', background: '#fffbeb' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '10px' }}>
                  <strong style={{ fontSize: '13px' }}>{supplierUploadPreview.length} rows ready — {supplierUploadPreview.filter(r => r.status === 'new').length} new, {supplierUploadPreview.filter(r => r.status === 'update').length} updates</strong>
                  <button onClick={() => setSupplierUploadPreview(null)} style={{ background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer', fontSize: '13px' }}>✕ Discard</button>
                </div>
                <div style={{ maxHeight: '260px', overflowY: 'auto', marginBottom: '12px' }}>
                  <table style={{ width: '100%', fontSize: '12px', borderCollapse: 'collapse' }}>
                    <thead><tr style={{ textAlign: 'left', color: '#92400e' }}><th>Name</th><th>Balance</th><th>Phone</th><th>Status</th></tr></thead>
                    <tbody>
                      {supplierUploadPreview.map((r, i) => (
                        <tr key={i} style={{ borderTop: '1px solid #fde68a' }}>
                          <td style={{ padding: '4px 0' }}>{r.name}</td>
                          <td>{formatLKR(r.balance)}</td>
                          <td>{r.phone || '—'}</td>
                          <td style={{ color: r.status === 'new' ? '#059669' : '#2563eb', fontWeight: '700' }}>{r.status}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <button onClick={commitSupplierUpload} disabled={supplierUploading} style={btnPrimary}>{supplierUploading ? 'Importing…' : `Confirm Import (${supplierUploadPreview.length} rows)`}</button>
              </div>
            )}
          </div>

          <div style={{ background: 'white', borderRadius: '12px', boxShadow: '0 1px 3px rgba(0,0,0,0.06)', overflow: 'hidden' }}>
            <div style={{ padding: '14px 16px', borderBottom: '1px solid #f1ede4' }}>
              <input type="text" placeholder="Search supplier…" value={supplierSearch} onChange={e => setSupplierSearch(e.target.value)} style={inp} />
            </div>
            <div style={{ maxHeight: '440px', overflowY: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr style={{ background: '#f8f5f0', position: 'sticky', top: 0 }}>
                  {['Supplier No', 'Name', 'Balance (LKR)'].map(h => <th key={h} style={{ padding: '10px 14px', textAlign: 'left', fontSize: '11px', fontWeight: '700', color: '#8a7a63', textTransform: 'uppercase' }}>{h}</th>)}
                </tr></thead>
                <tbody>
                  {filteredSuppliers.map(s => (
                    <tr key={s.id} style={{ borderTop: '1px solid #f1ede4' }}>
                      <td style={{ padding: '9px 14px', color: '#d4881f', fontWeight: '700', fontSize: '13px' }}>{s.supplier_no}</td>
                      <td style={{ padding: '9px 14px', fontSize: '14px' }}>{s.name}</td>
                      <td style={{ padding: '9px 14px' }}>
                        <input type="number" value={supplierBalances[s.id] || ''} onChange={e => setSupplierBalances(p => ({ ...p, [s.id]: e.target.value }))} placeholder="0" style={{ ...inp, width: '140px' }} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div style={{ padding: '14px 16px', borderTop: '1px solid #f1ede4' }}>
              <button onClick={saveSuppliers} disabled={saving} style={btnPrimary}>{saving ? 'Saving…' : 'Save All Balances'}</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Parts Stock (includes Brand and Category) ────────────── */}
      {activeTab === 'inventory' && (
        <div>
          <div style={{ background: 'white', borderRadius: '12px', padding: '20px', boxShadow: '0 1px 3px rgba(0,0,0,0.06)', marginBottom: '20px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px', flexWrap: 'wrap', gap: '10px' }}>
              <h3 style={{ margin: 0, fontSize: '16px', fontWeight: '700', color: '#1c1917' }}>Bulk Upload (Excel)</h3>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button onClick={downloadPartsTemplate} style={btnSecondary}>⬇ Download Template</button>
                <button onClick={() => fileInputRef.current?.click()} style={btnPrimary}>⬆ Upload Excel</button>
                <input ref={fileInputRef} type="file" accept=".xlsx,.xls,.csv" onChange={handleExcelUpload} style={{ display: 'none' }} />
              </div>
            </div>
            <p style={{ margin: 0, fontSize: '13px', color: '#8a7a63' }}>Columns: Name, Qty, Cost Price, Selling Price, Brand, Category. Brand and Category are optional free text — matches existing parts by name (case-insensitive), everything else creates a new part.</p>

            {uploadPreview && (
              <div style={{ marginTop: '16px', border: '1.5px solid #fde68a', borderRadius: '10px', padding: '14px', background: '#fffbeb' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '10px' }}>
                  <strong style={{ fontSize: '13px' }}>{uploadPreview.length} rows ready — {uploadPreview.filter(r => r.status === 'new').length} new, {uploadPreview.filter(r => r.status === 'update').length} updates</strong>
                  <button onClick={() => setUploadPreview(null)} style={{ background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer', fontSize: '13px' }}>✕ Discard</button>
                </div>
                <div style={{ maxHeight: '280px', overflowY: 'auto', marginBottom: '12px' }}>
                  <table style={{ width: '100%', fontSize: '12px', borderCollapse: 'collapse' }}>
                    <thead><tr style={{ textAlign: 'left', color: '#92400e' }}><th>Name</th><th>Qty</th><th>Cost</th><th>Selling</th><th>Brand</th><th>Category</th><th>Status</th></tr></thead>
                    <tbody>
                      {uploadPreview.map((r, i) => (
                        <tr key={i} style={{ borderTop: '1px solid #fde68a' }}>
                          <td style={{ padding: '4px 0' }}>{r.name}</td>
                          <td>{r.qty}</td>
                          <td>{formatLKR(r.cost)}</td>
                          <td>{formatLKR(r.sellingPrice)}</td>
                          <td>{r.brand || '—'}</td>
                          <td>{r.category || '—'}</td>
                          <td style={{ color: r.status === 'new' ? '#059669' : '#2563eb', fontWeight: '700' }}>{r.status}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <button onClick={commitUpload} disabled={uploading} style={btnPrimary}>{uploading ? 'Importing…' : `Confirm Import (${uploadPreview.length} rows)`}</button>
              </div>
            )}
          </div>

          <div style={{ background: 'white', borderRadius: '12px', boxShadow: '0 1px 3px rgba(0,0,0,0.06)', overflow: 'hidden' }}>
            <div style={{ padding: '14px 16px', borderBottom: '1px solid #f1ede4' }}>
              <input type="text" placeholder="Search part name or SKU…" value={partSearch} onChange={e => setPartSearch(e.target.value)} style={inp} />
            </div>
            <div style={{ maxHeight: '480px', overflowY: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr style={{ background: '#f8f5f0', position: 'sticky', top: 0 }}>
                  {['SKU', 'Name', 'Qty', 'Cost (LKR)', 'Selling (LKR)', 'Brand', 'Category'].map(h => <th key={h} style={{ padding: '10px 12px', textAlign: 'left', fontSize: '11px', fontWeight: '700', color: '#8a7a63', textTransform: 'uppercase', whiteSpace: 'nowrap' }}>{h}</th>)}
                </tr></thead>
                <tbody>
                  {filteredParts.map(p => (
                    <tr key={p.id} style={{ borderTop: '1px solid #f1ede4' }}>
                      <td style={{ padding: '8px 12px', color: '#d4881f', fontWeight: '700', fontSize: '12px' }}>{p.sku}</td>
                      <td style={{ padding: '8px 12px', fontSize: '13px' }}>{p.name}</td>
                      <td style={{ padding: '8px 12px' }}><input type="number" value={partQty[p.id] || ''} onChange={e => setPartQty(x => ({ ...x, [p.id]: e.target.value }))} placeholder="0" style={{ ...inp, width: '80px' }} /></td>
                      <td style={{ padding: '8px 12px' }}><input type="number" value={partCost[p.id] || ''} onChange={e => setPartCost(x => ({ ...x, [p.id]: e.target.value }))} placeholder="0" style={{ ...inp, width: '100px' }} /></td>
                      <td style={{ padding: '8px 12px' }}><input type="number" value={partSelling[p.id] || ''} onChange={e => setPartSelling(x => ({ ...x, [p.id]: e.target.value }))} placeholder="0" style={{ ...inp, width: '100px' }} /></td>
                      <td style={{ padding: '8px 12px' }}>
                        <input type="text" list="repair-brand-list" value={partBrand[p.id] || ''} onChange={e => setPartBrand(x => ({ ...x, [p.id]: e.target.value }))} placeholder="Optional" style={{ ...inp, width: '120px' }} />
                      </td>
                      <td style={{ padding: '8px 12px' }}>
                        <input type="text" list="repair-category-list" value={partCategory[p.id] || ''} onChange={e => setPartCategory(x => ({ ...x, [p.id]: e.target.value }))} placeholder="Optional" style={{ ...inp, width: '130px' }} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <datalist id="repair-brand-list">{brands.map(b => <option key={b} value={b} />)}</datalist>
              <datalist id="repair-category-list">{categories.map(c => <option key={c} value={c} />)}</datalist>
            </div>
            <div style={{ padding: '14px 16px', borderTop: '1px solid #f1ede4' }}>
              <button onClick={saveParts} disabled={saving} style={btnPrimary}>{saving ? 'Saving…' : 'Save All'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
