// ── Barcode label printing ──────────────────────────────────
// Shared by Inventory.jsx and NewPurchase.jsx / PurchaseList.jsx so both
// produce identical Zebra ZD230 labels (100mm roll, 3-up, 30mm × 20mm each).
//
// items: array of { name, barcode, selling_price, qty } — qty is how many
// copies of that item's label to print (defaults to 1 if not given).
//
// ── Print alignment calibration ──────────────────────────────
// Different printer drivers apply their own physical offset on top of the
// browser's CSS layout, so the "correct" position in the browser preview
// can still land shifted on the actual sticker. OFFSET_X/OFFSET_Y below
// shift the entire label grid to compensate — positive X moves content
// right, positive Y moves it down. Negative values move left/up.
// Stored in localStorage so the calibration persists across prints.
// Use printCalibrationLabels() to print a test sheet while tuning this.

const OFFSET_KEY = 'iphix_barcode_print_offset'

export function getPrintOffset() {
  try {
    const saved = JSON.parse(localStorage.getItem(OFFSET_KEY) || '{}')
    return { x: saved.x || 0, y: saved.y || 0 }
  } catch {
    return { x: 0, y: 0 }
  }
}

export function setPrintOffset(x, y) {
  localStorage.setItem(OFFSET_KEY, JSON.stringify({ x, y }))
}

function labelStyles(offset) {
  // Fixed physical layout: 2mm margin, 30mm label, 3mm gap, 30mm label, 3mm gap, 30mm label, 2mm margin
  // Label left positions: 2mm, 35mm, 68mm (2+30+3, 2+30+3+30+3)
  const LEFT_POS = [2, 35, 68]
  return `
    * { box-sizing: border-box; }
    @page { size: 100mm 20mm; margin: 0; }
    html, body { margin: 0; padding: 0; }
    body { font-family: Arial, Helvetica, sans-serif; }
    .sheet { position: relative; }
    .row {
      position: relative;
      width: 100mm; height: 20mm;
      page-break-after: always;
      left: ${offset.x}mm; top: ${offset.y}mm;
    }
    .row:last-child { page-break-after: auto; }
    .label {
      position: absolute; top: 0;
      width: 30mm; height: 20mm; padding: 1mm 1.5mm;
      display: flex; flex-direction: column; align-items: center; justify-content: center;
      overflow: hidden;
    }
    .label:nth-child(1) { left: ${LEFT_POS[0]}mm; }
    .label:nth-child(2) { left: ${LEFT_POS[1]}mm; }
    .label:nth-child(3) { left: ${LEFT_POS[2]}mm; }
    .label .nm { font-size: 7px; font-weight: bold; text-align: center; line-height: 1.05; max-height: 14px; overflow: hidden; margin-bottom: 0.3mm; width: 100%; }
    .label svg { width: 27mm; height: 6.5mm; display: block; }
    .label .cd { font-size: 7px; font-weight: bold; font-family: 'Courier New', monospace; color: #000; margin-top: 0.2mm; letter-spacing: 0.3px; }
    .label .pr { font-size: 8.5px; font-weight: bold; margin-top: 0.4mm; color: #000; }
    @media screen {
      body { background: #e5e7eb; padding: 12px; }
      .row { background: white; margin-bottom: 6px; box-shadow: 0 1px 3px rgba(0,0,0,0.15); }
      .label { outline: 1px dashed #ccc; }
    }
    @media print {
      @page { size: 100mm 20mm; margin: 0; }
      body { background: white; }
      .row { margin-bottom: 0; box-shadow: none; }
      .no-print { display: none !important; }
    }
  `
}

