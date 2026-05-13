// ============================================================
// frontend/src/App.jsx
// ============================================================

import { useState, useEffect } from 'react'
import LoginPage from './pages/LoginPage.jsx'
import DashboardShell from './components/DashboardShell.jsx'
import { ToastProvider } from './pages/AlertsPage.jsx'

export default function App() {
  const [auth, setAuth] = useState(() => {
    const saved = sessionStorage.getItem('azura_auth')
    return saved ? JSON.parse(saved) : null
  })

  useEffect(() => {
    if (auth) sessionStorage.setItem('azura_auth', JSON.stringify(auth))
    else sessionStorage.removeItem('azura_auth')
  }, [auth])

  useEffect(() => {
    if (!auth?.refresh_token) return

    const doRefresh = async () => {
      try {
        const res = await fetch('/api/auth/refresh', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refresh_token: auth.refresh_token }),
        })
        if (!res.ok) return
        const { access_token } = await res.json()
        setAuth(a => ({ ...a, access_token }))
      } catch (e) {
        console.warn('Refresh silencieux échoué:', e)
      }
    }

    const interval = setInterval(doRefresh, 13 * 60 * 1000) // toutes les 13 min
    return () => clearInterval(interval)
  }, [auth?.refresh_token])

  useEffect(() => {
    const onLogout = () => setAuth(null)
    const onRefresh = (e) => setAuth(a => ({ ...a, access_token: e.detail.access_token }))
    window.addEventListener('azura_logout', onLogout)
    window.addEventListener('azura_token_refresh', onRefresh)
    return () => {
      window.removeEventListener('azura_logout', onLogout)
      window.removeEventListener('azura_token_refresh', onRefresh)
    }
  }, [])

  const [dark, setDark] = useState(false)

  if (!auth) {
    return (
      <ToastProvider dark={dark}>
        <LoginPage onLogin={setAuth} dark={dark} toggleDark={() => setDark(d => !d)} />
      </ToastProvider>
    )
  }

  return (
    <ToastProvider dark={dark}>
      <DashboardShell
        auth={auth}
        dark={dark}
        toggleDark={() => setDark(d => !d)}
        onLogout={() => setAuth(null)}
      />
    </ToastProvider>
  )
}