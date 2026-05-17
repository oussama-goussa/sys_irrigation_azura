// ============================================================
// frontend/src/pages/AgentIAPage.jsx
// Agent IA — AZ106 uniquement · Recommandation Matinale
// Recommandation automatique basée sur PRT Ressuyage
// Projet Azura Irrigation IA — GOUSSA Oussama
// ============================================================

import { useState, useEffect, useRef, useCallback } from 'react'
import {
  Brain, RefreshCw, Settings, Scale,
  Sun, CloudRain, Wind, Thermometer, Droplets,
  Pause, StopCircle, TrendingUp, TrendingDown,
  AlertTriangle, CheckCircle2, Clock,
  FlaskConical, Leaf, Info,
  Activity, Save, X, Zap,
} from 'lucide-react'
import { getColors } from '../theme.js'
import { useWindowWidth } from '../components/DashboardShell.jsx'

// ─── Constantes ──────────────────────────────────────────────
const AZ106_FARM = 'AZ106'

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
async function getDeviceLatest(token, deviceId) {
  return fetchWithToken(`/api/devices/${deviceId}/latest`, token)
}

// ── Color maps ────────────────────────────────────────────────
const ACTION_COLORS = {
  CONTINUER         : { color: '#34d96f', bg: 'rgba(52,217,111,0.10)', icon: CheckCircle2 },
  PRUDENCE          : { color: '#f5a623', bg: 'rgba(245,166,35,0.10)',  icon: AlertTriangle },
  AUGMENTATION_REPOS: { color: '#f5a623', bg: 'rgba(245,166,35,0.10)',  icon: Pause },
  PROLONGER         : { color: '#4d9de0', bg: 'rgba(77,157,224,0.10)',  icon: TrendingUp },
  ARRET_URGENT      : { color: '#f05252', bg: 'rgba(240,82,82,0.10)',   icon: StopCircle },
}

const STATUT_MAP = {
  en_cours      : { label: 'En cours',     color: '#4d9de0' },
  en_attente    : { label: 'En attente PRT', color: '#f5a623' },
  optimal       : { label: 'Prêt ✓',       color: '#34d96f' },
  arrete        : { label: 'Terminé',      color: '#f05252' },
  non_disponible: { label: '—',            color: '#9cb8a6' },
}

// ─────────────────────────────────────────────────────────────
// SUB-COMPONENTS
// ─────────────────────────────────────────────────────────────

// Carte Plan Journée
function PlanCard({ rec, C, dark }) {
  if (!rec) return null
  const statut = STATUT_MAP[rec.statut || 'non_disponible']
  const enAttente = rec.statut === 'en_attente'

  return (
    <div style={{
      background: C.surface, border: `1.5px solid ${C.border}`,
      borderRadius: 12, padding: '20px 22px',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 18 }}>
        <Activity size={18} color={C.green} strokeWidth={2.5} />
        <span style={{ fontSize: 14, fontWeight: 800, color: C.text,
          textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          RECOMMANDATION INITIALE (Matin)
        </span>
        <span style={{
          marginLeft: 'auto', fontSize: 11, fontWeight: 700,
          color: statut.color, background: `${statut.color}18`,
          border: `1px solid ${statut.color}35`, borderRadius: 6, padding: '3px 12px',
        }}>
          {statut.label}
        </span>
      </div>

      {enAttente && (
        <div style={{
          marginBottom: 20, padding: '12px 16px', borderRadius: 10,
          background: 'rgba(245,166,35,0.08)', border: '1px solid rgba(245,166,35,0.3)',
          display: 'flex', alignItems: 'center', gap: 10, color: '#f5a623',
        }}>
          <Clock size={16} style={{ animation: 'az-pulse 2s infinite' }} />
          <div style={{ fontSize: 13, fontWeight: 600 }}>
            {rec.message || "En attente du seuil de ressuyage pour débuter..."}
          </div>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12, marginBottom: 20 }}>
        {[
          { label: 'Tours prévus',   value: rec.nb_tours_prevu ?? '—',                          color: C.green, big: true },
          { label: 'Heure début',    value: rec.heure_debut    || '—',                          color: C.blue,  big: true },
          { label: 'Durée T1-T2',   value: rec.duree_t12_min != null ? `${rec.duree_t12_min} min` : '—', color: C.text },
          { label: 'Durée T3+',     value: rec.duree_t3p_min != null ? `${rec.duree_t3p_min} min` : '—', color: C.text },
          { label: 'Repos initial', value: rec.repos_initial_min != null ? `${rec.repos_initial_min} min` : '—', color: C.text },
          { label: 'Radiation Prévue', value: rec.radiation_jcm2 != null ? `${rec.radiation_jcm2.toFixed(0)} J/cm²` : '—', color: '#f5e642' },
        ].map(s => (
          <div key={s.label} style={{
            background: dark ? '#0d1610' : '#f4f9f5',
            border: `1px solid ${C.border}`, borderRadius: 10, padding: '12px 14px',
          }}>
            <div style={{ fontSize: 10, color: C.textDim, textTransform: 'uppercase',
              letterSpacing: '0.06em', marginBottom: 4 }}>{s.label}</div>
            <div style={{ fontSize: s.big ? 24 : 14, fontWeight: 800, color: s.color }}>
              {s.value}
            </div>
          </div>
        ))}
      </div>

      {/* Progression tours */}
      {rec.nb_tours_prevu > 0 && !enAttente && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11,
            color: C.textDim, marginBottom: 6 }}>
            <span>Progression des tours</span>
            <span style={{ fontWeight: 700, color: C.green }}>
              {rec.nb_tours_reel || 0} / {rec.nb_tours_prevu}
            </span>
          </div>
          <div style={{ height: 8, borderRadius: 4, background: C.border, overflow: 'hidden' }}>
            <div style={{
              height: '100%', borderRadius: 4, background: C.green,
              width: `${Math.min(100, ((rec.nb_tours_reel || 0) / rec.nb_tours_prevu) * 100)}%`,
              transition: 'width 0.8s ease-out',
              boxShadow: `0 0 10px ${C.green}40`,
            }} />
          </div>
        </div>
      )}
    </div>
  )
}

