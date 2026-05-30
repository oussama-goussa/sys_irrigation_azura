// ============================================================
// frontend/src/App.jsx
// ============================================================

import LoginPage from './pages/LoginPage.jsx'
import DashboardShell from './components/DashboardShell.jsx'
import { ToastProvider } from './pages/AlertsPage.jsx'
import { setAccessToken, clearAccessToken, getAccessToken, logout } from './api/client.js'

import { useState, useEffect, useCallback, useRef } from 'react'

export default function App() {
  const [auth, setAuth] = useState(() => {
    try {
      const saved = sessionStorage.getItem('azura_auth')
      if (!saved) return null
      const parsed = JSON.parse(saved)
      // Retourner null — le refresh token re-hydratera les données complètes
      return parsed.username ? { username: parsed.username, role: null, farm_names: [] } : null
    } catch {
      sessionStorage.removeItem('azura_auth')
      return null
    }
  })

  const [isHydrating, setIsHydrating] = useState(() => {
    try {
      const saved = sessionStorage.getItem('azura_auth')
      return !!(saved && JSON.parse(saved).username)
    } catch { return false }
  })

  useEffect(() => {
    if (auth) {
        const { access_token, ...safeAuth } = auth
        sessionStorage.setItem('azura_auth', JSON.stringify(safeAuth))
    }
    else sessionStorage.removeItem('azura_auth')
  }, [auth])

  useEffect(() => {
    if (auth) {
      // Stocker UNIQUEMENT le username pour la restauration de session
      // NE PAS stocker le rôle — il vient toujours du token JWT vérifié côté serveur
      sessionStorage.setItem('azura_auth', JSON.stringify({
        username: auth.username
        // role et farm_names intentionnellement exclus
      }))
    } else {
      sessionStorage.removeItem('azura_auth')
    }
  }, [auth])

  useEffect(() => {
    if (!auth?.username) return

    const doRefresh = async () => {
      try {
        const res = await fetch('/api/auth/refresh', {
          method: 'POST',
          credentials: 'include',
        })
        if (!res.ok) {
          clearAccessToken()
          setAuth(null)
          return
        }
        const { access_token } = await res.json()
        setAccessToken(access_token)
      } catch (e) {
        console.warn('Refresh silencieux échoué:', e)
        clearAccessToken()
        setAuth(null)     // ← ajouter ça dans le catch aussi
      } finally {
        setIsHydrating(false)   // ← débloquer le rendu dans tous les cas
      }
    }

    doRefresh()   // ← appel immédiat au montage

    const interval = setInterval(doRefresh, 12 * 60 * 1000)
    return () => clearInterval(interval)
  }, [auth?.username])

  // ── Fonction de déconnexion — appelle l'API pour révoquer le cookie ──
  const handleLogout = useCallback(async () => {
    try {
      // getAccessToken() lit le token depuis la mémoire (_memoryToken)
      // logout() envoie POST /api/auth/logout avec credentials:'include'
      // → le serveur supprime le cookie refresh_token HttpOnly
      await logout(getAccessToken())
    } catch {
      // Si le serveur est inaccessible, on déconnecte quand même localement
    } finally {
      // Dans tous les cas : vider le token mémoire + vider l'état React
      clearAccessToken()
      setAuth(null)
    }
  }, [])

  useEffect(() => {
    // Déconnexion déclenchée par client.js (ex: token expiré non renouvelable)
    const onLogoutEvent = () => {
      clearAccessToken()
      setAuth(null)
    }
    const onRefresh = (e) => setAccessToken(e.detail.access_token)
    window.addEventListener('azura_logout', onLogoutEvent)
    window.addEventListener('azura_token_refresh', onRefresh)
    return () => {
      window.removeEventListener('azura_logout', onLogoutEvent)
      window.removeEventListener('azura_token_refresh', onRefresh)
    }
  }, [])

  const [dark, setDark] = useState(false)

  if (!auth) {
    return (
      <ToastProvider dark={dark}>
        <LoginPage
          onLogin={(data) => {
              const { access_token, ...sessionData } = data
              setAccessToken(access_token)
              setAuth(sessionData)
          }}
          dark={dark}
          toggleDark={() => setDark(d => !d)}
        />
      </ToastProvider>
    )
  }

  if (isHydrating) return null

  return (
    <ToastProvider dark={dark}>
      <DashboardShell
        auth={auth}
        dark={dark}
        toggleDark={() => setDark(d => !d)}
        onLogout={handleLogout}
      />
    </ToastProvider>
  )
}