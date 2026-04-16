// ============================================================
// frontend/src/pages/SaisiePage.jsx — Responsive
// ============================================================

import { useState, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import {
  Plus, Save, ChevronDown, ChevronUp, Droplets, ChevronLeft, ChevronRight,
  FlaskConical, BarChart2, Trash2, AlertCircle, Check, X,
  ClipboardList, RefreshCw,
} from 'lucide-react'
import { getDevices, saveSaisie } from '../api/client.js'

const today = () => new Date().toISOString().split('T')[0]
const fmtNum = (v, dec = 2) => {
  if (v === null || v === undefined || v === '' || isNaN(Number(v))) return '—'
  return Number(v).toFixed(dec)
}
const fmtDuree = (totalMin) => {
  if (!totalMin || totalMin <= 0) return '—'
  const h = Math.floor(totalMin / 60), m = Math.floor(totalMin % 60)
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00`
}

function newTour(num) {
  return {
    id: Date.now() + num, num,
    rad: '', cumulRad: 0, heure: '', duree: '', tempsRepos: null,
    vApport: '', ecApport: '', phApport: '',
    vDrain: '', ecDrain: '', phDrain: '',
    pctDrain: null, moyPctDrain: null,
  }
}

function TInput({ value, onChange, placeholder = '', disabled = false, width = 68, C }) {
  return (
    <input
      type="number" value={value}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      disabled={disabled} step="any"
      style={{
        width: '100%', maxWidth: width, textAlign: 'center',
        padding: '5px 6px', borderRadius: 6,
        border: `1.5px solid ${disabled ? 'transparent' : C?.border || '#c8dece'}`,
        background: disabled ? 'transparent' : (C?.inputBg || '#f9fbfa'),
        color: disabled ? (C?.green || '#18783f') : (C?.text || '#0d1f14'),
        fontSize: 12, fontFamily: 'inherit', outline: 'none', fontWeight: 630,
        boxSizing: 'border-box',
      }}
    />
  )
}

const MONTHS_FR = ['Janvier','Février','Mars','Avril','Mai','Juin','Juillet','Août','Septembre','Octobre','Novembre','Décembre']
const DAYS_FR   = ['Lu','Ma','Me','Je','Ve','Sa','Di']

function CalendarPicker({ value, onChange, C }) {
  const [open, setOpen] = useState(false)
  const [viewDate, setView] = useState(() => value ? new Date(value + 'T00:00:00') : new Date())
  const [mode, setMode] = useState('days')
  const [pos, setPos] = useState({ top: 0, left: 0 })
  const ref = useRef(null)
  const triggerRef = useRef(null)
  const portalRef = useRef(null)

  useEffect(() => {
    const close = (e) => { if (ref.current && !ref.current.contains(e.target) && portalRef.current && !portalRef.current.contains(e.target)) setOpen(false) }
    const onScroll = () => setOpen(false)
    document.addEventListener('mousedown', close)
    window.addEventListener('scroll', onScroll, true)
    return () => { document.removeEventListener('mousedown', close); window.removeEventListener('scroll', onScroll, true) }
  }, [])

  useEffect(() => { if (value) setView(new Date(value + 'T00:00:00')) }, [value])

  const year = viewDate.getFullYear(), month = viewDate.getMonth()
  let startDow = new Date(year, month, 1).getDay() - 1
  if (startDow < 0) startDow = 6
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const daysInPrev = new Date(year, month, 0).getDate()
  const cells = []
  for (let i = 0; i < startDow; i++) cells.push({ day: daysInPrev - startDow + 1 + i, curr: false })
  for (let i = 1; i <= daysInMonth; i++) cells.push({ day: i, curr: true })
  while (cells.length % 7 !== 0) cells.push({ day: cells.length - startDow - daysInMonth + 1, curr: false })

  const todayD = new Date()
  const todayStr = `${todayD.getFullYear()}-${String(todayD.getMonth()+1).padStart(2,'0')}-${String(todayD.getDate()).padStart(2,'0')}`
  const select = (day) => { onChange(`${year}-${String(month+1).padStart(2,'0')}-${String(day).padStart(2,'0')}`); setOpen(false); setMode('days') }
  const displayValue = value ? new Date(value + 'T00:00:00').toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' }) : null
  const startYear = year - 6
  const years = Array.from({ length: 12 }, (_, i) => startYear + i)
  const btnStyle = { background: 'none', border: 'none', cursor: 'pointer', color: C.textMuted, padding: '3px 6px', borderRadius: 5, display: 'flex', alignItems: 'center' }

  const handleOpen = () => {
    const r = triggerRef.current.getBoundingClientRect()
    const spaceBelow = window.innerHeight - r.bottom
    if (spaceBelow < 320) setPos({ bottom: window.innerHeight - r.top + 4, top: 'auto', left: Math.min(r.left, window.innerWidth - 260) })
    else setPos({ top: r.bottom + 4, bottom: 'auto', left: Math.min(r.left, window.innerWidth - 260) })
    setOpen(v => !v)
    setMode('days')
  }

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <div ref={triggerRef} onClick={handleOpen} style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        height: 38, padding: '0 12px',
        border: `1.5px solid ${open ? C.green : C.border}`,
        borderRadius: 8, background: C.inputBg,
        cursor: 'pointer', transition: 'border-color 0.15s',
        color: value ? C.text : C.textDim,
        fontFamily: 'inherit', fontWeight: 700, boxSizing: 'border-box', width: '100%', fontSize: 12,
      }}>
        <span>{displayValue || 'jj/mm/aaaa'}</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginLeft: 5 }}>
          {value && <span onClick={e => { e.stopPropagation(); onChange('') }} style={{ color: C.textDim, cursor: 'pointer', display: 'flex' }}><X size={12} strokeWidth={2.5}/></span>}
          {open ? <ChevronUp size={13} strokeWidth={2}/> : <ChevronDown size={13} strokeWidth={2}/>}
        </div>
      </div>
      {open && createPortal(
        <div ref={portalRef} style={{
          position: 'fixed', top: pos.top !== 'auto' ? pos.top : 'auto', bottom: pos.bottom !== 'auto' ? pos.bottom : 'auto', left: pos.left,
          background: C.card, border: `1.5px solid ${C.border}`, borderRadius: 12, zIndex: 99999,
          boxShadow: `0 8px 32px rgba(0,0,0,0.18)`, padding: '12px 12px 10px', width: 248, fontFamily: 'inherit',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
            <button onClick={() => mode === 'years' ? setView(new Date(year - 12, month, 1)) : mode === 'months' ? setView(new Date(year - 1, month, 1)) : setView(new Date(year, month - 1, 1))} style={btnStyle}><ChevronLeft size={14} strokeWidth={2.5}/></button>
            <div style={{ display: 'flex', gap: 4 }}>
              <button onClick={() => setMode(m => m === 'months' ? 'days' : 'months')} style={{ background: mode === 'months' ? `${C.green}15` : 'none', border: mode === 'months' ? `1px solid ${C.green}40` : '1px solid transparent', borderRadius: 6, cursor: 'pointer', color: C.text, fontSize: 12, fontWeight: 800, fontFamily: 'inherit', padding: '3px 8px' }}>{MONTHS_FR[month]}</button>
              <button onClick={() => setMode(m => m === 'years' ? 'days' : 'years')} style={{ background: mode === 'years' ? `${C.green}15` : 'none', border: mode === 'years' ? `1px solid ${C.green}40` : '1px solid transparent', borderRadius: 6, cursor: 'pointer', color: C.text, fontSize: 12, fontWeight: 800, fontFamily: 'inherit', padding: '3px 8px' }}>{year}</button>
            </div>
            <button onClick={() => mode === 'years' ? setView(new Date(year + 12, month, 1)) : mode === 'months' ? setView(new Date(year + 1, month, 1)) : setView(new Date(year, month + 1, 1))} style={btnStyle}><ChevronRight size={14} strokeWidth={2.5}/></button>
          </div>
          {mode === 'years' && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 4, marginBottom: 8 }}>
              {years.map(y => <button key={y} onClick={() => { setView(new Date(y, month, 1)); setMode('months') }} style={{ background: y === year ? C.green : 'transparent', border: `1px solid ${y === year ? C.green : C.border}`, borderRadius: 7, cursor: 'pointer', color: y === year ? '#fff' : C.text, fontSize: 12, fontWeight: y === year ? 800 : 500, fontFamily: 'inherit', padding: '7px 4px' }}>{y}</button>)}
            </div>
          )}
          {mode === 'months' && (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 4, marginBottom: 8 }}>
              {MONTHS_FR.map((mn, mi) => <button key={mn} onClick={() => { setView(new Date(year, mi, 1)); setMode('days') }} style={{ background: mi === month ? C.green : 'transparent', border: `1px solid ${mi === month ? C.green : C.border}`, borderRadius: 7, cursor: 'pointer', color: mi === month ? '#fff' : C.text, fontSize: 11, fontWeight: mi === month ? 800 : 500, fontFamily: 'inherit', padding: '7px 4px' }}>{mn.slice(0,3)}</button>)}
            </div>
          )}
          {mode === 'days' && (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', marginBottom: 4 }}>
                {DAYS_FR.map(d => <div key={d} style={{ textAlign: 'center', fontSize: 9, fontWeight: 700, color: C.textDim, padding: '2px 0', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{d}</div>)}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '2px 0' }}>
                {cells.map((cell, i) => {
                  const cellStr = cell.curr ? `${year}-${String(month+1).padStart(2,'0')}-${String(cell.day).padStart(2,'0')}` : null
                  const isSelected = cellStr === value, isToday = cellStr === todayStr
                  return (
                    <div key={i} onClick={() => cell.curr && select(cell.day)} style={{ textAlign: 'center', fontSize: 11, padding: '5px 0', borderRadius: 6, cursor: cell.curr ? 'pointer' : 'default', fontWeight: isSelected ? 800 : isToday ? 700 : 400, color: isSelected ? '#fff' : isToday ? C.green : cell.curr ? C.text : C.textDim, background: isSelected ? C.green : 'transparent', opacity: cell.curr ? 1 : 0.3, transition: 'all 0.1s', position: 'relative' }}
                      onMouseEnter={e => { if (cell.curr && !isSelected) e.currentTarget.style.background = `${C.green}18` }}
                      onMouseLeave={e => { if (!isSelected) e.currentTarget.style.background = 'transparent' }}
                    >
                      {isToday && !isSelected && <span style={{ position: 'absolute', bottom: 1, left: '50%', transform: 'translateX(-50%)', width: 3, height: 3, borderRadius: '50%', background: C.green }}/>}
                      {cell.day}
                    </div>
                  )
                })}
              </div>
            </>
          )}
          <div style={{ marginTop: 10, paddingTop: 8, borderTop: `1px solid ${C.border}`, display: 'flex', justifyContent: 'space-between' }}>
            <button onClick={() => { onChange(''); setOpen(false); setMode('days') }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: C.textDim, fontSize: 10, fontWeight: 700, fontFamily: 'inherit', padding: '3px 6px', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Effacer</button>
            <button onClick={() => { onChange(todayStr); setOpen(false); setMode('days') }} style={{ background: `${C.green}15`, border: `1px solid ${C.green}40`, borderRadius: 6, cursor: 'pointer', color: C.green, fontSize: 10, fontWeight: 800, fontFamily: 'inherit', padding: '3px 10px', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Aujourd'hui</button>
          </div>
        </div>,
        document.body
      )}
    </div>
  )
}

function TimeInput({ value, onChange, C }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  const triggerRef = useRef(null)
  const [pos, setPos] = useState({ top: 0, left: 0 })
  const [h, m] = value ? value.split(':') : ['00', '00']
  const [hRaw, setHRaw] = useState(null)
  const [mRaw, setMRaw] = useState(null)

  useEffect(() => {
    const close = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    const onScroll = () => setOpen(false)
    document.addEventListener('mousedown', close)
    window.addEventListener('scroll', onScroll, true)
    return () => { document.removeEventListener('mousedown', close); window.removeEventListener('scroll', onScroll, true) }
  }, [])

  const handleOpen = () => {
    if (triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect()
      setPos({ top: rect.bottom + 6, left: Math.min(rect.left + rect.width / 2, window.innerWidth - 120) })
    }
    setOpen(v => !v)
  }
  const inc = (type) => {
    const hv = parseInt(h||'0'), mv = parseInt(m||'0')
    if (type === 'h') onChange(`${String((hv+1)%24).padStart(2,'0')}:${m||'00'}`)
    else onChange(`${h||'00'}:${String((mv+1)%60).padStart(2,'0')}`)
  }
  const dec = (type) => {
    const hv = parseInt(h||'0'), mv = parseInt(m||'0')
    if (type === 'h') onChange(`${String((hv-1+24)%24).padStart(2,'0')}:${m||'00'}`)
    else onChange(`${h||'00'}:${String((mv-1+60)%60).padStart(2,'0')}`)
  }

  return (
    <div ref={ref} style={{ position: 'relative', display: 'inline-block', width: '100%' }}>
      <div ref={triggerRef} onClick={handleOpen} style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: '0 10px', border: `1.5px solid ${open ? C.green : C.border}`,
        borderRadius: 7, background: C.inputBg, width: '100%', boxSizing: 'border-box',
        cursor: 'pointer', transition: 'border-color 0.15s', fontSize: 12,
        color: value ? C.text : C.textDim, gap: 4, fontWeight: 630, height: 36,
      }}>
        <span>{h||'00'}</span><span style={{ color: C.textDim }}>:</span><span>{m||'00'}</span>
      </div>
      {open && (
        <div style={{
          position: 'fixed', top: pos.top, left: pos.left,
          transform: 'translateX(-50%)',
          background: C.card, border: `1.5px solid ${C.border}`, borderRadius: 10, zIndex: 9999,
          boxShadow: `0 4px 24px rgba(0,0,0,0.2)`, padding: '10px 16px',
          display: 'flex', alignItems: 'center', gap: 4,
        }}>
          {['h','m'].map((type, ti) => (
            <React.Fragment key={type}>
              {ti === 1 && <span style={{ fontSize: 22, fontWeight: 900, color: C.textMuted }}>:</span>}
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
                <button onClick={() => inc(type)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: C.textMuted, padding: '4px 8px' }}><ChevronUp size={16} strokeWidth={2.5}/></button>
                <input type="text" inputMode="numeric" maxLength={2}
                  value={type === 'h' ? (hRaw ?? h ?? '00') : (mRaw ?? m ?? '00')}
                  onChange={e => {
                    const raw = e.target.value.replace(/\D/g,'').slice(0,2)
                    if (type === 'h') { setHRaw(raw); if (raw.length === 2) { const v = Math.min(23, parseInt(raw)||0); onChange(`${String(v).padStart(2,'0')}:${m||'00'}`); setHRaw(null) } }
                    else { setMRaw(raw); if (raw.length === 2) { const v = Math.min(59, parseInt(raw)||0); onChange(`${h||'00'}:${String(v).padStart(2,'0')}`); setMRaw(null) } }
                  }}
                  onBlur={() => {
                    if (type === 'h') { const v = Math.min(23, parseInt(hRaw??h)||0); onChange(`${String(v).padStart(2,'0')}:${m||'00'}`); setHRaw(null) }
                    else { const v = Math.min(59, parseInt(mRaw??m)||0); onChange(`${h||'00'}:${String(v).padStart(2,'0')}`); setMRaw(null) }
                  }}
                  style={{ fontSize: 22, fontWeight: 700, color: C.text, width: 48, textAlign: 'center', background: 'none', border: 'none', outline: 'none', fontFamily: 'inherit', padding: 0 }}
                />
                <button onClick={() => dec(type)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: C.textMuted, padding: '4px 8px' }}><ChevronDown size={16} strokeWidth={2.5}/></button>
              </div>
            </React.Fragment>
          ))}
        </div>
      )}
    </div>
  )
}

import React from 'react'

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
    <div ref={ref} style={{ position: 'relative', width: '100%' }}>
      <div onClick={() => !disabled && setOpen(v => !v)} style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '0 10px', height: 38,
        border: `1.5px solid ${open ? C.green : C.border}`,
        borderRadius: 8, background: disabled ? C.toggleBg : C.inputBg,
        cursor: disabled ? 'not-allowed' : 'pointer',
        transition: 'border-color 0.15s', gap: 6, fontWeight: 630, opacity: disabled ? 0.5 : 1,
      }}>
        <span style={{ fontSize: 12, color: label ? C.text : C.textDim, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label || placeholder}</span>
        <span style={{ color: C.textDim, display: 'flex', alignItems: 'center', flexShrink: 0 }}>
          {open ? <ChevronUp size={12} strokeWidth={2}/> : <ChevronDown size={12} strokeWidth={2}/>}
        </span>
      </div>
      {open && (
        <div style={{ position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0, background: C.card, border: `1.5px solid ${C.border}`, borderRadius: 8, zIndex: 200, boxShadow: `0 4px 20px rgba(0,0,0,0.12)`, maxHeight: 200, overflowY: 'auto', fontWeight: 630 }}>
          {options.length === 0 ? <div style={{ padding: '10px 14px', color: C.textDim, fontSize: 12 }}>Aucune option</div>
          : options.map(o => {
            const val = o.value ?? o, lbl = o.label ?? o, sel = val === value
            return (
              <div key={val} onClick={() => { onChange(val); setOpen(false) }}
                style={{ padding: '9px 14px', fontSize: 12, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'space-between', color: sel ? C.green : C.textMuted, background: sel ? `${C.green}12` : 'transparent', transition: 'background 0.1s' }}
                onMouseEnter={e => e.currentTarget.style.background = sel ? `${C.green}18` : C.tableHover}
                onMouseLeave={e => e.currentTarget.style.background = sel ? `${C.green}12` : 'transparent'}
              >
                <span>{lbl}</span>{sel && <Check size={12} strokeWidth={2.5}/>}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function TH({ children, w, color, C }) {
  return (
    <th style={{ padding: '8px 4px', textAlign: 'center', fontSize: 11, fontWeight: 630, textTransform: 'uppercase', letterSpacing: '0em', color: color || C.textDim, whiteSpace: 'nowrap', minWidth: w, borderBottom: `1.5px solid ${C.border}` }}>
      {children}
    </th>
  )
}

export default function SaisiePage({ token, auth, C, dark, isMobile = false, isTablet = false }) {
  const [farms, setFarms] = useState([])
  const [ferme, setFerme] = useState('')
  const [station, setStation] = useState('')
  const [serre, setSerre] = useState('')
  const [vanne, setVanne] = useState('')
  const [date, setDate] = useState(today())
  const [nbrBras, setNbrBras] = useState('')
  const [nbrGoutteurs, setNbrGoutteurs] = useState('')
  const [poidsMatin, setPoidsMatin] = useState('')
  const [heureMatin, setHeureMatin] = useState('')
  const [poidsSoir, setPoidsSoir] = useState('')
  const [heureSoir, setHeureSoir] = useState('')
  const [bassinEC, setBassinEC] = useState('')
  const [tours, setTours] = useState([])
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')
  const tableBottomRef = useRef(null)

  useEffect(() => { getDevices(token).then(setFarms).catch(() => setFarms([])) }, [token])

  const fermeOptions = [...new Set(farms.map(f => f.farm_name))].map(v => ({ value: v, label: v }))
  const selectedFarm = farms.find(f => f.farm_name === ferme)
  const houses = selectedFarm?.houses || []
  const stationOptions = [...new Set(houses.map(h => h.house_number))].map(v => ({ value: v, label: `Station ${v}` }))
  const serreOptions = station ? Array.from({ length: 20 }, (_, i) => ({ value: `S${String(i+1).padStart(2,'0')}`, label: `S${String(i+1).padStart(2,'0')}` })) : []
  const pctRessuyage = poidsMatin && poidsSoir && Number(poidsMatin) > 0
    ? (((Number(poidsSoir) - Number(poidsMatin)) / Number(poidsMatin)) * 100).toFixed(1) : null

  const recalculTours = (list) => {
    let cumulPrev = 0
    return list.map((t, i) => {
      const prev = i > 0 ? list[i-1] : null
      const radActuelle = Number(t.rad) || 0
      const cumulRad = radActuelle - cumulPrev
      cumulPrev += cumulRad
      let tempsRepos = null
      if (i > 0 && prev?.heure && prev?.duree && t.heure) {
        const toMin = h => { const [hh, mm] = h.split(':').map(Number); return hh*60+mm }
        tempsRepos = toMin(t.heure) - (toMin(prev.heure) + (Number(prev.duree)||0))
        if (tempsRepos < 0) tempsRepos = 0
      }
      let pctDrain = null
      if (t.vDrain && t.vApport && nbrGoutteurs && Number(t.vApport) > 0 && Number(nbrGoutteurs) > 0)
        pctDrain = (Number(t.vDrain) / Number(nbrGoutteurs) / Number(t.vApport)) * 100
      let moyPctDrain = null
      if (pctDrain !== null) {
        const prevMoy = prev?.moyPctDrain ?? null
        moyPctDrain = i === 0 ? pctDrain : prevMoy !== null ? (prevMoy * i + pctDrain) / (i+1) : null
      }
      return { ...t, cumulRad: Math.max(0, cumulRad), tempsRepos, pctDrain, moyPctDrain }
    })
  }

  const updateTour = (id, field, val) => setTours(prev => recalculTours(prev.map(t => t.id === id ? { ...t, [field]: val } : t)))
  const addTour = () => { setTours(prev => { const next = [...prev, newTour(prev.length+1)]; const r = recalculTours(next); setTimeout(() => tableBottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 50); return r }) }
  const deleteTour = (id) => setTours(prev => recalculTours(prev.filter(t => t.id !== id).map((t, i) => ({ ...t, num: i+1 }))))

  const lastTour = tours[tours.length-1]
  const totalVApport = tours.reduce((s, t) => s + (Number(t.vApport)||0), 0)
  const totalVDrain = tours.reduce((s, t) => s + (Number(t.vDrain)||0), 0)
  const dureeTotal = tours.reduce((s, t) => s + (Number(t.duree)||0), 0)
  const validEC = tours.filter(t => t.ecApport), validPH = tours.filter(t => t.phApport)
  const validECd = tours.filter(t => t.ecDrain), validPHd = tours.filter(t => t.phDrain)
  const ecMoyApport = validEC.length ? validEC.reduce((s, t) => s + (Number(t.ecApport)||0), 0) / validEC.length : null
  const phMoyApport = validPH.length ? validPH.reduce((s, t) => s + (Number(t.phApport)||0), 0) / validPH.length : null
  const ecMoyDrain = validECd.length ? validECd.reduce((s, t) => s + (Number(t.ecDrain)||0), 0) / validECd.length : null
  const phMoyDrain = validPHd.length ? validPHd.reduce((s, t) => s + (Number(t.phDrain)||0), 0) / validPHd.length : null
  const moyDrainFinale = lastTour?.moyPctDrain ?? null
  const ccBras = totalVApport && moyDrainFinale !== null && nbrGoutteurs && nbrBras && Number(nbrBras) > 0
    ? ((totalVApport * (1 - moyDrainFinale / 100) * Number(nbrGoutteurs)) / Number(nbrBras)).toFixed(1) : null

  const handleSave = async () => {
    if (!ferme || !date || tours.length === 0) { setError('Veuillez remplir la ferme, la date et au moins un tour.'); return }
    setSaving(true); setError('')
    try {
      const payload = {
        ferme, station, serre, vanne, date,
        constantes: { nbrBras: nbrBras !== '' ? Number(nbrBras) : null, nbrGoutteurs: nbrGoutteurs !== '' ? Number(nbrGoutteurs) : null, poidsMatin: poidsMatin !== '' ? Number(poidsMatin) : null, heureMatin, poidsSoir: poidsSoir !== '' ? Number(poidsSoir) : null, heureSoir, bassinEC: bassinEC !== '' ? Number(bassinEC) : null, pctRessuyage: pctRessuyage != null ? Number(pctRessuyage) : null },
        tours: tours.map(t => ({ num_tour: t.num, rad: t.rad !== '' ? Number(t.rad) : null, cumul_rad: t.cumulRad != null ? Number(t.cumulRad) : null, heure: t.heure || null, duree_min: t.duree !== '' ? Number(t.duree) : null, temps_repos: t.tempsRepos, v_apport: t.vApport !== '' ? Number(t.vApport) : null, ec_apport: t.ecApport !== '' ? Number(t.ecApport) : null, ph_apport: t.phApport !== '' ? Number(t.phApport) : null, v_drain: t.vDrain !== '' ? Number(t.vDrain) : null, ec_drain: t.ecDrain !== '' ? Number(t.ecDrain) : null, ph_drain: t.phDrain !== '' ? Number(t.phDrain) : null, pct_drain: t.pctDrain != null ? Number(t.pctDrain) : null, moy_pct_drain: t.moyPctDrain != null ? Number(t.moyPctDrain) : null })),
        bilan: { nbrTours: tours.length, dureeTotal: dureeTotal > 0 ? fmtDuree(dureeTotal) : null, totalVApport, totalVDrain, ecMoyApport: ecMoyApport != null ? Number(ecMoyApport) : null, phMoyApport: phMoyApport != null ? Number(phMoyApport) : null, ecMoyDrain: ecMoyDrain != null ? Number(ecMoyDrain) : null, phMoyDrain: phMoyDrain != null ? Number(phMoyDrain) : null, moyDrainFinale: moyDrainFinale != null ? Number(moyDrainFinale) : null, ccBras: ccBras != null ? Number(ccBras) : null },
      }
      await saveSaisie(token, payload)
      setSaved(true)
      setTimeout(() => setSaved(false), 5000)
    } catch (e) {
      try { const parsed = JSON.parse(e.message); setError(Array.isArray(parsed?.detail) ? parsed.detail.map(d => `${d.loc?.join('.')} : ${d.msg}`).join(' | ') : String(parsed?.detail || e.message)) }
      catch { setError(String(e.message)) }
    } finally { setSaving(false) }
  }

  const cardStyle = { background: C.card, border: `1.5px solid ${C.border}`, borderRadius: 14, padding: isMobile ? '14px 16px' : '18px 22px', marginBottom: 16 }
  const labelStyle = { display: 'block', color: C.green, fontSize: 11, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 7 }
  const inputStyle = { width: '100%', padding: '8px 12px', borderRadius: 8, fontWeight: 630, border: `1.5px solid ${C.border}`, background: C.inputBg, color: C.text, fontSize: 12, fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box' }

  // Responsive bilan grid
  const bilanCols = isMobile ? '1fr 1fr' : isTablet ? '1fr 1fr' : '1.5fr 1fr 1fr 1fr'
  const identCols = isMobile ? '1fr 1fr' : isTablet ? '1fr 1fr 1fr' : '1fr 1fr 1fr 1fr 1fr'

  return (
    <div style={{ maxWidth: 1500 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24, flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 style={{ color: C.text, fontSize: isMobile ? 18 : 22, fontWeight: 900, marginBottom: 4, display: 'flex', alignItems: 'center', gap: 10 }}>
            <ClipboardList size={isMobile ? 18 : 22} color={C.green} strokeWidth={2} />
            Saisie journalière
          </h1>
          <p style={{ fontSize: 11, color: C.textDim }}>{date}</p>
        </div>
      </div>

      {/* Bilan cards */}
      <div style={{ display: 'grid', gridTemplateColumns: bilanCols, gap: 12, marginBottom: 24 }}>
        {[
          { label: 'Irrigation', color: C.green, Icon: ClipboardList, items: [{ sub: 'Tours', value: tours.length > 0 ? tours.length : '—' }, { sub: 'Durée', value: fmtDuree(dureeTotal) }, ...(!isMobile ? [{ sub: 'CC/bras', value: ccBras ?? '—' }] : [])] },
          { label: 'Bilan Eau', color: C.blue, Icon: Droplets, items: [{ sub: 'Apport', value: totalVApport > 0 ? fmtNum(totalVApport, 1) : '—' }, { sub: 'Drain', value: totalVDrain > 0 ? fmtNum(totalVDrain, 1) : '—' }] },
          { label: 'Bilan EC', color: C.green, Icon: BarChart2, items: [{ sub: 'Apport', value: ecMoyApport ? fmtNum(ecMoyApport, 2) : '—' }, { sub: 'Drain', value: ecMoyDrain ? fmtNum(ecMoyDrain, 2) : '—' }] },
          { label: 'Bilan pH', color: C.amber, Icon: FlaskConical, items: [{ sub: 'Apport', value: phMoyApport ? fmtNum(phMoyApport, 2) : '—' }, { sub: 'Drain', value: phMoyDrain ? fmtNum(phMoyDrain, 2) : '—' }] },
        ].map(card => (
          <div key={card.label} style={{ background: dark ? '#111a14' : '#ffffff', border: `1px solid ${C.border}`, borderRadius: 14, padding: isMobile ? '14px 16px' : '18px 22px', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', minHeight: isMobile ? 90 : 110 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
              <div style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0em', color: dark ? C.textDim : '#5a7a66' }}>{card.label}</div>
              <card.Icon size={14} strokeWidth={1.6} color={card.color} style={{ opacity: 0.65 }} />
            </div>
            <div style={{ display: 'flex', gap: isMobile ? 12 : 16, alignItems: 'flex-end', flexWrap: 'wrap' }}>
              {card.items.map(it => (
                <div key={it.sub}>
                  <div style={{ fontSize: 10, color: dark ? C.textDim : '#5a7a66', marginBottom: 2, whiteSpace: 'nowrap' }}>{it.sub}</div>
                  <div style={{ fontSize: isMobile ? 16 : 20, fontWeight: 630, color: card.color }}>{it.value}</div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* Formulaire principal */}
      <div style={{ background: C.card, border: `1.5px solid ${C.border}`, borderRadius: 16, marginBottom: 24, overflow: 'hidden' }}>
        {/* Identification */}
        <div style={{ padding: isMobile ? '14px 16px 16px' : '18px 24px 20px' }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', fontSize: 12, fontWeight: 800, letterSpacing: '0em', textTransform: 'uppercase', color: C.textMuted, marginBottom: 14 }}>Identification</span>
          <div style={{ display: 'grid', gridTemplateColumns: identCols, gap: 12 }}>
            <div><label style={labelStyle}>Ferme</label><CustomSelect value={ferme} onChange={v => { setFerme(v); setStation(''); setSerre('') }} options={fermeOptions} placeholder="Sélectionner…" C={C}/></div>
            <div><label style={labelStyle}>Station</label><CustomSelect value={station} onChange={v => { setStation(v); setSerre('') }} options={stationOptions} placeholder="Sélectionner…" C={C} disabled={!ferme}/></div>
            <div><label style={labelStyle}>Serre</label><CustomSelect value={serre} onChange={setSerre} options={serreOptions} placeholder="S01" C={C} disabled={!station}/></div>
            <div><label style={labelStyle}>Vanne</label><input value={vanne} onChange={e => setVanne(e.target.value)} placeholder="ex: 1" style={{ ...inputStyle, height: 38 }}/></div>
            <div><label style={labelStyle}>Date</label><CalendarPicker value={date} onChange={setDate} C={C}/></div>
          </div>
        </div>

        <div style={{ height: 1, background: C.border }} />

        {/* Constantes */}
        <div style={{ padding: isMobile ? '14px 16px 16px' : '18px 24px 20px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 12, fontWeight: 800, letterSpacing: '0em', textTransform: 'uppercase', color: C.textMuted }}>Constantes &amp; Substrat</span>
            {pctRessuyage !== null && (
              <span style={{ fontSize: 12, fontWeight: 630, color: C.green, background: `${C.green}12`, border: `1px solid ${C.green}30`, borderRadius: 20, padding: '2px 10px' }}>{pctRessuyage}%</span>
            )}
          </div>

          {isMobile ? (
            // Mobile: grid 2 colonnes simple
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              {[
                { label: 'Nbr Bras', val: nbrBras, set: setNbrBras },
                { label: 'Nbr Goutteurs', val: nbrGoutteurs, set: setNbrGoutteurs },
                { label: 'Poids matin', val: poidsMatin, set: setPoidsMatin },
                { label: 'Poids soir', val: poidsSoir, set: setPoidsSoir },
                { label: 'EC Bassin', val: bassinEC, set: setBassinEC },
              ].map(f => (
                <div key={f.label}>
                  <label style={labelStyle}>{f.label}</label>
                  <input type="number" value={f.val} onChange={e => f.set(e.target.value)} step="any" style={{ ...inputStyle, height: 36 }}/>
                </div>
              ))}
              <div><label style={labelStyle}>H. Matin</label><TimeInput value={heureMatin} onChange={setHeureMatin} C={C}/></div>
              <div><label style={labelStyle}>H. Soir</label><TimeInput value={heureSoir} onChange={setHeureSoir} C={C}/></div>
            </div>
          ) : (
            // Desktop/Tablet: layout original avec séparateurs
            <div style={{ display: 'flex', alignItems: 'end', gap: 0, width: '100%', flexWrap: isTablet ? 'wrap' : 'nowrap' }}>
              <div style={{ flex: isTablet ? '0 0 50%' : 2, paddingRight: 18 }}>
                <div style={{ fontSize: 9, fontWeight: 630, color: C.textDim, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 7, opacity: 0.65 }}>Substrat</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                  <div><label style={labelStyle}>Nbr Bras</label><input type="number" value={nbrBras} onChange={e => setNbrBras(e.target.value)} placeholder="0" style={{ ...inputStyle, height: 36 }}/></div>
                  <div><label style={labelStyle}>Nbr Goutteurs</label><input type="number" value={nbrGoutteurs} onChange={e => setNbrGoutteurs(e.target.value)} placeholder="0" style={{ ...inputStyle, height: 36 }}/></div>
                </div>
              </div>
              <div style={{ flex: isTablet ? '0 0 50%' : 4, paddingRight: 18, borderLeft: `1px solid ${C.border}`, paddingLeft: 18 }}>
                <div style={{ fontSize: 9, fontWeight: 630, color: C.textDim, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 7, opacity: 0.65 }}>Pesée</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 14 }}>
                  <div><label style={labelStyle}>Poids matin (kg)</label><input type="number" value={poidsMatin} onChange={e => setPoidsMatin(e.target.value)} placeholder="0.00" step="0.01" style={{ ...inputStyle, height: 36 }}/></div>
                  <div><label style={labelStyle}>Heure matin</label><TimeInput value={heureMatin} onChange={setHeureMatin} C={C}/></div>
                  <div><label style={labelStyle}>Poids soir (kg)</label><input type="number" value={poidsSoir} onChange={e => setPoidsSoir(e.target.value)} placeholder="0.00" step="0.01" style={{ ...inputStyle, height: 36 }}/></div>
                  <div><label style={labelStyle}>Heure soir</label><TimeInput value={heureSoir} onChange={setHeureSoir} C={C}/></div>
                </div>
              </div>
              <div style={{ flex: 1, borderLeft: `1px solid ${C.border}`, paddingLeft: 18 }}>
                <div style={{ fontSize: 9, fontWeight: 630, color: C.textDim, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 7, opacity: 0.65 }}>Bassin</div>
                <div><label style={labelStyle}>EC Bassin</label><input type="number" value={bassinEC} onChange={e => setBassinEC(e.target.value)} placeholder="0.00" step="0.01" style={{ ...inputStyle, height: 36 }}/></div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Table Tours */}
      <div style={{ ...cardStyle, marginBottom: 0 }}>
        <div style={{ fontSize: 12, fontWeight: 800, color: C.textMuted, textTransform: 'uppercase', letterSpacing: '0em', marginBottom: 14 }}>
          Tours d'irrigation
        </div>

        <div style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
          <table style={{ width: '100%', minWidth: isMobile ? 800 : 1100, borderCollapse: 'collapse', fontFamily: 'inherit' }}>
            <thead>
              <tr>
                <TH w={36} C={C}>N°</TH>
                <TH w={60} C={C}>Rad.</TH>
                <TH w={70} color={C.blue} C={C}>∑ Rad</TH>
                <TH w={100} C={C}>Heure</TH>
                <TH w={70} color={C.textDim} C={C}>Repos</TH>
                <TH w={60} C={C}>Dur.(min)</TH>
                <TH w={68} C={C}>V.Ap.</TH>
                <TH w={60} C={C}>EC Ap.</TH>
                <TH w={60} C={C}>pH Ap.</TH>
                <TH w={60} C={C}>V.Dr.</TH>
                <TH w={60} C={C}>EC Dr.</TH>
                <TH w={60} C={C}>pH Dr.</TH>
                <TH w={65} color={C.amber} C={C}>% Dr.</TH>
                <TH w={70} color={C.amber} C={C}>Moy%Dr.</TH>
                <TH w={36} C={C}></TH>
              </tr>
            </thead>
            <tbody>
              {tours.length === 0 ? (
                <tr><td colSpan={15} style={{ padding: '40px 0', textAlign: 'center', color: C.textDim, fontSize: 12 }}>
                  Cliquez sur <strong style={{ color: C.green }}>+ Nouveau tour</strong> pour ajouter le premier tour
                </td></tr>
              ) : tours.map((t, i) => (
                <tr key={t.id} style={{ borderBottom: i < tours.length - 1 ? `1px solid ${C.border}` : 'none' }}>
                  <td style={{ padding: '5px 3px', textAlign: 'center' }}>
                    <div style={{ width: 24, height: 24, borderRadius: 6, background: dark ? 'rgba(52,217,111,0.12)' : 'rgba(24,120,63,0.08)', border: `1.5px solid ${C.green}30`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 900, color: C.green, margin: '0 auto' }}>{t.num}</div>
                  </td>
                  <td style={{ padding: '5px 3px' }}><TInput value={t.rad} onChange={v => updateTour(t.id, 'rad', v)} C={C}/></td>
                  <td style={{ padding: '5px 3px', textAlign: 'center' }}>
                    <div style={{ fontSize: 12, fontWeight: 630, color: C.blue }}>{t.cumulRad > 0 ? fmtNum(t.cumulRad, 0) : '—'}</div>
                  </td>
                  <td style={{ padding: '5px 3px' }}><TimeInput value={t.heure} onChange={v => updateTour(t.id, 'heure', v)} C={C}/></td>
                  <td style={{ padding: '5px 3px', textAlign: 'center' }}>
                    <div style={{ fontSize: 12, fontWeight: 630, color: t.tempsRepos !== null ? C.textMuted : C.textDim }}>{t.tempsRepos !== null ? `${t.tempsRepos}m` : i === 0 ? '—' : '?'}</div>
                  </td>
                  <td style={{ padding: '5px 3px' }}><TInput value={t.duree} onChange={v => updateTour(t.id, 'duree', v)} C={C}/></td>
                  <td style={{ padding: '5px 3px' }}><TInput value={t.vApport} onChange={v => updateTour(t.id, 'vApport', v)} C={C}/></td>
                  <td style={{ padding: '5px 3px' }}><TInput value={t.ecApport} onChange={v => updateTour(t.id, 'ecApport', v)} C={C}/></td>
                  <td style={{ padding: '5px 3px' }}><TInput value={t.phApport} onChange={v => updateTour(t.id, 'phApport', v)} C={C}/></td>
                  <td style={{ padding: '5px 3px' }}><TInput value={t.vDrain} onChange={v => updateTour(t.id, 'vDrain', v)} C={C}/></td>
                  <td style={{ padding: '5px 3px' }}><TInput value={t.ecDrain} onChange={v => updateTour(t.id, 'ecDrain', v)} C={C}/></td>
                  <td style={{ padding: '5px 3px' }}><TInput value={t.phDrain} onChange={v => updateTour(t.id, 'phDrain', v)} C={C}/></td>
                  <td style={{ padding: '5px 3px', textAlign: 'center' }}>
                    <div style={{ fontSize: 12, fontWeight: 630, color: t.pctDrain !== null ? C.amber : C.textDim }}>{t.pctDrain !== null ? `${fmtNum(t.pctDrain, 1)}%` : '—'}</div>
                  </td>
                  <td style={{ padding: '5px 3px', textAlign: 'center' }}>
                    <div style={{ fontSize: 12, fontWeight: 630, color: t.moyPctDrain !== null ? C.amber : C.textDim }}>{t.moyPctDrain !== null ? `${fmtNum(t.moyPctDrain, 1)}%` : '—'}</div>
                  </td>
                  <td style={{ padding: '5px 3px', textAlign: 'center' }}>
                    <button onClick={() => deleteTour(t.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: C.textDim, padding: 3, borderRadius: 4, display: 'flex', alignItems: 'center' }}
                      onMouseEnter={e => e.currentTarget.style.color = C.red}
                      onMouseLeave={e => e.currentTarget.style.color = C.textDim}
                    ><Trash2 size={12} strokeWidth={2}/></button>
                  </td>
                </tr>
              ))}
            </tbody>
            {tours.length > 0 && (
              <tfoot>
                <tr style={{ borderTop: `2px solid ${C.border}` }}>
                  <td colSpan={6} style={{ padding: '8px 4px', fontSize: 12, fontWeight: 630, color: C.textMuted }}>TOTAUX</td>
                  <td style={{ padding: '8px 3px', textAlign: 'center', fontSize: 12, fontWeight: 900, color: C.green }}>{fmtNum(totalVApport, 1)}</td>
                  <td style={{ padding: '8px 3px', textAlign: 'center', fontSize: 12, fontWeight: 630, color: C.textMuted }}>{ecMoyApport ? fmtNum(ecMoyApport, 2) : '—'}</td>
                  <td style={{ padding: '8px 3px', textAlign: 'center', fontSize: 12, fontWeight: 630, color: C.textMuted }}>{phMoyApport ? fmtNum(phMoyApport, 2) : '—'}</td>
                  <td style={{ padding: '8px 3px', textAlign: 'center', fontSize: 12, fontWeight: 900, color: C.blue }}>{fmtNum(totalVDrain, 1)}</td>
                  <td style={{ padding: '8px 3px', textAlign: 'center', fontSize: 12, fontWeight: 630, color: C.textMuted }}>{ecMoyDrain ? fmtNum(ecMoyDrain, 2) : '—'}</td>
                  <td style={{ padding: '8px 3px', textAlign: 'center', fontSize: 12, fontWeight: 630, color: C.textMuted }}>{phMoyDrain ? fmtNum(phMoyDrain, 2) : '—'}</td>
                  <td style={{ padding: '8px 3px', textAlign: 'center', fontSize: 12, fontWeight: 900, color: C.amber }}>{moyDrainFinale !== null ? `${fmtNum(moyDrainFinale, 1)}%` : '—'}</td>
                  <td colSpan={2}/>
                </tr>
              </tfoot>
            )}
          </table>
        </div>

        <div ref={tableBottomRef} style={{ marginTop: 12, display: 'flex', alignItems: 'center', justifyContent: 'flex-end' }}>
          <button onClick={addTour} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 18px', background: C.toggleBg, border: `1px solid ${dark ? '#1c2e22' : '#c0d8c8'}`, borderRadius: 8, color: C.green, fontSize: 12, fontWeight: 630, fontFamily: 'inherit', cursor: 'pointer' }}>
            <Plus size={12} strokeWidth={2.5}/> Nouveau tour
          </button>
        </div>

        {tours.length > 0 && (
          <div style={{ marginTop: 14, padding: '12px 16px', background: dark ? 'rgba(52,217,111,0.06)' : 'rgba(24,120,63,0.04)', border: `1px solid ${C.green}20`, borderRadius: 10, display: 'flex', gap: isMobile ? 16 : 32, flexWrap: 'wrap' }}>
            {[
              { label: 'Durée totale', value: fmtDuree(dureeTotal) },
              { label: 'V.Apport', value: fmtNum(totalVApport, 1) },
              { label: 'V.Drain', value: fmtNum(totalVDrain, 1) },
              { label: '% Drain finale', value: moyDrainFinale !== null ? `${fmtNum(moyDrainFinale, 1)}%` : '—' },
              { label: 'CC/bras (cc)', value: ccBras ?? '—', highlight: true },
            ].map(item => (
              <div key={item.label}>
                <div style={{ fontSize: 11, color: C.textDim, marginBottom: 3 }}>{item.label}</div>
                <div style={{ fontSize: 12, fontWeight: 630, color: item.highlight ? C.green : C.text }}>{item.value}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Bouton Enregistrer */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 20, gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
        {error && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, background: dark ? '#2a0a0a' : '#fef2f2', border: `1px solid ${C.red}30`, borderRadius: 8, padding: '8px 14px', color: C.red, fontSize: 12 }}>
            <AlertCircle size={12} strokeWidth={2}/>{error}
          </div>
        )}
        {saved && (
          <div style={{ background: dark ? 'rgba(52,217,111,0.12)' : 'rgba(24,120,63,0.08)', border: `1px solid ${C.green}30`, borderRadius: 8, padding: '8px 14px', color: C.green, fontSize: 12, fontWeight: 630 }}>✓ Enregistré</div>
        )}
        <button onClick={handleSave} disabled={saving || tours.length === 0} style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '11px 28px', background: saving || tours.length === 0 ? C.toggleBg : C.green, color: saving || tours.length === 0 ? C.textDim : '#fff', border: 'none', borderRadius: 9, fontSize: 12, fontWeight: 630, fontFamily: 'inherit', cursor: saving || tours.length === 0 ? 'not-allowed' : 'pointer', transition: 'all 0.15s' }}>
          <Save size={12} strokeWidth={2.5}/>{saving ? 'Enregistrement…' : 'Enregistrer'}
        </button>
      </div>
    </div>
  )
}
