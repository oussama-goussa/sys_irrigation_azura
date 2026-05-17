// ============================================================
// frontend/src/components/DashboardShell.jsx
// Responsive : Desktop / Tablet / Mobile
// ============================================================

import { useState, useEffect, useRef } from 'react'
import {
  Users, Sun, Moon, LogOut, Leaf, ClipboardList, History,
  LayoutDashboard, ChevronDown, ChevronRight,
  AlignLeft, X, Brain, Bell,
} from 'lucide-react'
import { getColors } from '../theme.js'
import { Badge, Spinner, SZ } from './ui.jsx'
import { getDevices } from '../api/client.js'

import UsersPage      from '../pages/UsersPage.jsx'
import SaisiePage     from '../pages/SaisiePage.jsx'
import HistoriquePage from '../pages/HistoriquePage.jsx'
import DashboardPage  from '../pages/DashboardPage.jsx'
import ZonePage       from '../pages/ZonePage.jsx'
import AgentIAPage from '../pages/AgentIAPage.jsx'
import AlertsPage, { AlertWatcher, AlertBell } from '../pages/AlertsPage.jsx'

// ── Breakpoints ───────────────────────────────────────────────
const BP_MOBILE = 640
const BP_TABLET = 900

export function useWindowWidth() {
  const [w, setW] = useState(typeof window !== 'undefined' ? window.innerWidth : 1200)
  useEffect(() => {
    const handler = () => setW(window.innerWidth)
    window.addEventListener('resize', handler)
    return () => window.removeEventListener('resize', handler)
  }, [])
  return w
}

// ── FarmItem ─────────────────────────────────────────────────
function FarmItem({ farm, selectedDevice, onSelectDevice, C, dark, collapsed, onClose }) {
  const [open, setOpen] = useState(true)

  if (collapsed) {
    return (
      <div style={{ marginBottom: 4 }}>
        {(farm.houses || []).map(house => {
          const active = selectedDevice?.id === house.id
          return (
            <button
              key={house.id}
              title={`${farm.farm_name} · Station ${house.house_number}`}
              onClick={() => { onSelectDevice(house); onClose?.() }}
              style={{
                width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center',
                padding: '8px 0', borderRadius: 7, border: 'none',
                cursor: 'pointer', background: active
                  ? (dark ? 'rgba(52,217,111,0.12)' : 'rgba(24,120,63,0.08)')
                  : 'transparent',
                transition: 'background 0.15s',
              }}
            >
              <div style={{
                width: 26, height: 26, borderRadius: 7,
                background: active ? C.green : (dark ? '#1c3122' : '#e8f4ed'),
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 10, fontWeight: 900,
                color: active ? '#fff' : C.textDim,
                transition: 'all 0.15s',
              }}>
                {house.house_number}
              </div>
            </button>
          )
        })}
      </div>
    )
  }

  return (
    <div style={{ marginBottom: 4 }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '6px 10px', borderRadius: 7,
          background: 'transparent', border: 'none',
          color: C.textDim, cursor: 'pointer',
          fontSize: 11, fontWeight: 680,
          letterSpacing: '0.08em', textTransform: 'uppercase',
          fontFamily: 'inherit',
        }}
      >
        <span>{farm.farm_name}</span>
        {open ? <ChevronDown size={12} strokeWidth={2} /> : <ChevronRight size={12} strokeWidth={2} />}
      </button>

      {open && (farm.houses || []).map(house => {
        const active = selectedDevice?.id === house.id
        return (
          <button
            key={house.id}
            onClick={() => { onSelectDevice(house); onClose?.() }}
            style={{
              width: '100%', display: 'flex', alignItems: 'center',
              gap: 8, padding: '8px 10px 8px 24px',
              borderRadius: 7, border: 'none',
              cursor: 'pointer', fontSize: 13,
              fontWeight: active ? 680 : 400,
              fontFamily: 'inherit',
              background: active
                ? (dark ? 'rgba(52,217,111,0.10)' : 'rgba(24,120,63,0.08)')
                : 'transparent',
              color: active ? C.green : C.textMuted,
              position: 'relative', transition: 'all 0.13s',
              textAlign: 'left',
            }}
          >
            {active && (
              <span style={{
                position: 'absolute', left: 0, top: '18%', bottom: '18%',
                width: 3, borderRadius: '0 3px 3px 0', background: C.green,
              }} />
            )}
            Station {house.house_number}
          </button>
        )
      })}
    </div>
  )
}

