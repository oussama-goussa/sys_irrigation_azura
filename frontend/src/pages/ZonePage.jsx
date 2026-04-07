// ============================================================
// frontend/src/pages/ZonePage.jsx
// Page détail serre — Graphiques + StatCards + Historique + Export
// Corrections : 4 graphiques par house, calendrier, sans alertes
// Projet Azura Irrigation IA — GOUSSA Oussama
// ============================================================

import { useState, useEffect, useCallback, useRef } from 'react'
import {
  ArrowLeft, RefreshCw, Activity, Droplets, Thermometer,
  Wind, Sun, Gauge, TrendingUp, TrendingDown, Minus,
  ChevronLeft, ChevronRight, Download, Clock, Calendar,
  BarChart2, WifiOff,
} from 'lucide-react'
import { Spinner } from '../components/ui.jsx'
import { getDeviceLatest, getDeviceHistory, exportDeviceCSV, getDeviceTours } from '../api/client.js'

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
          color: C.textMuted, fontSize: 11, fontWeight: 700,
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

function GaugeCard({ label, value, unit, min, max, color, C }) {
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
        color: C.textMuted, fontSize: 10, fontWeight: 700,
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
          fontFamily="JetBrains Mono, monospace"
        >
          {isValid ? `${value}${unit}` : `—`}
        </text>

        {/* Min — endpoint bas-gauche (135°) */}
        <text x={cx + (r + 12) * Math.cos(toRad(135))} 
              y={cy + (r + 12) * Math.sin(toRad(135)) + 4} 
              textAnchor="middle" fill={C.textDim}
              fontSize="7" fontFamily="JetBrains Mono, monospace">{min}
        </text>

        {/* Max — endpoint bas-droite (45°) */}
        <text x={cx + (r + 12) * Math.cos(toRad(45))} 
              y={cy + (r + 12) * Math.sin(toRad(45)) + 4} 
              textAnchor="middle" fill={C.textDim}
              fontSize="7" fontFamily="JetBrains Mono, monospace">{max}
        </text>
      </svg>
    </div>
  )
}

// ── Mini SVG Chart ────────────────────────────────────────────
function MiniChart({ data, color, label, unit, C, dark, onSelectRange, decimals = 2 }) {
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
      style={{ width:'100%', height:120, cursor: dragging ? 'col-resize' : 'crosshair', userSelect:'none' }}
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
      <polyline points={polyPoints} fill="none" stroke={baseColor} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />

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
        const tipW = 115, tipH = 38
        const tx  = p.x + 10 + tipW > W-PAD.right ? p.x - tipW - 10 : p.x + 10
        const ty  = Math.max(PAD.top, Math.min(p.y - tipH/2, PAD.top+chartH-tipH))
        const time = new Date(p.timestamp).toLocaleTimeString('fr-FR',{hour:'2-digit',minute:'2-digit'})
        return (
          <g>
            <line x1={p.x} y1={PAD.top} x2={p.x} y2={PAD.top+chartH}
              stroke={baseColor} strokeWidth="1" strokeDasharray="3,3" opacity="0.6" />
            <circle cx={p.x} cy={p.y} r="4"
              fill={baseColor} stroke={dark?'#1a1a1a':'#fff'} strokeWidth="2" />
            <rect x={tx} y={ty} width={tipW} height={tipH} rx="5"
              fill={dark?'#1e2a1e':'#fff'} stroke={baseColor} strokeWidth="1.2"
              style={{filter:'drop-shadow(0 2px 8px rgba(0,0,0,0.2))'}} />
            <text x={tx+8} y={ty+14} fill={color} fontSize="11" fontWeight="700">
              {Number(p.value).toFixed(decimals)} {unit}
            </text>
            <text x={tx+8} y={ty+28}
              fill={dark?'rgba(255,255,255,0.45)':'rgba(0,0,0,0.45)'} fontSize="9">
              {time}
            </text>
          </g>
        )
      })()}
    </svg>
  )
}

