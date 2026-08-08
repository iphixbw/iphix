import { useState } from 'react'
import { supabase } from '../supabase'
import Logo from '../components/Logo'

export default function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const handleLogin = async (e) => {
    e.preventDefault()
    setLoading(true)
    setError('')
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) setError(error.message)
    setLoading(false)
  }

  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      fontFamily: 'system-ui, -apple-system, sans-serif',
      background: '#f8fafc'
    }}>
      {/* Left brand panel — hidden on narrow viewports via inline media-query-free responsive flex */}
      <div style={{
        flex: '1 1 46%',
        minWidth: '0',
        background: 'linear-gradient(155deg, #0b1220 0%, #12203f 55%, #1e3a8a 100%)',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        padding: '48px',
        position: 'relative',
        overflow: 'hidden'
      }} className="phonefix-login-panel">
        <div style={{ position: 'absolute', top: '-120px', right: '-120px', width: '360px', height: '360px', borderRadius: '50%', background: 'radial-gradient(circle, rgba(37,99,235,0.35), transparent 70%)' }} />
        <div style={{ position: 'absolute', bottom: '-160px', left: '-100px', width: '420px', height: '420px', borderRadius: '50%', background: 'radial-gradient(circle, rgba(96,165,250,0.15), transparent 70%)' }} />

        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', position: 'relative' }}>
          <Logo size={40} radius={11} />
          <div>
            <div style={{ color: 'white', fontWeight: '800', fontSize: '17px', letterSpacing: '-0.01em' }}>Phonefix</div>
            <div style={{ color: '#7d9be0', fontSize: '11px', fontWeight: '600', letterSpacing: '0.06em', textTransform: 'uppercase' }}>ERP System</div>
          </div>
        </div>

        <div style={{ position: 'relative', maxWidth: '420px' }}>
          <h2 style={{ color: 'white', fontSize: '30px', fontWeight: '800', lineHeight: '1.25', letterSpacing: '-0.01em', margin: '0 0 14px' }}>
            Run every shop from one dashboard.
          </h2>
          <p style={{ color: '#93a5c9', fontSize: '15px', lineHeight: '1.6', margin: 0 }}>
            Billing, inventory, purchasing, finance and HR — all in sync, across every Phonefix location.
          </p>
        </div>

        <div style={{ position: 'relative', color: '#5b7099', fontSize: '12px' }}>© {new Date().getFullYear()} Phonefix (PVT) Ltd</div>
      </div>

      {/* Right form panel */}
      <div style={{ flex: '1 1 54%', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px' }}>
        <div style={{ width: '100%', maxWidth: '380px' }}>
          <div style={{ marginBottom: '8px', display: 'none' }} className="phonefix-login-mobile-logo">
            <Logo size={40} radius={11} />
          </div>

          <h1 style={{ fontSize: '24px', fontWeight: '800', color: '#0f172a', margin: '0 0 6px', letterSpacing: '-0.01em' }}>Welcome back</h1>
          <p style={{ color: '#64748b', margin: '0 0 32px', fontSize: '14px' }}>Sign in to your Phonefix account</p>

          <form onSubmit={handleLogin}>
            <div style={{ marginBottom: '16px' }}>
              <label style={{ display: 'block', marginBottom: '6px', fontWeight: '600', color: '#334155', fontSize: '13px' }}>Email</label>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                required
                style={{ width: '100%', padding: '12px 14px', border: '1.5px solid #e2e8f0', borderRadius: '10px', fontSize: '15px', boxSizing: 'border-box', outline: 'none', transition: 'border-color 0.15s, box-shadow 0.15s' }}
                placeholder="you@phonefix.lk"
                onFocus={e => { e.target.style.borderColor = '#2563eb'; e.target.style.boxShadow = '0 0 0 3px rgba(37,99,235,0.12)' }}
                onBlur={e => { e.target.style.borderColor = '#e2e8f0'; e.target.style.boxShadow = 'none' }}
              />
            </div>

            <div style={{ marginBottom: '24px' }}>
              <label style={{ display: 'block', marginBottom: '6px', fontWeight: '600', color: '#334155', fontSize: '13px' }}>Password</label>
              <input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                required
                style={{ width: '100%', padding: '12px 14px', border: '1.5px solid #e2e8f0', borderRadius: '10px', fontSize: '15px', boxSizing: 'border-box', outline: 'none', transition: 'border-color 0.15s, box-shadow 0.15s' }}
                placeholder="Enter your password"
                onFocus={e => { e.target.style.borderColor = '#2563eb'; e.target.style.boxShadow = '0 0 0 3px rgba(37,99,235,0.12)' }}
                onBlur={e => { e.target.style.borderColor = '#e2e8f0'; e.target.style.boxShadow = 'none' }}
              />
            </div>

            {error && (
              <div style={{ background: '#fef2f2', border: '1px solid #fecaca', color: '#dc2626', padding: '10px 14px', borderRadius: '10px', marginBottom: '16px', fontSize: '13px' }}>
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              style={{ width: '100%', padding: '13px', background: loading ? '#93c5fd' : 'linear-gradient(135deg, #2563eb, #1d4ed8)', color: 'white', border: 'none', borderRadius: '10px', fontSize: '15px', fontWeight: '700', cursor: loading ? 'not-allowed' : 'pointer', boxShadow: loading ? 'none' : '0 8px 20px rgba(37,99,235,0.25)', transition: 'transform 0.1s' }}
              onMouseDown={e => { if (!loading) e.currentTarget.style.transform = 'scale(0.98)' }}
              onMouseUp={e => { e.currentTarget.style.transform = 'scale(1)' }}
            >
              {loading ? 'Signing in...' : 'Sign In'}
            </button>
          </form>
        </div>
      </div>

      <style>{`
        @media (max-width: 860px) {
          .phonefix-login-panel { display: none !important; }
          .phonefix-login-mobile-logo { display: block !important; margin-bottom: 24px !important; }
        }
      `}</style>
    </div>
  )
}
