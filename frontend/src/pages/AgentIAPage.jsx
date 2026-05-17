// ============================================================
// frontend/src/pages/AgentIAPage.jsx
// Agent IA — AZ106 uniquement · Ressuyage depuis capteur poids
// Recommandation automatique sans bouton Générer
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

// ── Design tokens — palette réduite ──────────────────────────
// Sémantique : vert = normal/ok, ambre = radiation/énergie,
// bleu = décision IA uniquement, rouge = alerte urgente
const T = {
  green:       '#1a7a40',
  greenMid:    '#2d9e56',
  greenLight:  (dark) => dark ? 'rgba(45,158,86,0.12)' : '#eaf4ed',
  greenBorder: (dark) => dark ? 'rgba(45,158,86,0.25)' : '#c0dcc8',
  amber:       '#7a5a00',
  amberMid:    '#a07800',
  amberLight:  (dark) => dark ? 'rgba(160,120,0,0.12)' : '#fdf6e3',
  amberBorder: (dark) => dark ? 'rgba(160,120,0,0.25)' : '#e8d490',
  blue:        '#1a4a7a',
  blueMid:     '#2260a0',
  blueLight:   (dark) => dark ? 'rgba(34,96,160,0.12)' : '#edf3fb',
  blueBorder:  (dark) => dark ? 'rgba(34,96,160,0.25)' : '#b0c8e8',
  red:         '#7a1a1a',
  redLight:    (dark) => dark ? 'rgba(122,26,26,0.12)' : '#fdeaed',
  purple:      '#5a3a8a',
  purpleLight: (dark) => dark ? 'rgba(90,58,138,0.12)' : '#f0eaf8',
  subBg:       (dark) => dark ? 'rgba(255,255,255,0.03)' : '#f8faf8',
}

// ── Statut map — couleurs sémantiques ────────────────────────
const STATUT_MAP = {
  en_cours      : { label: 'En cours',     color: T.blueMid },
  optimal       : { label: 'Optimal ✓',    color: T.greenMid },
  a_ajuster     : { label: 'À surveiller', color: T.amberMid },
  arrete        : { label: 'Arrêté',       color: T.red },
  pluie         : { label: 'Pluie – arrêt',color: T.blueMid },
  non_disponible: { label: '—',            color: '#9cb8a6' },
}

