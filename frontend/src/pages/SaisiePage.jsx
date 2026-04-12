// ============================================================
// frontend/src/pages/SaisiePage.jsx — Refonte complète
// ============================================================

import { useState, useEffect, useRef } from 'react'
import {
  Plus, Save, ChevronDown, ChevronUp, Droplets,
  FlaskConical, BarChart2, Trash2, AlertCircle, Check,
  ClipboardList,
} from 'lucide-react'
import { getDevices, saveSaisie } from '../api/client.js'

// ── helpers ───────────────────────────────────────────────────
const today = () => new Date().toISOString().split('T')[0]
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

function newTour(num) {
  return {
    id: Date.now() + num, num,
    rad: '', cumulRad: 0,
    heure: '', duree: '', tempsRepos: null,
    vApport: '', ecApport: '', phApport: '',
    vDrain: '', ecDrain: '', phDrain: '',
    pctDrain: null, moyPctDrain: null,
  }
}

// ── TInput ────────────────────────────────────────────────────
function TInput({ value, onChange, placeholder = '', disabled = false, width = 72, C }) {
  return (
    <input
      type="number" value={value}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      disabled={disabled} step="any"
      style={{
        width, textAlign: 'center',
        padding: '5px 6px', borderRadius: 6,
        border: `1.5px solid ${disabled ? 'transparent' : C?.border || '#c8dece'}`,
        background: disabled ? 'transparent' : (C?.inputBg || '#f9fbfa'),
        color: disabled ? (C?.green || '#18783f') : (C?.text || '#0d1f14'),
        fontSize: 12, fontFamily: 'inherit', outline: 'none',
        fontWeight: 630, 
      }}
    />
  )
}

// ── TimeInput — style scroll hh:mm ───────────────────────────
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
    const hv = parseInt(h || '0')
    const mv = parseInt(m || '0')
    if (type === 'h') onChange(`${String((hv + 1) % 24).padStart(2, '0')}:${m || '00'}`)
    else onChange(`${h || '00'}:${String((mv + 1) % 60).padStart(2, '0')}`)
  }
  const dec = (type) => {
    const hv = parseInt(h || '0')
    const mv = parseInt(m || '0')
    if (type === 'h') onChange(`${String((hv - 1 + 24) % 24).padStart(2, '0')}:${m || '00'}`)
    else onChange(`${h || '00'}:${String((mv - 1 + 60) % 60).padStart(2, '0')}`)
  }

  const colStyle = { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }
  const arrowStyle = {
    background: 'none', border: 'none', cursor: 'pointer',
    color: C.textMuted, display: 'flex', alignItems: 'center',
    padding: '4px 8px', borderRadius: 5, transition: 'background 0.1s',
  }
  const numStyle = {
    fontSize: 22, fontWeight: 630, color: C.text,
    width: 48, textAlign: 'center',
    background: 'none', border: 'none', outline: 'none',
    fontFamily: 'inherit', padding: 0,
  }

  return (
    <div ref={ref} style={{ position: 'relative', display: 'inline-block' }}>
      {/* Trigger */}
      <div
        ref={triggerRef}
        onClick={handleOpen}
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          height: 34, padding: '0 10px', minWidth: 80,
          border: `1.5px solid ${open ? C.green : C.border}`,
          borderRadius: 7, background: C.inputBg,
          cursor: 'pointer', transition: 'border-color 0.15s',
          fontSize: 12, color: value ? C.text : C.textDim,
          gap: 4, fontWeight: 630,
        }}
      >
        <span>{h || '00'}</span>
        <span style={{ color: C.textDim }}>:</span>
        <span>{m || '00'}</span>
      </div>

      {/* Dropdown picker */}
      {open && (
        <div style={{
          position: 'fixed',           // ← clé du fix
          top: pos.top,
          left: pos.left,
          transform: 'translateX(-50%)',
          background: C.card, border: `1.5px solid ${C.border}`,
          borderRadius: 10, zIndex: 9999,   // ← au-dessus de tout
          boxShadow: `0 4px 24px ${C.shadow}`,
          padding: '10px 16px',
          display: 'flex', alignItems: 'center', gap: 4,
        }}>
          {/* HH */}
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
            <button style={{ background: 'none', border: 'none', cursor: 'pointer', color: C.textMuted, padding: '4px 8px', borderRadius: 5 }}
              onClick={() => inc('h')}><ChevronUp size={16} strokeWidth={2.5}/></button>
            <input type="text" inputMode="numeric" maxLength={2} value={h || '00'}
              onChange={e => { const v = parseInt(e.target.value)||0; onChange(`${String(Math.min(23,Math.max(0,v))).padStart(2,'0')}:${m||'00'}`) }}
              style={{ fontSize: 22, fontWeight: 630, color: C.text, width: 48, textAlign: 'center', background: 'none', border: 'none', outline: 'none', fontFamily: 'inherit', padding: 0 }}
            />
            <button style={{ background: 'none', border: 'none', cursor: 'pointer', color: C.textMuted, padding: '4px 8px', borderRadius: 5 }}
              onClick={() => dec('h')}><ChevronDown size={16} strokeWidth={2.5}/></button>
          </div>

          <span style={{ fontSize: 22, fontWeight: 900, color: C.textMuted }}>:</span>

          {/* MM */}
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
            <button style={{ background: 'none', border: 'none', cursor: 'pointer', color: C.textMuted, padding: '4px 8px', borderRadius: 5 }}
              onClick={() => inc('m')}><ChevronUp size={16} strokeWidth={2.5}/></button>
            <input type="text" inputMode="numeric" maxLength={2} value={m || '00'}
              onChange={e => { const v = parseInt(e.target.value)||0; onChange(`${h||'00'}:${String(Math.min(59,Math.max(0,v))).padStart(2,'0')}`) }}
              style={{ fontSize: 22, fontWeight: 630, color: C.text, width: 48, textAlign: 'center', background: 'none', border: 'none', outline: 'none', fontFamily: 'inherit', padding: 0 }}
            />
            <button style={{ background: 'none', border: 'none', cursor: 'pointer', color: C.textMuted, padding: '4px 8px', borderRadius: 5 }}
              onClick={() => dec('m')}><ChevronDown size={16} strokeWidth={2.5}/></button>
          </div>
        </div>
      )}
    </div>
  )
}

