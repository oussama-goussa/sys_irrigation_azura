// ============================================================
// frontend/src/pages/AgentIAPage.jsx
// Agent IA Irrigation — Recommandations ML + PRT par ferme/house
// Projet Azura Irrigation IA — GOUSSA Oussama
// ============================================================

import { useState, useEffect, useRef, useCallback } from 'react'
import {
  Brain, RefreshCw, Calendar, Sun, Droplets, Thermometer,
  Gauge, Clock, ChevronDown, ChevronRight, ChevronLeft, WifiOff,
  AlertTriangle, CheckCircle2, XCircle, ArrowRight, Eye
} from 'lucide-react'
import { createPortal } from 'react-dom'
import { getColors } from '../theme.js'
import { useWindowWidth } from '../components/DashboardShell.jsx'
import { getDevices, getAccessToken, getRecommandation } from '../api/client.js'

// ── Helpers (même logique que ZonePage.jsx) ────────────────────
function fmtDisplay(d) {
  if (!d) return ''
  const [y, m, day] = d.split('-')
  return `${day}/${m}/${y}`
}

function today() {
  return new Date().toISOString().split('T')[0]
}

const SCENARIO_LABELS = {
  '1_TRES_ENSOLEILLE':  '☀️ Très ensoleillé',
  '2_ENSOLEILLE':       '🌤️ Ensoleillé',
  '3_NUAGEUX':          '☁️ Nuageux',
  '4_TRES_NUAGEUX':     '🌥️ Très nuageux',
  '5_BROUILLARD_MATIN': '🌫️ Brouillard matin',
  '5b_FOG_CHAUD_VPD':   '🌫️ Fog chaud VPD',
  '5c_FOG_CHAUD_RS':    '🌫️ Fog chaud RS',
  '5d_FOG_RADIATION':   '🌫️ Fog radiation',
  '5e_FOG_FROID':       '🌫️ Fog froid',
  '6_CHERGUI_URGENT':   '🔥 Chergui urgent',
  '7_PLUIE_STOP':       '🌧️ Pluie stop',
  '7b_PLUIE_LEGERE':    '🌦️ Pluie légère',
  '8_NUAGEUX_CHAUD':    '⛅ Nuageux chaud',
  '9_NUIT_FROIDE_SOL':  '🌙 Nuit froide sol',
  'default':            '❓ Défaut',
}

function scenarioLabel(s) { return SCENARIO_LABELS[s] || s || '—' }

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
      <div style={{ marginTop: 8, borderTop: `1px solid ${C.border}`, paddingTop: 8 }}>
        <button
          onClick={() => { onChange(todayStr); setView(new Date()) }}
          style={{
            width: '100%', padding: '6px 0', borderRadius: 7,
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

// ── FarmSection — une ferme avec ses houses + recommandations ──
function FarmSection({ farm, token, dateStr, C, dark }) {
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
            <HouseCard key={house.id} house={house} rec={recs[house.id]} C={C} dark={dark} />
          ))}
        </div>
      )}
    </div>
  )
}

