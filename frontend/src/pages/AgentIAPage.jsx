// ============================================================
// frontend/src/pages/AgentIAPage.jsx
// Agent IA Irrigation — Recommandations ML + PRT par ferme/house
// Projet Azura Irrigation IA — GOUSSA Oussama
// ============================================================

import { useState, useEffect, useRef, useCallback } from 'react'
import {
  Brain, RefreshCw, Calendar, Sun, Droplets, Thermometer,
  Gauge, Clock, ChevronDown, ChevronRight, ChevronLeft, WifiOff,
  AlertTriangle, CheckCircle2, XCircle, ArrowRight, Eye, Settings, X,
  Zap, CloudRain, CloudFog, Flame, Cloud, CloudSnow, HelpCircle,
  CalendarDays, MapPin, Save, Play, Square, Check, AlertCircle,
  Cloudy, CloudSun
} from 'lucide-react'
import { createPortal } from 'react-dom'
import { getColors } from '../theme.js'
import { useWindowWidth } from '../components/DashboardShell.jsx'
import { getDevices, getAccessToken, getRecommandation, getAIConfig, updateAIConfig } from '../api/client.js'
import { postDecisionTour, getDecisionsTour } from '../api/client.js'

// ── Helpers (même logique que ZonePage.jsx) ────────────────────
function fmtDisplay(d) {
  if (!d) return ''
  const [y, m, day] = d.split('-')
  return `${day}/${m}/${y}`
}

function today() {
  return new Date().toISOString().split('T')[0]
}

const SCENARIO_ICONS = {
  '1_TRES_ENSOLEILLE':  { icon: Sun,       label: 'Très ensoleillé',  color: '#f59e0b' },
  '2_ENSOLEILLE':       { icon: CloudSun,  label: 'Ensoleillé',       color: '#f59e0b' },
  '5_BROUILLARD_MATIN': { icon: CloudFog,  label: 'Brouillard matin', color: '#94a3b8' },
  '5b_FOG_CHAUD_VPD':   { icon: CloudFog,  label: 'Fog chaud VPD',    color: '#94a3b8' },
  '5c_FOG_CHAUD_RS':    { icon: CloudFog,  label: 'Fog chaud RS',     color: '#94a3b8' },
  '5d_FOG_RADIATION':   { icon: CloudFog,  label: 'Fog radiation',    color: '#94a3b8' },
  '5e_FOG_FROID':       { icon: CloudSnow, label: 'Fog froid',        color: '#7dd3fc' },
  '6_CHERGUI_URGENT':   { icon: Flame,     label: 'Chergui urgent',   color: '#ef4444' },
  '7_PLUIE_STOP':       { icon: CloudRain, label: 'Pluie stop',       color: '#3b82f6' },
  '7b_PLUIE_LEGERE':    { icon: CloudRain, label: 'Pluie légère',     color: '#60a5fa' },
  '8_NUAGEUX_CHAUD':    { icon: Cloud,     label: 'Nuageux chaud',    color: '#a78bfa' },
  '9_NUIT_FROIDE_SOL':  { icon: CloudSnow, label: 'Nuit froide sol',  color: '#7dd3fc' },
  'default':            { icon: HelpCircle,label: 'Défaut',           color: '#94a3b8' },
}

function ScenarioLabel({ s }) {
  const cfg = SCENARIO_ICONS[s] || SCENARIO_ICONS['default']
  const Icon = cfg.icon
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
      <Icon size={11} color={cfg.color} strokeWidth={2} />
      <span>{cfg.label}</span>
    </span>
  )
}

function scenarioLabel(s) {
  const cfg = SCENARIO_ICONS[s] || SCENARIO_ICONS['default']
  return cfg.label
}

// ── TourCalendar — même composant que ZonePage.jsx ─────────────
const MONTHS_FR = ['Janvier','Février','Mars','Avril','Mai','Juin','Juillet','Août','Septembre','Octobre','Novembre','Décembre']
const DAYS_FR   = ['Lu','Ma','Me','Je','Ve','Sa','Di']

