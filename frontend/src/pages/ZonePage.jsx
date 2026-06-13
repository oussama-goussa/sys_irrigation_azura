// ============================================================
// frontend/src/pages/ZonePage.jsx
// Page détail serre — Graphiques + StatCards + Historique + Export
// Corrections : 4 graphiques par house, calendrier, sans alertes
// Projet Azura Irrigation IA — GOUSSA Oussama
// ============================================================

import { useState, useEffect, useCallback, useRef } from 'react'
import { createPortal } from 'react-dom'

import { useWindowWidth } from '../components/DashboardShell.jsx'
import { RangeCalendar } from '../components/ExportModal.jsx'

import {
  ArrowLeft, RefreshCw, Activity, Droplets, Thermometer,
  Wind, Sun, Gauge, TrendingUp, TrendingDown, Minus,
  ChevronLeft, ChevronRight, Download, Clock, Calendar,
  BarChart2, WifiOff, MoveRight, AlertTriangle, Pause,
} from 'lucide-react'

import { Spinner } from '../components/ui.jsx'
import { getDeviceLatest, getDeviceHistory, exportDeviceCSV, getDeviceTours, getWeightHistory, getDeviceDailyStats, getAccessToken } from '../api/client.js'

// ── helpers ───────────────────────────────────────────────────
function fmt(v, dec = 2) {
  if (v === null || v === undefined) return '—'
  return Number(v).toFixed(dec)
}

function fmtTs(ts) {
  if (!ts) return '—'
  return new Date(ts).toLocaleString('fr-FR', {
    day: '2-digit', month: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  })
}

function lastSeenLabel(min) {
  if (min === null || min === undefined) return 'Jamais'
  if (min < 2) return "à l'instant"
  if (min < 60) return `depuis il y a ${min} min`
  if (min < 1440) return `depuis il y a ${Math.floor(min / 60)}h`
  // Plus de 24h → afficher la date
  const d = new Date(Date.now() - min * 60000)
  return `depuis le ${d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' })}`
}

function fmtDisplay(d) {
  if (!d) return ''
  const [y, m, day] = d.split('-')
  return `${day}/${m}/${y}`
}

function today() {
  return new Date().toISOString().split('T')[0]
}

function nDaysAgo(n) {
  const d = new Date()
  d.setDate(d.getDate() - n)
  return d.toISOString().split('T')[0]
}

function firstDayOfMonth() {
  const d = new Date()
  d.setDate(1)
  return d.toISOString().split('T')[0]
}

function statusColor(status, C) {
  return { ok: C.green, warning: C.amber, critical: C.red, unknown: C.textDim }[status] || C.textDim
}

function cellColor(value, thresh, C) {
  if (!thresh || value === null || value === undefined) return C.text
  const { min, max } = thresh
  if (min !== null && value < min) return C.red
  if (max !== null && value > max) return C.red
  return C.text
}

function deltaIcon(d) {
  if (d === null || d === undefined) return null
  if (d > 0.01)  return <TrendingUp  size={12} strokeWidth={2.5} style={{ color: '#f5a623' }} />
  if (d < -0.01) return <TrendingDown size={12} strokeWidth={2.5} style={{ color: '#4d9de0' }} />
  return <Minus size={12} strokeWidth={2.5} style={{ color: '#9cb8a6' }} />
}

