// ============================================================
// frontend/src/pages/DashboardPage.jsx — Responsive
// ============================================================

import { useState, useEffect, useRef } from 'react'
import { RefreshCw, WifiOff, Server, Layers, BookOpen } from 'lucide-react'
import { getDevices, getDashboard } from '../api/client.js'

const pad = n => (n < 10 ? '0' + n : n)
const FARM_COLORS = ['#34d96f', '#4d9de0', '#f5a623', '#b197fc', '#f5e642']

function computeAverages(farms) {
  const all = farms.flatMap(f => f.houses || [])
  if (!all.length) return null
  const avg = key => {
    const vals = all.map(h => h.metrics?.[key]?.value).filter(v => v != null && !isNaN(v))
    return vals.length ? (vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(2) : '—'
  }
  return { ec: avg('ec'), ph: avg('ph'), temp: avg('temp'), hum: avg('hum'), rad: avg('rad'), flow: avg('flow') }
}

function lastSeenLabel(min, lastSyncRaw) {
  if (min === null || min === undefined) return 'Jamais'
  if (min < 2) return "à l'instant"
  if (min < 1440) {
    if (min < 60) return `il y a ${min} min`
    return `il y a ${Math.floor(min / 60)}h`
  }
  // > 24h → afficher la date de dernière sync
  if (lastSyncRaw) {
    const d = new Date(lastSyncRaw)
    const dd = pad(d.getDate()), mm = pad(d.getMonth() + 1), yyyy = d.getFullYear()
    return `${dd}/${mm}/${yyyy}`
  }
  return 'Plus de 24h'
}

function Sparkline({ color }) {
  return (
    <svg width="120" height="60" viewBox="0 0 120 60"
      style={{ position: 'absolute', bottom: 0, right: 0, opacity: 0.07, pointerEvents: 'none' }}>
      <polyline points="0,45 20,38 40,42 60,25 80,30 100,18 120,22" fill="none" stroke={color} strokeWidth="2" />
    </svg>
  )
}

function OnlineBadge({ online, dark, C }) {
  const green = '#34d96f', red = '#ff5050'
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 6,
      background: online
        ? (dark ? 'rgba(52,217,111,0.10)' : 'rgba(52,217,111,0.08)')
        : (dark ? 'rgba(255,80,80,0.10)' : 'rgba(255,80,80,0.08)'),
      border: `1px solid ${online ? green + '30' : red + '30'}`,
      borderRadius: 6, padding: '4px 10px',
      color: online ? C.green : C.red, fontWeight: 630, fontSize: 11,
      whiteSpace: 'nowrap', flexShrink: 0,
    }}>
      <div style={{ position: 'relative', width: 10, height: 10, flexShrink: 0 }}>
        {online && (
          <div style={{
            position: 'absolute', top: '50%', left: '50%',
            transform: 'translate(-50%, -50%)',
            width: 10, height: 10, borderRadius: '50%',
            background: C.green, opacity: 0.4,
            animation: 'ripple 1.5s ease-out infinite',
          }} />
        )}
        <div style={{
          position: 'absolute', top: '50%', left: '50%',
          transform: 'translate(-50%, -50%)',
          width: 8, height: 8, borderRadius: '50%',
          background: online ? C.green : red,
          boxShadow: online ? `0 0 5px ${C.green}` : 'none',
        }} />
      </div>
      {online ? '\u00A0En ligne' : 'Hors ligne'}
    </div>
  )
}