// ── Chart Card ────────────────────────────────────────────────
function ChartCard({ title, series, C, dark, onSelectRange }) {
  return (
    <div style={{
      background: C.card, border: `1.5px solid ${C.border}`,
      borderRadius: 14, padding: '18px 20px',
    }}>
      <div style={{ fontWeight: 800, fontSize: 13, color: C.text, marginBottom: 12 }}>{title}</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {series.map(s => (
          <div key={s.label}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <div style={{ width: 10, height: 3, borderRadius: 2, background: s.color }} />
                <span style={{ color: C.textMuted, fontSize: 11, fontWeight: 700 }}>{s.label}</span>
              </div>
              <span style={{ color: s.color, fontSize: 12, fontWeight: 800 }}>
                {s.data?.length > 0 && s.data[s.data.length - 1]?.value !== null
                  ? `${Number(s.data[s.data.length - 1].value).toFixed(s.decimals || 1)} ${s.unit || ''}`
                  : '—'}
              </span>
            </div>
            <MiniChart data={s.data} color={s.color} label={s.label} unit={s.unit}decimals={s.decimals} C={C} dark={dark} onSelectRange={onSelectRange} />
          </div>
        ))}
      </div>
    </div>
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

// ── Section title ─────────────────────────────────────────────
function SectionTitle({ title, C }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14, marginTop: 32 }}>
      <div style={{ width: 3, height: 18, background: C.green, borderRadius: 2 }} />
      <span style={{ color: C.text, fontSize: 14, fontWeight: 800 }}>{title}</span>
    </div>
  )
}