// ── StatCard ──────────────────────────────────────────────────
function StatCard({ label, value, unit, status, thresh, icon: Icon, C }) {
  const color = statusColor(status, C)
  const isCritical = status === 'critical'
  const isWarning  = status === 'warning'

  return (
    <div style={{
      background: C.card,
      border: `1.5px solid ${C.border}`,
      borderRadius: 14,
      padding: '20px 24px',
      flex: 1, minWidth: 160,
      display: 'flex', flexDirection: 'column', gap: 10,
    }}>

      {/* Header — label + icon */}
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between' }}>
        <span style={{
          color: C.textMuted, fontSize: 11, fontWeight: 630,
          textTransform: 'uppercase', letterSpacing: '0.10em',
        }}>
          {label}
        </span>
        <div style={{
          width: 32, height: 32, borderRadius: 9,
          background: `${color}15`,
          border: `1px solid ${color}30`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <Icon size={15} color={color} strokeWidth={2} />
        </div>
      </div>

      {/* Value */}
      <div style={{ color: C.text, fontSize: 34, fontWeight: 900, lineHeight: 1 }}>
        {value}
        <span style={{ fontSize: 14, color: C.textMuted, fontWeight: 600, marginLeft: 5 }}>
          {unit}
        </span>
      </div>
    </div>
  )
}

function GaugeCard({ label, value, unit, min, max, color, C, subLabel, subLabelColor }) {
  const numVal = parseFloat(value)
  const mounted = useRef(false)
  useEffect(() => { mounted.current = true }, [])
  const isValid = !isNaN(numVal) && value !== null && value !== undefined && value !== '—'
  const pct = isValid ? Math.min(Math.max((numVal - min) / (max - min), 0), 1) : 0

  const r = 62
  const cx = 75, cy = 78
  // Arc total = 270 degrés
  const circumference = 2 * Math.PI * r
  const arcLength = circumference * (270 / 360)
  const fillLength = arcLength * pct
  const gapLength = circumference - arcLength

  // Rotation pour commencer à -135°
  const rotateStart = 135

  const needleAngle = 225 + pct * 270
  const toRad = deg => (deg * Math.PI) / 180

  return (
    <div style={{
      background: C.card,
      border: `1.5px solid ${C.border}`,
      borderRadius: 14,
      padding: '18px 16px 18px',
      flex: 1, minWidth: 150,
      textAlign: 'center',
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      minHeight: 210,
    }}>
      <div style={{
        color: C.textMuted, fontSize: 10, fontWeight: 630,
        textTransform: 'uppercase', letterSpacing: '0.12em', marginBottom: 4,
      }}>
        {label}
      </div>

      <svg viewBox="0 0 160 150" style={{ width: '100%', maxWidth: 202, overflow: 'visible' }}>

        {/* Background arc */}
        <circle
          cx={cx} cy={cy} r={r}
          fill="none"
          stroke={C.border}
          strokeWidth="10"
          strokeLinecap="round"
          strokeDasharray={`${arcLength} ${circumference - arcLength}`}
          strokeDashoffset={0}          transform={`rotate(${rotateStart} ${cx} ${cy})`}
          style={{ transition: 'none' }}
        />

        {/* Value arc — animé avec strokeDashoffset */}
        <circle
          cx={cx} cy={cy} r={r}
          fill="none"
          stroke={color}
          strokeWidth="10"
          strokeLinecap="round"
          strokeDasharray={`${fillLength} ${circumference - fillLength}`}
          strokeDashoffset={0}          transform={`rotate(${rotateStart} ${cx} ${cy})`}
          style={{ transition: 'stroke-dasharray 1.2s cubic-bezier(0.22, 1, 0.36, 1)' }}
          opacity={isValid ? 1 : 0}
        />

        {/* Needle — animé avec transform rotate */}
        <g
          transform={`rotate(${isValid ? needleAngle : 225}, ${cx}, ${cy})`}
          style={{ transition: mounted.current ? 'transform 1.2s cubic-bezier(0.22, 1, 0.36, 1)' : 'none' }}
        >
          <line
            x1={cx} y1={cy}
            x2={cx}  y2={cy - (r - 10)}
            stroke={C.text}
            strokeWidth="2.2"
            strokeLinecap="round"
          />
        </g>
        <circle cx={cx} cy={cy} r="4" fill={C.text} />

        {/* Value */}
        <text x={cx} y={cy + 28}
          textAnchor="middle"
          fill={isValid ? color : C.textDim}
          fontSize="11" fontWeight="900"
          fontFamily="inherit"
        >
          {isValid ? `${value}${unit}` : `—`}
        </text>

        {/* SubLabel context */}
        {subLabel && (
          <text x={cx} y={cy + 43}
            textAnchor="middle"
            fill={subLabelColor || C.textDim}
            fontSize="7.5" fontFamily="inherit"
            opacity="0.9"
          >
            {subLabel}
          </text>
        )}

        {/* Min — endpoint bas-gauche (135°) */}
        <text x={cx + (r + 12) * Math.cos(toRad(135))} 
              y={cy + (r + 12) * Math.sin(toRad(135)) + 4} 
              textAnchor="middle" fill={C.textDim}
              fontSize="7" fontFamily="inherit">{min}
        </text>

        {/* Max — endpoint bas-droite (45°) */}
        <text x={cx + (r + 12) * Math.cos(toRad(45))} 
              y={cy + (r + 12) * Math.sin(toRad(45)) + 4} 
              textAnchor="middle" fill={C.textDim}
              fontSize="7" fontFamily="inherit">{max}
        </text>
      </svg>
    </div>
  )
}

// ── Mini SVG Chart ────────────────────────────────────────────
function MiniChart({ data, color, label, unit, C, dark, onSelectRange, decimals = 2, refLine = null, refColor = '#aaa', dashed = false }) {
  const [cursor, setCursor] = useState(null)
  const [drag, setDrag]     = useState(null)
  const [dragging, setDragging] = useState(false)
  const svgRef = useRef(null)

  const validData = (data || []).filter(d => d.value !== null && d.value !== undefined)
  if (validData.length === 0) return (
    <div style={{ display:'flex', alignItems:'center', justifyContent:'center', height:120, color:C.textDim, fontSize:12 }}>
      Aucune donnée
    </div>
  )

  const values  = validData.map(d => d.value)
  const min     = Math.min(...values)
  const max     = Math.max(...values)
  const range   = max - min || 1
  const W = 600, H = 120
  const PAD = { top:10, bottom:20, left:45, right:10 }
  const chartW  = W - PAD.left - PAD.right
  const chartH  = H - PAD.top  - PAD.bottom

  const points = validData.map((d, i, arr) => ({
    x: PAD.left + (i / (arr.length - 1 || 1)) * chartW,
    y: PAD.top + chartH - ((d.value - min) / range) * chartH,
    value: d.value,
    timestamp: d.timestamp,
  }))

  const polyPoints  = points.map(p => `${p.x},${p.y}`).join(' ')
  const fillPoints  = [`${PAD.left},${PAD.top+chartH}`, ...points.map(p=>`${p.x},${p.y}`), `${PAD.left+chartW},${PAD.top+chartH}`].join(' ')
  const baseColor = color.length > 7 ? color.slice(0, 7) : color
  const gradId      = `grad_${label.replace(/[^a-zA-Z0-9]/g,'_')}`

  const yLabels = [min,(min+max)/2,max].map((v,i)=>({ y: PAD.top+chartH-(i/2)*chartH, label: Number(v).toFixed(1) }))
  const xLabels = [0, Math.floor(validData.length/2), validData.length-1].map(idx => ({
    x: PAD.left + (idx/(validData.length-1||1))*chartW,
    label: new Date(validData[idx]?.timestamp).toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'}),
  }))

  function getSvgX(e) {
    const rect = svgRef.current?.getBoundingClientRect()
    if (!rect) return PAD.left
    const raw = ((e.clientX - rect.left) / rect.width) * W
    return Math.max(PAD.left, Math.min(PAD.left + chartW, raw))
  }

  function findNearest(svgX) {
    const idx = Math.round(((svgX - PAD.left) / chartW) * (points.length - 1))
    return points[Math.max(0, Math.min(points.length-1, idx))]
  }

  function handleMouseMove(e) {
    const svgX = getSvgX(e)
    setCursor({ x: svgX, point: findNearest(svgX) })
    if (dragging) setDrag(d => ({ ...d, endX: svgX }))
  }

  function handleMouseDown(e) {
    const svgX = getSvgX(e)
    setDrag({ startX: svgX, endX: svgX })
    setDragging(true)
  }

  function handleMouseUp() {
    if (!dragging) return
    setDragging(false)
    if (!drag || !onSelectRange) { setDrag(null); return }
    const x1 = Math.min(drag.startX, drag.endX)
    const x2 = Math.max(drag.startX, drag.endX)
    if (x2 - x1 < 8) { setDrag(null); return }
    const i1 = Math.round(((x1-PAD.left)/chartW)*(points.length-1))
    const i2 = Math.round(((x2-PAD.left)/chartW)*(points.length-1))
    const d1 = validData[Math.max(0,i1)]
    const d2 = validData[Math.min(validData.length-1,i2)]
    if (d1 && d2) onSelectRange(d1.timestamp.split('T')[0], d2.timestamp.split('T')[0])
    setDrag(null)
  }

  const dragX1 = drag ? Math.min(drag.startX, drag.endX) : null
  const dragX2 = drag ? Math.max(drag.startX, drag.endX) : null

  return (
    <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`}
      style={{ width:'100%', height:120, cursor: dragging ? 'col-resize' : 'crosshair', userSelect:'none', overflow:'visible' }}
      onMouseMove={handleMouseMove}
      onMouseLeave={() => { setCursor(null); if(dragging){ setDragging(false); setDrag(null) } }}
      onMouseDown={handleMouseDown}
      onMouseUp={handleMouseUp}
    >
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%"   stopColor={baseColor} stopOpacity="0.25" />
          <stop offset="100%" stopColor={baseColor} stopOpacity="0.02" />
        </linearGradient>
      </defs>

      {/* Grid */}
      {[0,0.25,0.5,0.75,1].map((f,i) => (
        <line key={i} x1={PAD.left} y1={PAD.top+f*chartH} x2={PAD.left+chartW} y2={PAD.top+f*chartH}
          stroke={dark?'rgba(255,255,255,0.05)':'rgba(0,0,0,0.05)'} strokeWidth="1" />
      ))}

      {/* Drag selection */}
      {drag && dragX2-dragX1 > 2 && (
        <rect x={dragX1} y={PAD.top} width={dragX2-dragX1} height={chartH}
          fill={`${baseColor}20`} stroke={color} strokeWidth="1" strokeDasharray="4,3" />
      )}

      <polygon points={fillPoints} fill={`url(#${gradId})`} />
      <polyline points={polyPoints} fill="none" stroke={baseColor} strokeWidth={dashed ? 1.5 : 2} strokeLinejoin="round" strokeLinecap="round" strokeDasharray={dashed ? "6,4" : undefined} />

      {/* Reference line (prog) */}
      {refLine !== null && (() => {
        const refY = PAD.top + chartH - ((refLine - min) / range) * chartH
        if (refY < PAD.top || refY > PAD.top + chartH) return null
        return (
          <g>
            <line x1={PAD.left} y1={refY} x2={PAD.left + chartW} y2={refY}
              stroke={refColor} strokeWidth="1.2" strokeDasharray="6,4" opacity="0.7" />
            <text x={PAD.left + chartW - 2} y={refY - 4} textAnchor="end"
              fill={refColor} fontSize="9" opacity="0.85">
              {Number(refLine).toFixed(decimals)}
            </text>
          </g>
        )
      })()}

      {/* Y labels */}
      {yLabels.map((l,i) => (
        <text key={i} x={PAD.left-5} y={l.y+4} textAnchor="end"
          fill={dark?'rgba(255,255,255,0.35)':'rgba(0,0,0,0.35)'} fontSize="9">{l.label}</text>
      ))}

      {/* X labels */}
      {xLabels.map((l,i) => (
        <text key={i} x={l.x} y={H-4} textAnchor="middle"
          fill={dark?'rgba(255,255,255,0.35)':'rgba(0,0,0,0.35)'} fontSize="9">{l.label}</text>
      ))}

      {/* Crosshair + tooltip */}
      {cursor?.point && (() => {
        const p   = cursor.point
        const tipW = 140, tipH = 60
        const tx = p.x + 10 + tipW > W - PAD.right ? p.x - tipW - 10 : p.x + 10
        const ty = Math.max(PAD.top, Math.min(p.y - tipH/2, PAD.top + chartH - tipH))
        const time = new Date(p.timestamp).toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'})
        return (
          <g>
            <line x1={p.x} y1={PAD.top} x2={p.x} y2={PAD.top+chartH}
              stroke={baseColor} strokeWidth="1" strokeDasharray="3,3" opacity="0.6" />
            <circle cx={p.x} cy={p.y} r="4"
              fill={baseColor} stroke={dark?'#1a1a1a':'#fff'} strokeWidth="2" />
            <rect x={tx} y={ty} width={tipW} height={tipH} rx="6"
              fill={dark?'#1e2a1e':'#fff'} stroke={baseColor} strokeWidth="1.2"
              style={{filter:'drop-shadow(0 2px 8px rgba(0,0,0,0.2))'}} />
            <text x={tx+10} y={ty+18}
              fill={dark?'rgba(255,255,255,0.5)':'rgba(0,0,0,0.4)'} fontSize="10">
              {time}
            </text>
            <text x={tx+10} y={ty+38} fill={color} fontSize="13" fontWeight="700">
              {`${Number(p.value).toFixed(decimals)} ${unit}`}
            </text>
          </g>
        )
      })()}
    </svg>
  )
}

// ── Chart Card ────────────────────────────────────────────────
function ChartCard({ title, series, C, dark, onSelectRange }) {
  // Fusionner tous les timestamps pour un axe X commun
  const allData = series.flatMap(s => s.data || [])
  const allValues = allData.map(d => d.value).filter(v => v !== null && v !== undefined)
  const globalMin = allValues.length ? Math.min(...allValues) : 0
  const globalMax = allValues.length ? Math.max(...allValues) : 1

  return (
    <div style={{
      background: C.card, border: `1.5px solid ${C.border}`,
      borderRadius: 14, padding: '18px 20px',
    }}>
      <div style={{ fontWeight: 800, fontSize: 13, color: C.text, marginBottom: 12 }}>{title}</div>
      {/* Légende */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 8 }}>
        {series.map(s => (
          <div key={s.label} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              {s.dashed
                ? <svg width="14" height="4"><line x1="0" y1="2" x2="14" y2="2" stroke={s.color} strokeWidth="2" strokeDasharray="4,3"/></svg>
                : <div style={{ width: 10, height: 3, borderRadius: 2, background: s.color }} />
              }
              <span style={{ color: C.textMuted, fontSize: 11, fontWeight: 630 }}>{s.label}</span>
            </div>
            <span style={{ color: s.color, fontSize: 12, fontWeight: 800 }}>
              {s.data?.length > 0 && s.data[s.data.length - 1]?.value !== null
                ? `${Number(s.data[s.data.length - 1].value).toFixed(s.decimals || 1)} ${s.unit || ''}`
                : '—'}
            </span>
          </div>
        ))}
      </div>
      {/* Graphique multi-séries */}
      <MultiSeriesChart series={series} globalMin={globalMin} globalMax={globalMax} C={C} dark={dark} onSelectRange={onSelectRange} />
    </div>
  )
}

function MultiSeriesChart({ series, globalMin, globalMax, C, dark, onSelectRange }) {
  const [cursor, setCursor] = useState(null)
  const [drag, setDrag]     = useState(null)
  const [dragging, setDragging] = useState(false)
  const svgRef = useRef(null)

  const allTimestamps = [...new Set(
    series.flatMap(s => (s.data || []).map(d => d.timestamp))
  )].sort()

  if (allTimestamps.length === 0) return (
    <div style={{ display:'flex', alignItems:'center', justifyContent:'center', height:120, color:C.textDim, fontSize:12 }}>
      Aucune donnée
    </div>
  )

  const W = 600, H = 120
  const PAD = { top:10, bottom:20, left:45, right:10 }
  const chartW = W - PAD.left - PAD.right
  const chartH = H - PAD.top  - PAD.bottom
  const range  = globalMax - globalMin || 1

  const toX = (ts) => {
    const idx = allTimestamps.indexOf(ts)
    if (idx === -1) return PAD.left
    return PAD.left + (idx / (allTimestamps.length - 1 || 1)) * chartW
  }
  const toY = (v) => PAD.top + chartH - ((v - globalMin) / range) * chartH

  const yLabels = [globalMin, (globalMin + globalMax) / 2, globalMax].map((v, i) => ({
    y: PAD.top + chartH - (i / 2) * chartH,
    label: Number(v).toFixed(1),
  }))
  const xLabels = [0, Math.floor(allTimestamps.length / 2), allTimestamps.length - 1].map(idx => ({
    x: PAD.left + (idx / (allTimestamps.length - 1 || 1)) * chartW,
    label: new Date(allTimestamps[idx]).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }),
  }))

  function getSvgX(e) {
    const rect = svgRef.current?.getBoundingClientRect()
    if (!rect) return PAD.left
    const raw = ((e.clientX - rect.left) / rect.width) * W
    return Math.max(PAD.left, Math.min(PAD.left + chartW, raw))
  }

  function findNearestTs(svgX) {
    const idx = Math.round(((svgX - PAD.left) / chartW) * (allTimestamps.length - 1))
    return allTimestamps[Math.max(0, Math.min(allTimestamps.length - 1, idx))]
  }

  function handleMouseMove(e) {
    const svgX = getSvgX(e)
    const ts = findNearestTs(svgX)
    const rect2 = svgRef.current?.getBoundingClientRect()
    const svgY = rect2 ? ((e.clientY - rect2.top) / rect2.height) * H : PAD.top
    setCursor({ x: toX(ts), ts, y: svgY })
    if (dragging) setDrag(d => ({ ...d, endX: svgX }))
  }

  function handleMouseDown(e) {
    const svgX = getSvgX(e)
    setDrag({ startX: svgX, endX: svgX })
    setDragging(true)
  }

  function handleMouseUp() {
    if (!dragging) return
    setDragging(false)
    if (!drag || !onSelectRange) { setDrag(null); return }
    const x1 = Math.min(drag.startX, drag.endX)
    const x2 = Math.max(drag.startX, drag.endX)
    if (x2 - x1 < 8) { setDrag(null); return }
    const ts1 = findNearestTs(x1)
    const ts2 = findNearestTs(x2)
    if (ts1 && ts2) onSelectRange(ts1.split('T')[0], ts2.split('T')[0])
    setDrag(null)
  }

  const dragX1 = drag ? Math.min(drag.startX, drag.endX) : null
  const dragX2 = drag ? Math.max(drag.startX, drag.endX) : null

  return (
    <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`}
      style={{ width: '100%', height: 120, cursor: dragging ? 'col-resize' : 'crosshair', userSelect: 'none' }}
      onMouseMove={handleMouseMove}
      onMouseLeave={() => { setCursor(null); if (dragging) { setDragging(false); setDrag(null) } }}
      onMouseDown={handleMouseDown}
      onMouseUp={handleMouseUp}
    >
      <defs>
        {series.filter(s => !s.dashed).map(s => {
          const baseColor = s.color.length > 7 ? s.color.slice(0, 7) : s.color
          const gradId = `grad_ms_${s.label.replace(/[^a-zA-Z0-9]/g, '_')}`
          return (
            <linearGradient key={gradId} id={gradId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%"   stopColor={baseColor} stopOpacity="0.25" />
              <stop offset="100%" stopColor={baseColor} stopOpacity="0.02" />
            </linearGradient>
          )
        })}
      </defs>

      {/* Grid */}
      {[0, 0.25, 0.5, 0.75, 1].map((f, i) => (
        <line key={i} x1={PAD.left} y1={PAD.top + f * chartH} x2={PAD.left + chartW} y2={PAD.top + f * chartH}
          stroke={dark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)'} strokeWidth="1" />
      ))}

      {/* Drag selection */}
      {drag && dragX2 - dragX1 > 2 && (
        <rect x={dragX1} y={PAD.top} width={dragX2 - dragX1} height={chartH}
          fill={`${series[0]?.color || '#34d96f'}20`} stroke={series[0]?.color || '#34d96f'} strokeWidth="1" strokeDasharray="4,3" />
      )}

      {/* Séries */}
      {series.map(s => {
        const validData = (s.data || []).filter(d => d.value !== null && d.value !== undefined)
        if (validData.length === 0) return null
        const pts = validData.map(d => ({ x: toX(d.timestamp), y: toY(d.value), value: d.value, timestamp: d.timestamp }))
        const polyPoints = pts.map(p => `${p.x},${p.y}`).join(' ')
        const baseColor = s.color.length > 7 ? s.color.slice(0, 7) : s.color
        const gradId = `grad_ms_${s.label.replace(/[^a-zA-Z0-9]/g, '_')}`
        const fillPoints = [`${pts[0].x},${PAD.top + chartH}`, ...pts.map(p => `${p.x},${p.y}`), `${pts[pts.length-1].x},${PAD.top + chartH}`].join(' ')

        return (
          <g key={s.label}>
            {!s.dashed && <polygon points={fillPoints} fill={`url(#${gradId})`} />}
            <polyline points={polyPoints} fill="none" stroke={baseColor}
              strokeWidth={s.dashed ? 1.5 : 2}
              strokeLinejoin="round" strokeLinecap="round"
              strokeDasharray={s.dashed ? "6,4" : undefined} />
          </g>
        )
      })}

      {/* Y labels */}
      {yLabels.map((l, i) => (
        <text key={i} x={PAD.left - 5} y={l.y + 4} textAnchor="end"
          fill={dark ? 'rgba(255,255,255,0.35)' : 'rgba(0,0,0,0.35)'} fontSize="9">{l.label}</text>
      ))}

      {/* X labels */}
      {xLabels.map((l, i) => (
        <text key={i} x={l.x} y={H - 4} textAnchor="middle"
          fill={dark ? 'rgba(255,255,255,0.35)' : 'rgba(0,0,0,0.35)'} fontSize="9">{l.label}</text>
      ))}

      {/* Crosshair */}
      {cursor && (
        <g>
          <line x1={cursor.x} y1={PAD.top} x2={cursor.x} y2={PAD.top + chartH}
            stroke={series[0]?.color || '#34d96f'} strokeWidth="1" strokeDasharray="3,3" opacity="0.6" />
          {series.map(s => {
            const pt = (s.data || []).find(d => toX(d.timestamp) === cursor.x) ||
              (s.data || []).reduce((best, d) => {
                const dx = Math.abs(toX(d.timestamp) - cursor.x)
                return !best || dx < Math.abs(toX(best.timestamp) - cursor.x) ? d : best
              }, null)
            if (!pt || pt.value === null) return null
            const baseColor = s.color.length > 7 ? s.color.slice(0, 7) : s.color
            return (
              <circle key={s.label} cx={toX(pt.timestamp)} cy={toY(pt.value)} r="4"
                fill={baseColor} stroke={dark ? '#1a1a1a' : '#fff'} strokeWidth="2" />
            )
          })}
          {(() => {
            const tipW = 120, tipH = 15 + series.length * 16
            const tx = cursor.x + 10 + tipW > W - PAD.right ? cursor.x - tipW - 10 : cursor.x + 10
            const ty = Math.max(PAD.top, Math.min((cursor.y ?? PAD.top) - tipH/2, PAD.top + chartH - tipH))
            const time = new Date(cursor.ts).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
            return (
              <g>
                <rect x={tx} y={ty} width={tipW} height={tipH} rx="5"
                  fill={dark ? '#1e2a1e' : '#fff'} stroke={series[0]?.color || '#34d96f'} strokeWidth="1.2"
                  style={{ filter: 'drop-shadow(0 2px 8px rgba(0,0,0,0.2))' }} />
                <text x={tx + 8} y={ty + 15}
                  fill={dark ? 'rgba(255,255,255,0.45)' : 'rgba(0,0,0,0.45)'} fontSize="9">{time}</text>
                {series.map((s, i) => {
                  const pt = (s.data || []).reduce((best, d) => {
                    const dx = Math.abs(toX(d.timestamp) - cursor.x)
                    return !best || dx < Math.abs(toX(best.timestamp) - cursor.x) ? d : best
                  }, null)
                  const baseColor = s.color.length > 7 ? s.color.slice(0, 7) : s.color
                  return (
                    <text key={s.label} x={tx + 8} y={ty + 12 + (i + 1) * 14}
                      fill={baseColor} fontSize="10" fontWeight="700">
                      {pt ? `${Number(pt.value).toFixed(s.decimals || 1)} ${s.unit || ''}` : '—'}
                    </text>
                  )
                })}
              </g>
            )
          })()}
        </g>
      )}
    </svg>
  )
}