// ── SidebarContent ────────────────────────────────────────────
function SidebarContent({
  C, dark, auth, farms, loadingFarms,
  page, selectedDevice,
  setPage, handleSelectDevice, toggleDark, onLogout,
  collapsed = false,
  onClose = null,
}) {
  const navigate = (p) => { setPage(p); onClose?.() }

  const navBtn = (id, Icon, label) => {
    const active = page === id
    return (
      <button
        onClick={() => navigate(id)}
        title={collapsed ? label : undefined}
        style={{
          width: '100%',
          display: 'flex', alignItems: 'center',
          gap: collapsed ? 0 : 9,
          justifyContent: collapsed ? 'center' : 'flex-start',
          padding: collapsed ? '10px 0' : '9px 10px',
          borderRadius: 8, border: 'none', cursor: 'pointer',
          fontSize: 13, fontWeight: active ? 680 : 500,
          fontFamily: 'inherit',
          background: active
            ? (dark ? 'rgba(52,217,111,0.10)' : 'rgba(24,120,63,0.08)')
            : 'transparent',
          color: active ? C.green : C.textMuted,
          position: 'relative', transition: 'all 0.13s',
          marginBottom: 4,
        }}
      >
        {active && !collapsed && (
          <span style={{
            position: 'absolute', left: 0, top: '18%', bottom: '18%',
            width: 3, borderRadius: '0 3px 3px 0', background: C.green,
          }} />
        )}
        <Icon size={15} strokeWidth={active ? 2.5 : 1.8} />
        {!collapsed && label}
      </button>
    )
  }

  return (
    <>
      {/* Logo */}
      <div style={{
        padding: collapsed ? '14px 8px' : '18px 16px',
        borderBottom: `1px solid ${C.border}`,
        display: 'flex', alignItems: 'center',
        justifyContent: collapsed ? 'center' : 'flex-start',
        gap: 10, flexShrink: 0,
      }}>
        <img
          src={dark ? '/a_logo_dark.png' : '/a_logo_light.png'}
          alt="Azura"
          style={{
            height: collapsed ? 30 : 40, width: 'auto',
            objectFit: 'contain', borderRadius: 6,
            border: `1px solid ${C.border}`,
            transition: 'height 0.2s',
          }}
        />
        {!collapsed && (
          <div style={{ color: C.textDim, fontSize: 9, letterSpacing: '0.16em', textTransform: 'uppercase' }}>
            Système<br />d'Irrigation
          </div>
        )}
      </div>

      {/* Nav */}
      <nav style={{ flex: 1, padding: collapsed ? '10px 6px' : '12px 10px', overflowY: 'auto' }}>
        {navBtn('dashboard', LayoutDashboard, 'Dashboard')}

        {!collapsed && (
          <div style={{
            color: C.textDim, fontSize: 11, fontWeight: 600,
            textTransform: 'uppercase', letterSpacing: '0.10em',
            padding: '0 10px', marginBottom: 8,
          }}>Fermes</div>
        )}
        {collapsed && <div style={{ height: 1, background: C.border, margin: '6px 8px' }} />}

        {loadingFarms ? (
          !collapsed && <div style={{ padding: '8px 10px', color: C.textDim, fontSize: 11 }}>Chargement…</div>
        ) : farms.length === 0 ? (
          !collapsed && <div style={{ padding: '8px 10px', color: C.textDim, fontSize: 11 }}>Aucune serre</div>
        ) : farms.map(farm => (
          <FarmItem
            key={farm.farm_name}
            farm={farm}
            selectedDevice={selectedDevice}
            onSelectDevice={handleSelectDevice}
            C={C} dark={dark}
            collapsed={collapsed}
            onClose={onClose}
          />
        ))}

        {collapsed && <div style={{ height: 1, background: C.border, margin: '6px 8px' }} />}
        {!collapsed && auth.role === 'admin' && (
          <div style={{
            color: C.textDim, fontSize: 11, fontWeight: 600,
            textTransform: 'uppercase', letterSpacing: '0.10em',
            padding: '0 10px', marginTop: 16, marginBottom: 8,
          }}>Système</div>
        )}

        {auth.role !== 'auditeur' && navBtn('saisie', ClipboardList, 'Saisie journalière')}
        {navBtn('historique', History, 'Historique')}
        {navBtn('ai', Brain, 'Agent IA')}
        {navBtn('alerts', Bell, 'Alertes')}
        {auth.role === 'admin' && navBtn('users', Users, 'Utilisateurs')}
      </nav>

      {/* Bottom */}
      <div style={{ padding: collapsed ? '10px 6px' : '12px 10px', borderTop: `1px solid ${C.border}`, flexShrink: 0 }}>
        {!collapsed && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 9,
            padding: '9px 10px', borderRadius: 9,
            background: dark ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.03)',
            border: `1px solid ${C.border}`, marginBottom: 8,
          }}>
            <div style={{
              width: 30, height: 30, borderRadius: 7, flexShrink: 0,
              background: dark ? 'rgba(52,217,111,0.12)' : 'rgba(24,120,63,0.10)',
              border: `1.5px solid ${dark ? 'rgba(52,217,111,0.25)' : 'rgba(24,120,63,0.2)'}`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: C.green, fontSize: 11, fontWeight: 900,
            }}>
              {auth.username[0].toUpperCase()}
            </div>
            <div style={{ minWidth: 0 }}>
              <div style={{
                color: C.text, fontWeight: 680, fontSize: 12,
                whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
              }}>
                {auth.username}
              </div>
              <div style={{ marginTop: 3 }}><Badge role={auth.role} dark={dark} /></div>
            </div>
          </div>
        )}

        <div style={{
          display: 'flex', gap: collapsed ? 0 : 6,
          flexDirection: collapsed ? 'column' : 'row',
          alignItems: 'center',
        }}>
          <button
            onClick={toggleDark}
            title={dark ? 'Mode clair' : 'Mode sombre'}
            style={{
              flex: collapsed ? 'unset' : 1,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              gap: 5, padding: collapsed ? '8px 0' : '7px 0',
              width: collapsed ? '100%' : undefined,
              background: 'transparent', border: `1px solid ${C.border}`,
              borderRadius: 7, color: C.textMuted, cursor: 'pointer',
              fontSize: 11, fontWeight: 600, fontFamily: 'inherit',
              marginBottom: collapsed ? 4 : 0,
            }}
          >
            {dark ? <><Sun size={12} strokeWidth={2} />{!collapsed && ' Clair'}</> : <><Moon size={12} strokeWidth={2} />{!collapsed && ' Sombre'}</>}
          </button>
          <button
            onClick={onLogout}
            title="Quitter"
            style={{
              flex: collapsed ? 'unset' : 1,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              gap: 5, padding: collapsed ? '8px 0' : '7px 0',
              width: collapsed ? '100%' : undefined,
              background: 'transparent', border: `1px solid ${C.border}`,
              borderRadius: 7, color: C.textMuted, cursor: 'pointer',
              fontSize: 11, fontWeight: 600, fontFamily: 'inherit',
            }}
          >
            <LogOut size={12} strokeWidth={2} />
            {!collapsed && ' Quitter'}
          </button>
        </div>
      </div>
    </>
  )
}

