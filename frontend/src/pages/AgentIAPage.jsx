// ============================================================
// frontend/src/pages/AgentIAPage.jsx
// Projet Azura Irrigation IA — GOUSSA Oussama
// ============================================================

import { useState } from 'react'
import { Brain, Settings, RefreshCw } from 'lucide-react'
import { getColors } from '../theme.js'
import { useWindowWidth } from '../components/DashboardShell.jsx'

export default function AgentIAPage({ dark }) {
  const C = getColors(dark)
  const width = useWindowWidth()
  const isMobile = width < 640

  const [mode, setMode] = useState('empty') // dev switch

  return (
    <div style={{ padding: 20 }}>

      {/* HEADER */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: isMobile ? 'flex-start' : 'center',
        flexDirection: isMobile ? 'column' : 'row',
        marginBottom: 20,
        gap: 10
      }}>
        <div>
          <h1 style={{
            fontSize: 20,
            fontWeight: 900,
            display: 'flex',
            alignItems: 'center',
            gap: 10
          }}>
            <Brain size={18} color={C.green} />
            Agent IA Irrigation (DEV)
          </h1>

          <p style={{ fontSize: 12, color: C.textDim }}>
            Page en développement — structure vide
          </p>
        </div>
      </div>

      {/* CONTENT AREA */}
      <div style={{
        border: `1px dashed ${C.border}`,
        borderRadius: 12,
        padding: 40,
        textAlign: 'center',
        color: C.textDim,
        minHeight: 300
      }}>
        
        {mode === 'empty' && (
          <>
            <Brain size={32} color={C.green} />
            <div style={{ marginTop: 10, fontWeight: 700 }}>
              Zone IA vide
            </div>
            <div style={{ fontSize: 12, marginTop: 5 }}>
              Ici viendront les cartes : PRT, tours, NPK, recommandations…
            </div>
          </>
        )}

        {mode === 'mock' && (
          <>
            <div style={{ fontWeight: 800, marginBottom: 10 }}>
              Mode MOCK activé
            </div>
            <div style={{ fontSize: 12 }}>
              - PRT: --% <br />
              - Tours: 0 <br />
              - Recommandation: en attente <br />
            </div>
          </>
        )}

      </div>

      {/* FOOTER INFO */}
      <div style={{
        marginTop: 20,
        fontSize: 11,
        color: C.textDim
      }}>
      </div>

    </div>
  )
}

// ─── STYLE BUTTON ───────────────────────────────
function btnStyle(C) {
  return {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    padding: '7px 12px',
    borderRadius: 8,
    border: `1px solid ${C.border}`,
    background: C.toggleBg,
    color: C.textMuted,
    fontSize: 12,
    cursor: 'pointer'
  }
}