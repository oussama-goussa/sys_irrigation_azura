// ============================================================
// frontend/src/components/DashboardShell.jsx
// Shell avec sidebar dynamique + routing pages
// Projet Azura Irrigation IA — GOUSSA Oussama
// ============================================================

import { useState, useEffect } from 'react'
import {
  Users, Sun, Moon, LogOut, Leaf, ClipboardList, History,
  LayoutDashboard, Home, ChevronDown, ChevronRight,
  Wifi, WifiOff, Settings, RefreshCw,
} from 'lucide-react'
import { getColors } from '../theme.js'
import { Badge, Spinner, SZ } from './ui.jsx'
import { getDevices } from '../api/client.js'

import UsersPage     from '../pages/UsersPage.jsx'
import SaisiePage      from '../pages/SaisiePage.jsx'
import HistoriquePage  from '../pages/HistoriquePage.jsx'
import DashboardPage from '../pages/DashboardPage.jsx'
import ZonePage      from '../pages/ZonePage.jsx'

// ── Sidebar farm item ─────────────────────────────────────────
function FarmItem({ farm, selectedDevice, onSelectDevice, C, dark }) {
  const [open, setOpen] = useState(true)

  return (
    <div style={{ marginBottom: 4 }}>
      {/* Farm header */}
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '6px 10px', borderRadius: 7,
          background: 'transparent', border: 'none',
          color: C.textDim, cursor: 'pointer',
          fontSize: 11, fontWeight: 700,
          letterSpacing: '0.08em', textTransform: 'uppercase',
          fontFamily: 'inherit',
        }}
      >
        <span>{farm.farm_name}</span>
        {open
          ? <ChevronDown  size={12} strokeWidth={2} />
          : <ChevronRight size={12} strokeWidth={2} />
        }
      </button>

      {/* Houses */}
      {open && farm.houses.map(house => {
        const active = selectedDevice?.id === house.id
        return (
          <button
            key={house.id}
            onClick={() => onSelectDevice(house)}
            style={{
              width: '100%', display: 'flex', alignItems: 'center',
              gap: 8, padding: '8px 10px 8px 24px',
              borderRadius: 7, border: 'none',
              cursor: 'pointer', fontSize: 13,
              fontWeight: active ? 700 : 400,
              fontFamily: 'inherit',
              background: active
                ? (dark ? 'rgba(52,217,111,0.10)' : 'rgba(24,120,63,0.08)')
                : 'transparent',
              color: active ? C.green : C.textMuted,
              position: 'relative',
              transition: 'all 0.13s',
              textAlign: 'left',
            }}
          >
            {active && (
              <span style={{
                position: 'absolute', left: 0, top: '18%', bottom: '18%',
                width: 3, borderRadius: '0 3px 3px 0',
                background: C.green,
              }} />
            )}
            House {house.house_number}
          </button>
        )
      })}
    </div>
  )
}