// Carte NPK
function NPKCard({ rec, C, dark }) {
  if (!rec?.doses_npk) return null
  const npk = rec.doses_npk
  const canaux = [
    { key: 'canal_A_g', label: 'Canal A (KNO₃)',   color: '#34d96f' },
    { key: 'canal_B_g', label: 'Canal B (Ca·NO₃)', color: '#4d9de0' },
    { key: 'canal_C_g', label: 'Canal C (MgSO₄)', color: '#b197fc' },
    { key: 'canal_D_g', label: 'Canal D (K₂SO₄)', color: '#f5a623' },
  ]
  return (
    <div style={{
      background: C.surface, border: `1.5px solid ${C.border}`,
      borderRadius: 12, padding: '16px 20px',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16 }}>
        <FlaskConical size={16} color='#b197fc' strokeWidth={2.5} />
        <span style={{ fontSize: 12, fontWeight: 800, color: C.textMuted,
          textTransform: 'uppercase', letterSpacing: '0.08em' }}>
          Fertilisation / cycle
        </span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {canaux.map(c => {
          const val = npk[c.key]
          const max = Math.max(...canaux.map(x => npk[x.key] || 0))
          const pct = max > 0 ? (val / max) * 100 : 0
          return (
            <div key={c.key} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ width: 110, fontSize: 11, color: C.textMuted, flexShrink: 0 }}>
                {c.label}
              </div>
              <div style={{ flex: 1, height: 10, borderRadius: 5, background: C.border, overflow: 'hidden' }}>
                <div style={{
                  height: '100%', borderRadius: 5, background: c.color,
                  width: `${pct}%`, transition: 'width 0.8s ease-out',
                }} />
              </div>
              <div style={{ width: 60, fontSize: 12, fontWeight: 800, color: c.color,
                textAlign: 'right', flexShrink: 0 }}>
                {val != null ? `${val}g` : '—'}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// Modal Config — uniquement date plantation
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
      await saveAIConfig(token, deviceId, {
        date_plantation: form.date_plantation || null,
        actif: form.actif,
      })
      onClose()
    } catch (e) {
      alert(e.message)
    } finally {
      setSaving(false)
    }
  }

  const inputSt = {
    width: '100%', padding: '10px 14px', borderRadius: 9,
    border: `1.5px solid ${C.border}`, background: C.inputBg,
    color: C.text, fontSize: 13, fontFamily: 'inherit', outline: 'none',
    boxSizing: 'border-box',
  }
  const labelSt = {
    display: 'block', color: C.textMuted, fontSize: 11, fontWeight: 700,
    textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8,
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 99999, background: 'rgba(0,0,0,0.75)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24,
      backdropFilter: 'blur(4px)',
    }}>
      <div style={{
        background: C.card, border: `1.5px solid ${C.border}`,
        borderRadius: 20, padding: '28px 32px', width: '100%', maxWidth: 440,
        boxShadow: '0 32px 100px rgba(0,0,0,0.6)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24 }}>
          <Settings size={20} color={C.green} strokeWidth={2.5} />
          <div style={{ fontSize: 16, fontWeight: 900, color: C.text }}>
            Configuration AZ106
          </div>
          <button onClick={onClose} style={{ marginLeft: 'auto', background: 'none',
            border: 'none', cursor: 'pointer', color: C.textDim }}>
            <X size={20} strokeWidth={2.5} />
          </button>
        </div>

        {!cfg ? (
          <div style={{ textAlign: 'center', color: C.textDim, padding: 32 }}>Chargement...</div>
        ) : (
          <>
            <div style={{ marginBottom: 20 }}>
              <label style={labelSt}>Date de plantation</label>
              <input type="date" value={form.date_plantation}
                onChange={e => setForm(p => ({ ...p, date_plantation: e.target.value }))}
                style={inputSt} />
            </div>

            <div style={{ marginBottom: 24 }}>
              <label style={labelSt}>Agent IA</label>
              <div style={{ display: 'flex', gap: 10 }}>
                {[true, false].map(v => (
                  <button key={String(v)}
                    onClick={() => setForm(p => ({ ...p, actif: v }))}
                    style={{
                      flex: 1, padding: '10px', borderRadius: 9, fontFamily: 'inherit',
                      border: `2px solid ${form.actif === v ? C.green : C.border}`,
                      background: form.actif === v ? `${C.green}15` : 'transparent',
                      color: form.actif === v ? C.green : C.textMuted,
                      fontSize: 13, fontWeight: 700, cursor: 'pointer',
                    }}>
                    {v ? 'Activé' : 'Désactivé'}
                  </button>
                ))}
              </div>
            </div>

            <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end' }}>
              <button onClick={onClose} style={{
                padding: '10px 22px', borderRadius: 10,
                border: `1.5px solid ${C.border}`, background: 'transparent',
                color: C.textMuted, fontSize: 13, fontWeight: 600, cursor: 'pointer',
              }}>Annuler</button>
              <button onClick={handleSave} disabled={saving} style={{
                display: 'flex', alignItems: 'center', gap: 8,
                padding: '10px 24px', borderRadius: 10,
                background: saving ? C.toggleBg : C.green, color: '#fff',
                border: 'none', fontSize: 13, fontWeight: 800,
                fontFamily: 'inherit', cursor: saving ? 'not-allowed' : 'pointer',
              }}>
                <Save size={14} strokeWidth={3} />
                {saving ? 'Enregistrement...' : 'Enregistrer'}
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
  const [deviceLatest, setDeviceLatest] = useState(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [showConfig, setShowConfig] = useState(false)
  const [error, setError] = useState('')
  const [activeTab, setActiveTab] = useState('plan')
  const intervalRef = useRef(null)

  const today = new Date().toISOString().split('T')[0]

  // ── Trouver device AZ106 ──────────────────────────────────
  useEffect(() => {
    getDevices(token).then(farms => {
      const az = farms.find(f => f.farm_name === AZ106_FARM || f.farm_name?.includes('AZ106'))
      if (az?.houses?.length > 0) setAz106Device(az.houses[0])
      else if (farms[0]?.houses?.length > 0) setAz106Device(farms[0].houses[0])
    }).catch(() => setError('Impossible de charger les devices'))
  }, [token])

  // ── Charger lectures live sensor ──────────────────────────
  const loadDeviceLatest = useCallback(async () => {
    if (!az106Device) return
    try {
      const d = await getDeviceLatest(token, az106Device.id)
      setDeviceLatest(d)
    } catch {}
  }, [az106Device, token])

  // ── Charger recommandation (auto-génération) ──────────────
  const loadRec = useCallback(async (silent = false) => {
    if (!az106Device) return
    if (!silent) setLoading(true)
    else setRefreshing(true)
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
    if (az106Device) {
      loadDeviceLatest()
      loadRec()
    }
  }, [az106Device, loadRec, loadDeviceLatest])

  // ── Refresh automatique toutes les 30s ───────────────────
  useEffect(() => {
    if (!az106Device) return
    intervalRef.current = setInterval(() => {
      loadDeviceLatest()
      loadRec(true)
    }, 30_000)
    return () => clearInterval(intervalRef.current)
  }, [loadRec, loadDeviceLatest, az106Device])

  // ── Render ────────────────────────────────────────────────
  return (
    <div style={{ animation: 'az-fade-in 0.3s ease both', maxWidth: 1000, margin: '0 auto' }}>

      {showConfig && az106Device && (
        <ConfigModal deviceId={az106Device.id} token={token}
          onClose={() => { setShowConfig(false); loadRec() }}
          C={C} dark={dark} />
      )}

      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        marginBottom: 24, gap: 12, flexWrap: 'wrap'
      }}>
        <div>
          <h1 style={{ fontSize: isMobile ? 18 : 22, fontWeight: 900, color: C.text,
            marginBottom: 4, display: 'flex', alignItems: 'center', gap: 10 }}>
            <Brain size={isMobile ? 22 : 26} color={C.green} strokeWidth={2.5} />
            Agent IA Irrigation
          </h1>
          <p style={{ fontSize: 12, color: C.textDim, fontWeight: 600 }}>
            AZ106 · {today} · Auto-piloté
          </p>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <button onClick={() => { loadDeviceLatest(); loadRec(true) }} disabled={refreshing}
            style={{
              display: 'flex', alignItems: 'center', gap: 7, padding: '8px 16px',
              borderRadius: 10, border: `1.5px solid ${C.border}`,
              background: C.surface, color: C.textMuted,
              fontSize: 13, fontWeight: 700, cursor: 'pointer', transition: 'all 0.2s'
            }}>
            <RefreshCw size={14} strokeWidth={2.5}
              style={{ animation: refreshing ? 'az-spin 0.7s linear infinite' : 'none' }} />
            {!isMobile && 'Actualiser'}
          </button>
          <button onClick={() => setShowConfig(true)}
            style={{
              display: 'flex', alignItems: 'center', gap: 7, padding: '8px 16px',
              borderRadius: 10, border: `1.5px solid ${C.border}`,
              background: C.surface, color: C.textMuted,
              fontSize: 13, fontWeight: 700, cursor: 'pointer'
            }}>
            <Settings size={14} strokeWidth={2.5} />
            {!isMobile && 'Date plantation'}
          </button>
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {error && (
          <div style={{ padding: '12px 16px', borderRadius: 10,
            background: 'rgba(240,82,82,0.08)', border: '1px solid rgba(240,82,82,0.25)',
            color: '#f05252', fontSize: 13, fontWeight: 600 }}>
            ⚠ {error}
          </div>
        )}

        {loading ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 12,
            color: C.textDim, fontSize: 14, padding: '100px 0', justifyContent: 'center' }}>
            <RefreshCw size={20} style={{ animation: 'az-pulse 1.2s ease-in-out infinite' }} />
            Calcul de la recommandation initiale...
          </div>
        ) : rec ? (
          <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 340px', gap: 16 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <PlanCard rec={rec} C={C} dark={dark} />
              <div style={{ background: C.surface, border: `1.5px solid ${C.border}`,
                borderRadius: 12, padding: '16px 20px' }}>
                <div style={{ fontSize: 12, fontWeight: 800, color: C.textMuted,
                  textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 12 }}>
                  Tours réels aujourd'hui
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {tours.length === 0 ? (
                    <div style={{ textAlign: 'center', padding: '20px', color: C.textDim, fontSize: 13 }}>
                      En attente du premier tour
                    </div>
                  ) : tours.map(t => (
                    <div key={t.tour_num} style={{ display: 'flex', alignItems: 'center', gap: 12,
                      padding: '10px 14px', background: dark ? '#0d1610' : '#f4f9f5',
                      borderRadius: 8, border: `1px solid ${C.border}` }}>
                      <div style={{ width: 24, height: 24, borderRadius: 6, background: C.green,
                        color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: 12, fontWeight: 900 }}>{t.tour_num}</div>
                      <div style={{ flex: 1, fontSize: 13, fontWeight: 700, color: C.text }}>
                        Début: {t.debut || '—'} · Durée: {t.duree_min || '—'} min
                      </div>
                      <div style={{ fontSize: 12, color: C.textDim }}>{t.ec_apport ? `EC: ${t.ec_apport.toFixed(1)}` : ''}</div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <NPKCard rec={rec} C={C} dark={dark} />
              {/* Note informative */}
              <div style={{ padding: '16px', background: `${C.green}08`, borderRadius: 12,
                border: `1.5px dashed ${C.green}30`, fontSize: 12, color: C.textDim, lineHeight: 1.6 }}>
                <Info size={14} color={C.green} style={{ marginBottom: 8 }} />
                La recommandation est pilotée par le <strong>PRT (Pourcentage de Ressuyage)</strong> calculé via le capteur de poids.<br /><br />
                EC Bassin cible: <strong>0.7 – 0.8 dS/m</strong>.
              </div>
            </div>
          </div>
        ) : (
          <div style={{ textAlign: 'center', padding: '100px 0', color: C.textDim }}>
            Aucune recommandation disponible pour AZ106
          </div>
        )}
      </div>
    </div>
  )
}
