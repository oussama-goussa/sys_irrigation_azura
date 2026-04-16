// ============================================================
// frontend/src/pages/HistoriquePage.jsx — Responsive
// Seules les parties responsives sont modifiées,
// la logique métier est identique à l'original.
// ============================================================

import React, { useState, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import {
  History, ChevronDown, ChevronUp, ChevronLeft, ChevronRight,
  SquarePen, Trash2, X, AlertTriangle, Download, RefreshCw,
  Plus, Save, AlertCircle, Check, Droplets, FlaskConical,
  BarChart2, ClipboardList,
} from 'lucide-react'
import { getSaisies, getSaisie, updateSaisie, deleteSaisie, getDevices, getMe } from '../api/client.js'
import ExportModal from '../components/ExportModal.jsx'

// ── helpers ───────────────────────────────────────────────────
const fmtNum = (v, dec = 2) => {
  if (v === null || v === undefined || v === '' || isNaN(Number(v))) return '—'
  return Number(v).toFixed(dec)
}
const fmtDuree = (totalMin) => {
  if (!totalMin || totalMin <= 0) return '—'
  const h = Math.floor(totalMin / 60), m = Math.floor(totalMin % 60)
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00`
}
const todayStr = () => new Date().toISOString().split('T')[0]
function newTour(num) {
  return { id: Date.now() + num, num, rad: '', cumulRad: 0, heure: '', duree: '', tempsRepos: null, vApport: '', ecApport: '', phApport: '', vDrain: '', ecDrain: '', phDrain: '', pctDrain: null, moyPctDrain: null }
}

// ── TInput ───────────────────────────────────────────────────
function TInput({ value, onChange, disabled = false, C }) {
  return (
    <input type="number" value={value ?? ''} onChange={e => onChange(e.target.value)}
      disabled={disabled} step="any"
      style={{
        width: '100%', textAlign: 'center', padding: '5px 6px', borderRadius: 6,
        border: `1.5px solid ${disabled ? 'transparent' : C.border}`,
        background: disabled ? 'transparent' : C.inputBg,
        color: disabled ? C.green : C.text,
        fontSize: 12, fontFamily: 'inherit', outline: 'none', fontWeight: 630,
      }}
    />
  )
}

// ── TimeInput ─────────────────────────────────────────────────
function TimeInput({ value, onChange, C, small = false }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  const triggerRef = useRef(null)
  const [pos, setPos] = useState({ top: 0, left: 0 })
  const portalRef = useRef(null)
  const [h, m] = value ? value.split(':') : ['00', '00']
  const [hRaw, setHRaw] = useState(null)
  const [mRaw, setMRaw] = useState(null)

  useEffect(() => {
    const close = (e) => { if (ref.current && !ref.current.contains(e.target) && portalRef.current && !portalRef.current.contains(e.target)) setOpen(false) }
    const onScroll = () => setOpen(false)
    document.addEventListener('mousedown', close)
    window.addEventListener('scroll', onScroll, true)
    return () => { document.removeEventListener('mousedown', close); window.removeEventListener('scroll', onScroll, true) }
  }, [])

  const handleOpen = () => {
    if (triggerRef.current) {
      const r = triggerRef.current.getBoundingClientRect()
      setPos({ top: r.bottom + 4, left: Math.min(r.left + r.width / 2, window.innerWidth - 120) })
    }
    setOpen(v => !v)
  }
  const inc = (type) => { const hv = parseInt(h||'0'), mv = parseInt(m||'0'); if (type === 'h') onChange(`${String((hv+1)%24).padStart(2,'0')}:${m||'00'}`); else onChange(`${h||'00'}:${String((mv+1)%60).padStart(2,'0')}`) }
  const dec = (type) => { const hv = parseInt(h||'0'), mv = parseInt(m||'0'); if (type === 'h') onChange(`${String((hv-1+24)%24).padStart(2,'0')}:${m||'00'}`); else onChange(`${h||'00'}:${String((mv-1+60)%60).padStart(2,'0')}`) }

  return (
    <div ref={ref} style={{ position: 'relative', display: 'inline-block', width: '100%' }}>
      <div ref={triggerRef} onClick={handleOpen} style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        height: small ? 28 : 32, padding: '0 8px', width: '100%',
        border: `1.5px solid ${open ? C.green : C.border}`, borderRadius: 7, background: C.inputBg,
        cursor: 'pointer', transition: 'border-color 0.15s', fontSize: 12,
        color: value && value !== '00:00' ? C.text : C.textDim, gap: 4, fontWeight: 630, boxSizing: 'border-box',
      }}>
        <span>{h||'00'}</span><span style={{ color: C.textDim }}>:</span><span>{m||'00'}</span>
      </div>
      {open && createPortal(
        <div ref={portalRef} style={{ position: 'fixed', top: pos.top, left: pos.left, transform: 'translateX(-50%)', background: C.card, border: `1.5px solid ${C.border}`, borderRadius: 10, zIndex: 99999, boxShadow: `0 4px 24px rgba(0,0,0,0.2)`, padding: '10px 16px', display: 'flex', alignItems: 'center', gap: 4 }}>
          {['h','m'].map((type, ti) => (
            <React.Fragment key={type}>
              {ti === 1 && <span style={{ fontSize: 22, fontWeight: 900, color: C.textMuted }}>:</span>}
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
                <button onClick={() => inc(type)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: C.textMuted, padding: '4px 8px' }}><ChevronUp size={16} strokeWidth={2.5}/></button>
                <input type="text" inputMode="numeric" maxLength={2}
                  value={type === 'h' ? (hRaw ?? h ?? '00') : (mRaw ?? m ?? '00')}
                  onChange={e => { const raw = e.target.value.replace(/\D/g,'').slice(0,2); if (type === 'h') { setHRaw(raw); if (raw.length === 2) { onChange(`${String(Math.min(23,parseInt(raw)||0)).padStart(2,'0')}:${m||'00'}`); setHRaw(null) } } else { setMRaw(raw); if (raw.length === 2) { onChange(`${h||'00'}:${String(Math.min(59,parseInt(raw)||0)).padStart(2,'0')}`); setMRaw(null) } } }}
                  onBlur={() => { if (type === 'h') { onChange(`${String(Math.min(23,parseInt(hRaw??h)||0)).padStart(2,'0')}:${m||'00'}`); setHRaw(null) } else { onChange(`${h||'00'}:${String(Math.min(59,parseInt(mRaw??m)||0)).padStart(2,'0')}`); setMRaw(null) } }}
                  style={{ fontSize: 22, fontWeight: 630, color: C.text, width: 48, textAlign: 'center', background: 'none', border: 'none', outline: 'none', fontFamily: 'inherit', padding: 0 }}
                />
                <button onClick={() => dec(type)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: C.textMuted, padding: '4px 8px' }}><ChevronDown size={16} strokeWidth={2.5}/></button>
              </div>
            </React.Fragment>
          ))}
        </div>,
        document.body
      )}
    </div>
  )
}

// ── SSelect ───────────────────────────────────────────────────
function SSelect({ value, onChange, options, placeholder, C, width = '100%', disabled = false }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  useEffect(() => { const close = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }; document.addEventListener('mousedown', close); return () => document.removeEventListener('mousedown', close) }, [])
  const selected = options.find(o => (o.value ?? o) === value)
  const label = selected ? (selected.label ?? selected) : null

  return (
    <div ref={ref} style={{ position: 'relative', width }}>
      <div onClick={() => !disabled && setOpen(v => !v)} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 10px', height: 32, fontWeight: 630, border: `1.5px solid ${open ? C.green : C.border}`, borderRadius: 8, background: disabled ? C.toggleBg : C.inputBg, cursor: disabled ? 'not-allowed' : 'pointer', transition: 'border-color 0.15s', gap: 6, opacity: disabled ? 0.5 : 1 }}>
        <span style={{ fontSize: 12, color: label ? C.text : C.textDim, fontWeight: 630, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{label || placeholder}</span>
        <span style={{ color: C.textDim, display: 'flex', alignItems: 'center', flexShrink: 0 }}>{open ? <ChevronUp size={12} strokeWidth={2}/> : <ChevronDown size={12} strokeWidth={2}/>}</span>
      </div>
      {open && (
        <div style={{ position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0, background: C.card, border: `1.5px solid ${C.border}`, borderRadius: 8, zIndex: 500, boxShadow: `0 4px 20px rgba(0,0,0,0.12)`, maxHeight: 200, overflowY: 'auto' }}>
          {placeholder && <div onClick={() => { onChange(''); setOpen(false) }} style={{ padding: '9px 14px', fontSize: 12, cursor: 'pointer', color: !value ? C.green : C.textDim, background: !value ? `${C.green}12` : 'transparent' }}>{placeholder}</div>}
          {options.map(o => { const val = o.value ?? o, lbl = o.label ?? o, sel = val === value; return <div key={val} onClick={() => { onChange(val); setOpen(false) }} style={{ padding: '9px 14px', fontSize: 12, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'space-between', color: sel ? C.green : C.textMuted, background: sel ? `${C.green}12` : 'transparent', transition: 'background 0.1s' }} onMouseEnter={e => e.currentTarget.style.background = sel ? `${C.green}18` : C.tableHover} onMouseLeave={e => e.currentTarget.style.background = sel ? `${C.green}12` : 'transparent'}><span>{lbl}</span>{sel && <Check size={12} strokeWidth={2.5} color={C.green}/>}</div> })}
        </div>
      )}
    </div>
  )
}

// ── FilterSelect (portal) ─────────────────────────────────────
function FilterSelect({ value, onChange, options, C }) {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState({ top: 0, left: 0, width: 0 })
  const triggerRef = useRef(null)
  const dropRef = useRef(null)

  useEffect(() => {
    if (!open) return
    const close = (e) => { if (triggerRef.current && !triggerRef.current.contains(e.target) && dropRef.current && !dropRef.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [open])

  const handleOpen = () => {
    if (triggerRef.current) { const r = triggerRef.current.getBoundingClientRect(); setPos({ top: r.bottom + 2, left: r.left, width: Math.max(r.width, 130) }) }
    setOpen(v => !v)
  }
  const selected = options.find(o => (o.value ?? o) === value)
  const label = selected ? (selected.label ?? selected) : null

  const dropdown = open && createPortal(
    <div ref={dropRef} style={{ position: 'fixed', top: pos.top, left: pos.left, width: pos.width, background: C.card, border: `1.5px solid ${C.border}`, borderRadius: 8, zIndex: 99999, boxShadow: '0 6px 24px rgba(0,0,0,0.18)', maxHeight: 200, overflowY: 'auto' }}>
      <div onClick={() => { onChange(''); setOpen(false) }} style={{ padding: '8px 12px', fontSize: 12, cursor: 'pointer', fontWeight: 630, color: !value ? C.green : C.textMuted, background: !value ? `${C.green}12` : 'transparent' }}>Tous</div>
      {options.map(o => { const val = o.value ?? o, lbl = o.label ?? o, sel = val === value; return <div key={val} onClick={() => { onChange(val); setOpen(false) }} style={{ padding: '8px 12px', fontSize: 12, cursor: 'pointer', fontWeight: 630, display: 'flex', alignItems: 'center', justifyContent: 'space-between', color: sel ? C.green : C.textMuted, background: sel ? `${C.green}12` : 'transparent' }} onMouseEnter={e => e.currentTarget.style.background = sel ? `${C.green}18` : C.tableHover} onMouseLeave={e => e.currentTarget.style.background = sel ? `${C.green}12` : 'transparent'}><span>{lbl}</span>{sel && <Check size={10} strokeWidth={2.5} color={C.green}/>}</div> })}
    </div>,
    document.body
  )

  return (
    <div ref={triggerRef} style={{ position: 'relative' }}>
      <div onClick={handleOpen} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', height: 28, padding: '0 7px', border: `1.5px solid ${open ? C.green : value ? C.green + '55' : C.border}`, borderRadius: 6, background: C.inputBg, cursor: 'pointer', gap: 3 }}>
        <span style={{ fontSize: 12, color: label ? C.text : C.textDim, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{label || 'Tous'}</span>
        <span style={{ color: C.textDim, display: 'flex', alignItems: 'center', flexShrink: 0 }}>{open ? <ChevronUp size={10} strokeWidth={2}/> : <ChevronDown size={10} strokeWidth={2}/>}</span>
      </div>
      {dropdown}
    </div>
  )
}

// ── FilterInput ───────────────────────────────────────────────
function FilterInput({ value, onChange, C }) {
  return (
    <div style={{ position: 'relative' }}>
      <input type="text" value={value} onChange={e => onChange(e.target.value)} style={{ width: '100%', height: 28, padding: '0 22px 0 7px', borderRadius: 5, border: `1.5px solid ${value ? C.green + '60' : C.border}`, fontWeight: 630, background: C.inputBg, color: C.text, fontSize: 12, fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box' }}/>
      {value && <button onClick={() => onChange('')} style={{ position: 'absolute', right: 4, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: C.textDim, padding: 2 }}><X size={12} strokeWidth={2}/></button>}
    </div>
  )
}

// ── CalendarPicker (simplified for filter) ────────────────────
const MONTHS_FR = ['Janvier','Février','Mars','Avril','Mai','Juin','Juillet','Août','Septembre','Octobre','Novembre','Décembre']
const DAYS_FR = ['Lu','Ma','Me','Je','Ve','Sa','Di']

function CalendarPicker({ value, onChange, C, small = false }) {
  const [open, setOpen] = useState(false)
  const [viewDate, setView] = useState(() => value ? new Date(value + 'T00:00:00') : new Date())
  const [mode, setMode] = useState('days')
  const [pos, setPos] = useState({ top: 0, left: 0 })
  const ref = useRef(null), triggerRef = useRef(null), portalRef = useRef(null)

  useEffect(() => {
    const close = (e) => { if (ref.current && !ref.current.contains(e.target) && portalRef.current && !portalRef.current.contains(e.target)) setOpen(false) }
    const onScroll = () => setOpen(false)
    document.addEventListener('mousedown', close); window.addEventListener('scroll', onScroll, true)
    return () => { document.removeEventListener('mousedown', close); window.removeEventListener('scroll', onScroll, true) }
  }, [])

  useEffect(() => { if (value) setView(new Date(value + 'T00:00:00')) }, [value])

  const year = viewDate.getFullYear(), month = viewDate.getMonth()
  let startDow = new Date(year, month, 1).getDay() - 1; if (startDow < 0) startDow = 6
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
  const years = Array.from({ length: 12 }, (_, i) => year - 6 + i)
  const btnStyle = { background: 'none', border: 'none', cursor: 'pointer', color: C.textMuted, padding: '3px 6px', borderRadius: 5, display: 'flex', alignItems: 'center' }

  const handleOpen = () => {
    const r = triggerRef.current.getBoundingClientRect()
    const spaceBelow = window.innerHeight - r.bottom
    if (spaceBelow < 320) setPos({ bottom: window.innerHeight - r.top + 4, top: 'auto', left: Math.min(r.left, window.innerWidth - 260) })
    else setPos({ top: r.bottom + 4, bottom: 'auto', left: Math.min(r.left, window.innerWidth - 260) })
    setOpen(v => !v); setMode('days')
  }

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <div ref={triggerRef} onClick={handleOpen} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', height: small ? 28 : 32, padding: small ? '0 8px' : '0 12px', fontSize: 12, border: `1.5px solid ${open ? C.green : C.border}`, borderRadius: 8, background: C.inputBg, cursor: 'pointer', color: value ? C.text : C.textDim, fontFamily: 'inherit', fontWeight: 700, boxSizing: 'border-box', width: '100%' }}>
        <span>{displayValue || 'jj/mm/aaaa'}</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginLeft: 5 }}>
          {value && <span onClick={e => { e.stopPropagation(); onChange('') }} style={{ color: C.textDim, cursor: 'pointer', display: 'flex' }}><X size={12} strokeWidth={2.5}/></span>}
          {open ? <ChevronUp size={13} strokeWidth={2}/> : <ChevronDown size={13} strokeWidth={2}/>}
        </div>
      </div>
      {open && createPortal(
        <div ref={portalRef} style={{ position: 'fixed', top: pos.top !== 'auto' ? pos.top : 'auto', bottom: pos.bottom !== 'auto' ? pos.bottom : 'auto', left: pos.left, background: C.card, border: `1.5px solid ${C.border}`, borderRadius: 12, zIndex: 99999, boxShadow: `0 8px 32px rgba(0,0,0,0.18)`, padding: '12px 12px 10px', width: 248, fontFamily: 'inherit' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
            <button onClick={() => mode === 'years' ? setView(new Date(year-12, month, 1)) : mode === 'months' ? setView(new Date(year-1, month, 1)) : setView(new Date(year, month-1, 1))} style={btnStyle}><ChevronLeft size={14} strokeWidth={2.5}/></button>
            <div style={{ display: 'flex', gap: 4 }}>
              <button onClick={() => setMode(m => m === 'months' ? 'days' : 'months')} style={{ background: mode === 'months' ? `${C.green}15` : 'none', border: mode === 'months' ? `1px solid ${C.green}40` : '1px solid transparent', borderRadius: 6, cursor: 'pointer', color: C.text, fontSize: 12, fontWeight: 800, fontFamily: 'inherit', padding: '3px 8px' }}>{MONTHS_FR[month]}</button>
              <button onClick={() => setMode(m => m === 'years' ? 'days' : 'years')} style={{ background: mode === 'years' ? `${C.green}15` : 'none', border: mode === 'years' ? `1px solid ${C.green}40` : '1px solid transparent', borderRadius: 6, cursor: 'pointer', color: C.text, fontSize: 12, fontWeight: 800, fontFamily: 'inherit', padding: '3px 8px' }}>{year}</button>
            </div>
            <button onClick={() => mode === 'years' ? setView(new Date(year+12, month, 1)) : mode === 'months' ? setView(new Date(year+1, month, 1)) : setView(new Date(year, month+1, 1))} style={btnStyle}><ChevronRight size={14} strokeWidth={2.5}/></button>
          </div>
          {mode === 'years' && <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 4, marginBottom: 8 }}>{years.map(y => <button key={y} onClick={() => { setView(new Date(y, month, 1)); setMode('months') }} style={{ background: y === year ? C.green : 'transparent', border: `1px solid ${y === year ? C.green : C.border}`, borderRadius: 7, cursor: 'pointer', color: y === year ? '#fff' : C.text, fontSize: 12, fontWeight: y === year ? 800 : 500, fontFamily: 'inherit', padding: '7px 4px' }}>{y}</button>)}</div>}
          {mode === 'months' && <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 4, marginBottom: 8 }}>{MONTHS_FR.map((mn, mi) => <button key={mn} onClick={() => { setView(new Date(year, mi, 1)); setMode('days') }} style={{ background: mi === month ? C.green : 'transparent', border: `1px solid ${mi === month ? C.green : C.border}`, borderRadius: 7, cursor: 'pointer', color: mi === month ? '#fff' : C.text, fontSize: 11, fontWeight: mi === month ? 800 : 500, fontFamily: 'inherit', padding: '7px 4px' }}>{mn.slice(0,3)}</button>)}</div>}
          {mode === 'days' && (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', marginBottom: 4 }}>{DAYS_FR.map(d => <div key={d} style={{ textAlign: 'center', fontSize: 9, fontWeight: 700, color: C.textDim, padding: '2px 0', textTransform: 'uppercase' }}>{d}</div>)}</div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '2px 0' }}>
                {cells.map((cell, i) => { const cellStr = cell.curr ? `${year}-${String(month+1).padStart(2,'0')}-${String(cell.day).padStart(2,'0')}` : null; const isSel = cellStr === value, isT = cellStr === todayStr; return <div key={i} onClick={() => cell.curr && select(cell.day)} style={{ textAlign: 'center', fontSize: 11, padding: '5px 0', borderRadius: 6, cursor: cell.curr ? 'pointer' : 'default', fontWeight: isSel ? 800 : isT ? 700 : 400, color: isSel ? '#fff' : isT ? C.green : cell.curr ? C.text : C.textDim, background: isSel ? C.green : 'transparent', opacity: cell.curr ? 1 : 0.3, transition: 'all 0.1s', position: 'relative' }} onMouseEnter={e => { if (cell.curr && !isSel) e.currentTarget.style.background = `${C.green}18` }} onMouseLeave={e => { if (!isSel) e.currentTarget.style.background = 'transparent' }}>{isT && !isSel && <span style={{ position: 'absolute', bottom: 1, left: '50%', transform: 'translateX(-50%)', width: 3, height: 3, borderRadius: '50%', background: C.green }}/>}{cell.day}</div> })}
              </div>
            </>
          )}
          <div style={{ marginTop: 10, paddingTop: 8, borderTop: `1px solid ${C.border}`, display: 'flex', justifyContent: 'space-between' }}>
            <button onClick={() => { onChange(''); setOpen(false); setMode('days') }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: C.textDim, fontSize: 10, fontWeight: 700, fontFamily: 'inherit', padding: '3px 6px', textTransform: 'uppercase' }}>Effacer</button>
            <button onClick={() => { onChange(todayStr); setOpen(false); setMode('days') }} style={{ background: `${C.green}15`, border: `1px solid ${C.green}40`, borderRadius: 6, cursor: 'pointer', color: C.green, fontSize: 10, fontWeight: 800, fontFamily: 'inherit', padding: '3px 10px', textTransform: 'uppercase' }}>Aujourd'hui</button>
          </div>
        </div>,
        document.body
      )}
    </div>
  )
}

// ── ConfirmModal — responsive ─────────────────────────────────
function ConfirmModal({ saisie, onConfirm, onCancel, C }) {
  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(0,0,0,0.65)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16 }}>
      <div style={{ background: C.card, border: `1.5px solid ${C.border}`, borderRadius: 16, padding: '24px 24px', width: '100%', maxWidth: 400, boxShadow: '0 8px 40px rgba(0,0,0,0.5)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
          <div style={{ width: 40, height: 40, borderRadius: 10, background: `${C.amber}18`, border: `1.5px solid ${C.amber}40`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <AlertTriangle size={20} color={C.amber} strokeWidth={2}/>
          </div>
          <div>
            <div style={{ color: C.text, fontWeight: 800, fontSize: 14 }}>Confirmer la suppression</div>
            <div style={{ color: C.textMuted, fontSize: 12, marginTop: 2 }}>Cette action est irréversible</div>
          </div>
        </div>
        <p style={{ color: C.textMuted, fontSize: 12, marginBottom: 20, lineHeight: 1.7 }}>
          Supprimer la saisie du <strong style={{ color: C.text }}>{saisie.date}</strong> — <strong style={{ color: C.text }}>{saisie.farm_name}</strong> {saisie.station} {saisie.serre} ?
          <span style={{ display: 'block', marginTop: 6, color: C.red, fontSize: 11 }}>Tous les tours associés seront également supprimés.</span>
        </p>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button onClick={onCancel} style={{ padding: '8px 16px', borderRadius: 8, border: `1.5px solid ${C.border}`, background: 'transparent', color: C.textMuted, fontSize: 12, fontWeight: 630, fontFamily: 'inherit', cursor: 'pointer' }}>Annuler</button>
          <button onClick={onConfirm} style={{ padding: '8px 16px', borderRadius: 8, border: `1.5px solid ${C.red}`, background: 'transparent', color: C.red, fontSize: 12, fontWeight: 630, fontFamily: 'inherit', cursor: 'pointer' }}>
            <Trash2 size={12} strokeWidth={2} style={{ marginRight: 5, verticalAlign: 'middle' }}/>Supprimer
          </button>
        </div>
      </div>
    </div>
  )
}

// ── EditModal — responsive ────────────────────────────────────
function EditModal({ saisie, token, farms, onSaved, onClose, C, dark, isMobile = false }) {
  const [ferme, setFerme] = useState(saisie.farm_name || '')
  const [station, setStation] = useState(saisie.station || '')
  const [serre, setSerre] = useState(saisie.serre || '')
  const [vanne, setVanne] = useState(saisie.vanne || '')
  const [date, setDate] = useState(saisie.date || todayStr())
  const [nbrBras, setNbrBras] = useState(saisie.nbr_bras ?? '')
  const [nbrGoutteurs, setNbrGoutteurs] = useState(saisie.nbr_goutteurs ?? '')
  const [poidsMatin, setPoidsMatin] = useState(saisie.poids_matin ?? '')
  const [heureMatin, setHeureMatin] = useState(saisie.heure_matin || '')
  const [poidsSoir, setPoidsSoir] = useState(saisie.poids_soir ?? '')
  const [heureSoir, setHeureSoir] = useState(saisie.heure_soir || '')
  const [bassinEC, setBassinEC] = useState(saisie.bassin_ec ?? '')
  const [tours, setTours] = useState([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const tableBottomRef = useRef(null)

  const recalculTours = (list, goutteurs) => {
    const ng = Number(goutteurs) || 0
    let cumulPrev = 0, prevHeure = null, prevDuree = null, prevMoyCalculee = null
    return list.map((t, i) => {
      const radActuelle = Number(t.rad) || 0
      const cumulRad = radActuelle - cumulPrev; cumulPrev += cumulRad
      let tempsRepos = null
      if (i > 0 && prevHeure && prevDuree && t.heure) {
        const toMin = hh => { const [h2, m2] = hh.split(':').map(Number); return h2*60+m2 }
        tempsRepos = toMin(t.heure) - (toMin(prevHeure) + (Number(prevDuree)||0))
        if (tempsRepos < 0) tempsRepos = 0
      }
      let pctDrain = null
      const vd = Number(t.vDrain), va = Number(t.vApport)
      if (va > 0 && ng > 0 && t.vDrain !== '' && t.vDrain !== null && t.vDrain !== undefined)
        pctDrain = (vd / ng / va) * 100
      const pctPourMoy = pctDrain !== null ? pctDrain : 0
      let moyPctDrain = null
      if (i === 0) moyPctDrain = pctDrain != null ? pctDrain : null
      else if (prevMoyCalculee !== null) moyPctDrain = (prevMoyCalculee * i + pctPourMoy) / (i+1)
      else if (pctDrain !== null) moyPctDrain = pctDrain
      prevHeure = t.heure; prevDuree = t.duree
      prevMoyCalculee = moyPctDrain !== null ? moyPctDrain : prevMoyCalculee
      return { ...t, cumulRad: Math.max(0, cumulRad), tempsRepos, pctDrain, moyPctDrain }
    })
  }

  useEffect(() => {
    getSaisie(token, saisie.id).then(data => {
      const t = (data.tours || []).map((t, i) => ({ id: Date.now()+i, num: t.num_tour, rad: t.rad ?? '', cumulRad: t.cumul_rad ?? 0, heure: t.heure || '', duree: t.duree_min ?? '', tempsRepos: t.temps_repos ?? null, vApport: t.v_apport ?? '', ecApport: t.ec_apport ?? '', phApport: t.ph_apport ?? '', vDrain: t.v_drain ?? '', ecDrain: t.ec_drain ?? '', phDrain: t.ph_drain ?? '', pctDrain: t.pct_drain ?? null, moyPctDrain: t.moy_pct_drain ?? null }))
      setTours(recalculTours(t, nbrGoutteurs))
    }).catch(() => {})
  }, [saisie.id])

  const pctRessuyage = poidsMatin && poidsSoir && Number(poidsMatin) > 0
    ? (((Number(poidsSoir) - Number(poidsMatin)) / Number(poidsMatin)) * 100).toFixed(1) : null

  const fermeOptions = farms.map(f => ({ value: f.farm_name, label: f.farm_name }))
  const selectedFarm = farms.find(f => f.farm_name === ferme)
  const houses = selectedFarm?.houses || []
  const stationOptions = [...new Set(houses.map(h => h.house_number))].map(v => ({ value: v, label: `Station ${v}` }))
  const serreOptions = Array.from({ length: 20 }, (_, i) => ({ value: `S${String(i+1).padStart(2,'0')}`, label: `S${String(i+1).padStart(2,'0')}` }))

  const updateTour = (id, field, val) => setTours(prev => recalculTours(prev.map(t => t.id === id ? { ...t, [field]: val } : t), nbrGoutteurs))
  useEffect(() => { setTours(prev => recalculTours(prev, nbrGoutteurs)) }, [nbrGoutteurs])
  const addTour = () => { setTours(prev => { const next = [...prev, newTour(prev.length+1)]; setTimeout(() => tableBottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 50); return recalculTours(next, nbrGoutteurs) }) }
  const deleteTourRow = (id) => setTours(prev => recalculTours(prev.filter(t => t.id !== id).map((t, i) => ({ ...t, num: i+1 })), nbrGoutteurs))

  const lastTour = tours[tours.length-1]
  const totalVApport = tours.reduce((s, t) => s + (Number(t.vApport)||0), 0)
  const totalVDrain = tours.reduce((s, t) => s + (Number(t.vDrain)||0), 0)
  const dureeTotal = tours.reduce((s, t) => s + (Number(t.duree)||0), 0)
  const ecMoyApport = tours.filter(t => t.ecApport).length ? (tours.reduce((s, t) => s + (Number(t.ecApport)||0), 0) / tours.filter(t => t.ecApport).length) : null
  const phMoyApport = tours.filter(t => t.phApport).length ? (tours.reduce((s, t) => s + (Number(t.phApport)||0), 0) / tours.filter(t => t.phApport).length) : null
  const ecMoyDrain = tours.filter(t => t.ecDrain).length ? (tours.reduce((s, t) => s + (Number(t.ecDrain)||0), 0) / tours.filter(t => t.ecDrain).length) : null
  const phMoyDrain = tours.filter(t => t.phDrain).length ? (tours.reduce((s, t) => s + (Number(t.phDrain)||0), 0) / tours.filter(t => t.phDrain).length) : null
  const moyDrainFinale = lastTour?.moyPctDrain ?? null
  const ccBras = totalVApport && moyDrainFinale !== null && nbrGoutteurs && nbrBras && Number(nbrBras) > 0
    ? ((totalVApport * (1 - moyDrainFinale/100) * Number(nbrGoutteurs)) / Number(nbrBras)).toFixed(1) : null

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
      await updateSaisie(token, saisie.id, payload)
      onSaved(); onClose()
    } catch (e) {
      try { const p = JSON.parse(e.message); setError(Array.isArray(p?.detail) ? p.detail.map(d => `${(d.loc||[]).slice(1).join('.')} : ${d.msg}`).join(' | ') : String(p?.detail || e.message)) }
      catch { setError(String(e.message)) }
    } finally { setSaving(false) }
  }

  const inputStyle = { width: '100%', padding: '7px 10px', borderRadius: 8, border: `1.5px solid ${C.border}`, background: C.inputBg, color: C.text, fontSize: 12, fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box', fontWeight: 630 }
  const labelStyle = { display: 'block', color: C.textMuted, fontSize: 12, fontWeight: 630, textTransform: 'uppercase', letterSpacing: '0em', marginBottom: 4 }

  // TH for edit modal table
  const THm = ({ children, w, color }) => (
    <th style={{ padding: '7px 4px', textAlign: 'center', fontSize: 11, fontWeight: 630, textTransform: 'uppercase', color: color || C.textDim, whiteSpace: 'nowrap', minWidth: w, borderBottom: `1.5px solid ${C.border}` }}>{children}</th>
  )

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(0,0,0,0.65)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: isMobile ? 0 : 24 }}>
      <div style={{
        background: C.card, border: `1.5px solid ${C.border}`,
        borderRadius: isMobile ? 0 : 16,
        width: '100%', maxWidth: isMobile ? '100%' : 1300,
        maxHeight: isMobile ? '100vh' : '90vh',
        height: isMobile ? '100vh' : undefined,
        overflowY: 'auto',
        boxShadow: '0 24px 80px rgba(0,0,0,0.6)',
      }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: isMobile ? '16px 16px' : '20px 28px', borderBottom: `1px solid ${C.border}`, position: 'sticky', top: 0, background: C.card, zIndex: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <SquarePen size={16} color={C.green} strokeWidth={2}/>
            <div style={{ color: C.text, fontWeight: 800, fontSize: isMobile ? 13 : 15, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              Modifier — {saisie.date} · {saisie.farm_name}
            </div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: C.textDim, padding: 4, flexShrink: 0 }}><X size={18} strokeWidth={2}/></button>
        </div>

        <div style={{ padding: isMobile ? '16px 16px' : '24px 28px' }}>
          {/* Bilan cards */}
          {tours.length > 0 && (
            <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr 1fr' : '1.5fr 1fr 1fr 1fr', gap: 10, marginBottom: 16 }}>
              {[
                { label: 'Irrigation', color: C.green, Icon: ClipboardList, items: [{ sub: 'Tours', value: tours.length }, { sub: 'Durée', value: fmtDuree(dureeTotal) }] },
                { label: 'Bilan Eau', color: C.blue, Icon: Droplets, items: [{ sub: 'Apport', value: totalVApport > 0 ? fmtNum(totalVApport, 1) : '—' }, { sub: 'Drain', value: totalVDrain > 0 ? fmtNum(totalVDrain, 1) : '—' }] },
                { label: 'Bilan EC', color: C.green, Icon: BarChart2, items: [{ sub: 'Ap.', value: ecMoyApport ? fmtNum(ecMoyApport, 2) : '—' }, { sub: 'Dr.', value: ecMoyDrain ? fmtNum(ecMoyDrain, 2) : '—' }] },
                { label: 'Bilan pH', color: C.amber, Icon: ClipboardList, items: [{ sub: 'Ap.', value: phMoyApport ? fmtNum(phMoyApport, 2) : '—' }, { sub: 'Dr.', value: phMoyDrain ? fmtNum(phMoyDrain, 2) : '—' }] },
              ].map(card => (
                <div key={card.label} style={{ background: dark ? '#111a14' : '#ffffff', border: `1px solid ${dark ? '#1c2e22' : '#d0e8d8'}`, borderRadius: 10, padding: '12px 14px', display: 'flex', flexDirection: 'column', justifyContent: 'space-between', minHeight: 80 }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                    <div style={{ fontSize: 11, fontWeight: 630, textTransform: 'uppercase', color: dark ? C.textDim : '#5a7a66' }}>{card.label}</div>
                    <card.Icon size={12} strokeWidth={1.6} color={card.color} style={{ opacity: 0.65 }}/>
                  </div>
                  <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end' }}>
                    {card.items.map(it => <div key={it.sub}><div style={{ fontSize: 10, color: dark ? C.textDim : '#5a7a66', marginBottom: 2 }}>{it.sub}</div><div style={{ fontSize: 18, fontWeight: 630, color: card.color }}>{it.value}</div></div>)}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Sélecteurs */}
          <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr 1fr' : '1fr 1fr 1fr 1fr 1fr', gap: 12, marginBottom: 16 }}>
            <div><label style={labelStyle}>Ferme</label><SSelect value={ferme} onChange={v => { setFerme(v); setStation('') }} options={fermeOptions} placeholder="Sélectionner…" C={C}/></div>
            <div><label style={labelStyle}>Station</label><SSelect value={station} onChange={setStation} options={stationOptions} placeholder="Sélectionner…" C={C}/></div>
            <div><label style={labelStyle}>Serre</label><SSelect value={serre} onChange={setSerre} options={serreOptions} placeholder="S01" C={C}/></div>
            <div><label style={labelStyle}>Vanne</label><input value={vanne} onChange={e => setVanne(e.target.value)} style={inputStyle} placeholder="ex: 1"/></div>
            <div><label style={labelStyle}>Date</label><CalendarPicker value={date} onChange={setDate} C={C}/></div>
          </div>

          {/* Constantes */}
          <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, padding: '14px 18px', marginBottom: 16 }}>
            <div style={{ fontSize: 12, fontWeight: 800, color: C.textMuted, textTransform: 'uppercase', marginBottom: 12 }}>Constantes &amp; Substrat</div>
            <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr 1fr' : 'repeat(4, 1fr)', gap: 12 }}>
              {[{ label: 'Nbr Bras', val: nbrBras, set: setNbrBras }, { label: 'Nbr Goutteurs', val: nbrGoutteurs, set: setNbrGoutteurs }, { label: 'Poids matin (Kg)', val: poidsMatin, set: setPoidsMatin }, { label: 'Poids soir (Kg)', val: poidsSoir, set: setPoidsSoir }, { label: 'Bassin (EC)', val: bassinEC, set: setBassinEC }].map(f => (
                <div key={f.label}><label style={labelStyle}>{f.label}</label><input type="number" value={f.val} onChange={e => f.set(e.target.value)} step="any" style={inputStyle}/></div>
              ))}
              <div><label style={labelStyle}>Heure matin</label><TimeInput value={heureMatin} onChange={setHeureMatin} C={C}/></div>
              <div><label style={labelStyle}>Heure soir</label><TimeInput value={heureSoir} onChange={setHeureSoir} C={C}/></div>
              <div>
                <label style={labelStyle}>% Ressuyage</label>
                <div style={{ padding: '7px 10px', borderRadius: 8, textAlign: 'center', background: pctRessuyage !== null ? `${C.green}10` : C.toggleBg, border: `1.5px solid ${pctRessuyage !== null ? C.green + '40' : C.border}`, fontSize: 12, fontWeight: 630, color: pctRessuyage !== null ? C.green : C.textDim, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  {pctRessuyage !== null ? `${pctRessuyage}%` : '—'}
                </div>
              </div>
            </div>
          </div>

          {/* Table tours */}
          <div style={{ background: C.card, border: `1.5px solid ${C.border}`, borderRadius: 12, overflow: 'hidden', marginBottom: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', borderBottom: `1px solid ${C.border}` }}>
              <div style={{ fontSize: 12, fontWeight: 630, color: C.textMuted, textTransform: 'uppercase' }}>Tours d'irrigation</div>
              <button onClick={addTour} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 12px', background: `${C.green}10`, border: `1.5px solid ${C.green}40`, borderRadius: 7, color: C.green, fontSize: 12, fontWeight: 630, fontFamily: 'inherit', cursor: 'pointer' }}>
                <Plus size={12} strokeWidth={2.5}/> Nouveau tour
              </button>
            </div>
            <div style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
              <table style={{ width: '100%', minWidth: 900, borderCollapse: 'collapse', fontFamily: 'inherit' }}>
                <thead>
                  <tr>
                    <THm w={36}>N°</THm>
                    <THm w={60}>Rad.</THm>
                    <THm w={68} color={C.blue}>∑Rad</THm>
                    <THm w={100}>Heure</THm>
                    <THm w={68} color={C.textMuted}>T.Repos</THm>
                    <THm w={60}>Dur.</THm>
                    <THm w={68}>V.Ap.</THm>
                    <THm w={60}>EC Ap.</THm>
                    <THm w={60}>pH Ap.</THm>
                    <THm w={60}>V.Dr.</THm>
                    <THm w={60}>EC Dr.</THm>
                    <THm w={60}>pH Dr.</THm>
                    <THm w={65} color={C.amber}>% Dr.</THm>
                    <THm w={70} color={C.amber}>Moy%</THm>
                    <THm w={32}></THm>
                  </tr>
                </thead>
                <tbody>
                  {tours.length === 0 ? (
                    <tr><td colSpan={15} style={{ padding: '24px 0', textAlign: 'center', color: C.textDim, fontSize: 12 }}>Aucun tour — cliquer sur Nouveau tour</td></tr>
                  ) : tours.map((t, i) => (
                    <tr key={t.id} style={{ borderBottom: i < tours.length-1 ? `1px solid ${C.border}` : 'none' }}>
                      <td style={{ padding: '4px 3px', textAlign: 'center' }}><div style={{ width: 24, height: 24, borderRadius: 6, margin: '0 auto', background: `${C.green}12`, border: `1px solid ${C.green}30`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 900, color: C.green }}>{t.num}</div></td>
                      <td style={{ padding: '4px 3px' }}><TInput value={t.rad} onChange={v => updateTour(t.id, 'rad', v)} C={C}/></td>
                      <td style={{ padding: '4px 3px', textAlign: 'center' }}><div style={{ fontSize: 12, fontWeight: 630, color: C.blue }}>{t.cumulRad > 0 ? fmtNum(t.cumulRad, 0) : '—'}</div></td>
                      <td style={{ padding: '4px 3px' }}><TimeInput value={t.heure} onChange={v => updateTour(t.id, 'heure', v)} C={C}/></td>
                      <td style={{ padding: '4px 3px', textAlign: 'center' }}><div style={{ fontSize: 12, fontWeight: 630, color: t.tempsRepos !== null ? C.textMuted : C.textDim }}>{t.tempsRepos !== null ? `${t.tempsRepos}m` : i === 0 ? '—' : '?'}</div></td>
                      <td style={{ padding: '4px 3px' }}><TInput value={t.duree} onChange={v => updateTour(t.id, 'duree', v)} C={C}/></td>
                      <td style={{ padding: '4px 3px' }}><TInput value={t.vApport} onChange={v => updateTour(t.id, 'vApport', v)} C={C}/></td>
                      <td style={{ padding: '4px 3px' }}><TInput value={t.ecApport} onChange={v => updateTour(t.id, 'ecApport', v)} C={C}/></td>
                      <td style={{ padding: '4px 3px' }}><TInput value={t.phApport} onChange={v => updateTour(t.id, 'phApport', v)} C={C}/></td>
                      <td style={{ padding: '4px 3px' }}><TInput value={t.vDrain} onChange={v => updateTour(t.id, 'vDrain', v)} C={C}/></td>
                      <td style={{ padding: '4px 3px' }}><TInput value={t.ecDrain} onChange={v => updateTour(t.id, 'ecDrain', v)} C={C}/></td>
                      <td style={{ padding: '4px 3px' }}><TInput value={t.phDrain} onChange={v => updateTour(t.id, 'phDrain', v)} C={C}/></td>
                      <td style={{ padding: '4px 3px', textAlign: 'center' }}><div style={{ fontSize: 12, fontWeight: 630, color: t.pctDrain != null ? C.amber : C.textDim }}>{t.pctDrain != null ? `${fmtNum(t.pctDrain, 1)}%` : '—'}</div></td>
                      <td style={{ padding: '4px 3px', textAlign: 'center' }}><div style={{ fontSize: 12, fontWeight: 630, color: t.moyPctDrain != null ? C.amber : C.textDim }}>{t.moyPctDrain != null ? `${fmtNum(t.moyPctDrain, 1)}%` : '—'}</div></td>
                      <td style={{ padding: '4px 3px', textAlign: 'center' }}><button onClick={() => deleteTourRow(t.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: C.textDim, padding: 3, borderRadius: 4 }} onMouseEnter={e => e.currentTarget.style.color = C.red} onMouseLeave={e => e.currentTarget.style.color = C.textDim}><Trash2 size={12} strokeWidth={2}/></button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div ref={tableBottomRef}/>
            </div>
          </div>

          {error && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', background: dark ? '#2a0a0a' : '#fef2f2', border: `1px solid ${C.red}30`, borderRadius: 8, color: C.red, fontSize: 12, marginBottom: 14 }}>
              <AlertCircle size={12} strokeWidth={2}/>{error}
            </div>
          )}

          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
            <button onClick={onClose} style={{ padding: '9px 20px', borderRadius: 8, border: `1.5px solid ${C.border}`, background: 'transparent', color: C.textMuted, fontSize: 12, fontWeight: 630, fontFamily: 'inherit', cursor: 'pointer' }}>Annuler</button>
            <button onClick={handleSave} disabled={saving} style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '9px 20px', background: saving ? C.toggleBg : C.green, color: saving ? C.textDim : '#fff', border: 'none', borderRadius: 8, fontSize: 12, fontWeight: 630, fontFamily: 'inherit', cursor: saving ? 'not-allowed' : 'pointer' }}>
              <Save size={12} strokeWidth={2.5}/>{saving ? 'Enregistrement…' : 'Enregistrer'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── ToursTable ────────────────────────────────────────────────
function ToursTable({ saisieId, token, C, dark }) {
  const [tours, setTours] = useState(null)
  useEffect(() => { getSaisie(token, saisieId).then(d => setTours(d.tours || [])).catch(() => setTours([])) }, [saisieId])

  if (tours === null) return (
    <tr><td colSpan={20} style={{ padding: '20px 16px', textAlign: 'center', color: C.textDim, fontSize: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
        <RefreshCw size={16} color={C.green} style={{ animation: 'az-pulse 1.2s ease-in-out infinite' }}/>Chargement…
      </div>
    </td></tr>
  )

  const TH2 = ({ children, color }) => (
    <th style={{ padding: '7px 8px', fontSize: 11, fontWeight: 630, textTransform: 'capitalize', color: color || C.textDim, textAlign: 'center', whiteSpace: 'nowrap', background: dark ? 'rgba(52,217,111,0.05)' : 'rgba(24,120,63,0.04)', borderBottom: `1px solid ${C.border}` }}>{children}</th>
  )

  return (
    <tr>
      <td colSpan={20} style={{ padding: 0 }}>
        <div style={{ margin: '0 0 0 32px', borderLeft: `3px solid ${C.green}30`, overflowX: 'auto' }}>
          <table style={{ width: '100%', minWidth: 900, borderCollapse: 'collapse', fontFamily: 'inherit' }}>
            <thead>
              <tr>
                <TH2>N° tour</TH2><TH2>Rad.</TH2><TH2 color={C.blue}>∑ Rad</TH2><TH2>Heure</TH2>
                <TH2>T.Repos</TH2><TH2>Durée</TH2><TH2>V.Apport</TH2><TH2>EC Ap.</TH2>
                <TH2>pH Ap.</TH2><TH2>V.Drain</TH2><TH2>EC Dr.</TH2><TH2>pH Dr.</TH2>
                <TH2 color={C.amber}>% Drain</TH2><TH2 color={C.amber}>% Drain moy</TH2>
              </tr>
            </thead>
            <tbody>
              {tours.length === 0 ? (
                <tr><td colSpan={14} style={{ padding: '16px', textAlign: 'center', color: C.textDim, fontSize: 12 }}>Aucun tour enregistré</td></tr>
              ) : tours.map((t, i) => (
                <tr key={t.id} style={{ borderBottom: i < tours.length-1 ? `1px solid ${C.border}` : 'none' }}
                  onMouseEnter={e => e.currentTarget.style.background = C.tableHover}
                  onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                >
                  <td style={{ padding: '8px', textAlign: 'center' }}><div style={{ width: 24, height: 24, borderRadius: 6, margin: '0 auto', background: `${C.green}12`, border: `1px solid ${C.green}30`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 630, color: C.green }}>{t.num_tour}</div></td>
                  {[
                    { v: t.rad, dec: 0 }, { v: t.cumul_rad, dec: 0, color: C.blue },
                    { v: t.heure, raw: true }, { v: t.temps_repos !== null ? `${t.temps_repos} min` : '—', raw: true, color: C.textMuted },
                    { v: t.duree_min, dec: 0 }, { v: t.v_apport, dec: 1 }, { v: t.ec_apport, dec: 2 }, { v: t.ph_apport, dec: 2 },
                    { v: t.v_drain, dec: 1 }, { v: t.ec_drain, dec: 2 }, { v: t.ph_drain, dec: 2 },
                    { v: t.pct_drain != null ? `${fmtNum(t.pct_drain, 1)}%` : '—', raw: true, color: C.amber },
                    { v: t.moy_pct_drain != null ? `${fmtNum(t.moy_pct_drain, 1)}%` : '—', raw: true, color: C.amber },
                  ].map((cell, ci) => (
                    <td key={ci} style={{ padding: '8px', textAlign: 'center', fontSize: 12, fontWeight: 630, color: cell.color || C.text }}>
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
  )
}

// ── Main HistoriquePage ───────────────────────────────────────
export default function HistoriquePage({ token, auth, C, dark, isMobile = false, isTablet = false }) {
  const [saisies, setSaisies] = useState([])
  const [total, setTotal] = useState(0)
  const [pages, setPages] = useState(1)
  const [page, setPage] = useState(1)
  const [perPage, setPerPage] = useState(10)
  const [loading, setLoading] = useState(false)
  const [farms, setFarms] = useState([])
  const [expandedIds, setExpandedIds] = useState(new Set())
  const [editingSaisie, setEditingSaisie] = useState(null)
  const [confirmDelete, setConfirmDelete] = useState(null)
  const [showExport, setShowExport] = useState(false)

  // Filtres
  const [fDate, setFDate] = useState('')
  const [fFerme, setFFerme] = useState('')
  const [fStation, setFStation] = useState('')
  const [fSerre, setFSerre] = useState('')
  const [fVanne, setFVanne] = useState('')
  const [fNbrBras, setFNbrBras] = useState('')
  const [fNbrGoutt, setFNbrGoutt] = useState('')
  const [fPoidsMat, setFPoidsMat] = useState('')
  const [fHeureMat, setFHeureMat] = useState('')
  const [fPoidsSoir, setFPoidsSoir] = useState('')
  const [fHeureSoir, setFHeureSoir] = useState('')
  const [fBassin, setFBassin] = useState('')

  const resetFilters = () => { setFDate(''); setFFerme(''); setFStation(''); setFSerre(''); setFVanne(''); setFNbrBras(''); setFNbrGoutt(''); setFPoidsMat(''); setFHeureMat(''); setFPoidsSoir(''); setFHeureSoir(''); setFBassin('') }
  const hasFilters = !!(fDate || fFerme || fStation || fSerre || fVanne || fNbrBras || fNbrGoutt || fPoidsMat || fHeureMat || fPoidsSoir || fHeureSoir || fBassin)

  useEffect(() => { getDevices(token).then(setFarms).catch(() => {}) }, [token])

  const [allowedFarms, setAllowedFarms] = useState(undefined)
  const allowedFarmsRef = useRef(undefined)
  useEffect(() => {
    if (!auth) return
    getMe(token).then(me => {
      if ((me.role || auth.role) === 'admin') { setAllowedFarms(null); allowedFarmsRef.current = null }
      else { setAllowedFarms(Array.isArray(me.farm_names) ? me.farm_names : []); allowedFarmsRef.current = Array.isArray(me.farm_names) ? me.farm_names : [] }
    }).catch(() => {
      if (auth.role === 'admin') { setAllowedFarms(null); allowedFarmsRef.current = null }
      else { const fb = Array.isArray(auth.farm_names) ? auth.farm_names : []; setAllowedFarms(fb); allowedFarmsRef.current = fb }
    })
  }, [token])

  const load = async (p = 1) => {
    const currentAllowedFarms = auth?.role === 'admin' ? null : (auth?.farm_names ?? undefined)
    if (currentAllowedFarms === undefined) { setLoading(false); return }
    setLoading(true)
    try {
      if (currentAllowedFarms !== null && currentAllowedFarms.length === 0) { setSaisies([]); setTotal(0); setPages(1); setPage(1); setLoading(false); return }
      const params = { page: p, perPage }
      if (fDate) { params.dateFrom = fDate; params.dateTo = fDate }
      if (fFerme) params.farmName = fFerme
      else if (currentAllowedFarms !== null && currentAllowedFarms.length === 1) params.farmName = currentAllowedFarms[0]
      const data = await getSaisies(token, params)
      let rows = data.data || []
      if (currentAllowedFarms !== null && currentAllowedFarms.length > 0) rows = rows.filter(s => currentAllowedFarms.includes(s.farm_name))
      setSaisies(rows); setTotal(data.total ?? rows.length); setPages(Math.max(1, data.pages ?? Math.ceil(rows.length / perPage))); setPage(p)
    } catch { setSaisies([]) }
    finally { setLoading(false) }
  }

  useEffect(() => { const af = allowedFarmsRef.current; if (af !== undefined) load(1, af) }, [allowedFarms, fFerme, fDate, auth, perPage])

  const filtered = saisies.filter(s =>
    (!fStation || String(s.station||'').toLowerCase().includes(fStation.toLowerCase())) &&
    (!fSerre || String(s.serre||'').toLowerCase().includes(fSerre.toLowerCase())) &&
    (!fVanne || String(s.vanne||'').toLowerCase().includes(fVanne.toLowerCase())) &&
    (!fNbrBras || String(s.nbr_bras||'').includes(fNbrBras)) &&
    (!fNbrGoutt || String(s.nbr_goutteurs||'').includes(fNbrGoutt)) &&
    (!fPoidsMat || String(s.poids_matin||'').includes(fPoidsMat)) &&
    (!fHeureMat || String(s.heure_matin||'').includes(fHeureMat)) &&
    (!fPoidsSoir || String(s.poids_soir||'').includes(fPoidsSoir)) &&
    (!fHeureSoir || String(s.heure_soir||'').includes(fHeureSoir)) &&
    (!fBassin || String(s.bassin_ec||'').includes(fBassin))
  )

  const toggleExpand = (id) => setExpandedIds(prev => { const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next })
  const handleDelete = async () => {
    if (!confirmDelete) return
    try { await deleteSaisie(token, confirmDelete.id); setConfirmDelete(null); load(page) }
    catch (e) { alert(e.message) }
  }

  const isAdmin = auth?.role === 'admin'
  const userFarms = auth?.farm_names || []
  const fermeOptions = farms.filter(f => isAdmin || userFarms.includes(f.farm_name)).map(f => ({ value: f.farm_name, label: f.farm_name }))
  const selectedFilterFarm = farms.find(f => f.farm_name === fFerme)
  const stationFilterOptions = fFerme && selectedFilterFarm
    ? [...new Set((selectedFilterFarm.houses||[]).map(h => h.house_number))].map(v => ({ value: v, label: `Station ${v}` }))
    : [...new Set(farms.flatMap(f => (f.houses||[]).map(h => h.house_number)))].map(v => ({ value: v, label: `Station ${v}` }))
  const serreFilterOptions = Array.from({ length: 20 }, (_, i) => ({ value: `S${String(i+1).padStart(2,'0')}`, label: `S${String(i+1).padStart(2,'0')}` }))

  const TH = ({ children, color, w, center = false }) => (
    <th style={{ padding: '11px 8px', textAlign: center ? 'center' : 'left', fontSize: 11, fontWeight: 630, textTransform: 'uppercase', letterSpacing: '0em', color: color || C.textDim, whiteSpace: 'nowrap', borderBottom: `1.5px solid ${C.border}`, background: C.card, userSelect: 'none', width: w }}>{children}</th>
  )

  return (
    <>
      {confirmDelete && <ConfirmModal saisie={confirmDelete} onConfirm={handleDelete} onCancel={() => setConfirmDelete(null)} C={C}/>}
      {showExport && <ExportModal token={token} auth={auth} farms={farms} C={C} dark={dark} onClose={() => setShowExport(false)}/>}
      {editingSaisie && <EditModal saisie={editingSaisie} token={token} farms={farms} onSaved={() => load(page)} onClose={() => setEditingSaisie(null)} C={C} dark={dark} isMobile={isMobile}/>}

      <div style={{ animation: 'az-fade-in 0.3s ease both' }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24, flexWrap: 'wrap', gap: 12 }}>
          <div>
            <h1 style={{ color: C.text, fontSize: isMobile ? 18 : 22, fontWeight: 900, marginBottom: 4, display: 'flex', alignItems: 'center', gap: 10 }}>
              <History size={isMobile ? 18 : 22} color={C.green} strokeWidth={2}/>
              Historique
            </h1>
            <p style={{ fontSize: 11, color: C.textDim }}>{total} saisie{total > 1 ? 's' : ''} enregistrée{total > 1 ? 's' : ''}</p>
          </div>
          <button onClick={() => setShowExport(true)} style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '8px 16px', borderRadius: 9, background: C.toggleBg, border: `1px solid ${dark ? '#1c2e22' : '#c0d8c8'}`, color: C.green, fontSize: 12, fontWeight: 630, fontFamily: 'inherit', cursor: 'pointer' }}>
            <Download size={14} strokeWidth={2.5}/>
            {!isMobile && 'Export Excel'}
          </button>
        </div>

        {/* Table */}
        <div style={{ background: C.card, border: `1.5px solid ${C.border}`, borderRadius: 14, overflow: 'visible' }}>
          <div style={{ overflowX: 'auto', overflowY: 'visible', WebkitOverflowScrolling: 'touch', borderRadius: 14 }}>
            <table style={{ width: '100%', minWidth: isMobile ? 700 : 1100, borderCollapse: 'collapse', fontFamily: 'inherit' }}>
              <thead>
                <tr>
                  <TH w={44} center>Voir</TH>
                  <TH w={100} center>Date</TH>
                  <TH w={80} center>Ferme</TH>
                  {!isMobile && <><TH w={70} center>Station</TH><TH w={70} center>Serre</TH><TH w={60} center>Vanne</TH></>}
                  <TH w={60} center>Bras</TH>
                  <TH w={60} center>Gout.</TH>
                  {!isMobile && <><TH w={70} center>Pds Mat.</TH><TH w={65} center>H. Mat.</TH><TH w={70} center>Pds Soir</TH><TH w={65} center>H. Soir</TH><TH w={70} center>Bassin EC</TH></>}
                  <TH w={70} center color={C.green}>Séchage %</TH>
                  <TH w={80} center>Actions</TH>
                </tr>
                {/* Filtres */}
                <tr style={{ background: C.card, borderBottom: `1.5px solid ${C.border}` }}>
                  <th style={{ padding: '4px 6px' }}/>
                  <th style={{ padding: '5px 6px', overflow: 'visible', position: 'relative' }}><CalendarPicker value={fDate} onChange={setFDate} C={C} small/></th>
                  <th style={{ padding: '5px 6px' }}><FilterSelect value={fFerme} onChange={v => { setFFerme(v); setFStation('') }} options={fermeOptions} C={C}/></th>
                  {!isMobile && <>
                    <th style={{ padding: '5px 6px' }}><FilterSelect value={fStation} onChange={setFStation} options={stationFilterOptions} C={C}/></th>
                    <th style={{ padding: '5px 6px' }}><FilterSelect value={fSerre} onChange={setFSerre} options={serreFilterOptions} C={C}/></th>
                    <th style={{ padding: '5px 6px' }}><FilterInput value={fVanne} onChange={setFVanne} C={C}/></th>
                  </>}
                  <th style={{ padding: '5px 6px' }}><FilterInput value={fNbrBras} onChange={setFNbrBras} C={C}/></th>
                  <th style={{ padding: '5px 6px' }}><FilterInput value={fNbrGoutt} onChange={setFNbrGoutt} C={C}/></th>
                  {!isMobile && <>
                    <th style={{ padding: '5px 6px' }}><FilterInput value={fPoidsMat} onChange={setFPoidsMat} C={C}/></th>
                    <th style={{ padding: '5px 6px' }}><TimeInput value={fHeureMat} onChange={setFHeureMat} C={C} small/></th>
                    <th style={{ padding: '5px 6px' }}><FilterInput value={fPoidsSoir} onChange={setFPoidsSoir} C={C}/></th>
                    <th style={{ padding: '5px 6px' }}><TimeInput value={fHeureSoir} onChange={setFHeureSoir} C={C} small/></th>
                    <th style={{ padding: '5px 6px' }}><FilterInput value={fBassin} onChange={setFBassin} C={C}/></th>
                  </>}
                  <th colSpan={2} style={{ padding: '5px 8px', textAlign: 'center' }}>
                    <button onClick={resetFilters} style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '5px 8px', borderRadius: 6, cursor: hasFilters ? 'pointer' : 'default', background: hasFilters ? `${C.red}10` : C.toggleBg, border: `1.5px solid ${hasFilters ? C.red + '35' : C.border}`, color: hasFilters ? C.red : C.textDim, height: 28, fontSize: 11, fontWeight: 630, fontFamily: 'inherit', whiteSpace: 'nowrap', opacity: hasFilters ? 1 : 0.4, transition: 'all 0.15s', margin: '0 auto', pointerEvents: hasFilters ? 'auto' : 'none' }}>
                      <X size={11} strokeWidth={2.5}/> {!isMobile && 'Réinitialiser'}
                    </button>
                  </th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={20} style={{ padding: '48px 0', textAlign: 'center', color: C.textDim, fontSize: 12 }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
                      <RefreshCw size={16} color={C.green} style={{ animation: 'az-pulse 1.2s ease-in-out infinite' }}/>Chargement…
                    </div>
                  </td></tr>
                ) : filtered.length === 0 ? (
                  <tr><td colSpan={20} style={{ padding: '48px 0', textAlign: 'center', color: C.textDim, fontSize: 12 }}>Aucune saisie trouvée</td></tr>
                ) : filtered.map(s => {
                  const expanded = expandedIds.has(s.id)
                  return (
                    <React.Fragment key={s.id}>
                      <tr style={{ borderBottom: `1px solid ${C.border}`, transition: 'background 0.15s' }}
                        onMouseEnter={e => e.currentTarget.style.background = C.tableHover}
                        onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                      >
                        <td style={{ textAlign: 'center', padding: '10px 6px' }}>
                          <button onClick={() => toggleExpand(s.id)} style={{ background: expanded ? `${C.green}15` : 'transparent', border: `1.5px solid ${expanded ? C.green + '50' : C.border}`, borderRadius: 6, padding: '5px 5px', cursor: 'pointer', color: expanded ? C.green : C.textMuted, display: 'flex', alignItems: 'center', margin: '0 auto', transition: 'all 0.15s' }}>
                            {expanded ? <ChevronUp size={11} strokeWidth={2.5}/> : <ChevronDown size={11} strokeWidth={2.5}/>}
                          </button>
                        </td>
                        <td style={{ padding: '10px 8px', fontWeight: 630, color: C.text, fontSize: 11, textAlign: 'center', whiteSpace: 'nowrap' }}>{s.date}</td>
                        <td style={{ padding: '10px 8px', fontSize: 11, textAlign: 'center', color: C.green, fontWeight: 630 }}>{s.farm_name}</td>
                        {!isMobile && <>
                          <td style={{ padding: '10px 8px', fontSize: 11, textAlign: 'center' }}><span style={{ background: dark ? 'rgba(77,157,224,0.12)' : 'rgba(77,157,224,0.10)', color: '#4d9de0', border: '1px solid rgba(77,157,224,0.25)', borderRadius: 5, padding: '2px 7px', fontSize: 11, fontWeight: 630 }}>{s.station || '—'}</span></td>
                          <td style={{ padding: '10px 8px', fontSize: 11, textAlign: 'center' }}><span style={{ background: dark ? 'rgba(52,217,111,0.08)' : 'rgba(24,120,63,0.07)', color: C.green, border: `1px solid ${C.green}25`, borderRadius: 5, padding: '2px 7px', fontSize: 11, fontWeight: 630 }}>{s.serre || '—'}</span></td>
                          <td style={{ padding: '10px 8px', fontSize: 11, textAlign: 'center', color: C.text, fontWeight: 630 }}>{s.vanne || '—'}</td>
                        </>}
                        <td style={{ padding: '10px 8px', fontSize: 11, textAlign: 'center', color: C.text, fontWeight: 630 }}>{s.nbr_bras ?? '—'}</td>
                        <td style={{ padding: '10px 8px', fontSize: 11, textAlign: 'center', color: C.text, fontWeight: 630 }}>{s.nbr_goutteurs ?? '—'}</td>
                        {!isMobile && <>
                          <td style={{ padding: '10px 8px', fontSize: 11, textAlign: 'center', color: C.text, fontWeight: 630 }}>{s.poids_matin ?? '—'}</td>
                          <td style={{ padding: '10px 8px', fontSize: 11, textAlign: 'center', color: C.text, fontWeight: 630 }}>{s.heure_matin || '—'}</td>
                          <td style={{ padding: '10px 8px', fontSize: 11, textAlign: 'center', color: C.text, fontWeight: 630 }}>{s.poids_soir ?? '—'}</td>
                          <td style={{ padding: '10px 8px', fontSize: 11, textAlign: 'center', color: C.text, fontWeight: 630 }}>{s.heure_soir || '—'}</td>
                          <td style={{ padding: '10px 8px', fontSize: 11, textAlign: 'center', color: C.text, fontWeight: 630 }}>{s.bassin_ec ?? '—'}</td>
                        </>}
                        <td style={{ padding: '10px 6px', textAlign: 'center' }}>
                          {s.pct_ressuyage != null ? (
                            <span style={{ display: 'inline-block', background: `${C.green}15`, color: C.green, border: `1px solid ${C.green}35`, borderRadius: 20, padding: '2px 8px', fontSize: 11, fontWeight: 630 }}>{fmtNum(s.pct_ressuyage, 1)}%</span>
                          ) : <span style={{ color: C.textDim, fontSize: 11 }}>—</span>}
                        </td>
                        <td style={{ padding: '10px 6px' }}>
                          <div style={{ display: 'flex', gap: 5, alignItems: 'center' }}>
                            <button onClick={e => { e.stopPropagation(); setEditingSaisie(s) }} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 26, height: 26, borderRadius: 6, border: `1.5px solid ${C.border}`, background: 'transparent', color: C.textMuted, cursor: 'pointer', transition: 'all 0.13s' }}
                              onMouseEnter={e => { e.currentTarget.style.borderColor = C.green; e.currentTarget.style.color = C.green; e.currentTarget.style.background = `${C.green}08` }}
                              onMouseLeave={e => { e.currentTarget.style.borderColor = C.border; e.currentTarget.style.color = C.textMuted; e.currentTarget.style.background = 'transparent' }}>
                              <SquarePen size={11} strokeWidth={2}/>
                            </button>
                            <button onClick={e => { e.stopPropagation(); setConfirmDelete(s) }} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 26, height: 26, borderRadius: 6, border: `1.5px solid ${C.border}`, background: 'transparent', color: C.textMuted, cursor: 'pointer', transition: 'all 0.13s' }}
                              onMouseEnter={e => { e.currentTarget.style.borderColor = C.red; e.currentTarget.style.color = C.red; e.currentTarget.style.background = `${C.red}08` }}
                              onMouseLeave={e => { e.currentTarget.style.borderColor = C.border; e.currentTarget.style.color = C.textMuted; e.currentTarget.style.background = 'transparent' }}>
                              <Trash2 size={11} strokeWidth={2}/>
                            </button>
                          </div>
                        </td>
                      </tr>
                      {expanded && <ToursTable saisieId={s.id} token={token} C={C} dark={dark}/>}
                    </React.Fragment>
                  )
                })}
              </tbody>
            </table>
          </div>

          {/* Footer pagination */}
          <div style={{ padding: '10px 14px', borderTop: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <SSelect value={perPage} onChange={v => setPerPage(Number(v))} options={[{value:10,label:'10'},{value:20,label:'20'},{value:50,label:'50'}]} C={C} width={64}/>
              <span style={{ fontSize: 12, color: C.textDim, fontWeight: 600 }}>/ page</span>
              {!isMobile && (
                <><span style={{ width: 1, height: 14, background: C.border, display: 'inline-block', margin: '0 4px' }}/>
                <span style={{ fontSize: 12, color: C.textDim }}><span style={{ fontWeight: 700, color: C.text }}>{total}</span> saisie{total > 1 ? 's' : ''}</span></>
              )}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <button onClick={() => load(1)} disabled={page <= 1} style={{ display: 'flex', alignItems: 'center', padding: '5px 7px', borderRadius: 6, border: `1.5px solid ${C.border}`, background: 'transparent', color: C.textMuted, cursor: page <= 1 ? 'not-allowed' : 'pointer', opacity: page <= 1 ? 0.3 : 1, fontFamily: 'inherit' }}>
                <ChevronLeft size={10} strokeWidth={2.5}/><ChevronLeft size={10} strokeWidth={2.5}/>
              </button>
              <button onClick={() => load(page-1)} disabled={page <= 1} style={{ display: 'flex', alignItems: 'center', gap: 3, padding: '5px 9px', borderRadius: 6, border: `1.5px solid ${C.border}`, background: 'transparent', color: C.textMuted, fontSize: 12, fontWeight: 630, cursor: page <= 1 ? 'not-allowed' : 'pointer', opacity: page <= 1 ? 0.3 : 1, fontFamily: 'inherit' }}>
                <ChevronLeft size={12} strokeWidth={2}/> {!isMobile && 'Préc'}
              </button>
              <div style={{ display: 'flex', gap: 4 }}>
                {Array.from({ length: Math.min(pages, isMobile ? 3 : 5) }, (_, i) => {
                  let p
                  if (pages <= (isMobile ? 3 : 5)) p = i + 1
                  else if (page <= 2) p = i + 1
                  else if (page >= pages - 1) p = pages - (isMobile ? 2 : 4) + i
                  else p = page - 1 + i
                  return (
                    <button key={p} onClick={() => load(p)} style={{ width: 30, height: 30, borderRadius: 7, border: `1.5px solid ${page === p ? C.green : C.border}`, background: page === p ? C.green : 'transparent', color: page === p ? '#fff' : C.textMuted, fontSize: 12, fontWeight: page === p ? 800 : 630, fontFamily: 'inherit', cursor: 'pointer' }}>{p}</button>
                  )
                })}
              </div>
              <button onClick={() => load(page+1)} disabled={page >= pages} style={{ display: 'flex', alignItems: 'center', gap: 3, padding: '5px 9px', borderRadius: 6, border: `1.5px solid ${C.border}`, background: 'transparent', color: C.textMuted, fontSize: 12, fontWeight: 630, cursor: page >= pages ? 'not-allowed' : 'pointer', opacity: page >= pages ? 0.3 : 1, fontFamily: 'inherit' }}>
                {!isMobile && 'Suiv'} <ChevronRight size={12} strokeWidth={2}/>
              </button>
              <button onClick={() => load(pages)} disabled={page >= pages} style={{ display: 'flex', alignItems: 'center', padding: '5px 7px', borderRadius: 6, border: `1.5px solid ${C.border}`, background: 'transparent', color: C.textMuted, cursor: page >= pages ? 'not-allowed' : 'pointer', opacity: page >= pages ? 0.3 : 1, fontFamily: 'inherit' }}>
                <ChevronRight size={10} strokeWidth={2.5}/><ChevronRight size={10} strokeWidth={2.5}/>
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  )
}