// ── Date Range Picker ─────────────────────────────────────────
const QUICK_PERIODS = [
  { id: 'today',  label: "Aujourd'hui", from: today,          to: today },
  { id: '3d',     label: '3 jours',     from: () => nDaysAgo(2), to: today },
  { id: '7d',     label: '7 jours',     from: () => nDaysAgo(6), to: today },
  { id: 'month',  label: 'Ce mois',     from: firstDayOfMonth,   to: today },
  { id: 'custom', label: 'Personnalisé', from: today,          to: today },
]

function DateRangePicker({ dateFrom, dateTo, onChangeDateFrom, onChangeDateTo, C, dark }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <Calendar size={14} strokeWidth={2} color={C.textMuted} />
      <input
        type="date"
        value={dateFrom}
        onChange={e => onChangeDateFrom(e.target.value)}
        max={dateTo}
        style={{
          padding: '6px 10px', borderRadius: 7,
          border: `1.5px solid ${C.border}`,
          background: C.inputBg, color: C.text,
          fontSize: 12, fontFamily: 'inherit', outline: 'none',
        }}
      />
      <span style={{ color: C.textDim, fontSize: 12 }}>→</span>
      <input
        type="date"
        value={dateTo}
        onChange={e => onChangeDateTo(e.target.value)}
        min={dateFrom}
        max={today()}
        style={{
          padding: '6px 10px', borderRadius: 7,
          border: `1.5px solid ${C.border}`,
          background: C.inputBg, color: C.text,
          fontSize: 12, fontFamily: 'inherit', outline: 'none',
        }}
      />
    </div>
  )
}

// ── TourCalendar — single date picker pour Tours ─────────────
const MONTHS_FR_T = ['Janvier','Février','Mars','Avril','Mai','Juin','Juillet','Août','Septembre','Octobre','Novembre','Décembre']
const DAYS_FR_T   = ['Lu','Ma','Me','Je','Ve','Sa','Di']

function TourCalendar({ value, onChange, C }) {
  const todayStr = new Date().toISOString().split('T')[0]
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
  while (cells.length % 7 !== 0) cells.push({ day: cells.length - startDow - daysInMonth + 1, curr: false })

  const btnNav = { background: 'none', border: 'none', cursor: 'pointer', color: C.textMuted, padding: '3px 6px', borderRadius: 5, display: 'flex', alignItems: 'center' }

  return (
    <div>
      {/* Header */}
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:10 }}>
        <button onClick={() => setView(new Date(year, month - 1, 1))} style={btnNav}>
          <ChevronLeft size={14} strokeWidth={2.5}/>
        </button>
        <span style={{ fontSize:12, fontWeight:800, color:C.text }}>
          {MONTHS_FR_T[month]}  {year}
        </span>
        <button onClick={() => setView(new Date(year, month + 1, 1))} style={btnNav}>
          <ChevronRight size={14} strokeWidth={2.5}/>
        </button>
      </div>

      {/* Day headers */}
      <div style={{ display:'grid', gridTemplateColumns:'repeat(7, 1fr)', marginBottom:4 }}>
        {DAYS_FR_T.map(d => (
          <div key={d} style={{ textAlign:'center', fontSize:9, fontWeight:700, color:C.textDim, padding:'2px 0', textTransform:'uppercase', letterSpacing:'0.06em' }}>{d}</div>
        ))}
      </div>

      {/* Days grid */}
      <div style={{ display:'grid', gridTemplateColumns:'repeat(7, 1fr)', gap:'2px 0' }}>
        {cells.map((cell, i) => {
          const cellStr    = cell.curr ? `${year}-${String(month+1).padStart(2,'0')}-${String(cell.day).padStart(2,'0')}` : null
          const isSelected = cellStr === value
          const isToday    = cellStr === todayStr
          return (
            <div key={i}
              onClick={() => cell.curr && onChange(cellStr)}
              style={{
                textAlign:'center', fontSize:11, padding:'5px 0', borderRadius:6,
                cursor: cell.curr ? 'pointer' : 'default',
                fontWeight: isSelected ? 800 : isToday ? 700 : 400,
                color: isSelected ? '#fff' : isToday ? C.green : cell.curr ? C.text : C.textDim,
                background: isSelected ? C.green : 'transparent',
                opacity: cell.curr ? 1 : 0.3,
                transition: 'all 0.1s', position: 'relative',
              }}
              onMouseEnter={e => { if (cell.curr && !isSelected) e.currentTarget.style.background = `${C.green}18` }}
              onMouseLeave={e => { if (!isSelected) e.currentTarget.style.background = 'transparent' }}
            >
              {isToday && !isSelected && (
                <span style={{ position:'absolute', bottom:1, left:'50%', transform:'translateX(-50%)', width:3, height:3, borderRadius:'50%', background:C.green }}/>
              )}
              {cell.day}
            </div>
          )
        })}
      </div>

      {/* Footer — uniquement Aujourd'hui + Effacer */}
      <div style={{ marginTop:10, paddingTop:8, borderTop:`1px solid ${C.border}`, display:'flex', justifyContent:'space-between' }}>
        <button
          onClick={() => onChange('')}
          style={{ background:'none', border:'none', cursor:'pointer', color:C.textDim, fontSize:10, fontWeight:700, fontFamily:'inherit', padding:'3px 6px', textTransform:'uppercase', letterSpacing:'0.06em' }}
        >
          Effacer
        </button>
        <button
          onClick={() => onChange(todayStr)}
          style={{ background:`${C.green}15`, border:`1px solid ${C.green}40`, borderRadius:6, cursor:'pointer', color:C.green, fontSize:10, fontWeight:800, fontFamily:'inherit', padding:'3px 10px', textTransform:'uppercase', letterSpacing:'0.06em' }}
        >
          Aujourd'hui
        </button>
      </div>
    </div>
  )
}

// ── Section title ─────────────────────────────────────────────
function SectionTitle({ title, C }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14, marginTop: 32 }}>
      <div style={{ width: 3, height: 18, background: C.green, borderRadius: 2 }} />
      <span style={{ color: C.text, fontSize: 14, fontWeight: 800 }}>{title}</span>
    </div>
  )
}

// ── StatusDot ─────────────────────────────────────────────────
function StatusDot({ on, C, size = 8 }) {
  return (
    <div style={{ position: 'relative', width: size, height: size, flexShrink: 0 }}>
      {on && (
        <div style={{
          position: 'absolute', top: '50%', left: '50%',
          transform: 'translate(-50%,-50%)',
          width: size, height: size, borderRadius: '50%',
          background: C.green, opacity: 0.35,
          animation: 'ripple 1.5s ease-out infinite',
        }} />
      )}
      <div style={{
        position: 'absolute', top: '50%', left: '50%',
        transform: 'translate(-50%,-50%)',
        width: size - 2, height: size - 2, borderRadius: '50%',
        background: on ? C.green : C.textDim,
        boxShadow: on ? `0 0 5px ${C.green}` : 'none',
        transition: 'background 0.2s',
      }} />
    </div>
  )
}

function PumpIndicator({ label, value, C }) {
  const on = parseInt(value) === 1
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8,
      padding: '14px 10px 12px',
      background: on ? 'rgba(52,217,111,0.07)' : C.surface,
      border: `1.5px solid ${on ? C.green + '50' : C.border}`,
      borderRadius: 11,
      minWidth: 76, flex: '1 1 0',
      transition: 'all 0.2s',
    }}>
      {/* Icône pompe */}
      <div style={{
        width: 32, height: 32, borderRadius: 8,
        background: on ? 'rgba(52,217,111,0.13)' : C.toggleBg,
        border: `1px solid ${on ? C.green + '40' : C.border}`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        position: 'relative',
      }}>
        <StatusDot on={on} C={C} size={10} />
      </div>
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontSize: 9, fontWeight: 700, color: C.textDim, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 3 }}>
          {label}
        </div>
        <div style={{
          fontSize: 11, fontWeight: 900,
          color: on ? C.green : C.textDim,
          background: on ? 'rgba(52,217,111,0.10)' : C.toggleBg,
          border: `1px solid ${on ? C.green + '30' : C.border}`,
          borderRadius: 5, padding: '2px 8px',
        }}>
          {on ? 'ON' : 'OFF'}
        </div>
      </div>
    </div>
  )
}

function ValveIndicator({ label, value, C }) {
  const numVal = parseInt(value)
  const on = !isNaN(numVal) && numVal !== 0
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8,
      padding: '14px 10px 12px',
      background: on ? 'rgba(52,217,111,0.07)' : C.surface,
      border: `1.5px solid ${on ? C.green + '50' : C.border}`,
      borderRadius: 11,
      minWidth: 76, flex: '1 1 0',
      transition: 'all 0.2s',
    }}>
      <div style={{
        width: 32, height: 32, borderRadius: 8,
        background: on ? 'rgba(52,217,111,0.13)' : C.toggleBg,
        border: `1px solid ${on ? C.green + '40' : C.border}`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <StatusDot on={on} C={C} size={10} />
      </div>
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontSize: 9, fontWeight: 700, color: C.textDim, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 3 }}>
          {label}
        </div>
        <div style={{
          fontSize: 11, fontWeight: 900,
          color: on ? C.green : C.textDim,
          background: on ? 'rgba(52,217,111,0.10)' : C.toggleBg,
          border: `1px solid ${on ? C.green + '30' : C.border}`,
          borderRadius: 5, padding: '2px 8px',
        }}>
          {on ? 'ON' : 'OFF'}
        </div>
      </div>
    </div>
  )
}

