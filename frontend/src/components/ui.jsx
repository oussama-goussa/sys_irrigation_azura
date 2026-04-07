// ============================================================
// frontend/src/components/ui.jsx
// Composants UI avec icônes Lucide React (zero emoji)
// ============================================================

import {
  Loader2, Eye, EyeOff, ChevronRight,
  Users, ShieldCheck, Activity, Moon, Sun,
  LogOut, UserPlus, Search, X, Check,
  AlertCircle, ToggleLeft, ToggleRight,
  Pencil, ChevronDown, Leaf,
} from 'lucide-react'
import { ROLE_CONFIG } from '../theme.js'

// ── Icon size constants ───────────────────────────────────────
export const SZ = { xs: 12, sm: 14, md: 16, lg: 20, xl: 24 }

// ── Card ──────────────────────────────────────────────────────
export function Card({ children, accent, C, style = {} }) {
  return (
    <div style={{
      background: C.card,
      border: `1.5px solid ${C.border}`,
      borderRadius: 14,
      padding: '22px 26px',
      position: 'relative',
      overflow: 'hidden',
      ...style,
    }}>
      {accent && (
        <div style={{
          position: 'absolute', top: 0, left: 0, right: 0, height: 2,
          background: `linear-gradient(90deg, transparent 0%, ${accent} 40%, ${accent} 60%, transparent 100%)`,
        }} />
      )}
      {children}
    </div>
  )
}

// ── Button ────────────────────────────────────────────────────
export function Btn({ children, onClick, variant = 'primary', disabled, full, small, icon: Icon, C, style = {} }) {
  const variants = {
    primary:   { background: C.green,      color: '#fff',       border: 'none' },
    secondary: { background: 'transparent', color: C.green,     border: `1.5px solid ${C.green}` },
    danger:    { background: 'transparent', color: C.red,       border: `1.5px solid ${C.red}` },
    ghost:     { background: C.toggleBg,   color: C.textMuted,  border: `1.5px solid ${C.border}` },
  }
  const s = variants[variant] || variants.primary
  return (
    <button onClick={onClick} disabled={disabled} style={{
      ...s,
      borderRadius: 8,
      padding: small ? '5px 12px' : '9px 18px',
      fontWeight: 700,
      fontSize: small ? 12 : 13,
      fontFamily: 'inherit',
      cursor: disabled ? 'not-allowed' : 'pointer',
      opacity: disabled ? 0.5 : 1,
      width: full ? '100%' : undefined,
      letterSpacing: '0.01em',
      transition: 'opacity 0.15s, filter 0.15s',
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 7,
      ...style,
    }}>
      {Icon && <Icon size={small ? SZ.xs : SZ.sm} strokeWidth={2.5} />}
      {children}
    </button>
  )
}

// ── Input ─────────────────────────────────────────────────────
export function Input({ label, value, onChange, type = 'text', options, C, placeholder, icon: Icon, dark }) {
  const [showPwd, setShowPwd] = React.useState(false)
  const isPassword = type === 'password'
  const actualType = isPassword && showPwd ? 'text' : type

  const base = {
    width: '100%',
    padding: Icon ? '9px 13px 9px 38px' : '9px 13px',
    paddingRight: isPassword ? 38 : 13,
    borderRadius: 8,
    fontSize: 12,
    background: C.inputBg,
    color: C.text,
    outline: 'none',
    fontFamily: 'inherit',
    border: `1.5px solid ${C.border}`,
    transition: 'border-color 0.18s',
  }

  return (
    <div style={{ marginBottom: 14 }}>
      {label && (
        <label style={{
          display: 'block',
          color: C.textMuted,
          fontSize: 11,
          fontWeight: 700,
          marginBottom: 6,
          letterSpacing: '0.07em',
          textTransform: 'uppercase',
        }}>
          {label}
        </label>
      )}
      <div style={{ position: 'relative' }}>
        {Icon && (
          <div style={{ position: 'absolute', left: 11, top: '50%', transform: 'translateY(-50%)', color: C.textDim, pointerEvents: 'none' }}>
            <Icon size={SZ.md} strokeWidth={1.8} />
          </div>
        )}
        {options ? (
          <select value={value} onChange={e => onChange(e.target.value)} style={{ ...base, cursor: 'pointer', appearance: 'none', colorScheme: dark ? 'dark' : 'light' }}>
            {options.map(o => <option key={o.value} style={{ background: C.inputBg, color: C.text }} value={o.value}>{o.label}</option>)}
          </select>
        ) : (
          <input
            type={actualType}
            value={value}
            onChange={e => onChange(e.target.value)}
            placeholder={placeholder}
            style={base}
          />
        )}
        {isPassword && (
          <button
            type="button"
            onClick={() => setShowPwd(v => !v)}
            style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: C.textDim, padding: 2 }}
          >
            {showPwd ? <EyeOff size={SZ.md} strokeWidth={1.8} /> : <Eye size={SZ.md} strokeWidth={1.8} />}
          </button>
        )}
        {options && (
          <div style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', color: C.textDim, pointerEvents: 'none' }}>
            <ChevronDown size={SZ.sm} strokeWidth={2} />
          </div>
        )}
      </div>
    </div>
  )
}

