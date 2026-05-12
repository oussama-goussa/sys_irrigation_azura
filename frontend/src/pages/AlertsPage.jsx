// ============================================================
// frontend/src/pages/AlertsPage.jsx
// Page Alertes — toutes les alertes + mini toasts footer right
// Projet Azura Irrigation IA — GOUSSA Oussama
// ============================================================

import { useState, useEffect, useRef, useCallback, createContext, useContext } from 'react'
import { createPortal } from 'react-dom'
import {
  Bell, BellOff, AlertTriangle, AlertCircle, CheckCircle2,
  X, RefreshCw, Filter, ChevronDown, ChevronUp,
  Droplets, Thermometer, Activity, Wind, Gauge,
  Check, Eye, EyeOff, Wifi, WifiOff, Clock,
  CircleSlash, Zap, FlaskConical, Sun,  // ← ajouter Sun
} from 'lucide-react'
import { useWindowWidth } from '../components/DashboardShell.jsx'

// ── Toast context — exporté pour usage global ─────────────────
export const ToastContext = createContext(null)
export function useToasts() { return useContext(ToastContext) }

// ── Helpers ───────────────────────────────────────────────────
async function fetchAlerts(token, deviceId = null, resolved = false, limit = 200) {
  const BASE = ''
  const auth = JSON.parse(sessionStorage.getItem('azura_auth') || '{}')
  const tok = token || auth.access_token
  if (!tok) return []

  try {
    if (deviceId) {
      const res = await fetch(
        `${BASE}/api/devices/${deviceId}/alerts?resolved=${resolved}&limit=${limit}`,
        { headers: { Authorization: `Bearer ${tok}` } }
      )
      if (!res.ok) return []
      return res.json()
    }
    // Pas d'endpoint global → on récupère depuis le dashboard
    const dashRes = await fetch(`${BASE}/api/devices/dashboard`, {
      headers: { Authorization: `Bearer ${tok}` }
    })
    if (!dashRes.ok) return []
    const dash = await dashRes.json()
    const farms = dash.farms || []
    const allAlerts = []
    for (const farm of farms) {
      for (const house of (farm.houses || [])) {
        const r = await fetch(
          `${BASE}/api/devices/${house.id}/alerts?resolved=${resolved}&limit=50`,
          { headers: { Authorization: `Bearer ${tok}` } }
        )
        if (r.ok) {
          const arr = await r.json()
          arr.forEach(a => { a._farm_name = farm.farm_name; a._house_number = house.house_number })
          allAlerts.push(...arr)
        }
      }
    }
    return allAlerts.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
  } catch { return [] }
}