export function printBarcodeLabels(items) {
  const expanded = []
  for (const item of items) {
    if (!item.barcode) continue
    const copies = Math.max(1, parseInt(item.qty, 10) || 1)
    for (let i = 0; i < copies; i++) expanded.push(item)
  }
  if (expanded.length === 0) return { printed: 0, skipped: items.length }

  const skippedCount = items.filter(i => !i.barcode).length
  const offset = getPrintOffset()

  const printWindow = window.open('', '_blank')
  printWindow.document.write(`<!DOCTYPE html><html><head><title>Barcode Labels — iPHIX Technologies</title>
  <script src="https://cdn.jsdelivr.net/npm/jsbarcode@3.11.5/dist/JsBarcode.all.min.js"><\/script>
  <style>${labelStyles(offset)}</style></head><body>
  <div class="no-print" style="font-family:Arial;font-size:13px;padding:10px 12px;color:#333;background:#f8fafc;border-bottom:1px solid #ddd;">
    <strong>iPHIX Technologies</strong> — ${expanded.length} barcode label${expanded.length !== 1 ? 's' : ''} · Zebra ZD230 · 100mm roll, 3-up 30×20mm labels
    ${(offset.x !== 0 || offset.y !== 0) ? `<span style="color:#2563eb;"> · offset applied: x=${offset.x}mm, y=${offset.y}mm</span>` : ''}
    ${skippedCount > 0 ? `<div style="color:#e11d48;margin-top:4px;">${skippedCount} item(s) skipped — no barcode set</div>` : ''}
  </div>
  <div class="sheet">
  ${(() => {
    const rows = []
    for (let i = 0; i < expanded.length; i += 3) rows.push(expanded.slice(i, i + 3))
    return rows.map((row, rIdx) => `<div class="row">${
      row.map((item, cIdx) => `<div class="label">
        <div class="nm">${item.name.length > 22 ? item.name.slice(0, 22) + '…' : item.name}</div>
        <svg id="bc${rIdx}_${cIdx}"></svg>
        <div class="cd">${item.barcode}</div>
        <div class="pr">LKR ${(item.selling_price || 0).toLocaleString('en-LK', { minimumFractionDigits: 2 })}</div>
      </div>`).join('')
    }</div>`).join('')
  })()}
  </div>
  <script>
    function renderAndPrint(){
      ${expanded.map((item, idx) => {
        const rIdx = Math.floor(idx / 3), cIdx = idx % 3
        return `try{JsBarcode("#bc${rIdx}_${cIdx}","${item.barcode}",{format:"CODE128",width:1.1,height:24,displayValue:false,margin:0});}catch(e){}`
      }).join('\n')}
      setTimeout(function(){ window.print(); }, 300);
    }
    if (typeof JsBarcode !== 'undefined') { renderAndPrint(); }
    else { window.addEventListener('load', renderAndPrint); setTimeout(renderAndPrint, 1500); }
  <\/script>
  </body></html>`)
  printWindow.document.close()

  return { printed: expanded.length, skipped: skippedCount }
}

// ── Calibration test sheet ───────────────────────────────────
// Prints one row of 3 labels with a full-bleed border and corner marks so
// you can see exactly how far off the real sticker edges are from the
// printed content, then dial in the right offset.
export function printCalibrationLabels() {
  const offset = getPrintOffset()
  const printWindow = window.open('', '_blank')
  printWindow.document.write(`<!DOCTYPE html><html><head><title>Barcode Print Calibration — iPHIX Technologies</title>
  <style>${labelStyles(offset)}
    .label { border: 1px solid #000 !important; justify-content: space-between !important; }
    .corner { font-size: 6px; }
  </style></head><body>
  <div class="no-print" style="font-family:Arial;font-size:13px;padding:10px 12px;color:#333;background:#f8fafc;border-bottom:1px solid #ddd;">
    <strong>iPHIX Technologies</strong> — Calibration sheet · current offset: x=${offset.x}mm, y=${offset.y}mm<br/>
    <span style="font-size:12px;color:#666;">Each box should exactly match one physical label, border touching all 4 edges. If not, adjust the offset in Print Barcode Labels → Calibrate Alignment.</span>
  </div>
  <div class="sheet">
    <div class="row">
      ${[1, 2, 3].map(n => `<div class="label">
        <div class="corner">TOP-LEFT</div>
        <div style="font-size:9px;font-weight:bold;">Label ${n}</div>
        <div class="corner" style="align-self:flex-end;">BOTTOM-RIGHT</div>
      </div>`).join('')}
    </div>
  </div>
  <script>setTimeout(function(){ window.print(); }, 200);<\/script>
  </body></html>`)
  printWindow.document.close()
}