function HouseCard({ house, onSelectDevice, C, dark, accentColor, isMobile }) {
  const [hovered, setHovered] = useState(false)
  const ec = house.metrics?.ec?.value ?? '—'
  const ph = house.metrics?.ph?.value ?? '—'
  const temp = house.metrics?.temp?.value ?? '—'
  const hum = house.metrics?.hum?.value ?? '—'
  const isOnline = house.online ?? false
  const lastSyncRaw = house.last_sync ?? house.updated_at ?? house.last_timestamp ?? null
  const syncStr = lastSyncRaw
    ? new Date(lastSyncRaw).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
    : null
  const irrigating = house.irrigating ?? house.irrigation_active ?? false

  return (
    <div
      onClick={() => onSelectDevice(house)}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        background: dark ? '#111a14' : '#ffffff',
        border: `1px solid ${hovered ? (dark ? '#2a5a38' : '#6dc98a') : (dark ? '#1c2e22' : '#c8e0d0')}`,
        borderRadius: 16, padding: isMobile ? 16 : 24,
        cursor: 'pointer', position: 'relative', overflow: 'hidden',
        transition: 'border-color 0.2s, transform 0.2s',
        transform: hovered ? 'translateY(-2px)' : 'translateY(0)',
        height: '100%', boxSizing: 'border-box',
      }}
    >
      <Sparkline color={accentColor} />

      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 16 }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: isMobile ? 15 : 18, fontWeight: 630, color: C.text, marginBottom: 3 }}>
            Station {house.house_number}
          </div>
          <div style={{ fontSize: 11, color: C.textDim }}>
            {syncStr ? `dernière sync · ${syncStr}` : 'aucune synchronisation'}
          </div>
        </div>
        <OnlineBadge online={isOnline} dark={dark} C={C} />
      </div>

      {!isOnline ? (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10,
          padding: '14px 0', marginBottom: 16,
          color: dark ? '#3a5a44' : '#8aaa96', fontSize: 12,
        }}>
          <WifiOff size={15} strokeWidth={1.8} color={dark ? '#3a5a44' : '#aac4b4'} />
          <span>Aucune donnée depuis {lastSeenLabel(house.last_seen_min ?? house.minutes_since_last ?? null, house.last_sync ?? house.updated_at ?? house.last_timestamp ?? null)}</span>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 16 }}>
          {[
            { label: 'EC Apport', value: ec, unit: 'mS/cm', color: '#34d96f' },
            { label: 'pH Apport', value: ph, unit: '', color: '#4d9de0' },
            { label: 'Temp Serre', value: temp, unit: '°C', color: '#f5a623' },
            { label: 'Hum Serre', value: hum, unit: '%', color: '#b197fc' },
          ].map(m => (
            <div key={m.label} style={{
              background: dark ? '#0d1610' : '#f0f8f3',
              border: `1px solid ${dark ? '#162418' : '#c0deca'}`,
              borderRadius: 10, padding: isMobile ? '10px 12px' : '14px 16px',
            }}>
              <div style={{ fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.12em', color: dark ? '#3a5a44' : '#4a7a5a', marginBottom: 4 }}>
                {m.label}
              </div>
              <div style={{ fontSize: isMobile ? 18 : 22, fontWeight: 630, letterSpacing: '-0.02em', color: m.color }}>
                {m.value}
                {m.unit && <span style={{ fontSize: 11, fontWeight: 400, color: C.textDim, marginLeft: 3 }}>{m.unit}</span>}
              </div>
            </div>
          ))}
        </div>
      )}

      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        paddingTop: 14, borderTop: `1px solid ${dark ? '#162418' : '#e0ece4'}`,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12, color: !isOnline ? C.textDim : irrigating ? '#34d96f' : C.textDim }}>
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: !isOnline ? C.textDim : irrigating ? '#34d96f' : C.textDim, opacity: !isOnline ? 0.35 : 1 }} />
          {!isOnline ? 'Inconnu (hors ligne)' : irrigating ? 'Irrigation active' : 'Arrêtée'}
        </div>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 6,
          fontSize: 12, fontWeight: 600,
          background: dark ? '#0d2216' : '#eaf7ef',
          border: `1px solid ${dark ? '#1a4428' : '#90c8a4'}`,
          borderRadius: 8, padding: '6px 12px',
          color: dark ? '#34d96f' : '#1a7a40',
        }}>
          Détails
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="5" y1="12" x2="19" y2="12" /><polyline points="12 5 19 12 12 19" />
          </svg>
        </div>
      </div>
    </div>
  )
}

