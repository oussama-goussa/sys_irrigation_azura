// ============================================================
// frontend/src/pages/AgentIAPage.jsx
// Agent IA — AZ106 uniquement · Design épuré & professionnel
// ============================================================

import { useState, useEffect, useRef, useCallback } from 'react'
import {
  Brain, RefreshCw, Settings, Scale,
  Sun, Pause, StopCircle, TrendingUp, TrendingDown,
  AlertTriangle, CheckCircle2, Clock,
  FlaskConical, Leaf, Info,
  Activity, Save, X, Zap,
} from 'lucide-react'
import { getColors } from '../theme.js'
import { useWindowWidth } from '../components/DashboardShell.jsx'

// ─── Constantes ──────────────────────────────────────────────
const AZ106_FARM = 'AZ106'
const PRT_SEUILS = {
  froid:      { min: 10.0, max: 12.0 },
  chaud:      { min:  8.0, max:  9.0 },
  transition: { min:  9.0, max: 10.5 },
}

function getPeriode(mois) {
  if ([11,12,1,2].includes(mois)) return 'froid'
  if ([4,5,6,7].includes(mois)) return 'chaud'
  return 'transition'
}

// ── API helpers ───────────────────────────────────────────────
async function fetchWithToken(url, token, opts = {}) {
  const res = await fetch(url, {
    ...opts,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(opts.headers || {}),
    },
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.detail || `Erreur ${res.status}`)
  }
  return res.json()
}

async function getPoidsSOir(token, deviceId) {
  return fetchWithToken(`/api/ai/poids-soir/${deviceId}`, token)
}
async function getDevices(token) {
  return fetchWithToken('/api/devices', token)
}
async function getAIRec(token, deviceId, date) {
  const params = date ? `?date=${date}` : ''
  return fetchWithToken(`/api/ai/recommandation/${deviceId}${params}`, token)
}
async function getAIConfig(token, deviceId) {
  return fetchWithToken(`/api/ai/config/${deviceId}`, token)
}
async function saveAIConfig(token, deviceId, payload) {
  return fetchWithToken(`/api/ai/config/${deviceId}`, token, {
    method: 'PUT', body: JSON.stringify(payload),
  })
}
async function getDeviceTours(token, deviceId, date) {
  return fetchWithToken(`/api/devices/${deviceId}/tours?date=${date}`, token)
}
async function getLatestWeight(token, farmName) {
  return fetchWithToken(`/api/weight/${farmName}/latest`, token)
}
async function getDeviceLatest(token, deviceId) {
  return fetchWithToken(`/api/devices/${deviceId}/latest`, token)
}

// ── Calcul PRT ────────────────────────────────────────────────
function calculerPRT(poidsSoir, poidsMatin) {
  if (!poidsSoir || !poidsMatin || poidsSoir <= 0) return null
  return ((poidsSoir - poidsMatin) / poidsSoir) * 100
}

function getPRTStatus(prt, mois) {
  if (prt === null) return null
  const periode = getPeriode(mois)
  const s = PRT_SEUILS[periode]
  if (prt < s.min) return { ok: false, msg: `${prt.toFixed(1)}% — en dessous du seuil (${s.min}%)`, color: '#f5a623' }
  if (prt > s.max) return { ok: false, msg: `${prt.toFixed(1)}% — au-dessus du seuil (${s.max}%)`, color: '#4d9de0' }
  return { ok: true, msg: `${prt.toFixed(1)}% — dans la plage cible`, color: '#34d96f' }
}

// ── Statut map ────────────────────────────────────────────────
const STATUT_MAP = {
  en_cours      : { label: 'En cours',     color: '#4d9de0' },
  optimal       : { label: 'Optimal',      color: '#34d96f' },
  a_ajuster     : { label: 'À surveiller', color: '#f5a623' },
  arrete        : { label: 'Arrêté',       color: '#e55' },
  pluie         : { label: 'Pluie',        color: '#4d9de0' },
  non_disponible: { label: '—',            color: '#888' },
}

const ACTION_COLORS = {
  CONTINUER         : { color: '#34d96f', icon: CheckCircle2 },
  PRUDENCE          : { color: '#f5a623', icon: AlertTriangle },
  AUGMENTATION_REPOS: { color: '#f5a623', icon: Pause },
  PROLONGER         : { color: '#4d9de0', icon: TrendingUp },
  ARRET_URGENT      : { color: '#e55',    icon: StopCircle },
}

