import { useState, useEffect } from 'react'
import { supabase } from '../supabase'
import toast from 'react-hot-toast'
import Logo from '../components/Logo'

export default function ShopSelector({ session, onShopSelected }) {
  const [shops, setShops] = useState([])
  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(true)
  const [selecting, setSelecting] = useState(false)

  useEffect(() => { fetchShops() }, [])

  async function fetchShops() {
    setLoading(true)
    try {
      // Get user profile
      const { data: prof } = await supabase
        .from('user_profiles')
        .select('*')
        .eq('id', session.user.id)
        .single()

      setProfile(prof)

      // Super admin sees all shops
      if (!prof || prof.role === 'super_admin') {
        const { data: allShops } = await supabase.from('shops').select('*').order('name')
        setShops(allShops || [])
      } else {
        // Other users see only their assigned shops
        const { data: userShops } = await supabase
          .from('user_shops')
          .select('shops(*)')
          .eq('user_id', session.user.id)

        const assignedShops = (userShops || []).map(us => us.shops).filter(Boolean)

        if (assignedShops.length === 0) {
          toast.error('You have not been assigned to any shop. Please contact your admin.')
          setShops([])
        } else {
          setShops(assignedShops)
        }
      }
    } catch (e) {
      toast.error('Failed to load shops')
    }
    setLoading(false)
  }

  async function selectShop(shop) {
    setSelecting(true)
    try {
      await supabase
        .from('user_profiles')
        .upsert({ id: session.user.id, active_shop_id: shop.id })
      onShopSelected(shop)
    } catch (e) {
      toast.error('Failed to select shop')
    }
    setSelecting(false)
  }

  if (loading) return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'linear-gradient(155deg, #0b1220 0%, #12203f 55%, #1e3a8a 100%)', fontFamily: 'system-ui, -apple-system, sans-serif' }}>
      <div style={{ color: 'white', fontSize: '15px' }}>Loading...</div>
    </div>
  )

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'linear-gradient(155deg, #0b1220 0%, #12203f 55%, #1e3a8a 100%)', fontFamily: 'system-ui, -apple-system, sans-serif', padding: '24px', position: 'relative', overflow: 'hidden' }}>
      <div style={{ position: 'absolute', top: '-140px', right: '-140px', width: '400px', height: '400px', borderRadius: '50%', background: 'radial-gradient(circle, rgba(37,99,235,0.3), transparent 70%)' }} />

      <div style={{ width: '100%', maxWidth: '520px', position: 'relative' }}>

        {/* Logo */}
        <div style={{ textAlign: 'center', marginBottom: '36px' }}>
          <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '16px' }}>
            <Logo size={52} radius={14} />
          </div>
          <h1 style={{ color: 'white', fontSize: '22px', fontWeight: '800', margin: '0 0 6px', letterSpacing: '-0.01em' }}>Welcome back!</h1>
          <p style={{ color: '#93a5c9', fontSize: '14px', margin: 0 }}>
            {profile?.full_name || session.user.email} — Select your shop to continue
          </p>
        </div>

        {/* Shop cards */}
        {shops.length === 0 ? (
          <div style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '16px', padding: '40px', textAlign: 'center' }}>
            <div style={{ fontSize: '36px', marginBottom: '12px' }}>🏪</div>
            <div style={{ color: '#93a5c9', fontSize: '14px' }}>No shops assigned to your account.</div>
            <div style={{ color: '#5b7099', fontSize: '13px', marginTop: '6px' }}>Please contact your administrator.</div>
            <button onClick={() => supabase.auth.signOut()}
              style={{ marginTop: '20px', padding: '10px 24px', background: 'rgba(239,68,68,0.15)', color: '#f87171', border: '1px solid rgba(239,68,68,0.25)', borderRadius: '10px', cursor: 'pointer', fontSize: '14px', fontWeight: '600' }}>
              Sign Out
            </button>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            {shops.map(shop => (
              <button key={shop.id} onClick={() => selectShop(shop)} disabled={selecting}
                style={{ background: 'rgba(255,255,255,0.05)', border: '1.5px solid rgba(255,255,255,0.1)', borderRadius: '14px', padding: '20px 24px', cursor: 'pointer', textAlign: 'left', transition: 'all 0.15s', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}
                onMouseEnter={e => { e.currentTarget.style.background = 'rgba(37,99,235,0.16)'; e.currentTarget.style.borderColor = '#2563eb' }}
                onMouseLeave={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.05)'; e.currentTarget.style.borderColor = 'rgba(255,255,255,0.1)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
                  <div style={{ width: '44px', height: '44px', background: 'linear-gradient(135deg,#2563eb,#1d4ed8)', borderRadius: '11px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '20px', flexShrink: 0 }}>🏪</div>
                  <div>
                    <div style={{ color: 'white', fontWeight: '700', fontSize: '16px', marginBottom: '3px' }}>{shop.name}</div>
                    {shop.address && <div style={{ color: '#93a5c9', fontSize: '13px' }}>📍 {shop.address}</div>}
                    {shop.phone && <div style={{ color: '#93a5c9', fontSize: '13px' }}>📞 {shop.phone}</div>}
                  </div>
                </div>
                <div style={{ color: '#60a5fa', fontSize: '20px' }}>→</div>
              </button>
            ))}
          </div>
        )}

        {/* Sign out */}
        <div style={{ textAlign: 'center', marginTop: '24px' }}>
          <button onClick={() => supabase.auth.signOut()}
            style={{ background: 'none', border: 'none', color: '#5b7099', fontSize: '13px', cursor: 'pointer', fontWeight: '500' }}>
            ← Sign out ({session.user.email})
          </button>
        </div>
      </div>
    </div>
  )
}