export default function DashboardPage({ token, onSelectDevice, C, dark, isMobile = false, isTablet = false }) {
  const [farms, setFarms] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [time, setTime] = useState('')
  const [readings24h, setReadings24h] = useState(null)
  const [refreshing, setRefreshing] = useState(false)

  useEffect(() => {
    const tick = () => {
      const d = new Date()
      setTime(`${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`)
    }
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [])

  const loadFarms = async (silent = false) => {
    if (!silent) setLoading(true)
    else setRefreshing(true)
    setError(null)
    try {
      const data = await getDashboard(token)
      console.log('Dashboard data:', data)
      setFarms(data?.farms || [])
      if (data?.stats?.readings_24h !== undefined) setReadings24h(data.stats.readings_24h)
    } catch (e) {
      setError('Impossible de charger les fermes.')
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }

  useEffect(() => {
    loadFarms()
    const interval = setInterval(() => loadFarms(true), 30_000)
    return () => clearInterval(interval)
  }, [token])

  useEffect(() => {
    const id = 'az-keyframes'
    if (!document.getElementById(id)) {
      const s = document.createElement('style')
      s.id = id
      s.textContent = `
        @keyframes az-pulse { 0%,100% { opacity:1; transform:scale(1); } 50% { opacity:.5; transform:scale(.85); } }
        @keyframes az-fade-in { from { opacity:0; transform:translateY(8px); } to { opacity:1; transform:translateY(0); } }
        @keyframes ripple { 0% { transform:translate(-50%,-50%) scale(1); opacity:0.4; } 100% { transform:translate(-50%,-50%) scale(2.8); opacity:0; } }
        @keyframes az-spin { to { transform: rotate(360deg); } }
      `
      document.head.appendChild(s)
    }
  }, [])

  const totalHouses = farms.reduce((a, f) => a + (f.houses?.length || 0), 0)
  const onlineHouses = farms.reduce((a, f) => a + (f.houses?.filter(h => h.online ?? false).length || 0), 0)
  const systemOnline = onlineHouses > 0

  // Responsive grid columns pour stats
  const statsGridCols = isMobile ? '1fr' : isTablet ? '1fr 1fr' : 'repeat(3, 1fr)'
  // Responsive houses layout
  const housesLayout = isMobile ? 'column' : 'row'

  return (
    <div style={{ animation: 'az-fade-in 0.35s ease both' }}>

      {/* Topbar */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        marginBottom: 24, flexWrap: 'wrap', gap: 12,
      }}>
        <div style={{ fontSize: isMobile ? 18 : 22, fontWeight: 900, color: C.text }}>
          Dashboard
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: isMobile ? 10 : 20, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: systemOnline ? C.green : C.red, fontWeight: 630, fontSize: 11 }}>
            <div style={{ position: 'relative', width: 10, height: 10, flexShrink: 0 }}>
              {systemOnline && (
                <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', width: 10, height: 10, borderRadius: '50%', background: C.green, opacity: 0.4, animation: 'ripple 1.5s ease-out infinite' }} />
              )}
              <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', width: 8, height: 8, borderRadius: '50%', background: systemOnline ? C.green : C.red, boxShadow: systemOnline ? `0 0 5px ${C.green}` : 'none' }} />
            </div>
            {systemOnline ? '\u00A0Système actif' : 'Hors ligne'}
          </div>

          {!isMobile && <div style={{ fontSize: 11, color: C.textDim }}>{time}</div>}

          <button
            onClick={() => loadFarms(true)} disabled={refreshing}
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '7px 14px', background: C.toggleBg,
              border: `1px solid ${dark ? '#1c2e22' : '#c0d8c8'}`, borderRadius: 8,
              color: C.textMuted, fontSize: 12, fontWeight: 630,
              cursor: 'pointer', fontFamily: 'inherit',
            }}
          >
            <RefreshCw size={12} strokeWidth={2} style={{ animation: refreshing ? 'az-spin 0.7s linear infinite' : 'none' }} />
            {!isMobile && 'Actualiser'}
          </button>
        </div>
      </div>

      {/* Stats cards */}
      <div style={{ display: 'grid', gridTemplateColumns: statsGridCols, gap: 14, marginBottom: 24 }}>
        {[
          { label: 'Fermes actives', value: farms.length > 0 ? farms.length : null, color: '#34d96f', Icon: Server, detail: farms.length > 0 ? farms.map(f => f.farm_name).join(' · ') : null },
          { label: 'Stations en ligne', value: totalHouses > 0 ? onlineHouses : null, suffix: totalHouses > 0 ? `/${totalHouses}` : null, color: '#4d9de0', Icon: Layers, detail: totalHouses > 0 ? (onlineHouses === totalHouses ? 'toutes opérationnelles' : `${totalHouses - onlineHouses} hors ligne`) : null, detailHighlight: onlineHouses === totalHouses && totalHouses > 0 },
          { label: 'Lectures / 24h', value: readings24h !== null ? readings24h.toLocaleString('fr-FR') : null, color: '#f5a623', Icon: BookOpen, detail: readings24h !== null ? 'enregistrements' : null },
        ].map(s => (
          <div key={s.label} style={{
            background: dark ? '#111a14' : '#ffffff',
            border: `1px solid ${dark ? '#1c2e22' : '#d0e8d8'}`,
            borderRadius: 16, padding: isMobile ? '18px 20px' : '24px 28px',
            position: 'relative', overflow: 'hidden',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
              <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.12em', color: dark ? C.textDim : '#5a7a66' }}>{s.label}</div>
              <s.Icon size={18} strokeWidth={1.6} color={s.color} style={{ opacity: 0.65 }} />
            </div>
            <div style={{ fontSize: isMobile ? 32 : 42, fontWeight: 630, letterSpacing: '-0.03em', lineHeight: 1, marginBottom: 6, color: s.color }}>
              {s.value ?? '—'}
              {s.suffix && <span style={{ fontSize: 18, color: dark ? '#2a4a5a' : '#8ab0be', fontWeight: 300 }}>{s.suffix}</span>}
            </div>
            {s.detail && (
              <div style={{ fontSize: 12, color: s.detailHighlight ? '#34d96f' : (dark ? C.textDim : '#5a7a66'), overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {s.detail}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Loading / Error */}
      {loading && (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16, padding: '60px 0', color: C.textDim }}>
          <RefreshCw size={22} style={{ animation: 'az-pulse 1.2s ease-in-out infinite' }} />
          <div style={{ fontSize: 12 }}>Chargement des fermes…</div>
        </div>
      )}

      {error && !loading && (
        <div style={{ background: dark ? '#1a0d0d' : '#fde8e8', border: '1px solid #5a1a1a', borderRadius: 12, padding: '16px 20px', color: '#e05555', fontSize: 12, marginBottom: 24 }}>
          ⚠ {error}
        </div>
      )}

      {/* Farms + Houses */}
      {!loading && farms.map((farm, fi) => (
        <div key={farm.farm_name || fi}>
          <div style={{
            fontSize: 12, fontWeight: 630, textTransform: 'uppercase',
            letterSpacing: '0.14em', color: dark ? '#2a5a38' : '#2a7a48',
            marginBottom: 12, marginTop: fi > 0 ? 28 : 0,
            display: 'flex', alignItems: 'center', gap: 12,
          }}>
            {farm.farm_name}
            <span style={{ flex: 1, height: 1, background: dark ? '#162418' : '#c8dece' }} />
          </div>

          <div style={{
            display: 'flex',
            flexDirection: housesLayout,
            gap: 14, marginBottom: 8,
            flexWrap: isMobile ? 'nowrap' : 'nowrap',
          }}>
            {(farm.houses || []).map((house, hi) => (
              <div key={house.id ?? hi} style={{ flex: isMobile ? 'none' : '1 1 0', width: isMobile ? '100%' : undefined, minWidth: isMobile ? 0 : 220 }}>
                <HouseCard
                  house={house}
                  onSelectDevice={onSelectDevice}
                  C={C} dark={dark}
                  accentColor={FARM_COLORS[fi % FARM_COLORS.length]}
                  isMobile={isMobile}
                />
              </div>
            ))}
          </div>
        </div>
      ))}

      {!loading && !error && farms.length === 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '80px 0', gap: 14, color: C.textDim }}>
          <WifiOff size={28} strokeWidth={1.4} />
          <div style={{ fontSize: 12 }}>Aucune ferme disponible.</div>
        </div>
      )}
    </div>
  )
}