// ─────────────────────────────────────────────────────────────
// COMPOSANTS
// ─────────────────────────────────────────────────────────────

// Ligne de données simple
function DataRow({ label, value, unit, accent, C }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'baseline',
      justifyContent: 'space-between',
      padding: '9px 0',
      borderBottom: `1px solid ${C.border}`,
    }}>
      <span style={{ fontSize: 11, color: C.textDim, textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 600 }}>
        {label}
      </span>
      <span style={{ fontSize: 13, fontWeight: 700, color: accent || C.text }}>
        {value ?? '—'}
        {unit && <span style={{ fontSize: 11, fontWeight: 400, color: C.textDim, marginLeft: 4 }}>{unit}</span>}
      </span>
    </div>
  )
}

// Carte section
function Section({ title, icon: Icon, children, C, dark, action }) {
  return (
    <div style={{
      background: C.card,
      border: `1px solid ${C.border}`,
      borderRadius: 12,
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '13px 18px',
        borderBottom: `1px solid ${C.border}`,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {Icon && <Icon size={13} color={C.green} strokeWidth={2.5} />}
          <span style={{ fontSize: 11, fontWeight: 700, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
            {title}
          </span>
        </div>
        {action}
      </div>
      <div style={{ padding: '4px 18px 14px' }}>
        {children}
      </div>
    </div>
  )
}

// Badge statut inline
function StatusBadge({ label, color }) {
  return (
    <span style={{
      fontSize: 10, fontWeight: 700, color,
      background: `${color}14`,
      border: `1px solid ${color}30`,
      borderRadius: 4, padding: '2px 8px',
      letterSpacing: '0.04em', textTransform: 'uppercase',
    }}>
      {label}
    </span>
  )
}

// Barre de progression simple
function ProgressBar({ value, min, max, color, C }) {
  const pct = Math.min(100, Math.max(0, ((value - min) / (max - min)) * 100))
  return (
    <div style={{ height: 4, borderRadius: 2, background: C.border, overflow: 'hidden', position: 'relative' }}>
      <div style={{ height: '100%', width: `${pct}%`, background: color, borderRadius: 2, transition: 'width 0.5s ease' }} />
    </div>
  )
}

// Tableau des tours compact
function TourTable({ tours, C, dark }) {
  const valids = (tours || []).filter(t => t.debut !== null)
  if (valids.length === 0) return (
    <div style={{ padding: '24px 0', textAlign: 'center', color: C.textDim, fontSize: 12 }}>
      Aucun tour démarré aujourd'hui
    </div>
  )
  return (
    <div style={{ overflowX: 'auto', marginTop: 2 }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, fontFamily: 'inherit' }}>
        <thead>
          <tr>
            {['N°', 'Début', 'Fin', 'Durée', 'Rad. Sum', 'Cumul Rad.', 'EC Apport'].map(h => (
              <th key={h} style={{
                padding: '8px 10px', textAlign: 'center', color: C.textDim,
                fontWeight: 600, fontSize: 10, textTransform: 'uppercase',
                letterSpacing: '0.05em', borderBottom: `1px solid ${C.border}`,
              }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {valids.map((t, i) => (
            <tr key={i} style={{ borderBottom: i < valids.length - 1 ? `1px solid ${C.border}` : 'none' }}>
              <td style={{ padding: '8px 10px', textAlign: 'center' }}>
                <span style={{
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  width: 22, height: 22, borderRadius: 4,
                  background: `${C.green}15`, color: C.green,
                  fontSize: 11, fontWeight: 800,
                }}>{t.tour_num}</span>
              </td>
              <td style={{ padding: '8px 10px', textAlign: 'center', color: C.text, fontWeight: 600 }}>{t.debut || '—'}</td>
              <td style={{ padding: '8px 10px', textAlign: 'center', color: C.textMuted }}>{t.fin || '—'}</td>
              <td style={{ padding: '8px 10px', textAlign: 'center', color: C.text }}>{t.prg_time_min != null ? `${t.prg_time_min} min` : '—'}</td>
              <td style={{ padding: '8px 10px', textAlign: 'center', color: C.textMuted }}>{t.radiation_sum != null ? t.radiation_sum.toFixed(1) : '—'}</td>
              <td style={{ padding: '8px 10px', textAlign: 'center', color: C.textMuted }}>{t.cumul_radiation != null ? t.cumul_radiation.toFixed(1) : '—'}</td>
              <td style={{ padding: '8px 10px', textAlign: 'center', color: C.green, fontWeight: 700 }}>{t.ec_apport != null ? t.ec_apport.toFixed(2) : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// Ajustements
function AdjustmentList({ ajustements, C, dark }) {
  if (!ajustements || ajustements.length === 0) return (
    <div style={{ padding: '20px 0', textAlign: 'center', color: C.textDim, fontSize: 12 }}>
      Aucun ajustement — en attente du premier tour
    </div>
  )
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 4 }}>
      {[...ajustements].reverse().map((a, i) => {
        const cfg = ACTION_COLORS[a.action] || { color: C.textMuted, icon: Info }
        const AIcon = cfg.icon
        return (
          <div key={i} style={{
            display: 'flex', gap: 12, alignItems: 'flex-start',
            padding: '10px 12px', borderRadius: 8,
            background: dark ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.02)',
            border: `1px solid ${C.border}`,
          }}>
            <AIcon size={13} color={cfg.color} strokeWidth={2.5} style={{ marginTop: 1, flexShrink: 0 }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3 }}>
                <span style={{ fontSize: 11, fontWeight: 700, color: cfg.color }}>Tour {a.tour}</span>
                <StatusBadge label={a.action} color={cfg.color} />
                {a.drainage_reel != null && (
                  <span style={{ marginLeft: 'auto', fontSize: 11, color: C.textDim }}>
                    Drain {a.drainage_reel.toFixed(1)}%
                  </span>
                )}
              </div>
              <div style={{ fontSize: 11, color: C.textMuted, marginBottom: a.stop ? 0 : 4 }}>{a.raison}</div>
              {!a.stop && (
                <div style={{ fontSize: 11, color: C.textDim, display: 'flex', gap: 14 }}>
                  <span>Repos <strong style={{ color: C.text }}>{a.repos_suivant_min} min</strong></span>
                  <span>Durée <strong style={{ color: C.text }}>{a.duree_suivant_min} min</strong></span>
                </div>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}

// Modal Config
function ConfigModal({ deviceId, token, onClose, C, dark }) {
  const [cfg, setCfg] = useState(null)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({ date_plantation: '', actif: true })

  useEffect(() => {
    getAIConfig(token, deviceId).then(c => {
      setCfg(c)
      setForm({ date_plantation: c.date_plantation || '', actif: c.actif !== false })
    }).catch(() => {})
  }, [deviceId])

  const handleSave = async () => {
    setSaving(true)
    try {
      await saveAIConfig(token, deviceId, { date_plantation: form.date_plantation || null, actif: form.actif })
      onClose()
    } catch (e) { alert(e.message) }
    finally { setSaving(false) }
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 99999,
      background: 'rgba(0,0,0,0.6)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24,
    }}>
      <div style={{
        background: C.card, border: `1px solid ${C.border}`,
        borderRadius: 12, padding: '24px 28px', width: '100%', maxWidth: 400,
        boxShadow: '0 20px 60px rgba(0,0,0,0.4)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Settings size={14} color={C.green} strokeWidth={2} />
            <span style={{ fontSize: 13, fontWeight: 700, color: C.text }}>Configuration IA</span>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: C.textDim }}>
            <X size={15} strokeWidth={2} />
          </button>
        </div>

        {!cfg ? (
          <div style={{ textAlign: 'center', color: C.textDim, padding: 24, fontSize: 12 }}>Chargement…</div>
        ) : (
          <>
            <div style={{ marginBottom: 16 }}>
              <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>
                Date de plantation
              </label>
              <input type="date" value={form.date_plantation}
                onChange={e => setForm(p => ({ ...p, date_plantation: e.target.value }))}
                style={{
                  width: '100%', padding: '8px 12px', borderRadius: 7,
                  border: `1px solid ${C.border}`, background: C.inputBg,
                  color: C.text, fontSize: 12, fontFamily: 'inherit', outline: 'none',
                  boxSizing: 'border-box',
                }} />
              <div style={{ fontSize: 11, color: C.textDim, marginTop: 5 }}>
                Utilisé pour calculer le stade agronomique
              </div>
            </div>

            <div style={{ marginBottom: 20 }}>
              <label style={{ display: 'block', fontSize: 11, fontWeight: 600, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>
                Agent IA
              </label>
              <div style={{ display: 'flex', gap: 8 }}>
                {[true, false].map(v => (
                  <button key={String(v)} onClick={() => setForm(p => ({ ...p, actif: v }))}
                    style={{
                      flex: 1, padding: '8px', borderRadius: 7, fontFamily: 'inherit',
                      border: `1px solid ${form.actif === v ? C.green : C.border}`,
                      background: form.actif === v ? `${C.green}12` : 'transparent',
                      color: form.actif === v ? C.green : C.textMuted,
                      fontSize: 12, fontWeight: 600, cursor: 'pointer',
                    }}>
                    {v ? 'Activé' : 'Désactivé'}
                  </button>
                ))}
              </div>
            </div>

            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button onClick={onClose} style={{
                padding: '8px 16px', borderRadius: 7,
                border: `1px solid ${C.border}`, background: 'transparent',
                color: C.textMuted, fontSize: 12, fontFamily: 'inherit', cursor: 'pointer',
              }}>Annuler</button>
              <button onClick={handleSave} disabled={saving} style={{
                display: 'flex', alignItems: 'center', gap: 6,
                padding: '8px 18px', borderRadius: 7,
                background: saving ? C.toggleBg : C.green, color: '#fff',
                border: 'none', fontSize: 12, fontWeight: 700,
                fontFamily: 'inherit', cursor: saving ? 'not-allowed' : 'pointer',
              }}>
                <Save size={12} strokeWidth={2.5} />
                {saving ? 'Enregistrement…' : 'Enregistrer'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────
// PAGE PRINCIPALE
// ─────────────────────────────────────────────────────────────
export default function AgentIAPage({ token, auth, C: CProps, dark }) {
  const C = CProps || getColors(dark)
  const width = useWindowWidth()
  const isMobile = width < 640

  const [az106Device, setAz106Device] = useState(null)
  const [rec, setRec] = useState(null)
  const [tours, setTours] = useState([])
  const [weight, setWeight] = useState(null)
  const [deviceLatest, setDeviceLatest] = useState(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [showConfig, setShowConfig] = useState(false)
  const [error, setError] = useState('')
  const [activeTab, setActiveTab] = useState('plan')
  const [poidsSoir, setPoidsSoir] = useState(null)

  const today = new Date().toISOString().split('T')[0]
  const mois = new Date().getMonth() + 1

  // ── Trouver device AZ106 ──────────────────────────────────
  useEffect(() => {
    getDevices(token).then(farms => {
      const az = farms.find(f => f.farm_name === AZ106_FARM || f.farm_name?.includes('AZ106'))
      if (az?.houses?.length > 0) setAz106Device(az.houses[0])
      else {
        for (const farm of farms) {
          if (farm.houses?.length > 0) { setAz106Device(farm.houses[0]); break }
        }
      }
    }).catch(() => setError('Impossible de charger les devices'))
  }, [token])

  const loadWeight = useCallback(async () => {
    if (!az106Device) return
    try {
      const [w, ps] = await Promise.all([
        getLatestWeight(token, az106Device.farm_name),
        getPoidsSOir(token, az106Device.id),
      ])
      setWeight(w)
      setPoidsSoir(ps)
    } catch {}
  }, [az106Device, token])

  const loadDeviceLatest = useCallback(async () => {
    if (!az106Device) return
    try {
      const d = await getDeviceLatest(token, az106Device.id)
      setDeviceLatest(d)
    } catch {}
  }, [az106Device, token])

  const prt = weight?.poids_kg && weight?.poids_kg_matin
    ? calculerPRT(weight.poids_kg, weight.poids_kg_matin)
    : null
  const prtStatus = prt !== null ? getPRTStatus(prt, mois) : null

  const loadRec = useCallback(async (silent = false) => {
    if (!az106Device) return
    if (!silent) setLoading(true)
    else setRefreshing(true)
    setError('')
    try {
      const [recData, toursData] = await Promise.all([
        getAIRec(token, az106Device.id, today),
        getDeviceTours(token, az106Device.id, today),
      ])
      setRec(recData)
      setTours(toursData?.tours || [])
    } catch (e) {
      if (!silent) setError(e.message)
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [az106Device, token, today])

  useEffect(() => {
    if (az106Device) { loadWeight(); loadDeviceLatest() }
  }, [az106Device])

  useEffect(() => {
    if (az106Device) loadRec()
  }, [az106Device])

  useEffect(() => {
    if (!az106Device) return
    const iv = setInterval(() => { loadWeight(); loadDeviceLatest(); loadRec(true) }, 30_000)
    return () => clearInterval(iv)
  }, [loadRec, loadWeight, loadDeviceLatest, az106Device])

  // ── Onglets ────────────────────────────────────────────────
  const tabs = [
    { id: 'plan',        label: 'Plan du jour' },
    { id: 'tours',       label: 'Tours réels' },
  ]

  const poidsSoirKg   = poidsSoir?.poids_soir ?? null
  const finTour       = poidsSoir?.fin_tour ?? null
  const radiationSum  = deviceLatest?.sensor?.radiation_sum ?? null
  const radiationLive = deviceLatest?.sensor?.radiation ?? null
  const periode       = getPeriode(mois)
  const seuils        = PRT_SEUILS[periode]
  const statut        = STATUT_MAP[rec?.statut || 'non_disponible']
  const prtVal        = rec?.pct_ressuyage ?? null

  return (
    <div style={{ animation: 'az-fade-in 0.3s ease both' }}>

      {showConfig && az106Device && (
        <ConfigModal deviceId={az106Device.id} token={token}
          onClose={() => { setShowConfig(false); loadRec() }}
          C={C} dark={dark} />
      )}

      {/* ── Header ───────────────────────────────────────────── */}
      <div style={{
        display: 'flex', alignItems: isMobile ? 'flex-start' : 'center',
        flexDirection: isMobile ? 'column' : 'row',
        justifyContent: 'space-between', marginBottom: 24, gap: 12,
      }}>
        <div>
          <h1 style={{
            fontSize: isMobile ? 18 : 21, fontWeight: 800, color: C.text,
            marginBottom: 4, display: 'flex', alignItems: 'center', gap: 9,
          }}>
            <Brain size={isMobile ? 17 : 20} color={C.green} strokeWidth={2} />
            Agent IA Irrigation
          </h1>
          <p style={{ fontSize: 11, color: C.textDim }}>
            {az106Device ? `${az106Device.farm_name} · Station ${az106Device.house_number}` : 'AZ106'} · {today}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={() => { loadWeight(); loadDeviceLatest(); loadRec(true) }} disabled={refreshing}
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '7px 14px', borderRadius: 7,
              border: `1px solid ${C.border}`,
              background: C.toggleBg, color: C.textMuted,
              fontSize: 12, fontWeight: 600, fontFamily: 'inherit', cursor: 'pointer',
            }}>
            <RefreshCw size={12} strokeWidth={2}
              style={{ animation: refreshing ? 'az-spin 0.7s linear infinite' : 'none' }} />
            {!isMobile && 'Actualiser'}
          </button>
          {az106Device && (
            <button onClick={() => setShowConfig(true)}
              style={{
                display: 'flex', alignItems: 'center', gap: 6,
                padding: '7px 14px', borderRadius: 7,
                border: `1px solid ${C.border}`,
                background: C.toggleBg, color: C.textMuted,
                fontSize: 12, fontWeight: 600, fontFamily: 'inherit', cursor: 'pointer',
              }}>
              <Settings size={12} strokeWidth={2} />
              {!isMobile && 'Configuration'}
            </button>
          )}
        </div>
      </div>

      {/* Erreur */}
      {error && (
        <div style={{
          padding: '10px 14px', borderRadius: 8, marginBottom: 16,
          background: 'rgba(220,50,50,0.06)', border: '1px solid rgba(220,50,50,0.2)',
          color: '#e55', fontSize: 12,
        }}>
          {error}
        </div>
      )}

      {/* ── Bandeau device ─────────────────────────────────────── */}
      {az106Device && (
        <div style={{
          background: C.card, border: `1px solid ${C.border}`,
          borderRadius: 10, padding: '10px 16px',
          display: 'flex', alignItems: 'center', gap: 10,
          marginBottom: 20, flexWrap: 'wrap',
        }}>
          <div style={{
            width: 7, height: 7, borderRadius: '50%',
            background: deviceLatest?.online ? C.green : '#e55',
            boxShadow: deviceLatest?.online ? `0 0 6px ${C.green}80` : 'none',
            flexShrink: 0,
          }} />
          <span style={{ fontSize: 12, fontWeight: 600, color: C.text }}>
            {az106Device.farm_name} — Station {az106Device.house_number}
          </span>
          <span style={{ fontSize: 11, color: C.textDim }}>
            {deviceLatest?.online ? 'En ligne' : 'Hors ligne'} · Méthode hybride (règles + ML)
          </span>
          {radiationSum != null && (
            <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 5 }}>
              <Zap size={11} color={C.textDim} strokeWidth={2} />
              <span style={{ fontSize: 12, fontWeight: 600, color: C.text }}>
                {radiationSum.toFixed(1)} J/cm²
              </span>
              <span style={{ fontSize: 11, color: C.textDim }}>Rad. Sum</span>
            </div>
          )}
        </div>
      )}

      {/* ── Layout principal ─────────────────────────────────────── */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: isMobile ? '1fr' : '260px 1fr',
        gap: 16,
        alignItems: 'start',
      }}>

        {/* ── Colonne gauche ──────────────────────────────────────── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>

          {/* Capteur Poids */}
          <Section title="Capteur Poids" icon={Scale} C={C} dark={dark}
            action={weight && (
              <span style={{ fontSize: 10, color: C.textDim }}>
                {new Date(weight.timestamp).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
              </span>
            )}
          >
            <DataRow label="Poids soir" value={poidsSoirKg != null ? poidsSoirKg.toFixed(2) : '—'} unit="kg" accent={C.text} C={C} />
            <DataRow label="Fin tour" value={finTour || '—'} unit={finTour ? 'UTC' : ''} C={C} />
            <DataRow label="Rad. Sum" value={radiationSum != null ? radiationSum.toFixed(1) : '—'} unit="J/cm²" C={C} />
            <DataRow label="Radiation inst." value={radiationLive != null ? radiationLive.toFixed(0) : '—'} unit="W/m²" C={C} />
          </Section>

          {/* PRT Ressuyage */}
          <Section title="% Ressuyage (PRT)" icon={Activity} C={C} dark={dark}
            action={
              <span style={{
                fontSize: 10, color: C.textDim,
                background: C.toggleBg, borderRadius: 4,
                padding: '2px 7px', border: `1px solid ${C.border}`,
              }}>
                Cible {seuils.min}–{seuils.max}% · {periode}
              </span>
            }
          >
            {prtVal !== null ? (
              <div style={{ paddingTop: 8 }}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 10 }}>
                  <span style={{ fontSize: 36, fontWeight: 900, color: prtStatus?.color || C.text, lineHeight: 1 }}>
                    {prtVal.toFixed(1)}%
                  </span>
                  <StatusBadge label={prtStatus?.ok ? 'Seuil atteint' : 'En attente'} color={prtStatus?.color || C.textDim} />
                </div>
                <ProgressBar value={prtVal} min={0} max={20} color={prtStatus?.color || C.green} C={C} />
                <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 5, fontSize: 10, color: C.textDim }}>
                  <span>0%</span>
                  <span style={{ color: C.green }}>↑ {seuils.min}–{seuils.max}%</span>
                  <span>20%</span>
                </div>
                {prtStatus?.msg && (
                  <div style={{ marginTop: 10, fontSize: 11, color: C.textDim }}>
                    {prtStatus.msg}
                  </div>
                )}
              </div>
            ) : (
              <div style={{ paddingTop: 12, fontSize: 11, color: C.textDim }}>
                En attente des données poids…
              </div>
            )}
          </Section>

          {/* Stade agronomique */}
          {rec?.stade && (
            <Section title="Stade phénologique" icon={Leaf} C={C} dark={dark}>
              <DataRow label="Stade" value={rec.stade} accent={C.green} C={C} />
              <DataRow label="J plantation" value={rec.j_plantation != null ? `J+${rec.j_plantation}` : '—'} C={C} />
            </Section>
          )}

        </div>

        {/* ── Colonne droite ──────────────────────────────────────── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>

          {/* Chargement */}
          {loading && (
            <div style={{
              display: 'flex', alignItems: 'center', gap: 10,
              color: C.textDim, fontSize: 12, padding: '60px 0',
              justifyContent: 'center',
            }}>
              <RefreshCw size={14} style={{ animation: 'az-pulse 1.2s ease-in-out infinite' }} />
              Génération de la recommandation IA…
            </div>
          )}

          {/* Attente PRT */}
          {!loading && rec && rec.statut === 'en_attente_prt' && (
            <Section title="En attente du seuil de ressuyage" icon={Scale} C={C} dark={dark}>
              <div style={{ padding: '20px 0', textAlign: 'center' }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: C.text, marginBottom: 8 }}>
                  Seuil PRT non atteint
                </div>
                <div style={{ fontSize: 11, color: C.textDim, lineHeight: 1.7, maxWidth: 360, margin: '0 auto' }}>
                  {rec.message}
                </div>
                {rec.pct_ressuyage != null && (
                  <div style={{ marginTop: 16, fontSize: 28, fontWeight: 900, color: C.amber }}>
                    {rec.pct_ressuyage.toFixed(1)}%
                  </div>
                )}
                <div style={{ marginTop: 12, fontSize: 11, color: C.textDim }}>
                  Vérification toutes les 30s…
                </div>
              </div>
            </Section>
          )}

          {/* Attente Radiation */}
          {!loading && rec && rec.statut === 'en_attente_radiation' && (
            <Section title="En attente du seuil de radiation" icon={Sun} C={C} dark={dark}>
              <div style={{ padding: '20px 0', textAlign: 'center' }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: C.text, marginBottom: 8 }}>
                  PRT ✓ — Seuil radiation non atteint
                </div>
                <div style={{ fontSize: 11, color: C.textDim, lineHeight: 1.7, maxWidth: 360, margin: '0 auto' }}>
                  {rec.message}
                </div>
                {radiationSum != null && (
                  <div style={{ marginTop: 16, fontSize: 18, fontWeight: 700, color: C.text }}>
                    Radiation actuelle : {radiationSum.toFixed(1)} J/cm²
                  </div>
                )}
                <div style={{ marginTop: 12, fontSize: 11, color: C.textDim }}>
                  Vérification toutes les 30s…
                </div>
              </div>
            </Section>
          )}

          {/* Recommandation complète */}
          {!loading && rec && rec.statut !== 'en_attente_prt' && rec.statut !== 'en_attente_radiation' && (
            <>
              {/* En-tête statut */}
              <div style={{
                background: C.card, border: `1px solid ${C.border}`,
                borderRadius: 10, padding: '12px 18px',
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: C.text }}>Recommandation du jour</span>
                <StatusBadge label={statut.label} color={statut.color} />
              </div>

              {/* Onglets */}
              <div style={{
                display: 'flex', borderBottom: `1px solid ${C.border}`,
                gap: 0,
              }}>
                {tabs.map(tab => (
                  <button key={tab.id} onClick={() => setActiveTab(tab.id)}
                    style={{
                      padding: '9px 16px', background: 'none',
                      border: 'none', borderBottom: `2px solid ${activeTab === tab.id ? C.green : 'transparent'}`,
                      color: activeTab === tab.id ? C.green : C.textMuted,
                      fontSize: 12, fontWeight: activeTab === tab.id ? 700 : 500,
                      fontFamily: 'inherit', cursor: 'pointer',
                      marginBottom: -1, transition: 'all 0.15s',
                    }}>
                    {tab.label}
                  </button>
                ))}
              </div>

              {/* Contenu onglet Plan */}
              {activeTab === 'plan' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>

                  {/* Métriques principales */}
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                    {/* Tours prévus */}
                    <div style={{
                      background: C.card, border: `1px solid ${C.border}`,
                      borderRadius: 10, padding: '16px 18px',
                    }}>
                      <div style={{ fontSize: 10, color: C.textDim, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8, fontWeight: 600 }}>
                        Tours prévus
                      </div>
                      <div style={{ fontSize: 40, fontWeight: 900, color: C.text, lineHeight: 1, marginBottom: 6 }}>
                        {rec.nb_tours_prevu ?? '—'}
                      </div>
                      {rec.nb_tours_prevu > 0 && (
                        <>
                          <div style={{ fontSize: 11, color: C.textDim, marginBottom: 5 }}>
                            {rec.nb_tours_reel || 0} / {rec.nb_tours_prevu} effectués
                          </div>
                          <ProgressBar
                            value={rec.nb_tours_reel || 0}
                            min={0} max={rec.nb_tours_prevu}
                            color={C.green} C={C}
                          />
                        </>
                      )}
                    </div>

                    {/* Décision IA */}
                    <div style={{
                      background: C.card, border: `1px solid ${C.border}`,
                      borderRadius: 10, padding: '16px 18px',
                    }}>
                      <div style={{ fontSize: 10, color: C.textDim, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8, fontWeight: 600 }}>
                        1er tour
                      </div>
                      <div style={{ fontSize: rec.heure_debut ? 32 : 14, fontWeight: 900, color: rec.heure_debut ? C.text : C.textDim, lineHeight: 1, marginBottom: 4 }}>
                        {rec.heure_debut || '⏳ Calcul...'}
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6 }}>
                        <span style={{ fontSize: 10, color: C.textDim }}>UTC</span>
                      </div>
                    </div>
                  </div>

                  {/* Durées et repos */}
                  <div style={{
                    background: C.card, border: `1px solid ${C.border}`,
                    borderRadius: 10, overflow: 'hidden',
                  }}>
                    <div style={{
                      padding: '11px 18px', borderBottom: `1px solid ${C.border}`,
                      display: 'flex', alignItems: 'center', gap: 8,
                    }}>
                      <Clock size={13} color={C.green} strokeWidth={2.5} />
                      <span style={{ fontSize: 11, fontWeight: 700, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                        Programme
                      </span>
                    </div>

                    {/* Grille 3 métriques principales */}
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', borderBottom: `1px solid ${C.border}` }}>
                      {[
                        { label: 'Durée Tour 1', value: rec.duree_t12_min != null ? rec.duree_t12_min : '—', unit: 'min' },
                        { label: 'Durée Tour 2', value: rec.duree_t12_min != null ? rec.duree_t12_min : '—', unit: 'min' },
                        { label: 'Repos T1→T2',  value: rec.repos_t1_t2_min ?? rec.repos_initial_min ?? '—', unit: 'min' },
                      ].map((m, i, arr) => (
                        <div key={m.label} style={{
                          padding: '18px 16px',
                          borderRight: i < arr.length - 1 ? `1px solid ${C.border}` : 'none',
                          display: 'flex', flexDirection: 'column', gap: 6,
                        }}>
                          <span style={{ fontSize: 10, fontWeight: 600, color: C.textDim, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                            {m.label}
                          </span>
                          <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
                            <span style={{ fontSize: 28, fontWeight: 900, color: C.text, lineHeight: 1 }}>{m.value}</span>
                            {m.value !== '—' && <span style={{ fontSize: 12, color: C.textDim }}>{m.unit}</span>}
                          </div>
                        </div>
                      ))}
                    </div>

                    {/* Infos secondaires en lignes */}
                    <div style={{ padding: '2px 0' }}>
                      {[
                        { label: 'Stade agronomique', value: rec.stade || '—' },
                        { label: 'EC cible', value: rec.ec_cible_dSm != null ? `${rec.ec_cible_dSm} dS/m` : '—' },
                        ...(rec.heure_debut && rec.radiation_sum_debut != null
                          ? [{ label: 'Rad. Sum au 1er tour', value: `${rec.radiation_sum_debut.toFixed(1)} J/cm²` }]
                          : []),
                      ].map((row, i, arr) => (
                        <div key={row.label} style={{
                          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                          padding: '10px 18px',
                          borderBottom: i < arr.length - 1 ? `1px solid ${C.border}` : 'none',
                        }}>
                          <span style={{ fontSize: 11, color: C.textDim, textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600 }}>
                            {row.label}
                          </span>
                          <span style={{ fontSize: 13, fontWeight: 700, color: C.text }}>{row.value}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Badge PRT si disponible */}
                  {prtStatus && (
                    <div style={{
                      padding: '10px 14px', borderRadius: 8,
                      background: `${prtStatus.color}08`, border: `1px solid ${prtStatus.color}25`,
                      display: 'flex', alignItems: 'center', gap: 8,
                    }}>
                      <Scale size={12} color={prtStatus.color} strokeWidth={2} />
                      <span style={{ fontSize: 11, fontWeight: 600, color: prtStatus.color }}>
                        {prtStatus.msg}
                      </span>
                    </div>
                  )}
                </div>
              )}

              {/* Contenu onglet Tours réels */}
              {activeTab === 'tours' && (
                <Section title={`Tours réels aujourd'hui (${tours.filter(t => t.debut).length})`} icon={Clock} C={C} dark={dark}>
                  <TourTable tours={tours} C={C} dark={dark} />
                </Section>
              )}
            </>
          )}

          {/* Aucune donnée */}
          {!loading && !rec && !error && az106Device && (
            <Section title="En attente" icon={Brain} C={C} dark={dark}>
              <div style={{ padding: '24px 0', textAlign: 'center' }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: C.text, marginBottom: 6 }}>
                  Génération en cours…
                </div>
                <div style={{ fontSize: 11, color: C.textDim, lineHeight: 1.7 }}>
                  La recommandation IA se génère automatiquement chaque matin.<br />
                  Configurez la date de plantation via le bouton <strong>Configuration</strong>.
                </div>
              </div>
            </Section>
          )}
        </div>
      </div>
    </div>
  )
}