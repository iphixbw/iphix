import { useState } from 'react'
import { printBarcodeLabels, printCalibrationLabels, getPrintOffset, setPrintOffset } from '../lib/barcodeLabels'

// items: array of { id, name, barcode, selling_price } to offer for printing.
// defaultQty: initial copies per item (e.g. purchased quantity).
// onClose: called when the modal is dismissed.
export default function BarcodePrintModal({ items, defaultQty = {}, onClose }) {
  const [qtys, setQtys] = useState(() => {
    const init = {}
    for (const it of items) init[it.id] = String(defaultQty[it.id] ?? 1)
    return init
  })
  const [showCalibrate, setShowCalibrate] = useState(false)
  const [offset, setOffset] = useState(() => getPrintOffset())

  const noBarcodeCount = items.filter(i => !i.barcode).length
  const totalLabels = items.reduce((sum, i) => sum + (i.barcode ? (parseInt(qtys[i.id], 10) || 0) : 0), 0)

  function setQty(id, val) {
    setQtys(prev => ({ ...prev, [id]: val }))
  }

  function setAllQty(val) {
    const next = {}
    for (const it of items) next[it.id] = String(val)
    setQtys(next)
  }

  function nudge(axis, delta) {
    const next = { ...offset, [axis]: Math.round((offset[axis] + delta) * 10) / 10 }
    setOffset(next)
    setPrintOffset(next.x, next.y)
  }

  function resetOffset() {
    setOffset({ x: 0, y: 0 })
    setPrintOffset(0, 0)
  }

  function handlePrint() {
    const withQty = items.map(i => ({ ...i, qty: parseInt(qtys[i.id], 10) || 0 })).filter(i => i.qty > 0)
    printBarcodeLabels(withQty)
    onClose()
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '20px' }}>
      <div style={{ background: 'white', borderRadius: '16px', padding: '24px', width: '100%', maxWidth: '520px', maxHeight: '85vh', display: 'flex', flexDirection: 'column', boxShadow: '0 20px 60px rgba(0,0,0,0.3)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
          <h3 style={{ fontSize: '17px', fontWeight: '800', color: '#0f172a', margin: 0 }}>🖨 Print Barcode Labels</h3>
          <button onClick={onClose} style={{ background: 'none', border: 'none', fontSize: '20px', color: '#94a3b8', cursor: 'pointer', lineHeight: 1 }}>✕</button>
        </div>
        <p style={{ fontSize: '12.5px', color: '#64748b', margin: '0 0 10px' }}>
          Zebra ZD230 · 100mm roll · 3 labels per row · 30×20mm each. Set how many copies of each label to print.
        </p>

        <button onClick={() => setShowCalibrate(v => !v)}
          style={{ display: 'flex', alignItems: 'center', gap: '6px', background: 'none', border: 'none', color: '#2563eb', fontSize: '12px', fontWeight: '700', cursor: 'pointer', padding: '0 0 12px' }}>
          🎯 {showCalibrate ? 'Hide' : 'Prints misaligned? Calibrate alignment'} {showCalibrate ? '▲' : '▼'}
        </button>

        {showCalibrate && (
          <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '10px', padding: '14px', marginBottom: '14px' }}>
            <p style={{ fontSize: '11.5px', color: '#64748b', margin: '0 0 10px' }}>
              If the printed text lands shifted off the sticker, nudge it here, print a test sheet, and repeat until it lines up. The offset is saved and reused every time you print.
            </p>
            <div style={{ display: 'flex', gap: '18px', marginBottom: '10px', flexWrap: 'wrap' }}>
              <div>
                <div style={{ fontSize: '10px', fontWeight: '700', color: '#94a3b8', textTransform: 'uppercase', marginBottom: '4px' }}>Horizontal (mm)</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <button onClick={() => nudge('x', -0.5)} style={{ width: '26px', height: '26px', border: '1px solid #e2e8f0', background: 'white', borderRadius: '6px', cursor: 'pointer', fontWeight: '700' }}>◀</button>
                  <span style={{ fontSize: '13px', fontWeight: '700', color: '#0f172a', minWidth: '38px', textAlign: 'center' }}>{offset.x}</span>
                  <button onClick={() => nudge('x', 0.5)} style={{ width: '26px', height: '26px', border: '1px solid #e2e8f0', background: 'white', borderRadius: '6px', cursor: 'pointer', fontWeight: '700' }}>▶</button>
                </div>
              </div>
              <div>
                <div style={{ fontSize: '10px', fontWeight: '700', color: '#94a3b8', textTransform: 'uppercase', marginBottom: '4px' }}>Vertical (mm)</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <button onClick={() => nudge('y', -0.5)} style={{ width: '26px', height: '26px', border: '1px solid #e2e8f0', background: 'white', borderRadius: '6px', cursor: 'pointer', fontWeight: '700' }}>▲</button>
                  <span style={{ fontSize: '13px', fontWeight: '700', color: '#0f172a', minWidth: '38px', textAlign: 'center' }}>{offset.y}</span>
                  <button onClick={() => nudge('y', 0.5)} style={{ width: '26px', height: '26px', border: '1px solid #e2e8f0', background: 'white', borderRadius: '6px', cursor: 'pointer', fontWeight: '700' }}>▼</button>
                </div>
              </div>
            </div>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button onClick={printCalibrationLabels}
                style={{ padding: '6px 14px', background: '#eef2ff', color: '#1e40af', border: 'none', borderRadius: '7px', cursor: 'pointer', fontSize: '12px', fontWeight: '700' }}>
                🖨 Print Test Sheet
              </button>
              <button onClick={resetOffset}
                style={{ padding: '6px 14px', background: '#fee2e2', color: '#b91c1c', border: 'none', borderRadius: '7px', cursor: 'pointer', fontSize: '12px', fontWeight: '700' }}>
                Reset to 0
              </button>
            </div>
          </div>
        )}

        {noBarcodeCount > 0 && (
          <div style={{ background: '#fffbeb', border: '1px solid #fde68a', borderRadius: '8px', padding: '8px 12px', marginBottom: '12px', fontSize: '12px', color: '#92400e' }}>
            ⚠️ {noBarcodeCount} item{noBarcodeCount > 1 ? 's have' : ' has'} no barcode set and will be skipped.
          </div>
        )}

        <div style={{ display: 'flex', gap: '8px', marginBottom: '12px' }}>
          <span style={{ fontSize: '12px', color: '#64748b', alignSelf: 'center', marginRight: '2px' }}>Set all to:</span>
          {[1, 2, 5, 10].map(n => (
            <button key={n} onClick={() => setAllQty(n)}
              style={{ padding: '4px 12px', background: '#eef2ff', color: '#1e40af', border: 'none', borderRadius: '7px', cursor: 'pointer', fontSize: '12px', fontWeight: '700' }}>
              {n}
            </button>
          ))}
        </div>

        <div style={{ flex: 1, overflowY: 'auto', border: '1px solid #f1f5f9', borderRadius: '10px' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
            <thead>
              <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
                <th style={{ padding: '8px 12px', textAlign: 'left', fontSize: '10px', fontWeight: '700', color: '#94a3b8', textTransform: 'uppercase' }}>Item</th>
                <th style={{ padding: '8px 12px', textAlign: 'center', fontSize: '10px', fontWeight: '700', color: '#94a3b8', textTransform: 'uppercase', width: '90px' }}>Copies</th>
              </tr>
            </thead>
            <tbody>
              {items.map(item => (
                <tr key={item.id} style={{ borderBottom: '1px solid #f8fafc', opacity: item.barcode ? 1 : 0.5 }}>
                  <td style={{ padding: '8px 12px' }}>
                    <div style={{ fontWeight: '600', color: '#0f172a' }}>{item.name}</div>
                    <div style={{ fontSize: '11px', color: item.barcode ? '#94a3b8' : '#e11d48', fontFamily: 'monospace' }}>
                      {item.barcode || 'No barcode set'}
                    </div>
                  </td>
                  <td style={{ padding: '8px 12px', textAlign: 'center' }}>
                    <input type="number" min="0" value={qtys[item.id] ?? ''} disabled={!item.barcode}
                      onChange={e => setQty(item.id, e.target.value)}
                      style={{ width: '64px', padding: '5px 8px', border: '1.5px solid #e2e8f0', borderRadius: '7px', fontSize: '13px', textAlign: 'center' }} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '16px' }}>
          <span style={{ fontSize: '13px', color: '#64748b' }}>
            <strong style={{ color: '#0f172a' }}>{totalLabels}</strong> label{totalLabels !== 1 ? 's' : ''} will print
          </span>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button onClick={onClose}
              style={{ padding: '9px 18px', background: '#f1f5f9', color: '#475569', border: 'none', borderRadius: '10px', cursor: 'pointer', fontWeight: '700', fontSize: '13px' }}>
              Cancel
            </button>
            <button onClick={handlePrint} disabled={totalLabels === 0}
              style={{ padding: '9px 20px', background: totalLabels === 0 ? '#93c5fd' : 'linear-gradient(135deg,#2563eb,#1d4ed8)', color: 'white', border: 'none', borderRadius: '10px', cursor: totalLabels === 0 ? 'not-allowed' : 'pointer', fontWeight: '700', fontSize: '13px' }}>
              🖨 Print {totalLabels > 0 ? totalLabels : ''} Label{totalLabels !== 1 ? 's' : ''}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
