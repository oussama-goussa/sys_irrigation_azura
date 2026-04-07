// ============================================================
// frontend/src/theme.js
// ============================================================

export function getColors(dark) {
  if (dark) return {
    bg:         '#0a0f0d',
    surface:    '#0f1a12',
    card:       '#142018',
    border:     '#1c3122',
    borderHover:'#2a4a33',
    green:      '#34d96f',
    greenDim:   '#1a7a42',
    greenGlow:  'rgba(52,217,111,0.10)',
    amber:      '#f5a623',
    red:        '#f05252',
    blue:       '#4d9de0',
    purple:     '#b197fc',
    text:       '#ecf4ee',
    textMuted:  '#6fa882',
    textDim:    '#3d6b4e',
    inputBg:    '#0c1610',
    shadow:     'rgba(0,0,0,0.45)',
    tableHover: '#172b1e',
    toggleBg:   '#1c3122',
    mono:       "'JetBrains Mono', monospace",
  }
  return {
    bg:         '#f6f9f7',
    surface:    '#ffffff',
    card:       '#ffffff',
    border:     '#e0ece5',      // ← fix: était '#d8ead e' (espace !)
    borderHover:'#c2d9cc',
    green:      '#18783f',
    greenDim:   '#34d96f',
    greenGlow:  'rgba(24,120,63,0.07)',
    amber:      '#a86a00',
    red:        '#c53030',
    blue:       '#1d6fa4',
    purple:     '#6741d9',
    text:       '#0d1f14',
    textMuted:  '#3a6b4a',
    textDim:    '#9cb8a6',
    inputBg:    '#f9fbfa',
    shadow:     'rgba(0,0,0,0.06)',
    tableHover: '#f2f8f4',
    toggleBg:   '#eef5f0',
    mono:       "'JetBrains Mono', monospace",
  }
}

export const ROLE_CONFIG = {
  admin:     { label: 'Admin',      darkBg: '#1e1030', darkColor: '#b197fc', lightBg: '#ede9fe', lightColor: '#5b21b6' },
  agronome:  { label: 'Agronome',   darkBg: '#0e1e38', darkColor: '#74b8f0', lightBg: '#dbeafe', lightColor: '#1558a0' },
  operateur: { label: 'Opérateur',  darkBg: '#0c2218', darkColor: '#34d96f', lightBg: '#dcfce7', lightColor: '#15683a' },
  auditeur:  { label: 'Auditeur',   darkBg: '#281c08', darkColor: '#f5a623', lightBg: '#fef3c7', lightColor: '#92530a' },
}

export const ROLES = ['admin', 'agronome', 'operateur', 'auditeur']
export const ROLE_OPTIONS = ROLES.map(r => ({ value: r, label: ROLE_CONFIG[r].label }))