// ── Main Shell ────────────────────────────────────────────────
export default function DashboardShell({ auth, dark, toggleDark, onLogout }) {
  const C = getColors(dark)

  // page: 'dashboard' | 'users' | 'zone'
  const [page,           setPage]           = useState('dashboard')
  const [selectedDevice, setSelectedDevice] = useState(null)
  const [farms,          setFarms]          = useState([])
  const [loadingFarms,   setLoadingFarms]   = useState(true)

  // Load devices for sidebar
  useEffect(() => {
    getDevices(auth.access_token)
      .then(setFarms)
      .catch(() => setFarms([]))
      .finally(() => setLoadingFarms(false))
  }, [auth.access_token])

  const handleSelectDevice = (device) => {
    setSelectedDevice(device)
    setPage('zone')
  }

  const handleBackToDashboard = () => {
    setPage('dashboard')
    setSelectedDevice(null)
  }

  return (
    <div style={{
      minHeight: '100vh',
      background: C.bg,
      color: C.text,
      display: 'flex',
      fontFamily: "'JetBrains Mono', monospace",
    }}>

      {/* ── Sidebar ─────────────────────────────────────────── */}
      <aside style={{
        width: 220,
        background: C.surface,
        borderRight: `1px solid ${C.border}`,
        display: 'flex',
        flexDirection: 'column',
        position: 'fixed',
        top: 0, bottom: 0, left: 0,
        zIndex: 20,
      }}>

        {/* Logo */}
        <div style={{
          padding: '18px 16px',
          borderBottom: `1px solid ${C.border}`,
          display: 'flex',
          alignItems: 'center',
          gap: 10,
        }}>
          <img
            src={dark ? '/a_logo_dark.png' : '/a_logo_light.png'}
            alt="Azura"
            style={{ height: 40, width: 'auto', objectFit: 'contain', borderRadius: 6, border: `1px solid ${C.border}` }}
          />
          <div style={{ color: C.textDim, fontSize: 9, letterSpacing: '0.16em', textTransform: 'uppercase' }}>
            Système<br />d'Irrigation
          </div>
        </div>

        {/* Nav */}
        <nav style={{ flex: 1, padding: '12px 10px', overflowY: 'auto' }}>

          {/* Dashboard link */}
          <button
            onClick={handleBackToDashboard}
            style={{
              width: '100%', display: 'flex', alignItems: 'center',
              gap: 9, padding: '9px 10px', borderRadius: 8,
              border: 'none', cursor: 'pointer', fontSize: 13,
              fontWeight: page === 'dashboard' ? 700 : 500,
              fontFamily: 'inherit',
              background: page === 'dashboard'
                ? (dark ? 'rgba(52,217,111,0.10)' : 'rgba(24,120,63,0.08)')
                : 'transparent',
              color: page === 'dashboard' ? C.green : C.textMuted,
              position: 'relative',
              transition: 'all 0.13s',
              marginBottom: 12,
            }}
          >
            {page === 'dashboard' && (
              <span style={{
                position: 'absolute', left: 0, top: '18%', bottom: '18%',
                width: 3, borderRadius: '0 3px 3px 0', background: C.green,
              }} />
            )}
            <LayoutDashboard size={15} strokeWidth={page === 'dashboard' ? 2.5 : 1.8} />
            Dashboard
          </button>

          {/* Section label */}
          <div style={{
            color: C.textDim, fontSize: 11, fontWeight: 600,
            textTransform: 'uppercase', letterSpacing: '0.10em',
            padding: '0 10px', marginBottom: 8,
          }}>
            Fermes
          </div>

          {/* Dynamic farms */}
          {loadingFarms ? (
            <div style={{ padding: '8px 10px' }}>
              <div style={{ color: C.textDim, fontSize: 11 }}>Chargement…</div>
            </div>
          ) : farms.length === 0 ? (
            <div style={{ padding: '8px 10px', color: C.textDim, fontSize: 11 }}>
              Aucune serre
            </div>
          ) : farms.map(farm => (
            <FarmItem
              key={farm.farm_name}
              farm={farm}
              selectedDevice={selectedDevice}
              onSelectDevice={handleSelectDevice}
              C={C}
              dark={dark}
            />
          ))}

          {auth.role === 'admin' && (
            <div style={{
              color: C.textDim, fontSize: 11, fontWeight: 600,
              textTransform: 'uppercase', letterSpacing: '0.10em',
              padding: '0 10px', marginTop: 16, marginBottom: 8,
            }}>
              Système
            </div>
          )}

          {/* Saisie journalière */}
          <button
            onClick={() => setPage('saisie')}
            style={{
              width: '100%', display: 'flex', alignItems: 'center',
              gap: 9, padding: '9px 10px', borderRadius: 8,
              border: 'none', cursor: 'pointer', fontSize: 13,
              fontWeight: page === 'saisie' ? 700 : 500,
              fontFamily: 'inherit',
              background: page === 'saisie'
                ? (dark ? 'rgba(52,217,111,0.10)' : 'rgba(24,120,63,0.08)')
                : 'transparent',
              color: page === 'saisie' ? C.green : C.textMuted,
              position: 'relative',
              transition: 'all 0.13s',
              marginBottom: 4,
            }}
          >
            {page === 'saisie' && (
              <span style={{
                position: 'absolute', left: 0, top: '18%', bottom: '18%',
                width: 3, borderRadius: '0 3px 3px 0', background: C.green,
              }} />
            )}
            <ClipboardList size={15} strokeWidth={page === 'saisie' ? 2.5 : 1.8} />
            Saisie journalière
          </button>

          {/* Historique */}
          <button
            onClick={() => setPage('historique')}
            style={{
              width: '100%', display: 'flex', alignItems: 'center',
              gap: 9, padding: '9px 10px', borderRadius: 8,
              border: 'none', cursor: 'pointer', fontSize: 13,
              fontWeight: page === 'historique' ? 700 : 500,
              fontFamily: 'inherit',
              background: page === 'historique'
                ? (dark ? 'rgba(52,217,111,0.10)' : 'rgba(24,120,63,0.08)')
                : 'transparent',
              color: page === 'historique' ? C.green : C.textMuted,
              position: 'relative', transition: 'all 0.13s', marginBottom: 4,
            }}
          >
            {page === 'historique' && (
              <span style={{ position: 'absolute', left: 0, top: '18%', bottom: '18%',
                width: 3, borderRadius: '0 3px 3px 0', background: C.green }} />
            )}
            <History size={15} strokeWidth={page === 'historique' ? 2.5 : 1.8} />
            Historique
          </button>

          {/* Users — admin only */}
          {auth.role === 'admin' && (
            <button
              onClick={() => setPage('users')}
              style={{
                width: '100%', display: 'flex', alignItems: 'center',
                gap: 9, padding: '9px 10px', borderRadius: 8,
                border: 'none', cursor: 'pointer', fontSize: 13,
                fontWeight: page === 'users' ? 700 : 500,
                fontFamily: 'inherit',
                background: page === 'users'
                  ? (dark ? 'rgba(52,217,111,0.10)' : 'rgba(24,120,63,0.08)')
                  : 'transparent',
                color: page === 'users' ? C.green : C.textMuted,
                position: 'relative',
                transition: 'all 0.13s',
              }}
            >
              {page === 'users' && (
                <span style={{
                  position: 'absolute', left: 0, top: '18%', bottom: '18%',
                  width: 3, borderRadius: '0 3px 3px 0', background: C.green,
                }} />
              )}
              <Users size={15} strokeWidth={page === 'users' ? 2.5 : 1.8} />
              Utilisateurs
            </button>
          )}
        </nav>

        {/* Bottom */}
        <div style={{ padding: '12px 10px', borderTop: `1px solid ${C.border}` }}>

          {/* User card */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: 9,
            padding: '9px 10px', borderRadius: 9,
            background: dark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.03)',
            border: `1px solid ${C.border}`,
            marginBottom: 8,
          }}>
            <div style={{
              width: 30, height: 30, borderRadius: 7,
              background: dark ? 'rgba(52,217,111,0.12)' : 'rgba(24,120,63,0.10)',
              border: `1.5px solid ${dark ? 'rgba(52,217,111,0.25)' : 'rgba(24,120,63,0.2)'}`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: C.green, fontSize: 11, fontWeight: 900, flexShrink: 0,
            }}>
              {auth.username[0].toUpperCase()}
            </div>
            <div style={{ minWidth: 0 }}>
              <div style={{
                color: C.text, fontWeight: 700, fontSize: 12,
                whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
              }}>
                {auth.username}
              </div>
              <div style={{ marginTop: 3 }}>
                <Badge role={auth.role} dark={dark} />
              </div>
            </div>
          </div>

          {/* Actions */}
          <div style={{ display: 'flex', gap: 6 }}>
            <button
              onClick={toggleDark}
              style={{
                flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5,
                padding: '7px 0', background: 'transparent',
                border: `1px solid ${C.border}`, borderRadius: 7,
                color: C.textMuted, cursor: 'pointer', fontSize: 11,
                fontWeight: 600, fontFamily: 'inherit',
              }}
            >
              {dark ? <><Sun size={12} strokeWidth={2} /> Clair</> : <><Moon size={12} strokeWidth={2} /> Sombre</>}
            </button>

            <button
              onClick={onLogout}
              style={{
                flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 5,
                padding: '7px 0', background: 'transparent',
                border: `1px solid ${C.border}`, borderRadius: 7,
                color: C.textMuted, cursor: 'pointer', fontSize: 11,
                fontWeight: 600, fontFamily: 'inherit',
              }}
            >
              <LogOut size={12} strokeWidth={2} />
              Quitter
            </button>
          </div>
        </div>
      </aside>

      {/* ── Main content ─────────────────────────────────────── */}
      <main style={{ marginLeft: 220, flex: 1, padding: '36px 40px', minHeight: '100vh' }}>

        {page === 'dashboard' && (
          <DashboardPage
            token={auth.access_token}
            onSelectDevice={handleSelectDevice}
            C={C}
            dark={dark}
          />
        )}

        {page === 'zone' && selectedDevice && (
          <ZonePage
            token={auth.access_token}
            device={selectedDevice}
            onBack={handleBackToDashboard}
            C={C}
            dark={dark}
          />
        )}

        {page === 'historique' && (
          <HistoriquePage
            token={auth.access_token}
            auth={auth}
            C={C}            
            dark={dark}
          />
        )}

        {page === 'saisie' && (
          <SaisiePage
            token={auth.access_token}
            auth={auth}
            C={C}
            dark={dark}
          />
        )}

        {page === 'users' && auth.role === 'admin' && (
          <UsersPage
            token={auth.access_token}
            userRole={auth.role}
            C={C}
            dark={dark}
          />
        )}

        {/* Fallback pour rôles sans accès */}
        {page === 'dashboard' || page === 'zone' || page === 'users' || page === 'saisie' || page === 'historique' ? null : (
          <div style={{
            display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center',
            height: '60vh', gap: 16,
          }}>
            <Leaf size={28} color={C.textDim} strokeWidth={1.4} />
            <div style={{ color: C.textDim, fontSize: 14 }}>
              Aucune section disponible pour votre rôle.
            </div>
          </div>
        )}
      </main>
    </div>
  )
}