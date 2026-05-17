// ============================================================
// frontend/src/pages/AgentIAPage.jsx
// Agent IA — AZ106 uniquement · Ressuyage depuis capteur poids
// Recommandation automatique sans bouton Générer
// Projet Azura Irrigation IA — GOUSSA Oussama
// ============================================================

import { useState, useEffect, useRef, useCallback } from 'react'
import { createPortal } from 'react-dom'
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
const AZ106_FARM = 'AZ106'   // Ferme avec capteur poids
const PRT_SEUILS = {         // Seuils ressuyage par période
  froid:      { min: 10.0, max: 12.0 }, // Nov–Fév
  chaud:      { min:  8.0, max:  9.0 }, // Avr–Jul
  transition: { min:  9.0, max: 10.5 }, // autres
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
async function getDeviceTours(token, deviceId, date) {
  return fetchWithToken(`/api/devices/${deviceId}/tours?date=${date}`, token)
}
async function getLatestWeight(token, farmName) {
  return fetchWithToken(`/api/weight/${farmName}/latest`, token)
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

const SCENARIO_ICONS = {
  ensoleille           : Sun,
  nuageux              : CloudRain,
  chergui              : Wind,
  brouillard           : CloudRain,
  pluie                : CloudRain,
  hiver_clair          : Sun,
  hiver_nuageux        : CloudRain,
  ressuyage_eleve      : TrendingUp,
  ressuyage_trop_faible: TrendingDown,
}

const STATUT_MAP = {
  en_cours      : { label: 'En cours',     color: '#4d9de0' },
  optimal       : { label: 'Optimal ✓',    color: '#34d96f' },
  a_ajuster     : { label: 'À surveiller', color: '#f5a623' },
  arrete        : { label: 'Arrêté',       color: '#f05252' },
  pluie         : { label: 'Pluie – arrêt',color: '#4d9de0' },
  non_disponible: { label: '—',            color: '#9cb8a6' },
}

// ─────────────────────────────────────────────────────────────
// Calcul PRT Ressuyage
// ─────────────────────────────────────────────────────────────
function calculerPRT(poidsSoir, poidsMatin) {
  if (!poidsSoir || !poidsMatin || poidsSoir <= 0) return null
  return ((poidsSoir - poidsMatin) / poidsSoir) * 100
}

function getPRTStatus(prt, mois) {
  if (prt === null) return null
  const periode = getPeriode(mois)
  const s = PRT_SEUILS[periode]
  if (prt < s.min) return { ok: false, msg: `PRT ${prt.toFixed(1)}% < ${s.min}% → attendre`, color: '#f5a623' }
  if (prt > s.max) return { ok: false, msg: `PRT ${prt.toFixed(1)}% > ${s.max}% → avancer début`, color: '#4d9de0' }
  return { ok: true, msg: `PRT ${prt.toFixed(1)}% ✓ dans la plage`, color: '#34d96f' }
}

// ─────────────────────────────────────────────────────────────
// SUB-COMPONENTS
// ─────────────────────────────────────────────────────────────

// Carte PRT Ressuyage + Poids
function PRTCard({ weight, poidsSoir: poidsSoirData, deviceLatest, prtBackend, C, dark }) {
  const mois = new Date().getMonth() + 1
  const periode = getPeriode(mois)
  const seuils = PRT_SEUILS[periode]
  const prt = prtBackend ?? null
  const prtStatus = prt !== null ? getPRTStatus(prt, mois) : null

  const poidsKg    = poidsSoirData?.poids_soir ?? null   // poids soir réel depuis BDD
  const finTour    = poidsSoirData?.fin_tour ?? null      // heure fin dernier tour
  const msgPoids   = poidsSoirData?.message ?? null

  const radiationSum = deviceLatest?.sensor?.radiation_sum ?? null
  const radiationLive = deviceLatest?.sensor?.radiation ?? null

  return (
    <div style={{
      background: C.surface,
      border: `1.5px solid ${C.border}`,
      borderRadius: 14,
      padding: '16px 18px',
      display: 'flex',
      flexDirection: 'column',
      gap: 12,
    }}>

      {/* ── Header ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <Scale size={13} color={C.green} strokeWidth={2} />
        <span style={{
          fontSize: 11, fontWeight: 700, color: C.textMuted,
          textTransform: 'uppercase', letterSpacing: '0.08em',
        }}>
          Capteur Poids · AZ106
        </span>
        {weight && (
          <span style={{
            marginLeft: 'auto', fontSize: 10, color: C.textDim,
            background: `${C.green}12`, border: `1px solid ${C.green}25`,
            borderRadius: 5, padding: '2px 8px', fontWeight: 600,
          }}>
            {new Date(weight.timestamp).toLocaleTimeString('fr-FR', {
              hour: '2-digit', minute: '2-digit',
            })}
          </span>
        )}
      </div>

      {/* ── Poids + Radiation sur une ligne ── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>

        {/* Poids */}
        <div style={{
          background: dark ? '#0a1a0d' : '#f0faf2',
          border: `1px solid ${C.green}25`,
          borderRadius: 10, padding: '12px 14px',
        }}>
          <div style={{
            fontSize: 9, color: C.textDim, textTransform: 'uppercase',
            letterSpacing: '0.07em', marginBottom: 6,
          }}>Poids soir</div>
          <div style={{ fontSize: 24, fontWeight: 900, color: C.green, lineHeight: 1 }}>
            {poidsKg != null ? poidsKg.toFixed(2) : '—'}
          </div>
          <div style={{ fontSize: 10, color: C.textDim, marginTop: 4 }}>kg</div>
          <div style={{
            marginTop: 6, fontSize: 9, color: C.textDim,
            borderTop: `1px solid ${C.border}`, paddingTop: 5,
          }}>
            {finTour
              ? `20min après fin tour (${finTour} UTC)`
              : msgPoids || '—'}
          </div>
        </div>

        {/* Radiation */}
        <div style={{
          background: dark ? '#1a1500' : '#fffbea',
          border: `1px solid #f5e64225`,
          borderRadius: 10, padding: '12px 14px',
        }}>
          <div style={{
            fontSize: 9, color: C.textDim, textTransform: 'uppercase',
            letterSpacing: '0.07em', marginBottom: 6,
          }}>Radiation Sum</div>
          <div style={{ fontSize: 24, fontWeight: 900, color: '#f5e642', lineHeight: 1 }}>
            {radiationSum != null ? radiationSum.toFixed(1) : '—'}
          </div>
          <div style={{ fontSize: 10, color: C.textDim, marginTop: 4 }}>J/cm²</div>
          <div style={{
            marginTop: 6, fontSize: 9, color: C.textDim,
            borderTop: `1px solid ${C.border}`, paddingTop: 5,
          }}>
            {radiationLive != null ? `${radiationLive.toFixed(0)} W/m² instant` : '—'}
          </div>
        </div>
      </div>

      {/* ── PRT Ressuyage ── */}
      <div style={{
        background: dark ? '#0d1610' : '#f4f9f5',
        border: `1px solid ${C.border}`,
        borderRadius: 10, padding: '12px 14px',
      }}>
        {/* Label + cible */}
        <div style={{
          display: 'flex', alignItems: 'center',
          justifyContent: 'space-between', marginBottom: 10,
        }}>
          <span style={{
            fontSize: 9, fontWeight: 700, color: C.textDim,
            textTransform: 'uppercase', letterSpacing: '0.07em',
          }}>% Ressuyage (PRT)</span>
          <span style={{
            fontSize: 9, color: C.textDim,
            background: C.toggleBg, borderRadius: 4,
            padding: '2px 7px', border: `1px solid ${C.border}`,
          }}>
            Cible {seuils.min}%–{seuils.max}% · {periode}
          </span>
        </div>

        {prt !== null ? (
          <>
            {/* Valeur + badge statut */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
              <span style={{
                fontSize: 32, fontWeight: 900,
                color: prtStatus?.color || C.text, lineHeight: 1,
              }}>
                {prt.toFixed(1)}%
              </span>
              <span style={{
                fontSize: 10, fontWeight: 700,
                color: prtStatus?.color,
                background: `${prtStatus?.color}15`,
                border: `1px solid ${prtStatus?.color}35`,
                borderRadius: 5, padding: '3px 9px',
              }}>
                {prtStatus?.ok ? '✓ Seuil atteint' : '⏳ En attente'}
              </span>
            </div>

            {/* Barre progression */}
            <div style={{ position: 'relative', height: 6, borderRadius: 3,
              background: C.border, overflow: 'hidden' }}>
              {/* Zone cible */}
              <div style={{
                position: 'absolute',
                left: `${(seuils.min / 20) * 100}%`,
                width: `${((seuils.max - seuils.min) / 20) * 100}%`,
                height: '100%',
                background: `${C.green}25`,
              }} />
              {/* Valeur actuelle */}
              <div style={{
                height: '100%', borderRadius: 3,
                background: prtStatus?.color || C.green,
                width: `${Math.min(100, (prt / 20) * 100)}%`,
                transition: 'width 0.5s ease',
              }} />
            </div>
            <div style={{
              display: 'flex', justifyContent: 'space-between',
              marginTop: 4, fontSize: 9, color: C.textDim,
            }}>
              <span>0%</span>
              <span style={{ color: C.green }}>
                ↑ {seuils.min}%–{seuils.max}%
              </span>
              <span>20%</span>
            </div>
          </>
        ) : (
          <div style={{
            fontSize: 10, color: C.textDim, padding: '4px 0',
          }}>
            En attente des données poids matin et soir…
          </div>
        )}
      </div>
    </div>
  )
}

// Carte Plan Journée
function PlanCard({ rec, prtStatus, C, dark }) {
  if (!rec) return null
  const statut = STATUT_MAP[rec.statut || 'non_disponible']
  const heureDebut = rec.heure_debut || null

  return (
    <div style={{
      background: C.surface, border: `1.5px solid ${C.border}`,
      borderRadius: 14, padding: '18px 20px',
      display: 'flex', flexDirection: 'column', gap: 14,
    }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <Activity size={14} color={C.green} strokeWidth={2} />
        <span style={{ fontSize: 11, fontWeight: 700, color: C.textMuted,
          textTransform: 'uppercase', letterSpacing: '0.08em' }}>
          Recommandation du jour
        </span>
        <span style={{
          marginLeft: 'auto', fontSize: 10, fontWeight: 700,
          color: statut.color, background: `${statut.color}18`,
          border: `1px solid ${statut.color}35`,
          borderRadius: 4, padding: '2px 10px',
        }}>{statut.label}</span>
      </div>

      {/* PRT badge */}
      {prtStatus && (
        <div style={{
          padding: '8px 14px', borderRadius: 9,
          background: `${prtStatus.color}10`,
          border: `1px solid ${prtStatus.color}30`,
          display: 'flex', alignItems: 'center', gap: 8,
        }}>
          <Scale size={12} color={prtStatus.color} strokeWidth={2} />
          <span style={{ fontSize: 11, fontWeight: 700, color: prtStatus.color }}>
            {prtStatus.msg}
          </span>
        </div>
      )}

      {/* Tours + Heure début */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <div style={{
          background: dark ? '#0a1a0d' : '#f0faf2',
          border: `1.5px solid ${C.green}30`,
          borderRadius: 12, padding: '14px 16px', textAlign: 'center',
        }}>
          <div style={{ fontSize: 9, color: C.textDim, textTransform: 'uppercase',
            letterSpacing: '0.07em', marginBottom: 6 }}>Tours prévus</div>
          <div style={{ fontSize: 36, fontWeight: 900, color: C.green, lineHeight: 1 }}>
            {rec.nb_tours_prevu ?? '—'}
          </div>
          {rec.nb_tours_prevu > 0 && (
            <div style={{ marginTop: 8 }}>
              <div style={{ fontSize: 9, color: C.textDim, marginBottom: 5 }}>
                {rec.nb_tours_reel || 0} / {rec.nb_tours_prevu} effectués
              </div>
              <div style={{ height: 4, borderRadius: 2, background: C.border, overflow: 'hidden' }}>
                <div style={{
                  height: '100%', borderRadius: 2, background: C.green,
                  width: `${Math.min(100, ((rec.nb_tours_reel || 0) / rec.nb_tours_prevu) * 100)}%`,
                  transition: 'width 0.5s ease',
                }} />
              </div>
            </div>
          )}
        </div>

        <div style={{
          background: dark ? '#0a0f1a' : '#f0f5ff',
          border: `1.5px solid #4d9de030`,
          borderRadius: 12, padding: '14px 16px', textAlign: 'center',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center',
            gap: 5, marginBottom: 6 }}>
            <Brain size={10} color='#4d9de0' strokeWidth={2} />
            <span style={{ fontSize: 9, color: C.textDim, textTransform: 'uppercase',
              letterSpacing: '0.07em' }}>Heure de 1er tour</span>
          </div>
          <div style={{ fontSize: heureDebut ? 36 : 25, fontWeight: 900,
            color: heureDebut ? '#4d9de0' : C.amber, lineHeight: 1 }}>
            {heureDebut || '⏳ Calcul...'}
          </div>
          <div style={{ fontSize: 9, marginTop: 6, display: 'flex',
            alignItems: 'center', justifyContent: 'center', gap: 4 }}>
            <span style={{ color: C.textDim }}>UTC</span>
          </div>
        </div>
      </div>

      {/* Durée T1, T2, Repos */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
        {[
          { label: 'Durée Tour 1', value: rec.duree_t12_min != null ? `${rec.duree_t12_min} min` : '—', color: C.green },
          { label: 'Durée Tour 2', value: rec.duree_t12_min != null ? `${rec.duree_t12_min} min` : '—', color: C.green },
          { label: 'Repos T1 → T2', value: rec.repos_t1_t2_min != null ? `${rec.repos_t1_t2_min} min` : rec.repos_initial_min != null ? `${rec.repos_initial_min} min` : '—', color: C.amber },
        ].map(s => (
          <div key={s.label} style={{
            background: dark ? '#0d1610' : '#f4f9f5',
            border: `1px solid ${C.border}`,
            borderRadius: 10, padding: '10px 12px', textAlign: 'center',
          }}>
            <div style={{ fontSize: 9, color: C.textDim, textTransform: 'uppercase',
              letterSpacing: '0.05em', marginBottom: 5 }}>{s.label}</div>
            <div style={{ fontSize: 18, fontWeight: 800, color: s.color }}>{s.value}</div>
          </div>
        ))}
      </div>

      {/* Stade + EC cible */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        <div style={{
          background: dark ? '#0d1610' : '#f4f9f5',
          border: `1px solid ${C.border}`,
          borderRadius: 10, padding: '10px 14px',
          display: 'flex', alignItems: 'center', gap: 10,
        }}>
          <Leaf size={16} color='#34d96f' strokeWidth={2} />
          <div>
            <div style={{ fontSize: 9, color: C.textDim, textTransform: 'uppercase',
              letterSpacing: '0.05em', marginBottom: 2 }}>Stade · J plantation</div>
            <div style={{ fontSize: 13, fontWeight: 800, color: '#34d96f', textTransform: 'capitalize' }}>
              {rec.stade || '—'} · {rec.j_plantation != null ? `J+${rec.j_plantation}` : '—'}
            </div>
          </div>
        </div>
        <div style={{
          background: dark ? '#0d1610' : '#f4f9f5',
          border: `1px solid ${C.border}`,
          borderRadius: 10, padding: '10px 14px',
          display: 'flex', alignItems: 'center', gap: 10,
        }}>
          <FlaskConical size={16} color='#b197fc' strokeWidth={2} />
          <div>
            <div style={{ fontSize: 9, color: C.textDim, textTransform: 'uppercase',
              letterSpacing: '0.05em', marginBottom: 2 }}>EC cible</div>
            <div style={{ fontSize: 13, fontWeight: 800, color: '#b197fc' }}>
              {rec.ec_cible_dSm != null ? `${rec.ec_cible_dSm} dS/m` : '—'}
            </div>
          </div>
        </div>
      </div>

      {/* Radiation Sum — uniquement si heure début définie */}
      {heureDebut && (
        <div style={{
          background: dark ? '#1a1500' : '#fffbea',
          border: `1.5px solid #f5e64240`,
          borderRadius: 10, padding: '12px 16px',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Sun size={16} color='#f5e642' strokeWidth={2} />
            <div>
              <div style={{ fontSize: 9, color: C.textDim, textTransform: 'uppercase',
                letterSpacing: '0.05em', marginBottom: 2 }}>
                Radiation Sum au début du tour
              </div>
              <div style={{ fontSize: 9, color: C.textDim }}>Valeur capteur à {heureDebut} UTC</div>
            </div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 22, fontWeight: 900, color: '#f5e642' }}>
              {rec.radiation_sum_debut != null ? `${rec.radiation_sum_debut.toFixed(1)}` : '—'}
            </div>
            <div style={{ fontSize: 9, color: C.textDim }}>J/cm²</div>
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
    { key: 'canal_A_g', label: 'Canal A (KNO₃)',   color: '#34d96f', note: 'N + K' },
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
              <div style={{ width: 90, fontSize: 10, color: C.textMuted, flexShrink: 0 }}>
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
        <div style={{
          marginTop: 4, padding: '7px 10px',
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

// Tableau des tours
function TourTableMini({ tours, C, dark }) {
  if (!tours || tours.length === 0) return null
  const valids = tours.filter(t => t.debut !== null)
  if (valids.length === 0) return (
    <div style={{
      background: C.surface, border: `1.5px solid ${C.border}`,
      borderRadius: 12, padding: '32px 16px',
      textAlign: 'center', color: C.textDim, fontSize: 12, fontStyle: 'italic',
    }}>
      Aucun tour démarré aujourd'hui
    </div>
  )

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
              {['N°', 'Début', 'Fin', 'Durée', 'Rad. Sum', 'Cumul Rad.', 'EC Apport'].map(h => (
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
                onMouseEnter={e => e.currentTarget.style.background = dark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.03)'}
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
                <td style={{ padding: '7px 10px', textAlign: 'center', color: C.text, fontWeight: 630 }}>{t.debut || '—'}</td>
                <td style={{ padding: '7px 10px', textAlign: 'center', color: C.textMuted }}>{t.fin || '—'}</td>
                <td style={{ padding: '7px 10px', textAlign: 'center', color: C.text }}>{t.prg_time_min != null ? `${t.prg_time_min} min` : '—'}</td>
                <td style={{ padding: '7px 10px', textAlign: 'center', color: '#f5e642' }}>{t.radiation_sum != null ? t.radiation_sum.toFixed(1) : '—'}</td>
                <td style={{ padding: '7px 10px', textAlign: 'center', color: '#f5a623' }}>{t.cumul_radiation != null ? t.cumul_radiation.toFixed(1) : '—'}</td>
                <td style={{ padding: '7px 10px', textAlign: 'center', color: C.green }}>{t.ec_apport != null ? t.ec_apport.toFixed(2) : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// Ajustements
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
            background: cfg.bg, border: `1.5px solid ${cfg.color}35`,
            borderRadius: 10, padding: '11px 14px',
            display: 'flex', flexDirection: 'column', gap: 6,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{
                width: 26, height: 26, borderRadius: 7,
                background: cfg.color + '20', border: `1px solid ${cfg.color}40`,
                display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
              }}>
                <AIcon size={13} color={cfg.color} strokeWidth={2.5} />
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ fontSize: 11, fontWeight: 800, color: cfg.color }}>Tour {a.tour}</span>
                  <span style={{
                    fontSize: 10, fontWeight: 700, color: cfg.color,
                    background: cfg.color + '18', border: `1px solid ${cfg.color}35`,
                    borderRadius: 4, padding: '1px 7px',
                  }}>{a.action}</span>
                  {a.drainage_reel != null && (
                    <span style={{ marginLeft: 'auto', fontSize: 10, color: C.textDim }}>
                      Drain : <strong style={{ color: cfg.color }}>{a.drainage_reel.toFixed(1)}%</strong>
                    </span>
                  )}
                </div>
                <div style={{ fontSize: 11, color: C.textMuted, marginTop: 3 }}>{a.raison}</div>
              </div>
            </div>
            {!a.stop && (
              <div style={{ display: 'flex', gap: 12, paddingLeft: 34, fontSize: 11 }}>
                <span style={{ color: C.textDim }}>
                  Repos : <strong style={{ color: C.text }}>{a.repos_suivant_min} min</strong>
                </span>
                <span style={{ color: C.textDim }}>
                  Durée : <strong style={{ color: C.text }}>{a.duree_suivant_min} min</strong>
                </span>
              </div>
            )}
          </div>
        )
      })}
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
    width: '100%', padding: '9px 12px', borderRadius: 8,
    border: `1.5px solid ${C.border}`, background: C.inputBg,
    color: C.text, fontSize: 12, fontFamily: 'inherit', outline: 'none',
    boxSizing: 'border-box',
  }
  const labelSt = {
    display: 'block', color: C.textMuted, fontSize: 10, fontWeight: 700,
    textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6,
  }

  return createPortal(
    <div style={{
      position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
      width: '100vw', height: '100vh', zIndex: 99999,
      background: 'rgba(0,0,0,0.7)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: 24, boxSizing: 'border-box',
    }}>
      <div style={{
        background: C.card, border: `1.5px solid ${C.border}`,
        borderRadius: 16, padding: '24px 28px', width: '100%', maxWidth: 420,
        maxHeight: '90vh', overflowY: 'auto',
        boxShadow: '0 24px 80px rgba(0,0,0,0.5)',
        boxSizing: 'border-box', position: 'relative', zIndex: 10000,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 20 }}>
          <Settings size={16} color={C.green} strokeWidth={2} />
          <div style={{ fontSize: 14, fontWeight: 800, color: C.text }}>
            Configuration IA — AZ106
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
                onChange={e => setForm(p => ({ ...p, date_plantation: e.target.value }))}
                style={inputSt} />
              <div style={{ fontSize: 10, color: C.textDim, marginTop: 5 }}>
                Utilisé pour calculer le stade agronomique (végétatif, floraison, etc.)
              </div>
            </div>

            <div style={{ marginBottom: 20 }}>
              <label style={labelSt}>Agent IA actif</label>
              <div style={{ display: 'flex', gap: 8 }}>
                {[true, false].map(v => (
                  <button key={String(v)}
                    onClick={() => setForm(p => ({ ...p, actif: v }))}
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

            {/* Info EC bassin */}
            <div style={{
              marginBottom: 20, padding: '10px 14px', borderRadius: 9,
              background: `${C.green}08`, border: `1px solid ${C.green}20`,
              fontSize: 11, color: C.textMuted, lineHeight: 1.6,
            }}>
              <strong style={{ color: C.green }}>EC bassin :</strong> valeur fixe 0.7–0.8 dS/m (eau source Azura)<br />
              <strong style={{ color: C.green }}>Méthode :</strong> Hybride (règles agronomiques + ML)
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
    </div>,
  document.body
  )
}

// ─────────────────────────────────────────────────────────────
// PAGE PRINCIPALE
// ─────────────────────────────────────────────────────────────
export default function AgentIAPage({ token, auth, C: CProps, dark }) {
  const C = CProps || getColors(dark)
  const width = useWindowWidth()
  const isMobile = width < 640

  // Device AZ106 uniquement
  const [az106Device, setAz106Device] = useState(null)
  const [rec, setRec] = useState(null)
  const [tours, setTours] = useState([])
  const [weight, setWeight] = useState(null)        // dernière lecture poids
  const [deviceLatest, setDeviceLatest] = useState(null)  // lectures capteurs live
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [showConfig, setShowConfig] = useState(false)
  const [error, setError] = useState('')
  const [activeTab, setActiveTab] = useState('plan')
  const intervalRef = useRef(null)
  const weightIntervalRef = useRef(null)

  const [poidsSoir, setPoidsSoir] = useState(null)

  const today = new Date().toISOString().split('T')[0]
  const mois = new Date().getMonth() + 1

  // ── Trouver device AZ106 ──────────────────────────────────
  useEffect(() => {
    getDevices(token).then(farms => {
      const az = farms.find(f => f.farm_name === AZ106_FARM || f.farm_name?.includes('AZ106'))
      if (az?.houses?.length > 0) {
        setAz106Device(az.houses[0])
      } else {
        // fallback: premier device disponible
        for (const farm of farms) {
          if (farm.houses?.length > 0) {
            setAz106Device(farm.houses[0])
            break
          }
        }
      }
    }).catch(e => setError('Impossible de charger les devices'))
  }, [token])

  // ── Charger données capteur poids ─────────────────────────
  const loadWeight = useCallback(async () => {
    if (!az106Device) return
    try {
      const [w, ps] = await Promise.all([
        getLatestWeight(token, az106Device.farm_name),
        getPoidsSOir(token, az106Device.id),         // ← AJOUTER
      ])
      setWeight(w)
      setPoidsSoir(ps)                               // ← AJOUTER
    } catch {
      // poids non disponible
    }
  }, [az106Device, token])

  // ── Charger lectures live sensor (radiation_sum) ──────────
  const loadDeviceLatest = useCallback(async () => {
    if (!az106Device) return
    try {
      const d = await getDeviceLatest(token, az106Device.id)
      setDeviceLatest(d)
    } catch {}
  }, [az106Device, token])

  // ── Calculer PRT depuis capteur (6h–10h, toutes les 30s) ─
  const prt = weight?.poids_kg && weight?.poids_kg_matin
    ? calculerPRT(weight.poids_kg, weight.poids_kg_matin)
    : null
  const prtStatus = prt !== null ? getPRTStatus(prt, mois) : null

  // ── Charger recommandation (auto-génération) ──────────────
  const loadRec = useCallback(async (silent = false) => {
    if (!az106Device) return
    if (!silent) setLoading(true)
    else setRefreshing(true)
    setError('')
    try {
      // Radiation_Sum depuis capteur live
      const radSum = deviceLatest?.sensor?.radiation_sum ?? null

      // Appeler l'endpoint recommandation (auto-génère si absent)
      // Passer radiation_sum en payload si dispo
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
  }, [az106Device, token, today, deviceLatest])

  // ── Auto-génération initiale dès device disponible ────────
  useEffect(() => {
    if (az106Device) {
      loadWeight()
      loadDeviceLatest()
    }
  }, [az106Device])

  useEffect(() => {
    if (az106Device) loadRec()
  }, [az106Device])

  // ── Refresh automatique toutes les 30s ───────────────────
  useEffect(() => {
    if (!az106Device) return
    intervalRef.current = setInterval(() => {
      loadWeight()
      loadDeviceLatest()
      loadRec(true)
    }, 30_000)
    return () => clearInterval(intervalRef.current)
  }, [loadRec, loadWeight, loadDeviceLatest, az106Device])

  const tabs = [
    { id: 'plan',        label: 'Plan',       icon: Activity },
    { id: 'npk',         label: 'NPK',         icon: FlaskConical },
    { id: 'ajustements', label: 'Ajustements', icon: Brain },
    { id: 'tours',       label: 'Tours réels', icon: Clock },
  ]

  // ── Render ────────────────────────────────────────────────
  return (
    <div style={{ animation: 'az-fade-in 0.3s ease both' }}>

      {showConfig && az106Device && (
        <ConfigModal deviceId={az106Device.id} token={token}
          onClose={() => { setShowConfig(false); loadRec() }}
          C={C} dark={dark} />
      )}

      {/* Header */}
      <div style={{
        display: 'flex', alignItems: isMobile ? 'flex-start' : 'center',
        flexDirection: isMobile ? 'column' : 'row',
        justifyContent: 'space-between', marginBottom: 24, gap: 12,
      }}>
        <div>
          <h1 style={{ fontSize: isMobile ? 18 : 22, fontWeight: 900, color: C.text,
            marginBottom: 4, display: 'flex', alignItems: 'center', gap: 10 }}>
            <Brain size={isMobile ? 18 : 22} color={C.green} strokeWidth={2} />
            Agent IA Irrigation
          </h1>
          <p style={{ fontSize: 11, color: C.textDim }}>
            Station AZ106 · Recommandation automatique · {today}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={() => {
            loadWeight()
            loadDeviceLatest()
            loadRec(true)
          }} disabled={refreshing}
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
          {az106Device && (
            <button onClick={() => setShowConfig(true)}
              style={{
                display: 'flex', alignItems: 'center', gap: 6,
                padding: '7px 14px', borderRadius: 8,
                border: `1px solid ${dark ? '#1c2e22' : '#c0d8c8'}`,
                background: C.toggleBg, color: C.textMuted,
                fontSize: 12, fontWeight: 630, fontFamily: 'inherit', cursor: 'pointer',
              }}>
              <Settings size={12} strokeWidth={2} />
              {!isMobile && 'Date plantation'}
            </button>
          )}
        </div>
      </div>

      {/* Layout principal */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

        {/* Erreur */}
        {error && (
          <div style={{ padding: '10px 14px', borderRadius: 8,
            background: 'rgba(240,82,82,0.08)', border: '1px solid rgba(240,82,82,0.25)',
            color: '#f05252', fontSize: 12 }}>
            ⚠ {error}
          </div>
        )}

        {/* Device info banner */}
        {az106Device && (
          <div style={{
            background: C.surface, border: `1.5px solid ${C.border}`,
            borderRadius: 12, padding: '10px 16px',
            display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
          }}>
            <div style={{
              display: 'flex', alignItems: 'center', gap: 6,
              background: deviceLatest?.online
                ? (dark ? 'rgba(52,217,111,0.10)' : 'rgba(52,217,111,0.08)')
                : (dark ? 'rgba(255,80,80,0.10)'  : 'rgba(255,80,80,0.08)'),
              border: `1px solid ${deviceLatest?.online ? '#34d96f30' : '#ff505030'}`,
              borderRadius: 6, padding: '4px 10px',
              color: deviceLatest?.online ? C.green : C.red,
              fontWeight: 630, fontSize: 11, whiteSpace: 'nowrap', flexShrink: 0,
            }}>
              <div style={{ position: 'relative', width: 10, height: 10, flexShrink: 0 }}>
                {deviceLatest?.online && (
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
                  background: deviceLatest?.online ? C.green : '#ff5050',
                  boxShadow: deviceLatest?.online ? `0 0 5px ${C.green}` : 'none',
                }} />
              </div>
              {deviceLatest?.online ? '\u00A0En ligne' : 'Hors ligne'}
            </div>
            <div>
              <div style={{ fontSize: 13, fontWeight: 800, color: C.text }}>
                {az106Device.farm_name} — Station {az106Device.house_number}
              </div>
              <div style={{ fontSize: 10, color: C.textDim }}>
                Méthode : hybride (règles + ML)
                {rec && !rec.pct_ressuyage && (
                  <span style={{ marginLeft: 8, color: '#f5a623' }}>
                    ⚠ Ressuyage calculé depuis capteur poids
                  </span>
                )}
              </div>
            </div>
            {/* Radiation live badge */}
            {deviceLatest?.sensor?.radiation_sum != null && (
              <div style={{
                marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6,
                padding: '5px 12px', borderRadius: 8,
                background: 'rgba(245,230,66,0.1)', border: '1px solid rgba(245,230,66,0.3)',
              }}>
                <Zap size={11} color='#f5e642' strokeWidth={2} />
                <span style={{ fontSize: 11, fontWeight: 700, color: '#f5e642' }}>
                  {deviceLatest.sensor.radiation_sum.toFixed(1)} J/cm²
                </span>
                <span style={{ fontSize: 9, color: C.textDim }}>Rad. Sum</span>
              </div>
            )}
          </div>
        )}

        {/* Grille principale : PRT à gauche, contenu à droite */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: isMobile ? '1fr' : '300px 1fr',
          gap: 16,
          alignItems: 'start',
        }}>
          {/* Colonne gauche : PRT + Poids */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <PRTCard weight={weight} poidsSoir={poidsSoir} deviceLatest={deviceLatest} prtBackend={rec?.pct_ressuyage} C={C} dark={dark} />

            {/* Stade agronomique */}
            {rec?.stade && (
              <div style={{
                background: C.surface, border: `1.5px solid ${C.border}`,
                borderRadius: 12, padding: '20px 16px',
                display: 'flex', alignItems: 'center', gap: 10,
              }}>
                <Leaf size={14} color='#34d96f' strokeWidth={2} />
                <div>
                  <div style={{ fontSize: 10, color: C.textDim, textTransform: 'uppercase',
                    letterSpacing: '0.06em', marginBottom: 2 }}>Stade phénologique</div>
                  <div style={{ fontSize: 14, fontWeight: 800, color: '#34d96f',
                    textTransform: 'capitalize' }}>{rec.stade}</div>
                </div>
                <div style={{ marginLeft: 'auto', textAlign: 'right' }}>
                  <div style={{ fontSize: 10, color: C.textDim, marginBottom: 2 }}>J plantation</div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: C.text }}>
                    {rec.j_plantation != null ? `J+${rec.j_plantation}` : '—'}
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Colonne droite : Recommandation */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

            {loading && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 10,
                color: C.textDim, fontSize: 12, padding: '60px 0',
                justifyContent: 'center' }}>
                <RefreshCw size={16} style={{ animation: 'az-pulse 1.2s ease-in-out infinite' }} />
                Génération automatique de la recommandation IA…
              </div>
            )}

            {!loading && !az106Device && (
              <div style={{ textAlign: 'center', padding: '60px 0', color: C.textDim, fontSize: 12 }}>
                Station AZ106 non trouvée
              </div>
            )}

            {/* Écran attente PRT */}
            {!loading && rec && rec.statut === 'en_attente_prt' && (
              <div style={{
                background: C.surface, border: `1.5px solid ${C.amber}40`,
                borderRadius: 14, padding: '40px 28px', textAlign: 'center',
                display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16,
              }}>
                <div style={{
                  width: 60, height: 60, borderRadius: '50%',
                  background: `${C.amber}15`, border: `2px solid ${C.amber}40`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  <Scale size={28} color={C.amber} strokeWidth={1.5} />
                </div>
                <div>
                  <div style={{ fontSize: 15, fontWeight: 800, color: C.text, marginBottom: 8 }}>
                    En attente du seuil de ressuyage
                  </div>
                  <div style={{ fontSize: 12, color: C.textDim, lineHeight: 1.7, maxWidth: 380 }}>
                    {rec.message}
                  </div>
                </div>
                {rec.pct_ressuyage != null && (
                  <div style={{
                    padding: '14px 28px', borderRadius: 12,
                    background: `${C.amber}10`, border: `1px solid ${C.amber}30`,
                  }}>
                    <div style={{ fontSize: 32, fontWeight: 900, color: C.amber }}>
                      {rec.pct_ressuyage.toFixed(1)}%
                    </div>
                    <div style={{ fontSize: 10, color: C.textDim, marginTop: 3 }}>PRT Ressuyage actuel</div>
                  </div>
                )}
                <div style={{ fontSize: 11, color: C.textDim }}>
                  Vérification automatique toutes les 30 secondes…
                </div>
              </div>
            )}

            {/* Écran attente Radiation */}
            {!loading && rec && rec.statut === 'en_attente_radiation' && (
              <div style={{
                background: C.surface, border: `1.5px solid #4d9de040`,
                borderRadius: 14, padding: '40px 28px', textAlign: 'center',
                display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 16,
              }}>
                <div style={{
                  width: 60, height: 60, borderRadius: '50%',
                  background: '#4d9de015', border: '2px solid #4d9de040',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  <Sun size={28} color='#4d9de0' strokeWidth={1.5} />
                </div>
                <div>
                  <div style={{ fontSize: 15, fontWeight: 800, color: C.text, marginBottom: 8 }}>
                    PRT ✓ — En attente du seuil de radiation
                  </div>
                  <div style={{ fontSize: 12, color: C.textDim, lineHeight: 1.7, maxWidth: 380 }}>
                    {rec.message}
                  </div>
                </div>
                {rec.nb_tours_prevu > 0 && (
                  <div style={{
                    padding: '14px 28px', borderRadius: 12,
                    background: '#4d9de010', border: '1px solid #4d9de030',
                  }}>
                    <div style={{ fontSize: 32, fontWeight: 900, color: '#4d9de0' }}>
                      {rec.nb_tours_prevu} tours
                    </div>
                    <div style={{ fontSize: 10, color: C.textDim, marginTop: 3 }}>
                      Plan prévu · début dès seuil atteint
                    </div>
                  </div>
                )}
                {deviceLatest?.sensor?.radiation_sum != null && (
                  <div style={{ fontSize: 13, fontWeight: 700, color: '#f5e642' }}>
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
                background: C.surface, border: `1.5px solid ${C.border}`,
                borderRadius: 12, padding: '40px 24px', textAlign: 'center',
              }}>
                <Brain size={32} color={C.green} strokeWidth={1.5}
                  style={{ display: 'block', margin: '0 auto 12px' }} />
                <div style={{ fontSize: 13, fontWeight: 700, color: C.text, marginBottom: 6 }}>
                  Génération en cours…
                </div>
                <div style={{ fontSize: 11, color: C.textDim }}>
                  Configurez la date de plantation via le bouton <strong>Date plantation</strong>.
                </div>
              </div>
            )}

            {!loading && !rec && !error && az106Device && (
              <div style={{
                background: C.surface, border: `1.5px solid ${C.border}`,
                borderRadius: 12, padding: '40px 24px', textAlign: 'center',
              }}>
                <Brain size={32} color={C.green} strokeWidth={1.5}
                  style={{ display: 'block', margin: '0 auto 12px' }} />
                <div style={{ fontSize: 13, fontWeight: 700, color: C.text, marginBottom: 6 }}>
                  Génération en cours…
                </div>
                <div style={{ fontSize: 11, color: C.textDim }}>
                  La recommandation IA se génère automatiquement chaque matin à 6h00.<br />
                  Configurez la date de plantation via le bouton <strong>Date plantation</strong>.
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}