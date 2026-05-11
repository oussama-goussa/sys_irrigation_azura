// ============================================================
// frontend/src/pages/AgentIAPage.jsx
// Page Agent IA — Recommandations & Ajustements temps réel
// 4 fermes × 2 houses — fonctionne sans drainage/poids
// Projet Azura Irrigation IA — GOUSSA Oussama
// ============================================================

import { useState, useEffect, useRef, useCallback } from 'react'
import {
  Brain, RefreshCw, Settings, ChevronDown, ChevronUp,
  Sun, CloudRain, Wind, Thermometer, Droplets, Zap,
  Play, Pause, StopCircle, TrendingUp, TrendingDown,
  AlertTriangle, CheckCircle2, Clock, BarChart2,
  FlaskConical, Leaf, Calendar, Info, ChevronRight,
  Activity, Save, X,
} from 'lucide-react'
import { getColors } from '../theme.js'
import { useWindowWidth } from '../components/DashboardShell.jsx'

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

async function getAIRec(token, deviceId, date) {
  const params = date ? `?date=${date}` : ''
  return fetchWithToken(`/api/ai/recommandation/${deviceId}${params}`, token)
}
async function genererRec(token, deviceId, payload) {
  return fetchWithToken(`/api/ai/recommandation/${deviceId}/generer`, token, {
    method: 'POST', body: JSON.stringify(payload),
  })
}
async function ajusterTour(token, deviceId, payload) {
  return fetchWithToken(`/api/ai/recommandation/${deviceId}/ajuster`, token, {
    method: 'POST', body: JSON.stringify(payload),
  })
}
async function getAIConfig(token, deviceId) {
  return fetchWithToken(`/api/ai/config/${deviceId}`, token)
}
async function saveAIConfig(token, deviceId, payload) {
  return fetchWithToken(`/api/ai/config/${deviceId}`, token, {
    method: 'PUT', body: JSON.stringify(payload),
  })
}
async function getResume(token, deviceId, date) {
  return fetchWithToken(`/api/ai/resume/${deviceId}?date=${date}`, token)
}
async function getDevices(token) {
  return fetchWithToken('/api/devices', token)
}
async function getDeviceTours(token, deviceId, date) {
  return fetchWithToken(`/api/devices/${deviceId}/tours?date=${date}`, token)
}

// ── Color maps ────────────────────────────────────────────────
const ACTION_COLORS = {
  CONTINUER         : { color: '#34d96f', bg: 'rgba(52,217,111,0.10)', icon: CheckCircle2 },
  PRUDENCE          : { color: '#f5a623', bg: 'rgba(245,166,35,0.10)',  icon: AlertTriangle },
  AUGMENTATION_REPOS: { color: '#f5a623', bg: 'rgba(245,166,35,0.10)',  icon: Pause },
  PROLONGER         : { color: '#4d9de0', bg: 'rgba(77,157,224,0.10)',  icon: TrendingUp },
  ARRET_URGENT      : { color: '#f05252', bg: 'rgba(240,82,82,0.10)',   icon: StopCircle },
}

const SCENARIO_ICONS = {
  ensoleille       : Sun,
  nuageux          : CloudRain,
  chergui          : Wind,
  brouillard       : CloudRain,
  pluie            : CloudRain,
  hiver_clair      : Sun,
  hiver_nuageux    : CloudRain,
  ressuyage_eleve  : TrendingUp,
  ressuyage_trop_faible: TrendingDown,
}

const STADE_COLORS = {
  vegetatif    : '#34d96f',
  developpement: '#4d9de0',
  floraison    : '#f5a623',
  grossissement: '#f5e642',
  recolte      : '#b197fc',
}

const STATUT_MAP = {
  en_cours        : { label: 'En cours',      color: '#4d9de0' },
  optimal         : { label: 'Optimal ✓',     color: '#34d96f' },
  a_ajuster       : { label: 'À surveiller',  color: '#f5a623' },
  arrete          : { label: 'Arrêté',        color: '#f05252' },
  pluie           : { label: 'Pluie – arrêt', color: '#4d9de0' },
  non_disponible  : { label: '—',             color: '#9cb8a6' },
}

// ─────────────────────────────────────────────────────────────
// SUB-COMPONENTS
// ─────────────────────────────────────────────────────────────

