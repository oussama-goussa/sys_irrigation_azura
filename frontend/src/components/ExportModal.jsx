// ============================================================
// frontend/src/components/ExportModal.jsx
// Modal export Excel — sélection fermes + période
// ============================================================

import React, { useState, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { X, Download, ChevronLeft, ChevronRight, ChevronDown, Check, AlertCircle } from 'lucide-react'

const MONTHS_FR = ['Janvier','Février','Mars','Avril','Mai','Juin','Juillet','Août','Septembre','Octobre','Novembre','Décembre']
const DAYS_FR   = ['Lu','Ma','Me','Je','Ve','Sa','Di']

// ── Range Calendar ────────────────────────────────────────────
function RangeCalendar({ dateFrom, dateTo, onChangeFrom, onChangeTo, C }) {
  const today = new Date()
  const [leftYear,  setLeftYear]  = useState(today.getFullYear())
  const [leftMonth, setLeftMonth] = useState(today.getMonth())
  const [hovering,  setHovering]  = useState(null)

  const rightMonth = leftMonth === 11 ? 0 : leftMonth + 1
  const rightYear  = leftMonth === 11 ? leftYear + 1 : leftYear

  const prevLeft = () => {
    if (leftMonth === 0) { setLeftMonth(11); setLeftYear(y => y - 1) }
    else setLeftMonth(m => m - 1)
  }
  const nextLeft = () => {
    if (leftMonth === 11) { setLeftMonth(0); setLeftYear(y => y + 1) }
    else setLeftMonth(m => m + 1)
  }

  const todayStr = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`

  const handleDay = (dateStr) => {
    if (!dateFrom || (dateFrom && dateTo)) {
      onChangeFrom(dateStr)
      onChangeTo('')
    } else {
      if (dateStr < dateFrom) {
        onChangeTo(dateFrom)
        onChangeFrom(dateStr)
      } else {
        onChangeTo(dateStr)
      }
    }
  }

  const isInRange = (dateStr) => {
    const end = dateTo || hovering
    if (!dateFrom || !end) return false
    const lo = dateFrom < end ? dateFrom : end
    const hi = dateFrom < end ? end : dateFrom
    return dateStr > lo && dateStr < hi
  }

  const isStart = (dateStr) => dateStr === dateFrom
  const isEnd   = (dateStr) => dateStr === dateTo

  const buildCells = (year, month) => {
    let startDow = new Date(year, month, 1).getDay() - 1
    if (startDow < 0) startDow = 6
    const daysInMonth = new Date(year, month + 1, 0).getDate()
    const daysInPrev  = new Date(year, month, 0).getDate()
    const cells = []
    for (let i = 0; i < startDow; i++)
      cells.push({ day: daysInPrev - startDow + 1 + i, curr: false })
    for (let i = 1; i <= daysInMonth; i++)
      cells.push({ day: i, curr: true })
    while (cells.length % 7 !== 0)
      cells.push({ day: cells.length - startDow - daysInMonth + 1, curr: false })
    return cells
  }

  const MonthGrid = ({ year, month }) => {
    const cells = buildCells(year, month)
    return (
      <div style={{ flex: 1 }}>
        <div style={{ textAlign: 'center', fontWeight: 800, fontSize: 13,
          color: C.text, marginBottom: 10 }}>
          {MONTHS_FR[month]} {year}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', marginBottom: 4 }}>
          {DAYS_FR.map(d => (
            <div key={d} style={{ textAlign: 'center', fontSize: 9, fontWeight: 700,
              color: C.textDim, padding: '2px 0', textTransform: 'uppercase' }}>{d}</div>
          ))}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', gap: '2px 0' }}>
          {cells.map((cell, i) => {
            if (!cell.curr) return <div key={i} />
            const ds = `${year}-${String(month+1).padStart(2,'0')}-${String(cell.day).padStart(2,'0')}`
            const start   = isStart(ds)
            const end     = isEnd(ds)
            const inRange = isInRange(ds)
            const isT     = ds === todayStr
            return (
              <div key={i}
                onClick={() => handleDay(ds)}
                onMouseEnter={() => dateFrom && !dateTo && setHovering(ds)}
                onMouseLeave={() => setHovering(null)}
                style={{
                  textAlign: 'center', fontSize: 11, padding: '6px 0',
                  cursor: 'pointer',
                  background: start || end
                    ? C.green
                    : inRange ? `${C.green}25` : 'transparent',
                  color: start || end ? '#fff' : isT ? C.green : C.text,
                  fontWeight: start || end ? 800 : isT ? 700 : 400,
                  borderRadius: start ? '6px 0 0 6px' : end ? '0 6px 6px 0' : inRange ? 0 : 6,
                  transition: 'background 0.1s',
                  position: 'relative',
                }}
              >
                {isT && !start && !end && (
                  <span style={{ position: 'absolute', bottom: 1, left: '50%',
                    transform: 'translateX(-50%)', width: 3, height: 3,
                    borderRadius: '50%', background: C.green }} />
                )}
                {cell.day}
              </div>
            )
          })}
        </div>
      </div>
    )
  }

  return (
    <div>
      {/* Navigation */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <button onClick={prevLeft} style={{ background: 'none', border: 'none',
          cursor: 'pointer', color: C.textMuted, padding: '4px 8px',
          borderRadius: 6, display: 'flex', alignItems: 'center' }}>
          <ChevronLeft size={16} strokeWidth={2.5} />
        </button>
        <div style={{ display: 'flex', gap: 32, flex: 1, justifyContent: 'space-around' }}>
          <MonthGrid year={leftYear}  month={leftMonth} />
          <div style={{ width: 1, background: C.border }} />
          <MonthGrid year={rightYear} month={rightMonth} />
        </div>
        <button onClick={nextLeft} style={{ background: 'none', border: 'none',
          cursor: 'pointer', color: C.textMuted, padding: '4px 8px',
          borderRadius: 6, display: 'flex', alignItems: 'center' }}>
          <ChevronRight size={16} strokeWidth={2.5} />
        </button>
      </div>

      {/* Quick shortcuts */}
      <div style={{ display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap' }}>
        {[
          { label: "Aujourd'hui", action: () => { const t = todayStr; onChangeFrom(t); onChangeTo(t) } },
          { label: '7 derniers jours', action: () => {
            const t = new Date(); const f = new Date(); f.setDate(f.getDate() - 6)
            const fmt = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
            onChangeFrom(fmt(f)); onChangeTo(fmt(t))
          }},
          { label: 'Ce mois', action: () => {
            const t = new Date()
            const from = `${t.getFullYear()}-${String(t.getMonth()+1).padStart(2,'0')}-01`
            const to = `${t.getFullYear()}-${String(t.getMonth()+1).padStart(2,'0')}-${String(new Date(t.getFullYear(), t.getMonth()+1, 0).getDate()).padStart(2,'0')}`
            onChangeFrom(from); onChangeTo(to)
          }},
          { label: 'Tout effacer', action: () => { onChangeFrom(''); onChangeTo('') } },
        ].map(s => (
          <button key={s.label} onClick={s.action}
            style={{ padding: '4px 12px', borderRadius: 6,
              border: `1px solid ${C.border}`, background: 'transparent',
              color: C.textMuted, fontSize: 11, fontWeight: 600,
              fontFamily: 'inherit', cursor: 'pointer' }}>
            {s.label}
          </button>
        ))}
      </div>
    </div>
  )
}

// ── Main ExportModal ──────────────────────────────────────────
export default function ExportModal({ token, auth, farms, C, dark, onClose }) {
  const [selectedFarms, setSelectedFarms] = useState([])
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo,   setDateTo]   = useState('')
  const [exporting, setExporting] = useState(false)
  const [error, setError] = useState('')
  const [showCal, setShowCal] = useState(false)

  // Fermes autorisées
  const isAdmin = auth?.role === 'admin'
  const allowedFarms = isAdmin
    ? farms.map(f => f.farm_name)
    : (auth?.farm_names || [])

  const toggleFarm = (name) => {
    setSelectedFarms(prev =>
      prev.includes(name) ? prev.filter(x => x !== name) : [...prev, name]
    )
  }

  const fmtDisplay = (d) => d
    ? new Date(d + 'T00:00:00').toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' })
    : '—'

  const canExport = selectedFarms.length > 0 && dateFrom && dateTo

  const handleExport = async () => {
    if (!canExport) return
    setExporting(true)
    setError('')
    try {
      const params = new URLSearchParams({
        farm_names: selectedFarms.join(','),
        date_from: dateFrom,
        date_to: dateTo,
      })
      const res = await fetch(`/api/export/saisie?${params}`, {
        headers: { Authorization: `Bearer ${token}` }
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.detail || `Erreur ${res.status}`)
      }
      const blob = await res.blob()
      const url  = URL.createObjectURL(blob)
      const a    = document.createElement('a')
      a.href     = url
      a.download = `suivi_irrigation_${dateFrom}_${dateTo}.xlsx`
      a.click()
      URL.revokeObjectURL(url)
      onClose()
    } catch (e) {
      setError(e.message)
    } finally {
      setExporting(false)
    }
  }

  return createPortal(
    <div style={{
      position: 'fixed', inset: 0, zIndex: 99999,
      background: 'rgba(0,0,0,0.70)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: 24,
    }}>
      <div style={{
        background: C.card, border: `1.5px solid ${C.border}`,
        borderRadius: 18, width: '100%', maxWidth: 820,
        boxShadow: '0 24px 80px rgba(0,0,0,0.5)',
        maxHeight: '92vh', overflowY: 'auto',
      }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '20px 28px', borderBottom: `1px solid ${C.border}` }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 36, height: 36, borderRadius: 10,
              background: `${C.green}15`, border: `1.5px solid ${C.green}30`,
              display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <Download size={18} color={C.green} strokeWidth={2} />
            </div>
            <div>
              <div style={{ fontSize: 15, fontWeight: 800, color: C.text }}>
                Export Excel — Suivi d'irrigation
              </div>
              <div style={{ fontSize: 11, color: C.textDim, marginTop: 2 }}>
                Sélectionnez les fermes et la période à exporter
              </div>
            </div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none',
            cursor: 'pointer', color: C.textDim, padding: 4 }}>
            <X size={18} strokeWidth={2} />
          </button>
        </div>

        <div style={{ padding: '24px 28px' }}>

          {/* Sélection fermes */}
          <div style={{ marginBottom: 24 }}>
          <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase',
              letterSpacing: '0.1em', color: C.textMuted, marginBottom: 10 }}>
              Fermes à exporter
          </div>
          <select
              value={selectedFarms[0] || ''}
              onChange={e => setSelectedFarms(e.target.value ? [e.target.value] : [])}
              style={{
              width: '100%', padding: '9px 13px', borderRadius: 8,
              border: `1.5px solid ${selectedFarms.length ? C.green : C.border}`,
              background: C.inputBg, color: selectedFarms.length ? C.text : C.textDim,
              fontSize: 13, fontFamily: 'inherit', outline: 'none', cursor: 'pointer',
              }}
          >
            <option value=''>Sélectionner une ferme…</option>
            {allowedFarms.map(name => (
            <option key={name} value={name}>{name}</option>
            ))}
        </select>
        </div>

          {/* Période */}
          <div style={{ marginBottom: 20, position: 'relative' }}>
          <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase',
              letterSpacing: '0.1em', color: C.textMuted, marginBottom: 10 }}>
              Période
          </div>
  
          {/* Input cliquable */}
          <div
              onClick={() => setShowCal(v => !v)}
              style={{
              display: 'flex', alignItems: 'center', gap: 12,
              padding: '9px 14px', borderRadius: 8, cursor: 'pointer',
              border: `1.5px solid ${showCal ? C.green : (dateFrom ? C.green : C.border)}`,
              background: C.inputBg, transition: 'border-color 0.15s',
              }}
          >
              <span style={{ fontSize: 13, fontWeight: 700,
              color: dateFrom ? C.green : C.textDim, minWidth: 120, textAlign: 'center' }}>
              {dateFrom ? fmtDisplay(dateFrom) : 'Date début'}
              </span>
              <span style={{ color: C.textDim }}>→</span>
              <span style={{ fontSize: 13, fontWeight: 700,
              color: dateTo ? C.green : C.textDim, minWidth: 120, textAlign: 'center' }}>
              {dateTo ? fmtDisplay(dateTo) : 'Date fin'}
              </span>
              {dateFrom && dateTo && (
              <span style={{ fontSize: 11, color: C.textDim, marginLeft: 'auto' }}>
                  {Math.round((new Date(dateTo) - new Date(dateFrom)) / 86400000) + 1} jours
              </span>
              )}
          </div>

          {/* Popover calendrier */}
          {showCal && (
              <div style={{
              position: 'absolute', top: 'calc(100% + 6px)', left: 0, right: 0,
              border: `1.5px solid ${C.border}`, borderRadius: 12,
              padding: '16px 20px', background: dark ? C.surface : '#fafcfb',
              boxShadow: `0 8px 32px ${C.shadow}`, zIndex: 999,
              }}>
              <RangeCalendar
                  dateFrom={dateFrom} dateTo={dateTo}
                  onChangeFrom={setDateFrom}
                  onChangeTo={(d) => { setDateTo(d); if (d) setShowCal(false) }}
                  C={C}
              />
              </div>
          )}
          </div>

          {/* Résumé export */}
          {canExport && (
            <div style={{
              padding: '12px 16px', borderRadius: 10,
              background: `${C.green}08`, border: `1px solid ${C.green}25`,
              fontSize: 12, color: C.textMuted, marginBottom: 16,
            }}>
              Export : <strong style={{ color: C.green }}>{selectedFarms.join(', ')}</strong>
              {' '}du <strong style={{ color: C.text }}>{fmtDisplay(dateFrom)}</strong>
              {' '}au <strong style={{ color: C.text }}>{fmtDisplay(dateTo)}</strong>
            </div>
          )}

          {/* Error */}
          {error && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8,
              padding: '10px 14px', borderRadius: 8,
              background: dark ? '#2a0a0a' : '#fef2f2',
              border: `1px solid ${C.red}30`,
              color: C.red, fontSize: 12, marginBottom: 16 }}>
              <AlertCircle size={14} strokeWidth={2} />
              {error}
            </div>
          )}

          {/* Boutons */}
          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
            <button onClick={onClose}
              style={{ padding: '10px 20px', borderRadius: 9,
                border: `1.5px solid ${C.border}`, background: 'transparent',
                color: C.textMuted, fontSize: 13, fontWeight: 700,
                fontFamily: 'inherit', cursor: 'pointer' }}>
              Annuler
            </button>
            <button onClick={handleExport} disabled={!canExport || exporting}
              style={{
                display: 'flex', alignItems: 'center', gap: 8,
                padding: '10px 24px', borderRadius: 9,
                background: canExport && !exporting ? C.green : C.toggleBg,
                color: canExport && !exporting ? '#fff' : C.textDim,
                border: 'none', fontSize: 13, fontWeight: 700,
                fontFamily: 'inherit',
                cursor: canExport && !exporting ? 'pointer' : 'not-allowed',
                transition: 'all 0.15s',
              }}>
              <Download size={14} strokeWidth={2.5} />
              {exporting ? 'Export en cours…' : 'Exporter Excel'}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  )
}