// Need React import for useState in Input
import React from 'react'

// ── Role Badge ────────────────────────────────────────────────
export function Badge({ role, dark }) {
  const cfg = ROLE_CONFIG[role] || ROLE_CONFIG.auditeur
  return (
    <span style={{
      background: dark ? cfg.darkBg : cfg.lightBg,
      color: dark ? cfg.darkColor : cfg.lightColor,
      border: `1px solid ${(dark ? cfg.darkColor : cfg.lightColor)}35`,
      borderRadius: 5,
      padding: '2px 9px',
      fontSize: 11,
      fontWeight: 700,
      letterSpacing: '0.06em',
      textTransform: 'uppercase',
      display: 'inline-flex',
      alignItems: 'center',
      gap: 4,
    }}>
      <ShieldCheck size={10} strokeWidth={2.5} />
      {cfg.label}
    </span>
  )
}

// ── Spinner ───────────────────────────────────────────────────
export function Spinner({ C, size = 28 }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'center', padding: 48 }}>
      <Loader2
        size={size}
        strokeWidth={2}
        style={{ color: C.green, animation: 'azura-spin 0.75s linear infinite' }}
      />
    </div>
  )
}

// ── Stat Card ─────────────────────────────────────────────────
export function StatCard({ label, value, icon: Icon, color, C }) {
  return (
    <div style={{
      flex: 1,
      background: C.card,
      border: `1.5px solid ${C.border}`,
      borderRadius: 12,
      padding: '16px 20px',
      display: 'flex',
      flexDirection: 'column',
      gap: 10,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ color: C.textMuted, fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em' }}>{label}</span>
        <div style={{ width: 30, height: 30, borderRadius: 8, background: `${color}18`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Icon size={SZ.md} color={color} strokeWidth={2} />
        </div>
      </div>
      <div style={{ color: color, fontSize: 28, fontWeight: 900, fontFamily: C.mono, lineHeight: 1 }}>
        {value}
      </div>
    </div>
  )
}

// ── Alert ─────────────────────────────────────────────────────
export function Alert({ message, C, dark }) {
  return (
    <div style={{
      background: dark ? '#2a0a0a' : '#fef2f2',
      color: C.red,
      border: `1px solid ${C.red}35`,
      borderRadius: 8,
      padding: '10px 14px',
      fontSize: 12,
      marginBottom: 16,
      display: 'flex',
      alignItems: 'center',
      gap: 8,
    }}>
      <AlertCircle size={SZ.md} strokeWidth={2} style={{ flexShrink: 0 }} />
      {message}
    </div>
  )
}

// ── Re-export Lucide icons for use in pages ───────────────────
export {
  Users, ShieldCheck, Activity, Moon, Sun, LogOut,
  UserPlus, Search, X, Check, AlertCircle,
  ToggleLeft, ToggleRight, Pencil, ChevronRight, Leaf,
  Loader2,
}