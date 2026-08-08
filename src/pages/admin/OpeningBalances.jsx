import { useState, useEffect, useRef } from 'react'
import { supabase } from '../../supabase'
import { formatCurrency, generateItemNo, generateCustomerNo, generateSupplierNo } from '../../lib/helpers'
import toast from 'react-hot-toast'
import * as XLSX from 'xlsx'

const TABS = [
  { id: 'bank',        icon: '🏦', label: 'Cash & Bank',            desc: 'Set opening balances for all bank accounts and cash in hand' },
  { id: 'customers',   icon: '👥', label: 'Customer Receivables',   desc: 'Enter what each customer owes you' },
  { id: 'suppliers',   icon: '🏭', label: 'Supplier Payables',      desc: 'Enter what you owe each supplier' },
  { id: 'inventory',   icon: '📦', label: 'Inventory Stock Count',  desc: 'Set opening quantity and cost for each item' },
  { id: 'shop_prices', icon: '🏷', label: 'Shop Retail Prices',     desc: 'Set per-shop selling price and minimum price for retail stores' },
]

export default function OpeningBalances({ session, shops = [], isSuperAdmin = false }) {
  const [activeTab, setActiveTab] = useState('bank')
  const [completedTabs, setCompletedTabs] = useState({})
  const [saving, setSaving] = useState(false)

  // Bank tab
  const [bankAccounts, setBankAccounts] = useState([])
  const [bankBalances, setBankBalances] = useState({}) // { id: balance string }
  const [shopCashInHand, setShopCashInHand] = useState({}) // { shop_id: balance string }

  // Customers tab
  const [customers, setCustomers] = useState([])
  const [customerBalances, setCustomerBalances] = useState({}) // { id: balance string }
  const [customerSearch, setCustomerSearch] = useState('')
  const [customerUploadPreview, setCustomerUploadPreview] = useState(null)
  const [customerUploading, setCustomerUploading] = useState(false)
  const customerFileRef = useRef(null)

  // Suppliers tab
  const [suppliers, setSuppliers] = useState([])
  const [supplierBalances, setSupplierBalances] = useState({}) // { id: balance string }
  const [supplierSearch, setSupplierSearch] = useState('')
  const [supplierUploadPreview, setSupplierUploadPreview] = useState(null)
  const [supplierUploading, setSupplierUploading] = useState(false)
  const supplierFileRef = useRef(null)

  // Inventory tab
  const [items, setItems] = useState([])
  const [itemQty, setItemQty] = useState({})        // { id: qty string }
  const [itemCost, setItemCost] = useState({})       // { id: cost string }
  const [itemSelling, setItemSelling] = useState({}) // { id: selling price string }
  const [itemLastPrice, setItemLastPrice] = useState({}) // { id: last price string }
  const [itemSearch, setItemSearch] = useState('')
  const [inventoryShopId, setInventoryShopId] = useState('')  // which shop gets the opening stock
  const [shopPriceShopId, setShopPriceShopId] = useState('')  // which shop to set retail prices for
  const [shopPricePreview, setShopPricePreview] = useState(null)
  const [shopPriceUploading, setShopPriceUploading] = useState(false)
  const shopPriceFileRef = useRef(null)
  // Initialise inventoryShopId when shops load
  useEffect(() => { if (shops?.length > 0 && !inventoryShopId) setInventoryShopId(shops[0].id) }, [shops])
  useEffect(() => {
    if (shops?.length > 0 && !shopPriceShopId) {
      // Default to first non-iPHIX Technologies shop (retail shop)
      const retail = shops.find(s => s.name !== 'iPHIX Technologies') || shops[0]
      setShopPriceShopId(retail.id)
    }
  }, [shops])
  const [uploadPreview, setUploadPreview] = useState(null)   // parsed rows before committing
  const [uploading, setUploading] = useState(false)
  const fileInputRef = useRef(null)

  useEffect(() => { fetchAll() }, [])

  async function fetchAll() {
    const [{ data: banks }, { data: custs }, { data: sups }, { data: itms }] = await Promise.all([
      supabase.from('bank_accounts').select('*').order('name'),
      supabase.from('customers').select('id, name, customer_no, credit_balance').order('name'),
      supabase.from('suppliers').select('id, name, supplier_no, outstanding_balance').order('name'),
      supabase.from('items').select('id, name, item_no, barcode, stock_quantity, cost_price, selling_price, last_price').order('name'),
    ])
    const logs = []  // opening_balance_log table removed
    setBankAccounts(banks || [])
    // Pre-fill shop cash in hand
    const sCash = {}
    for (const s of (shops || [])) sCash[s.id] = s.cash_in_hand > 0 ? String(s.cash_in_hand) : ''
    setShopCashInHand(sCash)
    // Set default inventory shop to first shop
    if (shops?.length > 0) setInventoryShopId(prev => prev || shops[0].id)
    setCustomers(custs || [])
    setSuppliers(sups || [])
    setItems(itms || [])

    // Pre-fill with existing values
    const bBal = {}
    for (const b of (banks || [])) bBal[b.id] = String(b.balance || '')
    setBankBalances(bBal)

    const cBal = {}
    for (const c of (custs || [])) cBal[c.id] = c.credit_balance > 0 ? String(c.credit_balance) : ''
    setCustomerBalances(cBal)

    const sBal = {}
    for (const s of (sups || [])) sBal[s.id] = s.outstanding_balance > 0 ? String(s.outstanding_balance) : ''
    setSupplierBalances(sBal)

    const iQty = {}, iCost = {}, iSelling = {}, iLastPrice = {}
    for (const i of (itms || [])) {
      iQty[i.id] = i.stock_quantity > 0 ? String(i.stock_quantity) : ''
      iCost[i.id] = i.cost_price > 0 ? String(i.cost_price) : ''
      iSelling[i.id] = i.selling_price > 0 ? String(i.selling_price) : ''
      iLastPrice[i.id] = i.last_price > 0 ? String(i.last_price) : ''
    }
    setItemQty(iQty)
    setItemCost(iCost)
    setItemSelling(iSelling)
    setItemLastPrice(iLastPrice)

    // Mark completed tabs
    const done = {}
    for (const log of (logs || [])) done[log.tab] = log.completed_at
    setCompletedTabs(done)
  }

  function generateOpeningBarcode(itemNo) {
    // Format: PF00000XXXXX where XXXXX is the item number digits
    const i = itemNo.replace('ITM-', '').padStart(5, '0')
    return `PF0000${i}`
  }

  function handleExcelUpload(e) {
    const file = e.target.files?.[0]
    if (!fileInputRef.current) return
    fileInputRef.current.value = ''  // reset so same file can be re-uploaded
    if (!file) return
    const reader = new FileReader()
    reader.onload = (evt) => {
      try {
        const wb = XLSX.read(evt.target.result, { type: 'binary' })
        const ws = wb.Sheets[wb.SheetNames[0]]
        // Parse as array-of-arrays to guarantee column order (header:1 returns rows as arrays)
        const allRows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' })
        if (!allRows.length) return toast.error('Excel file is empty')

        // First row is headers, rest are data
        const headers = allRows[0].map(h => String(h).trim().toLowerCase())
        const dataRows = allRows.slice(1).filter(r => r.some(v => v !== ''))



        // Find column index by header name (with fallback to column position)
        const col = (candidates, fallbackIdx) => {
          for (const c of candidates) {
            const idx = headers.findIndex(h => h === c.toLowerCase() || h.includes(c.toLowerCase()))
            if (idx !== -1) return idx
          }
          return fallbackIdx // positional fallback
        }

        const colName    = col(['name', 'item name', 'item', 'description', 'product'], 0)
        const colQty     = col(['qty', 'quantity', 'stock', 'on hand', 'stock qty'], 1)
        const colCost    = col(['cost price', 'cost', 'unit cost', 'cost_price'], 2)
        const colSelling = col(['selling price', 'selling_price', 'sell price', 'sale price'], 3)
        const colLast    = col(['last price', 'last_price', 'min price', 'minimum price', 'floor price', 'min selling price'], 4)



        const rows = dataRows.map(r => ({
          name: String(r[colName] || '').trim(),
          qty: parseFloat(r[colQty]) || 0,
          cost: parseFloat(r[colCost]) || 0,
          sellingPrice: parseFloat(r[colSelling]) || 0,
          lastPrice: parseFloat(r[colLast]) || 0,
        })).filter(r => r.name)

        if (!rows.length) return toast.error('No valid rows found. Ensure columns include: Name, Qty, Cost Price')

        // Match against existing items by name (case-insensitive)
        const matched = rows.map(r => {
          const existing = items.find(i => i.name.toLowerCase() === r.name.toLowerCase())
          return { ...r, existing, status: existing ? 'update' : 'new' }
        })

        setUploadPreview(matched)
        toast.success(`${matched.length} rows parsed — ${matched.filter(r => r.status === 'new').length} new items, ${matched.filter(r => r.status === 'update').length} updates`)
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
      const shopId = inventoryShopId || shops[0]?.id || null
      if (!shopId) { toast.error('Please select a shop before importing'); setUploading(false); return }
      let newCount = 0, updateCount = 0

      for (const row of uploadPreview) {
        if (row.status === 'new') {
          // Create new item with auto-generated item_no
          const item_no = await generateItemNo()
          const barcode = generateOpeningBarcode(item_no)
          const { data: newItem, error } = await supabase.from('items').insert({
            item_no,
            name: row.name,
            barcode,
            cost_price: row.cost || 0,
            selling_price: row.sellingPrice || 0,
            last_price: row.lastPrice || 0,
            stock_quantity: row.qty || 0,
          }).select().single()
          if (error) { toast.error(`Failed to create "${row.name}": ${error.message}`); continue }

          // Insert inventory record with shop
          if (row.qty > 0) {
            const { error: invErr } = await supabase.from('inventory').insert({
              item_id: newItem.id,
              shop_id: shopId,
              quantity: row.qty,
              cost_price: row.cost || 0,
            })
            if (invErr) toast.error(`Inventory error for "${row.name}": ${invErr.message}`)
          }
          newCount++
        } else {
          // Update existing item — also generate barcode if missing
          const item = row.existing
          const missingBarcode = !item.barcode ? { barcode: generateOpeningBarcode(item.item_no) } : {}
          await supabase.from('items').update({
            stock_quantity: row.qty,
            cost_price: row.cost > 0 ? row.cost : item.cost_price,
            selling_price: row.sellingPrice || item.selling_price || 0,
            last_price: row.lastPrice || item.last_price || 0,
            ...missingBarcode,
          }).eq('id', item.id)

          // Remove any previous opening-balance inventory rows for this item in this shop
          // (no notes column — identify by matching shop_id and zero-sales pattern isn't reliable,
          //  so we delete all inventory rows for this shop and re-insert cleanly)
          await supabase.from('inventory').delete().eq('item_id', item.id).eq('shop_id', shopId)
          if (row.qty > 0) {
            const { error: invErr2 } = await supabase.from('inventory').insert({
              item_id: item.id,
              shop_id: shopId,
              quantity: row.qty,
              cost_price: row.cost > 0 ? row.cost : item.cost_price,
            })
            if (invErr2) toast.error(`Inventory error for "${row.name}": ${invErr2.message}`)
          }
          updateCount++
        }
      }

      toast.success(`Import complete: ${newCount} new items created, ${updateCount} items updated`)
      setUploadPreview(null)
      fetchAll()  // refresh the full item list and qty/cost inputs
    } catch (err) {
      toast.error('Import failed: ' + err.message)
    }
    setUploading(false)
  }

  // ── Customer opening balances — Excel/CSV import ──────────────
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
        const colBalance = col(['balance', 'outstanding', 'outstanding balance', 'amount', 'amount owed', 'receivable'], 1)
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
          const existing = customers.find(c => c.name.toLowerCase() === r.name.toLowerCase())
          return { ...r, existing, status: existing ? 'update' : 'new' }
        })
        setCustomerUploadPreview(matched)
        toast.success(`${matched.length} rows parsed — ${matched.filter(r => r.status === 'new').length} new customers, ${matched.filter(r => r.status === 'update').length} updates`)
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
          const customer_no = await generateCustomerNo()
          const { error } = await supabase.from('customers').insert({
            customer_no,
            name: row.name,
            phone: row.phone || null,
            address: row.address || null,
            credit_balance: row.balance || 0,
            opening_balance: row.balance || 0,
          })
          if (error) { toast.error(`Failed for "${row.name}": ${error.message}`); continue }
          newCount++
        } else {
          const { error } = await supabase.from('customers').update({
            credit_balance: row.balance || 0,
            opening_balance: row.balance || 0,
            ...(row.phone ? { phone: row.phone } : {}),
            ...(row.address ? { address: row.address } : {}),
          }).eq('id', row.existing.id)
          if (error) { toast.error(`Failed for "${row.name}": ${error.message}`); continue }
          updateCount++
        }
      }
      toast.success(`Import complete: ${newCount} new customers created, ${updateCount} updated`)
      setCustomerUploadPreview(null)
      fetchAll()
    } catch (err) {
      toast.error('Import failed: ' + err.message)
    }
    setCustomerUploading(false)
  }

  // ── Supplier opening balances — Excel/CSV import ──────────────
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
        const colEmail   = col(['email'], 3)
        const colAddress = col(['address'], 4)
        const rows = dataRows.map(r => ({
          name: String(r[colName] || '').trim(),
          balance: parseFloat(r[colBalance]) || 0,
          phone: String(r[colPhone] || '').trim(),
          email: String(r[colEmail] || '').trim(),
          address: String(r[colAddress] || '').trim(),
        })).filter(r => r.name)
        if (!rows.length) return toast.error('No valid rows found. Ensure columns: Name, Balance')
        const matched = rows.map(r => {
          const existing = suppliers.find(s => s.name.toLowerCase() === r.name.toLowerCase())
          return { ...r, existing, status: existing ? 'update' : 'new' }
        })
        setSupplierUploadPreview(matched)
        toast.success(`${matched.length} rows parsed — ${matched.filter(r => r.status === 'new').length} new suppliers, ${matched.filter(r => r.status === 'update').length} updates`)
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
          const supplier_no = await generateSupplierNo()
          const { error } = await supabase.from('suppliers').insert({
            supplier_no,
            name: row.name,
            phone: row.phone || null,
            email: row.email || null,
            address: row.address || null,
            outstanding_balance: row.balance || 0,
            opening_balance: row.balance || 0,
          })
          if (error) { toast.error(`Failed for "${row.name}": ${error.message}`); continue }
          newCount++
        } else {
          const { error } = await supabase.from('suppliers').update({
            outstanding_balance: row.balance || 0,
            opening_balance: row.balance || 0,
            ...(row.phone ? { phone: row.phone } : {}),
            ...(row.email ? { email: row.email } : {}),
            ...(row.address ? { address: row.address } : {}),
          }).eq('id', row.existing.id)
          if (error) { toast.error(`Failed for "${row.name}": ${error.message}`); continue }
          updateCount++
        }
      }
      toast.success(`Import complete: ${newCount} new suppliers created, ${updateCount} updated`)
      setSupplierUploadPreview(null)
      fetchAll()
    } catch (err) {
      toast.error('Import failed: ' + err.message)
    }
    setSupplierUploading(false)
  }

  function handleShopPriceUpload(e) {
    const file = e.target.files?.[0]
    if (shopPriceFileRef.current) shopPriceFileRef.current.value = ''
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
        const colName     = col(['name', 'item name', 'item', 'description'], 0)
        const colSelling  = col(['selling price', 'retail price', 'shop price', 'selling_price', 'price'], 1)
        const colLast     = col(['last price', 'last_price', 'min price', 'minimum price', 'floor price'], 2)
        const rows = dataRows.map(r => ({
          name: String(r[colName] || '').trim(),
          sellingPrice: parseFloat(r[colSelling]) || 0,
          lastPrice: parseFloat(r[colLast]) || 0,
        })).filter(r => r.name)
        if (!rows.length) return toast.error('No valid rows found. Ensure columns: Name, Selling Price, Last Price')
        const matched = rows.map(r => {
          const existing = items.find(i => i.name.toLowerCase() === r.name.toLowerCase())
          return { ...r, existing, status: existing ? 'match' : 'not_found' }
        })
        setShopPricePreview(matched)
        const found = matched.filter(r => r.status === 'match').length
        toast.success(`${matched.length} rows parsed — ${found} items matched, ${matched.length - found} not found`)
      } catch (err) { toast.error('Failed to parse: ' + err.message) }
    }
    reader.readAsBinaryString(file)
  }

  async function commitShopPriceUpload() {
    if (!shopPricePreview?.length) return
    if (!shopPriceShopId) return toast.error('Select a shop first')
    setShopPriceUploading(true)
    try {
      const matched = shopPricePreview.filter(r => r.status === 'match')
      for (const row of matched) {
        await supabase.from('shop_prices').upsert({
          item_id: row.existing.id,
          shop_id: shopPriceShopId,
          selling_price: row.sellingPrice,
          last_price: row.lastPrice,
        }, { onConflict: 'item_id,shop_id' })
      }
      toast.success(`${matched.length} shop prices saved!`)
      setShopPricePreview(null)
    } catch (err) { toast.error('Failed: ' + err.message) }
    setShopPriceUploading(false)
  }

  async function saveTab(tab) {
    setSaving(true)
    try {
      if (tab === 'bank') {
        for (const acc of bankAccounts) {
          const val = parseFloat(bankBalances[acc.id]) || 0
          await supabase.from('bank_accounts').update({ balance: val }).eq('id', acc.id)
        }
        // Save per-shop cash in hand
        if (isSuperAdmin) {
          for (const shop of (shops || [])) {
            const val = parseFloat(shopCashInHand[shop.id]) || 0
            await supabase.from('shops').update({ cash_in_hand: val }).eq('id', shop.id)
          }
        }
      }

      if (tab === 'customers') {
        for (const c of customers) {
          const val = parseFloat(customerBalances[c.id]) || 0
          if (val !== c.credit_balance) {
            await supabase.from('customers').update({ credit_balance: val, opening_balance: val }).eq('id', c.id)
          }
        }
      }

      if (tab === 'suppliers') {
        for (const s of suppliers) {
          const val = parseFloat(supplierBalances[s.id]) || 0
          if (val !== s.outstanding_balance) {
            await supabase.from('suppliers').update({ outstanding_balance: val, opening_balance: val }).eq('id', s.id)
          }
        }
      }

      if (tab === 'inventory') {
        const shopId = inventoryShopId || shops[0]?.id || null
      if (!shopId) { toast.error('Please select a shop before importing'); setUploading(false); return }
        for (const item of items) {
          const qty = parseFloat(itemQty[item.id]) || 0
          const cost = parseFloat(itemCost[item.id]) || 0
          const selling = parseFloat(itemSelling[item.id]) || 0
          const lastP = parseFloat(itemLastPrice[item.id]) || 0
          // Always update items table
          await supabase.from('items').update({
            stock_quantity: qty,
            cost_price: cost,
            ...(selling > 0 ? { selling_price: selling } : {}),
            ...(lastP > 0 ? { last_price: lastP } : {}),
          }).eq('id', item.id)
          // Remove all existing inventory rows for this item in this shop, then re-insert
          await supabase.from('inventory').delete()
            .eq('item_id', item.id)
            .eq('shop_id', shopId)
          // Re-insert with correct shop_id if qty > 0
          if (qty > 0) {
            await supabase.from('inventory').insert({
              item_id: item.id,
              shop_id: shopId,
              quantity: qty,
              cost_price: cost,
            })
          }
        }
      }

      // opening_balance_log table removed — no logging needed

      toast.success(`${TABS.find(t => t.id === tab)?.label} saved!`)
      fetchAll()
    } catch (e) {
      toast.error('Failed: ' + e.message)
    }
    setSaving(false)
  }

  const inp = { width: '100%', padding: '8px 10px', border: '1.5px solid #e2e8f0', borderRadius: '7px', fontSize: '13px', boxSizing: 'border-box', outline: 'none', background: 'white' }
  const numInp = { width: '130px', padding: '7px 10px', border: '1.5px solid #e2e8f0', borderRadius: '7px', fontSize: '13px', outline: 'none', textAlign: 'right', fontWeight: '600' }

  const filteredCustomers = customers.filter(c =>
    !customerSearch || c.name.toLowerCase().includes(customerSearch.toLowerCase()) || c.customer_no?.toLowerCase().includes(customerSearch.toLowerCase())
  )
  const filteredSuppliers = suppliers.filter(s =>
    !supplierSearch || s.name.toLowerCase().includes(supplierSearch.toLowerCase()) || s.supplier_no?.toLowerCase().includes(supplierSearch.toLowerCase())
  )
  const filteredItems = items.filter(i =>
    !itemSearch || i.name.toLowerCase().includes(itemSearch.toLowerCase()) || i.item_no?.toLowerCase().includes(itemSearch.toLowerCase())
  )

  const customerTotal = Object.values(customerBalances).reduce((s, v) => s + (parseFloat(v) || 0), 0)
  const supplierTotal = Object.values(supplierBalances).reduce((s, v) => s + (parseFloat(v) || 0), 0)
  const inventoryTotal = items.reduce((s, item) => s + ((parseFloat(itemQty[item.id]) || 0) * (parseFloat(itemCost[item.id]) || 0)), 0)
  const bankTotal = Object.values(bankBalances).reduce((s, v) => s + (parseFloat(v) || 0), 0)

  return (
    <div>
      <div style={{ marginBottom: '28px' }}>
        <h1 style={{ fontSize: '22px', fontWeight: '700', color: '#0f172a', margin: '0 0 6px' }}>Opening Balances</h1>
        <p style={{ color: '#64748b', fontSize: '14px', margin: '0 0 12px' }}>
          Set your opening balances before going live. Run each tab once — existing values are pre-filled.
        </p>
        <div style={{ padding: '12px 16px', background: '#fef3c7', border: '1px solid #fde68a', borderRadius: '10px', fontSize: '13px', color: '#92400e', display: 'flex', gap: '8px', alignItems: 'flex-start' }}>
          <span style={{ fontSize: '16px' }}>⚠️</span>
          <div>
            <strong>Important:</strong> This directly updates live data. Do this once before entering any transactions. Saving again will overwrite existing values.
          </div>
        </div>
      </div>

      {/* Progress overview */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: '12px', marginBottom: '28px' }}>
        {TABS.map(tab => (
          <div key={tab.id} onClick={() => setActiveTab(tab.id)}
            style={{ background: 'white', borderRadius: '12px', padding: '16px', boxShadow: '0 1px 3px rgba(15,23,42,0.06), 0 1px 2px rgba(15,23,42,0.04)', cursor: 'pointer', border: `2px solid ${activeTab === tab.id ? '#2563eb' : completedTabs[tab.id] ? '#22c55e' : '#e2e8f0'}`, transition: 'all 0.15s' }}>
            <div style={{ fontSize: '24px', marginBottom: '8px' }}>{completedTabs[tab.id] ? '✅' : tab.icon}</div>
            <div style={{ fontSize: '13px', fontWeight: '700', color: activeTab === tab.id ? '#1e40af' : '#0f172a', marginBottom: '3px' }}>{tab.label}</div>
            {completedTabs[tab.id] ? (
              <div style={{ fontSize: '11px', color: '#22c55e', fontWeight: '600' }}>
                Saved {new Date(completedTabs[tab.id]).toLocaleDateString('en-GB')}
              </div>
            ) : (
              <div style={{ fontSize: '11px', color: '#94a3b8' }}>Not saved yet</div>
            )}
          </div>
        ))}
      </div>

      {/* ── BANK TAB ── */}
      {activeTab === 'bank' && (
        <div>
          <div style={{ background: 'white', borderRadius: '12px', boxShadow: '0 1px 3px rgba(15,23,42,0.06), 0 1px 2px rgba(15,23,42,0.04)', overflow: 'hidden', marginBottom: '16px' }}>
            <div style={{ padding: '16px 20px', borderBottom: '1px solid #f1f5f9', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <h2 style={{ fontSize: '15px', fontWeight: '700', color: '#0f172a', margin: 0 }}>Cash & Bank Accounts</h2>
                <p style={{ fontSize: '13px', color: '#64748b', margin: '2px 0 0' }}>Enter the current balance in each account as of today</p>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: '11px', color: '#94a3b8', textTransform: 'uppercase', marginBottom: '2px' }}>Total</div>
                <div style={{ fontSize: '18px', fontWeight: '800', color: '#059669' }}>{formatCurrency(bankTotal)}</div>
              </div>
            </div>
            {bankAccounts.length === 0 ? (
              <div style={{ padding: '40px', textAlign: 'center', color: '#94a3b8' }}>
                <div style={{ fontSize: '28px', marginBottom: '8px' }}>🏦</div>
                No bank accounts yet. Add them in Finance → Bank first.
              </div>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ background: '#f8fafc', borderBottom: '2px solid #e2e8f0' }}>
                    {['Account Name', 'Bank', 'Account No', 'Opening Balance (LKR)'].map(h => (
                      <th key={h} style={{ padding: '10px 16px', textAlign: 'left', fontSize: '11px', fontWeight: '700', color: '#94a3b8', textTransform: 'uppercase' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {bankAccounts.map((acc, i) => (
                    <tr key={acc.id} style={{ borderBottom: '1px solid #f1f5f9', background: i % 2 === 0 ? 'white' : '#fafafa' }}>
                      <td style={{ padding: '12px 16px', fontWeight: '700', color: '#0f172a' }}>{acc.name}</td>
                      <td style={{ padding: '12px 16px', color: '#64748b' }}>{acc.bank_name}</td>
                      <td style={{ padding: '12px 16px', color: '#64748b', fontFamily: 'monospace' }}>{acc.account_no || '—'}</td>
                      <td style={{ padding: '12px 16px' }}>
                        <input type="number" value={bankBalances[acc.id] || ''} min="0" step="0.01"
                          onChange={e => setBankBalances(p => ({ ...p, [acc.id]: e.target.value }))}
                          onFocus={e => e.target.select()}
                          placeholder="0.00" style={numInp} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
          {isSuperAdmin && shops.length > 0 && (
            <div style={{ background: 'white', borderRadius: '12px', boxShadow: '0 1px 3px rgba(15,23,42,0.06), 0 1px 2px rgba(15,23,42,0.04)', overflow: 'hidden', marginTop: '16px', marginBottom: '16px' }}>
              <div style={{ padding: '16px 20px', borderBottom: '1px solid #f1f5f9' }}>
                <h2 style={{ fontSize: '15px', fontWeight: '700', color: '#0f172a', margin: 0 }}>💵 Cash in Hand — Per Shop</h2>
                <p style={{ fontSize: '13px', color: '#64748b', margin: '2px 0 0' }}>Set the opening cash in hand for each shop. End of Shift will use this as the starting balance.</p>
              </div>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ background: '#f8fafc', borderBottom: '2px solid #e2e8f0' }}>
                    {['Shop', 'Cash in Hand (LKR)'].map(h => (
                      <th key={h} style={{ padding: '10px 16px', textAlign: 'left', fontSize: '11px', fontWeight: '700', color: '#94a3b8', textTransform: 'uppercase' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {shops.map((shop, i) => (
                    <tr key={shop.id} style={{ borderBottom: '1px solid #f1f5f9', background: i % 2 === 0 ? 'white' : '#fafafa' }}>
                      <td style={{ padding: '12px 16px', fontWeight: '700', color: '#0f172a' }}>
                        {shop.name}
                        {shop.address && <div style={{ fontSize: '11px', color: '#94a3b8', fontWeight: '400' }}>{shop.address}</div>}
                      </td>
                      <td style={{ padding: '12px 16px' }}>
                        <input type="number" value={shopCashInHand[shop.id] || ''} min="0" step="0.01"
                          onChange={e => setShopCashInHand(p => ({ ...p, [shop.id]: e.target.value }))}
                          onFocus={e => e.target.select()}
                          placeholder="0.00" style={numInp} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <button onClick={() => saveTab('bank')} disabled={saving || bankAccounts.length === 0}
              style={{ padding: '11px 28px', background: saving ? '#93c5fd' : 'linear-gradient(135deg,#2563eb,#1d4ed8)', color: 'white', border: 'none', borderRadius: '10px', cursor: 'pointer', fontWeight: '700', fontSize: '14px' }}>
              {saving ? 'Saving...' : '✓ Save Bank Balances'}
            </button>
          </div>
        </div>
      )}

      {/* ── CUSTOMERS TAB ── */}
      {activeTab === 'customers' && (
        <div>
          <div style={{ background: 'white', borderRadius: '12px', boxShadow: '0 1px 3px rgba(15,23,42,0.06), 0 1px 2px rgba(15,23,42,0.04)', overflow: 'hidden', marginBottom: '16px' }}>
            <div style={{ padding: '16px 20px', borderBottom: '1px solid #f1f5f9', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <h2 style={{ fontSize: '15px', fontWeight: '700', color: '#0f172a', margin: 0 }}>Customer Outstanding Balances</h2>
                <p style={{ fontSize: '13px', color: '#64748b', margin: '2px 0 0' }}>Enter how much each customer owes you. Leave blank or 0 for no balance.</p>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: '11px', color: '#94a3b8', textTransform: 'uppercase', marginBottom: '2px' }}>Total Receivable</div>
                <div style={{ fontSize: '18px', fontWeight: '800', color: '#e11d48' }}>{formatCurrency(customerTotal)}</div>
              </div>
            </div>
            <div style={{ padding: '12px 16px', borderBottom: '1px solid #f1f5f9' }}>
              <input type="text" placeholder="Search customers…" value={customerSearch}
                onChange={e => setCustomerSearch(e.target.value)} style={{ ...inp, maxWidth: '320px' }} />
            </div>

            {/* Excel upload section */}
            <div style={{ padding: '14px 16px', borderBottom: '1px solid #f1f5f9', background: '#f8fafc' }}>
              <div style={{ fontSize: '12px', fontWeight: '700', color: '#64748b', marginBottom: '6px', textTransform: 'uppercase' }}>📥 Import from Excel</div>
              <div style={{ fontSize: '12px', color: '#94a3b8', marginBottom: '8px' }}>
                Columns: <strong>Name</strong> (required) · <strong>Balance</strong> · Phone · Address (optional).<br />
                New customers auto-get a customer number. Existing customers matched by name.
              </div>
              <div style={{ display: 'flex', gap: '8px' }}>
                <input ref={customerFileRef} type="file" accept=".xlsx,.xls,.csv" onChange={handleCustomerExcelUpload}
                  style={{ display: 'none' }} />
                <button onClick={() => customerFileRef.current?.click()}
                  style={{ padding: '7px 16px', background: 'linear-gradient(135deg,#0ea5e9,#0284c7)', color: 'white', border: 'none', borderRadius: '7px', cursor: 'pointer', fontWeight: '700', fontSize: '13px' }}>
                  📂 Choose Excel / CSV File
                </button>
                {customerUploadPreview && (
                  <button onClick={() => setCustomerUploadPreview(null)}
                    style={{ padding: '7px 14px', background: '#f1f5f9', color: '#64748b', border: 'none', borderRadius: '7px', cursor: 'pointer', fontWeight: '600', fontSize: '13px' }}>
                    ✕ Clear Preview
                  </button>
                )}
              </div>

              {customerUploadPreview && (
                <div style={{ marginTop: '14px' }}>
                  <div style={{ fontSize: '13px', fontWeight: '700', color: '#0f172a', marginBottom: '8px' }}>
                    Preview — {customerUploadPreview.length} rows &nbsp;
                    <span style={{ color: '#059669' }}>({customerUploadPreview.filter(r => r.status === 'update').length} updates)</span> &nbsp;
                    <span style={{ color: '#2563eb' }}>({customerUploadPreview.filter(r => r.status === 'new').length} new customers)</span>
                  </div>
                  <div style={{ maxHeight: '260px', overflowY: 'auto', border: '1px solid #e2e8f0', borderRadius: '10px' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
                      <thead>
                        <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
                          {['Status', 'Name', 'Balance', 'Phone', 'Address'].map(h => (
                            <th key={h} style={{ padding: '8px 10px', textAlign: 'left', fontWeight: '700', color: '#94a3b8', textTransform: 'uppercase', fontSize: '10px' }}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {customerUploadPreview.map((row, i) => (
                          <tr key={i} style={{ borderBottom: '1px solid #f1f5f9', background: row.status === 'new' ? '#eef2ff' : 'white' }}>
                            <td style={{ padding: '7px 10px' }}>
                              <span style={{ padding: '2px 8px', borderRadius: '10px', fontWeight: '700', fontSize: '10px',
                                background: row.status === 'new' ? '#dbeafe' : '#f0fdf4',
                                color: row.status === 'new' ? '#1e40af' : '#059669' }}>
                                {row.status === 'new' ? '✦ NEW' : '↺ UPDATE'}
                              </span>
                            </td>
                            <td style={{ padding: '7px 10px', fontWeight: '600', color: '#0f172a' }}>{row.name}</td>
                            <td style={{ padding: '7px 10px', color: '#e11d48', fontWeight: '700' }}>{row.balance > 0 ? formatCurrency(row.balance) : '—'}</td>
                            <td style={{ padding: '7px 10px', color: '#0f172a' }}>{row.phone || '—'}</td>
                            <td style={{ padding: '7px 10px', color: '#0f172a' }}>{row.address || '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div style={{ marginTop: '10px', display: 'flex', gap: '10px', alignItems: 'center' }}>
                    <button onClick={commitCustomerUpload} disabled={customerUploading}
                      style={{ padding: '9px 22px', background: customerUploading ? '#93c5fd' : 'linear-gradient(135deg,#059669,#047857)', color: 'white', border: 'none', borderRadius: '10px', cursor: 'pointer', fontWeight: '700', fontSize: '13px' }}>
                      {customerUploading ? 'Importing...' : `✓ Confirm Import (${customerUploadPreview.length} rows)`}
                    </button>
                    <span style={{ fontSize: '12px', color: '#64748b' }}>
                      ⚠️ This will create new customers and update existing balances.
                    </span>
                  </div>
                </div>
              )}
            </div>

            <div style={{ maxHeight: '500px', overflowY: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead style={{ position: 'sticky', top: 0 }}>
                  <tr style={{ background: '#f8fafc', borderBottom: '2px solid #e2e8f0' }}>
                    {['Customer No', 'Name', 'Outstanding Balance (LKR)'].map(h => (
                      <th key={h} style={{ padding: '10px 16px', textAlign: 'left', fontSize: '11px', fontWeight: '700', color: '#94a3b8', textTransform: 'uppercase' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filteredCustomers.map((c, i) => (
                    <tr key={c.id} style={{ borderBottom: '1px solid #f1f5f9', background: parseFloat(customerBalances[c.id]) > 0 ? '#fff5f5' : i % 2 === 0 ? 'white' : '#fafafa' }}>
                      <td style={{ padding: '10px 16px', fontWeight: '700', color: '#2563eb', fontSize: '13px' }}>{c.customer_no}</td>
                      <td style={{ padding: '10px 16px', fontWeight: '600', color: '#0f172a' }}>{c.name}</td>
                      <td style={{ padding: '10px 16px' }}>
                        <input type="number" value={customerBalances[c.id] || ''} min="0" step="0.01"
                          onChange={e => setCustomerBalances(p => ({ ...p, [c.id]: e.target.value }))}
                          onFocus={e => e.target.select()}
                          placeholder="0.00" style={{ ...numInp, borderColor: parseFloat(customerBalances[c.id]) > 0 ? '#fca5a5' : '#e2e8f0' }} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ fontSize: '13px', color: '#64748b' }}>
              {customers.filter(c => parseFloat(customerBalances[c.id]) > 0).length} customers with outstanding balances
            </div>
            <button onClick={() => saveTab('customers')} disabled={saving}
              style={{ padding: '11px 28px', background: saving ? '#93c5fd' : 'linear-gradient(135deg,#2563eb,#1d4ed8)', color: 'white', border: 'none', borderRadius: '10px', cursor: 'pointer', fontWeight: '700', fontSize: '14px' }}>
              {saving ? 'Saving...' : '✓ Save Customer Balances'}
            </button>
          </div>
        </div>
      )}

      {/* ── SUPPLIERS TAB ── */}
      {activeTab === 'suppliers' && (
        <div>
          <div style={{ background: 'white', borderRadius: '12px', boxShadow: '0 1px 3px rgba(15,23,42,0.06), 0 1px 2px rgba(15,23,42,0.04)', overflow: 'hidden', marginBottom: '16px' }}>
            <div style={{ padding: '16px 20px', borderBottom: '1px solid #f1f5f9', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <h2 style={{ fontSize: '15px', fontWeight: '700', color: '#0f172a', margin: 0 }}>Supplier Outstanding Payables</h2>
                <p style={{ fontSize: '13px', color: '#64748b', margin: '2px 0 0' }}>Enter how much you owe each supplier. Leave blank or 0 for no balance.</p>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: '11px', color: '#94a3b8', textTransform: 'uppercase', marginBottom: '2px' }}>Total Payable</div>
                <div style={{ fontSize: '18px', fontWeight: '800', color: '#e11d48' }}>{formatCurrency(supplierTotal)}</div>
              </div>
            </div>
            <div style={{ padding: '12px 16px', borderBottom: '1px solid #f1f5f9' }}>
              <input type="text" placeholder="Search suppliers…" value={supplierSearch}
                onChange={e => setSupplierSearch(e.target.value)} style={{ ...inp, maxWidth: '320px' }} />
            </div>

            {/* Excel upload section */}
            <div style={{ padding: '14px 16px', borderBottom: '1px solid #f1f5f9', background: '#f8fafc' }}>
              <div style={{ fontSize: '12px', fontWeight: '700', color: '#64748b', marginBottom: '6px', textTransform: 'uppercase' }}>📥 Import from Excel</div>
              <div style={{ fontSize: '12px', color: '#94a3b8', marginBottom: '8px' }}>
                Columns: <strong>Name</strong> (required) · <strong>Balance</strong> · Phone · Email · Address (optional).<br />
                New suppliers auto-get a supplier number. Existing suppliers matched by name.
              </div>
              <div style={{ display: 'flex', gap: '8px' }}>
                <input ref={supplierFileRef} type="file" accept=".xlsx,.xls,.csv" onChange={handleSupplierExcelUpload}
                  style={{ display: 'none' }} />
                <button onClick={() => supplierFileRef.current?.click()}
                  style={{ padding: '7px 16px', background: 'linear-gradient(135deg,#0ea5e9,#0284c7)', color: 'white', border: 'none', borderRadius: '7px', cursor: 'pointer', fontWeight: '700', fontSize: '13px' }}>
                  📂 Choose Excel / CSV File
                </button>
                {supplierUploadPreview && (
                  <button onClick={() => setSupplierUploadPreview(null)}
                    style={{ padding: '7px 14px', background: '#f1f5f9', color: '#64748b', border: 'none', borderRadius: '7px', cursor: 'pointer', fontWeight: '600', fontSize: '13px' }}>
                    ✕ Clear Preview
                  </button>
                )}
              </div>

              {supplierUploadPreview && (
                <div style={{ marginTop: '14px' }}>
                  <div style={{ fontSize: '13px', fontWeight: '700', color: '#0f172a', marginBottom: '8px' }}>
                    Preview — {supplierUploadPreview.length} rows &nbsp;
                    <span style={{ color: '#059669' }}>({supplierUploadPreview.filter(r => r.status === 'update').length} updates)</span> &nbsp;
                    <span style={{ color: '#2563eb' }}>({supplierUploadPreview.filter(r => r.status === 'new').length} new suppliers)</span>
                  </div>
                  <div style={{ maxHeight: '260px', overflowY: 'auto', border: '1px solid #e2e8f0', borderRadius: '10px' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
                      <thead>
                        <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
                          {['Status', 'Name', 'Balance', 'Phone', 'Email', 'Address'].map(h => (
                            <th key={h} style={{ padding: '8px 10px', textAlign: 'left', fontWeight: '700', color: '#94a3b8', textTransform: 'uppercase', fontSize: '10px' }}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {supplierUploadPreview.map((row, i) => (
                          <tr key={i} style={{ borderBottom: '1px solid #f1f5f9', background: row.status === 'new' ? '#eef2ff' : 'white' }}>
                            <td style={{ padding: '7px 10px' }}>
                              <span style={{ padding: '2px 8px', borderRadius: '10px', fontWeight: '700', fontSize: '10px',
                                background: row.status === 'new' ? '#dbeafe' : '#f0fdf4',
                                color: row.status === 'new' ? '#1e40af' : '#059669' }}>
                                {row.status === 'new' ? '✦ NEW' : '↺ UPDATE'}
                              </span>
                            </td>
                            <td style={{ padding: '7px 10px', fontWeight: '600', color: '#0f172a' }}>{row.name}</td>
                            <td style={{ padding: '7px 10px', color: '#e11d48', fontWeight: '700' }}>{row.balance > 0 ? formatCurrency(row.balance) : '—'}</td>
                            <td style={{ padding: '7px 10px', color: '#0f172a' }}>{row.phone || '—'}</td>
                            <td style={{ padding: '7px 10px', color: '#0f172a' }}>{row.email || '—'}</td>
                            <td style={{ padding: '7px 10px', color: '#0f172a' }}>{row.address || '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div style={{ marginTop: '10px', display: 'flex', gap: '10px', alignItems: 'center' }}>
                    <button onClick={commitSupplierUpload} disabled={supplierUploading}
                      style={{ padding: '9px 22px', background: supplierUploading ? '#93c5fd' : 'linear-gradient(135deg,#059669,#047857)', color: 'white', border: 'none', borderRadius: '10px', cursor: 'pointer', fontWeight: '700', fontSize: '13px' }}>
                      {supplierUploading ? 'Importing...' : `✓ Confirm Import (${supplierUploadPreview.length} rows)`}
                    </button>
                    <span style={{ fontSize: '12px', color: '#64748b' }}>
                      ⚠️ This will create new suppliers and update existing balances.
                    </span>
                  </div>
                </div>
              )}
            </div>

            <div style={{ maxHeight: '500px', overflowY: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead style={{ position: 'sticky', top: 0 }}>
                  <tr style={{ background: '#f8fafc', borderBottom: '2px solid #e2e8f0' }}>
                    {['Supplier No', 'Name', 'Amount Owed (LKR)'].map(h => (
                      <th key={h} style={{ padding: '10px 16px', textAlign: 'left', fontSize: '11px', fontWeight: '700', color: '#94a3b8', textTransform: 'uppercase' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filteredSuppliers.map((s, i) => (
                    <tr key={s.id} style={{ borderBottom: '1px solid #f1f5f9', background: parseFloat(supplierBalances[s.id]) > 0 ? '#fffbeb' : i % 2 === 0 ? 'white' : '#fafafa' }}>
                      <td style={{ padding: '10px 16px', fontWeight: '700', color: '#2563eb', fontSize: '13px' }}>{s.supplier_no}</td>
                      <td style={{ padding: '10px 16px', fontWeight: '600', color: '#0f172a' }}>{s.name}</td>
                      <td style={{ padding: '10px 16px' }}>
                        <input type="number" value={supplierBalances[s.id] || ''} min="0" step="0.01"
                          onChange={e => setSupplierBalances(p => ({ ...p, [s.id]: e.target.value }))}
                          onFocus={e => e.target.select()}
                          placeholder="0.00" style={{ ...numInp, borderColor: parseFloat(supplierBalances[s.id]) > 0 ? '#fde68a' : '#e2e8f0' }} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ fontSize: '13px', color: '#64748b' }}>
              {suppliers.filter(s => parseFloat(supplierBalances[s.id]) > 0).length} suppliers with outstanding payables
            </div>
            <button onClick={() => saveTab('suppliers')} disabled={saving}
              style={{ padding: '11px 28px', background: saving ? '#93c5fd' : 'linear-gradient(135deg,#2563eb,#1d4ed8)', color: 'white', border: 'none', borderRadius: '10px', cursor: 'pointer', fontWeight: '700', fontSize: '14px' }}>
              {saving ? 'Saving...' : '✓ Save Supplier Balances'}
            </button>
          </div>
        </div>
      )}

      {/* ── INVENTORY TAB ── */}
      {activeTab === 'inventory' && (
        <div>
          <div style={{ background: 'white', borderRadius: '12px', boxShadow: '0 1px 3px rgba(15,23,42,0.06), 0 1px 2px rgba(15,23,42,0.04)', overflow: 'hidden', marginBottom: '16px' }}>
            <div style={{ padding: '16px 20px', borderBottom: '1px solid #f1f5f9', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <h2 style={{ fontSize: '15px', fontWeight: '700', color: '#0f172a', margin: 0 }}>Opening Stock Count</h2>
                <p style={{ fontSize: '13px', color: '#64748b', margin: '2px 0 0' }}>Enter current quantity on hand and cost price for each item. Leave blank to skip.</p>
                {shops.length > 1 && (
                  <div style={{ marginTop: '8px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <label style={{ fontSize: '12px', fontWeight: '700', color: '#64748b' }}>Assign stock to shop:</label>
                    <select value={inventoryShopId || (shops[0]?.id || '')} onChange={e => setInventoryShopId(e.target.value)}
                      style={{ padding: '5px 10px', border: '1.5px solid #e2e8f0', borderRadius: '6px', fontSize: '13px', fontWeight: '600', color: '#0f172a' }}>
                      {shops.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                    </select>
                  </div>
                )}
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: '11px', color: '#94a3b8', textTransform: 'uppercase', marginBottom: '2px' }}>Total Inventory Value</div>
                <div style={{ fontSize: '18px', fontWeight: '800', color: '#1e40af' }}>{formatCurrency(inventoryTotal)}</div>
              </div>
            </div>
            {/* Excel upload section */}
            <div style={{ padding: '14px 16px', borderBottom: '1px solid #f1f5f9', background: '#f8fafc' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
                <div>
                  <div style={{ fontSize: '12px', fontWeight: '700', color: '#64748b', marginBottom: '6px', textTransform: 'uppercase' }}>📥 Import from Excel</div>
                  <div style={{ fontSize: '12px', color: '#94a3b8', marginBottom: '8px' }}>
                    Columns: <strong>Name</strong> (required) · <strong>Qty</strong> · <strong>Cost Price</strong> · <strong>Selling Price</strong> (optional).<br />
                    New items auto-get an item number. Existing items matched by name.
                  </div>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    <input ref={fileInputRef} type="file" accept=".xlsx,.xls,.csv" onChange={handleExcelUpload}
                      style={{ display: 'none' }} />
                    <button onClick={() => fileInputRef.current?.click()}
                      style={{ padding: '7px 16px', background: 'linear-gradient(135deg,#0ea5e9,#0284c7)', color: 'white', border: 'none', borderRadius: '7px', cursor: 'pointer', fontWeight: '700', fontSize: '13px' }}>
                      📂 Choose Excel / CSV File
                    </button>
                    {uploadPreview && (
                      <button onClick={() => setUploadPreview(null)}
                        style={{ padding: '7px 14px', background: '#f1f5f9', color: '#64748b', border: 'none', borderRadius: '7px', cursor: 'pointer', fontWeight: '600', fontSize: '13px' }}>
                        ✕ Clear Preview
                      </button>
                    )}
                  </div>
                </div>
              </div>

              {/* Upload preview table */}
              {uploadPreview && (
                <div style={{ marginTop: '14px' }}>
                  <div style={{ fontSize: '13px', fontWeight: '700', color: '#0f172a', marginBottom: '8px' }}>
                    Preview — {uploadPreview.length} rows &nbsp;
                    <span style={{ color: '#059669' }}>({uploadPreview.filter(r => r.status === 'update').length} updates)</span> &nbsp;
                    <span style={{ color: '#2563eb' }}>({uploadPreview.filter(r => r.status === 'new').length} new items)</span>
                  </div>
                  <div style={{ maxHeight: '260px', overflowY: 'auto', border: '1px solid #e2e8f0', borderRadius: '10px' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
                      <thead>
                        <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
                          {['Status', 'Name', 'Qty', 'Cost Price', 'Selling Price', 'Last Price'].map(h => (
                            <th key={h} style={{ padding: '8px 10px', textAlign: 'left', fontWeight: '700', color: '#94a3b8', textTransform: 'uppercase', fontSize: '10px' }}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {uploadPreview.map((row, i) => (
                          <tr key={i} style={{ borderBottom: '1px solid #f1f5f9', background: row.status === 'new' ? '#eef2ff' : 'white' }}>
                            <td style={{ padding: '7px 10px' }}>
                              <span style={{ padding: '2px 8px', borderRadius: '10px', fontWeight: '700', fontSize: '10px',
                                background: row.status === 'new' ? '#dbeafe' : '#f0fdf4',
                                color: row.status === 'new' ? '#1e40af' : '#059669' }}>
                                {row.status === 'new' ? '✦ NEW' : '↺ UPDATE'}
                              </span>
                            </td>
                            <td style={{ padding: '7px 10px', fontWeight: '600', color: '#0f172a' }}>{row.name}</td>
                            <td style={{ padding: '7px 10px', color: '#0f172a' }}>{row.qty || 0}</td>
                            <td style={{ padding: '7px 10px', color: '#0f172a' }}>{row.cost > 0 ? formatCurrency(row.cost) : '—'}</td>
                            <td style={{ padding: '7px 10px', color: '#0f172a' }}>{row.sellingPrice > 0 ? formatCurrency(row.sellingPrice) : '—'}</td>
                            <td style={{ padding: '7px 10px', color: '#0f172a' }}>{row.lastPrice > 0 ? formatCurrency(row.lastPrice) : '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div style={{ marginTop: '10px', display: 'flex', gap: '10px', alignItems: 'center' }}>
                    <button onClick={commitUpload} disabled={uploading}
                      style={{ padding: '9px 22px', background: uploading ? '#93c5fd' : 'linear-gradient(135deg,#059669,#047857)', color: 'white', border: 'none', borderRadius: '10px', cursor: 'pointer', fontWeight: '700', fontSize: '13px' }}>
                      {uploading ? 'Importing...' : `✓ Confirm Import (${uploadPreview.length} rows)`}
                    </button>
                    <span style={{ fontSize: '12px', color: '#64748b' }}>
                      ⚠️ This will create new items and update existing stock counts.
                    </span>
                  </div>
                </div>
              )}
            </div>

            <div style={{ padding: '12px 16px', borderBottom: '1px solid #f1f5f9', display: 'flex', gap: '12px', alignItems: 'center' }}>
              <input type="text" placeholder="Search items…" value={itemSearch}
                onChange={e => setItemSearch(e.target.value)} style={{ ...inp, maxWidth: '320px' }} />
              <span style={{ fontSize: '13px', color: '#94a3b8' }}>
                {items.filter(i => parseFloat(itemQty[i.id]) > 0).length} / {items.length} items with stock
              </span>
            </div>
            <div style={{ maxHeight: '500px', overflowY: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead style={{ position: 'sticky', top: 0 }}>
                  <tr style={{ background: '#f8fafc', borderBottom: '2px solid #e2e8f0' }}>
                    {['Item No', 'Name', 'Qty on Hand', 'Cost Price (LKR)', 'Selling Price (LKR)', 'Last Price (LKR)', 'Total Value'].map(h => (
                      <th key={h} style={{ padding: '10px 16px', textAlign: 'left', fontSize: '11px', fontWeight: '700', color: '#94a3b8', textTransform: 'uppercase' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filteredItems.map((item, i) => {
                    const qty = parseFloat(itemQty[item.id]) || 0
                    const cost = parseFloat(itemCost[item.id]) || 0
                    const lineVal = qty * cost
                    return (
                      <tr key={item.id} style={{ borderBottom: '1px solid #f1f5f9', background: qty > 0 ? '#f5f3ff' : i % 2 === 0 ? 'white' : '#fafafa' }}>
                        <td style={{ padding: '10px 16px', fontWeight: '700', color: '#2563eb', fontSize: '13px' }}>{item.item_no}</td>
                        <td style={{ padding: '10px 16px', fontWeight: '600', color: '#0f172a' }}>{item.name}</td>
                        <td style={{ padding: '10px 16px' }}>
                          <input type="number" value={itemQty[item.id] || ''} min="0" step="1"
                            onChange={e => setItemQty(p => ({ ...p, [item.id]: e.target.value }))}
                            onFocus={e => e.target.select()}
                            placeholder="0" style={{ ...numInp, width: '90px', borderColor: qty > 0 ? '#c4b5fd' : '#e2e8f0' }} />
                        </td>
                        <td style={{ padding: '10px 16px' }}>
                          <input type="number" value={itemCost[item.id] || ''} min="0" step="0.01"
                            onChange={e => setItemCost(p => ({ ...p, [item.id]: e.target.value }))}
                            onFocus={e => e.target.select()}
                            placeholder="0.00" style={{ ...numInp, borderColor: cost > 0 ? '#c4b5fd' : '#e2e8f0' }} />
                        </td>
                        <td style={{ padding: '10px 16px' }}>
                          <input type="number" value={itemSelling[item.id] || ''} min="0" step="0.01"
                            onChange={e => setItemSelling(p => ({ ...p, [item.id]: e.target.value }))}
                            onFocus={e => e.target.select()}
                            placeholder="0.00" style={{ ...numInp, borderColor: parseFloat(itemSelling[item.id]) > 0 ? '#bbf7d0' : '#e2e8f0' }} />
                        </td>
                        <td style={{ padding: '10px 16px' }}>
                          <input type="number" value={itemLastPrice[item.id] || ''} min="0" step="0.01"
                            onChange={e => setItemLastPrice(p => ({ ...p, [item.id]: e.target.value }))}
                            onFocus={e => e.target.select()}
                            placeholder="0.00" style={{ ...numInp, borderColor: parseFloat(itemLastPrice[item.id]) > 0 ? '#fde68a' : '#e2e8f0' }} />
                        </td>
                        <td style={{ padding: '10px 16px', fontSize: '13px', fontWeight: '700', color: lineVal > 0 ? '#1e40af' : '#94a3b8' }}>
                          {lineVal > 0 ? formatCurrency(lineVal) : '—'}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
                {/* Totals row */}
                <tfoot>
                  <tr style={{ background: '#f8fafc', borderTop: '2px solid #e2e8f0' }}>
                    <td colSpan={6} style={{ padding: '12px 16px', fontWeight: '700', color: '#0f172a', fontSize: '13px' }}>
                      Total Inventory Value ({items.filter(i => parseFloat(itemQty[i.id]) > 0).length} items)
                    </td>
                    <td style={{ padding: '12px 16px', fontWeight: '800', color: '#1e40af', fontSize: '15px' }}>
                      {formatCurrency(inventoryTotal)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ fontSize: '13px', color: '#64748b' }}>
              Total inventory value: <strong>{formatCurrency(inventoryTotal)}</strong>
            </div>
            <button onClick={() => saveTab('inventory')} disabled={saving}
              style={{ padding: '11px 28px', background: saving ? '#93c5fd' : 'linear-gradient(135deg,#2563eb,#1d4ed8)', color: 'white', border: 'none', borderRadius: '10px', cursor: 'pointer', fontWeight: '700', fontSize: '14px' }}>
              {saving ? 'Saving...' : '✓ Save Stock Count'}
            </button>
          </div>
        </div>
      )}

      {/* ── Shop Retail Prices Tab ── */}
      {activeTab === 'shop_prices' && (
        <div style={{ background: 'white', borderRadius: '12px', boxShadow: '0 1px 3px rgba(15,23,42,0.06), 0 1px 2px rgba(15,23,42,0.04)', overflow: 'hidden' }}>
          <div style={{ padding: '16px 20px', borderBottom: '1px solid #f1f5f9' }}>
            <h2 style={{ fontSize: '15px', fontWeight: '700', color: '#0f172a', margin: '0 0 4px' }}>Shop Retail Prices</h2>
            <p style={{ fontSize: '13px', color: '#64748b', margin: 0 }}>Upload per-shop selling price and minimum (last) price for retail stores. iPHIX Technologies shop uses the default item prices.</p>
          </div>
          <div style={{ padding: '16px 20px', borderBottom: '1px solid #f1f5f9', background: '#f8fafc' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '16px', flexWrap: 'wrap', marginBottom: '12px' }}>
              <div>
                <label style={{ fontSize: '12px', fontWeight: '700', color: '#64748b', marginRight: '8px' }}>Shop:</label>
                <select value={shopPriceShopId} onChange={e => setShopPriceShopId(e.target.value)}
                  style={{ padding: '7px 12px', border: '1.5px solid #e2e8f0', borderRadius: '7px', fontSize: '13px', fontWeight: '600' }}>
                  {shops.filter(s => s.name !== 'iPHIX Technologies').map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>
              <div>
                <div style={{ fontSize: '12px', color: '#94a3b8', marginBottom: '6px' }}>
                  Columns: <strong>Name</strong> (required) · <strong>Selling Price</strong> · <strong>Last Price</strong>
                </div>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <input ref={shopPriceFileRef} type="file" accept=".xlsx,.xls,.csv" onChange={handleShopPriceUpload} style={{ display: 'none' }} />
                  <button onClick={() => shopPriceFileRef.current?.click()}
                    style={{ padding: '7px 16px', background: 'linear-gradient(135deg,#7c3aed,#6d28d9)', color: 'white', border: 'none', borderRadius: '7px', cursor: 'pointer', fontWeight: '700', fontSize: '13px' }}>
                    📂 Choose Excel / CSV File
                  </button>
                  {shopPricePreview && (
                    <button onClick={() => setShopPricePreview(null)}
                      style={{ padding: '7px 14px', background: '#f1f5f9', color: '#64748b', border: 'none', borderRadius: '7px', cursor: 'pointer', fontWeight: '600', fontSize: '13px' }}>
                      ✕ Clear
                    </button>
                  )}
                </div>
              </div>
            </div>

            {shopPricePreview && (
              <div>
                <div style={{ fontSize: '13px', fontWeight: '700', color: '#0f172a', marginBottom: '8px' }}>
                  Preview — {shopPricePreview.filter(r => r.status === 'match').length} items matched &nbsp;
                  <span style={{ color: '#e11d48' }}>({shopPricePreview.filter(r => r.status === 'not_found').length} not found)</span>
                </div>
                <div style={{ maxHeight: '280px', overflowY: 'auto', border: '1px solid #e2e8f0', borderRadius: '10px', marginBottom: '10px' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
                    <thead>
                      <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
                        {['Status', 'Name', 'Selling Price', 'Last Price'].map(h => (
                          <th key={h} style={{ padding: '8px 10px', textAlign: 'left', fontWeight: '700', color: '#94a3b8', fontSize: '10px', textTransform: 'uppercase' }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {shopPricePreview.map((row, i) => (
                        <tr key={i} style={{ borderBottom: '1px solid #f1f5f9', background: row.status === 'not_found' ? '#fff5f5' : 'white' }}>
                          <td style={{ padding: '7px 10px' }}>
                            <span style={{ padding: '2px 8px', borderRadius: '10px', fontWeight: '700', fontSize: '10px',
                              background: row.status === 'match' ? '#f0fdf4' : '#fee2e2',
                              color: row.status === 'match' ? '#166534' : '#dc2626' }}>
                              {row.status === 'match' ? '✓ MATCH' : '✕ NOT FOUND'}
                            </span>
                          </td>
                          <td style={{ padding: '7px 10px', fontWeight: '600', color: '#0f172a' }}>{row.name}</td>
                          <td style={{ padding: '7px 10px', color: '#059669', fontWeight: '700' }}>{row.sellingPrice > 0 ? formatCurrency(row.sellingPrice) : '—'}</td>
                          <td style={{ padding: '7px 10px', color: '#d97706', fontWeight: '700' }}>{row.lastPrice > 0 ? formatCurrency(row.lastPrice) : '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                  <button onClick={commitShopPriceUpload} disabled={shopPriceUploading}
                    style={{ padding: '9px 22px', background: shopPriceUploading ? '#93c5fd' : 'linear-gradient(135deg,#059669,#047857)', color: 'white', border: 'none', borderRadius: '10px', cursor: 'pointer', fontWeight: '700', fontSize: '13px' }}>
                    {shopPriceUploading ? 'Saving...' : `✓ Save Prices for ${shops.find(s => s.id === shopPriceShopId)?.name || 'Shop'} (${shopPricePreview.filter(r => r.status === 'match').length} items)`}
                  </button>
                  <span style={{ fontSize: '12px', color: '#64748b' }}>Only matched items will be saved.</span>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