function PumpIndicator({ label, value, C }) {
  const on = parseInt(value) === 1
  return (
    <div style={{
      background: C.card,
      border: `1.5px solid ${C.border}`,
      borderLeft: `3px solid ${on ? C.green : C.border}`,
      borderRadius: 10, padding: '12px 14px', minWidth: 80, textAlign: 'center',
    }}>

      <div style={{ position: 'relative', width: 10, height: 10, margin: '0 auto 8px' }}>
        {on && (
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
          background: on ? C.green : C.textDim,
          boxShadow: on ? `0 0 5px ${C.green}` : 'none',
        }} />
      </div>
      <div style={{ color: C.textDim, fontSize: 10, fontWeight: 700, marginBottom: 3, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</div>
      <div style={{ color: on ? C.green : C.textDim, fontSize: 11, fontWeight: 800 }}>{on ? 'ON' : 'OFF'}</div>
    </div>
  )
}

function ValveIndicator({ label, value, C }) {
  const numVal = parseInt(value)
  const on = !isNaN(numVal) && numVal !== 0
  return (
    <div style={{
      background: C.card,
      border: `1.5px solid ${C.border}`,
      borderLeft: `3px solid ${on ? C.green : C.border}`,
      borderRadius: 10, padding: '12px 14px', minWidth: 80, textAlign: 'center',
    }}>
      <div style={{ position: 'relative', width: 10, height: 10, margin: '0 auto 8px' }}>
        {on && (
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
          background: on ? C.green : C.textDim,
          boxShadow: on ? `0 0 5px ${C.green}` : 'none',
        }} />
      </div>
      <div style={{ color: C.textDim, fontSize: 10, fontWeight: 700, marginBottom: 3, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</div>
      <div style={{ color: on ? C.green : C.textDim, fontSize: 11, fontWeight: 800 }}>
        {on ? 'ON' : 'OFF'}
      </div>
    </div>
  )
}

function FertCard({ num, label, open, min, act, max, flow, C }) {
  const isActive = open !== null && open !== undefined
  const pct = max > 0 ? (act / max) * 100 : 0
  return (
    <div style={{
      background: C.card,
      border: `1.5px solid ${C.border}`,
      borderLeft: `3px solid ${isActive ? C.green : C.border}`,
      borderRadius: 10, padding: '14px 16px',
      minWidth: 110, flex: 1,
    }}>
      <div style={{ color: C.textDim, fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>
        F{num}
      </div>
      <div style={{ color: isActive ? C.green : C.textDim, fontSize: 22, fontWeight: 900, lineHeight: 1, marginBottom: 4 }}>
        {isActive ? act ?? '—' : '—'}
      </div>
      <div style={{ color: C.textDim, fontSize: 10, marginBottom: 8 }}>% ouv.</div>
      {/* Progress bar */}
      <div style={{ background: C.border, borderRadius: 4, height: 4, marginBottom: 8 }}>
        <div style={{
          width: `${isActive ? Math.min(pct, 100) : 0}%`, height: '100%',
          background: isActive ? C.green : C.textDim, borderRadius: 4,
          transition: 'width 0.3s',
        }} />
      </div>
      <div style={{ color: C.textDim, fontSize: 10 }}>
        {isActive && flow !== null && flow !== undefined ? `${flow} mL` : '—'}
      </div>
    </div>
  )
}

// ── Main Page ─────────────────────────────────────────────────
export default function ZonePage({ token, device: deviceInfo, onBack, C, dark }) {
  const deviceId = deviceInfo.id

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

  // ── load live ──
  const loadLive = useCallback(async () => {
    try {
      const d = await getDeviceLatest(token, deviceId)
      setLive(d)
      setErrorL('')
    } catch (e) {
      setErrorL(e.message)
    } finally {
      setLoadingL(false)
    }
  }, [token, deviceId])

  // ── load history ──
  const loadHistory = useCallback(async (p = 1) => {
    setLoadingH(true)
    try {
      const d = await getDeviceHistory(token, deviceId, {
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
      const d = await getDeviceHistory(token, deviceId, {
        dateFrom: chartDateFrom, dateTo: chartDateTo, page: 1, perPage: 5000,
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

  const loadTours = useCallback(async (d = tourDate, showLoading = false) => {
      if (showLoading) setLoadingTours(true)   // ← seulement si explicitement demandé
      try {
        const data = await getDeviceTours(token, deviceId, d)
        setTours(data)
      } catch (e) {
        console.error(e)
      } finally {
        setLoadingTours(false)
      }
    }, [token, deviceId, tourDate])

  useEffect(() => {
      loadTours(tourDate, true)   // ← premier chargement = affiche le spinner
      if (tourDate !== today()) return
      const iv = setInterval(() => loadTours(tourDate, false), 30_000)  // ← refresh silencieux
      return () => clearInterval(iv)
    }, [tourDate, deviceId])

  useEffect(() => {
    loadLive()
    loadChartData()
    const iv = setInterval(() => {
      loadLive()
      if (isToday && !isZoomedRef.current) loadChartData()
      if (isHistoryToday) loadHistory(page)
    }, 30_000)
    return () => clearInterval(iv)
  }, [loadLive, chartDateFrom, chartDateTo, dateFrom, dateTo, page])

  useEffect(() => {
    loadHistory(1)
  }, [dateFrom, dateTo, deviceId])

  useEffect(() => {
  loadChartData()
}, [chartDateFrom, chartDateTo, deviceId])

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
        token, deviceId, dateFrom, dateTo,
        `azura_${deviceInfo.farm_name}_house${deviceInfo.house_number}_${dateFrom}_${dateTo}.csv`
      )
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
  return (
    <div>
      {/* ── Header ──────────────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 28 }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
            <button onClick={onBack} style={{
              display: 'flex', alignItems: 'center', gap: 5,
              background: 'transparent', border: 'none',
              color: C.textMuted, cursor: 'pointer',
              fontSize: 12, fontWeight: 700, padding: 0, fontFamily: 'inherit',
            }}>
              <ArrowLeft size={14} strokeWidth={2.5} /> Dashboard
            </button>
            <span style={{ color: C.border }}>/</span>
            <span style={{ color: C.green, fontSize: 12, fontWeight: 700 }}>
              {deviceInfo.farm_name} · House {deviceInfo.house_number}
            </span>
          </div>

          <h1 style={{ color: C.text, fontSize: 20, fontWeight: 900, marginBottom: 4 }}>
            {deviceInfo.farm_name} — House {deviceInfo.house_number}
          </h1>

          <div style={{ color: C.textDim, fontSize: 12, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <span>Netafim · {deviceInfo.controller_type || '—'} · v{deviceInfo.controller_version || '—'}</span>
            <span style={{ color: C.border }}>·</span>
            <span style={{ fontFamily: 'monospace', fontSize: 11 }}>{deviceInfo.device_id || '—'}</span>
            <span style={{ color: C.border }}>·</span>

            <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: online === null ? C.textDim : online ? C.green : C.red, fontWeight: 700 }}>
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

        <button onClick={loadLive} style={{
          display: 'flex', alignItems: 'center', gap: 6,
          padding: '8px 14px', background: C.toggleBg,
          border: `1.5px solid ${C.border}`, borderRadius: 8,
          color: C.textMuted, fontSize: 12, fontWeight: 700,
          cursor: 'pointer', fontFamily: 'inherit',
        }}>
          <RefreshCw size={13} strokeWidth={2} /> Actualiser
        </button>
      </div>

      {/* ── StatCards temps réel ─────────────────────────────── */}
      <SectionTitle title="Données temps réel" C={C} />
      <div style={{ color: C.textDim, fontSize: 11, marginBottom: 14, marginTop: -10 }}>
        Rafraîchissement automatique toutes les 30s
        {sensor.timestamp && ` — ${fmtTs(sensor.timestamp)}`}
      </div>

      {errorL ? (
        <div style={{ color: C.red, fontSize: 13 }}>{errorL}</div>
      ) : (
        <>
          <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginBottom: 14 }}>
            <GaugeCard label="EC"          value={fmt(sensor.ec_actual, 2)}   unit="mS/cm" min={0}   max={8}   color="#00c9a7" C={C} />
            <GaugeCard label="pH"          value={fmt(sensor.ph_actual, 2)}   unit=""      min={4}   max={8}   color="#4d9de0" C={C} />
            <GaugeCard label="Température" value={fmt(sensor.avg_temp, 1)}    unit="°C"    min={10}  max={40}  color="#f52e23" C={C} />
            <GaugeCard label="Humidité"    value={fmt(sensor.humidity, 1)}    unit="%"     min={0}   max={100} color="#b197fc" C={C} />
          </div>
          <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap' }}>
            <GaugeCard label="Radiation"   value={fmt(sensor.radiation, 1)}   unit="W/m²"  min={0}   max={2000} color="#f5e642" C={C} />
            <GaugeCard label="Débit"       value={fmt(sensor.flow, 0)}        unit="L/h"   min={0}   max={1000}  color="#34d96f" C={C} />
            <GaugeCard label="Cumul Rad."  value={fmt(sensor.radiation_sum,1)} unit="J/cm²" min={0}  max={3000} color="#f5a623" C={C} />
            <GaugeCard label="Vent"        value={fmt(sensor.wind_speed, 1)}  unit="m/s"   min={0}   max={15}   color="#4d9de0" C={C} />
          </div>
        </>
      )}

      {/* ── État irrigation ─────────────────────────────────── */}
      <SectionTitle title="État irrigation en temps réel" C={C} />
      {!loadingL && live?.cycle && Object.keys(live.cycle).length > 0 ? (() => {
        const cycle = live.cycle
        const dosingTypes = [
          cycle.dosing_pump_type1, cycle.dosing_pump_type2,
          cycle.dosing_pump_type3, cycle.dosing_pump_type4,
          cycle.dosing_pump_type5, cycle.dosing_pump_type6,
          cycle.dosing_pump_type7, cycle.dosing_pump_type8,
        ]
        const fertLabels = ['', '', '', '', '', '', '', '']
        return (
          <>
            {/* Pompes + Vannes */}
            <div style={{ marginBottom: 16 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 24 }}>
                
                {/* Pompes */}
                <div style={{ flex: 1 }}>
                  <div style={{ color: C.textMuted, fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 10 }}>Pompes</div>
                  <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                    {[1,2,3,4,5,6].map(i => (
                      <PumpIndicator key={i} label={`Pompe ${i}`} value={cycle[`pump${i}`]} C={C} />
                    ))}
                  </div>
                </div>

                {/* Vannes zones */}
                <div style={{ flex: 1 }}>
                  <div style={{ color: C.textMuted, fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 10 }}>Vannes</div>
                  <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                    {[1,2,3,4].map(i => {
                      const val = parseInt(cycle[`valve${i}`])
                      const label = !isNaN(val) && val !== 0 ? `Vanne ${val}` : `Vanne ${i}`
                      return (
                        <ValveIndicator key={i} label={label} value={cycle[`valve${i}`]} C={C} />
                      )
                    })}
                  </div>
                </div>

              </div>
            </div>

            {/* Fertigation */}
            {live?.fertigation && (
              <div style={{ marginBottom: 16 }}>
                <div style={{ color: C.textMuted, fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 10 }}>
                  Fertigation — Canaux actifs
                </div>
                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                  {[1,2,3,4,5,6,7,8].map(i => (
                    <FertCard
                      key={i}
                      num={i}
                      label={fertLabels[i-1]}
                      open={live.fertigation[`fert_open${i}`]}
                      min={live.fertigation[`fert_min${i}`]}
                      act={live.fertigation[`fert_act${i}`]}
                      max={live.fertigation[`fert_max${i}`]}
                      flow={live.fertigation[`fert_flow${i}`]}
                      C={C}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* Programme */}
            <div style={{
              background: C.card, border: `1.5px solid ${C.border}`,
              borderRadius: 14, padding: '20px 24px', marginBottom: 16,
            }}>

              {/* Status bar */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18 }}>
                <div style={{ color: C.textMuted, fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
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
                  ].map(({ label, val }) => {
                    const on = val === 'On' || val === 'on' || val === true || val === '1' || (typeof val === 'string' && val.toLowerCase() === 'on')
                    return (
                      <div key={label} style={{
                        display: 'flex', alignItems: 'center', gap: 8,
                        padding: '6px 14px', borderRadius: 20,
                        background: on ? (C.green + '15') : C.toggleBg,
                        border: `1.5px solid ${on ? C.green + '40' : C.border}`,
                        fontSize: 11, fontWeight: 700,
                        color: on ? C.green : C.textDim,
                      }}>
                        <div style={{ position: 'relative', width: 8, height: 8, flexShrink: 0 }}>
                          {on && (
                            <div style={{
                              position: 'absolute', top: '50%', left: '50%',
                              transform: 'translate(-50%, -50%)',
                              width: 8, height: 8, borderRadius: '50%',
                              background: C.green, opacity: 0.4,
                              animation: 'ripple 1.5s ease-out infinite',
                            }} />
                          )}
                          <div style={{
                            position: 'absolute', top: '50%', left: '50%',
                            transform: 'translate(-50%, -50%)',
                            width: 6, height: 6, borderRadius: '50%',
                            background: on ? C.green : C.textDim,
                            boxShadow: on ? `0 0 5px ${C.green}` : 'none',
                          }} />
                        </div>
                        {label}
                      </div>
                    )
                  })}
                </div>
              </div>

              {/* Métriques en 3 groupes */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16 }}>

                {/* Groupe 1 — Cycle */}
                <div style={{ background: C.surface, borderRadius: 10, padding: '14px 16px', border: `1px solid ${C.border}` }}>
                  <div style={{ color: C.textDim, fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 10 }}>Cycle</div>
                  {[
                    ['Prog',      cycle.cycle_prog],
                    ['Actuel',    cycle.cycle_act],
                    ['Séq. act',  cycle.sequence],
                    ['Proch. séq',cycle.next_sequence],
                    ['Proch. à',  cycle.next_seq_time],
                    ['Restant',   cycle.remaining_time],
                  ].map(([label, val]) => (
                    <div key={label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '5px 0', borderBottom: `1px solid ${C.border}`, fontSize: 12 }}>
                      <span style={{ color: C.textMuted }}>{label}</span>
                      <span style={{ color: C.text, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
                        {val !== null && val !== undefined ? String(val) : '—'}
                      </span>
                    </div>
                  ))}
                </div>

                {/* Groupe 2 — Eau */}
                <div style={{ background: C.surface, borderRadius: 10, padding: '14px 16px', border: `1px solid ${C.border}` }}>
                  <div style={{ color: C.textDim, fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 10 }}>Eau</div>
                  {[
                    ['Mode',      cycle.water_mode],
                    ['Qté prog',  cycle.water_prg_qty],
                    ['Qté act',   cycle.water_act_qty],
                    ['T. prog',   cycle.water_prg_time],
                    ['T. actuel', cycle.water_act_time],
                    ['Restante',  cycle.water_left],
                  ].map(([label, val]) => (
                    <div key={label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '5px 0', borderBottom: `1px solid ${C.border}`, fontSize: 12 }}>
                      <span style={{ color: C.textMuted }}>{label}</span>
                      <span style={{ color: C.text, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
                        {val !== null && val !== undefined ? String(val) : '—'}
                      </span>
                    </div>
                  ))}
                </div>

                {/* Groupe 3 — Fertigation */}
                <div style={{ background: C.surface, borderRadius: 10, padding: '14px 16px', border: `1px solid ${C.border}` }}>
                  <div style={{ color: C.textDim, fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 10 }}>Fertigation</div>
                  {[
                    ['Valve prog', cycle.valve_prog],
                    ['Fert prog',  cycle.fert_prog],
                    ['EC/pH',      sensor.ec_ph_status],
                    ['Pause',      cycle.pause],
                    ['Manuel',     cycle.manual_prog],
                    ['Vannes irr', cycle.valves_in_irrig],
                  ].map(([label, val]) => (
                    <div key={label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '5px 0', borderBottom: `1px solid ${C.border}`, fontSize: 12 }}>
                      <span style={{ color: C.textMuted }}>{label}</span>
                      <span style={{
                        color: label === 'EC/pH' && val === 'Irrigation' ? C.green
                            : label === 'EC/pH' && val === 'Wait' ? C.amber
                            : C.text,
                        fontWeight: 700,
                      }}>
                        {val !== null && val !== undefined ? String(val) : '—'}
                      </span>
                    </div>
                  ))}
                </div>

              </div>
            </div>            
          </>
        )
      })() : !loadingL ? (
        <div style={{ color: C.textDim, fontSize: 13, padding: '20px 0' }}>
          Aucune donnée de cycle disponible
        </div>
      ) : null}

      {/* ── Tours d'irrigation ──────────────────────────────────── */}
      <div style={{ display:'flex', alignItems:'center', gap:8, marginTop:32, marginBottom:14 }}>
        <div style={{ width:3, height:18, background:C.green, borderRadius:2 }} />
        <span style={{ color:C.text, fontSize:14, fontWeight:800 }}>Tours d'irrigation</span>
      </div>

      <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:14 }}>
        <Calendar size={14} strokeWidth={2} color={C.textMuted} />
        <input type="date" value={tourDate}
          onChange={e => setTourDate(e.target.value)}
          max={today()}
          style={{
            padding: '6px 10px', borderRadius: 7,
            border: `1.5px solid ${C.border}`,
            background: C.inputBg, color: C.text,
            fontSize: 12, fontFamily: 'inherit', outline: 'none',
          }}
        />
        {tourDate !== today() && (
          <button onClick={() => setTourDate(today())} style={{
            padding: '6px 10px', borderRadius: 7,
            border: `1.5px solid ${C.border}`,
            background: C.inputBg, color: C.text,
            fontSize: 12, fontFamily: 'inherit', cursor: 'pointer',
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
                fontSize: 13,
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
                      fontWeight: 700,
                      textTransform: 'uppercase',
                      letterSpacing: '0.07em',
                      borderBottom: `1.5px solid ${C.border}`,
                      whiteSpace: 'nowrap',
                    }}>Tours</th>

                    <th style={{
                      padding: '11px 14px',
                      textAlign: 'center',
                      width: '5%',
                      color: C.textDim,
                      fontSize: 12,
                      fontWeight: 700,
                      textTransform: 'uppercase',
                      letterSpacing: '0.07em',
                      borderBottom: `1.5px solid ${C.border}`,
                      whiteSpace: 'nowrap',
                    }}>House</th>

                    {mergedTours.map((t, i) => (
                      <th key={i} style={{
                        padding: '11px 10px',
                        textAlign: 'center',
                        fontSize: 12,
                        fontWeight: 700,
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
                    { label: 'Heure (Début)', key: 'debut' },
                    { label: 'Heure (Fin)', key: 'fin' },
                    { label: 'Durée Prog (min)', key: 'prg_time_min' },
                    { label: 'Durée Complète (min)', key: 'duree_min' },
                    { label: 'Temps repos (min)', key: 'repos_apres_min' },
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
                        fontWeight: 700,
                        textTransform: 'uppercase',
                        letterSpacing: '0.07em',
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
                        const val = t?.[row.key];
                        return (
                          <td key={i} style={{
                            padding: '10px 10px',
                            textAlign: 'center',
                            color: val != null ? C.text : C.textDim,
                            fontSize: 12,
                            fontWeight: val != null ? 700 : 400,
                            fontVariantNumeric: 'tabular-nums',
                            background: t?.debut
                              ? (dark ? 'rgba(52,217,111,0.04)' : 'rgba(52,217,111,0.02)')
                              : 'transparent',
                          }}>
                            {val != null ? String(val) : '-'}
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

      <div style={{ display:'flex', alignItems:'center', gap:12, marginBottom:20 }}>
        <DateRangePicker
          dateFrom={chartDateFrom}
          dateTo={chartDateTo}
          onChangeDateFrom={v => setChartDateFrom(v)}
          onChangeDateTo={v => setChartDateTo(v)}
          C={C} dark={dark}
        />
        {(chartDateFrom !== today() || chartDateTo !== today()) && (
          <button
            onClick={() => { setChartDateFrom(today()); setChartDateTo(today()) }}
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
        {(chartZoomFrom || chartZoomTo) && (
          <button onClick={() => { setChartZoomFrom(null); setChartZoomTo(null); isZoomedRef.current = false }} style={{
            display: 'flex', alignItems: 'center', gap: 6,
            padding: '5px 14px', background: 'transparent',
            border: `1.5px solid ${C.green}`, borderRadius: 7,
            color: C.green, fontSize: 12, fontWeight: 700,
            cursor: 'pointer', fontFamily: 'inherit',
          }}>
            <RefreshCw size={12} strokeWidth={2} /> Reset zoom
          </button>
        )}
      </div>

      {/* ── 4 Graphiques ─────────────────────────────────────── */}
      {(
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 28 }}>

          {/* Graphique 1 — EC & pH */}
          <ChartCard
            title="EC & pH"
            C={C}
            dark={dark}
            onSelectRange={(from, to) => { setChartZoomFrom(from); setChartZoomTo(to); isZoomedRef.current = true }}
            series={[
              {
                label: 'EC actuel (mS/cm)',
                color: '#34d96f',
                unit: 'mS/cm',
                decimals: 2,
                data: buildSeries('ec_actual'),
              },
              {
                label: 'pH actuel',
                color: '#4d9de0',
                unit: '',
                decimals: 2,
                data: buildSeries('ph_actual'),
              },
            ]}
          />

          {/* Graphique 2 — Température & Humidité */}
          <ChartCard
            title="Température & Humidité"
            C={C}
            dark={dark}
            onSelectRange={(from, to) => { setChartZoomFrom(from); setChartZoomTo(to); isZoomedRef.current = true }}
            series={[
              {
                label: 'Température (°C)',
                color: '#f5a623',
                unit: '°C',
                decimals: 1,
                data: buildSeries('avg_temp'),
              },
              {
                label: 'Humidité (%)',
                color: '#b197fc',
                unit: '%',
                decimals: 1,
                data: buildSeries('humidity'),
              },
            ]}
          />

          {/* Graphique 3 — Radiation solaire */}
          <ChartCard
            title="Radiation solaire"
            C={C}
            dark={dark}
            onSelectRange={(from, to) => { setChartZoomFrom(from); setChartZoomTo(to); isZoomedRef.current = true }}
            series={[
              {
                label: 'Radiation (W/m²)',
                color: '#f5e642',
                unit: 'W/m²',
                decimals: 1,
                data: buildSeries('radiation'),
              },
              {
                label: 'Cumul journalier (J/cm²)',
                color: '#f5a623',
                unit: 'J/cm²',
                decimals: 1,
                data: buildSeries('radiation_sum'),
              },
            ]}
          />

          {/* Graphique 4 — Débit */}
          <ChartCard
            title="Débit & Irrigation"
            C={C}
            dark={dark}
            onSelectRange={(from, to) => { setChartZoomFrom(from); setChartZoomTo(to); isZoomedRef.current = true }}
            series={[
              {
                label: 'Débit (L/h)',
                color: '#ff48bf',
                unit: 'L/h',
                decimals: 0,
                data: buildSeries('flow'),
              },
              {
                label: 'Débit nominal (L/h)',
                color: '#05e4bf',
                unit: 'L/h',
                decimals: 0,
                data: buildSeries('flow_nominal') ,
              },
            ]}
          />
        </div>
      )}

      {/* ── Historique table ─────────────────────────────────── */}
      <div style={{ display:'flex', alignItems:'center', gap:8, marginTop:32, marginBottom:12 }}>
        <div style={{ width:3, height:18, background:C.green, borderRadius:2 }} />
        <span style={{ color:C.text, fontSize:14, fontWeight:800 }}>
          Historique — {deviceInfo.farm_name} House {deviceInfo.house_number}
        </span>
      </div>

      {/* Date filtre + Export CSV sur même ligne */}
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:8 }}>
        <div style={{ display:'flex', alignItems:'center', gap:8 }}>
          <DateRangePicker
            dateFrom={dateFrom}
            dateTo={dateTo}
            onChangeDateFrom={v => setDateFrom(v)}
            onChangeDateTo={v => setDateTo(v)}
            C={C}
            dark={dark}
          />
          {(dateFrom !== today() || dateTo !== today()) && (
            <button
              onClick={() => { setDateFrom(today()); setDateTo(today()) }}
              style={{
                padding: '6px 10px',
                marginLeft: '5px',
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
          padding:'5px 14px', background:'transparent',
          border:`1.5px solid ${C.green}`, borderRadius:7,
          color:C.green, fontSize:12, fontWeight:700,
          cursor: exporting ? 'not-allowed' : 'pointer',
          opacity: exporting ? 0.6 : 1, fontFamily:'inherit',
        }}>
          <Download size={12} strokeWidth={2} />
          {exporting ? 'Export…' : 'Export CSV'}
        </button>
      </div>

      {/* Lectures count */}
      <div style={{ color:C.textDim, fontSize:11, marginBottom:14 }}>
        {history?.total ?? 0} lectures du {dateFrom} au {dateTo}
      </div>

      {errorH ? (
        <div style={{ color: C.red, fontSize: 13 }}>{errorH}</div>
      ) : (
        <div style={{ background: C.card, border: `1.5px solid ${C.border}`, borderRadius: 14, overflow: 'hidden' }}>
          <div>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: 'inherit' }}>
              <thead>
                <tr style={{ background: dark ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.02)' }}>
                  {[
                    { label: 'Timestamp',   col: 'timestamp' },
                    { label: 'EC (mS/cm)', col: 'ec_actual' },
                    { label: 'pH',          col: 'ph_actual' },
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
                        fontSize: 12, fontWeight: 700,
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
                    <td colSpan={8} style={{ padding: 40, textAlign: 'center', color: C.textDim, fontSize: 13 }}>
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
                    <td style={{ padding: '10px 14px', fontWeight: 700, fontSize: 13, color: C.text }}>
                      {fmt(row.ec_actual, 2)}
                    </td>
                    <td style={{ padding: '10px 14px', fontWeight: 700, fontSize: 13, color: C.text }}>
                      {fmt(row.ph_actual, 2)}
                    </td>
                    <td style={{ padding: '10px 14px', fontWeight: 700, fontSize: 13, color: C.text }}>
                      {fmt(row.avg_temp, 1)}
                    </td>
                    <td style={{ padding: '10px 14px', fontWeight: 700, fontSize: 13, color: C.text }}>
                      {fmt(row.humidity, 1)}
                    </td>
                    <td style={{ padding: '10px 14px', fontSize: 12, color: C.textMuted }}>
                      {fmt(row.radiation, 1)}
                    </td>
                    <td style={{ padding: '10px 14px', fontSize: 12, color: C.textMuted }}>
                      {fmt(row.flow, 0)}
                    </td>
                    <td style={{ padding: '10px 14px', fontSize: 12 }}>
                      <span style={{
                        background: row.ec_ph_status === 'Irrigation' ? C.green + '18'
                          : row.ec_ph_status === 'Wait' ? C.amber + '18'
                          : C.textDim + '18',
                        color: row.ec_ph_status === 'Irrigation' ? C.green
                          : row.ec_ph_status === 'Wait' ? C.amber
                          : C.textDim,
                        border: `1px solid ${row.ec_ph_status === 'Irrigation' ? C.green : C.amber}30`,
                        borderRadius: 5, padding: '2px 7px',
                        fontWeight: 700, fontSize: 11,
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
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          }}>
            <div style={{ color: C.textDim, fontSize: 12 }}>
              {history?.total ?? 0} lectures · page {history?.page ?? 1}/{history?.pages ?? 1}
            </div>
            <div style={{ display: 'flex', gap: 6 }}>
              <button onClick={() => loadHistory(page - 1)} disabled={page <= 1} style={{
                display: 'flex', alignItems: 'center', gap: 4,
                padding: '5px 10px', borderRadius: 6,
                border: `1.5px solid ${C.border}`, background: 'transparent',
                color: C.textMuted, fontSize: 12, fontWeight: 700,
                cursor: page <= 1 ? 'not-allowed' : 'pointer',
                opacity: page <= 1 ? 0.4 : 1, fontFamily: 'inherit',
              }}>
                <ChevronLeft size={13} strokeWidth={2} /> Préc
              </button>
              <button onClick={() => loadHistory(page + 1)} disabled={page >= (history?.pages ?? 1)} style={{
                display: 'flex', alignItems: 'center', gap: 4,
                padding: '5px 10px', borderRadius: 6,
                border: `1.5px solid ${C.border}`, background: 'transparent',
                color: C.textMuted, fontSize: 12, fontWeight: 700,
                cursor: page >= (history?.pages ?? 1) ? 'not-allowed' : 'pointer',
                opacity: page >= (history?.pages ?? 1) ? 0.4 : 1, fontFamily: 'inherit',
              }}>
                Suiv <ChevronRight size={13} strokeWidth={2} />
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