function MeteoCard({ rec, C, dark }) {
  if (!rec) return null
  const ScenIcon = SCENARIO_ICONS[rec.scenario_meteo] || Sun
  return (
    <div style={{
      background: C.surface, border: `1.5px solid ${C.border}`,
      borderRadius: 12, padding: '14px 16px',
      display: 'flex', flexDirection: 'column', gap: 10,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <ScenIcon size={14} color={C.amber} strokeWidth={2} />
        <span style={{ fontSize: 11, fontWeight: 700, color: C.textMuted,
          textTransform: 'uppercase', letterSpacing: '0.08em' }}>
          Météo du jour
        </span>
        <span style={{
          marginLeft: 'auto', fontSize: 10, fontWeight: 600,
          background: `${C.amber}18`, color: C.amber,
          border: `1px solid ${C.amber}35`, borderRadius: 4, padding: '1px 7px',
        }}>
          {rec.scenario_meteo || '—'}
        </span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
        {[
          { icon: Thermometer, label: 'T max', value: rec.t_max != null ? `${rec.t_max}°C` : '—', color: '#f5a623' },
          { icon: Droplets,    label: 'HR moy', value: rec.hr_moy != null ? `${rec.hr_moy}%` : '—', color: '#4d9de0' },
          { icon: Sun,         label: 'Rad.',   value: rec.radiation_jcm2 != null ? `${rec.radiation_jcm2} J/cm²` : '—', color: '#f5e642' },
          { icon: Wind,        label: 'VPD',    value: rec.vpd_kpa != null ? `${rec.vpd_kpa} kPa` : '—', color: '#b197fc' },
          { icon: CloudRain,   label: 'Pluie',  value: rec.pluie_mm != null ? `${rec.pluie_mm} mm` : '0 mm', color: '#4d9de0' },
          { icon: Leaf,        label: 'Stade',  value: rec.stade || '—', color: STADE_COLORS[rec.stade] || C.green },
        ].map(m => (
          <div key={m.label} style={{
            background: dark ? '#0d1610' : '#f4f9f5',
            border: `1px solid ${C.border}`,
            borderRadius: 8, padding: '8px 10px',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 3 }}>
              <m.icon size={10} color={m.color} strokeWidth={2} />
              <span style={{ fontSize: 9, color: C.textDim, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                {m.label}
              </span>
            </div>
            <div style={{ fontSize: 13, fontWeight: 700, color: m.color }}>{m.value}</div>
          </div>
        ))}
      </div>
    </div>
  )
}

function PlanCard({ rec, C, dark }) {
  if (!rec) return null
  const statut = STATUT_MAP[rec.statut || 'non_disponible']
  return (
    <div style={{
      background: C.surface, border: `1.5px solid ${C.border}`,
      borderRadius: 12, padding: '14px 16px',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <Activity size={14} color={C.green} strokeWidth={2} />
        <span style={{ fontSize: 11, fontWeight: 700, color: C.textMuted,
          textTransform: 'uppercase', letterSpacing: '0.08em' }}>
          Plan de la journée
        </span>
        <span style={{
          marginLeft: 'auto', fontSize: 10, fontWeight: 700,
          color: statut.color,
          background: `${statut.color}18`,
          border: `1px solid ${statut.color}35`,
          borderRadius: 4, padding: '1px 8px',
        }}>
          {statut.label}
        </span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8, marginBottom: 12 }}>
        {[
          { label: 'Tours prévus',    value: rec.nb_tours_prevu ?? '—', color: C.green, big: true },
          { label: 'Début prévu',     value: rec.heure_debut    || '—', color: C.blue,  big: true },
          { label: 'Durée T1-T2',    value: rec.duree_t12_min != null ? `${rec.duree_t12_min} min` : '—', color: C.text },
          { label: 'Durée T3+',      value: rec.duree_t3p_min != null ? `${rec.duree_t3p_min} min` : '—', color: C.text },
          { label: 'Repos initial',  value: rec.repos_initial_min != null ? `${rec.repos_initial_min} min` : '—', color: C.text },
          { label: 'Seuil drainage', value: rec.seuil_drainage_pct != null ? `${rec.seuil_drainage_pct}%` : '—', color: C.amber },
        ].map(s => (
          <div key={s.label} style={{
            background: dark ? '#0d1610' : '#f4f9f5',
            border: `1px solid ${C.border}`, borderRadius: 8,
            padding: '8px 10px',
          }}>
            <div style={{ fontSize: 9, color: C.textDim, textTransform: 'uppercase',
              letterSpacing: '0.06em', marginBottom: 3 }}>{s.label}</div>
            <div style={{ fontSize: s.big ? 20 : 13, fontWeight: 700, color: s.color }}>
              {s.value}
            </div>
          </div>
        ))}
      </div>

      {/* Progression */}
      {rec.nb_tours_prevu > 0 && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10,
            color: C.textDim, marginBottom: 5 }}>
            <span>Tours effectués</span>
            <span style={{ fontWeight: 700, color: C.green }}>
              {rec.nb_tours_reel || 0} / {rec.nb_tours_prevu}
            </span>
          </div>
          <div style={{ height: 6, borderRadius: 3, background: C.border, overflow: 'hidden' }}>
            <div style={{
              height: '100%', borderRadius: 3, background: C.green,
              width: `${Math.min(100, ((rec.nb_tours_reel || 0) / rec.nb_tours_prevu) * 100)}%`,
              transition: 'width 0.5s ease',
            }} />
          </div>
        </div>
      )}
    </div>
  )
}

function NPKCard({ rec, C, dark }) {
  if (!rec?.doses_npk) return null
  const npk = rec.doses_npk
  const canaux = [
    { key: 'canal_A_g', label: 'Canal A (KNO₃)', color: '#34d96f',  note: 'N + K' },
    { key: 'canal_B_g', label: 'Canal B (Ca·NO₃)', color: '#4d9de0', note: 'Calcium' },
    { key: 'canal_C_g', label: 'Canal C (MgSO₄)', color: '#b197fc', note: 'Magnésium' },
    { key: 'canal_D_g', label: 'Canal D (K₂SO₄)', color: '#f5a623', note: 'K supplém.' },
  ]
  return (
    <div style={{
      background: C.surface, border: `1.5px solid ${C.border}`,
      borderRadius: 12, padding: '14px 16px',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <FlaskConical size={14} color='#b197fc' strokeWidth={2} />
        <span style={{ fontSize: 11, fontWeight: 700, color: C.textMuted,
          textTransform: 'uppercase', letterSpacing: '0.08em' }}>
          Doses NPK / cycle
        </span>
        <span style={{ marginLeft: 'auto', fontSize: 10, color: C.textDim }}>
          EC cible : {rec.ec_cible_dSm ?? '—'} dS/m
        </span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
        {canaux.map(c => {
          const val = npk[c.key]
          const max = Math.max(...canaux.map(x => npk[x.key] || 0))
          const pct = max > 0 ? (val / max) * 100 : 0
          return (
            <div key={c.key} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ width: 80, fontSize: 10, color: C.textMuted, flexShrink: 0 }}>
                {c.label}
              </div>
              <div style={{ flex: 1, height: 8, borderRadius: 4, background: C.border, overflow: 'hidden' }}>
                <div style={{
                  height: '100%', borderRadius: 4, background: c.color,
                  width: `${pct}%`, transition: 'width 0.5s ease',
                  boxShadow: `0 0 6px ${c.color}60`,
                }} />
              </div>
              <div style={{ width: 52, fontSize: 11, fontWeight: 700, color: c.color,
                textAlign: 'right', flexShrink: 0 }}>
                {val != null ? `${val}g` : '—'}
              </div>
            </div>
          )
        })}
        <div style={{ marginTop: 4, padding: '7px 10px',
          background: dark ? 'rgba(52,217,111,0.06)' : 'rgba(24,120,63,0.04)',
          border: `1px solid ${C.green}25`, borderRadius: 7,
          fontSize: 10, color: C.textMuted,
        }}>
          EC à ajouter : <strong style={{ color: C.green }}>{npk.ec_ajouter ?? '—'} dS/m</strong>
          {' '}· Dose totale : <strong style={{ color: C.green }}>{npk.dose_totale_g ?? '—'} g</strong>
          {' '}· Conc. : <strong style={{ color: C.green }}>{npk.concentration_g_L ?? '—'} g/L</strong>
        </div>
      </div>
    </div>
  )
}

function AjustementPanel({ ajustements, C, dark }) {
  if (!ajustements || ajustements.length === 0) return (
    <div style={{ textAlign: 'center', padding: '24px 0',
      color: C.textDim, fontSize: 12, fontStyle: 'italic' }}>
      Aucun ajustement encore — en attente du premier tour
    </div>
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {[...ajustements].reverse().map((a, i) => {
        const cfg = ACTION_COLORS[a.action] || { color: C.textMuted, bg: C.toggleBg, icon: Info }
        const AIcon = cfg.icon
        return (
          <div key={i} style={{
            background: cfg.bg,
            border: `1.5px solid ${cfg.color}35`,
            borderRadius: 10, padding: '11px 14px',
            display: 'flex', flexDirection: 'column', gap: 6,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{
                width: 26, height: 26, borderRadius: 7,
                background: cfg.color + '20',
                border: `1px solid ${cfg.color}40`,
                display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
              }}>
                <AIcon size={13} color={cfg.color} strokeWidth={2.5} />
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ fontSize: 11, fontWeight: 800, color: cfg.color }}>
                    Tour {a.tour}
                  </span>
                  <span style={{
                    fontSize: 10, fontWeight: 700, color: cfg.color,
                    background: cfg.color + '18',
                    border: `1px solid ${cfg.color}35`,
                    borderRadius: 4, padding: '1px 7px',
                  }}>
                    {a.action}
                  </span>
                  {a.drainage_reel != null && (
                    <span style={{ marginLeft: 'auto', fontSize: 10, color: C.textDim }}>
                      Drain : <strong style={{ color: cfg.color }}>{a.drainage_reel.toFixed(1)}%</strong>
                    </span>
                  )}
                </div>
                <div style={{ fontSize: 11, color: C.textMuted, marginTop: 3 }}>
                  {a.raison}
                </div>
              </div>
            </div>
            {!a.stop && (
              <div style={{ display: 'flex', gap: 12, paddingLeft: 34, fontSize: 11 }}>
                <span style={{ color: C.textDim }}>
                  Repos suivant :
                  <strong style={{ color: C.text, marginLeft: 4 }}>
                    {a.repos_suivant_min} min
                  </strong>
                </span>
                <span style={{ color: C.textDim }}>
                  Durée suivante :
                  <strong style={{ color: C.text, marginLeft: 4 }}>
                    {a.duree_suivant_min} min
                  </strong>
                </span>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

function TourTableMini({ tours, C, dark }) {
  if (!tours || tours.length === 0) return null
  const valids = tours.filter(t => t.debut !== null)
  if (valids.length === 0) return null

  return (
    <div style={{
      background: C.surface, border: `1.5px solid ${C.border}`,
      borderRadius: 12, overflow: 'hidden',
    }}>
      <div style={{ padding: '10px 14px', borderBottom: `1px solid ${C.border}`,
        fontSize: 11, fontWeight: 700, color: C.textMuted,
        textTransform: 'uppercase', letterSpacing: '0.08em',
        display: 'flex', alignItems: 'center', gap: 6,
      }}>
        <Clock size={12} color={C.green} strokeWidth={2} />
        Tours réels aujourd'hui ({valids.length})
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: 'inherit', fontSize: 11 }}>
          <thead>
            <tr style={{ background: dark ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.02)' }}>
              {['N°', 'Début', 'Fin', 'Durée', 'Rad.', 'Cumul Rad.', 'EC Apport'].map(h => (
                <th key={h} style={{ padding: '6px 10px', textAlign: 'center',
                  color: C.textDim, fontWeight: 630, fontSize: 10,
                  textTransform: 'uppercase', letterSpacing: '0.04em',
                  borderBottom: `1px solid ${C.border}` }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {valids.map((t, i) => (
              <tr key={i}
                style={{ borderBottom: i < valids.length - 1 ? `1px solid ${C.border}` : 'none' }}
                onMouseEnter={e => e.currentTarget.style.background = C.tableHover}
                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
              >
                <td style={{ padding: '7px 10px', textAlign: 'center' }}>
                  <div style={{ width: 22, height: 22, borderRadius: 5, margin: '0 auto',
                    background: `${C.green}15`, border: `1px solid ${C.green}30`,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 11, fontWeight: 800, color: C.green }}>
                    {t.tour_num}
                  </div>
                </td>
                <td style={{ padding: '7px 10px', textAlign: 'center', color: C.text, fontWeight: 630 }}>
                  {t.debut || '—'}
                </td>
                <td style={{ padding: '7px 10px', textAlign: 'center', color: C.textMuted }}>
                  {t.fin || '—'}
                </td>
                <td style={{ padding: '7px 10px', textAlign: 'center', color: C.text }}>
                  {t.duree_min != null ? `${t.duree_min} min` : '—'}
                </td>
                <td style={{ padding: '7px 10px', textAlign: 'center', color: '#f5e642' }}>
                  {t.radiation_sum != null ? t.radiation_sum.toFixed(1) : '—'}
                </td>
                <td style={{ padding: '7px 10px', textAlign: 'center', color: '#f5a623' }}>
                  {t.cumul_radiation != null ? t.cumul_radiation.toFixed(1) : '—'}
                </td>
                <td style={{ padding: '7px 10px', textAlign: 'center', color: C.green }}>
                  {t.ec_apport != null ? t.ec_apport.toFixed(2) : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function ConfigModal({ deviceId, token, onClose, C, dark }) {
  const [cfg, setCfg] = useState(null)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({
    date_plantation: '',
    ec_eau_brute: '',
    methode_decision: 'hybride',
    actif: true,
  })

  useEffect(() => {
    getAIConfig(token, deviceId).then(c => {
      setCfg(c)
      setForm({
        date_plantation : c.date_plantation || '',
        ec_eau_brute    : c.ec_eau_brute ?? 0.8,
        methode_decision: c.methode_decision || 'hybride',
        actif           : c.actif !== false,
      })
    }).catch(() => {})
  }, [deviceId])

  const handleSave = async () => {
    setSaving(true)
    try {
      await saveAIConfig(token, deviceId, {
        date_plantation : form.date_plantation || null,
        ec_eau_brute    : Number(form.ec_eau_brute) || 0.8,
        methode_decision: form.methode_decision,
        actif           : form.actif,
      })
      onClose()
    } catch (e) {
      alert(e.message)
    } finally {
      setSaving(false)
    }
  }

  const inputSt = {
    width: '100%', padding: '8px 10px', borderRadius: 8,
    border: `1.5px solid ${C.border}`, background: C.inputBg,
    color: C.text, fontSize: 12, fontFamily: 'inherit', outline: 'none',
  }
  const labelSt = {
    display: 'block', color: C.textMuted, fontSize: 10, fontWeight: 700,
    textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 5,
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 99999, background: 'rgba(0,0,0,0.7)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24,
    }}>
      <div style={{
        background: C.card, border: `1.5px solid ${C.border}`,
        borderRadius: 16, padding: '24px 28px', width: '100%', maxWidth: 440,
        boxShadow: '0 24px 80px rgba(0,0,0,0.5)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20 }}>
          <Settings size={16} color={C.green} strokeWidth={2} />
          <div style={{ fontSize: 14, fontWeight: 800, color: C.text }}>
            Configuration IA — Device {deviceId}
          </div>
          <button onClick={onClose} style={{ marginLeft: 'auto', background: 'none',
            border: 'none', cursor: 'pointer', color: C.textDim }}>
            <X size={16} strokeWidth={2} />
          </button>
        </div>

        {!cfg ? (
          <div style={{ textAlign: 'center', color: C.textDim, padding: 24 }}>Chargement…</div>
        ) : (
          <>
            <div style={{ marginBottom: 14 }}>
              <label style={labelSt}>Date de plantation</label>
              <input type="date" value={form.date_plantation}
                onChange={e => setForm(p => ({...p, date_plantation: e.target.value}))}
                style={inputSt} />
            </div>
            <div style={{ marginBottom: 14 }}>
              <label style={labelSt}>EC eau brute bassin (dS/m)</label>
              <input type="number" step="0.1" value={form.ec_eau_brute}
                onChange={e => setForm(p => ({...p, ec_eau_brute: e.target.value}))}
                style={inputSt} />
            </div>
            <div style={{ marginBottom: 14 }}>
              <label style={labelSt}>Méthode de décision</label>
              <select value={form.methode_decision}
                onChange={e => setForm(p => ({...p, methode_decision: e.target.value}))}
                style={{ ...inputSt, cursor: 'pointer' }}>
                <option value="hybride">Hybride (règles + ML)</option>
                <option value="regles">Règles agronomiques uniquement</option>
                <option value="ml_seul">ML uniquement</option>
              </select>
            </div>
            <div style={{ marginBottom: 20 }}>
              <label style={labelSt}>Agent IA actif</label>
              <div style={{ display: 'flex', gap: 8 }}>
                {[true, false].map(v => (
                  <button key={String(v)}
                    onClick={() => setForm(p => ({...p, actif: v}))}
                    style={{
                      flex: 1, padding: '8px', borderRadius: 7, fontFamily: 'inherit',
                      border: `1.5px solid ${form.actif === v ? C.green : C.border}`,
                      background: form.actif === v ? `${C.green}15` : 'transparent',
                      color: form.actif === v ? C.green : C.textMuted,
                      fontSize: 12, fontWeight: 630, cursor: 'pointer',
                    }}>
                    {v ? 'Activé' : 'Désactivé'}
                  </button>
                ))}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button onClick={onClose} style={{
                padding: '8px 18px', borderRadius: 8,
                border: `1.5px solid ${C.border}`, background: 'transparent',
                color: C.textMuted, fontSize: 12, fontFamily: 'inherit', cursor: 'pointer',
              }}>Annuler</button>
              <button onClick={handleSave} disabled={saving} style={{
                display: 'flex', alignItems: 'center', gap: 6,
                padding: '8px 20px', borderRadius: 8,
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

function AjustementManuelModal({ deviceId, token, numTour, onClose, C, dark, onSuccess }) {
  const [drainage, setDrainage] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  const handleSubmit = async () => {
    setSubmitting(true); setError('')
    try {
      await ajusterTour(token, deviceId, {
        num_tour      : numTour,
        drainage_reel : drainage !== '' ? Number(drainage) : null,
        tours_restants: 1,
      })
      onSuccess()
      onClose()
    } catch (e) {
      setError(e.message)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 99999, background: 'rgba(0,0,0,0.7)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24,
    }}>
      <div style={{
        background: C.card, border: `1.5px solid ${C.border}`,
        borderRadius: 16, padding: '24px 28px', width: '100%', maxWidth: 380,
        boxShadow: '0 24px 80px rgba(0,0,0,0.5)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20 }}>
          <Brain size={15} color={C.green} strokeWidth={2} />
          <div style={{ fontSize: 14, fontWeight: 800, color: C.text }}>
            Ajustement après Tour {numTour}
          </div>
          <button onClick={onClose} style={{ marginLeft: 'auto', background: 'none',
            border: 'none', cursor: 'pointer', color: C.textDim }}>
            <X size={16} strokeWidth={2} />
          </button>
        </div>

        <div style={{ marginBottom: 16 }}>
          <label style={{ display: 'block', color: C.textMuted, fontSize: 10, fontWeight: 700,
            textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>
            % Drainage mesuré (laisser vide si capteur absent)
          </label>
          <input type="number" step="0.1" min="0" max="100"
            value={drainage}
            onChange={e => setDrainage(e.target.value)}
            placeholder="Ex: 18.5 — ou vide si pas de capteur"
            style={{
              width: '100%', padding: '9px 12px', borderRadius: 8,
              border: `1.5px solid ${C.border}`, background: C.inputBg,
              color: C.text, fontSize: 12, fontFamily: 'inherit', outline: 'none',
            }} />
          <div style={{ fontSize: 10, color: C.textDim, marginTop: 6 }}>
            💡 Sans drainage : l'IA utilisera uniquement la progression temporelle.
          </div>
        </div>

        {error && (
          <div style={{ padding: '8px 12px', borderRadius: 7, background: 'rgba(240,82,82,0.08)',
            border: `1px solid #f0525235`, color: '#f05252', fontSize: 11, marginBottom: 12 }}>
            {error}
          </div>
        )}

        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={{
            padding: '8px 18px', borderRadius: 8,
            border: `1.5px solid ${C.border}`, background: 'transparent',
            color: C.textMuted, fontSize: 12, fontFamily: 'inherit', cursor: 'pointer',
          }}>Annuler</button>
          <button onClick={handleSubmit} disabled={submitting} style={{
            display: 'flex', alignItems: 'center', gap: 6,
            padding: '8px 20px', borderRadius: 8,
            background: submitting ? C.toggleBg : C.green, color: '#fff',
            border: 'none', fontSize: 12, fontWeight: 700,
            fontFamily: 'inherit', cursor: submitting ? 'not-allowed' : 'pointer',
          }}>
            <Brain size={12} strokeWidth={2.5} />
            {submitting ? 'Calcul…' : 'Calculer ajustement'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────
// MAIN PAGE
// ─────────────────────────────────────────────────────────────

export default function AgentIAPage({ token, auth, C: CProps, dark }) {
  const C = CProps || getColors(dark)
  const width = useWindowWidth()
  const isMobile = width < 640
  const isTablet = width >= 640 && width < 900

  const [farms, setFarms] = useState([])
  const [selectedDeviceId, setSelectedDeviceId] = useState(null)
  const [rec, setRec] = useState(null)
  const [tours, setTours] = useState([])
  const [loading, setLoading] = useState(false)
  const [generating, setGenerating] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [showConfig, setShowConfig] = useState(false)
  const [showAjustModal, setShowAjustModal] = useState(false)
  const [ajustTour, setAjustTour] = useState(1)
  const [error, setError] = useState('')
  const [activeTab, setActiveTab] = useState('plan') // plan | npk | ajustements | tours
  const [ecBassinInput, setEcBassinInput] = useState('')
  const [ressuyageInput, setRessuyageInput] = useState('')
  const intervalRef = useRef(null)

  const today = new Date().toISOString().split('T')[0]

  // Charger les fermes
  useEffect(() => {
    getDevices(token).then(data => {
      setFarms(data)
      // Sélectionner le premier device disponible
      if (data.length > 0 && data[0].houses?.length > 0) {
        setSelectedDeviceId(data[0].houses[0].id)
      }
    }).catch(() => {})
  }, [token])

  const loadRec = useCallback(async (silent = false) => {
    if (!selectedDeviceId) return
    if (!silent) setLoading(true)
    else setRefreshing(true)
    setError('')
    try {
      const [recData, toursData] = await Promise.all([
        getAIRec(token, selectedDeviceId, today),
        getDeviceTours(token, selectedDeviceId, today),
      ])
      setRec(recData)
      setTours(toursData?.tours || [])
    } catch (e) {
      if (!silent) setError(e.message)
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [selectedDeviceId, token, today])

  useEffect(() => {
    if (selectedDeviceId) loadRec()
  }, [selectedDeviceId])

  // Refresh automatique toutes les 30s
  useEffect(() => {
    intervalRef.current = setInterval(() => loadRec(true), 30_000)
    return () => clearInterval(intervalRef.current)
  }, [loadRec])

  const handleGenerer = async () => {
    setGenerating(true); setError('')
    try {
      const payload = { methode: 'hybride' }
      if (ecBassinInput) payload.ec_bassin = Number(ecBassinInput)
      if (ressuyageInput) payload.pct_ressuyage = Number(ressuyageInput)
      const result = await genererRec(token, selectedDeviceId, payload)
      setRec(result.recommandation)
    } catch (e) {
      setError(e.message)
    } finally {
      setGenerating(false)
    }
  }

  const handleAjustSuccess = () => loadRec()

  // Trouver le nom du device sélectionné
  const selectedFarm = farms.find(f => f.houses?.some(h => h.id === selectedDeviceId))
  const selectedHouse = selectedFarm?.houses?.find(h => h.id === selectedDeviceId)

  const tabs = [
    { id: 'plan',         label: 'Plan',      icon: Activity },
    { id: 'npk',          label: 'NPK',        icon: FlaskConical },
    { id: 'ajustements',  label: 'Ajustements', icon: Brain },
    { id: 'tours',        label: 'Tours réels', icon: Clock },
  ]

  return (
    <div style={{ animation: 'az-fade-in 0.3s ease both' }}>

      {/* ── Modals ──────────────────────────────────────────── */}
      {showConfig && selectedDeviceId && (
        <ConfigModal deviceId={selectedDeviceId} token={token}
          onClose={() => { setShowConfig(false); loadRec() }}
          C={C} dark={dark} />
      )}
      {showAjustModal && selectedDeviceId && (
        <AjustementManuelModal
          deviceId={selectedDeviceId} token={token} numTour={ajustTour}
          onClose={() => setShowAjustModal(false)}
          onSuccess={handleAjustSuccess}
          C={C} dark={dark} />
      )}

      {/* ── Header ──────────────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: isMobile ? 'flex-start' : 'center',
        flexDirection: isMobile ? 'column' : 'row',
        justifyContent: 'space-between', marginBottom: 24, gap: 12 }}>
        <div>
          <h1 style={{ fontSize: isMobile ? 18 : 22, fontWeight: 900, color: C.text,
            marginBottom: 4, display: 'flex', alignItems: 'center', gap: 10 }}>
            <Brain size={isMobile ? 18 : 22} color={C.green} strokeWidth={2} />
            Agent IA Irrigation
          </h1>
          <p style={{ fontSize: 11, color: C.textDim }}>
            Recommandations automatiques · {farms.reduce((a,f)=>(a+f.houses?.length||0),0)} houses actives
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button onClick={() => loadRec(true)} disabled={refreshing}
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '7px 14px', borderRadius: 8,
              border: `1px solid ${dark ? '#1c2e22' : '#c0d8c8'}`,
              background: C.toggleBg, color: C.textMuted,
              fontSize: 12, fontWeight: 630, fontFamily: 'inherit', cursor: 'pointer',
            }}>
            <RefreshCw size={12} strokeWidth={2}
              style={{ animation: refreshing ? 'az-spin 0.7s linear infinite' : 'none' }} />
            {!isMobile && 'Actualiser'}
          </button>
          {selectedDeviceId && (
            <button onClick={() => setShowConfig(true)}
              style={{
                display: 'flex', alignItems: 'center', gap: 6,
                padding: '7px 14px', borderRadius: 8,
                border: `1px solid ${dark ? '#1c2e22' : '#c0d8c8'}`,
                background: C.toggleBg, color: C.textMuted,
                fontSize: 12, fontWeight: 630, fontFamily: 'inherit', cursor: 'pointer',
              }}>
              <Settings size={12} strokeWidth={2} />
              {!isMobile && 'Config IA'}
            </button>
          )}
        </div>
      </div>

      <div style={{ display: 'flex', gap: 20, flexDirection: isMobile ? 'column' : 'row' }}>

        {/* ── Sidebar : sélecteur houses ───────────────────── */}
        <div style={{
          width: isMobile ? '100%' : 200, flexShrink: 0,
          display: 'flex', flexDirection: isMobile ? 'row' : 'column',
          gap: 6, flexWrap: isMobile ? 'wrap' : 'nowrap',
        }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: C.textDim,
            textTransform: 'uppercase', letterSpacing: '0.08em',
            marginBottom: isMobile ? 0 : 6,
            display: isMobile ? 'none' : 'block' }}>
            Sélectionner une house
          </div>
          {farms.map(farm => (
            farm.houses?.map(house => {
              const active = house.id === selectedDeviceId
              return (
                <button key={house.id}
                  onClick={() => setSelectedDeviceId(house.id)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 7,
                    padding: '8px 12px', borderRadius: 8,
                    border: `1.5px solid ${active ? C.green : C.border}`,
                    background: active ? `${C.green}12` : C.surface,
                    color: active ? C.green : C.textMuted,
                    fontSize: 12, fontWeight: active ? 700 : 500,
                    fontFamily: 'inherit', cursor: 'pointer',
                    textAlign: 'left', transition: 'all 0.15s',
                    width: isMobile ? 'auto' : '100%',
                  }}>
                  <div style={{
                    width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
                    background: active ? C.green : C.textDim,
                  }} />
                  <div>
                    <div style={{ fontSize: 10, color: active ? C.green : C.textDim,
                      fontWeight: 600, lineHeight: 1 }}>
                      {farm.farm_name}
                    </div>
                    <div style={{ fontWeight: active ? 800 : 600, lineHeight: 1.3 }}>
                      H{house.house_number}
                    </div>
                  </div>
                </button>
              )
            })
          ))}
        </div>

        {/* ── Main content ─────────────────────────────────── */}
        <div style={{ flex: 1, minWidth: 0 }}>

          {/* Device header */}
          {selectedHouse && (
            <div style={{
              background: C.surface, border: `1.5px solid ${C.border}`,
              borderRadius: 12, padding: '12px 16px', marginBottom: 16,
              display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
            }}>
              <div>
                <div style={{ fontSize: 14, fontWeight: 800, color: C.text }}>
                  {selectedFarm?.farm_name} — Station {selectedHouse.house_number}
                </div>
                <div style={{ fontSize: 11, color: C.textDim, marginTop: 2 }}>
                  {today} · Méthode : {rec?.methode_decision || 'hybride'}
                  {rec && !rec.pct_ressuyage && (
                    <span style={{ marginLeft: 8, color: C.amber, fontSize: 10 }}>
                      ⚠ Mode dégradé — pas de capteur poids/drainage
                    </span>
                  )}
                </div>
              </div>

              {/* Quick inputs */}
              <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                  <span style={{ fontSize: 10, color: C.textDim, whiteSpace: 'nowrap' }}>EC bassin :</span>
                  <input type="number" step="0.1" placeholder="0.8"
                    value={ecBassinInput}
                    onChange={e => setEcBassinInput(e.target.value)}
                    style={{
                      width: 58, padding: '4px 6px', borderRadius: 6,
                      border: `1.5px solid ${C.border}`, background: C.inputBg,
                      color: C.text, fontSize: 11, fontFamily: 'inherit', outline: 'none',
                    }} />
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                  <span style={{ fontSize: 10, color: C.textDim, whiteSpace: 'nowrap' }}>Ressuyage % :</span>
                  <input type="number" step="0.1" placeholder="optionnel"
                    value={ressuyageInput}
                    onChange={e => setRessuyageInput(e.target.value)}
                    style={{
                      width: 70, padding: '4px 6px', borderRadius: 6,
                      border: `1.5px solid ${C.border}`, background: C.inputBg,
                      color: C.text, fontSize: 11, fontFamily: 'inherit', outline: 'none',
                    }} />
                </div>
                <button onClick={handleGenerer} disabled={generating}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 5,
                    padding: '6px 14px', borderRadius: 8,
                    background: generating ? C.toggleBg : C.green, color: '#fff',
                    border: 'none', fontSize: 12, fontWeight: 700,
                    fontFamily: 'inherit', cursor: generating ? 'not-allowed' : 'pointer',
                  }}>
                  <Brain size={12} strokeWidth={2.5} />
                  {generating ? 'Génération…' : rec ? 'Régénérer' : 'Générer'}
                </button>
              </div>
            </div>
          )}

          {/* Error */}
          {error && (
            <div style={{ padding: '10px 14px', borderRadius: 8,
              background: 'rgba(240,82,82,0.08)', border: '1px solid rgba(240,82,82,0.25)',
              color: '#f05252', fontSize: 12, marginBottom: 14 }}>
              ⚠ {error}
            </div>
          )}

          {/* Loading */}
          {loading && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10,
              color: C.textDim, fontSize: 12, padding: '40px 0',
              justifyContent: 'center' }}>
              <RefreshCw size={16} style={{ animation: 'az-pulse 1.2s ease-in-out infinite' }} />
              Chargement de la recommandation IA…
            </div>
          )}

          {!loading && !selectedDeviceId && (
            <div style={{ textAlign: 'center', padding: '60px 0', color: C.textDim, fontSize: 12 }}>
              Sélectionnez une house pour voir la recommandation IA
            </div>
          )}

          {!loading && selectedDeviceId && !rec && !error && (
            <div style={{ textAlign: 'center', padding: '60px 0', color: C.textDim, fontSize: 12 }}>
              <Brain size={32} strokeWidth={1.2} style={{ marginBottom: 12, display: 'block', margin: '0 auto 12px' }} />
              Aucune recommandation générée. Cliquez sur <strong style={{ color: C.green }}>Générer</strong> pour démarrer.
            </div>
          )}

          {!loading && rec && (
            <>
              {/* Météo toujours visible en haut */}
              <MeteoCard rec={rec} C={C} dark={dark} />

              <div style={{ marginTop: 14 }}>

                {/* Tabs */}
                <div style={{ display: 'flex', gap: 4, marginBottom: 14,
                  borderBottom: `1px solid ${C.border}`, paddingBottom: 0 }}>
                  {tabs.map(tab => {
                    const active = activeTab === tab.id
                    const TabIcon = tab.icon
                    return (
                      <button key={tab.id} onClick={() => setActiveTab(tab.id)}
                        style={{
                          display: 'flex', alignItems: 'center', gap: 5,
                          padding: '8px 14px', border: 'none',
                          borderBottom: `2.5px solid ${active ? C.green : 'transparent'}`,
                          background: 'transparent',
                          color: active ? C.green : C.textMuted,
                          fontSize: 12, fontWeight: active ? 700 : 500,
                          fontFamily: 'inherit', cursor: 'pointer',
                          transition: 'all 0.15s',
                          marginBottom: -1,
                        }}>
                        <TabIcon size={12} strokeWidth={2} />
                        {tab.label}
                        {tab.id === 'ajustements' && rec.ajustements?.length > 0 && (
                          <span style={{
                            background: C.green, color: '#fff',
                            borderRadius: 10, padding: '0 5px',
                            fontSize: 9, fontWeight: 800, marginLeft: 2,
                          }}>{rec.ajustements.length}</span>
                        )}
                      </button>
                    )
                  })}
                </div>

                {/* Tab content */}
                {activeTab === 'plan' && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                    <PlanCard rec={rec} C={C} dark={dark} />

                    {/* Bouton ajustement manuel */}
                    <div style={{
                      background: C.surface, border: `1.5px solid ${C.border}`,
                      borderRadius: 12, padding: '14px 16px',
                    }}>
                      <div style={{ fontSize: 11, fontWeight: 700, color: C.textMuted,
                        textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 10 }}>
                        Ajustement manuel après tour
                      </div>
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                        <span style={{ fontSize: 12, color: C.textMuted }}>Tour numéro :</span>
                        <input type="number" min="1" max="20" value={ajustTour}
                          onChange={e => setAjustTour(Number(e.target.value))}
                          style={{
                            width: 60, padding: '5px 8px', borderRadius: 7,
                            border: `1.5px solid ${C.border}`, background: C.inputBg,
                            color: C.text, fontSize: 12, fontFamily: 'inherit', outline: 'none',
                          }} />
                        <button onClick={() => setShowAjustModal(true)}
                          style={{
                            display: 'flex', alignItems: 'center', gap: 6,
                            padding: '7px 16px', borderRadius: 8,
                            background: `${C.green}12`,
                            border: `1.5px solid ${C.green}40`,
                            color: C.green, fontSize: 12, fontWeight: 700,
                            fontFamily: 'inherit', cursor: 'pointer',
                          }}>
                          <Brain size={12} strokeWidth={2.5} />
                          Calculer ajustement
                        </button>
                        <span style={{ fontSize: 10, color: C.textDim }}>
                          💡 Pendant le repos inter-tour, saisissez le drainage mesuré
                          (ou laissez vide si pas de capteur).
                        </span>
                      </div>
                    </div>
                  </div>
                )}

                {activeTab === 'npk' && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                    <NPKCard rec={rec} C={C} dark={dark} />
                    {/* Explication FAO-56 */}
                    {rec.et0_mm && (
                      <div style={{
                        background: C.surface, border: `1.5px solid ${C.border}`,
                        borderRadius: 12, padding: '14px 16px',
                      }}>
                        <div style={{ fontSize: 11, fontWeight: 700, color: C.textMuted,
                          textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 10 }}>
                          Calculs FAO-56
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr 1fr' : 'repeat(4, 1fr)', gap: 8 }}>
                          {[
                            { label: 'ET0 (Penman)', value: `${rec.et0_mm} mm/j`, color: '#4d9de0' },
                            { label: 'ETc cultural', value: `${rec.etc_mm} mm/j`,  color: C.green },
                            { label: 'Fraction lessivage', value: `${((rec.fraction_lessivage||0)*100).toFixed(0)}%`, color: C.amber },
                            { label: 'Volume total',  value: rec.volume_total_l_ha
                              ? `${(rec.volume_total_l_ha/1000).toFixed(1)} m³/ha` : '—', color: C.green },
                          ].map(s => (
                            <div key={s.label} style={{
                              background: dark ? '#0d1610' : '#f4f9f5',
                              border: `1px solid ${C.border}`, borderRadius: 8, padding: '10px 12px',
                            }}>
                              <div style={{ fontSize: 9, color: C.textDim, textTransform: 'uppercase',
                                letterSpacing: '0.05em', marginBottom: 4 }}>{s.label}</div>
                              <div style={{ fontSize: 16, fontWeight: 800, color: s.color }}>{s.value}</div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {activeTab === 'ajustements' && (
                  <div style={{
                    background: C.surface, border: `1.5px solid ${C.border}`,
                    borderRadius: 12, padding: '14px 16px',
                  }}>
                    <div style={{ fontSize: 11, fontWeight: 700, color: C.textMuted,
                      textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 12 }}>
                      Historique des ajustements du jour
                    </div>
                    <AjustementPanel ajustements={rec.ajustements} C={C} dark={dark} />
                  </div>
                )}

                {activeTab === 'tours' && (
                  <TourTableMini tours={tours} C={C} dark={dark} />
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}