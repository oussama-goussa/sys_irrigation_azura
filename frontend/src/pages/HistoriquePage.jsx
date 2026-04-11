// ============================================================
// frontend/src/pages/HistoriquePage.jsx
// ============================================================

import React, { useState, useEffect, useRef, useCallback } from 'react'
import {
  History, ChevronDown, ChevronUp, ChevronLeft, ChevronRight,
  Pencil, Trash2, X, AlertTriangle,
  Plus, Save, AlertCircle, Check, Droplets, FlaskConical,
  BarChart2, ClipboardList,
} from 'lucide-react'
import { getSaisies, getSaisie, updateSaisie, deleteSaisie, getDevices } from '../api/client.js'

// ── helpers ───────────────────────────────────────────────────
const fmtNum = (v, dec = 2) => {
  if (v === null || v === undefined || v === '' || isNaN(Number(v))) return '—'
  return Number(v).toFixed(dec)
}
const fmtDuree = (totalMin) => {
  if (!totalMin || totalMin <= 0) return '—'
  const h = Math.floor(totalMin / 60)
  const m = Math.floor(totalMin % 60)
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00`
}
const todayStr = () => new Date().toISOString().split('T')[0]
function newTour(num) {
  return {
    id: Date.now() + num, num,
    rad: '', cumulRad: 0, heure: '', duree: '', tempsRepos: null,
    vApport: '', ecApport: '', phApport: '',
    vDrain: '', ecDrain: '', phDrain: '',
    pctDrain: null, moyPctDrain: null,
  }
}

// ── TInput ───────────────────────────────────────────────────
function TInput({ value, onChange, disabled = false, width = 72, C }) {
  return (
    <input type="number" value={value ?? ''} onChange={e => onChange(e.target.value)}
      disabled={disabled} step="any"
      style={{
        width, textAlign: 'center', padding: '5px 6px', borderRadius: 6,
        border: `1.5px solid ${disabled ? 'transparent' : C.border}`,
        background: disabled ? 'transparent' : C.inputBg,
        color: disabled ? C.green : C.text,
        fontSize: 12, fontFamily: 'inherit', outline: 'none',
        fontWeight: disabled ? 700 : 400,
      }}
    />
  )
}

// ── TimeInput — scroll hh:mm comme SaisiePage ────────────────
function TimeInput({ value, onChange, C }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  const triggerRef = useRef(null)
  const [pos, setPos] = useState({ top: 0, left: 0 })
  const [h, m] = value ? value.split(':') : ['00', '00']

  useEffect(() => {
    const close = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [])

  const handleOpen = () => {
    if (triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect()
      setPos({ top: rect.bottom + 6, left: rect.left + rect.width / 2 })
    }
    setOpen(v => !v)
  }

  const inc = (type) => {
    const hv = parseInt(h || '0'); const mv = parseInt(m || '0')
    if (type === 'h') onChange(`${String((hv + 1) % 24).padStart(2, '0')}:${m || '00'}`)
    else onChange(`${h || '00'}:${String((mv + 1) % 60).padStart(2, '0')}`)
  }
  const dec = (type) => {
    const hv = parseInt(h || '0'); const mv = parseInt(m || '0')
    if (type === 'h') onChange(`${String((hv - 1 + 24) % 24).padStart(2, '0')}:${m || '00'}`)
    else onChange(`${h || '00'}:${String((mv - 1 + 60) % 60).padStart(2, '0')}`)
  }

  return (
    <div ref={ref} style={{ position: 'relative', display: 'inline-block' }}>
      <div ref={triggerRef} onClick={handleOpen} style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        height: 32, padding: '0 10px', minWidth: 76,
        border: `1.5px solid ${open ? C.green : C.border}`,
        borderRadius: 7, background: C.inputBg, cursor: 'pointer',
        fontSize: 12, color: value ? C.text : C.textDim, gap: 4, fontWeight: 700,
      }}>
        <span>{h || '00'}</span>
        <span style={{ color: C.textDim }}>:</span>
        <span>{m || '00'}</span>
      </div>
      {open && (
        <div style={{
          position: 'fixed', top: pos.top, left: pos.left,
          transform: 'translateX(-50%)',
          background: C.card, border: `1.5px solid ${C.border}`,
          borderRadius: 10, zIndex: 9999,
          boxShadow: `0 4px 24px rgba(0,0,0,0.2)`,
          padding: '10px 16px',
          display: 'flex', alignItems: 'center', gap: 4,
        }}>
          {['h', 'm'].map((type, ti) => (
            <React.Fragment key={type}>
              {ti === 1 && <span style={{ fontSize: 22, fontWeight: 900, color: C.textMuted }}>:</span>}
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
                <button onClick={() => inc(type)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: C.textMuted, padding: '4px 8px' }}>
                  <ChevronUp size={16} strokeWidth={2.5} />
                </button>
                <input type="text" inputMode="numeric" maxLength={2}
                  value={type === 'h' ? (h || '00') : (m || '00')}
                  onChange={e => {
                    const v = parseInt(e.target.value) || 0
                    if (type === 'h') onChange(`${String(Math.min(23, Math.max(0, v))).padStart(2, '0')}:${m || '00'}`)
                    else onChange(`${h || '00'}:${String(Math.min(59, Math.max(0, v))).padStart(2, '00')}`)
                  }}
                  style={{ fontSize: 22, fontWeight: 700, color: C.text, width: 48, textAlign: 'center', background: 'none', border: 'none', outline: 'none', fontFamily: 'inherit', padding: 0 }}
                />
                <button onClick={() => dec(type)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: C.textMuted, padding: '4px 8px' }}>
                  <ChevronDown size={16} strokeWidth={2.5} />
                </button>
              </div>
            </React.Fragment>
          ))}
        </div>
      )}
    </div>
  )
}

// ── SSelect ───────────────────────────────────────────────────
function SSelect({ value, onChange, options, placeholder, C, width = '100%' }) {
  return (
    <div style={{ position: 'relative', width }}>
      <select value={value} onChange={e => onChange(e.target.value)}
        style={{ width: '100%', padding: '7px 28px 7px 10px', borderRadius: 7,
          border: `1.5px solid ${C.border}`, background: C.inputBg,
          color: value ? C.text : C.textDim, fontSize: 12,
          fontFamily: 'inherit', outline: 'none', appearance: 'none', cursor: 'pointer' }}>
        <option value="">{placeholder}</option>
        {options.map(o => <option key={o.value ?? o} value={o.value ?? o}>{o.label ?? o}</option>)}
      </select>
      <ChevronDown size={12} strokeWidth={2} style={{
        position: 'absolute', right: 8, top: '50%',
        transform: 'translateY(-50%)', color: C.textDim, pointerEvents: 'none',
      }} />
    </div>
  )
}

// ── FilterSelect ─────────────────────────────────────────────
function FilterSelect({ value, onChange, options, C }) {
  return (
    <div style={{ position: 'relative' }}>
      <select value={value} onChange={e => onChange(e.target.value)}
        style={{ width: '100%', padding: '5px 22px 5px 7px', borderRadius: 6,
          border: `1.5px solid ${C.border}`, background: C.inputBg,
          color: value ? C.text : C.textDim, fontSize: 11,
          fontFamily: 'inherit', outline: 'none', appearance: 'none', cursor: 'pointer' }}>
        <option value="">Tous</option>
        {options.map(o => <option key={o.value ?? o} value={o.value ?? o}>{o.label ?? o}</option>)}
      </select>
      <ChevronDown size={10} strokeWidth={2} style={{
        position: 'absolute', right: 5, top: '50%',
        transform: 'translateY(-50%)', color: C.textDim, pointerEvents: 'none',
      }} />
    </div>
  )
}

// ── FilterInput ──────────────────────────────────────────────
function FilterInput({ value, onChange, placeholder, C, type = 'text' }) {
  return (
    <div style={{ position: 'relative' }}>
      <input type={type} value={value} onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        style={{ width: '100%', height: 28, padding: '0 22px 0 7px', borderRadius: 5,
          border: `1.5px solid ${value ? C.green + '60' : C.border}`,
          background: C.inputBg, color: C.text, fontSize: 11,
          fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box',
          transition: 'border-color 0.15s' }} />
      {value && (
        <button onClick={() => onChange('')}
          style={{ position: 'absolute', right: 4, top: '50%', transform: 'translateY(-50%)',
            background: 'none', border: 'none', cursor: 'pointer', color: C.textDim, padding: 2 }}>
          <X size={10} strokeWidth={2} />
        </button>
      )}
    </div>
  )
}

// ── TH helper for EditModal ───────────────────────────────────
function THm({ children, w, color, C }) {
  return (
    <th style={{ padding: '7px 5px', textAlign: 'center', fontSize: 10, fontWeight: 700,
      textTransform: 'uppercase', letterSpacing: '0.07em', color: color || C.textDim,
      whiteSpace: 'nowrap', width: w, borderBottom: `1.5px solid ${C.border}` }}>
      {children}
    </th>
  )
}

// ── Confirm Delete Modal ──────────────────────────────────────
function ConfirmModal({ saisie, onConfirm, onCancel, C }) {
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(0,0,0,0.65)',
      display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ background: C.card, border: `1.5px solid ${C.border}`,
        borderRadius: 16, padding: '28px 32px', width: 400,
        boxShadow: '0 8px 40px rgba(0,0,0,0.5)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
          <div style={{ width: 42, height: 42, borderRadius: 10,
            background: `${C.amber}18`, border: `1.5px solid ${C.amber}40`,
            display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <AlertTriangle size={20} color={C.amber} strokeWidth={2} />
          </div>
          <div>
            <div style={{ color: C.text, fontWeight: 800, fontSize: 15 }}>Confirmer la suppression</div>
            <div style={{ color: C.textMuted, fontSize: 12, marginTop: 2 }}>Cette action est irréversible</div>
          </div>
        </div>
        <p style={{ color: C.textMuted, fontSize: 12, marginBottom: 24, lineHeight: 1.7 }}>
          Supprimer la saisie du <strong style={{ color: C.text }}>{saisie.date}</strong> —{' '}
          <strong style={{ color: C.text }}>{saisie.farm_name}</strong> {saisie.station} {saisie.serre} ?
          <span style={{ display: 'block', marginTop: 8, color: C.red, fontSize: 11 }}>
            Tous les tours associés seront également supprimés.
          </span>
        </p>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button onClick={onCancel} style={{ padding: '8px 16px', borderRadius: 8,
            border: `1.5px solid ${C.border}`, background: 'transparent',
            color: C.textMuted, fontSize: 12, fontWeight: 700, fontFamily: 'inherit', cursor: 'pointer' }}>
            Annuler
          </button>
          <button onClick={onConfirm} style={{ padding: '8px 16px', borderRadius: 8,
            border: `1.5px solid ${C.red}`, background: 'transparent',
            color: C.red, fontSize: 12, fontWeight: 700, fontFamily: 'inherit', cursor: 'pointer' }}>
            <Trash2 size={13} strokeWidth={2} style={{ marginRight: 5, verticalAlign: 'middle' }} />
            Supprimer
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Edit Modal ────────────────────────────────────────────────
function EditModal({ saisie, token, farms, onSaved, onClose, C, dark }) {
  const [ferme, setFerme]         = useState(saisie.farm_name || '')
  const [station, setStation]     = useState(saisie.station || '')
  const [serre, setSerre]         = useState(saisie.serre || '')
  const [vanne, setVanne]         = useState(saisie.vanne || '')
  const [date, setDate]           = useState(saisie.date || todayStr())
  const [nbrBras, setNbrBras]     = useState(saisie.nbr_bras ?? '')
  const [nbrGoutteurs, setNbrGoutteurs] = useState(saisie.nbr_goutteurs ?? '')
  const [poidsMatin, setPoidsMatin] = useState(saisie.poids_matin ?? '')
  const [heureMatin, setHeureMatin] = useState(saisie.heure_matin || '')
  const [poidsSoir, setPoidsSoir] = useState(saisie.poids_soir ?? '')
  const [heureSoir, setHeureSoir] = useState(saisie.heure_soir || '')
  const [bassinEC, setBassinEC]   = useState(saisie.bassin_ec ?? '')
  const [tours, setTours]         = useState([])
  const [saving, setSaving]       = useState(false)
  const [error, setError]         = useState('')
  const tableBottomRef = useRef(null)

  // Recalcul tours — recalcule pctDrain et moyPctDrain à chaque changement
  const recalculTours = (list, goutteurs) => {
    const ng = Number(goutteurs) || 0
    let cumulPrev = 0
    let prevHeure = null
    let prevDuree = null
    let prevMoyCalculee = null  // moyenne cumulée correcte du tour précédent

    return list.map((t, i) => {
      const radActuelle = Number(t.rad) || 0
      const cumulRad = radActuelle - cumulPrev
      cumulPrev += cumulRad

      // Temps repos basé sur les valeurs précédentes réelles
      let tempsRepos = null
      if (i > 0 && prevHeure && prevDuree && t.heure) {
        const toMin = hh => { const [h2, m2] = hh.split(':').map(Number); return h2 * 60 + m2 }
        tempsRepos = toMin(t.heure) - (toMin(prevHeure) + (Number(prevDuree) || 0))
        if (tempsRepos < 0) tempsRepos = 0
      }

      // % Drain — 0 si vDrain=0 (avec vApport et ng valides), null si données manquantes
      let pctDrain = null
      const vd = Number(t.vDrain)
      const va = Number(t.vApport)
      if (va > 0 && ng > 0 && t.vDrain !== '' && t.vDrain !== null && t.vDrain !== undefined) {
        pctDrain = (vd / ng / va) * 100
      }

      // Moy % Drain — utilise prevMoyCalculee (valeur calculée du tour précédent)
      // Si pctDrain null (vDrain=0), on traite comme 0 pour la moyenne cumulative
      let moyPctDrain = null
      const pctPourMoy = pctDrain !== null ? pctDrain : 0
      if (i === 0) {
        // Tour 1 : moy = pctDrain (0 si vDrain=0), null si données manquantes
        moyPctDrain = pctDrain != null ? pctDrain : null
      } else if (prevMoyCalculee !== null) {
        // Tours suivants : on intègre même si pctDrain=0
        moyPctDrain = (prevMoyCalculee * i + pctPourMoy) / (i + 1)
      } else if (pctDrain !== null) {
        // prevMoy était null (tour 1 sans drain) mais maintenant on a un drain
        moyPctDrain = pctDrain
      }

      // Mettre à jour les variables pour le prochain tour
      prevHeure = t.heure
      prevDuree = t.duree
      // On propage la moyenne même si ce tour n'a pas de drain
      prevMoyCalculee = moyPctDrain !== null ? moyPctDrain : prevMoyCalculee

      return { ...t, cumulRad: Math.max(0, cumulRad), tempsRepos, pctDrain, moyPctDrain }
    })
  }

  useEffect(() => {
    getSaisie(token, saisie.id).then(data => {
      const t = (data.tours || []).map((t, i) => ({
        id: Date.now() + i,
        num: t.num_tour,
        rad: t.rad ?? '',
        cumulRad: t.cumul_rad ?? 0,
        heure: t.heure || '',
        duree: t.duree_min ?? '',
        tempsRepos: t.temps_repos ?? null,
        vApport: t.v_apport ?? '',
        ecApport: t.ec_apport ?? '',
        phApport: t.ph_apport ?? '',
        vDrain: t.v_drain ?? '',
        ecDrain: t.ec_drain ?? '',
        phDrain: t.ph_drain ?? '',
        pctDrain: t.pct_drain ?? null,
        moyPctDrain: t.moy_pct_drain ?? null,
      }))
      setTours(recalculTours(t, nbrGoutteurs))
    }).catch(() => {})
  }, [saisie.id])

  // % Ressuyage
  const pctRessuyage = poidsMatin && poidsSoir && Number(poidsMatin) > 0
    ? (((Number(poidsSoir) - Number(poidsMatin)) / Number(poidsMatin)) * 100).toFixed(1)
    : null

  // Options
  const fermeOptions = farms.map(f => ({ value: f.farm_name, label: f.farm_name }))
  const selectedFarm = farms.find(f => f.farm_name === ferme)
  const houses = selectedFarm?.houses || []
  const stationOptions = [...new Set(houses.map(h => h.house_number))].map(v => ({ value: v, label: `Station ${v}` }))
  const serreOptions = Array.from({ length: 20 }, (_, i) => ({
    value: `S${String(i + 1).padStart(2, '0')}`,
    label: `S${String(i + 1).padStart(2, '0')}`,
  }))


  const updateTour = (id, field, val) => {
    setTours(prev => recalculTours(
      prev.map(t => t.id === id ? { ...t, [field]: val } : t),
      nbrGoutteurs
    ))
  }

  // Recalcul quand nbrGoutteurs change
  useEffect(() => {
    setTours(prev => recalculTours(prev, nbrGoutteurs))
  }, [nbrGoutteurs])

  const addTour = () => {
    setTours(prev => {
      const next = [...prev, newTour(prev.length + 1)]
      setTimeout(() => tableBottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 50)
      return recalculTours(next, nbrGoutteurs)
    })
  }

  const deleteTourRow = (id) =>
    setTours(prev => recalculTours(
      prev.filter(t => t.id !== id).map((t, i) => ({ ...t, num: i + 1 })),
      nbrGoutteurs
    ))

  // Bilan calculé en temps réel
  const lastTour       = tours[tours.length - 1]
  const totalVApport   = tours.reduce((s, t) => s + (Number(t.vApport) || 0), 0)
  const totalVDrain    = tours.reduce((s, t) => s + (Number(t.vDrain)  || 0), 0)
  const dureeTotal     = tours.reduce((s, t) => s + (Number(t.duree)   || 0), 0)
  const ecMoyApport    = tours.filter(t => t.ecApport).length ? (tours.reduce((s, t) => s + (Number(t.ecApport) || 0), 0) / tours.filter(t => t.ecApport).length) : null
  const phMoyApport    = tours.filter(t => t.phApport).length ? (tours.reduce((s, t) => s + (Number(t.phApport) || 0), 0) / tours.filter(t => t.phApport).length) : null
  const ecMoyDrain     = tours.filter(t => t.ecDrain).length  ? (tours.reduce((s, t) => s + (Number(t.ecDrain)  || 0), 0) / tours.filter(t => t.ecDrain).length)  : null
  const phMoyDrain     = tours.filter(t => t.phDrain).length  ? (tours.reduce((s, t) => s + (Number(t.phDrain)  || 0), 0) / tours.filter(t => t.phDrain).length)  : null
  const moyDrainFinale = lastTour?.moyPctDrain ?? null
  const ccBras = totalVApport && moyDrainFinale !== null && nbrGoutteurs && nbrBras && Number(nbrBras) > 0
    ? ((totalVApport * (1 - moyDrainFinale / 100) * Number(nbrGoutteurs)) / Number(nbrBras)).toFixed(1) : null

  const handleSave = async () => {
    if (!ferme || !date || tours.length === 0) {
      setError('Veuillez remplir la ferme, la date et au moins un tour.')
      return
    }
    setSaving(true); setError('')
    try {
      const payload = {
        ferme, station, serre, vanne, date,
        constantes: {
          nbrBras      : nbrBras      !== '' ? Number(nbrBras)      : null,
          nbrGoutteurs : nbrGoutteurs !== '' ? Number(nbrGoutteurs) : null,
          poidsMatin   : poidsMatin   !== '' ? Number(poidsMatin)   : null,
          heureMatin,
          poidsSoir    : poidsSoir    !== '' ? Number(poidsSoir)    : null,
          heureSoir,
          bassinEC     : bassinEC     !== '' ? Number(bassinEC)     : null,
          pctRessuyage : pctRessuyage != null ? Number(pctRessuyage) : null,
        },
        tours: tours.map(t => ({
          num_tour     : t.num,
          rad          : t.rad      !== '' ? Number(t.rad)      : null,
          cumul_rad    : t.cumulRad != null ? Number(t.cumulRad) : null,
          heure        : t.heure    || null,
          duree_min    : t.duree    !== '' ? Number(t.duree)    : null,
          temps_repos  : t.tempsRepos,
          v_apport     : t.vApport  !== '' ? Number(t.vApport)  : null,
          ec_apport    : t.ecApport !== '' ? Number(t.ecApport) : null,
          ph_apport    : t.phApport !== '' ? Number(t.phApport) : null,
          v_drain      : t.vDrain   !== '' ? Number(t.vDrain)   : null,
          ec_drain     : t.ecDrain  !== '' ? Number(t.ecDrain)  : null,
          ph_drain     : t.phDrain  !== '' ? Number(t.phDrain)  : null,
          pct_drain    : t.pctDrain    != null ? Number(t.pctDrain)    : null,
          moy_pct_drain: t.moyPctDrain != null ? Number(t.moyPctDrain) : null,
        })),
        bilan: {
          nbrTours     : tours.length,
          dureeTotal   : dureeTotal > 0 ? fmtDuree(dureeTotal) : null,
          totalVApport : totalVApport  != null ? totalVApport  : null,
          totalVDrain  : totalVDrain   != null ? totalVDrain   : null,
          ecMoyApport  : ecMoyApport   != null ? Number(ecMoyApport)  : null,
          phMoyApport  : phMoyApport   != null ? Number(phMoyApport)  : null,
          ecMoyDrain   : ecMoyDrain    != null ? Number(ecMoyDrain)   : null,
          phMoyDrain   : phMoyDrain    != null ? Number(phMoyDrain)   : null,
          moyDrainFinale: moyDrainFinale != null ? Number(moyDrainFinale) : null,
          ccBras       : ccBras        != null ? Number(ccBras)       : null,
        },
      }
      await updateSaisie(token, saisie.id, payload)
      onSaved()
      onClose()
    } catch (e) {
      try {
        const parsed = JSON.parse(e.message)
        setError(Array.isArray(parsed?.detail)
          ? parsed.detail.map(d => `${(d.loc || []).slice(1).join('.')} : ${d.msg}`).join(' | ')
          : String(parsed?.detail || e.message))
      } catch { setError(String(e.message)) }
    } finally { setSaving(false) }
  }

  const inputStyle = {
    width: '100%', padding: '7px 10px', borderRadius: 8,
    border: `1.5px solid ${C.border}`, background: C.inputBg,
    color: C.text, fontSize: 12, fontFamily: 'inherit', outline: 'none',
    boxSizing: 'border-box',
  }
  const labelStyle = {
    display: 'block', color: C.textMuted, fontSize: 10, fontWeight: 700,
    textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 4,
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 9999,
      background: 'rgba(0,0,0,0.65)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: '24px',
    }}>
      <div style={{
        background: C.card, border: `1.5px solid ${C.border}`,
        borderRadius: 16, width: '100%', maxWidth: 1300,
        maxHeight: '90vh', overflowY: 'auto',
        boxShadow: '0 24px 80px rgba(0,0,0,0.6)',
      }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '20px 28px', borderBottom: `1px solid ${C.border}`,
          position: 'sticky', top: 0, background: C.card, zIndex: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Pencil size={18} color={C.green} strokeWidth={2} />
            <div style={{ color: C.text, fontWeight: 800, fontSize: 15 }}>
              Modifier saisie — {saisie.date} · {saisie.farm_name}
            </div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none',
            cursor: 'pointer', color: C.textDim, padding: 4 }}>
            <X size={18} strokeWidth={2} />
          </button>
        </div>

        <div style={{ padding: '24px 28px' }}>

          {/* Bilan calculé en temps réel */}
          {tours.length > 0 && (
            <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr 1fr 1fr', gap: 12, marginBottom: 18 }}>
              {[
                {
                  label: 'Irrigation', color: C.green, Icon: ClipboardList,
                  items: [
                    { sub: 'Tours', value: tours.length },
                    { sub: 'Durée', value: fmtDuree(dureeTotal) },
                    { sub: 'CC/bras', value: ccBras ?? '—' },
                  ],
                },
                {
                  label: 'Bilan Eau', color: C.blue, Icon: Droplets,
                  items: [
                    { sub: 'Apport', value: totalVApport > 0 ? fmtNum(totalVApport, 1) : '—' },
                    { sub: 'Drainage', value: totalVDrain > 0 ? fmtNum(totalVDrain, 1) : '—' },
                  ],
                },
                {
                  label: 'Bilan EC', color: C.green, Icon: BarChart2,
                  items: [
                    { sub: 'Apport', value: ecMoyApport ? fmtNum(ecMoyApport, 2) : '—' },
                    { sub: 'Drainage', value: ecMoyDrain ? fmtNum(ecMoyDrain, 2) : '—' },
                  ],
                },
                {
                  label: 'Bilan pH', color: C.amber, Icon: FlaskConical,
                  items: [
                    { sub: 'Apport', value: phMoyApport ? fmtNum(phMoyApport, 2) : '—' },
                    { sub: 'Drainage', value: phMoyDrain ? fmtNum(phMoyDrain, 2) : '—' },
                  ],
                },
              ].map(card => (
                <div key={card.label} style={{
                  background: dark ? '#111a14' : '#ffffff',
                  border: `1px solid ${dark ? '#1c2e22' : '#d0e8d8'}`,
                  borderRadius: 12, padding: '14px 18px',
                  display: 'flex', flexDirection: 'column', justifyContent: 'space-between', minHeight: 90,
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                    <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase',
                      letterSpacing: '0.1em', color: dark ? C.textDim : '#5a7a66' }}>{card.label}</div>
                    <card.Icon size={14} strokeWidth={1.6} color={card.color} style={{ opacity: 0.65 }} />
                  </div>
                  <div style={{ display: 'flex', gap: card.items.length > 2 ? 12 : 18, alignItems: 'flex-end' }}>
                    {card.items.map(it => (
                      <div key={it.sub}>
                        <div style={{ fontSize: 10, color: dark ? C.textDim : '#5a7a66', marginBottom: 2, whiteSpace: 'nowrap' }}>{it.sub}</div>
                        <div style={{ fontSize: 18, fontWeight: 700, color: card.color }}>{it.value}</div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Sélecteurs */}
          <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr 1fr 1fr 150px', gap: 14, marginBottom: 18 }}>
            <div>
              <label style={labelStyle}>Ferme</label>
              <SSelect value={ferme} onChange={v => { setFerme(v); setStation('') }}
                options={fermeOptions} placeholder="Sélectionner…" C={C} />
            </div>
            <div>
              <label style={labelStyle}>Bloc (Station)</label>
              <SSelect value={station} onChange={setStation}
                options={stationOptions} placeholder="Sélectionner…" C={C} />
            </div>
            <div>
              <label style={labelStyle}>Serre</label>
              <SSelect value={serre} onChange={setSerre}
                options={serreOptions} placeholder="S01" C={C} />
            </div>
            <div>
              <label style={labelStyle}>Vanne</label>
              <input value={vanne} onChange={e => setVanne(e.target.value)} style={inputStyle} placeholder="ex: 1" />
            </div>
            <div>
              <label style={labelStyle}>Date</label>
              <input type="date" value={date} onChange={e => setDate(e.target.value)} style={inputStyle} />
            </div>
          </div>

          {/* Constantes */}
          <div style={{ background: dark ? 'rgba(52,217,111,0.04)' : 'rgba(24,120,63,0.03)',
            border: `1px solid ${C.border}`, borderRadius: 12, padding: '16px 20px', marginBottom: 18 }}>
            <div style={{ fontSize: 11, fontWeight: 800, color: C.textMuted, textTransform: 'uppercase',
              letterSpacing: '0.1em', marginBottom: 14 }}>Constantes &amp; Substrat</div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
              {[
                { label: 'Nbr Bras', val: nbrBras, set: setNbrBras },
                { label: 'Nbr Goutteurs', val: nbrGoutteurs, set: setNbrGoutteurs },
                { label: 'Poids matin (Kg)', val: poidsMatin, set: setPoidsMatin },
                { label: 'Poids soir (Kg)', val: poidsSoir, set: setPoidsSoir },
                { label: 'Bassin (EC)', val: bassinEC, set: setBassinEC },
              ].map(f => (
                <div key={f.label}>
                  <label style={labelStyle}>{f.label}</label>
                  <input type="number" value={f.val} onChange={e => f.set(e.target.value)}
                    step="any" style={inputStyle} />
                </div>
              ))}
              <div>
                <label style={labelStyle}>Heure matin</label>
                <TimeInput value={heureMatin} onChange={setHeureMatin} C={C} />
              </div>
              <div>
                <label style={labelStyle}>Heure soir</label>
                <TimeInput value={heureSoir} onChange={setHeureSoir} C={C} />
              </div>
              <div>
                <label style={labelStyle}>% Ressuyage</label>
                <div style={{ padding: '7px 10px', borderRadius: 8, textAlign: 'center',
                  background: pctRessuyage !== null ? `${C.green}10` : C.toggleBg,
                  border: `1.5px solid ${pctRessuyage !== null ? C.green + '40' : C.border}`,
                  fontSize: 12, fontWeight: 700,
                  color: pctRessuyage !== null ? C.green : C.textDim,
                  minHeight: 33, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  {pctRessuyage !== null ? `${pctRessuyage}%` : '—'}
                </div>
              </div>
            </div>
          </div>

          {/* Table tours */}
          <div style={{ background: C.card, border: `1.5px solid ${C.border}`, borderRadius: 12,
            overflow: 'hidden', marginBottom: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '12px 16px', borderBottom: `1px solid ${C.border}` }}>
              <div style={{ fontSize: 11, fontWeight: 800, color: C.textMuted, textTransform: 'uppercase',
                letterSpacing: '0.1em' }}>Tours d'irrigation</div>
              <button onClick={addTour} style={{ display: 'flex', alignItems: 'center', gap: 6,
                padding: '6px 14px', background: `${C.green}10`, border: `1.5px solid ${C.green}40`,
                borderRadius: 7, color: C.green, fontSize: 12, fontWeight: 700,
                fontFamily: 'inherit', cursor: 'pointer' }}>
                <Plus size={13} strokeWidth={2.5} /> Nouveau tour
              </button>
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: 'inherit' }}>
                <thead>
                  <tr>
                    <THm w={36} C={C}>N°</THm>
                    <THm w={68} C={C}>Rad.</THm>
                    <THm w={76} color={C.blue} C={C}>Cumul Rad</THm>
                    <THm w={108} C={C}>Heure</THm>
                    <THm w={76} color={C.textMuted} C={C}>T.Repos</THm>
                    <THm w={70} C={C}>Durée(min)</THm>
                    <THm w={76} C={C}>V.Apport</THm>
                    <THm w={70} C={C}>EC Apport</THm>
                    <THm w={70} C={C}>pH Apport</THm>
                    <THm w={70} C={C}>V.Drain</THm>
                    <THm w={70} C={C}>EC Drain</THm>
                    <THm w={70} C={C}>pH Drain</THm>
                    <THm w={70} color={C.amber} C={C}>% Drain</THm>
                    <THm w={78} color={C.amber} C={C}>Moy % Drain</THm>
                    <THm w={32} C={C}></THm>
                  </tr>
                </thead>
                <tbody>
                  {tours.length === 0 ? (
                    <tr><td colSpan={15} style={{ padding: '32px 0', textAlign: 'center',
                      color: C.textDim, fontSize: 12 }}>Aucun tour — cliquer sur Nouveau tour</td></tr>
                  ) : tours.map((t, i) => (
                    <tr key={t.id} style={{ borderBottom: i < tours.length - 1 ? `1px solid ${C.border}` : 'none' }}>
                      <td style={{ padding: '5px 4px', textAlign: 'center' }}>
                        <div style={{ width: 26, height: 26, borderRadius: 6, margin: '0 auto',
                          background: `${C.green}12`, border: `1px solid ${C.green}30`,
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          fontSize: 11, fontWeight: 900, color: C.green }}>{t.num}</div>
                      </td>
                      <td style={{ padding: '5px 4px', textAlign: 'center' }}>
                        <TInput value={t.rad} onChange={v => updateTour(t.id, 'rad', v)} C={C} />
                      </td>
                      <td style={{ padding: '5px 4px', textAlign: 'center' }}>
                        <div style={{ fontSize: 12, fontWeight: 700, color: C.blue }}>
                          {t.cumulRad > 0 ? fmtNum(t.cumulRad, 0) : '—'}
                        </div>
                      </td>
                      <td style={{ padding: '5px 4px', textAlign: 'center' }}>
                        <TimeInput value={t.heure} onChange={v => updateTour(t.id, 'heure', v)} C={C} />
                      </td>
                      <td style={{ padding: '5px 4px', textAlign: 'center' }}>
                        <div style={{ fontSize: 12, fontWeight: 700, color: t.tempsRepos !== null ? C.textMuted : C.textDim }}>
                          {t.tempsRepos !== null ? `${t.tempsRepos} min` : i === 0 ? '—' : '?'}
                        </div>
                      </td>
                      <td style={{ padding: '5px 4px', textAlign: 'center' }}>
                        <TInput value={t.duree} onChange={v => updateTour(t.id, 'duree', v)} C={C} />
                      </td>
                      <td style={{ padding: '5px 4px', textAlign: 'center' }}>
                        <TInput value={t.vApport} onChange={v => updateTour(t.id, 'vApport', v)} C={C} />
                      </td>
                      <td style={{ padding: '5px 4px', textAlign: 'center' }}>
                        <TInput value={t.ecApport} onChange={v => updateTour(t.id, 'ecApport', v)} C={C} />
                      </td>
                      <td style={{ padding: '5px 4px', textAlign: 'center' }}>
                        <TInput value={t.phApport} onChange={v => updateTour(t.id, 'phApport', v)} C={C} />
                      </td>
                      <td style={{ padding: '5px 4px', textAlign: 'center' }}>
                        <TInput value={t.vDrain} onChange={v => updateTour(t.id, 'vDrain', v)} C={C} />
                      </td>
                      <td style={{ padding: '5px 4px', textAlign: 'center' }}>
                        <TInput value={t.ecDrain} onChange={v => updateTour(t.id, 'ecDrain', v)} C={C} />
                      </td>
                      <td style={{ padding: '5px 4px', textAlign: 'center' }}>
                        <TInput value={t.phDrain} onChange={v => updateTour(t.id, 'phDrain', v)} C={C} />
                      </td>
                      <td style={{ padding: '5px 4px', textAlign: 'center' }}>
                        <div style={{ fontSize: 12, fontWeight: 700, color: t.pctDrain != null ? C.amber : C.textDim }}>
                          {t.pctDrain != null ? `${fmtNum(t.pctDrain, 1)}%` : '—'}
                        </div>
                      </td>
                      <td style={{ padding: '5px 4px', textAlign: 'center' }}>
                        <div style={{ fontSize: 12, fontWeight: 700, color: t.moyPctDrain != null ? C.amber : C.textDim }}>
                          {t.moyPctDrain != null ? `${fmtNum(t.moyPctDrain, 1)}%` : '—'}
                        </div>
                      </td>
                      <td style={{ padding: '5px 4px', textAlign: 'center' }}>
                        <button onClick={() => deleteTourRow(t.id)}
                          style={{ background: 'none', border: 'none', cursor: 'pointer',
                            color: C.textDim, padding: 3, borderRadius: 4 }}
                          onMouseEnter={e => e.currentTarget.style.color = C.red}
                          onMouseLeave={e => e.currentTarget.style.color = C.textDim}>
                          <Trash2 size={12} strokeWidth={2} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div ref={tableBottomRef} />
            </div>
          </div>

          {error && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px',
              background: dark ? '#2a0a0a' : '#fef2f2', border: `1px solid ${C.red}30`,
              borderRadius: 8, color: C.red, fontSize: 12, marginBottom: 14 }}>
              <AlertCircle size={14} strokeWidth={2} />{error}
            </div>
          )}

          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
            <button onClick={onClose} style={{ padding: '9px 20px', borderRadius: 8,
              border: `1.5px solid ${C.border}`, background: 'transparent',
              color: C.textMuted, fontSize: 13, fontWeight: 700, fontFamily: 'inherit', cursor: 'pointer' }}>
              Annuler
            </button>
            <button onClick={handleSave} disabled={saving}
              style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '9px 20px',
                background: saving ? C.toggleBg : C.green, color: saving ? C.textDim : '#fff',
                border: 'none', borderRadius: 8, fontSize: 13, fontWeight: 700,
                fontFamily: 'inherit', cursor: saving ? 'not-allowed' : 'pointer' }}>
              <Save size={14} strokeWidth={2.5} />
              {saving ? 'Enregistrement…' : 'Enregistrer'}
            </button>
          </div>

        </div>
      </div>
    </div>
  )
}

// ── Tours expand table ────────────────────────────────────────
function ToursTable({ saisieId, token, C, dark }) {
  const [tours, setTours] = useState(null)

  useEffect(() => {
    getSaisie(token, saisieId).then(d => setTours(d.tours || [])).catch(() => setTours([]))
  }, [saisieId])

  if (tours === null) return (
    <tr><td colSpan={20} style={{ padding: '20px 16px', textAlign: 'center', color: C.textDim, fontSize: 12 }}>
      Chargement…
    </td></tr>
  )

  const TH2 = ({ children, color }) => (
    <th style={{ padding: '7px 8px', fontSize: 10, fontWeight: 700, textTransform: 'uppercase',
      letterSpacing: '0.07em', color: color || C.textDim, textAlign: 'center',
      whiteSpace: 'nowrap', background: dark ? 'rgba(52,217,111,0.05)' : 'rgba(24,120,63,0.04)',
      borderBottom: `1px solid ${C.border}` }}>{children}</th>
  )

  return (
    <>
      <tr>
        <td colSpan={20} style={{ padding: 0 }}>
          <div style={{ margin: '0 0 0 32px', borderLeft: `3px solid ${C.green}30` }}>
            <table style={{ width: '100%', minWidth: 1100, borderCollapse: 'collapse', fontFamily: 'inherit' }}>
              <thead>
                <tr>
                  <TH2>N° tour</TH2>
                  <TH2>Rad.</TH2>
                  <TH2 color={C.blue}>Cumul Rad</TH2>
                  <TH2>Heure</TH2>
                  <TH2>T.Repos</TH2>
                  <TH2>Durée(min)</TH2>
                  <TH2>V.Apport</TH2>
                  <TH2>EC Apport</TH2>
                  <TH2>pH Apport</TH2>
                  <TH2>V.Drain</TH2>
                  <TH2>EC Drain</TH2>
                  <TH2>pH Drain</TH2>
                  <TH2 color={C.amber}>% Drain</TH2>
                  <TH2 color={C.amber}>% Drain moyen</TH2>
                </tr>
              </thead>
              <tbody>
                {tours.length === 0 ? (
                  <tr><td colSpan={14} style={{ padding: '16px', textAlign: 'center',
                    color: C.textDim, fontSize: 12 }}>Aucun tour enregistré</td></tr>
                ) : tours.map((t, i) => (
                  <tr key={t.id}
                    style={{ borderBottom: i < tours.length - 1 ? `1px solid ${C.border}` : 'none' }}
                    onMouseEnter={e => e.currentTarget.style.background = C.tableHover}
                    onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                    <td style={{ padding: '8px 8px', textAlign: 'center' }}>
                      <div style={{ width: 26, height: 26, borderRadius: 6, margin: '0 auto',
                        background: `${C.green}12`, border: `1px solid ${C.green}30`,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: 11, fontWeight: 900, color: C.green }}>{t.num_tour}</div>
                    </td>
                    {[
                      { v: t.rad,          dec: 0 },
                      { v: t.cumul_rad,    dec: 0, color: C.blue },
                      { v: t.heure,        raw: true },
                      { v: t.temps_repos !== null ? `${t.temps_repos} min` : '—', raw: true, color: C.textMuted },
                      { v: t.duree_min,    dec: 0 },
                      { v: t.v_apport,     dec: 1 },
                      { v: t.ec_apport,    dec: 2 },
                      { v: t.ph_apport,    dec: 2 },
                      { v: t.v_drain,      dec: 1 },
                      { v: t.ec_drain,     dec: 2 },
                      { v: t.ph_drain,     dec: 2 },
                      { v: t.pct_drain != null ? `${fmtNum(t.pct_drain, 1)}%` : '—', raw: true, color: C.amber },
                      { v: t.moy_pct_drain != null ? `${fmtNum(t.moy_pct_drain, 1)}%` : '—', raw: true, color: C.amber },
                    ].map((cell, ci) => (
                      <td key={ci} style={{ padding: '8px 8px', textAlign: 'center',
                        fontSize: 12, fontWeight: cell.color ? 700 : 400,
                        color: cell.color || C.text }}>
                        {cell.raw ? (cell.v ?? '—') : fmtNum(cell.v, cell.dec ?? 2)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </td>
      </tr>
    </>
  )
}

// ── Main HistoriquePage ───────────────────────────────────────
export default function HistoriquePage({ token, C, dark }) {
  const [saisies, setSaisies]     = useState([])
  const [total, setTotal]         = useState(0)
  const [pages, setPages]         = useState(1)
  const [page, setPage]           = useState(1)
  const [perPage, setPerPage]     = useState(10)
  const [loading, setLoading]     = useState(true)
  const [farms, setFarms]         = useState([])
  const [expandedIds, setExpandedIds] = useState(new Set())
  const [editingSaisie, setEditingSaisie] = useState(null)
  const [confirmDelete, setConfirmDelete] = useState(null)

  // Filtres
  const [fDate,      setFDate]      = useState('')
  const [fFerme,     setFFerme]     = useState('')
  const [fStation,   setFStation]   = useState('')
  const [fSerre,     setFSerre]     = useState('')
  const [fVanne,     setFVanne]     = useState('')
  const [fNbrBras,   setFNbrBras]   = useState('')
  const [fNbrGoutt,  setFNbrGoutt]  = useState('')
  const [fPoidsMat,  setFPoidsMat]  = useState('')
  const [fHeureMat,  setFHeureMat]  = useState('')
  const [fPoidsSoir, setFPoidsSoir] = useState('')
  const [fHeureSoir, setFHeureSoir] = useState('')
  const [fBassin,    setFBassin]    = useState('')

  useEffect(() => {
    getDevices(token).then(setFarms).catch(() => {})
  }, [token])

  const load = useCallback(async (p = 1) => {
    setLoading(true)
    try {
      const params = { page: p, perPage }
      if (fFerme) params.farmName = fFerme
      if (fDate)  { params.dateFrom = fDate; params.dateTo = fDate }
      const data = await getSaisies(token, params)
      setSaisies(data.data || [])
      setTotal(data.total || 0)
      setPages(data.pages || 1)
      setPage(p)
    } catch { setSaisies([]) }
    finally { setLoading(false) }
  }, [token, fFerme, fDate, perPage])

  useEffect(() => { load(1) }, [fFerme, fDate, perPage])

  const filtered = saisies.filter(s =>
    (!fStation   || String(s.station   || '').toLowerCase().includes(fStation.toLowerCase())) &&
    (!fSerre     || String(s.serre     || '').toLowerCase().includes(fSerre.toLowerCase())) &&
    (!fVanne     || String(s.vanne     || '').toLowerCase().includes(fVanne.toLowerCase())) &&
    (!fNbrBras   || String(s.nbr_bras  || '').includes(fNbrBras)) &&
    (!fNbrGoutt  || String(s.nbr_goutteurs || '').includes(fNbrGoutt)) &&
    (!fPoidsMat  || String(s.poids_matin   || '').includes(fPoidsMat)) &&
    (!fHeureMat  || String(s.heure_matin   || '').includes(fHeureMat)) &&
    (!fPoidsSoir || String(s.poids_soir    || '').includes(fPoidsSoir)) &&
    (!fHeureSoir || String(s.heure_soir    || '').includes(fHeureSoir)) &&
    (!fBassin    || String(s.bassin_ec     || '').includes(fBassin))
  )

  const toggleExpand = (id) => {
    setExpandedIds(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  const handleDelete = async () => {
    if (!confirmDelete) return
    try {
      await deleteSaisie(token, confirmDelete.id)
      setConfirmDelete(null)
      load(page)
    } catch (e) { alert(e.message) }
  }

  // Dériver options pour filtres
  const fermeOptions = [...new Set(farms.map(f => f.farm_name))].map(v => ({ value: v, label: v }))
  const selectedFilterFarm = farms.find(f => f.farm_name === fFerme)
  const stationFilterOptions = fFerme && selectedFilterFarm
    ? [...new Set((selectedFilterFarm.houses || []).map(h => h.house_number))].map(v => ({ value: v, label: `Station ${v}` }))
    : [...new Set(farms.flatMap(f => (f.houses || []).map(h => h.house_number)))].map(v => ({ value: v, label: `Station ${v}` }))
  const serreFilterOptions = Array.from({ length: 20 }, (_, i) => ({
    value: `S${String(i + 1).padStart(2, '0')}`,
    label: `S${String(i + 1).padStart(2, '0')}`,
  }))

  const cardStyle = {
    background: C.card, border: `1.5px solid ${C.border}`,
    borderRadius: 14, overflow: 'hidden',
  }

  const TH = ({ children, color, w, center = false }) => (
    <th style={{
      padding: '9px 8px', textAlign: center ? 'center' : 'left',
      fontSize: 10, fontWeight: 700, textTransform: 'uppercase',
      letterSpacing: '0.08em', color: color || C.textDim,
      whiteSpace: 'nowrap', borderBottom: `1.5px solid ${C.border}`,
      width: w, background: dark ? 'rgba(255,255,255,0.015)' : 'rgba(0,0,0,0.018)',
    }}>{children}</th>
  )

  return (
    <>
      {/* Modals en dehors du div animé */}
      {confirmDelete && (
        <ConfirmModal saisie={confirmDelete} onConfirm={handleDelete}
          onCancel={() => setConfirmDelete(null)} C={C} />
      )}
      {editingSaisie && (
        <EditModal saisie={editingSaisie} token={token} farms={farms}
          onSaved={() => load(page)} onClose={() => setEditingSaisie(null)} C={C} dark={dark} />
      )}

      <div style={{ animation: 'az-fade-in 0.3s ease both' }}>

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 28 }}>
          <div>
              <h1 style={{ color: C.text, fontSize: 22, fontWeight: 900, marginBottom: 4, letterSpacing: '-0.02em', display: 'flex', alignItems: 'center', gap: 10 }}>
                <History size={22} color={C.green} strokeWidth={2} />
                Historique
              </h1>
              <p style={{ fontSize: 11, color: C.textDim }}>{total} saisie{total > 1 ? 's' : ''} enregistrée{total > 1 ? 's' : ''}</p>
          </div>

          <select value={perPage} onChange={e => setPerPage(Number(e.target.value))}
            style={{ padding: '7px 10px', borderRadius: 7, border: `1.5px solid ${C.border}`,
              background: C.inputBg, color: C.text, fontSize: 12, fontFamily: 'inherit',
              outline: 'none', cursor: 'pointer' }}>
            {[10, 20, 50].map(n => <option key={n} value={n}>{n}</option>)}
          </select>
        </div>

        {/* Table */}
        <div style={cardStyle}>
          <div style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
            <table style={{ width: '100%', minWidth: 1050, borderCollapse: 'collapse', fontFamily: 'inherit' }}>
              <thead>
                {/* Headers */}
                <tr>
                  <TH w={32} />
                  <TH w={100}>Date</TH>
                  <TH w={80}>Ferme</TH>
                  <TH w={52} center>Bloc</TH>
                  <TH w={60} center>Serre</TH>
                  <TH w={55} center>Vanne</TH>
                  <TH w={70} center>Nbr Bras</TH>
                  <TH w={95} center>Nbr Gout.</TH>
                  <TH w={95} center>Pds Matin</TH>
                  <TH w={75} center>H. Matin</TH>
                  <TH w={95} center>Pds Soir</TH>
                  <TH w={75} center>H. Soir</TH>
                  <TH w={85} center>Bassin EC</TH>
                  <TH w={90} center color={C.green}>Séchage %</TH>
                  <TH w={115}>Actions</TH>
                </tr>
                {/* Filtres */}
                <tr style={{ background: dark ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.02)' }}>
                  <th style={{ padding: '5px 8px', borderBottom: `1px solid ${C.border}` }} />
                  <th style={{ padding: '5px 6px', borderBottom: `1px solid ${C.border}` }}>
                    <FilterInput value={fDate} onChange={setFDate} placeholder="" C={C} type="date" />
                  </th>
                  <th style={{ padding: '5px 6px', borderBottom: `1px solid ${C.border}` }}>
                    <FilterSelect value={fFerme} onChange={v => { setFFerme(v); setFStation('') }}
                      options={fermeOptions} C={C} />
                  </th>
                  <th style={{ padding: '5px 6px', borderBottom: `1px solid ${C.border}` }}>
                    <FilterSelect value={fStation} onChange={setFStation}
                      options={stationFilterOptions} C={C} />
                  </th>
                  <th style={{ padding: '5px 6px', borderBottom: `1px solid ${C.border}` }}>
                    <FilterSelect value={fSerre} onChange={setFSerre}
                      options={serreFilterOptions} C={C} />
                  </th>
                  <th style={{ padding: '5px 6px', borderBottom: `1px solid ${C.border}` }}>
                    <FilterInput value={fVanne} onChange={setFVanne} placeholder="" C={C} />
                  </th>
                  <th style={{ padding: '5px 6px', borderBottom: `1px solid ${C.border}` }}>
                    <FilterInput value={fNbrBras} onChange={setFNbrBras} placeholder="" C={C} />
                  </th>
                  <th style={{ padding: '5px 6px', borderBottom: `1px solid ${C.border}` }}>
                    <FilterInput value={fNbrGoutt} onChange={setFNbrGoutt} placeholder="" C={C} />
                  </th>
                  <th style={{ padding: '5px 6px', borderBottom: `1px solid ${C.border}` }}>
                    <FilterInput value={fPoidsMat} onChange={setFPoidsMat} placeholder="" C={C} />
                  </th>
                  <th style={{ padding: '5px 6px', borderBottom: `1px solid ${C.border}` }}>
                    <FilterInput value={fHeureMat} onChange={setFHeureMat} placeholder="" C={C} />
                  </th>
                  <th style={{ padding: '5px 6px', borderBottom: `1px solid ${C.border}` }}>
                    <FilterInput value={fPoidsSoir} onChange={setFPoidsSoir} placeholder="" C={C} />
                  </th>
                  <th style={{ padding: '5px 6px', borderBottom: `1px solid ${C.border}` }}>
                    <FilterInput value={fHeureSoir} onChange={setFHeureSoir} placeholder="" C={C} />
                  </th>
                  <th style={{ padding: '5px 6px', borderBottom: `1px solid ${C.border}` }}>
                    <FilterInput value={fBassin} onChange={setFBassin} placeholder="" C={C} />
                  </th>
                  <th colSpan={2} style={{ borderBottom: `1px solid ${C.border}` }} />
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={15} style={{ padding: '48px 0', textAlign: 'center', color: C.textDim, fontSize: 13 }}>
                    Chargement…
                  </td></tr>
                ) : filtered.length === 0 ? (
                  <tr><td colSpan={15} style={{ padding: '48px 0', textAlign: 'center', color: C.textDim, fontSize: 13 }}>
                    Aucune saisie trouvée
                  </td></tr>
                ) : filtered.map((s) => {
                  const expanded = expandedIds.has(s.id)
                  return (
                    <React.Fragment key={s.id}>
                      <tr style={{ borderBottom: !expanded ? `1px solid ${C.border}` : 'none', transition: 'background 0.12s' }}
                        onMouseEnter={e => { if (!expanded) e.currentTarget.style.background = C.tableHover }}
                        onMouseLeave={e => { e.currentTarget.style.background = 'transparent' }}>

                        <td style={{ padding: '10px 6px', textAlign: 'center', width: 32 }}>
                          <button onClick={() => toggleExpand(s.id)}
                            style={{ background: expanded ? `${C.green}12` : C.toggleBg,
                              border: `1px solid ${expanded ? C.green + '40' : C.border}`,
                              borderRadius: 5, padding: '3px 7px', cursor: 'pointer',
                              color: expanded ? C.green : C.textMuted,
                              display: 'flex', alignItems: 'center' }}>
                            {expanded ? <ChevronUp size={12} strokeWidth={2.5} /> : <ChevronDown size={12} strokeWidth={2.5} />}
                          </button>
                        </td>
                        <td style={{ padding: '10px 8px', fontWeight: 700, color: C.text, fontSize: 12, whiteSpace: 'nowrap' }}>{s.date}</td>
                        <td style={{ padding: '10px 8px', fontSize: 12, color: C.text, fontWeight: 600 }}>{s.farm_name}</td>
                        <td style={{ padding: '10px 8px', fontSize: 12, color: C.textMuted, textAlign: 'center' }}>{s.station || '—'}</td>
                        <td style={{ padding: '10px 8px', fontSize: 12, color: C.textMuted, textAlign: 'center' }}>{s.serre || '—'}</td>
                        <td style={{ padding: '10px 8px', fontSize: 12, color: C.textMuted, textAlign: 'center' }}>{s.vanne || '—'}</td>
                        <td style={{ padding: '10px 8px', fontSize: 12, textAlign: 'center', color: C.text }}>{s.nbr_bras ?? '—'}</td>
                        <td style={{ padding: '10px 8px', fontSize: 12, textAlign: 'center', color: C.text }}>{s.nbr_goutteurs ?? '—'}</td>
                        <td style={{ padding: '10px 8px', fontSize: 12, textAlign: 'center', color: C.text, fontWeight: 600 }}>{s.poids_matin ?? '—'}</td>
                        <td style={{ padding: '11px 12px', fontSize: 12, textAlign: 'center', color: C.textMuted }}>{s.heure_matin || '—'}</td>
                        <td style={{ padding: '10px 8px', fontSize: 12, textAlign: 'center', color: C.text, fontWeight: 600 }}>{s.poids_soir ?? '—'}</td>
                        <td style={{ padding: '11px 12px', fontSize: 12, textAlign: 'center', color: C.textMuted }}>{s.heure_soir || '—'}</td>
                        <td style={{ padding: '10px 8px', fontSize: 12, textAlign: 'center', color: C.text }}>{s.bassin_ec ?? '—'}</td>
                        <td style={{ padding: '10px 8px', textAlign: 'center' }}>
                          {s.pct_ressuyage != null ? (
                            <span style={{
                              display: 'inline-block',
                              background: `${C.green}15`, color: C.green,
                              border: `1px solid ${C.green}35`, borderRadius: 20,
                              padding: '3px 10px', fontSize: 12, fontWeight: 800,
                              letterSpacing: '0.02em',
                            }}>
                              {fmtNum(s.pct_ressuyage, 1)}%
                            </span>
                          ) : <span style={{ color: C.textDim, fontSize: 12 }}>—</span>}
                        </td>
                        <td style={{ padding: '10px 8px' }}>
                          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                            <button onClick={(e) => { e.stopPropagation(); setEditingSaisie(s) }}
                              style={{ display: 'flex', alignItems: 'center', gap: 5,
                                padding: '5px 11px', borderRadius: 6,
                                border: `1.5px solid ${C.border}`, background: 'transparent',
                                color: C.textMuted, fontSize: 11, fontWeight: 700,
                                fontFamily: 'inherit', cursor: 'pointer',
                                transition: 'all 0.13s', whiteSpace: 'nowrap' }}
                              onMouseEnter={e => { e.currentTarget.style.borderColor = C.green; e.currentTarget.style.color = C.green; e.currentTarget.style.background = `${C.green}08` }}
                              onMouseLeave={e => { e.currentTarget.style.borderColor = C.border; e.currentTarget.style.color = C.textMuted; e.currentTarget.style.background = 'transparent' }}>
                              <Pencil size={11} strokeWidth={2} /> Modifier
                            </button>
                            <button onClick={(e) => { e.stopPropagation(); setConfirmDelete(s) }}
                              style={{ display: 'flex', alignItems: 'center', justifyContent: 'center',
                                width: 28, height: 28, borderRadius: 6,
                                border: `1.5px solid ${C.border}`, background: 'transparent',
                                color: C.textMuted, cursor: 'pointer',
                                transition: 'all 0.13s' }}
                              onMouseEnter={e => { e.currentTarget.style.borderColor = C.red; e.currentTarget.style.color = C.red; e.currentTarget.style.background = `${C.red}08` }}
                              onMouseLeave={e => { e.currentTarget.style.borderColor = C.border; e.currentTarget.style.color = C.textMuted; e.currentTarget.style.background = 'transparent' }}>
                              <Trash2 size={11} strokeWidth={2} />
                            </button>
                          </div>
                        </td>
                      </tr>
                      {expanded && (
                        <ToursTable saisieId={s.id} token={token} C={C} dark={dark} />
                      )}
                    </React.Fragment>
                  )
                })}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          <div style={{ padding: '12px 16px', borderTop: `1px solid ${C.border}`,
            display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ color: C.textDim, fontSize: 12 }}>
              {total} saisie{total > 1 ? 's' : ''} · page {page}/{pages}
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              <button onClick={() => load(page - 1)} disabled={page <= 1}
                style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '5px 12px',
                  borderRadius: 6, border: `1.5px solid ${C.border}`, background: 'transparent',
                  color: C.textMuted, fontSize: 12, fontWeight: 700,
                  cursor: page <= 1 ? 'not-allowed' : 'pointer',
                  opacity: page <= 1 ? 0.4 : 1, fontFamily: 'inherit' }}>
                <ChevronLeft size={13} strokeWidth={2} /> Préc
              </button>
              {Array.from({ length: Math.min(pages, 5) }, (_, i) => {
                const p = i + 1
                return (
                  <button key={p} onClick={() => load(p)}
                    style={{ width: 32, height: 32, borderRadius: 6,
                      border: `1.5px solid ${page === p ? C.green : C.border}`,
                      background: page === p ? C.green : 'transparent',
                      color: page === p ? '#fff' : C.textMuted,
                      fontSize: 12, fontWeight: 700, fontFamily: 'inherit', cursor: 'pointer' }}>
                    {p}
                  </button>
                )
              })}
              <button onClick={() => load(page + 1)} disabled={page >= pages}
                style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '5px 12px',
                  borderRadius: 6, border: `1.5px solid ${C.border}`, background: 'transparent',
                  color: C.textMuted, fontSize: 12, fontWeight: 700,
                  cursor: page >= pages ? 'not-allowed' : 'pointer',
                  opacity: page >= pages ? 0.4 : 1, fontFamily: 'inherit' }}>
                Suiv <ChevronRight size={13} strokeWidth={2} />
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  )
}