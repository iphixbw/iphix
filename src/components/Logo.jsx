// iPHIX Technologies brand mark — small reusable logo used across sidebar, login, invoices.
// The logo's wordmark is black-on-transparent, so it disappears on dark backgrounds
// without a light plate behind it — this wraps it in one, scaled to the requested size.
export default function Logo({ size = 36, radius = null }) {
  const pad = Math.max(4, Math.round(size * 0.16))
  const r = radius ?? Math.round(size * 0.28)
  return (
    <div style={{
      width: size + pad * 2,
      height: size + pad * 2,
      background: '#FAFAF8',
      borderRadius: r,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      boxShadow: '0 2px 10px rgba(0,0,0,0.18)',
      flexShrink: 0,
    }}>
      <img
        src="/iphix-logo.png"
        alt="iPHIX Technologies"
        style={{ width: size, height: size, objectFit: 'contain', display: 'block' }}
      />
    </div>
  )
}