function FertCard({ num, open, min, act, max, flow, C }) {
  const on = act !== null && act !== undefined && Number(act) > 0
  const pct = (max > 0 && act !== null) ? Math.min((Number(act) / Number(max)) * 100, 100) : 0

  return (
    <div style={{
      flex: '1 1 0', minWidth: 80,
      padding: '12px 14px',
      background: on ? 'rgba(52,217,111,0.06)' : C.surface,
      border: `1.5px solid ${on ? C.green + '40' : C.border}`,
      borderTop: `3px solid ${on ? C.green : C.border}`,
      borderRadius: 10,
      transition: 'all 0.2s',
    }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
        <div style={{ fontSize: 11, fontWeight: 800, color: on ? C.green : C.textDim, letterSpacing: '0.04em' }}>
          F{num}
        </div>
        <div style={{
          fontSize: 9, fontWeight: 800,
          color: on ? C.green : C.textDim,
          background: on ? 'rgba(52,217,111,0.12)' : C.toggleBg,
          border: `1px solid ${on ? C.green + '30' : C.border}`,
          borderRadius: 4, padding: '1px 6px',
        }}>
          {on ? 'ON' : 'OFF'}
        </div>
      </div>

      {/* Progress bar */}
      <div style={{ background: C.border, borderRadius: 3, height: 4, marginBottom: 8 }}>
        <div style={{
          width: `${on ? pct : 0}%`, height: '100%',
          background: on ? C.green : C.textDim,
          borderRadius: 3, transition: 'width 0.5s cubic-bezier(0.22,1,0.36,1)',
        }} />
      </div>

      {/* Valeur ouverture */}
      <div style={{ fontSize: 20, fontWeight: 900, color: on ? C.green : C.textDim, lineHeight: 1, marginBottom: 2 }}>
        {on ? `${Number(act).toFixed(0)}` : '—'}
        {on && <span style={{ fontSize: 10, fontWeight: 400, color: C.textDim, marginLeft: 2 }}>%</span>}
      </div>
      <div style={{ fontSize: 9, color: C.textDim, marginBottom: 6 }}>ouverture</div>

      {/* Flow */}
      <div style={{ fontSize: 10, color: on ? C.textMuted : C.textDim, fontWeight: 630 }}>
        {on && flow !== null && flow !== undefined
          ? `${Number(flow).toFixed(1)} mL`
          : <span style={{ opacity: 0.4 }}>— mL</span>
        }
      </div>
    </div>
  )
}

// ── Main Page ─────────────────────────────────────────────────
export default function ZonePage({ token, device: deviceInfo, onBack, C, dark }) {
  const deviceId = deviceInfo.id
  const width    = useWindowWidth()
  const isMobile = width < 640
  const isTablet = width >= 640 && width < 900

  const [live,      setLive]      = useState(null)
  const [history,   setHistory]   = useState(null)
  const [loadingL,  setLoadingL]  = useState(true)
  const [loadingH,  setLoadingH]  = useState(true)
  const [errorL,    setErrorL]    = useState('')
  const [errorH,    setErrorH]    = useState('')
  // ── Historique table ──
  const [dateFrom,      setDateFrom]      = useState(today())
  const [dateTo,        setDateTo]        = useState(today())
  const [page,          setPage]          = useState(1)
  const [exporting,     setExporting]     = useState(false)

  // ── Graphiques (indépendant) ──
  const [chartDateFrom, setChartDateFrom] = useState(today())
  const [chartDateTo,   setChartDateTo]   = useState(today())
  const [chartData,     setChartData]     = useState(null)
  const [loadingChart,  setLoadingChart]  = useState(true)
  const [weightData,    setWeightData]    = useState(null)
  const [loadingWeight, setLoadingWeight] = useState(false)
  const [chartZoomFrom, setChartZoomFrom] = useState(null)
  const [chartZoomTo,   setChartZoomTo]   = useState(null)
  const isZoomedRef = useRef(false)
  const isToday = chartDateFrom === today() && chartDateTo === today()
  const isHistoryToday = dateFrom === today() && dateTo === today()

  const [sortCol, setSortCol] = useState('timestamp')
  const [sortDir, setSortDir] = useState('desc')

  const [tours,        setTours]        = useState(null)
  const [tourDate,     setTourDate]     = useState(today())
  const [loadingTours, setLoadingTours] = useState(false)
  const [refreshing, setRefreshing] = useState(false)

  // ── Stats journalières ──
  const [statsDate,      setStatsDate]      = useState(today())
  const [dailyStats,     setDailyStats]     = useState(null)
  const [loadingStats,   setLoadingStats]   = useState(true)
  const [showStatsCal,   setShowStatsCal]   = useState(false)
  const [statsCalPos,    setStatsCalPos]    = useState({ top: 0, bottom: 'auto', left: 0 })
  const statsCalTriggerRef = useRef(null)
  const statsCalPortalRef  = useRef(null)

  // ── Calendrier graphiques ──
  const [showChartCal,    setShowChartCal]    = useState(false)
  const [chartCalPos,     setChartCalPos]     = useState({ top: 0, bottom: 'auto', left: 0 })
  const chartCalTriggerRef = useRef(null)
  const chartCalPortalRef  = useRef(null)

  // ── Calendrier tours ──
  const [showTourCal,     setShowTourCal]     = useState(false)
  const [tourCalPos,      setTourCalPos]      = useState({ top: 0, bottom: 'auto', left: 0 })
  const tourCalTriggerRef  = useRef(null)
  const tourCalPortalRef   = useRef(null)

  // ── Calendrier historique table ──
  const [showHistCal,     setShowHistCal]     = useState(false)
  const [histCalPos,      setHistCalPos]      = useState({ top: 0, bottom: 'auto', left: 0 })
  const histCalTriggerRef  = useRef(null)
  const histCalPortalRef   = useRef(null)

  // ── load live ──
  const loadLive = useCallback(async () => {
      setRefreshing(true)
      try {
        const d = await getDeviceLatest(getAccessToken(), deviceId)
        setLive(d)
        setErrorL('')
      } catch (e) {
        setErrorL(e.message)
      } finally {
        setLoadingL(false)
        setRefreshing(false)
      }
    }, [token, deviceId])

  // ── load history ──
  const loadHistory = useCallback(async (p = 1) => {
    setLoadingH(true)
    try {
      const d = await getDeviceHistory(getAccessToken(), deviceId, {
        dateFrom, dateTo, page: p, perPage: 15,
      })
      setHistory(d)
      setPage(p)
      setErrorH('')
    } catch (e) {
      setErrorH(e.message)
    } finally {
      setLoadingH(false)
    }
  }, [token, deviceId, dateFrom, dateTo])

  // ── load ChartData ──
  const loadChartData = useCallback(async () => {
    setLoadingChart(true)
    try {
      const d = await getDeviceHistory(getAccessToken(), deviceId, {
        dateFrom: chartDateFrom, dateTo: chartDateTo, page: 1, perPage: 500,
      })
      setChartData(d)
      setChartZoomFrom(null)
      setChartZoomTo(null)
    } catch (e) {
      // silencieux
    } finally {
      setLoadingChart(false)
    }
  }, [token, deviceId, chartDateFrom, chartDateTo])

  const loadWeightData = useCallback(async () => {
    setLoadingWeight(true)
    try {
      const d = await getWeightHistory(getAccessToken(), deviceInfo.farm_name, {
        dateFrom: chartDateFrom, dateTo: chartDateTo, page: 1, perPage: 500,
      })
      setWeightData(d?.data || [])
    } catch {
      setWeightData([])
    } finally {
      setLoadingWeight(false)
    }
  }, [token, deviceInfo.farm_name, chartDateFrom, chartDateTo])

  const loadTours = useCallback(async (d, showLoading = false) => {
      if (showLoading) setLoadingTours(true)
      try {
        const data = await getDeviceTours(getAccessToken(), deviceId, d)
        setTours(data)
      } catch (e) {
        // silencieux — NetworkError normal si composant démonté
      } finally {
        setLoadingTours(false)
      }
  }, [deviceId])

  useEffect(() => {
      let cancelled = false
      const run = async () => {
        if (cancelled) return
        await loadTours(tourDate, true)
      }
      run()
      if (tourDate !== today()) return
      const iv = setInterval(() => { if (!cancelled) loadTours(tourDate, false) }, 30_000)
      return () => { cancelled = true; clearInterval(iv) }
  }, [tourDate, deviceId])

  // 1. Refresh live uniquement — interval stable, dépend seulement de loadLive
  useEffect(() => {
    loadLive()
    const iv = setInterval(() => loadLive(), 30_000)
    return () => clearInterval(iv)
  }, [loadLive])  // loadLive change seulement si token ou deviceId changent

  // 2. Refresh chart/historique quand la page est active et aujourd'hui
  const pageRef = useRef(page)
  useEffect(() => { pageRef.current = page }, [page])

  const isHistoryTodayRef = useRef(isHistoryToday)
  useEffect(() => { isHistoryTodayRef.current = isHistoryToday }, [isHistoryToday])

  useEffect(() => {
    if (!isToday) return  // pas de refresh auto si période passée
    const iv = setInterval(() => {
      if (!isZoomedRef.current) loadChartData()
      if (isHistoryTodayRef.current) loadHistory(pageRef.current)
      loadWeightData()
    }, 30_000)
    return () => clearInterval(iv)
  }, [isToday, loadChartData, loadHistory, loadWeightData])

  useEffect(() => {
    loadHistory(1)
  }, [dateFrom, dateTo, deviceId])

  useEffect(() => {
    loadChartData()
    loadWeightData()
  }, [chartDateFrom, chartDateTo, deviceId])

  // Click-outside pour fermer le calendrier graphiques
  useEffect(() => {
    if (!showChartCal) return
    const close = (e) => {
      if (
        chartCalTriggerRef.current && !chartCalTriggerRef.current.contains(e.target) &&
        chartCalPortalRef.current && !chartCalPortalRef.current.contains(e.target)
      ) setShowChartCal(false)
    }
    const onScroll = () => setShowChartCal(false)
    document.addEventListener('mousedown', close)
    window.addEventListener('scroll', onScroll, true)
    return () => {
      document.removeEventListener('mousedown', close)
      window.removeEventListener('scroll', onScroll, true)
    }
  }, [showChartCal])

  useEffect(() => {
    if (!showHistCal) return
    const close = (e) => {
      if (
        histCalTriggerRef.current && !histCalTriggerRef.current.contains(e.target) &&
        histCalPortalRef.current  && !histCalPortalRef.current.contains(e.target)
      ) setShowHistCal(false)
    }
    const onScroll = () => setShowHistCal(false)
    document.addEventListener('mousedown', close)
    window.addEventListener('scroll', onScroll, true)
    return () => {
      document.removeEventListener('mousedown', close)
      window.removeEventListener('scroll', onScroll, true)
    }
  }, [showHistCal])

  useEffect(() => {
    if (!showTourCal) return
    const close = (e) => {
      if (
        tourCalTriggerRef.current && !tourCalTriggerRef.current.contains(e.target) &&
        tourCalPortalRef.current  && !tourCalPortalRef.current.contains(e.target)
      ) setShowTourCal(false)
    }
    const onScroll = () => setShowTourCal(false)
    document.addEventListener('mousedown', close)
    window.addEventListener('scroll', onScroll, true)
    return () => {
      document.removeEventListener('mousedown', close)
      window.removeEventListener('scroll', onScroll, true)
    }
  }, [showTourCal])  

  // ── load daily stats ──
  const loadDailyStats = useCallback(async () => {
    setLoadingStats(true)
    try {
      const d = await getDeviceDailyStats(getAccessToken(), deviceId, statsDate)
      setDailyStats(d)
    } catch {
      setDailyStats(null)
    } finally {
      setLoadingStats(false)
    }
  }, [deviceId, statsDate])

  useEffect(() => {
    loadDailyStats()
    if (statsDate !== today()) return
    const iv = setInterval(loadDailyStats, 30_000)
    return () => clearInterval(iv)
  }, [statsDate, deviceId])

  // Click-outside calendrier stats
  useEffect(() => {
    if (!showStatsCal) return
    const close = (e) => {
      if (
        statsCalTriggerRef.current && !statsCalTriggerRef.current.contains(e.target) &&
        statsCalPortalRef.current  && !statsCalPortalRef.current.contains(e.target)
      ) setShowStatsCal(false)
    }
    const onScroll = () => setShowStatsCal(false)
    document.addEventListener('mousedown', close)
    window.addEventListener('scroll', onScroll, true)
    return () => {
      document.removeEventListener('mousedown', close)
      window.removeEventListener('scroll', onScroll, true)
    }
  }, [showStatsCal])

  // ── Period shortcut ──
  const applyPeriod = (p) => {
    setActivePeriod(p.id)
    if (p.id !== 'custom') {
      setDateFrom(p.from())
      setDateTo(p.to())
    }
  }

  // ── Export ──
  const handleExport = async () => {
    setExporting(true)
    try {
      await exportDeviceCSV(
        getAccessToken(), deviceId, dateFrom, dateTo,
        `${deviceInfo.farm_name}_Station${deviceInfo.house_number}_${dateFrom}_${dateTo}.xlsx`
      )
    } catch (e) {
      console.error('Export error:', e)
    } finally {
      setExporting(false)
    }
  }

  // ── Shortcuts ──
  const sensor = live?.sensor || {}
  const cycle  = live?.cycle  || {}
  const deltas = live?.deltas || {}
  const thresh = live?.thresholds || {}
  const online = loadingL ? null : (live?.online ?? false)

  function getStatus(key, field) {
    const t = thresh[field]
    const v = sensor[field]
    if (!t || v === null || v === undefined) return 'unknown'
    if (t.min !== null && v < t.min) return 'critical'
    if (t.max !== null && v > t.max) return 'critical'
    return 'ok'
  }

  // ── Build chart series from history data ──
  function buildSeries(field) {
    if (!chartData?.data) return []
    const fromBound = chartZoomFrom ? chartZoomFrom + ' 00:00:00' : null
    const toBound   = chartZoomTo   ? chartZoomTo   + ' 23:59:59' : null
    return [...chartData.data]
      .reverse()
      .filter(d => {
        if (!fromBound && !toBound) return true
        const ts = d.timestamp.replace('T', ' ')
        if (fromBound && ts < fromBound) return false
        if (toBound   && ts > toBound)   return false
        return true
      })
      .map(d => ({ timestamp: d.timestamp, value: d[field] ?? 0 }))
  }

  // ── spin keyframe ──
    if (typeof document !== 'undefined' && !document.getElementById('az-spin-style')) {
      const s = document.createElement('style')
      s.id = 'az-spin-style'
      s.textContent = '@keyframes az-spin { to { transform: rotate(360deg); } }'
      document.head.appendChild(s)
    }  

  return (
    <div>
      {/* ── Header ──────────────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 28, flexWrap: 'wrap', gap: 12 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <button onClick={onBack} style={{
              display: 'flex', alignItems: 'center', gap: 5,
              background: 'transparent', border: 'none',
              color: C.textMuted, cursor: 'pointer',
              fontSize: 12, fontWeight: 630, padding: 0, fontFamily: 'inherit',
            }}>
              <ArrowLeft size={14} strokeWidth={2.5} /> Dashboard
            </button>
            <span style={{ color: C.border }}>/</span>
            <span style={{ color: C.green, fontSize: 12, fontWeight: 630 }}>
              {deviceInfo.farm_name} · Station {deviceInfo.house_number}
            </span>
          </div>

          <h1 style={{ color: C.text, fontSize: 20, fontWeight: 900, marginBottom: 4 }}>
            {deviceInfo.farm_name} — Station {deviceInfo.house_number}
          </h1>

          <div style={{ color: C.textDim, fontSize: 11, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <span>Netafim · {deviceInfo.controller_type || '—'} · v{deviceInfo.controller_version || '—'}</span>
            <span style={{ color: C.border }}>·</span>
            <span style={{ fontFamily: 'inherit', fontSize: 11 }}>{deviceInfo.device_id || '—'}</span>
            <span style={{ color: C.border }}>·</span>

            <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: online === null ? C.textDim : online ? C.green : C.red, fontWeight: 630 }}>
              <div style={{ position: 'relative', width: 10, height: 10, flexShrink: 0 }}>
                {online === true && (
                  <div style={{
                    position: 'absolute',
                    top: '50%', left: '50%',
                    transform: 'translate(-50%, -50%)',
                    width: 10, height: 10,
                    borderRadius: '50%',
                    background: C.green,
                    opacity: 0.4,
                    animation: 'ripple 1.5s ease-out infinite',
                  }} />
                )}
                <div style={{
                  position: 'absolute',
                  top: '50%', left: '50%',
                  transform: 'translate(-50%, -50%)',
                  width: 8, height: 8,
                  borderRadius: '50%',
                  background: online === null ? C.textDim : online ? C.green : C.red,
                  boxShadow: online === true ? `0 0 5px ${C.green}` : 'none',
                }} />
              </div>
              {online === null ? '…' : online ? '\u00A0\En ligne' : 'Hors ligne'}
            </div>
          </div>
        </div>

        <button disabled={refreshing} onClick={loadLive} style={{
          display: 'flex', alignItems: 'center', gap: 6,
          padding: '8px 16px', background: C.toggleBg,
          border: `1px solid ${dark ? '#1c2e22' : '#c0d8c8'}`, borderRadius: 8,
          color: C.textMuted, fontSize: 12, fontWeight: 630,
          cursor: 'pointer', fontFamily: 'inherit',
        }}>
          <RefreshCw size={12} strokeWidth={2} style={{ animation: refreshing ? 'az-spin 0.7s linear infinite' : 'none' }} /> 
          {!isMobile && ' Actualiser'}
        </button>
      </div>

      {/* ── Bannière alarme ──────────────────────────────────── */}
      {!loadingL && ((sensor?.alarm ?? 0) > 0 || sensor?.siren) && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10,
          padding: '10px 16px', marginBottom: 16,
          background: (sensor?.alarm ?? 0) > 0 ? `${C.red}10` : `${C.amber}10`,
          border: `1.5px solid ${(sensor?.alarm ?? 0) > 0 ? C.red + '40' : C.amber + '40'}`,
          borderRadius: 12,
          color: (sensor?.alarm ?? 0) > 0 ? C.red : C.amber,
          fontSize: 12, fontWeight: 700,
        }}>
          <AlertTriangle size={14} strokeWidth={2.5} />
          {(sensor?.alarm ?? 0) > 0
            ? `Code alarme ${sensor.alarm} · Sirène ${sensor?.siren ? 'active' : 'inactive'}`
            : `Sirène active`
          }
          <span style={{ marginLeft: 'auto', fontSize: 11, fontWeight: 400, color: C.textMuted }}>
            Vérifier le contrôleur Netafim
          </span>
        </div>
      )}

      {/* ── StatCards temps réel ─────────────────────────────── */}
      <SectionTitle title="Données temps réel" C={C} />
      <div style={{ color: C.textDim, fontSize: 11, marginBottom: 14, marginTop: -10 }}>
        Rafraîchissement automatique toutes les 30s
        {sensor.timestamp && ` — ${fmtTs(sensor.timestamp)}`}
      </div>

      {errorL ? (
        <div style={{ color: C.red, fontSize: 12 }}>{errorL}</div>
      ) : (() => {
        const hasOutside = sensor.outside_temp != null || sensor.outside_humidity != null
        return (
          <div style={{
            display: 'grid',
            gridTemplateColumns: isMobile ? '1fr 1fr' : isTablet ? 'repeat(4,1fr)' : hasOutside ? 'repeat(5,1fr)' : 'repeat(4,1fr)',
            gap: isMobile ? 10 : 14,
            marginBottom: 14,
          }}>
            <GaugeCard label="EC Apport"          value={online === false ? '0' : fmt(sensor.ec_actual, 2)}    unit="mS/cm" min={0}  max={8}    color="#00c9a7" C={C}
              subLabel={online === false ? 'Hors ligne' : sensor.flow === 0 ? '' : 'en irrigation'}
              subLabelColor={online === false ? C.red : sensor.flow === 0 ? C.amber : C.green} />
            <GaugeCard label="pH Apport"          value={online === false ? '0' : fmt(sensor.ph_actual, 2)}    unit=""      min={4}  max={8}    color="#4d9de0" C={C}
              subLabel={online === false ? 'Hors ligne' : sensor.flow === 0 ? '' : 'en irrigation'}
              subLabelColor={online === false ? C.red : sensor.flow === 0 ? C.amber : C.green} />
            <GaugeCard label="Température Serre" value={online === false ? '0' : fmt(sensor.avg_temp, 1)}     unit="°C"    min={10} max={40}   color="#f52e23" C={C}
              subLabel={online === false ? 'Hors ligne' : undefined} subLabelColor={C.red} />
            <GaugeCard label="Humidité Serre"    value={online === false ? '0' : fmt(sensor.humidity, 1)}     unit="%"     min={0}  max={100}  color="#b197fc" C={C}
              subLabel={online === false ? 'Hors ligne' : undefined} subLabelColor={C.red} />
            <GaugeCard label="Radiation"   value={online === false ? '0' : fmt(sensor.radiation, 1)}    unit="W/m²"  min={0}  max={2000} color="#f5e642" C={C}
              subLabel={online === false ? 'Hors ligne' : undefined} subLabelColor={C.red} />
            <GaugeCard label="Débit"       value={online === false ? '0' : fmt(sensor.flow, 0)}         unit="L/h"   min={0}  max={1000} color="#34d96f" C={C}
              subLabel={online === false ? 'Hors ligne' : undefined} subLabelColor={C.red} />
            <GaugeCard label="Cumul Rad."  value={online === false ? '0' : fmt(sensor.radiation_sum,1)} unit="J/cm²" min={0}  max={3000} color="#f5a623" C={C}
              subLabel={online === false ? 'Hors ligne' : undefined} subLabelColor={C.red} />
            {hasOutside && (
              <GaugeCard label="Température Ext." value={online === false ? '0' : fmt(sensor.outside_temp, 1)}    unit="°C" min={0} max={50}  color="#f05252" C={C}
                subLabel={online === false ? 'Hors ligne' : undefined} subLabelColor={C.red} />
            )}
            {hasOutside && (
              <GaugeCard label="Humidité Ext."    value={online === false ? '0' : fmt(sensor.outside_humidity, 1)} unit="%" min={0} max={100} color="#4d9de0" C={C}
                subLabel={online === false ? 'Hors ligne' : undefined} subLabelColor={C.red} />
            )}
            <GaugeCard label="Vent"    value={online === false ? '0' : fmt(sensor.wind_speed, 1)}   unit="m/s"  min={0}  max={30} color="#576c58" C={C}
              subLabel={online === false ? 'Hors ligne' : undefined} subLabelColor={C.red} />
          </div>
          )
      })()}

      

      {/* ── État irrigation ─────────────────────────────────── */}
      <SectionTitle title="État irrigation en temps réel" C={C} />
      {!loadingL && online === false ? (
        <div style={{
          background: C.card, border: `1.5px solid ${C.red}30`,
          borderRadius: 14, padding: isMobile ? '16px 18px' : '22px 28px',
          display: 'flex', alignItems: 'center', gap: 20, flexWrap: 'wrap',
          marginBottom: 16,
        }}>
          <div style={{
            width: 52, height: 52, borderRadius: 13, flexShrink: 0,
            background: `${C.red}12`,
            border: `1.5px solid ${C.red}40`,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <WifiOff size={22} color={C.red} strokeWidth={2} />
          </div>
          <div style={{ flex: 1, minWidth: 140 }}>
            <div style={{ fontSize: 15, fontWeight: 800, color: C.red, marginBottom: 5 }}>
              Station hors ligne
            </div>
            <div style={{ fontSize: 11, color: C.textDim, lineHeight: 1.6 }}>
              Aucune donnée reçue {lastSeenLabel(live?.last_seen_min)}
            </div>
          </div>
          <div style={{
            display: 'flex', gap: isMobile ? 16 : 32, flexWrap: 'wrap', marginLeft: 'auto',
          }}>
            {[
              { label: 'EC Apport',   value: '0 mS/cm' },
              { label: 'pH Apport',   value: '0' },
              { label: 'Débit',       value: '0 L/h' },
              { label: 'Irrigation',  value: 'Inconnu' },
            ].map(m => (
              <div key={m.label} style={{ textAlign: 'center' }}>
                <div style={{ fontSize: 10, color: C.textDim, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 5, whiteSpace: 'nowrap' }}>
                  {m.label}
                </div>
                <div style={{ fontSize: 17, fontWeight: 800, color: C.textDim }}>{m.value}</div>
              </div>
            ))}
          </div>
        </div>
      ) : !loadingL && live?.cycle && Object.keys(live.cycle).length > 0 ? (() => {
        const cycle = live.cycle
        const isIrrigating = sensor?.ec_ph_status === 'Irrigation'
        const isWait = sensor?.ec_ph_status === 'Wait'

        // ── Helper : filtre les valeurs vides/zéro ──
        const filterRow = (val) => {
          if (val === null || val === undefined) return false
          const s = String(val)
          return s !== '0' && s !== '00:00:00' && s !== '00:00' && s !== ''
        }

        // ── ÉTAT REPOS (Pause / Wait) ─────────────────────────
        if (!isIrrigating) {
          return (
            <div style={{
              background: C.card, border: `1.5px solid ${C.border}`,
              borderRadius: 14, padding: isMobile ? '16px 18px' : '22px 28px',
              display: 'flex', alignItems: 'center', gap: 20, flexWrap: 'wrap',
              marginBottom: 16,
            }}>
              {/* Icône statut */}
              <div style={{
                width: 52, height: 52, borderRadius: 13, flexShrink: 0,
                background: isWait ? `${C.amber}12` : `${C.textDim}08`,
                border: `1.5px solid ${isWait ? C.amber + '45' : C.border}`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                <Pause size={22} color={isWait ? C.amber : C.textDim} strokeWidth={2} />
              </div>

              {/* Texte statut */}
              <div style={{ flex: 1, minWidth: 140 }}>
                <div style={{
                  fontSize: 15, fontWeight: 800,
                  color: isWait ? C.amber : C.textMuted,
                  marginBottom: 5,
                }}>
                  {isWait ? 'Système en attente' : 'Système en pause'}
                </div>
                <div style={{ fontSize: 11, color: C.textDim, lineHeight: 1.6 }}>
                  {cycle.next_seq_time && cycle.next_seq_time !== '00:00'
                    ? `Prochain démarrage : ${cycle.next_seq_time}`
                    : 'Aucun programme planifié'}
                  {cycle.next_sequence > 0 ? ` · Séquence ${cycle.next_sequence}` : ''}
                </div>
              </div>

              {/* Métriques utiles même en repos */}
              <div style={{
                display: 'flex', gap: isMobile ? 16 : 32,
                flexWrap: 'wrap', marginLeft: 'auto',
              }}>
                {[
                  { label: 'Cycle actif',  value: cycle.cycle_act  > 0 ? cycle.cycle_act  : '—' },
                  { label: 'Séquence',     value: cycle.sequence   > 0 ? cycle.sequence   : '—' },
                  { label: 'Cumul Rad.',   value: sensor?.radiation_sum ? `${fmt(sensor.radiation_sum, 0)} J` : '—' },
                  ...(cycle.pause ? [{ label: 'Pause', value: 'Active', col: C.amber }] : []),
                ].map(m => (
                  <div key={m.label} style={{ textAlign: 'center' }}>
                    <div style={{ fontSize: 10, color: C.textDim, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 5, whiteSpace: 'nowrap' }}>
                      {m.label}
                    </div>
                    <div style={{ fontSize: 17, fontWeight: 800, color: m.col || C.text }}>
                      {m.value}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )
        }

        // ── ÉTAT ACTIF (Irrigation) ───────────────────────────
        const fertHasData = live?.fertigation && Object.entries(live.fertigation)
          .filter(([k]) => k.startsWith('fert_act'))
          .some(([, v]) => v !== null && v !== undefined)

        return (
          <>
            {/* ── Pompes + Vannes : TOUTES affichées, grisées si OFF ── */}
            <div style={{
              background: C.card, border: `1.5px solid ${C.border}`,
              borderRadius: 14, padding: isMobile ? '14px 16px' : '18px 24px',
              marginBottom: 14,
            }}>
              <div style={{ display: 'flex', flexDirection: isMobile ? 'column' : 'row', gap: isMobile ? 18 : 0 }}>

                {/* Pompes */}
                <div style={{ flex: 1, paddingRight: isMobile ? 0 : 24, borderRight: isMobile ? 'none' : `1px solid ${C.border}` }}>
                  <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.10em', color: C.textDim, marginBottom: 12 }}>
                    Pompes
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 8 }}>
                    {[1,2,3,4,5,6].map(i => {
                      const on = parseInt(cycle[`pump${i}`]) > 0
                      return (
                        <div key={i} style={{
                          display: 'flex', flexDirection: 'column', alignItems: 'center',
                          padding: '10px 6px', borderRadius: 10,
                          background: on ? (dark ? 'rgba(52,217,111,0.10)' : 'rgba(52,217,111,0.07)') : (dark ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.02)'),
                          border: `1.5px solid ${on ? C.green + '40' : C.border}`,
                          transition: 'all 0.2s',
                          opacity: on ? 1 : 0.45,
                        }}>
                          {/* Dot */}
                          <div style={{ position: 'relative', width: 10, height: 10, marginBottom: 7 }}>
                            {on && <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', width: 10, height: 10, borderRadius: '50%', background: C.green, opacity: 0.35, animation: 'ripple 1.5s ease-out infinite' }} />}
                            <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', width: 7, height: 7, borderRadius: '50%', background: on ? C.green : C.textDim, boxShadow: on ? `0 0 4px ${C.green}` : 'none' }} />
                          </div>
                          <div style={{ fontSize: 9, fontWeight: 700, color: on ? C.green : C.textDim, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 3 }}>
                            P{i}
                          </div>
                          <div style={{ fontSize: 10, fontWeight: 800, color: on ? C.green : C.textDim }}>
                            {on ? 'ON' : 'OFF'}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>

                {/* Vannes */}
                <div style={{ flex: 1, paddingLeft: isMobile ? 0 : 24 }}>
                  <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.10em', color: C.textDim, marginBottom: 12 }}>
                    Vannes zones
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
                    {[1,2,3,4].map(i => {
                      const raw = parseInt(cycle[`valve${i}`])
                      const on = !isNaN(raw) && raw !== 0
                      const label = on ? `V${raw}` : `V${i}`
                      return (
                        <div key={i} style={{
                          display: 'flex', flexDirection: 'column', alignItems: 'center',
                          padding: '10px 6px', borderRadius: 10,
                          background: on ? (dark ? 'rgba(52,217,111,0.10)' : 'rgba(52,217,111,0.07)') : (dark ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.02)'),
                          border: `1.5px solid ${on ? C.green + '40' : C.border}`,
                          transition: 'all 0.2s',
                          opacity: on ? 1 : 0.45,
                        }}>
                          <div style={{ position: 'relative', width: 10, height: 10, marginBottom: 7 }}>
                            {on && <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', width: 10, height: 10, borderRadius: '50%', background: C.green, opacity: 0.35, animation: 'ripple 1.5s ease-out infinite' }} />}
                            <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', width: 7, height: 7, borderRadius: '50%', background: on ? C.green : C.textDim, boxShadow: on ? `0 0 4px ${C.green}` : 'none' }} />
                          </div>
                          <div style={{ fontSize: 9, fontWeight: 700, color: on ? C.green : C.textDim, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 3 }}>
                            {label}
                          </div>
                          <div style={{ fontSize: 10, fontWeight: 800, color: on ? C.green : C.textDim }}>
                            {on ? 'ON' : 'OFF'}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>

              </div>
            </div>

            {/* ── Fertigation — grille compacte toutes les canaux ── */}
            <div style={{
              background: C.card, border: `1.5px solid ${C.border}`,
              borderRadius: 14, padding: isMobile ? '14px 16px' : '18px 24px',
              marginBottom: 14,
            }}>
              <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.10em', color: C.textDim, marginBottom: 14 }}>
                Fertigation — 8 canaux
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: isMobile ? 'repeat(4,1fr)' : 'repeat(8,1fr)', gap: 8 }}>
                  {[1,2,3,4,5,6,7,8].map(i => {
                    const act = live.fertigation[`fert_act${i}`]
                    const max = live.fertigation[`fert_max${i}`]
                    const flow = live.fertigation[`fert_flow${i}`]
                    const on = act !== null && act !== undefined && Number(act) > 0
                    const pct = on && max > 0 ? Math.min((act / max) * 100, 100) : 0
                    return (
                      <div key={i} style={{
                        borderRadius: 10, padding: '10px 8px',
                        background: on ? (dark ? 'rgba(52,217,111,0.08)' : 'rgba(52,217,111,0.05)') : (dark ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.02)'),
                        border: `1.5px solid ${on ? C.green + '35' : C.border}`,
                        opacity: on ? 1 : 0.4,
                        display: 'flex', flexDirection: 'column', gap: 4,
                      }}>
                        {/* Header F1-F8 + dot */}
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                          <span style={{ fontSize: 10, fontWeight: 800, color: on ? C.green : C.textDim }}>F{i}</span>
                          <StatusDot on={on} C={C} size={8} />
                        </div>
                        {/* Valeur */}
                        <div style={{ fontSize: 16, fontWeight: 900, color: on ? C.green : C.textDim, lineHeight: 1 }}>
                          {on ? act : '—'}
                        </div>
                        <div style={{ fontSize: 9, color: C.textDim }}>% ouv.</div>
                        {/* Barre progression */}
                        <div style={{ height: 3, borderRadius: 2, background: on ? C.border : C.border, overflow: 'hidden' }}>
                          <div style={{ width: `${pct}%`, height: '100%', background: C.green, borderRadius: 2, transition: 'width 0.4s' }} />
                        </div>
                        {/* Flow */}
                        <div style={{ fontSize: 9, color: C.textDim, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {on && flow !== null ? `${flow} mL` : '—'}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>

            {/* Programme — uniquement valeurs significatives */}
            <div style={{
              background: C.card, border: `1.5px solid ${C.border}`,
              borderRadius: 14, padding: '20px 24px', marginBottom: 16,
            }}>
              {/* Status bar — uniquement modes actifs */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18 }}>
                <div style={{ color: C.textMuted, fontSize: 11, fontWeight: 630, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                  Programme en cours
                </div>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {[
                    { label: 'Irrigation',  val: cycle.irrigation_active },
                    { label: 'Fertigation', val: cycle.fert_active },
                    { label: 'Booster',     val: cycle.booster_active },
                    { label: 'Misting',     val: cycle.misting_active },
                    { label: 'Cooling',     val: cycle.cooling_active },
                    { label: 'Flushing',    val: cycle.flushing_active },
                  ].filter(({ val }) => val === 'On' || val === 'on' || val === true || val === '1')
                    .map(({ label }) => (
                    <div key={label} style={{
                      display: 'flex', alignItems: 'center', gap: 8,
                      padding: '6px 14px', borderRadius: 20,
                      background: C.green + '15', border: `1.5px solid ${C.green}40`,
                      fontSize: 11, fontWeight: 630, color: C.green,
                    }}>
                      <div style={{ position: 'relative', width: 8, height: 8, flexShrink: 0 }}>
                        <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', width: 8, height: 8, borderRadius: '50%', background: C.green, opacity: 0.4, animation: 'ripple 1.5s ease-out infinite' }} />
                        <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', width: 6, height: 6, borderRadius: '50%', background: C.green, boxShadow: `0 0 5px ${C.green}` }} />
                      </div>
                      {label}
                    </div>
                  ))}
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : isTablet ? '1fr 1fr' : '1fr 1fr 1fr', gap: 16 }}>

                {/* Groupe Cycle */}
                <div style={{ background: C.surface, borderRadius: 10, padding: '14px 16px', border: `1px solid ${C.border}` }}>
                  <div style={{ color: C.textDim, fontSize: 10, fontWeight: 630, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 10 }}>Cycle</div>
                  {[
                    ['Prog',       cycle.cycle_prog],
                    ['Actuel',     cycle.cycle_act],
                    ['Séq. act',   cycle.sequence],
                    ['Proch. séq', cycle.next_sequence],
                    ['Proch. à',   cycle.next_seq_time],
                    ['Restant',    cycle.remaining_time],
                  ].map(([label, val]) => (
                    <div key={label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '5px 0', borderBottom: `1px solid ${C.border}`, fontSize: 12 }}>
                      <span style={{ color: C.textMuted }}>{label}</span>
                      <span style={{ color: C.text, fontWeight: 630 }}>
                        {val !== null && val !== undefined && String(val) !== '' ? String(val) : '—'}
                      </span>
                    </div>
                  ))}
                </div>

                {/* Groupe Eau */}
                <div style={{ background: C.surface, borderRadius: 10, padding: '14px 16px', border: `1px solid ${C.border}` }}>
                  <div style={{ color: C.textDim, fontSize: 10, fontWeight: 630, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 10 }}>Eau</div>
                  {[
                    ['Mode',      cycle.water_mode],
                    ['Qté prog',  cycle.water_prg_qty],
                    ['Qté act',   cycle.water_act_qty != null ? Number(cycle.water_act_qty).toFixed(2) : null],
                    ['T. prog',   cycle.water_prg_time],
                    ['T. actuel', cycle.water_act_time],
                    ['Restante',  cycle.water_left],
                  ].map(([label, val]) => (
                    <div key={label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '5px 0', borderBottom: `1px solid ${C.border}`, fontSize: 12 }}>
                      <span style={{ color: C.textMuted }}>{label}</span>
                      <span style={{ color: C.text, fontWeight: 630 }}>
                        {val !== null && val !== undefined && String(val) !== '' ? String(val) : '—'}
                      </span>
                    </div>
                  ))}
                </div>

                {/* Groupe Statut */}
                <div style={{ background: C.surface, borderRadius: 10, padding: '14px 16px', border: `1px solid ${C.border}` }}>
                  <div style={{ color: C.textDim, fontSize: 10, fontWeight: 630, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 10 }}>Statut</div>
                  {[
                    ['Valve prog',  cycle.valve_prog],
                    ['Fert prog',   cycle.fert_prog],
                    ['EC/pH',       sensor.ec_ph_status],
                    ['Pause',       cycle.pause > 0 ? 'Active' : 'Non'],
                    ['Manuel',      cycle.manual_prog > 0 ? 'Actif' : 'Non'],
                    ['Vannes irr',  cycle.valves_in_irrig],
                  ].map(([label, val]) => (
                    <div key={label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '5px 0', borderBottom: `1px solid ${C.border}`, fontSize: 12 }}>
                      <span style={{ color: C.textMuted }}>{label}</span>
                      <span style={{
                        color: label === 'EC/pH'   && val === 'Irrigation' ? C.green
                             : label === 'EC/pH'   && val === 'Wait'       ? C.amber
                             : label === 'Pause'   && val === 'Active'     ? C.amber
                             : label === 'Manuel'  && val === 'Actif'      ? C.blue
                             : C.text,
                        fontWeight: 630, fontVariantNumeric: 'tabular-nums',
                      }}>
                        {val !== null && val !== undefined && String(val) !== '' ? String(val) : '—'}
                      </span>
                    </div>
                  ))}
                </div>

              </div>
            </div>
          </>
        )
      })() : !loadingL ? (
        <div style={{ color: C.textDim, fontSize: 12, padding: '20px 0' }}>
          Aucune donnée de cycle disponible
        </div>
      ) : null}

      {/* ── Tours d'irrigation ──────────────────────────────────── */}
      <div style={{ display:'flex', alignItems:'center', gap:8, marginTop:32, marginBottom:14 }}>
        <div style={{ width:3, height:18, background:C.green, borderRadius:2 }} />
        <span style={{ color:C.text, fontSize:14, fontWeight:800 }}>Tours d'irrigation</span>
      </div>

      <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:14 }}>

        {/* Trigger calendrier — même style que Graphiques */}
        <div style={{ position: 'relative' }}>
          <div
            ref={tourCalTriggerRef}
            onClick={() => {
              const r = tourCalTriggerRef.current.getBoundingClientRect()
              const spaceBelow = window.innerHeight - r.bottom
              if (spaceBelow < 340)
                setTourCalPos({ bottom: window.innerHeight - r.top + 6, top: 'auto', left: r.left })
              else
                setTourCalPos({ top: r.bottom + 6, bottom: 'auto', left: r.left })
              setShowTourCal(v => !v)
            }}
            style={{
              display: 'flex', alignItems: 'center', gap: 10,
              padding: '7px 14px', borderRadius: 8, minHeight: 34,
              cursor: 'pointer',
              border: `1.5px solid ${showTourCal ? C.green : C.border}`,
              background: C.inputBg, transition: 'border-color 0.15s',
              fontFamily: 'inherit',
            }}
          >
            <Calendar size={14} color={showTourCal || tourDate !== today() ? C.green : C.textDim} strokeWidth={2} />
            <span style={{ fontSize: 12, fontWeight: 630, color: C.text }}>
              {fmtDisplay(tourDate)}
            </span>
          </div>

          {showTourCal && createPortal(
            <div
              ref={tourCalPortalRef}
              style={{
                position: 'fixed',
                top: tourCalPos.top !== 'auto' ? tourCalPos.top : 'auto',
                bottom: tourCalPos.bottom !== 'auto' ? tourCalPos.bottom : 'auto',
                left: tourCalPos.left,
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
                value={tourDate}
                onChange={v => { if (v) { setTourDate(v); setShowTourCal(false) } }}
                C={C}
              />
            </div>,
            document.body
          )}          
        </div>

        {tourDate !== today() && (
          <button onClick={() => setTourDate(today())} style={{
            padding: '6px 10px', borderRadius: 7,
            border: `1.5px solid ${C.border}`,
            background: C.inputBg, color: C.text,
            fontSize: 12, fontFamily: 'inherit', cursor: 'pointer', outline: 'none',
          }}>Aujourd'hui</button>
        )}

        <span style={{ color: C.textDim, fontSize: 11 }}>
          {tours ? `${tours.total_tours} tour${tours.total_tours > 1 ? 's' : ''} enregistrés` : ''}
        </span>
      </div>      

      {loadingTours ? null : (() => {

        // ---------------------------
        // CONFIGURATION
        // ---------------------------
        const validTours = (tours?.tours || []).filter(t => t !== null && t.debut !== null && t.debut !== undefined);
        const MAX_TOURS = 10;

        // Si 0 tours réels → 0 colonnes (message vide affiché)
        // Si tours présents → max(nb tours réels, 10)
        const totalCols = validTours.length === 0
          ? 0
          : Math.max(validTours.length, MAX_TOURS);

        const mergedTours = Array.from({ length: totalCols }, (_, i) => validTours[i] || null);

        // ---------------------------
        // RENDER
        // ---------------------------
        return (
          <div style={{
            background: C.card,
            border: `1.5px solid ${C.border}`,
            borderRadius: 14,
            overflow: 'hidden',
            marginBottom: 28
          }}>
            {mergedTours.length === 0 ? (
              <div style={{
                padding: '40px',
                textAlign: 'center',
                color: C.textDim,
                fontSize: 12,
              }}>
                Aucun tour d'irrigation enregistré pour cette date
              </div>
            ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: 'inherit' }}>

                {/* ---------------------------
                    HEADER FIXE
                --------------------------- */}
                <thead>
                  <tr style={{
                    background: dark ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.02)'
                  }}>
                    <th style={{
                      padding: '11px 14px',
                      textAlign: 'left',
                      width: '16%',
                      color: C.textDim,
                      fontSize: 12,
                      fontWeight: 630,
                      textTransform: 'uppercase',
                      letterSpacing: '0.04em',
                      borderBottom: `1.5px solid ${C.border}`,
                      whiteSpace: 'nowrap',
                    }}>Tours</th>

                    <th style={{
                      padding: '11px 14px',
                      textAlign: 'center',
                      width: '5%',
                      color: C.textDim,
                      fontSize: 12,
                      fontWeight: 630,
                      textTransform: 'uppercase',
                      letterSpacing: '0.04em',
                      borderBottom: `1.5px solid ${C.border}`,
                      whiteSpace: 'nowrap',
                    }}>House</th>

                    {mergedTours.map((t, i) => (
                      <th key={i} style={{
                        padding: '11px 10px',
                        textAlign: 'center',
                        fontSize: 12,
                        fontWeight: 630,
                        borderBottom: `1.5px solid ${C.border}`,
                        whiteSpace: 'nowrap',
                        color: t ? C.green : C.textDim,
                        background: t?.debut
                          ? (dark ? 'rgba(52,217,111,0.08)' : 'rgba(52,217,111,0.05)')
                          : 'transparent',
                      }}>
                        {i + 1}
                      </th>
                    ))}
                  </tr>
                </thead>

                {/* ---------------------------
                    BODY
                --------------------------- */}
                <tbody>
                  {[
                    { label: 'Radiation (J/cm²)',       key: 'radiation_sum' },
                    { label: 'Cumul Radiation (J/cm²)', key: 'cumul_radiation' }, 
                    { label: 'Heure (Début)', key: 'debut' },
                    { label: 'Heure (Fin)', key: 'fin' },
                    { label: 'Durée Prog (min)', key: 'prg_time_min' },
                    { label: 'Durée Complète (min)', key: 'duree_min' },
                    { label: 'Temps repos (min)', key: 'repos_apres_min' },
                    { label: 'V. Apport (cc)', key: 'v_apport' },
                    { label: 'EC Apport', key: 'ec_apport' },
                    { label: 'pH Apport', key: 'ph_apport' },
                  ].map((row) => (
                    <tr
                      key={row.key}
                      style={{
                        borderBottom: `1px solid ${C.border}`,
                        transition: 'background 0.12s'
                      }}
                      onMouseEnter={e => e.currentTarget.style.background = C.tableHover}
                      onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                    >

                      {/* LABEL */}
                      <td style={{
                        padding: '10px 14px',
                        color: C.textDim,
                        fontSize: 12,
                        fontWeight: 630,
                        textTransform: 'uppercase',
                        letterSpacing: '0.04em',
                        whiteSpace: 'nowrap',
                      }}>{row.label}</td>

                      {/* HOUSE */}
                      <td style={{
                        padding: '10px 14px',
                        color: C.textMuted,
                        fontSize: 12,
                        fontWeight: 600,
                        textAlign: 'center',
                      }}>{deviceInfo.house_number}</td>

                      {/* VALEURS TOURS */}
                      {mergedTours.map((t, i) => {
                        const val = t?.[row.key]
                        return (
                          <td key={i} style={{
                            padding: '10px 10px',
                            textAlign: 'center',
                            color: val != null ? C.text : C.textDim,
                            fontSize: 12,
                            fontWeight: val != null ? 630 : 400,
                            fontVariantNumeric: 'tabular-nums',
                            background: t?.debut
                              ? (dark ? 'rgba(52,217,111,0.04)' : 'rgba(52,217,111,0.02)')
                              : 'transparent',
                          }}>
                            {val != null
                              ? (row.key === 'cumul_radiation' ? Number(val).toFixed(2) : String(val))
                              : '-'}
                          </td>
                        )
                      })}
                    </tr>
                  ))}
                </tbody>

              </table>
            </div>
            )}
          </div>
        )
      })()}

      {/* ── Sélecteur de période ─────────────────────────────── */}
      <div style={{ display:'flex', alignItems:'center', gap:12, marginBottom:14, marginTop:32 }}>
        <div style={{ width:3, height:18, background:C.green, borderRadius:2 }} />
        <span style={{ color:C.text, fontSize:14, fontWeight:800 }}>Graphiques</span>
      </div>

      <div style={{ display:'flex', flexDirection: isMobile ? 'column' : 'row', alignItems: isMobile ? 'flex-start' : 'center', gap: isMobile ? 8 : 12, marginBottom:20 }}>

        {/* Trigger calendrier */}
        <div style={{ position: 'relative' }}>
          <div
            ref={chartCalTriggerRef}
            onClick={() => {
              const r = chartCalTriggerRef.current.getBoundingClientRect()
              const spaceBelow = window.innerHeight - r.bottom
              if (spaceBelow < 340)
                setChartCalPos({ bottom: window.innerHeight - r.top + 6, top: 'auto', left: r.left })
              else
                setChartCalPos({ top: r.bottom + 6, bottom: 'auto', left: r.left })
              setShowChartCal(v => !v)
            }}
            style={{
              display: 'flex', alignItems: 'center', gap: 10,
              padding: '7px 14px', borderRadius: 8, minHeight: 34,
              cursor: 'pointer',
              border: `1.5px solid ${showChartCal ? C.green : C.border}`,
              background: C.inputBg, transition: 'border-color 0.15s',
              fontFamily: 'inherit',
            }}
          >
            <Calendar size={14} color={showChartCal || chartDateFrom !== today() ? C.green : C.textDim} strokeWidth={2} />
            <span style={{ fontSize: 12, fontWeight: 630, color: C.text }}>
              {fmtDisplay(chartDateFrom)}
            </span>
            <MoveRight size={13} strokeWidth={2} color={C.textDim} />
            <span style={{ fontSize: 12, fontWeight: 630, color: chartDateTo ? C.green : C.textDim }}>
              {chartDateTo ? fmtDisplay(chartDateTo) : '—'}
            </span>
            {chartDateFrom && chartDateTo && (
              <span style={{ fontSize: 11, color: C.textDim, marginLeft: 4 }}>
                {Math.round((new Date(chartDateTo) - new Date(chartDateFrom)) / 86400000) + 1} j
              </span>
            )}
          </div>

          {showChartCal && createPortal(
            <div
              ref={chartCalPortalRef}
              style={{
                position: 'fixed',
                top: chartCalPos.top !== 'auto' ? chartCalPos.top : 'auto',
                bottom: chartCalPos.bottom !== 'auto' ? chartCalPos.bottom : 'auto',
                left: chartCalPos.left,
                zIndex: 99999,
                border: `1.5px solid ${C.border}`,
                borderRadius: 12,
                padding: '16px 20px',
                background: dark ? C.surface : '#fafcfb',
                boxShadow: '0 8px 32px rgba(0,0,0,0.35)',
                width: isMobile ? 280 : 560,
              }}
            >
              <RangeCalendar
                dateFrom={chartDateFrom}
                dateTo={chartDateTo}
                onChangeFrom={v => setChartDateFrom(v)}
                onChangeTo={v => { setChartDateTo(v); if (v) setShowChartCal(false) }}
                C={C}
                onClose={() => setShowChartCal(false)}
                singleMonth={isMobile}
              />
            </div>,
            document.body
          )}
        </div>

        {(chartDateFrom !== today() || chartDateTo !== today()) && (
          <button
            onClick={() => { setChartDateFrom(today()); setChartDateTo(today()) }}
            style={{
              padding: '6px 10px', borderRadius: 7,
              border: `1.5px solid ${C.border}`,
              background: C.inputBg, color: C.text,
              fontSize: 12, fontFamily: 'inherit',
              cursor: 'pointer', outline: 'none',
            }}
          >
            Aujourd'hui
          </button>
        )}
        {(chartZoomFrom || chartZoomTo) && (
          <button onClick={() => { setChartZoomFrom(null); setChartZoomTo(null); isZoomedRef.current = false }} style={{
            display: 'flex', alignItems: 'center', gap: 6,
            padding: '5px 14px', background: 'transparent',
            border: `1.5px solid ${C.green}`, borderRadius: 7,
            color: C.green, fontSize: 12, fontWeight: 630,
            cursor: 'pointer', fontFamily: 'inherit',
          }}>
            <RefreshCw size={12} strokeWidth={2} /> Reset zoom
          </button>
        )}
      </div>

      {/* ── 4 Graphiques ─────────────────────────────────────── */}
      {(
        <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: 16, marginBottom: 28 }}>

          {/* Graphique 1 — EC Apport */}
          <ChartCard
            title="EC Apport"
            C={C}
            dark={dark}
            onSelectRange={(from, to) => { setChartZoomFrom(from); setChartZoomTo(to); isZoomedRef.current = true }}
            series={[
              {
                label: 'EC actuel (mS/cm)',
                color: '#34d96f',
                unit: 'mS/cm',
                decimals: 2,
                dashed: false,
                data: (() => {
                  if (!chartData?.data) return []
                  const fromBound = chartZoomFrom ? chartZoomFrom + ' 00:00:00' : null
                  const toBound   = chartZoomTo   ? chartZoomTo   + ' 23:59:59' : null
                  return [...chartData.data].reverse().filter(d => {
                    if (!fromBound && !toBound) return true
                    const ts = d.timestamp.replace('T', ' ')
                    if (fromBound && ts < fromBound) return false
                    if (toBound   && ts > toBound)   return false
                    return true
                  }).map(d => ({ timestamp: d.timestamp, value: d.ec_actual ?? 0 }))
                })(),
              },
              {
                label: 'EC programmé (mS/cm)',
                color: '#34d96f',
                unit: 'mS/cm',
                decimals: 2,
                dashed: true,
                data: (() => {
                  if (!chartData?.data) return []
                  const fromBound = chartZoomFrom ? chartZoomFrom + ' 00:00:00' : null
                  const toBound   = chartZoomTo   ? chartZoomTo   + ' 23:59:59' : null
                  const filtered = [...chartData.data].reverse().filter(d => {
                    if (!fromBound && !toBound) return true
                    const ts = d.timestamp.replace('T', ' ')
                    if (fromBound && ts < fromBound) return false
                    if (toBound   && ts > toBound)   return false
                    return true
                  })
                  const progVal = filtered.find(d => d.ec_prog && d.ec_prog > 0)?.ec_prog ?? null
                  if (!progVal) return []
                  return filtered.map(d => ({ timestamp: d.timestamp, value: progVal }))
                })(),
              },
            ]}
          />

          {/* Graphique 2 — pH Apport */}
          <ChartCard
            title="pH Apport"
            C={C}
            dark={dark}
            onSelectRange={(from, to) => { setChartZoomFrom(from); setChartZoomTo(to); isZoomedRef.current = true }}
            series={[
              {
                label: 'pH actuel',
                color: '#4d9de0',
                unit: '',
                decimals: 2,
                dashed: false,
                data: (() => {
                  if (!chartData?.data) return []
                  const fromBound = chartZoomFrom ? chartZoomFrom + ' 00:00:00' : null
                  const toBound   = chartZoomTo   ? chartZoomTo   + ' 23:59:59' : null
                  return [...chartData.data].reverse().filter(d => {
                    if (!fromBound && !toBound) return true
                    const ts = d.timestamp.replace('T', ' ')
                    if (fromBound && ts < fromBound) return false
                    if (toBound   && ts > toBound)   return false
                    return true
                  }).map(d => ({ timestamp: d.timestamp, value: d.ph_actual ?? 0 }))
                })(),
              },
              {
                label: 'pH programmé',
                color: '#4d9de0',
                unit: '',
                decimals: 2,
                dashed: true,
                data: (() => {
                  if (!chartData?.data) return []
                  const fromBound = chartZoomFrom ? chartZoomFrom + ' 00:00:00' : null
                  const toBound   = chartZoomTo   ? chartZoomTo   + ' 23:59:59' : null
                  const filtered = [...chartData.data].reverse().filter(d => {
                    if (!fromBound && !toBound) return true
                    const ts = d.timestamp.replace('T', ' ')
                    if (fromBound && ts < fromBound) return false
                    if (toBound   && ts > toBound)   return false
                    return true
                  })
                  const progVal = filtered.find(d => d.ph_prog && d.ph_prog > 0)?.ph_prog ?? null
                  if (!progVal) return []
                  return filtered.map(d => ({ timestamp: d.timestamp, value: progVal }))
                })(),
              },
            ]}
          />

          {/* Graphique 3 — Température Serre */}
          <ChartCard
            title="Température Serre"
            C={C}
            dark={dark}
            onSelectRange={(from, to) => { setChartZoomFrom(from); setChartZoomTo(to); isZoomedRef.current = true }}
            series={[
              {
                label: 'Température Serre actuel (°C)',
                color: '#f5a623',
                unit: '°C',
                decimals: 1,
                data: buildSeries('avg_temp'),
              }
            ]}
          />

          {/* Graphique 4 — Humidité Serre */}
          <ChartCard
            title="Humidité Serre"
            C={C}
            dark={dark}
            onSelectRange={(from, to) => { setChartZoomFrom(from); setChartZoomTo(to); isZoomedRef.current = true }}
            series={[
              {
                label: 'Humidité Serre (%)',
                color: '#b197fc',
                unit: '%',
                decimals: 1,
                data: buildSeries('humidity'),
              }
            ]}
          />

          {/* Graphique 5 — Température Ext. (si capteur présent) */}
          {(sensor.outside_temp != null || sensor.outside_humidity != null) && (
            <ChartCard
              title="Température Extérieure"
              C={C}
              dark={dark}
              onSelectRange={(from, to) => { setChartZoomFrom(from); setChartZoomTo(to); isZoomedRef.current = true }}
              series={[
                ...(sensor.outside_temp != null ? [{
                  label   : 'Température Ext. (°C)',
                  color   : '#f05252',
                  unit    : '°C',
                  decimals: 1,
                  data    : buildSeries('outside_temp'),
                }] : [])
              ]}
            />
          )}

          {/* Graphique 6 — Humidité Ext. (si capteur présent) */}
          {(sensor.outside_temp != null || sensor.outside_humidity != null) && (
            <ChartCard
              title="Humidité Extérieure"
              C={C}
              dark={dark}
              onSelectRange={(from, to) => { setChartZoomFrom(from); setChartZoomTo(to); isZoomedRef.current = true }}
              series={[
                ...(sensor.outside_humidity != null ? [{
                  label   : 'Humidité Ext. (%)',
                  color   : '#4d9de0',
                  unit    : '%',
                  decimals: 1,
                  data    : buildSeries('outside_humidity'),
                }] : []),
              ]}
            />
          )}

          {/* Graphique 7 — Radiation solaire */}
          <ChartCard
            title="Radiation solaire"
            C={C}
            dark={dark}
            onSelectRange={(from, to) => { setChartZoomFrom(from); setChartZoomTo(to); isZoomedRef.current = true }}
            series={[
              {
                label: 'Radiation actuel (W/m²)',
                color: '#f5e642',
                unit: 'W/m²',
                decimals: 1,
                data: buildSeries('radiation'),
              }
            ]}
          />
          
          {/* Graphique 8 — Radiation solaire */}
          <ChartCard
            title="Radiation solaire"
            C={C}
            dark={dark}
            onSelectRange={(from, to) => { setChartZoomFrom(from); setChartZoomTo(to); isZoomedRef.current = true }}
            series={[
              {
                label: 'Cumul journalier actuel (J/cm²)',
                color: '#f5a623',
                unit: 'J/cm²',
                decimals: 1,
                data: buildSeries('radiation_sum'),
              }
            ]}
          />

          {/* Graphique 9 — Débit */}
          <ChartCard
            title="Débit"
            C={C}
            dark={dark}
            onSelectRange={(from, to) => { setChartZoomFrom(from); setChartZoomTo(to); isZoomedRef.current = true }}
            series={[
              {
                label: 'Débit actuel (L/h)',
                color: '#ff48bf',
                unit: 'L/h',
                decimals: 0,
                data: buildSeries('flow'),
              }
            ]}
          />

          {/* Graphique 10 — Débit */}
          <ChartCard
            title="Irrigation"
            C={C}
            dark={dark}
            onSelectRange={(from, to) => { setChartZoomFrom(from); setChartZoomTo(to); isZoomedRef.current = true }}
            series={[
              {
                label: 'Débit nominal actuel (L/h)',
                color: '#05e4bf',
                unit: 'L/h',
                decimals: 0,
                data: buildSeries('flow_nominal') ,
              }
            ]}
          />

          {/* Graphique 11 — Poids substrat (si données disponibles) */}
          {weightData && weightData.length > 0 && (() => {
            const series = [...weightData]
              .reverse()
              .filter(d => {
                if (!chartZoomFrom && !chartZoomTo) return true
                const ts = d.timestamp.replace('T', ' ')
                if (chartZoomFrom && ts < chartZoomFrom + ' 00:00:00') return false
                if (chartZoomTo   && ts > chartZoomTo   + ' 23:59:59') return false
                return true
              })
              .map(d => ({ timestamp: d.timestamp, value: d.poids_kg }))

            return (
              <ChartCard
                title={`Poids substrat — ${deviceInfo.farm_name}`}
                C={C}
                dark={dark}
                onSelectRange={(from, to) => { setChartZoomFrom(from); setChartZoomTo(to); isZoomedRef.current = true }}
                series={[{
                  label   : 'Poids (kg)',
                  color   : '#34d96f',
                  unit    : 'kg',
                  decimals: 2,
                  data    : series,
                }]}
              />
            )
          })()}
        </div>
      )}

      {/* ── Historique table ─────────────────────────────────── */}
      <div style={{ display:'flex', alignItems:'center', gap:8, marginTop:32, marginBottom:12 }}>
        <div style={{ width:3, height:18, background:C.green, borderRadius:2 }} />
        <span style={{ color:C.text, fontSize:14, fontWeight:800 }}>
          Historique — {deviceInfo.farm_name} Station {deviceInfo.house_number}
        </span>
      </div>

      {/* Date filtre + Export CSV sur même ligne */}
      <div style={{ display: 'flex', flexDirection: isMobile ? 'column' : 'row', alignItems: isMobile ? 'flex-start' : 'center', justifyContent:'space-between', marginBottom:8, gap: isMobile ? 8 : 0 }}>

        <div style={{ display:'flex', alignItems:'center', gap:8 }}>

          <div style={{ position: 'relative' }}>
            <div
              ref={histCalTriggerRef}
              onClick={() => {
                const r = histCalTriggerRef.current.getBoundingClientRect()
                const spaceBelow = window.innerHeight - r.bottom
                if (spaceBelow < 340)
                  setHistCalPos({ bottom: window.innerHeight - r.top + 6, top: 'auto', left: r.left })
                else
                  setHistCalPos({ top: r.bottom + 6, bottom: 'auto', left: r.left })
                setShowHistCal(v => !v)
              }}
              style={{
                display: 'flex', alignItems: 'center', gap: 10,
                padding: '7px 14px', borderRadius: 8, minHeight: 34,
                cursor: 'pointer',
                border: `1.5px solid ${showHistCal ? C.green : C.border}`,
                background: C.inputBg, transition: 'border-color 0.15s',
                fontFamily: 'inherit',
              }}
            >
              <Calendar size={14} color={showHistCal || dateFrom !== today() ? C.green : C.textDim} strokeWidth={2} />
              <span style={{ fontSize: 12, fontWeight: 630, color: C.text }}>
                {fmtDisplay(dateFrom)}
              </span>
              <MoveRight size={13} strokeWidth={2} color={C.textDim} />
              <span style={{ fontSize: 12, fontWeight: 630, color: dateTo ? C.green : C.textDim }}>
                {dateTo ? fmtDisplay(dateTo) : '—'}
              </span>
              {dateFrom && dateTo && (
                <span style={{ fontSize: 11, color: C.textDim, marginLeft: 4 }}>
                  {Math.round((new Date(dateTo) - new Date(dateFrom)) / 86400000) + 1} j
                </span>
              )}
            </div>

            {showHistCal && createPortal(
              <div
                ref={histCalPortalRef}
                style={{
                  position: 'fixed',
                  top: histCalPos.top !== 'auto' ? histCalPos.top : 'auto',
                  bottom: histCalPos.bottom !== 'auto' ? histCalPos.bottom : 'auto',
                  left: histCalPos.left,
                  zIndex: 99999,
                  border: `1.5px solid ${C.border}`,
                  borderRadius: 12,
                  padding: '16px 20px',
                  background: dark ? C.surface : '#fafcfb',
                  boxShadow: '0 8px 32px rgba(0,0,0,0.35)',
                  width: isMobile ? 280 : 560,
                }}
              >
                <RangeCalendar
                  dateFrom={dateFrom}
                  dateTo={dateTo}
                  onChangeFrom={v => setDateFrom(v)}
                  onChangeTo={v => { setDateTo(v); if (v) setShowHistCal(false) }}
                  C={C}
                  onClose={() => setShowHistCal(false)}
                  singleMonth={isMobile}
                />
              </div>,
              document.body
            )}
          </div>

          {(dateFrom !== today() || dateTo !== today()) && (
            <button
              onClick={() => { setDateFrom(today()); setDateTo(today()) }}
              style={{
                padding: '6px 10px',
                borderRadius: 7,
                border: `1.5px solid ${C.border}`,
                background: C.inputBg,
                color: C.text,
                fontSize: 12,
                fontFamily: 'inherit',
                cursor: 'pointer',
                outline: 'none',
              }}
            >
              Aujourd'hui
            </button>
          )}
        </div>

        <button onClick={handleExport} disabled={exporting} style={{
          display:'flex', alignItems:'center', gap:6,
          padding:'8px 18px', background: C.toggleBg,
          border: `1px solid ${dark ? '#1c2e22' : '#c0d8c8'}`, borderRadius:7,
          color:C.green, fontSize:12, fontWeight:630,
          cursor: exporting ? 'not-allowed' : 'pointer',
          opacity: exporting ? 0.6 : 1, fontFamily:'inherit',
        }}>
          <Download size={12} strokeWidth={2} />
          {exporting ? 'Export…' : 'Export Excel'}
        </button>
      </div>

      {/* Lectures count */}
      <div style={{ color:C.textDim, fontSize:11, marginBottom:14 }}>
        {history?.total ?? 0} lectures du {dateFrom} au {dateTo}
      </div>

      {errorH ? (
        <div style={{ color: C.red, fontSize: 12 }}>{errorH}</div>
      ) : (
        <div style={{ background: C.card, border: `1.5px solid ${C.border}`, borderRadius: 14, overflow: 'hidden' }}>
          <div style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
            <table style={{ width: '100%', minWidth: isMobile ? 600 : 'auto', borderCollapse: 'collapse', fontFamily: 'inherit' }}>
              <thead>
                <tr style={{ background: dark ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.02)' }}>
                  {[
                    { label: 'Timestamp',   col: 'timestamp' },
                    { label: 'EC Apport (mS/cm)', col: 'ec_actual' },
                    { label: 'pH Apport',          col: 'ph_actual' },
                    { label: 'Temp (°C)',   col: 'avg_temp' },
                    { label: 'Hum (%)',     col: 'humidity' },
                    { label: 'Rad (W/m²)', col: 'radiation' },
                    { label: 'Débit (L/h)', col: 'flow' },
                    { label: 'Statut',      col: null },
                  ].map(({ label, col }) => (
                    <th key={label}
                      onClick={() => {
                        if (!col) return
                        if (sortCol === col) setSortDir(d => d === 'desc' ? 'asc' : 'desc')
                        else { setSortCol(col); setSortDir('desc') }
                      }}
                      style={{
                        padding: '11px 14px', textAlign: 'left',
                        color: sortCol === col ? C.green : C.textDim,
                        fontSize: 12, fontWeight: 630,
                        textTransform: 'uppercase', letterSpacing: '0.07em',
                        borderBottom: `1.5px solid ${C.border}`, whiteSpace: 'nowrap',
                        cursor: col ? 'pointer' : 'default',
                        userSelect: 'none',
                      }}
                    >
                      {label}
                      {col && sortCol === col && (
                        <span style={{ marginLeft: 4 }}>{sortDir === 'desc' ? '↓' : '↑'}</span>
                      )}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {(() => {
                  const sorted = [...(history?.data || [])].sort((a, b) => {
                    const va = a[sortCol] ?? ''
                    const vb = b[sortCol] ?? ''
                    if (va < vb) return sortDir === 'desc' ? 1 : -1
                    if (va > vb) return sortDir === 'desc' ? -1 : 1
                    return 0
                  })
                  return !sorted.length ? (
                  <tr>
                    <td colSpan={8} style={{ padding: 40, textAlign: 'center', color: C.textDim, fontSize: 12 }}>
                      Aucune donnée sur cette période
                    </td>
                  </tr>
                ) : sorted.map((row, i) => (
                  <tr key={i}
                    style={{ borderBottom: `1px solid ${C.border}`, transition: 'background 0.12s' }}
                    onMouseEnter={e => e.currentTarget.style.background = C.tableHover}
                    onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                  >
                    <td style={{ padding: '10px 14px', color: C.textDim, fontSize: 12, whiteSpace: 'nowrap' }}>
                      {fmtTs(row.timestamp)}
                    </td>
                    <td style={{ padding: '10px 14px', fontWeight: 630, fontSize: 12, color: C.text }}>
                      {fmt(row.ec_actual, 2)}
                    </td>
                    <td style={{ padding: '10px 14px', fontWeight: 630, fontSize: 12, color: C.text }}>
                      {fmt(row.ph_actual, 2)}
                    </td>
                    <td style={{ padding: '10px 14px', fontWeight: 630, fontSize: 12, color: C.text }}>
                      {fmt(row.avg_temp, 1)}
                    </td>
                    <td style={{ padding: '10px 14px', fontWeight: 630, fontSize: 12, color: C.text }}>
                      {fmt(row.humidity, 1)}
                    </td>
                    <td style={{ padding: '10px 14px', fontWeight: 630, fontSize: 12, color: C.text }}>
                      {fmt(row.radiation, 1)}
                    </td>
                    <td style={{ padding: '10px 14px', fontWeight: 630, fontSize: 12, color: C.text }}>
                      {fmt(row.flow, 0)}
                    </td>
                    <td style={{ padding: '10px 14px', fontWeight: 630, fontSize: 12 }}>
                      <span style={{
                        background: row.ec_ph_status === 'Irrigation' ? C.green + '18'
                          : row.ec_ph_status === 'Wait' ? C.amber + '18'
                          : C.textDim + '18',
                        color: row.ec_ph_status === 'Irrigation' ? C.green
                          : row.ec_ph_status === 'Wait' ? C.amber
                          : C.textDim,
                        border: `1px solid ${row.ec_ph_status === 'Irrigation' ? C.green : C.amber}30`,
                        borderRadius: 5, padding: '2px 7px',
                        fontWeight: 630, fontSize: 12,
                      }}>
                        {row.ec_ph_status || '—'}
                      </span>
                    </td>
                  </tr>
                  ))
                })()}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          <div style={{
            padding: '12px 16px', borderTop: `1px solid ${C.border}`,
            display: 'flex',
            flexDirection: isMobile ? 'column' : 'row',
            alignItems: isMobile ? 'stretch' : 'center',
            justifyContent: 'space-between',
            gap: isMobile ? 8 : 0,
          }}>
            <div style={{ color: C.textDim, fontSize: 12 }}>
              {history?.total ?? 0} lectures · page {history?.page ?? 1}/{history?.pages ?? 1}
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              <button onClick={() => loadHistory(page - 1)} disabled={page <= 1} style={{
                display: 'flex', alignItems: 'center', gap: 4,
                padding: '5px 10px', borderRadius: 6,
                border: `1.5px solid ${C.border}`, background: 'transparent',
                color: C.textMuted, fontSize: 12, fontWeight: 630,
                cursor: page <= 1 ? 'not-allowed' : 'pointer',
                opacity: page <= 1 ? 0.4 : 1, fontFamily: 'inherit',
              }}>
                <ChevronLeft size={12} strokeWidth={2} /> Préc
              </button>
              <button onClick={() => loadHistory(page + 1)} disabled={page >= (history?.pages ?? 1)} style={{
                display: 'flex', alignItems: 'center', gap: 4,
                padding: '5px 10px', borderRadius: 6,
                border: `1.5px solid ${C.border}`, background: 'transparent',
                color: C.textMuted, fontSize: 12, fontWeight: 630,
                cursor: page >= (history?.pages ?? 1) ? 'not-allowed' : 'pointer',
                opacity: page >= (history?.pages ?? 1) ? 0.4 : 1, fontFamily: 'inherit',
              }}>
                Suiv <ChevronRight size={12} strokeWidth={2} />
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}