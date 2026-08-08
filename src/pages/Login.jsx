import { useState } from 'react'
import { Mail, Lock, ArrowRight } from 'lucide-react'
import { supabase } from '../supabase'
import Logo from '../components/Logo'

export default function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [focusField, setFocusField] = useState(null)

  const handleLogin = async (e) => {
    e.preventDefault()
    setLoading(true)
    setError('')
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) setError(error.message)
    setLoading(false)
  }

  const fieldStyle = (name) => ({
    width: '100%',
    padding: '13px 14px 13px 42px',
    border: `1.5px solid ${focusField === name ? '#E11D2E' : '#e6e2e0'}`,
    borderRadius: '10px',
    fontSize: '15px',
    fontFamily: "'Inter', system-ui, sans-serif",
    boxSizing: 'border-box',
    outline: 'none',
    background: '#fff',
    color: '#18181B',
    boxShadow: focusField === name ? '0 0 0 3px rgba(225,29,46,0.12)' : 'none',
    transition: 'border-color 0.15s, box-shadow 0.15s',
  })

  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      fontFamily: "'Inter', system-ui, -apple-system, sans-serif",
      background: '#FAFAF8'
    }}>
      {/* ───────── Left brand panel ───────── */}
      <div style={{
        flex: '1 1 52%',
        minWidth: '0',
        background: 'linear-gradient(160deg, #0B0B0D 0%, #17141A 55%, #1F1417 100%)',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        padding: '44px 48px',
        position: 'relative',
        overflow: 'hidden'
      }} className="iphix-login-panel">

        {/* Ambient PCB via-dot texture */}
        <svg width="100%" height="100%" style={{ position: 'absolute', inset: 0, opacity: 0.5 }} preserveAspectRatio="none">
          <defs>
            <pattern id="vias" width="46" height="46" patternUnits="userSpaceOnUse">
              <circle cx="2" cy="2" r="1.4" fill="#ffffff" opacity="0.08" />
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#vias)" />
        </svg>

        <div style={{ position: 'absolute', top: '-140px', right: '-120px', width: '380px', height: '380px', borderRadius: '50%', background: 'radial-gradient(circle, rgba(225,29,46,0.16), transparent 70%)' }} />

        {/* Logo — enlarged, on its own plate for contrast against the dark panel */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px', position: 'relative', zIndex: 1 }}>
          <Logo size={54} radius={14} />
          <div>
            <div style={{ color: 'white', fontWeight: '800', fontSize: '18px', letterSpacing: '-0.01em', fontFamily: "'Archivo', sans-serif" }}>iPHIX Technologies</div>
            <div style={{ color: '#8a8890', fontSize: '10.5px', fontWeight: '600', letterSpacing: '0.14em', textTransform: 'uppercase', marginTop: '2px' }}>Shop &amp; Repair ERP</div>
          </div>
        </div>

        {/* Signature illustration: exploded phone diagram with EKG pulse + circuit traces, echoing the brand mark */}
        <div style={{ position: 'relative', zIndex: 1, display: 'flex', justifyContent: 'center', margin: '8px 0' }}>
          <svg viewBox="0 0 460 360" width="100%" style={{ maxWidth: '440px', overflow: 'visible' }}>
            {/* ambient circuit traces fanning from the phone */}
            <g stroke="#ffffff" strokeOpacity="0.14" strokeWidth="1.4" fill="none">
              <path d="M300 90 H350 V60 H410" />
              <path d="M300 130 H370 V150 H430" />
              <path d="M160 90 H110 V50 H60" />
              <path d="M160 260 H100 V290 H40" />
            </g>
            <g stroke="#E11D2E" strokeOpacity="0.55" strokeWidth="1.6" fill="none">
              <path d="M300 180 H360 V210 H420" />
              <path d="M160 180 H100 V210 H50" />
            </g>
            {[[410,60],[430,150],[60,50],[40,290],[420,210],[50,210]].map(([cx,cy],i) => (
              <circle key={i} cx={cx} cy={cy} r="3.5" fill={i>=4 ? '#E11D2E' : '#ffffff'} fillOpacity={i>=4 ? 0.7 : 0.3} />
            ))}

            {/* phone body */}
            <rect x="165" y="55" width="130" height="240" rx="20" fill="#141216" stroke="#3a363b" strokeWidth="1.5" />
            <rect x="176" y="72" width="108" height="178" rx="4" fill="#0B0B0D" />
            <rect x="215" y="63" width="30" height="4" rx="2" fill="#3a363b" />
            <circle cx="230" cy="270" r="9" fill="none" stroke="#5a555c" strokeWidth="1.5" />

            {/* exploded internals with labeled leaders */}
            <rect x="195" y="95" width="24" height="16" rx="2" fill="#1F1417" stroke="#E11D2E" strokeWidth="1.2" />
            <path d="M219 103 H150" stroke="#65616a" strokeWidth="1" strokeDasharray="3 3" />
            <text x="145" y="106" textAnchor="end" fontFamily="'Inter', sans-serif" fontSize="10" letterSpacing="0.08em" fill="#a8a4ab">LOGIC BOARD</text>

            <rect x="200" y="150" width="60" height="70" rx="6" fill="#1F1417" stroke="#5a555c" strokeWidth="1.2" />
            <path d="M260 185 H330" stroke="#65616a" strokeWidth="1" strokeDasharray="3 3" />
            <text x="333" y="188" fontFamily="'Inter', sans-serif" fontSize="10" letterSpacing="0.08em" fill="#a8a4ab">Li-ion CELL</text>

            <circle cx="252" cy="80" r="4.5" fill="#1F1417" stroke="#5a555c" strokeWidth="1.2" />
            <path d="M256 80 H330" stroke="#65616a" strokeWidth="1" strokeDasharray="3 3" />
            <text x="333" y="83" fontFamily="'Inter', sans-serif" fontSize="10" letterSpacing="0.08em" fill="#a8a4ab">CAMERA MODULE</text>

            {/* EKG pulse line */}
            <path d="M20 330 H160 L172 300 L186 350 L198 318 L210 330 H440"
              stroke="#E11D2E" strokeWidth="2.4" fill="none" strokeLinejoin="round" strokeLinecap="round" />
            <circle cx="186" cy="350" r="4.5" fill="#E11D2E" className="iphix-pulse-dot" />
          </svg>
        </div>

        <div style={{ position: 'relative', maxWidth: '440px', zIndex: 1 }}>
          <div style={{ color: '#E11D2E', fontFamily: "'Instrument Serif', serif", fontStyle: 'italic', fontSize: '19px', marginBottom: '10px' }}>
            More than just repairs.
          </div>
          <h2 style={{ color: 'white', fontSize: '28px', fontWeight: '800', lineHeight: '1.25', letterSpacing: '-0.01em', margin: '0 0 12px', fontFamily: "'Archivo', sans-serif" }}>
            Every device. Every shop. One system.
          </h2>
          <p style={{ color: '#9b98a0', fontSize: '14.5px', lineHeight: '1.65', margin: 0 }}>
            Billing, inventory, purchasing, finance and HR — synced in real time across every iPHIX Technologies location.
          </p>
        </div>

        <div style={{ position: 'relative', color: '#5f5c63', fontSize: '12px', zIndex: 1 }}>© {new Date().getFullYear()} iPHIX Technologies</div>
      </div>

      {/* ───────── Right form panel ───────── */}
      <div style={{ flex: '1 1 48%', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px', position: 'relative' }}>
        <svg width="100%" height="100%" style={{ position: 'absolute', inset: 0, opacity: 1 }} preserveAspectRatio="none">
          <defs>
            <pattern id="vias-light" width="46" height="46" patternUnits="userSpaceOnUse">
              <circle cx="2" cy="2" r="1.3" fill="#0B0B0D" opacity="0.035" />
            </pattern>
          </defs>
          <rect width="100%" height="100%" fill="url(#vias-light)" />
        </svg>

        <div style={{ width: '100%', maxWidth: '380px', position: 'relative' }}>
          <div style={{ marginBottom: '28px', display: 'none', justifyContent: 'center' }} className="iphix-login-mobile-logo">
            <Logo size={52} radius={14} />
          </div>

          <h1 style={{ fontSize: '25px', fontWeight: '800', color: '#131113', margin: '0 0 6px', letterSpacing: '-0.01em', fontFamily: "'Archivo', sans-serif" }}>Welcome back</h1>
          <p style={{ color: '#7a767d', margin: '0 0 32px', fontSize: '14px', fontFamily: "'Instrument Serif', serif", fontStyle: 'italic' }}>Precision care for every device.</p>

          <form onSubmit={handleLogin}>
            <div style={{ marginBottom: '16px' }}>
              <label style={{ display: 'block', marginBottom: '6px', fontWeight: '600', color: '#3a373c', fontSize: '13px' }}>Email</label>
              <div style={{ position: 'relative' }}>
                <Mail size={17} strokeWidth={2} style={{ position: 'absolute', left: '14px', top: '50%', transform: 'translateY(-50%)', color: focusField === 'email' ? '#E11D2E' : '#a8a4ab' }} />
                <input
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  onFocus={() => setFocusField('email')}
                  onBlur={() => setFocusField(null)}
                  required
                  style={fieldStyle('email')}
                  placeholder="you@iphix.com"
                />
              </div>
            </div>

            <div style={{ marginBottom: '24px' }}>
              <label style={{ display: 'block', marginBottom: '6px', fontWeight: '600', color: '#3a373c', fontSize: '13px' }}>Password</label>
              <div style={{ position: 'relative' }}>
                <Lock size={17} strokeWidth={2} style={{ position: 'absolute', left: '14px', top: '50%', transform: 'translateY(-50%)', color: focusField === 'password' ? '#E11D2E' : '#a8a4ab' }} />
                <input
                  type="password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  onFocus={() => setFocusField('password')}
                  onBlur={() => setFocusField(null)}
                  required
                  style={fieldStyle('password')}
                  placeholder="Enter your password"
                />
              </div>
            </div>

            {error && (
              <div style={{ background: '#fdf1f1', border: '1px solid #f3c6c9', color: '#B91C2B', padding: '10px 14px', borderRadius: '10px', marginBottom: '16px', fontSize: '13px' }}>
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              style={{
                width: '100%', padding: '13px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
                background: loading ? '#e9a3a9' : 'linear-gradient(135deg, #E11D2E, #9A1220)',
                color: 'white', border: 'none', borderRadius: '10px', fontSize: '15px', fontWeight: '700',
                fontFamily: "'Inter', sans-serif",
                cursor: loading ? 'not-allowed' : 'pointer',
                boxShadow: loading ? 'none' : '0 8px 20px rgba(225,29,46,0.28)',
                transition: 'transform 0.1s'
              }}
              onMouseDown={e => { if (!loading) e.currentTarget.style.transform = 'scale(0.98)' }}
              onMouseUp={e => { e.currentTarget.style.transform = 'scale(1)' }}
            >
              {loading ? 'Signing in...' : <>Sign In <ArrowRight size={16} /></>}
            </button>
          </form>

          {/* Small brand pulse divider, echoing the wordmark's EKG line */}
          <svg width="120" height="20" viewBox="0 0 120 20" style={{ display: 'block', margin: '28px auto 0', opacity: 0.6 }}>
            <path d="M0 10 H44 L50 2 L57 18 L63 10 H120" stroke="#E11D2E" strokeWidth="1.6" fill="none" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
      </div>

      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Archivo:wght@700;800&family=Inter:wght@400;500;600;700&family=Instrument+Serif:ital@1&display=swap');

        .iphix-pulse-dot {
          animation: iphix-pulse 1.8s ease-in-out infinite;
          transform-origin: center;
        }
        @keyframes iphix-pulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.4; transform: scale(1.6); }
        }
        @media (prefers-reduced-motion: reduce) {
          .iphix-pulse-dot { animation: none; }
        }

        @media (max-width: 860px) {
          .iphix-login-panel { display: none !important; }
          .iphix-login-mobile-logo { display: flex !important; }
        }
      `}</style>
    </div>
  )
}
