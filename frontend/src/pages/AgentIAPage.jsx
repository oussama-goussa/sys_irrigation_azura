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
    <div>

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
            Agent IA Irrigation [DEV]
          </h1>
        </div>
      </div>

      <div style={{
        border: `1px dashed ${C.border}`,
        borderRadius: 12,
        padding: 40,
        textAlign: 'center',
        color: C.textDim,
        minHeight: 300
      }}>
        <div>
          <Brain size={32} color={C.green} />
          <div style={{ marginTop: 10, fontWeight: 700 }}>
            Zone IA vide
          </div>
          <div style={{ fontSize: 12, marginTop: 5 }}>
            Page en développement...
          </div>
        </div>
      </div>
    </div>
  )
}