const ACTION_COLORS = {
  CONTINUER         : { color: T.greenMid,  bg: T.greenLight,  icon: CheckCircle2 },
  PRUDENCE          : { color: T.amberMid,  bg: T.amberLight,  icon: AlertTriangle },
  AUGMENTATION_REPOS: { color: T.amberMid,  bg: T.amberLight,  icon: Pause },
  PROLONGER         : { color: T.blueMid,   bg: T.blueLight,   icon: TrendingUp },
  ARRET_URGENT      : { color: T.red,       bg: T.redLight,    icon: StopCircle },
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

function calculerPRT(poidsSoir, poidsMatin) {
  if (!poidsSoir || !poidsMatin || poidsSoir <= 0) return null
  return ((poidsSoir - poidsMatin) / poidsSoir) * 100
}

function getPRTStatus(prt, mois) {
  if (prt === null) return null
  const periode = getPeriode(mois)
  const s = PRT_SEUILS[periode]
  if (prt < s.min) return { ok: false, msg: `PRT ${prt.toFixed(1)}% < ${s.min}% → attendre`, color: T.amberMid }
  if (prt > s.max) return { ok: false, msg: `PRT ${prt.toFixed(1)}% > ${s.max}% → avancer début`, color: T.blueMid }
  return { ok: true, msg: `PRT ${prt.toFixed(1)}% ✓ dans la plage`, color: T.greenMid }
}

// ── Shared card style ─────────────────────────────────────────
const cardStyle = (C, extra = {}) => ({
  background: C.surface,
  border: `1px solid ${C.border}`,
  borderRadius: 10,
  ...extra,
})

const subCellStyle = (dark, extra = {}) => ({
  background: T.subBg(dark),
  border: `1px solid rgba(0,0,0,0.06)`,
  borderRadius: 8,
  ...extra,
})

const labelStyle = {
  fontSize: 9,
  fontWeight: 700,
  textTransform: 'uppercase',
  letterSpacing: '0.09em',
}

// ─────────────────────────────────────────────────────────────
// PRTCard — Capteur Poids + Ressuyage
// ─────────────────────────────────────────────────────────────
function PRTCard({ weight, poidsSoir: poidsSoirData, deviceLatest, prtBackend, C, dark }) {
  const mois      = new Date().getMonth() + 1
  const periode   = getPeriode(mois)
  const seuils    = PRT_SEUILS[periode]
  const prt       = prtBackend ?? null
  const prtStatus = prt !== null ? getPRTStatus(prt, mois) : null

  const poidsKg      = poidsSoirData?.poids_soir ?? null
  const finTour      = poidsSoirData?.fin_tour ?? null
  const msgPoids     = poidsSoirData?.message ?? null
  const radiationSum = deviceLatest?.sensor?.radiation_sum ?? null
  const radiationLive= deviceLatest?.sensor?.radiation ?? null

  return (
    <div style={{ ...cardStyle(C), padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
        <Scale size={12} color={T.greenMid} strokeWidth={2} />
        <span style={{ ...labelStyle, color: C.textMuted }}>Capteur Poids · AZ106</span>
        {weight && (
          <span style={{
            marginLeft: 'auto', fontSize: 10, color: C.textDim,
            background: T.greenLight(dark), border: `1px solid ${T.greenBorder(dark)}`,
            borderRadius: 4, padding: '1px 7px', fontWeight: 600,
          }}>
            {new Date(weight.timestamp).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
          </span>
        )}
      </div>

      {/* Poids + Radiation */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>

        {/* Poids */}
        <div style={{ ...subCellStyle(dark), padding: '10px 12px' }}>
          <div style={{ ...labelStyle, color: C.textDim, marginBottom: 5 }}>Poids soir</div>
          <div style={{ fontSize: 22, fontWeight: 800, color: T.green, lineHeight: 1 }}>
            {poidsKg != null ? poidsKg.toFixed(2) : '—'}
          </div>
          <div style={{ fontSize: 9, color: C.textDim, marginTop: 3 }}>kg</div>
          <div style={{ marginTop: 7, fontSize: 9, color: C.textDim, borderTop: `1px solid ${C.border}`, paddingTop: 5 }}>
            {finTour ? `fin tour ${finTour} UTC` : msgPoids || '—'}
          </div>
        </div>

        {/* Radiation */}
        <div style={{ ...subCellStyle(dark), padding: '10px 12px', background: T.amberLight(dark), border: `1px solid ${T.amberBorder(dark)}` }}>
          <div style={{ ...labelStyle, color: T.amber, marginBottom: 5 }}>Radiation Sum</div>
          <div style={{ fontSize: 22, fontWeight: 800, color: T.amberMid, lineHeight: 1 }}>
            {radiationSum != null ? radiationSum.toFixed(1) : '—'}
          </div>
          <div style={{ fontSize: 9, color: T.amber, marginTop: 3 }}>J/cm²</div>
          <div style={{ marginTop: 7, fontSize: 9, color: T.amber, opacity: 0.75, borderTop: `1px solid ${T.amberBorder(dark)}`, paddingTop: 5 }}>
            {radiationLive != null ? `${radiationLive.toFixed(0)} W/m² instant` : '—'}
          </div>
        </div>
      </div>

      {/* PRT Ressuyage */}
      <div style={{ ...subCellStyle(dark), padding: '10px 12px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
          <span style={{ ...labelStyle, color: C.textDim }}>% Ressuyage (PRT)</span>
          <span style={{
            fontSize: 9, color: C.textDim,
            background: C.toggleBg, borderRadius: 3,
            padding: '2px 6px', border: `1px solid ${C.border}`,
          }}>
            Cible {seuils.min}%–{seuils.max}% · {periode}
          </span>
        </div>

        {prt !== null ? (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 8 }}>
              <span style={{ fontSize: 28, fontWeight: 800, color: prtStatus?.color || C.text, lineHeight: 1 }}>
                {prt.toFixed(1)}%
              </span>
              <span style={{
                fontSize: 9, fontWeight: 700,
                color: prtStatus?.color,
                background: `${prtStatus?.color}18`,
                border: `1px solid ${prtStatus?.color}30`,
                borderRadius: 4, padding: '2px 8px',
              }}>
                {prtStatus?.ok ? '✓ Seuil atteint' : '⏳ En attente'}
              </span>
            </div>
            <div style={{ position: 'relative', height: 5, borderRadius: 3, background: C.border, overflow: 'hidden' }}>
              <div style={{
                position: 'absolute',
                left: `${(seuils.min / 20) * 100}%`,
                width: `${((seuils.max - seuils.min) / 20) * 100}%`,
                height: '100%',
                background: `${T.greenMid}20`,
              }} />
              <div style={{
                height: '100%', borderRadius: 3,
                background: prtStatus?.color || T.greenMid,
                width: `${Math.min(100, (prt / 20) * 100)}%`,
                transition: 'width 0.5s ease',
              }} />
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4, fontSize: 8, color: C.textDim }}>
              <span>0%</span>
              <span style={{ color: T.greenMid }}>↑ {seuils.min}%–{seuils.max}%</span>
              <span>20%</span>
            </div>
          </>
        ) : (
          <div style={{ fontSize: 10, color: C.textDim, padding: '4px 0' }}>
            En attente des données poids matin et soir…
          </div>
        )}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────
// PlanCard — Recommandation du jour
// ─────────────────────────────────────────────────────────────
function PlanCard({ rec, prtStatus, C, dark }) {
  if (!rec) return null
  const statut    = STATUT_MAP[rec.statut || 'non_disponible']
  const heureDebut = rec.heure_debut || null

  return (
    <div style={{ ...cardStyle(C), padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 12 }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
        <Activity size={13} color={T.greenMid} strokeWidth={2} />
        <span style={{ ...labelStyle, color: C.textMuted }}>Recommandation du jour</span>
        <span style={{
          marginLeft: 'auto', fontSize: 10, fontWeight: 700,
          color: statut.color,
          background: `${statut.color}15`,
          border: `1px solid ${statut.color}30`,
          borderRadius: 4, padding: '2px 9px',
        }}>{statut.label}</span>
      </div>

      {/* PRT badge inline */}
      {prtStatus && (
        <div style={{
          padding: '7px 12px', borderRadius: 7,
          background: `${prtStatus.color}10`,
          border: `1px solid ${prtStatus.color}25`,
          display: 'flex', alignItems: 'center', gap: 7,
        }}>
          <Scale size={11} color={prtStatus.color} strokeWidth={2} />
          <span style={{ fontSize: 11, fontWeight: 600, color: prtStatus.color }}>{prtStatus.msg}</span>
        </div>
      )}

      {/* Tours + Heure début */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>

        {/* Tours prévus */}
        <div style={{ ...subCellStyle(dark), padding: '12px 14px', textAlign: 'center' }}>
          <div style={{ ...labelStyle, color: C.textDim, marginBottom: 6 }}>Tours prévus</div>
          <div style={{ fontSize: 34, fontWeight: 800, color: T.green, lineHeight: 1 }}>
            {rec.nb_tours_prevu ?? '—'}
          </div>
          {rec.nb_tours_prevu > 0 && (
            <div style={{ marginTop: 8 }}>
              <div style={{ fontSize: 9, color: C.textDim, marginBottom: 3 }}>
                {rec.nb_tours_reel || 0} / {rec.nb_tours_prevu} effectués
              </div>
              <div style={{ height: 4, borderRadius: 2, background: C.border, overflow: 'hidden' }}>
                <div style={{
                  height: '100%', borderRadius: 2, background: T.greenMid,
                  width: `${Math.min(100, ((rec.nb_tours_reel || 0) / rec.nb_tours_prevu) * 100)}%`,
                  transition: 'width 0.5s ease',
                }} />
              </div>
            </div>
          )}
        </div>

        {/* Décision IA */}
        <div style={{
          ...subCellStyle(dark),
          padding: '12px 14px', textAlign: 'center',
          background: T.blueLight(dark),
          border: `1px solid ${T.blueBorder(dark)}`,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5, marginBottom: 6 }}>
            <Brain size={9} color={T.blueMid} strokeWidth={2} />
            <span style={{ ...labelStyle, color: T.blue }}>Décision IA · 1er tour</span>
          </div>
          <div style={{ fontSize: heureDebut ? 26 : 13, fontWeight: 800, color: T.blueMid, lineHeight: 1 }}>
            {heureDebut || '⏳ Calcul…'}
          </div>
          <div style={{ fontSize: 9, marginTop: 5, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5 }}>
            <span style={{ color: C.textDim }}>UTC</span>
            {heureDebut && (
              <span style={{
                background: T.blueLight(dark), border: `1px solid ${T.blueBorder(dark)}`,
                color: T.blueMid, borderRadius: 3, padding: '1px 5px',
                fontSize: 8, fontWeight: 700,
              }}>IA ONLY</span>
            )}
          </div>
        </div>
      </div>

      {/* Durées */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 7 }}>
        {[
          { label: 'Durée Tour 1', value: rec.duree_t12_min != null ? `${rec.duree_t12_min} min` : '—', color: T.green },
          { label: 'Durée Tour 2', value: rec.duree_t12_min != null ? `${rec.duree_t12_min} min` : '—', color: T.green },
          { label: 'Repos T1→T2',  value: rec.repos_t1_t2_min != null ? `${rec.repos_t1_t2_min} min` : rec.repos_initial_min != null ? `${rec.repos_initial_min} min` : '—', color: T.amberMid },
        ].map(s => (
          <div key={s.label} style={{ ...subCellStyle(dark), padding: '9px 10px', textAlign: 'center' }}>
            <div style={{ ...labelStyle, color: C.textDim, marginBottom: 5 }}>{s.label}</div>
            <div style={{ fontSize: 16, fontWeight: 800, color: s.color }}>{s.value}</div>
          </div>
        ))}
      </div>

      {/* Stade + EC cible */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 7 }}>
        <div style={{ ...subCellStyle(dark), padding: '9px 12px', display: 'flex', alignItems: 'center', gap: 9 }}>
          <Leaf size={14} color={T.greenMid} strokeWidth={2} />
          <div>
            <div style={{ ...labelStyle, color: C.textDim, marginBottom: 2 }}>Stade · J plantation</div>
            <div style={{ fontSize: 12, fontWeight: 700, color: T.green, textTransform: 'capitalize' }}>
              {rec.stade || '—'} · {rec.j_plantation != null ? `J+${rec.j_plantation}` : '—'}
            </div>
          </div>
        </div>
        <div style={{ ...subCellStyle(dark), padding: '9px 12px', display: 'flex', alignItems: 'center', gap: 9 }}>
          <FlaskConical size={14} color={T.purple} strokeWidth={2} />
          <div>
            <div style={{ ...labelStyle, color: C.textDim, marginBottom: 2 }}>EC cible</div>
            <div style={{ fontSize: 12, fontWeight: 700, color: T.purple }}>
              {rec.ec_cible_dSm != null ? `${rec.ec_cible_dSm} dS/m` : '—'}
            </div>
          </div>
        </div>
      </div>

      {/* Radiation Sum début du tour */}
      {heureDebut && (
        <div style={{
          background: T.amberLight(dark),
          border: `1px solid ${T.amberBorder(dark)}`,
          borderRadius: 8, padding: '10px 14px',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Sun size={14} color={T.amberMid} strokeWidth={2} />
            <div>
              <div style={{ ...labelStyle, color: T.amber, marginBottom: 2 }}>
                Radiation Sum — début du tour
              </div>
              <div style={{ fontSize: 9, color: T.amber, opacity: 0.75 }}>
                Valeur capteur à {heureDebut} UTC
              </div>
            </div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 20, fontWeight: 800, color: T.amberMid, lineHeight: 1 }}>
              {rec.radiation_sum_debut != null ? rec.radiation_sum_debut.toFixed(1) : '—'}
            </div>
            <div style={{ fontSize: 9, color: T.amber, marginTop: 2 }}>J/cm²</div>
          </div>
        </div>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────
// NPKCard
// ─────────────────────────────────────────────────────────────
function NPKCard({ rec, C, dark }) {
  if (!rec?.doses_npk) return null
  const npk = rec.doses_npk

  // Couleurs neutres pour les barres NPK — une teinte par canal
  const canaux = [
    { key: 'canal_A_g', label: 'Canal A (KNO₃)',   color: T.greenMid },
    { key: 'canal_B_g', label: 'Canal B (Ca·NO₃)', color: T.blueMid },
    { key: 'canal_C_g', label: 'Canal C (MgSO₄)',  color: T.purple },
    { key: 'canal_D_g', label: 'Canal D (K₂SO₄)',  color: T.amberMid },
  ]

  return (
    <div style={{ ...cardStyle(C), padding: '14px 16px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 12 }}>
        <FlaskConical size={13} color={T.purple} strokeWidth={2} />
        <span style={{ ...labelStyle, color: C.textMuted }}>Doses NPK / cycle</span>
        <span style={{ marginLeft: 'auto', fontSize: 10, color: C.textDim }}>
          EC cible : {rec.ec_cible_dSm ?? '—'} dS/m
        </span>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {canaux.map(c => {
          const val = npk[c.key]
          const max = Math.max(...canaux.map(x => npk[x.key] || 0))
          const pct = max > 0 ? (val / max) * 100 : 0
          return (
            <div key={c.key} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ width: 96, fontSize: 10, color: C.textMuted, flexShrink: 0 }}>{c.label}</div>
              <div style={{ flex: 1, height: 6, borderRadius: 3, background: C.border, overflow: 'hidden' }}>
                <div style={{
                  height: '100%', borderRadius: 3, background: c.color,
                  width: `${pct}%`, transition: 'width 0.5s ease',
                }} />
              </div>
              <div style={{ width: 48, fontSize: 11, fontWeight: 700, color: c.color, textAlign: 'right', flexShrink: 0 }}>
                {val != null ? `${val}g` : '—'}
              </div>
            </div>
          )
        })}
        <div style={{
          marginTop: 2, padding: '7px 10px',
          background: T.greenLight(dark),
          border: `1px solid ${T.greenBorder(dark)}`,
          borderRadius: 6, fontSize: 10, color: C.textMuted,
        }}>
          EC à ajouter : <strong style={{ color: T.green }}>{npk.ec_ajouter ?? '—'} dS/m</strong>
          {' '}· Dose totale : <strong style={{ color: T.green }}>{npk.dose_totale_g ?? '—'} g</strong>
          {' '}· Conc. : <strong style={{ color: T.green }}>{npk.concentration_g_L ?? '—'} g/L</strong>
        </div>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────
// TourTableMini
// ─────────────────────────────────────────────────────────────
function TourTableMini({ tours, C, dark }) {
  if (!tours || tours.length === 0) return null
  const valids = tours.filter(t => t.debut !== null)
  if (valids.length === 0) return (
    <div style={{
      ...cardStyle(C), padding: '28px 16px',
      textAlign: 'center', color: C.textDim, fontSize: 12,
    }}>
      Aucun tour démarré aujourd'hui
    </div>
  )

  return (
    <div style={{ ...cardStyle(C), overflow: 'hidden' }}>
      <div style={{
        padding: '9px 14px', borderBottom: `1px solid ${C.border}`,
        display: 'flex', alignItems: 'center', gap: 6,
      }}>
        <Clock size={11} color={T.greenMid} strokeWidth={2} />
        <span style={{ ...labelStyle, color: C.textMuted }}>
          Tours réels aujourd'hui ({valids.length})
        </span>
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: 'inherit', fontSize: 11 }}>
          <thead>
            <tr style={{ background: T.subBg(dark) }}>
              {['N°', 'Début', 'Fin', 'Durée', 'Rad. Sum', 'Cumul Rad.', 'EC Apport'].map(h => (
                <th key={h} style={{
                  padding: '7px 10px', textAlign: 'center',
                  color: C.textDim, fontWeight: 700, fontSize: 9,
                  textTransform: 'uppercase', letterSpacing: '0.06em',
                  borderBottom: `1px solid ${C.border}`,
                }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {valids.map((t, i) => (
              <tr key={i}
                style={{ borderBottom: i < valids.length - 1 ? `1px solid ${C.border}` : 'none' }}
                onMouseEnter={e => e.currentTarget.style.background = T.subBg(dark)}
                onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
              >
                <td style={{ padding: '7px 10px', textAlign: 'center' }}>
                  <div style={{
                    width: 22, height: 22, borderRadius: 5, margin: '0 auto',
                    background: T.greenLight(dark), border: `1px solid ${T.greenBorder(dark)}`,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 11, fontWeight: 800, color: T.green,
                  }}>
                    {t.tour_num}
                  </div>
                </td>
                <td style={{ padding: '7px 10px', textAlign: 'center', color: C.text, fontWeight: 600 }}>{t.debut || '—'}</td>
                <td style={{ padding: '7px 10px', textAlign: 'center', color: C.textMuted }}>{t.fin || '—'}</td>
                <td style={{ padding: '7px 10px', textAlign: 'center', color: C.textMuted }}>{t.prg_time_min != null ? `${t.prg_time_min} min` : '—'}</td>
                <td style={{ padding: '7px 10px', textAlign: 'center', color: T.amberMid, fontWeight: 600 }}>{t.radiation_sum != null ? t.radiation_sum.toFixed(1) : '—'}</td>
                <td style={{ padding: '7px 10px', textAlign: 'center', color: T.amberMid, fontWeight: 600 }}>{t.cumul_radiation != null ? t.cumul_radiation.toFixed(1) : '—'}</td>
                <td style={{ padding: '7px 10px', textAlign: 'center', color: T.greenMid, fontWeight: 600 }}>{t.ec_apport != null ? t.ec_apport.toFixed(2) : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────
// AjustementPanel
// ─────────────────────────────────────────────────────────────
function AjustementPanel({ ajustements, C, dark }) {
  if (!ajustements || ajustements.length === 0) return (
    <div style={{ textAlign: 'center', padding: '24px 0', color: C.textDim, fontSize: 12 }}>
      Aucun ajustement encore — en attente du premier tour
    </div>
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
      {[...ajustements].reverse().map((a, i) => {
        const cfgRaw = ACTION_COLORS[a.action] || { color: C.textMuted, bg: () => C.toggleBg, icon: Info }
        const color  = cfgRaw.color
        const bg     = typeof cfgRaw.bg === 'function' ? cfgRaw.bg(dark) : cfgRaw.bg
        const AIcon  = cfgRaw.icon
        return (
          <div key={i} style={{
            background: bg, border: `1px solid ${color}25`,
            borderRadius: 9, padding: '10px 13px',
            display: 'flex', flexDirection: 'column', gap: 5,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{
                width: 24, height: 24, borderRadius: 6, flexShrink: 0,
                background: `${color}18`, border: `1px solid ${color}30`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <AIcon size={12} color={color} strokeWidth={2.5} />
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ fontSize: 11, fontWeight: 700, color }}>Tour {a.tour}</span>
                  <span style={{
                    fontSize: 9, fontWeight: 700, color,
                    background: `${color}15`, border: `1px solid ${color}30`,
                    borderRadius: 3, padding: '1px 6px',
                  }}>{a.action}</span>
                  {a.drainage_reel != null && (
                    <span style={{ marginLeft: 'auto', fontSize: 10, color: C.textDim }}>
                      Drain : <strong style={{ color }}>{a.drainage_reel.toFixed(1)}%</strong>
                    </span>
                  )}
                </div>
                <div style={{ fontSize: 11, color: C.textMuted, marginTop: 2 }}>{a.raison}</div>
              </div>
            </div>
            {!a.stop && (
              <div style={{ display: 'flex', gap: 12, paddingLeft: 32, fontSize: 11 }}>
                <span style={{ color: C.textDim }}>Repos : <strong style={{ color: C.text }}>{a.repos_suivant_min} min</strong></span>
                <span style={{ color: C.textDim }}>Durée : <strong style={{ color: C.text }}>{a.duree_suivant_min} min</strong></span>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────
// ConfigModal
// ─────────────────────────────────────────────────────────────
function ConfigModal({ deviceId, token, onClose, C, dark }) {
  const [cfg, setCfg]       = useState(null)
  const [saving, setSaving] = useState(false)
  const [form, setForm]     = useState({ date_plantation: '', actif: true })

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
    width: '100%', padding: '8px 11px', borderRadius: 7,
    border: `1px solid ${C.border}`, background: C.inputBg,
    color: C.text, fontSize: 12, fontFamily: 'inherit', outline: 'none',
    boxSizing: 'border-box',
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 99999, background: 'rgba(0,0,0,0.55)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24,
    }}>
      <div style={{
        background: C.card, border: `1px solid ${C.border}`,
        borderRadius: 12, padding: '22px 26px', width: '100%', maxWidth: 400,
        boxShadow: '0 16px 60px rgba(0,0,0,0.35)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 18 }}>
          <Settings size={14} color={T.greenMid} strokeWidth={2} />
          <div style={{ fontSize: 13, fontWeight: 700, color: C.text }}>Configuration IA — AZ106</div>
          <button onClick={onClose} style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer', color: C.textDim }}>
            <X size={14} strokeWidth={2} />
          </button>
        </div>

        {!cfg ? (
          <div style={{ textAlign: 'center', color: C.textDim, padding: 24 }}>Chargement…</div>
        ) : (
          <>
            <div style={{ marginBottom: 12 }}>
              <label style={{ display: 'block', color: C.textMuted, fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 5 }}>
                Date de plantation
              </label>
              <input type="date" value={form.date_plantation}
                onChange={e => setForm(p => ({ ...p, date_plantation: e.target.value }))}
                style={inputSt} />
              <div style={{ fontSize: 10, color: C.textDim, marginTop: 4 }}>
                Utilisé pour calculer le stade agronomique
              </div>
            </div>

            <div style={{ marginBottom: 18 }}>
              <label style={{ display: 'block', color: C.textMuted, fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 5 }}>
                Agent IA actif
              </label>
              <div style={{ display: 'flex', gap: 7 }}>
                {[true, false].map(v => (
                  <button key={String(v)}
                    onClick={() => setForm(p => ({ ...p, actif: v }))}
                    style={{
                      flex: 1, padding: '7px', borderRadius: 6, fontFamily: 'inherit',
                      border: `1px solid ${form.actif === v ? T.greenMid : C.border}`,
                      background: form.actif === v ? T.greenLight(dark) : 'transparent',
                      color: form.actif === v ? T.green : C.textMuted,
                      fontSize: 12, fontWeight: 600, cursor: 'pointer',
                    }}>
                    {v ? 'Activé' : 'Désactivé'}
                  </button>
                ))}
              </div>
            </div>

            <div style={{
              marginBottom: 18, padding: '9px 12px', borderRadius: 7,
              background: T.greenLight(dark), border: `1px solid ${T.greenBorder(dark)}`,
              fontSize: 11, color: C.textMuted, lineHeight: 1.6,
            }}>
              <strong style={{ color: T.green }}>EC bassin :</strong> fixe 0.7–0.8 dS/m (eau source Azura)<br />
              <strong style={{ color: T.green }}>Méthode :</strong> Hybride (règles agronomiques + ML)
            </div>

            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button onClick={onClose} style={{
                padding: '7px 16px', borderRadius: 7,
                border: `1px solid ${C.border}`, background: 'transparent',
                color: C.textMuted, fontSize: 12, fontFamily: 'inherit', cursor: 'pointer',
              }}>Annuler</button>
              <button onClick={handleSave} disabled={saving} style={{
                display: 'flex', alignItems: 'center', gap: 5,
                padding: '7px 18px', borderRadius: 7,
                background: saving ? C.toggleBg : T.greenMid, color: '#fff',
                border: 'none', fontSize: 12, fontWeight: 700,
                fontFamily: 'inherit', cursor: saving ? 'not-allowed' : 'pointer',
              }}>
                <Save size={11} strokeWidth={2.5} />
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
  const C       = CProps || getColors(dark)
  const width   = useWindowWidth()
  const isMobile = width < 640

  const [az106Device,  setAz106Device]  = useState(null)
  const [rec,          setRec]          = useState(null)
  const [tours,        setTours]        = useState([])
  const [weight,       setWeight]       = useState(null)
  const [deviceLatest, setDeviceLatest] = useState(null)
  const [loading,      setLoading]      = useState(true)
  const [refreshing,   setRefreshing]   = useState(false)
  const [showConfig,   setShowConfig]   = useState(false)
  const [error,        setError]        = useState('')
  const [poidsSoir,    setPoidsSoir]    = useState(null)

  const intervalRef = useRef(null)
  const today       = new Date().toISOString().split('T')[0]
  const mois        = new Date().getMonth() + 1

  useEffect(() => {
    getDevices(token).then(farms => {
      const az = farms.find(f => f.farm_name === AZ106_FARM || f.farm_name?.includes('AZ106'))
      if (az?.houses?.length > 0) {
        setAz106Device(az.houses[0])
      } else {
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
    try { setDeviceLatest(await getDeviceLatest(token, az106Device.id)) } catch {}
  }, [az106Device, token])

  const prt       = weight?.poids_kg && weight?.poids_kg_matin
    ? calculerPRT(weight.poids_kg, weight.poids_kg_matin) : null
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
    intervalRef.current = setInterval(() => {
      loadWeight(); loadDeviceLatest(); loadRec(true)
    }, 30_000)
    return () => clearInterval(intervalRef.current)
  }, [loadRec, loadWeight, loadDeviceLatest, az106Device])

  // ── Button shared style ───────────────────────────────────
  const btnStyle = {
    display: 'flex', alignItems: 'center', gap: 5,
    padding: '6px 12px', borderRadius: 7,
    border: `1px solid ${C.border}`,
    background: C.toggleBg, color: C.textMuted,
    fontSize: 11, fontWeight: 600, fontFamily: 'inherit', cursor: 'pointer',
  }

  return (
    <div style={{ animation: 'az-fade-in 0.3s ease both' }}>

      {showConfig && az106Device && (
        <ConfigModal deviceId={az106Device.id} token={token}
          onClose={() => { setShowConfig(false); loadRec() }}
          C={C} dark={dark} />
      )}

      {/* ── Header ─────────────────────────────────────────── */}
      <div style={{
        display: 'flex', alignItems: isMobile ? 'flex-start' : 'center',
        flexDirection: isMobile ? 'column' : 'row',
        justifyContent: 'space-between', marginBottom: 20, gap: 10,
      }}>
        <div>
          <h1 style={{
            fontSize: isMobile ? 17 : 20, fontWeight: 800, color: C.text,
            marginBottom: 3, display: 'flex', alignItems: 'center', gap: 8,
          }}>
            <Brain size={isMobile ? 17 : 20} color={T.greenMid} strokeWidth={2} />
            Agent IA Irrigation
          </h1>
          <p style={{ fontSize: 11, color: C.textDim }}>
            Station AZ106 · Recommandation automatique · {today}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 7 }}>
          <button
            onClick={() => { loadWeight(); loadDeviceLatest(); loadRec(true) }}
            disabled={refreshing}
            style={btnStyle}
          >
            <RefreshCw size={11} strokeWidth={2}
              style={{ animation: refreshing ? 'az-spin 0.7s linear infinite' : 'none' }} />
            {!isMobile && 'Actualiser'}
          </button>
          {az106Device && (
            <button onClick={() => setShowConfig(true)} style={btnStyle}>
              <Settings size={11} strokeWidth={2} />
              {!isMobile && 'Date plantation'}
            </button>
          )}
        </div>
      </div>

      {/* ── Error ──────────────────────────────────────────── */}
      {error && (
        <div style={{
          padding: '9px 13px', borderRadius: 7, marginBottom: 14,
          background: `${T.red}10`, border: `1px solid ${T.red}25`,
          color: T.red, fontSize: 12,
        }}>
          ⚠ {error}
        </div>
      )}

      {/* ── Device banner ──────────────────────────────────── */}
      {az106Device && (
        <div style={{
          ...cardStyle(C),
          padding: '9px 14px', marginBottom: 14,
          display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
        }}>
          <div style={{
            width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
            background: deviceLatest?.online ? T.greenMid : T.red,
            boxShadow: deviceLatest?.online ? `0 0 6px ${T.greenMid}60` : 'none',
          }} />
          <div>
            <div style={{ fontSize: 12, fontWeight: 700, color: C.text }}>
              {az106Device.farm_name} — Station {az106Device.house_number}
            </div>
            <div style={{ fontSize: 10, color: C.textDim }}>
              {deviceLatest?.online ? 'En ligne' : 'Hors ligne'} · Méthode : hybride (règles + ML)
            </div>
          </div>
          {deviceLatest?.sensor?.radiation_sum != null && (
            <div style={{
              marginLeft: 'auto',
              display: 'flex', alignItems: 'center', gap: 5,
              padding: '4px 10px', borderRadius: 6,
              background: T.amberLight(dark), border: `1px solid ${T.amberBorder(dark)}`,
            }}>
              <Zap size={10} color={T.amberMid} strokeWidth={2} />
              <span style={{ fontSize: 11, fontWeight: 700, color: T.amberMid }}>
                {deviceLatest.sensor.radiation_sum.toFixed(1)} J/cm²
              </span>
              <span style={{ fontSize: 9, color: T.amber }}>Rad. Sum</span>
            </div>
          )}
        </div>
      )}

      {/* ── Main grid ──────────────────────────────────────── */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: isMobile ? '1fr' : '280px 1fr',
        gap: 14,
        alignItems: 'start',
      }}>
        {/* Colonne gauche */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <PRTCard
            weight={weight}
            poidsSoir={poidsSoir}
            deviceLatest={deviceLatest}
            prtBackend={rec?.pct_ressuyage}
            C={C} dark={dark}
          />

          {rec?.stade && (
            <div style={{
              ...cardStyle(C), padding: '10px 14px',
              display: 'flex', alignItems: 'center', gap: 9,
            }}>
              <Leaf size={13} color={T.greenMid} strokeWidth={2} />
              <div>
                <div style={{ ...labelStyle, color: C.textDim, marginBottom: 2 }}>Stade phénologique</div>
                <div style={{ fontSize: 13, fontWeight: 700, color: T.green, textTransform: 'capitalize' }}>
                  {rec.stade}
                </div>
              </div>
              <div style={{ marginLeft: 'auto', textAlign: 'right' }}>
                <div style={{ ...labelStyle, color: C.textDim, marginBottom: 2 }}>J plantation</div>
                <div style={{ fontSize: 13, fontWeight: 700, color: C.text }}>
                  {rec.j_plantation != null ? `J+${rec.j_plantation}` : '—'}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Colonne droite */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>

          {/* Loading */}
          {loading && (
            <div style={{
              display: 'flex', alignItems: 'center', gap: 9,
              color: C.textDim, fontSize: 12, padding: '60px 0', justifyContent: 'center',
            }}>
              <RefreshCw size={15} style={{ animation: 'az-pulse 1.2s ease-in-out infinite' }} />
              Génération automatique de la recommandation IA…
            </div>
          )}

          {!loading && !az106Device && (
            <div style={{ textAlign: 'center', padding: '60px 0', color: C.textDim, fontSize: 12 }}>
              Station AZ106 non trouvée
            </div>
          )}

          {/* Attente PRT */}
          {!loading && rec && rec.statut === 'en_attente_prt' && (
            <div style={{
              ...cardStyle(C),
              padding: '36px 24px', textAlign: 'center',
              display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14,
            }}>
              <div style={{
                width: 52, height: 52, borderRadius: '50%',
                background: T.amberLight(dark), border: `1px solid ${T.amberBorder(dark)}`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <Scale size={24} color={T.amberMid} strokeWidth={1.5} />
              </div>
              <div>
                <div style={{ fontSize: 14, fontWeight: 700, color: C.text, marginBottom: 7 }}>
                  En attente du seuil de ressuyage
                </div>
                <div style={{ fontSize: 12, color: C.textDim, lineHeight: 1.7, maxWidth: 360 }}>
                  {rec.message}
                </div>
              </div>
              {rec.pct_ressuyage != null && (
                <div style={{
                  padding: '12px 24px', borderRadius: 9,
                  background: T.amberLight(dark), border: `1px solid ${T.amberBorder(dark)}`,
                }}>
                  <div style={{ fontSize: 28, fontWeight: 800, color: T.amberMid }}>
                    {rec.pct_ressuyage.toFixed(1)}%
                  </div>
                  <div style={{ fontSize: 10, color: T.amber, marginTop: 2 }}>PRT Ressuyage actuel</div>
                </div>
              )}
              <div style={{ fontSize: 11, color: C.textDim }}>
                Vérification automatique toutes les 30 secondes…
              </div>
            </div>
          )}

          {/* Attente Radiation */}
          {!loading && rec && rec.statut === 'en_attente_radiation' && (
            <div style={{
              ...cardStyle(C),
              padding: '36px 24px', textAlign: 'center',
              display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14,
            }}>
              <div style={{
                width: 52, height: 52, borderRadius: '50%',
                background: T.blueLight(dark), border: `1px solid ${T.blueBorder(dark)}`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <Sun size={24} color={T.blueMid} strokeWidth={1.5} />
              </div>
              <div>
                <div style={{ fontSize: 14, fontWeight: 700, color: C.text, marginBottom: 7 }}>
                  PRT ✓ — En attente du seuil de radiation
                </div>
                <div style={{ fontSize: 12, color: C.textDim, lineHeight: 1.7, maxWidth: 360 }}>
                  {rec.message}
                </div>
              </div>
              {rec.nb_tours_prevu > 0 && (
                <div style={{
                  padding: '12px 24px', borderRadius: 9,
                  background: T.blueLight(dark), border: `1px solid ${T.blueBorder(dark)}`,
                }}>
                  <div style={{ fontSize: 28, fontWeight: 800, color: T.blueMid }}>
                    {rec.nb_tours_prevu} tours
                  </div>
                  <div style={{ fontSize: 10, color: T.blue, marginTop: 2 }}>
                    Plan prévu · début dès seuil atteint
                  </div>
                </div>
              )}
              {deviceLatest?.sensor?.radiation_sum != null && (
                <div style={{ fontSize: 12, fontWeight: 600, color: T.amberMid }}>
                  Radiation actuelle : {deviceLatest.sensor.radiation_sum.toFixed(1)} J/cm²
                </div>
              )}
              <div style={{ fontSize: 11, color: C.textDim }}>
                Vérification automatique toutes les 30 secondes…
              </div>
            </div>
          )}

          {/* Recommandation complète */}
          {!loading && rec && rec.statut !== 'en_attente_prt' && rec.statut !== 'en_attente_radiation' && (
            <>
              <PlanCard rec={rec} prtStatus={prtStatus} C={C} dark={dark} />
              <TourTableMini tours={tours} C={C} dark={dark} />
            </>
          )}

          {/* Pas encore de données */}
          {!loading && !rec && !error && az106Device && (
            <div style={{
              ...cardStyle(C), padding: '40px 24px', textAlign: 'center',
            }}>
              <Brain size={28} color={T.greenMid} strokeWidth={1.5}
                style={{ display: 'block', margin: '0 auto 10px' }} />
              <div style={{ fontSize: 13, fontWeight: 700, color: C.text, marginBottom: 5 }}>
                Génération en cours…
              </div>
              <div style={{ fontSize: 11, color: C.textDim, lineHeight: 1.6 }}>
                La recommandation IA se génère automatiquement chaque matin à 6h00.<br />
                Configurez la date de plantation via le bouton <strong>Date plantation</strong>.
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}