// ── Main Shell ────────────────────────────────────────────────
export default function DashboardShell({ auth, dark, toggleDark, onLogout }) {
  const C = getColors(dark)
  const width = useWindowWidth()

  const isMobile = width < BP_MOBILE
  const isTablet = width >= BP_MOBILE && width < BP_TABLET

  const [page, setPage] = useState(() => {
    return sessionStorage.getItem('azura_page') || 'dashboard'
  })

  const [selectedDevice, setSelectedDevice] = useState(() => {
    const saved = sessionStorage.getItem('azura_device')
    return saved ? JSON.parse(saved) : null
  })
  const [farms,          setFarms]          = useState([])
  const [loadingFarms, setLoadingFarms]     = useState(farms.length === 0)
  const [mobileOpen,     setMobileOpen]     = useState(false)

  useEffect(() => { if (!isMobile) setMobileOpen(false) }, [isMobile])

  useEffect(() => {
    sessionStorage.setItem('azura_page', page)
    if (selectedDevice) sessionStorage.setItem('azura_device', JSON.stringify(selectedDevice))
    else sessionStorage.removeItem('azura_device')
  }, [page, selectedDevice])

  useEffect(() => {
    document.body.style.overflow = mobileOpen ? 'hidden' : ''
    return () => { document.body.style.overflow = '' }
  }, [mobileOpen])

  const tokenRef = useRef(null)
  const fetchingRef = useRef(false)
  
  useEffect(() => {
    // Already have farms for this token → skip
    if (farms.length > 0 && tokenRef.current === auth.access_token) return
    // Another fetch already in flight → skip
    if (fetchingRef.current) return

    fetchingRef.current = true
    tokenRef.current = auth.access_token

    // Only show spinner if no farms yet (don't flash on token refresh)
    if (farms.length === 0) setLoadingFarms(true)

    getDevices(auth.access_token)
      .then(data => setFarms(Array.isArray(data) ? data : []))
      .catch(() => setFarms([]))
      .finally(() => {
        setLoadingFarms(false)
        fetchingRef.current = false
      })
  }, [auth.access_token])

  const handleSelectDevice = (device) => {
    setSelectedDevice(device); setPage('zone'); setMobileOpen(false)
  }
  const handleBackToDashboard = () => { setPage('dashboard'); setSelectedDevice(null) }

  const sidebarWidth = isMobile ? 0 : isTablet ? 52 : 220

  const sharedProps = {
    C, dark, auth, farms, loadingFarms,
    page, selectedDevice,
    setPage: (p) => { setPage(p); setSelectedDevice(null) },
    handleSelectDevice, toggleDark, onLogout,
  }

  // Props responsive passés aux pages
  const responsiveProps = { isMobile, isTablet }

  return (
    <div style={{
      minHeight: '100vh', background: C.bg, color: C.text,
      display: 'flex', fontFamily: "'JetBrains Mono', monospace",
    }}>

      {/* ── Desktop / Tablet sidebar fixe ───────────────────── */}
      {!isMobile && (
        <aside style={{
          width: sidebarWidth,
          background: C.surface, borderRight: `1px solid ${C.border}`,
          display: 'flex', flexDirection: 'column',
          position: 'fixed', top: 0, bottom: 0, left: 0, zIndex: 20,
          overflow: 'hidden',
          transition: 'width 0.25s cubic-bezier(.22,1,.36,1)',
        }}>
          <SidebarContent {...sharedProps} collapsed={isTablet} />
        </aside>
      )}

      {/* ── Mobile overlay sidebar ───────────────────────────── */}
      {isMobile && (
        <>
          <div
            onClick={() => setMobileOpen(false)}
            style={{
              position: 'fixed', inset: 0, zIndex: 29,
              background: 'rgba(0,0,0,0.55)', backdropFilter: 'blur(2px)',
              opacity: mobileOpen ? 1 : 0,
              pointerEvents: mobileOpen ? 'auto' : 'none',
              transition: 'opacity 0.3s cubic-bezier(.22,1,.36,1)',
            }}
          />
          <aside style={{
            position: 'fixed', top: 0, bottom: 0, left: 0, width: 260,
            background: C.surface, borderRight: `1px solid ${C.border}`,
            display: 'flex', flexDirection: 'column', zIndex: 30,
            transform: mobileOpen ? 'translateX(0)' : 'translateX(-100%)',
            transition: 'transform 0.32s cubic-bezier(.22,1,.36,1)',
            boxShadow: mobileOpen ? '4px 0 32px rgba(0,0,0,0.25)' : 'none',
          }}>
            <button
              onClick={() => setMobileOpen(false)}
              style={{
                position: 'absolute', top: 14, right: 14,
                background: 'none', border: 'none',
                cursor: 'pointer', color: C.textDim, padding: 4, zIndex: 1,
              }}
            >
              <X size={16} strokeWidth={2} />
            </button>
            <SidebarContent
              {...sharedProps} collapsed={false}
              onClose={() => setMobileOpen(false)}
            />
          </aside>
        </>
      )}

      {/* ── Main content ─────────────────────────────────────── */}
      <main style={{
        marginLeft: sidebarWidth, flex: 1, minHeight: '100vh', minWidth: 0,
        transition: 'margin-left 0.25s cubic-bezier(.22,1,.36,1)',
      }}>

        {/* Topbar mobile */}
        {isMobile && (
          <div style={{
            position: 'sticky', top: 0, zIndex: 10,
            background: C.surface, borderBottom: `1px solid ${C.border}`,
            padding: '12px 16px',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          }}>
            <button
              onClick={() => setMobileOpen(true)}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: C.textMuted, padding: 4, display: 'flex', alignItems: 'center' }}
            >
              <AlignLeft size={20} strokeWidth={1.8} />
            </button>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <img
                src={dark ? '/a_logo_dark.png' : '/a_logo_light.png'}
                alt="Azura"
                style={{ height: 28, width: 'auto', objectFit: 'contain', borderRadius: 5 }}
              />
              <span style={{ fontSize: 13, fontWeight: 800, color: C.text }}>Azura</span>
            </div>
            <button
              onClick={toggleDark}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: C.textMuted, padding: 4, display: 'flex', alignItems: 'center' }}
            >
              {dark ? <Sun size={16} strokeWidth={1.8} /> : <Moon size={16} strokeWidth={1.8} />}
            </button>
          </div>
        )}

        {/* Pages */}
        <div style={{
          padding: isMobile ? '16px 12px 24px' : isTablet ? '28px 24px' : '36px 40px',
          animation: 'az-fade-up 0.3s ease both',
        }}>
          {page === 'dashboard' && (
            <DashboardPage
              token={auth.access_token}
              onSelectDevice={handleSelectDevice}
              initialFarms={farms.length > 0 ? undefined : undefined} // dashboard needs metrics, always fetches
              C={C} dark={dark} {...responsiveProps}
            />
          )}
          {page === 'zone' && selectedDevice && (
            <ZonePage
              token={auth.access_token}
              device={selectedDevice}
              onBack={handleBackToDashboard}
              C={C} dark={dark} {...responsiveProps}
            />
          )}
          {page === 'historique' && (
            <HistoriquePage
              token={auth.access_token} auth={auth}
              C={C} dark={dark} {...responsiveProps}
            />
          )}
          {page === 'saisie' && auth.role !== 'auditeur' && (
            <SaisiePage
              token={auth.access_token} auth={auth}
              C={C} dark={dark} {...responsiveProps}
            />
          )}
          {page === 'users' && auth.role === 'admin' && (
            <UsersPage
              token={auth.access_token} userRole={auth.role}
              C={C} dark={dark} {...responsiveProps}
            />
          )}
          {page === 'ai' && (
            <AgentIAPage
              token={auth.access_token}
              auth={auth}
              C={C} dark={dark}
            />
          )}
          {page === 'alerts' && (
            <AlertsPage
              token={auth.access_token}
              auth={auth}
              C={C} dark={dark}
            />
          )}
        </div>
        <AlertWatcher token={auth.access_token} />
      </main>
    </div>
  )
}