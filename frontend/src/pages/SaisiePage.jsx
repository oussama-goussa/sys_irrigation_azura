// ============================================================
// frontend/src/pages/SaisiePage.jsx — Refonte complète
// ============================================================

import { useState, useEffect, useRef } from 'react'
import {
  Plus, Save, ChevronDown, ChevronUp, Droplets,
  FlaskConical, BarChart2, Trash2, AlertCircle, Check,
  ClipboardList,
} from 'lucide-react'
import { getDevices } from '../api/client.js'

// ── helpers ───────────────────────────────────────────────────
const today = () => new Date().toISOString().split('T')[0]
const fmtNum = (v, dec = 2) => {
  if (v === null || v === undefined || v === '' || isNaN(Number(v))) return '—'
  return Number(v).toFixed(dec)
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
        fontWeight: disabled ? 700 : 400,
      }}
    />
  )
}

// ── TimeInput — style scroll hh:mm ───────────────────────────
function TimeInput({ value, onChange, C }) {
  const [h, m] = value ? value.split(':') : ['', '']

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

  const numStyle = {
    fontSize: 12, fontWeight: 700,
    color: C.text, width: 32, textAlign: 'center',
    background: 'none', border: 'none', outline: 'none',
    fontFamily: 'inherit', cursor: 'default',
    padding: 0,
  }
  const arrowStyle = {
    background: 'none', border: 'none', cursor: 'pointer',
    color: C.textDim, display: 'flex', alignItems: 'center',
    padding: '1px 4px', borderRadius: 4,
  }

  return (
    <div style={{
      display: 'inline-flex', alignItems: 'center', gap: 2,
      border: `1.5px solid ${C.border}`, borderRadius: 8,
      background: C.inputBg, padding: '2px 6px', height: 34,
    }}>
      {/* Heures */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
        <button style={arrowStyle} onClick={() => inc('h')}><ChevronUp size={12} strokeWidth={2.5}/></button>
        <input
          type="number" min={0} max={23}
          value={h || '00'}
          onChange={e => onChange(`${String(Math.min(23, Math.max(0, parseInt(e.target.value) || 0))).padStart(2,'0')}:${m || '00'}`)}
          style={numStyle}
        />
        <button style={arrowStyle} onClick={() => dec('h')}><ChevronDown size={12} strokeWidth={2.5}/></button>
      </div>
      <span style={{ fontSize: 12, fontWeight: 700, color: C.textMuted, userSelect: 'none' }}>:</span>
      {/* Minutes */}
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
        <button style={arrowStyle} onClick={() => inc('m')}><ChevronUp size={12} strokeWidth={2.5}/></button>
        <input
          type="number" min={0} max={59}
          value={m || '00'}
          onChange={e => onChange(`${h || '00'}:${String(Math.min(59, Math.max(0, parseInt(e.target.value) || 0))).padStart(2,'0')}`)}
          style={numStyle}
        />
        <button style={arrowStyle} onClick={() => dec('m')}><ChevronDown size={12} strokeWidth={2.5}/></button>
      </div>
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
          transition: 'border-color 0.15s', gap: 6,
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
          maxHeight: 200, overflowY: 'auto',
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
        <div style={{ fontSize: 11, fontWeight: 800, color, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
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
            <div style={{ fontSize: 10, color: `${color}90`, marginBottom: 2 }}>{item.label}</div>
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
      fontSize: 10, fontWeight: 700, textTransform: 'uppercase',
      letterSpacing: '0.07em', color: color || C.textDim,
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
      fontSize: 10, fontWeight: 700, textTransform: 'uppercase',
      letterSpacing: '0.08em', color: C.textDim, marginBottom: 5,
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
        ferme, station, serre, vanne, date,
        constantes: { nbrBras, nbrGoutteurs, poidsMatin, heureMatin, poidsSoir, heureSoir, bassinEC, pctRessuyage },
        tours,
        bilan: { nbrTours: tours.length, dureeTotal, totalVApport, totalVDrain, ecMoyApport, phMoyApport, ecMoyDrain, phMoyDrain, moyDrainFinale, ccBras }
      }
      console.log('Saisie:', payload)
      await new Promise(r => setTimeout(r, 600))
      setSaved(true); setTimeout(() => setSaved(false), 3000)
    } catch (e) { setError(e.message) }
    finally { setSaving(false) }
  }

  const cardStyle = {
    background: C.card, border: `1.5px solid ${C.border}`,
    borderRadius: 14, padding: '18px 22px', marginBottom: 16,
  }
  const labelStyle = {
    display: 'block', color: C.textMuted, fontSize: 10, fontWeight: 700,
    textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 5,
  }
  const inputStyle = {
    width: '100%', padding: '8px 12px', borderRadius: 8,
    border: `1.5px solid ${C.border}`, background: C.inputBg,
    color: C.text, fontSize: 12, fontFamily: 'inherit', outline: 'none',
  }

  return (
    <div style={{ maxWidth: 1500 }}>

      {/* ── Header ──────────────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <ClipboardList size={20} color={C.green} strokeWidth={2} />
          </div>
          <div>
            <div style={{ fontSize: 20, fontWeight: 900, color: C.text }}>Saisie journalière</div>
            <div style={{ fontSize: 11, color: C.textDim }}>{date}</div>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          {error && (
            <div style={{
              display: 'flex', alignItems: 'center', gap: 6,
              background: dark ? '#2a0a0a' : '#fef2f2',
              border: `1px solid ${C.red}30`,
              borderRadius: 8, padding: '8px 14px', color: C.red, fontSize: 12,
            }}>
              <AlertCircle size={12} strokeWidth={2} />{error}
            </div>
          )}
          {saved && (
            <div style={{
              background: dark ? 'rgba(52,217,111,0.12)' : 'rgba(24,120,63,0.08)',
              border: `1px solid ${C.green}30`,
              borderRadius: 8, padding: '8px 14px', color: C.green, fontSize: 12, fontWeight: 700,
            }}>✓ Enregistré</div>
          )}
        </div>
      </div>

      {/* ── Bilan ligne ─────────────────────────────────────── */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 16 }}>
        {/* Irrigation */}
        <div style={{
          background: dark ? `${C.green}10` : `${C.green}08`,
          border: `1.5px solid ${C.green}30`,
          borderRadius: 12, padding: '14px 18px', flex: 1,
        }}>
          <div style={{ fontSize: 12, fontWeight: 800, color: C.green, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 10 }}>
            Irrigation
          </div>
          <div style={{ display: 'flex', gap: 24 }}>
            {[
              { label: 'Total tours', value: tours.length || '—' },
              { label: 'Durée totale (min)', value: dureeTotal > 0 ? dureeTotal : '—' },
              { label: 'CC/bras (cc)', value: ccBras ?? '—' },
            ].map(item => (
              <div key={item.label}>
                <div style={{ fontSize: 10, color: `${C.green}90`, marginBottom: 2 }}>{item.label}</div>
                <div style={{ fontSize: 20, fontWeight: 900, color: C.green }}>{item.value}</div>
              </div>
            ))}
          </div>
        </div>

        <BilanCard title="Bilan Eau"
          items={[
            { label: 'Apport', value: totalVApport > 0 ? fmtNum(totalVApport, 1) : null },
            { label: 'Drainage', value: totalVDrain > 0 ? fmtNum(totalVDrain, 1) : null },
          ]}
          color={C.blue} icon={Droplets} C={C} dark={dark} />

        <BilanCard title="Bilan EC"
          items={[
            { label: 'Apport', value: ecMoyApport ? fmtNum(ecMoyApport, 2) : null },
            { label: 'Drainage', value: ecMoyDrain ? fmtNum(ecMoyDrain, 2) : null },
          ]}
          color={C.green} icon={BarChart2} C={C} dark={dark} />

        <BilanCard title="Bilan pH"
          items={[
            { label: 'Apport', value: phMoyApport ? fmtNum(phMoyApport, 2) : null },
            { label: 'Drainage', value: phMoyDrain ? fmtNum(phMoyDrain, 2) : null },
          ]}
          color={C.amber} icon={FlaskConical} C={C} dark={dark} />
      </div>

      {/* ── Ferme / Station / Serre / Vanne / Date ─────────── */}
      <div style={{ ...cardStyle }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1.8fr 1.2fr 1fr 0.8fr 180px', gap: 14 }}>
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
              placeholder="S01 → S20"
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
          <div style={{ fontSize: 10, fontWeight: 700, color: C.textDim, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 12 }}>
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
              background: dark ? 'rgba(52,217,111,0.10)' : 'rgba(24,120,63,0.06)',
              border: `1.5px solid ${C.green}40`,
              borderRadius: 8, padding: '6px 14px',
            }}>
              <span style={{ fontSize: 10, color: C.textDim, textTransform: 'uppercase', letterSpacing: '0.08em' }}>% Ressuyage</span>
              <span style={{ fontSize: 16, fontWeight: 900, color: C.green }}>{pctRessuyage}%</span>
            </div>
          )}
        </div>
      </div>

      {/* ── Table Tours ──────────────────────────────────────── */}
      <div style={{ ...cardStyle, marginBottom: 0 }}>
        <div style={{ fontSize: 12, fontWeight: 800, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 14 }}>
          Tours d'irrigation
        </div>

        <div style={{ overflowX: 'auto' }}>
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
            <tbody>
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
                    <div style={{ fontSize: 12, fontWeight: 700, color: C.blue }}>
                      {t.cumulRad > 0 ? fmtNum(t.cumulRad, 1) : '—'}
                    </div>
                  </td>
                  <td style={{ padding: '6px 4px', textAlign: 'center' }}>
                    <TimeInput value={t.heure} onChange={v => updateTour(t.id, 'heure', v)} C={C} />
                  </td>
                  <td style={{ padding: '6px 4px', textAlign: 'center' }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: t.tempsRepos !== null ? C.textMuted : C.textDim }}>
                      {t.tempsRepos !== null ? `${t.tempsRepos} min` : i === 0 ? '—' : '?'}
                    </div>
                  </td>
                  <td style={{ padding: '6px 4px', textAlign: 'center' }}>
                    <TInput value={t.duree} onChange={v => updateTour(t.id, 'duree', v)} width={68} C={C} />
                  </td>
                  <td style={{ padding: '6px 4px', textAlign: 'center' }}>
                    <TInput value={t.vApport} onChange={v => updateTour(t.id, 'vApport', v)} width={72} C={C} />
                  </td>
                  <td style={{ padding: '6px 4px', textAlign: 'center' }}>
                    <TInput value={t.ecApport} onChange={v => updateTour(t.id, 'ecApport', v)} width={68} C={C} />
                  </td>
                  <td style={{ padding: '6px 4px', textAlign: 'center' }}>
                    <TInput value={t.phApport} onChange={v => updateTour(t.id, 'phApport', v)} width={68} C={C} />
                  </td>
                  <td style={{ padding: '6px 4px', textAlign: 'center' }}>
                    <TInput value={t.vDrain} onChange={v => updateTour(t.id, 'vDrain', v)} width={68} C={C} />
                  </td>
                  <td style={{ padding: '6px 4px', textAlign: 'center' }}>
                    <TInput value={t.ecDrain} onChange={v => updateTour(t.id, 'ecDrain', v)} width={68} C={C} />
                  </td>
                  <td style={{ padding: '6px 4px', textAlign: 'center' }}>
                    <TInput value={t.phDrain} onChange={v => updateTour(t.id, 'phDrain', v)} width={68} C={C} />
                  </td>
                  <td style={{ padding: '6px 4px', textAlign: 'center' }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: t.pctDrain !== null ? C.amber : C.textDim }}>
                      {t.pctDrain !== null ? `${fmtNum(t.pctDrain, 1)}%` : '—'}
                    </div>
                  </td>
                  <td style={{ padding: '6px 4px', textAlign: 'center' }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: t.moyPctDrain !== null ? C.amber : C.textDim }}>
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
                  <td colSpan={6} style={{ padding: '8px 6px', fontSize: 12, fontWeight: 700, color: C.textMuted }}>TOTAUX</td>
                  <td style={{ padding: '8px 4px', textAlign: 'center', fontSize: 12, fontWeight: 900, color: C.green }}>{fmtNum(totalVApport, 1)}</td>
                  <td style={{ padding: '8px 4px', textAlign: 'center', fontSize: 12, fontWeight: 700, color: C.textMuted }}>{ecMoyApport ? fmtNum(ecMoyApport, 2) : '—'}</td>
                  <td style={{ padding: '8px 4px', textAlign: 'center', fontSize: 12, fontWeight: 700, color: C.textMuted }}>{phMoyApport ? fmtNum(phMoyApport, 2) : '—'}</td>
                  <td style={{ padding: '8px 4px', textAlign: 'center', fontSize: 12, fontWeight: 900, color: C.blue }}>{fmtNum(totalVDrain, 1)}</td>
                  <td style={{ padding: '8px 4px', textAlign: 'center', fontSize: 12, fontWeight: 700, color: C.textMuted }}>{ecMoyDrain ? fmtNum(ecMoyDrain, 2) : '—'}</td>
                  <td style={{ padding: '8px 4px', textAlign: 'center', fontSize: 12, fontWeight: 700, color: C.textMuted }}>{phMoyDrain ? fmtNum(phMoyDrain, 2) : '—'}</td>
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
              fontSize: 12, fontWeight: 700, fontFamily: 'inherit', cursor: 'pointer',
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
              { label: 'Durée totale', value: dureeTotal > 0 ? `${dureeTotal} min` : '—' },
              { label: 'Total V.Apport', value: fmtNum(totalVApport, 1) },
              { label: 'Total V.Drain', value: fmtNum(totalVDrain, 1) },
              { label: 'Moy % Drainage finale', value: moyDrainFinale !== null ? `${fmtNum(moyDrainFinale, 1)}%` : '—' },
              { label: 'CC/bras consommé (cc)', value: ccBras ?? '—', highlight: true },
            ].map(item => (
              <div key={item.label}>
                <div style={{ fontSize: 10, color: C.textDim, marginBottom: 3 }}>{item.label}</div>
                <div style={{ fontSize: item.highlight ? 22 : 16, fontWeight: 900, color: item.highlight ? C.green : C.text }}>
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
            borderRadius: 8, padding: '8px 14px', color: C.green, fontSize: 12, fontWeight: 700,
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
            fontSize: 12, fontWeight: 700, fontFamily: 'inherit',
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