// ── CustomSelect — même design que fermes assignées ───────────
function CustomSelect({ value, onChange, options, placeholder, C, disabled = false }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)

  useEffect(() => {
    const close = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [])

  const selected = options.find(o => (o.value ?? o) === value)
  const label = selected ? (selected.label ?? selected) : null

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <div
        onClick={() => !disabled && setOpen(v => !v)}
        style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '0 10px', height: 38,
          border: `1.5px solid ${open ? C.green : C.border}`,
          borderRadius: 8, background: disabled ? C.toggleBg : C.inputBg,
          cursor: disabled ? 'not-allowed' : 'pointer',
          transition: 'border-color 0.15s', gap: 6, fontWeight: 630,
          opacity: disabled ? 0.5 : 1,
        }}
      >
        <span style={{ fontSize: 12, color: label ? C.text : C.textDim }}>
          {label || placeholder}
        </span>
        <span style={{ color: C.textDim, display: 'flex', alignItems: 'center' }}>
          {open ? <ChevronUp size={12} strokeWidth={2}/> : <ChevronDown size={12} strokeWidth={2}/>}
        </span>
      </div>
      {open && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0,
          background: C.card, border: `1.5px solid ${C.border}`,
          borderRadius: 8, zIndex: 200, boxShadow: `0 4px 20px ${C.shadow}`,
          maxHeight: 200, overflowY: 'auto', fontWeight: 630,
        }}>
          {options.length === 0 ? (
            <div style={{ padding: '10px 14px', color: C.textDim, fontSize: 12 }}>Aucune option</div>
          ) : options.map(o => {
            const val = o.value ?? o
            const lbl = o.label ?? o
            const sel = val === value
            return (
              <div
                key={val}
                onClick={() => { onChange(val); setOpen(false) }}
                style={{
                  padding: '9px 14px', fontSize: 12, cursor: 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  color: sel ? C.green : C.textMuted,
                  background: sel ? `${C.green}12` : 'transparent',
                  transition: 'background 0.1s',
                }}
                onMouseEnter={e => e.currentTarget.style.background = sel ? `${C.green}18` : C.tableHover}
                onMouseLeave={e => e.currentTarget.style.background = sel ? `${C.green}12` : 'transparent'}
              >
                <span>{lbl}</span>
                {sel && <Check size={12} strokeWidth={2.5}/>}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ── BilanCard ─────────────────────────────────────────────────
function BilanCard({ title, items, color, icon: Icon, C, dark }) {
  return (
    <div style={{
      background: dark ? `${color}10` : `${color}08`,
      border: `1.5px solid ${color}30`,
      borderRadius: 12, padding: '14px 18px', flex: 1,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <div style={{ fontSize: 12, fontWeight: 630, color, textTransform: 'uppercase', letterSpacing: '0em' }}>
          {title}
        </div>
        <div style={{
          width: 26, height: 26, borderRadius: 7,
          background: `${color}18`, border: `1px solid ${color}30`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <Icon size={12} color={color} strokeWidth={2} />
        </div>
      </div>
      <div style={{ display: 'flex', gap: 16 }}>
        {items.map(item => (
          <div key={item.label}>
            <div style={{ fontSize: 12, color: `${color}90`, marginBottom: 2 }}>{item.label}</div>
            <div style={{ fontSize: 20, fontWeight: 900, color }}>{item.value ?? '—'}</div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── TH ───────────────────────────────────────────────────────
function TH({ children, w, color, C }) {
  return (
    <th style={{
      padding: '8px 6px', textAlign: 'center',
      fontSize: 12, fontWeight: 630, textTransform: 'uppercase',
      letterSpacing: '0em', color: color || C.textDim,
      whiteSpace: 'nowrap', width: w,
      borderBottom: `1.5px solid ${C.border}`,
    }}>
      {children}
    </th>
  )
}

// ── SLabel ───────────────────────────────────────────────────
function SLabel({ children, C }) {
  return (
    <div style={{
      fontSize: 12, fontWeight: 630, textTransform: 'uppercase',
      letterSpacing: '0em', color: C.textDim, marginBottom: 5,
    }}>{children}</div>
  )
}

// ── Main ──────────────────────────────────────────────────────
export default function SaisiePage({ token, auth, C, dark }) {

  const [farms, setFarms]           = useState([])
  const [ferme, setFerme]           = useState('')
  const [station, setStation]       = useState('')
  const [serre, setSerre]           = useState('')
  const [vanne, setVanne]           = useState('')
  const [date, setDate]             = useState(today())

  const [nbrBras, setNbrBras]               = useState('')
  const [nbrGoutteurs, setNbrGoutteurs]     = useState('')
  const [poidsMatin, setPoidsMatin]         = useState('')
  const [heureMatin, setHeureMatin]         = useState('')
  const [poidsSoir, setPoidsSoir]           = useState('')
  const [heureSoir, setHeureSoir]           = useState('')
  const [bassinEC, setBassinEC]             = useState('')

  const [tours, setTours]     = useState([])
  const [saving, setSaving]   = useState(false)
  const [saved, setSaved]     = useState(false)
  const [savedId, setSavedId] = useState(null)
  const [error, setError]     = useState('')

  const tableBottomRef = useRef(null)

  useEffect(() => {
    getDevices(token).then(setFarms).catch(() => setFarms([]))
  }, [token])

  // ── Options dérivées ──
  const fermeOptions   = [...new Set(farms.map(f => f.farm_name))].map(v => ({ value: v, label: v }))
  const selectedFarm   = farms.find(f => f.farm_name === ferme)
  const houses         = selectedFarm?.houses || []
  const stationOptions = [...new Set(houses.map(h => h.house_number))].map(v => ({
    value: v,
    label: `Station ${v}`,
  }))
  const serreOptions   = station
    ? Array.from({ length: 20 }, (_, i) => ({
        value: `S${String(i + 1).padStart(2, '0')}`,
        label: `S${String(i + 1).padStart(2, '0')}`,
      }))
    : []

  // ── % Ressuyage ──
  const pctRessuyage = poidsMatin && poidsSoir && Number(poidsMatin) > 0
    ? (((Number(poidsSoir) - Number(poidsMatin)) / Number(poidsMatin)) * 100).toFixed(1)
    : null

  // ── Recalcul tours ──
  const recalculTours = (list) => {
    // Cumul Rad entre 2 tours = Rad actuelle − somme des Cumul Rad précédents
    let cumulPrev = 0
    return list.map((t, i) => {
      const prev = i > 0 ? list[i - 1] : null
      const radActuelle = Number(t.rad) || 0

      // Cumul Rad = Rad actuelle - somme de tous les cumul rad précédents
      const cumulRad = radActuelle - cumulPrev
      cumulPrev += cumulRad

      // Temps repos
      let tempsRepos = null
      if (i > 0 && prev?.heure && prev?.duree && t.heure) {
        const toMin = h => { const [hh, mm] = h.split(':').map(Number); return hh * 60 + mm }
        tempsRepos = toMin(t.heure) - (toMin(prev.heure) + (Number(prev.duree) || 0))
        if (tempsRepos < 0) tempsRepos = 0
      }

      // % Drain
      let pctDrain = null
      if (t.vDrain && t.vApport && nbrGoutteurs && Number(t.vApport) > 0 && Number(nbrGoutteurs) > 0) {
        pctDrain = (Number(t.vDrain) / Number(nbrGoutteurs) / Number(t.vApport)) * 100
      }

      // Moy % Drain
      let moyPctDrain = null
      if (pctDrain !== null) {
        const prevMoy = prev?.moyPctDrain ?? null
        moyPctDrain = i === 0 ? pctDrain : prevMoy !== null ? (prevMoy * i + pctDrain) / (i + 1) : null
      }

      return { ...t, cumulRad: Math.max(0, cumulRad), tempsRepos, pctDrain, moyPctDrain }
    })
  }

  const updateTour = (id, field, val) => {
    setTours(prev => recalculTours(prev.map(t => t.id === id ? { ...t, [field]: val } : t)))
  }

  const addTour = () => {
    setTours(prev => {
      const next = [...prev, newTour(prev.length + 1)]
      const recalc = recalculTours(next)
      setTimeout(() => tableBottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 50)
      return recalc
    })
  }

  const deleteTour = (id) => {
    setTours(prev => recalculTours(
      prev.filter(t => t.id !== id).map((t, i) => ({ ...t, num: i + 1 }))
    ))
  }

  // ── Bilan ──
  const lastTour        = tours[tours.length - 1]
  const totalVApport    = tours.reduce((s, t) => s + (Number(t.vApport) || 0), 0)
  const totalVDrain     = tours.reduce((s, t) => s + (Number(t.vDrain) || 0), 0)
  // Durée totale = somme des durées seulement
  const dureeTotal      = tours.reduce((s, t) => s + (Number(t.duree) || 0), 0)
  const ecMoyApport     = tours.length ? (tours.reduce((s, t) => s + (Number(t.ecApport) || 0), 0) / tours.filter(t => t.ecApport).length || null) : null
  const phMoyApport     = tours.length ? (tours.reduce((s, t) => s + (Number(t.phApport) || 0), 0) / tours.filter(t => t.phApport).length || null) : null
  const ecMoyDrain      = tours.length ? (tours.reduce((s, t) => s + (Number(t.ecDrain) || 0), 0) / tours.filter(t => t.ecDrain).length || null) : null
  const phMoyDrain      = tours.length ? (tours.reduce((s, t) => s + (Number(t.phDrain) || 0), 0) / tours.filter(t => t.phDrain).length || null) : null
  const moyDrainFinale  = lastTour?.moyPctDrain ?? null

  const ccBras = totalVApport && moyDrainFinale !== null && nbrGoutteurs && nbrBras && Number(nbrBras) > 0
    ? ((totalVApport * (1 - moyDrainFinale / 100) * Number(nbrGoutteurs)) / Number(nbrBras)).toFixed(1)
    : null

  const handleSave = async () => {
    if (!ferme || !date || tours.length === 0) {
      setError('Veuillez remplir la ferme, la date et au moins un tour.')
      return
    }
    setSaving(true); setError('')
    try {
      const payload = {
        ferme,
        station,
        serre,
        vanne,
        date,
        constantes: {
          nbrBras       : nbrBras      !== '' ? Number(nbrBras)      : null,
          nbrGoutteurs  : nbrGoutteurs !== '' ? Number(nbrGoutteurs) : null,
          poidsMatin    : poidsMatin   !== '' ? Number(poidsMatin)   : null,
          heureMatin,
          poidsSoir     : poidsSoir    !== '' ? Number(poidsSoir)    : null,
          heureSoir,
          bassinEC      : bassinEC     !== '' ? Number(bassinEC)     : null,
          pctRessuyage  : pctRessuyage != null ? Number(pctRessuyage) : null,
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
          pct_drain    : t.pctDrain  != null ? Number(t.pctDrain)   : null,
          moy_pct_drain: t.moyPctDrain != null ? Number(t.moyPctDrain) : null,
        })),
        bilan: {
          nbrTours      : tours.length,
          dureeTotal    : dureeTotal > 0 ? fmtDuree(dureeTotal) : null,
          totalVApport  : totalVApport  != null ? totalVApport  : null,
          totalVDrain   : totalVDrain   != null ? totalVDrain   : null,
          ecMoyApport   : ecMoyApport   != null ? Number(ecMoyApport)   : null,
          phMoyApport   : phMoyApport   != null ? Number(phMoyApport)   : null,
          ecMoyDrain    : ecMoyDrain    != null ? Number(ecMoyDrain)    : null,
          phMoyDrain    : phMoyDrain    != null ? Number(phMoyDrain)    : null,
          moyDrainFinale: moyDrainFinale != null ? Number(moyDrainFinale) : null,
          ccBras        : ccBras        != null ? Number(ccBras)        : null,
        },
      }
      const result = await saveSaisie(token, payload)
      setSaved(true)
      setSavedId(result.saisie_id)
      setTimeout(() => setSaved(false), 5000)
    } catch (e) {
      // e.message peut être un string JSON — extraire le detail
      try {
        const parsed = JSON.parse(e.message)
        if (parsed?.detail) {
          const detail = parsed.detail
          setError(Array.isArray(detail)
            ? detail.map(d => `${d.loc?.join('.')} : ${d.msg}`).join(' | ')
            : String(detail)
          )
        } else {
          setError(String(e.message))
        }
      } catch {
        setError(String(e.message))
      }
    } finally {
      setSaving(false)
    }
  }

  const cardStyle = {
    background: C.card, border: `1.5px solid ${C.border}`,
    borderRadius: 14, padding: '18px 22px', marginBottom: 16,
  }
  const labelStyle = {
    display: 'block', color: C.textMuted, fontSize: 12, fontWeight: 800,
    textTransform: 'uppercase', letterSpacing: '0em', marginBottom: 5,
  }
  const inputStyle = {
    width: '100%', padding: '8px 12px', borderRadius: 8, fontWeight: 630,
    border: `1.5px solid ${C.border}`, background: C.inputBg,
    color: C.text, fontSize: 12, fontFamily: 'inherit', outline: 'none',
  }

  return (
    <div style={{ maxWidth: 1500 }}>

      {/* ── Header ──────────────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 28 }}>          
        <div>
          <h1 style={{ color: C.text, fontSize: 22, fontWeight: 900, marginBottom: 4, letterSpacing: '-0.02em', display: 'flex', alignItems: 'center', gap: 10 }}>
            <ClipboardList size={22} color={C.green} strokeWidth={2} />
            Saisie journalière
          </h1>
          <p style={{ fontSize: 11, color: C.textDim }}>{date}</p>
        </div>
      </div>

      {/* ── Bilan ligne ─────────────────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr 1fr 1fr', gap: 16, marginBottom: 28, marginTop: 20 }}>
        {[
          {
            label: 'Irrigation',
            color: C.green,
            Icon: ClipboardList,
            items: [
              { sub: 'Total tours', value: tours.length > 0 ? tours.length : '—' },
              { sub: 'Durée totale', value: fmtDuree(dureeTotal) },
              { sub: 'CC/bras (cc)', value: ccBras ?? '—' },
            ],
          },
          {
            label: 'Bilan Eau',
            color: C.blue,
            Icon: Droplets,
            items: [
              { sub: 'Apport', value: totalVApport > 0 ? fmtNum(totalVApport, 1) : '—' },
              { sub: 'Drainage', value: totalVDrain > 0 ? fmtNum(totalVDrain, 1) : '—' },
            ],
          },
          {
            label: 'Bilan EC',
            color: C.green,
            Icon: BarChart2,
            items: [
              { sub: 'Apport', value: ecMoyApport ? fmtNum(ecMoyApport, 2) : '—' },
              { sub: 'Drainage', value: ecMoyDrain ? fmtNum(ecMoyDrain, 2) : '—' },
            ],
          },
          {
            label: 'Bilan pH',
            color: C.amber,
            Icon: FlaskConical,
            items: [
              { sub: 'Apport', value: phMoyApport ? fmtNum(phMoyApport, 2) : '—' },
              { sub: 'Drainage', value: phMoyDrain ? fmtNum(phMoyDrain, 2) : '—' },
            ],
          },
        ].map(card => (
          <div key={card.label} style={{
            background: dark ? '#111a14' : '#ffffff',
            border: `1px solid ${dark ? '#1c2e22' : '#d0e8d8'}`,
            borderRadius: 16, padding: '20px 24px',
            position: 'relative', overflow: 'hidden',
            display: 'flex', flexDirection: 'column', justifyContent: 'space-between', // ← ajout
            minHeight: 130, // ← hauteur augmentée
          }}>
            {/* Header */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 0 }}>
              <div style={{
                fontSize: 11, fontWeight: 600, textTransform: 'uppercase',
                letterSpacing: '0em', color: dark ? C.textDim : '#5a7a66',
              }}>
                {card.label}
              </div>
              <card.Icon size={16} strokeWidth={1.6} color={card.color} style={{ opacity: 0.65 }} />
            </div>

            {/* Values — collés en bas */}
            <div style={{ display: 'flex', gap: 20, alignItems: 'flex-end' }}>
              {card.items.map(it => (
                <div key={it.sub}>
                  <div style={{ fontSize: 11, color: dark ? C.textDim : '#5a7a66', marginBottom: 4, whiteSpace: 'nowrap' }}>
                    {it.sub}
                  </div>
                  <div style={{ fontSize: 22, fontWeight: 630, letterSpacing: '-0.02em', color: card.color }}>
                    {it.value}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
      
      {/* ── Ferme / Station / Serre / Vanne / Date ─────────── */}
      <div style={{ ...cardStyle }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr 180px', gap: 14 }}>
          <div>
            <label style={labelStyle}>Ferme</label>
            <CustomSelect
              value={ferme}
              onChange={v => { setFerme(v); setStation(''); setSerre('') }}
              options={fermeOptions}
              placeholder="Sélectionner…"
              C={C}
            />
          </div>
          <div>
            <label style={labelStyle}>Station</label>
            <CustomSelect
              value={station}
              onChange={v => { setStation(v); setSerre('') }}
              options={stationOptions}
              placeholder="Sélectionner…"
              C={C}
              disabled={!ferme}
            />
          </div>
          <div>
            <label style={labelStyle}>Serre</label>
            <CustomSelect
              value={serre}
              onChange={setSerre}
              options={serreOptions}
              placeholder="S01"
              C={C}
              disabled={!station}
            />
          </div>
          <div>
            <label style={labelStyle}>Vanne</label>
            <input value={vanne} onChange={e => setVanne(e.target.value)}
              placeholder="ex: 1" style={{ ...inputStyle, height: 38, padding: '0 12px', boxSizing: 'border-box' }} />
          </div>
          <div>
            <label style={labelStyle}>Date</label>
            <input type="date" value={date} onChange={e => setDate(e.target.value)}
              style={{ ...inputStyle, height: 38, padding: '0 12px', boxSizing: 'border-box' }} />
          </div>
        </div>

        {/* ── Constantes & Substrat — ligne sous les sélecteurs ── */}
        <div style={{
          marginTop: 16, paddingTop: 16,
          borderTop: `1px solid ${C.border}`,
        }}>
          <div style={{ fontSize: 12, fontWeight: 800, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '0em', marginBottom: 12 }}>
            Constantes &amp; Substrat
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 14, alignItems: 'end' }}>

            <div>
              <SLabel C={C}>Nbr Bras</SLabel>
              <input type="number" value={nbrBras} onChange={e => setNbrBras(e.target.value)}
                placeholder="0" style={{ ...inputStyle, padding: '7px 10px' }} />
            </div>

            <div>
              <SLabel C={C}>Nbr Goutteurs</SLabel>
              <input type="number" value={nbrGoutteurs} onChange={e => setNbrGoutteurs(e.target.value)}
                placeholder="0" style={{ ...inputStyle, padding: '7px 10px' }} />
            </div>

            <div>
              <SLabel C={C}>Poids matin (Kg)</SLabel>
              <input type="number" value={poidsMatin} onChange={e => setPoidsMatin(e.target.value)}
                placeholder="0.00" step="0.01" style={{ ...inputStyle, padding: '7px 10px' }} />
            </div>

            <div>
              <SLabel C={C}>Heure matin</SLabel>
              <TimeInput value={heureMatin} onChange={setHeureMatin} C={C} />
            </div>

            <div>
              <SLabel C={C}>Poids soir (Kg)</SLabel>
              <input type="number" value={poidsSoir} onChange={e => setPoidsSoir(e.target.value)}
                placeholder="0.00" step="0.01" style={{ ...inputStyle, padding: '7px 10px' }} />
            </div>

            <div>
              <SLabel C={C}>Heure soir</SLabel>
              <TimeInput value={heureSoir} onChange={setHeureSoir} C={C} />
            </div>

            <div>
              <SLabel C={C}>Bassin (EC)</SLabel>
              <input type="number" value={bassinEC} onChange={e => setBassinEC(e.target.value)}
                placeholder="0.00" step="0.01" style={{ ...inputStyle, padding: '7px 10px' }} />
            </div>

          </div>

          {/* % Ressuyage */}
          {pctRessuyage !== null && (
            <div style={{
              marginTop: 10, display: 'inline-flex', alignItems: 'center', gap: 8,
            }}>
              <span style={{ fontSize: 12, color: C.textDim }}>% Ressuyage</span>
              <span style={{ fontSize: 12, fontWeight: 500, color: C.green }}>{pctRessuyage}%</span>
            </div>
          )}
        </div>
      </div>

      {/* ── Table Tours ──────────────────────────────────────── */}
      <div style={{ ...cardStyle, marginBottom: 0 }}>
        <div style={{ fontSize: 12, fontWeight: 800, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '0em', marginBottom: 14 }}>
          Tours d'irrigation
        </div>

        <div style={{ overflowX: 'auto', overflowY: 'visible' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: 'inherit' }}>
            <thead>
              <tr>
                <TH w={36} C={C}>N°</TH>
                <TH w={70} C={C}>Rad.</TH>
                <TH w={80} color={C.blue} C={C}>Cumul Rad</TH>
                <TH w={120} C={C}>Heure</TH>
                <TH w={80} color={C.textDim} C={C}>T.Repos</TH>
                <TH w={72} C={C}>Durée (min)</TH>
                <TH w={78} C={C}>V.Apport</TH>
                <TH w={72} C={C}>EC Apport</TH>
                <TH w={72} C={C}>pH Apport</TH>
                <TH w={72} C={C}>V.Drain</TH>
                <TH w={72} C={C}>EC Drain</TH>
                <TH w={72} C={C}>pH Drain</TH>
                <TH w={72} color={C.amber} C={C}>% Drain</TH>
                <TH w={80} color={C.amber} C={C}>Moy % Drain</TH>
                <TH w={36} C={C}></TH>
              </tr>
            </thead>
            <tbody style={{ overflow: 'visible' }}>
              {tours.length === 0 ? (
                <tr>
                  <td colSpan={15} style={{ padding: '40px 0', textAlign: 'center', color: C.textDim, fontSize: 12 }}>
                    Cliquez sur <strong style={{ color: C.green }}>+ Nouveau tour</strong> pour ajouter le premier tour
                  </td>
                </tr>
              ) : tours.map((t, i) => (
                <tr key={t.id} style={{
                  borderBottom: i < tours.length - 1 ? `1px solid ${C.border}` : 'none',
                  background: i % 2 === 0 ? 'transparent' : (dark ? 'rgba(255,255,255,0.01)' : 'rgba(0,0,0,0.01)'),
                }}>
                  <td style={{ padding: '6px 4px', textAlign: 'center' }}>
                    <div style={{
                      width: 26, height: 26, borderRadius: 7,
                      background: dark ? 'rgba(52,217,111,0.12)' : 'rgba(24,120,63,0.08)',
                      border: `1.5px solid ${C.green}30`,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 12, fontWeight: 900, color: C.green, margin: '0 auto',
                    }}>{t.num}</div>
                  </td>
                  <td style={{ padding: '6px 4px', textAlign: 'center' }}>
                    <TInput value={t.rad} onChange={v => updateTour(t.id, 'rad', v)} width={68} C={C} />
                  </td>
                  <td style={{ padding: '6px 4px', textAlign: 'center' }}>
                    <div style={{ fontSize: 12, fontWeight: 630, color: C.blue }}>
                      {t.cumulRad > 0 ? fmtNum(t.cumulRad, 1) : '—'}
                    </div>
                  </td>
                  <td style={{ padding: '6px 4px', textAlign: 'center' }}>
                    <TimeInput value={t.heure} onChange={v => updateTour(t.id, 'heure', v)} C={C} />
                  </td>
                  <td style={{ padding: '6px 4px', textAlign: 'center' }}>
                    <div style={{ fontSize: 12, fontWeight: 630, color: t.tempsRepos !== null ? C.textMuted : C.textDim }}>
                      {t.tempsRepos !== null ? `${t.tempsRepos} min` : i === 0 ? '—' : '?'}
                    </div>
                  </td>
                  <td style={{ padding: '6px 4px', fontWeight: 630, textAlign: 'center' }}>
                    <TInput value={t.duree} onChange={v => updateTour(t.id, 'duree', v)} width={68} C={C} />
                  </td>
                  <td style={{ padding: '6px 4px', fontWeight: 630, textAlign: 'center' }}>
                    <TInput value={t.vApport} onChange={v => updateTour(t.id, 'vApport', v)} width={72} C={C} />
                  </td>
                  <td style={{ padding: '6px 4px', fontWeight: 630, textAlign: 'center' }}>
                    <TInput value={t.ecApport} onChange={v => updateTour(t.id, 'ecApport', v)} width={68} C={C} />
                  </td>
                  <td style={{ padding: '6px 4px', fontWeight: 630, textAlign: 'center' }}>
                    <TInput value={t.phApport} onChange={v => updateTour(t.id, 'phApport', v)} width={68} C={C} />
                  </td>
                  <td style={{ padding: '6px 4px', fontWeight: 630, textAlign: 'center' }}>
                    <TInput value={t.vDrain} onChange={v => updateTour(t.id, 'vDrain', v)} width={68} C={C} />
                  </td>
                  <td style={{ padding: '6px 4px', fontWeight: 630, textAlign: 'center' }}>
                    <TInput value={t.ecDrain} onChange={v => updateTour(t.id, 'ecDrain', v)} width={68} C={C} />
                  </td>
                  <td style={{ padding: '6px 4px', fontWeight: 630, textAlign: 'center' }}>
                    <TInput value={t.phDrain} onChange={v => updateTour(t.id, 'phDrain', v)} width={68} C={C} />
                  </td>
                  <td style={{ padding: '6px 4px', textAlign: 'center' }}>
                    <div style={{ fontSize: 12, fontWeight: 630, color: t.pctDrain !== null ? C.amber : C.textDim }}>
                      {t.pctDrain !== null ? `${fmtNum(t.pctDrain, 1)}%` : '—'}
                    </div>
                  </td>
                  <td style={{ padding: '6px 4px', textAlign: 'center' }}>
                    <div style={{ fontSize: 12, fontWeight: 630, color: t.moyPctDrain !== null ? C.amber : C.textDim }}>
                      {t.moyPctDrain !== null ? `${fmtNum(t.moyPctDrain, 1)}%` : '—'}
                    </div>
                  </td>
                  <td style={{ padding: '6px 4px', textAlign: 'center' }}>
                    <button onClick={() => deleteTour(t.id)} style={{
                      background: 'none', border: 'none', cursor: 'pointer',
                      color: C.textDim, padding: 4, borderRadius: 5,
                      display: 'flex', alignItems: 'center',
                    }}
                      onMouseEnter={e => e.currentTarget.style.color = C.red}
                      onMouseLeave={e => e.currentTarget.style.color = C.textDim}
                    >
                      <Trash2 size={12} strokeWidth={2} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>

            {tours.length > 0 && (
              <tfoot>
                <tr style={{ borderTop: `2px solid ${C.border}` }}>
                  <td colSpan={6} style={{ padding: '8px 6px', fontSize: 12, fontWeight: 630, color: C.textMuted }}>TOTAUX</td>
                  <td style={{ padding: '8px 4px', textAlign: 'center', fontSize: 12, fontWeight: 900, color: C.green }}>{fmtNum(totalVApport, 1)}</td>
                  <td style={{ padding: '8px 4px', textAlign: 'center', fontSize: 12, fontWeight: 630, color: C.textMuted }}>{ecMoyApport ? fmtNum(ecMoyApport, 2) : '—'}</td>
                  <td style={{ padding: '8px 4px', textAlign: 'center', fontSize: 12, fontWeight: 630, color: C.textMuted }}>{phMoyApport ? fmtNum(phMoyApport, 2) : '—'}</td>
                  <td style={{ padding: '8px 4px', textAlign: 'center', fontSize: 12, fontWeight: 900, color: C.blue }}>{fmtNum(totalVDrain, 1)}</td>
                  <td style={{ padding: '8px 4px', textAlign: 'center', fontSize: 12, fontWeight: 630, color: C.textMuted }}>{ecMoyDrain ? fmtNum(ecMoyDrain, 2) : '—'}</td>
                  <td style={{ padding: '8px 4px', textAlign: 'center', fontSize: 12, fontWeight: 630, color: C.textMuted }}>{phMoyDrain ? fmtNum(phMoyDrain, 2) : '—'}</td>
                  <td style={{ padding: '8px 4px', textAlign: 'center', fontSize: 12, fontWeight: 900, color: C.amber }}>{moyDrainFinale !== null ? `${fmtNum(moyDrainFinale, 1)}%` : '—'}</td>
                  <td colSpan={2} />
                </tr>
              </tfoot>
            )}
          </table>
        </div>

        {/* ── + Nouveau tour en bas de table ── */}
        <div ref={tableBottomRef} style={{
          marginTop: 12, display: 'flex',
          alignItems: 'center', justifyContent: 'flex-end',  // ← droite
        }}>
          <button
            onClick={addTour}
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '9px 18px',
              background: dark ? 'rgba(52,217,111,0.10)' : 'rgba(24,120,63,0.08)',
              border: `1.5px solid ${C.green}40`,
              borderRadius: 8, color: C.green,
              fontSize: 12, fontWeight: 630, fontFamily: 'inherit', cursor: 'pointer',
            }}
          >
            <Plus size={12} strokeWidth={2.5} />
            Nouveau tour
          </button>
        </div>

        {/* Résumé CC/bras */}
        {tours.length > 0 && (
          <div style={{
            marginTop: 14, padding: '12px 16px',
            background: dark ? 'rgba(52,217,111,0.06)' : 'rgba(24,120,63,0.04)',
            border: `1px solid ${C.green}20`,
            borderRadius: 10, display: 'flex', gap: 32, flexWrap: 'wrap',
          }}>
            {[
              { label: 'Durée totale', value: fmtDuree(dureeTotal) },
              { label: 'Total V.Apport', value: fmtNum(totalVApport, 1) },
              { label: 'Total V.Drain', value: fmtNum(totalVDrain, 1) },
              { label: 'Moy % Drainage finale', value: moyDrainFinale !== null ? `${fmtNum(moyDrainFinale, 1)}%` : '—' },
              { label: 'CC/bras consommé (cc)', value: ccBras ?? '—', highlight: true },
            ].map(item => (
              <div key={item.label}>
                <div style={{ fontSize: 12, color: C.textDim, marginBottom: 3 }}>{item.label}</div>
                <div style={{ fontSize: item.highlight ? 12 : 12, fontWeight: 630, color: item.highlight ? C.green : C.text }}>
                  {item.value}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Enregistrer — bas de page droite ── */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 20 }}>
        {error && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 6, marginRight: 10,
            background: dark ? '#2a0a0a' : '#fef2f2',
            border: `1px solid ${C.red}30`,
            borderRadius: 8, padding: '8px 14px', color: C.red, fontSize: 12,
          }}>
            <AlertCircle size={12} strokeWidth={2} />{error}
          </div>
        )}
        {saved && (
          <div style={{
            marginRight: 10,
            background: dark ? 'rgba(52,217,111,0.12)' : 'rgba(24,120,63,0.08)',
            border: `1px solid ${C.green}30`,
            borderRadius: 8, padding: '8px 14px', color: C.green, fontSize: 12, fontWeight: 630,
          }}>✓ Enregistré</div>
        )}
        <button
          onClick={handleSave}
          disabled={saving || tours.length === 0}
          style={{
            display: 'flex', alignItems: 'center', gap: 7,
            padding: '11px 28px',
            background: saving || tours.length === 0 ? C.toggleBg : C.green,
            color: saving || tours.length === 0 ? C.textDim : '#fff',
            border: 'none', borderRadius: 9,
            fontSize: 12, fontWeight: 630, fontFamily: 'inherit',
            cursor: saving || tours.length === 0 ? 'not-allowed' : 'pointer',
            transition: 'all 0.15s',
          }}
        >
          <Save size={12} strokeWidth={2.5} />
          {saving ? 'Enregistrement…' : 'Enregistrer'}
        </button>
      </div>
    
    </div>
  )
}