function TourCalendar({ value, onChange, C, dark }) {
  const todayStr = today()
  const [viewDate, setView] = useState(() => value ? new Date(value + 'T00:00:00') : new Date())
  const year  = viewDate.getFullYear()
  const month = viewDate.getMonth()

  let startDow = new Date(year, month, 1).getDay() - 1
  if (startDow < 0) startDow = 6
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const daysInPrev  = new Date(year, month, 0).getDate()
  const cells = []
  for (let i = 0; i < startDow; i++) cells.push({ day: daysInPrev - startDow + 1 + i, curr: false })
  for (let i = 1; i <= daysInMonth; i++) cells.push({ day: i, curr: true })
  const rem = (7 - (cells.length % 7)) % 7
  for (let i = 1; i <= rem; i++) cells.push({ day: i, curr: false })

  const isToday = (d) =>
    cells.some(c => c.curr && c.day === d && `${year}-${String(month+1).padStart(2,'0')}-${String(d).padStart(2,'0')}` === todayStr)

  const isSelected = (d) =>
    value === `${year}-${String(month+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`

  const pick = (d) => {
    if (!d) return
    const ds = `${year}-${String(month+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`
    onChange(ds)
  }

  return (
    <div style={{ width: 248, fontFamily: 'inherit' }}>
      {/* Month nav */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        marginBottom: 10, padding: '0 4px',
      }}>
        <button onClick={() => setView(new Date(year, month - 1, 1))} style={{
          background: 'none', border: 'none', cursor: 'pointer', color: C.textMuted, padding: 4,
        }}>
          <ChevronLeft size={16} />
        </button>
        <span style={{ fontSize: 13, fontWeight: 700, color: C.text }}>
          {MONTHS_FR[month]} {year}
        </span>
        <button onClick={() => setView(new Date(year, month + 1, 1))} style={{
          background: 'none', border: 'none', cursor: 'pointer', color: C.textMuted, padding: 4,
        }}>
          <ChevronRight size={16} />
        </button>
      </div>

      {/* Day headers */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 2, marginBottom: 4 }}>
        {DAYS_FR.map(d => (
          <div key={d} style={{ textAlign: 'center', fontSize: 10, fontWeight: 700, color: C.textDim, padding: '2px 0' }}>
            {d}
          </div>
        ))}
      </div>

      {/* Days */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 2 }}>
        {cells.map((c, i) => {
          const sel = c.curr && isSelected(c.day)
          const tod = c.curr && isToday(c.day)
          return (
            <button
              key={i}
              disabled={!c.curr}
              onClick={() => pick(c.day)}
              style={{
                padding: '6px 0', borderRadius: 7, border: 'none', cursor: c.curr ? 'pointer' : 'default',
                background: sel
                  ? C.green
                  : (dark ? 'transparent' : 'transparent'),
                color: sel
                  ? '#fff'
                  : tod
                    ? C.green
                    : c.curr
                      ? C.text
                      : C.textDim,
                fontWeight: sel ? 800 : tod ? 700 : 500,
                fontSize: 12,
                opacity: c.curr ? 1 : 0.3,
                textAlign: 'center',
                fontFamily: 'inherit',
              }}
            >
              {c.day}
            </button>
          )
        })}
      </div>

      {/* Today button */}
      <div style={{ marginTop: 12, borderTop: `1px solid ${C.border}`, paddingTop: 10, paddingBottom: 4 }}>
        <button
          onClick={() => { onChange(todayStr); setView(new Date()) }}
          style={{
            width: '100%', padding: '8px 0', borderRadius: 7,
            border: `1px solid ${C.border}`,
            background: dark ? '#112018' : '#f0f7f2',
            color: C.green, fontSize: 11, fontWeight: 700,
            cursor: 'pointer', fontFamily: 'inherit',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5,
          }}
        >
          <Sun size={12} />
          Aujourd'hui
        </button>
      </div>
    </div>
  )
}

// ── ConfigModal — modal pour configurer date_plantation, EC bassin, etc. ──
function ConfigModal({ device, token, C, dark, onClose, onSaved }) {
  const [config, setConfig] = useState(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const [success, setSuccess] = useState(false)

  useEffect(() => {
    getAIConfig(getAccessToken(), device.id).then(setConfig).catch(e => setError(e.message))
  }, [device.id])

  const handleSave = async () => {
    setSaving(true)
    setError(null)
    try {
      const result = await updateAIConfig(token, device.id, {
        date_plantation: config.date_plantation || null,
        ec_eau_brute: config.ec_eau_brute ? parseFloat(config.ec_eau_brute) : null,
        nbr_goutteurs: config.nbr_goutteurs ? parseInt(config.nbr_goutteurs) : null,
        latitude: config.latitude ? parseFloat(config.latitude) : null,
        longitude: config.longitude ? parseFloat(config.longitude) : null,
      })
      setSuccess(true)
      setTimeout(() => { onSaved && onSaved(); onClose() }, 800)
    } catch (e) {
      setError(e.message)
    }
    setSaving(false)
  }

  if (!config) return null

  const inputStyle = {
    width: '100%', padding: '8px 10px', borderRadius: 7,
    border: `1px solid ${C.border}`, background: dark ? '#0d1a12' : '#fff',
    color: C.text, fontSize: 13, fontFamily: 'inherit', outline: 'none',
    boxSizing: 'border-box',
  }

  const labelStyle = { fontSize: 11, fontWeight: 700, color: C.textMuted, marginBottom: 4, display: 'block' }

  return createPortal(
    <div style={{
      position: 'fixed', inset: 0, zIndex: 9999,
      background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center',
    }} onClick={onClose}>
      <div style={{
        width: 420, maxWidth: '95vw', borderRadius: 14,
        background: dark ? '#111d15' : '#fff', border: `1px solid ${C.border}`,
        boxShadow: '0 20px 60px rgba(0,0,0,0.3)', padding: 24,
      }} onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Settings size={16} color={C.green} />
            <span style={{ fontWeight: 700, fontSize: 15, color: C.text }}>
              Config · {device.farm_name} St.{device.house_number}
            </span>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: C.textMuted, padding: 4 }}>
            <X size={16} />
          </button>
        </div>

        {/* Date de plantation */}
        <div style={{ marginBottom: 14 }}>
          <label style={{ ...labelStyle, display: 'flex', alignItems: 'center', gap: 5 }}>
            <CalendarDays size={11} color={C.green} /> Date de plantation
          </label>
          <input
            type="date"
            value={config.date_plantation || ''}
            onChange={e => setConfig(c => ({ ...c, date_plantation: e.target.value }))}
            style={inputStyle}
          />
          {config.date_plantation && (
            <div style={{ fontSize: 10, color: C.textDim, marginTop: 3 }}>
              {Math.floor((Date.now() - new Date(config.date_plantation)) / 86400000)} jours depuis plantation
            </div>
          )}
        </div>

        {/* EC bassin */}
        <div style={{ marginBottom: 14 }}>
          <label style={{ ...labelStyle, display: 'flex', alignItems: 'center', gap: 5 }}>
            <Zap size={11} color={C.green} /> EC eau brute (dS/m)
          </label>
          <input
            type="number"
            step="0.1"
            min="0.1"
            max="5"
            value={config.ec_eau_brute || ''}
            onChange={e => setConfig(c => ({ ...c, ec_eau_brute: e.target.value }))}
            placeholder="0.8"
            style={inputStyle}
          />
        </div>

        {/* Nombre de goutteurs */}
        <div style={{ marginBottom: 14 }}>
          <label style={{ ...labelStyle, display: 'flex', alignItems: 'center', gap: 5 }}>
            <Droplets size={11} color={C.green} /> Nombre de goutteurs / bras
          </label>
          <input
            type="number"
            step="1"
            min="1"
            value={config.nbr_goutteurs || ''}
            onChange={e => setConfig(c => ({ ...c, nbr_goutteurs: e.target.value }))}
            placeholder="ex: 4"
            style={inputStyle}
          />
          <div style={{ fontSize: 10, color: C.textDim, marginTop: 3 }}>
            Utilisé pour calculer % drainage (V.Drain ÷ nbr_goutteurs ÷ V.Apport)
          </div>
        </div>

        {/* Coordonnées */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 14 }}>
          <div>
            <label style={{ ...labelStyle, display: 'flex', alignItems: 'center', gap: 5 }}>
              <MapPin size={11} color={C.green} /> Latitude
            </label>
            <input
              type="number"
              step="0.0001"
              value={config.latitude || ''}
              onChange={e => setConfig(c => ({ ...c, latitude: e.target.value }))}
              placeholder="30.4202"
              style={inputStyle}
            />
          </div>
          <div>
            <label style={{ ...labelStyle, display: 'flex', alignItems: 'center', gap: 5 }}>
              <MapPin size={11} color={C.green} /> Longitude
            </label>
            <input
              type="number"
              step="0.0001"
              value={config.longitude || ''}
              onChange={e => setConfig(c => ({ ...c, longitude: e.target.value }))}
              placeholder="-9.5981"
              style={inputStyle}
            />
          </div>
        </div>

        {/* Erreur / Succès */}
        {error && (
          <div style={{ color: '#e74c3c', fontSize: 12, marginBottom: 10, display: 'flex', alignItems: 'center', gap: 5 }}>
            <AlertCircle size={13} color="#e74c3c" /> {error}
          </div>
        )}
        {success && (
          <div style={{ color: C.green, fontSize: 12, marginBottom: 10, display: 'flex', alignItems: 'center', gap: 5 }}>
            <CheckCircle2 size={13} color={C.green} /> Sauvegardé !
          </div>
        )}
        {/* Boutons */}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={{
            padding: '8px 16px', borderRadius: 7, border: `1px solid ${C.border}`,
            background: 'none', color: C.textMuted, cursor: 'pointer', fontSize: 13,
          }}>Annuler</button>
          <button onClick={handleSave} disabled={saving} style={{
            padding: '8px 16px', borderRadius: 7, border: 'none',
            background: C.green, color: '#fff', cursor: saving ? 'wait' : 'pointer',
            fontSize: 13, fontWeight: 700, opacity: saving ? 0.6 : 1,
          }}>{saving ? 'Sauvegarde...' : <><Save size={12} style={{ marginRight: 5 }} />Sauvegarder</>}</button>
        </div>
      </div>
    </div>,
    document.body,
  )
}

