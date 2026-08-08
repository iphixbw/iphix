// Phonefix brand mark — small reusable logo used across sidebar, login, invoices.
export default function Logo({ size = 36 }) {
  return (
    <img
      src="/phonefix-logo.png"
      alt="Phonefix"
      style={{ width: size, height: size, objectFit: 'contain', flexShrink: 0, display: 'block' }}
    />
  )
}
