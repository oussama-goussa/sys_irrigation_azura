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