// ── TourDecisionTable ──────────────────────────────────────────
function TourDecisionTable({ tourData, rec, C, dark }) {
  const tours = tourData?.tours_netafim || []
  const decisions = tourData?.decisions || []
  const decisionsMap = {}
  decisions.forEach(d => { decisionsMap[d.num_tour] = d })

  if (tours.length === 0) {
    return (
      <div style={{ textAlign: 'center', padding: '12px 0', color: C.textDim, fontSize: 11 }}>
        Aucun tour détecté aujourd'hui
      </div>
    )
  }

  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11, fontFamily: 'inherit' }}>
        <thead>
          <tr style={{ borderBottom: `1px solid ${C.border}` }}>
            {['Tour', 'Heure', 'V.Apport', 'V.Drain', '%Drain', 'EC Drain', 'pH Drain', 'Décision', 'Durée suiv.', 'Repos'].map(h => (
              <th key={h} style={{ padding: '5px 8px', textAlign: 'center', color: C.textDim, fontWeight: 700, fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.04em', whiteSpace: 'nowrap' }}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {tours.map(tour => {
            const dec = decisionsMap[tour.num_tour]
            const actionColor = !dec ? C.textDim
              : dec.decision === 'CONTINUER' ? C.green
              : C.red

            return (
              <tr key={tour.num_tour} style={{ borderBottom: `1px solid ${C.border}22` }}>
                <td style={{ padding: '6px 8px', textAlign: 'center', fontWeight: 800, color: C.green }}>{tour.num_tour}</td>
                <td style={{ padding: '6px 8px', textAlign: 'center', color: C.textMuted, fontFamily: C.mono }}>{tour.debut || '—'}</td>
                <td style={{ padding: '6px 8px', textAlign: 'center', color: C.text, fontFamily: C.mono }}>
                  {tour.v_apport != null ? `${tour.v_apport.toFixed(0)}cc` : '—'}
                </td>
                <td style={{ padding: '6px 8px', textAlign: 'center', color: dec?.v_drainage != null ? C.text : C.textDim, fontFamily: C.mono }}>
                  {dec?.v_drainage != null ? `${dec.v_drainage.toFixed(0)}cc` : '—'}
                </td>
                <td style={{ padding: '6px 8px', textAlign: 'center', fontWeight: 700, fontFamily: C.mono,
                  color: !dec?.pct_drainage ? C.textDim
                    : dec.pct_drainage < 15 ? C.red
                    : dec.pct_drainage > 35 ? C.amber
                    : C.green
                }}>
                  {dec?.pct_drainage != null ? `${dec.pct_drainage.toFixed(1)}%` : '—'}
                </td>
                <td style={{ padding: '6px 8px', textAlign: 'center', color: C.textMuted, fontFamily: C.mono }}>
                  {dec?.ec_drainage != null ? dec.ec_drainage.toFixed(2) : '—'}
                </td>
                <td style={{ padding: '6px 8px', textAlign: 'center', color: C.textMuted, fontFamily: C.mono }}>
                  {dec?.ph_drainage != null ? dec.ph_drainage.toFixed(2) : '—'}
                </td>
                <td style={{ padding: '6px 8px', textAlign: 'center' }}>
                  {dec ? (
                    <span style={{
                      padding: '2px 7px', borderRadius: 4, fontSize: 10, fontWeight: 800,
                      background: dec.decision === 'CONTINUER' ? `${C.green}15` : `${C.red}15`,
                      color: actionColor, border: `1px solid ${actionColor}30`,
                    }}>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                        {dec.decision === 'CONTINUER'
                          ? <><Play size={9} fill="currentColor" /> CONT.</>
                          : <><Square size={9} fill="currentColor" /> STOP</>}
                      </span>
                    </span>
                  ) : (
                    <span style={{ color: C.textDim, fontSize: 10 }}>—</span>
                  )}
                </td>
                <td style={{ padding: '6px 8px', textAlign: 'center', color: C.textMuted, fontFamily: C.mono }}>
                  {dec?.duree_suivant != null ? `${dec.duree_suivant}min` : '—'}
                </td>
                <td style={{ padding: '6px 8px', textAlign: 'center', color: C.textMuted, fontFamily: C.mono }}>
                  {dec?.repos_suivant != null ? `${dec.repos_suivant}min` : '—'}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}


// ── TourDrainageForm ───────────────────────────────────────────
function TourDrainageForm({ house, rec, tourData, C, dark, onSaved, nbrGoutteurs = 1 }) {
  const tours = tourData?.tours_netafim || []
  const decisions = tourData?.decisions || []
  const decisionsMap = {}
  decisions.forEach(d => { decisionsMap[d.num_tour] = d })

  // Trouver le prochain tour sans décision
  const nextTour = tours.find(t => !decisionsMap[t.num_tour]) || (tours.length > 0 ? tours[tours.length - 1] : null)

  const [numTour, setNumTour] = useState(nextTour?.num_tour || 1)
  const [vDrain, setVDrain] = useState('')
  const [ecDrain, setEcDrain] = useState('')
  const [phDrain, setPhDrain] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState(null)

  const tourNetafim = tours.find(t => t.num_tour === numTour)
  const vApport = tourNetafim?.v_apport || null

  // Calcul % drainage automatique (comme SaisiePage)
  const pctDrain = vDrain && vApport && vApport > 0
    ? ((Number(vDrain) / nbrGoutteurs / vApport) * 100).toFixed(1)
    : null

  const handleSubmit = async () => {
    if (!numTour) { setError('Numéro de tour requis'); return }
    setSaving(true); setError(''); setResult(null)
    try {
      const res = await postDecisionTour(getAccessToken(), {
        device_id  : house.id,
        num_tour   : numTour,
        v_drainage : vDrain !== '' ? Number(vDrain) : null,
        ec_drainage: ecDrain !== '' ? Number(ecDrain) : null,
        ph_drainage: phDrain !== '' ? Number(phDrain) : null,
      })
      setResult(res)
      setTimeout(() => { onSaved && onSaved() }, 1500)
    } catch (e) {
      setError(e.message)
    }
    setSaving(false)
  }

  const inputStyle = {
    width: '100%', padding: '6px 8px', borderRadius: 6,
    border: `1px solid ${C.border}`, background: dark ? '#0d1a12' : '#fff',
    color: C.text, fontSize: 12, fontFamily: 'inherit', outline: 'none',
    boxSizing: 'border-box',
  }
  const labelStyle = { fontSize: 10, fontWeight: 700, color: C.textMuted, marginBottom: 3, display: 'block', textTransform: 'uppercase', letterSpacing: '0.04em' }

  return (
    <div style={{
      marginBottom: 10, padding: 12, borderRadius: 8,
      background: dark ? 'rgba(52,217,111,0.05)' : 'rgba(24,120,63,0.04)',
      border: `1px solid ${C.green}30`,
    }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: C.green, marginBottom: 10 }}>
        Saisie drainage après tour
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(100px, 1fr))', gap: 8, marginBottom: 10 }}>
        {/* Numéro de tour */}
        <div>
          <label style={labelStyle}>N° Tour</label>
          <select
            value={numTour}
            onChange={e => setNumTour(Number(e.target.value))}
            style={{ ...inputStyle }}
          >
            {tours.length > 0
              ? tours.map(t => (
                  <option key={t.num_tour} value={t.num_tour}>
                    Tour {t.num_tour}{decisionsMap[t.num_tour] ? ' ✓' : ''}
                  </option>
                ))
              : Array.from({ length: rec?.nbr_tour || 10 }, (_, i) => (
                  <option key={i+1} value={i+1}>Tour {i+1}</option>
                ))
            }
          </select>
        </div>

        {/* V. Apport (lecture seule depuis Netafim) */}
        <div>
          <label style={labelStyle}>V. Apport (cc) — auto</label>
          <input
            readOnly
            value={vApport != null ? `${vApport.toFixed(0)} cc` : '—'}
            style={{ ...inputStyle, background: dark ? '#0a1208' : '#f0f4f1', color: C.textDim, cursor: 'default' }}
          />
        </div>

        {/* V. Drainage saisi */}
        <div>
          <label style={labelStyle}>V. Drain (cc)</label>
          <input
            type="number" step="1" min="0"
            value={vDrain}
            onChange={e => setVDrain(e.target.value)}
            placeholder="0"
            style={inputStyle}
          />
        </div>

        {/* % Drainage calculé auto */}
        <div>
          <label style={labelStyle}>% Drain — auto</label>
          <input
            readOnly
            value={pctDrain != null ? `${pctDrain}%` : '—'}
            style={{
              ...inputStyle,
              background: dark ? '#0a1208' : '#f0f4f1',
              color: pctDrain != null
                ? (Number(pctDrain) < 15 ? C.red : Number(pctDrain) > 35 ? C.amber : C.green)
                : C.textDim,
              fontWeight: 700, cursor: 'default',
            }}
          />
        </div>

        {/* EC Drainage */}
        <div>
          <label style={labelStyle}>EC Drain (dS/m)</label>
          <input
            type="number" step="0.01" min="0" max="20"
            value={ecDrain}
            onChange={e => setEcDrain(e.target.value)}
            placeholder="0.00"
            style={inputStyle}
          />
        </div>

        {/* pH Drainage */}
        <div>
          <label style={labelStyle}>pH Drain</label>
          <input
            type="number" step="0.01" min="0" max="14"
            value={phDrain}
            onChange={e => setPhDrain(e.target.value)}
            placeholder="0.00"
            style={inputStyle}
          />
        </div>
      </div>

      {/* Erreur / Résultat */}
      {error && (
        <div style={{ color: C.red, fontSize: 11, marginBottom: 8, display: 'flex', alignItems: 'center', gap: 5 }}>
          <AlertCircle size={13} color={C.red} /> {error}
        </div>
      )}
      {result && (
        <div style={{
          padding: '8px 12px', borderRadius: 6, marginBottom: 8,
          background: result.prediction?.action === 'CONTINUER'
            ? (dark ? 'rgba(52,217,111,0.10)' : 'rgba(24,120,63,0.07)')
            : (dark ? 'rgba(239,68,68,0.10)' : 'rgba(239,68,68,0.07)'),
          border: `1px solid ${result.prediction?.action === 'CONTINUER' ? C.green : C.red}30`,
        }}>
          <div style={{ fontWeight: 800, fontSize: 13, color: result.prediction?.action === 'CONTINUER' ? C.green : C.red }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
              {result.prediction?.action === 'CONTINUER'
                ? <><Play size={12} fill="currentColor" /> CONTINUER</>
                : <><Square size={12} fill="currentColor" /> STOP</>}
            </span>
          </div>
          {result.prediction?.duree_suivant && (
            <div style={{ fontSize: 11, color: C.textMuted, marginTop: 3 }}>
              Durée tour suivant : <strong style={{ color: C.text }}>{result.prediction.duree_suivant} min</strong>
              {result.prediction?.repos_min && ` · Repos : ${result.prediction.repos_min} min`}
            </div>
          )}
          {result.prediction?.message && (
            <div style={{ fontSize: 10, color: C.textDim, marginTop: 2 }}>{result.prediction.message}</div>
          )}
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button
          onClick={handleSubmit}
          disabled={saving}
          style={{
            padding: '7px 16px', borderRadius: 6, border: 'none',
            background: saving ? C.toggleBg : C.green,
            color: saving ? C.textDim : '#fff',
            fontSize: 12, fontWeight: 700, cursor: saving ? 'wait' : 'pointer',
            fontFamily: 'inherit',
          }}
        >
          {saving ? 'Calcul...' : <><Zap size={12} style={{ marginRight: 5 }} />Prédire</>}
        </button>
      </div>
    </div>
  )
}

// ── FarmSection — une ferme avec ses houses + recommandations ──
function FarmSection({ farm, token, dateStr, C, dark, onConfig }) {
  const [open, setOpen] = useState(true)
  const [recs, setRecs] = useState({})
  const [loading, setLoading] = useState(true)
  const fetchingRef = useRef(false)

  const houseIds = (farm.houses || []).map(h => h.id).join(',')

  const loadRecs = useCallback(async () => {
    if (fetchingRef.current) return
    fetchingRef.current = true
    setLoading(true)
    const results = {}
    for (const house of farm.houses || []) {
      try {
        const data = await getRecommandation(token, house.id, dateStr)
        if (data) results[house.id] = data
      } catch (e) {
        console.error(`AgentIA fetch device ${house.id}:`, e)
      }
    }
    setRecs(results)
    setLoading(false)
    fetchingRef.current = false
  }, [token, dateStr, houseIds])

  useEffect(() => { loadRecs() }, [loadRecs])

  const hasData = Object.keys(recs).length > 0

  return (
    <div style={{
      marginBottom: 8, borderRadius: 10,
      border: `1px solid ${C.border}`, background: C.card, overflow: 'hidden',
    }}>
      {/* Farm header */}
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '10px 14px', borderRadius: 0, border: 'none',
          borderBottom: open ? `1px solid ${C.border}` : 'none',
          background: dark ? '#0d1a12' : '#f0f7f2',
          cursor: 'pointer', fontFamily: 'inherit',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{
            width: 28, height: 28, borderRadius: 7,
            background: dark ? 'rgba(52,217,111,0.15)' : 'rgba(24,120,63,0.10)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <Brain size={14} color={C.green} />
          </div>
          <span style={{ fontWeight: 700, fontSize: 13, color: C.text }}>{farm.farm_name}</span>
          <span style={{
            fontSize: 10, fontWeight: 600, padding: '2px 7px',
            borderRadius: 5, background: C.toggleBg, color: C.textMuted,
          }}>
            {farm.houses?.length || 0} station{farm.houses?.length > 1 ? 's' : ''}
          </span>
        </div>
        {open
          ? <ChevronDown size={14} color={C.textDim} />
          : <ChevronRight size={14} color={C.textDim} />}
      </button>

      {open && (
        <div>
          {loading && (
            <div style={{ padding: 24, textAlign: 'center', color: C.textDim, fontSize: 12 }}>
              <RefreshCw size={14} style={{ display: 'inline-block', animation: 'az-spin 1s linear infinite', marginRight: 6 }} />
              Chargement recommandations...
            </div>
          )}
          {!loading && !hasData && (
            <div style={{ padding: 24, textAlign: 'center', color: C.textDim, fontSize: 12 }}>
              <WifiOff size={16} style={{ marginBottom: 6, display: 'block', margin: '0 auto 6px' }} />
              Aucune recommandation pour cette date
            </div>
          )}
          {!loading && (farm.houses || []).map(house => (
            <HouseCard key={house.id} house={house} rec={recs[house.id]} C={C} dark={dark} onConfig={onConfig} dateStr={dateStr} />
          ))}
        </div>
      )}
    </div>
  )
}

// ── HouseCard — recommandation d'une house ─────────────────────
function HouseCard({ house, rec, C, dark, onConfig, dateStr }) {
  const [expanded, setExpanded] = useState(false)
  const [showTourForm, setShowTourForm] = useState(false)
  const [tourData, setTourData] = useState(null)
  const [loadingTours, setLoadingTours] = useState(false)
  const [config, setConfig] = useState(null)
  const fetchedRef = useRef(false)

  useEffect(() => {
      fetchedRef.current = false
      setTourData(null)
  }, [dateStr])

  useEffect(() => {
    getAIConfig(getAccessToken(), house.id)
      .then(setConfig)
      .catch(() => {})
  }, [house.id])

  // Charger décisions du jour quand on expand
  useEffect(() => {
    if (!expanded || fetchedRef.current) return
    fetchedRef.current = true
    setLoadingTours(true)
    getDecisionsTour(getAccessToken(), house.id, dateStr)
      .then(setTourData)
      .catch(() => {})
      .finally(() => setLoadingTours(false))
  }, [expanded, house.id, dateStr])

  const refreshTours = () => {
    setLoadingTours(true)
    getDecisionsTour(getAccessToken(), house.id, dateStr)
      .then(setTourData)
      .catch(() => {})
      .finally(() => setLoadingTours(false))
  }

  if (!rec) return null

  const heureML   = rec.heure_debut_ml || '—'
  const heurePRT  = rec.heure_debut_prt
  const heureFinale = heurePRT || heureML
  const sourcePRT = heurePRT != null

  const prt      = rec.prt || {}
  const decision = prt.ptr_decision

  const decColor = decision === 'DECLENCHER' ? C.green
    : decision === 'STRESS_HYDRIQUE' ? C.amber
    : decision === 'ATTENDRE' ? C.blue
    : decision === 'PLUIE_STOP' ? C.purple
    : C.textMuted

  return (
    <div style={{ borderTop: `1px solid ${C.border}`, padding: '12px 14px' }}>
      {/* Ligne principale */}
      <div
        onClick={() => setExpanded(e => !e)}
        style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer', gap: 8 }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0, flex: 1 }}>
          <div style={{
            width: 32, height: 32, borderRadius: 8,
            background: sourcePRT
              ? (dark ? 'rgba(52,217,111,0.15)' : 'rgba(24,120,63,0.10)')
              : (dark ? 'rgba(77,157,224,0.12)' : 'rgba(29,111,164,0.08)'),
            display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
          }}>
            <span style={{ fontSize: 11, fontWeight: 900, color: sourcePRT ? C.green : C.blue }}>
              {house.house_number}
            </span>
          </div>
          <div style={{ minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <Clock size={12} color={C.textDim} />
              <span style={{ fontWeight: 700, fontSize: 15, color: C.text, fontFamily: C.mono }}>{heureFinale}</span>
              <span style={{
                fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 4,
                background: sourcePRT
                  ? (dark ? 'rgba(52,217,111,0.12)' : 'rgba(24,120,63,0.08)')
                  : (dark ? 'rgba(77,157,224,0.10)' : 'rgba(29,111,164,0.06)'),
                color: sourcePRT ? C.green : C.blue,
              }}>
                {sourcePRT ? 'PRT' : 'ML'}
              </span>
            </div>
            <div style={{ fontSize: 10, color: C.textDim, marginTop: 2 }}>
              <ScenarioLabel s={rec.scenario_meteo} />
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
          <MiniBadge icon={<Droplets size={10} />} value={`${rec.nbr_tour || '—'}`} label="tours" C={C} />
          <MiniBadge icon={<Gauge size={10} />} value={rec.ec_cible_dSm != null ? rec.ec_cible_dSm.toFixed(1) : '—'} label="EC" C={C} />
          <button
            onClick={(e) => { e.stopPropagation(); onConfig && onConfig(house) }}
            title="Configuration"
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: C.textDim, padding: 4, display: 'flex', alignItems: 'center' }}
          >
            <Settings size={13} />
          </button>
          {expanded ? <ChevronDown size={12} color={C.textDim} /> : <ChevronRight size={12} color={C.textDim} />}
        </div>
      </div>

      {/* Détails expandés */}
      {expanded && (
        <div style={{ marginTop: 12 }}>

          {/* ── Recommandation matin (résumé compact) ── */}
          <div style={{
            padding: 12, borderRadius: 8, marginBottom: 10,
            background: dark ? '#0c1610' : '#f9fbfa',
            border: `1px solid ${C.border}`,
          }}>
            <div style={{ fontSize: 10, fontWeight: 700, color: C.textDim, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>
              Consignes matin
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(85px, 1fr))', gap: 6 }}>
              <DetailPill label="EC cible" value={rec.ec_cible_dSm != null ? `${rec.ec_cible_dSm} dS/m` : '—'} C={C} />
              <DetailPill label="pH cible" value={rec.ph_cible != null ? `${rec.ph_cible}` : '—'} C={C} />
              <DetailPill label="Nb tours" value={`${rec.nbr_tour || '—'}`} C={C} />
              <DetailPill label="Durée (min)" value={rec.duree_min != null ? `${rec.duree_min}` : '—'} C={C} />
              <DetailPill label="Eau (mm)" value={rec.quantite_eau_mm != null ? `${rec.quantite_eau_mm}` : '—'} C={C} />
              <DetailPill label="Volume cc" value={rec.volume_cc_goutteur != null ? `${rec.volume_cc_goutteur}` : '—'} C={C} />
            </div>
          </div>

          {/* ── Section Décisions Tour/Tour ── */}
          <div style={{
            padding: 12, borderRadius: 8,
            background: dark ? '#0c1610' : '#f9fbfa',
            border: `1px solid ${C.border}`,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: C.textDim, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                Décisions Tour/Tour — Drainage
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                <button
                  onClick={(e) => { e.stopPropagation(); refreshTours() }}
                  style={{ background: 'none', border: 'none', cursor: 'pointer', color: C.textDim, padding: 4, display: 'flex', alignItems: 'center' }}
                >
                  <RefreshCw size={12} style={{ animation: loadingTours ? 'az-spin 1s linear infinite' : 'none' }} />
                </button>
                <button
                  onClick={(e) => { e.stopPropagation(); setShowTourForm(v => !v) }}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 4,
                    padding: '4px 10px', borderRadius: 6,
                    border: `1px solid ${C.green}40`,
                    background: dark ? 'rgba(52,217,111,0.10)' : 'rgba(24,120,63,0.06)',
                    color: C.green, fontSize: 11, fontWeight: 700, cursor: 'pointer',
                  }}
                >
                  <Droplets size={11} style={{ marginRight: 4 }} /> Saisir drainage
                </button>
              </div>
            </div>

            {/* Formulaire saisie drainage */}
            {showTourForm && (
              <TourDrainageForm
                house={house}
                rec={rec}
                tourData={tourData}
                C={C}
                dark={dark}
                nbrGoutteurs={config?.nbr_goutteurs || 1}
                onSaved={() => { setShowTourForm(false); refreshTours() }}
              />
            )}

            {/* Liste des tours avec décisions */}
            {loadingTours ? (
              <div style={{ textAlign: 'center', padding: 12, color: C.textDim, fontSize: 11 }}>
                <RefreshCw size={12} style={{ display: 'inline-block', animation: 'az-spin 1s linear infinite', marginRight: 4 }} />
                Chargement...
              </div>
            ) : tourData ? (
              <TourDecisionTable tourData={tourData} rec={rec} C={C} dark={dark} />
            ) : (
              <div style={{ textAlign: 'center', padding: 12, color: C.textDim, fontSize: 11 }}>
                Aucune donnée tour
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// ── MiniBadge ──────────────────────────────────────────────────
function MiniBadge({ icon, value, label, C }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 3,
      padding: '3px 7px', borderRadius: 5,
      background: C.toggleBg, fontSize: 10, fontWeight: 600, color: C.textMuted, whiteSpace: 'nowrap',
    }}>
      {icon}
      <span style={{ fontFamily: C.mono }}>{value}</span>
      <span style={{ color: C.textDim, fontWeight: 400 }}>{label}</span>
    </div>
  )
}

// ── DetailPill ─────────────────────────────────────────────────
function DetailPill({ label, value, color, C }) {
  return (
    <div style={{ padding: '6px 8px', borderRadius: 6, background: C.inputBg, textAlign: 'center' }}>
      <div style={{ fontSize: 8, fontWeight: 700, color: C.textDim, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 2 }}>{label}</div>
      <div style={{ fontSize: 12, fontWeight: 700, color: color || C.text, fontFamily: C.mono }}>{value}</div>
    </div>
  )
}

// ══════════════════════════════════════════════════════════════
// PAGE PRINCIPALE
// ══════════════════════════════════════════════════════════════
export default function AgentIAPage({ dark, auth }) {
  const C = getColors(dark)
  const width = useWindowWidth()
  const isMobile = width < 640

  const [dateStr, setDateStr] = useState(today())
  const [farms, setFarms] = useState([])
  const [loading, setLoading] = useState(true)
  const [configDevice, setConfigDevice] = useState(null)
  const fetchingRef = useRef(false)

  // Calendar popup state (même pattern que ZonePage)
  const [showCal, setShowCal] = useState(false)
  const calBtnRef = useRef(null)
  const [calPos, setCalPos] = useState({ top: 'auto', bottom: 'auto', left: 0 })

  const calPortalRef = useRef(null)

  // Charger les devices groupés par ferme (même pattern que DashboardPage)
  const loadFarms = useCallback(async () => {
    if (fetchingRef.current) return
    if (!getAccessToken()) return
    fetchingRef.current = true
    setLoading(true)
    try {
      const data = await getDevices(getAccessToken())
      setFarms(data || [])
    } catch (e) {
      console.error('AgentIA loadFarms:', e)
    } finally {
      setLoading(false)
      fetchingRef.current = false
    }
  }, [])

  useEffect(() => { loadFarms() }, [loadFarms])

  // Filtrer par fermes de l'utilisateur
  const filteredFarms = farms

  const handleToday = () => { setDateStr(today()); setShowCal(false) }

  // Position du calendrier popup
  const openCal = () => {
    if (!calBtnRef.current) { setShowCal(v => !v); return }
    const r = calBtnRef.current.getBoundingClientRect()
    const spaceBelow = window.innerHeight - r.bottom
    if (spaceBelow < 340)
      setCalPos({ bottom: window.innerHeight - r.top + 6, top: 'auto', left: r.left })
    else
      setCalPos({ top: r.bottom + 6, bottom: 'auto', left: r.left })
    setShowCal(v => !v)
  }

  // Fermer calendrier au clic extérieur
  useEffect(() => {
    if (!showCal) return
    const close = (e) => {
      if (
        calBtnRef.current && !calBtnRef.current.contains(e.target) &&
        calPortalRef.current && !calPortalRef.current.contains(e.target)
      ) setShowCal(false)
    }
    const onScroll = () => setShowCal(false)
    document.addEventListener('mousedown', close)
    window.addEventListener('scroll', onScroll, true)
    return () => {
      document.removeEventListener('mousedown', close)
      window.removeEventListener('scroll', onScroll, true)
    }
  }, [showCal])

  return (
    <div style={{ animation: 'az-fade-in 0.35s ease both' }}>
      {/* HEADER */}
      <div style={{
        display: 'flex', justifyContent: 'space-between',
        alignItems: isMobile ? 'flex-start' : 'center',
        flexDirection: isMobile ? 'column' : 'row',
        marginBottom: 16, gap: 10,
      }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 900, display: 'flex', alignItems: 'center', gap: 10 }}>
            <Brain size={18} color={C.green} />
            Agent IA Irrigation
          </h1>
          <div style={{ fontSize: 11, color: C.textDim, marginTop: 2 }}>
            Recommandations · {farms.length} ferme{farms.length > 1 ? 's' : ''}
          </div>
        </div>     
      </div>

      {/* Filtre date */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <div style={{ position: 'relative' }}>
          <div
            ref={calBtnRef}
            onClick={openCal}
            style={{
              display: 'flex', alignItems: 'center', gap: 10,
              padding: '7px 14px', borderRadius: 8, minHeight: 34,
              cursor: 'pointer',
              border: `1.5px solid ${showCal ? C.green : C.border}`,
              background: C.inputBg, transition: 'border-color 0.15s',
              fontFamily: 'inherit',
            }}
          >
            <Calendar size={14} color={showCal || dateStr !== today() ? C.green : C.textDim} strokeWidth={2} />
            <span style={{ fontSize: 12, fontWeight: 630, color: C.text }}>
              {fmtDisplay(dateStr)}
            </span>
          </div>
        </div>

        {dateStr !== today() && (
          <button
            onClick={handleToday}
            style={{
              padding: '6px 10px', borderRadius: 7,
              border: `1.5px solid ${C.border}`,
              background: C.inputBg, color: C.text,
              fontSize: 12, fontFamily: 'inherit', cursor: 'pointer', outline: 'none',
            }}
          >
            Aujourd'hui
          </button>
        )}
      </div>   

      {/* Calendar popup (portal, même pattern que ZonePage) */}
      {showCal && createPortal(
        <div
          ref={calPortalRef}
          style={{
            position: 'fixed',
            top: calPos.top !== 'auto' ? calPos.top : 'auto',
            bottom: calPos.bottom !== 'auto' ? calPos.bottom : 'auto',
            left: calPos.left,
            zIndex: 99999,
            border: `1.5px solid ${C.border}`,
            borderRadius: 12,
            padding: '12px 12px 16px',
            background: dark ? C.surface : '#fafcfb',
            boxShadow: '0 8px 32px rgba(0,0,0,0.35)',
            width: 248,
            fontFamily: 'inherit',
          }}
        >
          <TourCalendar
            value={dateStr}
            onChange={v => { if (v) { setDateStr(v); setShowCal(false) } }}
            C={C}
            dark={dark}
          />
        </div>,
        document.body
      )}

      {/* Indicateur mode historique */}
      {dateStr !== today() && (
        <div style={{
          marginBottom: 12, padding: '6px 12px', borderRadius: 7,
          background: dark ? 'rgba(77,157,224,0.08)' : 'rgba(29,111,164,0.05)',
          border: `1px solid ${dark ? 'rgba(77,157,224,0.15)' : 'rgba(29,111,164,0.12)'}`,
          display: 'flex', alignItems: 'center', gap: 6,
        }}>
          <Eye size={12} color={C.blue} />
          <span style={{ fontSize: 11, color: C.blue, fontWeight: 600 }}>Mode historique — {fmtDisplay(dateStr)}</span>
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div style={{ textAlign: 'center', padding: 40, color: C.textDim }}>
          <RefreshCw size={18} style={{ display: 'inline-block', animation: 'az-spin 1s linear infinite', marginBottom: 8 }} />
          <div style={{ fontSize: 12 }}>Chargement des fermes...</div>
        </div>
      )}

      {/* Aucune ferme */}
      {!loading && filteredFarms.length === 0 && (
        <div style={{
          border: `1px dashed ${C.border}`,
          borderRadius: 12, padding: 40, textAlign: 'center', color: C.textDim,
        }}>
          <Brain size={28} style={{ marginBottom: 8 }} />
          <div style={{ fontWeight: 700, fontSize: 13 }}>Aucune ferme assignée</div>
          <div style={{ fontSize: 11, marginTop: 4 }}>
            {userFarms.length > 0
              ? `Fermes attendues : ${userFarms.join(', ')}`
              : "Aucune ferme n'est associée à votre compte"}
          </div>
        </div>
      )}

      {/* Liste des fermes */}
      {!loading && filteredFarms.map(farm => (
        <FarmSection
          key={farm.farm_name}
          farm={farm}
          token={getAccessToken()}
          dateStr={dateStr}
          C={C}
          dark={dark}
          onConfig={setConfigDevice}
        />
      ))}

      {/* Modal config device */}
      {configDevice && (
        <ConfigModal
          device={configDevice}
          token={getAccessToken()}
          C={C}
          dark={dark}
          onClose={() => setConfigDevice(null)}
          onSaved={() => { loadFarms() }}
        />
      )}
    </div>
  )
}