// ── HouseCard — recommandation d'une house ─────────────────────
function HouseCard({ house, rec, C, dark }) {
  const [expanded, setExpanded] = useState(false)

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
  const decLabel = decision === 'DECLENCHER' ? 'Déclencher'
    : decision === 'STRESS_HYDRIQUE' ? 'Stress'
    : decision === 'ATTENDRE' ? 'Attendre'
    : decision === 'PLUIE_STOP' ? 'Pluie'
    : decision || '—'

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
            <div style={{ fontSize: 10, color: C.textDim, marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {scenarioLabel(rec.scenario_meteo)}
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
          <MiniBadge icon={<Droplets size={10} />} value={`${rec.nbr_tour || '—'}`} label="tours" C={C} />
          <MiniBadge icon={<Gauge size={10} />} value={rec.ec_cible_dSm != null ? rec.ec_cible_dSm.toFixed(1) : '—'} label="EC" C={C} />
          {expanded
            ? <ChevronDown size={12} color={C.textDim} />
            : <ChevronRight size={12} color={C.textDim} />}
        </div>
      </div>

      {/* Détails expandés */}
      {expanded && (
        <div style={{
          marginTop: 12, padding: 12, borderRadius: 8,
          background: dark ? '#0c1610' : '#f9fbfa',
          border: `1px solid ${C.border}`,
        }}>
          {/* ML vs PRT */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', gap: 8, alignItems: 'center', marginBottom: 12 }}>
            <div style={{
              padding: '10px 12px', borderRadius: 8,
              background: dark ? 'rgba(77,157,224,0.08)' : 'rgba(29,111,164,0.05)',
              border: `1px solid ${dark ? 'rgba(77,157,224,0.15)' : 'rgba(29,111,164,0.12)'}`,
              textAlign: 'center',
            }}>
              <div style={{ fontSize: 9, fontWeight: 700, color: C.blue, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>ML XGBoost</div>
              <div style={{ fontSize: 22, fontWeight: 900, color: C.blue, fontFamily: C.mono }}>{heureML}</div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
              <ArrowRight size={16} color={sourcePRT ? C.green : C.textDim} />
              <span style={{
                fontSize: 8, fontWeight: 700, padding: '1px 5px', borderRadius: 3,
                background: sourcePRT ? (dark ? 'rgba(52,217,111,0.12)' : 'rgba(24,120,63,0.08)') : C.toggleBg,
                color: sourcePRT ? C.green : C.textDim,
              }}>{sourcePRT ? 'PRT' : 'ML'}</span>
            </div>
            <div style={{
              padding: '10px 12px', borderRadius: 8,
              background: sourcePRT
                ? (dark ? 'rgba(52,217,111,0.08)' : 'rgba(24,120,63,0.05)')
                : (dark ? 'rgba(61,107,78,0.08)' : 'rgba(156,184,166,0.10)'),
              border: `1px solid ${sourcePRT ? (dark ? 'rgba(52,217,111,0.2)' : 'rgba(24,120,63,0.15)') : C.border}`,
              textAlign: 'center',
            }}>
              <div style={{ fontSize: 9, fontWeight: 700, color: sourcePRT ? C.green : C.textDim, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>PRT Poids</div>
              <div style={{ fontSize: 22, fontWeight: 900, fontFamily: C.mono, color: sourcePRT ? C.green : C.textDim }}>
                {heurePRT || '—'}
              </div>
            </div>
          </div>

          {/* PRT details */}
          {sourcePRT && prt.ptr_pct != null && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(100px, 1fr))', gap: 6, marginBottom: 10 }}>
              <DetailPill label="PRT %" value={`${prt.ptr_pct.toFixed(1)}%`} color={decColor} C={C} />
              <DetailPill label="Décision" value={decLabel} color={decColor} C={C} />
              <DetailPill label="Seuils" value={`${prt.ptr_seuil_bas?.toFixed(1)} – ${prt.ptr_seuil_haut?.toFixed(1)}%`} C={C} />
              <DetailPill label="Poids soir" value={prt.poids_soir_kg != null ? `${prt.poids_soir_kg.toFixed(2)} kg` : '—'} C={C} />
              <DetailPill label="Poids matin" value={prt.poids_matin_kg != null ? `${prt.poids_matin_kg.toFixed(2)} kg` : '—'} C={C} />
              <DetailPill label="Heure matin" value={prt.heure_matin || '—'} C={C} />
              <DetailPill label="Fin tour soir" value={prt.fin_tour_soir || '—'} C={C} />
            </div>
          )}

          {/* Consignes */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(90px, 1fr))', gap: 6 }}>
            <DetailPill label="EC cible" value={rec.ec_cible_dSm != null ? `${rec.ec_cible_dSm} dS/m` : '—'} C={C} />
            <DetailPill label="pH cible" value={rec.ph_cible != null ? `${rec.ph_cible}` : '—'} C={C} />
            <DetailPill label="Nb tours" value={`${rec.nbr_tour || '—'}`} C={C} />
            <DetailPill label="Eau (mm)" value={rec.quantite_eau_mm != null ? `${rec.quantite_eau_mm}` : '—'} C={C} />
            <DetailPill label="Volume cc" value={rec.volume_cc_goutteur != null ? `${rec.volume_cc_goutteur}` : '—'} C={C} />
            <DetailPill label="Durée (min)" value={rec.duree_min != null ? `${rec.duree_min}` : '—'} C={C} />
          </div>

          {/* Alerte */}
          {rec.alerte && rec.alerte !== 'none' && (
            <div style={{
              marginTop: 8, padding: '6px 10px', borderRadius: 6,
              background: dark ? 'rgba(245,166,35,0.10)' : 'rgba(168,106,0,0.06)',
              border: `1px solid ${dark ? 'rgba(245,166,35,0.2)' : 'rgba(168,106,0,0.15)'}`,
              display: 'flex', alignItems: 'center', gap: 6,
            }}>
              <AlertTriangle size={12} color={C.amber} />
              <span style={{ fontSize: 11, fontWeight: 600, color: C.amber }}>{rec.alerte}</span>
            </div>
          )}

          {/* Statut */}
          <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
            {rec.statut === 'approved' && <><CheckCircle2 size={12} color={C.green} /><span style={{ fontSize: 11, color: C.green, fontWeight: 600 }}>Approuvée</span></>}
            {rec.statut === 'rejected' && <><XCircle size={12} color={C.red} /><span style={{ fontSize: 11, color: C.red, fontWeight: 600 }}>Rejetée</span></>}
            {rec.statut !== 'approved' && rec.statut !== 'rejected' && <><Clock size={12} color={C.textDim} /><span style={{ fontSize: 11, color: C.textDim }}>En attente</span></>}
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
  const fetchingRef = useRef(false)

  // Calendar popup state (même pattern que ZonePage)
  const [showCal, setShowCal] = useState(false)
  const calBtnRef = useRef(null)
  const [calPos, setCalPos] = useState({ top: 'auto', bottom: 'auto', left: 0 })

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
  const userFarms = auth?.farm_names || []
  const filteredFarms = farms.filter(f => userFarms.includes(f.farm_name))

  const handleToday = () => { setDateStr(today()); setShowCal(false) }

  // Position du calendrier popup
  const openCal = () => {
    if (!calBtnRef.current) { setShowCal(true); return }
    const r = calBtnRef.current.getBoundingClientRect()
    const spaceBelow = window.innerHeight - r.bottom
    if (spaceBelow < 320 && r.top > 320) {
      setCalPos({ top: 'auto', bottom: window.innerHeight - r.top + 6, left: r.left })
    } else {
      setCalPos({ top: r.bottom + 6, bottom: 'auto', left: r.left })
    }
    setShowCal(true)
  }

  // Fermer calendrier au clic extérieur
  useEffect(() => {
    if (!showCal) return
    const handler = (e) => {
      if (calBtnRef.current && !calBtnRef.current.contains(e.target)) {
        // vérifier si le clic est dans le portal (calendar popup)
        const pop = document.getElementById('ai-cal-portal')
        if (pop && pop.contains(e.target)) return
        setShowCal(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
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
            Recommandations ML + PRT · {filteredFarms.length} ferme{filteredFarms.length > 1 ? 's' : ''}
          </div>
        </div>

        {/* Filtre date — même design que ZonePage Tours */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
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

          {/* Bouton Aujourd'hui */}
          <button
            onClick={handleToday}
            style={{
              display: 'flex', alignItems: 'center', gap: 5,
              padding: '7px 12px', borderRadius: 8,
              border: `1.5px solid ${dateStr === today() ? C.green : C.border}`,
              background: dateStr === today()
                ? (dark ? 'rgba(52,217,111,0.10)' : 'rgba(24,120,63,0.06)')
                : C.inputBg,
              color: dateStr === today() ? C.green : C.textMuted,
              fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit',
            }}
          >
            <Sun size={12} />
            Aujourd'hui
          </button>
        </div>
      </div>

      {/* Calendar popup (portal, même pattern que ZonePage) */}
      {showCal && createPortal(
        <div
          id="ai-cal-portal"
          style={{
            position: 'fixed',
            top: calPos.top !== 'auto' ? calPos.top : 'auto',
            bottom: calPos.bottom !== 'auto' ? calPos.bottom : 'auto',
            left: calPos.left,
            zIndex: 99999,
            border: `1.5px solid ${C.border}`,
            borderRadius: 12,
            padding: '12px 12px 10px',
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
        />
      ))}
    </div>
  )
}
