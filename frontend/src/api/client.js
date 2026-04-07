// ============================================================
// frontend/src/api/client.js — Client API Azura complet
// ============================================================

const BASE = ''

// ── Auto refresh token ────────────────────────────────────────
async function fetchWithRefresh(url, options = {}) {

  const auth = JSON.parse(sessionStorage.getItem('azura_auth') || '{}')
  let accessToken = auth.access_token

  // 🔥 injecter token dans la requête
  options.headers = {
    ...(options.headers || {}),
    Authorization: `Bearer ${accessToken}`,
  }

  let res = await fetch(url, options)

  if (res.status === 401) {
    // Tenter refresh
    const auth = JSON.parse(sessionStorage.getItem('azura_auth') || '{}')
    if (!auth.refresh_token) {
      window.dispatchEvent(new Event('azura_logout'))
      throw new Error('Session expirée')
    }

    const refreshRes = await fetch('/api/auth/refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: auth.refresh_token }),
    })

    if (!refreshRes.ok) {
      window.dispatchEvent(new Event('azura_logout'))
      throw new Error('Session expirée')
    }

    const { access_token } = await refreshRes.json()

    // Sauvegarder nouveau token
    const newAuth = { ...auth, access_token }
    sessionStorage.setItem('azura_auth', JSON.stringify(newAuth))
    window.dispatchEvent(new CustomEvent('azura_token_refresh', { detail: { access_token } }))

    // Retenter avec nouveau token
    options.headers = { ...options.headers, Authorization: `Bearer ${access_token}` }
    res = await fetch(url, options)
  }

  return res
}

// ── Auth ──────────────────────────────────────────────────────
export async function login(username, password) {
  const fd = new FormData()
  fd.append('username', username)
  fd.append('password', password)
  const res = await fetch(`${BASE}/api/auth/login`, { method: 'POST', body: fd })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.detail || 'Identifiants incorrects')
  }
  return res.json()
}

export async function getUsers() {
  const res = await fetchWithRefresh(`${BASE}/api/auth/users`)
  if (!res.ok) throw new Error('Accès refusé')
  return res.json()
}

export async function createUser(payload) {
  const res = await fetchWithRefresh(`${BASE}/api/auth/users`, {
    method: 'POST',
    body: JSON.stringify(payload),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.detail || 'Erreur lors de la création')
  }
  return res.json()
}

export async function editUser(username, payload) {
  const res = await fetchWithRefresh(`${BASE}/api/auth/users/${username}`, {
    method: 'PUT',
    body: JSON.stringify(payload),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.detail || 'Erreur lors de la modification')
  }
  return res.json()
}

export async function changeRole(username, new_role) {
  const res = await fetchWithRefresh(`${BASE}/api/auth/users/${username}/role`, {
    method: 'PUT',
    body: JSON.stringify({ new_role }),
  })
  if (!res.ok) throw new Error('Erreur changement de rôle')
  return res.json()
}

export async function toggleUser(username) {
  const res = await fetchWithRefresh(`${BASE}/api/auth/users/${username}/toggle`, {
    method: 'PUT'})
  if (!res.ok) throw new Error('Erreur activation/désactivation')
  return res.json()
}

export async function getAuditLogs(username = null, limit = 100) {
  const params = new URLSearchParams({ limit })
  if (username) params.append('username', username)
  const res = await fetchWithRefresh(`${BASE}/api/auth/logs?${params}`)
  if (!res.ok) throw new Error('Erreur chargement logs')
  return res.json()
}

export async function exportCSV() {
  const res = await fetchWithRefresh(`${BASE}/api/auth/users/export`)
  if (!res.ok) throw new Error('Erreur export CSV')
  const blob = await res.blob()
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = 'azura_users.csv'
  a.click()
  URL.revokeObjectURL(url)
}

// ── Devices ───────────────────────────────────────────────────

/** Liste devices groupés par ferme (pour sidebar) */
export async function getDevices() {
  const res = await fetchWithRefresh(`${BASE}/api/devices`)
  if (!res.ok) throw new Error('Erreur chargement devices')
  return res.json()
}

/** Dashboard global : toutes les fermes avec métriques */
export async function getDashboard() {
  const res = await fetchWithRefresh(`${BASE}/api/devices/dashboard`)
  if (!res.ok) throw new Error('Erreur chargement dashboard')
  return res.json()
}

/** Dernière lecture temps réel d'un device (StatCards) */
export async function getDeviceLatest(deviceId) {
  const res = await fetchWithRefresh(`${BASE}/api/devices/${deviceId}/latest`)
  if (!res.ok) throw new Error('Erreur chargement données temps réel')
  return res.json()
}

/** Historique paginé pour le tableau */
export async function getDeviceHistory(deviceId, { dateFrom, dateTo, page = 1, perPage = 50 } = {}) {
  const params = new URLSearchParams({ page, per_page: perPage })
  if (dateFrom) params.append('date_from', dateFrom)
  if (dateTo)   params.append('date_to',   dateTo)
  const res = await fetchWithRefresh(`${BASE}/api/devices/${deviceId}/history?${params}`)
  if (!res.ok) throw new Error('Erreur chargement historique')
  return res.json()
}

/** Export CSV d'un device sur une période */
export async function exportDeviceCSV(deviceId, dateFrom, dateTo, filename = 'azura_export.csv') {
  const params = new URLSearchParams()
  if (dateFrom) params.append('date_from', dateFrom)
  if (dateTo)   params.append('date_to',   dateTo)
  const res = await fetchWithRefresh(`${BASE}/api/devices/${deviceId}/export?${params}`)
  if (!res.ok) throw new Error('Erreur export CSV')
  const blob = await res.blob()
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

/** Alertes actives d'un device */
export async function getDeviceAlerts(deviceId, resolved = false) {
  const res = await fetchWithRefresh(`${BASE}/api/devices/${deviceId}/alerts?resolved=${resolved}`)
  if (!res.ok) throw new Error('Erreur chargement alertes')
  return res.json()
}

/** Tours d'irrigation d'un device */
export async function getDeviceTours(deviceId, date = null) {
  const params = new URLSearchParams()
  if (date) params.append('date', date)
  const res = await fetchWithRefresh(`${BASE}/api/devices/${deviceId}/tours?${params}`)
  if (!res.ok) throw new Error('Erreur chargement tours')
  return res.json()
}