async function resolveAlert(token, alertId, deviceId) {
  // Note: si l'API n'a pas de route PATCH, on fait un fallback silencieux
  try {
    const res = await fetch(`/api/devices/${deviceId}/alerts/${alertId}/resolve`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}` }
    })
    return res.ok
  } catch { return false }
}

function fmtTs(ts) {
  if (!ts) return '—'
  return new Date(ts).toLocaleString('fr-FR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

function timeSince(ts) {
  if (!ts) return '—'
  const diff = Date.now() - new Date(ts).getTime()
  const m = Math.floor(diff / 60000)
  if (m < 1) return "à l'instant"
  if (m < 60) return `il y a ${m} min`
  if (m < 1440) return `il y a ${Math.floor(m / 60)}h`
  return `il y a ${Math.floor(m / 1440)}j`
}

// ── Alert type config ─────────────────────────────────────────
const ALERT_CONFIG = {
  EC_ACTUAL:  { label: 'EC Apport',     icon: Droplets,     color: '#34d96f', unit: 'mS/cm' },
  PH_ACTUAL:  { label: 'pH Apport',     icon: FlaskConical, color: '#4d9de0', unit: '' },
  AVG_TEMP:   { label: 'Température',   icon: Thermometer,  color: '#f5a623', unit: '°C' },
  HUMIDITY:   { label: 'Humidité',      icon: Activity,     color: '#b197fc', unit: '%' },
  FLOW:       { label: 'Débit',         icon: Gauge,        color: '#ff48bf', unit: 'L/h' },
  WIND_SPEED: { label: 'Vent',          icon: Wind,         color: '#576c58', unit: 'm/s' },
  ALARM:      { label: 'Alarme Netafim',icon: AlertTriangle,color: '#f05252', unit: '' },
  OFFLINE:    { label: 'Hors ligne',    icon: WifiOff,      color: '#f05252', unit: 'min' },  // ← déjà là
  VPD:        { label: 'Stress hydrique (VPD)', icon: Wind, color: '#f5a623', unit: 'kPa' },  // ← AJOUTER
  RADIATION:  { label: 'Radiation excessive',   icon: Sun,  color: '#f5e642', unit: 'W/m²' }, // ← AJOUTER
}

const SEVERITY_CONFIG = {
  CRITICAL: { label: 'Critique', color: '#f05252', bg: 'rgba(240,82,82,0.10)', border: 'rgba(240,82,82,0.30)' },
  WARNING:  { label: 'Attention', color: '#f5a623', bg: 'rgba(245,166,35,0.10)', border: 'rgba(245,166,35,0.30)' },
  INFO:     { label: 'Info',     color: '#4d9de0', bg: 'rgba(77,157,224,0.10)', border: 'rgba(77,157,224,0.30)' },
}

function getAlertCfg(type) {
  return ALERT_CONFIG[type?.toUpperCase()] || { label: type || 'Inconnu', icon: AlertCircle, color: '#f05252', unit: '' }
}
function getSevCfg(severity) {
  return SEVERITY_CONFIG[severity?.toUpperCase()] || SEVERITY_CONFIG.WARNING
}

// ─────────────────────────────────────────────────────────────
// TOAST PROVIDER — à envelopper dans App
// ─────────────────────────────────────────────────────────────
export function ToastProvider({ children, dark }) {
  const [toasts, setToasts] = useState([])
  const C = { green: '#34d96f', red: '#f05252', amber: '#f5a623', blue: '#4d9de0', text: dark ? '#ecf4ee' : '#0d1f14', card: dark ? '#142018' : '#ffffff', border: dark ? '#1c3122' : '#e0ece5' }

  const addToast = useCallback((toast) => {
    const id = Date.now() + Math.random()
    setToasts(prev => [{ ...toast, id, createdAt: Date.now() }, ...prev].slice(0, 5))
    // Auto-dismiss
    const duration = toast.duration || (toast.severity === 'CRITICAL' ? 8000 : 5000)
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id))
    }, duration)
    return id
  }, [])

  const removeToast = useCallback((id) => {
    setToasts(prev => prev.filter(t => t.id !== id))
  }, [])

  const clearAll = useCallback(() => setToasts([]), [])

  return (
    <ToastContext.Provider value={{ addToast, removeToast, clearAll, toasts }}>
      {children}
      {createPortal(
        <ToastContainer toasts={toasts} onRemove={removeToast} C={C} dark={dark} />,
        document.body
      )}
    </ToastContext.Provider>
  )
}

// ── Toast Container (footer right) ───────────────────────────
function ToastContainer({ toasts, onRemove, C, dark }) {
  if (toasts.length === 0) return null

  return (
    <div style={{
      position: 'fixed',
      bottom: 24, right: 24,
      zIndex: 99999,
      display: 'flex', flexDirection: 'column-reverse', gap: 10,
      maxWidth: 360, width: 'calc(100vw - 48px)',
      pointerEvents: 'none',
    }}>
      {toasts.map((toast) => (
        <ToastItem key={toast.id} toast={toast} onRemove={onRemove} C={C} dark={dark} />
      ))}
    </div>
  )
}

function ToastItem({ toast, onRemove, C, dark }) {
  const [visible, setVisible] = useState(false)
  const sev = getSevCfg(toast.severity)
  const cfg = getAlertCfg(toast.alert_type)
  const Icon = cfg.icon

  useEffect(() => {
    requestAnimationFrame(() => setVisible(true))
  }, [])

  const handleClose = () => {
    setVisible(false)
    setTimeout(() => onRemove(toast.id), 300)
  }

  return (
    <div
      style={{
        pointerEvents: 'auto',
        background: dark ? '#0f1a12' : '#fff',
        border: `1.5px solid ${sev.border}`,
        borderLeft: `4px solid ${sev.color}`,
        borderRadius: 12,
        padding: '12px 14px',
        boxShadow: `0 8px 32px rgba(0,0,0,${dark ? 0.5 : 0.12})`,
        display: 'flex', alignItems: 'flex-start', gap: 10,
        opacity: visible ? 1 : 0,
        transform: visible ? 'translateX(0)' : 'translateX(24px)',
        transition: 'opacity 0.3s ease, transform 0.3s ease',
        cursor: 'pointer',
        position: 'relative',
        overflow: 'hidden',
      }}
      onClick={handleClose}
    >
      {/* Progress bar */}
      <div style={{
        position: 'absolute', bottom: 0, left: 0, right: 0, height: 2,
        background: `${sev.color}20`,
      }}>
        <div style={{
          height: '100%', background: sev.color,
          animation: `toast-shrink ${(toast.duration || (toast.severity === 'CRITICAL' ? 8000 : 5000))}ms linear forwards`,
        }} />
      </div>

      {/* Icon */}
      <div style={{
        width: 32, height: 32, borderRadius: 8, flexShrink: 0,
        background: `${cfg.color}18`,
        border: `1px solid ${cfg.color}35`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <Icon size={14} color={cfg.color} strokeWidth={2} />
      </div>

      {/* Content */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
          <span style={{
            fontSize: 10, fontWeight: 700, color: sev.color,
            background: sev.bg, border: `1px solid ${sev.border}`,
            borderRadius: 4, padding: '1px 6px',
            textTransform: 'uppercase', letterSpacing: '0.06em',
          }}>
            {sev.label}
          </span>
          <span style={{ fontSize: 10, color: dark ? '#3d6b4e' : '#9cb8a6' }}>
            {toast._farm_name} · H{toast._house_number}
          </span>
        </div>
        <div style={{ fontSize: 12, fontWeight: 700, color: dark ? '#ecf4ee' : '#0d1f14', marginBottom: 2 }}>
          {cfg.label} — {toast.alert_type?.toUpperCase()}
        </div>
        {toast.value_detected != null && (
          <div style={{ fontSize: 11, color: dark ? '#6fa882' : '#3a6b4a' }}>
            Valeur : <strong style={{ color: sev.color }}>{toast.value_detected} {cfg.unit}</strong>
            {toast.threshold_min != null && ` (min: ${toast.threshold_min})`}
            {toast.threshold_max != null && ` (max: ${toast.threshold_max})`}
          </div>
        )}
        {toast.message && (
          <div style={{ fontSize: 11, color: dark ? '#6fa882' : '#3a6b4a', marginTop: 2,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {toast.message}
          </div>
        )}
      </div>

      {/* Close */}
      <button
        onClick={e => { e.stopPropagation(); handleClose() }}
        style={{ background: 'none', border: 'none', cursor: 'pointer',
          color: dark ? '#3d6b4e' : '#9cb8a6', padding: 2, flexShrink: 0 }}
      >
        <X size={12} strokeWidth={2} />
      </button>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────
// ALERT BELL BADGE — dans la topbar/sidebar
// ─────────────────────────────────────────────────────────────
export function AlertBell({ token, C, dark, onClick }) {
  const [count, setCount] = useState(0)
  const [pulse, setPulse] = useState(false)
  const prevCount = useRef(0)

  useEffect(() => {
    const load = async () => {
      const alerts = await fetchAlerts(token, null, false, 50)
      const critical = alerts.filter(a => a.severity === 'CRITICAL' || a.severity === 'WARNING').length
      if (critical > prevCount.current) setPulse(true)
      prevCount.current = critical
      setCount(critical)
    }
    load()
    const iv = setInterval(load, 30000)
    return () => clearInterval(iv)
  }, [token])

  useEffect(() => {
    if (pulse) setTimeout(() => setPulse(false), 1000)
  }, [pulse])

  return (
    <button
      onClick={onClick}
      title={`${count} alerte${count > 1 ? 's' : ''} active${count > 1 ? 's' : ''}`}
      style={{
        position: 'relative',
        background: count > 0 ? `${C.red}12` : 'transparent',
        border: `1px solid ${count > 0 ? C.red + '40' : C.border}`,
        borderRadius: 8, padding: '7px 10px',
        cursor: 'pointer', color: count > 0 ? C.red : C.textMuted,
        display: 'flex', alignItems: 'center',
        transition: 'all 0.2s',
        animation: pulse ? 'az-pulse 0.6s ease' : 'none',
      }}
    >
      {count > 0 ? <Bell size={14} strokeWidth={2} /> : <BellOff size={14} strokeWidth={2} />}
      {count > 0 && (
        <span style={{
          position: 'absolute', top: -4, right: -4,
          minWidth: 16, height: 16, borderRadius: 8,
          background: C.red, color: '#fff',
          fontSize: 9, fontWeight: 800,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          padding: '0 3px',
          boxShadow: `0 0 6px ${C.red}60`,
          animation: pulse ? 'ripple 0.6s ease' : 'none',
        }}>
          {count > 99 ? '99+' : count}
        </span>
      )}
    </button>
  )
}

// ─────────────────────────────────────────────────────────────
// ALERTS PAGE — page complète
// ─────────────────────────────────────────────────────────────
export default function AlertsPage({ token, auth, C, dark }) {
  const width = useWindowWidth()
  const isMobile = width < 640
  const isTablet = width >= 640 && width < 900

  const [alerts, setAlerts] = useState([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [showResolved, setShowResolved] = useState(false)
  const [filterSeverity, setFilterSeverity] = useState('all')
  const [filterType, setFilterType] = useState('all')
  const [filterFarm, setFilterFarm] = useState('all')
  const [expandedId, setExpandedId] = useState(null)
  const toasts = useToasts()

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true)
    else setRefreshing(true)
    const data = await fetchAlerts(token, null, showResolved)
    setAlerts(data)
    setLoading(false)
    setRefreshing(false)
  }, [token, showResolved])

  useEffect(() => { load() }, [load])

  // Auto-refresh + toast pour nouvelles alertes critiques
  useEffect(() => {
    const iv = setInterval(async () => {
      const fresh = await fetchAlerts(token, null, false, 50)
      setAlerts(prev => {
        const prevIds = new Set(prev.map(a => a.id))
        const newOnes = fresh.filter(a => !prevIds.has(a.id))
        if (newOnes.length > 0 && toasts?.addToast) {
          newOnes.slice(0, 3).forEach(a => toasts.addToast(a))
        }
        return fresh
      })
    }, 30000)
    return () => clearInterval(iv)
  }, [token])

  const handleResolve = async (alert) => {
    await resolveAlert(token, alert.id, alert.device_id)
    setAlerts(prev => prev.filter(a => a.id !== alert.id))
  }

  // Stats
  const stats = {
    total:    alerts.length,
    critical: alerts.filter(a => a.severity === 'CRITICAL').length,
    warning:  alerts.filter(a => a.severity === 'WARNING').length,
    info:     alerts.filter(a => !['CRITICAL','WARNING'].includes(a.severity)).length,
  }

  // Farms for filter
  const farms = [...new Set(alerts.map(a => a._farm_name).filter(Boolean))]
  const types = [...new Set(alerts.map(a => a.alert_type).filter(Boolean))]

  // Filtered
  const filtered = alerts.filter(a => {
    if (filterSeverity !== 'all' && a.severity?.toUpperCase() !== filterSeverity) return false
    if (filterType !== 'all' && a.alert_type?.toUpperCase() !== filterType.toUpperCase()) return false
    if (filterFarm !== 'all' && a._farm_name !== filterFarm) return false
    return true
  })

  const hasFilters = filterSeverity !== 'all' || filterType !== 'all' || filterFarm !== 'all'

  return (
    <div style={{ animation: 'az-fade-up 0.3s ease both' }}>
      {/* CSS keyframes for toast progress */}
      <style>{`
        @keyframes toast-shrink { from { width: 100%; } to { width: 0%; } }
        @keyframes az-slide-in { from { opacity:0; transform:translateX(20px); } to { opacity:1; transform:translateX(0); } }
      `}</style>

      {/* ── Header ──────────────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: isMobile ? 'flex-start' : 'center',
        flexDirection: isMobile ? 'column' : 'row',
        justifyContent: 'space-between', marginBottom: 24, gap: 12 }}>
        <div>
          <h1 style={{ fontSize: isMobile ? 18 : 22, fontWeight: 900, color: C.text,
            marginBottom: 4, display: 'flex', alignItems: 'center', gap: 10 }}>
            <Bell size={isMobile ? 18 : 22} color={stats.critical > 0 ? C.red : C.green} strokeWidth={2} />
            Alertes
            {stats.critical > 0 && (
              <span style={{
                background: C.red, color: '#fff',
                borderRadius: 20, padding: '2px 10px',
                fontSize: 12, fontWeight: 800,
              }}>{stats.critical}</span>
            )}
          </h1>
          <p style={{ fontSize: 11, color: C.textDim }}>
            Surveillance temps réel — {stats.total} alerte{stats.total > 1 ? 's' : ''} active{stats.total > 1 ? 's' : ''}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button
            onClick={() => setShowResolved(v => !v)}
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '7px 14px', borderRadius: 8,
              border: `1.5px solid ${showResolved ? C.green + '60' : C.border}`,
              background: showResolved ? `${C.green}12` : C.toggleBg,
              color: showResolved ? C.green : C.textMuted,
              fontSize: 12, fontWeight: 630, fontFamily: 'inherit', cursor: 'pointer',
            }}
          >
            {showResolved ? <Eye size={12} strokeWidth={2} /> : <EyeOff size={12} strokeWidth={2} />}
            {!isMobile && (showResolved ? 'Masquer résolues' : 'Voir résolues')}
          </button>
          <button
            onClick={() => load(true)} disabled={refreshing}
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '7px 14px', borderRadius: 8,
              border: `1px solid ${dark ? '#1c2e22' : '#c0d8c8'}`,
              background: C.toggleBg, color: C.textMuted,
              fontSize: 12, fontWeight: 630, fontFamily: 'inherit', cursor: 'pointer',
            }}
          >
            <RefreshCw size={12} strokeWidth={2}
              style={{ animation: refreshing ? 'az-spin 0.7s linear infinite' : 'none' }} />
            {!isMobile && 'Actualiser'}
          </button>
        </div>
      </div>

      {/* ── Stats cards ──────────────────────────────────────── */}
      <div style={{ display: 'grid', gap: 12,
        gridTemplateColumns: isMobile ? '1fr 1fr' : 'repeat(4, 1fr)', marginBottom: 20 }}>
        {[
          { label: 'Total', value: stats.total, color: C.textMuted, icon: Bell, bg: C.toggleBg, border: C.border },
          { label: 'Critiques', value: stats.critical, color: C.red, icon: AlertCircle, bg: `${C.red}10`, border: `${C.red}30` },
          { label: 'Attention', value: stats.warning, color: C.amber, icon: AlertTriangle, bg: `${C.amber}10`, border: `${C.amber}30` },
          { label: 'Info', value: stats.info, color: C.blue, icon: Activity, bg: `${C.blue}10`, border: `${C.blue}30` },
        ].map(s => {
          const Icon = s.icon
          return (
            <div key={s.label} style={{
              background: dark ? '#111a14' : s.bg,
              border: `1.5px solid ${s.border}`,
              borderRadius: 14, padding: isMobile ? '14px 16px' : '18px 22px',
              display: 'flex', flexDirection: 'column', gap: 8,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: 10, fontWeight: 630, color: dark ? C.textDim : '#5a7a66',
                  textTransform: 'uppercase', letterSpacing: '0.10em' }}>{s.label}</span>
                <Icon size={16} strokeWidth={1.8} color={s.color} style={{ opacity: 0.7 }} />
              </div>
              <div style={{ fontSize: isMobile ? 28 : 36, fontWeight: 800, color: s.color, lineHeight: 1 }}>
                {s.value}
              </div>
            </div>
          )
        })}
      </div>

      {/* ── Filtres ──────────────────────────────────────────── */}
      <div style={{
        display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center',
      }}>
        {/* Sévérité */}
        <div style={{ display: 'flex', gap: 5 }}>
          {[
            { value: 'all', label: 'Toutes' },
            { value: 'CRITICAL', label: 'Critique' },
            { value: 'WARNING', label: 'Attention' },
          ].map(f => (
            <button key={f.value} onClick={() => setFilterSeverity(f.value)}
              style={{
                padding: '5px 12px', borderRadius: 7, fontSize: 12, fontWeight: 630,
                cursor: 'pointer', fontFamily: 'inherit',
                background: filterSeverity === f.value ? C.green : C.toggleBg,
                color: filterSeverity === f.value ? '#fff' : C.textMuted,
                border: `1.5px solid ${filterSeverity === f.value ? C.green : C.border}`,
                transition: 'all 0.15s',
              }}>
              {f.label}
            </button>
          ))}
        </div>

        {/* Type d'alerte */}
        <FilterDropdown
          value={filterType} onChange={setFilterType}
          options={[{ value: 'all', label: 'Tous types' }, ...types.map(t => ({
            value: t, label: getAlertCfg(t).label
          }))]}
          C={C}
        />

        {/* Ferme */}
        {farms.length > 1 && (
          <FilterDropdown
            value={filterFarm} onChange={setFilterFarm}
            options={[{ value: 'all', label: 'Toutes fermes' }, ...farms.map(f => ({ value: f, label: f }))]}
            C={C}
          />
        )}

        {hasFilters && (
          <button
            onClick={() => { setFilterSeverity('all'); setFilterType('all'); setFilterFarm('all') }}
            style={{
              display: 'flex', alignItems: 'center', gap: 5,
              padding: '5px 10px', borderRadius: 7,
              border: `1.5px solid ${C.red}35`, background: `${C.red}10`,
              color: C.red, fontSize: 12, fontWeight: 630,
              fontFamily: 'inherit', cursor: 'pointer',
            }}>
            <X size={11} strokeWidth={2.5} /> Réinitialiser
          </button>
        )}

        <span style={{ marginLeft: 'auto', fontSize: 11, color: C.textDim }}>
          {filtered.length} résultat{filtered.length > 1 ? 's' : ''}
        </span>
      </div>

      {/* ── Liste des alertes ─────────────────────────────────── */}
      {loading ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: '60px 0',
          color: C.textDim, fontSize: 12, gap: 10 }}>
          <RefreshCw size={16} style={{ animation: 'az-spin 0.7s linear infinite' }} />
          Chargement des alertes…
        </div>
      ) : filtered.length === 0 ? (
        <div style={{
          textAlign: 'center', padding: '80px 0',
          background: C.card, border: `1.5px solid ${C.border}`,
          borderRadius: 14,
        }}>
          <CheckCircle2 size={40} color={C.green} strokeWidth={1.2}
            style={{ display: 'block', margin: '0 auto 12px' }} />
          <div style={{ color: C.text, fontSize: 14, fontWeight: 700, marginBottom: 6 }}>
            Aucune alerte active
          </div>
          <div style={{ color: C.textDim, fontSize: 12 }}>
            {hasFilters ? 'Aucun résultat pour ces filtres' : 'Tous les systèmes fonctionnent normalement'}
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {filtered.map((alert, i) => (
            <AlertCard
              key={alert.id || i}
              alert={alert}
              expanded={expandedId === (alert.id || i)}
              onToggle={() => setExpandedId(expandedId === (alert.id || i) ? null : (alert.id || i))}
              onResolve={() => handleResolve(alert)}
              C={C} dark={dark} isMobile={isMobile}
            />
          ))}
        </div>
      )}
    </div>
  )
}

// ── Alert Card ────────────────────────────────────────────────
function AlertCard({ alert, expanded, onToggle, onResolve, C, dark, isMobile }) {
  const cfg = getAlertCfg(alert.alert_type)
  const sev = getSevCfg(alert.severity)
  const Icon = cfg.icon
  const isResolved = !!alert.resolved_at

  return (
    <div style={{
      background: C.card,
      border: `1.5px solid ${isResolved ? C.border : sev.border}`,
      borderLeft: `4px solid ${isResolved ? C.textDim : sev.color}`,
      borderRadius: 12,
      overflow: 'hidden',
      opacity: isResolved ? 0.6 : 1,
      transition: 'all 0.2s',
    }}>
      {/* Main row */}
      <div
        onClick={onToggle}
        style={{
          display: 'flex', alignItems: 'center', gap: 12,
          padding: isMobile ? '12px 14px' : '14px 18px',
          cursor: 'pointer',
        }}
        onMouseEnter={e => e.currentTarget.style.background = C.tableHover}
        onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
      >
        {/* Icon */}
        <div style={{
          width: 38, height: 38, borderRadius: 9, flexShrink: 0,
          background: `${cfg.color}15`,
          border: `1.5px solid ${cfg.color}30`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <Icon size={16} color={cfg.color} strokeWidth={2} />
        </div>

        {/* Content */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexWrap: 'wrap', marginBottom: 3 }}>
            <span style={{
              fontSize: 10, fontWeight: 700, color: sev.color,
              background: sev.bg, border: `1px solid ${sev.border}`,
              borderRadius: 4, padding: '1px 7px',
              textTransform: 'uppercase', letterSpacing: '0.06em',
            }}>
              {sev.label}
            </span>
            <span style={{ fontSize: 12, fontWeight: 700, color: C.text }}>
              {cfg.label}
            </span>
            {alert._farm_name && (
              <span style={{ fontSize: 11, color: C.textMuted }}>
                {alert._farm_name} · Station {alert._house_number}
              </span>
            )}
            {isResolved && (
              <span style={{
                fontSize: 10, color: C.green,
                background: `${C.green}12`, border: `1px solid ${C.green}30`,
                borderRadius: 4, padding: '1px 7px', fontWeight: 630,
              }}>Résolue</span>
            )}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
            {alert.value_detected != null && (
              <span style={{ fontSize: 12, color: C.textMuted }}>
                Valeur : <strong style={{ color: sev.color }}>{Number(alert.value_detected).toFixed(2)} {cfg.unit}</strong>
                {alert.threshold_min != null && (
                  <span style={{ color: C.textDim }}> (min: {alert.threshold_min})</span>
                )}
                {alert.threshold_max != null && (
                  <span style={{ color: C.textDim }}> (max: {alert.threshold_max})</span>
                )}
              </span>
            )}
            <span style={{ fontSize: 11, color: C.textDim, display: 'flex', alignItems: 'center', gap: 4 }}>
              <Clock size={10} strokeWidth={2} />
              {timeSince(alert.timestamp)}
            </span>
          </div>
        </div>

        {/* Actions */}
        <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
          {!isResolved && (
            <button
              onClick={e => { e.stopPropagation(); onResolve() }}
              title="Marquer comme résolue"
              style={{
                display: 'flex', alignItems: 'center', gap: 5,
                padding: '5px 10px', borderRadius: 7,
                border: `1.5px solid ${C.green}40`,
                background: `${C.green}10`,
                color: C.green, fontSize: 11, fontWeight: 630,
                fontFamily: 'inherit', cursor: 'pointer',
                transition: 'all 0.15s',
              }}
              onMouseEnter={e => { e.currentTarget.style.background = `${C.green}20` }}
              onMouseLeave={e => { e.currentTarget.style.background = `${C.green}10` }}
            >
              <Check size={11} strokeWidth={2.5} />
              {!isMobile && 'Résoudre'}
            </button>
          )}
          <div style={{ color: C.textDim, display: 'flex', alignItems: 'center' }}>
            {expanded ? <ChevronUp size={14} strokeWidth={2} /> : <ChevronDown size={14} strokeWidth={2} />}
          </div>
        </div>
      </div>

      {/* Expanded detail */}
      {expanded && (
        <div style={{
          borderTop: `1px solid ${C.border}`,
          padding: isMobile ? '12px 14px' : '14px 18px',
          background: dark ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.02)',
          animation: 'az-fade-up 0.2s ease',
        }}>
          <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(2, 1fr)', gap: 10 }}>
            {[
              { label: 'Type d\'alerte', value: alert.alert_type },
              { label: 'Sévérité', value: sev.label, color: sev.color },
              { label: 'Valeur détectée', value: alert.value_detected != null ? `${Number(alert.value_detected).toFixed(2)} ${cfg.unit}` : '—', color: sev.color },
              { label: 'Seuil min', value: alert.threshold_min != null ? `${alert.threshold_min} ${cfg.unit}` : '—' },
              { label: 'Seuil max', value: alert.threshold_max != null ? `${alert.threshold_max} ${cfg.unit}` : '—' },
              { label: 'Détectée le', value: fmtTs(alert.timestamp) },
              { label: 'Ferme', value: alert._farm_name || '—' },
              { label: 'Station', value: alert._house_number ? `Station ${alert._house_number}` : '—' },
            ].map(item => (
              <div key={item.label} style={{
                background: C.surface, border: `1px solid ${C.border}`,
                borderRadius: 8, padding: '9px 12px',
              }}>
                <div style={{ fontSize: 10, color: C.textDim, textTransform: 'uppercase',
                  letterSpacing: '0.07em', marginBottom: 4 }}>{item.label}</div>
                <div style={{ fontSize: 13, fontWeight: 700, color: item.color || C.text }}>
                  {item.value}
                </div>
              </div>
            ))}
          </div>

          {alert.message && (
            <div style={{
              marginTop: 10, padding: '10px 14px',
              background: `${sev.color}08`, border: `1px solid ${sev.border}`,
              borderRadius: 8, fontSize: 12, color: C.textMuted, lineHeight: 1.6,
            }}>
              {alert.message}
            </div>
          )}

          {alert.resolved_at && (
            <div style={{
              marginTop: 10, display: 'flex', alignItems: 'center', gap: 6,
              fontSize: 11, color: C.green,
            }}>
              <CheckCircle2 size={12} strokeWidth={2} />
              Résolue le {fmtTs(alert.resolved_at)}
              {alert.resolved_by && ` par ${alert.resolved_by}`}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── Filter Dropdown ───────────────────────────────────────────
function FilterDropdown({ value, onChange, options, C }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)

  useEffect(() => {
    const close = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [])

  const selected = options.find(o => o.value === value)

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen(v => !v)}
        style={{
          display: 'flex', alignItems: 'center', gap: 6,
          padding: '5px 12px', borderRadius: 7,
          border: `1.5px solid ${value !== 'all' ? C.green + '60' : C.border}`,
          background: value !== 'all' ? `${C.green}10` : C.toggleBg,
          color: value !== 'all' ? C.green : C.textMuted,
          fontSize: 12, fontWeight: 630, fontFamily: 'inherit', cursor: 'pointer',
        }}
      >
        <Filter size={11} strokeWidth={2} />
        {selected?.label || 'Filtrer'}
        {open ? <ChevronUp size={11} strokeWidth={2} /> : <ChevronDown size={11} strokeWidth={2} />}
      </button>
      {open && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 4px)', left: 0, minWidth: 160,
          background: C.card, border: `1.5px solid ${C.border}`,
          borderRadius: 8, zIndex: 100, boxShadow: `0 4px 20px rgba(0,0,0,0.15)`,
          overflow: 'hidden',
        }}>
          {options.map(o => (
            <div key={o.value}
              onClick={() => { onChange(o.value); setOpen(false) }}
              style={{
                padding: '9px 14px', fontSize: 12, cursor: 'pointer',
                color: o.value === value ? C.green : C.textMuted,
                background: o.value === value ? `${C.green}12` : 'transparent',
                transition: 'background 0.1s',
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              }}
              onMouseEnter={e => e.currentTarget.style.background = o.value === value ? `${C.green}18` : C.tableHover}
              onMouseLeave={e => e.currentTarget.style.background = o.value === value ? `${C.green}12` : 'transparent'}
            >
              {o.label}
              {o.value === value && <Check size={11} strokeWidth={2.5} color={C.green} />}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────
// ALERT WATCHER — Background component (utilise les toasts)
// Monté une seule fois dans DashboardShell
// ─────────────────────────────────────────────────────────────
export function AlertWatcher({ token }) {
  const toasts = useToasts()
  const seenIds = useRef(new Set())
  const isFirst = useRef(true)

  useEffect(() => {
    const check = async () => {
      const alerts = await fetchAlerts(token, null, false, 30)
      if (isFirst.current) {
        // Premier chargement : marquer toutes comme vues (pas de toast au boot)
        alerts.forEach(a => seenIds.current.add(a.id))
        isFirst.current = false
        return
      }
      // Nouvelles alertes critiques uniquement
      const newCritical = alerts.filter(
        a => !seenIds.current.has(a.id) && a.severity === 'CRITICAL'
      )
      newCritical.forEach(a => {
        seenIds.current.add(a.id)
        toasts?.addToast(a)
      })
    }
    check()
    const iv = setInterval(check, 30000)
    return () => clearInterval(iv)
  }, [token])

  return null
}